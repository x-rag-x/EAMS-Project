/**
 * utils/backupCrypto.js
 *
 * Enterprise-grade authenticated encryption for EAMS backup archives.
 * Uses AES-256-GCM with PBKDF2 key derivation and random salts/IVs.
 * Only the EAMS website/server can decrypt and unpack these archives.
 */

const crypto = require('crypto');

function getMasterKey() {
  const key =
    process.env.BACKUP_ENCRYPTION_KEY ||
    process.env.FIELD_ENCRYPTION_KEY ||
    process.env.JWT_SECRET;

  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new Error(
      'Backup encryption key is not configured. BACKUP_ENCRYPTION_KEY (or FIELD_ENCRYPTION_KEY / JWT_SECRET) must be set in the environment. Hardcoded key fallback is disabled.'
    );
  }

  return key.trim();
}

/**
 * Encrypts arbitrary JSON-serializable data using AES-256-GCM.
 *
 * @param {Object} dataObj - The raw data payload to encrypt
 * @param {string} [backupPassword=''] - Optional supplementary password
 * @returns {{ salt: string, iv: string, authTag: string, ciphertext: Buffer }}
 */
function encryptBackupPayload(dataObj, backupPassword = '') {
  const masterKey = getMasterKey();
  const salt = crypto.randomBytes(16);
  // Derive 32-byte (256-bit) encryption key using 100,000 PBKDF2 iterations
  const key = crypto.pbkdf2Sync(
    masterKey + (backupPassword ? String(backupPassword).trim() : ''),
    salt,
    100000,
    32,
    'sha256'
  );

  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const jsonBuffer = Buffer.from(JSON.stringify(dataObj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(jsonBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext
  };
}

/**
 * Decrypts and authenticates AES-256-GCM backup payload.
 *
 * @param {Object} encObj
 * @param {string} encObj.salt - Hex string
 * @param {string} encObj.iv - Hex string
 * @param {string} encObj.authTag - Hex string
 * @param {Buffer|string} encObj.ciphertext - Buffer or hex string
 * @param {string} [backupPassword=''] - Optional supplementary password
 * @returns {Object} - Decrypted JavaScript object
 */
function decryptBackupPayload({ salt, iv, authTag, ciphertext }, backupPassword = '') {
  if (!salt || !iv || !authTag || !ciphertext) {
    throw new Error('Incomplete encryption envelope: missing salt, iv, authTag, or ciphertext');
  }

  const masterKey = getMasterKey();
  const saltBuf = Buffer.from(salt, 'hex');
  const ivBuf = Buffer.from(iv, 'hex');
  const authTagBuf = Buffer.from(authTag, 'hex');
  const cipherBuf = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext, 'hex');

  // Attempt decryption with supplied password
  const attemptDecrypt = (pwd) => {
    const key = crypto.pbkdf2Sync(
      masterKey + (pwd ? String(pwd).trim() : ''),
      saltBuf,
      100000,
      32,
      'sha256'
    );
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf);
    decipher.setAuthTag(authTagBuf);
    const decrypted = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  };

  try {
    return attemptDecrypt(backupPassword);
  } catch (err) {
    // If a password was provided, re-try once without password in case password was omitted at creation
    if (backupPassword) {
      try {
        return attemptDecrypt('');
      } catch (innerErr) {
        // Fall through to original error
      }
    }
    throw new Error('Decryption failed: Invalid password, tampered backup file, or unauthorized archive.');
  }
}

module.exports = {
  encryptBackupPayload,
  decryptBackupPayload
};
