const M = require('../../models');
const { postMessage } = require('./messages');

const HEARTBEAT_TIMEOUT_MS = 90 * 1000; // 90 seconds
const STALE_DRAFT_DAYS = 7;

/**
 * Recovers batches that died mid-execution due to server crashes, deployments, or timeouts
 */
async function checkStuckBatches() {
  try {
    const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
    const stuck = await M.BulkImportBatch.find({
      status: { $in: ['uploading', 'processing', 'committing'] },
      $or: [
        { 'progress.heartbeatAt': { $lt: cutoff } },
        { 'progress.heartbeatAt': null, updatedAt: { $lt: cutoff } }
      ]
    });

    for (const batch of stuck) {
      console.warn(`[BulkSweeper] Recovering stuck batch ${batch.batchTrackId} (status: ${batch.status})`);

      batch.status = 'failed';
      if (!batch.progress) batch.progress = {};
      batch.progress.error = 'Process was interrupted by a server restart or timeout. Please click Retry.';
      batch.progress.heartbeatAt = new Date();
      await batch.save();

      await postMessage(batch._id, {
        kind: 'card',
        card: 'error',
        author: 'system',
        payload: {
          error: 'Process interrupted — please click Retry to resume.',
          stage: batch.progress?.jobKind || 'process'
        }
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('[BulkSweeper Warning]:', err.message);
  }
}

/**
 * Removes abandoned empty drafts older than 7 days
 */
async function cleanupStaleDrafts() {
  try {
    const draftCutoff = new Date(Date.now() - STALE_DRAFT_DAYS * 24 * 60 * 60 * 1000);
    const staleDrafts = await M.BulkImportBatch.find({
      status: 'draft',
      createdAt: { $lt: draftCutoff }
    }).select('_id');

    if (staleDrafts.length > 0) {
      const ids = staleDrafts.map(d => d._id);
      await M.BulkChatMessage.deleteMany({ batchId: { $in: ids } });
      const res = await M.BulkImportBatch.deleteMany({ _id: { $in: ids } });
      console.log(`[BulkSweeper] Cleaned up ${res.deletedCount} abandoned bulk draft chats.`);
    }
  } catch (err) {
    console.warn('[BulkSweeper Draft Cleanup Error]:', err.message);
  }
}

let _sweeperInterval = null;
let _cleanupInterval = null;

function startBulkSweeper() {
  if (_sweeperInterval) return;

  // Run stuck check on boot and every 60s
  checkStuckBatches().catch(() => {});
  _sweeperInterval = setInterval(() => {
    checkStuckBatches().catch(() => {});
  }, 60 * 1000);

  // Run draft cleanup once every 24 hours
  cleanupStaleDrafts().catch(() => {});
  _cleanupInterval = setInterval(() => {
    cleanupStaleDrafts().catch(() => {});
  }, 24 * 60 * 60 * 1000);

  console.log('   ✓ Bulk background job sweeper active');
}

function stopBulkSweeper() {
  if (_sweeperInterval) clearInterval(_sweeperInterval);
  if (_cleanupInterval) clearInterval(_cleanupInterval);
  _sweeperInterval = null;
  _cleanupInterval = null;
}

module.exports = {
  startBulkSweeper,
  stopBulkSweeper,
  checkStuckBatches,
  cleanupStaleDrafts
};
