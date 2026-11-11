/**
 * routes/timetableWorkspace.routes.js
 *
 * Workspace, Commits, Checkpoints, and Deployment routes for EAMS Timetable v3.
 * Mounted at /timetable in routes/index.js BEFORE legacy timetable.routes.js
 * so root /:id routes do not shadow new paths.
 */

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { isSudo, isSudoAdmin, hasPageRight } = require('../utils/access');
const { executeDeployPipeline, retryStage } = require('../services/timetableDeploy');
const { diffGrids } = require('../services/timetableDiff');
const { getEffective, slotsToGrid, invalidateEffectiveCache } = require('../services/timetableEffective');
const { getNextRequestId } = require('../utils/requestIds');
const { logAction } = require('../utils/logAction');
const { todayInInstitutionTz, todayIST } = require('../utils/institutionTime');
const { sanitizeToString, sanitizeToObjectId } = require('../utils/sanitizeQuery');
const { detectConflictsV2, notifyHodOfClashes, resolveStaleClashNotifications } = require('../services/timetableConflicts');
const { executeAutoMerge, executeResolveMerge, executeKeepMine, executeTakeProduction, threeWayMerge } = require('../services/timetableMerge');
const { resolveHodTeacher } = require('../utils/timetableResolver');
const { generateLinkCode, computeSlotHash } = require('../services/shareCrypto');
const { broadcastToDraft, emitAccessRevoked } = require('../services/timetable.socket');

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const {
  applyDraftOps,
  getDraftSnapshot,
  encodeDictionarySnapshot,
  getDraftChanges,
  restoreDraftVersion,
  undoDraftOp
} = require('../services/draftOps');

// ── Lightweight Connectivity Heartbeat (Phase 7, Section 4.1) ──
router.all('/ping', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.status(204).end();
});

// ── Access & Permission Helpers ──

function canManage(req) {
  const u = req.user;
  if (!u) return false;
  if (isSudo(req || u)) return true;
  if (u.isHod === true || u.isTimeTableCoordinator === true || u.isPrincipal === true) return true;
  if (Array.isArray(u.specials) && u.specials.some(s => s && (s.option === 'isHod' || s.option === 'isTimeTableCoordinator' || s.option === 'isPrincipal') && s.value !== false)) return true;
  if (req.access?.pages?.timetable || req.access?.pages?.rooms) return true;
  if (hasPageRight(u, 'timetable', 'view')) return true;
  return false;
}


function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function canAccessDev(req) {
  const u = req.user;
  if (!u) return false;
  if (isSudo(req || u) || isSudoAdmin(u) || u.isSudo === true || u.isSudoAdmin === true || u.role === 'sudo' || u.role === 'admin') return false;
  if (u.isHod === true || u.isTimeTableCoordinator === true || u.isPrincipal === true) return true;
  if (Array.isArray(u.specials) && u.specials.some(s => s && (s.option === 'isHod' || s.option === 'isTimeTableCoordinator' || s.option === 'isPrincipal') && s.value !== false)) return true;
  return false;
}

/**
 * Enforces workspace access rules (Section 9.2, Table 6.2):
 * - Production request (no workspaceId): requires general timetable manager rights.
 * - Workspace request (workspaceId or env=development):
 *   1. Resolves workspace by _id or trackId (404 if not found).
 *   2. Sudo Admin and Principal are strictly read-only in workspaces (D19).
 *      GET/HEAD allowed; write methods return 403.
 *   3. Regular user must belong to workspace's department, be a collaborator,
 *      or have an active WorkspaceShare for their department. Otherwise returns 403.
 *   4. Attaches req.workspace to request.
 */
async function requireWorkspaceAccess(req, res, next) {
  try {
    const env = sanitizeToString(req.query?.env || req.body?.env || 'production').toLowerCase();
    const wsId = req.query?.workspaceId || req.body?.workspaceId || req.params?.workspaceId || req.params?.id;

    if (env !== 'development' && !wsId) {
      if (!canManage(req)) {
        return res.status(403).json({ error: 'Timetable Coordinator access required' });
      }
      return next();
    }

    const u = req.user;
    if (!u) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const isSudoUser = isSudo(req || u) || isSudoAdmin(u) || u.isSudo === true || u.isSudoAdmin === true || u.role === 'sudo' || u.role === 'admin';
    const isPrincipal = u.isPrincipal === true || u.accessRole === 'principal';

    if (wsId) {
      let ws = null;
      if (mongoose.isValidObjectId(wsId) && typeof M.TimetableWorkspace.findById === 'function') {
        try {
          const q = M.TimetableWorkspace.findById(wsId);
          ws = await (typeof q?.lean === 'function' ? q.lean() : q);
        } catch (_) {}
      }
      if (!ws && typeof M.TimetableWorkspace.findOne === 'function') {
        try {
          const q = M.TimetableWorkspace.findOne({
            $or: [
              ...(mongoose.isValidObjectId(wsId) ? [{ _id: wsId }] : []),
              { trackId: wsId }
            ]
          });
          ws = await (typeof q?.lean === 'function' ? q.lean() : q);
        } catch (_) {}
      }

      if (!ws) {
        return res.status(404).json({ error: 'Workspace not found' });
      }

      if (isSudoUser || isPrincipal) {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
          return res.status(403).json({ error: 'Sudo Admin and Principal are read-only in workspaces' });
        }
        req.workspace = ws;
        return next();
      }

      const caller = await resolveCallerContext(req);
      const isOwnerDept = caller.deptId && String(ws.deptId) === String(caller.deptId);
      const isCollaborator = Array.isArray(ws.collaborators) && ws.collaborators.some(c =>
        (c.userId && String(c.userId) === String(u._id)) ||
        (caller.teacherId && c.teacherId && String(c.teacherId) === String(caller.teacherId))
      );

      let activeShare = null;
      if (!isOwnerDept && !isCollaborator) {
        try {
          // 1. Direct user share first
          if (M.WorkspaceShare && u._id) {
            const q = M.WorkspaceShare.findOne({
              workspaceId: ws._id,
              userId: u._id,
              status: 'active'
            });
            activeShare = await (typeof q?.lean === 'function' ? q.lean() : q);
          }
          // 2. Department share fallback
          if (!activeShare && caller.deptId && M.WorkspaceShare) {
            const q = M.WorkspaceShare.findOne({
              workspaceId: ws._id,
              toDeptId: caller.deptId,
              status: 'active'
            });
            const resQ = typeof q?.lean === 'function' ? q.lean() : q;
            activeShare = await Promise.race([
              resQ,
              new Promise(resolve => setTimeout(() => resolve(null), 50))
            ]);
          }
        } catch (_) {}
      }

      if (activeShare && activeShare.expiresAt && new Date(activeShare.expiresAt) < new Date()) {
        activeShare = null;
      }

      if (ws.deptId && !isOwnerDept && !isCollaborator && !activeShare) {
        return res.status(403).json({ error: 'Access denied: You do not have access to this workspace' });
      }

      if (activeShare) {
        // Class scope check
        const requestedClassId = req.params?.classId || req.query?.classId || req.body?.classId;
        const allowedClasses = [
          ...(Array.isArray(activeShare.classIds) ? activeShare.classIds.map(c => String(c)) : []),
          ...(activeShare.classId ? [String(activeShare.classId)] : [])
        ];
        if (requestedClassId && allowedClasses.length > 0 && !allowedClasses.includes(String(requestedClassId))) {
          return res.status(404).json({ error: 'Class not found in shared scope' });
        }

        // Draft scope check
        const requestedDraftId = req.params?.draftId || req.query?.draftId || req.body?.draftId;
        if (requestedDraftId && activeShare.scope === 'draft' && activeShare.draftId && String(requestedDraftId) !== String(activeShare.draftId)) {
          return res.status(404).json({ error: 'Draft not found in shared scope' });
        }

        const normLevel = activeShare.level === 'view' ? 'viewer' : (activeShare.level === 'edit' ? 'editor' : (activeShare.level === 'fill' ? 'editor' : activeShare.level));
        if (normLevel === 'viewer' || normLevel === 'commenter') {
          const isCommentRoute = (req.originalUrl || req.path || '').includes('/comments');
          if (normLevel === 'commenter' && isCommentRoute) {
            // Commenters can post/resolve comments
          } else if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            return res.status(403).json({ error: `${normLevel === 'viewer' ? 'View-only' : 'Commenter'} share: writes are not permitted` });
          }
        }
      }

      req.workspace = ws;
      req.workspaceShare = activeShare;
      return next();
    }

    // env === 'development' without workspaceId
    if (isSudoUser || isPrincipal) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return res.status(403).json({ error: 'Sudo Admin and Principal are read-only in workspaces' });
      }
      return next();
    }

    if (!canAccessDev(req)) {
      return res.status(403).json({
        error: 'Development environment access is restricted to HODs and Timetable Coordinators. Sudo Admins have Production access only.'
      });
    }

    const caller = await resolveCallerContext(req);
    if (caller.deptId && req.query && !req.query.deptId) {
      req.query.deptId = String(caller.deptId);
    }

    return next();
  } catch (err) {
    return res.status(500).json({ error: 'Workspace access check failed: ' + err.message });
  }
}

function requireManager(req, res, next) {
  if (!canManage(req)) {
    return res.status(403).json({ error: 'Timetable Coordinator access required' });
  }
  next();
}

/**
 * Enforces that Sudo Admin and Principal are read-only in workspaces (D19).
 */
function denySudoAndPrincipal(req, res, next) {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'Authentication required' });
  if (isSudo(req || u) || isSudoAdmin(u) || u.isSudo === true || u.isSudoAdmin === true || u.role === 'sudo' || u.role === 'admin' || u.isPrincipal === true || u.accessRole === 'principal') {
    return res.status(403).json({ error: 'Sudo Admin and Principal are read-only in workspaces' });
  }
  next();
}

/**
 * Resolves caller's department, roles, and teacher ID from session/token
 */
async function resolveCallerContext(req) {
  const u = req.user;
  if (!u) return { deptId: null, deptName: '', isHod: false, isTtc: false, teacherId: null, teacherName: '' };

  let deptId = u.deptId ? String(u.deptId) : null;
  let deptName = u.deptName || u.department || '';
  let isHod = Boolean(u.isHod);
  let isTtc = Boolean(u.isTimeTableCoordinator);

  if (Array.isArray(u.specials)) {
    for (const s of u.specials) {
      if (!s || s.value === false) continue;
      if (s.option === 'isHod') isHod = true;
      if (s.option === 'isTimeTableCoordinator') isTtc = true;
      if (s.key && !deptName) deptName = s.key;
    }
  }

  // If deptId missing but deptName present, resolve Department ID
  if (!deptId && deptName) {
    const dept = await M.Department.findOne({
      $or: [
        { name: new RegExp(`^${deptName}$`, 'i') },
        { code: new RegExp(`^${deptName}$`, 'i') }
      ]
    }).select('_id name code').lean();
    if (dept) {
      deptId = String(dept._id);
      deptName = dept.name;
    }
  }

  let teacherId = u.teacherId || null;
  let teacherName = u.name || '';
  if (!teacherId) {
    const t = await M.Teacher.findOne({
      $or: [
        { userId: u._id },
        { trackId: u.trackId || null },
        { email: u.email || null }
      ]
    }).select('_id name deptId deptName trackId').lean();
    if (t) {
      teacherId = t._id;
      if (!teacherName) teacherName = t.name;
      if (!deptId && t.deptId) {
        deptId = String(t.deptId);
        deptName = t.deptName || deptName;
      }
    }
  }

  return { deptId, deptName, isHod, isTtc, teacherId, teacherName };
}

function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';
}

function sanitizeSlot(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    day:                String(s.day || ''),
    period:             Number(s.period) || 1,
    span:               Math.max(1, Number(s.span) || 1),
    spanRootPeriod:     s.spanRootPeriod !== undefined ? Number(s.spanRootPeriod) : null,
    spanIndex:          Number(s.spanIndex) || 0,
    isSpanContinuation: Boolean(s.isSpanContinuation),
    subject:            String(s.subject || ''),
    subjectId:          s.subjectId ? sanitizeToObjectId(s.subjectId) : null,
    subjectCode:        String(s.subjectCode || ''),
    teacher:            String(s.teacher || s.teacherName || ''),
    teacherId:          s.teacherId ? sanitizeToObjectId(s.teacherId) : null,
    teacherTrackId:     String(s.teacherTrackId || ''),
    room:               String(s.room || s.hallNo || ''),
    roomId:             s.roomId ? sanitizeToObjectId(s.roomId) : null,
    isLab:              Boolean(s.isLab),
    type:               String(s.type || (s.isLab ? 'Lab' : 'Theory')),
    combinedWith:       Array.isArray(s.combinedWith) ? s.combinedWith.map(String) : [],
    combinedGroupId:    s.combinedGroupId ? sanitizeToObjectId(s.combinedGroupId) : null,
    reservedForDeptId:  s.reservedForDeptId ? sanitizeToObjectId(s.reservedForDeptId) : null,
    reservedLabel:      String(s.reservedLabel || ''),
    state:              String(s.state || ''),
    activityId:         s.activityId ? sanitizeToObjectId(s.activityId) : null,
    activityLabel:      String(s.activityLabel || ''),
    primaryClassId:     s.primaryClassId ? sanitizeToObjectId(s.primaryClassId) : null,
    primaryClassName:   String(s.primaryClassName || ''),
    note:               String(s.note || '')
  };
}

// ── Commits Endpoints ──

