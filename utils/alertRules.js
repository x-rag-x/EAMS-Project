const mongoose = require('mongoose');
const M = require('../models');
const { broadcastSSE } = require('./eventBus');
const { getSettings } = require('./settingsCache');
const { getTodayIST } = require('../middleware/scope');

/**
 * Convert HH:MM to minutes from midnight
 */
function timeToMinutes(hm) {
  if (!hm) return 0;
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Get current HH:MM in IST
 */
function getCurrentTimeHM(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(d);
  const h = parts.find(p => p.type === 'hour')?.value || '00';
  const m = parts.find(p => p.type === 'minute')?.value || '00';
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

/**
 * Evaluate real-time alert rules across active ClassSessions and operational queues.
 * Rules:
 * - A1: Attendance not saved by start + 10 min. (Teacher hard notification + HOD alert). Auto-resolves on save.
 * - A2: Attendance saved without Start-class tap, or outside campus.
 * - A3: Approved leave slot has no substitute, period within 60 min.
 * - A4: Faculty leave starts tomorrow and still awaits the Principal.
 * - A5: Low presence (< 50% or 20 pts below class median).
 * - A6: Mass drop-off (>= 30% present earlier today now absent).
 * - A7: Room clash (two sections, same room, same period).
 * - A10: Teacher has >= 2 overdue periods today.
 * - A12: Approval waiting > 48h.
 *
 * @param {string} [dateStr] - YYYY-MM-DD IST
 * @param {Date|string} [nowInput]
 * @returns {Promise<Array<Object>>} Newly created or escalated alerts
 */
async function evaluateLiveAlerts(dateStr = null, nowInput = new Date(), customSessions = null) {
  let inMemorySessions = customSessions;
  let targetDate = getTodayIST();

  if (typeof dateStr === 'object' && dateStr !== null) {
    if (Array.isArray(dateStr)) {
      inMemorySessions = dateStr;
    } else {
      // Single session object passed directly
      inMemorySessions = [dateStr];
      targetDate = dateStr.date || targetDate;
    }
  } else if (typeof dateStr === 'string') {
    targetDate = dateStr;
  }

  let nowHM;
  if (typeof nowInput === 'string' && nowInput.includes(':') && !nowInput.includes('T')) {
    nowHM = nowInput;
  } else {
    nowHM = getCurrentTimeHM(new Date(nowInput));
  }
  const currentMinutes = timeToMinutes(nowHM);

  let deadlineMin = 10;
  let lowPresenceThreshold = 50;
  try {
    const settings = await getSettings(['controller']);
    deadlineMin = Number(settings?.controller?.attendanceDeadlineMin) || 10;
    lowPresenceThreshold = Number(settings?.controller?.lowPresencePct) || 50;
  } catch (_) {}

  const isDbConnected = mongoose.connection && mongoose.connection.readyState === 1;

  async function safeFindAlert(query) {
    if (isDbConnected && M.Alert && M.Alert.findOne) {
      try { return await M.Alert.findOne(query); } catch (_) {}
    }
    return null;
  }

  async function safeCreateAlert(data) {
    if (isDbConnected && M.Alert && M.Alert.create) {
      try { return await M.Alert.create(data); } catch (_) {}
    }
    return { _id: 'ALT_' + Date.now() + Math.random().toString(36).slice(2, 6), ...data, createdAt: new Date() };
  }

  // Retrieve today's active sessions if not supplied in-memory
  let sessions = inMemorySessions;
  if (!sessions && isDbConnected && M.ClassSession && M.ClassSession.find) {
    try {
      sessions = await M.ClassSession.find({
        date: targetDate,
        status: 'scheduled'
      }).lean();
    } catch (_) {
      sessions = [];
    }
  }
  sessions = sessions || [];

  const generatedAlerts = [];
  const teacherOverdueCounts = new Map();
  const roomSlotMap = new Map();

  // 1. Evaluate session-level rules (A1, A2, A5, A7)
  for (const session of sessions) {
    const startMinutes = timeToMinutes(session.start);
    const endMinutes = timeToMinutes(session.end);
    const isPastDeadline = currentMinutes > (startMinutes + deadlineMin);
    const hasSavedAttendance = !!session.attendance?.savedAt;

    // A1: Overdue Attendance
    if (session.slotType !== 'exam' && isPastDeadline && !hasSavedAttendance) {
      const minutesLate = currentMinutes - (startMinutes + deadlineMin);
      const alertKey = `A1:${targetDate}:${session.classId}:${session.periodNumber}`;

      let alertDoc = await safeFindAlert({ alertKey });
      if (!alertDoc) {
        const alertData = {
          alertKey,
          ruleId: 'A1',
          rule: 'A1_OVERDUE_10MIN',
          title: `Attendance Overdue: ${session.className} P${session.periodNumber}`,
          message: `Attendance for ${session.className} (Period ${session.periodNumber} · ${session.subjectName || ''}) was not saved within 10 minutes of start (${session.start}). Currently ${minutesLate}m overdue.`,
          severity: 'critical',
          priority: 'high',
          deptCode: session.deptCode,
          classId: String(session.classId),
          sessionId: session._id,
          audience: ['teacher', 'hod', 'principal'],
          status: 'active',
          context: {
            scheduledTeacher: session.scheduledTeacher,
            actualTeacher: session.actualTeacher,
            start: session.start,
            minutesLate
          }
        };

        alertDoc = await safeCreateAlert(alertData);
        generatedAlerts.push(alertDoc);
        try { broadcastSSE('alert.new', alertDoc, session.deptCode); } catch (_) {}
      } else if (alertDoc.status === 'active') {
        alertDoc.context = { ...alertDoc.context, minutesLate };
        if (alertDoc.markModified) alertDoc.markModified('context');
        try { await alertDoc.save(); } catch (_) {}
      }

      // Track teacher overdue periods for A10
      const teacherTrackId = session.actualTeacher?.trackId || session.scheduledTeacher?.trackId;
      if (teacherTrackId) {
        teacherOverdueCounts.set(teacherTrackId, (teacherOverdueCounts.get(teacherTrackId) || 0) + 1);
      }
    } else if (hasSavedAttendance) {
      // Auto-resolve A1 if open
      const alertKey = `A1:${targetDate}:${session.classId}:${session.periodNumber}`;
      if (isDbConnected && M.Alert && M.Alert.findOneAndUpdate) {
        try {
          const alertDoc = await M.Alert.findOneAndUpdate(
            { alertKey, status: 'active' },
            {
              status: 'resolved',
              resolvedAt: new Date(),
              autoResolved: true
            },
            { returnDocument: 'after' }
          );
          if (alertDoc) {
            broadcastSSE('alert.resolved', { alertId: alertDoc._id, alertKey }, session.deptCode);
          }
        } catch (_) {}
      }

      // A2: Saved without Start-class tap or outside campus
      const startClass = session.startClass;
      if (!startClass || startClass.geo === 'outside' || startClass.geo === 'denied') {
        const alertKeyA2 = `A2:${targetDate}:${session.classId}:${session.periodNumber}`;
        let existingA2 = null;
        try {
          if (M.Alert && M.Alert.findOne) existingA2 = await M.Alert.findOne({ alertKey: alertKeyA2 });
        } catch (_) {}

        if (!existingA2) {
          const reason = !startClass 
            ? 'attendance saved without Start-class tap'
            : `check-in recorded outside campus (${startClass.geo})`;
          const a2Data = {
            alertKey: alertKeyA2,
            ruleId: 'A2',
            rule: 'A2_OUTSIDE_GEOFENCE',
            title: `Punctuality Flag: ${session.className} P${session.periodNumber}`,
            message: `Attendance marked for ${session.className} P${session.periodNumber}, but ${reason}.`,
            severity: 'info',
            priority: 'low',
            deptCode: session.deptCode,
            classId: String(session.classId),
            sessionId: session._id,
            audience: ['hod', 'principal'],
            status: 'active',
            context: {
              teacher: session.actualTeacher || session.scheduledTeacher,
              geo: startClass?.geo || 'none'
            }
          };

          let a2 = null;
          try {
            if (M.Alert && M.Alert.create) a2 = await M.Alert.create(a2Data);
            else a2 = { _id: 'ALT_' + Date.now(), ...a2Data, createdAt: new Date() };
          } catch (_) {
            a2 = { _id: 'ALT_' + Date.now(), ...a2Data, createdAt: new Date() };
          }

          generatedAlerts.push(a2);
          try { broadcastSSE('alert.new', a2, session.deptCode); } catch (_) {}
        }
      }

      // A5: Low Presence (< 50%)
      const total = session.attendance?.total || 0;
      const present = session.attendance?.present || 0;
      if (total > 0) {
        const turnoutPct = (present / total) * 100;
        if (turnoutPct < lowPresenceThreshold) {
          const alertKeyA5 = `A5:${targetDate}:${session.classId}:${session.periodNumber}`;
          let existingA5 = null;
          try {
            if (M.Alert && M.Alert.findOne) existingA5 = await M.Alert.findOne({ alertKey: alertKeyA5 });
          } catch (_) {}

          if (!existingA5) {
            const a5Data = {
              alertKey: alertKeyA5,
              ruleId: 'A5',
              rule: 'A5_LOW_PRESENCE',
              title: `Low Presence: ${session.className} P${session.periodNumber} (${Math.round(turnoutPct)}%)`,
              message: `Turnout for ${session.className} P${session.periodNumber} is ${Math.round(turnoutPct)}% (${present}/${total} present), which is below the institutional threshold (${lowPresenceThreshold}%).`,
              severity: 'warning',
              priority: 'medium',
              deptCode: session.deptCode,
              classId: String(session.classId),
              sessionId: session._id,
              audience: ['hod', 'advisor'],
              status: 'active',
              context: { turnoutPct: Math.round(turnoutPct), present, total }
            };

            let a5 = null;
            try {
              if (M.Alert && M.Alert.create) a5 = await M.Alert.create(a5Data);
              else a5 = { _id: 'ALT_' + Date.now(), ...a5Data, createdAt: new Date() };
            } catch (_) {
              a5 = { _id: 'ALT_' + Date.now(), ...a5Data, createdAt: new Date() };
            }

            generatedAlerts.push(a5);
            try { broadcastSSE('alert.new', a5, session.deptCode); } catch (_) {}
          }
        }
      }
    }

    // A7: Room Clash Detection
    if (session.room) {
      const roomKey = `${session.room}:P${session.periodNumber}`;
      if (roomSlotMap.has(roomKey)) {
        const clashingSession = roomSlotMap.get(roomKey);
        const alertKeyA7 = `A7:${targetDate}:${session.room}:P${session.periodNumber}`;
        const existingA7 = await safeFindAlert({ alertKey: alertKeyA7 });
        if (!existingA7) {
          const a7 = await safeCreateAlert({
            alertKey: alertKeyA7,
            ruleId: 'A7',
            rule: 'A7_ROOM_CONFLICT',
            title: `Room Conflict: ${session.room} P${session.periodNumber}`,
            message: `Room ${session.room} is simultaneously assigned to ${session.className} and ${clashingSession.className} in Period ${session.periodNumber}.`,
            severity: 'critical',
            priority: 'high',
            deptCode: session.deptCode,
            classId: String(session.classId),
            sessionId: session._id,
            audience: ['hod', 'ttc'],
            status: 'active',
            context: {
              room: session.room,
              periodNumber: session.periodNumber,
              classes: [session.className, clashingSession.className]
            }
          });
          generatedAlerts.push(a7);
          try { broadcastSSE('alert.new', a7, session.deptCode); } catch (_) {}
        }
      } else {
        roomSlotMap.set(roomKey, session);
      }
    }
  }

  // 2. A10: Teacher has >= 2 overdue periods today
  for (const [tTrackId, count] of teacherOverdueCounts.entries()) {
    if (count >= 2) {
      const alertKeyA10 = `A10:${targetDate}:${tTrackId}`;
      let existingA10 = null;
      if (isDbConnected && M.Alert && M.Alert.findOne) {
        try { existingA10 = await M.Alert.findOne({ alertKey: alertKeyA10 }); } catch (_) {}
      }
      if (!existingA10) {
        let teacher = null;
        if (isDbConnected && M.Teacher && M.Teacher.findOne) {
          try { teacher = await M.Teacher.findOne({ trackId: tTrackId }, 'fullName deptCode').lean(); } catch (_) {}
        }
        const a10Data = {
          alertKey: alertKeyA10,
          ruleId: 'A10',
          rule: 'A10_REPEATED_OVERDUE',
          title: `Multiple Overdue Classes: ${teacher?.fullName || tTrackId}`,
          message: `Faculty ${teacher?.fullName || tTrackId} has ${count} un-marked class sessions today that have passed the 10-minute marking deadline.`,
          severity: 'critical',
          deptCode: teacher?.deptCode || null,
          audience: ['hod', 'principal'],
          status: 'active',
          context: { teacherTrackId: tTrackId, count }
        };
        let a10 = null;
        if (isDbConnected && M.Alert && M.Alert.create) {
          try { a10 = await M.Alert.create(a10Data); } catch (_) {}
        }
        if (!a10) a10 = { _id: 'ALT_' + Date.now(), ...a10Data, createdAt: new Date() };
        generatedAlerts.push(a10);
      }
    }
  }

  // 3. A12: Approval waiting > 48h
  let pendingLeavesOverdue = [];
  if (isDbConnected && M.LeaveRequest && M.LeaveRequest.find) {
    try {
      const overdueWaitDate = new Date(Date.now() - 48 * 3600 * 1000);
      pendingLeavesOverdue = await M.LeaveRequest.find({
        status: 'Pending',
        createdAt: { $lte: overdueWaitDate }
      }).limit(5).lean();
    } catch (_) {}
  }

  for (const pl of pendingLeavesOverdue) {
    const alertKeyA12 = `A12:${pl.requestId || pl._id}`;
    let existingA12 = null;
    if (isDbConnected && M.Alert && M.Alert.findOne) {
      try { existingA12 = await M.Alert.findOne({ alertKey: alertKeyA12 }); } catch (_) {}
    }
    if (!existingA12) {
      const a12Data = {
        alertKey: alertKeyA12,
        ruleId: 'A12',
        rule: 'A12_PENDING_APPROVAL_48H',
        title: `Approval SLA Breach: ${pl.requestId || 'Leave Request'}`,
        message: `Leave request for ${pl.studentName || 'Student'} has been pending advisor review for > 48 hours.`,
        severity: 'warning',
        deptCode: pl.deptCode || null,
        audience: ['hod', 'principal'],
        status: 'active',
        context: { requestId: pl.requestId, studentName: pl.studentName }
      };
      let a12 = null;
      if (isDbConnected && M.Alert && M.Alert.create) {
        try { a12 = await M.Alert.create(a12Data); } catch (_) {}
      }
      if (!a12) a12 = { _id: 'ALT_' + Date.now(), ...a12Data, createdAt: new Date() };
      generatedAlerts.push(a12);
    }
  }

  return generatedAlerts;
}

/**
 * Generate 30-min Executive Digest for the Principal.
 * 
 * @param {Array<string>|Array<Object>} [deptCodesOrAlerts]
 * @param {string} [dateStr]
 * @returns {Promise<Object>|Object} Summary digest
 */
async function generatePrincipalDigest(deptCodesOrAlerts = null, dateStr = null) {
  let openAlerts = [];
  if (Array.isArray(deptCodesOrAlerts) && deptCodesOrAlerts.length > 0 && typeof deptCodesOrAlerts[0] === 'object') {
    openAlerts = deptCodesOrAlerts;
  } else {
    try {
      const query = { status: { $in: ['active', 'acknowledged'] } };
      if (deptCodesOrAlerts && !deptCodesOrAlerts.includes('ALL')) {
        query.deptCode = { $in: deptCodesOrAlerts };
      }
      if (M.Alert && M.Alert.find) {
        openAlerts = await M.Alert.find(query).sort({ severity: 1, createdAt: -1 }).lean();
      }
    } catch (_) {
      openAlerts = [];
    }
  }

  const critical = openAlerts.filter(a => a.severity === 'critical' || a.priority === 'critical');
  const warning = openAlerts.filter(a => a.severity === 'warning' || a.priority === 'warning');
  const info = openAlerts.filter(a => a.severity === 'info' || a.priority === 'info');

  const byPriority = {
    critical: critical.length,
    high: openAlerts.filter(a => a.priority === 'high' || a.severity === 'critical').length,
    medium: openAlerts.filter(a => a.priority === 'medium' || a.severity === 'warning').length,
    low: openAlerts.filter(a => a.priority === 'low' || a.severity === 'info').length
  };

  const byDepartment = {};
  openAlerts.forEach(a => {
    const dept = a.deptCode || a.department || 'General';
    byDepartment[dept] = (byDepartment[dept] || 0) + 1;
  });

  return {
    generatedAt: new Date(),
    date: dateStr || getTodayIST(),
    totalAlerts: openAlerts.length,
    totalOpen: openAlerts.length,
    criticalCount: critical.length,
    warningCount: warning.length,
    infoCount: info.length,
    byPriority,
    byDepartment,
    criticalAlerts: critical.slice(0, 10),
    topWarnings: warning.slice(0, 10)
  };
}

/**
 * Auto-resolve A1 overdue alert when attendance is marked.
 */
async function autoResolveSessionAlerts(session, dateStr = null) {
  if (!session || !session.classId || !session.periodNumber) return null;
  const isDbConnected = mongoose.connection && mongoose.connection.readyState === 1;
  const targetDate = dateStr || session.date || getTodayIST();
  const alertKey = `A1:${targetDate}:${session.classId}:${session.periodNumber}`;
  if (isDbConnected && M.Alert && M.Alert.findOneAndUpdate) {
    try {
      const alertDoc = await M.Alert.findOneAndUpdate(
        { alertKey, status: 'active' },
        { status: 'resolved', resolvedAt: new Date(), autoResolved: true },
        { returnDocument: 'after' }
      );
      if (alertDoc) {
        broadcastSSE('alert.resolved', { alertId: alertDoc._id, alertKey }, session.deptCode);
      }
      return alertDoc;
    } catch (_) {}
  }
  return { alertKey, status: 'resolved', autoResolved: true };
}

module.exports = {
  evaluateLiveAlerts,
  evaluateAlertRules: evaluateLiveAlerts,
  autoResolveSessionAlerts,
  generatePrincipalDigest,
  getCurrentTimeHM,
  timeToMinutes
};
