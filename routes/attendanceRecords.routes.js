/**
 * routes/attendanceRecords.routes.js
 *
 * Router for Attendance Roster & Attendance Registry (AttReg B7)
 * Endpoints for:
 * - Roster selectors & options
 * - Roster day matrix (lightweight)
 * - Roster period forensics & student drawer
 * - Registry grid matrix
 * - Registry Excel / PDF exports
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { registryExportLimiter } = require('../utils/rateLimiters');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { buildRegistry, formatISTDate, parseYearNum } = require('../services/registryBuilder');
const { generateExcel, generatePdf } = require('../services/registryExportService');
const { computeDeviceTrust } = require('../utils/deviceTrust');
const { logAction } = require('../utils/logAction');
const { getCachedSettings } = require('../utils/settingsCache');
const { hasInstitutionReach, isAdminUser } = require('../utils/access');
const { resolveClassDaySchedule } = require('../utils/timetableResolver');

// Cache-control and auth middleware
router.use(authMiddleware);
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Helper to verify whether user is authorized to view/export records for a class.
 * Allowed if:
 * 1. Admin with institution reach or isAdminUser
 * 2. Teacher assigned as primary or secondary advisor on class
 * 3. Teacher with specials containing isClassAdvisor for this class
 * 4. Active acting role as classAdvisor for this class
 */
async function checkAdvisorAccess(user, cls, req) {
  if (!user || !cls) return false;

  const isTeacherPortal = (req && req.headers && (req.headers['x-portal'] === 'teacher' || req.headers['x-portal'] === 'teacher.html')) ||
    (req && req.query && req.query.scope === 'advisor') ||
    user.role === 'teacher';

  // Sudo/institution admins only have broad reach outside the teacher/advisor portal (e.g. from control portal)
  if (!isTeacherPortal) {
    if (hasInstitutionReach(user) || (isAdminUser(user) && user.role !== 'teacher')) return true;
  }

  const uId = String(user._id || '');
  const uTrack = user.trackId || '';

  // Direct advisor assignments on Class doc
  if (cls.advisorTeacherId && String(cls.advisorTeacherId) === uId) return true;
  if (cls.advisorTeacherTrackId && cls.advisorTeacherTrackId === uTrack) return true;
  if (cls.secondaryAdvisorTeacherId && String(cls.secondaryAdvisorTeacherId) === uId) return true;
  if (cls.secondaryAdvisorTeacherTrackId && cls.secondaryAdvisorTeacherTrackId === uTrack) return true;

  const clsTrack = cls.trackId || cls.classTrackId || '';
  const clsId = String(cls._id || '');
  const clsName = cls.name || '';

  // Specials option: isClassAdvisor (strictly matching key or value to this class)
  const specials = Array.isArray(user.specials) ? user.specials : [];
  const matchesSpecial = specials.some(s => s && s.option === 'isClassAdvisor' && (
    (s.key && s.key !== 'true' && s.key !== 'false' && (s.key === clsTrack || s.key === clsId || s.key === clsName)) ||
    (s.value && s.value !== true && s.value !== 'true' && s.value !== 'false' && (s.value === clsTrack || s.value === clsId || s.value === clsName))
  ));
  if (matchesSpecial) return true;

  // Active acting role check
  try {
    const today = new Date().toISOString().split('T')[0];
    const actingDoc = await M.ActingRole.findOne({
      holderTrackId: uTrack,
      role: 'classAdvisor',
      key: { $in: [clsTrack, clsId, clsName] },
      status: { $in: ['active', 'pending'] },
      from: { $lte: today },
      to: { $gte: today }
    }).lean();
    if (actingDoc) return true;
  } catch (e) {
    // Graceful fallback
  }

  return false;
}

/**
 * GET /api/attendance-records/roster/options
 * Cascading selectors: Departments and Classes
 */
