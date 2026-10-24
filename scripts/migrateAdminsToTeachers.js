/**
 * scripts/migrateAdminsToTeachers.js
 *
 * EAMS Admin Unification Data Migration Script
 * Conforming to dev/curr/2.4/schema changes (§7 & §12)
 *
 * Usage:
 *   node scripts/migrateAdminsToTeachers.js            # Dry run (default, audits and reports plan)
 *   node scripts/migrateAdminsToTeachers.js --apply    # Executes migration
 *
 * Invariants:
 *   - Raw collection access (zero dependency on legacy Admin model)
 *   - Idempotent: safe to run multiple times
 *   - Preserves _id, trackId, passwords, passwordHistory, mustChangePassword
 *   - Renames admins collection to admins_legacy_YYYYMMDD (never drops it)
 *   - Removes dead specials (HodDeptTrackId, ClassAdvisorTrackId, TTDeptTrackId)
 *   - Normalizes existing teacher-admins and shadow users
 */

'use strict';

const path = require('path');
const { todayIST } = require('../utils/institutionTime');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const dns = require('dns');
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (e) {}

const mongoose = require('mongoose');

const SUDO_PAGE_RIGHTS = [
  {
    page: '*',
    module: '*',
    accessRole: 'sudoAdmin',
    scope: 'institution',
    deptId: null,
    actions: ['view', 'create', 'edit', 'delete', 'export', 'import', 'manage', 'execute'],
    enabled: true
  }
];

const LEGACY_RIGHT_MAP = {
  controlPage: { page: 'control', module: '*', accessRole: 'staff', scope: 'institution', deptId: null, actions: ['view', 'edit'], enabled: true },
  managePage: { page: 'manage', module: '*', accessRole: 'staff', scope: 'institution', deptId: null, actions: ['view', 'edit', 'create', 'delete'], enabled: true },
  bulkPage: { page: 'bulk', module: '*', accessRole: 'staff', scope: 'institution', deptId: null, actions: ['view', 'create', 'edit'], enabled: true },
  settingsPage: { page: 'settings', module: '*', accessRole: 'staff', scope: 'institution', deptId: null, actions: ['view', 'edit'], enabled: true },
  settingsModule: { page: 'settings', module: '*', accessRole: 'staff', scope: 'institution', deptId: null, actions: ['view', 'edit'], enabled: true },
  timetablePage: { page: 'timetable', module: '*', accessRole: 'staff', scope: 'institution', deptId: null, actions: ['view', 'edit', 'create'], enabled: true },
  reports: { page: 'export', module: '*', accessRole: 'staff', scope: 'institution', deptId: null, actions: ['view', 'export'], enabled: true },
  reportsModule: { page: 'export', module: '*', accessRole: 'staff', scope: 'institution', deptId: null, actions: ['view', 'export'], enabled: true },
  downloadDatas: { page: 'control', module: 'data-export', accessRole: 'staff', scope: 'institution', deptId: null, actions: ['export'], enabled: true }
};

function migrateLegacyRights(tokens) {
  const tokenList = Array.isArray(tokens) ? tokens : (tokens ? [tokens] : []);
  if (tokenList.includes('all')) return [...SUDO_PAGE_RIGHTS];
  const entries = [];
  for (const t of tokenList) {
    if (LEGACY_RIGHT_MAP[t]) entries.push({ ...LEGACY_RIGHT_MAP[t] });
  }
  return entries;
}

