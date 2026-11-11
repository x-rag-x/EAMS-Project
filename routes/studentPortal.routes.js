const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { checkMaintenance } = require('../middleware/maintenance');
const { todayIST, nowParts } = require('../utils/institutionTime');
const { sendError } = require('../utils/sendError');

router.get('/me', authMiddleware, checkMaintenance, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Students only' });

    // ── Student profile — look up by trackId, username, or _id
    let student = null;
    if (req.user.trackId) {
      student = await M.Student.findOne({ trackId: req.user.trackId }).select('-password').lean();
    }
    if (!student && req.user.username) {
      student = await M.Student.findOne({ username: req.user.username }).select('-password').lean();
    }
    if (!student && req.user._id) {
      student = await M.Student.findById(req.user._id).select('-password').lean();
    }

    // ── User shadow record (look up by trackId or username, fallback to req.user)
    let shadowUser = null;
    if (req.user.trackId) {
      shadowUser = await M.User.findOne({ trackId: req.user.trackId }).select('-password').lean();
    }
    if (!shadowUser && req.user.username) {
      shadowUser = await M.User.findOne({ username: req.user.username }).select('-password').lean();
    }

    const effectiveTrackId = req.user.trackId || (student && student.trackId) || (shadowUser && shadowUser.trackId) || '';

    // Fetch login history for lastLogin / firstLogin
    const loginHistory = effectiveTrackId ? await M.LoginHistory.findOne({ trackId: effectiveTrackId }).lean() : null;

    // Minimum attendance requirement from settings (supports regulation-specific thresholds)
    const academicSetting = await M.Settings.findOne({ key: 'academic' }).lean();
    let minRequired = academicSetting?.value?.minAttendance || 75;
    const regMinMap = academicSetting?.value?.regulationMinAttendance || {};
    const studentReg = student?.regulation || '';
    if (studentReg && regMinMap[studentReg] !== undefined) {
      minRequired = Number(regMinMap[studentReg]);
    }

    if (!student) {
      // No Student profile record found — return safe fallback so portal loads
      const displayName = req.user.fullName || req.user.name || req.user.username || 'Student';
      return res.json({
        user: {
          _id: shadowUser?._id || req.user._id,
          name: displayName,
          username: req.user.username,
          email: req.user.email || '',
          lastLogin: loginHistory?.lastLogin || null,
          firstLogin: loginHistory?.firstLogin || null,
          loginCount: loginHistory?.totalLogins || 0,
          createdAt: req.user.createdAt || new Date(),
        },
        student: {
          name: displayName,
          firstName: req.user.firstName || '',
          lastName: req.user.lastName || '',
          regNo: req.user.registerNo || '—',
          deptName: req.user.department || '—',
          className: '—',
          year: '—',
          section: '—',
          academicYear: '—',
          courseType: '—',
          branch: '—',
          email: req.user.email || '—',
          bloodGroup: '—',
          isClassRep: false,
        },
        attendance: { subjects: [], totalPresent: 0, totalAbsent: 0, totalClasses: 0, overall: 0, minRequired },
      });
    }

    // Resolve class details if available
    let cls = null;
    if (student.classId) {
      cls = await M.Class.findById(student.classId).lean();
    }
    if (!cls && student.class) {
      cls = await M.Class.findOne({ name: student.class }).lean();
    }

    // Normalize student fields for frontend consumption
    const normalizedStudent = {
      ...student,
      name: student.fullName || req.user.name || req.user.username,
      firstName: student.firstName || '',
      lastName: student.lastName || '',
      regNo: student.registerNo || req.user.registerNo || '—',
      deptName: student.department || cls?.deptName || '—',
      className: student.class || cls?.name || '—',
      year: cls?.year || student.currentYear || '—',
      section: student.section || cls?.section || '—',
      academicYear: student.admissionYear || '—',
      courseType: student.courseType || 'UG',
      branch: student.branch || 'None',
      email: student.email || req.user.email || '',
      bloodGroup: student.bloodGroup || '—',
      isClassRep: !!student.isRep,
      residency: student.residency || 'dayscholar',
      admissionType: student.admissionType || 'Regular',
    };

    // ── Attendance query: search by all possible class identifiers and student identifiers
    const studentTrackId = student.trackId || String(student._id);
    const studentIdentifiers = [studentTrackId, student.registerNo, String(student._id)].filter(Boolean);

    const classQueries = [];
    if (student.classId) classQueries.push({ classId: String(student.classId) });
    if (cls) {
      if (cls._id) classQueries.push({ classId: String(cls._id) });
      if (cls.trackId) classQueries.push({ classId: cls.trackId });
      if (cls.name) classQueries.push({ classId: cls.name });
    }
    if (student.class) classQueries.push({ classId: student.class });
    classQueries.push({ 'periods.records.studentTrackId': { $in: studentIdentifiers } });

    const classAttDocs = await M.ClassAttendance.find({ $or: classQueries }).lean();

    const allSubjects = await M.Subject.find().lean();
    const subjectMapLookup = new Map();
    allSubjects.forEach(sub => {
      subjectMapLookup.set(String(sub._id), sub);
      if (sub.subjectTrackId) subjectMapLookup.set(sub.subjectTrackId, sub);
      if (sub.subjectCode) subjectMapLookup.set(sub.subjectCode, sub);
    });

    // ── Aggregate per subject
    const subjectMap = {}; // subjectTrackId → { subjectId, subjectTrackId, subjectName, teacherName, present, absent, total, dates[] }

    for (const doc of classAttDocs) {
      const dateStr = doc.date ? (typeof doc.date === 'string' ? doc.date.split('T')[0] : todayIST(doc.date)) : '';
      for (const period of doc.periods || []) {
        const sid = period.subjectTrackId;
        const subObj = subjectMapLookup.get(sid);
        const subjectName = subObj ? subObj.name : sid;

        if (!subjectMap[sid]) {
          subjectMap[sid] = {
            subjectId: subObj ? String(subObj._id) : sid,
            subjectTrackId: sid,
            subjectName: subjectName,
            teacherName: period.markedBy || '—',
            present: 0,
            absent: 0,
            total: 0,
            dates: [],
          };
        }
        const entry = subjectMap[sid];
        const myRecord = (period.records || []).find(r => studentIdentifiers.includes(r.studentTrackId));
        if (myRecord) {
          entry.total++;
          if (myRecord.status === 'P') entry.present++;
          else entry.absent++;
          entry.dates.push({ date: dateStr, status: myRecord.status === 'P' ? 'present' : 'absent' });
        }
      }
    }

    const subjects = Object.values(subjectMap).map(s => ({
      ...s,
      percentage: s.total > 0 ? Math.round((s.present / s.total) * 100) : 0,
      dates: s.dates.sort((a, b) => a.date.localeCompare(b.date)),
    }));

    // ── Overall totals
    const totalPresent = subjects.reduce((n, s) => n + s.present, 0);
    const totalAbsent = subjects.reduce((n, s) => n + s.absent, 0);
    const totalClasses = subjects.reduce((n, s) => n + s.total, 0);
    const rawOverall = totalClasses > 0 ? Math.round((totalPresent / totalClasses) * 100) : 0;

    // ── Attendance adjustments (§12, §13, T-D6)
    const adjustments = await M.AttendanceAdjustment.find({
      $or: [
        { studentId: student._id },
        { studentTrackId: effectiveTrackId }
      ]
    }).lean();
    const adjustmentDelta = adjustments.reduce((acc, a) => acc + (Number(a.deltaPct) || 0), 0);
    const overall = Math.min(100, Math.max(0, rawOverall + adjustmentDelta));

    res.json({
      user: {
        _id: shadowUser?._id || student._id,
        name: normalizedStudent.name,
        username: student.username || req.user.username,
        email: normalizedStudent.email,
        lastLogin: loginHistory?.lastLogin || null,
        firstLogin: loginHistory?.firstLogin || null,
        loginCount: loginHistory?.totalLogins || 0,
        createdAt: student.createdAt || req.user.createdAt || new Date(),
      },
      student: normalizedStudent,
      attendance: {
        subjects,
        totalPresent,
        totalAbsent,
        totalClasses,
        rawOverall,
        overall,
        adjustmentDelta,
        adjustments: adjustments.map(a => ({
          kind: a.kind,
          deltaPct: a.deltaPct,
          reason: a.reason,
          appliedAt: a.appliedAt
        })),
        minRequired,
      },
    });
  } catch (err) {
    return sendError(res, err, 500, 'Failed to fetch student details');
  }
});

