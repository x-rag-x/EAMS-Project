/**
 * services/timetableDiff.js
 *
 * Generalised, span-aware diffing between two timetable grids.
 * Used by compare, submit, the approval screen, deploy notifications, and history.
 */

const M = require('../models');

/**
 * Normalize an individual slot object
 */
function normalizeSlot(slot) {
  if (!slot) return null;
  let p = slot.period;
  if (typeof p === 'string') {
    p = parseInt(p.replace(/\D/g, ''), 10) || 1;
  } else if (typeof p !== 'number') {
    p = 1;
  }
  const span = Math.max(1, Number(slot.span ?? slot.duration ?? 1) || 1);
  const isLab = Boolean(slot.isLab ?? (slot.type === 'Lab'));

  return {
    ...slot,
    day: String(slot.day || '').trim(),
    period: p,
    span,
    isLab,
    subject: String(slot.subject || slot.subjectName || '').trim(),
    subjectId: slot.subjectId ? String(slot.subjectId) : null,
    subjectCode: String(slot.subjectCode || slot.code || '').trim(),
    teacher: String(slot.teacher || slot.teacherName || '').trim(),
    teacherId: slot.teacherId ? String(slot.teacherId) : null,
    teacherTrackId: String(slot.teacherTrackId || slot.trackId || '').trim(),
    room: String(slot.room || slot.hallNo || '').trim(),
    roomId: slot.roomId ? String(slot.roomId) : null,
    activityId: slot.activityId ? String(slot.activityId) : null,
    activityLabel: String(slot.activityLabel || '').trim(),
    combinedGroupId: slot.combinedGroupId ? String(slot.combinedGroupId) : null,
    note: String(slot.note || slot.comment || '').trim()
  };
}

/**
 * Compare two slots for semantic equality
 */
function areSlotsEqual(s1, s2) {
  if (!s1 || !s2) return false;
  return (
    s1.subject === s2.subject &&
    s1.teacher === s2.teacher &&
    s1.room === s2.room &&
    s1.isLab === s2.isLab &&
    s1.span === s2.span &&
    s1.activityId === s2.activityId &&
    s1.activityLabel === s2.activityLabel &&
    s1.combinedGroupId === s2.combinedGroupId &&
    s1.note === s2.note
  );
}

/**
 * Extract per-field differences between two slots
 */
function getSlotChanges(before, after) {
  const changes = [];
  if (before.subject !== after.subject) {
    changes.push({ field: 'subject', label: 'Subject', from: before.subject || '—', to: after.subject || '—' });
  }
  if (before.teacher !== after.teacher) {
    changes.push({ field: 'teacher', label: 'Faculty', from: before.teacher || '—', to: after.teacher || '—' });
  }
  if (before.room !== after.room) {
    changes.push({ field: 'room', label: 'Room', from: before.room || '—', to: after.room || '—' });
  }
  if (before.isLab !== after.isLab) {
    changes.push({ field: 'type', label: 'Type', from: before.isLab ? 'Lab' : 'Theory', to: after.isLab ? 'Lab' : 'Theory' });
  }
  if (before.span !== after.span) {
    changes.push({ field: 'span', label: 'Duration', from: `${before.span} Period(s)`, to: `${after.span} Period(s)` });
  }
  if (before.activityLabel !== after.activityLabel) {
    changes.push({ field: 'activity', label: 'Activity', from: before.activityLabel || '—', to: after.activityLabel || '—' });
  }
  if (before.note !== after.note) {
    changes.push({ field: 'note', label: 'Note', from: before.note || '—', to: after.note || '—' });
  }
  return changes;
}

/**
 * Diff two timetable grids keyed by (day, rootPeriod), span-aware.
 *
 * @param {Array} oldGrid - Baseline or production grid
 * @param {Array} newGrid - Draft or commit grid
 * @param {Object} [options]
 * @returns {Object} { added, removed, modified, unchangedCount, stats, teacherStats, roomStats }
 */
