const M = require('../models');
const { verifyCampusGeofence } = require('./geofence');
const { deriveSessionState } = require('./sessionState');
const { broadcastSSE } = require('./eventBus');
const { getSettings } = require('./settingsCache');

/**
 * Hook triggered when a teacher taps ▶ Start Class.
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.teacherTrackId
 * @param {number|null} [params.lat]
 * @param {number|null} [params.lng]
 * @param {string} [params.geoStatus]
 * @returns {Promise<Object>} Updated session and geofence result
 */
async function onStartClass({ sessionId, teacherTrackId, lat = null, lng = null, geoStatus = null }) {
  const session = await M.ClassSession.findById(sessionId);
  if (!session) {
    throw new Error('Class session not found');
  }

  // Verify campus geofence
  const geoResult = await verifyCampusGeofence({ lat, lng, geoStatus });

  session.startClass = {
    at: new Date(),
    geo: geoResult.status // 'ok' | 'outside' | 'denied'
  };

  if (!Array.isArray(session.flags)) session.flags = [];
  if (geoResult.status === 'outside' && !session.flags.includes('outside_campus')) {
    session.flags.push('outside_campus');
  }
  if (geoResult.status === 'denied' && !session.flags.includes('location_denied')) {
    session.flags.push('location_denied');
  }

  session.updatedAt = new Date();
  await session.save();

  // Broadcast real-time update to Live Board
  const settings = await getSettings(['controller']);
  const derived = deriveSessionState(session, new Date(), settings.controller);
  broadcastSSE('session.update', {
    sessionId: session._id,
    session,
    derived
  }, session.deptCode);

  return {
    session,
    geoResult
  };
}

/**
 * Hook triggered whenever attendance is saved for a period.
 *
 * @param {Object} params
 * @param {string} params.classId
 * @param {string} params.date - YYYY-MM-DD
 * @param {number} params.periodNumber
 * @param {string} params.savedBy - trackId or username
 * @param {Object} params.counts - { present, absent, od, leave, hostelLeave, total }
 */
async function onAttendanceSaved({ classId, date, periodNumber, savedBy, counts }) {
  const session = await M.ClassSession.findOne({
    classId: String(classId),
    date: String(date),
    periodNumber: Number(periodNumber)
  });

  if (!session) {
    // If no ClassSession pre-created yet for this slot, return silently
    return null;
  }

  const settings = await getSettings(['controller']);
  const deadlineMin = Number(settings.controller?.attendanceDeadlineMin) || 10;

  // Calculate minutes after slot start time
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);
  const hour = Number(parts.find(p => p.type === 'hour')?.value || 0);
  const min = Number(parts.find(p => p.type === 'minute')?.value || 0);
  const currentMinutes = hour * 60 + min;

  const [startH, startM] = (session.start || '00:00').split(':').map(Number);
  const startMinutes = (startH || 0) * 60 + (startM || 0);
  const minutesAfterStart = Math.max(0, currentMinutes - startMinutes);
  const onTime = minutesAfterStart <= deadlineMin;

  if (session && typeof session === 'object') {
    session.attendance = {
      savedAt: now,
      savedBy,
      minutesAfterStart,
      onTime,
      present: counts.present || 0,
      absent: counts.absent || 0,
      od: counts.od || 0,
      leave: counts.leave || 0,
      hostelLeave: counts.hostelLeave || 0,
      total: counts.total || (counts.present + counts.absent)
    };
  }

  if (!session.startClass?.at && !session.flags.includes('no_start_tap')) {
    session.flags.push('no_start_tap');
  }

  session.updatedAt = now;
  await session.save();

  // Auto-resolve Alert A1 if it was open for this session
  const alertKey = `A1:${date}:${classId}:${periodNumber}`;
  const alertDoc = await M.Alert.findOneAndUpdate(
    { alertKey, status: 'active' },
    {
      status: 'resolved',
      resolvedAt: now,
      autoResolved: true
    },
    { returnDocument: 'after' }
  );

  if (alertDoc) {
    broadcastSSE('alert.resolved', { alertId: alertDoc._id, alertKey }, session.deptCode);
  }

  // Broadcast session tile update to Live Board
  const derived = deriveSessionState(session, now, settings.controller);
  broadcastSSE('session.update', {
    sessionId: session._id,
    session,
    derived
  }, session.deptCode);

  return session;
}

module.exports = {
  onStartClass,
  onAttendanceSaved
};
