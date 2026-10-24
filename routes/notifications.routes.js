const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, requirePage } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { isSudo } = require('../utils/access');

function getUserNotificationFilter(req) {
  const filter = {};
  if (req.user.role === 'teacher' || req.user.role === 'hod') {
    const teacherId = req.user._id;
    const teacherTrackId = req.user.trackId;
    filter.$or = [
      { toTeacherId: teacherId },
      { toTeacherTrackId: teacherTrackId },
      { toTeacherId: null, toTeacherTrackId: '', toStudentId: null, toStudentTrackId: '', type: { $nin: ['attendance-alert', 'leave-request', 'leave-approval', 'leave-rejection', 'timetable-verification'] } }
    ];
  } else if (req.user.role === 'student') {
    const studentIdentifiers = [req.user.trackId, String(req.user._id), req.user.username, req.user.registerNo].filter(Boolean);
    filter.$or = [
      { toStudentId: req.user._id },
      { toStudentTrackId: { $in: studentIdentifiers } }
    ];
  } else if (isSudo(req)) {
    filter.$and = [
      { type: { $nin: ['leave-request', 'leave-approval', 'leave-rejection', 'attendance-alert', 'timetable-verification'] } },
      { leaveRequestId: null },
      { timetableVersionId: null },
      { message: { $not: /timetable verification request/i } },
      { toTeacherId: null },
      { toStudentId: null },
      { toTeacherTrackId: { $in: ['', null] } },
      { toStudentTrackId: { $in: ['', null] } },
      { fromRole: { $ne: 'student' } }
    ];
  }
  return filter;
}

router.get('/', authMiddleware, async (req, res) => {
  const filter = getUserNotificationFilter(req);
  const docs = await M.Notification.find(filter).sort({ time: -1, createdAt: -1 }).limit(50).lean();
  const normalized = docs.map(d => {
    let effectiveStatus = d.status;
    if (d.read) {
      if (d.status !== 'Solved' && d.status !== 'Cancelled') {
        effectiveStatus = 'Read';
      }
    } else {
      if (d.type !== 'request' && !d.grievanceId) {
        effectiveStatus = 'Delivered';
      } else if (!effectiveStatus || effectiveStatus === 'Pending') {
        effectiveStatus = 'Pending';
      }
    }
    return {
      ...d,
      status: effectiveStatus || (d.read ? 'Read' : 'Delivered'),
      read: Boolean(d.read),
      readAt: d.readAt || null,
      time: d.time || d.createdAt || new Date()
    };
  });
  res.json(normalized);
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const rawMessage = String(req.body.message || '').trim();
    if (!rawMessage || rawMessage.length > 500) {
      return res.status(400).json({ error: 'Message is required and must not exceed 500 characters.' });
    }

    // Strip HTML tags server-side as defense-in-depth
    const cleanMessage = rawMessage.replace(/<[^>]*>/g, '');
    if (!cleanMessage) {
      return res.status(400).json({ error: 'Message contains invalid content.' });
    }

    // Restrict student access to admin queue (unaddressed notifications land in admin queue)
    const isToTeacher = req.body.toTeacherId || req.body.toTeacherTrackId;
    const isToStudent = req.body.toStudentId || req.body.toStudentTrackId;
    if (!isToTeacher && !isToStudent && req.user.role === 'student') {
      return res.status(403).json({ error: 'Students cannot send notifications directly to the admin queue.' });
    }

    const notif = await M.Notification.create({
      type:          req.body.type || 'request',
      from:          req.user.name || req.user.username,   // forced from JWT
      fromRole:      req.user.role,                        // forced from JWT
      message:       cleanMessage,
      priority:      req.body.priority || 'Normal',
      toTeacherId:   req.body.toTeacherId || null,
      toTeacherTrackId: req.body.toTeacherTrackId || '',
      toTeacherName: req.body.toTeacherName || '',
      toStudentId:   req.body.toStudentId || null,
      toStudentName: req.body.toStudentName || '',
      toStudentTrackId: req.body.toStudentTrackId || '',
      leaveRequestId:req.body.leaveRequestId || null,
      time:          new Date(),
    });
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Notification Sent',
      req.body.message?.slice(0, 80),
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: isSudo(req) ? 'admin' : (req.user.role === 'teacher' ? 'teacher' : 'student'),
        subType: 'action',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights
      }
    );
    res.status(201).json(notif);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Bulk delete all notifications (admin only)
