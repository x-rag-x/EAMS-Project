const express = require('express');
const router = express.Router();
const bcrypt = require('@node-rs/bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cfg = require('../config');
const M = require('../models');
const { authMiddleware, getRoleModel } = require('../middleware/auth');
const { logAction, parseUserAgent, normalizeIp, sanitizeLogField } = require('../utils/logAction');
const { authLimiter, loginLimiter, loginUsernameLimiter } = require('../utils/rateLimiters');
const { validatePassword } = require('../utils/passwordValidator');

const { reverseGeocode } = require('../utils/reverseGeocode');
const { getSettings } = require('../utils/settingsCache');
const { hasSpecial, isAdminUser, resolveAccess } = require('../utils/access');
const { buildPagesDictionary } = require('../config/pageRegistry');

// ── Unified Sign-In services ──
const { resolveIdentity } = require('../utils/userResolver');
const { checkBlock, recordFailedAttempt, clearBlocksForUser } = require('../utils/securityBlockService');

// ── Short-lived in-memory verified credentials cache (accelerates two-step login) ──
const verifiedCredentialsCache = new Map();
function isCredVerified(key) {
  const expiresAt = verifiedCredentialsCache.get(key);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    verifiedCredentialsCache.delete(key);
    return false;
  }
  return true;
}
function setCredVerified(key) {
  if (verifiedCredentialsCache.size > 500) {
    const oldestKey = verifiedCredentialsCache.keys().next().value;
    verifiedCredentialsCache.delete(oldestKey);
  }
  verifiedCredentialsCache.set(key, Date.now() + 60000); // 60s valid window
}

function getClientDetails(req) {
  const headers = req.headers || {};
  const rawIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  const ip = normalizeIp(rawIp);
  const userAgent = headers['user-agent'] || '';
  const { deviceType, browser, os } = parseUserAgent(userAgent);
  return { ip, userAgent, deviceType, browser, os };
}

const isDev = cfg.NODE_ENV === 'development' || process.env.NODE_ENV === 'development';


function createServerTimer() {
  const start = process.hrtime.bigint();
  const marks = [];

  return {
    mark(name, desc, durMs) {
      marks.push({ name, desc, dur: durMs });
    },
    setHeaders(res, isDebugMode) {
      if (!isDebugMode || res.headersSent) return;
      const totalDur = Number(process.hrtime.bigint() - start) / 1e6;
      const allMarks = [...marks, { name: 'total', desc: 'Total Server Time', dur: totalDur }];
      const val = allMarks
        .map(m => `${m.name};dur=${m.dur.toFixed(1)}${m.desc ? `;desc="${m.desc}"` : ''}`)
        .join(', ');
      res.setHeader('Server-Timing', val);
    }
  };
}

// ══════════════════════════════════════════════════════
//  UNIFIED LOGIN ENDPOINT
// ══════════════════════════════════════════════════════

// Timing pad dummy hash created once at boot (Phase S3 / §3.5)
const DUMMY_HASH = bcrypt.hashSync('eams_dummy_password_timing_pad_2026', cfg.BCRYPT_ROUNDS || 10);

/**
 * Validates login location coordinates, freshness, and accuracy against system security settings.
 *
 * Rules:
 * - In development mode (NODE_ENV === 'development'), location is optional, accuracy restriction
 *   is removed completely, and stale location checks are bypassed.
 * - In production, behavior is driven by settings.security:
 *   * security.loginLocationRequired (default true, can be toggled off)
 *   * security.loginLocationAccuracyCheck (default true, can be toggled off)
 *   * security.loginLocationMaxAccuracyM (default 2000m, 0 disables limit)
 *   * security.loginLocationMaxAgeSec (default 300s)
 *
 * @param {object} location - { latitude, longitude, accuracy, ageMs }
 * @param {object} security - security settings map
 * @param {object} options - { required: boolean }
 * @returns {{ ok: boolean, code?: string, reason?: string, value?: object, skipped?: boolean }}
 */
function validateLocation(location, security = {}, options = { required: true }) {
  const isDevMode = cfg.NODE_ENV === 'development' || process.env.NODE_ENV === 'development';
  const isLocEnforced = !isDevMode && security.loginLocationRequired !== false && options.required !== false;

  if (!location || (location.latitude === undefined && location.longitude === undefined)) {
    if (!isLocEnforced) {
      return { ok: true, value: null, skipped: true };
    }
    return {
      ok: false,
      code: 'LOCATION_REQUIRED',
      reason: 'Location coordinates are required to sign in'
    };
  }

  const lat = Number(location.latitude);
  const lng = Number(location.longitude);
  const acc = location.accuracy !== undefined && location.accuracy !== null ? Number(location.accuracy) : null;
  const age = location.ageMs !== undefined && location.ageMs !== null ? Number(location.ageMs) : null;

  // Validate finite and ranges
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    if (!isLocEnforced) {
      return { ok: true, value: null, skipped: true };
    }
    return {
      ok: false,
      code: 'LOCATION_INVALID',
      reason: 'Invalid coordinates provided'
    };
  }

  // Reject (0, 0)
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) {
    if (!isLocEnforced) {
      return { ok: true, value: null, skipped: true };
    }
    return {
      ok: false,
      code: 'LOCATION_INVALID',
      reason: 'Zero coordinates are invalid'
    };
  }

  // Freshness check: default max 300 seconds (5 min) - skipped in dev
  const maxAgeSec = security.loginLocationMaxAgeSec !== undefined ? Number(security.loginLocationMaxAgeSec) : 300;
  if (!isDevMode && maxAgeSec > 0 && age !== null && Number.isFinite(age)) {
    if (age < 0 || age > maxAgeSec * 1000) {
      return {
        ok: false,
        code: 'LOCATION_INVALID',
        reason: 'Location fix is stale. Please refresh your location.'
      };
    }
  }

  // Accuracy check: default max 2000 meters - REMOVED / BYPASSED IN DEV
  // Also configurable via security.loginLocationAccuracyCheck and security.loginLocationMaxAccuracyM
  const checkAccuracy = !isDevMode && security.loginLocationAccuracyCheck !== false;
  const maxAccuracyM = security.loginLocationMaxAccuracyM !== undefined ? Number(security.loginLocationMaxAccuracyM) : 2000;
  if (checkAccuracy && maxAccuracyM > 0 && acc !== null && Number.isFinite(acc)) {
    if (acc < 0 || acc > maxAccuracyM) {
      return {
        ok: false,
        code: 'LOCATION_INVALID',
        reason: `Location accuracy (${Math.round(acc)}m) exceeds allowed limit (${maxAccuracyM}m)`
      };
    }
  }

  return {
    ok: true,
    value: {
      latitude: lat,
      longitude: lng,
      accuracy: acc !== null ? acc : undefined,
      ageMs: age !== null ? age : undefined
    }
  };
}

/**
 * Shared helper to enforce 1-hour account lockout on location denial or prompt timeout
 * (§3.5, §3.7).
 */
async function lockForLocation(shadowUser, settingsMap, req, res, reason) {
  const lockoutMins = 60;
  const lockedUntil = new Date(Date.now() + lockoutMins * 60 * 1000);

  await Promise.all([
    M.User.updateOne({ _id: shadowUser._id }, { $set: { status: 'locked', lockedUntil, failedLogins: 1 } }),
    M.LoginHistory.updateOne(
      { trackId: shadowUser.trackId },
      { $set: { lockedUntil, username: shadowUser.username, role: shadowUser.role, failedLogins: 1 } },
      { upsert: true }
    ),
    logAction(
      shadowUser.trackId || shadowUser._id,
      shadowUser.username,
      shadowUser.role || 'user',
      'Location Access Denied / Timed Out (Account Locked)',
      `User failed to grant location access (${reason || 'Permission denied or timed out'}). Account locked for 1 hour.`,
      'security',
      'error',
      req.ip,
      '',
      { module: 'system', subType: 'security-lock', trackId: shadowUser.trackId }
    )
  ]);

  return res.status(423).json({
    error: 'Account locked for 1 hour due to denied location permission or timeout.',
    code: 'LOCATION_LOCKED',
    locationLocked: true,
    lockedUntil
  });
}

