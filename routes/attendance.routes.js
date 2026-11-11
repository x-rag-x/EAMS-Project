const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware, requireRole, requirePage, scopeFilter, assertInScope } = require('../middleware/auth');
const {
  attendanceClearLimiter,
  attendanceMarkLimiter,
  attendanceMarkIpLimiter,
  attendanceUpdateLimiter,
  attendanceUpdateIpLimiter
} = require('../utils/rateLimiters');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const countService = require('../services/countService');
const { checkAttendanceMarkGuard, getCachedSettings } = require('../middleware/portalGuard');
const { verifyTeacherAssignment } = require('../utils/assignmentAuth');
const { isSudoAdmin, isAdminUser, hasInstitutionReach } = require('../utils/access');
const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const { resolveEntitlements, enforceAttendancePolicy } = require('../utils/attendancePolicy');
const { onAttendanceSaved } = require('../utils/sessionHooks');
const { logAction } = require('../utils/logAction');
const { getSetting } = require('../utils/settingsCache');
const { sendError } = require('../utils/sendError');
const { todayInInstitutionTz, todayIST, getStartOfInstitutionDaySync, getEndOfInstitutionDaySync } = require('../utils/institutionTime');

function parseYearNum(val) {
  if (typeof val === 'number') return val;
  if (!val) return 1;
  const str = String(val).toUpperCase();
  if (str.includes('IV') || str === '4') return 4;
  if (str.includes('III') || str === '3') return 3;
  if (str.includes('II') || str === '2') return 2;
  if (str.includes('I') || str === '1') return 1;
  const num = parseInt(str, 10);
  return isNaN(num) ? 1 : num;
}

function parseSemNum(val) {
  if (typeof val === 'number') return val;
  if (!val) return 1;
  const str = String(val).toUpperCase();
  const romanMap = { VIII: 8, VII: 7, VI: 6, V: 5, IV: 4, III: 3, II: 2, I: 1 };
  for (const [r, n] of Object.entries(romanMap)) {
    if (str.includes(r)) return n;
  }
  const num = parseInt(str, 10);
  return isNaN(num) ? 1 : num;
}

function normalizeStatus(status) {
  if (!status) return 'P';
  const s = String(status).toUpperCase().trim();
  if (s === 'PRESENT' || s === 'P') return 'P';
  return 'AB';
}

const { computeStudentAttendance } = require('../utils/attendanceCalculator');

async function syncStudentAttendanceCounters(studentTrackId, targetClassId) {
  try {
    await computeStudentAttendance(studentTrackId, targetClassId);
  } catch (err) {
    console.error('Error syncing student attendance counter:', err);
  }
}


// GET /api/attendance/entitlements - Fetch active entitlements (OD / Leave) for a class session
router.get('/entitlements', authMiddleware, async (req, res) => {
  try {
    const classId = sanitizeToString(req.query.classId);
    const date = sanitizeToString(req.query.date);
    const periodNumber = req.query.period ? parseInt(req.query.period, 10) : null;

    if (!classId || !date) {
      return res.status(400).json({ error: 'classId and date are required query parameters' });
    }

    const entitlementsMap = await resolveEntitlements({ classId, date, periodNumber });
    const entitlementsList = Array.from(entitlementsMap.values());

    return res.json({
      ok: true,
      classId,
      date,
      periodNumber,
      entitlements: entitlementsList
    });
  } catch (err) {
    console.error('[Attendance Entitlements Error]:', err);
    return res.status(500).json({ error: 'Failed to resolve attendance entitlements' });
  }
});

// 60-second in-memory cache for Subject and Class lookups
let _subjectsCache = { at: 0, map: null };
let _classesCache = { at: 0, map: null };

async function getCachedSubjectMap() {
  const now = Date.now();
  if (_subjectsCache.map && now - _subjectsCache.at < 60000) {
    return _subjectsCache.map;
  }
  const allSubjects = await M.Subject.find()
    .select('_id subjectTrackId subjectCode name deptId')
    .lean();
  const map = new Map();
  allSubjects.forEach(sub => {
    map.set(String(sub._id), sub);
    if (sub.subjectTrackId) map.set(sub.subjectTrackId, sub);
    if (sub.subjectCode) map.set(sub.subjectCode, sub);
  });
  _subjectsCache = { at: now, map };
  return map;
}

async function getCachedClassMap() {
  const now = Date.now();
  if (_classesCache.map && now - _classesCache.at < 60000) {
    return _classesCache.map;
  }
  const allClasses = await M.Class.find()
    .select('_id classTrackId name department deptCode section year semester')
    .lean();
  const map = new Map();
  allClasses.forEach(c => {
    map.set(String(c._id), c);
    if (c.classTrackId) map.set(c.classTrackId, c);
  });
  _classesCache = { at: now, map };
  return map;
}

function invalidateAttendanceMetadataCache() {
  _subjectsCache = { at: 0, map: null };
  _classesCache = { at: 0, map: null };
}

