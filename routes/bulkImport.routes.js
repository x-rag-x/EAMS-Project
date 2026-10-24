const express = require('express');
const router = express.Router();
const multer = require('multer');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const bcrypt = require('@node-rs/bcrypt');
const crypto = require('crypto');
const M = require('../models');
const cfg = require('../config');
const { authMiddleware, requirePage, assertInScope } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { isSudoAdmin } = require('../utils/access');
const { sendWelcomeCredentialsMail } = require('../utils/mailer');
const { uploadBulkBackupZip } = require('../utils/driveStore');
const { createBatchFolder, uploadBufferToDrive } = require('../utils/googleDrive');
const { normalizeYearRange, isValidYearRange, toBatchTrackId, buildStudentTrackId } = require('../utils/yearFormat');
const { sanitizeFullName, splitFirstLastName } = require('../utils/nameFormat');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB max
});

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fuzzy column lookup helper
 */
function getColVal(row, keys) {
  const rowKeys = Object.keys(row);
  for (const k of keys) {
    const found = rowKeys.find(r => r.toLowerCase().replace(/[\s_\-]/g, '').includes(k.toLowerCase().replace(/[\s_\-]/g, '')));
    if (found && row[found] !== undefined && row[found] !== null) {
      return String(row[found]).trim();
    }
  }
  return '';
}

/**
 * Count total student and teacher verifications performed across the system in the last 24 hours
 */
async function get24HourVerificationCount() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await M.BulkImportBatch.aggregate([
    { $match: { type: { $in: ['student', 'teacher'] } } },
    { $unwind: '$eligibleRows' },
    {
      $match: {
        'eligibleRows.isVerified': true,
        'eligibleRows.devBypass': { $ne: true },
        'eligibleRows.verifiedAt': { $ne: null, $gte: twentyFourHoursAgo }
      }
    },
    { $count: 'total' }
  ]);
  return (result[0] && result[0].total) ? result[0].total : 0;
}

/**
 * Generates an 8-character uppercase alphanumeric track ID (e.g. TR-BATCH-MVDFA9BM)
 */
function generateBatchTrackId() {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 8; i++) {
    rand += chars[crypto.randomInt(0, chars.length)];
  }
  return `TR-BATCH-${rand}`;
}

/**
 * Parses and validates an Excel workbook buffer against current database collections.
 * Reusable across initial staging and rescan actions.
 */
