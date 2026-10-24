const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { getSettings } = require('../utils/settingsCache');
const { getNextRequestId } = require('../utils/requestIds');
const { resolveStageApprover, recordApprovalHistory } = require('../utils/approvalWorkflow');
const { reconcileOnLeaveApproved, reconcileOnLeaveCancelled, reconcilePeriodOverride } = require('../utils/reconcileAttendance');
const { handleLeaveApprovalReversal } = require('../services/trustDailyService');
const { getTodayIST } = require('../middleware/scope');

router.use(authMiddleware);

// Helper to calculate days between two YYYY-MM-DD dates inclusive
function getDatesInRange(startStr, endStr) {
  const dates = [];
  const curr = new Date(startStr + 'T00:00:00.000Z');
  const end = new Date(endStr + 'T00:00:00.000Z');
  if (isNaN(curr.getTime()) || isNaN(end.getTime()) || curr > end) {
    return [startStr];
  }
  while (curr <= end) {
    dates.push(curr.toISOString().split('T')[0]);
    curr.setUTCDate(curr.getUTCDate() + 1);
  }
  return dates;
}

// ── 1. GET /api/student-leave/me — List logged-in student's own requests ──
router.get('/me', async (req, res) => {
  try {
    const studentTrackId = req.user.trackId;
    if (!studentTrackId) {
      return res.status(400).json({ error: 'Missing student track ID' });
    }

    const requests = await M.StudentLeaveRequest.find({ studentTrackId })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, requests });
  } catch (err) {
    console.error('[Student Leave Me Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve leave requests' });
  }
});

// ── 2. GET /api/student-leave/:id — Request details ──
router.get('/:id', async (req, res) => {
  try {
    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const request = await M.StudentLeaveRequest.findOne(query).lean();
    if (!request) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    // Verify ownership or staff permissions
    const isOwner = req.user.trackId === request.studentTrackId;
    const isStaff = ['teacher', 'admin', 'principal', 'hod'].includes(req.user.role) || req.user.isPrincipal;
    if (!isOwner && !isStaff) {
      return res.status(403).json({ error: 'Unauthorized to view this request' });
    }

    // Retrieve audit timeline history
    const history = await M.ApprovalHistory.find({ requestId: request.requestId }).sort({ at: 1 }).lean();

    return res.json({ ok: true, request, history });
  } catch (err) {
    console.error('[Student Leave Detail Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve leave detail' });
  }
});

