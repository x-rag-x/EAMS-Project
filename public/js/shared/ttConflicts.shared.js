/**
 * public/js/shared/ttConflicts.shared.js
 *
 * Shared Conflict Detection Engine (Phase 6, N26):
 * UMD Module running identically in Browser (<script>) and Server (require).
 *
 * Calculates CLOCK-TIME minutes from midnight, NOT arbitrary period numbers.
 * Resolves staggered timing sets (SET_1 vs SET_2) with zero false-positive clashes.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TTConflicts = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_TIMING_SETS = [
    {
      code: 'SET_1',
      name: 'Timing Set 1 (Years I & IV)',
      applicableYears: ['1', '4', 'I', 'IV'],
      morningBreakAfter: 2,
      lunchAfter: 5,
      isDefault: true,
      periods: [
        { periodNumber: 1, number: 1, start: '08:30', end: '09:15', isBreak: false, type: 'period' },
        { periodNumber: 2, number: 2, start: '09:15', end: '10:00', isBreak: false, type: 'period' },
        { periodNumber: 0, number: 0, start: '10:00', end: '10:15', isBreak: true, type: 'break' },
        { periodNumber: 3, number: 3, start: '10:15', end: '11:00', isBreak: false, type: 'period' },
        { periodNumber: 4, number: 4, start: '11:00', end: '11:45', isBreak: false, type: 'period' },
        { periodNumber: 5, number: 5, start: '11:45', end: '12:30', isBreak: false, type: 'period' },
        { periodNumber: 0, number: 0, start: '12:30', end: '13:15', isBreak: true, type: 'lunch' },
        { periodNumber: 6, number: 6, start: '13:15', end: '14:00', isBreak: false, type: 'period' },
        { periodNumber: 7, number: 7, start: '14:00', end: '14:45', isBreak: false, type: 'period' },
        { periodNumber: 0, number: 0, start: '14:45', end: '15:00', isBreak: true, type: 'tea' },
        { periodNumber: 8, number: 8, start: '15:00', end: '15:45', isBreak: false, type: 'period' },
        { periodNumber: 9, number: 9, start: '15:45', end: '16:30', isBreak: false, type: 'period' }
      ]
    },
    {
      code: 'SET_2',
      name: 'Timing Set 2 (Years II & III)',
      applicableYears: ['2', '3', 'II', 'III'],
      morningBreakAfter: 3,
      lunchAfter: 6,
      isDefault: false,
      periods: [
        { periodNumber: 1, number: 1, start: '08:30', end: '09:15', isBreak: false, type: 'period' },
        { periodNumber: 2, number: 2, start: '09:15', end: '10:00', isBreak: false, type: 'period' },
        { periodNumber: 3, number: 3, start: '10:00', end: '10:45', isBreak: false, type: 'period' },
        { periodNumber: 0, number: 0, start: '10:45', end: '11:00', isBreak: true, type: 'break' },
        { periodNumber: 4, number: 4, start: '11:00', end: '11:45', isBreak: false, type: 'period' },
        { periodNumber: 5, number: 5, start: '11:45', end: '12:30', isBreak: false, type: 'period' },
        { periodNumber: 6, number: 6, start: '12:30', end: '13:15', isBreak: false, type: 'period' },
        { periodNumber: 0, number: 0, start: '13:15', end: '14:00', isBreak: true, type: 'lunch' },
        { periodNumber: 7, number: 7, start: '14:00', end: '14:45', isBreak: false, type: 'period' },
        { periodNumber: 8, number: 8, start: '14:45', end: '15:30', isBreak: false, type: 'period' },
        { periodNumber: 0, number: 0, start: '15:30', end: '15:45', isBreak: true, type: 'tea' },
        { periodNumber: 9, number: 9, start: '15:45', end: '16:30', isBreak: false, type: 'period' }
      ]
    }
  ];

  /**
   * Converts "HH:MM" (e.g. "08:30") to total minutes from midnight (510).
   */
  function parseMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const parts = timeStr.trim().split(':');
    if (parts.length < 2) return 0;
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    return hours * 60 + minutes;
  }

  /**
   * Formats minutes from midnight to "HH:MM".
   */
  function formatMinutes(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /**
   * Calculates startMin and endMin for a slot based on timing set.
   */
  function getSlotInterval(slot, timingSet) {
    const day = String(slot.day || 'Monday').trim();
    const periodNum = Number(slot.period || 1);
    const span = Math.max(1, Number(slot.span || 1));
    const periods = timingSet?.periods || [];

    const startPeriod = periods.find(p => !p.isBreak && (p.periodNumber === periodNum || p.number === periodNum));
    const endPeriodNum = periodNum + span - 1;
    const endPeriod = periods.find(p => !p.isBreak && (p.periodNumber === endPeriodNum || p.number === endPeriodNum));

    let startMin = 0;
    let endMin = 0;

    if (startPeriod && startPeriod.start) {
      startMin = parseMinutes(startPeriod.start);
    } else {
      startMin = 510 + (periodNum - 1) * 50;
    }

    if (endPeriod && endPeriod.end) {
      endMin = parseMinutes(endPeriod.end);
    } else {
      endMin = startMin + span * 45;
    }

    return { day, period: periodNum, span, startMin, endMin };
  }

  /**
   * Checks if two time intervals overlap on the same day.
   */
  function intervalsOverlap(a, b) {
    if (String(a.day || '').toLowerCase() !== String(b.day || '').toLowerCase()) return false;
    return a.startMin < b.endMin && b.startMin < a.endMin;
  }

  /**
   * Detects whether two slots conflict in time and resource (faculty or room).
   */
  function detectSlotClash(slotA, timingSetA, slotB, timingSetB) {
    // Exempt combined classes
    if (slotA.combinedGroupId && slotB.combinedGroupId && String(slotA.combinedGroupId) === String(slotB.combinedGroupId)) {
      return { clash: false };
    }

    const intA = getSlotInterval(slotA, timingSetA);
    const intB = getSlotInterval(slotB, timingSetB);

    if (!intervalsOverlap(intA, intB)) {
      return { clash: false };
    }

    // Check Faculty clash
    const teacherA = String(slotA.teacherId || slotA.teacher || '').trim();
    const teacherB = String(slotB.teacherId || slotB.teacher || '').trim();
    if (teacherA && teacherB && (teacherA === teacherB || (slotA.teacher && slotB.teacher && slotA.teacher.toLowerCase() === slotB.teacher.toLowerCase()))) {
      return {
        clash: true,
        kind: 'faculty',
        message: `Faculty clash: ${slotA.teacher || 'Faculty'} is double-booked between ${formatMinutes(intA.startMin)}–${formatMinutes(intA.endMin)} and ${formatMinutes(intB.startMin)}–${formatMinutes(intB.endMin)}`
      };
    }

    // Check Room clash
    const roomA = String(slotA.roomId || slotA.room || '').trim();
    const roomB = String(slotB.roomId || slotB.room || '').trim();
    if (roomA && roomB && (roomA === roomB || (slotA.room && slotB.room && slotA.room.toLowerCase() === slotB.room.toLowerCase()))) {
      return {
        clash: true,
        kind: 'room',
        message: `Room clash: Room ${slotA.room || 'Facility'} is double-booked between ${formatMinutes(intA.startMin)}–${formatMinutes(intA.endMin)} and ${formatMinutes(intB.startMin)}–${formatMinutes(intB.endMin)}`
      };
    }

    return { clash: false };
  }

  return {
    DEFAULT_TIMING_SETS,
    parseMinutes,
    formatMinutes,
    getSlotInterval,
    intervalsOverlap,
    detectSlotClash
  };
}));
