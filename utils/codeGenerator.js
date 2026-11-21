/**
 * utils/codeGenerator.js
 * 
 * Cryptographically Secure Code & Identifier Generator (Resolves Checklist S11, S20).
 * Eliminates Math.random() in favor of crypto.randomInt() for all security tokens,
 * attendance passcodes, and system track IDs.
 */

'use strict';

const crypto = require('crypto');

const UNAMBIGUOUS_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ALPHANUMERIC_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Generate a 12-character uppercase alphanumeric code using unambiguous alphabet.
 * Excludes confusing characters (I, O, L, 0, 1).
 * 
 * @returns {string} 12-character code
 */
function generate12CharCode() {
  let code = '';
  const len = UNAMBIGUOUS_CHARS.length;
  for (let i = 0; i < 12; i++) {
    code += UNAMBIGUOUS_CHARS.charAt(crypto.randomInt(0, len));
  }
  return code;
}

/**
 * Generate a cryptographically secure numeric code of given digit length (default 6).
 * 
 * @param {number} [digits=6]
 * @returns {string} numeric string
 */
function generateNumericCode(digits = 6) {
  const d = Math.max(1, Math.min(12, Number(digits) || 6));
  const min = Math.pow(10, d - 1);
  const max = Math.pow(10, d);
  const num = crypto.randomInt(min, max);
  return num.toString();
}

/**
 * Generate a 6-digit verification code.
 * 
 * @returns {string} 6-digit string
 */
function generateVerificationCode() {
  return generateNumericCode(6);
}

/**
 * Generate a cryptographically secure alphanumeric string.
 * 
 * @param {number} [length=8]
 * @param {string} [alphabet=ALPHANUMERIC_CHARS]
 * @returns {string}
 */
function generateAlphanumericCode(length = 8, alphabet = ALPHANUMERIC_CHARS) {
  const len = Math.max(1, Number(length) || 8);
  const alphaLen = alphabet.length;
  let result = '';
  for (let i = 0; i < len; i++) {
    result += alphabet.charAt(crypto.randomInt(0, alphaLen));
  }
  return result;
}

/**
 * Generate a unique track ID with timestamp and cryptographic random suffix.
 * 
 * @param {string} [prefix='TR']
 * @param {number} [suffixLen=6]
 * @returns {string}
 */
function generateTrackId(prefix = 'TR', suffixLen = 6) {
  const suffix = generateAlphanumericCode(suffixLen, UNAMBIGUOUS_CHARS);
  return `${prefix}-${Date.now()}-${suffix}`;
}

/**
 * Generate a Quick Pass session track ID.
 * 
 * @param {string} [prefix='QP']
 * @returns {string}
 */
function generateSessionTrackId(prefix = 'QP') {
  const randPart = generateAlphanumericCode(9, UNAMBIGUOUS_CHARS);
  return `${prefix}_${randPart}`;
}

/**
 * Generate a 12-char live session passcode.
 * 
 * @returns {string}
 */
function generatePasscode() {
  return generate12CharCode();
}

module.exports = {
  generate12CharCode,
  generateNumericCode,
  generateVerificationCode,
  generateAlphanumericCode,
  generateTrackId,
  generateSessionTrackId,
  generatePasscode,
  UNAMBIGUOUS_CHARS,
  ALPHANUMERIC_CHARS
};
