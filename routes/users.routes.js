const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const M = require('../models');
const cfg = require('../config');
const { authMiddleware, adminOnly, requireRight, getRoleModel } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { validatePassword } = require('../utils/passwordValidator');

// GET /api/users - List and search users with enriched profile and login status
router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const filter = {};
    if (req.query.role && req.query.role !== 'all') {
      filter.role = sanitizeToString(req.query.role);
    }
    if (req.query.status && req.query.status !== 'all') {
      filter.status = sanitizeToString(req.query.status);
    }

    // Fetch all matching shadow users
    const users = await M.User.find(filter).sort({ role: 1, username: 1 }).lean();

    // Group track IDs by role for batch enrichment
    const adminTrackIds = users.filter(u => u.role === 'admin').map(u => u.trackId).filter(Boolean);
    const teacherTrackIds = users.filter(u => u.role === 'teacher').map(u => u.trackId).filter(Boolean);
    const studentTrackIds = users.filter(u => u.role === 'student').map(u => u.trackId).filter(Boolean);
    const allTrackIds = users.map(u => u.trackId).filter(Boolean);

    const [admins, teachers, students, loginHistories] = await Promise.all([
      adminTrackIds.length ? M.Admin.find({ trackId: { $in: adminTrackIds } }).lean() : [],
      teacherTrackIds.length ? M.Teacher.find({ trackId: { $in: teacherTrackIds } }).lean() : [],
      studentTrackIds.length ? M.Student.find({ trackId: { $in: studentTrackIds } }).lean() : [],
      allTrackIds.length ? M.LoginHistory.find({ trackId: { $in: allTrackIds } }).lean() : []
    ]);

    const adminMap = new Map();
    const teacherMap = new Map();
    const studentMap = new Map();
    const loginMap = new Map();

    admins.forEach(a => adminMap.set(a.trackId, a));
    teachers.forEach(t => teacherMap.set(t.trackId, t));
    students.forEach(s => studentMap.set(s.trackId, s));
    loginHistories.forEach(l => loginMap.set(l.trackId, l));

    // Combine and enrich user objects
    let enriched = users.map(u => {
      const login = loginMap.get(u.trackId) || {};
      const isLocked = u.status === 'locked' || (login.lockedUntil && new Date(login.lockedUntil) > new Date());
      const effectiveStatus = isLocked ? 'locked' : (u.status || 'active');

      let profile = {};
      if (u.role === 'admin') {
        const a = adminMap.get(u.trackId) || {};
        profile = {
          roleDocId: a._id || null,
          fullName: a.fullName || a.username || u.username,
          firstName: a.firstName || '',
          lastName: a.lastName || '',
          employeeNo: a.employeeNo || '',
          department: a.department || '',
          email: a.email || '',
          isAdmin: a.isAdmin !== false,
          adminRights: a.adminRights || 'all',
          mustChangePassword: !!a.mustChangePassword,
        };
      } else if (u.role === 'teacher') {
        const t = teacherMap.get(u.trackId) || {};
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
          isAdmin: !!t.isAdmin,
          adminRights: t.adminRights || ['none'],
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
          section: s.section || '',
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
        failedLogins: login.failedLogins || 0,
        lockedUntil: login.lockedUntil || null,
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

// PUT /api/users/:id - Update user across shadow User and role document
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const isSelf = String(req.user._id) === String(req.params.id);
    const isAdmin = req.user.role === 'admin';
    
    const rights = req.user.adminRights;
    const hasManageUser = rights === 'all' || (Array.isArray(rights) && (rights.includes('all') || rights.includes('managePage') || rights.includes('controlPage')));
    const canEditOthers = isAdmin || hasManageUser;

    if (!isSelf && !canEditOthers) {
      return res.status(403).json({ error: 'Forbidden: cannot edit other users' });
    }

    const {
      name, fullName, firstName, lastName, username, email, status, active,
      department, deptId, deptCode, designation, employeeNo,
      registerNo, className, class: userClass, classId, section, courseType, branch, admissionYear, academicYear, batchTrackId, batch, isRep,
      isAdmin: userIsAdmin, adminRights, defaultAttendanceStatus, specials, mustChangePassword,
      password, currentPassword
    } = req.body;

    const user = await M.User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Update username on shadow user if changed
    if (username && username.trim().toLowerCase() !== user.username) {
      const newUsername = username.trim().toLowerCase();
      const existingUser = await M.User.findOne({ username: newUsername, _id: { $ne: user._id } });
      if (existingUser) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      user.username = newUsername;
    }

    // Update shadow user status
    if (status !== undefined) {
      user.status = status;
    } else if (active !== undefined) {
      user.status = active ? 'active' : 'inactive';
    }

    await user.save();

    // Update corresponding role model
    const model = getRoleModel(user.role);
    if (model && user.trackId) {
      const roleDoc = await model.findOne({ trackId: user.trackId }).select('+password +passwordHistory');
      if (roleDoc) {
        if (fullName !== undefined) roleDoc.fullName = fullName.trim();
        if (firstName !== undefined) roleDoc.firstName = firstName.trim();
        if (lastName !== undefined) roleDoc.lastName = lastName.trim();
        if (email !== undefined) roleDoc.email = email.trim().toLowerCase();
        if (username && username.trim().toLowerCase() !== roleDoc.username) {
          roleDoc.username = username.trim().toLowerCase();
        }
        if (department !== undefined) roleDoc.department = department.trim();
        if (deptId !== undefined) roleDoc.deptId = deptId || null;
        if (deptCode !== undefined) roleDoc.deptCode = deptCode.trim().toUpperCase();
        if (mustChangePassword !== undefined) roleDoc.mustChangePassword = !!mustChangePassword;

        // Update role-specific fields
        if (user.role === 'admin') {
          if (employeeNo !== undefined) roleDoc.employeeNo = employeeNo.trim();
          if (adminRights !== undefined) roleDoc.adminRights = adminRights;
        } else if (user.role === 'teacher') {
          if (designation !== undefined) roleDoc.designation = designation.trim();
          if (employeeNo !== undefined) roleDoc.employeeNo = employeeNo.trim();
          if (userIsAdmin !== undefined) roleDoc.isAdmin = !!userIsAdmin;
          if (adminRights !== undefined) roleDoc.adminRights = adminRights;
          if (defaultAttendanceStatus !== undefined) {
            if (!roleDoc.preferences) roleDoc.preferences = {};
            roleDoc.preferences.defaultAttendanceStatus = defaultAttendanceStatus;
          }
          if (specials !== undefined && Array.isArray(specials)) {
            roleDoc.specials = specials;
          }
        } else if (user.role === 'student') {
          if (registerNo !== undefined) roleDoc.registerNo = registerNo.trim();
          if (className !== undefined || userClass !== undefined) roleDoc.class = (className || userClass || '').trim();
          if (classId !== undefined) roleDoc.classId = classId || null;
          if (section !== undefined) roleDoc.section = section.trim();
          if (courseType !== undefined) roleDoc.courseType = courseType;
          if (branch !== undefined) roleDoc.branch = branch;
          if (admissionYear !== undefined) roleDoc.admissionYear = admissionYear.trim();
          if (batchTrackId !== undefined || batch !== undefined) roleDoc.batchTrackId = (batchTrackId || batch || '').trim();
          if (isRep !== undefined) roleDoc.isRep = !!isRep;
        }

        // Process password update if supplied
        if (password && password.trim()) {
          if (isSelf) {
            if (!currentPassword) {
              return res.status(400).json({ error: 'Current password is required to change password' });
            }
            const match = await bcrypt.compare(currentPassword, roleDoc.password);
            if (!match) return res.status(401).json({ error: 'Current password incorrect' });
          }

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
              return res.status(400).json({ error: 'Cannot reuse any of the user\'s last 5 passwords.' });
            }
          }

          const hashed = await bcrypt.hash(password, cfg.BCRYPT_ROUNDS);
          if (!roleDoc.passwordHistory) roleDoc.passwordHistory = [];
          if (roleDoc.password) {
            roleDoc.passwordHistory.push({ hash: roleDoc.password, changedAt: new Date() });
            if (roleDoc.passwordHistory.length > 5) roleDoc.passwordHistory = roleDoc.passwordHistory.slice(-5);
          }
          roleDoc.password = hashed;
          if (isSelf) roleDoc.mustChangePassword = false;
        }

        await roleDoc.save();
      }
    }

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'User Updated',
      `Updated user: ${user.username} (${user.role})`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'entry-update', trackId: req.user.trackId }
    );

    res.json({ success: true, message: 'User updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/:id/reset-password - Admin reset user password
router.post('/:id/reset-password', authMiddleware, adminOnly, async (req, res) => {
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

    // Reset lockout state if locked
    if (user.status === 'locked') {
      user.status = 'active';
      await user.save();
    }
    await M.LoginHistory.updateOne(
      { trackId: user.trackId },
      { $set: { failedLogins: 0, lockedUntil: null } }
    );

    // Invalidate active sessions to force re-login
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
router.post('/:id/unlock', authMiddleware, adminOnly, async (req, res) => {
  try {
    const user = await M.User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.status = 'active';
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
router.post('/bulk-action', authMiddleware, adminOnly, async (req, res) => {
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

    let affectedCount = 0;

    if (action === 'activate') {
      await M.User.updateMany({ _id: { $in: userIds } }, { $set: { status: 'active' } });
      if (trackIds.length) {
        await M.LoginHistory.updateMany({ trackId: { $in: trackIds } }, { $set: { failedLogins: 0, lockedUntil: null } });
      }
      affectedCount = users.length;
    } else if (action === 'deactivate') {
      await M.User.updateMany({ _id: { $in: userIds } }, { $set: { status: 'inactive' } });
      await M.ActiveSession.deleteMany({ userId: { $in: userIds } }).catch(() => {});
      affectedCount = users.length;
    } else if (action === 'unlock') {
      await M.User.updateMany({ _id: { $in: userIds } }, { $set: { status: 'active' } });
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

      await M.User.updateMany({ _id: { $in: userIds } }, { $set: { status: 'inactive' } });
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
router.delete('/:id', authMiddleware, adminOnly, requireRight('deletings'), async (req, res) => {
  try {
    const user = await M.User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

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
    await user.save();

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

// Executive roles management endpoints
router.get('/executive/roles', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [principals, depts, teachers, subadminAdmins] = await Promise.all([
      M.Admin.find({ adminFlag: 'principal' }).select('-password -passwordHistory').lean(),
      M.Department.find({}).lean(),
      M.Teacher.find({}).select('-password -passwordHistory').sort({ fullName: 1 }).lean(),
      M.Admin.find({ adminFlag: 'subadmin' }).select('-password -passwordHistory').lean()
    ]);

    const teacherMap = new Map();
    teachers.forEach(t => teacherMap.set(String(t._id), t));
    teachers.forEach(t => teacherMap.set(t.trackId, t));

    // Format HODs
    const hods = depts.map(d => {
      let hodTeacher = null;
      if (d.hodId) hodTeacher = teacherMap.get(String(d.hodId));
      if (!hodTeacher && d.hodName) {
        hodTeacher = teachers.find(t => t.fullName === d.hodName || (t.specials || []).some(s => s.option === 'isHod' && (s.key === d.name || s.value === d.trackId)));
      }
      return {
        deptId: d._id,
        deptName: d.name,
        deptCode: d.code || d.threeLetterCode || '',
        deptNumber: d.number || '',
        hodId: hodTeacher?._id || d.hodId || null,
        hodName: hodTeacher?.fullName || d.hodName || 'Not Assigned',
        hodTrackId: hodTeacher?.trackId || '',
        hodEmail: hodTeacher?.email || '—',
        hodEmpNo: hodTeacher?.employeeNo || '—'
      };
    });

    // Format sub-admin accounts combining faculty and administrative users
    const teacherSubAdmins = teachers
      .filter(t => t.isAdmin === true || (Array.isArray(t.adminRights) && t.adminRights.length && !t.adminRights.every(r => r === 'none')))
      .map(t => ({
        _id: t._id,
        trackId: t.trackId,
        fullName: t.fullName,
        username: t.username,
        department: t.department || '',
        type: 'Teacher (Faculty Sub-Admin)',
        adminRights: t.adminRights || []
      }));

    const customSubAdmins = subadminAdmins.map(a => ({
      _id: a._id,
      trackId: a.trackId,
      fullName: a.fullName,
      username: a.username,
      department: a.department || 'Administration',
      type: 'Admin Account (Sub-Admin)',
      adminRights: a.adminRights || []
    }));

    res.json({
      principal: principals[0] || null,
      allPrincipals: principals,
      hods,
      subadmins: [...teacherSubAdmins, ...customSubAdmins],
      departments: depts.map(d => ({ _id: d._id, name: d.name, code: d.code || d.threeLetterCode || '' })),
      teachers: teachers.map(t => ({ _id: t._id, trackId: t.trackId, fullName: t.fullName, department: t.department || '' }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/executive/assign-principal - Create or update Principal account
router.post('/executive/assign-principal', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { fullName, username, password, email, employeeNo } = req.body;
    if (!fullName || !username) {
      return res.status(400).json({ error: 'Full name and username required' });
    }

    const cleanUsername = username.toLowerCase().trim();
    if (cleanUsername === 'admin') {
      return res.status(400).json({ error: 'Username "admin" is reserved strictly for Super Administrator' });
    }

    let adminDoc = await M.Admin.findOne({ username: cleanUsername });

    if (adminDoc) {
      // Update existing principal admin record
      adminDoc.adminFlag = 'principal';
      adminDoc.fullName = fullName.trim();
      if (email) adminDoc.email = email.trim();
      if (employeeNo) adminDoc.employeeNo = employeeNo.trim();
      if (password && password.trim()) {
        adminDoc.password = await bcrypt.hash(password, cfg.BCRYPT_ROUNDS);
      }
      await adminDoc.save();
    } else {
      // Create new principal admin record
      if (!password || !password.trim()) {
        return res.status(400).json({ error: 'Password is required when creating a new Principal account' });
      }
      const hash = await bcrypt.hash(password, cfg.BCRYPT_ROUNDS);
      const trackId = `TR-PRIN${Date.now().toString().slice(-4)}`;

      adminDoc = await M.Admin.create({
        fullName: fullName.trim(),
        username: cleanUsername,
        password: hash,
        email: email || '',
        employeeNo: employeeNo || 'PRIN001',
        department: 'Office of the Principal',
        trackId: trackId,
        isAdmin: true,
        adminFlag: 'principal',
        adminRights: 'all',
        mustChangePassword: true
      });

      await M.User.create({
        username: cleanUsername,
        trackId: trackId,
        role: 'admin',
        status: 'active'
      });
    }

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Principal Assigned',
      `Assigned Principal role to ${fullName} (@${cleanUsername})`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'role-assign' }
    );

    res.json({ success: true, message: `Principal ${fullName} assigned successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/executive/assign-hod - Designate Department HOD
router.post('/executive/assign-hod', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { deptId, teacherId } = req.body;
    if (!deptId || !teacherId) {
      return res.status(400).json({ error: 'Department and Teacher selections are required' });
    }

    const dept = await M.Department.findById(deptId);
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    const newHodTeacher = await M.Teacher.findById(teacherId);
    if (!newHodTeacher) return res.status(404).json({ error: 'Faculty member not found' });

    // Remove previous HOD designation for this department
    if (dept.hodId) {
      const prevTeacher = await M.Teacher.findById(dept.hodId);
      if (prevTeacher) {
        prevTeacher.specials = (prevTeacher.specials || []).filter(s => !(s.option === 'isHod' && (s.key === dept.name || s.value === dept.trackId)));
        await prevTeacher.save();
      }
    }

    // Update department record with new HOD reference
    dept.hodId = newHodTeacher._id;
    dept.hodName = newHodTeacher.fullName;
    await dept.save();

    // Assign HOD special privileges to new teacher
    const specials = (newHodTeacher.specials || []).filter(s => s.option !== 'isHod' && s.option !== 'HodDeptTrackId');
    specials.push({ option: 'isHod', value: true, key: dept.name });
    if (dept.trackId) {
      specials.push({ option: 'HodDeptTrackId', value: dept.trackId, key: dept.name });
    }
    newHodTeacher.specials = specials;
    await newHodTeacher.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'HOD Assigned',
      `Assigned ${newHodTeacher.fullName} as HOD of ${dept.name}`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'role-assign' }
    );

    res.json({ success: true, message: `Assigned ${newHodTeacher.fullName} as HOD of ${dept.name}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/executive/grant-subadmin - Grant or update Sub-Admin privileges
router.post('/executive/grant-subadmin', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { teacherId, adminRights } = req.body;
    if (!teacherId) return res.status(400).json({ error: 'Faculty selection required' });

    const teacher = await M.Teacher.findById(teacherId);
    if (!teacher) return res.status(404).json({ error: 'Faculty member not found' });

    const rightsArray = Array.isArray(adminRights) && adminRights.length ? adminRights : ['controlPage'];
    teacher.isAdmin = true;
    teacher.adminRights = rightsArray;
    await teacher.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Sub-Admin Privileges Granted',
      `Granted sub-admin rights (${rightsArray.join(', ')}) to ${teacher.fullName}`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'role-assign' }
    );

    res.json({ success: true, message: `Sub-admin rights updated for ${teacher.fullName}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;