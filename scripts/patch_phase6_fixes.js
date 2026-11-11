/**
 * scripts/patch_phase6_fixes.js
 *
 * Implements Phase 6 core server fixes:
 * 1. utils/timetableResolver.js: Prioritizes SectionTimetable (Head) before SemesterTemplate mirror.
 * 2. routes/timetable.routes.js: Drops legacy M.Timetable.find in /faculty-schedule (F17).
 * 3. routes/timetable.routes.js: Adds production read-only guard (process.env.TIMETABLE_PRODUCTION_READ_ONLY === 'true').
 */

'use strict';

const fs = require('fs');
const path = require('path');

// 1. Patch utils/timetableResolver.js
const resolverPath = path.join(__dirname, '..', 'utils', 'timetableResolver.js');
let resolverCode = fs.readFileSync(resolverPath, 'utf8').replace(/\r\n/g, '\n');

const resQueryTarget = `  // 2. Published SemesterTemplates (for this room or linked class)
  const templateQuery = {
    status: 'published',
    $or: [
      { 'grid.roomId': roomId },
      ...(hallNo ? [{ 'grid.room': hallNo }] : []),
      ...(linkedClass ? [{ classId: linkedClass._id }] : [])
    ]
  };
  const templates = await M.SemesterTemplate.find(templateQuery).populate('classId').lean();

  // 3. SectionTimetable for linked class (production timetable)
  let secTt = null;
  if (linkedClass && M.SectionTimetable && typeof M.SectionTimetable.findOne === 'function') {
    try {
      secTt = await M.SectionTimetable.findOne({ classId: linkedClass._id }).lean();
    } catch (e) {
      secTt = null;
    }
  }`;

const resQueryRepl = `  // 2. SectionTimetable for linked class (production timetable Head)
  let secTt = null;
  if (linkedClass && M.SectionTimetable && typeof M.SectionTimetable.findOne === 'function') {
    try {
      secTt = await M.SectionTimetable.findOne({ classId: linkedClass._id }).lean();
    } catch (e) {
      secTt = null;
    }
  }

  // 3. Published SemesterTemplates mirror (for this room or linked class)
  const templateQuery = {
    status: 'published',
    $or: [
      { 'grid.roomId': roomId },
      ...(hallNo ? [{ 'grid.room': hallNo }] : []),
      ...(linkedClass ? [{ classId: linkedClass._id }] : [])
    ]
  };
  const templates = await M.SemesterTemplate.find(templateQuery).populate('classId').lean();`;

if (resolverCode.includes(resQueryTarget)) {
  resolverCode = resolverCode.replace(resQueryTarget, resQueryRepl);
  console.log('Swapped query execution order in timetableResolver.js');
}

const resLoopTarget = `    // 2. Try published templates
    if (!baseSlot) {
      for (const template of templates) {
        const tClassId = template.classId?._id || template.classId;
        const slot = (template.grid || []).find(g =>
          g.day === dayNameFromDate && slotCoversPeriod(g, periodNum) && slotMatchesRoom(g, roomId, hallNo, linkedClass, tClassId)
        );
        if (slot) {
          classDoc = template.classId || linkedClass;
          baseSlot = {
            classId: classDoc?._id || linkedClass?._id,
            className: classDoc?.name || slot.section || linkedClass?.name || '',
            subjectId: slot.subjectId,
            subjectName: slot.subject,
            teacherTrackId: slot.teacherTrackId,
            teacherName: slot.teacher,
            type: slot.type || (slot.isLab ? 'Lab' : 'Theory'),
            isLab: Boolean(slot.isLab || slot.type === 'Lab'),
            span: slot.span || 1,
            spanRootPeriod: slot.period,
            periodNumber: periodNum,
            status: 'scheduled',
            room: slot.room || hallNo,
            roomId: slot.roomId || roomId
          };
          break;
        }
      }
    }

    // 3. Try SectionTimetable (production timetable for linked class)
    if (!baseSlot && secTt?.slots) {
      const secSlots = Object.values(secTt.slots).filter(s => s && s.day === dayNameFromDate);
      const slot = secSlots.find(s => slotCoversPeriod(s, periodNum) && slotMatchesRoom(s, roomId, hallNo, linkedClass, secTt.classId));
      if (slot) {
        classDoc = linkedClass;
        baseSlot = {
          classId: linkedClass?._id,
          className: linkedClass?.name || slot.section || '',
          subjectId: slot.subjectId,
          subjectName: slot.subject,
          teacherTrackId: slot.teacherTrackId,
          teacherName: slot.teacher,
          type: slot.type || (slot.isLab ? 'Lab' : 'Theory'),
          isLab: Boolean(slot.isLab || slot.type === 'Lab'),
          span: slot.span || 1,
          spanRootPeriod: slot.spanRootPeriod || slot.period,
          periodNumber: periodNum,
          status: 'scheduled',
          room: slot.room || hallNo,
          roomId: slot.roomId || roomId
        };
      }
    }`;

