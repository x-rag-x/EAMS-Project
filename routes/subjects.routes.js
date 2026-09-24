const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, adminOnly, requireRight } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');

router.get('/', authMiddleware, async (req, res) => {
  const filter = {};
  if (req.query.deptId) filter.deptId = sanitizeToString(req.query.deptId);
  res.json(await M.Subject.find(filter).sort({ name: 1 }));
});

router.post('/', authMiddleware, adminOnly, requireRight('adderModules'), async (req, res) => {
  try {
    const subj = await M.Subject.create(req.body);
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Subject Added',
      `${subj.name} (${subj.code})`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'entry-create',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: null, after: subj.toObject ? subj.toObject() : subj }
      }
    );
    res.status(201).json(subj);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const before = await M.Subject.findById(req.params.id).lean();
    const subj = await M.Subject.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' }).lean();
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Subject Updated',
      subj?.name || '',
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before, after: subj }
      }
    );
    res.json(subj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authMiddleware, adminOnly, requireRight('deletings'), async (req, res) => {
  try {
    const subj = await M.Subject.findById(req.params.id).lean();
    if (subj) {
      await M.UndoLog.create({
        collectionName: 'subjects', label: `Subject: ${subj.name} (${subj.code || ''})`,
        snapshot: subj, deletedBy: req.user.name, expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      });
      await M.Subject.findByIdAndDelete(req.params.id);
    }
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Subject Deleted',
      subj?.name || '',
      'data',
      'warning',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'entry-delete',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: subj, after: null }
      }
    );
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;