const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cfg = require('../config');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { getSettings } = require('../utils/settingsCache');
const { isSudo, isSuperAdminForDept } = require('../utils/access');
const { todayInInstitutionTz, getStartOfInstitutionDaySync } = require('../utils/institutionTime');
const {
  deviceTicketGenerateLimiter,
  deviceClaimIpLimiter,
  deviceVerifyLimiter
} = require('../utils/rateLimiters');

// Lookalike-free uppercase charset (§5: ABCDEFGHJKLMNPQRSTUVWXYZ23456789)
const CREDENTIAL_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generate12CharCredential() {
  const bytes = crypto.randomBytes(12);
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += CREDENTIAL_CHARSET[bytes[i] % CREDENTIAL_CHARSET.length];
  }
  // Formatted as XXXX-XXXX-XXXX for readable display
  return {
    raw: result,
    formatted: `${result.slice(0, 4)}-${result.slice(4, 8)}-${result.slice(8, 12)}`
  };
}

function sha256(str) {
  return crypto.createHash('sha256').update(String(str || '')).digest('hex');
}

/**
 * Checks if user is authorized to manage devices for a given class/dept
 */
async function canManageClass(req, classDoc) {
  if (isSudo(req)) return { allowed: true, role: 'sudo' };

  const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
  const deptId = classDoc.deptId ? classDoc.deptId.toString() : '';

  // Super Admin for that department
  if (isSuperAdminForDept(req.user, deptId)) {
    return { allowed: true, role: 'superAdmin' };
  }

  // Class Advisor
  const isAdvisorId = classDoc.advisorTeacherId && classDoc.advisorTeacherId.toString() === req.user._id.toString();
  const isAdvisorTrack = classDoc.advisorTeacherTrackId && classDoc.advisorTeacherTrackId === req.user.trackId;
  const hasAdvisorSpecial = specials.some(s => s && s.option === 'isClassAdvisor' && (s.key === classDoc.trackId || s.key === classDoc.name || s.value !== false));

  // Check Acting Advisor role if any
  let isActingAdvisor = false;
  if (!isAdvisorId && !isAdvisorTrack) {
    const today = await todayInInstitutionTz();
    const actingDoc = await M.ActingRole.findOne({
      holderTrackId: req.user.trackId,
      role: 'classAdvisor',
      key: classDoc.trackId || String(classDoc._id),
      status: { $in: ['active', 'pending'] },
      from: { $lte: today },
      to: { $gte: today }
    }).lean();
    if (actingDoc) isActingAdvisor = true;
  }

  if (isAdvisorId || isAdvisorTrack || hasAdvisorSpecial || isActingAdvisor) {
    return { allowed: true, role: 'advisor' };
  }

  return { allowed: false };
}

/**
 * Checks if a registration window is currently open for the department or class
 */
async function isRegistrationWindowOpen(deptId, classId) {
  const now = new Date();
  const orConditions = [];
  if (deptId) {
    orConditions.push({ scope: 'department', deptId: deptId });
  }
  orConditions.push({ scope: 'department', deptId: null });
  if (classId) {
    orConditions.push({ scope: 'class', classId: classId });
  }
  const query = {
    active: true,
    from: { $lte: now },
    to: { $gte: now },
    $or: orConditions
  };
  const windowDoc = await M.RegistrationWindow.findOne(query).lean();
  return !!windowDoc;
}

