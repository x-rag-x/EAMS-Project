const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const M = require('../models');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');

// GET /api/manage-admins  — list all admins with manage portal access (ManageAdmin collection + Teachers with managePage right)
router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [customAdmins, teachersWithAccess] = await Promise.all([
      M.ManageAdmin.find().select('-password').sort({ createdAt: -1 }).lean(),
      M.Teacher.find({
        $or: [
          { adminRights: { $in: ['managePage', 'all'] } },
          { 'specials.option': 'managePage' }
        ]
      }).select('-password').sort({ fullName: 1 }).lean()
    ]);

    const teacherAdmins = teachersWithAccess.map(t => ({
      _id: t._id,
      name: t.fullName,
      email: t.email,
      username: t.username,
      department: t.department || '',
      type: 'teacher',
      teacherId: t._id,
      trackId: t.trackId,
      permissions: ['calendar', 'exam', 'attendance', 'settings'],
      active: true,
      addedBy: 'Faculty Role',
      createdAt: t.createdAt
    }));

    const customFormatted = customAdmins.map(a => ({
      ...a,
      type: 'custom'
    }));

    const combined = [...teacherAdmins, ...customFormatted];
    res.json(combined);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/manage-admins  — grant manage access to an existing teacher OR create a custom admin
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { teacherId, name, username, password, email, permissions } = req.body;
    const adderName = (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin';
    const adderRole = (req.user && req.user.role) || 'admin';
    const adderId   = (req.user && (req.user._id || req.user.trackId)) || null;

    // Case 1: Granting access to existing teacher
    if (teacherId) {
      const teacher = await M.Teacher.findById(teacherId);
      if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
      
      let rights = Array.isArray(teacher.adminRights) ? teacher.adminRights.slice() : [];
      if (!rights.includes('managePage') && !rights.includes('all')) {
        rights = rights.filter(r => r !== 'none');
        rights.push('managePage');
        teacher.adminRights = rights;
      }
      teacher.isAdmin = true;
      await teacher.save();

      await logAction(
        adderId,
        adderName,
        adderRole,
        'Manage Access Granted to Teacher',
        teacher.fullName,
        'manage',
        'info',
        req.ip,
        req.user.sessionId,
        {
          module: 'manage',
          subType: 'action',
          trackId: req.user.trackId,
          actingWithAdminRights: req.user.actingWithAdminRights,
          changes: { before: { adminRights: 'none' }, after: { adminRights: teacher.adminRights } }
        }
      );
      return res.json({
        _id: teacher._id,
        name: teacher.fullName,
        email: teacher.email,
        username: teacher.username,
        department: teacher.department,
        type: 'teacher',
        teacherId: teacher._id,
        permissions: permissions || ['calendar', 'exam', 'attendance'],
        active: true
      });
    }

    // Case 2: Custom Manage Admin
    if (!name || !username || !password) return res.status(400).json({ error: 'name, username, password required' });
    const exists = await M.ManageAdmin.findOne({ username: username.toLowerCase().trim() });
    if (exists) return res.status(400).json({ error: 'Username already taken' });
    const hashed = await bcrypt.hash(password, 10);
    const trackId = `TR-ADM${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const admin  = await M.ManageAdmin.create({
      trackId,
      name: name.trim(),
      username: username.toLowerCase().trim(),
      password: hashed,
      email: email || '',
      permissions: permissions || ['calendar','exam','attendance'],
      addedBy: adderName
    });
    const { password: _, ...safe } = admin.toObject();
    await logAction(
      adderId,
      adderName,
      adderRole,
      'Manage Admin Created',
      name,
      'manage',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'manage',
        subType: 'entry-create',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: null, after: safe }
      }
    );
    res.json({ ...safe, type: 'custom' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/manage-admins/:id
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const update = {};
    if (req.body.name)        update.name        = req.body.name.trim();
    if (req.body.email)       update.email       = req.body.email;
    if (req.body.permissions) update.permissions = req.body.permissions;
    if (typeof req.body.active === 'boolean') update.active = req.body.active;
    if (req.body.password) {
      update.password = await bcrypt.hash(req.body.password, 10);
    }
    const before = await M.ManageAdmin.findById(req.params.id).select('-password').lean();
    const admin = await M.ManageAdmin.findByIdAndUpdate(req.params.id, { $set: update }, { returnDocument: 'after' }).select('-password').lean();
    if (!admin) return res.status(404).json({ error: 'Not found' });
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Manage Admin Updated',
      admin.name,
      'manage',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'manage',
        subType: 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before, after: admin }
      }
    );
    res.json({ ...admin, type: 'custom' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/manage-admins/:id  — revoke access from teacher or delete custom admin
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = req.params.id;
    const actorName = (req.user && (req.user.name || req.user.fullName || req.user.username)) || 'Admin';
    const actorRole = (req.user && req.user.role) || 'admin';
    const actorId   = (req.user && (req.user._id || req.user.trackId)) || null;

    // Check if ID is a Teacher
    const teacher = await M.Teacher.findById(id);
    if (teacher) {
      let rights = Array.isArray(teacher.adminRights) ? teacher.adminRights : [];
      teacher.adminRights = rights.filter(r => r !== 'managePage');
      if (teacher.adminRights.length === 0) teacher.adminRights = ['none'];
      await teacher.save();
      await logAction(
        actorId,
        actorName,
        actorRole,
        'Manage Access Revoked from Teacher',
        teacher.fullName,
        'manage',
        'warning',
        req.ip,
        req.user.sessionId,
        {
          module: 'manage',
          subType: 'action',
          trackId: req.user.trackId,
          actingWithAdminRights: req.user.actingWithAdminRights,
          changes: { before: { adminRights: rights }, after: { adminRights: teacher.adminRights } }
        }
      );
      return res.json({ ok: true });
    }

    const admin = await M.ManageAdmin.findByIdAndDelete(id).lean();
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    await logAction(
      actorId,
      actorName,
      actorRole,
      'Manage Admin Deleted',
      admin.name,
      'manage',
      'warning',
      req.ip,
      req.user.sessionId,
      {
        module: 'manage',
        subType: 'entry-delete',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: admin, after: null }
      }
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;