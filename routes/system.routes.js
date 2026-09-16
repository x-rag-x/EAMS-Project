const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware, adminOnly, requireRight } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { _serverStartTime, _serverLogs } = require('../utils/serverState');
const { criticalDeleteLimiter } = require('../utils/rateLimiters');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { checkModuleGuard } = require('../middleware/portalGuard');

// POST /api/system/backup - Create full database snapshot backup
router.post('/backup', authMiddleware, adminOnly, requireRight('controlPage'), checkModuleGuard('modelBackup', 'Database Backup'), async (req, res) => {
  try {
    const [students, teachers, departments, classes, subjects, classAttendance, studentAttendance, assignments] = await Promise.all([
      M.Student.find().lean(),
      M.Teacher.find().lean(),
      M.Department.find().lean(),
      M.Class.find().lean(),
      M.Subject.find().lean(),
      M.ClassAttendance.find().lean(),
      M.StudentAttendance.find().lean(),
      M.Assignment.find().lean(),
    ]);
    const totalDocs = students.length + teachers.length + departments.length
      + classes.length + subjects.length + classAttendance.length + studentAttendance.length + assignments.length;
    const backupPayload = {
      meta: { createdAt: new Date().toISOString(), createdBy: req.user.name, totalDocs },
      students, teachers, departments, classes, subjects, classAttendance, studentAttendance, assignments
    };
    const backupPassword = crypto.randomBytes(6).toString('hex').toUpperCase();
    // Backup cloud storage upload stub
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'System Backup Created',
      `${totalDocs} docs — GDrive upload pending`,
      'system',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'control', subType: 'backup', trackId: req.user.trackId }
    );
    res.json({
      ok: true, totalDocs, backupPassword, createdAt: backupPayload.meta.createdAt,
      collections: {
        students: students.length, teachers: teachers.length, departments: departments.length,
        classes: classes.length, subjects: subjects.length,
        classAttendance: classAttendance.length, studentAttendance: studentAttendance.length,
        assignments: assignments.length
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/backup/history', authMiddleware, adminOnly, requireRight('controlPage'), async (req, res) => {
  try {
    const logs = await M.Log.find({ action: 'System Backup Created' }).sort({ time: -1 }).limit(20).lean();
    res.json(logs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/system/export - Export database collections with password protection
router.post('/export', authMiddleware, adminOnly, requireRight('downloadDatas', 'controlPage'), async (req, res) => {
  try {
    const type = req.body.type || 'all';
    const studentCount = await M.Student.countDocuments();
    let payload;
    if (type === 'all') {
      const [students, teachers, departments, classes, subjects, classAttendance, studentAttendance, assignments] = await Promise.all([
        M.Student.find({}, '-password').lean(), M.Teacher.find({}, '-password').lean(),
        M.Department.find().lean(), M.Class.find().lean(), M.Subject.find().lean(),
        M.ClassAttendance.find().lean(), M.StudentAttendance.find().lean(), M.Assignment.find().lean(),
      ]);
      payload = {
        meta: {
          exportedAt: new Date().toISOString(), exportedBy: req.user.name,
          type, totalStudents: studentCount
        }, students, teachers, departments, classes, subjects, classAttendance, studentAttendance, assignments
      };
    } else {
      const dataMap = {
        students: () => M.Student.find({}, '-password').lean(),
        teachers: () => M.Teacher.find({}, '-password').lean(),
        attendance: () => M.ClassAttendance.find().lean(),
        studentAttendance: () => M.StudentAttendance.find().lean(),
      };
      const data = dataMap[type] ? await dataMap[type]() : [];
      payload = {
        meta: {
          exportedAt: new Date().toISOString(), exportedBy: req.user.name,
          type, totalStudents: studentCount
        }, data
      };
    }
    const exportPassword = crypto.randomBytes(6).toString('hex').toUpperCase();
    // Export notification email dispatch stub
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Data Exported',
      `Type: ${type} — password mailed (stub)`,
      'system',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'control', subType: 'export', trackId: req.user.trackId }
    );
    res.json({ ok: true, payload, exportPassword, totalStudents: studentCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/system/dbstats - Return database storage and collection statistics
router.get('/dbstats', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const stats = await db.command({ dbStats: 1, scale: 1024 * 1024 });
    const collList = await db.listCollections().toArray();
    const collStats = await Promise.all(collList.map(async c => ({ name: c.name, count: await db.collection(c.name).countDocuments() })));
    res.json({ dbName: stats.db, collections: stats.collections, totalDocs: stats.objects, dataSize: stats.dataSize.toFixed(2), storageSize: stats.storageSize.toFixed(2), indexSize: stats.indexSize ? stats.indexSize.toFixed(2) : '0.00', fsTotalSize: stats.fsTotalSize ? (stats.fsTotalSize / 1024 / 1024).toFixed(0) : null, fsUsedSize: stats.fsUsedSize ? (stats.fsUsedSize / 1024 / 1024).toFixed(0) : null, collStats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/serverlogs', authMiddleware, adminOnly, (req, res) => {
  const sinceStr = sanitizeToString(req.query.since);
  const since = sinceStr ? new Date(sinceStr) : null;
  const logs = since ? _serverLogs.filter(l => new Date(l.time) > since) : _serverLogs.slice(-100);
  res.json({
    logs,
    uptime: Math.floor((Date.now() - _serverStartTime) / 1000),
    startTime: _serverStartTime.toISOString(),
    nodeVersion: process.version,
    env: process.env.NODE_ENV || 'development',
    memMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

// GET /api/system/health - Return system runtime health and overview metrics
router.get('/health', authMiddleware, adminOnly, async (req, res) => {
  try {
    const dbState = mongoose.connection.readyState;
    const dbStateMap = { 0: 'Disconnected', 1: 'Connected', 2: 'Connecting', 3: 'Disconnecting' };
    const activeTeachersCount = await M.User.countDocuments({ role: 'teacher', status: 'active' });
    const activeStudentsCount = await M.User.countDocuments({ role: 'student', status: 'active' });
    const activeAdminsCount = await M.User.countDocuments({ role: 'admin', status: 'active' });
    
    const [errorCount, warnCount] = await Promise.all([
      M.Log.countDocuments({ severity: { $in: ['critical', 'error'] } }),
      M.Log.countDocuments({ severity: 'warning' }),
    ]);
    const totalUsers = activeTeachersCount + activeStudentsCount + activeAdminsCount;
    const activeTeachers = activeTeachersCount;
    const errFilter = { severity: { $in: ['critical', 'error', 'warning'] } };
    const errLimitParam = sanitizeToString(req.query.errLimit);
    const errLimit = Math.min(100, Math.max(1, parseInt(errLimitParam, 10) || 20));
    const errMode = sanitizeToString(req.query.errMode);
    if (errMode === 'week') {
      errFilter.time = { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
    }
    const recentErrors = await M.Log.find(errFilter)
      .sort({ time: -1 }).limit(errMode === 'week' ? 100 : errLimit).lean();
    res.json({
      dbStatus: dbStateMap[dbState] || 'Unknown',
      dbConnected: dbState === 1,
      serverUptime: Math.floor(process.uptime()),
      errorCount, warnCount, totalUsers, activeTeachers, recentErrors,
      memoryMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
      nodeVersion: process.version,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/system/delete-adder - Bulk wipe selected core collections and shadow accounts
const ADDER_MODELS = {
  departments: M.Department,
  classes:     M.Class,
  subjects:    M.Subject,
  students:    M.Student,
  teachers:    M.Teacher,
};

router.post('/delete-adder', criticalDeleteLimiter, authMiddleware, adminOnly, requireRight('deletings'), async (req, res) => {
  try {
    const { collections } = req.body;
    if (!Array.isArray(collections) || collections.length === 0) {
      return res.status(400).json({ success: false, error: 'No collections specified' });
    }
    const invalid = collections.filter((c) => !ADDER_MODELS[c]);
    if (invalid.length) {
      return res.status(400).json({ success: false, error: 'Unknown collection(s): ' + invalid.join(', ') });
    }

    let deleted = 0;
    for (const name of collections) {
      const result = await ADDER_MODELS[name].deleteMany({});
      deleted += result.deletedCount || 0;
      // Clean up associated shadow user accounts for deleted students and teachers
      if (name === 'students') {
        const shadow = await M.User.deleteMany({ role: 'student' });
        deleted += shadow.deletedCount || 0;
      } else if (name === 'teachers') {
        const shadow = await M.User.deleteMany({ role: 'teacher' });
        deleted += shadow.deletedCount || 0;
      }
    }

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Bulk Delete',
      'Deleted collections: ' + collections.join(', '),
      'system',
      'critical',
      req.ip,
      req.user.sessionId,
      { module: 'control', subType: 'danger', trackId: req.user.trackId }
    );
    res.json({ success: true, deleted, collections });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/system/broadcast/send - Dispatch broadcast banner and notifications
router.post('/broadcast/send', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { message, level = 'info', targetRoles = ['all'], isForcedAll = false, popupDurationSec = 10 } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Broadcast message content is required' });
    }

    const duration = Math.min(120, Math.max(3, parseInt(popupDurationSec, 10) || 10));
    const validLevel = ['info', 'warning', 'urgent', 'success', 'message'].includes(level) ? level : 'info';

    // Update active broadcast in settings
    await M.Settings.findOneAndUpdate(
      { key: 'broadcast' },
      {
        card: 'System Broadcasts',
        value: {
          systemBannerActive: true,
          systemBannerMessage: message.trim(),
          systemBannerLevel: validLevel,
          defaultPopupDurationSec: duration,
          targetRoles: isForcedAll ? ['all'] : targetRoles,
          isForcedAll: !!isForcedAll,
          updatedAt: new Date()
        },
        updatedBy: req.user.name || 'Admin'
      },
      { upsert: true }
    );

    // Fetch target user IDs
    const sentUserIds = [];
    const failedDetails = [];
    let students = [];
    let teachers = [];

    const shouldIncludeStudents = isForcedAll || targetRoles.includes('all') || targetRoles.includes('student');
    const shouldIncludeTeachers = isForcedAll || targetRoles.includes('all') || targetRoles.includes('teacher');

    if (shouldIncludeStudents) {
      try {
        students = await M.Student.find({}, '_id registerNo fullName trackId').lean();
        students.forEach(s => sentUserIds.push(s.registerNo || s.trackId || String(s._id)));
      } catch (err) {
        failedDetails.push({ userId: 'students_group', error: err.message });
      }
    }

    if (shouldIncludeTeachers) {
      try {
        teachers = await M.Teacher.find({}, '_id username fullName trackId').lean();
        teachers.forEach(t => sentUserIds.push(t.username || t.trackId || String(t._id)));
      } catch (err) {
        failedDetails.push({ userId: 'teachers_group', error: err.message });
      }
    }

    // If level is 'message', also push notification into User Notification inbox
    if (validLevel === 'message') {
      const notifDocs = [];
      if (shouldIncludeStudents) {
        students.forEach(s => {
          notifDocs.push({
            type: 'info',
            from: req.user.name || 'Admin Broadcast',
            fromRole: 'admin',
            toStudentId: s._id,
            toStudentName: s.fullName || '',
            toStudentTrackId: s.trackId || '',
            message: message.trim(),
            priority: 'High',
            status: 'Solved',
            time: new Date()
          });
        });
      }
      if (shouldIncludeTeachers) {
        teachers.forEach(t => {
          notifDocs.push({
            type: 'info',
            from: req.user.name || 'Admin Broadcast',
            fromRole: 'admin',
            toTeacherId: t._id,
            toTeacherName: t.fullName || '',
            toTeacherTrackId: t.trackId || '',
            message: message.trim(),
            priority: 'High',
            status: 'Solved',
            time: new Date()
          });
        });
      }
      if (notifDocs.length > 0) {
        await M.Notification.insertMany(notifDocs).catch(err => {
          console.error('[Broadcast Notification Push Error]:', err.message);
        });
      }
    }

    // Save to BroadcastHistory
    const broadcastRecord = await M.BroadcastHistory.create({
      message: message.trim(),
      level: validLevel,
      targetRoles: isForcedAll ? ['all'] : targetRoles,
      isForcedAll: !!isForcedAll,
      popupDurationSec: duration,
      sentCount: sentUserIds.length,
      sentUserIds,
      failedCount: failedDetails.length,
      failedDetails,
      dispatchedBy: {
        role: req.user.role,
        username: req.user.username,
        name: req.user.name || 'Admin',
        trackId: req.user.trackId || '',
        ip: req.ip || '',
      },
      dispatchedAt: new Date()
    });

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Broadcast Sent',
      `Level: ${validLevel} | Duration: ${duration}s | Sent to ${sentUserIds.length} users | Msg: "${message.slice(0, 50)}"`,
      'system',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'control', subType: 'broadcast', trackId: req.user.trackId }
    );

    res.json({
      success: true,
      broadcastId: broadcastRecord._id,
      sentCount: sentUserIds.length,
      sentUserIds,
      failedCount: failedDetails.length,
      failedDetails,
      popupDurationSec: duration
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/broadcast/history', authMiddleware, adminOnly, async (req, res) => {
  try {
    const history = await M.BroadcastHistory.find()
      .sort({ dispatchedAt: -1 })
      .limit(50)
      .lean();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/broadcast/clear', authMiddleware, adminOnly, async (req, res) => {
  try {
    await M.Settings.findOneAndUpdate(
      { key: 'broadcast' },
      { $set: { 'value.systemBannerActive': false } }
    );
    await logAction(req.user._id, req.user.name, req.user.role, 'Broadcast Cleared', 'Active banner deactivated', 'system', 'info', req.ip);
    res.json({ success: true, message: 'Broadcast banner deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;