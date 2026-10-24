/**
 * Attendance Mathematics & Analytics Utility
 * Provides calculations for percentages, condonation bands, and classes-needed projections.
 */

/**
 * Calculate attendance percentage rounded to 1 decimal place.
 * 
 * @param {number} present 
 * @param {number} total 
 * @returns {number} Percentage between 0 and 100
 */
function calculateAttendancePct(present, total) {
  const p = Number(present) || 0;
  const t = Number(total) || 0;
  if (t <= 0) return 100;
  const pct = (p / t) * 100;
  return Math.round(pct * 10) / 10;
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
  const [lower, upper] = condonationBand;
  if (pct >= upper) return 'good';
  if (pct >= lower && pct < upper) return 'condonation';
  return 'critical';
}

/**
 * Calculate classes needed to achieve or maintain target attendance percentage.
 * 
 * Math:
 * If below target:
 *   (present + x) / (total + x) >= target
 *   present + x >= target * total + target * x
 *   x * (1 - target) >= target * total - present
 *   x = ceil((target * total - present) / (1 - target))
 * 
 * If above target:
 *   present / (total + y) >= target
 *   present >= target * total + target * y
 *   target * y <= present - target * total
 *   y = floor((present - target * total) / target)
 * 
 * @param {Object} params
 * @param {number} params.currentPresent
 * @param {number} params.currentTotal
 * @param {number} [params.targetPct=75] - Target percentage (e.g. 75)
 * @param {number} [params.remainingClasses=30] - Estimated or scheduled remaining classes
 * @returns {Object} { canReach, classesNeeded, canMiss, message, currentPct, projectionPct }
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

  const P = Math.max(Number(currentPresent) || 0, 0);
  const T = Math.max(Number(currentTotal) || 0, 0);
  const target = targetPct / 100;
  const rem = Math.max(Number(remainingClasses) || 0, 0);

  const currentPct = calculateAttendancePct(P, T);
  const band = calculateDefaulterBand(currentPct);

  // If no classes held yet, 100% standing
  if (T === 0) {
    return {
      canReach: true,
      classesNeeded: 0,
      canMiss: Math.floor(rem * (1 - target)),
      message: `No classes conducted yet. Perfect standing.`,
      currentPct: 100,
      projectionPct: 100,
      band: 'good'
    };
  }

  if (currentPct < targetPct) {
    // Below target -> Need additional attended classes
    const numerator = target * T - P;
    const denominator = 1 - target;
    const x = Math.ceil(numerator / denominator);
    const classesNeeded = Math.max(x, 0);

    const canReach = classesNeeded <= rem;
    const projectionPct = rem > 0 
      ? calculateAttendancePct(P + Math.min(classesNeeded, rem), T + rem) 
      : currentPct;

    const message = canReach
      ? `Needs to attend ${classesNeeded} of the next ${rem} classes to reach ${targetPct}%.`
      : `Cannot reach ${targetPct}% even with 100% attendance in remaining ${rem} classes (Max attainable: ${calculateAttendancePct(P + rem, T + rem)}%).`;

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
    const y = Math.floor(numerator / target);
    const canMiss = Math.max(y, 0);

    const message = canMiss > 0
      ? `Can miss ${canMiss} class${canMiss > 1 ? 'es' : ''} and remain above ${targetPct}%.`
      : `On the boundary of ${targetPct}%. Cannot miss any classes without dropping below threshold.`;

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
