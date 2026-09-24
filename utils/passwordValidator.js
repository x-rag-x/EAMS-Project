/**
 * Password complexity validation helper (SEC-03)
 */
function validatePassword(password, requireStrong = true) {
  if (!password || typeof password !== 'string') {
    return { isValid: false, error: 'Password is required and must be a string.' };
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

module.exports = { validatePassword };
