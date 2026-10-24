const M = require('../models');
const { deriveSessionState } = require('./sessionState');
const { getSettings } = require('./settingsCache');
const { getTodayIST } = require('../middleware/scope');
const { getCurrentTimeHM, timeToMinutes } = require('./alertRules');

/**
 * Generate a complete Live Board snapshot for a given scope, date, and time.
 * Supports Time Machine via `atTime`.
 *
 * @param {Object} params
 * @param {string} params.asRole - 'principal' | 'hod'
 * @param {Array<string>} params.deptCodes - Department codes in scope
 * @param {string} [params.dateStr] - YYYY-MM-DD IST
 * @param {string|Date} [params.atTime] - Time machine HH:MM or Date
 * @returns {Promise<Object>} Snapshot containing KPIs, tiles, and active filters
 */
async function getLiveBoardSnapshot({ asRole, deptCodes, dateStr = null, atTime = null }) {
  const targetDate = dateStr || getTodayIST();
  const targetTime = atTime || getCurrentTimeHM();
  const currentMinutes = timeToMinutes(typeof targetTime === 'string' ? targetTime : getCurrentTimeHM(targetTime));

  const settings = await getSettings(['controller']);
  const ctrlSettings = settings.controller || {};

  // Build department query filter
  const query = { date: targetDate };
  if (Array.isArray(deptCodes) && deptCodes.length > 0 && !deptCodes.includes('ALL')) {
    query.deptCode = { $in: deptCodes.map(d => String(d).toUpperCase()) };
  }

  const sessionDocs = await M.ClassSession.find(query).sort({ periodNumber: 1, className: 1 }).lean();

  let runningCount = 0;
  let onTimeCount = 0;
  let inWindowCount = 0;
  let overdueCount = 0;
  let needsSubCount = 0;
  let totalPresentCount = 0;
  let totalEnrolledCount = 0;

  const tiles = sessionDocs.map(session => {
    const derived = deriveSessionState(session, targetTime, ctrlSettings);
    const startM = timeToMinutes(session.start);
    const endM = timeToMinutes(session.end);
    const isCurrent = currentMinutes >= startM && currentMinutes <= endM;

    if (isCurrent) runningCount++;
    if (derived.state === 'marked_on_time') onTimeCount++;
    if (derived.state === 'marking_window') inWindowCount++;
    if (derived.state === 'overdue') overdueCount++;
    if (derived.state === 'needs_substitute') needsSubCount++;

    if (session.attendance?.savedAt && session.attendance.total > 0) {
      totalPresentCount += (session.attendance.present || 0);
      totalEnrolledCount += session.attendance.total;
    }

    return {
      _id: session._id,
      classId: session.classId,
      className: session.className,
      deptCode: session.deptCode,
      year: session.year,
      section: session.section,
      periodNumber: session.periodNumber,
      span: session.span,
      start: session.start,
      end: session.end,
      slotType: session.slotType,
      subjectName: session.subjectName,
      room: session.room,
      scheduledTeacher: session.scheduledTeacher,
      actualTeacher: session.actualTeacher,
      source: session.source,
      status: session.status,
      startClass: session.startClass,
      attendance: session.attendance,
      leavePendingPrincipal: session.leavePendingPrincipal,
      derived,
      isCurrentPeriod: isCurrent
    };
  });

  const presentPct = totalEnrolledCount > 0
    ? Math.round((totalPresentCount / totalEnrolledCount) * 100)
    : 0;

  return {
    date: targetDate,
    atTime: targetTime,
    scope: { asRole, deptCodes },
    kpis: {
      running: runningCount,
      onTime: onTimeCount,
      inWindow: inWindowCount,
      overdue: overdueCount,
      needsSub: needsSubCount,
      presentPct,
      totalSessions: sessionDocs.length
    },
    tiles
  };
}

/**
 * Generate a Day Matrix snapshot (sections × today's periods).
 *
 * @param {Object} params
 * @param {Array<string>} params.deptCodes
 * @param {string} [params.dateStr]
 */
async function getDayMatrixSnapshot({ deptCodes, dateStr = null }) {
  const targetDate = dateStr || getTodayIST();
  const query = { date: targetDate };
  if (Array.isArray(deptCodes) && deptCodes.length > 0 && !deptCodes.includes('ALL')) {
    query.deptCode = { $in: deptCodes.map(d => String(d).toUpperCase()) };
  }

  const sessions = await M.ClassSession.find(query).sort({ className: 1, periodNumber: 1 }).lean();
  const settings = await getSettings(['controller']);
  const now = new Date();

  // Group by section / classId
  const matrixMap = new Map();

  for (const s of sessions) {
    if (!matrixMap.has(s.classId)) {
      matrixMap.set(s.classId, {
        classId: s.classId,
        className: s.className,
        deptCode: s.deptCode,
        year: s.year,
        section: s.section,
        periods: {}
      });
    }

    const derived = deriveSessionState(s, now, settings.controller);
    const row = matrixMap.get(s.classId);
    row.periods[s.periodNumber] = {
      sessionId: s._id,
      subjectName: s.subjectName,
      teacher: s.actualTeacher?.name || s.scheduledTeacher?.name || 'TBA',
      state: derived.state,
      label: derived.label,
      icon: derived.icon,
      badgeClass: derived.badgeClass,
      onTime: s.attendance?.onTime,
      present: s.attendance?.present,
      total: s.attendance?.total
    };
  }

  return {
    date: targetDate,
    sections: Array.from(matrixMap.values())
  };
}

module.exports = {
  getLiveBoardSnapshot,
  getDayMatrixSnapshot
};
