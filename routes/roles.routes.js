const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { requirePage, assertInScope } = require('../middleware/pageAccess');
const { assignRole, endRole } = require('../utils/roleAssign');
const { sanitizeToString, sanitizeToObjectId } = require('../utils/sanitizeQuery');
const { logAction } = require('../utils/logAction');

/**
 * Helper to extract actor object for roleAssign service
 */
function getActor(req) {
  return {
    trackId: req.user.trackId || String(req.user._id),
    name: req.user.fullName || req.user.name || req.user.username,
    role: req.user.role || 'teacher',
    ip: req.ip,
    sessionId: req.user.sessionId
  };
}

/**
 * GET /api/roles/overview
 * Returns executive overview cards for departments (§7.4)
 */
router.get('/overview', authMiddleware, requirePage('admin', 'view', { tab: 'roles' }), async (req, res) => {
  try {
    let deptQuery = {};
    if (!req.user.isSudoAdmin) {
      // Super Admin limited to own department
      const userDeptId = req.access?.pages?.admin?.deptId || req.user.deptId;
      if (!userDeptId) {
        return res.json([]);
      }
      deptQuery._id = userDeptId;
    }

    const departments = await M.Department.find(deptQuery).sort({ name: 1 }).lean();
    const deptIds = departments.map(d => d._id);

    // Parallel queries for stats and assignments
    const [activeAssignments, classes, teachers, actingRoles] = await Promise.all([
      M.RoleAssignment.find({
        deptId: { $in: deptIds },
        active: true
      }).lean(),
      M.Class.find({ deptId: { $in: deptIds } }).select('deptId advisorTeacherId').lean(),
      M.Teacher.aggregate([
        { $match: { deptId: { $in: deptIds } } },
        { $group: { _id: '$deptId', count: { $sum: 1 } } }
      ]),
      M.ActingRole ? M.ActingRole.find({ deptId: { $in: deptIds }, active: true }).lean() : Promise.resolve([])
    ]);

    const teacherCountMap = new Map();
    teachers.forEach(t => teacherCountMap.set(String(t._id), t.count));

    const overview = departments.map(dept => {
      const dIdStr = String(dept._id);
      const deptAssigns = activeAssignments.filter(a => String(a.deptId) === dIdStr);
      const deptClasses = classes.filter(c => String(c.deptId) === dIdStr);

      const hodAssign = deptAssigns.find(a => a.role === 'hod');
      const superAdminAssign = deptAssigns.find(a => a.role === 'superAdmin');
      const ttAssign = deptAssigns.find(a => a.role === 'ttCoordinator');
      const placementAssign = deptAssigns.find(a => a.role === 'placementCoordinator');
      const actingHod = actingRoles.find(ar => String(ar.deptId) === dIdStr && ar.role === 'hod');

      const totalClasses = deptClasses.length;
      const assignedAdvisors = deptClasses.filter(c => c.advisorTeacherId).length;

      return {
        _id: dept._id,
        name: dept.name,
        code: dept.code,
        number: dept.number,
        twoLetterCode: dept.twoLetterCode,
        threeLetterCode: dept.threeLetterCode,
        icon: dept.icon || 'building2',
        staffCount: teacherCountMap.get(dIdStr) || 0,
        classCount: totalClasses,
        hod: hodAssign ? {
          teacherId: hodAssign.teacherId,
          name: hodAssign.teacherName,
          trackId: hodAssign.teacherTrackId
        } : (dept.hodName ? { name: dept.hodName, teacherId: dept.hodId } : null),
        superAdmin: superAdminAssign ? {
          teacherId: superAdminAssign.teacherId,
          name: superAdminAssign.teacherName,
          trackId: superAdminAssign.teacherTrackId
        } : null,
        ttCoordinator: ttAssign ? {
          teacherId: ttAssign.teacherId,
          name: ttAssign.teacherName,
          trackId: ttAssign.teacherTrackId
        } : null,
        placementCoordinator: placementAssign ? {
          teacherId: placementAssign.teacherId,
          name: placementAssign.teacherName,
          trackId: placementAssign.teacherTrackId
        } : null,
        advisors: {
          total: totalClasses,
          assigned: assignedAdvisors,
          open: Math.max(0, totalClasses - assignedAdvisors)
        },
        actingHod: actingHod ? {
          name: actingHod.actingTeacherName,
          to: actingHod.to
        } : null
      };
    });

    res.json(overview);
  } catch (err) {
    console.error('[GET /api/roles/overview error]:', err);
    res.status(500).json({ error: 'Failed to fetch executive roles overview', details: err.message });
  }
});

/**
 * GET /api/roles/departments/:deptId
 * Drawer: returns role details and privileged staff for a single department (§7.5)
 */
