const M = require('../models');
const { todayInInstitutionTz } = require('./institutionTime');

/**
 * Derives the lifecycle status of an exam directly from its Dates list and reference date (today).
 *
 * Rules:
 * - If status is 'cancelled', it remains 'cancelled'.
 * - If dates list is empty or invalid, defaults to 'upcoming'.
 * - If today < earliest date -> 'upcoming'.
 * - If today > latest date -> 'completed'.
 * - If today >= earliest date && today <= latest date -> 'ongoing'.
 *
 * @param {string[]} dates - List of exam date strings (YYYY-MM-DD)
 * @param {string} today - Reference date string in YYYY-MM-DD
 * @param {string} [currentStatus] - Current exam status
 * @returns {'upcoming' | 'ongoing' | 'completed' | 'cancelled'}
 */
function deriveExamStatus(dates, today, currentStatus) {
  if (currentStatus === 'cancelled') return 'cancelled';
  if (!Array.isArray(dates) || dates.length === 0) return 'upcoming';

  const cleanDates = dates
    .map(d => (typeof d === 'string' ? d.split('T')[0].trim() : ''))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  if (cleanDates.length === 0) return 'upcoming';

  const firstDate = cleanDates[0];
  const lastDate = cleanDates[cleanDates.length - 1];

  if (today < firstDate) return 'upcoming';
  if (today > lastDate) return 'completed';
  return 'ongoing';
}

/**
 * Scans all non-cancelled exams in the database, derives their status from Dates,
 * and updates any documents where the status has changed.
 */
async function refreshExamStatuses() {
  const today = await todayInInstitutionTz();
  const exams = await M.Exam.find(
    { status: { $ne: 'cancelled' } },
    '_id ExamTrackId status Dates'
  ).lean();

  if (!exams || exams.length === 0) return;

  const bulkOps = [];
  for (const ex of exams) {
    const derived = deriveExamStatus(ex.Dates, today, ex.status);
    if (derived && derived !== ex.status) {
      bulkOps.push({
        updateOne: {
          filter: { _id: ex._id },
          update: { $set: { status: derived } }
        }
      });
    }
  }

  if (bulkOps.length > 0) {
    await M.Exam.bulkWrite(bulkOps);
  }
}

function normalizeYear(yr) {
  if (!yr) return '';
  const s = String(yr).trim().toUpperCase();
  const romanMap = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV' };
  return romanMap[s] || s;
}

/**
 * Checks whether a calendar day detail item applies to a specific class.
 * Evaluates student year, department, batch, and class scope (E3).
 *
 * @param {Object} detail - CalendarDay.details element
 * @param {Object} classDoc - Class document (or object with year, deptId, deptName, batch, _id)
 * @returns {boolean}
 */
function matchesClassCalendarScope(detail, classDoc) {
  if (!detail || !classDoc) return false;

  // 1. Year check (if detail defines year and not 'All')
  if (detail.year && detail.year !== 'All') {
    const dYear = normalizeYear(detail.year);
    const clsYear = normalizeYear(classDoc.year);
    if (dYear !== clsYear) return false;
  }

  // 2. Department check (if detail defines deptId or specific deptName)
  if (detail.deptId && classDoc.deptId) {
    if (String(detail.deptId) !== String(classDoc.deptId)) return false;
  }
  if (detail.deptName && detail.deptName !== 'All Departments' && detail.deptName !== 'All' && classDoc.deptName) {
    if (detail.deptName.trim().toLowerCase() !== classDoc.deptName.trim().toLowerCase()) return false;
  }

  // 3. Batch check (if detail defines batch)
  if (detail.batch && classDoc.batch) {
    const { normalizeYearRange } = require('./yearFormat');
    if (normalizeYearRange(detail.batch) !== normalizeYearRange(classDoc.batch)) return false;
  }

  // 4. Class check (if detail defines classId)
  if (detail.classId && classDoc._id) {
    if (String(detail.classId) !== String(classDoc._id)) return false;
  }

  return true;
}


/**
 * Cross-checks whether the semester is valid for the given year level (E6).
 *
 * Rules:
 * - Year I: Semesters I, II (1, 2)
 * - Year II: Semesters III, IV (3, 4)
 * - Year III: Semesters V, VI (5, 6)
 * - Year IV: Semesters VII, VIII (7, 8)
 * - Year All: Allowed any semester
 *
 * @param {string} year - 'I'|'II'|'III'|'IV'|'All' (or 1, 2, 3, 4, 'I Year', etc.)
 * @param {string} semester - 'I'..'VIII' (or 1..8)
 * @returns {{ valid: boolean, error?: string, expectedYear?: string, semester?: string, year?: string }}
 */