async function scanAndValidateWorkbook(type, buffer, req) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (parseErr) {
    throw new Error('Invalid spreadsheet file: ' + parseErr.message);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('Spreadsheet contains no sheets');

  const headerRow = worksheet.getRow(1);
  const headers = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
    headers[colNum] = String(cell.value ?? '').trim();
  });

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const obj = {};
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const header = headers[colNum];
      if (header) obj[header] = cell.value ?? '';
    });
    if (Object.values(obj).some(v => String(v).trim() !== '')) {
      rows.push(obj);
    }
  });

  if (!rows.length) {
    throw new Error('Spreadsheet has no data rows');
  }

  const eligibleRows = [];
  const skippedRows = [];

  // Preload live reference data for caching & validation
  const [allDepts, allClasses, allSubjects, activeYearDoc] = await Promise.all([
    M.Department.find({}).lean(),
    M.Class.find({}).lean(),
    M.Subject.find({}).lean(),
    M.Year.findOne({ isCurrent: true }).lean()
  ]);
  const activeBatches = activeYearDoc ? activeYearDoc.batches.map(b => normalizeYearRange(b.batch).toLowerCase()) : [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;
    const rowIssues = [];

    if (type === 'student') {
      const rawFullName = getColVal(row, ['fullname', 'name', 'studentname']);
      const fullName = sanitizeFullName(rawFullName);
      const { firstName, lastName } = splitFirstLastName(fullName);
      const regNo = getColVal(row, ['registerno', 'regno', 'rollno']);
      const gender = getColVal(row, ['gender', 'sex']);
      const acadYear = normalizeYearRange(getColVal(row, ['academicyear', 'ay']));
      const batch = normalizeYearRange(getColVal(row, ['batch', 'batchname']));
      const courseType = getColVal(row, ['coursetype', 'course']).toUpperCase();
      const branch = getColVal(row, ['branch']);
      const deptName = getColVal(row, ['department', 'dept']);
      const className = getColVal(row, ['class', 'classname']);
      const email = getColVal(row, ['email', 'mail']);
      const username = getColVal(row, ['username', 'user']);
      const password = getColVal(row, ['password', 'pass']) || cfg.STUDENT_PASSWORD || 'Student@123';
      const rawResidency = getColVal(row, ['residency', 'residencetype', 'residence', 'stay', 'staytype', 'hostelordayscholar', 'dayscholarorhosteller', 'hostel', 'dayscholar', 'hosteller']);
      let residency = 'dayscholar';
      if (rawResidency) {
        const lr = String(rawResidency).toLowerCase().trim();
        if (lr.includes('hostel')) {
          residency = 'hostel';
        } else if (lr.includes('day') || lr.includes('scholar')) {
          residency = 'dayscholar';
        } else {
          rowIssues.push(`Residency "${rawResidency}" invalid: must be Dayscholar or Hosteller`);
        }
      }

      if (!fullName) rowIssues.push('FullName missing');
      if (!regNo) rowIssues.push('RegisterNo missing');
      if (!gender) rowIssues.push('Gender missing');
      else if (!['Male', 'Female'].includes(gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase())) {
        rowIssues.push('Gender must be Male or Female');
      }
      if (!batch) rowIssues.push('Batch missing');
      else if (!isValidYearRange(batch)) rowIssues.push(`Batch "${batch}" invalid: must follow YYYY-YYYY format (e.g. 2025-2029)`);
      if (!deptName) rowIssues.push('Department missing');
      if (!acadYear) rowIssues.push('AcademicYear missing');
      else if (!isValidYearRange(acadYear)) rowIssues.push(`AcademicYear "${acadYear}" invalid: must follow YYYY-YYYY format (e.g. 2025-2026)`);
      if (!courseType) rowIssues.push('CourseType missing');
      if (!branch) rowIssues.push('Branch missing');
      if (!className) rowIssues.push('Class missing');
      if (!email) rowIssues.push('Email missing');
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowIssues.push('Invalid email format');
      if (!username) rowIssues.push('Username missing');
      else if (username.toLowerCase().startsWith('sb-') || username.toLowerCase().startsWith('tr-')) {
        rowIssues.push("Username prefixes 'SB-' and 'TR-' are reserved");
      }

      const validCourses = ['UG', 'PG', 'M.E', 'M.TECH', 'B.E', 'B.TECH'];
      if (courseType && !validCourses.includes(courseType)) {
        rowIssues.push(`CourseType "${courseType}" unknown`);
      }

      // Dupe checks against live DB
      if (regNo && await M.Student.findOne({ registerNo: regNo })) {
        rowIssues.push(`RegisterNo ${regNo} already exists in database`);
      }
      if (username && await M.User.findOne({ username: username.toLowerCase() })) {
        rowIssues.push(`Username "${username}" already taken`);
      }

      // Dept isolation
      const matchedDept = allDepts.find(d =>
        d.name.toLowerCase() === deptName.toLowerCase() ||
        d.code.toLowerCase() === deptName.toLowerCase()
      );
      if (!matchedDept && deptName) {
        rowIssues.push(`Department "${deptName}" not found`);
      } else if (matchedDept && !assertInScope(req, matchedDept._id, 'bulk')) {
        rowIssues.push(`Department "${deptName}" is outside your administrative scope`);
      }

      if (rowIssues.length) {
        skippedRows.push({ rowNumber, name: fullName || '(blank)', issues: rowIssues, data: row });
      } else {
        const trackId = buildStudentTrackId(regNo, matchedDept || deptName, batch, acadYear, allDepts);
        eligibleRows.push({
          rowNumber,
          data: {
            fullName,
            firstName,
            lastName,
            registerNo: regNo,
            trackId,
            gender: gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase(),
            batch,
            academicYear: acadYear,
            courseType,
            branch,
            department: matchedDept ? matchedDept.name : deptName,
            deptId: matchedDept ? matchedDept._id : null,
            class: className,
            residency,
            email,
            username: username.toLowerCase(),
            password
          },
          isVerified: false,
          emailSent: false
        });
      }
    } else if (type === 'teacher') {
      const rawName = getColVal(row, ['name', 'fullname']);
      const name = sanitizeFullName(rawName);
      const { firstName, lastName } = splitFirstLastName(name);
      const empId = getColVal(row, ['empid', 'employeeid', 'employee']);
      const dn = getColVal(row, ['dept', 'department']);
      const desig = getColVal(row, ['desig', 'designation']) || 'Assistant Professor';
      const user = getColVal(row, ['user', 'username']);
      const pass = getColVal(row, ['pass', 'password']) || cfg.TEACHER_PASSWORD || 'teacher123';
      const email = getColVal(row, ['email', 'mail']);
      const gender = getColVal(row, ['gender', 'sex']) || 'unspecified';

      if (!name) rowIssues.push('Name missing');
      if (!empId) rowIssues.push('EmployeeID missing');
      if (!dn) rowIssues.push('Department missing');
      if (!user) rowIssues.push('Username missing');
      else if (user.toLowerCase().startsWith('sb-') || user.toLowerCase().startsWith('tr-')) {
        rowIssues.push("Username prefixes 'SB-' and 'TR-' are reserved");
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        rowIssues.push('Invalid email format');
      }

      if (user && await M.User.findOne({ username: user.toLowerCase() })) {
        rowIssues.push(`Username "${user}" already taken`);
      }
      if (empId && await M.Teacher.findOne({ employeeNo: empId })) {
        rowIssues.push(`EmployeeID "${empId}" already exists`);
      }

      const matchedDept = allDepts.find(d =>
        d.name.toLowerCase() === dn.toLowerCase() ||
        d.code.toLowerCase() === dn.toLowerCase()
      );
      if (!matchedDept && dn) {
        rowIssues.push(`Department "${dn}" not found`);
      } else if (matchedDept && !assertInScope(req, matchedDept._id, 'bulk')) {
        rowIssues.push(`Department "${dn}" is outside your administrative scope`);
      }

      if (rowIssues.length) {
        skippedRows.push({ rowNumber, name: name || '(blank)', issues: rowIssues, data: row });
      } else {
        eligibleRows.push({
          rowNumber,
          data: {
            fullName: name,
            firstName,
            lastName,
            employeeNo: empId,
            trackId: 'TRTCH' + (empId ? String(empId).trim() : Date.now()),
            department: matchedDept ? matchedDept.name : dn,
            deptId: matchedDept ? matchedDept._id : null,
            deptCode: matchedDept ? matchedDept.code : '',
            designation: desig,
            username: user.toLowerCase(),
            password: pass,
            email,
            gender
          },
          isVerified: false,
          emailSent: false
        });
      }
    } else if (type === 'dept') {
      const name = getColVal(row, ['deptname', 'name', 'dept']);
      const code = getColVal(row, ['code', 'deptcode']);
      const icon = getColVal(row, ['icon']) || 'building2';
      const number = getColVal(row, ['number', 'deptnumber']);
      const courseType = (getColVal(row, ['coursetype']) || '').toUpperCase();
      const branch = (getColVal(row, ['branch']) || '').toUpperCase();
      const rawCategory = getColVal(row, ['category', 'deptcategory', 'classification', 'type', 'depttype', 'programme', 'supportive', 'supporting']);
      let category = 'programme';
      if (rawCategory) {
        const lc = String(rawCategory).toLowerCase().trim();
        if (lc.includes('supp')) {
          category = 'supporting';
        } else if (lc.includes('prog')) {
          category = 'programme';
        } else {
          rowIssues.push(`Category "${rawCategory}" invalid: must be Programme or Supportive`);
        }
      }

      if (!name) rowIssues.push('DeptName missing');
      if (!code) rowIssues.push('Code missing');
      if (!number) rowIssues.push('Number missing');
      if (!courseType) rowIssues.push('CourseType missing');
      else if (!['UG', 'PG'].includes(courseType)) {
        rowIssues.push(`CourseType "${courseType}" invalid: must be UG or PG`);
      }
      if (!branch) rowIssues.push('Branch missing');
      else if (!['B.E', 'B.TECH', 'M.E', 'M.TECH'].includes(branch)) {
        rowIssues.push(`Branch "${branch}" invalid: must be B.E, B.TECH, M.E, or M.TECH`);
      }

      if (code && allDepts.some(d => d.code.toUpperCase() === code.toUpperCase())) {
        rowIssues.push(`Department code "${code.toUpperCase()}" already exists`);
      }
      if (name && allDepts.some(d => d.name.toLowerCase() === name.toLowerCase())) {
        rowIssues.push(`Department name "${name}" already exists`);
      }

      if (rowIssues.length) {
        skippedRows.push({ rowNumber, name: name || '(blank)', issues: rowIssues, data: row });
      } else {
        eligibleRows.push({
          rowNumber,
          data: { name, code: code.toUpperCase(), icon, number, courseType, branch, category },
          isVerified: true
        });
      }
    } else if (type === 'class') {
      const dn = getColVal(row, ['dept', 'department']);
      const dc = getColVal(row, ['code', 'deptcode']);
      const sem = getColVal(row, ['sem', 'semester']);
      const yr = getColVal(row, ['year']) || 'I Year';
      const hall = getColVal(row, ['hall', 'hallno']);
      const batchVal = normalizeYearRange(getColVal(row, ['batch']));

      if (!dn) rowIssues.push('Department missing');
      if (!hall) rowIssues.push('HallNo missing');
      if (!batchVal) rowIssues.push('Batch missing');
      else if (!isValidYearRange(batchVal)) rowIssues.push(`Batch "${batchVal}" invalid: must follow YYYY-YYYY format (e.g. 2025-2029)`);
      else if (activeBatches.length && !activeBatches.includes(batchVal.toLowerCase())) {
        rowIssues.push(`Batch "${batchVal}" not active under current Academic Year`);
      }

      const dept = allDepts.find(d =>
        d.name.toLowerCase() === dn.toLowerCase() ||
        d.code.toLowerCase() === dn.toLowerCase() ||
        (dc && d.code.toLowerCase() === dc.toLowerCase())
      );

      if (dept && !assertInScope(req, dept._id, 'bulk')) {
        rowIssues.push(`Department "${dn}" is outside your administrative scope`);
      }

      const explicitClassName = getColVal(row, ['classname', 'name', 'class']);
      const batchParts = (batchVal || '').split('-').map(s => s.trim());
      const batchShort = batchParts.length === 2 ? `${batchParts[0].slice(-2)}-${batchParts[1].slice(-2)}` : (batchVal || '');
      const deptCodeVal = dept ? dept.code : (dc || dn);
      const className = explicitClassName || `${batchShort} ${deptCodeVal}`;

      if (className && allClasses.some(c => c.name.toLowerCase() === className.toLowerCase())) {
        rowIssues.push(`Class "${className}" already exists`);
      }

      if (rowIssues.length) {
        skippedRows.push({ rowNumber, name: dn || '(blank)', issues: rowIssues, data: row });
      } else {
        eligibleRows.push({
          rowNumber,
          data: {
            name: className,
            deptId: dept ? dept._id : null,
            deptName: dept ? dept.name : dn,
            deptCode: deptCodeVal,
            batch: batchVal,
            year: yr,
            sem: sem ? String(sem).trim() : 'I',
            hallNo: hall ? String(hall).trim() : '',
            semester: sem ? String(sem).trim() : 'I',
            hall: hall ? String(hall).trim() : ''
          },
          isVerified: true
        });
      }
    } else if (type === 'subject') {
      const name = getColVal(row, ['subjectname', 'name', 'title']);
      const code = getColVal(row, ['code', 'subjectcode']);
      const credits = Number(getColVal(row, ['credits', 'credit'])) || 3;
      const subType = getColVal(row, ['type']) || 'Theory';
      const dn = getColVal(row, ['dept', 'department']);
      const dc = getColVal(row, ['deptcode']);

      if (!name) rowIssues.push('SubjectName missing');
      if (!code) rowIssues.push('SubjectCode missing');
      if (!dn && !dc) rowIssues.push('Department missing');

      const dept = allDepts.find(d =>
        (dn && d.name.toLowerCase() === dn.toLowerCase()) ||
        (dc && d.code.toLowerCase() === dc.toLowerCase()) ||
        (dn && d.code.toLowerCase() === dn.toLowerCase())
      );

      if (dept && !assertInScope(req, dept._id, 'bulk')) {
        rowIssues.push(`Department "${dn}" is outside your administrative scope`);
      }

      if (dept && code) {
        const subjectCode = `${dept.code}-${code.toUpperCase()}`;
        if (allSubjects.some(s => s.subjectCode === subjectCode)) {
          rowIssues.push(`SubjectCode "${subjectCode}" already exists`);
        }
      }

      if (rowIssues.length) {
        skippedRows.push({ rowNumber, name: name || '(blank)', issues: rowIssues, data: row });
      } else {
        const subjectCode = dept ? `${dept.code}-${code.toUpperCase()}` : code.toUpperCase();
        eligibleRows.push({
          rowNumber,
          data: {
            name,
            code: code.toUpperCase(),
            subjectCode,
            credits,
            type: subType,
            deptId: dept ? dept._id : null,
            deptName: dept ? dept.name : dn,
            deptCode: dept ? dept.code : ''
          },
          isVerified: true
        });
      }
    }
  }

  return {
    totalRows: rows.length,
    eligibleRows,
    skippedRows
  };
}