router.get('/departments/:deptId', authMiddleware, requirePage('admin', 'view', { tab: 'roles' }), async (req, res) => {
  try {
    const deptId = sanitizeToObjectId(req.params.deptId);
    if (!deptId) return res.status(400).json({ error: 'Invalid department ID' });

    assertInScope(req, deptId);

    const [dept, assignments, privilegedStaff, history] = await Promise.all([
      M.Department.findById(deptId).lean(),
      M.RoleAssignment.find({ deptId, active: true }).lean(),
      M.Teacher.find({
        deptId,
        'pageRights.grants.0': { $exists: true }
      }).select('fullName employeeNo designation department pageRights').lean(),
      M.RoleAssignment.find({ deptId, active: false }).sort({ to: -1 }).limit(20).lean()
    ]);

    if (!dept) return res.status(404).json({ error: 'Department not found' });

    // Super Admin bulk upload setting status
    const superAdminTeacher = assignments.find(a => a.role === 'superAdmin');
    let bulkEnabled = false;
    if (superAdminTeacher) {
      const saDoc = await M.Teacher.findById(superAdminTeacher.teacherId).select('pageRights').lean();
      const bulkGrant = (saDoc?.pageRights?.grants || []).find(g => g.page === 'bulk');
      bulkEnabled = Boolean(bulkGrant && bulkGrant.enabled);
    }

    res.json({
      department: dept,
      roles: {
        hod: assignments.find(a => a.role === 'hod') || null,
        superAdmin: superAdminTeacher || null,
        ttCoordinator: assignments.find(a => a.role === 'ttCoordinator') || null,
        placementCoordinator: assignments.find(a => a.role === 'placementCoordinator') || null
      },
      privilegedStaff: privilegedStaff.map(p => ({
        _id: p._id,
        fullName: p.fullName,
        employeeNo: p.employeeNo,
        designation: p.designation,
        accessRole: p.pageRights?.accessRole,
        grants: p.pageRights?.grants || []
      })),
      superAdminSettings: {
        bulkUploadsAllowed: bulkEnabled
      },
      history
    });
  } catch (err) {
    if (err.status === 403) return res.status(403).json({ error: err.message, code: err.code });
    console.error('[GET /api/roles/departments/:deptId error]:', err);
    res.status(500).json({ error: 'Failed to fetch department roles', details: err.message });
  }
});

/**
 * GET /api/roles/departments/:deptId/staff?role=
 * Searchable staff picker for assigning roles (§7.5)
 */
router.get('/departments/:deptId/staff', authMiddleware, requirePage('admin', 'view', { tab: 'roles' }), async (req, res) => {
  try {
    const deptId = sanitizeToObjectId(req.params.deptId);
    if (!deptId) return res.status(400).json({ error: 'Invalid department ID' });

    assertInScope(req, deptId);

    const targetRole = sanitizeToString(req.query.role);
    const dept = await M.Department.findById(deptId).lean();
    const queryConditions = [{ deptId }];
    if (dept) {
      if (dept.name) queryConditions.push({ department: dept.name });
      if (dept.code) queryConditions.push({ deptCode: dept.code });
    }
    const teachers = await M.Teacher.find(queryConditions.length > 1 ? { $or: queryConditions } : { deptId })
      .select('fullName firstName lastName employeeNo designation department specials pageRights gender')
      .sort({ fullName: 1 })
      .lean();

    const teacherIds = teachers.map(t => t._id);
    const activeAssignments = await M.RoleAssignment.find({
      teacherId: { $in: teacherIds },
      active: true
    }).lean();

    const staffWithRoles = teachers.map(t => {
      const tIdStr = String(t._id);
      const rolesHeld = activeAssignments
        .filter(a => String(a.teacherId) === tIdStr)
        .map(a => a.role);

      return {
        _id: t._id,
        fullName: t.fullName,
        employeeNo: t.employeeNo,
        designation: t.designation,
        department: t.department,
        gender: t.gender,
        rolesHeld,
        isSudoAdmin: t.pageRights?.accessRole === 'sudoAdmin' || (t.specials || []).some(s => s.option === 'isAdmin' && t.pageRights?.accessRole === 'sudoAdmin'),
        isSuperAdmin: rolesHeld.includes('superAdmin'),
        isHod: rolesHeld.includes('hod'),
        isEligible: !(targetRole === 'superAdmin' && t.pageRights?.accessRole === 'sudoAdmin')
      };
    });

    res.json(staffWithRoles);
  } catch (err) {
    if (err.status === 403) return res.status(403).json({ error: err.message, code: err.code });
    console.error('[GET /api/roles/departments/:deptId/staff error]:', err);
    res.status(500).json({ error: 'Failed to fetch eligible staff', details: err.message });
  }
});

/**
 * PUT /api/roles/departments/:deptId/:role
 * Assign / replace department-level role (§7.2, §7.8)
 */