// ═══════════════════════════════════════════════════════════════════════
// S2: Scope attendance records by role, department, and teacher class assignment
// ═══════════════════════════════════════════════════════════════════════
async function resolveAttendanceScope(req, qClassId, qTeacherId) {
  const isStudent = req.user.role === 'student';
  const isSudo = isSudoAdmin(req.user) || Boolean(req.access && req.access.flags?.isSudo);
  const hasAdminReach = isSudo || hasInstitutionReach(req.user) || req.user.role === 'admin' || Boolean(req.access && req.access.flags?.isSuper);
  const isHodOrPrincipal = Boolean(
    req.user.isHod ||
    req.user.isPrincipal ||
    (req.access && (req.access.flags?.isHod || req.access.isPrincipal)) ||
    (req.access && req.access.pages?.admin?.scope === 'department')
  );
  const isRegularTeacher = !hasAdminReach && !isHodOrPrincipal && req.user.role === 'teacher';

  const scope = {
    isStudent,
    hasAdminReach,
    isHodOrPrincipal,
    isRegularTeacher,
    filter: {},
    studentCaller: null,
    effectiveTeacherId: qTeacherId,
    advisedClassSet: new Set(),
    callerCandidates: [],
    assignedRows: [],
    allowedClassIds: new Set(),
    isBlocked: false,
    blockReason: null,
    statusCode: 200
  };

  if (isStudent) {
    const studentQueries = [{ trackId: req.user.trackId }, { username: req.user.username }];
    if (typeof req.user._id === 'string' && mongoose.Types.ObjectId.isValid(req.user._id)) {
      studentQueries.push({ _id: req.user._id });
    }
    const studentCaller = await M.Student.findOne({ $or: studentQueries }).lean();
    if (!studentCaller || (!studentCaller.classId && !studentCaller.class)) {
      scope.isBlocked = true;
      return scope;
    }
    scope.studentCaller = studentCaller;
    const studentClassId = studentCaller.classId || studentCaller.class;
    const classQuery = [{ _id: studentClassId }, { classTrackId: studentClassId }, { name: studentClassId }];
    if (mongoose.Types.ObjectId.isValid(studentClassId)) {
      classQuery.unshift({ _id: new mongoose.Types.ObjectId(studentClassId) });
    }
    const cls = await M.Class.findOne({ $or: classQuery }).lean();
    const validClassIds = [String(studentClassId)];
    if (cls) {
      validClassIds.push(String(cls._id));
      if (cls.classTrackId) validClassIds.push(cls.classTrackId);
      if (cls.name) validClassIds.push(cls.name);
    }
    scope.filter.classId = { $in: validClassIds };
    return scope;
  }

  if (hasAdminReach) {
    if (qClassId && qClassId !== 'all') {
      scope.filter.$or = [{ classId: qClassId }];
      const classQuery = [];
      if (mongoose.isValidObjectId(qClassId)) {
        classQuery.push({ _id: qClassId });
      }
      classQuery.push({ classTrackId: qClassId });
      classQuery.push({ name: qClassId });
      const cls = await M.Class.findOne({ $or: classQuery }).lean();
      if (cls) {
        scope.filter.$or.push({ classId: String(cls._id) });
        if (cls.classTrackId) scope.filter.$or.push({ classId: cls.classTrackId });
      }
    }
    return scope;
  }

  if (isHodOrPrincipal) {
    let userDeptId = req.access?.pages?.admin?.deptId || req.user.deptId || null;
    let userDeptName = req.access?.pages?.admin?.dept || req.user.department || req.user.deptName || '';
    let userDeptCode = req.user.deptCode || '';

    if (!userDeptCode && userDeptId) {
      const dDoc = await M.Department.findById(userDeptId).select('code name').lean();
      if (dDoc) {
        userDeptCode = dDoc.code || '';
        if (!userDeptName) userDeptName = dDoc.name || '';
      }
    }

    const deptClasses = await M.Class.find({
      $or: [
        ...(userDeptId && mongoose.isValidObjectId(userDeptId) ? [{ deptId: userDeptId }] : []),
        ...(userDeptCode ? [{ deptCode: new RegExp(`^${escapeRegex(userDeptCode)}$`, 'i') }] : []),
        ...(userDeptName ? [{ deptName: new RegExp(`^${escapeRegex(userDeptName)}$`, 'i') }] : [])
      ]
    }).select('_id trackId classTrackId name').lean();

    const hodAllowedClassIds = new Set();
    deptClasses.forEach(c => {
      hodAllowedClassIds.add(String(c._id));
      if (c.trackId) hodAllowedClassIds.add(String(c.trackId));
      if (c.classTrackId) hodAllowedClassIds.add(String(c.classTrackId));
      if (c.name) hodAllowedClassIds.add(String(c.name));
    });
    scope.allowedClassIds = hodAllowedClassIds;

    if (qClassId && qClassId !== 'all') {
      if (!hodAllowedClassIds.has(String(qClassId))) {
        scope.isBlocked = true;
        scope.statusCode = 403;
        scope.blockReason = 'Class is outside your department scope';
        return scope;
      }
      scope.filter.$or = [{ classId: qClassId }];
      const matched = deptClasses.find(c => String(c._id) === qClassId || c.trackId === qClassId || c.classTrackId === qClassId || c.name === qClassId);
      if (matched) {
        scope.filter.$or.push({ classId: String(matched._id) });
        if (matched.trackId) scope.filter.$or.push({ classId: matched.trackId });
        if (matched.classTrackId) scope.filter.$or.push({ classId: matched.classTrackId });
      }
    } else {
      const classIdList = Array.from(hodAllowedClassIds);
      scope.filter.$or = [
        ...(userDeptCode ? [{ departmentCode: new RegExp(`^${escapeRegex(userDeptCode)}$`, 'i') }] : []),
        ...(userDeptName ? [{ departmentCode: new RegExp(`^${escapeRegex(userDeptName)}$`, 'i') }] : []),
        ...(classIdList.length > 0 ? [{ classId: { $in: classIdList } }] : [])
      ];
    }
    return scope;
  }

  // Regular staff
  const callerTeacherCandidates = [
    req.user.trackId,
    String(req.user._id),
    req.user.roleId,
    req.user.username
  ].filter(Boolean);
  scope.callerCandidates = callerTeacherCandidates;

  // S2 fix: Ignore teacherId for non-admins unless it is the caller
  if (qTeacherId) {
    const isCaller = callerTeacherCandidates.includes(String(qTeacherId));
    if (!isCaller) {
      scope.effectiveTeacherId = req.user.trackId || String(req.user._id);
    }
  }

  const [advisedClasses, assignedRows] = await Promise.all([
    M.Class.find({
      $or: [
        { advisorTeacherId: req.user._id },
        { advisorTeacherTrackId: req.user.trackId },
        { 'subjectTeachers.teacherId': req.user._id },
        { 'subjectTeachers.teacherTrackId': req.user.trackId }
      ]
    }).select('_id trackId classTrackId name advisorTeacherId advisorTeacherTrackId').lean(),
    M.Assignment.find({
      $or: [
        { teacherId: { $in: callerTeacherCandidates } },
        { teacherTrackId: { $in: callerTeacherCandidates } }
      ]
    }).select('classId subjectId subjectTrackId').lean()
  ]);

  scope.assignedRows = assignedRows;
  const assignedClassIds = assignedRows.map(a => a.classId).filter(Boolean);
  let extraClasses = [];
  if (assignedClassIds.length > 0) {
    const objIds = assignedClassIds.filter(id => mongoose.isValidObjectId(id));
    extraClasses = await M.Class.find({
      $or: [
        ...(objIds.length > 0 ? [{ _id: { $in: objIds } }] : []),
        { trackId: { $in: assignedClassIds } },
        { classTrackId: { $in: assignedClassIds } },
        { name: { $in: assignedClassIds } }
      ]
    }).select('_id trackId classTrackId name').lean();
  }

  const combinedClasses = [...advisedClasses, ...extraClasses];
  const uniqueClassMap = new Map();
  combinedClasses.forEach(c => uniqueClassMap.set(String(c._id), c));
  const allStaffClasses = Array.from(uniqueClassMap.values());

  const teacherAllowedClassIds = new Set();
  allStaffClasses.forEach(c => {
    teacherAllowedClassIds.add(String(c._id));
    if (c.trackId) teacherAllowedClassIds.add(String(c.trackId));
    if (c.classTrackId) teacherAllowedClassIds.add(String(c.classTrackId));
    if (c.name) teacherAllowedClassIds.add(String(c.name));
  });
  assignedClassIds.forEach(id => teacherAllowedClassIds.add(String(id)));
  scope.allowedClassIds = teacherAllowedClassIds;

  advisedClasses.forEach(c => {
    const isAdvisor = String(c.advisorTeacherId) === String(req.user._id) || c.advisorTeacherTrackId === req.user.trackId;
    if (isAdvisor) {
      scope.advisedClassSet.add(String(c._id));
      if (c.trackId) scope.advisedClassSet.add(String(c.trackId));
      if (c.classTrackId) scope.advisedClassSet.add(String(c.classTrackId));
      if (c.name) scope.advisedClassSet.add(String(c.name));
    }
  });

  if (teacherAllowedClassIds.size === 0) {
    scope.isBlocked = true;
    return scope;
  }

  if (qClassId && qClassId !== 'all') {
    if (!teacherAllowedClassIds.has(String(qClassId))) {
      scope.isBlocked = true;
      scope.statusCode = 403;
      scope.blockReason = 'Class is outside your assignments';
      return scope;
    }
    scope.filter.$or = [{ classId: qClassId }];
    const matched = allStaffClasses.find(c => String(c._id) === qClassId || c.trackId === qClassId || c.classTrackId === qClassId || c.name === qClassId);
    if (matched) {
      scope.filter.$or.push({ classId: String(matched._id) });
      if (matched.trackId) scope.filter.$or.push({ classId: matched.trackId });
      if (matched.classTrackId) scope.filter.$or.push({ classId: matched.classTrackId });
    }
  } else {
    scope.filter.classId = { $in: Array.from(teacherAllowedClassIds) };
  }

  return scope;
}

function isPeriodAllowedForTeacher(period, classId, scope) {
  if (!scope.isRegularTeacher) return true;
  if (scope.advisedClassSet.has(String(classId))) return true;
  if (scope.callerCandidates.includes(period.teacherTrackId) || period.teacherTrackId === scope.callerCandidates[0]) return true;
  const teachesSubject = scope.assignedRows.some(a =>
    (String(a.classId) === String(classId) || scope.allowedClassIds.has(String(classId))) &&
    (a.subjectId === period.subjectTrackId || a.subjectTrackId === period.subjectTrackId)
  );
  return teachesSubject;
}

