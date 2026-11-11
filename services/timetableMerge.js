/**
 * services/timetableMerge.js
 *
 * Three-Way Stale-Base Merge Engine for EAMS Timetable v3 (Section 10.3):
 * - Slot-unit three-way merge keyed by (day, rootPeriod).
 * - Span-aware: multi-period labs treated as single units; differing roots flagged as conflicts.
 * - Merge options:
 *     1. Auto-merge (clean three-way merge when no overlapping diffs exist).
 *     2. Resolve one-by-one (slot chooser providing 'mine' | 'theirs' | custom slot).
 *     3. Keep mine (override production changes; requires reason string).
 *     4. Take production (discard workspace draft for this class and re-fork).
 * - Automatically saves a 'pre-merge' checkpoint before mutating draft (1-click Undo).
 */

'use strict';

const mongoose = require('mongoose');
const M = require('../models');
const { logAction } = require('../utils/logAction');

/**
 * Checks if two slot objects are substantially equal.
 */
function slotsEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;

  const str = v => (v === undefined || v === null ? '' : String(v).trim().toLowerCase());
  const idStr = v => (v === undefined || v === null ? '' : String(v));

  if (str(a.day) !== str(b.day)) return false;
  if (Number(a.period || 0) !== Number(b.period || 0)) return false;
  if (Number(a.span || 1) !== Number(b.span || 1)) return false;
  if (Boolean(a.isLab) !== Boolean(b.isLab)) return false;
  if (str(a.subject) !== str(b.subject)) return false;
  if (idStr(a.subjectId) !== idStr(b.subjectId)) return false;
  if (str(a.teacher) !== str(b.teacher)) return false;
  if (idStr(a.teacherId) !== idStr(b.teacherId)) return false;
  if (str(a.room) !== str(b.room)) return false;
  if (idStr(a.roomId) !== idStr(b.roomId)) return false;
  if (str(a.type || 'Theory') !== str(b.type || 'Theory')) return false;
  if (idStr(a.combinedGroupId) !== idStr(b.combinedGroupId)) return false;

  return true;
}

/**
 * Builds slot-unit map from a flat grid or slot list.
 * Only root slots (spanIndex === 0 or !isSpanContinuation) are kept as authoritative units.
 */
function buildSlotMap(grid) {
  const map = new Map();
  if (!Array.isArray(grid)) return map;

  for (const slot of grid) {
    if (!slot.day || !slot.period) continue;
    if (slot.isSpanContinuation) continue; // Skip continuation duplicates

    const rootPeriod = slot.spanRootPeriod || slot.period;
    const key = `${String(slot.day).trim().toLowerCase()}_${rootPeriod}`;
    map.set(key, { ...slot, period: rootPeriod });
  }

  return map;
}

/**
 * Three-Way Merge Algorithm (Table 10.3)
 *
 * @param {Array} baseGrid - Base version grid (draft.baseTrackId)
 * @param {Array} mineGrid - Workspace draft grid
 * @param {Array} theirsGrid - Current production Head grid
 * @returns {Object} { clean: Boolean, conflicts: Array, mergedGrid: Array }
 */
