const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, requirePage } = require('../middleware/auth');
const { logAction, getNextLogTrackId } = require('../utils/logAction');
const { refreshExamStatuses, semToYear, validateYearSemester } = require('../utils/examUtils');
const { dateToDow, satOrdinal } = require('../utils/dateUtils');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { checkModuleGuard } = require('../middleware/portalGuard');
const { normalizeYearRange } = require('../utils/yearFormat');
const { detectHallShifts, releaseHallShifts } = require('../services/hallShiftService');

// GET /api/exams — list exams with filters
router.get('/', authMiddleware, async (req, res) => {
  try {
    await refreshExamStatuses();
    const filter = {};
    if (req.query.examType) filter.examType = sanitizeToString(req.query.examType);
    if (req.query.semester) filter.semester = sanitizeToString(req.query.semester);
    if (req.query.academicYear) {
      const nay = normalizeYearRange(req.query.academicYear);
      filter.academicYear = { $in: [nay, sanitizeToString(req.query.academicYear)] };
    }
    if (req.query.deptId) filter.deptId = sanitizeToString(req.query.deptId);
    if (req.query.deptName) filter.deptName = sanitizeToString(req.query.deptName);
    if (req.query.batch) {
      const nb = normalizeYearRange(req.query.batch);
      filter.batch = { $in: [nb, sanitizeToString(req.query.batch)] };
    }
    if (req.query.status) {
      filter.status = sanitizeToString(req.query.status);
    }
    const exams = await M.Exam.find(filter)
      .populate('deptId', 'name code')
      .populate('classIds', 'name grade section')
      .sort({ createdAt: -1 });

    res.json(exams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/exams/active — ongoing or upcoming
router.get('/active', authMiddleware, async (req, res) => {
  try {
    await refreshExamStatuses();
    const exams = await M.Exam.find({ status: { $in: ['upcoming', 'ongoing'] } })
      .populate('deptId', 'name code')
      .populate('classIds', 'name grade section')
      .sort({ createdAt: 1 });

    res.json(exams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/exams/:id — single exam
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const exam = await M.Exam.findOne({ ExamTrackId: req.params.id })
      .populate('deptId', 'name code')
      .populate('classIds', 'name grade section')
      .populate('sessions.halls', 'hallNo name capacity');

    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    res.json(exam);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

async function markExamDatesInCalendar(dates, sem, yr, title, isFinalized, examTrackId) {
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
        timing: { start: '08:30', end: '16:30' },
        examTrackId: yearsToMark.includes(y) ? examTrackId : ''
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
          timing: { start: '08:30', end: '16:30' },
          examTrackId: yearsToMark.includes(y) ? examTrackId : ''
        }));
      } else {
        ['I', 'II', 'III', 'IV'].forEach(y => {
          let found = details.find(det => det.year === y);
          if (found) {
            if (yearsToMark.includes(y)) {
              found.dayType = 'exam';
              found.comments = title || found.comments || 'Exam';
              found.examTrackId = examTrackId;
            }
          } else {
            const defType = getDefaultDayType(d, cleanStr);
            details.push({
              year: y,
              dayType: yearsToMark.includes(y) ? 'exam' : defType,
              comments: yearsToMark.includes(y) ? (title || 'Exam') : '',
              timing: { start: '08:30', end: '16:30' },
              examTrackId: yearsToMark.includes(y) ? examTrackId : ''
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

async function unmarkExamDatesInCalendar(dates, sem, yr, examTrackId, title) {
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
      // Check if another active exam exists on this date
      const otherActiveExam = await M.Exam.findOne({
        ExamTrackId: { $ne: examTrackId },
        Dates: cleanStr,
        status: { $in: ['upcoming', 'ongoing'] }
      }).lean();

      if (!otherActiveExam) {
        const defType = getDefaultDayType(d, cleanStr);
        calDay.details.forEach(det => {
          if (yearsToUnmark.includes(det.year) && det.dayType === 'exam') {
            if (!det.examTrackId || det.examTrackId === examTrackId || (title && det.comments === title)) {
              det.dayType = defType;
              det.comments = '';
              det.examTrackId = '';
            }
          }
        });
        calDay.date = d;
        calDay.markModified('details');
        await calDay.save();
      }
    }
  }
}

// POST /api/exams — create exam
router.post('/', authMiddleware, requirePage('manage', 'create', { tab: 'exam' }), checkModuleGuard('modelExams', 'Exams Module'), async (req, res) => {
  try {
    const {
      title,
      examType,
      academicYear,
      year,
      semester,
      batch,
      deptId,
      deptName,
      classIds,
      isCommonExam,
      sessions,
      Dates,
      timing,
      notes,
      isFinalized
    } = req.body;

    if (!title || !examType || !semester) {
      return res.status(400).json({ error: 'title, examType, and semester are required' });
    }

    const calculatedYear = year || semToYear(semester);
    // Cross-validate year vs semester (Fix E6)
    const yearCheck = validateYearSemester(calculatedYear, semester);
    if (!yearCheck.valid) {
      return res.status(400).json({ error: yearCheck.message });
    }

    // Prepare sessions and Dates
    let resolvedSessions = Array.isArray(sessions) ? sessions : [];
    let resolvedDates = Array.isArray(Dates) ? Dates : [];

    if (resolvedSessions.length === 0 && resolvedDates.length > 0) {
      const defTiming = timing || { start: '09:30', end: '12:30' };
      resolvedSessions = resolvedDates.map(d => ({
        date: String(d).split('T')[0],
        session: 'FN',
        timing: defTiming,
        halls: [],
        hallNames: []
      }));
    } else if (resolvedSessions.length > 0) {
      resolvedDates = Array.from(new Set(resolvedSessions.map(s => s && s.date ? String(s.date).split('T')[0] : '').filter(Boolean))).sort();
    }

    if (resolvedDates.length === 0) {
      return res.status(400).json({ error: 'At least one exam date or session is required' });
    }

    const trackId = `TR-EXM${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const actorName = (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin';

    const examData = {
      ExamTrackId: trackId,
      batch: normalizeYearRange(batch),
      academicYear: normalizeYearRange(academicYear),
      year: calculatedYear,
      semester,
      deptId: deptId || null,
      deptName: deptName || '',
      classIds: Array.isArray(classIds) ? classIds : [],
      isCommonExam: isCommonExam === true,
      examType,
      title: title.trim(),
      sessions: resolvedSessions,
      Dates: resolvedDates,
      timing: timing || { start: '09:30', end: '12:30' },
      notes: notes || '',
      createdBy: actorName
    };

    if (isFinalized) {
      examData.isFinalized = true;
      examData.finalizedBy = actorName;
      examData.finalizedAt = new Date();
    }

    const exam = await M.Exam.create(examData);

    // Auto-mark calendar days with examTrackId (Fix E3, E4)
    await markExamDatesInCalendar(resolvedDates, semester, calculatedYear, title, isFinalized, trackId);

    const adderId = (req.user && (req.user.trackId || req.user._id)) || null;
    const nextLogTrackId = await getNextLogTrackId();
    await logAction(
      adderId,
      actorName,
      req.user.role || 'admin',
      'Exam Created',
      `${title} (${resolvedDates.length} dates)`,
      'manage',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'manage',
        subType: 'entry-create',
        trackId: nextLogTrackId,
        changes: { before: null, after: exam.toObject ? exam.toObject() : exam }
      }
    );

    res.status(201).json(exam);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/exams/:id — update exam
router.put('/:id', authMiddleware, requirePage('manage', 'edit', { tab: 'exam' }), async (req, res) => {
  try {
    const {
      title,
      examType,
      academicYear,
      year,
      semester,
      batch,
      deptId,
      deptName,
      classIds,
      isCommonExam,
      sessions,
      Dates,
      timing,
      notes,
      isFinalized
    } = req.body;

    const prevExam = await M.Exam.findOne({ ExamTrackId: req.params.id }).lean();
    if (!prevExam) return res.status(404).json({ error: 'Exam not found' });

    const effectiveSem = semester || prevExam.semester;
    const effectiveYear = year || prevExam.year || semToYear(effectiveSem);
    const yearCheck = validateYearSemester(effectiveYear, effectiveSem);
    if (!yearCheck.valid) {
      return res.status(400).json({ error: yearCheck.message });
    }

    const updateData = {};
    if (title) updateData.title = title.trim();
    if (examType) updateData.examType = examType;
    if (academicYear !== undefined) updateData.academicYear = normalizeYearRange(academicYear);
    if (year) updateData.year = year;
    if (semester) updateData.semester = semester;
    if (batch !== undefined) updateData.batch = normalizeYearRange(batch);
    if (deptId !== undefined) updateData.deptId = deptId;
    if (deptName !== undefined) updateData.deptName = deptName;
    if (classIds !== undefined) updateData.classIds = classIds;
    if (isCommonExam !== undefined) updateData.isCommonExam = isCommonExam;
    if (timing) updateData.timing = timing;
    if (notes !== undefined) updateData.notes = notes;

    if (sessions && Array.isArray(sessions)) {
      updateData.sessions = sessions;
      updateData.Dates = Array.from(new Set(sessions.map(s => s && s.date ? String(s.date).split('T')[0] : '').filter(Boolean))).sort();
    } else if (Dates && Array.isArray(Dates)) {
      updateData.Dates = Dates;
      const defTiming = updateData.timing || prevExam.timing || { start: '09:30', end: '12:30' };
      updateData.sessions = Dates.map(d => ({
        date: String(d).split('T')[0],
        session: 'FN',
        timing: defTiming,
        halls: [],
        hallNames: []
      }));
    }

    const actorName = (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin';
    if (isFinalized !== undefined) {
      updateData.isFinalized = Boolean(isFinalized);
      if (isFinalized) {
        updateData.finalizedBy = actorName;
        updateData.finalizedAt = new Date();
      }
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

    // Re-sync calendar cleanly (Fix E4)
    const effectiveDates = updateData.Dates || prevExam.Dates;
    const effectiveTitle = updateData.title || prevExam.title;

    await unmarkExamDatesInCalendar(prevExam.Dates, prevExam.semester, prevExam.year, prevExam.ExamTrackId, prevExam.title);
    await markExamDatesInCalendar(effectiveDates, effectiveSem, effectiveYear, effectiveTitle, exam.isFinalized, exam.ExamTrackId);

    const actorId = (req.user && (req.user.trackId || req.user._id)) || null;
    const nextLogTrackId = await getNextLogTrackId();
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
        trackId: nextLogTrackId,
        changes: { before: prevExam, after: exam }
      }
    );

    res.json(exam);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/exams/:id/finalize — finalize exam
router.post('/:id/finalize', authMiddleware, requirePage('manage', 'edit', { tab: 'exam' }), async (req, res) => {
  try {
    const actorName = (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin';
    const exam = await M.Exam.findOneAndUpdate(
      { ExamTrackId: req.params.id },
      {
        $set: {
          isFinalized: true,
          finalizedBy: actorName,
          finalizedAt: new Date()
        },
        $push: {
          history: {
            updatedBy: actorName,
            updatedAt: new Date(),
            field: 'finalized',
            oldValue: 'false',
            newValue: 'true'
          }
        }
      },
      { returnDocument: 'after' }
    ).lean();

    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    try { await detectHallShifts(exam); } catch (e) { console.warn('Hall shift detection error:', e.message); }
    res.json({ ok: true, message: 'Exam finalized successfully', data: exam });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/exams/:id/unfinalize — unfinalize exam
router.post('/:id/unfinalize', authMiddleware, requirePage('manage', 'edit', { tab: 'exam' }), async (req, res) => {
  try {
    const actorName = (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin';
    const exam = await M.Exam.findOneAndUpdate(
      { ExamTrackId: req.params.id },
      {
        $set: {
          isFinalized: false,
          finalizedBy: null,
          finalizedAt: null
        },
        $push: {
          history: {
            updatedBy: actorName,
            updatedAt: new Date(),
            field: 'unfinalized',
            oldValue: 'true',
            newValue: 'false'
          }
        }
      },
      { returnDocument: 'after' }
    ).lean();

    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    try { await releaseHallShifts(exam._id); } catch (e) { console.warn('Hall shift release error:', e.message); }
    res.json({ ok: true, message: 'Exam unfinalized successfully', data: exam });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/exams/:id/cancel — cancel exam and release calendar marks (Fix E5)
router.post('/:id/cancel', authMiddleware, requirePage('manage', 'edit', { tab: 'exam' }), async (req, res) => {
  try {
    const actorName = (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin';
    const reason = req.body.reason || 'Cancelled by administrator';

    const exam = await M.Exam.findOneAndUpdate(
      { ExamTrackId: req.params.id },
      {
        $set: {
          status: 'cancelled',
          cancelledBy: actorName,
          cancelledAt: new Date(),
          cancelReason: reason
        },
        $push: {
          history: {
            updatedBy: actorName,
            updatedAt: new Date(),
            field: 'status',
            oldValue: 'active',
            newValue: 'cancelled'
          }
        }
      },
      { returnDocument: 'after' }
    ).lean();

    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    // Release hall shifts & calendar marks for this exam
    try { await releaseHallShifts(exam._id); } catch (e) { console.warn('Hall shift release error:', e.message); }
    // Release calendar marks for this exam
    await unmarkExamDatesInCalendar(exam.Dates, exam.semester, exam.year, exam.ExamTrackId, exam.title);

    const actorId = (req.user && (req.user.trackId || req.user._id)) || null;
    const nextLogTrackId = await getNextLogTrackId();
    await logAction(
      actorId,
      actorName,
      req.user.role || 'admin',
      'Exam Cancelled',
      `Exam "${exam.title}" cancelled: ${reason}`,
      'manage',
      'warning',
      req.ip,
      req.user.sessionId,
      { trackId: nextLogTrackId, examId: exam.ExamTrackId }
    );

    res.json({ ok: true, message: 'Exam cancelled and calendar marks released', data: exam });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/exams/:id — delete exam
router.delete('/:id', authMiddleware, requirePage('manage', 'delete', { tab: 'exam' }), async (req, res) => {
  try {
    const exam = await M.Exam.findOne({ ExamTrackId: req.params.id }).lean();
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    await M.UndoLog.create({
      collectionName: 'exams',
      label: `Exam: ${exam.title || exam.ExamTrackId} (${exam.academicYear || ''})`,
      snapshot: exam,
      deletedBy: (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin',
      expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    }).catch(err => console.warn('[UndoLog Error]:', err.message));

    await M.Exam.findOneAndDelete({ ExamTrackId: req.params.id });

    // Revert calendar exam entries
    await unmarkExamDatesInCalendar(exam.Dates, exam.semester, exam.year, exam.ExamTrackId, exam.title);

    const actorName = (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin';
    const actorId   = (req.user && (req.user.trackId || req.user._id)) || null;
    const nextLogTrackId = await getNextLogTrackId();
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
        trackId: nextLogTrackId,
        changes: { before: exam, after: null }
      }
    );

    res.json({ ok: true, message: 'Exam deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
