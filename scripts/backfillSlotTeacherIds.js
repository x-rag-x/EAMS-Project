/**
 * scripts/backfillSlotTeacherIds.js
 *
 * Backfill utility for Phase 6:
 * - Scans all SectionTimetable production slots and published SemesterTemplates
 * - Resolves slot.teacher names to Teacher records via exact normName matching
 * - Dry-run by default: audits and reports matched, ambiguous, and unmatched teacher names
 * - Pass --apply to write teacherTrackId and teacherId to the database and invalidate production cache
 *
 * Usage:
 *   node scripts/backfillSlotTeacherIds.js          # Dry run (audit only, no changes written)
 *   node scripts/backfillSlotTeacherIds.js --apply  # Execute updates against MongoDB
 */

const mongoose = require('mongoose');
const M = require('../models');
const cfg = require('../config');
const { normName, invalidateProductionCache } = require('../utils/teacherSchedule');

async function run() {
  const isApply = process.argv.includes('--apply');
  const allTemplates = process.argv.includes('--all-templates');
  const uriArg = process.argv.find(a => a.startsWith('--uri='));
  const customUri = uriArg ? uriArg.slice(6) : null;

  console.log('====================================================');
  console.log('  EAMS Slot Teacher ID Backfill Tool (Phase 6)');
  console.log(`  Mode: ${isApply ? '🚀 APPLY (Live DB Updates)' : '🔍 DRY RUN (Audit Only — pass --apply to write)'}`);
  console.log('====================================================\n');

  try {
    const mongoUri = customUri || cfg.MONGO_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/eams';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB.\n');

    // ── 1. Build Teacher Index ──
    const teachers = await M.Teacher.find().lean();
    console.log(`Loaded ${teachers.length} teacher record(s) from database.`);

    const nameMap = new Map(); // normName -> [TeacherDoc, ...]
    const trackIdMap = new Map(); // trackId -> TeacherDoc
    const idMap = new Map(); // _id string -> TeacherDoc

    teachers.forEach(t => {
      if (t.trackId) trackIdMap.set(t.trackId, t);
      if (t._id) idMap.set(String(t._id), t);

      const candidateNames = [
        t.fullName,
        t.name,
        `${t.firstName || ''} ${t.lastName || ''}`.trim(),
        t.username
      ].filter(Boolean);

      const seenNorms = new Set();
      candidateNames.forEach(raw => {
        const n = normName(raw);
        if (n && !seenNorms.has(n)) {
          seenNorms.add(n);
          if (!nameMap.has(n)) nameMap.set(n, []);
          const existing = nameMap.get(n);
          if (!existing.some(item => String(item._id) === String(t._id))) {
            existing.push(t);
          }
        }
      });
    });

    // ── 2. Build Subject Index (for optional subjectId resolution) ──
    const subjects = await M.Subject.find().lean();
    const subjectCodeMap = new Map();
    subjects.forEach(s => {
      if (s.code) subjectCodeMap.set(s.code.trim().toLowerCase(), s);
      if (s.shortName) subjectCodeMap.set(s.shortName.trim().toLowerCase(), s);
      if (s.name) subjectCodeMap.set(s.name.trim().toLowerCase(), s);
    });

    // Statistics
    let stats = {
      sectionDocsTotal: 0,
      sectionDocsModified: 0,
      templateDocsTotal: 0,
      templateDocsModified: 0,
      slotsTotal: 0,
      slotsAlreadyWithIds: 0,
      slotsMatched: 0,
      slotsAmbiguous: 0,
      slotsUnmatched: 0,
      slotsSkippedNoTeacher: 0
    };

    const ambiguousDetails = [];
    const unmatchedDetails = [];

    function resolveTeacherForSlot(teacherStr, slotContext) {
      if (!teacherStr || typeof teacherStr !== 'string' || !teacherStr.trim()) {
        return { status: 'skipped' };
      }
      const trimmed = teacherStr.trim();
      const n = normName(trimmed);
      if (!n) return { status: 'skipped' };

      const matches = nameMap.get(n) || [];
      if (matches.length === 1) {
        return { status: 'matched', teacher: matches[0] };
      } else if (matches.length > 1) {
        ambiguousDetails.push({
          rawName: trimmed,
          context: slotContext,
          candidates: matches.map(m => `${m.fullName || m.name} [${m.trackId || m._id}]`)
        });
        return { status: 'ambiguous', matches };
      } else {
        unmatchedDetails.push({
          rawName: trimmed,
          context: slotContext
        });
        return { status: 'unmatched' };
      }
    }

    // ── 3. Backfill SectionTimetable ──
    const sectionTimetables = await M.SectionTimetable.find();
    stats.sectionDocsTotal = sectionTimetables.length;
    console.log(`\nScanning ${sectionTimetables.length} SectionTimetable document(s)...`);

    for (const doc of sectionTimetables) {
      const rawSlots = doc.slots || {};
      let docModified = false;
      const secLabel = doc.className || String(doc.classId);

      for (const [key, slot] of Object.entries(rawSlots)) {
        if (!slot) continue;
        stats.slotsTotal++;

        // Check if teacher IDs already exist and are valid
        if (slot.teacherTrackId && slot.teacherId) {
          stats.slotsAlreadyWithIds++;
          continue;
        }

        const teacherName = slot.teacher || slot.teacherName || '';
        const res = resolveTeacherForSlot(teacherName, `Section [${secLabel}] slot ${key}`);

        if (res.status === 'matched') {
          stats.slotsMatched++;
          slot.teacherId = res.teacher._id;
          slot.teacherTrackId = res.teacher.trackId;
          docModified = true;
        } else if (res.status === 'ambiguous') {
          stats.slotsAmbiguous++;
        } else if (res.status === 'unmatched') {
          stats.slotsUnmatched++;
        } else {
          stats.slotsSkippedNoTeacher++;
        }

        // Subject backfill if missing
        if (!slot.subjectId && slot.subject) {
          const sMatch = subjectCodeMap.get(slot.subject.trim().toLowerCase());
          if (sMatch) {
            slot.subjectId = sMatch._id;
            docModified = true;
          }
        }
      }

      if (docModified) {
        stats.sectionDocsModified++;
        console.log(`  - SectionTimetable [${secLabel}]: updated slot IDs.`);
        if (isApply) {
          doc.markModified('slots');
          await doc.save();
        }
      }
    }

    // ── 4. Backfill SemesterTemplate ──
    const tplFilter = allTemplates ? {} : { status: 'published' };
    const templates = await M.SemesterTemplate.find(tplFilter);
    stats.templateDocsTotal = templates.length;
    console.log(`\nScanning ${templates.length} ${allTemplates ? '' : 'published '}SemesterTemplate document(s)...`);

    for (const tpl of templates) {
      const rawGrid = tpl.grid || [];
      let docModified = false;
      const tplLabel = `${tpl.academicYear || ''} Sem ${tpl.semester || ''} [${tpl.status}]`;

      for (const slot of rawGrid) {
        if (!slot) continue;
        stats.slotsTotal++;

        if (slot.teacherTrackId && slot.teacherId) {
          stats.slotsAlreadyWithIds++;
          continue;
        }

        const teacherName = slot.teacher || slot.teacherName || '';
        const res = resolveTeacherForSlot(teacherName, `Template [${tplLabel}] ${slot.day} P${slot.period}`);

        if (res.status === 'matched') {
          stats.slotsMatched++;
          slot.teacherId = res.teacher._id;
          slot.teacherTrackId = res.teacher.trackId;
          docModified = true;
        } else if (res.status === 'ambiguous') {
          stats.slotsAmbiguous++;
        } else if (res.status === 'unmatched') {
          stats.slotsUnmatched++;
        } else {
          stats.slotsSkippedNoTeacher++;
        }

        if (!slot.subjectId && slot.subject) {
          const sMatch = subjectCodeMap.get(slot.subject.trim().toLowerCase());
          if (sMatch) {
            slot.subjectId = sMatch._id;
            docModified = true;
          }
        }
      }

      if (docModified) {
        stats.templateDocsModified++;
        console.log(`  - SemesterTemplate [${tplLabel}]: updated slot IDs.`);
        if (isApply) {
          tpl.markModified('grid');
          await tpl.save();
        }
      }
    }

    // Invalidate production cache if changes applied
    if (isApply && (stats.sectionDocsModified > 0 || stats.templateDocsModified > 0)) {
      invalidateProductionCache();
      console.log('\n✓ Invalidate production timetable cache executed.');
    }

    // ── 5. Summary & Diagnostics ──
    console.log('\n====================================================');
    console.log('  BACKFILL SUMMARY & COVERAGE REPORT');
    console.log('====================================================');
    console.log(`Total slots inspected:       ${stats.slotsTotal}`);
    console.log(`Slots with IDs already:      ${stats.slotsAlreadyWithIds}`);
    console.log(`Slots newly matched:         ${stats.slotsMatched}`);
    console.log(`Slots without teacher name:  ${stats.slotsSkippedNoTeacher}`);
    console.log(`Slots ambiguous (unmatched): ${stats.slotsAmbiguous}`);
    console.log(`Slots unmatched (not found): ${stats.slotsUnmatched}`);
    console.log('----------------------------------------------------');
    console.log(`SectionTimetables modified:  ${stats.sectionDocsModified} / ${stats.sectionDocsTotal}`);
    console.log(`SemesterTemplates modified:  ${stats.templateDocsModified} / ${stats.templateDocsTotal}`);

    const teachingSlots = stats.slotsTotal - stats.slotsSkippedNoTeacher;
    const resolvedSlots = stats.slotsAlreadyWithIds + stats.slotsMatched;
    const coveragePct = teachingSlots > 0 ? ((resolvedSlots / teachingSlots) * 100).toFixed(1) : 100;
    console.log(`Overall ID Coverage:         ${coveragePct}% (${resolvedSlots} of ${teachingSlots} teaching slots)`);
    console.log('====================================================\n');

    if (ambiguousDetails.length > 0) {
      console.log('⚠️  AMBIGUOUS TEACHER NAMES (Never guessed, manual resolution required):');
      ambiguousDetails.slice(0, 10).forEach(a => {
        console.log(`  - "${a.rawName}" at ${a.context} -> Matches: ${a.candidates.join(', ')}`);
      });
      if (ambiguousDetails.length > 10) console.log(`  ... and ${ambiguousDetails.length - 10} more.`);
      console.log('');
    }

    if (unmatchedDetails.length > 0) {
      console.log('❌  UNMATCHED TEACHER NAMES (Faculty record not found):');
      const uniqueUnmatched = [...new Set(unmatchedDetails.map(u => u.rawName))];
      uniqueUnmatched.slice(0, 10).forEach(name => {
        console.log(`  - "${name}"`);
      });
      if (uniqueUnmatched.length > 10) console.log(`  ... and ${uniqueUnmatched.length - 10} more.`);
      console.log('');
    }

    if (!isApply) {
      console.log('ℹ️  Run with --apply to write these changes to the database:');
      console.log('    node scripts/backfillSlotTeacherIds.js --apply\n');
    }

  } catch (err) {
    console.error('Backfill script error:', err);
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