// ── Consolidated Student Pulse (§6, B1) ─────────────────────────────────
router.get('/pulse', authMiddleware, checkMaintenance, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Students only' });

    let student = null;
    if (req.user.trackId) {
      student = await M.Student.findOne({ trackId: req.user.trackId }).select('classId class trackId registerNo isRep').lean();
    }
    if (!student && req.user.username) {
      student = await M.Student.findOne({ username: req.user.username }).select('classId class trackId registerNo isRep').lean();
    }
    if (!student && req.user._id) {
      student = await M.Student.findById(req.user._id).select('classId class trackId registerNo isRep').lean();
    }

    if (!student) {
      return res.json({
        ok: true,
        liveSession: { active: false },
        quickPass: { active: false },
        repShare: { hasPending: false },
        unreadNotifsCount: 0,
        mustChangePassword: !!req.user.mustChangePassword
      });
    }

    const studentClassId = student.classId || student.class;
    const studentIdentifiers = [student.trackId, student.registerNo, String(student._id)].filter(Boolean);

    // 1. Live session
    let liveSessionData = { active: false };
    if (studentClassId) {
      const liveSession = await M.LiveSession.findOne({
        classId: studentClassId,
        active: true,
        expiresAt: { $gt: new Date() }
      }).populate('subjectId', 'name').lean();

      if (liveSession) {
        const alreadyMarked = (liveSession.markedStudents || []).some(s =>
          studentIdentifiers.includes(s.studentTrackId) ||
          String(s.studentId) === String(student._id)
        );
        liveSessionData = {
          active: true,
          sessionId: liveSession._id,
          subjectName: liveSession.subjectId?.name || 'Subject',
          alreadyMarked
        };
      }
    }

    // 2. Quick Pass session
    let quickPassData = { active: false };
    if (studentClassId) {
      const qpSession = await M.QuickPassSession.findOne({
        classId: studentClassId,
        active: true
      }).populate('subjectId', 'name subjectCode').lean();

      if (qpSession) {
        const alreadyMarked = (qpSession.records || []).some(r =>
          String(r.studentId) === String(student._id) ||
          (student.trackId && r.studentTrackId === student.trackId)
        );
        quickPassData = {
          active: true,
          sessionId: qpSession._id,
          sessionTrackId: qpSession.sessionTrackId,
          subjectName: qpSession.subjectId?.name || 'Subject',
          periodNumber: qpSession.periodNumber,
          date: qpSession.date,
          currentRotation: qpSession.currentRotation || 1,
          totalRotations: qpSession.totalRotations || 2,
          alreadyMarked,
          session: {
            sessionId: qpSession._id,
            sessionTrackId: qpSession.sessionTrackId,
            subjectName: qpSession.subjectId?.name || 'Subject',
            periodNumber: qpSession.periodNumber,
            date: qpSession.date,
            currentRotation: qpSession.currentRotation || 1,
            totalRotations: qpSession.totalRotations || 2
          }
        };
      }
    }

    // 3. Rep Share (only check if student is flagged as rep)
    let repShareData = { hasPending: false };
    if (student.isRep) {
      const repSession = await M.RepShareSession.findOne({
        $or: [
          { repStudentTrackId: student.trackId },
          { repStudentId: student._id },
          { repStudentId: req.user._id }
        ],
        status: { $in: ['pending', 'in-progress'] }
      }).sort({ createdAt: -1 }).lean();

      if (repSession) {
        repShareData = {
          hasPending: true,
          sessionId: repSession._id,
          session: repSession,
          subjectName: repSession.subjectName,
          status: repSession.status
        };
      }
    }

    // 4. Unread notifications count
    const unreadCount = await M.Notification.countDocuments({
      $or: [
        { toStudentTrackId: student.trackId },
        { toStudentId: student._id },
        { toStudentId: req.user._id },
        { toStudentTrackId: req.user.trackId }
      ],
      read: false
    });

    return res.json({
      ok: true,
      liveSession: liveSessionData,
      quickPass: quickPassData,
      repShare: repShareData,
      unreadNotifsCount: unreadCount,
      mustChangePassword: !!req.user.mustChangePassword
    });
  } catch (err) {
    console.error('[Student Pulse Exception]:', err);
    return res.status(500).json({ error: 'Failed to retrieve student pulse' });
  }
});


