/**
 * services/timetableDeploy.js
 *
 * One unified deployment pipeline (D8) for production timetables.
 * Input: an approved TimetableCommit (or commit trackId/doc)
 * Output: DeployRun with per-stage results.
 *
 * Stages:
 *  0 - Gate
 *  1 - Write (atomic transaction)
 *  2 - Link staff & subjects, create assignments
 *  3 - Combined classes
 *  4 - Boards
 *  5 - Notifications
 *  6 - Teacher matrix refresh & DayInstance cache reset
 *  7 - Finalize
 */

const mongoose = require('mongoose');
const M = require('../models');
const { diffGrids } = require('./timetableDiff');
const { invalidateProductionCache } = require('../utils/teacherSchedule');
const bellScheduler = require('./bellScheduler');
const { logAction } = require('../utils/logAction');
const { resolveHodTeacher } = require('../utils/timetableResolver');
const { todayInInstitutionTz } = require('../utils/institutionTime');
const { detectConflictsV2 } = require('./timetableConflicts');

/**
 * Convert a timetable grid array into a SectionTimetable.slots object
 */
function gridToSlotsObj(grid = [], className = '') {
  const slots = {};
  if (!Array.isArray(grid)) return slots;

  for (const item of grid) {
    if (!item || !item.day || item.period === undefined || item.period === null) continue;
    const startPeriod = typeof item.period === 'number'
      ? item.period
      : (parseInt(String(item.period).replace(/\D/g, ''), 10) || 1);
    const span = Math.max(1, Number(item.span || item.duration || 1));
    const isLab = Boolean(item.isLab ?? (item.type === 'Lab' || span > 1));
    const combinedWith = Array.isArray(item.combinedWith)
      ? item.combinedWith.filter(Boolean)
      : (item.combinedWith ? [String(item.combinedWith)] : []);
    const type = item.type || (isLab ? 'Lab' : (combinedWith.length > 0 ? 'Combined' : 'Theory'));

    for (let offset = 0; offset < span; offset++) {
      const currentPeriod = startPeriod + offset;
      const key = `${item.day}_${currentPeriod}`;
      slots[key] = {
        day: item.day,
        period: currentPeriod,
        subject: item.subject || '',
        subjectId: item.subjectId || null,
        subjectCode: item.subjectCode || '',
        teacher: item.teacher || '',
        teacherId: item.teacherId || null,
        teacherTrackId: item.teacherTrackId || '',
        room: item.room || '',
        roomId: item.roomId || undefined,
        span,
        spanRootPeriod: startPeriod,
        spanIndex: offset,
        isSpanContinuation: offset > 0,
        isLab,
        type,
        combinedWith,
        state: item.state || '',
        activityId: item.activityId || null,
        activityLabel: item.activityLabel || '',
        combinedGroupId: item.combinedGroupId || null
      };
    }
  }
  return slots;
}

/**
 * Execute the 8-stage deployment pipeline for a TimetableCommit
 *
 * @param {string|Object} commitIdOrDoc - TimetableCommit document, _id, or trackId
 * @param {Object} [options]
 * @param {Object} [options.actor] - User initiating the deploy
 * @param {Map|Object} [options.classGrids] - Optional map of classId -> grid (e.g. from legacy publish adapter)
 * @param {Object} [options.injectedFailure] - For test verification: { stage: Number, error: String }
 * @param {boolean} [options.autoApprove] - Automatically approve if exempt/legacy
 * @returns {Promise<Object>} { ok, commit, deployRun, error }
 */
