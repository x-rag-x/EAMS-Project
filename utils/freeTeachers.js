const M = require('../models');
const { todayIST } = require('./institutionTime');

/**
 * Free-Teacher Finder Engine
 * Finds and ranks available faculty for a specific date and period.
 * 
 * Rules:
 * - Free = No active ClassSession at that period, not on approved faculty leave, not RESERVED.
 * - RESERVED = Holding an accepted-but-not-yet-approved substitution.
 * - Ranking:
 *   1. Can teach the subject (teaches subject in this or another section)
 *   2. Same department as the class
 *   3. Lowest substitution load this week (fewest substitutions taken)
 *   4. Schedule spacing: not teaching immediately adjacent periods (P-1 or P+1 today)
 * 
 * @param {Object} params
 * @param {string} params.dateStr - YYYY-MM-DD (IST)
 * @param {number} params.periodNumber - Period number (1..8)
 * @param {string} [params.deptCode] - Target class department code
 * @param {string|mongoose.Types.ObjectId} [params.classId] - Target class ID
 * @param {string|mongoose.Types.ObjectId} [params.subjectId] - Target subject ID
 * @param {string} [params.subjectCode] - Target subject code
 * @param {Array<string>} [params.excludeTeacherTrackIds] - Faculty to exclude
 * @returns {Promise<Array<Object>>} Ranked list of candidate teachers
 */
