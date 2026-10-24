const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, requirePage } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');

/**
 * Helper: Restore a single UndoLog entry into its corresponding database collection
 */
async function restoreSingleEntry(entry, reqUser, reqIp, reqSessionId) {
  const snap = entry.snapshot;
  if (!snap || typeof snap !== 'object') {
    throw new Error('Corrupted or empty snapshot in recycle bin entry');
  }

  const { _id, __v, createdAt, updatedAt, ...cleanBody } = snap;
  let restored = null;
  const col = String(entry.collectionName || '').toLowerCase().trim();

  // Helper to preserve original _id if free, otherwise let Mongo generate a fresh _id
  async function insertWithIdPreservation(Model, body, origId) {
    if (origId) {
      try {
        const existing = await Model.findById(origId).lean();
        if (!existing) {
          return await Model.create({ ...body, _id: origId });
        }
      } catch (_) {
        // If query fails, fall back to creation without _id
      }
    }
    return await Model.create(body);
  }

  if (col === 'departments' || col === 'department' || col === 'depts') {
    restored = await insertWithIdPreservation(M.Department, cleanBody, _id);
  } else if (col === 'classes' || col === 'class') {
    restored = await insertWithIdPreservation(M.Class, cleanBody, _id);
  } else if (col === 'subjects' || col === 'subject') {
    restored = await insertWithIdPreservation(M.Subject, cleanBody, _id);
  } else if (col === 'students' || col === 'student') {
    restored = await insertWithIdPreservation(M.Student, cleanBody, _id);
    // Reactivate or recreate shadow user
    const uName = restored.username || cleanBody.username;
    if (uName) {
      const existingUser = await M.User.findOne({ username: uName });
      if (existingUser) {
        existingUser.status = 'active';
        existingUser.failedLogins = 0;
        existingUser.lockedUntil = null;
        await existingUser.save();
      } else {
        await M.User.create({
          username: uName,
          role: 'student',
          trackId: restored.trackId || cleanBody.trackId,
          status: 'active',
          password: cleanBody.password || '$2b$10$abcdefghijklmnopqrstuu' // safe fallback
        }).catch(() => {});
      }
    }
  } else if (col === 'teachers' || col === 'teacher') {
    const teacherData = {
      ...cleanBody,
      fullName: cleanBody.fullName || cleanBody.name,
      employeeNo: cleanBody.employeeNo || cleanBody.empId,
      department: cleanBody.department || cleanBody.dept,
      designation: cleanBody.designation || cleanBody.desig
    };
    restored = await insertWithIdPreservation(M.Teacher, teacherData, _id);
    const uName = restored.username || cleanBody.username;
    if (uName) {
      const existingUser = await M.User.findOne({ username: uName });
      if (existingUser) {
        existingUser.status = 'active';
        existingUser.failedLogins = 0;
        existingUser.lockedUntil = null;
        await existingUser.save();
      } else {
        await M.User.create({
          username: uName,
          role: 'teacher',
          trackId: restored.trackId || cleanBody.trackId,
          status: 'active',
          password: cleanBody.password || '$2b$10$abcdefghijklmnopqrstuu'
        }).catch(() => {});
      }
    }
  } else if (col === 'users' || col === 'user') {
    // Snapshot has { user: {...}, roleDoc: {...} } or user directly
    const userSnapshot = snap.user ? snap.user : cleanBody;
    const roleDocSnapshot = snap.roleDoc || null;
    const { _id: uId, __v: uV, ...cleanUserData } = userSnapshot;

    let targetUser = await M.User.findOne({ username: userSnapshot.username });
    if (targetUser) {
      targetUser.status = 'active';
      targetUser.online = false;
      targetUser.failedLogins = 0;
      targetUser.lockedUntil = null;
      await targetUser.save();
      restored = targetUser;
    } else {
      restored = await M.User.create({
        ...cleanUserData,
        status: 'active'
      });
    }

    // Restore associated role document if available
    if (roleDocSnapshot && typeof roleDocSnapshot === 'object') {
      const { _id: rId, __v: rV, ...cleanRoleData } = roleDocSnapshot;
      if (userSnapshot.role === 'student' && M.Student) {
        const existStu = await M.Student.findOne({ $or: [{ username: userSnapshot.username }, { trackId: userSnapshot.trackId }] });
        if (!existStu) await insertWithIdPreservation(M.Student, cleanRoleData, rId);
      } else if (userSnapshot.role === 'teacher' && M.Teacher) {
        const existTeach = await M.Teacher.findOne({ $or: [{ username: userSnapshot.username }, { trackId: userSnapshot.trackId }] });
        if (!existTeach) await insertWithIdPreservation(M.Teacher, cleanRoleData, rId);
      }
    }
  } else if (col === 'years' || col === 'year') {
    if (snap.yearId && snap.regulation) {
      const targetYear = await M.Year.findById(snap.yearId);
      if (targetYear) {
        if (!targetYear.regulations.some(r => r.code === snap.regulation.code)) {
          targetYear.regulations.push(snap.regulation);
          await targetYear.save();
        }
        restored = targetYear;
      } else {
        throw new Error('Associated academic year no longer exists');
      }
    } else {
      restored = await insertWithIdPreservation(M.Year, cleanBody, _id);
    }
  } else if (col === 'assignments' || col === 'assignment') {
    restored = await insertWithIdPreservation(M.Assignment, cleanBody, _id);
  } else if (col === 'exams' || col === 'exam') {
    restored = await insertWithIdPreservation(M.Exam, cleanBody, _id);
  } else if (col === 'timetable' || col === 'timetables') {
    restored = await insertWithIdPreservation(M.Timetable, cleanBody, _id);
  } else if (col === 'rooms' || col === 'room') {
    restored = await insertWithIdPreservation(M.Room, cleanBody, _id);
  } else if (col === 'calendar' || col === 'calendardays' || col === 'calendarday') {
    restored = await insertWithIdPreservation(M.CalendarDay, cleanBody, _id);
  } else if (col === 'notifications' || col === 'notification') {
    restored = await insertWithIdPreservation(M.Notification, cleanBody, _id);
  } else if (col === 'attendance' || col === 'classattendance') {
    restored = await insertWithIdPreservation(M.ClassAttendance, cleanBody, _id);
  } else if (col === 'templates' || col === 'exporttemplate') {
    restored = await insertWithIdPreservation(M.ExportTemplate, cleanBody, _id);
  } else {
    // Dynamic fallback for any other collection model in barrel
    const capitalized = col.charAt(0).toUpperCase() + col.slice(1).replace(/s$/, '');
    if (M[capitalized]) {
      restored = await insertWithIdPreservation(M[capitalized], cleanBody, _id);
    } else {
      throw new Error(`Cannot restore unsupported collection: ${entry.collectionName}`);
    }
  }

  // Remove from UndoLog
  await M.UndoLog.findByIdAndDelete(entry._id);

  // Emit audit log
  await logAction(
    reqUser.trackId || reqUser._id,
    reqUser.name || reqUser.username || 'Admin',
    reqUser.role || 'admin',
    'Recycle Bin Record Restored',
    entry.label,
    'data',
    'info',
    reqIp,
    reqSessionId,
    {
      module: 'control',
      subType: 'recycle-restore',
      collectionName: entry.collectionName,
      restoredId: restored?._id || _id,
      trackId: reqUser.trackId
    }
  );

  return { restored, label: entry.label, collectionName: entry.collectionName };
}

