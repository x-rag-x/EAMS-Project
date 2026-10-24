const mongoose = require('mongoose');
const M = require('../models');
const { logAction } = require('./logAction');

/**
 * Super Admin default template grants per §4.4
 */
function getSuperAdminGrants(deptId, deptName) {
  return [
    {
      page: 'admin',
      module: '-depts,-logs',
      scope: 'department',
      deptId: deptId ? new mongoose.Types.ObjectId(deptId) : null,
      dept: deptName || '',
      actions: ['view', 'create', 'edit', 'delete', 'assign'],
      tabActions: {
        students: ['view', 'create', 'edit', 'delete'],
        teachers: ['view', 'create', 'edit', 'delete'],
        roles: ['view', 'assign'],
        struct: ['view'],
        reports: ['view']
      },
      enabled: true
    },
    {
      page: 'manage',
      module: '-settings',
      scope: 'department',
      deptId: deptId ? new mongoose.Types.ObjectId(deptId) : null,
      dept: deptName || '',
      actions: ['view'],
      enabled: true
    },
    {
      page: 'export',
      module: '-history',
      scope: 'department',
      deptId: deptId ? new mongoose.Types.ObjectId(deptId) : null,
      dept: deptName || '',
      actions: ['view', 'export'],
      enabled: true
    },
    {
      page: 'bulk',
      module: '-dept',
      scope: 'department',
      deptId: deptId ? new mongoose.Types.ObjectId(deptId) : null,
      dept: deptName || '',
      actions: ['view', 'create'],
      enabled: false // disabled by default per §4.4
    }
  ];
}

/**
 * Derives slotKey and holderKey for unique single-holder enforcement
 */
function getRoleKeys(role, scopeId, teacherId) {
  let slotKey = undefined;
  let holderKey = undefined;

  switch (role) {
    case 'principal':
      slotKey = 'principal:institution';
      holderKey = `principal:${teacherId}`;
      break;
    case 'hod':
      slotKey = `hod:${scopeId}`;
      holderKey = `hod:${teacherId}`;
      break;
    case 'superAdmin':
      slotKey = `superAdmin:${scopeId}`;
      holderKey = `superAdmin:${teacherId}`;
      break;
    case 'ttCoordinator':
      slotKey = `ttCoordinator:${scopeId}`;
      break;
    case 'placementCoordinator':
      slotKey = `placementCoordinator:${scopeId}`;
      break;
    case 'classAdvisor':
      slotKey = `classAdvisor:${scopeId}`;
      break;
    case 'warden':
      slotKey = `warden:${scopeId}`;
      holderKey = `warden:${teacherId}`;
      break;
    case 'sudoAdmin':
      holderKey = `sudoAdmin:${teacherId}`;
      break;
  }

  return { slotKey, holderKey };
}

/**
 * Reverts projections when a role assignment is ended
 */
async function revertProjections(assignment, session) {
  const { role, scopeId, deptId, teacherId, teacherTrackId } = assignment;
  const tId = teacherId;

  const teacher = await M.Teacher.findById(tId).session(session || null);
  if (!teacher) return;

  const currentSpecials = Array.isArray(teacher.specials) ? teacher.specials : [];
  let updatedSpecials = [...currentSpecials];

  switch (role) {
    case 'principal':
      updatedSpecials = updatedSpecials.filter(s => s.option !== 'isPrincipal');
      break;

    case 'hod':
      updatedSpecials = updatedSpecials.filter(s => s.option !== 'isHod' && s.option !== 'HodDeptTrackId');
      if (deptId || scopeId) {
        await M.Department.updateOne(
          { _id: deptId || scopeId, hodId: tId },
          { $set: { hodId: null, hodName: '' } }
        ).session(session || null);
      }
      break;

    case 'superAdmin': {
      // Check if user still holds sudoAdmin or other admin rights
      const isSudo = teacher.pageRights?.accessRole === 'sudoAdmin' ||
                     (teacher.pageRights?.grants || []).some(g => g.scope === 'institution' && g.accessRole === 'sudoAdmin');
      if (!isSudo) {
        updatedSpecials = updatedSpecials.filter(s => s.option !== 'isAdmin');
        teacher.pageRights = {
          accessRole: 'none',
          version: (teacher.pageRights?.version || 0) + 1,
          grants: []
        };
      }
      break;
    }

    case 'ttCoordinator':
      updatedSpecials = updatedSpecials.filter(s => s.option !== 'isTimeTableCoordinator' && s.option !== 'TTDeptTrackId');
      break;

    case 'placementCoordinator':
      updatedSpecials = updatedSpecials.filter(s => s.option !== 'isPlacementCoordinator');
      break;

    case 'classAdvisor':
      updatedSpecials = updatedSpecials.filter(s => s.option !== 'isClassAdvisor' && s.option !== 'ClassAdvisorTrackId');
      if (scopeId) {
        await M.Class.updateOne(
          { _id: scopeId, advisorTeacherId: tId },
          { $set: { advisorTeacherId: null, advisorTeacherName: '', advisorTrackId: '' } }
        ).session(session || null);
      }
      break;

    case 'warden':
      updatedSpecials = updatedSpecials.filter(s => s.option !== 'isWarden');
      if (scopeId) {
        await M.Block.updateOne(
          { _id: scopeId, wardenTrackId: teacherTrackId },
          { $set: { wardenTrackId: null } }
        ).session(session || null);
      }
      break;
  }

  teacher.specials = updatedSpecials;
  teacher.accessVersion = (teacher.accessVersion || 0) + 1;
  await teacher.save({ session: session || null });
}

