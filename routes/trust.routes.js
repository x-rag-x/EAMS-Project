const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const {
  applyTrustEvent,
  computeTrustBand,
  getStudentTrustLedger,
  isSelfAttendanceAllowed
} = require('../utils/trustEngine');
const { getSettings } = require('../utils/settingsCache');
const { todayIST } = require('../utils/institutionTime');
const { logAction } = require('../utils/logAction');
const { isSudo, isSuperAdminForDept } = require('../utils/access');

router.use(authMiddleware);

/**
 * GET /api/trust/me
 * Student endpoint: Returns student's own trust score, band, lock details, and ledger history (§10, §16)
 */
router.get('/me', async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'This endpoint is for students only', code: 'ROLE_FORBIDDEN' });
    }

    const student = await M.Student.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.user._id) ? req.user._id : undefined },
        { trackId: req.user.trackId }
      ].filter(Boolean)
    }).lean();

    if (!student) {
      return res.status(404).json({ error: 'Student record not found', code: 'STUDENT_NOT_FOUND' });
    }

    const trust = student.trust || {};
    const score = typeof trust.score === 'number' ? trust.score : 100;
    const band = trust.band || computeTrustBand(score);
    const lockedUntil = trust.lockedUntil ? new Date(trust.lockedUntil) : null;
    const isLocked = Boolean(lockedUntil && lockedUntil > new Date());

    const { events, total } = await getStudentTrustLedger(student._id, { limit: 20 });

    // Check registered trusted device
    const trustedDevice = await M.StudentDevice.findOne({
      studentId: student._id,
      status: 'TRUSTED'
    }).lean();

    return res.json({
      ok: true,
      score,
      band,
      isLocked,
      lockedUntil,
      lockReason: trust.lockReason || '',
      deviceRegistered: Boolean(trustedDevice),
      deviceTrackId: trustedDevice?.deviceTrackId || null,
      deviceInfo: trustedDevice ? {
        browser: trustedDevice.info?.browser,
        os: trustedDevice.info?.os,
        model: trustedDevice.info?.model,
        verifiedAt: trustedDevice.verifiedAt
      } : null,
      history: events.map(e => ({
        eventId: e.eventId,
        type: e.type,
        delta: e.delta,
        before: e.before,
        after: e.after,
        reason: e.reason,
        at: e.at,
        refKey: e.refKey
      })),
      totalEvents: total
    });
  } catch (err) {
    console.error('[Trust Me Error]:', err);
    return res.status(500).json({ error: 'Internal server error loading trust profile' });
  }
});

/**
 * POST /api/trust/verify
 * Teacher endpoint: Verify pending student attendance during live session (§7.3, §16, T4.4)
 * Body: { sessionTrackId, studentId, result: 'present' | 'not_in_class' }
 */
router.post('/verify', async (req, res) => {
  try {
    const { sessionTrackId, studentId, result } = req.body;

    if (!sessionTrackId || !studentId || !result) {
      return res.status(400).json({
        error: 'sessionTrackId, studentId, and result are required',
        code: 'MISSING_FIELDS'
      });
    }

    if (!['present', 'not_in_class'].includes(result)) {
      return res.status(400).json({
        error: "result must be 'present' or 'not_in_class'",
        code: 'INVALID_RESULT'
      });
    }

    // 1. Fetch student
    const student = await M.Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });
    }

    // 2. Fetch pending participation record across LiveSessionsAtt or QuickPassSession
    let liveRecord = await M.LiveSessionsAtt.findOne({ sessionTrackId, studentId });
    let qpSession = null;
    let qpRecord = null;

    if (!liveRecord) {
      qpSession = await M.QuickPassSession.findOne({ sessionTrackId, 'records.studentId': studentId });
      if (qpSession && Array.isArray(qpSession.records)) {
        qpRecord = qpSession.records.find(r => String(r.studentId) === String(studentId));
      }
    }

    if (!liveRecord && !qpRecord) {
      return res.status(404).json({
        error: 'Pending attendance record not found for this session',
        code: 'RECORD_NOT_FOUND'
      });
    }

    // 3. Double-click misclick protection (§7.3)
    const existingResult = liveRecord?.security?.teacherVerification?.result || qpRecord?.security?.teacherVerification?.result;
    if (existingResult === 'present' && result === 'not_in_class') {
      return res.status(400).json({
        error: 'Student was already verified as present for this session. Modify manually in draft roll if needed.',
        code: 'ALREADY_VERIFIED_PRESENT'
      });
    }

    const settingsMap = await getSettings(['trust']);
    const trustSettings = settingsMap?.trust || {};
    const trustScore = typeof student.trust?.score === 'number' ? student.trust.score : 100;
    const actorTrackId = req.user.trackId || req.user._id;
    const actorName = req.user.fullName || req.user.name || 'Teacher';

    // 4. Handle Result Outcomes (§7.3)
    if (result === 'present') {
      if (trustScore >= 60) {
        // Accepted mark (§7.3)
        if (liveRecord) {
          liveRecord.status = 'completed';
          liveRecord.verificationCompletedAt = new Date();
          liveRecord.verificationDetails.trustOk = true;
          liveRecord.verificationDetails.riskOk = true;
          liveRecord.security.teacherVerification = {
            required: true,
            result: 'present',
            by: actorTrackId,
            at: new Date()
          };
          await liveRecord.save();
        } else if (qpSession && qpRecord) {
          qpRecord.status = 'completed';
          qpRecord.security.teacherVerification = {
            required: true,
            result: 'present',
            by: actorTrackId,
            at: new Date()
          };
          await qpSession.save();
        }

        await logAction(
          actorTrackId,
          actorName,
          req.user.role,
          'Teacher Verification: Present',
          `Teacher confirmed presence for student ${student.registerNo || student.username} in session ${sessionTrackId}. Mark accepted.`,
          'trust',
          'info',
          req.ip,
          '',
          { module: 'trust', subType: 'verify_present', sessionTrackId, studentTrackId: student.trackId }
        );

        return res.json({
          ok: true,
          status: 'completed',
          result: 'present',
          message: 'Student verified present and attendance mark accepted.'
        });
      } else {
        // Denied: Trust < 60 (§7.3, T-D2)
        if (liveRecord) {
          liveRecord.security.teacherVerification = {
            required: true,
            result: 'denied_low_trust',
            by: actorTrackId,
            at: new Date()
          };
          await liveRecord.save();
        } else if (qpSession && qpRecord) {
          qpRecord.security.teacherVerification = {
            required: true,
            result: 'denied_low_trust',
            by: actorTrackId,
            at: new Date()
          };
          await qpSession.save();
        }

        return res.status(403).json({
          ok: false,
          denied: true,
          code: 'TRUST_TOO_LOW',
          message: `Attendance not marked — trust score is low (${trustScore}). Couldn't verify you. Meet your department admin.`
        });
      }
    } else {
      // Result is 'not_in_class' (§7.3: Very high risk: -40 trust, 2-day lock)
      if (liveRecord) {
        liveRecord.security.teacherVerification = {
          required: true,
          result: 'not_in_class',
          by: actorTrackId,
          at: new Date()
        };
        await liveRecord.save();
      } else if (qpSession && qpRecord) {
        qpRecord.security.teacherVerification = {
          required: true,
          result: 'not_in_class',
          by: actorTrackId,
          at: new Date()
        };
        await qpSession.save();
      }

      const penalty = trustSettings.teacherDeniedPenalty || 40;
      const lockDays = trustSettings.teacherDeniedLockDays || 2;
      const refKey = `TEACHER_DENIED:${sessionTrackId}`;

      await applyTrustEvent({
        studentId: student._id,
        studentTrackId: student.trackId,
        type: 'TEACHER_DENIED',
        delta: -penalty,
        refKey,
        refs: { sessionTrackId },
        reason: `Teacher confirmed student not in class during session ${sessionTrackId}`,
        actor: { trackId: actorTrackId, name: actorName, role: req.user.role },
        lockDays,
        lockReason: `Teacher confirmed student was not in class during session ${sessionTrackId}`,
        ip: req.ip
      });

      return res.json({
        ok: true,
        status: 'denied',
        result: 'not_in_class',
        message: `Student marked not in class. -${penalty} trust penalty and ${lockDays}-day lock applied.`
      });
    }
  } catch (err) {
    console.error('[Trust Verify Error]:', err);
    return res.status(500).json({ error: 'Internal server error verifying presence' });
  }
});

/**
 * GET /api/trust/students
 * Staff endpoint: List students with trust status (§11, §16)
 * Scoped by department or class (Advisor sees own class, Super Admin sees own dept, Sudo sees all)
 */
