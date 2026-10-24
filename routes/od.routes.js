const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { getSettings } = require('../utils/settingsCache');
const { getNextRequestId } = require('../utils/requestIds');
const { resolveStageApprover, advanceWorkflowStage, recordApprovalHistory } = require('../utils/approvalWorkflow');
const {
  reconcileOnODApproved,
  reconcileOnODRejected,
  previewODRejection
} = require('../utils/reconcileAttendance');
const { getTodayIST } = require('../middleware/scope');

const { calculateODVerificationScore } = require('../utils/participationScore');
const { handleLeaveApprovalReversal } = require('../services/trustDailyService');

router.use(authMiddleware);

// Helper for date ranges
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

// ── 1. GET /api/od/events — List Academic Events Registry ──
router.get('/events', async (req, res) => {
  try {
    const q = sanitizeToString(req.query.q);
    const filter = {};
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { organizer: { $regex: q, $options: 'i' } },
        { hostCollege: { $regex: q, $options: 'i' } }
      ];
    }
    const events = await M.AcademicEvent.find(filter).sort({ startDate: -1 }).limit(50).lean();
    return res.json({ ok: true, events });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to search events' });
  }
});

// ── 2. POST /api/od/events — Create Event in Registry ──
router.post('/events', async (req, res) => {
  try {
    const {
      name, organizer, type, subType, level, mode, hostCollege, city, venue, websiteUrl, startDate, endDate, description
    } = req.body;

    if (!name || !organizer || !startDate || !endDate) {
      return res.status(400).json({ error: 'Name, organizer, start date, and end date are required' });
    }

    const eventId = await getNextRequestId('EVT');
    const newEvent = await M.AcademicEvent.create({
      eventId,
      name: sanitizeToString(name),
      organizer: sanitizeToString(organizer),
      type: sanitizeToString(type) || 'Technical',
      subType: sanitizeToString(subType) || 'Hackathon',
      level: sanitizeToString(level) || 'Inter-Collegiate',
      mode: sanitizeToString(mode) || 'Offline',
      hostCollege: sanitizeToString(hostCollege) || '',
      city: sanitizeToString(city) || '',
      venue: sanitizeToString(venue) || '',
      websiteUrl: sanitizeToString(websiteUrl) || '',
      startDate: sanitizeToString(startDate),
      endDate: sanitizeToString(endDate),
      description: sanitizeToString(description) || '',
      createdBy: {
        trackId: req.user.trackId,
        name: req.user.fullName || req.user.name || '',
        role: req.user.role
      }
    });

    return res.json({ ok: true, event: newEvent });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to create event' });
  }
});

// ── 3. GET /api/od/me — List Student's Own OD Requests ──
router.get('/me', async (req, res) => {
  try {
    const studentTrackId = req.user.trackId;
    const requests = await M.ODRequest.find({ studentTrackId }).sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, requests, data: requests });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve OD requests' });
  }
});

// ── 4. GET /api/od/mentors — List Faculty Mentors for Student Selection ──
router.get('/mentors', async (req, res) => {
  try {
    const teachers = await M.Teacher.find(
      { active: { $ne: false } },
      'trackId fullName name department deptName deptCode designation'
    ).sort({ fullName: 1, name: 1 }).lean();
    return res.json({ ok: true, teachers });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load faculty mentors' });
  }
});

