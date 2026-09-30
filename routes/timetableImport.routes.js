/**
 * routes/timetableImport.routes.js
 *
 * REST API endpoints for Feature #1: Timetable Excel Importer.
 * Implements two-phase preview and commit pipeline:
 *  - POST /api/timetable/import/preview : Multi-sheet parse, fuzzy entity resolution, conflict check
 *  - POST /api/timetable/import/commit  : Atomic single-pass DB creation of Class, Assignment,
 *                                        SemesterTemplate (Draft), SectionTimetable (Production),
 *                                        and Timetable records with audit logging.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { sanitizeToString, sanitizeToObjectId } = require('../utils/sanitizeQuery');
const { parseTimetableWorkbook } = require('../utils/timetableExcelParser');
const { resolveSectionEntities, resolveCourse, resolveTeacher, resolveRoom } = require('../utils/fuzzyMatch');

// Memory storage for Excel upload (max 15MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

// Authorization check: Admin or Timetable Coordinator
function canManage(req) {
  const u = req.user;
  if (!u) return false;
  if (u.role === 'admin' || u.isAdmin) return true;
  if (u.isTimeTableCoordinator === true) return true;
  const rights = Array.isArray(u.adminRights) ? u.adminRights : (typeof u.adminRights === 'string' ? [u.adminRights] : []);
  if (rights.includes('timetablePage') || rights.includes('adderModules') || rights.includes('all')) return true;
  return false;
}

function requireManager(req, res, next) {
  if (!canManage(req)) {
    return res.status(403).json({ error: 'Timetable Coordinator access required' });
  }
  next();
}

/**
 * Helper to detect internal clashes across sections in the imported batch,
 * as well as clashes against existing database records.
 */
async function detectBatchConflicts(sections = [], existingTemplates = []) {
  const conflicts = [];
  const facultyPeriodMap = new Map(); // key: "day_period_teacherId" -> [sectionName]
  const roomPeriodMap = new Map();    // key: "day_period_hallNo" -> [sectionName]

  // 1. Cross-check within the imported sections
  for (const sec of sections) {
    const secName = sec.meta?.className || sec.sheetName || 'Section';
    for (const slot of (sec.slots || [])) {
      if (!slot.day || !slot.period) continue;
      const span = slot.span || 1;

      for (let p = slot.period; p < slot.period + span; p++) {
        // Teacher conflict check
        if (slot.teacherId || slot.teacherName) {
          const tKey = `${slot.day}_${p}_${slot.teacherId || slot.teacherName.toLowerCase()}`;
          if (!facultyPeriodMap.has(tKey)) facultyPeriodMap.set(tKey, []);
          facultyPeriodMap.get(tKey).push({ sectionName: secName, teacherName: slot.teacherName, day: slot.day, period: p });
        }

        // Room conflict check
        if (slot.hallNo && !slot.isCombined) {
          const rKey = `${slot.day}_${p}_${slot.hallNo.toUpperCase()}`;
          if (!roomPeriodMap.has(rKey)) roomPeriodMap.set(rKey, []);
          roomPeriodMap.get(rKey).push({ sectionName: secName, hallNo: slot.hallNo, day: slot.day, period: p });
        }
      }
    }
  }

  // Record batch teacher clashes
  facultyPeriodMap.forEach((occurrences, key) => {
    if (occurrences.length > 1) {
      const first = occurrences[0];
      const sectionsInvolved = occurrences.map(o => o.sectionName).join(', ');
      conflicts.push({
        type: 'faculty',
        severity: 'warning',
        teacherName: first.teacherName,
        day: first.day,
        period: first.period,
        message: `Faculty double-booking: ${first.teacherName} assigned to multiple sections (${sectionsInvolved}) on ${first.day} period ${first.period}`
      });
    }
  });

  // Record batch room clashes
  roomPeriodMap.forEach((occurrences, key) => {
    if (occurrences.length > 1) {
      const first = occurrences[0];
      const sectionsInvolved = occurrences.map(o => o.sectionName).join(', ');
      conflicts.push({
        type: 'room',
        severity: 'warning',
        hallNo: first.hallNo,
        day: first.day,
        period: first.period,
        message: `Room double-booking: Room ${first.hallNo} booked by multiple sections (${sectionsInvolved}) on ${first.day} period ${first.period}`
      });
    }
  });

  // 2. Cross-check against existing DB records (active templates)
  if (existingTemplates.length > 0) {
    for (const sec of sections) {
      const secName = sec.meta?.className || sec.sheetName;
      for (const slot of (sec.slots || [])) {
        if (!slot.day || !slot.period) continue;
        const span = slot.span || 1;
        const endP = slot.period + span - 1;

        if (slot.teacherName) {
          const tMatch = existingTemplates.find(tpl =>
            (tpl.grid || []).some(g =>
              g.day === slot.day &&
              g.period >= slot.period && g.period <= endP &&
              g.teacher && g.teacher.toLowerCase() === slot.teacherName.toLowerCase()
            )
          );
          if (tMatch) {
            conflicts.push({
              type: 'faculty_db',
              severity: 'warning',
              message: `Faculty clash with DB: ${slot.teacherName} on ${slot.day} period ${slot.period} already assigned in active timetable`
            });
          }
        }
      }
    }
  }

  return conflicts;
}