router.get('/students', async (req, res) => {
  try {
    const isAdvisor = req.user.role === 'teacher' && req.user.specials?.some(s => s.option === 'isClassAdvisor');
    const isSuper = req.user.isSuperAdmin || ['superAdmin', 'sudoAdmin'].includes(req.user.accessRole);
    const isSudoUser = req.user.isSudoAdmin || req.user.accessRole === 'sudoAdmin' || req.user.role === 'sudo' || isSudo(req);

    const query = {};
    const { classId, deptId, search, band, lockedOnly } = req.query;

    if (!isSudoUser) {
      if (isAdvisor && !isSuper) {
        const advSpecial = req.user.specials?.find(s => s.option === 'ClassAdvisorTrackId');
        if (advSpecial?.value) query.classId = advSpecial.value;
      } else if (req.user.deptId) {
        query.deptId = req.user.deptId;
      }
    }

    if (classId) query.classId = classId;
    if (deptId && isSudoUser) query.deptId = deptId;
    if (band) query['trust.band'] = band;
    if (lockedOnly === 'true') {
      query['trust.lockedUntil'] = { $gt: new Date() };
    }

    if (search) {
      const sRegex = new RegExp(search.trim(), 'i');
      query.$or = [{ fullName: sRegex }, { registerNo: sRegex }, { username: sRegex }];
    }

    const students = await M.Student.find(query)
      .select('fullName registerNo username class section classId deptId trust trackId')
      .populate('deptId', 'name code')
      .populate('classId', 'name batch section')
      .sort({ 'trust.score': 1 }) // lowest trust first per §11
      .limit(200)
      .lean();

    const studentIds = students.map(s => s._id);
    const devices = await M.StudentDevice.find({
      studentId: { $in: studentIds }
    }).lean();

    const deviceMap = {};
    devices.forEach(d => {
      // Prioritize TRUSTED device
      if (!deviceMap[d.studentId.toString()] || d.status === 'TRUSTED') {
        deviceMap[d.studentId.toString()] = d;
      }
    });

    return res.json({
      ok: true,
      count: students.length,
      students: students.map(s => {
        const score = typeof s.trust?.score === 'number' ? s.trust.score : 100;
        const lockedUntil = s.trust?.lockedUntil ? new Date(s.trust.lockedUntil) : null;
        const dev = deviceMap[s._id.toString()] || null;
        return {
          _id: s._id,
          trackId: s.trackId,
          fullName: s.fullName,
          registerNo: s.registerNo,
          username: s.username,
          class: s.class || s.classId?.name || '',
          section: s.section || s.classId?.section || '',
          deptId: s.deptId?._id || s.deptId,
          deptName: s.deptId?.name || '',
          deptCode: s.deptId?.code || '',
          trustScore: score,
          band: s.trust?.band || computeTrustBand(score),
          isLocked: Boolean(lockedUntil && lockedUntil > new Date()),
          lockedUntil,
          lockReason: s.trust?.lockReason || '',
          advisorConsent: s.trust?.advisorConsent || null,
          deviceStatus: dev ? dev.status : 'NO_DEVICE',
          device: dev ? {
            deviceTrackId: dev.deviceTrackId,
            status: dev.status,
            model: dev.info?.model || 'Mobile Device',
            browser: dev.info?.browser || '',
            os: dev.info?.os || '',
            verifiedAt: dev.verifiedAt,
            lastSeenAt: dev.lastSeenAt
          } : null
        };
      })
    });
  } catch (err) {
    console.error('[Trust Students Error]:', err);
    return res.status(500).json({ error: 'Internal server error loading students' });
  }
});

/**
 * GET /api/trust/students/:id
 * Staff endpoint: Detailed view of a student's trust status and ledger (§11, §16)
 */
router.get('/students/:id', async (req, res) => {
  try {
    const isSudoUser = req.user.isSudoAdmin || req.user.accessRole === 'sudoAdmin' || req.user.role === 'sudo' || isSudo(req);
    const student = await M.Student.findById(req.params.id)
      .populate('deptId', 'name code')
      .populate('classId', 'name batch section')
      .lean();

    if (!student) {
      return res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });
    }

    // Super Admin department scope check (§11, §18)
    const studDeptId = student.deptId?._id ? student.deptId._id.toString() : (student.deptId ? student.deptId.toString() : '');
    if (!isSudoUser && req.user.deptId && studDeptId && String(studDeptId) !== String(req.user.deptId)) {
      return res.status(403).json({ error: 'Access denied: student belongs to another department', code: 'DEPT_FORBIDDEN' });
    }

    const { events, total } = await getStudentTrustLedger(student._id, { limit: 100 });
    const devices = await M.StudentDevice.find({ studentId: student._id }).sort({ createdAt: -1 }).lean();

    const score = typeof student.trust?.score === 'number' ? student.trust.score : 100;
    const lockedUntil = student.trust?.lockedUntil ? new Date(student.trust.lockedUntil) : null;

    return res.json({
      ok: true,
      student: {
        _id: student._id,
        trackId: student.trackId,
        fullName: student.fullName,
        registerNo: student.registerNo,
        username: student.username,
        class: student.class || student.classId?.name || '',
        section: student.section || student.classId?.section || '',
        deptName: student.deptId?.name || '',
        deptCode: student.deptId?.code || '',
        trustScore: score,
        band: student.trust?.band || computeTrustBand(score),
        isLocked: Boolean(lockedUntil && lockedUntil > new Date()),
        lockedUntil,
        lockReason: student.trust?.lockReason || '',
        advisorConsent: student.trust?.advisorConsent || null
      },
      devices,
      ledger: events,
      totalEvents: total
    });
  } catch (err) {
    console.error('[Trust Student Detail Error]:', err);
    return res.status(500).json({ error: 'Internal server error loading student ledger' });
  }
});

/**
 * POST /api/trust/students/:id/consent
 * Advisor endpoint: Give consent to reset or unlock student (§8, §16)
 * Body: { note: string }
 */
router.post('/students/:id/consent', async (req, res) => {
  try {
    const isAdvisor = req.user.role === 'teacher' && req.user.specials?.some(s => s.option === 'isClassAdvisor');
    const isSuper = req.user.isSuperAdmin || ['superAdmin', 'sudoAdmin'].includes(req.user.accessRole);

    if (!isAdvisor && !isSuper) {
      return res.status(403).json({ error: 'Only Class Advisor or Admin can give consent', code: 'ROLE_FORBIDDEN' });
    }

    const student = await M.Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });
    }

    if (!student.trust) {
      student.trust = { score: 100, band: 'normal', lockedUntil: null, lockReason: '', updatedAt: new Date() };
    }

    const note = (req.body.note || '').trim();
    student.trust.advisorConsent = {
      consented: true,
      by: {
        trackId: req.user.trackId || req.user._id,
        name: req.user.fullName || req.user.name || 'Advisor'
      },
      note,
      at: new Date()
    };

    await student.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.fullName || req.user.name || 'Advisor',
      req.user.role,
      'Advisor Consent Given',
      `Advisor consented to reset/unlock student ${student.registerNo || student.username}. Note: ${note || 'None'}`,
      'trust',
      'info',
      req.ip,
      '',
      { module: 'trust', subType: 'advisor_consent', studentTrackId: student.trackId }
    );

    return res.json({
      ok: true,
      message: `Consent recorded for student ${student.fullName}. Department Admin can now proceed with unlock or reset.`
    });
  } catch (err) {
    console.error('[Trust Consent Error]:', err);
    return res.status(500).json({ error: 'Internal server error recording consent' });
  }
});

/**
 * POST /api/trust/students/:id/unlock
 * Admin action: Unlock self-attendance (requires advisor consent per §8)
 * Body: { reason: string }
 */
