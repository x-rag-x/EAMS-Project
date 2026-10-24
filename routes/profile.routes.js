const express = require('express');
const router = express.Router();
const bcrypt = require('@node-rs/bcrypt');
const M = require('../models');
const { authMiddleware, getRoleModel } = require('../middleware/auth');
const cfg = require('../config');
const { logAction } = require('../utils/logAction');
const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const { isSudo, isSudoAdmin, hasSpecial, hasPageRight, getPrecomputedAccess } = require('../utils/access');
const { sanitizeToString } = require('../utils/sanitizeQuery');


const isDev = cfg.NODE_ENV === 'development' || process.env.NODE_ENV === 'development';

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const targetModel = getRoleModel(req.user.role);
    if (!targetModel) return res.status(400).json({ error: 'Invalid role' });
    const userDoc = await targetModel.findOne({ username: req.user.username }).select('-password').lean();
    if (!userDoc) return res.status(404).json({ error: 'User not found' });

    const base = {
      _id: userDoc._id,
      role: req.user.role,
      name: userDoc.fullName,
      username: userDoc.username,
      email: userDoc.email || '',
      loginCount: userDoc.loginCount || 0,
      lastLogin: userDoc.lastLogin || null,
      firstLogin: userDoc.firstLogin || null,
      mustChangePassword: isDev ? false : (userDoc.mustChangePassword || false),
      createdAt: userDoc.createdAt,
      updatedAt: userDoc.updatedAt,
    };

    if (req.user.role === 'teacher') {
      const specials = Array.isArray(userDoc.specials) ? userDoc.specials : [];
      Object.assign(base, {
        fullName: userDoc.fullName,
        firstName: userDoc.firstName || '',
        lastName: userDoc.lastName || '',
        employeeNo: userDoc.employeeNo || '',
        department: userDoc.department || '',
        deptId: userDoc.deptId || null,
        deptCode: userDoc.deptCode || '',
        designation: userDoc.designation || 'Assistant Professor',
        isHod: specials.some(s => s.option === 'isHod'),
        HoddeptName: (() => {
          const s = specials.find(x => x.option === 'isHod');
          if (!s) return '';
          if (typeof s.value === 'string' && s.value.trim() && s.value !== 'true') return s.value.trim();
          if (typeof s.key === 'string' && s.key.trim() && !s.key.startsWith('isHod') && s.key !== 'true') return s.key.trim();
          return (userDoc.department || '').trim();
        })(),
        isClassAdvisor: specials.some(s => s.option === 'isClassAdvisor'),
        className: (specials.find(s => s.option === 'isClassAdvisor') || {}).key || (specials.find(s => s.option === 'isClassAdvisor') || {}).value || '',
        advisorClassName: (specials.find(s => s.option === 'isClassAdvisor') || {}).key || (specials.find(s => s.option === 'isClassAdvisor') || {}).value || '',
        isTimeTableCoordinator: specials.some(s => s.option === 'isTimeTableCoordinator'),
        TTdeptName: (() => {
          const s = specials.find(x => x.option === 'isTimeTableCoordinator');
          if (!s) return '';
          if (typeof s.value === 'string' && s.value.trim() && s.value !== 'true') return s.value.trim();
          if (typeof s.key === 'string' && s.key.trim() && !s.key.startsWith('isTimeTableCoordinator') && s.key !== 'true') return s.key.trim();
          return (userDoc.department || '').trim();
        })(),
        isWarden: specials.some(s => s.option === 'isWarden'),
        isExamCoordinator: specials.some(s => s.option === 'isExamCoordinator'),
        isPlacementCoordinator: specials.some(s => s.option === 'isPlacementCoordinator'),
        isAdmin: hasSpecial(userDoc, 'isAdmin'),
        isSudoAdmin: isSudoAdmin(userDoc),
        pageRights: (userDoc.pageRights || []).filter(r => r && r.enabled !== false),
        access: getPrecomputedAccess(userDoc),
        adminFlag: isSudoAdmin(userDoc) ? 'superadmin' : (hasSpecial(userDoc, 'isPrincipal') ? 'principal' : (hasSpecial(userDoc, 'isAdmin') ? 'subadmin' : 'none')),
        specials: specials,
        preferences: Object.assign({
          defaultAttendanceStatus: 'Present',
          autoAttendancePrompt: true,
          promptLeadMinutes: 5,
        }, userDoc.preferences || {}),
      });
    } else if (req.user.role === 'student') {
      Object.assign(base, {
        fullName: userDoc.fullName,
        firstName: userDoc.firstName || '',
        lastName: userDoc.lastName || '',
        registerNo: userDoc.registerNo || '',
        class: userDoc.class || '',
        classId: userDoc.classId || '',
        className: userDoc.class || '',
        branch: userDoc.branch || '',
        course: userDoc.courseType || '',
        department: userDoc.department || '',
        deptId: userDoc.deptId || '',
        deptName: userDoc.department || '',
        currentYear: userDoc.currentYear || '',
        academicYear: userDoc.admissionYear || '',
        isRep: userDoc.isRep || false,
      });
    }

    res.json(base);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/profile/me — update own editable fields ──
