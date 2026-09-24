const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { sanitizeToString } = require('../utils/sanitizeQuery');

router.get('/summary', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [students, depts, teachers, classes, pendingNotifs] = await Promise.all([
      M.Student.countDocuments(),
      M.Department.countDocuments(),
      M.User.countDocuments({ role: 'teacher', status: 'active' }),
      M.Class.countDocuments(),
      M.Notification.countDocuments({
        status: 'Pending',
        read: false,
        toTeacherId: null,
        toStudentId: null,
        leaveRequestId: null,
        toTeacherTrackId: { $in: ['', null] },
        toStudentTrackId: { $in: ['', null] },
        fromRole: { $ne: 'student' },
        type: { $nin: ['leave-request', 'leave-approval', 'leave-rejection', 'attendance-alert'] }
      }),
    ]);
    res.json({ students, depts, teachers, classes, pendingNotifs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/counts', authMiddleware, adminOnly, async (req, res) => {
  try {
    const adminNotifFilter = {
      toTeacherId: null,
      toStudentId: null,
      leaveRequestId: null,
      toTeacherTrackId: { $in: ['', null] },
      toStudentTrackId: { $in: ['', null] },
      fromRole: { $ne: 'student' },
      type: { $nin: ['leave-request', 'leave-approval', 'leave-rejection', 'attendance-alert'] }
    };

    const [depts, classes, subjects, students, users, teachers, assignments, logs, notifications, pendingNotifs] = await Promise.all([
      M.Department.countDocuments(),
      M.Class.countDocuments(),
      M.Subject.countDocuments(),
      M.Student.countDocuments(),
      M.User.countDocuments(),
      M.User.countDocuments({ role: 'teacher', status: { $ne: 'inactive' } }),
      M.Assignment.countDocuments(),
      M.Log.countDocuments(),
      M.Notification.countDocuments(adminNotifFilter),
      M.Notification.countDocuments(Object.assign({ status: 'Pending', read: false }, adminNotifFilter)),
    ]);
    res.json({ depts, classes, subjects, students, users, teachers, assignments, logs, notifications, pendingNotifs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET /api/dashboard/attendance-overview — Aggregated attendance chart data
// Query: ?deptId=&classId=&from=&to=&date=&reportType=overall|specific
router.get('/attendance-overview', authMiddleware, adminOnly, async (req, res) => {
  try {
    const deptId = sanitizeToString(req.query.deptId);
    const classId = sanitizeToString(req.query.classId);
    const from = sanitizeToString(req.query.from);
    const to = sanitizeToString(req.query.to);
    const date = sanitizeToString(req.query.date);
    const reportType = sanitizeToString(req.query.reportType);
    let classIds = [];
    if (classId) {
      classIds = [classId];
    } else if (deptId) {
      const classes = await M.Class.find({ deptId }).lean();
      classIds = classes.map(function (c) { return c.classTrackId || String(c._id); });
    }
    const filter = {};
    if (classIds.length) filter.classId = { $in: classIds };
    if (reportType === 'specific' && date) {
      const d = new Date(date + 'T00:00:00.000Z');
      filter.date = { $gte: d, $lte: new Date(d.getTime() + 86400000) };
    } else if (from && to) {
      filter.date = {
        $gte: new Date(from + 'T00:00:00.000Z'),
        $lte: new Date(to + 'T23:59:59.999Z')
      };
    }
    const docs = await M.ClassAttendance.find(filter).sort({ date: 1 }).lean();
    if (reportType === 'specific' && date) {
      const bySubject = {};
      for (const doc of docs) {
        for (const period of doc.periods || []) {
          const sub = period.subjectTrackId;
          if (!sub) continue;
          if (!bySubject[sub]) bySubject[sub] = { present: 0, absent: 0 };
          for (const rec of period.records || []) {
            bySubject[sub][rec.status === 'P' ? 'present' : 'absent']++;
          }
        }
      }
      const chartItems = Object.entries(bySubject).map(function (entry) {
        const name = entry[0], counts = entry[1];
        const total = counts.present + counts.absent;
        const pct = total ? Math.round(counts.present / total * 100) : 0;
        return {
          label: name.slice(0, 4), full: name,
          present: counts.present, absent: counts.absent,
          total: total, pct: pct,
          type: pct >= 75 ? 'high' : pct >= 50 ? 'mid' : 'low'
        };
      });
      const tp = chartItems.reduce(function (s, i) { return s + i.present; }, 0);
      const ta = chartItems.reduce(function (s, i) { return s + i.absent; }, 0);
      const op = (tp + ta) ? Math.round(tp / (tp + ta) * 100) : 0;
      return res.json({ chartItems: chartItems, summary: { present: tp, absent: ta, pct: op + '%' } });
    }
    const byDate = {};
    for (const doc of docs) {
      const dateStr = doc.date ? new Date(doc.date).toISOString().split('T')[0] : '';
      if (!byDate[dateStr]) byDate[dateStr] = { present: 0, absent: 0 };
      for (const period of doc.periods || []) {
        for (const rec of period.records || []) {
          byDate[dateStr][rec.status === 'P' ? 'present' : 'absent']++;
        }
      }
    }
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayISO = new Date().toISOString().split('T')[0];
    const chartItems = [];
    let cursor = new Date(from || Date.now());
    let endDate = new Date(to || Date.now());
    if (!from || !to) {
      Object.keys(byDate).sort().forEach(function (iso) {
        const counts = byDate[iso];
        const total = counts.present + counts.absent;
        const pct = total ? Math.round(counts.present / total * 100) : 0;
        chartItems.push({
          label: dayNames[new Date(iso).getDay()], date: iso,
          present: counts.present, absent: counts.absent, total: total, pct: pct,
          type: total === 0 ? 'nodata' : pct >= 75 ? 'high' : pct >= 50 ? 'mid' : 'low',
          isToday: iso === todayISO
        });
      });
    } else {
      while (cursor <= endDate) {
        const iso = cursor.toISOString().split('T')[0];
        const dow = cursor.getDay();
        const counts = byDate[iso] || { present: 0, absent: 0 };
        const total = counts.present + counts.absent;
        const pct = total ? Math.round(counts.present / total * 100) : 0;
        chartItems.push({
          label: dayNames[dow], date: iso,
          present: counts.present, absent: counts.absent, total: total, pct: pct,
          type: (dow === 0 || dow === 6) ? 'weekend' : (total === 0 ? 'nodata' : pct >= 75 ? 'high' : pct >= 50 ? 'mid' : 'low'),
          isToday: iso === todayISO
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    const validItems = chartItems.filter(function (i) { return i.total > 0; });
    const summary = validItems.length
      ? {
          present: Math.round(validItems.reduce(function (s, i) { return s + i.present; }, 0) / validItems.length),
          absent: Math.round(validItems.reduce(function (s, i) { return s + i.absent; }, 0) / validItems.length),
          pct: Math.round(validItems.reduce(function (s, i) { return s + i.pct; }, 0) / validItems.length) + '%'
        }
      : { present: '—', absent: '—', pct: '—%' };
    res.json({ chartItems: chartItems, summary: summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/defaulters — Students with < 75% attendance
router.get('/defaulters', authMiddleware, adminOnly, async (req, res) => {
  try {
    const studentAttRecords = await M.StudentAttendance.find().lean();
    const trackIds = studentAttRecords.map(function (r) { return r.studentTrackId; });
    const students = trackIds.length
      ? await M.Student.find({
          $or: [
            { trackId: { $in: trackIds } },
            { _id: { $in: trackIds.filter(function (id) { return mongoose.isValidObjectId(id); }) } }
          ]
        }).select('trackId fullName registerNo classId deptId department deptName class').lean()
      : [];
    const studentMap = new Map();
    students.forEach(function (s) {
      studentMap.set(s.trackId, s);
      studentMap.set(String(s._id), s);
    });
    const classIds = [...new Set(students.map(function (s) { return s.classId; }).filter(Boolean))];
    const classDocs = classIds.length
      ? await M.Class.find({ _id: { $in: classIds } }).select('name').lean()
      : [];
    const classMap = new Map();
    classDocs.forEach(function (c) { classMap.set(String(c._id), c.name); });
    const defaulters = [];
    studentAttRecords.forEach(function (rec) {
      const totalHeld = rec.records.reduce(function (s, r) { return s + r.classesHeld; }, 0);
      const totalAttended = rec.records.reduce(function (s, r) { return s + r.classesAttended; }, 0);
      if (!totalHeld) return;
      const pct = Math.round(totalAttended / totalHeld * 100);
      if (pct >= 75) return;
      const stu = studentMap.get(rec.studentTrackId);
      if (!stu) return;
      defaulters.push({
        name: stu.fullName, regNo: stu.registerNo,
        className: classMap.get(String(stu.classId)) || stu.class || '—',
        deptName: stu.department || stu.deptName || '—',
        pct: pct
      });
    });
    defaulters.sort(function (a, b) { return a.pct - b.pct; });
    res.json(defaulters);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;