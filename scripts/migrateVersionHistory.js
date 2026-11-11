/**
 * scripts/migrateVersionHistory.js (M4)
 *
 * Normalizes TimetableVersion history and migrates records into TimetableCommit & WorkspaceCheckpoint:
 * - Normalizes snapshot shape (bidirectional grid <-> slots)
 * - Backfills missing type, classId, and status on snapshotAndPublish rows (F6)
 * - Production versions -> 'import' TimetableCommit records
 * - Dev versions -> WorkspaceCheckpoint records in legacy workspace
 * - Original TimetableVersion records stay untouched for audit compatibility
 * - Dry-run by default: pass --apply to execute writes against MongoDB
 *
 * Usage:
 *   node scripts/migrateVersionHistory.js          # Dry-run audit
 *   node scripts/migrateVersionHistory.js --apply  # Apply migration to DB
 */

const mongoose = require('mongoose');
const M = require('../models');
const cfg = require('../config');
const { getNextRequestId } = require('../utils/requestIds');
const { gridToSlotsObj, slotsToGrid } = require('../services/timetableEffective');

async function run() {
  const isApply = process.argv.includes('--apply');
  const customUri = process.argv.find(a => a.startsWith('--uri='))?.slice(6);
  const mongoUri = customUri || cfg.MONGO_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/eams';

  console.log('====================================================');
  console.log('  EAMS Version History Migration (M4)');
  console.log(`  Mode: ${isApply ? '🚀 APPLY (Live DB Updates)' : '🔍 DRY RUN (Audit Only — pass --apply to write)'}`);
  console.log('====================================================\n');

  try {
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB.\n');

    const versions = await M.TimetableVersion.find().sort({ createdAt: 1 }).lean();
    console.log(`Loaded ${versions.length} TimetableVersion records.\n`);

    let normalizedSnapshots = 0;
    let backfilledRows = 0;
    let importCommitsCreated = 0;
    let checkpointsCreated = 0;

    for (const ver of versions) {
      const snap = ver.snapshot || {};
      let needsShapeUpdate = false;
      let grid = [];
      let slots = {};

      if (Array.isArray(snap.grid) && snap.grid.length > 0) {
        grid = snap.grid;
        if (!snap.slots || typeof snap.slots !== 'object' || Object.keys(snap.slots).length === 0) {
          slots = gridToSlotsObj(grid, ver.className || '');
          needsShapeUpdate = true;
        } else {
          slots = snap.slots;
        }
      } else if (snap.slots && typeof snap.slots === 'object') {
        slots = snap.slots;
        grid = slotsToGrid(slots);
        needsShapeUpdate = true;
      }

      // Check missing type/classId/status
      let needsMetaUpdate = false;
      let type = ver.type;
      let status = ver.status;
      let classId = ver.classId;

      if (!type) {
        type = (ver.action === 'publish' || ver.status === 'published' || ver.status === 'approved')
          ? 'production'
          : 'development';
        needsMetaUpdate = true;
      }

      if (!status) {
        status = 'published';
        needsMetaUpdate = true;
      }

      if (!classId && ver.semesterTemplateId) {
        const tpl = await M.SemesterTemplate.findById(ver.semesterTemplateId).select('classId').lean();
        if (tpl?.classId) {
          classId = tpl.classId;
          needsMetaUpdate = true;
        }
      }

      if (needsShapeUpdate) normalizedSnapshots++;
      if (needsMetaUpdate) backfilledRows++;

      if (isApply && (needsShapeUpdate || needsMetaUpdate)) {
        await M.TimetableVersion.findByIdAndUpdate(ver._id, {
          $set: {
            'snapshot.grid': grid,
            'snapshot.slots': slots,
            type,
            status,
            ...(classId ? { classId } : {})
          }
        });
      }

      // Production versions become 'import' commits
      if (type === 'production' && classId) {
        const existingCommit = await M.TimetableCommit.findOne({
          message: `Migrated version ${ver._id}`
        }).lean();

        if (!existingCommit) {
          const trackId = isApply ? await getNextRequestId('TT') : `TT-2026-IMP${String(importCommitsCreated + 1).padStart(3, '0')}`;
          console.log(`  + [Production Import Commit] ${trackId} for version ${ver._id} (Class: ${ver.className || classId})`);

          if (isApply) {
            const cls = await M.Class.findById(classId).lean();
            const commit = await M.TimetableCommit.create({
              trackId,
              seq: importCommitsCreated + 1,
              type: 'import',
              classIds: [classId],
              classNames: [ver.className || cls?.name || 'Class'],
              message: `Migrated version ${ver._id}`,
              notes: ver.reason || ver.changeSummary || '',
              status: 'deployed',
              author: {
                id: ver.requestedBy,
                name: ver.requestedByName || ''
              },
              approver: {
                id: ver.reviewedBy,
                name: ver.reviewedByName || '',
                at: ver.reviewedAt || ver.createdAt
              },
              createdAt: ver.createdAt || new Date()
            });

            await M.TimetableCommitClass.create({
              commitTrackId: commit.trackId,
              classId,
              className: ver.className || cls?.name || '',
              deptId: cls?.deptId || null,
              version: ver.versionNumber || 1,
              grid,
              diff: { added: grid.length, modified: 0, removed: 0, unchanged: 0 }
            });
          }
          importCommitsCreated++;
        }
      }

      // Development versions become Checkpoints of legacy workspace
      if (type === 'development' && classId) {
        const cls = await M.Class.findById(classId).lean();
        const deptId = cls?.deptId;

        if (deptId) {
          const ws = await M.TimetableWorkspace.findOne({ deptId, status: 'open' }).lean();
          if (ws) {
            console.log(`  + [Dev Checkpoint] in workspace "${ws.name}" for version ${ver._id}`);
            if (isApply) {
              const lastCp = await M.WorkspaceCheckpoint.findOne({ workspaceId: ws._id }).sort({ seq: -1 }).select('seq').lean();
              await M.WorkspaceCheckpoint.create({
                workspaceId: ws._id,
                seq: (lastCp?.seq || 0) + 1,
                name: ver.versionName || `Legacy Snapshot v${ver.versionNumber || 1}`,
                note: ver.reason || 'Migrated from legacy dev version',
                kind: 'checkpoint',
                classes: [{
                  classId,
                  className: ver.className || cls?.name || '',
                  grid,
                  stats: { slots: grid.length, added: 0, modified: 0, removed: 0 }
                }],
                author: {
                  id: ver.requestedBy,
                  name: ver.requestedByName || ''
                },
                createdAt: ver.createdAt || new Date()
              });
            }
            checkpointsCreated++;
          }
        }
      }
    }

    console.log('\n====================================================');
    console.log('  M4 MIGRATION SUMMARY');
    console.log('====================================================');
    console.log(`Snapshots normalized (grid <-> slots): ${normalizedSnapshots}`);
    console.log(`Version rows backfilled:               ${backfilledRows}`);
    console.log(`Production 'import' commits created:   ${importCommitsCreated}`);
    console.log(`Development checkpoints created:       ${checkpointsCreated}`);
    console.log('====================================================\n');

    if (!isApply) {
      console.log('ℹ️  Run with --apply to write these changes to the database:');
      console.log('    node scripts/migrateVersionHistory.js --apply\n');
    }

  } catch (err) {
    console.error('Migration M4 error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
