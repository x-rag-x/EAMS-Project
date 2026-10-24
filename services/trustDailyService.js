const mongoose = require('mongoose');
const M = require('../models');
const { getSettings } = require('../utils/settingsCache');
const { applyTrustEvent } = require('../utils/trustEngine');
const { logAction } = require('../utils/logAction');
const { todayInInstitutionTzSync, todayIST } = require('../utils/institutionTime');

/**
 * services/trustDailyService.js
 *
 * Daily Trust Score Evaluation & Backdated Leave Reversal (§8, T4.2):
 * 1. Evaluates uninformed full-day absences (-4) for dates past the auto-lock window.
 * 2. Evaluates monthly frequent uninformed absence threshold (>6 -> -2 once per month).
 * 3. Handles automatic reversal of penalties upon approved backdated leave or OD requests.
 */

let _dailySchedulerInterval = null;
let _dailyInitialTimeout = null;

/**
 * Helper to get yesterday's date in YYYY-MM-DD
 */
function getYesterdayDateStr() {
  const todayStr = todayInInstitutionTzSync();
  const [y, m, d] = todayStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return todayIST(dt);
}

/**
 * Evaluates uninformed absences and monthly frequent absence penalties for a specific target date (§8).
 *
 * @param {string} [targetDateStr] - Date to evaluate in 'YYYY-MM-DD' format (defaults to yesterday)
 * @returns {Promise<object>} Execution statistics
 */
async function runDailyTrustJob(targetDateStr) {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    console.warn('[Daily Trust Job]: MongoDB not connected (readyState=' + (mongoose.connection ? mongoose.connection.readyState : 'none') + '), skipping run.');
    return { ok: false, error: 'Database not connected' };
  }

  const dateStr = targetDateStr || getYesterdayDateStr();
  const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
  const endOfDay = new Date(dateStr + 'T23:59:59.999Z');

  const settingsMap = await getSettings(['trust', 'attendance']);
  const trustSettings = settingsMap?.trust || {};

  if (trustSettings.enabled === false) {
    return { ok: true, skipped: true, reason: 'Trust engine is disabled in settings' };
  }

  // 1. Fetch ClassAttendance documents for target date
  const classAttDocs = await M.ClassAttendance.find({
    date: { $gte: startOfDay, $lte: endOfDay }
  }).lean();

  if (!classAttDocs || classAttDocs.length === 0) {
    return { ok: true, targetDate: dateStr, processedStudents: 0, uninformedAbsences: 0, frequentPenalties: 0 };
  }

  // 2. Aggregate periods held and periods absent per student
  const studentDayMap = new Map();

  for (const ca of classAttDocs) {
    if (!Array.isArray(ca.periods)) continue;
    for (const p of ca.periods) {
      if (!Array.isArray(p.records)) continue;
      for (const r of p.records) {
        if (!r.studentTrackId) continue;
        let entry = studentDayMap.get(r.studentTrackId);
        if (!entry) {
          entry = { totalPeriods: 0, periodsAbsent: 0, classId: ca.classId };
          studentDayMap.set(r.studentTrackId, entry);
        }
        entry.totalPeriods++;
        // Absent without approved reason (od/leave)
        if (r.status === 'AB' && !r.reason) {
          entry.periodsAbsent++;
        }
      }
    }
  }

  let uninformedCount = 0;
  let frequentCount = 0;
  const monthKey = dateStr.substring(0, 7); // 'YYYY-MM'

  // 3. Evaluate each student with full-day absence (R-D3: full day only, partial day does not count)
  for (const [studentTrackId, dayData] of studentDayMap.entries()) {
    if (dayData.totalPeriods === 0 || dayData.periodsAbsent !== dayData.totalPeriods) {
      continue; // Not absent for all held periods
    }

    const student = await M.Student.findOne({ trackId: studentTrackId });
    if (!student) continue;

    // Check if student has Approved or Pending leave/OD covering this date
    const hasLeave = await M.LeaveRequest.exists({
      studentId: student._id,
      dates: dateStr,
      status: { $in: ['Pending', 'Approved'] }
    });

    const hasOD = await M.ODRequest.exists({
      studentId: student._id,
      dates: dateStr,
      status: { $in: ['Pending', 'Approved'] }
    });

    if (hasLeave || hasOD) {
      continue; // Student had informed leave or OD
    }

    // Uninformed full-day absence confirmed! (§8: -4)
    const penalty = trustSettings.uninformedAbsencePenalty || 4;
    const refKey = `UNINFORMED_ABSENCE:${dateStr}`;

    const res = await applyTrustEvent({
      studentId: student._id,
      studentTrackId: student.trackId,
      type: 'UNINFORMED_ABSENCE',
      delta: -penalty,
      refKey,
      refs: { date: dateStr },
      reason: `Uninformed full-day absence on ${dateStr}`,
      actor: 'system'
    });

    if (res.applied) {
      uninformedCount++;
    }

    // 4. Frequent uninformed absences in calendar month (R-D4: -2, once per month if > threshold)
    const threshold = trustSettings.frequentAbsenceThreshold || 6;
    const monthlyUninformedCount = await M.TrustEvent.countDocuments({
      studentId: student._id,
      type: 'UNINFORMED_ABSENCE',
      refKey: { $regex: `^UNINFORMED_ABSENCE:${monthKey}` }
    });

    if (monthlyUninformedCount > threshold) {
      const freqRefKey = `FREQUENT_ABSENCE:${monthKey}`;
      const freqPenalty = trustSettings.frequentAbsencePenalty || 2;

      const freqRes = await applyTrustEvent({
        studentId: student._id,
        studentTrackId: student.trackId,
        type: 'FREQUENT_ABSENCE',
        delta: -freqPenalty,
        refKey: freqRefKey,
        refs: { date: dateStr },
        reason: `Exceeded monthly uninformed absence threshold (>${threshold}) in ${monthKey}`,
        actor: 'system'
      });

      if (freqRes.applied) {
        frequentCount++;
      }
    }
  }

  return {
    ok: true,
    targetDate: dateStr,
    processedStudents: studentDayMap.size,
    uninformedAbsences: uninformedCount,
    frequentPenalties: frequentCount
  };
}