// ── 5. TIMETABLE & SELF-PERIOD ABSENCE ──────────────────────────────

// GET /api/student/timetable — Latest production timetable for student's class
router.get('/timetable', authMiddleware, checkMaintenance, async (req, res) => {
  try {
    if (req.user.role !== 'student' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Students only' });
    }

    // Resolve student
    let student = null;
    if (req.user.trackId) {
      student = await M.Student.findOne({ trackId: req.user.trackId }).select('-password').lean();
    }
    if (!student && req.user._id) {
      student = await M.Student.findById(req.user._id).select('-password').lean();
    }
    if (!student && req.user.username) {
      student = await M.Student.findOne({ username: req.user.username }).select('-password').lean();
    }

    if (!student) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    // Resolve class
    let cls = null;
    if (student.classId) {
      cls = await M.Class.findById(student.classId).lean();
    }
    if (!cls && student.class) {
      cls = await M.Class.findOne({ name: student.class }).lean();
    }

    const nowP = await nowParts();
    const todayDateStr = nowP.dateStr;
    const currentDay = nowP.day;
    const currentHhmm = nowP.hhmm;

    if (!cls) {
      return res.json({
        ok: true,
        data: {
          class: { name: student.class || 'General', year: student.currentYear || '—' },
          timingSet: null,
          slots: [],
          overrides: [],
          currentSlot: null,
          nextSlot: null,
          todaySchedule: [],
          selfAbsences: [],
          isHoliday: currentDay === 'Sunday',
          holidayReason: currentDay === 'Sunday' ? 'Sunday (Weekly Off)' : ''
        }
      });
    }

    const classId = cls._id;

    // Fetch published SemesterTemplate
    const template = await M.SemesterTemplate.findOne({ classId, status: 'published' }).lean();

    // Fetch timing set
    let timingSet = null;
    if (template?.timingSetId) {
      timingSet = await M.TimingSet.findById(template.timingSetId).lean();
    }
    if (!timingSet && cls.year) {
      const clsYear = String(cls.year).trim().toUpperCase();
      const TO_ROMAN_MAP = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV' };
      const clsYearRoman = TO_ROMAN_MAP[clsYear] || clsYear;
      timingSet = await M.TimingSet.findOne({ applicableYears: { $in: [clsYear, clsYearRoman] } }).lean();
    }
    if (!timingSet) {
      timingSet = await M.TimingSet.findOne({ isDefault: true }).lean();
    }

    const periodsInfo = (timingSet && timingSet.periods && timingSet.periods.length > 0)
      ? timingSet.periods.map(p => ({
          periodNumber: p.periodNumber || p.number,
          start: p.start,
          end: p.end,
          label: p.label || `Period ${p.periodNumber || p.number}`,
          isBreak: !!p.isBreak,
          type: p.type || (p.isBreak ? 'break' : 'period')
        }))
      : [
          { periodNumber: 1, start: '08:30', end: '09:15', label: 'Period 1', isBreak: false, type: 'period' },
          { periodNumber: 2, start: '09:15', end: '10:00', label: 'Period 2', isBreak: false, type: 'period' },
          { periodNumber: null, start: '10:00', end: '10:15', label: 'Morning Interval', isBreak: true, type: 'break' },
          { periodNumber: 3, start: '10:15', end: '11:00', label: 'Period 3', isBreak: false, type: 'period' },
          { periodNumber: 4, start: '11:00', end: '11:45', label: 'Period 4', isBreak: false, type: 'period' },
          { periodNumber: 5, start: '11:45', end: '12:30', label: 'Period 5', isBreak: false, type: 'period' },
          { periodNumber: null, start: '12:30', end: '13:15', label: 'Lunch Break', isBreak: true, type: 'lunch' },
          { periodNumber: 6, start: '13:15', end: '14:00', label: 'Period 6', isBreak: false, type: 'period' },
          { periodNumber: 7, start: '14:00', end: '14:45', label: 'Period 7', isBreak: false, type: 'period' },
          { periodNumber: 8, start: '14:45', end: '15:30', label: 'Period 8', isBreak: false, type: 'period' }
        ];

    // Compile slots for the entire week
    let allSlots = [];
    if (template?.grid?.length) {
      allSlots = template.grid.map(s => ({
        day: s.day,
        period: s.period,
        subject: s.subject || '',
        subjectId: s.subjectId || null,
        teacher: s.teacher || '',
        teacherId: s.teacherId || null,
        teacherTrackId: s.teacherTrackId || '',
        room: s.room || '',
        type: s.type || (s.isLab ? 'Lab' : 'Theory'),
        isLab: !!s.isLab,
        span: s.span || 1
      }));
    } else {
      const secDoc = await M.SectionTimetable.findOne({ classId }).lean();
      if (secDoc && secDoc.slots) {
        const dayMap = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
        Object.entries(secDoc.slots).forEach(([k, raw]) => {
          if (!raw) return;
          const sDay = dayMap[raw.day] || raw.day || '';
          const pNum = typeof raw.period === 'number' ? raw.period : (parseInt(String(raw.period || k).replace(/\D/g, ''), 10) || 1);
          allSlots.push({
            day: sDay,
            period: pNum,
            subject: raw.subject || raw.subjectName || '',
            subjectId: raw.subjectId || null,
            teacher: raw.teacher || raw.teacherName || '',
            teacherTrackId: raw.teacherTrackId || '',
            room: raw.room || raw.hallNo || '',
            type: raw.type || (raw.isLab ? 'Lab' : 'Theory'),
            isLab: Boolean(raw.isLab || raw.type === 'Lab'),
            span: raw.span || raw.duration || 1
          });
        });
      } else {
        const prodVer = await M.TimetableVersion.findOne({ classId, type: 'production' }).sort({ version: -1 }).lean();
        if (prodVer && prodVer.snapshot) {
          const rawSlots = Array.isArray(prodVer.snapshot.slots) ? prodVer.snapshot.slots : (prodVer.snapshot.grid || []);
          const dayMap = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
          rawSlots.forEach(raw => {
            if (!raw) return;
            const sDay = dayMap[raw.day] || raw.day || '';
            const pNum = typeof raw.period === 'number' ? raw.period : (parseInt(String(raw.period).replace(/\D/g, ''), 10) || 1);
            allSlots.push({
              day: sDay,
              period: pNum,
              subject: raw.subject || raw.subjectName || '',
              teacher: raw.teacher || raw.teacherName || '',
              room: raw.room || raw.hallNo || '',
              type: raw.type || (raw.isLab ? 'Lab' : 'Theory'),
              isLab: Boolean(raw.isLab || raw.type === 'Lab'),
              span: raw.span || 1
            });
          });
        }
      }
    }

    // Day Overrides for today
    const startOfDay = new Date(todayDateStr + 'T00:00:00.000Z');
    const endOfDay = new Date(todayDateStr + 'T23:59:59.999Z');
    const overrides = await M.Override.find({
      classId,
      date: { $gte: startOfDay, $lte: endOfDay }
    }).lean();

    // Calendar Holiday check
    const calendarDay = await M.CalendarDay.findOne({ date: { $gte: startOfDay, $lte: endOfDay } }).lean();
    let isHoliday = currentDay === 'Sunday';
    let holidayReason = isHoliday ? 'Sunday (Weekly Off)' : '';
    if (calendarDay?.details?.length) {
      const clsYear = cls?.year ? String(cls.year).trim().toUpperCase() : '';
      const TO_ROMAN_MAP = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV' };
      const clsYearRoman = TO_ROMAN_MAP[clsYear] || clsYear;
      const hol = calendarDay.details.find(d => {
        if (!['holiday', 'vacation', 'exam', 'event', 'leave'].includes(d.dayType)) return false;
        if (!d.year) return true;
        const dYear = String(d.year).trim().toUpperCase();
        return dYear === clsYear || dYear === clsYearRoman;
      });
      if (hol) {
        isHoliday = true;
        holidayReason = hol.comments || `Academic Calendar: ${hol.dayType.toUpperCase()}`;
      }
    }

    // Student self-absent declarations for today
    const selfAbsences = await M.LeaveRequest.find({
      studentId: student._id,
      dates: todayDateStr,
      status: 'Approved'
    }).lean();

    const selfAbsentPeriods = new Set();
    selfAbsences.forEach(sa => {
      (sa.periods || []).forEach(p => selfAbsentPeriods.add(Number(p)));
    });

    // Resolved Today's Schedule
    const todayBaseSlots = allSlots.filter(s => s.day === currentDay).sort((a, b) => a.period - b.period);
    const todaySchedule = [];

    todayBaseSlots.forEach(s => {
      const p = s.period;
      const ov = overrides.find(o => o.period === p || o.periodNumber === p);
      const isSelfAbsent = selfAbsentPeriods.has(p);

      const periodTime = periodsInfo.find(pi => pi.periodNumber === p) || {
        start: '—', end: '—', label: `Period ${p}`
      };

      let slotItem = {
        period: p,
        label: periodTime.label,
        start: periodTime.start,
        end: periodTime.end,
        subject: s.subject,
        teacher: s.teacher,
        teacherTrackId: s.teacherTrackId,
        room: s.room,
        isLab: s.isLab,
        type: s.type,
        span: s.span,
        isSelfAbsent,
        isSubstituted: false,
        isCancelled: false,
        isRoomChanged: false,
        substituteTeacher: null,
        note: ''
      };

      if (ov) {
        if (ov.type === 'cancelled') {
          slotItem.isCancelled = true;
          slotItem.note = ov.reason || 'Lecture cancelled';
        } else if (ov.type === 'substitute') {
          slotItem.isSubstituted = true;
          const sub = ov.newSlot || {};
          slotItem.substituteTeacher = sub.teacherName || sub.teacher || ov.substituteTeacher?.name || 'Substitute';
          slotItem.teacher = slotItem.substituteTeacher;
          slotItem.note = ov.reason || `Substitute: ${slotItem.substituteTeacher}`;
        } else if (ov.type === 'room_change') {
          slotItem.isRoomChanged = true;
          const roomVal = ov.newSlot?.room || ov.newSlot?.hallNo || ov.reason || '';
          if (roomVal) slotItem.room = roomVal;
          slotItem.note = `Room moved to ${slotItem.room}`;
        }
      }

      todaySchedule.push(slotItem);
    });

    // Ongoing Current Slot & Upcoming Slot
    let currentSlot = null;
    let nextSlot = null;

    if (!isHoliday && todaySchedule.length > 0) {
      for (let i = 0; i < todaySchedule.length; i++) {
        const item = todaySchedule[i];
        if (item.start && item.end) {
          if (currentHhmm >= item.start && currentHhmm < item.end) {
            currentSlot = { ...item, status: 'ongoing' };
            if (i + 1 < todaySchedule.length) {
              nextSlot = { ...todaySchedule[i + 1], status: 'upcoming' };
            }
            break;
          } else if (currentHhmm < item.start) {
            if (!nextSlot) {
              nextSlot = { ...item, status: 'upcoming' };
            }
          }
        }
      }

      if (!currentSlot) {
        for (const p of periodsInfo) {
          if (p.isBreak && p.start && p.end) {
            if (currentHhmm >= p.start && currentHhmm < p.end) {
              currentSlot = {
                period: null,
                label: p.label,
                start: p.start,
                end: p.end,
                subject: p.label,
                teacher: '—',
                room: 'Campus Commons',
                isBreak: true,
                status: 'break'
              };
              break;
            }
          }
        }
      }
    }

    return res.json({
      ok: true,
      data: {
        class: {
          _id: cls._id,
          name: cls.name,
          year: cls.year,
          deptName: cls.deptName || student.department || ''
        },
        timingSet: {
          name: timingSet?.name || 'Standard College Timings',
          periods: periodsInfo
        },
        slots: allSlots,
        todaySchedule,
        currentSlot,
        nextSlot,
        isHoliday,
        holidayReason,
        currentDay,
        selfAbsences: selfAbsences.map(sa => ({
          _id: sa._id,
          periods: sa.periods || [],
          reason: sa.reason,
          date: sa.fromDate
        }))
      }
    });
  } catch (err) {
    console.error('[Student Timetable Error]:', err);
    return res.status(500).json({ error: 'Failed to load student timetable' });
  }
});

