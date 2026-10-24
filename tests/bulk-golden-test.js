/**
 * Golden Snapshot Test for Bulk Import Scan & Validation
 * Runs 5 fixture workbooks through scanAndValidateWorkbook and records/verifies snapshots.
 */
const fs = require('fs');
const path = require('path');
const M = require('../models');
const { scanAndValidateWorkbook } = require('../services/bulk/scan');
const fixturesDir = path.join(__dirname, 'fixtures', 'bulk');
const snapshotsDir = path.join(__dirname, 'snapshots', 'bulk');

if (!fs.existsSync(snapshotsDir)) {
  fs.mkdirSync(snapshotsDir, { recursive: true });
}

// Deterministic mocks for offline/hermetic test execution
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

async function runGoldenTests(updateSnapshots = false) {
  const restoreMocks = installHermeticMocks();
  const types = ['dept', 'teacher', 'class', 'subject', 'student'];
  const results = {};

  try {
    for (const type of types) {
      const filePath = path.join(fixturesDir, `${type}.xlsx`);
      const buffer = fs.readFileSync(filePath);
      const fakeReq = {
        user: { _id: '60d5ec49f1b2c8b1f8e4e100', role: 'admin', trackId: 'TRADM100', name: 'Admin User' }
      };

      const scanResult = await scanAndValidateWorkbook(type, buffer, fakeReq);
      
      // Sanitize dynamically generated passwords or volatile timestamps if any
      const sanitizedEligible = scanResult.eligibleRows.map(r => {
        const copy = JSON.parse(JSON.stringify(r));
        if (copy.data && copy.data.password) copy.data.password = '[REDACTED]';
        return copy;
      });

      const summary = {
        type,
        totalRows: scanResult.totalRows,
        eligibleCount: scanResult.eligibleRows.length,
        skippedCount: scanResult.skippedRows.length,
        eligibleRows: sanitizedEligible,
        skippedRows: scanResult.skippedRows
      };

      results[type] = summary;
      const snapshotPath = path.join(snapshotsDir, `${type}.snapshot.json`);

      if (updateSnapshots || !fs.existsSync(snapshotPath)) {
        fs.writeFileSync(snapshotPath, JSON.stringify(summary, null, 2), 'utf8');
        console.log(`[SNAPSHOT RECORDED] ${type} -> ${snapshotPath}`);
      } else {
        const existing = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
        const isMatch = JSON.stringify(existing) === JSON.stringify(summary);
        if (!isMatch) {
          console.error(`[SNAPSHOT MISMATCH] ${type}`);
          console.error('Expected:', JSON.stringify(existing, null, 2));
          console.error('Actual:', JSON.stringify(summary, null, 2));
          throw new Error(`Snapshot mismatch for type "${type}"`);
        } else {
          console.log(`[SNAPSHOT VERIFIED] ${type} matches golden snapshot.`);
        }
      }
    }
  } finally {
    restoreMocks();
  }
}

const isUpdate = process.argv.includes('--update');
runGoldenTests(isUpdate)
  .then(() => {
    console.log('Golden test suite passed successfully.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Golden test error:', err.message);
    process.exit(1);
  });