/**
 * Applies projections when a role assignment is created
 */
async function applyProjections(assignment, scopeDoc, session) {
  const { role, scopeId, deptId, teacherId, teacherTrackId } = assignment;
  const teacher = await M.Teacher.findById(teacherId).session(session || null);
  if (!teacher) throw new Error('Target faculty member not found');

  const currentSpecials = Array.isArray(teacher.specials) ? teacher.specials : [];
  let updatedSpecials = [...currentSpecials];

  switch (role) {
    case 'principal':
      if (!updatedSpecials.some(s => s.option === 'isPrincipal')) {
        updatedSpecials.push({ option: 'isPrincipal', value: true, key: '' });
      }
      break;

    case 'hod': {
      const dDoc = scopeDoc || (deptId ? await M.Department.findById(deptId).session(session || null) : null);
      updatedSpecials = updatedSpecials.filter(s => s.option !== 'isHod' && s.option !== 'HodDeptTrackId');
      updatedSpecials.push({ option: 'isHod', value: true, key: '' });
      if (dDoc && dDoc.trackId) {
        updatedSpecials.push({ option: 'HodDeptTrackId', value: dDoc.trackId, key: '' });
      }
      if (dDoc) {
        await M.Department.updateOne(
          { _id: dDoc._id },
          { $set: { hodId: teacher._id, hodName: teacher.fullName } }
        ).session(session || null);
      }
      break;
    }

    case 'superAdmin': {
      const dDoc = scopeDoc || (deptId ? await M.Department.findById(deptId).session(session || null) : null);
      if (!updatedSpecials.some(s => s.option === 'isAdmin')) {
        updatedSpecials.push({ option: 'isAdmin', value: true, key: '' });
      }
      if (teacher.username !== 'admin' && teacher.trackId !== 'TR-ADMIN001') {
        const newGrants = getSuperAdminGrants(dDoc?._id || deptId, dDoc?.name || teacher.department);
        teacher.pageRights = {
          accessRole: 'superAdmin',
          version: (teacher.pageRights?.version || 0) + 1,
          grants: newGrants
        };
      }
      break;
    }

    case 'ttCoordinator': {
      const dDoc = scopeDoc || (deptId ? await M.Department.findById(deptId).session(session || null) : null);
      const dName = dDoc?.name || teacher.department || '';
      updatedSpecials = updatedSpecials.filter(s => s.option !== 'isTimeTableCoordinator');
      updatedSpecials.push({ option: 'isTimeTableCoordinator', value: dName, key: dName });
      break;
    }

    case 'placementCoordinator': {
      const dDoc = scopeDoc || (deptId ? await M.Department.findById(deptId).session(session || null) : null);
      const dName = dDoc?.name || teacher.department || '';
      updatedSpecials = updatedSpecials.filter(s => s.option !== 'isPlacementCoordinator');
      updatedSpecials.push({ option: 'isPlacementCoordinator', value: dName, key: dName });
      break;
    }

    case 'classAdvisor': {
      const cDoc = scopeDoc || (scopeId ? await M.Class.findById(scopeId).session(session || null) : null);
      updatedSpecials = updatedSpecials.filter(s => s.option !== 'isClassAdvisor' && s.option !== 'ClassAdvisorTrackId');
      updatedSpecials.push({ option: 'isClassAdvisor', value: true, key: '' });
      if (cDoc && cDoc.trackId) {
        updatedSpecials.push({ option: 'ClassAdvisorTrackId', value: cDoc.trackId, key: '' });
      }
      if (cDoc) {
        await M.Class.updateOne(
          { _id: cDoc._id },
          {
            $set: {
              advisorTeacherId: teacher._id,
              advisorTeacherName: teacher.fullName,
              advisorTrackId: teacher.trackId
            }
          }
        ).session(session || null);
      }
      break;
    }

    case 'warden': {
      const bDoc = scopeDoc || (scopeId ? await M.Block.findById(scopeId).session(session || null) : null);
      updatedSpecials = updatedSpecials.filter(s => s.option !== 'isWarden');
      updatedSpecials.push({ option: 'isWarden', value: bDoc?.code || 'WARDEN', key: bDoc?.code || '' });
      if (bDoc) {
        await M.Block.updateOne(
          { _id: bDoc._id },
          { $set: { wardenTrackId: teacher.trackId } }
        ).session(session || null);
      }
      break;
    }
  }

  teacher.specials = updatedSpecials;
  teacher.accessVersion = (teacher.accessVersion || 0) + 1;
  await teacher.save({ session: session || null });
}

