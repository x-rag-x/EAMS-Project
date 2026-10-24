const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, requirePage } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');

router.get('/', authMiddleware, async (req, res) => {
  const filter = {};
  if (req.query.subjectId) filter.subjectId = sanitizeToString(req.query.subjectId);
  if (req.query.teacherId) filter.teacherId = sanitizeToString(req.query.teacherId);
  else if (!req.query.subjectId && !req.query.classId && req.user.role === 'teacher')
    filter.teacherId = req.user.roleId || req.user._id;
  if (req.query.classId) filter.classId = sanitizeToString(req.query.classId);
  res.json(await M.Assignment.find(filter).sort({ teacherName: 1 }));
});

router.post('/', authMiddleware, requirePage('admin', 'create', { tab: 'struct' }), async (req, res) => {
  try {
    const existing = await M.Assignment.findOne({ teacherId: req.body.teacherId, classId: req.body.classId, subjectId: req.body.subjectId });
    if (existing) return res.status(409).json({ error: 'Assignment already exists' });
    const asgn = await M.Assignment.create(req.body);
    await logAction(req.user._id, req.user.name, req.user.role, 'Assignment Created', `${req.body.subjectName} → ${req.body.className}`, 'data', 'info', req.ip);
    res.status(201).json(asgn);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/bulk', authMiddleware, requirePage('admin', 'create', { tab: 'struct' }), async (req, res) => {
  try {
    const { subjectId, classId, teacherId, assignments } = req.body;

    // Validation: either subjectId, classId, or teacherId must be provided
    if (!subjectId && !classId && !teacherId)
      return res.status(400).json({ error: 'Either subjectId, classId, or teacherId is required' });
    if (!Array.isArray(assignments) || assignments.length === 0)
      return res.status(400).json({ error: 'assignments[] must be a non-empty array' });

    // Validate each row has required fields
    for (let i = 0; i < assignments.length; i++) {
      const { classId: cId, subjectId: sId, teacherId: tId, hallNo } = assignments[i];
      const targetClassId = cId || classId;
      const targetSubjectId = sId || subjectId;
      const targetTeacherId = tId || teacherId;
      if (!targetClassId || !targetSubjectId || !targetTeacherId || !hallNo)
        return res.status(400).json({ error: `Row ${i + 1}: classId, subjectId, teacherId and hallNo are required` });
    }

    if (subjectId) {
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

      return res.status(201).json({ success: true, count: saved.length, data: saved });
    } else if (classId) {
      // Duplicate subject check (same class + subject)
      const subjectIds = assignments.map(a => a.subjectId);
      const uniqueIds = new Set(subjectIds);
      if (uniqueIds.size !== subjectIds.length)
        return res.status(409).json({ error: 'Duplicate subject detected — each subject must appear only once per class' });

      // Replace: delete old assignments for this class
      const deleted = await M.Assignment.deleteMany({ classId });

      // Insert all new rows in one shot
      const saved = await M.Assignment.insertMany(assignments);

      await logAction(
        req.user._id, req.user.name, req.user.role,
        'Assignments Bulk Saved',
        `${saved.length} subject(s) for class ${classId} (replaced ${deleted.deletedCount} old)`,
        'data', 'info', req.ip
      );

      return res.status(201).json({ success: true, count: saved.length, data: saved });
    } else if (teacherId) {
      // Duplicate check: each class section and subject must appear only once for this teacher
      const comboKeys = assignments.map(a => `${a.classId}_${a.subjectId}`);
      const uniqueKeys = new Set(comboKeys);
      if (uniqueKeys.size !== comboKeys.length)
        return res.status(409).json({ error: 'Duplicate assignment detected — each class section and subject must appear only once' });

      // Replace: delete old assignments for this teacher
      const deleted = await M.Assignment.deleteMany({ teacherId });

      // Insert all new rows in one shot
      const saved = await M.Assignment.insertMany(assignments);

      await logAction(
        req.user._id, req.user.name, req.user.role,
        'Assignments Bulk Saved',
        `${saved.length} teaching allocation(s) for teacher ${teacherId} (replaced ${deleted.deletedCount} old)`,
        'data', 'info', req.ip
      );

      return res.status(201).json({ success: true, count: saved.length, data: saved });
    }
  } catch (err) {
    console.error('Bulk assignment error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authMiddleware, requirePage('admin', 'delete', { tab: 'struct' }), async (req, res) => {
  try {
    const asgn = await M.Assignment.findById(req.params.id).lean();
    if (asgn) {
      await M.UndoLog.create({
        collectionName: 'assignments',
        label: `Assignment: ${asgn.subjectName || asgn.subjectId || 'Subject'} (${asgn.className || asgn.classId || 'Class'})`,
        snapshot: asgn,
        deletedBy: req.user.name || req.user.username || 'admin',
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      }).catch(err => console.warn('[UndoLog Error]:', err.message));
      await M.Assignment.findByIdAndDelete(req.params.id);
    }
    await logAction(req.user._id, req.user.name, req.user.role, 'Assignment Removed', asgn?.subjectName || req.params.id, 'data', 'warning', req.ip);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
