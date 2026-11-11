/**
 * services/timetableConflicts.js
 *
 * Conflict Engine v2 for EAMS Timetable v3 (Section 8):
 * - Compares clock-time intervals and entity IDs, not period numbers and strings (F8 fix).
 * - Multi-timing sets (SET_1 vs SET_2) back-to-back periods (e.g. Set 1 P6 vs Set 2 P6) no longer clash.
 * - Three layers (D11):
 *     L0: Same workspace (every other class draft and within the same class) -> HARD
 *     L1: Production Head of classes NOT in this workspace -> HARD
 *     L2: Class drafts in other open workspaces -> SOFT (informational)
 * - Combined sessions exempt ONLY when sharing combinedGroupId.
 * - Check kinds: faculty, room, room_unavailable, capacity, lab_span, span_crosses_break, unresolved_ids, scope, quota.
 * - HoD clash notifications with 24-hour deduplication and auto-solve (D4, D20).
 */

'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const M = require('../models');
const { resolveHodTeacher } = require('../utils/timetableResolver');
const { checkRoomEligibility } = require('./roomEligibility');

// ── Default Timing Sets Seed for Unit Tests / Standalone Environments ──

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

// ── Time & Clock Utilities ──

/**
 * Converts "HH:MM" (e.g. "08:30") to total minutes from midnight (e.g. 510).
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
 * Calculates startMin and endMin for a slot based on class's timing set.
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
    // Fallback: 50 min periods starting 08:30
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
 * Checks if two intervals overlap on the same day.
 */
