// Backfill teacher deptId and deptCode from matching department names or codes

const M = require('../models');
const { logAction } = require('../utils/logAction');
const cfg = require('../config');
const mongoose = require('mongoose');

async function backfillTeacherDeptId() {
  try {
    await mongoose.connect(cfg.MONGO_URI);
    console.log('Connected to MongoDB');

    const departments = await M.Department.find().lean();
    const teachers = await M.Teacher.find().lean();

    let matched = 0;
    let unmatched = 0;

    for (const t of teachers) {
      if (t.deptId) {
        matched++;
        continue;
      }

      const deptStr = (t.department || '').trim();
      if (!deptStr) {
        unmatched++;
        continue;
      }

      const dept = departments.find(function (d) {
        return d.name.toLowerCase() === deptStr.toLowerCase()
            || d.code.toLowerCase() === deptStr.toLowerCase()
            || (d.threeLetterCode || '').toLowerCase() === deptStr.toLowerCase();
      });

      if (dept) {
        await M.Teacher.updateOne(
          { _id: t._id },
          { $set: { deptId: dept._id, deptCode: dept.code } }
        );
        matched++;
      } else {
        unmatched++;
      }
    }

    console.log('Backfill complete: ' + matched + ' matched, ' + unmatched + ' unmatched');

    await logAction(
      'MIGRATION', 'SYSTEM', 'system',
      'Backfill Teacher DeptId',
      'Matched ' + matched + ' teachers, ' + unmatched + ' unmatched',
      'settings', 'info', '127.0.0.1'
    );

    await mongoose.disconnect();
    console.log('Done');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

backfillTeacherDeptId();