// ── 3. POST /api/student-leave — Student submits leave request ──
router.post('/', async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Only students may apply through this endpoint' });
    }

    const student = await M.Student.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.user._id) ? req.user._id : undefined },
        { trackId: req.user.trackId }
      ].filter(Boolean)
    }).lean();

    if (!student) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    const category = sanitizeToString(req.body.category) || 'Personal';
    const fromDate = sanitizeToString(req.body.fromDate);
    const toDate = sanitizeToString(req.body.toDate);
    const coverage = sanitizeToString(req.body.coverage) || 'full_day';
    const periods = Array.isArray(req.body.periods) ? req.body.periods.map(Number) : [];
    const reason = sanitizeToString(req.body.reason);
    const certLink = sanitizeToString(req.body.certificateLink);
    const certDriveId = sanitizeToString(req.body.certificateDriveId);
    const certToFollow = Boolean(req.body.certificateToFollow);

    if (!fromDate || !toDate || !reason) {
      return res.status(400).json({ error: 'From date, to date, and reason are required' });
    }

    const dates = getDatesInRange(fromDate, toDate);
    const todayIST = getTodayIST();
    const settings = await getSettings(['studentLeave']);
    const leaveConfig = settings.studentLeave || {};
    const maxDays = Number(leaveConfig.maxDaysByStudent) || 3;
    const backdateDays = Number(leaveConfig.backdateDays) || 3;
    const certDueDays = Number(leaveConfig.certificateDueDays) || 3;

    // Rule 1: Max 3 days for student application
    let daysCount = dates.length;
    if (coverage === 'fn' || coverage === 'an') {
      daysCount = 0.5 * dates.length;
    }
    if (daysCount > maxDays) {
      return res.status(400).json({
        error: `Students may apply for a maximum of ${maxDays} consecutive days. For longer leaves, please contact your Class Advisor to file on your behalf.`
      });
    }

    // Rule 2: Backdated application check
    if (fromDate < todayIST) {
      if (!['Medical', 'Emergency'].includes(category)) {
        return res.status(400).json({
          error: 'Past dates can only be applied under Medical or Emergency leave categories.'
        });
      }
      const diffMs = new Date(todayIST).getTime() - new Date(fromDate).getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays > backdateDays) {
        return res.status(400).json({
          error: `Backdated leave cannot be applied more than ${backdateDays} days in the past.`
        });
      }
    }

    // Rule 3: Exam dates restriction
    const examSchedules = M.Exam ? await M.Exam.find({ Dates: { $in: dates }, status: { $in: ['upcoming', 'ongoing'] } }).lean() : [];
    if (examSchedules.length > 0 && category !== 'Emergency') {
      return res.status(400).json({
        error: 'Examinations are scheduled on the selected date(s). Only Emergency leave may be applied during exams.'
      });
    }

    // Rule 4: Overlap check with existing active leaves or ODs
    const existingLeave = await M.StudentLeaveRequest.findOne({
      studentTrackId: student.trackId,
      dates: { $in: dates },
      status: { $in: ['Pending', 'Approved'] }
    }).lean();

    if (existingLeave) {
      return res.status(400).json({
        error: `Overlap conflict: You already have a leave request (${existingLeave.requestId || existingLeave._id}) covering these dates.`
      });
    }

    const existingOD = await M.ODRequest.findOne({
      studentTrackId: student.trackId,
      dates: { $in: dates },
      status: { $in: ['pending', 'approved'] }
    }).lean();

    if (existingOD) {
      return res.status(400).json({
        error: `Overlap conflict: You already have an On-Duty (OD) request (${existingOD.requestId}) covering these dates.`
      });
    }

    // Resolve class and Class Advisor
    let cls = null;
    if (student.classId) {
      if (mongoose.isValidObjectId(student.classId)) cls = await M.Class.findById(student.classId).lean();
      if (!cls) cls = await M.Class.findOne({ trackId: student.classId }).lean();
    }
    if (!cls && student.class) {
      cls = await M.Class.findOne({ $or: [{ name: student.class }, { trackId: student.class }] }).lean();
    }

    let advisorTrackId = cls?.advisorTeacherTrackId || '';
    let advisorName = '';
    let advisorId = cls?.advisorTeacherId || null;
    if (cls?.advisorTeacherId) {
      const adv = await M.Teacher.findById(cls.advisorTeacherId, 'trackId fullName name').lean();
      if (adv) {
        advisorTrackId = adv.trackId;
        advisorName = adv.fullName || adv.name;
        advisorId = adv._id;
      }
    }
    if (!advisorTrackId && cls?.advisorTeacherTrackId) {
      const adv = await M.Teacher.findOne({ trackId: cls.advisorTeacherTrackId }, 'trackId fullName name').lean();
      if (adv) {
        advisorTrackId = adv.trackId;
        advisorName = adv.fullName || adv.name;
        advisorId = adv._id;
      }
    }
    if (!advisorTrackId && cls) {
      const adv = await M.Teacher.findOne({
        'specials.option': 'isClassAdvisor',
        $or: [
          { 'specials.key': cls.name },
          { 'specials.key': cls.trackId },
          { 'specials.value': cls.name },
          { 'specials.value': cls.trackId },
          { 'specials.value': true, 'specials.key': cls.name }
        ]
      }, 'trackId fullName name').lean();
      if (adv) {
        advisorTrackId = adv.trackId;
        advisorName = adv.fullName || adv.name;
        advisorId = adv._id;
      }
    }

    // Resolve acting advisor if normal advisor is on leave
    const resolvedAdvisor = await resolveStageApprover({
      stage: 'advisor',
      targetKey: String(cls?._id || student.classId),
      nominalApproverTrackId: advisorTrackId,
      dateStr: todayIST
    });

    const requestId = await getNextRequestId('LV');

    // Certificate handling
    let certObj = { status: 'not_required', dueAt: null };
    if (category === 'Medical') {
      if (certLink || certDriveId) {
        certObj = {
          driveFileId: certDriveId || null,
          webViewLink: certLink || null,
          status: 'uploaded',
          dueAt: null
        };
      } else if (certToFollow) {
        certObj = {
          status: 'to_follow',
          dueAt: new Date(Date.now() + certDueDays * 24 * 60 * 60 * 1000)
        };
      }
    }

    const resolvedStudentName = student.fullName || student.name || req.user.fullName || req.user.name || 'Student';
    const resolvedRegNo = student.registerNo || student.admissionNo || '—';

    const newRequest = await M.StudentLeaveRequest.create({
      requestId,
      studentId: student._id,
      studentTrackId: student.trackId,
      studentName: resolvedStudentName,
      studentRegNo: resolvedRegNo,
      classId: cls?._id || student.classId,
      className: cls?.name || student.class || 'Unknown Class',
      deptId: student.deptId || cls?.deptId || null,
      deptName: student.deptName || '',
      advisorId: advisorId,
      advisorTrackId: resolvedAdvisor.approverTrackId || advisorTrackId,
      advisorName: advisorName,
      category: 'Leave',
      leaveCategory: category,
      slot: coverage === 'full_day' ? 'Full Day' : coverage === 'fn' ? 'FN' : coverage === 'an' ? 'AN' : 'Custom Periods',
      coverage,
      periods,
      fromDate,
      toDate,
      dates,
      daysCount,
      reason,
      isEmergency: category === 'Emergency',
      status: 'Pending',
      advisorStatus: 'Pending',
      certificate: certObj,
      filedByAdvisor: false
    });

    // Record initial history
    await recordApprovalHistory({
      requestId,
      requestType: 'student_leave',
      actorId: student.trackId,
      actorName: resolvedStudentName,
      actorRole: 'student',
      action: 'submitted',
      comment: reason,
      newState: 'Pending'
    });

    return res.json({
      ok: true,
      message: `Leave request ${requestId} submitted to Class Advisor`,
      request: newRequest
    });
  } catch (err) {
    console.error('[Student Leave Submit Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to submit leave request' });
  }
});

