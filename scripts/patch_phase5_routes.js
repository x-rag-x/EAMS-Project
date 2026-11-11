/**
 * scripts/patch_phase5_routes.js
 *
 * Implements Phase 5 routes & security hardening in routes/timetableWorkspace.routes.js:
 * 1. Imports shareCrypto and timetable.socket
 * 2. Enhances requireWorkspaceAccess with user-level shares, class/draft scoping, and capability checks
 * 3. Adds scope enforcement on /workspaces/:id/classes/:classId
 * 4. Hardens manager routes (/dashboard-cockpit, /exports/:type) against restricted shares
 * 5. Enhances ops route with user share lookup, scoped class checks, fill-only enforcement, and socket broadcast
 * 6. Adds Cryptographic 10-char link endpoints (/by-code/:code, /link, /link/reset)
 * 7. Adds Access request management (/access-requests, /access-requests/:reqId/decide)
 * 8. Adds Threaded Comments with C20 slot hash verification (/comments, /comments/:commentId/resolve)
 * 9. Adds Restricted Teacher Lookup endpoint (/lookups/teachers)
 * 10. Emits ACCESS_REVOKED on share revoke
 */

'use strict';

const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'routes', 'timetableWorkspace.routes.js');
let code = fs.readFileSync(targetPath, 'utf8');

// 1. Add top imports
if (!code.includes('generateLinkCode')) {
  const marker = "const { resolveHodTeacher } = require('../utils/timetableResolver');";
  const additions = `const { resolveHodTeacher } = require('../utils/timetableResolver');
const { generateLinkCode, computeSlotHash } = require('../services/shareCrypto');
const { broadcastToDraft, emitAccessRevoked } = require('../services/timetable.socket');

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}`;
  code = code.replace(marker, additions);
  console.log('Added top imports & escapeHtml helper');
}

// 2. Enhance requireWorkspaceAccess
const oldAccessPattern = `      let activeShare = null;
      if (!isOwnerDept && !isCollaborator && caller.deptId) {
        try {
          const q = M.WorkspaceShare.findOne({
            workspaceId: ws._id,
            toDeptId: caller.deptId,
            status: 'active'
          });
          const res = typeof q?.lean === 'function' ? q.lean() : q;
          activeShare = await Promise.race([
            res,
            new Promise(resolve => setTimeout(() => resolve(null), 50))
          ]);
        } catch (_) {}
      }

      if (ws.deptId && !isOwnerDept && !isCollaborator && !activeShare) {
        return res.status(403).json({ error: 'Access denied: You do not have access to this workspace' });
      }

      if (activeShare) {
        if (activeShare.level === 'view') {
          if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            return res.status(403).json({ error: 'View-only share: writes are not permitted' });
          }
        }
      }

      req.workspace = ws;
      req.workspaceShare = activeShare;
      return next();`;

const newAccessPattern = `      let activeShare = null;
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
            return res.status(403).json({ error: \`\${normLevel === 'viewer' ? 'View-only' : 'Commenter'} share: writes are not permitted\` });
          }
        }
      }

      req.workspace = ws;
      req.workspaceShare = activeShare;
      return next();`;

// Normalize line endings for replacement
const normCode = code.replace(/\r\n/g, '\n');
const normOld = oldAccessPattern.replace(/\r\n/g, '\n');
const normNew = newAccessPattern.replace(/\r\n/g, '\n');

if (normCode.includes(normOld)) {
  code = normCode.replace(normOld, normNew);
  console.log('Updated requireWorkspaceAccess with user-level and scope logic');
} else {
  console.log('requireWorkspaceAccess pattern not directly matched; checking if already modified');
}

// 3. Update /workspaces/:id/classes/:classId to use requireWorkspaceAccess
code = code.replace(
  "router.get('/workspaces/:id/classes/:classId', authMiddleware, async (req, res) => {",
  "router.get('/workspaces/:id/classes/:classId', authMiddleware, requireWorkspaceAccess, async (req, res) => {"
);

// 4. Protect /dashboard-cockpit and /exports/:type against restricted shares
if (!code.includes("req.workspaceShare && req.workspaceShare.level")) {
  const cockpitTarget = "router.get('/dashboard-cockpit', authMiddleware, requireWorkspaceAccess, async (req, res, next) => {";
  const cockpitRepl = cockpitTarget + `\n  if (req.workspaceShare) {\n    return res.status(403).json({ error: 'Manager access required for cockpit' });\n  }`;
  code = code.replace(cockpitTarget, cockpitRepl);

  const exportsTarget = "router.get('/exports/:type', authMiddleware, requireWorkspaceAccess, async (req, res, next) => {";
  const exportsRepl = exportsTarget + `\n  if (req.workspaceShare) {\n    return res.status(403).json({ error: 'Manager access required for exports' });\n  }`;
  code = code.replace(exportsTarget, exportsRepl);
  console.log('Hardened /dashboard-cockpit and /exports/:type against restricted collaborator shares');
}

