const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');

// Standard Institutional Period Timings
const PERIOD_TIMES = {
  1: { start: '08:30', end: '09:15' },
  2: { start: '09:15', end: '10:00' },
  3: { start: '10:15', end: '11:00' },
  4: { start: '11:00', end: '11:45' },
  5: { start: '11:45', end: '12:30' },
  6: { start: '13:15', end: '14:00' },
  7: { start: '14:00', end: '14:45' },
  8: { start: '15:00', end: '15:45' },
  9: { start: '15:45', end: '16:30' },
};

const DAY_ABBR_MAP = {
  'Monday': 'Mon', 'Mon': 'Mon',
  'Tuesday': 'Tue', 'Tue': 'Tue',
  'Wednesday': 'Wed', 'Wed': 'Wed',
  'Thursday': 'Thu', 'Thu': 'Thu',
  'Friday': 'Fri', 'Fri': 'Fri',
  'Saturday': 'Sat', 'Sat': 'Sat',
};

// Helper: Check if user is TT Coordinator or TT Admin
function canEditTT(u) {
  const hasTTRight = u.role === 'admin' || (u.role === 'teacher' && u.isAdmin && (u.adminRights === 'all' || (Array.isArray(u.adminRights) && (u.adminRights.includes('all') || u.adminRights.includes('timetablePage')))));
  return !!(u.isTimeTableCoordinator || hasTTRight);
}

// Helper: Check if user has HOD or Principal/Admin approval rights
function canApproveTT(u) {
  if (u.role === 'admin') return true;
  if (u.role === 'teacher' && (u.isHod || u.isAdmin)) return true;
  return false;
}

// Helper: Find HOD for a given department
async function getDepartmentHod(deptId) {
  if (!deptId) return null;
  let hod = await M.User.findOne({
    role: 'teacher',
    isHod: true,
    $or: [{ deptId: deptId }, { department: deptId }]
  }).lean();

  if (!hod) {
    const dept = await M.Department.findById(deptId).lean();
    if (dept) {
      hod = await M.User.findOne({
        role: 'teacher',
        isHod: true,
        $or: [
          { deptCode: dept.code },
          { department: dept.name },
          { 'specials.value': dept.trackId }
        ]
      }).lean();
    }
  }
  return hod;
}

// Helper: Time to Minutes conversion
function timeToMinutes(str) {
  if (!str) return 0;
  const parts = String(str).trim().split(':');
  return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
}

// Helper: Check if two clock-time intervals overlap
function doIntervalsOverlap(s1, e1, s2, e2) {
  if (!s1 || !e1 || !s2 || !e2) return false;
  const startA = timeToMinutes(s1);
  const endA = timeToMinutes(e1);
  const startB = timeToMinutes(s2);
  const endB = timeToMinutes(e2);
  if (startA >= endA || startB >= endB) return false;
  return Math.max(startA, startB) < Math.min(endA, endB);
}

// Seed default institutional timing sets (Set 1 for Years 1 & 4; Set 2 for Years 2 & 3)
async function seedDefaultTimingSets() {
  try {
    const count = await M.TimingSet.countDocuments();
    if (count === 0) {
      await M.TimingSet.create([
        {
          code: 'SET_1',
          name: 'Timing Set 1 (Years I & IV)',
          applicableYears: ['1', '4', 'I', 'IV', '1st Year', '4th Year'],
          periods: [
            { periodNumber: 1, start: '08:30', end: '09:15', label: 'Period 1' },
            { periodNumber: 2, start: '09:15', end: '10:00', label: 'Period 2' },
            { periodNumber: 0, start: '10:00', end: '10:15', label: 'Morning Break', isBreak: true, breakType: 'Interval' },
            { periodNumber: 3, start: '10:15', end: '11:00', label: 'Period 3' },
            { periodNumber: 4, start: '11:00', end: '11:45', label: 'Period 4' },
            { periodNumber: 5, start: '11:45', end: '12:30', label: 'Period 5' },
            { periodNumber: 6, start: '12:30', end: '13:15', label: 'Period 6' },
            { periodNumber: 0, start: '13:15', end: '14:00', label: 'Lunch Break', isBreak: true, breakType: 'Lunch' },
            { periodNumber: 7, start: '14:00', end: '14:45', label: 'Period 7' },
            { periodNumber: 8, start: '14:45', end: '15:30', label: 'Period 8' },
            { periodNumber: 0, start: '15:30', end: '15:45', label: 'Tea Break', isBreak: true, breakType: 'Tea' },
            { periodNumber: 9, start: '15:45', end: '16:30', label: 'Period 9' },
          ],
          isDefault: true
        },
        {
          code: 'SET_2',
          name: 'Timing Set 2 (Years II & III)',
          applicableYears: ['2', '3', 'II', 'III', '2nd Year', '3rd Year'],
          periods: [
            { periodNumber: 1, start: '08:30', end: '09:15', label: 'Period 1' },
            { periodNumber: 2, start: '09:15', end: '10:00', label: 'Period 2' },
            { periodNumber: 3, start: '10:00', end: '10:45', label: 'Period 3' },
            { periodNumber: 0, start: '10:45', end: '11:00', label: 'Morning Break', isBreak: true, breakType: 'Interval' },
            { periodNumber: 4, start: '11:00', end: '11:45', label: 'Period 4' },
            { periodNumber: 5, start: '11:45', end: '12:30', label: 'Period 5' },
            { periodNumber: 6, start: '12:30', end: '13:15', label: 'Period 6' },
            { periodNumber: 0, start: '13:15', end: '14:00', label: 'Lunch Break', isBreak: true, breakType: 'Lunch' },
            { periodNumber: 7, start: '14:00', end: '14:45', label: 'Period 7' },
            { periodNumber: 8, start: '14:45', end: '15:30', label: 'Period 8' },
            { periodNumber: 0, start: '15:30', end: '15:45', label: 'Tea Break', isBreak: true, breakType: 'Tea' },
            { periodNumber: 9, start: '15:45', end: '16:30', label: 'Period 9' },
          ],
          isDefault: false
        }
      ]);
    }
  } catch (err) {
    console.error('Failed to seed default timing sets:', err);
  }
}

// Seed default institutional rooms
async function seedDefaultRooms() {
  try {
    const count = await M.Room.countDocuments();
    if (count === 0) {
      await M.Room.insertMany([
        { hallNo: 'LH-101', name: 'Lecture Hall 101', type: 'Theory', capacity: 70 },
        { hallNo: 'LH-102', name: 'Lecture Hall 102', type: 'Theory', capacity: 70 },
        { hallNo: 'LH-201', name: 'Lecture Hall 201', type: 'Theory', capacity: 65 },
        { hallNo: 'LH-202', name: 'Lecture Hall 202', type: 'Theory', capacity: 65 },
        { hallNo: 'CS-LAB-1', name: 'Programming Lab 1', type: 'Lab', capacity: 45 },
        { hallNo: 'CS-LAB-2', name: 'Hardware / AI Lab', type: 'Lab', capacity: 40 },
        { hallNo: 'EC-LAB-1', name: 'Electronics Lab', type: 'Lab', capacity: 35 },
        { hallNo: 'SEM-HALL', name: 'Auditorium / Seminar Hall', type: 'Seminar', capacity: 150 },
      ]);
    }
    await seedDefaultBuildings();
  } catch (err) {
    console.error('Failed to seed default rooms:', err);
  }
}

// Seed default institutional buildings
async function seedDefaultBuildings() {
  try {
    const count = await M.Building.countDocuments();
    if (count === 0) {
      const b1 = await M.Building.create({ name: 'Main Academic Block', code: 'MB', floors: 4 });
      const b2 = await M.Building.create({ name: 'Science & Computing Block', code: 'SB', floors: 4 });
      const b3 = await M.Building.create({ name: 'Mechanical & Electrical Block', code: 'EB', floors: 3 });

      await M.Room.updateMany({ hallNo: { $regex: /^LH-/i } }, { $set: { buildingId: b1._id, buildingName: b1.name, floor: 1 } });
      await M.Room.updateMany({ hallNo: { $regex: /^CS-LAB/i } }, { $set: { buildingId: b2._id, buildingName: b2.name, floor: 2 } });
      await M.Room.updateMany({ hallNo: { $regex: /^EC-LAB/i } }, { $set: { buildingId: b3._id, buildingName: b3.name, floor: 1 } });
      await M.Room.updateMany({ hallNo: 'SEM-HALL' }, { $set: { buildingId: b1._id, buildingName: b1.name, floor: 3 } });
    }
  } catch (err) {
    console.error('Failed to seed default buildings:', err);
  }
}

// Seed default institutional timetable templates (Plan 3: Feature 9)
async function seedDefaultTemplates() {
  try {
    const count = await M.TimetableTemplate.countDocuments();
    if (count === 0) {
      await M.TimetableTemplate.insertMany([
        {
          code: 'FE_STD',
          name: 'First-Year Engineering Standard',
          description: 'Standard 5-day week for Year 1 with Set 1 timings, afternoon 3-period lab blocks, and balanced theory.',
          timingSetCode: 'SET_1',
          applicableYears: ['1', 'I', '1st Year'],
          workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          periodsPerDay: 9,
          defaultLabDuration: 3,
          rules: {
            maxTheoryPerDay: 2,
            maxLabPerDay: 1,
            maxTeacherPeriodsPerDay: 4,
            avoidFirstPeriodLab: true,
            preferredLabPeriods: [4, 7]
          },
          isSystem: true
        },
        {
          code: 'SE_CORE',
          name: 'Second-Year Core Engineering',
          description: 'Core discipline curriculum with Set 2 timings (break after P3), balancing departmental core theory and programming labs.',
          timingSetCode: 'SET_2',
          applicableYears: ['2', 'II', '2nd Year'],
          workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          periodsPerDay: 9,
          defaultLabDuration: 3,
          rules: {
            maxTheoryPerDay: 2,
            maxLabPerDay: 1,
            maxTeacherPeriodsPerDay: 4,
            avoidFirstPeriodLab: true,
            preferredLabPeriods: [4, 7]
          },
          isSystem: true
        },
        {
          code: 'LAB_HEAVY',
          name: 'Lab-Heavy Applied Curriculum',
          description: 'Practical-intensive semester template with 2 to 3 lab sessions of 3 continuous periods each, scheduled in afternoon blocks.',
          timingSetCode: 'SET_1',
          applicableYears: ['1', '2', '3', '4'],
          workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          periodsPerDay: 9,
          defaultLabDuration: 3,
          rules: {
            maxTheoryPerDay: 2,
            maxLabPerDay: 1,
            maxTeacherPeriodsPerDay: 5,
            avoidFirstPeriodLab: true,
            preferredLabPeriods: [4, 7]
          },
          isSystem: true
        },
        {
          code: 'ENG_MON_FRI',
          name: 'Engineering Standard (Mon–Fri)',
          description: 'Standard 5 working days week with 9 periods per day, lunch break between 13:15 and 14:00.',
          timingSetCode: 'SET_1',
          applicableYears: ['1', '2', '3', '4'],
          workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          periodsPerDay: 9,
          defaultLabDuration: 3,
          rules: {
            maxTheoryPerDay: 2,
            maxLabPerDay: 1,
            maxTeacherPeriodsPerDay: 4,
            avoidFirstPeriodLab: true,
            preferredLabPeriods: [4, 7]
          },
          isSystem: true
        },
        {
          code: 'ENG_MON_SAT',
          name: 'Full Academic Week (Mon–Sat)',
          description: '6 working days including Saturday classes or project sessions.',
          timingSetCode: 'SET_1',
          applicableYears: ['1', '2', '3', '4'],
          workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
          periodsPerDay: 9,
          defaultLabDuration: 3,
          rules: {
            maxTheoryPerDay: 2,
            maxLabPerDay: 1,
            maxTeacherPeriodsPerDay: 4,
            avoidFirstPeriodLab: true,
            preferredLabPeriods: [4, 7]
          },
          isSystem: true
        }
      ]);
    }
  } catch (err) {
    console.error('Failed to seed default timetable templates:', err);
  }
}

