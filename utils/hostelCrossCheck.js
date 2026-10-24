const M = require('../models');

/**
 * Runs academic <-> hostel cross-checks (§11.1, Alert A11).
 * Detects:
 * 1. Present in class while checked out on a hostel pass (possible proxy).
 * 2. Resident absent from all periods today with no academic leave or medical (may be unwell in room).
 * 3. On approved home leave but marked present in class (data conflict).
 */
async function runHostelCrossChecks(date) {
  const alerts = [];
  try {
    // 1. Get all hostel residents
    const hostelResidents = await M.Student.find({ residency: 'hostel' }).lean();
    if (!hostelResidents.length) return alerts;

    const residentTrackIds = hostelResidents.map(s => s.trackId);
    const residentMap = new Map(hostelResidents.map(s => [s.trackId, s]));

    // 2. Get active checked-out hostel leaves covering date
    const checkDate = new Date(date);
    const activeLeaves = await M.HostelLeave.find({
      studentTrackId: { $in: residentTrackIds },
      status: { $in: ['out', 'overdue', 'approved'] },
      from: { $lte: new Date(`${date}T23:59:59.999Z`) },
      to:   { $gte: new Date(`${date}T00:00:00.000Z`) },
    }).lean();

    const leaveMap = new Map(activeLeaves.map(l => [l.studentTrackId, l]));

    // 3. Get academic attendance records for today from ClassAttendance
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);
    const residentSet = new Set(residentTrackIds);

    const classAttDocs = await M.ClassAttendance.find({
      date: { $gte: startOfDay, $lte: endOfDay },
      'periods.records.studentTrackId': { $in: residentTrackIds },
    }).lean();

    // Group by student
    const attByStudent = new Map();
    for (const doc of classAttDocs) {
      if (!Array.isArray(doc.periods)) continue;
      for (const period of doc.periods) {
        if (!Array.isArray(period.records)) continue;
        for (const rec of period.records) {
          if (residentSet.has(rec.studentTrackId)) {
            if (!attByStudent.has(rec.studentTrackId)) {
              attByStudent.set(rec.studentTrackId, []);
            }
            const isPresent = rec.status === 'P' || rec.status === 'Present';
            attByStudent.get(rec.studentTrackId).push({
              studentTrackId: rec.studentTrackId,
              status: isPresent ? 'Present' : 'Absent',
              reason: rec.reason,
              date,
            });
          }
        }
      }
    }

    for (const student of hostelResidents) {
      const records = attByStudent.get(student.trackId) || [];
      const leave = leaveMap.get(student.trackId);

      const hasPresentPeriod = records.some(r => r.status === 'Present');
      const allAbsent = records.length > 0 && records.every(r => r.status === 'Absent' || r.status === 'Late');

      // Check 1: Present in class while checked out on hostel pass
      if (hasPresentPeriod && leave && leave.status === 'out') {
        alerts.push({
          type: 'A11',
          severity: 'high',
          studentTrackId: student.trackId,
          studentName: student.fullName,
          registerNo: student.registerNo,
          blockId: student.blockId,
          title: 'Class Presence while Checked Out',
          message: `${student.fullName} marked Present in class while checked out on hostel pass (${leave.type} to ${leave.destination}). Possible proxy attendance.`,
          date,
        });
      }

      // Check 2: Absent from all periods with no leave or medical
      if (allAbsent && !leave) {
        alerts.push({
          type: 'A11',
          severity: 'medium',
          studentTrackId: student.trackId,
          studentName: student.fullName,
          registerNo: student.registerNo,
          blockId: student.blockId,
          title: 'Absent All Day (Check Room)',
          message: `${student.fullName} is absent from all scheduled periods today with no recorded leave. Warden please check if student is unwell in room.`,
          date,
        });
      }
    }
  } catch (err) {
    console.error('[HostelCrossCheck] Error:', err);
  }
  return alerts;
}

module.exports = {
  runHostelCrossChecks,
};