function validateYearSemester(year, semester) {
  if (!semester) {
    return { valid: false, error: 'Semester is required.' };
  }

  const sNorm = String(semester).trim().toUpperCase();
  const romanSemMap = {
    '1': 'I', '2': 'II', '3': 'III', '4': 'IV',
    '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII',
    'SEM 1': 'I', 'SEM 2': 'II', 'SEM 3': 'III', 'SEM 4': 'IV',
    'SEM 5': 'V', 'SEM 6': 'VI', 'SEM 7': 'VII', 'SEM 8': 'VIII',
    'SEMESTER 1': 'I', 'SEMESTER 2': 'II', 'SEMESTER 3': 'III', 'SEMESTER 4': 'IV',
    'SEMESTER 5': 'V', 'SEMESTER 6': 'VI', 'SEMESTER 7': 'VII', 'SEMESTER 8': 'VIII'
  };
  const sem = romanSemMap[sNorm] || sNorm;

  const validSemesters = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  if (!validSemesters.includes(sem)) {
    return { valid: false, error: 'Invalid semester "' + semester + '". Allowed: I through VIII.' };
  }

  // Derive expected year for this semester
  let expectedYear = 'I';
  if (['I', 'II'].includes(sem)) expectedYear = 'I';
  else if (['III', 'IV'].includes(sem)) expectedYear = 'II';
  else if (['V', 'VI'].includes(sem)) expectedYear = 'III';
  else if (['VII', 'VIII'].includes(sem)) expectedYear = 'IV';

  if (!year) {
    return { valid: true, expectedYear: expectedYear, semester: sem, year: expectedYear };
  }

  let yNorm = String(year).trim().toUpperCase();
  yNorm = yNorm.replace(/YEAR/g, '').trim();
  const romanYearMap = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV' };
  const y = romanYearMap[yNorm] || yNorm;

  if (y === 'ALL') {
    return { valid: true, expectedYear: expectedYear, semester: sem, year: 'All' };
  }

  const allowedMap = {
    'I': ['I', 'II'],
    'II': ['III', 'IV'],
    'III': ['V', 'VI'],
    'IV': ['VII', 'VIII']
  };

  if (!allowedMap[y]) {
    return { valid: false, error: 'Invalid year "' + year + '". Allowed: I, II, III, IV, All.' };
  }

  if (!allowedMap[y].includes(sem)) {
    return {
      valid: false,
      error: 'Year and Semester mismatch: Semester ' + sem + ' does not belong to Year ' + y + '. Allowed semesters for Year ' + y + ' are ' + allowedMap[y].join(', ') + '.',
      expectedYear: expectedYear
    };
  }

  return { valid: true, expectedYear: expectedYear, semester: sem, year: y };
}

/**
 * Detects duplicate exams or date overlaps for the same cohort / department / class (E6).
 *
 * Conflict criteria:
 * 1. Shares at least one exam date (clean YYYY-MM-DD).
 * 2. Neither exam is 'cancelled'.
 * 3. Scope intersects:
 *    - Department matches (or one is college-wide 'All Departments' / null)
 *    - AND Cohort matches (same batch OR same semester OR same year level)
 *    - AND Class matches (both for same classId/className, OR one/both are dept-wide)
 *
 * @param {Object} newExam - The exam being created or updated
 * @param {Array<Object>} existingExams - List of existing exams
 * @param {string} [excludeTrackId] - ExamTrackId of the exam being updated (to ignore itself)
 * @returns {{ hasConflict: boolean, conflictingExam?: Object, conflictingDates?: string[], error?: string }}
 */
