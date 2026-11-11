const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { isSudo, isSudoAdmin } = require('../utils/access');
const { logAction, getNextLogTrackId } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');

/**
 * Access helper for Responsibilities:
 * - Super/Sudo Admin: All operations
 * - HOD: View all, edit department-scoped within their department
 */
function canManageResponsibilities(req, targetScope = 'institute', targetDeptId = null) {
  if (!req.user) return false;
  if (isSudo(req) || isSudoAdmin(req.user) || req.user.role === 'admin') return true;
  if (req.user.isHod && targetScope === 'department') {
    if (!targetDeptId) return true;
    const userDeptId = String(req.user.deptId || '');
    return userDeptId === String(targetDeptId);
  }
  return false;
}

// GET /api/responsibilities — list responsibilities
router.get('/', authMiddleware, async (req, res) => {
  try {
    const filter = {};
    if (req.query.scope) filter.scope = sanitizeToString(req.query.scope);
    if (req.query.deptId) filter.deptId = sanitizeToString(req.query.deptId);

    const list = await M.Responsibility.find(filter)
      .populate('deptId', 'name code')
      .populate('assignedTeachers', 'fullName name trackId employeeNo department designation')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ ok: true, message: 'Responsibilities retrieved', data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/responsibilities/:id — get single
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const item = await M.Responsibility.findById(req.params.id)
      .populate('deptId', 'name code')
      .populate('assignedTeachers', 'fullName name trackId employeeNo department designation')
      .lean();

    if (!item) return res.status(404).json({ error: 'Responsibility not found' });
    res.json({ ok: true, message: 'Responsibility retrieved', data: item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/responsibilities — create responsibility
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, scope, workloadPeriodsPerWeek, deptId, deptName } = req.body;
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Responsibility name is required' });
    }
    const workload = Number(workloadPeriodsPerWeek);
    if (isNaN(workload) || workload < 0) {
      return res.status(400).json({ error: 'Valid workload periods per week required (>= 0)' });
    }

    const assignedScope = scope === 'department' ? 'department' : 'institute';
    if (!canManageResponsibilities(req, assignedScope, deptId)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions to create this responsibility' });
    }

    const trackId = `TR-RES-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const actorName = req.user.name || req.user.fullName || req.user.username || 'Admin';

    const respDoc = await M.Responsibility.create({
      trackId,
      name: name.trim(),
      scope: assignedScope,
      workloadPeriodsPerWeek: workload,
      deptId: assignedScope === 'department' ? deptId || null : null,
      deptName: assignedScope === 'department' ? deptName || '' : '',
      assignedTeachers: [],
      createdBy: actorName
    });

    const nextLogTrackId = await getNextLogTrackId();
    await logAction(
      req.user.trackId,
      actorName,
      req.user.role || 'admin',
      'Responsibility Created',
      `Created responsibility "${respDoc.name}" with workload ${respDoc.workloadPeriodsPerWeek} periods/wk`,
      'responsibilities',
      'info',
      req.ip,
      req.user.sessionId,
      { responsibilityId: respDoc._id, trackId: nextLogTrackId }
    );

    res.status(201).json({ ok: true, message: 'Responsibility created', data: respDoc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/responsibilities/:id — update responsibility
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const item = await M.Responsibility.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Responsibility not found' });

    if (!canManageResponsibilities(req, item.scope, item.deptId)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions to update this responsibility' });
    }

    const { name, scope, workloadPeriodsPerWeek, deptId, deptName } = req.body;
    if (name !== undefined) item.name = name.trim();
    if (workloadPeriodsPerWeek !== undefined) {
      const w = Number(workloadPeriodsPerWeek);
      if (isNaN(w) || w < 0) return res.status(400).json({ error: 'Workload must be >= 0' });
      item.workloadPeriodsPerWeek = w;
    }
    if (scope !== undefined) item.scope = scope === 'department' ? 'department' : 'institute';
    if (deptId !== undefined) item.deptId = item.scope === 'department' ? deptId : null;
    if (deptName !== undefined) item.deptName = item.scope === 'department' ? deptName : '';

    await item.save();

    const actorName = req.user.name || req.user.fullName || req.user.username || 'Admin';
    const nextLogTrackId = await getNextLogTrackId();
    await logAction(
      req.user.trackId,
      actorName,
      req.user.role || 'admin',
      'Responsibility Updated',
      `Updated responsibility "${item.name}"`,
      'responsibilities',
      'info',
      req.ip,
      req.user.sessionId,
      { responsibilityId: item._id, trackId: nextLogTrackId }
    );

    res.json({ ok: true, message: 'Responsibility updated', data: item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/responsibilities/:id — delete responsibility
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const item = await M.Responsibility.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Responsibility not found' });

    if (!canManageResponsibilities(req, item.scope, item.deptId)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions to delete this responsibility' });
    }

    // Unassign from all teachers first
    await M.Teacher.updateMany(
      { responsibilities: item._id },
      { $pull: { responsibilities: item._id } }
    );

    await M.Responsibility.findByIdAndDelete(req.params.id);

    const actorName = req.user.name || req.user.fullName || req.user.username || 'Admin';
    const nextLogTrackId = await getNextLogTrackId();
    await logAction(
      req.user.trackId,
      actorName,
      req.user.role || 'admin',
      'Responsibility Deleted',
      `Deleted responsibility "${item.name}"`,
      'responsibilities',
      'warning',
      req.ip,
      req.user.sessionId,
      { responsibilityId: item._id, trackId: nextLogTrackId }
    );

    res.json({ ok: true, message: 'Responsibility deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/responsibilities/:id/assign — assign teacher(s)
router.post('/:id/assign', authMiddleware, async (req, res) => {
  try {
    const item = await M.Responsibility.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Responsibility not found' });

    if (!canManageResponsibilities(req, item.scope, item.deptId)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }

    const { teacherIds } = req.body;
    if (!Array.isArray(teacherIds) || teacherIds.length === 0) {
      return res.status(400).json({ error: 'teacherIds array is required' });
    }

    // Add to responsibility
    await M.Responsibility.findByIdAndUpdate(item._id, {
      $addToSet: { assignedTeachers: { $each: teacherIds } }
    });

    // Add to each teacher document
    await M.Teacher.updateMany(
      { _id: { $in: teacherIds } },
      { $addToSet: { responsibilities: item._id } }
    );

    const updated = await M.Responsibility.findById(item._id)
      .populate('assignedTeachers', 'fullName name trackId employeeNo department designation')
      .lean();

    res.json({ ok: true, message: 'Teachers assigned successfully', data: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/responsibilities/:id/unassign — unassign teacher
router.post('/:id/unassign', authMiddleware, async (req, res) => {
  try {
    const item = await M.Responsibility.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Responsibility not found' });

    if (!canManageResponsibilities(req, item.scope, item.deptId)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }

    const { teacherId } = req.body;
    if (!teacherId) return res.status(400).json({ error: 'teacherId is required' });

    await M.Responsibility.findByIdAndUpdate(item._id, {
      $pull: { assignedTeachers: teacherId }
    });

    await M.Teacher.findByIdAndUpdate(teacherId, {
      $pull: { responsibilities: item._id }
    });

    const updated = await M.Responsibility.findById(item._id)
      .populate('assignedTeachers', 'fullName name trackId employeeNo department designation')
      .lean();

    res.json({ ok: true, message: 'Teacher unassigned successfully', data: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
