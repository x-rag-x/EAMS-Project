/**
 * EAMS Institution Time Utilities
 * Centralized timezone-aware time/date helpers for the institution's configured timezone.
 * Replaces ad-hoc Date usage with consistent IST (Asia/Kolkata) defaults, configurable via settings.
 */

const M = require('../models');

let cachedTimezone = null;
let cacheExpiresAt = 0;

/**
 * Get the institution's configured timezone.
 * Reads from Settings (cached for 60s), defaults to 'Asia/Kolkata'.
 * @returns {Promise<string>} IANA timezone identifier (e.g., 'Asia/Kolkata')
 */
async function getInstitutionTimezone() {
  const now = Date.now();
  if (cachedTimezone && now < cacheExpiresAt) {
    return cachedTimezone;
  }

  try {
    const settings = await M.Settings.findOne({ key: 'institution.timezone' }).lean();
    if (settings && settings.value) {
      cachedTimezone = String(settings.value).trim();
    } else {
      cachedTimezone = 'Asia/Kolkata';
    }
  } catch (err) {
    cachedTimezone = 'Asia/Kolkata';
  }
  cacheExpiresAt = now + 60000; // 60 second cache
  return cachedTimezone;
}

/**
 * Invalidate the timezone cache (call on settings change).
 */
function invalidateTimezoneCache() {
  cachedTimezone = null;
  cacheExpiresAt = 0;
}

/**
 * Get date/time parts in the institution's timezone for a given date (defaults to now).
 * @param {Date|string|number} [inputDate]
 * @returns {Promise<{dateStr: string, day: string, hhmm: string, iso: string, epoch: number}>}
 */
async function nowParts(inputDate = new Date()) {
  const tz = await getInstitutionTimezone();
  const now = inputDate instanceof Date ? inputDate : new Date(inputDate);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = fmt.formatToParts(now);
  const get = (type) => parts.find(p => p.type === type)?.value || '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const dateStr = `${year}-${month}-${day}`;
  const hhmm = `${hour}:${minute}`;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayIndex = new Date(`${year}-${month}-${day}T00:00:00`).getDay();
  const dayName = dayNames[dayIndex];
  return { dateStr, day: dayName, hhmm, iso: now.toISOString(), epoch: now.getTime() };
}

/**
 * Get "today" date string (YYYY-MM-DD) in institution timezone.
 * Use this instead of `new Date().toISOString().split('T')[0]` which uses UTC.
 * @returns {Promise<string>}
 */
async function todayInInstitutionTz() {
  const { dateStr } = await nowParts();
  return dateStr;
}

/**
 * Synchronous helper to get "today" (YYYY-MM-DD) or format any date in institution timezone.
 * Defaults to Asia/Kolkata (IST) or cached timezone.
 * @param {Date|string|number} [date] - Optional date to format in IST (defaults to now)
 * @returns {string} 'YYYY-MM-DD'
 */
function todayInInstitutionTzSync(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const tz = cachedTimezone || 'Asia/Kolkata';
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return fmt.format(d);
}

const todayIST = todayInInstitutionTzSync;
const getInstitutionDateSync = todayInInstitutionTzSync;

/**
 * Get UTC day bounds for a given institution-date string (YYYY-MM-DD).
 * Returns start/end as Date objects in UTC for MongoDB queries.
 * @param {string} dateStr - 'YYYY-MM-DD' in institution timezone
 * @returns {Promise<{start: Date, end: Date}>}
 */
async function getUtcDayBounds(dateStr) {
  const tz = await getInstitutionTimezone();
  const [year, month, day] = dateStr.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  return { start, end };
}

/**
 * Get current UTC day bounds (for "today" in institution timezone).
 * @returns {Promise<{start: Date, end: Date}>}
 */
async function getTodayUtcBounds() {
  const today = await todayInInstitutionTz();
  return getUtcDayBounds(today);
}

/**
 * Parse a time string (HH:MM) in institution timezone to a Date at today's date.
 * @param {string} hhmm - 'HH:MM' 24-hour format
 * @returns {Promise<Date>}
 */
async function parseTimeInInstitutionTz(hhmm) {
  const tz = await getInstitutionTimezone();
  const [hour, minute] = String(hhmm).split(':').map(Number);
  const today = await todayInInstitutionTz();
  const [year, month, day] = today.split('-').map(Number);
  // Create a date in the institution timezone at the given time
  const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  // Adjust for timezone offset to get correct UTC time
  // We use Intl to compute the offset
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });
  const parts = fmt.formatToParts(dt);
  // This is a workaround; better approach:
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const checkParts = formatter.formatToParts(dt);
  // Just use the local date construction approach
  return new Date(`${year}-${month.toString().padStart(2,'0')}-${day.toString().padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00`);
}

/**
 * Check if current institution time is within a time range.
 * @param {string} start - 'HH:MM'
 * @param {string} end - 'HH:MM'
 * @returns {Promise<boolean>}
 */
async function isTimeBetween(start, end) {
  const { hhmm } = await nowParts();
  return hhmm >= start && hhmm <= end;
}

/**
 * Get the current period number from a timing set periods array.
 * @param {Array} periods - TimingSet.periods array
 * @returns {Promise<{period: object|null, scheduleStatus: string}>}
 */
async function getCurrentPeriod(periods) {
  const { hhmm } = await nowParts();
  let currentPeriod = null;
  let scheduleStatus = 'free';

  const firstSlot = periods.find(p => !p.isBreak && p.start);
  const lastSlot = [...periods].reverse().find(p => !p.isBreak && p.end);

  if (firstSlot && hhmm < firstSlot.start) {
    scheduleStatus = 'pre_class';
    currentPeriod = firstSlot;
  } else if (lastSlot && hhmm > lastSlot.end) {
    scheduleStatus = 'day_ended';
  } else {
    for (const p of periods) {
      if (hhmm >= p.start && hhmm <= p.end) {
        currentPeriod = p;
        scheduleStatus = p.isBreak ? 'break' : 'in_class';
        break;
      }
    }
  }
  return { period: currentPeriod, scheduleStatus };
}

/**
 * Exact start of day (00:00:00) in institution timezone returned as UTC Date object.
 * For IST (UTC+05:30), start of 2026-10-22 is 2026-10-21T18:30:00.000Z.
 * @param {string} [dateStr] - YYYY-MM-DD
 * @returns {Promise<Date>}
 */
async function getStartOfInstitutionDay(dateStr) {
  const dStr = dateStr || await todayInInstitutionTz();
  const [y, m, d] = dStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - (330 * 60 * 1000));
}

function getStartOfInstitutionDaySync(dateStr) {
  const dStr = dateStr || todayInInstitutionTzSync();
  const [y, m, d] = dStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - (330 * 60 * 1000));
}

function getEndOfInstitutionDaySync(dateStr) {
  const dStr = dateStr || todayInInstitutionTzSync();
  const [y, m, d] = dStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - (330 * 60 * 1000));
}

module.exports = {
  getInstitutionTimezone,
  invalidateTimezoneCache,
  nowParts,
  todayInInstitutionTz,
  todayInInstitutionTzSync,
  todayIST,
  getInstitutionDateSync,
  getUtcDayBounds,
  getTodayUtcBounds,
  getStartOfInstitutionDay,
  getStartOfInstitutionDaySync,
  getEndOfInstitutionDaySync,
  parseTimeInInstitutionTz,
  isTimeBetween,
  getCurrentPeriod
};