// Unified authenticate: resolve identity, verify credentials, create session (S6.3: protected by IP and per-username limiters)
router.post('/login', loginLimiter, loginUsernameLimiter, async (req, res) => {
  const timer = createServerTimer();
  let isDebug = false;
  const origJson = res.json.bind(res);
  res.json = (data) => {
    timer.setHeaders(res, isDebug);
    return origJson(data);
  };

  try {
    // ── 1. Accept both unified format and legacy format ──
    const rawIdentifier = (req.body.identifier || req.body.username || '').toLowerCase().trim();
    const identifier = sanitizeLogField(rawIdentifier, 100);
    const password = req.body.password || '';
    const legacyRole = sanitizeLogField(req.body.role || '', 50);

    // Client device context (new unified format §3.6)
    const clientDevice = (req.body.device && typeof req.body.device === 'object') ? req.body.device : {};
    const clientLocation = req.body.location || null;
    const locationError = req.body.locationError || null;
    const deviceProof = req.body.deviceProof || null;
    // Pre-initialize coords and initialLocationAddress to avoid temporal dead zone (TDZ) in early-exit logs
    let coords = (clientLocation && typeof clientLocation === 'object' && clientLocation.latitude !== undefined && clientLocation.longitude !== undefined)
      ? clientLocation
      : null;
    let hasCoords = !!coords;
    let initialLocationAddress = hasCoords ? `${Number(coords.latitude).toFixed(4)}, ${Number(coords.longitude).toFixed(4)}` : '';

    if (!identifier || !password)
      return res.status(400).json({ error: 'Username and password are required', code: 'BAD_REQUEST' });

    // ── 2. Determine / normalize IP & device details ──
    const clientDetails = getClientDetails(req);
    const rawDeviceInstallId = clientDevice.installId || clientDevice.deviceInstallId || '';
    const rawDeviceId = clientDevice.deviceId || rawDeviceInstallId || '';
    const rawDeviceName = clientDevice.deviceName || '';

    const deviceInstallId = sanitizeLogField(rawDeviceInstallId, 100);
    const deviceId = sanitizeLogField(rawDeviceId, 100);
    const deviceName = sanitizeLogField(rawDeviceName, 100) || `${clientDetails.browser} on ${clientDetails.os}`;

    clientDevice.deviceId = deviceId;
    clientDevice.installId = deviceInstallId;
    clientDevice.deviceInstallId = deviceInstallId;
    clientDevice.deviceName = deviceName;
    if (clientDevice.deviceType) clientDevice.deviceType = sanitizeLogField(clientDevice.deviceType, 50);

    // ═══════════════════════════════════════════
    //  SMART BOARD HARDWARE PATH (§3.5, §5)
    // ═══════════════════════════════════════════
    if (identifier.startsWith('sb-') || identifier.startsWith('tr-')) {
      const boardDoc = await M.SmartBoard.findOne({
        deviceId: req.body.identifier?.trim().toUpperCase() || req.body.username?.trim().toUpperCase() || identifier.toUpperCase(),
      }).lean().maxTimeMS(4000);

      if (!boardDoc || !boardDoc.boardApiKey || boardDoc.boardApiKey !== password.trim()) {
        await bcrypt.compare(password, DUMMY_HASH);
        setImmediate(() => {
          if (!isDev) recordFailedAttempt(identifier, deviceId, clientDetails.ip).catch(() => {});
          logAction('SYSTEM', 'Smart Board Gateway', 'system', 'Board Login Failed', `Invalid credentials for device "${identifier}"`, 'security', 'warning', clientDetails.ip, '', { module: 'system', subType: 'auth-fail', deviceId: identifier }).catch(() => {});
        });
        return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
      }

      const settingsMap = await getSettings(['models']);
      if (settingsMap?.models?.modelSmartBoards === false) {
        return res.status(403).json({ error: 'Smart Board feature is currently disabled by administrator.' });
      }

      if (boardDoc.status !== 'Active') {
        return res.status(403).json({ error: `Smart Board is currently ${boardDoc.status}. Contact administrator.` });
      }

      const now = new Date();
      const boardSessionId = crypto.randomBytes(16).toString('hex');

      const boardSessionToken = jwt.sign(
        {
          role: 'board',
          identityType: 'board',
          boardId: boardDoc._id,
          deviceId: boardDoc.deviceId,
          boardName: boardDoc.boardName,
          roomId: boardDoc.roomId,
          aud: 'board'
        },
        cfg.BOARD_JWT_SECRET,
        { expiresIn: '24h' }
      );

      const boardDbStart = process.hrtime.bigint();
      await Promise.all([
        M.SmartBoard.updateOne(
          { _id: boardDoc._id },
          {
            $set: {
              connectionStatus: 'Connected',
              networkStatus: 'online',
              currentIp: clientDetails.ip,
              lastConnectedAt: now,
              lastSeenAt: now,
              lastHeartbeatAt: now,
            }
          }
        ),
        M.LoginHistory.updateOne(
          { username: boardDoc.deviceId.toLowerCase() },
          {
            $inc: { totalLogins: 1 },
            $set: {
              role: 'board',
              identityType: 'board',
              boardId: String(boardDoc._id),
              lastLogin: now,
              failedLogins: 0,
              lockedUntil: null,
            },
            $setOnInsert: { firstLogin: now, trackId: String(boardDoc._id) },
            $push: {
              history: {
                $each: [{
                  sessionId: boardSessionId,
                  time: now,
                  current: 'Logged In',
                  ip: clientDetails.ip,
                  userAgent: clientDetails.userAgent,
                  loginTime: now,
                  deviceType: clientDevice.deviceType || 'Desktop',
                  browser: clientDetails.browser,
                  os: clientDetails.os,
                  status: 'success',
                  deviceId,
                  deviceName: boardDoc.boardName || deviceName,
                  deviceInstallId,
                  deviceInfo: {
                    installId: deviceInstallId,
                    screen: clientDevice.screen || null,
                    platform: clientDevice.platform || clientDetails.os
                  },
                  identityType: 'board',
                  active: true,
                  createdAt: now,
                  lastActivity: now,
                }],
                $slice: -50,
              },
            },
          },
          { upsert: true }
        )
      ]);
      M.LoginSession.create({
        trackId: String(boardDoc._id),
        username: boardDoc.deviceId.toLowerCase(),
        sessionId: boardSessionId,
        role: 'board',
        identityType: 'board',
        sessionClass: 'board',
        deviceId,
        deviceName: boardDoc.boardName || deviceName,
        deviceInstallId,
        deviceInfo: {
          installId: deviceInstallId,
          screen: clientDevice.screen || null,
          platform: clientDevice.platform || clientDetails.os
        },
        ip: clientDetails.ip,
        ua: clientDetails.userAgent,
        userAgent: clientDetails.userAgent,
        createdAt: now,
        loginTime: now,
        lastActivity: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        active: true,
        authToken: boardSessionToken
      }).catch(err => console.error('[board LoginSession create error]', err));
      timer.mark('db_write', 'Board State Write', Number(process.hrtime.bigint() - boardDbStart) / 1e6);

      setImmediate(() => {
        if (!isDev) clearBlocksForUser(boardDoc.deviceId.toLowerCase()).catch(() => {});
        logAction(
          'SYSTEM',
          boardDoc.boardName || boardDoc.deviceId,
          'board',
          'Smart Board Login',
          `Smart Board "${boardDoc.deviceId}" (${boardDoc.boardName || 'Board'}) authenticated via unified sign-in`,
          'security',
          'info',
          clientDetails.ip,
          boardSessionId,
          {
            module: 'system',
            subType: 'session',
            trackId: `TR-BOARD-${boardDoc.deviceId.toUpperCase()}`,
            deviceId: boardDoc.deviceId,
            deviceName: boardDoc.boardName || boardDoc.deviceId,
            deviceType: 'smartboard'
          }
        ).catch(() => {});
      });

      return res.json({
        ok: true,
        identityType: 'board',
        role: 'board',
        redirectTo: 'board.html',
        redirectUrl: 'board.html',
        token: boardSessionToken,
        sessionId: boardSessionId,
        board: {
          id: boardDoc._id,
          deviceId: boardDoc.deviceId,
          boardName: boardDoc.boardName,
          roomId: boardDoc.roomId,
        },
      });
    }

    // ═══════════════════════════════════════════
    //  HUMAN IDENTITY PATH (student/teacher/admin)
    // ═══════════════════════════════════════════

    // ── 3. Parallel Batch 1: SecurityBlock, User, Roles, Password, Settings (S6.2: 1 Round Trip, no LoginHistory read) ──
    const initReadStart = process.hrtime.bigint();
    const [blockResult, shadowUser, teacherDoc, studentDoc, passwordDoc, settingsMap] = await Promise.all([
      isDev ? Promise.resolve({ blocked: false }) : checkBlock(identifier, deviceId, clientDetails.ip),
      M.User.findOne({ username: identifier }).select('username role trackId status failedLogins lockedUntil bootstrapPending').lean().maxTimeMS(4000),
      M.Teacher.findOne({ username: identifier }).select('+password username firstName lastName fullName name department deptName employeeNo designation specials pageRights accessVersion trackId bootstrapPending mustChangePassword isDefaultPassword firstBootAt').lean().maxTimeMS(4000),
      M.Student.findOne({ username: identifier }).select('+password fullName name department deptName registerNo rollNo trackId').lean().maxTimeMS(4000),
      M.Password ? M.Password.findOne({ username: identifier }).lean().maxTimeMS(4000) : Promise.resolve(null),
      getSettings(['security', 'pages', 'advanced', 'maintenance', 'device']),
    ]);
    timer.mark('db_read', 'DB Read Batch (1 Round Trip)', Number(process.hrtime.bigint() - initReadStart) / 1e6);
    isDebug = !!(settingsMap?.advanced?.debugMode);

    if (!isDev && blockResult.blocked) {
      return res.status(429).json({ error: blockResult.message, code: 'TOO_MANY_REQUESTS' });
    }

    const userDoc = shadowUser?.role === 'teacher' ? teacherDoc : shadowUser?.role === 'student' ? studentDoc : null;

    // Unknown user → spend identical bcrypt time (F11), return identical 401
    if (!shadowUser || !userDoc) {
      const bcryptStart = process.hrtime.bigint();
      await bcrypt.compare(password, DUMMY_HASH);
      timer.mark('bcrypt', 'Password Compare (Timing Pad)', Number(process.hrtime.bigint() - bcryptStart) / 1e6);

      setImmediate(() => {
        if (!isDev) recordFailedAttempt(identifier, deviceId, clientDetails.ip).catch(() => {});
        logAction(
          null,
          identifier,
          legacyRole || 'unknown',
          'Login Failed',
          `Login failed: User "${identifier}" not found [Device: ${deviceName} (${deviceId || 'N/A'})]`,
          'security',
          'warning',
          clientDetails.ip,
          '',
          {
            module: 'system',
            subType: 'auth-fail',
            deviceId,
            deviceInstallId,
            deviceName,
            deviceInfo: clientDevice,
            location: coords ? { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, address: initialLocationAddress } : null
          }
        ).catch(() => {});
      });
      return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }

    const role = shadowUser.role;
    const access = resolveAccess(role, userDoc, { env: cfg.NODE_ENV, now: new Date() });
    const security = settingsMap?.security || {};
    const pages = settingsMap?.pages || {};
    const advanced = settingsMap?.advanced || {};
    const maintenance = settingsMap?.maintenance || {};

    const maxAttempts = security.maxLoginAttempts || 3;
    const lockoutMins = security.lockoutDurationMins || 15;
    const lockedUntil = shadowUser.lockedUntil;

    // Dev auto-unlock
    if (isDev && (shadowUser.status === 'locked' || (lockedUntil && new Date(lockedUntil) > new Date()))) {
      shadowUser.status = 'active';
      Promise.all([
        M.User.updateOne({ _id: shadowUser._id }, { $set: { status: 'active', failedLogins: 0, lockedUntil: null } }),
        M.LoginHistory.updateOne({ trackId: shadowUser.trackId }, { $set: { failedLogins: 0, lockedUntil: null } })
      ]).catch(() => {});
    }

    // Account lockout check
    if (!isDev && (shadowUser.status === 'locked' || (lockedUntil && new Date(lockedUntil) > new Date()))) {
      if (lockedUntil && new Date(lockedUntil) > new Date()) {
        const remainingTimeMs = new Date(lockedUntil) - new Date();
        const remainingTimeMins = Math.ceil(remainingTimeMs / 60000);
        return res.status(401).json({
          error: `Account locked due to too many failed attempts. Try again in ${remainingTimeMins} minute(s).`,
          code: 'ACCOUNT_LOCKED',
          remainingMinutes: remainingTimeMins
        });
      } else {
        Promise.all([
          M.User.updateOne({ _id: shadowUser._id }, { $set: { status: 'active', failedLogins: 0, lockedUntil: null } }),
          M.LoginHistory.updateOne({ trackId: shadowUser.trackId }, { $set: { failedLogins: 0, lockedUntil: null } })
        ]).catch(() => {});
        shadowUser.status = 'active';
      }
    }

    if (shadowUser.status !== 'active') {
      setImmediate(() => {
        logAction(
          shadowUser.trackId || shadowUser._id,
          shadowUser.username,
          role,
          'Login Failed',
          `Login failed: User "${shadowUser.username}" is ${shadowUser.status} [Device: ${deviceName} (${deviceId || 'N/A'})]`,
          'security',
          'warning',
          clientDetails.ip,
          '',
          {
            module: 'system',
            subType: 'auth-fail',
            trackId: shadowUser.trackId,
            deviceId,
            deviceInstallId,
            deviceName,
            deviceInfo: clientDevice,
            location: coords ? { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, address: initialLocationAddress } : null
          }
        ).catch(() => {});
      });
      return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }

    // Maintenance check (§3.6: Sudo + Super exempt)
    if (!access.exempt.maintenance && maintenance.active) {
      const affected = maintenance.affectedRoles?.length ? maintenance.affectedRoles : ['teacher', 'student'];
      if (affected.includes(role)) {
        return res.status(503).json({
          error: maintenance.message || 'System under maintenance.',
          code: 'MAINTENANCE',
          maintenance: true,
          message: maintenance.message || 'System under maintenance.',
          affectedRoles: affected,
          endTime: maintenance.endTime || null,
          startedAt: maintenance.startedAt || null,
        });
      }
    }
    // ── 4. Verify password (bcrypt) ──
    const passwordHash = passwordDoc?.hash || userDoc.password;

    let match = false;

    if (!match) {
      const credCacheKey = crypto.createHash('sha256').update(`${identifier}:${passwordHash}:${password}`).digest('hex');
      match = isCredVerified(credCacheKey);

      const bcryptStart = process.hrtime.bigint();
      if (!match && passwordHash) {
        match = await bcrypt.compare(password, passwordHash);
        if (match) {
          setCredVerified(credCacheKey);
        }
      }
      timer.mark('bcrypt', 'Password Compare', Number(process.hrtime.bigint() - bcryptStart) / 1e6);
    }

    if (!match) {
      // ── T1.3 Device Registration Branch (§5) ──
      // If student enters their 12-char registration credential, claim ticket and enter registration mode
      if (role === 'student' && studentDoc) {
        const cleanCandidate = String(password || '').replace(/[\s-]/g, '').toUpperCase();
        const candidateHash = crypto.createHash('sha256').update(cleanCandidate).digest('hex');

        const activeTicket = await M.DeviceRegistrationTicket.findOne({
          studentId: studentDoc._id,
          stage: { $in: ['ISSUED', 'CLAIMED', 'CODE_SHOWN'] },
          expiresAt: { $gt: new Date() }
        });

        if (activeTicket) {
          if (activeTicket.attempts >= activeTicket.maxAttempts) {
            if (activeTicket.stage !== 'LOCKED') {
              activeTicket.stage = 'LOCKED';
              await activeTicket.save();
            }
            return res.status(401).json({
              error: 'Registration ticket locked due to too many failed attempts.',
              code: 'TICKET_LOCKED'
            });
          }

          if (activeTicket.credentialHash === candidateHash) {
            // Valid registration credential! Claim ticket (§5)
            activeTicket.stage = 'CLAIMED';
            activeTicket.claimedFrom = {
              ip: clientDetails.ip,
              installId: deviceInstallId,
              fingerprintHash: clientDevice.fingerprintHash || ''
            };
            await activeTicket.save();

            // Short-lived registration token (10m)
            const regToken = jwt.sign(
              {
                ticketId: activeTicket.ticketId,
                studentId: String(studentDoc._id),
                studentTrackId: studentDoc.trackId,
                deptId: studentDoc.deptId,
                classId: studentDoc.classId,
                type: 'device_registration'
              },
              cfg.JWT_SECRET,
              { expiresIn: '10m' }
            );

            setImmediate(() => {
              logAction(
                studentDoc.trackId,
                studentDoc.fullName || studentDoc.username,
                'student',
                'Registration Ticket Claimed',
                `Device registration ticket "${activeTicket.ticketId}" claimed from IP ${clientDetails.ip}`,
                'device',
                'info',
                clientDetails.ip,
                '',
                { module: 'device', subType: 'ticket-claimed', ticketId: activeTicket.ticketId }
              ).catch(() => {});
            });

            return res.json({
              ok: true,
              registration: true,
              regToken,
              ticketId: activeTicket.ticketId,
              student: {
                trackId: studentDoc.trackId,
                fullName: studentDoc.fullName,
                username: studentDoc.username,
                registerNo: studentDoc.registerNo
              }
            });
          } else {
            // Live ticket exists, but credential was wrong: count attempt against TICKET, not password lockout (§5)
            activeTicket.attempts = (activeTicket.attempts || 0) + 1;
            if (activeTicket.attempts >= activeTicket.maxAttempts) {
              activeTicket.stage = 'LOCKED';
            }
            await activeTicket.save();

            setImmediate(() => {
              logAction(
                studentDoc.trackId,
                studentDoc.fullName || studentDoc.username,
                'student',
                'Registration Ticket Attempt Failed',
                `Invalid credential attempt for ticket "${activeTicket.ticketId}" (${activeTicket.attempts}/${activeTicket.maxAttempts})`,
                'device',
                'warning',
                clientDetails.ip,
                '',
                { module: 'device', subType: 'ticket-attempt-failed', ticketId: activeTicket.ticketId }
              ).catch(() => {});
            });

            return res.status(401).json({
              error: 'Invalid credentials or registration code',
              code: 'INVALID_CREDENTIALS',
              attemptsRemaining: Math.max(0, activeTicket.maxAttempts - activeTicket.attempts)
            });
          }
        }
      }

      let currentFailed = 1;
      if (!isDev) {
        const updatedUser = await M.User.findOneAndUpdate(
          { _id: shadowUser._id },
          { $inc: { failedLogins: 1 } },
          { returnDocument: 'after', projection: { failedLogins: 1, lockedUntil: 1 } }
        );
        currentFailed = updatedUser ? updatedUser.failedLogins : 1;
      }

      if (!isDev && currentFailed >= maxAttempts) {
        const lockDuration = new Date(Date.now() + lockoutMins * 60 * 1000);
        await M.User.updateOne({ _id: shadowUser._id }, { $set: { status: 'locked', lockedUntil: lockDuration } });

        setImmediate(() => {
          M.LoginHistory.updateOne(
            { trackId: shadowUser.trackId },
            { $set: { failedLogins: currentFailed, lockedUntil: lockDuration, username: shadowUser.username, role } },
            { upsert: true }
          ).catch(() => {});
          recordFailedAttempt(identifier, deviceId, clientDetails.ip).catch(() => {});
          logAction(
            shadowUser.trackId || shadowUser._id,
            shadowUser.username,
            role,
            'Login Failed (Locked)',
            `Login failed: Account locked due to ${currentFailed} failed attempts [Device: ${deviceName} (${deviceId || 'N/A'})]`,
            'security',
            'warning',
            clientDetails.ip,
            '',
            {
              module: 'system',
              subType: 'auth-fail',
              trackId: shadowUser.trackId,
              deviceId,
              deviceInstallId,
              deviceName,
              deviceInfo: clientDevice,
              location: coords ? { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, address: initialLocationAddress } : null
            }
          ).catch(() => {});
        });

        return res.status(401).json({
          error: `Account locked due to too many failed attempts. Try again in ${lockoutMins} minute(s).`,
          code: 'ACCOUNT_LOCKED',
          remainingMinutes: lockoutMins
        });
      }

      setImmediate(() => {
        M.LoginHistory.updateOne(
          { trackId: shadowUser.trackId },
          { $inc: { failedLogins: 1 }, $set: { role, lastFailedAt: new Date(), username: shadowUser.username } },
          { upsert: true }
        ).catch(() => {});
        if (!isDev) recordFailedAttempt(identifier, deviceId, clientDetails.ip).catch(() => {});
        logAction(
          shadowUser.trackId || shadowUser._id,
          shadowUser.username,
          role,
          'Login Failed',
          `Login failed: Incorrect password attempt [Device: ${deviceName} (${deviceId || 'N/A'})]`,
          'security',
          'warning',
          clientDetails.ip,
          '',
          {
            module: 'system',
            subType: 'auth-fail',
            trackId: shadowUser.trackId,
            deviceId,
            deviceInstallId,
            deviceName,
            deviceInfo: clientDevice,
            location: coords ? { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, address: initialLocationAddress } : null
          }
        ).catch(() => {});
      });

      return res.status(401).json({
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // ── 4.1 Post-Password Student Access Guard ──
    if (role === 'student') {
      const pageStudents = pages.pageStudents !== undefined ? pages.pageStudents : 'enabled';
      const isStudentsDisabled = String(pageStudents).toLowerCase() === 'disabled' || String(pageStudents).toLowerCase() === 'hidden' || pageStudents === false;
      if (isStudentsDisabled) {
        setImmediate(() => {
          logAction(
            shadowUser.trackId || shadowUser._id,
            shadowUser.username,
            role,
            'Student Login Blocked (Paused)',
            `Student login blocked: Students portal is disabled by administrator [Device: ${deviceName} (${deviceId || 'N/A'})]`,
            'security',
            'warning',
            clientDetails.ip,
            '',
            {
              module: 'student',
              subType: 'auth-block',
              trackId: shadowUser.trackId,
              deviceId,
              deviceInstallId,
              deviceName,
              deviceInfo: clientDevice,
              location: coords ? { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, address: initialLocationAddress } : null
            }
          ).catch(() => {});
        });
        return res.status(403).json({
          error: 'Students Login are paused temporary.',
          code: 'STUDENTS_LOGIN_PAUSED',
          portalDisabled: true,
          portal: 'student'
        });
      }
    }

    // ── 4.2 Post-Password Teacher Access Guard ──
    const hasAdminGrants = Boolean(access.isAdmin || access.flags?.isSudo || access.flags?.isSuper || access.flags?.isSub);
    if (role === 'teacher' && !hasAdminGrants) {
      const pageTeachers = pages.pageTeachers !== undefined ? pages.pageTeachers : 'enabled';
      const isTeachersDisabled = String(pageTeachers).toLowerCase() === 'disabled' || String(pageTeachers).toLowerCase() === 'hidden' || pageTeachers === false;
      if (isTeachersDisabled) {
        setImmediate(() => {
          logAction(
            shadowUser.trackId || shadowUser._id,
            shadowUser.username,
            role,
            'Teacher Login Blocked (Disabled)',
            `Teacher login blocked: Teacher portal is disabled by administrator [Device: ${deviceName} (${deviceId || 'N/A'})]`,
            'security',
            'warning',
            clientDetails.ip,
            '',
            {
              module: 'teacher',
              subType: 'auth-block',
              trackId: shadowUser.trackId,
              deviceId,
              deviceInstallId,
              deviceName,
              deviceInfo: clientDevice,
              location: coords ? { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, address: initialLocationAddress } : null
            }
          ).catch(() => {});
        });
        return res.status(403).json({
          error: 'Teacher Portal is currently disabled by administrator.',
          code: 'PORTAL_DISABLED',
          portalDisabled: true,
          portal: 'teacher'
        });
      }
    }

    // ── 4.3 First-run password guards for Sudo Admin bootstrap (§9, R3.3) ──
    if (userDoc.bootstrapPending || shadowUser.bootstrapPending) {
      if (process.env.BOOTSTRAP_ALLOWED_IPS) {
        const allowedIps = process.env.BOOTSTRAP_ALLOWED_IPS.split(',').map(s => s.trim()).filter(Boolean);
        if (allowedIps.length > 0 && !allowedIps.includes(clientDetails.ip)) {
          return res.status(403).json({
            error: 'Bootstrap login is restricted to authorized IP addresses.',
            code: 'BOOTSTRAP_IP_FORBIDDEN'
          });
        }
      }

      if (userDoc.isDefaultPassword && userDoc.firstBootAt) {
        const elapsedMs = Date.now() - new Date(userDoc.firstBootAt).getTime();
        const maxValidMs = 24 * 60 * 60 * 1000;
        if (elapsedMs > maxValidMs) {
          return res.status(403).json({
            error: 'Default bootstrap password has expired (24-hour limit). Please configure ADMIN_PASSWORD in environment.',
            code: 'DEFAULT_PASSWORD_EXPIRED'
          });
        }
      }
    }

    // ── 5. Location validation — AFTER password check (§3.5, §3.7) ──
    const isLocRequired = !isDev && security.loginLocationRequired !== false && !access.exempt.location;
    const loc = validateLocation(clientLocation, security, { required: isLocRequired });
    if (!loc.ok) {
      if (!isDev && (locationError === 'PERMISSION_DENIED' || locationError === 'PROMPT_TIMEOUT')) {
        return lockForLocation(shadowUser, settingsMap, req, res, locationError);
      }
      return res.status(403).json({ error: loc.reason || 'Location is required to sign in', code: loc.code });
    }

    // ── 6. Session and JWT generation ──
    let sessionClass = role === 'student' ? 'student' : 'staff';
    let durationMins = (security.sessionTimeout !== false) ? (security.sessionTimeoutMins !== undefined ? Number(security.sessionTimeoutMins) : 7) : (365 * 24 * 60);
    let trustedDeviceDoc = null;
    let refreshToken = null;
    let refreshHash = null;

    if (role === 'student' && studentDoc) {
      trustedDeviceDoc = await M.StudentDevice.findOne({
        studentId: studentDoc._id,
        status: 'TRUSTED'
      }).lean();

      const candidateInstallId = (deviceInstallId || clientDevice?.installId || '').trim();
      if (trustedDeviceDoc && candidateInstallId && trustedDeviceDoc.installId === candidateInstallId) {
        // Registered trusted phone (§6, T3.2): 15-day absolute session
        sessionClass = 'student-device';
        const studentDays = settingsMap?.device?.studentSessionDays || 15;
        durationMins = studentDays * 24 * 60;

        // Generate refresh cookie token and hash (§6, S7)
        refreshToken = crypto.randomBytes(32).toString('hex');
        refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

        res.cookie('eams_refresh', refreshToken, {
          httpOnly: true,
          secure: cfg.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/api/auth/refresh',
          maxAge: studentDays * 24 * 60 * 60 * 1000
        });
      }
    }

    const expiresAt = new Date(Date.now() + durationMins * 60 * 1000);
    const sessionId = crypto.randomBytes(16).toString('hex');

    const jwtStart = process.hrtime.bigint();
    const token = jwt.sign(
      {
        _id: shadowUser._id,
        roleId: userDoc._id,
        name: userDoc.fullName || userDoc.name || '',
        username: userDoc.username,
        role: role,
        trackId: userDoc.trackId || shadowUser.trackId,
        dept: userDoc.department || userDoc.deptName || '',
        empId: userDoc.employeeNo || '',
        desig: userDoc.designation || '',
        regNo: userDoc.registerNo || '',
        sessionId,
        sessionClass,
        av: access.version
      },
      cfg.JWT_SECRET,
      { expiresIn: cfg.JWT_EXPIRES_IN || '24h' }
    );
    timer.mark('jwt', 'Token Signing', Number(process.hrtime.bigint() - jwtStart) / 1e6);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    coords = loc.value || coords;
    hasCoords = coords && coords.latitude !== undefined && coords.longitude !== undefined;
    initialLocationAddress = hasCoords ? `${Number(coords.latitude).toFixed(4)}, ${Number(coords.longitude).toFixed(4)}` : '';

    const historyObj = {
      sessionId: sessionId,
      time: new Date(),
      current: 'Logged In',
      ip: clientDetails.ip,
      userAgent: clientDetails.userAgent,
      loginTime: new Date(),
      logoutTime: null,
      logoutMethod: null,
      deviceType: clientDevice.deviceType || clientDetails.deviceType,
      browser: clientDetails.browser,
      os: clientDetails.os,
      status: 'success',
      deviceId,
      deviceName,
      deviceInstallId,
      deviceInfo: {
        installId: deviceInstallId,
        deviceId: deviceId,
        deviceName: deviceName,
        deviceType: clientDevice.deviceType || clientDetails.deviceType,
        browser: clientDevice.browser || clientDetails.browser,
        os: clientDevice.os || clientDetails.os,
        platform: clientDevice.platform || clientDetails.os,
        screen: clientDevice.screen || null,
        pixelRatio: clientDevice.pixelRatio || null,
        language: clientDevice.language || null,
        timezone: clientDevice.timezone || null,
        touchSupport: clientDevice.touchSupport !== undefined ? clientDevice.touchSupport : null,
        hardwareConcurrency: clientDevice.hardwareConcurrency || null,
        brand: clientDevice.brand || null,
        model: clientDevice.model || null
      },
      identityType: 'human',
      location: {
        latitude: coords?.latitude,
        longitude: coords?.longitude,
        accuracy: coords?.accuracy,
        address: initialLocationAddress
      },
      authToken: tokenHash,
      createdAt: new Date(),
      active: true,
      expiresAt: expiresAt,
      lastActivity: new Date()
    };

    const isMultiAdmin = Boolean(access.exempt.multiSession && advanced.multiAdminSession !== false);

    // ── 7. ONE parallel write batch (S7.2: includes standalone LoginSession) ──
    const dbWriteStart = process.hrtime.bigint();
    const terminatePriorPromise = isMultiAdmin ? Promise.resolve() : M.LoginHistory.updateOne(
      { trackId: shadowUser.trackId },
      {
        $set: {
          "history.$[h].active": false,
          "history.$[h].current": "Logged Out",
          "history.$[h].logoutTime": new Date(),
          "history.$[h].logoutMethod": "forced"
        }
      },
      { arrayFilters: [{ "h.active": true, "h.sessionId": { $ne: sessionId } }] }
    );

    const terminatePriorLoginSessionPromise = isMultiAdmin ? Promise.resolve() : M.LoginSession.updateMany(
      { trackId: shadowUser.trackId, active: true, sessionId: { $ne: sessionId } },
      { $set: { active: false, logoutAt: new Date(), logoutMethod: 'forced' } }
    );

    const saveLoginSessionDocPromise = M.LoginSession.create({
      trackId: shadowUser.trackId,
      username: shadowUser.username,
      sessionId: sessionId,
      role: role,
      identityType: 'human',
      sessionClass: sessionClass,
      deviceTrackId: trustedDeviceDoc ? trustedDeviceDoc.deviceTrackId : '',
      deviceId: deviceId,
      deviceInstallId: deviceInstallId,
      deviceName: deviceName,
      deviceInfo: historyObj.deviceInfo,
      ip: clientDetails.ip,
      ua: clientDetails.userAgent,
      userAgent: clientDetails.userAgent,
      location: historyObj.location,
      createdAt: historyObj.createdAt,
      loginTime: historyObj.loginTime,
      lastActivity: historyObj.lastActivity,
      expiresAt: expiresAt,
      active: true,
      refreshHash: refreshHash,
      authToken: tokenHash,
    });

    const saveSessionPromise = M.LoginHistory.updateOne(
      { trackId: shadowUser.trackId },
      {
        $inc: { totalLogins: 1 },
        $set: {
          username: shadowUser.username,
          role: role,
          identityType: 'human',
          lastLogin: new Date(),
          failedLogins: 0,
          lockedUntil: null
        },
        $setOnInsert: { firstLogin: new Date() },
        $push: {
          history: {
            $each: [historyObj],
            $slice: -100
          }
        }
      },
      { upsert: true }
    );

    const updateUserPromise = M.User.updateOne(
      { _id: shadowUser._id },
      { $set: { online: true, failedLogins: 0, lockedUntil: null } }
    );

    await Promise.all([
      terminatePriorPromise,
      terminatePriorLoginSessionPromise,
      saveLoginSessionDocPromise,
      saveSessionPromise,
      updateUserPromise,
    ]);
    timer.mark('db_write', 'Session & User Write (1 Round Trip)', Number(process.hrtime.bigint() - dbWriteStart) / 1e6);

    // ── 8. Respond ──
    const userFirstLastName = (userDoc.firstName && userDoc.lastName)
      ? `${userDoc.firstName} ${userDoc.lastName}`.trim()
      : (userDoc.fullName || userDoc.username);

    const isBootstrapPending = Boolean(userDoc.bootstrapPending || shadowUser.bootstrapPending);
    const isAnyAdmin = Boolean(
      access.isAdmin ||
      access.isSudoAdmin ||
      access.isSuperAdmin ||
      access.isSubAdmin ||
      (access.flags && (access.flags.isSudo || access.flags.isSuper || access.flags.isSub || access.flags.isAdmin)) ||
      role === 'admin' ||
      role === 'sudo'
    );
    const bypassSelector = !isAnyAdmin && (pages.pageSelector === 'disabled' || pages.pageSelector === 'hidden');
    const finalLanding = (isDev ? false : isBootstrapPending) ? 'index.html' : (isAnyAdmin ? 'selector.html' : access.landing);
    const redirectTo = finalLanding;
    const redirectUrl = `/${finalLanding}`;

    const specialsArr = Array.isArray(userDoc.specials) ? userDoc.specials : [];
    const isHod = access.flags.isHod;
    const isPrincipal = access.flags.isPrincipal;
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
      ok: true,
      token,
      sessionId,
      mustChangePassword: isDev ? false : !!userDoc.mustChangePassword,
      bootstrapPending: isDev ? false : isBootstrapPending,
      redirectTo,
      redirectUrl,
      sessionClass,
      role,
      identityType: 'human',
      bypassSelector,
      user: {
        _id: shadowUser._id,
        name: userDoc.fullName || userDoc.name || '',
        username: userDoc.username,
        role,
        active: true,
        dept: userDoc.department || userDoc.deptName || '',
        deptId: userDoc.deptId || null,
        deptCode: userDoc.deptCode || '',
        mustChangePassword: isDev ? false : !!userDoc.mustChangePassword,
        bootstrapPending: isDev ? false : isBootstrapPending,
        isAdmin: access.isAdmin,
        isSudoAdmin: access.isSudoAdmin,
        isSuperAdmin: access.isSuperAdmin,
        isSubAdmin: access.isSubAdmin,
        accessRole: access.tier,
        landing: finalLanding,
        redirectTo: finalLanding,
        pageRights: access.pageRights,
        pages: access.pages || {},
        adminFlag: access.adminFlag,
        access: access.access,
        isHod,
        isPrincipal,
        isTimeTableCoordinator,
        TTdeptName,
        specials: specialsArr,
      }
    });

    // ── 9. Non-blocking post-response background work ──
    setImmediate(() => {
      const isSudo = Boolean(access && access.flags && access.flags.isSudo);
      const isAnyAdmin = Boolean(access.isAdmin || access.isSudoAdmin || access.isSuperAdmin || access.isSubAdmin || role === 'admin' || role === 'sudo');
      const actionName = role === 'student' ? 'Student Login' : (isSudo ? 'Sudo Admin Login' : (isAnyAdmin ? 'Admin Login' : 'Teacher Login'));
      const userRefId = userDoc.registerNo || userDoc.rollNo || userDoc.employeeNo || shadowUser.username;
      const deviceSummary = `${deviceName || 'Device'} (ID: ${deviceId || 'N/A'})`;
      const locationSummary = initialLocationAddress
        ? `from ${initialLocationAddress}`
        : (coords ? `at coordinates (${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)})` : 'without coordinates');

      Promise.allSettled([
        isDev ? Promise.resolve() : clearBlocksForUser(identifier),
        logAction(
          shadowUser.trackId || userDoc.trackId || shadowUser._id,
          userFirstLastName,
          role,
          actionName,
          access.exempt.location && !hasCoords
            ? `${actionName} successful: ${userFirstLastName} [${userRefId}] logged in without location (exemption granted) via ${deviceSummary}`
            : `${actionName} successful: ${userFirstLastName} [${userRefId}] logged in ${locationSummary} via ${deviceSummary}`,
          'security',
          'info',
          clientDetails.ip,
          sessionId,
          {
            module: isSudo ? 'admin' : (role === 'teacher' ? 'teacher' : 'student'),
            subType: 'session',
            trackId: userDoc.trackId || shadowUser.trackId,
            deviceId,
            deviceInstallId,
            deviceName,
            deviceType: clientDevice.deviceType || clientDetails.deviceType,
            browser: clientDevice.browser || clientDetails.browser,
            os: clientDevice.os || clientDetails.os,
            deviceInfo: historyObj.deviceInfo,
            location: historyObj.location
          }
        ),
        hasCoords ? reverseGeocode(coords.latitude, coords.longitude).then(async (resolvedAddress) => {
          if (resolvedAddress && resolvedAddress !== initialLocationAddress) {
            await Promise.all([
              M.LoginHistory.updateOne(
                { trackId: shadowUser.trackId, "history.sessionId": sessionId },
                { $set: { "history.$.location.address": resolvedAddress } }
              ),
              M.LoginSession.updateOne(
                { sessionId: sessionId },
                { $set: { "location.address": resolvedAddress } }
              ),
              M.Log.updateOne(
                { sessionId: sessionId, action: { $regex: /login/i } },
                {
                  $set: {
                    "location.address": resolvedAddress,
                    details: `${actionName} successful: ${userFirstLastName} [${userRefId}] logged in from ${resolvedAddress} via ${deviceSummary}`
                  }
                }
              )
            ]).catch(() => {});
          }
        }) : Promise.resolve(),
        // S6.6: Advisory notices for new device and new location
        (async () => {
          try {
            const priorDoc = await M.LoginHistory.findOne(
              { trackId: shadowUser.trackId },
              { history: { $slice: -25 } }
            ).lean();
            const pastSessions = (priorDoc?.history || []).filter(h => h.sessionId !== sessionId && h.status === 'success');
            if (pastSessions.length > 0) {
              const knownInstallId = deviceInstallId && pastSessions.some(h => (h.deviceInstallId === deviceInstallId || h.deviceId === deviceId));
              const knownIp = pastSessions.some(h => h.ip === clientDetails.ip);

              if (deviceInstallId && !knownInstallId) {
                await logAction(
                  shadowUser.trackId || shadowUser._id,
                  userFirstLastName,
                  role,
                  'New Device Sign-In Notice',
                  `User signed in from an unrecognized device (${deviceName}) [Device ID: ${deviceId || 'N/A'}]`,
                  'security',
                  'info',
                  clientDetails.ip,
                  sessionId,
                  { module: 'system', subType: 'security-advisory', isNewDevice: true, trackId: userDoc.trackId || shadowUser.trackId, deviceId, deviceInstallId, deviceName, deviceInfo: historyObj.deviceInfo }
                );
              }

              if (!knownIp) {
                await logAction(
                  shadowUser.trackId || shadowUser._id,
                  userFirstLastName,
                  role,
                  'New Location Sign-In Notice',
                  `User signed in from an unfamiliar IP/location (${clientDetails.ip}${initialLocationAddress ? ` at ${initialLocationAddress}` : ''})`,
                  'security',
                  'info',
                  clientDetails.ip,
                  sessionId,
                  { module: 'system', subType: 'security-advisory', isNewLocation: true, trackId: userDoc.trackId || shadowUser.trackId, location: historyObj.location }
                );
              }
            }
          } catch (e) {
            console.error('[new-device advisory notice error]', e.message);
          }
        })()
      ]).catch(err => console.error('[login post]', err));
    });
  } catch (err) {
    console.error('[EAMS Login Exception]:', err);
    res.status(500).json({ error: 'Login failed, try again' });
  }
});

// ══════════════════════════════════════════════════════
//  DEVELOPMENT QUICK-LOGIN ENDPOINTS (DEV MODE ONLY)
// ══════════════════════════════════════════════════════

router.get('/dev-users', async (req, res) => {
  if (!isDev) {
    return res.status(403).json({ error: 'Available only in development mode' });
  }
  try {
    const [teachers, students] = await Promise.all([
      M.Teacher.find({ active: { $ne: false } })
        .select('username firstName lastName fullName name role department deptName specials adminFlag pageRights trackId')
        .lean(),
      M.Student.find({ active: { $ne: false } })
        .select('username firstName lastName fullName name role department deptName registerNo rollNo class className batch trackId isRep')
        .lean()
    ]);

    const users = [];

    teachers.forEach(t => {
      const specials = Array.isArray(t.specials) ? t.specials : [];
      const isHod = specials.some(s => s.option === 'isHod');
      const isPrincipal = specials.some(s => s.option === 'isPrincipal');
      const isTt = specials.some(s => s.option === 'isTimeTableCoordinator');
      const isSudo = t.role === 'sudo' || (t.adminFlag && t.adminFlag.isSudo);
      const isAdmin = isSudo || t.role === 'admin' || (t.adminFlag && (t.adminFlag.isSuper || t.adminFlag.isSub || t.adminFlag.isAdmin));

      let badge = 'Faculty';
      if (isSudo) badge = 'Sudo Admin';
      else if (isPrincipal) badge = 'Principal';
      else if (isHod) badge = 'HOD';
      else if (isTt) badge = 'TT Coord';
      else if (isAdmin) badge = 'Admin';

      users.push({
        username: t.username,
        name: (t.firstName && t.lastName) ? `${t.firstName} ${t.lastName}`.trim() : (t.fullName || t.name || t.username),
        role: t.role || 'teacher',
        category: isAdmin ? 'Admin' : 'Faculty',
        badge,
        dept: t.department || t.deptName || '',
        trackId: t.trackId || '',
        isSudo,
        isAdmin,
        isHod,
        isPrincipal
      });
    });

    students.forEach(s => {
      users.push({
        username: s.username,
        name: (s.firstName && s.lastName) ? `${s.firstName} ${s.lastName}`.trim() : (s.fullName || s.name || s.username),
        role: 'student',
        category: 'Student',
        badge: s.isRep ? 'Class Rep' : 'Student',
        dept: s.department || s.deptName || '',
        class: s.class || s.className || '',
        batch: s.batch || '',
        regNo: s.registerNo || s.rollNo || '',
        trackId: s.trackId || ''
      });
    });

    const roleRank = {
      'Sudo Admin': 1,
      'Principal': 2,
      'Admin': 3,
      'HOD': 4,
      'TT Coord': 5,
      'Faculty': 6,
      'Class Rep': 7,
      'Student': 8
    };

    users.sort((a, b) => {
      const rankDiff = (roleRank[a.badge] || 99) - (roleRank[b.badge] || 99);
      if (rankDiff !== 0) return rankDiff;
      if (a.category === 'Student' && b.category === 'Student') {
        const classDiff = (a.class || '').localeCompare(b.class || '');
        if (classDiff !== 0) return classDiff;
        const regDiff = (a.regNo || '').localeCompare(b.regNo || '');
        if (regDiff !== 0) return regDiff;
      }
      return (a.name || a.username).localeCompare(b.name || b.username);
    });

    res.json({ ok: true, users });
  } catch (err) {
    console.error('[dev-users error]:', err);
    res.status(500).json({ error: 'Failed to load dev users' });
  }
});

router.post('/dev-login', async (req, res) => {
  if (!isDev) {
    return res.status(403).json({ error: 'Available only in development mode' });
  }
  try {
    const rawIdentifier = (req.body.identifier || req.body.username || '').toLowerCase().trim();
    const identifier = sanitizeLogField(rawIdentifier, 100);
    if (!identifier) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const clientDetails = getClientDetails(req);
    const clientDevice = (req.body.device && typeof req.body.device === 'object') ? req.body.device : {};
    const rawDeviceInstallId = clientDevice.installId || clientDevice.deviceInstallId || '';
    const rawDeviceId = clientDevice.deviceId || rawDeviceInstallId || '';
    const rawDeviceName = clientDevice.deviceName || '';

    const deviceInstallId = sanitizeLogField(rawDeviceInstallId, 100);
    const deviceId = sanitizeLogField(rawDeviceId, 100);
    const deviceName = sanitizeLogField(rawDeviceName, 100) || `${clientDetails.browser} on ${clientDetails.os}`;

    clientDevice.deviceId = deviceId;
    clientDevice.installId = deviceInstallId;
    clientDevice.deviceInstallId = deviceInstallId;
    clientDevice.deviceName = deviceName;
    if (clientDevice.deviceType) clientDevice.deviceType = sanitizeLogField(clientDevice.deviceType, 50);

    const [shadowUserFound, teacherDoc, studentDoc, settingsMap] = await Promise.all([
      M.User.findOne({ username: identifier }).select('username role trackId status failedLogins lockedUntil bootstrapPending').lean(),
      M.Teacher.findOne({ username: identifier }).select('username firstName lastName fullName name department deptName employeeNo designation specials pageRights accessVersion trackId bootstrapPending mustChangePassword').lean(),
      M.Student.findOne({ username: identifier }).select('username fullName name department deptName registerNo rollNo trackId').lean(),
      getSettings(['pages', 'security', 'advanced']),
    ]);

    let shadowUser = shadowUserFound;
    let userDoc = null;
    let role = '';

    if (teacherDoc) {
      userDoc = teacherDoc;
      role = teacherDoc.role || 'teacher';
      if (!shadowUser) {
        shadowUser = {
          _id: teacherDoc._id,
          username: teacherDoc.username,
          role: role,
          trackId: teacherDoc.trackId || `TR-${teacherDoc.username.toUpperCase()}`,
          status: 'active'
        };
      }
    } else if (studentDoc) {
      userDoc = studentDoc;
      role = 'student';
      if (!shadowUser) {
        shadowUser = {
          _id: studentDoc._id,
          username: studentDoc.username || identifier,
          role: 'student',
          trackId: studentDoc.trackId || `STU-${identifier.toUpperCase()}`,
          status: 'active'
        };
      }
    } else if (shadowUser) {
      role = shadowUser.role;
      if (role === 'teacher' || role === 'admin' || role === 'sudo') {
        userDoc = await M.Teacher.findOne({ trackId: shadowUser.trackId }).lean() || shadowUser;
      } else {
        userDoc = await M.Student.findOne({ trackId: shadowUser.trackId }).lean() || shadowUser;
      }
    }

    if (!userDoc || !shadowUser) {
      setImmediate(() => {
        logAction(
          null,
          identifier,
          'unknown',
          'Login Failed (Dev)',
          `Dev login failed: User "${identifier}" not found [Device: ${deviceName} (${deviceId || 'N/A'})]`,
          'security',
          'warning',
          clientDetails.ip,
          '',
          {
            module: 'system',
            subType: 'auth-fail',
            deviceId,
            deviceInstallId,
            deviceName,
            deviceInfo: clientDevice
          }
        ).catch(() => {});
      });
      return res.status(404).json({ error: `User '${identifier}' not found in database.` });
    }

    const access = resolveAccess(role, userDoc, { env: cfg.NODE_ENV, now: new Date() });
    const pages = settingsMap?.pages || {};

    if (role === 'student') {
      const pageStudents = pages.pageStudents !== undefined ? pages.pageStudents : 'enabled';
      const isStudentsDisabled = String(pageStudents).toLowerCase() === 'disabled' || String(pageStudents).toLowerCase() === 'hidden' || pageStudents === false;
      if (isStudentsDisabled) {
        setImmediate(() => {
          logAction(
            shadowUser.trackId || shadowUser._id,
            shadowUser.username,
            role,
            'Student Login Blocked (Paused)',
            `Dev student login blocked: Students portal disabled by administrator [Device: ${deviceName} (${deviceId || 'N/A'})]`,
            'security',
            'warning',
            clientDetails.ip,
            '',
            {
              module: 'student',
              subType: 'auth-block',
              trackId: shadowUser.trackId,
              deviceId,
              deviceInstallId,
              deviceName,
              deviceInfo: clientDevice
            }
          ).catch(() => {});
        });
        return res.status(403).json({
          error: 'Students Login are paused temporary.',
          code: 'STUDENTS_LOGIN_PAUSED',
          portalDisabled: true,
          portal: 'student'
        });
      }
    }

    const hasAdminGrants = Boolean(access.isAdmin || access.flags?.isSudo || access.flags?.isSuper || access.flags?.isSub);
    if (role === 'teacher' && !hasAdminGrants) {
      const pageTeachers = pages.pageTeachers !== undefined ? pages.pageTeachers : 'enabled';
      const isTeachersDisabled = String(pageTeachers).toLowerCase() === 'disabled' || String(pageTeachers).toLowerCase() === 'hidden' || pageTeachers === false;
      if (isTeachersDisabled) {
        setImmediate(() => {
          logAction(
            shadowUser.trackId || shadowUser._id,
            shadowUser.username,
            role,
            'Teacher Login Blocked (Disabled)',
            `Dev teacher login blocked: Teacher portal disabled by administrator [Device: ${deviceName} (${deviceId || 'N/A'})]`,
            'security',
            'warning',
            clientDetails.ip,
            '',
            {
              module: 'teacher',
              subType: 'auth-block',
              trackId: shadowUser.trackId,
              deviceId,
              deviceInstallId,
              deviceName,
              deviceInfo: clientDevice
            }
          ).catch(() => {});
        });
        return res.status(403).json({
          error: 'Teacher Portal is currently disabled by administrator.',
          code: 'PORTAL_DISABLED',
          portalDisabled: true,
          portal: 'teacher'
        });
      }
    }

    const sessionId = crypto.randomBytes(16).toString('hex');
    const sessionClass = role === 'student' ? 'student' : 'staff';
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const token = jwt.sign(
      {
        _id: shadowUser._id,
        roleId: userDoc._id,
        name: userDoc.fullName || userDoc.name || '',
        username: userDoc.username,
        role: role,
        trackId: userDoc.trackId || shadowUser.trackId,
        dept: userDoc.department || userDoc.deptName || '',
        empId: userDoc.employeeNo || '',
        desig: userDoc.designation || '',
        regNo: userDoc.registerNo || '',
        sessionId,
        sessionClass,
        av: access.version
      },
      cfg.JWT_SECRET,
      { expiresIn: cfg.JWT_EXPIRES_IN || '24h' }
    );
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const rawLoc = req.body.location;
    const devCoords = (rawLoc && typeof rawLoc.latitude === 'number' && typeof rawLoc.longitude === 'number') ? {
      latitude: rawLoc.latitude,
      longitude: rawLoc.longitude,
      accuracy: rawLoc.accuracy || null,
      address: rawLoc.address || 'Development Environment'
    } : {
      latitude: null,
      longitude: null,
      accuracy: null,
      address: 'Development Environment'
    };

    const historyObj = {
      sessionId: sessionId,
      time: new Date(),
      current: 'Logged In',
      ip: clientDetails.ip,
      userAgent: clientDetails.userAgent,
      loginTime: new Date(),
      logoutTime: null,
      logoutMethod: null,
      deviceType: clientDevice.deviceType || clientDetails.deviceType,
      browser: clientDevice.browser || clientDetails.browser,
      os: clientDevice.os || clientDetails.os,
      status: 'success',
      deviceId,
      deviceName,
      deviceInstallId,
      deviceInfo: {
        installId: deviceInstallId,
        deviceId: deviceId,
        deviceName: deviceName,
        deviceType: clientDevice.deviceType || clientDetails.deviceType,
        browser: clientDevice.browser || clientDetails.browser,
        os: clientDevice.os || clientDetails.os,
        platform: clientDevice.platform || clientDetails.os,
        screen: clientDevice.screen || null,
        pixelRatio: clientDevice.pixelRatio || null,
        language: clientDevice.language || null,
        timezone: clientDevice.timezone || null,
        touchSupport: clientDevice.touchSupport !== undefined ? clientDevice.touchSupport : null,
        hardwareConcurrency: clientDevice.hardwareConcurrency || null,
        brand: clientDevice.brand || null,
        model: clientDevice.model || null
      },
      identityType: 'human',
      location: devCoords,
      authToken: tokenHash,
      createdAt: new Date(),
      active: true,
      expiresAt: expiresAt,
      lastActivity: new Date()
    };

    // Parallel session write
    await Promise.all([
      M.LoginSession.create({
        trackId: shadowUser.trackId,
        username: shadowUser.username,
        sessionId: sessionId,
        role: role,
        identityType: 'human',
        sessionClass: sessionClass,
        deviceTrackId: '',
        deviceId: deviceId,
        deviceInstallId: deviceInstallId,
        deviceName: deviceName,
        deviceInfo: historyObj.deviceInfo,
        ip: clientDetails.ip,
        ua: clientDetails.userAgent,
        userAgent: clientDetails.userAgent,
        location: historyObj.location,
        createdAt: historyObj.createdAt,
        loginTime: historyObj.loginTime,
        lastActivity: historyObj.lastActivity,
        expiresAt: expiresAt,
        active: true,
        authToken: tokenHash,
      }).catch(e => console.error('[dev-login LoginSession]', e.message)),

      M.LoginHistory.updateOne(
        { trackId: shadowUser.trackId },
        {
          $inc: { totalLogins: 1 },
          $set: {
            username: shadowUser.username,
            role: role,
            identityType: 'human',
            lastLogin: new Date(),
            failedLogins: 0,
            lockedUntil: null
          },
          $setOnInsert: { firstLogin: new Date() },
          $push: { history: { $each: [historyObj], $slice: -100 } }
        },
        { upsert: true }
      ).catch(e => console.error('[dev-login LoginHistory]', e.message)),

      M.User.updateOne(
        { _id: shadowUser._id },
        { $set: { online: true, failedLogins: 0, lockedUntil: null } }
      ).catch(() => {})
    ]);

    const isAnyAdmin = Boolean(
      access.isAdmin ||
      access.isSudoAdmin ||
      access.isSuperAdmin ||
      access.isSubAdmin ||
      (access.flags && (access.flags.isSudo || access.flags.isSuper || access.flags.isSub || access.flags.isAdmin)) ||
      role === 'admin' ||
      role === 'sudo'
    );
    const bypassSelector = !isAnyAdmin && (pages.pageSelector === 'disabled' || pages.pageSelector === 'hidden');
    const finalLanding = isAnyAdmin ? 'selector.html' : access.landing;

    const specialsArr = Array.isArray(userDoc.specials) ? userDoc.specials : [];
    const isHod = access.flags.isHod;
    const isPrincipal = access.flags.isPrincipal;
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
      ok: true,
      token,
      sessionId,
      mustChangePassword: false,
      bootstrapPending: false,
      redirectTo: finalLanding,
      redirectUrl: `/${finalLanding}`,
      sessionClass,
      role,
      identityType: 'human',
      bypassSelector,
      user: {
        _id: shadowUser._id,
        name: userDoc.fullName || userDoc.name || '',
        username: userDoc.username,
        role,
        active: true,
        dept: userDoc.department || userDoc.deptName || '',
        deptCode: userDoc.deptCode || '',
        mustChangePassword: false,
        bootstrapPending: false,
        isAdmin: access.isAdmin,
        isSudoAdmin: access.isSudoAdmin,
        isSuperAdmin: access.isSuperAdmin,
        isSubAdmin: access.isSubAdmin,
        accessRole: access.tier,
        landing: finalLanding,
        redirectTo: finalLanding,
        pageRights: access.pageRights,
        pages: access.pages || {},
        adminFlag: access.adminFlag,
        access: access.access,
        isHod,
        isPrincipal,
        isTimeTableCoordinator,
        TTdeptName,
        specials: specialsArr,
      }
    });

    setImmediate(() => {
      const isSudo = Boolean(access && access.flags && access.flags.isSudo);
      const isAnyAdmin = Boolean(access.isAdmin || access.isSudoAdmin || access.isSuperAdmin || access.isSubAdmin || role === 'admin' || role === 'sudo');
      const actionName = role === 'student' ? 'Student Login (Dev)' : (isSudo ? 'Sudo Admin Login (Dev)' : (isAnyAdmin ? 'Admin Login (Dev)' : 'Teacher Login (Dev)'));
      const userRefId = userDoc.registerNo || userDoc.rollNo || userDoc.employeeNo || shadowUser.username;
      const userFirstLastName = (userDoc.firstName && userDoc.lastName)
        ? `${userDoc.firstName} ${userDoc.lastName}`.trim()
        : (userDoc.fullName || userDoc.username);
      const deviceSummary = `${deviceName || 'Dev Browser'} (ID: ${deviceId || 'N/A'})`;
      const locationSummary = devCoords.latitude ? `at coordinates (${devCoords.latitude.toFixed(4)}, ${devCoords.longitude.toFixed(4)})` : devCoords.address;

      logAction(
        shadowUser.trackId || userDoc.trackId || shadowUser._id,
        userFirstLastName,
        role,
        actionName,
        `${actionName} successful: ${userFirstLastName} [${userRefId}] signed in (${locationSummary}) via ${deviceSummary}`,
        'security',
        'info',
        clientDetails.ip,
        sessionId,
        {
          module: isSudo ? 'admin' : (role === 'teacher' ? 'teacher' : 'student'),
          subType: 'session',
          trackId: userDoc.trackId || shadowUser.trackId,
          deviceId,
          deviceInstallId,
          deviceName,
          deviceType: clientDevice.deviceType || clientDetails.deviceType,
          browser: clientDevice.browser || clientDetails.browser,
          os: clientDevice.os || clientDetails.os,
          deviceInfo: historyObj.deviceInfo,
          location: historyObj.location
        }
      ).catch(e => console.error('[dev-login logAction]', e.message));
    });
  } catch (err) {
    console.error('[EAMS Dev Login Exception]:', err);
    res.status(500).json({ error: 'Dev login failed' });
  }
});

