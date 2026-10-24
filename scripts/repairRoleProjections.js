/**
 * scripts/repairRoleProjections.js
 * Repairs and reconciles projection fields on Teacher, Department, Class, and Block
 * from active RoleAssignment records (§4.5, R4.2).
 */
const mongoose = require('mongoose');
const cfg = require('../config');
const M = require('../models');

async function repairProjections(options = {}) {
  const { dryRun = false } = options;
  console.log(`[Repair] Starting role projection repair (dryRun: ${dryRun})...`);

  const activeAssignments = await M.RoleAssignment.find({ active: true }).lean();
  console.log(`[Repair] Found ${activeAssignments.length} active RoleAssignment records.`);

  let repairedCount = 0;
  const issues = [];

  for (const assign of activeAssignments) {
    const { role, scopeId, deptId, teacherId, teacherTrackId } = assign;
    const teacher = await M.Teacher.findById(teacherId);
    if (!teacher) {
      issues.push(`Teacher ${teacherId} for active role ${role} not found in database.`);
      continue;
    }

    let modified = false;
    const currentSpecials = Array.isArray(teacher.specials) ? teacher.specials : [];

    switch (role) {
      case 'principal':
        if (!currentSpecials.some(s => s.option === 'isPrincipal')) {
          currentSpecials.push({ option: 'isPrincipal', value: true, key: '' });
          modified = true;
        }
        break;

      case 'hod': {
        const dept = await M.Department.findById(deptId || scopeId);
        if (dept) {
          if (!currentSpecials.some(s => s.option === 'isHod')) {
            currentSpecials.push({ option: 'isHod', value: true, key: '' });
            modified = true;
          }
          if (dept.trackId && !currentSpecials.some(s => s.option === 'HodDeptTrackId' && s.value === dept.trackId)) {
            currentSpecials.push({ option: 'HodDeptTrackId', value: dept.trackId, key: '' });
            modified = true;
          }
          if (String(dept.hodId) !== String(teacher._id)) {
            if (!dryRun) {
              await M.Department.updateOne({ _id: dept._id }, { $set: { hodId: teacher._id, hodName: teacher.fullName } });
            }
            repairedCount++;
          }
        }
        break;
      }

      case 'superAdmin':
        if (!currentSpecials.some(s => s.option === 'isAdmin')) {
          currentSpecials.push({ option: 'isAdmin', value: true, key: '' });
          modified = true;
        }
        if (teacher.pageRights?.accessRole !== 'superAdmin') {
          teacher.pageRights = teacher.pageRights || {};
          teacher.pageRights.accessRole = 'superAdmin';
          modified = true;
        }
        break;

      case 'ttCoordinator': {
        const dept = await M.Department.findById(deptId || scopeId);
        const dName = dept?.name || teacher.department || '';
        if (!currentSpecials.some(s => s.option === 'isTimeTableCoordinator')) {
          currentSpecials.push({ option: 'isTimeTableCoordinator', value: dName, key: dName });
          modified = true;
        }
        break;
      }

      case 'placementCoordinator': {
        const dept = await M.Department.findById(deptId || scopeId);
        const dName = dept?.name || teacher.department || '';
        if (!currentSpecials.some(s => s.option === 'isPlacementCoordinator')) {
          currentSpecials.push({ option: 'isPlacementCoordinator', value: dName, key: dName });
          modified = true;
        }
        break;
      }

      case 'classAdvisor': {
        const cls = await M.Class.findById(scopeId);
        if (cls) {
          if (!currentSpecials.some(s => s.option === 'isClassAdvisor')) {
            currentSpecials.push({ option: 'isClassAdvisor', value: true, key: '' });
            modified = true;
          }
          if (cls.trackId && !currentSpecials.some(s => s.option === 'ClassAdvisorTrackId' && s.value === cls.trackId)) {
            currentSpecials.push({ option: 'ClassAdvisorTrackId', value: cls.trackId, key: '' });
            modified = true;
          }
          if (String(cls.advisorTeacherId) !== String(teacher._id)) {
            if (!dryRun) {
              await M.Class.updateOne(
                { _id: cls._id },
                { $set: { advisorTeacherId: teacher._id, advisorTeacherName: teacher.fullName, advisorTrackId: teacher.trackId } }
              );
            }
            repairedCount++;
          }
        }
        break;
      }

      case 'warden': {
        const blk = await M.Block.findById(scopeId);
        if (blk) {
          if (!currentSpecials.some(s => s.option === 'isWarden')) {
            currentSpecials.push({ option: 'isWarden', value: blk.code, key: blk.code });
            modified = true;
          }
          if (blk.wardenTrackId !== teacherTrackId) {
            if (!dryRun) {
              await M.Block.updateOne({ _id: blk._id }, { $set: { wardenTrackId: teacherTrackId } });
            }
            repairedCount++;
          }
        }
        break;
      }
    }

    if (modified) {
      teacher.specials = currentSpecials;
      if (!dryRun) {
        await teacher.save();
      }
      repairedCount++;
    }
  }

  console.log(`[Repair] Completed. Discrepancies resolved: ${repairedCount}. Issues noted: ${issues.length}.`);
  return { repairedCount, issues };
}

if (require.main === module) {
  const isDryRun = process.argv.includes('--dry-run');
  mongoose.connect(cfg.MONGO_URI, { dbName: cfg.DB_NAME })
    .then(async () => {
      await repairProjections({ dryRun: isDryRun });
      process.exit(0);
    })
    .catch(err => {
      console.error('[Repair Error]:', err);
      process.exit(1);
    });
}

module.exports = { repairProjections };
