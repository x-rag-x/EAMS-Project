const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware, adminOnly, requireRight } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');

router.get('/', authMiddleware, async (req, res) => {
  try {
    const filter = {};
    if (req.query.deptId) filter.deptId = sanitizeToString(req.query.deptId);
    if (req.query.batch) {
      const b = sanitizeToString(req.query.batch);
      const altB = b.includes('-') && b.length === 9
        ? b.replace(/-(\d{4})$/, function (_, y) { return '-' + y.slice(-2); })
        : (b.includes('-') && b.length === 7
          ? b.replace(/^(\d{4})-(\d{2})$/, function (_, y1, y2) { return y1 + '-' + y1.slice(0, 2) + y2; })
          : b);
      filter.batch = { $in: [b, altB] };
    }
    const classes = await M.Class.find(filter).sort({ name: 1 }).lean();
    // Attach studentCount per class via aggregate to avoid client-side full scan
    const classIds = classes.map(function (c) { return c._id; });
    const counts = classIds.length
      ? await M.Student.aggregate([
          { $match: { classId: { $in: classIds } } },
          { $group: { _id: '$classId', count: { $sum: 1 } } }
        ])
      : [];
    const countMap = {};
    counts.forEach(function (c) { countMap[String(c._id)] = c.count; });
    classes.forEach(function (cls) { cls.studentCount = countMap[String(cls._id)] || 0; });
    res.json(classes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authMiddleware, adminOnly, requireRight('adderModules'), async (req, res) => {
  try {
    const cls = await M.Class.create(req.body);
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Class Added',
      `${cls.name} (Batch ${cls.batch || ''})`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'entry-create',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: null, after: cls.toObject ? cls.toObject() : cls }
      }
    );
    res.status(201).json(cls);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const before = await M.Class.findById(req.params.id).lean();
    const cls = await M.Class.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' }).lean();
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Class Updated',
      cls?.name || '',
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before, after: cls }
      }
    );
    res.json(cls);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/advisor', authMiddleware, adminOnly, async (req, res) => {
  try {
    const classId = req.params.id;
    const { teacherId } = req.body;

    const cls = await M.Class.findById(classId);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const classTrackId = cls.trackId || String(cls._id);
    const className = cls.name;
    const prevAdvisorName = cls.advisorTeacherName || 'None';

    // 1. Remove Class Advisor specials from any teacher currently assigned to this class
    const prevTeachers = await M.Teacher.find({
      $or: [
        { 'specials.key': className },
        { 'specials.key': classTrackId },
        { 'specials.value': className },
        { 'specials.value': classTrackId },
        ...(cls.advisorTeacherId ? [{ _id: cls.advisorTeacherId }] : [])
      ]
    });

    for (const pt of prevTeachers) {
      if (Array.isArray(pt.specials)) {
        pt.specials = pt.specials.filter(s => {
          if (s.option === 'isClassAdvisor' || s.option === 'ClassAdvisorTrackId') {
            if (s.key === className || s.key === classTrackId || s.value === className || s.value === classTrackId || (cls.advisorTeacherId && String(pt._id) === String(cls.advisorTeacherId))) {
              return false;
            }
          }
          return true;
        });
        await pt.save();
      }
    }

    let assignedTeacher = null;

    if (teacherId) {
      if (mongoose.isValidObjectId(teacherId)) {
        assignedTeacher = await M.Teacher.findById(teacherId);
      }
      if (!assignedTeacher) {
        assignedTeacher = await M.Teacher.findOne({ trackId: teacherId });
      }
      if (!assignedTeacher) {
        const shadow = await M.User.findById(teacherId);
        if (shadow && shadow.trackId) {
          assignedTeacher = await M.Teacher.findOne({ trackId: shadow.trackId });
        }
      }
      if (!assignedTeacher) return res.status(404).json({ error: 'Teacher not found' });

      cls.advisorTeacherId = assignedTeacher._id;
      cls.advisorTeacherName = assignedTeacher.fullName;
      cls.advisorTeacherTrackId = assignedTeacher.trackId || '';
      await cls.save();

      if (!Array.isArray(assignedTeacher.specials)) assignedTeacher.specials = [];

      assignedTeacher.specials = assignedTeacher.specials.filter(s =>
        !(s.option === 'isClassAdvisor' && (s.key === className || s.key === classTrackId)) &&
        !(s.option === 'ClassAdvisorTrackId' && (s.key === className || s.key === classTrackId))
      );

      assignedTeacher.specials.push({
        option: 'isClassAdvisor',
        key: className,
        value: true
      });
      assignedTeacher.specials.push({
        option: 'ClassAdvisorTrackId',
        key: className,
        value: classTrackId
      });

      await assignedTeacher.save();

      await logAction(
        req.user.trackId || req.user._id,
        req.user.name,
        req.user.role,
        'Class Advisor Assigned',
        `Assigned ${assignedTeacher.fullName} as Class Advisor for ${cls.name}`,
        'data',
        'info',
        req.ip,
        req.user.sessionId,
        {
          module: 'admin',
          subType: 'field-edit',
          trackId: req.user.trackId,
          actingWithAdminRights: req.user.actingWithAdminRights,
          changes: {
            before: { advisor: prevAdvisorName },
            after: { advisor: assignedTeacher.fullName }
          }
        }
      );
    } else {
      cls.advisorTeacherId = null;
      cls.advisorTeacherName = '';
      cls.advisorTeacherTrackId = '';
      await cls.save();

      await logAction(
        req.user.trackId || req.user._id,
        req.user.name,
        req.user.role,
        'Class Advisor Removed',
        `Removed Class Advisor from ${cls.name}`,
        'data',
        'info',
        req.ip,
        req.user.sessionId,
        {
          module: 'admin',
          subType: 'field-edit',
          trackId: req.user.trackId,
          actingWithAdminRights: req.user.actingWithAdminRights,
          changes: {
            before: { advisor: prevAdvisorName },
            after: { advisor: 'None' }
          }
        }
      );
    }

    res.json({
      success: true,
      class: cls,
      advisor: assignedTeacher ? {
        _id: assignedTeacher._id,
        name: assignedTeacher.fullName,
        trackId: assignedTeacher.trackId
      } : null
    });
  } catch (err) {
    console.error('Assign class advisor error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authMiddleware, adminOnly, requireRight('deletings'), async (req, res) => {
  try {
    const cls = await M.Class.findById(req.params.id).lean();
    if (cls) {
      await M.UndoLog.create({
        collectionName: 'classes', label: `Class: ${cls.name}`,
        snapshot: cls, deletedBy: req.user.name, expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      });
      await M.Class.findByIdAndDelete(req.params.id);
    }
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Class Deleted',
      cls?.name || '',
      'data',
      'warning',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'entry-delete',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: cls, after: null }
      }
    );
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;