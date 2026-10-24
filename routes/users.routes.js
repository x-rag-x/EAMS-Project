const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('@node-rs/bcrypt');
const M = require('../models');
const cfg = require('../config');
const { authMiddleware, getRoleModel, requirePage, scopeFilter, assertInScope } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { isSudo, isSudoAdmin, isSuperAdmin, isSubAdmin, isPrincipalUser, isAdminUser, hasSpecial, hasPageRight, canGrant, sanitizeTeacherPrivileges, getPrecomputedAccess, normalizePageRights } = require('../utils/access');
const { assertNotLastSudoAdmin } = require('../utils/adminGuards');
const { normalizeYearRange, toBatchTrackId } = require('../utils/yearFormat');
const { validatePassword } = require('../utils/passwordValidator');

// GET /api/users - List and search users with enriched profile and login status
router.get('/', authMiddleware, requirePage('control', 'view', { tab: 'usergrid' }), async (req, res) => {
  try {
    const filter = {};
    const roleQuery = req.query.role && req.query.role !== 'all' ? sanitizeToString(req.query.role) : null;
    if (roleQuery) {
      if (roleQuery === 'admin') {
        // Virtual view: find teachers who hold specials.option: 'isAdmin'
        const adminTeachers = await M.Teacher.find({ 'specials.option': 'isAdmin' }).select('trackId').lean();
        const adminTrackIds = adminTeachers.map(t => t.trackId).filter(Boolean);
        filter.trackId = { $in: adminTrackIds };
        filter.role = { $in: ['teacher', 'admin'] };
      } else {
        filter.role = roleQuery;
      }
    }
    if (req.query.status && req.query.status !== 'all') {
      filter.status = sanitizeToString(req.query.status);
    }

    // Fetch all matching shadow users
    const users = await M.User.find(filter).sort({ role: 1, username: 1 }).lean();

    // Group track IDs by role for batch enrichment
    const teacherTrackIds = users.filter(u => u.role === 'teacher').map(u => u.trackId).filter(Boolean);
    const studentTrackIds = users.filter(u => u.role === 'student').map(u => u.trackId).filter(Boolean);
    const allTrackIds = users.map(u => u.trackId).filter(Boolean);

    const [teachers, students, loginHistories] = await Promise.all([
      teacherTrackIds.length ? M.Teacher.find({ trackId: { $in: teacherTrackIds } }).lean() : [],
      studentTrackIds.length ? M.Student.find({ trackId: { $in: studentTrackIds } }).lean() : [],
      allTrackIds.length ? M.LoginHistory.find({ trackId: { $in: allTrackIds } }).lean() : []
    ]);

    const teacherMap = new Map();
    const studentMap = new Map();
    const loginMap = new Map();

    teachers.forEach(t => teacherMap.set(t.trackId, t));
    students.forEach(s => studentMap.set(s.trackId, s));
    loginHistories.forEach(l => loginMap.set(l.trackId, l));

    // Combine and enrich user objects
    let enriched = users.map(u => {
      const login = loginMap.get(u.trackId) || {};
      const userLockedUntil = u.lockedUntil || login.lockedUntil;
      const isLocked = u.status === 'locked' || (userLockedUntil && new Date(userLockedUntil) > new Date());
      const effectiveStatus = isLocked ? 'locked' : (u.status || 'active');

      let profile = {};
      if (u.role === 'teacher') {
        const t = teacherMap.get(u.trackId) || {};
        const isAdm = hasSpecial(t, 'isAdmin');
        const access = getPrecomputedAccess(t);
        profile = {
          roleDocId: t._id || null,
          fullName: t.fullName || t.username || u.username,
          firstName: t.firstName || '',
          lastName: t.lastName || '',
          employeeNo: t.employeeNo || '',
          department: t.department || '',
          deptId: t.deptId || null,
          deptCode: t.deptCode || '',
          designation: t.designation || 'Assistant Professor',
          email: t.email || '',
          isAdmin: isAdm,
          isSudoAdmin: isSudoAdmin(t),
          access: access,
          pageRights: normalizePageRights(t.pageRights).filter(r => r && r.enabled !== false),
          defaultAttendanceStatus: t.preferences?.defaultAttendanceStatus || 'Present',
          specials: t.specials || [],
          mustChangePassword: !!t.mustChangePassword,
        };
      } else if (u.role === 'student') {
        const s = studentMap.get(u.trackId) || {};
        profile = {
          roleDocId: s._id || null,
          fullName: s.fullName || s.username || u.username,
          firstName: s.firstName || '',
          lastName: s.lastName || '',
          registerNo: s.registerNo || '',
          class: s.class || '',
          classId: s.classId || null,
          courseType: s.courseType || 'UG',
          branch: s.branch || '',
          department: s.department || '',
          deptId: s.deptId || null,
          admissionYear: s.admissionYear || '',
          batchTrackId: s.batchTrackId || '',
          email: s.email || '',
          isRep: !!s.isRep,
          mustChangePassword: !!s.mustChangePassword,
        };
      }

      return {
        _id: u._id,
        username: u.username,
        role: u.role,
        trackId: u.trackId || '',
        status: effectiveStatus,
        rawStatus: u.status,
        online: !!u.online,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
        name: profile.fullName || u.username,
        ...profile,
        lastLogin: login.lastLogin || null,
        firstLogin: login.firstLogin || null,
        totalLogins: login.totalLogins || 0,
        failedLogins: (u.failedLogins !== undefined && u.failedLogins !== null) ? u.failedLogins : (login.failedLogins || 0),
        lockedUntil: u.lockedUntil || login.lockedUntil || null,
      };
    });

    // Department filter
    if (req.query.department) {
      const deptVal = String(req.query.department).toLowerCase().trim();
      enriched = enriched.filter(u =>
        (u.department && u.department.toLowerCase() === deptVal) ||
        (u.deptCode && u.deptCode.toLowerCase() === deptVal) ||
        (u.deptId && String(u.deptId) === req.query.department)
      );
    }

    // Server-side department scope filter for control panel
    const sFilter = scopeFilter(req, 'deptId', 'control');
    if (sFilter.deptId) {
      enriched = enriched.filter(u => u.deptId && String(u.deptId) === String(sFilter.deptId));
    }

    // Class filter
    if (req.query.class) {
      const clsVal = String(req.query.class).toLowerCase().trim();
      enriched = enriched.filter(u =>
        (u.class && u.class.toLowerCase() === clsVal) ||
        (u.classId && String(u.classId) === req.query.class)
      );
    }

    // Search query across multi-fields
    if (req.query.search) {
      const q = String(req.query.search).toLowerCase().trim();
      enriched = enriched.filter(u =>
        (u.username && u.username.toLowerCase().includes(q)) ||
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.fullName && u.fullName.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.registerNo && u.registerNo.toLowerCase().includes(q)) ||
        (u.employeeNo && u.employeeNo.toLowerCase().includes(q)) ||
        (u.department && u.department.toLowerCase().includes(q)) ||
        (u.class && u.class.toLowerCase().includes(q)) ||
        (u.designation && u.designation.toLowerCase().includes(q)) ||
        (u.trackId && u.trackId.toLowerCase().includes(q))
      );
    }

    // Global stats before pagination
    const stats = {
      total: enriched.length,
      active: enriched.filter(u => u.status === 'active').length,
      inactive: enriched.filter(u => u.status === 'inactive').length,
      locked: enriched.filter(u => u.status === 'locked').length,
    };

    // Sorting
    const sortBy = req.query.sortBy || 'name';
    const sortDir = req.query.sortDir === 'desc' ? -1 : 1;
    enriched.sort((a, b) => {
      let valA = a[sortBy] ?? '';
      let valB = b[sortBy] ?? '';
      if (typeof valA === 'string' && typeof valB === 'string') {
        return valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' }) * sortDir;
      }
      if (valA < valB) return -1 * sortDir;
      if (valA > valB) return 1 * sortDir;
      return 0;
    });

    // Pagination
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limitParam = req.query.limit;
    const limit = (limitParam === '0' || limitParam === 'all') ? enriched.length : Math.max(1, parseInt(limitParam || '50', 10));
    const total = enriched.length;
    const pages = Math.max(1, Math.ceil(total / (limit || 1)));
    const paginated = (limitParam === '0' || limitParam === 'all')
      ? enriched
      : enriched.slice((page - 1) * limit, page * limit);

    res.json({
      users: paginated,
      total,
      page,
      pages,
      limit,
      stats,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function isTargetAdminTier(targetRoleDoc, targetUser) {
  const target = targetRoleDoc || targetUser;
  if (!target) return false;
  return (
    isSudoAdmin(target) ||
    (targetUser && isSudoAdmin(targetUser)) ||
    isSuperAdmin(target) ||
    (targetUser && isSuperAdmin(targetUser)) ||
    isSubAdmin(target) ||
    (targetUser && isSubAdmin(targetUser)) ||
    isAdminUser(target) ||
    (targetUser && isAdminUser(targetUser)) ||
    isPrincipalUser(target) ||
    (targetUser && isPrincipalUser(targetUser)) ||
    (targetUser && ['admin', 'sudo'].includes(targetUser.role)) ||
    target.username === 'admin' ||
    target.trackId === 'TR-ADMIN001' ||
    (targetUser && (targetUser.username === 'admin' || targetUser.trackId === 'TR-ADMIN001'))
  );
}

// PUT /api/users/:id - Update user across shadow User and role document
// PUT /api/users/:id - Update user across shadow User and role document
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    let user = null;
    if (mongoose.Types.ObjectId.isValid(req.params.id)) {
      user = await M.User.findById(req.params.id);
    }
    if (!user) {
      user = await M.User.findOne({ trackId: req.params.id });
    }
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Compare caller's trackId with target user's trackId to identify self-edit
    const isSelf = Boolean(
      req.user?.trackId &&
      user.trackId &&
      String(req.user.trackId).trim() === String(user.trackId).trim()
    );

    const model = getRoleModel(user.role);
    let roleDoc = null;
    if (model && user.trackId) {
      roleDoc = await model.findOne({ trackId: user.trackId }).select('+password +passwordHistory');
    }
    if (!roleDoc) return res.status(404).json({ error: 'Role profile document not found' });

    let passwordChanged = false;
    let targetStatus = user.status;

    if (isSelf) {
      // ── Self-edit branch ──
      // Restrict strictly to allow-listed fields: name, email, password
      const { name, fullName, firstName, lastName, email, password, currentPassword } = req.body;

      if (fullName !== undefined || name !== undefined) {
        roleDoc.fullName = String(fullName || name).trim();
      }
      if (firstName !== undefined) {
        roleDoc.firstName = String(firstName).trim();
      }
      if (lastName !== undefined) {
        roleDoc.lastName = lastName ? String(lastName).trim() : null;
      }
      if (email !== undefined) {
        roleDoc.email = String(email).trim().toLowerCase();
      }

      // Self password change requires current password verification
      if (password && String(password).trim()) {
        if (!currentPassword) {
          return res.status(400).json({ error: 'Current password is required to change password' });
        }
        const match = await bcrypt.compare(currentPassword, roleDoc.password);
        if (!match) return res.status(401).json({ error: 'Current password incorrect' });

        const secSettings = await M.Settings.findOne({ key: 'security' });
        const requireStrong = secSettings?.value?.requireStrongPassword !== false;
        const validation = validatePassword(password, requireStrong);
        if (!validation.isValid) {
          return res.status(400).json({ error: validation.error });
        }

        const history = roleDoc.passwordHistory || [];
        for (const prev of history.slice(-5)) {
          const prevMatch = await bcrypt.compare(password, prev.hash);
          if (prevMatch) {
            return res.status(400).json({ error: "Cannot reuse any of the user's last 5 passwords." });
          }
        }

        const hashed = await bcrypt.hash(password, cfg.BCRYPT_ROUNDS);
        if (!roleDoc.passwordHistory) roleDoc.passwordHistory = [];
        if (roleDoc.password) {
          roleDoc.passwordHistory.push({ hash: roleDoc.password, changedAt: new Date() });
          if (roleDoc.passwordHistory.length > 5) {
            roleDoc.passwordHistory = roleDoc.passwordHistory.slice(-5);
          }
        }
        roleDoc.password = hashed;
        roleDoc.mustChangePassword = false;
        passwordChanged = true;

        if (M.Password && user.trackId) {
          await M.Password.updateOne(
            { trackId: user.trackId },
            { $set: { hash: hashed, passwordChangedAt: new Date() } }
          ).catch(() => {});
        }
      }

      await roleDoc.save();
    } else {
      // ── Administrative edit branch ──
      // Caller must possess page permission for control/usergrid
      const pageGuard = requirePage('control', 'edit', { tab: 'usergrid' });
      let guardError = null;
      await new Promise((resolve) => {
        pageGuard(req, res, (err) => {
          if (err) guardError = err;
          resolve();
        });
      });
      if (guardError) return res.status(500).json({ error: guardError.message });
      if (res.headersSent) return;

      // Scope check: caller must have scope over target's department
      const targetDept = roleDoc.deptId || roleDoc.department || user.department;
      if (!assertInScope(req, targetDept)) {
        return res.status(403).json({ error: 'Access denied: user is outside your department scope' });
      }

      // Tier check: caller cannot edit an admin/elevated user unless canGrant passes
      if (isTargetAdminTier(roleDoc, user)) {
        if (!canGrant(req.user, user.trackId || user._id)) {
          return res.status(403).json({ error: 'Access denied: cannot edit user in this tier' });
        }
      }

      // Scope check on target department reassignment
      const newDept = req.body.deptId || req.body.department;
      if (newDept && !assertInScope(req, newDept)) {
        return res.status(403).json({ error: 'Access denied: target department is outside your department scope' });
      }

      const {
        name, fullName, firstName, lastName, username, email, status, active,
        department, deptId, deptCode, designation, employeeNo,
        registerNo, className, class: userClass, classId, courseType, branch, admissionYear, academicYear, batchTrackId, batch, isRep,
        isAdmin: userIsAdmin, defaultAttendanceStatus, specials, mustChangePassword,
        password, residency, gender
      } = req.body;

      // Update username on shadow user if changed
      if (username && username.trim().toLowerCase() !== user.username) {
        const newUsername = username.trim().toLowerCase();
        const RESERVED_USERNAMES = ['admin', 'administrator', 'system', 'root', 'sudo', 'superuser'];
        if (RESERVED_USERNAMES.includes(newUsername)) {
          return res.status(400).json({ error: `Username '${newUsername}' is reserved by the system.` });
        }
        if (newUsername.startsWith('sb-') || newUsername.startsWith('tr-')) {
          return res.status(400).json({ error: "Username prefixes 'SB-' and 'TR-' are reserved for smart board device IDs" });
        }
        const existingUser = await M.User.findOne({ username: newUsername, _id: { $ne: user._id } });
        if (existingUser) {
          return res.status(400).json({ error: 'Username already taken' });
        }
        user.username = newUsername;
      }

      // Update shadow user status with last-admin guard
      targetStatus = status !== undefined ? status : (active !== undefined ? (active ? 'active' : 'inactive') : user.status);
      if (targetStatus !== 'active' && user.status === 'active') {
        const check = await assertNotLastSudoAdmin(user.trackId || user.username || user._id);
        if (!check.allowed) {
          return res.status(403).json({ error: check.error });
        }
      }
      user.status = targetStatus;
      if (targetStatus === 'active') {
        user.failedLogins = 0;
        user.lockedUntil = null;
        if (user.trackId) {
          await M.LoginHistory.updateOne(
            { trackId: user.trackId },
            { $set: { failedLogins: 0, lockedUntil: null } }
          ).catch(() => {});
        }
      }

      await user.save();

      // Update corresponding role model
      if (fullName !== undefined || name !== undefined) roleDoc.fullName = (fullName || name).trim();
      if (firstName !== undefined) roleDoc.firstName = firstName.trim();
      if (lastName !== undefined) roleDoc.lastName = lastName ? lastName.trim() : null;
      if (email !== undefined) roleDoc.email = email.trim().toLowerCase();
      if (username && username.trim().toLowerCase() !== roleDoc.username) {
        roleDoc.username = username.trim().toLowerCase();
      }
      if (department !== undefined) roleDoc.department = department.trim();
      if (deptId !== undefined) roleDoc.deptId = deptId || null;
      if (deptCode !== undefined) roleDoc.deptCode = deptCode.trim().toUpperCase();
      if (mustChangePassword !== undefined) roleDoc.mustChangePassword = !!mustChangePassword;

      // Update role-specific fields
      if (user.role === 'teacher') {
        if (designation !== undefined) roleDoc.designation = designation.trim();
        if (employeeNo !== undefined) roleDoc.employeeNo = employeeNo.trim();

        // Privilege updates (userIsAdmin, specials, pageRights)
        if (userIsAdmin !== undefined || specials !== undefined || req.body.pageRights !== undefined) {
          let candidateSpecials = specials !== undefined && Array.isArray(specials) ? specials : (roleDoc.specials || []);
          let candidatePageRights = req.body.pageRights !== undefined ? req.body.pageRights : (roleDoc.pageRights || []);

          if (userIsAdmin !== undefined) {
            if (userIsAdmin) {
              if (!candidateSpecials.some(s => s && s.option === 'isAdmin')) {
                candidateSpecials = [...candidateSpecials, { option: 'isAdmin', value: true, key: '' }];
              }
            } else {
              candidateSpecials = candidateSpecials.filter(s => s && s.option !== 'isAdmin');
            }
          }

          const sanitized = sanitizeTeacherPrivileges(req.user, roleDoc, candidateSpecials, candidatePageRights);

          // Last Sudo Admin check if demoting
          const willRemainSudo = isSudoAdmin({ specials: sanitized.specials, pageRights: sanitized.pageRights });
          const willBeActive = user.status === 'active';
          if (!willRemainSudo || !willBeActive) {
            const check = await assertNotLastSudoAdmin(roleDoc.trackId || roleDoc._id);
            if (!check.allowed) {
              return res.status(403).json({ error: check.error });
            }
          }

          roleDoc.specials = sanitized.specials;
          roleDoc.pageRights = sanitized.pageRights;
          roleDoc.accessVersion = (roleDoc.accessVersion || 0) + 1;
        }
        if (defaultAttendanceStatus !== undefined) {
          if (!roleDoc.preferences) roleDoc.preferences = {};
          roleDoc.preferences.defaultAttendanceStatus = defaultAttendanceStatus;
        }
      } else if (user.role === 'student') {
        if (registerNo !== undefined) roleDoc.registerNo = registerNo.trim();
        if (className !== undefined || userClass !== undefined) roleDoc.class = (className || userClass || '').trim();
        if (classId !== undefined) roleDoc.classId = classId || null;
        if (courseType !== undefined) roleDoc.courseType = courseType;
        if (branch !== undefined) roleDoc.branch = branch;
        if (admissionYear !== undefined) roleDoc.admissionYear = normalizeYearRange(admissionYear);
        if (batch !== undefined) roleDoc.batch = normalizeYearRange(batch);
        if (batchTrackId !== undefined || batch !== undefined) {
          roleDoc.batchTrackId = toBatchTrackId(roleDoc.batch || batch || batchTrackId) || (batchTrackId || '').trim();
        }
        if (isRep !== undefined) roleDoc.isRep = !!isRep;
        if (gender !== undefined) {
          roleDoc.gender = String(gender).toLowerCase() === 'female' ? 'Female' : 'Male';
        }
        if (residency !== undefined) {
          roleDoc.residency = (String(residency).toLowerCase().includes('hostel')) ? 'hostel' : 'dayscholar';
        }
      }

      // Admin password reset
      if (password && password.trim()) {
        const secSettings = await M.Settings.findOne({ key: 'security' });
        const requireStrong = secSettings?.value?.requireStrongPassword !== false;
        const validation = validatePassword(password, requireStrong);
        if (!validation.isValid) {
          return res.status(400).json({ error: validation.error });
        }

        const history = roleDoc.passwordHistory || [];
        for (const prev of history.slice(-5)) {
          const prevMatch = await bcrypt.compare(password, prev.hash);
          if (prevMatch) {
            return res.status(400).json({ error: "Cannot reuse any of the user's last 5 passwords." });
          }
        }

        const hashed = await bcrypt.hash(password, cfg.BCRYPT_ROUNDS);
        if (!roleDoc.passwordHistory) roleDoc.passwordHistory = [];
        if (roleDoc.password) {
          roleDoc.passwordHistory.push({ hash: roleDoc.password, changedAt: new Date() });
          if (roleDoc.passwordHistory.length > 5) {
            roleDoc.passwordHistory = roleDoc.passwordHistory.slice(-5);
          }
        }
        roleDoc.password = hashed;
        roleDoc.mustChangePassword = mustChangePassword !== undefined ? !!mustChangePassword : true;
        passwordChanged = true;

        if (M.Password && user.trackId) {
          await M.Password.updateOne(
            { trackId: user.trackId },
            { $set: { hash: hashed, passwordChangedAt: new Date() } }
          ).catch(() => {});
        }
      }

      await roleDoc.save();
    }

    // Invalidate sessions on password change or deactivation
    if (passwordChanged || targetStatus !== 'active') {
      const logoutReason = targetStatus !== 'active' ? 'account_deactivated' : (isSelf ? 'password_change' : 'admin_reset');
      if (user.trackId) {
        await Promise.all([
          M.LoginSession.updateMany(
            { trackId: user.trackId, active: true },
            { $set: { active: false, logoutAt: new Date(), logoutMethod: logoutReason } }
          ).catch(() => {}),
          M.LoginHistory.updateOne(
            { trackId: user.trackId },
            {
              $set: {
                'history.$[elem].active': false,
                'history.$[elem].current': 'Logged Out',
                'history.$[elem].logoutTime': new Date(),
                'history.$[elem].logoutMethod': logoutReason
              }
            },
            { arrayFilters: [{ 'elem.active': true }] }
          ).catch(() => {}),
          M.User.updateOne({ trackId: user.trackId }, { $set: { online: false } }).catch(() => {})
        ]);
      }
      await M.ActiveSession.deleteMany({ userId: user._id }).catch(() => {});
    }

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      isSelf ? 'Profile Updated' : 'User Updated',
      isSelf ? `User self-updated profile: ${user.username}` : `Updated user: ${user.username} (${user.role})`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      { module: isSelf ? 'profile' : 'admin', subType: isSelf ? 'self-update' : 'entry-update', trackId: req.user.trackId }
    );

    res.json({ success: true, message: isSelf ? 'Profile updated successfully' : 'User updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/:id/reset-password - Admin reset user password
router.post('/:id/reset-password', authMiddleware, requirePage('control', 'edit', { tab: 'usergrid' }), async (req, res) => {
  try {
    const { newPassword, requireChangeOnLogin } = req.body;
    if (!newPassword || newPassword.trim().length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const secSettings = await M.Settings.findOne({ key: 'security' });
    const requireStrong = secSettings?.value?.requireStrongPassword !== false;
    const validation = validatePassword(newPassword, requireStrong);
    if (!validation.isValid) {
      return res.status(400).json({ error: validation.error });
    }

    const user = await M.User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const model = getRoleModel(user.role);
    if (!model || !user.trackId) {
      return res.status(400).json({ error: 'Cannot find role profile for user' });
    }

    const roleDoc = await model.findOne({ trackId: user.trackId }).select('+password +passwordHistory');
    if (!roleDoc) return res.status(404).json({ error: 'Role document not found' });

    // Scope check: caller must have scope over target's department
    const targetDept = roleDoc.deptId || roleDoc.department || user.department;
    if (!assertInScope(req, targetDept)) {
      return res.status(403).json({ error: 'Access denied: user is outside your department scope' });
    }

    // Tier check: caller cannot reset password of an admin/elevated user unless canGrant passes
    if (isTargetAdminTier(roleDoc, user) && !canGrant(req.user, user.trackId || user._id)) {
      return res.status(403).json({ error: 'Access denied: cannot reset password for user in this tier' });
    }

    // Validate against last 5 passwords
    const history = roleDoc.passwordHistory || [];
    for (const prev of history.slice(-5)) {
      const prevMatch = await bcrypt.compare(newPassword, prev.hash);
      if (prevMatch) {
        return res.status(400).json({ error: 'Cannot reuse any of the user\'s last 5 passwords.' });
      }
    }

    const hashed = await bcrypt.hash(newPassword, cfg.BCRYPT_ROUNDS);
    if (!roleDoc.passwordHistory) roleDoc.passwordHistory = [];
    if (roleDoc.password) {
      roleDoc.passwordHistory.push({ hash: roleDoc.password, changedAt: new Date() });
      if (roleDoc.passwordHistory.length > 5) roleDoc.passwordHistory = roleDoc.passwordHistory.slice(-5);
    }
    roleDoc.password = hashed;
    roleDoc.mustChangePassword = requireChangeOnLogin !== false;
    await roleDoc.save();

    // Reset lockout state
    user.status = 'active';
    user.failedLogins = 0;
    user.lockedUntil = null;
    await user.save();
    await M.LoginHistory.updateOne(
      { trackId: user.trackId },
      { $set: { failedLogins: 0, lockedUntil: null } }
    );

    // Invalidate all active sessions in LoginSession and LoginHistory to force re-login
    await Promise.all([
      M.LoginSession.updateMany(
        { trackId: user.trackId, active: true },
        { $set: { active: false, logoutAt: new Date(), logoutMethod: 'admin_reset' } }
      ).catch(() => {}),
      M.LoginHistory.updateOne(
        { trackId: user.trackId },
        {
          $set: {
            'history.$[elem].active': false,
            'history.$[elem].current': 'Logged Out',
            'history.$[elem].logoutTime': new Date(),
            'history.$[elem].logoutMethod': 'admin_reset'
          }
        },
        { arrayFilters: [{ 'elem.active': true }] }
      ).catch(() => {}),
      M.User.updateOne({ trackId: user.trackId }, { $set: { online: false } }).catch(() => {})
    ]);

    // Invalidate active sessions to force re-login (legacy ActiveSession collection)
    await M.ActiveSession.deleteMany({ userId: user._id }).catch(() => {});

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Password Reset by Admin',
      `Reset password for user: ${user.username}`,
      'security',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'security', trackId: req.user.trackId }
    );

    res.json({ success: true, message: `Password reset successfully for ${user.username}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/:id/unlock - Unlock locked user account
router.post('/:id/unlock', authMiddleware, requirePage('control', 'edit', { tab: 'usergrid' }), async (req, res) => {
  try {
    const user = await M.User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.status = 'active';
    user.failedLogins = 0;
    user.lockedUntil = null;
    await user.save();

    if (user.trackId) {
      await M.LoginHistory.updateOne(
        { trackId: user.trackId },
        { $set: { failedLogins: 0, lockedUntil: null } },
        { upsert: true }
      );
    }

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Account Unlocked',
      `Unlocked account for user: ${user.username}`,
      'security',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'action', trackId: req.user.trackId }
    );

    res.json({ success: true, message: `Account for ${user.username} unlocked successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/bulk-action - Batch action on multiple users
router.post('/bulk-action', authMiddleware, requirePage('control', 'edit', { tab: 'usergrid' }), async (req, res) => {
  try {
    const { userIds, action } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'No user IDs provided' });
    }

    const validActions = ['activate', 'deactivate', 'unlock', 'delete'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` });
    }

    const users = await M.User.find({ _id: { $in: userIds } });
    const trackIds = users.map(u => u.trackId).filter(Boolean);

    if (action === 'deactivate' || action === 'delete') {
      const targetIds = [
        ...trackIds,
        ...users.map(u => u.username).filter(Boolean),
        ...users.map(u => String(u._id))
      ];
      const check = await assertNotLastSudoAdmin(targetIds);
      if (!check.allowed) {
        return res.status(403).json({ error: check.error });
      }
    }

    let affectedCount = 0;

    if (action === 'activate') {
      await M.User.updateMany({ _id: { $in: userIds } }, { $set: { status: 'active', failedLogins: 0, lockedUntil: null } });
      if (trackIds.length) {
        await M.LoginHistory.updateMany({ trackId: { $in: trackIds } }, { $set: { failedLogins: 0, lockedUntil: null } });
      }
      affectedCount = users.length;
    } else if (action === 'deactivate') {
      await M.User.updateMany({ _id: { $in: userIds } }, { $set: { status: 'inactive', online: false } });
      if (trackIds.length) {
        await Promise.all([
          M.LoginSession.updateMany(
            { trackId: { $in: trackIds }, active: true },
            { $set: { active: false, logoutAt: new Date(), logoutMethod: 'admin_reset' } }
          ).catch(() => {}),
          M.LoginHistory.updateMany(
            { trackId: { $in: trackIds } },
            {
              $set: {
                'history.$[elem].active': false,
                'history.$[elem].current': 'Logged Out',
                'history.$[elem].logoutTime': new Date(),
                'history.$[elem].logoutMethod': 'admin_reset'
              }
            },
            { arrayFilters: [{ 'elem.active': true }] }
          ).catch(() => {})
        ]);
      }
      await M.ActiveSession.deleteMany({ userId: { $in: userIds } }).catch(() => {});
      affectedCount = users.length;
    } else if (action === 'unlock') {
      await M.User.updateMany({ _id: { $in: userIds } }, { $set: { status: 'active', failedLogins: 0, lockedUntil: null } });
      if (trackIds.length) {
        await M.LoginHistory.updateMany({ trackId: { $in: trackIds } }, { $set: { failedLogins: 0, lockedUntil: null } });
      }
      affectedCount = users.length;
    } else if (action === 'delete') {
      // Soft-delete with UndoLog snapshot
      for (const u of users) {
        const model = getRoleModel(u.role);
        const roleDoc = (model && u.trackId) ? await model.findOne({ trackId: u.trackId }).lean() : null;

        await M.UndoLog.create({
          collectionName: 'users',
          action: 'delete',
          label: `User ${u.username} (${u.role})`,
          snapshot: { user: u.toObject(), roleDoc },
          deletedBy: req.user.username || 'admin',
          expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }).catch(() => {});
      }

      await M.User.updateMany({ _id: { $in: userIds } }, { $set: { status: 'inactive', online: false } });
      if (trackIds.length) {
        await Promise.all([
          M.LoginSession.updateMany(
            { trackId: { $in: trackIds }, active: true },
            { $set: { active: false, logoutAt: new Date(), logoutMethod: 'admin_reset' } }
          ).catch(() => {}),
          M.LoginHistory.updateMany(
            { trackId: { $in: trackIds } },
            {
              $set: {
                'history.$[elem].active': false,
                'history.$[elem].current': 'Logged Out',
                'history.$[elem].logoutTime': new Date(),
                'history.$[elem].logoutMethod': 'admin_reset'
              }
            },
            { arrayFilters: [{ 'elem.active': true }] }
          ).catch(() => {})
        ]);
      }
      await M.ActiveSession.deleteMany({ userId: { $in: userIds } }).catch(() => {});
      affectedCount = users.length;
    }

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      `Bulk User ${action.toUpperCase()}`,
      `Action ${action} executed on ${affectedCount} user(s)`,
      'data',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'bulk-action', trackId: req.user.trackId }
    );

    res.json({ success: true, message: `Successfully performed '${action}' on ${affectedCount} user(s).`, affectedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id - Safe deactivate or delete user with undo log
router.delete('/:id', authMiddleware, requirePage('control', 'delete', { tab: 'usergrid' }), async (req, res) => {
  try {
    const user = await M.User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const check = await assertNotLastSudoAdmin(user.trackId || user.username || user._id);
    if (!check.allowed) {
      return res.status(403).json({ error: check.error });
    }

    const model = getRoleModel(user.role);
    const roleDoc = (model && user.trackId) ? await model.findOne({ trackId: user.trackId }).lean() : null;

    // Capture snapshot for undo log recovery
    await M.UndoLog.create({
      collectionName: 'users',
      action: 'delete',
      label: `User ${user.username} (${user.role})`,
      snapshot: { user: user.toObject(), roleDoc },
      deletedBy: req.user.username || 'admin',
      expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    }).catch(() => {});

    user.status = 'inactive';
    user.online = false;
    await user.save();

    if (user.trackId) {
      await Promise.all([
        M.LoginSession.updateMany(
          { trackId: user.trackId, active: true },
          { $set: { active: false, logoutAt: new Date(), logoutMethod: 'admin_reset' } }
        ).catch(() => {}),
        M.LoginHistory.updateOne(
          { trackId: user.trackId },
          {
            $set: {
              'history.$[elem].active': false,
              'history.$[elem].current': 'Logged Out',
              'history.$[elem].logoutTime': new Date(),
              'history.$[elem].logoutMethod': 'admin_reset'
            }
          },
          { arrayFilters: [{ 'elem.active': true }] }
        ).catch(() => {})
      ]);
    }

    await M.ActiveSession.deleteMany({ userId: user._id }).catch(() => {});

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'User Deactivated',
      `User ${user.username} deactivated & snapshot stored in Recycle Bin`,
      'data',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'entry-delete', trackId: req.user.trackId }
    );

    res.json({ success: true, deleted: true, message: `User ${user.username} deactivated successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;