// POST /api/student/self-absent — Self-mark absent for specified periods on a date
router.post('/self-absent', authMiddleware, checkMaintenance, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Students only' });
    }

    const { date, periods, reason } = req.body;
    const nowP = await nowParts();
    const todayStr = nowP.dateStr;
    const targetDate = String(date || todayStr).trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({ error: 'Invalid date format (YYYY-MM-DD required)' });
    }
    if (targetDate < todayStr) {
      return res.status(400).json({ error: 'Cannot mark self-absence for past dates' });
    }

    if (!Array.isArray(periods) || periods.length === 0) {
      return res.status(400).json({ error: 'Please select at least one period to mark absent' });
    }
    const cleanPeriods = periods
      .map(p => Number(p))
      .filter(p => !isNaN(p) && p >= 1 && p <= 9);

    if (cleanPeriods.length === 0) {
      return res.status(400).json({ error: 'Invalid periods selected' });
    }

    let student = null;
    if (req.user.trackId) student = await M.Student.findOne({ trackId: req.user.trackId }).lean();
    if (!student && req.user._id) student = await M.Student.findById(req.user._id).lean();
    if (!student && req.user.username) student = await M.Student.findOne({ username: req.user.username }).lean();
    if (!student) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    let cls = null;
    if (student.classId) cls = await M.Class.findById(student.classId).lean();
    if (!cls && student.class) cls = await M.Class.findOne({ name: student.class }).lean();

    const cleanReason = String(reason || 'Self-declared period absence').trim();

    // Check if an existing approved self-absence record exists for this date
    let existing = await M.LeaveRequest.findOne({
      studentId: student._id,
      dates: targetDate,
      leaveType: 'Self-Declared Absence',
      status: 'Approved'
    });

    if (existing) {
      const mergedPeriods = Array.from(new Set([...(existing.periods || []), ...cleanPeriods])).sort((a, b) => a - b);
      existing.periods = mergedPeriods;
      existing.reason = cleanReason || existing.reason;
      existing.daysCount = Math.round((mergedPeriods.length / 8) * 100) / 100 || 0.125;
      await existing.save();

      return res.json({
        ok: true,
        message: `Self-absence updated for Period(s) ${mergedPeriods.join(', ')} on ${targetDate}.`,
        data: existing
      });
    }

    const reqId = `SA-${targetDate.replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newRecord = await M.LeaveRequest.create({
      requestId: reqId,
      studentId: student._id,
      studentTrackId: student.trackId,
      studentName: student.fullName || student.name || req.user.name,
      studentRegNo: student.registerNo || student.regNo || '',
      classId: student.classId || cls?._id,
      className: student.class || cls?.name || 'Class',
      deptId: student.deptId || cls?.deptId,
      deptName: student.department || cls?.deptName || '',
      category: 'Permission',
      leaveCategory: 'Personal',
      leaveType: 'Self-Declared Absence',
      slot: 'Custom Periods',
      coverage: 'periods',
      periods: cleanPeriods.sort((a, b) => a - b),
      fromDate: targetDate,
      toDate: targetDate,
      dates: [targetDate],
      daysCount: Math.round((cleanPeriods.length / 8) * 100) / 100 || 0.125,
      reason: cleanReason,
      status: 'Approved',
      advisorStatus: 'Approved',
      advisorRemarks: 'Self-declared period absence',
      hodStatus: 'Approved',
      hodRemarks: 'Self-declared period absence',
      reviewedBy: student.fullName || req.user.name,
      reviewedAt: new Date(),
      reviewRemarks: 'Self-declared by student via portal',
      filedByAdvisor: false
    });

    return res.json({
      ok: true,
      message: `Successfully marked self-absent for Period(s) ${cleanPeriods.join(', ')} on ${targetDate}.`,
      data: newRecord
    });
  } catch (err) {
    console.error('[Self-Absent Error]:', err);
    return res.status(500).json({ error: 'Failed to record self-absence' });
  }
});

// GET /api/student/self-absent — List self-absence records for a date
router.get('/self-absent', authMiddleware, checkMaintenance, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Students only' });
    }

    let student = null;
    if (req.user.trackId) student = await M.Student.findOne({ trackId: req.user.trackId }).lean();
    if (!student && req.user._id) student = await M.Student.findById(req.user._id).lean();

    const date = req.query.date ? String(req.query.date).trim() : todayIST();
    const records = await M.LeaveRequest.find({
      studentId: student?._id,
      dates: date,
      leaveType: 'Self-Declared Absence',
      status: 'Approved'
    }).lean();

    return res.json({ ok: true, data: records });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch self-absence records' });
  }
});

// DELETE /api/student/self-absent/:id — Revoke a self-absence declaration
router.delete('/self-absent/:id', authMiddleware, checkMaintenance, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Students only' });
    }

    const { id } = req.params;
    let student = null;
    if (req.user.trackId) student = await M.Student.findOne({ trackId: req.user.trackId }).lean();
    if (!student && req.user._id) student = await M.Student.findById(req.user._id).lean();

    const record = await M.LeaveRequest.findOne({
      _id: id,
      studentId: student?._id,
      leaveType: 'Self-Declared Absence'
    });

    if (!record) {
      return res.status(404).json({ error: 'Self-absence record not found' });
    }

    await M.LeaveRequest.deleteOne({ _id: id });
    return res.json({
      ok: true,
      message: 'Self-absence declaration removed.'
    });
  } catch (err) {
    console.error('[Delete Self-Absent Error]:', err);
    return res.status(500).json({ error: 'Failed to remove self-absence' });
  }
});

module.exports = router;