// ── 4. POST /api/student-leave/:id/cancel — Student cancels leave ──
router.post('/:id/cancel', async (req, res) => {
  try {
    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const request = await M.StudentLeaveRequest.findOne(query);
    if (!request) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    if (request.studentTrackId !== req.user.trackId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to cancel this request' });
    }

    if (['Rejected', 'Cancelled'].includes(request.status)) {
      return res.status(400).json({ error: `Request is already ${request.status.toLowerCase()}` });
    }

    const previousStatus = request.status;
    request.status = 'Cancelled';
    await request.save();

    // If was approved, remove entitlements and unlock affected records
    if (previousStatus === 'Approved') {
      await reconcileOnLeaveCancelled({
        leaveRequestId: request.requestId,
        studentTrackId: request.studentTrackId,
        classId: String(request.classId),
        dates: request.dates,
        actorTrackId: req.user.trackId,
        actorRole: req.user.role
      });
    }

    await recordApprovalHistory({
      requestId: request.requestId,
      requestType: 'student_leave',
      actorId: req.user.trackId,
      actorName: req.user.fullName || req.user.name || '',
      actorRole: req.user.role,
      action: 'cancelled',
      previousState: previousStatus,
      newState: 'Cancelled',
      comment: sanitizeToString(req.body.reason) || 'Cancelled by student'
    });

    return res.json({ ok: true, message: `Leave request ${request.requestId} cancelled` });
  } catch (err) {
    console.error('[Student Leave Cancel Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to cancel leave request' });
  }
});

