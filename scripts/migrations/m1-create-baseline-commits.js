/**
 * scripts/migrations/m1-create-baseline-commits.js
 * Migration M1: Creates baseline TimetableCommit (TR-TT-0001) for existing published SectionTimetables
 * so production history starts complete.
 * Supports dry-run: node scripts/migrations/m1-create-baseline-commits.js --dry-run
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const cfg = require('../../config');
const M = require('../../models');
const { getNextRequestId } = require('../../utils/requestIds');

async function runMigration() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`[M1 Migration] Starting baseline commits migration (dry-run: ${isDryRun})...`);

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(cfg.MONGO_URI, { dbName: cfg.DB_NAME });
  }

  const sections = await M.SectionTimetable.find({}).lean();
  console.log(`Found ${sections.length} SectionTimetable record(s) to inspect.`);

  let createdCount = 0;
  let skippedCount = 0;

  for (const sec of sections) {
    if (sec.headTrackId) {
      skippedCount++;
      continue;
    }

    const cls = await M.Class.findById(sec.classId).lean();
    const className = cls?.name || sec.className || 'Class';
    const deptId = cls?.deptId || sec.deptId;

    const slots = sec.slots ? (typeof sec.slots === 'object' ? Object.values(sec.slots) : []) : [];
    const grid = slots.filter(Boolean);

    const trackId = isDryRun ? 'TR-TT-BASELINE-MOCK' : await getNextRequestId('TT');

    if (!isDryRun) {
      const commit = await M.TimetableCommit.create({
        trackId,
        seq: 1,
        type: 'baseline',
        classIds: [sec.classId],
        classNames: [className],
        deptId: deptId || null,
        message: `Initial baseline production commit for ${className}`,
        status: 'deployed',
        author: { name: 'System Migration (M1)' },
        approver: { name: 'System Migration (M1)', at: new Date() },
        diffSummary: { totalAdded: grid.length, totalModified: 0, totalRemoved: 0, totalUnchanged: 0 },
        deployedAt: sec.updatedAt || new Date()
      });

      await M.TimetableCommitClass.create({
        commitTrackId: trackId,
        classId: sec.classId,
        className,
        deptId: deptId || null,
        version: 1,
        grid,
        diff: { added: grid.length, modified: 0, removed: 0, unchanged: 0 }
      });

      await M.SectionTimetable.updateOne(
        { _id: sec._id },
        {
          $set: {
            headTrackId: trackId,
            headSeq: 1,
            headVersion: 1,
            deployedAt: sec.updatedAt || new Date()
          }
        }
      );
    }

    console.log(`  + Baseline commit for ${className} (${sec.classId}) -> ${trackId}`);
    createdCount++;
  }

  console.log(`[M1 Migration Complete]: ${createdCount} created, ${skippedCount} skipped.`);
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[M1 Migration Error]:', err);
      process.exit(1);
    });
}

module.exports = { runMigration };
