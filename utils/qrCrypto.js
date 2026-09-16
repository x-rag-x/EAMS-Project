const crypto = require('crypto');
const cfg = require('../config');

const ALGORITHM = 'aes-256-gcm';
const RAW_KEY = cfg.LOG_ENCRYPTION_KEY || cfg.JWT_SECRET || 'eams_fallback_default_encryption_key_32_bytes!';
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
  const secret = qrSecret || 'eams_default_qr_secret';
  return 'QR_' + crypto.createHmac('sha256', secret)
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
  const rawKey = cfg.SID_ENCRYPTION_KEY || process.env.SID_ENCRYPTION_KEY || '8450edd18faa5e99f951388830b248f1';
  return crypto.createHash('sha256').update(rawKey).digest();
}

function getQidKey() {
  const rawKey = cfg.QRID_ENCRYPTION_KEY || process.env.QRID_ENCRYPTION_KEY || '796c4a131b72bc524a0926a89cd1c909';
  return crypto.createHash('sha256').update(rawKey).digest();
}

function encryptWithAesCbc(text, keyBuffer) {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
  let encrypted = cipher.update(String(text), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}.${encrypted}`;
}

function decryptWithAesCbc(cipherText, keyBuffer) {
  if (!cipherText || typeof cipherText !== 'string') return '';
  try {
    const parts = cipherText.split('.');
    if (parts.length !== 2) {
      return cipherText;
    }
    const [ivHex, encHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
    let decrypted = decipher.update(encHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return cipherText;
  }
}

function encryptSid(sessionTrackId) {
  return encryptWithAesCbc(sessionTrackId, getSidKey());
}

function decryptSid(encrypted) {
  return decryptWithAesCbc(encrypted, getSidKey());
}

function encryptQid(qrTrackId) {
  return encryptWithAesCbc(qrTrackId, getQidKey());
}

function decryptQid(encrypted) {
  return decryptWithAesCbc(encrypted, getQidKey());
}

function encryptTime(timestamp) {
  return encryptWithAesCbc(String(timestamp), getSidKey());
}

function decryptTime(encrypted) {
  if (!encrypted) return null;
  const dec = decryptWithAesCbc(encrypted, getSidKey());
  if (dec && dec !== encrypted) return dec;
  try {
    const b64 = Buffer.from(encrypted, 'base64').toString('utf8');
    if (b64 && !isNaN(Number(b64))) return b64;
  } catch (e) {}
  return encrypted;
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