// GET /api/attendance - Query attendance records with search, filters, and pagination
router.get('/', authMiddleware, async (req, res) => {
  try {
    const qFrom = sanitizeToString(req.query.from);
    const qTo = sanitizeToString(req.query.to);
    const qDate = sanitizeToString(req.query.date);
    const qClassId = sanitizeToString(req.query.classId);
    const qTeacherId = sanitizeToString(req.query.teacherId);
    const qSubjectId = sanitizeToString(req.query.subjectId);
    const qStatus = sanitizeToString(req.query.status);
    const qSearch = sanitizeToString(req.query.search);
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limitParam = req.query.limit;
    const limit = (limitParam === '0' || limitParam === 'all') ? 0 : Math.max(1, parseInt(limitParam || '50', 10));

    // S2 fix: Scope attendance records by role, department, and teacher class assignment
    const scope = await resolveAttendanceScope(req, qClassId, qTeacherId);
    if (scope.isBlocked) {
      if (scope.statusCode === 403) {
        return res.status(403).json({ error: scope.blockReason });
      }
      return res.json([]);
    }

    const filter = { ...scope.filter };
    const studentCaller = scope.studentCaller;

    // Resolve subject once upfront and filter in MongoDB
    let targetSubjectTrackId = null;
        if (qSubjectId && qSubjectId !== 'all') {
      targetSubjectTrackId = qSubjectId;
      const subMap = await getCachedSubjectMap();
      const subObj = subMap.get(qSubjectId);
      if (subObj && subObj.subjectTrackId) targetSubjectTrackId = subObj.subjectTrackId;
      filter['periods.subjectTrackId'] = targetSubjectTrackId;
    }

    if (qDate) {
      const start = getStartOfInstitutionDaySync(qDate);
      const end = getEndOfInstitutionDaySync(qDate);
      filter.date = { $gte: start, $lte: end };
    } else if (qFrom && qTo) {
      const start = getStartOfInstitutionDaySync(qFrom);
      const end = getEndOfInstitutionDaySync(qTo);
      filter.date = { $gte: start, $lte: end };
    }

    // Resolve targetTeacherTrackId once upfront if effectiveTeacherId is present
    let targetTeacherTrackId = null;
    if (scope.effectiveTeacherId && scope.effectiveTeacherId !== 'all') {
      targetTeacherTrackId = scope.effectiveTeacherId;
      if (mongoose.isValidObjectId(scope.effectiveTeacherId)) {
        const tDoc = await M.Teacher.findById(scope.effectiveTeacherId).select('trackId').lean();
        if (tDoc && tDoc.trackId) {
          targetTeacherTrackId = tDoc.trackId;
        } else {
          const uDoc = await M.User.findOne({ $or: [{ _id: scope.effectiveTeacherId }, { trackId: scope.effectiveTeacherId }] }).select('trackId').lean();
          if (uDoc && uDoc.trackId) targetTeacherTrackId = uDoc.trackId;
        }
      } else {
        const tDoc = await M.Teacher.findOne({ $or: [{ trackId: scope.effectiveTeacherId }, { employeeNo: scope.effectiveTeacherId }] }).select('trackId').lean();
        if (tDoc && tDoc.trackId) targetTeacherTrackId = tDoc.trackId;
      }
      filter['periods.teacherTrackId'] = targetTeacherTrackId;
    }

    // Query recent class attendance docs (scoped)
    const classAttDocs = await M.ClassAttendance.find(filter).sort({ date: -1 }).limit(300).lean();

    // Collect unique student trackIds from the actual attendance records
    const studentTrackIds = new Set();
    for (const doc of classAttDocs) {
      for (const period of doc.periods || []) {
        for (const rec of period.records || []) {
          if (rec.studentTrackId) studentTrackIds.add(rec.studentTrackId);
        }
      }
    }

    // Fetch only the students referenced in these records
    const allStudents = studentTrackIds.size > 0
      ? await M.Student.find({
          $or: [
            { trackId: { $in: Array.from(studentTrackIds) } },
            { _id: { $in: Array.from(studentTrackIds).filter(id => mongoose.isValidObjectId(id)) } }
          ]
        }).select('_id trackId fullName registerNo classId department deptCode').lean()
      : [];
    
    const studentMap = new Map();
    allStudents.forEach(s => {
      studentMap.set(String(s._id), s);
      if (s.trackId) studentMap.set(s.trackId, s);
    });

    const allSubjects = await M.Subject.find().lean();
    const subjectMap = new Map();
    allSubjects.forEach(sub => {
      subjectMap.set(String(sub._id), sub);
      if (sub.subjectTrackId) subjectMap.set(sub.subjectTrackId, sub);
      if (sub.subjectCode) subjectMap.set(sub.subjectCode, sub);
    });

    const allClasses = await M.Class.find().lean();
    const classMap = new Map();
    allClasses.forEach(c => {
      classMap.set(String(c._id), c);
      if (c.classTrackId) classMap.set(c.classTrackId, c);
    });

    let flattened = [];
    for (const doc of classAttDocs) {
      const dateStr = doc.date ? (typeof doc.date === 'string' ? doc.date.split('T')[0] : todayIST(doc.date)) : '';
      const clsObj = classMap.get(doc.classId);
      const className = clsObj ? clsObj.name : doc.classId;

      for (let pIdx = 0; pIdx < (doc.periods || []).length; pIdx++) {
        const period = doc.periods[pIdx];
        if (!isPeriodAllowedForTeacher(period, doc.classId, scope)) continue;
        if (qTeacherId && period.teacherTrackId !== qTeacherId) {
          let targetTrackId = null;
          if (mongoose.isValidObjectId(qTeacherId)) {
            const tDoc = await M.Teacher.findById(qTeacherId).select('-password').lean();
            if (tDoc) targetTrackId = tDoc.trackId;
          }
          if (!targetTrackId) {
            const uDoc = await M.User.findOne({ $or: [{ _id: qTeacherId }, { trackId: qTeacherId }] }).lean();
            if (uDoc) targetTrackId = uDoc.trackId;
          }
          if (targetTrackId && period.teacherTrackId !== targetTrackId) {
            continue;
          }
        }

        const subObj = subjectMap.get(period.subjectTrackId);
        const subjectName = subObj ? subObj.name : period.subjectTrackId;
        const subjectId = subObj ? String(subObj._id) : period.subjectTrackId;

        for (let rIdx = 0; rIdx < (period.records || []).length; rIdx++) {
          const rec = period.records[rIdx];
          if (studentCaller) {
            const isOwn = rec.studentTrackId === studentCaller.trackId ||
                          String(rec.studentTrackId) === String(studentCaller._id) ||
                          rec.studentTrackId === studentCaller.registerNo;
            if (!isOwn) continue;
          }
          const stuObj = studentMap.get(rec.studentTrackId);
          const studentId = stuObj ? String(stuObj._id) : rec.studentTrackId;
          const studentName = stuObj ? stuObj.fullName : rec.studentTrackId;
          const regNo = stuObj ? stuObj.registerNo : '';
          const department = stuObj ? (stuObj.department || stuObj.deptCode || '') : (doc.departmentCode || '');

          const statusText = rec.status === 'P' ? 'present' : (rec.status === 'OD' ? 'od' : (rec.status === 'LEAVE' ? 'leave' : 'absent'));

          flattened.push({
            _id: `${doc._id}_${pIdx}_${rIdx}`,
            docId: doc._id,
            periodIndex: pIdx,
            recordIndex: rIdx,
            classId: doc.classId,
            className,
            department,
            subjectId,
            subjectTrackId: period.subjectTrackId,
            subjectName,
            teacherId: period.teacherTrackId,
            teacherName: period.markedBy || 'Faculty',
            date: dateStr,
            periodNumber: period.periodNumber || (period.periodNumbers ? period.periodNumbers[0] : 1),
            periodNumbers: period.periodNumbers,
            studentId,
            studentTrackId: rec.studentTrackId,
            studentName,
            regNo,
            status: statusText,
            rawStatus: rec.status,
            remarks: rec.remarks || period.topic || '',
            topic: period.topic || '',
            notes: period.notes || '',
          });
        }
      }
    }

    // Status filter
    if (qStatus && qStatus !== 'all') {
      const targetStat = qStatus.toLowerCase().trim();
      flattened = flattened.filter(r => (r.status && r.status.toLowerCase() === targetStat) || (r.rawStatus && String(r.rawStatus).toLowerCase() === targetStat));
    }

    // Search filter
    if (qSearch) {
      const q = qSearch.toLowerCase().trim();
      flattened = flattened.filter(r =>
        (r.studentName && r.studentName.toLowerCase().includes(q)) ||
        (r.regNo && r.regNo.toLowerCase().includes(q)) ||
        (r.className && r.className.toLowerCase().includes(q)) ||
        (r.subjectName && r.subjectName.toLowerCase().includes(q)) ||
        (r.teacherName && r.teacherName.toLowerCase().includes(q)) ||
        (r.department && r.department.toLowerCase().includes(q)) ||
        (r.date && r.date.includes(q))
      );
    }

    const total = flattened.length;
    const stats = {
      total,
      present: flattened.filter(r => r.status === 'present').length,
      absent: flattened.filter(r => r.status === 'absent').length,
      od: flattened.filter(r => r.status === 'od' || r.status === 'leave').length,
    };

    const pages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
    const paginated = limit > 0 ? flattened.slice((page - 1) * limit, page * limit) : flattened;

    res.json(paginated);
  } catch (err) {
    return sendError(res, err, 500, 'Failed to process attendance request');
  }
});

// GET /api/attendance/period-notes - Query period notes with filters
router.get('/period-notes', authMiddleware, async (req, res) => {
  try {
    const qFrom = sanitizeToString(req.query.from);
    const qTo = sanitizeToString(req.query.to);
    const qClassId = sanitizeToString(req.query.classId);
    const qSubjectId = sanitizeToString(req.query.subjectId);
    const qTeacherId = sanitizeToString(req.query.teacherId);
    const qSearch = sanitizeToString(req.query.search);

    // S3 fix: Enforce class/subject/author scoping for regular staff
    const scope = await resolveAttendanceScope(req, qClassId, qTeacherId);
    if (scope.isBlocked) {
      if (scope.statusCode === 403) {
        return res.status(403).json({ error: scope.blockReason });
      }
      return res.json([]);
    }

    const filter = { ...scope.filter };
    if (qFrom || qTo) {
      filter.date = {};
      if (qFrom) filter.date.$gte = getStartOfInstitutionDaySync(qFrom);
      if (qTo) filter.date.$lte = getEndOfInstitutionDaySync(qTo);
    }

    const docs = await M.ClassAttendance.find(filter).sort({ date: -1 }).lean();

    const [allClasses, allSubjects, allTeachers] = await Promise.all([
      M.Class.find().lean(),
      M.Subject.find().lean(),
      M.Teacher.find().lean()
    ]);

    const classMap = new Map();
    allClasses.forEach(c => {
      classMap.set(String(c._id), c.name || c.className || c.trackId);
      if (c.trackId) classMap.set(c.trackId, c.name || c.className);
    });

    const subjectMap = new Map();
    allSubjects.forEach(s => {
      subjectMap.set(String(s._id), s);
      if (s.trackId) subjectMap.set(s.trackId, s);
    });

    const teacherMap = new Map();
    allTeachers.forEach(t => {
      teacherMap.set(String(t._id), t);
      if (t.trackId) teacherMap.set(t.trackId, t);
    });

    const results = [];
    for (const doc of docs) {
      const dateStr = doc.date ? (typeof doc.date === 'string' ? doc.date.split('T')[0] : todayIST(doc.date)) : '';
      const className = classMap.get(String(doc.classId)) || classMap.get(doc.classId) || doc.classId;

      for (let pIdx = 0; pIdx < (doc.periods || []).length; pIdx++) {
        const period = doc.periods[pIdx];
        if (!isPeriodAllowedForTeacher(period, doc.classId, scope)) continue;
        if (qSubjectId && qSubjectId !== 'all' && period.subjectTrackId !== qSubjectId) {
          continue;
        }
        if (qTeacherId && qTeacherId !== 'all' && period.teacherTrackId !== qTeacherId) {
          continue;
        }

        const subObj = subjectMap.get(period.subjectTrackId);
        const subjectName = subObj ? subObj.name : period.subjectTrackId;
        const teachObj = teacherMap.get(period.teacherTrackId);
        const teacherName = teachObj ? (teachObj.fullName || teachObj.name) : (period.markedBy || 'Faculty');

        const topic = period.topic || '';
        const notes = period.notes || '';

        // Search filter if provided
        if (qSearch) {
          const q = qSearch.toLowerCase().trim();
          const match = (
            topic.toLowerCase().includes(q) ||
            notes.toLowerCase().includes(q) ||
            className.toLowerCase().includes(q) ||
            subjectName.toLowerCase().includes(q) ||
            teacherName.toLowerCase().includes(q)
          );
          if (!match) continue;
        }

        const records = period.records || [];
        const presentCount = records.filter(r => r.status === 'P').length;
        const totalCount = records.length;

        results.push({
          docId: doc._id,
          periodIndex: pIdx,
          date: dateStr,
          periodNumber: period.periodNumber || (period.periodNumbers ? period.periodNumbers[0] : 1),
          classId: doc.classId,
          className,
          subjectTrackId: period.subjectTrackId,
          subjectName,
          teacherTrackId: period.teacherTrackId,
          teacherName,
          topic,
          notes,
          presentCount,
          totalCount,
          markedAt: period.markedAt
        });
      }
    }

    res.json(results);
  } catch (err) {
    console.error('[Period Notes Error]:', err);
    return sendError(res, err, 500, 'Failed to process attendance request');
  }
});

