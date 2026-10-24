const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { isSudoAdmin } = require('../utils/access');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { checkModuleGuard } = require('../middleware/portalGuard');
const { getSettings } = require('../utils/settingsCache');
const {
  getTeacherIdentity,
  resolveTeacherRange,
  getTimingSets,
  sessionOfPeriod,
  buildOverrideSlot
} = require('../utils/teacherSchedule');
const { getNextRequestId } = require('../utils/requestIds');
const { calculateFacultyLeaveBalance, calculateLOPSplit } = require('../utils/leaveBalance');
const { syncActingRoles } = require('../jobs/actingRoles');
const { todayInInstitutionTz } = require('../utils/institutionTime');

// Helper to generate date array [YYYY-MM-DD, ...]
function getDatesInRange(startDateStr, endDateStr) {
  const dates = [];
  const curr = new Date(startDateStr + 'T00:00:00.000Z');
  const end = new Date(endDateStr + 'T00:00:00.000Z');
  if (isNaN(curr.getTime()) || isNaN(end.getTime()) || curr > end) {
    return [startDateStr];
  }
  while (curr <= end) {
    dates.push(curr.toISOString().split('T')[0]);
    curr.setUTCDate(curr.getUTCDate() + 1);
  }
  return dates;
}

// GET /api/leave/advisor-info — Get logged-in student's Class Advisor
router.get('/advisor-info', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Students only' });
    }

    let student = await M.Student.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.user._id) ? req.user._id : undefined },
        { trackId: req.user.trackId },
        { username: req.user.username },
        { registerNo: req.user.registerNo }
      ].filter(Boolean)
    }).lean();

    if (!student) return res.status(404).json({ error: 'Student not found' });

    let cls = null;
    if (student.classId) {
      if (mongoose.isValidObjectId(student.classId)) {
        cls = await M.Class.findById(student.classId).lean();
      }
      if (!cls) {
        cls = await M.Class.findOne({ trackId: student.classId }).lean();
      }
    }
    if (!cls && student.class) {
      cls = await M.Class.findOne({
        $or: [
          { name: student.class },
          { trackId: student.class }
        ]
      }).lean();
    }

    let advisor = null;
    if (cls && cls.advisorTeacherId) {
      if (mongoose.isValidObjectId(cls.advisorTeacherId)) {
        advisor = await M.Teacher.findById(cls.advisorTeacherId, '-password').lean();
      }
      if (!advisor) {
        advisor = await M.Teacher.findOne({ trackId: cls.advisorTeacherId }, '-password').lean();
      }
    }
    if (!advisor && cls?.advisorTeacherTrackId) {
      advisor = await M.Teacher.findOne({ trackId: cls.advisorTeacherTrackId }, '-password').lean();
    }

    // Fallback: search teacher specials if Class.advisorTeacherId not yet populated
    if (!advisor && cls) {
      advisor = await M.Teacher.findOne({
        'specials.option': 'isClassAdvisor',
        $or: [
          { 'specials.key': cls.name },
          { 'specials.key': cls.trackId },
          { 'specials.value': cls.name },
          { 'specials.value': cls.trackId },
          { 'specials.value': true, 'specials.key': cls.name }
        ]
      }, '-password').lean();
    }

    let advisorPayload = null;
    if (advisor) {
      advisorPayload = {
        _id: advisor._id,
        name: advisor.fullName,
        trackId: advisor.trackId,
        dept: advisor.department,
        designation: advisor.designation || 'Class Advisor',
        email: advisor.email
      };
    }

    res.json({
      className: cls?.name || student.class || '—',
      classId: cls?._id || student.classId,
      advisor: advisorPayload
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leave/apply — Student submits leave or permission
router.post('/apply', authMiddleware, checkModuleGuard('modelLeave', 'Leave Requests'), async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Students only' });
    }

    const { category, leaveType, slot, periods, fromDate, toDate, reason } = req.body;

    if (!fromDate) {
      return res.status(400).json({ error: 'Start date is required' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Reason for leave/permission is required' });
    }

    const reqCategory = category === 'Permission' ? 'Permission' : 'Leave';
    const effectiveEndDate = reqCategory === 'Permission' ? fromDate : (toDate || fromDate);
    const dates = getDatesInRange(fromDate, effectiveEndDate);

    const reqSlot = slot || (reqCategory === 'Permission' ? 'FN' : 'Full Day');

    let daysCount = dates.length;
    if (reqCategory === 'Permission' || reqSlot === 'FN' || reqSlot === 'AN') {
      daysCount = 0.5;
    }

    let defaultPeriods = Array.isArray(periods) ? periods : [];
    if (defaultPeriods.length === 0) {
      if (reqSlot === 'FN') defaultPeriods = [1, 2, 3, 4];
      else if (reqSlot === 'AN') defaultPeriods = [5, 6, 7, 8];
    }

    // Resolve Student
    let student = await M.Student.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.user._id) ? req.user._id : undefined },
        { trackId: req.user.trackId },
        { username: req.user.username },
        { registerNo: req.user.registerNo }
      ].filter(Boolean)
    }).lean();

    if (!student) return res.status(404).json({ error: 'Student record not found' });

    // Resolve Class
    let cls = null;
    if (student.classId) {
      if (mongoose.isValidObjectId(student.classId)) {
        cls = await M.Class.findById(student.classId).lean();
      }
      if (!cls) {
        cls = await M.Class.findOne({ trackId: student.classId }).lean();
      }
    }
    if (!cls && student.class) {
      cls = await M.Class.findOne({
        $or: [
          { name: student.class },
          { trackId: student.class }
        ]
      }).lean();
    }

    const className = cls?.name || student.class || 'Unknown Class';
    const classId = cls?._id || student.classId;
    const deptId = cls?.deptId || student.deptId;
    const deptName = cls?.deptName || student.department || '';

    // Resolve Class Advisor
    let advisor = null;
    if (cls?.advisorTeacherId) {
      if (mongoose.isValidObjectId(cls.advisorTeacherId)) {
        advisor = await M.Teacher.findById(cls.advisorTeacherId).lean();
      }
      if (!advisor) {
        advisor = await M.Teacher.findOne({ trackId: cls.advisorTeacherId }).lean();
      }
    }
    if (!advisor && cls?.advisorTeacherTrackId) {
      advisor = await M.Teacher.findOne({ trackId: cls.advisorTeacherTrackId }).lean();
    }
    if (!advisor && cls) {
      advisor = await M.Teacher.findOne({
        'specials.option': 'isClassAdvisor',
        $or: [
          { 'specials.key': cls.name },
          { 'specials.key': cls.trackId },
          { 'specials.value': cls.name },
          { 'specials.value': cls.trackId },
          { 'specials.value': true, 'specials.key': cls.name }
        ]
      }).lean();
    }

    if (!advisor) {
      return res.status(400).json({
        error: `No Class Advisor is assigned for your class (${className}). Please contact your department/admin to assign a Class Advisor first.`
      });
    }

    const leaveRequest = await M.LeaveRequest.create({
      studentId: student._id,
      studentTrackId: student.trackId || String(student._id),
      studentName: student.fullName || req.user.name,
      studentRegNo: student.registerNo || '—',
      classId: classId,
      className: className,
      deptId: deptId,
      deptName: deptName,
      advisorId: advisor._id,
      advisorTrackId: advisor.trackId || '',
      advisorName: advisor.fullName || '',
      category: reqCategory,
      leaveType: leaveType || (reqCategory === 'Permission' ? 'Half Day Permission' : 'Casual Leave'),
      slot: reqSlot,
      periods: defaultPeriods,
      fromDate: fromDate,
      toDate: effectiveEndDate,
      dates: dates,
      daysCount: daysCount,
      reason: reason.trim(),
      status: 'Pending'
    });

    // Create Notification specifically for the Class Advisor
    const notifMessage = `Leave Query: ${student.fullName} (${student.registerNo}) requested ${reqCategory === 'Permission' ? 'Permission (' + reqSlot + ')' : (leaveType || 'Leave')} for ${fromDate}${effectiveEndDate !== fromDate ? ' to ' + effectiveEndDate : ''} (${daysCount} day${daysCount > 1 ? 's' : ''}). Reason: "${reason.trim().slice(0, 100)}"`;
    const notif = await M.Notification.create({
      type: 'leave-request',
      from: `${student.fullName} (${student.registerNo})`,
      fromRole: 'student',
      toTeacherId: advisor._id,
      toTeacherTrackId: advisor.trackId || '',
      toTeacherName: advisor.fullName,
      leaveRequestId: leaveRequest._id,
      message: notifMessage,
      priority: 'High',
      status: 'Pending',
      time: new Date()
    });
    leaveRequest.notificationId = notif._id;
    await leaveRequest.save();

    await logAction(
      student.trackId || student._id,
      student.fullName || req.user.name,
      'student',
      'Leave Requested',
      `${reqCategory} (${daysCount} days) from ${fromDate} to ${effectiveEndDate}`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'student',
        subType: 'leave',
        trackId: student.trackId,
        changes: {
          before: null,
          after: { category: reqCategory, fromDate, toDate: effectiveEndDate, daysCount, reason }
        }
      }
    );

    res.status(201).json({ success: true, leaveRequest });
  } catch (err) {
    console.error('Apply leave error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leave/my-requests — Get all applications by logged-in student
router.get('/my-requests', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Students only' });
    }

    const studentIdentifiers = [req.user.trackId, String(req.user._id), req.user.username].filter(Boolean);
    const requests = await M.LeaveRequest.find({
      $or: [
        { studentId: mongoose.isValidObjectId(req.user._id) ? req.user._id : undefined },
        { studentTrackId: { $in: studentIdentifiers } }
      ].filter(Boolean)
    }).sort({ createdAt: -1 }).lean();

    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leave/cancel/:id — Student cancels a pending request
router.put('/cancel/:id', authMiddleware, async (req, res) => {
  try {
    const leaveReq = await M.LeaveRequest.findById(req.params.id);
    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });

    if (String(leaveReq.studentId) !== String(req.user._id) && leaveReq.studentTrackId !== req.user.trackId) {
      return res.status(403).json({ error: 'Unauthorized to cancel this request' });
    }

    if (leaveReq.status !== 'Pending') {
      return res.status(400).json({ error: 'Only pending requests can be cancelled' });
    }

    leaveReq.status = 'Cancelled';
    await leaveReq.save();

    // Ensure notification is completely removed from teacher ID
    await M.Notification.deleteMany({
      $or: [
        ...(leaveReq.notificationId ? [{ _id: leaveReq.notificationId }] : []),
        { leaveRequestId: leaveReq._id, type: 'leave-request' }
      ]
    });

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      'student',
      'Leave Cancelled',
      `Cancelled leave request for ${leaveReq.fromDate}`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'student',
        subType: 'leave',
        trackId: req.user.trackId
      }
    );

    res.json({ success: true, leaveRequest: leaveReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leave/advisor-requests — Get requests assigned to teacher with KPI stats & filters
router.get('/advisor-requests', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Teachers only' });
    }

    const baseFilter = {};
    if (req.user.role === 'teacher') {
      const teacher = await M.Teacher.findById(req.user._id).lean();
      const specials = teacher?.specials || [];
      const hasSpecialAdvisor = specials.some(s => s.option === 'isClassAdvisor');
      const hasClassAdvised = await M.Class.exists({
        $or: [
          { advisorTeacherId: req.user._id },
          { advisorTeacherTrackId: req.user.trackId },
          { advisorTeacherTrackId: teacher?.trackId }
        ]
      });

      if (!hasSpecialAdvisor && !hasClassAdvised && !req.user.isAdmin) {
        return res.status(403).json({ error: 'Access denied. Student Leave & Permission History is only available for Class Advisors.', notAdvisor: true });
      }

      baseFilter.$or = [
        { advisorId: req.user._id },
        { advisorTrackId: req.user.trackId },
        { advisorTrackId: teacher?.trackId }
      ].filter(Boolean);
    }

    const statusParam = sanitizeToString(req.query.status);
    if (statusParam && statusParam !== 'all') {
      baseFilter.status = statusParam;
    } else {
      baseFilter.status = { $nin: ['Cancelled', 'cancelled'] };
    }

    // Retrieve all non-cancelled requests for calculating KPI stats
    const allRequests = await M.LeaveRequest.find(baseFilter).sort({ createdAt: -1 }).lean();

    const activeRequests = allRequests.filter(r => r.status !== 'Cancelled' && r.status !== 'cancelled');

    const stats = {
      total: activeRequests.length,
      approved: allRequests.filter(r => r.status === 'Approved').length,
      rejected: allRequests.filter(r => r.status === 'Rejected').length,
      pending: allRequests.filter(r => r.status === 'Pending').length,
      cancelled: allRequests.filter(r => r.status === 'Cancelled' || r.status === 'cancelled').length,
      onDutyCount: activeRequests.filter(r => r.category === 'Permission' || (r.slot && r.slot !== 'Full Day')).length,
      totalApprovedDays: allRequests
        .filter(r => r.status === 'Approved')
        .reduce((sum, r) => sum + (r.daysCount || (r.category === 'Permission' ? 0.5 : 1)), 0)
    };

    // Filter by criteria
    let filtered = allRequests;
    const fromDate = sanitizeToString(req.query.from);
    const toDate = sanitizeToString(req.query.to);
    const category = sanitizeToString(req.query.category);
    const search = (sanitizeToString(req.query.search) || '').toLowerCase();

    if (fromDate) {
      filtered = filtered.filter(r => r.toDate >= fromDate);
    }
    if (toDate) {
      filtered = filtered.filter(r => r.fromDate <= toDate);
    }
    if (category) {
      filtered = filtered.filter(r => r.category === category);
    }
    if (statusParam && statusParam !== 'all') {
      filtered = filtered.filter(r => r.status === statusParam);
    } else {
      filtered = filtered.filter(r => r.status !== 'Cancelled' && r.status !== 'cancelled');
    }
    if (search) {
      filtered = filtered.filter(r =>
        (r.studentName && r.studentName.toLowerCase().includes(search)) ||
        (r.studentRegNo && r.studentRegNo.toLowerCase().includes(search)) ||
        (r.className && r.className.toLowerCase().includes(search))
      );
    }

    res.json({
      requests: filtered,
      stats: stats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leave/detail/:id — Get details + Student's real-time Attendance % and past leaves
router.get('/detail/:id', authMiddleware, async (req, res) => {
  try {
    const leaveReq = await M.LeaveRequest.findById(req.params.id).lean();
    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });

    // Calculate student attendance percentage
    const studentTrackId = leaveReq.studentTrackId;
    const studentId = String(leaveReq.studentId);
    const identifiers = [studentTrackId, studentId, leaveReq.studentRegNo].filter(Boolean);

    // Query ClassAttendance for periods records matching this student
    const attDocs = await M.ClassAttendance.find({
      'periods.records.studentTrackId': { $in: identifiers }
    }).lean();

    let totalClasses = 0;
    let attendedClasses = 0;

    for (const doc of attDocs) {
      for (const period of doc.periods || []) {
        const myRecord = (period.records || []).find(r => identifiers.includes(r.studentTrackId));
        if (myRecord) {
          totalClasses++;
          if (myRecord.status === 'P') attendedClasses++;
        }
      }
    }

    const overallPercentage = totalClasses > 0 ? Math.round((attendedClasses / totalClasses) * 100) : 100;

    // Count past approved leaves and permissions for this student
    const [pastLeaves, pastPermissions] = await Promise.all([
      M.LeaveRequest.find({
        studentTrackId: { $in: identifiers },
        status: 'Approved',
        category: 'Leave',
        _id: { $ne: leaveReq._id }
      }).lean(),
      M.LeaveRequest.find({
        studentTrackId: { $in: identifiers },
        status: 'Approved',
        category: 'Permission',
        _id: { $ne: leaveReq._id }
      }).lean()
    ]);

    const pastLeaveDays = pastLeaves.reduce((acc, r) => acc + (r.daysCount || 1), 0);
    const pastPermissionDays = pastPermissions.reduce((acc, r) => acc + (r.daysCount || 0.5), 0);

    res.json({
      leaveRequest: leaveReq,
      studentStats: {
        totalClasses,
        attendedClasses,
        overallPercentage,
        pastLeaveDays,
        pastPermissionDays,
        pastApprovedLeavesCount: pastLeaves.length,
        pastApprovedPermissionsCount: pastPermissions.length
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leave/review/:id — Teacher approves or rejects leave request
router.put('/review/:id', authMiddleware, checkModuleGuard('modelLeave', 'Leave Requests'), async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Teachers or admins only' });
    }

    const { action, remarks } = req.body;
    if (!['Approved', 'Rejected'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "Approved" or "Rejected"' });
    }

    const leaveReq = await M.LeaveRequest.findById(req.params.id);
    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });

    leaveReq.status = action;
    leaveReq.reviewedBy = req.user.fullName || req.user.name || 'Class Advisor';
    leaveReq.reviewedAt = new Date();
    leaveReq.reviewRemarks = (remarks || '').trim();
    await leaveReq.save();

    // Mark teacher's incoming notification as Solved
    if (leaveReq.notificationId) {
      await M.Notification.findByIdAndUpdate(leaveReq.notificationId, {
        status: 'Solved',
        read: true,
        solvedAt: new Date()
      });
    }

    // Send Notification to the Student
    const reviewerName = req.user.fullName || req.user.name;
    const studentNotifMsg = `Leave Permission ${action}: Your ${leaveReq.category} query for ${leaveReq.fromDate}${leaveReq.toDate !== leaveReq.fromDate ? ' to ' + leaveReq.toDate : ''} (${leaveReq.slot}) has been ${action} by ${reviewerName}.${remarks ? ' Note: ' + remarks : ''}`;

    await M.Notification.create({
      type: action === 'Approved' ? 'leave-approval' : 'leave-rejection',
      from: `${reviewerName} (Class Advisor)`,
      fromRole: 'teacher',
      toStudentId: leaveReq.studentId,
      toStudentName: leaveReq.studentName,
      toStudentTrackId: leaveReq.studentTrackId,
      leaveRequestId: leaveReq._id,
      message: studentNotifMsg,
      priority: action === 'Approved' ? 'Normal' : 'High',
      status: 'Solved',
      time: new Date()
    });

    await logAction(
      req.user.trackId || req.user._id,
      reviewerName,
      req.user.role,
      `Leave Request ${action}`,
      `${action} leave for ${leaveReq.studentName} (${leaveReq.fromDate})`,
      'attendance',
      action === 'Approved' ? 'info' : 'warning',
      req.ip,
      req.user.sessionId,
      {
        module: 'teacher',
        subType: 'leave',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: { status: 'Pending' }, after: { status: action, remarks: remarks || '' } }
      }
    );

    res.json({ success: true, leaveRequest: leaveReq });
  } catch (err) {
    console.error('Review leave error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leave/approved-for-date — Query approved leaves for attendance sheet
router.get('/approved-for-date', authMiddleware, async (req, res) => {
  try {
    const { classId, date } = req.query;
    if (!date) return res.status(400).json({ error: 'Date is required' });

    const query = {
      status: 'Approved',
      dates: sanitizeToString(date)
    };

    if (classId) {
      const clsIdStr = sanitizeToString(classId);
      const classQuery = [{ className: clsIdStr }];
      if (mongoose.isValidObjectId(clsIdStr)) {
        classQuery.push({ classId: clsIdStr });
      }
      query.$or = classQuery;
    }

    const approvedLeaves = await M.LeaveRequest.find(query).lean();
    const list = approvedLeaves.map(l => ({
      _id: l._id,
      studentId: l.studentId,
      studentTrackId: l.studentTrackId,
      studentName: l.studentName,
      studentRegNo: l.studentRegNo,
      category: l.category,
      leaveType: l.leaveType,
      slot: l.slot,
      periods: l.periods || [],
      reason: l.reason,
      fromDate: l.fromDate,
      toDate: l.toDate
    }));

    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PLAN 4 (FEATURE 6): TEACHER LEAVE & SUBSTITUTION INTEGRATION
// ─────────────────────────────────────────────────────────────

const DAY_ABBR_MAP_LEAVE = {
  0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat'
};
const DAY_FULL_MAP_LEAVE = {
  0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday'
};

// GET /api/leave/affected-slots — Auto-fetch scheduled slots requiring substitutes for date range
router.get('/affected-slots', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Teachers only' });
    }

    const fromDate = sanitizeToString(req.query.fromDate);
    const toDate = sanitizeToString(req.query.toDate) || fromDate;
    if (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      return res.status(400).json({ error: 'Valid fromDate and toDate (YYYY-MM-DD) are required' });
    }

    const dFrom = new Date(fromDate + 'T00:00:00.000Z');
    const dTo = new Date(toDate + 'T00:00:00.000Z');
    if (isNaN(dFrom.getTime()) || isNaN(dTo.getTime()) || dTo < dFrom) {
      return res.status(400).json({ error: 'toDate cannot be before fromDate' });
    }
    const diffDays = Math.round((dTo - dFrom) / (24 * 60 * 60 * 1000)) + 1;
    if (diffDays > 14) {
      return res.status(400).json({ error: 'Date range cannot exceed 14 days' });
    }

    const slotType = sanitizeToString(req.query.slot) || 'Full Day';
    let targetPeriods = [];
    if (req.query.periods) {
      targetPeriods = Array.isArray(req.query.periods) 
        ? req.query.periods.map(Number) 
        : String(req.query.periods).split(',').map(Number);
    }

    let teacherTrackId = req.user.trackId;
    if (isSudoAdmin(req.user) && req.query.teacherTrackId) {
      teacherTrackId = sanitizeToString(req.query.teacherTrackId);
    }

    const idn = await getTeacherIdentity(req.user, teacherTrackId);
    if (!idn) {
      return res.status(404).json({ error: 'Teacher record not found' });
    }

    const resolvedDays = await resolveTeacherRange(idn, fromDate, toDate);
    const timingSets = await getTimingSets();
    const affectedSlots = [];

    for (const dayObj of resolvedDays) {
      if (dayObj.isHoliday) continue;

      for (const slot of (dayObj.slots || [])) {
        // Keep only owned, scheduled slots (automatically ignores cancelled, substituted, holiday, leave)
        if (slot.role !== 'owner' || slot.status !== 'scheduled') {
          continue;
        }

        const pNum = Number(slot.periodNumber);
        if (targetPeriods.length > 0 && !targetPeriods.includes(pNum)) {
          continue;
        }

        // Determine session (FN vs AN) via sessionOfPeriod
        if (slotType === 'FN' || slotType === 'AN') {
          const tSet = timingSets.find(ts => ts.name === slot.timingSetName)
            || timingSets.find(ts => ts.isDefault)
            || timingSets[0];
          const session = sessionOfPeriod(tSet, pNum);
          if (session !== slotType) {
            continue;
          }
        }

        affectedSlots.push({
          date: slot.date,
          day: dayObj.dayFull || slot.day,
          periodNumber: pNum,
          span: slot.span || 1,
          classId: slot.classId,
          className: slot.className,
          subjectId: slot.subjectId,
          subjectName: slot.subjectName,
          subjectCode: slot.subjectCode || '',
          hallNo: slot.room || '',
          start: slot.start,
          end: slot.end,
          timingSetName: slot.timingSetName || '',
          slotKey: `${dayObj.dayFull || slot.day}_${pNum}`,
          currentSubstitute: slot.substituteTeacher || ''
        });
      }
    }

    affectedSlots.sort((a, b) => a.date.localeCompare(b.date) || a.periodNumber - b.periodNumber);

    res.json({
      teacherTrackId: idn.trackId,
      teacherName: idn.fullName,
      fromDate,
      toDate,
      slotType,
      slotsCount: affectedSlots.length,
      affectedSlots
    });
  } catch (err) {
    console.error('Affected slots error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leave/teacher/apply — Teacher applies for leave with substitutions
router.post('/teacher/apply', authMiddleware, checkModuleGuard('modelLeave', 'Leave Requests'), async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Teachers only' });
    }

    const { category, leaveType, slot, fromDate, toDate, reason, isEmergency, substitutions } = req.body;

    if (!fromDate) return res.status(400).json({ error: 'Start date is required' });
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Reason is required' });

    const effectiveEndDate = toDate || fromDate;
    const dates = getDatesInRange(fromDate, effectiveEndDate);
    const daysCount = slot === 'FN' || slot === 'AN' || category === 'Permission' ? 0.5 : dates.length;

    // Resolve Teacher
    const teacher = await M.Teacher.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.user._id) ? req.user._id : undefined },
        { trackId: req.user.trackId },
        { username: req.user.username }
      ].filter(Boolean)
    }).lean();

    if (!teacher) return res.status(404).json({ error: 'Teacher record not found' });

    // Validate substitutions list against production resolver
    const validSubs = [];
    if (Array.isArray(substitutions) && substitutions.length > 0) {
      const idn = await getTeacherIdentity(req.user);
      if (!idn) return res.status(404).json({ error: 'Teacher identity not resolved' });

      const resolvedDays = await resolveTeacherRange(idn, fromDate, effectiveEndDate);
      const validOwnedSlots = new Set();
      resolvedDays.forEach(d => {
        (d.slots || []).forEach(s => {
          if (s.role === 'owner' && s.status === 'scheduled') {
            validOwnedSlots.add(`${s.date}_${s.periodNumber}_${String(s.classId || '')}`);
            validOwnedSlots.add(`${s.date}_${s.periodNumber}`);
          }
        });
      });

      for (const s of substitutions) {
        if (!s.substituteTeacherTrackId || !s.substituteTeacherName) continue;
        const pNum = Number(s.periodNumber);
        const keyExact = `${s.date}_${pNum}_${String(s.classId || '')}`;
        const keyGeneric = `${s.date}_${pNum}`;
        if (!validOwnedSlots.has(keyExact) && !validOwnedSlots.has(keyGeneric)) {
          return res.status(400).json({
            error: `Invalid substitution: slot on ${s.date} (Period ${pNum}) does not exist or does not belong to you.`
          });
        }

        validSubs.push({
          date: s.date,
          day: s.day || '',
          periodNumber: pNum,
          classId: s.classId || null,
          className: s.className || '',
          subjectName: s.subjectName || '',
          subjectCode: s.subjectCode || '',
          hallNo: s.hallNo || '',
          substituteTeacherId: s.substituteTeacherId || null,
          substituteTeacherTrackId: s.substituteTeacherTrackId,
          substituteTeacherName: s.substituteTeacherName,
          status: 'pending',
          notes: s.notes || ''
        });
      }
    }

    const leaveReq = await M.TeacherLeaveRequest.create({
      teacherId: teacher._id,
      teacherTrackId: teacher.trackId,
      teacherName: teacher.fullName || teacher.name,
      employeeNo: teacher.employeeNo || '',
      deptId: teacher.deptId,
      deptCode: teacher.deptCode || '',
      deptName: teacher.department || '',
      category: category || 'Leave',
      leaveType: leaveType || 'Casual Leave',
      slot: slot || 'Full Day',
      fromDate,
      toDate: effectiveEndDate,
      dates,
      daysCount,
      reason: reason.trim(),
      isEmergency: Boolean(isEmergency),
      status: 'Pending',
      escalationLevel: 'hod',
      hodStatus: 'Pending',
      substitutions: validSubs,
      substituteTeacherTrackId: validSubs[0]?.substituteTeacherTrackId || '',
      substituteTeacherName: validSubs.map(s => s.substituteTeacherName).join(', ')
    });

    // Notify HOD (T11: robust lookup across deptId, deptCode, and department name)
    const deptFilters = [];
    if (teacher.deptId) deptFilters.push({ deptId: teacher.deptId });
    if (teacher.deptCode) deptFilters.push({ deptCode: teacher.deptCode });
    if (teacher.department) deptFilters.push({ department: new RegExp(`^${teacher.department.trim()}$`, 'i') });
    let hodTeacher = null;
    if (deptFilters.length > 0) {
      hodTeacher = await M.Teacher.findOne({
        'specials.option': { $in: ['isHod', 'isHOD'] },
        $or: deptFilters
      }).lean();
    }

    if (hodTeacher) {
      await M.Notification.create({
        type: 'leave-request',
        from: teacher.fullName || teacher.name,
        fromRole: 'teacher',
        toTeacherId: hodTeacher._id,
        toTeacherTrackId: hodTeacher.trackId,
        toTeacherName: hodTeacher.fullName || hodTeacher.name,
        message: `${teacher.fullName} submitted a ${leaveReq.category} request (${fromDate} to ${effectiveEndDate}) with ${validSubs.length} substitutions.`,
        priority: isEmergency ? 'High' : 'Normal',
        time: new Date()
      }).catch(() => {});
    }

    await logAction(
      req.user.trackId || req.user._id,
      teacher.fullName || teacher.name,
      'teacher',
      'Teacher Leave Applied',
      `Applied for ${leaveReq.category} from ${fromDate} to ${effectiveEndDate} with ${validSubs.length} substitutions`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'teacher',
        subType: 'leave-apply',
        leaveRequestId: leaveReq._id,
        substitutionsCount: validSubs.length
      }
    );

    res.status(201).json({ success: true, leaveRequest: leaveReq });
  } catch (err) {
    console.error('Teacher leave apply error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leave/teacher/my-requests or /faculty/my-requests — Teacher's own leave requests
router.get(['/teacher/my-requests', '/faculty/my-requests'], authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Teachers only' });
    }

    const teacher = await M.Teacher.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.user._id) ? req.user._id : undefined },
        { trackId: req.user.trackId },
        { username: req.user.username }
      ].filter(Boolean)
    }).lean();

    const filter = {
      $or: [
        { teacherId: teacher?._id || req.user._id },
        { teacherTrackId: teacher?.trackId || req.user.trackId }
      ]
    };

    const requests = await M.TeacherLeaveRequest.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leave/teacher/cancel/:id — Teacher cancels a pending request
router.put('/teacher/cancel/:id', authMiddleware, async (req, res) => {
  try {
    const leaveReq = await M.TeacherLeaveRequest.findById(req.params.id);
    if (!leaveReq) return res.status(404).json({ error: 'Request not found' });

    if (String(leaveReq.teacherId) !== String(req.user._id) && leaveReq.teacherTrackId !== req.user.trackId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to cancel this request' });
    }

    if (leaveReq.status !== 'Pending') {
      return res.status(400).json({ error: 'Only pending requests can be cancelled' });
    }

    leaveReq.status = 'Cancelled';
    await leaveReq.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      'teacher',
      'Teacher Leave Cancelled',
      `Cancelled leave request for ${leaveReq.fromDate}`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'teacher', subType: 'leave-cancel' }
    );

    res.json({ success: true, leaveRequest: leaveReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// STAGE 6: FACULTY LEAVE & SUBSTITUTIONS WORKFLOW (L7 & L8)
// ─────────────────────────────────────────────────────────────

// GET /api/leave/policy — Get department leave policy
router.get('/policy', authMiddleware, async (req, res) => {
  try {
    const deptCode = sanitizeToString(req.query.deptCode || req.query.dept);
    const isPrincipal = isSudoAdmin(req.user) || req.user.isPrincipal;
    if (isPrincipal && !deptCode) {
      const policies = await M.FacultyLeavePolicy.find({}).lean();
      return res.json({ ok: true, policies });
    }
    const targetDept = deptCode || req.user.deptCode;
    const settingsMap = await getSettings(['teachers']);
    const teacherDefaults = settingsMap?.teachers || {};

    let policy = await M.FacultyLeavePolicy.findOne({ deptCode: String(targetDept || '').toUpperCase() }).lean();
    if (!policy) {
      policy = {
        deptCode: String(targetDept || '').toUpperCase(),
        annualLeaveQuota: teacherDefaults.annualLeaveQuota !== undefined ? Number(teacherDefaults.annualLeaveQuota) : 15,
        allowances: {
          casualLeave: teacherDefaults.casualLeaveAllowance !== undefined ? Number(teacherDefaults.casualLeaveAllowance) : 12,
          medicalLeave: teacherDefaults.medicalLeaveAllowance !== undefined ? Number(teacherDefaults.medicalLeaveAllowance) : 10,
          earnedLeave: teacherDefaults.earnedLeaveAllowance !== undefined ? Number(teacherDefaults.earnedLeaveAllowance) : 15
        },
        carryForwardEarned: teacherDefaults.carryForward !== undefined ? Boolean(teacherDefaults.carryForward) : true,
        medicalDocThresholdDays: teacherDefaults.medicalDocThresholdDays !== undefined ? Number(teacherDefaults.medicalDocThresholdDays) : 3,
        maxConsecutiveLeaveDays: teacherDefaults.maxConsecutiveLeaveDays !== undefined ? Number(teacherDefaults.maxConsecutiveLeaveDays) : 3,
        requireSubstitution: teacherDefaults.requireSubstitution !== undefined ? Boolean(teacherDefaults.requireSubstitution) : true,
        allowPeriodLeave: teacherDefaults.allowPeriodLeave !== undefined ? Boolean(teacherDefaults.allowPeriodLeave) : true,
        autoEscalatePrincipal: teacherDefaults.autoEscalatePrincipal !== undefined ? Boolean(teacherDefaults.autoEscalatePrincipal) : false,
        revision: 1,
        isDefault: true
      };
    } else {
      // Ensure defaults for any missing fields in existing record
      if (policy.annualLeaveQuota === undefined) policy.annualLeaveQuota = teacherDefaults.annualLeaveQuota ?? 15;
      if (policy.maxConsecutiveLeaveDays === undefined) policy.maxConsecutiveLeaveDays = teacherDefaults.maxConsecutiveLeaveDays ?? 3;
      if (policy.requireSubstitution === undefined) policy.requireSubstitution = teacherDefaults.requireSubstitution ?? true;
      if (policy.allowPeriodLeave === undefined) policy.allowPeriodLeave = teacherDefaults.allowPeriodLeave ?? true;
      if (policy.autoEscalatePrincipal === undefined) policy.autoEscalatePrincipal = teacherDefaults.autoEscalatePrincipal ?? false;
      if (policy.carryForwardEarned === undefined) policy.carryForwardEarned = teacherDefaults.carryForward ?? true;
      if (policy.medicalDocThresholdDays === undefined) policy.medicalDocThresholdDays = teacherDefaults.medicalDocThresholdDays ?? 3;
    }
    res.json({ ok: true, policy, defaults: teacherDefaults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leave/policy — HOD modifies department leave policy (creates new revision)
router.put('/policy', authMiddleware, async (req, res) => {
  try {
    const {
      deptCode,
      allowances,
      annualLeaveQuota,
      carryForwardEarned,
      carryForward,
      allowCarryForward,
      medicalDocThresholdDays,
      maxConsecutiveLeaveDays,
      requireSubstitution,
      allowPeriodLeave,
      autoEscalatePrincipal,
      reason
    } = req.body;
    const cleanDept = String(deptCode || req.user.deptCode || '').toUpperCase().trim();
    if (!cleanDept) {
      return res.status(400).json({ error: 'deptCode is required' });
    }

    // Acting HOD check: Acting HOD cannot change policy per LD8 / Permission Matrix
    const today = await todayInInstitutionTz();
    const actingRole = await M.ActingRole.findOne({
      holderTrackId: req.user.trackId,
      role: 'hod',
      status: { $in: ['active', 'pending'] },
      from: { $lte: today },
      to: { $gte: today }
    }).lean();

    if (actingRole && !isSudoAdmin(req.user) && !req.user.isPrincipal) {
      return res.status(403).json({ error: 'Acting HOD is not permitted to modify department leave policy' });
    }

    const isHodForDept = (req.user.isHod && String(req.user.deptCode || '').toUpperCase() === cleanDept) ||
      isSudoAdmin(req.user) || req.user.isPrincipal;
    if (!isHodForDept) {
      return res.status(403).json({ error: `Only the HOD of ${cleanDept} or Admin can modify policy` });
    }

    const settingsMap = await getSettings(['teachers']);
    const teacherDefaults = settingsMap?.teachers || {};

    const resolvedCarryForward = carryForwardEarned !== undefined ? Boolean(carryForwardEarned) :
      (carryForward !== undefined ? Boolean(carryForward) :
      (allowCarryForward !== undefined ? Boolean(allowCarryForward) : (teacherDefaults.carryForward ?? true)));

    let policy = await M.FacultyLeavePolicy.findOne({ deptCode: cleanDept });
    if (!policy) {
      policy = new M.FacultyLeavePolicy({
        deptCode: cleanDept,
        annualLeaveQuota: annualLeaveQuota !== undefined ? Number(annualLeaveQuota) : (teacherDefaults.annualLeaveQuota ?? 15),
        allowances: {
          casualLeave: allowances?.casualLeave !== undefined ? Number(allowances.casualLeave) : (teacherDefaults.casualLeaveAllowance ?? 12),
          medicalLeave: allowances?.medicalLeave !== undefined ? Number(allowances.medicalLeave) : (teacherDefaults.medicalLeaveAllowance ?? 10),
          earnedLeave: allowances?.earnedLeave !== undefined ? Number(allowances.earnedLeave) : (teacherDefaults.earnedLeaveAllowance ?? 15)
        },
        carryForwardEarned: resolvedCarryForward,
        medicalDocThresholdDays: medicalDocThresholdDays !== undefined ? Number(medicalDocThresholdDays) : (teacherDefaults.medicalDocThresholdDays ?? 3),
        maxConsecutiveLeaveDays: maxConsecutiveLeaveDays !== undefined ? Number(maxConsecutiveLeaveDays) : (teacherDefaults.maxConsecutiveLeaveDays ?? 3),
        requireSubstitution: requireSubstitution !== undefined ? Boolean(requireSubstitution) : (teacherDefaults.requireSubstitution ?? true),
        allowPeriodLeave: allowPeriodLeave !== undefined ? Boolean(allowPeriodLeave) : (teacherDefaults.allowPeriodLeave ?? true),
        autoEscalatePrincipal: autoEscalatePrincipal !== undefined ? Boolean(autoEscalatePrincipal) : (teacherDefaults.autoEscalatePrincipal ?? false),
        revision: 1,
        revisedBy: {
          trackId: req.user.trackId || String(req.user._id),
          name: req.user.fullName || req.user.name,
          role: isSudoAdmin(req.user) ? 'admin' : (req.user.isPrincipal ? 'principal' : 'hod')
        },
        history: []
      });
    } else {
      policy.history.push({
        revision: policy.revision,
        annualLeaveQuota: policy.annualLeaveQuota,
        allowances: { ...policy.allowances.toObject() },
        carryForwardEarned: policy.carryForwardEarned,
        medicalDocThresholdDays: policy.medicalDocThresholdDays,
        maxConsecutiveLeaveDays: policy.maxConsecutiveLeaveDays,
        requireSubstitution: policy.requireSubstitution,
        allowPeriodLeave: policy.allowPeriodLeave,
        autoEscalatePrincipal: policy.autoEscalatePrincipal,
        revisedBy: { ...policy.revisedBy },
        revisedAt: policy.revisedAt,
        reason: reason || 'Policy revised by Department Controller'
      });

      policy.revision += 1;
      if (annualLeaveQuota !== undefined) policy.annualLeaveQuota = Number(annualLeaveQuota);
      if (allowances?.casualLeave !== undefined) policy.allowances.casualLeave = Number(allowances.casualLeave);
      if (allowances?.medicalLeave !== undefined) policy.allowances.medicalLeave = Number(allowances.medicalLeave);
      if (allowances?.earnedLeave !== undefined) policy.allowances.earnedLeave = Number(allowances.earnedLeave);
      if (carryForwardEarned !== undefined || carryForward !== undefined || allowCarryForward !== undefined) {
        policy.carryForwardEarned = resolvedCarryForward;
      }
      if (medicalDocThresholdDays !== undefined) policy.medicalDocThresholdDays = Number(medicalDocThresholdDays);
      if (maxConsecutiveLeaveDays !== undefined) policy.maxConsecutiveLeaveDays = Number(maxConsecutiveLeaveDays);
      if (requireSubstitution !== undefined) policy.requireSubstitution = Boolean(requireSubstitution);
      if (allowPeriodLeave !== undefined) policy.allowPeriodLeave = Boolean(allowPeriodLeave);
      if (autoEscalatePrincipal !== undefined) policy.autoEscalatePrincipal = Boolean(autoEscalatePrincipal);
      policy.revisedBy = {
        trackId: req.user.trackId || String(req.user._id),
        name: req.user.fullName || req.user.name,
        role: isSudoAdmin(req.user) ? 'admin' : (req.user.isPrincipal ? 'principal' : 'hod')
      };
      policy.revisedAt = new Date();
    }

    await policy.save();

    await logAction(
      req.user.trackId || req.user._id,
      req.user.fullName || req.user.name,
      'controller',
      'Leave Policy Updated',
      `Updated department leave policy for ${cleanDept} (Revision ${policy.revision})`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId,
      { deptCode: cleanDept, revision: policy.revision }
    );

    res.json({ ok: true, message: 'Department leave policy updated successfully', policy });
  } catch (err) {
    console.error('Update leave policy error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leave/balance — Get leave balance and LOP status for faculty member
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    let targetTrackId = req.user.trackId;
    if (req.query.teacherTrackId && (isSudoAdmin(req.user) || req.user.isHod || req.user.isPrincipal)) {
      targetTrackId = sanitizeToString(req.query.teacherTrackId);
    }
    const deptCode = sanitizeToString(req.query.deptCode || req.user.deptCode || '');
    const year = req.query.year ? Number(req.query.year) : null;

    const balanceData = await calculateFacultyLeaveBalance({
      teacherTrackId: targetTrackId,
      deptCode,
      year
    });

    res.json({ ok: true, data: balanceData });
  } catch (err) {
    console.error('Leave balance error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leave/faculty — Apply for Faculty Leave (Wizard Step 4 submit or Step 2 draft)
router.post('/faculty', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Faculty members only' });
    }

    const teacher = await M.Teacher.findOne({
      $or: [
        { trackId: req.user.trackId },
        { _id: mongoose.isValidObjectId(req.user._id) ? req.user._id : undefined }
      ].filter(Boolean)
    }).lean();

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher record not found' });
    }

    const {
      leaveType = 'Casual Leave',
      coverage = 'full_day',
      periods = [],
      fromDate,
      toDate,
      reason,
      isEmergency = false,
      actingAdvisor = null,
      actingHod = null,
      document = null,
      substitutions = [],
      isDraft = false
    } = req.body;

    if (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
      return res.status(400).json({ error: 'Valid fromDate (YYYY-MM-DD) is required' });
    }
    const effectiveToDate = toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate) ? toDate : fromDate;
    if (effectiveToDate < fromDate) {
      return res.status(400).json({ error: 'toDate cannot be before fromDate' });
    }
    if (!isDraft && (!reason || !reason.trim())) {
      return res.status(400).json({ error: 'Leave reason is required' });
    }

    const dates = getDatesInRange(fromDate, effectiveToDate);

    // Normalize coverage
    let normCoverage = 'full_day';
    const rawCov = String(coverage || req.body.slot || 'full_day').toLowerCase();
    if (rawCov.includes('period') || rawCov.includes('custom') || rawCov.includes('hour')) {
      normCoverage = 'periods';
    } else if (rawCov === 'fn' || rawCov.includes('forenoon')) {
      normCoverage = 'fn';
    } else if (rawCov === 'an' || rawCov.includes('afternoon')) {
      normCoverage = 'an';
    } else {
      normCoverage = 'full_day';
    }

    // Calculate daysCount
    let daysCount = 0;
    if (normCoverage === 'periods') {
      daysCount = 0; // LD7: 0 units
    } else if (normCoverage === 'fn' || normCoverage === 'an') {
      daysCount = 0.5 * dates.length;
    } else {
      daysCount = dates.length;
    }

    // Balance check & automatic LOP split calculation (LD6)
    const balanceInfo = await calculateFacultyLeaveBalance({
      teacherTrackId: teacher.trackId,
      deptCode: teacher.deptCode || teacher.department
    });

    let availableBalance = 0;
    const normType = String(leaveType).toLowerCase();
    if (normType.includes('casual') || normType === 'cl') {
      availableBalance = balanceInfo.balances.casualLeave.available;
    } else if (normType.includes('med') || normType === 'ml') {
      availableBalance = balanceInfo.balances.medicalLeave.available;
    } else if (normType.includes('earned') || normType === 'el') {
      availableBalance = balanceInfo.balances.earnedLeave.available;
    }

    const lopSplit = calculateLOPSplit({
      leaveType,
      requestedDays: daysCount,
      availableBalance
    });

    // Check Class Advisor appointment requirement (LD16)
    const classAdvisorOf = await M.Class.findOne({
      $or: [
        { advisorTeacherId: teacher._id },
        { advisorTeacherTrackId: teacher.trackId }
      ]
    }).lean();

    const advisorTrackId = actingAdvisor?.teacherTrackId || actingAdvisor?.trackId || req.body.actingAdvisorTrackId;
    if (classAdvisorOf && !advisorTrackId && !isEmergency && !isDraft) {
      return res.status(400).json({
        error: `As Class Advisor of ${classAdvisorOf.name}, you must appoint an Acting Class Advisor for the leave period.`
      });
    }

    // Check HOD appointment requirement (LD16)
    const isHod = teacher.isHod || (Array.isArray(teacher.specials) && teacher.specials.some(s => s.option === 'isHod'));
    const hodTrackId = actingHod?.teacherTrackId || actingHod?.trackId || req.body.actingHodTrackId;
    if (isHod && !hodTrackId && !isEmergency && !isDraft) {
      return res.status(400).json({
        error: 'As HOD, you must appoint an Acting HOD for your leave period.'
      });
    }

    let finalActingAdvisor = null;
    if (advisorTrackId) {
      let advName = actingAdvisor?.teacherName || actingAdvisor?.name || req.body.actingAdvisorName;
      if (!advName) {
        const found = await M.Teacher.findOne({ trackId: advisorTrackId }).lean();
        if (found) advName = found.fullName || found.name;
      }
      finalActingAdvisor = {
        classId: actingAdvisor?.classId || classAdvisorOf?._id || null,
        className: actingAdvisor?.className || classAdvisorOf?.name || '',
        teacherTrackId: advisorTrackId,
        teacherName: advName || advisorTrackId
      };
    }

    let finalActingHod = null;
    if (hodTrackId) {
      let hName = actingHod?.teacherName || actingHod?.name || req.body.actingHodName;
      if (!hName) {
        const found = await M.Teacher.findOne({ trackId: hodTrackId }).lean();
        if (found) hName = found.fullName || found.name;
      }
      finalActingHod = {
        deptCode: actingHod?.deptCode || teacher.deptCode || '',
        teacherTrackId: hodTrackId,
        teacherName: hName || hodTrackId
      };
    }

    // Format substitutions
    const formattedSubs = (substitutions || []).map(s => ({
      date: s.date,
      day: s.day || '',
      periodNumber: Number(s.periodNumber),
      classId: s.classId || null,
      className: s.className || '',
      subjectName: s.subjectName || '',
      subjectCode: s.subjectCode || '',
      hallNo: s.hallNo || '',
      substituteTeacherId: s.substituteTeacherId || null,
      substituteTeacherTrackId: s.substituteTeacherTrackId,
      substituteTeacherName: s.substituteTeacherName,
      status: s.status || 'requested',
      assignedBy: 'teacher',
      isUnresolved: Boolean(s.isUnresolved),
      notes: s.notes || ''
    }));

    const requestId = await getNextRequestId('FL');
    let initialStatus = 'pending_hod';
    let escalationLevel = 'hod';

    if (isDraft) {
      initialStatus = 'draft';
    } else if (isHod) {
      // HOD's own leave skips HOD stage and goes straight to Principal (§6.6 / LD8)
      initialStatus = 'pending_principal';
      escalationLevel = 'principal';
    }

    const leaveReq = await M.TeacherLeaveRequest.create({
      requestId,
      teacherId: teacher._id,
      teacherTrackId: teacher.trackId,
      teacherName: teacher.fullName || teacher.name,
      employeeNo: teacher.employeeNo || '',
      deptId: teacher.deptId,
      deptCode: teacher.deptCode || '',
      deptName: teacher.department || '',
      category: 'Leave',
      leaveType,
      slot: normCoverage === 'periods' ? 'Custom Hours' : (normCoverage === 'fn' ? 'FN' : (normCoverage === 'an' ? 'AN' : 'Full Day')),
      coverage: normCoverage,
      periods: Array.isArray(periods) ? periods.map(Number) : [],
      fromDate,
      toDate: effectiveToDate,
      dates,
      daysCount,
      balanceBreakdown: {
        leaveType: lopSplit.leaveType,
        requestedDays: lopSplit.requestedDays,
        available: lopSplit.available,
        coveredByLeave: lopSplit.coveredByLeave,
        lopDays: lopSplit.lopDays
      },
      reason: (reason || (isDraft ? 'Draft' : '')).trim(),
      isEmergency: Boolean(isEmergency),
      actingAdvisor: finalActingAdvisor,
      actingHod: finalActingHod,
      document: document ? {
        driveFileId: document.driveFileId || null,
        webViewLink: document.webViewLink || document.url || null,
        name: document.name || ''
      } : null,
      status: initialStatus,
      escalationLevel,
      hodStatus: isHod ? 'N/A' : (isDraft ? 'Pending' : 'Pending'),
      principalStatus: 'Pending',
      substitutions: formattedSubs,
      substituteTeacherTrackId: formattedSubs[0]?.substituteTeacherTrackId || '',
      substituteTeacherName: formattedSubs.map(s => s.substituteTeacherName).filter(Boolean).join(', '),
      history: [{
        action: isDraft ? 'draft_created' : 'applied',
        actorId: teacher.trackId,
        actorName: teacher.fullName || teacher.name,
        actorRole: 'teacher',
        at: new Date(),
        comment: isDraft ? 'Saved leave application draft' : `Submitted leave application (${lopSplit.splitDescription})`
      }]
    });

    // Notify approver and substitutes if submitted
    if (!isDraft) {
      if (initialStatus === 'pending_principal') {
        // Notify Principal (isPrincipal special, fallback to Sudo Admin)
        let principalTeacher = await M.Teacher.findOne({
          'specials.option': 'isPrincipal'
        }).lean();
        if (!principalTeacher) {
          principalTeacher = await M.Teacher.findOne({
            'specials.option': 'isAdmin',
            pageRights: {
              $elemMatch: {
                page: '*',
                accessRole: 'sudoAdmin',
                scope: 'institution',
                enabled: { $ne: false }
              }
            }
          }).lean();
        }
        let principalUser = null;
        if (principalTeacher) {
          principalUser = await M.User.findOne({
            $or: [{ trackId: principalTeacher.trackId }, { username: principalTeacher.username }]
          }).lean();
        }
        if (principalUser) {
          await M.Notification.create({
            type: 'leave-request',
            from: teacher.fullName || teacher.name,
            fromRole: 'hod',
            toUserId: principalUser._id,
            message: `HOD ${teacher.fullName} submitted a leave request (${fromDate} to ${effectiveToDate}) awaiting your final approval.`,
            priority: isEmergency ? 'High' : 'Normal',
            time: new Date()
          }).catch(() => {});
        }
      } else {
        // Notify HOD (T11 lookup)
        const deptFilters = [];
        if (teacher.deptId) deptFilters.push({ deptId: teacher.deptId });
        if (teacher.deptCode) deptFilters.push({ deptCode: teacher.deptCode });
        if (teacher.department) deptFilters.push({ department: new RegExp(`^${teacher.department.trim()}$`, 'i') });
        const hodTeacher = await M.Teacher.findOne({
          'specials.option': { $in: ['isHod', 'isHOD'] },
          $or: deptFilters
        }).lean();

        if (hodTeacher) {
          await M.Notification.create({
            type: 'leave-request',
            from: teacher.fullName || teacher.name,
            fromRole: 'teacher',
            toTeacherId: hodTeacher._id,
            toTeacherTrackId: hodTeacher.trackId,
            toTeacherName: hodTeacher.fullName || hodTeacher.name,
            message: `${teacher.fullName} submitted a leave request (${fromDate} to ${effectiveToDate}) with ${formattedSubs.length} substitutions.`,
            priority: isEmergency ? 'High' : 'Normal',
            time: new Date()
          }).catch(() => {});
        }
      }

      // Notify each substitute requested
      for (const sub of formattedSubs) {
        if (sub.substituteTeacherTrackId) {
          await M.Notification.create({
            type: 'substitution-request',
            from: teacher.fullName || teacher.name,
            fromRole: 'teacher',
            toTeacherTrackId: sub.substituteTeacherTrackId,
            message: `${teacher.fullName} requested you as substitute on ${sub.date} (Period ${sub.periodNumber}, ${sub.className}).`,
            priority: isEmergency ? 'High' : 'Normal',
            time: new Date()
          }).catch(() => {});
        }
      }
    }

    await logAction(
      teacher.trackId || teacher._id,
      teacher.fullName || teacher.name,
      'teacher',
      isDraft ? 'Faculty Leave Draft Saved' : 'Faculty Leave Applied',
      `${isDraft ? 'Saved draft' : 'Applied'} for ${leaveType} from ${fromDate} to ${effectiveToDate}`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId,
      { requestId: leaveReq.requestId, daysCount, lopDays: lopSplit.lopDays }
    );

    res.status(201).json({ ok: true, leaveRequest: leaveReq, lopSplit });
  } catch (err) {
    console.error('Faculty leave application error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leave/faculty/pending — Get faculty leaves pending review for HOD or Principal
router.get('/faculty/pending', authMiddleware, async (req, res) => {
  try {
    const isPrincipal = isSudoAdmin(req.user) || req.user.isPrincipal;
    const filter = {};

    if (isPrincipal) {
      filter.status = { $in: ['pending_principal', 'Pending'] };
      if (req.query.deptCode) {
        filter.deptCode = String(req.query.deptCode).toUpperCase();
      }
    } else if (req.user.isHod) {
      filter.status = { $in: ['pending_hod', 'Pending'] };
      filter.escalationLevel = 'hod';
      if (req.user.deptCode) {
        filter.deptCode = String(req.user.deptCode).toUpperCase();
      }
    } else {
      return res.status(403).json({ error: 'HOD or Principal privileges required' });
    }

    const pendingRequests = await M.TeacherLeaveRequest.find(filter)
      .sort({ isEmergency: -1, createdAt: -1 })
      .lean();

    res.json({ ok: true, requests: pendingRequests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leave/faculty/:id — Get details of a single faculty leave request
router.get('/faculty/:id', authMiddleware, async (req, res) => {
  try {
    const leaveReq = await M.TeacherLeaveRequest.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { requestId: req.params.id }
      ].filter(Boolean)
    }).lean();

    if (!leaveReq) {
      return res.status(404).json({ error: 'Faculty leave request not found' });
    }

    res.json({ ok: true, leaveRequest: leaveReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leave/faculty/:id — Update draft or returned faculty leave request
router.put('/faculty/:id', authMiddleware, async (req, res) => {
  try {
    const leaveReq = await M.TeacherLeaveRequest.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { requestId: req.params.id }
      ].filter(Boolean)
    });

    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });
    if (leaveReq.teacherTrackId !== req.user.trackId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to edit this request' });
    }
    if (!['draft', 'returned'].includes(leaveReq.status)) {
      return res.status(400).json({ error: `Cannot edit request in status: ${leaveReq.status}` });
    }

    const {
      leaveType,
      coverage,
      periods,
      fromDate,
      toDate,
      reason,
      isEmergency,
      actingAdvisor,
      actingHod,
      document,
      substitutions
    } = req.body;

    if (fromDate) leaveReq.fromDate = fromDate;
    if (toDate) leaveReq.toDate = toDate;
    const effectiveToDate = leaveReq.toDate || leaveReq.fromDate;
    const dates = getDatesInRange(leaveReq.fromDate, effectiveToDate);
    leaveReq.dates = dates;

    if (coverage) leaveReq.coverage = coverage;
    if (periods) leaveReq.periods = Array.isArray(periods) ? periods.map(Number) : [];
    if (reason) leaveReq.reason = reason.trim();
    if (typeof isEmergency === 'boolean') leaveReq.isEmergency = isEmergency;
    if (leaveType) leaveReq.leaveType = leaveType;

    // Recalculate daysCount
    let daysCount = dates.length;
    if (leaveReq.coverage === 'periods') daysCount = 0;
    else if (leaveReq.coverage === 'fn' || leaveReq.coverage === 'an') daysCount = 0.5 * dates.length;
    leaveReq.daysCount = daysCount;

    // Recalculate balanceBreakdown
    const balanceInfo = await calculateFacultyLeaveBalance({
      teacherTrackId: leaveReq.teacherTrackId,
      deptCode: leaveReq.deptCode
    });
    let availableBalance = 0;
    const normType = String(leaveReq.leaveType).toLowerCase();
    if (normType.includes('casual') || normType === 'cl') availableBalance = balanceInfo.balances.casualLeave.available;
    else if (normType.includes('med') || normType === 'ml') availableBalance = balanceInfo.balances.medicalLeave.available;
    else if (normType.includes('earned') || normType === 'el') availableBalance = balanceInfo.balances.earnedLeave.available;

    const lopSplit = calculateLOPSplit({
      leaveType: leaveReq.leaveType,
      requestedDays: daysCount,
      availableBalance
    });
    leaveReq.balanceBreakdown = {
      leaveType: lopSplit.leaveType,
      requestedDays: lopSplit.requestedDays,
      available: lopSplit.available,
      coveredByLeave: lopSplit.coveredByLeave,
      lopDays: lopSplit.lopDays
    };

    if (actingAdvisor !== undefined) leaveReq.actingAdvisor = actingAdvisor;
    if (actingHod !== undefined) leaveReq.actingHod = actingHod;
    if (document !== undefined) leaveReq.document = document;
    if (substitutions !== undefined) leaveReq.substitutions = substitutions;

    leaveReq.history.push({
      action: 'draft_updated',
      actorId: req.user.trackId || String(req.user._id),
      actorName: req.user.fullName || req.user.name,
      actorRole: 'teacher',
      at: new Date(),
      comment: 'Updated draft details'
    });

    await leaveReq.save();
    res.json({ ok: true, message: 'Draft updated successfully', leaveRequest: leaveReq, lopSplit });
  } catch (err) {
    console.error('Update faculty leave draft error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leave/faculty/:id/submit — Submit draft leave request
router.post('/faculty/:id/submit', authMiddleware, async (req, res) => {
  try {
    const leaveReq = await M.TeacherLeaveRequest.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { requestId: req.params.id }
      ].filter(Boolean)
    });

    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });
    if (leaveReq.teacherTrackId !== req.user.trackId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to submit this request' });
    }
    if (!['draft', 'returned'].includes(leaveReq.status)) {
      return res.status(400).json({ error: `Cannot submit request in status: ${leaveReq.status}` });
    }

    const isHod = req.user.isHod || (Array.isArray(req.user.specials) && req.user.specials.some(s => s.option === 'isHod'));
    leaveReq.status = isHod ? 'pending_principal' : 'pending_hod';
    leaveReq.escalationLevel = isHod ? 'principal' : 'hod';

    leaveReq.history.push({
      action: 'submitted',
      actorId: req.user.trackId || String(req.user._id),
      actorName: req.user.fullName || req.user.name,
      actorRole: 'teacher',
      at: new Date(),
      comment: 'Submitted leave request'
    });

    await leaveReq.save();
    res.json({ ok: true, message: 'Leave request submitted successfully', leaveRequest: leaveReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leave/faculty/:id/withdraw — Withdraw/cancel faculty leave
router.post('/faculty/:id/withdraw', authMiddleware, async (req, res) => {
  try {
    const leaveReq = await M.TeacherLeaveRequest.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { requestId: req.params.id }
      ].filter(Boolean)
    });

    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });
    if (leaveReq.teacherTrackId !== req.user.trackId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to withdraw this request' });
    }

    leaveReq.status = 'withdrawn';
    // Release any substitutions
    for (const sub of (leaveReq.substitutions || [])) {
      sub.status = 'released';
    }

    // Cancel acting roles if created
    await M.ActingRole.updateMany(
      { sourceLeaveId: leaveReq.requestId || String(leaveReq._id) },
      { $set: { status: 'cancelled' } }
    );

    leaveReq.history.push({
      action: 'withdrawn',
      actorId: req.user.trackId || String(req.user._id),
      actorName: req.user.fullName || req.user.name,
      actorRole: 'teacher',
      at: new Date(),
      comment: 'Withdrawn by applicant'
    });

    await leaveReq.save();
    res.json({ ok: true, message: 'Leave request withdrawn', leaveRequest: leaveReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leave/faculty/:id/hod-permit — HOD permits / recommends faculty leave to Principal
router.post('/faculty/:id/hod-permit', authMiddleware, async (req, res) => {
  try {
    if (!req.user.isHod && !req.user.isAdmin) {
      return res.status(403).json({ error: 'HOD or Admin authorization required' });
    }

    const leaveReq = await M.TeacherLeaveRequest.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { requestId: req.params.id }
      ].filter(Boolean)
    });

    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });
    if (!['pending_hod', 'Pending'].includes(leaveReq.status)) {
      return res.status(400).json({ error: `Cannot permit request in status: ${leaveReq.status}` });
    }

    const comment = sanitizeToString(req.body.comment || req.body.remarks || 'Permitted by HOD');
    leaveReq.status = 'pending_principal';
    leaveReq.escalationLevel = 'principal';
    leaveReq.hodStatus = 'Permitted';
    leaveReq.hodReviewedBy = req.user.fullName || req.user.name;
    leaveReq.hodReviewedAt = new Date();
    leaveReq.hodRemarks = comment;

    leaveReq.history.push({
      action: 'hod_permitted',
      actorId: req.user.trackId || String(req.user._id),
      actorName: req.user.fullName || req.user.name,
      actorRole: 'hod',
      at: new Date(),
      comment
    });

    await leaveReq.save();

    // Notify Principal
    await M.Notification.create({
      type: 'leave-request',
      from: req.user.fullName || req.user.name,
      fromRole: 'hod',
      message: `HOD endorsed faculty leave for ${leaveReq.teacherName} (${leaveReq.fromDate} to ${leaveReq.toDate}). Awaiting your final approval.`,
      priority: leaveReq.isEmergency ? 'High' : 'Normal',
      time: new Date()
    }).catch(() => {});

    await logAction(
      req.user.trackId || req.user._id,
      req.user.fullName || req.user.name,
      'hod',
      'Faculty Leave Permitted',
      `Permitted leave for ${leaveReq.teacherName} (${leaveReq.fromDate} to ${leaveReq.toDate})`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId,
      { requestId: leaveReq.requestId, teacherTrackId: leaveReq.teacherTrackId }
    );

    res.json({ ok: true, message: 'Leave permitted and forwarded to Principal', leaveRequest: leaveReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leave/faculty/:id/hod-reject — HOD rejects faculty leave
router.post('/faculty/:id/hod-reject', authMiddleware, async (req, res) => {
  try {
    if (!req.user.isHod && !req.user.isAdmin) {
      return res.status(403).json({ error: 'HOD or Admin authorization required' });
    }

    const reason = sanitizeToString(req.body.reason || req.body.remarks);
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const leaveReq = await M.TeacherLeaveRequest.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { requestId: req.params.id }
      ].filter(Boolean)
    });

    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });

    leaveReq.status = 'rejected';
    leaveReq.hodStatus = 'Rejected';
    leaveReq.hodReviewedBy = req.user.fullName || req.user.name;
    leaveReq.hodReviewedAt = new Date();
    leaveReq.hodRemarks = reason.trim();

    // Release substitutions
    for (const sub of (leaveReq.substitutions || [])) {
      sub.status = 'released';
    }

    leaveReq.history.push({
      action: 'hod_rejected',
      actorId: req.user.trackId || String(req.user._id),
      actorName: req.user.fullName || req.user.name,
      actorRole: 'hod',
      at: new Date(),
      comment: reason.trim()
    });

    await leaveReq.save();

    // Notify teacher
    await M.Notification.create({
      type: 'leave-rejection',
      from: req.user.fullName || req.user.name,
      fromRole: 'hod',
      toTeacherTrackId: leaveReq.teacherTrackId,
      message: `Your leave request (${leaveReq.fromDate} to ${leaveReq.toDate}) was rejected by HOD: "${reason.trim()}".`,
      priority: 'High',
      time: new Date()
    }).catch(() => {});

    res.json({ ok: true, message: 'Leave rejected by HOD', leaveRequest: leaveReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leave/faculty/:id/hod-return — HOD returns faculty leave for correction
router.post('/faculty/:id/hod-return', authMiddleware, async (req, res) => {
  try {
    if (!req.user.isHod && !req.user.isAdmin) {
      return res.status(403).json({ error: 'HOD or Admin authorization required' });
    }

    const note = sanitizeToString(req.body.note || req.body.remarks || 'Returned for correction');
    const leaveReq = await M.TeacherLeaveRequest.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { requestId: req.params.id }
      ].filter(Boolean)
    });

    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });

    leaveReq.status = 'returned';
    leaveReq.hodStatus = 'Returned';
    leaveReq.hodRemarks = note;

    leaveReq.history.push({
      action: 'hod_returned',
      actorId: req.user.trackId || String(req.user._id),
      actorName: req.user.fullName || req.user.name,
      actorRole: 'hod',
      at: new Date(),
      comment: note
    });

    await leaveReq.save();

    // Notify teacher
    await M.Notification.create({
      type: 'leave-returned',
      from: req.user.fullName || req.user.name,
      fromRole: 'hod',
      toTeacherTrackId: leaveReq.teacherTrackId,
      message: `Your leave request (${leaveReq.fromDate} to ${leaveReq.toDate}) was returned for correction: "${note}".`,
      priority: 'Normal',
      time: new Date()
    }).catch(() => {});

    res.json({ ok: true, message: 'Leave request returned for correction', leaveRequest: leaveReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leave/faculty/:id/principal-approve — Principal final approval (LD9: Overrides written & roles activated only now)
router.post('/faculty/:id/principal-approve', authMiddleware, async (req, res) => {
  try {
    const isPrincipal = isSudoAdmin(req.user) || req.user.isPrincipal;
    if (!isPrincipal) {
      return res.status(403).json({ error: 'Principal or Admin authorization required' });
    }

    const leaveReq = await M.TeacherLeaveRequest.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { requestId: req.params.id }
      ].filter(Boolean)
    });

    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });

    leaveReq.status = 'approved';
    leaveReq.principalStatus = 'Approved';
    leaveReq.principalReviewedBy = req.user.fullName || req.user.name;
    leaveReq.principalReviewedAt = new Date();
    leaveReq.principalRemarks = sanitizeToString(req.body.remarks || 'Approved by Principal');

    // 1. Confirm all substitutions and write Override documents
    let overridesCreated = 0;
    for (const sub of (leaveReq.substitutions || [])) {
      if (!sub.substituteTeacherTrackId) continue;
      sub.status = 'confirmed';

      const subDateStr = sub.date ? String(sub.date).slice(0, 10) : '';
      if (!subDateStr) continue;
      const subUtcDate = new Date(subDateStr + 'T00:00:00.000Z');
      const periodNum = Number(sub.periodNumber);

      const originalSlot = buildOverrideSlot({
        teacher: leaveReq.teacherName,
        teacherTrackId: leaveReq.teacherTrackId,
        teacherId: leaveReq.teacherId,
        subject: sub.subjectName,
        room: sub.hallNo
      });
      const newSlot = buildOverrideSlot({
        teacher: sub.substituteTeacherName,
        teacherTrackId: sub.substituteTeacherTrackId,
        teacherId: sub.substituteTeacherId,
        subject: sub.subjectName,
        room: sub.hallNo
      });

      await M.Override.findOneAndUpdate(
        {
          classId: sub.classId,
          date: subUtcDate,
          $or: [{ period: periodNum }, { periodNumber: periodNum }]
        },
        {
          classId: sub.classId,
          date: subUtcDate,
          period: periodNum,
          periodNumber: periodNum,
          type: 'substitute',
          originalSlot,
          newSlot,
          reason: `Faculty Leave Substitution: ${leaveReq.teacherName} on ${leaveReq.fromDate}–${leaveReq.toDate}`,
          approvedBy: req.user.fullName || req.user.name,
          requestId: leaveReq.requestId || String(leaveReq._id),
          source: {
            type: leaveReq.isEmergency ? 'EMERGENCY' : 'FACULTY_LEAVE',
            requestId: leaveReq.requestId || String(leaveReq._id)
          },
          status: 'confirmed',
          assignedBy: {
            trackId: req.user.trackId || String(req.user._id),
            role: 'principal'
          },
          originalTeacher: {
            trackId: leaveReq.teacherTrackId,
            name: leaveReq.teacherName
          },
          substituteTeacher: {
            trackId: sub.substituteTeacherTrackId,
            name: sub.substituteTeacherName
          }
        },
        { upsert: true, returnDocument: 'after' }
      );
      overridesCreated++;
    }

    // 2. Activate Acting Roles if appointed
    if (leaveReq.actingAdvisor?.teacherTrackId) {
      await M.ActingRole.create({
        role: 'advisor',
        key: String(leaveReq.actingAdvisor.classId || ''),
        holderTrackId: leaveReq.actingAdvisor.teacherTrackId,
        appointedBy: leaveReq.teacherTrackId,
        from: leaveReq.fromDate,
        to: leaveReq.toDate,
        sourceLeaveId: leaveReq.requestId || String(leaveReq._id),
        status: 'pending'
      });
    }

    if (leaveReq.actingHod?.teacherTrackId) {
      await M.ActingRole.create({
        role: 'hod',
        key: String(leaveReq.actingHod.deptCode || leaveReq.deptCode || '').toUpperCase(),
        holderTrackId: leaveReq.actingHod.teacherTrackId,
        appointedBy: leaveReq.teacherTrackId,
        from: leaveReq.fromDate,
        to: leaveReq.toDate,
        sourceLeaveId: leaveReq.requestId || String(leaveReq._id),
        status: 'pending'
      });
    }

    // Sync acting roles immediately for today's active date
    await syncActingRoles();

    leaveReq.history.push({
      action: 'principal_approved',
      actorId: req.user.trackId || String(req.user._id),
      actorName: req.user.fullName || req.user.name,
      actorRole: 'principal',
      at: new Date(),
      comment: `Final approval granted. ${overridesCreated} timetable override(s) activated.`
    });

    await leaveReq.save();

    // 3. Dispatch notifications
    // Notify Applicant
    await M.Notification.create({
      type: 'leave-approval',
      from: req.user.fullName || req.user.name,
      fromRole: 'principal',
      toTeacherTrackId: leaveReq.teacherTrackId,
      message: `Your ${leaveReq.leaveType} (${leaveReq.fromDate} to ${leaveReq.toDate}) has been APPROVED by Principal.`,
      priority: 'Normal',
      time: new Date()
    }).catch(() => {});

    // Notify Substitutes
    for (const sub of (leaveReq.substitutions || [])) {
      if (sub.substituteTeacherTrackId) {
        await M.Notification.create({
          type: 'substitution-confirmed',
          from: req.user.fullName || req.user.name,
          fromRole: 'principal',
          toTeacherTrackId: sub.substituteTeacherTrackId,
          message: `Substitution CONFIRMED for ${leaveReq.teacherName} on ${sub.date} (Period ${sub.periodNumber}, ${sub.className}). You are authorised to take attendance.`,
          priority: 'Normal',
          time: new Date()
        }).catch(() => {});
      }
    }

    await logAction(
      req.user.trackId || req.user._id,
      req.user.fullName || req.user.name,
      'principal',
      'Faculty Leave Approved',
      `Principal approved faculty leave for ${leaveReq.teacherName} (${leaveReq.fromDate} to ${leaveReq.toDate}). ${overridesCreated} overrides written.`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId,
      { requestId: leaveReq.requestId, overridesCreated }
    );

    res.json({ ok: true, message: 'Faculty leave approved by Principal', leaveRequest: leaveReq, overridesCreated });
  } catch (err) {
    console.error('Principal approval error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leave/faculty/:id/principal-reject — Principal rejects faculty leave
router.post('/faculty/:id/principal-reject', authMiddleware, async (req, res) => {
  try {
    const isPrincipal = isSudoAdmin(req.user) || req.user.isPrincipal;
    if (!isPrincipal) {
      return res.status(403).json({ error: 'Principal or Admin authorization required' });
    }

    const reason = sanitizeToString(req.body.reason || req.body.remarks);
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const leaveReq = await M.TeacherLeaveRequest.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined },
        { requestId: req.params.id }
      ].filter(Boolean)
    });

    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });

    leaveReq.status = 'rejected';
    leaveReq.principalStatus = 'Rejected';
    leaveReq.principalReviewedBy = req.user.fullName || req.user.name;
    leaveReq.principalReviewedAt = new Date();
    leaveReq.principalRemarks = reason.trim();

    // Release substitutions
    for (const sub of (leaveReq.substitutions || [])) {
      sub.status = 'released';
    }

    // Cancel acting roles
    await M.ActingRole.updateMany(
      { sourceLeaveId: leaveReq.requestId || String(leaveReq._id) },
      { $set: { status: 'cancelled' } }
    );

    leaveReq.history.push({
      action: 'principal_rejected',
      actorId: req.user.trackId || String(req.user._id),
      actorName: req.user.fullName || req.user.name,
      actorRole: 'principal',
      at: new Date(),
      comment: reason.trim()
    });

    await leaveReq.save();

    // Notify teacher & HOD
    await M.Notification.create({
      type: 'leave-rejection',
      from: req.user.fullName || req.user.name,
      fromRole: 'principal',
      toTeacherTrackId: leaveReq.teacherTrackId,
      message: `Your leave request (${leaveReq.fromDate} to ${leaveReq.toDate}) was rejected by Principal: "${reason.trim()}".`,
      priority: 'High',
      time: new Date()
    }).catch(() => {});

    res.json({ ok: true, message: 'Leave rejected by Principal', leaveRequest: leaveReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leave/faculty/emergency — Fast-track Emergency Faculty Leave
router.post('/faculty/emergency', authMiddleware, async (req, res) => {
  req.body.isEmergency = true;
  return router.handle(req, res);
});

// ─────────────────────────────────────────────────────────────
// LEGACY COMPATIBILITY HANDLERS
// ─────────────────────────────────────────────────────────────

// GET /api/leave/teacher/pending-hod — List teacher leave requests awaiting HOD
router.get('/teacher/pending-hod', authMiddleware, async (req, res) => {
  try {
    if (!req.user.isHod && !req.user.isAdmin) {
      return res.status(403).json({ error: 'HOD or Admin authorization required' });
    }
    const filter = { status: { $in: ['Pending', 'pending_hod'] }, escalationLevel: 'hod' };
    if (req.user.deptId && !req.user.isAdmin) {
      filter.deptId = req.user.deptId;
    }
    const requests = await M.TeacherLeaveRequest.find(filter)
      .sort({ createdAt: -1 })
      .lean();
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leave/teacher/:id/hod-approve — Alias to HOD permit / approve
router.put('/teacher/:id/hod-approve', authMiddleware, async (req, res) => {
  try {
    if (!req.user.isHod && !req.user.isAdmin) {
      return res.status(403).json({ error: 'HOD or Admin authorization required' });
    }
    const leaveReq = await M.TeacherLeaveRequest.findById(req.params.id);
    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });

    leaveReq.status = 'pending_principal';
    leaveReq.escalationLevel = 'principal';
    leaveReq.hodStatus = 'Approved';
    leaveReq.hodReviewedBy = req.user.fullName || req.user.name;
    leaveReq.hodReviewedAt = new Date();
    await leaveReq.save();

    res.json({ success: true, message: 'Leave endorsed and forwarded to Principal.', leaveRequest: leaveReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leave/teacher/:id/hod-reject — HOD rejects leave
router.put('/teacher/:id/hod-reject', authMiddleware, async (req, res) => {
  try {
    if (!req.user.isHod && !req.user.isAdmin) {
      return res.status(403).json({ error: 'HOD or Admin authorization required' });
    }
    const leaveReq = await M.TeacherLeaveRequest.findById(req.params.id);
    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });

    const remarks = (req.body.remarks || '').trim();
    leaveReq.status = 'Rejected';
    leaveReq.hodStatus = 'Rejected';
    leaveReq.hodReviewedBy = req.user.fullName || req.user.name;
    leaveReq.hodReviewedAt = new Date();
    leaveReq.hodRemarks = remarks;
    await leaveReq.save();

    res.json({ success: true, message: 'Leave rejected.', leaveRequest: leaveReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