/**
 * GET /api/undo or /api/recycle-bin
 * Returns all active recycle bin entries with filtering, search, and metrics
 */
router.get('/', authMiddleware, requirePage('control', 'view'), async (req, res) => {
  try {
    const now = new Date();
    const filter = {
      $or: [
        { expiresAt: { $gt: now } },
        { expiresAt: { $gt: now.toISOString() } },
        { expiresAt: null },
        { expiresAt: { $exists: false } }
      ]
    };

    // Category filter
    const category = (req.query.category || req.query.collection || '').toLowerCase().trim();
    if (category && category !== 'all') {
      filter.collectionName = new RegExp(`^${category}`, 'i');
    }

    // Search query
    const q = (req.query.q || req.query.search || '').trim();
    if (q) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { label: { $regex: q, $options: 'i' } },
          { deletedBy: { $regex: q, $options: 'i' } },
          { collectionName: { $regex: q, $options: 'i' } }
        ]
      });
    }

    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
    const items = await M.UndoLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Compute live stats across all unexpired entries
    const allActive = await M.UndoLog.find({
      $or: [
        { expiresAt: { $gt: now } },
        { expiresAt: { $gt: now.toISOString() } },
        { expiresAt: null },
        { expiresAt: { $exists: false } }
      ]
    }).select('collectionName expiresAt createdAt label').lean();

    const categoryCounts = {};
    let expiringSoonCount = 0;
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;

    for (const item of allActive) {
      const c = (item.collectionName || 'other').toLowerCase();
      categoryCounts[c] = (categoryCounts[c] || 0) + 1;
      if (item.expiresAt) {
        const exp = new Date(item.expiresAt).getTime();
        if (exp - Date.now() <= twoDaysMs) {
          expiringSoonCount++;
        }
      }
    }

    const stats = {
      total: allActive.length,
      expiringSoon: expiringSoonCount,
      categoryCounts,
      retentionDays: 10,
      newest: allActive.length ? allActive[0].createdAt : null
    };

    // Support both direct items response and enriched payload
    if (req.query.plain === '1' || req.query.legacy === '1') {
      return res.json(items);
    }

    res.json({
      ok: true,
      items,
      stats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/undo/:id
 * Retrieve details and raw snapshot of a single deleted item for inspection
 */
router.get('/:id', authMiddleware, requirePage('control', 'view'), async (req, res) => {
  try {
    const entry = await M.UndoLog.findById(req.params.id).lean();
    if (!entry) {
      return res.status(404).json({ error: 'Recycle bin item not found or expired' });
    }
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/undo/bulk-restore
 * Restore multiple items in batch
 */
router.post('/bulk-restore', authMiddleware, requirePage('control', 'edit'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'Array of item IDs required for bulk restore' });
    }

    const results = { restored: [], failed: [] };
    for (const id of ids) {
      try {
        const entry = await M.UndoLog.findById(id).lean();
        if (!entry) {
          results.failed.push({ id, error: 'Item not found' });
          continue;
        }
        const outcome = await restoreSingleEntry(entry, req.user, req.ip, req.user.sessionId);
        results.restored.push({ id, label: outcome.label });
      } catch (e) {
        results.failed.push({ id, error: e.message });
      }
    }

    res.json({
      ok: true,
      restoredCount: results.restored.length,
      failedCount: results.failed.length,
      results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/undo/bulk-delete or DELETE /api/undo/bulk
 * Permanently delete multiple items
 */
const bulkDeleteHandler = async (req, res) => {
  try {
    const ids = req.body?.ids || req.query?.ids;
    const idArray = Array.isArray(ids) ? ids : (typeof ids === 'string' ? ids.split(',') : []);
    if (!idArray.length) {
      return res.status(400).json({ error: 'Array of item IDs required for bulk deletion' });
    }

    const items = await M.UndoLog.find({ _id: { $in: idArray } }).lean();
    for (const item of items) {
      if (item.collectionName === 'users' && item.snapshot?.user?.username) {
        const u = await M.User.findOne({ username: item.snapshot.user.username });
        if (u && u.status === 'inactive') {
          await M.User.deleteOne({ _id: u._id }).catch(() => {});
          await M.ActiveSession.deleteMany({ userId: u._id }).catch(() => {});
        }
      }
    }

    const result = await M.UndoLog.deleteMany({ _id: { $in: idArray } });

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username || 'Admin',
      req.user.role || 'admin',
      'Recycle Bin Items Permanently Deleted',
      `Permanently purged ${result.deletedCount} item(s)`,
      'data',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'control', subType: 'recycle-bulk-delete', count: result.deletedCount }
    );

    res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

router.post('/bulk-delete', authMiddleware, requirePage('control', 'delete'), bulkDeleteHandler);
router.delete('/bulk', authMiddleware, requirePage('control', 'delete'), bulkDeleteHandler);

/**
 * DELETE /api/undo/empty or POST /api/undo/empty
 * Permanently empty all items from Recycle Bin
 */
const emptyBinHandler = async (req, res) => {
  try {
    const category = (req.query.category || req.body?.category || '').trim();
    const filter = category && category !== 'all' ? { collectionName: new RegExp(`^${category}`, 'i') } : {};

    const items = await M.UndoLog.find(filter).lean();
    const count = items.length;

    // If users were in bin and permanently purged, delete deactivated User records
    for (const item of items) {
      if (item.collectionName === 'users' && item.snapshot?.user?.username) {
        const u = await M.User.findOne({ username: item.snapshot.user.username });
        if (u && u.status === 'inactive') {
          await M.User.deleteOne({ _id: u._id }).catch(() => {});
          await M.ActiveSession.deleteMany({ userId: u._id }).catch(() => {});
        }
      }
    }

    await M.UndoLog.deleteMany(filter);

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username || 'Admin',
      req.user.role || 'admin',
      'Recycle Bin Emptied',
      `Permanently purged ${count} item(s)${category ? ` in category '${category}'` : ''}`,
      'data',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'control', subType: 'recycle-empty', count, category }
    );

    res.json({ ok: true, purgedCount: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

router.delete('/empty', authMiddleware, requirePage('control', 'delete'), emptyBinHandler);
router.post('/empty', authMiddleware, requirePage('control', 'delete'), emptyBinHandler);

/**
 * POST /api/undo/:id or /api/undo/:id/restore
 * Restore an individual record back to active database
 */
router.post('/:id/restore', authMiddleware, requirePage('control', 'edit'), async (req, res) => {
  try {
    const entry = await M.UndoLog.findById(req.params.id).lean();
    if (!entry) return res.status(404).json({ error: 'Recycle bin entry not found or expired' });

    const result = await restoreSingleEntry(entry, req.user, req.ip, req.user.sessionId);
    res.json({ ok: true, restored: true, label: result.label, collectionName: result.collectionName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id', authMiddleware, requirePage('control', 'edit'), async (req, res) => {
  try {
    const entry = await M.UndoLog.findById(req.params.id).lean();
    if (!entry) return res.status(404).json({ error: 'Recycle bin entry not found or expired' });

    const result = await restoreSingleEntry(entry, req.user, req.ip, req.user.sessionId);
    res.json({ ok: true, restored: true, label: result.label, collectionName: result.collectionName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/undo/:id
 * Permanently purge a single item from the database
 */
router.delete('/:id', authMiddleware, requirePage('control', 'delete'), async (req, res) => {
  try {
    const entry = await M.UndoLog.findById(req.params.id).lean();
    if (!entry) {
      return res.status(404).json({ error: 'Item not found or already deleted' });
    }

    // If soft-deleted user, purge user record permanently
    if (entry.collectionName === 'users' && entry.snapshot?.user?.username) {
      const u = await M.User.findOne({ username: entry.snapshot.user.username });
      if (u && u.status === 'inactive') {
        await M.User.deleteOne({ _id: u._id }).catch(() => {});
        await M.ActiveSession.deleteMany({ userId: u._id }).catch(() => {});
      }
    }

    await M.UndoLog.findByIdAndDelete(req.params.id);

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username || 'Admin',
      req.user.role || 'admin',
      'Recycle Bin Item Permanently Deleted',
      entry.label,
      'data',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'control', subType: 'recycle-permanent-delete', label: entry.label }
    );

    res.json({ ok: true, deleted: true, permanent: true, label: entry.label });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;