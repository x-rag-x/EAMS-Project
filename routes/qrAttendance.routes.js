const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { qrAttendanceLimiter } = require('../utils/rateLimiters');
const { checkLiveSessionGuard } = require('../middleware/portalGuard');
const { logAction } = require('../utils/logAction');
const {
  encryptQrPayload,
  decryptQrPayload,
  getQrWindowInfo,
  verifyQrToken,
  DEFAULT_QR_INTERVAL_SEC,
  DEFAULT_GRACE_PERIOD_SEC,
  encryptSid,
  decryptSid,
  encryptQid,
  decryptQid,
  encryptTime,
  decryptTime
} = require('../utils/qrCrypto');

/**
 * GET /api/qr-attendance/generate-qr
 * Generate QR code image from text data
 */
router.get('/generate-qr', async (req, res) => {
  try {
    const { data, size } = req.query;

    if (!data) {
      return res.status(400).json({ error: 'Missing data parameter' });
    }

    const qrSize = parseInt(size) || 300;

    // Generate QR code as PNG buffer
    const qrImage = await QRCode.toBuffer(data, {
      errorCorrectionLevel: 'H',
      type: 'png',
      width: qrSize,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(qrImage);
  } catch (err) {
    console.error('[QR Generate Error]:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

/**
 * GET /api/qr-attendance/qr-data/:sessionId
 * Teacher endpoint: Generates active encrypted QR code URL and rotation details
 */
router.get('/qr-data/:sessionId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Teachers only' });
    }

    const teacherTrackId = req.user.trackId || String(req.user._id);
    const idParam = req.params.sessionId;
    const idQueries = [{ trackId: idParam }];
    const mongoose = require('mongoose');
    if (typeof idParam === 'string' && mongoose.Types.ObjectId.isValid(idParam) && idParam.length === 24) {
      idQueries.unshift({ _id: idParam });
    }
    const session = await M.LiveSession.findOne({
      $and: [
        { $or: idQueries },
        req.user.role === 'admin' ? {} : { $or: [{ teacherId: req.user._id }, { teacherTrackId }] }
      ]
    });

    if (!session) {
      return res.status(404).json({ error: 'Live session not found' });
    }

    if (!session.active || session.expiresAt < new Date()) {
      return res.json({ active: false, error: 'Session is no longer active' });
    }

    const scanSession = await M.ScanLiveSession.findOne({ sessionTrackId: session.trackId }).lean();
    const rotCount = scanSession?.rotationCount || 2;
    const rotTimeSec = session.qrIntervalSec || scanSession?.rotationTimeSec || DEFAULT_QR_INTERVAL_SEC;

    const startTime = scanSession?.startedAt ? new Date(scanSession.startedAt).getTime() : new Date(session.createdAt || Date.now()).getTime();
    const elapsedTotalSec = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
    const currentRotation = Math.min(rotCount, Math.floor(elapsedTotalSec / rotTimeSec) + 1);
    const isExpired = elapsedTotalSec >= (rotCount * rotTimeSec);

    if (isExpired) {
      await Promise.all([
        M.LiveSession.updateOne({ _id: session._id }, { active: false }),
        M.ScanLiveSession.updateOne({ sessionTrackId: session.trackId }, { active: false, endedAt: new Date() })
      ]);
      return res.json({ active: false, error: 'Session rotation time completed', expired: true });
    }

    const intervalSec = rotTimeSec;
    const windowInfo = getQrWindowInfo(session.qrSecret, intervalSec, DEFAULT_GRACE_PERIOD_SEC);

    const encSid = encryptSid(session.trackId);
    const encQid = encryptQid(windowInfo.currentQrTrackId);
    const qrPath = `/index.html?method=att&sid=${encodeURIComponent(encSid)}&qid=${encodeURIComponent(encQid)}`;

    // Build full QR URL with production domain or incoming request host
    const cfg = require('../config');
    const reqHost = req.get('host');
    let baseUrl = cfg.PRODUCTION_DOMAIN || (reqHost ? `${req.protocol}://${reqHost}` : `http://localhost:${cfg.PORT || 3000}`);
    if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      baseUrl = 'http://' + baseUrl;
    }
    const fullQrUrl = baseUrl + qrPath;

    // Get current counts
    const [completedCount, pendingCount] = await Promise.all([
      M.LiveSessionsAtt.countDocuments({ sessionTrackId: session.trackId, status: 'completed' }),
      M.LiveSessionsAtt.countDocuments({ sessionTrackId: session.trackId, status: 'pending' })
    ]);

    res.json({
      active: true,
      sessionTrackId: session.trackId,
      qrUrl: qrPath,
      fullQrUrl: fullQrUrl,
      qrTrackId: windowInfo.currentQrTrackId,
      previousQrTrackId: windowInfo.previousQrTrackId,
      expiresInMs: windowInfo.expiresInMs,
      windowElapsedSec: windowInfo.windowElapsedSec,
      intervalSec: windowInfo.intervalSec,
      currentRotation: currentRotation,
      totalRotations: rotCount,
      rotationCount: rotCount,
      completedCount,
      pendingCount,
      totalParticipants: completedCount + pendingCount
    });
  } catch (err) {
    console.error('[QR Data Error]:', err);
    res.status(500).json({ error: 'Failed to generate QR data' });
  }
});

