/**
 * tests/test-bulk-f31-f32.js
 * Unit test suite verifying F-31 (Atomic Rescan CAS Double-Click Protection)
 * and F-32 (Read-Only Sub-Admin Restrictions on Comments & Clone).
 */

const assert = require('assert');
const mongoose = require('mongoose');

async function runTests() {
  console.log('Running F-31 & F-32 Verification Suite...');

  // ── TEST 1: F-32 loadBatch('ownerOrSudo') on comments and clone ──
  const { loadBatch } = require('../services/bulk/access');
  const M = require('../models');

  const ownerId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();
  const sudoUserId = new mongoose.Types.ObjectId();
  const deptId = new mongoose.Types.ObjectId();

  const testBatchDoc = {
    _id: new mongoose.Types.ObjectId(),
    status: 'staged',
    type: 'student',
    uploadedBy: {
      userId: ownerId,
      deptId: deptId
    }
  };

  // Mock M.BulkImportBatch.findById
  const origFindById = M.BulkImportBatch.findById;
  let currentBatchStatus = 'staged';
  M.BulkImportBatch.findById = (id) => {
    const doc = { ...testBatchDoc, status: currentBatchStatus };
    return {
      select: () => ({
        lean: async () => ({ _id: id, status: currentBatchStatus })
      }),
      then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject)
    };
  };

  // 1a. Sub-admin (same dept, not owner, not sudo) accessing with loadBatch('ownerOrSudo')
  const subAdminReq = {
    params: { id: testBatchDoc._id },
    user: {
      _id: otherUserId,
      role: 'admin',
      adminFlag: 'subadmin',
      deptId: deptId
    }
  };

  let subAdminStatus = null;
  let subAdminResponse = null;
  const subAdminRes = {
    status: (code) => {
      subAdminStatus = code;
      return {
        json: (payload) => { subAdminResponse = payload; }
      };
    }
  };

  const ownerOrSudoMiddleware = loadBatch('ownerOrSudo');
  await ownerOrSudoMiddleware(subAdminReq, subAdminRes, () => {
    assert.fail('Should not call next() for non-owner sub-admin');
  });

  assert.strictEqual(subAdminStatus, 403, 'Sub-admin should receive 403 Forbidden');
  assert.ok(subAdminResponse.error.includes('owner or sudo only'), 'Error message should indicate owner or sudo only');
  console.log('  [PASS] F-32: Sub-admin is denied (403) on ownerOrSudo routes (comments and clone)');

  // 1b. Owner caller is allowed
  const ownerReq = {
    params: { id: testBatchDoc._id },
    user: {
      _id: ownerId,
      role: 'teacher',
      deptId: deptId
    }
  };
  let ownerPassed = false;
  await ownerOrSudoMiddleware(ownerReq, {}, () => {
    ownerPassed = true;
  });
  assert.strictEqual(ownerPassed, true, 'Owner should pass ownerOrSudo middleware');
  console.log('  [PASS] F-32: Batch owner is granted access to ownerOrSudo routes');

  // 1c. Sudo caller is allowed
  const sudoReq = {
    params: { id: testBatchDoc._id },
    user: {
      _id: sudoUserId,
      role: 'sudo',
      pageRights: [{ accessRole: 'sudoAdmin' }]
    }
  };
  let sudoPassed = false;
  await ownerOrSudoMiddleware(sudoReq, {}, () => {
    sudoPassed = true;
  });
  assert.strictEqual(sudoPassed, true, 'Sudo admin should pass ownerOrSudo middleware');
  console.log('  [PASS] F-32: Sudo admin is granted access to ownerOrSudo routes');

  // ── TEST 2: F-31 Atomic Rescan CAS Transition ──
  const { transition, StateConflictError } = require('../services/bulk/stateMachine');
  const origFindOneAndUpdate = M.BulkImportBatch.findOneAndUpdate;

  currentBatchStatus = 'staged';
  M.BulkImportBatch.findOneAndUpdate = async (filter, update) => {
    if (filter.status.$in && filter.status.$in.includes(currentBatchStatus)) {
      currentBatchStatus = update.$set.status;
      return { _id: filter._id, status: currentBatchStatus };
    }
    return null;
  };

  // First transition: staged -> processing
  const res1 = await transition(testBatchDoc._id, 'processing', {
    from: ['staged', 'skipped_resolved']
  });
  assert.strictEqual(res1.status, 'processing', 'First rescan CAS transition should succeed');
  assert.strictEqual(currentBatchStatus, 'processing');
  console.log('  [PASS] F-31: First rescan transition atomically claims the batch to processing');

  // Second transition attempt (simulating concurrent double click):
  let secondCallFailed = false;
  try {
    await transition(testBatchDoc._id, 'processing', {
      from: ['staged', 'skipped_resolved']
    });
  } catch (err) {
    secondCallFailed = true;
    assert.strictEqual(err.status, 409, 'Concurrent transition must throw 409 StateConflictError');
    assert.ok(err.message.includes('Cannot transition batch from status "processing" to "processing"'), 'Should explain conflict');
  }
  assert.strictEqual(secondCallFailed, true, 'Second rescan click must fail with conflict');
  console.log('  [PASS] F-31: Double-click rescan CAS immediately rejects with 409 conflict');

  // Restore mocks
  M.BulkImportBatch.findById = origFindById;
  M.BulkImportBatch.findOneAndUpdate = origFindOneAndUpdate;

  console.log('All F-31 & F-32 tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
