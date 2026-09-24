const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, adminOnly, requireRight } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');

router.get('/', authMiddleware, async (req, res) => res.json(await M.Department.find().sort({ name: 1 }).lean()));

router.post('/', authMiddleware, adminOnly, requireRight('adderModules'), async (req, res) => {
  try {
    const dept = await M.Department.create(req.body);
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Department Added',
      `${dept.name} (${dept.deptNumber || dept.code || ''})`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'entry-create',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: null, after: dept.toObject ? dept.toObject() : dept }
      }
    );
    res.status(201).json(dept);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const before = await M.Department.findById(req.params.id).lean();
    const dept = await M.Department.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' }).lean();
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Department Updated',
      dept?.name || '',
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before, after: dept }
      }
    );
    res.json(dept);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authMiddleware, adminOnly, requireRight('deletings'), async (req, res) => {
  try {
    const dept = await M.Department.findById(req.params.id).lean();
    if (dept) {
      await M.UndoLog.create({
        collectionName: 'departments', label: `Department: ${dept.name}`,
        snapshot: dept, deletedBy: req.user.name, expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      });
      await M.Department.findByIdAndDelete(req.params.id);
    }
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Department Deleted',
      dept?.name || '',
      'data',
      'warning',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'entry-delete',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: dept, after: null }
      }
    );
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;