async function executeDeployPipeline(commitIdOrDoc, options = {}) {
  const { actor = {}, classGrids = {}, injectedFailure = null, autoApprove = false } = options;

  // 1. Resolve commit document
  let commit = null;
  if (typeof commitIdOrDoc === 'string') {
    commit = await M.TimetableCommit.findOne({
      $or: [{ trackId: commitIdOrDoc }, { _id: mongoose.isValidObjectId(commitIdOrDoc) ? commitIdOrDoc : null }]
    });
  } else if (commitIdOrDoc && (commitIdOrDoc._id || commitIdOrDoc.trackId)) {
    commit = commitIdOrDoc;
  }
  if (!commit) {
    throw new Error('TimetableCommit record not found');
  }

  // 2. Initialize DeployRun
  const initialStages = [
    { key: 0, label: 'Gate', status: 'pending', retryable: false },
    { key: 1, label: 'Write', status: 'pending', retryable: false },
    { key: 2, label: 'Link & assignments', status: 'pending', retryable: true },
    { key: 3, label: 'Combined classes', status: 'pending', retryable: true },
    { key: 4, label: 'Boards', status: 'pending', retryable: true },
    { key: 5, label: 'Notifications', status: 'pending', retryable: true },
    { key: 6, label: 'Teacher matrix & Day cache', status: 'pending', retryable: true },
    { key: 7, label: 'Finalize', status: 'pending', retryable: false }
  ];

  const deployRun = await M.DeployRun.create({
    commitTrackId: commit.trackId,
    startedBy: {
      id: actor.id || actor._id || commit.author?.id || null,
      name: actor.name || commit.author?.name || 'System',
      trackId: actor.trackId || commit.author?.trackId || ''
    },
    status: 'running',
    stages: initialStages,
    report: {
      assignments: { created: 0, updated: 0, repointed: 0, removed: 0, orphans: [] },
      boards: { rooms: 0, pushed: 0, failed: 0 },
      notifications: { teachers: 0, students: 0, hods: 0, supportingHods: 0 },
      cache: { invalidated: false }
    }
  });

  commit.deployRunId = deployRun._id;
  await commit.save();

  function updateStage(key, status, extra = {}) {
    const stage = deployRun.stages.find(s => s.key === key);
    if (stage) {
      stage.status = status;
      if (status === 'running') stage.startedAt = new Date();
      if (['success', 'warning', 'failed'].includes(status)) stage.finishedAt = new Date();
      if (extra.error) stage.error = extra.error;
      if (extra.counts) stage.counts = extra.counts;
      if (extra.retryable !== undefined) stage.retryable = extra.retryable;
    }
  }

  // Fetch grids for all classes in this commit
  const resolvedClassGrids = new Map();
  for (const cId of commit.classIds) {
    const sId = String(cId);
    if (classGrids[sId]) {
      resolvedClassGrids.set(sId, classGrids[sId]);
    } else if (commit.workspaceId && M.WorkspaceClassDraft) {
      const draft = await M.WorkspaceClassDraft.findOne({ workspaceId: commit.workspaceId, classId: cId }).lean();
      if (draft && draft.grid) resolvedClassGrids.set(sId, draft.grid);
    } else {
      // Fallback: check SemesterTemplate or existing SectionTimetable
      const tmpl = await M.SemesterTemplate.findOne({ classId: cId, status: { $in: ['approved', 'published', 'draft'] } }).sort({ updatedAt: -1 }).lean();
      if (tmpl && tmpl.grid) {
        resolvedClassGrids.set(sId, tmpl.grid);
      } else {
        const sec = await M.SectionTimetable.findOne({ classId: cId }).lean();
        resolvedClassGrids.set(sId, Object.values(sec?.slots || {}));
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // STAGE 0: GATE
  // ─────────────────────────────────────────────────────────────
  updateStage(0, 'running');
  try {
    if (injectedFailure && injectedFailure.stage === 0) {
      throw new Error(injectedFailure.error || 'Simulated failure at Stage 0 (Gate)');
    }

    if (autoApprove && commit.status === 'pending_approval') {
      commit.status = 'approved';
      commit.approver = {
        id: actor.id || actor._id || null,
        name: actor.name || 'System Auto-Approve',
        trackId: actor.trackId || '',
        at: new Date(),
        comment: 'Auto-approved via privileged publish'
      };
    }

    if (commit.status !== 'approved') {
      throw new Error(`Gate failed: Commit ${commit.trackId} has status '${commit.status}', must be 'approved'`);
    }

    // Check scheduled go-live: forward only
    if (commit.goLiveAt && new Date(commit.goLiveAt) > new Date()) {
      throw new Error(`Gate stopped: Scheduled go-live time (${commit.goLiveAt.toISOString()}) is in the future`);
    }

    // Stale-base check: ensure none of the classes have moved under us
    if (commit.resolution !== 'keep-mine' && commit.workspaceId && M.WorkspaceClassDraft) {
      for (const cId of commit.classIds) {
        const draft = await M.WorkspaceClassDraft.findOne({ workspaceId: commit.workspaceId, classId: cId }).lean();
        const sec = await M.SectionTimetable.findOne({ classId: cId }).lean();
        if (draft && sec && sec.headTrackId && draft.baseTrackId && draft.baseTrackId !== sec.headTrackId) {
          throw new Error(`Gate failed: Class ${draft.className || cId} has stale base (${draft.baseTrackId} vs head ${sec.headTrackId})`);
        }
      }
    }

    // Conflict Engine v2 Hard Gate
    if (commit.workspaceId) {
      const conflicts = await detectConflictsV2({
        workspaceId: commit.workspaceId,
        classIds: commit.classIds,
        checkUnresolved: true
      });
      const hardConflicts = conflicts.filter(c => c.severity === 'hard');
      if (hardConflicts.length > 0) {
        throw new Error(`Gate failed: ${hardConflicts.length} hard conflict(s) detected: ${hardConflicts[0].message}`);
      }
    }

    updateStage(0, 'success', { counts: { classes: commit.classIds.length } });
  } catch (err) {
    updateStage(0, 'failed', { error: err.message });
    deployRun.status = 'failed';
    deployRun.finishedAt = new Date();
    await deployRun.save();
    return { ok: false, stage: 0, error: err.message, commit, deployRun };
  }

  // ─────────────────────────────────────────────────────────────
  // STAGE 1: WRITE (ATOMIC)
  // ─────────────────────────────────────────────────────────────
  updateStage(1, 'running');
  let dbSession = null;
  try {
    if (injectedFailure && injectedFailure.stage === 1) {
      throw new Error(injectedFailure.error || 'Simulated failure at Stage 1 (Write)');
    }

    try {
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        dbSession = await mongoose.startSession();
        dbSession.startTransaction();
      }
    } catch (_) {
      dbSession = null; // Standalone MongoDB fallback
    }

    commit.status = 'deploying';
    await commit.save({ session: dbSession || undefined });

    const classes = await M.Class.find({ _id: { $in: commit.classIds } }).lean();
    const classMap = new Map(classes.map(c => [String(c._id), c]));

    for (const cId of commit.classIds) {
      const sId = String(cId);
      const cls = classMap.get(sId);
      const className = cls?.name || 'Class';
      const grid = resolvedClassGrids.get(sId) || [];

      // Find current SectionTimetable to obtain previous head info
      const currentSec = await M.SectionTimetable.findOne({ classId: cId });
      const oldHeadTrackId = currentSec?.headTrackId || null;
      const oldVersion = currentSec?.headVersion || 0;
      const newVersion = oldVersion + 1;

      const slotsObj = gridToSlotsObj(grid, className);
      const diffResult = diffGrids(Object.values(currentSec?.slots || {}), grid);

      // Update SectionTimetable Head
      await M.SectionTimetable.findOneAndUpdate(
        { classId: cId },
        {
          slots: slotsObj,
          className,
          headTrackId: commit.trackId,
          headSeq: commit.seq,
          headVersion: newVersion,
          updatedBy: actor.name || commit.author?.name || 'Deploy Pipeline',
          ...(cls ? { deptId: cls.deptId, deptName: cls.deptName } : {})
        },
        { upsert: true, session: dbSession || undefined }
      );

      // Retire SemesterTemplate published mirror (archive old published copies; Head is SectionTimetable)
      if (M.SemesterTemplate && typeof M.SemesterTemplate.updateMany === 'function') {
        await M.SemesterTemplate.updateMany(
          { classId: cId, status: 'published' },
          { $set: { status: 'archived' } },
          { session: dbSession || undefined }
        );
      }

      // Save TimetableCommitClass
      await M.TimetableCommitClass.findOneAndUpdate(
        { commitTrackId: commit.trackId, classId: cId },
        {
          commitTrackId: commit.trackId,
          classId: cId,
          className,
          deptId: cls?.deptId || null,
          version: newVersion,
          parentTrackId: oldHeadTrackId,
          grid,
          diff: {
            added: diffResult.stats.addedCount,
            modified: diffResult.stats.modifiedCount,
            removed: diffResult.stats.removedCount,
            unchanged: diffResult.stats.unchangedCount
          }
        },
        { upsert: true, session: dbSession || undefined }
      );
    }

    if (dbSession) {
      await dbSession.commitTransaction();
    }

    invalidateProductionCache();
    updateStage(1, 'success', { counts: { classesUpdated: commit.classIds.length } });
  } catch (err) {
    if (dbSession) {
      await dbSession.abortTransaction().catch(() => {});
    }
    updateStage(1, 'failed', { error: err.message });
    commit.status = 'failed';
    await commit.save().catch(() => {});
    deployRun.status = 'failed';
    deployRun.finishedAt = new Date();
    await deployRun.save();
    return { ok: false, stage: 1, error: err.message, commit, deployRun };
  } finally {
    if (dbSession) {
      dbSession.endSession();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // STAGES 2–6: Post-write idempotent steps (warnings if failed)
  // ─────────────────────────────────────────────────────────────
  await runStage2_Assignments(commit, resolvedClassGrids, deployRun, injectedFailure);
  await runStage3_Combined(commit, resolvedClassGrids, deployRun, actor, injectedFailure);
  await runStage4_Boards(commit, resolvedClassGrids, deployRun, injectedFailure);
  await runStage5_Notify(commit, resolvedClassGrids, deployRun, actor, injectedFailure);
  await runStage6_RefreshCache(commit, resolvedClassGrids, deployRun, injectedFailure);
  await runStage6b_SessionsSync(commit, resolvedClassGrids, deployRun, injectedFailure);

  // ─────────────────────────────────────────────────────────────
  // STAGE 7: FINALIZE
  // ─────────────────────────────────────────────────────────────
  await runStage7_Finalize(commit, deployRun, actor);

  return {
    ok: deployRun.status === 'success' || deployRun.status === 'success_with_warnings',
    commit,
    deployRun
  };
}

// ── Stage 2: Staff & Subject Linking and Assignments ──
async function runStage2_Assignments(commit, resolvedClassGrids, deployRun, injectedFailure) {
  const stage = deployRun.stages.find(s => s.key === 2);
  if (!stage) return;
  stage.status = 'running';
  stage.startedAt = new Date();

  try {
    if (injectedFailure && injectedFailure.stage === 2) {
      throw new Error(injectedFailure.error || 'Simulated failure at Stage 2 (Assignments)');
    }

    let created = 0;
    let repointed = 0;
    let removed = 0;

    for (const cId of commit.classIds) {
      const sId = String(cId);
      const grid = resolvedClassGrids.get(sId) || [];
      const cls = await M.Class.findById(cId).lean();
      if (!cls) continue;

      // Extract distinct valid (classId, subjectId, teacherId) by ID only
      const targetMap = new Map();
      for (const slot of grid) {
        if (!slot) continue;
        const sIdVal = slot.subjectId ? String(slot.subjectId) : null;
        const tIdVal = slot.teacherId ? String(slot.teacherId) : null;
        if (!sIdVal || !tIdVal) continue; // By ID only (D23)

        const key = `${sIdVal}_${tIdVal}`;
        if (!targetMap.has(key)) {
          targetMap.set(key, {
            subjectId: sIdVal,
            teacherId: tIdVal,
            subjectName: slot.subject || '',
            teacherName: slot.teacher || '',
            hallNo: slot.room || cls.hallNo || ''
          });
        }
      }

      // Upsert/repoint assignments for each distinct tuple
      for (const item of targetMap.values()) {
        const existing = await M.Assignment.findOne({
          classId: sId,
          subjectId: item.subjectId,
          teacherId: item.teacherId
        });

        if (existing) {
          // If existing is manual, NEVER overwrite source
          if (existing.source !== 'manual') {
            existing.source = 'timetable';
            existing.timetableTrackId = commit.trackId;
            existing.hallNo = item.hallNo || existing.hallNo;
            await existing.save();
            repointed++;
          }
        } else {
          await M.Assignment.create({
            classId: sId,
            className: cls.name,
            subjectId: item.subjectId,
            subjectName: item.subjectName,
            teacherId: item.teacherId,
            teacherName: item.teacherName,
            hallNo: item.hallNo,
            deptName: cls.deptName || '',
            deptCode: cls.deptCode || '',
            source: 'timetable',
            timetableTrackId: commit.trackId,
            remarks: 'Auto-synchronized from approved production timetable'
          });
          created++;
        }
      }

      // Remove source: 'timetable' rows for this class that are no longer in the grid
      const currentKeys = new Set(Array.from(targetMap.keys()));
      const oldTimetableAssignments = await M.Assignment.find({
        classId: sId,
        source: 'timetable',
        timetableTrackId: { $ne: commit.trackId }
      });

      for (const oldRow of oldTimetableAssignments) {
        const rowKey = `${oldRow.subjectId}_${oldRow.teacherId}`;
        if (!currentKeys.has(rowKey)) {
          await M.Assignment.deleteOne({ _id: oldRow._id });
          removed++;
        }
      }
    }

    deployRun.report.assignments = { created, updated: 0, repointed, removed, orphans: [] };
    stage.status = 'success';
    stage.finishedAt = new Date();
    stage.counts = { created, repointed, removed };
  } catch (err) {
    stage.status = 'warning';
    stage.finishedAt = new Date();
    stage.error = err.message;
    stage.retryable = true;
  }
}

// ── Stage 3: Combined Classes ──
async function runStage3_Combined(commit, resolvedClassGrids, deployRun, actor, injectedFailure) {
  const stage = deployRun.stages.find(s => s.key === 3);
  if (!stage) return;
  stage.status = 'running';
  stage.startedAt = new Date();

  try {
    if (injectedFailure && injectedFailure.stage === 3) {
      throw new Error(injectedFailure.error || 'Simulated failure at Stage 3 (Combined Classes)');
    }

    let syncedCount = 0;
    for (const cId of commit.classIds) {
      const sId = String(cId);
      const grid = resolvedClassGrids.get(sId) || [];
      const combinedSlots = grid.filter(s => s && (s.combinedGroupId || (Array.isArray(s.combinedWith) && s.combinedWith.length > 0)));
      syncedCount += combinedSlots.length;
    }

    stage.status = 'success';
    stage.finishedAt = new Date();
    stage.counts = { combinedSlots: syncedCount };
  } catch (err) {
    stage.status = 'warning';
    stage.finishedAt = new Date();
    stage.error = err.message;
    stage.retryable = true;
  }
}

// ── Stage 4: Boards ──
async function runStage4_Boards(commit, resolvedClassGrids, deployRun, injectedFailure) {
  const stage = deployRun.stages.find(s => s.key === 4);
  if (!stage) return;
  stage.status = 'running';
  stage.startedAt = new Date();

  try {
    if (injectedFailure && injectedFailure.stage === 4) {
      throw new Error(injectedFailure.error || 'Simulated failure at Stage 4 (Boards)');
    }

    // Collect affected rooms across classes
    const affectedRooms = new Set();
    for (const cId of commit.classIds) {
      const sId = String(cId);
      const grid = resolvedClassGrids.get(sId) || [];
      for (const slot of grid) {
        if (slot?.roomId) affectedRooms.add(String(slot.roomId));
      }
    }

    const roomIds = Array.from(affectedRooms);
    let pushed = 0;
    let failed = 0;

    // Push context in batches of 5
    for (let i = 0; i < roomIds.length; i += 5) {
      const batch = roomIds.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(rId => bellScheduler.forcePushRoomContext(rId))
      );
      for (const res of results) {
        if (res.status === 'fulfilled' && res.value) pushed++;
        else failed++;
      }
    }

    deployRun.report.boards = { rooms: roomIds.length, pushed, failed };
    stage.status = failed > 0 ? 'warning' : 'success';
    stage.finishedAt = new Date();
    stage.counts = { rooms: roomIds.length, pushed, failed };
    stage.retryable = failed > 0;
  } catch (err) {
    stage.status = 'warning';
    stage.finishedAt = new Date();
    stage.error = err.message;
    stage.retryable = true;
  }
}

// ── Stage 5: Notify ──
async function runStage5_Notify(commit, resolvedClassGrids, deployRun, actor, injectedFailure) {
  const stage = deployRun.stages.find(s => s.key === 5);
  if (!stage) return;
  stage.status = 'running';
  stage.startedAt = new Date();

  try {
    if (injectedFailure && injectedFailure.stage === 5) {
      throw new Error(injectedFailure.error || 'Simulated failure at Stage 5 (Notifications)');
    }

    let teachersNotified = 0;
    let studentsNotified = 0;

    for (const cId of commit.classIds) {
      const sId = String(cId);
      const grid = resolvedClassGrids.get(sId) || [];
      const cls = await M.Class.findById(cId).lean();
      const className = cls?.name || 'Class';

      // 1. Teachers notification
      const teacherIds = new Set();
      for (const s of grid) {
        if (s?.teacherId) teacherIds.add(String(s.teacherId));
      }

      for (const tId of teacherIds) {
        const dedupeKey = `${commit.trackId}:teacher:${tId}`;
        const existing = await M.Notification.findOne({ dedupeKey });
        if (!existing) {
          const teacherDoc = await M.Teacher.findById(tId).lean();
          await M.Notification.create({
            type: 'timetable-deploy',
            from: actor?.name || commit.author?.name || 'Timetable Coordinator',
            fromRole: 'Coordinator',
            toTeacherId: tId,
            toTeacherTrackId: teacherDoc?.trackId || '',
            toTeacherName: teacherDoc?.fullName || teacherDoc?.name || '',
            dedupeKey,
            message: `Timetable updated for ${className} (${commit.trackId}): Schedule has been deployed to production.`,
            priority: 'Normal',
            status: 'Delivered'
          }).catch(() => {});
          teachersNotified++;
        }
      }

      // 2. Students notification
      const students = await M.Student.find({ classId: cId }).select('_id trackId fullName registerNo').lean();
      for (const st of students) {
        const dedupeKey = `${commit.trackId}:student:${st._id}`;
        const existing = await M.Notification.findOne({ dedupeKey });
        if (!existing) {
          await M.Notification.create({
            type: 'timetable-deploy',
            from: actor?.name || commit.author?.name || 'Timetable Coordinator',
            fromRole: 'Coordinator',
            toStudentId: st._id,
            toStudentTrackId: st.trackId || st.registerNo || '',
            toStudentName: st.fullName,
            dedupeKey,
            message: `Official timetable ${commit.trackId} published for ${className}. Check your updated weekly schedule.`,
            priority: 'Normal',
            status: 'Delivered'
          }).catch(() => {});
          studentsNotified++;
        }
      }
    }

    // 3. Sharee departments notification
    let supportingHodsNotified = 0;
    if (commit.workspaceId && M.WorkspaceShare) {
      try {
        const activeShares = await M.WorkspaceShare.find({
          workspaceId: commit.workspaceId,
          status: 'active'
        }).lean();

        for (const share of (activeShares || [])) {
          if (!share.toDeptId) continue;
          const dedupeKey = `${commit.trackId}:sharee:${share.toDeptId}`;
          const existing = await M.Notification.findOne({ dedupeKey });
          if (!existing) {
            const deptDoc = await M.Department.findById(share.toDeptId).lean();
            if (deptDoc?.hodId) {
              await M.Notification.create({
                type: 'timetable-deploy',
                from: actor?.name || commit.author?.name || 'Timetable Coordinator',
                fromRole: 'Coordinator',
                toTeacherId: deptDoc.hodId,
                dedupeKey,
                message: `Timetable ${commit.trackId} has been deployed to production. Slots shared with ${share.toDeptName || deptDoc.name} are now live.`,
                priority: 'Normal',
                status: 'Delivered'
              }).catch(() => {});
              supportingHodsNotified++;
            }
          }
        }
      } catch (_) {}
    }

    deployRun.report.notifications = {
      teachers: teachersNotified,
      students: studentsNotified,
      hods: commit.approver?.id ? 1 : 0,
      supportingHods: supportingHodsNotified
    };

    stage.status = 'success';
    stage.finishedAt = new Date();
    stage.counts = { teachers: teachersNotified, students: studentsNotified };
  } catch (err) {
    stage.status = 'warning';
    stage.finishedAt = new Date();
    stage.error = err.message;
    stage.retryable = true;
  }
}

// ── Stage 6: Teacher matrix refresh & DayInstance cache reset ──
async function runStage6_RefreshCache(commit, resolvedClassGrids, deployRun, injectedFailure) {
  const stage = deployRun.stages.find(s => s.key === 6);
  if (!stage) return;
  stage.status = 'running';
  stage.startedAt = new Date();

  try {
    if (injectedFailure && injectedFailure.stage === 6) {
      throw new Error(injectedFailure.error || 'Simulated failure at Stage 6 (Cache)');
    }

    // Invalidate 60-second teacher schedule cache
    invalidateProductionCache();

    // Drop/reset DayInstance rows for these classes with stale timetableTrackId
    const deleteResult = await M.DayInstance.deleteMany({
      classId: { $in: commit.classIds },
      $or: [
        { timetableTrackId: { $ne: commit.trackId } },
        { timetableTrackId: null }
      ]
    });

    // Check future-dated overrides (§5.5, §10.4):
    // Overrides whose original slots no longer exist are listed for review in deploy report, never deleted.
    const overridesNeedingReview = [];
    if (M.Override && typeof M.Override.find === 'function') {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const futureOverrides = await M.Override.find({
          classId: { $in: commit.classIds },
          date: { $gte: today }
        }).lean();

        for (const ov of (futureOverrides || [])) {
          const sId = String(ov.classId);
          const grid = resolvedClassGrids?.get ? (resolvedClassGrids.get(sId) || []) : [];
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const dayName = dayNames[new Date(ov.date).getDay()];
          const ovPeriod = Number(ov.period || ov.periodNumber || 0);

          const matchingSlot = grid.find(s => s.day === dayName && Number(s.period) === ovPeriod);
          if (!matchingSlot) {
            overridesNeedingReview.push({
              overrideId: ov._id,
              classId: ov.classId,
              date: ov.date,
              day: dayName,
              period: ovPeriod,
              type: ov.type,
              reason: 'Slot is no longer present in newly deployed timetable'
            });
          }
        }
      } catch (_) {}
    }

    deployRun.report.cache = { invalidated: true };
    deployRun.report.overridesNeedingReview = overridesNeedingReview;
    stage.status = 'success';
    stage.finishedAt = new Date();
    stage.counts = {
      dayInstancesReset: deleteResult?.deletedCount || 0,
      overridesNeedingReview: overridesNeedingReview.length
    };
  } catch (err) {
    stage.status = 'warning';
    stage.finishedAt = new Date();
    stage.error = err.message;
    stage.retryable = true;
  }
}

// ── Stage 6b: Sessions Sync Engine (Phase 8, Section 10.5) ──
function isSessionStarted(sess, now = new Date()) {
  if (sess.startClass && sess.startClass.at) return true;
  if (!sess.start) return false;
  try {
    const parts = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(now);
    const curH = Number(parts.find(p => p.type === 'hour')?.value || 0);
    const curM = Number(parts.find(p => p.type === 'minute')?.value || 0);
    const curMinutes = curH * 60 + curM;
    const [sH, sM] = String(sess.start).split(':').map(Number);
    const startMinutes = (sH || 0) * 60 + (sM || 0);
    return curMinutes >= startMinutes;
  } catch (_) {
    return false;
  }
}

async function runStage6b_SessionsSync(commit, resolvedClassGrids, deployRun, injectedFailure) {
  const syncReport = {
    created: 0,
    updated: 0,
    skippedMarked: 0,
    drift: 0,
    cancelled: 0,
    orphanSubstitutions: 0,
    details: []
  };

  try {
    if (injectedFailure && (injectedFailure.stage === '6b' || injectedFailure.stage === 6.5)) {
      throw new Error(injectedFailure.error || 'Simulated failure at Stage 6b (Sessions Sync)');
    }

    const todayDateStr = await todayInInstitutionTz();
    const dObj = new Date(todayDateStr + 'T00:00:00.000Z');
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayDayName = dayNames[dObj.getUTCDay()];

    if (todayDayName !== 'Sunday') {
      for (const classId of (commit.classIds || [])) {
        const sClassId = String(classId);
        const grid = resolvedClassGrids?.get ? (resolvedClassGrids.get(sClassId) || []) : [];
        const classDoc = await M.Class.findById(classId).lean();
        const className = classDoc?.name || `Class ${sClassId}`;
        const deptCode = (classDoc?.departmentCode || classDoc?.deptCode || 'GEN').toUpperCase();

        const existingSessions = await M.ClassSession.find({
          classId: sClassId,
          date: todayDateStr
        });

        const newSlotsToday = (grid || []).filter(s => {
          const sDay = String(s.day || '').toLowerCase();
          return sDay === todayDayName.toLowerCase() || sDay.startsWith(todayDayName.slice(0, 3).toLowerCase());
        });

        const sessionByPeriod = new Map();
        for (const sess of existingSessions) {
          sessionByPeriod.set(Number(sess.periodNumber), sess);
        }

        for (const sess of existingSessions) {
          const pNum = Number(sess.periodNumber);
          const isMarked = !!(sess.attendance?.savedAt || (sess.attendance?.total > 0 && sess.attendance?.present !== undefined));

          // 1. Marked attendance (evidence) -> TOUCH NOTHING
          if (isMarked) {
            syncReport.skippedMarked++;
            continue;
          }

          // 2. Started, still unmarked -> tag timetableDrift: true
          if (isSessionStarted(sess)) {
            sess.timetableDrift = true;
            await sess.save();
            syncReport.drift++;
            syncReport.details.push({
              classId: sClassId,
              period: pNum,
              status: 'drift',
              message: `Period ${pNum} already started; marked with timetableDrift=true`
            });
            continue;
          }

          // 3. Active substitution or extra
          if (sess.source === 'substitution' || sess.source === 'extra') {
            const matchingSlot = newSlotsToday.find(s => {
              const startP = Number(s.period !== undefined ? s.period : (parseInt(String(s.periodCode || '').replace(/\D/g, ''), 10) || 1));
              const span = Math.max(1, Number(s.span || s.duration || 1));
              return pNum >= startP && pNum < startP + span;
            });
            if (!matchingSlot) {
              if (!Array.isArray(sess.flags)) sess.flags = [];
              if (!sess.flags.includes('orphan-substitution')) {
                sess.flags.push('orphan-substitution');
                await sess.save();
              }
              syncReport.orphanSubstitutions++;
            }
            continue;
          }

          // 4. Unstarted, unmarked
          const matchingSlot = newSlotsToday.find(s => {
            const startP = Number(s.period !== undefined ? s.period : (parseInt(String(s.periodCode || '').replace(/\D/g, ''), 10) || 1));
            const span = Math.max(1, Number(s.span || s.duration || 1));
            return pNum >= startP && pNum < startP + span;
          });

          if (matchingSlot) {
            sess.subjectId = matchingSlot.subjectId ? String(matchingSlot.subjectId) : sess.subjectId;
            sess.subjectName = matchingSlot.subject || sess.subjectName;
            sess.room = matchingSlot.room || sess.room;
            if (matchingSlot.roomId) sess.roomId = matchingSlot.roomId;
            sess.scheduledTeacher = {
              trackId: matchingSlot.teacherTrackId || '',
              name: matchingSlot.teacher || ''
            };
            sess.actualTeacher = {
              trackId: matchingSlot.teacherTrackId || '',
              name: matchingSlot.teacher || ''
            };
            sess.slotKey = `${todayDayName.slice(0, 3)}_${pNum}`;
            sess.slotHash = `${todayDayName.slice(0, 3)}_${pNum}_${sess.subjectId || sess.subjectName}_${sess.scheduledTeacher.trackId}_${sess.room}`;
            sess.timetableTrackId = commit.trackId;
            sess.timetableDrift = false;
            await sess.save();
            syncReport.updated++;
          } else {
            sess.status = 'cancelled';
            if (!Array.isArray(sess.notes)) sess.notes = [];
            sess.notes.push({
              by: 'system',
              text: `Timetable changed (${commit.trackId})`,
              at: new Date()
            });
            await sess.save();
            syncReport.cancelled++;
          }
        }

        // 5. New slots today
        for (const slot of newSlotsToday) {
          const startP = Number(slot.period !== undefined ? slot.period : (parseInt(String(slot.periodCode || '').replace(/\D/g, ''), 10) || 1));
          const span = Math.max(1, Number(slot.span || slot.duration || 1));
          for (let offset = 0; offset < span; offset++) {
            const pNum = startP + offset;
            if (!sessionByPeriod.has(pNum)) {
              await M.ClassSession.create({
                date: todayDateStr,
                classId: sClassId,
                className,
                deptCode,
                year: classDoc?.year || 1,
                section: classDoc?.section || 'A',
                periodNumber: pNum,
                span,
                start: slot.start || '09:00',
                end: slot.end || '09:50',
                slotType: slot.isLab ? 'lab' : (slot.type === 'Lab' ? 'lab' : 'theory'),
                subjectId: slot.subjectId ? String(slot.subjectId) : null,
                subjectName: slot.subject || '',
                room: slot.room || '',
                roomId: slot.roomId || null,
                scheduledTeacher: {
                  trackId: slot.teacherTrackId || '',
                  name: slot.teacher || ''
                },
                actualTeacher: {
                  trackId: slot.teacherTrackId || '',
                  name: slot.teacher || ''
                },
                source: 'timetable',
                status: 'scheduled',
                slotKey: `${todayDayName.slice(0, 3)}_${pNum}`,
                slotHash: `${todayDayName.slice(0, 3)}_${pNum}_${slot.subjectId || slot.subject || ''}_${slot.teacherTrackId || ''}_${slot.room || ''}`,
                timetableTrackId: commit.trackId,
                timetableDrift: false
              });
              syncReport.created++;
            }
          }
        }
      }
    }

    if (deployRun) {
      if (!deployRun.report) deployRun.report = {};
      deployRun.report.sessionsSync = syncReport;
    }
  } catch (err) {
    if (deployRun) {
      if (!deployRun.report) deployRun.report = {};
      deployRun.report.sessionsSync = { ...syncReport, error: err.message };
    }
  }
}

// ── Stage 7: Finalize ──
async function runStage7_Finalize(commit, deployRun, actor) {
  const stage = deployRun.stages.find(s => s.key === 7);
  if (stage) {
    stage.status = 'running';
    stage.startedAt = new Date();
  }

  const hasWarnings = deployRun.stages.some(s => s.status === 'warning' || s.status === 'failed');

  commit.status = hasWarnings ? 'deployed_with_warnings' : 'deployed';
  await commit.save();

  // Mark all active shares of the deployed workspace as 'done' (Section 7.5)
  if (commit.workspaceId && M.WorkspaceShare) {
    try {
      await M.WorkspaceShare.updateMany(
        { workspaceId: commit.workspaceId, status: 'active' },
        { $set: { status: 'done', doneAt: new Date() } }
      );
    } catch (_) {}
  }

  deployRun.status = hasWarnings ? 'success_with_warnings' : 'success';
  deployRun.finishedAt = new Date();

  if (stage) {
    stage.status = 'success';
    stage.finishedAt = new Date();
  }

  await deployRun.save();

  await logAction(
    actor?.trackId || commit.author?.trackId || 'System',
    actor?.name || commit.author?.name || 'System',
    actor?.role || 'admin',
    'Timetable Deployed',
    `Commit ${commit.trackId} deployed (${commit.classIds.length} class(es)) with status ${commit.status}`,
    'data',
    'info',
    undefined,
    actor?.sessionId,
    { module: 'timetable', subType: 'deploy', commitTrackId: commit.trackId, runId: deployRun._id }
  );
}

/**
 * Retry an individual retryable stage of a DeployRun
 *
 * @param {string|ObjectId} deployRunId
 * @param {number} stageKey
 * @param {Object} [actor]
 * @returns {Promise<Object>}
 */
async function retryStage(deployRunId, stageKey, actor = {}) {
  const deployRun = await M.DeployRun.findById(deployRunId);
  if (!deployRun) throw new Error('DeployRun not found');

  const commit = await M.TimetableCommit.findOne({ trackId: deployRun.commitTrackId });
  if (!commit) throw new Error('Associated TimetableCommit not found');

  const stage = deployRun.stages.find(s => s.key === Number(stageKey));
  if (!stage || !stage.retryable) {
    throw new Error(`Stage ${stageKey} is not retryable`);
  }

  // Re-fetch class grids from TimetableCommitClass or SectionTimetable or SemesterTemplate
  const resolvedClassGrids = new Map();
  for (const cId of commit.classIds) {
    let grid = null;
    if (M.TimetableCommitClass && typeof M.TimetableCommitClass.findOne === 'function') {
      try {
        const commitClass = await M.TimetableCommitClass.findOne({ commitTrackId: commit.trackId, classId: cId }).lean();
        if (commitClass?.grid) grid = commitClass.grid;
      } catch (_) {}
    }
    if (!grid && M.SectionTimetable && typeof M.SectionTimetable.findOne === 'function') {
      try {
        const sec = await M.SectionTimetable.findOne({ classId: cId }).lean();
        if (sec?.slots) grid = Object.values(sec.slots);
      } catch (_) {}
    }
    if (!grid && M.SemesterTemplate && typeof M.SemesterTemplate.findOne === 'function') {
      try {
        const tmpl = await M.SemesterTemplate.findOne({ classId: cId, status: 'published' }).lean();
        if (tmpl?.grid) grid = tmpl.grid;
      } catch (_) {}
    }
    if (grid) resolvedClassGrids.set(String(cId), grid);
  }

  switch (Number(stageKey)) {
    case 2:
      await runStage2_Assignments(commit, resolvedClassGrids, deployRun, null);
      break;
    case 3:
      await runStage3_Combined(commit, resolvedClassGrids, deployRun, actor, null);
      break;
    case 4:
      await runStage4_Boards(commit, resolvedClassGrids, deployRun, null);
      break;
    case 5:
      await runStage5_Notify(commit, resolvedClassGrids, deployRun, actor, null);
      break;
    case 6:
      await runStage6_RefreshCache(commit, resolvedClassGrids, deployRun, null);
      break;
    default:
      throw new Error(`Cannot retry stage ${stageKey}`);
  }

  // Recompute overall status
  const hasWarnings = deployRun.stages.some(s => s.status === 'warning' || s.status === 'failed');
  deployRun.status = hasWarnings ? 'success_with_warnings' : 'success';
  commit.status = hasWarnings ? 'deployed_with_warnings' : 'deployed';

  await deployRun.save();
  await commit.save();

  return { ok: true, stage, deployRun, commit };
}

module.exports = {
  gridToSlotsObj,
  executeDeployPipeline,
  retryStage,
  runStage6b_SessionsSync,
  isSessionStarted
};