router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const { trackId, sessionId } = req.user;
    const method = req.body && req.body.method === 'auto' ? 'auto' : 'manual';
    const now = new Date();

    // S7.2: Deactivate session in LoginSession and LoginHistory
    await Promise.all([
      M.LoginSession.updateOne(
        { sessionId },
        { $set: { active: false, logoutAt: now, logoutMethod: method } }
      ),
      M.LoginHistory.updateOne(
        { trackId: trackId, "history.sessionId": sessionId },
        {
          $set: {
            "history.$.logoutTime": now,
            "history.$.logoutMethod": method,
            "history.$.current": "Logged Out",
            "history.$.active": false
          }
        }
      )
    ]);

    // Update user online status if no active sessions remain
    const remainingActive = await M.LoginSession.countDocuments({ trackId, active: true });
    if (remainingActive === 0) {
      await M.User.updateOne({ trackId: trackId }, { $set: { online: false } });
    }

    setImmediate(() => {
      const u = req.user;
      if (u) {
        const roleName = u.role === 'student' ? 'Student' : (['admin', 'sudo'].includes(u.role) ? 'Admin' : 'Teacher');
        logAction(
          u.trackId || u._id,
          u.name || u.username,
          u.role,
          `${roleName} Logout`,
          `${roleName} ${u.name || u.username} logged out (${method})`,
          'security',
          'info',
          req.ip,
          sessionId,
          {
            module: u.role === 'student' ? 'student' : (['admin', 'sudo'].includes(u.role) ? 'admin' : 'teacher'),
            subType: 'session',
            trackId: u.trackId,
            req
          }
        ).catch(() => {});
      }
    });

    res.clearCookie('eams_refresh', { path: '/api/auth/refresh' });
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ── 15-Day Student Device Session Refresh (§6, §16, T3.1) ──
function getRefreshCookie(req) {
  if (req.cookies && req.cookies.eams_refresh) return req.cookies.eams_refresh;
  const rc = req.headers.cookie;
  if (rc) {
    const parts = rc.split(';');
    for (const part of parts) {
      const [k, v] = part.trim().split('=');
      if (k === 'eams_refresh') return decodeURIComponent(v || '');
    }
  }
  return null;
}