router.post('/students/:id/unlock', async (req, res) => {
  try {
    const isSuper = req.user.isSuperAdmin || ['superAdmin', 'sudoAdmin'].includes(req.user.accessRole);
    const isSudoUser = req.user.isSudoAdmin || req.user.accessRole === 'sudoAdmin' || req.user.role === 'sudo' || isSudo(req);

    if (!isSuper && !isSudoUser) {
      return res.status(403).json({ error: 'Super Admin or Sudo Admin privileges required', code: 'ROLE_FORBIDDEN' });
    }

    const student = await M.Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });
    }

    // Super Admin department scope check
    if (!isSudoUser && req.user.deptId && student.deptId && String(student.deptId) !== String(req.user.deptId)) {
      return res.status(403).json({ error: 'Cannot unlock student belonging to another department', code: 'DEPT_FORBIDDEN' });
    }

    // Two-person rule (§8): Super Admin requires advisor consent; Sudo can override
    if (!isSudoUser && !student.trust?.advisorConsent?.consented) {
      return res.status(403).json({
        error: "Advisor consent is required before unlocking this student's self-attendance (§8).",
        code: 'ADVISOR_CONSENT_REQUIRED'
      });
    }

    const reason = (req.body.reason || 'Admin unlocked self-attendance').trim();
    const refKey = `UNLOCK:${Date.now()}`;

    await applyTrustEvent({
      studentId: student._id,
      studentTrackId: student.trackId,
      type: 'UNLOCK',
      delta: 0,
      refKey,
      refs: {},
      reason,
      actor: { trackId: req.user.trackId || req.user._id, name: req.user.fullName || req.user.name, role: req.user.role },
      ip: req.ip
    });

    // Clear consent after use
    if (student.trust) {
      student.trust.advisorConsent = null;
      await student.save();
    }

    return res.json({
      ok: true,
      message: `Self-attendance unlocked successfully for ${student.fullName}.`
    });
  } catch (err) {
    console.error('[Trust Unlock Error]:', err);
    return res.status(500).json({ error: 'Internal server error unlocking student' });
  }
});

/**
 * POST /api/trust/students/:id/adjust
 * Admin action: Manually adjust student trust score (§8, §16)
 * Body: { delta: number, reason: string }
 */
router.post('/students/:id/adjust', async (req, res) => {
  try {
    const isSuper = req.user.isSuperAdmin || ['superAdmin', 'sudoAdmin'].includes(req.user.accessRole);
    const isSudoUser = req.user.isSudoAdmin || req.user.accessRole === 'sudoAdmin' || req.user.role === 'sudo' || isSudo(req);

    if (!isSuper && !isSudoUser) {
      return res.status(403).json({ error: 'Super Admin or Sudo Admin privileges required', code: 'ROLE_FORBIDDEN' });
    }

    const delta = Number(req.body.delta);
    const reason = (req.body.reason || '').trim();

    if (isNaN(delta) || delta === 0) {
      return res.status(400).json({ error: 'Valid non-zero delta required', code: 'INVALID_DELTA' });
    }
    if (!reason) {
      return res.status(400).json({ error: 'Reason is required for trust adjustment', code: 'REASON_REQUIRED' });
    }

    const student = await M.Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });
    }

    // Super Admin department scope check
    if (!isSudoUser && req.user.deptId && student.deptId && String(student.deptId) !== String(req.user.deptId)) {
      return res.status(403).json({ error: 'Cannot adjust trust score for student belonging to another department', code: 'DEPT_FORBIDDEN' });
    }

    const currentScore = typeof student.trust?.score === 'number' ? student.trust.score : 100;
    let effectiveDelta = delta;

    if (currentScore + effectiveDelta > 100) {
      effectiveDelta = 100 - currentScore;
    } else if (currentScore + effectiveDelta < 0) {
      effectiveDelta = 0 - currentScore;
    }

    if (effectiveDelta === 0) {
      return res.status(400).json({
        error: delta > 0 ? 'Student trust score is already at maximum (100)' : 'Student trust score is already at minimum (0)',
        code: 'SCORE_LIMIT_REACHED'
      });
    }

    const refKey = `ADMIN_ADJUST:${Date.now()}`;

    const outcome = await applyTrustEvent({
      studentId: student._id,
      studentTrackId: student.trackId,
      type: 'ADMIN_ADJUST',
      delta: effectiveDelta,
      refKey,
      refs: {},
      reason,
      actor: { trackId: req.user.trackId || req.user._id, name: req.user.fullName || req.user.name, role: req.user.role },
      ip: req.ip
    });

    return res.json({
      ok: true,
      message: `Trust score adjusted by ${effectiveDelta > 0 ? '+' + effectiveDelta : effectiveDelta} for ${student.fullName} (Score: ${outcome.studentTrust?.score}).`,
      trust: outcome.studentTrust
    });
  } catch (err) {
    console.error('[Trust Adjust Error]:', err);
    return res.status(500).json({ error: 'Internal server error adjusting trust score' });
  }
});

/**
 * POST /api/trust/students/:id/reset
 * Admin action: Reset trust score to 100 and clear lock (requires advisor consent per §8)
 * Body: { reason: string }
 */
router.post('/students/:id/reset', async (req, res) => {
  try {
    const isSuper = req.user.isSuperAdmin || ['superAdmin', 'sudoAdmin'].includes(req.user.accessRole);
    const isSudoUser = req.user.isSudoAdmin || req.user.accessRole === 'sudoAdmin' || req.user.role === 'sudo' || isSudo(req);

    if (!isSuper && !isSudoUser) {
      return res.status(403).json({ error: 'Super Admin or Sudo Admin privileges required', code: 'ROLE_FORBIDDEN' });
    }

    const student = await M.Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });
    }

    // Super Admin department scope check
    if (!isSudoUser && req.user.deptId && student.deptId && String(student.deptId) !== String(req.user.deptId)) {
      return res.status(403).json({ error: 'Cannot reset trust score for student belonging to another department', code: 'DEPT_FORBIDDEN' });
    }

    // Two-person rule (§8): Super Admin requires advisor consent; Sudo can override
    if (!isSudoUser && !student.trust?.advisorConsent?.consented) {
      return res.status(403).json({
        error: "Advisor consent is required before resetting this student's trust score (§8).",
        code: 'ADVISOR_CONSENT_REQUIRED'
      });
    }

    const currentScore = typeof student.trust?.score === 'number' ? student.trust.score : 100;
    const delta = 100 - currentScore;
    const reason = (req.body.reason || 'Admin reset trust score to 100').trim();
    const refKey = `ADMIN_RESET:${Date.now()}`;

    await applyTrustEvent({
      studentId: student._id,
      studentTrackId: student.trackId,
      type: 'ADMIN_RESET',
      delta,
      refKey,
      refs: {},
      reason,
      actor: { trackId: req.user.trackId || req.user._id, name: req.user.fullName || req.user.name, role: req.user.role },
      ip: req.ip
    });

    if (student.trust) {
      student.trust.advisorConsent = null;
      await student.save();
    }

    return res.json({
      ok: true,
      message: `Trust score reset to 100 and locks cleared for ${student.fullName}.`
    });
  } catch (err) {
    console.error('[Trust Reset Error]:', err);
    return res.status(500).json({ error: 'Internal server error resetting trust score' });
  }
});

// ─────────────────────────────────────────────────────────────
// DISPUTES WORKFLOW (§12, §16, Phase T6)
// ─────────────────────────────────────────────────────────────

async function sendNotificationSafe(data) {
  try {
    await M.Notification.create({
      time: new Date(),
      status: 'Pending',
      read: false,
      priority: 'Normal',
      ...data
    });
  } catch (e) {
    console.warn('[Notification Warning]:', e.message);
  }
}

/**
 * POST /api/trust/disputes
 * Student endpoint: Submit a dispute for a penalised trust event (§12)
 * Body: { eventId: string, reason: string }
 */
