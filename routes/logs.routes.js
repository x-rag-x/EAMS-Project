const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, requirePage } = require('../middleware/auth');
const { logAction, normalizeIp } = require('../utils/logAction');
const { decryptLog } = require('../utils/logCrypto');
const { isSudo } = require('../utils/access');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { getStartOfInstitutionDaySync } = require('../utils/institutionTime');
const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/logs/stats — Server-aggregated status cards metrics
router.get('/stats', authMiddleware, requirePage('logs', 'view'), async (req, res) => {
  try {
    const todayStart = getStartOfInstitutionDaySync();
    // normalized to institution start of day

    const [
      totalLogs,
      adminLogs,
      teacherLogs,
      studentLogs,
      systemLogs,
      todayLogs,
      criticalEvents,
      activeSessionsList,
      lockedCount
    ] = await Promise.all([
      M.Log.countDocuments({}),
      M.Log.countDocuments({ $or: [{ module: 'admin' }, { role: 'admin' }, { actingWithAdminRights: true }] }),
      M.Log.countDocuments({ $or: [{ module: 'teacher' }, { role: 'teacher' }] }),
      M.Log.countDocuments({ $or: [{ module: 'student' }, { role: 'student' }] }),
      M.Log.countDocuments({ $or: [{ module: { $in: ['system', 'control', 'settings', 'manage'] } }, { category: 'security' }] }),
      M.Log.countDocuments({ createdAt: { $gte: todayStart } }),
      M.Log.countDocuments({ severity: 'critical' }),
      M.LoginSession.countDocuments({ active: true }),
      M.User.countDocuments({ status: 'locked' })
    ]);

    const activeSessions = typeof activeSessionsList === 'number'
      ? activeSessionsList
      : (activeSessionsList?.[0]?.count || 0);

    res.json({
      totalLogs,
      adminLogs,
      teacherLogs,
      studentLogs,
      systemLogs,
      todayLogs,
      criticalEvents,
      activeSessions,
      lockedCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/logs — Fetch filtered audit logs with decrypted payload & joined session history
router.get('/', authMiddleware, requirePage('logs', 'view'), async (req, res) => {
  try {
    const limitParam = sanitizeToString(req.query.limit);
    const limit = Math.min(100, Math.max(1, parseInt(limitParam, 10) || 50));
    const filter = {};

    const before = sanitizeToString(req.query.before);
    if (before) {
      filter.createdAt = { $lt: new Date(before) };
    }

    const moduleFilter = sanitizeToString(req.query.module);
    if (moduleFilter && moduleFilter !== 'all' && moduleFilter !== 'overview') {
      if (moduleFilter === 'admin') {
        filter.$or = [{ module: 'admin' }, { role: 'admin' }, { actingWithAdminRights: true }];
      } else if (moduleFilter === 'teacher') {
        filter.$or = [{ module: 'teacher' }, { role: 'teacher' }];
      } else if (moduleFilter === 'student') {
        filter.$or = [{ module: 'student' }, { role: 'student' }];
      } else if (moduleFilter === 'system') {
        filter.$or = [{ module: { $in: ['system', 'control', 'settings', 'manage'] } }, { category: 'security' }];
      } else {
        filter.module = moduleFilter;
      }
    }

    const subType = sanitizeToString(req.query.subType);
    if (subType && subType !== 'all') {
      filter.subType = subType;
    }

    const severity = sanitizeToString(req.query.severity);
    if (severity && severity !== 'all') {
      filter.severity = severity;
    }

    const category = sanitizeToString(req.query.category);
    if (category && category !== 'all') {
      filter.category = category;
    }

    const role = sanitizeToString(req.query.role);
    if (role && role !== 'all') {
      filter.role = role;
    }

    const from = sanitizeToString(req.query.from);
    const to = sanitizeToString(req.query.to);
    if (from || to) {
      filter.time = {};
      if (from) filter.time.$gte = new Date(from + 'T00:00:00.000Z');
      if (to) filter.time.$lte = new Date(to + 'T23:59:59.999Z');
    }

    const search = sanitizeToString(req.query.search);
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { logTrackId: re },
          { userName: re },
          { action: re },
          { details: re },
          { trackId: re },
          { ip: re }
        ]
      });
    }

    const logs = await M.Log.find(filter).sort({ createdAt: -1 }).limit(limit).lean();

    // Batch join sessions directly from LoginSession by sessionId (indexed O(1)) (§3.10, S7.5)
    const sessionLogs = logs.filter(l => l.sessionId);
    const sessionIdsToFetch = [...new Set(sessionLogs.map(l => l.sessionId).filter(Boolean))];

    const sessionMap = new Map();

    if (sessionIdsToFetch.length) {
      const loginSessions = await M.LoginSession.find({
        sessionId: { $in: sessionIdsToFetch }
      }).lean();

      loginSessions.forEach(ls => {
        if (ls.sessionId) {
          const sessObj = {
            sessionId: ls.sessionId,
            loginTime: ls.loginTime || ls.createdAt,
            logoutTime: ls.logoutAt || null,
            logoutMethod: ls.logoutMethod || (ls.logoutAt ? 'manual' : null),
            current: ls.active ? 'Logged In' : 'Logged Out',
            active: !!ls.active,
            ip: normalizeIp(ls.ip || ''),
            deviceType: ls.deviceInfo?.type || 'Desktop',
            browser: ls.deviceInfo?.browser || 'Chrome',
            os: ls.deviceInfo?.os || 'Windows',
            location: ls.location || { address: '', latitude: null, longitude: null }
          };
          sessionMap.set(ls.sessionId, sessObj);
          if (ls.trackId) {
            sessionMap.set(`${ls.trackId}_${ls.sessionId}`, sessObj);
          }
        }
      });

      // Migration fallback: For legacy log records created before LoginSession, check LoginHistory
      const missingSessionIds = sessionIdsToFetch.filter(sid => !sessionMap.has(sid));
      if (missingSessionIds.length) {
        const legacyHistories = await M.LoginHistory.find({
          "history.sessionId": { $in: missingSessionIds }
        }).lean();

        legacyHistories.forEach(lh => {
          (lh.history || []).forEach(sess => {
            if (sess.sessionId && !sessionMap.has(sess.sessionId)) {
              const legacyObj = {
                sessionId: sess.sessionId,
                loginTime: sess.loginTime || sess.time,
                logoutTime: sess.logoutTime || null,
                logoutMethod: sess.logoutMethod || (sess.logoutTime ? 'manual' : null),
                current: sess.current,
                active: sess.active && sess.current === 'Logged In',
                ip: normalizeIp(sess.ip || ''),
                deviceType: sess.deviceType || 'Desktop',
                browser: sess.browser || 'Chrome',
                os: sess.os || 'Windows',
                location: sess.location || { address: '', latitude: null, longitude: null }
              };
              sessionMap.set(sess.sessionId, legacyObj);
              if (lh.trackId) {
                sessionMap.set(`${lh.trackId}_${sess.sessionId}`, legacyObj);
              }
            }
          });
        });
      }
    }

    // Decrypt and enrich log documents
    const enrichedLogs = logs.map(l => {
      let decryptedDetails = l.details;
      let decryptedChanges = l.changes;

      if (l.encryptedPayload) {
        const payload = decryptLog(l.encryptedPayload);
        if (payload && typeof payload === 'object') {
          if (payload.details) decryptedDetails = payload.details;
          if (payload.changes) decryptedChanges = payload.changes;
          if (!l.deviceId && payload.deviceId) l.deviceId = payload.deviceId;
          if (!l.deviceName && payload.deviceName) l.deviceName = payload.deviceName;
          if (!l.deviceInstallId && payload.deviceInstallId) l.deviceInstallId = payload.deviceInstallId;
          if (!l.deviceInfo && payload.deviceInfo) l.deviceInfo = payload.deviceInfo;
        }
      }

      let sessionInfo = null;
      let loc = l.location || null;

      if (l.sessionId) {
        const sess = sessionMap.get(l.sessionId) || sessionMap.get(`${l.trackId}_${l.sessionId}`);
        if (sess) {
          sessionInfo = sess;
          if (!loc || (!loc.latitude && !loc.address)) {
            loc = sess.location || null;
          }
        }
      }

      if (!loc) {
        loc = { address: '', latitude: null, longitude: null, accuracy: null };
      }

      const logTrackId = l.logTrackId || `TR-LOG-${String(l._id).slice(-6).toUpperCase()}`;
      const resolvedTrackId = l.trackId || (
        (l.role === 'system' || l.userName === 'SYSTEM') ? 'TR-SYS-001' : 
        (l.userName === 'START-MENU' ? 'TR-SYS-CLI' : 
        (['admin', 'sudo'].includes(l.role) ? 'TR-ADMIN001' : 'TR-SYS-001'))
      );

      return {
        ...l,
        logTrackId,
        trackId: resolvedTrackId,
        ip: normalizeIp(l.ip),
        sessionId: l.sessionId || (sessionInfo ? sessionInfo.sessionId : ''),
        location: loc,
        details: decryptedDetails,
        changes: decryptedChanges,
        sessionInfo,
        attendanceClassDaily: l.attendanceClassDaily || undefined
      };
    });

    const total = await M.Log.countDocuments(filter);
    res.json({ logs: enrichedLogs, total, hasMore: logs.length === limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/logs/detail/:id — Fetch single log with full decrypted details & session joins
router.get('/detail/:id', authMiddleware, requirePage('logs', 'view'), async (req, res) => {
  try {
    const id = req.params.id;
    const log = await M.Log.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : undefined },
        { logTrackId: id }
      ].filter(Boolean)
    }).lean();

    if (!log) return res.status(404).json({ error: 'Log entry not found' });

    let decryptedDetails = log.details;
    let decryptedChanges = log.changes;

    if (log.encryptedPayload) {
      const payload = decryptLog(log.encryptedPayload);
      if (payload && typeof payload === 'object') {
        if (payload.details) decryptedDetails = payload.details;
        if (payload.changes) decryptedChanges = payload.changes;
        if (!log.deviceId && payload.deviceId) log.deviceId = payload.deviceId;
        if (!log.deviceName && payload.deviceName) log.deviceName = payload.deviceName;
        if (!log.deviceInstallId && payload.deviceInstallId) log.deviceInstallId = payload.deviceInstallId;
        if (!log.deviceInfo && payload.deviceInfo) log.deviceInfo = payload.deviceInfo;
      }
    }

    const logTrackId = log.logTrackId || `TR-LOG-${String(log._id).slice(-6).toUpperCase()}`;
    const resolvedTrackId = log.trackId || (
      (log.role === 'system' || log.userName === 'SYSTEM') ? 'TR-SYS-001' : 
      (log.userName === 'START-MENU' ? 'TR-SYS-CLI' : 
      (['admin', 'sudo'].includes(log.role) ? 'TR-ADMIN001' : 'TR-SYS-001'))
    );

    let sessionInfo = null;
    let loc = log.location || null;

    if (log.sessionId) {
      const lh = await M.LoginHistory.findOne({
        $or: [
          ...(resolvedTrackId ? [{ trackId: resolvedTrackId }] : []),
          { "history.sessionId": log.sessionId }
        ]
      }).lean();
      if (lh) {
        const sess = (lh.history || []).find(h => h.sessionId === log.sessionId);
        if (sess) {
          sessionInfo = {
            sessionId: sess.sessionId,
            loginTime: sess.loginTime || sess.time,
            logoutTime: sess.logoutTime || null,
            logoutMethod: sess.logoutMethod || (sess.logoutTime ? 'manual' : null),
            current: sess.current,
            active: sess.active && sess.current === 'Logged In',
            ip: normalizeIp(sess.ip || log.ip),
            deviceType: sess.deviceType || 'Desktop',
            browser: sess.browser || 'Chrome',
            os: sess.os || 'Windows',
            location: sess.location || { address: '', latitude: null, longitude: null }
          };
          if (!loc || (!loc.latitude && !loc.address)) {
            loc = sess.location || null;
          }
        }
      }
    }

    if (!loc) {
      loc = { address: '', latitude: null, longitude: null, accuracy: null };
    }

    res.json({
      ...log,
      logTrackId,
      trackId: resolvedTrackId,
      ip: normalizeIp(log.ip),
      sessionId: log.sessionId || (sessionInfo ? sessionInfo.sessionId : ''),
      location: loc,
      details: decryptedDetails,
      changes: decryptedChanges,
      sessionInfo,
      attendanceClassDaily: log.attendanceClassDaily || undefined
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/logs/page-access — Track client page access
router.post('/page-access', authMiddleware, async (req, res) => {
  try {
    const { page, title, module: clientModule } = req.body;
    if (!page) return res.status(400).json({ error: 'Page is required' });

    const role = req.user.role;
    let mod = clientModule;
    if (!mod) {
      if (isSudo(req)) mod = 'admin';
      else if (role === 'teacher') mod = 'teacher';
      else if (role === 'student') mod = 'student';
      else mod = 'system';
    }

    const actionName = `${mod.charAt(0).toUpperCase() + mod.slice(1)} Page Access`;
    const details = `User navigated to ${title || page} (${page})`;

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username,
      role,
      actionName,
      details,
      'system',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: mod,
        subType: 'page-access',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights
      }
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/logs/export — Decrypted CSV export
router.post('/export', authMiddleware, requirePage('logs', 'export'), async (req, res) => {
  try {
    const { module: modFilter, subType, category, severity, role, from, to, search } = req.body;
    const filter = {};

    if (modFilter && modFilter !== 'all' && modFilter !== 'overview') {
      filter.module = modFilter;
    }
    if (subType && subType !== 'all') filter.subType = subType;
    if (category && category !== 'all') filter.category = category;
    if (severity && severity !== 'all') filter.severity = severity;
    if (role && role !== 'all') filter.role = role;

    if (from || to) {
      filter.time = {};
      if (from) filter.time.$gte = new Date(from + 'T00:00:00.000Z');
      if (to) filter.time.$lte = new Date(to + 'T23:59:59.999Z');
    }

    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      filter.$or = [
        { logTrackId: re },
        { userName: re },
        { action: re },
        { details: re },
        { trackId: re },
        { ip: re }
      ];
    }

    const logs = await M.Log.find(filter).sort({ createdAt: -1 }).limit(1000).lean();

    // Build CSV
    const headers = ['Log ID', 'Timestamp', 'User', 'Role', 'Tracking ID', 'Module', 'Sub-Type', 'Action', 'Severity', 'IP', 'Details'];
    const rows = logs.map(l => {
      let det = l.details;
      if (l.encryptedPayload) {
        const payload = decryptLog(l.encryptedPayload);
        if (payload?.details) det = payload.details;
      }
      const logTrackId = l.logTrackId || `TR-LOG-${String(l._id).slice(-6).toUpperCase()}`;
      const resolvedTrackId = l.trackId || (
        (l.role === 'system' || l.userName === 'SYSTEM') ? 'TR-SYS-001' : 
        (l.userName === 'START-MENU' ? 'TR-SYS-CLI' : 
        (['admin', 'sudo'].includes(l.role) ? 'TR-ADMIN001' : 'TR-SYS-001'))
      );
      return [
        logTrackId,
        new Date(l.time || l.createdAt).toLocaleString('en-IN'),
        `"${(l.userName || '').replace(/"/g, '""')}"`,
        l.role || '',
        resolvedTrackId,
        l.module || '',
        l.subType || '',
        `"${(l.action || '').replace(/"/g, '""')}"`,
        l.severity || 'info',
        normalizeIp(l.ip) || '',
        `"${(det || '').replace(/"/g, '""')}"`
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=EAMS_Audit_Logs_${Date.now()}.csv`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/logs/all
router.delete('/all', authMiddleware, requirePage('logs', 'delete'), async (req, res) => {
  try {
    await M.Log.deleteMany({});
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Logs Cleared',
      'All audit logs purged by administrator',
      'settings',
      'critical',
      req.ip,
      req.user.sessionId,
      { module: 'settings', subType: 'danger', trackId: req.user.trackId }
    );
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/logs/:id
router.delete('/:id', authMiddleware, requirePage('logs', 'delete'), async (req, res) => {
  try {
    await M.Log.findByIdAndDelete(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;