/**
 * services/subAdminExpiryService.js
 *
 * Nightly Job: Grant Expiry & Expiry Reminders (§10, R7.5)
 *
 * Requirements:
 * - Active between validFrom and validTo
 * - 2 days before end: reminder notification
 * - On end: grant stops (computed per request & resolved via resolveAccess)
 * - Nightly job: marks ended grants, tidies accessRole to 'none' when no live grants remain, logs it
 * - Stale pending requests whose validity window passed are marked 'expired'
 */

const mongoose = require('mongoose');
const M = require('../models');
const { logAction } = require('../utils/logAction');

let _schedulerInterval = null;
let _initialTimeout = null;

async function runNightlyGrantExpiryJob() {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    console.warn('[Nightly Grant Expiry Job]: MongoDB not connected (readyState=' + (mongoose.connection ? mongoose.connection.readyState : 'none') + '), skipping run.');
    return { ok: false, error: 'Database not connected' };
  }

  const now = new Date();
  const twoDaysFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  let expiredGrantsCount = 0;
  let tidiedRolesCount = 0;
  let reminderCount = 0;
  let expiredRequestsCount = 0;

  try {
    // 1. Process Teachers with sub-admin grants
    const teachers = await M.Teacher.find({
      $or: [
        { 'pageRights.accessRole': 'subAdmin' },
        { 'pageRights.grants.0': { $exists: true } }
      ]
    });

    for (const teacher of teachers) {
      let pr = teacher.pageRights || { accessRole: 'none', version: 0, grants: [] };
      if (!Array.isArray(pr.grants)) continue;

      let changed = false;

      for (const g of pr.grants) {
        if (!g) continue;

        // Check if grant has passed validTo
        if (g.validTo && new Date(g.validTo) <= now) {
          if (g.enabled !== false) {
            g.enabled = false;
            g.endedAt = now;
            g.endReason = 'expired';
            changed = true;
            expiredGrantsCount++;
          }
        }
        // Check if grant expires within 2 days (send reminder once)
        else if (g.enabled !== false && g.validTo && new Date(g.validTo) <= twoDaysFromNow && new Date(g.validTo) > now) {
          if (!g.reminderSentAt || (now.getTime() - new Date(g.reminderSentAt).getTime() > 24 * 60 * 60 * 1000)) {
            g.reminderSentAt = now;
            changed = true;
            reminderCount++;

            // Create reminder notification for faculty member
            try {
              if (M.Notification) {
                const dateStr = new Date(g.validTo).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                await M.Notification.create({
                  type: 'info',
                  from: 'System Authority',
                  fromRole: 'system',
                  toTeacherId: teacher._id,
                  toTeacherName: teacher.fullName || '',
                  toTeacherTrackId: teacher.trackId || '',
                  message: `Sub-Admin Grant Expiring Soon: Your delegated access for "${g.page}" ends on ${dateStr}. Contact your administrator if an extension is required.`,
                  priority: 'High',
                  status: 'Pending'
                });
              }
            } catch (notifErr) {
              console.warn('[expiry reminder notification warn]:', notifErr.message);
            }
          }
        }
      }

      // Tidy accessRole to 'none' if no live grants remain
      const hasLiveGrant = pr.grants.some(g => g && g.enabled !== false && (!g.validTo || new Date(g.validTo) > now));
      const hasAdminSpecial = (teacher.specials || []).some(s => s && s.option === 'isAdmin');

      if (!hasLiveGrant && pr.accessRole === 'subAdmin' && !hasAdminSpecial) {
        pr.accessRole = 'none';
        changed = true;
        tidiedRolesCount++;
      }

      if (changed) {
        pr.version = (pr.version || 0) + 1;
        teacher.pageRights = { ...pr };
        teacher.markModified('pageRights');
        teacher.accessVersion = (teacher.accessVersion || 0) + 1;
        await teacher.save();
      }
    }

    // 2. Expire pending AccessRequests whose validTo has elapsed
    const pendingRequests = await M.AccessRequest.find({ status: 'pending' });
    for (const req of pendingRequests) {
      const allGrantsLapsed = (req.grants || []).every(g => g.validTo && new Date(g.validTo) <= now);
      if (allGrantsLapsed && (req.grants || []).length > 0) {
        req.status = 'expired';
        req.decisionNote = 'Requested validity window lapsed before decision.';
        await req.save();
        expiredRequestsCount++;
      }
    }

    if (expiredGrantsCount > 0 || tidiedRolesCount > 0 || reminderCount > 0 || expiredRequestsCount > 0) {
      await logAction(
        'SYSTEM',
        'Sub-Admin Expiry Worker',
        'system',
        'Sub-Admin Grants Nightly Reconciliation',
        `Reconciled sub-admin grants: ${expiredGrantsCount} expired, ${tidiedRolesCount} roles tidied to none, ${reminderCount} reminders dispatched, ${expiredRequestsCount} requests expired.`,
        'system',
        'info',
        '127.0.0.1',
        '',
        {
          module: 'admin',
          subType: 'grant-nightly-reconcile',
          expiredGrants: expiredGrantsCount,
          tidiedRoles: tidiedRolesCount,
          remindersSent: reminderCount,
          expiredRequests: expiredRequestsCount
        }
      );
    }

    return {
      ok: true,
      expiredGrants: expiredGrantsCount,
      tidiedRoles: tidiedRolesCount,
      remindersSent: reminderCount,
      expiredRequests: expiredRequestsCount
    };
  } catch (err) {
    console.error('[Nightly Grant Expiry Job Error]:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Start 24-hour scheduler for sub-admin grant expiries
 */
function startSubAdminExpiryScheduler() {
  if (_schedulerInterval) clearInterval(_schedulerInterval);
  if (_initialTimeout) clearTimeout(_initialTimeout);

  const scheduleInitialSweep = () => {
    // Run initial sweep 2s after DB connection to allow startup seeding to complete cleanly
    _initialTimeout = setTimeout(() => {
      runNightlyGrantExpiryJob().catch(e => console.warn('[Initial Grant Expiry Sweep Warn]:', e.message));
    }, 2000);
  };

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    scheduleInitialSweep();
  } else if (mongoose.connection) {
    mongoose.connection.once('connected', scheduleInitialSweep);
  }

  // Run every 24 hours
  _schedulerInterval = setInterval(() => {
    runNightlyGrantExpiryJob().catch(e => console.warn('[Nightly Grant Expiry Sweep Warn]:', e.message));
  }, 24 * 60 * 60 * 1000);

  if (_schedulerInterval.unref) _schedulerInterval.unref();
}

function stopSubAdminExpiryScheduler() {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
  }
  if (_initialTimeout) {
    clearTimeout(_initialTimeout);
    _initialTimeout = null;
  }
}

module.exports = {
  runNightlyGrantExpiryJob,
  startSubAdminExpiryScheduler,
  stopSubAdminExpiryScheduler
};