router.post('/disputes', async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Only students can file attendance & trust disputes', code: 'ROLE_FORBIDDEN' });
    }

    const { eventId, reason } = req.body;
    if (!eventId || !reason || typeof reason !== 'string' || reason.trim().length < 10) {
      return res.status(400).json({
        error: 'eventId and an explanatory statement (at least 10 characters) are required',
        code: 'INVALID_INPUT'
      });
    }

    // Look up student
    const student = await M.Student.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.user._id) ? req.user._id : undefined },
        { trackId: req.user.trackId }
      ].filter(Boolean)
    });
    if (!student) {
      return res.status(404).json({ error: 'Student record not found', code: 'STUDENT_NOT_FOUND' });
    }

    // Look up trust event
    const event = await M.TrustEvent.findOne({
      $or: [
        { eventId: eventId },
        { _id: mongoose.isValidObjectId(eventId) ? eventId : undefined }
      ].filter(Boolean)
    });
    if (!event) {
      return res.status(404).json({ error: 'Trust event not found', code: 'EVENT_NOT_FOUND' });
    }

    if (String(event.studentId) !== String(student._id)) {
      return res.status(403).json({ error: 'Cannot dispute an event that does not belong to your record', code: 'FORBIDDEN' });
    }

    // Check dispute window (§12: default 7 days)
    const trustSetting = await getSettings('trust');
    const windowDays = (trustSetting && trustSetting.disputeWindowDays) ? Number(trustSetting.disputeWindowDays) : 7;
    const cutoff = new Date(Date.now() - (windowDays * 24 * 60 * 60 * 1000));
    if (new Date(event.at) < cutoff) {
      return res.status(400).json({
        error: `Dispute window has expired (disputes must be filed within ${windowDays} days of the event)`,
        code: 'DISPUTE_WINDOW_EXPIRED'
      });
    }

    // Check if open dispute exists for this event
    const existingDispute = await M.TrustDispute.findOne({
      studentId: student._id,
      $or: [{ eventId: event._id }, { eventTrackId: event.eventId }],
      status: { $in: ['PENDING_TEACHER', 'PENDING_ADVISOR', 'PENDING_ADMIN'] }
    });
    if (existingDispute) {
      return res.status(400).json({
        error: 'An active dispute is already in progress for this event',
        code: 'DISPUTE_ALREADY_OPEN'
      });
    }

    // Check if event was already accepted & resolved
    const resolvedDispute = await M.TrustDispute.findOne({
      studentId: student._id,
      $or: [{ eventId: event._id }, { eventTrackId: event.eventId }],
      status: 'ACCEPTED'
    });
    if (resolvedDispute) {
      return res.status(400).json({
        error: 'This event was already accepted and corrected in an earlier dispute',
        code: 'EVENT_ALREADY_RESOLVED'
      });
    }

    // Resolve class & department
    const cls = student.classId ? await M.Class.findById(student.classId) : null;
    const dept = student.deptId ? await M.Department.findById(student.deptId) : (cls?.deptId ? await M.Department.findById(cls.deptId) : null);

    // Freeze Evidence Snapshot (§12)
    let sessionInfo = null;
    let teacherInfo = null;
    let deviceSnapshot = null;
    let teacherVerification = null;

    const sessionTrackId = event.refs?.sessionTrackId;
    if (sessionTrackId) {
      // Search in LiveSession, ScanLiveSession, QuickPassSession
      const liveSession = await M.LiveSession.findOne({ trackId: sessionTrackId }).lean();
      if (liveSession) {
        sessionInfo = {
          sessionTrackId: liveSession.trackId,
          date: liveSession.date,
          attendanceMode: liveSession.attendanceMode,
          classId: liveSession.classId,
          subjectId: liveSession.subjectId
        };
        const stMark = (liveSession.markedStudents || []).find(m => String(m.studentId) === String(student._id) || m.regNo === student.registerNo);
        if (stMark) {
          deviceSnapshot = stMark.security || null;
          teacherVerification = stMark.security?.teacherVerification || null;
        }
        if (liveSession.teacherId) {
          teacherInfo = {
            teacherId: liveSession.teacherId,
            teacherTrackId: liveSession.teacherTrackId,
            teacherName: ''
          };
        }
      } else {
        const scanSession = await M.ScanLiveSession.findOne({ sessionTrackId }).lean();
        if (scanSession) {
          sessionInfo = {
            sessionTrackId: scanSession.sessionTrackId,
            date: scanSession.date,
            periodNumber: scanSession.periodNumber,
            className: scanSession.className,
            subjectName: scanSession.subjectName
          };
          const stMark = (scanSession.records || []).find(r => String(r.studentId) === String(student._id) || r.regNo === student.registerNo);
          if (stMark) {
            deviceSnapshot = stMark.security || null;
            teacherVerification = stMark.security?.teacherVerification || null;
          }
          if (scanSession.teacherId) {
            teacherInfo = {
              teacherId: scanSession.teacherId,
              teacherTrackId: scanSession.teacherTrackId,
              teacherName: scanSession.teacherName || ''
            };
          }
        }
      }
    }

    // If teacher details missing, check event actor
    if (!teacherInfo && event.actor && event.actor.trackId) {
      teacherInfo = {
        teacherId: null,
        teacherTrackId: event.actor.trackId,
        teacherName: event.actor.name || 'Teacher'
      };
    }

    if (teacherInfo && teacherInfo.teacherId && !teacherInfo.teacherName) {
      const tUser = await M.User.findById(teacherInfo.teacherId).lean();
      if (tUser) teacherInfo.teacherName = tUser.name || tUser.fullName || 'Teacher';
    }

    const hasTeacher = Boolean(teacherInfo && (teacherInfo.teacherId || teacherInfo.teacherTrackId));
    const initialStatus = hasTeacher ? 'PENDING_TEACHER' : 'PENDING_ADVISOR';

    const dispute = await M.TrustDispute.create({
      studentId: student._id,
      studentTrackId: student.trackId,
      studentName: student.fullName || student.name || 'Student',
      regNo: student.registerNo || '',
      deptId: dept?._id || student.deptId,
      deptCode: dept?.code || '',
      classId: cls?._id || student.classId,
      className: cls?.name || student.class || '',
      eventId: event._id,
      eventTrackId: event.eventId,
      eventRefKey: event.refKey,
      eventType: event.type,
      pointsDeducted: Math.abs(event.delta || 0),
      eventDate: event.at,
      reason: reason.trim(),
      status: initialStatus,
      evidenceSnapshot: {
        attendanceSession: sessionInfo,
        teacherVerification: teacherVerification,
        deviceSnapshot: deviceSnapshot,
        trustBefore: event.before,
        trustAfter: event.after,
        riskReasons: event.refs?.riskReasons || [],
        originalTrustEvent: event.toObject ? event.toObject() : event,
        frozenAt: new Date()
      },
      teacherInvolved: hasTeacher ? {
        teacherId: teacherInfo.teacherId,
        teacherTrackId: teacherInfo.teacherTrackId,
        teacherName: teacherInfo.teacherName,
        statement: '',
        submittedAt: null,
        deadline: new Date(Date.now() + 48 * 3600 * 1000)
      } : undefined
    });

    // Send notifications
    await sendNotificationSafe({
      type: 'trust-dispute',
      from: student.fullName || student.name,
      fromRole: 'Student',
      toStudentId: student._id,
      toStudentTrackId: student.trackId,
      toStudentName: student.fullName || student.name,
      message: `Your dispute for ${event.type} (#${dispute.disputeTrackId}) has been submitted and is under review.`,
      priority: 'Normal'
    });

    if (hasTeacher && teacherInfo.teacherId) {
      await sendNotificationSafe({
        type: 'trust-dispute',
        from: student.fullName || student.name,
        fromRole: 'Student',
        toTeacherId: teacherInfo.teacherId,
        toTeacherTrackId: teacherInfo.teacherTrackId,
        toTeacherName: teacherInfo.teacherName,
        message: `Student ${student.fullName || student.name} has filed a dispute (#${dispute.disputeTrackId}). An optional teacher statement can be provided within 48h.`,
        priority: 'Normal'
      });
    }

    // Log Action
    await logAction(
      req.user.trackId || req.user._id,
      req.user.fullName || req.user.name,
      req.user.role,
      'Trust Dispute Filed',
      `Student ${student.fullName || student.name} filed dispute #${dispute.disputeTrackId} for event ${event.eventId} (${event.type}).`,
      'audit',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'trust',
        subType: 'dispute-create',
        trackId: req.user.trackId,
        disputeTrackId: dispute.disputeTrackId,
        eventId: event.eventId
      }
    );

    return res.status(201).json({
      ok: true,
      message: 'Dispute submitted successfully and evidence frozen.',
      data: dispute
    });
  } catch (err) {
    console.error('[Trust Dispute Submit Error]:', err);
    return res.status(500).json({ error: 'Internal server error filing dispute' });
  }
});

/**
 * GET /api/trust/disputes
 * List disputes filtered by role and permissions (§12, §16)
 */
router.get('/disputes', async (req, res) => {
  try {
    const isSudoUser = req.user.isSudoAdmin || req.user.accessRole === 'sudoAdmin' || req.user.role === 'sudo' || isSudo(req);
    const isSuper = req.user.isSuperAdmin || ['superAdmin', 'sudoAdmin'].includes(req.user.accessRole);
    const filter = {};

    if (req.user.role === 'student') {
      filter.studentId = req.user._id;
    } else if (req.user.role === 'teacher') {
      // Find classes where teacher is advisor or acting advisor
      const classes = await M.Class.find({
        $or: [
          { advisorId: req.user._id },
          { advisorTrackId: req.user.trackId }
        ]
      }).select('_id');
      const classIds = classes.map(c => c._id);

      filter.$or = [
        { classId: { $in: classIds } },
        { 'teacherInvolved.teacherId': req.user._id },
        { 'teacherInvolved.teacherTrackId': req.user.trackId }
      ];
    } else if (isSuper && !isSudoUser) {
      if (req.user.deptId) {
        filter.deptId = req.user.deptId;
      }
    }

    if (req.query.status) {
      filter.status = req.query.status;
    }
    if (req.query.studentId && mongoose.isValidObjectId(req.query.studentId)) {
      filter.studentId = req.query.studentId;
    }
    if (req.query.classId && mongoose.isValidObjectId(req.query.classId)) {
      filter.classId = req.query.classId;
    }
    if (req.query.deptId && mongoose.isValidObjectId(req.query.deptId)) {
      filter.deptId = req.query.deptId;
    }

    const disputes = await M.TrustDispute.find(filter)
      .populate('deptId', 'name code')
      .populate('classId', 'name section year')
      .populate('studentId', 'fullName name registerNo trackId currentSemester sem admissionYear')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, disputes });
  } catch (err) {
    console.error('[Trust Disputes List Error]:', err);
    return res.status(500).json({ error: 'Internal server error retrieving disputes' });
  }
});

