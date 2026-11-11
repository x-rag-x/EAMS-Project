/**
 * scripts/migrations/m3-prime-legacy-drafts.js
 * Migration M3': Prime Legacy Drafts into TimetableWorkspace & WorkspaceClassDraft
 * Groups legacy draft templates by department and creates Development Workspaces.
 * Supports dry-run: node scripts/migrations/m3-prime-legacy-drafts.js --dry-run
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const cfg = require('../../config');
const M = require('../../models');
const { getNextRequestId } = require('../../utils/requestIds');

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function runMigration() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`[M3' Migration] Starting legacy drafts priming (dry-run: ${isDryRun})...`);

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(cfg.MONGO_URI, { dbName: cfg.DB_NAME });
  }

  // Find all active drafts in SemesterTemplate
  const drafts = await M.SemesterTemplate.find({ status: { $in: ['draft', 'pending_approval'] } }).lean();
  console.log(`Found ${drafts.length} legacy draft template(s) to migrate.`);

  if (!drafts.length) {
    console.log('[M3\' Migration]: No legacy drafts found. Nothing to migrate.');
    return;
  }

  // Group by department
  const deptDraftMap = new Map();
  for (const d of drafts) {
    const cls = await M.Class.findById(d.classId).lean();
    const deptId = cls?.deptId ? String(cls.deptId) : 'unassigned';
    const deptName = cls?.deptName || 'General';

    if (!deptDraftMap.has(deptId)) {
      deptDraftMap.set(deptId, { deptId: cls?.deptId || null, deptName, templates: [] });
    }
    deptDraftMap.get(deptId).templates.push({ template: d, cls });
  }

  let workspacesCreated = 0;
  let draftsMigrated = 0;

  for (const [deptIdStr, group] of deptDraftMap.entries()) {
    const name = `Legacy Drafts — ${group.deptName}`;
    const trackId = isDryRun ? 'TR-WS-LEGACY-MOCK' : await getNextRequestId('WS');
    const slug = slugify(name);
    const classIds = group.templates.map(t => t.template.classId);

    console.log(`  + Processing workspace "${name}" (${classIds.length} classes)...`);

    let ws = null;
    if (!isDryRun) {
      ws = await M.TimetableWorkspace.create({
        trackId,
        name,
        slug,
        kind: 'development',
        deptId: group.deptId,
        deptName: group.deptName,
        status: 'open',
        classIds,
        lastActivityAt: new Date(),
        description: 'Auto-migrated from legacy semester drafts'
      });
      workspacesCreated++;
    }

    for (const item of group.templates) {
      const tmpl = item.template;
      const cls = item.cls;
      const grid = tmpl.grid || [];

      if (!isDryRun && ws) {
        await M.WorkspaceClassDraft.findOneAndUpdate(
          { workspaceId: ws._id, classId: tmpl.classId },
          {
            workspaceId: ws._id,
            classId: tmpl.classId,
            className: cls?.name || tmpl.className || 'Class',
            grid,
            revision: 1,
            state: tmpl.status === 'pending_approval' ? 'submitted' : 'editing',
            updatedByName: tmpl.publishedBy || 'Legacy Draft'
          },
          { upsert: true }
        );
        draftsMigrated++;
      }
    }
  }

  console.log(`[M3' Migration Complete]: ${workspacesCreated} workspace(s) created, ${draftsMigrated} draft(s) migrated.`);
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[M3\' Migration Error]:', err);
      process.exit(1);
    });
}

module.exports = { runMigration };
