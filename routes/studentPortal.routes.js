const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { checkMaintenance } = require('../middleware/maintenance');

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

    // Minimum attendance requirement from settings
    const academicSetting = await M.Settings.findOne({ key: 'academic' }).lean();
    const minRequired = academicSetting?.value?.minAttendance || 75;

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
      const dateStr = doc.date ? new Date(doc.date).toISOString().split('T')[0] : '';
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
    const overall = totalClasses > 0 ? Math.round((totalPresent / totalClasses) * 100) : 0;

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
        overall,
        minRequired,
      },
    });
  } catch (err) {
    console.error('[StudentPortal Exception]:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;