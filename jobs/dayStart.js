const M = require('../models');

const DAY_MAP = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAY_MAP = {
  Sun: 'Sunday',
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday'
};

/**
 * Extract slots matching a given day from various slot storage formats
 */
function extractSlotsForDay(slotsData, dayName) {
  if (!slotsData || typeof slotsData !== 'object') return [];

  const dayShort = (dayName || '').slice(0, 3).toLowerCase();
  const dayFull = (FULL_DAY_MAP[dayName] || dayName).toLowerCase();

  // If already keyed by day (array or map of periods)
  const direct = slotsData[dayName] || slotsData[FULL_DAY_MAP[dayName]] || slotsData[dayShort] || slotsData[dayFull];
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === 'object') {
    return Object.entries(direct).map(([k, val]) => {
      if (!val || typeof val !== 'object') return val;
      const period = val.period !== undefined ? val.period : parseInt(String(k).replace(/\D/g, ''), 10);
      return { ...val, period: Number(period) };
    }).filter(Boolean);
  }

  // If array of slot objects
  if (Array.isArray(slotsData)) {
    return slotsData.filter(s => {
      const sDay = String(s.day || '').toLowerCase();
      return sDay.startsWith(dayShort) || sDay === dayFull;
    });
  }

  // Key-value map (e.g. { "Mon_1": { ... }, "Monday_P1": { ... } })
  const result = [];
  for (const [key, raw] of Object.entries(slotsData)) {
    if (!raw || typeof raw !== 'object') continue;
    const keyLower = key.toLowerCase();
    const rawDay = String(raw.day || '').toLowerCase();
    if (rawDay.startsWith(dayShort) || rawDay === dayFull || keyLower.startsWith(dayShort) || keyLower.startsWith(dayFull)) {
      let period = raw.period;
      if (period === undefined || period === null) {
        const parts = key.split('_');
        if (parts[1]) period = parseInt(parts[1].replace(/\D/g, ''), 10);
      }
      result.push({ ...raw, period: Number(period) });
    }
  }
  return result;
}

/**
 * Bootstrap ClassSessions for a date from SectionTimetables, Overrides, and Calendar.
 *
 * @param {string} [targetDate] - YYYY-MM-DD IST (defaults to today IST)
 * @returns {Promise<{ created: number, updated: number, skipped: number }>}
 */
