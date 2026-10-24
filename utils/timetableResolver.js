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

function normalizeYear(yr) {
  if (!yr) return '';
  const s = String(yr).trim();
  if (TO_ROMAN[s]) return TO_ROMAN[s];
  return s.toUpperCase();
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
  const sets = await M.TimingSet.find({}).lean();
  if (!sets || !sets.length) return null;
  if (classDoc && classDoc.year) {
    const yrStr = String(classDoc.year).trim();
    const yrRoman = normalizeYear(yrStr);
    const match = sets.find(ts => {
      const app = (ts.applicableYears || []).map(y => String(y).trim());
      return app.includes(yrStr) || app.includes(yrRoman) || app.includes(String(yrStr));
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
  const modifiedSlot = weekInstance.modifiedSlots?.find(g =>
    g.day === dayName &&
    g.period === periodNumber &&
    (String(g.roomId) === String(roomId) || g.room === hallNo)
  );

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

  const slot = template.grid?.find(g =>
    g.day === dayName &&
    g.period === periodNumber &&
    (String(g.roomId) === String(roomId) || g.room === hallNo)
  );

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
 * Resolve the published template slot for a room on a given day/period
 * (fallback when no WeekInstance exists)
 */
async function getPublishedTemplateSlot(roomId, hallNo, dayName, periodNumber) {
  const template = await M.SemesterTemplate.findOne({
    status: 'published',
    'grid.day': dayName,
    'grid.period': periodNumber,
    $or: [
      { 'grid.roomId': roomId },
      { 'grid.room': hallNo }
    ]
  }).populate('classId').lean();

  if (!template) return null;

  const slot = template.grid.find(g =>
    g.day === dayName &&
    g.period === periodNumber &&
    (String(g.roomId) === String(roomId) || g.room === hallNo)
  );

  if (!slot) return null;

  // Log warning if matched by hallNo instead of roomId (migration fallback)
  const matchedByRoomId = String(slot.roomId) === String(roomId);
  if (!matchedByRoomId && slot.room === hallNo) {
    console.warn(`[TimetableResolver] HallNo fallback match: roomId=${roomId}, hallNo=${hallNo}, period=${periodNumber}, day=${dayName}`);
  }

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
    originalRoomId: slot.roomId
  };
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
  const span = baseSlot.span || 1;

  // Get period timing from timing set
  let start = '08:30';
  let end = '09:15';
  let label = `Period ${periodNum}`;
  if (timingSet && Array.isArray(timingSet.periods)) {
    const pStartObj = timingSet.periods.find(p => p.periodNumber === periodNum || p.number === periodNum);
    const pEndObj = timingSet.periods.find(p => p.periodNumber === (periodNum + span - 1) || p.number === (periodNum + span - 1));
    if (pStartObj?.start) start = pStartObj.start;
    if (pEndObj?.end) end = pEndObj.end;
    if (pStartObj?.label) label = pStartObj.label;
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
    subjectName: baseSlot.subjectName || '',
    teacherTrackId: baseSlot.teacherTrackId || '',
    teacherName: baseSlot.teacherName || '',
    isSubstitute: baseSlot.isSubstitute || false,
    originalTeacherName: baseSlot.originalTeacher || null,
    period: periodNum,
    span,
    start,
    end,
    time12: `${to12h(start)} – ${to12h(end)}`,
    label,
    type: baseSlot.type || 'Theory',
    status: baseSlot.status || 'scheduled',
    note: baseSlot.note || '',
    overrideId: baseSlot.overrideId || null
  };
}

/**
 * Main resolver: Get resolved schedule for a room on a specific date
 * Returns array of periods with resolved slots (or null for free periods)
 * Priority: Calendar Holiday → Override (room_change/substitute/cancelled) → Week Instance → Published Template
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

  // Get overrides for this room/date
  const overrides = await getOverridesForRoomDate(roomId, hallNo, targetDateStr);

  // Get timing sets
  const timingSets = await M.TimingSet.find({}).lean();
  const defaultTimingSet = timingSets.find(ts => ts.isDefault) || timingSets[0] || null;

  // Get ALL unique periods that could have slots for this room on this day
  // We need to check both WeekInstance and Template to get the full set of periods
  const allPeriods = new Set();

  // 1. Check WeekInstance first (published week snapshot)
  const weekInstance = await M.WeekInstance.findOne({
    weekStartDate: {
      $gte: new Date(dateObj.getTime() - 6 * 24 * 60 * 60 * 1000), // within the week
      $lte: dateObj
    },
    status: 'Published'
  }).lean();

  if (weekInstance) {
    // Check modifiedSlots
    (weekInstance.modifiedSlots || []).forEach(g => {
      if (g.day === dayNameFromDate && (String(g.roomId) === String(roomId) || g.room === hallNo)) {
        allPeriods.add(g.period);
      }
    });
    // Check base template slots if weekInstance has semesterTemplateId
    if (weekInstance.semesterTemplateId) {
      const template = await M.SemesterTemplate.findById(weekInstance.semesterTemplateId).populate('classId').lean();
      if (template) {
        template.grid.forEach(g => {
          if (g.day === dayNameFromDate && (String(g.roomId) === String(roomId) || g.room === hallNo)) {
            allPeriods.add(g.period);
          }
        });
      }
    }
  }

  // 2. Also check published templates (fallback)
  const templates = await M.SemesterTemplate.find({
    status: 'published',
    'grid.day': dayNameFromDate,
    $or: [
      { 'grid.roomId': roomId },
      { 'grid.room': hallNo }
    ]
  }).populate('classId').lean();

  templates.forEach(t => {
    t.grid.forEach(g => {
      if (g.day === dayNameFromDate && (String(g.roomId) === String(roomId) || g.room === hallNo)) {
        allPeriods.add(g.period);
      }
    });
  });

  // 3. Check incoming overrides (room_change TO this room)
  overrides.filter(ov =>
    ov.type === 'room_change' &&
    ov.newSlot &&
    (String(ov.newSlot.roomId) === String(roomId) || ov.newSlot.room === hallNo)
  ).forEach(ov => {
    if (ov.period) allPeriods.add(ov.period);
  });

  // Collect all unique class IDs from templates and overrides
  const classIds = new Set();
  templates.flatMap(t => t.grid
    .filter(g => g.day === dayNameFromDate && (String(g.roomId) === String(roomId) || g.room === hallNo))
    .map(g => g.classId)
    .filter(Boolean)
  ).forEach(id => classIds.add(String(id)));

  overrides.forEach(ov => {
    if (ov.classId) classIds.add(String(ov.classId));
    if (ov.originalSlot?.classId) classIds.add(String(ov.originalSlot.classId));
    if (ov.newSlot?.classId) classIds.add(String(ov.newSlot.classId));
  });

  const classes = await M.Class.find({ _id: { $in: Array.from(classIds) } }).lean();
  const classMap = new Map(classes.map(c => [String(c._id), c]));

  const periods = [];

  // Process each period that has a slot
  for (const periodNum of allPeriods) {
    // For each period, we need to find the base slot (from WeekInstance or Template)
    let baseSlot = null;
    let classDoc = null;
    let timingSet = defaultTimingSet;
    let fromWeekInstance = false;

    // First try WeekInstance
    if (weekInstance) {
      // Check modifiedSlots first
      const modifiedSlot = weekInstance.modifiedSlots?.find(g =>
        g.day === dayNameFromDate &&
        g.period === periodNum &&
        (String(g.roomId) === String(roomId) || g.room === hallNo)
      );

      if (modifiedSlot) {
        fromWeekInstance = true;
        if (weekInstance.semesterTemplateId) {
          const template = await M.SemesterTemplate.findById(weekInstance.semesterTemplateId).populate('classId').lean();
          if (template) {
            classDoc = template.classId;
            timingSet = await getTimingSetForClass(classDoc) || defaultTimingSet;
          }
        }
        baseSlot = {
          classId: classDoc?._id,
          className: classDoc?.name || modifiedSlot.section || '',
          subjectId: modifiedSlot.subjectId,
          subjectName: modifiedSlot.subject,
          teacherTrackId: modifiedSlot.teacherTrackId,
          teacherName: modifiedSlot.teacher,
          type: modifiedSlot.type || 'Theory',
          isLab: modifiedSlot.isLab || false,
          span: modifiedSlot.span || 1,
          periodNumber: periodNum,
          status: 'scheduled',
          room: modifiedSlot.room,
          roomId: modifiedSlot.roomId
        };
      } else if (weekInstance.semesterTemplateId) {
        // Fall back to base template in WeekInstance
        const template = await M.SemesterTemplate.findById(weekInstance.semesterTemplateId).populate('classId').lean();
        if (template) {
          const slot = template.grid?.find(g =>
            g.day === dayNameFromDate &&
            g.period === periodNum &&
            (String(g.roomId) === String(roomId) || g.room === hallNo)
          );
          if (slot) {
            fromWeekInstance = true;
            classDoc = template.classId;
            timingSet = await getTimingSetForClass(classDoc) || defaultTimingSet;
            baseSlot = {
              classId: classDoc?._id,
              className: classDoc?.name || slot.section || '',
              subjectId: slot.subjectId,
              subjectName: slot.subject,
              teacherTrackId: slot.teacherTrackId,
              teacherName: slot.teacher,
              type: slot.type || 'Theory',
              isLab: slot.isLab || false,
              span: slot.span || 1,
              periodNumber: periodNum,
              status: 'scheduled',
              room: slot.room,
              roomId: slot.roomId
            };
          }
        }
      }
    }

    // If not found in WeekInstance, try published template
    if (!baseSlot) {
      for (const template of templates) {
        const slot = template.grid.find(g =>
          g.day === dayNameFromDate &&
          g.period === periodNum &&
          (String(g.roomId) === String(roomId) || g.room === hallNo)
        );
        if (slot) {
          classDoc = template.classId;
          timingSet = await getTimingSetForClass(classDoc) || defaultTimingSet;
          baseSlot = {
            classId: classDoc?._id,
            className: classDoc?.name || slot.section || '',
            subjectId: slot.subjectId,
            subjectName: slot.subject,
            teacherTrackId: slot.teacherTrackId,
            teacherName: slot.teacher,
            type: slot.type || 'Theory',
            isLab: slot.isLab || false,
            span: slot.span || 1,
            periodNumber: periodNum,
            status: 'scheduled',
            room: slot.room,
            roomId: slot.roomId
          };
          break;
        }
      }
    }

    // If still no base slot, check incoming overrides
    if (!baseSlot) {
      const incomingOverride = overrides.find(ov =>
        ov.type === 'room_change' &&
        ov.newSlot &&
        ov.period === periodNum &&
        (String(ov.newSlot.roomId) === String(roomId) || ov.newSlot.room === hallNo)
      );
      if (incomingOverride) {
        classDoc = classMap.get(String(incomingOverride.classId)) || await M.Class.findById(incomingOverride.classId).lean();
        if (classDoc) {
          timingSet = await getTimingSetForClass(classDoc) || defaultTimingSet;
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
            periodNumber: periodNum,
            status: 'scheduled',
            room: incomingOverride.newSlot.room || incomingOverride.newSlot.hallNo,
            roomId: incomingOverride.newSlot.roomId
          };
        }
      }
    }

    if (!baseSlot) continue; // No slot for this period

    // Check holiday for this class
    const holidayCheck = checkClassHoliday(calDay, classDoc);
    if (holidayCheck.isHoliday) {
      periods.push({
        period: periodNum,
        periodLabel: timingSet?.periods?.find(p => p.periodNumber === periodNum || p.number === periodNum)?.label || `Period ${periodNum}`,
        isHoliday: true,
        holidayReason: holidayCheck.reason,
        slot: null
      });
      continue;
    }

    // Apply override (check both originalSlot and newSlot for room match)
    let finalSlot = baseSlot;
    const matchingOverride = overrides.find(ov =>
      ov.period === periodNum &&
      (String(ov.classId) === String(classDoc._id) ||
        String(ov.originalSlot?.classId) === String(classDoc._id))
    );
    if (matchingOverride) {
      finalSlot = applyOverride(baseSlot, matchingOverride, timingSet);
    }

    // Check half-day
    if (holidayCheck.isHalfDay && finalSlot.start >= holidayCheck.halfDayEnd) {
      finalSlot = { ...finalSlot, status: 'cancelled', note: 'Half-day schedule: afternoon classes cancelled' };
    }

    const resolvedSlot = buildResolvedSlot(finalSlot, timingSet, classDoc, !!matchingOverride);
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
    periods
  };
}

/**
 * Get current/next period context for a room (for board display)
 */
async function resolveRoomCurrentContext(roomId, customTime = null) {
  const { dateStr, day, hhmm: currentTime24 } = await nowParts(customTime || new Date());

  const schedule = await resolveRoomDaySchedule(roomId, dateStr);

  // Get timing set for current period detection
  const timingSets = await M.TimingSet.find({}).lean();
  const defaultTimingSet = timingSets.find(ts => ts.isDefault) || timingSets[0] || null;
  const periods = defaultTimingSet?.periods || [];

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

  return {
    state,
    room: schedule.room,
    period: currentPeriod ? {
      periodNumber: currentPeriod.periodNumber || currentPeriod.number,
      label: currentPeriod.label,
      start: currentPeriod.start,
      end: currentPeriod.end,
      time12: `${currentPeriod.start} – ${currentPeriod.end}`,
      isBreak: currentPeriod.isBreak || false
    } : null,
    slot: currentSlot,
    next: nextSlot ? {
      period: nextSlot.period,
      time12: nextSlot.time12,
      subject: nextSlot.subjectName,
      teacher: nextSlot.teacherName,
      section: '',
      type: nextSlot.type
    } : null,
    session: null,
    serverTime: new Date().toISOString()
  };
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
  dayFull
};