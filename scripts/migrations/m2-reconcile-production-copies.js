/**
 * scripts/migrations/m2-reconcile-production-copies.js
 * Migration M2: Reconciles production copies across SectionTimetable and SemesterTemplate
 * Supports dry-run: node scripts/migrations/m2-reconcile-production-copies.js --dry-run
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const cfg = require('../../config');
const M = require('../../models');

async function runMigration() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`[M2 Migration] Reconciling production copies (dry-run: ${isDryRun})...`);

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(cfg.MONGO_URI, { dbName: cfg.DB_NAME });
  }

  const sections = await M.SectionTimetable.find({}).lean();
  let reconciled = 0;

  for (const sec of sections) {
    const publishedTmpl = await M.SemesterTemplate.findOne({
      classId: sec.classId,
      status: 'published'
    }).sort({ updatedAt: -1 });

    if (!publishedTmpl) {
      console.log(`  ! Class ${sec.classId} has SectionTimetable but no published SemesterTemplate.`);
      if (!isDryRun) {
        const slots = sec.slots ? (typeof sec.slots === 'object' ? Object.values(sec.slots) : []) : [];
        await M.SemesterTemplate.create({
          classId: sec.classId,
          className: sec.className,
          status: 'published',
          version: sec.headVersion || 1,
          versionName: `Production v${sec.headVersion || 1}`,
          grid: slots.filter(Boolean),
          publishedAt: sec.updatedAt || new Date(),
          publishedBy: 'System M2 Reconcile'
        });
        reconciled++;
      }
    }
  }

  console.log(`[M2 Migration Complete]: ${reconciled} templates reconciled.`);
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[M2 Migration Error]:', err);
      process.exit(1);
    });
}

module.exports = { runMigration };
