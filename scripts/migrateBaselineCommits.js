/**
 * scripts/migrateBaselineCommits.js
 *
 * Migration M1: Baseline Commits
 * For each class with a SectionTimetable:
 * - Writes a 'baseline' commit (trackId from getNextRequestId('TT'))
 * - Writes a TimetableCommitClass payload
 * - Sets SectionTimetable.headTrackId, headSeq, headVersion
 *
 * Usage:
 *   node scripts/migrateBaselineCommits.js          # Dry run (inspection only)
 *   node scripts/migrateBaselineCommits.js --apply  # Execute updates against MongoDB
 */

const mongoose = require('mongoose');
const M = require('../models');
const cfg = require('../config');
const { getNextRequestId } = require('../utils/requestIds');

async function run() {
  const isApply = process.argv.includes('--apply');
  console.log('====================================================');
  console.log('  EAMS Timetable Baseline Commit Migration (M1)');
  console.log(`  Mode: ${isApply ? '🚀 APPLY (Live DB Updates)' : '🔍 DRY RUN (Audit Only — pass --apply to write)'}`);
  console.log('====================================================\n');

  try {
    await mongoose.connect(cfg.MONGO_URI);
    console.log('✓ Connected to MongoDB.\n');

    const sections = await M.SectionTimetable.find().lean();
    console.log(`Found ${sections.length} SectionTimetable document(s).`);

    let migrated = 0;
    let skipped = 0;

    for (const sec of sections) {
      if (sec.headTrackId) {
        skipped++;
        continue;
      }

      const cls = await M.Class.findById(sec.classId).lean();
      const className = cls?.name || sec.className || 'Class';
      const rawSlots = sec.slots ? Object.values(sec.slots).filter(Boolean) : [];

      console.log(`- Class: ${className} (${sec.classId}), ${rawSlots.length} slot(s)`);

      if (isApply) {
        const trackId = await getNextRequestId('TT');
        const seq = parseInt(trackId.split('-').pop(), 10) || 1;

        const commit = await M.TimetableCommit.create({
          trackId,
          seq,
          type: 'baseline',
          classIds: [sec.classId],
          classNames: [className],
          message: `Baseline production snapshot for ${className}`,
          author: { name: 'Migration Script M1', trackId: 'SYSTEM' },
          approver: { name: 'System Baseline', trackId: 'SYSTEM', at: new Date(), comment: 'Initial baseline' },
          status: 'deployed'
        });

        await M.TimetableCommitClass.create({
          commitTrackId: trackId,
          classId: sec.classId,
          className,
          deptId: cls?.deptId || sec.deptId || null,
          version: 1,
          parentTrackId: null,
          grid: rawSlots,
          diff: { added: rawSlots.length, modified: 0, removed: 0, unchanged: 0 }
        });

        await M.SectionTimetable.updateOne(
          { _id: sec._id },
          {
            $set: {
              headTrackId: trackId,
              headSeq: seq,
              headVersion: 1
            }
          }
        );
      }
      migrated++;
    }

    console.log('\n====================================================');
    console.log(`M1 Summary: ${migrated} baseline(s) ${isApply ? 'created' : 'identified'}, ${skipped} already had headTrackId`);
    console.log('====================================================');
  } catch (err) {
    console.error('Migration M1 Error:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
