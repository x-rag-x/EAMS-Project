/**
 * scripts/normalizeProductionSlots.js
 *
 * Normalizes existing SectionTimetable.slots and SemesterTemplate.grid in MongoDB:
 * - Converts slot keys from legacy format (e.g. 'Monday_P3') to canonical format (e.g. 'Monday_3')
 * - Ensures slot.period is an integer (1-9) rather than a string
 * - Ensures slot.span is a number (default 1)
 * - Ensures slot.isLab is boolean (inferred from type === 'Lab' if missing)
 *
 * Usage:
 *   node scripts/normalizeProductionSlots.js          # Dry run (inspection only)
 *   node scripts/normalizeProductionSlots.js --apply  # Execute updates against MongoDB
 */

const mongoose = require('mongoose');
const M = require('../models');
const cfg = require('../config');

function normalizeSlot(slot) {
  if (!slot) return null;
  let p = slot.period;
  if (typeof p === 'string') {
    p = parseInt(p.replace(/\D/g, ''), 10) || 1;
  } else if (typeof p !== 'number') {
    p = 1;
  }
  const isLab = Boolean(slot.isLab ?? (slot.type === 'Lab'));
  const span = Number(slot.span ?? slot.duration ?? 1) || 1;

  return {
    ...slot,
    day: slot.day,
    period: p,
    subject: slot.subject || '',
    teacher: slot.teacher || '',
    room: slot.room || '',
    isLab,
    span,
    state: slot.state || slot.comment || ''
  };
}

async function run() {
  const isApply = process.argv.includes('--apply');
  console.log('====================================================');
  console.log('  EAMS Timetable Slot Normalization Tool (Phase 0 / T2)');
  console.log(`  Mode: ${isApply ? '🚀 APPLY (Live DB Updates)' : '🔍 DRY RUN (Audit Only — pass --apply to write)'}`);
  console.log('====================================================\n');

  try {
    await mongoose.connect(cfg.MONGO_URI);
    console.log('✓ Connected to MongoDB.\n');

    // ── 1. SectionTimetable ──
    const sectionTimetables = await M.SectionTimetable.find();
    console.log(`Found ${sectionTimetables.length} SectionTimetable document(s).`);

    let sectionFixedCount = 0;
    for (const doc of sectionTimetables) {
      const rawSlots = doc.slots || {};
      let hasChanges = false;
      const newSlots = {};

      for (const [key, slot] of Object.entries(rawSlots)) {
        if (!slot) continue;
        const normalized = normalizeSlot(slot);
        const canonicalKey = `${normalized.day}_${normalized.period}`;

        if (key !== canonicalKey || slot.period !== normalized.period || slot.isLab !== normalized.isLab || slot.span !== normalized.span) {
          hasChanges = true;
        }
        newSlots[canonicalKey] = normalized;
      }

      if (hasChanges) {
        sectionFixedCount++;
        console.log(`  - SectionTimetable [${doc.className || doc.classId}]: normalized ${Object.keys(newSlots).length} slot(s).`);
        if (isApply) {
          doc.slots = newSlots;
          doc.markModified('slots');
          await doc.save();
        }
      }
    }

    console.log(`\nSectionTimetable Summary: ${sectionFixedCount} of ${sectionTimetables.length} document(s) ${isApply ? 'updated' : 'require normalization'}.\n`);

    // ── 2. SemesterTemplate ──
    const templates = await M.SemesterTemplate.find();
    console.log(`Found ${templates.length} SemesterTemplate document(s).`);

    let templateFixedCount = 0;
    for (const tpl of templates) {
      const rawGrid = tpl.grid || [];
      let hasChanges = false;
      const newGrid = [];

      for (const slot of rawGrid) {
        if (!slot) continue;
        const normalized = normalizeSlot(slot.toObject ? slot.toObject() : slot);
        if (slot.period !== normalized.period || slot.isLab !== normalized.isLab || slot.span !== normalized.span) {
          hasChanges = true;
        }
        newGrid.push(normalized);
      }

      if (hasChanges) {
        templateFixedCount++;
        console.log(`  - SemesterTemplate [${tpl.classId}] (status: ${tpl.status}, v${tpl.version}): normalized ${newGrid.length} slot(s).`);
        if (isApply) {
          tpl.grid = newGrid;
          tpl.markModified('grid');
          await tpl.save();
        }
      }
    }

    console.log(`\nSemesterTemplate Summary: ${templateFixedCount} of ${templates.length} document(s) ${isApply ? 'updated' : 'require normalization'}.\n`);

    console.log('====================================================');
    if (isApply) {
      console.log('🎉 Database normalization applied successfully!');
    } else {
      if (sectionFixedCount > 0 || templateFixedCount > 0) {
        console.log('👉 Run with --apply to commit these changes to the database:');
        console.log('   node scripts/normalizeProductionSlots.js --apply');
      } else {
        console.log('✨ All production slots and templates are already normalized!');
      }
    }
    console.log('====================================================\n');

    await mongoose.disconnect();
  } catch (err) {
    console.error('Fatal error during normalization:', err);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
  }
}

run();
