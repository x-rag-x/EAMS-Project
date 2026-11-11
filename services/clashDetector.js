const M = require('../models');

/**
 * Converts HH:MM string to minutes since midnight
 * @param {string} t - e.g. "08:30"
 * @returns {number} minutes
 */
function timeToMinutes(t) {
  if (!t || typeof t !== 'string') return 0;
  const parts = t.trim().split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

/**
 * Checks whether two time windows [start1, end1] and [start2, end2] overlap
 * @returns {boolean}
 */
function timesOverlap(start1, end1, start2, end2) {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);
  return s1 < e2 && s2 < e1;
}

// Fallback seed timings if DB is empty
const DEFAULT_TIMINGS = {
  SET_1: {
    code: 'SET_1',
    name: 'Timing Set 1 (Years I & IV)',
    lunchWindow: { start: '12:30', end: '13:15' },
    periods: {
      1: { start: '08:30', end: '09:15' },
      2: { start: '09:15', end: '10:00' },
      3: { start: '10:15', end: '11:00' },
      4: { start: '11:00', end: '11:45' },
      5: { start: '11:45', end: '12:30' },
      6: { start: '13:15', end: '14:00' },
      7: { start: '14:00', end: '14:45' },
      8: { start: '15:00', end: '15:45' },
      9: { start: '15:45', end: '16:30' }
    }
  },
  SET_2: {
    code: 'SET_2',
    name: 'Timing Set 2 (Years II & III)',
    lunchWindow: { start: '13:15', end: '14:00' },
    periods: {
      1: { start: '08:30', end: '09:15' },
      2: { start: '09:15', end: '10:00' },
      3: { start: '10:00', end: '10:45' },
      4: { start: '11:00', end: '11:45' },
      5: { start: '11:45', end: '12:30' },
      6: { start: '12:30', end: '13:15' },
      7: { start: '14:00', end: '14:45' },
      8: { start: '14:45', end: '15:30' },
      9: { start: '15:45', end: '16:30' }
    }
  }
};

/**
 * Determines timing set code for a class or semester template
 */
async function getTimingSetForClass(classId, year = null) {
  try {
    const mongoose = require('mongoose');
    if (year && ['2', '3', 'II', 'III'].includes(String(year).trim().toUpperCase())) {
      return DEFAULT_TIMINGS.SET_2;
    }
    if (!classId || !mongoose.connection || mongoose.connection.readyState !== 1) {
      return DEFAULT_TIMINGS.SET_1;
    }
    const cls = await M.Class.findById(classId).lean();
    if (cls) {
      const yr = String(cls.year || cls.currentYear || '').trim().toUpperCase();
      if (['2', '3', 'II', 'III'].includes(yr)) {
        return DEFAULT_TIMINGS.SET_2;
      }
      return DEFAULT_TIMINGS.SET_1;
    }
  } catch (_) {}
  return DEFAULT_TIMINGS.SET_1;
}

/**
 * Gets clock start and end time for a given slot in a timing set
 */
function getSlotClockTimes(slot, timingSet = DEFAULT_TIMINGS.SET_1) {
  if (slot.start && slot.end) {
    return { start: slot.start, end: slot.end };
  }
  const pStart = slot.period;
  const pEnd = slot.period + (slot.span || 1) - 1;
  const periodsMap = timingSet.periods || DEFAULT_TIMINGS.SET_1.periods;
  const startObj = periodsMap[pStart] || { start: '08:30' };
  const endObj = periodsMap[pEnd] || periodsMap[pStart] || { end: '09:15' };
  return {
    start: startObj.start,
    end: endObj.end
  };
}

/**
 * Returns lunch window for a class
 */
async function getLunchWindow(classId) {
  const ts = await getTimingSetForClass(classId);
  return ts.lunchWindow;
}

/**
 * Returns lab windows (clean, short-break, forbidden) for a class
 */
async function getLabWindows(classId, year = null) {
  const ts = await getTimingSetForClass(classId, year);
  if (ts.code === 'SET_2') {
    return {
      clean: [
        { periods: [1, 2, 3], start: '08:30', end: '10:45', description: 'Clean morning window (P1-P3)' },
        { periods: [4, 5, 6], start: '11:00', end: '13:15', description: 'Clean pre-lunch window (P4-P6)' }
      ],
      shortBreak: [
        { periods: [2, 3, 4], start: '09:15', end: '11:45', description: 'With morning interval (P2-P4)' },
        { periods: [3, 4, 5], start: '10:00', end: '12:30', description: 'With morning interval (P3-P5)' },
        { periods: [7, 8, 9], start: '14:00', end: '16:30', description: 'With tea interval (P7-P9)' }
      ],
      forbidden: [
        { periods: [5, 6, 7], reason: 'Straddles lunch window (13:15-14:00)' },
        { periods: [6, 7, 8], reason: 'Straddles lunch window (13:15-14:00)' }
      ]
    };
  }
  return {
    clean: [
      { periods: [3, 4, 5], start: '10:15', end: '12:30', description: 'Clean mid-day window (P3-P5)' }
    ],
    shortBreak: [
      { periods: [1, 2, 3], start: '08:30', end: '11:00', description: 'With morning interval (P1-P3)' },
      { periods: [2, 3, 4], start: '09:15', end: '11:45', description: 'With morning interval (P2-P4)' },
      { periods: [6, 7, 8], start: '13:15', end: '15:45', description: 'With tea interval (P6-P8)' },
      { periods: [7, 8, 9], start: '14:00', end: '16:30', description: 'With tea interval (P7-P9)' }
    ],
    forbidden: [
      { periods: [4, 5, 6], reason: 'Straddles lunch window (12:30-13:15)' },
      { periods: [5, 6, 7], reason: 'Straddles lunch window (12:30-13:15)' }
    ]
  };
}