/**
 * Assigns or replaces an executive role (§4.5, §7.8)
 */
async function assignRole({
  role,
  scopeId,
  teacherId,
  expectedCurrentTeacherId,
  actor,
  reason = ''
}) {
  const allowedRoles = [
    'principal',
    'hod',
    'superAdmin',
    'ttCoordinator',
    'placementCoordinator',
    'classAdvisor',
    'warden',
    'sudoAdmin'
  ];

  if (!allowedRoles.includes(role)) {
    const err = new Error(`Invalid role "${role}".`);
    err.status = 400;
    err.code = 'INVALID_ROLE';
    throw err;
  }

  // 1. Fetch and validate target teacher
  const teacher = await M.Teacher.findById(teacherId);
  if (!teacher) {
    const err = new Error('Target faculty member not found.');
    err.status = 404;
    err.code = 'TEACHER_NOT_FOUND';
    throw err;
  }

  // 2. Validate scope and cross-department rules
  let resolvedDeptId = null;
  let scopeType = 'institution';
  let scopeDoc = null;

  if (['hod', 'superAdmin', 'ttCoordinator', 'placementCoordinator'].includes(role)) {
    scopeType = 'department';
    scopeDoc = await M.Department.findById(scopeId);
    if (!scopeDoc) {
      const err = new Error('Target department not found.');
      err.status = 404;
      err.code = 'DEPARTMENT_NOT_FOUND';
      throw err;
    }
    resolvedDeptId = scopeDoc._id;

    // Cross-department check (§7.8 rule 2)
    const teacherDeptId = teacher.deptId ? String(teacher.deptId) : null;
    const teacherDeptName = (teacher.department || '').trim().toLowerCase();
    const targetDeptId = String(scopeDoc._id);
    const targetDeptName = (scopeDoc.name || '').trim().toLowerCase();

    if (teacherDeptId && teacherDeptId !== targetDeptId && teacherDeptName !== targetDeptName) {
      const err = new Error(`Faculty ${teacher.fullName} does not belong to ${scopeDoc.name}. Cross-department assignments are not permitted.`);
      err.status = 400;
      err.code = 'CROSS_DEPT';
      throw err;
    }

    // Sudo Admins cannot be made Super Admin (§7.8 rule 6)
    if (role === 'superAdmin') {
      const isSudo = teacher.pageRights?.accessRole === 'sudoAdmin' ||
        (teacher.pageRights?.grants || []).some(g => g.scope === 'institution' && g.accessRole === 'sudoAdmin');
      if (isSudo) {
        const err = new Error('Sudo Admins hold institution-wide access and cannot be assigned as Super Admin.');
        err.status = 400;
        err.code = 'SUDO_CANNOT_BE_SUPER';
        throw err;
      }
    }
  } else if (role === 'classAdvisor') {
    scopeType = 'class';
    scopeDoc = await M.Class.findById(scopeId);
    if (!scopeDoc) {
      const err = new Error('Target class not found.');
      err.status = 404;
      err.code = 'CLASS_NOT_FOUND';
      throw err;
    }
    resolvedDeptId = scopeDoc.deptId;

    const teacherDeptId = teacher.deptId ? String(teacher.deptId) : null;
    const classDeptId = scopeDoc.deptId ? String(scopeDoc.deptId) : null;
    if (teacherDeptId && classDeptId && teacherDeptId !== classDeptId) {
      const err = new Error(`Faculty ${teacher.fullName} belongs to a different department than the class.`);
      err.status = 400;
      err.code = 'CROSS_DEPT';
      throw err;
    }
  } else if (role === 'warden') {
    scopeType = 'block';
    scopeDoc = await M.Block.findById(scopeId).populate('hostelId');
    if (!scopeDoc) {
      const err = new Error('Target hostel block not found.');
      err.status = 404;
      err.code = 'BLOCK_NOT_FOUND';
      throw err;
    }

    // Girls block warden gender requirement (§7.7, §7.8)
    const hostelGender = scopeDoc.hostelId?.gender || '';
    if (hostelGender === 'girls') {
      const teacherGender = (teacher.gender || '').toLowerCase();
      if (teacherGender !== 'female') {
        const err = new Error('Girls hostel block wardens must be female faculty members.');
        err.status = 400;
        err.code = 'FEMALE_WARDEN_REQUIRED';
        throw err;
      }
    }
  }

  // 3. Concurrency / Stale validation (§7.8 rule 4)
  const { slotKey, holderKey } = getRoleKeys(role, scopeId, teacher._id);
  const currentAssignment = slotKey ? await M.RoleAssignment.findOne({ slotKey, active: true }) : null;

  if (expectedCurrentTeacherId !== undefined) {
    if (currentAssignment) {
      if (String(currentAssignment.teacherId) !== String(expectedCurrentTeacherId)) {
        const err = new Error(`Slot was recently updated by ${currentAssignment.assignedBy?.name || 'another administrator'}.`);
        err.status = 409;
        err.code = 'STALE';
        err.currentAssignment = currentAssignment;
        throw err;
      }
    } else {
      if (expectedCurrentTeacherId !== null && expectedCurrentTeacherId !== '') {
        const err = new Error('Slot was already cleared by another administrator.');
        err.status = 409;
        err.code = 'STALE';
        throw err;
      }
    }
  }

  // 4. Execution inside transaction (with standalone fallback)
  let dbSession = null;
  try {
    dbSession = await mongoose.startSession();
    dbSession.startTransaction();
  } catch (sessErr) {
    dbSession = null; // Standalone MongoDB without replica set
  }

  try {
    let replacedHolder = null;

    // End current occupant if exists
    if (currentAssignment) {
      replacedHolder = currentAssignment.teacherName;
      currentAssignment.active = false;
      currentAssignment.to = new Date();
      currentAssignment.endedBy = { trackId: actor.trackId, name: actor.name };
      currentAssignment.endReason = reason || 'Replaced';
      currentAssignment.replacedBy = teacher._id;
      currentAssignment.slotKey = undefined;
      currentAssignment.holderKey = undefined;
      await currentAssignment.save({ session: dbSession || undefined });

      await revertProjections(currentAssignment, dbSession);
    }

    // Also end any active assignment if target teacher is taking a unique holder role elsewhere
    if (holderKey) {
      const existingHolderAssign = await M.RoleAssignment.findOne({ holderKey, active: true }).session(dbSession || null);
      if (existingHolderAssign && String(existingHolderAssign._id) !== String(currentAssignment?._id)) {
        existingHolderAssign.active = false;
        existingHolderAssign.to = new Date();
        existingHolderAssign.endedBy = { trackId: actor.trackId, name: actor.name };
        existingHolderAssign.endReason = `Transferred to new slot`;
        existingHolderAssign.slotKey = undefined;
        existingHolderAssign.holderKey = undefined;
        await existingHolderAssign.save({ session: dbSession || undefined });
        await revertProjections(existingHolderAssign, dbSession);
      }
    }

    // Create new RoleAssignment
    const newAssignment = new M.RoleAssignment({
      role,
      scopeType,
      scopeId: scopeId || null,
      deptId: resolvedDeptId,
      teacherId: teacher._id,
      teacherTrackId: teacher.trackId,
      teacherName: teacher.fullName,
      active: true,
      from: new Date(),
      slotKey,
      holderKey,
      assignedBy: { trackId: actor.trackId, name: actor.name }
    });
    await newAssignment.save({ session: dbSession || undefined });

    // Apply projections
    await applyProjections(newAssignment, scopeDoc, dbSession);

    if (dbSession) {
      await dbSession.commitTransaction();
    }

    // In-app notifications & logging (non-blocking)
    setImmediate(async () => {
      try {
        // Notification for gaining role
        await M.Notification.create({
          type: 'info',
          from: actor.name || 'System Administrator',
          fromRole: 'Administrator',
          toTeacherId: teacher._id,
          toTeacherTrackId: teacher.trackId,
          toTeacherName: teacher.fullName,
          message: `You have been appointed as ${role} for ${scopeDoc?.name || 'the institution'}.`,
          priority: 'Normal',
          status: 'Delivered',
          time: new Date()
        });

        // Notification for former holder
        if (currentAssignment && String(currentAssignment.teacherId) !== String(teacher._id)) {
          await M.Notification.create({
            type: 'info',
            from: actor.name || 'System Administrator',
            fromRole: 'Administrator',
            toTeacherId: currentAssignment.teacherId,
            toTeacherTrackId: currentAssignment.teacherTrackId,
            toTeacherName: currentAssignment.teacherName,
            message: `Your appointment as ${role} for ${scopeDoc?.name || 'the institution'} has concluded.`,
            priority: 'Normal',
            status: 'Delivered',
            time: new Date()
          });
        }

        // Audit log
        await logAction(
          actor.trackId,
          actor.name,
          actor.role || 'teacher',
          'Role Assigned',
          `Assigned ${role} to ${teacher.fullName} (${teacher.employeeNo || teacher.trackId})` +
            (replacedHolder ? `, replacing ${replacedHolder}` : ''),
          'admin',
          'info',
          actor.ip,
          actor.sessionId,
          {
            module: 'admin',
            subType: 'role-assign',
            role,
            teacherId: teacher._id,
            scopeId,
            reason
          }
        );
      } catch (postErr) {
        console.error('[roleAssign post-assign error]:', postErr);
      }
    });

    return newAssignment;
  } catch (err) {
    if (dbSession) {
      await dbSession.abortTransaction();
    }
    throw err;
  } finally {
    if (dbSession) {
      dbSession.endSession();
    }
  }
}

