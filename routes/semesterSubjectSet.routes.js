const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { isSudo, isSudoAdmin } = require('../utils/access');
const { logAction, getNextLogTrackId } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { normalizeYearRange } = require('../utils/yearFormat');
const { computeCapacity } = require('../services/capacityMeter');

/**
 * Permissions:
 * - Draft creation/editing: Department HOD, Timetable Coordinator, or Super/Sudo Admin
 * - Approval and Locking: Department HOD or Super/Sudo Admin only
 */
function canEditDraft(req, deptId) {
  if (!req.user) return false;
  if (isSudo(req) || isSudoAdmin(req.user) || req.user.role === 'admin') return true;
  if (req.user.isHod || req.user.isTimeTableCoordinator) {
    if (!deptId) return true;
    return String(req.user.deptId || '') === String(deptId);
  }
  return false;
}

function canApproveOrLock(req, deptId) {
  if (!req.user) return false;
  if (isSudo(req) || isSudoAdmin(req.user) || req.user.role === 'admin') return true;
  if (req.user.isHod) {
    if (!deptId) return true;
    return String(req.user.deptId || '') === String(deptId);
  }
  return false;
}

// GET /api/semester-sets — list sets
router.get('/', authMiddleware, async (req, res) => {
  try {
    const filter = {};
    if (req.query.deptId) filter.deptId = sanitizeToString(req.query.deptId);
    if (req.query.batch) filter.batch = normalizeYearRange(req.query.batch);
    if (req.query.year) filter.year = sanitizeToString(req.query.year);
    if (req.query.semester) filter.semester = sanitizeToString(req.query.semester);
    if (req.query.regulation) filter.regulation = sanitizeToString(req.query.regulation);
    if (req.query.status) filter.status = sanitizeToString(req.query.status);

    const sets = await M.SemesterSubjectSet.find(filter)
      .populate('deptId', 'name code')
      .populate('classIds', 'name grade section')
      .populate('subjects.subjectId', 'name code shortName type credits category')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ ok: true, message: 'Semester sets retrieved', data: sets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/semester-sets/:id — single set
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const set = await M.SemesterSubjectSet.findById(req.params.id)
      .populate('deptId', 'name code')
      .populate('classIds', 'name grade section')
      .populate('subjects.subjectId', 'name code shortName type credits category blockLength isBlend blendTheorySlots blendLabSlots')
      .populate('subjects.teachingDeptId', 'name code')
      .populate('combinedGroups.subjectId', 'name code shortName')
      .populate('combinedGroups.classIds', 'name grade section')
      .populate('perClassOverrides.classId', 'name grade section')
      .populate('perClassOverrides.subjectId', 'name code shortName')
      .lean();

    if (!set) return res.status(404).json({ error: 'Semester subject set not found' });
    res.json({ ok: true, message: 'Semester set retrieved', data: set });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/semester-sets/:id/capacity — capacity meter analysis
router.get('/:id/capacity', authMiddleware, async (req, res) => {
  try {
    const set = await M.SemesterSubjectSet.findById(req.params.id).lean();
    if (!set) return res.status(404).json({ error: 'Semester subject set not found' });

    const satMode = req.query.saturdayMode || 'separate';
    const capacity = computeCapacity(set, satMode);
    res.json({ ok: true, message: 'Capacity computed', data: capacity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/semester-sets/:id/diff — diff against regulation master catalog
router.get('/:id/diff', authMiddleware, async (req, res) => {
  try {
    const set = await M.SemesterSubjectSet.findById(req.params.id).populate('subjects.subjectId').lean();
    if (!set) return res.status(404).json({ error: 'Semester subject set not found' });

    // Find all catalog subjects under this regulation and department
    const catalogSubjects = await M.Subject.find({
      regulation: set.regulation,
      deptId: set.deptId
    }).lean();

    const setSubjectIds = new Set((set.subjects || []).map(s => String(s.subjectId?._id || s.subjectId)));

    const inCatalogOnly = catalogSubjects.filter(c => !setSubjectIds.has(String(c._id)));
    const inSet = set.subjects || [];

    res.json({
      ok: true,
      message: 'Diff computed',
      data: {
        totalCatalog: catalogSubjects.length,
        totalInSet: inSet.length,
        missingFromSet: inCatalogOnly,
        subjectsInSet: inSet
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/semester-sets — create draft set
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      regulation,
      deptId,
      batch,
      year,
      semester,
      classIds,
      subjects,
      perClassOverrides,
      combinedGroups
    } = req.body;

    if (!regulation || !deptId || !batch || !year || !semester) {
      return res.status(400).json({ error: 'regulation, deptId, batch, year, and semester are required' });
    }

    if (!canEditDraft(req, deptId)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions to create semester sets for this department' });
    }

    const normBatch = normalizeYearRange(batch);
    const existing = await M.SemesterSubjectSet.findOne({
      deptId,
      batch: normBatch,
      year,
      semester
    }).lean();

    if (existing) {
      return res.status(400).json({
        error: `A semester subject set already exists for ${normBatch} Year ${year} Semester ${semester}`
      });
    }

    const deptObj = await M.Department.findById(deptId).lean();
    const deptName = deptObj ? (deptObj.name || deptObj.code) : '';
    const trackId = `TR-SET-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const actorName = req.user.name || req.user.fullName || req.user.username || 'Admin';

    const newSet = await M.SemesterSubjectSet.create({
      trackId,
      regulation: regulation.trim(),
      deptId,
      deptName,
      batch: normBatch,
      year,
      semester,
      classIds: Array.isArray(classIds) ? classIds : [],
      subjects: Array.isArray(subjects) ? subjects : [],
      perClassOverrides: Array.isArray(perClassOverrides) ? perClassOverrides : [],
      combinedGroups: Array.isArray(combinedGroups) ? combinedGroups : [],
      status: 'Draft',
      approvalLog: [{
        action: 'Created',
        by: actorName,
        comment: 'Initial draft semester subject set created'
      }],
      createdBy: actorName
    });

    const nextLogTrackId = await getNextLogTrackId();
    await logAction(
      req.user.trackId,
      actorName,
      req.user.role || 'admin',
      'Semester Subject Set Created',
      `${deptName} ${normBatch} Year ${year} Sem ${semester}`,
      'timetable',
      'info',
      req.ip,
      req.user.sessionId,
      { trackId: nextLogTrackId, setId: newSet._id }
    );

    res.status(201).json({ ok: true, message: 'Semester subject set created', data: newSet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/semester-sets/:id — update set (only allowed if not Locked)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const set = await M.SemesterSubjectSet.findById(req.params.id);
    if (!set) return res.status(404).json({ error: 'Semester subject set not found' });

    if (set.status === 'Locked') {
      return res.status(400).json({
        error: 'This semester subject set is Locked. Use the amend endpoint to make changes with required HOD approval.'
      });
    }

    if (!canEditDraft(req, set.deptId)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions to edit this set' });
    }

    const {
      regulation,
      classIds,
      subjects,
      perClassOverrides,
      combinedGroups
    } = req.body;

    if (regulation !== undefined) set.regulation = regulation.trim();
    if (classIds !== undefined) set.classIds = classIds;
    if (subjects !== undefined) set.subjects = subjects;
    if (perClassOverrides !== undefined) set.perClassOverrides = perClassOverrides;
    if (combinedGroups !== undefined) set.combinedGroups = combinedGroups;

    await set.save();

    res.json({ ok: true, message: 'Semester subject set updated', data: set });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/semester-sets/:id/submit — submit draft for HOD approval
router.post('/:id/submit', authMiddleware, async (req, res) => {
  try {
    const set = await M.SemesterSubjectSet.findById(req.params.id);
    if (!set) return res.status(404).json({ error: 'Set not found' });

    if (!canEditDraft(req, set.deptId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (set.status !== 'Draft') {
      return res.status(400).json({ error: `Cannot submit a set with status "${set.status}"` });
    }

    const actorName = req.user.name || req.user.fullName || req.user.username || 'Admin';
    set.status = 'Submitted';
    set.approvalLog.push({
      action: 'Submitted',
      by: actorName,
      comment: req.body.comment || 'Submitted for HOD approval'
    });

    await set.save();
    res.json({ ok: true, message: 'Set submitted for HOD approval', data: set });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/semester-sets/:id/approve — HOD approval
router.post('/:id/approve', authMiddleware, async (req, res) => {
  try {
    const set = await M.SemesterSubjectSet.findById(req.params.id);
    if (!set) return res.status(404).json({ error: 'Set not found' });

    if (!canApproveOrLock(req, set.deptId)) {
      return res.status(403).json({ error: 'Forbidden: Only the department HOD or Super Admin can approve semester subject sets' });
    }

    if (set.status !== 'Submitted') {
      return res.status(400).json({ error: `Cannot approve a set with status "${set.status}" (must be Submitted)` });
    }

    const actorName = req.user.name || req.user.fullName || req.user.username || 'Admin';
    set.status = 'HOD_Approved';
    set.approvalLog.push({
      action: 'HOD_Approved',
      by: actorName,
      comment: req.body.comment || 'Approved by HOD'
    });

    await set.save();

    const nextLogTrackId = await getNextLogTrackId();
    await logAction(
      req.user.trackId,
      actorName,
      req.user.role || 'admin',
      'Semester Subject Set Approved',
      `${set.deptName} ${set.batch} Year ${set.year} Sem ${set.semester}`,
      'timetable',
      'info',
      req.ip,
      req.user.sessionId,
      { trackId: nextLogTrackId, setId: set._id }
    );

    res.json({ ok: true, message: 'Semester subject set approved by HOD', data: set });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/semester-sets/:id/lock — lock semester subject set (ready for Auto Gen)
router.post('/:id/lock', authMiddleware, async (req, res) => {
  try {
    const set = await M.SemesterSubjectSet.findById(req.params.id);
    if (!set) return res.status(404).json({ error: 'Set not found' });

    if (!canApproveOrLock(req, set.deptId)) {
      return res.status(403).json({ error: 'Forbidden: Only the department HOD or Super Admin can lock semester subject sets' });
    }

    if (set.status !== 'HOD_Approved') {
      return res.status(400).json({ error: `Cannot lock a set with status "${set.status}" (must be HOD_Approved first)` });
    }

    const actorName = req.user.name || req.user.fullName || req.user.username || 'Admin';
    set.status = 'Locked';
    set.lockedAt = new Date();
    set.lockedBy = actorName;
    set.approvalLog.push({
      action: 'Locked',
      by: actorName,
      comment: req.body.comment || 'Locked for timetable auto-generation'
    });

    await set.save();

    const nextLogTrackId = await getNextLogTrackId();
    await logAction(
      req.user.trackId,
      actorName,
      req.user.role || 'admin',
      'Semester Subject Set Locked',
      `${set.deptName} ${set.batch} Year ${set.year} Sem ${set.semester}`,
      'timetable',
      'info',
      req.ip,
      req.user.sessionId,
      { trackId: nextLogTrackId, setId: set._id }
    );

    res.json({ ok: true, message: 'Semester subject set locked successfully', data: set });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/semester-sets/:id/amend — unlock with amendment reason
router.post('/:id/amend', authMiddleware, async (req, res) => {
  try {
    const set = await M.SemesterSubjectSet.findById(req.params.id);
    if (!set) return res.status(404).json({ error: 'Set not found' });

    if (!canApproveOrLock(req, set.deptId)) {
      return res.status(403).json({ error: 'Forbidden: Only the HOD or Super Admin can amend locked sets' });
    }

    const reason = req.body.reason;
    if (!reason || reason.trim() === '') {
      return res.status(400).json({ error: 'Amendment reason is required' });
    }

    const actorName = req.user.name || req.user.fullName || req.user.username || 'Admin';
    set.status = 'Draft';
    set.lockedAt = null;
    set.lockedBy = '';
    set.approvalLog.push({
      action: 'Amended',
      by: actorName,
      amendment: true,
      reason: reason.trim(),
      comment: `Unlocked for amendment: ${reason.trim()}`
    });

    await set.save();

    const nextLogTrackId = await getNextLogTrackId();
    await logAction(
      req.user.trackId,
      actorName,
      req.user.role || 'admin',
      'Semester Subject Set Amended',
      `Reason: ${reason.trim()}`,
      'timetable',
      'warning',
      req.ip,
      req.user.sessionId,
      { trackId: nextLogTrackId, setId: set._id }
    );

    res.json({ ok: true, message: 'Set unlocked for amendment', data: set });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/semester-sets/:id/clone — clone from existing set
router.post('/:id/clone', authMiddleware, async (req, res) => {
  try {
    const source = await M.SemesterSubjectSet.findById(req.params.id).lean();
    if (!source) return res.status(404).json({ error: 'Source set not found' });

    const { targetBatch, targetYear, targetSemester } = req.body;
    if (!targetBatch || !targetYear || !targetSemester) {
      return res.status(400).json({ error: 'targetBatch, targetYear, and targetSemester required' });
    }

    if (!canEditDraft(req, source.deptId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const normBatch = normalizeYearRange(targetBatch);
    const existing = await M.SemesterSubjectSet.findOne({
      deptId: source.deptId,
      batch: normBatch,
      year: targetYear,
      semester: targetSemester
    }).lean();

    if (existing) {
      return res.status(400).json({
        error: `A semester subject set already exists for ${normBatch} Year ${targetYear} Semester ${targetSemester}`
      });
    }

    const trackId = `TR-SET-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const actorName = req.user.name || req.user.fullName || req.user.username || 'Admin';

    const cloned = await M.SemesterSubjectSet.create({
      trackId,
      regulation: source.regulation,
      deptId: source.deptId,
      deptName: source.deptName,
      batch: normBatch,
      year: targetYear,
      semester: targetSemester,
      classIds: [],
      subjects: source.subjects || [],
      perClassOverrides: [],
      combinedGroups: [],
      status: 'Draft',
      clonedFrom: source._id,
      approvalLog: [{
        action: 'Created',
        by: actorName,
        comment: `Cloned from set ${source.trackId} (${source.batch} Y${source.year} S${source.semester})`
      }],
      createdBy: actorName
    });

    res.status(201).json({ ok: true, message: 'Semester set cloned successfully', data: cloned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/semester-sets/:id — delete draft
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const set = await M.SemesterSubjectSet.findById(req.params.id);
    if (!set) return res.status(404).json({ error: 'Set not found' });

    if (set.status === 'Locked') {
      return res.status(400).json({ error: 'Cannot delete a Locked semester subject set. Amend it first.' });
    }

    if (!canEditDraft(req, set.deptId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await M.SemesterSubjectSet.findByIdAndDelete(req.params.id);

    const actorName = req.user.name || req.user.fullName || req.user.username || 'Admin';
    const nextLogTrackId = await getNextLogTrackId();
    await logAction(
      req.user.trackId,
      actorName,
      req.user.role || 'admin',
      'Semester Subject Set Deleted',
      `${set.deptName} ${set.batch} Year ${set.year} Sem ${set.semester}`,
      'timetable',
      'warning',
      req.ip,
      req.user.sessionId,
      { trackId: nextLogTrackId, setId: set._id }
    );

    res.json({ ok: true, message: 'Semester subject set deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
