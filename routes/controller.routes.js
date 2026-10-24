const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { controllerAuth } = require('../middleware/hodAuth');
const { scopeMiddleware } = require('../middleware/scope');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { getLiveBoardSnapshot, getDayMatrixSnapshot } = require('../utils/liveBoard');
const { createStreamTicket, consumeStreamTicket, registerClient, broadcastSSE } = require('../utils/eventBus');
const { generateDailyClassSessions } = require('../jobs/dayStart');
const { evaluateLiveAlerts, generatePrincipalDigest, getCurrentTimeHM, timeToMinutes } = require('../utils/alertRules');
const { getFreeTeachers } = require('../utils/freeTeachers');
const { calculateAttendancePct, calculateDefaulterBand, calculateClassesNeeded } = require('../utils/attendanceMath');
const { getTodayIST } = require('../middleware/scope');
const { decryptLog } = require('../utils/logCrypto');
const { todayIST } = require('../utils/institutionTime');

// 0a. GET /api/controller/stream — Browser EventSource stream (authenticated via one-time ticket)
router.get('/stream', async (req, res) => {
  const ticket = sanitizeToString(req.query.ticket);
  const clientInfo = consumeStreamTicket(ticket);
  if (!clientInfo) {
    return res.status(401).send('Invalid or expired stream ticket');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  res.write(': connected\n\n');
  registerClient(res, clientInfo);
});

// Apply base authentication and controller role gate to all remaining controller routes
router.use(authMiddleware);
router.use(scopeMiddleware);
router.use(controllerAuth);

// 0b. POST /api/controller/stream-ticket — Issue one-time ticket for EventSource connection
router.post('/stream-ticket', async (req, res) => {
  try {
    const ticket = createStreamTicket({
      trackId: req.user.trackId,
      role: req.scope.asRole,
      deptCodes: req.scope.deptCodes
    });
    return res.json({ ok: true, ticket });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to issue stream ticket' });
  }
});

// 0c. GET /api/controller/board — Live Board real-time snapshot with KPI counters & tile states
router.get('/board', async (req, res) => {
  try {
    const dateStr = sanitizeToString(req.query.date) || null;
    const atTime = sanitizeToString(req.query.at) || null;

    const snapshot = await getLiveBoardSnapshot({
      asRole: req.scope.asRole,
      deptCodes: req.scope.deptCodes,
      dateStr,
      atTime
    });

    return res.json({ ok: true, ...snapshot });
  } catch (err) {
    console.error('[Live Board Error]:', err);
    return res.status(500).json({ error: 'Failed to generate Live Board snapshot' });
  }
});

// 0d. GET /api/controller/day-matrix — Day matrix view (sections × today's periods)
router.get('/day-matrix', async (req, res) => {
  try {
    const dateStr = sanitizeToString(req.query.date) || null;
    const matrix = await getDayMatrixSnapshot({
      deptCodes: req.scope.deptCodes,
      dateStr
    });
    return res.json({ ok: true, ...matrix });
  } catch (err) {
    console.error('[Day Matrix Error]:', err);
    return res.status(500).json({ error: 'Failed to generate day matrix' });
  }
});

// 0e. POST /api/controller/sessions/generate — Generate today's ClassSession records from timetables
router.post('/sessions/generate', async (req, res) => {
  try {
    const targetDate = sanitizeToString(req.body.date) || null;
    const result = await generateDailyClassSessions(targetDate);
    return res.json({ ok: true, message: 'Class sessions generated successfully', ...result });
  } catch (err) {
    console.error('[Generate Sessions Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate class sessions' });
  }
});

// 0f. Alerts Endpoints (GET /alerts, POST /alerts/:id/ack, snooze, resolve)
router.get('/alerts', async (req, res) => {
  try {
    const status = sanitizeToString(req.query.status) || 'active';
    const query = { status };
    if (!req.scope.deptCodes.includes('ALL')) {
      query.deptCode = { $in: req.scope.deptCodes };
    }
    const alerts = await M.Alert.find(query).sort({ severity: 1, createdAt: -1 }).lean();
    return res.json({ ok: true, alerts });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve alerts' });
  }
});

