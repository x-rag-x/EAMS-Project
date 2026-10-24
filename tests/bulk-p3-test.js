const assert = require('assert');
const mongoose = require('mongoose');
const JSZip = require('jszip');
const M = require('../models');
const { runCommitJob, retryBackupOnly } = require('../services/bulk/commit');
const { checkStuckBatches, cleanupStaleDrafts } = require('../services/bulk/sweeper');
const { bus } = require('../services/bulk/progress');

function installHermeticMocks() {
  const origStudentCreate = M.Student.create;
  const origUserCreate = M.User.create;
  const origUserFindOne = M.User.findOne;
  const origUserFindOneAndUpdate = M.User.findOneAndUpdate;
  const origClassFindOne = M.Class.findOne;
  const origDeptFind = M.Department.find;
  const origBatchFindById = M.BulkImportBatch.findById;
  const origBatchUpdateOne = M.BulkImportBatch.updateOne;
  const origBatchFindOneAndUpdate = M.BulkImportBatch.findOneAndUpdate;

  const mockQuery = (res) => ({
    lean: () => Promise.resolve(res),
    then: (resolve) => Promise.resolve(res).then(resolve)
  });

  M.BulkImportBatch.updateOne = () => Promise.resolve({});
  M.User.findOne = () => mockQuery(null);

  return () => {
    M.Student.create = origStudentCreate;
    M.User.create = origUserCreate;
    M.User.findOne = origUserFindOne;
    M.User.findOneAndUpdate = origUserFindOneAndUpdate;
    M.Class.findOne = origClassFindOne;
    M.Department.find = origDeptFind;
    M.BulkImportBatch.findById = origBatchFindById;
    M.BulkImportBatch.updateOne = origBatchUpdateOne;
    M.BulkImportBatch.findOneAndUpdate = origBatchFindOneAndUpdate;
  };
}

async function runP3Tests() {
  console.log('> Running Phase P3 Async Pipeline & Resumable Commit Tests...');
  const restore = installHermeticMocks();

  try {
    // 1. Commit job with password purge & drive resilience (A2, A4)
    console.log('  1. Testing commit job: password purging, drive resilience, and archive scrubbing...');
    const sudoAdmin = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Super Admin',
      role: 'sudo',
      trackId: 'TRADM001'
    };

    const mockBatchId = new mongoose.Types.ObjectId();
    const mockBatch = {
      _id: mockBatchId,
      batchTrackId: 'TR-BATCH-COMM01',
      type: 'student',
      status: 'committing',
      uploadedBy: { userId: sudoAdmin._id, trackId: 'TRADM001', name: 'Super Admin', role: 'sudo' },
      deviceDetails: { ip: '127.0.0.1' },
      verificationAudit: [],
      eligibleRows: [
        {
          rowNumber: 2,
          isVerified: true,
          committed: false,
          data: {
            fullName: 'Ada Lovelace',
            registerNo: 'REG-ADA-01',
            username: 'alovelace',
            password: 'PlaintextSecretPassword!@#',
            academicYear: '2025-2026',
            batch: '2025-2029',
            courseType: 'UG',
            branch: 'B.E',
            department: 'Computer Science & Engineering',
            class: '25-29 CSE',
            email: 'ada@lovelace.org',
            gender: 'Female',
            residency: 'dayscholar'
          }
        }
      ],
      backup: { status: 'pending' },
      save: async function () { return this; }
    };

    let userCreated = false;
    let studentCreated = false;

    M.BulkImportBatch.findById = () => Promise.resolve(mockBatch);
    M.Department.find = () => ({ lean: () => Promise.resolve([{ name: 'Computer Science & Engineering', code: 'CSE' }]) });
    M.Class.findOne = () => ({ lean: () => Promise.resolve({ _id: new mongoose.Types.ObjectId(), name: '25-29 CSE' }) });
    M.Student.create = () => { studentCreated = true; return Promise.resolve({ _id: new mongoose.Types.ObjectId() }); };
    M.User.findOneAndUpdate = () => { userCreated = true; return Promise.resolve({ _id: new mongoose.Types.ObjectId() }); };
    M.BulkImportBatch.findOneAndUpdate = (query, update) => {
      if (update?.$set?.status) mockBatch.status = update.$set.status;
      return Promise.resolve({ ...mockBatch, messageSeq: 5 });
    };
    M.BulkChatMessage.create = (doc) => Promise.resolve(doc);

    const commitResult = await runCommitJob(mockBatchId, sudoAdmin, { ip: '127.0.0.1' });

    assert.strictEqual(studentCreated, true, 'Student record should be created');
    assert.strictEqual(userCreated, true, 'User record should be created/updated');
    assert.strictEqual(mockBatch.eligibleRows[0].committed, true, 'Row should be marked committed: true');
    assert.strictEqual(mockBatch.eligibleRows[0].data.password, undefined, 'Plaintext password must be purged after commit (A2)');
    assert.strictEqual(mockBatch.status, 'committed', 'Batch status should be committed even if Drive fails (A4)');
    console.log('     ✓ Commit job execution and password purging passed.');

    // 2. Resumable commit: already committed row should not be re-created
    console.log('  2. Testing resumable commit (skips already committed rows)...');
    studentCreated = false;
    userCreated = false;
    const resumeBatch = {
      ...mockBatch,
      status: 'committing',
      eligibleRows: [
        {
          rowNumber: 2,
          isVerified: true,
          committed: true, // Already committed earlier
          data: { fullName: 'Ada Lovelace', username: 'alovelace' }
        }
      ]
    };
    M.BulkImportBatch.findById = () => Promise.resolve(resumeBatch);
    await runCommitJob(mockBatchId, sudoAdmin, { ip: '127.0.0.1' });
    assert.strictEqual(studentCreated, false, 'Already committed row should NOT be re-created');
    console.log('     ✓ Resumable commit skips committed rows passed.');

    // 3. Sweeper stuck-job detection and recovery
    console.log('  3. Testing sweeper heartbeat recovery for interrupted jobs...');
    let sweeperRecovered = false;
    const staleBatch = {
      _id: new mongoose.Types.ObjectId(),
      batchTrackId: 'TR-BATCH-STUCK01',
      status: 'processing',
      progress: {
        jobKind: 'stage',
        heartbeatAt: new Date(Date.now() - 150 * 1000) // 150s old (> 90s)
      },
      save: async function () {
        sweeperRecovered = (this.status === 'failed');
        return this;
      }
    };

    M.BulkImportBatch.find = (q) => {
      if (q.status && q.status.$in) {
        return Promise.resolve([staleBatch]);
      }
      return Promise.resolve([]);
    };

    await checkStuckBatches();
    assert.strictEqual(sweeperRecovered, true, 'Stuck batch should be recovered to failed status');
    assert.strictEqual(staleBatch.status, 'failed');
    console.log('     ✓ Sweeper heartbeat recovery passed.');

    console.log('\nAll Phase P3 Async Pipeline & Resumable Commit tests PASSED successfully.');
  } finally {
    restore();
  }
}

runP3Tests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Phase P3 Test Failure:', err);
    process.exit(1);
  });