router.delete('/all', authMiddleware, requirePage('control', 'delete', { tab: 'broadcasts' }), async (req, res) => {
  try {
    const result = await M.Notification.deleteMany({});
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Notifications Cleared',
      `All ${result.deletedCount} notifications deleted`,
      'data',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'action', trackId: req.user.trackId }
    );
    res.json({ deleted: result.deletedCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk mark all notifications as read for current user
router.put('/read-all', authMiddleware, async (req, res) => {
  try {
    const baseFilter = getUserNotificationFilter(req);
    const filter = {
      $and: [
        baseFilter,
        { read: { $ne: true } }
      ]
    };
    const now = new Date();
    const result = await M.Notification.updateMany(filter, {
      $set: {
        read: true,
        readAt: now
      }
    });

    // Also update status to 'Read' where not Solved or Cancelled
    await M.Notification.updateMany(
      { ...baseFilter, status: { $nin: ['Solved', 'Cancelled'] }, read: true },
      { $set: { status: 'Read' } }
    );

    res.json({ ok: true, message: 'All notifications marked as read', modifiedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const notif = await M.Notification.findById(req.params.id);
    if (!notif) return res.status(404).json({ error: 'Notification not found' });

    // Ownership check:
    if (req.user.role === 'student') {
      const isMine = (notif.toStudentId && String(notif.toStudentId) === String(req.user._id)) ||
                     (notif.toStudentTrackId && notif.toStudentTrackId === req.user.trackId);
      if (!isMine) return res.status(403).json({ error: 'Cannot update notifications addressed to others' });
      if (req.body.read !== undefined) {
        notif.read = Boolean(req.body.read);
        if (notif.read) {
          notif.readAt = new Date();
          if (notif.status !== 'Solved' && notif.status !== 'Cancelled') notif.status = 'Read';
        } else {
          notif.readAt = null;
          if (notif.status === 'Read') notif.status = 'Delivered';
        }
      }
      await notif.save();
      return res.json(notif);
    }
    if (req.user.role === 'teacher') {
      const isMine = (notif.toTeacherId && String(notif.toTeacherId) === String(req.user._id)) ||
                     (notif.toTeacherTrackId && notif.toTeacherTrackId === req.user.trackId) ||
                     (!notif.toTeacherId && !notif.toTeacherTrackId) ||
                     isSudo(req);
      if (!isMine) return res.status(403).json({ error: 'Cannot update notifications addressed to other teachers' });
    }

    // Whitelist updatable fields
    if (req.body.status) notif.status = req.body.status;
    if (req.body.read !== undefined) {
      notif.read = Boolean(req.body.read);
      if (notif.read) {
        notif.readAt = new Date();
        if (notif.status !== 'Solved' && notif.status !== 'Cancelled') notif.status = 'Read';
      } else {
        notif.readAt = null;
        if (notif.status === 'Read') notif.status = 'Delivered';
      }
    }
    if (req.body.status === 'Solved') notif.solvedAt = new Date();
    if (req.body.status === 'Cancelled') notif.cancelledAt = new Date();
    await notif.save();

    if (req.body.status === 'Solved' && notif.grievanceId) await M.Grievance.findByIdAndUpdate(notif.grievanceId, { status: 'Resolved', resolvedAt: new Date(), resolvedBy: req.user.name });
    if (req.body.status === 'Cancelled' && notif.grievanceId) await M.Grievance.findByIdAndUpdate(notif.grievanceId, { status: 'Cancelled', cancelledAt: new Date() });
    if (req.body.status === 'Solved' || req.body.status === 'Cancelled') {
      await logAction(
        req.user.trackId || req.user._id,
        req.user.name,
        req.user.role,
        'Notification ' + (req.body.status || 'Updated'),
        '',
        'data',
        'info',
        req.ip,
        req.user.sessionId,
        {
          module: isSudo(req) ? 'admin' : (req.user.role === 'teacher' ? 'teacher' : 'student'),
          subType: 'action',
          trackId: req.user.trackId
        }
      );
    }
    res.json(notif);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;