// PUT /api/attendance/period-notes/:docId/:periodIndex - Update period notes
router.put('/period-notes/:docId/:periodIndex', authMiddleware, requireRole('teacher', 'admin'), attendanceUpdateIpLimiter, attendanceUpdateLimiter, checkAttendanceMarkGuard, async (req, res) => {
  try {
    const { docId, periodIndex } = req.params;
    const { topic, notes } = req.body;
    const pIdx = parseInt(periodIndex, 10);
    const MAX_TOPIC_LENGTH = 500;
    const MAX_NOTES_LENGTH = 2000;

    const doc = await M.ClassAttendance.findById(docId);
    if (!doc || !doc.periods || !doc.periods[pIdx]) {
      return res.status(404).json({ error: 'Period attendance record not found' });
    }

    const period = doc.periods[pIdx];
    const isSudo = isSudoAdmin(req.user) || Boolean(req.access && req.access.flags?.isSudo);
    const isAdmin = isSudo || hasInstitutionReach(req.user) || req.user.role === 'admin';

    // Verify institutional edit lock, autoLock hours, and backdate limits
    const attConfig = await getCachedSettings('attendance');
    if (!isAdmin) {
      if (attConfig.allowAttendanceEdit === false) {
        return res.status(403).json({ error: 'Editing attendance or period notes is locked by administrator policy.' });
      }

      if (attConfig.autoLockAttendanceHours && Number(attConfig.autoLockAttendanceHours) > 0) {
        const lockHours = Number(attConfig.autoLockAttendanceHours);
        const recordTime = period.markedAt || doc.createdAt || doc.date;
        if (recordTime) {
          const recordMs = new Date(recordTime).getTime();
          const lockMs = recordMs + (lockHours * 3600 * 1000);
          if (Date.now() >= lockMs) {
            return res.status(403).json({ error: `Attendance record auto-locked after ${lockHours} hour(s). Contact administrator.` });
          }
        }
      }

      if (attConfig.maxAttendanceBackdateDays !== undefined && attConfig.maxAttendanceBackdateDays !== null) {
        const maxBackDays = Number(attConfig.maxAttendanceBackdateDays);
        if (maxBackDays >= 0 && doc.date) {
          const docDateOnly = new Date(doc.date).toISOString().slice(0, 10);
          const minDate = new Date();
          minDate.setDate(minDate.getDate() - maxBackDays);
          const minDateOnly = minDate.toISOString().slice(0, 10);
          if (docDateOnly < minDateOnly) {
            return res.status(403).json({
              error: `Date exceeds maximum backdate allowance of ${maxBackDays} day(s).`,
              backdateLocked: true
            });
          }
        }
      }

      // S3 Period Author / Teacher Assignment check
      const teacherTrackId = req.user.trackId || String(req.user._id);
      const isPeriodAuthor = period.teacherTrackId === teacherTrackId;
      if (!isPeriodAuthor) {
        const isAssigned = await verifyTeacherAssignment(req.user, doc.classId, period.subjectTrackId || period.subjectId);
        if (!isAssigned) {
          return res.status(403).json({ error: 'You are not authorized to edit notes for this attendance period.' });
        }
      }
    }

    // Sanitize and cap length
    const cleanTopic = topic !== undefined ? String(topic).trim() : (period.topic || '');
    const cleanNotes = notes !== undefined ? String(notes).trim() : (period.notes || '');

    if (cleanTopic.length > MAX_TOPIC_LENGTH) {
      return res.status(400).json({ error: `Topic exceeds maximum length of ${MAX_TOPIC_LENGTH} characters.` });
    }
    if (cleanNotes.length > MAX_NOTES_LENGTH) {
      return res.status(400).json({ error: `Notes exceed maximum length of ${MAX_NOTES_LENGTH} characters.` });
    }

    const previousTopic = period.topic || '';
    const previousNotes = period.notes || '';

    period.topic = cleanTopic;
    period.notes = cleanNotes;
    doc.updatedAt = new Date();
    await doc.save();

    // Audit log
    await logAction(req, 'Period Notes Updated', {
      module: 'attendance',
      subType: 'period-notes-edit',
      classId: doc.classId,
      date: doc.date,
      periodIndex: pIdx,
      periodNumber: period.periodNumber,
      topicChanged: previousTopic !== cleanTopic,
      notesChanged: previousNotes !== cleanNotes
    });

    res.json({ ok: true, success: true, message: 'Period notes updated successfully', period: doc.periods[pIdx] });
  } catch (err) {
    console.error('[Period Notes Edit Error]:', err);
    return sendError(res, err, 500, 'Failed to process attendance request');
  }
});

async function appendAttendanceChangeToDailyLog(classId, dateStr, periodNum, studentTrackId, newStatus, req) {
  try {
    const student = await M.Student.findOne({ $or: [{ trackId: studentTrackId }, { _id: studentTrackId }] }).select('registerNo fullName trackId').lean();
    const regNo = student?.registerNo || studentTrackId;
    const sName = student?.fullName || studentTrackId;

    const teacherName = (req.user?.firstName && req.user?.lastName)
      ? `${req.user.firstName} ${req.user.lastName}`.trim()
      : (req.user?.fullName || req.user?.name || req.user?.username || 'Teacher');
    const teacherSessionId = req.user?.sessionId || '';
    const teacherTrackId = req.user?.trackId || String(req.user?._id || '');

    const log = await M.Log.findOne({
      category: 'attendance',
      subType: 'attendance',
      'attendanceClassDaily.classId': String(classId),
      'attendanceClassDaily.date': dateStr
    });

    if (log && log.attendanceClassDaily) {
      const periods = log.attendanceClassDaily.periods || [];
      const period = periods.find(p => p.periodNumber === Number(periodNum));
      if (period) {
        const rec = (period.records || []).find(r => r.studentTrackId === studentTrackId);
        const oldStatus = rec ? rec.status : 'Unknown';
        if (rec) rec.status = newStatus;
        else period.records.push({ studentTrackId, regNo, name: sName, status: newStatus });

        // Update stats
        let pCnt = 0, aCnt = 0, odCnt = 0;
        period.records.forEach(r => {
          if (r.status === 'P' || r.status === 'PRESENT') pCnt++;
          else if (r.status === 'OD' || r.status === 'ON DUTY') odCnt++;
          else aCnt++;
        });
        period.stats = { total: period.records.length, present: pCnt, absent: aCnt, od: odCnt };

        period.history = (period.history || []).concat([{
          action: 'Updated',
          teacherTrackId,
          teacherName,
          teacherSessionId,
          method: 'Manual Edit',
          changedAt: new Date(),
          summary: `Updated student ${regNo} (${oldStatus} -> ${newStatus}) by ${teacherName}`
        }]);

        log.time = new Date();
        log.sessionId = teacherSessionId;
        log.userName = teacherName;
        log.details = `Class ${classId} Period ${periodNum} updated: ${regNo} changed to ${newStatus} by ${teacherName}. Session: ${teacherSessionId}`;
        await log.save();
      }
    }
  } catch (err) {
    console.error('[appendAttendanceChange Error]:', err.message);
  }
}

