const ExcelJS = require('exceljs');
const { Readable } = require('stream');
const M = require('../../models');
const { getSchema, findColumn } = require('./schema');
const { isSudoCaller } = require('./access');
const { assertInScope } = require('../../middleware/auth');
const { normalizeYearRange, isValidYearRange, toBatchTrackId, buildStudentTrackId } = require('../../utils/yearFormat');
const { sanitizeFullName, splitFirstLastName } = require('../../utils/nameFormat');
const { todayIST } = require('../../utils/institutionTime');

/**
 * Robust cell value extraction handling strings, numbers, dates, richText, formulas, and hyperlinks (A7)
 */
function cellToText(cell) {
  if (cell === null || cell === undefined) return '';
  const val = cell.value !== undefined ? cell.value : cell;
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val).trim();
  if (val instanceof Date) return todayIST(val);
  if (typeof val === 'object') {
    if (val.text !== undefined) return String(val.text).trim();
    if (Array.isArray(val.richText)) {
      return val.richText.map(t => (t && t.text ? t.text : '')).join('').trim();
    }
    if (val.result !== undefined) return String(val.result).trim();
    if (val.error !== undefined) return '';
    return JSON.stringify(val);
  }
  return String(val).trim();
}

/**
 * Executes chunked $in queries to prevent N+1 query performance degradation (A9)
 */
async function chunkedInLookup(model, field, values) {
  const uniqueVals = Array.from(new Set(values.filter(Boolean)));
  const foundSet = new Set();
  const CHUNK_SIZE = 1000;

  for (let i = 0; i < uniqueVals.length; i += CHUNK_SIZE) {
    const chunk = uniqueVals.slice(i, i + CHUNK_SIZE);
    const docs = await model.find({ [field]: { $in: chunk } }, { [field]: 1 }).lean();
    for (const d of docs) {
      if (d[field] !== undefined && d[field] !== null) {
        foundSet.add(String(d[field]).toLowerCase());
      }
    }
  }
  return foundSet;
}

/**
 * Core validation engine: parses workbook buffer, checks headers, detects in-file duplicates,
 * validates foreign keys with preloaded context, and reports progress.
 */