/**
 * GET /api/trust/disputes/:id
 * Retrieve detail of a dispute
 */
router.get('/disputes/:id', async (req, res) => {
  try {
    const dispute = await M.TrustDispute.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { disputeTrackId: req.params.id }
      ].filter(Boolean)
    })
      .populate('deptId', 'name code')
      .populate('classId', 'name section year')
      .populate('studentId', 'fullName name registerNo trackId currentSemester sem')
      .lean();

    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found', code: 'DISPUTE_NOT_FOUND' });
    }

    // Permission checks
    const isSudoUser = req.user.isSudoAdmin || req.user.accessRole === 'sudoAdmin' || req.user.role === 'sudo' || isSudo(req);
    if (req.user.role === 'student' && String(dispute.studentId?._id || dispute.studentId) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
    }
    if (!isSudoUser && req.user.deptId && dispute.deptId && String(dispute.deptId._id || dispute.deptId) !== String(req.user.deptId) && req.user.role !== 'student') {
      return res.status(403).json({ error: 'Cross-department dispute access is forbidden', code: 'DEPT_FORBIDDEN' });
    }

    return res.json({ ok: true, data: dispute });
  } catch (err) {
    console.error('[Trust Dispute Detail Error]:', err);
    return res.status(500).json({ error: 'Internal server error retrieving dispute detail' });
  }
});

/**
 * POST /api/trust/disputes/:id/teacher-statement
 * Teacher endpoint: Submit optional statement (~50 words) within 48h
 * Body: { statement: string }
 */
router.post('/disputes/:id/teacher-statement', async (req, res) => {
  try {
    const { statement } = req.body;
    if (!statement || typeof statement !== 'string' || statement.trim().length === 0) {
      return res.status(400).json({ error: 'Statement cannot be empty', code: 'INVALID_INPUT' });
    }

    const dispute = await M.TrustDispute.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { disputeTrackId: req.params.id }
      ].filter(Boolean)
    });
    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found', code: 'DISPUTE_NOT_FOUND' });
    }

    if (!['PENDING_TEACHER', 'PENDING_ADVISOR'].includes(dispute.status)) {
      return res.status(400).json({ error: `Cannot add teacher statement to dispute in ${dispute.status} state`, code: 'INVALID_STATE' });
    }

    dispute.teacherInvolved = dispute.teacherInvolved || {};
    dispute.teacherInvolved.statement = statement.trim();
    dispute.teacherInvolved.submittedAt = new Date();
    dispute.teacherInvolved.teacherId = req.user._id;
    dispute.teacherInvolved.teacherTrackId = req.user.trackId || '';
    dispute.teacherInvolved.teacherName = req.user.fullName || req.user.name || 'Teacher';

    if (dispute.status === 'PENDING_TEACHER') {
      dispute.status = 'PENDING_ADVISOR';
    }

    await dispute.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.fullName || req.user.name,
      req.user.role,
      'Dispute Teacher Statement Submitted',
      `Teacher statement submitted for dispute #${dispute.disputeTrackId}.`,
      'audit',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'trust', subType: 'dispute-teacher-statement', disputeTrackId: dispute.disputeTrackId }
    );

    return res.json({ ok: true, message: 'Teacher statement recorded and dispute forwarded to advisor.', data: dispute });
  } catch (err) {
    console.error('[Dispute Teacher Statement Error]:', err);
    return res.status(500).json({ error: 'Internal server error submitting teacher statement' });
  }
});

/**
 * POST /api/trust/disputes/:id/advisor
 * Class Advisor endpoint: Support (forward to Super Admin) or Reject (§12)
 * Body: { action: 'SUPPORT' | 'REJECT', note: string }
 */
router.post('/disputes/:id/advisor', async (req, res) => {
  try {
    const { action, note } = req.body;
    if (!['SUPPORT', 'REJECT'].includes(action)) {
      return res.status(400).json({ error: "Action must be 'SUPPORT' or 'REJECT'", code: 'INVALID_ACTION' });
    }
    if (!note || typeof note !== 'string' || note.trim().length === 0) {
      return res.status(400).json({ error: 'Review note is required', code: 'NOTE_REQUIRED' });
    }

    const dispute = await M.TrustDispute.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { disputeTrackId: req.params.id }
      ].filter(Boolean)
    });
    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found', code: 'DISPUTE_NOT_FOUND' });
    }

    if (!['PENDING_ADVISOR', 'PENDING_TEACHER'].includes(dispute.status)) {
      return res.status(400).json({ error: `Cannot review dispute in status ${dispute.status}`, code: 'INVALID_STATE' });
    }

    dispute.advisorReview = {
      advisorId: req.user._id,
      advisorTrackId: req.user.trackId || '',
      advisorName: req.user.fullName || req.user.name || 'Advisor',
      action,
      note: note.trim(),
      reviewedAt: new Date()
    };

    if (action === 'SUPPORT') {
      dispute.status = 'PENDING_ADMIN';
      await sendNotificationSafe({
        type: 'trust-dispute',
        from: req.user.fullName || req.user.name,
        fromRole: 'Teacher',
        toStudentId: dispute.studentId,
        toStudentTrackId: dispute.studentTrackId,
        toStudentName: dispute.studentName,
        message: `Your Class Advisor supported dispute #${dispute.disputeTrackId}. It has been forwarded to department administration.`,
        priority: 'Normal'
      });
    } else {
      dispute.status = 'REJECTED_BY_ADVISOR';
      await sendNotificationSafe({
        type: 'trust-dispute',
        from: req.user.fullName || req.user.name,
        fromRole: 'Teacher',
        toStudentId: dispute.studentId,
        toStudentTrackId: dispute.studentTrackId,
        toStudentName: dispute.studentName,
        message: `Your dispute #${dispute.disputeTrackId} was rejected by your Class Advisor. Note: ${note.trim()}`,
        priority: 'Normal'
      });
    }

    await dispute.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.fullName || req.user.name,
      req.user.role,
      `Dispute Advisor Review (${action})`,
      `Advisor ${req.user.fullName || req.user.name} reviewed dispute #${dispute.disputeTrackId}: ${action}.`,
      'audit',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'trust', subType: 'dispute-advisor', disputeTrackId: dispute.disputeTrackId, action }
    );

    return res.json({
      ok: true,
      message: action === 'SUPPORT' ? 'Dispute supported and forwarded to department administration' : 'Dispute rejected by advisor',
      data: dispute
    });
  } catch (err) {
    console.error('[Dispute Advisor Review Error]:', err);
    return res.status(500).json({ error: 'Internal server error processing advisor review' });
  }
});

/**
 * POST /api/trust/disputes/:id/decide
 * Department Super Admin / Sudo endpoint: Accept (execute correction transaction) or Reject (§12, T6.3)
 * Body: { decision: 'ACCEPT' | 'REJECT', note: string, newTrustScore?: number }
 */
