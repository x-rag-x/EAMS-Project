/**
 * jobs/timetableVersionClose.js
 * 
 * Scheduled worker running every 5 minutes to close expired 15-minute IST DraftVersion buckets
 * and snapshot final class grids (Invariant Z10).
 * Also executes 180-day retention pruning for unpinned DraftOps.
 */

'use strict';

const mongoose = require('mongoose');
const M = require('../models');

async function closeExpiredDraftVersions() {
  const now = new Date();
  
  // Find open versions whose 15-minute window has passed
  const expiredVersions = await M.DraftVersion.find({
    status: 'open',
    endedAt: { $lt: now }
  });

  let closedCount = 0;

  for (const version of expiredVersions) {
    try {
      // Compile final endSnapshot for touched classes
      const classDrafts = await M.WorkspaceClassDraft.find({
        workspaceId: version.workspaceId || version.draftId,
        classId: { $in: version.classIds }
      }).lean();

      const snapshot = version.endSnapshot || {};
      for (const cd of classDrafts) {
        snapshot[String(cd.classId)] = cd.grid || [];
      }

      version.endSnapshot = snapshot;
      version.status = 'closed';
      version.markModified('endSnapshot');
      await version.save();
      closedCount++;
    } catch (err) {
      console.error(`[timetableVersionClose] Error closing version ${version._id}:`, err);
    }
  }

  return { closedCount };
}

async function pruneOldDraftOps(retentionDays = 180) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  // Find pinned versions to preserve their ops
  const pinnedVersions = await M.DraftVersion.find({ pinned: true }).select('draftId firstSeq lastSeq').lean();

  const protectQueries = pinnedVersions.map(pv => ({
    draftId: pv.draftId,
    seq: { $gte: pv.firstSeq, $lte: pv.lastSeq }
  }));

  const deleteFilter = {
    receivedAt: { $lt: cutoff }
  };

  if (protectQueries.length) {
    deleteFilter.$nor = protectQueries;
  }

  const res = await M.DraftOp.deleteMany(deleteFilter);
  return { prunedOps: res.deletedCount || 0 };
}

async function runJob() {
  try {
    const { closedCount } = await closeExpiredDraftVersions();
    return { ok: true, closedCount };
  } catch (err) {
    console.error('[timetableVersionClose] Error:', err);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  closeExpiredDraftVersions,
  pruneOldDraftOps,
  runJob
};

if (require.main === module) {
  require('dotenv').config();
  const cfg = require('../config');
  mongoose.connect(cfg.MONGO_URI, { dbName: cfg.DB_NAME })
    .then(runJob)
    .then(res => {
      console.log('[timetableVersionClose] Finished:', res);
      process.exit(0);
    })
    .catch(err => {
      console.error('[timetableVersionClose] Fatal:', err);
      process.exit(1);
    });
}
