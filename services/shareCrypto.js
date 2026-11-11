/**
 * services/shareCrypto.js
 *
 * Cryptographic URL Code Generation & Slot Integrity Hashing (Phase 5):
 * - Generates 10-character deterministic URL codes using HMAC-SHA-256 + Crockford Base32.
 * - Supports link reset / epoch rotation (incrementing epoch invalidates old URLs instantly).
 * - Generates canonical slot hashes for comments to survive timetable modifications/deploys.
 */

'use strict';

const crypto = require('crypto');

// Crockford Base32 alphabet (excludes I, L, O, U to avoid human transcription confusion)
const CROCKFORD_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/**
 * Encodes a buffer into Crockford Base32 string.
 *
 * @param {Buffer} buffer
 * @returns {String}
 */
function encodeBase32Crockford(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Generates deterministic 10-character URL code for a workspace/draft.
 *
 * @param {String} trackId - e.g. 'TR-WS-0012' or 'WS-2026-000007'
 * @param {Number} epoch - Link rotation epoch (default 0)
 * @param {String} secret - TT_LINK_SECRET from environment
 * @returns {String} Exactly 10 characters (e.g. '4k9m2xq7ab')
 */
function generateLinkCode(trackId, epoch = 0, secret = null) {
  if (!trackId) throw new Error('trackId is required to generate link code');

  const key = secret || process.env.TT_LINK_SECRET || 'eams-default-link-secret';
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(`${String(trackId).trim()}:${Number(epoch || 0)}`);
  const digest = hmac.digest();

  const encoded = encodeBase32Crockford(digest);
  return encoded.slice(0, 10);
}

/**
 * Computes canonical hash of a slot's contents.
 * Used by comments to determine if the slot changed after comment was posted.
 *
 * @param {Object} slot - { subject, subjectId, teacher, teacherId, room, roomId, duration, span, isLab, type }
 * @returns {String} 16-character hex hash
 */
function computeSlotHash(slot) {
  if (!slot || typeof slot !== 'object') return '';

  const s = String(slot.subject || slot.subjectCode || slot.subjectId || '').trim();
  const t = String(slot.teacher || slot.teacherId || '').trim();
  const r = String(slot.room || slot.roomId || '').trim();
  const span = Number(slot.span || slot.duration || 1);
  const isLab = Boolean(slot.isLab || slot.type === 'Lab');

  const content = `${s}|${t}|${r}|${span}|${isLab ? 1 : 0}`;
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

module.exports = {
  generateLinkCode,
  computeSlotHash,
  encodeBase32Crockford,
  CROCKFORD_ALPHABET
};
