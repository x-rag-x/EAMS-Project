const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cfg = require('../config');
const M = require('../models');
const rateLimit = require('express-rate-limit');
const { authMiddleware, getRoleModel } = require('../middleware/auth');
const { logAction, parseUserAgent, normalizeIp } = require('../utils/logAction');
const { authLimiter } = require('../utils/rateLimiters');
const { validatePassword } = require('../utils/passwordValidator');

const { reverseGeocode } = require('../utils/reverseGeocode');
const { getSettings } = require('../utils/settingsCache');

function getClientDetails(req) {
  const headers = req.headers || {};
  const rawIp =
    headers['cf-connecting-ip'] ||
    headers['x-real-ip'] ||
    headers['x-client-ip'] ||
    headers['x-forwarded-for'] ||
    req.ip ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    '127.0.0.1';

  const ip = normalizeIp(rawIp);
  const userAgent = headers['user-agent'] || '';
  const { deviceType, browser, os } = parseUserAgent(userAgent);
  return { ip, userAgent, deviceType, browser, os };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: cfg.NODE_ENV === 'development' ? Number.MAX_SAFE_INTEGER : 10, // Limit each IP to 10 requests per 15 minutes (disabled in development)
  message: { error: 'Too many login attempts from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Verify user credentials before requesting location permissions
router.post('/verify-credentials', loginLimiter, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Username, password and role are required' });
    }

    const model = getRoleModel(role);
    if (!model) return res.status(400).json({ error: 'Invalid role' });

    const cleanUsername = username.toLowerCase().trim();
    const [shadowUser, userDoc, settingsMap, loginHistory] = await Promise.all([
      M.User.findOne({ username: cleanUsername, role }),
      model.findOne({ username: cleanUsername }).select('+password'),
      getSettings(['security', 'pages', 'maintenance']),
      M.LoginHistory.findOne({ username: cleanUsername }).lean()
    ]);

    if (!shadowUser || !userDoc) {
      await logAction(null, username, role, 'Login Failed', 'User not found', 'security', 'warning', req.ip, '', { module: 'system', subType: 'auth-fail' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const security = settingsMap.security || {};
    const maxAttempts = security.maxLoginAttempts || 3;
    const lockoutMins = security.lockoutDurationMins || 15;
    const isAdmin = role === 'admin' || shadowUser.role === 'admin';

    if (!isAdmin && shadowUser.status === 'locked') {
      if (loginHistory?.lockedUntil && new Date(loginHistory.lockedUntil) > new Date()) {
        const remainingTimeMs = new Date(loginHistory.lockedUntil) - new Date();
        const remainingTimeMins = Math.ceil(remainingTimeMs / 60000);
        return res.status(401).json({ error: `Account locked. Try again in ${remainingTimeMins} minute(s).` });
      } else {
        await Promise.all([
          M.User.updateOne({ _id: shadowUser._id }, { $set: { status: 'active' } }),
          M.LoginHistory.updateOne({ trackId: shadowUser.trackId }, { $set: { failedLogins: 0, lockedUntil: null } })
        ]);
      }
    }

    if (!isAdmin && shadowUser.status !== 'active') {
      await logAction(shadowUser.trackId || shadowUser._id, shadowUser.username, role, 'Login Failed', `User is ${shadowUser.status}`, 'security', 'warning', req.ip, '', { module: 'system', subType: 'auth-fail' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, userDoc.password);
    if (!match) {
      const newFailed = (loginHistory?.failedLogins || 0) + 1;
      if (!isAdmin && newFailed >= maxAttempts) {
        const lockedUntil = new Date(Date.now() + lockoutMins * 60 * 1000);
        await Promise.all([
          M.User.updateOne({ _id: shadowUser._id }, { $set: { status: 'locked' } }),
          M.LoginHistory.updateOne(
            { trackId: shadowUser.trackId },
            { $set: { lockedUntil, failedLogins: newFailed, username: cleanUsername, role } },
            { upsert: true }
          ),
          logAction(shadowUser.trackId || shadowUser._id, shadowUser.username, role, 'Login Failed (Locked)', 'Wrong password, account locked', 'security', 'warning', req.ip, '', { module: 'system', subType: 'auth-fail' })
        ]);
        return res.status(401).json({ error: `Account locked due to too many failed attempts. Try again in ${lockoutMins} minute(s).` });
      }
      await Promise.all([
        M.LoginHistory.updateOne(
          { trackId: shadowUser.trackId },
          { $set: { failedLogins: newFailed, username: cleanUsername, role } },
          { upsert: true }
        ),
        logAction(shadowUser.trackId || shadowUser._id, shadowUser.username, role, 'Login Failed', 'Wrong password', 'security', 'warning', req.ip, '', { module: 'system', subType: 'auth-fail' })
      ]);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({ valid: true, username: shadowUser.username, role });
  } catch (err) {
    console.error('[Verify Credentials Exception]:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Record location permission rejection and enforce 1-minute timeout lockout
router.post('/location-denied', async (req, res) => {
  try {
    const { username, role, reason } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    const cleanUsername = username.toLowerCase().trim();
    const shadowUser = await M.User.findOne({ username: cleanUsername, role });

    if (!shadowUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isAdmin = role === 'admin' || shadowUser.role === 'admin';
    if (isAdmin) {
      await logAction(
        shadowUser.trackId || shadowUser._id,
        shadowUser.username,
        role || 'admin',
        'Location Not Provided (Admin Exemption)',
        'Admin bypassed location requirement: ' + (reason || 'No coordinates'),
        'security',
        'info',
        req.ip,
        '',
        { module: 'system', subType: 'auth-info', trackId: shadowUser.trackId }
      );
      return res.json({ message: 'Admin location exemption recorded', locationLocked: false });
    }

    // 1-Hour Lockout for non-admin roles who deny location access or exceed the 1-minute timeout
    const lockoutMins = 60;
    const lockedUntil = new Date(Date.now() + lockoutMins * 60 * 1000);

    await Promise.all([
      M.User.updateOne({ _id: shadowUser._id }, { $set: { status: 'locked' } }),
      M.LoginHistory.updateOne(
        { trackId: shadowUser.trackId },
        { $set: { lockedUntil, username: cleanUsername, role, failedLogins: 1 } },
        { upsert: true }
      ),
      logAction(
        shadowUser.trackId || shadowUser._id,
        shadowUser.username,
        role || 'user',
        'Location Access Denied / Timed Out (Account Locked)',
        'User failed to grant location access within 1 minute. Account locked for 1 hour: ' + (reason || 'Permission denied or timed out'),
        'security',
        'error',
        req.ip,
        '',
        { module: 'system', subType: 'security-lock', trackId: shadowUser.trackId }
      )
    ]);

    res.json({
      message: 'Account locked for 1 hour due to denied location permission or 1-minute timeout.',
      locationLocked: true,
      lockedUntil: lockedUntil
    });
  } catch (err) {
    console.error('[Location Denied Lockout Error]:', err);
    res.status(500).json({ error: 'Failed to process location info' });
  }
});

// Authenticate user and initialize active session
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password, role, latitude, longitude, accuracy } = req.body;
    if (!username || !password || !role)
      return res.status(400).json({ error: 'username, password and role required' });

    const model = getRoleModel(role);
    if (!model) return res.status(400).json({ error: 'Invalid role' });

    const cleanUsername = username.toLowerCase().trim();

    // Parallel fetch user shadow record, role profile, cached settings, and login history
    const [shadowUser, userDoc, settingsMap, loginHistory] = await Promise.all([
      M.User.findOne({ username: cleanUsername, role }),
      model.findOne({ username: cleanUsername }).select('+password'),
      getSettings(['security', 'pages', 'advanced', 'maintenance']),
      M.LoginHistory.findOne({ trackId: cleanUsername }).lean().then(lh => lh || M.LoginHistory.findOne({ username: cleanUsername }).lean())
    ]);

    if (!shadowUser || !userDoc) {
      await logAction(null, username, role, 'Login Failed', 'User not found', 'security', 'warning', req.ip, '', { module: 'system', subType: 'auth-fail' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const security = settingsMap.security || {};
    const pages = settingsMap.pages || {};
    const advanced = settingsMap.advanced || {};
    const maintenance = settingsMap.maintenance || {};

    const maxAttempts = security.maxLoginAttempts || 3;
    const lockoutMins = security.lockoutDurationMins || 15;
    const isAdmin = role === 'admin' || shadowUser.role === 'admin';

    // Verify account lockout status and auto-recover expired lockouts
    if (!isAdmin && shadowUser.status === 'locked') {
      if (loginHistory?.failedLogins >= 90 || !loginHistory?.lockedUntil || new Date(loginHistory.lockedUntil) <= new Date()) {
        await Promise.all([
          M.User.updateOne({ _id: shadowUser._id }, { $set: { status: 'active' } }),
          M.LoginHistory.updateOne({ trackId: shadowUser.trackId }, { $set: { failedLogins: 0, lockedUntil: null } })
        ]);
        shadowUser.status = 'active';
      } else {
        const remainingTimeMs = new Date(loginHistory.lockedUntil) - new Date();
        const remainingTimeMins = Math.ceil(remainingTimeMs / 60000);
        return res.status(401).json({ error: `Account locked due to failed password attempts. Try again in ${remainingTimeMins} minute(s).` });
      }
    }

    if (!isAdmin && shadowUser.status !== 'active') {
      await logAction(shadowUser.trackId || shadowUser._id, shadowUser.username, role, 'Login Failed', `User is ${shadowUser.status}`, 'security', 'warning', req.ip, '', { module: 'system', subType: 'auth-fail' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check system maintenance status for non-admin roles
    if (!isAdmin && maintenance.active) {
      const affected = maintenance.affectedRoles?.length ? maintenance.affectedRoles : ['teacher', 'student'];
      if (affected.includes(role)) {
        return res.status(503).json({
          error: maintenance.message || 'System under maintenance.',
          maintenance: true,
          message: maintenance.message || 'System under maintenance.',
          affectedRoles: affected,
          endTime: maintenance.endTime || null,
          startedAt: maintenance.startedAt || null,
        });
      }
    }

    // Check portal enabled status from system settings
    if (role === 'student') {
      const studentState = pages.pageStudents !== undefined ? pages.pageStudents : 'enabled';
      if (studentState === 'disabled' || studentState === 'hidden' || studentState === false) {
        await logAction(shadowUser.trackId || shadowUser._id, shadowUser.username, role, 'Login Blocked (Portal Disabled)', 'Student portal is disabled by administrator', 'security', 'warning', req.ip, '', { module: 'system', subType: 'auth-block' });
        return res.status(403).json({
          error: 'Student Portal is currently disabled by administrator.',
          portalDisabled: true,
          portal: 'student'
        });
      }
    }

    if (role === 'teacher') {
      const isTeacherAdmin = !!userDoc.isAdmin || (Array.isArray(userDoc.adminRights) && userDoc.adminRights.length > 0 && !userDoc.adminRights.every(r => r === 'none'));
      const teacherState = pages.pageTeachers !== undefined ? pages.pageTeachers : 'enabled';
      if (!isTeacherAdmin && (teacherState === 'disabled' || teacherState === 'hidden' || teacherState === false)) {
        await logAction(shadowUser.trackId || shadowUser._id, shadowUser.username, role, 'Login Blocked (Portal Disabled)', 'Teacher portal is disabled by administrator', 'security', 'warning', req.ip, '', { module: 'system', subType: 'auth-block' });
        return res.status(403).json({
          error: 'Teacher Portal is currently disabled by administrator.',
          portalDisabled: true,
          portal: 'teacher'
        });
      }
    }

    // Compare password against stored hash
    const match = await bcrypt.compare(password, userDoc.password);
    if (!match) {
      const newFailed = (loginHistory?.failedLogins || 0) + 1;
      if (!isAdmin && newFailed >= maxAttempts) {
        const lockedUntil = new Date(Date.now() + lockoutMins * 60 * 1000);
        await Promise.all([
          M.User.updateOne({ _id: shadowUser._id }, { $set: { status: 'locked' } }),
          M.LoginHistory.updateOne(
            { trackId: shadowUser.trackId },
            { $set: { lockedUntil, failedLogins: newFailed, username: cleanUsername, role } },
            { upsert: true }
          ),
          logAction(shadowUser.trackId || shadowUser._id, shadowUser.username, role, 'Login Failed (Locked)', 'Wrong password, account locked', 'security', 'warning', req.ip, '', { module: 'system', subType: 'auth-fail' })
        ]);
        return res.status(401).json({ error: `Account locked due to too many failed attempts. Try again in ${lockoutMins} minute(s).` });
      }
      await Promise.all([
        M.LoginHistory.updateOne(
          { trackId: shadowUser.trackId },
          { $set: { failedLogins: newFailed, username: cleanUsername, role } },
          { upsert: true }
        ),
        logAction(shadowUser.trackId || shadowUser._id, shadowUser.username, role, 'Login Failed', 'Wrong password', 'security', 'warning', req.ip, '', { module: 'system', subType: 'auth-fail' })
      ]);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create JWT authentication token and session record
    let durationMins = security.sessionTimeoutMins || 60;
    const expiresAt = new Date(Date.now() + durationMins * 60 * 1000);
    const clientDetails = getClientDetails(req);
    const sessionId = crypto.randomBytes(16).toString('hex');
    
    const hasCoords = latitude !== undefined && longitude !== undefined;
    const initialLocationAddress = hasCoords ? `${Number(latitude).toFixed(4)}, ${Number(longitude).toFixed(4)}` : '';

    const token = jwt.sign(
      {
        _id: shadowUser._id,
        roleId: userDoc._id,
        name: userDoc.fullName || userDoc.name || '',
        username: userDoc.username,
        role: role,
        trackId: userDoc.trackId,
        dept: userDoc.department || userDoc.deptName || '',
        empId: userDoc.employeeNo || '',
        desig: userDoc.designation || '',
        regNo: userDoc.registerNo || '',
        sessionId,
      },
      cfg.JWT_SECRET,
      { expiresIn: cfg.JWT_EXPIRES_IN || '24h' }
    );
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const historyObj = {
      sessionId: sessionId,
      time: new Date(),
      current: 'Logged In',
      ip: clientDetails.ip,
      userAgent: clientDetails.userAgent,
      loginTime: new Date(),
      logoutTime: null,
      logoutMethod: null,
      deviceType: clientDetails.deviceType,
      browser: clientDetails.browser,
      os: clientDetails.os,
      status: 'success',
      location: {
        latitude: latitude !== undefined ? Number(latitude) : undefined,
        longitude: longitude !== undefined ? Number(longitude) : undefined,
        accuracy: accuracy !== undefined ? Number(accuracy) : undefined,
        address: initialLocationAddress
      },
      authToken: tokenHash,
      createdAt: new Date(),
      active: true,
      expiresAt: expiresAt,
      lastActivity: new Date()
    };

    // Manage single session concurrency and push session record
    const isMultiAdmin = role === 'admin' && advanced.multiAdminSession !== false;
    const terminatePriorPromise = !isMultiAdmin ? M.LoginHistory.updateOne(
      { trackId: shadowUser.trackId },
      { $set: { "history.$[h].active": false, "history.$[h].current": "Logged Out", "history.$[h].logoutTime": new Date(), "history.$[h].logoutMethod": "forced" } },
      { arrayFilters: [{ "h.active": true }] }
    ) : Promise.resolve();

    const saveSessionPromise = M.LoginHistory.updateOne(
      { trackId: shadowUser.trackId },
      {
        $inc: { totalLogins: 1 },
        $set: {
          username: shadowUser.username,
          role: role,
          lastLogin: new Date(),
          failedLogins: 0,
          lockedUntil: null
        },
        $setOnInsert: { firstLogin: new Date() },
        $push: {
          history: {
            $each: [historyObj],
            $slice: -100 // Cap history to last 100 sessions to keep documents fast and small
          }
        }
      },
      { upsert: true }
    );

    const updateUserPromise = M.User.updateOne(
      { trackId: userDoc.trackId },
      { $set: { status: 'active', online: true } }
    );

    const userFirstLastName = (userDoc.firstName && userDoc.lastName)
      ? `${userDoc.firstName} ${userDoc.lastName}`.trim()
      : (userDoc.fullName || userDoc.username);

    const logActionPromise = logAction(
      shadowUser._id,
      userFirstLastName,
      role,
      'Login',
      `User logged in successfully${initialLocationAddress ? ` from ${initialLocationAddress}` : ''}`,
      'security',
      'info',
      clientDetails.ip,
      sessionId,
      {
        module: role === 'admin' ? 'admin' : (role === 'teacher' ? 'teacher' : 'student'),
        subType: 'session',
        trackId: userDoc.trackId,
        location: historyObj.location
      }
    );

    // Execute database writes concurrently
    await Promise.all([
      terminatePriorPromise,
      saveSessionPromise,
      updateUserPromise,
      logActionPromise
    ]);

    // Reverse geocode coordinates asynchronously in background
    if (hasCoords) {
      setImmediate(async () => {
        try {
          const resolvedAddress = await reverseGeocode(latitude, longitude);
          if (resolvedAddress && resolvedAddress !== initialLocationAddress) {
            await Promise.all([
              M.LoginHistory.updateOne(
                { trackId: shadowUser.trackId, "history.sessionId": sessionId },
                { $set: { "history.$.location.address": resolvedAddress } }
              ),
              M.Log.updateOne(
                { sessionId: sessionId, action: 'Login' },
                { $set: { details: `User logged in successfully from ${resolvedAddress}` } }
              )
            ]);
          }
        } catch (bgErr) {
          // Suppress non-critical background geocoding error
        }
      });
    }

    const bypassSelector = pages.pageSelector === 'disabled' || pages.pageSelector === 'hidden';

    const specialsArr = Array.isArray(userDoc.specials) ? userDoc.specials : [];
    const isHod = role === 'teacher' ? specialsArr.some(s => s.option === 'isHod') : false;
    const ttSpecial = specialsArr.find(s => s.option === 'isTimeTableCoordinator');
    const isTimeTableCoordinator = role === 'teacher' ? !!ttSpecial : false;
    let TTdeptName = '';
    if (ttSpecial) {
      if (typeof ttSpecial.value === 'string' && ttSpecial.value.trim() && ttSpecial.value !== 'true') {
        TTdeptName = ttSpecial.value.trim();
      } else if (typeof ttSpecial.key === 'string' && ttSpecial.key.trim() && !ttSpecial.key.startsWith('isTimeTableCoordinator') && ttSpecial.key !== 'true') {
        TTdeptName = ttSpecial.key.trim();
      } else {
        TTdeptName = (userDoc.department || userDoc.deptName || '').trim();
      }
    }

    res.json({
      token,
      sessionId,
      mustChangePassword: !!userDoc.mustChangePassword,
      bypassSelector,
      user: {
        _id: shadowUser._id,
        name: userDoc.fullName || userDoc.name || '',
        username: userDoc.username,
        role,
        active: true,
        dept: userDoc.department || userDoc.deptName || '',
        deptCode: userDoc.deptCode || '',
        mustChangePassword: !!userDoc.mustChangePassword,
        isAdmin: role === 'admin' ? true : (!!userDoc.isAdmin),
        adminRights: role === 'admin' ? (userDoc.adminRights || 'all') : (userDoc.adminRights || []),
        adminFlag: role === 'admin' ? (userDoc.adminFlag || 'superadmin') : 'none',
        isHod,
        isTimeTableCoordinator,
        TTdeptName,
        specials: specialsArr,
      }
    });
  } catch (err) {
    console.error('[EAMS Login Exception]:', err);
    res.status(500).json({ error: 'Login failed, try again' });
  }
});

router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const { trackId, sessionId } = req.user;
    const method = req.body && req.body.method === 'auto' ? 'auto' : 'manual';

    // Update login history with logout timestamp and method
    await M.LoginHistory.updateOne(
      { trackId: trackId, "history.sessionId": sessionId },
      {
        $set: {
          "history.$.logoutTime": new Date(),
          "history.$.logoutMethod": method,
          "history.$.current": "Logged Out",
          "history.$.active": false
        }
      }
    );

    // Update user online status
    await M.User.updateOne({ trackId: trackId }, { $set: { online: false } });

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.post('/ping', authMiddleware, async (req, res) => {
  res.json({ success: true, expiresAt: req.session.expiresAt });
});

router.post('/change-password', authLimiter, authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both current password and new password are required' });
    }

    const model = getRoleModel(req.user.role);
    if (!model) return res.status(400).json({ error: 'Invalid role model' });

    const user = await model.findOne({ username: req.user.username }).select('+password +passwordHistory');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });
    
    // Verify new password differs from current password
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'New Password cannot be same as Current Password' });
    }

    // Validate password strength against security policy
    const secSettings = await M.Settings.findOne({ key: 'security' });
    const requireStrong = secSettings?.value?.requireStrongPassword !== false;
    const validation = validatePassword(newPassword, requireStrong);
    if (!validation.isValid) {
      return res.status(400).json({ error: validation.error });
    }

    // Prevent reuse of recent passwords from history
    const history = user.passwordHistory || [];
    for (const prev of history.slice(-5)) {
      const prevMatch = await bcrypt.compare(newPassword, prev.hash);
      if (prevMatch) {
        return res.status(400).json({ error: 'You cannot reuse any of your recent 5 passwords.' });
      }
    }

    const hashed = await bcrypt.hash(newPassword, cfg.BCRYPT_ROUNDS);
    
    // Append current password hash to history capped at 5
    if (!user.passwordHistory) user.passwordHistory = [];
    user.passwordHistory.push({ hash: user.password, changedAt: new Date() });
    if (user.passwordHistory.length > 5) {
      user.passwordHistory = user.passwordHistory.slice(-5);
    }

    user.password = hashed;
    user.mustChangePassword = false;
    await user.save();

    await logAction(
      user.trackId || req.user._id,
      user.fullName || user.name,
      user.role,
      'Password Changed',
      'User changed their password',
      'security',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'system', subType: 'security', trackId: user.trackId }
    );
    res.json({ message: 'Password updated successfully' });
  } catch (err) { res.status(500).json({ error: 'Password updation failed.' }); }
});

// POST /api/auth/report-unknown - Report suspicious login and terminate sessions
router.post('/report-unknown', authLimiter, authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.body;

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username,
      req.user.role,
      'Unknown Login Reported',
      sessionId ? `Session ${sessionId} reported as suspicious` : 'Unknown session reported',
      'security',
      'warning',
      req.ip,
      sessionId || req.user.sessionId,
      { module: 'system', subType: 'security', trackId: req.user.trackId }
    );

    // Reset password to random string and require password change
    const model = getRoleModel(req.user.role);
    const userDoc = await model.findOne({ username: req.user.username });
    if (userDoc) {
      const tempPw = crypto.randomBytes(6).toString('hex');
      userDoc.password = await bcrypt.hash(tempPw, cfg.BCRYPT_ROUNDS);
      userDoc.mustChangePassword = true;
      await userDoc.save();
    }

    // Terminate all active user sessions
    await M.LoginHistory.updateOne(
      { trackId: req.user.trackId },
      { $set: { "history.$[].active": false, "history.$[].current": "Logged Out", "history.$[].logoutMethod": "forced", "history.$[].logoutTime": new Date() } }
    );
    await M.User.updateOne({ trackId: req.user.trackId }, { $set: { online: false } });

    res.json({ message: 'Account secured. All sessions terminated. Please login again.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process report.' });
  }
});

router.post('/verify-password', authLimiter, authMiddleware, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ verified: false, error: 'Password required' });

    const model = getRoleModel(req.user.role);
    if (!model) return res.status(400).json({ verified: false, error: 'Invalid role model' });

    const user = await model.findOne({ username: req.user.username }).select('+password');
    if (!user) return res.status(404).json({ verified: false, error: 'User not found' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ verified: false, error: 'Incorrect password' });

    res.json({ verified: true });
  } catch (err) { res.status(500).json({ verified: false, error: 'Password verification failed.' }); }
});