/**
 * Handles automatic reversal of uninformed absence penalties when a leave or OD request is approved (§8).
 *
 * @param {string|mongoose.Types.ObjectId} studentId
 * @param {string[]} dates - Array of 'YYYY-MM-DD' dates approved
 * @returns {Promise<object>} Outcome summary
 */
async function handleLeaveApprovalReversal(studentId, dates = []) {
  if (!studentId || !Array.isArray(dates) || dates.length === 0) {
    return { ok: false, reversedCount: 0 };
  }

  const settingsMap = await getSettings(['trust']);
  const trustSettings = settingsMap?.trust || {};
  const threshold = trustSettings.frequentAbsenceThreshold || 6;

  let reversedCount = 0;
  let frequentReversedCount = 0;
  const affectedMonths = new Set();

  for (const date of dates) {
    if (!date || typeof date !== 'string') continue;
    const targetDateStr = date.trim();
    const penaltyRefKey = `UNINFORMED_ABSENCE:${targetDateStr}`;

    const existingPenalty = await M.TrustEvent.findOne({
      studentId,
      refKey: penaltyRefKey
    }).lean();

    if (!existingPenalty) continue;

    // Check if reversal event already exists
    const reversalRefKey = `LEAVE_APPROVED_REVERSAL:${existingPenalty.eventId}`;
    const alreadyReversed = await M.TrustEvent.exists({
      studentId,
      refKey: reversalRefKey
    });

    if (alreadyReversed) continue;

    // Apply reversal of exact points (§8)
    const revRes = await applyTrustEvent({
      studentId,
      studentTrackId: existingPenalty.studentTrackId,
      type: 'LEAVE_APPROVED_REVERSAL',
      delta: Math.abs(existingPenalty.delta),
      refKey: reversalRefKey,
      refs: {
        date: targetDateStr,
        reversesEventId: existingPenalty.eventId
      },
      reason: `Reversal of uninformed absence penalty for ${targetDateStr} upon approved leave/OD`,
      actor: 'system'
    });

    if (revRes.applied) {
      reversedCount++;
      affectedMonths.add(targetDateStr.substring(0, 7));
    }
  }

  // Check affected months: if net uninformed absences drop back to <= threshold, reverse the monthly -2
  for (const monthKey of affectedMonths) {
    const monthlyPenalties = await M.TrustEvent.countDocuments({
      studentId,
      type: 'UNINFORMED_ABSENCE',
      refKey: { $regex: `^UNINFORMED_ABSENCE:${monthKey}` }
    });

    const monthlyReversals = await M.TrustEvent.countDocuments({
      studentId,
      type: 'LEAVE_APPROVED_REVERSAL',
      'refs.date': { $regex: `^${monthKey}` }
    });

    const netAbsences = monthlyPenalties - monthlyReversals;

    if (netAbsences <= threshold) {
      const freqPenalty = await M.TrustEvent.findOne({
        studentId,
        refKey: `FREQUENT_ABSENCE:${monthKey}`
      }).lean();

      if (freqPenalty) {
        const freqRevKey = `LEAVE_APPROVED_REVERSAL:${freqPenalty.eventId}`;
        const alreadyFreqReversed = await M.TrustEvent.exists({
          studentId,
          refKey: freqRevKey
        });

        if (!alreadyFreqReversed) {
          const freqRevRes = await applyTrustEvent({
            studentId,
            studentTrackId: freqPenalty.studentTrackId,
            type: 'LEAVE_APPROVED_REVERSAL',
            delta: Math.abs(freqPenalty.delta),
            refKey: freqRevKey,
            refs: {
              date: monthKey,
              reversesEventId: freqPenalty.eventId
            },
            reason: `Reversal of frequent absence penalty for ${monthKey} as active count dropped to ${netAbsences}`,
            actor: 'system'
          });

          if (freqRevRes.applied) {
            frequentReversedCount++;
          }
        }
      }
    }
  }

  return {
    ok: true,
    reversedCount,
    frequentReversedCount
  };
}

