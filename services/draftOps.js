/**
 * services/draftOps.js
 * 
 * Cell-Level Operation Engine, Version Bucketing, and Reversible Restore (Phase 3).
 * Invariants:
 * - Append-only operation log (DraftOp) with monotonic sequencing.
 * - Idempotency through unique clientOpId.
 * - Per-cell optimistic locking via baseRev on DraftClass.slotRevs.
 * - 15-minute IST clock-window version grouping based on server receivedAt (C10).
 * - Invariant Z10: Closing job or new bucket arrival closes prior open version with pre-edit snapshot.
 * - Restores append forward operations (type: 'restore') so all restores are completely undoable.
 */

'use strict';

const mongoose = require('mongoose');
const M = require('../models');
const { validateSlotRoom } = require('./roomEligibility');

/**
 * Normalizes a slot key into canonical "Day_Period" format (e.g. "Monday_1")
 */
function normalizeSlotKey(day, period) {
  if (!day || period === undefined || period === null) return '';
  const d = String(day).trim();
  const capDay = d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
  return `${capDay}_${period}`;
}

/**
 * Calculates 15-minute IST bucket metadata for a given Date
 * IST is UTC + 5:30 (330 minutes)
 */
function getIstBucket(date = new Date(), bucketMinutes = 15) {
  const ms = date.getTime();
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istTimeMs = ms + istOffsetMs;
  const istDate = new Date(istTimeMs);

  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istDate.getUTCDate()).padStart(2, '0');
  const hour = istDate.getUTCHours();
  const minute = istDate.getUTCMinutes();

  const bucketStartMin = Math.floor(minute / bucketMinutes) * bucketMinutes;
  const bucketEndMin = bucketStartMin + bucketMinutes;

  const startHourStr = String(hour).padStart(2, '0');
  const startMinStr = String(bucketStartMin).padStart(2, '0');
  const bucketKey = `${year}-${month}-${day}T${startHourStr}:${startMinStr}`;

  // Calculate UTC start and end bounds
  const istBucketStart = new Date(Date.UTC(year, istDate.getUTCMonth(), istDate.getUTCDate(), hour, bucketStartMin, 0, 0));
  const startedAt = new Date(istBucketStart.getTime() - istOffsetMs);
  const endedAt = new Date(startedAt.getTime() + bucketMinutes * 60 * 1000);

  return { bucketKey, startedAt, endedAt };
}

/**
 * Formats user-friendly label for version (e.g. "4:15 PM version", "Yesterday · 4:15 PM")
 */