function diffGrids(oldGrid = [], newGrid = [], options = {}) {
  const oldNorm = (Array.isArray(oldGrid) ? oldGrid : Object.values(oldGrid || {}))
    .map(normalizeSlot)
    .filter(s => s && s.day);
  const newNorm = (Array.isArray(newGrid) ? newGrid : Object.values(newGrid || {}))
    .map(normalizeSlot)
    .filter(s => s && s.day);

  const oldRootMap = new Map();
  const oldPeriodMap = new Map(); // (day_period) -> root slot
  for (const s of oldNorm) {
    const rootKey = `${s.day}_${s.period}`;
    oldRootMap.set(rootKey, s);
    for (let offset = 0; offset < s.span; offset++) {
      oldPeriodMap.set(`${s.day}_${s.period + offset}`, s);
    }
  }

  const newRootMap = new Map();
  const newPeriodMap = new Map();
  for (const s of newNorm) {
    const rootKey = `${s.day}_${s.period}`;
    newRootMap.set(rootKey, s);
    for (let offset = 0; offset < s.span; offset++) {
      newPeriodMap.set(`${s.day}_${s.period + offset}`, s);
    }
  }

  const added = [];
  const removed = [];
  const modified = [];
  let unchangedCount = 0;

  const teacherStats = new Map();
  const roomStats = new Map();

  function recordTeacherDelta(name, id, trackId, kind) {
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName === 'Unassigned' || cleanName === 'TBA') return;
    const key = id ? `id:${id}` : `name:${cleanName.toLowerCase()}`;
    if (!teacherStats.has(key)) {
      teacherStats.set(key, {
        teacherId: id || null,
        trackId: trackId || '',
        name: cleanName,
        total: 0,
        added: 0,
        removed: 0,
        modified: 0
      });
    }
    const entry = teacherStats.get(key);
    entry.total += 1;
    if (kind === 'added') entry.added += 1;
    else if (kind === 'removed') entry.removed += 1;
    else if (kind === 'modified') entry.modified += 1;
  }

  function recordRoomDelta(room, id, kind) {
    const cleanRoom = String(room || '').trim();
    if (!cleanRoom) return;
    const key = id ? `id:${id}` : cleanRoom.toLowerCase();
    if (!roomStats.has(key)) {
      roomStats.set(key, {
        roomId: id || null,
        room: cleanRoom,
        total: 0,
        added: 0,
        removed: 0,
        modified: 0
      });
    }
    const entry = roomStats.get(key);
    entry.total += 1;
    if (kind === 'added') entry.added += 1;
    else if (kind === 'removed') entry.removed += 1;
    else if (kind === 'modified') entry.modified += 1;
  }

  const processedOldRoots = new Set();

  for (const [newKey, newSlot] of newRootMap.entries()) {
    const oldSlot = oldRootMap.get(newKey);
    if (oldSlot) {
      processedOldRoots.add(newKey);
      if (areSlotsEqual(oldSlot, newSlot)) {
        unchangedCount += 1;
      } else {
        const changes = getSlotChanges(oldSlot, newSlot);
        modified.push({
          day: newSlot.day,
          period: newSlot.period,
          span: newSlot.span,
          before: oldSlot,
          after: newSlot,
          changes
        });
        if (newSlot.teacher === oldSlot.teacher && newSlot.teacherId === oldSlot.teacherId) {
          recordTeacherDelta(newSlot.teacher, newSlot.teacherId, newSlot.teacherTrackId, 'modified');
        } else {
          recordTeacherDelta(newSlot.teacher, newSlot.teacherId, newSlot.teacherTrackId, 'added');
          recordTeacherDelta(oldSlot.teacher, oldSlot.teacherId, oldSlot.teacherTrackId, 'removed');
        }
        if (newSlot.room === oldSlot.room && newSlot.roomId === oldSlot.roomId) {
          recordRoomDelta(newSlot.room, newSlot.roomId, 'modified');
        } else {
          recordRoomDelta(newSlot.room, newSlot.roomId, 'added');
          recordRoomDelta(oldSlot.room, oldSlot.roomId, 'removed');
        }
      }
    } else {
      // Check if newSlot spans over any old periods
      let overlappedOldSlot = null;
      for (let offset = 0; offset < newSlot.span; offset++) {
        const covered = oldPeriodMap.get(`${newSlot.day}_${newSlot.period + offset}`);
        if (covered) {
          overlappedOldSlot = covered;
          break;
        }
      }

      if (overlappedOldSlot) {
        processedOldRoots.add(`${overlappedOldSlot.day}_${overlappedOldSlot.period}`);
        const changes = getSlotChanges(overlappedOldSlot, newSlot);
        modified.push({
          day: newSlot.day,
          period: newSlot.period,
          span: newSlot.span,
          before: overlappedOldSlot,
          after: newSlot,
          changes
        });
        recordTeacherDelta(newSlot.teacher, newSlot.teacherId, newSlot.teacherTrackId, 'added');
        recordTeacherDelta(overlappedOldSlot.teacher, overlappedOldSlot.teacherId, overlappedOldSlot.teacherTrackId, 'removed');
        recordRoomDelta(newSlot.room, newSlot.roomId, 'added');
        recordRoomDelta(overlappedOldSlot.room, overlappedOldSlot.roomId, 'removed');
      } else {
        added.push(newSlot);
        recordTeacherDelta(newSlot.teacher, newSlot.teacherId, newSlot.teacherTrackId, 'added');
        recordRoomDelta(newSlot.room, newSlot.roomId, 'added');
      }
    }
  }

  // Detect removed old slots
  for (const [oldKey, oldSlot] of oldRootMap.entries()) {
    if (!processedOldRoots.has(oldKey)) {
      // Check if any new slot covers this old slot's periods
      let coveredByNew = false;
      for (let offset = 0; offset < oldSlot.span; offset++) {
        if (newPeriodMap.has(`${oldSlot.day}_${oldSlot.period + offset}`)) {
          coveredByNew = true;
          break;
        }
      }
      if (!coveredByNew) {
        removed.push(oldSlot);
        recordTeacherDelta(oldSlot.teacher, oldSlot.teacherId, oldSlot.teacherTrackId, 'removed');
        recordRoomDelta(oldSlot.room, oldSlot.roomId, 'removed');
      }
    }
  }

  return {
    added,
    removed,
    modified,
    unchangedCount,
    stats: {
      totalSlots: newNorm.length,
      addedCount: added.length,
      removedCount: removed.length,
      modifiedCount: modified.length,
      unchangedCount
    },
    teacherStats: Array.from(teacherStats.values()),
    roomStats: Array.from(roomStats.values())
  };
}