// Safely trigger seeders once DB is connected
const mongoose = require('mongoose');
if (mongoose.connection.readyState === 1) {
  seedDefaultTimingSets();
  seedDefaultRooms();
  seedDefaultTemplates();
} else {
  mongoose.connection.once('connected', () => {
    seedDefaultTimingSets();
    seedDefaultRooms();
    seedDefaultTemplates();
  });
}

// Helper: Sync a draft slot into individual teacher's Timetable record (isDraft: true)
async function syncTeacherDraftSlot(draftDoc, slotKey, payload, cls) {
  const parts = String(slotKey).split('_');
  const dayStr = parts[0];
  const pNum = parseInt(parts[1], 10);
  const dayAbbr = DAY_ABBR_MAP[dayStr] || dayStr.slice(0, 3);
  const span = Number(payload?.span) || 1;
  const endPeriod = pNum + span - 1;
  const timing = (payload?.start && payload?.end)
    ? { start: payload.start, end: payload.end }
    : (PERIOD_TIMES[pNum] || { start: '08:30', end: '09:15' });

  // Remove any previous draft slot for this draft + cell
  await M.Timetable.deleteMany({ draftId: draftDoc._id, slotKey: slotKey });

  if (payload && (payload.staff || payload.teacherName)) {
    let trackId = payload.trackId || '';
    let teacherName = payload.staff || payload.teacherName || '';

    if (!trackId && teacherName) {
      const teacherUser = await M.User.findOne({
        role: 'teacher',
        $or: [
          { name: teacherName },
          { fullName: teacherName },
          { username: teacherName }
        ]
      }).select('trackId name').lean();
      if (teacherUser) {
        trackId = teacherUser.trackId;
        teacherName = teacherUser.name || teacherName;
      }
    }

    await M.Timetable.create({
      trackId: trackId || teacherName,
      teacherName: teacherName,
      deptId: cls?.deptId || draftDoc.deptId,
      classId: cls?._id || draftDoc.classId,
      className: cls?.name || draftDoc.className || '',
      subjectId: payload.subjectId,
      subjectName: payload.subjectName || payload.name || '',
      day: dayAbbr,
      start: payload.start || timing.start,
      end: payload.end || timing.end,
      periodNumber: pNum,
      span: span,
      startPeriod: pNum,
      endPeriod: endPeriod,
      timingSetId: draftDoc.timingSetId || null,
      timingSetName: draftDoc.timingSetName || '',
      type: payload.type || (span > 1 ? 'Lab' : 'Theory'),
      hallNo: payload.hall || payload.hallNo || '',
      hallCapacity: payload.hallCapacity || undefined,
      isCombined: payload.isCombined || false,
      combinedClassIds: payload.combinedClassIds || [],
      combinedClassNames: payload.combinedClassNames || [],
      isDraft: true,
      draftId: draftDoc._id,
      slotKey: slotKey
    });
  }
}

// Helper: Check cross-department conflicts for a slot with clock-time interval & capacity validation
async function checkConflictsForSlot(day, periodNumber, teacherName, trackId, hallNo, excludeDraftId = null, startTime = null, endTime = null, span = 1, classId = null) {
  const dayAbbr = DAY_ABBR_MAP[day] || day;
  const pNum = Number(periodNumber);
  const slotSpan = Number(span) || 1;
  const conflicts = [];

  let sTime = startTime;
  let eTime = endTime;
  if ((!sTime || !eTime) && classId) {
    try {
      const cls = await M.Class.findById(classId).lean();
      const yrStr = String(cls?.year || '').trim();
      const timingSet = await M.TimingSet.findOne({
        $or: [
          { applicableClasses: classId },
          { applicableYears: yrStr }
        ]
      }).lean();
      if (timingSet && Array.isArray(timingSet.periods)) {
        const startDef = timingSet.periods.find(p => p.periodNumber === pNum);
        const endP = pNum + slotSpan - 1;
        const endDef = timingSet.periods.find(p => p.periodNumber === endP) || startDef;
        if (startDef?.start) sTime = sTime || startDef.start;
        if (endDef?.end) eTime = eTime || endDef.end;
      }
    } catch (e) { }
  }
  if (!sTime || !eTime) {
    const defaultStart = PERIOD_TIMES[pNum]?.start || '08:30';
    const endP = pNum + slotSpan - 1;
    const defaultEnd = PERIOD_TIMES[endP]?.end || PERIOD_TIMES[pNum]?.end || '09:15';
    sTime = sTime || defaultStart;
    eTime = eTime || defaultEnd;
  }

  // Teacher collision check across college (interval intersection)
  if (teacherName || trackId) {
    const teacherQuery = {
      day: dayAbbr,
      $or: []
    };
    if (trackId) teacherQuery.$or.push({ trackId: trackId });
    if (teacherName) teacherQuery.$or.push({ teacherName: teacherName });

    const draftFilter = excludeDraftId
      ? { $or: [{ isDraft: false }, { isDraft: true, draftId: { $ne: excludeDraftId } }] }
      : {};

    const teacherSlots = await M.Timetable.find({
      ...teacherQuery,
      ...draftFilter
    }).populate('deptId', 'name code').lean();

    teacherSlots.forEach(s => {
      const hasTimeOverlap = (s.start && s.end && sTime && eTime)
        ? doIntervalsOverlap(s.start, s.end, sTime, eTime)
        : (s.periodNumber === pNum || (s.startPeriod && s.endPeriod && pNum >= s.startPeriod && pNum <= s.endPeriod));

      if (hasTimeOverlap) {
        conflicts.push({
          type: 'teacher',
          severity: 'critical',
          entity: teacherName || trackId,
          message: `${teacherName || trackId} is already scheduled in ${s.className || 'another class'} (${s.deptId?.name || 'Other Dept'}) on ${day} (${s.start || 'P' + s.periodNumber} - ${s.end || ''}) [${s.isDraft ? 'Dev Draft' : 'Live Schedule'}]`,
          slot: s
        });
      }
    });
  }

  // Room collision check across college (interval intersection)
  if (hallNo && String(hallNo).trim()) {
    const hallName = String(hallNo).trim();
    const hallQuery = {
      day: dayAbbr,
      hallNo: hallName,
      ...(excludeDraftId ? { $or: [{ isDraft: false }, { isDraft: true, draftId: { $ne: excludeDraftId } }] } : {})
    };
    const roomSlots = await M.Timetable.find(hallQuery).populate('deptId', 'name code').lean();
    roomSlots.forEach(s => {
      const hasTimeOverlap = (s.start && s.end && sTime && eTime)
        ? doIntervalsOverlap(s.start, s.end, sTime, eTime)
        : (s.periodNumber === pNum || (s.startPeriod && s.endPeriod && pNum >= s.startPeriod && pNum <= s.endPeriod));

      if (hasTimeOverlap) {
        conflicts.push({
          type: 'room',
          severity: 'critical',
          entity: hallName,
          message: `Hall ${hallName} is already occupied by ${s.className || 'another class'} (${s.subjectName || ''}) on ${day} (${s.start || 'P' + s.periodNumber} - ${s.end || ''}) [${s.isDraft ? 'Dev Draft' : 'Live Schedule'}]`,
          slot: s
        });
      }
    });

    // Room Capacity validation
    if (classId) {
      try {
        const [roomDoc, studentCount] = await Promise.all([
          M.Room.findOne({ hallNo: hallName }).lean(),
          M.User.countDocuments({ role: 'student', classId: classId })
        ]);
        if (roomDoc && roomDoc.capacity && studentCount > roomDoc.capacity) {
          conflicts.push({
            type: 'capacity',
            severity: 'warning',
            entity: hallName,
            message: `Hall ${hallName} capacity (${roomDoc.capacity} seats) is insufficient for class size (${studentCount} students).`,
            capacity: roomDoc.capacity,
            studentCount
          });
        }
      } catch (e) {
        // ignore capacity lookup failure
      }
    }
  }

  return conflicts;
}

// ── 1. INDIVIDUAL TEACHER TIMETABLE ROUTES (LIVE PRODUCTION) ──

router.get('/', authMiddleware, async (req, res) => {
  const filter = { isDraft: { $ne: true } };
  const classId = req.query.classId ? sanitizeToString(req.query.classId) : null;
  const teacherId = req.query.teacherId ? sanitizeToString(req.query.teacherId) : null;

  if (classId) {
    filter.classId = classId;
  } else {
    const targetTeacherId = teacherId || (req.user.role === 'teacher' ? req.user._id : null);
    if (targetTeacherId) {
      const orConditions = [{ teacherId: targetTeacherId }, { trackId: String(targetTeacherId) }];
      if (req.user.trackId && !teacherId) orConditions.push({ trackId: req.user.trackId });
      filter.$or = orConditions;
    }
  }
  res.json(await M.Timetable.find(filter).sort({ day: 1, start: 1 }));
});

router.post('/', authMiddleware, async (req, res) => {
  if (!canEditTT(req.user)) {
    return res.status(403).json({ error: 'Timetable editing requires coordinator or admin privileges' });
  }
  try {
    const slot = await M.Timetable.create({
      ...req.body,
      trackId: req.body.trackId || req.user.trackId || String(req.user._id),
      teacherName: req.body.teacherName || req.user.name,
      teacherId: req.user._id,
      isDraft: false
    });
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Timetable Slot Added',
      `${req.body.day} ${req.body.start}`,
      'data',
      'info',
      req.ip,
      req.user.sessionId
    );
    res.status(201).json(slot);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', authMiddleware, async (req, res) => {
  if (!canEditTT(req.user)) {
    return res.status(403).json({ error: 'Timetable editing requires coordinator or admin privileges' });
  }
  const slot = await M.Timetable.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' });
  res.json(slot);
});

router.delete('/:id', authMiddleware, async (req, res) => {
  if (!canEditTT(req.user)) {
    return res.status(403).json({ error: 'Timetable deletion requires coordinator or admin privileges' });
  }
  await M.Timetable.findByIdAndDelete(req.params.id);
  res.json({ deleted: true });
});

// ── 2. PRODUCTION SECTION TIMETABLE (LIVE VIEW) ──

router.get('/section/:classId', authMiddleware, async (req, res) => {
  const doc = await M.SectionTimetable.findOne({ classId: req.params.classId }).lean();
  res.json(doc || { slots: {} });
});

// ── 3. DEVELOPMENT MODE: DRAFTS & CROSS-DEPT CONFLICTS ──

