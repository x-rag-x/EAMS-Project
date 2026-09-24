const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { checkModuleGuard } = require('../middleware/portalGuard');

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

    // Retrieve all requests for calculating KPI stats
    const allRequests = await M.LeaveRequest.find(baseFilter).sort({ createdAt: -1 }).lean();

    const stats = {
      total: allRequests.length,
      approved: allRequests.filter(r => r.status === 'Approved').length,
      rejected: allRequests.filter(r => r.status === 'Rejected').length,
      pending: allRequests.filter(r => r.status === 'Pending').length,
      cancelled: allRequests.filter(r => r.status === 'Cancelled').length,
      onDutyCount: allRequests.filter(r => r.category === 'Permission' || (r.slot && r.slot !== 'Full Day')).length,
      totalApprovedDays: allRequests
        .filter(r => r.status === 'Approved')
        .reduce((sum, r) => sum + (r.daysCount || (r.category === 'Permission' ? 0.5 : 1)), 0)
    };

    // Filter by criteria
    let filtered = allRequests;
    const fromDate = sanitizeToString(req.query.from);
    const toDate = sanitizeToString(req.query.to);
    const category = sanitizeToString(req.query.category);
    const status = sanitizeToString(req.query.status);
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
    if (status) {
      filtered = filtered.filter(r => r.status === status);
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
    const slotType = sanitizeToString(req.query.slot) || 'Full Day';
    let targetPeriods = [];
    if (req.query.periods) {
      targetPeriods = Array.isArray(req.query.periods) 
        ? req.query.periods.map(Number) 
        : String(req.query.periods).split(',').map(Number);
    }
    if (slotType === 'FN' && targetPeriods.length === 0) targetPeriods = [1, 2, 3, 4];
    if (slotType === 'AN' && targetPeriods.length === 0) targetPeriods = [5, 6, 7, 8, 9];

    let teacherTrackId = req.user.trackId;
    if (req.user.role === 'admin' && req.query.teacherTrackId) {
      teacherTrackId = sanitizeToString(req.query.teacherTrackId);
    }
    if (!teacherTrackId) {
      return res.status(400).json({ error: 'Teacher trackId required' });
    }

    const teacher = await M.Teacher.findOne({
      $or: [{ trackId: teacherTrackId }, { _id: mongoose.isValidObjectId(req.user._id) ? req.user._id : undefined }]
    }).lean();

    const teacherNames = [teacher?.fullName, teacher?.name, req.user.name, req.user.fullName].filter(Boolean);

    const dates = getDatesInRange(fromDate, toDate);
    const affectedSlots = [];

    for (const dateStr of dates) {
      const dObj = new Date(dateStr + 'T00:00:00.000Z');
      const dowIndex = dObj.getUTCDay();
      if (dowIndex === 0) continue; // Skip Sunday

      const dayAbbr = DAY_ABBR_MAP_LEAVE[dowIndex];
      const dayFull = DAY_FULL_MAP_LEAVE[dowIndex];

      // Check Academic Calendar: if day is declared leave/holiday, no classes run
      const calDay = await M.CalendarDay.findOne({
        $or: [
          { date: new Date(dateStr + 'T00:00:00.000Z') },
          { date: new Date(dateStr + 'T00:00:00') }
        ]
      }).lean();

      if (calDay && calDay.details && calDay.details.some(d => d.dayType === 'leave')) {
        continue;
      }

      // 1. Query live Timetable slots for this teacher
      const liveSlots = await M.Timetable.find({
        $or: [
          { trackId: teacherTrackId },
          { teacherName: { $in: teacherNames } }
        ],
        day: dayAbbr,
        isDraft: false
      }).lean();

      // 2. Query Day Overrides for this date to avoid already-cancelled slots
      const dayOverrides = await M.TimetableDayOverride.find({
        date: dateStr,
        status: 'active'
      }).lean();

      for (const slot of liveSlots) {
        const pNum = slot.periodNumber || slot.startPeriod || 1;
        if (targetPeriods.length > 0 && !targetPeriods.includes(pNum)) {
          continue;
        }

        // Check if overridden on this specific day
        const overrideForClass = dayOverrides.find(o => String(o.classId) === String(slot.classId));
        const overrideItem = overrideForClass?.overrides?.find(ov => ov.periodNumber === pNum);
        if (overrideItem && overrideItem.action === 'cancel') {
          continue; // Cancelled period
        }

        affectedSlots.push({
          date: dateStr,
          day: dayFull,
          periodNumber: pNum,
          span: slot.span || 1,
          classId: slot.classId,
          className: slot.className,
          subjectId: slot.subjectId,
          subjectName: slot.subjectName,
          hallNo: slot.hallNo || '',
          start: slot.start,
          end: slot.end,
          timingSetName: slot.timingSetName || '',
          slotKey: `${dayFull}_${pNum}`,
          currentSubstitute: overrideItem?.substituteTeacherName || ''
        });
      }
    }

    // Sort by date ascending, then period ascending
    affectedSlots.sort((a, b) => a.date.localeCompare(b.date) || a.periodNumber - b.periodNumber);

    res.json({
      teacherTrackId,
      teacherName: teacher?.fullName || req.user.name,
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

    // Validate substitutions list
    const validSubs = [];
    if (Array.isArray(substitutions)) {
      for (const s of substitutions) {
        if (!s.substituteTeacherTrackId || !s.substituteTeacherName) continue;
        validSubs.push({
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

    // Notify HOD
    if (teacher.deptId) {
      const hodTeacher = await M.Teacher.findOne({
        deptId: teacher.deptId,
        'specials.option': 'isHOD'
      }).lean();

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

// GET /api/leave/teacher/my-requests — Teacher's own leave requests
router.get('/teacher/my-requests', authMiddleware, async (req, res) => {
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
// PLAN 4 (FEATURE 6) ADDENDUM: HOD APPROVAL WORKFLOW
// ─────────────────────────────────────────────────────────────

// GET /api/leave/teacher/pending-hod — List teacher leave requests awaiting HOD
router.get('/teacher/pending-hod', authMiddleware, async (req, res) => {
  try {
    if (!req.user.isHod && !req.user.isAdmin) {
      return res.status(403).json({ error: 'HOD or Admin authorization required' });
    }
    const filter = { status: 'Pending', escalationLevel: 'hod' };
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

// PUT /api/leave/teacher/:id/hod-approve — HOD approves leave & creates day overrides for substitutions
router.put('/teacher/:id/hod-approve', authMiddleware, async (req, res) => {
  try {
    if (!req.user.isHod && !req.user.isAdmin) {
      return res.status(403).json({ error: 'HOD or Admin authorization required' });
    }
    const leaveReq = await M.TeacherLeaveRequest.findById(req.params.id);
    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });
    if (leaveReq.status !== 'Pending') {
      return res.status(400).json({ error: 'Request is not in Pending state' });
    }
    if (leaveReq.escalationLevel !== 'hod') {
      return res.status(400).json({ error: 'This request does not require HOD approval' });
    }

    leaveReq.status = 'Approved';
    leaveReq.hodStatus = 'Approved';
    leaveReq.hodReviewedBy = req.user.fullName || req.user.name;
    leaveReq.hodReviewedAt = new Date();
    await leaveReq.save();

    // For each substitution, create a TimetableDayOverride (action: 'substitute')
    let overridesCreated = 0;
    for (const sub of leaveReq.substitutions || []) {
      try {
        const overrideDoc = await M.TimetableDayOverride.findOneAndUpdate(
          { classId: sub.classId, date: sub.date },
          {
            classId: sub.classId,
            className: sub.className,
            deptId: leaveReq.deptId,
            date: sub.date,
            day: sub.day,
            isHoliday: false,
            overrides: [{
              periodNumber: sub.periodNumber,
              action: 'substitute',
              substituteTeacherName: sub.substituteTeacherName,
              substituteTeacherId: sub.substituteTeacherId,
              reason: `Leave substitution: ${leaveReq.teacherName} on ${leaveReq.fromDate}–${leaveReq.toDate}`
            }],
            status: 'active',
            updatedBy: req.user.name
          },
          { upsert: true, returnDocument: 'after' }
        );
        overridesCreated++;
      } catch (e) {
        console.error(`Failed to create override for sub ${sub.substituteTeacherName}:`, e.message);
      }
    }

    // Notify the substitute(s)
    const substituteTrackIds = [...new Set(leaveReq.substitutions?.map(s => s.substituteTeacherTrackId) || [])];
    for (const subTrackId of substituteTrackIds) {
      const subTeacher = await M.Teacher.findOne({ trackId: subTrackId }).lean();
      if (subTeacher) {
        await M.Notification.create({
          type: 'leave-substitution',
          from: req.user.fullName || req.user.name,
          fromRole: 'HOD',
          toTeacherId: subTeacher._id,
          toTeacherTrackId: subTeacher.trackId,
          toTeacherName: subTeacher.fullName || subTeacher.name,
          message: `You've been assigned as substitute for ${leaveReq.teacherName} (${leaveReq.fromDate}–${leaveReq.toDate}). Class: ${leaveReq.substitutions[0]?.className || 'N/A'}`,
          priority: 'Normal',
          time: new Date()
        }).catch(() => {});
      }
    }

    // Notify the applicant
    await M.Notification.create({
      type: 'leave-approval',
      from: req.user.fullName || req.user.name,
      fromRole: 'HOD',
      toTeacherId: leaveReq.teacherId,
      toTeacherTrackId: leaveReq.teacherTrackId,
      toTeacherName: leaveReq.teacherName,
      message: `Your ${leaveReq.category} request (${leaveReq.fromDate}–${leaveReq.toDate}) has been approved by HOD. ${overridesCreated} substitution override(s) created.`,
      priority: 'Normal',
      time: new Date()
    }).catch(() => {});

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Teacher Leave HOD Approved',
      `Approved leave for ${leaveReq.teacherName} (${leaveReq.fromDate}–${leaveReq.toDate}). ${overridesCreated} overrides created.`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'teacher', subType: 'leave-hod-approve', leaveRequestId: leaveReq._id, overridesCreated }
    );

    res.json({ success: true, message: 'Leave approved. Substitution overrides created.', leaveRequest: leaveReq, overridesCreated });
  } catch (err) {
    console.error('HOD approve error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leave/teacher/:id/hod-reject — HOD rejects leave, no timetable changes
router.put('/teacher/:id/hod-reject', authMiddleware, async (req, res) => {
  try {
    if (!req.user.isHod && !req.user.isAdmin) {
      return res.status(403).json({ error: 'HOD or Admin authorization required' });
    }
    const leaveReq = await M.TeacherLeaveRequest.findById(req.params.id);
    if (!leaveReq) return res.status(404).json({ error: 'Leave request not found' });
    if (leaveReq.status !== 'Pending') {
      return res.status(400).json({ error: 'Request is not in Pending state' });
    }
    if (leaveReq.escalationLevel !== 'hod') {
      return res.status(400).json({ error: 'This request does not require HOD approval' });
    }

    const remarks = (req.body.remarks || '').trim();
    leaveReq.status = 'Rejected';
    leaveReq.hodStatus = 'Rejected';
    leaveReq.hodReviewedBy = req.user.fullName || req.user.name;
    leaveReq.hodReviewedAt = new Date();
    leaveReq.hodRemarks = remarks;
    await leaveReq.save();

    // Notify the applicant
    await M.Notification.create({
      type: 'leave-rejection',
      from: req.user.fullName || req.user.name,
      fromRole: 'HOD',
      toTeacherId: leaveReq.teacherId,
      toTeacherTrackId: leaveReq.teacherTrackId,
      toTeacherName: leaveReq.teacherName,
      message: `Your ${leaveReq.category} request (${leaveReq.fromDate}–${leaveReq.toDate}) has been rejected by HOD. Reason: ${remarks || 'No reason provided'}`,
      priority: 'High',
      time: new Date()
    }).catch(() => {});

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Teacher Leave HOD Rejected',
      `Rejected leave for ${leaveReq.teacherName} (${leaveReq.fromDate}–${leaveReq.toDate}): ${remarks}`,
      'attendance',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'teacher', subType: 'leave-hod-reject', leaveRequestId: leaveReq._id }
    );

    res.json({ success: true, message: 'Leave rejected. No timetable changes.', leaveRequest: leaveReq });
  } catch (err) {
    console.error('HOD reject error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
