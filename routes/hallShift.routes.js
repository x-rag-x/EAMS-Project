const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { isSudo, isSudoAdmin } = require('../utils/access');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { acceptHallShift } = require('../services/hallShiftService');

function isTtcOrAdmin(req) {
  if (!req.user) return false;
  if (isSudo(req) || isSudoAdmin(req.user) || req.user.role === 'admin') return true;
  if (req.user.isTimeTableCoordinator || req.user.isHod) return true;
  return false;
}

// GET /api/hall-shifts — list hall shifts
router.get('/', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) return res.status(403).json({ error: 'Access denied' });

    const filter = {};
    if (req.query.status) filter.status = sanitizeToString(req.query.status);
    if (req.query.date) filter.date = sanitizeToString(req.query.date);
    if (req.query.examId) filter.examId = sanitizeToString(req.query.examId);
    if (req.query.classId) filter.classId = sanitizeToString(req.query.classId);

    const shifts = await M.HallShift.find(filter)
      .populate('examId', 'title examType academicYear semester')
      .populate('currentHallId', 'hallNo name capacity')
      .populate('suggestedHalls.hallId', 'hallNo name capacity')
      .sort({ date: 1, createdAt: -1 })
      .lean();

    return res.json({ ok: true, data: shifts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/hall-shifts/:id/accept — accept a hall shift
router.post('/:id/accept', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) return res.status(403).json({ error: 'Access denied' });

    const actor = req.user.name || req.user.username || 'TTC';
    const chosenHallId = req.body.chosenHallId || null;

    const result = await acceptHallShift(req.params.id, actor, chosenHallId);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/hall-shifts/:id/release — release a hall shift
router.post('/:id/release', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) return res.status(403).json({ error: 'Access denied' });

    const shift = await M.HallShift.findById(req.params.id);
    if (!shift) return res.status(404).json({ error: 'Hall shift not found.' });

    shift.status = 'released';
    await shift.save();

    return res.json({ ok: true, message: 'Hall shift released.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