router.post('/disputes/:id/decide', async (req, res) => {
  try {
    const isSuper = req.user.isSuperAdmin || ['superAdmin', 'sudoAdmin'].includes(req.user.accessRole);
    const isSudoUser = req.user.isSudoAdmin || req.user.accessRole === 'sudoAdmin' || req.user.role === 'sudo' || isSudo(req);

    if (!isSuper && !isSudoUser) {
      return res.status(403).json({ error: 'Super Admin or Sudo Admin privileges required', code: 'ROLE_FORBIDDEN' });
    }

    const { decision, note, newTrustScore } = req.body;
    if (!['ACCEPT', 'REJECT'].includes(decision)) {
      return res.status(400).json({ error: "Decision must be 'ACCEPT' or 'REJECT'", code: 'INVALID_DECISION' });
    }
    if (!note || typeof note !== 'string' || note.trim().length === 0) {
      return res.status(400).json({ error: 'Decision note is required', code: 'NOTE_REQUIRED' });
    }

    const dispute = await M.TrustDispute.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { disputeTrackId: req.params.id }
      ].filter(Boolean)
    });
    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found', code: 'DISPUTE_NOT_FOUND' });
    }

    // Super Admin department scoping check
    if (!isSudoUser && !isSuperAdminForDept(req.user, dispute.deptId)) {
      return res.status(403).json({ error: 'Cannot decide dispute for another department', code: 'DEPT_FORBIDDEN' });
    }

    // If not Sudo, dispute must be at PENDING_ADMIN stage (Sudo has institution override per §12)
    if (!isSudoUser && dispute.status !== 'PENDING_ADMIN') {
      return res.status(400).json({
        error: `Dispute must be in PENDING_ADMIN stage before final decision (current status: ${dispute.status})`,
        code: 'INVALID_STAGE'
      });
    }

    if (decision === 'REJECT') {
      dispute.status = 'REJECTED_BY_ADMIN';
      dispute.adminDecision = {
        decidedBy: req.user._id,
        decidedByName: req.user.fullName || req.user.name || 'Admin',
        decidedByRole: req.user.role || 'admin',
        decision: 'REJECT',
        note: note.trim(),
        decidedAt: new Date()
      };
      await dispute.save();

      await sendNotificationSafe({
        type: 'trust-dispute',
        from: req.user.fullName || req.user.name,
        fromRole: 'Admin',
        toStudentId: dispute.studentId,
        toStudentTrackId: dispute.studentTrackId,
        toStudentName: dispute.studentName,
        message: `Your dispute #${dispute.disputeTrackId} was rejected by department administration. Note: ${note.trim()}`,
        priority: 'Normal'
      });

      await logAction(
        req.user.trackId || req.user._id,
        req.user.fullName || req.user.name,
        req.user.role,
        'Trust Dispute Rejected',
        `Dispute #${dispute.disputeTrackId} rejected by ${req.user.fullName || req.user.name}: ${note.trim()}`,
        'audit',
        'info',
        req.ip,
        req.user.sessionId,
        { module: 'trust', subType: 'dispute-reject', disputeTrackId: dispute.disputeTrackId }
      );

      return res.json({ ok: true, message: 'Dispute rejected by administration', data: dispute });
    }

    // ─────────────────────────────────────────────────────────
    // DECISION: ACCEPT → EXECUTE AUTOMATIC CORRECTION TRANSACTION (§12, T6.3)
    // ─────────────────────────────────────────────────────────
    dispute.resolution = dispute.resolution || {};

    // 1. Correct Attendance (LiveSession, ScanLiveSession, QuickPassSession & ClassAttendance)
    const sessionTrackId = dispute.evidenceSnapshot?.attendanceSession?.sessionTrackId;
    const eventDate = dispute.eventDate ? (typeof dispute.eventDate === 'string' ? dispute.eventDate.split('T')[0] : todayIST(dispute.eventDate)) : null;

    if (sessionTrackId) {
      await M.LiveSession.updateOne(
        { trackId: sessionTrackId, 'markedStudents.studentId': dispute.studentId },
        {
          $set: {
            'markedStudents.$.status': 'completed',
            'markedStudents.$.security.teacherVerification.result': 'present',
            'markedStudents.$.security.riskLevelAtMark': 'low'
          }
        }
      );

      await M.ScanLiveSession.updateOne(
        { sessionTrackId, 'records.studentId': dispute.studentId },
        {
          $set: {
            'records.$.status': 'completed',
            'records.$.security.teacherVerification.result': 'present'
          }
        }
      );

      await M.QuickPassSession.updateOne(
        { sessionTrackId, 'markedStudents.studentId': dispute.studentId },
        {
          $set: {
            'markedStudents.$.status': 'completed',
            'markedStudents.$.security.teacherVerification.result': 'present'
          }
        }
      );
    }

    // In ClassAttendance records: change status from 'AB' to 'P'
    const classAttQuery = {};
    if (dispute.classId) classAttQuery.classId = dispute.classId;
    if (eventDate) classAttQuery.date = new Date(eventDate);

    const classAttDocs = await M.ClassAttendance.find(classAttQuery);
    for (const ca of classAttDocs) {
      let modified = false;
      for (const p of ca.periods || []) {
        for (const r of p.records || []) {
          if (r.studentTrackId === dispute.studentTrackId && r.status === 'AB') {
            r.status = 'P';
            r.history = r.history || [];
            r.history.push({
              status: 'P',
              reason: 'Dispute Accepted',
              by: req.user.fullName || req.user.name,
              role: req.user.role || 'admin',
              at: new Date(),
              note: `Corrected via dispute #${dispute.disputeTrackId}`
            });
            modified = true;
          }
        }
      }
      if (modified) await ca.save();
    }
    dispute.resolution.attendanceCorrected = true;

    // 2. Restore Exact Trust Points via reversal event (original untouched)
    const student = await M.Student.findById(dispute.studentId);
    if (!student) {
      return res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });
    }

    const pointsToRestore = dispute.pointsDeducted || 0;
    const currentScore = (student.trust && typeof student.trust.score === 'number') ? student.trust.score : 100;
    let targetScore;
    if (typeof newTrustScore === 'number' && !isNaN(newTrustScore)) {
      targetScore = Math.min(100, Math.max(0, newTrustScore));
    } else {
      targetScore = Math.min(100, Math.max(0, currentScore + pointsToRestore));
    }
    const delta = targetScore - currentScore;

    const reversalRefKey = `DISPUTE_ACCEPTED_CORRECTION:${dispute._id}`;
    let corrEvent = null;
    try {
      corrEvent = await applyTrustEvent({
        studentId: student._id,
        studentTrackId: student.trackId,
        type: 'DISPUTE_ACCEPTED_CORRECTION',
        delta,
        refKey: reversalRefKey,
        refs: {
          disputeId: String(dispute._id),
          sessionTrackId: sessionTrackId || null,
          date: eventDate,
          reversesEventId: dispute.eventTrackId || String(dispute.eventId || '')
        },
        reason: `Dispute #${dispute.disputeTrackId} accepted: ${note.trim()}`,
        actor: { trackId: req.user.trackId || req.user._id, name: req.user.fullName || req.user.name, role: req.user.role },
        ip: req.ip
      });
    } catch (evtErr) {
      console.warn('[Dispute Trust Event Warning]:', evtErr.message);
    }

    dispute.resolution.trustPointsRestored = pointsToRestore;
    if (corrEvent && corrEvent._id) {
      dispute.resolution.correctionEventId = corrEvent._id;
    }

    // 3. Remove Related Lock if this event or current lock caused it
    if (student.trust && student.trust.locked) {
      student.trust.locked = false;
      student.trust.lockedUntil = null;
      student.trust.lockReason = '';
      await student.save();

      try {
        await applyTrustEvent({
          studentId: student._id,
          studentTrackId: student.trackId,
          type: 'UNLOCK',
          delta: 0,
          refKey: `DISPUTE_UNLOCK:${dispute._id}`,
          refs: { disputeId: String(dispute._id) },
          reason: `Lock removed via accepted dispute #${dispute.disputeTrackId}`,
          actor: { trackId: req.user.trackId || req.user._id, name: req.user.fullName || req.user.name, role: req.user.role },
          ip: req.ip
        });
      } catch (unlockErr) {
        console.warn('[Dispute Unlock Warning]:', unlockErr.message);
      }
      dispute.resolution.lockRemoved = true;
    }

    // 4. One-time +2 % Attendance Adjustment (AttendanceAdjustment, once per student per semester) (§12, T-D6)
    const curSem = student.currentSemester || student.sem || 1;
    const existingBonus = await M.AttendanceAdjustment.findOne({
      studentId: student._id,
      semester: curSem,
      kind: 'DISPUTE_BONUS'
    });

    if (!existingBonus) {
      const trustSetting = await getSettings('trust');
      const bonusPct = (trustSetting && trustSetting.disputeBonusPct) ? Number(trustSetting.disputeBonusPct) : 2;

      const adj = await M.AttendanceAdjustment.create({
        studentId: student._id,
        studentTrackId: student.trackId,
        semester: curSem,
        academicYear: student.admissionYear || '',
        deltaPct: bonusPct,
        kind: 'DISPUTE_BONUS',
        reason: `Dispute accepted bonus (+${bonusPct}%) for dispute #${dispute.disputeTrackId}`,
        refDisputeId: dispute._id,
        appliedBy: req.user.fullName || req.user.name || 'Admin'
      });

      dispute.resolution.adjustmentId = adj._id;
      dispute.resolution.adjustmentPct = bonusPct;
    }

    // 5. Create Grievance Record in institution's register (T-D10)
    try {
      const grievance = await M.Grievance.create({
        studentId: student._id,
        studentName: student.fullName || student.name,
        studentTrackId: student.trackId,
        kind: 'trust-dispute',
        disputeId: dispute._id,
        subject: `Dispute Accepted: ${dispute.eventType || 'Trust Penalty'} (#${dispute.disputeTrackId})`,
        category: 'Attendance',
        detail: `Dispute filed by ${student.fullName || student.name} accepted by ${req.user.fullName || req.user.name}. Decision: ${note.trim()}`,
        status: 'Resolved',
        resolvedBy: req.user.fullName || req.user.name,
        resolvedAt: new Date()
      });
      dispute.resolution.grievanceId = grievance._id;
    } catch (grievErr) {
      console.warn('[Dispute Grievance Warning]:', grievErr.message);
    }

    // 6. Notify Student, Advisor & Teacher
    await sendNotificationSafe({
      type: 'trust-dispute',
      from: req.user.fullName || req.user.name,
      fromRole: 'Admin',
      toStudentId: student._id,
      toStudentTrackId: student.trackId,
      toStudentName: student.fullName || student.name,
      message: `Your dispute #${dispute.disputeTrackId} was ACCEPTED. Attendance has been restored, trust points reinstated, and record updated.`,
      priority: 'High'
    });

    if (dispute.advisorReview?.advisorId) {
      await sendNotificationSafe({
        type: 'trust-dispute',
        from: req.user.fullName || req.user.name,
        fromRole: 'Admin',
        toTeacherId: dispute.advisorReview.advisorId,
        message: `Dispute #${dispute.disputeTrackId} for ${student.fullName || student.name} has been accepted by department administration.`,
        priority: 'Normal'
      });
    }

    // 7. Update and Save Dispute
    dispute.status = 'ACCEPTED';
    dispute.adminDecision = {
      decidedBy: req.user._id,
      decidedByName: req.user.fullName || req.user.name || 'Admin',
      decidedByRole: req.user.role || 'admin',
      decision: 'ACCEPT',
      note: note.trim(),
      newTrustScoreSet: targetScore,
      decidedAt: new Date()
    };
    dispute.resolution.resolvedAt = new Date();
    await dispute.save();

    // 8. Encrypted Audit Log
    await logAction(
      req.user.trackId || req.user._id,
      req.user.fullName || req.user.name,
      req.user.role,
      'Trust Dispute Accepted',
      `Dispute #${dispute.disputeTrackId} accepted for ${student.fullName || student.name}. Corrected attendance, restored ${pointsToRestore} points, new score: ${targetScore}.`,
      'audit',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'trust',
        subType: 'dispute-accept',
        disputeTrackId: dispute.disputeTrackId,
        studentTrackId: student.trackId,
        pointsRestored: pointsToRestore,
        newTrustScore: targetScore
      }
    );

    return res.json({
      ok: true,
      message: `Dispute accepted and automatic correction transaction executed successfully for ${student.fullName || student.name}.`,
      data: dispute
    });
  } catch (err) {
    console.error('[Dispute Decide Error]:', err);
    return res.status(500).json({ error: 'Internal server error deciding dispute' });
  }
});

