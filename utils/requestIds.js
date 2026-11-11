const M = require('../models');

/**
 * Generate sequential, human-readable atomic request IDs.
 * Format: <PREFIX>-<YEAR>-<6-DIGIT-SEQUENCE>
 * Example: LV-2026-000124, TR-OD-00001, EVT-2026-000087, FL-2026-000073, SUB-2026-000318
 *
 * @param {'LV'|'OD'|'EVT'|'FL'|'SUB'|'HL'|'GOD'} prefix
 * @param {Date|string} [date]
 * @returns {Promise<string>}
 */
async function getNextRequestId(prefix, date = new Date()) {
  const normPrefix = String(prefix || '').toUpperCase();

  // Special trackId format for On-Duty (OD): TR-OD-00000 (kept unique - same trackid used everywhere)
  if (normPrefix === 'OD' || normPrefix === 'TR-OD') {
    const counterKey = 'TR-OD';
    const counter = await M.Counter.findByIdAndUpdate(
      counterKey,
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true }
    );
    const seqStr = String(counter.seq).padStart(5, '0');
    return `TR-OD-${seqStr}`;
  }

  // Special trackId format for Group OD Invites: TR-GOD-00000
  if (normPrefix === 'GOD' || normPrefix === 'TR-GOD') {
    const counterKey = 'TR-GOD';
    const counter = await M.Counter.findByIdAndUpdate(
      counterKey,
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true }
    );
    const seqStr = String(counter.seq).padStart(5, '0');
    return `TR-GOD-${seqStr}`;
  }

  const d = new Date(date);
  // Get IST calendar year
  const istFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric'
  });
  const year = istFormatter.format(d);
  const counterKey = `${normPrefix}-${year}`;

  const counter = await M.Counter.findByIdAndUpdate(
    counterKey,
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );

  const seqStr = String(counter.seq).padStart(6, '0');
  return `${counterKey}-${seqStr}`;
}

/**
 * Atomic Track ID Generator for Timetable entities (Workspaces, Drafts, Templates).
 * Format: <PREFIX>-<4+ digits>
 * Example: TR-WS-0001, TR-DR-0001, TR-TT-0001
 * Uses non-yearly M.Counter key.
 *
 * @param {string} prefix e.g. 'TR-WS', 'TR-DR', 'TR-TT' or 'WS', 'DR', 'TT'
 * @returns {Promise<string>}
 */
async function getNextTrackId(prefix) {
  let norm = String(prefix || 'TR').trim().toUpperCase();
  if (!norm.startsWith('TR-') && norm !== 'TR') {
    norm = `TR-${norm}`;
  }
  const counterKey = norm;
  const counter = await M.Counter.findByIdAndUpdate(
    counterKey,
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );
  const seqStr = String(counter.seq).padStart(4, '0');
  return `${counterKey}-${seqStr}`;
}

module.exports = {
  getNextRequestId,
  getNextTrackId
};