/**
 * Checks whether an assigned slot straddles the lunch window
 */
function doesStraddleLunch(startTime, endTime, lunchWindow) {
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  const ls = timeToMinutes(lunchWindow.start);
  const le = timeToMinutes(lunchWindow.end);
  return s < le && e > ls;
}

/**
 * Check teacher clash by clock time
 */
async function checkTeacherClash({
  teacherId,
  teacherTrackId,
  teacherName,
  day,
  startTime,
  endTime,
  excludeClassId = null,
  excludeTemplateId = null,
  env = 'development'
}) {
  const conflicts = [];
  if (!day || !startTime || !endTime) return { clash: false, conflicts };
  if (!teacherId && !teacherTrackId && !teacherName) return { clash: false, conflicts };

  const targetStatuses = env === 'production'
    ? ['published']
    : ['draft', 'pending_approval', 'published'];

  const query = {
    status: { $in: targetStatuses },
    'grid.day': day
  };
  if (excludeTemplateId) query._id = { $ne: excludeTemplateId };
  if (excludeClassId) query.classId = { $ne: excludeClassId };

  const templates = await M.SemesterTemplate.find(query).populate('classId').lean();

  for (const tpl of templates) {
    const classTimingSet = await getTimingSetForClass(tpl.classId?._id || tpl.classId);
    for (const g of (tpl.grid || [])) {
      if (g.day !== day) continue;

      const isSameTeacher = (
        (teacherId && g.teacherId && String(g.teacherId) === String(teacherId)) ||
        (teacherTrackId && g.teacherTrackId && g.teacherTrackId === teacherTrackId) ||
        (teacherName && g.teacher && g.teacher.trim().toLowerCase() === teacherName.trim().toLowerCase())
      );
      if (!isSameTeacher) continue;

      const gClock = getSlotClockTimes(g, classTimingSet);
      if (timesOverlap(startTime, endTime, gClock.start, gClock.end)) {
        conflicts.push({
          kind: 'faculty',
          message: `Faculty overlap: ${teacherName || g.teacher} is busy in ${tpl.className || 'another class'} (${gClock.start}–${gClock.end}) on ${day}`,
          class: tpl.className,
          slot: g,
          clockTime: gClock
        });
      }
    }
  }

  return {
    clash: conflicts.length > 0,
    conflicts
  };
}

/**
 * Check room clash by clock time
 */
async function checkRoomClash({
  roomId,
  roomName,
  day,
  startTime,
  endTime,
  excludeClassId = null,
  excludeTemplateId = null,
  env = 'development'
}) {
  const conflicts = [];
  if (!day || !startTime || !endTime) return { clash: false, conflicts };
  if (!roomId && !roomName) return { clash: false, conflicts };

  const targetStatuses = env === 'production'
    ? ['published']
    : ['draft', 'pending_approval', 'published'];

  const query = {
    status: { $in: targetStatuses },
    'grid.day': day
  };
  if (excludeTemplateId) query._id = { $ne: excludeTemplateId };
  if (excludeClassId) query.classId = { $ne: excludeClassId };

  const templates = await M.SemesterTemplate.find(query).populate('classId').lean();

  for (const tpl of templates) {
    const classTimingSet = await getTimingSetForClass(tpl.classId?._id || tpl.classId);
    for (const g of (tpl.grid || [])) {
      if (g.day !== day) continue;

      const isSameRoom = (
        (roomId && g.roomId && String(g.roomId) === String(roomId)) ||
        (roomName && g.room && g.room.trim().toLowerCase() === roomName.trim().toLowerCase())
      );
      if (!isSameRoom) continue;

      const gClock = getSlotClockTimes(g, classTimingSet);
      if (timesOverlap(startTime, endTime, gClock.start, gClock.end)) {
        conflicts.push({
          kind: 'room',
          message: `Room conflict: ${roomName || g.room} is occupied by ${tpl.className || 'another class'} (${gClock.start}–${gClock.end}) on ${day}`,
          class: tpl.className,
          slot: g,
          clockTime: gClock
        });
      }
    }
  }

  return {
    clash: conflicts.length > 0,
    conflicts
  };
}

module.exports = {
  timeToMinutes,
  timesOverlap,
  DEFAULT_TIMINGS,
  getTimingSetForClass,
  getSlotClockTimes,
  getLunchWindow,
  getLabWindows,
  doesStraddleLunch,
  checkTeacherClash,
  checkRoomClash,
};