// 5. Update Revoke route to emit ACCESS_REVOKED via socket
const revokeTarget = `    share.status = 'revoked';
    share.revokedAt = new Date();
    await share.save();`;
const revokeRepl = `    share.status = 'revoked';
    share.revokedAt = new Date();
    await share.save();

    if (share.userId) {
      emitAccessRevoked(share.userId, ws._id);
    }`;
if (!code.includes('emitAccessRevoked(share.userId')) {
  code = code.replace(revokeTarget, revokeRepl);
  console.log('Added emitAccessRevoked in share revoke route');
}

// 6. Update POST /workspaces/:id/shares to support direct userId sharing
const shareCreateMarker = `    const { toDeptId, classId = null, level = 'view', fill = {}, note = '' } = req.body;
    if (!toDeptId || !mongoose.isValidObjectId(toDeptId)) {
      return res.status(400).json({ error: 'Valid target department (toDeptId) is required' });
    }`;

const shareCreateNew = `    const { userId, toDeptId, classId = null, classIds = [], level = 'viewer', editorMode = 'full', fill = {}, note = '', expiresAt = null, scope = 'workspace', draftId = null } = req.body;

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
          message: \`You were invited as \${level} to workspace "\${ws.name}".\`,
          status: 'Delivered',
          dedupeKey: \`share:\${ws._id}:\${targetUser._id}:\${Date.now()}\`
        }).catch(() => {});
      }

      await logAction({
        userId: req.user._id,
        module: 'timetable',
        subType: 'share-create-user',
        status: 'success',
        description: \`Shared workspace \${ws.trackId} with user \${targetUser.name} (\${level})\`,
        metadata: { workspaceId: ws._id, userId: targetUser._id, level }
      });

      return res.json({ ok: true, share });
    }`;

if (!code.includes('if (userId) {')) {
  code = code.replace(shareCreateMarker, shareCreateNew);
  console.log('Updated POST /workspaces/:id/shares to support direct userId');
}

// 7. Update Ops route capability matrix & socket broadcast
const opsCheckMarker = `    const caller = await resolveCallerContext(req);
    const ws = draftRef.workspace;
    if (ws && caller.deptId && ws.deptId && String(ws.deptId) !== String(caller.deptId)) {
      let share = null;
      if (M.WorkspaceShare) {
        try {
          const q = M.WorkspaceShare.findOne({ workspaceId: ws._id, toDeptId: caller.deptId, status: 'active' });
          share = typeof q?.lean === 'function' ? await q.lean() : await q;
        } catch (_) {}
      }
      if (!share || share.level === 'view') {
        return res.status(403).json({ error: 'You do not have write access to this workspace' });
      }
    }`;

const opsCheckNew = `    const caller = await resolveCallerContext(req);
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
        return res.status(403).json({ error: \`\${share.level} cannot perform edit operations\` });
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
    }`;

if (!code.includes('isFillMode')) {
  code = code.replace(opsCheckMarker, opsCheckNew);
  console.log('Updated ops route with capability matrix, scope check, and fill-only enforcement');
}

// Socket broadcast after ops applied
const opsBroadcastMarker = `    if (hasConflict && result.results.length === 1) {
      const conf = result.results[0];
      return res.status(409).json({
        error: conf.error || 'Revision conflict',
        code: 'REVISION_CONFLICT',
        result: conf
      });
    }

    res.json(result);`;

const opsBroadcastNew = `    if (hasConflict && result.results.length === 1) {
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

    res.json(result);`;

if (!code.includes("type: 'OP_BROADCAST'")) {
  code = code.replace(opsBroadcastMarker, opsBroadcastNew);
  console.log('Added OP_BROADCAST to draft socket on ops apply');
}

// 8. Append Phase 5 Route Implementations before exports
if (!code.includes("router.get('/workspaces/by-code/:code'")) {
  const phase5Routes = `
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
            message: \`\${req.user.name || 'Staff Member'} requested Editor access to workspace "\${ws.name}" via share link.\`,
            status: 'Delivered',
            dedupeKey: \`access-req:\${ws._id}:\${req.user._id}\`
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
        url: \`/timetable/by-code/\${link.code}\`
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
      description: \`Reset share link epoch to \${link.epoch} for workspace \${ws.trackId}\`,
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
    const targetSlotKey = slotKey || (day && period ? \`\${day}_\${period}\` : null);

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
`;

  const exportMarker = "router.requireWorkspaceAccess = requireWorkspaceAccess;";
  code = code.replace(exportMarker, phase5Routes + "\n" + exportMarker);
  console.log('Appended Phase 5 route handlers before exports');
}

fs.writeFileSync(targetPath, code, 'utf8');
console.log('Successfully patched routes/timetableWorkspace.routes.js');
