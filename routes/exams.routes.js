const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, requirePage } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { refreshExamStatuses, deriveExamStatus, validateYearSemester, findExamConflict, normalizeExamSchedule, findHallConflicts } = require('../utils/examUtils');
const { dateToDow, satOrdinal } = require('../utils/dateUtils');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { checkModuleGuard } = require('../middleware/portalGuard');
const { normalizeYearRange } = require('../utils/yearFormat');
const { todayInInstitutionTz } = require('../utils/institutionTime');

router.get('/', authMiddleware, async (req, res) => {
  try {
    await refreshExamStatuses();
    const filter = {};
    if (req.query.examType)    filter.examType    = sanitizeToString(req.query.examType);
    if (req.query.semester)    filter.semester    = sanitizeToString(req.query.semester);
    if (req.query.status)      filter.status      = sanitizeToString(req.query.status);
    if (req.query.academicYear) {
      const nay = normalizeYearRange(req.query.academicYear);
      filter.academicYear = { $in: [nay, sanitizeToString(req.query.academicYear)] };
    }
    if (req.query.deptId)      filter.deptId      = sanitizeToString(req.query.deptId);
    if (req.query.deptName)    filter.deptName    = sanitizeToString(req.query.deptName);
    if (req.query.classId)     filter.classId     = sanitizeToString(req.query.classId);
    if (req.query.batch) {
      const nb = normalizeYearRange(req.query.batch);
      filter.batch = { $in: [nb, sanitizeToString(req.query.batch)] };
    }
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

// Clean and normalize Dates array into unique, sorted YYYY-MM-DD strings
function sanitizeExamDates(dates) {
  if (!Array.isArray(dates)) return [];
  const valid = dates
    .map(d => (typeof d === 'string' ? d.split('T')[0].trim() : ''))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return Array.from(new Set(valid)).sort();
}

async function markExamDatesInCalendar(dates, examObj, isFinalized) {
  if (!Array.isArray(dates) || dates.length === 0 || !examObj) return;
  const targetYear = semToYear(examObj.semester, examObj.year);
  const yearsToMark = targetYear === 'All' ? ['I', 'II', 'III', 'IV'] : [targetYear];

  // Resolve deptId if missing but deptName provided
  let deptId = examObj.deptId || null;
  if (!deptId && examObj.deptName && examObj.deptName !== 'All Departments' && examObj.deptName !== 'All') {
    const deptDoc = await M.Department.findOne({
      $or: [
        { name: examObj.deptName },
        { code: examObj.deptName.toUpperCase() },
        { threeLetterCode: examObj.deptName.toUpperCase() }
      ]
    }).lean();
    if (deptDoc) deptId = deptDoc._id;
  }

  const examTrackId = examObj.ExamTrackId || '';
  const examId = examObj._id || null;
  const examTitle = examObj.title || 'Exam';
  const examTiming = examObj.timing || { start: '09:30', end: '12:30' };

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

    // E7: Extract specific schedule row for this date
    const schedRow = (Array.isArray(examObj.schedule) ? examObj.schedule.find(s => s.date === cleanStr) : null);
    const rowSession = schedRow?.session || 'FN';
    const rowTiming = schedRow?.timing || examTiming;
    const rowHalls = schedRow?.halls || [];
    const rowSubjectName = schedRow?.subjectName || '';
    const rowSubjectCode = schedRow?.subjectCode || '';
    const rowSubjectId = schedRow?.subjectId || null;

    const scopedDetailBase = {
      dayType: 'exam',
      comments: examTitle,
      timing: rowTiming,
      session: rowSession,
      halls: rowHalls,
      subjectName: rowSubjectName,
      subjectCode: rowSubjectCode,
      subjectId: rowSubjectId,
      deptId: deptId,
      deptName: examObj.deptName || '',
      batch: examObj.batch || '',
      classId: examObj.classId || null,
      className: examObj.className || '',
      examId: examId,
      examTrackId: examTrackId
    };

    if (!calDay) {
      const defType = getDefaultDayType(d, cleanStr);
      // Create baseline details for I, II, III, IV
      const details = ['I', 'II', 'III', 'IV'].map(y => ({
        year: y,
        dayType: defType,
        comments: '',
        timing: { start: '08:30', end: '16:30' }
      }));

      // College-wide vs scoped exam
      if (!deptId && !examObj.classId) {
        details.forEach(det => {
          if (yearsToMark.includes(det.year)) {
            det.dayType = 'exam';
            det.comments = examTitle;
            det.timing = examTiming;
            det.examId = examId;
            det.examTrackId = examTrackId;
          }
        });
      } else {
        yearsToMark.forEach(y => {
          details.push({
            ...scopedDetailBase,
            year: y
          });
        });
      }

      const trackId = `TR-CAL${year}${month}${String(d.getUTCDate()).padStart(2, '0')}-${Date.now()}`;
      await M.CalendarDay.create({
        CalendarTrackId: trackId,
        date: d,
        month,
        year,
        day,
        details,
        createdBy: 'system-exam',
        isFinalized: isFinalized === true || examObj.isFinalized === true
      });
    } else {
      calDay.date = d;
      calDay.day = day;
      let details = Array.isArray(calDay.details) ? calDay.details : [];

      if (details.length === 0) {
        const defType = getDefaultDayType(d, cleanStr);
        details = ['I', 'II', 'III', 'IV'].map(y => ({
          year: y,
          dayType: defType,
          comments: '',
          timing: { start: '08:30', end: '16:30' }
        }));
      }

      // E4: Idempotently remove previous marks by this examTrackId before adding updated ones
      if (examTrackId) {
        details = details.filter(det => det.examTrackId !== examTrackId);
      }

      if (!deptId && !examObj.classId) {
        // College-wide exam: Mark baseline year entries if not declared holidays
        yearsToMark.forEach(y => {
          const found = details.find(det => det.year === y && !det.examTrackId && !det.deptId);
          if (found) {
            if (found.dayType !== 'holiday') {
              found.dayType = 'exam';
              found.comments = examTitle;
              found.timing = rowTiming;
              found.session = rowSession;
              found.halls = rowHalls;
              found.subjectName = rowSubjectName;
              found.subjectCode = rowSubjectCode;
              found.subjectId = rowSubjectId;
              found.examId = examId;
              found.examTrackId = examTrackId;
            }
          } else {
            details.push({
              ...scopedDetailBase,
              year: y
            });
          }
        });
      } else {
        // Scoped exam (E3): Add scoped entries per target year
        yearsToMark.forEach(y => {
          details.push({
            ...scopedDetailBase,
            year: y
          });
        });
      }

      calDay.details = details;
      calDay.markModified('details');
      await calDay.save();
    }
  }
}

async function unmarkExamDatesInCalendar(dates, examTrackId, sem, yr) {
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

      // E4: If examTrackId is provided, ONLY remove marks owned by this exam
      if (examTrackId) {
        calDay.details = calDay.details.filter(det => det.examTrackId !== examTrackId);

        // Revert base entries owned by this examTrackId back to defType
        calDay.details.forEach(det => {
          if (det.examTrackId === examTrackId) {
            det.dayType = defType;
            det.comments = '';
            det.examTrackId = '';
            det.examId = null;
          }
        });
      } else {
        // Fallback for legacy calls without examTrackId
        calDay.details.forEach(det => {
          if (yearsToUnmark.includes(det.year) && det.dayType === 'exam') {
            det.dayType = defType;
            det.comments = '';
            det.examTrackId = '';
            det.examId = null;
          }
        });
      }

      // Ensure base entries for I, II, III, IV exist so the day remains structurally complete
      ['I', 'II', 'III', 'IV'].forEach(y => {
        const hasBase = calDay.details.some(det => det.year === y && !det.deptId && !det.classId);
        if (!hasBase) {
          calDay.details.unshift({
            year: y,
            dayType: defType,
            comments: '',
            timing: { start: '08:30', end: '16:30' }
          });
        }
      });

      calDay.date = d;
      calDay.markModified('details');
      await calDay.save();
    }
  }
}