router.put('/departments/:deptId/:role', authMiddleware, requirePage('admin', 'assign', { tab: 'roles' }), async (req, res) => {
  try {
    const deptId = sanitizeToObjectId(req.params.deptId);
    const role = sanitizeToString(req.params.role);
    if (!deptId) return res.status(400).json({ error: 'Invalid department ID' });

    assertInScope(req, deptId);

    // Permission Matrix (§7.2): Super Admin can only assign ttCoordinator, placementCoordinator
    if (!req.user.isSudoAdmin && !['ttCoordinator', 'placementCoordinator'].includes(role)) {
      return res.status(403).json({
        error: `Super Admins cannot assign or modify "${role}". Only Sudo Admin can manage HODs and Super Admins.`,
        code: 'FORBIDDEN'
      });
    }

    const teacherId = sanitizeToObjectId(req.body.teacherId);
    if (!teacherId) return res.status(400).json({ error: 'Faculty member ID is required', code: 'TEACHER_REQUIRED' });

    // Self-grant guard (§7.8 rule 8)
    if (!req.user.isSudoAdmin && String(teacherId) === String(req.user._id)) {
      return res.status(403).json({
        error: 'Administrators cannot assign roles to themselves.',
        code: 'SELF_GRANT_FORBIDDEN'
      });
    }

    const expectedCurrentTeacherId = req.body.expectedCurrentTeacherId !== undefined
      ? (sanitizeToObjectId(req.body.expectedCurrentTeacherId) || null)
      : undefined;

    const assignment = await assignRole({
      role,
      scopeId: deptId,
      teacherId,
      expectedCurrentTeacherId,
      actor: getActor(req),
      reason: sanitizeToString(req.body.reason)
    });

    res.json({
      ok: true,
      message: `${role} assigned successfully.`,
      assignment
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code, details: err.currentAssignment });
    }
    console.error('[PUT /api/roles/departments/:deptId/:role error]:', err);
    res.status(500).json({ error: 'Failed to assign role', details: err.message });
  }
});

/**
 * DELETE /api/roles/departments/:deptId/:role
 * Remove department-level role (§7.2, §7.8)
 */
