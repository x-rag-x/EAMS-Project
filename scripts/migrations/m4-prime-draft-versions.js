/**
 * scripts/migrations/m4-prime-draft-versions.js
 * Migration M4': Prime DraftVersion Baselines from Checkpoints and Active Drafts
 * Supports dry-run: node scripts/migrations/m4-prime-draft-versions.js --dry-run
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const cfg = require('../../config');
const M = require('../../models');
const { getIstBucket, formatVersionLabel } = require('../../services/draftOps');

async function runMigration() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`[M4' Migration] Starting DraftVersion priming (dry-run: ${isDryRun})...`);

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(cfg.MONGO_URI, { dbName: cfg.DB_NAME });
  }

  // Find all open Development Workspaces
  const workspaces = await M.TimetableWorkspace.find({
    kind: 'development',
    status: 'open'
  }).lean();

  console.log(`Found ${workspaces.length} open development workspace(s) to inspect.`);

  let createdCount = 0;

  for (const ws of workspaces) {
    // Check if this workspace already has DraftVersions
    const existingVersion = await M.DraftVersion.findOne({
      $or: [{ workspaceId: ws._id }, { draftId: ws._id }]
    }).lean();

    if (existingVersion) {
      console.log(`  - Workspace "${ws.name}" (${ws.trackId}) already has versions. Skipping.`);
      continue;
    }

    // Load active class drafts for this workspace
    const drafts = await M.WorkspaceClassDraft.find({ workspaceId: ws._id }).lean();
    if (!drafts.length) {
      console.log(`  - Workspace "${ws.name}" has no drafts. Skipping.`);
      continue;
    }

    const { bucketKey, startedAt, endedAt } = getIstBucket(ws.createdAt || new Date(), 15);
    const endSnapshot = {};
    const classIds = [];

    for (const d of drafts) {
      classIds.push(d.classId);
      endSnapshot[String(d.classId)] = d.grid || [];
    }

    console.log(`  + Creating baseline version for "${ws.name}" (${classIds.length} classes)...`);

    if (!isDryRun) {
      await M.DraftVersion.create({
        draftId: ws._id,
        workspaceId: ws._id,
        bucketKey,
        startedAt,
        endedAt,
        firstSeq: 1,
        lastSeq: 1,
        opCount: 1,
        status: 'closed',
        authors: [{ userId: ws.createdBy || ws.ownerId, name: ws.ownerName || 'Migration Baseline' }],
        classIds,
        stats: { added: 0, changed: 0, removed: 0 },
        endSnapshot,
        label: `Baseline · ${formatVersionLabel(startedAt)}`,
        pinned: true,
        source: 'auto'
      });
    }

    createdCount++;
  }

  console.log(`[M4' Migration] Complete! Created ${createdCount} baseline DraftVersion(s) (dry-run: ${isDryRun}).`);
  if (require.main === module) {
    await mongoose.disconnect();
  }
}

module.exports = { runMigration };

if (require.main === module) {
  runMigration().catch(err => {
    console.error('[M4\' Migration] Fatal error:', err);
    process.exit(1);
  });
}