async function runMigration(options = {}) {
  const isApply = Boolean(options.apply);
  const log = options.verbose !== false ? console.log : () => {};

  log('\n===============================================================');
  log(`  EAMS Admin Unification Migration: ${isApply ? 'APPLY MODE' : 'DRY RUN (AUDIT)'}`);
  log('===============================================================\n');

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection is not open. Connect mongoose before running migration.');
  }

  // Raw collections
  const adminCol = db.collection('admins');
  const teacherCol = db.collection('teachers');
  const studentCol = db.collection('students');
  const userCol = db.collection('users');
  const loginHistoryCol = db.collection('loginhistories');
  const exportTemplateCol = db.collection('exporttemplates');
  const exportHistoryCol = db.collection('exporthistories');
  const departmentCol = db.collection('departments');
  const classCol = db.collection('classes');
  const passwordCol = db.collection('passwords');

  // Check if legacy admins collection exists
  const existingCollections = await db.listCollections().toArray();
  const collNames = new Set(existingCollections.map(c => c.name));
  const hasAdminsCollection = collNames.has('admins');

  // ────────────────────────────────────────────────────────────────
  // STEP 2: PLAN PASS (THE AUDIT)
  // ────────────────────────────────────────────────────────────────
  log('--- Step 2: Plan Pass & Database Audit ---');

  let legacyAdmins = [];
  if (hasAdminsCollection) {
    legacyAdmins = await adminCol.find({}).toArray();
  }

  const adminByFlag = { superadmin: 0, principal: 0, subadmin: 0, other: 0 };
  for (const a of legacyAdmins) {
    const flag = a.adminFlag || 'other';
    adminByFlag[flag] = (adminByFlag[flag] || 0) + 1;
  }
  log(`• Found ${legacyAdmins.length} documents in legacy 'admins' collection:`, adminByFlag);

  // Check username & trackId clashes between admins and teachers
  const adminUsernames = legacyAdmins.map(a => (a.username || '').toLowerCase().trim()).filter(Boolean);
  const adminTrackIds = legacyAdmins.map(a => a.trackId).filter(Boolean);

  const existingTeachersWithAdminTrackId = await teacherCol.find({ trackId: { $in: adminTrackIds } }).toArray();
  const existingTeacherTrackIds = new Set(existingTeachersWithAdminTrackId.map(t => t.trackId));

  const existingTeachersWithAdminUsername = await teacherCol.find({
    username: { $in: adminUsernames },
    trackId: { $nin: adminTrackIds }
  }).toArray();

  const existingTeachersByUsername = new Map();
  for (const t of existingTeachersWithAdminUsername) {
    existingTeachersByUsername.set((t.username || '').toLowerCase().trim(), t);
  }

  if (existingTeachersWithAdminUsername.length > 0) {
    log(`• Detected ${existingTeachersWithAdminUsername.length} username clash(es) between legacy admin and existing teacher (will merge per §4.8):`);
    for (const t of existingTeachersWithAdminUsername) {
      log(`    - Legacy admin @${t.username} -> Merging into Teacher trackId: ${t.trackId}`);
    }
  }

  // Check duplicate trackId within teachers
  const teacherTrackIdDups = await teacherCol.aggregate([
    { $match: { trackId: { $exists: true, $ne: '' } } },
    { $group: { _id: '$trackId', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  if (teacherTrackIdDups.length > 0) {
    log(`⚠️  Warning: Duplicate trackId(s) found in 'teachers' collection:`, teacherTrackIdDups.map(d => d._id));
  }

  // Check duplicate trackId within students
  const studentTrackIdDups = await studentCol.aggregate([
    { $match: { trackId: { $exists: true, $ne: '' } } },
    { $group: { _id: '$trackId', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  if (studentTrackIdDups.length > 0) {
    log(`⚠️  Warning: Duplicate trackId(s) found in 'students' collection:`, studentTrackIdDups.map(d => d._id));
  }

  // Check principal presence in teachers
  const teacherWithPrincipal = await teacherCol.findOne({
    $or: [
      { 'specials.option': 'isPrincipal' },
      { isPrincipal: true }
    ]
  });
  if (teacherWithPrincipal) {
    log(`• Teacher @${teacherWithPrincipal.username} (${teacherWithPrincipal.trackId}) already holds isPrincipal.`);
  }

  // Check teachers with removed specials
  const teachersWithRemovedSpecials = await teacherCol.find({
    'specials.option': { $in: ['HodDeptTrackId', 'ClassAdvisorTrackId', 'TTDeptTrackId'] }
  }).toArray();
  log(`• Found ${teachersWithRemovedSpecials.length} teacher(s) carrying removed specials options.`);

  // Check existing teacher-admins
  const existingTeacherAdmins = await teacherCol.find({
    $or: [
      { isAdmin: true },
      { adminRights: { $exists: true, $ne: [] } },
      { isPrincipal: true }
    ]
  }).toArray();
  log(`• Found ${existingTeacherAdmins.length} existing teacher-admin(s) carrying dropped top-level fields.`);

  // Check shadow users with role 'admin'
  const shadowAdminsCount = await userCol.countDocuments({ role: 'admin' });
  log(`• Found ${shadowAdminsCount} shadow user(s) with role: 'admin'.`);

  // Check students with missing deptId
  const studentsWithoutDept = await studentCol.countDocuments({
    $or: [{ deptId: { $exists: false } }, { deptId: null }]
  });
  log(`• Found ${studentsWithoutDept} student(s) without required deptId.`);

  // Summary of planned actions
  const toCopyCount = legacyAdmins.filter(a => !existingTeacherTrackIds.has(a.trackId)).length;
  const toSkipCount = legacyAdmins.length - toCopyCount;

  log('\nSummary of planned actions:');
  log(`  1. Copy ${toCopyCount} Admin document(s) into 'teachers' (skip ${toSkipCount} already existing)`);
  log(`  2. Migrate & sanitize ${existingTeacherAdmins.length} existing teacher-admin document(s)`);
  log(`  3. Clean up removed specials on ${teachersWithRemovedSpecials.length} teacher document(s)`);
  log(`  4. Update ${shadowAdminsCount} shadow user(s) from role 'admin' to 'teacher'`);
  log(`  5. Invalidate active sessions for ${adminTrackIds.length} admin trackId(s)`);
  log(`  6. Update ExportTemplate & ExportHistory userModel: 'Admin' -> 'Teacher'`);
  if (hasAdminsCollection && legacyAdmins.length > 0) {
    log(`  7. Rename 'admins' collection to 'admins_legacy_YYYYMMDD'`);
  }

  if (!isApply) {
    log('\n[DRY RUN COMPLETE] No modifications were written to the database.');
    log('Run with --apply to execute these changes.\n');
    return {
      success: true,
      mode: 'dry-run',
      legacyAdminsCount: legacyAdmins.length,
      toCopyCount,
      toSkipCount,
      teachersWithRemovedSpecialsCount: teachersWithRemovedSpecials.length,
      existingTeacherAdminsCount: existingTeacherAdmins.length,
      shadowAdminsCount,
      studentsWithoutDept
    };
  }

  // ────────────────────────────────────────────────────────────────
  // STEP 3: COPY EACH ADMIN TO TEACHERS
  // ────────────────────────────────────────────────────────────────
  log('\n--- Step 3: Copying Admin Documents to Teachers ---');
  let copiedCount = 0;
  let principalAssigned = Boolean(teacherWithPrincipal);

  for (const admin of legacyAdmins) {
    if (existingTeacherTrackIds.has(admin.trackId)) {
      log(`  ↷ Skipping @${admin.username} (${admin.trackId}) — already present in teachers`);
      continue;
    }

    const isPrincipalAccount = admin.adminFlag === 'principal';
    const canHavePrincipal = isPrincipalAccount && !principalAssigned;

    const specials = [{ option: 'isAdmin', value: true }];
    if (canHavePrincipal) {
      specials.push({ option: 'isPrincipal', value: true });
      principalAssigned = true;
    }

    let pageRights = [];
    const isSuperOrPrincipal = admin.adminFlag === 'superadmin' || isPrincipalAccount;
    const hasAllRights = Array.isArray(admin.adminRights)
      ? admin.adminRights.includes('all')
      : admin.adminRights === 'all';

    if (isSuperOrPrincipal || hasAllRights) {
      pageRights = [...SUDO_PAGE_RIGHTS];
    } else {
      const rawRights = Array.isArray(admin.adminRights) ? admin.adminRights : (admin.adminRights ? [admin.adminRights] : []);
      pageRights = migrateLegacyRights(rawRights);
    }

    const matchedTeacher = existingTeachersByUsername.get((admin.username || '').toLowerCase().trim());
    if (matchedTeacher) {
      log(`  ⇄ Merging legacy admin @${admin.username} (${admin.trackId}) into existing Teacher doc @${matchedTeacher.username} (${matchedTeacher.trackId})`);

      const mergedSpecials = Array.isArray(matchedTeacher.specials) ? [...matchedTeacher.specials] : [];
      if (!mergedSpecials.some(s => s && s.option === 'isAdmin')) {
        mergedSpecials.push({ option: 'isAdmin', value: true });
      }
      if (canHavePrincipal && !mergedSpecials.some(s => s && s.option === 'isPrincipal')) {
        mergedSpecials.push({ option: 'isPrincipal', value: true });
        principalAssigned = true;
      }

      const mergedPageRights = Array.isArray(matchedTeacher.pageRights) ? [...matchedTeacher.pageRights] : [];
      pageRights.forEach(pr => {
        if (!mergedPageRights.some(existing => existing.page === pr.page && existing.accessRole === pr.accessRole)) {
          mergedPageRights.push(pr);
        }
      });

      await teacherCol.updateOne(
        { _id: matchedTeacher._id },
        {
          $set: {
            specials: mergedSpecials,
            pageRights: mergedPageRights,
            updatedAt: new Date()
          }
        }
      );
      copiedCount++;
      continue;
    }

    const designation = admin.username === 'admin'
      ? 'System Administrator'
      : (canHavePrincipal ? 'Principal' : (isSuperOrPrincipal ? 'Administrator' : 'Sub-Administrator'));

    const teacherDoc = {
      _id: admin._id,
      trackId: admin.trackId,
      username: admin.username,
      password: admin.password,
      passwordHistory: Array.isArray(admin.passwordHistory) ? admin.passwordHistory : [],
      mustChangePassword: Boolean(admin.mustChangePassword),
      fullName: admin.fullName || `${admin.firstName || ''} ${admin.lastName || ''}`.trim() || 'Administrator',
      firstName: admin.firstName || '',
      lastName: admin.lastName || null,
      email: admin.email || '',
      employeeNo: admin.employeeNo || '',
      department: admin.department || 'Administration',
      designation,
      specials,
      pageRights,
      status: admin.active === false ? 'inactive' : 'active',
      createdAt: admin.createdAt || new Date(),
      updatedAt: admin.updatedAt || new Date()
    };

    await teacherCol.insertOne(teacherDoc);
    copiedCount++;
    log(`  ✓ Migrated admin @${admin.username} -> Teacher (${designation})`);

    // Ensure password entry in centralized collection if password exists
    if (admin.password) {
      await passwordCol.updateOne(
        { trackId: admin.trackId },
        {
          $set: {
            trackId: admin.trackId,
            username: admin.username.toLowerCase().trim(),
            hash: admin.password,
            status: admin.active === false ? 'expired' : 'active',
            mustChangePassword: Boolean(admin.mustChangePassword),
            passwordChangedAt: admin.updatedAt || new Date(),
            passwordHistory: Array.isArray(admin.passwordHistory) ? admin.passwordHistory : [],
            migratedFrom: 'admin',
            migratedAt: new Date()
          }
        },
        { upsert: true }
      );
    }
  }

  // ────────────────────────────────────────────────────────────────
  // STEP 5: MIGRATE EXISTING TEACHER-ADMINS
  // ────────────────────────────────────────────────────────────────
  log('\n--- Step 5: Normalizing Existing Teacher-Admins ---');
  let normalizedTeacherCount = 0;

  for (const t of existingTeacherAdmins) {
    const specials = Array.isArray(t.specials) ? [...t.specials] : [];
    if (!specials.some(s => s && s.option === 'isAdmin')) {
      specials.push({ option: 'isAdmin', value: true });
    }
    if (t.isPrincipal === true && !specials.some(s => s && s.option === 'isPrincipal')) {
      specials.push({ option: 'isPrincipal', value: true });
    }

    let pageRights = Array.isArray(t.pageRights) ? [...t.pageRights] : [];
    const hasAll = Array.isArray(t.adminRights)
      ? t.adminRights.includes('all')
      : t.adminRights === 'all';

    if (hasAll || pageRights.length === 0) {
      if (hasAll) {
        pageRights = [...SUDO_PAGE_RIGHTS];
      } else if (Array.isArray(t.adminRights) && t.adminRights.length > 0) {
        pageRights = migrateLegacyRights(t.adminRights);
      }
    }

    await teacherCol.updateOne(
      { _id: t._id },
      {
        $set: { specials, pageRights },
        $unset: { isAdmin: '', adminRights: '', isPrincipal: '' }
      }
    );
    normalizedTeacherCount++;
    log(`  ✓ Sanitized legacy fields on teacher @${t.username}`);
  }

  // ────────────────────────────────────────────────────────────────
  // STEP 6: SPECIALS CLEAN-UP
  // ────────────────────────────────────────────────────────────────
  log('\n--- Step 6: Cleaning Up Removed Legacy Specials on All Teachers ---');
  const cleanupResult = await teacherCol.updateMany(
    {},
    {
      $pull: {
        specials: {
          option: { $in: ['HodDeptTrackId', 'ClassAdvisorTrackId', 'TTDeptTrackId'] }
        }
      }
    }
  );
  log(`  ✓ Removed dead specials from ${cleanupResult.modifiedCount} teacher document(s)`);

  // ────────────────────────────────────────────────────────────────
  // STEP 7: SHADOW USERS MIGRATION
  // ────────────────────────────────────────────────────────────────
  log('\n--- Step 7: Updating Shadow Users ---');
  const userResult = await userCol.updateMany(
    { role: 'admin' },
    { $set: { role: 'teacher' } }
  );
  log(`  ✓ Updated ${userResult.modifiedCount} shadow user(s) to role: 'teacher'`);

  // ────────────────────────────────────────────────────────────────
  // STEP 8: INVALIDATE SESSIONS FOR MIGRATED TRACK IDS
  // ────────────────────────────────────────────────────────────────
  log('\n--- Step 8: Invalidating Active Sessions for Migrated Track IDs ---');
  if (adminTrackIds.length > 0) {
    const sessionResult = await loginHistoryCol.updateMany(
      { trackId: { $in: adminTrackIds }, isActive: true },
      { $set: { isActive: false, logoutTime: new Date() } }
    );
    log(`  ✓ Invalidated ${sessionResult.modifiedCount} active login session(s)`);
  }

  // ────────────────────────────────────────────────────────────────
  // STEP 9: UPDATE EXPORT MODEL REFERENCES
  // ────────────────────────────────────────────────────────────────
  log('\n--- Step 9: Updating Export References ---');
  const templateResult = await exportTemplateCol.updateMany(
    { userModel: 'Admin' },
    { $set: { userModel: 'Teacher' } }
  );
  const historyResult = await exportHistoryCol.updateMany(
    { userModel: 'Admin' },
    { $set: { userModel: 'Teacher' } }
  );
  log(`  ✓ Updated ${templateResult.modifiedCount} ExportTemplate(s) and ${historyResult.modifiedCount} ExportHistory record(s)`);

  // ────────────────────────────────────────────────────────────────
  // STEP 10: RENAME LEGACY ADMINS COLLECTION
  // ────────────────────────────────────────────────────────────────
  if (hasAdminsCollection && legacyAdmins.length > 0) {
    log("\n--- Step 10: Renaming Legacy 'admins' Collection ---");
    const dateStr = todayIST().replace(/-/g, '');
    let legacyName = `admins_legacy_${dateStr}`;
    let counter = 1;
    while (collNames.has(legacyName)) {
      legacyName = `admins_legacy_${dateStr}_${counter++}`;
    }
    await adminCol.rename(legacyName);
    log(`  ✓ Renamed 'admins' -> '${legacyName}' (collection retained for rollback reference)`);
  }

  // ────────────────────────────────────────────────────────────────
  // STEP 11: VERIFICATION PASS
  // ────────────────────────────────────────────────────────────────
  log('\n--- Step 11: Integrity Verification ---');
  const remainingShadowAdmins = await userCol.countDocuments({ role: 'admin' });
  const remainingRemovedSpecials = await teacherCol.countDocuments({
    'specials.option': { $in: ['HodDeptTrackId', 'ClassAdvisorTrackId', 'TTDeptTrackId'] }
  });
  const remainingDroppedWrites = await teacherCol.countDocuments({
    $or: [{ isAdmin: { $exists: true } }, { adminRights: { $exists: true } }, { isPrincipal: { $exists: true } }]
  });
  const activeSudoAdmins = await teacherCol.countDocuments({
    'specials.option': 'isAdmin',
    'pageRights.accessRole': 'sudoAdmin',
    status: { $ne: 'inactive' }
  });

  log(`• Remaining shadow users with role 'admin': ${remainingShadowAdmins} (expected 0)`);
  log(`• Teachers with removed specials: ${remainingRemovedSpecials} (expected 0)`);
  log(`• Teachers with dropped top-level fields: ${remainingDroppedWrites} (expected 0)`);
  log(`• Active Sudo Admins verified: ${activeSudoAdmins} (expected >= 1)`);

  if (remainingShadowAdmins > 0 || remainingRemovedSpecials > 0 || remainingDroppedWrites > 0) {
    throw new Error('VERIFICATION FAILED: Database state contains remaining legacy records.');
  }

  log('\n🎉 EAMS Admin Unification Migration Successfully Completed!\n');

  return {
    success: true,
    mode: 'apply',
    copiedCount,
    normalizedTeacherCount,
    cleanedSpecialsCount: cleanupResult.modifiedCount,
    updatedShadowUsersCount: userResult.modifiedCount,
    activeSudoAdmins
  };
}

// ────────────────────────────────────────────────────────────────
// Standalone CLI Execution
// ────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const cfg = require('../config');
  const mongoUri = cfg.MONGO_URI || process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!mongoUri) {
    console.error('❌ MONGO_URI is not set in environment or .env');
    process.exit(1);
  }

  mongoose.connect(mongoUri, {
    dbName: cfg.DB_NAME || process.env.DB_NAME,
    serverSelectionTimeoutMS: 8000
  })
    .then(async () => {
      console.log('Connected to MongoDB Atlas');
      const result = await runMigration({ apply, verbose: true });
      await mongoose.disconnect();
      console.log('Result:', result);
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('\n❌ Migration failed:', err);
      try { await mongoose.disconnect(); } catch (_) {}
      process.exit(1);
    });
}

module.exports = {
  runMigration
};