// ── 1. STAGE BULK FILE (WITH IMMEDIATE GOOGLE DRIVE UPLOAD & ROADMAP) ─────────
router.post('/stage', authMiddleware, requirePage('bulk', 'create'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const type = req.body.type || 'student';
    if (!['dept', 'teacher', 'class', 'subject', 'student'].includes(type)) {
      return res.status(400).json({ error: `Unsupported import type: ${type}` });
    }

    const batchTrackId = generateBatchTrackId();
    const fileName = req.file.originalname || `upload_${type}.xlsx`;

    // 1. Immediately create a new folder in Google Drive under bulk.html Uploads/ folder named (TR-BATCH-...)
    // 2. Under that folder, upload the uploaded sheet
    let driveMeta = {
      folderId: '',
      folderName: batchTrackId,
      folderUrl: '',
      fileId: '',
      fileUrl: '',
      status: 'pending',
      uploadedAt: null,
      error: ''
    };

    try {
      const driveFolder = await createBatchFolder(batchTrackId);
      if (driveFolder && driveFolder.folderId) {
        driveMeta.folderId = driveFolder.folderId;
        driveMeta.folderName = driveFolder.folderName;
        driveMeta.folderUrl = driveFolder.folderUrl;
        driveMeta.status = 'folder_created';

        const driveFile = await uploadBufferToDrive(
          req.file.buffer,
          fileName,
          req.file.mimetype,
          driveFolder.folderId
        );

        if (driveFile && driveFile.fileId) {
          driveMeta.fileId = driveFile.fileId;
          driveMeta.fileUrl = driveFile.driveUrl;
          driveMeta.status = 'uploaded';
          driveMeta.uploadedAt = new Date();
        } else {
          driveMeta.status = 'file_failed';
        }
      } else {
        driveMeta.status = 'folder_failed';
      }
    } catch (gErr) {
      console.warn('[BulkImport] Google Drive upload error:', gErr.message);
      driveMeta.status = 'error';
      driveMeta.error = gErr.message;
    }

    // 3. Scan and validate the workbook
    const scanResult = await scanAndValidateWorkbook(type, req.file.buffer, req);

    const batchDoc = await M.BulkImportBatch.create({
      batchTrackId,
      type,
      originalFileName: fileName,
      fileBufferBase64: req.file.buffer.toString('base64'),
      mimeType: req.file.mimetype,
      drive: driveMeta,
      uploadedBy: {
        userId: req.user._id,
        trackId: req.user.trackId || '',
        name: req.user.name || 'Staff Member',
        role: req.user.role || 'teacher',
        deptId: req.user.deptId || null,
        deptName: req.user.department || ''
      },
      deviceDetails: {
        ip: req.ip || '',
        userAgent: req.headers['user-agent'] || '',
        sessionId: req.user.sessionId || ''
      },
      status: 'staged',
      totalRows: scanResult.totalRows,
      eligibleCount: scanResult.eligibleRows.length,
      skippedCount: scanResult.skippedRows.length,
      verifiedCount: ['dept', 'class', 'subject'].includes(type) ? scanResult.eligibleRows.length : 0,
      eligibleRows: scanResult.eligibleRows,
      skippedRows: scanResult.skippedRows,
      roadmap: [
        {
          stage: 'drive_upload',
          status: driveMeta.status === 'uploaded' ? 'completed' : 'attempted',
          user: req.user.name || 'User',
          details: {
            folderName: driveMeta.folderName,
            folderUrl: driveMeta.folderUrl,
            fileUrl: driveMeta.fileUrl,
            status: driveMeta.status
          }
        },
        {
          stage: 'staged',
          status: 'initial_scan_completed',
          user: req.user.name || 'User',
          details: {
            totalRows: scanResult.totalRows,
            eligible: scanResult.eligibleRows.length,
            skipped: scanResult.skippedRows.length
          }
        }
      ]
    });

    logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'BULK_IMPORT_STAGED',
      'Bulk ' + type.toUpperCase() + ' import staged: ' + batchDoc.eligibleCount + ' eligible, ' + batchDoc.skippedCount + ' skipped (' + batchDoc.batchTrackId + ')',
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'bulk-import',
        batchTrackId: batchDoc.batchTrackId,
        type,
        total: batchDoc.totalRows,
        eligible: batchDoc.eligibleCount,
        skipped: batchDoc.skippedCount,
        driveFolder: driveMeta.folderName,
        driveUrl: driveMeta.folderUrl
      }
    );

    res.json({
      ok: true,
      batchId: batchDoc._id,
      batchTrackId: batchDoc.batchTrackId,
      type: batchDoc.type,
      drive: batchDoc.drive,
      totalRows: batchDoc.totalRows,
      eligibleCount: batchDoc.eligibleCount,
      skippedCount: batchDoc.skippedCount,
      skippedRows: batchDoc.skippedRows,
      status: batchDoc.status
    });
  } catch (err) {
    console.error('[BulkImport] /stage error:', err);
    res.status(500).json({ error: 'Failed to stage spreadsheet: ' + err.message });
  }
});