// POST /api/attendance/update - Update an individual attendance record
router.post('/update/:id?', authMiddleware, requireRole('teacher', 'admin'), attendanceUpdateIpLimiter, attendanceUpdateLimiter, checkAttendanceMarkGuard, async (req, res) => {
  try {
    const { status, remarks, studentTrackId, date, periodNumber } = req.body;
    const idParam = req.params.id;

    // Check institutional attendance editing policy
    const settingsDoc = await M.Settings.findOne({ key: 'attendance' }).lean();
    const attConfig = settingsDoc?.value || {};
    if (!isSudoAdmin(req.user)) {
      if (attConfig.allowAttendanceEdit === false) {
        return res.status(403).json({ error: 'Attendance editing has been locked by institution policy.' });
      }
    }

    // Support composite ID: {docId}_{pIdx}_{rIdx}
    let classAttDoc = null;
    let pIdx = -1;
    let rIdx = -1;

    if (idParam && idParam.includes('_')) {
      const parts = idParam.split('_');
      const docId = parts[0];
      pIdx = parseInt(parts[1], 10);
      rIdx = parseInt(parts[2], 10);
      classAttDoc = await M.ClassAttendance.findById(docId);
      if (classAttDoc && classAttDoc.periods && classAttDoc.periods[pIdx] && classAttDoc.periods[pIdx].records && classAttDoc.periods[pIdx].records[rIdx]) {
        const period = classAttDoc.periods[pIdx];

        // Policy & assignment check for non-admins
        if (!isSudoAdmin(req.user)) {
          const autoLockHours = Number(attConfig.autoLockAttendanceHours);
          if (autoLockHours > 0) {
            const classDate = classAttDoc.date ? new Date(classAttDoc.date) : (period.markedAt ? new Date(period.markedAt) : null);
            if (classDate) {
              const lockThreshold = new Date(Date.now() - autoLockHours * 3600 * 1000);
              if (classDate < lockThreshold) {
                return res.status(403).json({ error: `Attendance is locked. Edits are only permitted within ${autoLockHours} hours of the class.` });
              }
            }
          }

          const teacherTrackId = req.user.trackId || String(req.user._id);
          const isPeriodAuthor = period.teacherTrackId === teacherTrackId;
          if (!isPeriodAuthor) {
            const assignCheck = await verifyTeacherAssignment(req.user, classAttDoc.classId, period.subjectTrackId, {
              date: classAttDoc.date,
              periodNumber: period.periodNumber || (pIdx + 1)
            });
            if (!assignCheck.allowed) {
              return res.status(403).json({ error: 'You are not authorized to edit this attendance period.' });
            }
          }
        }

        const rec = period.records[rIdx];
        if (rec.locked && !isSudoAdmin(req.user)) {
          return res.status(403).json({
            error: `Cannot modify record: Student has an approved ${rec.reason ? rec.reason.toUpperCase() : 'entitlement'} locked on this period.`
          });
        }
        if (status) rec.status = normalizeStatus(status);
        if (remarks !== undefined) rec.remarks = remarks;
        if (req.user && (req.user.role === 'admin' || isSudoAdmin(req.user))) {
          if (!period.source) period.source = { method: 'Admin Edit', via: 'admin' };
          else period.source.via = 'admin';
        }
        classAttDoc.periods[pIdx].records[rIdx] = rec;
        classAttDoc.updatedAt = new Date();
        await classAttDoc.save();

        if (rec.studentTrackId) {
          syncStudentAttendanceCounters(rec.studentTrackId, classAttDoc.classId).catch(() => {});
          const pNum = period.periodNumber || (pIdx + 1);
          const dStr = classAttDoc.date ? (typeof classAttDoc.date === 'string' ? classAttDoc.date.split('T')[0] : todayIST(classAttDoc.date)) : (date || '');
          appendAttendanceChangeToDailyLog(classAttDoc.classId, dStr, pNum, rec.studentTrackId, rec.status, req).catch(() => {});
        }
        return res.json({ success: true, message: 'Attendance record updated successfully', record: rec });
      }
    }

    // Find record matching studentTrackId across all periods
    const effectiveStudentTrackId = studentTrackId || idParam;
    const attDoc = await M.ClassAttendance.findOne({
      "periods.records.studentTrackId": effectiveStudentTrackId,
      ...(date ? { date } : {})
    });

    if (attDoc) {
      let found = false;
      let matchedRec = null;
      let matchedPeriodNumber = 1;
      for (const p of attDoc.periods) {
        if (periodNumber && p.periodNumber !== Number(periodNumber)) continue;
        const rec = p.records.find(r => r.studentTrackId === effectiveStudentTrackId);
        if (rec) {
          if (!isSudoAdmin(req.user)) {
            const autoLockHours = Number(attConfig.autoLockAttendanceHours);
            if (autoLockHours > 0) {
              const classDate = attDoc.date ? new Date(attDoc.date) : (p.markedAt ? new Date(p.markedAt) : null);
              if (classDate) {
                const lockThreshold = new Date(Date.now() - autoLockHours * 3600 * 1000);
                if (classDate < lockThreshold) {
                  return res.status(403).json({ error: `Attendance is locked. Edits are only permitted within ${autoLockHours} hours of the class.` });
                }
              }
            }

            const teacherTrackId = req.user.trackId || String(req.user._id);
            const isPeriodAuthor = p.teacherTrackId === teacherTrackId;
            if (!isPeriodAuthor) {
              const assignCheck = await verifyTeacherAssignment(req.user, attDoc.classId, p.subjectTrackId, {
                date: attDoc.date,
                periodNumber: p.periodNumber || 1
              });
              if (!assignCheck.allowed) {
                return res.status(403).json({ error: 'You are not authorized to edit this attendance period.' });
              }
            }
          }

          if (rec.locked && !isSudoAdmin(req.user)) {
            return res.status(403).json({
              error: `Cannot modify record: Student has an approved ${rec.reason ? rec.reason.toUpperCase() : 'entitlement'} locked on this period.`
            });
          }
          if (status) rec.status = normalizeStatus(status);
          if (remarks !== undefined) rec.remarks = remarks;
          matchedRec = rec;
          matchedPeriodNumber = p.periodNumber || 1;
          found = true;
          break;
        }
      }
      if (found) {
        attDoc.updatedAt = new Date();
        await attDoc.save();
        syncStudentAttendanceCounters(effectiveStudentTrackId, attDoc.classId).catch(() => {});
        const dStr = attDoc.date ? (typeof attDoc.date === 'string' ? attDoc.date.split('T')[0] : todayIST(attDoc.date)) : (date || '');
        appendAttendanceChangeToDailyLog(attDoc.classId, dStr, matchedPeriodNumber, effectiveStudentTrackId, matchedRec.status, req).catch(() => {});
        return res.json({ success: true, message: 'Attendance record updated successfully', record: matchedRec });
      }
    }

    return res.status(404).json({ error: 'Attendance record not found for update' });
  } catch (err) {
    return sendError(res, err, 500, 'Failed to process attendance request');
  }
});

