const mongoose = require('mongoose');

function parseIndianTimeString(str) {
  if (!str) return null;
  if (str instanceof Date) return str;
  if (typeof str !== 'string') return new Date(str);

  // String format could be: "26/6/2026, 9:45:49 am" or "27/6/2026, 6:55:55 pm"
  const match = str.match(/^(\d+)\/(\d+)\/(\d+),\s*(\d+):(\d+):(\d+)\s*(am|pm)$/i);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // 0-indexed month
    const year = parseInt(match[3], 10);
    let hour = parseInt(match[4], 10);
    const min = parseInt(match[5], 10);
    const sec = parseInt(match[6], 10);
    const ampm = match[7].toLowerCase();

    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;

    const date = new Date(year, month, day, hour, min, sec);
    if (!isNaN(date.getTime())) return date;
  }

  // Fallback to standard parsing
  const date = new Date(str);
  if (!isNaN(date.getTime())) return date;
  return null;
}

async function migrateDateFields() {
  // Migrations deprecated: All dates are stored as standard Date objects in database
  return;
}

module.exports = { migrateDateFields };
