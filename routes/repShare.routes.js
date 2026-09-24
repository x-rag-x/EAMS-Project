const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { verifyTeacherAssignment } = require('../utils/assignmentAuth');

const isValidObjId = (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && id.length === 24;

// 1. Get Class Reps for a Class (Teacher)
router.get('/reps/:classId', authMiddleware, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only teachers and admins can view class reps' });
  }
  try {
    const { classId } = req.params;
    const filter = {};
    if (isValidObjId(classId)) {
      filter.classId = new mongoose.Types.ObjectId(classId);
    } else {
      filter.$or = [{ classId: classId }, { trackId: classId }];
    }

    // Try finding students marked as isRep: true
    let reps = await M.Student.find({ ...filter, isRep: true, status: { $ne: 'inactive' } })
      .select('_id trackId registerNo fullName isRep')
      .sort({ registerNo: 1 })
      .lean();

    // Fallback: if no students are designated as rep, return all active students in class so teacher can pick one
    if (!reps || reps.length === 0) {
      reps = await M.Student.find({ ...filter, status: { $ne: 'inactive' } })
        .select('_id trackId registerNo fullName isRep')
        .sort({ registerNo: 1 })
        .lean();
    }

    return res.json({ success: true, reps: reps || [] });
  } catch (err) {
    console.error('Error fetching class reps:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch class reps' });
  }
});

// 2. Request Rep Share delegation (Teacher)
router.post('/request', authMiddleware, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only teachers can delegate attendance to Class Reps' });
  }

  try {
    const {
      classId,
      subjectId,
      date,
      periodNumber = 1,
      repStudentId,
      topic = '',
      actualClassCount = 0
    } = req.body;

    if (!classId || !subjectId || !date || !repStudentId) {
      return res.status(400).json({ error: 'Class, Subject, Date, and Representative are required' });
    }

    // Verify teacher assignment (A3)
    const assignCheck = await verifyTeacherAssignment(req.user, classId, subjectId);
    if (!assignCheck.allowed) {
      return res.status(403).json({ error: assignCheck.reason });
    }

    // Fetch details
    const [cls, sub, rep, teacher] = await Promise.all([
      M.Class.findById(classId).lean(),
      M.Subject.findById(subjectId).lean(),
      M.Student.findById(repStudentId).lean(),
      M.Teacher.findOne({ trackId: req.user.trackId }).lean()
    ]);

    if (!rep) {
      return res.status(404).json({ error: 'Selected Class Representative not found' });
    }

    // Cancel any previous pending session for the same class & subject & date
    await M.RepShareSession.updateMany(
      { classId, subjectId, date, status: 'pending' },
      { $set: { status: 'rejected' } }
    );

    const sessionTrackId = 'REP_' + crypto.randomBytes(6).toString('hex').toUpperCase();


    const session = await M.RepShareSession.create({
      sessionTrackId,
      teacherId: teacher ? teacher._id : (req.user._id || null),
      teacherTrackId: req.user.trackId,
      teacherName: (teacher && (teacher.fullName || teacher.name)) || req.user.fullName || req.user.name || 'Teacher',
      classId: cls ? cls._id : (isValidObjId(classId) ? new mongoose.Types.ObjectId(classId) : classId),
      className: (cls && (cls.name || cls.className)) || 'Class',
      subjectId: sub ? sub._id : (isValidObjId(subjectId) ? new mongoose.Types.ObjectId(subjectId) : subjectId),
      subjectName: (sub && (sub.name || sub.subjectName)) || 'Subject',
      date,
      periodNumber: Number(periodNumber) || 1,
      topic: topic || '',
      repStudentId: rep._id,
      repStudentTrackId: rep.trackId,
      repStudentName: rep.fullName || 'Class Rep',
      repRegNo: rep.registerNo || '',
      actualClassCount: Number(actualClassCount) || 0,
      status: 'pending'
    });

    // Create notification for student rep
    try {
      await M.Notification.create({
        type: 'rep-share',
        from: (teacher && (teacher.fullName || teacher.name)) || req.user.fullName || 'Teacher',
        fromRole: 'Teacher',
        toStudentId: rep._id,
        toStudentTrackId: rep.trackId,
        toStudentName: rep.fullName,
        message: `Attendance marking for ${session.subjectName} (Period ${session.periodNumber}) has been delegated to you. Please mark attendance and verify headcount.`,
        priority: 'High',
        status: 'Pending',
        read: false,
        time: new Date()
      });
    } catch (notifErr) {
      console.warn('Failed to send rep notification:', notifErr.message);
    }

    return res.status(201).json({
      success: true,
      message: `Attendance delegated to ${rep.fullName}`,
      session
    });
  } catch (err) {
    console.error('Error initiating Rep Share request:', err);
    return res.status(500).json({ error: err.message || 'Failed to delegate attendance' });
  }
});

