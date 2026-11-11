'use strict';
const fs = require('fs');

let routes = fs.readFileSync('routes/timetableWorkspace.routes.js', 'utf8').replace(/\r\n/g, '\n');

// 1. Add draftOps import if not present
if (!routes.includes("require('../services/draftOps')")) {
  routes = routes.replace(
    "const { resolveHodTeacher } = require('../utils/timetableResolver');",
    `const { resolveHodTeacher } = require('../utils/timetableResolver');
const {
  applyDraftOps,
  getDraftSnapshot,
  getDraftChanges,
  restoreDraftVersion,
  undoDraftOp
} = require('../services/draftOps');`
  );
}

// 2. Add Phase 3 Endpoints if not present
if (!routes.includes("router.post(['/workspaces/:workspaceId/drafts/:draftId/ops'")) {
  const phase3Endpoints = `
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
    workspaceId: ws ? ws._id : (wsId ? sanitizeToObjectId(wsId) : null),
    draftId: draftId ? sanitizeToObjectId(draftId) : (ws ? ws._id : (wsId ? sanitizeToObjectId(wsId) : null)),
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

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get(['/workspaces/:workspaceId/drafts/:draftId/snapshot', '/workspaces/:id/snapshot'], authMiddleware, async (req, res) => {
  try {
    const draftRef = await resolveDraftRef(req);
    const snapshot = await getDraftSnapshot(draftRef.draftId, draftRef.workspaceId);

    const etag = \`"snap-\${draftRef.draftId}-\${snapshot.seq}"\`;
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
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
`;

  routes = routes.replace(
    "// ── Checkpoints Endpoints (Dev History) ──",
    phase3Endpoints + "\n// ── Checkpoints Endpoints (Dev History) ──"
  );
}

fs.writeFileSync('routes/timetableWorkspace.routes.js', routes, 'utf8');
console.log('[OK] routes/timetableWorkspace.routes.js updated with Phase 3 operations & versions routes!');