/**
 * POST /api/qr-attendance/save-draft/:sessionId
 * Teacher endpoint: Persists current scan live participation state as a draft in database
 */
router.post('/save-draft/:sessionId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Teachers only' });
    }
    const idParam = req.params.sessionId;
    const query = { $or: [{ sessionTrackId: idParam }, { trackId: idParam }] };
    const mongoose = require('mongoose');
    if (typeof idParam === 'string' && mongoose.Types.ObjectId.isValid(idParam) && idParam.length === 24) {
      query.$or.unshift({ _id: idParam });
    }
    await M.ScanLiveSession.updateOne(query, { isDraftSaved: true });
    res.json({ success: true, message: 'Draft saved' });
  } catch (err) {
    console.error('[QR Save Draft Error]:', err);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

/**
 * POST /api/qr-attendance/log-loaded
 * Teacher endpoint: Creates an audit log entry when QR code is successfully rendered and ready for scanning
 */
router.post('/log-loaded', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Teachers only' });
    }

    const { sessionTrackId, qrTrackId, loadedAt, intervalSec } = req.body;
    const cleanLoadedAt = loadedAt ? new Date(loadedAt) : new Date();
    const timeStr = cleanLoadedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username,
      req.user.role,
      'QR Code Displayed & Ready',
      `Live QR code displayed and ready for student scanning (Session: ${sessionTrackId || '—'}, Token: ${qrTrackId || '—'}, Duration: ${intervalSec || 20}s) at ${timeStr}`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'teacher',
        subType: 'qr-attendance',
        trackId: qrTrackId,
        sessionTrackId: sessionTrackId
      }
    );

    res.json({ ok: true, loadedAt: cleanLoadedAt });
  } catch (err) {
    console.error('[QR Log Loaded Error]:', err);
    res.status(500).json({ error: 'Failed to log QR load' });
  }
});

/**
 * POST /api/qr-attendance/decrypt-params
 * Authenticated student endpoint: Decrypts URL params (sid, qid, t) and verifies active session
 */
router.post('/decrypt-params', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Students only' });
    }

    const { sid, qid, t } = req.body;
    if (!sid || !qid) {
      return res.status(400).json({ error: 'Session and QR tracking parameters are required' });
    }

    const sessionTrackId = decryptSid(sid);
    const qrTrackId = decryptQid(qid);
    let loginTime = null;
    if (t) {
      const decT = decryptTime(t);
      if (decT) {
        const numT = Number(decT);
        loginTime = !isNaN(numT) ? new Date(numT).toISOString() : new Date(decT).toISOString();
      }
    }

    if (!sessionTrackId || !qrTrackId) {
      return res.status(400).json({ error: 'Invalid or corrupted QR parameters' });
    }

    const session = await M.LiveSession.findOne({ trackId: sessionTrackId });
    if (!session) {
      return res.status(404).json({ error: 'Live session not found' });
    }

    if (!session.active) {
      return res.status(400).json({ error: 'This attendance session has already ended' });
    }

    if (session.expiresAt && session.expiresAt < new Date()) {
      return res.status(400).json({ error: 'This attendance session has expired' });
    }

    res.json({
      success: true,
      sessionTrackId,
      qrTrackId,
      loginTime,
      active: session.active
    });
  } catch (err) {
    console.error('[QR Decrypt Params Error]:', err);
    res.status(500).json({ error: 'Failed to decrypt QR parameters' });
  }
});

/**
 * POST /api/qr-attendance/submit
 * Student single attendance submission endpoint:
 * Creates draft (pending) record, executes server validations, updates to completed if valid.
 */