// 3. Get pending Rep Share session for logged in Student
router.get('/pending', authMiddleware, async (req, res) => {
  try {
    const studentTrackId = req.user.trackId;
    if (!studentTrackId) {
      return res.json({ hasPending: false });
    }

    // Find latest pending or in-progress session for this student
    const session = await M.RepShareSession.findOne({
      $or: [
        { repStudentTrackId: studentTrackId },
        { repStudentId: req.user._id }
      ],
      status: { $in: ['pending', 'in-progress'] }
    }).sort({ createdAt: -1 }).lean();

    if (!session) {
      return res.json({ hasPending: false });
    }

    // Fetch students roster for the class
    const students = await M.Student.find({
      classId: session.classId,
      status: { $ne: 'inactive' }
    })
      .select('_id trackId registerNo fullName rollNo')
      .sort({ registerNo: 1 })
      .lean();

    return res.json({
      hasPending: true,
      session,
      students: students || []
    });
  } catch (err) {
    console.error('Error checking pending rep session:', err);
    return res.status(500).json({ error: err.message || 'Failed to check pending session' });
  }
});

// 4. Get session details / status
router.get('/session/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const query = isValidObjId(sessionId)
      ? { _id: new mongoose.Types.ObjectId(sessionId) }
      : { sessionTrackId: sessionId };

    const session = await M.RepShareSession.findOne(query).lean();
    if (!session) {
      return res.status(404).json({ error: 'Rep share session not found' });
    }

    const isAssignedRep = (session.repStudentTrackId && req.user.trackId && String(req.user.trackId) === String(session.repStudentTrackId)) ||
      (session.repStudentId && (String(req.user._id) === String(session.repStudentId) || String(req.user.roleId) === String(session.repStudentId)));
    const isAssigningTeacher = (session.teacherTrackId && req.user.trackId && String(req.user.trackId) === String(session.teacherTrackId)) ||
      (session.teacherId && (String(req.user._id) === String(session.teacherId) || String(req.user.roleId) === String(session.teacherId)));

    if (!isAssignedRep && !isAssigningTeacher && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied to this session' });
    }

    return res.json({ success: true, session });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch session' });
  }
});

