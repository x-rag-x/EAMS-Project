const assert = require('assert');
const mongoose = require('mongoose');
const M = require('../models');
const { isSudoCaller, canView, toClient, loadBatch } = require('../services/bulk/access');
const { transition, StateConflictError } = require('../services/bulk/stateMachine');
const { postMessage } = require('../services/bulk/messages');
const { bus } = require('../services/bulk/progress');

async function runP1Tests() {
  console.log('> Running Phase P1 Foundation Tests...');

  const teacherA = {
    _id: new mongoose.Types.ObjectId('60d5ec49f1b2c8b1f8e4e101'),
    name: 'Teacher Alice',
    role: 'teacher'
  };

  const teacherB = {
    _id: new mongoose.Types.ObjectId('60d5ec49f1b2c8b1f8e4e102'),
    name: 'Teacher Bob',
    role: 'teacher'
  };

  const sudoUser = {
    _id: new mongoose.Types.ObjectId('60d5ec49f1b2c8b1f8e4e100'),
    name: 'Sudo Admin',
    role: 'sudo'
  };

  const batchA = {
    _id: new mongoose.Types.ObjectId('60d5ec49f1b2c8b1f8e4e201'),
    batchTrackId: 'TR-BATCH-TESTA01',
    type: 'student',
    status: 'draft',
    uploadedBy: {
      userId: teacherA._id,
      name: teacherA.name,
      role: teacherA.role
    },
    messageSeq: 0,
    eligibleRows: [
      {
        rowNumber: 2,
        data: {
          fullName: 'John Doe',
          username: 'jdoe',
          password: 'SecretPassword123'
        },
        isVerified: false
      }
    ],
    fileBufferBase64: 'SGVsbG8gV29ybGQ=',
    fileRef: { gridFsId: new mongoose.Types.ObjectId(), size: 100 }
  };

  // 1. Access tests
  console.log('  1. Testing access control rules (canView, isSudoCaller)...');
  assert.strictEqual(canView(teacherA, batchA), true, 'Owner should view own batch');
  assert.strictEqual(canView(teacherB, batchA), false, 'Other teacher should NOT view batch');
  assert.strictEqual(canView(sudoUser, batchA), true, 'Sudo should view any batch');
  assert.strictEqual(isSudoCaller(sudoUser), true, 'Sudo user is sudo caller');
  assert.strictEqual(isSudoCaller(teacherA), false, 'Teacher is not sudo caller');
  console.log('     ✓ Access control passed.');

  // 2. Serializer tests (A2)
  console.log('  2. Testing toClient serializer (stripping passwords & buffers)...');
  const clientObj = toClient(batchA, teacherA);
  assert.strictEqual(clientObj.fileBufferBase64, undefined, 'fileBufferBase64 must be stripped');
  assert.strictEqual(clientObj.fileRef, undefined, 'fileRef must be stripped');
  assert.strictEqual(clientObj.eligibleRows[0].data.password, undefined, 'Passwords must be stripped in client payload');
  assert.strictEqual(clientObj.eligibleRows[0].data.username, 'jdoe', 'Other row fields preserved');
  assert.strictEqual(clientObj.can.edit, true, 'Owner has can.edit = true');
  assert.strictEqual(clientObj.can.approveInitial, false, 'Teacher cannot approveInitial');
  console.log('     ✓ Serializer security checks passed.');

  // 3. State Machine Transition validation
  console.log('  3. Testing state machine transition rules & CAS...');
  // Mock findOneAndUpdate for isolated testing if DB not connected
  const origFindOneAndUpdate = M.BulkImportBatch.findOneAndUpdate;
  const origFindById = M.BulkImportBatch.findById;

  try {
    let mockStatus = 'draft';
    M.BulkImportBatch.findById = () => ({
      select: () => ({
        lean: () => Promise.resolve({ _id: batchA._id, status: mockStatus, roadmap: [] })
      })
    });

    M.BulkImportBatch.findOneAndUpdate = (query, update) => {
      if (query.status === mockStatus) {
        mockStatus = update.$set.status;
        return Promise.resolve({ _id: batchA._id, status: mockStatus });
      }
      return Promise.resolve(null); // CAS failure
    };

    // Valid transition: draft -> uploading
    const res1 = await transition(batchA._id, 'uploading', { from: ['draft'], user: teacherA });
    assert.strictEqual(res1.status, 'uploading', 'draft -> uploading should succeed');

    // Invalid transition: uploading -> committed (must fail)
    let caughtIllegal = false;
    try {
      await transition(batchA._id, 'committed', { from: ['verified_all'], user: teacherA });
    } catch (err) {
      caughtIllegal = true;
      assert.strictEqual(err.statusCode || err.status, 409, 'Illegal transition must return 409 Conflict');
    }
    assert.strictEqual(caughtIllegal, true, 'Illegal transition correctly thrown');

    // Valid transition: uploading -> processing
    const res2 = await transition(batchA._id, 'processing', { from: ['uploading'], user: teacherA });
    assert.strictEqual(res2.status, 'processing', 'uploading -> processing should succeed');
    console.log('     ✓ State machine transitions passed.');
  } finally {
    M.BulkImportBatch.findOneAndUpdate = origFindOneAndUpdate;
    M.BulkImportBatch.findById = origFindById;
  }

  // 4. Message post and monotonic sequence
  console.log('  4. Testing postMessage and event bus...');
  const origCreate = M.BulkChatMessage.create;
  try {
    let busEventReceived = null;
    bus.once(`batch:${batchA._id}`, (evt) => {
      busEventReceived = evt;
    });

    M.BulkImportBatch.findOneAndUpdate = () => Promise.resolve({ messageSeq: 1 });
    M.BulkChatMessage.create = (doc) => Promise.resolve({ ...doc, _id: new mongoose.Types.ObjectId() });

    const msg = await postMessage(batchA._id, {
      kind: 'card',
      card: 'summary',
      author: 'system',
      payload: { eligibleCount: 5, skippedCount: 1 }
    });

    assert.strictEqual(msg.seq, 1, 'Message sequence should be 1');
    assert.strictEqual(busEventReceived?.type, 'message', 'Bus should emit message event');
    assert.strictEqual(busEventReceived?.seq, 1, 'Bus event seq matches');
    console.log('     ✓ Transcript messaging passed.');
  } finally {
    M.BulkChatMessage.create = origCreate;
    M.BulkImportBatch.findOneAndUpdate = origFindOneAndUpdate;
  }

  console.log('All Phase P1 Foundation tests PASSED successfully.');
}

runP1Tests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Phase P1 Test Failed:', err);
    process.exit(1);
  });
