const mongoose = require('mongoose');
const M = require('../models');

/**
 * Computes live attendance statistics for a single student across all class attendance records,
 * persists the overall percentage and subject counts to StudentAttendance,
 * and updates the Student document's attendancePercentage field for fast institutional reporting.
 * 
 * Resolves Finding A13.
 * 
 * @param {string} studentTrackId - Student trackId or ObjectId
 * @param {string} [targetClassId] - Optional explicit classId
 * @returns {Promise<{ overallPercentage: number, totalHeld: number, totalAttended: number, subjects: Array } | null>}
 */
async function computeStudentAttendance(studentTrackId, targetClassId) {
  try {
    if (!studentTrackId) return null;

    const studentQuery = [{ trackId: studentTrackId }];
    if (mongoose.isValidObjectId(studentTrackId)) {
      studentQuery.unshift({ _id: studentTrackId });
    }

    const student = await M.Student.findOne({ $or: studentQuery }).select('-password').lean();
    if (!student) return null;

    const studentEffectiveTrackId = student.trackId || String(student._id);
    const studentIdentifiers = [
      studentEffectiveTrackId,
      student.registerNo,
      String(student._id)
    ].filter(Boolean);

    // Resolve class query
    const classId = targetClassId || student.classId || student.class;
    const uniqueClassIds = [];
    if (classId) uniqueClassIds.push(String(classId));
    if (student.classId) uniqueClassIds.push(String(student.classId));
    if (student.class) uniqueClassIds.push(String(student.class));

    if (classId) {
      const cls = await M.Class.findOne({
        $or: [
          ...(mongoose.isValidObjectId(classId) ? [{ _id: classId }] : []),
          { classTrackId: classId },
          { trackId: classId },
          { name: classId }
        ]
      }).lean();
      if (cls) {
        uniqueClassIds.push(String(cls._id));
        if (cls.classTrackId) uniqueClassIds.push(cls.classTrackId);
      }
    }

    const classAttQuery = [
      { 'periods.records.studentTrackId': { $in: studentIdentifiers } }
    ];
    if (uniqueClassIds.length > 0) {
      classAttQuery.push({ classId: { $in: [...new Set(uniqueClassIds)] } });
    }

    const classAttDocs = await M.ClassAttendance.find({ $or: classAttQuery }).lean();

    let totalHeld = 0;
    let totalAttended = 0;
    const subjectStats = {};

    for (const doc of classAttDocs) {
      for (const period of doc.periods || []) {
        const stuRec = (period.records || []).find(r =>
          studentIdentifiers.includes(r.studentTrackId) ||
          studentIdentifiers.includes(String(r.studentId))
        );

        if (stuRec) {
          const sid = period.subjectTrackId || 'DEFAULT';
          if (!subjectStats[sid]) {
            subjectStats[sid] = {
              subjectTrackId: sid,
              sem: doc.sem || 1,
              classesHeld: 0,
              classesAttended: 0
            };
          }

          subjectStats[sid].classesHeld += 1;
          totalHeld += 1;

          if (stuRec.status === 'P' || stuRec.status === 'PRESENT') {
            subjectStats[sid].classesAttended += 1;
            totalAttended += 1;
          }
        }
      }
    }

    // Default to 100% if no classes have been held yet
    const overallPercentage = totalHeld > 0
      ? Math.round((totalAttended / totalHeld) * 100)
      : 100;

    const records = Object.values(subjectStats).map(st => ({
      ...st,
      updatedAt: new Date()
    }));

    // Update StudentAttendance document
    await M.StudentAttendance.findOneAndUpdate(
      { studentTrackId: studentEffectiveTrackId },
      {
        $set: {
          batch: student.batch || '2025-2029',
          departmentCode: student.deptCode || student.department || 'GEN',
          classId: String(classId || ''),
          overallPercentage,
          records
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    // Update Student document directly for fast defaulters query
    await M.Student.updateOne(
      { _id: student._id },
      { $set: { attendancePercentage: overallPercentage } }
    );

    return {
      overallPercentage,
      totalHeld,
      totalAttended,
      subjects: records
    };
  } catch (err) {
    console.error('[computeStudentAttendance Error]:', err);
    return null;
  }
}

/**
 * Bulk recalculate and update attendance percentage for all students in a class.
 * 
 * @param {string} classIdInput - Class ID, trackId, or Class name
 * @returns {Promise<number>} - Count of students updated
 */
async function recalculateClassAttendancePercentages(classIdInput) {
  try {
    const classQueries = [{ classTrackId: classIdInput }, { name: classIdInput }];
    if (mongoose.isValidObjectId(classIdInput)) {
      classQueries.unshift({ _id: new mongoose.Types.ObjectId(classIdInput) });
    }
    const cls = await M.Class.findOne({ $or: classQueries }).lean();

    const studentFilter = {
      $or: [
        { classId: classIdInput },
        { class: classIdInput },
        ...(cls ? [{ classId: cls._id }, { classId: String(cls._id) }] : [])
      ]
    };

    const students = await M.Student.find(studentFilter).select('_id trackId').lean();
    for (const stu of students) {
      await computeStudentAttendance(stu.trackId || String(stu._id), classIdInput);
    }

    return students.length;
  } catch (err) {
    console.error('[recalculateClassAttendancePercentages Error]:', err);
    return 0;
  }
}

module.exports = {
  computeStudentAttendance,
  recalculateClassAttendancePercentages
};
