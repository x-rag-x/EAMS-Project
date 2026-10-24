const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { onStartClass } = require('../utils/sessionHooks');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { getTodayIST } = require('../middleware/scope');

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

    const sessions = await M.ClassSession.find({
      date: today,
      $or: [
        { 'actualTeacher.trackId': teacherTrackId },
        { 'scheduledTeacher.trackId': teacherTrackId }
      ]
    }).sort({ periodNumber: 1 }).lean();

    return res.json({
      ok: true,
      date: today,
      sessions
    });
  } catch (err) {
    console.error('[Get Today Sessions Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve today sessions' });
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
