/**
 * utils/teacherSchedule.js
 *
 * Core timetable resolver service for Teacher Portal (Phase 2):
 * - Aggregates SectionTimetable production slots into canonical teacher weekly schedules
 * - Overlays CalendarDay (holidays, half-days per class year)
 * - Overlays TeacherLeaveRequest (approved leaves, FN/AN half-days)
 * - Overlays Override (substitutions, cancellations, room changes)
 * - Overlays ClassAttendance (marked, finalized)
 * - Maintains 60-second in-memory cache for production timetable sections and timing sets
 */

const M = require('../models');

const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TO_ROMAN = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV' };
const FROM_ROMAN = { 'i': 1, 'ii': 2, 'iii': 3, 'iv': 4 };

// ── In-Memory Cache (60s TTL) ──
let _prodCache = { at: 0, docs: null };
let _timingCache = { at: 0, docs: null };

async function getProductionSections() {
  if (_prodCache.docs && Date.now() - _prodCache.at < 60000) {
    return _prodCache.docs;
  }
  const docs = await M.SectionTimetable.find({}).lean();
  _prodCache = { at: Date.now(), docs };
  return docs;
}

function invalidateProductionCache() {
  _prodCache = { at: 0, docs: null };
  _timingCache = { at: 0, docs: null };
}

async function getTimingSets() {
  if (_timingCache.docs && Date.now() - _timingCache.at < 60000) {
    return _timingCache.docs;
  }
  const docs = await M.TimingSet.find({}).lean();
  _timingCache = { at: Date.now(), docs };
  return docs;
}

// ── Name & String Normalizers ──

function normName(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|prof|er)\b\.?/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePeriod(v, keySuffix) {
  if (typeof v === 'number' && !isNaN(v)) return v;
  if (typeof v === 'string') {
    const m = v.match(/\d+/);
    if (m) return parseInt(m[0], 10);
  }
  if (keySuffix) {
    const m = String(keySuffix).match(/\d+/);
    if (m) return parseInt(m[0], 10);
  }
  return 1;
}

const DAY_MAP = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
  sunday: 'Sunday', monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday'
};
const DAY_ABBR_MAP = {
  sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat'
};

function dayFull(d) {
  if (!d) return 'Monday';
  return DAY_MAP[String(d).trim().toLowerCase()] || 'Monday';
}

function dayAbbr(d) {
  if (!d) return 'Mon';
  const full = dayFull(d).toLowerCase();
  return DAY_ABBR_MAP[full] || 'Mon';
}

function normalizeYear(yr) {
  if (!yr) return '';
  const s = String(yr).trim();
  if (TO_ROMAN[s]) return TO_ROMAN[s];
  return s.toUpperCase();
}

function timingForClass(cls, sets = []) {
  if (!sets || !sets.length) return null;
  if (cls && cls.year) {
    const yrStr = String(cls.year).trim();
    const yrRoman = normalizeYear(yrStr);
    const yrNum = FROM_ROMAN[yrStr.toLowerCase()] || yrStr;
    const match = sets.find(ts => {
      const app = (ts.applicableYears || []).map(y => String(y).trim());
      return app.includes(yrStr) || app.includes(yrRoman) || app.includes(String(yrNum));
    });
    if (match) return match;
  }
  return sets.find(ts => ts.isDefault) || sets[0] || null;
}

function sessionOfPeriod(set, p) {
  const lunchAfter = set?.lunchAfter || 6;
  return Number(p) <= lunchAfter ? 'FN' : 'AN';
}

function readOverrideSlot(s = {}) {
  if (!s) return {};
  const teacher = s.teacher || s.teacherName || '';
  const teacherName = teacher;
  const teacherTrackId = s.teacherTrackId || s.trackId || '';
  const teacherId = s.teacherId ? String(s.teacherId) : '';
  const subject = s.subject || s.subjectName || '';
  const subjectName = subject;
  const room = s.room || s.hallNo || '';
  const hallNo = room;
  return {
    teacher,
    teacherName,
    teacherTrackId,
    teacherId,
    subject,
    subjectName,
    room,
    hallNo
  };
}

