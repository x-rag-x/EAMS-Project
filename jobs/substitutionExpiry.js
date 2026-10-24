const M = require('../models');
const { getTodayIST } = require('../middleware/scope');
const { getSettings } = require('../utils/settingsCache');

/**
 * Expire unanswered substitution requests within 2 hours of the scheduled period
 * 
 * @param {string} [customToday] Optional IST date string (YYYY-MM-DD)
 * @param {string} [customTime] Optional current time 'HH:MM'
 * @returns {Promise<{ expiredCount: number }>}
 */
async function expireSubstitutions(customToday = null, customTime = null) {
  const todayIST = customToday || getTodayIST();
  const settings = await getSettings(['substitution']);
  const expireMin = Number(settings.substitution?.expireBeforePeriodMin) || 120;

  let currentMin = 0;
  if (typeof customTime === 'number') {
    currentMin = customTime;
  } else if (typeof customTime === 'string') {
    const [h, m] = customTime.split(':').map(Number);
    currentMin = h * 60 + m;
  } else {
    const d = new Date();
    const istTime = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(d);
    const [h, m] = istTime.split(':').map(Number);
    currentMin = h * 60 + m;
  }

  // Find requests covering today with pending substitutions
  const activeRequests = await M.TeacherLeaveRequest.find({
    dates: todayIST,
    status: { $in: ['draft', 'pending_hod', 'pending_principal', 'Pending'] },
    'substitutions.status': { $in: ['pending', 'requested'] }
  });

  let expiredCount = 0;

  for (const req of activeRequests) {
    let modified = false;
    for (const sub of req.substitutions) {
      if (sub.date === todayIST && ['pending', 'requested'].includes(sub.status)) {
        // Approximate standard college period start:
        // P1: 08:30 (510 min), P2: 09:20 (560 min), P3: 10:20 (620 min), etc.
        const pNum = Number(sub.periodNumber) || 1;
        const periodStartMinutes = 510 + (pNum - 1) * 55;

        if (periodStartMinutes - currentMin <= expireMin) {
          sub.status = 'expired';
          sub.rejectionReason = 'Request expired (no answer 2 hours before period)';
          sub.isUnresolved = true;
          modified = true;
          expiredCount++;
        }
      }
    }
    if (modified) {
      await req.save();
    }
  }

  return { expiredCount };
}

module.exports = {
  expireSubstitutions
};
