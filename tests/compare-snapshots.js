const fs = require('fs');
const path = require('path');
const M = require('../models');
const { scanAndValidateWorkbook } = require('../services/bulk/scan');

function installHermeticMocks() {
  const origDeptFind = M.Department.find;
  const origClassFind = M.Class.find;
  const origSubjFind = M.Subject.find;
  const origYearFindOne = M.Year.findOne;
  const origUserFind = M.User.find;
  const origUserFindOne = M.User.findOne;
  const origStudFind = M.Student.find;
  const origStudFindOne = M.Student.findOne;
  const origTchFind = M.Teacher.find;
  const origTchFindOne = M.Teacher.findOne;

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

  const sampleSubj = {
    _id: '60d5ec49f1b2c8b1f8e4e1a3',
    name: 'Data Structures',
    code: 'CS201',
    deptId: sampleDept._id
  };

  const sampleYear = {
    _id: '60d5ec49f1b2c8b1f8e4e1a4',
    isCurrent: true,
    year: '2025-2026',
    batches: [{ batch: '2025-2029' }]
  };

  const mockQuery = (result) => ({
    lean: () => Promise.resolve(result),
    then: (resolve) => Promise.resolve(result).then(resolve)
  });

  M.Department.find = () => mockQuery([sampleDept]);
  M.Class.find = () => mockQuery([sampleClass]);
  M.Subject.find = () => mockQuery([sampleSubj]);
  M.Year.findOne = () => mockQuery(sampleYear);
  M.User.find = () => mockQuery([]);
  M.User.findOne = () => mockQuery(null);
  M.Student.find = () => mockQuery([]);
  M.Student.findOne = () => mockQuery(null);
  M.Teacher.find = () => mockQuery([]);
  M.Teacher.findOne = () => mockQuery(null);

  return () => {
    M.Department.find = origDeptFind;
    M.Class.find = origClassFind;
    M.Subject.find = origSubjFind;
    M.Year.findOne = origYearFindOne;
    M.User.find = origUserFind;
    M.User.findOne = origUserFindOne;
    M.Student.find = origStudFind;
    M.Student.findOne = origStudFindOne;
    M.Teacher.find = origTchFind;
    M.Teacher.findOne = origTchFindOne;
  };
}

async function compareAll() {
  const restore = installHermeticMocks();
  try {
    const types = ['dept', 'teacher', 'class', 'subject', 'student'];
    for (const t of types) {
      const snapPath = path.join(__dirname, 'snapshots', 'bulk', `${t}.snapshot.json`);
      const existing = JSON.parse(fs.readFileSync(snapPath, 'utf8'));

      const filePath = path.join(__dirname, 'fixtures', 'bulk', `${t}.xlsx`);
      const buf = fs.readFileSync(filePath);
      const fakeReq = {
        user: { _id: '60d5ec49f1b2c8b1f8e4e100', role: 'sudo', trackId: 'TRADM100', name: 'Admin User' }
      };

      const res = await scanAndValidateWorkbook(t, buf, fakeReq);
      const sanitizedEligible = res.eligibleRows.map(r => {
        const copy = JSON.parse(JSON.stringify(r));
        if (copy.data && copy.data.password) copy.data.password = '[REDACTED]';
        return copy;
      });

      const actual = {
        type: t,
        totalRows: res.totalRows,
        eligibleCount: res.eligibleRows.length,
        skippedCount: res.skippedRows.length,
        eligibleRows: sanitizedEligible,
        skippedRows: res.skippedRows
      };

      console.log(`\n=== TYPE: ${t.toUpperCase()} ===`);
      console.log(`Eligible: Expected ${existing.eligibleCount} | Actual ${actual.eligibleCount}`);
      console.log(`Skipped:  Expected ${existing.skippedCount} | Actual ${actual.skippedCount}`);
      
      for (let i = 0; i < actual.skippedRows.length; i++) {
        const expRow = existing.skippedRows[i] || {};
        const actRow = actual.skippedRows[i] || {};
        console.log(`  Row ${actRow.rowNumber || expRow.rowNumber}:`);
        console.log(`    Expected issues:`, expRow.issues);
        console.log(`    Actual issues:  `, actRow.issues);
      }
    }
  } finally {
    restore();
  }
}

compareAll().catch(console.error);
