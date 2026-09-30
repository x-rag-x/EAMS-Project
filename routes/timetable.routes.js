const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { decryptLog } = require('../utils/logCrypto');
const { sanitizeToString, sanitizeToObjectId } = require('../utils/sanitizeQuery');
const escapeRegex = s => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const jwt = require('jsonwebtoken');
const cfg = require('../config');
const {
  generateBoardApiKey,
  resolveRoomTimetableContext,
  sendCommandToBoard,
  broadcastToMonitors
} = require('../services/board.socket');
const {
  getProductionSections,
  invalidateProductionCache,
  getTimingSets,
  timingForClass,
  sessionOfPeriod,
  getTeacherIdentity,
  buildWeeklyTemplate,
  resolveTeacherRange,
  dayFull
} = require('../utils/teacherSchedule');

// ── Default institutional timing sets (seeded on first request) ──

const TIMING_SEED = [
  {
    code: 'SET_1',
    name: 'Timing Set 1 (Years I & IV)',
    applicableYears: ['1', '4', 'I', 'IV'],
    morningBreakAfter: 2,
    lunchAfter: 6,
    isDefault: true,
    periods: [
      { periodNumber: 1, number: 1, start: '08:30', end: '09:15', label: 'Period 1', isBreak: false, breakType: 'None' },
      { periodNumber: 2, number: 2, start: '09:15', end: '10:00', label: 'Period 2', isBreak: false, breakType: 'None' },
      { periodNumber: 0, number: 0, start: '10:00', end: '10:15', label: 'Morning Break', isBreak: true, breakType: 'Interval' },
      { periodNumber: 3, number: 3, start: '10:15', end: '11:00', label: 'Period 3', isBreak: false, breakType: 'None' },
      { periodNumber: 4, number: 4, start: '11:00', end: '11:45', label: 'Period 4', isBreak: false, breakType: 'None' },
      { periodNumber: 5, number: 5, start: '11:45', end: '12:30', label: 'Period 5', isBreak: false, breakType: 'None' },
      { periodNumber: 6, number: 6, start: '12:30', end: '13:15', label: 'Period 6', isBreak: false, breakType: 'None' },
      { periodNumber: 0, number: 0, start: '13:15', end: '14:00', label: 'Lunch Break', isBreak: true, breakType: 'Lunch' },
      { periodNumber: 7, number: 7, start: '14:00', end: '14:45', label: 'Period 7', isBreak: false, breakType: 'None' },
      { periodNumber: 8, number: 8, start: '14:45', end: '15:30', label: 'Period 8', isBreak: false, breakType: 'None' },
      { periodNumber: 0, number: 0, start: '15:30', end: '15:45', label: 'Tea Break', isBreak: true, breakType: 'Tea' },
      { periodNumber: 9, number: 9, start: '15:45', end: '16:30', label: 'Period 9', isBreak: false, breakType: 'None' }
    ]
  },
  {
    code: 'SET_2',
    name: 'Timing Set 2 (Years II & III)',
    applicableYears: ['2', '3', 'II', 'III'],
    morningBreakAfter: 3,
    lunchAfter: 6,
    isDefault: false,
    periods: [
      { periodNumber: 1, number: 1, start: '08:30', end: '09:15', label: 'Period 1', isBreak: false, breakType: 'None' },
      { periodNumber: 2, number: 2, start: '09:15', end: '10:00', label: 'Period 2', isBreak: false, breakType: 'None' },
      { periodNumber: 3, number: 3, start: '10:00', end: '10:45', label: 'Period 3', isBreak: false, breakType: 'None' },
      { periodNumber: 0, number: 0, start: '10:45', end: '11:00', label: 'Morning Break', isBreak: true, breakType: 'Interval' },
      { periodNumber: 4, number: 4, start: '11:00', end: '11:45', label: 'Period 4', isBreak: false, breakType: 'None' },
      { periodNumber: 5, number: 5, start: '11:45', end: '12:30', label: 'Period 5', isBreak: false, breakType: 'None' },
      { periodNumber: 6, number: 6, start: '12:30', end: '13:15', label: 'Period 6', isBreak: false, breakType: 'None' },
      { periodNumber: 0, number: 0, start: '13:15', end: '14:00', label: 'Lunch Break', isBreak: true, breakType: 'Lunch' },
      { periodNumber: 7, number: 7, start: '14:00', end: '14:45', label: 'Period 7', isBreak: false, breakType: 'None' },
      { periodNumber: 8, number: 8, start: '14:45', end: '15:30', label: 'Period 8', isBreak: false, breakType: 'None' },
      { periodNumber: 0, number: 0, start: '15:30', end: '15:45', label: 'Tea Break', isBreak: true, breakType: 'Tea' },
      { periodNumber: 9, number: 9, start: '15:45', end: '16:30', label: 'Period 9', isBreak: false, breakType: 'None' }
    ]
  }
];


// ── Authorization helpers ──

function canManage(req) {
  const u = req.user;
  if (!u) return false;
  if (u.role === 'admin') return true;
  if (u.isHod === true || u.isTimeTableCoordinator === true) return true;
  const rights = Array.isArray(u.adminRights) ? u.adminRights : (typeof u.adminRights === 'string' ? [u.adminRights] : []);
  if (rights.includes('timetablePage') || rights.includes('all')) return true;
  return false;
}

function canAccessDev(req) {
  const u = req.user;
  if (!u) return false;
  return canManage(req) || u.isHod === true;
}

function requireManager(req, res, next) {
  if (!canManage(req)) {
    return res.status(403).json({ error: 'Timetable Coordinator access required' });
  }
  next();
}

function requireDevAccess(req, res, next) {
  const env = sanitizeToString(req.query.env || req.body?.env || 'production').toLowerCase();
  if (env !== 'development') return next();

  if (!canAccessDev(req)) {
    return res.status(403).json({
      error: 'Development environment access restricted to Admins, TT Coordinators, and HODs.'
    });
  }

  // Server-side department scoping: Non-admin HODs, TT coordinators, and teachers are scoped to their own department
  if (req.user && req.user.role !== 'admin') {
    const userDeptId = req.user.deptId || req.user.departmentId || req.user.department;
    if (userDeptId && !req.query.deptId) {
      req.query.deptId = String(userDeptId);
    }
  }

  next();
}

// ── Environment, SemesterTemplate & Slot Resolution Helpers ──

async function getActiveAcademicYears() {
  const activeYear = await M.Year.findOne({ isCurrent: true }).lean();
  if (!activeYear || !activeYear.academicYear) {
    console.warn('[Timetable:Dev] No current academic year found (Year.isCurrent: true is unset). Stale-term drafts may appear.');
    return [];
  }
  const yr = String(activeYear.academicYear).trim();
  const altYr = yr.includes('-') && yr.length === 9
    ? yr.replace(/-(\d{4})$/, (_, y) => '-' + y.slice(-2))
    : (yr.includes('-') && yr.length === 7
      ? yr.replace(/^(\d{4})-(\d{2})$/, (_, y1, y2) => y1 + '-' + y1.slice(0, 2) + y2)
      : yr);
  return [yr, altYr];
}

async function getActiveDevTemplate(classId, academicYears = []) {
  const query = {
    classId,
    status: { $in: ['draft', 'pending_approval'] }
  };
  if (academicYears.length > 0) {
    query.$or = [
      { academicYear: { $in: academicYears } },
      { academicYear: { $exists: false } },
      { academicYear: null },
      { academicYear: '' }
    ];
  }
  return M.SemesterTemplate.findOne(query).sort({ updatedAt: -1 }).lean();
}

async function getAllActiveDevTemplates(academicYears = []) {
  const query = {
    status: { $in: ['draft', 'pending_approval'] }
  };
  if (academicYears.length > 0) {
    query.$or = [
      { academicYear: { $in: academicYears } },
      { academicYear: { $exists: false } },
      { academicYear: null },
      { academicYear: '' }
    ];
  }
  const templates = await M.SemesterTemplate.find(query).sort({ updatedAt: -1 }).lean();
  if (templates.length === 0 && academicYears.length > 0) {
    console.warn('[Timetable:Dev] Academic year filter matched 0 dev templates for', academicYears);
  }
  const map = new Map();
  for (const t of templates) {
    const key = String(t.classId);
    if (!map.has(key)) map.set(key, t);
  }
  return map;
}

function gridToSlotsObj(grid = [], className = '') {
  const slots = {};
  if (!Array.isArray(grid)) return slots;

  for (const item of grid) {
    if (!item || !item.day || item.period === undefined || item.period === null) continue;
    const periodNum = typeof item.period === 'number' ? item.period : (parseInt(String(item.period).replace(/^P/i, ''), 10) || 1);
    const key = `${item.day}_${periodNum}`;

    slots[key] = {
      day: item.day,
      period: periodNum,
      subject: item.subject || '',
      teacher: item.teacher || '',
      room: item.room || '',
      span: Number(item.span) || 1,
      isLab: Boolean(item.isLab),
      combinedWith: Array.isArray(item.combinedWith) ? item.combinedWith : [],
      state: item.state || '',
      activityId: item.activityId || null,
      activityLabel: item.activityLabel || '',
      roomId: item.roomId || undefined,
    };
  }
  return slots;
}

function normalizeGridSlots(rawSlots = []) {
  if (!Array.isArray(rawSlots)) return [];
  return rawSlots.map(slot => {
    if (!slot) return null;
    let periodNum = slot.period;
    if (typeof periodNum === 'string') {
      periodNum = parseInt(periodNum.replace(/\D/g, ''), 10) || 1;
    } else if (typeof periodNum !== 'number') {
      periodNum = 1;
    }
    const isLab = Boolean(slot.isLab ?? (slot.type === 'Lab'));
    const span = Number(slot.span ?? slot.duration ?? 1) || 1;
    return {
      day: slot.day,
      period: periodNum,
      subject: slot.subject || '',
      teacher: slot.teacher || '',
      room: slot.room || '',
      isLab,
      span,
      state: slot.state || slot.comment || '',
      ...(slot.assignmentId ? { assignmentId: slot.assignmentId } : {}),
      ...(slot.teacherId ? { teacherId: slot.teacherId } : {}),
      ...(slot.teacherTrackId ? { teacherTrackId: slot.teacherTrackId } : {}),
      ...(slot.subjectId ? { subjectId: slot.subjectId } : {}),
      ...(slot.roomId ? { roomId: slot.roomId } : {}),
      ...(Array.isArray(slot.combinedWith) ? { combinedWith: slot.combinedWith } : {}),
      ...(slot.activityId ? { activityId: slot.activityId } : {}),
      ...(slot.activityLabel ? { activityLabel: slot.activityLabel } : {})
    };
  }).filter(Boolean);
}

function buildOverrideSlot(data = {}) {
  const teacher = data.teacher || data.teacherName || '';
  const teacherName = teacher;
  const teacherId = data.teacherId || null;
  const teacherTrackId = data.teacherTrackId || data.trackId || '';
  const subject = data.subject || data.subjectName || '';
  const subjectName = subject;
  const room = data.room || data.hallNo || '';
  const hallNo = room;
  return {
    teacher,
    teacherName,
    teacherId,
    teacherTrackId,
    subject,
    subjectName,
    room,
    hallNo
  };
}

function readOverrideSlot(slot = {}) {
  if (!slot) return {};
  const teacher = slot.teacher || slot.teacherName || '';
  const teacherName = teacher;
  const teacherId = slot.teacherId || null;
  const teacherTrackId = slot.teacherTrackId || slot.trackId || '';
  const subject = slot.subject || slot.subjectName || '';
  const subjectName = subject;
  const room = slot.room || slot.hallNo || '';
  const hallNo = room;
  return {
    teacher,
    teacherName,
    teacherId,
    teacherTrackId,
    subject,
    subjectName,
    room,
    hallNo
  };
}

async function getSlotSource(env = 'production', classIdFilter = null, deptIdFilter = null) {
  if (env === 'production') {
    const q = {};
    if (classIdFilter) q.classId = classIdFilter;
    if (deptIdFilter) q.deptId = deptIdFilter;
    const docs = await M.SectionTimetable.find(q).lean();
    return docs.map(d => ({ ...d, _source: 'production' }));
  }

  // Development: Hybrid Merge
  const academicYears = await getActiveAcademicYears();
  const devMap = classIdFilter
    ? await (async () => {
        const t = await getActiveDevTemplate(classIdFilter, academicYears);
        const m = new Map();
        if (t) m.set(String(t.classId), t);
        return m;
      })()
    : await getAllActiveDevTemplates(academicYears);

  const prodQ = {};
  if (classIdFilter) prodQ.classId = classIdFilter;
  if (deptIdFilter) prodQ.deptId = deptIdFilter;
  const prodTimetables = await M.SectionTimetable.find(prodQ).lean();

  const prodMap = new Map();
  for (const pt of prodTimetables) prodMap.set(String(pt.classId), pt);

  const allClassIds = new Set([...prodMap.keys(), ...devMap.keys()]);

  // Identify dev-only classes that need className or deptId resolved
  const devOnlyCids = [];
  for (const cid of allClassIds) {
    if (devMap.has(cid) && !prodMap.has(cid)) {
      devOnlyCids.push(cid);
    }
  }

  let classLookup = new Map();
  if (devOnlyCids.length > 0) {
    const classes = await M.Class.find({ _id: { $in: devOnlyCids } }).lean();
    for (const c of classes) classLookup.set(String(c._id), c);
  }

  const results = [];
  for (const cid of allClassIds) {
    const devTemplate = devMap.get(cid);
    const prodDoc = prodMap.get(cid);

    if (devTemplate) {
      const cls = classLookup.get(cid);
      const className = devTemplate.className || prodDoc?.className || cls?.name || '';
      const deptId = prodDoc?.deptId || cls?.deptId || null;
      const deptName = prodDoc?.deptName || cls?.deptName || '';

      if (deptIdFilter && String(deptId) !== String(deptIdFilter)) continue;

      results.push({
        classId: devTemplate.classId || (prodDoc ? prodDoc.classId : cid),
        className,
        deptId,
        deptName,
        slots: gridToSlotsObj(devTemplate.grid || [], className),
        _source: 'development',
        _templateId: devTemplate._id,
        _templateStatus: devTemplate.status,
        _templateUpdatedAt: devTemplate.updatedAt,
      });
    } else if (prodDoc) {
      if (deptIdFilter && String(prodDoc.deptId) !== String(deptIdFilter)) continue;
      results.push({
        ...prodDoc,
        _source: 'production',
      });
    }
  }

  return results;
}


// ── Greedy constraint-based auto-generation engine (Item 5 & Item 12) ──