const usedChallengeNonces = new Map();
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [nonce, ts] of usedChallengeNonces.entries()) {
    if (ts < cutoff) usedChallengeNonces.delete(nonce);
  }
}, 60000).unref();

/**
 * GET /api/auth/device-challenge
 * Returns fresh HMAC-signed challenge nonce for device signature verification
 */
router.get('/device-challenge', (req, res) => {
  const random = crypto.randomBytes(16).toString('hex');
  const ts = Date.now();
  const hmac = crypto.createHmac('sha256', cfg.JWT_SECRET).update(`${random}:${ts}`).digest('hex');
  const nonce = `${random}.${ts}.${hmac}`;
  res.json({ ok: true, nonce });
});

/**
 * POST /api/auth/refresh
 * Requires both refresh cookie and valid ECDSA device signature over nonce
 * Returns fresh 24-hour access token without password prompt for 15 days
 */
router.post('/refresh', async (req, res) => {
  try {
    const rawRefreshToken = getRefreshCookie(req);
    if (!rawRefreshToken) {
      return res.status(401).json({ error: 'Refresh cookie missing or expired', code: 'REFRESH_COOKIE_MISSING' });
    }

    const { deviceTrackId, studentTrackId, nonce, signature } = req.body;
    if (!nonce || !signature) {
      return res.status(400).json({ error: 'Challenge nonce and device signature are required', code: 'DEVICE_PROOF_REQUIRED' });
    }

    // 1. Verify challenge nonce format, HMAC signature, and freshness (< 120s)
    const parts = String(nonce).split('.');
    if (parts.length !== 3) {
      return res.status(401).json({ error: 'Invalid challenge nonce', code: 'NONCE_INVALID' });
    }
    const [random, tsStr, sig] = parts;
    const ts = Number(tsStr);
    if (isNaN(ts) || Math.abs(Date.now() - ts) > 120000) {
      return res.status(401).json({ error: 'Challenge nonce expired. Please try again.', code: 'NONCE_EXPIRED' });
    }
    const expectedHmac = crypto.createHmac('sha256', cfg.JWT_SECRET).update(`${random}:${ts}`).digest('hex');
    if (sig !== expectedHmac) {
      return res.status(401).json({ error: 'Invalid challenge signature', code: 'NONCE_INVALID' });
    }

    // Single-use replay protection
    if (usedChallengeNonces.has(nonce)) {
      return res.status(401).json({ error: 'Challenge nonce already used', code: 'NONCE_REPLAYED' });
    }
    usedChallengeNonces.set(nonce, ts);

    // 2. Validate refresh cookie against active LoginSession
    const refreshHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const loginSession = await M.LoginSession.findOne({
      refreshHash,
      active: true,
      sessionClass: 'student-device'
    });

    if (!loginSession) {
      return res.status(401).json({ error: 'Active student device session not found. Please sign in again.', code: 'SESSION_NOT_FOUND' });
    }

    if (loginSession.expiresAt && loginSession.expiresAt < new Date()) {
      return res.status(401).json({ error: '15-day session limit reached. Please sign in again with your password.', code: 'SESSION_EXPIRED' });
    }

    // 3. Resolve trusted device record
    const targetDeviceTrackId = deviceTrackId || loginSession.deviceTrackId;
    const deviceQuery = { status: 'TRUSTED' };
    if (targetDeviceTrackId) {
      deviceQuery.deviceTrackId = targetDeviceTrackId;
    } else if (studentTrackId || loginSession.trackId) {
      deviceQuery.studentTrackId = studentTrackId || loginSession.trackId;
    }

    const studentDevice = await M.StudentDevice.findOne(deviceQuery).lean();
    if (!studentDevice || !studentDevice.publicKeyJwk) {
      return res.status(401).json({ error: 'Registered trusted device not found or inactive', code: 'DEVICE_NOT_TRUSTED' });
    }

    // 4. Verify cryptographic signature over nonce using stored public key
    try {
      const pubKey = crypto.createPublicKey({ key: studentDevice.publicKeyJwk, format: 'jwk' });
      const verify = crypto.createVerify('SHA256');
      verify.update(nonce);
      const isValid = verify.verify({ key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'hex'));
      if (!isValid) {
        return res.status(401).json({ error: 'Device signature verification failed', code: 'INVALID_SIGNATURE' });
      }
    } catch (verErr) {
      return res.status(401).json({ error: 'Error verifying cryptographic signature', code: 'INVALID_SIGNATURE' });
    }

    // 5. Verify student & user status
    const studentDoc = await M.Student.findById(studentDevice.studentId).lean();
    const userDoc = await M.User.findOne({ trackId: studentDoc?.trackId || studentDevice.studentTrackId }).lean();
    if (!studentDoc || !userDoc || userDoc.status === 'locked') {
      return res.status(401).json({ error: 'Account is locked or not found', code: 'ACCOUNT_LOCKED' });
    }

    // 6. Refresh lastActivity on session
    loginSession.lastActivity = new Date();
    await loginSession.save();

    // 7. Issue fresh 24-hour access token
    const token = jwt.sign(
      {
        _id: userDoc._id,
        roleId: studentDoc._id,
        name: studentDoc.fullName || studentDoc.name || '',
        username: userDoc.username,
        role: 'student',
        trackId: userDoc.trackId,
        dept: studentDoc.department || studentDoc.deptName || '',
        regNo: studentDoc.registerNo || '',
        sessionId: loginSession.sessionId,
        sessionClass: 'student-device'
      },
      cfg.JWT_SECRET,
      { expiresIn: cfg.JWT_EXPIRES_IN || '24h' }
    );

    return res.json({
      ok: true,
      token,
      sessionId: loginSession.sessionId,
      sessionClass: 'student-device',
      role: 'student',
      user: {
        _id: userDoc._id,
        name: studentDoc.fullName || studentDoc.name || '',
        username: userDoc.username,
        role: 'student',
        active: true,
        dept: studentDoc.department || studentDoc.deptName || '',
        deptCode: studentDoc.deptCode || '',
        regNo: studentDoc.registerNo || '',
        landing: 'student.html',
        redirectTo: 'student.html'
      }
    });
  } catch (err) {
    console.error('[Device Refresh Error]:', err);
    return res.status(500).json({ error: 'Internal server error refreshing session' });
  }
});