/**
 * Ends an active executive role (§4.5, §7.8)
 */
async function endRole({
  role,
  scopeId,
  teacherId,
  actor,
  reason = 'Concluded'
}) {
  // Last active Sudo Admin cannot be demoted (§7.8 rule 7)
  if (role === 'sudoAdmin') {
    const sudoCount = await M.RoleAssignment.countDocuments({ role: 'sudoAdmin', active: true });
    if (sudoCount <= 1) {
      const err = new Error('The last active Sudo Admin cannot be removed.');
      err.status = 400;
      err.code = 'LAST_SUDO_ADMIN';
      throw err;
    }
  }

  const query = { role, active: true };
  if (scopeId) query.scopeId = scopeId;
  if (teacherId) query.teacherId = teacherId;

  const assignment = await M.RoleAssignment.findOne(query);
  if (!assignment) {
    const err = new Error('No active assignment found for this role and scope.');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  let dbSession = null;
  try {
    dbSession = await mongoose.startSession();
    dbSession.startTransaction();
  } catch (e) {
    dbSession = null;
  }

  try {
    assignment.active = false;
    assignment.to = new Date();
    assignment.endedBy = { trackId: actor.trackId, name: actor.name };
    assignment.endReason = reason;
    assignment.slotKey = undefined;
    assignment.holderKey = undefined;
    await assignment.save({ session: dbSession || undefined });

    await revertProjections(assignment, dbSession);

    if (dbSession) {
      await dbSession.commitTransaction();
    }

    setImmediate(async () => {
      try {
        await M.Notification.create({
          type: 'info',
          from: actor.name || 'System Administrator',
          fromRole: 'Administrator',
          toTeacherId: assignment.teacherId,
          toTeacherTrackId: assignment.teacherTrackId,
          toTeacherName: assignment.teacherName,
          message: `Your assignment as ${role} has concluded.`,
          priority: 'Normal',
          status: 'Delivered',
          time: new Date()
        });

        await logAction(
          actor.trackId,
          actor.name,
          actor.role || 'teacher',
          'Role Removed',
          `Removed ${role} assignment for ${assignment.teacherName}. Reason: ${reason}`,
          'admin',
          'info',
          actor.ip,
          actor.sessionId,
          {
            module: 'admin',
            subType: 'role-remove',
            role,
            teacherId: assignment.teacherId,
            scopeId,
            reason
          }
        );
      } catch (postErr) {
        console.error('[roleAssign post-end error]:', postErr);
      }
    });

    return assignment;
  } catch (err) {
    if (dbSession) {
      await dbSession.abortTransaction();
    }
    throw err;
  } finally {
    if (dbSession) {
      dbSession.endSession();
    }
  }
}

module.exports = {
  assignRole,
  endRole,
  getSuperAdminGrants,
  getRoleKeys,
  applyProjections,
  revertProjections
};