function findExamConflict(newExam, existingExams, excludeTrackId) {
  if (!newExam || !Array.isArray(existingExams) || existingExams.length === 0) {
    return { hasConflict: false };
  }

  const newDates = Array.isArray(newExam.Dates) ? newExam.Dates : [];
  if (newDates.length === 0) return { hasConflict: false };

  const { normalizeYearRange } = require('./yearFormat');
  const newDeptId = newExam.deptId ? String(newExam.deptId) : '';
  const newDeptName = (newExam.deptName || '').trim().toLowerCase();
  const isNewCollegeWide = !newDeptId && (!newDeptName || newDeptName === 'all' || newDeptName === 'all departments');

  const newBatch = newExam.batch ? normalizeYearRange(newExam.batch) : '';
  const newSem = (newExam.semester || '').trim();
  const newYear = normalizeYear(newExam.year);
  const newClassId = newExam.classId ? String(newExam.classId) : '';

  for (const ex of existingExams) {
    if (excludeTrackId && (ex.ExamTrackId === excludeTrackId || String(ex._id) === String(excludeTrackId))) {
      continue;
    }
    if (ex.status === 'cancelled') continue;

    // Check date intersection
    const exDates = Array.isArray(ex.Dates) ? ex.Dates : [];
    const sharedDates = newDates.filter(function(d) { return exDates.includes(d); });
    if (sharedDates.length === 0) continue;

    // 1. Department match check
    const exDeptId = ex.deptId ? String(ex.deptId) : '';
    const exDeptName = (ex.deptName || '').trim().toLowerCase();
    const isExCollegeWide = !exDeptId && (!exDeptName || exDeptName === 'all' || exDeptName === 'all departments');

    let deptMatches = false;
    if (isNewCollegeWide || isExCollegeWide) {
      deptMatches = true;
    } else if (newDeptId && exDeptId) {
      deptMatches = (newDeptId === exDeptId);
    } else if (newDeptName && exDeptName) {
      deptMatches = (newDeptName === exDeptName);
    }

    if (!deptMatches) continue; // Different departments on the same date DO NOT conflict (E3)

    // 2. Cohort match check (batch, semester, or year)
    const exBatch = ex.batch ? normalizeYearRange(ex.batch) : '';
    const exSem = (ex.semester || '').trim();
    const exYear = normalizeYear(ex.year);

    let cohortMatches = false;
    if (newBatch && exBatch && newBatch === exBatch) {
      cohortMatches = true;
    } else if (newSem && exSem && newSem === exSem) {
      cohortMatches = true;
    } else if (newYear && exYear && (newYear === 'ALL' || exYear === 'ALL' || newYear === exYear)) {
      cohortMatches = true;
    }

    if (!cohortMatches) continue;

    // 3. Class match check
    const exClassId = ex.classId ? String(ex.classId) : '';
    let classCollides = false;
    if (!newClassId || !exClassId) {
      // At least one is department-wide, meaning it encompasses all classes in this dept/cohort
      classCollides = true;
    } else if (newClassId === exClassId) {
      // Both are explicitly for the exact same class
      classCollides = true;
    }

    if (!classCollides) continue;

    // If we reached here, there is a conflict!
    const conflictMsg = 'Exam conflict: "' + (ex.title || 'Existing Exam') + '" is already scheduled on ' + sharedDates.join(', ') + ' for the same cohort (' + (ex.deptName || 'College-wide') + ', ' + (ex.batch || ex.year || ('Sem ' + ex.semester)) + ').';
    return {
      hasConflict: true,
      conflictingExam: ex,
      conflictingDates: sharedDates,
      error: conflictMsg
    };
  }

  return { hasConflict: false };
}


/**
 * Normalizes and synchronizes exam schedule rows and Dates list (E7).
 *
 * Each schedule row specifies: date, session (FN/AN/Both), timing, subject, halls.
 * If schedule is provided, Dates is derived from unique dates in schedule.
 * If only Dates is provided, default schedule rows are generated.
 *
 * @param {Array<Object>} [schedule] - Explicit schedule rows
 * @param {Array<string>} [dates] - Legacy Dates list
 * @param {Object} [defaultTiming] - Default start & end timing
 * @param {Array<string>} [defaultHalls] - Default halls
 * @returns {{ schedule: Array<Object>, Dates: Array<string> }}
 */
