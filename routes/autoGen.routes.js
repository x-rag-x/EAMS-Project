const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { isSudo, isSudoAdmin } = require('../utils/access');
const { logAction, getNextLogTrackId } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { normalizeYearRange } = require('../utils/yearFormat');
const { checkAutoGenReadiness } = require('../services/autoGenReadiness');
const { AutoGenEngine } = require('../services/autoGenEngine');
const { proposeAllocations, lockAllocations } = require('../services/staffAllocator');

/**
 * Authorization helper: TTC, HOD, or Admin
 */
function isTtcOrAdmin(req) {
  if (!req.user) return false;
  const u = req.user;
  if (isSudo(req || u) || isSudoAdmin(u) || u.role === 'admin') return true;
  if (u.isTimeTableCoordinator || u.isHod || u.isPrincipal) return true;
  if (Array.isArray(u.specials) && u.specials.some(s => s && (s.option === 'isHod' || s.option === 'isTimeTableCoordinator' || s.option === 'isPrincipal') && s.value !== false)) return true;
  if (req.access?.pages?.timetable || (typeof hasPageRight === 'function' && hasPageRight(u, 'timetable', 'view'))) return true;
  return false;
}

// ── 1. Readiness Check ──
// GET /api/autogen/readiness?deptId=&batch=&classId=&saturdayMode=
router.get('/readiness', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) {
      return res.status(403).json({ error: 'Access denied: Timetable Coordinator or HOD privileges required.' });
    }

    let rawDept = req.query.deptId ? sanitizeToString(req.query.deptId) : '';
    let deptId = null;
    if (rawDept && rawDept !== 'undefined' && rawDept !== 'null') {
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(rawDept)) {
        deptId = rawDept;
      } else {
        const dDoc = await M.Department.findOne({ code: new RegExp('^' + rawDept.trim() + '$', 'i') }).lean();
        if (dDoc) deptId = dDoc._id;
      }
    }
    if (!deptId && req.user?.deptId) {
      deptId = req.user.deptId;
    }

    let batch = req.query.batch ? normalizeYearRange(req.query.batch) : '';
    if (!batch || batch === 'undefined') {
      const latestSet = await M.SemesterSubjectSet.findOne().sort({ updatedAt: -1 }).lean();
      if (latestSet) batch = latestSet.batch;
    }

    const classId = (req.query.classId && req.query.classId !== 'undefined') ? sanitizeToString(req.query.classId) : null;
    const saturdayMode = req.query.saturdayMode === 'copy_weekday' ? 'copy_weekday' : 'separate';

    const result = await checkAutoGenReadiness({ deptId, batch, classId, saturdayMode });
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── 2. Staff Allocation (Phase 3) ──

