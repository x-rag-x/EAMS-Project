const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const M = require('../models');
const cfg = require('../config');
const { authMiddleware, adminOnly, requireRight } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');

router.get('/trackid/:trackId', authMiddleware, async (req, res) => {
  try {
    const teacher = await M.Teacher.findOne(
      { trackId: req.params.trackId.trim() },
      'fullName specials trackId'
    ).lean();
    if (!teacher) return res.status(404).json({ error: 'TrackID not found' });
    const isHodVal = teacher.specials?.some(s => s.option === 'isHod');
    res.json({ fullName: teacher.fullName, isHod: isHodVal, trackId: teacher.trackId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    let teacher = null;
    if (mongoose.isValidObjectId(id)) {
      teacher = await M.Teacher.findById(id, '-password').lean();
    }
    if (!teacher) {
      teacher = await M.Teacher.findOne({ trackId: id }, '-password').lean();
    }
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
    const isHodVal = teacher.specials?.some(s => s.option === 'isHod');
    const isClassAdvisorVal = teacher.specials?.some(s => s.option === 'isClassAdvisor');
    const isTTCoordVal = teacher.specials?.some(s => s.option === 'isTimeTableCoordinator');
    res.json({
      _id: teacher._id,
      name: teacher.fullName,
      fullName: teacher.fullName,
      empId: teacher.employeeNo,
      employeeNo: teacher.employeeNo,
      dept: teacher.department,
      department: teacher.department,
      deptId: teacher.deptId,
      deptCode: teacher.deptCode,
      desig: teacher.designation,
      designation: teacher.designation,
      email: teacher.email,
      username: teacher.username,
      trackId: teacher.trackId,
      isHOD: isHodVal,
      isClassAdvisor: isClassAdvisorVal,
      isTimeTableCoordinator: isTTCoordVal,
      specials: teacher.specials || [],
      isAdmin: !!teacher.isAdmin,
      adminRights: teacher.adminRights || [],
      active: true,
      status: 'active',
      mustChangePassword: teacher.mustChangePassword,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const teacherFilter = {};
    if (req.query.dept) {
      teacherFilter.department = sanitizeToString(req.query.dept);
    }
    if (req.query.deptId) {
      teacherFilter.deptId = sanitizeToString(req.query.deptId);
    }
    if (req.query.q) {
      const q = sanitizeToString(req.query.q);
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');  // LOOP-07: prevent ReDoS
      teacherFilter.$or = [
        { fullName: { $regex: escaped, $options: 'i' } },
        { employeeNo: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { username: { $regex: escaped, $options: 'i' } },
      ];
    }
    
    const teachers = await M.Teacher.find(teacherFilter, '-password').sort({ fullName: 1 }).lean();
    const mapped = teachers.map(t => {
      const isHodVal = t.specials?.some(s => s.option === 'isHod');
      const isClassAdvisorVal = t.specials?.some(s => s.option === 'isClassAdvisor');
      const isTTCoordVal = t.specials?.some(s => s.option === 'isTimeTableCoordinator');
      return {
        _id: t._id,
        name: t.fullName,
        fullName: t.fullName,
        empId: t.employeeNo,
        employeeNo: t.employeeNo,
        dept: t.department,
        department: t.department,
        deptId: t.deptId,
        deptCode: t.deptCode,
        desig: t.designation,
        designation: t.designation,
        email: t.email,
        username: t.username,
        trackId: t.trackId,
        isHOD: isHodVal,
        isClassAdvisor: isClassAdvisorVal,
        isTimeTableCoordinator: isTTCoordVal,
        specials: t.specials || [],
        isAdmin: !!t.isAdmin,
        adminRights: t.adminRights || [],
        active: true,
        status: 'active',
        mustChangePassword: t.mustChangePassword,
      };
    });
    res.json(mapped);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authMiddleware, adminOnly, requireRight('adderModules'), async (req, res) => {
  try {
    const { fullName, firstName, lastName, employeeNo, department, deptId, deptCode, designation, username, password, email, specials, adminRights } = req.body;

    if (!fullName || !username || !password) {
      return res.status(400).json({
        error: 'fullName, username, password required'
      });
    }
    const hash = await bcrypt.hash(password, cfg.BCRYPT_ROUNDS);
    const normalizedUsername = String(username).toLowerCase().trim();

    const [usernameClash, shadowClash] = await Promise.all([
      M.Teacher.findOne({ username: { $regex: new RegExp('^' + String(normalizedUsername).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } }),
      M.User.findOne({ username: { $regex: new RegExp('^' + String(normalizedUsername).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } })
    ]);

    if (usernameClash) {
      return res.status(400).json({ error: `Username "@${normalizedUsername}" is already taken by ${usernameClash.fullName || 'another teacher'}. Please choose a different username.` });
    }
    if (shadowClash) {
      return res.status(400).json({ error: `Username "@${normalizedUsername}" is already in use (${shadowClash.role}). Please choose a different username.` });
    }

    // Track ID generation (fallback if not provided)
    const generatedTrackId = req.body.trackId ? String(req.body.trackId).trim() : ('TRTCH' + (employeeNo ? String(employeeNo).trim() : Date.now()));

    const trackClash = await M.Teacher.findOne({ trackId: generatedTrackId });
    if (trackClash) {
      return res.status(400).json({ error: `Employee ID / Track ID "${generatedTrackId}" is already assigned to ${trackClash.fullName}.` });
    }

    const finalAdminRights = (Array.isArray(adminRights) && adminRights.length) ? adminRights : ['none'];
    const calculatedIsAdmin = Array.isArray(finalAdminRights) && finalAdminRights.length > 0 && !finalAdminRights.every(r => r === 'none');

    const teacher = await M.Teacher.create({
      fullName: fullName.trim(), firstName: (firstName || '').trim(), lastName: (lastName || '').trim(), employeeNo: (employeeNo || '').trim(),
      department: department || '', deptId: deptId || null, deptCode: deptCode || '',
      designation: designation || '', email: (email || '').toLowerCase().trim(), username: normalizedUsername, password: hash,
      trackId: generatedTrackId, specials: specials || [],
      adminRights: finalAdminRights,
      isAdmin: calculatedIsAdmin, mustChangePassword: true
    });
    await M.User.findOneAndUpdate(
      { username: normalizedUsername },
      { username: normalizedUsername, role: 'teacher', trackId: teacher.trackId, status: 'active' },
      { upsert: true, returnDocument: 'after' }
    );

    const { password: _, ...teacherData } = teacher.toObject();
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Teacher Added',
      `${fullName} (${normalizedUsername}) — initial password set`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'entry-create',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: null, after: teacherData }
      }
    );
    res.status(201).json({ ...teacherData, name: teacher.fullName, empId: teacher.employeeNo, dept: teacher.department, deptId: teacher.deptId, deptCode: teacher.deptCode, desig: teacher.designation, _plainPassword: password });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
      const val = err.keyValue ? err.keyValue[field] : '';
      return res.status(400).json({ error: `${field === 'username' ? 'Username' : (field === 'trackId' ? 'Employee / Track ID' : field)} "${val}" is already registered. Please choose another.` });
    }
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { password, name, empId, dept, deptId, deptCode, desig, email, username, specials, adminRights, active, status } = req.body;
    let teacher = null;
    if (mongoose.isValidObjectId(req.params.id)) {
      teacher = await M.Teacher.findById(req.params.id);
    }
    if (!teacher) {
      teacher = await M.Teacher.findOne({ trackId: req.params.id });
    }
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    const before = teacher.toObject();
    delete before.password;

    const oldUsername = teacher.username;

    if (name) teacher.fullName = name;
    if (empId !== undefined) teacher.employeeNo = empId;
    if (dept !== undefined) teacher.department = dept;
    if (deptId !== undefined) teacher.deptId = deptId || null;
    if (deptCode !== undefined) teacher.deptCode = deptCode || '';
    if (desig !== undefined) teacher.designation = desig;
    if (email !== undefined) teacher.email = email;
    if (username) {
      const newUsername = username.toLowerCase().trim();
      if (newUsername !== teacher.username) {
        const clash = await M.Teacher.findOne({ username: newUsername, _id: { $ne: teacher._id } })
          .collation({ locale: 'en', strength: 2 });
        if (clash) {
          return res.status(400).json({ error: `Username "@${newUsername}" is already taken by ${clash.fullName}` });
        }
        teacher.username = newUsername;
      }
    }

    if (password) {
      teacher.password = await bcrypt.hash(password, cfg.BCRYPT_ROUNDS);
    }

    if (specials !== undefined) {
      teacher.specials = specials;
    }

    if (adminRights !== undefined) {
      teacher.adminRights = (Array.isArray(adminRights) && adminRights.length) ? adminRights : ['none'];
      teacher.isAdmin = Array.isArray(teacher.adminRights) && teacher.adminRights.length > 0 && !teacher.adminRights.every(r => r === 'none');
    }

    await teacher.save();

    // Sync shadow user
    let shadowUser = await M.User.findOne({ username: oldUsername, role: 'teacher' });
    if (shadowUser) {
      if (username && teacher.username !== shadowUser.username) {
        const shadowClash = await M.User.findOne({ username: teacher.username, _id: { $ne: shadowUser._id } });
        if (shadowClash) {
          return res.status(400).json({ error: `Username "@${teacher.username}" is already taken (${shadowClash.role})` });
        }
        shadowUser.username = teacher.username;
      }
      if (active !== undefined) shadowUser.status = active ? 'active' : 'inactive';
      if (status) shadowUser.status = status;
      await shadowUser.save();
    }

    const { password: _, ...safeTeacher } = teacher.toObject();
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Teacher Updated',
      teacher.fullName,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before, after: safeTeacher }
      }
    );
    res.json({ ...safeTeacher, name: teacher.fullName, empId: teacher.employeeNo, dept: teacher.department, deptId: teacher.deptId, deptCode: teacher.deptCode, desig: teacher.designation });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
      const val = err.keyValue ? err.keyValue[field] : '';
      return res.status(400).json({ error: `Duplicate error: ${field === 'username' ? 'Username' : (field === 'trackId' ? 'Employee / Track ID' : field)} "${val}" is already taken.` });
    }
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', authMiddleware, adminOnly, requireRight('deletings'), async (req, res) => {
  try {
    let teacher = null;
    if (mongoose.isValidObjectId(req.params.id)) {
      teacher = await M.Teacher.findById(req.params.id).select('-password');
    }
    if (!teacher) {
      teacher = await M.Teacher.findOne({ trackId: req.params.id }).select('-password');
    }
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
    
    const snapshot = teacher.toObject();
    delete snapshot.password;

    await M.UndoLog.create({
      collectionName: 'teachers', label: `Teacher: ${teacher.fullName} (@${teacher.username})`,
      snapshot, deletedBy: req.user.name, expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    });
    
    await M.Teacher.findByIdAndDelete(teacher._id);
    
    // Also delete shadow user
    await M.User.deleteOne({ username: teacher.username, role: 'teacher' });
    
    // Also delete assignments
    await M.Assignment.deleteMany({ $or: [{ teacherId: teacher._id }, { teacherTrackId: teacher.trackId }] });
    
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Teacher Deleted',
      teacher.fullName,
      'data',
      'warning',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'entry-delete',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: snapshot, after: null }
      }
    );
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;