// POST /api/attendance - Save or batch update class attendance records
router.post('/', authMiddleware, requireRole('teacher', 'admin'), attendanceMarkIpLimiter, attendanceMarkLimiter, checkAttendanceMarkGuard, async (req, res) => {
  try {
    const isBatch = Array.isArray(req.body.records);
    const rawRecords = isBatch ? req.body.records : [req.body];

    // Session resolution (Phase 8, Section 10.4)
    let sessionDoc = null;
    const sessionIdInput = req.body.sessionId || (rawRecords[0] && rawRecords[0].sessionId);
    if (sessionIdInput) {
      if (!mongoose.isValidObjectId(sessionIdInput)) {
        return res.status(400).json({ error: 'Invalid sessionId format' });
      }
      sessionDoc = await M.ClassSession.findById(sessionIdInput);
      if (!sessionDoc) {
        return res.status(404).json({ error: 'Class session not found' });
      }
      if (sessionDoc.status === 'cancelled' || sessionDoc.status === 'holiday') {
        return res.status(409).json({ error: `Cannot mark attendance for ${sessionDoc.status} session` });
      }
    }

    const classIdInput = req.body.classId || (rawRecords[0] && rawRecords[0].classId) || (sessionDoc ? sessionDoc.classId : '');
    const subjectIdInput = req.body.subjectId || (rawRecords[0] && rawRecords[0].subjectId) || (sessionDoc ? (sessionDoc.subjectId || sessionDoc.subjectName) : '');
    const todayDateStr = await todayInInstitutionTz();
    const rawDateInput = req.body.date || (rawRecords[0] && rawRecords[0].date) || (sessionDoc ? sessionDoc.date : '') || todayDateStr;
    const dateInput = String(rawDateInput).trim();
    const periodNumInput = Number(req.body.periodNumber || req.body.period || (rawRecords[0] && rawRecords[0].periodNumber) || (sessionDoc ? sessionDoc.periodNumber : 1)) || 1;

    if (!classIdInput || !subjectIdInput) {
      return res.status(400).json({ error: 'classId and subjectId are required' });
    }

    // Validate date format strictly (YYYY-MM-DD)
    const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
    if (!DATE_REGEX.test(dateInput)) {
      return res.status(400).json({ error: 'Date must be a valid date in YYYY-MM-DD format' });
    }
    const [dYear, dMonth, dDay] = dateInput.split('-').map(Number);
    const targetDate = new Date(Date.UTC(dYear, dMonth - 1, dDay, 0, 0, 0, 0));
    if (
      isNaN(targetDate.getTime()) ||
      targetDate.getUTCFullYear() !== dYear ||
      targetDate.getUTCMonth() !== dMonth - 1 ||
      targetDate.getUTCDate() !== dDay
    ) {
      return res.status(400).json({ error: 'Invalid calendar date' });
    }

    // Verify attendance policy constraints for non-admin roles
    const settings = await getCachedSettings();
    const attSettings = settings.attendance || {};

    if (!isSudoAdmin(req.user)) {
      const [tYear, tMonth, tDay] = todayDateStr.split('-').map(Number);
      const todayDate = new Date(Date.UTC(tYear, tMonth - 1, tDay, 0, 0, 0, 0));
      const diffDays = Math.floor((todayDate - targetDate) / (1000 * 60 * 60 * 24));

      // Reject future dates for non-sudo users
      if (diffDays < 0) {
        return res.status(403).json({
          error: 'Marking attendance for future dates is not permitted.',
          futureDateBlocked: true
        });
      }

      // Verify max attendance backdate limit
      const maxBackdate = attSettings.maxAttendanceBackdateDays !== undefined ? Number(attSettings.maxAttendanceBackdateDays) : 3;
      if (diffDays > maxBackdate) {
        return res.status(403).json({
          error: `Attendance marking for dates older than ${maxBackdate} day(s) is locked by administrator.`,
          backdateLocked: true
        });
      }

      // Verify required period remark or topic
      const requireRemark = !!attSettings.requirePeriodRemark;
      const topicInput = req.body.topic || req.body.remarks || (rawRecords[0] && (rawRecords[0].topic || rawRecords[0].remarks));
      if (requireRemark && (!topicInput || !String(topicInput).trim())) {
        return res.status(400).json({
          error: 'Topic / Period Remark is required by institutional attendance policy.',
          remarkRequired: true
        });
      }
    }

    // Resolve Class - match by _id, trackId, or classTrackId (never by non-unique name)
    const classQuery = [];
    if (mongoose.isValidObjectId(classIdInput)) {
      classQuery.push({ _id: classIdInput });
    }
    classQuery.push({ trackId: classIdInput });
    classQuery.push({ classTrackId: classIdInput });

    const cls = await M.Class.findOne({ $or: classQuery }).lean();
    if (!cls) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const targetClassId = cls.trackId || cls.classTrackId || String(cls._id);
    const batch = cls.batch || '2025-2029';
    const year = parseYearNum(cls.year) || 1;
    const sem = parseSemNum(cls.sem) || 1;
    const departmentCode = cls.deptCode || cls.deptName || 'GEN';

    // Resolve Subject
    const subjectQuery = [];
    if (mongoose.isValidObjectId(subjectIdInput)) {
      subjectQuery.push({ _id: subjectIdInput });
    }
    subjectQuery.push({ subjectTrackId: subjectIdInput });
    subjectQuery.push({ subjectCode: subjectIdInput });
    subjectQuery.push({ name: subjectIdInput });

    const sub = await M.Subject.findOne({ $or: subjectQuery }).lean();
    const targetSubjectTrackId = sub ? (sub.subjectTrackId || sub.subjectCode || String(sub._id)) : subjectIdInput;

    // Check timetable.attendanceLink feature flag (models.timetable)
    const modelsSettings = await getSetting('models');
    const featSettings = await getSetting('features');
    const ttSettings = await getSetting('timetable');
    const attendanceLinkEnabled = Boolean(
      (modelsSettings?.timetable?.attendanceLink !== undefined)
        ? modelsSettings.timetable.attendanceLink
        : ((featSettings?.timetable?.attendanceLink !== undefined)
            ? featSettings.timetable.attendanceLink
            : ttSettings?.attendanceLink)
    );

    if (attendanceLinkEnabled && !sessionDoc) {
      // Look up matching ClassSession for this slot
      sessionDoc = await M.ClassSession.findOne({
        classId: targetClassId,
        date: dateInput,
        periodNumber: periodNumInput
      });

      if (!sessionDoc) {
        return res.status(409).json({ error: 'No scheduled timetable session found for this period' });
      }
      if (sessionDoc.status === 'cancelled' || sessionDoc.status === 'holiday') {
        return res.status(409).json({ error: `Cannot mark attendance for ${sessionDoc.status} session` });
      }
    }

    // Verify teacher assignment to this class and subject (skip for admin, permit valid substitute or session authority)
    const assignCheck = await verifyTeacherAssignment(req.user, targetClassId, targetSubjectTrackId, {
      date: dateInput,
      periodNumber: periodNumInput,
      sessionId: sessionDoc?._id || undefined
    });
    if (!assignCheck.allowed) {
      return res.status(403).json({ error: assignCheck.reason });
    }


    // Resolve Teacher
    const teacherTrackId = req.user.trackId || String(req.user._id);
    const markedBy = req.user.username || req.user.fullName || req.user.name || 'Teacher';

    const referencedInputs = [...new Set(rawRecords.map(rec => rec.studentTrackId || rec.studentId).filter(Boolean))];
    const referencedObjectIds = referencedInputs.filter(id => mongoose.isValidObjectId(id));
    const allStudents = referencedInputs.length
      ? await M.Student.find({
          $or: [
            { trackId: { $in: referencedInputs } },
            ...(referencedObjectIds.length ? [{ _id: { $in: referencedObjectIds } }] : [])
          ]
        }).select('-password').lean()
      : [];
    const studentLookup = new Map();
    allStudents.forEach(s => {
      studentLookup.set(String(s._id), s);
      if (s.trackId) studentLookup.set(s.trackId, s);
    });

    // Auto-mark check: detect students with approved leave or self-period absence
    const activeLeaves = await M.LeaveRequest.find({
      dates: dateInput,
      status: 'Approved'
    }).lean();

    const preAbsentTrackIds = new Set();
    activeLeaves.forEach(l => {
      const matchPeriod = (!l.slot || l.slot === 'Full Day' || l.category === 'Leave')
        || (l.slot === 'FN' && periodNumInput <= 4)
        || (l.slot === 'AN' && periodNumInput >= 5)
        || (Array.isArray(l.periods) && l.periods.includes(periodNumInput));
      if (matchPeriod) {
        if (l.studentTrackId) preAbsentTrackIds.add(l.studentTrackId);
        if (l.studentId) preAbsentTrackIds.add(String(l.studentId));
      }
    });

    const formattedRecords = [];
    const affectedTrackIds = new Set();

    for (const rec of rawRecords) {
      const sInput = rec.studentTrackId || rec.studentId;
      const stuObj = studentLookup.get(sInput);
      const studentTrackId = stuObj ? (stuObj.trackId || String(stuObj._id)) : sInput;
      let status = normalizeStatus(rec.status);
      const isSelfOrLeaveAbsent = preAbsentTrackIds.has(studentTrackId) || (stuObj && (preAbsentTrackIds.has(String(stuObj._id)) || preAbsentTrackIds.has(stuObj.trackId)));
      if (isSelfOrLeaveAbsent) {
        status = 'absent';
      }
      if (studentTrackId) {
        formattedRecords.push({ studentTrackId, status });
        affectedTrackIds.add(studentTrackId);
      }
    }

    // Normalize session date to UTC midnight
    const sessionDate = new Date(dateInput + 'T00:00:00.000Z');

    // Find existing ClassAttendance document for this class and date
    let classAttDoc = await M.ClassAttendance.findOne({
      classId: targetClassId,
      date: sessionDate
    });
    const isNewClassAttDoc = !classAttDoc;

    // Extract multi-period numbers if present, otherwise default to [periodNumInput]
    const targetPeriodNumbers = Array.isArray(req.body.periodNumbers) && req.body.periodNumbers.length
      ? req.body.periodNumbers.map(Number).filter(n => !isNaN(n) && n > 0)
      : [periodNumInput];

    // Enforce attendance entitlement policy (OD locks Present, Leave locks Absent)
    const enforcedRecords = await enforceAttendancePolicy({
      classId: targetClassId,
      date: dateInput,
      periodNumber: periodNumInput,
      periodNumbers: targetPeriodNumbers,
      records: formattedRecords,
      actorTrackId: teacherTrackId,
      actorRole: req.user.role
    });

    // Hoist & validate captureMethod and session link (AttReg B2)
    let captureMethod = 'Manual';
    let sessionTrackId = '';
    let sessionModel = '';

    if (req.body.scanLiveSessionId) {
      const liveSession = await M.ScanLiveSession.findOne({
        sessionTrackId: req.body.scanLiveSessionId
      }).lean();
      if (liveSession && (req.user.role === 'admin' || isSudoAdmin(req.user) || liveSession.teacherTrackId === teacherTrackId)) {
        captureMethod = 'Live QR';
        sessionTrackId = liveSession.sessionTrackId;
        sessionModel = 'ScanLiveSession';
      }
    } else if (req.body.quickPassSessionId) {
      const qpSession = await M.QuickPassSession.findOne({
        _id: mongoose.isValidObjectId(req.body.quickPassSessionId) ? req.body.quickPassSessionId : null
      }).lean();
      if (qpSession && (req.user.role === 'admin' || isSudoAdmin(req.user) || qpSession.teacherTrackId === teacherTrackId)) {
        captureMethod = 'QuickPass Code';
        sessionTrackId = String(qpSession._id);
        sessionModel = 'QuickPassSession';
      }
    } else if (req.body.repShareSessionId) {
      captureMethod = 'Rep Share';
      sessionTrackId = String(req.body.repShareSessionId);
      sessionModel = 'RepShareSession';
    } else if (req.body.method && typeof req.body.method === 'string') {
      captureMethod = req.body.method;
    }

    const via = (req.user && (req.user.role === 'admin' || isSudoAdmin(req.user)))
      ? 'admin'
      : (req.body.isSubstitution ? 'substitution' : 'direct');

    const periodObj = {
      periodNumber: periodNumInput,
      periodNumbers: targetPeriodNumbers,
      sessionId: sessionDoc ? sessionDoc._id : null,
      slotKey: sessionDoc ? (sessionDoc.slotKey || '') : '',
      timetableTrackId: sessionDoc?.timetableTrackId || '',
      scheduledTeacherTrackId: sessionDoc?.scheduledTeacher?.trackId || '',
      subjectTrackId: targetSubjectTrackId,
      teacherTrackId,
      markedBy,
      markedAt: new Date(),
      topic: String(req.body.topic || '').trim(),
      notes: String(req.body.notes || '').trim(),
      source: {
        method: captureMethod,
        sessionTrackId,
        sessionModel,
        via
      },
      records: enforcedRecords
    };

    let existingPeriodIdx = -1;
    if (classAttDoc && Array.isArray(classAttDoc.periods)) {
      // Check if period for this subject and period number already exists
      existingPeriodIdx = classAttDoc.periods.findIndex(p => {
        const matchesSubject = (p.subjectTrackId === targetSubjectTrackId || String(p.subjectTrackId) === String(targetSubjectTrackId));
        const pNums = Array.isArray(p.periodNumbers) && p.periodNumbers.length > 0 ? p.periodNumbers : [Number(p.periodNumber)];
        const overlaps = targetPeriodNumbers.some(tn => pNums.includes(tn));
        return matchesSubject && overlaps;
      });

      if (existingPeriodIdx !== -1) {
        // Verify attendance edit permissions
        if (!isSudoAdmin(req.user) && attSettings.allowAttendanceEdit === false) {
          return res.status(403).json({
            error: 'Modifying previously saved attendance is locked by administrator.',
            editLocked: true
          });
        }

        // Verify auto-lock threshold for finalized attendance
        const autoLockHours = Number(attSettings.autoLockAttendanceHours) || 0;
        if (!isSudoAdmin(req.user) && autoLockHours > 0) {
          const existingPeriod = classAttDoc.periods[existingPeriodIdx];
          const markedAtTime = existingPeriod.markedAt ? new Date(existingPeriod.markedAt).getTime() : new Date(classAttDoc.createdAt).getTime();
          const ageHours = (Date.now() - markedAtTime) / (1000 * 60 * 60);
          if (ageHours > autoLockHours) {
            return res.status(403).json({
              error: `This attendance record was finalized and auto-locked after ${autoLockHours} hours.`,
              autoLocked: true
            });
          }
        }
      }
    }

    // Atomic update or upsert with array push per period (prevents duplicate documents)
    if (existingPeriodIdx !== -1) {
      // Case 1: Update the existing period in-place using arrayFilters
      const existingPeriod = classAttDoc.periods[existingPeriodIdx];
      const matchPeriodNum = existingPeriod.periodNumber || targetPeriodNumbers[0];

      classAttDoc = await M.ClassAttendance.findOneAndUpdate(
        {
          classId: targetClassId,
          date: sessionDate,
          $or: [
            { 'periods.periodNumbers': { $in: targetPeriodNumbers } },
            { 'periods.periodNumber': matchPeriodNum }
          ]
        },
        {
          $set: {
            'periods.$[elem]': periodObj,
            updatedAt: new Date()
          }
        },
        {
          arrayFilters: [{
            $or: [
              { 'elem.periodNumbers': { $in: targetPeriodNumbers } },
              { 'elem.periodNumber': matchPeriodNum }
            ]
          }],
          returnDocument: 'after'
        }
      );
    } else {
      classAttDoc = null;
    }

    // Case 2: Period does not exist in the document yet (or document does not exist)
    if (!classAttDoc) {
      try {
        if (isNewClassAttDoc) { await countService.modifyCount('attendanceRecords', 1).catch(() => {}); }
        classAttDoc = await M.ClassAttendance.findOneAndUpdate(
          { classId: targetClassId, date: sessionDate },
          {
            $setOnInsert: {
              batch,
              year,
              sem,
              classId: targetClassId,
              departmentCode,
              date: sessionDate,
              isFinalized: false,
              createdAt: new Date()
            },
            $push: { periods: periodObj },
            $set: { updatedAt: new Date() }
          },
          { upsert: true, returnDocument: 'after' }
        );
      } catch (upsertErr) {
        if (upsertErr.code === 11000 || (upsertErr.message && upsertErr.message.includes('E11000'))) {
          // Document was concurrently created; retry updating or pushing into existing document
          classAttDoc = await M.ClassAttendance.findOneAndUpdate(
            {
              classId: targetClassId,
              date: sessionDate,
              $or: [
                { 'periods.periodNumbers': { $in: targetPeriodNumbers } },
                { 'periods.periodNumber': targetPeriodNumbers[0] }
              ]
            },
            {
              $set: {
                'periods.$[elem]': periodObj,
                updatedAt: new Date()
              }
            },
            {
              arrayFilters: [{
                $or: [
                  { 'elem.periodNumbers': { $in: targetPeriodNumbers } },
                  { 'elem.periodNumber': targetPeriodNumbers[0] }
                ]
              }],
              returnDocument: 'after'
            }
          );
          if (!classAttDoc) {
            classAttDoc = await M.ClassAttendance.findOneAndUpdate(
              { classId: targetClassId, date: sessionDate },
              {
                $push: { periods: periodObj },
                $set: { updatedAt: new Date() }
              },
              { returnDocument: 'after' }
            );
          }
        } else {
          throw upsertErr;
        }
      }
    }

    // Sync student counters asynchronously
    for (const stTrackId of affectedTrackIds) {
      await syncStudentAttendanceCounters(stTrackId, targetClassId);
    }

    // Trigger Live Day ClassSession hook for real-time Live Board updates and on-time evaluation
    try {
      const pRecords = periodObj.records || [];
      const pCount = pRecords.filter(r => r.status === 'P').length;
      const abCount = pRecords.filter(r => r.status === 'AB').length;
      const odCount = pRecords.filter(r => r.reason === 'od').length;
      const leaveCount = pRecords.filter(r => r.reason === 'leave').length;

      onAttendanceSaved({
        sessionId: sessionDoc ? sessionDoc._id : undefined,
        classId: targetClassId,
        date: dateInput,
        periodNumber: periodNumInput,
        savedBy: markedBy,
        counts: {
          present: pCount,
          absent: abCount,
          od: odCount,
          leave: leaveCount,
          total: pRecords.length
        }
      }).catch(hookErr => console.warn('[Attendance Save Hook Error]:', hookErr.message));
    } catch (e) {
      console.warn('[Attendance Hook Invocation Error]:', e.message);
    }
    // Consolidated Daily Class Attendance Logging (1 log per class per day, appended with period changes & student reg numbers)
    const dateStr = dateInput;
    const className = cls ? (cls.name || cls.classTrackId || targetClassId) : targetClassId;
    const teacherName = (req.user.firstName && req.user.lastName)
      ? `${req.user.firstName} ${req.user.lastName}`.trim()
      : (req.user.fullName || req.user.name || req.user.username || 'Teacher');
    const teacherSessionId = req.user.sessionId || (req.session && req.session.sessionId) || '';

    try {
      // Determine capture method
      let captureMethod = 'Manual';
      if (req.body.quickPassSessionId) captureMethod = 'QuickPass Code';
      else if (req.body.scanLiveSessionId) captureMethod = 'Live QR';
      else if (req.body.repShareSessionId) captureMethod = 'Rep Share';
      else if (req.body.method && typeof req.body.method === 'string') captureMethod = req.body.method;

      // Build student records with register numbers
      const periodStudentRecords = [];
      let presentCount = 0;
      let absentCount = 0;
      let odCount = 0;

      for (const rec of formattedRecords) {
        const sObj = studentLookup.get(rec.studentTrackId);
        const regNo = sObj?.registerNo || sObj?.regNo || rec.studentTrackId;
        const sName = sObj?.fullName || sObj?.name || rec.studentTrackId;
        const status = rec.status || 'P';

        if (status === 'P' || status === 'PRESENT') presentCount++;
        else if (status === 'OD' || status === 'ON DUTY') odCount++;
        else absentCount++;

        periodStudentRecords.push({
          studentTrackId: rec.studentTrackId,
          regNo,
          name: sName,
          status
        });
      }

      const periodStats = {
        total: formattedRecords.length,
        present: presentCount,
        absent: absentCount,
        od: odCount
      };

      const periodLogObj = {
        periodNumber: periodNumInput,
        periodNumbers: targetPeriodNumbers,
        subjectTrackId: targetSubjectTrackId,
        subjectName: (sub && sub.name) ? `${sub.name} (${targetSubjectTrackId})` : targetSubjectTrackId,
        teacherTrackId,
        teacherName,
        teacherSessionId,
        method: captureMethod,
        topic: req.body.topic || req.body.remarks || '',
        markedAt: new Date(),
        stats: periodStats,
        records: periodStudentRecords,
        history: [{
          action: 'Initial Marking',
          teacherTrackId,
          teacherName,
          teacherSessionId,
          method: captureMethod,
          changedAt: new Date(),
          summary: `Marked ${presentCount}/${formattedRecords.length} Present via ${captureMethod}`
        }]
      };

      const dateStr = dateInput;
      const className = cls ? (cls.name || cls.classTrackId || targetClassId) : targetClassId;

      const existingDailyClassLog = await M.Log.findOne({
        category: 'attendance',
        subType: 'attendance',
        'attendanceClassDaily.classId': String(targetClassId),
        'attendanceClassDaily.date': dateStr
      });

      if (existingDailyClassLog && existingDailyClassLog.attendanceClassDaily) {
        const periods = existingDailyClassLog.attendanceClassDaily.periods || [];
        const existingPIdx = periods.findIndex(p =>
          p.periodNumber === periodNumInput ||
          (Array.isArray(p.periodNumbers) && p.periodNumbers.some(n => targetPeriodNumbers.includes(n)))
        );

        if (existingPIdx >= 0) {
          // Existing period updated: calculate changes
          const oldPeriod = periods[existingPIdx];
          const oldRecords = oldPeriod.records || [];
          const changesSummary = [];

          periodStudentRecords.forEach(newRec => {
            const oldRec = oldRecords.find(o => o.studentTrackId === newRec.studentTrackId);
            if (oldRec && oldRec.status !== newRec.status) {
              changesSummary.push(`${newRec.regNo} (${oldRec.status} -> ${newRec.status})`);
            }
          });

          const updateSummary = changesSummary.length > 0
            ? `Updated ${changesSummary.length} student(s): ${changesSummary.slice(0, 5).join(', ')}${changesSummary.length > 5 ? '…' : ''}`
            : `Re-saved period by ${teacherName} (${presentCount}/${formattedRecords.length} Present)`;

          const updatedHistory = (oldPeriod.history || []).concat([{
            action: 'Updated',
            teacherTrackId,
            teacherName,
            teacherSessionId,
            method: captureMethod,
            changedAt: new Date(),
            summary: updateSummary
          }]);

          periodLogObj.history = updatedHistory;
          periods[existingPIdx] = periodLogObj;
        } else {
          periods.push(periodLogObj);
          periods.sort((a, b) => a.periodNumber - b.periodNumber);
        }

        existingDailyClassLog.attendanceClassDaily.periods = periods;
        existingDailyClassLog.time = new Date();
        existingDailyClassLog.sessionId = teacherSessionId;
        existingDailyClassLog.userName = teacherName;
        existingDailyClassLog.role = req.user.role || 'teacher';
        existingDailyClassLog.details = `Class ${className} attendance updated on ${dateStr}. Period ${periodNumInput} marked via ${captureMethod} by ${teacherName} (${presentCount}/${formattedRecords.length} Present). Session: ${teacherSessionId}`;
        await existingDailyClassLog.save();
      } else {
        // Create brand new daily class attendance log
        await logAction(
          teacherTrackId,
          teacherName,
          req.user.role || 'teacher',
          'Class Attendance Marked',
          `Class ${className} on ${dateStr} - Period ${periodNumInput} marked via ${captureMethod} by ${teacherName} (${presentCount}/${formattedRecords.length} Present). Session: ${teacherSessionId}`,
          'attendance',
          'info',
          req.ip,
          teacherSessionId,
          {
            module: 'teacher',
            subType: 'attendance',
            trackId: teacherTrackId,
            actingWithAdminRights: req.user.actingWithAdminRights,
            attendanceClassDaily: {
              classId: String(targetClassId),
              className: className,
              date: dateStr,
              periods: [periodLogObj]
            },
            req
          }
        );
      }
    } catch (attLogErr) {
      console.error('[Class Daily Attendance Log Error]:', attLogErr.message);
    }

    if (assignCheck && assignCheck.via === 'substitution') {
      try {
        await logAction(
          teacherTrackId,
          teacherName,
          req.user.role || 'teacher',
          'Substitute Attendance Marked',
          `Attendance marked via substitution for Class ${className} on ${dateStr}, Period ${periodNumInput}`,
          'attendance',
          'info',
          req.ip,
          teacherSessionId,
          {
            module: 'attendance',
            subType: 'substitute-mark',
            classId: String(targetClassId),
            date: dateStr,
            periodNumber: periodNumInput,
            overrideId: assignCheck.overrideId,
            req
          }
        );
      } catch (subLogErr) {
        console.error('[Substitute Mark Log Error]:', subLogErr.message);
      }
    }

    // Update draft sessions to final saved status if associated
    try {
      if (req.body.quickPassSessionId) {
        await M.QuickPassSession.updateOne(
          { $or: [{ _id: req.body.quickPassSessionId }, { sessionTrackId: req.body.quickPassSessionId }] },
          { isFinalSaved: true }
        );
      }
      if (req.body.scanLiveSessionId) {
        await M.ScanLiveSession.updateOne(
          { $or: [{ _id: req.body.scanLiveSessionId }, { sessionTrackId: req.body.scanLiveSessionId }] },
          { isFinalSaved: true }
        );
      }
      if (req.body.repShareSessionId) {
        await M.RepShareSession.updateOne(
          { $or: [{ _id: req.body.repShareSessionId }, { sessionTrackId: req.body.repShareSessionId }] },
          { isFinalSaved: true, status: 'finalized' }
        );
      }
    } catch (sessionFinalErr) {
      console.warn('Error marking draft session finalized:', sessionFinalErr.message);
    }

    res.status(201).json({ ok: true, classAttendanceId: classAttDoc._id, savedCount: formattedRecords.length });
  } catch (err) {
    console.error('Error saving attendance:', err);
    res.status(400).json({ error: err.message });
  }
});

