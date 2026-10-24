const M = require('../models');
const { getSettings } = require('./settingsCache');

/**
 * Session Inactivity & Expiry Monitor (§3.10, S7.4)
 * Executes atomic updateMany sweeps per role directly on M.LoginSession without document loading.
 * Preserves 15-day student-device sessions (sessionClass === 'student-device').
 * Synchronizes User.online and legacy LoginHistory when sessions are deactivated.
 */
function startSessionMonitor() {
  // Check every 10 seconds
  setInterval(async () => {
    try {
      const now = new Date();

      // Fetch dynamic security settings from cached source of truth (§3.9, F17)
      const secSettings = await getSettings(['security']);
      const security = secSettings?.security || {};
      const globalTimeoutMins = security.sessionTimeoutMins !== undefined ? Number(security.sessionTimeoutMins) : 60;

      const adminMins = Number(security.adminInactivityMins || globalTimeoutMins);
      const teacherMins = Number(security.teacherInactivityMins || globalTimeoutMins);
      const studentMins = Number(security.studentInactivityMins || globalTimeoutMins);
      const boardMins = Number(security.boardInactivityMins || globalTimeoutMins);

      // Perform atomic updateMany per role on LoginSession without loading documents (§3.10, S7.4)
      const sweepPromises = [
        // Admin sessions inactive sweep
        M.LoginSession.updateMany(
          { active: true, role: 'admin', lastActivity: { $lt: new Date(now.getTime() - adminMins * 60 * 1000) } },
          { $set: { active: false, logoutAt: now, logoutMethod: 'auto' } }
        ),
        // Teacher sessions inactive sweep
        M.LoginSession.updateMany(
          { active: true, role: 'teacher', lastActivity: { $lt: new Date(now.getTime() - teacherMins * 60 * 1000) } },
          { $set: { active: false, logoutAt: now, logoutMethod: 'auto' } }
        ),
        // Student sessions inactive sweep (excluding 15-day student-device sessions)
        M.LoginSession.updateMany(
          {
            active: true,
            role: 'student',
            sessionClass: { $ne: 'student-device' },
            lastActivity: { $lt: new Date(now.getTime() - studentMins * 60 * 1000) }
          },
          { $set: { active: false, logoutAt: now, logoutMethod: 'auto' } }
        ),
        // Board sessions inactive sweep
        M.LoginSession.updateMany(
          { active: true, role: 'board', lastActivity: { $lt: new Date(now.getTime() - boardMins * 60 * 1000) } },
          { $set: { active: false, logoutAt: now, logoutMethod: 'auto' } }
        ),
        // Hard expiresAt limit reached across any active session
        M.LoginSession.updateMany(
          { active: true, expiresAt: { $lte: now } },
          { $set: { active: false, logoutAt: now, logoutMethod: 'auto' } }
        )
      ];

      const sweepResults = await Promise.all(sweepPromises);
      const totalDeactivated = sweepResults.reduce((acc, r) => acc + (r.modifiedCount || 0), 0);

      // If any sessions were deactivated, synchronize User.online and legacy LoginHistory
      if (totalDeactivated > 0) {
        const onlineUsers = await M.User.find({ online: true }).select('trackId').lean();
        if (onlineUsers.length) {
          const onlineTrackIds = onlineUsers.map(u => u.trackId).filter(Boolean);
          const stillActiveTrackIds = await M.LoginSession.distinct('trackId', {
            trackId: { $in: onlineTrackIds },
            active: true
          });
          const stillActiveSet = new Set(stillActiveTrackIds);
          const offlineTrackIds = onlineTrackIds.filter(tid => !stillActiveSet.has(tid));

          if (offlineTrackIds.length) {
            await Promise.all([
              M.User.updateMany({ trackId: { $in: offlineTrackIds } }, { $set: { online: false } }),
              M.LoginHistory.updateMany(
                { trackId: { $in: offlineTrackIds } },
                {
                  $set: {
                    'history.$[elem].active': false,
                    'history.$[elem].current': 'Logged Out',
                    'history.$[elem].logoutTime': now,
                    'history.$[elem].logoutMethod': 'auto'
                  }
                },
                { arrayFilters: [{ 'elem.active': true }] }
              ).catch(() => {})
            ]);
          }
        }
      }
    } catch (err) {
      // Non-fatal background monitor error — silently ignore transient socket disconnects
    }
  }, 10000);
}

module.exports = { startSessionMonitor };

