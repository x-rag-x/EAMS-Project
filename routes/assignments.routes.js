const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { checkModuleGuard } = require('../middleware/portalGuard');

router.get('/', authMiddleware, async (req, res) => {
  const filter = {};
  if (req.query.subjectId) filter.subjectId = sanitizeToString(req.query.subjectId);
  if (req.query.teacherId) filter.teacherId = sanitizeToString(req.query.teacherId);
  else if (!req.query.subjectId && !req.query.classId && req.user.role === 'teacher')
    filter.teacherId = req.user.roleId || req.user._id;
  if (req.query.classId) filter.classId = sanitizeToString(req.query.classId);
  res.json(await M.Assignment.find(filter).sort({ teacherName: 1 }));
});

router.post('/', authMiddleware, adminOnly, checkModuleGuard('modelAssignments', 'Class Assignments'), async (req, res) => {
  try {
    const existing = await M.Assignment.findOne({ teacherId: req.body.teacherId, classId: req.body.classId, subjectId: req.body.subjectId });
    if (existing) return res.status(409).json({ error: 'Assignment already exists' });
    const asgn = await M.Assignment.create(req.body);
    await logAction(req.user._id, req.user.name, req.user.role, 'Assignment Created', `${req.body.subjectName} → ${req.body.className}`, 'data', 'info', req.ip);
    res.status(201).json(asgn);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/bulk', authMiddleware, adminOnly, checkModuleGuard('modelAssignments', 'Class Assignments'), async (req, res) => {
  try {
    const { subjectId, assignments } = req.body;

    // Validation
    if (!subjectId)
      return res.status(400).json({ error: 'subjectId is required' });
    if (!Array.isArray(assignments) || assignments.length === 0)
      return res.status(400).json({ error: 'assignments[] must be a non-empty array' });

    // Validate each row has required fields
    for (let i = 0; i < assignments.length; i++) {
      const { classId, teacherId, hallNo } = assignments[i];
      if (!classId || !teacherId || !hallNo)
        return res.status(400).json({ error: `Row ${i + 1}: classId, teacherId and hallNo are required` });
    }

    // Duplicate section check (same subject + class)
    const classIds = assignments.map(a => a.classId);
    const uniqueIds = new Set(classIds);
    if (uniqueIds.size !== classIds.length)
      return res.status(409).json({ error: 'Duplicate section detected — each class must appear only once per subject' });

    // Replace: delete old assignments for this subject
    const deleted = await M.Assignment.deleteMany({ subjectId });

    // Insert all new rows in one shot
    const saved = await M.Assignment.insertMany(assignments);

    await logAction(
      req.user._id, req.user.name, req.user.role,
      'Assignments Bulk Saved',
      `${saved.length} section(s) for subject ${subjectId} (replaced ${deleted.deletedCount} old)`,
      'data', 'info', req.ip
    );

    res.status(201).json({ success: true, count: saved.length, data: saved });
  } catch (err) {
    console.error('Bulk assignment error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  await M.Assignment.findByIdAndDelete(req.params.id);
  await logAction(req.user._id, req.user.name, req.user.role, 'Assignment Removed', req.params.id, 'data', 'warning', req.ip);
  res.json({ deleted: true });
});

module.exports = router;