// ── 1. POST /preview : Parse workbook & resolve entities without writing ──
router.post('/preview', authMiddleware, requireManager, upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No Excel file uploaded. Please select a .xlsx or .xls file.' });
    }

    const preferredDeptId = req.body.deptId ? sanitizeToObjectId(req.body.deptId) : (req.user.deptId || null);

    // 1. Fetch DB reference collections in parallel
    const [departments, subjects, teachers, specialActivities, rooms, timingSets, existingTemplates] = await Promise.all([
      M.Department.find().sort({ name: 1 }).lean(),
      M.Subject.find().lean(),
      M.Teacher.find().select('-password').sort({ fullName: 1 }).lean(),
      M.SpecialActivity.find({ isActive: true }).sort({ name: 1 }).lean(),
      M.Room.find({ status: { $ne: 'Inactive' } }).sort({ hallNo: 1 }).lean(),
      M.TimingSet.find().lean(),
      M.SemesterTemplate.find({ status: { $in: ['published', 'draft'] } }).select('grid classId').limit(20).lean()
    ]);

    // 2. Parse uploaded workbook buffer
    const parseResult = await parseTimetableWorkbook(req.file.buffer, {
      fileName: req.file.originalname
    });

    if (parseResult.sections.length === 0) {
      return res.status(400).json({
        error: 'No section timetables could be detected. Please ensure worksheets contain a "Section:" header block.',
        warnings: parseResult.warnings
      });
    }

    // 3. Resolve entities for each section
    const resolvedSections = [];
    const aggregatedUnmatched = {
      courses: new Map(),
      faculty: new Map(),
      rooms: new Map()
    };

    let totalSlots = 0;
    let resolvedSlots = 0;

    for (const rawSec of parseResult.sections) {
      const resolved = resolveSectionEntities(rawSec, {
        subjects,
        teachers,
        specialActivities,
        rooms
      }, preferredDeptId);

      // Tally slot statistics
      (resolved.slots || []).forEach(slot => {
        totalSlots++;
        if (slot.resolvedType === 'subject' || slot.resolvedType === 'activity') {
          resolvedSlots++;
        }
      });

      // Aggregate unmatched queues (deduplicating by raw string)
      (resolved.unmatched.courses || []).forEach(c => {
        if (!aggregatedUnmatched.courses.has(c.raw)) aggregatedUnmatched.courses.set(c.raw, c);
      });
      (resolved.unmatched.faculty || []).forEach(f => {
        if (!aggregatedUnmatched.faculty.has(f.raw)) aggregatedUnmatched.faculty.set(f.raw, f);
      });
      (resolved.unmatched.rooms || []).forEach(r => {
        if (!aggregatedUnmatched.rooms.has(r.raw)) aggregatedUnmatched.rooms.set(r.raw, r);
      });

      resolvedSections.push(resolved);
    }

    // 4. Run conflict detection across parsed sections
    const conflicts = await detectBatchConflicts(resolvedSections, existingTemplates);

    res.json({
      ok: true,
      summary: {
        fileName: req.file.originalname,
        totalSheets: parseResult.summary.totalSheets,
        sheetsScanned: parseResult.summary.sheetsScanned,
        sectionsFound: resolvedSections.length,
        totalSlots: totalSlots,
        resolvedSlots: resolvedSlots,
        unresolvedSlots: totalSlots - resolvedSlots,
        conflictsFound: conflicts.length
      },
      sections: resolvedSections,
      unmatchedQueue: {
        courses: Array.from(aggregatedUnmatched.courses.values()),
        faculty: Array.from(aggregatedUnmatched.faculty.values()),
        rooms: Array.from(aggregatedUnmatched.rooms.values())
      },
      conflicts: conflicts,
      departments: departments.map(d => ({ _id: d._id, name: d.name, code: d.code })),
      timingSets: timingSets.map(ts => ({ _id: ts._id, name: ts.name, code: ts.code }))
    });
  } catch (err) {
    console.error('Error during timetable import preview:', err);
    res.status(500).json({ error: `Timetable preview failed: ${err.message}` });
  }
});