// ── 1B. RESCAN BATCH AGAINST LIVE DATABASE ────────────────────────────────────
router.post('/batches/:id/rescan', authMiddleware, requirePage('bulk', 'create'), async (req, res) => {
  try {
    const batch = await M.BulkImportBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    if (!batch.fileBufferBase64) {
      return res.status(400).json({ error: 'Original spreadsheet buffer not stored in this batch. Please re-upload.' });
    }

    const fileBuffer = Buffer.from(batch.fileBufferBase64, 'base64');

    // Ensure Google Drive folder & file exist
    if (!batch.drive || !batch.drive.folderId || !batch.drive.fileId) {
      try {
        const folderName = batch.batchTrackId || generateBatchTrackId();
        let folderId = (batch.drive && batch.drive.folderId) ? batch.drive.folderId : '';
        let folderUrl = (batch.drive && batch.drive.folderUrl) ? batch.drive.folderUrl : '';

        if (!folderId) {
          const driveFolder = await createBatchFolder(folderName);
          if (driveFolder && driveFolder.folderId) {
            folderId = driveFolder.folderId;
            folderUrl = driveFolder.folderUrl;
          }
        }

        if (folderId && (!batch.drive || !batch.drive.fileId)) {
          const driveFile = await uploadBufferToDrive(
            fileBuffer,
            batch.originalFileName || `upload_${batch.type}.xlsx`,
            batch.mimeType,
            folderId
          );
          if (driveFile && driveFile.fileId) {
            batch.drive = {
              folderId,
              folderName,
              folderUrl,
              fileId: driveFile.fileId,
              fileUrl: driveFile.driveUrl,
              status: 'uploaded',
              uploadedAt: new Date(),
              error: ''
            };
          }
        }
      } catch (gErr) {
        console.warn('[BulkImport] Rescan Google Drive retry warning:', gErr.message);
      }
    }

    // Re-scan from the stored spreadsheet buffer
    const scanResult = await scanAndValidateWorkbook(batch.type, fileBuffer, req);

    // If records were previously marked as verified, preserve their verified state
    const previouslyVerifiedMap = new Map();
    if (Array.isArray(batch.eligibleRows)) {
      for (const er of batch.eligibleRows) {
        if (er.isVerified) {
          const key = er.data ? (er.data.registerNo || er.data.employeeNo || er.data.username || er.rowNumber) : er.rowNumber;
          previouslyVerifiedMap.set(String(key), er);
        }
      }
    }

    let preservedVerifiedCount = 0;
    const finalEligibleRows = scanResult.eligibleRows.map(newRow => {
      const key = newRow.data ? (newRow.data.registerNo || newRow.data.employeeNo || newRow.data.username || newRow.rowNumber) : newRow.rowNumber;
      const prev = previouslyVerifiedMap.get(String(key));
      if (prev && prev.isVerified) {
        preservedVerifiedCount++;
        return {
          ...newRow,
          isVerified: true,
          verifiedAt: prev.verifiedAt,
          verifiedBy: prev.verifiedBy,
          emailSent: prev.emailSent,
          emailSentAt: prev.emailSentAt,
          emailRecipient: prev.emailRecipient,
          notes: prev.notes
        };
      }
      return newRow;
    });

    batch.totalRows = scanResult.totalRows;
    batch.eligibleRows = finalEligibleRows;
    batch.skippedRows = scanResult.skippedRows;
    batch.eligibleCount = finalEligibleRows.length;
    batch.skippedCount = scanResult.skippedRows.length;
    batch.verifiedCount = ['dept', 'class', 'subject'].includes(batch.type) ? finalEligibleRows.length : preservedVerifiedCount;

    // If all skipped rows resolved, transition status if currently staged
    if (batch.skippedCount === 0 && batch.status === 'staged') {
      batch.status = 'skipped_resolved';
    }

    batch.roadmap.push({
      stage: 'rescan',
      status: 'completed',
      timestamp: new Date(),
      user: req.user.name || 'User',
      details: {
        totalRows: scanResult.totalRows,
        eligible: batch.eligibleCount,
        skipped: batch.skippedCount,
        verified: batch.verifiedCount
      }
    });

    await batch.save();

    logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'BULK_IMPORT_RESCANNED',
      'Bulk ' + batch.type.toUpperCase() + ' import rescanned: ' + batch.eligibleCount + ' eligible, ' + batch.skippedCount + ' skipped (' + batch.batchTrackId + ')',
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'bulk-import',
        batchTrackId: batch.batchTrackId,
        type: batch.type,
        total: batch.totalRows,
        eligible: batch.eligibleCount,
        skipped: batch.skippedCount
      }
    );

    const limit24h = await get24HourVerificationCount();

    return res.json({
      ok: true,
      message: `Batch rescanned successfully. ${batch.eligibleCount} records ready for verification, ${batch.skippedCount} skipped.`,
      batch,
      limit24h
    });
  } catch (err) {
    console.error('[BulkImport] /rescan error:', err);
    return res.status(500).json({ error: 'Failed to rescan batch: ' + err.message });
  }
});

