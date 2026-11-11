const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { isSudo, isSudoAdmin } = require('../utils/access');
const { logAction, getNextLogTrackId } = require('../utils/logAction');

const DEFAULT_RULES = [
  { designation: 'Professor', minPerWeek: 14, maxPerWeek: 18, maxPerDay: 4, maxInRow: 2, floorLoad: 8 },
  { designation: 'Associate Professor', minPerWeek: 16, maxPerWeek: 20, maxPerDay: 4, maxInRow: 3, floorLoad: 10 },
  { designation: 'Assistant Professor', minPerWeek: 18, maxPerWeek: 24, maxPerDay: 5, maxInRow: 3, floorLoad: 10 },
  { designation: 'Lecturer', minPerWeek: 18, maxPerWeek: 24, maxPerDay: 5, maxInRow: 3, floorLoad: 10 },
  { designation: 'Default', minPerWeek: 18, maxPerWeek: 24, maxPerDay: 5, maxInRow: 3, floorLoad: 10 }
];

// GET /api/workload-policy — list all or filter by deptId
router.get('/', authMiddleware, async (req, res) => {
  try {
    const filter = {};
    if (req.query.deptId) filter.deptId = req.query.deptId;
    const policies = await M.WorkloadPolicy.find(filter).populate('deptId', 'name code').lean();
    res.json({ ok: true, message: 'Workload policies retrieved', data: policies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/workload-policy/:deptId — get specific department policy (with fallback)
router.get('/:deptId', authMiddleware, async (req, res) => {
  try {
    const { deptId } = req.params;
    let policy = await M.WorkloadPolicy.findOne({ deptId }).populate('deptId', 'name code').lean();
    if (!policy) {
      const dept = await M.Department.findById(deptId).lean();
      policy = {
        deptId: dept ? dept._id : deptId,
        deptName: dept ? (dept.name || dept.code) : '',
        designationRules: DEFAULT_RULES,
        isDefault: true
      };
    }
    res.json({ ok: true, message: 'Policy retrieved', data: policy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/workload-policy/:deptId — update department workload policy
router.put('/:deptId', authMiddleware, async (req, res) => {
  try {
    const { deptId } = req.params;
    const { designationRules } = req.body;

    const canEdit = isSudo(req) || isSudoAdmin(req.user) ||
      (req.user.isHod && String(req.user.deptId || '') === String(deptId));

    if (!canEdit) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions to edit workload policy' });
    }

    if (!Array.isArray(designationRules) || designationRules.length === 0) {
      return res.status(400).json({ error: 'designationRules array is required' });
    }

    const dept = await M.Department.findById(deptId).lean();
    const deptName = dept ? (dept.name || dept.code) : '';
    const actorName = req.user.name || req.user.fullName || req.user.username || 'Admin';

    const policy = await M.WorkloadPolicy.findOneAndUpdate(
      { deptId },
      {
        $set: {
          deptId,
          deptName,
          designationRules,
          updatedBy: actorName
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    const nextLogTrackId = await getNextLogTrackId();
    await logAction(
      req.user.trackId,
      actorName,
      req.user.role || 'admin',
      'Workload Policy Updated',
      `Updated workload policy for department ${deptName}`,
      'timetable',
      'info',
      req.ip,
      req.user.sessionId,
      { deptId, policyId: policy._id, trackId: nextLogTrackId }
    );

    res.json({ ok: true, message: 'Workload policy updated', data: policy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
