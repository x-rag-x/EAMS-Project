/**
 * scripts/migrations/m5-backfill-assignment-source.js
 * Migration M5: Tags existing Assignment documents with source: 'manual' or 'timetable'
 * based on timetable slot correlation.
 * Supports dry-run: node scripts/migrations/m5-backfill-assignment-source.js --dry-run
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const cfg = require('../../config');
const M = require('../../models');

async function runMigration() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`[M5 Migration] Backfilling Assignment source (dry-run: ${isDryRun})...`);

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(cfg.MONGO_URI, { dbName: cfg.DB_NAME });
  }

  // Load all published slot keys (classId_subjectId_teacherId)
  const sections = await M.SectionTimetable.find({}).lean();
  const timetableKeys = new Set();

  for (const sec of sections) {
    const slots = sec.slots ? (typeof sec.slots === 'object' ? Object.values(sec.slots) : []) : [];
    for (const slot of slots) {
      if (!slot) continue;
      const sId = slot.subjectId ? String(slot.subjectId) : null;
      const tId = slot.teacherId ? String(slot.teacherId) : null;
      if (sId && tId) {
        timetableKeys.add(`${String(sec.classId)}_${sId}_${tId}`);
      }
    }
  }

  const assignments = await M.Assignment.find({});
  console.log(`Inspecting ${assignments.length} Assignment record(s)...`);

  let timetableCount = 0;
  let manualCount = 0;

  for (const assign of assignments) {
    const key = `${String(assign.classId)}_${String(assign.subjectId)}_${String(assign.teacherId)}`;
    const matched = timetableKeys.has(key);
    const newSource = matched ? 'timetable' : 'manual';

    if (assign.source !== newSource) {
      if (!isDryRun) {
        assign.source = newSource;
        await assign.save();
      }
      if (matched) timetableCount++;
      else manualCount++;
    }
  }

  console.log(`[M5 Migration Complete]: ${timetableCount} tagged 'timetable', ${manualCount} tagged 'manual'.`);
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[M5 Migration Error]:', err);
      process.exit(1);
    });
}

module.exports = { runMigration };