function normalizeExamSchedule(schedule, dates, defaultTiming, defaultHalls) {
  const timing = defaultTiming || { start: '09:30', end: '12:30' };
  const cleanDefaultHalls = Array.isArray(defaultHalls)
    ? defaultHalls.map(h => String(h).trim()).filter(Boolean)
    : [];

  if (Array.isArray(schedule) && schedule.length > 0) {
    const validRows = [];
    const dateSet = new Set();

    for (const row of schedule) {
      if (!row || !row.date) continue;
      const cleanDate = typeof row.date === 'string' ? row.date.split('T')[0].trim() : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) continue;

      const rawSession = (row.session || 'FN').toUpperCase().trim();
      const session = ['FN', 'AN', 'BOTH'].includes(rawSession)
        ? (rawSession === 'BOTH' ? 'Both' : rawSession)
        : 'FN';

      const rowTiming = {
        start: (row.timing && row.timing.start) || timing.start || '09:30',
        end:   (row.timing && row.timing.end)   || timing.end   || '12:30'
      };

      const rawHalls = Array.isArray(row.halls) ? row.halls : (row.hall ? [row.hall] : cleanDefaultHalls);
      const halls = Array.from(new Set(rawHalls.map(h => String(h).trim()).filter(Boolean)));

      validRows.push({
        date: cleanDate,
        session: session,
        timing: rowTiming,
        subjectId: row.subjectId || null,
        subjectCode: row.subjectCode ? String(row.subjectCode).trim().toUpperCase() : '',
        subjectName: row.subjectName ? String(row.subjectName).trim() : '',
        halls: halls
      });
      dateSet.add(cleanDate);
    }

    validRows.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.session.localeCompare(b.session);
    });

    const uniqueDates = Array.from(dateSet).sort();
    return { schedule: validRows, Dates: uniqueDates };
  }

  // Fallback when only dates are supplied
  const cleanDates = Array.isArray(dates)
    ? Array.from(new Set(dates.map(d => (typeof d === 'string' ? d.split('T')[0].trim() : '')).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))).sort()
    : [];

  const generatedSchedule = cleanDates.map(d => ({
    date: d,
    session: 'FN',
    timing: { start: timing.start || '09:30', end: timing.end || '12:30' },
    subjectId: null,
    subjectCode: '',
    subjectName: '',
    halls: cleanDefaultHalls
  }));

  return { schedule: generatedSchedule, Dates: cleanDates };
}

/**
 * Checks for hall assignment conflicts across scheduled exams (E7).
 *
 * Conflict condition:
 * - Same exam date (YYYY-MM-DD).
 * - Overlapping session ('FN', 'AN', or 'Both') or overlapping timing.
 * - Same hall name allocated.
 * - Conflicting exam is active (status !== 'cancelled').
 *
 * @param {Array<Object>} newSchedule - Schedule rows being saved
 * @param {Array<Object>} existingExams - List of existing exams
 * @param {string} [excludeTrackId] - Self ExamTrackId to ignore
 * @returns {{ hasConflict: boolean, hall?: string, date?: string, session?: string, conflictingExam?: Object, error?: string }}
 */
function findHallConflicts(newSchedule, existingExams, excludeTrackId) {
  if (!Array.isArray(newSchedule) || newSchedule.length === 0 || !Array.isArray(existingExams) || existingExams.length === 0) {
    return { hasConflict: false };
  }

  for (const newRow of newSchedule) {
    if (!newRow || !newRow.date || !Array.isArray(newRow.halls) || newRow.halls.length === 0) continue;

    for (const ex of existingExams) {
      if (excludeTrackId && (ex.ExamTrackId === excludeTrackId || String(ex._id) === String(excludeTrackId))) {
        continue;
      }
      if (ex.status === 'cancelled') continue;

      // Extract existing exam's schedule rows or synthesize from Dates + timing
      const exRows = (Array.isArray(ex.schedule) && ex.schedule.length > 0)
        ? ex.schedule
        : (Array.isArray(ex.Dates) ? ex.Dates.map(d => ({ date: d, session: 'FN', timing: ex.timing, halls: [] })) : []);

      for (const exRow of exRows) {
        if (!exRow || exRow.date !== newRow.date) continue;

        // Check session/time overlap
        const newSess = (newRow.session || 'FN').toUpperCase();
        const exSess = (exRow.session || 'FN').toUpperCase();
        const sessionOverlaps = (newSess === 'BOTH' || exSess === 'BOTH' || newSess === exSess);

        if (!sessionOverlaps) continue;

        // Check hall intersection
        const exHalls = Array.isArray(exRow.halls) ? exRow.halls.map(h => String(h).trim().toLowerCase()) : [];
        for (const hall of newRow.halls) {
          const normHall = String(hall).trim().toLowerCase();
          if (normHall && exHalls.includes(normHall)) {
            const conflictMsg = 'Hall conflict: Hall "' + hall + '" is already allocated for "' + (ex.title || 'Exam') + '" on ' + newRow.date + ' (' + newRow.session + ').';
            return {
              hasConflict: true,
              hall: hall,
              date: newRow.date,
              session: newRow.session,
              conflictingExam: ex,
              error: conflictMsg
            };
          }
        }
      }
    }
  }

  return { hasConflict: false };
}

module.exports = { refreshExamStatuses, deriveExamStatus, matchesClassCalendarScope, normalizeYear, validateYearSemester, findExamConflict, normalizeExamSchedule, findHallConflicts };

