const crypto = require('crypto');
const cfg = require('../config');

const ALGORITHM = 'aes-256-gcm';
// Derive a 32-byte key strictly from LOG_ENCRYPTION_KEY (no fallback)
const KEY = cfg.LOG_ENCRYPTION_KEY ? crypto.createHash('sha256').update(cfg.LOG_ENCRYPTION_KEY).digest() : null;

/**
 * Encrypt a string or JSON object using AES-256-GCM.
 * Output format: ivHex:authTagHex:encryptedHex
 */
function encryptLog(data) {
  if (data === null || data === undefined || data === '') return '';
  if (!KEY) {
    console.error('[logCrypto] Encryption failed: LOG_ENCRYPTION_KEY environment variable is not defined.');
    return typeof data === 'string' ? data : JSON.stringify(data);
  }
  try {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(str, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('[logCrypto] Encryption error:', err.message);
    return typeof data === 'string' ? data : JSON.stringify(data);
  }
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Automatically parses JSON if valid, else returns string.
 */
function decryptLog(cipherText) {
  if (!cipherText || typeof cipherText !== 'string' || !cipherText.includes(':') || !KEY) {
    return cipherText;
  }
  try {
    const parts = cipherText.split(':');
    if (parts.length !== 3) return cipherText;
    const [ivHex, tagHex, encryptedHex] = parts;
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    try {
      return JSON.parse(decrypted);
    } catch {
      return decrypted;
    }
  } catch (err) {
    return cipherText;
  }
}

module.exports = { encryptLog, decryptLog };
