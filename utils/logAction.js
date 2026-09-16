const M = require('../models');
const { encryptLog } = require('./logCrypto');

async function getNextLogTrackId() {
  try {
    const counter = await M.Counter.findByIdAndUpdate(
      'logTrackId',
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true }
    );
    return `TR-LOG-${String(counter.seq).padStart(6, '0')}`;
  } catch (err) {
    const fallbackSeq = Date.now().toString().slice(-6);
    return `TR-LOG-${fallbackSeq}`;
  }
}

function normalizeIp(rawIp) {
  if (!rawIp || typeof rawIp !== 'string') return '127.0.0.1';
  let ip = rawIp.trim();

  // If list of IPs from x-forwarded-for, take the first one
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }

  // Strip IPv4-mapped IPv6 prefix ::ffff:
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // Normalize localhost IPv6 to IPv4 127.0.0.1
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1' || ip === 'localhost') {
    return '127.0.0.1';
  }

  return ip || '127.0.0.1';
}

const mongoose = require('mongoose');

async function logAction(userId, userName, role, action, details, category, severity, ip, sessionId, opts = {}) {
  try {
    const logTrackId = await getNextLogTrackId();
    const cleanIp = normalizeIp(ip || opts.req?.ip);
    
    // Resolve Session ID
    const resolvedSessionId = sessionId || opts.sessionId || opts.req?.user?.sessionId || opts.req?.session?.sessionId || '';

    // Resolve GPS Location
    let resolvedLocation = opts.location;
    if (!resolvedLocation && opts.req) {
      resolvedLocation = opts.req.session?.location || opts.req.user?.location || null;
      if (!resolvedLocation && opts.req.body && (opts.req.body.latitude !== undefined || opts.req.body.longitude !== undefined)) {
        resolvedLocation = {
          latitude: Number(opts.req.body.latitude) || null,
          longitude: Number(opts.req.body.longitude) || null,
          accuracy: Number(opts.req.body.accuracy) || null,
          address: opts.req.body.address || ''
        };
      }
    }
    if (!resolvedLocation && resolvedSessionId) {
      try {
        const { getSessionLocation } = require('../middleware/auth');
        resolvedLocation = getSessionLocation(resolvedSessionId);
      } catch (_) {}
    }
    if (!resolvedLocation) {
      resolvedLocation = { latitude: null, longitude: null, accuracy: null, address: '' };
    }

    // Resolve User Name: First Name + Last Name (prevent generic SYSTEM unless pure system background process)
    let resolvedUserName = (userName && userName !== 'SYSTEM' && userName !== 'system') ? String(userName).trim() : '';
    if (!resolvedUserName && opts.req?.user) {
      const u = opts.req.user;
      resolvedUserName = (u.firstName && u.lastName) ? `${u.firstName} ${u.lastName}`.trim() : (u.name || u.fullName || u.username);
    }
    if (!resolvedUserName && userId) {
      try {
        const query = mongoose.isValidObjectId(userId) ? { _id: userId } : { trackId: String(userId) };
        const foundUser = await M.User.findOne(query).lean();
        if (foundUser) {
          const roleModel = foundUser.role === 'admin' ? M.Admin : (foundUser.role === 'teacher' ? M.Teacher : M.Student);
          const roleDoc = await roleModel.findOne({ username: foundUser.username }).lean();
          if (roleDoc) {
            const f = (roleDoc.firstName || '').trim();
            const l = (roleDoc.lastName || '').trim();
            resolvedUserName = (f && l) ? `${f} ${l}` : (roleDoc.fullName || foundUser.username);
          }
        }
      } catch (_) {}
    }
    if (!resolvedUserName) {
      resolvedUserName = (role === 'system' || userName === 'SYSTEM') ? 'System' : 'Admin';
    }

    // Determine module fallback if not explicitly provided
    let mod = opts.module;
    if (!mod) {
      if (category === 'settings' || category === 'maintenance') mod = 'settings';
      else if (category === 'manage' || category === 'year') mod = 'manage';
      else if (category === 'security' || category === 'system') mod = 'system';
      else if (role === 'admin') mod = 'admin';
      else if (role === 'teacher') mod = 'teacher';
      else if (role === 'student') mod = 'student';
      else mod = 'system';
    }

    // Determine subType fallback if not provided
    let subType = opts.subType;
    if (!subType) {
      const actLower = (action || '').toLowerCase();
      if (actLower.includes('login')) subType = 'session';
      else if (actLower.includes('added') || actLower.includes('created')) subType = 'entry-create';
      else if (actLower.includes('updated') || actLower.includes('saved') || actLower.includes('edit')) subType = 'field-edit';
      else if (actLower.includes('deleted') || actLower.includes('cleared') || actLower.includes('removed')) subType = 'entry-delete';
      else if (actLower.includes('attendance')) subType = 'attendance';
      else if (actLower.includes('leave')) subType = 'leave';
      else if (actLower.includes('backup')) subType = 'backup';
      else if (actLower.includes('export')) subType = 'export';
      else if (actLower.includes('broadcast')) subType = 'broadcast';
      else subType = 'action';
    }

    // Ensure details is a string for M.Log schema
    const stringDetails = typeof details === 'object' && details !== null ? JSON.stringify(details) : String(details || '');

    // Encrypt sensitive details / changes
    const payloadToEncrypt = {
      details: stringDetails,
      changes: opts.changes || null,
      ip: cleanIp,
    };
    const encryptedPayload = encryptLog(payloadToEncrypt);

    let resolvedTrackId = opts.trackId;
    if (!resolvedTrackId) {
      if (role === 'system' || resolvedUserName === 'System' || resolvedUserName === 'SYSTEM') resolvedTrackId = 'TR-SYS-001';
      else if (resolvedUserName === 'START-MENU') resolvedTrackId = 'TR-SYS-CLI';
      else if (userId) resolvedTrackId = String(userId);
      else if (role === 'admin') resolvedTrackId = 'TR-ADMIN001';
      else resolvedTrackId = 'TR-SYS-001';
    }

    const logEntry = await M.Log.create({
      logTrackId,
      userName: resolvedUserName,
      role: role || (resolvedUserName === 'System' ? 'system' : 'admin'),
      trackId: resolvedTrackId,
      action: action || '',
      details: stringDetails,
      category: category || 'general',
      severity: severity || 'info',
      ip: cleanIp,
      sessionId: resolvedSessionId,
      location: resolvedLocation,
      module: mod,
      subType: subType,
      actingWithAdminRights: !!opts.actingWithAdminRights,
      encryptedPayload,
      changes: opts.changes || { before: null, after: null },
      attendanceSummary: opts.attendanceSummary || undefined,
      attendanceClassDaily: opts.attendanceClassDaily || undefined,
      time: new Date()
    });

    return logEntry;
  } catch (err) {
    console.error('[logAction Error]:', err.message);
    return null;
  }
}