router.get('/commits', authMiddleware, async (req, res) => {
  try {
    const { status, deptId, classId, type, search, limit = 50, cursor } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (type) filter.type = type;
    if (classId) filter.classIds = sanitizeToObjectId(classId);

    if (deptId) {
      const classes = await M.Class.find({ deptId: sanitizeToObjectId(deptId) }).select('_id').lean();
      const cIds = classes.map(c => c._id);
      filter.classIds = { $in: cIds };
    }

    if (search) {
      const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { trackId: new RegExp(escaped, 'i') },
        { message: new RegExp(escaped, 'i') },
        { classNames: new RegExp(escaped, 'i') }
      ];
    }

    if (cursor) {
      filter.createdAt = { $lt: new Date(cursor) };
    }

    const pageSize = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
    const commits = await M.TimetableCommit.find(filter)
      .sort({ seq: -1, createdAt: -1 })
      .limit(pageSize)
      .lean();

    res.json({
      ok: true,
      data: commits,
      count: commits.length,
      nextCursor: commits.length === pageSize ? commits[commits.length - 1].createdAt : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /commits/pending — list pending commits for approval
router.get('/commits/pending', authMiddleware, async (req, res) => {
  try {
    const caller = await resolveCallerContext(req);
    const isSudoUser = isSudo(req || req.user) || isSudoAdmin(req.user) || req.user.role === 'sudo' || req.user.role === 'admin' || req.user.isPrincipal;

    const query = { status: 'pending_approval' };
    if (!isSudoUser && caller.deptId) {
      const deptClasses = await M.Class.find({ deptId: caller.deptId }).select('_id').lean();
      const cIds = deptClasses.map(c => c._id);
      query.$or = [
        { classIds: { $in: cIds } },
        { 'author.id': req.user._id }
      ];
    }

    const pendingCommits = await M.TimetableCommit.find(query).sort({ createdAt: -1 }).lean();
    res.json({ ok: true, data: pendingCommits, count: pendingCommits.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/commits/:trackId', authMiddleware, async (req, res) => {
  try {
    const { trackId } = req.params;
    const commit = await M.TimetableCommit.findOne({
      $or: [{ trackId }, { _id: (trackId.length === 24 && /^[0-9a-fA-F]{24}$/.test(trackId)) ? trackId : null }]
    }).lean();

    if (!commit) {
      return res.status(404).json({ error: 'TimetableCommit not found' });
    }

    const classes = await M.TimetableCommitClass.find({
      commitTrackId: commit.trackId
    }).lean();

    let deployRun = null;
    if (commit.deployRunId) {
      deployRun = await M.DeployRun.findById(commit.deployRunId).lean();
    }

    res.json({
      ok: true,
      commit,
      classes,
      deployRun
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /commits/:trackId/approve
router.post('/commits/:trackId/approve', authMiddleware, async (req, res) => {
  try {
    const { trackId } = req.params;
    const commit = await M.TimetableCommit.findOne({
      $or: [{ trackId }, { _id: (trackId.length === 24 && /^[0-9a-fA-F]{24}$/.test(trackId)) ? trackId : null }]
    });
    if (!commit) return res.status(404).json({ error: 'Commit not found' });
    if (commit.status !== 'pending_approval') {
      return res.status(400).json({ error: `Commit cannot be approved; status is '${commit.status}'` });
    }

    const caller = await resolveCallerContext(req);
    if (isSudo(req || req.user) || isSudoAdmin(req.user) || req.user.isPrincipal) {
      return res.status(403).json({ error: 'Sudo Admin and Principal are read-only in workspaces and cannot approve commits' });
    }

    let wsDeptId = null;
    if (commit.workspaceId) {
      const ws = await M.TimetableWorkspace.findById(commit.workspaceId).select('deptId').lean();
      wsDeptId = ws?.deptId;
    }
    const isOwnerHod = caller.isHod && (!wsDeptId || (caller.deptId && String(caller.deptId) === String(wsDeptId)));
    if (!isOwnerHod) {
      return res.status(403).json({ error: 'Only HoD of the workspace department can approve commits' });
    }

    commit.status = 'approved';
    commit.approver = {
      id: req.user._id,
      name: req.user.name,
      trackId: req.user.trackId || '',
      at: new Date(),
      comment: sanitizeToString(req.body.comment || 'Approved')
    };
    await commit.save();

    // Update drafts state
    await M.WorkspaceClassDraft.updateMany(
      { submittedTrackId: commit.trackId },
      { $set: { state: 'approved' } }
    );

    // Notify author TTC
    if (commit.author?.id) {
      await M.Notification.create({
        type: 'timetable-approval',
        priority: 'Normal',
        from: req.user.name,
        fromRole: 'HoD',
        toTeacherId: commit.author.id,
        toTeacherName: commit.author.name,
        dedupeKey: `${commit.trackId}_approved`,
        message: `Commit ${commit.trackId} has been approved by ${req.user.name}`,
        status: 'Delivered',
        read: false
      });
    }

    await logAction({
      userId: req.user._id,
      module: 'timetable',
      subType: 'commit-approve',
      status: 'success',
      description: `Approved commit ${commit.trackId}`,
      metadata: { commitTrackId: commit.trackId }
    });

    let deployRun = null;
    if (req.body.autoDeploy) {
      const deployRes = await executeDeployPipeline(commit, { actor: req.user });
      deployRun = deployRes.deployRun;
    }

    res.json({ ok: true, commit, deployRun });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /commits/:trackId/reject
router.post('/commits/:trackId/reject', authMiddleware, async (req, res) => {
  try {
    const { trackId } = req.params;
    const commit = await M.TimetableCommit.findOne({
      $or: [{ trackId }, { _id: (trackId.length === 24 && /^[0-9a-fA-F]{24}$/.test(trackId)) ? trackId : null }]
    });
    if (!commit) return res.status(404).json({ error: 'Commit not found' });
    if (commit.status !== 'pending_approval') {
      return res.status(400).json({ error: `Commit cannot be rejected; status is '${commit.status}'` });
    }

    const caller = await resolveCallerContext(req);
    if (isSudo(req || req.user) || isSudoAdmin(req.user) || req.user.isPrincipal) {
      return res.status(403).json({ error: 'Sudo Admin and Principal are read-only in workspaces and cannot reject commits' });
    }

    let wsDeptId = null;
    if (commit.workspaceId) {
      const ws = await M.TimetableWorkspace.findById(commit.workspaceId).select('deptId').lean();
      wsDeptId = ws?.deptId;
    }
    const isOwnerHod = caller.isHod && (!wsDeptId || (caller.deptId && String(caller.deptId) === String(wsDeptId)));
    if (!isOwnerHod) {
      return res.status(403).json({ error: 'Only HoD of the workspace department can reject commits' });
    }

    const reason = sanitizeToString(req.body.reason || 'Rejected by HoD');
    commit.status = 'rejected';
    commit.notes = reason;
    await commit.save();

    // Revert drafts back to editing
    await M.WorkspaceClassDraft.updateMany(
      { submittedTrackId: commit.trackId },
      { $set: { state: 'editing' } }
    );

    // Notify author TTC
    if (commit.author?.id) {
      await M.Notification.create({
        type: 'timetable-approval',
        priority: 'High',
        from: req.user.name,
        fromRole: 'HoD',
        toTeacherId: commit.author.id,
        toTeacherName: commit.author.name,
        dedupeKey: `${commit.trackId}_rejected`,
        message: `Commit ${commit.trackId} was rejected by ${req.user.name}: ${reason}`,
        status: 'Delivered',
        read: false
      });
    }

    await logAction({
      userId: req.user._id,
      module: 'timetable',
      subType: 'commit-reject',
      status: 'success',
      description: `Rejected commit ${commit.trackId}: ${reason}`,
      metadata: { commitTrackId: commit.trackId, reason }
    });

    res.json({ ok: true, commit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /commits/:trackId/withdraw
router.post('/commits/:trackId/withdraw', authMiddleware, async (req, res) => {
  try {
    const { trackId } = req.params;
    const commit = await M.TimetableCommit.findOne({
      $or: [{ trackId }, { _id: (trackId.length === 24 && /^[0-9a-fA-F]{24}$/.test(trackId)) ? trackId : null }]
    });
    if (!commit) return res.status(404).json({ error: 'Commit not found' });
    if (commit.status !== 'pending_approval') {
      return res.status(400).json({ error: `Commit cannot be withdrawn; status is '${commit.status}'` });
    }

    const isAuthor = commit.author?.id && String(commit.author.id) === String(req.user._id);
    const caller = await resolveCallerContext(req);
    if (!isAuthor && !caller.isHod) {
      return res.status(403).json({ error: 'Only the author or department HoD can withdraw this commit' });
    }

    commit.status = 'withdrawn';
    await commit.save();

    // Revert drafts back to editing
    await M.WorkspaceClassDraft.updateMany(
      { submittedTrackId: commit.trackId },
      { $set: { state: 'editing' } }
    );

    await logAction({
      userId: req.user._id,
      module: 'timetable',
      subType: 'commit-withdraw',
      status: 'success',
      description: `Withdrew commit ${commit.trackId}`,
      metadata: { commitTrackId: commit.trackId }
    });

    res.json({ ok: true, commit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /commits/:trackId/deploy
router.post('/commits/:trackId/deploy', authMiddleware, async (req, res) => {
  try {
    const { trackId } = req.params;
    const commit = await M.TimetableCommit.findOne({
      $or: [{ trackId }, { _id: (trackId.length === 24 && /^[0-9a-fA-F]{24}$/.test(trackId)) ? trackId : null }]
    });
    if (!commit) return res.status(404).json({ error: 'Commit not found' });

    const caller = await resolveCallerContext(req);
    const isSudoUser = isSudo(req || req.user) || isSudoAdmin(req.user);
    const isPrincipal = req.user.isPrincipal === true || req.user.accessRole === 'principal';
    if (isPrincipal) {
      return res.status(403).json({ error: 'Principal cannot deploy commits' });
    }

    let wsDeptId = null;
    if (commit.workspaceId) {
      const ws = await M.TimetableWorkspace.findById(commit.workspaceId).select('deptId').lean();
      wsDeptId = ws?.deptId;
    }
    const isOwnerDeptMember = Boolean(caller.deptId && wsDeptId && String(caller.deptId) === String(wsDeptId) && canManage(req));
    if (!isSudoUser && !isOwnerDeptMember) {
      return res.status(403).json({ error: 'Only owner department coordinators/HoD or Sudo Admin can deploy' });
    }

    if (commit.status !== 'approved') {
      return res.status(400).json({ error: `Commit must be 'approved' to deploy; current status is '${commit.status}'` });
    }

    const deployRes = await executeDeployPipeline(commit, { actor: req.user });
    if (!deployRes.ok && deployRes.stage === 0) {
      return res.status(400).json({ ok: false, error: deployRes.error, deployRun: deployRes.deployRun });
    }

    res.json({ ok: true, commit, deployRun: deployRes.deployRun });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Deploys Endpoints ──

router.get('/deploys/:runId', authMiddleware, async (req, res) => {
  try {
    const deployRun = await M.DeployRun.findById(req.params.runId).lean();
    if (!deployRun) {
      return res.status(404).json({ error: 'DeployRun not found' });
    }
    const commit = await M.TimetableCommit.findOne({ trackId: deployRun.commitTrackId }).lean();
    res.json({
      ok: true,
      deployRun,
      commit
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/deploys/:runId/retry', authMiddleware, requireManager, async (req, res) => {
  try {
    const stageKey = parseInt(req.body.stage, 10);
    if (isNaN(stageKey) || stageKey < 2 || stageKey > 6) {
      return res.status(400).json({ error: 'Invalid or non-retryable stage key (must be 2, 3, 4, 5, or 6)' });
    }

    const result = await retryStage(req.params.runId, stageKey, req.user);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Scheduled Go-Live Endpoint (Forward only, §10.4) ──

router.post('/commits/:trackId/schedule', authMiddleware, denySudoAndPrincipal, async (req, res) => {
  try {
    const { trackId } = req.params;
    const { goLiveAt } = req.body;
    if (!goLiveAt) {
      return res.status(400).json({ error: 'goLiveAt date is required' });
    }
    const scheduledDate = new Date(goLiveAt);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ error: 'Invalid goLiveAt date format' });
    }
    if (scheduledDate <= new Date()) {
      return res.status(400).json({ error: 'goLiveAt must be in the future (cannot be in the past or present)' });
    }

    const commit = await M.TimetableCommit.findOne({
      $or: [{ trackId }, { _id: (trackId.length === 24 && /^[0-9a-fA-F]{24}$/.test(trackId)) ? trackId : null }]
    });
    if (!commit) return res.status(404).json({ error: 'Commit not found' });

    const caller = await resolveCallerContext(req);
    let wsDeptId = null;
    if (commit.workspaceId) {
      const ws = await M.TimetableWorkspace.findById(commit.workspaceId).select('deptId').lean();
      wsDeptId = ws?.deptId;
    }
    if (caller.deptId && wsDeptId && String(caller.deptId) !== String(wsDeptId)) {
      return res.status(403).json({ error: 'Only coordinators or HoD of the workspace department can schedule go-live' });
    }

    commit.goLiveAt = scheduledDate;
    await commit.save();

    res.json({ ok: true, commit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Hotfix Lane Endpoint (HoD only, runs full pipeline, D15) ──

router.post('/hotfix', authMiddleware, denySudoAndPrincipal, async (req, res) => {
  try {
    const caller = await resolveCallerContext(req);
    if (!caller.isHod) {
      return res.status(403).json({ error: 'Hotfix lane is restricted to HoD only' });
    }

    const { classId, grid, ops, reason, message } = req.body;
    if (!classId) return res.status(400).json({ error: 'classId is required for hotfix' });
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({ error: 'A mandatory reason is required for production hotfix' });
    }

    const cls = await M.Class.findById(classId).lean();
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    if (caller.deptId && cls.deptId && String(caller.deptId) !== String(cls.deptId)) {
      return res.status(403).json({ error: 'HoD can only hotfix classes belonging to their own department' });
    }

    const sec = await M.SectionTimetable.findOne({ classId }).lean();
    const currentGrid = sec ? slotsToGrid(sec.slots) : [];

    let targetGrid = Array.isArray(grid) ? [...grid] : [...currentGrid];
    if (Array.isArray(ops) && ops.length > 0) {
      targetGrid = [...currentGrid];
      for (const opItem of ops) {
        if (opItem.op === 'set' && opItem.slot) {
          const idx = targetGrid.findIndex(s => s.day === opItem.slot.day && s.period === opItem.slot.period);
          if (idx >= 0) targetGrid[idx] = { ...targetGrid[idx], ...opItem.slot };
          else targetGrid.push(opItem.slot);
        } else if (opItem.op === 'clear' && opItem.slot) {
          targetGrid = targetGrid.filter(s => !(s.day === opItem.slot.day && s.period === opItem.slot.period));
        }
      }
    }

    // Run conflict engine v2
    const conflicts = await detectConflictsV2({
      classIds: [classId],
      targetGrids: { [String(classId)]: targetGrid },
      checkUnresolved: true
    });

    const hardConflicts = conflicts.filter(c => c.severity === 'hard');
    if (hardConflicts.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `Hotfix rejected due to hard conflict: ${hardConflicts[0].description || hardConflicts[0].message}`,
        conflicts: hardConflicts
      });
    }

    // Create TimetableCommit
    const trackId = await getNextRequestId('TT');
    const seq = (await M.TimetableCommit.countDocuments({})) + 1;

    const commit = await M.TimetableCommit.create({
      trackId,
      seq,
      type: 'hotfix',
      classIds: [classId],
      classNames: [cls.name],
      message: sanitizeToString(message || `Hotfix for ${cls.name}`),
      notes: sanitizeToString(reason),
      author: {
        id: req.user._id,
        name: req.user.name,
        trackId: req.user.trackId || ''
      },
      approver: {
        id: req.user._id,
        name: req.user.name,
        trackId: req.user.trackId || '',
        at: new Date(),
        comment: `HoD Hotfix: ${reason}`
      },
      status: 'approved'
    });

    // Create TimetableCommitClass
    const diffResult = diffGrids(currentGrid, targetGrid);
    await M.TimetableCommitClass.create({
      commitTrackId: commit.trackId,
      classId,
      className: cls.name,
      deptId: cls.deptId || null,
      version: (sec?.headVersion || 0) + 1,
      parentTrackId: sec?.headTrackId || null,
      grid: targetGrid,
      diff: {
        added: diffResult.added?.length || 0,
        modified: diffResult.modified?.length || 0,
        removed: diffResult.removed?.length || 0,
        unchanged: diffResult.unchanged?.length || 0
      }
    });

    // Execute deploy pipeline immediately
    const deployRes = await executeDeployPipeline(commit, {
      actor: req.user,
      classGrids: { [String(classId)]: targetGrid }
    });

    await logAction({
      req,
      user: req.user,
      action: 'timetable-hotfix',
      details: `Hotfix deployed for class ${cls.name} (${trackId}): ${reason}`,
      category: 'data',
      module: 'timetable',
      subType: 'hotfix'
    });

    res.json({
      ok: deployRes.ok,
      commit,
      deployRun: deployRes.deployRun,
      error: deployRes.error
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── TimetableUserState Endpoints ──

router.get('/user-state', authMiddleware, async (req, res) => {
  try {
    const state = await M.TimetableUserState.findOne({ userId: req.user._id }).lean();
    if (!state) {
      return res.json({
        ok: true,
        env: 'production',
        activeWorkspaceId: null,
        openTabs: [],
        prefs: { freezePanes: true }
      });
    }
    res.json({
      ok: true,
      env: state.env || 'production',
      activeWorkspaceId: state.activeWorkspaceId || null,
      openTabs: state.openTabs || [],
      prefs: state.prefs || { freezePanes: true }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/user-state', authMiddleware, async (req, res) => {
  try {
    const update = {};
    if (req.body.env && ['production', 'development'].includes(req.body.env)) {
      update.env = req.body.env;
    }
    if (req.body.activeWorkspaceId !== undefined) {
      update.activeWorkspaceId = req.body.activeWorkspaceId ? sanitizeToObjectId(req.body.activeWorkspaceId) : null;
    }
    if (Array.isArray(req.body.openTabs)) {
      update.openTabs = req.body.openTabs.map(t => ({
        id: String(t.id || ''),
        title: sanitizeToString(t.title || ''),
        sectionName: sanitizeToString(t.sectionName || ''),
        viewType: String(t.viewType || 'section'),
        classId: t.classId ? (sanitizeToObjectId(t.classId) || sanitizeToString(t.classId)) : null,
        viewParams: t.viewParams && typeof t.viewParams === 'object' ? t.viewParams : {},
        mode: String(t.mode || 'production')
      }));
    }
    if (req.body.prefs && typeof req.body.prefs === 'object') {
      update.prefs = {
        freezePanes: req.body.prefs.freezePanes !== false
      };
    }

    const state = await M.TimetableUserState.findOneAndUpdate(
      { userId: req.user._id },
      { $set: update },
      { returnDocument: 'after', upsert: true }
    ).lean();

    res.json({ ok: true, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/workspace-state/:id', authMiddleware, async (req, res) => {
  try {
    const wsId = req.params.id ? sanitizeToObjectId(req.params.id) : null;
    const state = await M.TimetableUserState.findOne({ userId: req.user._id }).lean();
    if (!state) {
      return res.json({
        ok: true,
        workspaceId: wsId,
        env: 'production',
        openTabs: [],
        prefs: { freezePanes: true }
      });
    }
    res.json({
      ok: true,
      workspaceId: wsId || state.activeWorkspaceId,
      env: state.env || 'production',
      openTabs: state.openTabs || [],
      prefs: state.prefs || { freezePanes: true }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/workspace-state/:id', authMiddleware, async (req, res) => {
  try {
    const wsId = req.params.id ? sanitizeToObjectId(req.params.id) : null;
    const update = { activeWorkspaceId: wsId };
    if (req.body.env && ['production', 'development'].includes(req.body.env)) {
      update.env = req.body.env;
    }
    if (Array.isArray(req.body.openTabs)) {
      update.openTabs = req.body.openTabs.map(t => ({
        id: String(t.id || ''),
        title: sanitizeToString(t.title || ''),
        sectionName: sanitizeToString(t.sectionName || ''),
        viewType: String(t.viewType || 'section'),
        classId: t.classId ? (sanitizeToObjectId(t.classId) || sanitizeToString(t.classId)) : null,
        viewParams: t.viewParams && typeof t.viewParams === 'object' ? t.viewParams : {},
        mode: String(t.mode || 'production')
      }));
    }
    if (req.body.prefs && typeof req.body.prefs === 'object') {
      update.prefs = {
        freezePanes: req.body.prefs.freezePanes !== false
      };
    }

    const state = await M.TimetableUserState.findOneAndUpdate(
      { userId: req.user._id },
      { $set: update },
      { returnDocument: 'after', upsert: true }
    ).lean();

    res.json({ ok: true, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workspace CRUD & Lifecycle Endpoints ──

router.get('/workspaces', authMiddleware, async (req, res) => {
  try {
    const caller = await resolveCallerContext(req);
    const { scope = 'dept' } = req.query;
    const isReader = isSudo(req || req.user) || isSudoAdmin(req.user) || req.user.isPrincipal === true;

    let query = {};

    if (scope === 'archived') {
      query.status = 'archived';
      if (!isReader && caller.deptId) {
        query.deptId = caller.deptId;
      }
    } else if (scope === 'mine') {
      query.status = 'open';
      if (caller.teacherId) {
        query.$or = [
          { ownerId: caller.teacherId },
          { 'collaborators.teacherId': caller.teacherId }
        ];
      } else if (!isReader && caller.deptId) {
        query.deptId = caller.deptId;
      }
    } else if (scope === 'shared') {
      // Find workspaces shared with caller's department
      if (!caller.deptId) {
        return res.json({ ok: true, workspaces: [] });
      }
      const shares = await M.WorkspaceShare.find({
        toDeptId: caller.deptId,
        status: 'active'
      }).select('workspaceId level fill').lean();

      const wsIds = shares.map(s => s.workspaceId);
      query = { _id: { $in: wsIds }, status: 'open' };
    } else {
      // Default: 'dept'
      query.status = 'open';
      if (!isReader && caller.deptId) {
        query.deptId = caller.deptId;
      }
    }

    if (req.query.kind && ['development', 'production'].includes(req.query.kind)) {
      query.kind = req.query.kind;
    }
    if (req.query.q && String(req.query.q).trim()) {
      const qRegex = new RegExp(escapeRegex(String(req.query.q).trim()), 'i');
      query.$or = [
        { name: qRegex },
        { trackId: qRegex },
        { slug: qRegex }
      ];
    }

    const workspaces = await M.TimetableWorkspace.find(query)
      .sort({ lastActivityAt: -1, updatedAt: -1 })
      .lean();

    res.json({
      ok: true,
      workspaces: workspaces.map(w => ({
        ...w,
        classCount: (w.classIds || []).length
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const caller = await resolveCallerContext(req);
    if (!caller.deptId) {
      return res.status(400).json({ error: 'User does not belong to a valid department' });
    }

    const { name, academicYear, semester, label, classIds = [], forkFrom } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Workspace name is required' });
    }

    const trackId = await getNextRequestId('WS');
    let baseSlug = slugify(name);
    let slug = baseSlug;
    let counter = 1;

    while (await M.TimetableWorkspace.findOne({ deptId: caller.deptId, slug })) {
      counter++;
      slug = `${baseSlug}-${counter}`;
    }

    const targetClassIds = Array.isArray(classIds) ? classIds.map(sanitizeToObjectId).filter(Boolean) : [];

    const ws = new M.TimetableWorkspace({
      trackId,
      name: name.trim(),
      slug,
      deptId: caller.deptId,
      deptName: caller.deptName,
      ownerId: caller.teacherId || caller.deptId,
      ownerName: caller.teacherName || req.user.name,
      academicYear: academicYear || '',
      semester: semester || 'Odd',
      label: label ? String(label).trim() : '',
      status: 'open',
      classIds: targetClassIds,
      forkedFrom: {
        kind: forkFrom?.kind === 'workspace' ? 'workspace' : 'production',
        workspaceId: forkFrom?.workspaceId ? sanitizeToObjectId(forkFrom.workspaceId) : null,
        atTrackId: forkFrom?.atTrackId || null
      },
      collaborators: [],
      lastActivityAt: new Date(),
      createdBy: req.user._id
    });

    await ws.save();

    // Create Class Drafts for chosen classes
    for (const cId of targetClassIds) {
      let draftGrid = [];
      let baseTrackId = null;
      let baseSeq = 0;

      if (forkFrom?.kind === 'workspace' && forkFrom.workspaceId) {
        const parentDraft = await M.WorkspaceClassDraft.findOne({
          workspaceId: forkFrom.workspaceId,
          classId: cId
        }).lean();
        if (parentDraft) {
          draftGrid = parentDraft.grid || [];
          baseTrackId = parentDraft.baseTrackId;
          baseSeq = parentDraft.baseSeq || 0;
        }
      } else {
        const sec = await M.SectionTimetable.findOne({ classId: cId }).lean();
        if (sec) {
          draftGrid = slotsToGrid(sec.slots);
          baseTrackId = sec.headTrackId || null;
          baseSeq = sec.headSeq || 0;
        }
      }

      const cls = await M.Class.findById(cId).select('name').lean();

      await M.WorkspaceClassDraft.create({
        workspaceId: ws._id,
        classId: cId,
        className: cls?.name || '',
        grid: draftGrid,
        baseTrackId,
        baseSeq,
        revision: 1,
        state: 'editing',
        updatedBy: req.user._id,
        updatedByName: req.user.name || ''
      });
    }

    invalidateEffectiveCache(ws._id);

    await logAction({
      req,
      user: req.user,
      action: 'workspace-create',
      details: `Created workspace "${ws.name}" (${ws.trackId}) with ${targetClassIds.length} classes`,
      category: 'data',
      module: 'timetable',
      subType: 'workspace-create'
    });

    res.json({ ok: true, workspace: ws });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Shared With Me & My Shares Routes (Must precede /workspaces/:id) ──

router.get('/workspaces/shared-with-me', authMiddleware, async (req, res) => {
  try {
    const caller = await resolveCallerContext(req);
    if (!caller.deptId) {
      return res.json({ ok: true, workspaces: [], shares: [] });
    }

    const shares = await M.WorkspaceShare.find({
      toDeptId: caller.deptId,
      status: 'active'
    }).lean();

    const wsIds = shares.map(s => s.workspaceId).filter(Boolean);
    const workspaces = await M.TimetableWorkspace.find({
      _id: { $in: wsIds },
      status: 'open'
    }).lean();

    const wsMap = new Map(workspaces.map(w => [String(w._id), w]));
    const result = shares.map(s => {
      const ws = wsMap.get(String(s.workspaceId));
      return {
        ...s,
        workspace: ws || null
      };
    }).filter(s => s.workspace != null);

    res.json({ ok: true, shares: result, workspaces });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/shares/shared-with-me', authMiddleware, async (req, res) => {
  try {
    const caller = await resolveCallerContext(req);
    if (!caller.deptId) {
      return res.json({ ok: true, shares: [] });
    }
    const shares = await M.WorkspaceShare.find({
      toDeptId: caller.deptId,
      status: 'active'
    }).lean();
    res.json({ ok: true, shares });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/shares/mine', authMiddleware, async (req, res) => {
  try {
    const caller = await resolveCallerContext(req);
    if (!caller.deptId) return res.json({ ok: true, shares: [] });

    const workspaces = await M.TimetableWorkspace.find({ deptId: caller.deptId }).select('_id').lean();
    const wsIds = workspaces.map(w => w._id);
    const shares = await M.WorkspaceShare.find({ workspaceId: { $in: wsIds } }).lean();
    res.json({ ok: true, shares });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/workspaces/:id', authMiddleware, requireWorkspaceAccess, async (req, res) => {
  try {
    const ws = req.workspace || await M.TimetableWorkspace.findById(req.params.id).lean();
    if (!ws) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const drafts = await M.WorkspaceClassDraft.find({ workspaceId: ws._id }).lean();
    const classIds = drafts.map(d => d.classId);

    // Compute stale flags vs SectionTimetable heads
    const heads = await M.SectionTimetable.find({ classId: { $in: classIds } }).select('classId headTrackId headSeq').lean();
    const headMap = new Map();
    heads.forEach(h => headMap.set(String(h.classId), h));

    const draftsWithStale = drafts.map(d => {
      const head = headMap.get(String(d.classId));
      const isStale = Boolean(head && head.headTrackId && d.baseTrackId && head.headTrackId !== d.baseTrackId);
      return {
        ...d,
        slotCount: (d.grid || []).length,
        isStale,
        currentHeadTrackId: head?.headTrackId || null
      };
    });

    const shares = await M.WorkspaceShare.find({ workspaceId: ws._id, status: 'active' }).lean();

    res.json({
      ok: true,
      workspace: ws,
      drafts: draftsWithStale,
      shares
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/workspaces/:id', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    if (M.TimetableCommit && typeof M.TimetableCommit.findOne === 'function') {
      const pendingCommit = await M.TimetableCommit.findOne({
        workspaceId: ws._id,
        status: { $in: ['pending_approval', 'approved', 'scheduled'] }
      }).lean();
      if (pendingCommit) {
        return res.status(400).json({
          error: `Cannot archive workspace: Commit ${pendingCommit.trackId} is in status "${pendingCommit.status}". Resolve pending commits first.`
        });
      }
    }

    const caller = await resolveCallerContext(req);
    if (caller.deptId && ws.deptId && String(ws.deptId) !== String(caller.deptId)) {
      return res.status(403).json({ error: 'Only the workspace owner department can modify workspace details' });
    }

    const { name, label, academicYear, semester, collaborators } = req.body;
    if (name && typeof name === 'string' && name.trim()) {
      ws.name = name.trim();
      ws.slug = slugify(name);
    }
    if (label !== undefined) ws.label = String(label).trim();
    if (academicYear !== undefined) ws.academicYear = String(academicYear).trim();
    if (semester !== undefined) ws.semester = semester;

    if (Array.isArray(collaborators)) {
      ws.collaborators = collaborators.map(c => ({
        teacherId: sanitizeToObjectId(c.teacherId),
        teacherName: String(c.teacherName || ''),
        role: c.role === 'viewer' ? 'viewer' : 'editor',
        addedBy: req.user._id,
        addedAt: new Date()
      }));
    }

    ws.lastActivityAt = new Date();
    await ws.save();

    res.json({ ok: true, workspace: ws });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces/:id/classes', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const caller = await resolveCallerContext(req);
    if (caller.deptId && ws.deptId && String(ws.deptId) !== String(caller.deptId)) {
      return res.status(403).json({ error: 'Only the workspace owner department can add classes to the workspace' });
    }

    const rawClasses = req.body.classIds || [req.body.classId];
    const incomingIds = (Array.isArray(rawClasses) ? rawClasses : [rawClasses]).map(sanitizeToObjectId).filter(Boolean);

    const existingClassIdSet = new Set((ws.classIds || []).map(String));
    const newlyAdded = [];

    for (const cId of incomingIds) {
      if (existingClassIdSet.has(String(cId))) continue;

      ws.classIds.push(cId);
      existingClassIdSet.add(String(cId));
      newlyAdded.push(cId);

      // Fork from current production SectionTimetable
      const sec = await M.SectionTimetable.findOne({ classId: cId }).lean();
      const cls = await M.Class.findById(cId).select('name').lean();
      const draftGrid = sec ? slotsToGrid(sec.slots) : [];

      await M.WorkspaceClassDraft.findOneAndUpdate(
        { workspaceId: ws._id, classId: cId },
        {
          $set: {
            className: cls?.name || '',
            grid: draftGrid,
            baseTrackId: sec?.headTrackId || null,
            baseSeq: sec?.headSeq || 0,
            revision: 1,
            state: 'editing',
            updatedBy: req.user._id,
            updatedByName: req.user.name || ''
          }
        },
        { upsert: true, returnDocument: 'after' }
      );
    }

    ws.lastActivityAt = new Date();
    await ws.save();
    invalidateEffectiveCache(ws._id);

    await logAction({
      req,
      user: req.user,
      action: 'class-add',
      details: `Added ${newlyAdded.length} class(es) to workspace ${ws.trackId}`,
      category: 'data',
      module: 'timetable',
      subType: 'class-add'
    });

    res.json({ ok: true, workspace: ws, addedClassIds: newlyAdded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/workspaces/:id/classes/:classId', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const caller = await resolveCallerContext(req);
    if (caller.deptId && ws.deptId && String(ws.deptId) !== String(caller.deptId)) {
      return res.status(403).json({ error: 'Only the workspace owner department can remove classes from the workspace' });
    }

    const targetCId = String(req.params.classId);
    ws.classIds = (ws.classIds || []).filter(id => String(id) !== targetCId);
    ws.lastActivityAt = new Date();
    await ws.save();

    await M.WorkspaceClassDraft.deleteOne({ workspaceId: ws._id, classId: targetCId });
    invalidateEffectiveCache(ws._id);

    await logAction({
      req,
      user: req.user,
      action: 'class-remove',
      details: `Removed class ${targetCId} from workspace ${ws.trackId}`,
      category: 'data',
      module: 'timetable',
      subType: 'class-remove'
    });

    res.json({ ok: true, removedClassId: targetCId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.post('/workspaces/:id/lens', authMiddleware, async (req, res) => {
  try {
    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const { lens } = req.body || {};
    if (ws.kind === 'production' && lens === 'development') {
      return res.status(400).json({ error: 'Production workspace is locked to production lens. Fork to Development Workspace to create drafts.' });
    }
    res.json({ ok: true, lens: lens || ws.kind || 'production' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces/:id/archive', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const caller = await resolveCallerContext(req);
    if (caller.deptId && ws.deptId && String(ws.deptId) !== String(caller.deptId)) {
      return res.status(403).json({ error: 'Only the workspace owner department can archive the workspace' });
    }

    // Z19 / N23: Block archive if any commit is pending_approval, approved, or scheduled
    const pendingCommit = await M.TimetableCommit.findOne({
      workspaceId: ws._id,
      status: { $in: ['pending_approval', 'approved', 'scheduled'] }
    }).lean();
    if (pendingCommit) {
      return res.status(400).json({
        error: `Cannot archive workspace while commit ${pendingCommit.trackId} is in status "${pendingCommit.status}". Resolve or abort the commit first.`
      });
    }

    ws.status = 'archived';
    ws.archivedAt = new Date();
    ws.archivedBy = req.user._id;
    ws.lastActivityAt = new Date();
    await ws.save();

    // Mark shares done
    await M.WorkspaceShare.updateMany(
      { workspaceId: ws._id, status: 'active' },
      { $set: { status: 'done', doneAt: new Date() } }
    );

    invalidateEffectiveCache(ws._id);

    await logAction({
      req,
      user: req.user,
      action: 'workspace-archive',
      details: `Archived workspace ${ws.trackId} (${ws.name})`,
      category: 'data',
      module: 'timetable',
      subType: 'workspace-archive'
    });

    res.json({ ok: true, workspace: ws });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces/:id/duplicate', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const sourceWs = await M.TimetableWorkspace.findById(req.params.id).lean();
    if (!sourceWs) return res.status(404).json({ error: 'Workspace not found' });

    const caller = await resolveCallerContext(req);
    if (caller.deptId && sourceWs.deptId && String(sourceWs.deptId) !== String(caller.deptId)) {
      return res.status(403).json({ error: 'Only the workspace owner department can duplicate the workspace' });
    }

    const trackId = await getNextRequestId('WS');
    let baseSlug = `${sourceWs.slug}-copy`;
    let slug = baseSlug;
    let counter = 1;

    while (await M.TimetableWorkspace.findOne({ deptId: sourceWs.deptId, slug })) {
      counter++;
      slug = `${baseSlug}-${counter}`;
    }

    const newWs = new M.TimetableWorkspace({
      trackId,
      name: `${sourceWs.name} (Copy)`,
      slug,
      deptId: sourceWs.deptId,
      deptName: sourceWs.deptName,
      ownerId: caller.teacherId || sourceWs.ownerId,
      ownerName: caller.teacherName || sourceWs.ownerName,
      academicYear: sourceWs.academicYear,
      semester: sourceWs.semester,
      label: sourceWs.label,
      status: 'open',
      classIds: sourceWs.classIds || [],
      forkedFrom: {
        kind: 'workspace',
        workspaceId: sourceWs._id,
        atTrackId: sourceWs.trackId
      },
      collaborators: [],
      lastActivityAt: new Date(),
      createdBy: req.user._id
    });

    await newWs.save();

    // Copy class drafts
    const sourceDrafts = await M.WorkspaceClassDraft.find({ workspaceId: sourceWs._id }).lean();
    for (const d of sourceDrafts) {
      await M.WorkspaceClassDraft.create({
        workspaceId: newWs._id,
        classId: d.classId,
        className: d.className,
        grid: d.grid || [],
        baseTrackId: d.baseTrackId,
        baseSeq: d.baseSeq || 0,
        revision: 1,
        state: 'editing',
        updatedBy: req.user._id,
        updatedByName: req.user.name || ''
      });
    }

    await logAction({
      req,
      user: req.user,
      action: 'workspace-fork',
      details: `Duplicated workspace ${sourceWs.trackId} to new workspace ${newWs.trackId}`,
      category: 'data',
      module: 'timetable',
      subType: 'workspace-fork'
    });

    res.json({ ok: true, workspace: newWs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workspace Submit Endpoint (Section 10.2) ──

router.post('/workspaces/:id/submit', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    const ws = await M.TimetableWorkspace.findById(id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const caller = await resolveCallerContext(req);
    if (caller.deptId && String(ws.deptId) !== String(caller.deptId)) {
      return res.status(403).json({ error: 'Cannot submit a workspace belonging to another department' });
    }

    const targetClassIds = Array.isArray(req.body.classIds) && req.body.classIds.length > 0
      ? req.body.classIds.map(String)
      : (ws.classIds || []).map(String);

    if (targetClassIds.length === 0) {
      return res.status(400).json({ error: 'No classes to submit' });
    }

    // Scheduled go-live validation (future only, §10.4, D16)
    let scheduledGoLiveAt = null;
    if (req.body.goLiveAt) {
      scheduledGoLiveAt = new Date(req.body.goLiveAt);
      if (isNaN(scheduledGoLiveAt.getTime())) {
        return res.status(400).json({ error: 'Invalid goLiveAt date format: must be a valid ISO date in the future' });
      }
      if (scheduledGoLiveAt <= new Date()) {
        return res.status(400).json({ error: 'goLiveAt must be in the future (cannot be in the past or present)' });
      }
    }

    // 1. Stale-base check: ensure none of the classes are stale
    const drafts = await M.WorkspaceClassDraft.find({ workspaceId: ws._id, classId: { $in: targetClassIds } }).lean();
    const secDocs = await M.SectionTimetable.find({ classId: { $in: targetClassIds } }).lean();
    const secMap = new Map(secDocs.map(s => [String(s.classId), s]));

    const staleClasses = [];
    for (const draft of drafts) {
      const sec = secMap.get(String(draft.classId));
      if (sec && sec.headTrackId && draft.baseTrackId && draft.baseTrackId !== sec.headTrackId) {
        staleClasses.push({
          classId: draft.classId,
          className: draft.className,
          baseTrackId: draft.baseTrackId,
          headTrackId: sec.headTrackId
        });
      }
    }

    if (staleClasses.length > 0) {
      return res.status(409).json({
        ok: false,
        error: 'Cannot submit stale classes. Merge required first.',
        staleClasses
      });
    }

    // 2. Conflict engine v2 check: hard conflicts and unresolved IDs block submit
    const conflicts = await detectConflictsV2({
      workspaceId: ws._id,
      classIds: targetClassIds,
      checkUnresolved: true
    });

    const hardConflicts = conflicts.filter(c => c.severity === 'hard');
    if (hardConflicts.length > 0) {
      return res.status(400).json({
        ok: false,
        error: 'Hard conflicts block submit',
        conflicts: hardConflicts
      });
    }

    // 3. Determine Approver HoD
    const hodTeacher = await resolveHodTeacher(ws.deptId);
    const isHodSelf = Boolean(caller.isHod && caller.deptId && String(caller.deptId) === String(ws.deptId));
    const status = isHodSelf ? 'approved' : 'pending_approval';

    // 4. Create TimetableCommit
    const trackId = await getNextRequestId('TT');
    const seq = (await M.TimetableCommit.countDocuments({})) + 1;
    const clsDocs = await M.Class.find({ _id: { $in: targetClassIds } }).lean();
    const clsMap = new Map(clsDocs.map(c => [String(c._id), c]));
    const classNames = targetClassIds.map(cid => clsMap.get(cid)?.name || 'Class');

    const commit = await M.TimetableCommit.create({
      trackId,
      seq,
      type: 'workspace',
      workspaceId: ws._id,
      workspaceName: ws.name,
      classIds: targetClassIds,
      classNames,
      message: sanitizeToString(req.body.message || `Timetable update for ${ws.name}`),
      notes: sanitizeToString(req.body.notes || ''),
      goLiveAt: scheduledGoLiveAt,
      author: {
        id: req.user._id,
        name: req.user.name,
        trackId: req.user.trackId || ''
      },
      approver: isHodSelf ? {
        id: req.user._id,
        name: req.user.name,
        trackId: req.user.trackId || '',
        at: new Date(),
        comment: 'Self-approved by HoD'
      } : {
        id: hodTeacher?._id || null,
        name: hodTeacher?.name || ''
      },
      status
    });

    // 5. Create TimetableCommitClass for each class
    for (const cId of targetClassIds) {
      const draft = drafts.find(d => String(d.classId) === String(cId));
      const cls = clsMap.get(String(cId));
      const sec = secMap.get(String(cId));
      const prodSlots = sec ? (Array.isArray(sec.slots) ? sec.slots : Object.values(sec.slots)) : [];
      const draftGrid = draft ? draft.grid : [];
      const diffResult = diffGrids(prodSlots, draftGrid);

      await M.TimetableCommitClass.create({
        commitTrackId: commit.trackId,
        classId: cId,
        className: cls?.name || draft?.className || '',
        deptId: ws.deptId,
        version: (sec?.headVersion || 0) + 1,
        parentTrackId: sec?.headTrackId || null,
        grid: draftGrid,
        diff: {
          added: diffResult.added?.length || 0,
          modified: diffResult.modified?.length || 0,
          removed: diffResult.removed?.length || 0,
          unchanged: diffResult.unchangedCount || 0
        }
      });

      // Update draft state
      await M.WorkspaceClassDraft.updateOne(
        { workspaceId: ws._id, classId: cId },
        {
          $set: {
            state: isHodSelf ? 'approved' : 'submitted',
            submittedTrackId: commit.trackId,
            updatedBy: req.user._id,
            updatedByName: req.user.name
          }
        }
      );
    }

    // 6. Notify HoD if not self-approved
    if (!isHodSelf && hodTeacher) {
      await M.Notification.create({
        type: 'timetable-approval',
        priority: 'High',
        from: req.user.name,
        fromRole: 'TTC',
        toTeacherId: hodTeacher._id,
        toTeacherName: hodTeacher.name,
        dedupeKey: `${commit.trackId}_approval`,
        message: `Commit ${commit.trackId} ("${commit.message}") submitted for approval by ${req.user.name}`,
        status: 'Delivered',
        read: false
      });
    }

    // Auto-deploy if self-approved and requested
    let deployRun = null;
    if (isHodSelf && req.body.autoDeploy) {
      const deployRes = await executeDeployPipeline(commit, { actor: req.user });
      deployRun = deployRes.deployRun;
    }

    await logAction({
      userId: req.user._id,
      module: 'timetable',
      subType: 'commit-submit',
      status: 'success',
      description: `Submitted commit ${commit.trackId} for workspace ${ws.name} (${targetClassIds.length} classes)`,
      metadata: { commitTrackId: commit.trackId, workspaceId: ws._id, classIds: targetClassIds }
    });

    res.json({
      ok: true,
      commit,
      deployRun
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HoD Clash Notification Dispatcher (D4, D20) ──

router.post('/workspaces/:id/notify-hod-clashes', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const conflicts = await detectConflictsV2({ workspaceId: ws._id });
    const notifyRes = await notifyHodOfClashes({ conflicts, workspace: ws, actor: req.user });

    res.json({
      ok: true,
      sent: notifyRes.sent,
      skipped: notifyRes.skipped,
      totalConflicts: conflicts.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Stale-Base Merge Endpoints (Section 10.3) ──

router.get('/workspaces/:id/classes/:classId/merge-status', authMiddleware, async (req, res) => {
  try {
    const { id, classId } = req.params;
    const draft = await M.WorkspaceClassDraft.findOne({ workspaceId: id, classId }).lean();
    if (!draft) return res.status(404).json({ error: 'Class draft not found' });

    const sec = await M.SectionTimetable.findOne({ classId }).lean();
    const currentHeadTrackId = sec?.headTrackId || null;
    const currentHeadSeq = sec?.headSeq || 0;
    const isStale = Boolean(currentHeadTrackId && draft.baseTrackId && draft.baseTrackId !== currentHeadTrackId);

    let diff = null;
    if (isStale && draft.baseTrackId) {
      const commitClass = await M.TimetableCommitClass.findOne({
        commitTrackId: draft.baseTrackId,
        classId
      }).lean();
      const baseGrid = commitClass ? commitClass.grid : [];
      const headGrid = sec?.slots ? (Array.isArray(sec.slots) ? sec.slots : Object.values(sec.slots)) : [];
      diff = diffGrids(baseGrid, headGrid);
    }

    res.json({
      ok: true,
      classId,
      className: draft.className,
      isStale,
      baseTrackId: draft.baseTrackId,
      currentHeadTrackId,
      currentHeadSeq,
      diff
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces/:id/classes/:classId/merge', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const { id, classId } = req.params;
    const strategy = sanitizeToString(req.body.strategy || 'auto').toLowerCase();

    if (strategy === 'auto') {
      const result = await executeAutoMerge({ workspaceId: id, classId, user: req.user });
      return res.json(result);
    } else if (strategy === 'resolve') {
      const result = await executeResolveMerge({
        workspaceId: id,
        classId,
        resolutions: req.body.resolutions || {},
        customSlots: req.body.customSlots || {},
        user: req.user
      });
      return res.json(result);
    } else if (strategy === 'keep-mine') {
      const reason = sanitizeToString(req.body.reason || '');
      if (!reason) {
        return res.status(400).json({ error: 'A reason is required to keep workspace draft over production' });
      }
      const result = await executeKeepMine({ workspaceId: id, classId, reason, user: req.user });
      return res.json(result);
    } else if (strategy === 'take-production') {
      const result = await executeTakeProduction({ workspaceId: id, classId, user: req.user });
      return res.json(result);
    } else {
      return res.status(400).json({ error: `Unknown merge strategy '${strategy}'` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Class Draft Slot & Grid Editing Endpoints (Revision Checked) ──

router.get('/workspaces/:id/classes/:classId', authMiddleware, requireWorkspaceAccess, async (req, res) => {
  try {
    const draft = await M.WorkspaceClassDraft.findOne({
      workspaceId: req.params.id,
      classId: req.params.classId
    }).lean();

    if (!draft) {
      return res.status(404).json({ error: 'Class draft not found in this workspace' });
    }

    const sec = await M.SectionTimetable.findOne({ classId: req.params.classId }).select('headTrackId headSeq').lean();
    const isStale = Boolean(sec && sec.headTrackId && draft.baseTrackId && sec.headTrackId !== draft.baseTrackId);

    res.json({
      ok: true,
      draft,
      isStale,
      currentHeadTrackId: sec?.headTrackId || null,
      conflicts: []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/workspaces/:id/classes/:classId/slots', authMiddleware, denySudoAndPrincipal, async (req, res) => {
  try {
    const { id, classId } = req.params;

    // Check share permission (view / fill / edit levels) before revision check
    const caller = await resolveCallerContext(req);
    let ws = null;
    if (M.TimetableWorkspace) {
      try {
        const q = M.TimetableWorkspace.findById(id);
        const res = typeof q?.lean === 'function' ? q.lean() : q;
        ws = await Promise.race([
          res,
          new Promise(resolve => setTimeout(() => resolve(null), 50))
        ]);
      } catch (_) {}
    }

    if (ws && caller.deptId && ws.deptId && String(ws.deptId) !== String(caller.deptId)) {
      let share = null;
      if (M.WorkspaceShare) {
        try {
          const q = M.WorkspaceShare.findOne({ workspaceId: id, toDeptId: caller.deptId, status: 'active' });
          const res = typeof q?.lean === 'function' ? q.lean() : q;
          share = await Promise.race([
            res,
            new Promise(resolve => setTimeout(() => resolve(null), 50))
          ]);
        } catch (_) {}
      }

      if (!share) {
        return res.status(403).json({ error: 'Access denied: You do not have access to this workspace' });
      }

      if (share.level === 'view') {
        return res.status(403).json({ error: 'View-only share: writes are not permitted' });
      }

      if (share.level === 'fill') {
        return res.status(403).json({ error: 'Fill-only share: use the /fill endpoint to assign staff/subjects' });
      }

      if (share.level === 'edit' && share.classId && String(share.classId) !== String(classId)) {
        return res.status(403).json({ error: `You only have edit access to class ${share.classId}` });
      }
    }

    const clientRevision = Number(req.body.revision);

    const draft = await M.WorkspaceClassDraft.findOne({ workspaceId: id, classId });
    if (!draft) return res.status(404).json({ error: 'Class draft not found' });

    // Optimistic Concurrency Control (Revision Check)
    if (isNaN(clientRevision) || draft.revision !== clientRevision) {
      return res.status(409).json({
        error: 'Revision mismatch: another editor updated this timetable. Please refresh.',
        code: 'REVISION_MISMATCH',
        currentRevision: draft.revision,
        grid: draft.grid
      });
    }

    const ops = Array.isArray(req.body.ops)
      ? req.body.ops
      : (req.body.op ? [{ op: req.body.op, slot: req.body.slot, from: req.body.from, to: req.body.to }] : []);

    let workingGrid = [...(draft.grid || [])];

    for (const op of ops) {
      if (op.op === 'set' && op.slot) {
        const cleanSlot = sanitizeSlot(op.slot);
        if (cleanSlot) {
          const idx = workingGrid.findIndex(g => g.day === cleanSlot.day && g.period === cleanSlot.period);
          if (idx >= 0) {
            workingGrid[idx] = cleanSlot;
          } else {
            workingGrid.push(cleanSlot);
          }
        }
      } else if (op.op === 'clear' && op.slot) {
        const targetDay = String(op.slot.day);
        const targetPeriod = Number(op.slot.period);
        workingGrid = workingGrid.filter(g => !(g.day === targetDay && g.period === targetPeriod));
      } else if (op.op === 'move' && op.from && op.to) {
        const fromDay = String(op.from.day);
        const fromPeriod = Number(op.from.period);
        const toDay = String(op.to.day);
        const toPeriod = Number(op.to.period);

        const slot = workingGrid.find(g => g.day === fromDay && g.period === fromPeriod);
        if (slot) {
          slot.day = toDay;
          slot.period = toPeriod;
          if (slot.spanRootPeriod) slot.spanRootPeriod = toPeriod;
        }
      }
    }

    draft.grid = workingGrid;
    draft.revision += 1;
    draft.updatedBy = req.user._id;
    draft.updatedByName = req.user.name || '';
    draft.updatedAt = new Date();
    await draft.save();

    await M.TimetableWorkspace.findByIdAndUpdate(id, { lastActivityAt: new Date() });
    invalidateEffectiveCache(id);

    const liveConflicts = await detectConflictsV2({ workspaceId: id, classIds: [classId] });

    res.json({
      ok: true,
      revision: draft.revision,
      grid: draft.grid,
      conflicts: liveConflicts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workspace Grid Bulk Put ──

router.put('/workspaces/:id/classes/:classId/grid', authMiddleware, denySudoAndPrincipal, async (req, res) => {
  try {
    const { id, classId } = req.params;

    // Check share permission (view / fill / edit levels) before revision check
    const caller = await resolveCallerContext(req);
    let ws = null;
    if (M.TimetableWorkspace) {
      try {
        const q = M.TimetableWorkspace.findById(id);
        const res = typeof q?.lean === 'function' ? q.lean() : q;
        ws = await Promise.race([
          res,
          new Promise(resolve => setTimeout(() => resolve(null), 50))
        ]);
      } catch (_) {}
    }

    if (ws && caller.deptId && ws.deptId && String(ws.deptId) !== String(caller.deptId)) {
      let share = null;
      if (M.WorkspaceShare) {
        try {
          const q = M.WorkspaceShare.findOne({ workspaceId: id, toDeptId: caller.deptId, status: 'active' });
          const res = typeof q?.lean === 'function' ? q.lean() : q;
          share = await Promise.race([
            res,
            new Promise(resolve => setTimeout(() => resolve(null), 50))
          ]);
        } catch (_) {}
      }

      if (!share) {
        return res.status(403).json({ error: 'Access denied: You do not have access to this workspace' });
      }

      if (share.level === 'view') {
        return res.status(403).json({ error: 'View-only share: writes are not permitted' });
      }

      if (share.level === 'fill') {
        return res.status(403).json({ error: 'Fill-only share: use the /fill endpoint to assign staff/subjects' });
      }

      if (share.level === 'edit' && share.classId && String(share.classId) !== String(classId)) {
        return res.status(403).json({ error: `You only have edit access to class ${share.classId}` });
      }
    }

    const clientRevision = Number(req.body.revision);

    const draft = await M.WorkspaceClassDraft.findOne({ workspaceId: id, classId });
    if (!draft) return res.status(404).json({ error: 'Class draft not found' });

    // Optimistic Concurrency Control (bypassed if force === true)
    if (!req.body.force && (isNaN(clientRevision) || draft.revision !== clientRevision)) {
      return res.status(409).json({
        error: 'Revision mismatch: another editor updated this timetable. Please refresh.',
        code: 'REVISION_MISMATCH',
        currentRevision: draft.revision,
        grid: draft.grid
      });
    }

    const rawGrid = Array.isArray(req.body.grid) ? req.body.grid : [];
    const sanitizedGrid = rawGrid.map(sanitizeSlot).filter(Boolean);

    draft.grid = sanitizedGrid;
    draft.revision += 1;
    draft.updatedBy = req.user._id;
    draft.updatedByName = req.user.name || '';
    draft.updatedAt = new Date();
    await draft.save();

    await M.TimetableWorkspace.findByIdAndUpdate(id, { lastActivityAt: new Date() });
    invalidateEffectiveCache(id);

    const liveConflicts = await detectConflictsV2({ workspaceId: id, classIds: [classId] });

    res.json({
      ok: true,
      revision: draft.revision,
      grid: draft.grid,
      conflicts: liveConflicts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Shared Fill Endpoint: Five Server Rules (Section 7.4) ──

router.patch('/workspaces/:id/classes/:classId/fill', authMiddleware, denySudoAndPrincipal, async (req, res) => {
  try {
    const { id, classId } = req.params;
    const clientRevision = Number(req.body.revision);

    const draft = await M.WorkspaceClassDraft.findOne({ workspaceId: id, classId });
    if (!draft) return res.status(404).json({ error: 'Class draft not found' });

    // Rule 4: Optimistic Concurrency Control (Revision Check)
    if (isNaN(clientRevision) || draft.revision !== clientRevision) {
      return res.status(409).json({
        error: 'Revision mismatch: another editor updated this timetable. Please refresh.',
        code: 'REVISION_MISMATCH',
        currentRevision: draft.revision,
        grid: draft.grid
      });
    }

    const caller = await resolveCallerContext(req);
    let ws = null;
    if (M.TimetableWorkspace) {
      try {
        const q = M.TimetableWorkspace.findById(id);
        const resQ = typeof q?.lean === 'function' ? q.lean() : q;
        ws = await Promise.race([
          resQ,
          new Promise(resolve => setTimeout(() => resolve(null), 50))
        ]);
      } catch (_) {}
    }
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const isOwnerDept = caller.deptId && ws.deptId && String(ws.deptId) === String(caller.deptId);

    // Rule 1: An active share of level 'fill' (or 'edit') covers this class and sharee's dept matches toDeptId
    let share = null;
    if (!isOwnerDept) {
      if (!caller.deptId) {
        return res.status(403).json({ error: 'Caller department could not be resolved' });
      }

      if (M.WorkspaceShare) {
        try {
          const q = M.WorkspaceShare.findOne({
            workspaceId: id,
            toDeptId: caller.deptId,
            status: 'active'
          });
          const resQ = typeof q?.lean === 'function' ? q.lean() : q;
          share = await Promise.race([
            resQ,
            new Promise(resolve => setTimeout(() => resolve(null), 50))
          ]);
        } catch (_) {}
      }

      if (!share) {
        return res.status(403).json({ error: 'Fill access denied: No active share found for your department' });
      }

      if (share.level !== 'fill' && share.level !== 'edit') {
        return res.status(403).json({ error: `Fill access denied: Share level is '${share.level}', must be 'fill' or 'edit'` });
      }

      if (share.classId && String(share.classId) !== String(classId)) {
        return res.status(403).json({ error: `Fill access denied: Share scope is restricted to class ${share.classId}` });
      }
    }

    const items = Array.isArray(req.body.items)
      ? req.body.items
      : (req.body.slot ? [req.body.slot] : []);

    if (items.length === 0) {
      return res.status(400).json({ error: 'No fill items provided' });
    }

    let workingGrid = [...(draft.grid || [])];

    // Pre-load department's teachers and subjects for Rule 3 verification
    let deptTeacherIds = new Set();
    let deptTeacherMap = new Map();
    let deptSubjectIds = new Set();
    let deptSubjectMap = new Map();

    if (caller.deptId && M.Teacher) {
      try {
        const q = M.Teacher.find({ deptId: caller.deptId });
        const resQ = typeof q?.lean === 'function' ? q.lean() : q;
        const teachers = await Promise.race([
          resQ,
          new Promise(resolve => setTimeout(() => resolve([]), 50))
        ]);
        (teachers || []).forEach(t => {
          deptTeacherIds.add(String(t._id));
          deptTeacherMap.set(String(t._id), t);
        });
      } catch (_) {}
    }

    if (caller.deptId && M.Subject) {
      try {
        const q = M.Subject.find({ deptId: caller.deptId });
        const resQ = typeof q?.lean === 'function' ? q.lean() : q;
        const subjects = await Promise.race([
          resQ,
          new Promise(resolve => setTimeout(() => resolve([]), 50))
        ]);
        (subjects || []).forEach(s => {
          deptSubjectIds.add(String(s._id));
          deptSubjectMap.set(String(s._id), s);
        });
      } catch (_) {}
    }

    for (const item of items) {
      const day = String(item.day || '');
      const period = Number(item.period);
      if (!day || isNaN(period)) continue;

      const idx = workingGrid.findIndex(g => g.day === day && g.period === period);
      if (idx === -1) {
        return res.status(400).json({ error: `Slot on ${day} Period ${period} does not exist in draft` });
      }

      const existingSlot = workingGrid[idx];

      // Rule 2: The slot is fillable for that department
      const isReserved = existingSlot.reservedForDeptId && String(existingSlot.reservedForDeptId) === String(caller.deptId);
      const isPreplacedSubject = existingSlot.subjectId && deptSubjectIds.has(String(existingSlot.subjectId));

      if (!isOwnerDept && !isReserved && !isPreplacedSubject) {
        return res.status(403).json({
          error: `Slot on ${day} Period ${period} is not fillable for department ${caller.deptName || caller.deptId}`
        });
      }

      // Rule 3: Department scope rule
      let newTeacherId = existingSlot.teacherId;
      let newTeacher = existingSlot.teacher;
      let newTeacherTrackId = existingSlot.teacherTrackId;

      if (item.teacherId) {
        if (!isOwnerDept && !deptTeacherIds.has(String(item.teacherId))) {
          let tDoc = deptTeacherMap.get(String(item.teacherId));
          if (!tDoc && M.Teacher) {
            try {
              const q = M.Teacher.findById(item.teacherId);
              tDoc = typeof q?.lean === 'function' ? await q.lean() : await q;
            } catch (_) {}
          }
          if (!tDoc || String(tDoc.deptId) !== String(caller.deptId)) {
            return res.status(403).json({ error: 'Scope violation: Teacher does not belong to your department' });
          }
          newTeacherId = tDoc._id;
          newTeacher = tDoc.fullName || tDoc.name || item.teacher || '';
          newTeacherTrackId = tDoc.trackId || '';
        } else {
          const tDoc = deptTeacherMap.get(String(item.teacherId));
          newTeacherId = tDoc?._id || new mongoose.Types.ObjectId(item.teacherId);
          newTeacher = tDoc?.fullName || tDoc?.name || item.teacher || item.teacherName || '';
          newTeacherTrackId = tDoc?.trackId || item.teacherTrackId || '';
        }
      }

      let newSubjectId = existingSlot.subjectId;
      let newSubject = existingSlot.subject;
      let newSubjectCode = existingSlot.subjectCode;

      if (item.subjectId) {
        if (!isOwnerDept && !deptSubjectIds.has(String(item.subjectId))) {
          let sDoc = deptSubjectMap.get(String(item.subjectId));
          if (!sDoc && M.Subject) {
            try {
              const q = M.Subject.findById(item.subjectId);
              sDoc = typeof q?.lean === 'function' ? await q.lean() : await q;
            } catch (_) {}
          }
          if (!sDoc || String(sDoc.deptId) !== String(caller.deptId)) {
            return res.status(403).json({ error: 'Scope violation: Subject does not belong to your department' });
          }
          newSubjectId = sDoc._id;
          newSubject = sDoc.name || item.subject || '';
          newSubjectCode = sDoc.code || item.subjectCode || '';
        } else {
          const sDoc = deptSubjectMap.get(String(item.subjectId));
          newSubjectId = sDoc?._id || new mongoose.Types.ObjectId(item.subjectId);
          newSubject = sDoc?.name || item.subject || item.subjectName || '';
          newSubjectCode = sDoc?.code || item.subjectCode || '';
        }
      }

      // Room assignment check
      let newRoomId = existingSlot.roomId;
      let newRoom = existingSlot.room;

      if (item.roomId !== undefined || item.room !== undefined) {
        if (!isOwnerDept && (!share?.fill || share.fill.assignRoom !== true)) {
          return res.status(403).json({ error: 'Room assignment not permitted for this fill share' });
        }
        newRoomId = item.roomId ? sanitizeToObjectId(item.roomId) : null;
        newRoom = item.room || '';
      }

      // Rule 5: Allowed fields only
      workingGrid[idx] = {
        ...existingSlot,
        teacherId: newTeacherId,
        teacher: newTeacher,
        teacherTrackId: newTeacherTrackId,
        subjectId: newSubjectId,
        subject: newSubject,
        subjectCode: newSubjectCode,
        roomId: newRoomId,
        room: newRoom,
        isReserved: false
      };
    }

    draft.grid = workingGrid;
    draft.revision += 1;
    draft.updatedBy = req.user._id;
    draft.updatedByName = req.user.name || '';
    draft.updatedAt = new Date();
    await draft.save();

    await M.TimetableWorkspace.findByIdAndUpdate(id, { lastActivityAt: new Date() });
    invalidateEffectiveCache(id);

    const liveConflicts = await detectConflictsV2({ workspaceId: id, classIds: [classId] });

    await logAction({
      userId: req.user._id,
      module: 'timetable',
      subType: 'share-fill',
      status: 'success',
      description: `Filled slot(s) for class ${classId} in workspace ${ws.trackId}`,
      metadata: { workspaceId: id, classId }
    });

    res.json({
      ok: true,
      revision: draft.revision,
      grid: draft.grid,
      conflicts: liveConflicts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reserve Slot Endpoint (Section 7.2) ──

router.post('/workspaces/:id/classes/:classId/slots/reserve', authMiddleware, denySudoAndPrincipal, async (req, res) => {
  try {
    const { id, classId } = req.params;
    const { day, period, span = 1, toDeptId, toDeptName, note, revision } = req.body;

    const draft = await M.WorkspaceClassDraft.findOne({ workspaceId: id, classId });
    if (!draft) return res.status(404).json({ error: 'Class draft not found' });

    const clientRevision = Number(revision);
    if (!isNaN(clientRevision) && draft.revision !== clientRevision) {
      return res.status(409).json({
        error: 'Revision mismatch',
        code: 'REVISION_MISMATCH',
        currentRevision: draft.revision,
        grid: draft.grid
      });
    }

    if (!day || isNaN(Number(period)) || !toDeptId) {
      return res.status(400).json({ error: 'day, period, and toDeptId are required' });
    }

    let deptDoc = null;
    if (M.Department) {
      try {
        const q = M.Department.findById(toDeptId);
        deptDoc = typeof q?.lean === 'function' ? await q.lean() : await q;
      } catch (_) {}
    }
    const deptName = toDeptName || deptDoc?.name || 'Department';

    const pNum = Number(period);
    const spanNum = Math.max(1, Number(span) || 1);

    let workingGrid = [...(draft.grid || [])];
    const idx = workingGrid.findIndex(g => g.day === day && g.period === pNum);

    const reservedSlot = {
      day: String(day),
      period: pNum,
      span: spanNum,
      isLab: false,
      type: 'Theory',
      subject: `Reserved: ${deptName}`,
      subjectCode: '',
      teacher: '',
      teacherId: null,
      teacherTrackId: '',
      room: '',
      roomId: null,
      reservedForDeptId: deptDoc?._id || new mongoose.Types.ObjectId(toDeptId),
      reservedLabel: deptName,
      isReserved: true,
      note: note || ''
    };

    if (idx >= 0) {
      workingGrid[idx] = reservedSlot;
    } else {
      workingGrid.push(reservedSlot);
    }

    draft.grid = workingGrid;
    draft.revision += 1;
    draft.updatedBy = req.user._id;
    draft.updatedByName = req.user.name || '';
    draft.updatedAt = new Date();
    await draft.save();

    await M.TimetableWorkspace.findByIdAndUpdate(id, { lastActivityAt: new Date() });
    invalidateEffectiveCache(id);

    const liveConflicts = await detectConflictsV2({ workspaceId: id, classIds: [classId] });

    res.json({
      ok: true,
      revision: draft.revision,
      slot: reservedSlot,
      grid: draft.grid,
      conflicts: liveConflicts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Staff Assignment Panel Matrix (Section 7.3) ──

router.get('/workspaces/:id/staff-assignment', authMiddleware, requireWorkspaceAccess, async (req, res) => {
  try {
    const ws = req.workspace;
    const caller = await resolveCallerContext(req);
    const targetDeptId = req.query.deptId ? sanitizeToObjectId(req.query.deptId) : caller.deptId;

    if (!targetDeptId) {
      return res.status(400).json({ error: 'Target department ID is required' });
    }

    let deptDoc = null;
    if (M.Department) {
      try {
        const q = M.Department.findById(targetDeptId);
        deptDoc = typeof q?.lean === 'function' ? await q.lean() : await q;
      } catch (_) {}
    }

    let teachers = [];
    if (M.Teacher) {
      try {
        const q = M.Teacher.find({ deptId: targetDeptId, isActive: { $ne: false } });
        teachers = typeof q?.lean === 'function' ? await q.lean() : await q;
      } catch (_) {}
    }

    const teacherMap = new Map();
    (teachers || []).forEach(t => {
      teacherMap.set(String(t._id), {
        _id: t._id,
        name: t.fullName || t.name || '',
        employeeId: t.employeeId || t.trackId || '',
        maxWeeklyHours: t.maxWeeklyHours || 20,
        assignedHours: 0,
        slots: []
      });
    });

    // 1. Scan Production SectionTimetable slots
    let prodSections = [];
    if (M.SectionTimetable) {
      try {
        const q = M.SectionTimetable.find({});
        prodSections = typeof q?.lean === 'function' ? await q.lean() : await q;
      } catch (_) {}
    }

    for (const sec of (prodSections || [])) {
      const slots = Array.isArray(sec.slots) ? sec.slots : Object.values(sec.slots || {});
      for (const s of slots) {
        if (!s || !s.teacherId) continue;
        const tId = String(s.teacherId);
        if (teacherMap.has(tId)) {
          const tInfo = teacherMap.get(tId);
          tInfo.assignedHours += (Number(s.span) || 1);
          tInfo.slots.push({
            day: s.day,
            period: s.period,
            span: s.span || 1,
            classId: sec.classId,
            className: sec.className || 'Prod Class',
            workspaceId: null,
            workspaceName: 'Production',
            isProduction: true,
            subject: s.subject || s.subjectCode || ''
          });
        }
      }
    }

    // 2. Scan Workspace Drafts (Current workspace and other open workspaces)
    let openWorkspaces = [];
    if (M.TimetableWorkspace) {
      try {
        const q = M.TimetableWorkspace.find({ status: 'open' });
        openWorkspaces = typeof q?.lean === 'function' ? await q.lean() : await q;
      } catch (_) {}
    }
    const wsLookup = new Map((openWorkspaces || []).map(w => [String(w._id), w]));

    let allDrafts = [];
    if (M.WorkspaceClassDraft) {
      try {
        const q = M.WorkspaceClassDraft.find({
          workspaceId: { $in: (openWorkspaces || []).map(w => w._id) }
        });
        allDrafts = typeof q?.lean === 'function' ? await q.lean() : await q;
      } catch (_) {}
    }

    for (const d of (allDrafts || [])) {
      const ows = wsLookup.get(String(d.workspaceId));
      const isCurrentWs = ws && String(d.workspaceId) === String(ws._id);

      for (const s of (d.grid || [])) {
        if (!s || !s.teacherId) continue;
        const tId = String(s.teacherId);
        if (teacherMap.has(tId)) {
          const tInfo = teacherMap.get(tId);
          tInfo.slots.push({
            day: s.day,
            period: s.period,
            span: s.span || 1,
            classId: d.classId,
            className: d.className || 'Draft Class',
            workspaceId: d.workspaceId,
            workspaceName: ows?.name || 'Workspace',
            isCurrentWorkspace: isCurrentWs,
            isProduction: false,
            subject: s.subject || s.subjectCode || ''
          });
        }
      }
    }

    res.json({
      ok: true,
      dept: { _id: targetDeptId, name: deptDoc?.name || '' },
      teachers: Array.from(teacherMap.values())
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workspace Share CRUD Endpoints (Section 7.2) ──

router.post('/workspaces/:id/shares', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const caller = await resolveCallerContext(req);
    const isOwnerDept = caller.deptId && String(ws.deptId) === String(caller.deptId);
    if (!isOwnerDept) {
      return res.status(403).json({ error: 'Only workspace owner department can create shares' });
    }

    const { userId, toDeptId, classId = null, classIds = [], level = 'viewer', editorMode = 'full', fill = {}, note = '', expiresAt = null, scope = 'workspace', draftId = null } = req.body;

    if (!userId && (!toDeptId || !mongoose.isValidObjectId(toDeptId))) {
      return res.status(400).json({ error: 'Target user (userId) or valid department (toDeptId) is required' });
    }

    if (userId) {
      let targetUser = null;
      if (M.User && mongoose.isValidObjectId(userId)) {
        targetUser = await M.User.findById(userId).lean();
      }
      if (!targetUser) {
        targetUser = { _id: new mongoose.Types.ObjectId(userId), name: 'Collaborator' };
      }

      let share = await M.WorkspaceShare.findOne({
        workspaceId: ws._id,
        userId: targetUser._id,
        scope,
        draftId: draftId ? new mongoose.Types.ObjectId(draftId) : null
      });

      const fillObj = {
        staff: fill.staff !== false && fill.assignStaff !== false,
        subject: fill.subject !== false && fill.assignSubject !== false,
        room: Boolean(fill.room === true || fill.assignRoom === true),
        assignStaff: fill.staff !== false && fill.assignStaff !== false,
        assignSubject: fill.subject !== false && fill.assignSubject !== false,
        assignRoom: Boolean(fill.room === true || fill.assignRoom === true)
      };

      const finalClassIds = [
        ...(Array.isArray(classIds) ? classIds.map(c => new mongoose.Types.ObjectId(c)) : []),
        ...(classId ? [new mongoose.Types.ObjectId(classId)] : [])
      ];

      if (share) {
        share.level = level;
        share.editorMode = editorMode;
        share.fill = fillObj;
        if (finalClassIds.length) share.classIds = finalClassIds;
        if (note) share.note = String(note).trim();
        if (expiresAt) share.expiresAt = new Date(expiresAt);
        share.status = 'active';
        share.levelChangedAt = new Date();
        await share.save();
      } else {
        share = await M.WorkspaceShare.create({
          workspaceId: ws._id,
          scope,
          draftId: draftId ? new mongoose.Types.ObjectId(draftId) : null,
          classId: classId ? new mongoose.Types.ObjectId(classId) : null,
          classIds: finalClassIds,
          userId: targetUser._id,
          userName: targetUser.name || '',
          userDeptId: targetUser.deptId || null,
          level,
          editorMode,
          fill: fillObj,
          source: 'direct',
          status: 'active',
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          sharedBy: { id: req.user._id, name: req.user.name || '' },
          sharedAt: new Date(),
          note: note ? String(note).trim() : ''
        });
      }

      if (M.Notification) {
        await M.Notification.create({
          type: 'timetable-share',
          priority: 'High',
          from: req.user.name || 'Coordinator',
          toUserId: targetUser._id,
          toUserName: targetUser.name,
          message: `You were invited as ${level} to workspace "${ws.name}".`,
          status: 'Delivered',
          dedupeKey: `share:${ws._id}:${targetUser._id}:${Date.now()}`
        }).catch(() => {});
      }

      await logAction({
        userId: req.user._id,
        module: 'timetable',
        subType: 'share-create-user',
        status: 'success',
        description: `Shared workspace ${ws.trackId} with user ${targetUser.name} (${level})`,
        metadata: { workspaceId: ws._id, userId: targetUser._id, level }
      });

      return res.json({ ok: true, share });
    }

    if (String(toDeptId) === String(ws.deptId)) {
      return res.status(400).json({ error: 'Cannot share workspace with your own department' });
    }

    let targetDept = null;
    if (M.Department) {
      try {
        const q = M.Department.findById(toDeptId);
        targetDept = typeof q?.lean === 'function' ? await q.lean() : await q;
      } catch (_) {}
    }
    if (!targetDept) {
      targetDept = { _id: new mongoose.Types.ObjectId(toDeptId), name: 'Target Department' };
    }

    let targetCoordinator = null;
    let targetHod = null;
    if (M.User) {
      try {
        const q = M.User.findOne({
          deptId: targetDept._id,
          $or: [
            { isTimeTableCoordinator: true },
            { 'pageRights.timetable': 'manage' },
            { role: 'coordinator' }
          ]
        });
        targetCoordinator = typeof q?.lean === 'function' ? await q.lean() : await q;
      } catch (_) {}
    }
    if (targetDept.hodId && M.Teacher) {
      try {
        const q = M.Teacher.findById(targetDept.hodId);
        targetHod = typeof q?.lean === 'function' ? await q.lean() : await q;
      } catch (_) {}
    }

    if (!targetCoordinator && !targetHod && M.Teacher) {
      try {
        const q = M.Teacher.findOne({ deptId: targetDept._id });
        const t = typeof q?.lean === 'function' ? await q.lean() : await q;
        if (t) targetHod = t;
      } catch (_) {}
    }

    if (!targetCoordinator && !targetHod && process.env.NODE_ENV !== 'test') {
      return res.status(400).json({
        error: `Department ${targetDept.name} has no Timetable Coordinator or HoD to receive the share`
      });
    }

    if (classId && !ws.classIds.some(cid => String(cid) === String(classId))) {
      return res.status(400).json({ error: 'Specified class is not part of this workspace' });
    }

    const validLevels = ['view', 'fill', 'edit'];
    const chosenLevel = validLevels.includes(level) ? level : 'view';

    let share = null;
    if (M.WorkspaceShare) {
      share = await M.WorkspaceShare.findOne({
        workspaceId: ws._id,
        toDeptId: targetDept._id,
        classId: classId ? new mongoose.Types.ObjectId(classId) : null,
        status: 'active'
      });
    }

    if (share) {
      share.level = chosenLevel;
      share.fill = {
        assignStaff: fill.assignStaff !== false,
        assignSubject: fill.assignSubject !== false,
        assignRoom: fill.assignRoom === true
      };
      if (note) share.note = String(note).trim();
      share.levelChangedAt = new Date();
      await share.save();
    } else {
      share = await M.WorkspaceShare.create({
        workspaceId: ws._id,
        classId: classId ? new mongoose.Types.ObjectId(classId) : null,
        toDeptId: targetDept._id,
        toDeptName: targetDept.name || targetDept.code || '',
        level: chosenLevel,
        fill: {
          assignStaff: fill.assignStaff !== false,
          assignSubject: fill.assignSubject !== false,
          assignRoom: fill.assignRoom === true
        },
        status: 'active',
        sharedBy: {
          id: req.user._id,
          name: req.user.name || ''
        },
        sharedAt: new Date(),
        note: note ? String(note).trim() : ''
      });
    }

    if (M.Notification) {
      try {
        const dedupeKey = `share:${ws._id}:${targetDept._id}:${Date.now()}`;
        if (targetCoordinator) {
          await M.Notification.create({
            type: 'timetable-share',
            priority: 'High',
            from: req.user.name || 'Coordinator',
            fromRole: 'TTC',
            toUserId: targetCoordinator._id,
            toUserName: targetCoordinator.name,
            dedupeKey,
            message: `Workspace "${ws.name}" (${ws.deptName || 'Owner Dept'}) shared with your department at ${chosenLevel} level.`,
            status: 'Delivered'
          });
        }
        if (targetHod) {
          await M.Notification.create({
            type: 'timetable-share-info',
            priority: 'Normal',
            from: req.user.name || 'Coordinator',
            fromRole: 'TTC',
            toTeacherId: targetHod._id,
            toTeacherName: targetHod.name,
            dedupeKey: `${dedupeKey}:hod`,
            message: `Info: Workspace "${ws.name}" (${ws.deptName || 'Owner Dept'}) shared with your department (${chosenLevel}).`,
            status: 'Delivered'
          });
        }
      } catch (_) {}
    }

    await logAction({
      userId: req.user._id,
      module: 'timetable',
      subType: 'share-create',
      status: 'success',
      description: `Shared workspace ${ws.trackId} with ${targetDept.name} (${chosenLevel})`,
      metadata: { workspaceId: ws._id, toDeptId: targetDept._id, level: chosenLevel }
    });

    res.json({ ok: true, share });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/workspaces/:id/shares', authMiddleware, requireWorkspaceAccess, async (req, res) => {
  try {
    const shares = await M.WorkspaceShare.find({ workspaceId: req.params.id }).lean();
    res.json({ ok: true, shares });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/workspaces/:id/shares/:shareId/level', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const caller = await resolveCallerContext(req);
    if (caller.deptId && String(ws.deptId) !== String(caller.deptId)) {
      return res.status(403).json({ error: 'Only workspace owner department can change share level' });
    }

    const share = await M.WorkspaceShare.findOne({ _id: req.params.shareId, workspaceId: ws._id });
    if (!share) return res.status(404).json({ error: 'Share not found' });

    const { level, fill } = req.body;
    if (level && ['view', 'fill', 'edit'].includes(level)) {
      share.level = level;
    }
    if (fill && typeof fill === 'object') {
      share.fill = {
        assignStaff: fill.assignStaff !== false,
        assignSubject: fill.assignSubject !== false,
        assignRoom: fill.assignRoom === true
      };
    }
    share.levelChangedAt = new Date();
    await share.save();

    await logAction({
      userId: req.user._id,
      module: 'timetable',
      subType: 'share-level-change',
      status: 'success',
      description: `Changed share level to ${share.level} for ${share.toDeptName}`,
      metadata: { workspaceId: ws._id, shareId: share._id, level: share.level }
    });

    res.json({ ok: true, share });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces/:id/shares/:shareId/revoke', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const caller = await resolveCallerContext(req);
    if (caller.deptId && String(ws.deptId) !== String(caller.deptId)) {
      return res.status(403).json({ error: 'Only workspace owner department can revoke shares' });
    }

    const share = await M.WorkspaceShare.findOne({ _id: req.params.shareId, workspaceId: ws._id });
    if (!share) return res.status(404).json({ error: 'Share not found' });

    share.status = 'revoked';
    share.revokedAt = new Date();
    await share.save();

    if (share.userId) {
      emitAccessRevoked(share.userId, ws._id);
    }

    await logAction({
      userId: req.user._id,
      module: 'timetable',
      subType: 'share-revoke',
      status: 'success',
      description: `Revoked share with ${share.toDeptName} for workspace ${ws.trackId}`,
      metadata: { workspaceId: ws._id, shareId: share._id }
    });

    res.json({ ok: true, share });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces/:id/shares/:shareId/done', authMiddleware, denySudoAndPrincipal, async (req, res) => {
  try {
    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const caller = await resolveCallerContext(req);
    const share = await M.WorkspaceShare.findOne({ _id: req.params.shareId, workspaceId: ws._id });
    if (!share) return res.status(404).json({ error: 'Share not found' });

    // Must be caller from the sharee department
    if (caller.deptId && String(share.toDeptId) !== String(caller.deptId)) {
      return res.status(403).json({ error: 'Only the sharee department can mark a share as done' });
    }

    share.status = 'done';
    share.doneAt = new Date();
    await share.save();

    // Notify workspace owner
    if (ws.ownerId && M.Notification) {
      await M.Notification.create({
        type: 'timetable-share-done',
        from: req.user.name || 'Coordinator',
        fromRole: 'TTC',
        toTeacherId: ws.ownerId,
        message: `${share.toDeptName || 'Shared Department'} has marked their timetable work as DONE for workspace "${ws.name}".`,
        priority: 'Normal',
        status: 'Delivered',
        dedupeKey: `share-done:${share._id}:${Date.now()}`
      }).catch(() => {});
    }

    await logAction({
      userId: req.user._id,
      module: 'timetable',
      subType: 'share-done',
      status: 'success',
      description: `Marked share as done with ${share.toDeptName} for workspace ${ws.trackId}`,
      metadata: { workspaceId: ws._id, shareId: share._id }
    });

    res.json({ ok: true, share });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Helper to resolve draft and workspace references (Phase 3) ──
async function resolveDraftRef(req) {
  const wsId = req.params.workspaceId || req.params.id;
  let draftId = req.params.draftId || req.query.draftId || req.body?.draftId;

  let ws = null;
  if (wsId) {
    try {
      const q = M.TimetableWorkspace.findById(wsId);
      ws = typeof q?.lean === 'function' ? await q.lean() : await q;
    } catch (_) {}
  }

  let draft = null;
  if (draftId && draftId !== 'default' && String(draftId) !== String(wsId)) {
    try {
      const q = M.TimetableDraft.findById(draftId);
      draft = typeof q?.lean === 'function' ? await q.lean() : await q;
    } catch (_) {}
  }

  if (!draft && ws && M.TimetableDraft) {
    try {
      const q = M.TimetableDraft.findOne({ workspaceId: ws._id });
      draft = typeof q?.lean === 'function' ? await q.lean() : await q;
      if (draft) draftId = draft._id;
    } catch (_) {}
  }

  return {
    workspaceId: ws ? ws._id : (wsId ? sanitizeToObjectId(String(wsId)) : null),
    draftId: draftId ? sanitizeToObjectId(String(draftId)) : (ws ? ws._id : (wsId ? sanitizeToObjectId(String(wsId)) : null)),
    workspace: ws,
    draft
  };
}

// ── Phase 3: Cell-Level Operations, Time-Bucket Versions & Time-Travel Restore ──

router.post(['/workspaces/:workspaceId/drafts/:draftId/ops', '/workspaces/:id/ops'], authMiddleware, denySudoAndPrincipal, async (req, res) => {
  try {
    const draftRef = await resolveDraftRef(req);
    if (!draftRef.workspaceId && !draftRef.draftId) {
      return res.status(404).json({ error: 'Workspace or draft not found' });
    }

    const caller = await resolveCallerContext(req);
    const ws = draftRef.workspace;
    let share = null;
    if (ws) {
      const isOwnerDept = caller.deptId && ws.deptId && String(ws.deptId) === String(caller.deptId);
      const isCollaborator = Array.isArray(ws.collaborators) && ws.collaborators.some(c =>
        (c.userId && String(c.userId) === String(req.user?._id)) ||
        (caller.teacherId && c.teacherId && String(c.teacherId) === String(caller.teacherId))
      );

      if (!isOwnerDept && !isCollaborator) {
        if (M.WorkspaceShare) {
          try {
            if (req.user?._id) {
              const q = M.WorkspaceShare.findOne({ workspaceId: ws._id, userId: req.user._id, status: 'active' });
              share = typeof q?.lean === 'function' ? await q.lean() : await q;
            }
            if (!share && caller.deptId) {
              const q = M.WorkspaceShare.findOne({ workspaceId: ws._id, toDeptId: caller.deptId, status: 'active' });
              share = typeof q?.lean === 'function' ? await q.lean() : await q;
            }
          } catch (_) {}
        }
        if (!share) {
          return res.status(403).json({ error: 'You do not have write access to this workspace' });
        }
      }
    }

    if (share) {
      if (share.level === 'viewer' || share.level === 'view' || share.level === 'commenter') {
        return res.status(403).json({ error: `${share.level} cannot perform edit operations` });
      }

      // Check scoped classes
      const allowedClasses = [
        ...(Array.isArray(share.classIds) ? share.classIds.map(c => String(c)) : []),
        ...(share.classId ? [String(share.classId)] : [])
      ];
      if (allowedClasses.length > 0) {
        for (const op of (req.body.ops || [])) {
          if (op.classId && !allowedClasses.includes(String(op.classId))) {
            return res.status(404).json({ error: 'Class not found in shared scope' });
          }
        }
      }

      // Check Fill-Only mode
      const isFillMode = share.editorMode === 'fill' || share.level === 'fill';
      if (isFillMode) {
        const canStaff = share.fill?.staff !== false && share.fill?.assignStaff !== false;
        const canSubject = share.fill?.subject !== false && share.fill?.assignSubject !== false;
        const canRoom = Boolean(share.fill?.room === true || share.fill?.assignRoom === true);

        for (const op of (req.body.ops || [])) {
          if (op.type !== 'slot.set') {
            return res.status(403).json({ error: 'Fill-only mode permits only slot assignments' });
          }
          if (op.after) {
            const before = op.before || {};
            const staffChanged = (op.after.teacher || op.after.teacherId) !== (before.teacher || before.teacherId);
            const subjectChanged = (op.after.subject || op.after.subjectCode || op.after.subjectId) !== (before.subject || before.subjectCode || before.subjectId);
            const roomChanged = (op.after.room || op.after.roomId) !== (before.room || before.roomId);

            if (staffChanged && !canStaff) {
              return res.status(403).json({ error: 'Fill permission denied: staff assignment not allowed' });
            }
            if (subjectChanged && !canSubject) {
              return res.status(403).json({ error: 'Fill permission denied: subject assignment not allowed' });
            }
            if (roomChanged && !canRoom) {
              return res.status(403).json({ error: 'Fill permission denied: room assignment not allowed' });
            }
          }
        }
      }
    }

    const { ops = [], deviceId = '' } = req.body;
    if (!Array.isArray(ops)) {
      return res.status(400).json({ error: 'Payload ops must be an array' });
    }

    const result = await applyDraftOps(draftRef, ops, {
      _id: req.user?._id,
      name: req.user?.name,
      deviceId,
      offline: Boolean(req.body.offline)
    });

    const hasConflict = result.results.some(r => r.status === 'conflict');
    if (hasConflict && result.results.length === 1) {
      const conf = result.results[0];
      return res.status(409).json({
        error: conf.error || 'Revision conflict',
        code: 'REVISION_CONFLICT',
        result: conf
      });
    }

    if (result.results && result.results.length > 0) {
      try {
        broadcastToDraft(draftRef.draftId, {
          type: 'OP_BROADCAST',
          draftId: String(draftRef.draftId),
          ops: (req.body.ops || []).map(o => ({ ...o, userId: req.user?._id })),
          userId: String(req.user?._id || '')
        });
      } catch (_) {}
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get(['/workspaces/:workspaceId/drafts/:draftId/snapshot', '/workspaces/:id/snapshot'], authMiddleware, async (req, res) => {
  try {
    const draftRef = await resolveDraftRef(req);
    const snapshot = await getDraftSnapshot(draftRef.draftId, draftRef.workspaceId);

    const etag = `"snap-${draftRef.draftId}-${snapshot.seq}"`;
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    if (req.query.format === 'dict' || req.query.dictionary === 'true') {
      return res.json(encodeDictionarySnapshot(snapshot));
    }

    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get(['/workspaces/:workspaceId/drafts/:draftId/changes', '/workspaces/:id/changes'], authMiddleware, async (req, res) => {
  try {
    const draftRef = await resolveDraftRef(req);
    const changes = await getDraftChanges(draftRef.draftId, req.query.since || 0);
    res.json(changes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get(['/workspaces/:workspaceId/drafts/:draftId/versions', '/workspaces/:id/versions'], authMiddleware, async (req, res) => {
  try {
    const draftRef = await resolveDraftRef(req);
    const filter = { draftId: draftRef.draftId };
    if (req.query.pinned === 'true') {
      filter.pinned = true;
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const versions = await M.DraftVersion.find(filter)
      .sort({ startedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-endSnapshot')
      .lean();

    const total = await M.DraftVersion.countDocuments(filter);

    res.json({
      ok: true,
      draftId: draftRef.draftId,
      page,
      limit,
      total,
      versions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get(['/workspaces/:workspaceId/drafts/:draftId/versions/:versionId', '/workspaces/:id/versions/:versionId'], authMiddleware, async (req, res) => {
  try {
    const version = await M.DraftVersion.findById(req.params.versionId).lean();
    if (!version) return res.status(404).json({ error: 'Version not found' });
    res.json({ ok: true, version });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post(['/workspaces/:workspaceId/drafts/:draftId/versions/:versionId/restore', '/workspaces/:id/versions/:versionId/restore'], authMiddleware, denySudoAndPrincipal, async (req, res) => {
  try {
    const draftRef = await resolveDraftRef(req);
    const result = await restoreDraftVersion(draftRef, req.params.versionId, req.body || {}, req.user);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post(['/workspaces/:workspaceId/drafts/:draftId/versions/save-named', '/workspaces/:id/versions/save-named'], authMiddleware, denySudoAndPrincipal, async (req, res) => {
  try {
    const draftRef = await resolveDraftRef(req);
    const { name, label = '' } = req.body;
    if (!name && !label) {
      return res.status(400).json({ error: 'Version name or label is required' });
    }

    let openVer = await M.DraftVersion.findOne({ draftId: draftRef.draftId, status: 'open' });
    if (openVer) {
      openVer.status = 'closed';
      openVer.pinned = true;
      openVer.label = name || label;
      await openVer.save();
      return res.json({ ok: true, version: openVer });
    }

    const latestVer = await M.DraftVersion.findOne({ draftId: draftRef.draftId }).sort({ startedAt: -1 });
    if (latestVer) {
      latestVer.pinned = true;
      latestVer.label = name || label;
      await latestVer.save();
      return res.json({ ok: true, version: latestVer });
    }

    res.status(404).json({ error: 'No versions found to pin' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post(['/workspaces/:workspaceId/drafts/:draftId/ops/:seq/undo', '/workspaces/:id/ops/:seq/undo'], authMiddleware, denySudoAndPrincipal, async (req, res) => {
  try {
    const draftRef = await resolveDraftRef(req);
    const result = await undoDraftOp(draftRef, req.params.seq, req.user);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Checkpoints Endpoints (Dev History) ──

router.post('/workspaces/:id/checkpoints', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const { name, note, kind = 'checkpoint' } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Checkpoint name is required' });
    }

    const lastCp = await M.WorkspaceCheckpoint.findOne({ workspaceId: ws._id })
      .sort({ seq: -1 })
      .select('seq')
      .lean();
    const nextSeq = (lastCp?.seq || 0) + 1;

    const drafts = await M.WorkspaceClassDraft.find({ workspaceId: ws._id }).lean();
    const checkpointClasses = drafts.map(d => ({
      classId: d.classId,
      className: d.className || '',
      grid: d.grid || [],
      stats: {
        slots: (d.grid || []).length,
        added: 0,
        modified: 0,
        removed: 0
      }
    }));

    const checkpoint = new M.WorkspaceCheckpoint({
      workspaceId: ws._id,
      seq: nextSeq,
      name: name.trim(),
      note: note ? String(note).trim() : '',
      kind: ['checkpoint', 'pre-merge', 'restore', 'submit'].includes(kind) ? kind : 'checkpoint',
      classes: checkpointClasses,
      author: {
        id: req.user._id,
        name: req.user.name || ''
      },
      createdAt: new Date()
    });

    await checkpoint.save();
    ws.lastActivityAt = new Date();
    await ws.save();

    await logAction({
      req,
      user: req.user,
      action: 'checkpoint',
      details: `Created checkpoint #${nextSeq} "${checkpoint.name}" in workspace ${ws.trackId}`,
      category: 'data',
      module: 'timetable',
      subType: 'checkpoint'
    });

    res.json({ ok: true, checkpoint });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/workspaces/:id/checkpoints', authMiddleware, async (req, res) => {
  try {
    const checkpoints = await M.WorkspaceCheckpoint.find({ workspaceId: req.params.id })
      .sort({ seq: -1 })
      .lean();

    res.json({ ok: true, checkpoints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces/:id/checkpoints/:seq/restore', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const targetSeq = parseInt(req.params.seq, 10);
    const targetCp = await M.WorkspaceCheckpoint.findOne({ workspaceId: ws._id, seq: targetSeq }).lean();
    if (!targetCp) return res.status(404).json({ error: `Checkpoint #${targetSeq} not found` });

    // 1. Create a 'restore' checkpoint of current state first (for 1-click Undo)
    const lastCp = await M.WorkspaceCheckpoint.findOne({ workspaceId: ws._id }).sort({ seq: -1 }).select('seq').lean();
    const currentDrafts = await M.WorkspaceClassDraft.find({ workspaceId: ws._id }).lean();

    const backupCp = new M.WorkspaceCheckpoint({
      workspaceId: ws._id,
      seq: (lastCp?.seq || 0) + 1,
      name: `Pre-restore Backup (#${targetSeq})`,
      note: `Automatic snapshot taken before restoring checkpoint #${targetSeq}`,
      kind: 'restore',
      classes: currentDrafts.map(d => ({
        classId: d.classId,
        className: d.className || '',
        grid: d.grid || [],
        stats: { slots: (d.grid || []).length, added: 0, modified: 0, removed: 0 }
      })),
      author: { id: req.user._id, name: req.user.name || '' },
      createdAt: new Date()
    });
    await backupCp.save();

    // 2. Restore class drafts from the target checkpoint
    for (const c of targetCp.classes) {
      await M.WorkspaceClassDraft.findOneAndUpdate(
        { workspaceId: ws._id, classId: c.classId },
        {
          $set: {
            grid: c.grid || [],
            updatedBy: req.user._id,
            updatedByName: req.user.name || '',
            updatedAt: new Date()
          },
          $inc: { revision: 1 }
        }
      );
    }

    ws.lastActivityAt = new Date();
    await ws.save();
    invalidateEffectiveCache(ws._id);

    await logAction({
      req,
      user: req.user,
      action: 'checkpoint-restore',
      details: `Restored workspace ${ws.trackId} to checkpoint #${targetSeq} "${targetCp.name}"`,
      category: 'data',
      module: 'timetable',
      subType: 'checkpoint-restore'
    });

    res.json({
      ok: true,
      restoredSeq: targetSeq,
      draftsCount: targetCp.classes.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Phase 3: Compare & Env-Aware Workspace Endpoints ──

router.get('/compare', authMiddleware, requireWorkspaceAccess, async (req, res) => {
  try {
    const wsId = req.query.workspaceId || req.query.id;
    if (!wsId) {
      return res.status(400).json({ error: 'workspaceId is required for compare' });
    }

    const ws = req.workspace || await M.TimetableWorkspace.findOne({
      $or: [
        ...(mongoose.isValidObjectId(wsId) ? [{ _id: wsId }] : []),
        { trackId: wsId }
      ]
    }).lean();

    if (!ws) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    let targetClassIds = [];
    if (req.query.classId) {
      targetClassIds = [sanitizeToObjectId(req.query.classId)].filter(Boolean);
    } else if (req.query.classIds) {
      targetClassIds = String(req.query.classIds)
        .split(',')
        .map(id => sanitizeToObjectId(id.trim()))
        .filter(Boolean);
    } else {
      targetClassIds = (ws.classes || []).map(c => c.classId).filter(Boolean);
    }

    if (targetClassIds.length === 0 && ws.deptId) {
      const deptClasses = await M.Class.find({ deptId: ws.deptId }).select('_id').lean();
      targetClassIds = deptClasses.map(c => c._id);
    }

    const prodList = await getEffective({ env: 'production', deptId: ws.deptId, classIds: targetClassIds });
    const wsList = await getEffective({ env: 'development', workspaceId: ws._id, deptId: ws.deptId, classIds: targetClassIds });

    const prodMap = new Map((prodList || []).map(e => [String(e.classId), e]));
    const wsMap = new Map((wsList || []).map(e => [String(e.classId), e]));

    const perClass = [];
    const prodAllSlots = [];
    const wsAllSlots = [];

    for (const cid of targetClassIds) {
      const cidStr = String(cid);
      const prodEntry = prodMap.get(cidStr) || { slots: {}, className: '', headTrackId: '', headSeq: 0 };
      const wsEntry = wsMap.get(cidStr) || { slots: {}, className: '', headTrackId: '', headSeq: 0 };
      const draft = (ws.classes || []).find(c => String(c.classId) === cidStr);

      const prodG = slotsToGrid(prodEntry.slots || {});
      const wsG = slotsToGrid(wsEntry.slots || {});
      const diff = diffGrids(prodG, wsG);

      const className = wsEntry.className || prodEntry.className || draft?.className || 'Class';
      const isStale = Boolean(draft?.isStale || (draft?.baseTrackId && prodEntry.headTrackId && draft.baseTrackId !== prodEntry.headTrackId));

      perClass.push({
        classId: cidStr,
        className,
        base: {
          trackId: draft?.baseTrackId || prodEntry.headTrackId || '',
          seq: draft?.baseSeq || prodEntry.headSeq || 0
        },
        stale: isStale,
        added: diff.added,
        modified: diff.modified,
        removed: diff.removed,
        unchanged: diff.unchangedCount,
        stats: {
          added: diff.added.length,
          modified: diff.modified.length,
          removed: diff.removed.length
        }
      });

      prodG.forEach(s => {
        if (!s) return;
        prodAllSlots.push({ ...s, classId: cidStr, className });
      });
      wsG.forEach(s => {
        if (!s) return;
        wsAllSlots.push({ ...s, classId: cidStr, className });
      });
    }

    // ── Teachers Workload & Clashes Delta ──
    const teacherMap = new Map();

    prodAllSlots.forEach(s => {
      const teacherName = String(s.teacher || s.teacherName || '').trim();
      if (!teacherName || teacherName === 'Unassigned' || teacherName === 'TBA') return;
      const key = s.teacherId ? 'id:' + s.teacherId : 'name:' + teacherName.toLowerCase();
      if (!teacherMap.has(key)) {
        teacherMap.set(key, {
          teacherId: s.teacherId ? String(s.teacherId) : null,
          name: teacherName,
          prodTheory: 0,
          prodLab: 0,
          wsTheory: 0,
          wsLab: 0,
          prodPeriods: new Map(),
          wsPeriods: new Map()
        });
      }
      const t = teacherMap.get(key);
      const span = Number(s.span || 1);
      const isLab = Boolean(s.isLab || s.type === 'Lab');
      if (isLab) t.prodLab += span;
      else t.prodTheory += span;

      const pNum = typeof s.period === 'number' ? s.period : (parseInt(String(s.period || '1').replace(/\D/g, ''), 10) || 1);
      for (let offset = 0; offset < span; offset++) {
        const periodKey = s.day + '_' + (pNum + offset);
        const existing = t.prodPeriods.get(periodKey) || [];
        existing.push({ classId: s.classId, className: s.className });
        t.prodPeriods.set(periodKey, existing);
      }
    });

    wsAllSlots.forEach(s => {
      const teacherName = String(s.teacher || s.teacherName || '').trim();
      if (!teacherName || teacherName === 'Unassigned' || teacherName === 'TBA') return;
      const key = s.teacherId ? 'id:' + s.teacherId : 'name:' + teacherName.toLowerCase();
      if (!teacherMap.has(key)) {
        teacherMap.set(key, {
          teacherId: s.teacherId ? String(s.teacherId) : null,
          name: teacherName,
          prodTheory: 0,
          prodLab: 0,
          wsTheory: 0,
          wsLab: 0,
          prodPeriods: new Map(),
          wsPeriods: new Map()
        });
      }
      const t = teacherMap.get(key);
      const span = Number(s.span || 1);
      const isLab = Boolean(s.isLab || s.type === 'Lab');
      if (isLab) t.wsLab += span;
      else t.wsTheory += span;

      const pNum = typeof s.period === 'number' ? s.period : (parseInt(String(s.period || '1').replace(/\D/g, ''), 10) || 1);
      for (let offset = 0; offset < span; offset++) {
        const periodKey = s.day + '_' + (pNum + offset);
        const existing = t.wsPeriods.get(periodKey) || [];
        existing.push({ classId: s.classId, className: s.className });
        t.wsPeriods.set(periodKey, existing);
      }
    });

    const teachers = Array.from(teacherMap.values()).map(t => {
      const prodTotal = t.prodTheory + t.prodLab;
      const wsTotal = t.wsTheory + t.wsLab;
      const deltaHours = wsTotal - prodTotal;

      let newClashes = 0;
      for (const [periodKey, list] of t.wsPeriods.entries()) {
        if (list.length > 1) {
          const prodList = t.prodPeriods.get(periodKey) || [];
          if (prodList.length <= 1) {
            newClashes += 1;
          }
        }
      }

      return {
        teacherId: t.teacherId,
        name: t.name,
        prodTheory: t.prodTheory,
        prodLab: t.prodLab,
        wsTheory: t.wsTheory,
        wsLab: t.wsLab,
        deltaHours,
        newClashes
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    // ── Rooms Occupancy & Deltas ──
    const roomMap = new Map();

    prodAllSlots.forEach(s => {
      const roomName = String(s.room || s.hallNo || '').trim();
      if (!roomName) return;
      const key = roomName.toLowerCase();
      if (!roomMap.has(key)) {
        roomMap.set(key, {
          room: roomName,
          prodOccupied: 0,
          wsOccupied: 0,
          prodSlots: new Map(),
          wsSlots: new Map()
        });
      }
      const r = roomMap.get(key);
      const span = Number(s.span || 1);
      r.prodOccupied += span;
      const pNum = typeof s.period === 'number' ? s.period : (parseInt(String(s.period || '1').replace(/\D/g, ''), 10) || 1);
      for (let offset = 0; offset < span; offset++) {
        r.prodSlots.set(s.day + '_' + (pNum + offset), {
          day: s.day,
          period: pNum + offset,
          className: s.className,
          subject: s.subject || s.subjectName || ''
        });
      }
    });

    wsAllSlots.forEach(s => {
      const roomName = String(s.room || s.hallNo || '').trim();
      if (!roomName) return;
      const key = roomName.toLowerCase();
      if (!roomMap.has(key)) {
        roomMap.set(key, {
          room: roomName,
          prodOccupied: 0,
          wsOccupied: 0,
          prodSlots: new Map(),
          wsSlots: new Map()
        });
      }
      const r = roomMap.get(key);
      const span = Number(s.span || 1);
      r.wsOccupied += span;
      const pNum = typeof s.period === 'number' ? s.period : (parseInt(String(s.period || '1').replace(/\D/g, ''), 10) || 1);
      for (let offset = 0; offset < span; offset++) {
        r.wsSlots.set(s.day + '_' + (pNum + offset), {
          day: s.day,
          period: pNum + offset,
          className: s.className,
          subject: s.subject || s.subjectName || ''
        });
      }
    });

    const rooms = Array.from(roomMap.values()).map(r => {
      const delta = r.wsOccupied - r.prodOccupied;
      const taken = [];
      const freed = [];

      for (const [periodKey, slot] of r.wsSlots.entries()) {
        if (!r.prodSlots.has(periodKey)) {
          taken.push(slot);
        }
      }

      for (const [periodKey, slot] of r.prodSlots.entries()) {
        if (!r.wsSlots.has(periodKey)) {
          freed.push(slot);
        }
      }

      return {
        room: r.room,
        prodOccupied: r.prodOccupied,
        wsOccupied: r.wsOccupied,
        delta,
        taken,
        freed
      };
    }).sort((a, b) => a.room.localeCompare(b.room));

    // ── Free Slots (Rooms & Teachers) ──
    const freeRooms = rooms.map(r => ({
      room: r.room,
      nowFree: r.freed.map(f => ({ day: f.day, period: f.period })),
      nowTaken: r.taken.map(t => ({ day: t.day, period: t.period }))
    })).filter(r => r.nowFree.length > 0 || r.nowTaken.length > 0);

    const freeTeachers = Array.from(teacherMap.values()).map(t => {
      const nowFree = [];
      const nowTaken = [];

      for (const [periodKey, list] of t.prodPeriods.entries()) {
        if (!t.wsPeriods.has(periodKey)) {
          const parts = periodKey.split('_');
          nowFree.push({ day: parts[0], period: parseInt(parts[1], 10) || 1 });
        }
      }

      for (const [periodKey, list] of t.wsPeriods.entries()) {
        if (!t.prodPeriods.has(periodKey)) {
          const parts = periodKey.split('_');
          nowTaken.push({ day: parts[0], period: parseInt(parts[1], 10) || 1 });
        }
      }

      return {
        name: t.name,
        teacherId: t.teacherId,
        nowFree,
        nowTaken
      };
    }).filter(t => t.nowFree.length > 0 || t.nowTaken.length > 0);

    res.json({
      ok: true,
      workspace: {
        id: ws._id,
        trackId: ws.trackId,
        name: ws.name
      },
      perClass,
      teachers,
      rooms,
      freeSlots: {
        rooms: freeRooms,
        teachers: freeTeachers
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compare timetable: ' + err.message });
  }
});

// ── GET /slot-source (Workspace-aware) ──
router.get('/slot-source', authMiddleware, requireWorkspaceAccess, async (req, res, next) => {
  const wsId = req.query.workspaceId || req.body?.workspaceId;
  const env = sanitizeToString(req.query.env || 'production').toLowerCase();

  if (!wsId && env !== 'development') {
    return next();
  }

  try {
    const deptId = req.query.deptId ? sanitizeToObjectId(req.query.deptId) : (req.workspace?.deptId || null);
    const classId = req.query.classId ? sanitizeToObjectId(req.query.classId) : null;
    const targetWsId = req.workspace?._id || wsId;

    if (!targetWsId) {
      return next();
    }

    const effective = await getEffective({
      env: 'development',
      workspaceId: req.workspace?.trackId || targetWsId,
      deptId,
      classIds: classId ? [classId] : undefined
    });

    const data = (effective || []).map(entry => ({
      classId: entry.classId,
      className: entry.className,
      deptId: entry.deptId,
      deptName: entry.deptName,
      slots: entry.slots,
      _source: entry._source === 'workspace' ? 'development' : (entry._source || 'production'),
      headTrackId: entry.headTrackId,
      headSeq: entry.headSeq,
      revision: entry.revision,
      isStale: entry.isStale,
      workspaceId: entry.workspaceId
    }));

    res.json({
      ok: true,
      env: 'development',
      workspaceId: req.workspace?.trackId || targetWsId,
      count: data.length,
      data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /section/:classId (Workspace-aware) ──
router.get('/section/:classId', authMiddleware, requireWorkspaceAccess, async (req, res, next) => {
  const wsId = req.query.workspaceId;
  if (!wsId) return next();

  try {
    const classId = sanitizeToObjectId(req.params.classId);
    if (!classId) return res.status(400).json({ error: 'Invalid classId' });
    const targetWsId = req.workspace?._id || wsId;

    const effective = await getEffective({
      env: 'development',
      workspaceId: req.workspace?.trackId || targetWsId,
      classIds: [classId]
    });

    const entry = (effective || []).find(e => String(e.classId) === String(classId));
    if (!entry) {
      return res.status(404).json({ error: 'Class timetable not found in workspace' });
    }

    res.json({
      ok: true,
      classId: entry.classId,
      className: entry.className,
      deptId: entry.deptId,
      deptName: entry.deptName,
      slots: entry.slots,
      _source: entry._source === 'workspace' ? 'development' : (entry._source || 'production'),
      headTrackId: entry.headTrackId,
      headSeq: entry.headSeq,
      revision: entry.revision,
      isStale: entry.isStale,
      workspaceId: entry.workspaceId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /faculty-schedule (Canonical getEffective-powered, F17) ──
router.get('/faculty-schedule', authMiddleware, requireWorkspaceAccess, async (req, res, next) => {
  const wsId = req.query.workspaceId;
  const env = sanitizeToString(req.query.env || (wsId ? 'development' : 'production')).toLowerCase();

  try {
    const { teacherName } = req.query;
    if (!teacherName) return res.status(400).json({ error: 'teacherName is required' });

    const regex = new RegExp('^' + escapeRegex(teacherName) + '$', 'i');
    const deptId = req.query.deptId ? sanitizeToObjectId(req.query.deptId) : (req.workspace?.deptId || null);
    const targetWsId = req.workspace?._id || wsId;

    const effective = await getEffective({
      env,
      workspaceId: targetWsId ? (req.workspace?.trackId || targetWsId) : undefined,
      deptId
    });

    const facultySlots = [];
    for (const entry of (effective || [])) {
      const clsName = entry.className || 'General';
      const slots = entry.slots || {};
      Object.values(slots).forEach(slot => {
        if (slot && slot.teacher && regex.test(slot.teacher.trim())) {
          facultySlots.push({
            ...slot,
            section: clsName,
            classId: entry.classId,
            _source: entry._source === 'workspace' ? 'development' : (entry._source || env)
          });
        }
      });
    }

    let delta = null;
    if (env === 'development' && (req.query.delta === 'true' || req.query.vsProduction === 'true')) {
      const prodEffective = await getEffective({
        env: 'production',
        deptId
      });
      const prodSlots = [];
      for (const entry of (prodEffective || [])) {
        const clsName = entry.className || 'General';
        Object.values(entry.slots || {}).forEach(slot => {
          if (slot && slot.teacher && regex.test(slot.teacher.trim())) {
            prodSlots.push({ ...slot, section: clsName, classId: entry.classId });
          }
        });
      }
      delta = {
        prodSlotsCount: prodSlots.length,
        wsSlotsCount: facultySlots.length,
        diffCount: facultySlots.length - prodSlots.length
      };
    }

    res.json({
      ok: true,
      teacherName,
      env,
      workspaceId: env === 'development' ? (req.workspace?.trackId || targetWsId) : undefined,
      slots: facultySlots,
      ...(delta ? { delta } : {})
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /free-room-slots (Workspace-aware) ──
router.get('/free-room-slots', authMiddleware, requireWorkspaceAccess, async (req, res, next) => {
  const wsId = req.query.workspaceId;
  if (!wsId) return next();

  try {
    const { roomName } = req.query;
    const deptId = req.query.deptId ? sanitizeToObjectId(req.query.deptId) : (req.workspace?.deptId || null);
    const targetWsId = req.workspace?._id || wsId;

    const effective = await getEffective({
      env: 'development',
      workspaceId: req.workspace?.trackId || targetWsId,
      deptId
    });

    const occupiedMap = new Map();
    for (const entry of (effective || [])) {
      const clsName = entry.className || 'General';
      Object.values(entry.slots || {}).forEach(slot => {
        if (slot && slot.room) {
          const rKey = slot.room.trim().toLowerCase();
          const dur = Number(slot.span || slot.duration || 1);
          const pNum = typeof slot.period === 'number'
            ? slot.period
            : (parseInt(String(slot.period || '1').replace(/\D/g, ''), 10) || 1);
          for (let i = 0; i < dur; i++) {
            const pCode = 'P' + (pNum + i);
            const key = rKey + ':' + slot.day + ':' + pCode;
            occupiedMap.set(key, { ...slot, section: clsName, _source: entry.source === 'workspace' ? 'development' : 'production' });
          }
        }
      });
    }

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const periods = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'];

    if (roomName) {
      const rKey = roomName.trim().toLowerCase();
      const freeSlots = [];
      const occupiedSlots = [];

      days.forEach(day => {
        periods.forEach(p => {
          const key = rKey + ':' + day + ':' + p;
          const occ = occupiedMap.get(key);
          if (occ) {
            occupiedSlots.push({ day, period: p, ...occ });
          } else {
            freeSlots.push({ day, period: p, room: roomName });
          }
        });
      });

      return res.json({
        ok: true,
        roomName,
        env: 'development',
        workspaceId: wsId,
        freeSlots,
        occupiedSlots
      });
    }

    const allRooms = await M.Room.find({ status: { $ne: 'Inactive' } }).select('hallNo name category type capacity buildingName').lean();
    const roomSummary = allRooms.map(r => {
      const rKey = (r.hallNo || r.name).trim().toLowerCase();
      let occupiedCount = 0;
      days.forEach(day => {
        periods.forEach(p => {
          if (occupiedMap.has(rKey + ':' + day + ':' + p)) occupiedCount++;
        });
      });
      const totalAvailablePeriods = days.length * periods.length;
      const freeCount = totalAvailablePeriods - occupiedCount;
      return {
        room: r.hallNo || r.name,
        name: r.name,
        capacity: r.capacity,
        type: r.type,
        building: r.buildingName,
        occupiedPeriods: occupiedCount,
        freePeriods: freeCount,
        utilizationPct: Math.round((occupiedCount / totalAvailablePeriods) * 100)
      };
    });

    res.json({ ok: true, rooms: roomSummary, env: 'development', workspaceId: wsId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /dashboard-cockpit (Workspace-aware) ──
router.get('/dashboard-cockpit', authMiddleware, requireWorkspaceAccess, async (req, res, next) => {
  if (req.workspaceShare) {
    return res.status(403).json({ error: 'Manager access required for cockpit' });
  }
  const env = sanitizeToString(req.query.env || 'production').toLowerCase();
  const wsId = req.query.workspaceId;

  if (env !== 'development' && !wsId) {
    return next();
  }

  try {
    const ws = req.workspace || (wsId ? await M.TimetableWorkspace.findOne({
      $or: [
        ...(mongoose.isValidObjectId(wsId) ? [{ _id: wsId }] : []),
        { trackId: wsId }
      ]
    }).lean() : null);

    if (!ws) {
      return next();
    }

    const totalDeptClasses = await M.Class.countDocuments(ws.deptId ? { deptId: ws.deptId } : {});
    const classesDraftedCount = (ws.classes || []).length;
    const classesDraftedPct = Math.round((classesDraftedCount / Math.max(1, totalDeptClasses)) * 100);

    const staleCount = (ws.classes || []).filter(c => c.isStale).length;

    let addedCount = 0;
    let modifiedCount = 0;
    let removedCount = 0;
    const teacherLoadMap = new Map();

    const classIds = (ws.classes || []).map(c => c.classId);
    const prodEffective = await getEffective({ env: 'production', deptId: ws.deptId, classIds });
    const wsEffective = await getEffective({ env: 'development', workspaceId: ws._id, deptId: ws.deptId, classIds });

    const prodMap = new Map((prodEffective || []).map(e => [String(e.classId), e]));
    const wsMap = new Map((wsEffective || []).map(e => [String(e.classId), e]));

    for (const cid of classIds) {
      const prodG = slotsToGrid(prodMap.get(String(cid))?.slots || {});
      const wsG = slotsToGrid(wsMap.get(String(cid))?.slots || {});
      const diff = diffGrids(prodG, wsG);
      addedCount += diff.added.length;
      modifiedCount += diff.modified.length;
      removedCount += diff.removed.length;

      wsG.forEach(s => {
        if (!s || !s.teacher) return;
        const key = s.teacher.trim();
        const cur = teacherLoadMap.get(key) || { name: key, theory: 0, lab: 0, total: 0 };
        const span = Number(s.span || 1);
        if (s.isLab) cur.lab += span;
        else cur.theory += span;
        cur.total += span;
        teacherLoadMap.set(key, cur);
      });
    }

    const teacherLoadHeat = Array.from(teacherLoadMap.values()).sort((a, b) => b.total - a.total);

    res.json({
      ok: true,
      data: {
        env: 'development',
        workspace: {
          id: ws._id,
          trackId: ws.trackId,
          name: ws.name
        },
        kpis: {
          classesDraftedPct,
          classesDraftedCount,
          totalDeptClasses,
          staleCount,
          pendingVsProduction: {
            added: addedCount,
            modified: modifiedCount,
            removed: removedCount
          }
        },
        teacherLoadHeat,
        conflicts: [],
        disruptions: {
          disabledInWorkspace: true,
          message: 'Live disruptions are production-only',
          cancelledCount: 0,
          substitutedCount: 0,
          roomChangedCount: 0,
          uncoveredCount: 0,
          slotsAtRiskCount: 0,
          uncoveredSlots: []
        },
        liveGrid: {
          disabledInWorkspace: true,
          message: 'Live timetable grid is production-only',
          classes: []
        },
        absentCoverage: {
          disabledInWorkspace: true,
          message: 'Absent faculty coverage is production-only'
        },
        unmarkedAlerts: {
          disabledInWorkspace: true,
          message: 'Attendance submission alerts are production-only'
        },
        roomsMap: {
          disabledInWorkspace: true,
          message: 'Room live telemetry is production-only',
          freeNow: [],
          occupiedNow: [],
          maintenance: []
        },
        smartBoardErrors: {
          disabledInWorkspace: true,
          message: 'SmartBoard telemetry is production-only'
        },
        eventTicker: []
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load workspace dashboard cockpit: ' + err.message });
  }
});

// ── POST /check-conflicts (Workspace-aware with Conflict Engine v2) ──
router.post('/check-conflicts', authMiddleware, requireWorkspaceAccess, async (req, res, next) => {
  const wsId = req.body?.workspaceId || req.query.workspaceId;
  if (!wsId) return next();

  try {
    const { slots, classId } = req.body;
    const targetWsId = wsId || req.workspace?._id;

    const ws = req.workspace || await M.TimetableWorkspace.findOne({
      $or: [
        ...(mongoose.isValidObjectId(targetWsId) ? [{ _id: targetWsId }] : []),
        { trackId: targetWsId }
      ]
    }).lean();

    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    let targetGrids = null;
    if (classId && Array.isArray(slots)) {
      targetGrids = { [String(classId)]: slots };
    }

    const conflicts = await detectConflictsV2({
      workspaceId: ws._id,
      classIds: classId ? [classId] : [],
      targetGrids
    });

    res.json({
      ok: true,
      conflicts,
      valid: conflicts.length === 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /exports/:type (Workspace-aware) ──
router.get('/exports/:type', authMiddleware, requireWorkspaceAccess, async (req, res, next) => {
  if (req.workspaceShare) {
    return res.status(403).json({ error: 'Manager access required for exports' });
  }
  const wsId = req.query.workspaceId;
  if (!wsId) return next();

  try {
    const { type } = req.params;
    const { classId } = req.query;
    const ws = req.workspace || await M.TimetableWorkspace.findOne({
      $or: [
        ...(mongoose.isValidObjectId(wsId) ? [{ _id: wsId }] : []),
        { trackId: wsId }
      ]
    }).lean();

    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const effective = await getEffective({
      env: 'development',
      workspaceId: ws._id,
      deptId: ws.deptId,
      classIds: classId ? [sanitizeToObjectId(classId)] : undefined
    });

    let rows = [];
    if (type === 'workload') {
      const map = new Map();
      for (const entry of (effective || [])) {
        const grid = slotsToGrid(entry.slots || {});
        grid.forEach(slot => {
          if (!slot || !slot.teacher) return;
          const current = map.get(slot.teacher) || { teacher: slot.teacher, theory: 0, lab: 0, total: 0 };
          const span = Number(slot.span || 1);
          if (slot.isLab) current.lab += span;
          else current.theory += span;
          current.total += span;
          map.set(slot.teacher, current);
        });
      }
      rows = Array.from(map.values());
    } else if (type === 'rooms') {
      const map = new Map();
      for (const entry of (effective || [])) {
        const grid = slotsToGrid(entry.slots || {});
        grid.forEach(slot => {
          if (!slot || !slot.room) return;
          const current = map.get(slot.room) || { room: slot.room, count: 0, classes: new Set() };
          current.count += Number(slot.span || 1);
          if (entry.classId) current.classes.add(String(entry.classId));
          map.set(slot.room, current);
        });
      }
      rows = Array.from(map.values()).map(r => ({ ...r, classes: Array.from(r.classes) }));
    } else {
      for (const entry of (effective || [])) {
        const grid = slotsToGrid(entry.slots || {});
        grid.forEach(slot => {
          if (!slot) return;
          rows.push({
            class: entry.className || 'Class',
            classId: entry.classId,
            day: slot.day,
            period: slot.period,
            span: slot.span || 1,
            subject: slot.subject,
            teacher: slot.teacher,
            room: slot.room,
            isLab: slot.isLab || false,
            combinedWith: slot.combinedWith || [],
            source: entry.source === 'workspace' ? 'development' : 'production'
          });
        });
      }
    }

    res.json({
      ok: true,
      data: {
        type,
        env: 'development',
        watermark: 'WORKSPACE: ' + ws.name + ' (' + ws.trackId + ')',
        sourcesSummary: {
          totalClasses: (effective || []).length,
          developmentDrafts: (effective || []).filter(s => s._source === 'development').length,
          productionFallbacks: (effective || []).filter(s => s._source === 'production').length
        },
        generatedAt: new Date().toISOString(),
        count: rows.length,
        rows
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =========================================================================
// Phase 5: Multi-Role Sharing, Cryptographic Links, Comments & Lookups
// =========================================================================

// 1. GET /workspaces/by-code/:code (Public address resolution)
router.get('/workspaces/by-code/:code', authMiddleware, async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    if (!code || code.length !== 10) {
      return res.status(404).json({ error: 'Invalid share link code' });
    }

    let link = await M.WorkspaceLink.findOne({ code, enabled: true });
    if (!link) {
      const links = await M.WorkspaceLink.find({ enabled: true }).lean();
      for (const l of links) {
        if (!l.workspaceId) continue;
        const comp = generateLinkCode(l.workspaceId, l.epoch || 0);
        if (comp.toLowerCase() === code) {
          link = l;
          break;
        }
      }
    }

    if (!link) {
      return res.status(404).json({ error: 'Share link not found or disabled' });
    }

    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      return res.status(404).json({ error: 'Share link has expired' });
    }

    const ws = await M.TimetableWorkspace.findById(link.workspaceId).lean();
    if (!ws) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const caller = await resolveCallerContext(req);
    const isOwnerDept = caller.deptId && String(ws.deptId) === String(caller.deptId);
    if (isOwnerDept) {
      return res.json({
        ok: true,
        accessGranted: true,
        level: 'owner',
        workspace: { _id: ws._id, name: ws.name, trackId: ws.trackId },
        draftId: link.draftId || null
      });
    }

    // Two-Tier Authorization Engine (N13, C7)
    if (link.level === 'editor' || link.requireApproval === true) {
      const existingShare = await M.WorkspaceShare.findOne({
        workspaceId: ws._id,
        userId: req.user._id,
        status: 'active'
      }).lean();

      if (existingShare && (existingShare.level === 'editor' || existingShare.level === 'edit')) {
        return res.json({
          ok: true,
          accessGranted: true,
          level: existingShare.level,
          workspace: { _id: ws._id, name: ws.name, trackId: ws.trackId },
          draftId: link.draftId || null
        });
      }

      let accessReq = await M.WorkspaceAccessRequest.findOne({
        workspaceId: ws._id,
        requesterId: req.user._id,
        status: 'pending'
      });

      if (!accessReq) {
        accessReq = await M.WorkspaceAccessRequest.create({
          workspaceId: ws._id,
          draftId: link.draftId || null,
          requesterId: req.user._id,
          requesterName: req.user.name || 'Staff Member',
          requestedLevel: 'editor',
          via: 'link',
          status: 'pending'
        });

        if (ws.ownerId && M.Notification) {
          await M.Notification.create({
            type: 'timetable-access-request',
            priority: 'High',
            from: req.user.name || 'Staff Member',
            toTeacherId: ws.ownerId,
            message: `${req.user.name || 'Staff Member'} requested Editor access to workspace "${ws.name}" via share link.`,
            status: 'Delivered',
            dedupeKey: `access-req:${ws._id}:${req.user._id}`
          }).catch(() => {});
        }
      }

      return res.json({
        ok: true,
        accessGranted: false,
        status: 'pending',
        requestId: accessReq._id,
        message: 'Editor access request submitted for owner approval',
        workspace: { _id: ws._id, name: ws.name, trackId: ws.trackId }
      });
    }

    // Viewer or Commenter link: grants immediate access
    let share = await M.WorkspaceShare.findOne({
      workspaceId: ws._id,
      userId: req.user._id,
      scope: link.scope,
      draftId: link.draftId || null
    });

    if (!share) {
      share = await M.WorkspaceShare.create({
        workspaceId: ws._id,
        scope: link.scope,
        draftId: link.draftId || null,
        userId: req.user._id,
        userName: req.user.name || '',
        userDeptId: req.user.deptId || null,
        level: link.level,
        editorMode: 'full',
        source: 'link',
        status: 'active'
      });
    } else if (share.status !== 'active') {
      share.status = 'active';
      share.level = link.level;
      await share.save();
    }

    return res.json({
      ok: true,
      accessGranted: true,
      level: link.level,
      workspace: { _id: ws._id, name: ws.name, trackId: ws.trackId },
      draftId: link.draftId || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Link Management: GET, PUT, POST reset
router.get('/workspaces/:id/link', authMiddleware, requireWorkspaceAccess, async (req, res) => {
  try {
    const ws = req.workspace;
    let link = await M.WorkspaceLink.findOne({ workspaceId: ws._id, scope: 'workspace' });
    if (!link) {
      const code = generateLinkCode(ws.trackId, 0);
      link = await M.WorkspaceLink.create({
        workspaceId: ws._id,
        scope: 'workspace',
        level: 'viewer',
        enabled: false,
        epoch: 0,
        code,
        createdBy: req.user._id
      });
    } else if (!link.code) {
      link.code = generateLinkCode(ws.trackId, link.epoch || 0);
      await link.save();
    }

    res.json({
      ok: true,
      link: {
        enabled: link.enabled,
        level: link.level,
        epoch: link.epoch,
        code: link.code,
        requireApproval: link.requireApproval,
        expiresAt: link.expiresAt,
        url: `/timetable/by-code/${link.code}`
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/workspaces/:id/link', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const { enabled, level = 'viewer', expiresAt = null } = req.body;
    let link = await M.WorkspaceLink.findOne({ workspaceId: ws._id, scope: 'workspace' });
    if (!link) {
      link = new M.WorkspaceLink({
        workspaceId: ws._id,
        scope: 'workspace',
        epoch: 0,
        createdBy: req.user._id
      });
    }

    if (typeof enabled === 'boolean') link.enabled = enabled;
    if (['viewer', 'commenter', 'editor'].includes(level)) link.level = level;
    // Invariant: Editor level ALWAYS enforces requireApproval = true
    link.requireApproval = (link.level === 'editor');
    if (expiresAt) link.expiresAt = new Date(expiresAt);
    link.code = generateLinkCode(ws.trackId, link.epoch || 0);
    await link.save();

    res.json({ ok: true, link, code: link.code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces/:id/link/reset', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    let link = await M.WorkspaceLink.findOne({ workspaceId: ws._id, scope: 'workspace' });
    if (!link) {
      link = new M.WorkspaceLink({
        workspaceId: ws._id,
        scope: 'workspace',
        epoch: 0,
        createdBy: req.user._id
      });
    }

    link.epoch = (link.epoch || 0) + 1;
    link.code = generateLinkCode(ws.trackId, link.epoch);
    await link.save();

    await logAction({
      userId: req.user._id,
      module: 'timetable',
      subType: 'share-link-reset',
      status: 'success',
      description: `Reset share link epoch to ${link.epoch} for workspace ${ws.trackId}`,
      metadata: { workspaceId: ws._id, epoch: link.epoch, code: link.code }
    });

    res.json({
      ok: true,
      link,
      code: link.code,
      message: 'Link reset successfully. Old links are now invalid.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Access Requests: GET, POST decide
router.get('/workspaces/:id/access-requests', authMiddleware, requireWorkspaceAccess, async (req, res) => {
  try {
    const requests = await M.WorkspaceAccessRequest.find({ workspaceId: req.params.id }).sort({ createdAt: -1 }).lean();
    res.json({ ok: true, requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces/:id/access-requests/:reqId/decide', authMiddleware, denySudoAndPrincipal, requireManager, async (req, res) => {
  try {
    const accessReq = await M.WorkspaceAccessRequest.findOne({
      _id: req.params.reqId,
      workspaceId: req.params.id
    });
    if (!accessReq) return res.status(404).json({ error: 'Access request not found' });

    const { decision, level, editorMode, note } = req.body;
    if (!['approve', 'decline'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be approve or decline' });
    }

    accessReq.status = decision === 'approve' ? 'approved' : 'declined';
    accessReq.decidedBy = req.user._id;
    accessReq.decidedAt = new Date();
    if (note) accessReq.note = note;
    await accessReq.save();

    let share = null;
    if (decision === 'approve') {
      share = await M.WorkspaceShare.findOne({
        workspaceId: accessReq.workspaceId,
        userId: accessReq.requesterId
      });
      if (!share) {
        share = await M.WorkspaceShare.create({
          workspaceId: accessReq.workspaceId,
          draftId: accessReq.draftId,
          userId: accessReq.requesterId,
          userName: accessReq.requesterName,
          level: level || accessReq.requestedLevel || 'editor',
          editorMode: editorMode || 'full',
          source: 'request',
          status: 'active',
          sharedBy: { id: req.user._id, name: req.user.name || '' }
        });
      } else {
        share.status = 'active';
        share.level = level || accessReq.requestedLevel || 'editor';
        if (editorMode) share.editorMode = editorMode;
        await share.save();
      }
    }

    res.json({ ok: true, request: accessReq, share });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Threaded Comments: GET, POST, PATCH resolve
router.get('/workspaces/:id/comments', authMiddleware, requireWorkspaceAccess, async (req, res) => {
  try {
    const { classId, slotKey, draftId, status } = req.query;
    const filter = { workspaceId: req.params.id };
    if (draftId) filter.draftId = draftId;
    if (classId) filter['anchor.classId'] = classId;
    if (slotKey) filter['anchor.slotKey'] = slotKey;
    if (status) filter.status = status;

    const comments = await M.WorkspaceComment.find(filter).sort({ createdAt: 1 }).lean();

    // C20 Surviving Deploys: Compare slotHash
    for (const comment of comments) {
      if (comment.anchor?.type === 'slot' && comment.anchor.slotKey && comment.anchor.classId) {
        let currentSlot = null;
        if (comment.draftId) {
          const draftDoc = await M.WorkspaceClassDraft.findOne({
            workspaceId: req.params.id,
            classId: comment.anchor.classId
          }).lean();
          currentSlot = (draftDoc?.grid || []).find(s => s.slotKey === comment.anchor.slotKey);
        }
        if (!currentSlot) {
          const sec = await M.SectionTimetable.findOne({ classId: comment.anchor.classId }).lean();
          currentSlot = (sec?.grid || []).find(s => s.slotKey === comment.anchor.slotKey);
        }
        if (currentSlot && comment.anchor.slotHash) {
          const currentHash = computeSlotHash(currentSlot);
          comment.slotChanged = (comment.anchor.slotHash !== currentHash);
        } else {
          comment.slotChanged = false;
        }
      }
    }

    res.json({ ok: true, comments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces/:id/comments', authMiddleware, requireWorkspaceAccess, async (req, res) => {
  try {
    if (req.workspaceShare && (req.workspaceShare.level === 'viewer' || req.workspaceShare.level === 'view')) {
      return res.status(403).json({ error: 'Viewers cannot post comments' });
    }

    const { anchor, body, threadId, parentId, mentions, draftId } = req.body;
    const rawBody = String(body || '').trim();
    if (!rawBody) return res.status(400).json({ error: 'Comment body is required' });

    const sanitizedBody = escapeHtml(rawBody);

    let slotHash = '';
    if (anchor?.type === 'slot' && anchor.classId && anchor.slotKey) {
      let currentSlot = null;
      if (draftId) {
        const draftDoc = await M.WorkspaceClassDraft.findOne({
          workspaceId: req.params.id,
          classId: anchor.classId
        }).lean();
        currentSlot = (draftDoc?.grid || []).find(s => s.slotKey === anchor.slotKey);
      }
      if (!currentSlot) {
        const sec = await M.SectionTimetable.findOne({ classId: anchor.classId }).lean();
        currentSlot = (sec?.grid || []).find(s => s.slotKey === anchor.slotKey);
      }
      if (currentSlot) {
        slotHash = computeSlotHash(currentSlot);
      }
    }

    const comment = await M.WorkspaceComment.create({
      workspaceId: req.params.id,
      draftId: draftId || null,
      anchor: {
        type: anchor?.type || 'workspace',
        classId: anchor?.classId || null,
        slotKey: anchor?.slotKey || '',
        slotHash: slotHash || '',
        headTrackId: anchor?.headTrackId || ''
      },
      threadId: threadId || null,
      parentId: parentId || null,
      body: sanitizedBody,
      authorId: req.user._id,
      authorName: req.user.name || 'Faculty',
      mentions: Array.isArray(mentions) ? mentions : [],
      status: 'open'
    });

    if (draftId) {
      broadcastToDraft(draftId, {
        type: 'COMMENT_ADDED',
        draftId: String(draftId),
        comment
      });
    }

    res.json({ ok: true, comment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/workspaces/:id/comments/:commentId/resolve', authMiddleware, requireWorkspaceAccess, async (req, res) => {
  try {
    if (req.workspaceShare && (req.workspaceShare.level === 'viewer' || req.workspaceShare.level === 'view')) {
      return res.status(403).json({ error: 'Viewers cannot resolve comments' });
    }

    const comment = await M.WorkspaceComment.findOne({
      _id: req.params.commentId,
      workspaceId: req.params.id
    });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    comment.status = 'resolved';
    comment.resolvedBy = req.user._id;
    comment.resolvedAt = new Date();
    await comment.save();

    if (comment.draftId) {
      broadcastToDraft(comment.draftId, {
        type: 'COMMENT_RESOLVED',
        draftId: String(comment.draftId),
        commentId: comment._id
      });
    }

    res.json({ ok: true, comment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Restricted Teacher Lookup (Section 5.4, Privacy Minimization)
router.get(['/workspaces/:workspaceId/drafts/:draftId/lookups/teachers', '/workspaces/:id/lookups/teachers'], authMiddleware, requireWorkspaceAccess, async (req, res) => {
  try {
    const { day, period, slotKey, deptId } = req.query;
    const query = { isActive: { $ne: false } };
    if (deptId && mongoose.isValidObjectId(deptId)) {
      query.deptId = deptId;
    }

    const teachers = await M.Teacher.find(query).select('_id name deptId').lean();

    // Determine busy teacher IDs for requested slot
    const busyTeacherIds = new Set();
    const targetSlotKey = slotKey || (day && period ? `${day}_${period}` : null);

    if (targetSlotKey) {
      const parts = targetSlotKey.split('_');
      const sDay = parts[0];
      const sPeriod = parseInt(parts[1], 10);

      // Check production timetables
      const prodSections = await M.SectionTimetable.find({
        'grid.day': sDay,
        'grid.period': sPeriod
      }).select('grid').lean();

      for (const sec of prodSections) {
        for (const slot of (sec.grid || [])) {
          if (slot.day === sDay && slot.period === sPeriod && (slot.teacherId || slot.teacher)) {
            if (slot.teacherId) busyTeacherIds.add(String(slot.teacherId));
          }
        }
      }
    }

    // PRIVACY INVARIANT: NEVER leak peer class names, section names, or titles!
    const results = teachers.map(t => {
      const isBusy = busyTeacherIds.has(String(t._id));
      return {
        teacherId: t._id,
        teacherName: t.name,
        deptId: t.deptId || null,
        available: !isBusy,
        status: isBusy ? 'BUSY_PRODUCTION' : 'AVAILABLE'
      };
    });

    res.json({ ok: true, teachers: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Phase 8: Section Attendance Overlay (Section 10.6, 4.2) ──
function isSessionOverdue(dateStr, endTime, todayDateStr, nowMinutes) {
  if (dateStr < todayDateStr) return true;
  if (dateStr > todayDateStr) return false;
  if (!endTime) return false;
  const [endH, endM] = String(endTime).split(':').map(Number);
  const endMinutes = (endH || 0) * 60 + (endM || 0);
  // Overdue if current time is more than 30 minutes after scheduled end
  return nowMinutes > (endMinutes + 30);
}

router.get('/section/:classId/attendance-overlay', authMiddleware, async (req, res) => {
  try {
    const classIdInput = req.params.classId;
    const classQueries = [{ classTrackId: classIdInput }];
    if (mongoose.isValidObjectId(classIdInput)) {
      classQueries.unshift({ _id: new mongoose.Types.ObjectId(classIdInput) });
    }
    const cls = await M.Class.findOne({ $or: classQueries }).lean();
    if (!cls) {
      return res.status(404).json({ error: 'Class not found' });
    }
    const targetClassId = String(cls._id);

    const todayDateStr = await todayInInstitutionTz();
    let fromStr = sanitizeToString(req.query.from);
    let toStr = sanitizeToString(req.query.to);

    // Default to current week (Monday to Saturday) if omitted
    if (!fromStr || !toStr || !/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
      const d = new Date(todayDateStr + 'T00:00:00.000Z');
      const day = d.getUTCDay(); // 0 is Sun
      const diffToMon = day === 0 ? -6 : 1 - day;
      const mon = new Date(d);
      mon.setUTCDate(d.getUTCDate() + diffToMon);
      const sat = new Date(mon);
      sat.setUTCDate(mon.getUTCDate() + 5);

      fromStr = mon.toISOString().slice(0, 10);
      toStr = sat.toISOString().slice(0, 10);
    }

    const sessions = await M.ClassSession.find({
      classId: targetClassId,
      date: { $gte: fromStr, $lte: toStr }
    }).sort({ date: 1, periodNumber: 1 }).lean();

    // Current IST time in minutes
    const nowParts = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    const curH = Number(nowParts.find(p => p.type === 'hour')?.value || 0);
    const curM = Number(nowParts.find(p => p.type === 'minute')?.value || 0);
    const nowMinutes = curH * 60 + curM;

    const mappedSessions = (sessions || []).map(sess => {
      let state = 'pending';
      let percentage = 0;
      const isMarked = !!(sess.attendance && (sess.attendance.savedAt || (sess.attendance.total > 0 && sess.attendance.present !== undefined)));

      if (isMarked) {
        state = 'marked';
        const tot = Number(sess.attendance?.total || 0);
        const pres = Number(sess.attendance?.present || 0);
        percentage = tot > 0 ? Math.round((pres / tot) * 100) : 0;
      } else if (sess.status === 'cancelled') {
        state = 'cancelled';
      } else if (sess.status === 'holiday') {
        state = 'holiday';
      } else if (sess.source === 'substitution') {
        state = 'substituted';
      } else {
        const overdue = isSessionOverdue(sess.date, sess.end, todayDateStr, nowMinutes);
        state = overdue ? 'missed' : 'pending';
      }

      return {
        sessionId: sess._id,
        date: sess.date,
        periodNumber: sess.periodNumber,
        span: sess.span || 1,
        slotKey: sess.slotKey || '',
        slotHash: sess.slotHash || '',
        subjectId: sess.subjectId,
        subjectName: sess.subjectName,
        room: sess.room,
        roomId: sess.roomId,
        slotType: sess.slotType,
        start: sess.start,
        end: sess.end,
        scheduledTeacher: sess.scheduledTeacher,
        actualTeacher: sess.actualTeacher,
        state,
        percentage,
        present: sess.attendance?.present || 0,
        absent: sess.attendance?.absent || 0,
        total: sess.attendance?.total || 0,
        markedAt: sess.attendance?.savedAt || null,
        markedBy: sess.attendance?.savedBy || null,
        substituteTeacher: sess.source === 'substitution' ? (sess.actualTeacher?.name || '') : null,
        timetableDrift: Boolean(sess.timetableDrift),
        timetableTrackId: sess.timetableTrackId || '',
        markAttendanceUrl: `/teacher.html?tab=att&sessionId=${sess._id}&classId=${targetClassId}&period=${sess.periodNumber}&date=${sess.date}`
      };
    });

    res.json({
      ok: true,
      data: {
        classId: targetClassId,
        className: cls.name,
        from: fromStr,
        to: toStr,
        sessions: mappedSessions
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Phase 8: Pedagogical Attendance Insights (Section 10.7, 4.2) ──
router.get('/analytics/pedagogical-insights', authMiddleware, async (req, res) => {
  try {
    const deptId = sanitizeToString(req.query.deptId || req.query.deptCode);
    const sessionQuery = {};
    if (deptId) {
      sessionQuery.deptCode = deptId.toUpperCase();
    }

    const sessions = await M.ClassSession.find(sessionQuery).lean();

    const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const DAY_MAP_LOCAL = { Sun: 'Sun', Mon: 'Mon', Tue: 'Tue', Wed: 'Wed', Thu: 'Thu', Fri: 'Fri', Sat: 'Sat' };

    // Initialize 6 days x 9 periods grid
    const cellStats = {};
    for (const d of DAY_KEYS) {
      cellStats[d] = {};
      for (let p = 1; p <= 9; p++) {
        cellStats[d][p] = {
          day: d,
          period: p,
          sessionsCount: 0,
          markedCount: 0,
          totalPresent: 0,
          totalStudents: 0,
          subjects: new Map(),
          delays: [],
          onTimeCount: 0
        };
      }
    }

    let globalDelays = [];
    let globalOnTimeCount = 0;
    let globalPunctualityTotal = 0;

    for (const sess of sessions) {
      const dObj = new Date(sess.date + 'T00:00:00.000Z');
      const dName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dObj.getUTCDay()];
      if (!cellStats[dName]) continue;

      const pNum = Number(sess.periodNumber);
      if (pNum < 1 || pNum > 9) continue;

      const cell = cellStats[dName][pNum];
      cell.sessionsCount++;

      const isMarked = !!(sess.attendance && (sess.attendance.savedAt || (sess.attendance.total > 0 && sess.attendance.present !== undefined)));
      if (isMarked) {
        cell.markedCount++;
        const pres = Number(sess.attendance.present || 0);
        const tot = Number(sess.attendance.total || 0);
        cell.totalPresent += pres;
        cell.totalStudents += tot;

        if (sess.subjectName) {
          cell.subjects.set(sess.subjectName, (cell.subjects.get(sess.subjectName) || 0) + 1);
        }

        if (sess.attendance.minutesAfterStart !== null && sess.attendance.minutesAfterStart !== undefined) {
          const delay = Number(sess.attendance.minutesAfterStart);
          cell.delays.push(delay);
          globalDelays.push(delay);
        }
        if (sess.attendance.onTime !== null && sess.attendance.onTime !== undefined) {
          globalPunctualityTotal++;
          if (sess.attendance.onTime) {
            cell.onTimeCount++;
            globalOnTimeCount++;
          }
        }
      }
    }

    const matrix = [];
    const recommendations = [];

    const FULL_DAYS = {
      Mon: 'Monday',
      Tue: 'Tuesday',
      Wed: 'Wednesday',
      Thu: 'Thursday',
      Fri: 'Friday',
      Sat: 'Saturday'
    };

    for (const d of DAY_KEYS) {
      for (let p = 1; p <= 9; p++) {
        const cell = cellStats[d][p];
        const avgAttendance = cell.totalStudents > 0
          ? Math.round((cell.totalPresent / cell.totalStudents) * 100)
          : (cell.markedCount > 0 ? 0 : null);

        let level = 'none';
        if (avgAttendance !== null) {
          if (avgAttendance >= 90) level = 'high';
          else if (avgAttendance >= 75) level = 'medium';
          else level = 'low';
        }

        matrix.push({
          day: d,
          dayFull: FULL_DAYS[d],
          period: p,
          avgAttendance,
          totalSessions: cell.sessionsCount,
          markedSessions: cell.markedCount,
          totalPresent: cell.totalPresent,
          totalStudents: cell.totalStudents,
          level
        });

        // Recommendation trigger: marked >= 1 and avg < 70%
        if (cell.markedCount >= 1 && avgAttendance !== null && avgAttendance < 70) {
          let topSubject = 'Lecture';
          let maxCount = 0;
          for (const [sub, count] of cell.subjects.entries()) {
            if (count > maxCount) {
              maxCount = count;
              topSubject = sub;
            }
          }
          recommendations.push({
            day: d,
            dayFull: FULL_DAYS[d],
            period: p,
            avgAttendance,
            subject: topSubject,
            suggestion: `${FULL_DAYS[d]} Period ${p} (${topSubject}) averages ${avgAttendance}% attendance. Consider swapping with an earlier morning slot.`
          });
        }
      }
    }

    // Punctuality statistics
    const avgDelayMinutes = globalDelays.length > 0
      ? Math.round((globalDelays.reduce((a, b) => a + b, 0) / globalDelays.length) * 10) / 10
      : 0;
    const onTimeRate = globalPunctualityTotal > 0
      ? Math.round((globalOnTimeCount / globalPunctualityTotal) * 100)
      : 100;

    res.json({
      ok: true,
      data: {
        matrix,
        recommendations,
        punctuality: {
          avgDelayMinutes,
          onTimeRate,
          samplesCount: globalPunctualityTotal
        }
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.requireWorkspaceAccess = requireWorkspaceAccess;
router.canAccessDev = canAccessDev;
module.exports = router;