function buildOverrideSlot(s = {}) {
  if (!s) return {};
  const teacher = s.teacher || s.teacherName || '';
  const teacherTrackId = s.teacherTrackId || s.trackId || '';
  const teacherId = s.teacherId ? String(s.teacherId) : '';
  const subject = s.subject || s.subjectName || '';
  const room = s.room || s.hallNo || '';
  return {
    teacher,
    teacherName: teacher,
    teacherTrackId,
    teacherId,
    subject,
    subjectName: subject,
    room,
    hallNo: room
  };
}

// ── Teacher Identity Resolution ──

async function getTeacherIdentity(user, trackIdOverride) {
  let teacherDoc = null;
  if (trackIdOverride && user && user.role === 'admin') {
    teacherDoc = await M.Teacher.findOne({ trackId: trackIdOverride }).lean();
  } else if (user) {
    if (user.role === 'teacher') {
      if (user.trackId) {
        teacherDoc = await M.Teacher.findOne({ trackId: user.trackId }).lean();
      }
      if (!teacherDoc && user._id) {
        teacherDoc = await M.Teacher.findById(user._id).lean();
      }
    } else if (user.role === 'admin' && user.trackId) {
      teacherDoc = await M.Teacher.findOne({ trackId: user.trackId }).lean();
    }
  }

  if (!teacherDoc) {
    return null;
  }

  const rawNames = [
    teacherDoc.fullName,
    teacherDoc.name,
    `${teacherDoc.firstName || ''} ${teacherDoc.lastName || ''}`.trim(),
    teacherDoc.username
  ].filter(Boolean);

  const normNames = [...new Set(rawNames.map(normName).filter(Boolean))];

  return {
    _id: teacherDoc._id,
    trackId: teacherDoc.trackId,
    fullName: teacherDoc.fullName || teacherDoc.name || 'Faculty',
    deptId: teacherDoc.deptId,
    deptCode: teacherDoc.deptCode,
    rawNames: [...new Set(rawNames)],
    normNames
  };
}

function refMatches(slot, idn) {
  if (!slot || !idn) return false;
  const trackId = slot.teacherTrackId || slot.trackId;
  if (trackId && String(trackId).trim() === String(idn.trackId).trim()) return true;

  const tId = slot.teacherId;
  if (tId && idn._id && String(tId).trim() === String(idn._id).trim()) return true;

  const rawName = slot.teacher || slot.teacherName;
  if (rawName) {
    const n = normName(rawName);
    if (n && idn.normNames.includes(n)) return true;
  }

  return false;
}

// ── Canonical Slot Builder ──