// ── 5. GET /api/student-leave/advisor/pending — Pending requests for Advisor ──
router.get('/advisor/pending', async (req, res) => {
  try {
    const userTrackId = req.user.trackId;
    const todayIST = getTodayIST();

    // Find classes where user is nominal Advisor or active Acting Advisor
    const classes = await M.Class.find({
      $or: [
        { advisorTeacherTrackId: userTrackId },
        { advisorTeacherId: req.user._id }
      ]
    }).lean();

    const classIds = classes.map(c => c._id);

    // Also check ActingRole appointments
    const actingRoles = await M.ActingRole.find({
      holderTrackId: userTrackId,
      role: 'advisor',
      status: { $in: ['active', 'pending'] },
      from: { $lte: todayIST },
      to: { $gte: todayIST }
    }).lean();

    for (const ar of actingRoles) {
      if (mongoose.isValidObjectId(ar.key)) {
        classIds.push(new mongoose.Types.ObjectId(ar.key));
      }
    }

    const query = {
      status: 'Pending',
      $or: [
        { advisorTrackId: userTrackId },
        { classId: { $in: classIds } }
      ]
    };

    const requests = await M.StudentLeaveRequest.find(query).sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, requests });
  } catch (err) {
    console.error('[Advisor Pending Leave Error]:', err);
    return res.status(500).json({ error: 'Failed to load pending requests' });
  }
});

// ── 6. POST /api/student-leave/:id/permit — Advisor permits leave ──
router.post('/:id/permit', async (req, res) => {
  try {
    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const request = await M.StudentLeaveRequest.findOne(query);
    if (!request) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const previousStatus = request.status;
    const remarks = sanitizeToString(req.body.remarks) || '';

    request.status = 'Approved';
    request.advisorStatus = 'Approved';
    request.advisorRemarks = remarks;
    request.advisorReviewedAt = new Date();
    await request.save();

    // Reconcile attendance: marks absent with reason: 'leave' and creates entitlements
    await reconcileOnLeaveApproved({
      leaveRequestId: request.requestId,
      studentTrackId: request.studentTrackId,
      classId: String(request.classId),
      dates: request.dates,
      periodNumbers: request.periods,
      actorTrackId: req.user.trackId,
      actorRole: 'advisor'
    });

    // Phase T4: Reverses uninformed absence penalties for backdated approved leave (§8)
    handleLeaveApprovalReversal(request.studentId, request.dates).catch(err => {
      console.warn('[Trust Leave Reversal Warn]:', err.message);
    });

    await recordApprovalHistory({
      requestId: request.requestId,
      requestType: 'student_leave',
      actorId: req.user.trackId,
      actorName: req.user.fullName || req.user.name || '',
      actorRole: 'advisor',
      action: 'permitted',
      comment: remarks,
      previousState: previousStatus,
      newState: 'Approved'
    });

    return res.json({
      ok: true,
      message: `Leave request ${request.requestId} approved and locked as Absent`,
      request
    });
  } catch (err) {
    console.error('[Advisor Permit Leave Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to permit leave request' });
  }
});

// ── 7. POST /api/student-leave/:id/reject — Advisor rejects leave ──
router.post('/:id/reject', async (req, res) => {
  try {
    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const request = await M.StudentLeaveRequest.findOne(query);
    if (!request) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const reason = sanitizeToString(req.body.reason || req.body.remarks);
    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const previousStatus = request.status;
    request.status = 'Rejected';
    request.advisorStatus = 'Rejected';
    request.advisorRemarks = reason;
    request.advisorReviewedAt = new Date();
    await request.save();

    await recordApprovalHistory({
      requestId: request.requestId,
      requestType: 'student_leave',
      actorId: req.user.trackId,
      actorName: req.user.fullName || req.user.name || '',
      actorRole: 'advisor',
      action: 'rejected',
      comment: reason,
      previousState: previousStatus,
      newState: 'Rejected'
    });

    return res.json({ ok: true, message: `Leave request ${request.requestId} rejected`, request });
  } catch (err) {
    console.error('[Advisor Reject Leave Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to reject leave' });
  }
});

