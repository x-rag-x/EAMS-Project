/**
 * utils/timetableResolver.js
 * Shared timetable resolver for both Teacher Portal and Smart Board.
 * Resolves authoritative daily schedule for a given room/date.
 * Priority: Calendar Holiday → Override (room_change/substitute/cancelled) → Week Instance → Published Template
 */

const M = require('../models');
const { nowParts, getUtcDayBounds, todayInInstitutionTz } = require('./institutionTime');

const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TO_ROMAN = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV' };
const FROM_ROMAN = { 'I': '1', 'II': '2', 'III': '3', 'IV': '4' };

function normalizeYear(yr) {
  if (!yr) return '';
  const s = String(yr).trim().toUpperCase();
  const romanMatch = s.match(/\b(IV|III|II|I)\b/);
  if (romanMatch) return romanMatch[1];
  const numMatch = s.match(/\b([1-4])\b/);
  if (numMatch && TO_ROMAN[numMatch[1]]) return TO_ROMAN[numMatch[1]];
  if (TO_ROMAN[s]) return TO_ROMAN[s];
  return s;
}

function dayFull(d) {
  if (!d) return 'Monday';
  const map = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
  return map[String(d).trim().toLowerCase()] || 'Monday';
}

/**
 * Get the applicable TimingSet for a class
 */
async function getTimingSetForClass(classDoc) {
  if (!classDoc) {
    const sets = await M.TimingSet.find({}).lean();
    return sets.find(ts => ts.isDefault) || sets[0] || null;
  }
  // 1. Check if class has an active template with timingSetId
  if (classDoc._id) {
    const template = await M.SemesterTemplate.findOne({
      classId: classDoc._id,
      timingSetId: { $ne: null }
    }).sort({ status: 1, updatedAt: -1 }).lean();
    if (template && template.timingSetId) {
      const ts = await M.TimingSet.findById(template.timingSetId).lean();
      if (ts) return ts;
    }
  }

  // 2. Check by applicableYears matching classDoc.year
  const sets = await M.TimingSet.find({}).lean();
  if (!sets || !sets.length) return null;
  if (classDoc && classDoc.year) {
    const yrStr = String(classDoc.year).trim();
    const yrRoman = normalizeYear(yrStr);
    const yrArabic = FROM_ROMAN[yrRoman] || (yrStr.match(/[1-4]/) ? yrStr.match(/[1-4]/)[0] : '');
    const match = sets.find(ts => {
      const app = (ts.applicableYears || []).map(y => String(y).trim().toUpperCase());
      return app.includes(yrStr.toUpperCase()) ||
        app.includes(yrRoman) ||
        (yrArabic && app.includes(yrArabic));
    });
    if (match) return match;
  }
  return sets.find(ts => ts.isDefault) || sets[0] || null;
}

/**
 * Get the published WeekInstance for a room/date (per-week snapshot with modifications)
 * Priority: Published WeekInstance → Published Template
 */
async function getPublishedWeekInstanceSlot(roomId, hallNo, dayName, periodNumber, dateStr) {
  // Find the week start date for the given date
  const { start: weekStart } = await getUtcDayBounds(dateStr);
  const dayOfWeek = new Date(weekStart).getUTCDay();
  const weekStartDate = new Date(weekStart);
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() - dayOfWeek); // Start of week (Sunday)

  // Find published WeekInstance for this week
  const weekInstance = await M.WeekInstance.findOne({
    weekStartDate: weekStartDate,
    status: 'Published'
  }).populate('semesterTemplateId').lean();

  if (!weekInstance) return null;

  // Check modifiedSlots first (week-specific modifications)
  const modifiedSlot = weekInstance.modifiedSlots?.find(g => {
    if (g.day !== dayName) return false;
    const roomMatch = (String(g.roomId) === String(roomId) || g.room === hallNo);
    if (!roomMatch) return false;
    const span = Math.max(1, Number(g.span || 1));
    return g.period === periodNumber || (g.period <= periodNumber && periodNumber < g.period + span);
  });

  if (modifiedSlot) {
    const template = weekInstance.semesterTemplateId;
    return {
      template,
      slot: modifiedSlot,
      classId: template.classId?._id,
      className: template.classId?.name || modifiedSlot.section || '',
      subjectId: modifiedSlot.subjectId,
      subjectName: modifiedSlot.subject,
      teacherTrackId: modifiedSlot.teacherTrackId,
      teacherName: modifiedSlot.teacher,
      type: modifiedSlot.type || 'Theory',
      isLab: modifiedSlot.isLab || false,
      span: modifiedSlot.span || 1,
      combinedWith: modifiedSlot.combinedWith || [],
      originalRoom: modifiedSlot.room,
      originalRoomId: modifiedSlot.roomId,
      fromWeekInstance: true
    };
  }

  // Fall back to the base template's slots for this week instance
  const template = weekInstance.semesterTemplateId;
  if (!template) return null;

  const slot = template.grid?.find(g => {
    if (g.day !== dayName) return false;
    const roomMatch = (String(g.roomId) === String(roomId) || g.room === hallNo);
    if (!roomMatch) return false;
    const span = Math.max(1, Number(g.span || 1));
    return g.period === periodNumber || (g.period <= periodNumber && periodNumber < g.period + span);
  });

  if (!slot) return null;

  return {
    template,
    slot,
    classId: template.classId?._id,
    className: template.classId?.name || slot.section || '',
    subjectId: slot.subjectId,
    subjectName: slot.subject,
    teacherTrackId: slot.teacherTrackId,
    teacherName: slot.teacher,
    type: slot.type || 'Theory',
    isLab: slot.isLab || false,
    span: slot.span || 1,
    combinedWith: slot.combinedWith || [],
    originalRoom: slot.room,
    originalRoomId: slot.roomId,
    fromWeekInstance: true
  };
}

