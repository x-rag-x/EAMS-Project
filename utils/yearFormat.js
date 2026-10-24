/**
 * Year Range and Batch Formatting Utility
 * Enforces YYYY-YYYY format across all academic years and batches.
 */

/**
 * Normalizes any year range string to standard "YYYY-YYYY" format.
 * Examples:
 *   "2025-29"   -> "2025-2029"
 *   "2025-2029" -> "2025-2029"
 *   "2025-26"   -> "2025-2026"
 *   "2025-2026" -> "2025-2026"
 *   "2025/2029" -> "2025-2029"
 *   " 2025 - 29 " -> "2025-2029"
 * If input is null, undefined, or empty, returns empty string.
 * If input cannot be parsed as a year range, returns trimmed original.
 */
function normalizeYearRange(val) {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (!str) return '';

  const m = str.match(/^(\d{4})\s*[\-\/]\s*(\d{2,4})$/);
  if (!m) return str;

  const startYear = parseInt(m[1], 10);
  const endPart = m[2];

  if (endPart.length === 2) {
    const endShort = parseInt(endPart, 10);
    const startCentury = Math.floor(startYear / 100) * 100;
    let endFull = startCentury + endShort;
    if (endFull < startYear) endFull += 100;
    return `${startYear}-${endFull}`;
  }

  if (endPart.length === 4) {
    return `${startYear}-${endPart}`;
  }

  return str;
}

/**
 * Validates if a string is strictly in "YYYY-YYYY" format.
 */
function isValidYearRange(val) {
  if (!val) return false;
  return /^\d{4}-\d{4}$/.test(String(val).trim());
}

/**
 * Computes standard batch track ID from a year range (e.g. "2025-2029" -> "TR-BATCH-2529").
 */
function toBatchTrackId(batchVal) {
  const norm = normalizeYearRange(batchVal);
  const m = norm.match(/^(\d{4})-(\d{4})$/);
  if (m) {
    return `TR-BATCH-${m[1].slice(-2)}${m[2].slice(-2)}`;
  }
  return '';
}

/**
 * Computes canonical student Track ID in format TR{YearCode}{TwoLetterDeptCode}{RollNo}.
 * Example:
 *   714025104208 with CSE department -> "TR25CS208"
 *
 * Register No decomposition (e.g. 714025104208):
 *   7140 = Institution code
 *   25   = Admission Year (2025 -> 25)
 *   104  = 3-digit Department number (e.g. 104 is CSE)
 *   208  = 3-digit Roll / Serial number
 */
function buildStudentTrackId(regNo, deptDocOrName, batchVal, acadYearVal, allDepts = []) {
  const reg = String(regNo || '').replace(/\D/g, '');
  let yearCode = '';
  let deptNum = '';
  let roll = '';

  if (reg.length >= 12) {
    yearCode = reg.substring(4, 6);
    deptNum = reg.substring(6, 9);
    roll = reg.substring(9, 12);
  } else {
    const bParts = String(batchVal || acadYearVal || '').split('-')[0].trim();
    yearCode = bParts ? bParts.slice(-2) : String(new Date().getFullYear()).slice(-2);
    roll = reg.slice(-3);
  }

  let dept = null;
  if (deptDocOrName && typeof deptDocOrName === 'object') {
    dept = deptDocOrName;
  } else if (deptDocOrName && Array.isArray(allDepts)) {
    const search = String(deptDocOrName).toLowerCase().trim();
    dept = allDepts.find(d =>
      (d._id && String(d._id) === String(deptDocOrName)) ||
      (d.name && d.name.toLowerCase() === search) ||
      (d.code && d.code.toLowerCase() === search)
    );
  }

  if (!dept && deptNum && Array.isArray(allDepts)) {
    dept = allDepts.find(d => d.number === deptNum);
  }

  let twoCode = (dept?.twoLetterCode || (dept?.code ? dept.code.slice(0, 2) : '')).toUpperCase();
  if (!twoCode && deptNum && Array.isArray(allDepts)) {
    const dByNum = allDepts.find(d => d.number === deptNum);
    if (dByNum) {
      twoCode = (dByNum.twoLetterCode || (dByNum.code ? dByNum.code.slice(0, 2) : '')).toUpperCase();
    }
  }

  if (!twoCode) {
    if (typeof deptDocOrName === 'string' && deptDocOrName.trim()) {
      twoCode = deptDocOrName.trim().slice(0, 2).toUpperCase();
    } else {
      twoCode = 'ST';
    }
  }

  if (yearCode && roll) {
    return 'TR' + yearCode + twoCode + String(roll).padStart(3, '0').slice(-3);
  }

  return reg ? ('TRSTU' + reg.slice(-6)) : ('TRSTU' + Date.now().toString().slice(-6));
}

module.exports = {
  normalizeYearRange,
  isValidYearRange,
  toBatchTrackId,
  buildStudentTrackId
};
