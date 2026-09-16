const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { controllerAuth } = require('../middleware/hodAuth');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');

// Apply base authentication and controller role gate to all routes
router.use(authMiddleware);
router.use(controllerAuth);

// Helper to get Department query filter based on controller scope
function getDeptFilter(req, requestedDeptId) {
  if (req.controllerContext.role === 'hod') {
    return req.controllerContext.deptId ? { $in: [req.controllerContext.deptId, String(req.controllerContext.deptId)] } : null;
  }
  if (requestedDeptId && mongoose.isValidObjectId(requestedDeptId)) {
    return requestedDeptId;
  }
  return null;
}

// 1. GET /api/controller/init — Bootstrap context, profile and badge counts
router.get('/init', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';

    // Build leave filter
    const studentLeaveFilter = { status: 'Pending' };
    const teacherLeaveFilter = { status: 'Pending' };

    if (isHod && ctx.deptId) {
      studentLeaveFilter.deptId = ctx.deptId;
      teacherLeaveFilter.deptId = ctx.deptId;
      studentLeaveFilter.$or = [{ hodStatus: 'Pending' }, { advisorStatus: 'Approved', hodStatus: { $in: ['Pending', 'N/A'] } }];
      teacherLeaveFilter.hodStatus = 'Pending';
    } else if (ctx.role === 'principal') {
      studentLeaveFilter.escalationLevel = 'principal';
      teacherLeaveFilter.$or = [{ escalationLevel: 'principal', principalStatus: 'Pending' }, { isEmergency: false, hodStatus: 'Approved', principalStatus: 'Pending' }];
    }

    const [pendingStudentLeaves, pendingTeacherLeaves, allDepts] = await Promise.all([
      M.LeaveRequest.countDocuments(studentLeaveFilter),
      M.TeacherLeaveRequest.countDocuments(teacherLeaveFilter),
      M.Department.find({}).select('name code trackId threeLetterCode number hodName').lean()
    ]);

    res.json({
      context: ctx,
      badges: {
        pendingStudentLeaves,
        pendingTeacherLeaves,
        totalPendingLeaves: pendingStudentLeaves + pendingTeacherLeaves
      },
      departments: allDepts
    });
  } catch (err) {
    console.error('[Controller Init Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/controller/dashboard — Aggregated dashboard statistics & trends
router.get('/dashboard', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);

    // Queries scoped
    const studentFilter = deptId ? { deptId } : {};
    const facultyFilter = deptId ? { deptId } : {};
    const classFilter = deptId ? { deptId } : {};

    const [totalStudents, totalFaculty, totalClasses, activeClasses] = await Promise.all([
      M.Student.countDocuments(studentFilter),
      M.Teacher.countDocuments(facultyFilter),
      M.Class.countDocuments(classFilter),
      M.Class.find(classFilter).select('_id trackId name deptId deptName deptCode section year batch').lean()
    ]);

    const classIds = activeClasses.map(c => c.trackId || String(c._id));

    // Today's Attendance calculation
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAttFilter = {
      date: { $gte: today, $lt: tomorrow }
    };
    if (classIds.length > 0) {
      todayAttFilter.classId = { $in: classIds };
    }

    const todayAttendanceDocs = await M.ClassAttendance.find(todayAttFilter).lean();

    let totalPresentRecords = 0;
    let totalAbsentRecords = 0;
    const classAttendanceMap = {};

    todayAttendanceDocs.forEach(doc => {
      (doc.periods || []).forEach(period => {
        (period.records || []).forEach(rec => {
          if (rec.status === 'P') totalPresentRecords++;
          else if (rec.status === 'AB') totalAbsentRecords++;
        });
      });
      classAttendanceMap[doc.classId] = (classAttendanceMap[doc.classId] || 0) + 1;
    });

    const totalMarked = totalPresentRecords + totalAbsentRecords;
    const todayPct = totalMarked > 0 ? Math.round((totalPresentRecords / totalMarked) * 100) : 0;

    // 7-day attendance trend
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const trendDocs = await M.ClassAttendance.find({
      date: { $gte: sevenDaysAgo, $lt: tomorrow },
      ...(classIds.length > 0 ? { classId: { $in: classIds } } : {})
    }).lean();

    const dayWiseTrend = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().split('T')[0];
      dayWiseTrend[iso] = { present: 0, absent: 0, total: 0 };
    }

    trendDocs.forEach(doc => {
      const dateStr = doc.date ? new Date(doc.date).toISOString().split('T')[0] : '';
      if (dayWiseTrend[dateStr]) {
        (doc.periods || []).forEach(p => {
          (p.records || []).forEach(r => {
            if (r.status === 'P') dayWiseTrend[dateStr].present++;
            else if (r.status === 'AB') dayWiseTrend[dateStr].absent++;
            dayWiseTrend[dateStr].total++;
          });
        });
      }
    });

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const trendChart = Object.keys(dayWiseTrend).map(iso => {
      const item = dayWiseTrend[iso];
      const d = new Date(iso);
      const pct = item.total > 0 ? Math.round((item.present / item.total) * 100) : 0;
      return {
        date: iso,
        day: dayNames[d.getDay()],
        present: item.present,
        absent: item.absent,
        total: item.total,
        pct: pct
      };
    });

    // Principal-specific metrics
    let deptComparison = [];
    let hodMatrix = [];
    let onlineUsersCount = 0;

    if (ctx.role === 'principal') {
      const allDepts = await M.Department.find({}).lean();
      const onlineCount = await M.User.countDocuments({ online: true });
      onlineUsersCount = onlineCount;

      deptComparison = await Promise.all(allDepts.map(async dept => {
        const dClasses = await M.Class.find({ deptId: dept._id }).select('trackId').lean();
        const dClassIds = dClasses.map(c => c.trackId || String(c._id));
        const dAttDocs = await M.ClassAttendance.find({
          date: { $gte: today, $lt: tomorrow },
          classId: { $in: dClassIds }
        }).lean();

        let dP = 0, dA = 0;
        dAttDocs.forEach(doc => {
          (doc.periods || []).forEach(p => {
            (p.records || []).forEach(r => {
              if (r.status === 'P') dP++;
              else if (r.status === 'AB') dA++;
            });
          });
        });
        const dTot = dP + dA;
        const dPct = dTot > 0 ? Math.round((dP / dTot) * 100) : 0;
        const stuCount = await M.Student.countDocuments({ deptId: dept._id });
        const facCount = await M.Teacher.countDocuments({ deptId: dept._id });

        return {
          deptId: dept._id,
          name: dept.name,
          code: dept.code || dept.threeLetterCode,
          hodName: dept.hodName || '—',
          studentCount: stuCount,
          facultyCount: facCount,
          todayPresent: dP,
          todayAbsent: dA,
          todayPct: dPct
        };
      }));

      hodMatrix = allDepts.map(dept => ({
        deptId: dept._id,
        deptName: dept.name,
        deptCode: dept.code || dept.threeLetterCode,
        hodName: dept.hodName || 'Not Assigned',
        courseType: dept.courseType || 'UG',
        branch: dept.branch || 'B.E'
      }));
    }

    res.json({
      metrics: {
        totalStudents,
        totalFaculty,
        totalClasses,
        todayAttendance: {
          present: totalPresentRecords,
          absent: totalAbsentRecords,
          total: totalMarked,
          pct: todayPct
        },
        onlineUsers: onlineUsersCount
      },
      trendChart,
      deptComparison,
      hodMatrix,
      activeClassesSummary: {
        total: activeClasses.length,
        markedToday: Object.keys(classAttendanceMap).length
      }
    });
  } catch (err) {
    console.error('[Controller Dashboard Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. GET /api/controller/attendance/daily — Detailed attendance by date & class
router.get('/attendance/daily', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const dateStr = sanitizeToString(req.query.date) || new Date().toISOString().split('T')[0];
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);
    const classId = sanitizeToString(req.query.classId) || null;

    const startDate = new Date(dateStr + 'T00:00:00.000Z');
    const endDate = new Date(dateStr + 'T23:59:59.999Z');

    const classQuery = deptId ? { deptId } : {};
    if (classId) classQuery._id = classId;

    const classes = await M.Class.find(classQuery).sort({ name: 1 }).lean();
    const classLookup = {};
    classes.forEach(c => {
      const key = c.trackId || String(c._id);
      classLookup[key] = c;
    });

    const targetClassIds = Object.keys(classLookup);

    const attDocs = await M.ClassAttendance.find({
      date: { $gte: startDate, $lte: endDate },
      ...(targetClassIds.length ? { classId: { $in: targetClassIds } } : {})
    }).lean();

    const attendanceByClass = {};
    classes.forEach(c => {
      const idStr = c.trackId || String(c._id);
      attendanceByClass[idStr] = {
        classId: c._id,
        classTrackId: c.trackId,
        className: c.name,
        deptName: c.deptName,
        deptCode: c.deptCode,
        section: c.section,
        year: c.year,
        sem: c.sem,
        hallNo: c.hallNo || '—',
        advisorName: c.advisorTeacherName || '—',
        periods: [],
        totalPresent: 0,
        totalAbsent: 0,
        pct: 0,
        markedPeriodsCount: 0,
        isFullyMarked: false
      };
    });

    attDocs.forEach(doc => {
      const cls = attendanceByClass[doc.classId];
      if (!cls) return;

      (doc.periods || []).forEach(p => {
        let pPresent = 0;
        let pAbsent = 0;
        (p.records || []).forEach(r => {
          if (r.status === 'P') pPresent++;
          else if (r.status === 'AB') pAbsent++;
        });
        const pTotal = pPresent + pAbsent;
        const pPct = pTotal > 0 ? Math.round((pPresent / pTotal) * 100) : 0;

        cls.periods.push({
          periodNumbers: p.periodNumbers || [],
          subjectTrackId: p.subjectTrackId,
          markedBy: p.markedBy,
          markedAt: p.markedAt,
          topic: p.topic || '',
          notes: p.notes || '',
          present: pPresent,
          absent: pAbsent,
          total: pTotal,
          pct: pPct
        });

        cls.totalPresent += pPresent;
        cls.totalAbsent += pAbsent;
      });

      cls.markedPeriodsCount = cls.periods.length;
      const totalAll = cls.totalPresent + cls.totalAbsent;
      cls.pct = totalAll > 0 ? Math.round((cls.totalPresent / totalAll) * 100) : 0;
      cls.isFullyMarked = cls.markedPeriodsCount >= 7; // Typical 7-period day
    });

    res.json({
      date: dateStr,
      classes: Object.values(attendanceByClass),
      summary: {
        totalClasses: classes.length,
        markedClasses: attDocs.length,
        totalPresent: Object.values(attendanceByClass).reduce((s, c) => s + c.totalPresent, 0),
        totalAbsent: Object.values(attendanceByClass).reduce((s, c) => s + c.totalAbsent, 0)
      }
    });
  } catch (err) {
    console.error('[Controller Daily Attendance Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. GET /api/controller/leaves/student — Student leave requests
router.get('/leaves/student', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const status = sanitizeToString(req.query.status) || 'all';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);

    const filter = {};
    if (deptId) filter.deptId = deptId;

    if (status === 'pending') {
      filter.status = 'Pending';
      if (isHod) {
        filter.$or = [{ hodStatus: 'Pending' }, { advisorStatus: 'Approved', hodStatus: { $in: ['Pending', 'N/A'] } }];
      }
    } else if (status === 'approved') {
      filter.status = 'Approved';
    } else if (status === 'rejected') {
      filter.status = 'Rejected';
    }

    const leaves = await M.LeaveRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json(leaves);
  } catch (err) {
    console.error('[Controller Student Leaves Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. GET /api/controller/leaves/teacher — Faculty leave requests
router.get('/leaves/teacher', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const status = sanitizeToString(req.query.status) || 'all';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);

    const filter = {};
    if (deptId) filter.deptId = deptId;

    if (status === 'pending') {
      if (isHod) {
        filter.hodStatus = 'Pending';
      } else {
        filter.$or = [
          { escalationLevel: 'principal', principalStatus: 'Pending' },
          { isEmergency: false, hodStatus: 'Approved', principalStatus: 'Pending' }
        ];
      }
    } else if (status === 'approved') {
      filter.status = 'Approved';
    } else if (status === 'rejected') {
      filter.status = 'Rejected';
    }

    const teacherLeaves = await M.TeacherLeaveRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json(teacherLeaves);
  } catch (err) {
    console.error('[Controller Teacher Leaves Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /api/controller/leaves/approve — Single or Bulk Leave Approval
router.post('/leaves/approve', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const { ids, type, remarks } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Please provide array of leave IDs to approve' });
    }
    const leaveType = type === 'teacher' ? 'teacher' : 'student';

    let updatedCount = 0;

    if (leaveType === 'student') {
      for (const id of ids) {
        const leave = await M.LeaveRequest.findById(id);
        if (!leave) continue;

        // Security check for HOD
        if (ctx.role === 'hod' && String(leave.deptId) !== String(ctx.deptId)) {
          continue;
        }

        leave.hodStatus = 'Approved';
        leave.hodReviewedBy = ctx.name;
        leave.hodReviewedAt = new Date();
        leave.hodRemarks = remarks || 'Approved by HOD';
        leave.status = 'Approved';
        leave.reviewedBy = ctx.name;
        leave.reviewedAt = new Date();
        leave.reviewRemarks = remarks || 'Approved';

        await leave.save();
        updatedCount++;

        // Notify Student
        await M.Notification.create({
          type: 'leave-approval',
          from: ctx.name,
          fromRole: ctx.role,
          message: `Your ${leave.category} request from ${leave.fromDate} to ${leave.toDate} has been APPROVED by ${ctx.name} (${ctx.role.toUpperCase()}).`,
          priority: 'Normal',
          toStudentId: leave.studentId,
          toStudentTrackId: leave.studentTrackId,
          toStudentName: leave.studentName,
          leaveRequestId: leave._id,
          time: new Date()
        }).catch(() => {});
      }
    } else {
      // Teacher Leaves
      for (const id of ids) {
        const tLeave = await M.TeacherLeaveRequest.findById(id);
        if (!tLeave) continue;

        if (ctx.role === 'hod') {
          if (String(tLeave.deptId) !== String(ctx.deptId)) continue;

          if (tLeave.isEmergency) {
            // Emergency: Direct Final Approval by HOD
            tLeave.hodStatus = 'Approved';
            tLeave.hodReviewedBy = ctx.name;
            tLeave.hodReviewedAt = new Date();
            tLeave.hodRemarks = remarks || 'Emergency Approved by HOD';
            tLeave.status = 'Approved';
          } else {
            // Regular: Endorsed and forwarded to Principal
            tLeave.hodStatus = 'Approved';
            tLeave.hodReviewedBy = ctx.name;
            tLeave.hodReviewedAt = new Date();
            tLeave.hodRemarks = remarks || 'Endorsed by HOD, forwarded to Principal';
            tLeave.escalationLevel = 'principal';
            tLeave.principalStatus = 'Pending';
          }
          await tLeave.save();
          updatedCount++;
        } else if (ctx.role === 'principal') {
          // Principal Final Approval
          tLeave.principalStatus = 'Approved';
          tLeave.principalReviewedBy = ctx.name;
          tLeave.principalReviewedAt = new Date();
          tLeave.principalRemarks = remarks || 'Approved by Principal';
          tLeave.status = 'Approved';
          await tLeave.save();
          updatedCount++;
        }

        if (tLeave.status === 'Approved' && Array.isArray(tLeave.substitutions) && tLeave.substitutions.length > 0) {
          for (const sub of tLeave.substitutions) {
            if (!sub.classId || !sub.date || !sub.periodNumber) continue;
            try {
              let dayOverride = await M.TimetableDayOverride.findOne({
                classId: sub.classId,
                date: sub.date
              });
              const dObj = new Date(sub.date + 'T00:00:00.000Z');
              const dayAbbr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dObj.getUTCDay()];

              if (!dayOverride) {
                dayOverride = new M.TimetableDayOverride({
                  classId: sub.classId,
                  className: sub.className,
                  deptId: tLeave.deptId,
                  date: sub.date,
                  day: dayAbbr,
                  overrides: [],
                  status: 'active',
                  updatedBy: ctx.name
                });
              }

              const existingOvIdx = dayOverride.overrides.findIndex(ov => ov.periodNumber === sub.periodNumber);
              const overrideEntry = {
                periodNumber: sub.periodNumber,
                span: 1,
                action: 'substitute',
                substituteTeacherId: sub.substituteTeacherTrackId,
                substituteTeacherName: sub.substituteTeacherName,
                originalSlot: {
                  teacherName: tLeave.teacherName,
                  teacherTrackId: tLeave.teacherTrackId,
                  subjectName: sub.subjectName,
                  hallNo: sub.hallNo
                },
                newSlot: {
                  teacherName: sub.substituteTeacherName,
                  teacherTrackId: sub.substituteTeacherTrackId,
                  subjectName: sub.subjectName,
                  hallNo: sub.hallNo
                },
                reason: `Leave substitution for ${tLeave.teacherName}`
              };

              if (existingOvIdx >= 0) {
                dayOverride.overrides[existingOvIdx] = overrideEntry;
              } else {
                dayOverride.overrides.push(overrideEntry);
              }
              await dayOverride.save();

              // Notify the substitute teacher
              await M.Notification.create({
                type: 'leave-approval',
                from: ctx.name,
                fromRole: ctx.role,
                message: `You have been assigned as SUBSTITUTE for ${tLeave.teacherName} in ${sub.className} (Period ${sub.periodNumber}) on ${sub.date}.`,
                priority: 'High',
                toTeacherTrackId: sub.substituteTeacherTrackId,
                toTeacherName: sub.substituteTeacherName,
                time: new Date()
              }).catch(() => {});
            } catch (ovErr) {
              console.error('[Substitution DayOverride Error]:', ovErr);
            }
          }
        }

        // Notify Teacher
        await M.Notification.create({
          type: 'leave-approval',
          from: ctx.name,
          fromRole: ctx.role,
          message: `Your leave request from ${tLeave.fromDate} to ${tLeave.toDate} has been ${tLeave.status === 'Approved' ? 'APPROVED' : 'forwarded to Principal for approval'}.`,
          priority: 'Normal',
          toTeacherId: tLeave.teacherId,
          toTeacherTrackId: tLeave.teacherTrackId,
          toTeacherName: tLeave.teacherName,
          time: new Date()
        }).catch(() => {});
      }
    }

    await logAction(
      ctx.trackId,
      ctx.name,
      ctx.role === 'principal' ? 'admin' : 'teacher',
      'Leave Bulk Approved',
      `Approved ${updatedCount} ${leaveType} leave request(s)`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'controller', subType: 'leave-approve', role: ctx.role }
    );

    res.json({ success: true, count: updatedCount });
  } catch (err) {
    console.error('[Controller Leave Approve Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. POST /api/controller/leaves/reject — Single or Bulk Leave Rejection
router.post('/leaves/reject', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const { ids, type, remarks } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Please provide array of leave IDs to reject' });
    }
    const leaveType = type === 'teacher' ? 'teacher' : 'student';
    let updatedCount = 0;

    if (leaveType === 'student') {
      for (const id of ids) {
        const leave = await M.LeaveRequest.findById(id);
        if (!leave) continue;
        if (ctx.role === 'hod' && String(leave.deptId) !== String(ctx.deptId)) continue;

        leave.hodStatus = 'Rejected';
        leave.hodReviewedBy = ctx.name;
        leave.hodReviewedAt = new Date();
        leave.hodRemarks = remarks || 'Rejected by HOD';
        leave.status = 'Rejected';
        leave.reviewedBy = ctx.name;
        leave.reviewedAt = new Date();
        leave.reviewRemarks = remarks || 'Rejected';

        await leave.save();
        updatedCount++;

        // Notify Student
        await M.Notification.create({
          type: 'leave-rejection',
          from: ctx.name,
          fromRole: ctx.role,
          message: `Your ${leave.category} request from ${leave.fromDate} to ${leave.toDate} was REJECTED by ${ctx.name}. Remarks: ${remarks || 'None'}`,
          priority: 'Urgent',
          toStudentId: leave.studentId,
          toStudentTrackId: leave.studentTrackId,
          toStudentName: leave.studentName,
          leaveRequestId: leave._id,
          time: new Date()
        }).catch(() => {});
      }
    } else {
      for (const id of ids) {
        const tLeave = await M.TeacherLeaveRequest.findById(id);
        if (!tLeave) continue;
        if (ctx.role === 'hod' && String(tLeave.deptId) !== String(ctx.deptId)) continue;

        if (ctx.role === 'hod') {
          tLeave.hodStatus = 'Rejected';
          tLeave.hodReviewedBy = ctx.name;
          tLeave.hodReviewedAt = new Date();
          tLeave.hodRemarks = remarks || 'Rejected by HOD';
        } else {
          tLeave.principalStatus = 'Rejected';
          tLeave.principalReviewedBy = ctx.name;
          tLeave.principalReviewedAt = new Date();
          tLeave.principalRemarks = remarks || 'Rejected by Principal';
        }
        tLeave.status = 'Rejected';
        await tLeave.save();
        updatedCount++;

        // Notify Teacher
        await M.Notification.create({
          type: 'leave-rejection',
          from: ctx.name,
          fromRole: ctx.role,
          message: `Your leave request from ${tLeave.fromDate} to ${tLeave.toDate} was REJECTED. Reason: ${remarks || 'None'}`,
          priority: 'Urgent',
          toTeacherId: tLeave.teacherId,
          toTeacherTrackId: tLeave.teacherTrackId,
          toTeacherName: tLeave.teacherName,
          time: new Date()
        }).catch(() => {});
      }
    }

    res.json({ success: true, count: updatedCount });
  } catch (err) {
    console.error('[Controller Leave Reject Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. GET /api/controller/faculty — Faculty directory with today's marking status
router.get('/faculty', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);
    const search = sanitizeToString(req.query.search) || '';

    const filter = {};
    if (deptId) filter.deptId = deptId;
    if (search) {
      filter.$or = [
        { fullName: new RegExp(search, 'i') },
        { employeeNo: new RegExp(search, 'i') },
        { designation: new RegExp(search, 'i') },
        { username: new RegExp(search, 'i') }
      ];
    }

    const teachers = await M.Teacher.find(filter)
      .select('-password -passwordHistory')
      .sort({ fullName: 1 })
      .lean();

    // Check today's attendance marking completion for each teacher
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAtt = await M.ClassAttendance.find({
      date: { $gte: today, $lt: tomorrow }
    }).lean();

    const teacherMarkedPeriods = {};
    todayAtt.forEach(doc => {
      (doc.periods || []).forEach(p => {
        if (p.teacherTrackId) {
          teacherMarkedPeriods[p.teacherTrackId] = (teacherMarkedPeriods[p.teacherTrackId] || 0) + 1;
        }
      });
    });

    const enriched = teachers.map(t => ({
      _id: t._id,
      trackId: t.trackId,
      fullName: t.fullName,
      employeeNo: t.employeeNo || '—',
      department: t.department || '—',
      deptCode: t.deptCode || '—',
      designation: t.designation || 'Faculty',
      email: t.email || '—',
      isHod: (t.specials || []).some(s => s.option === 'isHod'),
      isClassAdvisor: (t.specials || []).some(s => s.option === 'isClassAdvisor'),
      isTimeTableCoordinator: (t.specials || []).some(s => s.option === 'isTimeTableCoordinator'),
      todayPeriodsMarked: teacherMarkedPeriods[t.trackId] || 0,
      todayMarkingStatus: (teacherMarkedPeriods[t.trackId] || 0) > 0 ? 'Marked' : 'Pending'
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[Controller Faculty Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 9. GET /api/controller/students — Student directory with cumulative attendance %
router.get('/students', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);
    const classId = sanitizeToString(req.query.classId) || null;
    const search = sanitizeToString(req.query.search) || '';

    const filter = {};
    if (deptId) filter.deptId = deptId;
    if (classId) filter.classId = classId;
    if (search) {
      filter.$or = [
        { fullName: new RegExp(search, 'i') },
        { registerNo: new RegExp(search, 'i') },
        { username: new RegExp(search, 'i') }
      ];
    }

    const students = await M.Student.find(filter)
      .select('-password -passwordHistory')
      .sort({ registerNo: 1 })
      .limit(500)
      .lean();

    const trackIds = students.map(s => s.trackId).filter(Boolean);
    const attRecords = await M.StudentAttendance.find({
      studentTrackId: { $in: trackIds }
    }).lean();

    const attMap = {};
    attRecords.forEach(rec => {
      const totalHeld = (rec.records || []).reduce((s, r) => s + (r.classesHeld || 0), 0);
      const totalAtt = (rec.records || []).reduce((s, r) => s + (r.classesAttended || 0), 0);
      const pct = totalHeld > 0 ? Math.round((totalAtt / totalHeld) * 100) : 0;
      attMap[rec.studentTrackId] = { totalHeld, totalAtt, pct };
    });

    const enriched = students.map(s => {
      const att = attMap[s.trackId] || { totalHeld: 0, totalAtt: 0, pct: 100 };
      return {
        _id: s._id,
        trackId: s.trackId,
        fullName: s.fullName,
        registerNo: s.registerNo || '—',
        class: s.class || '—',
        section: s.section || '—',
        department: s.department || '—',
        admissionYear: s.admissionYear || '—',
        batchTrackId: s.batchTrackId || '—',
        classesHeld: att.totalHeld,
        classesAttended: att.totalAtt,
        attendancePct: att.pct
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('[Controller Students Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 10. GET /api/controller/records — Period-wise teaching notes and topics covered
router.get('/records', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const dateStr = sanitizeToString(req.query.date) || new Date().toISOString().split('T')[0];
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);
    const classId = sanitizeToString(req.query.classId) || null;

    const startDate = new Date(dateStr + 'T00:00:00.000Z');
    const endDate = new Date(dateStr + 'T23:59:59.999Z');

    const classQuery = deptId ? { deptId } : {};
    if (classId) classQuery._id = classId;

    const classDocs = await M.Class.find(classQuery).lean();
    const classMap = {};
    classDocs.forEach(c => {
      classMap[c.trackId || String(c._id)] = c;
    });

    const targetClassIds = Object.keys(classMap);
    if (!targetClassIds.length) {
      return res.json([]);
    }

    const attDocs = await M.ClassAttendance.find({
      date: { $gte: startDate, $lte: endDate },
      classId: { $in: targetClassIds }
    }).sort({ 'periods.markedAt': -1 }).lean();

    const periodRecords = [];

    attDocs.forEach(doc => {
      const cls = classMap[doc.classId];
      const className = cls ? cls.name : doc.classId;
      const deptName = cls ? cls.deptName : doc.departmentCode;

      (doc.periods || []).forEach(p => {
        let pPresent = 0;
        let pAbsent = 0;
        (p.records || []).forEach(r => {
          if (r.status === 'P') pPresent++;
          else if (r.status === 'AB') pAbsent++;
        });

        periodRecords.push({
          date: dateStr,
          className: className,
          deptName: deptName,
          section: cls?.section || '—',
          periodNumbers: p.periodNumbers || [],
          subjectTrackId: p.subjectTrackId || '—',
          markedBy: p.markedBy || '—',
          markedAt: p.markedAt,
          topic: p.topic || '—',
          notes: p.notes || '—',
          presentCount: pPresent,
          absentCount: pAbsent,
          totalCount: pPresent + pAbsent
        });
      });
    });

    res.json(periodRecords);
  } catch (err) {
    console.error('[Controller Records Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 11. GET /api/controller/defaulters — Defaulters list below policy threshold
router.get('/defaulters', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);
    const classId = sanitizeToString(req.query.classId) || null;

    // Get policy threshold
    const settingsDoc = await M.Settings.findOne({ key: 'attendancePolicy' }).lean();
    const minThreshold = Number(settingsDoc?.value?.minAttendancePct) || 75;

    const studentQuery = {};
    if (deptId) studentQuery.deptId = deptId;
    if (classId) studentQuery.classId = classId;

    const students = await M.Student.find(studentQuery)
      .select('trackId fullName registerNo classId deptId department deptName class section')
      .lean();

    const trackIds = students.map(s => s.trackId).filter(Boolean);
    const studentAttRecords = await M.StudentAttendance.find({
      studentTrackId: { $in: trackIds }
    }).lean();

    const attMap = {};
    studentAttRecords.forEach(rec => {
      const totalHeld = (rec.records || []).reduce((s, r) => s + (r.classesHeld || 0), 0);
      const totalAtt = (rec.records || []).reduce((s, r) => s + (r.classesAttended || 0), 0);
      const pct = totalHeld > 0 ? Math.round((totalAtt / totalHeld) * 100) : 0;
      attMap[rec.studentTrackId] = { totalHeld, totalAtt, pct };
    });

    const defaulters = [];

    students.forEach(s => {
      const att = attMap[s.trackId];
      if (!att || att.totalHeld === 0) return;

      if (att.pct < minThreshold) {
        defaulters.push({
          studentTrackId: s.trackId,
          name: s.fullName,
          regNo: s.registerNo,
          className: s.class || '—',
          classId: s.classId,
          section: s.section || '—',
          deptName: s.department || s.deptName || '—',
          classesHeld: att.totalHeld,
          classesAttended: att.totalAtt,
          pct: att.pct,
          threshold: minThreshold
        });
      }
    });

    defaulters.sort((a, b) => a.pct - b.pct);
    res.json({ threshold: minThreshold, count: defaulters.length, defaulters });
  } catch (err) {
    console.error('[Controller Defaulters Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 12. POST /api/controller/defaulters/meet — Bulk "Meet Me" Notice Action
router.post('/defaulters/meet', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const { studentTrackIds, message, customNote } = req.body;

    if (!Array.isArray(studentTrackIds) || studentTrackIds.length === 0) {
      return res.status(400).json({ error: 'No defaulter students selected' });
    }

    const students = await M.Student.find({ trackId: { $in: studentTrackIds } }).lean();
    const noticeText = message || `URGENT NOTICE: You are required to meet the ${ctx.role === 'principal' ? 'Principal' : 'HOD'} immediately regarding your low attendance. ${customNote ? 'Note: ' + customNote : ''}`;

    let sentCount = 0;
    const advisorTrackIds = new Set();

    for (const student of students) {
      // 1. Notify Student
      await M.Notification.create({
        type: 'attendance-alert',
        from: `${ctx.name} (${ctx.role.toUpperCase()})`,
        fromRole: ctx.role === 'principal' ? 'admin' : 'teacher',
        message: noticeText,
        priority: 'Urgent',
        toStudentId: student._id,
        toStudentTrackId: student.trackId,
        toStudentName: student.fullName,
        time: new Date()
      }).catch(() => {});

      sentCount++;

      // Find class advisor
      if (student.classId) {
        const cls = await M.Class.findById(student.classId).lean();
        if (cls?.advisorTeacherTrackId) {
          advisorTrackIds.add(cls.advisorTeacherTrackId);
        }
      }
    }

    // 2. Notify Class Advisors copy
    for (const advTrackId of advisorTrackIds) {
      const advTeacher = await M.Teacher.findOne({ trackId: advTrackId }).lean();
      if (!advTeacher) continue;

      await M.Notification.create({
        type: 'attendance-alert',
        from: `${ctx.name} (${ctx.role.toUpperCase()})`,
        fromRole: ctx.role === 'principal' ? 'admin' : 'teacher',
        message: `Copy: Attendance Meet Notice has been issued by ${ctx.role.toUpperCase()} to defaulters in your advised class.`,
        priority: 'Normal',
        toTeacherId: advTeacher._id,
        toTeacherTrackId: advTeacher.trackId,
        toTeacherName: advTeacher.fullName,
        time: new Date()
      }).catch(() => {});
    }

    // Record in BroadcastHistory
    await M.BroadcastHistory.create({
      message: noticeText,
      level: 'urgent',
      tag: ctx.role,
      targetRoles: ['student'],
      targetDeptId: ctx.role === 'hod' ? ctx.deptId : null,
      targetDeptCode: ctx.role === 'hod' ? ctx.deptCode : '',
      broadcastType: 'meet_defaulters',
      sentCount: sentCount,
      sentUserIds: studentTrackIds,
      dispatchedBy: {
        role: ctx.role === 'principal' ? 'admin' : 'teacher',
        username: req.user.username,
        name: ctx.name,
        trackId: ctx.trackId,
        ip: req.ip
      }
    });

    await logAction(
      ctx.trackId,
      ctx.name,
      ctx.role === 'principal' ? 'admin' : 'teacher',
      'Defaulters Meet Notice Sent',
      `Dispatched meet notice to ${sentCount} defaulter students`,
      'data',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'controller', subType: 'meet_defaulters' }
    );

    res.json({ success: true, sentCount, advisorsNotified: advisorTrackIds.size });
  } catch (err) {
    console.error('[Controller Meet Notice Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 13. GET /api/controller/reports/monthly — Aggregated monthly class attendance
router.get('/reports/monthly', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const monthStr = sanitizeToString(req.query.month) || new Date().toISOString().slice(0, 7); // YYYY-MM
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);

    const [year, month] = monthStr.split('-').map(Number);
    const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59));

    const classQuery = deptId ? { deptId } : {};
    const classes = await M.Class.find(classQuery).sort({ name: 1 }).lean();
    const classIds = classes.map(c => c.trackId || String(c._id));

    const attDocs = await M.ClassAttendance.find({
      date: { $gte: startDate, $lte: endDate },
      classId: { $in: classIds }
    }).lean();

    const monthlySummary = {};
    classes.forEach(c => {
      const key = c.trackId || String(c._id);
      monthlySummary[key] = {
        classId: c._id,
        className: c.name,
        deptName: c.deptName,
        section: c.section,
        year: c.year,
        sem: c.sem,
        daysConducted: 0,
        totalPresent: 0,
        totalAbsent: 0,
        pct: 0
      };
    });

    attDocs.forEach(doc => {
      const row = monthlySummary[doc.classId];
      if (!row) return;

      row.daysConducted++;
      (doc.periods || []).forEach(p => {
        (p.records || []).forEach(r => {
          if (r.status === 'P') row.totalPresent++;
          else if (r.status === 'AB') row.totalAbsent++;
        });
      });
    });

    Object.values(monthlySummary).forEach(row => {
      const tot = row.totalPresent + row.totalAbsent;
      row.pct = tot > 0 ? Math.round((row.totalPresent / tot) * 100) : 0;
    });

    res.json({
      month: monthStr,
      report: Object.values(monthlySummary)
    });
  } catch (err) {
    console.error('[Controller Monthly Report Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 14. GET /api/controller/reports/semester — Subject-wise semester summary
router.get('/reports/semester', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);
    const sem = Number(req.query.sem) || null;

    const query = {};
    if (deptId) query.deptId = deptId;
    if (sem) query.sem = sem;

    const subjects = await M.Subject.find(query).lean();
    const students = await M.Student.find(deptId ? { deptId } : {}).lean();
    const studentTrackIds = students.map(s => s.trackId).filter(Boolean);

    const attDocs = await M.StudentAttendance.find({
      studentTrackId: { $in: studentTrackIds }
    }).lean();

    const subjectStats = {};
    subjects.forEach(sub => {
      const key = sub.trackId || sub.code;
      subjectStats[key] = {
        code: sub.code,
        name: sub.name,
        sem: sub.sem,
        deptCode: sub.deptCode || '—',
        classesHeld: 0,
        classesAttended: 0,
        pct: 0
      };
    });

    attDocs.forEach(sDoc => {
      (sDoc.records || []).forEach(r => {
        if (subjectStats[r.subjectTrackId]) {
          subjectStats[r.subjectTrackId].classesHeld += r.classesHeld || 0;
          subjectStats[r.subjectTrackId].classesAttended += r.classesAttended || 0;
        }
      });
    });

    Object.values(subjectStats).forEach(row => {
      row.pct = row.classesHeld > 0 ? Math.round((row.classesAttended / row.classesHeld) * 100) : 0;
    });

    res.json(Object.values(subjectStats));
  } catch (err) {
    console.error('[Controller Semester Report Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 15. POST /api/controller/broadcast — Dispatch tagged announcement
router.post('/broadcast', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const { message, level, targetRoles, popupDurationSec } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Broadcast message content cannot be empty' });
    }

    const roles = Array.isArray(targetRoles) && targetRoles.length ? targetRoles : ['all'];
    const urgency = ['info', 'warning', 'urgent', 'success', 'message'].includes(level) ? level : 'info';

    // Department scoping
    const targetDeptId = ctx.role === 'hod' ? ctx.deptId : (req.body.targetDeptId || null);
    const targetDeptCode = ctx.role === 'hod' ? ctx.deptCode : (req.body.targetDeptCode || '');

    const broadcast = await M.BroadcastHistory.create({
      message: message.trim(),
      level: urgency,
      tag: ctx.role,
      targetRoles: roles,
      targetDeptId: targetDeptId,
      targetDeptCode: targetDeptCode,
      broadcastType: 'general',
      popupDurationSec: Number(popupDurationSec) || 10,
      dispatchedBy: {
        role: ctx.role === 'principal' ? 'admin' : 'teacher',
        username: req.user.username,
        name: ctx.name,
        trackId: ctx.trackId,
        ip: req.ip
      }
    });

    await logAction(
      ctx.trackId,
      ctx.name,
      ctx.role === 'principal' ? 'admin' : 'teacher',
      'Broadcast Dispatched',
      message.slice(0, 80),
      'data',
      urgency === 'urgent' ? 'warning' : 'info',
      req.ip,
      req.user.sessionId,
      { module: 'controller', subType: 'broadcast', tag: ctx.role }
    );

    res.status(201).json(broadcast);
  } catch (err) {
    console.error('[Controller Broadcast Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 16. GET /api/controller/broadcast/history — Broadcast dispatch logs
router.get('/broadcast/history', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const filter = {};

    if (ctx.role === 'hod') {
      filter.$or = [
        { 'dispatchedBy.trackId': ctx.trackId },
        { targetDeptId: ctx.deptId },
        { tag: 'principal' }
      ];
    }

    const history = await M.BroadcastHistory.find(filter)
      .sort({ dispatchedAt: -1 })
      .limit(50)
      .lean();

    res.json(history);
  } catch (err) {
    console.error('[Controller Broadcast History Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 17. GET /api/controller/calendar — Academic calendar viewer (read-only)
router.get('/calendar', async (req, res) => {
  try {
    const CalendarModel = M.CalendarDay || M.AcademicCalendar;
    const calendarDays = await CalendarModel.find({})
      .sort({ date: 1 })
      .lean();

    const calendarEvents = calendarDays.map(d => {
      const details = Array.isArray(d.details) ? d.details : [];
      const hasLeave = details.length > 0 && details.every(item => item.dayType === 'leave');
      const hasExam = details.some(item => item.dayType === 'exam');
      const isWorkingDay = details.length > 0 ? !hasLeave : (d.day !== 'Sunday');

      let type = 'Academic';
      if (hasExam) type = 'Exam';
      else if (hasLeave) type = 'Holiday';
      else if (details.some(item => item.dayType === 'half-day')) type = 'Half Day';
      else if (isWorkingDay) type = 'Working Day';

      const comments = details.map(item => item.comments).filter(Boolean).join('; ');
      const description = comments || (isWorkingDay ? 'Regular Schedule' : 'Institutional Holiday / Off');

      return {
        ...d,
        isWorkingDay,
        type,
        description,
        dayOrder: d.dayOrder || '—'
      };
    });

    res.json(calendarEvents);
  } catch (err) {
    console.error('[Controller Calendar Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 18. GET /api/controller/timetable — Class timetable master viewer (read-only)
router.get('/timetable', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);
    const classId = sanitizeToString(req.query.classId) || null;

    const query = {};
    if (deptId && mongoose.isValidObjectId(deptId)) query.deptId = deptId;
    if (classId && mongoose.isValidObjectId(classId)) query.classId = classId;

    let timetables = await M.SectionTimetable.find(query).lean();

    if (!timetables || timetables.length === 0) {
      let tQuery = {};
      if (classId) {
        tQuery.classId = classId;
      } else if (deptId) {
        const clsList = await M.Class.find({ deptId }).select('_id').lean();
        tQuery.classId = { $in: clsList.map(c => c._id) };
      }
      const rawSlots = await M.Timetable.find(tQuery).lean();
      const groupedByClass = {};
      rawSlots.forEach(s => {
        const cId = s.classId ? s.classId.toString() : 'unknown';
        if (!groupedByClass[cId]) {
          groupedByClass[cId] = {
            classId: s.classId,
            className: s.className || 'Class',
            schedule: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] }
          };
        }
        const dayMap = { mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday', fri: 'friday', sat: 'saturday' };
        const dayKey = dayMap[(s.day || '').toLowerCase().slice(0, 3)] || (s.day || '').toLowerCase();
        if (groupedByClass[cId].schedule[dayKey]) {
          groupedByClass[cId].schedule[dayKey].push({
            subject: s.subjectName,
            subjectCode: s.subjectName,
            teacherName: s.teacherName
          });
        }
      });
      timetables = Object.values(groupedByClass);
    } else {
      timetables = timetables.map(st => {
        const schedule = { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] };
        const slots = st.slots || {};
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

        days.forEach(day => {
          for (let p = 1; p <= 7; p++) {
            const capitalizedDay = day.charAt(0).toUpperCase() + day.slice(1);
            const slotData = slots[`${capitalizedDay}-${p}`] || slots[`${day}-${p}`] || slots[`${day.slice(0, 3)}-${p}`];
            if (slotData) {
              schedule[day].push({
                periodNumber: p,
                subject: slotData.subject || slotData.subjectName || slotData.code || slotData.subjectCode,
                subjectCode: slotData.subjectCode || slotData.code || slotData.subject,
                teacherName: slotData.staff || slotData.teacherName || slotData.faculty
              });
            }
          }
        });

        return {
          ...st,
          schedule
        };
      });
    }

    res.json(timetables);
  } catch (err) {
    console.error('[Controller Timetable Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