/**
 * POST /api/trust/disputes/:id/withdraw
 * Student endpoint: Withdraw an open dispute
 */
router.post('/disputes/:id/withdraw', async (req, res) => {
  try {
    const dispute = await M.TrustDispute.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { disputeTrackId: req.params.id }
      ].filter(Boolean)
    });
    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found', code: 'DISPUTE_NOT_FOUND' });
    }

    if (String(dispute.studentId) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Only the submitting student can withdraw this dispute', code: 'FORBIDDEN' });
    }

    if (!['PENDING_TEACHER', 'PENDING_ADVISOR'].includes(dispute.status)) {
      return res.status(400).json({ error: `Cannot withdraw dispute in ${dispute.status} status`, code: 'INVALID_STATUS' });
    }

    dispute.status = 'WITHDRAWN';
    await dispute.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.fullName || req.user.name,
      req.user.role,
      'Trust Dispute Withdrawn',
      `Student withdrew dispute #${dispute.disputeTrackId}.`,
      'audit',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'trust', subType: 'dispute-withdraw', disputeTrackId: dispute.disputeTrackId }
    );

    return res.json({ ok: true, message: 'Dispute withdrawn successfully' });
  } catch (err) {
    console.error('[Dispute Withdraw Error]:', err);
    return res.status(500).json({ error: 'Internal server error withdrawing dispute' });
  }
});

// ─────────────────────────────────────────────────────────────
// DEVICE SHARING / FRIEND-MARKING CASES (§13, §16, Phase T7)
// ─────────────────────────────────────────────────────────────

/**
 * GET /api/trust/cases
 * Super Admin (own department) or Sudo Admin (all) list device share cases (§13, §16)
 */
router.get('/cases', async (req, res) => {
  try {
    const isSuper = req.user.isSuperAdmin || ['superAdmin', 'sudoAdmin'].includes(req.user.accessRole);
    const isSudoUser = req.user.isSudoAdmin || req.user.accessRole === 'sudoAdmin' || req.user.role === 'sudo' || isSudo(req);

    if (!isSuper && !isSudoUser) {
      return res.status(403).json({ error: 'Super Admin or Sudo Admin privileges required', code: 'ROLE_FORBIDDEN' });
    }

    const filter = {};
    if (!isSudoUser && req.user.deptId) {
      filter.deptId = req.user.deptId;
    }
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const cases = await M.DeviceShareCase.find(filter)
      .populate('deptId', 'name code')
      .populate('students.studentId', 'fullName name registerNo trackId currentSemester sem')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, cases });
  } catch (err) {
    console.error('[DeviceShareCase List Error]:', err);
    return res.status(500).json({ error: 'Internal server error retrieving device share cases' });
  }
});

/**
 * GET /api/trust/cases/:id
 * Retrieve details of a device share case
 */
router.get('/cases/:id', async (req, res) => {
  try {
    const isSuper = req.user.isSuperAdmin || ['superAdmin', 'sudoAdmin'].includes(req.user.accessRole);
    const isSudoUser = req.user.isSudoAdmin || req.user.accessRole === 'sudoAdmin' || req.user.role === 'sudo' || isSudo(req);

    if (!isSuper && !isSudoUser) {
      return res.status(403).json({ error: 'Super Admin or Sudo Admin privileges required', code: 'ROLE_FORBIDDEN' });
    }

    const caseDoc = await M.DeviceShareCase.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { caseId: req.params.id }
      ].filter(Boolean)
    })
      .populate('deptId', 'name code')
      .populate('students.studentId', 'fullName name registerNo trackId currentSemester sem')
      .lean();

    if (!caseDoc) {
      return res.status(404).json({ error: 'Device share case not found', code: 'CASE_NOT_FOUND' });
    }

    if (!isSudoUser && !isSuperAdminForDept(req.user, caseDoc.deptId?._id || caseDoc.deptId)) {
      return res.status(403).json({ error: 'Cannot view device share case for another department', code: 'DEPT_FORBIDDEN' });
    }

    return res.json({ ok: true, data: caseDoc });
  } catch (err) {
    console.error('[DeviceShareCase Detail Error]:', err);
    return res.status(500).json({ error: 'Internal server error retrieving case detail' });
  }
});

/**
 * POST /api/trust/cases/:id/confirm
 * Super Admin (own department) or Sudo Admin confirms friend-marking (§13, T7.3)
 * Applies: past marks to Absent, 15-day lock, -5% attendance adjustment, DEVICE_SHARED events
 * Body: { note: string, absentDays?: number, lockDays?: number, penaltyPct?: number }
 */