// ── GET /api/auth/access — Active Access Authority (§5.1, R2.5, S4.1) ──
router.get('/access', authMiddleware, async (req, res) => {
  try {
    const access = req.access || resolveAccess(req.user?.role || 'teacher', req.user, { env: cfg.NODE_ENV });
    const pages = buildPagesDictionary ? buildPagesDictionary(req.user, access) : (access.pages || {});
    const accessRole = access.tier || req.user?.role || 'staff';
    const flags = access.flags || {};
    const landing = access.landing || 'teacher.html';
    const accessVersion = Number(req.user?.accessVersion || req.user?.pageRights?.version || access.version || 0);
    const sessionExpiresAt = req.session?.expiresAt || null;

    // Resolve comprehensive grants list (including disabled grants for R6 locked cards)
    const rawPr = req.user?.rawPageRights || req.user?.pageRights;
    let grants = [];
    if (Array.isArray(rawPr)) {
      grants = rawPr.slice();
    } else if (rawPr && Array.isArray(rawPr.grants)) {
      grants = rawPr.grants.slice();
    } else if (Array.isArray(access.pageRights)) {
      grants = access.pageRights.slice();
    }

    // For Super Admin: if bulk grant is not explicitly present, ensure bulk grant entry exists with enabled: false (§4.4, §6.4, §8)
    if (flags.isSuper && !grants.some(g => g && g.page === 'bulk')) {
      grants.push({
        page: 'bulk',
        module: '-dept',
        scope: 'department',
        deptId: req.user.deptId || null,
        dept: req.user.department || req.user.deptName || '',
        actions: ['view', 'create'],
        enabled: false
      });
    }

    res.json({
      ok: true,
      user: {
        trackId: req.user.trackId,
        username: req.user.username,
        name: req.user.name,
        fullName: req.user.fullName,
        role: req.user.role,
        department: req.user.department || req.user.deptName || '',
        deptId: req.user.deptId || null,
        bootstrapPending: Boolean(req.user.bootstrapPending),
        accessRole,
        isTimeTableCoordinator: Boolean(req.user.isTimeTableCoordinator || access.isTimeTableCoordinator),
        TTdeptName: req.user.TTdeptName || '',
        isHod: Boolean(req.user.isHod || access.isHod),
        isPrincipal: Boolean(req.user.isPrincipal || access.isPrincipal),
        pages: pages || access.pages || {}
      },
      access,
      accessRole,
      flags,
      pages,
      grants,
      landing,
      accessVersion,
      sessionExpiresAt,
      bootstrapPending: Boolean(req.user?.bootstrapPending)
    });
  } catch (err) {
    console.error('[GET /api/auth/access error]:', err);
    res.status(500).json({ error: 'Failed to resolve access permissions', details: err.message });
  }
});

