/**
 * utils/sessionMigration.js — S7.6 One-Off / Startup Copy of Active Sessions
 *
 * Ensures all currently active sessions recorded in LoginHistory
 * are synchronized into the standalone LoginSession collection without disrupting users.
 */

const M = require('../models');

async function syncActiveLoginSessions() {
  try {
    const histories = await M.LoginHistory.find({
      'history.active': true,
      'history.current': 'Logged In'
    }).lean();

    if (!histories || histories.length === 0) return 0;

    let copiedCount = 0;
    const now = new Date();

    for (const lh of histories) {
      const activeSessions = (lh.history || []).filter(h => h.active && h.current === 'Logged In' && h.sessionId);

      for (const s of activeSessions) {
        const expiresAt = s.expiresAt && new Date(s.expiresAt) > now
          ? new Date(s.expiresAt)
          : new Date(now.getTime() + 60 * 60 * 1000);

        const existing = await M.LoginSession.findOne({ sessionId: s.sessionId }).lean();
        if (!existing) {
          await M.LoginSession.create({
            trackId:         lh.trackId,
            username:        lh.username,
            sessionId:       s.sessionId,
            role:            lh.role,
            identityType:    s.identityType || lh.identityType || 'human',
            sessionClass:    s.sessionClass || (lh.role === 'student' ? 'student' : 'staff'),
            deviceId:        s.deviceId || '',
            deviceInstallId: s.deviceInstallId || '',
            deviceName:      s.deviceName || '',
            deviceInfo:      s.deviceInfo || null,
            ip:              s.ip || '',
            ua:              s.userAgent || '',
            userAgent:       s.userAgent || '',
            location:        s.location || {},
            createdAt:       s.createdAt || s.loginTime || s.time || now,
            loginTime:       s.loginTime || s.time || now,
            lastActivity:    s.lastActivity || now,
            expiresAt:       expiresAt,
            active:          true,
            authToken:       s.authToken || null,
          });
          copiedCount++;
        }
      }
    }

    if (copiedCount > 0) {
      console.log(`[sessionMigration] Synchronized ${copiedCount} active sessions into LoginSession collection.`);
    }
    return copiedCount;
  } catch (err) {
    console.error('[sessionMigration error]', err.message);
    return 0;
  }
}

module.exports = { syncActiveLoginSessions };