function parseUserAgent(userAgent = '') {
  const ua = userAgent.toLowerCase();

  // Device Type
  let deviceType = 'Unknown';
  if (/tablet|ipad/.test(ua)) {
    deviceType = 'Tablet';
  } else if (/mobile|android|iphone/.test(ua)) {
    deviceType = 'Mobile';
  } else {
    deviceType = 'Desktop';
  }

  // Browser
  let browser = 'Other';
  if (ua.includes('brave')) {
    browser = 'Brave';
  } else if (ua.includes('edg')) {
    browser = 'Edge';
  } else if (ua.includes('opr') || ua.includes('opera')) {
    browser = 'Opera';
  } else if (ua.includes('firefox')) {
    browser = 'Firefox';
  } else if (ua.includes('chrome')) {
    browser = 'Chrome';
  } else if (ua.includes('safari')) {
    browser = 'Safari';
  }

  // OS
  let os = 'Other';
  if (ua.includes('windows')) {
    os = 'Windows';
  } else if (ua.includes('android')) {
    os = 'Android';
  } else if (ua.includes('iphone') || ua.includes('ipad')) {
    os = 'iOS';
  } else if (ua.includes('mac os') || ua.includes('macintosh')) {
    os = 'MacOS';
  } else if (ua.includes('linux')) {
    os = 'Linux';
  }

  return { deviceType, browser, os };
}

module.exports = { logAction, parseUserAgent, getNextLogTrackId, normalizeIp };

