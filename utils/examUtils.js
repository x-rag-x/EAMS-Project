const M = require('../models');
const { todayInInstitutionTz } = require('./institutionTime');

/**
 * Maps semester to Year ('I'|'II'|'III'|'IV')
 */
function semToYear(sem, fallbackYr) {
  if (fallbackYr && ['I', 'II', 'III', 'IV', 'All'].includes(fallbackYr)) return fallbackYr;
  if (['I', 'II'].includes(sem)) return 'I';
  if (['III', 'IV'].includes(sem)) return 'II';
  if (['V', 'VI'].includes(sem)) return 'III';
  if (['VII', 'VIII'].includes(sem)) return 'IV';
  return 'I';
}

/**
 * Cross-validates Academic Year level against semester (Fix E6)
 */
function validateYearSemester(year, semester) {
  const expectedYear = semToYear(semester);
  if (year && year !== 'All' && year !== expectedYear) {
    return {
      valid: false,
      message: `Invalid year/semester combination: Year ${year} does not match Semester ${semester} (expected Year ${expectedYear})`
    };
  }
  return { valid: true };
}

/**
 * Refreshes exam status derived from real session dates (Fix E1)
 */
async function refreshExamStatuses() {
  try {
    const today = await todayInInstitutionTz();
    const todayStr = (today instanceof Date ? today.toISOString() : String(today)).slice(0, 10);

    const activeExams = await M.Exam.find({
      status: { $nin: ['cancelled'] }
    });

    const updates = [];
    for (const exam of activeExams) {
      let dates = [];
      if (Array.isArray(exam.sessions) && exam.sessions.length > 0) {
        dates = exam.sessions.map(s => s && s.date ? String(s.date).split('T')[0] : '').filter(Boolean);
      } else if (Array.isArray(exam.Dates) && exam.Dates.length > 0) {
        dates = exam.Dates.map(d => String(d).split('T')[0]).filter(Boolean);
      }

      if (!dates.length) continue;
      dates.sort();
      const minDate = dates[0];
      const maxDate = dates[dates.length - 1];

      let targetStatus = 'upcoming';
      if (todayStr < minDate) {
        targetStatus = 'upcoming';
      } else if (todayStr > maxDate) {
        targetStatus = 'completed';
      } else {
        targetStatus = 'ongoing';
      }

      if (exam.status !== targetStatus) {
        updates.push({
          updateOne: {
            filter: { _id: exam._id },
            update: { $set: { status: targetStatus } }
          }
        });
      }
    }

    if (updates.length > 0) {
      await M.Exam.bulkWrite(updates);
    }
  } catch (err) {
    console.error('[ExamUtils] refreshExamStatuses error:', err.message);
  }
}

module.exports = {
  semToYear,
  validateYearSemester,
  refreshExamStatuses,
};
