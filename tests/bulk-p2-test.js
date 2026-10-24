const assert = require('assert');
const ExcelJS = require('exceljs');
const M = require('../models');
const { cellToText, scanAndValidateWorkbook } = require('../services/bulk/scan');
const { findColumn, normalizeHeader } = require('../services/bulk/schema');

function installHermeticMocks() {
  const origDeptFind = M.Department.find;
  const origClassFind = M.Class.find;
  const origSubjFind = M.Subject.find;
  const origYearFindOne = M.Year.findOne;
  const origUserFind = M.User.find;
  const origStudFind = M.Student.find;
  const origTchFind = M.Teacher.find;

  const sampleDept = {
    _id: '60d5ec49f1b2c8b1f8e4e1a1',
    name: 'Computer Science & Engineering',
    code: 'CSE'
  };

  const sampleClass = {
    _id: '60d5ec49f1b2c8b1f8e4e1a2',
    name: '25-29 CSE',
    deptId: sampleDept._id,
    batch: '2025-2029'
  };

  const mockQuery = (result) => ({
    lean: () => Promise.resolve(result),
    then: (resolve) => Promise.resolve(result).then(resolve)
  });

  M.Department.find = () => mockQuery([sampleDept]);
  M.Class.find = () => mockQuery([sampleClass]);
  M.Subject.find = () => mockQuery([]);
  M.Year.findOne = () => mockQuery({ isCurrent: true, batches: [{ batch: '2025-2029' }] });
  M.User.find = () => mockQuery([]);
  M.Student.find = () => mockQuery([]);
  M.Teacher.find = () => mockQuery([]);

  return () => {
    M.Department.find = origDeptFind;
    M.Class.find = origClassFind;
    M.Subject.find = origSubjFind;
    M.Year.findOne = origYearFindOne;
    M.User.find = origUserFind;
    M.Student.find = origStudFind;
    M.Teacher.find = origTchFind;
  };
}