// ── 5. POST /api/od — Student Submits OD Request (Phase L3) ──
router.post('/', async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Only students may apply for OD' });
    }

    const student = await M.Student.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.user._id) ? req.user._id : undefined },
        { trackId: req.user.trackId }
      ].filter(Boolean)
    }).lean();

    if (!student) return res.status(404).json({ error: 'Student not found' });

    const {
      eventId, eventName, organizer, type, subType, level, mode, hostCollege, city, venue, websiteUrl,
      startDate, endDate, description, mentorTrackId, coverage, periods, evidence
    } = req.body;

    const resolvedOrganizer = sanitizeToString(organizer) || sanitizeToString(hostCollege) || 'Institution / Department';

    if (!eventName || !startDate || !endDate || !mentorTrackId) {
      return res.status(400).json({ error: 'Event name, dates, and faculty mentor are required' });
    }

    // Verify mentor is active EAMS faculty
    const mentorTrack = sanitizeToString(mentorTrackId);
    const mentor = await M.Teacher.findOne({
      $or: [
        { trackId: mentorTrack },
        { _id: mongoose.isValidObjectId(mentorTrack) ? mentorTrack : undefined }
      ].filter(Boolean)
    }, 'trackId fullName name deptId deptCode').lean();

    if (!mentor) {
      return res.status(400).json({ error: 'Selected mentor is not recognized as active EAMS faculty' });
    }

    const cov = sanitizeToString(coverage) || 'full_day';
    const periodList = Array.isArray(periods) ? periods.map(Number) : [];
    const dates = getDatesInRange(sanitizeToString(startDate), sanitizeToString(endDate));
    const todayIST = getTodayIST();

    // Inter-Collegiate mandatory host college & city validation
    const lvl = sanitizeToString(level) || 'department';
    if (lvl.toLowerCase() === 'inter-collegiate' && (!hostCollege || !city)) {
      return res.status(400).json({ error: 'Host College name and City are required for Inter-Collegiate events' });
    }

    // Overlap checks
    const existingOD = await M.ODRequest.findOne({
      studentTrackId: student.trackId,
      dates: { $in: dates },
      status: { $in: ['pending', 'approved'] }
    }).lean();
    if (existingOD) {
      return res.status(400).json({
        error: `Overlap conflict: You already have an active OD request (${existingOD.requestId}) covering these dates.`
      });
    }

    const existingLeave = await M.StudentLeaveRequest.findOne({
      studentTrackId: student.trackId,
      dates: { $in: dates },
      status: { $in: ['Pending', 'Approved'] }
    }).lean();
    if (existingLeave) {
      return res.status(400).json({
        error: `Overlap conflict: You already have an active leave request (${existingLeave.requestId}) covering these dates.`
      });
    }

    // Resolve class & Advisor
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
    if (cls?.advisorTeacherId) {
      const adv = await M.Teacher.findById(cls.advisorTeacherId, 'trackId fullName name').lean();
      if (adv) {
        advisorTrackId = adv.trackId;
        advisorName = adv.fullName || adv.name;
      }
    }
    if (!advisorTrackId && cls?.advisorTeacherTrackId) {
      const adv = await M.Teacher.findOne({ trackId: cls.advisorTeacherTrackId }, 'trackId fullName name').lean();
      if (adv) {
        advisorTrackId = adv.trackId;
        advisorName = adv.fullName || adv.name;
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
      }
    }

    const resolvedAdvisor = await resolveStageApprover({
      stage: 'advisor',
      targetKey: String(cls?._id || student.classId),
      nominalApproverTrackId: advisorTrackId,
      dateStr: todayIST
    });

    const requestId = await getNextRequestId('OD');
    const resolvedStudentName = student.fullName || student.name || req.user.fullName || req.user.name || 'Student';
    const resolvedRegNo = student.registerNo || student.admissionNo || '—';

    const newOD = await M.ODRequest.create({
      requestId,
      eventId: mongoose.isValidObjectId(eventId) ? eventId : null,
      eventDetails: {
        name: sanitizeToString(eventName),
        organizer: resolvedOrganizer,
        type: sanitizeToString(type) || 'Technical',
        subType: sanitizeToString(subType) || 'Hackathon',
        level: lvl,
        mode: sanitizeToString(mode) || 'Offline',
        hostCollege: sanitizeToString(hostCollege) || '',
        city: sanitizeToString(city) || '',
        venue: sanitizeToString(venue) || '',
        websiteUrl: sanitizeToString(websiteUrl) || '',
        startDate: sanitizeToString(startDate),
        endDate: sanitizeToString(endDate),
        description: sanitizeToString(description) || ''
      },
      studentId: student._id,
      studentTrackId: student.trackId,
      studentName: resolvedStudentName,
      studentRegNo: resolvedRegNo,
      classId: cls?._id || student.classId,
      className: cls?.name || student.class || 'Class',
      deptId: student.deptId || cls?.deptId || null,
      deptCode: student.deptCode || cls?.deptCode || 'DEPT',
      year: student.year || 1,
      section: student.section || 'A',
      advisorTrackId: resolvedAdvisor.approverTrackId || advisorTrackId,
      advisorName,
      mentorTrackId: mentor.trackId,
      mentorName: mentor.fullName || mentor.name,
      mentorDept: mentor.deptCode || '',
      coverage: cov,
      periods: periodList,
      dates,
      daysCount: dates.length,
      evidenceAtRequest: Array.isArray(evidence) ? evidence : [],
      requestPrincipal: Boolean(req.body.requestPrincipal),
      status: 'pending',
      currentStage: 'advisor'
    });

    await recordApprovalHistory({
      requestId,
      requestType: 'od',
      actorId: student.trackId,
      actorName: resolvedStudentName,
      actorRole: 'student',
      action: 'submitted',
      comment: description || 'OD request submitted',
      newState: 'pending'
    });

    return res.json({
      ok: true,
      message: `OD request ${requestId} submitted to Class Advisor`,
      request: newOD
    });
  } catch (err) {
    console.error('[OD Submit Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to submit OD request' });
  }
});