router.get('/roster/options', async (req, res) => {
  try {
    const qDeptId = sanitizeToString(req.query.deptId);
    const isTeacherPortal = (req.headers && (req.headers['x-portal'] === 'teacher' || req.headers['x-portal'] === 'teacher.html')) ||
      req.query.scope === 'advisor' ||
      req.user.role === 'teacher';

    const isInstitutionAdmin = !isTeacherPortal && (hasInstitutionReach(req.user) || (isAdminUser(req.user) && req.user.role !== 'teacher'));

    if (isInstitutionAdmin) {
      const depts = await M.Department.find()
        .select('_id name code')
        .sort({ name: 1 })
        .lean();

      const classFilter = {};
      if (qDeptId && qDeptId !== 'all') {
        if (mongoose.isValidObjectId(qDeptId)) {
          classFilter.deptId = new mongoose.Types.ObjectId(qDeptId);
        } else {
          classFilter.deptCode = qDeptId;
        }
      }

      const classes = await M.Class.find(classFilter)
        .select('_id trackId classTrackId name deptId deptName deptCode year batch sem advisorTeacherName')
        .sort({ name: 1 })
        .lean();

      return res.json({
        ok: true,
        data: {
          departments: depts.map(d => ({ id: String(d._id), name: d.name, code: d.code })),
          classes: classes.map(c => ({
            id: String(c._id),
            trackId: c.trackId || c.classTrackId || '',
            name: c.name,
            deptId: c.deptId ? String(c.deptId) : '',
            dept: c.deptName || c.deptCode || '',
            batch: c.batch || '',
            sem: c.sem || '',
            advisor: c.advisorTeacherName || ''
          }))
        }
      });
    }

    // Teacher / Advisor Scope: only return advised classes
    const uId = req.user._id;
    const uTrack = req.user.trackId || '';

    const orConditions = [
      ...(mongoose.isValidObjectId(uId) ? [{ advisorTeacherId: new mongoose.Types.ObjectId(uId) }] : []),
      ...(uTrack ? [{ advisorTeacherTrackId: uTrack }] : []),
      ...(mongoose.isValidObjectId(uId) ? [{ secondaryAdvisorTeacherId: new mongoose.Types.ObjectId(uId) }] : []),
      ...(uTrack ? [{ secondaryAdvisorTeacherTrackId: uTrack }] : [])
    ];

    const specials = Array.isArray(req.user.specials) ? req.user.specials : [];
    specials.forEach(s => {
      if (s && s.option === 'isClassAdvisor') {
        if (s.key && typeof s.key === 'string' && s.key !== 'true' && s.key !== 'false') {
          if (mongoose.isValidObjectId(s.key)) orConditions.push({ _id: new mongoose.Types.ObjectId(s.key) });
          orConditions.push({ trackId: s.key });
          orConditions.push({ name: s.key });
        }
        if (s.value && typeof s.value === 'string' && s.value !== 'true' && s.value !== 'false') {
          if (mongoose.isValidObjectId(s.value)) orConditions.push({ _id: new mongoose.Types.ObjectId(s.value) });
          orConditions.push({ trackId: s.value });
          orConditions.push({ name: s.value });
        }
      }
    });

    try {
      const today = new Date().toISOString().split('T')[0];
      const actingRoles = await M.ActingRole.find({
        holderTrackId: uTrack,
        role: 'classAdvisor',
        status: { $in: ['active', 'pending'] },
        from: { $lte: today },
        to: { $gte: today }
      }).lean();
      actingRoles.forEach(ar => {
        if (ar.key) {
          if (mongoose.isValidObjectId(ar.key)) orConditions.push({ _id: new mongoose.Types.ObjectId(ar.key) });
          orConditions.push({ trackId: ar.key });
          orConditions.push({ name: ar.key });
        }
      });
    } catch (e) {
      // Graceful ignore
    }

    if (orConditions.length === 0) {
      return res.json({
        ok: true,
        data: { departments: [], classes: [] }
      });
    }

    // Query all advised classes first to determine available departments
    const allAdvisedClasses = await M.Class.find({ $or: orConditions })
      .select('_id trackId classTrackId name deptId deptName deptCode year batch sem advisorTeacherName')
      .sort({ name: 1 })
      .lean();

    const deptIds = [...new Set(allAdvisedClasses.map(c => c.deptId ? String(c.deptId) : null).filter(Boolean))];
    const deptCodes = [...new Set(allAdvisedClasses.map(c => c.deptCode || null).filter(Boolean))];
    const deptQueries = [];
    if (deptIds.length > 0) deptQueries.push({ _id: { $in: deptIds } });
    if (deptCodes.length > 0) deptQueries.push({ code: { $in: deptCodes } });

    const depts = deptQueries.length > 0
      ? await M.Department.find({ $or: deptQueries }).select('_id name code').sort({ name: 1 }).lean()
      : [];

    let filteredClasses = allAdvisedClasses;
    if (qDeptId && qDeptId !== 'all') {
      filteredClasses = allAdvisedClasses.filter(c => {
        if (c.deptId && String(c.deptId) === qDeptId) return true;
        if (c.deptCode && c.deptCode === qDeptId) return true;
        return false;
      });
    }

    return res.json({
      ok: true,
      data: {
        departments: depts.map(d => ({ id: String(d._id), name: d.name, code: d.code })),
        classes: filteredClasses.map(c => ({
          id: String(c._id),
          trackId: c.trackId || c.classTrackId || '',
          name: c.name,
          deptId: c.deptId ? String(c.deptId) : '',
          dept: c.deptName || c.deptCode || '',
          batch: c.batch || '',
          sem: c.sem || '',
          advisor: c.advisorTeacherName || ''
        }))
      }
    });
  } catch (err) {
    console.error('Roster options error:', err);
    return res.status(500).json({ error: 'Failed to fetch roster options', details: err.message });
  }
});

/**
 * GET /api/attendance-records/roster
 * Day matrix (light) or Period Forensic Details
 */
