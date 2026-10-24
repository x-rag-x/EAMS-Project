const M = require('../models');

/**
 * Generate sequential, human-readable atomic request IDs.
 * Format: <PREFIX>-<YEAR>-<6-DIGIT-SEQUENCE>
 * Example: LV-2026-000124, OD-2026-000481, EVT-2026-000087, FL-2026-000073, SUB-2026-000318
 *
 * @param {'LV'|'OD'|'EVT'|'FL'|'SUB'|'HL'} prefix
 * @param {Date|string} [date]
 * @returns {Promise<string>}
 */
async function getNextRequestId(prefix, date = new Date()) {
  const d = new Date(date);
  // Get IST calendar year
  const istFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric'
  });
  const year = istFormatter.format(d);
  const counterKey = `${prefix.toUpperCase()}-${year}`;

  const counter = await M.Counter.findByIdAndUpdate(
    counterKey,
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );

  const seqStr = String(counter.seq).padStart(6, '0');
  return `${counterKey}-${seqStr}`;
}

module.exports = {
  getNextRequestId
};