// ── 6. POST /api/od/:id/cancel — Student Cancels Pending OD Request ──
router.post('/:id/cancel', async (req, res) => {
  try {
    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const request = await M.ODRequest.findOne(query);
    if (!request) {
      return res.status(404).json({ error: 'OD request not found' });
    }

    if (request.studentTrackId !== req.user.trackId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to cancel this OD request' });
    }

    if (['rejected', 'cancelled'].includes(request.status.toLowerCase())) {
      return res.status(400).json({ error: `Request is already ${request.status.toLowerCase()}` });
    }

    const previousStatus = request.status;
    request.status = 'cancelled';
    await request.save();

    await recordApprovalHistory({
      requestId: request.requestId,
      requestType: 'od',
      actorId: req.user.trackId,
      actorName: req.user.fullName || req.user.name || '',
      actorRole: req.user.role,
      action: 'cancelled',
      previousState: previousStatus,
      newState: 'cancelled',
      comment: sanitizeToString(req.body.reason) || 'Cancelled by student'
    });

    return res.json({ ok: true, message: `OD request ${request.requestId} cancelled` });
  } catch (err) {
    console.error('[OD Cancel Error]:', err);
    return res.status(500).json({ error: 'Failed to cancel OD request' });
  }
});

// ── 6. GET /api/od/pending — Approver's Queue (Pending, Verify, History, All) ──
router.get('/pending', async (req, res) => {
  try {
    const userTrackId = req.user.trackId;
    const userRole = req.user.role;
    const todayIST = getTodayIST();
    const type = req.query.type || 'pending'; // 'pending' | 'verify' | 'history' | 'all'

    // Stage 1: Class Advisor classes
    const classes = await M.Class.find({
      $or: [{ advisorTeacherTrackId: userTrackId }, { advisorTeacherId: req.user._id }]
    }).lean();
    const classIds = classes.map(c => c._id);

    // Acting Advisor
    const actingAdvisor = await M.ActingRole.find({
      holderTrackId: userTrackId,
      role: 'advisor',
      status: { $in: ['active', 'pending'] },
      from: { $lte: todayIST },
      to: { $gte: todayIST }
    }).lean();
    for (const ar of actingAdvisor) {
      if (mongoose.isValidObjectId(ar.key)) classIds.push(new mongoose.Types.ObjectId(ar.key));
    }

    const deptCode = req.user.deptCode;
    const isHod = req.user.isHod || userRole === 'hod';
    const isPrincipal = req.user.isPrincipal || userRole === 'principal';

    // Base scope for this user (classes advised, students mentored, dept for hod, or all for principal)
    const scopeOr = [];
    if (classIds.length > 0) scopeOr.push({ classId: { $in: classIds } });
    if (userTrackId) {
      scopeOr.push({ mentorTrackId: userTrackId });
      scopeOr.push({ advisorTrackId: userTrackId });
      scopeOr.push({ 'approvalChain.approverTrackId': userTrackId });
    }
    if (isHod && deptCode) scopeOr.push({ deptCode });
    if (isPrincipal) scopeOr.push({}); // principal sees all

    const baseFilter = scopeOr.length > 0 ? { $or: scopeOr } : { studentTrackId: userTrackId };

    if (type === 'verify') {
      const verifyQuery = {
        ...baseFilter,
        'verification.status': 'pending',
        'outcome.primaryOutcome': { $exists: true, $ne: null }
      };
      const requests = await M.ODRequest.find(verifyQuery).sort({ 'outcome.submittedAt': -1, createdAt: -1 }).lean();
      return res.json({ ok: true, requests, data: requests });
    }

    if (type === 'history') {
      const historyQuery = {
        ...baseFilter,
        status: { $in: ['approved', 'completed', 'rejected'] }
      };
      const requests = await M.ODRequest.find(historyQuery).sort({ updatedAt: -1, createdAt: -1 }).limit(100).lean();
      return res.json({ ok: true, requests, data: requests });
    }

    // Default: 'pending' reviews
    const pendingOr = [];
    if (classIds.length > 0) {
      pendingOr.push({ currentStage: 'advisor', status: 'pending', classId: { $in: classIds } });
    }
    if (userTrackId) {
      pendingOr.push({ currentStage: 'mentor', status: 'pending', mentorTrackId: userTrackId });
    }
    if (isHod && deptCode) {
      pendingOr.push({ currentStage: 'hod', status: 'pending', deptCode });
    }
    if (isPrincipal) {
      pendingOr.push({ currentStage: 'principal', status: 'pending' });
    }

    const pendingQuery = pendingOr.length > 0 ? { $or: pendingOr } : { _id: null };
    const requests = await M.ODRequest.find(pendingQuery).sort({ createdAt: -1 }).lean();

    if (type === 'all') {
      const verifyRequests = await M.ODRequest.find({
        ...baseFilter,
        'verification.status': 'pending',
        'outcome.primaryOutcome': { $exists: true, $ne: null }
      }).sort({ createdAt: -1 }).lean();

      const historyRequests = await M.ODRequest.find({
        ...baseFilter,
        status: { $in: ['approved', 'completed', 'rejected'] }
      }).sort({ updatedAt: -1 }).limit(100).lean();

      const approvedCount = historyRequests.filter(r => r.status === 'approved' || r.status === 'completed').length;

      return res.json({
        ok: true,
        requests,
        pending: requests,
        verify: verifyRequests,
        history: historyRequests,
        counts: {
          pending: requests.length,
          verify: verifyRequests.length,
          approved: approvedCount,
          total: requests.length + verifyRequests.length + historyRequests.length
        }
      });
    }

    return res.json({ ok: true, requests, data: requests });
  } catch (err) {
    console.error('[OD Pending Queue Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve pending OD requests' });
  }
});