// GET class draft (or clone from production if none exists yet)
router.get('/draft/:classId', authMiddleware, async (req, res) => {
  try {
    let draft = await M.TimetableDraft.findOne({ classId: req.params.classId }).lean();
    if (!draft) {
      // Clone from live production SectionTimetable
      const prod = await M.SectionTimetable.findOne({ classId: req.params.classId }).lean();
      const cls = await M.Class.findById(req.params.classId).lean();
      draft = await M.TimetableDraft.create({
        classId: req.params.classId,
        className: cls?.name || '',
        deptId: cls?.deptId,
        deptName: cls?.deptName,
        slots: prod?.slots || {},
        status: 'draft',
        createdBy: req.user.trackId || req.user._id,
        createdByName: req.user.name
      });
      // Sync initial draft slots into teacher individual timetable
      if (draft.slots && Object.keys(draft.slots).length > 0) {
        for (const [sKey, pVal] of Object.entries(draft.slots)) {
          if (pVal) await syncTeacherDraftSlot(draft, sKey, pVal, cls);
        }
      }
    }
    res.json(draft);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update single slot in draft + SYNC INDIVIDUAL TEACHER TT (DEV MODE)
router.put('/draft/:classId/slot', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) {
    return res.status(403).json({ error: 'TT Coordinator or Timetable Admin access required' });
  }

  const { slotKey, payload } = req.body;
  const cls = await M.Class.findById(req.params.classId).lean();

  let draft = await M.TimetableDraft.findOne({ classId: req.params.classId });
  if (!draft) {
    draft = new M.TimetableDraft({
      classId: req.params.classId,
      className: cls?.name || '',
      deptId: cls?.deptId,
      deptName: cls?.deptName,
      slots: {},
      status: 'draft',
      createdBy: u.trackId || u._id,
      createdByName: u.name
    });
  }

  if (!draft.slots) draft.slots = {};
  if (payload) {
    draft.slots[slotKey] = payload;
  } else {
    delete draft.slots[slotKey];
  }
  draft.markModified('slots');
  draft.updatedBy = u.name;
  if (draft.status === 'changes_requested') draft.status = 'draft';
  await draft.save();

  // SYNC INDIVIDUAL TEACHER TIMETABLE RECORD (isDraft: true)
  await syncTeacherDraftSlot(draft, slotKey, payload, cls);

  // Run immediate cross-department conflict check for this slot
  const parts = String(slotKey).split('_');
  const dayStr = parts[0];
  const pNum = parseInt(parts[1], 10);
  let inlineConflicts = [];
  if (payload) {
    inlineConflicts = await checkConflictsForSlot(
      dayStr,
      pNum,
      payload.staff || payload.teacherName,
      payload.trackId,
      payload.hall || payload.hallNo,
      draft._id,
      payload.start,
      payload.end,
      payload.span || 1,
      req.params.classId
    );
  }

  res.json({
    draft,
    conflicts: inlineConflicts,
    hasConflict: inlineConflicts.length > 0
  });
});

// PUT bulk save draft slots + SYNC INDIVIDUAL TEACHER TT
router.put('/draft/:classId', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator access required' });

  const { slots, classMeta } = req.body;
  const cls = await M.Class.findById(req.params.classId).lean();

  const updateDoc = {
    slots,
    updatedBy: u.name,
    $setOnInsert: {
      className: cls?.name || '',
      deptId: cls?.deptId,
      deptName: cls?.deptName,
      status: 'draft',
      createdBy: u.trackId || u._id,
      createdByName: u.name
    }
  };
  if (classMeta && typeof classMeta === 'object') {
    updateDoc.classMeta = classMeta;
  }

  const draft = await M.TimetableDraft.findOneAndUpdate(
    { classId: req.params.classId },
    updateDoc,
    { upsert: true, returnDocument: 'after' }
  );

  // Sync all slots into individual teacher draft records
  await M.Timetable.deleteMany({ draftId: draft._id });
  if (slots && typeof slots === 'object') {
    for (const [sKey, pVal] of Object.entries(slots)) {
      if (pVal) await syncTeacherDraftSlot(draft, sKey, pVal, cls);
    }
  }

  res.json(draft);
});

// DELETE discard draft
router.delete('/draft/:classId', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator access required' });

  const draft = await M.TimetableDraft.findOneAndDelete({ classId: req.params.classId });
  if (draft) {
    await M.Timetable.deleteMany({ draftId: draft._id });
  }
  res.json({ success: true, message: 'Draft discarded successfully' });
});

// GET query cross-department conflict check for cell editor
router.get('/conflicts/check', authMiddleware, async (req, res) => {
  const { day, periodNumber, teacherName, trackId, hallNo, draftId } = req.query;
  const conflicts = await checkConflictsForSlot(day, periodNumber, teacherName, trackId, hallNo, draftId);
  res.json({ conflicts, hasConflict: conflicts.length > 0 });
});

// POST comprehensive validation across class drafts
router.post('/draft/validate', authMiddleware, async (req, res) => {
  const { classId } = req.body;
  const draft = await M.TimetableDraft.findOne({ classId }).lean();
  if (!draft) return res.status(404).json({ error: 'Draft not found' });

  const allConflicts = [];
  const slots = draft.slots || {};

  for (const [sKey, slot] of Object.entries(slots)) {
    if (!slot) continue;
    const parts = sKey.split('_');
    const day = parts[0];
    const pNum = parseInt(parts[1], 10);
    const cList = await checkConflictsForSlot(day, pNum, slot.staff, slot.trackId, slot.hall, draft._id);
    if (cList.length > 0) {
      allConflicts.push(...cList.map(c => ({ ...c, slotKey: sKey })));
    }
  }

  draft.validationErrors = allConflicts.map(c => c.message);
  await M.TimetableDraft.findByIdAndUpdate(draft._id, { validationErrors: draft.validationErrors });

  res.json({
    valid: allConflicts.length === 0,
    conflicts: allConflicts,
    totalConflicts: allConflicts.length
  });
});

// ── 4. HOD CONFIRMATION & APPROVAL WORKFLOW ──

// POST submit draft for HOD confirmation
router.post('/draft/:classId/submit-approval', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator access required' });

  const cls = await M.Class.findById(req.params.classId).lean();
  const draft = await M.TimetableDraft.findOne({ classId: req.params.classId });
  if (!draft) return res.status(404).json({ error: 'No draft found to submit' });

  draft.status = 'pending_hod_approval';
  draft.submittedAt = new Date();
  draft.submittedBy = u.trackId || u._id;
  draft.submissionNote = req.body.note || '';
  await draft.save();

  // Find department HOD and generate notification
  const hod = await getDepartmentHod(cls?.deptId || draft.deptId);
  if (hod) {
    await M.Notification.create({
      type: 'request',
      from: u.name,
      fromRole: 'Timetable Coordinator',
      toTeacherId: hod._id,
      toTeacherTrackId: hod.trackId,
      toTeacherName: hod.name,
      message: `Timetable Coordinator ${u.name} submitted Dev Mode timetable for ${cls?.name || 'Class'} for your confirmation.`,
      priority: 'High'
    });
  }

  res.json({
    success: true,
    message: 'Timetable submitted to Department HOD for confirmation.',
    draft
  });
});

// GET drafts pending HOD confirmation
router.get('/drafts/pending-hod', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canApproveTT(u)) return res.status(403).json({ error: 'HOD or Admin authorization required' });

  const filter = { status: 'pending_hod_approval' };
  if (u.role !== 'admin' && u.deptId) {
    filter.deptId = u.deptId;
  }
  const pending = await M.TimetableDraft.find(filter).sort({ submittedAt: -1 }).lean();
  res.json(pending);
});

// POST HOD confirms & publishes Dev Mode draft to Production
router.post('/draft/:classId/hod-approve', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canApproveTT(u)) {
    return res.status(403).json({ error: 'Only Department HOD or Admin can approve & publish timetables.' });
  }

  const cls = await M.Class.findById(req.params.classId).lean();
  const draft = await M.TimetableDraft.findOne({ classId: req.params.classId });
  if (!draft) return res.status(404).json({ error: 'Draft not found' });

  // 1. Archive current production into TimetableBackup
  const currentProd = await M.SectionTimetable.findOne({ classId: req.params.classId }).lean();
  if (currentProd && currentProd.slots && Object.keys(currentProd.slots).length > 0) {
    await M.TimetableBackup.create({
      classId: req.params.classId,
      className: cls?.name || '',
      deptId: cls?.deptId,
      deptName: cls?.deptName,
      slots: currentProd.slots,
      approvedBy: u.name,
      publishedAt: currentProd.updatedAt || new Date(),
      archivedAt: new Date(),
      versionLabel: `Archived prior to HOD approval on ${new Date().toLocaleDateString('en-IN')}`
    });
  }

  // 2. Publish draft slots into SectionTimetable (Production)
  await M.SectionTimetable.findOneAndUpdate(
    { classId: req.params.classId },
    {
      slots: draft.slots,
      updatedBy: `HOD Confirmed: ${u.name}`,
      $setOnInsert: {
        className: cls?.name || '',
        deptId: cls?.deptId,
        deptName: cls?.deptName
      }
    },
    { upsert: true, returnDocument: 'after' }
  );

  // 3. Promote individual teacher draft slots to Live (isDraft: false)
  // Remove existing live slots for this class
  await M.Timetable.deleteMany({ classId: req.params.classId, isDraft: false });
  // Convert draft slots to live
  await M.Timetable.updateMany(
    { draftId: draft._id },
    { $set: { isDraft: false }, $unset: { draftId: '' } }
  );

  // 4. Update draft status to published
  draft.status = 'published';
  draft.reviewedBy = u.trackId || u._id;
  draft.reviewedByName = u.name;
  draft.reviewedAt = new Date();
  await draft.save();

  // 5. Create TimetableVersion changelog entry
  await M.TimetableVersion.create({
    deptId: cls?.deptId,
    deptName: cls?.deptName,
    classIds: [req.params.classId],
    submittedBy: draft.createdByName || 'TT Coordinator',
    approvedBy: u.name,
    publishedAt: new Date(),
    summary: `HOD Approved & Published timetable for ${cls?.name || 'Class'}`
  });

  // 6. Commit staged class metadata if present
  if (draft.classMeta && (draft.classMeta.hallNo || draft.classMeta.advisorId || draft.classMeta.advisorName)) {
    const updateObj = {};
    if (draft.classMeta.hallNo) updateObj.hallNo = draft.classMeta.hallNo;
    if (draft.classMeta.advisorId) updateObj.advisorTeacherId = draft.classMeta.advisorId;
    if (draft.classMeta.advisorName) updateObj.advisorTeacherName = draft.classMeta.advisorName;
    await M.Class.findByIdAndUpdate(req.params.classId, { $set: updateObj });
  }

  // 7. Notify TT Coordinator
  if (draft.createdBy) {
    const coord = await M.User.findOne({
      $or: [{ trackId: draft.createdBy }, { _id: draft.createdBy }]
    }).lean();
    if (coord) {
      await M.Notification.create({
        type: 'info',
        from: u.name,
        fromRole: 'HOD',
        toTeacherId: coord._id,
        toTeacherTrackId: coord.trackId,
        toTeacherName: coord.name,
        message: `HOD ${u.name} has approved and published the Dev Mode timetable for ${cls?.name || 'Class'} to Production!`,
        priority: 'Normal'
      });
    }
  }

  await logAction(
    u.trackId || u._id,
    u.name,
    u.role,
    'Timetable HOD Approved & Published',
    cls?.name || req.params.classId,
    'data',
    'info',
    req.ip,
    u.sessionId
  );

  res.json({
    success: true,
    message: 'Timetable approved and published to live production successfully.',
    draft
  });
});

// POST HOD rejects / requests changes on Dev Mode draft
router.post('/draft/:classId/hod-reject', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canApproveTT(u)) {
    return res.status(403).json({ error: 'Only Department HOD or Admin can review timetables.' });
  }

  const cls = await M.Class.findById(req.params.classId).lean();
  const draft = await M.TimetableDraft.findOne({ classId: req.params.classId });
  if (!draft) return res.status(404).json({ error: 'Draft not found' });

  const remarks = (req.body.remarks || '').trim();
  draft.status = 'changes_requested';
  draft.hodRemarks = remarks;
  draft.reviewedBy = u.trackId || u._id;
  draft.reviewedByName = u.name;
  draft.reviewedAt = new Date();
  await draft.save();

  // Notify coordinator of feedback
  if (draft.createdBy) {
    const coord = await M.User.findOne({
      $or: [{ trackId: draft.createdBy }, { _id: draft.createdBy }]
    }).lean();
    if (coord) {
      await M.Notification.create({
        type: 'request',
        from: u.name,
        fromRole: 'HOD',
        toTeacherId: coord._id,
        toTeacherTrackId: coord.trackId,
        toTeacherName: coord.name,
        message: `HOD ${u.name} requested changes on timetable for ${cls?.name || 'Class'}: "${remarks}"`,
        priority: 'High'
      });
    }
  }

  res.json({
    success: true,
    message: 'Feedback sent to TT Coordinator.',
    draft
  });
});