async function getFreeTeachers({
  dateStr,
  periodNumber,
  deptCode = null,
  classId = null,
  subjectId = null,
  subjectCode = null,
  excludeTeacherTrackIds = []
}) {
  const pNum = Number(periodNumber);
  const targetDate = dateStr;

  // 1. Fetch all active teachers (optionally prioritize department)
  const teacherFilter = {
    // Exclude specified teachers
    trackId: { $nin: excludeTeacherTrackIds || [] }
  };

  const allTeachers = await M.Teacher.find(teacherFilter)
    .select('trackId fullName name email phone department deptId deptCode')
    .lean();

  if (!allTeachers || allTeachers.length === 0) {
    return [];
  }

  // 2. Fetch ClassSessions for this date to determine:
  //    a) Who is teaching period pNum (BUSY)
  //    b) Who is teaching pNum - 1 or pNum + 1 (adjacent period teaching)
  const dateSessions = await M.ClassSession.find({
    date: targetDate,
    status: { $ne: 'cancelled' }
  }).lean();

  const busyTeacherTrackIds = new Set();
  const adjacentTeacherTrackIds = new Set();

  for (const sess of dateSessions) {
    const sessP = Number(sess.periodNumber);
    const teacherId = sess.actualTeacher?.trackId || sess.scheduledTeacher?.trackId;
    if (!teacherId) continue;

    if (sessP === pNum) {
      busyTeacherTrackIds.add(teacherId);
    } else if (sessP === pNum - 1 || sessP === pNum + 1) {
      adjacentTeacherTrackIds.add(teacherId);
    }
  }

  // 3. Fetch approved TeacherLeaveRequests covering this date & period
  const leaveDocs = await M.TeacherLeaveRequest.find({
    dates: targetDate,
    status: 'Approved'
  }).lean();

  for (const lv of leaveDocs) {
    // If leave covers full day or slot covers pNum
    if (!lv.substitutions || lv.substitutions.length === 0) {
      // Full day absence
      busyTeacherTrackIds.add(lv.teacherTrackId);
    } else {
      const coversP = lv.substitutions.some(s => Number(s.periodNumber) === pNum);
      if (coversP) {
        busyTeacherTrackIds.add(lv.teacherTrackId);
      }
    }
  }

  // 4. Check for RESERVED teachers (holding an accepted-but-pending substitution)
  const pendingLeaves = await M.TeacherLeaveRequest.find({
    status: 'Pending',
    'substitutions.date': targetDate,
    'substitutions.periodNumber': pNum,
    'substitutions.status': 'accepted'
  }).lean();

  const reservedTeacherTrackIds = new Set();
  for (const pl of pendingLeaves) {
    for (const sub of pl.substitutions || []) {
      if (sub.date === targetDate && Number(sub.periodNumber) === pNum && sub.status === 'accepted') {
        reservedTeacherTrackIds.add(sub.substituteTeacherTrackId);
      }
    }
  }

  // 5. Calculate weekly substitution load per teacher (past 7 days)
  const past7DaysStart = todayIST(new Date(new Date(targetDate).getTime() - 7 * 86400000));
  const weeklySubs = await M.ClassSession.find({
    date: { $gte: past7DaysStart, $lte: targetDate },
    source: 'substitution',
    status: { $ne: 'cancelled' }
  }).lean();

  const subLoadMap = new Map();
  for (const s of weeklySubs) {
    const tId = s.actualTeacher?.trackId;
    if (tId) {
      subLoadMap.set(tId, (subLoadMap.get(tId) || 0) + 1);
    }
  }

  // 6. Check subject familiarity if subjectId or subjectCode provided
  let familiarTeacherTrackIds = new Set();
  if (subjectId || subjectCode) {
    // Look up recent timetable slots or teacher qualifications for this subject
    const subjectMatches = await M.Subject.find({
      $or: [
        ...(subjectId ? [{ _id: subjectId }] : []),
        ...(subjectCode ? [{ code: subjectCode }] : [])
      ]
    }).lean();

    const subCodes = subjectMatches.map(s => s.code);
    if (subCodes.length > 0) {
      const matchTimetables = await M.Timetable.find({
        'grid.subjectCode': { $in: subCodes }
      }).lean();

      for (const tt of matchTimetables) {
        for (const row of tt.grid || []) {
          if (subCodes.includes(row.subjectCode) && row.teacherTrackId) {
            familiarTeacherTrackIds.add(row.teacherTrackId);
          }
        }
      }
    }
  }

  // 7. Filter and Score Candidates
  const candidates = [];

  for (const t of allTeachers) {
    const isBusy = busyTeacherTrackIds.has(t.trackId);
    if (isBusy) continue; // Completely unavailable

    const isReserved = reservedTeacherTrackIds.has(t.trackId);
    const isSameDept = deptCode && (t.deptCode === deptCode || t.department?.toUpperCase().includes(deptCode.toUpperCase()));
    const canTeachSubject = familiarTeacherTrackIds.has(t.trackId);
    const hasAdjacentPeriod = adjacentTeacherTrackIds.has(t.trackId);
    const loadThisWeek = subLoadMap.get(t.trackId) || 0;

    // Score calculation (higher is better)
    let score = 100;

    if (canTeachSubject) score += 50;
    if (isSameDept) score += 30;
    score -= loadThisWeek * 5; // Penalty for each substitution already taken this week
    if (hasAdjacentPeriod) score -= 10; // Slight penalty for back-to-back periods
    if (isReserved) score -= 40; // Heavy penalty if reserved

    const tags = [];
    if (canTeachSubject) tags.push('Subject Match');
    if (isSameDept) tags.push('Same Dept');
    if (loadThisWeek === 0) tags.push('No Subs This Week');
    if (isReserved) tags.push('RESERVED');
    if (hasAdjacentPeriod) tags.push('Adjacent Class');

    candidates.push({
      teacherId: t._id,
      trackId: t.trackId,
      fullName: t.fullName || t.name,
      name: t.name || t.fullName,
      email: t.email,
      phone: t.phone || '',
      department: t.department,
      deptCode: t.deptCode || deptCode || '',
      matchScore: Math.max(score, 0),
      isReserved,
      isSameDept: Boolean(isSameDept),
      canTeachSubject: Boolean(canTeachSubject),
      hasAdjacentPeriod: Boolean(hasAdjacentPeriod),
      loadThisWeek,
      tags
    });
  }

  // 8. Sort: Unreserved first, then highest score, then lowest workload
  candidates.sort((a, b) => {
    if (a.isReserved !== b.isReserved) return a.isReserved ? 1 : -1;
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return a.loadThisWeek - b.loadThisWeek;
  });

  return candidates;
}

module.exports = {
  getFreeTeachers
};