// ── 6b. GET /api/od/:id — Request Detail with Timeline & Verification Score ──
router.get('/:id', async (req, res) => {
  try {
    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const request = await M.ODRequest.findOne(query).lean();
    if (!request) {
      return res.status(404).json({ error: 'OD request not found' });
    }

    const history = await M.ApprovalHistory.find({ requestId: request.requestId }).sort({ at: 1 }).lean();

    // Compute OD verification score for reviewers (advisor, mentor, hod, principal, admin)
    let verificationScore = null;
    const isReviewer = ['teacher', 'admin', 'hod', 'principal'].includes(req.user.role) || req.user.isPrincipal;
    if (isReviewer) {
      try {
        verificationScore = await calculateODVerificationScore(request.studentTrackId, request);
      } catch (scoreErr) {
        console.warn('[OD Verification Score calculation error]:', scoreErr.message);
      }
    }

    return res.json({ ok: true, request, history, verificationScore });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve OD detail' });
  }
});

// ── 7. POST /api/od/:id/approve — Advance Stage & Automatic Stage Merge ──
router.post('/:id/approve', async (req, res) => {
  try {
    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const od = await M.ODRequest.findOne(query);
    if (!od) return res.status(404).json({ error: 'OD request not found' });
    if (od.status !== 'pending') {
      return res.status(400).json({ error: `Cannot approve request with status '${od.status}'` });
    }

    const currentStage = od.currentStage;
    const actorTrackId = req.user.trackId;
    const actorName = req.user.fullName || req.user.name || 'Approver';
    const actorRole = currentStage;
    const remarks = sanitizeToString(req.body.remarks) || '';

    // Record decision in approval chain
    od.approvalChain.push({
      stage: currentStage,
      approverTrackId: actorTrackId,
      approverName: actorName,
      approverRole: actorRole,
      status: 'approved',
      decidedAt: new Date(),
      remarks
    });

    // Advance workflow using engine (handles stage merge)
    const stageApproverMap = {
      advisor: od.advisorTrackId,
      mentor: od.mentorTrackId,
      hod: od.deptCode,
      principal: 'principal'
    };

    const advanceResult = advanceWorkflowStage({
      requestType: 'od',
      currentStage,
      stageApproverMap,
      actorTrackId,
      actorName,
      requestPrincipal: od.requestPrincipal
    });

    // Record history for current approval
    await recordApprovalHistory({
      requestId: od.requestId,
      requestType: 'od',
      actorId: actorTrackId,
      actorName,
      actorRole,
      action: 'stage_approved',
      comment: remarks,
      previousState: currentStage,
      newState: advanceResult.isComplete ? 'approved' : advanceResult.nextStage
    });

    // Handle any merged stages
    if (advanceResult.mergedStages && advanceResult.mergedStages.length > 0) {
      for (const merged of advanceResult.mergedStages) {
        od.approvalChain.push({
          stage: merged,
          approverTrackId: actorTrackId,
          approverName: actorName,
          approverRole: merged,
          status: 'skipped_merged',
          decidedAt: new Date(),
          remarks: `Auto-approved: same actor as ${currentStage}`
        });

        await recordApprovalHistory({
          requestId: od.requestId,
          requestType: 'od',
          actorId: actorTrackId,
          actorName,
          actorRole: merged,
          action: 'stage_merged',
          comment: `Auto-approved as ${merged}`,
          previousState: merged,
          newState: advanceResult.isComplete ? 'approved' : advanceResult.nextStage
        });
      }
    }

    if (advanceResult.isComplete) {
      od.status = 'approved';
      od.currentStage = 'completed';
      await od.save();

      // Final approval: Reconcile attendance & create entitlements
      await reconcileOnODApproved({
        odRequestId: od.requestId,
        studentTrackId: od.studentTrackId,
        classId: String(od.classId),
        dates: od.dates,
        periodNumbers: od.periods,
        actorTrackId,
        actorRole
      });

      // Phase T4: Reverses uninformed absence penalties for backdated approved OD (§8)
      handleLeaveApprovalReversal(od.studentId, od.dates).catch(err => {
        console.warn('[Trust OD Reversal Warn]:', err.message);
      });

      return res.json({
        ok: true,
        message: `OD request ${od.requestId} fully approved and locked as Present`,
        request: od
      });
    }

    od.currentStage = advanceResult.nextStage;
    await od.save();

    return res.json({
      ok: true,
      message: `OD request advanced to ${advanceResult.nextStage} stage`,
      request: od
    });
  } catch (err) {
    console.error('[OD Stage Approve Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to approve OD stage' });
  }
});

