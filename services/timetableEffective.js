const mongoose = require('mongoose');
const M = require('../models');

// LRU / TTL cache for effective read model
const effectiveCache = new Map();
const CACHE_MAX = 200;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

/**
 * Invalidates cache for a specific workspace or all effective views
 */
function invalidateEffectiveCache(workspaceId = null) {
  if (!workspaceId) {
    effectiveCache.clear();
    return;
  }
  const prefix = `development:${String(workspaceId)}:`;
  for (const key of effectiveCache.keys()) {
    if (key.startsWith(prefix) || key.startsWith('production:')) {
      effectiveCache.delete(key);
    }
  }
}

/**
 * Converts a grid array of [GridSlot] to a slots object keyed by `${day}_${period}`
 * Expanding multi-period spans.
 */
function gridToSlotsObj(grid = [], className = '') {
  const slots = {};
  if (!Array.isArray(grid)) return slots;

  for (const item of grid) {
    if (!item || !item.day || item.period === undefined || item.period === null) continue;
    const startPeriod = typeof item.period === 'number'
      ? item.period
      : (parseInt(String(item.period).replace(/^P/i, ''), 10) || 1);
    const span = Math.max(1, Number(item.span || item.duration || 1));

    const isLab = Boolean(item.isLab ?? (item.type === 'Lab' || span > 1));
    const combinedWith = Array.isArray(item.combinedWith)
      ? item.combinedWith.filter(Boolean)
      : (item.combinedWith ? [String(item.combinedWith)] : []);
    const type = item.type || (isLab ? 'Lab' : (combinedWith.length > 0 ? 'Combined' : 'Theory'));

    for (let offset = 0; offset < span; offset++) {
      const currentPeriod = startPeriod + offset;
      const key = `${item.day}_${currentPeriod}`;

      slots[key] = {
        day: item.day,
        period: currentPeriod,
        subject: item.subject || '',
        subjectId: item.subjectId || null,
        subjectCode: item.subjectCode || '',
        teacher: item.teacher || item.teacherName || '',
        teacherId: item.teacherId || null,
        teacherTrackId: item.teacherTrackId || '',
        room: item.room || item.hallNo || '',
        roomId: item.roomId || undefined,
        span,
        spanRootPeriod: startPeriod,
        spanIndex: offset,
        isSpanContinuation: offset > 0,
        isLab,
        type,
        combinedWith,
        combinedGroupId: item.combinedGroupId || null,
        reservedForDeptId: item.reservedForDeptId || null,
        reservedLabel: item.reservedLabel || '',
        state: item.state || '',
        activityId: item.activityId || null,
        activityLabel: item.activityLabel || '',
        primaryClassId: item.primaryClassId || undefined,
        primaryClassName: item.primaryClassName || className || undefined,
        note: item.note || ''
      };
    }
  }
  return slots;
}

/**
 * Converts a slots object { [day_period]: slot } to a canonical [GridSlot] array,
 * omitting continuation slots for multi-period spans.
 */
function slotsToGrid(slots = {}) {
  if (Array.isArray(slots)) return slots;
  if (!slots || typeof slots !== 'object') return [];

  const items = Object.values(slots).filter(Boolean);
  const rootSlots = [];

  for (const item of items) {
    if (item.isSpanContinuation && item.spanIndex > 0) {
      continue;
    }
    const startPeriod = typeof item.spanRootPeriod === 'number'
      ? item.spanRootPeriod
      : (typeof item.period === 'number' ? item.period : 1);

    rootSlots.push({
      day: item.day,
      period: startPeriod,
      span: item.span || 1,
      spanRootPeriod: startPeriod,
      spanIndex: 0,
      isSpanContinuation: false,
      subject: item.subject || '',
      subjectId: item.subjectId || null,
      subjectCode: item.subjectCode || '',
      teacher: item.teacher || item.teacherName || '',
      teacherId: item.teacherId || null,
      teacherTrackId: item.teacherTrackId || '',
      room: item.room || item.hallNo || '',
      roomId: item.roomId || null,
      isLab: Boolean(item.isLab),
      type: item.type || (item.isLab ? 'Lab' : 'Theory'),
      combinedWith: Array.isArray(item.combinedWith) ? item.combinedWith : [],
      combinedGroupId: item.combinedGroupId || null,
      reservedForDeptId: item.reservedForDeptId || null,
      reservedLabel: item.reservedLabel || '',
      state: item.state || '',
      activityId: item.activityId || null,
      activityLabel: item.activityLabel || '',
      primaryClassId: item.primaryClassId || null,
      primaryClassName: item.primaryClassName || '',
      note: item.note || ''
    });
  }

  return rootSlots;
}

/**
 * Canonical read model for timetables: answers what the timetable looks like.
 *
 * @param {Object} params
 * @param {'production'|'development'} [params.env='production']
 * @param {string|ObjectId} [params.workspaceId]
 * @param {string|ObjectId} [params.deptId]
 * @param {Array<string|ObjectId>|string|ObjectId} [params.classIds]
 * @returns {Promise<Array<Object>>}
 */