// ─────────────────────────────────────────────────────────
//  1. ADVISOR CLASSES LIST
// ─────────────────────────────────────────────────────────
router.get('/advisor-classes', authMiddleware, async (req, res) => {
  try {
    let classes = [];
    const isSudoUser = isSudo(req);
    const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
    const isSuper = specials.some(s => s && s.option === 'isAdmin' && s.value !== false);

    if (isSudoUser) {
      classes = await M.Class.find({}).sort({ deptName: 1, name: 1 }).lean();
    } else if (isSuper && req.user.deptId) {
      classes = await M.Class.find({ deptId: req.user.deptId }).sort({ name: 1 }).lean();
    } else {
      // Find classes where teacher is advisor
      classes = await M.Class.find({
        $or: [
          { advisorTeacherId: req.user._id },
          { advisorTeacherTrackId: req.user.trackId }
        ]
      }).sort({ name: 1 }).lean();
    }

    // Attach registration window open status
    const classResults = await Promise.all(classes.map(async (c) => {
      const windowOpen = await isRegistrationWindowOpen(c.deptId, c._id);
      const studentCount = await M.Student.countDocuments({ classId: c._id });
      const trustedCount = await M.StudentDevice.countDocuments({ classId: c._id, status: 'TRUSTED' });
      return {
        _id: c._id,
        name: c.name,
        deptId: c.deptId,
        deptName: c.deptName,
        deptCode: c.deptCode,
        batch: c.batch,
        section: c.section,
        studentCount,
        trustedCount,
        windowOpen
      };
    }));

    // If teacher/advisor (not sudo, not super admin): only return classes where window is open.
    // If no window is open, access is denied (0 access).
    if (!isSudoUser && !isSuper) {
      const openClasses = classResults.filter(c => c.windowOpen);
      if (openClasses.length === 0) {
        return res.status(403).json({
          error: 'Registration window is closed. Access denied.',
          code: 'WINDOW_CLOSED',
          classes: [],
          isAdvisor: classResults.length > 0,
          isAdmin: false
        });
      }
      return res.json({
        ok: true,
        classes: openClasses,
        isAdvisor: true,
        isAdmin: false
      });
    }

    return res.json({
      ok: true,
      classes: classResults,
      isAdvisor: classResults.length > 0,
      isAdmin: isSudoUser || isSuper
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
//  2. CLASS STUDENTS WITH DEVICE REGISTRATION STATUS
// ─────────────────────────────────────────────────────────
router.get('/classes/:classId/students', authMiddleware, async (req, res) => {
  try {
    const classDoc = await M.Class.findById(req.params.classId).lean();
    if (!classDoc) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const authCheck = await canManageClass(req, classDoc);
    if (!authCheck.allowed) {
      return res.status(403).json({ error: 'Access denied: You are not authorized to view device records for this class.' });
    }

    const windowOpen = await isRegistrationWindowOpen(classDoc.deptId, classDoc._id);
    if (authCheck.role === 'advisor' && !windowOpen) {
      return res.status(403).json({
        error: 'Registration window is closed. Access denied.',
        code: 'WINDOW_CLOSED'
      });
    }
    const students = await M.Student.find({ classId: classDoc._id })
      .select('fullName registerNo rollNo trackId username deptId classId')
      .sort({ registerNo: 1, fullName: 1 })
      .lean();

    const studentIds = students.map(s => s._id);

    // Active devices
    const devices = await M.StudentDevice.find({
      studentId: { $in: studentIds }
    }).lean();

    // Active tickets
    const now = new Date();
    const tickets = await M.DeviceRegistrationTicket.find({
      studentId: { $in: studentIds },
      stage: { $in: ['ISSUED', 'CLAIMED', 'CODE_SHOWN'] },
      expiresAt: { $gt: now }
    }).lean();

    const deviceMap = {};
    devices.forEach(d => {
      // Prioritize TRUSTED device
      if (!deviceMap[d.studentId.toString()] || d.status === 'TRUSTED') {
        deviceMap[d.studentId.toString()] = d;
      }
    });

    const ticketMap = {};
    tickets.forEach(t => {
      ticketMap[t.studentId.toString()] = t;
    });

    const result = students.map(s => {
      const dev = deviceMap[s._id.toString()] || null;
      const tkt = ticketMap[s._id.toString()] || null;
      return {
        _id: s._id,
        trackId: s.trackId,
        fullName: s.fullName,
        registerNo: s.registerNo,
        rollNo: s.rollNo,
        username: s.username,
        deviceStatus: dev ? dev.status : 'NO_DEVICE',
        device: dev ? {
          deviceTrackId: dev.deviceTrackId,
          status: dev.status,
          model: dev.info?.model || 'Mobile Device',
          browser: dev.info?.browser || '',
          os: dev.info?.os || '',
          verifiedAt: dev.verifiedAt,
          lastSeenAt: dev.lastSeenAt
        } : null,
        activeTicket: tkt ? {
          ticketId: tkt.ticketId,
          stage: tkt.stage,
          kind: tkt.kind,
          expiresAt: tkt.expiresAt,
          attempts: tkt.attempts,
          verifyAttempts: tkt.verifyAttempts
        } : null
      };
    });

    return res.json({
      ok: true,
      class: {
        _id: classDoc._id,
        name: classDoc.name,
        deptName: classDoc.deptName
      },
      windowOpen,
      students: result
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
//  3. ISSUE REGISTRATION TICKET (§5, T1.1)
// ─────────────────────────────────────────────────────────
router.post('/tickets', authMiddleware, deviceTicketGenerateLimiter, async (req, res) => {
  try {
    const { studentId, kind = 'new' } = req.body;
    if (!studentId) {
      return res.status(400).json({ error: 'studentId is required' });
    }

    const student = await M.Student.findById(studentId).lean();
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const classDoc = await M.Class.findById(student.classId).lean();
    if (!classDoc) {
      return res.status(404).json({ error: 'Student class not found' });
    }

    const authCheck = await canManageClass(req, classDoc);
    if (!authCheck.allowed) {
      return res.status(403).json({ error: 'Access denied: You are not authorized to issue tickets for this student.' });
    }

    // Window check: Advisor requires open window; Super Admin / Sudo can issue any time (§5)
    const windowOpen = await isRegistrationWindowOpen(student.deptId, student.classId);
    if (authCheck.role === 'advisor' && !windowOpen) {
      return res.status(403).json({
        ok: false,
        outsideWindow: true,
        error: 'Registration window is closed. Please send request to Department Super Admin.'
      });
    }

    // Check if student already has a TRUSTED device
    const existingTrusted = await M.StudentDevice.findOne({
      studentId: student._id,
      status: 'TRUSTED'
    }).lean();

    if (existingTrusted && kind !== 'replacement') {
      return res.status(400).json({
        error: `Student already has an active trusted device (${existingTrusted.deviceTrackId}). Please use the device replacement workflow.`,
        hasTrustedDevice: true,
        deviceTrackId: existingTrusted.deviceTrackId
      });
    }

    // Cancel any previous live tickets for this student
    await M.DeviceRegistrationTicket.updateMany(
      {
        studentId: student._id,
        stage: { $in: ['ISSUED', 'CLAIMED', 'CODE_SHOWN'] }
      },
      { $set: { stage: 'CANCELLED' } }
    );

    // Read settings
    const settingsMap = await getSettings(['device']);
    const devCfg = settingsMap?.device || {};
    const credTtlMin = devCfg.credentialTtlMin || 10;
    const maxAttempts = devCfg.credentialMaxAttempts || 5;

    // Generate 12-character credential
    const cred = generate12CharCredential();
    const credHash = sha256(cred.raw);
    const ticketId = 'TKT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + credTtlMin * 60 * 1000);

    const ticket = await M.DeviceRegistrationTicket.create({
      ticketId,
      studentId: student._id,
      studentTrackId: student.trackId,
      deptId: student.deptId,
      classId: student.classId,
      issuedBy: {
        trackId: req.user.trackId || req.user.username,
        name: req.user.name || req.user.fullName || 'Class Advisor',
        role: authCheck.role
      },
      kind: kind === 'replacement' ? 'replacement' : 'new',
      credentialHash: credHash,
      expiresAt,
      maxAttempts,
      stage: 'ISSUED'
    });

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username,
      req.user.role,
      'Registration Ticket Issued',
      `Issued 12-char device registration ticket "${ticketId}" for ${student.fullName} (${student.registerNo})`,
      'device',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'device',
        subType: 'ticket-issued',
        ticketId,
        studentTrackId: student.trackId,
        kind: ticket.kind
      }
    );

    return res.json({
      ok: true,
      ticketId,
      credential: cred.formatted,
      rawCredential: cred.raw,
      username: student.username,
      studentName: student.fullName,
      registerNo: student.registerNo,
      expiresAt,
      expiresInSec: credTtlMin * 60
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
//  4. CANCEL REGISTRATION TICKET
// ─────────────────────────────────────────────────────────
router.post('/tickets/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const ticket = await M.DeviceRegistrationTicket.findOne({
      $or: [{ ticketId: req.params.id }, { _id: req.params.id }]
    });
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const isSudoUser = isSudo(req);
    const isSuper = isSuperAdminForDept(req.user, ticket.deptId);
    if (!isSudoUser && !isSuper) {
      const windowOpen = await isRegistrationWindowOpen(ticket.deptId, ticket.classId);
      if (!windowOpen) {
        return res.status(403).json({
          error: 'Registration window is closed. Access denied.',
          code: 'WINDOW_CLOSED'
        });
      }
    }

    ticket.stage = 'CANCELLED';
    await ticket.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username,
      req.user.role,
      'Registration Ticket Cancelled',
      `Registration ticket "${ticket.ticketId}" cancelled by ${req.user.name || req.user.username}`,
      'device',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'device', subType: 'ticket-cancelled', ticketId: ticket.ticketId }
    );

    return res.json({ ok: true, message: 'Ticket cancelled' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
//  5. SUBMIT PUBLIC KEY & INFO (Phone with regToken §5, T1.1)
// ─────────────────────────────────────────────────────────
router.post('/register/key', deviceClaimIpLimiter, async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : req.body.regToken;

    if (!token) {
      return res.status(401).json({ error: 'Registration token required', code: 'UNAUTHORIZED' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, cfg.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired registration token', code: 'TOKEN_EXPIRED' });
    }

    if (decoded.type !== 'device_registration' || !decoded.ticketId) {
      return res.status(403).json({ error: 'Invalid registration token payload', code: 'FORBIDDEN' });
    }

    const ticket = await M.DeviceRegistrationTicket.findOne({ ticketId: decoded.ticketId });
    if (!ticket) {
      return res.status(404).json({ error: 'Registration ticket not found' });
    }

    if (!['CLAIMED', 'ISSUED', 'CODE_SHOWN'].includes(ticket.stage)) {
      return res.status(400).json({ error: `Ticket cannot accept keys in stage "${ticket.stage}"` });
    }

    if (new Date() > new Date(ticket.expiresAt)) {
      ticket.stage = 'EXPIRED';
      await ticket.save();
      return res.status(410).json({ error: 'Registration ticket has expired' });
    }

    const { publicKeyJwk, installId, fingerprintHash, info = {}, storedKeyThumbprints = [] } = req.body;

    if (!publicKeyJwk || !installId) {
      return res.status(400).json({ error: 'publicKeyJwk and installId are required' });
    }

    // Compute key thumbprint
    const keyThumbprint = sha256(JSON.stringify({
      crv: publicKeyJwk.crv,
      kty: publicKeyJwk.kty,
      x: publicKeyJwk.x,
      y: publicKeyJwk.y
    }));

    // ── Check Sharing Signals (§13 Friend-Marking Detection) ──
    // Signal 1: Does installId match another student's TRUSTED device?
    const installConflict = await M.StudentDevice.findOne({
      installId: installId.trim(),
      status: 'TRUSTED',
      studentId: { $ne: ticket.studentId }
    }).lean();

    // Signal 2: Does any stored key thumbprint match another student's TRUSTED device?
    const keyConflict = (Array.isArray(storedKeyThumbprints) && storedKeyThumbprints.length > 0)
      ? await M.StudentDevice.findOne({
          keyThumbprint: { $in: storedKeyThumbprints },
          status: 'TRUSTED',
          studentId: { $ne: ticket.studentId }
        }).lean()
      : null;

    if (installConflict || keyConflict) {
      // Shared device detected! Block registration (§13)
      ticket.stage = 'CANCELLED';
      await ticket.save();

      const conflictingDevice = installConflict || keyConflict;

      // Open DeviceShareCase (§13, T7.1, T7.2)
      try {
        const studentA = await M.Student.findById(ticket.studentId).lean();
        const studentB = await M.Student.findById(conflictingDevice.studentId).lean();
        const deptId = studentA?.deptId || studentB?.deptId || ticket.deptId;

        const existingCase = await M.DeviceShareCase.findOne({
          'students.studentId': { $all: [ticket.studentId, conflictingDevice.studentId] },
          status: 'OPEN'
        });

        if (!existingCase && deptId) {
          await M.DeviceShareCase.create({
            students: [
              {
                studentId: ticket.studentId,
                studentTrackId: ticket.studentTrackId,
                studentName: studentA?.fullName || studentA?.name || 'Student A',
                regNo: studentA?.registerNo || '',
                deptId: studentA?.deptId,
                classId: studentA?.classId
              },
              {
                studentId: conflictingDevice.studentId,
                studentTrackId: conflictingDevice.studentTrackId,
                studentName: studentB?.fullName || studentB?.name || 'Student B',
                regNo: studentB?.registerNo || '',
                deptId: studentB?.deptId,
                classId: studentB?.classId
              }
            ],
            deptId: deptId,
            detectionSource: 'REGISTRATION',
            signals: {
              installId: installId,
              keyThumbprint: keyThumbprint,
              fingerprint: fingerprintHash || '',
              ip: req.ip,
              details: `Registration collision: installMatch=${Boolean(installConflict)}, keyMatch=${Boolean(keyConflict)}`
            },
            status: 'OPEN'
          });
        }
      } catch (caseErr) {
        console.warn('[DeviceShareCase Registration Warning]:', caseErr.message);
      }

      await logAction(
        ticket.studentTrackId,
        'Student Phone',
        'student',
        'Friend-Marking Detected at Registration',
        `Phone install ID ${installId} or key thumbprint already bound to student track ID ${conflictingDevice.studentTrackId}`,
        'security',
        'warning',
        req.ip,
        '',
        {
          module: 'device',
          subType: 'device-share-attempt',
          studentTrackId: ticket.studentTrackId,
          conflictingStudentTrackId: conflictingDevice.studentTrackId
        }
      );

      return res.status(409).json({
        error: 'This phone is already registered to another student. Your advisor has been informed.',
        code: 'DEVICE_ALREADY_REGISTERED'
      });
    }

    // Generate 6-digit numeric verification code
    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verifyCodeHash = sha256(verifyCode);
    const verifyExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

    // Create or update pending device
    let deviceTrackId = ticket.deviceTrackId;
    if (!deviceTrackId) {
      deviceTrackId = 'DV-' + crypto.randomBytes(5).toString('hex').toUpperCase();
    }

    await M.StudentDevice.findOneAndUpdate(
      { deviceTrackId },
      {
        $set: {
          deviceTrackId,
          studentId: ticket.studentId,
          studentTrackId: ticket.studentTrackId,
          deptId: ticket.deptId,
          classId: ticket.classId,
          status: 'PENDING',
          publicKeyJwk,
          keyThumbprint,
          installId: installId.trim(),
          fingerprintHash: fingerprintHash || '',
          info: {
            ua: info.ua || '',
            browser: info.browser || '',
            os: info.os || '',
            osVersion: info.osVersion || '',
            model: info.model || '',
            mobile: !!info.mobile,
            screen: info.screen || '',
            tz: info.tz || '',
            lang: info.lang || '',
            pwa: !!info.pwa
          },
          ticketId: ticket.ticketId,
          lastIp: req.ip
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    // Update ticket
    ticket.stage = 'CODE_SHOWN';
    ticket.deviceTrackId = deviceTrackId;
    ticket.verifyCodeHash = verifyCodeHash;
    ticket.verifyExpiresAt = verifyExpiresAt;
    ticket.verifyAttempts = 0;
    await ticket.save();

    await logAction(
      ticket.studentTrackId,
      'Student Phone',
      'student',
      'Registration Code Displayed',
      `Device key received for ticket "${ticket.ticketId}". 6-digit code displayed on phone.`,
      'device',
      'info',
      req.ip,
      '',
      { module: 'device', subType: 'code-shown', ticketId: ticket.ticketId, deviceTrackId }
    );

    return res.json({
      ok: true,
      verifyCode,
      deviceTrackId,
      verifyExpiresAt,
      expiresInSec: 300
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
//  6. POLL REGISTRATION STATUS (Phone polling §5)
// ─────────────────────────────────────────────────────────
router.get('/register/status', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : req.query.regToken;

    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, cfg.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const ticket = await M.DeviceRegistrationTicket.findOne({ ticketId: decoded.ticketId }).lean();
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    if (ticket.stage === 'VERIFIED') {
      return res.json({
        ok: true,
        stage: 'VERIFIED',
        verified: true,
        deviceTrackId: ticket.deviceTrackId,
        message: 'Phone registered and verified successfully!'
      });
    }

    if (['LOCKED', 'CANCELLED', 'EXPIRED'].includes(ticket.stage)) {
      return res.status(400).json({
        ok: false,
        stage: ticket.stage,
        verified: false,
        error: `Registration ${ticket.stage.toLowerCase()}`
      });
    }

    return res.json({
      ok: true,
      stage: ticket.stage,
      verified: false
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
//  7. ADVISOR VERIFIES 6-DIGIT CODE (§5, T1.1)
// ─────────────────────────────────────────────────────────
router.post('/tickets/:id/verify', authMiddleware, deviceVerifyLimiter, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: '6-digit verification code is required' });
    }

    const ticket = await M.DeviceRegistrationTicket.findOne({
      $or: [{ ticketId: req.params.id }, { _id: req.params.id }]
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Registration ticket not found' });
    }

    const isSudoUser = isSudo(req);
    const isSuper = isSuperAdminForDept(req.user, ticket.deptId);
    if (!isSudoUser && !isSuper) {
      const windowOpen = await isRegistrationWindowOpen(ticket.deptId, ticket.classId);
      if (!windowOpen) {
        return res.status(403).json({
          error: 'Registration window is closed. Access denied.',
          code: 'WINDOW_CLOSED'
        });
      }
    }

    if (ticket.stage !== 'CODE_SHOWN') {
      return res.status(400).json({
        error: `Cannot verify ticket in stage "${ticket.stage}". Phone must first claim and submit public key.`
      });
    }

    if (new Date() > new Date(ticket.verifyExpiresAt)) {
      ticket.stage = 'EXPIRED';
      await ticket.save();
      return res.status(410).json({ error: 'Verification code has expired. Please generate a new ticket.' });
    }

    const maxVerifyAttempts = ticket.verifyMaxAttempts || 3;
    if (ticket.verifyAttempts >= maxVerifyAttempts) {
      ticket.stage = 'LOCKED';
      await ticket.save();
      return res.status(403).json({ error: 'Too many incorrect verification attempts. Ticket locked.' });
    }

    const inputHash = sha256(String(code).trim());
    if (inputHash !== ticket.verifyCodeHash) {
      ticket.verifyAttempts = (ticket.verifyAttempts || 0) + 1;
      if (ticket.verifyAttempts >= maxVerifyAttempts) {
        ticket.stage = 'LOCKED';
      }
      await ticket.save();

      const remaining = Math.max(0, maxVerifyAttempts - ticket.verifyAttempts);
      return res.status(400).json({
        error: `Invalid verification code. Attempts remaining: ${remaining}`,
        attemptsRemaining: remaining
      });
    }

    // MATCH! Mark ticket verified
    const now = new Date();
    ticket.stage = 'VERIFIED';
    ticket.usedAt = now;
    await ticket.save();

    // Activate device
    const pendingDevice = await M.StudentDevice.findOne({ deviceTrackId: ticket.deviceTrackId });
    if (!pendingDevice) {
      return res.status(500).json({ error: 'Pending device record not found' });
    }

    // If replacement ticket, mark old trusted device as REPLACED and revoke sessions (§6, §14, T3.4)
    if (ticket.kind === 'replacement') {
      const oldDevs = await M.StudentDevice.find({
        studentId: ticket.studentId,
        status: 'TRUSTED',
        deviceTrackId: { $ne: pendingDevice.deviceTrackId }
      }).select('deviceTrackId').lean();

      await M.StudentDevice.updateMany(
        {
          studentId: ticket.studentId,
          status: 'TRUSTED',
          deviceTrackId: { $ne: pendingDevice.deviceTrackId }
        },
        {
          $set: {
            status: 'REPLACED',
            replacedBy: pendingDevice.deviceTrackId,
            revokedAt: now,
            revokedBy: {
              trackId: req.user.trackId || req.user.username,
              name: req.user.name || req.user.fullName || 'Class Advisor'
            },
            revokeReason: 'Replaced with new registered device'
          }
        }
      );

      const oldTrackIds = oldDevs.map(d => d.deviceTrackId).filter(Boolean);
      if (oldTrackIds.length) {
        await M.LoginSession.updateMany(
          { deviceTrackId: { $in: oldTrackIds }, active: true },
          { $set: { active: false, logoutAt: now, logoutMethod: 'forced' } }
        );
      }
    }

    pendingDevice.status = 'TRUSTED';
    pendingDevice.verifiedAt = now;
    pendingDevice.lastSeenAt = now;
    pendingDevice.registeredBy = {
      trackId: req.user.trackId || req.user.username,
      name: req.user.name || req.user.fullName || 'Class Advisor'
    };
    await pendingDevice.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username,
      req.user.role,
      'Device Registered & Trusted',
      `Device "${pendingDevice.deviceTrackId}" verified and marked TRUSTED for student track ID ${ticket.studentTrackId}`,
      'device',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'device',
        subType: 'device-verified',
        ticketId: ticket.ticketId,
        deviceTrackId: pendingDevice.deviceTrackId,
        studentTrackId: ticket.studentTrackId
      }
    );

    return res.json({
      ok: true,
      message: 'Device verified and trusted successfully!',
      deviceTrackId: pendingDevice.deviceTrackId
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
//  8. QUEUE REQUEST OUTSIDE WINDOW (Send to Super Admin §5)
// ─────────────────────────────────────────────────────────
router.post('/queue-request', authMiddleware, async (req, res) => {
  try {
    const { studentId, reason = 'Outside registration window' } = req.body;
    const student = await M.Student.findById(studentId).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const isSudoUser = isSudo(req);
    const isSuper = isSuperAdminForDept(req.user, student.deptId);
    if (!isSudoUser && !isSuper) {
      return res.status(403).json({
        error: 'Registration window is closed. Access denied.',
        code: 'WINDOW_CLOSED'
      });
    }

    const requestId = 'REQ-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    await M.DeviceReplacementRequest.create({
      requestId,
      studentId: student._id,
      studentTrackId: student.trackId,
      deptId: student.deptId,
      classId: student.classId,
      type: 'outside_window',
      reason: 'outside_window',
      note: reason,
      status: 'FORWARDED_TO_ADMIN',
      reviewedByAdvisor: {
        trackId: req.user.trackId || req.user.username,
        name: req.user.name || req.user.fullName || 'Class Advisor',
        at: new Date(),
        note: reason
      }
    });

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username,
      req.user.role,
      'Device Registration Queued for Super Admin',
      `Registration for ${student.fullName} (${student.registerNo}) forwarded to Department Super Admin. Reason: ${reason}`,
      'device',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'device',
        subType: 'queue-request',
        requestId,
        studentTrackId: student.trackId,
        deptId: student.deptId
      }
    );

    return res.json({
      ok: true,
      requestId,
      message: 'Registration request successfully queued for Department Super Admin approval.'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
//  9. REGISTRATION WINDOWS CRUD (§11, T1.5)
// ─────────────────────────────────────────────────────────
router.get('/windows', authMiddleware, async (req, res) => {
  try {
    const filter = { active: true };
    if (!isSudo(req) && req.user.deptId) {
      filter.$or = [{ deptId: req.user.deptId }, { deptId: null }];
    }
    const windows = await M.RegistrationWindow.find(filter)
      .populate('deptId', 'name code')
      .populate('classId', 'name batch section')
      .sort({ to: -1 })
      .lean();
    return res.json({ ok: true, windows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/windows', authMiddleware, async (req, res) => {
  try {
    const isSudoUser = isSudo(req);
    const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
    const isSuper = specials.some(s => s && s.option === 'isAdmin' && s.value !== false);

    if (!isSudoUser && !isSuper) {
      return res.status(403).json({ error: 'Only Super Admin or Sudo can create registration windows' });
    }

    const { scope, deptId, classId, from, to, note = '' } = req.body;
    if (!scope || !from || !to) {
      return res.status(400).json({ error: 'scope, from, and to dates are required' });
    }

    const windowTrackId = 'RW-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const targetDeptId = isSudoUser ? (deptId || null) : req.user.deptId;

    const windowDoc = await M.RegistrationWindow.create({
      windowTrackId,
      scope: scope === 'class' ? 'class' : 'department',
      deptId: targetDeptId,
      classId: scope === 'class' ? classId : null,
      from: new Date(from),
      to: new Date(to),
      createdBy: {
        trackId: req.user.trackId || req.user.username,
        name: req.user.name || req.user.fullName || 'Admin'
      },
      note,
      active: true
    });

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username,
      req.user.role,
      'Registration Window Created',
      `Created registration window "${windowTrackId}" (${scope}) from ${from} to ${to}`,
      'device',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'device', subType: 'window-created', windowTrackId }
    );

    return res.json({ ok: true, window: windowDoc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/windows/:id', authMiddleware, async (req, res) => {
  try {
    const isSudoUser = isSudo(req);
    const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
    const isSuper = specials.some(s => s && s.option === 'isAdmin' && s.value !== false);

    if (!isSudoUser && !isSuper) {
      return res.status(403).json({ error: 'Only Super Admin or Sudo can close registration windows' });
    }

    const windowDoc = await M.RegistrationWindow.findOneAndUpdate(
      { $or: [{ windowTrackId: req.params.id }, { _id: req.params.id }] },
      { $set: { active: false } },
      { returnDocument: 'after' }
    );

    if (!windowDoc) {
      return res.status(404).json({ error: 'Registration window not found' });
    }

    return res.json({ ok: true, message: 'Registration window closed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
//  10. REVOKE DEVICE (§14, §16, T3.4)
// ─────────────────────────────────────────────────────────
router.post('/:id/revoke', authMiddleware, async (req, res) => {
  try {
    const isSudoUser = isSudo(req);
    const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
    const isSuper = specials.some(s => s && s.option === 'isAdmin' && s.value !== false);

    if (!isSudoUser && !isSuper) {
      return res.status(403).json({ error: 'Only Department Super Admin or Sudo can revoke registered devices' });
    }

    const { reason = 'Revoked by administrator' } = req.body;
    const device = await M.StudentDevice.findOne({
      $or: [{ deviceTrackId: req.params.id }, { _id: req.params.id }]
    });

    if (!device) {
      return res.status(404).json({ error: 'Device record not found' });
    }

    // Department scope check for Super Admin
    if (!isSudoUser && req.user.deptId && device.deptId && String(device.deptId) !== String(req.user.deptId)) {
      return res.status(403).json({ error: 'Cannot revoke device belonging to another department' });
    }

    const now = new Date();
    device.status = 'REVOKED';
    device.revokedAt = now;
    device.revokedBy = {
      trackId: req.user.trackId || req.user.username,
      name: req.user.name || req.user.fullName || 'Admin'
    };
    device.revokeReason = reason;
    await device.save();

    // T3.4: Revoke all active sessions on this device immediately
    await M.LoginSession.updateMany(
      { deviceTrackId: device.deviceTrackId, active: true },
      { $set: { active: false, logoutAt: now, logoutMethod: 'forced' } }
    );

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username,
      req.user.role,
      'Device Revoked',
      `Device "${device.deviceTrackId}" for student ${device.studentTrackId} revoked by ${req.user.name || req.user.username}. Reason: ${reason}`,
      'device',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'device', subType: 'device-revoked', deviceTrackId: device.deviceTrackId, studentTrackId: device.studentTrackId }
    );

    return res.json({
      ok: true,
      message: 'Device revoked and active sessions terminated',
      deviceTrackId: device.deviceTrackId
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
//  11. LIST REGISTERED DEVICES REGISTRY (§11, §16)
// ─────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const isSudoUser = isSudo(req);
    const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
    const isSuper = specials.some(s => s && s.option === 'isAdmin' && s.value !== false);
    const isAdvisor = req.user.role === 'teacher' && specials.some(s => s.option === 'isClassAdvisor');

    const query = {};
    const { studentId, deptId, classId, status, search } = req.query;

    if (!isSudoUser) {
      if (isSuper && req.user.deptId) {
        query.deptId = req.user.deptId;
      } else if (isAdvisor) {
        const advSpecial = specials.find(s => s.option === 'ClassAdvisorTrackId');
        const targetClassId = advSpecial?.value || req.query.classId;
        const targetDeptId = req.user.deptId || req.query.deptId;
        const windowOpen = await isRegistrationWindowOpen(targetDeptId, targetClassId);
        if (!windowOpen) {
          return res.status(403).json({
            error: 'Registration window is closed. Access denied.',
            code: 'WINDOW_CLOSED'
          });
        }
        if (targetClassId) query.classId = targetClassId;
      } else {
        return res.status(403).json({ error: 'Access denied to device registry' });
      }
    }

    if (deptId && isSudoUser) query.deptId = deptId;
    if (classId) query.classId = classId;
    if (status) query.status = status;
    if (studentId) query.studentId = studentId;

    if (search) {
      const sRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { deviceTrackId: sRegex },
        { studentTrackId: sRegex },
        { 'info.model': sRegex },
        { 'info.browser': sRegex },
        { 'info.os': sRegex }
      ];
    }

    const devices = await M.StudentDevice.find(query)
      .populate('studentId', 'fullName registerNo username trackId class section')
      .populate('deptId', 'name code')
      .populate('classId', 'name batch section')
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();

    return res.json({
      ok: true,
      count: devices.length,
      devices
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
//  12. REGISTRATION TICKETS HISTORY (§11, §16)
// ─────────────────────────────────────────────────────────
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const isSudoUser = isSudo(req);
    const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
    const isSuper = specials.some(s => s && s.option === 'isAdmin' && s.value !== false);
    const isAdvisor = req.user.role === 'teacher' && specials.some(s => s.option === 'isClassAdvisor');

    const query = {};
    const { stage, kind, deptId, classId, search } = req.query;

    if (!isSudoUser) {
      if (isSuper && req.user.deptId) {
        query.deptId = req.user.deptId;
      } else if (isAdvisor) {
        const advSpecial = specials.find(s => s.option === 'ClassAdvisorTrackId');
        const targetClassId = advSpecial?.value || req.query.classId;
        const targetDeptId = req.user.deptId || req.query.deptId;
        const windowOpen = await isRegistrationWindowOpen(targetDeptId, targetClassId);
        if (!windowOpen) {
          return res.status(403).json({
            error: 'Registration window is closed. Access denied.',
            code: 'WINDOW_CLOSED'
          });
        }
        if (targetClassId) query.classId = targetClassId;
      } else {
        return res.status(403).json({ error: 'Access denied to ticket history' });
      }
    }

    if (deptId && isSudoUser) query.deptId = deptId;
    if (classId) query.classId = classId;
    if (stage) query.stage = stage;
    if (kind) query.kind = kind;

    if (search) {
      const sRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { ticketId: sRegex },
        { studentTrackId: sRegex },
        { deviceTrackId: sRegex }
      ];
    }

    const tickets = await M.DeviceRegistrationTicket.find(query)
      .populate('studentId', 'fullName registerNo username trackId class section')
      .populate('deptId', 'name code')
      .populate('classId', 'name batch section')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({
      ok: true,
      count: tickets.length,
      tickets: tickets.map(t => ({
        _id: t._id,
        ticketId: t.ticketId,
        student: t.studentId ? {
          fullName: t.studentId.fullName,
          registerNo: t.studentId.registerNo,
          username: t.studentId.username,
          class: t.studentId.class,
          section: t.studentId.section
        } : null,
        studentTrackId: t.studentTrackId,
        deptName: t.deptId?.name || '',
        className: t.classId?.name || '',
        issuedBy: t.issuedBy,
        kind: t.kind,
        stage: t.stage,
        deviceTrackId: t.deviceTrackId,
        expiresAt: t.expiresAt,
        usedAt: t.usedAt,
        createdAt: t.createdAt
      }))
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
//  13. REPLACEMENT & QUEUED REQUESTS CRUD (§14, §16, T5.3)
// ─────────────────────────────────────────────────────────
router.post('/replacement-requests', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Only students can submit device replacement requests' });
    }

    const student = await M.Student.findOne({
      $or: [{ _id: req.user._id }, { trackId: req.user.trackId }]
    });

    if (!student) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    const { reason = 'new_phone', note = '' } = req.body;
    const validReasons = ['lost', 'repaired', 'reset', 'new_phone', 'other'];
    const chosenReason = validReasons.includes(reason) ? reason : 'new_phone';

    // Daily rate limit per settings
    const settingsMap = await getSettings(['device']);
    const maxPerDay = settingsMap?.device?.replacementRequestsPerDay || 3;
    const startOfDay = getStartOfInstitutionDaySync();

    const todayCount = await M.DeviceReplacementRequest.countDocuments({
      studentId: student._id,
      createdAt: { $gte: startOfDay }
    });

    if (todayCount >= maxPerDay) {
      return res.status(429).json({ error: `Daily replacement request limit reached (max ${maxPerDay} per day).` });
    }

    const requestId = 'RR-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const reqDoc = await M.DeviceReplacementRequest.create({
      requestId,
      studentId: student._id,
      studentTrackId: student.trackId,
      deptId: student.deptId,
      classId: student.classId,
      type: 'replacement',
      reason: chosenReason,
      note: note.trim(),
      status: 'PENDING_ADVISOR'
    });

    await logAction(
      student.trackId,
      student.fullName || student.username,
      'student',
      'Device Replacement Requested',
      `Student requested device replacement. Reason: ${chosenReason}. Note: ${note}`,
      'device',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'device', subType: 'replacement-request', requestId, reason: chosenReason }
    );

    return res.json({
      ok: true,
      message: 'Device replacement request submitted successfully to your Class Advisor.',
      request: reqDoc
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/replacement-requests', authMiddleware, async (req, res) => {
  try {
    const isSudoUser = isSudo(req);
    const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
    const isSuper = specials.some(s => s && s.option === 'isAdmin' && s.value !== false);
    const isAdvisor = req.user.role === 'teacher' && specials.some(s => s.option === 'isClassAdvisor');

    const query = {};
    const { status, type, deptId, classId } = req.query;

    if (!isSudoUser) {
      if (isSuper && req.user.deptId) {
        query.deptId = req.user.deptId;
      } else if (isAdvisor) {
        const advSpecial = specials.find(s => s.option === 'ClassAdvisorTrackId');
        if (advSpecial?.value) query.classId = advSpecial.value;
      } else if (req.user.role === 'student') {
        query.studentId = req.user._id;
      } else {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    if (status) query.status = status;
    if (type) query.type = type;
    if (deptId && isSudoUser) query.deptId = deptId;
    if (classId) query.classId = classId;

    const requests = await M.DeviceReplacementRequest.find(query)
      .populate('studentId', 'fullName registerNo username trackId class section')
      .populate('deptId', 'name code')
      .populate('classId', 'name batch section')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({
      ok: true,
      count: requests.length,
      requests
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/replacement-requests/:id/forward', authMiddleware, async (req, res) => {
  try {
    const reqDoc = await M.DeviceReplacementRequest.findOne({
      $or: [{ requestId: req.params.id }, { _id: req.params.id }]
    });

    if (!reqDoc) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const { note = '' } = req.body;
    reqDoc.status = 'FORWARDED_TO_ADMIN';
    reqDoc.reviewedByAdvisor = {
      trackId: req.user.trackId || req.user.username,
      name: req.user.name || req.user.fullName || 'Class Advisor',
      at: new Date(),
      note: note.trim()
    };
    await reqDoc.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username,
      req.user.role,
      'Device Request Forwarded to Admin',
      `Request ${reqDoc.requestId} forwarded to Department Super Admin. Note: ${note}`,
      'device',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'device', subType: 'request-forwarded', requestId: reqDoc.requestId }
    );

    return res.json({
      ok: true,
      message: 'Request forwarded to Department Super Admin.'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/replacement-requests/:id/issue', authMiddleware, async (req, res) => {
  try {
    const isSudoUser = isSudo(req);
    const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
    const isSuper = specials.some(s => s && s.option === 'isAdmin' && s.value !== false);
    const isAdvisor = req.user.role === 'teacher' && specials.some(s => s.option === 'isClassAdvisor');

    const reqDoc = await M.DeviceReplacementRequest.findOne({
      $or: [{ requestId: req.params.id }, { _id: req.params.id }]
    });

    if (!reqDoc) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Advisor requires open window; Super Admin / Sudo can issue any time (§14)
    if (isAdvisor && !isSuper && !isSudoUser) {
      const windowOpen = await isRegistrationWindowOpen(reqDoc.deptId, reqDoc.classId);
      if (!windowOpen) {
        return res.status(403).json({
          error: 'Registration window is closed. Please forward this request to Department Super Admin.'
        });
      }
    }

    const student = await M.Student.findById(reqDoc.studentId).lean();
    if (!student) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    // Cancel previous tickets
    await M.DeviceRegistrationTicket.updateMany(
      { studentId: student._id, stage: { $in: ['ISSUED', 'CLAIMED', 'CODE_SHOWN'] } },
      { $set: { stage: 'CANCELLED' } }
    );

    // Read settings
    const settingsMap = await getSettings(['device']);
    const devCfg = settingsMap?.device || {};
    const credTtlMin = devCfg.credentialTtlMin || 10;
    const maxAttempts = devCfg.credentialMaxAttempts || 5;

    // Generate 12-character credential
    const cred = generate12CharCredential();
    const credHash = sha256(cred.raw);
    const ticketId = 'TKT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + credTtlMin * 60 * 1000);

    const ticket = await M.DeviceRegistrationTicket.create({
      ticketId,
      studentId: student._id,
      studentTrackId: student.trackId,
      deptId: student.deptId,
      classId: student.classId,
      issuedBy: {
        trackId: req.user.trackId || req.user.username,
        name: req.user.name || req.user.fullName || 'Admin',
        role: isSudoUser ? 'sudo' : (isSuper ? 'superAdmin' : 'advisor')
      },
      kind: 'replacement',
      credentialHash: credHash,
      expiresAt,
      maxAttempts,
      stage: 'ISSUED'
    });

    // Update request
    reqDoc.status = 'APPROVED';
    reqDoc.ticketId = ticketId;
    if (isAdvisor && !isSuper && !isSudoUser) {
      reqDoc.reviewedByAdvisor = {
        trackId: req.user.trackId || req.user.username,
        name: req.user.name || req.user.fullName || 'Class Advisor',
        at: new Date(),
        note: req.body.note || 'Issued replacement ticket'
      };
    } else {
      reqDoc.reviewedByAdmin = {
        trackId: req.user.trackId || req.user.username,
        name: req.user.name || req.user.fullName || 'Admin',
        at: new Date(),
        note: req.body.note || 'Issued replacement ticket'
      };
    }
    await reqDoc.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username,
      req.user.role,
      'Device Replacement Ticket Issued',
      `Issued replacement ticket ${ticketId} for request ${reqDoc.requestId} (${student.fullName})`,
      'device',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'device', subType: 'ticket-issued', ticketId, requestId: reqDoc.requestId }
    );

    return res.json({
      ok: true,
      ticketId,
      credential: cred.formatted,
      rawCredential: cred.raw,
      studentName: student.fullName,
      registerNo: student.registerNo,
      expiresAt,
      expiresInSec: credTtlMin * 60
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/replacement-requests/:id/reject', authMiddleware, async (req, res) => {
  try {
    const isSudoUser = isSudo(req);
    const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
    const isSuper = specials.some(s => s && s.option === 'isAdmin' && s.value !== false);
    const isAdvisor = req.user.role === 'teacher' && specials.some(s => s.option === 'isClassAdvisor');

    if (!isSudoUser && !isSuper && !isAdvisor) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const reqDoc = await M.DeviceReplacementRequest.findOne({
      $or: [{ requestId: req.params.id }, { _id: req.params.id }]
    });

    if (!reqDoc) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const { note = 'Rejected by administrator' } = req.body;
    reqDoc.status = 'REJECTED';

    if (isAdvisor && !isSuper && !isSudoUser) {
      reqDoc.reviewedByAdvisor = {
        trackId: req.user.trackId || req.user.username,
        name: req.user.name || req.user.fullName || 'Class Advisor',
        at: new Date(),
        note: note.trim()
      };
    } else {
      reqDoc.reviewedByAdmin = {
        trackId: req.user.trackId || req.user.username,
        name: req.user.name || req.user.fullName || 'Admin',
        at: new Date(),
        note: note.trim()
      };
    }
    await reqDoc.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username,
      req.user.role,
      'Device Request Rejected',
      `Device request ${reqDoc.requestId} rejected. Reason: ${note}`,
      'device',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'device', subType: 'request-rejected', requestId: reqDoc.requestId }
    );

    return res.json({
      ok: true,
      message: 'Request rejected.'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
