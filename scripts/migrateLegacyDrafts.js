/**
 * scripts/migrateLegacyDrafts.js (M3)
 *
 * Migrates legacy draft SemesterTemplates into per-department Workspaces:
 * - Creates "Legacy drafts – <Dept>" workspace per department holding legacy drafts
 * - Latest draft/pending/approved SemesterTemplate per class becomes a WorkspaceClassDraft
 * - In-flight TimetableVersion verification requests become pending_approval commits
 * - Dry-run by default: pass --apply to execute writes against MongoDB
 *
 * Usage:
 *   node scripts/migrateLegacyDrafts.js          # Dry-run audit
 *   node scripts/migrateLegacyDrafts.js --apply  # Apply migration to DB
 */

const mongoose = require('mongoose');
const M = require('../models');
const cfg = require('../config');
const { getNextRequestId } = require('../utils/requestIds');

function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';
}

async function run() {
  const isApply = process.argv.includes('--apply');
  const customUri = process.argv.find(a => a.startsWith('--uri='))?.slice(6);
  const mongoUri = customUri || cfg.MONGO_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/eams';

  console.log('====================================================');
  console.log('  EAMS Legacy Draft Migration (M3)');
  console.log(`  Mode: ${isApply ? '🚀 APPLY (Live DB Updates)' : '🔍 DRY RUN (Audit Only — pass --apply to write)'}`);
  console.log('====================================================\n');

  try {
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB.\n');

    // 1. Gather all non-published SemesterTemplates
    const draftTemplates = await M.SemesterTemplate.find({
      status: { $in: ['draft', 'pending', 'approved'] }
    }).sort({ updatedAt: -1 }).lean();

    console.log(`Found ${draftTemplates.length} legacy draft/pending/approved SemesterTemplate document(s).`);

    // Group latest template per classId
    const latestByClass = new Map();
    for (const tpl of draftTemplates) {
      const cId = String(tpl.classId);
      if (!latestByClass.has(cId)) {
        latestByClass.set(cId, tpl);
      }
    }

    console.log(`Identified ${latestByClass.size} unique class(es) with legacy drafts.\n`);

    // Group classes by department
    const classes = await M.Class.find({
      _id: { $in: Array.from(latestByClass.keys()) }
    }).lean();

    const classDeptMap = new Map();
    classes.forEach(c => classDeptMap.set(String(c._id), c));

    const depts = await M.Department.find().lean();
    const deptMap = new Map();
    depts.forEach(d => deptMap.set(String(d._id), d));

    const draftsByDept = new Map();
    for (const [cId, tpl] of latestByClass.entries()) {
      const cls = classDeptMap.get(cId);
      const dId = cls?.deptId ? String(cls.deptId) : 'unassigned';
      if (!draftsByDept.has(dId)) draftsByDept.set(dId, []);
      draftsByDept.get(dId).push({ tpl, cls });
    }

    let workspacesCreated = 0;
    let draftsMigrated = 0;
    let inFlightCommitsCreated = 0;

    for (const [deptIdStr, items] of draftsByDept.entries()) {
      const dept = deptMap.get(deptIdStr);
      const deptName = dept?.name || 'General';
      const wsName = `Legacy drafts – ${deptName}`;
      const slug = `legacy-drafts-${slugify(deptName)}`;

      console.log(`\nProcessing Department: [${deptName}] (${items.length} classes)...`);

      let ws = await M.TimetableWorkspace.findOne({ slug }).lean();
      if (!ws) {
        const trackId = isApply ? await getNextRequestId('WS') : `WS-2026-DRY${String(workspacesCreated + 1).padStart(3, '0')}`;
        console.log(`  + [NEW Workspace] "${wsName}" (${trackId})`);

        if (isApply) {
          const hodTeacher = dept?.hodId ? await M.Teacher.findOne({ $or: [{ userId: dept.hodId }, { _id: dept.hodId }] }).lean() : null;
          const ownerId = hodTeacher?._id || dept?._id;
          const ownerName = hodTeacher?.name || 'Department HoD';

          ws = await M.TimetableWorkspace.create({
            trackId,
            name: wsName,
            slug,
            deptId: dept?._id || new mongoose.Types.ObjectId(),
            deptName,
            ownerId,
            ownerName,
            status: 'open',
            classIds: items.map(i => i.tpl.classId),
            forkedFrom: { kind: 'production' },
            collaborators: [],
            lastActivityAt: new Date()
          });
        }
        workspacesCreated++;
      } else {
        console.log(`  = [Existing Workspace] "${ws.name}" (${ws.trackId})`);
      }

      for (const { tpl, cls } of items) {
        console.log(`    - Class Draft: ${cls?.name || tpl.className || tpl.classId} (${tpl.status}, ${(tpl.grid || []).length} slots)`);

        if (isApply && ws) {
          await M.WorkspaceClassDraft.findOneAndUpdate(
            { workspaceId: ws._id, classId: tpl.classId },
            {
              $set: {
                className: cls?.name || tpl.className || '',
                grid: tpl.grid || [],
                baseTrackId: null,
                baseSeq: 0,
                revision: 1,
                state: tpl.status === 'approved' ? 'approved' : 'editing',
                updatedAt: tpl.updatedAt || new Date()
              }
            },
            { upsert: true, returnDocument: 'after' }
          );
        }
        draftsMigrated++;
      }
    }

    // 2. Migrate in-flight verification requests into TimetableCommit
    const inFlightVersions = await M.TimetableVersion.find({
      status: 'pending'
    }).lean();

    console.log(`\nScanning ${inFlightVersions.length} in-flight verification request(s)...`);

    for (const ver of inFlightVersions) {
      const trackId = isApply ? await getNextRequestId('TT') : `TT-2026-DRY${String(inFlightCommitsCreated + 1).padStart(3, '0')}`;
      console.log(`  + [In-flight Commit] ${trackId} for version ${ver._id} (Class: ${ver.className || ver.classId})`);

      if (isApply) {
        const cls = await M.Class.findById(ver.classId).lean();
        const grid = ver.snapshot?.grid || (Array.isArray(ver.snapshot?.slots) ? ver.snapshot.slots : []);

        const commit = await M.TimetableCommit.create({
          trackId,
          seq: inFlightCommitsCreated + 1,
          type: 'workspace',
          classIds: [ver.classId],
          classNames: [ver.className || cls?.name || 'Class'],
          message: ver.reason || 'Migrated from in-flight verification request',
          status: 'pending_approval',
          author: {
            id: ver.requestedBy,
            name: ver.requestedByName || ''
          },
          createdAt: ver.createdAt || new Date()
        });

        await M.TimetableCommitClass.create({
          commitTrackId: commit.trackId,
          classId: ver.classId,
          className: ver.className || cls?.name || '',
          deptId: cls?.deptId || null,
          version: 1,
          grid,
          diff: { added: grid.length, modified: 0, removed: 0, unchanged: 0 }
        });
      }
      inFlightCommitsCreated++;
    }

    console.log('\n====================================================');
    console.log('  M3 MIGRATION SUMMARY');
    console.log('====================================================');
    console.log(`Workspaces created:           ${workspacesCreated}`);
    console.log(`Class drafts migrated:        ${draftsMigrated}`);
    console.log(`In-flight commits created:    ${inFlightCommitsCreated}`);
    console.log('====================================================\n');

    if (!isApply) {
      console.log('ℹ️  Run with --apply to write these changes to the database:');
      console.log('    node scripts/migrateLegacyDrafts.js --apply\n');
    }

  } catch (err) {
    console.error('Migration M3 error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
