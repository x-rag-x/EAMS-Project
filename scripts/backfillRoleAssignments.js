/**
 * scripts/backfillRoleAssignments.js
 * Backfills RoleAssignment collection from existing database records (§4.5, R4.3).
 * Detects and reports data conflicts without throwing unhandled exceptions.
 */
const mongoose = require('mongoose');
const cfg = require('../config');
const M = require('../models');
const { getRoleKeys } = require('../utils/roleAssign');

async function backfillRoles(options = {}) {
  const { dryRun = false } = options;
  console.log(`[Backfill] Starting RoleAssignment backfill (dryRun: ${dryRun})...`);

  const conflicts = [];
  const created = [];

  // Helper to safely insert or record conflict
  async function safeBackfill({ role, scopeType, scopeId, deptId, teacher, reason }) {
    if (!teacher || !teacher._id) return;

    const { slotKey, holderKey } = getRoleKeys(role, scopeId, teacher._id);

    // Check if an assignment already exists for this slot
    if (slotKey) {
      const existingSlot = await M.RoleAssignment.findOne({ slotKey, active: true }).lean();
      if (existingSlot) {
        if (String(existingSlot.teacherId) !== String(teacher._id)) {
          conflicts.push({
            type: 'SLOT_CONFLICT',
            role,
            slotKey,
            existingTeacher: existingSlot.teacherName,
            attemptedTeacher: teacher.fullName,
            detail: `Multiple faculty members found for single slot ${slotKey}`
          });
          return;
        }
        // Already assigned to same teacher
        return;
      }
    }

    // Check holder key uniqueness (e.g. one HOD / Super Admin per teacher)
    if (holderKey) {
      const existingHolder = await M.RoleAssignment.findOne({ holderKey, active: true }).lean();
      if (existingHolder) {
        conflicts.push({
          type: 'HOLDER_CONFLICT',
          role,
          holderKey,
          teacher: teacher.fullName,
          detail: `Teacher already holds another slot with key ${holderKey}`
        });
        return;
      }
    }

    const doc = {
      role,
      scopeType,
      scopeId: scopeId || null,
      deptId: deptId || null,
      teacherId: teacher._id,
      teacherTrackId: teacher.trackId,
      teacherName: teacher.fullName,
      active: true,
      from: new Date(),
      slotKey,
      holderKey,
      assignedBy: { trackId: 'SYSTEM', name: 'Backfill Migration' },
      endReason: reason || 'Migrated from active state'
    };

    if (!dryRun) {
      await M.RoleAssignment.create(doc);
    }
    created.push({ role, teacherName: teacher.fullName, slotKey });
  }

  // 1. Backfill HODs from Department collection
  const departments = await M.Department.find().lean();
  for (const dept of departments) {
    if (dept.hodId) {
      const teacher = await M.Teacher.findById(dept.hodId).lean();
      if (teacher) {
        await safeBackfill({
          role: 'hod',
          scopeType: 'department',
          scopeId: dept._id,
          deptId: dept._id,
          teacher,
          reason: 'Backfilled from Department.hodId'
        });
      }
    }
  }

  // 2. Backfill Class Advisors from Class collection
  const classes = await M.Class.find().lean();
  for (const cls of classes) {
    if (cls.advisorTeacherId) {
      const teacher = await M.Teacher.findById(cls.advisorTeacherId).lean();
      if (teacher) {
        await safeBackfill({
          role: 'classAdvisor',
          scopeType: 'class',
          scopeId: cls._id,
          deptId: cls.deptId || null,
          teacher,
          reason: 'Backfilled from Class.advisorTeacherId'
        });
      }
    }
  }

  // 3. Backfill Principals from Specials
  const principalTeachers = await M.Teacher.find({
    'specials.option': 'isPrincipal'
  }).lean();
  for (const p of principalTeachers) {
    await safeBackfill({
      role: 'principal',
      scopeType: 'institution',
      scopeId: null,
      deptId: null,
      teacher: p,
      reason: 'Backfilled from specials.isPrincipal'
    });
  }

  // 4. Backfill Super Admins from Teacher pageRights
  const superAdminTeachers = await M.Teacher.find({
    'pageRights.accessRole': 'superAdmin'
  }).lean();
  for (const s of superAdminTeachers) {
    await safeBackfill({
      role: 'superAdmin',
      scopeType: 'department',
      scopeId: s.deptId || null,
      deptId: s.deptId || null,
      teacher: s,
      reason: 'Backfilled from pageRights.accessRole superAdmin'
    });
  }

  // 5. Backfill TT Coordinators from Teacher specials
  const ttTeachers = await M.Teacher.find({
    'specials.option': 'isTimeTableCoordinator'
  }).lean();
  for (const t of ttTeachers) {
    await safeBackfill({
      role: 'ttCoordinator',
      scopeType: 'department',
      scopeId: t.deptId || null,
      deptId: t.deptId || null,
      teacher: t,
      reason: 'Backfilled from specials.isTimeTableCoordinator'
    });
  }

  // 6. Backfill Placement Coordinators from Teacher specials
  const placeTeachers = await M.Teacher.find({
    'specials.option': 'isPlacementCoordinator'
  }).lean();
  for (const pl of placeTeachers) {
    await safeBackfill({
      role: 'placementCoordinator',
      scopeType: 'department',
      scopeId: pl.deptId || null,
      deptId: pl.deptId || null,
      teacher: pl,
      reason: 'Backfilled from specials.isPlacementCoordinator'
    });
  }

  // 7. Backfill Wardens from Block collection
  const blocks = await M.Block.find().lean();
  for (const blk of blocks) {
    if (blk.wardenTrackId) {
      const teacher = await M.Teacher.findOne({ trackId: blk.wardenTrackId }).lean();
      if (teacher) {
        await safeBackfill({
          role: 'warden',
          scopeType: 'block',
          scopeId: blk._id,
          deptId: null,
          teacher,
          reason: 'Backfilled from Block.wardenTrackId'
        });
      }
    }
  }

  // 8. Backfill Sudo Admin
  const sudoTeachers = await M.Teacher.find({
    $or: [
      { username: 'admin' },
      { 'pageRights.accessRole': 'sudoAdmin' }
    ]
  }).lean();
  for (const su of sudoTeachers) {
    await safeBackfill({
      role: 'sudoAdmin',
      scopeType: 'institution',
      scopeId: null,
      deptId: null,
      teacher: su,
      reason: 'Backfilled Sudo Administrator'
    });
  }

  console.log(`[Backfill] Complete! Created assignments: ${created.length}, Conflicts detected: ${conflicts.length}`);
  if (conflicts.length > 0) {
    console.warn('[Backfill Conflicts Report]:', JSON.stringify(conflicts, null, 2));
  }

  return { created, conflicts };
}

if (require.main === module) {
  const isDryRun = process.argv.includes('--dry-run');
  mongoose.connect(cfg.MONGO_URI, { dbName: cfg.DB_NAME })
    .then(async () => {
      await backfillRoles({ dryRun: isDryRun });
      process.exit(0);
    })
    .catch(err => {
      console.error('[Backfill Error]:', err);
      process.exit(1);
    });
}

module.exports = { backfillRoles };
