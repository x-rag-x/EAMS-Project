const express = require('express');
const router = express.Router();
const JSZip = require('jszip');
const bcrypt = require('@node-rs/bcrypt');
const M = require('../../models');
const cfg = require('../../config');
const { authMiddleware, requirePage } = require('../../middleware/auth');
const { loadBatch, isSudoCaller, toClient } = require('../../services/bulk/access');
const { transition } = require('../../services/bulk/stateMachine');
const { postMessage } = require('../../services/bulk/messages');
const { bus } = require('../../services/bulk/progress');
const { get24HourVerificationCount } = require('./batches.routes');
const { normalizeYearRange, toBatchTrackId, buildStudentTrackId } = require('../../utils/yearFormat');
const { sanitizeFullName, splitFirstLastName } = require('../../utils/nameFormat');
const { logAction } = require('../../utils/logAction');
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

    const isSudo = isSudoCaller(req.user);
    if (isSudo) {
      // Sudo uploader automatically advances past initial review
      const isAutoVerified = ['dept', 'class', 'subject'].includes(batch.type);
      const nextStatus = isAutoVerified ? 'verified_all' : 'sudo_initial_approved';

      await transition(batch, nextStatus, {
        user: req.user,
        from: ['staged', 'skipped_resolved'],
        details: { autoApproved: true }
      });

      await postMessage(batch._id, {
        kind: 'card',
        card: isAutoVerified ? 'final' : 'verify',
        author: 'system',
        payload: { autoApproved: true, type: batch.type }
      });

      return res.json({
        ok: true,
        status: nextStatus,
        message: 'Auto-approved for verification (uploaded by Sudo)'
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
    const isAutoVerified = ['dept', 'class', 'subject'].includes(batch.type);
    const targetStatus = isAutoVerified ? 'verified_all' : 'sudo_initial_approved';

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
      card: isAutoVerified ? 'final' : 'verify',
      author: 'system',
      actor: req.user,
      payload: { approved: true, notes: approvalData.notes, type: batch.type }
    });

    notifyUploaderOnDecision(batch, 'approved for initial verification', approvalData.notes, req.user);

    res.json({
      ok: true,
      status: targetStatus,
      message: isAutoVerified
        ? 'Batch approved — ready for final commit.'
        : 'Batch approved — verification panel is now open.'
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

    // 24-HOUR RATE LIMIT CHECK (Max 500 entries in 24 hours for student/teacher)
    if (['student', 'teacher'].includes(batch.type) && !entry.isVerified) {
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

    // Generate random temporary password if neither uploaded nor entered
    if (!entry.data.password || !String(entry.data.password).trim()) {
      entry.data.password = generateTempPassword(batch.type);
    }

    // Send Credentials Email only if not sent yet or explicit resend requested (A14)
    const recipientEmail = entry.data.email;
    const recipientName = entry.data.fullName || entry.data.name;
    const username = entry.data.username;
    const password = entry.data.password;

    let emailResult = { sent: false, simulated: true };
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
    }

    entry.isVerified = true;
    entry.verifiedAt = new Date();
    entry.verifiedBy = req.user.name || 'Staff';

    // Record in verification audit log
    batch.verificationAudit.push({
      rowNumber,
      entityName: recipientName,
      identifier: entry.data.registerNo || entry.data.employeeNo || username,
      email: recipientEmail,
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
      const existingFinal = await M.BulkChatMessage.findOne({
        batchId: batch._id,
        kind: 'card',
        card: 'final'
      }).lean();
      if (!existingFinal) {
        await postMessage(batch._id, {
          kind: 'card',
          card: 'final',
          author: 'system',
          actor: req.user,
          payload: { eligibleCount: batch.eligibleCount, type: batch.type }
        });
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
      emailSent: entry.emailSent
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 6. VERIFY ALL REMAINING ENTRIES (WITH 500/24h LIMIT) ──
router.post('/batches/:id/verify-all', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
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
      const existingFinal = await M.BulkChatMessage.findOne({
        batchId: batch._id,
        kind: 'card',
        card: 'final'
      }).lean();
      if (!existingFinal) {
        await postMessage(batch._id, {
          kind: 'card',
          card: 'final',
          author: 'system',
          actor: req.user,
          payload: { eligibleCount: batch.eligibleCount, type: batch.type }
        });
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
    const isDev = process.env.NODE_ENV === 'development' || cfg.NODE_ENV === 'development';
    if (!isDev) {
      return res.status(403).json({ error: 'Dev bypass is only available in development environment' });
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

    const existingFinal = await M.BulkChatMessage.findOne({
      batchId: batch._id,
      kind: 'card',
      card: 'final'
    }).lean();
    if (!existingFinal) {
      await postMessage(batch._id, {
        kind: 'card',
        card: 'final',
        author: 'system',
        actor: req.user,
        payload: { eligibleCount: batch.eligibleCount, type: batch.type }
      });
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
        from: ['pending_final_approval', 'verified_all']
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
      from: ['pending_final_approval', 'verified_all'],
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

module.exports = router;
