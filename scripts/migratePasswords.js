/**
 * EAMS Credential Migration Script
 *
 * Migrates existing passwords from role models (Admin, Teacher, Student)
 * into the centralized Password collection (M.Password).
 *
 * Features:
 *   - Idempotent upsert by trackId and username
 *   - Preserves existing bcrypt password hashes untouched
 *   - Migrates password history and mustChangePassword flags
 *   - Verification count audit
 *
 * Can be run standalone:
 *   node scripts/migratePasswords.js
 * Or imported into dbMigrator / startup:
 *   const { migratePasswords, verifyCredentialMigration } = require('./scripts/migratePasswords');
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const M = require('../models');

async function migratePasswords(options = { verbose: true }) {
  const log = options.verbose ? console.log : () => {};
  log('Starting EAMS credential migration to unified Password collection...');

  let adminCount = 0;
  let teacherCount = 0;
  let studentCount = 0;
  let skippedCount = 0;

  // ── 1. Migrate Legacy Admins (if collection exists) ──
  const adminColExists = await mongoose.connection.db.listCollections({ name: 'admins' }).hasNext();
  const admins = adminColExists
    ? await mongoose.connection.db.collection('admins').find({ password: { $exists: true, $ne: '' } }).toArray()
    : [];
  for (const admin of admins) {
    if (!admin.username || !admin.password) {
      skippedCount++;
      continue;
    }
    const trackId = admin.trackId || String(admin._id);
    const username = admin.username.toLowerCase().trim();

    await M.Password.updateOne(
      { trackId },
      {
        $set: {
          trackId,
          username,
          hash: admin.password,
          status: admin.status === 'inactive' ? 'expired' : 'active',
          mustChangePassword: !!admin.mustChangePassword,
          passwordChangedAt: admin.passwordChangedAt || admin.updatedAt || new Date(),
          passwordHistory: Array.isArray(admin.passwordHistory) ? admin.passwordHistory : [],
          migratedFrom: 'admin',
          migratedAt: new Date(),
        },
      },
      { upsert: true }
    );
    adminCount++;
  }
  log(`  ✓ Migrated ${adminCount} Admin credential(s)`);

  // ── 2. Migrate Teachers ──
  const teachers = await M.Teacher.find({ password: { $exists: true, $ne: '' } }).select('+password');
  for (const teacher of teachers) {
    if (!teacher.username || !teacher.password) {
      skippedCount++;
      continue;
    }
    const trackId = teacher.trackId || String(teacher._id);
    const username = teacher.username.toLowerCase().trim();

    await M.Password.updateOne(
      { trackId },
      {
        $set: {
          trackId,
          username,
          hash: teacher.password,
          status: teacher.status === 'inactive' ? 'expired' : 'active',
          mustChangePassword: !!teacher.mustChangePassword,
          passwordChangedAt: teacher.passwordChangedAt || teacher.updatedAt || new Date(),
          passwordHistory: Array.isArray(teacher.passwordHistory) ? teacher.passwordHistory : [],
          migratedFrom: 'teacher',
          migratedAt: new Date(),
        },
      },
      { upsert: true }
    );
    teacherCount++;
  }
  log(`  ✓ Migrated ${teacherCount} Teacher credential(s)`);

  // ── 3. Migrate Students ──
  const students = await M.Student.find({ password: { $exists: true, $ne: '' } }).select('+password');
  for (const student of students) {
    if (!student.username || !student.password) {
      skippedCount++;
      continue;
    }
    const trackId = student.trackId || String(student._id);
    const username = student.username.toLowerCase().trim();

    await M.Password.updateOne(
      { trackId },
      {
        $set: {
          trackId,
          username,
          hash: student.password,
          status: student.status === 'inactive' ? 'expired' : 'active',
          mustChangePassword: !!student.mustChangePassword,
          passwordChangedAt: student.passwordChangedAt || student.updatedAt || new Date(),
          passwordHistory: Array.isArray(student.passwordHistory) ? student.passwordHistory : [],
          migratedFrom: 'student',
          migratedAt: new Date(),
        },
      },
      { upsert: true }
    );
    studentCount++;
  }
  log(`  ✓ Migrated ${studentCount} Student credential(s)`);

  const total = adminCount + teacherCount + studentCount;
  log(` Credential migration complete! Total accounts migrated: ${total} (skipped: ${skippedCount})`);

  return {
    success: true,
    total,
    adminCount,
    teacherCount,
    studentCount,
    skippedCount,
  };
}

async function verifyCredentialMigration() {
  const adminColExists = await mongoose.connection.db.listCollections({ name: 'admins' }).hasNext();
  const adminCount = adminColExists
    ? await mongoose.connection.db.collection('admins').countDocuments({ password: { $exists: true, $ne: '' } })
    : 0;

  const [totalPasswords, teacherCount, studentCount] = await Promise.all([
    M.Password.countDocuments(),
    M.Teacher.countDocuments({ password: { $exists: true, $ne: '' } }),
    M.Student.countDocuments({ password: { $exists: true, $ne: '' } }),
  ]);

  const expectedMin = adminCount + teacherCount + studentCount;
  return {
    totalInPasswordCollection: totalPasswords,
    expectedMin,
    consistent: totalPasswords >= expectedMin,
  };
}

// Standalone runner
if (require.main === module) {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGO_URI is not set in environment or .env');
    process.exit(1);
  }

  mongoose.connect(mongoUri)
    .then(async () => {
      console.log('Connected to MongoDB Atlas');
      await migratePasswords();
      const audit = await verifyCredentialMigration();
      console.log('Integrity Audit:', audit);
      await mongoose.disconnect();
      console.log('Done.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = {
  migratePasswords,
  verifyCredentialMigration,
};