// GET /api/autogen/allocation?batch=&deptId=
router.get('/allocation', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) return res.status(403).json({ error: 'Access denied' });

    const batch = req.query.batch ? normalizeYearRange(req.query.batch) : '';
    const deptId = req.query.deptId ? sanitizeToString(req.query.deptId) : (req.user.deptId || null);

    if (!batch) return res.status(400).json({ error: 'Batch query parameter is required.' });

    const result = await proposeAllocations({ batch, deptId });
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/autogen/allocation/override
router.post('/allocation/override', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) return res.status(403).json({ error: 'Access denied' });

    const { classId, subjectId, component = 'both', staffId, staffName, reason } = req.body;
    if (!classId || !subjectId || !staffId) {
      return res.status(400).json({ error: 'classId, subjectId, and staffId are required.' });
    }

    await logAction({
      action: 'OVERRIDE_FACULTY_ALLOCATION',
      category: 'TIMETABLE',
      details: { classId, subjectId, component, staffId, staffName, reason },
      user: req.user
    });

    return res.json({
      ok: true,
      message: 'Faculty allocation override applied successfully.',
      data: { classId, subjectId, component, staffId, staffName, reason: reason || 'HOD Manual Override' }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/autogen/allocation/lock
router.post('/allocation/lock', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) return res.status(403).json({ error: 'Access denied' });

    const { batch, deptId, allocations = [] } = req.body;
    if (!batch || !allocations.length) {
      return res.status(400).json({ error: 'Batch and non-empty allocations array are required.' });
    }

    const result = await lockAllocations({
      batch: normalizeYearRange(batch),
      deptId,
      allocations,
      user: req.user
    });

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


// POST /api/autogen/draft/save — save current development workspace snapshot
router.post('/draft/save', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name, batch, deptId, saturdayMode, pinnedWeekday, contents } = req.body;
    if (!name || !batch) {
      return res.status(400).json({ error: 'Draft name and batch are required.' });
    }

    const trackId = await getNextLogTrackId();
    const draft = new M.AutoGenDraft({
      trackId: `AGD-${trackId}`,
      name: sanitizeToString(name),
      batch: normalizeYearRange(batch),
      deptId: deptId || req.user.deptId,
      deptName: req.user.department || '',
      saturdayMode: saturdayMode === 'copy_weekday' ? 'copy_weekday' : 'separate',
      pinnedWeekday: sanitizeToString(pinnedWeekday || ''),
      contents: contents || {},
      status: 'saved',
      savedBy: req.user.name || req.user.username || 'TTC'
    });

    await draft.save();

    await logAction({
      action: 'SAVE_AUTOGEN_DRAFT',
      category: 'TIMETABLE',
      details: { draftId: draft._id, name: draft.name, batch: draft.batch },
      user: req.user
    });

    return res.json({ ok: true, message: 'Auto Gen draft saved successfully', data: draft });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/autogen/draft/init — initialize fresh development draft
router.post('/draft/init', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { batch, deptId, saturdayMode, pinnedWeekday } = req.body;
    if (!batch) return res.status(400).json({ error: 'Batch is required.' });

    const trackId = await getNextLogTrackId();
    const draft = new M.AutoGenDraft({
      trackId: `AGD-${trackId}`,
      name: `Active Draft (${normalizeYearRange(batch)})`,
      batch: normalizeYearRange(batch),
      deptId: deptId || req.user.deptId,
      deptName: req.user.department || '',
      saturdayMode: saturdayMode === 'copy_weekday' ? 'copy_weekday' : 'separate',
      pinnedWeekday: sanitizeToString(pinnedWeekday || ''),
      status: 'active',
      savedBy: req.user.name || req.user.username || 'TTC'
    });

    await draft.save();
    return res.json({ ok: true, data: draft });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/autogen/drafts — list saved drafts
router.get('/drafts', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const filter = {};
    if (req.query.deptId) filter.deptId = sanitizeToString(req.query.deptId);
    if (req.query.batch) filter.batch = normalizeYearRange(req.query.batch);

    const drafts = await M.AutoGenDraft.find(filter).sort({ updatedAt: -1 }).lean();
    return res.json({ ok: true, data: drafts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/autogen/drafts/:id/restore — restore saved draft
router.post('/drafts/:id/restore', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const draft = await M.AutoGenDraft.findById(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });

    draft.status = 'active';
    await draft.save();

    await logAction({
      action: 'RESTORE_AUTOGEN_DRAFT',
      category: 'TIMETABLE',
      details: { draftId: draft._id, name: draft.name },
      user: req.user
    });

    return res.json({ ok: true, message: 'Draft restored as active', data: draft });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/autogen/drafts/:id
router.delete('/drafts/:id', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const draft = await M.AutoGenDraft.findByIdAndDelete(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });

    return res.json({ ok: true, message: 'Draft deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── 4. Run Execution (Non-blocking async runner) ──

// POST /api/autogen/run/start
router.post('/run/start', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) {
      return res.status(403).json({ error: 'Access denied: Timetable Coordinator or HOD required.' });
    }

    const {
      draftId,
      deptId,
      batch,
      scope = 'single_class',
      targetClassId,
      effort = 'thorough',
      saturdayMode = 'separate',
      pinnedWeekday = 'Monday',
      combinedGroups = [],
      pinnedOrder = [],
      specialActivities = []
    } = req.body;

    if (!batch) {
      return res.status(400).json({ error: 'Batch is required to run auto-generation.' });
    }

    const trackId = await getNextLogTrackId();
    const run = new M.AutoGenRun({
      trackId: `AGR-${trackId}`,
      draftId: draftId || null,
      deptId: deptId || req.user.deptId,
      batch: normalizeYearRange(batch),
      scope: scope === 'batch' ? 'batch' : 'single_class',
      targetClassId: targetClassId || null,
      effort: ['quick', 'standard', 'thorough'].includes(effort) ? effort : 'thorough',
      saturdayMode: saturdayMode === 'copy_weekday' ? 'copy_weekday' : 'separate',
      combinedGroups,
      pinnedOrder,
      status: 'running',
      startedAt: new Date(),
      startedBy: req.user.name || req.user.username || 'TTC',
      log: [{ at: new Date(), msg: `Run initiated for ${scope === 'batch' ? 'whole batch' : 'single class'}` }]
    });

    await run.save();

    // Launch solver asynchronously without blocking the request loop
    setImmediate(async () => {
      try {
        let cls = null;
        if (targetClassId) {
          cls = await M.Class.findById(targetClassId).lean();
        }

        const engine = new AutoGenEngine({
          scope: run.scope,
          classId: targetClassId,
          className: cls ? (cls.name || cls.section) : 'Class',
          deptId: run.deptId,
          batch: run.batch,
          year: cls ? (cls.year || cls.currentYear || 'I') : 'I',
          semester: cls ? (cls.semester || 'I') : 'I',
          saturdayMode: run.saturdayMode,
          pinnedWeekday,
          effort: run.effort,
          combinedGroups,
          specialActivities
        });

        const result = await engine.solve();

        run.status = 'completed';
        run.completedAt = new Date();
        run.attempts = result.attempts || 1;
        run.bestScore = result.bestScore || 0;
        run.topVersions = result.topVersions || [];
        run.log.push({ at: new Date(), msg: `Generated ${run.topVersions.length} versions. Best score: ${run.bestScore}` });
        await run.save();
      } catch (solverErr) {
        run.status = 'failed';
        run.completedAt = new Date();
        run.log.push({ at: new Date(), msg: `Solver error: ${solverErr.message}` });
        await run.save();
      }
    });

    await logAction({
      action: 'START_AUTOGEN_RUN',
      category: 'TIMETABLE',
      details: { runId: run._id, trackId: run.trackId, scope, batch: run.batch },
      user: req.user
    });

    return res.json({
      ok: true,
      message: 'Auto-generation run started in background.',
      data: {
        runId: run._id,
        trackId: run.trackId,
        status: run.status
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/autogen/run/:runId/status
router.get('/run/:runId/status', authMiddleware, async (req, res) => {
  try {
    const run = await M.AutoGenRun.findById(req.params.runId).lean();
    if (!run) return res.status(404).json({ error: 'Run not found.' });

    return res.json({
      ok: true,
      data: {
        runId: run._id,
        trackId: run.trackId,
        status: run.status,
        attempts: run.attempts,
        bestScore: run.bestScore,
        topVersionsCount: (run.topVersions || []).length,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        log: run.log
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/autogen/run/:runId/stop
router.post('/run/:runId/stop', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) return res.status(403).json({ error: 'Access denied' });

    const run = await M.AutoGenRun.findById(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found.' });

    run.status = 'stopped';
    run.stoppedBy = req.user.name || req.user.username;
    run.completedAt = new Date();
    await run.save();

    return res.json({ ok: true, message: 'Run stopped successfully', data: run });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/autogen/run/:runId/versions
router.get('/run/:runId/versions', authMiddleware, async (req, res) => {
  try {
    const run = await M.AutoGenRun.findById(req.params.runId).lean();
    if (!run) return res.status(404).json({ error: 'Run not found.' });

    return res.json({
      ok: true,
      data: run.topVersions || []
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── 5. Keep & Apply Version ──

// POST /api/autogen/keep — Keep selected candidate version into development workspace
router.post('/keep', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) return res.status(403).json({ error: 'Access denied' });

    const { runId, versionIndex = 0, classId } = req.body;
    if (!runId) return res.status(400).json({ error: 'runId is required.' });

    const run = await M.AutoGenRun.findById(runId);
    if (!run) return res.status(404).json({ error: 'Run not found.' });

    const targetVersion = (run.topVersions || [])[versionIndex];
    if (!targetVersion) return res.status(404).json({ error: 'Selected version not found in this run.' });

    let appliedCount = 0;

    // A. Whole Batch mode: apply across all classes
    if (run.scope === 'batch' && targetVersion.batchGrids) {
      for (const [cId, grid] of Object.entries(targetVersion.batchGrids)) {
        let template = await M.SemesterTemplate.findOne({ classId: cId, status: 'draft' });
        if (!template) {
          template = new M.SemesterTemplate({
            classId: cId,
            status: 'draft',
            version: 1,
            versionName: `Auto-Gen Batch Dev (Score ${targetVersion.score})`,
            grid
          });
        } else {
          template.grid = grid;
          template.versionName = `Auto-Gen Batch Dev (Score ${targetVersion.score})`;
        }
        await template.save();

        let clsDoc = await M.Class.findById(cId).lean();
        const vDoc = new M.TimetableVersion({
          semesterTemplateId: template._id,
          classId: cId,
          className: clsDoc ? (clsDoc.name || clsDoc.section) : '',
          type: 'development',
          versionName: `Auto-Gen Batch v${versionIndex + 1} (Score ${targetVersion.score})`,
          label: `Auto-Gen Batch Candidate ${versionIndex + 1}`,
          changeSummary: `Applied Auto-Gen batch schedule with score ${targetVersion.score}`,
          snapshot: grid,
          status: 'draft',
          verificationStatus: 'none',
          savedBy: req.user.name || req.user.username
        });
        await vDoc.save();
        appliedCount++;
      }
    } else {
      // B. Single Class mode
      const targetClass = classId || run.targetClassId;
      if (targetClass) {
        let template = await M.SemesterTemplate.findOne({ classId: targetClass, status: 'draft' });
        if (!template) {
          template = new M.SemesterTemplate({
            classId: targetClass,
            status: 'draft',
            version: 1,
            versionName: `Auto-Gen Dev (Score ${targetVersion.score})`,
            grid: targetVersion.grid
          });
        } else {
          template.grid = targetVersion.grid;
          template.versionName = `Auto-Gen Dev (Score ${targetVersion.score})`;
        }
        await template.save();

        let clsDoc = await M.Class.findById(targetClass).lean();
        const versionDoc = new M.TimetableVersion({
          semesterTemplateId: template._id,
          classId: targetClass,
          className: clsDoc ? (clsDoc.name || clsDoc.section) : '',
          type: 'development',
          versionName: `Auto-Gen v${versionIndex + 1} (Score ${targetVersion.score})`,
          label: `Auto-Gen Candidate ${versionIndex + 1}`,
          changeSummary: `Applied Auto-Gen candidate with score ${targetVersion.score}`,
          snapshot: targetVersion.grid,
          status: 'draft',
          verificationStatus: 'none',
          savedBy: req.user.name || req.user.username
        });
        await versionDoc.save();
        appliedCount = 1;
      }
    }

    await logAction({
      action: 'KEEP_AUTOGEN_VERSION',
      category: 'TIMETABLE',
      details: { runId, versionIndex, score: targetVersion.score, scope: run.scope, appliedCount },
      user: req.user
    });

    return res.json({
      ok: true,
      message: `Version ${versionIndex + 1} kept and applied to development workspace (${appliedCount} section(s)).`,
      data: {
        score: targetVersion.score,
        scorecard: targetVersion.scorecard,
        appliedSectionsCount: appliedCount
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/autogen/submit-approval — Submit development draft for HOD approval
router.post('/submit-approval', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) return res.status(403).json({ error: 'Access denied' });

    const { classId, notes } = req.body;
    if (!classId) return res.status(400).json({ error: 'classId is required.' });

    const template = await M.SemesterTemplate.findOne({ classId, status: 'draft' });
    if (!template) return res.status(404).json({ error: 'No development template found for this class.' });

    template.status = 'pending_approval';
    await template.save();

    const tv = await M.TimetableVersion.findOne({ classId, type: 'development' }).sort({ createdAt: -1 });
    if (tv) {
      tv.status = 'pending_approval';
      tv.verificationStatus = 'pending';
      tv.verificationRequest = {
        requestedBy: req.user.name || req.user.username,
        requestedAt: new Date(),
        notes: notes || 'Submitted from Auto-Gen workspace for HOD verification'
      };
      await tv.save();
    }

    await logAction({
      action: 'SUBMIT_AUTOGEN_FOR_APPROVAL',
      category: 'TIMETABLE',
      details: { classId, notes },
      user: req.user
    });

    return res.json({ ok: true, message: 'Timetable submitted for HOD approval.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── 6. Version Diff against Production (Phase 3.6) ──

// GET /api/autogen/run/:runId/diff?versionIndex=0&classId=
router.get('/run/:runId/diff', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) return res.status(403).json({ error: 'Access denied' });

    const run = await M.AutoGenRun.findById(req.params.runId).lean();
    if (!run) return res.status(404).json({ error: 'Run not found.' });

    const vIdx = parseInt(req.query.versionIndex, 10) || 0;
    const version = (run.topVersions || [])[vIdx];
    if (!version) return res.status(404).json({ error: 'Candidate version not found.' });

    const classId = req.query.classId || run.targetClassId;
    let candidateSlots = [];
    if (run.scope === 'batch' && version.batchGrids && classId) {
      candidateSlots = version.batchGrids[String(classId)] || [];
    } else {
      candidateSlots = version.grid || [];
    }

    // Fetch active production template
    let prodSlots = [];
    if (classId) {
      const prodTemplate = await M.SemesterTemplate.findOne({ classId, status: 'published' }).lean();
      if (prodTemplate && Array.isArray(prodTemplate.grid)) {
        prodSlots = prodTemplate.grid;
      }
    }

    // Calculate diffs
    const addedSlots = [];
    const removedSlots = [];
    const changedFaculty = [];
    const changedRoom = [];

    const prodMap = new Map();
    prodSlots.forEach(s => prodMap.set(`${s.day}_${s.period}`, s));

    const candMap = new Map();
    candidateSlots.forEach(s => candMap.set(`${s.day}_${s.period}`, s));

    // Find new or changed
    candMap.forEach((cSlot, key) => {
      const pSlot = prodMap.get(key);
      if (!pSlot) {
        addedSlots.push(cSlot);
      } else {
        if (String(cSlot.teacherId || cSlot.teacher) !== String(pSlot.teacherId || pSlot.teacher)) {
          changedFaculty.push({ day: cSlot.day, period: cSlot.period, from: pSlot.teacher, to: cSlot.teacher });
        }
        if (String(cSlot.roomId || cSlot.room) !== String(pSlot.roomId || pSlot.room)) {
          changedRoom.push({ day: cSlot.day, period: cSlot.period, from: pSlot.room, to: cSlot.room });
        }
      }
    });

    // Find removed
    prodMap.forEach((pSlot, key) => {
      if (!candMap.has(key)) {
        removedSlots.push(pSlot);
      }
    });

    return res.json({
      ok: true,
      data: {
        versionScore: version.score,
        addedSlotsCount: addedSlots.length,
        removedSlotsCount: removedSlots.length,
        changedFacultyCount: changedFaculty.length,
        changedRoomCount: changedRoom.length,
        totalDiffCount: addedSlots.length + removedSlots.length + changedFaculty.length + changedRoom.length,
        addedSlots,
        removedSlots,
        changedFaculty,
        changedRoom
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── 7. Conflict Cards (Accept/Deny) ──

// In-memory or run-attached store for cards
const _activeCardsMap = new Map();

router.get('/run/:runId/conflicts', authMiddleware, async (req, res) => {
  const cards = _activeCardsMap.get(req.params.runId) || [];
  return res.json({ ok: true, data: cards });
});

router.post('/run/:runId/accept', authMiddleware, async (req, res) => {
  const { cardId } = req.body;
  const cards = _activeCardsMap.get(req.params.runId) || [];
  const card = cards.find(c => c.cardId === cardId);
  if (card) card.status = 'accepted';

  await logAction({
    action: 'ACCEPT_CONFLICT_CARD',
    category: 'TIMETABLE',
    details: { runId: req.params.runId, cardId },
    user: req.user
  });

  return res.json({ ok: true, message: 'Conflict card accepted', data: card });
});

router.post('/run/:runId/deny', authMiddleware, async (req, res) => {
  const { cardId } = req.body;
  const cards = _activeCardsMap.get(req.params.runId) || [];
  const card = cards.find(c => c.cardId === cardId);
  if (card) card.status = 'denied';

  await logAction({
    action: 'DENY_CONFLICT_CARD',
    category: 'TIMETABLE',
    details: { runId: req.params.runId, cardId },
    user: req.user
  });

  return res.json({ ok: true, message: 'Conflict card denied', data: card });
});

router.post('/run/:runId/undo', authMiddleware, async (req, res) => {
  const cards = _activeCardsMap.get(req.params.runId) || [];
  if (cards.length) cards[cards.length - 1].status = 'pending';
  return res.json({ ok: true, message: 'Card action undone' });
});


// ── 8. Hours Coverage Report (Phase 4.3) ──

// GET /api/autogen/coverage?classId=&batch=&semester=&deptId=
router.get('/coverage', authMiddleware, async (req, res) => {
  try {
    if (!isTtcOrAdmin(req)) return res.status(403).json({ error: 'Access denied' });

    const classId = req.query.classId ? sanitizeToString(req.query.classId) : null;
    const batch = req.query.batch ? normalizeYearRange(req.query.batch) : '';
    const semester = req.query.semester ? sanitizeToString(req.query.semester) : '';
    const deptId = req.query.deptId ? sanitizeToString(req.query.deptId) : null;

    let cls = null;
    let grid = [];

    if (classId) {
      cls = await M.Class.findById(classId).lean();
      const template = await M.SemesterTemplate.findOne({
        classId,
        status: { $in: ['published', 'draft', 'approved'] }
      }).sort({ updatedAt: -1 }).lean();

      if (template && Array.isArray(template.grid)) {
        grid = template.grid;
      }
    }

    // Default instructional horizon: 15 weeks / ~75 working days
    let instructionalWeeks = 15;
    let instructionalDays = 75;

    try {
      const workingDaysCount = await M.Calendar.countDocuments({ isHoliday: false, isInstructional: true });
      if (workingDaysCount > 40) {
        instructionalDays = workingDaysCount;
        instructionalWeeks = Math.round(workingDaysCount / 5);
      }
    } catch (_) {}

    // Group slots by subject
    const subjectHours = {};
    grid.forEach(slot => {
      const sName = slot.subject || 'Subject';
      const sId = slot.subjectId ? String(slot.subjectId) : sName;
      if (!subjectHours[sId]) {
        subjectHours[sId] = {
          subjectId: slot.subjectId || null,
          subjectName: sName,
          type: slot.type || (slot.isLab ? 'Lab' : 'Theory'),
          weeklyPeriods: 0
        };
      }
      subjectHours[sId].weeklyPeriods++;
    });

    // Resolve target slots from SemesterSubjectSet if available
    let sSet = null;
    if (batch) {
      let q = { batch };
      if (deptId) q.deptId = deptId;
      sSet = await M.SemesterSubjectSet.findOne(q).lean();
    }

    const subjectsCoverage = Object.values(subjectHours).map(item => {
      let targetSlots = item.weeklyPeriods;
      if (sSet && Array.isArray(sSet.subjects)) {
        const found = sSet.subjects.find(s => String(s.subjectId) === String(item.subjectId));
        if (found) targetSlots = found.slotsTarget || found.slotsMin || item.weeklyPeriods;
      }

      const projectedSemesterPeriods = item.weeklyPeriods * instructionalWeeks;
      const requiredPeriods = targetSlots * instructionalWeeks;
      const pct = requiredPeriods > 0 ? Math.round((projectedSemesterPeriods / requiredPeriods) * 100) : 100;

      let status = 'Optimal';
      if (pct < 75) status = 'Deficient';
      else if (pct < 90) status = 'At Risk';
      else if (pct < 100) status = 'Adequate';

      return {
        subjectId: item.subjectId,
        subjectName: item.subjectName,
        type: item.type,
        weeklyPeriods: item.weeklyPeriods,
        targetWeeklyPeriods: targetSlots,
        projectedSemesterPeriods,
        requiredPeriods,
        coveragePercentage: pct,
        status
      };
    });

    return res.json({
      ok: true,
      data: {
        classId: cls ? cls._id : classId,
        className: cls ? (cls.name || cls.section) : 'Class',
        instructionalWeeks,
        instructionalDays,
        subjectsCoverage
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
