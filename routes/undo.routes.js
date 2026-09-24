const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');

router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const items = await M.UndoLog.find({ expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 }).limit(100).lean();
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const entry = await M.UndoLog.findById(req.params.id).lean();
    if (!entry) return res.status(404).json({ error: 'Undo entry not found or expired' });
    const snap = entry.snapshot;
    const { _id, __v, createdAt, updatedAt, ...body } = snap;
    let restored;
    if (entry.collectionName === 'departments') restored = await M.Department.create(body);
    else if (entry.collectionName === 'classes') restored = await M.Class.create(body);
    else if (entry.collectionName === 'subjects') restored = await M.Subject.create(body);
    else if (entry.collectionName === 'students') {
      restored = await M.Student.create(body);
      await M.User.create({
        username: restored.username,
        role: 'student',
        trackId: restored.trackId,
        status: 'active',
      });
    } else if (entry.collectionName === 'teachers') {
      const { _id: _, ...cleanSnap } = snap;
      restored = await M.Teacher.create({
        ...cleanSnap,
        fullName: cleanSnap.fullName || cleanSnap.name,
        employeeNo: cleanSnap.employeeNo || cleanSnap.empId,
        department: cleanSnap.department || cleanSnap.dept,
        designation: cleanSnap.designation || cleanSnap.desig
      });
      await M.User.create({
        username: restored.username,
        role: 'teacher',
        trackId: restored.trackId,
        status: 'active',
      });
    } else return res.status(400).json({ error: 'Cannot restore collection: ' + entry.collectionName });
    await M.UndoLog.findByIdAndDelete(req.params.id);
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Undo Restore',
      entry.label,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'control', subType: 'action', trackId: req.user.trackId }
    );
    res.json({ restored: true, label: entry.label });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  await M.UndoLog.findByIdAndDelete(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;