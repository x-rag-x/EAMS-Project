const M = require('../models');

/**
 * Reconcile attendance records when an OD Request is approved.
 * Converts absent periods to present with reason: 'od'.
 * If student was already marked present, retains present and adds reason: 'od'.
 *
 * @param {Object} params
 * @param {string} params.odRequestId
 * @param {string} params.studentTrackId
 * @param {string} params.classId
 * @param {Array<string>} params.dates - Array of YYYY-MM-DD
 * @param {Array<number>} [params.periodNumbers] - Periods to reconcile (empty = all)
 * @param {string} [params.actorTrackId]
 * @param {string} [params.actorRole]
 */
async function reconcileOnODApproved({
  odRequestId,
  studentTrackId,
  classId,
  dates,
  periodNumbers = [],
  actorTrackId = 'system',
  actorRole = 'system'
}) {
  for (const dateStr of dates) {
    const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
    const endOfDay = new Date(dateStr + 'T23:59:59.999Z');

    const classAtt = await M.ClassAttendance.findOne({
      classId,
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    if (!classAtt || !Array.isArray(classAtt.periods)) continue;

    let modified = false;

    for (const period of classAtt.periods) {
      const pNum = period.periodNumber || (period.periodNumbers && period.periodNumbers[0]);
      if (periodNumbers.length > 0 && !periodNumbers.includes(pNum)) {
        continue;
      }

      const rec = period.records.find(r => r.studentTrackId === studentTrackId);
      if (!rec) continue;

      const previousStatus = rec.status;
      // Convert to Present if it was Absent; keep Present if already marked Present
      rec.status = 'P';
      rec.reason = 'od';
      rec.source = {
        type: 'OD_REQUEST',
        id: odRequestId
      };
      rec.locked = true;

      if (!Array.isArray(rec.history)) rec.history = [];
      rec.history.push({
        status: 'P',
        reason: 'od',
        by: actorTrackId,
        role: actorRole,
        at: new Date(),
        note: `Approved OD (${odRequestId}): converted from ${previousStatus} to P`
      });

      modified = true;
    }

    if (modified) {
      classAtt.updatedAt = new Date();
      await classAtt.save();
    }
  }
}

/**
 * Reconcile attendance records when an approved OD is rejected (whole or dates).
 * Reverts only records created/locked by this OD back to Absent.
 *
 * @param {Object} params
 * @param {string} params.odRequestId
 * @param {string} params.studentTrackId
 * @param {string} params.classId
 * @param {Array<string>} params.dates
 * @param {Array<number>} [params.periodNumbers]
 * @param {string} [params.actorTrackId]
 * @param {string} [params.actorRole]
 * @param {string} [params.reason]
 */
async function reconcileOnODRejected({
  odRequestId,
  studentTrackId,
  classId,
  dates,
  periodNumbers = [],
  actorTrackId = 'system',
  actorRole = 'system',
  reason = 'OD Rejected'
}) {
  for (const dateStr of dates) {
    const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
    const endOfDay = new Date(dateStr + 'T23:59:59.999Z');

    const classAtt = await M.ClassAttendance.findOne({
      classId,
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    if (!classAtt || !Array.isArray(classAtt.periods)) continue;

    let modified = false;

    for (const period of classAtt.periods) {
      const pNum = period.periodNumber || (period.periodNumbers && period.periodNumbers[0]);
      if (periodNumbers.length > 0 && !periodNumbers.includes(pNum)) {
        continue;
      }

      const rec = period.records.find(r => r.studentTrackId === studentTrackId);
      if (!rec) continue;

      // Only change records where source matches this OD request
      if (rec.source && rec.source.id === odRequestId) {
        rec.status = 'AB';
        rec.reason = null;
        rec.source = null;
        rec.locked = false;

        if (!Array.isArray(rec.history)) rec.history = [];
        rec.history.push({
          status: 'AB',
          reason: 'od_rejected',
          by: actorTrackId,
          role: actorRole,
          at: new Date(),
          note: `OD Revoked (${odRequestId}): ${reason}`
        });

        modified = true;
      }
    }

    if (modified) {
      classAtt.updatedAt = new Date();
      await classAtt.save();
    }
  }
}

/**
 * Reconcile attendance records when a Student Leave is approved.
 * Marks absent records as reason: 'leave' and locked: true.
 * Invariant: Present records are NEVER converted to absent (preserves teacher's present mark),
 * but a flag is returned.
 *
 * @param {Object} params
 * @param {string} params.leaveRequestId
 * @param {string} params.studentTrackId
 * @param {string} params.classId
 * @param {Array<string>} params.dates
 * @param {Array<number>} [params.periodNumbers]
 * @param {string} [params.actorTrackId]
 * @param {string} [params.actorRole]
 * @returns {Promise<Array<Object>>} Warnings if student was already marked present
 */
async function reconcileOnLeaveApproved({
  leaveRequestId,
  studentTrackId,
  classId,
  dates,
  periodNumbers = [],
  actorTrackId = 'system',
  actorRole = 'system'
}) {
  const presentConflicts = [];

  for (const dateStr of dates) {
    const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
    const endOfDay = new Date(dateStr + 'T23:59:59.999Z');

    const classAtt = await M.ClassAttendance.findOne({
      classId,
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    if (!classAtt || !Array.isArray(classAtt.periods)) continue;

    let modified = false;

    for (const period of classAtt.periods) {
      const pNum = period.periodNumber || (period.periodNumbers && period.periodNumbers[0]);
      if (periodNumbers.length > 0 && !periodNumbers.includes(pNum)) {
        continue;
      }

      const rec = period.records.find(r => r.studentTrackId === studentTrackId);
      if (!rec) continue;

      if (rec.status === 'AB') {
        rec.reason = 'leave';
        rec.source = {
          type: 'LEAVE_REQUEST',
          id: leaveRequestId
        };
        rec.locked = true;

        if (!Array.isArray(rec.history)) rec.history = [];
        rec.history.push({
          status: 'AB',
          reason: 'leave',
          by: actorTrackId,
          role: actorRole,
          at: new Date(),
          note: `Approved Student Leave (${leaveRequestId})`
        });

        modified = true;
      } else if (rec.status === 'P') {
        // Invariant: Present is never changed to Absent
        presentConflicts.push({
          date: dateStr,
          periodNumber: pNum,
          studentTrackId,
          message: `Student was marked Present in P${pNum} on a leave day (${dateStr})`
        });
      }
    }

    if (modified) {
      classAtt.updatedAt = new Date();
      await classAtt.save();
    }
  }

  return presentConflicts;
}

/**
 * Reconcile when a leave is cancelled.
 */
async function reconcileOnLeaveCancelled({
  leaveRequestId,
  studentTrackId,
  classId,
  dates,
  periodNumbers = [],
  actorTrackId = 'system',
  actorRole = 'system'
}) {
  for (const dateStr of dates) {
    const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
    const endOfDay = new Date(dateStr + 'T23:59:59.999Z');

    const classAtt = await M.ClassAttendance.findOne({
      classId,
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    if (!classAtt || !Array.isArray(classAtt.periods)) continue;

    let modified = false;

    for (const period of classAtt.periods) {
      const pNum = period.periodNumber || (period.periodNumbers && period.periodNumbers[0]);
      if (periodNumbers.length > 0 && !periodNumbers.includes(pNum)) {
        continue;
      }

      const rec = period.records.find(r => r.studentTrackId === studentTrackId);
      if (!rec) continue;

      if (rec.source && rec.source.id === leaveRequestId) {
        rec.reason = null;
        rec.source = null;
        rec.locked = false;

        if (!Array.isArray(rec.history)) rec.history = [];
        rec.history.push({
          status: rec.status,
          reason: 'leave_cancelled',
          by: actorTrackId,
          role: actorRole,
          at: new Date(),
          note: `Leave Cancelled (${leaveRequestId})`
        });

        modified = true;
      }
    }

    if (modified) {
      classAtt.updatedAt = new Date();
      await classAtt.save();
    }
  }
}

/**
 * Previews the impact of rejecting an approved OD for specific dates/periods.
 *
 * @param {Object} params
 * @param {string} params.odRequestId
 * @param {string} params.studentTrackId
 * @param {string} params.classId
 * @param {Array<string>} params.dates
 * @param {Array<number>} [params.periodNumbers]
 * @returns {Promise<{ affectedPeriodsCount: number, requestedDates: Array<string>, details: string }>}
 */
async function previewODRejection({
  odRequestId,
  studentTrackId,
  classId,
  dates = [],
  periodNumbers = []
}) {
  let affectedCount = 0;
  for (const dateStr of dates) {
    const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
    const endOfDay = new Date(dateStr + 'T23:59:59.999Z');

    let classAtt = null;
    try {
      if (M.ClassAttendance) {
        classAtt = await M.ClassAttendance.findOne({
          classId,
          date: { $gte: startOfDay, $lte: endOfDay }
        }).lean();
      }
    } catch (e) {}

    if (classAtt && Array.isArray(classAtt.periods)) {
      for (const period of classAtt.periods) {
        const pNum = period.periodNumber || (period.periodNumbers && period.periodNumbers[0]);
        if (periodNumbers.length > 0 && !periodNumbers.includes(pNum)) continue;
        const rec = (period.records || []).find(r => r.studentTrackId === studentTrackId);
        if (rec && rec.source && rec.source.id === odRequestId) {
          affectedCount++;
        }
      }
    } else {
      // Default estimation: count of periods requested or 7 periods per day
      affectedCount += periodNumbers.length > 0 ? periodNumbers.length : 7;
    }
  }

  return {
    affectedPeriodsCount: affectedCount,
    requestedDates: dates,
    details: `${affectedCount} period(s) across ${dates.length} date(s) will change from OD-Present to Absent.`
  };
}

/**
 * Reconcile a specific period attendance override by an advisor/staff.
 * Updates the period record for the student, sets locked: true, and records history.
 *
 * @param {Object} params
 * @param {string} params.classId
 * @param {string} params.dateStr - YYYY-MM-DD
 * @param {number} params.periodNumber
 * @param {string} params.studentTrackId
 * @param {string} params.newStatus - 'P' or 'AB' / 'A'
 * @param {string} params.reasonNote
 * @param {string} [params.actorTrackId]
 * @param {string} [params.actorRole]
 */
async function reconcilePeriodOverride({
  classId,
  dateStr,
  periodNumber,
  studentTrackId,
  newStatus,
  reasonNote,
  actorTrackId = 'system',
  actorRole = 'system'
}) {
  const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
  const endOfDay = new Date(dateStr + 'T23:59:59.999Z');

  const classAtt = await M.ClassAttendance.findOne({
    classId,
    date: { $gte: startOfDay, $lte: endOfDay }
  });

  if (!classAtt || !Array.isArray(classAtt.periods)) {
    return { ok: false, message: 'Class attendance record not found for date' };
  }

  const pNum = Number(periodNumber);
  const period = classAtt.periods.find(p => {
    const directNum = p.periodNumber || (Array.isArray(p.periodNumbers) && p.periodNumbers[0]);
    return directNum === pNum || (Array.isArray(p.periodNumbers) && p.periodNumbers.includes(pNum));
  });

  if (!period || !Array.isArray(period.records)) {
    return { ok: false, message: 'Period record not found' };
  }

  const rec = period.records.find(r => r.studentTrackId === studentTrackId);
  if (!rec) {
    return { ok: false, message: 'Student record not found in period' };
  }

  const normalizedStatus = (newStatus === 'P' || newStatus === 'Present') ? 'P' : 'AB';
  const previousStatus = rec.status;
  rec.status = normalizedStatus;
  rec.reason = normalizedStatus === 'P' ? null : 'leave';
  rec.locked = true;

  if (!Array.isArray(rec.history)) rec.history = [];
  rec.history.push({
    status: normalizedStatus,
    reason: 'advisor_override',
    by: actorTrackId,
    role: actorRole,
    at: new Date(),
    note: reasonNote || `Advisor period override: ${previousStatus} -> ${normalizedStatus}`
  });

  classAtt.updatedAt = new Date();
  await classAtt.save();
  return { ok: true, previousStatus, newStatus: normalizedStatus };
}

module.exports = {
  reconcileOnODApproved,
  reconcileOnODRejected,
  previewODRejection,
  reconcileOnLeaveApproved,
  reconcileOnLeaveCancelled,
  reconcilePeriodOverride
};