const resLoopRepl = `    // 2. Try SectionTimetable Head (production timetable for linked class)
    if (!baseSlot && secTt?.slots) {
      const secSlots = Object.values(secTt.slots).filter(s => s && s.day === dayNameFromDate);
      const slot = secSlots.find(s => slotCoversPeriod(s, periodNum) && slotMatchesRoom(s, roomId, hallNo, linkedClass, secTt.classId));
      if (slot) {
        classDoc = linkedClass;
        baseSlot = {
          classId: linkedClass?._id,
          className: linkedClass?.name || slot.section || '',
          subjectId: slot.subjectId,
          subjectName: slot.subject,
          teacherTrackId: slot.teacherTrackId,
          teacherName: slot.teacher,
          type: slot.type || (slot.isLab ? 'Lab' : 'Theory'),
          isLab: Boolean(slot.isLab || slot.type === 'Lab'),
          span: slot.span || 1,
          spanRootPeriod: slot.spanRootPeriod || slot.period,
          periodNumber: periodNum,
          status: 'scheduled',
          room: slot.room || hallNo,
          roomId: slot.roomId || roomId
        };
      }
    }

    // 3. Fallback to published SemesterTemplates mirror
    if (!baseSlot) {
      for (const template of templates) {
        const tClassId = template.classId?._id || template.classId;
        const slot = (template.grid || []).find(g =>
          g.day === dayNameFromDate && slotCoversPeriod(g, periodNum) && slotMatchesRoom(g, roomId, hallNo, linkedClass, tClassId)
        );
        if (slot) {
          classDoc = template.classId || linkedClass;
          baseSlot = {
            classId: classDoc?._id || linkedClass?._id,
            className: classDoc?.name || slot.section || linkedClass?.name || '',
            subjectId: slot.subjectId,
            subjectName: slot.subject,
            teacherTrackId: slot.teacherTrackId,
            teacherName: slot.teacher,
            type: slot.type || (slot.isLab ? 'Lab' : 'Theory'),
            isLab: Boolean(slot.isLab || slot.type === 'Lab'),
            span: slot.span || 1,
            spanRootPeriod: slot.period,
            periodNumber: periodNum,
            status: 'scheduled',
            room: slot.room || hallNo,
            roomId: slot.roomId || roomId
          };
          break;
        }
      }
    }`;

if (resolverCode.includes(resLoopTarget)) {
  resolverCode = resolverCode.replace(resLoopTarget, resLoopRepl);
  console.log('Swapped period slot resolution order in timetableResolver.js');
}

fs.writeFileSync(resolverPath, resolverCode, 'utf8');

// 2. Patch routes/timetable.routes.js
const routesPath = path.join(__dirname, '..', 'routes', 'timetable.routes.js');
let routesCode = fs.readFileSync(routesPath, 'utf8').replace(/\r\n/g, '\n');

// A. Drop legacy M.Timetable.find in faculty-schedule
const legacyFacultyTarget = `    if (env === 'production') {
      const directSlots = await M.Timetable.find({ teacherName: regex }).lean();
      const timeToPeriodNum = (start) => {
        if (!start) return 1;
        const timeMap = {
          '08:30': 1, '09:15': 2, '10:00': 3, '10:15': 3,
          '11:00': 4, '11:45': 5, '12:30': 6, '14:00': 7,
          '14:45': 8, '15:45': 9
        };
        return timeMap[start] || (parseInt(String(start).replace(/\\D/g, ''), 10) || 1);
      };

      directSlots.forEach(ds => {
        const dayMap = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
        const fullDay = dayMap[ds.day] || ds.day;
        const dsPNum = timeToPeriodNum(ds.start);
        const alreadyHas = facultySlots.some(s => {
          if (s.day !== fullDay || s.section !== ds.className) return false;
          if (s.start && ds.start) return s.start === ds.start;
          const sPNum = typeof s.period === 'number' ? s.period : (parseInt(String(s.period || '').replace(/\\D/g, ''), 10) || null);
          if (sPNum && dsPNum) return sPNum === dsPNum;
          return s.subject && ds.subjectName && s.subject.trim().toLowerCase() === ds.subjectName.trim().toLowerCase();
        });
        if (!alreadyHas) {
          facultySlots.push({
            id: String(ds._id),
            day: fullDay,
            period: \`P\${dsPNum}\`,
            start: ds.start,
            end: ds.end,
            subject: ds.subjectName || '',
            teacher: ds.teacherName,
            section: ds.className,
            room: '',
            type: 'Theory',
            duration: 1,
            _source: 'production'
          });
        }
      });
    }`;

if (routesCode.includes(legacyFacultyTarget)) {
  routesCode = routesCode.replace(legacyFacultyTarget, '// F17: Legacy M.Timetable retired; SectionTimetable Head is single source of truth');
  console.log('Retired legacy M.Timetable.find from /faculty-schedule (F17)');
}

// B. Production read-only guard on legacy write routes
const guardSnippet = `    if (process.env.TIMETABLE_PRODUCTION_READ_ONLY === 'true') {
      return res.status(403).json({ error: 'Production is view-only. Updates must be submitted via Workspace Commits.' });
    }`;

if (!routesCode.includes("Production is view-only")) {
  const putSlotTarget = "router.put('/section/:classId/slot', requireManager, async (req, res) => {\n  try {";
  const putSlotRepl = putSlotTarget + "\n" + guardSnippet;
  routesCode = routesCode.replace(putSlotTarget, putSlotRepl);

  const putSectionTarget = "router.put('/section/:classId', requireManager, async (req, res) => {\n  try {";
  const putSectionRepl = putSectionTarget + "\n" + guardSnippet;
  routesCode = routesCode.replace(putSectionTarget, putSectionRepl);

  const saveProdTarget = "router.post('/save-production', requireManager, async (req, res) => {\n  try {";
  const saveProdRepl = saveProdTarget + "\n" + guardSnippet;
  routesCode = routesCode.replace(saveProdTarget, saveProdRepl);

  console.log('Added TIMETABLE_PRODUCTION_READ_ONLY guard to legacy write routes');
}

fs.writeFileSync(routesPath, routesCode, 'utf8');
console.log('Phase 6 core server fixes applied successfully');
