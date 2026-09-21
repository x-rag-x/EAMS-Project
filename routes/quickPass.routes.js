const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { liveSessionMarkLimiter } = require('../utils/rateLimiters');
const { checkLiveSessionGuard } = require('../middleware/portalGuard');
const { verifyTeacherAssignment, verifySessionOwner } = require('../utils/assignmentAuth');
const { isCampusIpAllowed } = require('../utils/ipCheck');

function generate12CharCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(crypto.randomInt(0, chars.length));
  }
  return code;
}

const isValidObjId = (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && id.length === 24;

// 1. Start Quick Pass session (Teacher)
router.post('/start', authMiddleware, checkLiveSessionGuard, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only teachers can start Quick Pass sessions' });
  }

  try {
    const { classId, subjectId, date, periodNumber = 1 } = req.body;
    if (!classId || !subjectId || !date) {
      return res.status(400).json({ error: 'Class, Subject, and Date are required' });
    }

    const teacherTrackId = req.user.trackId || String(req.user._id);

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

    // Verify teacher assignment (A3)
    const assignCheck = await verifyTeacherAssignment(req.user, targetClassId, targetSubjectId);
    if (!assignCheck.allowed) {
      return res.status(403).json({ error: assignCheck.reason });
    }


    // Close any prior active QuickPassSession for this teacher or class
    await M.QuickPassSession.updateMany({
      $or: [{ teacherId: req.user._id }, { teacherTrackId }, { classId: targetClassId }],
      active: true
    }, { active: false, endedAt: new Date() });

    // Read attendance settings
    const settingsDoc = await M.Settings.findOne({ key: 'attendance' }).lean();
    const attConfig = settingsDoc?.value || {};
    const rotationCount = Math.max(1, Number(attConfig.rotationCount) || 2);
    const rotationTimeSec = Math.max(10, Number(attConfig.rotationTimeSec) || 60);

    const initialCode = generate12CharCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + rotationTimeSec * 1000);
    const sessionTrackId = 'QP_' + Math.random().toString(36).substr(2, 9).toUpperCase();

    const session = await M.QuickPassSession.create({
      sessionTrackId,
      teacherId: req.user._id,
      teacherTrackId,
      classId: targetClassId,
      subjectId: targetSubjectId,
      date,
      periodNumber: Number(periodNumber) || 1,
      rotationCount,
      rotationTimeSec,
      currentRotation: 1,
      codes: [{
        code: initialCode,
        rotation: 1,
        generatedAt: now,
        expiresAt
      }],
      active: true,
      startedAt: now,
      records: []
    });

    res.json({
      ok: true,
      sessionId: session._id,
      sessionTrackId: session.sessionTrackId,
      currentCode: initialCode,
      currentRotation: 1,
      rotationCount,
      rotationTimeSec,
      expiresAt
    });
  } catch (err) {
    console.error('Quick Pass start error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Poll Quick Pass status (Teacher)
router.get('/status/:sessionId', authMiddleware, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only teachers and admins can view Quick Pass session status' });
  }
  try {
    const { sessionId } = req.params;
    const query = isValidObjId(sessionId)
      ? { $or: [{ _id: sessionId }, { sessionTrackId: sessionId }] }
      : { sessionTrackId: sessionId };

    const session = await M.QuickPassSession.findOne(query);
    if (!session) return res.status(404).json({ error: 'Quick Pass session not found' });

    if (!verifySessionOwner(session, req.user)) {
      return res.status(403).json({ error: 'You can only view your own Quick Pass sessions' });
    }

    const now = new Date();
    let currentCodeObj = session.codes[session.codes.length - 1];

    // Check if current rotation has expired
    if (session.active && currentCodeObj && now > currentCodeObj.expiresAt) {
      if (session.currentRotation < session.rotationCount) {
        // Auto-rotate to next rotation
        session.currentRotation += 1;
        const newCode = generate12CharCode();
        const newExpiresAt = new Date(now.getTime() + session.rotationTimeSec * 1000);
        session.codes.push({
          code: newCode,
          rotation: session.currentRotation,
          generatedAt: now,
          expiresAt: newExpiresAt
        });
        await session.save();
        currentCodeObj = session.codes[session.codes.length - 1];
      } else {
        // All rotations exhausted -> Session completed
        session.active = false;
        session.endedAt = now;
        await session.save();
      }
    }

    // Get total class student count
    const totalStudents = await M.Student.countDocuments({
      $or: [
        { classId: session.classId },
        { class: session.classId }
      ]
    });

    const remainingSec = session.active && currentCodeObj
      ? Math.max(0, Math.round((new Date(currentCodeObj.expiresAt).getTime() - now.getTime()) / 1000))
      : 0;

    res.json({
      ok: true,
      sessionId: session._id,
      sessionTrackId: session.sessionTrackId,
      active: session.active,
      currentCode: currentCodeObj ? currentCodeObj.code : '',
      currentRotation: session.currentRotation,
      rotationCount: session.rotationCount,
      rotationTimeSec: session.rotationTimeSec,
      expiresAt: currentCodeObj ? currentCodeObj.expiresAt : null,
      remainingSec,
      totalStudents,
      completedCount: session.records.length,
      remainingCount: Math.max(0, totalStudents - session.records.length),
      records: session.records,
      isFinalSaved: session.isFinalSaved
    });
  } catch (err) {
    console.error('Quick Pass status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Rotate code manually / triggered (Teacher)
router.post('/rotate/:sessionId', authMiddleware, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only teachers and admins can rotate Quick Pass codes' });
  }
  try {
    const { sessionId } = req.params;
    const query = isValidObjId(sessionId)
      ? { $or: [{ _id: sessionId }, { sessionTrackId: sessionId }] }
      : { sessionTrackId: sessionId };

    const session = await M.QuickPassSession.findOne(query);
    if (!session) return res.status(404).json({ error: 'Quick Pass session not found' });

    if (!verifySessionOwner(session, req.user)) {
      return res.status(403).json({ error: 'You can only rotate codes for your own Quick Pass sessions' });
    }

    if (!session.active) return res.status(400).json({ error: 'Session is no longer active' });

    if (session.currentRotation >= session.rotationCount) {
      session.active = false;
      session.endedAt = new Date();
      await session.save();
      return res.json({ ok: true, active: false, message: 'All rotations exhausted' });
    }

    session.currentRotation += 1;
    const newCode = generate12CharCode();
    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + session.rotationTimeSec * 1000);
    session.codes.push({
      code: newCode,
      rotation: session.currentRotation,
      generatedAt: now,
      expiresAt: newExpiresAt
    });
    await session.save();

    res.json({
      ok: true,
      active: true,
      currentCode: newCode,
      currentRotation: session.currentRotation,
      rotationCount: session.rotationCount,
      expiresAt: newExpiresAt
    });
  } catch (err) {
    console.error('Quick Pass rotate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Mark attendance with Quick Pass code (Student)
router.post('/mark', liveSessionMarkLimiter, authMiddleware, checkLiveSessionGuard, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Students only' });

  try {
    const { code, latitude, longitude, locationAccuracy } = req.body;
    if (!code) return res.status(400).json({ error: 'Please enter the Quick Pass code' });

    const cleanCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleanCode.length !== 12) {
      return res.status(400).json({ error: 'Quick Pass code must be exactly 12 characters' });
    }

    if (latitude !== undefined && latitude !== null && (isNaN(Number(latitude)) || Math.abs(Number(latitude)) > 90)) {
      return res.status(400).json({ error: 'Invalid latitude coordinate' });
    }
    if (longitude !== undefined && longitude !== null && (isNaN(Number(longitude)) || Math.abs(Number(longitude)) > 180)) {
      return res.status(400).json({ error: 'Invalid longitude coordinate' });
    }

    // Resolve student record
    let student = null;
    if (req.user.trackId) student = await M.Student.findOne({ trackId: req.user.trackId });
    if (!student && req.user.username) student = await M.Student.findOne({ username: req.user.username });
    if (!student && req.user._id) student = await M.Student.findById(req.user._id);
    if (!student) return res.status(404).json({ error: 'Student profile not found' });

    // College Wi-Fi / IP check (A8)
    const ipSettings = await M.Settings.findOne({ key: 'college_ips' }).lean();
    const allowedIps = ipSettings ? ipSettings.value : [];
    if (!isCampusIpAllowed(req.ip, allowedIps)) {
      return res.status(403).json({ error: 'Must connect via College Wi-Fi network' });
    }

    // Find active QuickPassSession for this student's class
    const studentClassId = student.classId || student.class;
    const sessionQueries = [{ active: true }];
    if (studentClassId) {
      sessionQueries.push({
        $or: [
          { classId: studentClassId },
          ...(isValidObjId(studentClassId) ? [{ classId: new mongoose.Types.ObjectId(studentClassId) }] : [])
        ]
      });
    }

    const session = await M.QuickPassSession.findOne({ $and: sessionQueries });
    if (!session) {
      return res.status(404).json({ error: 'No active Quick Pass session found for your class' });
    }

    // Check code validity
    const activeCodeObj = session.codes[session.codes.length - 1];
    if (!activeCodeObj || activeCodeObj.code !== cleanCode) {
      // Check if it was an older rotation code
      const olderCode = session.codes.find(c => c.code === cleanCode);
      if (olderCode) {
        return res.status(400).json({ error: 'This code has expired. Please check the screen for the current rotation code.' });
      }
      return res.status(400).json({ error: 'Invalid Quick Pass code. Please recheck.' });
    }

    // Check if rotation timer has passed
    if (new Date() > new Date(activeCodeObj.expiresAt)) {
      return res.status(400).json({ error: 'The code window has expired. Waiting for rotation.' });
    }

    // Check duplicate
    const alreadyMarked = session.records.some(r =>
      String(r.studentId) === String(student._id) ||
      (student.trackId && r.studentTrackId === student.trackId)
    );
    if (alreadyMarked) {
      return res.json({ ok: true, alreadyMarked: true, message: 'You have already marked attendance for this session.' });
    }

    // Record attendance
    session.records.push({
      studentId: student._id,
      studentTrackId: student.trackId || String(student._id),
      regNo: student.registerNo || student.regNo || '',
      studentName: student.name || '',
      codeUsed: cleanCode,
      rotation: session.currentRotation,
      markedAt: new Date(),
      latitude: latitude ? Number(latitude) : undefined,
      longitude: longitude ? Number(longitude) : undefined,
      locationAccuracy: locationAccuracy ? Number(locationAccuracy) : undefined,
      ipAddress: req.ip || '',
      deviceId: req.headers['x-device-id'] || '',
      userAgent: req.headers['user-agent'] || ''
    });

    await session.save();

    res.json({
      ok: true,
      message: 'Attendance successfully marked!',
      markedAt: new Date()
    });
  } catch (err) {
    console.error('Quick Pass mark error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Check active session for student (Student portal check)
router.get('/active', authMiddleware, async (req, res) => {
  try {
    let student = null;
    if (req.user.trackId) student = await M.Student.findOne({ trackId: req.user.trackId });
    if (!student && req.user.username) student = await M.Student.findOne({ username: req.user.username });
    if (!student && req.user._id) student = await M.Student.findById(req.user._id);
    if (!student) return res.json({ active: false });

    const studentClassId = student.classId || student.class;
    if (!studentClassId) return res.json({ active: false });

    const session = await M.QuickPassSession.findOne({
      classId: studentClassId,
      active: true
    }).populate('subjectId', 'name subjectCode').lean();

    if (!session) return res.json({ active: false });

    const alreadyMarked = session.records.some(r =>
      String(r.studentId) === String(student._id) ||
      (student.trackId && r.studentTrackId === student.trackId)
    );

    res.json({
      active: true,
      sessionId: session._id,
      sessionTrackId: session.sessionTrackId,
      subjectName: session.subjectId?.name || 'Subject',
      periodNumber: session.periodNumber,
      date: session.date,
      alreadyMarked
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. End Quick Pass session manually (Teacher)
router.post('/end/:sessionId', authMiddleware, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only teachers and admins can end Quick Pass sessions' });
  }
  try {
    const { sessionId } = req.params;
    const query = isValidObjId(sessionId)
      ? { $or: [{ _id: sessionId }, { sessionTrackId: sessionId }] }
      : { sessionTrackId: sessionId };

    const session = await M.QuickPassSession.findOne(query);
    if (!session) return res.status(404).json({ error: 'Quick Pass session not found' });

    if (!verifySessionOwner(session, req.user)) {
      return res.status(403).json({ error: 'You can only end your own Quick Pass sessions' });
    }

    session.active = false;
    session.endedAt = new Date();
    await session.save();

    res.json({ ok: true, message: 'Quick Pass session ended' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Save Draft / Finalize
router.post('/save-draft/:sessionId', authMiddleware, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only teachers and admins can save drafts' });
  }
  try {
    const { sessionId } = req.params;
    const query = isValidObjId(sessionId)
      ? { $or: [{ _id: sessionId }, { sessionTrackId: sessionId }] }
      : { sessionTrackId: sessionId };

    const session = await M.QuickPassSession.findOne(query);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (!verifySessionOwner(session, req.user)) {
      return res.status(403).json({ error: 'You can only save drafts for your own Quick Pass sessions' });
    }

    session.isFinalSaved = false;
    await session.save();

    res.json({ ok: true, message: 'Draft saved', records: session.records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
