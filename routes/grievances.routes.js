const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { checkModuleGuard } = require('../middleware/portalGuard');
const { sanitizeToString } = require('../utils/sanitizeQuery');

// ── GET /api/grievances — List Grievances ──
router.get('/', authMiddleware, async (req, res) => {
  try {
    const filter = {};
    if (req.user.role === 'teacher') {
      filter.teacherId = req.user._id;
    } else if (req.query.dept && req.query.dept !== 'all') {
      // Sudo admin / dept filter
      filter.teacherDept = req.query.dept;
    }

    if (req.query.status && req.query.status !== 'all') {
      filter.status = req.query.status;
    }
    if (req.query.category && req.query.category !== 'all') {
      filter.category = req.query.category;
    }
    if (req.query.priority && req.query.priority !== 'all') {
      filter.priority = req.query.priority;
    }

    const q = sanitizeToString(req.query.q);
    if (q) {
      filter.$or = [
        { subject: { $regex: q, $options: 'i' } },
        { detail: { $regex: q, $options: 'i' } },
        { teacherName: { $regex: q, $options: 'i' } },
        { category: { $regex: q, $options: 'i' } },
        { resolutionNote: { $regex: q, $options: 'i' } }
      ];
    }

    const grievances = await M.Grievance.find(filter).sort({ createdAt: -1 }).lean();
    return res.json(grievances);
  } catch (err) {
    console.error('[Get Grievances Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve grievances' });
  }
});

// ── POST /api/grievances — Create Grievance ──
router.post('/', authMiddleware, checkModuleGuard('modelGrievances', 'Grievances'), async (req, res) => {
  try {
    const subject = sanitizeToString(req.body.subject);
    const category = sanitizeToString(req.body.category) || 'Other';
    const detail = sanitizeToString(req.body.detail);
    const priority = ['Low', 'Normal', 'High', 'Urgent'].includes(req.body.priority) ? req.body.priority : 'Normal';
    const teacherDept = req.user.dept || req.user.department || req.user.deptCode || '';

    if (!subject || !detail) {
      return res.status(400).json({ error: 'Subject and detail are required' });
    }

    const grievance = await M.Grievance.create({
      subject,
      category,
      detail,
      priority,
      teacherId: req.user._id,
      teacherName: req.user.name,
      teacherDept,
      status: 'Pending'
    });

    // Notify admins
    await M.Notification.create({
      type: 'request',
      from: req.user.name,
      fromRole: 'Teacher',
      message: `[Grievance] ${subject} — ${detail.slice(0, 100)}`,
      time: new Date(),
      priority: priority === 'Urgent' ? 'Urgent' : (priority === 'High' ? 'High' : 'Normal'),
      grievanceId: grievance._id
    });

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Grievance Filed',
      subject,
      'data',
      priority === 'Urgent' ? 'warn' : 'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'teacher',
        subType: 'entry-create',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: null, after: grievance.toObject ? grievance.toObject() : grievance }
      }
    );

    return res.status(201).json(grievance);
  } catch (err) {
    console.error('[Create Grievance Error]:', err);
    return res.status(400).json({ error: err.message });
  }
});

// ── PATCH /api/grievances/:id — Resolve / Update Grievance Status ──
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const isAuthorized = ['admin', 'superAdmin', 'sudoAdmin'].includes(req.user.role) || req.user.isAdmin || req.user.isSuperAdmin;
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Only administrative personnel may resolve grievances' });
    }

    const grievance = await M.Grievance.findById(req.params.id);
    if (!grievance) {
      return res.status(404).json({ error: 'Grievance not found' });
    }

    const beforeState = grievance.toObject();
    const { status, resolutionNote } = req.body;

    if (status && ['Pending', 'In Progress', 'Resolved', 'Cancelled'].includes(status)) {
      grievance.status = status;
      if (status === 'Resolved') {
        grievance.resolvedBy = req.user.name || 'Admin';
        grievance.resolvedAt = new Date();
      } else if (status === 'Cancelled') {
        grievance.cancelledAt = new Date();
      }
    }

    if (resolutionNote !== undefined) {
      grievance.resolutionNote = sanitizeToString(resolutionNote);
    }

    await grievance.save();

    // Synchronize linked Admin Notification if any
    if (grievance.status === 'Resolved') {
      await M.Notification.updateMany(
        { grievanceId: grievance._id },
        { status: 'Solved' }
      );
    } else if (grievance.status === 'Cancelled') {
      await M.Notification.updateMany(
        { grievanceId: grievance._id },
        { status: 'Cancelled' }
      );
    }

    // Send notification back to teacher
    if (grievance.teacherId && (grievance.status === 'Resolved' || grievance.status === 'Cancelled')) {
      try {
        await M.Notification.create({
          type: grievance.status === 'Resolved' ? 'info' : 'warning',
          from: req.user.name || 'Admin',
          fromRole: 'Admin',
          to: grievance.teacherName,
          toUserId: grievance.teacherId,
          message: `[Grievance ${grievance.status}] ${grievance.subject}${grievance.resolutionNote ? ': ' + grievance.resolutionNote : ''}`,
          time: new Date(),
          priority: 'Normal',
          grievanceId: grievance._id
        });
      } catch (notifErr) {
        console.warn('[Teacher Grievance Notify Warning]:', notifErr.message);
      }
    }

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      `Grievance ${grievance.status}`,
      `Grievance "${grievance.subject}" marked as ${grievance.status}. Note: ${grievance.resolutionNote || 'None'}`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'grievance-resolve',
        trackId: req.user.trackId,
        actingWithAdminRights: true,
        changes: { before: beforeState, after: grievance.toObject() }
      }
    );

    return res.json({ ok: true, message: `Grievance updated to ${grievance.status}`, grievance });
  } catch (err) {
    console.error('[Update Grievance Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to update grievance' });
  }
});

module.exports = router;