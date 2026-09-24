const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { refreshExamStatuses } = require('../utils/examUtils');
const { dateToDow } = require('../utils/dateUtils');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { checkModuleGuard } = require('../middleware/portalGuard');

router.get('/', authMiddleware, async (req, res) => {
  try {
    await refreshExamStatuses();
    const filter = {};
    if (req.query.examType)    filter.examType    = sanitizeToString(req.query.examType);
    if (req.query.semester)    filter.semester    = sanitizeToString(req.query.semester);
    if (req.query.status)      filter.status      = sanitizeToString(req.query.status);
    if (req.query.academicYear) filter.academicYear = sanitizeToString(req.query.academicYear);
    if (req.query.deptName)    filter.deptName    = sanitizeToString(req.query.deptName);
    if (req.query.batch)       filter.batch       = sanitizeToString(req.query.batch);
    const exams = await M.Exam.find(filter).sort({ createdAt: -1 });
    res.json(exams);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/exams/active  — ongoing or starting today/upcoming within 7 days
router.get('/active', authMiddleware, async (req, res) => {
  try {
    await refreshExamStatuses();
    const exams = await M.Exam.find({ status: { $in: ['upcoming', 'ongoing'] } }).sort({ createdAt: 1 });
    res.json(exams);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/exams/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const exam = await M.Exam.findOne({ ExamTrackId: req.params.id });
    if (!exam) return res.status(404).json({ error: 'Not found' });
    res.json(exam);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Helper: map semester / year to Academic Year level ('I'|'II'|'III'|'IV'|'All')
function semToYear(sem, fallbackYr) {
  if (fallbackYr && ['I', 'II', 'III', 'IV', 'All'].includes(fallbackYr)) return fallbackYr;
  if (['I', 'II'].includes(sem)) return 'I';
  if (['III', 'IV'].includes(sem)) return 'II';
  if (['V', 'VI'].includes(sem)) return 'III';
  if (['VII', 'VIII'].includes(sem)) return 'IV';
  return 'I';
}

function getDefaultDayType(d, dateStr) {
  const cleanStr = typeof dateStr === 'string' ? dateStr.split('T')[0] : '';
  const dow = new Date(cleanStr + 'T00:00:00.000Z').getUTCDay();
  if (dow === 0) return 'leave';
  if (dow === 6) {
    const sn = satOrdinal(cleanStr);
    return (sn % 2 === 0 || sn === 5) ? 'working' : 'leave';
  }
  return 'working';
}

async function markExamDatesInCalendar(dates, sem, yr, title, isFinalized) {
  if (!Array.isArray(dates) || dates.length === 0) return;
  const targetYear = semToYear(sem, yr);
  const yearsToMark = targetYear === 'All' ? ['I', 'II', 'III', 'IV'] : [targetYear];

  for (const dateStr of dates) {
    if (!dateStr) continue;
    const cleanStr = typeof dateStr === 'string' ? dateStr.split('T')[0] : '';
    const d = new Date(cleanStr + 'T00:00:00.000Z');
    const localD = new Date(cleanStr + 'T00:00:00');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = String(d.getUTCFullYear());
    const day = dateToDow(cleanStr);

    let calDay = await M.CalendarDay.findOne({
      $or: [{ date: d }, { date: localD }]
    });
    if (!calDay) {
      const defType = getDefaultDayType(d, cleanStr);
      const details = ['I', 'II', 'III', 'IV'].map(y => ({
        year: y,
        dayType: yearsToMark.includes(y) ? 'exam' : defType,
        comments: yearsToMark.includes(y) ? (title || 'Exam') : '',
        timing: { start: '08:30', end: '16:30' }
      }));
      const trackId = `TR-CAL${year}${month}${String(d.getUTCDate()).padStart(2, '0')}-${Date.now()}`;
      await M.CalendarDay.create({
        CalendarTrackId: trackId,
        date: d,
        month,
        year,
        day,
        details,
        createdBy: 'system-exam',
        isFinalized: isFinalized === true
      });
    } else {
      calDay.date = d;
      calDay.day = day;
      let details = Array.isArray(calDay.details) ? calDay.details : [];
      if (details.length === 0) {
        const defType = getDefaultDayType(d, cleanStr);
        details = ['I', 'II', 'III', 'IV'].map(y => ({
          year: y,
          dayType: yearsToMark.includes(y) ? 'exam' : defType,
          comments: yearsToMark.includes(y) ? (title || 'Exam') : '',
          timing: { start: '08:30', end: '16:30' }
        }));
      } else {
        ['I', 'II', 'III', 'IV'].forEach(y => {
          let found = details.find(det => det.year === y);
          if (found) {
            if (yearsToMark.includes(y)) {
              found.dayType = 'exam';
              found.comments = title || found.comments || 'Exam';
            }
          } else {
            const defType = getDefaultDayType(d, cleanStr);
            details.push({
              year: y,
              dayType: yearsToMark.includes(y) ? 'exam' : defType,
              comments: yearsToMark.includes(y) ? (title || 'Exam') : '',
              timing: { start: '08:30', end: '16:30' }
            });
          }
        });
      }
      calDay.details = details;
      calDay.markModified('details');
      await calDay.save();
    }
  }
}

async function unmarkExamDatesInCalendar(dates, sem, yr) {
  if (!Array.isArray(dates) || dates.length === 0) return;
  const targetYear = semToYear(sem, yr);
  const yearsToUnmark = targetYear === 'All' ? ['I', 'II', 'III', 'IV'] : [targetYear];

  for (const dateStr of dates) {
    if (!dateStr) continue;
    const cleanStr = typeof dateStr === 'string' ? dateStr.split('T')[0] : '';
    const d = new Date(cleanStr + 'T00:00:00.000Z');
    const localD = new Date(cleanStr + 'T00:00:00');
    let calDay = await M.CalendarDay.findOne({
      $or: [{ date: d }, { date: localD }]
    });
    if (calDay && Array.isArray(calDay.details)) {
      const defType = getDefaultDayType(d, cleanStr);
      calDay.details.forEach(det => {
        if (yearsToUnmark.includes(det.year) && det.dayType === 'exam') {
          det.dayType = defType;
          det.comments = '';
        }
      });
      calDay.date = d;
      calDay.markModified('details');
      await calDay.save();
    }
  }
}

// POST /api/exams  — create exam + auto-mark calendar days immediately
router.post('/', authMiddleware, adminOnly, checkModuleGuard('modelExams', 'Exams Module'), async (req, res) => {
  try {
    const { title, examType, academicYear, year, semester, batch, deptId, deptName, Dates, timing, notes, status, isFinalized } = req.body;
    if (!title || !examType || !semester || !Dates || !Array.isArray(Dates) || Dates.length === 0) {
      return res.status(400).json({ error: 'title, examType, semester, and Dates array required' });
    }
    
    // Generate unique ExamTrackId
    const trackId = `TR-EXM${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const calculatedYear = year || semToYear(semester);
    
    const examData = {
      ExamTrackId: trackId,
      batch: batch || '',
      academicYear: academicYear || '',
      year: calculatedYear,
      semester,
      deptName: deptName || '',
      examType,
      title,
      Dates,
      timing: timing || { start: '09:30', end: '12:30' },
      notes: notes || '',
      status: status || 'upcoming',
      createdBy: (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin'
    };
    
    if (isFinalized) {
      examData.isFinalized = true;
      examData.finalizedBy = examData.createdBy;
      examData.finalizedAt = new Date();
    }
    
    const exam = await M.Exam.create(examData);
    
    // Auto-mark calendar days immediately
    await markExamDatesInCalendar(Dates, semester, calculatedYear, title, isFinalized);
    
    const adderId = (req.user && (req.user.trackId || req.user._id)) || null;
    await logAction(
      adderId,
      examData.createdBy,
      req.user.role || 'admin',
      'Exam Created',
      `${title} (${Dates.length} dates)`,
      'manage',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'manage',
        subType: 'entry-create',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: null, after: exam.toObject ? exam.toObject() : exam }
      }
    );
    res.json(exam);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/exams/:id
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { title, examType, academicYear, year, semester, batch, deptName, Dates, timing, notes, status, isFinalized } = req.body;
    const prevExam = await M.Exam.findOne({ ExamTrackId: req.params.id }).lean();
    if (!prevExam) return res.status(404).json({ error: 'Exam not found' });
    
    const updateData = {};
    if (title) updateData.title = title;
    if (examType) updateData.examType = examType;
    if (academicYear !== undefined) updateData.academicYear = academicYear;
    if (year) updateData.year = year;
    if (semester) updateData.semester = semester;
    if (batch !== undefined) updateData.batch = batch;
    if (deptName !== undefined) updateData.deptName = deptName;
    if (Dates) updateData.Dates = Dates;
    if (timing) updateData.timing = timing;
    if (notes !== undefined) updateData.notes = notes;
    if (status) updateData.status = status;
    
    const actorName = (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin';
    if (isFinalized) {
      updateData.isFinalized = true;
      updateData.finalizedBy = actorName;
      updateData.finalizedAt = new Date();
    }
    
    const exam = await M.Exam.findOneAndUpdate(
      { ExamTrackId: req.params.id },
      { 
        $set: updateData,
        $push: {
          history: {
            updatedBy: actorName,
            updatedAt: new Date(),
            field: 'exam_update',
            oldValue: '',
            newValue: JSON.stringify(updateData)
          }
        }
      },
      { returnDocument: 'after' }
    ).lean();
    
    // Sync calendar: unmark old dates, mark new dates
    const effectiveSem = updateData.semester || prevExam.semester;
    const effectiveYear = updateData.year || prevExam.year || semToYear(effectiveSem);
    const effectiveDates = updateData.Dates || prevExam.Dates;
    const effectiveTitle = updateData.title || prevExam.title;

    await unmarkExamDatesInCalendar(prevExam.Dates, prevExam.semester, prevExam.year);
    await markExamDatesInCalendar(effectiveDates, effectiveSem, effectiveYear, effectiveTitle, isFinalized);

    const actorId = (req.user && (req.user.trackId || req.user._id)) || null;
    await logAction(
      actorId,
      actorName,
      req.user.role || 'admin',
      'Exam Updated',
      effectiveTitle,
      'manage',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'manage',
        subType: 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: prevExam, after: exam }
      }
    );
    res.json(exam);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/exams/:id
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const exam = await M.Exam.findOneAndDelete({ ExamTrackId: req.params.id }).lean();
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    
    // Revert calendar exam entries
    await unmarkExamDatesInCalendar(exam.Dates, exam.semester, exam.year);
    
    const actorName = (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin';
    const actorId   = (req.user && (req.user.trackId || req.user._id)) || null;
    await logAction(
      actorId,
      actorName,
      req.user.role || 'admin',
      'Exam Deleted',
      exam.title,
      'manage',
      'warning',
      req.ip,
      req.user.sessionId,
      {
        module: 'manage',
        subType: 'entry-delete',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: exam, after: null }
      }
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;