// ── 2. GET ACTIVE PENDING BATCH FOR RECOVERY ─────────────────────────────────
router.get('/batches/active', authMiddleware, async (req, res) => {
  try {
    const isSudo = isSudoAdmin(req.user) || ['sudo', 'admin'].includes(req.user.role);
    const filter = {
      status: { $in: ['staged', 'skipped_resolved', 'pending_sudo_initial', 'sudo_initial_approved', 'verifying', 'verified_all', 'pending_final_approval'] }
    };
    if (!isSudo) {
      filter['uploadedBy.userId'] = req.user._id;
    }
    const batch = await M.BulkImportBatch.findOne(filter).sort({ createdAt: -1 }).lean();
    if (!batch) return res.json({ batch: null });

    const limit24h = await get24HourVerificationCount();
    res.json({ batch, limit24h });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 3. GET SPECIFIC BATCH ────────────────────────────────────────────────────
router.get('/batches/:id', authMiddleware, async (req, res) => {
  try {
    const batch = await M.BulkImportBatch.findById(req.params.id).lean();
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const limit24h = await get24HourVerificationCount();
    res.json({ batch, limit24h });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 4. RESOLVE SKIPPED ROWS WITH DONE ────────────────────────────────────────
router.post('/batches/:id/resolve-skipped', authMiddleware, async (req, res) => {
  try {
    const batch = await M.BulkImportBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const { doneRows } = req.body; // array of row numbers, or true for all
    if (Array.isArray(doneRows)) {
      batch.skippedRows.forEach(sr => {
        if (doneRows.includes(sr.rowNumber)) {
          sr.isDone = true;
          sr.doneAt = new Date();
        }
      });
    } else {
      batch.skippedRows.forEach(sr => {
        sr.isDone = true;
        sr.doneAt = new Date();
      });
    }

    const allDone = batch.skippedRows.every(sr => sr.isDone);
    if (allDone) {
      batch.status = 'skipped_resolved';
      batch.roadmap.push({
        stage: 'skipped_resolved',
        status: 'all_acknowledged',
        user: req.user.name,
        details: { skippedCount: batch.skippedRows.length }
      });
    }
    await batch.save();
    res.json({ ok: true, status: batch.status, allDone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 5. FORWARD TO SUDO ADMIN ──────────────────────────────────────────────────
router.post('/batches/:id/forward-sudo', authMiddleware, async (req, res) => {
  try {
    const batch = await M.BulkImportBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const isCallerSudo = isSudoAdmin(req.user) || req.user.role === 'sudo' || (req.user.role === 'admin' && req.user.adminFlag !== 'subadmin');

    if (isCallerSudo) {
      // Sudo Admin uploads can be directly approved
      batch.status = 'sudo_initial_approved';
      batch.sudoInitialApproval = {
        approved: true,
        approvedBy: req.user.name,
        approvedAt: new Date(),
        notes: 'Auto-approved by Sudo Admin'
      };
      batch.roadmap.push({
        stage: 'sudo_initial_approved',
        status: 'approved',
        user: req.user.name,
        details: { direct: true }
      });
    } else {
      batch.status = 'pending_sudo_initial';
      batch.roadmap.push({
        stage: 'pending_sudo_initial',
        status: 'forwarded',
        user: req.user.name,
        details: { requestedBy: req.user.name }
      });
    }

    await batch.save();
    res.json({ ok: true, status: batch.status, isSudo: isCallerSudo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 6. SUDO ADMIN INITIAL APPROVAL ───────────────────────────────────────────
router.post('/batches/:id/approve-initial', authMiddleware, async (req, res) => {
  try {
    const isCallerSudo = isSudoAdmin(req.user) || req.user.role === 'sudo' || (req.user.role === 'admin' && req.user.adminFlag !== 'subadmin');
    if (!isCallerSudo) {
      return res.status(403).json({ error: 'Access denied: Sudo Admin approval required' });
    }

    const batch = await M.BulkImportBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    batch.status = 'sudo_initial_approved';
    batch.sudoInitialApproval = {
      approved: true,
      approvedBy: req.user.name,
      approvedAt: new Date(),
      notes: req.body.notes || 'Initial request approved'
    };
    batch.roadmap.push({
      stage: 'sudo_initial_approved',
      status: 'approved',
      user: req.user.name,
      details: { notes: batch.sudoInitialApproval.notes }
    });

    await batch.save();
    res.json({ ok: true, status: batch.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 7. VERIFY INDIVIDUAL ENTRY (WITH 500/24h LIMIT & EMAIL) ──────────────────
router.post('/batches/:id/verify-entry', authMiddleware, async (req, res) => {
  try {
    const batch = await M.BulkImportBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const { rowNumber, updatedData } = req.body;
    const entry = batch.eligibleRows.find(r => r.rowNumber === rowNumber);
    if (!entry) return res.status(404).json({ error: `Row ${rowNumber} not found in eligible list` });

    // 24-HOUR RATE LIMIT CHECK (Max 500 entries in 24 hours for student/teacher)
    if (['student', 'teacher'].includes(batch.type) && !entry.isVerified) {
      const current24hCount = await get24HourVerificationCount();
      if (current24hCount >= 500) {
        return res.status(429).json({
          error: `Daily verification limit reached (500/500 entries verified in the last 24 hours). Please wait 24 hours to proceed with remaining verifications.`,
          current24hCount
        });
      }
    }

    // Update staged row data if edited
    if (updatedData && typeof updatedData === 'object') {
      if (updatedData.fullName) {
        updatedData.fullName = sanitizeFullName(updatedData.fullName);
        const split = splitFirstLastName(updatedData.fullName);
        if (updatedData.firstName) updatedData.firstName = sanitizeFullName(updatedData.firstName);
        else updatedData.firstName = split.firstName;
        if (updatedData.lastName !== undefined && updatedData.lastName !== null && updatedData.lastName !== '') {
          updatedData.lastName = sanitizeFullName(updatedData.lastName);
        } else {
          updatedData.lastName = split.lastName || null;
        }
      }
      entry.data = Object.assign({}, entry.data, updatedData);
    }

    // Send Credentials Email
    const recipientEmail = entry.data.email;
    const recipientName = entry.data.fullName || entry.data.name;
    const username = entry.data.username;
    const password = entry.data.password || 'Student@123';

    const host = req.get('host');
    const protocol = req.protocol || (req.secure ? 'https' : 'http');
    const origin = req.get('origin');
    const portalUrl = origin ? `${origin.replace(/\/+$/, '')}/index.html` : `${protocol}://${host}/index.html`;

    let emailResult = { sent: false, simulated: true };
    if (recipientEmail) {
      emailResult = await sendWelcomeCredentialsMail({
        to: recipientEmail,
        fullName: recipientName,
        username,
        password,
        role: batch.type === 'teacher' ? 'teacher' : 'student',
        institutionName: 'EAMS Institution',
        portalUrl
      });
    }

    entry.isVerified = true;
    entry.verifiedAt = new Date();
    entry.verifiedBy = req.user.name || 'Staff';
    entry.emailSent = Boolean(emailResult.sent && !emailResult.simulated);
    entry.emailSentAt = new Date();
    entry.emailRecipient = recipientEmail || '';

    // Record in verification audit log
    batch.verificationAudit.push({
      rowNumber,
      entityName: recipientName,
      identifier: entry.data.registerNo || entry.data.employeeNo || username,
      email: recipientEmail,
      verifiedBy: req.user.name,
      verifiedAt: new Date(),
      ip: req.ip,
      userAgent: req.headers['user-agent'] || ''
    });

    batch.verifiedCount = batch.eligibleRows.filter(r => r.isVerified).length;
    if (batch.verifiedCount >= batch.eligibleRows.length) {
      batch.status = 'verified_all';
    } else {
      batch.status = 'verifying';
    }

    await batch.save();

    const limit24h = await get24HourVerificationCount();

    res.json({
      ok: true,
      rowNumber,
      isVerified: true,
      verifiedCount: batch.verifiedCount,
      eligibleCount: batch.eligibleCount,
      verifiedAll: batch.verifiedCount >= batch.eligibleCount,
      emailSent: entry.emailSent,
      emailSimulated: Boolean(emailResult.simulated),
      emailProvider: emailResult.provider,
      recipientEmail,
      limit24h
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 7b. VERIFY ALL REMAINING ENTRIES (WITH 500/24h LIMIT & EMAIL DISPATCH) ────
router.post('/batches/:id/verify-all', authMiddleware, async (req, res) => {
  try {
    const batch = await M.BulkImportBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const unverifiedRows = (batch.eligibleRows || []).filter(r => !r.isVerified);
    if (!unverifiedRows.length) {
      return res.json({
        ok: true,
        message: 'All eligible entries are already verified',
        verifiedCount: batch.verifiedCount,
        eligibleCount: batch.eligibleCount,
        verifiedAll: true
      });
    }

    // 24-HOUR RATE LIMIT CHECK (Max 500 entries in 24 hours for student/teacher)
    let current24hCount = 0;
    if (['student', 'teacher'].includes(batch.type)) {
      current24hCount = await get24HourVerificationCount();
      const remainingQuota = 500 - current24hCount;
      if (remainingQuota <= 0) {
        return res.status(429).json({
          error: 'Daily verification limit reached (500/500 entries verified in the last 24 hours). Please wait 24 hours to proceed.',
          current24hCount
        });
      }
      if (unverifiedRows.length > remainingQuota) {
        return res.status(429).json({
          error: `Remaining 24-hour verification quota (${remainingQuota} entries) is less than unverified rows (${unverifiedRows.length}). You can verify up to ${remainingQuota} entries today.`,
          current24hCount,
          remainingQuota
        });
      }
    }

    let emailsDispatched = 0;
    let emailsFailed = 0;

    for (const entry of unverifiedRows) {
      const recipientEmail = entry.data.email;
      const recipientName = entry.data.fullName || entry.data.name;
      const username = entry.data.username;
      const password = entry.data.password || (batch.type === 'teacher' ? 'Teacher@123' : 'Student@123');

      const host = req.get('host');
      const protocol = req.protocol || (req.secure ? 'https' : 'http');
      const origin = req.get('origin');
      const portalUrl = origin ? `${origin.replace(/\/+$/, '')}/index.html` : `${protocol}://${host}/index.html`;

      let emailResult = { sent: false, simulated: true };
      if (recipientEmail) {
        try {
          emailResult = await sendWelcomeCredentialsMail({
            to: recipientEmail,
            fullName: recipientName,
            username,
            password,
            role: batch.type === 'teacher' ? 'teacher' : 'student',
            institutionName: 'EAMS Institution',
            portalUrl
          });
          if (emailResult.sent && !emailResult.simulated) {
            emailsDispatched++;
          }
        } catch (e) {
          emailsFailed++;
          console.warn(`[BulkVerifyAll] Failed to send email to ${recipientEmail}:`, e.message);
        }
      }

      entry.isVerified = true;
      entry.verifiedAt = new Date();
      entry.verifiedBy = req.user.name || 'Staff';
      entry.emailSent = Boolean(emailResult.sent && !emailResult.simulated);
      entry.emailSentAt = new Date();
      entry.emailRecipient = recipientEmail || '';

      batch.verificationAudit.push({
        rowNumber: entry.rowNumber,
        entityName: recipientName,
        identifier: entry.data.registerNo || entry.data.employeeNo || username,
        email: recipientEmail,
        verifiedBy: req.user.name,
        verifiedAt: new Date(),
        ip: req.ip,
        userAgent: req.headers['user-agent'] || ''
      });
    }

    batch.verifiedCount = batch.eligibleRows.filter(r => r.isVerified).length;
    if (batch.verifiedCount >= batch.eligibleRows.length) {
      batch.status = 'verified_all';
    } else {
      batch.status = 'verifying';
    }

    await batch.save();

    const limit24h = await get24HourVerificationCount();

    res.json({
      ok: true,
      verifiedCount: batch.verifiedCount,
      eligibleCount: batch.eligibleCount,
      verifiedAll: batch.verifiedCount >= batch.eligibleCount,
      verifiedNowCount: unverifiedRows.length,
      emailsDispatched,
      emailsFailed,
      limit24h
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 7c. DEV BYPASS: VERIFY ALL WITHOUT CONFIRMING / NO EMAILS / NO RATE LIMIT ──
router.post('/batches/:id/dev-bypass-verify', authMiddleware, async (req, res) => {
  try {
    const isDev = process.env.NODE_ENV === 'development' || cfg.NODE_ENV === 'development';
    if (!isDev) {
      return res.status(403).json({ error: 'Dev bypass is only available in development environment' });
    }

    const batch = await M.BulkImportBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    let bypassedCount = 0;
    for (const entry of (batch.eligibleRows || [])) {
      if (!entry.isVerified) {
        entry.isVerified = true;
        entry.devBypass = true;
        entry.verifiedBy = (req.user.name || 'Admin') + ' [DEV_BYPASS]';
        entry.emailSent = false;
        entry.notes = 'DEV bypass: skipped confirmation and credential emails';
        bypassedCount++;
      }
    }

    batch.verifiedCount = (batch.eligibleRows || []).filter(r => r.isVerified).length;
    if (batch.verifiedCount >= (batch.eligibleRows || []).length) {
      batch.status = 'verified_all';
    } else {
      batch.status = 'verifying';
    }

    batch.roadmap.push({
      stage: 'dev_bypass_verified',
      status: 'bypassed',
      user: req.user.name || 'Admin',
      details: {
        bypassedCount,
        totalEligible: batch.eligibleCount,
        note: 'DEV bypass: verification and credential emails skipped'
      }
    });

    await batch.save();

    const limit24h = await get24HourVerificationCount();

    return res.json({
      ok: true,
      message: `DEV: Successfully bypassed verification for ${bypassedCount} entries without sending emails.`,
      batch,
      bypassedCount,
      verifiedCount: batch.verifiedCount,
      eligibleCount: batch.eligibleCount,
      verifiedAll: batch.verifiedCount >= batch.eligibleCount,
      limit24h
    });
  } catch (err) {
    console.error('[BulkImport] /dev-bypass-verify error:', err);
    return res.status(500).json({ error: 'Failed to dev bypass verification: ' + err.message });
  }
});

// ── 8. SUBMIT FOR FINAL APPROVAL ──────────────────────────────────────────────
router.post('/batches/:id/submit-final', authMiddleware, async (req, res) => {
  try {
    const batch = await M.BulkImportBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const isCallerSudo = isSudoAdmin(req.user) || req.user.role === 'sudo' || (req.user.role === 'admin' && req.user.adminFlag !== 'subadmin');

    if (isCallerSudo) {
      batch.status = 'pending_final_approval'; // Sudo can immediately commit next
    } else {
      batch.status = 'pending_final_approval';
    }

    batch.roadmap.push({
      stage: 'pending_final_approval',
      status: 'submitted',
      user: req.user.name,
      details: { verifiedCount: batch.verifiedCount }
    });

    await batch.save();
    res.json({ ok: true, status: batch.status, isSudo: isCallerSudo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 9. FINAL APPROVAL, COMMIT TO DB, & GOOGLE DRIVE ZIP BACKUP ───────────────
router.post('/batches/:id/approve-final', authMiddleware, async (req, res) => {
  try {
    const isCallerSudo = isSudoAdmin(req.user) || req.user.role === 'sudo' || (req.user.role === 'admin' && req.user.adminFlag !== 'subadmin');
    if (!isCallerSudo) {
      return res.status(403).json({ error: 'Access denied: Sudo Admin final approval required' });
    }

    const batch = await M.BulkImportBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    if (batch.status === 'committed') {
      return res.status(400).json({ error: 'Batch has already been committed to the database' });
    }

    let addedCount = 0;
    const commitErrors = [];
    const allDepts = await M.Department.find({}).lean();

    // 1. Commit to live MongoDB collections
    for (const entry of batch.eligibleRows) {
      if (!entry.isVerified && ['student', 'teacher'].includes(batch.type)) {
        continue; // Unverified items not committed
      }
      const data = entry.data;

      try {
        if (batch.type === 'student') {
          const defaultPassword = data.password || cfg.STUDENT_PASSWORD || 'Student@123';
          const hash = await bcrypt.hash(defaultPassword, cfg.BCRYPT_ROUNDS);
          const generatedTrackId = (data.trackId && !data.trackId.startsWith('TRSTU_') && !data.trackId.startsWith('STU'))
            ? data.trackId
            : buildStudentTrackId(data.registerNo, data.deptId || data.department, data.batch, data.academicYear, allDepts);

          const normBatch = normalizeYearRange(data.batch);
          const normAcadYear = normalizeYearRange(data.academicYear);
          const cls = await M.Class.findOne({ name: data.class }).lean();

          const cleanFullName = sanitizeFullName(data.fullName);
          const split = splitFirstLastName(cleanFullName);
          const firstName = data.firstName ? sanitizeFullName(data.firstName) : split.firstName;
          const lastName = (data.lastName !== undefined && data.lastName !== null && data.lastName !== '') ? sanitizeFullName(data.lastName) : (split.lastName || null);

          const student = await M.Student.create({
            fullName: cleanFullName,
            firstName,
            lastName,
            registerNo: data.registerNo,
            gender: data.gender,
            batch: normBatch,
            batchTrackId: toBatchTrackId(normBatch),
            admissionYear: normAcadYear,
            academicYear: normAcadYear,
            courseType: data.courseType,
            branch: data.branch,
            department: data.department,
            deptId: data.deptId,
            class: data.class,
            classId: cls ? cls._id : null,
            residency: data.residency ? (String(data.residency).toLowerCase().includes('hostel') ? 'hostel' : 'dayscholar') : 'dayscholar',
            email: data.email,
            username: data.username,
            password: hash,
            trackId: generatedTrackId,
            mustChangePassword: true
          });

          await M.User.create({
            username: data.username,
            role: 'student',
            trackId: generatedTrackId,
            status: 'active'
          });
          addedCount++;
        } else if (batch.type === 'teacher') {
          const defaultPassword = data.password || cfg.TEACHER_PASSWORD || 'teacher123';
          const hash = await bcrypt.hash(defaultPassword, cfg.BCRYPT_ROUNDS);
          const generatedTrackId = 'TRTCH' + (data.employeeNo ? String(data.employeeNo).trim() : Date.now());

          const cleanFullName = sanitizeFullName(data.fullName);
          const split = splitFirstLastName(cleanFullName);
          const firstName = data.firstName ? sanitizeFullName(data.firstName) : split.firstName;
          const lastName = (data.lastName !== undefined && data.lastName !== null && data.lastName !== '') ? sanitizeFullName(data.lastName) : (split.lastName || null);

          await M.Teacher.create({
            fullName: cleanFullName,
            firstName,
            lastName,
            employeeNo: data.employeeNo,
            department: data.department,
            deptId: data.deptId,
            deptCode: data.deptCode,
            designation: data.designation,
            username: data.username,
            password: hash,
            email: data.email || '',
            gender: data.gender || 'unspecified',
            trackId: generatedTrackId,
            mustChangePassword: true
          });

          await M.User.findOneAndUpdate(
            { username: data.username },
            { username: data.username, role: 'teacher', trackId: generatedTrackId, status: 'active' },
            { upsert: true }
          );
          addedCount++;
        } else if (batch.type === 'dept') {
          await M.Department.create({
            name: data.name,
            code: data.code,
            icon: data.icon || 'building2',
            number: data.number || '',
            courseType: data.courseType || 'UG',
            branch: data.branch || 'B.E',
            category: (data.category && String(data.category).toLowerCase().includes('supp')) ? 'supporting' : 'programme'
          });
          addedCount++;
        } else if (batch.type === 'class') {
          await M.Class.create({
            name: data.name,
            deptId: data.deptId,
            deptName: data.deptName,
            deptCode: data.deptCode,
            year: data.year,
            sem: data.sem || data.semester || 'I',
            hallNo: data.hallNo || data.hall || '',
            batch: normalizeYearRange(data.batch)
          });
          addedCount++;
        } else if (batch.type === 'subject') {
          await M.Subject.create({
            name: data.name,
            code: data.code,
            subjectCode: data.subjectCode,
            credits: data.credits,
            type: data.type,
            deptId: data.deptId,
            deptName: data.deptName,
            deptCode: data.deptCode
          });
          addedCount++;
        }
      } catch (rowCommitErr) {
        commitErrors.push({ rowNumber: entry.rowNumber, error: rowCommitErr.message });
      }
    }

    batch.finalApproval = {
      approved: true,
      approvedBy: req.user.name,
      approvedAt: new Date(),
      notes: req.body.notes || 'Final approval and commit executed'
    };

    // 2. Compile Complete ZIP Archive using JSZip
    const zip = new JSZip();

    // A. Original uploaded spreadsheet file
    if (batch.fileBufferBase64) {
      zip.file(batch.originalFileName || 'original_upload.xlsx', Buffer.from(batch.fileBufferBase64, 'base64'));
    }

    // B. Uploaded user details
    zip.file('uploaded_user_details.json', JSON.stringify({
      batchTrackId: batch.batchTrackId,
      importType: batch.type,
      totalUploaded: batch.totalRows,
      eligibleCount: batch.eligibleCount,
      verifiedCount: batch.verifiedCount,
      records: batch.eligibleRows.map(r => r.data)
    }, null, 2));

    // C. Device details
    zip.file('device_details.json', JSON.stringify({
      uploader: batch.uploadedBy,
      device: batch.deviceDetails,
      approverDevice: {
        approverName: req.user.name,
        approverIp: req.ip,
        approverUserAgent: req.headers['user-agent']
      }
    }, null, 2));

    // D. Verification logs (day, user, device, time)
    zip.file('verification_logs.json', JSON.stringify({
      verificationAudit: batch.verificationAudit,
      individualRows: batch.eligibleRows.map(r => ({
        rowNumber: r.rowNumber,
        isVerified: r.isVerified,
        verifiedAt: r.verifiedAt,
        verifiedBy: r.verifiedBy,
        emailSent: r.emailSent,
        emailSentAt: r.emailSentAt,
        emailRecipient: r.emailRecipient
      }))
    }, null, 2));

    // E. Admin approval log
    zip.file('admin_approval.json', JSON.stringify({
      sudoInitialApproval: batch.sudoInitialApproval,
      finalApproval: batch.finalApproval,
      approvedAt: new Date(),
      approvedBy: req.user.name
    }, null, 2));

    // F. Roadmap and Schema specification
    zip.file('roadmap_and_schemas.json', JSON.stringify({
      roadmap: batch.roadmap,
      schemaType: batch.type,
      targetCollections: batch.type === 'student' ? ['Student', 'User'] :
                         batch.type === 'teacher' ? ['Teacher', 'User'] :
                         batch.type === 'class' ? ['Class'] :
                         batch.type === 'subject' ? ['Subject'] : ['Department']
    }, null, 2));

    // G. Complete Upload History
    zip.file('upload_history.json', JSON.stringify({
      historyTrackId: batch.batchTrackId,
      createdAt: batch.createdAt,
      committedAt: new Date(),
      addedCount,
      skippedCount: batch.skippedCount,
      errors: commitErrors,
      status: 'committed'
    }, null, 2));

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    // 3. Upload ZIP directly to Google Drive
    const backupResult = await uploadBulkBackupZip({
      buffer: zipBuffer,
      zipFileName: `BULK_ARCHIVE_${batch.type.toUpperCase()}_${batch.batchTrackId}.zip`,
      batchTrackId: batch.batchTrackId,
      uploadedBy: req.user.name,
      folderId: batch.drive ? batch.drive.folderId : null
    });

    batch.backup = {
      driveFileId: backupResult.driveFileId,
      driveWebViewLink: backupResult.webViewLink,
      localPath: null,
      zipSize: backupResult.size,
      md5: backupResult.md5Checksum,
      archivedAt: backupResult.archivedAt
    };

    batch.status = 'committed';
    batch.roadmap.push({
      stage: 'committed',
      status: 'completed',
      user: req.user.name,
      details: { addedCount, commitErrors, backup: backupResult.driveFileId }
    });

    await batch.save();

    // 4. Log Action
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      `Bulk ${batch.type.toUpperCase()} Import Completed`,
      `${addedCount} records committed to live database. Google Drive backup archived.`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'bulk-import',
        batchTrackId: batch.batchTrackId,
        driveBackupId: backupResult.driveFileId
      }
    );

    res.json({
      ok: true,
      message: `Bulk import complete: ${addedCount} records committed to database. Complete backup archive stored.`,
      addedCount,
      commitErrors,
      backup: batch.backup
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const { scanAndValidateWorkbook: modernScan } = require('../services/bulk/scan');
router.scanAndValidateWorkbook = modernScan;
module.exports = router;
