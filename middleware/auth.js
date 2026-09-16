const jwt = require('jsonwebtoken');
const cfg = require('../config');
const M = require('../models');
const { getSettings } = require('../utils/settingsCache');

// Throttle DB activity writes to at most once per 60 seconds per session
const ACTIVITY_DB_WRITE_INTERVAL_MS = 60 * 1000;
const sessionActivityWriteMap = new Map();
const sessionLocationMap = new Map();

function getSessionLocation(sessionId) {
  if (!sessionId) return null;
  return sessionLocationMap.get(sessionId) || null;
}

// Periodic cleanup to avoid memory growth for stale sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of sessionActivityWriteMap.entries()) {
    if (now - timestamp > 2 * 60 * 60 * 1000) {
      sessionActivityWriteMap.delete(key);
    }
  }
}, 30 * 60 * 1000).unref();

function getRoleModel(role) {
  switch (role) {
    case 'admin':   return M.Admin;
    case 'teacher': return M.Teacher;
    case 'student': return M.Student;
    default:        return null;
  }
}

// Authenticate request using JWT and validate active session
async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || (req.query && req.query.token ? `Bearer ${req.query.token}` : null);

  if (!header) { return res.status(401).json({ error: 'No token' }); }

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Invalid Authorization header format' });
  }
  const token = parts[1];

  try {
    const decoded = jwt.verify(token, cfg.JWT_SECRET);

    const model = getRoleModel(decoded.role);
    const user = await model.findOne({ trackId: decoded.trackId }).select('+mustChangePassword');
    if (!user) { return res.status(401).json({ error: 'User not found' }); }

    const loginHistory = await M.LoginHistory.findOne({ trackId: decoded.trackId });
    if (!loginHistory) { return res.status(401).json({ error: 'User not found' }); }

    const session = loginHistory.history.find(h => h.sessionId === decoded.sessionId);
    if (!session) { return res.status(401).json({ error: 'Session not found' }); }
    if (!session.active) { return res.status(401).json({ error: 'Session expired' }); }
    if (session.current === 'Logged Out') { return res.status(401).json({ error: 'Logged out' }); }

    // Enforce absolute maximum session lifetime of 1 hours
    const MAX_SESSION_LIFETIME = 1 * 60 * 60 * 1000;
    const sessionAge = Date.now() - new Date(session.createdAt || session.loginTime || session.time).getTime();
    if (sessionAge > MAX_SESSION_LIFETIME) {
      session.active = false;
      session.current = 'Logged Out';
      session.logoutTime = new Date();
      loginHistory.save().catch(() => {});
      await M.User.updateOne({ trackId: decoded.trackId }, { $set: { online: false } });
      return res.status(401).json({ error: 'Session maximum lifetime exceeded. Please login again due to security reasons.' });
    }

    if (session.expiresAt - Date.now() <= 5 * 60 * 1000) {
      session.expiresAt = new Date(session.expiresAt.getTime() + 10 * 60 * 1000);
    }
    if (session.expiresAt < new Date()) { return res.status(401).json({ error: 'Session expired' }); }

    const userObj = user.toObject();
    const specials = Array.isArray(userObj.specials) ? userObj.specials : [];
    const isTeacherAdmin = !!userObj.isAdmin || (Array.isArray(userObj.adminRights) && userObj.adminRights.length > 0 && !userObj.adminRights.every(r => r === 'none'));

    const fName = (userObj.firstName || '').trim();
    const lName = (userObj.lastName || '').trim();
    const firstLastName = (fName && lName) ? `${fName} ${lName}` : (fName || lName);
    const resolvedName = firstLastName || (userObj.fullName || '').trim() || userObj.username;

    if (session.sessionId && session.location) {
      sessionLocationMap.set(session.sessionId, session.location);
    }

    req.user = {
      ...userObj,
      name:      resolvedName,
      firstName: fName,
      lastName:  lName,
      fullName:  userObj.fullName || resolvedName,
      role:      decoded.role,
      sessionId: decoded.sessionId,
      location:  session.location || null,
      isAdmin:   decoded.role === 'admin' || isTeacherAdmin,
      isTimeTableCoordinator: specials.some(s => s.option === 'isTimeTableCoordinator'),
      TTdeptName: (() => {
        const s = specials.find(x => x.option === 'isTimeTableCoordinator');
        if (!s) return '';
        if (typeof s.value === 'string' && s.value.trim() && s.value !== 'true') return s.value.trim();
        if (typeof s.key === 'string' && s.key.trim() && !s.key.startsWith('isTimeTableCoordinator') && s.key !== 'true') return s.key.trim();
        return (userObj.department || userObj.deptName || '').trim();
      })(),
      isHod:               specials.some(s => s.option === 'isHod'),
      isClassAdvisor:      specials.some(s => s.option === 'isClassAdvisor'),
      isWarden:            specials.some(s => s.option === 'isWarden'),
      isExamCoordinator:   specials.some(s => s.option === 'isExamCoordinator'),
      isPlacementCoordinator: specials.some(s => s.option === 'isPlacementCoordinator'),
      actingWithAdminRights: specials.some(s => ['isHod', 'isClassAdvisor', 'isWarden', 'isExamCoordinator', 'isPlacementCoordinator', 'isTimeTableCoordinator'].includes(s.option)) || isTeacherAdmin,
    };
    req.session = session;

    // Check system maintenance and portal access permissions
    const isLogout = req.path === '/logout' || req.originalUrl?.includes('/auth/logout');
    if (!isLogout && decoded.role !== 'admin') {
      const settings = await getSettings(['pages', 'maintenance']);
      const pages = settings.pages || {};
      const maint = settings.maintenance || {};

      // Verify maintenance mode status
      if (maint.active) {
        const affected = maint.affectedRoles?.length ? maint.affectedRoles : ['teacher', 'student'];
        if (affected.includes(decoded.role) && !isTeacherAdmin) {
          return res.status(503).json({
            error: maint.message || 'System is under maintenance.',
            maintenance: true,
            message: maint.message || 'System is under maintenance.',
            affectedRoles: affected,
            endTime: maint.endTime || null,
            startedAt: maint.startedAt || null,
          });
        }
      }

      // Verify student portal access permissions
      if (decoded.role === 'student') {
        const pageStudents = pages.pageStudents !== undefined ? pages.pageStudents : 'enabled';
        if (pageStudents === 'disabled' || pageStudents === 'hidden' || pageStudents === false) {
          return res.status(403).json({
            error: 'Student Portal is currently disabled by administrator.',
            portalDisabled: true,
            portal: 'student'
          });
        }
      }

      // Verify teacher portal access permissions
      if (decoded.role === 'teacher' && !isTeacherAdmin) {
        const pageTeachers = pages.pageTeachers !== undefined ? pages.pageTeachers : 'enabled';
        if (pageTeachers === 'disabled' || pageTeachers === 'hidden' || pageTeachers === false) {
          return res.status(403).json({
            error: 'Teacher Portal is currently disabled by administrator.',
            portalDisabled: true,
            portal: 'teacher'
          });
        }
      }
    }

    // Update in-memory session lastActivity immediately
    session.lastActivity = new Date();

    // Throttle database writes to MongoDB LoginHistory (at most once every 60 seconds per session)
    const now = Date.now();
    const sessionKey = `${decoded.trackId}_${decoded.sessionId}`;
    const lastDbWrite = sessionActivityWriteMap.get(sessionKey) || 0;

    if (now - lastDbWrite >= ACTIVITY_DB_WRITE_INTERVAL_MS) {
      sessionActivityWriteMap.set(sessionKey, now);
      M.LoginHistory.updateOne(
        { trackId: decoded.trackId, "history.sessionId": decoded.sessionId },
        { $set: { "history.$.lastActivity": new Date() } }
      ).catch(function () {
        // Non-fatal background activity update — silently ignore transient socket disconnects/ECONNRESET
      });
    }

    next();

  } catch (err) {
    if (err.name === 'MongoServerSelectionError' || err.name === 'MongoNetworkError' || err.name === 'MongooseError' || err.message?.includes('ENOTFOUND') || err.message?.includes('ECONNREFUSED') || err.message?.includes('ECONNRESET')) {
      console.warn('[EAMS Auth DB Offline/Transient]:', err.message);
      return res.status(503).json({ error: 'Database connection temporarily interrupted. Please retry in a moment.', dbOffline: true });
    }
    if (err.name !== 'TokenExpiredError' && err.name !== 'JsonWebTokenError') {
      console.error('[EAMS Auth Error]:', err);
    }
    return res.status(401).json({ error: 'Invalid token', expired: err.name === 'TokenExpiredError' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role === 'admin') return next();
  if (req.user.role === 'teacher' && req.user.isAdmin === true) return next();
  return res.status(403).json({ error: 'Admin access required' });
}

async function logsAdminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role === 'admin') return next();

  if (req.user.role === 'teacher' && req.user.isAdmin === true) {
    const secSettings = await M.Settings.findOne({ key: 'security' }).lean();
    if (secSettings?.value?.allowSubAdminLogs === true) {
      return next();
    }
  }
  return res.status(403).json({ error: 'Access denied. Logs are strictly restricted to system administrators.' });
}

function requireRight(...rights) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'admin') return next();

    if (req.user.role === 'teacher' && req.user.isAdmin === true) {
      const userRights = req.user.adminRights;
      if (userRights === 'all' || (Array.isArray(userRights) && userRights.includes('all'))) {
        return next();
      }
      if (Array.isArray(userRights) && rights.some(r => userRights.includes(r))) {
        return next();
      }
    }
    return res.status(403).json({ error: `Forbidden. Requires permission: ${rights.join(' or ')}` });
  };
}

module.exports = { authMiddleware, adminOnly, logsAdminOnly, requireRight, getRoleModel, getSessionLocation };