/**
 * Start 24-hour daily scheduler for trust jobs
 */
function startTrustDailyScheduler() {
  if (_dailySchedulerInterval) clearInterval(_dailySchedulerInterval);
  if (_dailyInitialTimeout) clearTimeout(_dailyInitialTimeout);

  const scheduleInitialSweep = () => {
    // Run initial sweep 3s after DB connection to allow startup seeding to complete cleanly
    _dailyInitialTimeout = setTimeout(() => {
      runDailyTrustJob().catch(e => console.warn('[Initial Trust Daily Job Warn]:', e.message));
    }, 3000);
  };

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    scheduleInitialSweep();
  } else if (mongoose.connection) {
    mongoose.connection.once('connected', scheduleInitialSweep);
  }

  // Run every 24 hours
  _dailySchedulerInterval = setInterval(() => {
    runDailyTrustJob().catch(e => console.warn('[Daily Trust Job Warn]:', e.message));
  }, 24 * 60 * 60 * 1000);

  if (_dailySchedulerInterval.unref) _dailySchedulerInterval.unref();
}

function stopTrustDailyScheduler() {
  if (_dailySchedulerInterval) {
    clearInterval(_dailySchedulerInterval);
    _dailySchedulerInterval = null;
  }
  if (_dailyInitialTimeout) {
    clearTimeout(_dailyInitialTimeout);
    _dailyInitialTimeout = null;
  }
}

module.exports = {
  runDailyTrustJob,
  handleLeaveApprovalReversal,
  startTrustDailyScheduler,
  stopTrustDailyScheduler
};