router.put('/me', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: 'Students cannot edit profile information' });
    }
    const targetModel = getRoleModel(req.user.role);
    if (!targetModel) return res.status(400).json({ error: 'Invalid role' });
    const user = await targetModel.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'Profile not found' });

    const ALWAYS_PROTECTED = [
      'role', 'isAdmin', 'specials', 'pageRights',
      'isHOD', 'HoddeptName', 'isClassAdvisor', 'advisorClassName', 'advisorClassId',
      'isTimeTableCoordinator', 'TTdeptName',
      'isWarden', 'isExamCoordinator', 'isPlacementCoord',
      'isClassRep', 'active', 'failedLogins', 'lockedUntil', 'loginCount', 'firstLogin',
      'lastLogin', 'mustChangePassword', 'password', 'username',
    ];

    const updates = { ...req.body };
    ALWAYS_PROTECTED.forEach(k => delete updates[k]);

    if (updates.fullName || updates.name) {
      user.fullName = updates.fullName || updates.name;
    }
    if (updates.firstName) user.firstName = updates.firstName;
    if (updates.lastName) user.lastName = updates.lastName;
    if (updates.email !== undefined && req.user.role !== 'student') user.email = updates.email;

    if (req.user.role === 'teacher' || isSudo(req)) {
      if (updates.employeeNo !== undefined) user.employeeNo = updates.employeeNo;
      if (updates.empId !== undefined) user.employeeNo = updates.empId;
      if (updates.department !== undefined) user.department = updates.department;
      if (updates.dept !== undefined) user.department = updates.dept;
      if (req.user.role === 'teacher') {
        if (updates.designation !== undefined) user.designation = updates.designation;
        if (updates.desig !== undefined) user.designation = updates.desig;
        if (!user.preferences) user.preferences = {};
        if (updates.defaultAttendanceStatus) {
          user.preferences.defaultAttendanceStatus = updates.defaultAttendanceStatus;
        }
        if (updates.autoAttendancePrompt !== undefined) {
          user.preferences.autoAttendancePrompt = Boolean(updates.autoAttendancePrompt);
        }
        if (updates.promptLeadMinutes !== undefined) {
          const lead = Number(updates.promptLeadMinutes);
          if ([0, 5, 10].includes(lead)) {
            user.preferences.promptLeadMinutes = lead;
          }
        }
        if (updates.preferences && typeof updates.preferences === 'object') {
          if (updates.preferences.defaultAttendanceStatus) {
            user.preferences.defaultAttendanceStatus = updates.preferences.defaultAttendanceStatus;
          }
          if (updates.preferences.autoAttendancePrompt !== undefined) {
            user.preferences.autoAttendancePrompt = Boolean(updates.preferences.autoAttendancePrompt);
          }
          if (updates.preferences.promptLeadMinutes !== undefined) {
            const lead = Number(updates.preferences.promptLeadMinutes);
            if ([0, 5, 10].includes(lead)) {
              user.preferences.promptLeadMinutes = lead;
            }
          }
        }
        user.markModified('preferences');
      }
    }
    // LOOP-06: Students can only edit fullName/firstName/lastName (common block above)
    // Institutional fields (registerNo, class, section, branch, department, email) are admin-managed only

    await user.save();

    // Shadow user no longer stores name/email, only username/role/trackId/status
    // No sync needed here since those fields don't change in profile self-edit

    await logAction(
      user.trackId || req.user._id,
      user.fullName,
      req.user.role,
      'Profile Updated',
      'Own profile self-edited',
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: isSudo(req) ? 'admin' : (req.user.role === 'teacher' ? 'teacher' : 'student'),
        subType: 'field-edit',
        trackId: user.trackId || req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: null, after: updates }
      }
    );
    const { password: _pw, ...safe } = user.toObject();
    res.json(safe);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/profile/users — admin or Manage User right: list all users ──
router.get('/users', authMiddleware, async (req, res) => {
  try {
    const canManage = isSudoAdmin(req.user) || hasPageRight(req.user, 'manage', 'view');
    if (!canManage) return res.status(403).json({ error: 'Manage User right required' });

    const filter = {};
    if (req.query.role) filter.role = sanitizeToString(req.query.role);
    if (req.query.search) {
      const re = new RegExp(escapeRegex(req.query.search), 'i');
      filter.$or = [{ username: re }, { trackId: re }];
    }
    const users = await M.User.find(filter).sort({ role: 1, username: 1 }).lean();

    // Enrich with names from role-specific models
    const enriched = await Promise.all(users.map(async u => {
      let name = '';
      const model = getRoleModel(u.role);
      if (model) {
        const doc = await model.findOne({ trackId: u.trackId }, 'fullName').lean();
        name = doc ? doc.fullName : '';
      }
      return { ...u, name: name || u.username };
    }));

    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/profile/users/:id — redirect legacy callers to canonical /api/users/:id ──
router.put('/users/:id', authMiddleware, (req, res) => {
  res.redirect(307, `/api/users/${req.params.id}`);
});

module.exports = router;