// ── 5. BACKUPS, VERSIONS & ROLLBACK ──

// GET version history
router.get('/versions', authMiddleware, async (req, res) => {
  const versions = await M.TimetableVersion.find().sort({ publishedAt: -1 }).limit(30).lean();
  res.json(versions);
});

// GET backups for class
router.get('/backups/:classId', authMiddleware, async (req, res) => {
  const backups = await M.TimetableBackup.find({ classId: req.params.classId }).sort({ archivedAt: -1 }).limit(20).lean();
  res.json(backups);
});

// POST restore backup into Dev Mode draft (safe restore — never straight to live)
router.post('/restore/:backupId', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator access required' });

  const backup = await M.TimetableBackup.findById(req.params.backupId).lean();
  if (!backup) return res.status(404).json({ error: 'Backup snapshot not found' });

  const cls = await M.Class.findById(backup.classId).lean();

  const draft = await M.TimetableDraft.findOneAndUpdate(
    { classId: backup.classId },
    {
      slots: backup.slots,
      status: 'draft',
      updatedBy: `Restored from backup: ${u.name}`,
      $setOnInsert: {
        className: cls?.name || backup.className,
        deptId: cls?.deptId || backup.deptId,
        deptName: cls?.deptName || backup.deptName,
        createdBy: u.trackId || u._id,
        createdByName: u.name
      }
    },
    { upsert: true, returnDocument: 'after' }
  );

  // Sync draft slots to individual teacher TT
  await M.Timetable.deleteMany({ draftId: draft._id });
  if (backup.slots) {
    for (const [sKey, pVal] of Object.entries(backup.slots)) {
      if (pVal) await syncTeacherDraftSlot(draft, sKey, pVal, cls);
    }
  }

  res.json({
    success: true,
    message: 'Backup restored into Development Mode draft for review and editing.',
    draft
  });
});

// ── 6. INSTITUTIONAL TIMING SETS (FEATURE 4) ──

// GET all timing sets
router.get('/timing-sets', authMiddleware, async (req, res) => {
  await seedDefaultTimingSets();
  const sets = await M.TimingSet.find().lean();
  res.json(sets);
});

