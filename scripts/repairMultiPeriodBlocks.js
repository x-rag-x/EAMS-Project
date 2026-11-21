/**
 * scripts/repairMultiPeriodBlocks.js
 *
 * One-time repair of doubles, 3-period labs and combined sessions that older save paths stored
 * badly (overflowing spans, unflagged continuation cells, ghost periods left by clear/move).
 * Rewrites, through utils/spanBlocks:
 *   - SectionTimetable.slots          -> root + flagged continuation cells, keyed day_period
 *   - SemesterTemplate.grid           -> one block per session
 *   - WorkspaceClassDraft.grid        -> one block per session
 * Anything it cannot repair safely (two different sessions fighting for a period) is only
 * REPORTED, never silently chosen for you beyond the engine's rule "the earlier block stays".
 *
 *   node scripts/repairMultiPeriodBlocks.js           # dry run, prints a report
 *   node scripts/repairMultiPeriodBlocks.js --apply   # writes changes
 * Take a database backup before --apply.
 */
'use strict';

const mongoose = require('mongoose');
const M = require('../models');
const cfg = require('../config');
const TTBlocks = require('../utils/spanBlocks');

const apply = process.argv.includes('--apply');
const stats = { docs: 0, changed: 0, repaired: 0, conflicts: 0 };
const conflicts = [];

function changed(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function report(label, issues) {
  issues.forEach(i => {
    if (i.severity === 'conflict') {
      stats.conflicts++;
      conflicts.push(`${label}: ${i.message}`);
    } else {
      stats.repaired++;
    }
  });
}

async function run() {
  console.log(`Multi-period repair — ${apply ? 'APPLY' : 'DRY RUN (pass --apply to write)'}`);
  await mongoose.connect(cfg.MONGO_URI);

  for (const doc of await M.SectionTimetable.find()) {
    stats.docs++;
    const { blocks, issues } = TTBlocks.toBlocks(doc.slots || {});
    const next = TTBlocks.toSlotsObj(blocks);
    report(`Production ${doc.className || doc.classId}`, issues);
    if (changed(Object.keys(doc.slots || {}).sort(), Object.keys(next).sort()) || issues.length) {
      stats.changed++;
      if (apply) { doc.slots = next; doc.markModified('slots'); await doc.save(); }
    }
  }

  for (const [Model, label] of [[M.SemesterTemplate, 'Template'], [M.WorkspaceClassDraft, 'Draft']]) {
    if (!Model) continue;
    for (const doc of await Model.find()) {
      stats.docs++;
      const { blocks, issues } = TTBlocks.toBlocks(doc.grid || []);
      report(`${label} ${doc.className || doc.classId}`, issues);
      if (issues.length || (doc.grid || []).length !== blocks.length) {
        stats.changed++;
        if (apply) { doc.grid = blocks; doc.markModified('grid'); await doc.save(); }
      }
    }
  }

  console.log(`\nDocuments checked: ${stats.docs}`);
  console.log(`Documents needing repair: ${stats.changed}`);
  console.log(`Safe repairs (folded/extended/orphans dropped): ${stats.repaired}`);
  console.log(`Needs a person to look at: ${stats.conflicts}`);
  conflicts.slice(0, 200).forEach(c => console.log('  - ' + c));
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