function threeWayMerge(baseGrid = [], mineGrid = [], theirsGrid = []) {
  const baseMap = buildSlotMap(baseGrid);
  const mineMap = buildSlotMap(mineGrid);
  const theirsMap = buildSlotMap(theirsGrid);

  const allKeys = new Set([...baseMap.keys(), ...mineMap.keys(), ...theirsMap.keys()]);
  const conflicts = [];
  const mergedMap = new Map();

  for (const key of allKeys) {
    const B = baseMap.get(key) || null;
    const M_slot = mineMap.get(key) || null;
    const T = theirsMap.get(key) || null;

    const bEqualsM = slotsEqual(B, M_slot);
    const bEqualsT = slotsEqual(B, T);
    const mEqualsT = slotsEqual(M_slot, T);

    const [day, periodStr] = key.split('_');
    const period = parseInt(periodStr, 10);

    // Case 1: Untouched everywhere
    if (bEqualsM && bEqualsT) {
      if (B) mergedMap.set(key, B);
      continue;
    }

    // Case 2: Untouched in Mine, changed in Production -> Take Production (T)
    if (bEqualsM && !bEqualsT) {
      if (T) mergedMap.set(key, T);
      continue;
    }

    // Case 3: Changed in Mine, untouched in Production -> Take Mine (M)
    if (!bEqualsM && bEqualsT) {
      if (M_slot) mergedMap.set(key, M_slot);
      continue;
    }

    // Case 4: Both Mine and Production changed identically -> Take either
    if (!bEqualsM && !bEqualsT && mEqualsT) {
      if (M_slot) mergedMap.set(key, M_slot);
      continue;
    }

    // Case 5: Both changed differently -> CONFLICT
    conflicts.push({
      key,
      day: (M_slot || T || B).day || day,
      period: (M_slot || T || B).period || period,
      base: B,
      mine: M_slot,
      theirs: T,
      reason: 'Both workspace draft and production modified this slot differently'
    });
  }

  // Multi-period span overlap detection across different root periods
  // e.g. Mine has Mon P1-P3, Production has Mon P2-P3
  const mineSlots = Array.from(mineMap.values());
  const theirsSlots = Array.from(theirsMap.values());

  for (const mSlot of mineSlots) {
    const mStart = Number(mSlot.period);
    const mEnd = mStart + Math.max(1, Number(mSlot.span || 1)) - 1;

    for (const tSlot of theirsSlots) {
      if (String(mSlot.day).toLowerCase() !== String(tSlot.day).toLowerCase()) continue;
      const tStart = Number(tSlot.period);
      const tEnd = tStart + Math.max(1, Number(tSlot.span || 1)) - 1;

      // Overlapping periods but different roots
      if (mStart !== tStart && mStart <= tEnd && tStart <= mEnd) {
        const overlapKey = `${String(mSlot.day).toLowerCase()}_span_${mStart}_${tStart}`;
        if (!conflicts.some(c => c.key === overlapKey)) {
          conflicts.push({
            key: overlapKey,
            day: mSlot.day,
            period: Math.min(mStart, tStart),
            base: null,
            mine: mSlot,
            theirs: tSlot,
            reason: `Conflicting multi-period spans overlap across periods ${Math.min(mStart, tStart)}–${Math.max(mEnd, tEnd)}`
          });
        }
      }
    }
  }

  if (conflicts.length > 0) {
    return { clean: false, conflicts, mergedGrid: null };
  }

  const mergedGrid = Array.from(mergedMap.values()).sort((a, b) => {
    if (a.day !== b.day) return a.day.localeCompare(b.day);
    return Number(a.period || 0) - Number(b.period || 0);
  });

  return { clean: true, conflicts: [], mergedGrid };
}

// ── Checkpoint Creation Helper ──

async function createPreMergeCheckpoint(workspaceId, classId, draft, currentHeadTrackId, user = {}) {
  try {
    if (!M.WorkspaceCheckpoint) return null;

    const lastCp = await M.WorkspaceCheckpoint.findOne({ workspaceId }).sort({ seq: -1 }).lean();
    const nextSeq = (lastCp?.seq || 0) + 1;

    return await M.WorkspaceCheckpoint.create({
      workspaceId,
      seq: nextSeq,
      name: `Pre-merge backup before updating to ${currentHeadTrackId}`,
      note: `Automatic snapshot before merging class ${draft.className || classId}`,
      classes: [{
        classId: draft.classId,
        className: draft.className,
        grid: draft.grid || []
      }],
      createdBy: user._id || null,
      createdByName: user.name || 'System Auto-Merge'
    });
  } catch (_) {
    return null;
  }
}

// ── Merge Execution Handlers ──

/**
 * Executes automatic 3-way merge on a workspace class draft.
 */
