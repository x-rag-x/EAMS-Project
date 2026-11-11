'use strict';

/**
 * Student request summary — the numbers an approver needs next to a Leave/OD request:
 * attendance percentage, how much leave / OD the student has already taken, and the
 * student's complete request history (Leave + OD, newest first).
 *
 * Read-only. Never writes to the database (unlike utils/attendanceCalculator.js).
 */

const M = require('../models');

const HISTORY_LIMIT = 40;

/** Same counting rule as GET /api/leave/detail/:id (P records / all marked periods). */
async function getAttendanceSnapshot(identifiers) {
  const ids = (identifiers || []).filter(Boolean);
  if (!ids.length) return { overallPercentage: null, attendedClasses: 0, totalClasses: 0 };

  const docs = await M.ClassAttendance.find({
    'periods.records.studentTrackId': { $in: ids }
  }).select('periods.records').lean();

  let total = 0;
  let attended = 0;
  for (const doc of docs) {
    for (const period of doc.periods || []) {
      const mine = (period.records || []).find(r => ids.includes(r.studentTrackId));
      if (mine) {
        total++;
        if (mine.status === 'P') attended++;
      }
    }
  }
  return {
    overallPercentage: total > 0 ? Math.round((attended / total) * 100) : 100,
    attendedClasses: attended,
    totalClasses: total
  };
}

function titleCaseStatus(status) {
  const s = String(status || '').toLowerCase();
  if (['approved', 'completed', 'awaiting_outcome', 'evidence_overdue'].includes(s)) return 'Approved';
  if (s === 'rejected') return 'Rejected';
  if (s === 'cancelled') return 'Cancelled';
  if (s === 'returned') return 'Returned';
  return 'Pending';
}

/**
 * @param {string|string[]|Object} param  studentTrackId or { identifiers, excludeRequestId, withAttendance }
 */
async function getStudentRequestSummary(param) {
  let identifiers = [];
  let excludeRequestId = null;
  let withAttendance = true;

  if (typeof param === 'string') {
    identifiers = [param];
  } else if (Array.isArray(param)) {
    identifiers = param;
  } else if (param && typeof param === 'object') {
    if (param.identifiers) {
      identifiers = Array.isArray(param.identifiers) ? param.identifiers : [param.identifiers];
    } else if (param.studentTrackId) {
      identifiers = [param.studentTrackId];
    }
    if (param.excludeRequestId) excludeRequestId = param.excludeRequestId;
    if (param.withAttendance !== undefined) withAttendance = !!param.withAttendance;
  }

  const ids = (identifiers || []).filter(Boolean);

  const [leaves, ods, attendance] = await Promise.all([
    M.LeaveRequest.find({ studentTrackId: { $in: ids } })
      .select('requestId category leaveCategory leaveType slot fromDate toDate daysCount status createdAt')
      .sort({ createdAt: -1 }).limit(HISTORY_LIMIT).lean(),
    M.ODRequest.find({ studentTrackId: { $in: ids } })
      .select('requestId eventDetails.name eventDetails.type dates daysCount status createdAt')
      .sort({ createdAt: -1 }).limit(HISTORY_LIMIT).lean(),
    withAttendance ? getAttendanceSnapshot(ids) : Promise.resolve(null)
  ]);

  const history = [];
  const totals = { leaveDays: 0, permissionDays: 0, leaveCount: 0, odDays: 0, odCount: 0 };

  for (const r of leaves) {
    const status = titleCaseStatus(r.status);
    const days = Number(r.daysCount) || (r.category === 'Permission' ? 0.5 : 1);
    if (status === 'Approved') {
      if (r.category === 'Permission') totals.permissionDays += days;
      else { totals.leaveDays += days; totals.leaveCount++; }
    }
    if (r.requestId && r.requestId === excludeRequestId) continue;
    history.push({
      kind: 'leave',
      requestId: r.requestId || '',
      appliedOn: r.createdAt,
      title: r.category === 'Permission' ? 'Permission' : (r.leaveCategory || r.leaveType || 'Leave'),
      fromDate: r.fromDate,
      toDate: r.toDate,
      days,
      status
    });
  }

  for (const r of ods) {
    const status = titleCaseStatus(r.status);
    const days = Number(r.daysCount) || 1;
    const dates = Array.isArray(r.dates) ? r.dates : [];
    if (status === 'Approved') { totals.odDays += days; totals.odCount++; }
    if (r.requestId && r.requestId === excludeRequestId) continue;
    history.push({
      kind: 'od',
      requestId: r.requestId || '',
      appliedOn: r.createdAt,
      title: (r.eventDetails && r.eventDetails.name) || 'On-duty',
      fromDate: dates[0] || '',
      toDate: dates[dates.length - 1] || '',
      days,
      status
    });
  }

  history.sort((a, b) => new Date(b.appliedOn) - new Date(a.appliedOn));

  const leavesTaken = totals.leaveDays + totals.permissionDays;
  const odTaken = totals.odDays;

  return {
    attendance,
    attendancePercent: attendance ? attendance.overallPercentage : null,
    totals,
    leavesTaken,
    odTaken,
    leaveDays: totals.leaveDays,
    odDays: totals.odDays,
    history: history.slice(0, HISTORY_LIMIT)
  };
}

module.exports = { getStudentRequestSummary, getAttendanceSnapshot };
