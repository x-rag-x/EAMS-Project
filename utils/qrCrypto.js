const crypto = require('crypto');
const cfg = require('../config');

const ALGORITHM = 'aes-256-gcm';
const RAW_KEY = cfg.LOG_ENCRYPTION_KEY || process.env.LOG_ENCRYPTION_KEY;
if (!RAW_KEY) {
  throw new Error('[FATAL] LOG_ENCRYPTION_KEY environment variable must be set. Refusing to start with no log encryption key.');
}
if (cfg.JWT_SECRET && RAW_KEY === cfg.JWT_SECRET) {
  console.warn('[SECURITY WARNING] LOG_ENCRYPTION_KEY is identical to JWT_SECRET. Using separate keys is strongly recommended.');
}
const KEY = crypto.createHash('sha256').update(RAW_KEY).digest();

const DEFAULT_QR_INTERVAL_SEC = 20;
const DEFAULT_GRACE_PERIOD_SEC = 2;

/**
 * Encrypt a text string into a URL-safe format: ivHex.tagHex.encryptedHex
 */
function encryptQrPayload(text) {
  if (!text) return '';
  try {
    const str = String(text);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(str, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}.${authTag}.${encrypted}`;
  } catch (err) {
    console.error('[qrCrypto] Encryption error:', err.message);
    return Buffer.from(text).toString('hex');
  }
}

/**
 * Decrypt a URL-safe format ivHex.tagHex.encryptedHex back to plain text
 */
function decryptQrPayload(cipherText) {
  if (!cipherText || typeof cipherText !== 'string') return '';
  try {
    const parts = cipherText.split('.');
    if (parts.length === 3) {
      const [ivHex, tagHex, encryptedHex] = parts;
      const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }
    // Fallback if plain hex
    return Buffer.from(cipherText, 'hex').toString('utf8');
  } catch (err) {
    return '';
  }
}

/**
 * Deterministically generates a 16-character QR track ID for a specific session + window index
 */
function generateQrTrackId(qrSecret, windowIndex) {
  if (!qrSecret || typeof qrSecret !== 'string') {
    throw new Error('[FATAL] Valid qrSecret must be provided to generate QR track ID.');
  }
  return 'QR_' + crypto.createHmac('sha256', qrSecret)
    .update(`WIN_${windowIndex}`)
    .digest('hex')
    .substring(0, 12)
    .toUpperCase();
}

/**
 * Get current and previous QR window details based on server epoch time
 */
function getQrWindowInfo(qrSecret, intervalSec = DEFAULT_QR_INTERVAL_SEC, graceSec = DEFAULT_GRACE_PERIOD_SEC, serverTime = Date.now()) {
  const intervalMs = intervalSec * 1000;
  const currentWindowIndex = Math.floor(serverTime / intervalMs);
  const windowElapsedMs = serverTime % intervalMs;
  const windowElapsedSec = Number((windowElapsedMs / 1000).toFixed(2));
  const expiresInMs = intervalMs - windowElapsedMs;

  const currentQrTrackId = generateQrTrackId(qrSecret, currentWindowIndex);
  const previousWindowIndex = currentWindowIndex - 1;
  const previousQrTrackId = generateQrTrackId(qrSecret, previousWindowIndex);

  return {
    intervalSec,
    graceSec,
    currentWindowIndex,
    currentQrTrackId,
    previousWindowIndex,
    previousQrTrackId,
    windowElapsedSec,
    expiresInMs,
    serverTime,
  };
}

/**
 * Verify a submitted QR track ID against the active window and 5-second grace window
 */
function verifyQrToken(submittedQrTrackId, qrSecret, intervalSec = DEFAULT_QR_INTERVAL_SEC, graceSec = DEFAULT_GRACE_PERIOD_SEC, serverTime = Date.now()) {
  if (!qrSecret || typeof qrSecret !== 'string') {
    return {
      valid: false,
      type: 'invalid',
      inGracePeriod: false,
      reason: 'Session QR secret is missing or invalid',
      intervalSec,
      graceSec,
      currentWindowIndex: 0,
      currentQrTrackId: '',
      previousWindowIndex: 0,
      previousQrTrackId: '',
      windowElapsedSec: 0,
      expiresInMs: 0,
      serverTime,
    };
  }
  const info = getQrWindowInfo(qrSecret, intervalSec, graceSec, serverTime);

  if (!submittedQrTrackId || typeof submittedQrTrackId !== 'string') {
    return {
      valid: false,
      type: 'invalid',
      reason: 'Missing QR track token',
      ...info
    };
  }

  // 1. Check against active current window
  if (submittedQrTrackId === info.currentQrTrackId) {
    return {
      valid: true,
      type: 'current',
      inGracePeriod: false,
      matchedWindowIndex: info.currentWindowIndex,
      reason: 'Valid active QR token',
      ...info
    };
  }

  // 2. Check against last old window within grace period
  if (submittedQrTrackId === info.previousQrTrackId) {
    if (info.windowElapsedSec <= graceSec) {
      return {
        valid: true,
        type: 'grace',
        inGracePeriod: true,
        matchedWindowIndex: info.previousWindowIndex,
        reason: `Valid within ${info.windowElapsedSec}s grace period`,
        ...info
      };
    } else {
      return {
        valid: false,
        type: 'expired',
        inGracePeriod: false,
        matchedWindowIndex: info.previousWindowIndex,
        reason: `QR token expired (${info.windowElapsedSec}s elapsed into next rotation, grace limit: ${graceSec}s)`,
        ...info
      };
    }
  }

  return {
    valid: false,
    type: 'invalid',
    inGracePeriod: false,
    reason: 'QR token does not match active session rotation schedule',
    ...info
  };
}

function getSidKey() {
  const rawKey = cfg.SID_ENCRYPTION_KEY || process.env.SID_ENCRYPTION_KEY;
  if (!rawKey) throw new Error('[FATAL] SID_ENCRYPTION_KEY environment variable must be set.');
  return crypto.createHash('sha256').update(rawKey).digest();
}

function getQidKey() {
  const rawKey = cfg.QRID_ENCRYPTION_KEY || process.env.QRID_ENCRYPTION_KEY;
  if (!rawKey) throw new Error('[FATAL] QRID_ENCRYPTION_KEY environment variable must be set.');
  return crypto.createHash('sha256').update(rawKey).digest();
}

function encryptWithAesGcm(text, keyBuffer) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  let encrypted = cipher.update(String(text), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `gcm.${iv.toString('hex')}.${tag}.${encrypted}`;
}

function decryptWithAes(cipherText, keyBuffer) {
  if (!cipherText || typeof cipherText !== 'string') return '';
  try {
    const parts = cipherText.split('.');
    if (parts.length === 4 && parts[0] === 'gcm') {
      const [, ivHex, tagHex, encHex] = parts;
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      let decrypted = decipher.update(encHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }
    // Legacy CBC fallback (2 parts: ivHex.encHex)
    if (parts.length === 2) {
      const [ivHex, encHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
      let decrypted = decipher.update(encHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }
    return '';
  } catch (err) {
    return '';
  }
}

function encryptSid(sessionTrackId) {
  return encryptWithAesGcm(sessionTrackId, getSidKey());
}

function decryptSid(encrypted) {
  return decryptWithAes(encrypted, getSidKey());
}

function encryptQid(qrTrackId) {
  return encryptWithAesGcm(qrTrackId, getQidKey());
}

function decryptQid(encrypted) {
  return decryptWithAes(encrypted, getQidKey());
}

function encryptTime(timestamp) {
  return encryptWithAesGcm(String(timestamp), getSidKey());
}

function decryptTime(encrypted) {
  if (!encrypted) return null;
  const dec = decryptWithAes(encrypted, getSidKey());
  if (dec && !isNaN(Number(dec))) return dec;
  return null;
}

module.exports = {
  encryptQrPayload,
  decryptQrPayload,
  generateQrTrackId,
  getQrWindowInfo,
  verifyQrToken,
  DEFAULT_QR_INTERVAL_SEC,
  DEFAULT_GRACE_PERIOD_SEC,
  encryptSid,
  decryptSid,
  encryptQid,
  decryptQid,
  encryptTime,
  decryptTime,
};
