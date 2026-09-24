const M = require('../models');

function startSessionMonitor() {
  // Check every 10 seconds
  setInterval(async () => {
    try {
      const now = new Date();
      const histories = await M.LoginHistory.find({
        history: { $elemMatch: { active: true, current: 'Logged In' } }
      });

      if (!histories.length) return;

      // Fetch dynamic security settings
      const secSettings = await M.Settings.findOne({ key: 'security' }).lean();
      const security = secSettings?.value || {};
      const globalTimeoutMins = security.sessionTimeoutMins !== undefined ? Number(security.sessionTimeoutMins) : 60;
      
      for (const lh of histories) {
        let updated = false;
        
        for (const session of lh.history) {
          if (session.active && session.current === 'Logged In') {
            if (now >= session.expiresAt) {
              const lastAct = session.lastActivity || session.loginTime || session.time;
              const elapsedMs = now.getTime() - new Date(lastAct).getTime();
              
              // Dynamic limit from settings
              let limitMins = globalTimeoutMins;
              if (lh.role === 'admin' && security.adminInactivityMins) limitMins = Number(security.adminInactivityMins);
              else if (lh.role === 'teacher' && security.teacherInactivityMins) limitMins = Number(security.teacherInactivityMins);
              else if (lh.role === 'student' && security.studentInactivityMins) limitMins = Number(security.studentInactivityMins);
              
              const limitMs = limitMins * 60 * 1000;
              
              if (elapsedMs < limitMs) {
                // User is still active — extend expiresAt by 15 more minutes
                session.expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
                updated = true;
              } else {
                // User is inactive — mark auto logged out
                session.active = false;
                session.current = 'Logged Out';
                session.logoutTime = now;
                session.logoutMethod = 'auto';
                updated = true;
                
                // Set online = false in UserSchema
                await M.User.updateOne({ trackId: lh.trackId }, { $set: { online: false } });
              }
            }
          }
        }
        
        if (updated) {
          await lh.save({ validateBeforeSave: false });
        }
      }
    } catch (err) {
      console.error("No Network connected");
      // console.error('Session monitor error:', err.message);
    }
  }, 10000);
}

module.exports = { startSessionMonitor };