// POST /api/exams  — create exam + auto-mark calendar days immediately
router.post('/', authMiddleware, requirePage('manage', 'create', { tab: 'exam' }), checkModuleGuard('modelExams', 'Exams Module'), async (req, res) => {
  try {
    const { title, examType, academicYear, year, semester, batch, deptId, deptName, classId, className, Dates, schedule, timing, notes, status, isFinalized } = req.body;
    if (!title || !examType || !semester || ((!Dates || !Array.isArray(Dates) || Dates.length === 0) && (!schedule || !Array.isArray(schedule) || schedule.length === 0))) {
      return res.status(400).json({ error: 'title, examType, semester, and Dates or schedule array required' });
    }

    // E6: Validate Year and Semester cross-check
    const calculatedYear = year || semToYear(semester);
    const yrSemValidation = validateYearSemester(calculatedYear, semester);
    if (!yrSemValidation.valid) {
      return res.status(400).json({ error: yrSemValidation.error });
    }

    // E7: Normalize schedule rows and Dates list
    const normalized = normalizeExamSchedule(schedule, Dates, timing);
    const cleanDates = normalized.Dates;
    const cleanSchedule = normalized.schedule;

    if (cleanDates.length === 0) {
      return res.status(400).json({ error: 'At least one valid date (YYYY-MM-DD) or schedule row is required' });
    }

    // E6 & E7: Duplicate & Overlap and Hall conflict validation against active exams
    if (status !== 'cancelled') {
      const existingExams = await M.Exam.find({ status: { $ne: 'cancelled' } }).lean();
      const conflictCheck = findExamConflict({
        Dates: cleanDates,
        deptId: deptId || null,
        deptName: deptName || '',
        batch,
        semester: yrSemValidation.semester || semester,
        year: yrSemValidation.year || calculatedYear,
        classId: classId || null,
        className: className || ''
      }, existingExams);

      if (conflictCheck.hasConflict) {
        return res.status(409).json({
          error: conflictCheck.error,
          details: {
            dates: conflictCheck.conflictingDates,
            conflictingExam: conflictCheck.conflictingExam ? conflictCheck.conflictingExam.ExamTrackId : null
          }
        });
      }

      // E7: Check hall conflicts
      const hallConflictCheck = findHallConflicts(cleanSchedule, existingExams);
      if (hallConflictCheck.hasConflict) {
        return res.status(409).json({
          error: hallConflictCheck.error,
          details: {
            hall: hallConflictCheck.hall,
            date: hallConflictCheck.date,
            session: hallConflictCheck.session,
            conflictingExam: hallConflictCheck.conflictingExam ? hallConflictCheck.conflictingExam.ExamTrackId : null
          }
        });
      }
    }
    
    // Generate unique ExamTrackId
    const trackId = `TR-EXM${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    // Derive initial lifecycle status from Dates relative to institution today
    const today = await todayInInstitutionTz();
    const effectiveStatus = (status === 'cancelled') ? 'cancelled' : deriveExamStatus(cleanDates, today, status || 'upcoming');

    const examData = {
      ExamTrackId: trackId,
      batch: normalizeYearRange(batch),
      academicYear: normalizeYearRange(academicYear),
      year: yrSemValidation.year || calculatedYear,
      semester: yrSemValidation.semester || semester,
      deptId: deptId || null,
      deptName: deptName || '',
      classId: classId || null,
      className: className || '',
      examType,
      title,
      Dates: cleanDates,
      schedule: cleanSchedule,
      timing: timing || { start: '09:30', end: '12:30' },
      notes: notes || '',
      status: effectiveStatus,
      createdBy: (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin'
    };
    
    if (isFinalized) {
      examData.isFinalized = true;
      examData.finalizedBy = examData.createdBy;
      examData.finalizedAt = new Date();
    }
    
    const exam = await M.Exam.create(examData);
    
    // E5: Auto-mark calendar days only if exam is not cancelled
    if (effectiveStatus !== 'cancelled') {
      await markExamDatesInCalendar(cleanDates, exam, isFinalized);
    }
    
    const adderId = (req.user && (req.user.trackId || req.user._id)) || null;
    await logAction(
      adderId,
      examData.createdBy,
      req.user.role || 'admin',
      'Exam Created',
      `${title} (${cleanDates.length} dates)`,
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
router.put('/:id', authMiddleware, requirePage('manage', 'edit', { tab: 'exam' }), async (req, res) => {
  try {
    const { title, examType, academicYear, year, semester, batch, deptId, deptName, classId, className, Dates, schedule, timing, notes, status, isFinalized } = req.body;
    const prevExam = await M.Exam.findOne({ ExamTrackId: req.params.id }).lean();
    if (!prevExam) return res.status(404).json({ error: 'Exam not found' });
    
    // E6: Validate Year and Semester cross-check
    const targetYear = year || prevExam.year || semToYear(semester || prevExam.semester);
    const targetSem = semester || prevExam.semester;
    const yrSemValidation = validateYearSemester(targetYear, targetSem);
    if (!yrSemValidation.valid) {
      return res.status(400).json({ error: yrSemValidation.error });
    }

    const updateData = {};
    if (title) updateData.title = title;
    if (examType) updateData.examType = examType;
    if (academicYear !== undefined) updateData.academicYear = normalizeYearRange(academicYear);
    updateData.year = yrSemValidation.year || targetYear;
    updateData.semester = yrSemValidation.semester || targetSem;
    if (batch !== undefined) updateData.batch = normalizeYearRange(batch);
    if (deptId !== undefined) updateData.deptId = deptId || null;
    if (deptName !== undefined) updateData.deptName = deptName;
    if (classId !== undefined) updateData.classId = classId || null;
    if (className !== undefined) updateData.className = className;

    // E7: Normalize schedule rows and Dates list
    let cleanDates = null;
    let cleanSchedule = null;
    if (schedule || Dates) {
      const normalized = normalizeExamSchedule(schedule || prevExam.schedule, Dates || prevExam.Dates, timing || prevExam.timing);
      cleanDates = normalized.Dates;
      cleanSchedule = normalized.schedule;
      if (cleanDates.length === 0) {
        return res.status(400).json({ error: 'At least one valid date (YYYY-MM-DD) is required in Dates' });
      }
      updateData.Dates = cleanDates;
      updateData.schedule = cleanSchedule;
    }

    if (timing) updateData.timing = timing;
    if (notes !== undefined) updateData.notes = notes;

    const effectiveDates = cleanDates || prevExam.Dates || [];
    const effectiveSchedule = cleanSchedule || prevExam.schedule || [];
    const today = await todayInInstitutionTz();

    let effectiveStatus;
    if (status === 'cancelled') {
      effectiveStatus = 'cancelled';
    } else if (status || cleanDates) {
      effectiveStatus = deriveExamStatus(effectiveDates, today, status || prevExam.status);
    } else {
      effectiveStatus = prevExam.status;
    }
    updateData.status = effectiveStatus;

    // E6 & E7: Overlap and Hall conflict check if not cancelled
    if (effectiveStatus !== 'cancelled') {
      const existingExams = await M.Exam.find({
        status: { $ne: 'cancelled' },
        ExamTrackId: { $ne: req.params.id }
      }).lean();

      const conflictCheck = findExamConflict({
        Dates: effectiveDates,
        deptId: updateData.deptId !== undefined ? updateData.deptId : prevExam.deptId,
        deptName: updateData.deptName !== undefined ? updateData.deptName : prevExam.deptName,
        batch: updateData.batch !== undefined ? updateData.batch : prevExam.batch,
        semester: updateData.semester,
        year: updateData.year,
        classId: updateData.classId !== undefined ? updateData.classId : prevExam.classId,
        className: updateData.className !== undefined ? updateData.className : prevExam.className
      }, existingExams, req.params.id);

      if (conflictCheck.hasConflict) {
        return res.status(409).json({
          error: conflictCheck.error,
          details: {
            dates: conflictCheck.conflictingDates,
            conflictingExam: conflictCheck.conflictingExam ? conflictCheck.conflictingExam.ExamTrackId : null
          }
        });
      }

      // E7: Check hall conflicts
      if (effectiveSchedule.length > 0) {
        const hallConflictCheck = findHallConflicts(effectiveSchedule, existingExams, req.params.id);
        if (hallConflictCheck.hasConflict) {
          return res.status(409).json({
            error: hallConflictCheck.error,
            details: {
              hall: hallConflictCheck.hall,
              date: hallConflictCheck.date,
              session: hallConflictCheck.session,
              conflictingExam: hallConflictCheck.conflictingExam ? hallConflictCheck.conflictingExam.ExamTrackId : null
            }
          });
        }
      }
    }
    
    const actorName = (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin';
    const historyEntries = [];

    if (effectiveStatus !== prevExam.status) {
      historyEntries.push({
        updatedBy: actorName,
        updatedAt: new Date(),
        field: 'status',
        oldValue: prevExam.status || '',
        newValue: effectiveStatus
      });
    }

    // E5: Handle finalization / unfinalization with history
    if (isFinalized !== undefined) {
      if (isFinalized === true && !prevExam.isFinalized) {
        updateData.isFinalized = true;
        updateData.finalizedBy = actorName;
        updateData.finalizedAt = new Date();
        historyEntries.push({
          updatedBy: actorName,
          updatedAt: new Date(),
          field: 'isFinalized',
          oldValue: 'false',
          newValue: 'true'
        });
      } else if (isFinalized === false && prevExam.isFinalized) {
        updateData.isFinalized = false;
        updateData.unfinalizedBy = actorName;
        updateData.unfinalizedAt = new Date();
        const reason = req.body.unfinalizeReason || req.body.reason || 'Admin unfinalized exam';
        updateData.unfinalizeReason = reason;
        historyEntries.push({
          updatedBy: actorName,
          updatedAt: new Date(),
          field: 'isFinalized',
          oldValue: 'true',
          newValue: 'false'
        });
        historyEntries.push({
          updatedBy: actorName,
          updatedAt: new Date(),
          field: 'unfinalizeReason',
          oldValue: '',
          newValue: reason
        });
      }
    }

    if (historyEntries.length === 0) {
      historyEntries.push({
        updatedBy: actorName,
        updatedAt: new Date(),
        field: 'exam_update',
        oldValue: '',
        newValue: JSON.stringify(updateData)
      });
    }
    
    const exam = await M.Exam.findOneAndUpdate(
      { ExamTrackId: req.params.id },
      { 
        $set: updateData,
        $push: { history: { $each: historyEntries } }
      },
      { returnDocument: 'after' }
    ).lean();
    
    // E4 & E5: Unmark old dates first
    await unmarkExamDatesInCalendar(prevExam.Dates, prevExam.ExamTrackId, prevExam.semester, prevExam.year);
    // E5: Only mark calendar dates if exam is NOT cancelled
    if (effectiveStatus !== 'cancelled') {
      await markExamDatesInCalendar(effectiveDates, exam, updateData.isFinalized !== undefined ? updateData.isFinalized : exam.isFinalized);
    }

    const actorId = (req.user && (req.user.trackId || req.user._id)) || null;
    const effectiveTitle = exam.title || prevExam.title || 'Exam';
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

// POST /api/exams/:id/cancel — cancel exam and immediately release calendar marks (E5)
router.post('/:id/cancel', authMiddleware, requirePage('manage', 'edit', { tab: 'exam' }), async (req, res) => {
  try {
    const prevExam = await M.Exam.findOne({ ExamTrackId: req.params.id }).lean();
    if (!prevExam) return res.status(404).json({ error: 'Exam not found' });

    if (prevExam.status === 'cancelled') {
      return res.json({ ok: true, message: 'Exam is already cancelled', exam: prevExam });
    }

    const actorName = (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin';
    const reason = req.body.reason || req.body.notes || 'Cancelled by admin';

    const exam = await M.Exam.findOneAndUpdate(
      { ExamTrackId: req.params.id },
      {
        $set: { status: 'cancelled' },
        $push: {
          history: {
            $each: [
              {
                updatedBy: actorName,
                updatedAt: new Date(),
                field: 'status',
                oldValue: prevExam.status,
                newValue: 'cancelled'
              },
              {
                updatedBy: actorName,
                updatedAt: new Date(),
                field: 'cancelReason',
                oldValue: '',
                newValue: reason
              }
            ]
          }
        }
      },
      { returnDocument: 'after' }
    ).lean();

    // Release all calendar marks owned by this examTrackId (E5)
    await unmarkExamDatesInCalendar(prevExam.Dates, prevExam.ExamTrackId, prevExam.semester, prevExam.year);

    const actorId = (req.user && (req.user.trackId || req.user._id)) || null;
    await logAction(
      actorId,
      actorName,
      req.user.role || 'admin',
      'Exam Cancelled',
      exam.title,
      'manage',
      'warning',
      req.ip,
      req.user.sessionId,
      {
        module: 'manage',
        subType: 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: { status: prevExam.status }, after: { status: 'cancelled', reason } }
      }
    );

    res.json({ ok: true, message: 'Exam cancelled and calendar marks released', exam });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/exams/:id/unfinalize — unfinalize exam with audit history (E5)
router.post('/:id/unfinalize', authMiddleware, requirePage('manage', 'edit', { tab: 'exam' }), async (req, res) => {
  try {
    const prevExam = await M.Exam.findOne({ ExamTrackId: req.params.id }).lean();
    if (!prevExam) return res.status(404).json({ error: 'Exam not found' });

    if (!prevExam.isFinalized) {
      return res.json({ ok: true, message: 'Exam is not finalized', exam: prevExam });
    }

    const actorName = (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin';
    const reason = req.body.reason || 'Admin unfinalized exam';

    const exam = await M.Exam.findOneAndUpdate(
      { ExamTrackId: req.params.id },
      {
        $set: {
          isFinalized: false,
          unfinalizedBy: actorName,
          unfinalizedAt: new Date(),
          unfinalizeReason: reason
        },
        $push: {
          history: {
            $each: [
              {
                updatedBy: actorName,
                updatedAt: new Date(),
                field: 'isFinalized',
                oldValue: 'true',
                newValue: 'false'
              },
              {
                updatedBy: actorName,
                updatedAt: new Date(),
                field: 'unfinalizeReason',
                oldValue: '',
                newValue: reason
              }
            ]
          }
        }
      },
      { returnDocument: 'after' }
    ).lean();

    const actorId = (req.user && (req.user.trackId || req.user._id)) || null;
    await logAction(
      actorId,
      actorName,
      req.user.role || 'admin',
      'Exam Unfinalized',
      exam.title,
      'manage',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'manage',
        subType: 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: { isFinalized: true }, after: { isFinalized: false, reason } }
      }
    );

    res.json({ ok: true, message: 'Exam unfinalized successfully', exam });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/exams/:id/finalize — finalize exam with audit history (E5)
router.post('/:id/finalize', authMiddleware, requirePage('manage', 'edit', { tab: 'exam' }), async (req, res) => {
  try {
    const prevExam = await M.Exam.findOne({ ExamTrackId: req.params.id }).lean();
    if (!prevExam) return res.status(404).json({ error: 'Exam not found' });

    if (prevExam.isFinalized) {
      return res.json({ ok: true, message: 'Exam is already finalized', exam: prevExam });
    }

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
            field: 'isFinalized',
            oldValue: 'false',
            newValue: 'true'
          }
        }
      },
      { returnDocument: 'after' }
    ).lean();

    // Update calendar markings
    if (exam.status !== 'cancelled') {
      await markExamDatesInCalendar(exam.Dates, exam, true);
    }

    const actorId = (req.user && (req.user.trackId || req.user._id)) || null;
    await logAction(
      actorId,
      actorName,
      req.user.role || 'admin',
      'Exam Finalized',
      exam.title,
      'manage',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'manage',
        subType: 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: { isFinalized: false }, after: { isFinalized: true } }
      }
    );

    res.json({ ok: true, message: 'Exam finalized successfully', exam });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/exams/:id
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

    // Revert calendar exam entries specifically owned by this examTrackId (E4)
    await unmarkExamDatesInCalendar(exam.Dates, exam.ExamTrackId, exam.semester, exam.year);
    
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