/**
 * Backward-compatible publish diff evaluator
 *
 * @param {Object} draftTemplate - SemesterTemplate document or draft payload with classId and grid
 * @returns {Promise<Object>}
 */
async function computePublishDiff(draftTemplate) {
  if (!draftTemplate?.classId) {
    throw new Error('draftTemplate.classId is required');
  }

  const classId = draftTemplate.classId;

  // Find current published template or fallback to active section timetable
  const currentPublished = await M.SemesterTemplate.findOne({
    classId,
    status: 'published',
    ...(draftTemplate._id ? { _id: { $ne: draftTemplate._id } } : {})
  }).lean();

  let prodGrid = [];
  if (currentPublished && Array.isArray(currentPublished.grid)) {
    prodGrid = currentPublished.grid;
  } else {
    const sec = await M.SectionTimetable.findOne({ classId }).lean();
    if (sec && sec.slots && typeof sec.slots === 'object') {
      prodGrid = Object.values(sec.slots).filter(Boolean);
    }
  }

  const diffResult = diffGrids(prodGrid, draftTemplate.grid || []);

  // Enrich affected teachers with DB documents
  const teacherNames = diffResult.teacherStats.map(t => t.name).filter(Boolean);
  const teacherDocs = teacherNames.length
    ? await M.Teacher.find({
        $or: [
          { _id: { $in: diffResult.teacherStats.map(t => t.teacherId).filter(Boolean) } },
          { fullName: { $in: teacherNames } }
        ]
      }).select('_id fullName trackId email employeeNo').lean()
    : [];

  const teacherDocMap = new Map();
  for (const t of teacherDocs) {
    teacherDocMap.set(String(t._id), t);
    teacherDocMap.set(t.fullName.toLowerCase(), t);
  }

  const affectedTeachers = diffResult.teacherStats.map(stat => {
    const doc = (stat.teacherId && teacherDocMap.get(String(stat.teacherId))) ||
      teacherDocMap.get(stat.name.toLowerCase());
    return {
      name: stat.name,
      teacherId: doc ? doc._id : stat.teacherId || null,
      trackId: doc ? doc.trackId : stat.trackId || '',
      email: doc ? doc.email : '',
      totalChanges: stat.total,
      added: stat.added,
      removed: stat.removed,
      modified: stat.modified
    };
  });

  const affectedStudentsCount = await M.Student.countDocuments({ classId });
  const cls = await M.Class.findById(classId).select('name deptName deptId').lean();

  return {
    className: cls ? cls.name : 'Unknown Class',
    classId,
    diff: {
      added: diffResult.added,
      removed: diffResult.removed,
      modified: diffResult.modified,
      unchangedCount: diffResult.unchangedCount
    },
    stats: diffResult.stats,
    teacherStats: diffResult.teacherStats,
    roomStats: diffResult.roomStats,
    affectedTeachers,
    affectedStudentsCount
  };
}

module.exports = {
  normalizeSlot,
  areSlotsEqual,
  getSlotChanges,
  diffGrids,
  computePublishDiff
};
