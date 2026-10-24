const dns = require('dns');
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (e) {}

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const cfg = require('../config');
const M = require('../models');
const { normalizeYearRange, isValidYearRange, toBatchTrackId } = require('../utils/yearFormat');
const { invalidateSettingsCache } = require('../utils/settingsCache');

async function migrateYearFormats() {
  console.log('> Connecting to database for year format migration...');
  await mongoose.connect(cfg.MONGO_URI, { dbName: cfg.DB_NAME });
  console.log(`> Connected to ${cfg.DB_NAME}`);

  let totalUpdated = 0;

  // 1. Migrate Students
  const students = await M.Student.find({}).lean();
  let studentCount = 0;
  for (const s of students) {
    const normBatch = normalizeYearRange(s.batch);
    const normAy = normalizeYearRange(s.admissionYear);
    const normTrackId = normBatch ? toBatchTrackId(normBatch) : s.batchTrackId;

    const updates = {};
    if (s.batch && s.batch !== normBatch) updates.batch = normBatch;
    if (s.admissionYear && s.admissionYear !== normAy) updates.admissionYear = normAy;
    if (normTrackId && s.batchTrackId !== normTrackId) updates.batchTrackId = normTrackId;

    if (Object.keys(updates).length > 0) {
      await M.Student.updateOne({ _id: s._id }, { $set: updates });
      studentCount++;
    }
  }
  console.log(`  Updated ${studentCount} student records to YYYY-YYYY format.`);
  totalUpdated += studentCount;

  // 2. Migrate Classes
  const classes = await M.Class.find({}).lean();
  let classCount = 0;
  for (const c of classes) {
    const normBatch = normalizeYearRange(c.batch);
    if (c.batch && c.batch !== normBatch) {
      await M.Class.updateOne({ _id: c._id }, { $set: { batch: normBatch } });
      classCount++;
    }
  }
  console.log(`  Updated ${classCount} class records to YYYY-YYYY format.`);
  totalUpdated += classCount;

  // 3. Migrate Years
  const years = await M.Year.find({});
  let yearCount = 0;
  for (const y of years) {
    let changed = false;
    const normAy = normalizeYearRange(y.academicYear);
    if (y.academicYear !== normAy) {
      y.academicYear = normAy;
      changed = true;
    }

    if (Array.isArray(y.batches)) {
      const seenBatches = new Set();
      const dedupedBatches = [];
      for (const b of y.batches) {
        const normB = normalizeYearRange(b.batch);
        const normTrackId = b.batchTrackId || toBatchTrackId(normB);
        if (!seenBatches.has(normB)) {
          seenBatches.add(normB);
          if (b.batch !== normB || b.batchTrackId !== normTrackId) {
            b.batch = normB;
            b.batchTrackId = normTrackId;
            changed = true;
          }
          dedupedBatches.push(b);
        } else {
          changed = true;
        }
      }
      if (dedupedBatches.length !== y.batches.length) {
        y.batches = dedupedBatches;
        changed = true;
      }
    }

    if (changed) {
      await y.save();
      yearCount++;
    }
  }
  console.log(`  Updated ${yearCount} academic year configurations.`);
  totalUpdated += yearCount;

  // 4. Migrate BulkImportBatches
  const bulkBatches = await M.BulkImportBatch.find({});
  let bulkCount = 0;
  for (const bb of bulkBatches) {
    let changed = false;
    if (Array.isArray(bb.eligibleRows)) {
      for (const row of bb.eligibleRows) {
        if (row.data) {
          if (row.data.batch) {
            const nb = normalizeYearRange(row.data.batch);
            if (row.data.batch !== nb) { row.data.batch = nb; changed = true; }
          }
          if (row.data.academicYear) {
            const nay = normalizeYearRange(row.data.academicYear);
            if (row.data.academicYear !== nay) { row.data.academicYear = nay; changed = true; }
          }
        }
      }
    }
    if (Array.isArray(bb.skippedRows)) {
      for (const row of bb.skippedRows) {
        if (row.data) {
          if (row.data.Batch) {
            const nb = normalizeYearRange(row.data.Batch);
            if (row.data.Batch !== nb) { row.data.Batch = nb; changed = true; }
          }
          if (row.data.batch) {
            const nb = normalizeYearRange(row.data.batch);
            if (row.data.batch !== nb) { row.data.batch = nb; changed = true; }
          }
          if (row.data.AcademicYear) {
            const nay = normalizeYearRange(row.data.AcademicYear);
            if (row.data.AcademicYear !== nay) { row.data.AcademicYear = nay; changed = true; }
          }
          if (row.data.academicYear) {
            const nay = normalizeYearRange(row.data.academicYear);
            if (row.data.academicYear !== nay) { row.data.academicYear = nay; changed = true; }
          }
        }
      }
    }
    if (changed) {
      bb.markModified('eligibleRows');
      bb.markModified('skippedRows');
      await bb.save();
      bulkCount++;
    }
  }
  console.log(`  Updated ${bulkCount} bulk import batch history records.`);
  totalUpdated += bulkCount;

  // 5. Migrate Settings
  const acadSetting = await M.Settings.findOne({ key: 'academic' });
  if (acadSetting && acadSetting.value && acadSetting.value.academicYear) {
    const normAy = normalizeYearRange(acadSetting.value.academicYear);
    if (acadSetting.value.academicYear !== normAy) {
      acadSetting.value.academicYear = normAy;
      acadSetting.markModified('value');
      await acadSetting.save();
      invalidateSettingsCache('academic');
      console.log(`  Updated academic setting to ${normAy}`);
      totalUpdated++;
    }
  }

  // 6. Migrate Exams
  const exams = await M.Exam.find({}).lean();
  let examCount = 0;
  for (const ex of exams) {
    const updates = {};
    if (ex.batch) {
      const nb = normalizeYearRange(ex.batch);
      if (ex.batch !== nb) updates.batch = nb;
    }
    if (ex.academicYear) {
      const nay = normalizeYearRange(ex.academicYear);
      if (ex.academicYear !== nay) updates.academicYear = nay;
    }
    if (Object.keys(updates).length > 0) {
      await M.Exam.updateOne({ _id: ex._id }, { $set: updates });
      examCount++;
    }
  }
  console.log(`  Updated ${examCount} exam records.`);
  totalUpdated += examCount;

  // 7. Migrate SemesterTemplates
  const templates = await M.SemesterTemplate.find({}).lean();
  let templateCount = 0;
  for (const t of templates) {
    if (t.academicYear) {
      const nay = normalizeYearRange(t.academicYear);
      if (t.academicYear !== nay) {
        await M.SemesterTemplate.updateOne({ _id: t._id }, { $set: { academicYear: nay } });
        templateCount++;
      }
    }
  }
  console.log(`  Updated ${templateCount} semester template records.`);
  totalUpdated += templateCount;

  console.log(`\n✅ Migration complete! Total collections updated: ${totalUpdated} records modified.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  migrateYearFormats().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { migrateYearFormats };