// 5. Submit attendance by Rep (Anti-fraud headcount check)
router.post('/submit/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { records = [], repConfirmedCount } = req.body;

    const query = isValidObjId(sessionId)
      ? { _id: new mongoose.Types.ObjectId(sessionId) }
      : { sessionTrackId: sessionId };

    const session = await M.RepShareSession.findOne(query);
    if (!session) {
      return res.status(404).json({ error: 'Rep share session not found' });
    }

    const isAssignedRep = (session.repStudentTrackId && req.user.trackId && String(req.user.trackId) === String(session.repStudentTrackId)) ||
      (session.repStudentId && (String(req.user._id) === String(session.repStudentId) || String(req.user.roleId) === String(session.repStudentId)));

    if (!isAssignedRep) {
      return res.status(403).json({ error: 'Only the assigned class representative can submit attendance' });
    }

    if (session.status === 'submitted' || session.status === 'finalized') {
      return res.status(400).json({ error: 'This session has already been submitted' });
    }

    // Calculate how many students are marked present
    const presentRecords = records.filter(r => {
      const s = String(r.status || '').trim().toLowerCase();
      return s === 'present' || s === 'p';
    });
    const markedPresentCount = presentRecords.length;

    const enteredCount = Number(repConfirmedCount);

    // ANTI-FRAUD VERIFICATION CHECK
    // Must match actual marked present count
    if (isNaN(enteredCount) || enteredCount !== markedPresentCount) {
      return res.status(400).json({
        error: `Anti-fraud verification failed: Entered physical count (${enteredCount}) does not match marked present count (${markedPresentCount}). Please verify the classroom headcount before submitting.`
      });
    }

    // Map records
    session.records = records.map(r => ({
      studentId: isValidObjId(r.studentId) ? new mongoose.Types.ObjectId(r.studentId) : null,
      studentTrackId: r.studentTrackId || '',
      regNo: r.regNo || r.registerNo || '',
      studentName: r.studentName || '',
      status: r.status || 'Present',
      remarks: r.remarks || '',
      markedBy: 'rep',
      markedAt: new Date()
    }));

    session.repConfirmedCount = enteredCount;
    session.actualClassCount = records.length;
    session.status = 'submitted';
    session.submittedAt = new Date();

    await session.save();

    // Notify Teacher
    try {
      await M.Notification.create({
        type: 'info',
        from: session.repStudentName || 'Class Rep',
        fromRole: 'Student',
        toTeacherId: session.teacherId,
        toTeacherTrackId: session.teacherTrackId,
        toTeacherName: session.teacherName,
        message: `Class Rep ${session.repStudentName || ''} has submitted attendance draft for ${session.subjectName || 'class'} (${enteredCount} Present). Click to review and finalize.`,
        priority: 'High',
        status: 'Pending',
        read: false,
        time: new Date()
      });
    } catch (notifErr) {
      console.warn('Failed to send teacher notification:', notifErr.message);
    }

    return res.json({
      success: true,
      message: 'Attendance successfully submitted for teacher review!',
      session
    });
  } catch (err) {
    console.error('Error submitting rep attendance:', err);
    return res.status(500).json({ error: err.message || 'Failed to submit rep attendance' });
  }
});

// 6. Get draft records for Teacher review
router.get('/draft/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const query = isValidObjId(sessionId)
      ? { _id: new mongoose.Types.ObjectId(sessionId) }
      : { sessionTrackId: sessionId };

    const session = await M.RepShareSession.findOne(query).lean();
    if (!session) {
      return res.status(404).json({ error: 'Rep share session not found' });
    }

    const isAssigningTeacher = (session.teacherTrackId && req.user.trackId && String(req.user.trackId) === String(session.teacherTrackId)) ||
      (session.teacherId && (String(req.user._id) === String(session.teacherId) || String(req.user.roleId) === String(session.teacherId)));

    if (req.user.role !== 'admin' && !isAssigningTeacher) {
      return res.status(403).json({ error: 'Only the assigning teacher can review drafts' });
    }

    return res.json({
      success: true,
      session,
      records: session.records || []
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to load draft records' });
  }
});

// 7. Cancel / Reject session
router.post('/cancel/:sessionId', authMiddleware, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only teachers and admins can cancel sessions' });
  }
  try {
    const { sessionId } = req.params;
    const query = isValidObjId(sessionId)
      ? { _id: new mongoose.Types.ObjectId(sessionId) }
      : { sessionTrackId: sessionId };

    const session = await M.RepShareSession.findOne(query);
    if (!session) {
      return res.status(404).json({ error: 'Rep share session not found' });
    }

    const isAssigningTeacher = (session.teacherTrackId && req.user.trackId && String(req.user.trackId) === String(session.teacherTrackId)) ||
      (session.teacherId && (String(req.user._id) === String(session.teacherId) || String(req.user.roleId) === String(session.teacherId)));

    if (req.user.role !== 'admin' && !isAssigningTeacher) {
      return res.status(403).json({ error: 'Only the assigning teacher can cancel this session' });
    }

    session.status = 'rejected';
    await session.save();
    return res.json({ success: true, message: 'Session cancelled' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to cancel session' });
  }
});

module.exports = router;