function normalizeProdSlot(key, raw, section, classDoc, timingSet) {
  const pNum = parsePeriod(raw.period, key);
  const span = Number(raw.span || raw.duration || 1) || 1;
  const periods = Array.from({ length: span }, (_, i) => pNum + i);

  // Resolve start/end timings from timing set
  let start = '08:30';
  let end = '09:15';
  if (timingSet && Array.isArray(timingSet.periods)) {
    const pStartObj = timingSet.periods.find(p => p.periodNumber === pNum || p.number === pNum);
    const pEndObj = timingSet.periods.find(p => p.periodNumber === (pNum + span - 1) || p.number === (pNum + span - 1));
    if (pStartObj?.start) start = pStartObj.start;
    if (pEndObj?.end) end = pEndObj.end;
  }

  const dFull = dayFull(raw.day);
  const isLab = Boolean(raw.isLab || raw.type === 'Lab');
  const type = (raw.activityId || raw.activityLabel) ? 'Activity' : (isLab ? 'Lab' : 'Theory');

  return {
    key: `${dFull}_${pNum}`,
    day: dayAbbr(dFull),
    dayFull: dFull,
    classId: section.classId ? String(section.classId) : '',
    className: section.className || classDoc?.name || 'Class',
    deptName: section.deptName || classDoc?.deptName || '',
    periodNumber: pNum,
    span,
    periods,
    start,
    end,
    timingSetCode: timingSet?.code || 'SET_1',
    subject: raw.subject || raw.subjectName || '',
    subjectName: raw.subjectName || raw.subject || '',
    subjectId: raw.subjectId ? String(raw.subjectId) : null,
    teacher: raw.teacher || raw.teacherName || '',
    teacherName: raw.teacherName || raw.teacher || '',
    teacherTrackId: raw.teacherTrackId || '',
    room: raw.room || raw.hallNo || '',
    type,
    isLab,
    combinedWith: Array.isArray(raw.combinedWith) ? raw.combinedWith : [],
    combinedClassIds: [],
    role: 'owner',
    status: 'scheduled',
    originalTeacher: null,
    substituteTeacher: null,
    overrideId: null,
    leaveRequestId: null,
    note: raw.state || raw.comment || '',
    attendance: { marked: false, finalized: false }
  };
}

// ── Weekly Template Builder ──

async function buildWeeklyTemplate(idn) {
  const [sections, timingSets, classes] = await Promise.all([
    getProductionSections(),
    getTimingSets(),
    M.Class.find({}).lean()
  ]);

  const classesMap = new Map();
  classes.forEach(c => classesMap.set(String(c._id), c));

  const slots = [];
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  sections.forEach(section => {
    const classDoc = classesMap.get(String(section.classId));
    const clsTiming = timingForClass(classDoc, timingSets);
    const sectionSlots = section.slots || {};

    Object.entries(sectionSlots).forEach(([key, raw]) => {
      if (!raw) return;
      if (refMatches(raw, idn)) {
        const canonical = normalizeProdSlot(key, raw, section, classDoc, clsTiming);
        slots.push(canonical);
      }
    });
  });

  // Sort by day and period
  slots.sort((a, b) => {
    const dComp = dayOrder.indexOf(a.dayFull) - dayOrder.indexOf(b.dayFull);
    if (dComp !== 0) return dComp;
    return a.periodNumber - b.periodNumber;
  });

  return { timingSets, slots };
}

// ── Multi-Day Schedule Resolver (from..to, max 14 days) ──