async function executeAutoMerge({ workspaceId, classId, user = {} } = {}) {
  const ws = await M.TimetableWorkspace.findById(workspaceId);
  if (!ws) throw new Error('Workspace not found');

  const draft = await M.WorkspaceClassDraft.findOne({ workspaceId, classId });
  if (!draft) throw new Error('Class draft not found in workspace');

  const sec = await M.SectionTimetable.findOne({ classId }).lean();
  if (!sec) throw new Error('Production SectionTimetable not found for class');

  const currentHeadTrackId = sec.headTrackId || 'TT-0000-000000';
  const currentHeadSeq = sec.headSeq || 0;

  // Already up to date
  if (draft.baseTrackId === currentHeadTrackId) {
    return { ok: true, clean: true, alreadyUpToDate: true, draft };
  }

  // Load Base Grid from TimetableCommitClass
  let baseGrid = [];
  if (draft.baseTrackId) {
    const commitClass = await M.TimetableCommitClass.findOne({
      commitTrackId: draft.baseTrackId,
      classId
    }).lean();
    if (commitClass && Array.isArray(commitClass.grid)) {
      baseGrid = commitClass.grid;
    }
  }

  const theirsGrid = sec.slots ? (Array.isArray(sec.slots) ? sec.slots : Object.values(sec.slots)) : [];
  const mergeResult = threeWayMerge(baseGrid, draft.grid || [], theirsGrid);

  if (!mergeResult.clean) {
    return {
      ok: true,
      clean: false,
      conflicts: mergeResult.conflicts,
      baseTrackId: draft.baseTrackId,
      currentHeadTrackId,
      draft
    };
  }

  // Clean merge: create pre-merge checkpoint first (Undo is 1-click)
  await createPreMergeCheckpoint(ws._id, classId, draft, currentHeadTrackId, user);

  // Apply clean merged grid to draft
  draft.grid = mergeResult.mergedGrid;
  draft.baseTrackId = currentHeadTrackId;
  draft.baseSeq = currentHeadSeq;
  draft.revision = (draft.revision || 1) + 1;
  draft.updatedBy = user._id || null;
  draft.updatedByName = user.name || 'Auto Merge';
  await draft.save();

  await logAction({
    userId: user._id || null,
    module: 'timetable',
    subType: 'merge-auto',
    status: 'success',
    description: `Auto-merged class ${draft.className} to head ${currentHeadTrackId}`,
    metadata: { workspaceId: ws._id, classId, baseTrackId: draft.baseTrackId, newHeadTrackId: currentHeadTrackId }
  });

  return { ok: true, clean: true, conflicts: [], draft };
}

/**
 * Resolves conflicts slot-by-slot with user choices ('mine' | 'theirs' | custom slot).
 */
async function executeResolveMerge({ workspaceId, classId, resolutions = {}, customSlots = {}, user = {} } = {}) {
  const ws = await M.TimetableWorkspace.findById(workspaceId);
  if (!ws) throw new Error('Workspace not found');

  const draft = await M.WorkspaceClassDraft.findOne({ workspaceId, classId });
  if (!draft) throw new Error('Class draft not found in workspace');

  const sec = await M.SectionTimetable.findOne({ classId }).lean();
  if (!sec) throw new Error('Production SectionTimetable not found for class');

  const currentHeadTrackId = sec.headTrackId || 'TT-0000-000000';
  const currentHeadSeq = sec.headSeq || 0;

  let baseGrid = [];
  if (draft.baseTrackId) {
    const commitClass = await M.TimetableCommitClass.findOne({
      commitTrackId: draft.baseTrackId,
      classId
    }).lean();
    if (commitClass && Array.isArray(commitClass.grid)) {
      baseGrid = commitClass.grid;
    }
  }

  const theirsGrid = sec.slots ? (Array.isArray(sec.slots) ? sec.slots : Object.values(sec.slots)) : [];
  const baseMap = buildSlotMap(baseGrid);
  const mineMap = buildSlotMap(draft.grid || []);
  const theirsMap = buildSlotMap(theirsGrid);

  const allKeys = new Set([...baseMap.keys(), ...mineMap.keys(), ...theirsMap.keys()]);
  const finalMap = new Map();

  for (const key of allKeys) {
    const resolution = resolutions[key];
    const customSlot = customSlots[key];

    if (resolution === 'mine') {
      const m = mineMap.get(key);
      if (m) finalMap.set(key, m);
    } else if (resolution === 'theirs') {
      const t = theirsMap.get(key);
      if (t) finalMap.set(key, t);
    } else if (resolution === 'custom' && customSlot) {
      finalMap.set(key, customSlot);
    } else {
      // Default to standard 3-way evaluation for non-conflicted slots
      const B = baseMap.get(key) || null;
      const M_slot = mineMap.get(key) || null;
      const T = theirsMap.get(key) || null;
      if (slotsEqual(B, M_slot)) {
        if (T) finalMap.set(key, T);
      } else {
        if (M_slot) finalMap.set(key, M_slot);
      }
    }
  }

  const finalGrid = Array.from(finalMap.values()).sort((a, b) => {
    if (a.day !== b.day) return a.day.localeCompare(b.day);
    return Number(a.period || 0) - Number(b.period || 0);
  });

  // Pre-merge checkpoint
  await createPreMergeCheckpoint(ws._id, classId, draft, currentHeadTrackId, user);

  draft.grid = finalGrid;
  draft.baseTrackId = currentHeadTrackId;
  draft.baseSeq = currentHeadSeq;
  draft.revision = (draft.revision || 1) + 1;
  draft.updatedBy = user._id || null;
  draft.updatedByName = user.name || 'Merge Resolver';
  await draft.save();

  await logAction({
    userId: user._id || null,
    module: 'timetable',
    subType: 'merge-auto',
    status: 'success',
    description: `Manually resolved merge conflicts for class ${draft.className} to head ${currentHeadTrackId}`,
    metadata: { workspaceId: ws._id, classId, newHeadTrackId: currentHeadTrackId }
  });

  return { ok: true, clean: true, draft };
}

