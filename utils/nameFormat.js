/**
 * Sanitizes full name by removing dots, commas, slashes, backslashes,
 * colons, semicolons, and underscores, normalizing whitespace.
 * Ensures the full name NEVER contains '.', ',', '/', or '\'.
 *
 * @param {string} raw - Raw input name
 * @returns {string} Sanitized full name (e.g. "AADHIL YUNIS.U" -> "AADHIL YUNIS U")
 */
function sanitizeFullName(raw) {
  if (!raw) return '';
  return String(raw)
    // Replace dots, commas, slashes, backslashes, semicolons, colons, underscores with space
    .replace(/[.,\/\\;:_]+/g, ' ')
    // Remove any remaining unwanted characters except letters, numbers, spaces, hyphens, and apostrophes
    .replace(/[^A-Za-z0-9\s'-]/g, '')
    // Collapse multiple whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Correctly splits full name into First Name and Last Name.
 * Handles single names, standard names, single initials, and multi-letter initials
 * whether positioned at the end or the beginning.
 *
 * @param {string} rawName - Full name string
 * @returns {{ firstName: string, lastName: string, fullName: string }}
 */
function splitFirstLastName(rawName) {
  const clean = sanitizeFullName(rawName);
  const parts = clean.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { firstName: '', lastName: '', fullName: '' };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '', fullName: parts[0] };
  }
  if (parts.length === 2) {
    const firstIsInit = /^[A-Za-z]{1,2}$/.test(parts[0]);
    const lastIsInit = /^[A-Za-z]{1,2}$/.test(parts[1]);
    if (firstIsInit && !lastIsInit) {
      // e.g. "M SATHISH" -> First: "SATHISH", Last: "M"
      return { firstName: parts[1], lastName: parts[0], fullName: clean };
    }
    // e.g. "SATHISH M" or "AADHIL YUNIS"
    return { firstName: parts[0], lastName: parts[1], fullName: clean };
  }

  // 3 or more parts (e.g. "AADHIL YUNIS U", "MOHAMED RIYAZ K A", "U AADHIL YUNIS", "JOHN FITZGERALD KENNEDY")
  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  const first = parts[0];

  const lastTwoInitials = /^[A-Za-z]{1,2}$/.test(last) && /^[A-Za-z]{1,2}$/.test(secondLast);
  const lastIsInitial = /^[A-Za-z]{1,2}$/.test(last);
  const firstIsInitial = /^[A-Za-z]{1,2}$/.test(first);

  if (lastTwoInitials) {
    // e.g. "MOHAMED RIYAZ K A" -> First: "MOHAMED RIYAZ", Last: "K A"
    return {
      firstName: parts.slice(0, -2).join(' '),
      lastName: parts.slice(-2).join(' '),
      fullName: clean
    };
  }

  if (lastIsInitial) {
    // e.g. "AADHIL YUNIS U" -> First: "AADHIL YUNIS", Last: "U"
    return {
      firstName: parts.slice(0, -1).join(' '),
      lastName: last,
      fullName: clean
    };
  }

  if (firstIsInitial) {
    // e.g. "U AADHIL YUNIS" -> First: "AADHIL YUNIS", Last: "U"
    return {
      firstName: parts.slice(1).join(' '),
      lastName: first,
      fullName: clean
    };
  }

  // Fallback for multi-word full names without trailing/leading single-letter initials
  // (e.g. "SARAVANAN KUMAR RAJAN" -> First: "SARAVANAN KUMAR", Last: "RAJAN")
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: last,
    fullName: clean
  };
}

module.exports = {
  sanitizeFullName,
  splitFirstLastName
};