async function runP2Tests() {
  console.log('> Running Phase P2 Validation Engine Tests...');
  const restore = installHermeticMocks();

  try {
    // 1. cellToText variations (A7)
    console.log('  1. Testing cellToText with hyperlinks, formulas, dates, richText...');
    assert.strictEqual(cellToText(null), '');
    assert.strictEqual(cellToText(undefined), '');
    assert.strictEqual(cellToText(' hello '), 'hello');
    assert.strictEqual(cellToText(104), '104');
    assert.strictEqual(cellToText({ text: 'alex@student.edu', hyperlink: 'mailto:alex@student.edu' }), 'alex@student.edu');
    assert.strictEqual(cellToText({ formula: 'A1+B1', result: 'CalculatedVal' }), 'CalculatedVal');
    assert.strictEqual(cellToText({ richText: [{ text: 'Part ' }, { text: 'Two' }] }), 'Part Two');
    console.log('     ✓ cellToText passed.');

    // 2. Exact header matching vs substring matching (A6)
    console.log('  2. Testing exact header matching...');
    assert.strictEqual(findColumn('teacher', 'Username')?.key, 'username');
    assert.strictEqual(findColumn('teacher', 'Name')?.key, 'name');
    assert.strictEqual(findColumn('teacher', 'User Name')?.key, 'username');
    assert.strictEqual(findColumn('dept', 'CourseType')?.key, 'courseType');
    assert.strictEqual(findColumn('dept', 'Category')?.key, 'category');
    // "CourseType" should NOT match "category"
    assert.notStrictEqual(findColumn('dept', 'CourseType')?.key, 'category');
    console.log('     ✓ Header matching passed.');

    // 3. Fast failure on missing required columns
    console.log('  3. Testing missing required column fast-fail...');
    const incompleteWb = new ExcelJS.Workbook();
    const wsIncomplete = incompleteWb.addWorksheet('Incomplete');
    wsIncomplete.addRow(['FullName', 'Gender']); // Missing RegisterNo, AcademicYear, Batch, etc.
    wsIncomplete.addRow(['John Doe', 'Male']);
    const incompleteBuf = await incompleteWb.xlsx.writeBuffer();

    let fastFailError = null;
    try {
      await scanAndValidateWorkbook('student', incompleteBuf, { user: { role: 'sudo' } });
    } catch (err) {
      fastFailError = err;
    }
    assert.ok(fastFailError, 'Should throw fast-fail error');
    assert.ok(fastFailError.message.includes('missing required column'), 'Error should specify missing required columns');
    console.log('     ✓ Fast-fail on missing required columns passed.');

    // 4. In-file duplicate detection (A9)
    console.log('  4. Testing in-file duplicate detection...');
    const dupeWb = new ExcelJS.Workbook();
    const wsDupe = dupeWb.addWorksheet('Students');
    wsDupe.addRow([
      'FullName', 'RegisterNo', 'Gender', 'AcademicYear', 'Batch',
      'CourseType', 'Branch', 'Department', 'Class', 'Email',
      'Username', 'Password', 'Residency'
    ]);
    wsDupe.addRow([
      'Student One', 'REG999', 'Male', '2025-2026', '2025-2029',
      'UG', 'B.E', 'Computer Science & Engineering', '25-29 CSE', 's1@college.edu',
      'sone', 'Student@123', 'dayscholar'
    ]);
    wsDupe.addRow([
      'Student Two', 'REG999', 'Female', '2025-2026', '2025-2029',
      'UG', 'B.E', 'Computer Science & Engineering', '25-29 CSE', 's2@college.edu',
      'stwo', 'Student@123', 'dayscholar'
    ]);
    const dupeBuf = await dupeWb.xlsx.writeBuffer();
    const dupeRes = await scanAndValidateWorkbook('student', dupeBuf, { user: { role: 'sudo' } });

    assert.strictEqual(dupeRes.eligibleRows.length, 1, 'First row should be eligible');
    assert.strictEqual(dupeRes.skippedRows.length, 1, 'Second row with duplicate RegisterNo should be skipped');
    assert.ok(
      dupeRes.skippedRows[0].issues.some(i => i.includes('Duplicate RegisterNo "REG999" in file')),
      'Should report in-file duplicate'
    );
    console.log('     ✓ In-file duplicate detection passed.');

    // 5. CSV Parsing (A8)
    console.log('  5. Testing CSV spreadsheet ingestion...');
    const csvContent = [
      'SubjectName,Code,Credits,Type,Department',
      'Computer Networks,CS303,4,Theory,Computer Science & Engineering'
    ].join('\n');
    const csvBuf = Buffer.from(csvContent, 'utf8');
    const csvRes = await scanAndValidateWorkbook('subject', csvBuf, { user: { role: 'sudo' } });
    assert.strictEqual(csvRes.eligibleRows.length, 1, 'CSV row should be parsed and eligible');
    assert.strictEqual(csvRes.eligibleRows[0].data.code, 'CS303', 'CSV data matches');
    console.log('     ✓ CSV parsing passed.');

    // 6. Scope enforcement on Department creation (A20)
    console.log('  6. Testing scope enforcement on department import (A20)...');
    const deptWb = new ExcelJS.Workbook();
    const wsDept = deptWb.addWorksheet('Depts');
    wsDept.addRow(['Name', 'Code', 'Number', 'CourseType', 'Branch']);
    wsDept.addRow(['Information Technology', 'IT', '105', 'UG', 'B.TECH']);
    const deptBuf = await deptWb.xlsx.writeBuffer();

    let scopeErr = null;
    try {
      await scanAndValidateWorkbook('dept', deptBuf, { user: { role: 'teacher', deptId: '60d5ec49f1b2c8b1f8e4e1a1' } });
    } catch (err) {
      scopeErr = err;
    }
    assert.ok(scopeErr, 'Teacher should not be allowed to create departments');
    assert.ok(scopeErr.message.includes('requires global administrator privileges'), 'Expected admin privileges error');
    console.log('     ✓ Department scope enforcement passed.');

    console.log('\nAll Phase P2 Validation Engine tests PASSED successfully.');
  } finally {
    restore();
  }
}

runP2Tests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Phase P2 Test Failure:', err);
    process.exit(1);
  });