function greedyGenerate(input = {}) {
  const constraints = input.constraints || {};
  const maxClassesPerDayPerTeacher = Number(constraints.maxClassesPerDayPerTeacher || input.maxClassesPerDayPerTeacher || 3);
  const noLabsPeriod1 = constraints.noLabsPeriod1 !== false && input.noLabsPeriod1 !== false;
  const avoidBackToBackLabs = constraints.avoidBackToBackLabs !== false && input.avoidBackToBackLabs !== false;
  const evenLoadDistribution = constraints.evenLoadDistribution !== false && input.evenLoadDistribution !== false;
  const teacherPreferences = constraints.teacherPreferences || input.teacherPreferences || {};

  let days = Array.isArray(input.workingDays) && input.workingDays.length
    ? [...input.workingDays]
    : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  // Add working Saturday if flagged by calendar or input
  if ((input.includeSaturday || input.calendarInfo?.hasWorkingSaturdays) && !days.includes('Saturday')) {
    days.push('Saturday');
  }

  const periods = Array.isArray(input.periods) && input.periods.length ? input.periods : [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const breakPeriods = new Set(Array.isArray(input.breakPeriods) && input.breakPeriods.length ? input.breakPeriods : [3, 6]);
  const occupied = new Set();
  const teacherDayLoad = new Map(); // key: `${day}:${teacher}` -> count
  const subjectDayLoad = new Map(); // key: `${day}:${subject}` -> count
  const labScheduledDays = new Map(); // key: day -> Array of occupied lab periods
  const grid = [];
  const conflicts = [];

  // Pre-seed occupied set from existingSlots if merging
  if (Array.isArray(input.existingSlots) && input.existingSlots.length) {
    input.existingSlots.forEach(s => {
      const span = Number(s.duration || s.span || 1);
      const pStart = typeof s.period === 'number' ? s.period : parseInt(String(s.period || '').replace(/\D/g, ''), 10) || 1;
      const day = s.day;
      const teacherKey = s.teacherId || s.teacher;
      const roomKey = s.room;
      const subject = s.subject;
      for (let i = 0; i < span; i++) {
        const p = pStart + i;
        const key = `${day}:${p}`;
        if (teacherKey) occupied.add(`${key}:teacher:${teacherKey}`);
        if (roomKey) occupied.add(`${key}:room:${roomKey}`);
        if (s.section) occupied.add(`${key}:section:${s.section}`);
      }
      if (s.teacher) teacherDayLoad.set(`${day}:${s.teacher}`, (teacherDayLoad.get(`${day}:${s.teacher}`) || 0) + span);
      if (subject) subjectDayLoad.set(`${day}:${subject}`, (subjectDayLoad.get(`${day}:${subject}`) || 0) + span);
      if (s.isLab || s.type === 'Lab') {
        const existingLabs = labScheduledDays.get(day) || [];
        for (let i = 0; i < span; i++) existingLabs.push(pStart + i);
        labScheduledDays.set(day, existingLabs);
      }
    });
  }

  // Helper: check teacher preferences
  const isTeacherAvailable = (teacherId, teacherName, day, period) => {
    const pref = teacherPreferences[teacherId] || teacherPreferences[teacherName] || teacherPreferences[(teacherName || '').toLowerCase()];
    if (!pref) return true;
    const unavailableSlots = pref.unavailableSlots || pref.unavailablePeriods || [];
    const slotKey = `${day}:${period}`;
    return !unavailableSlots.includes(slotKey);
  };

  (input.assignments || []).forEach(job => {
    const isLab = Boolean(job.isLab);
    const span = isLab ? Math.max(2, Math.min(4, Number(job.span || input.defaultLabDuration || 3))) : 1;
    const count = Math.max(1, Number(job.periodsPerWeek || job.hours || 1));
    const teacherId = String(job.staffId || '');
    const teacherName = job.staffName || 'TBA';
    const subjectName = job.subjectShortName || job.name || 'assignment';
    const sectionName = job.section || input.section || '';

    for (let n = 0; n < count; n += 1) {
      let chosen;

      // Sort candidate days by load to achieve even distribution
      let candidateDays = [...days];
      if (evenLoadDistribution) {
        candidateDays.sort((a, b) => {
          const loadA = subjectDayLoad.get(`${a}:${subjectName}`) || 0;
          const loadB = subjectDayLoad.get(`${b}:${subjectName}`) || 0;
          return loadA - loadB;
        });
      }

      for (const day of candidateDays) {
        // Teacher daily maximum constraint check
        const currentTeacherLoad = teacherDayLoad.get(`${day}:${teacherName}`) || 0;
        if (currentTeacherLoad + span > maxClassesPerDayPerTeacher) {
          continue;
        }

        // Avoid back-to-back labs for students constraint
        if (isLab && avoidBackToBackLabs) {
          const existingLabPeriods = labScheduledDays.get(day) || [];
          if (existingLabPeriods.length > 0) {
            // Already has a lab scheduled on this day, prefer another day first
            if (candidateDays.some(d => !(labScheduledDays.get(d) || []).length)) {
              continue;
            }
          }
        }

        for (const period of periods) {
          // Lab constraints
          if (isLab) {
            if (noLabsPeriod1 && period === 1) continue;
            if (period + span - 1 > periods[periods.length - 1]) continue;
            // Check breaks during continuous span
            let spansBreak = false;
            for (let s = 0; s < span; s++) {
              if (breakPeriods.has(period + s)) {
                spansBreak = true;
                break;
              }
            }
            if (spansBreak) continue;
          } else if (breakPeriods.has(period)) {
            continue;
          }

          // Check availability across the required span
          let slotFeasible = true;
          for (let s = 0; s < span; s++) {
            const checkP = period + s;
            const key = `${day}:${checkP}`;
            const teacherKey = `${key}:teacher:${teacherId || teacherName}`;
            const roomKey = `${key}:room:${job.room || 'TBA'}`;
            const sectionKey = sectionName ? `${key}:section:${sectionName}` : null;

            if (occupied.has(teacherKey) || occupied.has(roomKey) || (sectionKey && occupied.has(sectionKey)) || !isTeacherAvailable(teacherId, teacherName, day, checkP)) {
              slotFeasible = false;
              break;
            }
          }

          if (slotFeasible) {
            chosen = { day, period };
            break;
          }
        }
        if (chosen) break;
      }

      if (!chosen) {
        conflicts.push({
          kind: 'hard',
          subject: subjectName,
          teacher: teacherName,
          title: `No valid slot for ${subjectName} (${teacherName})`,
          detail: `Availability exhausted or constraint limit reached (${maxClassesPerDayPerTeacher} max/day for ${teacherName}).`,
          fix: 'Adjust teacher daily max constraint, clear unavailable slots, or reassign faculty/room.'
        });
        continue;
      }

      // Mark occupied for full span
      for (let s = 0; s < span; s++) {
        const p = chosen.period + s;
        const key = `${chosen.day}:${p}`;
        occupied.add(`${key}:teacher:${teacherId || teacherName}`);
        occupied.add(`${key}:room:${job.room || 'TBA'}`);
        if (sectionName) occupied.add(`${key}:section:${sectionName}`);
      }

      // Update counters
      teacherDayLoad.set(`${chosen.day}:${teacherName}`, (teacherDayLoad.get(`${chosen.day}:${teacherName}`) || 0) + span);
      subjectDayLoad.set(`${chosen.day}:${subjectName}`, (subjectDayLoad.get(`${chosen.day}:${subjectName}`) || 0) + span);

      if (isLab) {
        const existingLabs = labScheduledDays.get(chosen.day) || [];
        for (let s = 0; s < span; s++) existingLabs.push(chosen.period + s);
        labScheduledDays.set(chosen.day, existingLabs);
      }

      grid.push({
        ...chosen,
        assignmentId: job._id,
        subject: subjectName,
        teacher: teacherName,
        teacherId: job.staffId,
        room: job.room || 'Classroom',
        section: sectionName,
        isLab,
        span
      });
    }
  });

  return {
    grid,
    conflicts,
    status: 'draft',
    algorithm: 'greedy-constraint-v2',
    appliedConstraints: {
      maxClassesPerDayPerTeacher,
      noLabsPeriod1,
      avoidBackToBackLabs,
      evenLoadDistribution,
      workingDays: days
    }
  };
}


// ── Transactional publish helper ──

async function snapshotAndPublish(template, req, summary) {
  // Create version snapshot for audit trail
  await M.TimetableVersion.create({
    semesterTemplateId: template._id,
    snapshot: template.toObject(),
    publishedBy: req.user.name,
    publishedAt: new Date(),
    changeSummary: summary || 'Published from Development',
    label: `v${template.version}`
  });

  // Archive all other published templates for same class
  await M.SemesterTemplate.updateMany(
    { classId: template.classId, _id: { $ne: template._id }, status: 'published' },
    { $set: { status: 'archived' } }
  );

  // Update template status
  template.status = 'published';
  template.version += 1;
  template.publishedAt = new Date();
  template.publishedBy = req.user.name;

  // Also update the production SectionTimetable record
  const cls = await M.Class.findById(template.classId).lean();
  const slotsObj = gridToSlotsObj(template.grid || [], cls?.name || '');
  await M.SectionTimetable.findOneAndUpdate(
    { classId: template.classId },
    {
      slots: slotsObj,
      updatedBy: req.user.name,
      ...(cls ? { className: cls.name, deptId: cls.deptId, deptName: cls.deptName } : {})
    },
    { upsert: true }
  );

  return template.save();
}


// ── Server-side conflict detection ──

async function detectConflicts(slots, classId, ignoreId, env = 'development') {
  const conflicts = [];
  if (!Array.isArray(slots) || slots.length === 0) return conflicts;

  // Cross-check within the submitted batch
  for (let i = 0; i < slots.length; i++) {
    const a = slots[i];
    for (let j = i + 1; j < slots.length; j++) {
      const b = slots[j];
      if (a.day !== b.day) continue;
      const aEnd = a.period + (a.span || 1) - 1;
      const bEnd = b.period + (b.span || 1) - 1;
      if (a.period <= bEnd && b.period <= aEnd) {
        if (a.teacher && a.teacher === b.teacher) {
          conflicts.push({ kind: 'faculty', message: `✕ Faculty double-booked: ${a.teacher} on ${a.day} period ${a.period}` });
        }
        if (a.room && a.room === b.room) {
          conflicts.push({ kind: 'room', message: `Room conflict: ${a.room} is double-booked on ${a.day} period ${a.period}` });
        }
      }
    }
  }

  const targetStatuses = env === 'production'
    ? ['published']
    : ['draft', 'pending_approval', 'published'];

  // Cross-check against existing DB records (all classes — institution-wide)
  for (const slot of slots) {
    if (!slot.day || !slot.period) continue;
    const periodEnd = slot.period + (slot.span || 1) - 1;

    // Teacher conflict check across all classes
    if (slot.teacher) {
      const query = {
        _id: { $ne: ignoreId || null },
        status: { $in: targetStatuses },
        'grid.day': slot.day,
        'grid.teacher': slot.teacher,
        'grid.period': { $gte: slot.period, $lte: periodEnd }
      };
      if (classId) query.classId = { $ne: classId };

      const teacherConflict = await M.SemesterTemplate.findOne(query).lean();
      if (teacherConflict) {
        conflicts.push({
          kind: 'faculty',
          message: `✕ Faculty double-booked: ${slot.teacher} is already assigned on ${slot.day} period ${slot.period} in another class`
        });
      }
    }

    // Room conflict check across all classes
    if (slot.room || slot.roomId) {
      const roomMatchConditions = [];
      if (slot.roomId) roomMatchConditions.push({ 'grid.roomId': slot.roomId });
      if (slot.room) roomMatchConditions.push({ 'grid.room': slot.room });

      const query = {
        _id: { $ne: ignoreId || null },
        status: { $in: targetStatuses },
        'grid.day': slot.day,
        $or: roomMatchConditions,
        'grid.period': { $gte: slot.period, $lte: periodEnd }
      };
      if (classId) query.classId = { $ne: classId };

      const roomConflict = await M.SemesterTemplate.findOne(query).lean();
      if (roomConflict) {
        conflicts.push({
          kind: 'room',
          message: `Room conflict: ${slot.room || 'Room'} is already occupied on ${slot.day} period ${slot.period} in another class`
        });
      }

      // Room capacity vs. class enrollment check & room status check
      const roomDoc = await M.Room.findOne({
        $or: [
          ...(slot.roomId ? [{ _id: slot.roomId }] : []),
          ...(slot.room ? [{ hallNo: slot.room }, { name: slot.room }] : [])
        ]
      }).lean();

      if (roomDoc) {
        if (!slot.roomId) slot.roomId = roomDoc._id;

        if (['Maintenance', 'Inactive', 'Temporarily Unavailable'].includes(roomDoc.status)) {
          conflicts.push({
            kind: 'room_unavailable',
            message: `Room "${roomDoc.hallNo || slot.room}" is currently unavailable (${roomDoc.status})`
          });
        }

        if (classId) {
          const studentCount = await M.Student.countDocuments({ classId });
          if (roomDoc.capacity && studentCount > roomDoc.capacity) {
            conflicts.push({
              kind: 'capacity',
              message: `Capacity warning: Room "${roomDoc.hallNo || slot.room}" capacity (${roomDoc.capacity}) is less than enrolled class size (${studentCount} students)`
            });
          }
        }
      }
    }
  }

  return conflicts;
}


// ══════════════════════════════════════════════════════
//  PUBLIC SMART BOARD HARDWARE & KIOSK ENDPOINTS
// ══════════════════════════════════════════════════════

// POST /boards/auth/handshake — Public authentication handshake for Smart Board devices/kiosks
router.post('/boards/auth/handshake', async (req, res) => {
  try {
    const { deviceId, boardApiKey, clientInfo, telemetry } = req.body;
    if (!deviceId || !boardApiKey) {
      return res.status(400).json({ error: 'Device ID and Board API Key are required for handshake.' });
    }
    const cleanDeviceId = deviceId.trim().toUpperCase();
    const board = await M.SmartBoard.findOne({ deviceId: cleanDeviceId, boardApiKey: boardApiKey.trim() })
      .populate('buildingId')
      .populate('roomId');

    let ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
    if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
    if (typeof ip === 'string' && ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
    if (ip === '::1') ip = '127.0.0.1';
    const ipType = ip.includes(':') ? 'IPv6' : 'IPv4';

    if (!board) {
      try {
        await logAction(
          'SYSTEM', 'Smart Board Gateway', 'system',
          'Unauthorized Board Handshake',
          `Rejected handshake for device "${cleanDeviceId}" from IP ${ip}`,
          'security', 'warn', ip, 'HANDSHAKE',
          { deviceId: cleanDeviceId, ip }
        );
      } catch (e) { /* ignore */ }
      return res.status(401).json({ error: 'Invalid device credentials. Unauthorized board.' });
    }

    const now = new Date();
    const previousIp = board.currentIp;
    const ipChanged = previousIp && previousIp !== ip;

    board.connectionStatus = 'Connected';
    board.networkStatus = 'online';
    board.currentIp = ip;
    board.ipType = ipType;
    board.lastConnectedAt = now;
    board.lastSeenAt = now;
    board.lastHeartbeatAt = now;
    if (telemetry) board.telemetry = { ...board.telemetry, ...telemetry };

    if (ipChanged || !board.ipHistory.length) {
      board.ipHistory.unshift({
        ip,
        ipType,
        detectedAt: now,
        userAgent: req.headers['user-agent'] || 'EAMS-Board-Handshake'
      });
      if (board.ipHistory.length > 20) board.ipHistory = board.ipHistory.slice(0, 20);
    }

    await board.save();

    // Sign temporary Board Session Token
    const sessionToken = jwt.sign(
      {
        role: 'board',
        boardId: board._id,
        deviceId: board.deviceId,
        roomId: board.roomId?._id
      },
      cfg.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Resolve timetable context
    const context = await resolveRoomTimetableContext(board.roomId?._id);

    broadcastToMonitors('board:connected', {
      deviceId: board.deviceId,
      boardId: board._id,
      boardName: board.boardName,
      roomId: board.roomId?._id,
      ip,
      ipType,
      connectedAt: now.toISOString()
    });

    res.json({
      ok: true,
      token: sessionToken,
      board: {
        id: board._id,
        deviceId: board.deviceId,
        boardName: board.boardName,
        currentIp: ip,
        ipType,
        roomId: board.roomId?._id,
        roomHallNo: board.roomId?.hallNo,
        buildingName: board.buildingId?.name
      },
      context
    });
  } catch (err) {
    res.status(500).json({ error: 'Handshake failed: ' + err.message });
  }
});

// GET /boards/:id/context — Real-time room and timetable slot context
router.get('/boards/:id/context', async (req, res) => {
  try {
    let board = null;
    if (mongoose.isValidObjectId(req.params.id)) {
      board = await M.SmartBoard.findById(req.params.id);
    }
    if (!board) {
      board = await M.SmartBoard.findOne({ deviceId: req.params.id.toUpperCase() });
    }
    if (!board) return res.status(404).json({ error: 'Smart board not found' });
    if (!board.roomId) {
      return res.json({
        ok: true,
        context: {
          state: 'unassigned',
          room: null,
          message: 'Smart board is currently unassigned / standby.'
        }
      });
    }

    const context = await resolveRoomTimetableContext(board.roomId, req.query.time);
    res.json({ ok: true, context });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve board context: ' + err.message });
  }
});

// GET /boards/pairing-code — Get or generate 6-digit pairing code for an unlinked board
router.get('/boards/pairing-code', async (req, res) => {
  try {
    const deviceId = (req.query.device || req.query.deviceId || '').trim().toUpperCase();
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required.' });
    }

    let board = await M.SmartBoard.findOne({ deviceId });
    if (!board) {
      board = await M.SmartBoard.create({
        boardName: `Smart Board (${deviceId})`,
        deviceId,
        status: 'Active',
        connectionStatus: 'Disconnected'
      });
    }

    // If board is already linked to a room, do NOT show a pairing code ("only unlinked boards")
    if (board.roomId) {
      const room = await M.Room.findById(board.roomId).populate('buildingId').lean();
      return res.json({
        ok: true,
        linked: true,
        roomId: board.roomId,
        roomHallNo: room?.hallNo || '',
        roomName: room?.name || '',
        buildingName: room?.buildingName || room?.buildingId?.name || ''
      });
    }

    // Unlinked board: Check if current pairing code is still valid (5 mins TTL, static while valid)
    const now = new Date();
    let code = board.pairingCode;
    let expiresAt = board.pairingCodeExpiresAt;

    if (!code || !expiresAt || new Date(expiresAt) <= now) {
      code = Math.floor(100000 + Math.random() * 900000).toString();
      expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      board.pairingCode = code;
      board.pairingCodeExpiresAt = expiresAt;
      await board.save();
    }

    res.json({
      ok: true,
      linked: false,
      deviceId: board.deviceId,
      pairingCode: code,
      expiresAt
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate pairing code: ' + err.message });
  }
});

// ══════════════════════════════════════════════════════
//  ALL ROUTES BELOW REQUIRE USER AUTHENTICATION
// ══════════════════════════════════════════════════════

router.use(authMiddleware);


// ── Master data endpoint (departments, classes, subjects, teachers, rooms) ──

router.get('/master-data', requireManager, async (req, res) => {
  try {
    const [departments, classes, subjects, teachers, rooms, studentCounts, currentYear] = await Promise.all([
      M.Department.find().sort({ name: 1 }).lean(),
      M.Class.find().sort({ name: 1 }).lean(),
      M.Subject.find().sort({ name: 1 }).lean(),
      M.Teacher.find().select('-password').sort({ fullName: 1 }).lean(),
      M.Room.find({ status: { $ne: 'Inactive' } }).populate('buildingId').sort({ hallNo: 1, name: 1 }).lean(),
      M.Student.aggregate([
        { $match: { classId: { $ne: null } } },
        { $group: { _id: '$classId', count: { $sum: 1 } } }
      ]),
      M.Year.findOne({ isCurrent: true }).lean()
    ]);
    const countMap = new Map(studentCounts.map(c => [String(c._id), c.count]));
    const classesWithCount = classes.map(c => ({
      ...c,
      studentCount: countMap.get(String(c._id)) || 0
    }));
    const enrichedRooms = rooms.map(r => ({
      ...r,
      name: r.hallNo ? (r.name && r.name !== r.hallNo ? `${r.hallNo} - ${r.name}` : r.hallNo) : r.name
    }));
    let regulations = currentYear?.regulations || [];
    if (!regulations.length) {
      const anyYearWithRegs = await M.Year.findOne({ 'regulations.0': { $exists: true } }).lean();
      regulations = anyYearWithRegs?.regulations || [
        { code: '2021', name: 'Regulation 2021', year: '2021', isDefault: false },
        { code: '2025', name: 'Regulation 2025', year: '2025', isDefault: true }
      ];
    }
    res.json({ departments, classes: classesWithCount, subjects, teachers, rooms: enrichedRooms, regulations });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load master data: ' + err.message });
  }
});


// ── Core timetable CRUD ──

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.teacherId) filter.teacherId = sanitizeToString(req.query.teacherId);
    else if (req.user.role === 'teacher' && !canManage(req)) filter.teacherId = req.user._id;
    res.json(await M.Timetable.find(filter).sort({ day: 1, start: 1 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireManager, async (req, res) => {
  try {
    // trackId is required by the schema but the teacher portal never had it
    // client-side (sent undefined → every create failed validation). Stamp it
    // from the authenticated user, like teacherName.
    const slot = await M.Timetable.create({
      ...req.body,
      trackId: req.user.trackId,
      teacherId: req.user._id,
      teacherName: req.user.name
    });
    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Timetable Slot Added',
      `${req.body.day} ${req.body.start} - ${req.body.subjectName || ''}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'entry-create', changes: { before: null, after: slot.toObject() } }
    );
    res.status(201).json(slot);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', requireManager, async (req, res) => {
  try {
    const before = await M.Timetable.findById(req.params.id).lean();
    const slot = await M.Timetable.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' });
    if (!slot) return res.status(404).json({ error: 'Timetable slot not found' });
    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Timetable Slot Updated',
      `${slot.day} ${slot.start}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'field-edit', changes: { before, after: slot.toObject() } }
    );
    res.json(slot);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', requireManager, async (req, res) => {
  try {
    const before = await M.Timetable.findById(req.params.id).lean();
    if (!before) return res.status(404).json({ error: 'Timetable slot not found' });
    await M.Timetable.findByIdAndDelete(req.params.id);
    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Timetable Slot Deleted',
      `${before.day} ${before.start} - ${before.subjectName || ''}`,
      'data', 'warn', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'entry-delete', changes: { before, after: null } }
    );
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Slot source aggregator (unified multi-class source for env-aware views) ──

router.get('/slot-source', requireDevAccess, async (req, res) => {
  try {
    const env = sanitizeToString(req.query.env || 'production').toLowerCase();
    const deptId = req.query.deptId ? sanitizeToObjectId(req.query.deptId) : null;
    const classId = req.query.classId ? sanitizeToObjectId(req.query.classId) : null;

    const slots = await getSlotSource(env, classId, deptId);
    res.json({ ok: true, env, count: slots.length, data: slots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Section timetable (production & development view) ──

router.get('/section/:classId', requireDevAccess, async (req, res) => {
  try {
    const classId = sanitizeToObjectId(req.params.classId);
    if (!classId) return res.status(400).json({ error: 'Invalid classId' });
    const env = sanitizeToString(req.query.env || 'production').toLowerCase();

    if (env === 'development') {
      const academicYears = await getActiveAcademicYears();
      const devTemplate = await getActiveDevTemplate(classId, academicYears);

      if (devTemplate) {
        const cls = await M.Class.findById(classId).lean();
        const className = devTemplate.className || cls?.name || '';
        return res.json({
          ok: true,
          classId,
          className,
          deptId: cls?.deptId || null,
          deptName: cls?.deptName || '',
          slots: gridToSlotsObj(devTemplate.grid || [], className),
          _source: 'development',
          _templateId: devTemplate._id,
          _templateStatus: devTemplate.status,
          _templateUpdatedAt: devTemplate.updatedAt,
        });
      }

      // No dev template — return production fallback with _source: 'production'
      const prod = await M.SectionTimetable.findOne({ classId }).lean();
      return res.json({
        ok: true,
        classId,
        className: prod?.className || '',
        deptId: prod?.deptId || null,
        deptName: prod?.deptName || '',
        slots: prod?.slots || {},
        _source: 'production',
        _templateId: null,
        _templateStatus: null,
        _templateUpdatedAt: null,
      });
    }

    // Production mode
    const section = await M.SectionTimetable.findOne({ classId }).lean();
    res.json(section || { classId, slots: {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/section/:classId/slot', requireManager, async (req, res) => {
  try {
    // Gate check: exempt Admins and HODs (since they are approvers)
    const isExempt = req.user.role === 'admin' || req.user.isHod === true;
    if (!isExempt) {
      const modelsSetting = await M.Settings.findOne({ key: 'models' }).lean();
      const requireApproval = modelsSetting?.value?.requireHodApproval !== false;
      if (requireApproval) {
        return res.status(403).json({
          error: 'Direct live publishing is disabled. Timetable changes must be submitted for HOD approval.'
        });
      }
    }

    const classId = sanitizeToObjectId(req.params.classId);
    if (!classId) return res.status(400).json({ error: 'Invalid classId' });
    const { slotKey, payload } = req.body;
    if (!slotKey) return res.status(400).json({ error: 'slotKey is required' });

    const cls = await M.Class.findById(classId).lean();
    const update = payload
      ? { $set: { [`slots.${slotKey}`]: payload }, updatedBy: req.user.name }
      : { $unset: { [`slots.${slotKey}`]: '' }, updatedBy: req.user.name };
    if (cls) update.$setOnInsert = { className: cls.name, deptId: cls.deptId, deptName: cls.deptName };

    const result = await M.SectionTimetable.findOneAndUpdate({ classId }, update, { upsert: true, returnDocument: 'after' });
    invalidateProductionCache();

    // Snapshot in Version History for audit transparency
    const lastProd = await M.TimetableVersion.findOne({ classId, type: 'production' }).sort({ version: -1 }).lean();
    const nextVer = (lastProd?.version || 0) + 1;
    const slotsArr = Object.values(result?.slots || {});
    await M.TimetableVersion.create({
      classId,
      className: cls?.name || 'General',
      type: 'production',
      version: nextVer,
      versionName: `Production v${nextVer}`,
      label: `Production v${nextVer} (Slot Update)`,
      changeSummary: `Direct slot update (${slotKey}) via API`,
      snapshot: { classId, className: cls?.name || 'General', slots: slotsArr },
      status: 'published',
      publishedBy: req.user.name,
      publishedAt: new Date()
    });

    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Section Slot Updated', `${slotKey} for ${cls?.name || classId}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'field-edit' }
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/section/:classId', requireManager, async (req, res) => {
  try {
    // Gate check: exempt Admins and HODs (since they are approvers)
    const isExempt = req.user.role === 'admin' || req.user.isHod === true;
    if (!isExempt) {
      const modelsSetting = await M.Settings.findOne({ key: 'models' }).lean();
      const requireApproval = modelsSetting?.value?.requireHodApproval !== false;
      if (requireApproval) {
        return res.status(403).json({
          error: 'Direct live publishing is disabled. Timetable changes must be submitted for HOD approval.'
        });
      }
    }

    const classId = sanitizeToObjectId(req.params.classId);
    if (!classId) return res.status(400).json({ error: 'Invalid classId' });
    if (!req.body || typeof req.body.slots !== 'object') {
      return res.status(400).json({ error: 'slots object is required' });
    }
    const cls = await M.Class.findById(classId).lean();
    const update = { slots: req.body.slots, updatedBy: req.user.name };
    if (cls) update.$setOnInsert = { className: cls.name, deptId: cls.deptId, deptName: cls.deptName };

    const result = await M.SectionTimetable.findOneAndUpdate({ classId }, update, { upsert: true, returnDocument: 'after' });
    invalidateProductionCache();

    // Snapshot in Version History for audit transparency
    const lastProd = await M.TimetableVersion.findOne({ classId, type: 'production' }).sort({ version: -1 }).lean();
    const nextVer = (lastProd?.version || 0) + 1;
    const slotsArr = Object.values(result?.slots || {});
    await M.TimetableVersion.create({
      classId,
      className: cls?.name || 'General',
      type: 'production',
      version: nextVer,
      versionName: `Production v${nextVer}`,
      label: `Production v${nextVer} (Bulk Update)`,
      changeSummary: `Direct section bulk update via API (${slotsArr.length} slots)`,
      snapshot: { classId, className: cls?.name || 'General', slots: slotsArr },
      status: 'published',
      publishedBy: req.user.name,
      publishedAt: new Date()
    });

    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Section Timetable Updated', `Bulk update for ${cls?.name || classId}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'field-edit' }
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ── Conflict detection & auto-generation ──

router.post('/check-conflicts', requireManager, requireDevAccess, async (req, res) => {
  try {
    const { slots, ignoreId, classId, env } = req.body;
    const resolvedEnv = sanitizeToString(env || req.query.env || 'development').toLowerCase();
    const conflicts = await detectConflicts(slots || [], classId, ignoreId, resolvedEnv);
    res.json({ conflicts, valid: conflicts.length === 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/auto-gen', requireManager, async (req, res) => {
  try {
    // Check academic calendar for working Saturdays and holidays (Item 12)
    const calendarDays = await M.CalendarDay.find({
      date: { $gte: new Date(Date.now() - 30 * 86400000), $lte: new Date(Date.now() + 120 * 86400000) }
    }).lean();

    const workingSaturdays = calendarDays.filter(cd => cd.day === 'Saturday' && cd.details?.some(d => d.dayType === 'working'));
    const holidays = calendarDays.filter(cd => cd.details?.some(d => ['holiday', 'vacation', 'exam'].includes(d.dayType)));

    let assignments = Array.isArray(req.body.assignments) && req.body.assignments.length ? req.body.assignments : [];

    // If assignments not provided, fetch from CurriculumAssignment or Assignment model
    if (!assignments.length && (req.body.classId || req.body.section)) {
      let classObj = null;
      if (req.body.classId && mongoose.isValidObjectId(req.body.classId)) {
        classObj = await M.Class.findById(req.body.classId).lean();
      } else if (req.body.section) {
        classObj = await M.Class.findOne({ name: req.body.section }).lean();
      }
      const targetClassId = classObj ? classObj._id : req.body.classId;

      if (targetClassId) {
        const currAssignments = await M.CurriculumAssignment.find({ classId: targetClassId }).lean();
        if (currAssignments.length) {
          assignments = currAssignments.map(a => ({
            _id: a._id,
            subjectShortName: a.subjectShortName || a.name || 'Subject',
            name: a.subjectShortName || a.name || 'Subject',
            staffId: a.staffId,
            staffName: a.staffName || 'Faculty',
            periodsPerWeek: a.periodsPerWeek || 4,
            isLab: (a.subjectShortName || '').toLowerCase().includes('lab') || Boolean(a.isLab),
            room: a.roomPreference || 'Classroom',
            section: classObj ? classObj.name : req.body.section
          }));
        } else {
          const legacy = await M.Assignment.find({
            $or: [
              { classId: String(targetClassId) },
              ...(classObj ? [{ className: classObj.name }] : [])
            ]
          }).lean();
          if (legacy.length) {
            assignments = legacy.map(a => ({
              _id: a._id,
              subjectShortName: a.subjectName || 'Subject',
              name: a.subjectName || 'Subject',
              staffId: a.teacherId,
              staffName: a.teacherName || 'Faculty',
              periodsPerWeek: 4,
              isLab: (a.subjectName || '').toLowerCase().includes('lab'),
              room: a.hallNo || 'Classroom',
              section: classObj ? classObj.name : req.body.section
            }));
          }
        }
      }
    }

    // Dynamic fallback to master subjects and teachers if database has no explicit mappings yet
    if (!assignments.length) {
      const [subjects, teachers, rooms] = await Promise.all([
        M.Subject.find().limit(8).lean(),
        M.Teacher.find().select('fullName name username').limit(8).lean(),
        M.Room.find({ status: { $ne: 'Inactive' } }).limit(5).lean()
      ]);

      if (subjects.length && teachers.length) {
        assignments = subjects.map((s, idx) => {
          const teacher = teachers[idx % teachers.length];
          const room = rooms[idx % rooms.length];
          const isLab = (s.name || '').toLowerCase().includes('lab') || (s.code || '').toLowerCase().includes('l');
          return {
            _id: s._id,
            subjectShortName: s.code || s.name,
            name: s.name,
            staffId: teacher._id,
            staffName: teacher.fullName || teacher.name || teacher.username,
            periodsPerWeek: isLab ? 3 : 4,
            isLab,
            span: isLab ? 3 : 1,
            room: room ? (room.hallNo || room.name) : 'Classroom',
            section: req.body.section || ''
          };
        });
      }
    }

    const input = {
      ...req.body,
      assignments,
      calendarInfo: {
        hasWorkingSaturdays: workingSaturdays.length > 0,
        holidayDates: holidays.map(h => h.date)
      }
    };

    const result = greedyGenerate(input);
    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Timetable Auto-Generated',
      `${result.grid.length} slots placed, ${result.conflicts.length} conflicts`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'action' }
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Timing sets ──

router.get('/timing-sets', async (req, res) => {
  try {
    if (!await M.TimingSet.countDocuments()) {
      await M.TimingSet.insertMany(TIMING_SEED);
    }
    res.json(await M.TimingSet.find().sort({ name: 1 }).lean());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ══════════════════════════════════════════════════════
//  CAMPUS FACILITIES: BUILDINGS (Phases 1B & 1D)
// ══════════════════════════════════════════════════════

// GET /buildings — List all buildings with aggregated room, lab, and board metrics
router.get('/buildings', async (req, res) => {
  try {
    const [buildings, roomStats, boardStats] = await Promise.all([
      M.Building.find().sort({ name: 1 }).lean(),
      M.Room.aggregate([
        {
          $group: {
            _id: '$buildingId',
            roomCount: { $sum: 1 },
            activeRoomCount: { $sum: { $cond: [{ $ne: ['$status', 'Inactive'] }, 1, 0] } },
            classRoomCount: { $sum: { $cond: [{ $or: [{ $eq: ['$category', 'Room'] }, { $and: [{ $ne: ['$category', 'Lab'] }, { $ne: ['$category', 'Hall'] }, { $ne: ['$type', 'Lab'] }, { $ne: ['$type', 'Seminar'] }] }] }, 1, 0] } },
            labCount: { $sum: { $cond: [{ $or: [{ $eq: ['$type', 'Lab'] }, { $eq: ['$category', 'Lab'] }] }, 1, 0] } },
            hallCount: { $sum: { $cond: [{ $or: [{ $eq: ['$type', 'Seminar'] }, { $eq: ['$category', 'Hall'] }] }, 1, 0] } },
            totalSeats: { $sum: '$capacity' }
          }
        }
      ]),
      M.SmartBoard.aggregate([
        {
          $group: {
            _id: '$buildingId',
            boardCount: { $sum: 1 },
            activeBoardCount: { $sum: { $cond: [{ $eq: ['$status', 'Active'] }, 1, 0] } }
          }
        }
      ])
    ]);

    const roomMap = new Map(roomStats.map(s => [String(s._id), s]));
    const boardMap = new Map(boardStats.map(b => [String(b._id), b]));

    const enriched = buildings.map(b => {
      const rs = roomMap.get(String(b._id)) || {};
      const bs = boardMap.get(String(b._id)) || {};
      return {
        ...b,
        roomCount: rs.roomCount || 0,
        activeRoomCount: rs.activeRoomCount || 0,
        classRoomCount: rs.classRoomCount || 0,
        labCount: rs.labCount || 0,
        hallCount: rs.hallCount || 0,
        totalSeats: rs.totalSeats || 0,
        boardCount: bs.boardCount || 0,
        activeBoardCount: bs.activeBoardCount || 0
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch buildings: ' + err.message });
  }
});

// GET /buildings/:id — Get single building with floor-wise rooms and boards
router.get('/buildings/:id', async (req, res) => {
  try {
    const building = await M.Building.findById(req.params.id).lean();
    if (!building) return res.status(404).json({ error: 'Building not found' });

    const [rooms, boards] = await Promise.all([
      M.Room.find({ buildingId: building._id }).sort({ floor: 1, hallNo: 1 }).lean(),
      M.SmartBoard.find({ buildingId: building._id }).lean()
    ]);

    const floorsGroup = {};
    for (let f = 0; f <= (building.floors || 1); f++) {
      floorsGroup[f] = [];
    }
    rooms.forEach(r => {
      const fl = r.floor !== undefined ? r.floor : 0;
      if (!floorsGroup[fl]) floorsGroup[fl] = [];
      floorsGroup[fl].push(r);
    });

    res.json({
      ok: true,
      data: {
        ...building,
        rooms,
        floorsGroup,
        boards,
        totalRooms: rooms.length,
        totalSeats: rooms.reduce((acc, r) => acc + (r.capacity || 0), 0)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch building details: ' + err.message });
  }
});

// POST /buildings — Create building with unique code validation and audit logging
router.post('/buildings', requireManager, async (req, res) => {
  try {
    const { name, subName, code, type, campus, floors, ip, status, latitude, longitude } = req.body;
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Building name is required (minimum 2 characters).' });
    }
    if (!code || code.trim().length < 2) {
      return res.status(400).json({ error: 'Building code is required (minimum 2 characters).' });
    }

    const cleanCode = code.trim().toUpperCase();
    const cleanCampus = campus?.trim() || 'Main Campus';

    const existing = await M.Building.findOne({
      code: cleanCode,
      campus: cleanCampus
    }).lean();
    if (existing) {
      return res.status(400).json({
        error: `Building code "${cleanCode}" already exists on campus "${cleanCampus}".`
      });
    }

    const validFloors = Math.max(1, Math.min(50, parseInt(floors, 10) || 1));
    const lat = latitude !== undefined && latitude !== '' ? Number(latitude) : undefined;
    const lng = longitude !== undefined && longitude !== '' ? Number(longitude) : undefined;

    if (lat !== undefined && (isNaN(lat) || lat < -90 || lat > 90)) {
      return res.status(400).json({ error: 'Latitude must be between -90 and 90 degrees.' });
    }
    if (lng !== undefined && (isNaN(lng) || lng < -180 || lng > 180)) {
      return res.status(400).json({ error: 'Longitude must be between -180 and 180 degrees.' });
    }

    const building = await M.Building.create({
      name: name.trim(),
      subName: subName?.trim() || '',
      code: cleanCode,
      type: type || 'Academic',
      campus: cleanCampus,
      floors: validFloors,
      ip: ip?.trim() || '',
      status: status || 'Active',
      latitude: lat,
      longitude: lng
    });

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Building Created', `${building.name} (${building.code})`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'building-create',
        entityId: building._id,
        entityType: 'Building',
        after: building.toObject()
      }
    );

    res.status(201).json({ ok: true, data: building, ...building.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /buildings/:id — Update building with before/after audit and code integrity check
router.put('/buildings/:id', requireManager, async (req, res) => {
  try {
    const building = await M.Building.findById(req.params.id);
    if (!building) return res.status(404).json({ error: 'Building not found' });

    const before = building.toObject();
    const { name, subName, code, type, campus, floors, ip, status, latitude, longitude } = req.body;

    if (name) building.name = name.trim();
    if (subName !== undefined) building.subName = subName.trim();
    if (ip !== undefined) building.ip = ip.trim();
    if (type) building.type = type;
    if (campus) building.campus = campus.trim();
    if (floors !== undefined) building.floors = Math.max(1, Math.min(50, parseInt(floors, 10) || 1));

    if (code) {
      const cleanCode = code.trim().toUpperCase();
      if (cleanCode !== building.code) {
        const existing = await M.Building.findOne({
          _id: { $ne: building._id },
          code: cleanCode,
          campus: building.campus
        }).lean();
        if (existing) {
          return res.status(400).json({
            error: `Building code "${cleanCode}" already exists on campus "${building.campus}".`
          });
        }
        building.code = cleanCode;
      }
    }

    if (status && status !== building.status) {
      if (status === 'Inactive') {
        const activeRoomsCount = await M.Room.countDocuments({
          buildingId: building._id,
          status: { $in: ['Available', 'Reserved'] }
        });
        if (activeRoomsCount > 0) {
          return res.status(400).json({
            error: `Cannot deactivate building: ${activeRoomsCount} room(s) are currently Active/Available. Deactivate or reassign rooms first.`,
            activeRoomsCount
          });
        }
      }
      building.status = status;
    }

    if (latitude !== undefined) {
      const lat = latitude === '' ? undefined : Number(latitude);
      if (lat !== undefined && (isNaN(lat) || lat < -90 || lat > 90)) {
        return res.status(400).json({ error: 'Latitude must be between -90 and 90 degrees.' });
      }
      building.latitude = lat;
    }
    if (longitude !== undefined) {
      const lng = longitude === '' ? undefined : Number(longitude);
      if (lng !== undefined && (isNaN(lng) || lng < -180 || lng > 180)) {
        return res.status(400).json({ error: 'Longitude must be between -180 and 180 degrees.' });
      }
      building.longitude = lng;
    }

    await building.save();

    // Propagate building name changes to rooms
    if (name && name.trim() !== before.name) {
      await M.Room.updateMany({ buildingId: building._id }, { $set: { buildingName: building.name } });
    }

    const after = building.toObject();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Building Updated', `${building.name} (${building.code})`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'building-update',
        entityId: building._id,
        entityType: 'Building',
        before,
        after
      }
    );

    res.json({ ok: true, data: building, ...building.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /buildings/:id/status — Quick toggle status
router.patch('/buildings/:id/status', requireManager, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Active', 'Inactive'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'Active' or 'Inactive'." });
    }

    const building = await M.Building.findById(req.params.id);
    if (!building) return res.status(404).json({ error: 'Building not found' });

    if (status === 'Inactive') {
      const activeRoomsCount = await M.Room.countDocuments({
        buildingId: building._id,
        status: { $in: ['Available', 'Reserved'] }
      });
      if (activeRoomsCount > 0) {
        return res.status(400).json({
          error: `Cannot deactivate building: ${activeRoomsCount} room(s) are active.`,
          activeRoomsCount
        });
      }
    }

    const oldStatus = building.status;
    building.status = status;
    await building.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      status === 'Inactive' ? 'Building Deactivated' : 'Building Activated',
      `${building.name} (${building.code})`,
      'data', status === 'Inactive' ? 'warn' : 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'building-status',
        entityId: building._id,
        entityType: 'Building',
        before: { status: oldStatus },
        after: { status }
      }
    );

    res.json({ ok: true, data: building, ...building.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /buildings/:id — Delete building with room check
router.delete('/buildings/:id', requireManager, async (req, res) => {
  try {
    const building = await M.Building.findById(req.params.id);
    if (!building) return res.status(404).json({ error: 'Building not found' });

    const roomCount = await M.Room.countDocuments({ buildingId: building._id });
    if (roomCount > 0) {
      return res.status(400).json({
        error: `Cannot delete building "${building.name}": it contains ${roomCount} linked room(s). Reassign or delete rooms first.`,
        affectedRooms: roomCount
      });
    }

    await M.Building.findByIdAndDelete(building._id);

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Building Deleted', `${building.name} (${building.code})`,
      'data', 'warn', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'building-delete',
        entityId: building._id,
        entityType: 'Building',
        before: building.toObject()
      }
    );

    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete building: ' + err.message });
  }
});

// DELETE /buildings/:id/floors/:floorNum — Delete a floor and all its rooms
router.delete('/buildings/:id/floors/:floorNum', requireManager, async (req, res) => {
  try {
    const building = await M.Building.findById(req.params.id);
    if (!building) return res.status(404).json({ error: 'Building not found' });

    const floorNum = parseInt(req.params.floorNum, 10);
    if (isNaN(floorNum) || floorNum < 0) {
      return res.status(400).json({ error: 'Invalid floor number' });
    }

    // Find and delete all rooms on this floor
    const roomsOnFloor = await M.Room.find({ buildingId: building._id, floor: floorNum });
    const roomIds = roomsOnFloor.map(r => r._id);

    // Unlink any boards assigned to these rooms
    if (roomIds.length > 0) {
      await M.SmartBoard.updateMany(
        { roomId: { $in: roomIds } },
        { $set: { roomId: null, connectionStatus: 'Disconnected' } }
      );
      await M.Room.deleteMany({ _id: { $in: roomIds } });
    }

    // Adjust building floors count if this was the highest floor
    if (floorNum >= (building.floors || 1)) {
      const remainingRooms = await M.Room.find({ buildingId: building._id }).select('floor').lean();
      const maxRemainingFloor = remainingRooms.reduce((max, r) => Math.max(max, r.floor || 0), 0);
      building.floors = Math.max(1, maxRemainingFloor);
      await building.save();
    }

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Floor Deleted', `Floor ${floorNum} (${roomsOnFloor.length} rooms) of ${building.name}`,
      'facilities', 'warning', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'floor-delete',
        buildingId: building._id,
        floorNum,
        deletedRoomsCount: roomsOnFloor.length
      }
    );

    res.json({
      ok: true,
      message: `Floor ${floorNum} deleted successfully (${roomsOnFloor.length} rooms removed).`,
      building
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete floor: ' + err.message });
  }
});

// ══════════════════════════════════════════════════════
//  CAMPUS FACILITIES: ROOMS & CAPACITY (Phases 1C & 1D)
// ══════════════════════════════════════════════════════

// Helper: Determine runtime occupied status from published semester templates
async function resolveOccupiedRooms() {
  try {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const now = new Date();
    const currentDay = dayNames[now.getDay()];

    const templates = await M.SemesterTemplate.find({
      status: 'published',
      'grid.day': currentDay
    }).lean();

    const occupiedRoomIds = new Set();
    const occupiedRoomNames = new Set();

    templates.forEach(t => {
      (t.grid || []).forEach(slot => {
        if (slot.day === currentDay) {
          if (slot.roomId) occupiedRoomIds.add(String(slot.roomId));
          if (slot.room) occupiedRoomNames.add(slot.room.toLowerCase().trim());
        }
      });
    });

    return { occupiedRoomIds, occupiedRoomNames };
  } catch (_) {
    return { occupiedRoomIds: new Set(), occupiedRoomNames: new Set() };
  }
}

// GET /rooms — List rooms with filters, populated building/dept, board info, and derived occupied status
router.get('/rooms', async (req, res) => {
  try {
    const filter = {};
    if (req.query.buildingId) filter.buildingId = sanitizeToObjectId(req.query.buildingId);
    if (req.query.category && req.query.category !== 'all') filter.category = sanitizeToString(req.query.category);
    if (req.query.type && req.query.type !== 'all') filter.type = sanitizeToString(req.query.type);
    if (req.query.floor !== undefined && req.query.floor !== '') filter.floor = parseInt(req.query.floor, 10);
    if (req.query.status && req.query.status !== 'all') filter.status = sanitizeToString(req.query.status);
    if (req.query.deptId) filter.deptId = sanitizeToObjectId(req.query.deptId);

    if (req.query.search) {
      const q = escapeRegex(sanitizeToString(req.query.search).trim());
      filter.$or = [
        { hallNo: { $regex: q, $options: 'i' } },
        { name: { $regex: q, $options: 'i' } },
        { buildingName: { $regex: q, $options: 'i' } },
        { deptName: { $regex: q, $options: 'i' } }
      ];
    }

    const [rooms, boards, { occupiedRoomIds, occupiedRoomNames }] = await Promise.all([
      M.Room.find(filter).populate('buildingId').populate('deptId').sort({ buildingName: 1, floor: 1, hallNo: 1 }).lean(),
      M.SmartBoard.find({ roomId: { $ne: null } }).lean(),
      resolveOccupiedRooms()
    ]);

    const boardMap = new Map();
    boards.forEach(b => {
      if (b.roomId) boardMap.set(String(b.roomId), b);
    });

    const enriched = rooms.map(r => {
      const assignedBoard = boardMap.get(String(r._id)) || null;
      const isOccupied = occupiedRoomIds.has(String(r._id)) ||
        (r.hallNo && occupiedRoomNames.has(r.hallNo.toLowerCase().trim())) ||
        (r.name && occupiedRoomNames.has(r.name.toLowerCase().trim()));

      const derivedStatus = (r.status === 'Available' && isOccupied) ? 'Occupied' : r.status;

      return {
        ...r,
        board: assignedBoard,
        derivedStatus
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rooms: ' + err.message });
  }
});

// GET /rooms/:id — Get single room with capacity history, status history, boards, and timetable slots
router.get('/rooms/:id', async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id)
      .populate('buildingId')
      .populate('deptId')
      .lean();
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const [boards, templates] = await Promise.all([
      M.SmartBoard.find({ roomId: room._id }).lean(),
      M.SemesterTemplate.find({
        status: 'published',
        $or: [
          { 'grid.roomId': room._id },
          { 'grid.room': room.hallNo },
          { 'grid.room': room.name }
        ]
      }).populate('classId', 'name deptName code').lean()
    ]);

    const timetableSlots = [];
    templates.forEach(tpl => {
      (tpl.grid || []).forEach(slot => {
        const matches = (slot.roomId && String(slot.roomId) === String(room._id)) ||
          (slot.room && (slot.room === room.hallNo || slot.room === room.name));
        if (matches) {
          timetableSlots.push({
            templateId: tpl._id,
            classId: tpl.classId?._id || tpl.classId,
            className: tpl.classId?.name || 'Class',
            day: slot.day,
            period: slot.period,
            subject: slot.subject,
            teacher: slot.teacher,
            isLab: slot.isLab
          });
        }
      });
    });

    res.json({
      ok: true,
      data: {
        ...room,
        assignedBoards: boards,
        timetableSlots
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch room details: ' + err.message });
  }
});

// POST /rooms — Create new classroom, special hall, or laboratory with telemetry
router.post('/rooms', requireManager, async (req, res) => {
  try {
    const {
      hallNo, name, category, type, capacity, buildingId, floor,
      status, deptId, ipAddress, wifiSpeed, mobileSpeed, incharge,
      workstationsCount, labStatus, latitude, longitude, locationAccuracy, geofenceRadius
    } = req.body;

    if (!hallNo || !hallNo.trim()) {
      return res.status(400).json({ error: 'Hall / Room Number is required.' });
    }
    const cap = parseInt(capacity, 10);
    if (isNaN(cap) || cap < 1 || cap > 2000) {
      return res.status(400).json({ error: 'Capacity must be a positive integer between 1 and 2000.' });
    }
    if (!buildingId) {
      return res.status(400).json({ error: 'Building selection is required.' });
    }

    const building = await M.Building.findById(buildingId);
    if (!building) {
      return res.status(400).json({ error: 'Selected building does not exist.' });
    }
    if (building.status === 'Inactive') {
      return res.status(400).json({ error: 'Cannot add room to an Inactive building.' });
    }

    const floorNum = parseInt(floor, 10) || 0;
    if (floorNum < 0 || floorNum > (building.floors || 1)) {
      return res.status(400).json({
        error: `Floor level (${floorNum}) cannot exceed building maximum floors (${building.floors}).`
      });
    }

    const cleanHall = hallNo.trim();
    const existing = await M.Room.findOne({
      buildingId: building._id,
      floor: floorNum,
      hallNo: { $regex: `^${escapeRegex(cleanHall)}$`, $options: 'i' }
    }).lean();
    if (existing) {
      return res.status(400).json({
        error: `Room "${cleanHall}" already exists on floor ${floorNum} of ${building.name}.`
      });
    }

    let deptName = '';
    if (deptId) {
      const dept = await M.Department.findById(deptId).lean();
      if (dept) deptName = dept.name;
    }

    const lat = latitude !== undefined && latitude !== '' ? Number(latitude) : undefined;
    const lng = longitude !== undefined && longitude !== '' ? Number(longitude) : undefined;
    if (lat !== undefined && (isNaN(lat) || lat < -90 || lat > 90)) {
      return res.status(400).json({ error: 'Latitude must be between -90 and 90 degrees.' });
    }
    if (lng !== undefined && (isNaN(lng) || lng < -180 || lng > 180)) {
      return res.status(400).json({ error: 'Longitude must be between -180 and 180 degrees.' });
    }

    const radius = Math.max(5, Math.min(1000, parseInt(geofenceRadius, 10) || 50));

    // Determine category if not explicitly passed
    let unitCat = category || 'Room';
    if (!category && type) {
      if (type === 'Lab') unitCat = 'Lab';
      else if (type === 'Seminar') unitCat = 'Hall';
    }

    const room = await M.Room.create({
      hallNo: cleanHall,
      name: name?.trim() || cleanHall,
      category: unitCat,
      type: type || (unitCat === 'Lab' ? 'Lab' : unitCat === 'Hall' ? 'Seminar' : 'Theory'),
      capacity: cap,
      buildingId: building._id,
      buildingName: building.name,
      floor: floorNum,
      status: status || 'Available',
      deptId: deptId || undefined,
      deptName,
      ipAddress: ipAddress?.trim() || '',
      wifiSpeed: wifiSpeed?.trim() || '150 Mbps',
      mobileSpeed: mobileSpeed?.trim() || '5G',
      incharge: {
        name: incharge?.name?.trim() || '',
        email: incharge?.email?.trim() || '',
        phone: incharge?.phone?.trim() || ''
      },
      workstationsCount: parseInt(workstationsCount, 10) || 0,
      labStatus: labStatus || 'Available',
      latitude: lat,
      longitude: lng,
      locationAccuracy: Number(locationAccuracy) || undefined,
      geofenceRadius: radius,
      capacityHistory: [{
        oldCapacity: cap,
        newCapacity: cap,
        changedBy: req.user.name,
        changedAt: new Date(),
        reason: 'Initial creation'
      }],
      statusHistory: [{
        oldStatus: status || 'Available',
        newStatus: status || 'Available',
        changedBy: req.user.name,
        changedAt: new Date(),
        reason: 'Initial creation',
        affectedSlots: 0
      }]
    });

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Room Created', `${room.hallNo} (${room.category}) - ${room.buildingName}`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'room-create',
        entityId: room._id,
        entityType: 'Room',
        after: room.toObject()
      }
    );

    res.status(201).json({ ok: true, data: room, ...room.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /rooms/:id — Update room, track capacity changes & location in audit
router.put('/rooms/:id', requireManager, async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const before = room.toObject();
    const {
      hallNo, name, category, type, capacity, buildingId, floor,
      status, deptId, ipAddress, wifiSpeed, mobileSpeed, incharge,
      workstationsCount, labStatus, latitude, longitude, locationAccuracy, geofenceRadius,
      capacityChangeReason
    } = req.body;

    if (category) room.category = category;
    if (ipAddress !== undefined) room.ipAddress = ipAddress.trim();
    if (wifiSpeed !== undefined) room.wifiSpeed = wifiSpeed.trim();
    if (mobileSpeed !== undefined) room.mobileSpeed = mobileSpeed.trim();
    if (workstationsCount !== undefined) room.workstationsCount = parseInt(workstationsCount, 10) || 0;
    if (labStatus !== undefined) room.labStatus = labStatus;
    if (incharge) {
      room.incharge = {
        name: incharge.name !== undefined ? incharge.name.trim() : (room.incharge?.name || ''),
        email: incharge.email !== undefined ? incharge.email.trim() : (room.incharge?.email || ''),
        phone: incharge.phone !== undefined ? incharge.phone.trim() : (room.incharge?.phone || '')
      };
    }

    if (buildingId && String(buildingId) !== String(room.buildingId)) {
      const b = await M.Building.findById(buildingId);
      if (!b) return res.status(400).json({ error: 'Selected building not found.' });
      room.buildingId = b._id;
      room.buildingName = b.name;
    }

    const currentBuilding = await M.Building.findById(room.buildingId).lean();
    const maxFloors = currentBuilding?.floors || 1;

    if (floor !== undefined) {
      const fl = parseInt(floor, 10);
      if (fl < 0 || fl > maxFloors) {
        return res.status(400).json({
          error: `Floor (${fl}) exceeds building maximum floors (${maxFloors}).`
        });
      }
      room.floor = fl;
    }

    if (hallNo) {
      const cleanHall = hallNo.trim();
      if (cleanHall !== room.hallNo || (floor !== undefined && floor !== before.floor)) {
        const existing = await M.Room.findOne({
          _id: { $ne: room._id },
          buildingId: room.buildingId,
          floor: room.floor,
          hallNo: { $regex: `^${escapeRegex(cleanHall)}$`, $options: 'i' }
        }).lean();
        if (existing) {
          return res.status(400).json({
            error: `Room "${cleanHall}" already exists on floor ${room.floor} in this building.`
          });
        }
        room.hallNo = cleanHall;
      }
    }

    if (name !== undefined) room.name = name.trim() || room.hallNo;
    if (type) room.type = type;

    // Capacity change tracking
    if (capacity !== undefined) {
      const newCap = parseInt(capacity, 10);
      if (isNaN(newCap) || newCap < 1 || newCap > 2000) {
        return res.status(400).json({ error: 'Capacity must be between 1 and 2000.' });
      }
      if (newCap !== room.capacity) {
        const capReason = capacityChangeReason || req.body.reason || 'Capacity revised';
        room.capacityHistory.push({
          oldCapacity: room.capacity,
          newCapacity: newCap,
          changedBy: req.user.name,
          changedAt: new Date(),
          reason: capReason
        });
        await logAction(
          req.user.trackId || req.user._id, req.user.name, req.user.role,
          'Room Capacity Changed', `${room.hallNo}: ${room.capacity} → ${newCap} seats`,
          'data', 'info', req.ip, req.user.sessionId,
          {
            module: 'facilities',
            subType: 'room-capacity',
            entityId: room._id,
            entityType: 'Room',
            before: { capacity: room.capacity },
            after: { capacity: newCap },
            reason: capReason
          }
        );
        room.capacity = newCap;
      }
    }

    if (deptId !== undefined) {
      if (deptId) {
        const dept = await M.Department.findById(deptId).lean();
        room.deptId = dept?._id || undefined;
        room.deptName = dept?.name || '';
      } else {
        room.deptId = undefined;
        room.deptName = '';
      }
    }

    // Geolocation updates
    let locationChanged = false;
    if (latitude !== undefined) {
      const lat = latitude === '' ? undefined : Number(latitude);
      if (lat !== undefined && (isNaN(lat) || lat < -90 || lat > 90)) {
        return res.status(400).json({ error: 'Latitude must be between -90 and 90 degrees.' });
      }
      if (room.latitude !== lat) locationChanged = true;
      room.latitude = lat;
    }
    if (longitude !== undefined) {
      const lng = longitude === '' ? undefined : Number(longitude);
      if (lng !== undefined && (isNaN(lng) || lng < -180 || lng > 180)) {
        return res.status(400).json({ error: 'Longitude must be between -180 and 180 degrees.' });
      }
      if (room.longitude !== lng) locationChanged = true;
      room.longitude = lng;
    }
    if (locationAccuracy !== undefined) {
      room.locationAccuracy = locationAccuracy === '' ? undefined : Number(locationAccuracy);
    }
    if (geofenceRadius !== undefined) {
      room.geofenceRadius = Math.max(5, Math.min(1000, parseInt(geofenceRadius, 10) || 50));
    }

    if (locationChanged) {
      await logAction(
        req.user.trackId || req.user._id, req.user.name, req.user.role,
        'Room Location Changed', `${room.hallNo} coordinates updated`,
        'data', 'info', req.ip, req.user.sessionId,
        {
          module: 'facilities',
          subType: 'room-location',
          entityId: room._id,
          entityType: 'Room',
          before: { latitude: before.latitude, longitude: before.longitude },
          after: { latitude: room.latitude, longitude: room.longitude }
        }
      );
    }

    await room.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Room Updated', `${room.hallNo} - ${room.buildingName}`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'room-update',
        entityId: room._id,
        entityType: 'Room',
        before,
        after: room.toObject()
      }
    );

    res.json({ ok: true, data: room, ...room.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /rooms/:id — Delete room if not used in published timetables
router.delete('/rooms/:id', requireManager, async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const publishedTemplates = await M.SemesterTemplate.find({
      status: 'published',
      $or: [
        { 'grid.roomId': room._id },
        { 'grid.room': room.hallNo },
        { 'grid.room': room.name }
      ]
    }).lean();

    if (publishedTemplates.length > 0) {
      return res.status(400).json({
        error: `Cannot delete room "${room.hallNo}": it is assigned in ${publishedTemplates.length} published timetable(s). Reassign timetable slots first.`,
        affectedTemplates: publishedTemplates.length
      });
    }

    // Unassign any boards assigned to this room
    await M.SmartBoard.updateMany(
      { roomId: room._id },
      {
        $set: { roomId: null, buildingId: null },
        $push: {
          assignmentHistory: {
            roomId: null,
            roomHallNo: 'Unassigned (Room Deleted)',
            assignedBy: req.user.name,
            assignedAt: new Date(),
            reason: `Room ${room.hallNo} was deleted`
          }
        }
      }
    );

    await M.Room.findByIdAndDelete(room._id);

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Room Deleted', `${room.hallNo} (${room.buildingName})`,
      'data', 'warn', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'room-delete',
        entityId: room._id,
        entityType: 'Room',
        before: room.toObject()
      }
    );

    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete room: ' + err.message });
  }
});

// POST /rooms/:id/bookings — Pre-book a hall with collision check & audit logging
router.post('/rooms/:id/bookings', requireManager, async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room / Hall not found' });

    const { title, organizer, date, startTime, endTime, notes } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Event title is required.' });
    }
    if (!date) {
      return res.status(400).json({ error: 'Reservation date is required.' });
    }
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'Start and End times are required.' });
    }
    if (startTime >= endTime) {
      return res.status(400).json({ error: 'End time must be later than start time.' });
    }

    const bookingDateStr = new Date(date).toISOString().split('T')[0];

    // Check for collisions with existing confirmed bookings on the same date
    const collision = (room.bookings || []).find(b => {
      if (b.status === 'Cancelled') return false;
      const bDateStr = new Date(b.date).toISOString().split('T')[0];
      if (bDateStr !== bookingDateStr) return false;
      return startTime < b.endTime && endTime > b.startTime;
    });

    if (collision) {
      return res.status(400).json({
        error: `Schedule collision: "${collision.title}" is already booked from ${collision.startTime} to ${collision.endTime} on this date.`
      });
    }

    const bookingId = 'BK-' + Date.now().toString(36).toUpperCase();
    const newBooking = {
      bookingId,
      title: title.trim(),
      organizer: organizer?.trim() || req.user.name,
      date: new Date(date),
      startTime,
      endTime,
      status: 'Confirmed',
      notes: notes?.trim() || '',
      bookedBy: req.user.name,
      bookedAt: new Date()
    };

    if (!room.bookings) room.bookings = [];
    room.bookings.push(newBooking);
    await room.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Hall Pre-Booked', `${room.hallNo} - "${newBooking.title}" on ${bookingDateStr} (${startTime}-${endTime})`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'hall-booking',
        entityId: room._id,
        entityType: 'Room',
        booking: newBooking
      }
    );

    res.status(201).json({ ok: true, data: newBooking });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /rooms/:id/bookings/:bookingId — Cancel hall booking with audit log
router.delete('/rooms/:id/bookings/:bookingId', requireManager, async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room / Hall not found' });

    const booking = (room.bookings || []).find(b => b.bookingId === req.params.bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    booking.status = 'Cancelled';
    await room.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Hall Booking Cancelled', `${room.hallNo} - "${booking.title}" (${booking.bookingId})`,
      'data', 'warn', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'hall-booking-cancel',
        entityId: room._id,
        entityType: 'Room',
        bookingId: req.params.bookingId
      }
    );

    res.json({ ok: true, cancelled: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /rooms/:id/capacity-history — Capacity revision timeline
router.get('/rooms/:id/capacity-history', async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id).select('hallNo name capacity capacityHistory').lean();
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const history = (room.capacityHistory || []).sort(
      (a, b) => new Date(b.changedAt) - new Date(a.changedAt)
    );

    res.json({ ok: true, data: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /rooms/:id/timetable-slots — All timetable slots assigned to room
router.get('/rooms/:id/timetable-slots', async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id).lean();
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const templates = await M.SemesterTemplate.find({
      status: 'published',
      $or: [
        { 'grid.roomId': room._id },
        { 'grid.room': room.hallNo },
        { 'grid.room': room.name }
      ]
    }).populate('classId', 'name deptName code').lean();

    const slots = [];
    templates.forEach(tpl => {
      (tpl.grid || []).forEach(slot => {
        const matches = (slot.roomId && String(slot.roomId) === String(room._id)) ||
          (slot.room && (slot.room === room.hallNo || slot.room === room.name));
        if (matches) {
          slots.push({
            templateId: tpl._id,
            classId: tpl.classId?._id || tpl.classId,
            className: tpl.classId?.name || 'Class',
            day: slot.day,
            period: slot.period,
            subject: slot.subject,
            teacher: slot.teacher,
            isLab: slot.isLab,
            span: slot.span || 1
          });
        }
      });
    });

    res.json({ ok: true, data: slots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ══════════════════════════════════════════════════════
//  CAMPUS FACILITIES: ROOM STATUS & MAINTENANCE (Phase 1E)
// ══════════════════════════════════════════════════════

// GET /rooms/:id/affected-slots — Preview slots affected by status change
router.get('/rooms/:id/affected-slots', async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id).lean();
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const templates = await M.SemesterTemplate.find({
      status: 'published',
      $or: [
        { 'grid.roomId': room._id },
        { 'grid.room': room.hallNo },
        { 'grid.room': room.name }
      ]
    }).populate('classId', 'name deptName code').lean();

    const affectedSlots = [];
    templates.forEach(tpl => {
      (tpl.grid || []).forEach(slot => {
        const matches = (slot.roomId && String(slot.roomId) === String(room._id)) ||
          (slot.room && (slot.room === room.hallNo || slot.room === room.name));
        if (matches) {
          affectedSlots.push({
            templateId: tpl._id,
            classId: tpl.classId?._id || tpl.classId,
            className: tpl.classId?.name || 'Class',
            day: slot.day,
            period: slot.period,
            subject: slot.subject,
            teacher: slot.teacher,
            isLab: slot.isLab,
            span: slot.span || 1
          });
        }
      });
    });

    res.json({ ok: true, count: affectedSlots.length, affectedSlots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /rooms/:id/status — Transition room status (e.g. Maintenance), record history & affected slots
router.patch('/rooms/:id/status', requireManager, async (req, res) => {
  try {
    const { status, reason, alternativeRoomId } = req.body;
    const allowed = ['Available', 'Reserved', 'Maintenance', 'Temporarily Unavailable', 'Inactive'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${allowed.join(', ')}` });
    }

    const room = await M.Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const oldStatus = room.status;
    if (oldStatus === status) {
      return res.json({ ok: true, room, message: 'Status is already ' + status });
    }

    // Identify affected timetable slots
    const templates = await M.SemesterTemplate.find({
      status: 'published',
      $or: [
        { 'grid.roomId': room._id },
        { 'grid.room': room.hallNo },
        { 'grid.room': room.name }
      ]
    }).populate('classId', 'name deptName code').lean();

    const affectedSlots = [];
    templates.forEach(tpl => {
      (tpl.grid || []).forEach(slot => {
        const matches = (slot.roomId && String(slot.roomId) === String(room._id)) ||
          (slot.room && (slot.room === room.hallNo || slot.room === room.name));
        if (matches) {
          affectedSlots.push({
            templateId: tpl._id,
            classId: tpl.classId?._id || tpl.classId,
            className: tpl.classId?.name || 'Class',
            day: slot.day,
            period: slot.period,
            subject: slot.subject,
            teacher: slot.teacher,
            isLab: slot.isLab
          });
        }
      });
    });

    // If alternative room specified, assign it via Override records
    let altRoom = null;
    if (alternativeRoomId) {
      altRoom = await M.Room.findById(alternativeRoomId);
      if (!altRoom) return res.status(400).json({ error: 'Alternative room not found' });
      if (altRoom.status !== 'Available') {
        return res.status(400).json({ error: `Alternative room is currently ${altRoom.status}` });
      }

      const today = new Date();
      for (const slot of affectedSlots) {
        await M.Override.create({
          date: today,
          classId: slot.classId,
          period: slot.period,
          type: 'room_change',
          originalSlot: { room: room.hallNo, roomId: room._id },
          newSlot: { room: altRoom.hallNo, roomId: altRoom._id },
          reason: reason || `Relocation due to ${room.hallNo} maintenance`,
          approvedBy: req.user.name
        });
      }
    }

    room.statusHistory.push({
      oldStatus,
      newStatus: status,
      changedBy: req.user.name,
      changedAt: new Date(),
      reason: reason || '',
      affectedSlots: affectedSlots.length
    });

    room.status = status;
    await room.save();

    let actionLabel = 'Room Status Changed';
    let severity = 'info';
    if (status === 'Maintenance') {
      actionLabel = 'Room Maintenance Started';
      severity = 'warn';
    } else if (oldStatus === 'Maintenance' && status === 'Available') {
      actionLabel = 'Room Maintenance Ended';
      severity = 'info';
    }

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      actionLabel, `${room.hallNo}: ${oldStatus} → ${status}`,
      'data', severity, req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'room-status',
        entityId: room._id,
        entityType: 'Room',
        before: { status: oldStatus },
        after: { status },
        reason: reason || '',
        affectedSlots: affectedSlots.length,
        alternativeRoom: altRoom ? altRoom.hallNo : null
      }
    );

    res.json({
      ok: true,
      room,
      affectedSlotsCount: affectedSlots.length,
      affectedSlots,
      alternativeRoom: altRoom ? { _id: altRoom._id, hallNo: altRoom.hallNo } : null
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /rooms/:id/alternative — Explicit alternative room assignment
router.post('/rooms/:id/alternative', requireManager, async (req, res) => {
  try {
    const { alternativeRoomId, reason, date } = req.body;
    if (!alternativeRoomId) {
      return res.status(400).json({ error: 'Alternative room ID is required.' });
    }

    const [room, altRoom] = await Promise.all([
      M.Room.findById(req.params.id),
      M.Room.findById(alternativeRoomId)
    ]);
    if (!room) return res.status(404).json({ error: 'Original room not found.' });
    if (!altRoom) return res.status(404).json({ error: 'Alternative room not found.' });

    if (String(room._id) === String(altRoom._id)) {
      return res.status(400).json({ error: 'Alternative room cannot be the same room.' });
    }
    if (altRoom.status !== 'Available') {
      return res.status(400).json({ error: `Alternative room is currently ${altRoom.status}.` });
    }

    const templates = await M.SemesterTemplate.find({
      status: 'published',
      $or: [
        { 'grid.roomId': room._id },
        { 'grid.room': room.hallNo },
        { 'grid.room': room.name }
      ]
    }).populate('classId', 'name deptName code').lean();

    const affectedSlots = [];
    templates.forEach(tpl => {
      (tpl.grid || []).forEach(slot => {
        const matches = (slot.roomId && String(slot.roomId) === String(room._id)) ||
          (slot.room && (slot.room === room.hallNo || slot.room === room.name));
        if (matches) {
          affectedSlots.push({
            templateId: tpl._id,
            classId: tpl.classId?._id || tpl.classId,
            period: slot.period,
            day: slot.day
          });
        }
      });
    });

    const targetDate = date ? new Date(date) : new Date();
    for (const slot of affectedSlots) {
      await M.Override.create({
        date: targetDate,
        classId: slot.classId,
        period: slot.period,
        type: 'room_change',
        originalSlot: { room: room.hallNo, roomId: room._id },
        newSlot: { room: altRoom.hallNo, roomId: altRoom._id },
        reason: reason || `Alternative room assigned for ${room.hallNo}`,
        approvedBy: req.user.name
      });
    }

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Room Alternative Assigned', `${room.hallNo} → ${altRoom.hallNo} (${affectedSlots.length} slots)`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'room-alternative',
        entityId: room._id,
        entityType: 'Room',
        before: { room: room.hallNo },
        after: { room: altRoom.hallNo },
        reason: reason || ''
      }
    );

    res.json({
      ok: true,
      message: `Assigned alternative room ${altRoom.hallNo} for ${affectedSlots.length} slot(s).`,
      count: affectedSlots.length,
      alternativeRoom: { _id: altRoom._id, hallNo: altRoom.hallNo, capacity: altRoom.capacity }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ══════════════════════════════════════════════════════
//  CAMPUS FACILITIES: SMART BOARD REGISTRY (Phase 1G)
// ══════════════════════════════════════════════════════

// GET /boards — List registered smart boards with building and room populate
router.get('/boards', async (req, res) => {
  try {
    const boards = await M.SmartBoard.find()
      .populate('buildingId')
      .populate({ path: 'roomId', populate: { path: 'buildingId' } })
      .sort({ boardName: 1 })
      .lean();
    res.json(boards);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch smart boards: ' + err.message });
  }
});

// GET /boards/:id — Single board with complete assignment history
router.get('/boards/:id', async (req, res) => {
  try {
    const board = await M.SmartBoard.findById(req.params.id)
      .populate('buildingId')
      .populate('roomId')
      .lean();
    if (!board) return res.status(404).json({ error: 'Smart board not found' });
    res.json({ ok: true, data: board });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch board details: ' + err.message });
  }
});

// POST /boards — Register a new smart board with room assignment
router.post('/boards', requireManager, async (req, res) => {
  try {
    const { boardName, deviceId, buildingId, roomId, status, firmwareVersion } = req.body;
    if (!boardName || boardName.trim().length < 2) {
      return res.status(400).json({ error: 'Board name is required (minimum 2 characters).' });
    }
    if (!deviceId || deviceId.trim().length < 3) {
      return res.status(400).json({ error: 'Device ID is required (minimum 3 characters).' });
    }

    const cleanDeviceId = deviceId.trim().toUpperCase();
    const existing = await M.SmartBoard.findOne({ deviceId: cleanDeviceId }).lean();
    if (existing) {
      return res.status(400).json({ error: `Device ID "${cleanDeviceId}" is already registered.` });
    }

    let resolvedBuildingId = buildingId || undefined;
    let roomHallNo = '';
    let targetRoom = null;

    if (roomId) {
      targetRoom = await M.Room.findById(roomId);
      if (!targetRoom) return res.status(400).json({ error: 'Assigned room not found.' });

      // Check if room already has an active board
      const activeInRoom = await M.SmartBoard.findOne({
        roomId: targetRoom._id,
        status: { $ne: 'Inactive' }
      }).lean();
      if (activeInRoom) {
        return res.status(400).json({
          error: `Room "${targetRoom.hallNo}" already has board "${activeInRoom.boardName}" assigned.`
        });
      }

      resolvedBuildingId = targetRoom.buildingId;
      roomHallNo = targetRoom.hallNo;
    }

    const assignmentHistory = [];
    if (targetRoom) {
      assignmentHistory.push({
        roomId: targetRoom._id,
        roomHallNo: targetRoom.hallNo,
        assignedBy: req.user.name,
        assignedAt: new Date(),
        reason: 'Initial registration'
      });
    }

    const generatedApiKey = generateBoardApiKey();
    const board = await M.SmartBoard.create({
      boardName: boardName.trim(),
      deviceId: cleanDeviceId,
      buildingId: resolvedBuildingId,
      roomId: targetRoom ? targetRoom._id : undefined,
      status: status || 'Active',
      firmwareVersion: firmwareVersion?.trim() || '',
      boardApiKey: generatedApiKey,
      connectionStatus: 'Disconnected',
      registeredAt: new Date(),
      registeredBy: req.user.name,
      assignmentHistory
    });

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Board Registered', `${board.boardName} (${board.deviceId})`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'board-create',
        entityId: board._id,
        entityType: 'SmartBoard',
        after: board.toObject()
      }
    );

    if (targetRoom) {
      await logAction(
        req.user.trackId || req.user._id, req.user.name, req.user.role,
        'Board Assigned to Room', `${board.boardName} → ${targetRoom.hallNo}`,
        'data', 'info', req.ip, req.user.sessionId,
        {
          module: 'facilities',
          subType: 'board-assign',
          entityId: board._id,
          entityType: 'SmartBoard',
          after: { roomId: targetRoom._id, roomHallNo: targetRoom.hallNo }
        }
      );
    }

    res.status(201).json({ ok: true, data: board, ...board.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /boards/:id/token/regenerate — Rotate device secret key (Admin only)
router.post('/boards/:id/token/regenerate', requireManager, async (req, res) => {
  try {
    const board = await M.SmartBoard.findById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Smart board not found' });
    const newKey = generateBoardApiKey();
    board.boardApiKey = newKey;
    await board.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Board API Key Rotated', `Regenerated authorization key for ${board.boardName} (${board.deviceId})`,
      'security', 'warn', req.ip, req.user.sessionId,
      { boardId: board._id, deviceId: board.deviceId }
    );

    res.json({ ok: true, boardApiKey: newKey });
  } catch (err) {
    res.status(500).json({ error: 'Failed to regenerate board key: ' + err.message });
  }
});

// GET /boards/:id/telemetry — Device network telemetry and IP history (Admin only)
router.get('/boards/:id/telemetry', requireManager, async (req, res) => {
  try {
    const board = await M.SmartBoard.findById(req.params.id).lean();
    if (!board) return res.status(404).json({ error: 'Smart board not found' });
    res.json({
      ok: true,
      deviceId: board.deviceId,
      boardName: board.boardName,
      connectionStatus: board.connectionStatus,
      currentIp: board.currentIp,
      ipType: board.ipType,
      networkStatus: board.networkStatus,
      lastConnectedAt: board.lastConnectedAt,
      lastSeenAt: board.lastSeenAt,
      lastHeartbeatAt: board.lastHeartbeatAt,
      ipHistory: board.ipHistory || [],
      telemetry: board.telemetry || {}
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch telemetry: ' + err.message });
  }
});

// POST /boards/:id/command — Remote control command dispatch (Admin only)
router.post('/boards/:id/command', requireManager, async (req, res) => {
  try {
    const board = await M.SmartBoard.findById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Smart board not found' });
    const { command, payload } = req.body;
    if (!command) return res.status(400).json({ error: 'Command is required' });

    const result = await sendCommandToBoard(board.deviceId, command, payload);
    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Remote Command Dispatched', `Command "${command}" to ${board.boardName} (${board.deviceId})`,
      'system', 'info', req.ip, req.user.sessionId,
      { boardId: board._id, deviceId: board.deviceId, command, result }
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to dispatch command: ' + err.message });
  }
});

// POST /boards/pair — Pair an unlinked board to a room using 6-digit pairing code
router.post('/boards/pair', requireManager, async (req, res) => {
  try {
    const { code, roomId, reason } = req.body;
    if (!code || !String(code).trim()) {
      return res.status(400).json({ error: '6-digit pairing code is required.' });
    }
    if (!roomId) {
      return res.status(400).json({ error: 'Target Room ID is required.' });
    }

    const cleanCode = String(code).trim();
    const board = await M.SmartBoard.findOne({
      pairingCode: cleanCode,
      pairingCodeExpiresAt: { $gt: new Date() }
    });

    if (!board) {
      return res.status(400).json({ error: 'Invalid or expired 6-digit pairing code. Please verify the code displayed on the board screen.' });
    }

    const room = await M.Room.findById(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Target room not found.' });
    }

    // Check if room already has active board
    const activeInRoom = await M.SmartBoard.findOne({
      _id: { $ne: board._id },
      roomId: room._id,
      status: { $ne: 'Inactive' }
    }).lean();

    if (activeInRoom) {
      return res.status(400).json({
        error: `Room "${room.hallNo}" already has board "${activeInRoom.boardName}" assigned.`
      });
    }

    // Close previous assignment history entry if any
    if (board.assignmentHistory && board.assignmentHistory.length > 0) {
      const last = board.assignmentHistory[board.assignmentHistory.length - 1];
      if (last && !last.removedAt) {
        last.removedAt = new Date();
      }
    }

    // Link board
    board.roomId = room._id;
    board.buildingId = room.buildingId;
    board.pairingCode = '';
    board.pairingCodeExpiresAt = null;
    board.assignmentHistory.push({
      roomId: room._id,
      roomHallNo: room.hallNo,
      assignedBy: req.user.name,
      assignedAt: new Date(),
      reason: reason || 'Paired via 6-digit code'
    });

    await board.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Smart Board Paired', `Board ${board.boardName} (${board.deviceId}) paired with Room ${room.hallNo}`,
      'facilities', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'board-pair',
        boardId: board._id,
        deviceId: board.deviceId,
        roomId: room._id,
        roomHallNo: room.hallNo
      }
    );

    res.json({
      ok: true,
      message: `Board "${board.boardName}" (${board.deviceId}) successfully paired with Room ${room.hallNo}`,
      board
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to pair smart board: ' + err.message });
  }
});

// PUT /boards/:id — Update board details, reassign room with assignment history
router.put('/boards/:id', requireManager, async (req, res) => {
  try {
    const board = await M.SmartBoard.findById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Smart board not found' });

    const before = board.toObject();
    const { boardName, deviceId, buildingId, roomId, status, firmwareVersion, reason } = req.body;

    if (boardName) board.boardName = boardName.trim();
    if (status) board.status = status;
    if (firmwareVersion !== undefined) board.firmwareVersion = firmwareVersion.trim();

    if (deviceId) {
      const cleanDeviceId = deviceId.trim().toUpperCase();
      if (cleanDeviceId !== board.deviceId) {
        const existing = await M.SmartBoard.findOne({
          _id: { $ne: board._id },
          deviceId: cleanDeviceId
        }).lean();
        if (existing) {
          return res.status(400).json({ error: `Device ID "${cleanDeviceId}" is already registered.` });
        }
        board.deviceId = cleanDeviceId;
      }
    }

    // Room reassignment logic
    const oldRoomIdStr = board.roomId ? String(board.roomId) : '';
    const newRoomIdStr = roomId ? String(roomId) : '';

    if (oldRoomIdStr !== newRoomIdStr) {
      // Close previous active assignment
      if (board.assignmentHistory && board.assignmentHistory.length > 0) {
        const last = board.assignmentHistory[board.assignmentHistory.length - 1];
        if (last && !last.removedAt) {
          last.removedAt = new Date();
        }
      }

      if (newRoomIdStr) {
        const newRoom = await M.Room.findById(roomId);
        if (!newRoom) return res.status(400).json({ error: 'New assigned room not found.' });

        // Check if room already has active board
        const activeInRoom = await M.SmartBoard.findOne({
          _id: { $ne: board._id },
          roomId: newRoom._id,
          status: { $ne: 'Inactive' }
        }).lean();
        if (activeInRoom) {
          return res.status(400).json({
            error: `Room "${newRoom.hallNo}" already has board "${activeInRoom.boardName}" assigned.`
          });
        }

        board.roomId = newRoom._id;
        board.buildingId = newRoom.buildingId;
        board.assignmentHistory.push({
          roomId: newRoom._id,
          roomHallNo: newRoom.hallNo,
          assignedBy: req.user.name,
          assignedAt: new Date(),
          reason: reason || 'Reassigned'
        });

        await logAction(
          req.user.trackId || req.user._id, req.user.name, req.user.role,
          'Board Assigned to Room', `${board.boardName} → ${newRoom.hallNo}`,
          'data', 'info', req.ip, req.user.sessionId,
          {
            module: 'facilities',
            subType: 'board-assign',
            entityId: board._id,
            entityType: 'SmartBoard',
            before: { roomId: before.roomId },
            after: { roomId: newRoom._id, roomHallNo: newRoom.hallNo },
            reason: reason || ''
          }
        );
      } else {
        // Unassigning board from room
        board.roomId = undefined;
        if (buildingId) board.buildingId = buildingId;

        await logAction(
          req.user.trackId || req.user._id, req.user.name, req.user.role,
          'Board Unassigned', `${board.boardName} unassigned from room`,
          'data', 'warn', req.ip, req.user.sessionId,
          {
            module: 'facilities',
            subType: 'board-unassign',
            entityId: board._id,
            entityType: 'SmartBoard',
            before: { roomId: before.roomId },
            after: { roomId: null },
            reason: reason || ''
          }
        );
      }
    } else if (buildingId && !newRoomIdStr) {
      board.buildingId = buildingId;
    }

    await board.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Board Updated', `${board.boardName} (${board.deviceId})`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'board-update',
        entityId: board._id,
        entityType: 'SmartBoard',
        before,
        after: board.toObject()
      }
    );

    res.json({ ok: true, data: board, ...board.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /boards/:id/status — Toggle board status
router.patch('/boards/:id/status', requireManager, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['Active', 'Inactive', 'Maintenance'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Allowed statuses: ${allowed.join(', ')}` });
    }

    const board = await M.SmartBoard.findById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Smart board not found' });

    const oldStatus = board.status;
    board.status = status;
    await board.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Board Status Changed', `${board.boardName}: ${oldStatus} → ${status}`,
      'data', status === 'Maintenance' ? 'warn' : 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'board-status',
        entityId: board._id,
        entityType: 'SmartBoard',
        before: { status: oldStatus },
        after: { status }
      }
    );

    res.json({ ok: true, data: board, ...board.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /boards/:id — Deregister smart board
router.delete('/boards/:id', requireManager, async (req, res) => {
  try {
    const board = await M.SmartBoard.findById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Smart board not found' });

    await M.SmartBoard.findByIdAndDelete(board._id);

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Board Deregistered', `${board.boardName} (${board.deviceId})`,
      'data', 'warn', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'board-delete',
        entityId: board._id,
        entityType: 'SmartBoard',
        before: board.toObject()
      }
    );

    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deregister board: ' + err.message });
  }
});


// ══════════════════════════════════════════════════════
//  CAMPUS FACILITIES: AUDIT LOG (Phase 1H & Tab 6)
// ══════════════════════════════════════════════════════

// GET /facility-logs — Query decrypted facility-specific audit events
router.get('/facility-logs', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const filter = { module: 'facilities' };

    if (req.query.entityType && req.query.entityType !== 'all') {
      filter['details.entityType'] = sanitizeToString(req.query.entityType);
    }
    if (req.query.severity && req.query.severity !== 'all') {
      filter.severity = sanitizeToString(req.query.severity);
    }
    if (req.query.subType && req.query.subType !== 'all') {
      filter.subType = sanitizeToString(req.query.subType);
    }
    if (req.query.before) {
      filter.createdAt = { $lt: new Date(req.query.before) };
    }

    const [logs, total] = await Promise.all([
      M.Log.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      M.Log.countDocuments({ module: 'facilities' })
    ]);

    // Decrypt encrypted payload to expose before/after diffs and reasons
    const enriched = logs.map(l => {
      let details = l.details || {};
      let changes = l.changes || null;

      if (l.encryptedPayload) {
        const payload = decryptLog(l.encryptedPayload);
        if (payload && typeof payload === 'object') {
          if (payload.details) details = payload.details;
          if (payload.changes) changes = payload.changes;
        }
      }

      return {
        _id: l._id,
        action: l.action,
        target: l.target,
        performedBy: l.performedBy,
        role: l.role,
        severity: l.severity,
        time: l.time || l.createdAt,
        createdAt: l.createdAt,
        entityType: details.entityType || l.targetType || 'Facility',
        entityId: details.entityId || null,
        subType: l.subType,
        before: details.before || (changes?.before) || null,
        after: details.after || (changes?.after) || null,
        reason: details.reason || '',
        affectedSlots: details.affectedSlots || 0,
        alternativeRoom: details.alternativeRoom || null
      };
    });

    res.json({ ok: true, data: enriched, total });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch facility audit logs: ' + err.message });
  }
});


// ── Layout presets (saved scheduling configurations) ──

const DEFAULT_PRESETS = [
  {
    name: 'First-year Core',
    description: 'Foundation curriculum with morning theory, afternoon practicals, and 5-day week.',
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    defaultLabDuration: 3,
    defaultRoomType: 'Lecture Hall',
    timingSet: 'SET_1',
    preferredSubjects: ['Engineering Mathematics', 'Engineering Physics', 'Programming in C', 'Engineering Graphics']
  },
  {
    name: 'Second-year Core',
    description: 'Core departmental coursework with balanced mid-week lab sessions and tutorial blocks.',
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    defaultLabDuration: 3,
    defaultRoomType: 'Lecture Hall',
    timingSet: 'SET_1',
    preferredSubjects: ['Data Structures', 'Digital Logic Design', 'Discrete Mathematics', 'Object Oriented Programming']
  },
  {
    name: 'Lab-heavy (Practical Focus)',
    description: 'Engineering layout configured with 3 extended laboratory afternoons per week.',
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    defaultLabDuration: 3,
    defaultRoomType: 'Laboratory',
    timingSet: 'SET_1',
    preferredSubjects: ['Computer Networks Lab', 'DBMS Lab', 'Web Technology Lab']
  },
  {
    name: 'Engineering Dept Standard',
    description: 'Institutional engineering standard with 8 periods daily and staggered morning break.',
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    defaultLabDuration: 3,
    defaultRoomType: 'Lecture Hall',
    timingSet: 'SET_1',
    preferredSubjects: []
  },
  {
    name: 'Mon–Fri Standard',
    description: '5-day working week, 8 academic periods daily with standard lunch interval.',
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    defaultLabDuration: 2,
    defaultRoomType: 'Lecture Hall',
    timingSet: 'SET_1',
    preferredSubjects: []
  },
  {
    name: 'Mon–Sat Comprehensive',
    description: '6-day working week for intensive academic coverage or backlog recovery terms.',
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    defaultLabDuration: 3,
    defaultRoomType: 'Lecture Hall',
    timingSet: 'SET_1',
    preferredSubjects: []
  }
];

async function seedDefaultPresetsIfNeeded() {
  try {
    const count = await M.LayoutPreset.countDocuments();
    if (count === 0) {
      await M.LayoutPreset.insertMany(DEFAULT_PRESETS);
    }
  } catch (err) {
    console.error('Failed to seed default presets:', err.message);
  }
}

router.get('/layout-presets', async (req, res) => {
  try {
    await seedDefaultPresetsIfNeeded();
    res.json(await M.LayoutPreset.find().sort({ name: 1 }).lean());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/layout-presets/seed', requireManager, async (req, res) => {
  try {
    await M.LayoutPreset.deleteMany({});
    const inserted = await M.LayoutPreset.insertMany(DEFAULT_PRESETS);
    res.json({ ok: true, seededCount: inserted.length, presets: inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/layout-presets', requireManager, async (req, res) => {
  try {
    const data = { ...req.body };
    if (!data.createdBy && req.user && req.user.name) data.createdBy = req.user.name;
    res.status(201).json(await M.LayoutPreset.create(data));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/layout-presets/:id/apply', requireManager, async (req, res) => {
  try {
    const { classId, strategy = 'overwrite' } = req.body;
    if (!classId) return res.status(400).json({ error: 'Target classId is required' });

    const preset = await M.LayoutPreset.findById(req.params.id);
    if (!preset) return res.status(404).json({ error: 'Preset template not found' });

    const templateGrid = preset.grid || [];
    if (!templateGrid.length) {
      return res.status(400).json({ error: 'This preset does not contain a structural grid. Select a full timetable template.' });
    }

    const targetClass = await M.Class.findById(classId).lean();
    if (!targetClass) return res.status(404).json({ error: 'Target class not found' });

    let finalGrid = [];
    let draft = await M.SemesterTemplate.findOne({ classId, status: 'draft' });

    if (strategy === 'merge' && draft && Array.isArray(draft.grid) && draft.grid.length) {
      const templateKeys = new Set(templateGrid.map(s => `${s.day}_${s.period}`));
      const nonOverlappingExisting = draft.grid.filter(s => !templateKeys.has(`${s.day}_${s.period}`));
      finalGrid = [...nonOverlappingExisting, ...templateGrid];
    } else {
      finalGrid = templateGrid;
    }

    const conflicts = await detectConflicts(finalGrid, classId, draft ? draft._id : null);

    if (draft) {
      draft.grid = finalGrid;
      await draft.save();
    } else {
      draft = await M.SemesterTemplate.create({
        classId,
        grid: finalGrid,
        status: 'draft',
        version: 1
      });
    }

    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Template Applied to Class',
      `Applied template "${preset.name}" (${finalGrid.length} slots) to class "${targetClass.name}" [strategy: ${strategy}]`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'action' }
    );

    res.json({
      ok: true,
      message: `Template "${preset.name}" successfully applied to ${targetClass.name}.`,
      data: {
        draftTemplateId: draft._id,
        appliedSlotsCount: finalGrid.length,
        conflicts
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/layout-presets/:id', requireManager, async (req, res) => {
  try {
    const preset = await M.LayoutPreset.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' });
    if (!preset) return res.status(404).json({ error: 'Preset not found' });
    res.json(preset);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/layout-presets/:id', requireManager, async (req, res) => {
  try {
    await M.LayoutPreset.findByIdAndDelete(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Semester templates (main draft / published document) ──

router.get('/semester-templates', async (req, res) => {
  try {
    const filter = {};
    if (req.query.classId) filter.classId = sanitizeToObjectId(req.query.classId);
    if (req.query.status) filter.status = sanitizeToString(req.query.status);
    res.json(await M.SemesterTemplate.find(filter).sort({ updatedAt: -1 }).lean());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/semester-templates', requireManager, async (req, res) => {
  try {
    const template = await M.SemesterTemplate.create({ ...req.body, status: 'draft' });
    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Semester Template Created', `Draft template for class ${req.body.classId}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'entry-create' }
    );
    res.status(201).json(template);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/semester-templates/:id', async (req, res) => {
  try {
    const doc = await M.SemesterTemplate.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Template not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/semester-templates/:id', requireManager, async (req, res) => {
  try {
    const current = await M.SemesterTemplate.findById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Template not found' });
    if (current.status === 'published') {
      return res.status(403).json({ error: 'Published templates are immutable; create a new draft first' });
    }
    const updated = await M.SemesterTemplate.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Timetable Publish Workflow Helpers (Item 8) ──

async function computePublishDiff(draftTemplate) {
  // Find current published template or fallback to active section timetable
  const currentPublished = await M.SemesterTemplate.findOne({
    classId: draftTemplate.classId,
    status: 'published',
    _id: { $ne: draftTemplate._id }
  }).lean();

  let prodGrid = [];
  if (currentPublished && Array.isArray(currentPublished.grid)) {
    prodGrid = currentPublished.grid;
  } else {
    const sec = await M.SectionTimetable.findOne({ classId: draftTemplate.classId }).lean();
    if (sec && sec.slots && typeof sec.slots === 'object') {
      prodGrid = Object.values(sec.slots).filter(Boolean);
    }
  }

  const prodMap = new Map();
  prodGrid.forEach(s => {
    if (!s || !s.day) return;
    const pNum = parseInt(String(s.period || '1').replace(/\D/g, ''), 10) || 1;
    prodMap.set(`${s.day}_${pNum}`, { ...s, period: pNum });
  });

  const draftGrid = draftTemplate.grid || [];
  const draftMap = new Map();
  draftGrid.forEach(s => {
    if (!s || !s.day) return;
    const pNum = parseInt(String(s.period || '1').replace(/\D/g, ''), 10) || 1;
    draftMap.set(`${s.day}_${pNum}`, { ...s, period: pNum });
  });

  const added = [];
  const removed = [];
  const modified = [];
  let unchangedCount = 0;
  const teacherStats = new Map();

  function bumpTeacher(name, kind) {
    const clean = String(name || '').trim();
    if (!clean || clean === 'Unassigned' || clean === 'TBA') return;
    if (!teacherStats.has(clean)) {
      teacherStats.set(clean, { total: 0, added: 0, removed: 0, modified: 0 });
    }
    const st = teacherStats.get(clean);
    st.total += 1;
    if (kind === 'added') st.added += 1;
    else if (kind === 'removed') st.removed += 1;
    else if (kind === 'modified') st.modified += 1;
  }

  // Detect added and modified slots
  draftMap.forEach((dSlot, key) => {
    if (!prodMap.has(key)) {
      added.push({
        day: dSlot.day,
        period: dSlot.period,
        subject: dSlot.subject || '',
        teacher: dSlot.teacher || '',
        room: dSlot.room || '',
        isLab: Boolean(dSlot.isLab),
        span: Number(dSlot.span || 1)
      });
      bumpTeacher(dSlot.teacher, 'added');
    } else {
      const pSlot = prodMap.get(key);
      const isDiff = (
        (dSlot.subject || '').trim() !== (pSlot.subject || '').trim() ||
        (dSlot.teacher || '').trim() !== (pSlot.teacher || '').trim() ||
        (dSlot.room || '').trim() !== (pSlot.room || '').trim() ||
        Boolean(dSlot.isLab) !== Boolean(pSlot.isLab) ||
        Number(dSlot.span || 1) !== Number(pSlot.span || 1)
      );

      if (isDiff) {
        const changes = [];
        if ((dSlot.subject || '').trim() !== (pSlot.subject || '').trim()) {
          changes.push({ field: 'subject', label: 'Subject', from: pSlot.subject || '—', to: dSlot.subject || '—' });
        }
        if ((dSlot.teacher || '').trim() !== (pSlot.teacher || '').trim()) {
          changes.push({ field: 'teacher', label: 'Faculty', from: pSlot.teacher || '—', to: dSlot.teacher || '—' });
        }
        if ((dSlot.room || '').trim() !== (pSlot.room || '').trim()) {
          changes.push({ field: 'room', label: 'Room', from: pSlot.room || '—', to: dSlot.room || '—' });
        }
        if (Boolean(dSlot.isLab) !== Boolean(pSlot.isLab)) {
          changes.push({ field: 'type', label: 'Type', from: pSlot.isLab ? 'Lab' : 'Theory', to: dSlot.isLab ? 'Lab' : 'Theory' });
        }
        if (Number(dSlot.span || 1) !== Number(pSlot.span || 1)) {
          changes.push({ field: 'span', label: 'Duration', from: `${pSlot.span || 1} Period(s)`, to: `${dSlot.span || 1} Period(s)` });
        }

        modified.push({
          day: dSlot.day,
          period: dSlot.period,
          before: {
            subject: pSlot.subject || '',
            teacher: pSlot.teacher || '',
            room: pSlot.room || '',
            isLab: Boolean(pSlot.isLab),
            span: Number(pSlot.span || 1)
          },
          after: {
            subject: dSlot.subject || '',
            teacher: dSlot.teacher || '',
            room: dSlot.room || '',
            isLab: Boolean(dSlot.isLab),
            span: Number(dSlot.span || 1)
          },
          changes
        });

        if (dSlot.teacher === pSlot.teacher) {
          bumpTeacher(dSlot.teacher, 'modified');
        } else {
          bumpTeacher(dSlot.teacher, 'added');
          bumpTeacher(pSlot.teacher, 'removed');
        }
      } else {
        unchangedCount += 1;
      }
    }
  });

  // Detect removed slots
  prodMap.forEach((pSlot, key) => {
    if (!draftMap.has(key)) {
      removed.push({
        day: pSlot.day,
        period: pSlot.period,
        subject: pSlot.subject || '',
        teacher: pSlot.teacher || '',
        room: pSlot.room || '',
        isLab: Boolean(pSlot.isLab),
        span: Number(pSlot.span || 1)
      });
      bumpTeacher(pSlot.teacher, 'removed');
    }
  });

  // Resolve affected teachers
  const teacherNames = Array.from(teacherStats.keys());
  const teacherDocs = teacherNames.length ? await M.Teacher.find({
    fullName: { $in: teacherNames }
  }).select('_id fullName trackId email employeeNo').lean() : [];
  const teacherDocMap = new Map();
  teacherDocs.forEach(t => teacherDocMap.set(t.fullName, t));

  const affectedTeachers = teacherNames.map(name => {
    const stats = teacherStats.get(name);
    const doc = teacherDocMap.get(name);
    return {
      name,
      teacherId: doc ? doc._id : null,
      trackId: doc ? doc.trackId : '',
      email: doc ? doc.email : '',
      totalChanges: stats.total,
      added: stats.added,
      removed: stats.removed,
      modified: stats.modified
    };
  });

  // Count enrolled students in target class
  const affectedStudentsCount = await M.Student.countDocuments({
    classId: draftTemplate.classId
  });

  const cls = await M.Class.findById(draftTemplate.classId).select('name deptName deptId').lean();

  return {
    className: cls ? cls.name : 'Unknown Class',
    classId: draftTemplate.classId,
    draftVersion: draftTemplate.version || 1,
    targetVersion: (draftTemplate.version || 1) + 1,
    stats: {
      affectedStudentsCount,
      affectedTeachersCount: affectedTeachers.length,
      totalDraftSlots: draftGrid.length,
      totalProdSlots: prodGrid.length,
      addedCount: added.length,
      removedCount: removed.length,
      modifiedCount: modified.length,
      unchangedCount
    },
    diff: {
      added,
      removed,
      modified
    },
    affectedTeachers
  };
}

router.get('/semester-templates/:id/publish-preview', requireManager, async (req, res) => {
  try {
    const template = await M.SemesterTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const preview = await computePublishDiff(template);
    const conflicts = await detectConflicts(template.grid || [], template.classId, template._id);

    res.json({
      ok: true,
      data: {
        ...preview,
        conflicts
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/semester-templates/:id/publish', requireManager, async (req, res) => {
  try {
    const template = await M.SemesterTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    // Gate check: non-exempt users cannot publish unapproved drafts if requireHodApproval is enabled
    const isExempt = req.user.role === 'admin' || req.user.isHod === true;
    if (!isExempt) {
      const modelsSetting = await M.Settings.findOne({ key: 'models' }).lean();
      const requireApproval = modelsSetting?.value?.requireHodApproval !== false;
      if (requireApproval) {
        const hasApprovedVersion = await M.TimetableVersion.exists({
          classId: template.classId,
          verificationStatus: 'approved'
        });
        if (template.status !== 'approved' && !hasApprovedVersion) {
          return res.status(403).json({
            error: 'Direct live publishing is disabled. Timetable changes must be approved by HOD before publishing.'
          });
        }
      }
    }

    // Server-side conflict detection before publish
    const conflicts = await detectConflicts(template.grid || [], template.classId, template._id);
    if (conflicts.length) {
      return res.status(409).json({
        error: `Cannot publish: ${conflicts.length} conflict(s) detected`,
        conflicts
      });
    }

    // Compute diff and affected records before snapshot & state update
    const diffInfo = await computePublishDiff(template);

    const summary = req.body.changeSummary || `Published v${(template.version || 1) + 1} (${diffInfo.stats.addedCount} added, ${diffInfo.stats.modifiedCount} modified, ${diffInfo.stats.removedCount} removed)`;
    const published = await snapshotAndPublish(template, req, summary);

    // Notification Fan-Out (if notifyUsers is not explicitly false)
    const notifyUsers = req.body.notifyUsers !== false;
    let notifResult = { teachersNotified: 0, studentsNotified: 0 };

    if (notifyUsers) {
      const cls = await M.Class.findById(template.classId).select('name').lean();
      const className = cls ? cls.name : 'your class';

      // 1. Teacher Fan-Out
      const teacherNotifs = [];
      for (const t of diffInfo.affectedTeachers) {
        let msg = `Official timetable updated for ${className} (v${published.version}): `;
        const parts = [];
        if (t.added > 0) parts.push(`${t.added} new slot${t.added > 1 ? 's' : ''}`);
        if (t.modified > 0) parts.push(`${t.modified} modified slot${t.modified > 1 ? 's' : ''}`);
        if (t.removed > 0) parts.push(`${t.removed} removed slot${t.removed > 1 ? 's' : ''}`);
        msg += parts.join(', ') || 'Schedule revised';

        teacherNotifs.push({
          type: 'info',
          from: req.user.name || 'Timetable Coordinator',
          fromRole: req.user.role || 'Admin',
          toTeacherId: t.teacherId || null,
          toTeacherTrackId: t.trackId || '',
          toTeacherName: t.name,
          message: msg,
          priority: 'Normal',
          status: 'Pending',
          time: new Date()
        });
      }

      if (teacherNotifs.length) {
        await M.Notification.insertMany(teacherNotifs, { ordered: false }).catch(err => {
          console.warn('Teacher timetable notification error:', err.message);
        });
        notifResult.teachersNotified = teacherNotifs.length;
      }

      // 2. Student Fan-Out
      const students = await M.Student.find({ classId: template.classId })
        .select('_id trackId fullName registerNo')
        .lean();

      if (students.length) {
        const studentNotifs = students.map(s => ({
          type: 'info',
          from: req.user.name || 'Timetable Coordinator',
          fromRole: req.user.role || 'Admin',
          toStudentId: s._id,
          toStudentTrackId: s.trackId || s.registerNo || '',
          toStudentName: s.fullName,
          message: `Official timetable v${published.version} published for ${className}. Check your updated weekly schedule.`,
          priority: 'Normal',
          status: 'Pending',
          time: new Date()
        }));

        await M.Notification.insertMany(studentNotifs, { ordered: false }).catch(err => {
          console.warn('Student timetable notification error:', err.message);
        });
        notifResult.studentsNotified = studentNotifs.length;
      }
    }

    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Timetable Published',
      `Template v${published.version} published for class ${published.classId} (${diffInfo.stats.addedCount} added, ${diffInfo.stats.modifiedCount} modified, ${diffInfo.stats.removedCount} removed). Notified ${notifResult.teachersNotified} teachers and ${notifResult.studentsNotified} students.`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'action' }
    );

    res.json({
      ok: true,
      data: published,
      diff: diffInfo.diff,
      stats: diffInfo.stats,
      notifications: notifResult
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Week instances ──

router.post('/week-instances', requireManager, async (req, res) => {
  try {
    res.status(201).json(await M.WeekInstance.create(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ── Overrides (date-specific slot changes) ──

router.get('/overrides', async (req, res) => {
  try {
    const filter = {};
    if (req.query.classId) filter.classId = sanitizeToObjectId(req.query.classId);
    if (req.query.date) {
      const dateStr = sanitizeToString(req.query.date);
      if (dateStr) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          const startOfDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
          const endOfDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
          filter.date = { $gte: startOfDay, $lte: endOfDay };
        }
      }
    }
    res.json(await M.Override.find(filter).sort({ date: 1 }).lean());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/overrides', requireManager, async (req, res) => {
  try {
    const override = await M.Override.create(req.body);
    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Timetable Override Created',
      `${req.body.type} on ${req.body.date} period ${req.body.period}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'entry-create' }
    );
    res.status(201).json(override);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ── Version history ──

router.get('/versions', async (req, res) => {
  try {
    const { classId, semesterTemplateId, type } = req.query;
    const filter = {};
    if (type) {
      filter.type = sanitizeToString(type);
    }
    if (semesterTemplateId) {
      filter.semesterTemplateId = sanitizeToObjectId(semesterTemplateId);
    } else if (classId) {
      const cId = sanitizeToObjectId(classId);
      const templates = await M.SemesterTemplate.find({ classId: cId }).select('_id').lean();
      const tIds = templates.map(t => t._id);
      filter.$or = [
        { semesterTemplateId: { $in: tIds } },
        { 'snapshot.classId': cId }
      ];
    }
    const versions = await M.TimetableVersion.find(filter).sort({ publishedAt: -1 }).limit(50).lean();

    // Enrich with class names
    const classIds = [...new Set(versions.map(v => v.snapshot?.classId).filter(Boolean))];
    const classes = await M.Class.find({ _id: { $in: classIds } }).select('_id name department').lean();
    const classMap = new Map(classes.map(c => [String(c._id), c.name]));
    const enriched = versions.map(v => ({
      ...v,
      className: classMap.get(String(v.snapshot?.classId)) || v.snapshot?.className || ''
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/versions/:semesterTemplateId', async (req, res) => {
  try {
    res.json(await M.TimetableVersion.find({
      semesterTemplateId: req.params.semesterTemplateId
    }).sort({ publishedAt: -1 }).lean());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/versions/:id/restore', requireManager, async (req, res) => {
  try {
    let v = await M.TimetableVersion.findById(req.params.id).lean();
    let snapshot;
    let label;
    if (v) {
      snapshot = {
        ...v.snapshot,
        _id: undefined,
        status: 'draft',
        version: (v.snapshot?.version || 1) + 1,
        publishedAt: undefined
      };
      label = v.label;
    } else {
      const tmpl = await M.SemesterTemplate.findById(req.params.id).lean();
      if (!tmpl) return res.status(404).json({ error: 'Version or template not found' });
      snapshot = {
        ...tmpl,
        _id: undefined,
        status: 'draft',
        version: (tmpl.version || 1) + 1
      };
      label = tmpl.name || `v${tmpl.version || 1}`;
    }

    // Archive existing drafts for this class to ensure single clean active draft
    if (snapshot.classId) {
      await M.SemesterTemplate.updateMany(
        { classId: snapshot.classId, status: 'draft' },
        { $set: { status: 'archived' } }
      );
    }

    const restored = await M.SemesterTemplate.create(snapshot);
    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Timetable Version Restored',
      `Restored version ${v.label} as new draft`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'action' }
    );
    res.status(201).json({ ok: true, restoredTo: 'Development', template: restored });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Development & Production Versioning & HoD Verification ──

// ── Auto-Sync Class Assignments from Production Timetable Slots (Change 7) ──
async function syncClassAssignmentsFromSlots(classId, slots, reqUser) {
  if (!classId || !Array.isArray(slots) || !slots.length) return;
  try {
    const cId = sanitizeToObjectId(classId);
    const cls = await M.Class.findById(cId).lean();
    if (!cls) return;

    // Collect all distinct academic subjects and their assigned staff and hall from slots
    const assignmentMap = new Map();
    for (const slot of slots) {
      const subjectName = (slot.subject || slot.subjectName || '').trim();
      const teacherName = (slot.teacher || slot.teacherName || '').trim();
      const hallNo = (slot.room || slot.hallNo || cls.hallNo || '').trim();
      if (!subjectName) continue;

      const key = subjectName.toLowerCase();
      if (!assignmentMap.has(key)) {
        assignmentMap.set(key, {
          rawSubject: subjectName,
          subjectId: slot.subjectId || null,
          teacherName,
          teacherId: slot.teacherId || null,
          hallNo
        });
      }
    }

    if (!assignmentMap.size) return;

    const allSubjects = await M.Subject.find({
      $or: [
        { deptId: cls.deptId },
        { deptCode: cls.deptCode }
      ]
    }).lean();
    const allTeachers = await M.Teacher.find().select('_id fullName name username trackId').lean();

    let syncCount = 0;
    for (const item of assignmentMap.values()) {
      let subjDoc = null;
      if (item.subjectId) {
        subjDoc = allSubjects.find(s => String(s._id) === String(item.subjectId));
      }
      if (!subjDoc) {
        subjDoc = allSubjects.find(s =>
          (s.name && s.name.toLowerCase() === item.rawSubject.toLowerCase()) ||
          (s.code && item.rawSubject.toLowerCase().includes(s.code.toLowerCase())) ||
          (s.subjectCode && item.rawSubject.toLowerCase().includes(s.subjectCode.toLowerCase())) ||
          (s.shortName && item.rawSubject.toLowerCase().includes(s.shortName.toLowerCase()))
        );
      }
      if (!subjDoc) {
        subjDoc = await M.Subject.findOne({
          $or: [
            { name: new RegExp(`^${item.rawSubject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
            { code: item.rawSubject.split(' ')[0] }
          ]
        }).lean();
      }

      let teacherDoc = null;
      if (item.teacherId) {
        teacherDoc = allTeachers.find(t => String(t._id) === String(item.teacherId));
      }
      if (!teacherDoc && item.teacherName) {
        teacherDoc = allTeachers.find(t => {
          const fn = (t.fullName || t.name || t.username || '').toLowerCase();
          return fn === item.teacherName.toLowerCase() || fn.includes(item.teacherName.toLowerCase());
        });
      }

      const resolvedSubjId = subjDoc ? String(subjDoc._id) : (item.subjectId ? String(item.subjectId) : null);
      const resolvedTeacherId = teacherDoc ? String(teacherDoc._id) : (item.teacherId ? String(item.teacherId) : 'unassigned');
      const resolvedTeacherName = teacherDoc ? (teacherDoc.fullName || teacherDoc.name || item.teacherName) : (item.teacherName || 'Faculty Member');

      if (resolvedSubjId) {
        await M.Assignment.findOneAndUpdate(
          { classId: String(cls._id), subjectId: resolvedSubjId },
          {
            classId: String(cls._id),
            className: cls.name,
            subjectId: resolvedSubjId,
            subjectName: subjDoc ? subjDoc.name : item.rawSubject,
            teacherId: resolvedTeacherId,
            teacherName: resolvedTeacherName,
            hallNo: item.hallNo || cls.hallNo || 'LH 101',
            deptName: cls.deptName || '',
            deptCode: cls.deptCode || '',
            remarks: 'Auto-synchronized from approved production timetable'
          },
          { upsert: true, returnDocument: 'after' }
        );
        syncCount++;
      }
    }

    if (syncCount > 0) {
      await logAction(
        reqUser?.trackId || reqUser?._id, reqUser?.name || 'System', reqUser?.role || 'admin',
        'Class Assignments Auto-Synchronized',
        `Synchronized ${syncCount} assignments for ${cls.name} from production timetable`,
        'data', 'info', undefined, reqUser?.sessionId,
        { module: 'timetable', subType: 'sync-assignments', classId: cls._id, count: syncCount }
      );
    }
  } catch (err) {
    console.warn('[syncClassAssignmentsFromSlots error]:', err.message);
  }
}

router.post('/save-development', requireManager, async (req, res) => {
  try {
    const { classId, slots, versionName, notes } = req.body;
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    const cId = sanitizeToObjectId(classId);
    const cls = await M.Class.findById(cId).lean();
    const className = cls?.name || req.body.className || 'General';

    const normalizedSlots = normalizeGridSlots(slots);

    const lastDev = await M.TimetableVersion.findOne({
      classId: cId,
      type: 'development'
    }).sort({ version: -1 }).lean();
    const nextVer = (lastDev?.version || 0) + 1;
    const finalName = versionName?.trim() || `Draft v${nextVer}`;

    const versionDoc = await M.TimetableVersion.create({
      classId: cId,
      className,
      type: 'development',
      version: nextVer,
      versionName: finalName,
      label: `Draft v${nextVer}`,
      changeSummary: notes || `Development draft saved (${normalizedSlots.length} slots)`,
      snapshot: { classId: cId, className, slots: normalizedSlots },
      status: 'draft',
      savedBy: req.user.name,
      publishedBy: req.user.name,
      publishedAt: new Date()
    });

    let draftTemplate = await M.SemesterTemplate.findOne({ classId: cId, status: 'draft' });
    if (draftTemplate) {
      draftTemplate.grid = normalizedSlots;
      draftTemplate.version = nextVer;
      draftTemplate.versionName = finalName;
      await draftTemplate.save();
    } else {
      draftTemplate = await M.SemesterTemplate.create({
        classId: cId,
        status: 'draft',
        version: nextVer,
        versionName: finalName,
        grid: normalizedSlots
      });
    }

    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Development Timetable Saved',
      `Saved ${finalName} for ${className}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'save-development', versionId: versionDoc._id }
    );

    res.json({ ok: true, data: versionDoc, templateId: draftTemplate._id, message: `Development draft saved as ${finalName}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/save-production', requireManager, async (req, res) => {
  try {
    // Gate check: exempt Admins and HODs (since they are approvers)
    const isExempt = req.user.role === 'admin' || req.user.isHod === true;
    if (!isExempt) {
      const modelsSetting = await M.Settings.findOne({ key: 'models' }).lean();
      // If setting is unset/undefined in DB, default to true (gate ON)
      const requireApproval = modelsSetting?.value?.requireHodApproval !== false;
      if (requireApproval) {
        return res.status(403).json({
          error: 'Direct live publishing is disabled. Timetable changes must be submitted for HOD approval.'
        });
      }
    }

    const { classId, slots, versionName, notes } = req.body;
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    const cId = sanitizeToObjectId(classId);
    const cls = await M.Class.findById(cId).lean();
    const className = cls?.name || req.body.className || 'General';

    const normalizedSlots = normalizeGridSlots(slots);

    const lastProd = await M.TimetableVersion.findOne({
      classId: cId,
      type: 'production'
    }).sort({ version: -1 }).lean();
    const nextVer = (lastProd?.version || 0) + 1;
    const finalName = versionName?.trim() || `Production v${nextVer}`;

    const versionDoc = await M.TimetableVersion.create({
      classId: cId,
      className,
      type: 'production',
      version: nextVer,
      versionName: finalName,
      label: `Production v${nextVer}`,
      changeSummary: notes || `Production version saved (${normalizedSlots.length} slots)`,
      snapshot: { classId: cId, className, slots: normalizedSlots },
      status: 'published',
      publishedBy: req.user.name,
      publishedAt: new Date()
    });

    const slotsObj = gridToSlotsObj(normalizedSlots, className);
    await M.SectionTimetable.findOneAndUpdate(
      { classId: cId },
      {
        slots: slotsObj,
        updatedBy: req.user.name,
        className,
        ...(cls ? { deptId: cls.deptId, deptName: cls.deptName } : {})
      },
      { upsert: true }
    );

    // Create new published template FIRST before archiving old ones
    const newTemplate = await M.SemesterTemplate.create({
      classId: cId,
      status: 'published',
      version: nextVer,
      versionName: finalName,
      grid: normalizedSlots,
      publishedAt: new Date(),
      publishedBy: req.user.name
    });
    await M.SemesterTemplate.updateMany(
      { classId: cId, status: 'published', _id: { $ne: newTemplate._id } },
      { $set: { status: 'archived' } }
    );

    // Auto-sync class assignments from approved production timetable slots (Change 7)
    await syncClassAssignmentsFromSlots(cId, normalizedSlots, req.user);
    invalidateProductionCache();

    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Production Timetable Saved',
      `Saved ${finalName} for ${className}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'save-production', versionId: versionDoc._id }
    );

    res.json({ ok: true, data: versionDoc, message: `Production timetable saved as ${finalName}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verification-requests', requireManager, async (req, res) => {
  try {
    const { classId, slots, versionName, notes } = req.body;
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    const cId = sanitizeToObjectId(classId);
    const cls = await M.Class.findById(cId).lean();
    const className = cls?.name || 'Class';
    const deptId = cls?.deptId;
    const dept = deptId ? await M.Department.findById(deptId).lean() : null;

    const normalizedSlots = normalizeGridSlots(slots);

    const lastProd = await M.TimetableVersion.findOne({ classId: cId, type: 'production' }).sort({ version: -1 }).lean();
    const nextVer = (lastProd?.version || 0) + 1;
    const finalName = versionName?.trim() || `Production v${nextVer} (Pending Verification)`;

    const versionDoc = await M.TimetableVersion.create({
      classId: cId,
      className,
      type: 'production',
      version: nextVer,
      versionName: finalName,
      label: `Production v${nextVer}`,
      changeSummary: notes || `Submitted for HoD verification (${normalizedSlots.length} slots)`,
      snapshot: { classId: cId, className, slots: normalizedSlots },
      status: 'pending_approval',
      savedBy: req.user.name,
      verificationStatus: 'pending',
      verificationRequest: {
        requestedBy: req.user.name,
        requestedAt: new Date(),
        notes: notes || 'Draft ready for departmental verification',
        hodId: dept?.hodId || null,
        hodName: dept?.hodName || ''
      }
    });

    await M.SemesterTemplate.updateMany(
      { classId: cId, status: 'draft' },
      { $set: { status: 'pending_approval' } }
    );

    if (dept?.hodId) {
      await M.Notification.create({
        type: 'request',
        from: req.user.name,
        fromRole: req.user.role,
        toUserId: dept.hodId,
        message: `Timetable verification request submitted for ${className} (${finalName}) by ${req.user.name}. Please review and approve.`,
        priority: 'High',
        status: 'Pending',
        time: new Date()
      }).catch(e => console.warn('HoD notification error:', e.message));
    }

    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Timetable Verification Requested',
      `Submitted ${className} to HoD for approval`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'verification-request', versionId: versionDoc._id }
    );

    res.json({ ok: true, data: versionDoc, message: 'Verification request submitted to HoD for approval.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/verification-requests', async (req, res) => {
  try {
    const filter = {
      verificationStatus: { $in: ['pending', 'approved', 'rejected'] }
    };
    if (req.query.classId) filter.classId = sanitizeToObjectId(req.query.classId);
    if (req.query.status) filter.verificationStatus = sanitizeToString(req.query.status);
    const requests = await M.TimetableVersion.find(filter).sort({ 'verificationRequest.requestedAt': -1, updatedAt: -1 }).lean();
    res.json({ ok: true, data: requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verification-requests/:id/review', requireManager, async (req, res) => {
  try {
    const { action, comment } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be approve or reject' });
    }
    const doc = await M.TimetableVersion.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Verification request not found' });

    doc.verificationStatus = action === 'approve' ? 'approved' : 'rejected';
    doc.status = action === 'approve' ? 'approved' : 'rejected';
    doc.verificationRequest = {
      ...doc.verificationRequest,
      approvedBy: req.user.name,
      approvedAt: new Date(),
      comment: comment || ''
    };
    await doc.save();

    if (action === 'approve') {
      await M.SemesterTemplate.updateMany(
        { classId: doc.classId, status: { $in: ['draft', 'pending_approval'] } },
        { $set: { status: 'approved' } }
      );
    } else {
      await M.SemesterTemplate.updateMany(
        { classId: doc.classId, status: 'pending_approval' },
        { $set: { status: 'draft' } }
      );
    }

    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      `Timetable Verification ${action === 'approve' ? 'Approved' : 'Rejected'}`,
      `${doc.className} ${doc.versionName}: ${comment || ''}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'verification-review', versionId: doc._id }
    );

    res.json({ ok: true, data: doc, message: `Timetable ${action === 'approve' ? 'approved' : 'rejected'} successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verification-requests/:id/publish-all', requireManager, async (req, res) => {
  try {
    const doc = await M.TimetableVersion.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Record not found' });
    if (doc.verificationStatus !== 'approved') {
      return res.status(400).json({ error: 'Cannot publish: timetable has not been approved by HoD.' });
    }

    const rawSlots = doc.snapshot?.slots || [];
    const normalizedSlots = normalizeGridSlots(rawSlots);
    const classId = doc.classId;
    const className = doc.className;

    const slotsObj = gridToSlotsObj(normalizedSlots, className);

    await M.SectionTimetable.findOneAndUpdate(
      { classId },
      {
        slots: slotsObj,
        updatedBy: req.user.name,
        className
      },
      { upsert: true }
    );

    const newTemplate = await M.SemesterTemplate.create({
      classId,
      status: 'published',
      version: doc.version || 1,
      versionName: doc.versionName || `Production v${doc.version || 1}`,
      grid: normalizedSlots,
      publishedAt: new Date(),
      publishedBy: req.user?.name || 'Coordinator'
    });

    await M.SemesterTemplate.updateMany(
      { classId, status: 'published', _id: { $ne: newTemplate._id } },
      { $set: { status: 'archived' } }
    );

    doc.status = 'published';
    doc.publishedAt = new Date();
    doc.publishedBy = req.user?.name || 'Coordinator';
    await doc.save();

    // Auto-sync class assignments from approved production timetable slots (Change 7)
    await syncClassAssignmentsFromSlots(classId, normalizedSlots, req.user);

    const cls = await M.Class.findById(classId).lean();
    if (cls) {
      const students = await M.User.find({ classId, role: 'student' }).select('_id').lean();
      const notifs = students.map(s => ({
        type: 'info',
        from: req.user.name || 'Timetable Coordinator',
        fromRole: 'Admin',
        toUserId: s._id,
        message: `Official approved timetable for ${className} (${doc.versionName}) is now live.`,
        priority: 'Normal',
        status: 'Pending',
        time: new Date()
      }));
      if (notifs.length) {
        await M.Notification.insertMany(notifs, { ordered: false }).catch(() => {});
      }
    }

    invalidateProductionCache();

    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Timetable Published to All',
      `Official publish of ${doc.versionName} for ${className}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'publish-all', versionId: doc._id }
    );

    res.json({ ok: true, data: doc, message: `Official timetable ${doc.versionName} published to all successfully!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/faculty-schedule', requireDevAccess, async (req, res) => {
  try {
    const { teacherName } = req.query;
    if (!teacherName) return res.status(400).json({ error: 'teacherName is required' });
    const env = sanitizeToString(req.query.env || 'production').toLowerCase();

    const regex = new RegExp(`^${escapeRegex(teacherName)}$`, 'i');
    const sectionTimetables = await getSlotSource(env, null, req.query.deptId || null);
    const facultySlots = [];

    sectionTimetables.forEach(st => {
      const clsName = st.className || 'General';
      const slots = st.slots || {};
      Object.values(slots).forEach(slot => {
        if (slot && slot.teacher && regex.test(slot.teacher.trim())) {
          facultySlots.push({
            ...slot,
            section: clsName,
            classId: st.classId,
            _source: st._source || env
          });
        }
      });
    });

    if (env === 'production') {
      const directSlots = await M.Timetable.find({ teacherName: regex }).lean();
      const timeToPeriodNum = (start) => {
        if (!start) return 1;
        const timeMap = {
          '08:30': 1, '09:15': 2, '10:00': 3, '10:15': 3,
          '11:00': 4, '11:45': 5, '12:30': 6, '14:00': 7,
          '14:45': 8, '15:45': 9
        };
        return timeMap[start] || (parseInt(String(start).replace(/\D/g, ''), 10) || 1);
      };

      directSlots.forEach(ds => {
        const dayMap = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
        const fullDay = dayMap[ds.day] || ds.day;
        const dsPNum = timeToPeriodNum(ds.start);
        const alreadyHas = facultySlots.some(s => {
          if (s.day !== fullDay || s.section !== ds.className) return false;
          if (s.start && ds.start) return s.start === ds.start;
          const sPNum = typeof s.period === 'number' ? s.period : (parseInt(String(s.period || '').replace(/\D/g, ''), 10) || null);
          if (sPNum && dsPNum) return sPNum === dsPNum;
          return s.subject && ds.subjectName && s.subject.trim().toLowerCase() === ds.subjectName.trim().toLowerCase();
        });
        if (!alreadyHas) {
          facultySlots.push({
            id: String(ds._id),
            day: fullDay,
            period: `P${dsPNum}`,
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
    }

    res.json({ ok: true, teacherName, env, slots: facultySlots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Teacher Schedule & Timetable Endpoints (Phase 2 Resolver) ──

router.get('/my-timetable', async (req, res) => {
  try {
    if (!['teacher', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Access denied. Teacher or admin role required.' });
    }
    const trackIdOverride = req.user.role === 'admin' && req.query.teacherTrackId
      ? sanitizeToString(req.query.teacherTrackId)
      : null;
    const idn = await getTeacherIdentity(req.user, trackIdOverride);
    if (!idn) {
      return res.status(404).json({ error: 'Teacher record not found for the specified identity.' });
    }
    const template = await buildWeeklyTemplate(idn);
    res.json({
      ok: true,
      data: {
        teacher: { name: idn.fullName, trackId: idn.trackId, _id: idn._id },
        timingSets: template.timingSets,
        slots: template.slots
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/my-schedule', async (req, res) => {
  try {
    if (!['teacher', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Access denied. Teacher or admin role required.' });
    }
    const trackIdOverride = req.user.role === 'admin' && req.query.teacherTrackId
      ? sanitizeToString(req.query.teacherTrackId)
      : null;
    const idn = await getTeacherIdentity(req.user, trackIdOverride);
    if (!idn) {
      return res.status(404).json({ error: 'Teacher record not found for the specified identity.' });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const fromStr = sanitizeToString(req.query.from || todayStr);
    const toStr = sanitizeToString(req.query.to || fromStr);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD.' });
    }

    const days = await resolveTeacherRange(idn, fromStr, toStr);
    res.json({
      ok: true,
      data: {
        teacher: { name: idn.fullName, trackId: idn.trackId },
        from: fromStr,
        to: toStr,
        days
      }
    });
  } catch (err) {
    if (err.message && (err.message.includes('Invalid date') || err.message.includes('limit of 14 days'))) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/free-room-slots', requireDevAccess, async (req, res) => {
  try {
    const { roomName } = req.query;
    const env = sanitizeToString(req.query.env || 'production').toLowerCase();
    const sectionTimetables = await getSlotSource(env, null, req.query.deptId || null);
    const occupiedMap = new Map();

    sectionTimetables.forEach(st => {
      const clsName = st.className || 'General';
      const slots = st.slots || {};
      Object.values(slots).forEach(slot => {
        if (slot && slot.room) {
          const rKey = slot.room.trim().toLowerCase();
          const dur = Number(slot.span || slot.duration || 1);
          const pNum = typeof slot.period === 'number'
            ? slot.period
            : (parseInt(String(slot.period || '1').replace(/\D/g, ''), 10) || 1);
          for (let i = 0; i < dur; i++) {
            const pCode = `P${pNum + i}`;
            const key = `${rKey}:${slot.day}:${pCode}`;
            occupiedMap.set(key, { ...slot, section: clsName, _source: st._source || env });
          }
        }
      });
    });

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const periods = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'];

    if (roomName) {
      const rKey = roomName.trim().toLowerCase();
      const freeSlots = [];
      const occupiedSlots = [];

      days.forEach(day => {
        periods.forEach(p => {
          const key = `${rKey}:${day}:${p}`;
          const occ = occupiedMap.get(key);
          if (occ) {
            occupiedSlots.push({ day, period: p, ...occ });
          } else {
            freeSlots.push({ day, period: p, room: roomName });
          }
        });
      });

      return res.json({ ok: true, roomName, env, freeSlots, occupiedSlots });
    }

    const allRooms = await M.Room.find({ status: { $ne: 'Inactive' } }).select('hallNo name category type capacity buildingName').lean();
    const roomSummary = allRooms.map(r => {
      const rKey = (r.hallNo || r.name).trim().toLowerCase();
      let occupiedCount = 0;
      days.forEach(day => {
        periods.forEach(p => {
          if (occupiedMap.has(`${rKey}:${day}:${p}`)) occupiedCount++;
        });
      });
      const totalAvailablePeriods = days.length * periods.length;
      const freeCount = totalAvailablePeriods - occupiedCount;
      return {
        room: r.hallNo || r.name,
        name: r.name,
        capacity: r.capacity,
        type: r.type,
        building: r.buildingName,
        occupiedPeriods: occupiedCount,
        freePeriods: freeCount,
        utilizationPct: Math.round((occupiedCount / totalAvailablePeriods) * 100)
      };
    });

    res.json({ ok: true, rooms: roomSummary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Substitution requests ──

router.get('/substitutions', async (req, res) => {
  try {
    res.json(await M.SubstitutionRequest.find().sort({ createdAt: -1 }).lean());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/substitutions', async (req, res) => {
  try {
    const sub = await M.SubstitutionRequest.create({
      ...req.body,
      teacherId: req.user._id,
      teacherName: req.user.name
    });
    res.status(201).json(sub);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/substitutions/:id/:decision', requireManager, async (req, res) => {
  try {
    if (!['approve', 'reject'].includes(req.params.decision)) {
      return res.status(400).json({ error: 'Invalid decision — must be approve or reject' });
    }
    const sub = await M.SubstitutionRequest.findByIdAndUpdate(
      req.params.id,
      {
        status: req.params.decision === 'approve' ? 'approved' : 'rejected',
        approvedBy: req.user.name
      },
      { returnDocument: 'after' }
    );
    if (!sub) return res.status(404).json({ error: 'Substitution request not found' });
    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      `Substitution ${req.params.decision === 'approve' ? 'Approved' : 'Rejected'}`,
      `Request ${req.params.id} by ${sub.teacherName}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'action' }
    );
    res.json(sub);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ── Exports ──

router.get('/exports/:type', requireManager, requireDevAccess, async (req, res) => {
  try {
    const { type } = req.params;
    const { classId } = req.query;
    const env = sanitizeToString(req.query.env || 'production').toLowerCase();
    const deptId = req.query.deptId ? sanitizeToObjectId(req.query.deptId) : null;
    const slotSources = await getSlotSource(env, classId ? sanitizeToObjectId(classId) : null, deptId);

    if (type === 'workload') {
      const map = new Map();
      slotSources.forEach(st => {
        Object.values(st.slots || {}).forEach(slot => {
          if (!slot || !slot.teacher) return;
          const current = map.get(slot.teacher) || { teacher: slot.teacher, theory: 0, lab: 0, total: 0 };
          const span = Number(slot.span || 1);
          if (slot.isLab) current.lab += span;
          else current.theory += span;
          current.total += span;
          map.set(slot.teacher, current);
        });
      });
      rows = Array.from(map.values());
    } else if (type === 'rooms') {
      const map = new Map();
      slotSources.forEach(st => {
        Object.values(st.slots || {}).forEach(slot => {
          if (!slot || !slot.room) return;
          const current = map.get(slot.room) || { room: slot.room, count: 0, classes: new Set() };
          current.count += Number(slot.span || 1);
          if (st.classId) current.classes.add(String(st.classId));
          map.set(slot.room, current);
        });
      });
      rows = Array.from(map.values()).map(r => ({ ...r, classes: Array.from(r.classes) }));
    } else {
      slotSources.forEach(st => {
        Object.values(st.slots || {}).forEach(slot => {
          if (!slot) return;
          rows.push({
            class: st.className || 'Class',
            classId: st.classId,
            day: slot.day,
            period: slot.period,
            span: slot.span || 1,
            subject: slot.subject,
            teacher: slot.teacher,
            room: slot.room,
            isLab: slot.isLab || false,
            combinedWith: slot.combinedWith || [],
            source: st._source || env
          });
        });
      });
    }

    res.json({
      ok: true,
      data: {
        type,
        env,
        watermark: env === 'development' ? 'DRAFT — UNFINALIZED' : 'LIVE — PRODUCTION',
        sourcesSummary: {
          totalClasses: slotSources.length,
          developmentDrafts: slotSources.filter(s => s._source === 'development').length,
          productionFallbacks: slotSources.filter(s => s._source === 'production').length
        },
        generatedAt: new Date().toISOString(),
        count: rows.length,
        rows
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ══════════════════════════════════════════════════════
//  TEACHER FREE-SLOT FINDER (Item 11 & Calendar Item 12)
// ══════════════════════════════════════════════════════

router.get('/free-teachers', async (req, res) => {
  try {
    const dateStr = sanitizeToString(req.query.date) || new Date().toISOString().split('T')[0];
    const dateObj = new Date(dateStr + 'T00:00:00.000Z');
    const dayIndex = isNaN(dateObj.getTime()) ? new Date().getDay() : dateObj.getUTCDay();
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = daysOfWeek[dayIndex];
    const targetPeriod = req.query.periodNumber
      ? parseInt(req.query.periodNumber, 10)
      : (req.query.period ? parseInt(req.query.period, 10) : null);

    // 1. Holiday & Calendar check
    const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
    const endOfDay = new Date(dateStr + 'T23:59:59.999Z');
    const calendarDay = await M.CalendarDay.findOne({
      date: { $gte: startOfDay, $lte: endOfDay }
    }).lean();

    let isHoliday = false;
    let holidayReason = '';
    if (calendarDay?.details?.length) {
      const holDetail = calendarDay.details.find(d => ['holiday', 'vacation', 'exam', 'event'].includes(d.dayType));
      if (holDetail) {
        isHoliday = true;
        holidayReason = holDetail.comments || `Academic Calendar: ${holDetail.dayType.toUpperCase()}`;
      }
    }
    if (dayName === 'Sunday') {
      isHoliday = true;
      holidayReason = holidayReason || 'Sunday (Non-working day)';
    }

    // 2. Query Teachers
    const teacherFilter = { status: { $ne: 'Inactive' } };
    if (req.query.deptId && req.query.deptId !== 'all') {
      teacherFilter.deptId = sanitizeToObjectId(req.query.deptId);
    }
    if (req.query.search) {
      const s = sanitizeToString(req.query.search);
      teacherFilter.$or = [
        { fullName: { $regex: s, $options: 'i' } },
        { trackId: { $regex: s, $options: 'i' } },
        { employeeNo: { $regex: s, $options: 'i' } }
      ];
    }
    const teachers = await M.Teacher.find(teacherFilter).select('_id trackId fullName deptId employeeNo').sort({ fullName: 1 }).lean();

    // 3. Query approved leaves covering dateStr
    const leaves = await M.TeacherLeaveRequest.find({
      status: 'Approved',
      $or: [
        { dates: dateStr },
        { fromDate: { $lte: dateStr }, toDate: { $gte: dateStr } }
      ]
    }).lean();

    const leaveMap = new Map();
    leaves.forEach(l => {
      if (l.teacherTrackId) leaveMap.set(l.teacherTrackId, l);
      if (l.teacherId) leaveMap.set(String(l.teacherId), l);
    });

    // 4. Query published timetable teaching slots for dayName from BOTH SemesterTemplate and SectionTimetable (T5)
    const [publishedTemplates, sectionTimetables, legacySlots] = await Promise.all([
      M.SemesterTemplate.find({ status: 'published' }).lean(),
      M.SectionTimetable.find().lean(),
      M.Timetable.find({ day: dayName, isDraft: false }).lean()
    ]);
    const teachingSlots = new Set();

    publishedTemplates.forEach(tpl => {
      (tpl.grid || []).forEach(slot => {
        if (!slot || slot.day !== dayName) return;
        const span = Number(slot.span || 1);
        const startP = typeof slot.period === 'number' ? slot.period : parseInt(String(slot.period).replace(/\D/g, ''), 10) || 1;
        const teacherName = slot.teacher || slot.teacherName;
        const teacherId = slot.teacherId ? String(slot.teacherId) : null;
        const teacherTrackId = slot.teacherTrackId;

        for (let p = startP; p < startP + span; p++) {
          if (teacherName) teachingSlots.add(`name:${teacherName.toLowerCase()}:${p}`);
          if (teacherId) teachingSlots.add(`id:${teacherId}:${p}`);
          if (teacherTrackId) teachingSlots.add(`track:${teacherTrackId}:${p}`);
        }
      });
    });

    sectionTimetables.forEach(st => {
      const slots = Object.values(st.slots || {});
      slots.forEach(slot => {
        if (!slot || slot.day !== dayName) return;
        const span = Number(slot.span || 1);
        const startP = typeof slot.period === 'number' ? slot.period : parseInt(String(slot.period).replace(/\D/g, ''), 10) || 1;
        const teacherName = slot.teacher || slot.teacherName;
        const teacherId = slot.teacherId ? String(slot.teacherId) : null;
        const teacherTrackId = slot.teacherTrackId;

        for (let p = startP; p < startP + span; p++) {
          if (teacherName) teachingSlots.add(`name:${teacherName.toLowerCase()}:${p}`);
          if (teacherId) teachingSlots.add(`id:${teacherId}:${p}`);
          if (teacherTrackId) teachingSlots.add(`track:${teacherTrackId}:${p}`);
        }
      });
    });

    // Also check legacy Timetable if any
    legacySlots.forEach(s => {
      const p = s.periodNumber || s.startPeriod || 1;
      if (s.staffName) teachingSlots.add(`name:${s.staffName.toLowerCase()}:${p}`);
      if (s.staffTrackId) teachingSlots.add(`track:${s.staffTrackId}:${p}`);
    });

    // 5. Query Day Overrides for dateObj
    const dayOverrides = await M.Override.find({
      date: { $gte: startOfDay, $lte: endOfDay }
    }).lean();

    // 6. Build per-teacher results
    const resultTeachers = teachers.map(t => {
      const periodStatus = {};
      const teacherNameLower = (t.fullName || '').toLowerCase();

      for (let p = 1; p <= 9; p++) {
        if (isHoliday) {
          periodStatus[p] = 'holiday';
          continue;
        }

        // Leave check
        const tLeave = leaveMap.get(t.trackId) || leaveMap.get(String(t._id));
        if (tLeave) {
          let onLeave = true;
          if (tLeave.slot === 'FN' && p > 4) onLeave = false;
          if (tLeave.slot === 'AN' && p <= 4) onLeave = false;
          if (onLeave) {
            periodStatus[p] = 'leave';
            continue;
          }
        }

        // Override check: substitute assigned to this teacher (support both teacher & teacherName)
        const subIn = dayOverrides.find(ov =>
          ov.period === p &&
          ov.type === 'substitute' &&
          (
            (ov.newSlot?.teacherTrackId && ov.newSlot.teacherTrackId === t.trackId) ||
            ((ov.newSlot?.teacherName || ov.newSlot?.teacher || '').toLowerCase() === teacherNameLower)
          )
        );
        if (subIn) {
          periodStatus[p] = 'teaching';
          continue;
        }

        // Override check: cancelled or substituted away from this teacher
        const outOv = dayOverrides.find(ov =>
          ov.period === p &&
          (ov.type === 'cancelled' || ov.type === 'substitute') &&
          (
            (ov.originalSlot?.teacherTrackId && ov.originalSlot.teacherTrackId === t.trackId) ||
            ((ov.originalSlot?.teacherName || ov.originalSlot?.teacher || '').toLowerCase() === teacherNameLower)
          )
        );
        if (outOv) {
          periodStatus[p] = 'free';
          continue;
        }

        // Regular scheduled teaching check
        const isTeaching = teachingSlots.has(`track:${t.trackId}:${p}`) ||
                           teachingSlots.has(`id:${String(t._id)}:${p}`) ||
                           teachingSlots.has(`name:${teacherNameLower}:${p}`);

        periodStatus[p] = isTeaching ? 'teaching' : 'free';
      }

      const isFreeForTarget = targetPeriod
        ? (periodStatus[targetPeriod] === 'free')
        : Object.values(periodStatus).some(s => s === 'free');

      const targetPeriodStatus = targetPeriod
        ? periodStatus[targetPeriod]
        : (isFreeForTarget ? 'free' : 'busy');

      return {
        _id: t._id,
        trackId: t.trackId,
        fullName: t.fullName,
        deptId: t.deptId,
        employeeNo: t.employeeNo,
        periodStatus,
        isFreeForTarget,
        targetPeriodStatus
      };
    });

    const availableCount = resultTeachers.filter(t => t.isFreeForTarget).length;

    res.json({
      ok: true,
      date: dateStr,
      day: dayName,
      targetPeriod,
      isHoliday,
      holidayReason,
      availableCount,
      teachers: resultTeachers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ══════════════════════════════════════════════════════
//  LEAVE & SUBSTITUTION INTEGRATION (Item 6)
// ══════════════════════════════════════════════════════

router.get('/substitutions-and-leaves', async (req, res) => {
  try {
    const { classId, className, date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const dateStr = targetDate.toISOString().slice(0, 10);
    const startOfDay = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 23, 59, 59, 999));

    let targetClassId = null;
    if (classId && mongoose.isValidObjectId(classId)) {
      targetClassId = sanitizeToObjectId(classId);
    } else if (className) {
      const cls = await M.Class.findOne({ name: className }).lean();
      if (cls) targetClassId = cls._id;
    }

    // 1. Fetch overrides with type: 'substitute'
    const overrideFilter = {
      type: 'substitute',
      date: { $gte: startOfDay, $lte: endOfDay }
    };
    if (targetClassId) overrideFilter.classId = targetClassId;

    const overrides = await M.Override.find(overrideFilter).populate('classId', 'name').lean();

    // 2. Fetch approved teacher leaves covering targetDate
    const leaves = await M.TeacherLeaveRequest.find({
      status: 'Approved',
      $or: [
        { dates: dateStr },
        { fromDate: { $lte: dateStr }, toDate: { $gte: dateStr } }
      ]
    }).lean();

    // 3. Extract substitutions from leave requests
    const leaveSubstitutions = [];
    leaves.forEach(l => {
      (l.substitutions || []).forEach(sub => {
        if (sub.date === dateStr) {
          if (!targetClassId || String(sub.classId) === String(targetClassId) || (className && sub.className === className)) {
            leaveSubstitutions.push({
              source: 'leave',
              leaveId: l._id,
              day: sub.day,
              period: sub.periodNumber,
              periodCode: `P${sub.periodNumber}`,
              originalTeacher: l.teacherName,
              originalTeacherId: l.teacherId,
              substituteTeacher: sub.substituteTeacherName,
              substituteTeacherId: sub.substituteTeacherId,
              subject: sub.subjectName,
              hallNo: sub.hallNo,
              status: sub.status || 'pending',
              notes: sub.notes
            });
          }
        }
      });
    });

    // 4. Combine overrides into normalized substitution records
    const normalizedOverrides = overrides.map(ov => {
      const orig = readOverrideSlot(ov.originalSlot);
      const sub = readOverrideSlot(ov.newSlot);
      return {
        source: 'override',
        overrideId: ov._id,
        date: dateStr,
        day: targetDate.toLocaleDateString('en-US', { weekday: 'long' }),
        period: ov.period,
        periodCode: `P${ov.period}`,
        originalTeacher: orig.teacher || 'Original Faculty',
        originalTeacherId: orig.teacherId,
        substituteTeacher: sub.teacher || 'Substitute Faculty',
        substituteTeacherId: sub.teacherId,
        subject: sub.subject || orig.subject,
        room: sub.room || orig.room,
        status: 'approved',
        reason: ov.reason || 'Coordinator Reassignment'
      };
    });

    // Deduplicate by period
    const allSubs = [...leaveSubstitutions];
    normalizedOverrides.forEach(no => {
      if (!allSubs.some(s => s.period === no.period && s.day === no.day)) {
        allSubs.push(no);
      }
    });

    // 5. Active leaves list
    const activeLeaves = leaves.map(l => ({
      teacherId: l.teacherId,
      teacherTrackId: l.teacherTrackId,
      teacherName: l.teacherName,
      leaveType: l.leaveType,
      slot: l.slot,
      fromDate: l.fromDate,
      toDate: l.toDate,
      reason: l.reason
    }));

    res.json({
      ok: true,
      date: dateStr,
      substitutions: allSubs,
      activeLeaves
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/assign-substitute', requireManager, async (req, res) => {
  try {
    const { classId, className, date, day, period, originalTeacher, substituteTeacher, substituteTeacherId, subject, room, reason } = req.body;
    if (!substituteTeacher || !period) {
      return res.status(400).json({ error: 'Substitute teacher name and period are required.' });
    }

    let targetClassId = null;
    if (classId && mongoose.isValidObjectId(classId)) {
      targetClassId = sanitizeToObjectId(classId);
    } else if (className) {
      const cls = await M.Class.findOne({ name: className }).lean();
      if (cls) targetClassId = cls._id;
    }

    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 23, 59, 59, 999));

    const periodNum = typeof period === 'number' ? period : parseInt(String(period).replace(/\D/g, ''), 10) || 1;

    let override = await M.Override.findOne({
      date: { $gte: startOfDay, $lte: endOfDay },
      period: periodNum,
      ...(targetClassId ? { classId: targetClassId } : {})
    });

    if (override) {
      override.type = 'substitute';
      override.newSlot = buildOverrideSlot({
        subject: subject || override.originalSlot?.subject || override.originalSlot?.subjectName,
        teacher: substituteTeacher,
        teacherId: substituteTeacherId || null,
        room: room || override.originalSlot?.room || override.originalSlot?.hallNo
      });
      override.reason = reason || 'Coordinator Substitution';
      override.approvedBy = req.user.name;
      await override.save();
    } else {
      override = await M.Override.create({
        date: targetDate,
        classId: targetClassId,
        period: periodNum,
        type: 'substitute',
        originalSlot: buildOverrideSlot({
          subject,
          teacher: originalTeacher,
          room
        }),
        newSlot: buildOverrideSlot({
          subject,
          teacher: substituteTeacher,
          teacherId: substituteTeacherId || null,
          room
        }),
        reason: reason || 'Coordinator Substitution',
        approvedBy: req.user.name
      });
    }

    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Timetable Substitution Assigned',
      `Substitute ${substituteTeacher} assigned for ${originalTeacher || 'Faculty'} (Period ${periodNum}, ${day || 'day'})`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'substitution', overrideId: override._id }
    );

    res.json({
      ok: true,
      message: `Substitute ${substituteTeacher} assigned successfully.`,
      override
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/assign-substitute/:id', requireManager, async (req, res) => {
  try {
    const override = await M.Override.findByIdAndDelete(req.params.id);
    if (!override) return res.status(404).json({ error: 'Substitution override not found.' });

    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Timetable Substitution Reverted',
      `Substitution override ${req.params.id} reverted.`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'substitution' }
    );

    res.json({ ok: true, message: 'Substitution reverted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ══════════════════════════════════════════════════════
//  ACADEMIC CALENDAR INTEGRATION (Item 12)
// ══════════════════════════════════════════════════════

router.get('/academic-calendar-stats', async (req, res) => {
  try {
    const { classId, startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000);
    const end = endDate ? new Date(endDate) : new Date(Date.now() + 90 * 86400000);

    const calendarDays = await M.CalendarDay.find({
      date: { $gte: start, $lte: end }
    }).sort({ date: 1 }).lean();

    let totalDays = 0;
    let workingDaysCount = 0;
    let holidaysCount = 0;
    let examDaysCount = 0;
    let workingSaturdaysCount = 0;
    const upcomingHolidays = [];
    const workingSaturdays = [];

    calendarDays.forEach(cd => {
      totalDays++;
      const isSat = cd.day === 'Saturday';
      const holDetail = cd.details?.find(d => ['holiday', 'vacation'].includes(d.dayType));
      const workDetail = cd.details?.find(d => d.dayType === 'working');
      const examDetail = cd.details?.find(d => d.dayType === 'exam');

      if (holDetail) {
        holidaysCount++;
        const dStr = cd.date instanceof Date ? cd.date.toISOString().slice(0, 10) : String(cd.date).slice(0, 10);
        upcomingHolidays.push({
          date: dStr,
          day: cd.day,
          name: holDetail.comments || (holDetail.dayType === 'vacation' ? 'Vacation' : 'Holiday'),
          type: holDetail.dayType
        });
      } else if (examDetail) {
        examDaysCount++;
      } else if (workDetail || (!holDetail && cd.day !== 'Sunday' && !isSat)) {
        workingDaysCount++;
        if (isSat && workDetail) {
          workingSaturdaysCount++;
          const dStr = cd.date instanceof Date ? cd.date.toISOString().slice(0, 10) : String(cd.date).slice(0, 10);
          workingSaturdays.push({
            date: dStr,
            day: 'Saturday',
            note: workDetail.comments || 'Instructional Saturday'
          });
        }
      }
    });

    const teachingWeeksRemaining = Math.max(1, Math.round(workingDaysCount / 5));

    let subjectStats = [];
    if (classId) {
      const template = await M.SemesterTemplate.findOne({
        classId: sanitizeToObjectId(classId),
        status: { $in: ['published', 'draft'] }
      }).sort({ status: 1 }).lean();

      if (template?.grid?.length) {
        const subjectMap = new Map();
        template.grid.forEach(slot => {
          if (!slot.subject) return;
          const current = subjectMap.get(slot.subject) || {
            subject: slot.subject,
            teacher: slot.teacher || '',
            room: slot.room || '',
            periodsPerWeek: 0,
            isLab: Boolean(slot.isLab)
          };
          current.periodsPerWeek += Number(slot.span || 1);
          subjectMap.set(slot.subject, current);
        });

        subjectStats = Array.from(subjectMap.values()).map(s => ({
          ...s,
          actualTeachingPeriodsRemaining: s.periodsPerWeek * teachingWeeksRemaining,
          estimatedSyllabusHours: Math.round(s.periodsPerWeek * teachingWeeksRemaining * 0.75 * 10) / 10
        }));
      }
    }

    res.json({
      ok: true,
      stats: {
        window: { start, end },
        totalCalendarDays: totalDays,
        workingDaysCount,
        holidaysCount,
        examDaysCount,
        workingSaturdaysCount,
        teachingWeeksRemaining,
        upcomingHolidays: upcomingHolidays.slice(0, 10),
        workingSaturdays: workingSaturdays.slice(0, 10),
        subjects: subjectStats
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ══════════════════════════════════════════════════════
//  DAILY SCHEDULE RESOLUTION (Item 13)
// ══════════════════════════════════════════════════════

router.get('/resolve/:classId/:date', async (req, res) => {
  try {
    const classId = sanitizeToObjectId(req.params.classId);
    const dateStr = sanitizeToString(req.params.date);
    const dateObj = new Date(dateStr + 'T00:00:00.000Z');
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD.' });
    }

    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = daysOfWeek[dateObj.getUTCDay()];

    // 1. Check cached DayInstance resolved recently
    let dayDoc = await M.DayInstance.findOne({ classId, date: dateStr });
    const oneHourAgo = new Date(Date.now() - 3600000);
    if (dayDoc && dayDoc.resolvedAt > oneHourAgo) {
      return res.json({ ok: true, data: dayDoc, cached: true });
    }

    // 2. Calendar check
    const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
    const endOfDay = new Date(dateStr + 'T23:59:59.999Z');
    const [calendarDay, classDoc] = await Promise.all([
      M.CalendarDay.findOne({ date: { $gte: startOfDay, $lte: endOfDay } }).lean(),
      M.Class.findById(classId).lean()
    ]);

    const clsYear = classDoc ? (classDoc.year ? String(classDoc.year).trim().toUpperCase() : '') : '';
    const TO_ROMAN_MAP = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV' };
    const clsYearRoman = TO_ROMAN_MAP[clsYear] || clsYear;

    let isHoliday = false;
    let holidayReason = '';
    if (calendarDay?.details?.length) {
      const hol = calendarDay.details.find(d => {
        if (!['holiday', 'vacation', 'exam', 'event', 'leave'].includes(d.dayType)) return false;
        if (!d.year) return true; // applies to all years
        const dYear = String(d.year).trim().toUpperCase();
        return dYear === clsYear || dYear === clsYearRoman;
      });
      if (hol) {
        isHoliday = true;
        holidayReason = hol.comments || `Academic Calendar: ${hol.dayType.toUpperCase()}`;
      }
    }
    if (dayName === 'Sunday') {
      isHoliday = true;
      holidayReason = holidayReason || 'Sunday';
    }

    // 3. Published SemesterTemplate (with fallback to SectionTimetable)
    const template = await M.SemesterTemplate.findOne({ classId, status: 'published' }).lean();
    let baseSlots = (template?.grid || []).filter(s => s.day === dayName);

    if (!baseSlots.length) {
      const secDoc = await M.SectionTimetable.findOne({ classId }).lean();
      if (secDoc && secDoc.slots) {
        Object.entries(secDoc.slots).forEach(([k, raw]) => {
          if (!raw) return;
          const sDay = raw.day ? dayFull(raw.day) : '';
          if (sDay === dayName) {
            const pNum = typeof raw.period === 'number' ? raw.period : (parseInt(String(raw.period || k).replace(/\D/g, ''), 10) || 1);
            baseSlots.push({
              period: pNum,
              span: raw.span || raw.duration || 1,
              subject: raw.subject || raw.subjectName || '',
              teacher: raw.teacher || raw.teacherName || '',
              teacherTrackId: raw.teacherTrackId || '',
              room: raw.room || raw.hallNo || '',
              isLab: Boolean(raw.isLab || raw.type === 'Lab')
            });
          }
        });
        baseSlots.sort((a, b) => a.period - b.period);
      }
    }

    // 4. Overrides for this date
    const overrides = await M.Override.find({
      classId,
      date: { $gte: startOfDay, $lte: endOfDay }
    }).lean();

    const resolvedSlots = [];

    baseSlots.forEach(slot => {
      const p = typeof slot.period === 'number' ? slot.period : parseInt(String(slot.period).replace(/\D/g, ''), 10) || 1;
      const ov = overrides.find(o => o.period === p);

      if (ov?.type === 'cancelled') {
        resolvedSlots.push({
          period: p,
          span: slot.span || 1,
          subject: slot.subject,
          teacher: slot.teacher,
          room: slot.room,
          isCancelled: true,
          overrideId: ov._id,
          note: ov.reason || 'Period cancelled'
        });
      } else if (ov?.type === 'substitute') {
        const subSlot = readOverrideSlot(ov.newSlot);
        resolvedSlots.push({
          period: p,
          span: slot.span || 1,
          subject: subSlot.subject || slot.subject,
          teacher: subSlot.teacher || slot.teacher,
          teacherTrackId: subSlot.teacherTrackId,
          room: subSlot.room || slot.room,
          isSubstituted: true,
          substituteTeacher: subSlot.teacher,
          substituteTeacherTrackId: subSlot.teacherTrackId,
          overrideId: ov._id,
          note: ov.reason || `Substitute: ${subSlot.teacher}`
        });
      } else if (ov?.type === 'room_change') {
        resolvedSlots.push({
          period: p,
          span: slot.span || 1,
          subject: slot.subject,
          teacher: slot.teacher,
          room: ov.newSlot?.room || slot.room,
          overrideId: ov._id,
          note: ov.reason || 'Room relocated'
        });
      } else {
        resolvedSlots.push({
          period: p,
          span: slot.span || 1,
          subject: slot.subject,
          teacher: slot.teacher,
          room: slot.room,
          isLab: Boolean(slot.isLab)
        });
      }
    });

    // 6. Save or update DayInstance document
    const dayData = {
      classId,
      date: dateStr,
      day: dayName,
      semesterTemplateId: template?._id || null,
      isHoliday,
      holidayReason,
      slots: resolvedSlots,
      resolvedAt: new Date(),
      resolvedBy: req.user ? req.user.name : 'System'
    };

    dayDoc = await M.DayInstance.findOneAndUpdate(
      { classId, date: dateStr },
      dayData,
      { upsert: true, returnDocument: 'after' }
    );

    res.json({ ok: true, data: dayDoc, cached: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ══════════════════════════════════════════════════════
//  CLASS ATTENDANCE ANALYTICS DASHBOARD (Item 3)
// ══════════════════════════════════════════════════════

router.get('/class-attendance-analytics', async (req, res) => {
  try {
    const rangeDays = Math.max(1, Math.min(180, parseInt(req.query.days || '30', 10)));
    const toDate = new Date();
    const fromDate = new Date(Date.now() - rangeDays * 86400000);
    fromDate.setHours(0, 0, 0, 0);

    // 1. Resolve Class
    let targetClass = null;
    if (req.query.classId) {
      const cQuery = [{ classTrackId: req.query.classId }, { name: req.query.classId }];
      if (mongoose.isValidObjectId(req.query.classId)) {
        cQuery.unshift({ _id: req.query.classId });
      }
      targetClass = await M.Class.findOne({ $or: cQuery }).lean();
    }
    if (!targetClass) {
      targetClass = await M.Class.findOne().lean();
    }
    if (!targetClass) {
      return res.json({ ok: true, data: null, message: 'No classes found' });
    }

    const classIdMatches = [String(targetClass._id), targetClass.classTrackId, targetClass.name].filter(Boolean);

    // 2. Query Class Attendance Records
    const attFilter = {
      classId: { $in: classIdMatches },
      date: { $gte: fromDate, $lte: toDate }
    };
    const classAttDocs = await M.ClassAttendance.find(attFilter).sort({ date: 1 }).lean();

    // 3. Query Roster Students
    const studentQuery = [
      { classId: targetClass._id },
      { classId: String(targetClass._id) },
      { class: targetClass.name }
    ];
    if (targetClass.classTrackId) {
      studentQuery.push({ classTrackId: targetClass.classTrackId });
    }
    const rosterStudents = await M.Student.find({
      $or: studentQuery,
      status: { $ne: 'Inactive' }
    }).select('_id trackId fullName name registerNo regNo rollNo email').sort({ registerNo: 1, name: 1 }).lean();

    const studentMap = new Map();
    rosterStudents.forEach(s => {
      const id = String(s._id);
      const reg = s.registerNo || s.regNo || '';
      const name = s.fullName || s.name || 'Student';
      studentMap.set(id, {
        id,
        trackId: s.trackId || id,
        regNo: reg,
        name,
        rollNo: s.rollNo || '',
        records: []
      });
      if (s.trackId) {
        studentMap.set(s.trackId, studentMap.get(id));
      }
    });

    // 4. Session & Method aggregations
    let totalMarks = 0;
    let presentMarks = 0;
    let absentMarks = 0;
    const sessionKeys = new Set();
    const methodCounts = { quickPass: 0, liveScan: 0, repShare: 0, manual: 0 };
    const periodStats = {};
    for (let p = 1; p <= 9; p++) {
      periodStats[p] = { period: p, total: 0, present: 0, percentage: 0 };
    }

    const dailyTrendMap = new Map();
    const targetSubjectId = req.query.subjectId ? String(req.query.subjectId) : null;

    classAttDocs.forEach(doc => {
      const dateStr = doc.date ? new Date(doc.date).toISOString().split('T')[0] : '';
      if (!dailyTrendMap.has(dateStr)) {
        dailyTrendMap.set(dateStr, { date: dateStr, total: 0, present: 0 });
      }
      const trendItem = dailyTrendMap.get(dateStr);

      (doc.periods || []).forEach(period => {
        // Subject filter if applied
        if (targetSubjectId) {
          const sMatch = period.subjectTrackId === targetSubjectId ||
                         String(period.subjectId) === targetSubjectId;
          if (!sMatch) return;
        }

        const pNums = Array.isArray(period.periodNumbers) && period.periodNumbers.length
          ? period.periodNumbers
          : [period.periodNumber || 1];
        const primaryP = pNums[0] || 1;

        const sKey = `${dateStr}_${pNums.join('-')}_${period.subjectTrackId || ''}`;
        sessionKeys.add(sKey);

        // Determine method
        const m = (period.method || '').toLowerCase();
        if (m.includes('quick') || m.includes('code')) methodCounts.quickPass++;
        else if (m.includes('live') || m.includes('qr')) methodCounts.liveScan++;
        else if (m.includes('rep')) methodCounts.repShare++;
        else methodCounts.manual++;

        (period.records || []).forEach(rec => {
          totalMarks++;
          const isPresent = rec.status === 'P' || rec.status === 'PRESENT';
          if (isPresent) presentMarks++;
          else absentMarks++;

          trendItem.total++;
          if (isPresent) trendItem.present++;

          pNums.forEach(p => {
            if (periodStats[p]) {
              periodStats[p].total++;
              if (isPresent) periodStats[p].present++;
            }
          });

          // Attribute to student
          const sKeyId = rec.studentTrackId;
          let stu = studentMap.get(sKeyId);
          if (!stu) {
            stu = {
              id: sKeyId,
              trackId: sKeyId,
              regNo: rec.regNo || '',
              name: rec.name || sKeyId,
              rollNo: '',
              records: []
            };
            studentMap.set(sKeyId, stu);
          }
          stu.records.push({
            date: dateStr,
            period: primaryP,
            status: isPresent ? 'present' : 'absent',
            topic: period.topic || ''
          });
        });
      });
    });

    // Compute period percentages
    const periodWise = [];
    for (let p = 1; p <= 9; p++) {
      const item = periodStats[p];
      item.percentage = item.total ? Math.round((item.present / item.total) * 100) : 0;
      periodWise.push(item);
    }

    // Daily trend array
    const trend = Array.from(dailyTrendMap.values()).map(d => ({
      ...d,
      percentage: d.total ? Math.round((d.present / d.total) * 100) : 0
    })).sort((a, b) => a.date.localeCompare(b.date));

    // Determine top method
    let topMethod = 'Manual';
    let topVal = methodCounts.manual;
    if (methodCounts.quickPass > topVal) { topMethod = 'Quick Pass'; topVal = methodCounts.quickPass; }
    if (methodCounts.liveScan > topVal) { topMethod = 'Live Scan'; topVal = methodCounts.liveScan; }
    if (methodCounts.repShare > topVal) { topMethod = 'Rep Share'; topVal = methodCounts.repShare; }
    if (totalMarks === 0) topMethod = '—';

    // Consecutive absence alerts & student summary
    const consecutiveAlerts = [];
    const studentSummary = [];
    const minThreshold = 75;
    let defaultersCount = 0;

    const uniqueStudents = Array.from(new Set(Array.from(studentMap.values())));
    uniqueStudents.forEach(stu => {
      // Sort student records by date and period
      stu.records.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.period - b.period));

      const held = stu.records.length;
      const attended = stu.records.filter(r => r.status === 'present').length;
      const pct = held ? Math.round((attended / held) * 100) : (sessionKeys.size === 0 ? 100 : 0);

      if (held > 0 && pct < minThreshold) {
        defaultersCount++;
      }

      // Check trailing consecutive absences
      let trailingAbsences = 0;
      let lastAttended = '—';
      for (let i = stu.records.length - 1; i >= 0; i--) {
        if (stu.records[i].status !== 'present') {
          trailingAbsences++;
        } else {
          if (lastAttended === '—') lastAttended = stu.records[i].date;
          break;
        }
      }

      if (trailingAbsences >= 3) {
        consecutiveAlerts.push({
          studentId: stu.id,
          name: stu.name,
          regNo: stu.regNo || '—',
          consecutive: trailingAbsences,
          percentage: pct,
          lastAttended
        });
      }

      studentSummary.push({
        studentId: stu.id,
        name: stu.name,
        regNo: stu.regNo || '—',
        rollNo: stu.rollNo || '',
        held,
        attended,
        percentage: pct,
        status: pct >= 85 ? 'good' : (pct >= 75 ? 'warning' : 'critical')
      });
    });

    consecutiveAlerts.sort((a, b) => b.consecutive - a.consecutive);
    studentSummary.sort((a, b) => a.percentage - b.percentage);

    const avgPercentage = totalMarks ? Math.round((presentMarks / totalMarks) * 100) : 0;

    res.json({
      ok: true,
      data: {
        classInfo: {
          id: targetClass._id,
          name: targetClass.name,
          deptCode: targetClass.deptCode || targetClass.department || ''
        },
        timeframeDays: rangeDays,
        dateRange: {
          from: fromDate.toISOString().slice(0, 10),
          to: toDate.toISOString().slice(0, 10)
        },
        kpi: {
          avgPercentage,
          defaultersCount,
          sessionCount: sessionKeys.size,
          topMethod,
          totalMarks,
          presentMarks,
          absentMarks,
          minThreshold
        },
        methods: {
          quickPass: methodCounts.quickPass,
          liveScan: methodCounts.liveScan,
          repShare: methodCounts.repShare,
          manual: methodCounts.manual,
          total: totalMarks
        },
        periodWise,
        trend,
        consecutiveAlerts,
        studentSummary
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate class attendance analytics: ' + err.message });
  }
});

// =========================================================================
// 🚀 TIMETABLE DASHBOARD & COMMAND CENTER COCKPIT ENDPOINTS
// =========================================================================

// GET /dashboard-cockpit - Aggregated data for all 8 operational dashboard panels
router.get('/dashboard-cockpit', authMiddleware, async (req, res) => {
  try {
    const targetDateStr = sanitizeToString(req.query.date || new Date().toISOString().slice(0, 10));
    const targetDeptId = req.query.deptId && req.query.deptId !== 'all' ? sanitizeToObjectId(req.query.deptId) : null;

    const targetDate = new Date(targetDateStr + 'T00:00:00.000Z');
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = dayNames[targetDate.getUTCDay()];

    // Server time reference (in HH:MM format for period matching)
    const now = new Date();
    const currentH = String(now.getHours()).padStart(2, '0');
    const currentM = String(now.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${currentH}:${currentM}`;

    // 1. Resolve Active Bell Timing & Current Period
    const timingSet = await M.TimingSet.findOne({ isDefault: true }).lean() || TIMING_SEED[0];
    const periodsList = (timingSet.periods || TIMING_SEED[0].periods).filter(p => !p.isBreak && p.periodNumber > 0);

    let currentPeriod = null;
    let nextPeriod = null;

    for (let i = 0; i < periodsList.length; i++) {
      const p = periodsList[i];
      if (currentTimeStr >= p.start && currentTimeStr < p.end) {
        currentPeriod = {
          code: `P${p.periodNumber}`,
          number: p.periodNumber,
          label: p.label || `Period ${p.periodNumber}`,
          start: p.start,
          end: p.end,
          timeRemainingMinutes: (() => {
            const [eh, em] = p.end.split(':').map(Number);
            const [ch, cm] = currentTimeStr.split(':').map(Number);
            return Math.max(0, (eh * 60 + em) - (ch * 60 + cm));
          })()
        };
        if (i + 1 < periodsList.length) {
          const np = periodsList[i + 1];
          nextPeriod = {
            code: `P${np.periodNumber}`,
            number: np.periodNumber,
            label: np.label || `Period ${np.periodNumber}`,
            start: np.start,
            end: np.end
          };
        }
        break;
      }
    }

    // If outside active hours, find closest upcoming period or default to first/last
    if (!currentPeriod && periodsList.length) {
      if (currentTimeStr < periodsList[0].start) {
        nextPeriod = {
          code: `P${periodsList[0].periodNumber}`,
          number: periodsList[0].periodNumber,
          label: periodsList[0].label || `Period ${periodsList[0].periodNumber}`,
          start: periodsList[0].start,
          end: periodsList[0].end
        };
      } else {
        const lastP = periodsList[periodsList.length - 1];
        if (currentTimeStr >= lastP.end) {
          currentPeriod = {
            code: `P${lastP.periodNumber}`,
            number: lastP.periodNumber,
            label: `${lastP.label} (Concluded)`,
            start: lastP.start,
            end: lastP.end,
            timeRemainingMinutes: 0
          };
        }
      }
    }

    // 2. Query Classes, Published Templates & Slots
    const classFilter = {};
    if (targetDeptId) classFilter.deptId = targetDeptId;

    const [classes, templates, sectionTimetables, teachers, rooms, smartBoards] = await Promise.all([
      M.Class.find(classFilter).lean(),
      M.SemesterTemplate.find({ status: 'published' }).lean(),
      M.SectionTimetable.find().lean(),
      M.User.find({ role: { $in: ['teacher', 'faculty'] } }).lean(),
      M.Room.find({ status: { $ne: 'Inactive' } }).lean(),
      M.SmartBoard.find().lean()
    ]);

    const teacherMap = new Map();
    teachers.forEach(t => {
      teacherMap.set(String(t._id), t);
      if (t.name) teacherMap.set(t.name.toLowerCase().trim(), t);
    });

    const roomMap = new Map();
    rooms.forEach(r => {
      roomMap.set(String(r._id), r);
      if (r.hallNo) roomMap.set(r.hallNo.toLowerCase().trim(), r);
    });

    // 3. Query Today's Attendance Records
    const startOfDay = new Date(targetDateStr + 'T00:00:00.000Z');
    const endOfDay = new Date(targetDateStr + 'T23:59:59.999Z');

    const [attendanceRecords, teacherLeaves, substitutions, overrides] = await Promise.all([
      M.ClassAttendance.find({ date: { $gte: startOfDay, $lte: endOfDay } }).lean(),
      M.TeacherLeaveRequest.find({
        status: 'Approved',
        $or: [
          { dates: targetDateStr },
          { fromDate: { $lte: targetDateStr }, toDate: { $gte: targetDateStr } }
        ]
      }).lean(),
      M.SubstitutionRequest.find({
        date: { $gte: startOfDay, $lte: endOfDay },
        status: { $in: ['approved', 'pending'] }
      }).lean(),
      M.Override.find({
        date: { $gte: startOfDay, $lte: endOfDay }
      }).lean()
    ]);

    // Build fast lookup index for attendance: Map<classId, Set<periodNumber>>
    const attendanceIndex = new Map();
    attendanceRecords.forEach(ar => {
      const cid = String(ar.classId);
      if (!attendanceIndex.has(cid)) attendanceIndex.set(cid, new Set());
      const pSet = attendanceIndex.get(cid);
      (ar.periods || []).forEach(p => {
        (p.periodNumbers || []).forEach(pn => pSet.add(pn));
      });
    });

    // Build fast lookup for overrides & substitutions: Map<classId_period, override/sub>
    const subMap = new Map();
    substitutions.forEach(s => {
      (s.assignedSubstitutes || []).forEach(as => {
        const key = `${as.classId || s.classId}_${as.period || s.period}`;
        subMap.set(key, { ...s, ...as });
      });
    });

    const overrideMap = new Map();
    overrides.forEach(ov => {
      const key = `${ov.classId}_${ov.period}`;
      overrideMap.set(key, ov);
    });

    // 4. Build Live Class Status Grid (Panel 2)
    const templateByClass = new Map();
    templates.forEach(t => templateByClass.set(String(t.classId), t));

    const sectionTTByClass = new Map();
    sectionTimetables.forEach(st => sectionTTByClass.set(String(st.classId), st));

    const liveClasses = [];
    const todaySlotsAll = [];

    classes.forEach(cls => {
      const cid = String(cls._id);
      const tmpl = templateByClass.get(cid);
      const secTT = sectionTTByClass.get(cid);

      const periodSlots = {};
      const classSlotsToday = [];

      // Extract slots from grid or sectionTT
      if (tmpl && Array.isArray(tmpl.grid)) {
        tmpl.grid.forEach(slot => {
          if (slot.day === currentDay) {
            classSlotsToday.push({ ...slot, classId: cid, className: cls.name });
          }
        });
      } else if (secTT && secTT.slots) {
        const daySlots = secTT.slots[currentDay] || [];
        daySlots.forEach((slot, idx) => {
          if (slot) {
            classSlotsToday.push({ ...slot, period: slot.period || idx + 1, classId: cid, className: cls.name });
          }
        });
      }

      todaySlotsAll.push(...classSlotsToday);

      // Map across periods P1 to P9
      periodsList.forEach(p => {
        const pCode = `P${p.periodNumber}`;
        const slot = classSlotsToday.find(s => Number(s.period) === p.periodNumber);

        if (!slot) {
          periodSlots[pCode] = {
            period: p.periodNumber,
            code: pCode,
            status: 'free',
            subject: 'Free',
            teacher: '',
            room: ''
          };
          return;
        }

        const overrideKey = `${cid}_${p.periodNumber}`;
        const activeOverride = overrideMap.get(overrideKey);
        const activeSub = subMap.get(overrideKey);

        let status = 'upcoming';
        let isCancelled = activeOverride && activeOverride.type === 'cancelled';
        let isSubstituted = activeSub || (activeOverride && activeOverride.type === 'substitute');
        let substituteTeacher = activeSub ? (activeSub.substituteName || activeSub.teacherName) : (activeOverride?.newSlot?.teacher || '');

        const isMarked = attendanceIndex.has(cid) && attendanceIndex.get(cid).has(p.periodNumber);

        if (isCancelled) {
          status = 'cancelled';
        } else if (isSubstituted) {
          status = 'substituted';
        } else if (isMarked) {
          status = 'marked';
        } else if (currentPeriod && currentPeriod.number === p.periodNumber) {
          status = 'unmarked'; // Running right now, attendance not submitted yet
        } else if (currentTimeStr >= p.end) {
          status = 'unmarked'; // Past period, missed attendance
        } else {
          status = 'upcoming';
        }

        periodSlots[pCode] = {
          period: p.periodNumber,
          code: pCode,
          subject: slot.subject || slot.subjectName || '',
          teacher: slot.teacher || slot.teacherName || '',
          substituteTeacher,
          room: slot.room || '',
          roomId: slot.roomId || null,
          isLab: Boolean(slot.isLab || (slot.span && slot.span > 1)),
          span: slot.span || 1,
          status,
          isMarked,
          time: `${p.start} - ${p.end}`
        };
      });

      liveClasses.push({
        classId: cid,
        className: cls.name,
        deptCode: cls.deptCode || '',
        deptName: cls.deptName || '',
        periods: periodSlots
      });
    });

    // 5. Panel 1: Today's Disruptions & At-Risk Slots
    const cancelledCount = overrides.filter(o => o.type === 'cancelled').length;
    const substitutedCount = substitutions.length + overrides.filter(o => o.type === 'substitute').length;
    const roomChangedCount = overrides.filter(o => o.type === 'room_change').length;

    // Maintenance rooms and affected slots
    const maintenanceRooms = rooms.filter(r => r.status === 'Maintenance' || r.status === 'Temporarily Unavailable');
    const maintenanceRoomIds = new Set(maintenanceRooms.map(r => String(r._id)));
    const maintenanceHallNos = new Set(maintenanceRooms.map(r => (r.hallNo || '').toLowerCase().trim()));

    const slotsAtRisk = todaySlotsAll.filter(s => {
      const rId = s.roomId ? String(s.roomId) : '';
      const hNo = (s.room || '').toLowerCase().trim();
      return maintenanceRoomIds.has(rId) || maintenanceHallNos.has(hNo);
    });

    // Absent teachers & Uncovered periods count
    const absentTeacherNames = new Set(teacherLeaves.map(l => (l.teacherName || '').toLowerCase().trim()));
    const absentTeacherIds = new Set(teacherLeaves.map(l => String(l.teacherId)));

    const absentSlots = todaySlotsAll.filter(s => {
      const tName = (s.teacher || '').toLowerCase().trim();
      const tId = s.teacherId ? String(s.teacherId) : '';
      return absentTeacherNames.has(tName) || absentTeacherIds.has(tId);
    });

    const uncoveredSlotsList = [];
    absentSlots.forEach(s => {
      const key = `${s.classId}_${s.period}`;
      const hasSub = subMap.has(key) || (overrideMap.has(key) && overrideMap.get(key).type === 'substitute');
      if (!hasSub) {
        uncoveredSlotsList.push(s);
      }
    });

    // 6. Panel 3: Absent-Teacher Coverage Board
    const absentCoverage = teacherLeaves.map(leave => {
      const tName = leave.teacherName;
      const tSlots = absentSlots.filter(s => (s.teacher || '').toLowerCase().trim() === tName.toLowerCase().trim());

      const slotDetails = tSlots.map(s => {
        const key = `${s.classId}_${s.period}`;
        const activeSub = subMap.get(key);
        const pObj = periodsList.find(p => p.periodNumber === Number(s.period));

        // Find candidate substitutes in the same department who are free during this period
        const candidateSubs = teachers
          .filter(t => {
            if (String(t._id) === String(leave.teacherId)) return false;
            if (absentTeacherIds.has(String(t._id))) return false;
            // Check if teacher is already booked during this period today
            const isBooked = todaySlotsAll.some(ts =>
              Number(ts.period) === Number(s.period) &&
              (ts.teacher || '').toLowerCase().trim() === (t.name || '').toLowerCase().trim()
            );
            return !isBooked;
          })
          .slice(0, 4)
          .map(t => ({
            teacherId: String(t._id),
            teacherName: t.name,
            trackId: t.trackId || '',
            deptCode: t.department || ''
          }));

        return {
          slotId: s._id || `${s.classId}_${s.period}`,
          classId: s.classId,
          className: s.className,
          period: `P${s.period}`,
          periodNumber: Number(s.period),
          periodTime: pObj ? `${pObj.start} - ${pObj.end}` : '',
          subject: s.subject || '',
          room: s.room || '',
          hasSubstitute: Boolean(activeSub),
          substituteTeacher: activeSub?.substituteName || '',
          candidates: candidateSubs
        };
      });

      return {
        leaveId: leave._id,
        teacherId: leave.teacherId,
        teacherName: leave.teacherName,
        teacherTrackId: leave.teacherTrackId,
        deptName: leave.deptName,
        leaveType: leave.leaveType || 'Casual Leave',
        reason: leave.reason,
        slots: slotDetails,
        uncoveredCount: slotDetails.filter(sd => !sd.hasSubstitute).length
      };
    });

    // 7. Panel 4: Unmarked-Attendance Alerts
    const unmarkedAlerts = [];
    todaySlotsAll.forEach(s => {
      const pObj = periodsList.find(p => p.periodNumber === Number(s.period));
      if (!pObj) return;

      // Check if period has already concluded
      if (currentTimeStr > pObj.end) {
        const [eh, em] = pObj.end.split(':').map(Number);
        const [ch, cm] = currentTimeStr.split(':').map(Number);
        const endedMinutesAgo = (ch * 60 + cm) - (eh * 60 + em);

        // N = 10 minutes grace window
        if (endedMinutesAgo >= 10) {
          const isMarked = attendanceIndex.has(String(s.classId)) && attendanceIndex.get(String(s.classId)).has(Number(s.period));
          if (!isMarked) {
            const matchedTeacher = teacherMap.get(String(s.teacher || '').toLowerCase().trim());
            unmarkedAlerts.push({
              classId: s.classId,
              className: s.className,
              period: `P${s.period}`,
              periodNumber: Number(s.period),
              periodLabel: pObj.label || `Period ${s.period}`,
              periodTime: `${pObj.start} - ${pObj.end}`,
              subject: s.subject || '',
              room: s.room || '',
              teacherName: s.teacher || 'Unassigned',
              teacherTrackId: matchedTeacher?.trackId || '',
              endedMinutesAgo,
              isSeverelyDelayed: endedMinutesAgo >= 45
            });
          }
        }
      }
    });

    // Sort unmarked alerts by most severely delayed first
    unmarkedAlerts.sort((a, b) => b.endedMinutesAgo - a.endedMinutesAgo);

    // 8. Panel 5: Live Room Map & Smart Board Heartbeat
    const boardByRoom = new Map();
    smartBoards.forEach(b => {
      if (b.roomId) boardByRoom.set(String(b.roomId), b);
    });

    const activePeriodNum = currentPeriod ? currentPeriod.number : 0;
    const occupiedNowRooms = [];
    const freeNowRooms = [];
    const maintenanceRoomsList = [];

    rooms.forEach(r => {
      const board = boardByRoom.get(String(r._id));
      let boardStatus = 'offline';
      let boardErrors = [];

      if (board) {
        const lastHb = board.lastHeartbeatAt ? new Date(board.lastHeartbeatAt).getTime() : 0;
        const diffSec = (Date.now() - lastHb) / 1000;
        if (diffSec <= 90) boardStatus = 'online';
        else if (diffSec <= 300) boardStatus = 'degraded';
        else boardStatus = 'offline';

        if (board.telemetry?.errors && Array.isArray(board.telemetry.errors)) {
          boardErrors = board.telemetry.errors;
        }
      }

      if (r.status === 'Maintenance' || r.status === 'Temporarily Unavailable') {
        maintenanceRoomsList.push({
          roomId: String(r._id),
          hallNo: r.hallNo,
          name: r.name,
          capacity: r.capacity,
          buildingName: r.buildingName || '',
          boardStatus,
          affectedSlots: slotsAtRisk.filter(s => (s.room || '').toLowerCase().trim() === (r.hallNo || '').toLowerCase().trim()).length,
          statusReason: r.statusHistory?.length ? r.statusHistory[r.statusHistory.length - 1].reason : 'Under scheduled maintenance'
        });
      } else {
        // Check if a class is scheduled in this room right now
        const activeSlot = activePeriodNum ? todaySlotsAll.find(s =>
          Number(s.period) === activePeriodNum &&
          ((s.roomId && String(s.roomId) === String(r._id)) || (s.room && s.room.toLowerCase().trim() === (r.hallNo || '').toLowerCase().trim()))
        ) : null;

        if (activeSlot) {
          occupiedNowRooms.push({
            roomId: String(r._id),
            hallNo: r.hallNo,
            name: r.name,
            capacity: r.capacity,
            buildingName: r.buildingName || '',
            className: activeSlot.className,
            subject: activeSlot.subject,
            teacher: activeSlot.teacher,
            boardStatus
          });
        } else {
          freeNowRooms.push({
            roomId: String(r._id),
            hallNo: r.hallNo,
            name: r.name,
            capacity: r.capacity,
            buildingName: r.buildingName || '',
            boardStatus
          });
        }
      }
    });

    // 9. Panel 6: Live Smart Board Errors Stream
    const smartBoardErrors = [];
    smartBoards.forEach(b => {
      const lastHb = b.lastHeartbeatAt ? new Date(b.lastHeartbeatAt).getTime() : 0;
      const diffMin = Math.round((Date.now() - lastHb) / 60000);
      const isOfflineLong = diffMin > 5;

      const hasTelemetryErrors = b.telemetry?.errors && Array.isArray(b.telemetry.errors) && b.telemetry.errors.length > 0;
      const isDisconnected = b.connectionStatus === 'Disconnected' || b.status === 'Maintenance';

      if (isOfflineLong || hasTelemetryErrors || isDisconnected) {
        const assignedRoom = roomMap.get(String(b.roomId)) || { hallNo: b.roomHallNo || 'Unassigned' };
        smartBoardErrors.push({
          boardId: String(b._id),
          boardName: b.boardName,
          deviceId: b.deviceId,
          roomHallNo: assignedRoom.hallNo,
          roomId: b.roomId,
          errorCode: hasTelemetryErrors ? b.telemetry.errors[0].code : (isOfflineLong ? 'ERR_HEARTBEAT_TIMEOUT' : 'ERR_DISCONNECTED'),
          message: hasTelemetryErrors ? b.telemetry.errors[0].message : (isOfflineLong ? `No heartbeat received in ${diffMin} minutes.` : 'Device disconnected from kiosk gateway.'),
          severity: isOfflineLong ? 'critical' : 'warning',
          lastHeartbeat: b.lastHeartbeatAt
        });
      }
    });

    // 10. Panel 7: Live Academic Event Ticker
    const recentLogs = await M.Log.find({
      module: { $in: ['timetable', 'attendance', 'rooms'] }
    }).sort({ createdAt: -1 }).limit(15).lean();

    const eventTicker = recentLogs.map(l => {
      let details = l.details || '';
      if (l.encryptedPayload) {
        const payload = decryptLog(l.encryptedPayload);
        if (payload?.details) details = payload.details;
      }
      return {
        id: String(l._id),
        time: l.createdAt ? new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        createdAt: l.createdAt,
        actor: l.performedBy || l.userName || 'System',
        action: l.action || 'Timetable Update',
        details: typeof details === 'string' ? details : JSON.stringify(details),
        category: l.category || 'timetable'
      };
    });

    return res.json({
      ok: true,
      data: {
        serverTime: now.toISOString(),
        currentTimeStr,
        currentDay,
        targetDate: targetDateStr,
        currentPeriod,
        nextPeriod,
        disruptions: {
          cancelledCount,
          substitutedCount,
          roomChangedCount,
          uncoveredCount: uncoveredSlotsList.length,
          slotsAtRiskCount: slotsAtRisk.length,
          uncoveredSlots: uncoveredSlotsList
        },
        liveGrid: {
          classes: liveClasses
        },
        absentCoverage,
        unmarkedAlerts,
        roomsMap: {
          freeNow: freeNowRooms,
          occupiedNow: occupiedNowRooms,
          maintenance: maintenanceRoomsList
        },
        smartBoardErrors,
        eventTicker
      }
    });

  } catch (err) {
    console.error('[dashboard-cockpit error]:', err);
    res.status(500).json({ error: 'Failed to load dashboard cockpit: ' + err.message });
  }
});

// POST /dashboard/nudge-attendance - Nudge faculty to submit attendance for concluded period
router.post('/dashboard/nudge-attendance', authMiddleware, requireManager, async (req, res) => {
  try {
    const { className, period, teacherTrackId, subject, teacherName } = req.body;
    if (!teacherTrackId && !teacherName) {
      return res.status(400).json({ error: 'Teacher trackId or name required to send attendance alert' });
    }

    const message = `Attendance Alert: Attendance submission is pending for ${className || 'Class'} (${period || 'Period'} - ${subject || 'Course'}). Please finalize attendance immediately.`;

    const notif = await M.Notification.create({
      type: 'attendance-alert',
      priority: 'Urgent',
      from: req.user?.name || 'Academic Coordinator',
      fromRole: 'Coordinator',
      toTeacherTrackId: teacherTrackId || '',
      toTeacherName: teacherName || '',
      message,
      read: false,
      time: new Date()
    });

    await logAction(
      req.user?.name || 'Coordinator',
      req.user?.role || 'admin',
      req.user?.trackId || '',
      'ATTENDANCE_NUDGE_SENT',
      `Sent urgent attendance alert to ${teacherName || teacherTrackId} for ${className} ${period}`,
      'attendance',
      'warning',
      req.ip || '127.0.0.1',
      req.sessionID || '',
      null,
      'timetable'
    );

    res.json({ ok: true, message: `Nudge alert sent to ${teacherName || 'instructor'}.`, data: notif });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send attendance nudge: ' + err.message });
  }
});

// POST /dashboard/quick-assign-substitute - 1-Click quick assign substitute faculty
router.post('/dashboard/quick-assign-substitute', authMiddleware, requireManager, async (req, res) => {
  try {
    const {
      date,
      periodNumber,
      classId,
      className,
      originalTeacherId,
      originalTeacherName,
      substituteTeacherId,
      substituteTeacherName,
      subject,
      room,
      reason
    } = req.body;

    if (!classId || !periodNumber || !substituteTeacherId) {
      return res.status(400).json({ error: 'Class, period number, and substitute teacher are required.' });
    }

    const targetDate = date ? new Date(date + 'T00:00:00.000Z') : new Date();

    const subReq = await M.SubstitutionRequest.create({
      date: targetDate,
      teacherId: originalTeacherId || '',
      teacherName: originalTeacherName || '',
      status: 'approved',
      approvedBy: req.user?.name || 'Coordinator',
      reason: reason || '1-Click Dashboard Substitution',
      affectedSlots: [{
        classId,
        className,
        period: Number(periodNumber),
        subject,
        room
      }],
      assignedSubstitutes: [{
        classId,
        className,
        period: Number(periodNumber),
        substituteId: substituteTeacherId,
        substituteName: substituteTeacherName
      }]
    });

    // Create day-level override
    await M.Override.create({
      date: targetDate,
      classId,
      period: Number(periodNumber),
      type: 'substitute',
      originalSlot: { teacher: originalTeacherName, subject, room },
      newSlot: { teacher: substituteTeacherName, subject, room },
      reason: reason || '1-Click Dashboard Substitution',
      approvedBy: req.user?.name || 'Coordinator',
      requestId: String(subReq._id)
    });

    await logAction(
      req.user?.name || 'Coordinator',
      req.user?.role || 'admin',
      req.user?.trackId || '',
      'SUBSTITUTION_ASSIGNED',
      `Assigned substitute ${substituteTeacherName} for ${originalTeacherName} in ${className} (P${periodNumber})`,
      'timetable',
      'info',
      req.ip || '127.0.0.1',
      req.sessionID || '',
      null,
      'timetable'
    );

    res.json({ ok: true, message: `Substitute ${substituteTeacherName} assigned successfully.`, data: subReq });
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign substitute: ' + err.message });
  }
});

// POST /dashboard/emergency-reassign-room - 1-Click emergency room reallocation
router.post('/dashboard/emergency-reassign-room', authMiddleware, requireManager, async (req, res) => {
  try {
    const { date, periodNumber, classId, className, fromRoom, toRoom, reason } = req.body;

    if (!classId || !toRoom) {
      return res.status(400).json({ error: 'Class and destination room are required.' });
    }

    const targetDate = date ? new Date(date + 'T00:00:00.000Z') : new Date();

    const override = await M.Override.create({
      date: targetDate,
      classId,
      period: Number(periodNumber || 1),
      type: 'room_change',
      originalSlot: { room: fromRoom },
      newSlot: { room: toRoom },
      reason: reason || 'Emergency Room Reassignment from Dashboard',
      approvedBy: req.user?.name || 'Coordinator'
    });

    await logAction(
      req.user?.name || 'Coordinator',
      req.user?.role || 'admin',
      req.user?.trackId || '',
      'ROOM_EMERGENCY_REASSIGNED',
      `Emergency room change for ${className || 'Class'} from ${fromRoom || 'N/A'} to ${toRoom}`,
      'rooms',
      'warning',
      req.ip || '127.0.0.1',
      req.sessionID || '',
      null,
      'timetable'
    );

    res.json({ ok: true, message: `Room successfully reassigned to ${toRoom}.`, data: override });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reassign room: ' + err.message });
  }
});

module.exports = router;

