const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, requirePage } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const countService = require('../services/countService');

const allowedDepartmentFields = [
  'name', 'code', 'number', 'twoLetterCode', 'threeLetterCode',
  'hodId', 'hodName', 'secondaryHodId', 'secondaryHodName',
  'category', 'courseType', 'branch', 'icon'
];

router.get('/', authMiddleware, async (req, res) => res.json(await M.Department.find().sort({ name: 1 }).lean()));

router.post('/', authMiddleware, requirePage('admin', 'create', { tab: 'depts' }), async (req, res) => {
  try {
    const safeData = {};
    for (const f of allowedDepartmentFields) {
      if (req.body[f] !== undefined) safeData[f] = req.body[f];
    }
    const dept = await M.Department.create(safeData);
    await countService.modifyCount('departments', 1).catch(() => {});
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

router.put('/:id', authMiddleware, requirePage('admin', 'edit', { tab: 'depts' }), async (req, res) => {
  try {
    const before = await M.Department.findById(req.params.id).lean();
    const safeUpdate = {};
    for (const f of allowedDepartmentFields) {
      if (req.body[f] !== undefined) safeUpdate[f] = req.body[f];
    }
    const dept = await M.Department.findByIdAndUpdate(req.params.id, safeUpdate, { returnDocument: 'after' }).lean();
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

router.delete('/:id', authMiddleware, requirePage('admin', 'delete', { tab: 'depts' }), async (req, res) => {
  try {
    const dept = await M.Department.findById(req.params.id).lean();
    if (dept) {
      await M.UndoLog.create({
        collectionName: 'departments', label: `Department: ${dept.name}`,
        snapshot: dept, deletedBy: req.user.name, expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      });
      await M.Department.findByIdAndDelete(req.params.id);
      await countService.modifyCount('departments', -1).catch(() => {});
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