// ── 8. POST /api/student-leave/:id/return — Advisor returns for correction ──
router.post('/:id/return', async (req, res) => {
  try {
    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const request = await M.StudentLeaveRequest.findOne(query);
    if (!request) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const remarks = sanitizeToString(req.body.remarks || req.body.reason);
    if (!remarks) {
      return res.status(400).json({ error: 'Correction instructions are required' });
    }

    const previousStatus = request.status;
    request.status = 'Returned';
    request.advisorStatus = 'Returned';
    request.advisorRemarks = remarks;
    request.advisorReviewedAt = new Date();
    await request.save();

    await recordApprovalHistory({
      requestId: request.requestId,
      requestType: 'student_leave',
      actorId: req.user.trackId,
      actorName: req.user.fullName || req.user.name || '',
      actorRole: 'advisor',
      action: 'returned',
      comment: remarks,
      previousState: previousStatus,
      newState: 'Returned'
    });

    return res.json({ ok: true, message: `Leave request ${request.requestId} returned for correction`, request });
  } catch (err) {
    console.error('[Advisor Return Leave Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to return leave' });
  }
});

// ── 9. POST /api/student-leave/advisor/file-for-student — Advisor files leave (e.g. >3 days) ──
router.post('/advisor/file-for-student', async (req, res) => {
  try {
    const studentInput = sanitizeToString(req.body.studentTrackId || req.body.registerNo || req.body.regNo);
    const category = sanitizeToString(req.body.category) || 'Personal';
    const fromDate = sanitizeToString(req.body.fromDate);
    const toDate = sanitizeToString(req.body.toDate);
    const coverage = sanitizeToString(req.body.coverage) || 'full_day';
    const periods = Array.isArray(req.body.periods) ? req.body.periods.map(Number) : [];
    const reason = sanitizeToString(req.body.reason);

    if (!studentInput || !fromDate || !toDate || !reason) {
      return res.status(400).json({ error: 'Student, from date, to date, and reason are required' });
    }

    const trimmedInput = studentInput.trim();
    const student = await M.Student.findOne({
      $or: [
        { trackId: trimmedInput },
        { registerNo: new RegExp(`^${trimmedInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        { admissionNo: new RegExp(`^${trimmedInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        ...(mongoose.isValidObjectId(trimmedInput) ? [{ _id: trimmedInput }] : [])
      ]
    }).lean();

    if (!student) {
      return res.status(404).json({ error: `Student '${studentInput}' not found by Register No or Track ID` });
    }

    const dates = getDatesInRange(fromDate, toDate);
    const requestId = await getNextRequestId('LV');

    let daysCount = dates.length;
    if (coverage === 'fn' || coverage === 'an') daysCount = 0.5 * dates.length;

    // Resolve class
    let cls = null;
    if (student.classId) {
      if (mongoose.isValidObjectId(student.classId)) cls = await M.Class.findById(student.classId).lean();
      if (!cls) cls = await M.Class.findOne({ $or: [{ trackId: student.classId }, { classTrackId: student.classId }] }).lean();
    }
    if (!cls && student.class) {
      cls = await M.Class.findOne({ $or: [{ name: student.class }, { trackId: student.class }, { classTrackId: student.class }] }).lean();
    }

    const resolvedStudentName = student.fullName || student.name || (student.firstName ? `${student.firstName} ${student.lastName || ''}`.trim() : '') || 'Student';
    const resolvedStudentRegNo = student.registerNo || student.admissionNo || student.trackId || trimmedInput;
    const resolvedClassId = cls?._id || (mongoose.isValidObjectId(student.classId) ? student.classId : null);
    const resolvedClassName = cls?.name || student.class || 'Class';

    const newRequest = await M.StudentLeaveRequest.create({
      requestId,
      studentId: student._id,
      studentTrackId: student.trackId,
      studentName: resolvedStudentName,
      studentRegNo: resolvedStudentRegNo,
      classId: resolvedClassId,
      className: resolvedClassName,
      deptId: student.deptId || cls?.deptId || null,
      deptName: student.deptName || cls?.deptName || '',
      advisorId: req.user._id,
      advisorTrackId: req.user.trackId,
      advisorName: req.user.fullName || req.user.name || '',
      category: 'Leave',
      leaveCategory: category,
      slot: coverage === 'full_day' ? 'Full Day' : coverage === 'fn' ? 'FN' : coverage === 'an' ? 'AN' : 'Custom Periods',
      coverage,
      periods,
      fromDate,
      toDate,
      dates,
      daysCount,
      reason,
      status: 'Approved', // Auto-approved since Advisor is the authority
      advisorStatus: 'Approved',
      advisorRemarks: 'Filed directly by Class Advisor',
      advisorReviewedAt: new Date(),
      filedByAdvisor: true
    });

    // Reconcile attendance & entitlements immediately
    await reconcileOnLeaveApproved({
      leaveRequestId: requestId,
      studentTrackId: student.trackId,
      classId: String(resolvedClassId),
      dates,
      periodNumbers: periods,
      actorTrackId: req.user.trackId,
      actorRole: 'advisor'
    });

    // Phase T4: Reverses uninformed absence penalties for backdated approved leave (§8)
    handleLeaveApprovalReversal(student._id, dates).catch(err => {
      console.warn('[Trust Leave Reversal Warn]:', err.message);
    });

    await recordApprovalHistory({
      requestId,
      requestType: 'student_leave',
      actorId: req.user.trackId,
      actorName: req.user.fullName || req.user.name || '',
      actorRole: 'advisor',
      action: 'filed_by_advisor',
      comment: reason,
      newState: 'Approved'
    });

    return res.json({
      ok: true,
      message: `Leave ${requestId} filed and approved for ${resolvedStudentName}`,
      request: newRequest
    });
  } catch (err) {
    console.error('[Advisor File Leave Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to file leave for student' });
  }
});

// ── 10. POST /api/student-leave/:id/override-period — Advisor overrides leave-locked period ──
router.post('/:id/override-period', async (req, res) => {
  try {
    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const request = await M.StudentLeaveRequest.findOne(query);
    if (!request) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const dateStr = sanitizeToString(req.body.date);
    const periodNumber = Number(req.body.periodNumber);
    const newStatus = sanitizeToString(req.body.newStatus) || 'P'; // 'P' or 'A'
    const note = sanitizeToString(req.body.note);

    if (!dateStr || !periodNumber || !note) {
      return res.status(400).json({ error: 'Date, period number, and reason note are required' });
    }

    await reconcilePeriodOverride({
      classId: String(request.classId),
      dateStr,
      periodNumber,
      studentTrackId: request.studentTrackId,
      newStatus,
      reasonNote: note,
      actorTrackId: req.user.trackId,
      actorRole: req.user.role
    });

    if (!Array.isArray(request.overriddenPeriods)) request.overriddenPeriods = [];
    request.overriddenPeriods.push({
      date: dateStr,
      periodNumber,
      by: req.user.trackId,
      at: new Date(),
      note
    });
    await request.save();

    await recordApprovalHistory({
      requestId: request.requestId,
      requestType: 'student_leave',
      actorId: req.user.trackId,
      actorName: req.user.fullName || req.user.name || '',
      actorRole: req.user.role,
      action: 'period_override',
      comment: `Period ${periodNumber} on ${dateStr} changed to ${newStatus}: ${note}`
    });

    return res.json({ ok: true, message: `Period ${periodNumber} on ${dateStr} overridden to ${newStatus}` });
  } catch (err) {
    console.error('[Override Period Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to override period' });
  }
});

module.exports = router;
