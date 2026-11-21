const mongoose = require('mongoose');
const M = require('../models');
const { getTodayIST } = require('../middleware/scope');

/**
 * Sync Acting Roles (activate on start date, end when period expires)
 * Typically runs at midnight IST.
 * 
 * @param {string} [customToday] Optional IST date string (YYYY-MM-DD)
 * @returns {Promise<{ activated: number, ended: number }>}
 */
async function syncActingRoles(customToday = null) {
  const todayIST = customToday || getTodayIST();
  let activated = 0;
  let ended = 0;

  // 1. Activate pending roles that reach their start date
  const pendingRoles = await M.ActingRole.find({
    status: 'pending',
    from: { $lte: todayIST },
    to: { $gte: todayIST }
  });

  for (const role of pendingRoles) {
    role.status = 'active';
    await role.save();
    activated++;

    // Notify holder of active role
    await M.Notification.create({
      type: 'acting-role-active',
      from: 'Muster System',
      fromRole: 'system',
      toTeacherTrackId: role.holderTrackId,
      message: `Your Acting ${role.role.toUpperCase()} assignment for ${role.key} is now ACTIVE (${role.from} to ${role.to}).`,
      priority: 'Normal',
      time: new Date()
    }).catch(() => {});
  }

  // 2. End active roles whose end date has passed
  const expiredRoles = await M.ActingRole.find({
    status: 'active',
    to: { $lt: todayIST }
  });

  for (const role of expiredRoles) {
    role.status = 'ended';
    await role.save();
    ended++;
  }

  return { activated, ended };
}

let actingRolesInterval = null;

function startJob(intervalMs = 60 * 60 * 1000) {
  if (actingRolesInterval) return;
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    syncActingRoles().catch(err => {
      console.warn('[Acting Roles Sync Initial Run Error]:', err.message);
    });
  }
  actingRolesInterval = setInterval(() => {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      syncActingRoles().catch(err => {
        console.warn('[Acting Roles Sync Periodic Error]:', err.message);
      });
    }
  }, intervalMs);
  if (actingRolesInterval.unref) actingRolesInterval.unref();
}

function stopJob() {
  if (actingRolesInterval) {
    clearInterval(actingRolesInterval);
    actingRolesInterval = null;
  }
}

module.exports = {
  syncActingRoles,
  startJob,
  stopJob
};