function formatVersionLabel(startedAt) {
  const d = new Date(startedAt);
  const timeStr = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  if (isToday) return `${timeStr} version`;
  if (isYesterday) return `Yesterday · ${timeStr}`;
  const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${dateStr} · ${timeStr}`;
}

/**
 * Applies a batch of cell operations to a draft
 * 
 * @param {Object} draftRef { draftId, workspaceId }
 * @param {Array} ops Array of operations: [{ clientOpId, classId, slotKey, baseRev, type, before?, after, editedAt }]
 * @param {Object} actor { _id, name, deviceId, offline }
 * @returns {Promise<Object>} { ok: true, seq, results: [{ clientOpId, status, rev, seq, error? }] }
 */
async function applyDraftOps(draftRef, ops, actor = {}) {
  const draftId = draftRef.draftId;
  const workspaceId = draftRef.workspaceId;

  if (!Array.isArray(ops) || !ops.length) {
    return { ok: true, results: [] };
  }

  // Cap at 50 ops per batch
  const batch = ops.slice(0, 50);
  const results = [];
  const serverReceivedAt = new Date();

  // Find or determine workspace settings (e.g. versionBucketMinutes)
  let bucketMinutes = 15;
  if (workspaceId && M.TimetableWorkspace) {
    const ws = await M.TimetableWorkspace.findById(workspaceId).select('versionBucketMinutes seq').lean();
    if (ws && ws.versionBucketMinutes) {
      bucketMinutes = ws.versionBucketMinutes;
    }
  }

  const { bucketKey, startedAt, endedAt } = getIstBucket(serverReceivedAt, bucketMinutes);

  // Group operations by classId for batch loading
  const classIds = [...new Set(batch.map(op => String(op.classId)))];
  const draftClasses = await M.WorkspaceClassDraft.find({
    workspaceId: workspaceId || draftId,
    classId: { $in: classIds }
  });
  const classMap = new Map();
  draftClasses.forEach(dc => classMap.set(String(dc.classId), dc));

  // Determine current max seq
  const latestOp = await M.DraftOp.findOne({ draftId }).sort({ seq: -1 }).select('seq').lean();
  let currentSeq = latestOp ? latestOp.seq : 0;

  // Check for currently open DraftVersion (Invariant Z10)
  let currentVersion = await M.DraftVersion.findOne({ draftId, status: 'open' });
  if (currentVersion && currentVersion.bucketKey !== bucketKey) {
    // Invariant Z10: Close previous bucket when edit in a later bucket arrives, capturing endSnapshot
    currentVersion.status = 'closed';
    await currentVersion.save();
    currentVersion = null;
  }

  if (!currentVersion) {
    currentVersion = await M.DraftVersion.findOne({ draftId, bucketKey });
    if (!currentVersion) {
      currentVersion = new M.DraftVersion({
        draftId,
        workspaceId,
        bucketKey,
        startedAt,
        endedAt,
        firstSeq: currentSeq + 1,
        lastSeq: currentSeq + 1,
        opCount: 0,
        status: 'open',
        authors: [{ userId: actor._id, name: actor.name || 'Coordinator' }],
        classIds: [],
        stats: { added: 0, changed: 0, removed: 0 },
        endSnapshot: {},
        label: formatVersionLabel(startedAt),
        source: 'auto'
      });
    }
  }

  for (const op of batch) {
    const { clientOpId, classId, slotKey, baseRev, type, after } = op;

    // 1. Idempotency Check via clientOpId
    const existingOp = await M.DraftOp.findOne({ draftId, clientOpId }).lean();
    if (existingOp) {
      results.push({
        clientOpId,
        status: 'duplicate',
        seq: existingOp.seq,
        rev: baseRev
      });
      continue;
    }

    // Resolve DraftClass
    let draftClass = classMap.get(String(classId));
    if (!draftClass) {
      // Lazy-init DraftClass if missing
      draftClass = new M.WorkspaceClassDraft({
        workspaceId: workspaceId || draftId,
        classId,
        grid: [],
        slotRevs: {},
        revision: 1,
        seq: 0
      });
      classMap.set(String(classId), draftClass);
    }

    draftClass.slotRevs = draftClass.slotRevs || {};
    const currentRev = Number(draftClass.slotRevs[slotKey]) || 1;

    // 2. Per-Cell Concurrency Control (baseRev validation, bypassed on force push)
    if (!op.force && baseRev !== undefined && baseRev !== null && Number(baseRev) !== currentRev) {
      const currentSlot = (draftClass.grid || []).find(s => normalizeSlotKey(s.day, s.period) === slotKey) || null;
      results.push({
        clientOpId,
        status: 'conflict',
        currentRev,
        currentSlot,
        error: `Revision mismatch on slot ${slotKey}: server is at revision ${currentRev}, proposed was ${baseRev}`
      });
      continue;
    }

    // 3. Apply Slot Delta
    const grid = draftClass.grid || [];
    const existingSlotIndex = grid.findIndex(s => normalizeSlotKey(s.day, s.period) === slotKey);
    const beforeSlot = existingSlotIndex >= 0 ? { ...grid[existingSlotIndex].toObject?.() || grid[existingSlotIndex] } : null;

    if (type === 'slot.clear') {
      if (existingSlotIndex >= 0) {
        grid.splice(existingSlotIndex, 1);
        currentVersion.stats.removed++;
      }
    } else if (type === 'slot.set' || type === 'restore' || type === 'merge') {
      if (after) {
        if (type === 'slot.set' && (after.room || after.roomId)) {
          const roomCheck = await validateSlotRoom(after);
          if (!roomCheck.ok) {
            const err = new Error(roomCheck.error);
            err.code = roomCheck.code;
            err.statusCode = 400;
            throw err;
          }
        }
        if (existingSlotIndex >= 0) {
          grid[existingSlotIndex] = after;
          currentVersion.stats.changed++;
        } else {
          grid.push(after);
          currentVersion.stats.added++;
        }
      }
    }

    draftClass.grid = grid;
    const nextRev = currentRev + 1;
    draftClass.slotRevs[slotKey] = nextRev;
    draftClass.markModified('slotRevs');
    draftClass.markModified('grid');
    draftClass.revision = (draftClass.revision || 1) + 1;

    currentSeq++;
    draftClass.seq = currentSeq;
    await draftClass.save();

    // 4. Append Immutable DraftOp
    await M.DraftOp.create({
      draftId,
      workspaceId,
      classId,
      seq: currentSeq,
      slotKey,
      type: type || 'slot.set',
      before: beforeSlot,
      after: after || null,
      userId: actor._id,
      userName: actor.name || '',
      deviceId: actor.deviceId || '',
      clientOpId,
      editedAt: op.editedAt ? new Date(op.editedAt) : serverReceivedAt,
      receivedAt: serverReceivedAt,
      groupId: op.groupId || null,
      offline: Boolean(actor.offline || op.offline)
    });

    // 5. Update Version Metadata
    currentVersion.lastSeq = currentSeq;
    currentVersion.opCount = (currentVersion.opCount || 0) + 1;
    if (!currentVersion.classIds.some(cid => String(cid) === String(classId))) {
      currentVersion.classIds.push(classId);
    }
    if (actor._id && !currentVersion.authors.some(a => String(a.userId) === String(actor._id))) {
      currentVersion.authors.push({ userId: actor._id, name: actor.name || '' });
    }
    currentVersion.endSnapshot = currentVersion.endSnapshot || {};
    currentVersion.endSnapshot[String(classId)] = grid;
    currentVersion.markModified('endSnapshot');
    currentVersion.markModified('stats');

    results.push({
      clientOpId,
      status: 'applied',
      rev: nextRev,
      seq: currentSeq
    });
  }

  await currentVersion.save();

  // Update Workspace lastActivityAt & seq
  if (workspaceId && M.TimetableWorkspace) {
    await M.TimetableWorkspace.updateOne(
      { _id: workspaceId },
      { $set: { seq: currentSeq, lastActivityAt: serverReceivedAt } }
    );
  }

  return {
    ok: true,
    seq: currentSeq,
    results
  };
}

/**
 * Returns dictionary-encoded full snapshot for a draft
 */
async function getDraftSnapshot(draftId, workspaceId) {
  const draftClasses = await M.WorkspaceClassDraft.find({
    workspaceId: workspaceId || draftId
  }).lean();

  const classes = {};
  const slotRevs = {};

  for (const dc of draftClasses) {
    classes[String(dc.classId)] = dc.grid || [];
    slotRevs[String(dc.classId)] = dc.slotRevs || {};
  }

  const latestOp = await M.DraftOp.findOne({ draftId }).sort({ seq: -1 }).select('seq').lean();

  return {
    ok: true,
    draftId,
    workspaceId,
    seq: latestOp ? latestOp.seq : 0,
    classes,
    slotRevs
  };
}

/**
 * Encodes snapshot classes into dictionary-compressed representation (Phase 7, Section 4.1)
 */
function encodeDictionarySnapshot(snapshot) {
  const teacherMap = new Map();
  const subjectMap = new Map();
  const roomMap = new Map();

  const teachers = [];
  const subjects = [];
  const rooms = [];

  function getIdx(val, list, map) {
    if (!val) return -1;
    const key = String(val).trim();
    if (!key) return -1;
    if (map.has(key)) return map.get(key);
    const idx = list.length;
    list.push(key);
    map.set(key, idx);
    return idx;
  }

  const encodedClasses = [];
  const classesObj = snapshot.classes || {};

  for (const [classId, grid] of Object.entries(classesObj)) {
    const slots = {};
    if (Array.isArray(grid)) {
      for (const slot of grid) {
        if (!slot) continue;
        const key = `${slot.day || 'Monday'}_${slot.period || 1}`;
        const tIdx = getIdx(slot.teacher || slot.teacherName, teachers, teacherMap);
        const sIdx = getIdx(slot.subject || slot.subjectName, subjects, subjectMap);
        const rIdx = getIdx(slot.room || slot.hallNo, rooms, roomMap);
        const span = Number(slot.span || 1);
        const isLab = Boolean(slot.isLab || slot.type === 'Lab');
        slots[key] = [tIdx, sIdx, rIdx, span, isLab ? 1 : 0];
      }
    }
    encodedClasses.push({ classId, slots });
  }

  return {
    ok: true,
    format: 'dict',
    seq: snapshot.seq,
    draftId: snapshot.draftId,
    workspaceId: snapshot.workspaceId,
    dict: {
      teachers,
      subjects,
      rooms
    },
    classes: encodedClasses
  };
}

/**
 * Decodes dictionary-compressed representation back to standard snapshot
 */
function decodeDictionarySnapshot(dictSnapshot) {
  if (!dictSnapshot || dictSnapshot.format !== 'dict') return dictSnapshot;
  const { teachers, subjects, rooms } = dictSnapshot.dict || {};
  const classes = {};

  for (const c of dictSnapshot.classes || []) {
    const grid = [];
    for (const [key, tuple] of Object.entries(c.slots || {})) {
      const parts = key.split('_');
      const day = parts[0] || 'Monday';
      const period = parseInt(parts[1], 10) || 1;
      const [tIdx, sIdx, rIdx, span, isLabNum] = tuple;
      grid.push({
        day,
        period,
        span: span || 1,
        isLab: Boolean(isLabNum),
        teacher: (tIdx >= 0 && teachers) ? teachers[tIdx] : '',
        subject: (sIdx >= 0 && subjects) ? subjects[sIdx] : '',
        room: (rIdx >= 0 && rooms) ? rooms[rIdx] : ''
      });
    }
    classes[c.classId] = grid;
  }

  return {
    ok: true,
    seq: dictSnapshot.seq,
    draftId: dictSnapshot.draftId,
    workspaceId: dictSnapshot.workspaceId,
    classes
  };
}

/**
 * Returns delta changes since specified seq
 */
async function getDraftChanges(draftId, sinceSeq = 0) {
  const ops = await M.DraftOp.find({
    draftId,
    seq: { $gt: Number(sinceSeq) || 0 }
  })
    .sort({ seq: 1 })
    .lean();

  return {
    ok: true,
    draftId,
    sinceSeq: Number(sinceSeq) || 0,
    count: ops.length,
    ops
  };
}

/**
 * Reversible Restore of Draft, Class, or Slot (Section 9.3)
 * Calculates the delta from the selected version and appends forward DraftOp operations.
 */
async function restoreDraftVersion(draftRef, versionId, options = {}, actor = {}) {
  const { draftId, workspaceId } = draftRef;
  const { scope = 'draft', classId = null, slotKey = null } = options;

  const version = await M.DraftVersion.findById(versionId).lean();
  if (!version) {
    throw new Error('Version snapshot not found');
  }

  const targetSnapshot = version.endSnapshot || {};
  const forwardOps = [];

  if (scope === 'slot' && classId && slotKey) {
    const classGrid = targetSnapshot[String(classId)] || [];
    const targetSlot = classGrid.find(s => normalizeSlotKey(s.day, s.period) === slotKey) || null;
    forwardOps.push({
      clientOpId: `rst_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      classId,
      slotKey,
      type: targetSlot ? 'restore' : 'slot.clear',
      after: targetSlot,
      editedAt: new Date()
    });
  } else if (scope === 'class' && classId) {
    const targetGrid = targetSnapshot[String(classId)] || [];
    const currentClassDraft = await M.WorkspaceClassDraft.findOne({
      workspaceId: workspaceId || draftId,
      classId
    }).lean();
    const currentGrid = currentClassDraft?.grid || [];

    // Find slots to set or clear
    const targetSlotMap = new Map();
    targetGrid.forEach(s => targetSlotMap.set(normalizeSlotKey(s.day, s.period), s));

    const currentSlotMap = new Map();
    currentGrid.forEach(s => currentSlotMap.set(normalizeSlotKey(s.day, s.period), s));

    // Slots present in target
    for (const [sk, targetSlot] of targetSlotMap.entries()) {
      forwardOps.push({
        clientOpId: `rst_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        classId,
        slotKey: sk,
        type: 'restore',
        after: targetSlot,
        editedAt: new Date()
      });
    }

    // Slots cleared in target
    for (const sk of currentSlotMap.keys()) {
      if (!targetSlotMap.has(sk)) {
        forwardOps.push({
          clientOpId: `rst_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          classId,
          slotKey: sk,
          type: 'slot.clear',
          after: null,
          editedAt: new Date()
        });
      }
    }
  } else {
    // Whole draft scope
    for (const [cId, targetGrid] of Object.entries(targetSnapshot)) {
      const currentClassDraft = await M.WorkspaceClassDraft.findOne({
        workspaceId: workspaceId || draftId,
        classId: cId
      }).lean();
      const currentGrid = currentClassDraft?.grid || [];

      const targetSlotMap = new Map();
      targetGrid.forEach(s => targetSlotMap.set(normalizeSlotKey(s.day, s.period), s));

      const currentSlotMap = new Map();
      currentGrid.forEach(s => currentSlotMap.set(normalizeSlotKey(s.day, s.period), s));

      for (const [sk, targetSlot] of targetSlotMap.entries()) {
        forwardOps.push({
          clientOpId: `rst_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          classId: cId,
          slotKey: sk,
          type: 'restore',
          after: targetSlot,
          editedAt: new Date()
        });
      }

      for (const sk of currentSlotMap.keys()) {
        if (!targetSlotMap.has(sk)) {
          forwardOps.push({
            clientOpId: `rst_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            classId: cId,
            slotKey: sk,
            type: 'slot.clear',
            after: null,
            editedAt: new Date()
          });
        }
      }
    }
  }

  // Execute restore forward operations
  const result = await applyDraftOps(draftRef, forwardOps, {
    _id: actor._id,
    name: actor.name || 'System Restore'
  });

  return {
    ok: true,
    restoredVersionId: versionId,
    operationsApplied: forwardOps.length,
    seq: result.seq
  };
}

/**
 * Reverses a single operation by appending its inverse operation (Section 9.3)
 */
async function undoDraftOp(draftRef, targetSeq, actor = {}) {
  const { draftId, workspaceId } = draftRef;
  const op = await M.DraftOp.findOne({ draftId, seq: Number(targetSeq) }).lean();
  if (!op) {
    throw new Error(`Operation with seq ${targetSeq} not found`);
  }

  const inverseOp = {
    clientOpId: `undo_${op.seq}_${Date.now()}`,
    classId: op.classId,
    slotKey: op.slotKey,
    type: op.before ? 'slot.set' : 'slot.clear',
    after: op.before || null,
    editedAt: new Date()
  };

  const result = await applyDraftOps(draftRef, [inverseOp], actor);
  return {
    ok: true,
    undoneSeq: op.seq,
    newSeq: result.seq
  };
}

module.exports = {
  normalizeSlotKey,
  getIstBucket,
  formatVersionLabel,
  applyDraftOps,
  getDraftSnapshot,
  encodeDictionarySnapshot,
  decodeDictionarySnapshot,
  getDraftChanges,
  restoreDraftVersion,
  undoDraftOp
};