router.post('/alerts/:id/ack', async (req, res) => {
  try {
    const alert = await M.Alert.findById(req.params.id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    alert.status = 'acknowledged';
    alert.acknowledgedBy = {
      trackId: req.user.trackId,
      name: req.user.fullName || req.user.name,
      at: new Date()
    };
    await alert.save();
    return res.json({ ok: true, alert });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/alerts/:id/snooze', async (req, res) => {
  try {
    const alert = await M.Alert.findById(req.params.id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    const mins = Number(req.body.minutes) || 10;
    alert.status = 'snoozed';
    alert.snoozedUntil = new Date(Date.now() + mins * 60 * 1000);
    await alert.save();
    return res.json({ ok: true, alert });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/alerts/:id/resolve', async (req, res) => {
  try {
    const alert = await M.Alert.findById(req.params.id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    await alert.save();
    return res.json({ ok: true, alert });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── C4. Class Live View & Drawer Endpoints ─────────────────────────

// GET /api/controller/class/:classId/live — Detailed Live View Drawer / Full Page
router.get('/class/:classId/live', async (req, res) => {
  try {
    const classIdParam = req.params.classId;
    const dateStr = sanitizeToString(req.query.date) || getTodayIST();

    const cls = await M.Class.findOne({
      $or: [
        ...(mongoose.isValidObjectId(classIdParam) ? [{ _id: classIdParam }] : []),
        { trackId: classIdParam },
        { name: classIdParam }
      ]
    }).lean();

    if (!cls) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Scope verification
    if (!req.scope.deptCodes.includes('ALL') && !req.scope.deptCodes.includes(cls.deptCode)) {
      return res.status(403).json({ error: 'Access denied: Class outside your departmental scope' });
    }

    // 1. Fetch today's ClassSessions for this class
    const todaySessions = await M.ClassSession.find({
      classId: String(cls._id),
      date: dateStr
    }).sort({ periodNumber: 1 }).lean();

    // 2. Identify active / current session
    const nowHM = getCurrentTimeHM();
    const nowMins = timeToMinutes(nowHM);
    const nowSession = todaySessions.find(s => {
      const sMins = timeToMinutes(s.start);
      const eMins = timeToMinutes(s.end);
      return nowMins >= sMins && nowMins <= eMins;
    }) || todaySessions[0] || null;

    // 3. Fetch enrolled students
    const students = await M.Student.find({
      $or: [{ classId: cls._id }, { class: cls.name }]
    })
      .select('trackId fullName name registerNo rollNo email phone attendancePercentage')
      .sort({ registerNo: 1 })
      .lean();

    // 4. Fetch ClassAttendance for today
    const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
    const endOfDay = new Date(dateStr + 'T23:59:59.999Z');
    const todayAtt = await M.ClassAttendance.findOne({
      classId: String(cls._id),
      date: { $gte: startOfDay, $lte: endOfDay }
    }).lean();

    // 5. Fetch approved leaves & ODs covering today for these students
    const studentTrackIds = students.map(s => s.trackId);
    const activeLeaves = await M.LeaveRequest.find({
      dates: dateStr,
      status: 'Approved',
      studentTrackId: { $in: studentTrackIds }
    }).lean();
    const leaveMap = new Map();
    for (const lv of activeLeaves) {
      leaveMap.set(lv.studentTrackId, lv);
    }

    const activeODs = await M.ODRequest.find({
      dates: dateStr,
      status: 'approved',
      studentTrackId: { $in: studentTrackIds }
    }).lean();
    const odMap = new Map();
    for (const od of activeODs) {
      odMap.set(od.studentTrackId, od);
    }

    // 6. Build presence map across today's periods for each student
    const studentPeriodStatus = new Map();
    for (const s of students) {
      studentPeriodStatus.set(s.trackId, {});
    }

    if (todayAtt && Array.isArray(todayAtt.periods)) {
      for (const p of todayAtt.periods) {
        const pNum = p.periodNumbers?.[0] || p.periodNumber || 1;
        for (const rec of p.records || []) {
          const m = studentPeriodStatus.get(rec.studentTrackId);
          if (m) {
            m[pNum] = {
              status: rec.status, // 'P' or 'AB'
              reason: rec.reason,
              locked: rec.locked
            };
          }
        }
      }
    }

    // 7. Build Roster items with smart tags
    const targetPeriod = nowSession?.periodNumber || 1;
    const roster = students.map(s => {
      const pMap = studentPeriodStatus.get(s.trackId) || {};
      const currentPeriodMark = pMap[targetPeriod] || null;

      let status = 'Unmarked';
      let reason = null;
      let smartTag = 'Unmarked';
      let badgeColor = '#94a3b8';

      // Check if student was present earlier today
      const earlierPresent = Object.entries(pMap).some(([pKey, pVal]) => Number(pKey) < targetPeriod && pVal.status === 'P');
      // Check if student was marked in all marked periods today
      const markedEntries = Object.values(pMap);
      const isAbsentAllDay = markedEntries.length > 0 && markedEntries.every(pVal => pVal.status === 'AB');

      if (currentPeriodMark) {
        if (currentPeriodMark.status === 'P') {
          if (currentPeriodMark.reason === 'od') {
            status = 'OD';
            reason = 'On-Duty (Approved)';
            const odInfo = odMap.get(s.trackId);
            smartTag = odInfo ? `OD · ${odInfo.eventDetails?.name || 'Event'}` : 'OD (Approved)';
            badgeColor = '#3b82f6';
          } else {
            status = 'Present';
            smartTag = 'Present';
            badgeColor = '#10b981';
          }
        } else if (currentPeriodMark.status === 'AB') {
          if (currentPeriodMark.reason === 'leave') {
            status = 'Leave';
            const lvInfo = leaveMap.get(s.trackId);
            reason = lvInfo ? `Leave: ${lvInfo.leaveCategory || lvInfo.reason}` : 'Approved Leave';
            smartTag = 'On Leave';
            badgeColor = '#f59e0b';
          } else if (earlierPresent) {
            status = 'Absent';
            const lastP = Math.max(...Object.entries(pMap).filter(([k, v]) => Number(k) < targetPeriod && v.status === 'P').map(([k]) => Number(k)));
            smartTag = `Left after P${lastP}`;
            badgeColor = '#ea580c';
          } else if (isAbsentAllDay) {
            status = 'Absent';
            smartTag = 'Absent all day';
            badgeColor = '#ef4444';
          } else {
            status = 'Absent';
            smartTag = 'No reason';
            badgeColor = '#ef4444';
          }
        }
      } else {
        // Not marked yet for this period, check if approved leave or OD exists for today
        if (odMap.has(s.trackId)) {
          status = 'OD';
          smartTag = `OD · ${odMap.get(s.trackId).eventDetails?.name || 'Event'}`;
          badgeColor = '#3b82f6';
        } else if (leaveMap.has(s.trackId)) {
          status = 'Leave';
          smartTag = 'On Leave';
          badgeColor = '#f59e0b';
        }
      }

      return {
        studentId: s._id,
        trackId: s.trackId,
        name: s.fullName || s.name,
        registerNo: s.registerNo || '—',
        email: s.email || '',
        phone: s.phone || '',
        overallPct: s.attendancePercentage || 100,
        status,
        reason,
        smartTag,
        badgeColor,
        periods: pMap
      };
    });

    // Sort roster: Absentees / Leaves / OD first, then Present
    roster.sort((a, b) => {
      const order = { 'Absent': 1, 'Leave': 2, 'OD': 3, 'Unmarked': 4, 'Present': 5 };
      return (order[a.status] || 9) - (order[b.status] || 9);
    });

    // 8. Presence Matrix across P1..P8
    const matrix = [];
    for (let p = 1; p <= 8; p++) {
      const sess = todaySessions.find(s => Number(s.periodNumber) === p);
      let pPres = 0;
      let pAbs = 0;
      let pOD = 0;
      let pLeave = 0;

      for (const r of roster) {
        const pVal = r.periods?.[p];
        if (pVal?.status === 'P') {
          if (pVal.reason === 'od') pOD++;
          else pPres++;
        } else if (pVal?.status === 'AB') {
          if (pVal.reason === 'leave') pLeave++;
          else pAbs++;
        }
      }

      matrix.push({
        periodNumber: p,
        hasSession: !!sess,
        subjectName: sess?.subjectName || '',
        teacherName: sess?.actualTeacher?.name || sess?.scheduledTeacher?.name || '',
        present: pPres,
        od: pOD,
        leave: pLeave,
        absent: pAbs,
        totalMarked: pPres + pOD + pLeave + pAbs
      });
    }

    // 9. Last 7 Days Attendance Trend Line
    const past7DateStart = new Date(new Date(dateStr).getTime() - 7 * 86400000);
    const past7AttDocs = await M.ClassAttendance.find({
      classId: String(cls._id),
      date: { $gte: past7DateStart, $lte: endOfDay }
    }).sort({ date: 1 }).lean();

    const trend = past7AttDocs.map(doc => {
      let tot = 0;
      let pres = 0;
      for (const p of doc.periods || []) {
        for (const r of p.records || []) {
          tot++;
          if (r.status === 'P') pres++;
        }
      }
      return {
        date: doc.date instanceof Date ? todayIST(doc.date) : String(doc.date),
        presentPct: calculateAttendancePct(pres, tot),
        totalMarked: tot
      };
    });

    return res.json({
      ok: true,
      classInfo: {
        classId: cls._id,
        name: cls.name,
        deptCode: cls.deptCode,
        deptName: cls.deptName,
        year: cls.year,
        section: cls.section,
        room: cls.room || cls.hallNo || '—',
        advisorName: cls.advisorTeacherName || '—',
        advisorTrackId: cls.advisorTeacherTrackId || '',
        enrolledCount: students.length
      },
      nowSession,
      todaySessions,
      roster,
      matrix,
      trend
    });
  } catch (err) {
    console.error('[Class Live View Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve Class Live View' });
  }
});

// POST /api/controller/sessions/:id/nudge — Nudge faculty for overdue or upcoming attendance
router.post('/sessions/:id/nudge', async (req, res) => {
  try {
    const session = await M.ClassSession.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Class session not found' });

    // Scope check
    if (!req.scope.deptCodes.includes('ALL') && !req.scope.deptCodes.includes(session.deptCode)) {
      return res.status(403).json({ error: 'Access denied: Session outside your department' });
    }

    const teacherTrackId = session.actualTeacher?.trackId || session.scheduledTeacher?.trackId;
    if (!teacherTrackId) {
      return res.status(400).json({ error: 'No faculty assigned to this session' });
    }

    const nudgeMessage = `[Attendance Nudge] Please record attendance for ${session.className} Period ${session.periodNumber} (${session.subjectName || ''}).`;

    // Emit live SSE nudge
    broadcastSSE('session.nudge', {
      sessionId: session._id,
      teacherTrackId,
      message: nudgeMessage,
      nudgedBy: req.user.trackId,
      at: new Date()
    }, session.deptCode);

    await logAction({
      req,
      action: 'NUDGE_FACULTY',
      target: session.className,
      details: {
        sessionId: session._id,
        teacherTrackId,
        periodNumber: session.periodNumber
      }
    });

    return res.json({
      ok: true,
      message: `Nudge dispatched to faculty (${session.actualTeacher?.name || session.scheduledTeacher?.name})`
    });
  } catch (err) {
    console.error('[Nudge Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to nudge faculty' });
  }
});

// POST /api/controller/sessions/:id/substitute — Assign substitute faculty to session
router.post('/sessions/:id/substitute', async (req, res) => {
  try {
    const session = await M.ClassSession.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Class session not found' });

    // Scope check
    if (!req.scope.deptCodes.includes('ALL') && !req.scope.deptCodes.includes(session.deptCode)) {
      return res.status(403).json({ error: 'Access denied: Session outside your department' });
    }

    const subTrackId = sanitizeToString(req.body.substituteTeacherTrackId || req.body.substituteTrackId);
    const reason = sanitizeToString(req.body.reason) || 'Administrative substitution';

    if (!subTrackId) {
      return res.status(400).json({ error: 'Substitute faculty trackId is required' });
    }

    const subTeacher = await M.Teacher.findOne({ trackId: subTrackId }).lean();
    if (!subTeacher) {
      return res.status(404).json({ error: 'Substitute faculty not found' });
    }

    const previousTeacher = session.actualTeacher || session.scheduledTeacher;

    session.actualTeacher = {
      trackId: subTeacher.trackId,
      name: subTeacher.fullName || subTeacher.name
    };
    session.source = 'substitution';
    if (!Array.isArray(session.notes)) session.notes = [];
    session.notes.push({
      by: req.user.trackId,
      text: `Substitute assigned: ${subTeacher.fullName || subTeacher.name} (replacing ${previousTeacher?.name || 'original faculty'}). Reason: ${reason}`,
      at: new Date()
    });
    session.updatedAt = new Date();
    await session.save();

    broadcastSSE('session.update', session, session.deptCode);

    await logAction({
      req,
      action: 'ASSIGN_SUBSTITUTE',
      target: session.className,
      details: {
        sessionId: session._id,
        periodNumber: session.periodNumber,
        originalTeacher: previousTeacher,
        substituteTeacher: session.actualTeacher,
        reason
      }
    });

    return res.json({
      ok: true,
      message: `Successfully assigned ${subTeacher.fullName || subTeacher.name} as substitute`,
      session
    });
  } catch (err) {
    console.error('[Assign Substitute Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to assign substitute' });
  }
});

// POST /api/controller/sessions/:id/cancel — Cancel period session for today
router.post('/sessions/:id/cancel', async (req, res) => {
  try {
    const session = await M.ClassSession.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Class session not found' });

    // Scope check
    if (!req.scope.deptCodes.includes('ALL') && !req.scope.deptCodes.includes(session.deptCode)) {
      return res.status(403).json({ error: 'Access denied: Session outside your department' });
    }

    const reason = sanitizeToString(req.body.reason);
    if (!reason) {
      return res.status(400).json({ error: 'Cancellation reason is required' });
    }

    session.status = 'cancelled';
    if (!Array.isArray(session.notes)) session.notes = [];
    session.notes.push({
      by: req.user.trackId,
      text: `Session cancelled by controller. Reason: ${reason}`,
      at: new Date()
    });
    session.updatedAt = new Date();
    await session.save();

    broadcastSSE('session.update', session, session.deptCode);

    await logAction({
      req,
      action: 'CANCEL_PERIOD_SESSION',
      target: session.className,
      details: {
        sessionId: session._id,
        periodNumber: session.periodNumber,
        reason
      }
    });

    return res.json({
      ok: true,
      message: `Period ${session.periodNumber} for ${session.className} cancelled`,
      session
    });
  } catch (err) {
    console.error('[Cancel Session Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to cancel session' });
  }
});

// POST /api/controller/sessions/:id/room — Move classroom for today's session
router.post('/sessions/:id/room', async (req, res) => {
  try {
    const session = await M.ClassSession.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Class session not found' });

    // Scope check
    if (!req.scope.deptCodes.includes('ALL') && !req.scope.deptCodes.includes(session.deptCode)) {
      return res.status(403).json({ error: 'Access denied: Session outside your department' });
    }

    const newRoom = sanitizeToString(req.body.room);
    const reason = sanitizeToString(req.body.reason) || 'Operational room change';

    if (!newRoom) {
      return res.status(400).json({ error: 'New room identifier is required' });
    }

    const prevRoom = session.room;
    session.room = newRoom;
    if (!Array.isArray(session.notes)) session.notes = [];
    session.notes.push({
      by: req.user.trackId,
      text: `Room changed from ${prevRoom || '—'} to ${newRoom}. Reason: ${reason}`,
      at: new Date()
    });
    session.updatedAt = new Date();
    await session.save();

    broadcastSSE('session.update', session, session.deptCode);

    await logAction({
      req,
      action: 'MOVE_SESSION_ROOM',
      target: session.className,
      details: {
        sessionId: session._id,
        prevRoom,
        newRoom,
        reason
      }
    });

    return res.json({
      ok: true,
      message: `Classroom moved to ${newRoom}`,
      session
    });
  } catch (err) {
    console.error('[Move Room Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to change room' });
  }
});

// POST /api/controller/sessions/:id/note — Append controller note to session
router.post('/sessions/:id/note', async (req, res) => {
  try {
    const session = await M.ClassSession.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Class session not found' });

    // Scope check
    if (!req.scope.deptCodes.includes('ALL') && !req.scope.deptCodes.includes(session.deptCode)) {
      return res.status(403).json({ error: 'Access denied: Session outside your department' });
    }

    const text = sanitizeToString(req.body.text);
    if (!text) {
      return res.status(400).json({ error: 'Note text is required' });
    }

    if (!Array.isArray(session.notes)) session.notes = [];
    const noteEntry = {
      by: req.user.trackId,
      text,
      at: new Date()
    };
    session.notes.push(noteEntry);
    session.updatedAt = new Date();
    await session.save();

    broadcastSSE('session.update', session, session.deptCode);

    return res.json({
      ok: true,
      message: 'Note added to session',
      notes: session.notes
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to add note' });
  }
});

// POST /api/controller/unlock-requests/:id/approve — Controller approves teacher's unlock request
router.post('/unlock-requests/:id/approve', async (req, res) => {
  try {
    const reqId = req.params.id;
    // Find alert or session associated with unlock request
    const alert = await M.Alert.findById(reqId);
    let classId = alert?.classId;
    let periodNumber = alert?.context?.periodNumber;
    let targetDate = alert?.context?.date || getTodayIST();

    if (alert) {
      alert.status = 'resolved';
      alert.resolvedAt = new Date();
      await alert.save();
    }

    // Unlock attendance record in ClassAttendance so the teacher can make the edit
    if (classId && periodNumber) {
      const startOfDay = new Date(targetDate + 'T00:00:00.000Z');
      const endOfDay = new Date(targetDate + 'T23:59:59.999Z');

      await M.ClassAttendance.updateMany(
        {
          classId: String(classId),
          date: { $gte: startOfDay, $lte: endOfDay },
          'periods.periodNumbers': Number(periodNumber)
        },
        {
          $set: {
            'periods.$[pElem].records.$[rElem].locked': false
          }
        },
        {
          arrayFilters: [
            { 'pElem.periodNumbers': Number(periodNumber) },
            { 'rElem.locked': true }
          ]
        }
      );
    }

    await logAction({
      req,
      action: 'APPROVE_ATTENDANCE_UNLOCK',
      target: classId || 'Class',
      details: { reqId, classId, periodNumber, date: targetDate }
    });

    return res.json({
      ok: true,
      message: 'Attendance unlock request approved. The teacher has been granted editing access.'
    });
  } catch (err) {
    console.error('[Approve Unlock Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to approve unlock request' });
  }
});

// POST /api/controller/unlock-requests/:id/reject — Controller rejects teacher's unlock request
router.post('/unlock-requests/:id/reject', async (req, res) => {
  try {
    const reqId = req.params.id;
    const alert = await M.Alert.findById(reqId);
    if (alert) {
      alert.status = 'resolved';
      alert.resolvedAt = new Date();
      await alert.save();
    }

    await logAction({
      req,
      action: 'REJECT_ATTENDANCE_UNLOCK',
      target: alert?.classId || 'Class',
      details: { reqId, reason: req.body.reason }
    });

    return res.json({
      ok: true,
      message: 'Attendance unlock request rejected.'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to reject unlock request' });
  }
});

// ── C5. Free-Teacher Finder & Alerts Digest ────────────────────────

// GET /api/controller/free-teachers — Ranked candidate faculty for period substitution
router.get('/free-teachers', async (req, res) => {
  try {
    const dateStr = sanitizeToString(req.query.date) || getTodayIST();
    const periodNumber = Number(req.query.period) || 1;
    const deptCode = sanitizeToString(req.query.deptCode) || (req.scope.deptCodes[0] !== 'ALL' ? req.scope.deptCodes[0] : null);
    const subjectId = sanitizeToString(req.query.subjectId) || null;
    const subjectCode = sanitizeToString(req.query.subjectCode) || null;
    const classId = sanitizeToString(req.query.classId) || null;

    const candidates = await getFreeTeachers({
      dateStr,
      periodNumber,
      deptCode,
      classId,
      subjectId,
      subjectCode
    });

    return res.json({
      ok: true,
      date: dateStr,
      periodNumber,
      count: candidates.length,
      candidates
    });
  } catch (err) {
    console.error('[Free-Teachers Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve available free faculty' });
  }
});

// GET /api/controller/alerts/digest — 30-min Executive Digest for Principal / Executive oversight
router.get('/alerts/digest', async (req, res) => {
  try {
    const digest = await generatePrincipalDigest(req.scope.deptCodes);
    return res.json({ ok: true, digest });
  } catch (err) {
    console.error('[Alerts Digest Error]:', err);
    return res.status(500).json({ error: 'Failed to generate alert digest' });
  }
});

// 0. GET /api/controller/me — Identity, acting roles, scope and capabilities
router.get('/me', async (req, res) => {
  try {
    return res.json({
      ok: true,
      user: {
        trackId: req.user.trackId,
        name: req.user.fullName || req.user.name,
        username: req.user.username,
        role: req.user.role,
        email: req.user.email || '',
        isPrincipal: req.scope.isPrincipalUser,
        isHod: req.scope.isHodUser,
        isActingHod: req.scope.isActingHod
      },
      scope: req.scope
    });
  } catch (err) {
    console.error('[Controller /me Error]:', err);
    res.status(500).json({ error: 'Failed to retrieve controller identity and scope' });
  }
});

// Helper to get Department query filter based on controller scope
function getDeptFilter(req, requestedDeptId) {
  if (req.controllerContext.role === 'hod') {
    return req.controllerContext.deptId ? { $in: [req.controllerContext.deptId, String(req.controllerContext.deptId)] } : null;
  }
  if (requestedDeptId && mongoose.isValidObjectId(requestedDeptId)) {
    return requestedDeptId;
  }
  return null;
}

// 1. GET /api/controller/init — Bootstrap context, profile and badge counts
router.get('/init', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';

    // Build leave filter
    const studentLeaveFilter = { status: 'Pending' };
    const teacherLeaveFilter = { status: 'Pending' };

    if (isHod && ctx.deptId) {
      studentLeaveFilter.deptId = ctx.deptId;
      teacherLeaveFilter.deptId = ctx.deptId;
      studentLeaveFilter.$or = [{ hodStatus: 'Pending' }, { advisorStatus: 'Approved', hodStatus: { $in: ['Pending', 'N/A'] } }];
      teacherLeaveFilter.hodStatus = 'Pending';
    } else if (ctx.role === 'principal') {
      studentLeaveFilter.escalationLevel = 'principal';
      teacherLeaveFilter.$or = [{ escalationLevel: 'principal', principalStatus: 'Pending' }, { isEmergency: false, hodStatus: 'Approved', principalStatus: 'Pending' }];
    }

    const [pendingStudentLeaves, pendingTeacherLeaves, allDepts] = await Promise.all([
      M.LeaveRequest.countDocuments(studentLeaveFilter),
      M.TeacherLeaveRequest.countDocuments(teacherLeaveFilter),
      M.Department.find({}).select('name code trackId threeLetterCode number hodName').lean()
    ]);

    res.json({
      context: ctx,
      badges: {
        pendingStudentLeaves,
        pendingTeacherLeaves,
        totalPendingLeaves: pendingStudentLeaves + pendingTeacherLeaves
      },
      departments: allDepts
    });
  } catch (err) {
    console.error('[Controller Init Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/controller/dashboard — Aggregated dashboard statistics & trends
router.get('/dashboard', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);

    // Queries scoped
    const studentFilter = deptId ? { deptId } : {};
    const facultyFilter = deptId ? { deptId } : {};
    const classFilter = deptId ? { deptId } : {};

    const [totalStudents, totalFaculty, totalClasses, activeClasses] = await Promise.all([
      M.Student.countDocuments(studentFilter),
      M.Teacher.countDocuments(facultyFilter),
      M.Class.countDocuments(classFilter),
      M.Class.find(classFilter).select('_id trackId name deptId deptName deptCode section year batch').lean()
    ]);

    const classIds = activeClasses.map(c => c.trackId || String(c._id));

    // Today's Attendance calculation
    const [tY, tM, tD] = getTodayIST().split('-').map(Number);
    const today = new Date(Date.UTC(tY, tM - 1, tD, 0, 0, 0, 0));
    // normalized to UTC start of day
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAttFilter = {
      date: { $gte: today, $lt: tomorrow }
    };
    if (classIds.length > 0) {
      todayAttFilter.classId = { $in: classIds };
    }

    const todayAttendanceDocs = await M.ClassAttendance.find(todayAttFilter).lean();

    let totalPresentRecords = 0;
    let totalAbsentRecords = 0;
    const classAttendanceMap = {};

    todayAttendanceDocs.forEach(doc => {
      (doc.periods || []).forEach(period => {
        (period.records || []).forEach(rec => {
          if (rec.status === 'P') totalPresentRecords++;
          else if (rec.status === 'AB') totalAbsentRecords++;
        });
      });
      classAttendanceMap[doc.classId] = (classAttendanceMap[doc.classId] || 0) + 1;
    });

    const totalMarked = totalPresentRecords + totalAbsentRecords;
    const todayPct = totalMarked > 0 ? Math.round((totalPresentRecords / totalMarked) * 100) : 0;

    // 7-day attendance trend
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const trendDocs = await M.ClassAttendance.find({
      date: { $gte: sevenDaysAgo, $lt: tomorrow },
      ...(classIds.length > 0 ? { classId: { $in: classIds } } : {})
    }).lean();

    const dayWiseTrend = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const iso = todayIST(d);
      dayWiseTrend[iso] = { present: 0, absent: 0, total: 0 };
    }

    trendDocs.forEach(doc => {
      const dateStr = doc.date ? (typeof doc.date === 'string' ? doc.date.split('T')[0] : todayIST(doc.date)) : '';
      if (dayWiseTrend[dateStr]) {
        (doc.periods || []).forEach(p => {
          (p.records || []).forEach(r => {
            if (r.status === 'P') dayWiseTrend[dateStr].present++;
            else if (r.status === 'AB') dayWiseTrend[dateStr].absent++;
            dayWiseTrend[dateStr].total++;
          });
        });
      }
    });

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const trendChart = Object.keys(dayWiseTrend).map(iso => {
      const item = dayWiseTrend[iso];
      const d = new Date(iso);
      const pct = item.total > 0 ? Math.round((item.present / item.total) * 100) : 0;
      return {
        date: iso,
        day: dayNames[d.getDay()],
        present: item.present,
        absent: item.absent,
        total: item.total,
        pct: pct
      };
    });

    // Principal-specific metrics
    let deptComparison = [];
    let hodMatrix = [];
    let onlineUsersCount = 0;

    if (ctx.role === 'principal') {
      const allDepts = await M.Department.find({}).lean();
      const onlineCount = await M.User.countDocuments({ online: true });
      onlineUsersCount = onlineCount;

      deptComparison = await Promise.all(allDepts.map(async dept => {
        const dClasses = await M.Class.find({ deptId: dept._id }).select('trackId').lean();
        const dClassIds = dClasses.map(c => c.trackId || String(c._id));
        const dAttDocs = await M.ClassAttendance.find({
          date: { $gte: today, $lt: tomorrow },
          classId: { $in: dClassIds }
        }).lean();

        let dP = 0, dA = 0;
        dAttDocs.forEach(doc => {
          (doc.periods || []).forEach(p => {
            (p.records || []).forEach(r => {
              if (r.status === 'P') dP++;
              else if (r.status === 'AB') dA++;
            });
          });
        });
        const dTot = dP + dA;
        const dPct = dTot > 0 ? Math.round((dP / dTot) * 100) : 0;
        const stuCount = await M.Student.countDocuments({ deptId: dept._id });
        const facCount = await M.Teacher.countDocuments({ deptId: dept._id });

        return {
          deptId: dept._id,
          name: dept.name,
          code: dept.code || dept.threeLetterCode,
          hodName: dept.hodName || '—',
          studentCount: stuCount,
          facultyCount: facCount,
          todayPresent: dP,
          todayAbsent: dA,
          todayPct: dPct
        };
      }));

      hodMatrix = allDepts.map(dept => ({
        deptId: dept._id,
        deptName: dept.name,
        deptCode: dept.code || dept.threeLetterCode,
        hodName: dept.hodName || 'Not Assigned',
        courseType: dept.courseType || 'UG',
        branch: dept.branch || 'B.E'
      }));
    }

    res.json({
      metrics: {
        totalStudents,
        totalFaculty,
        totalClasses,
        todayAttendance: {
          present: totalPresentRecords,
          absent: totalAbsentRecords,
          total: totalMarked,
          pct: todayPct
        },
        onlineUsers: onlineUsersCount
      },
      trendChart,
      deptComparison,
      hodMatrix,
      activeClassesSummary: {
        total: activeClasses.length,
        markedToday: Object.keys(classAttendanceMap).length
      }
    });
  } catch (err) {
    console.error('[Controller Dashboard Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. GET /api/controller/attendance/daily — Detailed attendance by date & class
router.get('/attendance/daily', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const dateStr = sanitizeToString(req.query.date) || getTodayIST();
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);
    const classId = sanitizeToString(req.query.classId) || null;

    const startDate = new Date(dateStr + 'T00:00:00.000Z');
    const endDate = new Date(dateStr + 'T23:59:59.999Z');

    const classQuery = deptId ? { deptId } : {};
    if (classId) classQuery._id = classId;

    const classes = await M.Class.find(classQuery).sort({ name: 1 }).lean();
    const classLookup = {};
    classes.forEach(c => {
      const key = c.trackId || String(c._id);
      classLookup[key] = c;
    });

    const targetClassIds = Object.keys(classLookup);

    const attDocs = await M.ClassAttendance.find({
      date: { $gte: startDate, $lte: endDate },
      ...(targetClassIds.length ? { classId: { $in: targetClassIds } } : {})
    }).lean();

    const attendanceByClass = {};
    classes.forEach(c => {
      const idStr = c.trackId || String(c._id);
      attendanceByClass[idStr] = {
        classId: c._id,
        classTrackId: c.trackId,
        className: c.name,
        deptName: c.deptName,
        deptCode: c.deptCode,
        section: c.section,
        year: c.year,
        sem: c.sem,
        hallNo: c.hallNo || '—',
        advisorName: c.advisorTeacherName || '—',
        periods: [],
        totalPresent: 0,
        totalAbsent: 0,
        pct: 0,
        markedPeriodsCount: 0,
        isFullyMarked: false
      };
    });

    attDocs.forEach(doc => {
      const cls = attendanceByClass[doc.classId];
      if (!cls) return;

      (doc.periods || []).forEach(p => {
        let pPresent = 0;
        let pAbsent = 0;
        (p.records || []).forEach(r => {
          if (r.status === 'P') pPresent++;
          else if (r.status === 'AB') pAbsent++;
        });
        const pTotal = pPresent + pAbsent;
        const pPct = pTotal > 0 ? Math.round((pPresent / pTotal) * 100) : 0;

        cls.periods.push({
          periodNumbers: p.periodNumbers || [],
          subjectTrackId: p.subjectTrackId,
          markedBy: p.markedBy,
          markedAt: p.markedAt,
          topic: p.topic || '',
          notes: p.notes || '',
          present: pPresent,
          absent: pAbsent,
          total: pTotal,
          pct: pPct
        });

        cls.totalPresent += pPresent;
        cls.totalAbsent += pAbsent;
      });

      cls.markedPeriodsCount = cls.periods.length;
      const totalAll = cls.totalPresent + cls.totalAbsent;
      cls.pct = totalAll > 0 ? Math.round((cls.totalPresent / totalAll) * 100) : 0;
      cls.isFullyMarked = cls.markedPeriodsCount >= 7; // Typical 7-period day
    });

    res.json({
      date: dateStr,
      classes: Object.values(attendanceByClass),
      summary: {
        totalClasses: classes.length,
        markedClasses: attDocs.length,
        totalPresent: Object.values(attendanceByClass).reduce((s, c) => s + c.totalPresent, 0),
        totalAbsent: Object.values(attendanceByClass).reduce((s, c) => s + c.totalAbsent, 0)
      }
    });
  } catch (err) {
    console.error('[Controller Daily Attendance Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. GET /api/controller/leaves/student — Student leave requests
router.get('/leaves/student', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const status = sanitizeToString(req.query.status) || 'all';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);

    const filter = {};
    if (deptId) filter.deptId = deptId;

    if (status === 'pending') {
      filter.status = 'Pending';
      if (isHod) {
        filter.$or = [{ hodStatus: 'Pending' }, { advisorStatus: 'Approved', hodStatus: { $in: ['Pending', 'N/A'] } }];
      }
    } else if (status === 'approved') {
      filter.status = 'Approved';
    } else if (status === 'rejected') {
      filter.status = 'Rejected';
    }

    const leaves = await M.LeaveRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json(leaves);
  } catch (err) {
    console.error('[Controller Student Leaves Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. GET /api/controller/leaves/teacher — Faculty leave requests
router.get('/leaves/teacher', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const status = sanitizeToString(req.query.status) || 'all';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);

    const filter = {};
    if (deptId) filter.deptId = deptId;

    if (status === 'pending') {
      if (isHod) {
        filter.hodStatus = 'Pending';
      } else {
        filter.$or = [
          { escalationLevel: 'principal', principalStatus: 'Pending' },
          { isEmergency: false, hodStatus: 'Approved', principalStatus: 'Pending' }
        ];
      }
    } else if (status === 'approved') {
      filter.status = 'Approved';
    } else if (status === 'rejected') {
      filter.status = 'Rejected';
    }

    const teacherLeaves = await M.TeacherLeaveRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json(teacherLeaves);
  } catch (err) {
    console.error('[Controller Teacher Leaves Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /api/controller/leaves/approve — Single or Bulk Leave Approval
router.post('/leaves/approve', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const { ids, type, remarks } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Please provide array of leave IDs to approve' });
    }
    const leaveType = type === 'teacher' ? 'teacher' : 'student';

    let updatedCount = 0;

    if (leaveType === 'student') {
      for (const id of ids) {
        const leave = await M.LeaveRequest.findById(id);
        if (!leave) continue;

        // Security check for HOD
        if (ctx.role === 'hod' && String(leave.deptId) !== String(ctx.deptId)) {
          continue;
        }

        leave.hodStatus = 'Approved';
        leave.hodReviewedBy = ctx.name;
        leave.hodReviewedAt = new Date();
        leave.hodRemarks = remarks || 'Approved by HOD';
        leave.status = 'Approved';
        leave.reviewedBy = ctx.name;
        leave.reviewedAt = new Date();
        leave.reviewRemarks = remarks || 'Approved';

        await leave.save();
        updatedCount++;

        // Notify Student
        await M.Notification.create({
          type: 'leave-approval',
          from: ctx.name,
          fromRole: ctx.role,
          message: `Your ${leave.category} request from ${leave.fromDate} to ${leave.toDate} has been APPROVED by ${ctx.name} (${ctx.role.toUpperCase()}).`,
          priority: 'Normal',
          toStudentId: leave.studentId,
          toStudentTrackId: leave.studentTrackId,
          toStudentName: leave.studentName,
          leaveRequestId: leave._id,
          time: new Date()
        }).catch(() => {});
      }
    } else {
      // Teacher Leaves
      for (const id of ids) {
        const tLeave = await M.TeacherLeaveRequest.findById(id);
        if (!tLeave) continue;

        if (ctx.role === 'hod') {
          if (String(tLeave.deptId) !== String(ctx.deptId)) continue;

          // Endorsed by HOD, forwarded to Principal per LD9 (including emergency)
          tLeave.hodStatus = 'Approved';
          tLeave.hodReviewedBy = ctx.name;
          tLeave.hodReviewedAt = new Date();
          tLeave.hodRemarks = remarks || (tLeave.isEmergency ? 'Emergency endorsed by HOD, urgent review needed' : 'Endorsed by HOD, forwarded to Principal');
          tLeave.escalationLevel = 'principal';
          tLeave.principalStatus = 'Pending';
          tLeave.status = 'pending_principal';
          await tLeave.save();
          updatedCount++;
        } else if (ctx.role === 'principal') {
          // Principal Final Approval (LD9)
          tLeave.principalStatus = 'Approved';
          tLeave.principalReviewedBy = ctx.name;
          tLeave.principalReviewedAt = new Date();
          tLeave.principalRemarks = remarks || 'Approved by Principal';
          tLeave.status = 'Approved';
          await tLeave.save();
          updatedCount++;

          if (Array.isArray(tLeave.substitutions) && tLeave.substitutions.length > 0) {
            for (const sub of tLeave.substitutions) {
              if (!sub.classId || !sub.date || !sub.periodNumber) continue;
              try {
                const subDate = new Date(sub.date + (String(sub.date).includes('T') ? '' : 'T00:00:00.000Z'));
                const pNum = Number(sub.periodNumber);
                await M.Override.findOneAndUpdate(
                  {
                    classId: sub.classId,
                    date: subDate,
                    $or: [{ period: pNum }, { periodNumber: pNum }]
                  },
                  {
                    classId: sub.classId,
                    date: subDate,
                    period: pNum,
                    periodNumber: pNum,
                    type: 'substitute',
                    originalSlot: {
                      teacher: tLeave.teacherName,
                      teacherName: tLeave.teacherName,
                      teacherTrackId: tLeave.teacherTrackId,
                      subject: sub.subjectName,
                      subjectName: sub.subjectName,
                      room: sub.hallNo,
                      hallNo: sub.hallNo
                    },
                    newSlot: {
                      teacher: sub.substituteTeacherName,
                      teacherName: sub.substituteTeacherName,
                      teacherTrackId: sub.substituteTeacherTrackId,
                      subject: sub.subjectName,
                      subjectName: sub.subjectName,
                      room: sub.hallNo,
                      hallNo: sub.hallNo
                    },
                    reason: `Leave substitution for ${tLeave.teacherName}`,
                    approvedBy: ctx.name,
                    requestId: tLeave.requestId || String(tLeave._id),
                    source: {
                      type: tLeave.isEmergency ? 'EMERGENCY' : 'FACULTY_LEAVE',
                      requestId: tLeave.requestId || String(tLeave._id)
                    },
                    status: 'confirmed',
                    assignedBy: {
                      trackId: ctx.trackId || '',
                      role: 'principal'
                    },
                    originalTeacher: {
                      trackId: tLeave.teacherTrackId,
                      name: tLeave.teacherName
                    },
                    substituteTeacher: {
                      trackId: sub.substituteTeacherTrackId,
                      name: sub.substituteTeacherName
                    }
                  },
                  { upsert: true, returnDocument: 'after' }
                );

              // Notify the substitute teacher
              await M.Notification.create({
                type: 'leave-approval',
                from: ctx.name,
                fromRole: ctx.role,
                message: `You have been assigned as SUBSTITUTE for ${tLeave.teacherName} in ${sub.className} (Period ${sub.periodNumber}) on ${sub.date}.`,
                priority: 'High',
                toTeacherTrackId: sub.substituteTeacherTrackId,
                toTeacherName: sub.substituteTeacherName,
                time: new Date()
              }).catch(() => {});
            } catch (ovErr) {
              console.error('[Substitution DayOverride Error]:', ovErr);
            }
          }
        }
      }

        // Notify Teacher
        await M.Notification.create({
          type: 'leave-approval',
          from: ctx.name,
          fromRole: ctx.role,
          message: `Your leave request from ${tLeave.fromDate} to ${tLeave.toDate} has been ${tLeave.status === 'Approved' ? 'APPROVED' : 'forwarded to Principal for approval'}.`,
          priority: 'Normal',
          toTeacherId: tLeave.teacherId,
          toTeacherTrackId: tLeave.teacherTrackId,
          toTeacherName: tLeave.teacherName,
          time: new Date()
        }).catch(() => {});
      }
    }

    await logAction(
      ctx.trackId,
      ctx.name,
      ctx.role === 'principal' ? 'admin' : 'teacher',
      'Leave Bulk Approved',
      `Approved ${updatedCount} ${leaveType} leave request(s)`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'controller', subType: 'leave-approve', role: ctx.role }
    );

    res.json({ success: true, count: updatedCount });
  } catch (err) {
    console.error('[Controller Leave Approve Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. POST /api/controller/leaves/reject — Single or Bulk Leave Rejection
router.post('/leaves/reject', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const { ids, type, remarks } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Please provide array of leave IDs to reject' });
    }
    const leaveType = type === 'teacher' ? 'teacher' : 'student';
    let updatedCount = 0;

    if (leaveType === 'student') {
      for (const id of ids) {
        const leave = await M.LeaveRequest.findById(id);
        if (!leave) continue;
        if (ctx.role === 'hod' && String(leave.deptId) !== String(ctx.deptId)) continue;

        leave.hodStatus = 'Rejected';
        leave.hodReviewedBy = ctx.name;
        leave.hodReviewedAt = new Date();
        leave.hodRemarks = remarks || 'Rejected by HOD';
        leave.status = 'Rejected';
        leave.reviewedBy = ctx.name;
        leave.reviewedAt = new Date();
        leave.reviewRemarks = remarks || 'Rejected';

        await leave.save();
        updatedCount++;

        // Notify Student
        await M.Notification.create({
          type: 'leave-rejection',
          from: ctx.name,
          fromRole: ctx.role,
          message: `Your ${leave.category} request from ${leave.fromDate} to ${leave.toDate} was REJECTED by ${ctx.name}. Remarks: ${remarks || 'None'}`,
          priority: 'Urgent',
          toStudentId: leave.studentId,
          toStudentTrackId: leave.studentTrackId,
          toStudentName: leave.studentName,
          leaveRequestId: leave._id,
          time: new Date()
        }).catch(() => {});
      }
    } else {
      for (const id of ids) {
        const tLeave = await M.TeacherLeaveRequest.findById(id);
        if (!tLeave) continue;
        if (ctx.role === 'hod' && String(tLeave.deptId) !== String(ctx.deptId)) continue;

        if (ctx.role === 'hod') {
          tLeave.hodStatus = 'Rejected';
          tLeave.hodReviewedBy = ctx.name;
          tLeave.hodReviewedAt = new Date();
          tLeave.hodRemarks = remarks || 'Rejected by HOD';
        } else {
          tLeave.principalStatus = 'Rejected';
          tLeave.principalReviewedBy = ctx.name;
          tLeave.principalReviewedAt = new Date();
          tLeave.principalRemarks = remarks || 'Rejected by Principal';
        }
        tLeave.status = 'Rejected';
        await tLeave.save();
        updatedCount++;

        // Notify Teacher
        await M.Notification.create({
          type: 'leave-rejection',
          from: ctx.name,
          fromRole: ctx.role,
          message: `Your leave request from ${tLeave.fromDate} to ${tLeave.toDate} was REJECTED. Reason: ${remarks || 'None'}`,
          priority: 'Urgent',
          toTeacherId: tLeave.teacherId,
          toTeacherTrackId: tLeave.teacherTrackId,
          toTeacherName: tLeave.teacherName,
          time: new Date()
        }).catch(() => {});
      }
    }

    res.json({ success: true, count: updatedCount });
  } catch (err) {
    console.error('[Controller Leave Reject Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. GET /api/controller/faculty — Faculty directory with today's marking status
router.get('/faculty', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);
    const search = sanitizeToString(req.query.search) || '';

    const filter = {};
    if (deptId) filter.deptId = deptId;
    if (search) {
      filter.$or = [
        { fullName: new RegExp(search, 'i') },
        { employeeNo: new RegExp(search, 'i') },
        { designation: new RegExp(search, 'i') },
        { username: new RegExp(search, 'i') }
      ];
    }

    const teachers = await M.Teacher.find(filter)
      .select('-password -passwordHistory')
      .sort({ fullName: 1 })
      .lean();

    // Check today's attendance marking completion for each teacher
    const [tY, tM, tD] = getTodayIST().split('-').map(Number);
    const today = new Date(Date.UTC(tY, tM - 1, tD, 0, 0, 0, 0));
    // normalized to UTC start of day
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAtt = await M.ClassAttendance.find({
      date: { $gte: today, $lt: tomorrow }
    }).lean();

    const teacherMarkedPeriods = {};
    todayAtt.forEach(doc => {
      (doc.periods || []).forEach(p => {
        if (p.teacherTrackId) {
          teacherMarkedPeriods[p.teacherTrackId] = (teacherMarkedPeriods[p.teacherTrackId] || 0) + 1;
        }
      });
    });

    const enriched = teachers.map(t => ({
      _id: t._id,
      trackId: t.trackId,
      fullName: t.fullName,
      employeeNo: t.employeeNo || '—',
      department: t.department || '—',
      deptCode: t.deptCode || '—',
      designation: t.designation || 'Faculty',
      email: t.email || '—',
      isHod: (t.specials || []).some(s => s.option === 'isHod') || (t.roles || []).includes('isHod'),
      isPrincipal: (t.specials || []).some(s => s.option === 'isPrincipal') || (t.roles || []).includes('isPrincipal'),
      isAdmin: (t.specials || []).some(s => s.option === 'isAdmin') || (t.roles || []).includes('isAdmin'),
      isClassAdvisor: (t.specials || []).some(s => s.option === 'isClassAdvisor'),
      isTimeTableCoordinator: (t.specials || []).some(s => s.option === 'isTimeTableCoordinator') || (t.roles || []).includes('isTimeTableCoordinator'),
      todayPeriodsMarked: teacherMarkedPeriods[t.trackId] || 0,
      todayMarkingStatus: (teacherMarkedPeriods[t.trackId] || 0) > 0 ? 'Marked' : 'Pending'
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[Controller Faculty Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 9. GET /api/controller/students — Student directory with cumulative attendance %
router.get('/students', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);
    const classId = sanitizeToString(req.query.classId) || null;
    const search = sanitizeToString(req.query.search) || '';

    const filter = {};
    if (deptId) filter.deptId = deptId;
    if (classId) filter.classId = classId;
    if (search) {
      filter.$or = [
        { fullName: new RegExp(search, 'i') },
        { registerNo: new RegExp(search, 'i') },
        { username: new RegExp(search, 'i') }
      ];
    }

    const students = await M.Student.find(filter)
      .select('-password -passwordHistory')
      .sort({ registerNo: 1 })
      .limit(500)
      .lean();

    const trackIds = students.map(s => s.trackId).filter(Boolean);
    const attRecords = await M.StudentAttendance.find({
      studentTrackId: { $in: trackIds }
    }).lean();

    const attMap = {};
    attRecords.forEach(rec => {
      const totalHeld = (rec.records || []).reduce((s, r) => s + (r.classesHeld || 0), 0);
      const totalAtt = (rec.records || []).reduce((s, r) => s + (r.classesAttended || 0), 0);
      const pct = totalHeld > 0 ? Math.round((totalAtt / totalHeld) * 100) : 0;
      attMap[rec.studentTrackId] = { totalHeld, totalAtt, pct };
    });

    const enriched = students.map(s => {
      const att = attMap[s.trackId] || { totalHeld: 0, totalAtt: 0, pct: 100 };
      return {
        _id: s._id,
        trackId: s.trackId,
        fullName: s.fullName,
        registerNo: s.registerNo || '—',
        class: s.class || '—',
        section: s.section || '—',
        department: s.department || '—',
        admissionYear: s.admissionYear || '—',
        batchTrackId: s.batchTrackId || '—',
        classesHeld: att.totalHeld,
        classesAttended: att.totalAtt,
        attendancePct: att.pct
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('[Controller Students Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── C6. Student Records & Defaulter Actions ────────────────────────

// GET /api/controller/students/:trackId/record — Comprehensive student profile with heatmap and projections
router.get('/students/:trackId/record', async (req, res) => {
  try {
    const trackIdParam = req.params.trackId;

    const student = await M.Student.findOne({
      $or: [
        { trackId: trackIdParam },
        ...(mongoose.isValidObjectId(trackIdParam) ? [{ _id: trackIdParam }] : []),
        { registerNo: trackIdParam }
      ]
    }).lean();

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Scope check: student's department must be within req.scope.deptCodes
    const dept = await M.Department.findById(student.deptId).lean();
    const deptCode = dept?.code || student.department;
    if (!req.scope.deptCodes.includes('ALL') && !req.scope.deptCodes.includes(deptCode)) {
      return res.status(403).json({ error: 'Access denied: Student outside your departmental scope' });
    }

    // Fetch Class & Advisor
    const cls = student.classId ? await M.Class.findById(student.classId).lean() : null;

    // Fetch cumulative attendance records
    const attDoc = await M.StudentAttendance.findOne({ studentTrackId: student.trackId }).lean();
    const records = attDoc?.records || [];

    const totalHeld = records.reduce((s, r) => s + (r.classesHeld || 0), 0);
    const totalAtt = records.reduce((s, r) => s + (r.classesAttended || 0), 0);
    const overallPct = calculateAttendancePct(totalAtt, totalHeld);

    // Subject-wise breakdown
    const subjectBreakdown = records.map(r => ({
      subjectTrackId: r.subjectTrackId,
      classesHeld: r.classesHeld || 0,
      classesAttended: r.classesAttended || 0,
      percentage: calculateAttendancePct(r.classesAttended, r.classesHeld)
    }));

    // Math projections (classes needed, condonation band)
    const settingsDoc = await M.Settings.findOne({ key: 'attendancePolicy' }).lean();
    const minThreshold = Number(settingsDoc?.value?.minAttendancePct) || 75;
    const condonationBand = [65, minThreshold];

    const math = calculateClassesNeeded({
      currentPresent: totalAtt,
      currentTotal: totalHeld,
      targetPct: minThreshold,
      remainingClasses: 30
    });
    const defaulterBand = calculateDefaulterBand(overallPct, condonationBand);

    // Month Heatmap: current month
    const requestedMonth = sanitizeToString(req.query.month) || getTodayIST().slice(0, 7); // YYYY-MM
    const [yearNum, monthNum] = requestedMonth.split('-').map(Number);
    const daysInMonth = new Date(yearNum, monthNum, 0).getDate();

    const monthStart = new Date(`${requestedMonth}-01T00:00:00.000Z`);
    const monthEnd = new Date(`${requestedMonth}-${String(daysInMonth).padStart(2, '0')}T23:59:59.999Z`);

    // Fetch ClassAttendance in this month for this student's class
    const classAttDocs = student.classId ? await M.ClassAttendance.find({
      classId: String(student.classId),
      date: { $gte: monthStart, $lte: monthEnd }
    }).lean() : [];

    // Fetch approved leaves and ODs in this month
    const studentLeaves = await M.LeaveRequest.find({
      studentTrackId: student.trackId,
      status: 'Approved'
    }).lean();

    const studentODs = await M.ODRequest.find({
      studentTrackId: student.trackId,
      status: 'approved'
    }).lean();

    const leaveDatesSet = new Set();
    studentLeaves.forEach(lv => (lv.dates || []).forEach(d => leaveDatesSet.add(d)));

    const odDatesSet = new Set();
    studentODs.forEach(od => (od.dates || []).forEach(d => odDatesSet.add(d)));

    // Map month attendance by date
    const dayAttendanceMap = new Map();
    for (const doc of classAttDocs) {
      const dStr = doc.date instanceof Date ? todayIST(doc.date) : String(doc.date).slice(0, 10);
      let dayP = 0;
      let dayAB = 0;
      let dayOD = 0;
      let dayLeave = 0;

      for (const p of doc.periods || []) {
        const rec = (p.records || []).find(r => r.studentTrackId === student.trackId);
        if (rec) {
          if (rec.status === 'P') {
            if (rec.reason === 'od') dayOD++;
            else dayP++;
          } else if (rec.status === 'AB') {
            if (rec.reason === 'leave') dayLeave++;
            else dayAB++;
          }
        }
      }

      if (dayP > 0 || dayAB > 0 || dayOD > 0 || dayLeave > 0) {
        let status = 'present';
        if (dayP === 0 && dayOD > 0) status = 'od';
        else if (dayP === 0 && dayLeave > 0) status = 'leave';
        else if (dayP === 0 && dayAB > 0) status = 'absent';
        else if (dayP > 0 && dayAB > 0) status = 'partial';

        dayAttendanceMap.set(dStr, {
          status,
          present: dayP,
          absent: dayAB,
          od: dayOD,
          leave: dayLeave
        });
      }
    }

    const heatmap = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${requestedMonth}-${String(d).padStart(2, '0')}`;
      const dayDate = new Date(dateStr + 'T00:00:00.000Z');
      const dayOfWeek = dayDate.getUTCDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      let dayInfo = dayAttendanceMap.get(dateStr) || null;
      let status = isWeekend ? 'weekend' : 'no_data';

      if (dayInfo) {
        status = dayInfo.status;
      } else if (!isWeekend) {
        if (odDatesSet.has(dateStr)) status = 'od';
        else if (leaveDatesSet.has(dateStr)) status = 'leave';
      }

      heatmap.push({
        date: dateStr,
        day: d,
        dayOfWeek,
        status,
        details: dayInfo
      });
    }

    await logAction({
      req,
      action: 'VIEW_STUDENT_RECORD',
      target: student.fullName || student.name,
      details: { studentTrackId: student.trackId, overallPct }
    });

    return res.json({
      ok: true,
      profile: {
        trackId: student.trackId,
        fullName: student.fullName || student.name,
        registerNo: student.registerNo || '—',
        email: student.email || '—',
        phone: student.phone || '—',
        guardianName: student.guardianName || student.parentName || '—',
        guardianPhone: student.guardianPhone || student.parentPhone || '—',
        className: cls?.name || student.class || '—',
        section: cls?.section || student.section || '—',
        deptName: cls?.deptName || student.department || '—',
        deptCode: cls?.deptCode || deptCode || '—',
        advisorName: cls?.advisorTeacherName || '—',
        photo: student.photo || null
      },
      stats: {
        totalHeld,
        totalAtt,
        overallPct,
        subjectBreakdown
      },
      math: {
        ...math,
        defaulterBand,
        threshold: minThreshold
      },
      heatmap,
      leaves: studentLeaves.slice(0, 5),
      ods: studentODs.slice(0, 5)
    });
  } catch (err) {
    console.error('[Student Record Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve student record' });
  }
});

// POST /api/controller/students/warning-letter — Generate official attendance warning letter payload
router.post('/students/warning-letter', async (req, res) => {
  try {
    const studentTrackId = sanitizeToString(req.body.studentTrackId);
    const customNote = sanitizeToString(req.body.customNote) || '';
    const dateStr = sanitizeToString(req.body.date) || getTodayIST();

    if (!studentTrackId) {
      return res.status(400).json({ error: 'Student trackId is required' });
    }

    const student = await M.Student.findOne({ trackId: studentTrackId }).lean();
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const cls = student.classId ? await M.Class.findById(student.classId).lean() : null;
    const attDoc = await M.StudentAttendance.findOne({ studentTrackId }).lean();
    const records = attDoc?.records || [];

    const totalHeld = records.reduce((s, r) => s + (r.classesHeld || 0), 0);
    const totalAtt = records.reduce((s, r) => s + (r.classesAttended || 0), 0);
    const currentPct = calculateAttendancePct(totalAtt, totalHeld);

    const settingsDoc = await M.Settings.findOne({ key: 'attendancePolicy' }).lean();
    const minThreshold = Number(settingsDoc?.value?.minAttendancePct) || 75;
    const condonationBand = [65, minThreshold];
    const band = calculateDefaulterBand(currentPct, condonationBand);

    const math = calculateClassesNeeded({
      currentPresent: totalAtt,
      currentTotal: totalHeld,
      targetPct: minThreshold,
      remainingClasses: 30
    });

    const refNo = `WL-${new Date().getFullYear()}-${student.registerNo || student.trackId}`;
    const condonationStatus = band === 'condonation' 
      ? 'Eligible for Condonation Consideration (65%–75% Band)' 
      : 'Critical Shortage: Below Condonation Limit (<65%)';

    const letter = {
      refNo,
      date: dateStr,
      letterhead: {
        institution: 'ELECTRONIC ATTENDANCE MANAGEMENT SYSTEM (EAMS)',
        tagline: 'Office of the Controller of Examinations & Academic Affairs',
        contact: 'academic-controller@eams.edu'
      },
      student: {
        name: student.fullName || student.name,
        registerNo: student.registerNo || '—',
        class: cls?.name || student.class || '—',
        department: cls?.deptName || student.department || '—',
        advisorName: cls?.advisorTeacherName || '—'
      },
      attendance: {
        totalHeld,
        totalAttended: totalAtt,
        percentage: currentPct,
        minRequired: minThreshold,
        shortagePct: Math.max(0, Math.round((minThreshold - currentPct) * 10) / 10),
        condonationStatus
      },
      projection: math,
      customNote,
      signOff: {
        title: req.scope.asRole === 'principal' ? 'Principal & Chief Controller' : 'Head of the Department',
        name: req.user.fullName || req.user.name,
        role: req.scope.asRole.toUpperCase()
      }
    };

    await logAction({
      req,
      action: 'GENERATE_WARNING_LETTER',
      target: student.fullName || student.name,
      details: { studentTrackId, refNo, currentPct }
    });

    return res.json({
      ok: true,
      message: 'Warning letter generated successfully',
      letter
    });
  } catch (err) {
    console.error('[Warning Letter Error]:', err);
    return res.status(500).json({ error: 'Failed to generate warning letter' });
  }
});

// GET /api/controller/export/defaulters.csv — Stream CSV export of defaulters
router.get('/export/defaulters.csv', async (req, res) => {
  try {
    const settingsDoc = await M.Settings.findOne({ key: 'attendancePolicy' }).lean();
    const minThreshold = Number(settingsDoc?.value?.minAttendancePct) || 75;

    // Filter by scoped departments
    const deptQuery = {};
    if (!req.scope.deptCodes.includes('ALL')) {
      const depts = await M.Department.find({ code: { $in: req.scope.deptCodes } }).select('_id').lean();
      deptQuery.deptId = { $in: depts.map(d => d._id) };
    }

    const students = await M.Student.find(deptQuery)
      .select('trackId fullName registerNo class section department')
      .lean();

    const trackIds = students.map(s => s.trackId);
    const attRecords = await M.StudentAttendance.find({ studentTrackId: { $in: trackIds } }).lean();

    const attMap = new Map();
    attRecords.forEach(rec => {
      const totalHeld = (rec.records || []).reduce((s, r) => s + (r.classesHeld || 0), 0);
      const totalAtt = (rec.records || []).reduce((s, r) => s + (r.classesAttended || 0), 0);
      const pct = totalHeld > 0 ? Math.round((totalAtt / totalHeld) * 100) : 0;
      attMap.set(rec.studentTrackId, { totalHeld, totalAtt, pct });
    });

    const rows = [
      ['Register No', 'Student Name', 'Department', 'Class', 'Section', 'Classes Held', 'Classes Attended', 'Attendance %', 'Defaulter Status', 'Classes Needed']
    ];

    for (const s of students) {
      const att = attMap.get(s.trackId);
      if (att && att.totalHeld > 0 && att.pct < minThreshold) {
        const band = calculateDefaulterBand(att.pct);
        const math = calculateClassesNeeded({
          currentPresent: att.totalAtt,
          currentTotal: att.totalHeld,
          targetPct: minThreshold
        });

        rows.push([
          s.registerNo || '—',
          `"${(s.fullName || s.name).replace(/"/g, '""')}"`,
          `"${(s.department || '').replace(/"/g, '""')}"`,
          s.class || '—',
          s.section || '—',
          att.totalHeld,
          att.totalAtt,
          `${att.pct}%`,
          band === 'condonation' ? 'Condonation (65-75%)' : 'Critical (<65%)',
          math.classesNeeded
        ]);
      }
    }

    const csvContent = rows.map(r => r.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="defaulters-${getTodayIST()}.csv"`);
    return res.send(csvContent);
  } catch (err) {
    console.error('[Defaulters CSV Error]:', err);
    return res.status(500).send('Failed to export defaulters CSV');
  }
});

// 10. GET /api/controller/records — Period-wise teaching notes and topics covered
router.get('/records', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const dateStr = sanitizeToString(req.query.date) || getTodayIST();
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);
    const classId = sanitizeToString(req.query.classId) || null;

    const startDate = new Date(dateStr + 'T00:00:00.000Z');
    const endDate = new Date(dateStr + 'T23:59:59.999Z');

    const classQuery = deptId ? { deptId } : {};
    if (classId) classQuery._id = classId;

    const classDocs = await M.Class.find(classQuery).lean();
    const classMap = {};
    classDocs.forEach(c => {
      classMap[c.trackId || String(c._id)] = c;
    });

    const targetClassIds = Object.keys(classMap);
    if (!targetClassIds.length) {
      return res.json([]);
    }

    const attDocs = await M.ClassAttendance.find({
      date: { $gte: startDate, $lte: endDate },
      classId: { $in: targetClassIds }
    }).sort({ 'periods.markedAt': -1 }).lean();

    const periodRecords = [];

    attDocs.forEach(doc => {
      const cls = classMap[doc.classId];
      const className = cls ? cls.name : doc.classId;
      const deptName = cls ? cls.deptName : doc.departmentCode;

      (doc.periods || []).forEach(p => {
        let pPresent = 0;
        let pAbsent = 0;
        (p.records || []).forEach(r => {
          if (r.status === 'P') pPresent++;
          else if (r.status === 'AB') pAbsent++;
        });

        periodRecords.push({
          date: dateStr,
          className: className,
          deptName: deptName,
          section: cls?.section || '—',
          periodNumbers: p.periodNumbers || [],
          subjectTrackId: p.subjectTrackId || '—',
          markedBy: p.markedBy || '—',
          markedAt: p.markedAt,
          topic: p.topic || '—',
          notes: p.notes || '—',
          presentCount: pPresent,
          absentCount: pAbsent,
          totalCount: pPresent + pAbsent
        });
      });
    });

    res.json(periodRecords);
  } catch (err) {
    console.error('[Controller Records Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 11. GET /api/controller/defaulters — Defaulters list below policy threshold with condonation bands
router.get('/defaulters', async (req, res) => {
  try {
    const classId = sanitizeToString(req.query.classId) || null;
    const bandFilter = sanitizeToString(req.query.band) || 'all'; // 'all' | 'condonation' | 'critical'

    // Get policy threshold
    const settingsDoc = await M.Settings.findOne({ key: 'attendancePolicy' }).lean();
    const minThreshold = Number(req.query.threshold) || Number(settingsDoc?.value?.minAttendancePct) || 75;
    const condonationBand = [65, minThreshold];

    const studentQuery = {};
    if (classId) studentQuery.classId = classId;

    // Filter by scoped departments
    if (!req.scope.deptCodes.includes('ALL')) {
      const depts = await M.Department.find({ code: { $in: req.scope.deptCodes } }).select('_id').lean();
      studentQuery.deptId = { $in: depts.map(d => d._id) };
    }

    const students = await M.Student.find(studentQuery)
      .select('trackId fullName registerNo classId deptId department deptName class section')
      .lean();

    const trackIds = students.map(s => s.trackId).filter(Boolean);
    const studentAttRecords = await M.StudentAttendance.find({
      studentTrackId: { $in: trackIds }
    }).lean();

    const attMap = {};
    studentAttRecords.forEach(rec => {
      const totalHeld = (rec.records || []).reduce((s, r) => s + (r.classesHeld || 0), 0);
      const totalAtt = (rec.records || []).reduce((s, r) => s + (r.classesAttended || 0), 0);
      const pct = totalHeld > 0 ? calculateAttendancePct(totalAtt, totalHeld) : 0;
      attMap[rec.studentTrackId] = { totalHeld, totalAtt, pct };
    });

    const allDefaulters = [];
    let criticalCount = 0;
    let condonationCount = 0;

    students.forEach(s => {
      const att = attMap[s.trackId];
      if (!att || att.totalHeld === 0) return;

      if (att.pct < minThreshold) {
        const band = calculateDefaulterBand(att.pct, condonationBand);
        if (band === 'critical') criticalCount++;
        else if (band === 'condonation') condonationCount++;

        const math = calculateClassesNeeded({
          currentPresent: att.totalAtt,
          currentTotal: att.totalHeld,
          targetPct: minThreshold
        });

        allDefaulters.push({
          studentTrackId: s.trackId,
          name: s.fullName,
          regNo: s.registerNo,
          className: s.class || '—',
          classId: s.classId,
          section: s.section || '—',
          deptName: s.department || s.deptName || '—',
          classesHeld: att.totalHeld,
          classesAttended: att.totalAtt,
          pct: att.pct,
          threshold: minThreshold,
          band,
          classesNeeded: math.classesNeeded,
          canReach: math.canReach,
          projectionMessage: math.message
        });
      }
    });

    // Filter by band if specified
    const filtered = bandFilter === 'all' 
      ? allDefaulters 
      : allDefaulters.filter(d => d.band === bandFilter);

    filtered.sort((a, b) => a.pct - b.pct);

    res.json({
      ok: true,
      threshold: minThreshold,
      condonationBand,
      count: filtered.length,
      totalDefaulters: allDefaulters.length,
      criticalCount,
      condonationCount,
      defaulters: filtered
    });
  } catch (err) {
    console.error('[Controller Defaulters Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 12. POST /api/controller/defaulters/meet — Bulk "Meet Me" Notice Action
router.post('/defaulters/meet', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const { studentTrackIds, message, customNote } = req.body;

    if (!Array.isArray(studentTrackIds) || studentTrackIds.length === 0) {
      return res.status(400).json({ error: 'No defaulter students selected' });
    }

    const students = await M.Student.find({ trackId: { $in: studentTrackIds } }).lean();
    const noticeText = message || `URGENT NOTICE: You are required to meet the ${ctx.role === 'principal' ? 'Principal' : 'HOD'} immediately regarding your low attendance. ${customNote ? 'Note: ' + customNote : ''}`;

    let sentCount = 0;
    const advisorTrackIds = new Set();

    for (const student of students) {
      // 1. Notify Student
      await M.Notification.create({
        type: 'attendance-alert',
        from: `${ctx.name} (${ctx.role.toUpperCase()})`,
        fromRole: ctx.role === 'principal' ? 'admin' : 'teacher',
        message: noticeText,
        priority: 'Urgent',
        toStudentId: student._id,
        toStudentTrackId: student.trackId,
        toStudentName: student.fullName,
        time: new Date()
      }).catch(() => {});

      sentCount++;

      // Find class advisor
      if (student.classId) {
        const cls = await M.Class.findById(student.classId).lean();
        if (cls?.advisorTeacherTrackId) {
          advisorTrackIds.add(cls.advisorTeacherTrackId);
        }
      }
    }

    // 2. Notify Class Advisors copy
    for (const advTrackId of advisorTrackIds) {
      const advTeacher = await M.Teacher.findOne({ trackId: advTrackId }).lean();
      if (!advTeacher) continue;

      await M.Notification.create({
        type: 'attendance-alert',
        from: `${ctx.name} (${ctx.role.toUpperCase()})`,
        fromRole: ctx.role === 'principal' ? 'admin' : 'teacher',
        message: `Copy: Attendance Meet Notice has been issued by ${ctx.role.toUpperCase()} to defaulters in your advised class.`,
        priority: 'Normal',
        toTeacherId: advTeacher._id,
        toTeacherTrackId: advTeacher.trackId,
        toTeacherName: advTeacher.fullName,
        time: new Date()
      }).catch(() => {});
    }

    // Record in BroadcastHistory
    await M.BroadcastHistory.create({
      message: noticeText,
      level: 'urgent',
      tag: ctx.role,
      targetRoles: ['student'],
      targetDeptId: ctx.role === 'hod' ? ctx.deptId : null,
      targetDeptCode: ctx.role === 'hod' ? ctx.deptCode : '',
      broadcastType: 'meet_defaulters',
      sentCount: sentCount,
      sentUserIds: studentTrackIds,
      dispatchedBy: {
        role: ctx.role === 'principal' ? 'admin' : 'teacher',
        username: req.user.username,
        name: ctx.name,
        trackId: ctx.trackId,
        ip: req.ip
      }
    });

    await logAction(
      ctx.trackId,
      ctx.name,
      ctx.role === 'principal' ? 'admin' : 'teacher',
      'Defaulters Meet Notice Sent',
      `Dispatched meet notice to ${sentCount} defaulter students`,
      'data',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'controller', subType: 'meet_defaulters' }
    );

    res.json({ success: true, sentCount, advisorsNotified: advisorTrackIds.size });
  } catch (err) {
    console.error('[Controller Meet Notice Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 13. GET /api/controller/reports/monthly — Aggregated monthly class attendance
router.get('/reports/monthly', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const monthStr = sanitizeToString(req.query.month) || getTodayIST().slice(0, 7); // YYYY-MM
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);

    const [year, month] = monthStr.split('-').map(Number);
    const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59));

    const classQuery = deptId ? { deptId } : {};
    const classes = await M.Class.find(classQuery).sort({ name: 1 }).lean();
    const classIds = classes.map(c => c.trackId || String(c._id));

    const attDocs = await M.ClassAttendance.find({
      date: { $gte: startDate, $lte: endDate },
      classId: { $in: classIds }
    }).lean();

    const monthlySummary = {};
    classes.forEach(c => {
      const key = c.trackId || String(c._id);
      monthlySummary[key] = {
        classId: c._id,
        className: c.name,
        deptName: c.deptName,
        section: c.section,
        year: c.year,
        sem: c.sem,
        daysConducted: 0,
        totalPresent: 0,
        totalAbsent: 0,
        pct: 0
      };
    });

    attDocs.forEach(doc => {
      const row = monthlySummary[doc.classId];
      if (!row) return;

      row.daysConducted++;
      (doc.periods || []).forEach(p => {
        (p.records || []).forEach(r => {
          if (r.status === 'P') row.totalPresent++;
          else if (r.status === 'AB') row.totalAbsent++;
        });
      });
    });

    Object.values(monthlySummary).forEach(row => {
      const tot = row.totalPresent + row.totalAbsent;
      row.pct = tot > 0 ? Math.round((row.totalPresent / tot) * 100) : 0;
    });

    res.json({
      month: monthStr,
      report: Object.values(monthlySummary)
    });
  } catch (err) {
    console.error('[Controller Monthly Report Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 14. GET /api/controller/reports/semester — Subject-wise semester summary
router.get('/reports/semester', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);
    const sem = Number(req.query.sem) || null;

    const query = {};
    if (deptId) query.deptId = deptId;
    if (sem) query.sem = sem;

    const subjects = await M.Subject.find(query).lean();
    const students = await M.Student.find(deptId ? { deptId } : {}).lean();
    const studentTrackIds = students.map(s => s.trackId).filter(Boolean);

    const attDocs = await M.StudentAttendance.find({
      studentTrackId: { $in: studentTrackIds }
    }).lean();

    const subjectStats = {};
    subjects.forEach(sub => {
      const key = sub.trackId || sub.code;
      subjectStats[key] = {
        code: sub.code,
        name: sub.name,
        sem: sub.sem,
        deptCode: sub.deptCode || '—',
        classesHeld: 0,
        classesAttended: 0,
        pct: 0
      };
    });

    attDocs.forEach(sDoc => {
      (sDoc.records || []).forEach(r => {
        if (subjectStats[r.subjectTrackId]) {
          subjectStats[r.subjectTrackId].classesHeld += r.classesHeld || 0;
          subjectStats[r.subjectTrackId].classesAttended += r.classesAttended || 0;
        }
      });
    });

    Object.values(subjectStats).forEach(row => {
      row.pct = row.classesHeld > 0 ? Math.round((row.classesAttended / row.classesHeld) * 100) : 0;
    });

    res.json(Object.values(subjectStats));
  } catch (err) {
    console.error('[Controller Semester Report Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 15. POST /api/controller/broadcast — Dispatch tagged announcement
router.post('/broadcast', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const { message, level, targetRoles, popupDurationSec } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Broadcast message content cannot be empty' });
    }

    const roles = Array.isArray(targetRoles) && targetRoles.length ? targetRoles : ['all'];
    const urgency = ['info', 'warning', 'urgent', 'success', 'message'].includes(level) ? level : 'info';

    // Department scoping
    const targetDeptId = ctx.role === 'hod' ? ctx.deptId : (req.body.targetDeptId || null);
    const targetDeptCode = ctx.role === 'hod' ? ctx.deptCode : (req.body.targetDeptCode || '');

    const broadcast = await M.BroadcastHistory.create({
      message: message.trim(),
      level: urgency,
      tag: ctx.role,
      targetRoles: roles,
      targetDeptId: targetDeptId,
      targetDeptCode: targetDeptCode,
      broadcastType: 'general',
      popupDurationSec: Number(popupDurationSec) || 10,
      dispatchedBy: {
        role: ctx.role === 'principal' ? 'admin' : 'teacher',
        username: req.user.username,
        name: ctx.name,
        trackId: ctx.trackId,
        ip: req.ip
      }
    });

    await logAction(
      ctx.trackId,
      ctx.name,
      ctx.role === 'principal' ? 'admin' : 'teacher',
      'Broadcast Dispatched',
      message.slice(0, 80),
      'data',
      urgency === 'urgent' ? 'warning' : 'info',
      req.ip,
      req.user.sessionId,
      { module: 'controller', subType: 'broadcast', tag: ctx.role }
    );

    res.status(201).json(broadcast);
  } catch (err) {
    console.error('[Controller Broadcast Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 16. GET /api/controller/broadcast/history — Broadcast dispatch logs
router.get('/broadcast/history', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const filter = {};

    if (ctx.role === 'hod') {
      filter.$or = [
        { 'dispatchedBy.trackId': ctx.trackId },
        { targetDeptId: ctx.deptId },
        { tag: 'principal' }
      ];
    }

    const history = await M.BroadcastHistory.find(filter)
      .sort({ dispatchedAt: -1 })
      .limit(50)
      .lean();

    res.json(history);
  } catch (err) {
    console.error('[Controller Broadcast History Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 17. GET /api/controller/calendar — Academic calendar viewer (read-only)
router.get('/calendar', async (req, res) => {
  try {
    const CalendarModel = M.CalendarDay || M.AcademicCalendar;
    const calendarDays = await CalendarModel.find({})
      .sort({ date: 1 })
      .lean();

    const calendarEvents = calendarDays.map(d => {
      const details = Array.isArray(d.details) ? d.details : [];
      const hasLeave = details.length > 0 && details.every(item => item.dayType === 'leave');
      const hasExam = details.some(item => item.dayType === 'exam');
      const isWorkingDay = details.length > 0 ? !hasLeave : (d.day !== 'Sunday');

      let type = 'Academic';
      if (hasExam) type = 'Exam';
      else if (hasLeave) type = 'Holiday';
      else if (details.some(item => item.dayType === 'half-day')) type = 'Half Day';
      else if (isWorkingDay) type = 'Working Day';

      const comments = details.map(item => item.comments).filter(Boolean).join('; ');
      const description = comments || (isWorkingDay ? 'Regular Schedule' : 'Institutional Holiday / Off');

      return {
        ...d,
        isWorkingDay,
        type,
        description,
        dayOrder: d.dayOrder || '—'
      };
    });

    res.json(calendarEvents);
  } catch (err) {
    console.error('[Controller Calendar Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 18. GET /api/controller/timetable — Class timetable master viewer (read-only)
router.get('/timetable', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isHod = ctx.role === 'hod';
    const deptId = isHod ? ctx.deptId : (sanitizeToString(req.query.deptId) || null);
    const classId = sanitizeToString(req.query.classId) || null;

    const query = {};
    if (deptId && mongoose.isValidObjectId(deptId)) query.deptId = deptId;
    if (classId && mongoose.isValidObjectId(classId)) query.classId = classId;

    let timetables = await M.SectionTimetable.find(query).lean();

    if (!timetables || timetables.length === 0) {
      let tQuery = {};
      if (classId) {
        tQuery.classId = classId;
      } else if (deptId) {
        const clsList = await M.Class.find({ deptId }).select('_id').lean();
        tQuery.classId = { $in: clsList.map(c => c._id) };
      }
      const rawSlots = await M.Timetable.find(tQuery).lean();
      const groupedByClass = {};
      rawSlots.forEach(s => {
        const cId = s.classId ? s.classId.toString() : 'unknown';
        if (!groupedByClass[cId]) {
          groupedByClass[cId] = {
            classId: s.classId,
            className: s.className || 'Class',
            schedule: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] }
          };
        }
        const dayMap = { mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday', fri: 'friday', sat: 'saturday' };
        const dayKey = dayMap[(s.day || '').toLowerCase().slice(0, 3)] || (s.day || '').toLowerCase();
        if (groupedByClass[cId].schedule[dayKey]) {
          groupedByClass[cId].schedule[dayKey].push({
            subject: s.subjectName,
            subjectCode: s.subjectName,
            teacherName: s.teacherName
          });
        }
      });
      timetables = Object.values(groupedByClass);
    } else {
      timetables = timetables.map(st => {
        const schedule = { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] };
        const slots = st.slots || {};
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

        days.forEach(day => {
          for (let p = 1; p <= 7; p++) {
            const capitalizedDay = day.charAt(0).toUpperCase() + day.slice(1);
            const slotData = slots[`${capitalizedDay}-${p}`] || slots[`${day}-${p}`] || slots[`${day.slice(0, 3)}-${p}`];
            if (slotData) {
              schedule[day].push({
                periodNumber: p,
                subject: slotData.subject || slotData.subjectName || slotData.code || slotData.subjectCode,
                subjectCode: slotData.subjectCode || slotData.code || slotData.subject,
                teacherName: slotData.staff || slotData.teacherName || slotData.faculty
              });
            }
          }
        });

        return {
          ...st,
          schedule
        };
      });
    }

    res.json(timetables);
  } catch (err) {
    console.error('[Controller Timetable Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 18b. GET /api/controller/workload - Faculty Workload & Schedule slot source & metrics
router.get('/workload', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isPrincipal = ctx.role === 'principal';
    const reqDeptId = sanitizeToString(req.query.deptId);
    const deptId = !isPrincipal ? ctx.deptId : (reqDeptId && mongoose.isValidObjectId(reqDeptId) ? reqDeptId : null);

    const query = {};
    if (deptId && mongoose.isValidObjectId(deptId)) query.deptId = deptId;

    let slotSources = await M.SectionTimetable.find(query).lean();

    // If no SectionTimetable, fallback to M.Timetable grouped by class
    if (!slotSources || slotSources.length === 0) {
      let tQuery = {};
      if (deptId) {
        const clsList = await M.Class.find({ deptId }).select('_id name').lean();
        tQuery.classId = { $in: clsList.map(c => c._id) };
      }
      const rawSlots = await M.Timetable.find(tQuery).lean();
      const grouped = {};
      rawSlots.forEach(s => {
        const cId = s.classId ? s.classId.toString() : 'unknown';
        if (!grouped[cId]) {
          grouped[cId] = {
            classId: s.classId,
            className: s.className || 'Class',
            deptId: deptId,
            slots: {}
          };
        }
        const dayMap = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
        const dFull = dayMap[(s.day || '').toLowerCase().slice(0, 3)] || s.day || 'Monday';
        const pKey = `${dFull}_P1`;
        grouped[cId].slots[pKey] = {
          day: dFull,
          period: 'P1',
          subject: s.subjectName,
          teacher: s.teacherName,
          room: '',
          span: 1
        };
      });
      slotSources = Object.values(grouped);
    }

    // Departments list for Principal dropdown
    let departments = [];
    if (isPrincipal) {
      departments = await M.Department.find({}).select('_id name code').sort({ name: 1 }).lean();
    }

    // Active teachers list in this scope
    let tchQuery = {};
    if (deptId) tchQuery.departmentId = deptId;
    const teachersList = await M.Teacher.find(tchQuery).select('fullName email departmentId trackId').lean();

    return res.json({
      ok: true,
      role: ctx.role,
      isPrincipal,
      deptId: ctx.deptId,
      deptName: ctx.deptName || '',
      selectedDeptId: deptId,
      departments,
      teachers: teachersList.map(t => t.fullName || t.name).filter(Boolean).sort(),
      data: slotSources
    });
  } catch (err) {
    console.error('[Controller Workload Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 19. GET /api/controller/inbox — Approvals Inbox (C7 §11)
router.get('/inbox', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isPrincipal = ctx.role === 'principal';
    const deptCodes = req.scope.deptCodes || [];
    const deptFilter = isPrincipal || !deptCodes.length ? {} : { deptCode: { $in: deptCodes } };
    const deptIdFilter = isPrincipal || !ctx.deptId ? {} : { deptId: ctx.deptId };

    const items = [];

    // 1. Faculty Leaves awaiting approval
    const flQuery = isPrincipal
      ? { status: { $in: ['pending_principal', 'Pending'] }, principalStatus: { $ne: 'Approved' } }
      : { status: { $in: ['pending_hod', 'Pending'] }, hodStatus: { $ne: 'Permitted' }, ...deptIdFilter };

    const facultyLeaves = await M.TeacherLeaveRequest.find(flQuery)
      .sort({ createdAt: 1 })
      .limit(30)
      .lean();

    facultyLeaves.forEach(fl => {
      items.push({
        id: fl._id,
        type: 'faculty_leave',
        title: `Faculty Leave: ${fl.teacherName || 'Faculty'}`,
        subtitle: `${fl.leaveType || 'Leave'} · ${fl.dates?.length || 1} day(s) · ${fl.fromDate} to ${fl.toDate}`,
        badge: fl.isEmergency ? 'Urgent' : 'Leave',
        badgeClass: fl.isEmergency ? 'danger' : 'warning',
        createdAt: fl.createdAt,
        requester: fl.teacherName,
        department: fl.deptCode || fl.deptName || '',
        context: {
          daysCount: fl.daysCount,
          reason: fl.reason,
          substitutionsCount: fl.substitutions?.length || 0,
          unresolvedCount: fl.substitutions?.filter(s => s.isUnresolved || s.status === 'rejected')?.length || 0
        },
        actions: ['approve', 'reject']
      });
    });

    // 2. Student OD Requests awaiting HOD / Principal stage
    const odStage = isPrincipal ? 'principal' : 'hod';
    const odQuery = {
      status: 'pending',
      currentStage: odStage,
      ...deptFilter
    };

    const odRequests = await M.ODRequest.find(odQuery)
      .sort({ createdAt: 1 })
      .limit(30)
      .lean();

    odRequests.forEach(od => {
      items.push({
        id: od._id,
        type: 'student_od',
        title: `Student OD: ${od.studentName} (${od.studentRegNo || od.className})`,
        subtitle: `${od.eventDetails?.name || 'Academic Event'} · ${od.dates?.join(', ')}`,
        badge: 'OD Approval',
        badgeClass: 'primary',
        createdAt: od.createdAt,
        requester: od.studentName,
        department: od.deptCode || '',
        context: {
          eventName: od.eventDetails?.name,
          organizer: od.eventDetails?.organizer,
          daysCount: od.daysCount,
          score: od.odVerificationScore || null,
          evidenceCount: od.evidenceAtRequest?.length || 0
        },
        actions: ['approve', 'reject']
      });
    });

    // 3. Evidence Overdue ODs
    const overdueODs = await M.ODRequest.find({
      status: 'evidence_overdue',
      ...deptFilter
    })
      .sort({ updatedAt: 1 })
      .limit(20)
      .lean();

    overdueODs.forEach(od => {
      items.push({
        id: od._id,
        type: 'evidence_overdue',
        title: `Evidence Overdue: ${od.studentName}`,
        subtitle: `${od.eventDetails?.name || 'Event'} — Outcome documents not submitted`,
        badge: 'Overdue',
        badgeClass: 'danger',
        createdAt: od.updatedAt || od.createdAt,
        requester: od.studentName,
        department: od.deptCode || '',
        context: {
          eventName: od.eventDetails?.name,
          dates: od.dates
        },
        actions: ['reject_dates', 'extend_window']
      });
    });

    // 4. Attendance Unlock Requests (Alerts)
    const alertQuery = {
      status: 'open',
      type: { $in: ['unlock_request', 'attendance_unlock', 'attendance_correction'] }
    };
    if (!isPrincipal && deptCodes.length) {
      alertQuery.deptCode = { $in: deptCodes };
    }

    const unlockAlerts = await M.Alert.find(alertQuery)
      .sort({ createdAt: 1 })
      .limit(20)
      .lean();

    unlockAlerts.forEach(a => {
      items.push({
        id: a._id,
        type: 'attendance_unlock',
        title: `Unlock Request: ${a.message || 'Attendance Modification'}`,
        subtitle: `Class: ${a.className || 'Class'} · Period ${a.context?.periodNumber || '—'} · Date ${a.context?.date || 'Today'}`,
        badge: 'Unlock',
        badgeClass: 'warning',
        createdAt: a.createdAt,
        requester: a.teacherName || a.context?.teacherName || 'Faculty',
        department: a.deptCode || '',
        context: a.context || {},
        actions: ['approve', 'reject']
      });
    });

    // 5. Unresolved Substitutions (Today)
    const unresolvedSessions = await M.ClassSession.find({
      date: getTodayIST(),
      flags: 'unresolved_sub',
      status: 'scheduled',
      ...deptFilter
    })
      .sort({ periodNumber: 1 })
      .limit(20)
      .lean();

    unresolvedSessions.forEach(s => {
      items.push({
        id: s._id,
        type: 'unresolved_substitution',
        title: `Unresolved Sub: ${s.className} (${s.subjectName || 'Subject'})`,
        subtitle: `Period ${s.periodNumber} (${s.start}–${s.end}) · Room: ${s.room || 'TBD'}`,
        badge: 'Unresolved',
        badgeClass: 'danger',
        createdAt: s.createdAt || new Date(),
        requester: s.scheduledTeacher?.name || 'Scheduled Teacher',
        department: s.deptCode || '',
        context: {
          periodNumber: s.periodNumber,
          room: s.room,
          classId: s.classId
        },
        actions: ['assign_sub']
      });
    });

    // 6. Timetable Verification requests awaiting HoD / Principal review
    const ttFilter = {
      verificationStatus: 'pending'
    };
    if (!isPrincipal) {
      const orBranches = [];
      if (req.user && req.user._id) {
        orBranches.push({ 'verificationRequest.hodId': req.user._id });
      }
      const deptIdTarget = ctx.deptId || req.user.deptId;
      const deptCodesTarget = (req.scope?.deptCodes?.length ? req.scope.deptCodes : [ctx.deptCode, req.user.deptCode]).filter(Boolean);
      const classOr = [];
      if (deptIdTarget && mongoose.isValidObjectId(deptIdTarget)) {
        classOr.push({ deptId: deptIdTarget });
      }
      if (deptCodesTarget.length) {
        classOr.push({ deptCode: { $in: deptCodesTarget.map(c => new RegExp(`^${c}$`, 'i')) } });
      }
      if (ctx.deptName) {
        classOr.push({ department: new RegExp(`^${ctx.deptName}$`, 'i') });
      }
      let cIds = [];
      if (classOr.length) {
        const deptClasses = await M.Class.find({ $or: classOr }).select('_id').lean();
        cIds = deptClasses.map(c => c._id);
      }
      if (cIds.length) {
        orBranches.push({ classId: { $in: cIds } });
      }
      if (orBranches.length) {
        ttFilter.$or = orBranches;
      }
    }
    const ttRequests = await M.TimetableVersion.find(ttFilter).sort({ 'verificationRequest.requestedAt': 1 }).limit(20).lean();
    ttRequests.forEach(tt => {
      items.push({
        id: tt._id,
        type: 'timetable_verification',
        title: `Timetable Verification: ${tt.className || 'Class'} (${tt.versionName || `v${tt.version}`})`,
        subtitle: `Submitted by ${tt.verificationRequest?.requestedBy || tt.savedBy || 'Coordinator'} · ${tt.verificationRequest?.notes || tt.changeSummary || 'Ready for review'}`,
        badge: 'Timetable',
        badgeClass: 'warning',
        createdAt: tt.verificationRequest?.requestedAt || tt.createdAt,
        requester: tt.verificationRequest?.requestedBy || tt.savedBy || 'Coordinator',
        context: {
          className: tt.className || '',
          versionName: tt.versionName || `v${tt.version}`,
          submitter: tt.verificationRequest?.requestedBy || tt.savedBy || 'Coordinator',
          notes: tt.verificationRequest?.notes || tt.changeSummary || ''
        },
        actions: ['approve', 'reject']
      });
    });

    // Sort all items oldest first (FIFO)
    items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    res.json({
      ok: true,
      totalCount: items.length,
      items
    });
  } catch (err) {
    console.error('[Controller Inbox Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 20. GET /api/controller/reports/daily — Daily Executive Department & Roll-up Report (C7 §12)
router.get('/reports/daily', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isPrincipal = ctx.role === 'principal';
    const targetDate = sanitizeToString(req.query.date) || getTodayIST();
    const deptCodes = req.scope.deptCodes || [];
    
    // Scoping
    const query = { date: targetDate };
    if (!isPrincipal && deptCodes.length) {
      query.deptCode = { $in: deptCodes };
    } else if (req.query.deptCode) {
      query.deptCode = String(req.query.deptCode).toUpperCase();
    }

    const sessions = await M.ClassSession.find(query).lean();

    let totalScheduled = sessions.length;
    let held = 0;
    let cancelled = 0;
    let markedOnTime = 0;
    let markedLate = 0;
    let overdue = 0;
    let substitutionsCount = 0;
    let totalPresentSum = 0;
    let totalRosterSum = 0;

    const currentTime = getCurrentTimeHM();
    const currentMins = timeToMinutes(currentTime);

    sessions.forEach(s => {
      if (s.status === 'cancelled') {
        cancelled++;
        return;
      }
      if (s.source === 'substitution') {
        substitutionsCount++;
      }

      if (s.attendance && s.attendance.savedAt) {
        held++;
        if (s.attendance.onTime === true) {
          markedOnTime++;
        } else {
          markedLate++;
        }
        totalPresentSum += (s.attendance.present || 0);
        totalRosterSum += (s.attendance.total || 0);
      } else {
        const startMins = timeToMinutes(s.start || '08:30');
        if (currentMins > startMins + 10) {
          overdue++;
        }
      }
    });

    const onTimeRate = held > 0 ? Math.round((markedOnTime / held) * 100) : 0;
    const avgPresence = totalRosterSum > 0 ? Math.round((totalPresentSum / totalRosterSum) * 100) : 0;

    // Roll-up by Department (for Principal)
    const deptsRollup = {};
    if (isPrincipal) {
      sessions.forEach(s => {
        const d = s.deptCode || 'GENERAL';
        if (!deptsRollup[d]) {
          deptsRollup[d] = {
            deptCode: d,
            totalScheduled: 0,
            held: 0,
            markedOnTime: 0,
            markedLate: 0,
            overdue: 0,
            presentSum: 0,
            rosterSum: 0
          };
        }
        deptsRollup[d].totalScheduled++;
        if (s.attendance && s.attendance.savedAt) {
          deptsRollup[d].held++;
          if (s.attendance.onTime) deptsRollup[d].markedOnTime++;
          else deptsRollup[d].markedLate++;
          deptsRollup[d].presentSum += (s.attendance.present || 0);
          deptsRollup[d].rosterSum += (s.attendance.total || 0);
        } else if (currentMins > timeToMinutes(s.start || '08:30') + 10) {
          deptsRollup[d].overdue++;
        }
      });
      Object.values(deptsRollup).forEach(d => {
        d.onTimePct = d.held > 0 ? Math.round((d.markedOnTime / d.held) * 100) : 0;
        d.avgPresencePct = d.rosterSum > 0 ? Math.round((d.presentSum / d.rosterSum) * 100) : 0;
      });
    }

    // Breakdown by Section
    const sectionsBreakdown = {};
    sessions.forEach(s => {
      const secKey = s.className || s.classId || 'Class';
      if (!sectionsBreakdown[secKey]) {
        sectionsBreakdown[secKey] = {
          className: secKey,
          deptCode: s.deptCode,
          scheduled: 0,
          held: 0,
          onTime: 0,
          late: 0,
          present: 0,
          roster: 0
        };
      }
      sectionsBreakdown[secKey].scheduled++;
      if (s.attendance && s.attendance.savedAt) {
        sectionsBreakdown[secKey].held++;
        if (s.attendance.onTime) sectionsBreakdown[secKey].onTime++;
        else sectionsBreakdown[secKey].late++;
        sectionsBreakdown[secKey].present += (s.attendance.present || 0);
        sectionsBreakdown[secKey].roster += (s.attendance.total || 0);
      }
    });

    Object.values(sectionsBreakdown).forEach(sec => {
      sec.presencePct = sec.roster > 0 ? Math.round((sec.present / sec.roster) * 100) : 0;
      sec.onTimePct = sec.held > 0 ? Math.round((sec.onTime / sec.held) * 100) : 0;
    });

    // Insights
    const insights = [];
    if (onTimeRate >= 90) {
      insights.push(`High punctuality compliance: ${onTimeRate}% of classes marked within the 10-minute gold standard.`);
    } else if (onTimeRate < 70 && held > 0) {
      insights.push(`Punctuality alert: On-time marking is currently ${onTimeRate}%. Consider sending reminders.`);
    }
    if (overdue > 0) {
      insights.push(`${overdue} session(s) overdue and currently unmarked.`);
    }
    if (substitutionsCount > 0) {
      insights.push(`${substitutionsCount} substitution session(s) active today.`);
    }

    res.json({
      ok: true,
      date: targetDate,
      summary: {
        totalScheduled,
        held,
        cancelled,
        markedOnTime,
        markedLate,
        overdue,
        onTimeRate,
        averagePresence: avgPresence,
        substitutionsCount
      },
      departmentsRollup: Object.values(deptsRollup),
      sectionsBreakdown: Object.values(sectionsBreakdown),
      insights
    });
  } catch (err) {
    console.error('[Controller Daily Report Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 21. GET /api/controller/reports/punctuality — Faculty Punctuality & Coverage Report (C7 §12)
router.get('/reports/punctuality', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isPrincipal = ctx.role === 'principal';
    const deptCodes = req.scope.deptCodes || [];

    const query = {};
    if (!isPrincipal && deptCodes.length) {
      query.deptCode = { $in: deptCodes };
    } else if (req.query.deptCode) {
      query.deptCode = String(req.query.deptCode).toUpperCase();
    }

    if (req.query.startDate && req.query.endDate) {
      query.date = { $gte: req.query.startDate, $lte: req.query.endDate };
    }

    const sessions = await M.ClassSession.find(query).lean();

    // Group by teacher
    const teacherStats = {};

    sessions.forEach(s => {
      const tTrackId = s.actualTeacher?.trackId || s.scheduledTeacher?.trackId;
      const tName = s.actualTeacher?.name || s.scheduledTeacher?.name;
      if (!tTrackId) return;

      if (!teacherStats[tTrackId]) {
        teacherStats[tTrackId] = {
          trackId: tTrackId,
          name: tName || 'Faculty',
          deptCode: s.deptCode || '',
          totalAssigned: 0,
          totalConducted: 0,
          startClassTaps: 0,
          onTimeCount: 0,
          lateCount: 0,
          minutesList: [],
          substitutionsConducted: 0
        };
      }

      teacherStats[tTrackId].totalAssigned++;

      if (s.startClass && s.startClass.at) {
        teacherStats[tTrackId].startClassTaps++;
      }

      if (s.source === 'substitution') {
        teacherStats[tTrackId].substitutionsConducted++;
      }

      if (s.attendance && s.attendance.savedAt) {
        teacherStats[tTrackId].totalConducted++;
        if (s.attendance.onTime === true) {
          teacherStats[tTrackId].onTimeCount++;
        } else {
          teacherStats[tTrackId].lateCount++;
        }
        if (typeof s.attendance.minutesAfterStart === 'number') {
          teacherStats[tTrackId].minutesList.push(s.attendance.minutesAfterStart);
        }
      }
    });

    const results = Object.values(teacherStats).map(t => {
      const tapRate = t.totalAssigned > 0 ? Math.round((t.startClassTaps / t.totalAssigned) * 100) : 0;
      const onTimeRate = t.totalConducted > 0 ? Math.round((t.onTimeCount / t.totalConducted) * 100) : 0;
      
      let medianMinutes = 0;
      if (t.minutesList.length) {
        t.minutesList.sort((a, b) => a - b);
        const mid = Math.floor(t.minutesList.length / 2);
        medianMinutes = t.minutesList.length % 2 !== 0 ? t.minutesList[mid] : Math.round((t.minutesList[mid - 1] + t.minutesList[mid]) / 2);
      }

      return {
        trackId: t.trackId,
        name: t.name,
        deptCode: t.deptCode,
        totalAssigned: t.totalAssigned,
        totalConducted: t.totalConducted,
        tapRate,
        onTimeRate,
        medianMinutes,
        substitutionsConducted: t.substitutionsConducted
      };
    });

    results.sort((a, b) => b.totalConducted - a.totalConducted);

    res.json({
      ok: true,
      count: results.length,
      teachers: results
    });
  } catch (err) {
    console.error('[Controller Punctuality Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 22. GET /api/controller/reports/heatmap — Weekday × Period & Section × Date Presence Heatmaps (C7 §12)
router.get('/reports/heatmap', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isPrincipal = ctx.role === 'principal';
    const deptCodes = req.scope.deptCodes || [];

    const query = {};
    if (!isPrincipal && deptCodes.length) {
      query.deptCode = { $in: deptCodes };
    } else if (req.query.deptCode) {
      query.deptCode = String(req.query.deptCode).toUpperCase();
    }

    const sessions = await M.ClassSession.find(query).limit(1000).lean();

    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekdayPeriodMatrix = {};
    weekdays.forEach(d => {
      weekdayPeriodMatrix[d] = {};
      for (let p = 1; p <= 8; p++) {
        weekdayPeriodMatrix[d][`P${p}`] = { present: 0, total: 0, count: 0 };
      }
    });

    sessions.forEach(s => {
      if (!s.attendance || !s.attendance.savedAt) return;
      const dName = s.day || 'Monday';
      const pKey = `P${s.periodNumber || 1}`;
      if (weekdayPeriodMatrix[dName] && weekdayPeriodMatrix[dName][pKey]) {
        weekdayPeriodMatrix[dName][pKey].present += (s.attendance.present || 0);
        weekdayPeriodMatrix[dName][pKey].total += (s.attendance.total || 0);
        weekdayPeriodMatrix[dName][pKey].count++;
      }
    });

    const heatmapData = {};
    weekdays.forEach(d => {
      heatmapData[d] = {};
      for (let p = 1; p <= 8; p++) {
        const cell = weekdayPeriodMatrix[d][`P${p}`];
        heatmapData[d][`P${p}`] = cell.total > 0 ? Math.round((cell.present / cell.total) * 100) : null;
      }
    });

    res.json({
      ok: true,
      heatmap: heatmapData
    });
  } catch (err) {
    console.error('[Controller Heatmap Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 23. GET /api/controller/reports/subjects — Subject-level Performance and Defaulter Risk (C7 §12)
router.get('/reports/subjects', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isPrincipal = ctx.role === 'principal';
    const deptCodes = req.scope.deptCodes || [];

    const query = {};
    if (!isPrincipal && deptCodes.length) {
      query.deptCode = { $in: deptCodes };
    } else if (req.query.deptCode) {
      query.deptCode = String(req.query.deptCode).toUpperCase();
    }

    const sessions = await M.ClassSession.find(query).limit(1000).lean();

    const subjMap = {};
    sessions.forEach(s => {
      const code = s.subjectId || s.subjectName || 'GEN';
      const name = s.subjectName || code;
      if (!subjMap[code]) {
        subjMap[code] = {
          code,
          name,
          deptCode: s.deptCode,
          classesConducted: 0,
          presentSum: 0,
          rosterSum: 0,
          teacherName: s.actualTeacher?.name || s.scheduledTeacher?.name || '—'
        };
      }
      if (s.attendance && s.attendance.savedAt) {
        subjMap[code].classesConducted++;
        subjMap[code].presentSum += (s.attendance.present || 0);
        subjMap[code].rosterSum += (s.attendance.total || 0);
      }
    });

    const subjects = Object.values(subjMap).map(s => {
      const avgAttendance = s.rosterSum > 0 ? Math.round((s.presentSum / s.rosterSum) * 100) : 0;
      return {
        code: s.code,
        name: s.name,
        deptCode: s.deptCode,
        classesConducted: s.classesConducted,
        teacherName: s.teacherName,
        avgAttendance
      };
    });

    subjects.sort((a, b) => b.classesConducted - a.classesConducted);

    res.json({ ok: true, count: subjects.length, subjects });
  } catch (err) {
    console.error('[Controller Subjects Report Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 24. GET /api/controller/reports/export/:kind — Export Reports to CSV (C7 §12)
router.get('/reports/export/:kind', async (req, res) => {
  try {
    const kind = req.params.kind;
    const today = getTodayIST();

    if (kind === 'daily') {
      const sessions = await M.ClassSession.find({ date: today }).lean();
      const headers = ['Period', 'Class', 'Subject', 'Teacher', 'Status', 'Start Class Tapped', 'Attendance Marked', 'On Time', 'Present', 'Total Roster'];
      const rows = [headers];
      sessions.forEach(s => {
        rows.push([
          `P${s.periodNumber || 1}`,
          `"${s.className || ''}"`,
          `"${s.subjectName || ''}"`,
          `"${s.actualTeacher?.name || s.scheduledTeacher?.name || ''}"`,
          s.status || 'scheduled',
          s.startClass?.at ? 'Yes' : 'No',
          s.attendance?.savedAt ? 'Yes' : 'No',
          s.attendance?.onTime ? 'On Time' : (s.attendance?.savedAt ? 'Late' : 'Unmarked'),
          s.attendance?.present || 0,
          s.attendance?.total || 0
        ]);
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="daily-attendance-report-${today}.csv"`);
      return res.send(rows.map(r => r.join(',')).join('\n'));
    }

    if (kind === 'punctuality') {
      const sessions = await M.ClassSession.find({}).limit(500).lean();
      const teacherStats = {};
      sessions.forEach(s => {
        const tTrackId = s.actualTeacher?.trackId || s.scheduledTeacher?.trackId;
        const tName = s.actualTeacher?.name || s.scheduledTeacher?.name;
        if (!tTrackId) return;
        if (!teacherStats[tTrackId]) {
          teacherStats[tTrackId] = { name: tName || 'Faculty', dept: s.deptCode || '', assigned: 0, conducted: 0, taps: 0, onTime: 0 };
        }
        teacherStats[tTrackId].assigned++;
        if (s.startClass?.at) teacherStats[tTrackId].taps++;
        if (s.attendance?.savedAt) {
          teacherStats[tTrackId].conducted++;
          if (s.attendance.onTime) teacherStats[tTrackId].onTime++;
        }
      });

      const headers = ['Faculty Name', 'Dept', 'Assigned Periods', 'Conducted', 'Start Tap Rate %', 'On Time Rate %'];
      const rows = [headers];
      Object.values(teacherStats).forEach(t => {
        const tapRate = t.assigned > 0 ? Math.round((t.taps / t.assigned) * 100) : 0;
        const onTimeRate = t.conducted > 0 ? Math.round((t.onTime / t.conducted) * 100) : 0;
        rows.push([`"${t.name}"`, `"${t.dept}"`, t.assigned, t.conducted, `${tapRate}%`, `${onTimeRate}%`]);
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="faculty-punctuality-${today}.csv"`);
      return res.send(rows.map(r => r.join(',')).join('\n'));
    }

    return res.status(400).json({ error: 'Unsupported export kind' });
  } catch (err) {
    console.error('[Controller Export Error]:', err);
    res.status(500).send('Failed to generate export');
  }
});

// 25. POST /api/controller/calendar/holiday — Declare Holiday / Half-Day (C7 §14)
router.post('/calendar/holiday', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const { date, type, comments, scope, deptCode } = req.body;

    if (!date) {
      return res.status(400).json({ error: 'Date is required to declare holiday' });
    }

    const dayType = ['holiday', 'half-day', 'leave'].includes(type) ? type : 'holiday';
    const targetDate = new Date(date + 'T00:00:00.000Z');
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dayStr = dayNames[targetDate.getUTCDay()];

    const CalendarModel = M.CalendarDay || M.AcademicCalendar;
    let calDay = await CalendarModel.findOne({ date: targetDate });

    if (!calDay) {
      calDay = new CalendarModel({
        CalendarTrackId: `CAL-${date}`,
        date: targetDate,
        day: dayStr,
        details: [
          { year: 'I', dayType, comments: comments || `${dayType} declared by ${ctx.name}` },
          { year: 'II', dayType, comments: comments || `${dayType} declared by ${ctx.name}` },
          { year: 'III', dayType, comments: comments || `${dayType} declared by ${ctx.name}` },
          { year: 'IV', dayType, comments: comments || `${dayType} declared by ${ctx.name}` }
        ],
        createdBy: ctx.name
      });
    } else {
      calDay.details = ['I', 'II', 'III', 'IV'].map(yr => ({
        year: yr,
        dayType,
        comments: comments || `${dayType} declared by ${ctx.name}`
      }));
    }
    await calDay.save();

    // Update ClassSession records on this date
    const sessionFilter = { date };
    if (ctx.role === 'hod') {
      sessionFilter.deptCode = ctx.deptCode;
    } else if (deptCode) {
      sessionFilter.deptCode = deptCode;
    }

    await M.ClassSession.updateMany(
      sessionFilter,
      {
        $set: {
          status: dayType === 'half-day' ? 'scheduled' : 'holiday',
          flags: [`calendar_${dayType}`]
        }
      }
    );

    await logAction(
      ctx.trackId,
      ctx.name,
      ctx.role === 'principal' ? 'admin' : 'teacher',
      'Declared Academic Event',
      `${dayType.toUpperCase()} on ${date}: ${comments || 'No comments'}`,
      'academic',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'controller', subType: 'calendar-holiday', date, dayType }
    );

    broadcastSSE('calendar:holiday', { date, dayType, comments, by: ctx.name });

    res.json({
      ok: true,
      message: `Successfully declared ${dayType} for ${date}`,
      calendarDay: calDay
    });
  } catch (err) {
    console.error('[Controller Holiday Declaration Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 26. POST /api/controller/attendance/extend-lock — Extend Attendance Marking Lock Window (C7 §14)
router.post('/attendance/extend-lock', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const { date, minutes, reason } = req.body;
    const targetDate = date || getTodayIST();
    const extendMins = Number(minutes) || 60;

    const sessionFilter = { date: targetDate };
    if (ctx.role === 'hod') {
      sessionFilter.deptCode = ctx.deptCode;
    }

    await M.ClassSession.updateMany(
      sessionFilter,
      {
        $addToSet: { flags: 'lock_extended' },
        $push: {
          notes: {
            by: ctx.name,
            text: `Attendance lock extended by ${extendMins} mins: ${reason || 'Administrative Extension'}`,
            at: new Date()
          }
        }
      }
    );

    await logAction(
      ctx.trackId,
      ctx.name,
      ctx.role === 'principal' ? 'admin' : 'teacher',
      'Extended Attendance Lock',
      `Extended lock by ${extendMins}m on ${targetDate}. Reason: ${reason || 'Administrative'}`,
      'attendance',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'controller', subType: 'extend-lock', date: targetDate, extendMins }
    );

    broadcastSSE('attendance:lock-extended', { date: targetDate, extendMins, reason, by: ctx.name });

    res.json({
      ok: true,
      message: `Attendance lock extended by ${extendMins} minutes for ${targetDate}`
    });
  } catch (err) {
    console.error('[Controller Extend Lock Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 27. GET /api/controller/audit — Executive Audit Log (C7 §16)
router.get('/audit', async (req, res) => {
  try {
    const ctx = req.controllerContext;
    const isPrincipal = ctx.role === 'principal';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const skip = (page - 1) * limit;

    const filter = {};
    if (!isPrincipal) {
      filter.$or = [
        { 'details.deptCode': ctx.deptCode },
        { tag: ctx.role },
        { trackId: ctx.trackId },
        { module: 'controller' }
      ];
    }

    if (req.query.severity) {
      filter.severity = req.query.severity;
    }
    if (req.query.module) {
      filter.module = req.query.module;
    }
    if (req.query.search) {
      const s = String(req.query.search).trim();
      filter.$or = [
        { action: { $regex: s, $options: 'i' } },
        { userName: { $regex: s, $options: 'i' } },
        { trackId: { $regex: s, $options: 'i' } }
      ];
    }

    const [total, rawLogs] = await Promise.all([
      M.Log.countDocuments(filter),
      M.Log.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    const logs = rawLogs.map(l => {
      let decrypted = {};
      if (l.encryptedPayload) {
        try {
          const dec = decryptLog(l.encryptedPayload);
          decrypted = typeof dec === 'object' ? dec : { text: dec };
        } catch (e) {
          decrypted = { raw: l.encryptedPayload };
        }
      }
      return {
        trackId: l.trackId,
        actor: l.userName || 'System',
        role: l.role || 'system',
        action: l.action,
        category: l.category || 'general',
        severity: l.severity || 'info',
        module: l.module || 'controller',
        ip: l.ip || '127.0.0.1',
        createdAt: l.createdAt,
        details: decrypted
      };
    });

    res.json({
      ok: true,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      logs
    });
  } catch (err) {
    console.error('[Controller Audit Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
