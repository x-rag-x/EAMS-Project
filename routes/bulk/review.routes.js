const express = require('express');
const router = express.Router();
const JSZip = require('jszip');
const bcrypt = require('@node-rs/bcrypt');
const M = require('../../models');
const cfg = require('../../config');
const { authMiddleware, requirePage } = require('../../middleware/auth');
const { loadBatch, isSudoCaller, canAutoApprove, toClient } = require('../../services/bulk/access');
const { transition } = require('../../services/bulk/stateMachine');
const { postMessage } = require('../../services/bulk/messages');
const { bus } = require('../../services/bulk/progress');
const { get24HourVerificationCount } = require('./batches.routes');
const { normalizeYearRange, toBatchTrackId, buildStudentTrackId } = require('../../utils/yearFormat');
const { sanitizeFullName, splitFirstLastName } = require('../../utils/nameFormat');
const { logAction } = require('../../utils/logAction');
const { getSetting } = require('../../utils/settingsCache');
const { sendWelcomeCredentialsMail } = require('../../utils/mailer');
const crypto = require('crypto');
const { notifySudoOnForward, notifySudoOnSubmitFinal, notifyUploaderOnDecision } = require('../../services/bulk/notifications');

function generateTempPassword(role) {
  const rand = crypto.randomBytes(4).toString('hex');
  return `${role === 'teacher' ? 'Teach' : 'Stud'}#${rand}!`;
}

function getPortalUrl(req) {
  if (process.env.PORTAL_URL && String(process.env.PORTAL_URL).trim()) {
    let p = String(process.env.PORTAL_URL).trim().replace(/\/+$/, '');
    if (!p.endsWith('/index.html') && !p.endsWith('.html')) {
      p = `${p}/index.html`;
    }
    return p;
  }
  const origin = req.get ? req.get('origin') : (req.headers && req.headers.origin);
  if (origin) {
    return `${origin.replace(/\/+$/, '')}/index.html`;
  }
  const host = (req.get ? req.get('host') : (req.headers && req.headers.host)) || 'localhost:3000';
  const protocol = req.protocol || (req.secure ? 'https' : 'http');
  return `${protocol}://${host}/index.html`;
}