router.get('/roster', async (req, res) => {
  try {
    const qClassId = sanitizeToString(req.query.classId);
    const qDate = sanitizeToString(req.query.date);
    const qPeriod = req.query.period ? parseInt(sanitizeToString(req.query.period), 10) : null;

    if (!qClassId || !qDate) {
      return res.status(400).json({ error: 'classId and date are required' });
    }
    if (!DATE_REGEX.test(qDate)) {
      return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format' });
    }

    const sessionDate = new Date(qDate + 'T00:00:00.000Z');
    const nextDate = new Date(qDate + 'T23:59:59.999Z');

    // 1. Resolve Class
    const classQueries = [{ trackId: qClassId }, { name: qClassId }];
    if (mongoose.isValidObjectId(qClassId)) {
      classQueries.unshift({ _id: new mongoose.Types.ObjectId(qClassId) });
    }
    const cls = await M.Class.findOne({ $or: classQueries }).lean();
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const isAllowed = await checkAdvisorAccess(req.user, cls, req);
    if (!isAllowed) {
      return res.status(403).json({ error: 'Access denied: You are not the advisor for this class.' });
    }

    const classObjIdStr = String(cls._id);
    const classTrackId = cls.trackId || cls.classTrackId || '';
    const validClassIds = [classObjIdStr];
    if (classTrackId && classTrackId !== classObjIdStr) {
      validClassIds.push(classTrackId);
    }

    // 2. Settings & Timetable Resolution
    const [settings, classSchedule] = await Promise.all([
      getCachedSettings(),
      resolveClassDaySchedule(cls._id, qDate, { start: sessionDate, end: nextDate }, cls)
    ]);

    const resolvedTimetableSlots = classSchedule.slots || new Map();

    const calDay = await M.CalendarDay.findOne({
      date: { $gte: sessionDate, $lte: nextDate }
    }).lean();

    let dayType = 'working';
    let isHoliday = sessionDate.getUTCDay() === 0 || Boolean(classSchedule.isHoliday);
    if (calDay) {
      dayType = calDay.dayType || 'working';
      const classYearNum = parseYearNum(cls.year);
      if (Array.isArray(calDay.details) && calDay.details.length > 0) {
        const yd = calDay.details.find(d => d.year === classYearNum);
        if (yd && yd.dayType) dayType = yd.dayType;
      }
      if (['holiday', 'vacation', 'leave', 'declared_holiday'].includes(dayType.toLowerCase())) {
        isHoliday = true;
      }
    }

    // 3. Class Attendance Record
    const attDoc = await M.ClassAttendance.findOne({
      classId: { $in: validClassIds },
      date: { $gte: sessionDate, $lte: nextDate }
    }).lean();

    // 4. Determine Dynamic Periods Per Day (covering timetable slots, recorded sessions & settings)
    let maxSlotPeriod = classSchedule.maxPeriod || 0;
    resolvedTimetableSlots.forEach((slot, p) => {
      if (p > maxSlotPeriod) maxSlotPeriod = p;
      const endP = (slot.spanRootPeriod || slot.period || p) + (slot.span || 1) - 1;
      if (endP > maxSlotPeriod) maxSlotPeriod = endP;
    });

    let maxAttPeriod = 0;
    if (attDoc && Array.isArray(attDoc.periods)) {
      attDoc.periods.forEach(p => {
        const pN = Number(p.periodNumber) || 0;
        if (pN > maxAttPeriod) maxAttPeriod = pN;
        if (Array.isArray(p.periodNumbers)) {
          p.periodNumbers.forEach(n => {
            const numVal = Number(n);
            if (numVal > maxAttPeriod) maxAttPeriod = numVal;
          });
        }
      });
    }

    const configuredPeriods = Number(settings.academic?.periodsPerDay) || 7;
    const periodsPerDay = Math.max(configuredPeriods, maxSlotPeriod, maxAttPeriod, 7);

    // 5. Students
    const studentQueries = [
      { classId: { $in: validClassIds } },
      { classId: cls._id }
    ];
    if (cls.name) studentQueries.push({ class: cls.name });

    const students = await M.Student.find({ $or: studentQueries })
      .select('trackId registerNo fullName name rollNo')
      .sort({ registerNo: 1, name: 1 })
      .lean();

    const enrolledStrength = students.length;
    let markedMax = 0;

    // Collect subjects & teachers from BOTH recorded attendance and resolved timetable
    const subjectTrackIds = [];
    const subjectObjIds = [];
    const subjectCodes = [];

    const teacherTrackIds = [];
    const teacherObjIds = [];
    const teacherNames = [];

    if (attDoc && Array.isArray(attDoc.periods)) {
      attDoc.periods.forEach(p => {
        if (p.subjectTrackId) {
          subjectTrackIds.push(p.subjectTrackId);
          if (mongoose.isValidObjectId(p.subjectTrackId)) {
            subjectObjIds.push(new mongoose.Types.ObjectId(p.subjectTrackId));
          } else {
            subjectCodes.push(p.subjectTrackId);
          }
        }
        if (p.teacherTrackId) {
          teacherTrackIds.push(p.teacherTrackId);
          if (mongoose.isValidObjectId(p.teacherTrackId)) {
            teacherObjIds.push(new mongoose.Types.ObjectId(p.teacherTrackId));
          }
        }
        if (p.records && p.records.length > markedMax) {
          markedMax = p.records.length;
        }
      });
    }

    resolvedTimetableSlots.forEach(slot => {
      if (slot.subjectId && mongoose.isValidObjectId(slot.subjectId)) {
        subjectObjIds.push(new mongoose.Types.ObjectId(slot.subjectId));
      }
      if (slot.subjectTrackId) subjectTrackIds.push(slot.subjectTrackId);
      if (slot.subjectCode) subjectCodes.push(slot.subjectCode);

      if (slot.teacherId && mongoose.isValidObjectId(slot.teacherId)) {
        teacherObjIds.push(new mongoose.Types.ObjectId(slot.teacherId));
      }
      if (slot.teacherTrackId) teacherTrackIds.push(slot.teacherTrackId);
      if (slot.teacher) teacherNames.push(slot.teacher);
    });

    const subFilters = [];
    if (subjectTrackIds.length) subFilters.push({ trackId: { $in: subjectTrackIds } });
    if (subjectObjIds.length) subFilters.push({ _id: { $in: subjectObjIds } });
    if (subjectCodes.length) {
      subFilters.push({ code: { $in: subjectCodes } });
      subFilters.push({ courseCode: { $in: subjectCodes } });
      subFilters.push({ subjectCode: { $in: subjectCodes } });
      subFilters.push({ shortForm: { $in: subjectCodes } });
    }

    const tchFilters = [];
    if (teacherTrackIds.length) tchFilters.push({ trackId: { $in: teacherTrackIds } });
    if (teacherObjIds.length) tchFilters.push({ _id: { $in: teacherObjIds } });
    if (teacherNames.length) {
      tchFilters.push({ fullName: { $in: teacherNames } });
      tchFilters.push({ name: { $in: teacherNames } });
    }

    const [subjects, teachers] = await Promise.all([
      subFilters.length > 0 ? M.Subject.find({ $or: subFilters }).select('_id trackId name code courseCode subjectCode shortForm').lean() : [],
      tchFilters.length > 0 ? M.Teacher.find({ $or: tchFilters }).select('_id trackId fullName name').lean() : []
    ]);

    const subjectMap = new Map();
    subjects.forEach(s => {
      if (s._id) subjectMap.set(String(s._id), s);
      if (s.trackId) subjectMap.set(String(s.trackId), s);
      if (s.code) subjectMap.set(String(s.code).toLowerCase(), s);
      if (s.courseCode) subjectMap.set(String(s.courseCode).toLowerCase(), s);
      if (s.subjectCode) subjectMap.set(String(s.subjectCode).toLowerCase(), s);
      if (s.shortForm) subjectMap.set(String(s.shortForm).toLowerCase(), s);
    });

    const teacherMap = new Map();
    teachers.forEach(t => {
      if (t._id) teacherMap.set(String(t._id), t);
      if (t.trackId) teacherMap.set(String(t.trackId), t);
      if (t.fullName) teacherMap.set(String(t.fullName).toLowerCase(), t);
      if (t.name) teacherMap.set(String(t.name).toLowerCase(), t);
    });

    // Build combined period summaries
    const periodsOverview = [];

    for (let pNum = 1; pNum <= periodsPerDay; pNum++) {
      let pObj = null;
      if (attDoc && Array.isArray(attDoc.periods)) {
        pObj = attDoc.periods.find(p =>
          Number(p.periodNumber) === pNum ||
          (Array.isArray(p.periodNumbers) && p.periodNumbers.includes(pNum))
        );
      }

      const slot = resolvedTimetableSlots.get(pNum);

      // Subject lookup helper
      let sub = null;
      if (pObj && pObj.subjectTrackId) {
        sub = subjectMap.get(String(pObj.subjectTrackId)) || subjectMap.get(String(pObj.subjectTrackId).toLowerCase());
      }
      if (!sub && slot) {
        if (slot.subjectId) sub = subjectMap.get(String(slot.subjectId));
        if (!sub && slot.subjectCode) sub = subjectMap.get(String(slot.subjectCode).toLowerCase());
        if (!sub && slot.subjectTrackId) sub = subjectMap.get(String(slot.subjectTrackId));
      }

      // Teacher lookup helper
      let tch = null;
      if (pObj && pObj.teacherTrackId) {
        tch = teacherMap.get(String(pObj.teacherTrackId));
      }
      if (!tch && slot) {
        if (slot.teacherId) tch = teacherMap.get(String(slot.teacherId));
        if (!tch && slot.teacherTrackId) tch = teacherMap.get(String(slot.teacherTrackId));
        if (!tch && slot.teacher) tch = teacherMap.get(String(slot.teacher).toLowerCase());
      }

      if (pObj) {
        // Case 1: Attendance recorded
        const pRecords = pObj.records || [];
        const pres = pRecords.filter(r => r.status === 'P').length;
        const abs = pRecords.filter(r => r.status === 'AB' && !r.reason).length;
        const od = pRecords.filter(r => r.reason === 'od').length;
        const leave = pRecords.filter(r => r.reason === 'leave').length;

        const subName = sub
          ? `${sub.name}${sub.code ? ' (' + sub.code + ')' : ''}`
          : (slot?.subject || slot?.subjectName || pObj.subjectTrackId || ('Period ' + pNum));

        const tchName = tch
          ? (tch.fullName || tch.name)
          : (pObj.markedBy && pObj.markedBy !== '—' ? pObj.markedBy : (slot?.teacher || slot?.teacherName || '—'));

        periodsOverview.push({
          number: pNum,
          numbers: pObj.periodNumbers || (slot?.span > 1 ? Array.from({ length: slot.span }, (_, i) => (slot.spanRootPeriod || pNum) + i) : [pNum]),
          subject: {
            trackId: pObj.subjectTrackId || slot?.subjectTrackId || (sub ? sub.trackId : ''),
            name: subName
          },
          teacher: {
            trackId: pObj.teacherTrackId || slot?.teacherTrackId || (tch ? tch.trackId : ''),
            name: tchName,
            via: pObj.source?.via || (slot ? 'timetable' : 'direct')
          },
          method: pObj.source?.method || 'Manual',
          markedAt: pObj.markedAt || null,
          room: pObj.room || slot?.room || '',
          span: pObj.periodNumbers?.length || slot?.span || 1,
          spanRootPeriod: slot?.spanRootPeriod || pNum,
          isSpanContinuation: Boolean(slot?.isSpanContinuation),
          spanIndex: slot?.spanIndex || 0,
          type: slot?.type || (slot?.isLab ? 'Lab' : 'Theory'),
          isLab: Boolean(slot?.isLab),
          isRecorded: true,
          topic: pObj.topic || slot?.note || '',
          notes: pObj.notes || '',
          stats: {
            total: pRecords.length,
            present: pres,
            absent: abs,
            od,
            leave
          }
        });
      } else if (slot) {
        // Case 2: Attendance NOT recorded, but period IS scheduled in Timetable
        const subName = sub
          ? `${sub.name}${sub.code ? ' (' + sub.code + ')' : ''}`
          : (slot.subject || slot.subjectName || (slot.subjectCode ? slot.subjectCode : ('Period ' + pNum)));

        const tchName = tch
          ? (tch.fullName || tch.name)
          : (slot.teacher || slot.teacherName || '—');

        let methodStr = 'Scheduled';
        if (slot.isCancelled) methodStr = 'Cancelled';
        else if (slot.isSubstituted) methodStr = 'Substitute';

        periodsOverview.push({
          number: pNum,
          numbers: slot.span > 1 ? Array.from({ length: slot.span }, (_, i) => (slot.spanRootPeriod || pNum) + i) : [pNum],
          subject: {
            trackId: slot.subjectTrackId || String(slot.subjectId || (sub ? sub.trackId : '')),
            name: subName
          },
          teacher: {
            trackId: slot.teacherTrackId || String(slot.teacherId || (tch ? tch.trackId : '')),
            name: tchName,
            via: 'timetable'
          },
          method: methodStr,
          markedAt: null,
          room: slot.room || '',
          span: slot.span || 1,
          spanRootPeriod: slot.spanRootPeriod || pNum,
          isSpanContinuation: Boolean(slot.isSpanContinuation),
          spanIndex: slot.spanIndex || 0,
          type: slot.type || (slot.isLab ? 'Lab' : 'Theory'),
          isLab: Boolean(slot.isLab),
          isRecorded: false,
          topic: slot.note || '',
          notes: slot.note || '',
          stats: { total: 0, present: 0, absent: 0, od: 0, leave: 0 }
        });
      } else {
        // Case 3: Unscheduled period (no timetable entry and no attendance recorded)
        periodsOverview.push({
          number: pNum,
          numbers: [pNum],
          subject: { trackId: '', name: 'Not Scheduled' },
          teacher: { trackId: '', name: '—', via: 'direct' },
          method: 'Unscheduled',
          markedAt: null,
          room: '',
          span: 1,
          spanRootPeriod: pNum,
          isSpanContinuation: false,
          spanIndex: 0,
          type: 'Free',
          isLab: false,
          isRecorded: false,
          topic: '',
          notes: '',
          stats: { total: 0, present: 0, absent: 0, od: 0, leave: 0 }
        });
      }
    }

    // ── CASE A: Full-Day Matrix Mode ──
    if (!qPeriod) {
      const studentRows = students.map(st => {
        let cellStr = '';
        let presentCount = 0;
        let recordedCount = 0;

        for (let pNum = 1; pNum <= periodsPerDay; pNum++) {
          let glyph = '–';
          if (attDoc && Array.isArray(attDoc.periods)) {
            const p = attDoc.periods.find(pd =>
              Number(pd.periodNumber) === pNum ||
              (Array.isArray(pd.periodNumbers) && pd.periodNumbers.includes(pNum))
            );
            if (p && Array.isArray(p.records)) {
              const r = p.records.find(rec => rec.studentTrackId === st.trackId);
              if (r) {
                recordedCount++;
                if (r.status === 'P') {
                  glyph = 'P';
                  presentCount++;
                } else if (r.reason === 'od') {
                  glyph = 'O';
                } else if (r.reason === 'leave') {
                  glyph = 'L';
                } else {
                  glyph = 'A';
                }
              }
            }
          }
          cellStr += glyph;
        }

        const dayPct = recordedCount > 0 ? Math.round((presentCount / recordedCount) * 100) : 100;

        return {
          trackId: st.trackId,
          regNo: st.registerNo || st.rollNo || '',
          name: st.fullName || st.name || '',
          cells: cellStr,
          dayPct
        };
      });

      return res.json({
        ok: true,
        data: {
          class: {
            id: classObjIdStr,
            name: cls.name,
            dept: cls.deptName || cls.deptCode || '',
            batch: cls.batch || '',
            sem: cls.sem || ''
          },
          date: qDate,
          calendar: { dayType, isHoliday },
          periodsPerDay,
          strength: {
            enrolled: enrolledStrength,
            markedMax,
            hasDiscrepancy: markedMax > 0 && markedMax !== enrolledStrength
          },
          lastSaved: attDoc?.updatedAt || null,
          periods: periodsOverview,
          students: studentRows
        }
      });
    }

    // ── CASE B: Forensic Period Detail Mode ──
    const targetPeriod = attDoc?.periods?.find(p =>
      Number(p.periodNumber) === qPeriod ||
      (Array.isArray(p.periodNumbers) && p.periodNumbers.includes(qPeriod))
    );

    const sessionTrackId = targetPeriod?.source?.sessionTrackId || '';
    const sessionModel = targetPeriod?.source?.sessionModel || '';
    const targetSlot = resolvedTimetableSlots.get(qPeriod);
    const method = targetPeriod?.source?.method || (targetSlot ? (targetSlot.isCancelled ? 'Cancelled' : (targetSlot.isSubstituted ? 'Substitute' : 'Scheduled')) : 'Unscheduled');

    // Fetch session details if Live QR or QuickPass
    let liveSessionMarks = [];
    let qpSessionRecords = [];

    if (sessionModel === 'ScanLiveSession' && sessionTrackId) {
      liveSessionMarks = await M.LiveSessionsAtt.find({ sessionTrackId }).lean();
    } else if (sessionModel === 'QuickPassSession' && mongoose.isValidObjectId(sessionTrackId)) {
      const qp = await M.QuickPassSession.findById(sessionTrackId).lean();
      if (qp && Array.isArray(qp.records)) {
        qpSessionRecords = qp.records;
      }
    }

    // Group devices to detect shared physical devices in session
    const deviceMap = new Map();
    liveSessionMarks.forEach(m => {
      if (m.deviceId) {
        deviceMap.set(m.deviceId, (deviceMap.get(m.deviceId) || 0) + 1);
      }
    });
    qpSessionRecords.forEach(r => {
      if (r.deviceId) {
        deviceMap.set(r.deviceId, (deviceMap.get(r.deviceId) || 0) + 1);
      }
    });

    // Extract deviceSessionIds to join with LoginHistory
    const sessionIdsToFind = [];
    const studentTrackIds = students.map(s => s.trackId);

    liveSessionMarks.forEach(m => {
      if (m.deviceSessionId) sessionIdsToFind.push(m.deviceSessionId);
    });
    qpSessionRecords.forEach(r => {
      if (r.deviceSessionId) sessionIdsToFind.push(r.deviceSessionId);
    });

    // One LoginHistory aggregation per request (§3.7)
    const loginHistories = await M.LoginHistory.aggregate([
      { $match: { trackId: { $in: studentTrackIds } } },
      {
        $project: {
          trackId: 1,
          history: {
            $filter: {
              input: '$history',
              cond: { $in: ['$$this.sessionId', sessionIdsToFind] }
            }
          }
        }
      }
    ]);

    const studentLoginMap = new Map();
    loginHistories.forEach(lh => {
      if (Array.isArray(lh.history)) {
        lh.history.forEach(h => {
          // Never project authToken
          const cleanHistory = {
            sessionId: h.sessionId,
            deviceType: h.deviceType || '',
            browser: h.browser || '',
            os: h.os || '',
            ip: h.ip || '',
            userAgent: h.userAgent || '',
            loginTime: h.loginTime,
            logoutTime: h.logoutTime,
            address: h.location?.address || ''
          };
          studentLoginMap.set(`${lh.trackId}_${h.sessionId}`, cleanHistory);
        });
      }
    });

    // Build forensic student details
    const forensicStudents = [];

    for (const st of students) {
      const pRecord = targetPeriod?.records?.find(r => r.studentTrackId === st.trackId);
      const status = pRecord ? pRecord.status : null;

      let studentMarkedAt = null;
      let studentDeviceId = '';
      let studentDeviceSessionId = '';
      let studentIp = '';
      let studentUa = '';
      let locationOk = false;
      let qrWindowType = 'current';

      if (sessionModel === 'ScanLiveSession') {
        const liveMark = liveSessionMarks.find(m => m.studentTrackId === st.trackId);
        if (liveMark) {
          studentMarkedAt = liveMark.markedAt;
          studentDeviceId = liveMark.deviceId || '';
          studentDeviceSessionId = liveMark.deviceSessionId || '';
          studentIp = liveMark.ipAddress || '';
          studentUa = liveMark.userAgent || '';
          locationOk = Boolean(liveMark.verificationDetails?.locationOk);
          qrWindowType = liveMark.qrWindowType || 'current';
        }
      } else if (sessionModel === 'QuickPassSession') {
        const qpRec = qpSessionRecords.find(r => r.studentTrackId === st.trackId);
        if (qpRec) {
          studentMarkedAt = qpRec.markedAt;
          studentDeviceId = qpRec.deviceId || '';
          studentDeviceSessionId = qpRec.deviceSessionId || '';
          studentIp = qpRec.ipAddress || '';
          studentUa = qpRec.userAgent || '';
          locationOk = Boolean(qpRec.latitude && qpRec.longitude);
        }
      }

      const loginEntry = studentDeviceSessionId
        ? studentLoginMap.get(`${st.trackId}_${studentDeviceSessionId}`)
        : null;

      const isShared = studentDeviceId ? (deviceMap.get(studentDeviceId) > 1) : false;

      // Compute explainable heuristic trust score
      const trust = computeDeviceTrust({
        method,
        deviceId: studentDeviceId,
        isSharedInSession: isShared,
        priorSessionCount: 3,
        loginEntry,
        markedAt: studentMarkedAt || targetPeriod?.markedAt,
        requestUserAgent: studentUa,
        requestIp: studentIp,
        locationOk,
        qrWindowType
      });

      forensicStudents.push({
        trackId: st.trackId,
        regNo: st.registerNo || st.rollNo || '',
        name: st.fullName || st.name || '',
        status: status || '–',
        markedAt: studentMarkedAt || (pRecord ? targetPeriod?.markedAt : null),
        method,
        device: {
          id: studentDeviceId,
          type: loginEntry?.deviceType || 'Unknown',
          browser: loginEntry?.browser || '',
          os: loginEntry?.os || '',
          ip: studentIp || loginEntry?.ip || '',
          isShared
        },
        trust: {
          score: trust.score,
          band: trust.band,
          flags: trust.flags,
          signals: trust.signals
        },
        loginSession: loginEntry ? {
          sessionId: loginEntry.sessionId,
          loginTime: loginEntry.loginTime,
          logoutTime: loginEntry.logoutTime,
          address: loginEntry.address
        } : null
      });
    }

    // Write audit log for forensic view
    logAction(
      req.user.trackId,
      req.user.role || 'admin',
      'Forensic Roster Viewed',
      `Admin viewed forensic attendance details for Class ${cls.name} on ${qDate} Period ${qPeriod}`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId || '',
      { classId: classObjIdStr, date: qDate, period: qPeriod, subType: 'roster-forensic-view' }
    ).catch(() => {});

    return res.json({
      ok: true,
      data: {
        class: {
          id: classObjIdStr,
          name: cls.name,
          dept: cls.deptName || cls.deptCode || '',
          batch: cls.batch || '',
          sem: cls.sem || ''
        },
        date: qDate,
        calendar: { dayType, isHoliday },
        periodsPerDay,
        selectedPeriod: qPeriod,
        periodMeta: periodsOverview.find(p => p.number === qPeriod) || null,
        periods: periodsOverview,
        strength: {
          enrolled: enrolledStrength,
          markedMax,
          hasDiscrepancy: markedMax > 0 && markedMax !== enrolledStrength
        },
        students: forensicStudents,
        lastSaved: attDoc?.updatedAt || null
      }
    });

  } catch (err) {
    console.error('Roster fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch attendance roster', details: err.message });
  }
});

