const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('@node-rs/bcrypt');
const multer = require('multer');
const ExcelJS = require('exceljs');
const M = require('../models');
const cfg = require('../config');
const { authMiddleware, requirePage, scopeFilter, assertInScope, isSudo } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { normalizeYearRange, isValidYearRange, toBatchTrackId, buildStudentTrackId } = require('../utils/yearFormat');
const { sanitizeFullName, splitFirstLastName } = require('../utils/nameFormat');
const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const upload = multer({ storage: multer.memoryStorage() });

// GET /api/students -> Fetch students (paginated, sortable)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const filter = {};

    // ── R2.4 / A5 Scope Enforcement ──
    if (req.user.role === 'student') {
      filter.$or = [
        { _id: req.user._id },
        { trackId: req.user.trackId },
        { registerNo: req.user.registerNo }
      ];
    } else if (isSudo(req)) {
      if (req.query.deptId) {
        const qDeptId = sanitizeToString(req.query.deptId);
        if (mongoose.Types.ObjectId.isValid(qDeptId)) {
          filter.$or = [{ deptId: qDeptId }, { deptId: new mongoose.Types.ObjectId(qDeptId) }];
        } else {
          filter.deptId = qDeptId;
        }
      }
    } else if (req.access && (req.access.flags?.isSuper || req.access.pages?.admin || req.access.flags?.isHod)) {
      let userDeptId = req.access.pages?.admin?.deptId || req.user.deptId || null;
      let userDeptName = req.access.pages?.admin?.dept || req.user.department || req.user.deptName || '';

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

      if (req.query.deptId) {
        const qDeptId = sanitizeToString(req.query.deptId);
        const isMatch = (userDeptId && String(qDeptId) === String(userDeptId)) ||
                        (userDeptName && qDeptId.toLowerCase() === userDeptName.toLowerCase());
        if ((userDeptId || userDeptName) && !isMatch) {
          return res.status(403).json({ error: 'Access denied: cannot query students outside assigned department' });
        }
      }

      const deptConditions = [];
      if (userDeptId) {
        deptConditions.push({ deptId: userDeptId });
        if (mongoose.Types.ObjectId.isValid(userDeptId)) {
          deptConditions.push({ deptId: new mongoose.Types.ObjectId(userDeptId) });
        }
      }
      if (userDeptName) {
        const escapedDept = userDeptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        deptConditions.push({ department: { $regex: new RegExp(`^${escapedDept}$`, 'i') } });
      }

      if (deptConditions.length > 0) {
        if (filter.$or) {
          filter.$and = filter.$and || [];
          filter.$and.push({ $or: filter.$or }, { $or: deptConditions });
          delete filter.$or;
        } else {
          filter.$or = deptConditions;
        }
      }
    } else {
      // Regular staff: only students in classes taught or advised by this teacher
      const staffClasses = await M.Class.find({
        $or: [
          { advisorTeacherId: req.user._id },
          { advisorTeacherTrackId: req.user.trackId },
          { 'subjectTeachers.teacherId': req.user._id },
          { 'subjectTeachers.teacherTrackId': req.user.trackId }
        ]
      }).select('_id').lean();
      const staffClassIds = staffClasses.map(c => c._id);
      if (staffClassIds.length === 0) {
        return res.json(req.query.roster === '1' ? [] : { students: [], total: 0, page: 1, totalPages: 0 });
      }
      filter.classId = { $in: staffClassIds };
      if (req.query.deptId) filter.deptId = sanitizeToString(req.query.deptId);
    }

    if (req.query.classId)      filter.classId      = sanitizeToString(req.query.classId);
    if (req.query.academicYear) {
      const yr = sanitizeToString(req.query.academicYear);
      const normYr = normalizeYearRange(yr);
      const altYr = normYr.includes('-') && normYr.length === 9
        ? normYr.replace(/-(\d{4})$/, function (_, y) { return '-' + y.slice(-2); })
        : normYr;
      filter.admissionYear = { $in: [normYr, yr, altYr].filter(Boolean) };
    }
    if (req.query.batch) {
      const b = sanitizeToString(req.query.batch);
      const normB = normalizeYearRange(b);
      const altB = normB.includes('-') && normB.length === 9
        ? normB.replace(/-(\d{4})$/, function (_, y) { return '-' + y.slice(-2); })
        : normB;

      const trackId = toBatchTrackId(normB);
      const batchValues = [normB, b, altB, trackId].filter(Boolean);

      const matchingClasses = await M.Class.find({ batch: { $in: [normB, b, altB] } }).select('_id').lean();
      const matchingClassIds = matchingClasses.map(function (c) { return c._id; });

      const batchConditions = [
        { batchTrackId: { $in: batchValues } },
        { batch: { $in: [normB, b, altB] } }
      ];
      if (matchingClassIds.length > 0) {
        batchConditions.push({ classId: { $in: matchingClassIds } });
      }

      if (filter.$or) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: filter.$or }, { $or: batchConditions });
        delete filter.$or;
      } else {
        filter.$or = batchConditions;
      }
    }
    if (req.query.courseType)   filter.courseType   = sanitizeToString(req.query.courseType);
    if (req.query.residency) {
      const resVal = sanitizeToString(req.query.residency).toLowerCase().trim();
      filter.residency = resVal.includes('hostel') ? 'hostel' : 'dayscholar';
    }
    if (req.query.gender) {
      const gVal = sanitizeToString(req.query.gender).toLowerCase().trim();
      filter.gender = gVal === 'female' ? 'Female' : 'Male';
    }

    // Lightweight roster mode — only name + regNo, no shadow user join
    if (req.query.roster === '1') {
      const roster = await M.Student.find(filter).sort({ registerNo: 1 })
        .select('fullName registerNo').lean();
      return res.json(roster.map(function (s) {
        return { name: s.fullName, regNo: s.registerNo };
      }));
    }

    // Parse pagination & sorting
    var page    = Math.max(1, parseInt(req.query.page, 10) || 1);
    var limit   = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 60));
    var sortBy  = req.query.sortBy === 'fullName' ? 'fullName' : 'registerNo';
    var sortDir = req.query.sortDir === 'desc' ? -1 : 1;

    var total = await M.Student.countDocuments(filter);
    var list  = await M.Student.find(filter)
      .sort({ [sortBy]: sortDir })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-password')
      .lean();

    var trackIds = list.map(function (s) { return s.trackId; });
    var shadowUsers = trackIds.length
      ? await M.User.find({ trackId: { $in: trackIds } }).lean()
      : [];
    var shadowMap = new Map(shadowUsers.map(function (u) { return [u.trackId, u]; }));

    var students = list.map(function (s) {
      var shadow = shadowMap.get(s.trackId);
      return {
        ...s,
        name: s.fullName,
        regNo: s.registerNo,
        deptName: s.department,
        academicYear: s.admissionYear,
        className: s.class,
        gender: s.gender || 'Male',
        residency: s.residency || 'dayscholar',
        active: shadow ? shadow.status === 'active' : true,
        status: shadow ? shadow.status : 'active'
      };
    });

    res.json({ data: students, total: total, page: page, hasMore: page * limit < total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/count', authMiddleware, async (req, res) => {
  res.json({ count: await M.Student.countDocuments() });
});