/**
 * 'Keep Mine' strategy: overrides production changes for this class.
 * Requires a reason string (Section 16.8).
 */
async function executeKeepMine({ workspaceId, classId, reason, user = {} } = {}) {
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    throw new Error('A reason is required to keep workspace version over production (Section 16.8)');
  }

  const ws = await M.TimetableWorkspace.findById(workspaceId);
  if (!ws) throw new Error('Workspace not found');

  const draft = await M.WorkspaceClassDraft.findOne({ workspaceId, classId });
  if (!draft) throw new Error('Class draft not found in workspace');

  const sec = await M.SectionTimetable.findOne({ classId }).lean();
  if (!sec) throw new Error('Production SectionTimetable not found for class');

  const currentHeadTrackId = sec.headTrackId || 'TT-0000-000000';
  const currentHeadSeq = sec.headSeq || 0;

  // Pre-merge checkpoint
  await createPreMergeCheckpoint(ws._id, classId, draft, currentHeadTrackId, user);

  // Keep mine: keep draft grid, move base to current production Head
  draft.baseTrackId = currentHeadTrackId;
  draft.baseSeq = currentHeadSeq;
  draft.revision = (draft.revision || 1) + 1;
  draft.updatedBy = user._id || null;
  draft.updatedByName = user.name || 'Keep Mine';
  await draft.save();

  await logAction({
    userId: user._id || null,
    module: 'timetable',
    subType: 'merge-keep-mine',
    status: 'success',
    description: `Kept workspace draft over production for class ${draft.className}: ${reason.trim()}`,
    metadata: { workspaceId: ws._id, classId, reason: reason.trim(), newHeadTrackId: currentHeadTrackId }
  });

  return { ok: true, clean: true, draft };
}

/**
 * 'Take Production' strategy: discards workspace edits and re-forks from current production Head.
 */
async function executeTakeProduction({ workspaceId, classId, user = {} } = {}) {
  const ws = await M.TimetableWorkspace.findById(workspaceId);
  if (!ws) throw new Error('Workspace not found');

  const draft = await M.WorkspaceClassDraft.findOne({ workspaceId, classId });
  if (!draft) throw new Error('Class draft not found in workspace');

  const sec = await M.SectionTimetable.findOne({ classId }).lean();
  if (!sec) throw new Error('Production SectionTimetable not found for class');

  const currentHeadTrackId = sec.headTrackId || 'TT-0000-000000';
  const currentHeadSeq = sec.headSeq || 0;

  // Pre-merge checkpoint
  await createPreMergeCheckpoint(ws._id, classId, draft, currentHeadTrackId, user);

  const prodSlots = sec.slots ? (Array.isArray(sec.slots) ? sec.slots : Object.values(sec.slots)) : [];
  draft.grid = prodSlots;
  draft.baseTrackId = currentHeadTrackId;
  draft.baseSeq = currentHeadSeq;
  draft.revision = (draft.revision || 1) + 1;
  draft.updatedBy = user._id || null;
  draft.updatedByName = user.name || 'Take Production';
  await draft.save();

  await logAction({
    userId: user._id || null,
    module: 'timetable',
    subType: 'workspace-fork',
    status: 'success',
    description: `Took production timetable for class ${draft.className} at head ${currentHeadTrackId}`,
    metadata: { workspaceId: ws._id, classId, newHeadTrackId: currentHeadTrackId }
  });

  return { ok: true, clean: true, draft };
}

module.exports = {
  threeWayMerge,
  slotsEqual,
  buildSlotMap,
  executeAutoMerge,
  executeResolveMerge,
  executeKeepMine,
  executeTakeProduction
};