// ── 1. RESOLVE SKIPPED ROWS (PERSIST DONE TICKS) ──
router.post('/batches/:id/resolve-skipped', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    const doneRows = req.body.doneRows || req.body.resolved || [];
    if (!Array.isArray(doneRows)) {
      return res.status(400).json({ error: 'doneRows or resolved must be an array of row numbers' });
    }

    const batch = req.batch;
    let anyChanged = false;

    for (const r of (batch.skippedRows || [])) {
      const match = doneRows.includes(r.rowNumber);
      if (match && (!r.isDone || !r.isResolved)) {
        r.isDone = true;
        r.isResolved = true;
        r.doneAt = new Date();
        anyChanged = true;
      } else if (!match && (r.isDone || r.isResolved)) {
        r.isDone = false;
        r.isResolved = false;
        anyChanged = true;
      }
    }

    if (anyChanged) {
      await batch.save();
    }

    const allDone = (batch.skippedRows || []).every(r => r.isDone || r.isResolved);
    let currentStatus = batch.status;
    if (allDone && batch.status === 'staged') {
      const updated = await transition(batch._id, 'skipped_resolved', {
        from: ['staged'],
        user: req.user
      });
      currentStatus = updated.status;
    }

    res.json({
      ok: true,
      allDone,
      status: currentStatus,
      skippedRows: batch.skippedRows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 2. FORWARD TO SUDO ADMIN FOR INITIAL APPROVAL ──
router.post('/batches/:id/forward-sudo', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    const batch = req.batch;

    // Guard: All skipped issues must be acknowledged as Done before forwarding
    const unresolvedSkipped = (batch.skippedRows || []).filter(r => !r.isDone && !r.isResolved);
    if (unresolvedSkipped.length > 0) {
      return res.status(409).json({
        error: `Cannot forward: ${unresolvedSkipped.length} skipped row(s) still have unacknowledged issues.`
      });
    }

    const canAuto = canAutoApprove(req.user, batch);
    if (canAuto) {
      const nextStatus = 'sudo_initial_approved';
      const roleLabel = isSudoCaller(req.user) ? 'Sudo Admin' : 'Super Admin';

      await transition(batch, nextStatus, {
        user: req.user,
        from: ['staged', 'skipped_resolved'],
        details: { autoApproved: true }
      });

      batch.sudoInitialApproval = {
        approved: true,
        approvedBy: req.user.name || req.user.fullName || roleLabel,
        auto: true,
        approvedAt: new Date()
      };
      await batch.save();

      await postMessage(batch._id, {
        kind: 'card',
        card: 'verify',
        author: 'system',
        payload: {
          autoApproved: true,
          type: batch.type,
          text: `Initial approval · Auto-approved (you are ${roleLabel})`
        }
      });

      try {
        await logAction({
          trackId: 'BULK-' + (batch.batchTrackId || batch._id),
          action: 'bulk.initial_approval.auto',
          userId: req.user._id,
          userRole: req.user.role || 'admin',
          details: { status: nextStatus, type: batch.type, auto: true }
        });
      } catch (logErr) {
        console.warn('[ReviewRoutes] logAction error:', logErr.message);
      }

      return res.json({
        ok: true,
        status: nextStatus,
        autoApproved: true,
        message: `Auto-approved for verification (uploaded by ${roleLabel})`
      });
    }

    // Standard flow: forward for sudo review
    await transition(batch, 'pending_sudo_initial', {
      user: req.user,
      from: ['staged', 'skipped_resolved']
    });

    await postMessage(batch._id, {
      kind: 'card',
      card: 'sudo-review',
      author: 'system',
      payload: { forwarded: true }
    });

    notifySudoOnForward(batch, req.user);

    res.json({
      ok: true,
      status: 'pending_sudo_initial',
      message: 'Batch forwarded for Sudo Admin approval.'
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── 3. SUDO ADMIN INITIAL APPROVAL ──
router.post('/batches/:id/approve-initial', authMiddleware, requirePage('bulk', 'approve'), loadBatch('sudo'), async (req, res) => {
  try {
    const batch = req.batch;
    const targetStatus = 'sudo_initial_approved';

    const approvalData = {
      approved: true,
      approvedBy: req.user.name || 'Sudo Admin',
      approvedAt: new Date(),
      notes: req.body.notes || 'Initial batch import approved'
    };

    await transition(batch, targetStatus, {
      user: req.user,
      from: ['pending_sudo_initial', 'skipped_resolved', 'staged'],
      extraSet: { sudoInitialApproval: approvalData },
      details: approvalData
    });

    await postMessage(batch._id, {
      kind: 'card',
      card: 'verify',
      author: 'system',
      actor: req.user,
      payload: { approved: true, notes: approvalData.notes, type: batch.type }
    });

    notifyUploaderOnDecision(batch, 'approved for initial verification', approvalData.notes, req.user);

    res.json({
      ok: true,
      status: targetStatus,
      message: 'Batch approved — verification panel is now open.'
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── 4. SUDO ADMIN REJECT BATCH ──
router.post(['/batches/:id/reject', '/batches/:id/reject-initial'], authMiddleware, requirePage('bulk', 'approve'), loadBatch('sudo'), async (req, res) => {
  try {
    if (typeof req.body.reason !== 'string') {
      return res.status(400).json({ error: 'Rejection reason must be a string.' });
    }
    const reason = req.body.reason.trim();
    if (!reason || reason.length < 3) {
      return res.status(400).json({ error: 'A rejection reason is required (at least 3 characters).' });
    }

    const rejection = {
      by: req.user.name || 'Sudo Admin',
      at: new Date(),
      reason,
      stage: req.batch.status
    };

    await transition(req.batch, 'rejected', {
      user: req.user,
      from: ['pending_sudo_initial', 'pending_final_approval', 'staged', 'skipped_resolved', 'sudo_initial_approved', 'verifying', 'verified_all'],
      extraSet: { rejection },
      details: rejection
    });

    await M.BulkImportBatch.updateOne(
      { _id: req.batch._id },
      { $unset: { 'eligibleRows.$[].data.password': '', 'skippedRows.$[].data.password': '' } }
    );

    await postMessage(req.batch._id, {
      kind: 'card',
      card: 'rejected',
      author: 'system',
      actor: req.user,
      payload: rejection
    });

    notifyUploaderOnDecision(req.batch, 'rejected', reason, req.user);

    res.json({
      ok: true,
      status: 'rejected',
      message: 'Batch import rejected by Sudo Admin'
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});


// ── 5a. DRY-RUN VERIFICATION CHECK & DIFFS (P5) ──
router.post('/batches/:id/verify-entry/check', authMiddleware, requirePage('bulk', 'create'), loadBatch('collab'), async (req, res) => {
  try {
    const batch = req.batch;
    const rowNumber = Number(req.body.rowNumber);
    const updatedData = req.body.updatedData || {};

    const entry = (batch.eligibleRows || []).find(r => r.rowNumber === rowNumber);
    if (!entry) {
      return res.status(404).json({ error: 'Row ' + rowNumber + ' not found in eligible records' });
    }

    const data = Object.assign({}, entry.data || {}, updatedData);
    const diffs = [];

    for (const key of Object.keys(updatedData)) {
      const oldVal = entry.data ? entry.data[key] : undefined;
      const newVal = updatedData[key];
      if (newVal !== undefined && String(oldVal ?? '') !== String(newVal ?? '')) {
        diffs.push({ field: key, oldVal: oldVal ?? '', newVal: newVal });
      }
    }

    const checks = [];

    // Email check (Student & Teacher)
    if (['student', 'teacher'].includes(batch.type) || data.email) {
      const email = String(data.email || '').trim().toLowerCase();
      if (!email) {
        checks.push({ field: 'email', valid: false, message: 'E-mail address is required' });
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        checks.push({ field: 'email', valid: false, message: 'Invalid email address format' });
      } else {
        // Typo heuristics (e.g. gmial.com, yaho.com, hotmial.com)
        const domain = email.split('@')[1] || '';
        if (/gmial\.|gmai\.|gmaill\./i.test(domain)) {
          checks.push({ field: 'email', valid: true, issue: 'typo', message: '"' + domain + '" — did you mean gmail.com?' });
        } else if (/yaho\.|yahooo\./i.test(domain)) {
          checks.push({ field: 'email', valid: true, issue: 'typo', message: '"' + domain + '" — did you mean yahoo.com?' });
        } else if (/hotmial\.|hotmai\./i.test(domain)) {
          checks.push({ field: 'email', valid: true, issue: 'typo', message: '"' + domain + '" — did you mean hotmail.com?' });
        } else {
          checks.push({ field: 'email', valid: true, message: 'E-mail format valid' });
        }
      }
    }

    // Username check & uniqueness
    if (data.username) {
      const u = String(data.username).trim().toLowerCase();
      if (u.length < 3 || !/^[a-z0-9_.-]+$/.test(u)) {
        checks.push({ field: 'username', valid: false, message: 'Username must be >= 3 characters (alphanumeric, dot, underscore, dash)' });
      } else {
        const existing = await M.User.findOne({ username: u }).lean();
        const curTrack = entry.data.trackId || (entry.data.registerNo || entry.data.employeeNo);
        if (existing && existing.trackId && existing.trackId !== curTrack && existing.username !== entry.data.username) {
          checks.push({ field: 'username', valid: false, message: 'Username "' + u + '" is already in use by ' + (existing.role || 'another user') });
        } else {
          checks.push({ field: 'username', valid: true, message: 'Username is unique & available' });
        }
      }
    }

    // Type-specific checks
    if (batch.type === 'student') {
      // Full name
      if (!data.fullName && !data.name) {
        checks.push({ field: 'fullName', valid: false, message: 'Student full name is required' });
      } else {
        checks.push({ field: 'fullName', valid: true, message: 'Student full name verified' });
      }

      // Register No uniqueness
      const reg = String(data.registerNo || '').trim().toUpperCase();
      if (!reg) {
        checks.push({ field: 'registerNo', valid: false, message: 'Register number is required' });
      } else {
        const inDb = await M.Student.findOne({ registerNo: reg }).lean();
        const inBatch = (batch.eligibleRows || []).some(r => r.rowNumber !== rowNumber && r.data && String(r.data.registerNo || '').toUpperCase() === reg);
        if (inBatch) {
          checks.push({ field: 'registerNo', valid: false, message: 'Register no. duplicate in file' });
        } else if (inDb && (!inDb.trackId || inDb.trackId !== entry.data.trackId)) {
          checks.push({ field: 'registerNo', valid: false, message: 'Register no. already exists in database' });
        } else {
          checks.push({ field: 'registerNo', valid: true, message: 'Register no. unique (DB + file)' });
        }
      }

      // Department existence
      const deptVal = data.department || data.deptName || data.deptCode || '';
      if (!deptVal) {
        checks.push({ field: 'department', valid: false, message: 'Department is required' });
      } else {
        const dept = await M.Department.findOne({
          $or: [
            { code: deptVal },
            { name: deptVal },
            { code: new RegExp('^' + deptVal + '$', 'i') },
            { name: new RegExp('^' + deptVal + '$', 'i') }
          ]
        }).lean();
        if (dept) {
          checks.push({ field: 'department', valid: true, message: 'Department "' + (dept.name || dept.code) + '" exists' });
        } else {
          checks.push({ field: 'department', valid: false, message: 'Department "' + deptVal + '" not found' });
        }
      }

      // Class check
      if (data.class) {
        checks.push({ field: 'class', valid: true, message: 'Class belongs to dept & batch' });
      }
    } else if (batch.type === 'teacher') {
      // Full name
      if (!data.fullName && !data.name) {
        checks.push({ field: 'fullName', valid: false, message: 'Teacher full name is required' });
      } else {
        checks.push({ field: 'fullName', valid: true, message: 'Teacher full name verified' });
      }

      // Employee No uniqueness
      const emp = String(data.employeeNo || data.empId || '').trim();
      if (!emp) {
        checks.push({ field: 'employeeNo', valid: false, message: 'Employee number is required' });
      } else {
        const inDb = await M.Teacher.findOne({ employeeNo: emp }).lean();
        const inBatch = (batch.eligibleRows || []).some(r => r.rowNumber !== rowNumber && r.data && String(r.data.employeeNo || r.data.empId || '').trim() === emp);
        if (inBatch) {
          checks.push({ field: 'employeeNo', valid: false, message: 'Employee ID duplicate in file' });
        } else if (inDb && (!inDb.trackId || inDb.trackId !== entry.data.trackId)) {
          checks.push({ field: 'employeeNo', valid: false, message: 'Employee ID already exists in database' });
        } else {
          checks.push({ field: 'employeeNo', valid: true, message: 'Employee ID unique (DB + file)' });
        }
      }

      // Department existence
      const deptVal = data.department || '';
      if (deptVal) {
        const dept = await M.Department.findOne({
          $or: [
            { code: deptVal },
            { name: deptVal },
            { code: new RegExp('^' + deptVal + '$', 'i') }
          ]
        }).lean();
        if (dept) {
          checks.push({ field: 'department', valid: true, message: 'Department "' + (dept.name || dept.code) + '" exists' });
        } else {
          checks.push({ field: 'department', valid: false, message: 'Department "' + deptVal + '" not found' });
        }
      }
    } else if (batch.type === 'dept') {
      const deptCode = String(data.code || '').trim().toUpperCase();
      if (!deptCode) {
        checks.push({ field: 'code', valid: false, message: 'Department code is required' });
      } else {
        const inDb = await M.Department.findOne({ code: deptCode }).lean();
        const inBatch = (batch.eligibleRows || []).some(r =>
          r.rowNumber !== rowNumber && r.data && String(r.data.code || '').trim().toUpperCase() === deptCode
        );
        if (inBatch) {
          checks.push({ field: 'code', valid: false, message: `Department code "${deptCode}" duplicate in file` });
        } else if (inDb) {
          checks.push({ field: 'code', valid: false, message: `Department code "${deptCode}" already exists in database (${inDb.name})` });
        } else {
          checks.push({ field: 'code', valid: true, message: `Department code "${deptCode}" is unique` });
        }
      }

      const deptName = String(data.name || '').trim();
      if (!deptName) {
        checks.push({ field: 'name', valid: false, message: 'Department name is required' });
      } else {
        const inDb = await M.Department.findOne({
          name: new RegExp('^' + deptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')
        }).lean();
        const inBatch = (batch.eligibleRows || []).some(r =>
          r.rowNumber !== rowNumber && r.data && String(r.data.name || '').trim().toLowerCase() === deptName.toLowerCase()
        );
        if (inBatch) {
          checks.push({ field: 'name', valid: false, message: `Department name duplicate in file` });
        } else if (inDb) {
          checks.push({ field: 'name', valid: false, message: `Department name "${deptName}" already exists in database` });
        } else {
          checks.push({ field: 'name', valid: true, message: `Department name valid` });
        }
      }

      const deptNum = String(data.number || '').trim();
      if (deptNum) {
        const inDb = await M.Department.findOne({ number: deptNum }).lean();
        const inBatch = (batch.eligibleRows || []).some(r =>
          r.rowNumber !== rowNumber && r.data && String(r.data.number || '').trim() === deptNum
        );
        if (inBatch) {
          checks.push({ field: 'number', valid: false, message: `Department number "${deptNum}" duplicate in file` });
        } else if (inDb) {
          checks.push({ field: 'number', valid: false, message: `Department number "${deptNum}" already in use by ${inDb.name}` });
        } else {
          checks.push({ field: 'number', valid: true, message: `Department number "${deptNum}" verified` });
        }
      }

      if (data.courseType) {
        if (['UG', 'PG', 'None'].includes(data.courseType)) {
          checks.push({ field: 'courseType', valid: true, message: `Course type "${data.courseType}" valid` });
        } else {
          checks.push({ field: 'courseType', valid: false, message: `Invalid course type: must be UG, PG, or None` });
        }
      }

      if (data.branch) {
        if (['B.E', 'B.TECH', 'M.E', 'M.TECH', 'None', 'N/A'].includes(data.branch)) {
          checks.push({ field: 'branch', valid: true, message: `Branch "${data.branch}" valid` });
        } else {
          checks.push({ field: 'branch', valid: false, message: `Invalid branch qualification` });
        }
      }
    } else if (batch.type === 'class') {
      if (!data.name) checks.push({ field: 'name', valid: false, message: 'Class name is required' });
      else checks.push({ field: 'name', valid: true, message: 'Class name valid' });
      if (!data.department) checks.push({ field: 'department', valid: false, message: 'Department is required' });
      else checks.push({ field: 'department', valid: true, message: 'Department assigned' });
    } else if (batch.type === 'subject') {
      if (!data.code) checks.push({ field: 'code', valid: false, message: 'Subject code is required' });
      else checks.push({ field: 'code', valid: true, message: 'Subject code format valid' });
      if (!data.name) checks.push({ field: 'name', valid: false, message: 'Subject name is required' });
      else checks.push({ field: 'name', valid: true, message: 'Subject name valid' });
    }

    const valid = checks.every(c => c.valid);

    res.json({
      ok: true,
      valid,
      checks,
      diffs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 5b. COPY FIELD TO ALL UNVERIFIED ROWS (P5) ──
router.post('/batches/:id/copy-to-all', authMiddleware, requirePage('bulk', 'create'), loadBatch('collab'), async (req, res) => {
  try {
    const batch = req.batch;
    const { field, value, rowNumber } = req.body;

    if (!field || typeof field !== 'string') {
      return res.status(400).json({ error: 'field is required and must be a string' });
    }

    const FORBIDDEN_FIELDS = [
      'registerNo', 'regNo', 'employeeNo', 'empId', 'username', 'email',
      'fullName', 'firstName', 'lastName', 'name', 'password', 'code',
      '_id', 'trackId', 'id'
    ];

    if (FORBIDDEN_FIELDS.includes(field)) {
      return res.status(400).json({
        error: 'FIELD_NOT_COPYABLE',
        message: 'Field "' + field + '" cannot be copied across records.'
      });
    }

    const targetRows = (batch.eligibleRows || []).filter(r => !r.isVerified && r.rowNumber !== Number(rowNumber));
    let changed = 0;
    const skipped = [];

    let matchedDeptDoc = null;
    if (field === 'department' || field === 'dept') {
      matchedDeptDoc = await M.Department.findOne({
        $or: [
          { code: value },
          { name: value },
          { code: new RegExp('^' + String(value).trim() + '$', 'i') },
          { name: new RegExp('^' + String(value).trim() + '$', 'i') }
        ]
      }).lean();
    }

    for (const r of targetRows) {
      if (!r.data) r.data = {};
      r.data[field] = value;
      if (matchedDeptDoc && (field === 'department' || field === 'dept')) {
        r.data.deptId = matchedDeptDoc._id;
        r.data.deptName = matchedDeptDoc.name;
        r.data.deptCode = matchedDeptDoc.code;
      }
      changed++;
    }

    if (changed > 0) {
      batch.markModified('eligibleRows');
      await batch.save();

      await postMessage(batch._id, {
        kind: 'event',
        author: 'system',
        actor: req.user,
        payload: {
          text: (req.user.name || 'User') + ' copied ' + field + ' = "' + value + '" to ' + changed + ' unverified record(s)'
        }
      });

      try {
        await logAction({
          trackId: 'BULK-' + (batch.batchTrackId || batch._id),
          action: 'bulk.copy_to_all',
          userId: req.user._id,
          userRole: req.user.role || 'staff',
          details: { field, value, sourceRow: rowNumber, changed, skippedCount: skipped.length }
        });
      } catch (logErr) {
        console.warn('[ReviewRoutes] logAction error:', logErr.message);
      }
    }

    res.json({
      ok: true,
      field,
      value,
      changed,
      skipped
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 5. VERIFY INDIVIDUAL ENTRY (WITH 500/24h LIMIT & EMAIL DISPATCH) ──
router.post('/batches/:id/verify-entry', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    const batch = req.batch;
    if (!['sudo_initial_approved', 'verifying'].includes(batch.status)) {
      return res.status(409).json({ error: `Cannot verify entries in batch status "${batch.status}" — must be sudo_initial_approved or verifying.` });
    }
    const { rowNumber, updatedData, resendEmail } = req.body;

    const entry = (batch.eligibleRows || []).find(r => r.rowNumber === rowNumber);
    if (!entry) {
      return res.status(404).json({ error: `Row ${rowNumber} not found in eligible records` });
    }

    // Read models settings for bulkMailCredentials
    const modelsSettings = (typeof getSetting === 'function' ? getSetting('models') : null) || {};
    const bulkMailCredentials = modelsSettings.bulkMailCredentials !== false;

    // 24-HOUR RATE LIMIT CHECK (Applies ONLY when email credentials dispatch is enabled)
    if (['student', 'teacher'].includes(batch.type) && !entry.isVerified && bulkMailCredentials) {
      const current24hCount = await get24HourVerificationCount();
      if (current24hCount >= 500) {
        return res.status(429).json({
          error: 'Daily verification limit reached (500/500 entries verified in the last 24 hours). Please wait 24 hours to proceed.',
          current24hCount
        });
      }
    }

    // Merge updated row data if user edited values (re-validated per F-09)
    if (updatedData && typeof updatedData === 'object') {
      if (updatedData.email !== undefined && updatedData.email !== null) {
        const trimmedEmail = String(updatedData.email).trim().toLowerCase();
        if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
          return res.status(400).json({ error: `Invalid email address format: "${updatedData.email}"` });
        }
        updatedData.email = trimmedEmail;
      }

      if (updatedData.username !== undefined && updatedData.username !== null) {
        const u = String(updatedData.username).trim().toLowerCase();
        if (u.length < 3 || !/^[a-z0-9_.-]+$/.test(u)) {
          return res.status(400).json({ error: `Invalid username "${u}". Must be at least 3 characters and contain only lowercase letters, numbers, hyphens, periods, or underscores.` });
        }
        const existing = await M.User.findOne({ username: u }).lean();
        const currentTrackId = entry.data.trackId || (entry.data.registerNo || entry.data.employeeNo);
        if (existing && existing.trackId && existing.trackId !== currentTrackId && existing.username !== entry.data.username) {
          return res.status(409).json({ error: `Username "${u}" is already in use by an existing ${existing.role} (${existing.trackId}).` });
        }
        updatedData.username = u;
      }

      if (batch.type === 'student' && updatedData.registerNo !== undefined) {
        if (!String(updatedData.registerNo).trim()) {
          return res.status(400).json({ error: 'Register number cannot be empty.' });
        }
        updatedData.registerNo = String(updatedData.registerNo).trim().toUpperCase();
      }

      if (batch.type === 'teacher' && updatedData.employeeNo !== undefined) {
        if (!String(updatedData.employeeNo).trim()) {
          return res.status(400).json({ error: 'Employee number cannot be empty.' });
        }
        updatedData.employeeNo = String(updatedData.employeeNo).trim();
      }

      if (batch.type === 'dept') {
        const deptCode = String(updatedData.code !== undefined ? updatedData.code : (entry.data.code || '')).trim().toUpperCase();
        if (deptCode) {
          const inDb = await M.Department.findOne({ code: deptCode }).lean();
          if (inDb) {
            return res.status(409).json({ error: `Department code "${deptCode}" already exists in database (${inDb.name}).` });
          }
          updatedData.code = deptCode;
        }
        const deptName = String(updatedData.name !== undefined ? updatedData.name : (entry.data.name || '')).trim();
        if (deptName) {
          const inDb = await M.Department.findOne({
            name: new RegExp('^' + deptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')
          }).lean();
          if (inDb) {
            return res.status(409).json({ error: `Department name "${deptName}" already exists in database.` });
          }
        }
      }

      if (!updatedData.password || !String(updatedData.password).trim()) {
        delete updatedData.password;
      }
      if (updatedData.fullName) {
        updatedData.fullName = sanitizeFullName(updatedData.fullName);
        const split = splitFirstLastName(updatedData.fullName);
        if (updatedData.firstName) updatedData.firstName = sanitizeFullName(updatedData.firstName);
        else updatedData.firstName = split.firstName;
        if (updatedData.lastName !== undefined && updatedData.lastName !== null && updatedData.lastName !== '') {
          updatedData.lastName = sanitizeFullName(updatedData.lastName);
        } else {
          updatedData.lastName = split.lastName || null;
        }
      }
      entry.data = Object.assign({}, entry.data, updatedData);
    }

    // Password and Mail Handling per bulkMailCredentials setting
    const isUserType = ['student', 'teacher'].includes(batch.type);
    let emailResult = { sent: false, simulated: true };
    let mailRecord = { mode: 'none' };

    if (isUserType) {
      if (bulkMailCredentials) {
        // Mail is ON: generate temp password if missing
        if (!entry.data.password || !String(entry.data.password).trim()) {
          entry.data.password = generateTempPassword(batch.type);
        }

        const recipientEmail = entry.data.email;
        const recipientName = entry.data.fullName || entry.data.name;
        const username = entry.data.username;
        const password = entry.data.password;

        const shouldSendEmail = recipientEmail && (!entry.emailSent || resendEmail);
        if (shouldSendEmail) {
          const portalUrl = getPortalUrl(req);
          emailResult = await sendWelcomeCredentialsMail({
            to: recipientEmail,
            fullName: recipientName,
            username,
            password,
            role: batch.type === 'teacher' ? 'teacher' : 'student',
            institutionName: 'EAMS Institution',
            portalUrl
          });
          entry.emailSent = Boolean(emailResult.sent && !emailResult.simulated);
          entry.emailSentAt = new Date();
          entry.emailRecipient = recipientEmail || '';
          mailRecord = { mode: emailResult.simulated ? 'simulated' : 'sent', to: recipientEmail || '' };
        } else {
          mailRecord = { mode: entry.emailSent ? 'already_sent' : 'no_email', to: recipientEmail || '' };
        }
      } else {
        // Mail is OFF: password is required from sheet or user edit
        const hasPassword = Boolean(entry.data.password && String(entry.data.password).trim());
        if (!hasPassword) {
          return res.status(422).json({
            error: 'PASSWORD_REQUIRED',
            message: 'Password is required when credentials mailing is disabled.'
          });
        }
        entry.emailSent = false;
        mailRecord = { mode: 'off', to: entry.data.email || '' };
      }
    } else {
      // dept / class / subject: no credentials
      mailRecord = { mode: 'none' };
      entry.emailSent = false;
    }

    entry.mail = mailRecord;
    entry.isVerified = true;
    entry.verifiedAt = new Date();
    entry.verifiedBy = req.user.name || 'Staff';

    // Record in verification audit log
    const entityName = entry.data.fullName || entry.data.name || '';
    const identifier = entry.data.registerNo || entry.data.employeeNo || entry.data.code || entry.data.username || '';
    batch.verificationAudit.push({
      rowNumber,
      entityName,
      identifier,
      email: entry.data.email || '',
      mail: mailRecord,
      verifiedBy: req.user.name,
      verifiedAt: new Date(),
      ip: req.ip,
      userAgent: req.headers['user-agent'] || ''
    });

    batch.verifiedCount = batch.eligibleRows.filter(r => r.isVerified).length;
    await batch.save();

    if (batch.verifiedCount >= batch.eligibleCount) {
      await transition(batch._id, 'verified_all', {
        from: ['sudo_initial_approved', 'verifying'],
        user: req.user
      });
      await transition(batch._id, 'sudo_review', {
        from: ['verified_all'],
        user: req.user
      });
      const existingReview = await M.BulkChatMessage.findOne({
        batchId: batch._id,
        kind: 'card',
        card: 'review'
      }).lean();
      if (!existingReview) {
        await postMessage(batch._id, {
          kind: 'card',
          card: 'review',
          author: 'system',
          actor: req.user,
          payload: { eligibleCount: batch.eligibleCount, type: batch.type }
        });
      }
      try {
        const { notifySudoOnReadyForReview } = require('../../services/bulk/notifications');
        await notifySudoOnReadyForReview(batch);
      } catch (nErr) {
        console.warn('[ReviewRoutes] notifySudoOnReadyForReview error:', nErr.message);
      }
    } else if (batch.status === 'sudo_initial_approved') {
      await transition(batch._id, 'verifying', {
        from: ['sudo_initial_approved'],
        user: req.user
      });
    }

    // Broadcast row verification event to live watchers
    bus.emit(`batch:${batch._id}`, {
      type: 'row',
      data: {
        rowNumber,
        isVerified: true,
        verifiedCount: batch.verifiedCount,
        totalEligible: batch.eligibleCount
      }
    });

    logAction({
      trackId: entry.data.trackId || `BULK-${batch.trackId || batch._id}`,
      action: 'BULK_VERIFY_ROW',
      req,
      details: {
        batchId: batch._id,
        rowNumber,
        type: batch.type,
        identifier: entry.data.registerNo || entry.data.employeeNo || username
      }
    }).catch(console.error);

    res.json({
      ok: true,
      rowNumber,
      isVerified: true,
      verifiedCount: batch.verifiedCount,
      allVerified: batch.verifiedCount >= batch.eligibleCount,
      emailSent: Boolean(entry.emailSent),
      mail: entry.mail || { mode: 'none' }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 6. VERIFY ALL REMAINING ENTRIES (WITH 500/24h LIMIT) ──
router.post('/batches/:id/verify-all', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    if (typeof cfg.isDevServer === 'function' ? !cfg.isDevServer() : (process.env.NODE_ENV !== 'development')) {
      return res.status(403).json({ error: 'VERIFY_ALL_DISABLED', message: 'Bulk verify-all is only permitted in development mode.' });
    }

    const batch = req.batch;
    if (!['sudo_initial_approved', 'verifying'].includes(batch.status)) {
      return res.status(409).json({ error: `Cannot verify entries in batch status "${batch.status}" — must be sudo_initial_approved or verifying.` });
    }

    const unverified = (batch.eligibleRows || []).filter(r => !r.isVerified);
    if (!unverified.length) {
      return res.json({ ok: true, message: 'All entries already verified.' });
    }

    const current24hCount = await get24HourVerificationCount();
    const quotaRemaining = Math.max(0, 500 - current24hCount);
    if (quotaRemaining === 0) {
      return res.status(429).json({
        error: 'Daily verification limit reached (500/500 entries verified in the last 24 hours).',
        current24hCount
      });
    }

    const portalUrl = getPortalUrl(req);
    const toProcess = unverified.slice(0, quotaRemaining);
    let emailsDispatched = 0;
    for (const entry of toProcess) {
      if (!entry.data.password || !String(entry.data.password).trim()) {
        entry.data.password = generateTempPassword(batch.type);
      }

      const recipientEmail = entry.data.email;
      const recipientName = entry.data.fullName || entry.data.name || '';
      const identifier = entry.data.registerNo || entry.data.employeeNo || entry.data.username || '';

      if (recipientEmail && !entry.emailSent) {
        try {
          const emailResult = await sendWelcomeCredentialsMail({
            to: recipientEmail,
            fullName: recipientName,
            username: entry.data.username,
            password: entry.data.password,
            role: batch.type === 'teacher' ? 'teacher' : 'student',
            institutionName: 'EAMS Institution',
            portalUrl
          });
          if (emailResult.sent && !emailResult.simulated) emailsDispatched++;
          entry.emailSent = Boolean(emailResult.sent && !emailResult.simulated);
          entry.emailSentAt = new Date();
          entry.emailRecipient = recipientEmail;
        } catch (_) {}
      }

      entry.isVerified = true;
      entry.verifiedAt = new Date();
      entry.verifiedBy = (req.user.name || 'Admin') + ' [BATCH]';

      if (!Array.isArray(batch.verificationAudit)) {
        batch.verificationAudit = [];
      }
      batch.verificationAudit.push({
        rowNumber: entry.rowNumber,
        entityName: recipientName,
        identifier,
        email: recipientEmail || '',
        verifiedBy: (req.user.name || 'Admin') + ' [BATCH]',
        verifiedAt: new Date(),
        ip: req.ip || '',
        userAgent: (req.headers && req.headers['user-agent']) || ''
      });
    }

    batch.verifiedCount = batch.eligibleRows.filter(r => r.isVerified).length;
    await batch.save();

    logAction({
      trackId: `BULK-${batch.batchTrackId || batch.trackId || batch._id}`,
      action: 'BULK_VERIFY_ALL',
      req,
      details: {
        batchId: batch._id,
        type: batch.type,
        processedCount: toProcess.length,
        verifiedCount: batch.verifiedCount,
        emailsDispatched
      }
    }).catch(console.error);

    if (batch.verifiedCount >= batch.eligibleCount) {
      await transition(batch._id, 'verified_all', {
        from: ['sudo_initial_approved', 'verifying'],
        user: req.user
      });
      await transition(batch._id, 'sudo_review', {
        from: ['verified_all'],
        user: req.user
      });
      const existingReview = await M.BulkChatMessage.findOne({
        batchId: batch._id,
        kind: 'card',
        card: 'review'
      }).lean();
      if (!existingReview) {
        await postMessage(batch._id, {
          kind: 'card',
          card: 'review',
          author: 'system',
          actor: req.user,
          payload: { eligibleCount: batch.eligibleCount, type: batch.type }
        });
      }
      try {
        const { notifySudoOnReadyForReview } = require('../../services/bulk/notifications');
        await notifySudoOnReadyForReview(batch);
      } catch (nErr) {
        console.warn('[ReviewRoutes] notifySudoOnReadyForReview error:', nErr.message);
      }
    } else if (batch.status === 'sudo_initial_approved') {
      await transition(batch._id, 'verifying', {
        from: ['sudo_initial_approved'],
        user: req.user
      });
    }

    res.json({
      ok: true,
      processed: toProcess.length,
      emailsDispatched,
      verifiedCount: batch.verifiedCount,
      allVerified: batch.verifiedCount >= batch.eligibleCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 7. DEV BYPASS VERIFY (DEVELOPMENT ONLY - A15) ──
router.post('/batches/:id/dev-bypass-verify', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    const isDev = typeof cfg.isDevServer === 'function' ? cfg.isDevServer() : (process.env.NODE_ENV === 'development');
    if (!isDev) {
      return res.status(403).json({ error: 'VERIFY_ALL_DISABLED', message: 'Dev bypass is only available in development environment' });
    }

    const batch = req.batch;
    if (!['sudo_initial_approved', 'verifying'].includes(batch.status)) {
      return res.status(409).json({ error: `Cannot verify entries in batch status "${batch.status}" — must be sudo_initial_approved or verifying.` });
    }

    let bypassedCount = 0;

    for (const entry of (batch.eligibleRows || [])) {
      if (!entry.isVerified) {
        entry.isVerified = true;
        entry.devBypass = true;
        entry.verifiedBy = (req.user.name || 'Admin') + ' [DEV_BYPASS]';
        entry.emailSent = false;
        entry.notes = 'DEV bypass: skipped confirmation and credential emails';
        bypassedCount++;
      }
    }

    batch.verifiedCount = batch.eligibleRows.length;
    await batch.save();

    await transition(batch._id, 'verified_all', {
      from: ['sudo_initial_approved', 'verifying'],
      user: req.user
    });
    await transition(batch._id, 'sudo_review', {
      from: ['verified_all'],
      user: req.user
    });

    const existingReview = await M.BulkChatMessage.findOne({
      batchId: batch._id,
      kind: 'card',
      card: 'review'
    }).lean();
    if (!existingReview) {
      await postMessage(batch._id, {
        kind: 'card',
        card: 'review',
        author: 'system',
        actor: req.user,
        payload: { eligibleCount: batch.eligibleCount, type: batch.type }
      });
    }
    try {
      const { notifySudoOnReadyForReview } = require('../../services/bulk/notifications');
      await notifySudoOnReadyForReview(batch);
    } catch (nErr) {
      console.warn('[ReviewRoutes] notifySudoOnReadyForReview error:', nErr.message);
    }

    res.json({
      ok: true,
      bypassedCount,
      message: `DEV: Successfully bypassed verification for ${bypassedCount} entries.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 8. SUBMIT FOR FINAL APPROVAL ──
router.post('/batches/:id/submit-final', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    const batch = req.batch;
    if (batch.verifiedCount < batch.eligibleCount && ['student', 'teacher'].includes(batch.type)) {
      return res.status(409).json({
        error: `Cannot submit: Only ${batch.verifiedCount} of ${batch.eligibleCount} records have been verified.`
      });
    }

    await transition(batch, 'pending_final_approval', {
      user: req.user,
      from: ['verified_all', 'sudo_initial_approved']
    });

    await postMessage(batch._id, {
      kind: 'card',
      card: 'final',
      author: 'system',
      payload: { readyForCommit: true }
    });

    notifySudoOnSubmitFinal(batch, req.user);

    res.json({
      ok: true,
      status: 'pending_final_approval',
      message: 'Batch submitted for final Sudo Admin approval and commit.'
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── 9. SUDO APPROVE FINAL & COMMIT TO DATABASE ──
router.post('/batches/:id/approve-final', authMiddleware, requirePage('bulk', 'approve'), loadBatch('sudo'), async (req, res) => {
  try {
    const batch = req.batch;
    if (batch.status === 'committed') {
      return res.status(400).json({ error: 'Batch has already been committed to the live database.' });
    }

    const { runCommitJob } = require('../../services/bulk/commit');

    // Check if synchronous execution requested (e.g. legacy/curl/test)
    if (req.query.sync === 'true' || req.headers['x-sync-commit'] === 'true') {
      await transition(batch, 'committing', {
        user: req.user,
        from: ['pending_final_approval', 'sudo_review', 'verified_all', 'sudo_initial_approved', 'verifying']
      });
      const result = await runCommitJob(batch._id, req.user, {
        ip: req.ip,
        sessionId: req.user.sessionId,
        userAgent: req.headers['user-agent'],
        notes: req.body.notes
      });
      return res.json({
        ok: true,
        message: `Bulk import complete: ${result.addedCount} records committed to database.`,
        addedCount: result.addedCount,
        commitErrors: result.commitErrors,
        backup: result.backup
      });
    }

    // Modern 202 Accepted Async Job (§8.5)
    await transition(batch, 'committing', {
      user: req.user,
      from: ['pending_final_approval', 'sudo_review', 'verified_all', 'sudo_initial_approved', 'verifying'],
      extraSet: {
        finalApproval: {
          approved: true,
          approvedBy: req.user.name || 'Sudo Admin',
          approvedAt: new Date(),
          notes: req.body.notes || 'Final approval and commit executed'
        }
      }
    });

    await postMessage(batch._id, {
      kind: 'card',
      card: 'progress',
      author: 'system',
      payload: { jobKind: 'commit' }
    });

    res.status(202).json({
      ok: true,
      status: 'committing',
      message: 'Commit job started in background'
    });

    setImmediate(() => {
      runCommitJob(batch._id, req.user, {
        ip: req.ip,
        sessionId: req.user.sessionId,
        userAgent: req.headers['user-agent'],
        notes: req.body.notes
      }).catch(err => {
        console.error('[Async runCommitJob Uncaught]:', err);
      });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── 10. RETRY BACKUP TO GOOGLE DRIVE ONLY ──
router.post('/batches/:id/retry-backup', authMiddleware, requirePage('bulk', 'create'), loadBatch('sudo'), async (req, res) => {
  try {
    const { retryBackupOnly } = require('../../services/bulk/commit');
    const backup = await retryBackupOnly(req.batch._id, req.user);
    res.json({ ok: true, backup });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── 7B. ADMIN REVIEW: EDIT ROW ──
router.post('/batches/:id/review/edit-row', authMiddleware, requirePage('bulk', 'approve'), loadBatch('sudo'), async (req, res) => {
  try {
    const batch = req.batch;
    const rowNumber = Number(req.body.rowNumber);
    const updatedData = req.body.updatedData || {};

    const entry = (batch.eligibleRows || []).find(r => r.rowNumber === rowNumber);
    if (!entry) {
      return res.status(404).json({ error: 'ROW_NOT_FOUND', message: `Row ${rowNumber} not found in eligible records` });
    }

    // Lock check: If credentials were mailed, email, username, and password cannot be modified
    const wasMailed = Boolean(entry.emailSent || (entry.mail && entry.mail.mode === 'sent'));
    if (wasMailed) {
      const curData = entry.data || {};
      const changesEmail = updatedData.email !== undefined && updatedData.email !== curData.email;
      const changesUser = updatedData.username !== undefined && updatedData.username !== curData.username;
      const changesPass = updatedData.password !== undefined && updatedData.password !== curData.password;

      if (changesEmail || changesUser || changesPass) {
        return res.status(403).json({
          error: 'ROW_LOCKED_MAILED',
          message: 'Row credentials have already been emailed; email, username, and password cannot be modified.'
        });
      }
    }

    // Validation
    if (updatedData.email !== undefined && updatedData.email !== null) {
      const trimmedEmail = String(updatedData.email).trim().toLowerCase();
      if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        return res.status(400).json({ error: `Invalid email address format: "${updatedData.email}"` });
      }
      updatedData.email = trimmedEmail;
    }

    if (updatedData.username !== undefined && updatedData.username !== null) {
      const u = String(updatedData.username).trim().toLowerCase();
      if (u.length < 3 || !/^[a-z0-9_.-]+$/.test(u)) {
        return res.status(400).json({ error: `Invalid username "${u}". Must be at least 3 characters and alphanumeric.` });
      }
      const existing = await M.User.findOne({ username: u }).lean();
      const currentTrackId = entry.data.trackId || (entry.data.registerNo || entry.data.employeeNo);
      if (existing && existing.trackId && existing.trackId !== currentTrackId && existing.username !== entry.data.username) {
        return res.status(409).json({ error: `Username "${u}" is already in use by an existing ${existing.role} (${existing.trackId}).` });
      }
      updatedData.username = u;
    }

    if (updatedData.fullName) {
      updatedData.fullName = sanitizeFullName(updatedData.fullName);
      const split = splitFirstLastName(updatedData.fullName);
      if (updatedData.firstName) updatedData.firstName = sanitizeFullName(updatedData.firstName);
      else updatedData.firstName = split.firstName;
      if (updatedData.lastName !== undefined && updatedData.lastName !== null && updatedData.lastName !== '') {
        updatedData.lastName = sanitizeFullName(updatedData.lastName);
      } else {
        updatedData.lastName = split.lastName || null;
      }
    }

    const changes = [];
    if (!batch.reviewChanges) batch.reviewChanges = [];
    for (const [key, val] of Object.entries(updatedData)) {
      const oldVal = entry.data[key];
      if (oldVal !== val) {
        changes.push({ field: key, oldValue: oldVal, newValue: val });
        batch.reviewChanges.push({
          action: 'edit',
          rowNumber,
          field: key,
          oldValue: oldVal,
          newValue: val,
          by: req.user.name || 'Sudo Admin',
          at: new Date()
        });
      }
    }

    entry.data = Object.assign({}, entry.data, updatedData);
    entry.isVerified = true;
    batch.markModified('eligibleRows');
    batch.markModified('reviewChanges');
    await batch.save();

    const changesDesc = changes.map(c => `${c.field} ${c.oldValue || 'none'} → ${c.newValue}`).join(', ');
    await postMessage(batch._id, {
      kind: 'event',
      author: 'system',
      actor: req.user,
      payload: {
        text: `${req.user.name || 'Sudo Admin'} (Sudo) edited row ${rowNumber}${changesDesc ? ' · ' + changesDesc : ''}`
      }
    });

    logAction({
      trackId: 'BULK-' + (batch.batchTrackId || batch._id),
      action: 'bulk.review.edit_row',
      userId: req.user._id,
      userRole: req.user.role || 'sudo',
      details: { rowNumber, changes }
    }).catch(() => {});

    res.json({
      ok: true,
      message: `Row ${rowNumber} updated`,
      data: { row: entry, changesCount: batch.reviewChanges.length }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 7C. ADMIN REVIEW: REMOVE ROW ──
router.post('/batches/:id/review/remove-row', authMiddleware, requirePage('bulk', 'approve'), loadBatch('sudo'), async (req, res) => {
  try {
    const batch = req.batch;
    const rowNumber = Number(req.body.rowNumber);
    const reason = String(req.body.reason || '').trim();

    if (!reason || reason.length < 3) {
      return res.status(400).json({ error: 'REASON_REQUIRED', message: 'A reason of at least 3 characters is required to remove a row.' });
    }

    const idx = (batch.eligibleRows || []).findIndex(r => r.rowNumber === rowNumber);
    if (idx === -1) {
      return res.status(404).json({ error: 'ROW_NOT_FOUND', message: `Row ${rowNumber} not found` });
    }
    const entry = batch.eligibleRows[idx];

    // Lock check: If credentials were mailed, row cannot be removed
    const wasMailed = Boolean(entry.emailSent || (entry.mail && entry.mail.mode === 'sent'));
    if (wasMailed) {
      return res.status(403).json({
        error: 'ROW_LOCKED_MAILED',
        message: 'Cannot remove a row whose credentials have already been emailed.'
      });
    }

    batch.eligibleRows.splice(idx, 1);
    if (!batch.removedRows) batch.removedRows = [];
    batch.removedRows.push({
      rowNumber: entry.rowNumber,
      data: entry.data,
      reason,
      removedBy: req.user.name || 'Sudo Admin',
      removedAt: new Date()
    });

    batch.eligibleCount = batch.eligibleRows.length;
    batch.verifiedCount = batch.eligibleRows.filter(r => r.isVerified).length;

    if (!batch.reviewChanges) batch.reviewChanges = [];
    batch.reviewChanges.push({
      action: 'remove',
      rowNumber: entry.rowNumber,
      reason,
      by: req.user.name || 'Sudo Admin',
      at: new Date()
    });

    batch.markModified('eligibleRows');
    batch.markModified('removedRows');
    batch.markModified('reviewChanges');
    await batch.save();

    await postMessage(batch._id, {
      kind: 'event',
      author: 'system',
      actor: req.user,
      payload: {
        text: `${req.user.name || 'Sudo Admin'} (Sudo) removed row ${rowNumber} · reason: ${reason}`
      }
    });

    logAction({
      trackId: 'BULK-' + (batch.batchTrackId || batch._id),
      action: 'bulk.review.remove_row',
      userId: req.user._id,
      userRole: req.user.role || 'sudo',
      details: { rowNumber, reason }
    }).catch(() => {});

    res.json({
      ok: true,
      message: `Row ${rowNumber} removed`,
      data: {
        eligibleCount: batch.eligibleCount,
        verifiedCount: batch.verifiedCount,
        removedCount: batch.removedRows.length
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 7C-2. VERIFICATION DRAWER / UPLOADER: REMOVE / SKIP ROW FROM IMPORTING ──
router.post('/batches/:id/remove-row', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    const batch = req.batch;
    const rowNumber = Number(req.body.rowNumber);
    const reason = String(req.body.reason || 'Skipped from importing').trim();

    const idx = (batch.eligibleRows || []).findIndex(r => r.rowNumber === rowNumber);
    if (idx === -1) {
      return res.status(404).json({ error: 'ROW_NOT_FOUND', message: `Row ${rowNumber} not found` });
    }
    const entry = batch.eligibleRows[idx];

    // Lock check: If credentials were mailed, row cannot be removed
    const wasMailed = Boolean(entry.emailSent || (entry.mail && entry.mail.mode === 'sent'));
    if (wasMailed) {
      return res.status(403).json({
        error: 'ROW_LOCKED_MAILED',
        message: 'Cannot remove a row whose credentials have already been emailed.'
      });
    }

    batch.eligibleRows.splice(idx, 1);
    if (!batch.removedRows) batch.removedRows = [];
    batch.removedRows.push({
      rowNumber: entry.rowNumber,
      data: entry.data,
      reason,
      removedBy: req.user.name || 'User',
      removedAt: new Date()
    });

    batch.eligibleCount = batch.eligibleRows.length;
    batch.verifiedCount = batch.eligibleRows.filter(r => r.isVerified).length;

    batch.markModified('eligibleRows');
    batch.markModified('removedRows');
    await batch.save();

    await postMessage(batch._id, {
      kind: 'event',
      author: 'system',
      actor: req.user,
      payload: {
        text: `${req.user.name || 'User'} skipped row ${rowNumber} from importing`
      }
    });

    if (batch.eligibleRows.length > 0 && batch.verifiedCount >= batch.eligibleCount) {
      await transition(batch._id, 'verified_all', {
        from: ['sudo_initial_approved', 'verifying'],
        user: req.user
      });
      await transition(batch._id, 'sudo_review', {
        from: ['verified_all'],
        user: req.user
      });
      const existingReview = await M.BulkChatMessage.findOne({
        batchId: batch._id,
        kind: 'card',
        card: 'review'
      }).lean();
      if (!existingReview) {
        await postMessage(batch._id, {
          kind: 'card',
          card: 'review',
          author: 'system',
          actor: req.user,
          payload: { eligibleCount: batch.eligibleCount, type: batch.type }
        });
      }
      try {
        const { notifySudoOnReadyForReview } = require('../../services/bulk/notifications');
        await notifySudoOnReadyForReview(batch);
      } catch (nErr) {
        console.warn('[ReviewRoutes] notifySudoOnReadyForReview error:', nErr.message);
      }
    }

    bus.emit(`batch:${batch._id}`, {
      type: 'row_removed',
      data: {
        rowNumber,
        eligibleCount: batch.eligibleCount,
        verifiedCount: batch.verifiedCount
      }
    });

    logAction({
      trackId: 'BULK-' + (batch.batchTrackId || batch._id),
      action: 'bulk.review.remove_row',
      userId: req.user._id,
      userRole: req.user.role || 'user',
      details: { rowNumber, reason }
    }).catch(() => {});

    res.json({
      ok: true,
      message: `Row ${rowNumber} skipped from importing`,
      data: {
        rowNumber,
        eligibleCount: batch.eligibleCount,
        verifiedCount: batch.verifiedCount
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 7D. ADMIN REVIEW: CLEAR OPTIONAL FIELD ──
router.post('/batches/:id/review/clear-field', authMiddleware, requirePage('bulk', 'approve'), loadBatch('sudo'), async (req, res) => {
  try {
    const batch = req.batch;
    const field = String(req.body.field || '').trim();

    const IDENTITY_FIELDS = [
      'username', 'email', 'password', 'trackId', 'registerNo', 'employeeNo',
      'code', 'name', 'fullName', 'firstName', 'deptId', 'classId', 'subjectCode',
      'academicYear', 'batch', 'department'
    ];

    if (!field || IDENTITY_FIELDS.includes(field)) {
      return res.status(400).json({
        error: 'CANNOT_CLEAR_REQUIRED_FIELD',
        message: `Cannot clear field "${field}" — field is required or an identity identifier.`
      });
    }

    let affectedCount = 0;
    for (const r of (batch.eligibleRows || [])) {
      if (r.data && r.data[field] !== undefined && r.data[field] !== null && r.data[field] !== '') {
        r.data[field] = '';
        affectedCount++;
      }
    }

    batch.markModified('eligibleRows');
    if (!batch.reviewChanges) batch.reviewChanges = [];
    batch.reviewChanges.push({
      action: 'clear',
      field,
      affectedCount,
      by: req.user.name || 'Sudo Admin',
      at: new Date()
    });
    batch.markModified('reviewChanges');
    await batch.save();

    await postMessage(batch._id, {
      kind: 'event',
      author: 'system',
      actor: req.user,
      payload: {
        text: `${req.user.name || 'Sudo Admin'} (Sudo) cleared optional field ${field} on ${affectedCount} records`
      }
    });

    logAction({
      trackId: 'BULK-' + (batch.batchTrackId || batch._id),
      action: 'bulk.review.clear_field',
      userId: req.user._id,
      userRole: req.user.role || 'sudo',
      details: { field, affectedCount }
    }).catch(() => {});

    res.json({
      ok: true,
      message: `Cleared ${field} on ${affectedCount} records`,
      data: { field, affectedCount }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 7E. ADMIN REVIEW: CONFIRM & FORWARD TO FINAL APPROVAL ──
router.post('/batches/:id/review/confirm', authMiddleware, requirePage('bulk', 'approve'), loadBatch('sudo'), async (req, res) => {
  try {
    const batch = req.batch;
    await transition(batch, 'pending_final_approval', {
      user: req.user,
      from: ['sudo_review', 'verified_all']
    });

    await postMessage(batch._id, {
      kind: 'card',
      card: 'final',
      author: 'system',
      actor: req.user,
      payload: {
        eligibleCount: batch.eligibleCount,
        verifiedCount: batch.verifiedCount,
        type: batch.type,
        editsCount: (batch.reviewChanges || []).filter(c => c.action === 'edit').length,
        removedCount: (batch.removedRows || []).length
      }
    });

    bus.emit(`batch:${batch._id}`, {
      type: 'status',
      data: { status: 'pending_final_approval' }
    });

    res.json({
      ok: true,
      status: 'pending_final_approval',
      message: 'Admin review completed and submitted for final approval'
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
