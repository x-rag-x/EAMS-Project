/**
 * scripts/backfillAssignmentSource.js
 *
 * Migration M5: Assignment Source Backfill
 * - Rows with remark 'Auto-synchronized from approved production timetable' -> source: 'timetable'
 * - All other rows -> source: 'manual'
 *
 * Usage:
 *   node scripts/backfillAssignmentSource.js          # Dry run (inspection only)
 *   node scripts/backfillAssignmentSource.js --apply  # Execute updates against MongoDB
 */

const mongoose = require('mongoose');
const M = require('../models');
const cfg = require('../config');

async function run() {
  const isApply = process.argv.includes('--apply');
  console.log('====================================================');
  console.log('  EAMS Assignment Source Backfill Tool (M5)');
  console.log(`  Mode: ${isApply ? '🚀 APPLY (Live DB Updates)' : '🔍 DRY RUN (Audit Only — pass --apply to write)'}`);
  console.log('====================================================\n');

  try {
    await mongoose.connect(cfg.MONGO_URI);
    console.log('✓ Connected to MongoDB.\n');

    const total = await M.Assignment.countDocuments();
    console.log(`Auditing ${total} Assignment document(s)...`);

    const autoSyncedMatches = await M.Assignment.find({
      remarks: /auto-synchronized from approved production timetable/i
    }).select('_id className subjectName teacherName source');

    const manualMatches = await M.Assignment.find({
      $or: [
        { remarks: { $not: /auto-synchronized from approved production timetable/i } },
        { remarks: null },
        { remarks: '' }
      ]
    }).select('_id className subjectName teacherName source');

    console.log(`- Identified ${autoSyncedMatches.length} auto-synchronized timetable row(s)`);
    console.log(`- Identified ${manualMatches.length} manual assignment row(s)`);

    if (isApply) {
      const timetableUpdate = await M.Assignment.updateMany(
        { remarks: /auto-synchronized from approved production timetable/i },
        { $set: { source: 'timetable' } }
      );

      const manualUpdate = await M.Assignment.updateMany(
        {
          $or: [
            { remarks: { $not: /auto-synchronized from approved production timetable/i } },
            { remarks: null },
            { remarks: '' }
          ]
        },
        { $set: { source: 'manual' } }
      );

      console.log(`\n✓ Updated ${timetableUpdate.modifiedCount} rows to source: 'timetable'`);
      console.log(`✓ Updated ${manualUpdate.modifiedCount} rows to source: 'manual'`);
    }

    console.log('\n====================================================');
    console.log(`M5 Summary: ${total} total assignments audited.`);
    console.log('====================================================');
  } catch (err) {
    console.error('Migration M5 Error:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