/**
 * GET /api/attendance-records/roster/student
 * Full-day Student Drawer with Trust Breakdown
 */
router.get('/roster/student', async (req, res) => {
  try {
    const qClassId = sanitizeToString(req.query.classId);
    const qDate = sanitizeToString(req.query.date);
    const qStudentTrackId = sanitizeToString(req.query.studentTrackId);

    if (!qClassId || !qDate || !qStudentTrackId) {
      return res.status(400).json({ error: 'classId, date, and studentTrackId are required' });
    }

    const sessionDate = new Date(qDate + 'T00:00:00.000Z');
    const nextDate = new Date(qDate + 'T23:59:59.999Z');

    const [cls, student] = await Promise.all([
      M.Class.findOne({ $or: [{ _id: mongoose.isValidObjectId(qClassId) ? qClassId : null }, { trackId: qClassId }] }).lean(),
      M.Student.findOne({ trackId: qStudentTrackId }).lean()
    ]);

    if (!cls || !student) {
      return res.status(404).json({ error: 'Class or Student not found' });
    }

    const isAllowed = await checkAdvisorAccess(req.user, cls, req);
    if (!isAllowed) {
      return res.status(403).json({ error: 'Access denied: You are not the advisor for this class.' });
    }

    const validClassIds = [String(cls._id)];
    if (cls.trackId) validClassIds.push(cls.trackId);

    const attDoc = await M.ClassAttendance.findOne({
      classId: { $in: validClassIds },
      date: { $gte: sessionDate, $lte: nextDate }
    }).lean();

    const periodBreakdowns = [];

    if (attDoc && Array.isArray(attDoc.periods)) {
      for (const p of attDoc.periods) {
        const pNum = (p.periodNumbers && p.periodNumbers[0]) || p.periodNumber || 1;
        const rec = p.records?.find(r => r.studentTrackId === qStudentTrackId);
        const status = rec ? rec.status : '–';
        const method = p.source?.method || 'Manual';

        let liveMark = null;
        if (p.source?.sessionModel === 'ScanLiveSession' && p.source?.sessionTrackId) {
          liveMark = await M.LiveSessionsAtt.findOne({
            sessionTrackId: p.source.sessionTrackId,
            studentTrackId: qStudentTrackId
          }).lean();
        }

        let loginEntry = null;
        if (liveMark && liveMark.deviceSessionId) {
          const lh = await M.LoginHistory.findOne(
            { trackId: qStudentTrackId, 'history.sessionId': liveMark.deviceSessionId },
            { 'history.$': 1 }
          ).lean();
          if (lh && lh.history && lh.history[0]) {
            const h = lh.history[0];
            loginEntry = {
              sessionId: h.sessionId,
              deviceType: h.deviceType || '',
              browser: h.browser || '',
              os: h.os || '',
              ip: h.ip || '',
              userAgent: h.userAgent || '',
              loginTime: h.loginTime,
              logoutTime: h.logoutTime,
              address: h.location?.address || ''
            };
          }
        }

        const trust = computeDeviceTrust({
          method,
          deviceId: liveMark?.deviceId,
          isSharedInSession: false,
          priorSessionCount: 3,
          loginEntry,
          markedAt: liveMark?.markedAt || p.markedAt,
          requestUserAgent: liveMark?.userAgent,
          requestIp: liveMark?.ipAddress,
          locationOk: Boolean(liveMark?.verificationDetails?.locationOk),
          qrWindowType: liveMark?.qrWindowType || 'current'
        });

        periodBreakdowns.push({
          periodNumber: pNum,
          subject: p.subjectTrackId,
          method,
          status,
          markedAt: liveMark?.markedAt || p.markedAt,
          device: liveMark ? {
            id: liveMark.deviceId,
            type: loginEntry?.deviceType || 'Unknown',
            browser: loginEntry?.browser || '',
            os: loginEntry?.os || '',
            ip: liveMark.ipAddress,
            address: loginEntry?.address || ''
          } : null,
          trust
        });
      }
    }

    return res.json({
      ok: true,
      data: {
        student: {
          trackId: student.trackId,
          regNo: student.registerNo || student.rollNo || '',
          name: student.fullName || student.name || ''
        },
        class: { id: String(cls._id), name: cls.name },
        date: qDate,
        periods: periodBreakdowns
      }
    });

  } catch (err) {
    console.error('Student drawer fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch student forensic details', details: err.message });
  }
});