// Bulk delete all attendance (admin only)
router.delete('/all', authMiddleware, requirePage('control', 'delete', { tab: 'data' }), attendanceClearLimiter, async (req, res) => {
  try {
    const res1 = await M.ClassAttendance.deleteMany({});
    const res2 = await M.StudentAttendance.deleteMany({});
    await countService.setCount('attendanceRecords', 0).catch(() => {});
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Attendance Cleared',
      `Deleted ${res1.deletedCount} class sessions`,
      'attendance',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'teacher', subType: 'attendance' }
    );
    res.json({ deleted: res1.deletedCount + res2.deletedCount });
  } catch (e) { return sendError(res, e, 500, 'Failed to process attendance request'); }
});

// Delete attendance records within a date range (inclusive)
router.delete('/clear', authMiddleware, requirePage('control', 'delete', { tab: 'data' }), attendanceClearLimiter, async (req, res) => {
  try {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });
    const start = getStartOfInstitutionDaySync(from);
    const end = getEndOfInstitutionDaySync(to);
    const filter = { date: { $gte: start, $lte: end } };
    const res1 = await M.ClassAttendance.deleteMany(filter);
    const res2 = await M.StudentAttendance.deleteMany(filter);
    if (res1 && res1.deletedCount > 0) { await countService.modifyCount('attendanceRecords', -res1.deletedCount).catch(() => {}); }
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Attendance Cleared (Range)',
      `Deleted ${res1.deletedCount} class sessions from ${from} to ${to}`,
      'attendance',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'teacher', subType: 'attendance' }
    );
    res.json({ deleted: res1.deletedCount + res2.deletedCount });
  } catch (e) { return sendError(res, e, 500, 'Failed to process attendance request'); }
});

