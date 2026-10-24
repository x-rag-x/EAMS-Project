const M = require('../models');

/**
 * Resolve attendance entitlements for a class, date, and period.
 * Checks approved and pending AttendanceEntitlement records.
 *
 * @param {Object} params
 * @param {string} params.classId - Target class ID or trackId
 * @param {string} params.date - Date in YYYY-MM-DD (IST)
 * @param {number} [params.periodNumber] - Specific period number (1..N)
 * @returns {Promise<Map<string, Object>>} Map of studentTrackId -> entitlement resolution
 */
async function resolveEntitlements({ classId, date, periodNumber = null }) {
  const query = {
    classId: String(classId),
    date: String(date),
    status: 'active'
  };

  const entitlements = await M.AttendanceEntitlement.find(query).lean();
  const resolutionMap = new Map();

  for (const ent of entitlements) {
    // If periodNumber is provided and entitlement specifies periodNumbers, check match
    if (periodNumber !== null && Array.isArray(ent.periodNumbers) && ent.periodNumbers.length > 0) {
      if (!ent.periodNumbers.includes(Number(periodNumber))) {
        continue;
      }
    }

    const item = {
      studentTrackId: ent.studentTrackId,
      countsAs: ent.countsAs, // 'present' | 'absent'
      reason: ent.reason,     // 'od' | 'leave'
      locked: ent.locked !== false,
      pending: !!ent.pending,
      sourceType: ent.sourceType,
      sourceId: ent.sourceId,
      label: ent.label || ''
    };

    // If there is already an entry, approved takes precedence over pending
    const existing = resolutionMap.get(ent.studentTrackId);
    if (!existing || (!existing.locked && item.locked)) {
      resolutionMap.set(ent.studentTrackId, item);
    }
  }

  return resolutionMap;
}

/**
 * Enforce entitlements on an array of attendance records being saved.
 * Server-side guard: replaces/locks records according to active entitlements.
 *
 * @param {Object} params
 * @param {string} params.classId
 * @param {string} params.date
 * @param {number} params.periodNumber
 * @param {Array<Object>} params.records - Incoming [{ studentTrackId, status }]
 * @param {string} params.actorTrackId
 * @param {string} params.actorRole
 * @returns {Promise<Array<Object>>} Enforced records array
 */
async function enforceAttendancePolicy({ classId, date, periodNumber, records, actorTrackId, actorRole }) {
  const entitlements = await resolveEntitlements({ classId, date, periodNumber });
  const processedRecords = [];

  for (const rec of records) {
    const studentTrackId = rec.studentTrackId;
    const entitlement = entitlements.get(studentTrackId);

    if (entitlement && entitlement.locked) {
      // Locked entitlement overrides student status
      const forcedStatus = entitlement.countsAs === 'present' ? 'P' : 'AB';
      processedRecords.push({
        studentTrackId,
        status: forcedStatus,
        reason: entitlement.reason,
        source: {
          type: entitlement.sourceType,
          id: entitlement.sourceId
        },
        locked: true,
        history: [{
          status: forcedStatus,
          reason: entitlement.reason,
          by: actorTrackId || 'system',
          role: actorRole || 'system',
          at: new Date(),
          note: `Locked by approved ${entitlement.reason.toUpperCase()} (${entitlement.sourceId}): ${entitlement.label || ''}`
        }]
      });
    } else {
      // Normal record
      processedRecords.push({
        studentTrackId,
        status: (rec.status === 'P' || rec.status === 'Present') ? 'P' : 'AB',
        reason: rec.reason || null,
        source: rec.source || null,
        locked: !!rec.locked,
        history: rec.history || []
      });
    }
  }

  return processedRecords;
}

module.exports = {
  resolveEntitlements,
  enforceAttendancePolicy
};
