const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, adminOnly, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { checkModuleGuard } = require('../middleware/portalGuard');

router.get('/', authMiddleware, async (req, res) => {
  try {
    const filter = {};
    if (req.query.examTrackId)    filter.examTrackId    = sanitizeToString(req.query.examTrackId);
    if (req.query.date)           filter.date           = new Date(sanitizeToString(req.query.date) + 'T00:00:00');
    if (req.query.teacherTrackId) filter.teacherTrackId = sanitizeToString(req.query.teacherTrackId);
    if (req.query.hallNo)         filter.hallNo         = sanitizeToString(req.query.hallNo);

    // Students can only see their own exam attendance records
    if (req.user.role === 'student') {
      filter['records.studentTrackId'] = req.user.trackId;
    }

    const records = await M.ExamAttendance.find(filter).sort({ markedAt: -1 }).lean();

    // If student, filter each document's records array to only include their own entry
    if (req.user.role === 'student') {
      const studentRecords = records.map(r => ({
        ...r,
        records: (r.records || []).filter(rec => String(rec.studentTrackId) === String(req.user.trackId))
      }));
      return res.json(studentRecords);
    }

    res.json(records);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/exam-attendance/halls-today  — summary per hall for a date
router.get('/halls-today', authMiddleware, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { examTrackId, date } = req.query;
    if (!examTrackId) return res.status(400).json({ error: 'examTrackId required' });
    const dateStr = date || new Date().toISOString().split('T')[0];
    const dateObj = new Date(dateStr + 'T00:00:00');
    const records = await M.ExamAttendance.find({ examTrackId, date: dateObj }).sort({ markedAt: 1 });
    res.json(records);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/exam-attendance/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const rec = await M.ExamAttendance.findById(req.params.id).lean();
    if (!rec) return res.status(404).json({ error: 'Not found' });

    if (req.user.role === 'student') {
      const ownRecord = (rec.records || []).find(r => String(r.studentTrackId) === String(req.user.trackId));
      if (!ownRecord) {
        return res.status(403).json({ error: 'Access denied' });
      }
      rec.records = [ownRecord];
    }
    res.json(rec);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/exam-attendance  — upsert by (examTrackId, date, hallNo, teacherTrackId)
router.post('/', authMiddleware, requireRole('teacher', 'admin'), checkModuleGuard('modelExams', 'Exams Module'), async (req, res) => {
  try {
    const { examTrackId, date, hallNo, records, isFinalized } = req.body;
    if (!examTrackId || !date || !hallNo) return res.status(400).json({ error: 'examTrackId, date, hallNo required' });
    
    const dateObj = new Date(date + 'T00:00:00');
    const exam = await M.Exam.findOne({ ExamTrackId: examTrackId }).select('title examType');
    
    // Convert status from 'present'/'absent' to 'P'/'AB' if needed
    const normalizedRecords = (records || []).map(r => ({
      studentTrackId: r.studentTrackId || r._id, regNo: r.regNo,
      status: r.status === 'present' ? 'P' : r.status === 'absent' ? 'AB' : r.status
    }));
    
    const totalPresent = normalizedRecords.filter(r => r.status === 'P').length;
    const totalAbsent = normalizedRecords.filter(r => r.status === 'AB').length;
    
    const updateData = { examTrackId, examTitle: exam ? exam.title : '', examType: exam ? exam.examType : '', date: dateObj, hallNo, teacherTrackId: req.user.trackId,
      teacherName: req.user.name, markedAt: new Date(), records: normalizedRecords, totalPresent, totalAbsent };
    
    if (isFinalized) { updateData.isFinalized = true; }
    
    const doc = await M.ExamAttendance.findOneAndUpdate(
      { examTrackId, date: dateObj, hallNo, teacherTrackId: req.user.trackId },
      { $set: updateData },
      { returnDocument: 'after', upsert: true }
    );
    
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Exam Attendance Submitted',
      `Hall ${hallNo} | ${date} | P:${totalPresent} A:${totalAbsent}`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'teacher',
        subType: 'attendance',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights
      }
    );
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;