// ── 8. POST /api/od/:id/reject — Reject Current Stage ──
router.post('/:id/reject', async (req, res) => {
  try {
    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const od = await M.ODRequest.findOne(query);
    if (!od) return res.status(404).json({ error: 'OD request not found' });

    const reason = sanitizeToString(req.body.reason || req.body.remarks);
    if (!reason) return res.status(400).json({ error: 'Rejection reason is required' });

    const previousStage = od.currentStage;
    od.status = 'rejected';
    od.currentStage = 'rejected';

    od.approvalChain.push({
      stage: previousStage,
      approverTrackId: req.user.trackId,
      approverName: req.user.fullName || req.user.name || '',
      approverRole: previousStage,
      status: 'rejected',
      decidedAt: new Date(),
      remarks: reason
    });

    await od.save();

    await recordApprovalHistory({
      requestId: od.requestId,
      requestType: 'od',
      actorId: req.user.trackId,
      actorName: req.user.fullName || req.user.name || '',
      actorRole: previousStage,
      action: 'rejected',
      comment: reason,
      previousState: previousStage,
      newState: 'rejected'
    });

    return res.json({ ok: true, message: `OD request ${od.requestId} rejected`, request: od });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to reject OD' });
  }
});

// ── 9. POST /api/od/:id/return — Return for Correction ──
router.post('/:id/return', async (req, res) => {
  try {
    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const od = await M.ODRequest.findOne(query);
    if (!od) return res.status(404).json({ error: 'OD request not found' });

    const remarks = sanitizeToString(req.body.remarks || req.body.reason);
    if (!remarks) return res.status(400).json({ error: 'Remarks required for return' });

    od.status = 'returned';
    await od.save();

    await recordApprovalHistory({
      requestId: od.requestId,
      requestType: 'od',
      actorId: req.user.trackId,
      actorName: req.user.fullName || req.user.name || '',
      actorRole: od.currentStage,
      action: 'returned',
      comment: remarks,
      previousState: od.currentStage,
      newState: 'returned'
    });

    return res.json({ ok: true, message: `OD request returned for correction`, request: od });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to return OD' });
  }
});