/**
 * GET /api/attendance-records/registry
 * Attendance Registry Grid Matrix
 */
router.get('/registry', async (req, res) => {
  try {
    const classId = sanitizeToString(req.query.classId);
    const from = sanitizeToString(req.query.from);
    const to = sanitizeToString(req.query.to);
    const view = sanitizeToString(req.query.view) || 'periods';

    if (!classId) return res.status(400).json({ error: 'classId is required' });

    const classQueries = [{ trackId: classId }, { name: classId }];
    if (mongoose.isValidObjectId(classId)) {
      classQueries.unshift({ _id: new mongoose.Types.ObjectId(classId) });
    }
    const cls = await M.Class.findOne({ $or: classQueries }).lean();
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const isAllowed = await checkAdvisorAccess(req.user, cls, req);
    if (!isAllowed) {
      return res.status(403).json({ error: 'Access denied: You are not the advisor for this class.' });
    }

    const matrix = await buildRegistry({ classId: String(cls._id), from, to, view });
    return res.json({ ok: true, data: matrix });
  } catch (err) {
    console.error('Registry matrix error:', err);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/attendance-records/registry/export
 * Excel (.xlsx) and PDF (.pdf) Registry Exports
 */
router.get('/registry/export', registryExportLimiter, async (req, res) => {
  try {
    const classId = sanitizeToString(req.query.classId);
    const from = sanitizeToString(req.query.from);
    const to = sanitizeToString(req.query.to);
    const format = sanitizeToString(req.query.format) || 'xlsx';

    if (!classId) return res.status(400).json({ error: 'classId is required' });

    const classQueries = [{ trackId: classId }, { name: classId }];
    if (mongoose.isValidObjectId(classId)) {
      classQueries.unshift({ _id: new mongoose.Types.ObjectId(classId) });
    }
    const cls = await M.Class.findOne({ $or: classQueries }).lean();
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const isAllowed = await checkAdvisorAccess(req.user, cls, req);
    if (!isAllowed) {
      return res.status(403).json({ error: 'Access denied: You are not the advisor for this class.' });
    }

    const matrix = await buildRegistry({ classId: String(cls._id), from, to, view: 'periods' });
    const cleanClassName = matrix.class.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const baseFilename = `Registry_${cleanClassName}_${from}_${to}`;

    if (format === 'pdf') {
      const pdfBuffer = await generatePdf(matrix);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.send(pdfBuffer);
    }

    // Default: xlsx
    const excelBuffer = await generateExcel(matrix);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.xlsx"`);
    res.setHeader('Content-Length', excelBuffer.length);
    return res.send(excelBuffer);

  } catch (err) {
    console.error('Registry export error:', err);
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
