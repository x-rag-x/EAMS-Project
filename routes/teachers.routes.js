const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('@node-rs/bcrypt');
const M = require('../models');
const cfg = require('../config');
const { authMiddleware, requirePage, scopeFilter, assertInScope, isSudo } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { isSudoAdmin, isSuperAdmin, isSubAdmin, sanitizeTeacherPrivileges, hasSpecial } = require('../utils/access');
const { assertNotLastSudoAdmin } = require('../utils/adminGuards');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { sanitizeFullName, splitFirstLastName } = require('../utils/nameFormat');

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
    const activeAssignments = await M.RoleAssignment.find({
      teacherId: teacher._id,
      active: true
    }).select('role').lean();
    const tRoles = activeAssignments.map(a => a.role);
    const isHodVal = teacher.specials?.some(s => s.option === 'isHod') || tRoles.includes('hod');
    const isClassAdvisorVal = teacher.specials?.some(s => s.option === 'isClassAdvisor') || tRoles.includes('classAdvisor');
    const isTTCoordVal = teacher.specials?.some(s => s.option === 'isTimeTableCoordinator') || tRoles.includes('ttCoordinator');
    const isPrincipalVal = hasSpecial(teacher, 'isPrincipal') || tRoles.includes('principal');

    let adminTier = null;
    let isSudoAdminVal = false;
    let isSuperAdminVal = false;
    let isSubAdminVal = false;

    const hasSudoRole = tRoles.includes('sudoAdmin') || teacher.pageRights?.accessRole === 'sudoAdmin' || teacher.role === 'sudo' || isSudoAdmin(teacher);
    const hasSuperRole = tRoles.includes('superAdmin') || teacher.pageRights?.accessRole === 'superAdmin' || isSuperAdmin(teacher);
    const hasSubRole = tRoles.includes('subAdmin') || teacher.pageRights?.accessRole === 'subAdmin' || isSubAdmin(teacher);

    if (hasSudoRole) {
      isSudoAdminVal = true;
      adminTier = 'sudo';
    } else if (hasSuperRole) {
      isSuperAdminVal = true;
      adminTier = 'super';
    } else if (hasSubRole) {
      isSubAdminVal = true;
      adminTier = 'sub';
    } else if (hasSpecial(teacher, 'isAdmin') || teacher.isAdmin) {
      if (teacher.username === 'admin' || !teacher.deptId || teacher.designation?.toLowerCase().includes('system admin')) {
        isSudoAdminVal = true;
        adminTier = 'sudo';
      } else {
        isSudoAdminVal = true;
        adminTier = 'sudo';
      }
    }

    const cleanFullName = sanitizeFullName(teacher.fullName || teacher.name || '');
    const nameSplit = splitFirstLastName(cleanFullName);

    res.json({
      _id: teacher._id,
      name: cleanFullName,
      fullName: cleanFullName,
      firstName: teacher.firstName ? sanitizeFullName(teacher.firstName) : nameSplit.firstName,
      lastName: (teacher.lastName !== undefined && teacher.lastName !== null && String(teacher.lastName).trim() !== '')
        ? sanitizeFullName(teacher.lastName)
        : nameSplit.lastName,
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
      isPrincipal: isPrincipalVal,
      specials: teacher.specials || [],
      isAdmin: hasSpecial(teacher, 'isAdmin') || isSudoAdminVal || isSuperAdminVal || isSubAdminVal,
      isSudoAdmin: isSudoAdminVal,
      isSuperAdmin: isSuperAdminVal,
      isSubAdmin: isSubAdminVal,
      adminTier: adminTier,
      pageRights: teacher.pageRights,
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

    // ── R2.4 / A5 Scope Enforcement ──
    const isStudent = req.user.role === 'student';
    const isCallerSudo = isSudo(req);
    const hasAdminScope = req.access && (req.access.flags?.isSuper || req.access.pages?.admin || req.access.flags?.isHod);

    const andClauses = [];

    // Resolve caller department id and name
    let userDeptId = req.access?.pages?.admin?.deptId || req.user.deptId || null;
    let userDeptName = req.access?.pages?.admin?.dept || req.user.department || req.user.deptName || '';

    if (!isCallerSudo && hasAdminScope) {
      if (!userDeptId && userDeptName) {
        const deptDoc = await M.Department.findOne({
          $or: [
            { name: userDeptName },
            { code: userDeptName }
          ]
        }).select('_id name').lean();
        if (deptDoc) {
          userDeptId = String(deptDoc._id);
          userDeptName = deptDoc.name;
        }
      } else if (userDeptId && !userDeptName) {
        const deptDoc = await M.Department.findById(userDeptId).select('_id name').lean();
        if (deptDoc) {
          userDeptName = deptDoc.name;
        }
      }
    }

    if (isStudent) {
      // Students only see teachers of classes they are enrolled in
      const studentDoc = await M.Student.findOne({
        $or: [{ _id: req.user._id }, { trackId: req.user.trackId }]
      }).select('classId').lean();
      let enrolledTeacherIds = [];
      if (studentDoc && studentDoc.classId) {
        const cls = await M.Class.findById(studentDoc.classId).lean();
        if (cls) {
          if (cls.advisorTeacherId) enrolledTeacherIds.push(cls.advisorTeacherId);
          if (Array.isArray(cls.subjectTeachers)) {
            cls.subjectTeachers.forEach(st => { if (st.teacherId) enrolledTeacherIds.push(st.teacherId); });
          }
        }
      }
      andClauses.push({ _id: { $in: enrolledTeacherIds } });
    } else if (!isCallerSudo && hasAdminScope) {
      if (req.query.deptId) {
        const qDeptId = sanitizeToString(req.query.deptId);
        const isMatch = (userDeptId && String(qDeptId) === String(userDeptId)) ||
                        (userDeptName && qDeptId.toLowerCase() === userDeptName.toLowerCase());
        if ((userDeptId || userDeptName) && !isMatch) {
          return res.status(403).json({ error: 'Access denied: cannot query teachers outside assigned department' });
        }
      }

      const deptMatchOr = [];
      if (userDeptId) {
        deptMatchOr.push({ deptId: userDeptId });
        if (mongoose.Types.ObjectId.isValid(userDeptId)) {
          deptMatchOr.push({ deptId: new mongoose.Types.ObjectId(userDeptId) });
        }
      }
      if (userDeptName) {
        const escapedDept = userDeptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        deptMatchOr.push({ department: { $regex: new RegExp(`^${escapedDept}$`, 'i') } });
      }
      if (deptMatchOr.length > 0) {
        andClauses.push({ $or: deptMatchOr });
      }
    } else if (!isCallerSudo) {
      if (req.query.deptId) {
        const qDeptId = sanitizeToString(req.query.deptId);
        const regDeptOr = [{ deptId: qDeptId }];
        if (mongoose.Types.ObjectId.isValid(qDeptId)) {
          regDeptOr.push({ deptId: new mongoose.Types.ObjectId(qDeptId) });
        }
        andClauses.push({ $or: regDeptOr });
      }
    } else {
      // Sudo Admin
      if (req.query.deptId) {
        const qDeptId = sanitizeToString(req.query.deptId);
        const sudoDeptOr = [{ deptId: qDeptId }];
        if (mongoose.Types.ObjectId.isValid(qDeptId)) {
          sudoDeptOr.push({ deptId: new mongoose.Types.ObjectId(qDeptId) });
        }
        andClauses.push({ $or: sudoDeptOr });
      }
    }

    if (req.query.dept) {
      const qDept = sanitizeToString(req.query.dept);
      const escapedQDept = qDept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      andClauses.push({ department: { $regex: new RegExp(`^${escapedQDept}$`, 'i') } });
    }
    if (req.query.q) {
      const q = sanitizeToString(req.query.q);
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');  // LOOP-07: prevent ReDoS
      andClauses.push({
        $or: [
          { fullName: { $regex: escaped, $options: 'i' } },
          { employeeNo: { $regex: escaped, $options: 'i' } },
          { email: { $regex: escaped, $options: 'i' } },
          { username: { $regex: escaped, $options: 'i' } },
        ]
      });
    }

    if (andClauses.length === 1) {
      Object.assign(teacherFilter, andClauses[0]);
    } else if (andClauses.length > 1) {
      teacherFilter.$and = andClauses;
    }
    
    const teachers = await M.Teacher.find(teacherFilter, '-password').sort({ fullName: 1 }).lean();
    const callerDeptId = (userDeptId ? String(userDeptId) : '') || (req.user.deptId ? String(req.user.deptId) : '');
    const callerDeptName = userDeptName || req.user.department || req.user.deptName || '';
    const teacherIds = teachers.map(t => t._id);
    const activeAssignments = await M.RoleAssignment.find({
      teacherId: { $in: teacherIds },
      active: true
    }).select('teacherId role').lean();

    const mapped = teachers.map(t => {
      const isSameDept = isCallerSudo ||
        (callerDeptId && String(t.deptId) === callerDeptId) ||
        (callerDeptName && t.department && String(t.department).toLowerCase().trim() === callerDeptName.toLowerCase().trim());
      const tRoles = activeAssignments.filter(a => String(a.teacherId) === String(t._id)).map(a => a.role);
      const isHodVal = t.specials?.some(s => s.option === 'isHod') || tRoles.includes('hod');
      const isClassAdvisorVal = t.specials?.some(s => s.option === 'isClassAdvisor') || tRoles.includes('classAdvisor');
      const isTTCoordVal = t.specials?.some(s => s.option === 'isTimeTableCoordinator') || tRoles.includes('ttCoordinator');
      const isPrincipalVal = hasSpecial(t, 'isPrincipal') || tRoles.includes('principal');

      let adminTier = null;
      let isSudoAdminVal = false;
      let isSuperAdminVal = false;
      let isSubAdminVal = false;

      const hasSudoRole = tRoles.includes('sudoAdmin') || t.pageRights?.accessRole === 'sudoAdmin' || t.role === 'sudo' || isSudoAdmin(t);
      const hasSuperRole = tRoles.includes('superAdmin') || t.pageRights?.accessRole === 'superAdmin' || isSuperAdmin(t);
      const hasSubRole = tRoles.includes('subAdmin') || t.pageRights?.accessRole === 'subAdmin' || isSubAdmin(t);

      if (hasSudoRole) {
        isSudoAdminVal = true;
        adminTier = 'sudo';
      } else if (hasSuperRole) {
        isSuperAdminVal = true;
        adminTier = 'super';
      } else if (hasSubRole) {
        isSubAdminVal = true;
        adminTier = 'sub';
      } else if (hasSpecial(t, 'isAdmin') || t.isAdmin) {
        if (t.username === 'admin' || !t.deptId || t.designation?.toLowerCase().includes('system admin')) {
          isSudoAdminVal = true;
          adminTier = 'sudo';
        } else {
          isSudoAdminVal = true;
          adminTier = 'sudo';
        }
      }

      if (isStudent) {
        return {
          _id: t._id,
          name: t.fullName,
          fullName: t.fullName,
          dept: t.department,
          department: t.department,
          desig: t.designation,
          designation: t.designation
        };
      }

      return {
        _id: t._id,
        name: t.fullName,
        fullName: t.fullName,
        empId: isSameDept ? t.employeeNo : '',
        employeeNo: isSameDept ? t.employeeNo : '',
        dept: t.department,
        department: t.department,
        deptId: t.deptId,
        deptCode: t.deptCode,
        desig: t.designation,
        designation: t.designation,
        email: isSameDept ? t.email : '',
        username: isSameDept ? t.username : '',
        trackId: t.trackId,
        isHOD: isHodVal,
        isClassAdvisor: isClassAdvisorVal,
        isTimeTableCoordinator: isTTCoordVal,
        isPrincipal: isPrincipalVal,
        specials: isSameDept ? (t.specials || []) : [],
        isAdmin: hasSpecial(t, 'isAdmin') || isSudoAdminVal || isSuperAdminVal || isSubAdminVal,
        isSudoAdmin: isSudoAdminVal,
        isSuperAdmin: isSuperAdminVal,
        isSubAdmin: isSubAdminVal,
        adminTier: adminTier,
        pageRights: isSameDept ? t.pageRights : undefined,
        active: true,
        status: 'active',
        mustChangePassword: t.mustChangePassword,
      };
    });
    res.json(mapped);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authMiddleware, requirePage('admin', 'create', { tab: 'teachers' }), async (req, res) => {
  try {
    if (req.scope && req.scope.type === 'department' && req.scope.deptId) {
      if (req.body.deptId && String(req.body.deptId) !== String(req.scope.deptId)) {
        return res.status(403).json({ error: 'Access denied: cannot create teacher for another department' });
      }
      req.body.deptId = req.scope.deptId;
      if (!req.body.department && req.scope.deptName) {
        req.body.department = req.scope.deptName;
      }
    }
    const { fullName, firstName, lastName, employeeNo, department, deptId, deptCode, designation, username, password, email, gender, specials } = req.body;

    if (!fullName || !username || !password) {
      return res.status(400).json({
        error: 'fullName, username, password required'
      });
    }
    const cleanFullName = sanitizeFullName(fullName);
    const splitNames = splitFirstLastName(cleanFullName);
    const finalFirstName = (firstName ? sanitizeFullName(firstName) : splitNames.firstName) || '';
    const finalLastName = (lastName !== undefined && lastName !== null && String(lastName).trim() !== '') ? sanitizeFullName(lastName) : splitNames.lastName;

    const hash = await bcrypt.hash(password, cfg.BCRYPT_ROUNDS);
    const normalizedUsername = String(username).replace(/\s+/g, '').toLowerCase();
    const RESERVED_USERNAMES = ['admin', 'administrator', 'system', 'root', 'sudo', 'superuser'];
    if (RESERVED_USERNAMES.includes(normalizedUsername)) {
      return res.status(400).json({ error: `Username '${normalizedUsername}' is reserved by the system.` });
    }
    if (normalizedUsername.startsWith('sb-') || normalizedUsername.startsWith('tr-')) {
      return res.status(400).json({ error: "Username prefixes 'SB-' and 'TR-' are reserved for smart board device IDs" });
    }

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

    let initialSpecials = specials || [];
    let initialPageRights = req.body.pageRights || [];

    const sanitized = sanitizeTeacherPrivileges(req.user, null, initialSpecials, initialPageRights);
    const finalSpecials = sanitized.specials;
    const finalPageRights = sanitized.pageRights;

    const isPrincipalAssigned = finalSpecials.some(s => s && s.option === 'isPrincipal');
    if (isPrincipalAssigned) {
      await M.Teacher.updateMany(
        { 'specials.option': 'isPrincipal' },
        { $pull: { specials: { option: 'isPrincipal' } } }
      );
    }

    let finalDeptId = req.body.deptId || deptId;
    let finalDept = department || req.body.department || '';
    let finalDeptCode = deptCode || req.body.deptCode || '';
    if ((!finalDept || !finalDeptCode) && finalDeptId) {
      const dDoc = await M.Department.findById(finalDeptId).lean();
      if (dDoc) {
        if (!finalDept) finalDept = dDoc.name;
        if (!finalDeptCode) finalDeptCode = dDoc.code || dDoc.threeLetterCode || '';
      }
    }

    const teacher = await M.Teacher.create({
      fullName: cleanFullName, firstName: finalFirstName, lastName: finalLastName, employeeNo: (employeeNo || '').trim(),
      department: finalDept || '', deptId: finalDeptId || null, deptCode: finalDeptCode || '',
      designation: designation || '', email: (email || '').replace(/\s+/g, '').toLowerCase(), gender: gender || 'unspecified', username: normalizedUsername, password: hash,
      trackId: generatedTrackId,
      specials: finalSpecials,
      pageRights: finalPageRights,
      mustChangePassword: true
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
      `${cleanFullName} (${normalizedUsername}) — initial password set`,
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
    res.status(201).json({ ...teacherData, name: teacher.fullName, empId: teacher.employeeNo, dept: teacher.department, deptId: teacher.deptId, deptCode: teacher.deptCode, desig: teacher.designation });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
      const val = err.keyValue ? err.keyValue[field] : '';
      return res.status(400).json({ error: `${field === 'username' ? 'Username' : (field === 'trackId' ? 'Employee / Track ID' : field)} "${val}" is already registered. Please choose another.` });
    }
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', authMiddleware, requirePage('admin', 'edit', { tab: 'teachers' }), async (req, res) => {
  try {
    const { password, name, empId, dept, deptId, deptCode, desig, email, username, specials, active, status, firstName, lastName } = req.body;
    let teacher = null;
    if (mongoose.isValidObjectId(req.params.id)) {
      teacher = await M.Teacher.findById(req.params.id);
    }
    if (!teacher) {
      teacher = await M.Teacher.findOne({ trackId: req.params.id });
    }
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
    if (!assertInScope(req, teacher.deptId || teacher.department)) {
      return res.status(403).json({ error: 'Access denied: teacher is outside your department scope' });
    }

    const before = teacher.toObject();
    delete before.password;

    const oldUsername = teacher.username;

    if (name) {
      teacher.fullName = sanitizeFullName(name);
      const computed = splitFirstLastName(teacher.fullName);
      teacher.firstName = (firstName ? sanitizeFullName(firstName) : computed.firstName) || '';
      teacher.lastName = (lastName !== undefined && lastName !== null && String(lastName).trim() !== '') ? sanitizeFullName(lastName) : computed.lastName;
    } else {
      if (firstName !== undefined) teacher.firstName = sanitizeFullName(firstName);
      if (lastName !== undefined) teacher.lastName = sanitizeFullName(lastName);
    }
    if (empId !== undefined) teacher.employeeNo = empId;
    if (dept !== undefined) teacher.department = dept;
    if (deptId !== undefined) teacher.deptId = deptId || null;
    if (deptCode !== undefined) teacher.deptCode = deptCode || '';
    if (desig !== undefined) teacher.designation = desig;
    if (email !== undefined) teacher.email = (email || '').replace(/\s+/g, '').toLowerCase();
    if (username) {
      const newUsername = (username || '').replace(/\s+/g, '').toLowerCase();
      if (newUsername.startsWith('sb-') || newUsername.startsWith('tr-')) {
        return res.status(400).json({ error: "Username prefixes 'SB-' and 'TR-' are reserved for smart board device IDs" });
      }
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

    if (specials !== undefined || req.body.pageRights !== undefined) {
      let candidateSpecials = specials !== undefined ? specials : teacher.specials;
      let candidatePageRights = req.body.pageRights !== undefined ? req.body.pageRights : teacher.pageRights;
      const sanitized = sanitizeTeacherPrivileges(req.user, teacher, candidateSpecials, candidatePageRights);

      const willRemainSudo = isSudoAdmin({ specials: sanitized.specials, pageRights: sanitized.pageRights });
      const willBeActive = (active !== undefined ? !!active : true) && (status ? status === 'active' : true);
      if (!willRemainSudo || !willBeActive) {
        const check = await assertNotLastSudoAdmin(teacher.trackId || teacher._id);
        if (!check.allowed) {
          return res.status(403).json({ error: check.error });
        }
      }

      teacher.specials = sanitized.specials;
      teacher.pageRights = sanitized.pageRights;
      teacher.accessVersion = (teacher.accessVersion || 0) + 1;

      const isPrincipalAssigned = sanitized.specials.some(s => s && s.option === 'isPrincipal');
      if (isPrincipalAssigned) {
        await M.Teacher.updateMany(
          { _id: { $ne: teacher._id }, 'specials.option': 'isPrincipal' },
          { $pull: { specials: { option: 'isPrincipal' } } }
        );
      }
    } else if (active !== undefined || status !== undefined) {
      const willBeActive = (active !== undefined ? !!active : true) && (status ? status === 'active' : true);
      if (!willBeActive) {
        const check = await assertNotLastSudoAdmin(teacher.trackId || teacher._id);
        if (!check.allowed) {
          return res.status(403).json({ error: check.error });
        }
      }
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

router.delete('/:id', authMiddleware, requirePage('admin', 'delete', { tab: 'teachers' }), async (req, res) => {
  try {
    let teacher = null;
    if (mongoose.isValidObjectId(req.params.id)) {
      teacher = await M.Teacher.findById(req.params.id).select('-password');
    }
    if (!teacher) {
      teacher = await M.Teacher.findOne({ trackId: req.params.id }).select('-password');
    }
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
    if (!assertInScope(req, teacher.deptId || teacher.department)) {
      return res.status(403).json({ error: 'Access denied: teacher is outside your department scope' });
    }

    const guard = await assertNotLastSudoAdmin(teacher.trackId || teacher._id);
    if (!guard.allowed) return res.status(403).json({ error: guard.error });
    
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