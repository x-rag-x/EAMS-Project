/**
 * scripts/migrations/m7-backfill-subject-sets.js
 * Migration M7: Backfill ClassSubjectSet Records and Generate Canonical SHA-256 Hashes
 *
 * Usage:
 *   node scripts/migrations/m7-backfill-subject-sets.js [--dry-run]
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const cfg = require('../../config');
const M = require('../../models');
const { computeRowsHash, syncClassSubjectSet } = require('../../services/subjectSetService');

/**
 * Core migration runner callable via CLI or directly in tests.
 *
 * @param {Object} opts - { dryRun: Boolean }
 * @returns {Promise<Object>} Migration report
 */
async function backfillSubjectSets(opts = {}) {
  const isDryRun = opts.dryRun !== undefined ? opts.dryRun : process.argv.includes('--dry-run');

  if (opts.connect && mongoose.connection.readyState !== 1 && cfg.MONGO_URI) {
    try {
      await mongoose.connect(cfg.MONGO_URI, { dbName: cfg.DB_NAME, serverSelectionTimeoutMS: 2000 });
    } catch (_) {}
  }

  const classes = await M.Class.find({}).lean();
  const report = {
    dryRun: isDryRun,
    totalClasses: classes.length,
    alreadyHadSet: 0,
    createdSets: 0,
    skippedNoAssignments: 0
  };

  const systemActor = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Migration M7 Backfill Worker',
    trackId: 'MIG-M7'
  };

  for (const c of classes) {
    const existing = await M.ClassSubjectSet.findOne({ classId: c._id }).lean();
    if (existing) {
      report.alreadyHadSet++;
      continue;
    }

    const assignments = await M.Assignment.find({ classId: String(c._id) }).lean();
    if (!assignments.length) {
      report.skippedNoAssignments++;
      continue;
    }

    report.createdSets++;
    if (!isDryRun) {
      await syncClassSubjectSet(c._id, assignments, systemActor);
    }
  }

  return report;
}

if (require.main === module) {
  backfillSubjectSets({ connect: true })
    .then(report => {
      console.log('--- Migration M7: Backfill Subject Sets Completed ---');
      console.log(`Dry Run: ${report.dryRun}`);
      console.log(`Total Classes Inspected: ${report.totalClasses}`);
      console.log(`Already Had ClassSubjectSet: ${report.alreadyHadSet}`);
      console.log(`Subject Sets Backfilled: ${report.createdSets}`);
      console.log(`Skipped (No Assignments): ${report.skippedNoAssignments}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration M7 Error:', err);
      process.exit(1);
    });
}

module.exports = {
  backfillSubjectSets
};