function intervalsOverlap(a, b) {
  if (a.day.toLowerCase() !== b.day.toLowerCase()) return false;
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/**
 * Generates deterministic deduplication key for HoD clash notifications.
 */
function generateDedupeKey(workspaceId, classId, otherClassId, kind, day, startMin) {
  const raw = `${String(workspaceId || '')}|${String(classId || '')}|${String(otherClassId || 'self')}|${kind}|${day}|${startMin}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

// ── Timing Set Resolver Helper ──

async function resolveTimingSets() {
  try {
    const q = M.TimingSet.find({});
    const res = typeof q?.lean === 'function' ? q.lean() : q;
    const dbSets = await Promise.race([
      res,
      new Promise(resolve => setTimeout(() => resolve(null), 200))
    ]);
    if (dbSets && dbSets.length > 0) return dbSets;
  } catch (_) {}
  return DEFAULT_TIMING_SETS;
}

function matchTimingSetForClass(cls, timingSets) {
  if (!timingSets || !timingSets.length) return DEFAULT_TIMING_SETS[0];

  // 1. Explicit timingSetCode or timingSetId on class
  if (cls?.timingSetCode) {
    const direct = timingSets.find(ts => ts.code === cls.timingSetCode);
    if (direct) return direct;
  }
  if (cls?.timingSetId) {
    const direct = timingSets.find(ts => String(ts._id) === String(cls.timingSetId));
    if (direct) return direct;
  }

  // 2. Class year match
  const yr = String(cls?.year || '').trim().toUpperCase();
  if (yr) {
    const match = timingSets.find(ts => {
      const app = (ts.applicableYears || []).map(y => String(y).trim().toUpperCase());
      return app.includes(yr);
    });
    if (match) return match;
  }

  // 3. Name heuristics
  const name = String(cls?.name || '').toUpperCase();
  if (/\b(II|III|2ND|3RD|Y2|Y3)\b/i.test(name)) {
    const s2 = timingSets.find(ts => ts.code === 'SET_2');
    if (s2) return s2;
  }
  if (/\b(I|IV|1ST|4TH|Y1|Y4)\b/i.test(name)) {
    const s1 = timingSets.find(ts => ts.code === 'SET_1');
    if (s1) return s1;
  }

  return timingSets.find(ts => ts.isDefault) || timingSets[0] || DEFAULT_TIMING_SETS[0];
}

// ── Canonical Conflict Engine v2 ──

/**
 * Detects conflicts across Layers L0, L1, and L2 with clock-time precision.
 *
 * @param {Object} params
 * @param {string|ObjectId} params.workspaceId - Target workspace
 * @param {Array<string|ObjectId>} [params.classIds] - Optional class filter
 * @param {Map<string, Array>|Object} [params.targetGrids] - Optional in-memory grids to check
 * @param {boolean} [params.checkUnresolved=false] - Whether to flag missing IDs as hard conflicts
 * @returns {Promise<Array<Object>>} List of conflict objects
 */
async function detectConflictsV2({
  workspaceId,
  classIds = [],
  targetGrids = null,
  checkUnresolved = false
} = {}) {
  const conflicts = [];

  // 1. Load Workspace
  let ws = null;
  if (workspaceId && M.TimetableWorkspace) {
    try {
      if (mongoose.isValidObjectId(workspaceId)) {
        const q = M.TimetableWorkspace.findById(workspaceId);
        const res = typeof q?.lean === 'function' ? q.lean() : q;
        ws = await Promise.race([
          res,
          new Promise(resolve => setTimeout(() => resolve(null), 50))
        ]);
      }
      if (!ws) {
        const q = M.TimetableWorkspace.findOne({ trackId: String(workspaceId) });
        const res = typeof q?.lean === 'function' ? q.lean() : q;
        ws = await Promise.race([
          res,
          new Promise(resolve => setTimeout(() => resolve(null), 50))
        ]);
      }
    } catch (_) {}
  }

  const timingSets = await resolveTimingSets();

  // 2. Resolve Active Classes in Workspace
  const filterClassIds = (Array.isArray(classIds) ? classIds : [classIds])
    .filter(Boolean)
    .map(String);

  let targetClassList = [];
  if (ws) {
    const candidateIds = new Set((ws.classIds || []).map(String));
    if (targetGrids) {
      targetClassList = Array.from(candidateIds);
    } else if (filterClassIds.length > 0) {
      targetClassList = filterClassIds;
    } else {
      targetClassList = Array.from(candidateIds);
    }
  } else if (filterClassIds.length > 0) {
    targetClassList = filterClassIds;
  }

  // Load Class documents
  let classDocs = [];
  try {
    const q = M.Class.find({
      _id: { $in: targetClassList.map(id => mongoose.isValidObjectId(id) ? id : null).filter(Boolean) }
    });
    const res = typeof q?.lean === 'function' ? q.lean() : q;
    classDocs = (await Promise.race([
      res,
      new Promise(resolve => setTimeout(() => resolve([]), 50))
    ])) || [];
  } catch (_) {}
  const classDocMap = new Map((classDocs || []).map(c => [String(c._id), c]));

  // Load Room documents to check availability and capacity
  let roomDocs = [];
  try {
    const q = M.Room.find({});
    if (typeof q?.lean === 'function') {
      roomDocs = await q.lean();
    } else if (typeof q?.select === 'function') {
      const sq = q.select('hallNo name category type capacity buildingName');
      roomDocs = typeof sq?.lean === 'function' ? await sq.lean() : await sq;
    }
  } catch (_) {}
  const roomDocMap = new Map();
  for (const r of (roomDocs || [])) {
    if (r._id) roomDocMap.set(String(r._id), r);
    if (r.hallNo) roomDocMap.set(r.hallNo.trim().toLowerCase(), r);
    if (r.name) roomDocMap.set(r.name.trim().toLowerCase(), r);
  }

  // Pre-load TeacherAvailability constraints
  let teacherAvailDocs = [];
  try {
    if (M.TeacherAvailability && typeof M.TeacherAvailability.find === 'function') {
      const q = M.TeacherAvailability.find({});
      teacherAvailDocs = (typeof q?.lean === 'function' ? await q.lean() : await q) || [];
    }
  } catch (_) {}
  const teacherAvailMap = new Map();
  for (const ta of (teacherAvailDocs || [])) {
    if (ta.teacherId) teacherAvailMap.set(String(ta.teacherId), ta);
  }

  // Pre-load all workspace class drafts at once
  const draftMap = new Map();
  if (ws && M.WorkspaceClassDraft) {
    try {
      const q = M.WorkspaceClassDraft.find({ workspaceId: ws._id });
      const drafts = typeof q?.lean === 'function' ? await q.lean() : await q;
      if (Array.isArray(drafts)) {
        drafts.forEach(d => draftMap.set(String(d.classId), d));
      }
    } catch (_) {}
  }

  // 3. Assemble Workspace Draft Slots (Layer L0 items)
  // Maps classId -> Array<{ slot, interval, classDoc, timingSet }>
  const l0ItemsByClass = new Map();
  const allL0Items = [];

  for (const cId of targetClassList) {
    let grid = null;
    if (targetGrids && (targetGrids.get ? targetGrids.get(cId) : targetGrids[cId])) {
      grid = targetGrids.get ? targetGrids.get(cId) : targetGrids[cId];
    } else if (draftMap.has(cId)) {
      const draft = draftMap.get(cId);
      if (draft && Array.isArray(draft.grid)) grid = draft.grid;
    }

    if (!grid && ws && M.WorkspaceClassDraft && typeof M.WorkspaceClassDraft.findOne === 'function') {
      try {
        const q = M.WorkspaceClassDraft.findOne({ workspaceId: ws._id, classId: cId });
        const res = typeof q?.lean === 'function' ? q.lean() : q;
        const draft = await Promise.race([
          res,
          new Promise(resolve => setTimeout(() => resolve(null), 50))
        ]);
        if (draft && Array.isArray(draft.grid)) grid = draft.grid;
      } catch (_) {}
    }

    if (!grid && classDocMap.has(cId)) {
      // Fallback to production SectionTimetable if not drafted yet
      try {
        const q = M.SectionTimetable.findOne({ classId: cId });
        const res = typeof q?.lean === 'function' ? q.lean() : q;
        const sec = await Promise.race([
          res,
          new Promise(resolve => setTimeout(() => resolve(null), 50))
        ]);
        if (sec && sec.slots) {
          grid = Array.isArray(sec.slots) ? sec.slots : Object.values(sec.slots);
        }
      } catch (_) {}
    }

    if (!Array.isArray(grid)) continue;

    const classDoc = classDocMap.get(cId) || { _id: cId, name: 'Class' };
    const timingSet = matchTimingSetForClass(classDoc, timingSets);

    const classItems = [];
    for (const rawSlot of grid) {
      if (!rawSlot.day || !rawSlot.period) continue;
      // Skip span continuation duplicates if passed from flat slots
      if (rawSlot.isSpanContinuation) continue;

      const interval = getSlotInterval(rawSlot, timingSet);
      const item = {
        slot: rawSlot,
        interval,
        classDoc,
        classId: String(classDoc._id || cId),
        className: classDoc.name || rawSlot.className || rawSlot.section || '',
        timingSet,
        workspaceId: ws?._id || null,
        workspaceName: ws?.name || 'Workspace'
      };
      classItems.push(item);
      allL0Items.push(item);
    }
    l0ItemsByClass.set(cId, classItems);
  }

  // 4. Run Single-Slot Checks (Checks 3–7, 9)
  for (const item of allL0Items) {
    const { slot, interval, classDoc, className, classId, timingSet } = item;

    // A. Unresolved IDs check
    if (checkUnresolved) {
      if (slot.reservedForDeptId && !slot.teacherId) {
        conflicts.push({
          kind: 'unresolved_ids',
          severity: 'hard',
          layer: 'L0',
          classId,
          className,
          day: interval.day,
          period: interval.period,
          startMin: interval.startMin,
          endMin: interval.endMin,
          message: `Slot on ${interval.day} P${interval.period} is reserved for department ${slot.reservedLabel || ''} but staff has not been assigned`,
          dedupeKey: generateDedupeKey(ws?._id, classId, null, 'unresolved_ids', interval.day, interval.startMin)
        });
      } else if (slot.subject && String(slot.subject).trim()) {
        const missing = [];
        if (!slot.subjectId) missing.push('subjectId');
        if (!slot.teacherId && !slot.teacher) missing.push('teacherId');
        if (!slot.roomId && !slot.room) missing.push('roomId');
        if (missing.length > 0) {
          conflicts.push({
            kind: 'unresolved_ids',
            severity: 'hard',
            layer: 'L0',
            classId,
            className,
            day: interval.day,
            period: interval.period,
            startMin: interval.startMin,
            endMin: interval.endMin,
            message: `Slot '${slot.subject}' on ${interval.day} P${interval.period} has unresolved references (${missing.join(', ')})`,
            dedupeKey: generateDedupeKey(ws?._id, classId, null, 'unresolved_ids', interval.day, interval.startMin)
          });
        }
      }
    }

    // B. Lab Span validation (Check 5)
    if (slot.isLab) {
      const activePeriodsCount = (timingSet.periods || []).filter(p => !p.isBreak).length || 9;
      if (interval.span < 1 || (interval.period + interval.span - 1) > activePeriodsCount) {
        conflicts.push({
          kind: 'lab_span',
          severity: 'hard',
          layer: 'L0',
          classId,
          className,
          day: interval.day,
          period: interval.period,
          startMin: interval.startMin,
          endMin: interval.endMin,
          message: `Lab slot on ${interval.day} P${interval.period} runs off the scheduled academic day (span ${interval.span})`,
          dedupeKey: generateDedupeKey(ws?._id, classId, null, 'lab_span', interval.day, interval.startMin)
        });
      }
    }

    // C. Span crosses lunch or tea break (Check 6)
    if (interval.span > 1 && timingSet.periods) {
      const endPeriodNum = interval.period + interval.span - 1;
      const breaksCrossed = timingSet.periods.filter(p => {
        if (!p.isBreak) return false;
        const bStart = parseMinutes(p.start);
        const bEnd = parseMinutes(p.end);
        return interval.startMin < bEnd && bStart < interval.endMin;
      });
      if (breaksCrossed.length > 0) {
        conflicts.push({
          kind: 'span_crosses_break',
          severity: 'warning',
          layer: 'L0',
          classId,
          className,
          day: interval.day,
          period: interval.period,
          startMin: interval.startMin,
          endMin: interval.endMin,
          message: `Multi-period slot on ${interval.day} P${interval.period} (span ${interval.span}) crosses ${breaksCrossed.map(b => b.label || b.breakType).join(', ')}`,
          dedupeKey: generateDedupeKey(ws?._id, classId, null, 'span_crosses_break', interval.day, interval.startMin)
        });
      }
    }

    // D. Room Registered, Eligibility, Unavailable & Capacity (Checks 3 & 4)
    if (slot.roomId || slot.room) {
      const roomKey = slot.roomId ? String(slot.roomId) : String(slot.room).trim().toLowerCase();
      const roomDoc = roomDocMap.get(roomKey);
      if (roomDoc) {
        // Room status check
        if (roomDoc.status && ['maintenance', 'inactive', 'temporarily unavailable'].includes(roomDoc.status.toLowerCase())) {
          conflicts.push({
            kind: 'room_unavailable',
            severity: 'hard',
            layer: 'L0',
            classId,
            className,
            roomId: roomDoc._id,
            roomName: roomDoc.hallNo || roomDoc.name,
            day: interval.day,
            period: interval.period,
            startMin: interval.startMin,
            endMin: interval.endMin,
            message: `Room ${roomDoc.hallNo || roomDoc.name} is currently unavailable (${roomDoc.status})`,
            dedupeKey: generateDedupeKey(ws?._id, classId, null, 'room_unavailable', interval.day, interval.startMin)
          });
        }

        // Room type eligibility check
        const classEnrolled = classDoc.studentCount || classDoc.enrolledCount || 0;
        const elig = checkRoomEligibility(roomDoc, slot.type, { isLab: slot.isLab, enrolledCount: classEnrolled });
        if (!elig.eligible && elig.code === 'ROOM_NOT_ELIGIBLE') {
          conflicts.push({
            kind: 'room_not_eligible',
            severity: 'hard',
            layer: 'L0',
            classId,
            className,
            roomId: roomDoc._id,
            roomName: roomDoc.hallNo || roomDoc.name,
            day: interval.day,
            period: interval.period,
            startMin: interval.startMin,
            endMin: interval.endMin,
            message: elig.reason,
            dedupeKey: generateDedupeKey(ws?._id, classId, null, 'room_not_eligible', interval.day, interval.startMin)
          });
        }

        // Room capacity check
        if (roomDoc.capacity && classEnrolled > 0 && classEnrolled > roomDoc.capacity) {
          conflicts.push({
            kind: 'capacity',
            severity: 'warning',
            layer: 'L0',
            classId,
            className,
            roomId: roomDoc._id,
            roomName: roomDoc.hallNo || roomDoc.name,
            day: interval.day,
            period: interval.period,
            startMin: interval.startMin,
            endMin: interval.endMin,
            message: `Enrolled students (${classEnrolled}) exceed room ${roomDoc.hallNo || roomDoc.name} capacity (${roomDoc.capacity})`,
            dedupeKey: generateDedupeKey(ws?._id, classId, null, 'capacity', interval.day, interval.startMin)
          });
        }
      } else if (slot.room && !slot.roomId) {
        conflicts.push({
          kind: 'unregistered_room',
          severity: 'hard',
          layer: 'L0',
          classId,
          className,
          day: interval.day,
          period: interval.period,
          startMin: interval.startMin,
          endMin: interval.endMin,
          message: `Slot '${slot.subject}' uses free-text room '${slot.room}'. Please select a registered campus room.`,
          dedupeKey: generateDedupeKey(ws?._id, classId, null, 'unregistered_room', interval.day, interval.startMin)
        });
      }
    }

    // E. Teacher Availability Constraints (Section 2.4 / K10)
    if (slot.teacherId && teacherAvailMap.has(String(slot.teacherId))) {
      const ta = teacherAvailMap.get(String(slot.teacherId));
      if (Array.isArray(ta.unavailable) && ta.unavailable.length > 0) {
        const isUnavail = ta.unavailable.some(u =>
          String(u.day || '').trim().toLowerCase() === String(interval.day || '').trim().toLowerCase() &&
          Number(u.period) === Number(interval.period)
        );
        if (isUnavail) {
          conflicts.push({
            kind: 'teacher_unavailable',
            severity: 'warning',
            layer: 'L0',
            classId,
            className,
            teacherId: slot.teacherId,
            teacherName: slot.teacher || 'Faculty',
            day: interval.day,
            period: interval.period,
            startMin: interval.startMin,
            endMin: interval.endMin,
            message: `Faculty ${slot.teacher || 'Member'} has marked ${interval.day} P${interval.period} as unavailable`,
            dedupeKey: generateDedupeKey(ws?._id, classId, null, 'teacher_unavailable', interval.day, interval.startMin)
          });
        }
      }
    }
  }

  // Helper: Evaluates cross-slot clashes between itemA and itemB
  function evaluateSlotPair(itemA, itemB, layer) {
    if (!intervalsOverlap(itemA.interval, itemB.interval)) return;

    // Combined classes exemption: only exempt if sharing identical combinedGroupId
    const aComb = itemA.slot.combinedGroupId;
    const bComb = itemB.slot.combinedGroupId;
    if (aComb && bComb && String(aComb) === String(bComb)) {
      return; // Lawfully combined
    }

    const teacherMatch = (
      (itemA.slot.teacherId && itemB.slot.teacherId && String(itemA.slot.teacherId) === String(itemB.slot.teacherId)) ||
      (itemA.slot.teacher && itemB.slot.teacher && itemA.slot.teacher.trim().toLowerCase() === itemB.slot.teacher.trim().toLowerCase())
    );

    if (teacherMatch) {
      const teacherName = itemA.slot.teacher || itemB.slot.teacher || 'Faculty';
      const severity = layer === 'L2' ? 'soft' : 'hard';
      conflicts.push({
        kind: 'faculty',
        type: 'teacher',
        severity,
        layer,
        classId: itemA.classId,
        className: itemA.className,
        otherClassId: itemB.classId,
        otherClassName: itemB.className,
        otherWorkspaceId: itemB.workspaceId,
        otherWorkspaceName: itemB.workspaceName,
        teacherId: itemA.slot.teacherId || itemB.slot.teacherId,
        teacherName,
        teacher: teacherName,
        day: itemA.interval.day,
        period: itemA.interval.period,
        startMin: itemA.interval.startMin,
        endMin: itemA.interval.endMin,
        message: `Faculty double-booked: ${teacherName} on ${itemA.interval.day} (${formatMinutes(itemA.interval.startMin)}–${formatMinutes(itemA.interval.endMin)}) between ${itemA.className} and ${itemB.className}`,
        dedupeKey: generateDedupeKey(ws?._id, itemA.classId, itemB.classId, 'faculty', itemA.interval.day, itemA.interval.startMin)
      });
    }

    const roomMatch = (
      (itemA.slot.roomId && itemB.slot.roomId && String(itemA.slot.roomId) === String(itemB.slot.roomId)) ||
      (itemA.slot.room && itemB.slot.room && itemA.slot.room.trim().toLowerCase() === itemB.slot.room.trim().toLowerCase())
    );

    if (roomMatch) {
      const roomName = itemA.slot.room || itemB.slot.room || 'Room';
      const severity = layer === 'L2' ? 'soft' : 'hard';
      conflicts.push({
        kind: 'room',
        type: 'room',
        severity,
        layer,
        classId: itemA.classId,
        className: itemA.className,
        otherClassId: itemB.classId,
        otherClassName: itemB.className,
        otherWorkspaceId: itemB.workspaceId,
        otherWorkspaceName: itemB.workspaceName,
        roomId: itemA.slot.roomId || itemB.slot.roomId,
        roomName,
        room: roomName,
        day: itemA.interval.day,
        period: itemA.interval.period,
        startMin: itemA.interval.startMin,
        endMin: itemA.interval.endMin,
        message: `Room conflict: ${roomName} is double-booked on ${itemA.interval.day} (${formatMinutes(itemA.interval.startMin)}–${formatMinutes(itemA.interval.endMin)}) between ${itemA.className} and ${itemB.className}`,
        dedupeKey: generateDedupeKey(ws?._id, itemA.classId, itemB.classId, 'room', itemA.interval.day, itemA.interval.startMin)
      });
    }
  }

  // 5. LAYER L0: Cross-Slot Checks within Workspace
  for (let i = 0; i < allL0Items.length; i++) {
    for (let j = i + 1; j < allL0Items.length; j++) {
      evaluateSlotPair(allL0Items[i], allL0Items[j], 'L0');
    }
  }

  // 6. LAYER L1: Production Head of Classes NOT in this Workspace
  const excludedClassIds = new Set(targetClassList);
  let prodSections = [];
  try {
    const q = M.SectionTimetable.find({
      classId: { $nin: Array.from(excludedClassIds).map(id => mongoose.isValidObjectId(id) ? id : null).filter(Boolean) }
    });
    const res = typeof q?.lean === 'function' ? q.lean() : q;
    prodSections = (await Promise.race([
      res,
      new Promise(resolve => setTimeout(() => resolve([]), 50))
    ])) || [];
  } catch (_) {}

  let otherProdClasses = [];
  try {
    const q = M.Class.find({
      _id: { $in: prodSections.map(s => s.classId).filter(Boolean) }
    });
    const res = typeof q?.lean === 'function' ? q.lean() : q;
    otherProdClasses = (await Promise.race([
      res,
      new Promise(resolve => setTimeout(() => resolve([]), 50))
    ])) || [];
  } catch (_) {}
  const otherClassMap = new Map(otherProdClasses.map(c => [String(c._id), c]));

  const allL1Items = [];
  for (const sec of prodSections) {
    if (!sec.slots) continue;
    const sClassDoc = otherClassMap.get(String(sec.classId)) || { _id: sec.classId, name: sec.className || 'Prod Class' };
    const timingSet = matchTimingSetForClass(sClassDoc, timingSets);
    const slotsArr = Array.isArray(sec.slots) ? sec.slots : Object.values(sec.slots);

    for (const rawSlot of slotsArr) {
      if (!rawSlot.day || !rawSlot.period) continue;
      if (rawSlot.isSpanContinuation) continue;

      const interval = getSlotInterval(rawSlot, timingSet);
      allL1Items.push({
        slot: rawSlot,
        interval,
        classDoc: sClassDoc,
        classId: String(sClassDoc._id || sec.classId),
        className: sClassDoc.name || sec.className || 'Prod Class',
        timingSet,
        workspaceId: null,
        workspaceName: 'Production'
      });
    }
  }

  for (const l0Item of allL0Items) {
    for (const l1Item of allL1Items) {
      evaluateSlotPair(l0Item, l1Item, 'L1');
    }
  }

  // 7. LAYER L2: Class Drafts in Other Open Workspaces
  if (ws && M.TimetableWorkspace) {
    let otherWorkspaces = [];
    try {
      const q = M.TimetableWorkspace.find({
        _id: { $ne: ws._id },
        status: 'open'
      });
      const res = typeof q?.lean === 'function' ? q.lean() : q;
      otherWorkspaces = (await Promise.race([
        res,
        new Promise(resolve => setTimeout(() => resolve([]), 50))
      ])) || [];
    } catch (_) {}

    if (otherWorkspaces.length > 0) {
      const otherWsIds = otherWorkspaces.map(w => w._id);
      let otherDrafts = [];
      try {
        const q = M.WorkspaceClassDraft.find({
          workspaceId: { $in: otherWsIds }
        });
        const res = typeof q?.lean === 'function' ? q.lean() : q;
        otherDrafts = (await Promise.race([
          res,
          new Promise(resolve => setTimeout(() => resolve([]), 50))
        ])) || [];
      } catch (_) {}

      const wsLookup = new Map(otherWorkspaces.map(w => [String(w._id), w]));
      const otherDraftClassIds = otherDrafts.map(d => d.classId).filter(Boolean);
      let draftClasses = [];
      try {
        const q = M.Class.find({ _id: { $in: otherDraftClassIds } });
        const res = typeof q?.lean === 'function' ? q.lean() : q;
        draftClasses = (await Promise.race([
          res,
          new Promise(resolve => setTimeout(() => resolve([]), 50))
        ])) || [];
      } catch (_) {}
      const draftClassMap = new Map(draftClasses.map(c => [String(c._id), c]));

      const allL2Items = [];
      for (const d of otherDrafts) {
        if (!Array.isArray(d.grid)) continue;
        const ows = wsLookup.get(String(d.workspaceId));
        const dClassDoc = draftClassMap.get(String(d.classId)) || { _id: d.classId, name: d.className };
        const timingSet = matchTimingSetForClass(dClassDoc, timingSets);

        for (const rawSlot of d.grid) {
          if (!rawSlot.day || !rawSlot.period) continue;
          if (rawSlot.isSpanContinuation) continue;

          const interval = getSlotInterval(rawSlot, timingSet);
          allL2Items.push({
            slot: rawSlot,
            interval,
            classDoc: dClassDoc,
            classId: String(dClassDoc._id || d.classId),
            className: dClassDoc.name || d.className || 'Draft Class',
            timingSet,
            workspaceId: ows?._id || null,
            workspaceName: ows?.name || 'Other Workspace'
          });
        }
      }

      for (const l0Item of allL0Items) {
        for (const l2Item of allL2Items) {
          evaluateSlotPair(l0Item, l2Item, 'L2');
        }
      }
    }
  }

  return conflicts;
}

// ── HoD Clash Notification & Auto-Solve Dispatcher (D4, D20) ──

/**
 * Dispatches high-priority clash notifications to affected departments' HoDs.
 * Deduplicated for 24 hours via SHA1 dedupeKey.
 */
async function notifyHodOfClashes({ conflicts = [], workspace, actor = {} } = {}) {
  if (!workspace || !conflicts.length) return { sent: 0, skipped: 0 };

  let sent = 0;
  let skipped = 0;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Filter cross-class conflicts
  const externalClashes = conflicts.filter(c => c.otherClassId && String(c.otherClassId) !== String(c.classId));

  for (const clash of externalClashes) {
    if (!clash.dedupeKey) continue;

    // Check 24-hr deduplication
    const existing = await M.Notification.findOne({
      dedupeKey: clash.dedupeKey,
      createdAt: { $gte: cutoff }
    }).lean();

    if (existing) {
      skipped++;
      continue;
    }

    // Resolve other class's department HoD
    let otherDeptId = null;
    let otherClassName = clash.otherClassName;
    if (clash.otherClassId) {
      const otherCls = await M.Class.findById(clash.otherClassId).lean();
      if (otherCls) {
        otherDeptId = otherCls.deptId;
        otherClassName = otherCls.name || otherClassName;
      }
    }

    // If other class belongs to the same department as the workspace, skip notifying another HoD
    if (otherDeptId && String(otherDeptId) === String(workspace.deptId)) {
      continue;
    }

    const hodTeacher = otherDeptId ? await resolveHodTeacher(otherDeptId) : null;
    const entityDesc = clash.kind === 'faculty' ? `Faculty ${clash.teacherName}` : `Room ${clash.roomName}`;

    await M.Notification.create({
      type: 'timetable-conflict',
      priority: 'High',
      from: actor.name || 'Timetable System',
      fromRole: 'TTC',
      toTeacherId: hodTeacher?._id || null,
      toTeacherName: hodTeacher?.name || 'Head of Department',
      classId: clash.otherClassId,
      className: otherClassName,
      dedupeKey: clash.dedupeKey,
      message: `Workspace '${workspace.name}' (${workspace.deptName || 'Department'}, by ${actor.name || 'TTC'}) clashes with ${otherClassName} on ${clash.day} P${clash.period} — ${entityDesc} is double-booked.`,
      status: 'Delivered',
      read: false
    });

    sent++;
  }

  return { sent, skipped };
}

/**
 * Sets previous clash notifications to 'Solved' if the clash is no longer found.
 */
async function resolveStaleClashNotifications({ workspaceId, currentConflicts = [] } = {}) {
  if (!workspaceId) return { resolved: 0 };

  const currentDedupeKeys = new Set(currentConflicts.map(c => c.dedupeKey).filter(Boolean));

  // Find open conflict notifications originating from this workspace
  const openNotifs = await M.Notification.find({
    type: 'timetable-conflict',
    status: { $ne: 'Solved' },
    dedupeKey: { $regex: `^${String(workspaceId)}\\|` }
  });

  let resolved = 0;
  for (const notif of openNotifs) {
    if (!currentDedupeKeys.has(notif.dedupeKey)) {
      notif.status = 'Solved';
      notif.solvedAt = new Date();
      await notif.save();
      resolved++;
    }
  }

  return { resolved };
}

module.exports = {
  detectConflictsV2,
  notifyHodOfClashes,
  resolveStaleClashNotifications,
  parseMinutes,
  formatMinutes,
  intervalsOverlap,
  generateDedupeKey,
  getSlotInterval,
  DEFAULT_TIMING_SETS
};
