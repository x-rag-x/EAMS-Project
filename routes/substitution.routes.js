const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { isSudoAdmin } = require('../utils/access');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { getFreeTeachers } = require('../utils/freeTeachers');
const { todayInInstitutionTz } = require('../utils/institutionTime');

/**
 * GET /api/substitution/free-teachers
 * Search and rank available teachers for a specific date and period
 */
router.get('/free-teachers', authMiddleware, async (req, res) => {
  try {
    const dateStr = sanitizeToString(req.query.date);
    const periodNumber = Number(req.query.period);
    if (!dateStr || !periodNumber) {
      return res.status(400).json({ error: 'date and period are required' });
    }

    const deptCode = sanitizeToString(req.query.deptCode || req.query.dept);
    const classId = req.query.classId;
    const subjectId = req.query.subjectId;
    const subjectCode = sanitizeToString(req.query.subjectCode);
    const exclude = req.query.exclude ? String(req.query.exclude).split(',').map(s => s.trim()) : [];

    // Always exclude current user if teacher
    if (req.user.trackId && !exclude.includes(req.user.trackId)) {
      exclude.push(req.user.trackId);
    }

    const candidates = await getFreeTeachers({
      dateStr,
      periodNumber,
      deptCode,
      classId,
      subjectId,
      subjectCode,
      excludeTeacherTrackIds: exclude
    });

    res.json({ ok: true, candidates });
  } catch (err) {
    console.error('Free teachers search error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/substitution/direct-assign
 * HOD, Acting HOD, Dept TT Coordinator direct assignment of a substitute
 */
router.post('/direct-assign', authMiddleware, async (req, res) => {
  try {
    const { leaveId, slotId, substituteTrackId, reason } = req.body;
    if (!leaveId || !substituteTrackId) {
      return res.status(400).json({ error: 'leaveId and substituteTrackId are required' });
    }

    // Permission check: HOD, Acting HOD, TT Coordinator, Admin
    const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
    const isHodOrAdmin = isSudoAdmin(req.user) ||
      req.user.isHod === true ||
      req.user.isTimeTableCoordinator === true ||
      specials.some(s => ['isHod', 'isPrincipal', 'isTimeTableCoordinator'].includes(s.option));

    // Also check Acting HOD
    let isActingHod = false;
    if (!isHodOrAdmin && req.user.trackId) {
      const today = await todayInInstitutionTz();
      const actingRole = await M.ActingRole.findOne({
        holderTrackId: req.user.trackId,
        role: 'hod',
        status: { $in: ['active', 'pending'] },
        from: { $lte: today },
        to: { $gte: today }
      }).lean();
      if (actingRole) isActingHod = true;
    }

    if (!isHodOrAdmin && !isActingHod) {
      return res.status(403).json({ error: 'HOD, Timetable Coordinator, or Admin privilege required' });
    }

    const leaveReq = await M.TeacherLeaveRequest.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(leaveId) ? leaveId : undefined },
        { requestId: leaveId }
      ].filter(Boolean)
    });

    if (!leaveReq) {
      return res.status(404).json({ error: 'Faculty leave request not found' });
    }

    const subTeacher = await M.Teacher.findOne({
      $or: [
        { trackId: substituteTrackId },
        { _id: mongoose.isValidObjectId(substituteTrackId) ? substituteTrackId : undefined }
      ].filter(Boolean)
    }).lean();

    if (!subTeacher) {
      return res.status(404).json({ error: 'Substitute teacher not found' });
    }

    // Find target substitution slot
    let slot = null;
    if (slotId) {
      slot = leaveReq.substitutions.id ? leaveReq.substitutions.id(slotId) : null;
      if (!slot) {
        slot = leaveReq.substitutions.find(s => String(s._id) === String(slotId));
      }
    }
    if (!slot && req.body.periodNumber && req.body.date) {
      slot = leaveReq.substitutions.find(s =>
        s.date === req.body.date && Number(s.periodNumber) === Number(req.body.periodNumber)
      );
    }
    if (!slot && leaveReq.substitutions.length === 1) {
      slot = leaveReq.substitutions[0];
    }

    if (!slot) {
      return res.status(404).json({ error: 'Substitution slot not found in leave request' });
    }

    // Direct assignment sets status to accepted (tentative, awaiting Principal final approval per LD9)
    slot.substituteTeacherId = subTeacher._id;
    slot.substituteTeacherTrackId = subTeacher.trackId;
    slot.substituteTeacherName = subTeacher.fullName || subTeacher.name;
    slot.status = 'accepted';
    slot.assignedBy = isActingHod || req.user.isHod ? 'hod' : (req.user.isTimeTableCoordinator ? 'ttc' : 'admin');
    slot.isUnresolved = false;
    slot.rejectionReason = '';
    if (reason) slot.notes = reason.trim();

    leaveReq.history.push({
      action: 'substitute_direct_assigned',
      actorId: req.user.trackId || String(req.user._id),
      actorName: req.user.fullName || req.user.name,
      actorRole: isActingHod ? 'acting_hod' : (req.user.isHod ? 'hod' : 'admin'),
      at: new Date(),
      comment: `Directly assigned ${subTeacher.fullName || subTeacher.name} to Period ${slot.periodNumber} on ${slot.date}. ${reason || ''}`.trim()
    });

    await leaveReq.save();

    // Notify substitute teacher
    await M.Notification.create({
      type: 'substitution-assigned',
      from: req.user.fullName || req.user.name,
      fromRole: 'hod',
      toTeacherTrackId: subTeacher.trackId,
      message: `You have been assigned as substitute for ${leaveReq.teacherName} (Period ${slot.periodNumber}, ${slot.date}) by HOD.`,
      priority: 'Normal',
      time: new Date()
    }).catch(() => {});

    await logAction(
      req.user.trackId || req.user._id,
      req.user.fullName || req.user.name,
      'controller',
      'Direct Substitute Assigned',
      `Assigned ${subTeacher.fullName || subTeacher.name} for ${leaveReq.teacherName} on ${slot.date} P${slot.periodNumber}`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId,
      {
        leaveRequestId: leaveReq.requestId || leaveReq._id,
        substituteTrackId: subTeacher.trackId,
        date: slot.date,
        period: slot.periodNumber
      }
    );

    res.json({ ok: true, message: 'Substitute assigned successfully', slot, leaveRequest: leaveReq });
  } catch (err) {
    console.error('Direct assign substitution error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/substitution/:id/accept or POST /api/substitution/accept
 * Substitute faculty accepts requested slot
 */
router.post(['/:id/accept', '/accept'], authMiddleware, async (req, res) => {
  try {
    const targetId = req.params.id || req.body.slotId || req.body.leaveId;
    const leaveId = req.body.leaveId;

    let leaveReq = null;
    let slot = null;

    if (leaveId) {
      leaveReq = await M.TeacherLeaveRequest.findOne({
        $or: [
          { _id: mongoose.isValidObjectId(leaveId) ? leaveId : undefined },
          { requestId: leaveId }
        ].filter(Boolean)
      });
      if (leaveReq) {
        slot = leaveReq.substitutions.find(s =>
          String(s._id) === String(targetId) ||
          (req.body.date && s.date === req.body.date && Number(s.periodNumber) === Number(req.body.periodNumber)) ||
          s.substituteTeacherTrackId === req.user.trackId
        );
      }
    }

    if (!slot) {
      // Search across requests with matching substitution subdocument ID
      leaveReq = await M.TeacherLeaveRequest.findOne({
        'substitutions._id': mongoose.isValidObjectId(targetId) ? targetId : undefined
      });
      if (leaveReq) {
        slot = leaveReq.substitutions.id(targetId);
      }
    }

    if (!slot) {
      // Fallback: search by current user's pending substitution
      leaveReq = await M.TeacherLeaveRequest.findOne({
        _id: mongoose.isValidObjectId(targetId) ? targetId : undefined,
        'substitutions.substituteTeacherTrackId': req.user.trackId
      });
      if (leaveReq) {
        slot = leaveReq.substitutions.find(s => s.substituteTeacherTrackId === req.user.trackId);
      }
    }

    if (!leaveReq || !slot) {
      return res.status(404).json({ error: 'Substitution request not found' });
    }

    // Verify authorized user
    if (slot.substituteTeacherTrackId !== req.user.trackId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Unauthorized: You are not the requested substitute' });
    }

    slot.status = 'accepted';
    slot.isUnresolved = false;

    leaveReq.history.push({
      action: 'substitution_accepted',
      actorId: req.user.trackId || String(req.user._id),
      actorName: req.user.fullName || req.user.name,
      actorRole: 'teacher',
      at: new Date(),
      comment: `Accepted substitution for Period ${slot.periodNumber} on ${slot.date}.`
    });

    await leaveReq.save();

    // Notify requesting teacher
    await M.Notification.create({
      type: 'substitution-accepted',
      from: req.user.fullName || req.user.name,
      fromRole: 'teacher',
      toTeacherTrackId: leaveReq.teacherTrackId,
      message: `${req.user.fullName || req.user.name} ACCEPTED your substitution request for ${slot.date} (Period ${slot.periodNumber}).`,
      priority: 'Normal',
      time: new Date()
    }).catch(() => {});

    res.json({ ok: true, message: 'Substitution accepted', slot });
  } catch (err) {
    console.error('Accept substitution error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/substitution/:id/reject or POST /api/substitution/reject
 * Substitute faculty rejects requested slot with mandatory reason
 */
router.post(['/:id/reject', '/reject'], authMiddleware, async (req, res) => {
  try {
    const targetId = req.params.id || req.body.slotId || req.body.leaveId;
    const leaveId = req.body.leaveId;
    const reason = sanitizeToString(req.body.reason || req.body.remarks);

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Rejection reason is mandatory' });
    }

    let leaveReq = null;
    let slot = null;

    if (leaveId) {
      leaveReq = await M.TeacherLeaveRequest.findOne({
        $or: [
          { _id: mongoose.isValidObjectId(leaveId) ? leaveId : undefined },
          { requestId: leaveId }
        ].filter(Boolean)
      });
      if (leaveReq) {
        slot = leaveReq.substitutions.find(s =>
          String(s._id) === String(targetId) ||
          (req.body.date && s.date === req.body.date && Number(s.periodNumber) === Number(req.body.periodNumber)) ||
          s.substituteTeacherTrackId === req.user.trackId
        );
      }
    }

    if (!slot) {
      leaveReq = await M.TeacherLeaveRequest.findOne({
        'substitutions._id': mongoose.isValidObjectId(targetId) ? targetId : undefined
      });
      if (leaveReq) {
        slot = leaveReq.substitutions.id(targetId);
      }
    }

    if (!leaveReq || !slot) {
      return res.status(404).json({ error: 'Substitution request not found' });
    }

    // Verify authorized user
    if (slot.substituteTeacherTrackId !== req.user.trackId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Unauthorized: You are not the requested substitute' });
    }

    slot.status = 'rejected';
    slot.rejectionReason = reason.trim();
    slot.isUnresolved = true;

    leaveReq.history.push({
      action: 'substitution_rejected',
      actorId: req.user.trackId || String(req.user._id),
      actorName: req.user.fullName || req.user.name,
      actorRole: 'teacher',
      at: new Date(),
      comment: `Rejected substitution for Period ${slot.periodNumber} on ${slot.date}. Reason: ${reason.trim()}`
    });

    await leaveReq.save();

    // Notify requesting teacher
    await M.Notification.create({
      type: 'substitution-rejected',
      from: req.user.fullName || req.user.name,
      fromRole: 'teacher',
      toTeacherTrackId: leaveReq.teacherTrackId,
      message: `${req.user.fullName || req.user.name} DECLINED your substitution request for ${slot.date} (Period ${slot.periodNumber}): "${reason.trim()}". Please request another teacher.`,
      priority: 'Normal',
      time: new Date()
    }).catch(() => {});

    res.json({ ok: true, message: 'Substitution rejected', slot });
  } catch (err) {
    console.error('Reject substitution error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/substitution/mine
 * List substitution requests and assignments for the logged-in teacher
 */
router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const trackId = req.user.trackId;
    if (!trackId) {
      return res.status(400).json({ error: 'User trackId not found' });
    }

    const requests = await M.TeacherLeaveRequest.find({
      'substitutions.substituteTeacherTrackId': trackId
    })
      .sort({ createdAt: -1 })
      .lean();

    const mySubstitutions = [];
    for (const r of requests) {
      for (const s of (r.substitutions || [])) {
        if (s.substituteTeacherTrackId === trackId) {
          mySubstitutions.push({
            leaveId: r._id,
            requestId: r.requestId || `FL-${r._id}`,
            teacherName: r.teacherName,
            teacherTrackId: r.teacherTrackId,
            leaveType: r.leaveType,
            leaveStatus: r.status,
            isEmergency: Boolean(r.isEmergency),
            slotId: s._id,
            date: s.date,
            day: s.day,
            periodNumber: s.periodNumber,
            className: s.className,
            subjectName: s.subjectName,
            subjectCode: s.subjectCode,
            hallNo: s.hallNo,
            status: s.status,
            assignedBy: s.assignedBy,
            notes: s.notes,
            rejectionReason: s.rejectionReason,
            createdAt: r.createdAt
          });
        }
      }
    }

    res.json({ ok: true, substitutions: mySubstitutions });
  } catch (err) {
    console.error('Get my substitutions error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