async function scanAndValidateWorkbook(type, buffer, req, { onProgress } = {}) {
  const schema = getSchema(type);

  // 1. Load Workbook (.xlsx via load or .csv via stream)
  const workbook = new ExcelJS.Workbook();
  const isXlsx = buffer && buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4B;

  try {
    if (isXlsx) {
      await workbook.xlsx.load(buffer);
    } else {
      const stream = Readable.from(buffer);
      await workbook.csv.read(stream);
    }
  } catch (err) {
    throw new Error('Invalid spreadsheet file: ' + err.message);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('Spreadsheet contains no sheets');

  // 2. Exact Header Mapping (A6)
  const headerRow = worksheet.getRow(1);
  const colIndexToKey = {};
  const unknownColumns = [];
  const mappedKeys = new Set();

  headerRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
    const rawHeader = cellToText(cell);
    if (!rawHeader) return;

    const matchedCol = findColumn(type, rawHeader);
    if (matchedCol) {
      colIndexToKey[colNum] = matchedCol;
      mappedKeys.add(matchedCol.key);
    } else {
      unknownColumns.push({ colNum, header: rawHeader });
    }
  });

  // Check missing required columns first (Friendly failure instead of N row errors)
  const missingRequired = schema.columns.filter(c => c.required && !mappedKeys.has(c.key));
  if (missingRequired.length > 0) {
    const missingNames = missingRequired.map(c => c.label).join(', ');
    throw new Error(`Spreadsheet is missing required column(s): ${missingNames}`);
  }

  // 3. Extract data rows
  const parsedRows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return; // skip header row
    const rowObj = {};
    let hasAnyData = false;

    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const colDef = colIndexToKey[colNum];
      if (colDef) {
        const textVal = cellToText(cell);
        rowObj[colDef.key] = textVal;
        if (textVal !== '') hasAnyData = true;
      }
    });

    if (hasAnyData) {
      parsedRows.push({ rowNumber: rowNum, data: rowObj });
    }
  });

  if (!parsedRows.length) {
    throw new Error('Spreadsheet has no data rows');
  }

  // Row cap invariant (5,000 rows max per import)
  const MAX_ROWS = 5000;
  if (parsedRows.length > MAX_ROWS) {
    throw new Error(`Spreadsheet exceeds maximum limit of ${MAX_ROWS} rows (found ${parsedRows.length} rows). Please split into smaller batches.`);
  }

  // Scope check for department creation (A20) — fail-fast before preloading reference context
  const isSudo = isSudoCaller(req?.user);
  if (type === 'dept' && !isSudo) {
    throw new Error('Department creation requires global administrator privileges');
  }

  // 4. Preload reference context & Chunked DB lookups (A9, A20)
  const [allDepts, allClasses, allSubjects, activeYearDoc] = await Promise.all([
    M.Department.find({}).lean(),
    M.Class.find({}).lean(),
    M.Subject.find({}).lean(),
    M.Year.findOne({ isCurrent: true }).lean()
  ]);

  const activeBatches = activeYearDoc ? activeYearDoc.batches.map(b => normalizeYearRange(b.batch).toLowerCase()) : [];

  // Preload DB existence sets in chunks of 1000
  let existingUsernames = new Set();
  let existingRegNos = new Set();
  let existingEmpNos = new Set();

  if (type === 'student') {
    const fileUsernames = parsedRows.map(r => r.data.username).filter(Boolean);
    const fileRegNos = parsedRows.map(r => r.data.registerNo).filter(Boolean);
    [existingUsernames, existingRegNos] = await Promise.all([
      chunkedInLookup(M.User, 'username', fileUsernames.map(u => u.toLowerCase())),
      chunkedInLookup(M.Student, 'registerNo', fileRegNos)
    ]);
  } else if (type === 'teacher') {
    const fileUsernames = parsedRows.map(r => r.data.username).filter(Boolean);
    const fileEmpNos = parsedRows.map(r => r.data.employeeNo).filter(Boolean);
    [existingUsernames, existingEmpNos] = await Promise.all([
      chunkedInLookup(M.User, 'username', fileUsernames.map(u => u.toLowerCase())),
      chunkedInLookup(M.Teacher, 'employeeNo', fileEmpNos)
    ]);
  }

  // 5. In-file duplicate tracking maps (A9)
  const seenUsernames = new Map();
  const seenRegNos = new Map();
  const seenEmpNos = new Map();
  const seenDeptCodes = new Map();
  const seenDeptNames = new Map();
  const seenClassNames = new Map();
  const seenSubjectCodes = new Map();

  const eligibleRows = [];
  const skippedRows = [];

  // 6. Validate rows with batch yielding
  for (let i = 0; i < parsedRows.length; i++) {
    const { rowNumber, data: rawData } = parsedRows[i];
    const rowIssues = [];
    const normalizedData = {};

    // Column normalization and schema validation
    for (const col of schema.columns) {
      const rawVal = rawData[col.key] || '';
      const normVal = col.normalize ? col.normalize(rawVal) : rawVal;
      normalizedData[col.key] = normVal;

      if (col.validate) {
        const issue = col.validate(normVal, rawVal);
        if (issue) rowIssues.push(issue);
      }
    }

    // Business domain validation per type
    if (type === 'student') {
      const { fullName, registerNo, gender, academicYear, batch, courseType, branch, department: deptName, class: className, email, username, residency, password } = normalizedData;
      const { firstName, lastName } = splitFirstLastName(fullName);

      // In-file duplicate checks
      if (registerNo) {
        const regLower = registerNo.toLowerCase();
        if (seenRegNos.has(regLower)) {
          rowIssues.push(`Duplicate RegisterNo "${registerNo}" in file (previously seen on row ${seenRegNos.get(regLower)})`);
        } else {
          seenRegNos.set(regLower, rowNumber);
        }
      }

      if (username) {
        const uLower = username.toLowerCase();
        const RESERVED_USERNAMES = ['admin', 'administrator', 'system', 'root', 'sudo', 'superuser'];
        if (RESERVED_USERNAMES.includes(uLower) || uLower.startsWith('sb-') || uLower.startsWith('tr-')) {
          rowIssues.push(`Username "${username}" is reserved by the system`);
        } else if (seenUsernames.has(uLower)) {
          rowIssues.push(`Duplicate Username "${username}" in file (previously seen on row ${seenUsernames.get(uLower)})`);
        } else {
          seenUsernames.set(uLower, rowNumber);
        }
      }

      // Live DB duplicate checks
      if (registerNo && existingRegNos.has(registerNo.toLowerCase())) {
        rowIssues.push(`RegisterNo ${registerNo} already exists in database`);
      }
      if (username && existingUsernames.has(username.toLowerCase())) {
        rowIssues.push(`Username "${username}" already taken`);
      }

      // Department scope isolation
      const matchedDept = allDepts.find(d =>
        d.name.toLowerCase() === deptName.toLowerCase() ||
        d.code.toLowerCase() === deptName.toLowerCase()
      );
      if (!matchedDept && deptName) {
        rowIssues.push(`Department "${deptName}" not found`);
      } else if (matchedDept && !assertInScope(req, matchedDept._id, 'bulk')) {
        rowIssues.push(`Department "${deptName}" is outside your administrative scope`);
      }

      // Class verification & validation (A9)
      const matchedClass = allClasses.find(c => c.name.toLowerCase() === className.toLowerCase());
      if (!matchedClass && className) {
        rowIssues.push(`Class "${className}" not found in database`);
      } else if (matchedClass && matchedDept) {
        if (String(matchedClass.deptId) !== String(matchedDept._id)) {
          rowIssues.push(`Class "${className}" belongs to a different department`);
        }
      }

      if (rowIssues.length) {
        skippedRows.push({ rowNumber, name: fullName || '(blank)', issues: rowIssues, data: rawData });
      } else {
        const trackId = buildStudentTrackId(registerNo, matchedDept || deptName, batch, academicYear, allDepts);
        eligibleRows.push({
          rowNumber,
          data: {
            fullName,
            firstName,
            lastName,
            registerNo,
            trackId,
            gender,
            batch,
            academicYear,
            courseType,
            branch,
            department: matchedDept ? matchedDept.name : deptName,
            deptId: matchedDept ? matchedDept._id : null,
            class: className,
            classId: matchedClass ? matchedClass._id : null,
            residency,
            email,
            username,
            password
          },
          isVerified: false,
          emailSent: false
        });
      }
    } else if (type === 'teacher') {
      const { name, department: dn, employeeNo: empId, designation, username: user, password: pass, email, gender } = normalizedData;
      const { firstName, lastName } = splitFirstLastName(name);

      // In-file duplicate checks
      if (empId) {
        const empLower = empId.toLowerCase();
        if (seenEmpNos.has(empLower)) {
          rowIssues.push(`Duplicate EmployeeID "${empId}" in file (previously seen on row ${seenEmpNos.get(empLower)})`);
        } else {
          seenEmpNos.set(empLower, rowNumber);
        }
      }

      if (user) {
        const uLower = user.toLowerCase();
        const RESERVED_USERNAMES = ['admin', 'administrator', 'system', 'root', 'sudo', 'superuser'];
        if (RESERVED_USERNAMES.includes(uLower) || uLower.startsWith('sb-') || uLower.startsWith('tr-')) {
          rowIssues.push(`Username "${user}" is reserved by the system`);
        } else if (seenUsernames.has(uLower)) {
          rowIssues.push(`Duplicate Username "${user}" in file (previously seen on row ${seenUsernames.get(uLower)})`);
        } else {
          seenUsernames.set(uLower, rowNumber);
        }
      }

      // DB duplicates
      if (user && existingUsernames.has(user.toLowerCase())) {
        rowIssues.push(`Username "${user}" already taken`);
      }
      if (empId && existingEmpNos.has(empId.toLowerCase())) {
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
        skippedRows.push({ rowNumber, name: name || '(blank)', issues: rowIssues, data: rawData });
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
            designation,
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
      const { name, code, number, courseType, branch, category, icon } = normalizedData;

      // In-file duplicate check
      if (code) {
        const cLower = code.toLowerCase();
        if (seenDeptCodes.has(cLower)) {
          rowIssues.push(`Duplicate Department Code "${code}" in file (previously seen on row ${seenDeptCodes.get(cLower)})`);
        } else {
          seenDeptCodes.set(cLower, rowNumber);
        }
      }
      if (name) {
        const nLower = name.toLowerCase();
        if (seenDeptNames.has(nLower)) {
          rowIssues.push(`Duplicate Department Name "${name}" in file (previously seen on row ${seenDeptNames.get(nLower)})`);
        } else {
          seenDeptNames.set(nLower, rowNumber);
        }
      }

      // Existing DB check
      if (code && allDepts.some(d => d.code.toUpperCase() === code.toUpperCase())) {
        rowIssues.push(`Department code "${code.toUpperCase()}" already exists`);
      }
      if (name && allDepts.some(d => d.name.toLowerCase() === name.toLowerCase())) {
        rowIssues.push(`Department name "${name}" already exists`);
      }

      if (rowIssues.length) {
        skippedRows.push({ rowNumber, name: name || '(blank)', issues: rowIssues, data: rawData });
      } else {
        eligibleRows.push({
          rowNumber,
          data: { name, code: code.toUpperCase(), icon, number, courseType, branch, category },
          isVerified: true
        });
      }
    } else if (type === 'class') {
      const { department: dn, hallNo: hall, sem, batch: batchVal, year: yr, name: explicitName } = normalizedData;

      if (batchVal && activeBatches.length && !activeBatches.includes(batchVal.toLowerCase())) {
        rowIssues.push(`Batch "${batchVal}" not active under current Academic Year`);
      }

      const dept = allDepts.find(d =>
        d.name.toLowerCase() === dn.toLowerCase() ||
        d.code.toLowerCase() === dn.toLowerCase()
      );

      if (dept && !assertInScope(req, dept._id, 'bulk')) {
        rowIssues.push(`Department "${dn}" is outside your administrative scope`);
      }

      const batchParts = (batchVal || '').split('-').map(s => s.trim());
      const batchShort = batchParts.length === 2 ? `${batchParts[0].slice(-2)}-${batchParts[1].slice(-2)}` : (batchVal || '');
      const deptCodeVal = dept ? dept.code : dn;
      const className = explicitName || `${batchShort} ${deptCodeVal}`;

      // In-file duplicate check
      if (className) {
        const clLower = className.toLowerCase();
        if (seenClassNames.has(clLower)) {
          rowIssues.push(`Duplicate Class "${className}" in file (previously seen on row ${seenClassNames.get(clLower)})`);
        } else {
          seenClassNames.set(clLower, rowNumber);
        }
      }

      // DB check
      if (className && allClasses.some(c => c.name.toLowerCase() === className.toLowerCase())) {
        rowIssues.push(`Class "${className}" already exists`);
      }

      if (rowIssues.length) {
        skippedRows.push({ rowNumber, name: dn || '(blank)', issues: rowIssues, data: rawData });
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
      const { name, code, department: dn, credits, type: subType } = normalizedData;

      const dept = allDepts.find(d =>
        d.name.toLowerCase() === dn.toLowerCase() ||
        d.code.toLowerCase() === dn.toLowerCase()
      );

      if (dept && !assertInScope(req, dept._id, 'bulk')) {
        rowIssues.push(`Department "${dn}" is outside your administrative scope`);
      }

      const subjectCode = dept ? `${dept.code}-${code.toUpperCase()}` : code.toUpperCase();

      // In-file duplicate check
      if (subjectCode) {
        const scLower = subjectCode.toLowerCase();
        if (seenSubjectCodes.has(scLower)) {
          rowIssues.push(`Duplicate SubjectCode "${subjectCode}" in file (previously seen on row ${seenSubjectCodes.get(scLower)})`);
        } else {
          seenSubjectCodes.set(scLower, rowNumber);
        }
      }

      // DB check
      if (dept && code) {
        if (allSubjects.some(s => s.subjectCode === subjectCode)) {
          rowIssues.push(`SubjectCode "${subjectCode}" already exists`);
        }
      }

      if (rowIssues.length) {
        skippedRows.push({ rowNumber, name: name || '(blank)', issues: rowIssues, data: rawData });
      } else {
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

    // Yield every 200 rows to keep event loop responsive & emit progress
    if ((i + 1) % 200 === 0 || i === parsedRows.length - 1) {
      if (typeof onProgress === 'function') {
        onProgress({
          processed: i + 1,
          total: parsedRows.length,
          eligible: eligibleRows.length,
          skipped: skippedRows.length
        });
      }
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  return {
    totalRows: parsedRows.length,
    eligibleRows,
    skippedRows,
    unknownColumns
  };
}

module.exports = {
  cellToText,
  chunkedInLookup,
  scanAndValidateWorkbook
};