// GET /api/students/exam-search -> Search students for exam hall assignment
router.get('/exam-search', authMiddleware, async (req, res) => {
  try {
    const { q, depts, year } = req.query;
    if (!q || q.trim().length < 3) {
      return res.json([]);
    }

    const filter = {
      $or: [
        { fullName: new RegExp(escapeRegex(q), 'i') },
        { registerNo: new RegExp(escapeRegex(q), 'i') }
      ]
    };

    // Filter by departments if provided
    if (depts) {
      const deptList = depts.split(',').map(d => d.trim()).filter(Boolean);
      if (deptList.length > 0) {
        filter.department = { $in: deptList.map(d => new RegExp(escapeRegex(d), 'i')) };
      }
    }

    // Fetch students and populate classId to filter by year
    let students = await M.Student.find(filter).populate('classId').lean();

    // Filter by year if provided
    if (year) {
      // Map year (I, II, III, IV) to class year or match directly
      const romanToWord = { 'I': 'I Year', 'II': 'II Year', 'III': 'III Year', 'IV': 'IV Year' };
      const targetYearWord = romanToWord[year.toUpperCase()] || year;
      students = students.filter(s => {
        const classYear = s.classId?.year || '';
        return classYear.toLowerCase().includes(targetYearWord.toLowerCase()) || 
               classYear.toLowerCase().includes(year.toLowerCase());
      });
    }

    // Map to frontend expected structure
    const mapped = students.map(s => ({
      _id: s._id,
      trackId: s.trackId,
      name: s.fullName,
      regNo: s.registerNo,
      deptName: s.department,
      year: s.classId?.year || s.class || '',
      className: s.class
    }));

    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/students/:id -> Fetch single student by ID, trackId, or registerNo
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const rawId = sanitizeToString(req.params.id);
    let student = null;
    if (mongoose.isValidObjectId(rawId)) {
      student = await M.Student.findById(rawId)
        .populate('classId')
        .populate('deptId')
        .select('-password')
        .lean();
    }
    if (!student) {
      student = await M.Student.findOne({ $or: [{ trackId: rawId }, { registerNo: rawId }] })
        .populate('classId')
        .populate('deptId')
        .select('-password')
        .lean();
    }
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const shadow = await M.User.findOne({ trackId: student.trackId }).lean();
    const cleanFullName = sanitizeFullName(student.fullName || student.name || '');
    const nameSplit = splitFirstLastName(cleanFullName);
    const sFn = sanitizeFullName(student.firstName || '');
    const sLn = sanitizeFullName(student.lastName || '');
    const isInverted = sLn && nameSplit.firstName && (sLn.toLowerCase() === nameSplit.firstName.toLowerCase() || sFn.toLowerCase().includes(nameSplit.lastName.toLowerCase()));
    const finalFn = (!sFn || isInverted) ? nameSplit.firstName : sFn;
    const finalLn = (!sLn || isInverted) ? nameSplit.lastName : sLn;

    const mapped = {
      ...student,
      name: cleanFullName,
      fullName: cleanFullName,
      firstName: finalFn,
      lastName: finalLn,
      regNo: student.registerNo,
      registerNo: student.registerNo,
      deptName: (student.deptId && student.deptId.name) || student.department || '',
      department: (student.deptId && student.deptId.name) || student.department || '',
      academicYear: student.admissionYear,
      admissionYear: student.admissionYear,
      className: (student.classId && student.classId.name) || student.class || '',
      class: (student.classId && student.classId.name) || student.class || '',
      deptId: (student.deptId && student.deptId._id) ? String(student.deptId._id) : (student.deptId || ''),
      classId: (student.classId && student.classId._id) ? String(student.classId._id) : (student.classId || ''),
      gender: student.gender || 'Male',
      residency: student.residency || 'dayscholar',
      active: shadow ? shadow.status === 'active' : true,
      status: shadow ? shadow.status : 'active'
    };

    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authMiddleware, requirePage('admin', 'create', { tab: 'students' }), async (req, res) => {
  try {
    if (req.scope && req.scope.type === 'department' && req.scope.deptId) {
      if (req.body.deptId && String(req.body.deptId) !== String(req.scope.deptId)) {
        return res.status(403).json({ error: 'Access denied: cannot create student for another department' });
      }
      req.body.deptId = req.scope.deptId;
      if (!req.body.deptName && req.scope.deptName) {
        req.body.deptName = req.scope.deptName;
      }
      if (req.body.classId) {
        const clsDoc = await M.Class.findById(req.body.classId).lean();
        if (clsDoc && clsDoc.deptId && String(clsDoc.deptId) !== String(req.scope.deptId)) {
          return res.status(403).json({ error: 'Access denied: cannot assign student to a class in another department' });
        }
      }
    }
    const { name, regNo, trackId, academicYear, courseType, branch, deptId, deptName, classId, className, email, username, password, isRep, batch, batchTrackId, firstName, lastName, residency, gender } = req.body;
    const cleanFullName = sanitizeFullName(name);
    const splitNames = splitFirstLastName(cleanFullName);
    const finalFirstName = (firstName ? sanitizeFullName(firstName) : splitNames.firstName) || '';
    const finalLastName = (lastName !== undefined && lastName !== null && String(lastName).trim() !== '') ? sanitizeFullName(lastName) : splitNames.lastName;
    
    const cleanUsername = (username || regNo || '').toLowerCase().trim();
    if (!cleanUsername) return res.status(400).json({ error: 'Username or Register No is required' });
    if (cleanUsername.startsWith('sb-') || cleanUsername.startsWith('tr-')) {
      return res.status(400).json({ error: "Username prefixes 'SB-' and 'TR-' are reserved for smart board device IDs" });
    }

    // Check if student with registerNo or username already exists
    const [existsRegNo, existsUser] = await Promise.all([
      M.Student.findOne({ registerNo: regNo }).lean(),
      M.User.findOne({ username: cleanUsername }).lean()
    ]);
    if (existsRegNo) return res.status(400).json({ error: 'Student with this Register No already exists' });
    if (existsUser) return res.status(400).json({ error: `Username "${cleanUsername}" is already taken` });

    const defaultPassword = password || cfg.STUDENT_PASSWORD;
    const hash = await bcrypt.hash(defaultPassword, cfg.BCRYPT_ROUNDS);

    let resolvedBatch = normalizeYearRange(batch);
    let resolvedAcademicYear = normalizeYearRange(academicYear);
    let resolvedBatchTrackId = (batchTrackId || '').trim();
    if (!resolvedBatch && classId) {
      const clsDoc = await M.Class.findById(classId).lean();
      if (clsDoc && clsDoc.batch) resolvedBatch = normalizeYearRange(clsDoc.batch);
    }
    if (!resolvedBatchTrackId && resolvedBatch) {
      resolvedBatchTrackId = toBatchTrackId(resolvedBatch);
    }

    let finalDeptId = req.body.deptId || deptId;
    let finalDeptName = deptName || req.body.deptName || '';
    if (!finalDeptName && finalDeptId) {
      const dDoc = await M.Department.findById(finalDeptId).lean();
      if (dDoc) finalDeptName = dDoc.name;
    }

    const allDepts = await M.Department.find({}).lean();
    const generatedTrackId = (trackId && !trackId.startsWith('TRSTU_') && !trackId.startsWith('STU'))
      ? trackId.trim()
      : buildStudentTrackId(regNo, finalDeptId || finalDeptName, resolvedBatch, resolvedAcademicYear, allDepts);

    let stu;
    try {
      stu = await M.Student.create({
        fullName: cleanFullName,
        firstName: finalFirstName,
        lastName: finalLastName,
        registerNo: regNo,
        class: className || '',
        classId,
        courseType: courseType || 'UG',
        branch: branch || 'None',
        department: finalDeptName || '',
        deptId: finalDeptId || null,
        admissionYear: resolvedAcademicYear || '',
        batch: resolvedBatch,
        batchTrackId: resolvedBatchTrackId,
        gender: (gender && String(gender).toLowerCase() === 'female') ? 'Female' : 'Male',
        residency: (residency && String(residency).toLowerCase().includes('hostel')) ? 'hostel' : 'dayscholar',
        email: email || '',
        username: cleanUsername,
        password: hash,
        trackId: generatedTrackId,
        isRep: !!isRep,
        mustChangePassword: true
      });
      await M.User.create({
        username: cleanUsername,
        role: 'student',
        trackId: generatedTrackId,
        status: 'active'
      });
    } catch (createErr) {
      if (stu) await M.Student.findByIdAndDelete(stu._id).catch(() => {});
      throw createErr;
    }

    const studentObj = stu.toObject();
    delete studentObj.password;

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Student Added',
      `${stu.fullName} (${stu.registerNo})`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'entry-create',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: null, after: studentObj }
      }
    );
    res.status(201).json({ ...stu.toObject(), name: stu.fullName, regNo: stu.registerNo, firstName: stu.firstName, lastName: stu.lastName, gender: stu.gender || 'Male', residency: stu.residency || 'dayscholar' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', authMiddleware, requirePage('admin', 'edit', { tab: 'students' }), async (req, res) => {
  try {
    const stu = await M.Student.findById(req.params.id);
    if (!stu) return res.status(404).json({ error: 'Student not found' });
    if (!assertInScope(req, stu.deptId)) {
      return res.status(403).json({ error: 'Access denied: student is outside your department scope' });
    }

    const before = stu.toObject();
    delete before.password;

    const oldUsername = stu.username;
    const { name, regNo, className, classId, courseType, branch, deptName, deptId, academicYear, batch, batchTrackId, email, username, isRep, password, active, status, firstName, lastName, residency, gender } = req.body;

    if (name) {
      stu.fullName = sanitizeFullName(name);
      const computed = splitFirstLastName(stu.fullName);
      stu.firstName = (firstName ? sanitizeFullName(firstName) : computed.firstName) || '';
      stu.lastName = (lastName !== undefined && lastName !== null && String(lastName).trim() !== '') ? sanitizeFullName(lastName) : computed.lastName;
    } else {
      if (firstName !== undefined) stu.firstName = sanitizeFullName(firstName);
      if (lastName !== undefined) stu.lastName = sanitizeFullName(lastName);
    }

    if (regNo) stu.registerNo = regNo;
    if (className !== undefined) stu.class = className;
    if (classId !== undefined) stu.classId = classId;
    if (courseType !== undefined) stu.courseType = courseType;
    if (branch !== undefined) stu.branch = branch;
    if (deptName !== undefined) stu.department = deptName;
    if (deptId !== undefined) stu.deptId = deptId;
    if (academicYear !== undefined) stu.admissionYear = normalizeYearRange(academicYear);
    if (batch !== undefined) {
      stu.batch = normalizeYearRange(batch);
      stu.batchTrackId = toBatchTrackId(stu.batch);
    }
    if (batchTrackId !== undefined) {
      stu.batchTrackId = batchTrackId.trim();
    } else if (batch !== undefined && !stu.batchTrackId) {
      stu.batchTrackId = toBatchTrackId(stu.batch);
    }
    if (email !== undefined) stu.email = email;
    if (username) {
      const cleanUsername = username.toLowerCase().trim();
      if (cleanUsername.startsWith('sb-') || cleanUsername.startsWith('tr-')) {
        return res.status(400).json({ error: "Username prefixes 'SB-' and 'TR-' are reserved for smart board device IDs" });
      }
      stu.username = cleanUsername;
    }
    if (isRep !== undefined) stu.isRep = isRep;
    if (gender !== undefined) {
      stu.gender = (String(gender).toLowerCase() === 'female') ? 'Female' : 'Male';
    }
    if (residency !== undefined) {
      stu.residency = (String(residency).toLowerCase().includes('hostel')) ? 'hostel' : 'dayscholar';
    }

    if (password) {
      stu.password = await bcrypt.hash(password, cfg.BCRYPT_ROUNDS);
    }

    await stu.save();

    // Sync shadow user
    let shadowUser = await M.User.findOne({ username: oldUsername, role: 'student' });
    if (shadowUser) {
      if (username) shadowUser.username = username.toLowerCase().trim();
      if (active !== undefined) shadowUser.status = active ? 'active' : 'inactive';
      if (status) shadowUser.status = status;
      await shadowUser.save();
    }

    const after = stu.toObject();
    delete after.password;

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Student Updated',
      stu.fullName,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before, after }
      }
    );
    res.json({ ...stu.toObject(), name: stu.fullName, regNo: stu.registerNo, firstName: stu.firstName, lastName: stu.lastName });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', authMiddleware, requirePage('admin', 'delete', { tab: 'students' }), async (req, res) => {
  try {
    const stu = await M.Student.findById(req.params.id);
    if (!stu) return res.status(404).json({ error: 'Student not found' });
    if (!assertInScope(req, stu.deptId)) {
      return res.status(403).json({ error: 'Access denied: student is outside your department scope' });
    }

    const snapshot = stu.toObject();
    delete snapshot.password;

    await M.UndoLog.create({
      collectionName: 'students', label: `Student: ${stu.fullName} (${stu.registerNo})`,
      snapshot, deletedBy: req.user.name, expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    });
    
    await M.Student.findByIdAndDelete(req.params.id);
    
    // Delete shadow user
    await M.User.deleteOne({ username: stu.username, role: 'student' });

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Student Deleted',
      stu.fullName,
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

// Bulk Upload Students
router.post('/bulk-upload', authMiddleware, requirePage('bulk', 'create'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Parse the uploaded buffer with ExcelJS (replaces the removed xlsx package)
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return res.status(400).json({ error: 'Spreadsheet contains no sheets' });

    // Build a header-name → column-index map from row 1
    const headerRow = worksheet.getRow(1);
    const headers = {}; // colIndex (1-based) -> header string
    headerRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
      headers[colNum] = String(cell.value ?? '').trim();
    });

    // Convert data rows (2 onwards) to plain objects keyed by header name
    const rows = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum === 1) return; // skip header
      const obj = {};
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        const header = headers[colNum];
        if (header) obj[header] = cell.value ?? '';
      });
      rows.push(obj);
    });
    const VALID_COURSE_TYPES = ['UG', 'PG', 'M.E', 'M.TECH', 'B.E', 'B.TECH'];
    let added = 0, skipped = 0, errors = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cv = (keys) => { 
        for (const k of keys) { 
          const found = Object.keys(row).find(r => r.toLowerCase().replace(/\s/g, '').includes(k.toLowerCase())); 
          if (found) return String(row[found]).trim(); 
        } return ''; 
      };

      const name = cv(['fullname', 'name', 'studentname']), regNo = cv(['registerno', 'regno', 'rollno']), 
      gender = cv(['gender', 'sex']), batch = cv(['batch', 'batchname']),
      acadYear = cv(['academicyear', 'ay']), courseType = cv(['coursetype', 'course']).toUpperCase(), 
      branch = cv(['branch']), deptName = cv(['department', 'dept']), className = cv(['class', 'classname']), 
      email = cv(['email', 'mail']), username = cv(['username', 'user']), 
      password = cv(['password', 'pass']);
      
      const normalizedGender = gender ? (gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase()) : '';
      const rowErrors = [];
      if (!name) rowErrors.push('FullName missing');
      if (!regNo) rowErrors.push('RegisterNo missing');
      if (!gender) rowErrors.push('Gender missing');
      else if (!['Male', 'Female'].includes(normalizedGender)) rowErrors.push('Gender must be Male or Female');
      if (!batch) rowErrors.push('Batch missing');
      if (!deptName) rowErrors.push('Department missing');
      if (!acadYear) rowErrors.push('AcademicYear missing');
      if (!courseType) rowErrors.push('CourseType missing');
      if (!branch) rowErrors.push('Branch missing');
      if (!className) rowErrors.push('Class missing');
      if (!email) rowErrors.push('Email missing');
      if (!username) rowErrors.push('Username missing');
      if (username && (username.toLowerCase().trim().startsWith('sb-') || username.toLowerCase().trim().startsWith('tr-'))) rowErrors.push("Username prefixes 'SB-' and 'TR-' are reserved for smart board device IDs");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowErrors.push('Invalid email');
      if (VALID_COURSE_TYPES.indexOf(courseType) === -1) rowErrors.push(`CourseType "${courseType}" unknown`);
      if (await M.Student.findOne({ registerNo: regNo })) rowErrors.push(`RegisterNo ${regNo} already exists`);
      if (username && await M.User.findOne({ username: username.toLowerCase() })) rowErrors.push(`Username "${username}" taken`);
      if (rowErrors.length) { skipped++; errors.push({ row: i + 2, name: name || '(blank)', issues: rowErrors }); continue; }
      const dept = await M.Department.findOne({ $or: [{ name: new RegExp(escapeRegex(deptName), 'i') }, { code: new RegExp(escapeRegex(deptName), 'i') }] });
      if (!dept) { skipped++; errors.push({ row: i + 2, name, issues: [`Department "${deptName}" not found`] }); continue; }
      if (!assertInScope(req, dept._id, 'bulk')) {
        skipped++;
        errors.push({ row: i + 2, name, issues: ['Cross-department upload forbidden: department outside scope'] });
        continue;
      }
      const cls = await M.Class.findOne({ name: className }).lean();

      const generatedTrackId = buildStudentTrackId(regNo, dept, batch, acadYear);
      const defaultPassword = password || cfg.STUDENT_PASSWORD;
      const hash = await bcrypt.hash(defaultPassword, cfg.BCRYPT_ROUNDS);
      const generatedUsername = username || regNo.toLowerCase();

      let createdStudent;
      try {
        createdStudent = await M.Student.create({
          fullName: name, registerNo: regNo, gender: normalizedGender, batch, class: className || cls?.name || '', classId: cls?._id,
          courseType, branch, department: dept.name, deptId: dept._id, admissionYear: acadYear,
          email, username: generatedUsername, password: hash, trackId: generatedTrackId, isRep: false,
          mustChangePassword: true
        });
        await M.User.create({ username: generatedUsername, role: 'student', trackId: generatedTrackId, status: 'active' });
      } catch (rowErr) {
        // A bad row (e.g. duplicate key slipping past the pre-checks above,
        // or a validation error) must not abort every row after it — undo
        // the student doc if the shadow user failed so we don't leave an
        // orphaned account with no login, then record it and move on.
        if (createdStudent) await M.Student.findByIdAndDelete(createdStudent._id).catch(() => {});
        skipped++;
        errors.push({ row: i + 2, name, issues: [rowErr.message] });
        continue;
      }
      added++;
    }
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role, 
      'Bulk Student Upload',
      `${added} added, ${skipped} skipped`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'bulk-action',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights
      }
    );
    res.json({ added, skipped, total: rows.length, errors: errors.slice(0, 20), message: `Import complete: ${added} added, ${skipped} skipped` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;