router.post('/ping', authMiddleware, async (req, res) => {
  const access = req.access || resolveAccess(req.user, { env: cfg.NODE_ENV });
  const accessVersion = Number(req.user?.accessVersion || req.user?.pageRights?.version || access.version || 0);
  res.json({
    success: true,
    expiresAt: req.session?.expiresAt || null,
    accessVersion
  });
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

    // Invalidate all OTHER sessions for this user (force re-login on other devices)
    await M.LoginHistory.updateOne(
      { trackId: user.trackId },
      {
        $set: {
          'history.$[elem].active': false,
          'history.$[elem].current': 'Logged Out',
          'history.$[elem].logoutTime': new Date(),
          'history.$[elem].logoutMethod': 'password_change'
        }
      },
      { arrayFilters: [{ 'elem.sessionId': { $ne: req.user.sessionId } }] }
    );

    // Update User.online if no active sessions remain
    const activeSessions = await M.LoginHistory.findOne(
      { trackId: user.trackId, 'history.active': true }
    );
    if (!activeSessions) {
      await M.User.updateOne({ trackId: user.trackId }, { $set: { online: false } });
    }

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

    // Terminate all active user sessions (S7.2: LoginSession + LoginHistory)
    const now = new Date();
    await Promise.all([
      M.LoginSession.updateMany(
        { trackId: req.user.trackId, active: true },
        { $set: { active: false, logoutAt: now, logoutMethod: "forced" } }
      ),
      M.LoginHistory.updateOne(
        { trackId: req.user.trackId },
        { $set: { "history.$[].active": false, "history.$[].current": "Logged Out", "history.$[].logoutMethod": "forced", "history.$[].logoutTime": now } }
      ),
      M.User.updateOne({ trackId: req.user.trackId }, { $set: { online: false } })
    ]);

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
    const { trackId, sessionId } = req.user;

    let session = await M.LoginSession.findOne({ sessionId }).lean();
    if (!session) {
      const loginHistory = await M.LoginHistory.findOne({ trackId }).lean();
      const histObj = (loginHistory?.history || []).find(h => h.sessionId === sessionId);
      if (histObj) session = histObj;
    }

    if (!session) return res.status(401).json({ error: 'Session not found' });
    if (!session.active || session.logoutAt || session.current === 'Logged Out') {
      return res.status(401).json({ error: 'Session is inactive' });
    }

    // Enforce absolute maximum session lifetime from settings (§3.9, F17)
    const secSettings = (await getSettings(['security'])).security || {};
    const isStudentDevice = session.sessionClass === 'student-device';
    const maxSessionHours = isStudentDevice ? (15 * 24) : (secSettings.maxSessionLifetimeHours !== undefined ? Number(secSettings.maxSessionLifetimeHours) : 1);
    const MAX_SESSION_LIFETIME = maxSessionHours * 60 * 60 * 1000;
    const sessionAge = Date.now() - new Date(session.createdAt || session.loginTime || session.time).getTime();
    if (sessionAge > MAX_SESSION_LIFETIME) {
      await Promise.all([
        M.LoginSession.updateOne({ sessionId }, { $set: { active: false, logoutAt: new Date(), logoutMethod: 'auto' } }),
        M.LoginHistory.updateOne(
          { trackId, "history.sessionId": sessionId },
          { $set: { "history.$.current": "Logged Out", "history.$.active": false, "history.$.logoutTime": new Date(), "history.$.logoutMethod": "auto" } }
        ),
        M.User.updateOne({ trackId }, { $set: { online: false } })
      ]);
      return res.status(401).json({ error: 'Session maximum lifetime exceeded. Please login again.' });
    }

    if (new Date(session.expiresAt) - Date.now() <= 5 * 60 * 1000) {
      const newExpires = new Date(Date.now() + 10 * 60 * 1000);
      session.expiresAt = newExpires;
      await Promise.all([
        M.LoginSession.updateOne({ sessionId }, { $set: { expiresAt: newExpires, lastActivity: new Date() } }),
        M.LoginHistory.updateOne({ trackId, "history.sessionId": sessionId }, { $set: { "history.$.expiresAt": newExpires } })
      ]);
    }

    if (new Date(session.expiresAt) < new Date()) {
      await Promise.all([
        M.LoginSession.updateOne({ sessionId }, { $set: { active: false, logoutAt: new Date(), logoutMethod: 'auto' } }),
        M.LoginHistory.updateOne(
          { trackId, "history.sessionId": sessionId },
          { $set: { "history.$.current": "Logged Out", "history.$.active": false, "history.$.logoutTime": new Date(), "history.$.logoutMethod": "auto" } }
        ),
        M.User.updateOne({ trackId }, { $set: { online: false } })
      ]);
      return res.status(401).json({
        error: 'Session expired, Login Again'
      });
    }

    res.json({
      active: true,
      expiresAt: session.expiresAt
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
    const now = new Date();

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

    await Promise.all([
      M.LoginSession.updateMany(
        { trackId, active: true },
        { $set: { active: false, logoutAt: now, logoutMethod: "forced" } }
      ),
      M.LoginHistory.updateOne(
        { trackId },
        { $set: { "history.$[].active": false, "history.$[].current": "Logged Out", "history.$[].logoutTime": now, "history.$[].logoutMethod": "forced" } }
      ),
      M.User.updateOne({ trackId }, { $set: { online: false } })
    ]);

    res.clearCookie('eams_refresh', { path: '/api/auth/refresh' });
    res.json({ message: 'Logged out from all devices' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to logout from all devices' });
  }
});



module.exports = router;