// Delete single session/record
router.delete('/:id', authMiddleware, requirePage('admin', 'delete', { tab: 'reports' }), async (req, res) => {
  try {
    const att = await M.ClassAttendance.findById(req.params.id).lean();
    if (att) {
      await M.UndoLog.create({
        collectionName: 'attendance',
        label: `Attendance Session: ${att.className || att.classId || 'Class'} (${att.date ? new Date(att.date).toLocaleDateString('en-IN') : 'Date'}) - Period ${att.period || ''}`,
        snapshot: att,
        deletedBy: req.user?.name || req.user?.username || 'admin',
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      }).catch(err => console.warn('[UndoLog Error]:', err.message));
      await M.ClassAttendance.findByIdAndDelete(req.params.id);
      await countService.modifyCount('attendanceRecords', -1).catch(() => {});
    }
    res.json({ deleted: true });
  } catch (e) { return sendError(res, e, 500, 'Failed to process attendance request'); }
});

router.get('/unmarked-teachers', authMiddleware, requirePage('admin', 'view', { tab: 'reports' }), async (req, res) => {
  try {
    const todayStr = await todayInInstitutionTz();
    const [tY, tM, tD] = todayStr.split('-').map(Number);
    const today = new Date(tY, tM - 1, tD);
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const weekDates = Array.from({ length: 5 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return todayIST(d); });
    const assignments = await M.Assignment.find().lean();
    const startMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate());
    const endFriday = new Date(startMonday.getTime() + 5 * 86400000);
    const classAttDocs = await M.ClassAttendance.find({
      $or: [
        { date: { $gte: startMonday, $lte: endFriday } },
        { date: { $gte: weekDates[0], $lte: weekDates[4] } }
      ]
    }).select('classId date periods.teacherTrackId').lean();

    const unmarked = [];
    for (const a of assignments) {
      const markedDates = [];
      for (const doc of classAttDocs) {
        const docDateStr = doc.date ? (typeof doc.date === 'string' ? doc.date.split('T')[0] : todayIST(doc.date)) : '';
        if (doc.classId === a.classId || doc.classId === a.classTrackId) {
          for (const p of doc.periods || []) {
            if (p.teacherTrackId === a.teacherId || p.teacherTrackId === a.teacherTrackId) {
              markedDates.push(docDateStr);
            }
          }
        }
      }
      const missingDays = weekDates.filter(d => !markedDates.includes(d));
      if (missingDays.length > 0) unmarked.push({ ...a, missingDays, missingCount: missingDays.length });
    }
    res.json(unmarked);
  } catch (err) {
    return sendError(res, err, 500, 'Failed to process attendance request');
  }
});

module.exports = router;
