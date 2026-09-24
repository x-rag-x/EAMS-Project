const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const ExcelJS = require('exceljs');
const M = require('../models');
const cfg = require('../config');
const { authMiddleware, adminOnly, requireRight } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const upload = multer({ storage: multer.memoryStorage() });

// GET /api/students -> Fetch students (paginated, sortable)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const filter = {};
    if (req.query.deptId)       filter.deptId       = sanitizeToString(req.query.deptId);
    if (req.query.classId)      filter.classId      = sanitizeToString(req.query.classId);
    if (req.query.section)      filter.section      = sanitizeToString(req.query.section);
    if (req.query.academicYear) {
      const yr = sanitizeToString(req.query.academicYear);
      const altYr = yr.includes('-') && yr.length === 9
        ? yr.replace(/-(\d{4})$/, function (_, y) { return '-' + y.slice(-2); })
        : (yr.includes('-') && yr.length === 7
          ? yr.replace(/^(\d{4})-(\d{2})$/, function (_, y1, y2) { return y1 + '-' + y1.slice(0, 2) + y2; })
          : yr);
      filter.admissionYear = { $in: [yr, altYr] };
    }
    if (req.query.batch) {
      const b = sanitizeToString(req.query.batch);
      const altB = b.includes('-') && b.length === 9
        ? b.replace(/-(\d{4})$/, function (_, y) { return '-' + y.slice(-2); })
        : (b.includes('-') && b.length === 7
          ? b.replace(/^(\d{4})-(\d{2})$/, function (_, y1, y2) { return y1 + '-' + y1.slice(0, 2) + y2; })
          : b);

      const m = b.match(/^(\d{4})-(\d{2,4})$/);
      const trackId = m ? ('TR-BATCH-' + m[1].slice(-2) + m[2].slice(-2)) : '';
      const batchValues = [b, altB, trackId].filter(Boolean);

      const matchingClasses = await M.Class.find({ batch: { $in: [b, altB] } }).select('_id').lean();
      const matchingClassIds = matchingClasses.map(function (c) { return c._id; });

      const batchConditions = [
        { batchTrackId: { $in: batchValues } },
        { batch: { $in: [b, altB] } }
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

router.post('/', authMiddleware, adminOnly, requireRight('adderModules'), async (req, res) => {
  try {
    const { name, regNo, academicYear, courseType, branch, deptId, deptName, classId, className, section, email, username, password, isRep, batch, batchTrackId } = req.body;
    
    // Check if student exists
    const exists = await M.Student.findOne({ registerNo: regNo });
    if (exists) return res.status(400).json({ error: 'Student with this Register No already exists' });

    const generatedTrackId = 'TRSTU_' + Math.random().toString(36).substr(2, 9).toUpperCase();
    
    const defaultPassword = password || cfg.STUDENT_PASSWORD;
    const hash = await bcrypt.hash(defaultPassword, cfg.BCRYPT_ROUNDS);

    const generatedUsername = username || regNo.toLowerCase();

    let resolvedBatch = (batch || '').trim();
    let resolvedBatchTrackId = (batchTrackId || '').trim();
    if (!resolvedBatch && classId) {
      const clsDoc = await M.Class.findById(classId).lean();
      if (clsDoc && clsDoc.batch) resolvedBatch = clsDoc.batch;
    }
    if (!resolvedBatchTrackId && resolvedBatch) {
      const m = resolvedBatch.match(/^(\d{4})-(\d{2,4})$/);
      if (m) resolvedBatchTrackId = 'TR-BATCH-' + m[1].slice(-2) + m[2].slice(-2);
    }

    const stu = await M.Student.create({
      fullName: name,
      registerNo: regNo,
      class: className || '',
      classId,
      section: section || 'A',
      courseType: courseType || 'UG',
      branch: branch || 'None',
      department: deptName || '',
      deptId,
      admissionYear: academicYear || '',
      batch: resolvedBatch,
      batchTrackId: resolvedBatchTrackId,
      email: email || '',
      username: generatedUsername,
      password: hash,
      trackId: generatedTrackId,
      isRep: !!isRep,
      mustChangePassword: true
    });

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
    res.status(201).json({ ...stu.toObject(), name: stu.fullName, regNo: stu.registerNo });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, regNo, academicYear, courseType, branch, deptId, deptName, classId, className, section, email, username, password, isRep, active, status, batch, batchTrackId } = req.body;
    
    const stu = await M.Student.findById(req.params.id);
    if (!stu) return res.status(404).json({ error: 'Student not found' });

    const before = stu.toObject();
    delete before.password;

    const oldUsername = stu.username;

    if (name) stu.fullName = name;
    if (regNo) stu.registerNo = regNo;
    if (className !== undefined) stu.class = className;
    if (classId !== undefined) stu.classId = classId;
    if (section !== undefined) stu.section = section;
    if (courseType !== undefined) stu.courseType = courseType;
    if (branch !== undefined) stu.branch = branch;
    if (deptName !== undefined) stu.department = deptName;
    if (deptId !== undefined) stu.deptId = deptId;
    if (academicYear !== undefined) stu.admissionYear = academicYear;
    if (batch !== undefined) stu.batch = batch.trim();
    if (batchTrackId !== undefined) {
      stu.batchTrackId = batchTrackId.trim();
    } else if (batch !== undefined && !stu.batchTrackId) {
      const m = (batch || '').match(/^(\d{4})-(\d{2,4})$/);
      if (m) stu.batchTrackId = 'TR-BATCH-' + m[1].slice(-2) + m[2].slice(-2);
    }
    if (email !== undefined) stu.email = email;
    if (username) stu.username = username.toLowerCase().trim();
    if (isRep !== undefined) stu.isRep = isRep;

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
    res.json({ ...stu.toObject(), name: stu.fullName, regNo: stu.registerNo });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', authMiddleware, adminOnly, requireRight('deletings'), async (req, res) => {
  try {
    const stu = await M.Student.findById(req.params.id);
    if (!stu) return res.status(404).json({ error: 'Student not found' });

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
router.post('/bulk-upload', authMiddleware, adminOnly, requireRight('bulkPage'), upload.single('file'), async (req, res) => {
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
      acadYear = cv(['academicyear', 'ay']), courseType = cv(['coursetype', 'course']).toUpperCase(), 
      branch = cv(['branch']), deptName = cv(['department', 'dept']), className = cv(['class', 'classname']), 
      section = cv(['section', 'sec']), email = cv(['email', 'mail']), username = cv(['username', 'user']), 
      password = cv(['password', 'pass']);
      
      const rowErrors = [];
      if (!name) rowErrors.push('FullName missing');
      if (!regNo) rowErrors.push('RegisterNo missing');
      if (!deptName) rowErrors.push('Department missing');
      if (!acadYear) rowErrors.push('AcademicYear missing');
      if (!courseType) rowErrors.push('CourseType missing');
      if (!branch) rowErrors.push('Branch missing');
      if (!className) rowErrors.push('Class missing');
      if (!section) rowErrors.push('Section missing');
      if (!email) rowErrors.push('Email missing');
      if (!username) rowErrors.push('Username missing');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowErrors.push('Invalid email');
      if (VALID_COURSE_TYPES.indexOf(courseType) === -1) rowErrors.push(`CourseType "${courseType}" unknown`);
      if (await M.Student.findOne({ registerNo: regNo })) rowErrors.push(`RegisterNo ${regNo} already exists`);
      if (username && await M.User.findOne({ username: username.toLowerCase() })) rowErrors.push(`Username "${username}" taken`);
      if (rowErrors.length) { skipped++; errors.push({ row: i + 2, name: name || '(blank)', issues: rowErrors }); continue; }
      const dept = await M.Department.findOne({ $or: [{ name: new RegExp(escapeRegex(deptName), 'i') }, { code: new RegExp(escapeRegex(deptName), 'i') }] });
      if (!dept) { skipped++; errors.push({ row: i + 2, name, issues: [`Department "${deptName}" not found`] }); continue; }
      const cls = await M.Class.findOne({ name: className }).lean();

      const generatedTrackId = 'TRSTU_' + Math.random().toString(36).substr(2, 9).toUpperCase();
      const defaultPassword = password || cfg.STUDENT_PASSWORD;
      const hash = await bcrypt.hash(defaultPassword, cfg.BCRYPT_ROUNDS);
      const generatedUsername = username || regNo.toLowerCase();

      let createdStudent;
      try {
        createdStudent = await M.Student.create({
          fullName: name, registerNo: regNo, class: className || cls?.name || '', classId: cls?._id, section,
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