router.post('/submit', qrAttendanceLimiter, authMiddleware, checkLiveSessionGuard, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Students only' });
    }

    const {
      sessionTrackId: rawSessionTrackId,
      qrTrackId: rawQrTrackId,
      latitude,
      longitude,
      accuracy,
      deviceId,
      loginTime: rawLoginTime,
      t: rawT
    } = req.body;

    if (!rawSessionTrackId || !rawQrTrackId) {
      return res.status(400).json({ error: 'Session and QR tracking tokens are required' });
    }

    // Resolve student document
    let student = null;
    if (req.user.trackId) student = await M.Student.findOne({ trackId: req.user.trackId });
    if (!student && req.user.username) student = await M.Student.findOne({ username: req.user.username });
    if (!student && req.user._id) student = await M.Student.findById(req.user._id);
    if (!student) {
      return res.status(404).json({ error: 'Student profile not found' });
    }

    // Decrypt parameters if encrypted
    let sessionTrackId = rawSessionTrackId;
    if (rawSessionTrackId.includes('.')) {
      const dec = decryptSid(rawSessionTrackId) || decryptQrPayload(rawSessionTrackId);
      if (dec) sessionTrackId = dec;
    }

    let qrTrackId = rawQrTrackId;
    if (rawQrTrackId.includes('.')) {
      const dec = decryptQid(rawQrTrackId) || decryptQrPayload(rawQrTrackId);
      if (dec) qrTrackId = dec;
    }

    let parsedLoginTime = null;
    if (rawLoginTime) {
      const d = new Date(rawLoginTime);
      if (!isNaN(d.getTime())) parsedLoginTime = d;
    } else if (rawT) {
      const decT = decryptTime(rawT);
      if (decT) {
        const numT = Number(decT);
        const d = new Date(!isNaN(numT) ? numT : decT);
        if (!isNaN(d.getTime())) parsedLoginTime = d;
      }
    }

    const studentTrackId = student.trackId || String(student._id);
    const regNo = student.registerNo || student.regNo || '';
    const studentName = student.fullName || student.name || student.username || '';

    // Check for existing participation attempt (idempotency check)
    let existingRecord = await M.LiveSessionsAtt.findOne({
      sessionTrackId,
      studentId: student._id
    });

    if (existingRecord && existingRecord.status === 'completed') {
      return res.json({
        success: true,
        status: 'completed',
        alreadyMarked: true,
        message: 'Attendance participation has already been verified and saved.'
      });
    }

    // Initialize/upsert draft record with pending status
    const draftData = {
      sessionTrackId,
      studentId: student._id,
      studentTrackId,
      studentName,
      regNo,
      qrTrackId,
      markedAt: new Date(),
      loginTime: parsedLoginTime,
      latitude: latitude !== undefined ? Number(latitude) : undefined,
      longitude: longitude !== undefined ? Number(longitude) : undefined,
      locationAccuracy: accuracy !== undefined ? Number(accuracy) : undefined,
      ipAddress: req.ip,
      deviceId: deviceId ? String(deviceId) : '',
      deviceSessionId: req.user.sessionId || '',
      userAgent: req.headers['user-agent'] || '',
      status: 'pending'
    };

    if (!existingRecord) {
      try {
        existingRecord = await M.LiveSessionsAtt.create(draftData);
      } catch (dupErr) {
        // Handled if race condition hit unique index
        existingRecord = await M.LiveSessionsAtt.findOne({ sessionTrackId, studentId: student._id });
        if (existingRecord && existingRecord.status === 'completed') {
          return res.json({
            success: true,
            status: 'completed',
            alreadyMarked: true,
            message: 'Attendance participation has already been recorded.'
          });
        }
      }
    } else {
      Object.assign(existingRecord, draftData);
      await existingRecord.save();
    }

    // ==========================================
    // SERVER-SIDE VERIFICATION SEQUENCE
    // ==========================================
    const verification = {
      authOk: true,
      sessionOk: false,
      qrOk: false,
      expiryOk: false,
      deviceOk: false,
      duplicateOk: true,
      locationOk: latitude !== undefined && longitude !== undefined,
      failReason: ''
    };

    // 1. Session check
    const liveSession = await M.LiveSession.findOne({ trackId: sessionTrackId });
    if (!liveSession) {
      verification.failReason = 'Live session not found';
    } else if (!liveSession.active) {
      verification.failReason = 'Live session has ended';
    } else if (liveSession.expiresAt < new Date()) {
      verification.failReason = 'Live session expired';
    } else {
      // Check class match if session has classId
      if (liveSession.classId && student.classId && String(liveSession.classId) !== String(student.classId)) {
        verification.failReason = 'Live session does not belong to your enrolled class';
      } else {
        verification.sessionOk = true;
      }
    }

    // 2. QR Token and Expiry with Grace Period check
    let qrVerification = { valid: false, type: 'invalid' };
    if (verification.sessionOk && liveSession) {
      qrVerification = verifyQrToken(
        qrTrackId,
        liveSession.qrSecret,
        liveSession.qrIntervalSec || DEFAULT_QR_INTERVAL_SEC,
        DEFAULT_GRACE_PERIOD_SEC
      );

      verification.qrOk = qrVerification.valid;
      verification.expiryOk = qrVerification.valid;
      if (!qrVerification.valid) {
        verification.failReason = qrVerification.reason || 'Invalid or expired QR code';
      }
    }

    // 3. Cross-device and One-device Restriction check
    if (verification.sessionOk && verification.qrOk) {
      if (deviceId) {
        // Prevent another student from marking attendance on the same physical device in the same live session
        const proxyCheck = await M.LiveSessionsAtt.findOne({
          sessionTrackId,
          deviceId: String(deviceId),
          studentId: { $ne: student._id },
          status: 'completed'
        });

        if (proxyCheck) {
          verification.deviceOk = false;
          verification.failReason = 'This physical device was already used by another student for this session';
        } else {
          verification.deviceOk = true;
        }
      } else {
        // If deviceId wasn't provided, permit as standard session bound to user login
        verification.deviceOk = true;
      }
    }

    // 4. Determine final status
    const allPassed =
      verification.authOk &&
      verification.sessionOk &&
      verification.qrOk &&
      verification.expiryOk &&
      verification.deviceOk &&
      verification.duplicateOk;

    existingRecord.qrWindowIndex = qrVerification.matchedWindowIndex;
    existingRecord.qrWindowType = qrVerification.type || 'invalid';
    existingRecord.qrDetails = {
      scannedQrId: qrTrackId,
      currentQrId: qrVerification.currentQrTrackId || '',
      previousQrId: qrVerification.previousQrTrackId || '',
      windowAgeSec: qrVerification.windowElapsedSec || 0,
      inGracePeriod: !!qrVerification.inGracePeriod,
    };
    existingRecord.verificationDetails = verification;

    if (allPassed) {
      existingRecord.status = 'completed';
      existingRecord.verificationCompletedAt = new Date();
      await existingRecord.save();

      // Mirror to LiveSession.markedStudents for backwards compatibility with teacher summary
      await M.LiveSession.updateOne(
        { trackId: sessionTrackId, "markedStudents.studentId": { $ne: student._id } },
        {
          $push: {
            markedStudents: {
              studentId: student._id,
              regNo: regNo,
              time: new Date(),
              ip: req.ip
            }
          }
        }
      );

      // Mirror to ScanLiveSession for audit trail and draft saving
      try {
        await M.ScanLiveSession.updateOne(
          { sessionTrackId: sessionTrackId, "records.studentId": { $ne: student._id } },
          {
            $push: {
              records: {
                studentId: student._id,
                studentTrackId: studentTrackId,
                studentName: studentName,
                regNo: regNo,
                qrTrackId: qrTrackId,
                status: 'completed',
                markedAt: new Date(),
                ipAddress: req.ip,
                deviceId: deviceId ? String(deviceId) : '',
                verificationCompletedAt: new Date()
              }
            }
          }
        );
      } catch (scanUpdErr) {
        console.warn('ScanLiveSession update warning:', scanUpdErr.message);
      }

      return res.json({
        success: true,
        status: 'completed',
        message: 'Attendance participation recorded successfully.',
        verification: {
          status: 'completed',
          windowType: qrVerification.type,
          inGracePeriod: qrVerification.inGracePeriod
        }
      });
    } else {
      existingRecord.status = 'pending';
      await existingRecord.save();

      return res.json({
        success: true,
        status: 'pending',
        message: 'Attendance participation recorded and pending teacher verification.',
        failReason: verification.failReason,
        verification: {
          status: 'pending',
          failReason: verification.failReason
        }
      });
    }
  } catch (err) {
    console.error('[QR Submit Error]:', err);
    res.status(500).json({ error: 'Internal server error processing attendance submission' });
  }
});

/**
 * GET /api/qr-attendance/participation/:sessionTrackId
 * Teacher endpoint: Loads completed and pending attendance participation records
 */
router.get('/participation/:sessionTrackId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Teachers only' });
    }

    const sessionTrackId = req.params.sessionTrackId;
    const records = await M.LiveSessionsAtt.find({ sessionTrackId })
      .sort({ markedAt: 1 })
      .lean();

    const completed = records.filter(r => r.status === 'completed');
    const pending = records.filter(r => r.status === 'pending');

    res.json({
      sessionTrackId,
      totalCount: records.length,
      completedCount: completed.length,
      pendingCount: pending.length,
      completed,
      pending,
      records
    });
  } catch (err) {
    console.error('[QR Participation Error]:', err);
    res.status(500).json({ error: 'Failed to retrieve participation records' });
  }
});

module.exports = router;