router.post('/cases/:id/confirm', async (req, res) => {
  try {
    const isSuper = req.user.isSuperAdmin || ['superAdmin', 'sudoAdmin'].includes(req.user.accessRole);
    const isSudoUser = req.user.isSudoAdmin || req.user.accessRole === 'sudoAdmin' || req.user.role === 'sudo' || isSudo(req);

    if (!isSuper && !isSudoUser) {
      return res.status(403).json({ error: 'Super Admin or Sudo Admin privileges required', code: 'ROLE_FORBIDDEN' });
    }

    const { note, absentDays, lockDays, penaltyPct } = req.body;
    if (!note || typeof note !== 'string' || note.trim().length === 0) {
      return res.status(400).json({ error: 'Decision note is required explaining rationale', code: 'NOTE_REQUIRED' });
    }

    const caseDoc = await M.DeviceShareCase.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { caseId: req.params.id }
      ].filter(Boolean)
    });
    if (!caseDoc) {
      return res.status(404).json({ error: 'Device share case not found', code: 'CASE_NOT_FOUND' });
    }

    if (!isSudoUser && !isSuperAdminForDept(req.user, caseDoc.deptId)) {
      return res.status(403).json({ error: 'Cannot confirm device share case for another department', code: 'DEPT_FORBIDDEN' });
    }

    if (caseDoc.status !== 'OPEN') {
      return res.status(400).json({ error: `Case is already in ${caseDoc.status} status`, code: 'CASE_ALREADY_RESOLVED' });
    }

    const trustSetting = await getSettings('trust');
    const numAbsentDays = Number(absentDays || trustSetting?.deviceShareAbsentDays || 7);
    const numLockDays = Number(lockDays || trustSetting?.deviceShareLockDays || 15);
    const numPenaltyPct = Number(penaltyPct || trustSetting?.deviceShareAttendancePenaltyPct || 5);

    const cutoffDate = new Date(Date.now() - numAbsentDays * 86400000);
    let totalMarksTurnedAbsent = 0;

    // Apply penalties to both students in the case (§13)
    for (const stItem of caseDoc.students || []) {
      const student = await M.Student.findById(stItem.studentId);
      if (!student) continue;

      // 1. Turn self-marks in the last N days to Absent
      const classAttDocs = await M.ClassAttendance.find({
        date: { $gte: cutoffDate },
        'periods.records.studentTrackId': student.trackId
      });

      for (const ca of classAttDocs) {
        let changed = false;
        for (const p of ca.periods || []) {
          for (const r of p.records || []) {
            if (r.studentTrackId === student.trackId && r.status === 'P') {
              r.status = 'AB';
              r.history = r.history || [];
              r.history.push({
                status: 'AB',
                reason: 'Device Sharing Penalty',
                by: req.user.fullName || req.user.name,
                role: req.user.role || 'admin',
                at: new Date(),
                note: `Turned absent via DeviceShareCase #${caseDoc.caseId}`
              });
              changed = true;
              totalMarksTurnedAbsent++;
            }
          }
        }
        if (changed) await ca.save();
      }

      // 2. Lock self-attendance for 15 days
      student.trust = student.trust || {};
      student.trust.locked = true;
      student.trust.lockedUntil = new Date(Date.now() + numLockDays * 86400000);
      student.trust.lockReason = `Device sharing confirmed (Case #${caseDoc.caseId})`;
      await student.save();

      // Write LOCK and DEVICE_SHARED trust events
      try {
        await applyTrustEvent({
          studentId: student._id,
          studentTrackId: student.trackId,
          type: 'LOCK',
          delta: 0,
          refKey: `DEVICE_SHARED_LOCK:${caseDoc._id}:${student._id}`,
          refs: { caseId: String(caseDoc._id) },
          reason: `Self-attendance locked ${numLockDays} days: ${note.trim()}`,
          actor: { trackId: req.user.trackId || req.user._id, name: req.user.fullName || req.user.name, role: req.user.role },
          ip: req.ip
        });
      } catch (lockEvtErr) {
        console.warn('[DeviceShareCase Lock Event Warning]:', lockEvtErr.message);
      }

      try {
        await applyTrustEvent({
          studentId: student._id,
          studentTrackId: student.trackId,
          type: 'DEVICE_SHARED',
          delta: 0,
          refKey: `DEVICE_SHARED:${caseDoc._id}:${student._id}`,
          refs: { caseId: String(caseDoc._id) },
          reason: `Confirmed device sharing: ${note.trim()}`,
          actor: { trackId: req.user.trackId || req.user._id, name: req.user.fullName || req.user.name, role: req.user.role },
          ip: req.ip
        });
      } catch (shareEvtErr) {
        console.warn('[DeviceShareCase Event Warning]:', shareEvtErr.message);
      }

      // 3. -5% Attendance Adjustment (AttendanceAdjustment)
      const sem = student.currentSemester || student.sem || 1;
      await M.AttendanceAdjustment.create({
        studentId: student._id,
        studentTrackId: student.trackId,
        semester: sem,
        academicYear: student.admissionYear || '',
        deltaPct: -numPenaltyPct,
        kind: 'DEVICE_SHARE_PENALTY',
        reason: `Friend-marking confirmed penalty (-${numPenaltyPct}%) for Case #${caseDoc.caseId}`,
        refCaseId: caseDoc._id,
        appliedBy: req.user.fullName || req.user.name || 'Admin'
      });

      // 4. Notify Student
      await sendNotificationSafe({
        type: 'trust-dispute',
        from: req.user.fullName || req.user.name,
        fromRole: 'Admin',
        toStudentId: student._id,
        toStudentTrackId: student.trackId,
        toStudentName: student.fullName || student.name,
        message: `Device sharing confirmed for Case #${caseDoc.caseId}. Self-attendance locked for ${numLockDays} days and attendance adjusted.`,
        priority: 'High'
      });
    }

    caseDoc.status = 'CONFIRMED';
    caseDoc.decision = {
      decidedBy: {
        trackId: req.user.trackId || req.user._id,
        name: req.user.fullName || req.user.name,
        role: req.user.role || 'admin'
      },
      note: note.trim(),
      decidedAt: new Date()
    };
    caseDoc.actionsApplied = {
      marksTurnedAbsent: totalMarksTurnedAbsent,
      lockedDays: numLockDays,
      penaltyPct: -numPenaltyPct,
      appliedAt: new Date()
    };
    await caseDoc.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.fullName || req.user.name,
      req.user.role,
      'Device Share Case Confirmed',
      `Device sharing case #${caseDoc.caseId} confirmed by ${req.user.fullName || req.user.name}. Penalties applied: ${totalMarksTurnedAbsent} marks turned absent, ${numLockDays}-day lock, -${numPenaltyPct}% adjustment.`,
      'audit',
      'warning',
      req.ip,
      req.user.sessionId,
      {
        module: 'trust',
        subType: 'device-share-confirm',
        caseId: caseDoc.caseId,
        studentsCount: caseDoc.students?.length
      }
    );

    return res.json({
      ok: true,
      message: `Device sharing confirmed for Case #${caseDoc.caseId}. Penalties applied to all involved students.`,
      data: caseDoc
    });
  } catch (err) {
    console.error('[DeviceShareCase Confirm Error]:', err);
    return res.status(500).json({ error: 'Internal server error confirming device share case' });
  }
});

/**
 * POST /api/trust/cases/:id/dismiss
 * Super Admin or Sudo dismisses device share case (e.g. verified legitimate sharing or lab PC)
 * Body: { note: string }
 */
router.post('/cases/:id/dismiss', async (req, res) => {
  try {
    const isSuper = req.user.isSuperAdmin || ['superAdmin', 'sudoAdmin'].includes(req.user.accessRole);
    const isSudoUser = req.user.isSudoAdmin || req.user.accessRole === 'sudoAdmin' || req.user.role === 'sudo' || isSudo(req);

    if (!isSuper && !isSudoUser) {
      return res.status(403).json({ error: 'Super Admin or Sudo Admin privileges required', code: 'ROLE_FORBIDDEN' });
    }

    const { note } = req.body;
    if (!note || typeof note !== 'string' || note.trim().length === 0) {
      return res.status(400).json({ error: 'Dismissal explanation note is required', code: 'NOTE_REQUIRED' });
    }

    const caseDoc = await M.DeviceShareCase.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { caseId: req.params.id }
      ].filter(Boolean)
    });
    if (!caseDoc) {
      return res.status(404).json({ error: 'Device share case not found', code: 'CASE_NOT_FOUND' });
    }

    if (!isSudoUser && !isSuperAdminForDept(req.user, caseDoc.deptId)) {
      return res.status(403).json({ error: 'Cannot dismiss device share case for another department', code: 'DEPT_FORBIDDEN' });
    }

    if (caseDoc.status !== 'OPEN') {
      return res.status(400).json({ error: `Case is already in ${caseDoc.status} status`, code: 'CASE_ALREADY_RESOLVED' });
    }

    caseDoc.status = 'DISMISSED';
    caseDoc.decision = {
      decidedBy: {
        trackId: req.user.trackId || req.user._id,
        name: req.user.fullName || req.user.name,
        role: req.user.role || 'admin'
      },
      note: note.trim(),
      decidedAt: new Date()
    };
    await caseDoc.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.fullName || req.user.name,
      req.user.role,
      'Device Share Case Dismissed',
      `Device sharing case #${caseDoc.caseId} dismissed by ${req.user.fullName || req.user.name}. Note: ${note.trim()}`,
      'audit',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'trust', subType: 'device-share-dismiss', caseId: caseDoc.caseId }
    );

    return res.json({
      ok: true,
      message: `Device sharing case #${caseDoc.caseId} dismissed without penalty.`,
      data: caseDoc
    });
  } catch (err) {
    console.error('[DeviceShareCase Dismiss Error]:', err);
    return res.status(500).json({ error: 'Internal server error dismissing device share case' });
  }
});

module.exports = router;


