/**
 * Formats a Date object or ISO string to the Indian locale timezone string: "DD/MM/YYYY, HH:MM:SS am/pm"
 */
function toIndianTime(val) {
  if (!val) return null;
  const d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return val; // fallback if already formatted or invalid
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

/**
 * Parses an Indian locale formatted string back into a JavaScript Date object.
 * Format: "DD/MM/YYYY, HH:MM:SS am/pm" (or typical variations)
 */
function parseIndianTime(str) {
  if (!str) return new Date();
  if (str instanceof Date) return str;
  if (typeof str !== 'string') {
    const d = new Date(str);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  
  // Try normal parsing first
  let d = new Date(str);
  if (!isNaN(d.getTime())) return d;

  const parts = str.split(', ');
  if (parts.length < 2) {
    return new Date();
  }

  const datePart = parts[0];
  const timePart = parts[1];

  const dmY = datePart.split('/');
  if (dmY.length < 3) {
    return new Date();
  }

  const day = parseInt(dmY[0], 10);
  const month = parseInt(dmY[1], 10);
  const year = parseInt(dmY[2], 10);

  const tAmPm = timePart.split(' ');
  const time = tAmPm[0];
  const ampm = tAmPm[1] || '';

  const hms = time.split(':');
  let hours = parseInt(hms[0], 10);
  const minutes = parseInt(hms[1], 10) || 0;
  const seconds = parseInt(hms[2], 10) || 0;

  if (ampm.toLowerCase() === 'pm' && hours < 12) hours += 12;
  if (ampm.toLowerCase() === 'am' && hours === 12) hours = 0;

  return new Date(year, month - 1, day, hours, minutes, seconds);
}

module.exports = {
  toIndianTime,
  parseIndianTime
};