router.get('/check', authMiddleware, async (req, res) => {
  try {
    const { trackId, role } = req.user;

    const model = getRoleModel(role);
    const user = await model.findOne({ trackId });
    if (!user)
      return res.status(404).json({ error: 'User not found' });

    const loginHistory = await M.LoginHistory.findOne({ trackId });
    if (!loginHistory) return res.status(404).json({ error: 'Login history not found' });

    const histObj = loginHistory.history.find(h => h.sessionId === req.user.sessionId);
    if (!histObj) return res.status(401).json({ error: 'Session not found' });

    if (!histObj.active || histObj.current === 'Logged Out') return res.status(401).json({ error: 'User is inactive' });

    // Enforce absolute maximum session lifetime from settings
    const secSettings = await M.Settings.findOne({ key: 'security' }).lean();
    const maxSessionHours = secSettings?.value?.maxSessionLifetimeHours || 2;
    const MAX_SESSION_LIFETIME = maxSessionHours * 60 * 60 * 1000;
    const sessionAge = Date.now() - new Date(histObj.createdAt || histObj.loginTime || histObj.time).getTime();
    if (sessionAge > MAX_SESSION_LIFETIME) {
      await M.LoginHistory.updateOne(
        { trackId, "history.sessionId": histObj.sessionId },
        { $set: { "history.$.current": "Logged Out", "history.$.active": false, "history.$.logoutTime": new Date(), "history.$.logoutMethod": "auto" } }
      );
      await M.User.updateOne({ trackId }, { $set: { online: false } });
      return res.status(401).json({ error: 'Session maximum lifetime exceeded. Please login again.' });
    }

    if (histObj.expiresAt - Date.now() <= 5 * 60 * 1000) {
      histObj.expiresAt = new Date(histObj.expiresAt.getTime() + 10 * 60 * 1000);
      await M.LoginHistory.updateOne(
        { trackId, "history.sessionId": histObj.sessionId },
        { $set: { "history.$.expiresAt": histObj.expiresAt } }
      );
    }
    if (histObj.expiresAt < new Date()) {
      await M.LoginHistory.updateOne(
        { trackId, "history.sessionId": histObj.sessionId },
        { $set: { "history.$.current": "Logged Out", "history.$.active": false, "history.$.logoutTime": new Date(), "history.$.logoutMethod": "auto" } }
      );
      await M.User.updateOne({ trackId }, { $set: { online: false } });
      return res.status(401).json({
        error: 'Session expired, Login Again'
      });
    }
    res.json({
      active: true,
      expiresAt: histObj.expiresAt
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/login-history', authMiddleware, async (req, res) => {
  try {
    const loginHistory = await M.LoginHistory.findOne({ trackId: req.user.trackId });
    if (!loginHistory) return res.json({ history: [], firstLogin: null, lastLogin: null });

    res.json({
      history: loginHistory.history.map(h => ({
        time: h.time || h.createdAt,
        device: (h.browser || 'Unknown') + ' on ' + (h.os || 'Unknown'),
        ip: h.ip || '—',
        location: h.location?.address || (h.location?.latitude ? `${h.location.latitude}, ${h.location.longitude}` : ''),
        type: (h.deviceType || '').toLowerCase() === 'mobile' ? 'mobile' : 'web',
        current: h.active && h.current === 'Logged In',
        logoutMethod: h.logoutMethod || '',
        sessionId: h.sessionId,
      })),
      firstLogin: loginHistory.firstLogin,
      lastLogin: loginHistory.lastLogin,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout-all', authMiddleware, async (req, res) => {
  try {
    const { trackId, role, username } = req.user;

    await logAction(
      req.user._id,
      req.user.name || username,
      role,
      'Logout All Devices',
      'User logged out of all devices',
      'security',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'system', subType: 'session', trackId }
    );

    await M.LoginHistory.updateOne(
      { trackId },
      { $set: { "history.$[].active": false, "history.$[].current": "Logged Out", "history.$[].logoutTime": new Date(), "history.$[].logoutMethod": "forced" } }
    );

    await M.User.updateOne({ trackId }, { $set: { online: false } });

    res.json({ message: 'Logged out from all devices' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to logout from all devices' });
  }
});

module.exports = router;