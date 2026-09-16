const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { liveSessionMarkLimiter } = require('../utils/rateLimiters');
const { checkLiveSessionGuard } = require('../middleware/portalGuard');

const mongoose = require('mongoose');

function generate12CharCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

router.post('/start', authMiddleware, checkLiveSessionGuard, async (req, res) => {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Only teachers can start live sessions' });
  try {
    const { classId, subjectId, date, attendanceMode = 'code', periodNumber = 1 } = req.body;
    if (!classId || !subjectId || !date) return res.status(400).json({ error: 'classId, subjectId, date required' });

    const teacherTrackId = req.user.trackId || String(req.user._id);
    const trackId = 'TR_LS_' + Math.random().toString(36).substr(2, 9).toUpperCase();

    const isValidObjId = (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && id.length === 24;

    // Resolve Class ObjectId safely
    let targetClassId = classId;
    const classQueries = [{ trackId: classId }, { name: classId }];
    if (isValidObjId(classId)) classQueries.unshift({ _id: classId });
    const cls = await M.Class.findOne({ $or: classQueries }).lean();
    if (cls) targetClassId = cls._id;

    // Resolve Subject ObjectId safely
    let targetSubjectId = subjectId;
    const subQueries = [{ trackId: subjectId }, { subjectCode: subjectId }, { name: subjectId }, { code: subjectId }];
    if (isValidObjId(subjectId)) subQueries.unshift({ _id: subjectId });
    const sub = await M.Subject.findOne({ $or: subQueries }).lean();
    if (sub) targetSubjectId = sub._id;

    // Close any existing active sessions for this teacher/class
    await M.LiveSession.updateMany({
      $or: [{ teacherId: req.user._id }, { teacherTrackId }, { classId: targetClassId }],
      active: true
    }, { active: false });

    await M.ScanLiveSession.updateMany({
      $or: [{ teacherId: req.user._id }, { teacherTrackId }, { classId: targetClassId }],
      active: true
    }, { active: false });

    // 12-character alphanumeric passcode
    const passcode = generate12CharCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
    const crypto = require('crypto');
    const qrSecret = crypto.randomBytes(24).toString('hex');

    // Fetch dynamic rotation settings from system settings
    const settingsDoc = await M.Settings.findOne({ key: 'attendance' }).lean();
    const attConfig = settingsDoc?.value || {};
    const rotCount = Math.max(1, Number(attConfig.rotationCount) || 2);
    const rotTimeSec = Math.max(10, Number(attConfig.rotationTimeSec || attConfig.qrIntervalSec) || 60);

    const session = await M.LiveSession.create({
      trackId,
      teacherId: req.user._id,
      teacherTrackId,
      classId: targetClassId,
      subjectId: targetSubjectId,
      date,
      passcode,
      attendanceMode: attendanceMode === 'qr' ? 'qr' : 'code',
      qrSecret,
      qrIntervalSec: rotTimeSec,
      expiresAt,
      active: true,
      markedStudents: []
    });

    // Mirror to ScanLiveSession for draft review and reporting
    try {
      await M.ScanLiveSession.create({
        sessionTrackId: trackId,
        teacherId: req.user._id,
        teacherTrackId,
        classId: targetClassId,
        subjectId: targetSubjectId,
        date,
        periodNumber: Number(periodNumber) || 1,
        rotationCount: rotCount,
        rotationTimeSec: rotTimeSec,
        currentRotation: 1,
        qrSecret,
        active: true,
        records: [],
        qrCodes: []
      });
    } catch (scanErr) {
      console.warn('ScanLiveSession creation notice:', scanErr.message);
    }

    res.status(201).json(session);
  } catch (err) {
    console.error('[LiveSession /start Error]:', err);
    res.status(500).json({ error: 'Failed to start live session: ' + err.message });
  }
});

router.get('/active', authMiddleware, checkLiveSessionGuard, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Students only' });
  try {
    // Find student's classId
    let student = null;
    if (req.user.trackId) student = await M.Student.findOne({ trackId: req.user.trackId });
    if (!student && req.user.username) student = await M.Student.findOne({ username: req.user.username });
    if (!student && req.user._id) student = await M.Student.findById(req.user._id);
    if (!student || !student.classId) return res.json({ active: false });

    // Find active session for this class
    const session = await M.LiveSession.findOne({ classId: student.classId, active: true, expiresAt: { $gt: new Date() } }).populate('subjectId', 'name').lean();
    if (!session) return res.json({ active: false });

    // Check if already marked
    const alreadyMarked = session.markedStudents.some(s => String(s.studentId) === String(student._id));

    res.json({ active: true, sessionId: session._id, subjectName: session.subjectId?.name || 'Subject', alreadyMarked });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/mark', liveSessionMarkLimiter, authMiddleware, checkLiveSessionGuard, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Students only' });
  const { sessionId, passcode } = req.body;

  try {
    let student = null;
    if (req.user.trackId) student = await M.Student.findOne({ trackId: req.user.trackId });
    if (!student && req.user.username) student = await M.Student.findOne({ username: req.user.username });
    if (!student && req.user._id) student = await M.Student.findById(req.user._id);
    if (!student) return res.status(404).json({ error: 'Student profile not found' });

    const session = await M.LiveSession.findById(sessionId);
    if (!session || !session.active || session.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Session is no longer active' });
    }

    // IP Check
    const settings = await M.Settings.findOne({ key: 'college_ips' });
    const allowed = settings ? settings.value : [];
    let isAllowed = allowed.length === 0; // if empty, allow all
    if (!isAllowed) {
      for (const ip of allowed) {
        if (req.ip.startsWith(ip) || (ip === '::1' && req.ip === '::1') || (ip === '127.0.0.1' && req.ip === '127.0.0.1') || req.ip.includes(ip)) {
          isAllowed = true; break;
        }
      }
    }
    if (!isAllowed) return res.status(403).json({ error: 'Must connect via College Wi-Fi' });

    // Passcode Check
    if (session.passcode !== passcode) {
      return res.status(400).json({ error: 'Incorrect Passcode' });
    }

    // Already marked?
    const alreadyMarked = session.markedStudents.some(s => String(s.studentId) === String(student._id));
    if (alreadyMarked) return res.json({ success: true, message: 'Already marked' });

    session.markedStudents.push({
      studentId: student._id,
      regNo: student.registerNo || student.regNo,
      time: new Date(),
      ip: req.ip
    });
    await session.save();

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/status/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const teacherTrackId = req.user.trackId || String(req.user._id);
    const idParam = req.params.id;
    const idQueries = [{ trackId: idParam }];
    if (typeof idParam === 'string' && mongoose.Types.ObjectId.isValid(idParam) && idParam.length === 24) {
      idQueries.unshift({ _id: idParam });
    }
    const session = await M.LiveSession.findOne({
      $and: [
        { $or: idQueries },
        { $or: [{ teacherId: req.user._id }, { teacherTrackId }] }
      ]
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    
    const qrParticipation = await M.LiveSessionsAtt.find({
      sessionTrackId: session.trackId
    }).select('studentId studentTrackId studentName regNo status qrWindowType markedAt verificationCompletedAt verificationDetails latitude longitude locationAccuracy deviceId').lean();

    res.json({
      active: session.active,
      passcode: session.passcode,
      attendanceMode: session.attendanceMode || 'code',
      qrIntervalSec: session.qrIntervalSec || 15,
      trackId: session.trackId,
      expiresAt: session.expiresAt,
      markedStudents: session.markedStudents,
      qrParticipation: qrParticipation || []
    });
  } catch (err) {
    console.error('[LiveSession /status Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/end/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const teacherTrackId = req.user.trackId || String(req.user._id);
    const idParam = req.params.id;
    const idQueries = [{ trackId: idParam }];
    if (typeof idParam === 'string' && mongoose.Types.ObjectId.isValid(idParam) && idParam.length === 24) {
      idQueries.unshift({ _id: idParam });
    }
    await Promise.all([
      M.LiveSession.findOneAndUpdate({
        $and: [
          { $or: idQueries },
          { $or: [{ teacherId: req.user._id }, { teacherTrackId }] }
        ]
      }, { active: false }),
      M.ScanLiveSession.findOneAndUpdate({
        $and: [
          { $or: [{ sessionTrackId: idParam }, { _id: idParam }] },
          { $or: [{ teacherId: req.user._id }, { teacherTrackId }] }
        ]
      }, { active: false, endedAt: new Date() })
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error('[LiveSession /end Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;