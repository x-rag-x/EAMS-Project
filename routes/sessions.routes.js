const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { onStartClass } = require('../utils/sessionHooks');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { getTodayIST } = require('../middleware/scope');
const { deriveSessionState } = require('../utils/sessionState');
const { getSettings } = require('../utils/settingsCache');
const { logAction } = require('../utils/logAction');

router.use(authMiddleware);

/**
 * POST /api/sessions/start — Teacher taps ▶ Start Class with campus geofence check
 */
router.post('/start', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const sessionId = sanitizeToString(req.body.sessionId);
    const lat = req.body.lat !== undefined ? Number(req.body.lat) : null;
    const lng = req.body.lng !== undefined ? Number(req.body.lng) : null;
    const geoStatus = req.body.geo === 'denied' ? 'denied' : null;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const teacherTrackId = req.user.trackId || String(req.user._id);

    const result = await onStartClass({
      sessionId,
      teacherTrackId,
      lat,
      lng,
      geoStatus
    });

    return res.json({
      ok: true,
      message: 'Class session started successfully',
      session: result.session,
      geofence: result.geoResult
    });
  } catch (err) {
    console.error('[Session Start Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to start class session' });
  }
});

/**
 * GET /api/sessions/today — Retrieve today's teaching sessions for the logged-in teacher
 */
router.get('/today', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const today = getTodayIST();
    const teacherTrackId = req.user.trackId || String(req.user._id);

    const settings = await getSettings(['controller']);
    const ctrlSettings = settings?.controller || {};
    const deadlineMin = Number(ctrlSettings.attendanceDeadlineMin) || 10;
    const hardReminderEveryMin = Number(ctrlSettings.hardReminderEveryMin) || 5;

    const rawSessions = await M.ClassSession.find({
      date: today,
      $or: [
        { 'actualTeacher.trackId': teacherTrackId },
        { 'scheduledTeacher.trackId': teacherTrackId }
      ]
    }).sort({ periodNumber: 1 }).lean();

    const now = new Date();
    const sessions = rawSessions.map(session => {
      const derived = deriveSessionState(session, now, ctrlSettings);
      return {
        ...session,
        derived
      };
    });

    const overdueSessions = sessions.filter(s => s.derived?.isOverdue && !s.problemReport && s.status === 'scheduled');

    return res.json({
      ok: true,
      date: today,
      sessions,
      overdueSessions,
      overdueCount: overdueSessions.length,
      deadlineMin,
      hardReminderEveryMin
    });
  } catch (err) {
    console.error('[Get Today Sessions Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve today sessions' });
  }
});

/**
 * POST /api/sessions/report-problem — Teacher reports problem for overdue session to HOD
 */
router.post('/report-problem', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const sessionId = sanitizeToString(req.body.sessionId);
    const reason = sanitizeToString(req.body.reason) || 'Class not held';
    const note = sanitizeToString(req.body.note) || '';
    const teacherTrackId = req.user.trackId || String(req.user._id);

    let session = null;
    if (sessionId) {
      session = await M.ClassSession.findById(sessionId);
    }
    if (!session) {
      const today = getTodayIST();
      session = await M.ClassSession.findOne({
        date: today,
        status: 'scheduled',
        $or: [
          { 'actualTeacher.trackId': teacherTrackId },
          { 'scheduledTeacher.trackId': teacherTrackId }
        ],
        'attendance.savedAt': { $exists: false }
      }).sort({ periodNumber: 1 });
    }

    if (!session) {
      return res.status(404).json({ error: 'No active or overdue class session found' });
    }

    session.problemReport = {
      reportedAt: new Date(),
      reportedBy: teacherTrackId,
      reportedByName: req.user.name || 'Teacher',
      reason,
      note
    };
    session.updatedAt = new Date();
    await session.save();

    // Acknowledge any active A1 alert
    const alertKey = `A1:${session.date}:${session.classId}:${session.periodNumber}`;
    await M.Alert.findOneAndUpdate(
      { alertKey, status: 'active' },
      {
        status: 'acknowledged',
        notes: `Problem reported by teacher (${reason}): ${note}`,
        acknowledgedAt: new Date(),
        acknowledgedBy: req.user.name || 'Teacher'
      }
    );

    await logAction(
      req.user._id,
      req.user.name,
      req.user.role,
      'Class Problem Reported',
      `Problem reported for ${session.className} P${session.periodNumber}: ${reason}`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'attendance', subType: 'problem-report', sessionId: session._id, reason, note }
    );

    return res.json({
      ok: true,
      message: 'Problem report submitted to HOD successfully',
      session
    });
  } catch (err) {
    console.error('[Session Report Problem Error]:', err);
    return res.status(500).json({ error: 'Failed to submit problem report' });
  }
});

/**
 * GET /api/sessions/:id — Retrieve specific class session
 */
router.get('/:id', async (req, res) => {
  try {
    const session = await M.ClassSession.findById(req.params.id).lean();
    if (!session) {
      return res.status(404).json({ error: 'Class session not found' });
    }
    return res.json({ ok: true, session });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
