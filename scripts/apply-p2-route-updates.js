'use strict';

const fs = require('fs');
const path = require('path');

const routesPath = path.resolve(__dirname, '../routes/timetableWorkspace.routes.js');
let content = fs.readFileSync(routesPath, 'utf8');

// 1. Update GET /workspaces filters
const targetGetWorkspaces = `    const workspaces = await M.TimetableWorkspace.find(query)
      .sort({ lastActivityAt: -1, updatedAt: -1 })
      .lean();`;

const replacementGetWorkspaces = `    if (req.query.kind && ['development', 'production'].includes(req.query.kind)) {
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
      .lean();`;

if (content.includes(targetGetWorkspaces)) {
  content = content.replace(targetGetWorkspaces, replacementGetWorkspaces);
  console.log('1. GET /workspaces filters updated (CRLF/LF).');
} else {
  const targetLF = targetGetWorkspaces.replace(/\r\n/g, '\n');
  const replLF = replacementGetWorkspaces.replace(/\r\n/g, '\n');
  if (content.includes(targetLF)) {
    content = content.replace(targetLF, replLF);
    console.log('1. GET /workspaces filters updated (LF).');
  } else {
    console.warn('1. Target for GET /workspaces not found!');
  }
}

// 2. Update POST /workspaces/:id/archive with commit status check
const targetArchive = `    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });`;

const replacementArchive = `    const ws = await M.TimetableWorkspace.findById(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    if (M.TimetableCommit && typeof M.TimetableCommit.findOne === 'function') {
      const pendingCommit = await M.TimetableCommit.findOne({
        workspaceId: ws._id,
        status: { $in: ['pending_approval', 'approved', 'scheduled'] }
      }).lean();
      if (pendingCommit) {
        return res.status(400).json({
          error: \`Cannot archive workspace: Commit \${pendingCommit.trackId} is in status "\${pendingCommit.status}". Resolve pending commits first.\`
        });
      }
    }`;

if (content.includes(targetArchive)) {
  content = content.replace(targetArchive, replacementArchive);
  console.log('2. POST /workspaces/:id/archive barrier added.');
} else {
  const targetLF = targetArchive.replace(/\r\n/g, '\n');
  const replLF = replacementArchive.replace(/\r\n/g, '\n');
  if (content.includes(targetLF)) {
    content = content.replace(targetLF, replLF);
    console.log('2. POST /workspaces/:id/archive barrier added (LF).');
  } else {
    console.warn('2. Target for POST /workspaces/:id/archive not found!');
  }
}

// 3. Add POST /workspaces/:id/lens endpoint
if (!content.includes('/workspaces/:id/lens')) {
  const lensEndpoint = `
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
`;

  content = content.replace("router.post('/workspaces/:id/archive',", lensEndpoint + "\r\nrouter.post('/workspaces/:id/archive',");
  if (!content.includes('/workspaces/:id/lens')) {
    content = content.replace("router.post('/workspaces/:id/archive',", lensEndpoint.replace(/\r\n/g, '\n') + "\nrouter.post('/workspaces/:id/archive',");
  }
  console.log('3. POST /workspaces/:id/lens added.');
}

fs.writeFileSync(routesPath, content, 'utf8');
console.log('timetableWorkspace.routes.js updated successfully.');