async function generateDailyClassSessions(targetDate = null) {
  let dateStr = targetDate;
  if (!dateStr) {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(d);
    dateStr = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
  }

  const dObj = new Date(dateStr + 'T00:00:00.000Z');
  const dayName = DAY_MAP[dObj.getUTCDay()];

  // Sunday has no scheduled classes
  if (dayName === 'Sun') {
    return { created: 0, updated: 0, skipped: 0, reason: 'Sunday' };
  }

  const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
  const endOfDay = new Date(dateStr + 'T23:59:59.999Z');

  // Check if calendar declares a holiday for today
  const CalendarModel = M.CalendarDay || M.AcademicCalendar || M.Calendar;
  const calendarDay = CalendarModel
    ? await CalendarModel.findOne({
        date: { $gte: startOfDay, $lte: endOfDay }
      }).lean()
    : null;

  const isGlobalHoliday = !!(
    calendarDay?.details?.some(d => {
      if (!['leave', 'holiday', 'vacation', 'exam', 'event'].includes(String(d.dayType || '').toLowerCase())) return false;
      return !d.year;
    }) ||
    ['leave', 'holiday', 'vacation', 'exam', 'event'].includes(String(calendarDay?.type || calendarDay?.dayType || '').toLowerCase())
  );

  // Retrieve default timing set to resolve period timings
  const timingSet = M.TimingSet
    ? (await M.TimingSet.findOne({ isDefault: true }).lean() || await M.TimingSet.findOne({}).lean())
    : null;

  const periodTimingMap = new Map();
  if (timingSet && Array.isArray(timingSet.periods)) {
    timingSet.periods.forEach(p => {
      const pNum = p.periodNumber || p.number;
      if (pNum) periodTimingMap.set(Number(pNum), { start: p.start || '09:00', end: p.end || '09:50' });
    });
  }

  // Fallback period timings if not configured in DB
  const defaultTimings = {
    1: { start: '09:00', end: '09:50' },
    2: { start: '09:50', end: '10:40' },
    3: { start: '10:55', end: '11:45' },
    4: { start: '11:45', end: '12:35' },
    5: { start: '13:30', end: '14:20' },
    6: { start: '14:20', end: '15:10' },
    7: { start: '15:20', end: '16:10' }
  };

  const sectionTimetables = M.SectionTimetable ? await M.SectionTimetable.find({}).lean() : [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const st of sectionTimetables) {
    if (!st.classId) continue;
    const classDoc = await M.Class.findById(st.classId).lean();
    if (!classDoc) continue;

    // Check class-level holiday from calendar
    const clsYear = classDoc ? (classDoc.year ? String(classDoc.year).trim().toUpperCase() : '') : '';
    const TO_ROMAN_MAP = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV' };
    const clsYearRoman = TO_ROMAN_MAP[clsYear] || clsYear;

    let isHoliday = isGlobalHoliday;
    if (!isHoliday && calendarDay?.details?.length) {
      const hol = calendarDay.details.find(d => {
        if (!['leave', 'holiday', 'vacation', 'exam', 'event'].includes(String(d.dayType || '').toLowerCase())) return false;
        if (!d.year) return true;
        const dYear = String(d.year).trim().toUpperCase();
        return dYear === clsYear || dYear === clsYearRoman;
      });
      if (hol) isHoliday = true;
    }

    const daySlots = extractSlotsForDay(st.slots, dayName);

    // Overrides for this class and date
    const overrides = M.Override
      ? await M.Override.find({
          classId: st.classId,
          date: { $gte: startOfDay, $lte: endOfDay },
          status: { $ne: 'released' }
        }).lean()
      : [];

    for (let pNum = 1; pNum <= 7; pNum++) {
      const slot = Array.isArray(daySlots)
        ? daySlots.find(s => {
            const pVal = typeof s.period === 'number' ? s.period : parseInt(String(s.period || '').replace(/\D/g, ''), 10);
            return pVal === pNum;
          })
        : (daySlots[pNum] || daySlots[`P${pNum}`]);

      if (!slot) continue;

      const timing = periodTimingMap.get(pNum) || defaultTimings[pNum] || { start: '09:00', end: '09:50' };

      const slotType = slot.isLab ? 'lab' : (slot.slotType || 'theory');
      const teacherTrackId = slot.teacherTrackId || '';
      const teacherName = slot.teacher || '';

      const ov = overrides.find(o => (o.period === pNum || o.periodNumber === pNum));

      let sessionStatus = isHoliday ? 'holiday' : 'scheduled';
      let sessionSource = 'timetable';
      let actualTeacher = {
        trackId: teacherTrackId,
        name: teacherName
      };
      let room = slot.room || '';

      if (ov) {
        if (ov.type === 'cancelled') {
          sessionStatus = 'cancelled';
        } else if (ov.type === 'holiday') {
          sessionStatus = 'holiday';
        } else if (ov.type === 'substitute') {
          sessionSource = 'substitution';
          const sub = ov.substituteTeacher || {};
          actualTeacher = {
            trackId: sub.trackId || ov.substituteTeacherTrackId || '',
            name: sub.name || ov.substituteTeacherName || ''
          };
          if (ov.newSlot?.room) room = ov.newSlot.room;
        } else if (ov.type === 'room_change') {
          room = ov.newSlot?.room || ov.reason || room;
        }
      }

      const sessionData = {
        date: dateStr,
        classId: String(classDoc._id),
        className: classDoc.name || `${classDoc.departmentCode || ''} Year ${classDoc.year || ''}`,
        deptCode: (classDoc.departmentCode || classDoc.deptCode || 'GEN').toUpperCase(),
        year: classDoc.year || 1,
        section: classDoc.section || 'A',
        periodNumber: pNum,
        span: slot.span || 1,
        start: timing.start,
        end: timing.end,
        timingSetId: timingSet ? String(timingSet._id) : null,
        slotType,
        subjectId: slot.subjectId ? String(slot.subjectId) : null,
        subjectName: slot.subject || '',
        room,
        scheduledTeacher: {
          trackId: teacherTrackId,
          name: teacherName
        },
        actualTeacher,
        source: sessionSource,
        status: sessionStatus
      };

      const existing = await M.ClassSession.findOne({
        date: dateStr,
        classId: String(classDoc._id),
        periodNumber: pNum
      });

      if (!existing) {
        await M.ClassSession.create(sessionData);
        created++;
      } else {
        // Do not overwrite completed attendance
        if (!existing.attendance?.savedAt) {
          existing.status = sessionData.status;
          existing.scheduledTeacher = sessionData.scheduledTeacher;
          if (existing.source === 'timetable' || sessionSource === 'substitution') {
            existing.actualTeacher = sessionData.actualTeacher;
            existing.source = sessionData.source;
          }
          existing.room = sessionData.room;
          existing.subjectName = sessionData.subjectName;
          existing.subjectId = sessionData.subjectId;
          existing.slotType = sessionData.slotType;
          await existing.save();
          updated++;
        } else {
          skipped++;
        }
      }
    }
  }

  return { created, updated, skipped, date: dateStr };
}

module.exports = {
  generateDailyClassSessions
};