router.delete('/departments/:deptId/:role', authMiddleware, requirePage('admin', 'assign', { tab: 'roles' }), async (req, res) => {
  try {
    const deptId = sanitizeToObjectId(req.params.deptId);
    const role = sanitizeToString(req.params.role);
    if (!deptId) return res.status(400).json({ error: 'Invalid department ID' });

    assertInScope(req, deptId);

    if (!req.user.isSudoAdmin && !['ttCoordinator', 'placementCoordinator'].includes(role)) {
      return res.status(403).json({
        error: `Super Admins cannot remove "${role}". Only Sudo Admin can manage HODs and Super Admins.`,
        code: 'FORBIDDEN'
      });
    }

    const assignment = await endRole({
      role,
      scopeId: deptId,
      actor: getActor(req),
      reason: sanitizeToString(req.body.reason) || 'Removed by admin'
    });

    res.json({
      ok: true,
      message: `${role} removed successfully.`,
      assignment
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('[DELETE /api/roles/departments/:deptId/:role error]:', err);
    res.status(500).json({ error: 'Failed to remove role', details: err.message });
  }
});

/**
 * GET /api/roles/departments/:deptId/advisors
 * Drawer: returns classes and advisors for a department (§7.6)
 */
router.get('/departments/:deptId/advisors', authMiddleware, requirePage('admin', 'view', { tab: 'roles' }), async (req, res) => {
  try {
    const deptId = sanitizeToObjectId(req.params.deptId);
    if (!deptId) return res.status(400).json({ error: 'Invalid department ID' });

    assertInScope(req, deptId);

    const classes = await M.Class.find({ deptId })
      .populate('advisorTeacherId', 'fullName employeeNo designation trackId')
      .sort({ academicYear: -1, year: 1, section: 1 })
      .lean();

    res.json(classes.map(c => ({
      _id: c._id,
      name: c.name || `${c.year} ${c.deptCode || ''} ${c.section || ''}`.trim(),
      year: c.year,
      section: c.section,
      batch: c.batch,
      academicYear: c.academicYear,
      advisor: c.advisorTeacherId ? {
        _id: c.advisorTeacherId._id,
        fullName: c.advisorTeacherId.fullName,
        employeeNo: c.advisorTeacherId.employeeNo,
        designation: c.advisorTeacherId.designation
      } : null
    })));
  } catch (err) {
    if (err.status === 403) return res.status(403).json({ error: err.message, code: err.code });
    console.error('[GET /api/roles/departments/:deptId/advisors error]:', err);
    res.status(500).json({ error: 'Failed to fetch class advisors', details: err.message });
  }
});

/**
 * PUT /api/roles/classes/:classId/advisor
 * Assign / replace class advisor (§7.6)
 */
router.put('/classes/:classId/advisor', authMiddleware, requirePage('admin', 'assign', { tab: 'roles' }), async (req, res) => {
  try {
    const classId = sanitizeToObjectId(req.params.classId);
    if (!classId) return res.status(400).json({ error: 'Invalid class ID' });

    const classDoc = await M.Class.findById(classId).lean();
    if (!classDoc) return res.status(404).json({ error: 'Class not found' });

    assertInScope(req, classDoc.deptId);

    const teacherId = sanitizeToObjectId(req.body.teacherId);
    if (!teacherId) return res.status(400).json({ error: 'Advisor faculty member ID is required' });

    const expectedCurrentTeacherId = req.body.expectedCurrentTeacherId !== undefined
      ? (sanitizeToObjectId(req.body.expectedCurrentTeacherId) || null)
      : undefined;

    const assignment = await assignRole({
      role: 'classAdvisor',
      scopeId: classId,
      teacherId,
      expectedCurrentTeacherId,
      actor: getActor(req),
      reason: sanitizeToString(req.body.reason)
    });

    res.json({
      ok: true,
      message: 'Class advisor assigned successfully.',
      assignment
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('[PUT /api/roles/classes/:classId/advisor error]:', err);
    res.status(500).json({ error: 'Failed to assign class advisor', details: err.message });
  }
});

/**
 * DELETE /api/roles/classes/:classId/advisor
 * Remove class advisor (§7.6)
 */
router.delete('/classes/:classId/advisor', authMiddleware, requirePage('admin', 'assign', { tab: 'roles' }), async (req, res) => {
  try {
    const classId = sanitizeToObjectId(req.params.classId);
    if (!classId) return res.status(400).json({ error: 'Invalid class ID' });

    const classDoc = await M.Class.findById(classId).lean();
    if (!classDoc) return res.status(404).json({ error: 'Class not found' });

    assertInScope(req, classDoc.deptId);

    const assignment = await endRole({
      role: 'classAdvisor',
      scopeId: classId,
      actor: getActor(req),
      reason: sanitizeToString(req.body.reason) || 'Removed advisor'
    });

    res.json({
      ok: true,
      message: 'Class advisor removed successfully.',
      assignment
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('[DELETE /api/roles/classes/:classId/advisor error]:', err);
    res.status(500).json({ error: 'Failed to remove class advisor', details: err.message });
  }
});

/**
 * GET /api/roles/wardens
 * Sudo only: lists hostel blocks and wardens (§7.7)
 */
router.get('/wardens', authMiddleware, requirePage('admin', 'view', { tab: 'roles' }), async (req, res) => {
  try {
    if (!req.user.isSudoAdmin) {
      return res.status(403).json({ error: 'Only Sudo Admin can view hostel wardens.', code: 'FORBIDDEN' });
    }

    const hostels = await M.Hostel.find().sort({ code: 1 }).lean();
    const blocks = await M.Block.find().sort({ code: 1 }).lean();
    const blockIds = blocks.map(b => b._id);

    const activeAssignments = await M.RoleAssignment.find({
      scopeId: { $in: blockIds },
      role: 'warden',
      active: true
    }).populate('teacherId', 'fullName employeeNo department gender').lean();

    const result = hostels.map(h => {
      const hBlocks = blocks.filter(b => String(b.hostelId) === String(h._id)).map(b => {
        const assign = activeAssignments.find(a => String(a.scopeId) === String(b._id));
        return {
          _id: b._id,
          code: b.code,
          name: b.name,
          floors: b.floors,
          warden: assign ? {
            teacherId: assign.teacherId?._id || assign.teacherId,
            fullName: assign.teacherName,
            department: assign.teacherId?.department || '',
            gender: assign.teacherId?.gender || ''
          } : null
        };
      });

      return {
        _id: h._id,
        code: h.code,
        name: h.name,
        gender: h.gender,
        blocks: hBlocks
      };
    });

    res.json(result);
  } catch (err) {
    console.error('[GET /api/roles/wardens error]:', err);
    res.status(500).json({ error: 'Failed to fetch hostel wardens', details: err.message });
  }
});

/**
 * PUT /api/roles/blocks/:blockId/warden
 * Sudo only: assigns hostel block warden (§7.7)
 */
router.put('/blocks/:blockId/warden', authMiddleware, requirePage('admin', 'assign', { tab: 'roles' }), async (req, res) => {
  try {
    if (!req.user.isSudoAdmin) {
      return res.status(403).json({ error: 'Only Sudo Admin can assign hostel wardens.', code: 'FORBIDDEN' });
    }

    const blockId = sanitizeToObjectId(req.params.blockId);
    const teacherId = sanitizeToObjectId(req.body.teacherId);
    if (!blockId || !teacherId) return res.status(400).json({ error: 'Block ID and Teacher ID are required' });

    const expectedCurrentTeacherId = req.body.expectedCurrentTeacherId !== undefined
      ? (sanitizeToObjectId(req.body.expectedCurrentTeacherId) || null)
      : undefined;

    const assignment = await assignRole({
      role: 'warden',
      scopeId: blockId,
      teacherId,
      expectedCurrentTeacherId,
      actor: getActor(req),
      reason: sanitizeToString(req.body.reason)
    });

    res.json({
      ok: true,
      message: 'Hostel block warden assigned successfully.',
      assignment
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('[PUT /api/roles/blocks/:blockId/warden error]:', err);
    res.status(500).json({ error: 'Failed to assign hostel warden', details: err.message });
  }
});

/**
 * DELETE /api/roles/blocks/:blockId/warden
 * Sudo only: removes hostel block warden (§7.7)
 */
router.delete('/blocks/:blockId/warden', authMiddleware, requirePage('admin', 'assign', { tab: 'roles' }), async (req, res) => {
  try {
    if (!req.user.isSudoAdmin) {
      return res.status(403).json({ error: 'Only Sudo Admin can remove hostel wardens.', code: 'FORBIDDEN' });
    }

    const blockId = sanitizeToObjectId(req.params.blockId);
    if (!blockId) return res.status(400).json({ error: 'Invalid block ID' });

    const assignment = await endRole({
      role: 'warden',
      scopeId: blockId,
      actor: getActor(req),
      reason: sanitizeToString(req.body.reason) || 'Removed warden'
    });

    res.json({
      ok: true,
      message: 'Hostel block warden removed successfully.',
      assignment
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('[DELETE /api/roles/blocks/:blockId/warden error]:', err);
    res.status(500).json({ error: 'Failed to remove hostel warden', details: err.message });
  }
});

/**
 * GET /api/roles/staff
 * College-wide staff list for Principal and Warden assignments (§7.3, §7.7)
 */
router.get('/staff', authMiddleware, requirePage('admin', 'view', { tab: 'roles' }), async (req, res) => {
  try {
    const targetRole = sanitizeToString(req.query.role);
    const requiredGender = sanitizeToString(req.query.gender);

    const match = { active: { $ne: false } };
    if (requiredGender) match.gender = requiredGender;

    const teachers = await M.Teacher.find(match)
      .select('fullName employeeNo designation department deptId gender pageRights specials')
      .sort({ fullName: 1 })
      .lean();

    const teacherIds = teachers.map(t => t._id);
    const activeAssignments = await M.RoleAssignment.find({
      teacherId: { $in: teacherIds },
      active: true
    }).lean();

    const staffWithRoles = teachers.map(t => {
      const tIdStr = String(t._id);
      const rolesHeld = activeAssignments
        .filter(a => String(a.teacherId) === tIdStr)
        .map(a => a.role);

      let isEligible = true;
      if (targetRole === 'warden' && rolesHeld.includes('warden')) {
        isEligible = false;
      }
      if (targetRole === 'principal' && t.pageRights?.accessRole === 'sudoAdmin') {
        isEligible = true; // Sudo can be Principal or faculty
      }

      return {
        _id: t._id,
        fullName: t.fullName,
        employeeNo: t.employeeNo,
        designation: t.designation,
        department: t.department,
        deptId: t.deptId,
        gender: t.gender,
        rolesHeld,
        isEligible
      };
    });

    res.json(staffWithRoles);
  } catch (err) {
    console.error('[GET /api/roles/staff error]:', err);
    res.status(500).json({ error: 'Failed to fetch staff', details: err.message });
  }
});

/**
 * GET /api/roles/institution
 * Returns institutional summary: Principal, Sudo Admins, Super Admins, Sub-Admins (§7.3)
 */
router.get('/institution', authMiddleware, requirePage('admin', 'view', { tab: 'roles' }), async (req, res) => {
  try {
    // 1. Current Principal
    const principalAssignment = await M.RoleAssignment.findOne({ role: 'principal', active: true }).lean();
    let principal = null;
    if (principalAssignment) {
      const teacher = await M.Teacher.findById(principalAssignment.teacherId).select('fullName email employeeNo department deptId').lean();
      principal = {
        teacherId: principalAssignment.teacherId,
        fullName: principalAssignment.teacherName || teacher?.fullName,
        trackId: principalAssignment.teacherTrackId,
        email: teacher?.email,
        employeeNo: teacher?.employeeNo,
        department: teacher?.department,
        deptId: teacher?.deptId,
        from: principalAssignment.from
      };
    }

    // 2. Sudo Admins
    const sudoAdmins = await M.Teacher.find({
      $or: [{ 'pageRights.accessRole': 'sudoAdmin' }, { isSudoAdmin: true }],
      active: { $ne: false }
    }).select('fullName employeeNo department email').lean();

    // 3. Super Admins
    const superAssignments = await M.RoleAssignment.find({ role: 'superAdmin', active: true }).lean();
    const superAdmins = superAssignments.map(sa => ({
      teacherId: sa.teacherId,
      name: sa.teacherName,
      trackId: sa.teacherTrackId,
      deptId: sa.deptId,
      from: sa.from
    }));

    // 4. Sub-Admins count
    const subAdminCount = await M.Teacher.countDocuments({
      'pageRights.grants.0': { $exists: true },
      active: { $ne: false }
    });

    res.json({
      ok: true,
      principal,
      sudoAdmins,
      superAdmins,
      subAdminCount
    });
  } catch (err) {
    console.error('[GET /api/roles/institution error]:', err);
    res.status(500).json({ error: 'Failed to fetch institutional roles overview', details: err.message });
  }
});

/**
 * PUT /api/roles/principal
 * Sudo only: appoints institutional Principal
 */
router.put('/principal', authMiddleware, requirePage('admin', 'assign', { tab: 'roles' }), async (req, res) => {
  try {
    if (!req.user.isSudoAdmin) {
      return res.status(403).json({ error: 'Only Sudo Admin can appoint Principal.', code: 'FORBIDDEN' });
    }

    const teacherId = sanitizeToObjectId(req.body.teacherId);
    if (!teacherId) return res.status(400).json({ error: 'Faculty member ID is required' });

    const expectedCurrentTeacherId = req.body.expectedCurrentTeacherId !== undefined
      ? (sanitizeToObjectId(req.body.expectedCurrentTeacherId) || null)
      : undefined;

    const assignment = await assignRole({
      role: 'principal',
      scopeId: null,
      teacherId,
      expectedCurrentTeacherId,
      actor: getActor(req),
      reason: sanitizeToString(req.body.reason)
    });

    res.json({
      ok: true,
      message: 'Principal appointed successfully.',
      assignment
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('[PUT /api/roles/principal error]:', err);
    res.status(500).json({ error: 'Failed to appoint Principal', details: err.message });
  }
});

/**
 * PUT /api/roles/super-admin/bulk-toggle
 * Sudo only: enables or disables bulk upload permission for a Super Admin (§6.4)
 */
router.put('/super-admin/bulk-toggle', authMiddleware, requirePage('admin', 'assign', { tab: 'roles' }), async (req, res) => {
  try {
    if (!req.user.isSudoAdmin) {
      return res.status(403).json({ error: 'Only Sudo Admin can configure bulk upload permissions for Super Admins.', code: 'FORBIDDEN' });
    }

    const teacherId = sanitizeToObjectId(req.body.teacherId);
    const enabled = Boolean(req.body.enabled);
    if (!teacherId) return res.status(400).json({ error: 'Teacher ID is required' });

    const teacher = await M.Teacher.findById(teacherId);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    let grants = teacher.pageRights?.grants || [];
    let bulkGrant = grants.find(g => g.page === 'bulk');
    if (bulkGrant) {
      bulkGrant.enabled = enabled;
    } else {
      grants.push({
        page: 'bulk',
        module: '-dept',
        scope: 'department',
        deptId: teacher.deptId,
        dept: teacher.department,
        actions: ['view', 'create'],
        enabled: enabled
      });
    }

    teacher.pageRights = {
      ...teacher.pageRights,
      version: (teacher.pageRights?.version || 0) + 1,
      grants
    };
    teacher.accessVersion = (teacher.accessVersion || 0) + 1;
    await teacher.save();

    await logAction(
      req.user.trackId,
      req.user.name,
      req.user.role,
      'Super Admin Bulk Permission Changed',
      `${enabled ? 'Enabled' : 'Disabled'} bulk upload permission for Super Admin ${teacher.fullName}`,
      'admin',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'role-assign', teacherId, bulkEnabled: enabled }
    );

    res.json({
      ok: true,
      message: `Bulk upload permissions ${enabled ? 'enabled' : 'disabled'} for ${teacher.fullName}.`,
      bulkEnabled: enabled
    });
  } catch (err) {
    console.error('[PUT /api/roles/super-admin/bulk-toggle error]:', err);
    res.status(500).json({ error: 'Failed to toggle bulk upload permissions', details: err.message });
  }
});

/**
 * GET /api/roles/history
 * Returns role history logs (§7.2, §11)
 */
router.get('/history', authMiddleware, requirePage('admin', 'view', { tab: 'roles' }), async (req, res) => {
  try {
    const query = {};
    if (!req.user.isSudoAdmin) {
      const userDeptId = req.access?.pages?.admin?.deptId || req.user.deptId;
      if (!userDeptId) return res.json([]);
      query.deptId = userDeptId;
    } else if (req.query.deptId) {
      const dId = sanitizeToObjectId(req.query.deptId);
      if (dId) query.deptId = dId;
    }

    if (req.query.role) query.role = sanitizeToString(req.query.role);

    const history = await M.RoleAssignment.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json(history);
  } catch (err) {
    console.error('[GET /api/roles/history error]:', err);
    res.status(500).json({ error: 'Failed to fetch role history', details: err.message });
  }
});

/**
 * GET /api/roles/grants
 * Returns privileged staff / sub-admin grants for a teacher or department (§7.5, §11)
 */
router.get('/grants', authMiddleware, requirePage('admin', 'view', { tab: 'roles' }), async (req, res) => {
  try {
    const teacherId = req.query.teacherId ? sanitizeToObjectId(req.query.teacherId) : null;
    const deptId = req.query.deptId ? sanitizeToObjectId(req.query.deptId) : null;

    let query = {};
    if (teacherId) {
      query._id = teacherId;
    } else if (deptId) {
      assertInScope(req, deptId);
      query.deptId = deptId;
      query['pageRights.grants.0'] = { $exists: true };
    } else if (!req.user.isSudoAdmin) {
      const userDeptId = req.access?.pages?.admin?.deptId || req.user.deptId;
      if (!userDeptId) return res.json([]);
      query.deptId = userDeptId;
      query['pageRights.grants.0'] = { $exists: true };
    } else {
      query['pageRights.grants.0'] = { $exists: true };
    }

    const teachers = await M.Teacher.find(query)
      .select('fullName employeeNo designation department deptId pageRights accessVersion')
      .lean();

    const result = teachers.map(t => ({
      teacherId: t._id,
      fullName: t.fullName,
      employeeNo: t.employeeNo,
      designation: t.designation,
      department: t.department,
      deptId: t.deptId,
      accessRole: t.pageRights?.accessRole || 'none',
      grants: t.pageRights?.grants || []
    }));

    res.json(result);
  } catch (err) {
    if (err.status === 403) return res.status(403).json({ error: err.message, code: err.code });
    console.error('[GET /api/roles/grants error]:', err);
    res.status(500).json({ error: 'Failed to fetch access grants', details: err.message });
  }
});

/**
 * POST /api/roles/grants
 * Add privileged staff / sub-admin grant (§7.2, §7.5, §11)
 */
router.post('/grants', authMiddleware, requirePage('admin', 'assign', { tab: 'roles' }), async (req, res) => {
  try {
    const { teacherId, page, module = '*', scope = 'department', actions = ['view'], tabActions, validFrom, validTo, reason } = req.body;
    const tId = sanitizeToObjectId(teacherId);
    if (!tId) return res.status(400).json({ error: 'Faculty member ID is required', code: 'TEACHER_REQUIRED' });
    if (!page) return res.status(400).json({ error: 'Page key is required', code: 'PAGE_REQUIRED' });

    const teacher = await M.Teacher.findById(tId);
    if (!teacher) return res.status(404).json({ error: 'Faculty member not found', code: 'TEACHER_NOT_FOUND' });

    // Validate Super Admin delegation rules (§7.2, §7.5)
    if (!req.user.isSudoAdmin) {
      const callerDeptId = req.access?.pages?.admin?.deptId || req.user.deptId;
      if (!callerDeptId || String(teacher.deptId) !== String(callerDeptId)) {
        return res.status(403).json({
          error: 'Super Admins can only grant privileges to faculty in their own department.',
          code: 'CROSS_DEPT_FORBIDDEN'
        });
      }
      if (scope !== 'department') {
        return res.status(403).json({
          error: 'Super Admins can only grant department-scoped access.',
          code: 'SCOPE_FORBIDDEN'
        });
      }
      if (!validTo) {
        return res.status(400).json({
          error: 'An expiration date (validTo) is required for Super Admin delegation (max 90 days).',
          code: 'VALID_TO_REQUIRED'
        });
      }
      const maxDays = 90;
      const validToDate = new Date(validTo);
      const now = Date.now();
      if (validToDate.getTime() - now > maxDays * 24 * 60 * 60 * 1000) {
        return res.status(400).json({
          error: `Delegation period exceeds maximum of ${maxDays} days.`,
          code: 'MAX_DELEGATION_EXCEEDED'
        });
      }
    }

    const grantDoc = {
      _id: new (require('mongoose').Types.ObjectId)(),
      page: sanitizeToString(page).toLowerCase(),
      module: sanitizeToString(module) || '*',
      scope: req.user.isSudoAdmin ? (['institution', 'department'].includes(scope) ? scope : 'department') : 'department',
      deptId: teacher.deptId || null,
      dept: teacher.department || '',
      actions: Array.isArray(actions) ? actions.map(a => sanitizeToString(a).toLowerCase()) : ['view'],
      tabActions: tabActions || null,
      enabled: true,
      validFrom: validFrom ? new Date(validFrom) : new Date(),
      validTo: validTo ? new Date(validTo) : null,
      source: req.user.isSudoAdmin ? 'sudo' : 'superAdmin',
      grantedBy: {
        trackId: req.user.trackId || String(req.user._id),
        name: req.user.fullName || req.user.name || req.user.username
      },
      grantedAt: new Date()
    };

    let pr = teacher.pageRights || { accessRole: 'none', version: 0, grants: [] };
    if (!Array.isArray(pr.grants)) pr.grants = [];

    pr.grants.push(grantDoc);
    if (pr.accessRole === 'none') {
      pr.accessRole = 'subAdmin';
    }
    pr.version = (pr.version || 0) + 1;

    teacher.pageRights = { ...pr };
    teacher.markModified('pageRights');
    teacher.accessVersion = (teacher.accessVersion || 0) + 1;
    await teacher.save();

    await logAction(
      req.user.trackId,
      req.user.name,
      req.user.role,
      'Privileged Staff Grant Added',
      `Granted ${grantDoc.page} (${grantDoc.actions.join(', ')}) to ${teacher.fullName}`,
      'admin',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'role-assign', teacherId: teacher._id, page: grantDoc.page, actions: grantDoc.actions }
    );

    res.status(201).json({
      ok: true,
      message: `Privileges granted to ${teacher.fullName}.`,
      grant: grantDoc
    });
  } catch (err) {
    console.error('[POST /api/roles/grants error]:', err);
    res.status(500).json({ error: 'Failed to grant privileges', details: err.message });
  }
});

/**
 * DELETE /api/roles/grants/:teacherId/:grantId
 * Revoke privileged staff / sub-admin grant (§7.5, §11)
 */
router.delete('/grants/:teacherId/:grantId', authMiddleware, requirePage('admin', 'assign', { tab: 'roles' }), async (req, res) => {
  try {
    const tId = sanitizeToObjectId(req.params.teacherId);
    const grantId = req.params.grantId;
    if (!tId || !grantId) return res.status(400).json({ error: 'Teacher ID and Grant ID are required' });

    const teacher = await M.Teacher.findById(tId);
    if (!teacher) return res.status(404).json({ error: 'Faculty member not found' });

    if (!req.user.isSudoAdmin) {
      const callerDeptId = req.access?.pages?.admin?.deptId || req.user.deptId;
      if (!callerDeptId || String(teacher.deptId) !== String(callerDeptId)) {
        return res.status(403).json({ error: 'Access denied: cannot modify faculty outside own department', code: 'FORBIDDEN' });
      }
    }

    let pr = teacher.pageRights || { accessRole: 'none', version: 0, grants: [] };
    const initialLen = (pr.grants || []).length;
    pr.grants = (pr.grants || []).filter(g => String(g._id) !== String(grantId));

    if (pr.grants.length === initialLen) {
      return res.status(404).json({ error: 'Grant not found on teacher record' });
    }

    const liveGrants = pr.grants.filter(g => g.enabled);
    if (liveGrants.length === 0 && pr.accessRole === 'subAdmin') {
      pr.accessRole = 'none';
    }
    pr.version = (pr.version || 0) + 1;

    teacher.pageRights = { ...pr };
    teacher.markModified('pageRights');
    teacher.accessVersion = (teacher.accessVersion || 0) + 1;
    await teacher.save();

    await logAction(
      req.user.trackId,
      req.user.name,
      req.user.role,
      'Privileged Staff Grant Revoked',
      `Revoked grant from ${teacher.fullName}`,
      'admin',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'role-remove', teacherId: teacher._id, grantId }
    );

    res.json({
      ok: true,
      message: `Grant revoked from ${teacher.fullName}.`
    });
  } catch (err) {
    console.error('[DELETE /api/roles/grants error]:', err);
    res.status(500).json({ error: 'Failed to revoke grant', details: err.message });
  }
});

/**
 * PATCH /api/roles/grants/:teacherId/:grantId
 * Extend or update an active sub-admin grant (§10, §11, R7.2)
 */
router.patch('/grants/:teacherId/:grantId', authMiddleware, requirePage('admin', 'assign', { tab: 'roles' }), async (req, res) => {
  try {
    const tId = sanitizeToObjectId(req.params.teacherId);
    const grantId = req.params.grantId;
    if (!tId || !grantId) return res.status(400).json({ error: 'Teacher ID and Grant ID are required' });

    const teacher = await M.Teacher.findById(tId);
    if (!teacher) return res.status(404).json({ error: 'Faculty member not found' });

    if (!req.user.isSudoAdmin) {
      const callerDeptId = req.access?.pages?.admin?.deptId || req.user.deptId;
      if (!callerDeptId || String(teacher.deptId) !== String(callerDeptId)) {
        return res.status(403).json({ error: 'Access denied: cannot modify faculty outside own department', code: 'FORBIDDEN' });
      }
    }

    let pr = teacher.pageRights || { accessRole: 'none', version: 0, grants: [] };
    const grant = (pr.grants || []).find(g => String(g._id) === String(grantId));
    if (!grant) {
      return res.status(404).json({ error: 'Grant not found on teacher record' });
    }

    const { validTo, actions, tabs, enabled, reason } = req.body;
    const oldSnapshot = { validTo: grant.validTo, actions: grant.actions, enabled: grant.enabled };

    if (validTo !== undefined) {
      const newValidTo = new Date(validTo);
      if (isNaN(newValidTo.getTime())) {
        return res.status(400).json({ error: 'Invalid validTo date format' });
      }
      if (!req.user.isSudoAdmin) {
        const fromTime = grant.validFrom ? new Date(grant.validFrom).getTime() : Date.now();
        const maxMs = 180 * 24 * 60 * 60 * 1000;
        if (newValidTo.getTime() - fromTime > maxMs) {
          return res.status(400).json({ error: 'Extension exceeds maximum allowed duration (180 days)', code: 'MAX_DURATION_EXCEEDED' });
        }
      }
      grant.validTo = newValidTo;
    }

    if (Array.isArray(actions)) {
      grant.actions = actions.map(a => sanitizeToString(a).toLowerCase());
    }
    if (Array.isArray(tabs)) {
      grant.tabs = tabs.map(t => sanitizeToString(t));
    }
    if (typeof enabled === 'boolean') {
      grant.enabled = enabled;
    }

    grant.lastModifiedBy = {
      trackId: req.user.trackId || String(req.user._id),
      name: req.user.fullName || req.user.name || req.user.username,
      at: new Date()
    };
    if (reason) {
      grant.lastReason = sanitizeToString(reason);
    }

    pr.version = (pr.version || 0) + 1;
    teacher.pageRights = { ...pr };
    teacher.markModified('pageRights');
    teacher.accessVersion = (teacher.accessVersion || 0) + 1;
    await teacher.save();

    await logAction(
      req.user.trackId,
      req.user.name,
      req.user.role,
      'Privileged Staff Grant Modified',
      `Modified grant for ${teacher.fullName} (page: ${grant.page}). Reason: ${reason || 'Update'}`,
      'admin',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'grant-update',
        teacherId: teacher._id,
        grantId,
        before: oldSnapshot,
        after: { validTo: grant.validTo, actions: grant.actions, enabled: grant.enabled }
      }
    );

    res.json({
      ok: true,
      message: `Grant for ${teacher.fullName} updated successfully.`,
      grant
    });
  } catch (err) {
    console.error('[PATCH /api/roles/grants error]:', err);
    res.status(500).json({ error: 'Failed to update grant', details: err.message });
  }
});

module.exports = router;