async function resolveTeacherRange(idn, fromISO, toISO) {
  const from = String(fromISO || '').trim().slice(0, 10);
  const to = String(toISO || '').trim().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error('Invalid date format. Expected YYYY-MM-DD.');
  }

  const fromDate = new Date(from + 'T00:00:00.000Z');
  const toDate = new Date(to + 'T23:59:59.999Z');
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) {
    throw new Error('Invalid date range. "from" must be before or equal to "to".');
  }

  const daysDiff = Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000));
  if (daysDiff > 14) {
    throw new Error('Date range exceeds maximum allowed limit of 14 days.');
  }

  // Generate date list
  const dateStrings = [];
  const cur = new Date(fromDate);
  while (cur <= toDate) {
    dateStrings.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const [weeklyTemplate, calendarDays, leaves, assignments, classes, sections] = await Promise.all([
    buildWeeklyTemplate(idn),
    M.CalendarDay.find({ date: { $gte: fromDate, $lte: toDate } }).lean(),
    M.TeacherLeaveRequest.find({
      status: 'Approved',
      $or: [
        { teacherTrackId: idn.trackId },
        { teacherId: idn._id }
      ],
      $or: [
        { dates: { $in: dateStrings } },
        { fromDate: { $lte: to }, toDate: { $gte: from } }
      ]
    }).lean(),
    M.Assignment.find({}).lean(),
    M.Class.find({}).lean(),
    getProductionSections()
  ]);

  const classesMap = new Map();
  classes.forEach(c => classesMap.set(String(c._id), c));

  const sectionsMap = new Map();
  sections.forEach(s => sectionsMap.set(String(s.classId), s));

  const templateClassIds = [...new Set(weeklyTemplate.slots.map(s => s.classId).filter(Boolean))];

  // Query overrides in date range relevant to this teacher or teacher's classes
  const nameRegexes = idn.rawNames.map(n => new RegExp('^' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'));
  const overrides = await M.Override.find({
    date: { $gte: fromDate, $lte: toDate },
    $or: [
      { classId: { $in: templateClassIds.map(id => id.match(/^[0-9a-fA-F]{24}$/) ? id : null).filter(Boolean) } },
      { 'newSlot.teacherTrackId': idn.trackId },
      { 'newSlot.teacherId': idn._id },
      { 'newSlot.teacher': { $in: nameRegexes } },
      { 'newSlot.teacherName': { $in: nameRegexes } },
      { 'originalSlot.teacherTrackId': idn.trackId },
      { 'originalSlot.teacherId': idn._id },
      { 'originalSlot.teacher': { $in: nameRegexes } },
      { 'originalSlot.teacherName': { $in: nameRegexes } }
    ]
  }).lean();

  // Query attendance in date range
  const classAttendanceRecords = await M.ClassAttendance.find({
    date: { $gte: fromDate, $lte: toDate }
  }).lean();

  const daysResult = [];

  for (const dateStr of dateStrings) {
    const dObj = new Date(dateStr + 'T00:00:00.000Z');
    const dayName = DAY_FULL[dObj.getUTCDay()];
    const isSunday = dayName === 'Sunday';

    // Calendar check for dateStr
    const startOfCurDay = new Date(dateStr + 'T00:00:00.000Z');
    const endOfCurDay = new Date(dateStr + 'T23:59:59.999Z');
    const calDay = calendarDays.find(cd => {
      const cdTime = new Date(cd.date).getTime();
      return cdTime >= startOfCurDay.getTime() && cdTime <= endOfCurDay.getTime();
    });

    let isHoliday = isSunday;
    let holidayReason = isSunday ? 'Sunday' : '';

    if (calDay?.details?.length) {
      // Global holiday detail has no year, or all years
      const globalHol = calDay.details.find(d => !d.year && ['leave', 'holiday', 'vacation', 'exam', 'event'].includes(d.dayType));
      if (globalHol) {
        isHoliday = true;
        holidayReason = globalHol.comments || `Academic Calendar: ${globalHol.dayType.toUpperCase()}`;
      }
    }

    // Teacher leave check for dateStr
    const activeLeave = leaves.find(l => {
      if (Array.isArray(l.dates) && l.dates.includes(dateStr)) return true;
      if (l.fromDate && l.toDate && l.fromDate <= dateStr && l.toDate >= dateStr) return true;
      return false;
    });

    const onLeave = Boolean(activeLeave);
    const leaveSlot = activeLeave?.slot || (onLeave ? 'Full Day' : null);

    // Overrides for this day
    const dayOverrides = overrides.filter(ov => {
      const ovTime = new Date(ov.date).getTime();
      return ovTime >= startOfCurDay.getTime() && ovTime <= endOfCurDay.getTime();
    });

    // Attendance for this day
    const dayAttendance = classAttendanceRecords.filter(att => {
      const attTime = new Date(att.date).getTime();
      return attTime >= startOfCurDay.getTime() && attTime <= endOfCurDay.getTime();
    });

    const daySlots = [];

    // 1. Process weekly template slots for this day
    const templateSlotsForDay = weeklyTemplate.slots.filter(s => s.dayFull === dayName);

    for (const baseSlot of templateSlotsForDay) {
      const slot = {
        ...baseSlot,
        date: dateStr,
        attendance: { marked: false, finalized: false }
      };

      const classDoc = classesMap.get(slot.classId);
      const clsYear = classDoc ? normalizeYear(classDoc.year) : '';

      // Check class-specific holiday / half-day in CalendarDay
      if (calDay?.details?.length) {
        const classHol = calDay.details.find(d => {
          if (!['leave', 'holiday', 'vacation', 'exam', 'event'].includes(d.dayType)) return false;
          return !d.year || normalizeYear(d.year) === clsYear;
        });
        if (classHol) {
          slot.status = 'holiday';
          slot.note = classHol.comments || `Academic Calendar: ${classHol.dayType.toUpperCase()}`;
        }

        const halfDay = calDay.details.find(d => d.dayType === 'half-day' && (!d.year || normalizeYear(d.year) === clsYear));
        if (halfDay && halfDay.timing?.end) {
          if (slot.start >= halfDay.timing.end) {
            slot.status = 'cancelled';
            slot.note = 'Half-day schedule: afternoon classes cancelled';
          }
        }
      }

      if (isSunday) {
        slot.status = 'holiday';
        slot.note = 'Sunday';
      }

      // Check teacher leave
      if (onLeave && slot.status === 'scheduled') {
        const pSession = sessionOfPeriod(weeklyTemplate.timingSets.find(ts => ts.code === slot.timingSetCode), slot.periodNumber);
        if (leaveSlot === 'Full Day' || leaveSlot === pSession) {
          slot.status = 'leave';
          slot.leaveRequestId = activeLeave._id;
          slot.note = `On Approved Leave (${leaveSlot})`;
        }
      }

      // Check Day Overrides for this class & period
      const classOv = dayOverrides.find(ov =>
        String(ov.classId) === String(slot.classId) &&
        ov.period === slot.periodNumber
      );

      if (classOv) {
        slot.overrideId = classOv._id;
        if (classOv.type === 'cancelled') {
          slot.status = 'cancelled';
          slot.note = classOv.reason || 'Period cancelled';
        } else if (classOv.type === 'substitute') {
          slot.status = 'substituted';
          const subInfo = readOverrideSlot(classOv.newSlot);
          slot.substituteTeacher = subInfo.teacher || 'Substitute Faculty';
          slot.note = classOv.reason || `Substitute assigned: ${slot.substituteTeacher}`;
        } else if (classOv.type === 'room_change') {
          const roomInfo = readOverrideSlot(classOv.newSlot);
          slot.room = roomInfo.room || slot.room;
          slot.note = classOv.reason || 'Room relocated';
        }
      }

      // Check Attendance status
      const attDoc = dayAttendance.find(att => String(att.classId) === String(slot.classId));
      if (attDoc && Array.isArray(attDoc.periods)) {
        const matchPeriod = attDoc.periods.find(p => (p.periodNumbers || []).includes(slot.periodNumber));
        if (matchPeriod) {
          slot.attendance = {
            marked: true,
            finalized: Boolean(matchPeriod.isFinal)
          };
        }
      }

      // Resolve subjectId from Assignment if missing
      if (!slot.subjectId) {
        const assign = assignments.find(a =>
          String(a.classId) === String(slot.classId) &&
          normName(a.subjectName) === normName(slot.subject)
        );
        if (assign?.subjectId) {
          slot.subjectId = String(assign.subjectId);
        }
      }

      daySlots.push(slot);
    }

    // 2. Process Substitute-In Overrides (where this teacher is substituting for another class)
    const subInOverrides = dayOverrides.filter(ov =>
      ov.type === 'substitute' &&
      refMatches(ov.newSlot, idn) &&
      !daySlots.some(s => s.overrideId && String(s.overrideId) === String(ov._id))
    );

    for (const ov of subInOverrides) {
      const classDoc = classesMap.get(String(ov.classId));
      const sectionDoc = sectionsMap.get(String(ov.classId));
      const clsTiming = timingForClass(classDoc, weeklyTemplate.timingSets);
      const subInfo = readOverrideSlot(ov.newSlot);
      const origInfo = readOverrideSlot(ov.originalSlot);

      // Find original section slot for fallback timings/details if available
      const sectionSlots = sectionDoc?.slots || {};
      const origRaw = Object.values(sectionSlots).find(s => s && s.day === dayName && parsePeriod(s.period) === ov.period);

      const span = Number(origRaw?.span || origRaw?.duration || 1) || 1;
      const periods = Array.from({ length: span }, (_, i) => ov.period + i);

      let start = '08:30';
      let end = '09:15';
      if (clsTiming && Array.isArray(clsTiming.periods)) {
        const pStartObj = clsTiming.periods.find(p => p.periodNumber === ov.period || p.number === ov.period);
        const pEndObj = clsTiming.periods.find(p => p.periodNumber === (ov.period + span - 1) || p.number === (ov.period + span - 1));
        if (pStartObj?.start) start = pStartObj.start;
        if (pEndObj?.end) end = pEndObj.end;
      }

      const isLab = Boolean(origRaw?.isLab || origRaw?.type === 'Lab');

      const subSlot = {
        key: `${dayName}_${ov.period}`,
        date: dateStr,
        day: dayAbbr(dayName),
        dayFull: dayName,
        classId: ov.classId ? String(ov.classId) : '',
        className: sectionDoc?.className || classDoc?.name || 'Class',
        deptName: sectionDoc?.deptName || classDoc?.deptName || '',
        periodNumber: ov.period,
        span,
        periods,
        start,
        end,
        timingSetCode: clsTiming?.code || 'SET_1',
        subject: subInfo.subject || origInfo.subject || origRaw?.subject || 'Subject',
        subjectName: subInfo.subjectName || origInfo.subjectName || origRaw?.subjectName || 'Subject',
        subjectId: origRaw?.subjectId ? String(origRaw.subjectId) : null,
        teacher: subInfo.teacher || idn.fullName,
        teacherName: subInfo.teacherName || idn.fullName,
        teacherTrackId: idn.trackId,
        room: subInfo.room || origInfo.room || origRaw?.room || '',
        type: isLab ? 'Lab' : 'Theory',
        isLab,
        combinedWith: [],
        combinedClassIds: [],
        role: 'substitute',
        status: 'scheduled',
        originalTeacher: origInfo.teacher || 'Original Faculty',
        substituteTeacher: null,
        overrideId: ov._id,
        leaveRequestId: null,
        note: ov.reason || `Substitute for ${origInfo.teacher || 'colleague'}`,
        attendance: { marked: false, finalized: false }
      };

      // Check Attendance for substitute slot
      const attDoc = dayAttendance.find(att => String(att.classId) === String(subSlot.classId));
      if (attDoc && Array.isArray(attDoc.periods)) {
        const matchPeriod = attDoc.periods.find(p => (p.periodNumbers || []).includes(subSlot.periodNumber));
        if (matchPeriod) {
          subSlot.attendance = {
            marked: true,
            finalized: Boolean(matchPeriod.isFinal)
          };
        }
      }

      daySlots.push(subSlot);
    }

    // Sort day's slots by period number
    daySlots.sort((a, b) => a.periodNumber - b.periodNumber);

    daysResult.push({
      date: dateStr,
      day: dayAbbr(dayName),
      dayFull: dayName,
      isHoliday,
      holidayReason,
      onLeave,
      leaveSlot,
      slots: daySlots
    });
  }

  return daysResult;
}

module.exports = {
  normalizeProdSlot,
  readOverrideSlot,
  buildOverrideSlot,
  getTeacherIdentity,
  refMatches,
  getTimingSets,
  timingForClass,
  sessionOfPeriod,
  buildWeeklyTemplate,
  resolveTeacherRange,
  getProductionSections,
  invalidateProductionCache,
  normName,
  parsePeriod,
  dayFull,
  dayAbbr,
  normalizeYear
};
