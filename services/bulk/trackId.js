/**
 * services/bulk/trackId.js
 *
 * Bulk Import Track ID generator and unique allocator.
 * Produces readable IDs in format: TR-BK{STD|TCH|DEP|CLS|SBJ}-xxxxx
 * Example: TR-BKTCH-7K3QF
 */

const crypto = require('crypto');
const M = require('../../models');

const TYPE_CODE = {
  student: 'STD',
  teacher: 'TCH',
  dept:    'DEP',
  class:   'CLS',
  subject: 'SBJ'
};

// 32 unambiguous characters (no 0, O, 1, I) to prevent reading confusion
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const RE_NEW = /^TR-BK(STD|TCH|DEP|CLS|SBJ)-[A-HJ-NP-Z2-9]{5}$/;
const RE_LEGACY = /^TR-BATCH-[0-9A-Z]{8}$/;

function rand5() {
  let res = '';
  for (let i = 0; i < 5; i++) {
    res += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return res;
}

/**
 * Generate a new track ID for a specific import type
 * @param {string} type - 'student' | 'teacher' | 'dept' | 'class' | 'subject'
 * @returns {string} e.g. 'TR-BKTCH-7K3QF'
 */
function generate(type) {
  const code = TYPE_CODE[type];
  if (!code) {
    throw new Error(`Unknown import type for track ID generation: "${type}"`);
  }
  return `TR-BK${code}-${rand5()}`;
}

/**
 * Atomic helper to create a BulkImportBatch with a guaranteed unique batchTrackId
 * Retries on the rare duplicate key error (code 11000)
 */
async function createWithUniqueTrackId(type, build, maxTries = 5) {
  for (let i = 0; i < maxTries; i++) {
    const trackId = generate(type);
    try {
      const docData = build(trackId);
      return await M.BulkImportBatch.create({
        ...docData,
        batchTrackId: trackId,
        typeCode: TYPE_CODE[type]
      });
    } catch (e) {
      if (e.code === 11000 && /batchTrackId/.test(e.message)) {
        continue;
      }
      throw e;
    }
  }
  throw Object.assign(new Error('Could not allocate a track ID after multiple attempts'), { status: 503 });
}

module.exports = {
  TYPE_CODE,
  ALPHABET,
  RE_NEW,
  RE_LEGACY,
  generate,
  createWithUniqueTrackId
};
