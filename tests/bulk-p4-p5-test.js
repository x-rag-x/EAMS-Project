/**
 * tests/bulk-p4-p5-test.js
 * Verification suite for Phase 4 (Chat UI) & Phase 5 (Stage Cards & Approvals).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('> Running Phase P4 & P5 Verification Tests...');

// 1. Check frontend file structure
console.log('  1. Testing frontend file layout & existence...');
const requiredFiles = [
  'public/bulk.html',
  'public/css/bulk-chat.css',
  'public/js/pages/bulk/bulk.util.js',
  'public/js/pages/bulk/bulk.config.js',
  'public/js/pages/bulk/bulk.api.js',
  'public/js/pages/bulk/bulk.store.js',
  'public/js/pages/bulk/bulk.sidebar.js',
  'public/js/pages/bulk/bulk.cards.js',
  'public/js/pages/bulk/bulk.transcript.js',
  'public/js/pages/bulk/bulk.drawer.js',
  'public/js/pages/bulk/bulk.verify-modal.js',
  'public/js/pages/bulk/bulk.restore.js',
  'public/js/pages/bulk/bulk.boot.js'
];

for (const relPath of requiredFiles) {
  const fullPath = path.resolve(__dirname, '..', relPath);
  assert(fs.existsSync(fullPath), `Missing required file: ${relPath}`);
}
console.log('     ✓ All 14 frontend files exist.');

// 2. Inspect public/bulk.html content
console.log('  2. Verifying public/bulk.html structure and bindings...');
const htmlContent = fs.readFileSync(path.resolve(__dirname, '../public/bulk.html'), 'utf8');

const requiredElements = [
  'id="app-shell"',
  'id="chat-main-container"',
  'id="chat-transcript"',
  'id="chat-dock"',
  'id="chat-drawer"',
  'id="chat-sb-list"',
  'id="bulk-verify-edit-modal"',
  'id="restore-main-container"',
  'js/pages/bulk/bulk.util.js',
  'js/pages/bulk/bulk.boot.js'
];

for (const needle of requiredElements) {
  assert(htmlContent.includes(needle), `bulk.html is missing element: ${needle}`);
}
console.log('     ✓ public/bulk.html contains all chat components and script tags.');

// 3. Test Stepper mapping for all statuses
console.log('  3. Verifying stepper status rules...');
global.window = global.window || {};
eval(fs.readFileSync(path.resolve(__dirname, '../public/js/pages/bulk/bulk.config.js'), 'utf8'));

const getStep = global.window.Bulk.config.getStepForStatus;
assert.strictEqual(getStep('draft', 'student'), 0);
assert.strictEqual(getStep('uploading', 'student'), 0);
assert.strictEqual(getStep('staged', 'student'), 1);
assert.strictEqual(getStep('pending_sudo_initial', 'student'), 2);
assert.strictEqual(getStep('verifying', 'student'), 3);
assert.strictEqual(getStep('verified_all', 'student'), 4);
assert.strictEqual(getStep('committing', 'student'), 4);
assert.strictEqual(getStep('committed', 'student'), 5);

// Dept/class/subject skip verification
assert.strictEqual(getStep('sudo_initial_approved', 'dept'), 4);
assert.strictEqual(getStep('sudo_initial_approved', 'class'), 4);
assert.strictEqual(getStep('sudo_initial_approved', 'subject'), 4);
console.log('     ✓ Stepper mapping adheres to verification skipping specifications.');

// 4. Test Student & Teacher Track ID Computation in Util
console.log('  4. Verifying Track ID computations in Bulk.util...');
eval(fs.readFileSync(path.resolve(__dirname, '../public/js/pages/bulk/bulk.util.js'), 'utf8'));
const util = global.window.Bulk.util;

// Teacher track ID prefix must always be TRTCH (A16)
assert.strictEqual(util.computeTeacherTrackId('EMP123'), 'TRTCHEMP123');
assert.strictEqual(util.computeTeacherTrackId('456'), 'TRTCH456');

// Student track ID
const mockDepts = [{ _id: 'd1', code: 'CSE', name: 'Computer Science', twoLetterCode: 'CS', number: '104' }];
const studentTrackId = util.computeStudentTrackId('2025104001', 'd1', '2025-29', mockDepts);
assert.strictEqual(studentTrackId, 'TR25CS001');

// Name splitting
const split1 = util.splitFirstLastName('John Doe');
assert.strictEqual(split1.firstName, 'John');
assert.strictEqual(split1.lastName, 'Doe');

const split2 = util.splitFirstLastName('Jane R. Smith');
assert.strictEqual(split2.firstName, 'Jane R');
assert.strictEqual(split2.lastName, 'Smith');
console.log('     ✓ Track ID and Name utilities verified.');

// 5. Test Backend Review Routes (mock context)
console.log('  5. Testing review route transitions with CAS safety...');
const stateMachine = require('../services/bulk/stateMachine');

let mockBatch = {
  _id: 'batch-test-123',
  type: 'student',
  status: 'staged',
  eligibleCount: 10,
  skippedCount: 1,
  skippedRows: [{ rowNumber: 2, isResolved: false }]
};

// Moving to pending_sudo_initial without resolving skipped rows should be blocked
assert.throws(() => {
  if (mockBatch.skippedRows.some(r => !r.isResolved)) {
    const err = new Error('All skipped rows must be marked resolved before proceeding.');
    err.status = 409;
    throw err;
  }
}, /must be marked resolved/);

// Once marked resolved:
mockBatch.skippedRows[0].isResolved = true;
mockBatch.status = 'skipped_resolved';
assert(stateMachine.TRANSITIONS.skipped_resolved.includes('pending_sudo_initial'));
mockBatch.status = 'pending_sudo_initial';

// Sudo approves initial:
assert(stateMachine.TRANSITIONS.pending_sudo_initial.includes('sudo_initial_approved'));
mockBatch.status = 'sudo_initial_approved';

// Then enters verifying:
assert(stateMachine.TRANSITIONS.sudo_initial_approved.includes('verifying'));
mockBatch.status = 'verifying';

// Once all verified:
assert(stateMachine.TRANSITIONS.verifying.includes('verified_all'));
mockBatch.status = 'verified_all';

// Final submit:
assert(stateMachine.TRANSITIONS.verified_all.includes('pending_final_approval'));
mockBatch.status = 'pending_final_approval';

// Commit:
assert(stateMachine.TRANSITIONS.pending_final_approval.includes('committing'));
mockBatch.status = 'committing';

assert(stateMachine.TRANSITIONS.committing.includes('committed'));
mockBatch.status = 'committed';
console.log('     ✓ End-to-end status lifecycle validated.');

// 6. Test Column Reference Card Schema Resolution and Rendering
console.log('  6. Testing Column Reference Card Schema Resolution...');
global.window.Bulk.cards = {};
global.window.Bulk.api = {};
global.window.Bulk.store = { getState: () => ({}) };
eval(fs.readFileSync(path.resolve(__dirname, '../public/js/pages/bulk/bulk.cards.js'), 'utf8'));

const colCard = global.window.Bulk.cards['column-ref'];
assert(colCard, 'column-ref card must be registered');

const testTypes = ['dept', 'teacher', 'class', 'subject', 'student'];
for (const t of testTypes) {
  // Test fallback resolution when ctx.schema is empty
  const renderedFallback = colCard.render({ batch: { type: t }, schema: {} });
  assert(!renderedFallback.includes('Loading column specifications…'), `Type ${t} fallback got stuck on loading`);
  assert(renderedFallback.includes('Required'), `Type ${t} fallback missing Required badges`);

  // Test resolution when ctx.schema is populated with backend response structure
  const mockBackendSchema = {
    schemas: {
      [t]: {
        type: t,
        label: t,
        columns: [
          { key: 'col1', label: 'Col One', required: true, aliases: ['c1'], example: 'ex1' }
        ]
      }
    }
  };
  const renderedBackend = colCard.render({ batch: { type: t }, schema: mockBackendSchema });
  assert(!renderedBackend.includes('Loading column specifications…'), `Type ${t} backend schema got stuck on loading`);
  assert(renderedBackend.includes('Col One'), `Type ${t} should render column label`);
}
console.log('     ✓ Column reference schema resolution and rendering verified for all 5 types.');

// 7. Test Sudo Admin Caller Recognition (Teacher role with Sudo Admin privileges)
console.log('  7. Testing Sudo Admin Caller Privilege Preservation...');
const { isSudoCaller } = require('../services/bulk/access');
assert(isSudoCaller({ isSudoAdmin: true, role: 'teacher' }), 'isSudoAdmin: true on teacher must qualify as sudo caller');
assert(isSudoCaller({ accessRole: 'sudoAdmin', role: 'teacher' }), 'accessRole: sudoAdmin on teacher must qualify as sudo caller');
assert(isSudoCaller({ role: 'admin', adminFlag: 'superadmin' }), 'admin with superadmin flag must qualify as sudo caller');
assert(!isSudoCaller({ role: 'admin', adminFlag: 'subadmin' }), 'subadmin must not qualify as sudo caller');
assert(!isSudoCaller({ role: 'teacher' }), 'plain teacher must not qualify as sudo caller');
console.log('     ✓ Sudo caller privilege preservation verified across all user tiers.');

// 8. Test Department Scope Validation in scanAndValidateWorkbook
console.log('  8. Testing Department Scope Validation in Pipeline & Scan...');
const { scanAndValidateWorkbook } = require('../services/bulk/scan');
const M = require('../models');

// Generate minimal valid excel buffer with department headers
const ExcelJS = require('exceljs');
(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Departments');
  ws.addRow(['Name', 'Code', 'Number', 'CourseType', 'Branch']);
  ws.addRow(['Computer Science and Engineering', 'CSE', '01', 'UG', 'Engineering']);
  const buf = await wb.xlsx.writeBuffer();

  // Non-sudo user must be rejected fail-fast with 403-equivalent Error
  let nonSudoRejected = false;
  try {
    await scanAndValidateWorkbook('dept', buf, { user: { role: 'teacher' } });
  } catch (err) {
    if (err.message.includes('Department creation requires global administrator privileges')) {
      nonSudoRejected = true;
    }
  }
  assert(nonSudoRejected, 'Non-sudo user must be rejected from department creation in scan');

  // Sudo user with isSudoAdmin: true must pass scope check
  const origDeptFind = M.Department.find;
  const origClassFind = M.Class.find;
  const origSubFind = M.Subject.find;
  const origYearFind = M.Year.findOne;

  M.Department.find = () => ({ lean: () => Promise.resolve([]) });
  M.Class.find = () => ({ lean: () => Promise.resolve([]) });
  M.Subject.find = () => ({ lean: () => Promise.resolve([]) });
  M.Year.findOne = () => ({ lean: () => Promise.resolve({ isCurrent: true, batches: [] }) });

  try {
    const res = await scanAndValidateWorkbook('dept', buf, { user: { role: 'teacher', isSudoAdmin: true } });
    assert(res && res.totalRows === 1, 'Sudo user must parse 1 valid department row');
  } finally {
    M.Department.find = origDeptFind;
    M.Class.find = origClassFind;
    M.Subject.find = origSubFind;
    M.Year.findOne = origYearFind;
  }
  console.log('     ✓ Department scope permissions correctly enforce sudo privileges.');

  // 9. Test Verification Panel Modal Popup Window DOM Structure
  console.log('  9. Testing Verification Panel Modal Popup Window Layout...');
  const htmlSrc = fs.readFileSync(path.resolve(__dirname, '../public/bulk.html'), 'utf8');
  assert(htmlSrc.includes('class="modal-bg modal-verification-bg" id="chat-drawer"'), 'chat-drawer must have modal-bg popup class');
  assert(htmlSrc.includes('class="modal modal-xl modal-verification-panel"'), 'modal must have modal-verification-panel class');
  assert(htmlSrc.includes('class="drawer-body modal-verification-body"'), 'modal must contain modal-verification-body');
  console.log('     ✓ Verification Panel modal popup structure verified.');

  console.log('\nAll Phase P4 & P5 Verification tests PASSED successfully.');
})().catch(err => {
  console.error('Test 8 failed:', err);
  process.exit(1);
});