async function getEffective({ env = 'production', workspaceId = null, deptId = null, classIds = null } = {}) {
  const normEnv = env === 'development' ? 'development' : 'production';
  const filterClassIds = classIds
    ? (Array.isArray(classIds) ? classIds : [classIds]).filter(Boolean).map(String)
    : [];
  const filterDeptId = deptId ? String(deptId) : null;

  // ── 1. Production Mode ──
  if (normEnv === 'production' || !workspaceId) {
    const q = {};
    if (filterClassIds.length > 0) {
      q.classId = filterClassIds.length === 1 ? filterClassIds[0] : { $in: filterClassIds };
    }
    if (filterDeptId) {
      q.deptId = filterDeptId;
    }

    const prodDocs = await M.SectionTimetable.find(q).lean();
    return prodDocs.map(doc => ({
      classId: doc.classId,
      className: doc.className || '',
      deptId: doc.deptId || null,
      deptName: doc.deptName || '',
      slots: doc.slots || {},
      _source: 'production',
      headTrackId: doc.headTrackId || null,
      headSeq: doc.headSeq || 0,
      headVersion: doc.headVersion || 0
    }));
  }

  // ── 2. Development Mode (Workspace) ──
  let ws = null;
  if (mongoose.isValidObjectId(workspaceId)) {
    ws = await M.TimetableWorkspace.findById(workspaceId).lean();
  }
  if (!ws) {
    ws = await M.TimetableWorkspace.findOne({
      $or: [
        ...(mongoose.isValidObjectId(workspaceId) ? [{ _id: workspaceId }] : []),
        { trackId: String(workspaceId) }
      ]
    }).lean();
  }
  if (!ws) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  // Load drafts for this workspace
  const draftQuery = { workspaceId: ws._id };
  if (filterClassIds.length > 0) {
    draftQuery.classId = filterClassIds.length === 1 ? filterClassIds[0] : { $in: filterClassIds };
  }
  const drafts = await M.WorkspaceClassDraft.find(draftQuery).lean();
  const draftMap = new Map();
  for (const d of drafts) {
    draftMap.set(String(d.classId), d);
  }

  // Build target class set:
  // - If classIds filtered: exactly those classIds
  // - Else: classes enrolled in workspace + production classes of the workspace's department
  const targetClassIdSet = new Set();
  if (filterClassIds.length > 0) {
    filterClassIds.forEach(id => targetClassIdSet.add(id));
  } else {
    (ws.classIds || []).forEach(id => targetClassIdSet.add(String(id)));
    drafts.forEach(d => targetClassIdSet.add(String(d.classId)));

    // Also include production classes of the department
    const targetDept = filterDeptId || String(ws.deptId);
    if (targetDept) {
      const deptProd = await M.SectionTimetable.find({ deptId: targetDept }).select('classId').lean();
      deptProd.forEach(p => targetClassIdSet.add(String(p.classId)));
    }
  }

  const allTargetIds = Array.from(targetClassIdSet);

  // Fetch production copies for all candidate classes
  const prodDocs = await M.SectionTimetable.find({ classId: { $in: allTargetIds } }).lean();
  const prodMap = new Map();
  for (const p of prodDocs) {
    prodMap.set(String(p.classId), p);
  }

  // Fetch class metadata if needed
  const missingMeta = allTargetIds.filter(id => !prodMap.has(id));
  const classMetaMap = new Map();
  if (missingMeta.length > 0) {
    const classDocs = await M.Class.find({ _id: { $in: missingMeta } }).lean();
    for (const c of classDocs) {
      classMetaMap.set(String(c._id), c);
    }
  }

  const results = [];

  for (const cid of allTargetIds) {
    const draft = draftMap.get(cid);
    const prodDoc = prodMap.get(cid);
    const cls = classMetaMap.get(cid);

    const deptIdVal = prodDoc?.deptId || cls?.deptId || ws.deptId;
    if (filterDeptId && String(deptIdVal) !== String(filterDeptId)) {
      continue;
    }

    const className = draft?.className || prodDoc?.className || cls?.name || '';
    const deptName = prodDoc?.deptName || cls?.deptName || ws.deptName || '';

    if (draft) {
      // Workspace class draft takes precedence
      results.push({
        classId: draft.classId,
        className,
        deptId: deptIdVal,
        deptName,
        slots: gridToSlotsObj(draft.grid || [], className),
        _source: 'workspace',
        _workspaceId: String(workspaceId),
        _state: draft.state || 'editing',
        revision: draft.revision || 1,
        baseTrackId: draft.baseTrackId || null,
        baseSeq: draft.baseSeq || 0
      });
    } else if (prodDoc) {
      // Unmodified class falls through from production
      results.push({
        classId: prodDoc.classId,
        className,
        deptId: deptIdVal,
        deptName,
        slots: prodDoc.slots || {},
        _source: 'production',
        headTrackId: prodDoc.headTrackId || null,
        headSeq: prodDoc.headSeq || 0,
        headVersion: prodDoc.headVersion || 0
      });
    } else if (cls) {
      // Registered class with no timetable yet
      results.push({
        classId: cls._id,
        className,
        deptId: deptIdVal,
        deptName,
        slots: {},
        _source: 'production',
        headTrackId: null,
        headSeq: 0,
        headVersion: 0
      });
    }
  }

  return results;
}

module.exports = {
  getEffective,
  gridToSlotsObj,
  slotsToGrid,
  invalidateEffectiveCache
};