/**
 * Helper: Check if slot matches room or linked class
 */
function slotMatchesRoom(g, roomId, hallNo, linkedClass, slotClassId = null) {
  if (!g) return false;
  const sRoomId = g.roomId ? String(g.roomId) : '';
  const tRoomId = roomId ? String(roomId) : '';
  const sRoom = String(g.room || '').trim();
  const tHall = String(hallNo || '').trim();
  const effectiveClassId = slotClassId || (g.classId ? String(g.classId?._id || g.classId) : null);

  // 1. Exact roomId match
  if (sRoomId && tRoomId && sRoomId === tRoomId) return true;

  // 2. Exact or case-insensitive hallNo match (e.g. 'LH-39' === 'lh-39')
  if (sRoom && tHall && sRoom.toLowerCase() === tHall.toLowerCase()) return true;

  // 3. Normalized alphanumeric match (e.g. 'LH 39' vs 'LH-39')
  const clean = str => String(str || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (sRoom && tHall && clean(sRoom) === clean(tHall)) return true;

  // 4. Lab room shorthand (e.g. room '2' or 'LAB 2' for hallNo 'LAB 2')
  if (sRoom && tHall) {
    if (clean(tHall) === 'lab' + clean(sRoom) || clean(sRoom) === 'lab' + clean(tHall)) return true;
  }

  // 5. If this room has a linked class designated to it:
  if (linkedClass) {
    const isLinkedClassSlot = (effectiveClassId && String(effectiveClassId) === String(linkedClass._id)) ||
                              (g.section && clean(g.section) === clean(linkedClass.section)) ||
                              (g.section && clean(g.section) === clean(linkedClass.name));

    if (isLinkedClassSlot) {
      if (!sRoom && !sRoomId) return true;
      if (clean(sRoom) === clean(tHall)) return true;
      if (clean(sRoom) === clean(linkedClass.section)) return true;
      if (clean(sRoom) === clean(linkedClass.name)) return true;
      // All class timetable slots are displayed on the home classroom board
      return true;
    }
  }

  return false;
}

/**
 * Helper: Check if a slot covers a specific period (accounting for span)
 */
function slotCoversPeriod(g, periodNum) {
  if (!g) return false;
  const p = Number(g.period || g.periodNumber || 0);
  const span = Math.max(1, Number(g.span || 1));
  return p === periodNum || (p <= periodNum && periodNum < p + span);
}

/**
 * Resolve the published template slot for a room on a given day/period
 * (fallback when no WeekInstance exists)
 */
async function getPublishedTemplateSlot(roomId, hallNo, dayName, periodNumber) {
  const linkedClass = await M.Class.findOne({
    $or: [
      { roomId },
      ...(hallNo ? [{ hallNo }] : [])
    ]
  }).lean();

  const templates = await M.SemesterTemplate.find({
    status: 'published',
    'grid.day': dayName,
    $or: [
      { 'grid.roomId': roomId },
      ...(hallNo ? [{ 'grid.room': hallNo }] : []),
      ...(linkedClass ? [{ classId: linkedClass._id }] : [])
    ]
  }).populate('classId').lean();

  for (const template of templates) {
    const slot = (template.grid || []).find(g => {
      if (g.day !== dayName) return false;
      if (!slotCoversPeriod(g, periodNumber)) return false;
      return slotMatchesRoom(g, roomId, hallNo, linkedClass, template.classId?._id || template.classId);
    });
    if (slot) {
      return {
        template,
        slot,
        classId: template.classId?._id || linkedClass?._id,
        className: template.classId?.name || slot.section || linkedClass?.name || '',
        subjectId: slot.subjectId,
        subjectName: slot.subject,
        teacherTrackId: slot.teacherTrackId,
        teacherName: slot.teacher,
        type: slot.type || (slot.isLab ? 'Lab' : 'Theory'),
        isLab: Boolean(slot.isLab || slot.type === 'Lab'),
        span: slot.span || 1,
        spanRootPeriod: slot.period,
        combinedWith: slot.combinedWith || [],
        originalRoom: slot.room,
        originalRoomId: slot.roomId
      };
    }
  }

  // Fallback to SectionTimetable
  if (linkedClass && M.SectionTimetable && typeof M.SectionTimetable.findOne === 'function') {
    try {
      const secTt = await M.SectionTimetable.findOne({ classId: linkedClass._id }).lean();
      if (secTt && secTt.slots) {
        const secSlots = Object.values(secTt.slots).filter(s => s && s.day === dayName);
        const slot = secSlots.find(s => slotCoversPeriod(s, periodNumber) && slotMatchesRoom(s, roomId, hallNo, linkedClass, secTt.classId));
        if (slot) {
          return {
            template: null,
            slot,
            classId: linkedClass._id,
            className: linkedClass.name || slot.section || '',
            subjectId: slot.subjectId,
            subjectName: slot.subject,
            teacherTrackId: slot.teacherTrackId,
            teacherName: slot.teacher,
            type: slot.type || (slot.isLab ? 'Lab' : 'Theory'),
            isLab: Boolean(slot.isLab || slot.type === 'Lab'),
            span: slot.span || 1,
            spanRootPeriod: slot.spanRootPeriod || slot.period,
            combinedWith: slot.combinedWith || [],
            originalRoom: slot.room,
            originalRoomId: slot.roomId
          };
        }
      }
    } catch (e) {
      // Ignore fallback error
    }
  }

  return null;
}

/**
 * Get active overrides for a room/date
 */
async function getOverridesForRoomDate(roomId, hallNo, dateStr) {
  const { start, end } = await getUtcDayBounds(dateStr);

  return M.Override.find({
    date: { $gte: start, $lte: end },
    status: 'confirmed',
    $or: [
      { 'originalSlot.roomId': roomId },
      { 'newSlot.roomId': roomId },
      { 'originalSlot.room': hallNo },
      { 'newSlot.room': hallNo }
    ]
  }).lean();
}

/**
 * Get calendar day details for a date
 */
async function getCalendarDay(dateStr) {
  const { start, end } = await getUtcDayBounds(dateStr);
  return M.CalendarDay.findOne({
    date: { $gte: start, $lte: end }
  }).lean();
}

/**
 * Check if a class has a holiday on a given date
 */
function checkClassHoliday(calDay, classDoc) {
  if (!calDay?.details?.length || !classDoc) return { isHoliday: false, reason: null, isHalfDay: false, halfDayEnd: null };

  const clsYear = normalizeYear(classDoc.year);

  // Class-specific holiday
  const classHol = calDay.details.find(d => {
    if (!['leave', 'holiday', 'vacation', 'exam', 'event'].includes(d.dayType)) return false;
    return !d.year || normalizeYear(d.year) === clsYear;
  });
  if (classHol) {
    return { isHoliday: true, reason: classHol.comments || `Academic Calendar: ${classHol.dayType.toUpperCase()}`, isHalfDay: false, halfDayEnd: null };
  }

  // Class-specific half-day
  const halfDay = calDay.details.find(d => d.dayType === 'half-day' && (!d.year || normalizeYear(d.year) === clsYear));
  if (halfDay && halfDay.timing?.end) {
    return { isHoliday: false, reason: null, isHalfDay: true, halfDayEnd: halfDay.timing.end };
  }

  // Global holiday
  const globalHol = calDay.details.find(d => !d.year && ['leave', 'holiday', 'vacation', 'exam', 'event'].includes(d.dayType));
  if (globalHol) {
    return { isHoliday: true, reason: globalHol.comments || `Academic Calendar: ${globalHol.dayType.toUpperCase()}`, isHalfDay: false, halfDayEnd: null };
  }

  return { isHoliday: false, reason: null, isHalfDay: false, halfDayEnd: null };
}

/**
 * Apply override to a base slot
 */
function applyOverride(baseSlot, override, timingSet) {
  if (override.type === 'cancelled') {
    return { ...baseSlot, status: 'cancelled', note: override.reason || 'Period cancelled', overrideId: override._id };
  }
  if (override.type === 'substitute' && override.newSlot) {
    const sub = override.newSlot;
    return {
      ...baseSlot,
      status: 'substituted',
      teacherTrackId: sub.teacherTrackId || baseSlot.teacherTrackId,
      teacherName: sub.teacher || sub.teacherName || 'Substitute Faculty',
      note: override.reason || `Substitute assigned: ${sub.teacher || sub.teacherName || 'Substitute Faculty'}`,
      originalTeacher: baseSlot.teacherName,
      overrideId: override._id,
      isSubstitute: true
    };
  }
  if (override.type === 'room_change' && override.newSlot) {
    const roomInfo = override.newSlot;
    return {
      ...baseSlot,
      room: roomInfo.room || roomInfo.hallNo || baseSlot.room,
      roomId: roomInfo.roomId || baseSlot.roomId,
      note: override.reason || 'Room relocated',
      overrideId: override._id
    };
  }
  return baseSlot;
}

/**
 * Build the resolved slot object for the board context contract
 */
function buildResolvedSlot(baseSlot, timingSet, classDoc, overrideApplied = false) {
  const periodNum = baseSlot.periodNumber || baseSlot.period;
  const span = Math.max(1, Number(baseSlot.span || 1));
  const rootPeriod = Number(baseSlot.spanRootPeriod || baseSlot.period || periodNum);

  // Get period timing from timing set
  let start = '08:30';
  let end = '09:15';
  let label = `Period ${periodNum}`;
  if (timingSet && Array.isArray(timingSet.periods)) {
    const pStartObj = timingSet.periods.find(p => (p.periodNumber || p.number) === rootPeriod);
    const pEndObj = timingSet.periods.find(p => (p.periodNumber || p.number) === (rootPeriod + span - 1));
    if (pStartObj?.start) start = pStartObj.start;
    if (pEndObj?.end) end = pEndObj.end;
    const curP = timingSet.periods.find(p => (p.periodNumber || p.number) === periodNum);
    if (curP?.label) label = curP.label;
    else if (pStartObj?.label) label = pStartObj.label;
  }

  const to12h = (timeStr) => {
    if (!timeStr) return '';
    const parts = String(timeStr).split(':');
    let h = parseInt(parts[0], 10);
    if (isNaN(h)) return timeStr;
    const m = (parts[1] || '00').slice(0, 2);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  };

  return {
    classId: baseSlot.classId ? String(baseSlot.classId) : '',
    className: baseSlot.className || '',
    subjectId: baseSlot.subjectId ? String(baseSlot.subjectId) : '',
    subjectName: baseSlot.subjectName || baseSlot.subject || '',
    teacherTrackId: baseSlot.teacherTrackId || '',
    teacherName: baseSlot.teacherName || baseSlot.teacher || '',
    isSubstitute: baseSlot.isSubstitute || false,
    originalTeacherName: baseSlot.originalTeacher || null,
    period: periodNum,
    span,
    start,
    end,
    time12: `${to12h(start)} – ${to12h(end)}`,
    label,
    type: baseSlot.type || (baseSlot.isLab ? 'Lab' : 'Theory'),
    status: baseSlot.status || 'scheduled',
    note: baseSlot.note || '',
    overrideId: baseSlot.overrideId || null
  };
}

/**
 * Main resolver: Get resolved schedule for a room on a specific date
 * Returns array of periods with resolved slots (or null for free periods)
 * Priority: Calendar Holiday → Override (room_change/substitute/cancelled) → Week Instance → Published Template → SectionTimetable
 */
async function resolveRoomDaySchedule(roomId, dateStr = null) {
  const targetDateStr = dateStr || await todayInInstitutionTz();

  // Compute day name from dateStr
  const [year, month, day] = targetDateStr.split('-').map(Number);
  const dateObj = new Date(Date.UTC(year, month - 1, day));
  const dayIndex = dateObj.getUTCDay();
  const dayNameFromDate = DAY_FULL[dayIndex];

  const room = await M.Room.findById(roomId).populate('buildingId').lean();
  if (!room) return { date: targetDateStr, day: dayNameFromDate, periods: [], room: null };

  const hallNo = room.hallNo;
  const calDay = await getCalendarDay(targetDateStr);

  // Look for any Class designated to this room (by roomId or hallNo)
  const linkedClass = await M.Class.findOne({
    $or: [
      { roomId: room._id },
      ...(hallNo ? [{ hallNo: hallNo }] : [])
    ]
  }).lean();

  // Get overrides for this room/date
  const overrides = await getOverridesForRoomDate(roomId, hallNo, targetDateStr);

  // Get timing sets
  const timingSets = await M.TimingSet.find({}).lean();
  const defaultTimingSet = timingSets.find(ts => ts.isDefault) || timingSets[0] || null;
  const classTimingSet = linkedClass ? await getTimingSetForClass(linkedClass) : null;
  const applicableTimingSet = classTimingSet || defaultTimingSet;

  // 1. Check WeekInstance first (published week snapshot)
  const weekInstance = await M.WeekInstance.findOne({
    weekStartDate: {
      $gte: new Date(dateObj.getTime() - 6 * 24 * 60 * 60 * 1000), // within the week
      $lte: dateObj
    },
    status: 'Published'
  }).lean();

  let weekTemplate = null;
  if (weekInstance?.semesterTemplateId) {
    weekTemplate = await M.SemesterTemplate.findById(weekInstance.semesterTemplateId).populate('classId').lean();
  }

  // 2. SectionTimetable for linked class (production timetable Head)
  let secTt = null;
  if (linkedClass && M.SectionTimetable && typeof M.SectionTimetable.findOne === 'function') {
    try {
      secTt = await M.SectionTimetable.findOne({ classId: linkedClass._id }).lean();
    } catch (e) {
      secTt = null;
    }
  }

  // 3. Published SemesterTemplates mirror (for this room or linked class)
  const templateQuery = {
    status: 'published',
    $or: [
      { 'grid.roomId': roomId },
      ...(hallNo ? [{ 'grid.room': hallNo }] : []),
      ...(linkedClass ? [{ classId: linkedClass._id }] : [])
    ]
  };
  const templates = await M.SemesterTemplate.find(templateQuery).populate('classId').lean();

  // Determine all teaching periods that should be in the room's daily schedule
  const allPeriods = new Set();
  const validPeriodNumbers = new Set(
    (applicableTimingSet?.periods || [])
      .filter(p => !p.isBreak && (p.periodNumber || p.number))
      .map(p => Number(p.periodNumber || p.number))
  );

  // If timing set has teaching periods, initialize with them
  if (validPeriodNumbers.size > 0) {
    validPeriodNumbers.forEach(p => allPeriods.add(p));
  } else {
    // Default fallback 1..8
    for (let p = 1; p <= 8; p++) allPeriods.add(p);
  }

  // Collect classes
  const classIds = new Set();
  templates.forEach(t => {
    if (t.classId?._id || t.classId) classIds.add(String(t.classId._id || t.classId));
  });
  if (linkedClass) classIds.add(String(linkedClass._id));
  overrides.forEach(ov => {
    if (ov.classId) classIds.add(String(ov.classId));
    if (ov.originalSlot?.classId) classIds.add(String(ov.originalSlot.classId));
    if (ov.newSlot?.classId) classIds.add(String(ov.newSlot.classId));
  });

  const classes = await M.Class.find({ _id: { $in: Array.from(classIds) } }).lean();
  const classMap = new Map(classes.map(c => [String(c._id), c]));

  const periods = [];
  const sortedPeriodNums = Array.from(allPeriods).sort((a, b) => a - b);

  for (const periodNum of sortedPeriodNums) {
    let baseSlot = null;
    let classDoc = linkedClass;
    let timingSet = applicableTimingSet;

    // 1. First try WeekInstance
    if (weekInstance) {
      const modifiedSlot = weekInstance.modifiedSlots?.find(g =>
        g.day === dayNameFromDate && slotCoversPeriod(g, periodNum) && slotMatchesRoom(g, roomId, hallNo, linkedClass)
      );
      if (modifiedSlot) {
        classDoc = weekTemplate?.classId || linkedClass;
        baseSlot = {
          classId: classDoc?._id || linkedClass?._id,
          className: classDoc?.name || modifiedSlot.section || linkedClass?.name || '',
          subjectId: modifiedSlot.subjectId,
          subjectName: modifiedSlot.subject,
          teacherTrackId: modifiedSlot.teacherTrackId,
          teacherName: modifiedSlot.teacher,
          type: modifiedSlot.type || (modifiedSlot.isLab ? 'Lab' : 'Theory'),
          isLab: Boolean(modifiedSlot.isLab || modifiedSlot.type === 'Lab'),
          span: modifiedSlot.span || 1,
          spanRootPeriod: modifiedSlot.period,
          periodNumber: periodNum,
          status: 'scheduled',
          room: modifiedSlot.room || hallNo,
          roomId: modifiedSlot.roomId || roomId
        };
      } else if (weekTemplate?.grid) {
        const slot = weekTemplate.grid.find(g =>
          g.day === dayNameFromDate && slotCoversPeriod(g, periodNum) && slotMatchesRoom(g, roomId, hallNo, linkedClass, weekTemplate.classId?._id || weekTemplate.classId)
        );
        if (slot) {
          classDoc = weekTemplate.classId || linkedClass;
          baseSlot = {
            classId: classDoc?._id || linkedClass?._id,
            className: classDoc?.name || slot.section || linkedClass?.name || '',
            subjectId: slot.subjectId,
            subjectName: slot.subject,
            teacherTrackId: slot.teacherTrackId,
            teacherName: slot.teacher,
            type: slot.type || (slot.isLab ? 'Lab' : 'Theory'),
            isLab: Boolean(slot.isLab || slot.type === 'Lab'),
            span: slot.span || 1,
            spanRootPeriod: slot.period,
            periodNumber: periodNum,
            status: 'scheduled',
            room: slot.room || hallNo,
            roomId: slot.roomId || roomId
          };
        }
      }
    }

    // 2. Try SectionTimetable Head (production timetable for linked class)
    if (!baseSlot && secTt?.slots) {
      const secSlots = Object.values(secTt.slots).filter(s => s && s.day === dayNameFromDate);
      const slot = secSlots.find(s => slotCoversPeriod(s, periodNum) && slotMatchesRoom(s, roomId, hallNo, linkedClass, secTt.classId));
      if (slot) {
        classDoc = linkedClass;
        baseSlot = {
          classId: linkedClass?._id,
          className: linkedClass?.name || slot.section || '',
          subjectId: slot.subjectId,
          subjectName: slot.subject,
          teacherTrackId: slot.teacherTrackId,
          teacherName: slot.teacher,
          type: slot.type || (slot.isLab ? 'Lab' : 'Theory'),
          isLab: Boolean(slot.isLab || slot.type === 'Lab'),
          span: slot.span || 1,
          spanRootPeriod: slot.spanRootPeriod || slot.period,
          periodNumber: periodNum,
          status: 'scheduled',
          room: slot.room || hallNo,
          roomId: slot.roomId || roomId
        };
      }
    }

    // 3. Fallback to published SemesterTemplates mirror
    if (!baseSlot) {
      for (const template of templates) {
        const tClassId = template.classId?._id || template.classId;
        const slot = (template.grid || []).find(g =>
          g.day === dayNameFromDate && slotCoversPeriod(g, periodNum) && slotMatchesRoom(g, roomId, hallNo, linkedClass, tClassId)
        );
        if (slot) {
          classDoc = template.classId || linkedClass;
          baseSlot = {
            classId: classDoc?._id || linkedClass?._id,
            className: classDoc?.name || slot.section || linkedClass?.name || '',
            subjectId: slot.subjectId,
            subjectName: slot.subject,
            teacherTrackId: slot.teacherTrackId,
            teacherName: slot.teacher,
            type: slot.type || (slot.isLab ? 'Lab' : 'Theory'),
            isLab: Boolean(slot.isLab || slot.type === 'Lab'),
            span: slot.span || 1,
            spanRootPeriod: slot.period,
            periodNumber: periodNum,
            status: 'scheduled',
            room: slot.room || hallNo,
            roomId: slot.roomId || roomId
          };
          break;
        }
      }
    }

    // 4. Try incoming overrides (room_change TO this room)
    if (!baseSlot) {
      const incomingOverride = overrides.find(ov =>
        ov.type === 'room_change' &&
        ov.newSlot &&
        ov.period === periodNum &&
        slotMatchesRoom(ov.newSlot, roomId, hallNo, linkedClass)
      );
      if (incomingOverride) {
        classDoc = classMap.get(String(incomingOverride.classId)) || await M.Class.findById(incomingOverride.classId).lean();
        if (classDoc) {
          timingSet = await getTimingSetForClass(classDoc) || applicableTimingSet;
          baseSlot = {
            classId: classDoc._id,
            className: classDoc.name || '',
            subjectId: incomingOverride.newSlot.subjectId,
            subjectName: incomingOverride.newSlot.subject || incomingOverride.newSlot.subjectName,
            teacherTrackId: incomingOverride.newSlot.teacherTrackId,
            teacherName: incomingOverride.newSlot.teacher || incomingOverride.newSlot.teacherName,
            type: incomingOverride.newSlot.type || 'Theory',
            isLab: false,
            span: 1,
            spanRootPeriod: periodNum,
            periodNumber: periodNum,
            status: 'scheduled',
            room: incomingOverride.newSlot.room || incomingOverride.newSlot.hallNo || hallNo,
            roomId: incomingOverride.newSlot.roomId || roomId
          };
        }
      }
    }

    const pLabel = applicableTimingSet?.periods?.find(p => (p.periodNumber || p.number) === periodNum)?.label || `Period ${periodNum}`;

    if (!baseSlot) {
      periods.push({
        period: periodNum,
        periodLabel: pLabel,
        isHoliday: false,
        slot: null
      });
      continue;
    }

    // Check holiday for this class
    const holidayCheck = checkClassHoliday(calDay, classDoc);
    if (holidayCheck.isHoliday) {
      periods.push({
        period: periodNum,
        periodLabel: pLabel,
        isHoliday: true,
        holidayReason: holidayCheck.reason,
        slot: null
      });
      continue;
    }

    // Apply override
    let finalSlot = baseSlot;
    const matchingOverride = overrides.find(ov =>
      ov.period === periodNum &&
      (String(ov.classId) === String(classDoc?._id) ||
        String(ov.originalSlot?.classId) === String(classDoc?._id))
    );
    if (matchingOverride) {
      finalSlot = applyOverride(baseSlot, matchingOverride, timingSet);
    }

    if (holidayCheck.isHalfDay && finalSlot.start >= holidayCheck.halfDayEnd) {
      finalSlot = { ...finalSlot, status: 'cancelled', note: 'Half-day schedule: afternoon classes cancelled' };
    }

    const resolvedSlot = buildResolvedSlot(finalSlot, applicableTimingSet, classDoc || linkedClass, !!matchingOverride);
    periods.push({
      period: periodNum,
      periodLabel: resolvedSlot.label,
      isHoliday: false,
      slot: resolvedSlot
    });
  }

  // Sort by period number
  periods.sort((a, b) => a.period - b.period);

  return {
    date: targetDateStr,
    day: dayNameFromDate,
    room: {
      id: room._id,
      hallNo: room.hallNo,
      name: room.name,
      buildingName: room.buildingName || room.buildingId?.name || '',
      floor: room.floor,
      capacity: room.capacity
    },
    linkedClass: linkedClass ? {
      id: linkedClass._id,
      name: linkedClass.name,
      section: linkedClass.section,
      batch: linkedClass.batch,
      year: linkedClass.year,
      deptName: linkedClass.deptName
    } : null,
    timingSet: applicableTimingSet,
    periods
  };
}

/**
 * Get current/next period context for a room (for board display)
 */
async function resolveRoomCurrentContext(roomId, customTime = null) {
  const { dateStr, day, hhmm: currentTime24 } = await nowParts(customTime || new Date());

  const schedule = await resolveRoomDaySchedule(roomId, dateStr);

  const timingSets = await M.TimingSet.find({}).lean();
  const defaultTimingSet = timingSets.find(ts => ts.isDefault) || timingSets[0] || null;
  const applicableTimingSet = schedule.timingSet || defaultTimingSet;
  const periods = applicableTimingSet?.periods || [];

  // Find current period
  let currentPeriod = null;
  let scheduleStatus = 'free';

  const firstSlot = periods.find(p => !p.isBreak && p.start);
  const lastSlot = [...periods].reverse().find(p => !p.isBreak && p.end);

  if (firstSlot && currentTime24 < firstSlot.start) {
    scheduleStatus = 'pre_class';
    currentPeriod = firstSlot;
  } else if (lastSlot && currentTime24 > lastSlot.end) {
    scheduleStatus = 'day_ended';
  } else {
    for (const p of periods) {
      if (currentTime24 >= p.start && currentTime24 <= p.end) {
        currentPeriod = p;
        scheduleStatus = p.isBreak ? 'break' : 'in_class';
        break;
      }
    }
  }

  // Find next non-break period
  let nextPeriod = null;
  if (currentPeriod) {
    const currentIndex = periods.findIndex(p => (p.periodNumber || p.number) === (currentPeriod.periodNumber || currentPeriod.number));
    for (let j = currentIndex + 1; j < periods.length; j++) {
      if (!periods[j].isBreak) {
        nextPeriod = periods[j];
        break;
      }
    }
  } else if (scheduleStatus === 'pre_class') {
    nextPeriod = periods.find(p => !p.isBreak && p.start);
  }

  // Find slot for current period
  let currentSlot = null;
  let nextSlot = null;

  if (currentPeriod && !currentPeriod.isBreak) {
    const periodNum = currentPeriod.periodNumber || currentPeriod.number;
    const p = schedule.periods.find(p => p.period === periodNum);
    if (p && p.slot) currentSlot = p.slot;
  }

  if (nextPeriod) {
    const nextPeriodNum = nextPeriod.periodNumber || nextPeriod.number;
    const p = schedule.periods.find(p => p.period === nextPeriodNum);
    if (p && p.slot) nextSlot = p.slot;
  }

  // Determine state for frozen contract
  let state = scheduleStatus;
  if (currentSlot && !currentPeriod?.isBreak) state = 'in_class';
  else if (currentPeriod?.isBreak) state = 'break';
  else if (schedule.periods.some(p => p.isHoliday)) state = 'holiday';

  const to12h = (timeStr) => {
    if (!timeStr) return '';
    const parts = String(timeStr).split(':');
    let h = parseInt(parts[0], 10);
    if (isNaN(h)) return timeStr;
    const m = (parts[1] || '00').slice(0, 2);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  };

  return {
    state,
    room: {
      ...schedule.room,
      linkedClass: schedule.linkedClass
    },
    linkedClass: schedule.linkedClass,
    timingSet: applicableTimingSet ? {
      id: applicableTimingSet._id,
      name: applicableTimingSet.name,
      code: applicableTimingSet.code,
      periods: applicableTimingSet.periods
    } : null,
    schedule: schedule.periods,
    period: currentPeriod ? {
      periodNumber: currentPeriod.periodNumber || currentPeriod.number,
      label: currentPeriod.label,
      start: currentPeriod.start,
      end: currentPeriod.end,
      time12: `${to12h(currentPeriod.start)} – ${to12h(currentPeriod.end)}`,
      isBreak: currentPeriod.isBreak || false
    } : null,
    slot: currentSlot,
    next: nextSlot ? {
      period: nextSlot.period,
      time12: nextSlot.time12,
      subject: nextSlot.subjectName,
      teacher: nextSlot.teacherName,
      section: nextSlot.className || schedule.linkedClass?.name || '',
      type: nextSlot.type
    } : (nextPeriod ? {
      period: nextPeriod.periodNumber || nextPeriod.number,
      time12: `${to12h(nextPeriod.start)} – ${to12h(nextPeriod.end)}`,
      subject: 'Free Period / Study',
      teacher: '--',
      section: schedule.linkedClass?.name || '',
      type: 'Self-Study'
    } : null),
    session: null,
    serverTime: new Date().toISOString()
  };
}

/**
 * Resolves authoritative daily timetable schedule for a given class and date.
 * Priority:
 * 1. DayInstance (resolved authoritative per-date daily schedule)
 * 2. Published SemesterTemplate (with fallback to approved or draft)
 * 3. SectionTimetable (production section timetable slots)
 * 4. Timetable (core timetable slots)
 * Applies Overrides (cancellations, substitute teachers, room changes).
 */
async function resolveClassDaySchedule(classId, dateStr = null, dateBounds = null, classDoc = null) {
  const targetDateStr = dateStr || await todayInInstitutionTz();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayAbbrs = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const [qY, qM, qD] = targetDateStr.split('-').map(Number);
  const dateUtc = new Date(Date.UTC(qY, qM - 1, qD, 12, 0, 0));
  const dayOfWeekIndex = dateUtc.getUTCDay();
  const dayName = dayNames[dayOfWeekIndex];
  const dayAbbr = dayAbbrs[dayOfWeekIndex];

  // Resolve Class document
  let cls = classDoc;
  if (!cls && classId) {
    cls = await M.Class.findById(classId).lean();
  }

  // Check Holiday
  const calDay = await getCalendarDay(targetDateStr);
  const holidayCheck = cls ? checkClassHoliday(calDay, cls) : { isHoliday: dayOfWeekIndex === 0, reason: dayOfWeekIndex === 0 ? 'Sunday' : null };

  // Timing Set
  const timingSet = await getTimingSetForClass(cls);

  const resolvedSlots = new Map();

  if (cls && cls._id) {
    const cId = cls._id;

    // 1. DayInstance
    const dayDoc = await M.DayInstance.findOne({ classId: cId, date: targetDateStr }).lean();
    if (dayDoc && Array.isArray(dayDoc.slots) && dayDoc.slots.length > 0) {
      dayDoc.slots.forEach(s => {
        const p = Number(s.period || s.periodNumber || 1);
        const span = Math.max(1, Number(s.span || 1));
        for (let offset = 0; offset < span; offset++) {
          const currentP = p + offset;
          resolvedSlots.set(currentP, {
            period: currentP,
            span,
            spanRootPeriod: p,
            spanIndex: offset,
            isSpanContinuation: offset > 0,
            subject: s.subject || s.subjectName || '',
            subjectCode: s.subjectCode || '',
            subjectId: s.subjectId || null,
            teacher: s.teacher || s.teacherName || '',
            teacherId: s.teacherId || null,
            teacherTrackId: s.teacherTrackId || '',
            room: s.room || '',
            roomId: s.roomId || null,
            isLab: Boolean(s.isLab),
            type: s.type || (s.isLab ? 'Lab' : 'Theory'),
            isCancelled: Boolean(s.isCancelled),
            isSubstituted: Boolean(s.isSubstituted),
            substituteTeacher: s.substituteTeacher || '',
            substituteTeacherTrackId: s.substituteTeacherTrackId || '',
            note: s.note || '',
            source: 'DayInstance'
          });
        }
      });
    }

    // 2. Published SemesterTemplate
    if (resolvedSlots.size === 0) {
      let template = await M.SemesterTemplate.findOne({
        classId: cId,
        status: 'published'
      }).lean();

      if (!template) {
        template = await M.SemesterTemplate.findOne({
          classId: cId,
          status: { $in: ['approved', 'draft'] }
        }).sort({ status: 1, updatedAt: -1 }).lean();
      }

      if (template && Array.isArray(template.grid) && template.grid.length > 0) {
        const dayGrid = template.grid.filter(s => {
          const sDay = s.day ? String(s.day).trim().toLowerCase() : '';
          return sDay === dayName.toLowerCase() || sDay === dayAbbr.toLowerCase();
        });

        dayGrid.forEach(s => {
          const p = Number(s.period || s.periodNumber || 1);
          const span = Math.max(1, Number(s.span || s.duration || 1));
          for (let offset = 0; offset < span; offset++) {
            const currentP = p + offset;
            resolvedSlots.set(currentP, {
              period: currentP,
              span,
              spanRootPeriod: p,
              spanIndex: offset,
              isSpanContinuation: offset > 0,
              subject: s.subject || s.subjectName || '',
              subjectCode: s.subjectCode || '',
              subjectId: s.subjectId || null,
              teacher: s.teacher || s.teacherName || '',
              teacherId: s.teacherId || null,
              teacherTrackId: s.teacherTrackId || '',
              room: s.room || s.hallNo || '',
              roomId: s.roomId || null,
              isLab: Boolean(s.isLab || s.type === 'Lab'),
              type: s.type || (s.isLab ? 'Lab' : 'Theory'),
              combinedWith: Array.isArray(s.combinedWith) ? s.combinedWith : [],
              activityLabel: s.activityLabel || '',
              note: s.note || '',
              source: 'SemesterTemplate'
            });
          }
        });
      }
    }

    // 3. SectionTimetable
    if (resolvedSlots.size === 0) {
      const secDoc = await M.SectionTimetable.findOne({ classId: cId }).lean();
      if (secDoc && secDoc.slots && typeof secDoc.slots === 'object') {
        Object.entries(secDoc.slots).forEach(([k, raw]) => {
          if (!raw) return;
          const sDay = raw.day ? String(raw.day).trim().toLowerCase() : '';
          if (sDay === dayName.toLowerCase() || sDay === dayAbbr.toLowerCase()) {
            const p = typeof raw.period === 'number'
              ? raw.period
              : (parseInt(String(raw.period || k).replace(/\D/g, ''), 10) || 1);
            const span = Math.max(1, Number(raw.span || raw.duration || 1));
            const rootP = Number(raw.spanRootPeriod || p);
            const isCont = Boolean(raw.isSpanContinuation || (raw.spanIndex > 0));
            const spanIdx = Number(raw.spanIndex || (p - rootP) || 0);

            resolvedSlots.set(p, {
              period: p,
              span,
              spanRootPeriod: rootP,
              spanIndex: spanIdx,
              isSpanContinuation: isCont,
              subject: raw.subject || raw.subjectName || '',
              subjectCode: raw.subjectCode || '',
              subjectId: raw.subjectId || null,
              teacher: raw.teacher || raw.teacherName || '',
              teacherId: raw.teacherId || null,
              teacherTrackId: raw.teacherTrackId || '',
              room: raw.room || raw.hallNo || '',
              roomId: raw.roomId || null,
              isLab: Boolean(raw.isLab || raw.type === 'Lab'),
              type: raw.type || (raw.isLab ? 'Lab' : 'Theory'),
              combinedWith: Array.isArray(raw.combinedWith) ? raw.combinedWith : [],
              activityLabel: raw.activityLabel || '',
              note: raw.note || '',
              source: 'SectionTimetable'
            });
          }
        });
      }
    }

    // 4. Timetable (core model)
    if (resolvedSlots.size === 0) {
      const rawTimetables = await M.Timetable.find({
        classId: cId,
        day: { $in: [dayAbbr, dayName] }
      }).sort({ start: 1 }).lean();

      if (rawTimetables && rawTimetables.length > 0) {
        rawTimetables.forEach((s, idx) => {
          const p = idx + 1;
          resolvedSlots.set(p, {
            period: p,
            span: 1,
            spanRootPeriod: p,
            spanIndex: 0,
            isSpanContinuation: false,
            subject: s.subjectName || '',
            subjectId: s.subjectId || null,
            teacher: s.teacherName || '',
            teacherTrackId: s.trackId || '',
            activityLabel: s.activityLabel || '',
            room: '',
            type: 'Theory',
            isLab: false,
            source: 'Timetable'
          });
        });
      }
    }

    // 5. Overrides for this date
    const bounds = dateBounds || await getUtcDayBounds(targetDateStr);
    const overrides = await M.Override.find({
      classId: cId,
      date: { $gte: bounds.start, $lte: bounds.end }
    }).lean();

    if (overrides && overrides.length > 0) {
      overrides.forEach(ov => {
        const p = Number(ov.period);
        const existing = resolvedSlots.get(p) || {
          period: p,
          span: 1,
          spanRootPeriod: p,
          spanIndex: 0,
          isSpanContinuation: false
        };

        if (ov.type === 'cancelled') {
          existing.isCancelled = true;
          existing.status = 'cancelled';
          existing.note = ov.reason || 'Period cancelled';
          existing.overrideId = ov._id;
        } else if (ov.type === 'substitute') {
          const newSlot = ov.newSlot || {};
          existing.isSubstituted = true;
          existing.status = 'substituted';
          existing.originalTeacher = existing.teacher;
          existing.substituteTeacher = newSlot.teacher || newSlot.teacherName || '';
          existing.substituteTeacherTrackId = newSlot.teacherTrackId || '';
          existing.teacher = newSlot.teacher || newSlot.teacherName || existing.teacher;
          existing.teacherTrackId = newSlot.teacherTrackId || existing.teacherTrackId;
          if (newSlot.subject) existing.subject = newSlot.subject;
          if (newSlot.room) existing.room = newSlot.room;
          existing.note = ov.reason || `Substitute: ${existing.teacher}`;
          existing.overrideId = ov._id;
        } else if (ov.type === 'room_change') {
          const newSlot = ov.newSlot || {};
          existing.room = newSlot.room || newSlot.hallNo || existing.room;
          existing.note = ov.reason || 'Room relocated';
          existing.overrideId = ov._id;
        }
        resolvedSlots.set(p, existing);
      });
    }
  }

  // Calculate max period
  let maxPeriod = 0;
  resolvedSlots.forEach((slot, p) => {
    if (p > maxPeriod) maxPeriod = p;
    const endP = (slot.spanRootPeriod || slot.period || p) + (slot.span || 1) - 1;
    if (endP > maxPeriod) maxPeriod = endP;
  });

  if (timingSet && Array.isArray(timingSet.periods)) {
    timingSet.periods.forEach(tp => {
      if (!tp.isBreak) {
        const pNum = Number(tp.periodNumber || tp.number || 0);
        if (pNum > maxPeriod) maxPeriod = pNum;
      }
    });
  }

  return {
    classId: cls ? cls._id : classId,
    className: cls ? cls.name : '',
    date: targetDateStr,
    dayName,
    dayAbbr,
    isHoliday: holidayCheck.isHoliday,
    holidayReason: holidayCheck.reason || '',
    timingSet,
    slots: resolvedSlots,
    maxPeriod
  };
}


/**
 * Resolves the HoD Teacher document for a given department ID.
 * Follows the 3-step resolution:
 * 1. Direct Teacher ID on dept.hodId
 * 2. Shadow User ID on dept.hodId -> match Teacher by username or trackId
 * 3. Fallback via deptId & isHod or department name & isHod
 */
async function resolveHodTeacher(deptId) {
  if (!deptId) return null;
  const dept = await M.Department.findById(deptId).lean();
  if (!dept) return null;

  if (dept.hodId) {
    // 1. Direct Teacher lookup
    const teacher = await M.Teacher.findById(dept.hodId).lean();
    if (teacher) return teacher;

    // 2. Shadow User lookup
    const user = await M.User.findById(dept.hodId).lean();
    if (user) {
      const orClauses = [];
      if (user.username) orClauses.push({ username: user.username });
      if (user.trackId) orClauses.push({ trackId: user.trackId });
      if (orClauses.length > 0) {
        const hodFromUser = await M.Teacher.findOne({ $or: orClauses }).lean();
        if (hodFromUser) return hodFromUser;
      }
    }
  }

  // 3. Fallback via deptId & isHod or department name & isHod
  const fallbackQuery = {
    $or: [
      { deptId: dept._id, isHod: true },
      { department: dept.name, isHod: true }
    ]
  };
  const fallbackHod = await M.Teacher.findOne(fallbackQuery).lean();
  return fallbackHod || null;
}

module.exports = {
  resolveRoomDaySchedule,
  resolveRoomCurrentContext,
  getTimingSetForClass,
  getPublishedTemplateSlot,
  getOverridesForRoomDate,
  getCalendarDay,
  checkClassHoliday,
  applyOverride,
  buildResolvedSlot,
  normalizeYear,
  dayFull,
  resolveClassDaySchedule,
  resolveHodTeacher
};