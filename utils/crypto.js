/**
 * utils/crypto.js
 * 
 * Cryptographic security helpers (Resolves Checklist S11, S20).
 * Provides cryptographically secure random integers, hashing, and safe timing checks.
 */

'use strict';

const crypto = require('crypto');

/**
 * Generates a cryptographically strong random integer in [min, max).
 * 
 * @param {number} min - Inclusive minimum
 * @param {number} max - Exclusive maximum
 * @returns {number}
 */
function randomInt(min, max) {
  if (typeof max === 'undefined') {
    max = min;
    min = 0;
  }
  return crypto.randomInt(min, max);
}

/**
 * Generates secure random buffer of given length.
 * 
 * @param {number} length
 * @returns {Buffer}
 */
function randomBytes(length) {
  return crypto.randomBytes(length);
}

/**
 * Computes SHA-256 digest of input string or buffer.
 * 
 * @param {string|Buffer} data
 * @param {string} [encoding='hex']
 * @returns {string}
 */
function sha256(data, encoding = 'hex') {
  return crypto.createHash('sha256').update(data).digest(encoding);
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 * 
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  randomInt,
  randomBytes,
  sha256,
  safeCompare
};
