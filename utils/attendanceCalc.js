/**
 * utils/attendanceCalc.js
 * 
 * Attendance Mathematics & Analytics Utility (Resolves Checklist B33).
 * - 0/0 attended/total returns 0% (never 100%).
 * - Percentages strictly clamped to [0, 100].
 * - Avoids Infinity when calculating classes needed.
 */

'use strict';

/**
 * Calculate attendance percentage rounded to 1 decimal place.
 * Clamped strictly to [0, 100].
 * 0/0 attended/total returns 0 (not 100).
 * 
 * @param {number} present
 * @param {number} total
 * @returns {number} Percentage between 0 and 100
 */
function calculateAttendancePct(present, total) {
  const p = Number(present);
  const t = Number(total);

  if (isNaN(t) || t <= 0) {
    return 0;
  }
  if (isNaN(p) || p <= 0) {
    return 0;
  }

  const rawPct = (p / t) * 100;
  // Strict clamping between 0 and 100
  const clamped = Math.min(100, Math.max(0, rawPct));
  return Math.round(clamped * 10) / 10;
}

/**
 * Determine defaulter band based on percentage and condonation boundaries.
 * Default condonation band: [65, 75]
 * 
 * @param {number} pct - Attendance percentage (0..100)
 * @param {[number, number]} [condonationBand=[65, 75]]
 * @returns {'good' | 'condonation' | 'critical'}
 */
function calculateDefaulterBand(pct, condonationBand = [65, 75]) {
  const [lower, upper] = Array.isArray(condonationBand) && condonationBand.length === 2
    ? condonationBand
    : [65, 75];

  const val = Number(pct) || 0;
  if (val >= upper) return 'good';
  if (val >= lower && val < upper) return 'condonation';
  return 'critical';
}

/**
 * Calculate classes needed to achieve or maintain target attendance percentage.
 * Avoids Infinity when target >= 100% or remaining is 0.
 * Clamps all percentages to [0, 100].
 * 
 * @param {Object|number} paramsOrPresent
 * @param {number} [optTotal]
 * @param {number} [optTarget=75]
 * @param {number} [optRemaining=30]
 * @returns {Object} { canReach, classesNeeded, canMiss, message, currentPct, projectionPct, band }
 */
function calculateClassesNeeded(paramsOrPresent = {}, optTotal, optTarget = 75, optRemaining = 30) {
  let currentPresent = 0;
  let currentTotal = 0;
  let targetPct = 75;
  let remainingClasses = 30;

  if (typeof paramsOrPresent === 'object' && paramsOrPresent !== null) {
    currentPresent = paramsOrPresent.currentPresent ?? paramsOrPresent.present ?? 0;
    currentTotal = paramsOrPresent.currentTotal ?? paramsOrPresent.total ?? 0;
    targetPct = paramsOrPresent.targetPct ?? 75;
    remainingClasses = paramsOrPresent.remainingClasses ?? 30;
  } else {
    currentPresent = paramsOrPresent || 0;
    currentTotal = optTotal || 0;
    targetPct = optTarget ?? 75;
    remainingClasses = optRemaining ?? 30;
  }

  const P = Math.max(0, Number(currentPresent) || 0);
  const T = Math.max(0, Number(currentTotal) || 0);
  const clampedTargetPct = Math.min(100, Math.max(1, Number(targetPct) || 75));
  const target = clampedTargetPct / 100;
  const rem = Math.max(0, Number(remainingClasses) || 0);

  const currentPct = calculateAttendancePct(P, T);
  const band = calculateDefaulterBand(currentPct);

  // If no classes conducted yet, return clean 0% base with projection based on target
  if (T === 0) {
    const canMiss = Math.floor(rem * (1 - target));
    const classesNeeded = Math.ceil(rem * target);
    return {
      canReach: true,
      classesNeeded: classesNeeded,
      canMiss: Math.max(0, canMiss),
      message: `No classes conducted yet. 0% attendance.`,
      currentPct: 0,
      projectionPct: rem > 0 ? calculateAttendancePct(rem, rem) : 0,
      band: calculateDefaulterBand(0)
    };
  }

  if (currentPct < clampedTargetPct) {
    // Below target -> Need additional attended classes
    let classesNeeded = 0;
    let canReach = false;

    if (clampedTargetPct >= 100) {
      // Reaching 100% when P < T is impossible unless P === T
      canReach = (P === T && rem >= 0);
      classesNeeded = canReach ? 0 : (rem + 1); // Finite number, avoid Infinity
    } else {
      const denominator = 1 - target;
      if (denominator <= 0) {
        classesNeeded = rem + 1;
        canReach = false;
      } else {
        const numerator = target * T - P;
        const x = Math.ceil(numerator / denominator);
        classesNeeded = Math.max(0, x);
        canReach = classesNeeded <= rem;
      }
    }

    // Ensure classesNeeded is never Infinity
    if (!Number.isFinite(classesNeeded)) {
      classesNeeded = rem + 1;
    }

    const projectionPct = rem > 0
      ? calculateAttendancePct(P + Math.min(classesNeeded, rem), T + rem)
      : currentPct;

    const maxAttainable = calculateAttendancePct(P + rem, T + rem);
    const message = canReach
      ? `Needs to attend ${classesNeeded} of the next ${rem} classes to reach ${clampedTargetPct}%.`
      : `Cannot reach ${clampedTargetPct}% even with 100% attendance in remaining ${rem} classes (Max attainable: ${maxAttainable}%).`;

    return {
      canReach,
      classesNeeded,
      canMiss: 0,
      message,
      currentPct,
      projectionPct,
      band
    };
  } else {
    // At or above target -> Can safely miss classes
    const numerator = P - target * T;
    const y = target > 0 ? Math.floor(numerator / target) : 0;
    const canMiss = Math.max(0, Number.isFinite(y) ? y : 0);

    const message = canMiss > 0
      ? `Can miss ${canMiss} class${canMiss > 1 ? 'es' : ''} and remain above ${clampedTargetPct}%.`
      : `On the boundary of ${clampedTargetPct}%. Cannot miss any classes without dropping below threshold.`;

    return {
      canReach: true,
      classesNeeded: 0,
      canMiss,
      message,
      currentPct,
      projectionPct: currentPct,
      band
    };
  }
}

module.exports = {
  calculateAttendancePct,
  calculateDefaulterBand,
  calculateClassesNeeded
};