// GET timing set for a specific class (by classId or year)
router.get('/timing-sets/class/:classId', authMiddleware, async (req, res) => {
  try {
    await seedDefaultTimingSets();
    const cls = await M.Class.findById(req.params.classId).lean();
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    // Check draft or prod for explicitly set timingSetId
    const draft = await M.TimetableDraft.findOne({ classId: req.params.classId }).lean();
    if (draft?.timingSetId) {
      const setDoc = await M.TimingSet.findById(draft.timingSetId).lean();
      if (setDoc) return res.json({ timingSet: setDoc, source: 'draft_override' });
    }

    const prod = await M.SectionTimetable.findOne({ classId: req.params.classId }).lean();
    if (prod?.timingSetId) {
      const setDoc = await M.TimingSet.findById(prod.timingSetId).lean();
      if (setDoc) return res.json({ timingSet: setDoc, source: 'production' });
    }

    // Default determination based on Year:
    // Year 1 & 4 -> SET_1, Year 2 & 3 -> SET_2
    const yrStr = String(cls.year || '').trim();
    let targetCode = 'SET_1';
    if (['2', '3', 'II', 'III', '2nd Year', '3rd Year'].includes(yrStr)) {
      targetCode = 'SET_2';
    }
    let timingSet = await M.TimingSet.findOne({ code: targetCode }).lean();
    if (!timingSet) {
      timingSet = await M.TimingSet.findOne({ isDefault: true }).lean();
    }
    res.json({ timingSet, source: 'year_mapping' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / PUT timing set
router.post('/timing-sets', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator access required' });
  try {
    const { code, name, applicableYears, periods, isDefault } = req.body;
    const doc = await M.TimingSet.findOneAndUpdate(
      { code },
      { code, name, applicableYears, periods, isDefault },
      { upsert: true, returnDocument: 'after' }
    );
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── 7. ROOMS MANAGEMENT & AVAILABILITY GRID (FEATURE 4) ──

// GET all rooms (filters: type, deptId, minCapacity)
router.get('/rooms', authMiddleware, async (req, res) => {
  await seedDefaultRooms();
  const filter = { isActive: true };
  if (req.query.type) filter.type = req.query.type;
  if (req.query.deptId) filter.deptId = req.query.deptId;
  if (req.query.minCapacity) filter.capacity = { $gte: Number(req.query.minCapacity) };
  const rooms = await M.Room.find(filter).sort({ hallNo: 1 }).lean();
  res.json(rooms);
});

// POST add room
router.post('/rooms', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator access required' });
  try {
    const room = await M.Room.create(req.body);
    res.status(201).json(room);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update room
router.put('/rooms/:id', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator access required' });
  try {
    const room = await M.Room.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' });
    res.json(room);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE room
router.delete('/rooms/:id', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator or Admin access required' });
  try {
    await M.Room.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: 'Room deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET all buildings
router.get('/buildings', authMiddleware, async (req, res) => {
  await seedDefaultBuildings();
  const buildings = await M.Building.find({ isActive: true }).sort({ name: 1 }).lean();
  res.json(buildings);
});

// POST add building
router.post('/buildings', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator or Admin access required' });
  try {
    const building = await M.Building.create(req.body);
    res.status(201).json(building);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update building
router.put('/buildings/:id', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator or Admin access required' });
  try {
    const building = await M.Building.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' });
    if (req.body.name && building) {
      await M.Room.updateMany({ buildingId: building._id }, { $set: { buildingName: building.name } });
    }
    res.json(building);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE building
router.delete('/buildings/:id', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator or Admin access required' });
  try {
    await M.Building.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: 'Building deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET room availability grid for a given day and time slot
router.get('/rooms/availability', authMiddleware, async (req, res) => {
  try {
    await seedDefaultRooms();
    const { day, periodNumber, start, end } = req.query;
    const dayAbbr = DAY_ABBR_MAP[day] || (day ? day.slice(0, 3) : 'Mon');
    const pNum = periodNumber ? Number(periodNumber) : null;
    const sTime = start || (pNum ? PERIOD_TIMES[pNum]?.start : null);
    const eTime = end || (pNum ? PERIOD_TIMES[pNum]?.end : null);

    const rooms = await M.Room.find({ isActive: true }).sort({ hallNo: 1 }).lean();

    // Query all slots for this day across college
    const occupiedSlots = await M.Timetable.find({ day: dayAbbr }).lean();
    const occupiedMap = {};

    occupiedSlots.forEach(s => {
      if (!s.hallNo) return;
      const h = String(s.hallNo).trim();
      let overlaps = false;
      if (sTime && eTime && s.start && s.end) {
        overlaps = doIntervalsOverlap(s.start, s.end, sTime, eTime);
      } else if (pNum) {
        overlaps = (s.periodNumber === pNum || (s.startPeriod && s.endPeriod && pNum >= s.startPeriod && pNum <= s.endPeriod));
      }
      if (overlaps) {
        occupiedMap[h] = {
          className: s.className,
          subjectName: s.subjectName,
          teacherName: s.teacherName,
          start: s.start,
          end: s.end,
          periodNumber: s.periodNumber,
          isDraft: s.isDraft
        };
      }
    });

    const result = rooms.map(r => ({
      ...r,
      isAvailable: !occupiedMap[r.hallNo],
      occupiedBy: occupiedMap[r.hallNo] || null
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 8. ACADEMIC WEEKS MANAGEMENT (FEATURE 13 - TIER 2) ──

// POST generate 16 academic weeks for a class starting from semester start date
router.post('/weeks/generate', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator access required' });

  const { classId, startDate, numberOfWeeks = 16, academicYear, semester } = req.body;
  if (!classId || !startDate) {
    return res.status(400).json({ error: 'classId and startDate (YYYY-MM-DD) are required.' });
  }

  const cls = await M.Class.findById(classId).lean();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  // Baseline template comes from SectionTimetable (Production)
  const prod = await M.SectionTimetable.findOne({ classId }).lean();
  const baseSlots = prod?.slots || {};

  const generatedWeeks = [];
  const baseDate = new Date(startDate + 'T00:00:00Z');

  for (let w = 1; w <= numberOfWeeks; w++) {
    const wStart = new Date(baseDate);
    wStart.setUTCDate(baseDate.getUTCDate() + (w - 1) * 7);
    const wEnd = new Date(wStart);
    wEnd.setUTCDate(wStart.getUTCDate() + 6);

    const startStr = wStart.toISOString().slice(0, 10);
    const endStr = wEnd.toISOString().slice(0, 10);

    const weekDoc = await M.TimetableWeek.findOneAndUpdate(
      { classId, weekNumber: w },
      {
        className: cls.name,
        deptId: cls.deptId,
        deptName: cls.deptName,
        academicYear: academicYear || cls.batch || '',
        semester: semester || cls.sem || '',
        weekNumber: w,
        startDate: startStr,
        endDate: endStr,
        status: 'Generated',
        slots: JSON.parse(JSON.stringify(baseSlots)),
        publishedBy: u.name
      },
      { upsert: true, returnDocument: 'after' }
    );
    generatedWeeks.push(weekDoc);
  }

  res.json({
    success: true,
    message: `Generated ${numberOfWeeks} Academic Week instances successfully.`,
    weeks: generatedWeeks
  });
});

// GET list of all academic weeks for a class
router.get('/weeks/:classId', authMiddleware, async (req, res) => {
  const weeks = await M.TimetableWeek.find({ classId: req.params.classId }).sort({ weekNumber: 1 }).lean();
  res.json(weeks);
});

// GET single academic week by ID
router.get('/week/:weekId', authMiddleware, async (req, res) => {
  const week = await M.TimetableWeek.findById(req.params.weekId).lean();
  if (!week) return res.status(404).json({ error: 'Academic week not found' });
  res.json(week);
});

// PUT update single academic week slots (Tier 2 modification)
router.put('/week/:weekId', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator access required' });

  const { slots } = req.body;
  const week = await M.TimetableWeek.findById(req.params.weekId);
  if (!week) return res.status(404).json({ error: 'Academic week not found' });

  week.slots = slots || {};
  week.status = 'Modified';
  week.markModified('slots');
  await week.save();

  res.json({ success: true, message: 'Academic Week updated', week });
});

// POST publish single academic week
router.post('/week/:weekId/publish', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canApproveTT(u)) return res.status(403).json({ error: 'HOD or Admin authorization required' });

  const week = await M.TimetableWeek.findById(req.params.weekId);
  if (!week) return res.status(404).json({ error: 'Academic week not found' });

  week.status = 'Published';
  week.publishedBy = u.name;
  week.publishedAt = new Date();
  await week.save();

  res.json({ success: true, message: `Week ${week.weekNumber} published successfully.`, week });
});

// ── 9. DAY OVERRIDES (FEATURE 13 - TIER 3 DELTA STORAGE) ──

// GET overrides for a class on a specific date
router.get('/override/:classId/:date', authMiddleware, async (req, res) => {
  const override = await M.TimetableDayOverride.findOne({
    classId: req.params.classId,
    date: req.params.date
  }).lean();
  res.json(override || { classId: req.params.classId, date: req.params.date, overrides: [], isHoliday: false });
});

// PUT upsert date overrides (stores delta only: swap, substitute, cancel, replace, holiday)
router.put('/override/:classId/:date', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator access required' });

  const { day, overrides, isHoliday, holidayReason } = req.body;
  const cls = await M.Class.findById(req.params.classId).lean();

  const doc = await M.TimetableDayOverride.findOneAndUpdate(
    { classId: req.params.classId, date: req.params.date },
    {
      className: cls?.name || '',
      deptId: cls?.deptId,
      date: req.params.date,
      day: day || 'Mon',
      isHoliday: !!isHoliday,
      holidayReason: holidayReason || '',
      overrides: overrides || [],
      status: 'active',
      updatedBy: u.name
    },
    { upsert: true, returnDocument: 'after' }
  );

  res.json({ success: true, message: 'Day override saved successfully.', override: doc });
});

// DELETE remove day override
router.delete('/override/:classId/:date', authMiddleware, async (req, res) => {
  const u = req.user;
  if (!canEditTT(u)) return res.status(403).json({ error: 'TT Coordinator access required' });

  await M.TimetableDayOverride.findOneAndDelete({
    classId: req.params.classId,
    date: req.params.date
  });

  res.json({ success: true, message: 'Day override deleted. Timetable reverted to parent schedule.' });
});

// ── 10. AUTHORITATIVE SCHEDULE RESOLUTION (DAY OVERRIDE > WEEK INSTANCE > SEMESTER MASTER) ──

router.get('/resolve/:classId/:date', authMiddleware, async (req, res) => {
  try {
    const { classId, date } = req.params;
    const targetDate = new Date(date + 'T00:00:00Z');
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayAbbr = dayNames[targetDate.getUTCDay()];
    const fullDayMap = {
      'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday',
      'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday', 'Sun': 'Sunday'
    };
    const dayFull = fullDayMap[dayAbbr] || 'Monday';

    // 1. Determine baseline from Academic Week Instance or Semester Master
    let baseSlots = {};
    let resolutionSource = 'semester_master';
    let weekInfo = null;

    // Check if an Academic Week instance covers this date
    const weekDoc = await M.TimetableWeek.findOne({
      classId,
      startDate: { $lte: date },
      endDate: { $gte: date }
    }).lean();

    if (weekDoc && weekDoc.slots && Object.keys(weekDoc.slots).length > 0) {
      baseSlots = weekDoc.slots;
      resolutionSource = 'week_instance';
      weekInfo = {
        weekNumber: weekDoc.weekNumber,
        status: weekDoc.status,
        startDate: weekDoc.startDate,
        endDate: weekDoc.endDate
      };
    } else {
      const prod = await M.SectionTimetable.findOne({ classId }).lean();
      baseSlots = prod?.slots || {};
    }

    // Extract slots for this specific day
    const daySlots = {};
    for (const [sKey, slotVal] of Object.entries(baseSlots)) {
      if (sKey.startsWith(`${dayFull}_`) || sKey.startsWith(`${dayAbbr}_`)) {
        daySlots[sKey] = JSON.parse(JSON.stringify(slotVal));
      }
    }

    // 2. Check Day Instance Override (Tier 3 - Delta Overrides)
    const override = await M.TimetableDayOverride.findOne({ classId, date }).lean();

    if (override) {
      if (override.isHoliday) {
        return res.json({
          success: true,
          date,
          day: dayAbbr,
          dayFull,
          isHoliday: true,
          holidayReason: override.holidayReason || 'Institutional Holiday',
          slots: {},
          source: 'day_override',
          weekInfo
        });
      }

      if (override.overrides && override.overrides.length > 0) {
        resolutionSource = 'day_override';
        for (const delta of override.overrides) {
          const key = `${dayFull}_${delta.periodNumber}`;
          if (delta.action === 'swap') {
            const swapKey = `${dayFull}_${delta.swapWithPeriod}`;
            const temp = daySlots[key];
            daySlots[key] = daySlots[swapKey];
            daySlots[swapKey] = temp;
          } else if (delta.action === 'substitute') {
            if (daySlots[key]) {
              daySlots[key].isSubstitute = true;
              daySlots[key].originalTeacherName = daySlots[key].staff || daySlots[key].teacherName;
              daySlots[key].staff = delta.substituteTeacherName || daySlots[key].staff;
              daySlots[key].teacherName = delta.substituteTeacherName || daySlots[key].teacherName;
              daySlots[key].trackId = delta.substituteTeacherId || daySlots[key].trackId;
              daySlots[key].substituteReason = delta.reason || '';
            }
          } else if (delta.action === 'cancel') {
            if (daySlots[key]) {
              daySlots[key].isCancelled = true;
              daySlots[key].cancelReason = delta.reason || 'Period Cancelled';
            }
          } else if (delta.action === 'replace') {
            daySlots[key] = {
              ...delta.newSlot,
              periodNumber: delta.periodNumber,
              isOverrideReplaced: true
            };
          }
        }
      }
    }

    res.json({
      success: true,
      date,
      day: dayAbbr,
      dayFull,
      isHoliday: false,
      slots: daySlots,
      source: resolutionSource,
      overrideDetails: override ? { overridesCount: override.overrides?.length || 0 } : null,
      weekInfo
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 8. PLAN 3: REAL-TIME CONFLICT CHECK, TEMPLATES & AUTO-GEN ENGINE ──

// POST /api/timetable/check-conflicts — Bulk pre-generation availability preview for Auto-Gen
router.post('/check-conflicts', authMiddleware, async (req, res) => {
  try {
    const { subjects } = req.body;
    if (!Array.isArray(subjects) || subjects.length === 0) return res.json([]);

    const MAX_WEEKLY_PERIODS = 30;
    const liveAndDraftSlots = await M.Timetable.find({}).lean();
    const results = [];

    for (const subj of subjects) {
      const staffName = (subj.staff || '').trim();
      const hoursNeeded = Number(subj.hours) || 0;

      if (!staffName) {
        results.push({ ok: true, message: `${subj.name} — no staff assigned yet (${hoursNeeded} hrs/wk); assign before publishing.` });
        continue;
      }

      const existingLoad = liveAndDraftSlots
        .filter(s => (s.teacherName || '').toLowerCase().trim() === staffName.toLowerCase())
        .reduce((sum, s) => sum + (Number(s.span) || 1), 0);
      const projectedLoad = existingLoad + hoursNeeded;

      results.push(projectedLoad > MAX_WEEKLY_PERIODS
        ? { ok: false, message: `${subj.name} — ${staffName} would reach ${projectedLoad} periods/week (currently ${existingLoad}), above the ${MAX_WEEKLY_PERIODS}/week guideline.` }
        : { ok: true, message: `${subj.name} — ${staffName} is available (currently ${existingLoad} periods/wk, adding ${hoursNeeded}).` });
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/timetable/check-conflict - Real-time collision check for Drag & Drop & slot changes
router.post('/check-conflict', authMiddleware, async (req, res) => {
  try {
    const { day, periodNumber, teacherName, trackId, hallNo, excludeDraftId, span, classId, startTime, endTime } = req.body;
    const conflicts = await checkConflictsForSlot(
      day,
      periodNumber,
      teacherName,
      trackId,
      hallNo,
      excludeDraftId,
      startTime,
      endTime,
      span || 1,
      classId
    );
    res.json({ success: true, conflicts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/timetable/templates - List all reusable templates
router.get('/templates', authMiddleware, async (req, res) => {
  try {
    const { deptId } = req.query;
    const filter = { $or: [{ isSystem: true }] };
    if (deptId) filter.$or.push({ deptId });
    const templates = await M.TimetableTemplate.find(filter).sort({ isSystem: -1, createdAt: -1 });
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/timetable/templates/:id - Get single template
router.get('/templates/:id', authMiddleware, async (req, res) => {
  try {
    const template = await M.TimetableTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/timetable/templates - Create custom template
router.post('/templates', authMiddleware, async (req, res) => {
  try {
    if (!canEditTT(req.user)) return res.status(403).json({ error: 'Unauthorized to create templates' });
    const {
      code,
      name,
      description,
      timingSetCode,
      applicableYears,
      workingDays,
      periodsPerDay,
      defaultLabDuration,
      rules,
      deptId,
      deptName
    } = req.body;

    const template = await M.TimetableTemplate.create({
      code: code || ('TPL_' + Date.now().toString(36).toUpperCase()),
      name,
      description,
      timingSetCode: timingSetCode || 'SET_1',
      applicableYears: applicableYears || ['1', '2', '3', '4'],
      workingDays: workingDays || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      periodsPerDay: periodsPerDay || 9,
      defaultLabDuration: defaultLabDuration || 3,
      rules: rules || {},
      isSystem: false,
      deptId: deptId || req.user.deptId,
      deptName: deptName || req.user.deptName || '',
      createdBy: req.user.trackId || req.user.name,
    });
    res.status(201).json(template);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/timetable/templates/:id - Delete custom template
router.delete('/templates/:id', authMiddleware, async (req, res) => {
  try {
    if (!canEditTT(req.user)) return res.status(403).json({ error: 'Unauthorized' });
    const template = await M.TimetableTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    if (template.isSystem) return res.status(400).json({ error: 'System templates cannot be deleted' });
    await M.TimetableTemplate.findByIdAndDelete(req.params.id);
    res.json({ success: true, deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/timetable/auto-gen - Intelligent Auto-Generation Engine (Section & Year-Wide)
router.post('/auto-gen', authMiddleware, async (req, res) => {
  try {
    if (!canEditTT(req.user)) return res.status(403).json({ error: 'Unauthorized to generate timetables' });
    const {
      deptId,
      year,
      targetScope = 'section', // 'section' or 'year'
      classId,
      templateId,
      hall,
      labHall,
      workingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      maxTeacherHoursPerDay = 4,
      labDuration = 3,
      avoidFirstPeriodLab = true,
      subjects = []
    } = req.body;

    if (!deptId) return res.status(400).json({ error: 'Department ID is required' });

    // Helper: Normalize year strings
    const normalizeYear = (y) => {
      const s = String(y || '').trim().toLowerCase();
      if (s.includes('1') || s.includes('i') && !s.includes('ii') && !s.includes('iv')) return ['1', 'I', '1st Year', 'Year 1', 'Year I'];
      if (s.includes('2') || s.includes('ii') && !s.includes('iii')) return ['2', 'II', '2nd Year', 'Year 2', 'Year II'];
      if (s.includes('3') || s.includes('iii')) return ['3', 'III', '3rd Year', 'Year 3', 'Year III'];
      if (s.includes('4') || s.includes('iv')) return ['4', 'IV', '4th Year', 'Year 4', 'Year IV'];
      return [s];
    };

    // Determine target classes
    let targetClasses = [];
    if (targetScope === 'year') {
      const yrVariations = normalizeYear(year);
      targetClasses = await M.Class.find({
        deptId,
        $or: [
          { year: { $in: yrVariations } },
          { name: new RegExp(`-(${yrVariations.join('|')})-`, 'i') }
        ]
      }).lean();
      if (targetClasses.length === 0) {
        targetClasses = await M.Class.find({ deptId }).lean();
      }
    } else {
      if (classId) {
        const cls = await M.Class.findById(classId).lean();
        if (cls) targetClasses.push(cls);
      }
    }

    if (targetClasses.length === 0) {
      return res.status(404).json({ error: 'No classes found for timetable generation' });
    }

    // Load available subjects if not supplied
    let availableSubjects = subjects;
    if (!availableSubjects || availableSubjects.length === 0) {
      const dbSubjects = await M.Subject.find({ deptId }).lean();
      availableSubjects = dbSubjects.map(s => ({
        name: s.name,
        code: s.code || s.subjectCode || '',
        type: s.type || 'Theory',
        hours: s.type === 'Lab' ? 3 : 4,
        credit: s.credits || 3,
        staff: '',
        hall: s.type === 'Lab' ? (labHall || 'CS-LAB-1') : (hall || 'LH-101')
      }));
    }

    // Separate labs and theory
    const labSubjects = availableSubjects.filter(s =>
      String(s.type).toLowerCase() === 'lab' || String(s.name).toLowerCase().includes('lab')
    );
    const theorySubjects = availableSubjects.filter(s =>
      String(s.type).toLowerCase() !== 'lab' && !String(s.name).toLowerCase().includes('lab')
    );

    // Preload global bookings across college to avoid collisions
    const collegeBookings = await M.Timetable.find({}).lean();
    const teacherOccupancy = {};
    const roomOccupancy = {};

    const markOccupied = (tName, rName, day, p) => {
      if (tName) {
        const t = String(tName).toLowerCase().trim();
        if (!teacherOccupancy[t]) teacherOccupancy[t] = {};
        if (!teacherOccupancy[t][day]) teacherOccupancy[t][day] = new Set();
        teacherOccupancy[t][day].add(p);
      }
      if (rName) {
        const r = String(rName).toLowerCase().trim();
        if (!roomOccupancy[r]) roomOccupancy[r] = {};
        if (!roomOccupancy[r][day]) roomOccupancy[r][day] = new Set();
        roomOccupancy[r][day].add(p);
      }
    };

    const isFree = (tName, rName, day, p) => {
      if (tName) {
        const t = String(tName).toLowerCase().trim();
        if (teacherOccupancy[t]?.[day]?.has(p)) return false;
      }
      if (rName) {
        const r = String(rName).toLowerCase().trim();
        if (roomOccupancy[r]?.[day]?.has(p)) return false;
      }
      return true;
    };

    // Populate initial occupancy with live and draft bookings
    collegeBookings.forEach(s => {
      const day = s.day;
      const startP = s.periodNumber || s.startPeriod || 1;
      const endP = s.endPeriod || (startP + (s.span || 1) - 1);
      for (let p = startP; p <= endP; p++) {
        markOccupied(s.teacherName || s.staff, s.hallNo || s.hall, day, p);
      }
    });

    const generatedDrafts = [];
    let primarySlots = {};

    for (const cls of targetClasses) {
      const yrStr = String(cls.year || year || '');
      const isSet2 = yrStr.includes('2') || yrStr.includes('3') || yrStr.includes('II') || yrStr.includes('III');

      let candidateLabStarts = isSet2
        ? (avoidFirstPeriodLab ? [4, 7] : [1, 4, 7])
        : (avoidFirstPeriodLab ? [4, 7] : [3, 4, 7]);

      const classSlots = {};
      const sectionDailyLabCount = {};
      const sectionDailySubjectCount = {};
      const teacherDailyClassCount = {};

      workingDays.forEach(d => {
        sectionDailyLabCount[d] = 0;
        sectionDailySubjectCount[d] = {};
        teacherDailyClassCount[d] = {};
      });

      // Phase 1: Allocate Lab sessions (3 continuous periods)
      for (const lab of labSubjects) {
        let placed = false;
        const staffName = lab.staff || '';
        const hallName = lab.hall || labHall || 'CS-LAB-1';

        // Prefer working days with 0 labs yet
        const candidateDays = [...workingDays].sort((a, b) => (sectionDailyLabCount[a] || 0) - (sectionDailyLabCount[b] || 0));

        for (const day of candidateDays) {
          if (placed) break;
          if (sectionDailyLabCount[day] >= 1) continue; // Max 1 lab block per day for a section

          for (const startP of candidateLabStarts) {
            let allPeriodsFree = true;
            for (let offset = 0; offset < labDuration; offset++) {
              const p = startP + offset;
              if (classSlots[`${day}-${p}`] || !isFree(staffName, hallName, day, p)) {
                allPeriodsFree = false;
                break;
              }
            }

            if (allPeriodsFree) {
              const key = `${day}-${startP}`;
              classSlots[key] = {
                subject: lab.name,
                subjectId: lab.subjectId || null,
                code: lab.code || '',
                staff: staffName,
                hall: hallName,
                credit: lab.credit || 3,
                type: 'Lab',
                span: labDuration,
              };

              for (let offset = 0; offset < labDuration; offset++) {
                const p = startP + offset;
                markOccupied(staffName, hallName, day, p);
              }

              sectionDailyLabCount[day] = (sectionDailyLabCount[day] || 0) + 1;
              placed = true;
              break;
            }
          }
        }
      }

      // Phase 2: Allocate Theory subjects
      const teachingPeriods = [1, 2, 3, 4, 5, 6, 7, 8, 9];

      for (const subj of theorySubjects) {
        let hoursRemaining = subj.hours || 4;
        const staffName = subj.staff || '';
        const hallName = subj.hall || hall || 'LH-101';

        const daysOrder = [...workingDays].sort(() => Math.random() - 0.5);

        for (const day of daysOrder) {
          if (hoursRemaining <= 0) break;
          if ((sectionDailySubjectCount[day]?.[subj.name] || 0) >= 2) continue; // Max 2 of same subject per day
          if (staffName && (teacherDailyClassCount[day]?.[staffName] || 0) >= maxTeacherHoursPerDay) continue;

          for (const p of teachingPeriods) {
            if (hoursRemaining <= 0) break;
            const key = `${day}-${p}`;

            let isSlotTaken = !!classSlots[key];
            for (let prevP = 1; prevP < p; prevP++) {
              const prevSlot = classSlots[`${day}-${prevP}`];
              if (prevSlot && Number(prevSlot.span) > 1) {
                if (prevP + Number(prevSlot.span) - 1 >= p) {
                  isSlotTaken = true;
                  break;
                }
              }
            }

            if (!isSlotTaken && isFree(staffName, hallName, day, p)) {
              classSlots[key] = {
                subject: subj.name,
                subjectId: subj.subjectId || null,
                code: subj.code || '',
                staff: staffName,
                hall: hallName,
                credit: subj.credit || 3,
                type: 'Theory',
                span: 1,
              };

              markOccupied(staffName, hallName, day, p);
              sectionDailySubjectCount[day][subj.name] = (sectionDailySubjectCount[day][subj.name] || 0) + 1;
              if (staffName) {
                teacherDailyClassCount[day][staffName] = (teacherDailyClassCount[day][staffName] || 0) + 1;
              }
              hoursRemaining--;
            }
          }
        }
      }

      // Phase 3: Persist into TimetableDraft & sync individual teacher slots
      let draftDoc = await M.TimetableDraft.findOne({ classId: cls._id });
      if (!draftDoc) {
        draftDoc = new M.TimetableDraft({
          classId: cls._id,
          className: cls.name,
          deptId: cls.deptId,
          deptName: cls.deptName || '',
          status: 'draft',
          createdBy: req.user.trackId || req.user.name,
          createdByName: req.user.name,
        });
      }
      draftDoc.slots = classSlots;
      draftDoc.updatedBy = req.user.name;
      await draftDoc.save();

      // Sync individual teacher draft slots
      await M.Timetable.deleteMany({ draftId: draftDoc._id });
      for (const [slotKey, slotVal] of Object.entries(classSlots)) {
        if (slotVal && (slotVal.staff || slotVal.teacherName)) {
          await syncTeacherDraftSlot(draftDoc, slotKey, slotVal, cls);
        }
      }

      generatedDrafts.push({
        classId: cls._id,
        className: cls.name,
        slotsCount: Object.keys(classSlots).length,
        draftId: draftDoc._id
      });

      if (!primarySlots || Object.keys(primarySlots).length === 0 || cls._id.toString() === classId) {
        primarySlots = classSlots;
      }
    }

    res.json({
      success: true,
      message: `Auto-generated ${generatedDrafts.length} section timetable(s) with continuous labs and zero teacher collisions.`,
      sections: generatedDrafts,
      slots: primarySlots,
      totalSections: generatedDrafts.length,
      generatedCount: Object.keys(primarySlots).length
    });
  } catch (err) {
    console.error('Auto-Gen Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// PLAN 4 & 5: FREE-SLOT FINDER, REPORTS, CALENDAR STATS & PUBLISH WORKFLOW
// ─────────────────────────────────────────────────────────────────────────

// ── FEATURE 11: TEACHER FREE-SLOT FINDER ──

// GET /api/timetable/free-teachers — Search available teachers with real-time free/busy/leave status
router.get('/free-teachers', authMiddleware, async (req, res) => {
  try {
    const dateStr = sanitizeToString(req.query.date) || new Date().toISOString().split('T')[0];
    const targetPeriod = req.query.periodNumber ? Number(req.query.periodNumber) : null;
    const deptId = sanitizeToString(req.query.deptId);
    const search = (sanitizeToString(req.query.search) || '').toLowerCase();

    const dObj = new Date(dateStr + 'T00:00:00.000Z');
    const dowIndex = dObj.getUTCDay();
    const dayAbbr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dowIndex];
    const dayFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dowIndex];

    // Filter teachers
    const teacherFilter = {};
    if (deptId && deptId !== 'all') {
      teacherFilter.$or = [
        { deptId: mongoose.isValidObjectId(deptId) ? deptId : undefined },
        { department: deptId }
      ].filter(Boolean);
    }
    const teachers = await M.Teacher.find(teacherFilter).select('fullName trackId department deptId email designation employeeNo').lean();

    // 1. Check if the date itself is an official leave/holiday from AcademicCalendar
    const calDay = await M.CalendarDay.findOne({
      $or: [
        { date: new Date(dateStr + 'T00:00:00.000Z') },
        { date: new Date(dateStr + 'T00:00:00') }
      ]
    }).lean();
    const isCollegeHoliday = calDay?.details?.some(d => d.dayType === 'leave');

    // 2. Fetch all live timetable slots for this day across college
    const scheduledSlots = await M.Timetable.find({
      day: dayAbbr,
      isDraft: false
    }).lean();

    // 3. Fetch day overrides for this date (substitutions or cancellations)
    const dayOverrides = await M.TimetableDayOverride.find({
      date: dateStr,
      status: 'active'
    }).lean();

    // 4. Fetch approved teacher leaves on this date
    const leaves = await M.TeacherLeaveRequest.find({
      dates: dateStr,
      status: 'Approved'
    }).lean();

    const results = [];

    for (const t of teachers) {
      if (search && !t.fullName.toLowerCase().includes(search) && !(t.department || '').toLowerCase().includes(search)) {
        continue;
      }

      const teacherNames = [t.fullName, t.name].filter(Boolean);
      const teacherTrackId = t.trackId;

      // Check if teacher is on approved leave
      const teacherLeave = leaves.find(l =>
        String(l.teacherId) === String(t._id) || l.teacherTrackId === teacherTrackId
      );

      const periodStatus = {};
      const teachingDetails = {};

      for (let p = 1; p <= 9; p++) {
        let status = 'free';
        let detail = null;

        if (isCollegeHoliday) {
          status = 'holiday';
          detail = { reason: 'College Holiday' };
        } else if (teacherLeave) {
          if (teacherLeave.slot === 'Full Day') {
            status = 'leave';
            detail = { reason: teacherLeave.reason || 'On Approved Leave' };
          } else if (teacherLeave.slot === 'FN' && p <= 4) {
            status = 'leave';
            detail = { reason: 'FN Leave' };
          } else if (teacherLeave.slot === 'AN' && p >= 5) {
            status = 'leave';
            detail = { reason: 'AN Leave' };
          }
        }

        // Check if regular scheduled teaching slot
        if (status === 'free') {
          const mySlot = scheduledSlots.find(s =>
            (s.trackId === teacherTrackId || teacherNames.includes(s.teacherName)) &&
            (s.periodNumber === p || (s.startPeriod <= p && s.endPeriod >= p))
          );

          if (mySlot) {
            // Check if cancelled or substituted away by DayOverride
            const ovForClass = dayOverrides.find(o => String(o.classId) === String(mySlot.classId));
            const ovItem = ovForClass?.overrides?.find(ov => ov.periodNumber === p);

            if (ovItem && ovItem.action === 'cancel') {
              status = 'free';
            } else if (ovItem && ovItem.action === 'substitute' && ovItem.substituteTeacherId !== teacherTrackId) {
              status = 'free';
            } else {
              status = 'busy';
              detail = {
                className: mySlot.className,
                subjectName: mySlot.subjectName,
                hallNo: mySlot.hallNo,
                start: mySlot.start,
                end: mySlot.end
              };
            }
          }
        }

        // Check if teacher is assigned as a substitute in this period
        if (status === 'free') {
          for (const ovDoc of dayOverrides) {
            const subItem = ovDoc.overrides?.find(ov =>
              ov.periodNumber === p &&
              ov.action === 'substitute' &&
              (ov.substituteTeacherId === teacherTrackId || teacherNames.includes(ov.substituteTeacherName))
            );
            if (subItem) {
              status = 'substitute_busy';
              detail = {
                className: ovDoc.className,
                subjectName: subItem.newSlot?.subjectName || 'Substituted Class',
                hallNo: subItem.newSlot?.hallNo || '',
                substitutingFor: subItem.originalSlot?.teacherName || ''
              };
              break;
            }
          }
        }

        periodStatus[p] = status;
        if (detail) teachingDetails[p] = detail;
      }

      const freePeriods = Object.keys(periodStatus).filter(p => periodStatus[p] === 'free').map(Number);
      const busyPeriods = Object.keys(periodStatus).filter(p => periodStatus[p] === 'busy' || periodStatus[p] === 'substitute_busy').map(Number);
      const isFreeForTarget = targetPeriod ? periodStatus[targetPeriod] === 'free' : true;

      results.push({
        _id: t._id,
        trackId: t.trackId,
        fullName: t.fullName,
        department: t.department || '',
        deptId: t.deptId,
        designation: t.designation || 'Faculty',
        periodStatus,
        teachingDetails,
        freePeriods,
        busyPeriods,
        isFreeForTarget,
        targetPeriodStatus: targetPeriod ? periodStatus[targetPeriod] : null
      });
    }

    // Sort: teachers who are free for target period first, then by name
    results.sort((a, b) => {
      if (targetPeriod) {
        if (a.isFreeForTarget && !b.isFreeForTarget) return -1;
        if (!a.isFreeForTarget && b.isFreeForTarget) return 1;
      }
      return a.fullName.localeCompare(b.fullName);
    });

    res.json({
      date: dateStr,
      day: dayFull,
      targetPeriod,
      totalTeachers: results.length,
      availableCount: results.filter(r => r.isFreeForTarget).length,
      teachers: results
    });
  } catch (err) {
    console.error('Free teachers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/timetable/teacher-day-schedule — Teacher's full day schedule with overrides
router.get('/teacher-day-schedule', authMiddleware, async (req, res) => {
  try {
    const teacherTrackId = sanitizeToString(req.query.teacherTrackId) || req.user.trackId;
    const dateStr = sanitizeToString(req.query.date) || new Date().toISOString().split('T')[0];

    const dObj = new Date(dateStr + 'T00:00:00.000Z');
    const dayAbbr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dObj.getUTCDay()];

    const regularSlots = await M.Timetable.find({
      trackId: teacherTrackId,
      day: dayAbbr,
      isDraft: false
    }).lean();

    const dayOverrides = await M.TimetableDayOverride.find({
      date: dateStr,
      status: 'active'
    }).lean();

    const schedule = [];
    for (let p = 1; p <= 9; p++) {
      let slotInfo = regularSlots.find(s => s.periodNumber === p || (s.startPeriod <= p && s.endPeriod >= p));
      let isSubstitute = false;
      let originalTeacher = '';

      // Check if substituted away
      if (slotInfo) {
        const ovForClass = dayOverrides.find(o => String(o.classId) === String(slotInfo.classId));
        const ovItem = ovForClass?.overrides?.find(ov => ov.periodNumber === p);
        if (ovItem && ovItem.action === 'substitute' && ovItem.substituteTeacherId !== teacherTrackId) {
          slotInfo = null; // relieved
        } else if (ovItem && ovItem.action === 'cancel') {
          slotInfo = null; // cancelled
        }
      }

      // Check if covering as substitute
      if (!slotInfo) {
        for (const ovDoc of dayOverrides) {
          const subItem = ovDoc.overrides?.find(ov => ov.periodNumber === p && ov.action === 'substitute' && ov.substituteTeacherId === teacherTrackId);
          if (subItem) {
            slotInfo = {
              className: ovDoc.className,
              classId: ovDoc.classId,
              subjectName: subItem.newSlot?.subjectName || 'Substitute Class',
              hallNo: subItem.newSlot?.hallNo || '',
              periodNumber: p
            };
            isSubstitute = true;
            originalTeacher = subItem.originalSlot?.teacherName || '';
            break;
          }
        }
      }

      schedule.push({
        periodNumber: p,
        timing: PERIOD_TIMES[p] || { start: '', end: '' },
        isFree: !slotInfo,
        isSubstitute,
        originalTeacher,
        slot: slotInfo || null
      });
    }

    res.json({ teacherTrackId, date: dateStr, day: dayAbbr, schedule });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── FEATURE 12: ACADEMIC CALENDAR & REMAINING TEACHING PERIODS ──

router.get('/academic-calendar-stats', authMiddleware, async (req, res) => {
  try {
    const classId = sanitizeToString(req.query.classId);
    if (!classId) return res.status(400).json({ error: 'classId is required' });

    const cls = await M.Class.findById(classId).lean();
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    // Fetch active production timetable for this class
    const prodTT = await M.SectionTimetable.findOne({ classId }).lean();
    const slots = prodTT?.slots || {};

    // Count weekly slots per subject
    const weeklySubjectCounts = {};

    for (const [sKey, slot] of Object.entries(slots)) {
      if (!slot || (!slot.name && !slot.subjectName)) continue;
      const subName = slot.subjectName || slot.name;
      const parts = sKey.split('_');
      const day = parts[0];
      if (!weeklySubjectCounts[subName]) {
        weeklySubjectCounts[subName] = {
          subjectName: subName,
          subjectCode: slot.subjectCode || slot.code || '',
          type: slot.type || 'Theory',
          weeklyTotal: 0,
          byDay: { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 }
        };
      }
      weeklySubjectCounts[subName].weeklyTotal += Number(slot.span || 1);
      const dAbbr = DAY_ABBR_MAP[day] || day.slice(0, 3);
      if (weeklySubjectCounts[subName].byDay[dAbbr] !== undefined) {
        weeklySubjectCounts[subName].byDay[dAbbr] += Number(slot.span || 1);
      }
    }

    // Determine current semester dates from Academic Calendar
    const allCalDays = await M.CalendarDay.find().sort({ date: 1 }).lean();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let totalWorkingDays = 0;
    let holidaysCount = 0;
    let workingSaturdaysCount = 0;
    let examsCount = 0;
    let remainingWorkingDays = 0;

    const dayCounts = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
    const remainingDayCounts = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };

    for (const cal of allCalDays) {
      const cDate = new Date(cal.date);
      cDate.setHours(0, 0, 0, 0);
      const dowIndex = cDate.getUTCDay();
      if (dowIndex === 0) continue; // Skip Sunday

      const dAbbr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dowIndex];
      const isLeave = cal.details?.some(d => d.dayType === 'leave');
      const isExam = cal.details?.some(d => d.dayType === 'exam');
      const isWorkingSat = dowIndex === 6 && cal.details?.some(d => d.dayType === 'working');

      if (isLeave) {
        holidaysCount++;
      } else if (isExam) {
        examsCount++;
      } else {
        totalWorkingDays++;
        if (dowIndex === 6 && isWorkingSat) workingSaturdaysCount++;
        if (dayCounts[dAbbr] !== undefined) dayCounts[dAbbr]++;

        if (cDate >= today) {
          remainingWorkingDays++;
          if (remainingDayCounts[dAbbr] !== undefined) remainingDayCounts[dAbbr]++;
        }
      }
    }

    // If no CalendarDay entries populated yet, provide intelligent defaults based on standard 90-day semester
    if (totalWorkingDays === 0) {
      totalWorkingDays = 90;
      remainingWorkingDays = 45;
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].forEach(d => {
        dayCounts[d] = 18;
        remainingDayCounts[d] = 9;
      });
    }

    // Calculate actual teaching periods per subject
    const subjectStats = Object.values(weeklySubjectCounts).map(s => {
      let totalSemesterPeriods = 0;
      let remainingTeachingPeriods = 0;

      for (const [d, count] of Object.entries(s.byDay)) {
        totalSemesterPeriods += count * (dayCounts[d] || 0);
        remainingTeachingPeriods += count * (remainingDayCounts[d] || 0);
      }

      const targetSyllabusHours = 45; // Standard AICTE 45 periods syllabus
      const completionPercent = totalSemesterPeriods > 0
        ? Math.min(100, Math.round(((totalSemesterPeriods - remainingTeachingPeriods) / totalSemesterPeriods) * 100))
        : 0;

      return {
        ...s,
        totalSemesterPeriods,
        remainingTeachingPeriods,
        completedPeriods: totalSemesterPeriods - remainingTeachingPeriods,
        targetSyllabusHours,
        completionPercent
      };
    });

    res.json({
      className: cls.name,
      classId: cls._id,
      calendarSummary: {
        totalWorkingDays,
        remainingWorkingDays,
        holidaysCount,
        workingSaturdaysCount,
        examsCount,
        dayCounts,
        remainingDayCounts
      },
      subjects: subjectStats
    });
  } catch (err) {
    console.error('Academic calendar stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── FEATURE 7: REPORTS & ANALYTICS ──

// GET /api/timetable/reports/teacher-workload
router.get('/reports/teacher-workload', authMiddleware, async (req, res) => {
  try {
    const deptId = sanitizeToString(req.query.deptId);
    const filter = {};
    if (deptId && deptId !== 'all') {
      filter.$or = [
        { deptId: mongoose.isValidObjectId(deptId) ? deptId : undefined },
        { department: deptId }
      ].filter(Boolean);
    }

    const teachers = await M.Teacher.find(filter).select('fullName trackId department deptId designation').lean();
    const liveSlots = await M.Timetable.find({ isDraft: false }).lean();

    const workloadList = [];
    let totalDeptPeriods = 0;

    for (const t of teachers) {
      const tNames = [t.fullName, t.name].filter(Boolean);
      const mySlots = liveSlots.filter(s => s.trackId === t.trackId || tNames.includes(s.teacherName));

      let theoryPeriods = 0;
      let labHours = 0;

      mySlots.forEach(s => {
        const span = Number(s.span || 1);
        if (s.type === 'Lab' || span > 1) {
          labHours += span;
        } else {
          theoryPeriods += span;
        }
      });

      const totalPeriods = theoryPeriods + labHours;
      totalDeptPeriods += totalPeriods;

      let loadStatus = 'Balanced';
      if (totalPeriods > 20) loadStatus = 'Overloaded';
      else if (totalPeriods < 12) loadStatus = 'Underloaded';

      workloadList.push({
        teacherId: t._id,
        trackId: t.trackId,
        fullName: t.fullName,
        department: t.department || '—',
        designation: t.designation || 'Faculty',
        theoryPeriods,
        labHours,
        totalPeriods,
        loadStatus,
        assignedClassesCount: new Set(mySlots.map(s => s.className)).size
      });
    }

    workloadList.sort((a, b) => b.totalPeriods - a.totalPeriods);
    const avgPeriods = teachers.length > 0 ? (totalDeptPeriods / teachers.length).toFixed(1) : 0;

    res.json({
      totalTeachers: teachers.length,
      averagePeriodsPerTeacher: avgPeriods,
      overloadedCount: workloadList.filter(w => w.loadStatus === 'Overloaded').length,
      underloadedCount: workloadList.filter(w => w.loadStatus === 'Underloaded').length,
      teachers: workloadList
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/timetable/reports/room-utilization
router.get('/reports/room-utilization', authMiddleware, async (req, res) => {
  try {
    const rooms = await M.Room.find({ isActive: true }).lean();
    const liveSlots = await M.Timetable.find({ isDraft: false }).lean();

    const maxWeeklyPeriods = 45; // 9 periods * 5 days (Mon-Fri)

    const utilizationList = rooms.map(r => {
      const roomSlots = liveSlots.filter(s => s.hallNo && s.hallNo.trim().toUpperCase() === r.hallNo.trim().toUpperCase());
      const hoursUsed = roomSlots.reduce((sum, s) => sum + Number(s.span || 1), 0);
      const utilizationPercent = Math.min(100, Math.round((hoursUsed / maxWeeklyPeriods) * 100));

      let status = 'Normal';
      if (utilizationPercent > 75) status = 'Optimal';
      else if (utilizationPercent < 40) status = 'Underutilized';

      return {
        roomId: r._id,
        hallNo: r.hallNo,
        name: r.name || r.hallNo,
        type: r.type || 'Theory',
        capacity: r.capacity || 60,
        department: r.deptName || 'General',
        hoursUsed,
        maxWeeklyPeriods,
        utilizationPercent,
        status,
        bookedSlotsCount: roomSlots.length
      };
    });

    utilizationList.sort((a, b) => b.utilizationPercent - a.utilizationPercent);

    res.json({
      totalRooms: rooms.length,
      optimalCount: utilizationList.filter(u => u.status === 'Optimal').length,
      underutilizedCount: utilizationList.filter(u => u.status === 'Underutilized').length,
      rooms: utilizationList
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/timetable/reports/subject-distribution
router.get('/reports/subject-distribution', authMiddleware, async (req, res) => {
  try {
    const classId = sanitizeToString(req.query.classId);
    const deptId = sanitizeToString(req.query.deptId);

    const classFilter = {};
    if (classId) classFilter._id = classId;
    else if (deptId && deptId !== 'all') {
      classFilter.deptId = mongoose.isValidObjectId(deptId) ? deptId : undefined;
    }

    const classes = await M.Class.find(classFilter).lean();
    const allSubjects = await M.Subject.find().lean();
    const subjMap = new Map(allSubjects.map(s => [s.name.toLowerCase(), s]));

    const report = [];

    for (const cls of classes) {
      const prodTT = await M.SectionTimetable.findOne({ classId: cls._id }).lean();
      const slots = prodTT?.slots || {};
      const classSubjectStats = {};

      for (const slot of Object.values(slots)) {
        if (!slot || (!slot.name && !slot.subjectName)) continue;
        const sName = slot.subjectName || slot.name;
        if (!classSubjectStats[sName]) {
          const matchSub = subjMap.get(sName.toLowerCase());
          classSubjectStats[sName] = {
            subjectName: sName,
            shortName: matchSub?.shortName || '',
            subjectCode: matchSub?.code || slot.subjectCode || '',
            credits: matchSub?.credits || 3,
            type: matchSub?.type || slot.type || 'Theory',
            weeklyHours: 0
          };
        }
        classSubjectStats[sName].weeklyHours += Number(slot.span || 1);
      }

      report.push({
        classId: cls._id,
        className: cls.name,
        department: cls.deptName || '',
        subjects: Object.values(classSubjectStats)
      });
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── FEATURE 8: PUBLISH PRE-FLIGHT DIFF & NOTIFICATIONS ──

// GET /api/timetable/publish-preview/:classId — Diff comparison between draft and live production
router.get('/publish-preview/:classId', authMiddleware, async (req, res) => {
  try {
    const classId = req.params.classId;
    const cls = await M.Class.findById(classId).lean();
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const [draft, prod] = await Promise.all([
      M.TimetableDraft.findOne({ classId }).lean(),
      M.SectionTimetable.findOne({ classId }).lean()
    ]);

    const draftSlots = draft?.slots || {};
    const prodSlots = prod?.slots || {};

    const allKeys = Array.from(new Set([...Object.keys(draftSlots), ...Object.keys(prodSlots)]));

    const added = [];
    const removed = [];
    const modified = [];
    const unchanged = [];

    const impactedTeachers = new Set();

    for (const k of allKeys) {
      const dVal = draftSlots[k];
      const pVal = prodSlots[k];

      if (!pVal && dVal) {
        added.push({ slotKey: k, slot: dVal });
        if (dVal.staff || dVal.teacherName) impactedTeachers.add(dVal.staff || dVal.teacherName);
      } else if (pVal && !dVal) {
        removed.push({ slotKey: k, slot: pVal });
        if (pVal.staff || pVal.teacherName) impactedTeachers.add(pVal.staff || pVal.teacherName);
      } else {
        const dStaff = dVal?.staff || dVal?.teacherName || '';
        const pStaff = pVal?.staff || pVal?.teacherName || '';
        const dSubj = dVal?.subjectName || dVal?.name || '';
        const pSubj = pVal?.subjectName || pVal?.name || '';
        const dHall = dVal?.hall || dVal?.hallNo || '';
        const pHall = pVal?.hall || pVal?.hallNo || '';

        if (dStaff !== pStaff || dSubj !== pSubj || dHall !== pHall) {
          modified.push({
            slotKey: k,
            before: pVal,
            after: dVal,
            changes: {
              teacherChanged: dStaff !== pStaff,
              subjectChanged: dSubj !== pSubj,
              roomChanged: dHall !== pHall
            }
          });
          if (dStaff) impactedTeachers.add(dStaff);
          if (pStaff) impactedTeachers.add(pStaff);
        } else {
          unchanged.push({ slotKey: k, slot: dVal });
        }
      }
    }

    const studentCount = await M.Student.countDocuments({
      $or: [{ classId: cls._id }, { class: cls.name }]
    });

    res.json({
      className: cls.name,
      classId: cls._id,
      draftUpdatedAt: draft?.updatedAt,
      summary: {
        totalDraftSlots: Object.keys(draftSlots).length,
        totalProductionSlots: Object.keys(prodSlots).length,
        addedCount: added.length,
        removedCount: removed.length,
        modifiedCount: modified.length,
        unchangedCount: unchanged.length,
        hasChanges: added.length > 0 || removed.length > 0 || modified.length > 0,
        impactedStudentsCount: studentCount,
        impactedTeachersCount: impactedTeachers.size,
        impactedTeachers: Array.from(impactedTeachers)
      },
      diff: { added, removed, modified, unchanged }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/timetable/publish-with-notify/:classId — Publish draft to live, create backup & notify
router.post('/publish-with-notify/:classId', authMiddleware, async (req, res) => {
  try {
    const u = req.user;
    if (!canEditTT(u)) return res.status(403).json({ error: 'Timetable Coordinator access required' });

    const classId = req.params.classId;
    const { effectiveDate, notes } = req.body;
    const effectiveFromStr = effectiveDate || new Date().toISOString().split('T')[0];

    const cls = await M.Class.findById(classId).lean();
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const draft = await M.TimetableDraft.findOne({ classId });
    if (!draft || !draft.slots || Object.keys(draft.slots).length === 0) {
      return res.status(400).json({ error: 'No draft timetable slots found to publish' });
    }

    // 1. Archive current production into TimetableBackup
    const currentProd = await M.SectionTimetable.findOne({ classId }).lean();
    if (currentProd && currentProd.slots && Object.keys(currentProd.slots).length > 0) {
      await M.TimetableBackup.create({
        classId,
        className: cls.name,
        deptId: cls.deptId,
        deptName: cls.deptName,
        slots: currentProd.slots,
        approvedBy: u.name,
        publishedAt: currentProd.updatedAt || new Date(),
        archivedAt: new Date(),
        versionLabel: `Archived on ${new Date().toLocaleDateString('en-IN')} prior to publishing revision`
      });
    }

    // 2. Promote draft slots into SectionTimetable (Live Production)
    await M.SectionTimetable.findOneAndUpdate(
      { classId },
      {
        slots: draft.slots,
        updatedBy: `${u.name} (Published on ${new Date().toLocaleDateString('en-IN')})`,
        $setOnInsert: {
          className: cls.name,
          deptId: cls.deptId,
          deptName: cls.deptName
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    // 3. Promote individual teacher slots
    await M.Timetable.deleteMany({ classId, isDraft: false });
    await M.Timetable.updateMany(
      { draftId: draft._id },
      { $set: { isDraft: false }, $unset: { draftId: '' } }
    );

    // 4. Update draft state
    draft.status = 'published';
    draft.reviewedBy = u.trackId || u._id;
    draft.reviewedByName = u.name;
    draft.reviewedAt = new Date();
    await draft.save();

    // 5. Version Changelog
    await M.TimetableVersion.create({
      deptId: cls.deptId,
      deptName: cls.deptName,
      classIds: [classId],
      submittedBy: draft.createdByName || u.name,
      approvedBy: u.name,
      publishedAt: new Date(),
      summary: `Published timetable for ${cls.name} (Effective: ${effectiveFromStr})${notes ? ' - ' + notes : ''}`
    });

    // 6. Broadcast Notifications to Students & Teachers
    const students = await M.Student.find({
      $or: [{ classId: cls._id }, { class: cls.name }]
    }).select('trackId fullName _id').lean();

    const notifPromises = students.map(s => M.Notification.create({
      type: 'timetable-update',
      from: u.name,
      fromRole: 'admin',
      toStudentId: s._id,
      toStudentTrackId: s.trackId,
      toStudentName: s.fullName,
      message: `New Timetable Published for ${cls.name}, effective from ${effectiveFromStr}.`,
      priority: 'Normal',
      time: new Date()
    }).catch(() => { }));

    // Find teachers in new timetable
    const assignedTeachers = new Set();
    Object.values(draft.slots).forEach(sl => {
      if (sl?.staff || sl?.teacherName) assignedTeachers.add(sl.staff || sl.teacherName);
    });

    const teacherDocs = await M.Teacher.find({
      $or: [
        { fullName: { $in: Array.from(assignedTeachers) } },
        { name: { $in: Array.from(assignedTeachers) } }
      ]
    }).select('trackId fullName _id').lean();

    teacherDocs.forEach(t => {
      notifPromises.push(M.Notification.create({
        type: 'timetable-update',
        from: u.name,
        fromRole: 'admin',
        toTeacherId: t._id,
        toTeacherTrackId: t.trackId,
        toTeacherName: t.fullName,
        message: `Updated Timetable Published for ${cls.name}. Please check your updated schedule.`,
        priority: 'Normal',
        time: new Date()
      }).catch(() => { }));
    });

    await Promise.all(notifPromises);

    await logAction(
      u.trackId || u._id,
      u.name,
      u.role,
      'Timetable Published',
      `Published live timetable for ${cls.name} effective from ${effectiveFromStr}`,
      'timetable',
      'info',
      req.ip,
      req.user.sessionId,
      { classId, className: cls.name, effectiveFrom: effectiveFromStr }
    );

    res.json({
      success: true,
      message: `Timetable published successfully! Notified ${students.length} students and ${teacherDocs.length} faculty members.`,
      effectiveDate: effectiveFromStr
    });
  } catch (err) {
    console.error('Publish error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;