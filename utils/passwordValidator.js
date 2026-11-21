/**
 * Password complexity validation helper (SEC-03, N14)
 * - Maximum 72 bytes (bcrypt truncation boundary)
 * - Username containment rejection
 * - Common weak password dictionary check
 * - 8+ chars, upper, lower, number, special character
 */

'use strict';

const COMMON_WEAK_PASSWORDS = new Set([
  'password',
  'password123',
  'password@123',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'qwertyuiop',
  'admin',
  'admin123',
  'admin@123',
  'student123',
  'student@123',
  'teacher123',
  'teacher@123',
  'eams-admin@123',
  'welcome123',
  'welcome@123',
  'letmein',
  'pass@123',
  'p@ssword',
  'changeme',
  'iloveyou',
  'trustno1',
  'master123',
  'muster-admin@123',
  'muster-student123',
  'muster-teacher123'
]);

/**
 * Validate password against institutional complexity, length, and entropy requirements.
 * 
 * @param {string} password
 * @param {boolean|Object} [requireStrongOrOptions=true]
 * @param {string} [optionalUsername]
 * @returns {{ isValid: boolean, error?: string }}
 */
function validatePassword(password, requireStrongOrOptions = true, optionalUsername = null) {
  if (!password || typeof password !== 'string') {
    return { isValid: false, error: 'Password is required and must be a string.' };
  }

  let requireStrong = true;
  let username = null;

  if (typeof requireStrongOrOptions === 'object' && requireStrongOrOptions !== null) {
    requireStrong = requireStrongOrOptions.requireStrong !== false;
    username = requireStrongOrOptions.username || null;
  } else {
    requireStrong = requireStrongOrOptions !== false;
    username = optionalUsername || null;
  }

  // 1. Enforce maximum 72 bytes (bcrypt truncation boundary - N14)
  const byteLength = Buffer.byteLength(password, 'utf8');
  if (byteLength > 72) {
    return {
      isValid: false,
      error: 'Password cannot exceed 72 bytes (bcrypt maximum limit).'
    };
  }

  // 2. Reject username contained within password (N14)
  if (username && typeof username === 'string') {
    const cleanUser = username.trim().toLowerCase();
    if (cleanUser.length >= 3 && password.toLowerCase().includes(cleanUser)) {
      return {
        isValid: false,
        error: 'Password must not contain the username.'
      };
    }
  }

  // 3. Reject common guessable passwords (N14)
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase().trim())) {
    return {
      isValid: false,
      error: 'Password is too common and easily guessable. Please choose a more secure password.'
    };
  }

  if (!requireStrong) {
    if (password.length < 6) {
      return { isValid: false, error: 'Password must be at least 6 characters.' };
    }
    return { isValid: true };
  }

  const issues = [];
  if (password.length < 8) {
    issues.push('at least 8 characters');
  }
  if (!/[A-Z]/.test(password)) {
    issues.push('at least one uppercase letter (A-Z)');
  }
  if (!/[a-z]/.test(password)) {
    issues.push('at least one lowercase letter (a-z)');
  }
  if (!/[0-9]/.test(password)) {
    issues.push('at least one number (0-9)');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    issues.push('at least one special character (!@#$%^&*...)');
  }

  if (issues.length > 0) {
    return {
      isValid: false,
      error: `Password must contain ${issues.join(', ')}.`
    };
  }

  return { isValid: true };
}

module.exports = {
  validatePassword,
  COMMON_WEAK_PASSWORDS
};