// ── 2. POST /commit : Atomic batch commit into Class, Assignment, and Timetable ──
router.post('/commit', authMiddleware, requireManager, async (req, res) => {
  try {
    const {
      deptId,
      academicYear = '2026-2027',
      publishDirectly = false,
      sections = []
    } = req.body;

    const resolvedDeptId = sanitizeToObjectId(deptId) || req.user.deptId;
    if (!resolvedDeptId) {
      return res.status(400).json({ error: 'Department ID is required to commit timetable records.' });
    }

    const dept = await M.Department.findById(resolvedDeptId).lean();
    if (!dept) {
      return res.status(404).json({ error: 'Target department not found.' });
    }

    const selectedSections = sections.filter(s => s.selected !== false);
    if (selectedSections.length === 0) {
      return res.status(400).json({ error: 'No sections were selected for import.' });
    }

    let createdClassesCount = 0;
    let updatedClassesCount = 0;
    let assignmentsCount = 0;
    let totalCommittedSlots = 0;
    const committedSectionsSummary = [];

    // Process each section
    for (const sec of selectedSections) {
      const meta = sec.meta || {};
      const secYear = String(meta.year || '1').trim();
      const secSem = String(meta.semester || '1').trim();
      const secCode = String(meta.section || 'A').trim().toUpperCase();
      const hallNo = String(meta.hallNo || '').trim();
      const advisorId = meta.advisorTeacherId ? sanitizeToObjectId(meta.advisorTeacherId) : null;
      const advisorName = meta.advisorTeacherName || '';

      // Derive batch and standard class name (e.g. '2025-2029' or current year offset)
      const currentCalendarYear = new Date().getFullYear();
      const yearNum = parseInt(secYear, 10) || 1;
      const batchStart = currentCalendarYear - (yearNum - 1);
      const batchEnd = batchStart + 4;
      const batchStr = `${batchStart}-${batchEnd}`;
      const romanYears = ['I', 'II', 'III', 'IV'];
      const yrLabel = romanYears[yearNum - 1] || secYear;
      const standardClassName = `${yrLabel}-${dept.code || 'ENG'}-${secCode}`;

      // ── Step A: Find or Create Class ──
      let cls = await M.Class.findOne({
        deptId: resolvedDeptId,
        year: secYear,
        sem: secSem,
        section: secCode
      });

      if (!cls) {
        cls = await M.Class.findOne({
          deptId: resolvedDeptId,
          name: standardClassName
        });
      }

      if (cls) {
        // Update existing Class with room and advisor if missing
        let changed = false;
        if (hallNo && !cls.hallNo) { cls.hallNo = hallNo; changed = true; }
        if (advisorId && !cls.advisorTeacherId) {
          cls.advisorTeacherId = advisorId;
          cls.advisorTeacherName = advisorName;
          changed = true;
        }
        if (changed) await cls.save();
        updatedClassesCount++;
      } else {
        // Create new Class
        const generatedTrackId = 'TRCLS_' + Math.random().toString(36).substr(2, 9).toUpperCase();
        cls = await M.Class.create({
          trackId: generatedTrackId,
          name: standardClassName,
          deptId: resolvedDeptId,
          deptName: dept.name,
          deptCode: dept.code,
          year: secYear,
          batch: batchStr,
          sem: secSem,
          section: secCode,
          hallNo: hallNo || 'TP-Room',
          advisorTeacherId: advisorId,
          advisorTeacherName: advisorName
        });
        createdClassesCount++;
      }

      // ── Step B: Upsert Assignments from Legend ──
      const legendItems = sec.legend || [];
      for (const leg of legendItems) {
        const subjectId = leg.resolvedSubject?.subjectId || leg.subjectId;
        const teacherId = leg.resolvedTeacher?.teacherId || leg.teacherId;
        const remarks = leg.remarks || '';

        if (subjectId && teacherId) {
          const subjectDoc = await M.Subject.findById(subjectId).lean();
          const teacherDoc = await M.Teacher.findById(teacherId).lean();

          if (subjectDoc && teacherDoc) {
            const existingAssign = await M.Assignment.findOne({
              classId: String(cls._id),
              subjectId: String(subjectDoc._id)
            });

            if (existingAssign) {
              existingAssign.teacherId = String(teacherDoc._id);
              existingAssign.teacherName = teacherDoc.fullName;
              existingAssign.hallNo = hallNo || existingAssign.hallNo;
              if (remarks) existingAssign.remarks = remarks;
              await existingAssign.save();
            } else {
              const assignTrackId = 'TRASN_' + Math.random().toString(36).substr(2, 9).toUpperCase();
              await M.Assignment.create({
                trackId: assignTrackId,
                subjectId: String(subjectDoc._id),
                subjectName: subjectDoc.name,
                classId: String(cls._id),
                className: cls.name,
                teacherId: String(teacherDoc._id),
                teacherName: teacherDoc.fullName,
                hallNo: hallNo || '',
                deptName: dept.name,
                deptCode: dept.code,
                remarks: remarks
              });
              assignmentsCount++;
            }
          }
        }
      }

      // ── Step C: Build Slots & SemesterTemplate / SectionTimetable ──
      const gridSlots = [];
      const slotsObj = {};
      const liveTimetableSlots = [];

      for (const slot of (sec.slots || [])) {
        if (!slot.day || !slot.period) continue;
        totalCommittedSlots++;

        const gridSlotEntry = {
          day: slot.day,
          period: slot.period,
          subject: slot.subjectName || slot.activityLabel || slot.rawLabel || '',
          teacher: slot.teacherName || '',
          room: slot.hallNo || hallNo || '',
          roomId: slot.roomId || null,
          combinedWith: slot.combinedWith || [],
          isLab: !!slot.isLab,
          span: slot.span || 1,
          state: 'scheduled',
          activityId: slot.activityId ? sanitizeToObjectId(slot.activityId) : null,
          activityLabel: slot.activityLabel || ''
        };

        gridSlots.push(gridSlotEntry);

        // Populate slots map for SectionTimetable
        const key = `${slot.day}_${slot.period}`;
        slotsObj[key] = {
          ...gridSlotEntry,
          subjectId: slot.subjectId || null,
          teacherId: slot.teacherId || null,
          teacherTrackId: slot.teacherTrackId || ''
        };

        // If slot is an academic subject with assigned teacher, build live slot candidate
        if (slot.subjectId && slot.teacherId) {
          liveTimetableSlots.push({
            trackId: slot.teacherTrackId || 'TRTEA_' + Math.random().toString(36).substr(2, 6).toUpperCase(),
            teacherName: slot.teacherName || '',
            classId: cls._id,
            className: cls.name,
            subjectId: sanitizeToObjectId(slot.subjectId),
            subjectName: slot.subjectName || '',
            day: slot.day,
            start: slot.startTime || '08:30',
            end: slot.endTime || '09:15'
          });
        }
      }

      // ── Step D: Write to Timetable Models (Draft vs Production) ──
      if (publishDirectly) {
        // Direct to Production: SectionTimetable + Published SemesterTemplate + live Timetable
        await M.SectionTimetable.findOneAndUpdate(
          { classId: cls._id },
          {
            className: cls.name,
            deptId: resolvedDeptId,
            deptName: dept.name,
            slots: slotsObj,
            updatedBy: req.user.name || 'Excel Importer'
          },
          { upsert: true, returnDocument: 'after' }
        );

        // Upsert SemesterTemplate in published status
        let template = await M.SemesterTemplate.findOne({ classId: cls._id, status: 'published' });
        if (!template) {
          template = new M.SemesterTemplate({
            classId: cls._id,
            academicYear: academicYear,
            semester: secSem,
            status: 'published',
            version: 1,
            grid: gridSlots,
            publishedAt: new Date(),
            publishedBy: req.user.name || 'Excel Importer'
          });
        } else {
          template.grid = gridSlots;
          template.version += 1;
          template.publishedAt = new Date();
          template.publishedBy = req.user.name || 'Excel Importer';
        }
        await template.save();

        // Create version audit snapshot
        await M.TimetableVersion.create({
          semesterTemplateId: template._id,
          snapshot: { grid: gridSlots, slots: slotsObj },
          publishedBy: req.user.name || 'Excel Importer',
          publishedAt: new Date(),
          changeSummary: 'Direct import from Excel workbook',
          label: `v${template.version} (Excel Import)`
        });

        // Refresh live Timetable records for teacher attendance lookup
        await M.Timetable.deleteMany({ classId: cls._id });
        if (liveTimetableSlots.length > 0) {
          await M.Timetable.insertMany(liveTimetableSlots);
        }
      } else {
        // Default: Save as Draft SemesterTemplate for coordinator review in Draft Editor
        let draftTemplate = await M.SemesterTemplate.findOne({ classId: cls._id, status: 'draft' });
        if (!draftTemplate) {
          draftTemplate = new M.SemesterTemplate({
            classId: cls._id,
            academicYear: academicYear,
            semester: secSem,
            status: 'draft',
            version: 1,
            grid: gridSlots
          });
        } else {
          draftTemplate.grid = gridSlots;
          draftTemplate.academicYear = academicYear;
          draftTemplate.semester = secSem;
        }
        await draftTemplate.save();
      }

      committedSectionsSummary.push({
        classId: cls._id,
        className: cls.name,
        section: secCode,
        status: publishDirectly ? 'published' : 'draft',
        slotCount: gridSlots.length
      });
    }

    // ── Step E: Encrypted Action Log ──
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Timetable Imported',
      `Imported ${selectedSections.length} sections (${totalCommittedSlots} slots) for ${dept.name} [Mode: ${publishDirectly ? 'Production' : 'Draft'}]`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'timetable',
        subType: 'bulk-import',
        deptId: resolvedDeptId,
        publishDirectly,
        createdClasses: createdClassesCount,
        updatedClasses: updatedClassesCount,
        assignmentsCreated: assignmentsCount
      }
    );

    res.json({
      ok: true,
      message: `Successfully imported ${selectedSections.length} section timetables (${publishDirectly ? 'Published to Production' : 'Saved as Drafts'}).`,
      data: {
        sectionsImported: selectedSections.length,
        totalSlots: totalCommittedSlots,
        createdClasses: createdClassesCount,
        updatedClasses: updatedClassesCount,
        assignments: assignmentsCount,
        mode: publishDirectly ? 'published' : 'draft',
        details: committedSectionsSummary
      }
    });
  } catch (err) {
    console.error('Error during timetable import commit:', err);
    res.status(500).json({ error: `Commit failed: ${err.message}` });
  }
});

module.exports = router;