// ── 10. POST /api/od/:id/request-principal — Flag for Principal Escalation ──
router.post('/:id/request-principal', async (req, res) => {
  try {
    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const od = await M.ODRequest.findOne(query);
    if (!od) return res.status(404).json({ error: 'OD request not found' });

    od.requestPrincipal = true;
    await od.save();

    await recordApprovalHistory({
      requestId: od.requestId,
      requestType: 'od',
      actorId: req.user.trackId,
      actorName: req.user.fullName || req.user.name || '',
      actorRole: req.user.role,
      action: 'requested_principal_approval',
      comment: sanitizeToString(req.body.remarks) || 'Escalated to require Principal approval'
    });

    return res.json({ ok: true, message: 'Principal approval will be required', request: od });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── 11. POST /api/od/group — Faculty Creates Group OD (Phase L3 LD18) ──
router.post('/group', async (req, res) => {
  try {
    const isFaculty = ['teacher', 'admin', 'hod', 'principal'].includes(req.user.role) || req.user.isPrincipal;
    if (!isFaculty) {
      return res.status(403).json({ error: 'Only faculty members may create Group OD requests' });
    }

    const {
      eventId, eventName, organizer, type, subType, level, mode, hostCollege, city, startDate, endDate,
      description, mentorTrackId, coverage, periods, studentTrackIds, students, event, dates: datesInput, reason
    } = req.body;

    const studentIdentifiers = Array.isArray(studentTrackIds) && studentTrackIds.length > 0
      ? studentTrackIds
      : (Array.isArray(students) ? students : []);

    if (!studentIdentifiers.length) {
      return res.status(400).json({ error: 'At least one student must be selected' });
    }

    const evtObj = event || {};
    const finalEventName = sanitizeToString(eventName || evtObj.title || evtObj.name || 'Academic Event');
    const finalOrganizer = sanitizeToString(organizer || evtObj.organizer || 'Host Institution');
    const finalType = sanitizeToString(type || evtObj.type || 'Technical');
    const finalSubType = sanitizeToString(subType || evtObj.subType || 'Symposium');
    const finalLevel = sanitizeToString(level || evtObj.level || 'Inter-Collegiate');
    const finalMode = sanitizeToString(mode || (evtObj.mode === 'in-person' ? 'Offline' : (evtObj.mode || 'Offline')));
    const finalHostCollege = sanitizeToString(hostCollege || evtObj.hostCollege || '');
    const finalCity = sanitizeToString(city || evtObj.city || '');
    const finalDesc = sanitizeToString(description || reason || evtObj.description || '');

    const datesObj = datesInput || {};
    const finalStartDate = sanitizeToString(startDate || datesObj.from || datesObj.startDate || getTodayIST());
    const finalEndDate = sanitizeToString(endDate || datesObj.to || datesObj.endDate || finalStartDate);

    const dates = getDatesInRange(finalStartDate, finalEndDate);
    const createdRequests = [];

    for (const rawId of studentIdentifiers) {
      const idStr = String(rawId).trim();
      if (!idStr) continue;

      const student = await M.Student.findOne({
        $or: [
          { trackId: idStr },
          { registerNo: idStr },
          { admissionNo: idStr },
          ...(mongoose.isValidObjectId(idStr) ? [{ _id: idStr }] : [])
        ]
      }).lean();

      if (!student) continue;

      let cls = null;
      if (student.classId) {
        if (mongoose.isValidObjectId(student.classId)) cls = await M.Class.findById(student.classId).lean();
        if (!cls) cls = await M.Class.findOne({ trackId: student.classId }).lean();
      }
      if (!cls && student.class) {
        cls = await M.Class.findOne({ $or: [{ name: student.class }, { trackId: student.class }] }).lean();
      }

      const requestId = await getNextRequestId('OD');
      const od = await M.ODRequest.create({
        requestId,
        eventId: mongoose.isValidObjectId(eventId) ? eventId : null,
        eventDetails: {
          name: finalEventName,
          organizer: finalOrganizer,
          type: finalType,
          subType: finalSubType,
          level: finalLevel,
          mode: finalMode,
          hostCollege: finalHostCollege,
          city: finalCity,
          startDate: finalStartDate,
          endDate: finalEndDate,
          description: finalDesc
        },
        studentId: student._id,
        studentTrackId: student.trackId,
        studentName: student.fullName || student.name || (student.firstName ? `${student.firstName} ${student.lastName || ''}`.trim() : '') || 'Student',
        studentRegNo: student.registerNo || student.admissionNo || student.trackId || '',
        classId: cls?._id || student.classId,
        className: cls?.name || student.class || 'Class',
        deptId: student.deptId || cls?.deptId || null,
        deptCode: student.deptCode || cls?.deptCode || 'DEPT',
        year: student.year || 1,
        section: student.section || 'A',
        advisorTrackId: cls?.advisorTeacherTrackId || '',
        advisorName: '',
        mentorTrackId: mentorTrackId || req.user.trackId,
        mentorName: req.user.fullName || req.user.name || '',
        coverage: sanitizeToString(coverage) || 'full_day',
        periods: Array.isArray(periods) ? periods.map(Number) : [],
        dates,
        daysCount: dates.length,
        isGroupOD: true,
        groupFacultyTrackId: req.user.trackId,
        status: 'pending',
        currentStage: 'advisor'
      });

      await recordApprovalHistory({
        requestId,
        requestType: 'od',
        actorId: req.user.trackId,
        actorName: req.user.fullName || req.user.name || '',
        actorRole: req.user.role,
        action: 'group_od_created',
        comment: `Group OD created by faculty for ${student.name} (${finalEventName})`
      });

      // Send in-app notification to the student (LD18)
      try {
        if (M.Notification) {
          await M.Notification.create({
            type: 'info',
            from: req.user.fullName || req.user.name || 'Faculty',
            fromRole: 'Teacher',
            toStudentId: student._id,
            toStudentTrackId: student.trackId,
            toStudentName: student.name,
            message: `You were added to a Group OD for "${finalEventName}" (${finalStartDate} to ${finalEndDate}). View in My Participation.`,
            priority: 'Normal',
            status: 'Pending',
            time: new Date()
          });
        }
      } catch (notifErr) {
        console.warn('[Group OD Notification Error]:', notifErr.message);
      }

      createdRequests.push(od);
    }

    return res.json({
      ok: true,
      message: `Group OD created for ${createdRequests.length} students`,
      count: createdRequests.length,
      requests: createdRequests,
      data: { created: createdRequests }
    });
  } catch (err) {
    console.error('[Group OD Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to create group OD' });
  }
});

// ── 12. POST /api/od/:id/outcome — Student Submits Outcome & Evidence (Phase L4 §5.8) ──
router.post('/:id/outcome', async (req, res) => {
  try {
    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const od = await M.ODRequest.findOne(query);
    if (!od) return res.status(404).json({ error: 'OD request not found' });

    const isOwner = req.user.trackId === od.studentTrackId;
    if (!isOwner && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Only the participant student may submit outcome' });
    }

    const { primaryOutcome, driveFileId, webViewLink, md5Checksum, fileName, mimeType, sizeBytes } = req.body;
    if (!primaryOutcome) {
      return res.status(400).json({ error: 'Primary outcome selection is required' });
    }

    od.outcome = {
      primaryOutcome: sanitizeToString(primaryOutcome),
      submittedAt: new Date(),
      dueAt: od.outcome?.dueAt || null,
      evidence: {
        driveFileId: sanitizeToString(driveFileId) || null,
        webViewLink: sanitizeToString(webViewLink) || null,
        md5Checksum: sanitizeToString(md5Checksum) || null,
        fileName: sanitizeToString(fileName) || null,
        mimeType: sanitizeToString(mimeType) || null,
        sizeBytes: Number(sizeBytes) || 0
      }
    };

    od.verification = {
      status: 'pending',
      verifiedByTrackId: null,
      verifiedByName: null,
      verifiedByRole: null,
      verifiedAt: null,
      comment: '',
      duplicateFlag: null
    };

    await od.save();

    await recordApprovalHistory({
      requestId: od.requestId,
      requestType: 'od',
      actorId: req.user.trackId,
      actorName: req.user.fullName || req.user.name || '',
      actorRole: 'student',
      action: 'outcome_submitted',
      comment: `Outcome submitted: ${primaryOutcome}`
    });

    return res.json({ ok: true, message: 'Outcome and evidence submitted successfully', request: od });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to submit outcome' });
  }
});

// ── 13. POST /api/od/:id/verify — Advisor / Mentor Verifies Evidence (Phase L4 §5.9) ──
router.post('/:id/verify', async (req, res) => {
  try {
    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const od = await M.ODRequest.findOne(query);
    if (!od) return res.status(404).json({ error: 'OD request not found' });

    const status = sanitizeToString(req.body.status) || 'verified'; // 'verified' | 'invalid' | 'needs_correction'
    const comment = sanitizeToString(req.body.comment) || '';

    // Check for duplicate evidence MD5 checksums across all other OD requests
    let duplicateFlag = null;
    const md5 = od.outcome?.evidence?.md5Checksum;
    if (md5) {
      const duplicate = await M.ODRequest.findOne({
        _id: { $ne: od._id },
        'outcome.evidence.md5Checksum': md5
      }).lean();

      if (duplicate) {
        duplicateFlag = `Duplicate file detected: Also submitted for ${duplicate.requestId} by ${duplicate.studentName}`;
      }
    }

    od.verification = {
      status,
      verifiedByTrackId: req.user.trackId,
      verifiedByName: req.user.fullName || req.user.name || '',
      verifiedByRole: req.user.role,
      verifiedAt: new Date(),
      comment,
      duplicateFlag
    };

    if (status === 'verified') {
      od.status = 'completed';
    }

    await od.save();

    await recordApprovalHistory({
      requestId: od.requestId,
      requestType: 'od',
      actorId: req.user.trackId,
      actorName: req.user.fullName || req.user.name || '',
      actorRole: req.user.role,
      action: `outcome_${status}`,
      comment: duplicateFlag ? `${comment} [${duplicateFlag}]` : comment
    });

    return res.json({
      ok: true,
      message: `Outcome verification recorded as ${status}`,
      duplicateWarning: duplicateFlag,
      request: od
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to verify outcome' });
  }
});

// ── 14. POST /api/od/:id/reject-approved — Reject already approved OD (Phase L4 §5.6) ──
router.post('/:id/reject-approved', async (req, res) => {
  try {
    const isAuthorized = ['teacher', 'admin', 'hod', 'principal'].includes(req.user.role) || req.user.isPrincipal;
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Only Class Advisors, HODs, or Principal may reject approved OD' });
    }

    const query = mongoose.isValidObjectId(req.params.id)
      ? { $or: [{ _id: req.params.id }, { requestId: req.params.id }] }
      : { requestId: req.params.id };

    const od = await M.ODRequest.findOne(query);
    if (!od) return res.status(404).json({ error: 'OD request not found' });

    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const dates = Array.isArray(req.body.dates) && req.body.dates.length > 0 ? req.body.dates : od.dates;
    const periods = Array.isArray(req.body.periods) && req.body.periods.length > 0 ? req.body.periods : od.periods;
    const reason = sanitizeToString(req.body.reason);

    if (!reason) return res.status(400).json({ error: 'Rejection reason is required' });

    if (dryRun) {
      const preview = await previewODRejection({
        odRequestId: od.requestId,
        studentTrackId: od.studentTrackId,
        classId: String(od.classId),
        dates,
        periodNumbers: periods
      });
      return res.json({ ok: true, preview });
    }

    // Execute rejection: turns OD-Present records to Absent
    await reconcileOnODRejected({
      odRequestId: od.requestId,
      studentTrackId: od.studentTrackId,
      classId: String(od.classId),
      dates,
      periodNumbers: periods,
      actorTrackId: req.user.trackId,
      actorRole: req.user.role,
      reason
    });

    if (!Array.isArray(od.partialRejections)) od.partialRejections = [];
    od.partialRejections.push({
      dates,
      periods,
      rejectedBy: req.user.trackId,
      rejectedAt: new Date(),
      reason
    });

    // If all dates rejected, mark request rejected
    if (dates.length >= od.dates.length) {
      od.status = 'rejected';
    }

    await od.save();

    await recordApprovalHistory({
      requestId: od.requestId,
      requestType: 'od',
      actorId: req.user.trackId,
      actorName: req.user.fullName || req.user.name || '',
      actorRole: req.user.role,
      action: 'approved_od_rejected',
      comment: `Approved OD rejected for dates [${dates.join(', ')}]: ${reason}`
    });

    return res.json({
      ok: true,
      message: `OD approval revoked for dates [${dates.join(', ')}]. Affected periods converted to Absent.`,
      request: od
    });
  } catch (err) {
    console.error('[Reject Approved OD Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to reject approved OD' });
  }
});

module.exports = router;
