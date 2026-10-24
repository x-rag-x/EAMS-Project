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

const {
  isAdminUser,
  isSudo,
  isSudoAdmin,
  hasInstitutionReach,
  resolveAccess,
  hasSpecial,
  getPrecomputedAccess
} = require('../utils/access');

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
    case 'teacher': return M.Teacher;
    case 'student': return M.Student;
    default:        return null;
  }
}

// Authenticate request using JWT and validate active session
async function authMiddleware(req, res, next) {
  if (req.query && req.query.token) {
    return res.status(401).json({ error: 'Tokens via query parameters are not permitted for security reasons. Use Authorization header.' });
  }

  const header = req.headers.authorization;

  if (!header) { return res.status(401).json({ error: 'No token' }); }

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Invalid Authorization header format' });
  }
  const token = parts[1];

  try {
    const decoded = jwt.verify(token, cfg.JWT_SECRET);

    // Reject board tokens (aud: 'board') from user authentication
    if (decoded.aud === 'board') {
      return res.status(401).json({ error: 'Invalid token type for user session' });
    }

    const model = getRoleModel(decoded.role);
    if (!model) {
      return res.status(401).json({ error: 'Invalid role or stale role token. Please log in again.' });
    }
    const user = await model.findOne({ trackId: decoded.trackId }).select('+mustChangePassword');
    if (!user) { return res.status(401).json({ error: 'User not found' }); }

    let session = await M.LoginSession.findOne({ sessionId: decoded.sessionId }).lean();
    if (!session) {
      // Graceful fallback for legacy sessions created before migration
      const loginHistory = await M.LoginHistory.findOne(
        { trackId: decoded.trackId, 'history.sessionId': decoded.sessionId },
        { 'history.$': 1 }
      ).lean();
      if (loginHistory && loginHistory.history && loginHistory.history[0]) {
        session = loginHistory.history[0];
      }
    }
    if (!session) {
      return res.status(401).json({ error: 'Session not found' });
    }

    if (!session.active) { return res.status(401).json({ error: 'Session expired' }); }
    if (session.logoutAt || session.current === 'Logged Out') { return res.status(401).json({ error: 'Logged out' }); }

    // Enforce session timeout & inactivity rules (§3.9, F17)
    const secSettings = (await getSettings(['security'])).security || {};
    const isStudentDevice = session.sessionClass === 'student-device';
    const isSessionTimeoutEnabled = secSettings.sessionTimeout !== false;
    const timeoutMins = secSettings.sessionTimeoutMins !== undefined ? Number(secSettings.sessionTimeoutMins) : 7;
    const IDLE_TIMEOUT_MS = timeoutMins * 60 * 1000;

    // Inactivity timeout check (when sessionTimeout is true)
    if (isSessionTimeoutEnabled && !isStudentDevice) {
      const lastAct = session.lastActivity ? new Date(session.lastActivity).getTime() : new Date(session.createdAt || session.loginTime || session.time || Date.now()).getTime();
      const idleElapsed = Date.now() - lastAct;
      if (idleElapsed > IDLE_TIMEOUT_MS) {
        M.LoginSession.updateOne(
          { sessionId: decoded.sessionId },
          { $set: { active: false, logoutAt: new Date(), logoutMethod: 'auto' } }
        ).catch(() => {});
        M.LoginHistory.updateOne(
          { trackId: decoded.trackId, 'history.sessionId': decoded.sessionId },
          { $set: { 'history.$.active': false, 'history.$.current': 'Logged Out', 'history.$.logoutTime': new Date(), 'history.$.logoutMethod': 'auto' } }
        ).catch(() => {});
        M.User.updateOne({ trackId: decoded.trackId }, { $set: { online: false } }).catch(() => {});
        return res.status(401).json({ error: 'Session expired due to inactivity. Please log in again.' });
      }
    }

    // Absolute maximum lifetime check
    if (isSessionTimeoutEnabled) {
      const studentDays = secSettings.studentDeviceSessionLifetimeDays !== undefined
        ? Number(secSettings.studentDeviceSessionLifetimeDays)
        : 15;
      const maxSessionHours = isStudentDevice
        ? (studentDays * 24)
        : (secSettings.maxSessionLifetimeHours !== undefined ? Number(secSettings.maxSessionLifetimeHours) : 24);
      const MAX_SESSION_LIFETIME = maxSessionHours * 60 * 60 * 1000;
      const sessionAge = Date.now() - new Date(session.createdAt || session.loginTime || session.time).getTime();
      if (sessionAge > MAX_SESSION_LIFETIME) {
        M.LoginSession.updateOne(
          { sessionId: decoded.sessionId },
          { $set: { active: false, logoutAt: new Date(), logoutMethod: 'forced' } }
        ).catch(() => {});
        M.LoginHistory.updateOne(
          { trackId: decoded.trackId, 'history.sessionId': decoded.sessionId },
          { $set: { 'history.$.active': false, 'history.$.current': 'Logged Out', 'history.$.logoutTime': new Date(), 'history.$.logoutMethod': 'forced' } }
        ).catch(() => {});
        M.User.updateOne({ trackId: decoded.trackId }, { $set: { online: false } }).catch(() => {});
        return res.status(401).json({ error: 'Session maximum lifetime exceeded. Please login again due to security reasons.' });
      }
    }

    // Device revocation hook (§6, T3.4): revoking the device kills the session at next call
    if (isStudentDevice && session.deviceTrackId) {
      const devDoc = await M.StudentDevice.findOne({ deviceTrackId: session.deviceTrackId }).select('status').lean();
      if (!devDoc || devDoc.status !== 'TRUSTED') {
        M.LoginSession.updateOne(
          { sessionId: decoded.sessionId },
          { $set: { active: false, logoutAt: new Date(), logoutMethod: 'forced' } }
        ).catch(() => {});
        return res.status(401).json({ error: 'Device has been revoked or replaced. Please sign in again.', code: 'DEVICE_REVOKED' });
      }
    }

    // For each API call: extend logout time and update lastActivity
    const newExpiresAt = isSessionTimeoutEnabled
      ? new Date(Date.now() + IDLE_TIMEOUT_MS)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    M.LoginSession.updateOne(
      { sessionId: decoded.sessionId },
      { $set: { expiresAt: newExpiresAt, lastActivity: new Date() } }
    ).catch(() => {});
    M.LoginHistory.updateOne(
      { trackId: decoded.trackId, 'history.sessionId': decoded.sessionId },
      { $set: { 'history.$.expiresAt': newExpiresAt, 'history.$.lastActivity': new Date() } }
    ).catch(() => {});

    const userObj = user.toObject();
    const specials = Array.isArray(userObj.specials) ? userObj.specials : [];
    const access = resolveAccess(userObj, { env: cfg.NODE_ENV });
    req.access = access;

    const fName = (userObj.firstName || '').trim();
    const lName = (userObj.lastName || '').trim();
    const firstLastName = (fName && lName) ? `${fName} ${lName}` : (fName || lName);
    const resolvedName = firstLastName || (userObj.fullName || '').trim() || userObj.username;

    if (session.sessionId && session.location) {
      sessionLocationMap.set(session.sessionId, session.location);
    }

    const isPrincipal = Boolean(access.isPrincipal || specials.some(s => s.option === 'isPrincipal') || userObj.isPrincipal === true);

    req.user = {
      ...userObj,
      name:      resolvedName,
      firstName: fName,
      lastName:  lName,
      fullName:  userObj.fullName || resolvedName,
      role:      decoded.role,
      sessionId: decoded.sessionId,
      location:  session.location || null,
      isAdmin:   access.isAdmin,
      isSudoAdmin: access.isSudoAdmin,
      isSuperAdmin: access.isSuperAdmin,
      isSubAdmin: access.isSubAdmin,
      accessRole: access.tier,
      landing: access.landing,
      redirectTo: access.landing,
      hasInstitutionReach: access.hasInstitutionReach,
      pageRights: access.pageRights,
      rawPageRights: userObj.pageRights,
      adminFlag: access.adminFlag,
      access: access.access,
      pages: access.pages,
      isTimeTableCoordinator: specials.some(s => s.option === 'isTimeTableCoordinator' && s.value !== false && s.value !== 'false') || userObj.isTimeTableCoordinator === true || access.isTimeTableCoordinator === true,
      TTdeptName: (() => {
        const s = specials.find(x => x.option === 'isTimeTableCoordinator');
        if (!s) return '';
        if (typeof s.value === 'string' && s.value.trim() && s.value !== 'true') return s.value.trim();
        if (typeof s.key === 'string' && s.key.trim() && !s.key.startsWith('isTimeTableCoordinator') && s.key !== 'true') return s.key.trim();
        return (userObj.department || userObj.deptName || '').trim();
      })(),
      isPrincipal:         isPrincipal,
      isHod:               specials.some(s => s.option === 'isHod'),
      isClassAdvisor:      specials.some(s => s.option === 'isClassAdvisor'),
      isWarden:            specials.some(s => s.option === 'isWarden'),
      isExamCoordinator:   specials.some(s => s.option === 'isExamCoordinator'),
      isPlacementCoordinator: specials.some(s => s.option === 'isPlacementCoordinator'),
      actingWithAdminRights: specials.some(s => ['isPrincipal', 'isHod', 'isClassAdvisor', 'isWarden', 'isExamCoordinator', 'isPlacementCoordinator', 'isTimeTableCoordinator'].includes(s.option)) || access.isAdmin,
      bootstrapPending: Boolean(userObj.bootstrapPending),
    };
    req.session = session;

    // Check bootstrap pending gate (§9, R3.1)
    if (req.user.bootstrapPending) {
      const origUrl = req.originalUrl || req.url || '';
      const isAllowedBootstrapEndpoint =
        origUrl.startsWith('/api/auth') ||
        origUrl.startsWith('/api/bootstrap') ||
        origUrl === '/api/settings/public';

      if (!isAllowedBootstrapEndpoint) {
        return res.status(403).json({
          error: 'Bootstrap required: Please complete the initial setup wizard.',
          code: 'BOOTSTRAP_REQUIRED',
          bootstrapPending: true
        });
      }
    }

    // Check system maintenance and portal access permissions
    const isLogout = req.path === '/logout' || req.originalUrl?.includes('/auth/logout');
    if (!isLogout && !access.exempt?.maintenance) {
      const settings = await getSettings(['pages', 'maintenance']);
      const pages = settings.pages || {};
      const maint = settings.maintenance || {};

      // Verify maintenance mode status (Sudo Admin + Super Admin are exempt per §3.6)
      if (maint.active) {
        const affected = maint.affectedRoles?.length ? maint.affectedRoles : ['teacher', 'student'];
        if (affected.includes(decoded.role) && !access.exempt?.maintenance) {
          return res.status(503).json({
            error: maint.message || 'System is under maintenance.',
            maintenance: true,
            message: maint.message || 'System under maintenance.',
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
            error: 'Students Login are paused temporary.',
            code: 'STUDENTS_LOGIN_PAUSED',
            portalDisabled: true,
            portal: 'student'
          });
        }
      }

      // Verify teacher portal access permissions: anyone holding admin grants is exempt (§3.6)
      const hasAdminGrants = access.isAdmin || access.flags?.isSudo || access.flags?.isSuper || access.flags?.isSub;
      if (decoded.role === 'teacher' && !hasAdminGrants) {
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
      M.LoginSession.updateOne(
        { sessionId: decoded.sessionId },
        { $set: { lastActivity: new Date() } }
      ).catch(() => {});
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
  if (hasInstitutionReach(req.user)) return next();
  return res.status(403).json({ error: 'Admin access required' });
}

async function logsAdminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (isSudoAdmin(req.user)) return next();

  if (isAdminUser(req.user)) {
    const secSettings = await M.Settings.findOne({ key: 'security' }).lean();
    if (secSettings?.value?.allowSubAdminLogs === true) {
      return next();
    }
  }
  return res.status(403).json({ error: 'Access denied. Logs are strictly restricted to system administrators.' });
}

function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (roles.includes(req.user.role)) return next();
    if (roles.includes('admin') && isAdminUser(req.user)) return next();
    return res.status(403).json({ error: `Access denied. Required role: ${roles.join(' or ')}` });
  };
}

const { requirePage, scopeFilter, assertInScope } = require('./pageAccess');

module.exports = {
  authMiddleware,
  adminOnly,
  logsAdminOnly,
  requireRole,
  getRoleModel,
  getSessionLocation,
  isSudo,
  requirePage,
  scopeFilter,
  assertInScope
};

