/**
 * scripts/reconcileProductionCopies.js
 *
 * Migration M2: Reconcile Production Copies
 * Compares SectionTimetable and published SemesterTemplate per class (F4):
 * - Reports differing classes
 * - Default policy: SectionTimetable wins (what teachers and students have been seeing)
 * - Regenerates the published SemesterTemplate mirror
 *
 * Usage:
 *   node scripts/reconcileProductionCopies.js          # Dry run (inspection only)
 *   node scripts/reconcileProductionCopies.js --apply  # Execute updates against MongoDB
 */

const mongoose = require('mongoose');
const M = require('../models');
const cfg = require('../config');
const { diffGrids } = require('../services/timetableDiff');

async function run() {
  const isApply = process.argv.includes('--apply');
  console.log('====================================================');
  console.log('  EAMS Production Timetable Reconciliation (M2)');
  console.log(`  Mode: ${isApply ? '🚀 APPLY (Live DB Updates)' : '🔍 DRY RUN (Audit Only — pass --apply to write)'}`);
  console.log('====================================================\n');

  try {
    await mongoose.connect(cfg.MONGO_URI);
    console.log('✓ Connected to MongoDB.\n');

    const sections = await M.SectionTimetable.find().lean();
    console.log(`Auditing ${sections.length} SectionTimetable document(s)...`);

    let reconciledCount = 0;
    let matchedCount = 0;
    let missingPublishedCount = 0;

    for (const sec of sections) {
      const cls = await M.Class.findById(sec.classId).lean();
      const className = cls?.name || sec.className || 'Class';
      const secSlots = sec.slots ? Object.values(sec.slots).filter(Boolean) : [];

      const publishedTmpl = await M.SemesterTemplate.findOne({
        classId: sec.classId,
        status: 'published'
      }).sort({ version: -1 });

      if (!publishedTmpl) {
        missingPublishedCount++;
        console.log(`[MISSING MIRROR] ${className} (${sec.classId}) has SectionTimetable (${secSlots.length} slots) but NO published SemesterTemplate.`);
        if (isApply) {
          await M.SemesterTemplate.create({
            classId: sec.classId,
            className,
            status: 'published',
            version: sec.headVersion || 1,
            versionName: 'Reconciled Production Mirror',
            grid: secSlots,
            publishedAt: new Date(),
            publishedBy: 'Reconciliation Script M2'
          });
          console.log(`  -> Created published mirror for ${className}`);
        }
        reconciledCount++;
        continue;
      }

      const diffResult = diffGrids(publishedTmpl.grid || [], secSlots);
      const hasDifferences = diffResult.stats.addedCount > 0 ||
                             diffResult.stats.removedCount > 0 ||
                             diffResult.stats.modifiedCount > 0;

      if (hasDifferences) {
        console.log(`[DISCREPANCY] ${className} (${sec.classId}): SectionTimetable vs Published Template:`);
        console.log(`  Diff: +${diffResult.stats.addedCount} ~${diffResult.stats.modifiedCount} -${diffResult.stats.removedCount}`);
        if (isApply) {
          // SectionTimetable wins: update published mirror
          publishedTmpl.grid = secSlots;
          publishedTmpl.version = (publishedTmpl.version || 1) + 1;
          publishedTmpl.versionName = `Reconciled Mirror v${publishedTmpl.version}`;
          publishedTmpl.publishedAt = new Date();
          publishedTmpl.publishedBy = 'Reconciliation Script M2';
          await publishedTmpl.save();
          console.log(`  -> Updated published mirror for ${className} to match SectionTimetable`);
        }
        reconciledCount++;
      } else {
        matchedCount++;
      }
    }

    console.log('\n====================================================');
    console.log(`M2 Summary:`);
    console.log(`- In Sync: ${matchedCount}`);
    console.log(`- Reconciled/Differing: ${reconciledCount} (${missingPublishedCount} missing mirror)`);
    console.log('====================================================');
  } catch (err) {
    console.error('Migration M2 Error:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
