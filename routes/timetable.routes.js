const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { decryptLog } = require('../utils/logCrypto');
const { sanitizeToString, sanitizeToObjectId } = require('../utils/sanitizeQuery');
const escapeRegex = s => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const jwt = require('jsonwebtoken');
const cfg = require('../config');
const {
  generateBoardApiKey,
  resolveRoomTimetableContext,
  sendCommandToBoard,
  broadcastToMonitors
} = require('../services/board.socket');

// ── Default institutional timing sets (seeded on first request) ──

const TIMING_SEED = [
  {
    code: 'SET_1',
    name: 'Timing Set 1 (Years I & IV)',
    applicableYears: ['1', '4', 'I', 'IV'],
    morningBreakAfter: 2,
    lunchAfter: 6,
    isDefault: true,
    periods: [
      { periodNumber: 1, number: 1, start: '08:30', end: '09:15', label: 'Period 1', isBreak: false, breakType: 'None' },
      { periodNumber: 2, number: 2, start: '09:15', end: '10:00', label: 'Period 2', isBreak: false, breakType: 'None' },
      { periodNumber: 0, number: 0, start: '10:00', end: '10:15', label: 'Morning Break', isBreak: true, breakType: 'Interval' },
      { periodNumber: 3, number: 3, start: '10:15', end: '11:00', label: 'Period 3', isBreak: false, breakType: 'None' },
      { periodNumber: 4, number: 4, start: '11:00', end: '11:45', label: 'Period 4', isBreak: false, breakType: 'None' },
      { periodNumber: 5, number: 5, start: '11:45', end: '12:30', label: 'Period 5', isBreak: false, breakType: 'None' },
      { periodNumber: 6, number: 6, start: '12:30', end: '13:15', label: 'Period 6', isBreak: false, breakType: 'None' },
      { periodNumber: 0, number: 0, start: '13:15', end: '14:00', label: 'Lunch Break', isBreak: true, breakType: 'Lunch' },
      { periodNumber: 7, number: 7, start: '14:00', end: '14:45', label: 'Period 7', isBreak: false, breakType: 'None' },
      { periodNumber: 8, number: 8, start: '14:45', end: '15:30', label: 'Period 8', isBreak: false, breakType: 'None' },
      { periodNumber: 0, number: 0, start: '15:30', end: '15:45', label: 'Tea Break', isBreak: true, breakType: 'Tea' },
      { periodNumber: 9, number: 9, start: '15:45', end: '16:30', label: 'Period 9', isBreak: false, breakType: 'None' }
    ]
  },
  {
    code: 'SET_2',
    name: 'Timing Set 2 (Years II & III)',
    applicableYears: ['2', '3', 'II', 'III'],
    morningBreakAfter: 3,
    lunchAfter: 6,
    isDefault: false,
    periods: [
      { periodNumber: 1, number: 1, start: '08:30', end: '09:15', label: 'Period 1', isBreak: false, breakType: 'None' },
      { periodNumber: 2, number: 2, start: '09:15', end: '10:00', label: 'Period 2', isBreak: false, breakType: 'None' },
      { periodNumber: 3, number: 3, start: '10:00', end: '10:45', label: 'Period 3', isBreak: false, breakType: 'None' },
      { periodNumber: 0, number: 0, start: '10:45', end: '11:00', label: 'Morning Break', isBreak: true, breakType: 'Interval' },
      { periodNumber: 4, number: 4, start: '11:00', end: '11:45', label: 'Period 4', isBreak: false, breakType: 'None' },
      { periodNumber: 5, number: 5, start: '11:45', end: '12:30', label: 'Period 5', isBreak: false, breakType: 'None' },
      { periodNumber: 6, number: 6, start: '12:30', end: '13:15', label: 'Period 6', isBreak: false, breakType: 'None' },
      { periodNumber: 0, number: 0, start: '13:15', end: '14:00', label: 'Lunch Break', isBreak: true, breakType: 'Lunch' },
      { periodNumber: 7, number: 7, start: '14:00', end: '14:45', label: 'Period 7', isBreak: false, breakType: 'None' },
      { periodNumber: 8, number: 8, start: '14:45', end: '15:30', label: 'Period 8', isBreak: false, breakType: 'None' },
      { periodNumber: 0, number: 0, start: '15:30', end: '15:45', label: 'Tea Break', isBreak: true, breakType: 'Tea' },
      { periodNumber: 9, number: 9, start: '15:45', end: '16:30', label: 'Period 9', isBreak: false, breakType: 'None' }
    ]
  }
];


// ── Authorization helpers ──

function canManage(req) {
  const u = req.user;
  if (!u) return false;
  if (u.role === 'admin' || u.isAdmin) return true;
  if (u.isTimeTableCoordinator === true) return true;
  const rights = Array.isArray(u.adminRights) ? u.adminRights : (typeof u.adminRights === 'string' ? [u.adminRights] : []);
  if (rights.includes('timetablePage') || rights.includes('all')) return true;
  return false;
}

function requireManager(req, res, next) {
  if (!canManage(req)) {
    return res.status(403).json({ error: 'Timetable Coordinator access required' });
  }
  next();
}


// ── Greedy constraint-based auto-generation engine ──

function greedyGenerate(input = {}) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const periods = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const breakPeriods = new Set([3, 6]);
  const occupied = new Set();
  const grid = [];
  const conflicts = [];

  (input.assignments || []).forEach(job => {
    const count = Math.max(1, Number(job.periodsPerWeek || job.hours || 1));
    for (let n = 0; n < count; n += 1) {
      let chosen;
      for (const day of days) {
        for (const period of periods) {
          if (breakPeriods.has(period)) continue;
          const key = `${day}:${period}`;
          const teacherKey = `${key}:teacher:${job.staffId || job.staffName || 'TBA'}`;
          const roomKey = `${key}:room:${job.room || 'TBA'}`;
          if (!occupied.has(teacherKey) && !occupied.has(roomKey)) {
            chosen = { day, period };
            break;
          }
        }
        if (chosen) break;
      }
      if (!chosen) {
        conflicts.push({
          kind: 'hard',
          title: `No valid slot for ${job.subjectShortName || job.name || 'assignment'}`,
          detail: 'Teacher or room availability is exhausted.',
          fix: 'Expand scheduling scope'
        });
        continue;
      }
      const key = `${chosen.day}:${chosen.period}`;
      occupied.add(`${key}:teacher:${job.staffId || job.staffName || 'TBA'}`);
      occupied.add(`${key}:room:${job.room || 'TBA'}`);
      grid.push({
        ...chosen,
        assignmentId: job._id,
        subject: job.subjectShortName || job.name,
        teacher: job.staffName,
        room: job.room,
        isLab: Boolean(job.isLab),
        span: job.isLab ? 3 : 1
      });
    }
  });

  return { grid, conflicts, status: 'draft', algorithm: 'greedy-constraint-v1' };
}


// ── Transactional publish helper ──

async function snapshotAndPublish(template, req, summary) {
  // Create version snapshot for audit trail
  await M.TimetableVersion.create({
    semesterTemplateId: template._id,
    snapshot: template.toObject(),
    publishedBy: req.user.name,
    publishedAt: new Date(),
    changeSummary: summary || 'Published from Development',
    label: `v${template.version}`
  });

  // Archive all other published templates for same class
  await M.SemesterTemplate.updateMany(
    { classId: template.classId, _id: { $ne: template._id }, status: 'published' },
    { $set: { status: 'archived' } }
  );

  // Update template status
  template.status = 'published';
  template.version += 1;
  template.publishedAt = new Date();
  template.publishedBy = req.user.name;

  // Also update the production SectionTimetable record
  const cls = await M.Class.findById(template.classId).lean();
  const slotsObj = {};
  (template.grid || []).forEach(slot => {
    const key = `${slot.day}_${slot.period}`;
    slotsObj[key] = slot;
  });
  await M.SectionTimetable.findOneAndUpdate(
    { classId: template.classId },
    {
      slots: slotsObj,
      updatedBy: req.user.name,
      ...(cls ? { className: cls.name, deptId: cls.deptId, deptName: cls.deptName } : {})
    },
    { upsert: true }
  );

  return template.save();
}


// ── Server-side conflict detection ──

async function detectConflicts(slots, classId, ignoreId) {
  const conflicts = [];
  if (!Array.isArray(slots) || slots.length === 0) return conflicts;

  // Cross-check within the submitted batch
  for (let i = 0; i < slots.length; i++) {
    const a = slots[i];
    for (let j = i + 1; j < slots.length; j++) {
      const b = slots[j];
      if (a.day !== b.day) continue;
      const aEnd = a.period + (a.span || 1) - 1;
      const bEnd = b.period + (b.span || 1) - 1;
      if (a.period <= bEnd && b.period <= aEnd) {
        if (a.teacher && a.teacher === b.teacher) {
          conflicts.push({ kind: 'faculty', message: `❌ Faculty double-booked: ${a.teacher} on ${a.day} period ${a.period}` });
        }
        if (a.room && a.room === b.room) {
          conflicts.push({ kind: 'room', message: `Room conflict: ${a.room} is double-booked on ${a.day} period ${a.period}` });
        }
      }
    }
  }

  // Cross-check against existing DB records (all classes — institution-wide)
  for (const slot of slots) {
    if (!slot.day || !slot.period) continue;
    const periodEnd = slot.period + (slot.span || 1) - 1;

    // Teacher conflict check across all classes
    if (slot.teacher) {
      const teacherConflict = await M.SemesterTemplate.findOne({
        _id: { $ne: ignoreId || null },
        status: { $in: ['draft', 'published'] },
        'grid.day': slot.day,
        'grid.teacher': slot.teacher,
        'grid.period': { $gte: slot.period, $lte: periodEnd }
      }).lean();
      if (teacherConflict) {
        conflicts.push({
          kind: 'faculty',
          message: `❌ Faculty double-booked: ${slot.teacher} is already assigned on ${slot.day} period ${slot.period} in another class`
        });
      }
    }

    // Room conflict check across all classes
    if (slot.room || slot.roomId) {
      const roomMatchConditions = [];
      if (slot.roomId) roomMatchConditions.push({ 'grid.roomId': slot.roomId });
      if (slot.room) roomMatchConditions.push({ 'grid.room': slot.room });

      const roomConflict = await M.SemesterTemplate.findOne({
        _id: { $ne: ignoreId || null },
        status: { $in: ['draft', 'published'] },
        'grid.day': slot.day,
        $or: roomMatchConditions,
        'grid.period': { $gte: slot.period, $lte: periodEnd }
      }).lean();
      if (roomConflict) {
        conflicts.push({
          kind: 'room',
          message: `Room conflict: ${slot.room || 'Room'} is already occupied on ${slot.day} period ${slot.period} in another class`
        });
      }

      // Room capacity vs. class enrollment check & room status check
      const roomDoc = await M.Room.findOne({
        $or: [
          ...(slot.roomId ? [{ _id: slot.roomId }] : []),
          ...(slot.room ? [{ hallNo: slot.room }, { name: slot.room }] : [])
        ]
      }).lean();

      if (roomDoc) {
        if (!slot.roomId) slot.roomId = roomDoc._id;

        if (['Maintenance', 'Inactive', 'Temporarily Unavailable'].includes(roomDoc.status)) {
          conflicts.push({
            kind: 'room_unavailable',
            message: `Room "${roomDoc.hallNo || slot.room}" is currently unavailable (${roomDoc.status})`
          });
        }

        if (classId) {
          const studentCount = await M.Student.countDocuments({ classId });
          if (roomDoc.capacity && studentCount > roomDoc.capacity) {
            conflicts.push({
              kind: 'capacity',
              message: `Capacity warning: Room "${roomDoc.hallNo || slot.room}" capacity (${roomDoc.capacity}) is less than enrolled class size (${studentCount} students)`
            });
          }
        }
      }
    }
  }

  return conflicts;
}


// ══════════════════════════════════════════════════════
//  PUBLIC SMART BOARD HARDWARE & KIOSK ENDPOINTS
// ══════════════════════════════════════════════════════

// POST /boards/auth/handshake — Public authentication handshake for Smart Board devices/kiosks
router.post('/boards/auth/handshake', async (req, res) => {
  try {
    const { deviceId, boardApiKey, clientInfo, telemetry } = req.body;
    if (!deviceId || !boardApiKey) {
      return res.status(400).json({ error: 'Device ID and Board API Key are required for handshake.' });
    }
    const cleanDeviceId = deviceId.trim().toUpperCase();
    const board = await M.SmartBoard.findOne({ deviceId: cleanDeviceId, boardApiKey: boardApiKey.trim() })
      .populate('buildingId')
      .populate('roomId');

    let ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
    if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
    if (typeof ip === 'string' && ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
    if (ip === '::1') ip = '127.0.0.1';
    const ipType = ip.includes(':') ? 'IPv6' : 'IPv4';

    if (!board) {
      try {
        await logAction(
          'SYSTEM', 'Smart Board Gateway', 'system',
          'Unauthorized Board Handshake',
          `Rejected handshake for device "${cleanDeviceId}" from IP ${ip}`,
          'security', 'warn', ip, 'HANDSHAKE',
          { deviceId: cleanDeviceId, ip }
        );
      } catch (e) { /* ignore */ }
      return res.status(401).json({ error: 'Invalid device credentials. Unauthorized board.' });
    }

    const now = new Date();
    const previousIp = board.currentIp;
    const ipChanged = previousIp && previousIp !== ip;

    board.connectionStatus = 'Connected';
    board.networkStatus = 'online';
    board.currentIp = ip;
    board.ipType = ipType;
    board.lastConnectedAt = now;
    board.lastSeenAt = now;
    board.lastHeartbeatAt = now;
    if (telemetry) board.telemetry = { ...board.telemetry, ...telemetry };

    if (ipChanged || !board.ipHistory.length) {
      board.ipHistory.unshift({
        ip,
        ipType,
        detectedAt: now,
        userAgent: req.headers['user-agent'] || 'EAMS-Board-Handshake'
      });
      if (board.ipHistory.length > 20) board.ipHistory = board.ipHistory.slice(0, 20);
    }

    await board.save();

    // Sign temporary Board Session Token
    const sessionToken = jwt.sign(
      {
        role: 'board',
        boardId: board._id,
        deviceId: board.deviceId,
        roomId: board.roomId?._id
      },
      cfg.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Resolve timetable context
    const context = await resolveRoomTimetableContext(board.roomId?._id);

    broadcastToMonitors('board:connected', {
      deviceId: board.deviceId,
      boardId: board._id,
      boardName: board.boardName,
      roomId: board.roomId?._id,
      ip,
      ipType,
      connectedAt: now.toISOString()
    });

    res.json({
      ok: true,
      token: sessionToken,
      board: {
        id: board._id,
        deviceId: board.deviceId,
        boardName: board.boardName,
        currentIp: ip,
        ipType,
        roomId: board.roomId?._id,
        roomHallNo: board.roomId?.hallNo,
        buildingName: board.buildingId?.name
      },
      context
    });
  } catch (err) {
    res.status(500).json({ error: 'Handshake failed: ' + err.message });
  }
});

// GET /boards/:id/context — Real-time room and timetable slot context
router.get('/boards/:id/context', async (req, res) => {
  try {
    let board = null;
    if (mongoose.isValidObjectId(req.params.id)) {
      board = await M.SmartBoard.findById(req.params.id);
    }
    if (!board) {
      board = await M.SmartBoard.findOne({ deviceId: req.params.id.toUpperCase() });
    }
    if (!board) return res.status(404).json({ error: 'Smart board not found' });
    if (!board.roomId) {
      return res.json({
        ok: true,
        context: {
          state: 'unassigned',
          room: null,
          message: 'Smart board is currently unassigned / standby.'
        }
      });
    }

    const context = await resolveRoomTimetableContext(board.roomId, req.query.time);
    res.json({ ok: true, context });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve board context: ' + err.message });
  }
});

// ══════════════════════════════════════════════════════
//  ALL ROUTES BELOW REQUIRE USER AUTHENTICATION
// ══════════════════════════════════════════════════════

router.use(authMiddleware);


// ── Master data endpoint (departments, classes, subjects, teachers, rooms) ──

router.get('/master-data', requireManager, async (req, res) => {
  try {
    const [departments, classes, subjects, teachers, rooms, studentCounts] = await Promise.all([
      M.Department.find().sort({ name: 1 }).lean(),
      M.Class.find().sort({ name: 1 }).lean(),
      M.Subject.find().sort({ name: 1 }).lean(),
      M.Teacher.find().select('-password').sort({ fullName: 1 }).lean(),
      M.Room.find({ status: { $ne: 'Inactive' } }).populate('buildingId').sort({ hallNo: 1, name: 1 }).lean(),
      M.Student.aggregate([
        { $match: { classId: { $ne: null } } },
        { $group: { _id: '$classId', count: { $sum: 1 } } }
      ])
    ]);
    const countMap = new Map(studentCounts.map(c => [String(c._id), c.count]));
    const classesWithCount = classes.map(c => ({
      ...c,
      studentCount: countMap.get(String(c._id)) || 0
    }));
    const enrichedRooms = rooms.map(r => ({
      ...r,
      name: r.hallNo ? (r.name && r.name !== r.hallNo ? `${r.hallNo} - ${r.name}` : r.hallNo) : r.name
    }));
    res.json({ departments, classes: classesWithCount, subjects, teachers, rooms: enrichedRooms });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load master data: ' + err.message });
  }
});


// ── Core timetable CRUD ──

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.teacherId) filter.teacherId = sanitizeToString(req.query.teacherId);
    else if (req.user.role === 'teacher' && !canManage(req)) filter.teacherId = req.user._id;
    res.json(await M.Timetable.find(filter).sort({ day: 1, start: 1 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireManager, async (req, res) => {
  try {
    const slot = await M.Timetable.create({
      ...req.body,
      teacherId: req.user._id,
      teacherName: req.user.name
    });
    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Timetable Slot Added',
      `${req.body.day} ${req.body.start} - ${req.body.subjectName || ''}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'entry-create', changes: { before: null, after: slot.toObject() } }
    );
    res.status(201).json(slot);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', requireManager, async (req, res) => {
  try {
    const before = await M.Timetable.findById(req.params.id).lean();
    const slot = await M.Timetable.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' });
    if (!slot) return res.status(404).json({ error: 'Timetable slot not found' });
    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Timetable Slot Updated',
      `${slot.day} ${slot.start}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'field-edit', changes: { before, after: slot.toObject() } }
    );
    res.json(slot);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', requireManager, async (req, res) => {
  try {
    const before = await M.Timetable.findById(req.params.id).lean();
    if (!before) return res.status(404).json({ error: 'Timetable slot not found' });
    await M.Timetable.findByIdAndDelete(req.params.id);
    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Timetable Slot Deleted',
      `${before.day} ${before.start} - ${before.subjectName || ''}`,
      'data', 'warn', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'entry-delete', changes: { before, after: null } }
    );
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Section timetable (production view) ──

router.get('/section/:classId', async (req, res) => {
  try {
    const classId = sanitizeToObjectId(req.params.classId);
    if (!classId) return res.status(400).json({ error: 'Invalid classId' });
    res.json(await M.SectionTimetable.findOne({ classId }).lean() || { slots: {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/section/:classId/slot', requireManager, async (req, res) => {
  try {
    const classId = sanitizeToObjectId(req.params.classId);
    if (!classId) return res.status(400).json({ error: 'Invalid classId' });
    const { slotKey, payload } = req.body;
    if (!slotKey) return res.status(400).json({ error: 'slotKey is required' });

    const cls = await M.Class.findById(classId).lean();
    const update = payload
      ? { $set: { [`slots.${slotKey}`]: payload }, updatedBy: req.user.name }
      : { $unset: { [`slots.${slotKey}`]: '' }, updatedBy: req.user.name };
    if (cls) update.$setOnInsert = { className: cls.name, deptId: cls.deptId, deptName: cls.deptName };

    const result = await M.SectionTimetable.findOneAndUpdate({ classId }, update, { upsert: true, returnDocument: 'after' });
    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Section Slot Updated', `${slotKey} for ${cls?.name || classId}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'field-edit' }
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/section/:classId', requireManager, async (req, res) => {
  try {
    const classId = sanitizeToObjectId(req.params.classId);
    if (!classId) return res.status(400).json({ error: 'Invalid classId' });
    if (!req.body || typeof req.body.slots !== 'object') {
      return res.status(400).json({ error: 'slots object is required' });
    }
    const cls = await M.Class.findById(classId).lean();
    const update = { slots: req.body.slots, updatedBy: req.user.name };
    if (cls) update.$setOnInsert = { className: cls.name, deptId: cls.deptId, deptName: cls.deptName };

    const result = await M.SectionTimetable.findOneAndUpdate({ classId }, update, { upsert: true, returnDocument: 'after' });
    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Section Timetable Updated', `Bulk update for ${cls?.name || classId}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'field-edit' }
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ── Conflict detection & auto-generation ──

router.post('/check-conflicts', requireManager, async (req, res) => {
  try {
    const { slots, ignoreId, classId } = req.body;
    const conflicts = await detectConflicts(slots || [], classId, ignoreId);
    res.json({ conflicts, valid: conflicts.length === 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/auto-gen', requireManager, async (req, res) => {
  try {
    const result = greedyGenerate(req.body);
    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Timetable Auto-Generated',
      `${result.grid.length} slots placed, ${result.conflicts.length} conflicts`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'action' }
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Timing sets ──

router.get('/timing-sets', async (req, res) => {
  try {
    if (!await M.TimingSet.countDocuments()) {
      await M.TimingSet.insertMany(TIMING_SEED);
    }
    res.json(await M.TimingSet.find().sort({ name: 1 }).lean());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ══════════════════════════════════════════════════════
//  CAMPUS FACILITIES: BUILDINGS (Phases 1B & 1D)
// ══════════════════════════════════════════════════════

// GET /buildings — List all buildings with aggregated room, lab, and board metrics
router.get('/buildings', async (req, res) => {
  try {
    const [buildings, roomStats, boardStats] = await Promise.all([
      M.Building.find().sort({ name: 1 }).lean(),
      M.Room.aggregate([
        {
          $group: {
            _id: '$buildingId',
            roomCount: { $sum: 1 },
            activeRoomCount: { $sum: { $cond: [{ $ne: ['$status', 'Inactive'] }, 1, 0] } },
            classRoomCount: { $sum: { $cond: [{ $or: [{ $eq: ['$category', 'Room'] }, { $and: [{ $ne: ['$category', 'Lab'] }, { $ne: ['$category', 'Hall'] }, { $ne: ['$type', 'Lab'] }, { $ne: ['$type', 'Seminar'] }] }] }, 1, 0] } },
            labCount: { $sum: { $cond: [{ $or: [{ $eq: ['$type', 'Lab'] }, { $eq: ['$category', 'Lab'] }] }, 1, 0] } },
            hallCount: { $sum: { $cond: [{ $or: [{ $eq: ['$type', 'Seminar'] }, { $eq: ['$category', 'Hall'] }] }, 1, 0] } },
            totalSeats: { $sum: '$capacity' }
          }
        }
      ]),
      M.SmartBoard.aggregate([
        {
          $group: {
            _id: '$buildingId',
            boardCount: { $sum: 1 },
            activeBoardCount: { $sum: { $cond: [{ $eq: ['$status', 'Active'] }, 1, 0] } }
          }
        }
      ])
    ]);

    const roomMap = new Map(roomStats.map(s => [String(s._id), s]));
    const boardMap = new Map(boardStats.map(b => [String(b._id), b]));

    const enriched = buildings.map(b => {
      const rs = roomMap.get(String(b._id)) || {};
      const bs = boardMap.get(String(b._id)) || {};
      return {
        ...b,
        roomCount: rs.roomCount || 0,
        activeRoomCount: rs.activeRoomCount || 0,
        classRoomCount: rs.classRoomCount || 0,
        labCount: rs.labCount || 0,
        hallCount: rs.hallCount || 0,
        totalSeats: rs.totalSeats || 0,
        boardCount: bs.boardCount || 0,
        activeBoardCount: bs.activeBoardCount || 0
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch buildings: ' + err.message });
  }
});

// GET /buildings/:id — Get single building with floor-wise rooms and boards
router.get('/buildings/:id', async (req, res) => {
  try {
    const building = await M.Building.findById(req.params.id).lean();
    if (!building) return res.status(404).json({ error: 'Building not found' });

    const [rooms, boards] = await Promise.all([
      M.Room.find({ buildingId: building._id }).sort({ floor: 1, hallNo: 1 }).lean(),
      M.SmartBoard.find({ buildingId: building._id }).lean()
    ]);

    const floorsGroup = {};
    for (let f = 0; f <= (building.floors || 1); f++) {
      floorsGroup[f] = [];
    }
    rooms.forEach(r => {
      const fl = r.floor !== undefined ? r.floor : 0;
      if (!floorsGroup[fl]) floorsGroup[fl] = [];
      floorsGroup[fl].push(r);
    });

    res.json({
      ok: true,
      data: {
        ...building,
        rooms,
        floorsGroup,
        boards,
        totalRooms: rooms.length,
        totalSeats: rooms.reduce((acc, r) => acc + (r.capacity || 0), 0)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch building details: ' + err.message });
  }
});

// POST /buildings — Create building with unique code validation and audit logging
router.post('/buildings', requireManager, async (req, res) => {
  try {
    const { name, subName, code, type, campus, floors, ip, status, latitude, longitude } = req.body;
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Building name is required (minimum 2 characters).' });
    }
    if (!code || code.trim().length < 2) {
      return res.status(400).json({ error: 'Building code is required (minimum 2 characters).' });
    }

    const cleanCode = code.trim().toUpperCase();
    const cleanCampus = campus?.trim() || 'Main Campus';

    const existing = await M.Building.findOne({
      code: cleanCode,
      campus: cleanCampus
    }).lean();
    if (existing) {
      return res.status(400).json({
        error: `Building code "${cleanCode}" already exists on campus "${cleanCampus}".`
      });
    }

    const validFloors = Math.max(1, Math.min(50, parseInt(floors, 10) || 1));
    const lat = latitude !== undefined && latitude !== '' ? Number(latitude) : undefined;
    const lng = longitude !== undefined && longitude !== '' ? Number(longitude) : undefined;

    if (lat !== undefined && (isNaN(lat) || lat < -90 || lat > 90)) {
      return res.status(400).json({ error: 'Latitude must be between -90 and 90 degrees.' });
    }
    if (lng !== undefined && (isNaN(lng) || lng < -180 || lng > 180)) {
      return res.status(400).json({ error: 'Longitude must be between -180 and 180 degrees.' });
    }

    const building = await M.Building.create({
      name: name.trim(),
      subName: subName?.trim() || '',
      code: cleanCode,
      type: type || 'Academic',
      campus: cleanCampus,
      floors: validFloors,
      ip: ip?.trim() || '',
      status: status || 'Active',
      latitude: lat,
      longitude: lng
    });

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Building Created', `${building.name} (${building.code})`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'building-create',
        entityId: building._id,
        entityType: 'Building',
        after: building.toObject()
      }
    );

    res.status(201).json({ ok: true, data: building, ...building.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /buildings/:id — Update building with before/after audit and code integrity check
router.put('/buildings/:id', requireManager, async (req, res) => {
  try {
    const building = await M.Building.findById(req.params.id);
    if (!building) return res.status(404).json({ error: 'Building not found' });

    const before = building.toObject();
    const { name, subName, code, type, campus, floors, ip, status, latitude, longitude } = req.body;

    if (name) building.name = name.trim();
    if (subName !== undefined) building.subName = subName.trim();
    if (ip !== undefined) building.ip = ip.trim();
    if (type) building.type = type;
    if (campus) building.campus = campus.trim();
    if (floors !== undefined) building.floors = Math.max(1, Math.min(50, parseInt(floors, 10) || 1));

    if (code) {
      const cleanCode = code.trim().toUpperCase();
      if (cleanCode !== building.code) {
        const existing = await M.Building.findOne({
          _id: { $ne: building._id },
          code: cleanCode,
          campus: building.campus
        }).lean();
        if (existing) {
          return res.status(400).json({
            error: `Building code "${cleanCode}" already exists on campus "${building.campus}".`
          });
        }
        building.code = cleanCode;
      }
    }

    if (status && status !== building.status) {
      if (status === 'Inactive') {
        const activeRoomsCount = await M.Room.countDocuments({
          buildingId: building._id,
          status: { $in: ['Available', 'Reserved'] }
        });
        if (activeRoomsCount > 0) {
          return res.status(400).json({
            error: `Cannot deactivate building: ${activeRoomsCount} room(s) are currently Active/Available. Deactivate or reassign rooms first.`,
            activeRoomsCount
          });
        }
      }
      building.status = status;
    }

    if (latitude !== undefined) {
      const lat = latitude === '' ? undefined : Number(latitude);
      if (lat !== undefined && (isNaN(lat) || lat < -90 || lat > 90)) {
        return res.status(400).json({ error: 'Latitude must be between -90 and 90 degrees.' });
      }
      building.latitude = lat;
    }
    if (longitude !== undefined) {
      const lng = longitude === '' ? undefined : Number(longitude);
      if (lng !== undefined && (isNaN(lng) || lng < -180 || lng > 180)) {
        return res.status(400).json({ error: 'Longitude must be between -180 and 180 degrees.' });
      }
      building.longitude = lng;
    }

    await building.save();

    // Propagate building name changes to rooms
    if (name && name.trim() !== before.name) {
      await M.Room.updateMany({ buildingId: building._id }, { $set: { buildingName: building.name } });
    }

    const after = building.toObject();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Building Updated', `${building.name} (${building.code})`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'building-update',
        entityId: building._id,
        entityType: 'Building',
        before,
        after
      }
    );

    res.json({ ok: true, data: building, ...building.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /buildings/:id/status — Quick toggle status
router.patch('/buildings/:id/status', requireManager, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Active', 'Inactive'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'Active' or 'Inactive'." });
    }

    const building = await M.Building.findById(req.params.id);
    if (!building) return res.status(404).json({ error: 'Building not found' });

    if (status === 'Inactive') {
      const activeRoomsCount = await M.Room.countDocuments({
        buildingId: building._id,
        status: { $in: ['Available', 'Reserved'] }
      });
      if (activeRoomsCount > 0) {
        return res.status(400).json({
          error: `Cannot deactivate building: ${activeRoomsCount} room(s) are active.`,
          activeRoomsCount
        });
      }
    }

    const oldStatus = building.status;
    building.status = status;
    await building.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      status === 'Inactive' ? 'Building Deactivated' : 'Building Activated',
      `${building.name} (${building.code})`,
      'data', status === 'Inactive' ? 'warn' : 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'building-status',
        entityId: building._id,
        entityType: 'Building',
        before: { status: oldStatus },
        after: { status }
      }
    );

    res.json({ ok: true, data: building, ...building.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /buildings/:id — Delete building with room check
router.delete('/buildings/:id', requireManager, async (req, res) => {
  try {
    const building = await M.Building.findById(req.params.id);
    if (!building) return res.status(404).json({ error: 'Building not found' });

    const roomCount = await M.Room.countDocuments({ buildingId: building._id });
    if (roomCount > 0) {
      return res.status(400).json({
        error: `Cannot delete building "${building.name}": it contains ${roomCount} linked room(s). Reassign or delete rooms first.`,
        affectedRooms: roomCount
      });
    }

    await M.Building.findByIdAndDelete(building._id);

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Building Deleted', `${building.name} (${building.code})`,
      'data', 'warn', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'building-delete',
        entityId: building._id,
        entityType: 'Building',
        before: building.toObject()
      }
    );

    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete building: ' + err.message });
  }
});


// ══════════════════════════════════════════════════════
//  CAMPUS FACILITIES: ROOMS & CAPACITY (Phases 1C & 1D)
// ══════════════════════════════════════════════════════

// Helper: Determine runtime occupied status from published semester templates
async function resolveOccupiedRooms() {
  try {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const now = new Date();
    const currentDay = dayNames[now.getDay()];

    const templates = await M.SemesterTemplate.find({
      status: 'published',
      'grid.day': currentDay
    }).lean();

    const occupiedRoomIds = new Set();
    const occupiedRoomNames = new Set();

    templates.forEach(t => {
      (t.grid || []).forEach(slot => {
        if (slot.day === currentDay) {
          if (slot.roomId) occupiedRoomIds.add(String(slot.roomId));
          if (slot.room) occupiedRoomNames.add(slot.room.toLowerCase().trim());
        }
      });
    });

    return { occupiedRoomIds, occupiedRoomNames };
  } catch (_) {
    return { occupiedRoomIds: new Set(), occupiedRoomNames: new Set() };
  }
}

// GET /rooms — List rooms with filters, populated building/dept, board info, and derived occupied status
router.get('/rooms', async (req, res) => {
  try {
    const filter = {};
    if (req.query.buildingId) filter.buildingId = sanitizeToObjectId(req.query.buildingId);
    if (req.query.category && req.query.category !== 'all') filter.category = sanitizeToString(req.query.category);
    if (req.query.type && req.query.type !== 'all') filter.type = sanitizeToString(req.query.type);
    if (req.query.floor !== undefined && req.query.floor !== '') filter.floor = parseInt(req.query.floor, 10);
    if (req.query.status && req.query.status !== 'all') filter.status = sanitizeToString(req.query.status);
    if (req.query.deptId) filter.deptId = sanitizeToObjectId(req.query.deptId);

    if (req.query.search) {
      const q = escapeRegex(sanitizeToString(req.query.search).trim());
      filter.$or = [
        { hallNo: { $regex: q, $options: 'i' } },
        { name: { $regex: q, $options: 'i' } },
        { buildingName: { $regex: q, $options: 'i' } },
        { deptName: { $regex: q, $options: 'i' } }
      ];
    }

    const [rooms, boards, { occupiedRoomIds, occupiedRoomNames }] = await Promise.all([
      M.Room.find(filter).populate('buildingId').populate('deptId').sort({ buildingName: 1, floor: 1, hallNo: 1 }).lean(),
      M.SmartBoard.find({ roomId: { $ne: null } }).lean(),
      resolveOccupiedRooms()
    ]);

    const boardMap = new Map();
    boards.forEach(b => {
      if (b.roomId) boardMap.set(String(b.roomId), b);
    });

    const enriched = rooms.map(r => {
      const assignedBoard = boardMap.get(String(r._id)) || null;
      const isOccupied = occupiedRoomIds.has(String(r._id)) ||
        (r.hallNo && occupiedRoomNames.has(r.hallNo.toLowerCase().trim())) ||
        (r.name && occupiedRoomNames.has(r.name.toLowerCase().trim()));

      const derivedStatus = (r.status === 'Available' && isOccupied) ? 'Occupied' : r.status;

      return {
        ...r,
        board: assignedBoard,
        derivedStatus
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rooms: ' + err.message });
  }
});

// GET /rooms/:id — Get single room with capacity history, status history, boards, and timetable slots
router.get('/rooms/:id', async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id)
      .populate('buildingId')
      .populate('deptId')
      .lean();
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const [boards, templates] = await Promise.all([
      M.SmartBoard.find({ roomId: room._id }).lean(),
      M.SemesterTemplate.find({
        status: 'published',
        $or: [
          { 'grid.roomId': room._id },
          { 'grid.room': room.hallNo },
          { 'grid.room': room.name }
        ]
      }).populate('classId', 'name deptName code').lean()
    ]);

    const timetableSlots = [];
    templates.forEach(tpl => {
      (tpl.grid || []).forEach(slot => {
        const matches = (slot.roomId && String(slot.roomId) === String(room._id)) ||
          (slot.room && (slot.room === room.hallNo || slot.room === room.name));
        if (matches) {
          timetableSlots.push({
            templateId: tpl._id,
            classId: tpl.classId?._id || tpl.classId,
            className: tpl.classId?.name || 'Class',
            day: slot.day,
            period: slot.period,
            subject: slot.subject,
            teacher: slot.teacher,
            isLab: slot.isLab
          });
        }
      });
    });

    res.json({
      ok: true,
      data: {
        ...room,
        assignedBoards: boards,
        timetableSlots
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch room details: ' + err.message });
  }
});

// POST /rooms — Create new classroom, special hall, or laboratory with telemetry
router.post('/rooms', requireManager, async (req, res) => {
  try {
    const {
      hallNo, name, category, type, capacity, buildingId, floor,
      status, deptId, ipAddress, wifiSpeed, mobileSpeed, incharge,
      workstationsCount, labStatus, latitude, longitude, locationAccuracy, geofenceRadius
    } = req.body;

    if (!hallNo || !hallNo.trim()) {
      return res.status(400).json({ error: 'Hall / Room Number is required.' });
    }
    const cap = parseInt(capacity, 10);
    if (isNaN(cap) || cap < 1 || cap > 2000) {
      return res.status(400).json({ error: 'Capacity must be a positive integer between 1 and 2000.' });
    }
    if (!buildingId) {
      return res.status(400).json({ error: 'Building selection is required.' });
    }

    const building = await M.Building.findById(buildingId);
    if (!building) {
      return res.status(400).json({ error: 'Selected building does not exist.' });
    }
    if (building.status === 'Inactive') {
      return res.status(400).json({ error: 'Cannot add room to an Inactive building.' });
    }

    const floorNum = parseInt(floor, 10) || 0;
    if (floorNum < 0 || floorNum > (building.floors || 1)) {
      return res.status(400).json({
        error: `Floor level (${floorNum}) cannot exceed building maximum floors (${building.floors}).`
      });
    }

    const cleanHall = hallNo.trim();
    const existing = await M.Room.findOne({
      buildingId: building._id,
      floor: floorNum,
      hallNo: { $regex: `^${escapeRegex(cleanHall)}$`, $options: 'i' }
    }).lean();
    if (existing) {
      return res.status(400).json({
        error: `Room "${cleanHall}" already exists on floor ${floorNum} of ${building.name}.`
      });
    }

    let deptName = '';
    if (deptId) {
      const dept = await M.Department.findById(deptId).lean();
      if (dept) deptName = dept.name;
    }

    const lat = latitude !== undefined && latitude !== '' ? Number(latitude) : undefined;
    const lng = longitude !== undefined && longitude !== '' ? Number(longitude) : undefined;
    if (lat !== undefined && (isNaN(lat) || lat < -90 || lat > 90)) {
      return res.status(400).json({ error: 'Latitude must be between -90 and 90 degrees.' });
    }
    if (lng !== undefined && (isNaN(lng) || lng < -180 || lng > 180)) {
      return res.status(400).json({ error: 'Longitude must be between -180 and 180 degrees.' });
    }

    const radius = Math.max(5, Math.min(1000, parseInt(geofenceRadius, 10) || 50));

    // Determine category if not explicitly passed
    let unitCat = category || 'Room';
    if (!category && type) {
      if (type === 'Lab') unitCat = 'Lab';
      else if (type === 'Seminar') unitCat = 'Hall';
    }

    const room = await M.Room.create({
      hallNo: cleanHall,
      name: name?.trim() || cleanHall,
      category: unitCat,
      type: type || (unitCat === 'Lab' ? 'Lab' : unitCat === 'Hall' ? 'Seminar' : 'Theory'),
      capacity: cap,
      buildingId: building._id,
      buildingName: building.name,
      floor: floorNum,
      status: status || 'Available',
      deptId: deptId || undefined,
      deptName,
      ipAddress: ipAddress?.trim() || '',
      wifiSpeed: wifiSpeed?.trim() || '150 Mbps',
      mobileSpeed: mobileSpeed?.trim() || '5G',
      incharge: {
        name: incharge?.name?.trim() || '',
        email: incharge?.email?.trim() || '',
        phone: incharge?.phone?.trim() || ''
      },
      workstationsCount: parseInt(workstationsCount, 10) || 0,
      labStatus: labStatus || 'Available',
      latitude: lat,
      longitude: lng,
      locationAccuracy: Number(locationAccuracy) || undefined,
      geofenceRadius: radius,
      capacityHistory: [{
        oldCapacity: cap,
        newCapacity: cap,
        changedBy: req.user.name,
        changedAt: new Date(),
        reason: 'Initial creation'
      }],
      statusHistory: [{
        oldStatus: status || 'Available',
        newStatus: status || 'Available',
        changedBy: req.user.name,
        changedAt: new Date(),
        reason: 'Initial creation',
        affectedSlots: 0
      }]
    });

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Room Created', `${room.hallNo} (${room.category}) - ${room.buildingName}`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'room-create',
        entityId: room._id,
        entityType: 'Room',
        after: room.toObject()
      }
    );

    res.status(201).json({ ok: true, data: room, ...room.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /rooms/:id — Update room, track capacity changes & location in audit
router.put('/rooms/:id', requireManager, async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const before = room.toObject();
    const {
      hallNo, name, category, type, capacity, buildingId, floor,
      status, deptId, ipAddress, wifiSpeed, mobileSpeed, incharge,
      workstationsCount, labStatus, latitude, longitude, locationAccuracy, geofenceRadius,
      capacityChangeReason
    } = req.body;

    if (category) room.category = category;
    if (ipAddress !== undefined) room.ipAddress = ipAddress.trim();
    if (wifiSpeed !== undefined) room.wifiSpeed = wifiSpeed.trim();
    if (mobileSpeed !== undefined) room.mobileSpeed = mobileSpeed.trim();
    if (workstationsCount !== undefined) room.workstationsCount = parseInt(workstationsCount, 10) || 0;
    if (labStatus !== undefined) room.labStatus = labStatus;
    if (incharge) {
      room.incharge = {
        name: incharge.name !== undefined ? incharge.name.trim() : (room.incharge?.name || ''),
        email: incharge.email !== undefined ? incharge.email.trim() : (room.incharge?.email || ''),
        phone: incharge.phone !== undefined ? incharge.phone.trim() : (room.incharge?.phone || '')
      };
    }

    if (buildingId && String(buildingId) !== String(room.buildingId)) {
      const b = await M.Building.findById(buildingId);
      if (!b) return res.status(400).json({ error: 'Selected building not found.' });
      room.buildingId = b._id;
      room.buildingName = b.name;
    }

    const currentBuilding = await M.Building.findById(room.buildingId).lean();
    const maxFloors = currentBuilding?.floors || 1;

    if (floor !== undefined) {
      const fl = parseInt(floor, 10);
      if (fl < 0 || fl > maxFloors) {
        return res.status(400).json({
          error: `Floor (${fl}) exceeds building maximum floors (${maxFloors}).`
        });
      }
      room.floor = fl;
    }

    if (hallNo) {
      const cleanHall = hallNo.trim();
      if (cleanHall !== room.hallNo || (floor !== undefined && floor !== before.floor)) {
        const existing = await M.Room.findOne({
          _id: { $ne: room._id },
          buildingId: room.buildingId,
          floor: room.floor,
          hallNo: { $regex: `^${escapeRegex(cleanHall)}$`, $options: 'i' }
        }).lean();
        if (existing) {
          return res.status(400).json({
            error: `Room "${cleanHall}" already exists on floor ${room.floor} in this building.`
          });
        }
        room.hallNo = cleanHall;
      }
    }

    if (name !== undefined) room.name = name.trim() || room.hallNo;
    if (type) room.type = type;

    // Capacity change tracking
    if (capacity !== undefined) {
      const newCap = parseInt(capacity, 10);
      if (isNaN(newCap) || newCap < 1 || newCap > 2000) {
        return res.status(400).json({ error: 'Capacity must be between 1 and 2000.' });
      }
      if (newCap !== room.capacity) {
        const capReason = capacityChangeReason || req.body.reason || 'Capacity revised';
        room.capacityHistory.push({
          oldCapacity: room.capacity,
          newCapacity: newCap,
          changedBy: req.user.name,
          changedAt: new Date(),
          reason: capReason
        });
        await logAction(
          req.user.trackId || req.user._id, req.user.name, req.user.role,
          'Room Capacity Changed', `${room.hallNo}: ${room.capacity} → ${newCap} seats`,
          'data', 'info', req.ip, req.user.sessionId,
          {
            module: 'facilities',
            subType: 'room-capacity',
            entityId: room._id,
            entityType: 'Room',
            before: { capacity: room.capacity },
            after: { capacity: newCap },
            reason: capReason
          }
        );
        room.capacity = newCap;
      }
    }

    if (deptId !== undefined) {
      if (deptId) {
        const dept = await M.Department.findById(deptId).lean();
        room.deptId = dept?._id || undefined;
        room.deptName = dept?.name || '';
      } else {
        room.deptId = undefined;
        room.deptName = '';
      }
    }

    // Geolocation updates
    let locationChanged = false;
    if (latitude !== undefined) {
      const lat = latitude === '' ? undefined : Number(latitude);
      if (lat !== undefined && (isNaN(lat) || lat < -90 || lat > 90)) {
        return res.status(400).json({ error: 'Latitude must be between -90 and 90 degrees.' });
      }
      if (room.latitude !== lat) locationChanged = true;
      room.latitude = lat;
    }
    if (longitude !== undefined) {
      const lng = longitude === '' ? undefined : Number(longitude);
      if (lng !== undefined && (isNaN(lng) || lng < -180 || lng > 180)) {
        return res.status(400).json({ error: 'Longitude must be between -180 and 180 degrees.' });
      }
      if (room.longitude !== lng) locationChanged = true;
      room.longitude = lng;
    }
    if (locationAccuracy !== undefined) {
      room.locationAccuracy = locationAccuracy === '' ? undefined : Number(locationAccuracy);
    }
    if (geofenceRadius !== undefined) {
      room.geofenceRadius = Math.max(5, Math.min(1000, parseInt(geofenceRadius, 10) || 50));
    }

    if (locationChanged) {
      await logAction(
        req.user.trackId || req.user._id, req.user.name, req.user.role,
        'Room Location Changed', `${room.hallNo} coordinates updated`,
        'data', 'info', req.ip, req.user.sessionId,
        {
          module: 'facilities',
          subType: 'room-location',
          entityId: room._id,
          entityType: 'Room',
          before: { latitude: before.latitude, longitude: before.longitude },
          after: { latitude: room.latitude, longitude: room.longitude }
        }
      );
    }

    await room.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Room Updated', `${room.hallNo} - ${room.buildingName}`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'room-update',
        entityId: room._id,
        entityType: 'Room',
        before,
        after: room.toObject()
      }
    );

    res.json({ ok: true, data: room, ...room.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /rooms/:id — Delete room if not used in published timetables
router.delete('/rooms/:id', requireManager, async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const publishedTemplates = await M.SemesterTemplate.find({
      status: 'published',
      $or: [
        { 'grid.roomId': room._id },
        { 'grid.room': room.hallNo },
        { 'grid.room': room.name }
      ]
    }).lean();

    if (publishedTemplates.length > 0) {
      return res.status(400).json({
        error: `Cannot delete room "${room.hallNo}": it is assigned in ${publishedTemplates.length} published timetable(s). Reassign timetable slots first.`,
        affectedTemplates: publishedTemplates.length
      });
    }

    // Unassign any boards assigned to this room
    await M.SmartBoard.updateMany(
      { roomId: room._id },
      {
        $set: { roomId: null, buildingId: null },
        $push: {
          assignmentHistory: {
            roomId: null,
            roomHallNo: 'Unassigned (Room Deleted)',
            assignedBy: req.user.name,
            assignedAt: new Date(),
            reason: `Room ${room.hallNo} was deleted`
          }
        }
      }
    );

    await M.Room.findByIdAndDelete(room._id);

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Room Deleted', `${room.hallNo} (${room.buildingName})`,
      'data', 'warn', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'room-delete',
        entityId: room._id,
        entityType: 'Room',
        before: room.toObject()
      }
    );

    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete room: ' + err.message });
  }
});

// POST /rooms/:id/bookings — Pre-book a hall with collision check & audit logging
router.post('/rooms/:id/bookings', requireManager, async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room / Hall not found' });

    const { title, organizer, date, startTime, endTime, notes } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Event title is required.' });
    }
    if (!date) {
      return res.status(400).json({ error: 'Reservation date is required.' });
    }
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'Start and End times are required.' });
    }
    if (startTime >= endTime) {
      return res.status(400).json({ error: 'End time must be later than start time.' });
    }

    const bookingDateStr = new Date(date).toISOString().split('T')[0];

    // Check for collisions with existing confirmed bookings on the same date
    const collision = (room.bookings || []).find(b => {
      if (b.status === 'Cancelled') return false;
      const bDateStr = new Date(b.date).toISOString().split('T')[0];
      if (bDateStr !== bookingDateStr) return false;
      return startTime < b.endTime && endTime > b.startTime;
    });

    if (collision) {
      return res.status(400).json({
        error: `Schedule collision: "${collision.title}" is already booked from ${collision.startTime} to ${collision.endTime} on this date.`
      });
    }

    const bookingId = 'BK-' + Date.now().toString(36).toUpperCase();
    const newBooking = {
      bookingId,
      title: title.trim(),
      organizer: organizer?.trim() || req.user.name,
      date: new Date(date),
      startTime,
      endTime,
      status: 'Confirmed',
      notes: notes?.trim() || '',
      bookedBy: req.user.name,
      bookedAt: new Date()
    };

    if (!room.bookings) room.bookings = [];
    room.bookings.push(newBooking);
    await room.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Hall Pre-Booked', `${room.hallNo} - "${newBooking.title}" on ${bookingDateStr} (${startTime}-${endTime})`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'hall-booking',
        entityId: room._id,
        entityType: 'Room',
        booking: newBooking
      }
    );

    res.status(201).json({ ok: true, data: newBooking });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /rooms/:id/bookings/:bookingId — Cancel hall booking with audit log
router.delete('/rooms/:id/bookings/:bookingId', requireManager, async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room / Hall not found' });

    const booking = (room.bookings || []).find(b => b.bookingId === req.params.bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    booking.status = 'Cancelled';
    await room.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Hall Booking Cancelled', `${room.hallNo} - "${booking.title}" (${booking.bookingId})`,
      'data', 'warn', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'hall-booking-cancel',
        entityId: room._id,
        entityType: 'Room',
        bookingId: req.params.bookingId
      }
    );

    res.json({ ok: true, cancelled: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /rooms/:id/capacity-history — Capacity revision timeline
router.get('/rooms/:id/capacity-history', async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id).select('hallNo name capacity capacityHistory').lean();
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const history = (room.capacityHistory || []).sort(
      (a, b) => new Date(b.changedAt) - new Date(a.changedAt)
    );

    res.json({ ok: true, data: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /rooms/:id/timetable-slots — All timetable slots assigned to room
router.get('/rooms/:id/timetable-slots', async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id).lean();
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const templates = await M.SemesterTemplate.find({
      status: 'published',
      $or: [
        { 'grid.roomId': room._id },
        { 'grid.room': room.hallNo },
        { 'grid.room': room.name }
      ]
    }).populate('classId', 'name deptName code').lean();

    const slots = [];
    templates.forEach(tpl => {
      (tpl.grid || []).forEach(slot => {
        const matches = (slot.roomId && String(slot.roomId) === String(room._id)) ||
          (slot.room && (slot.room === room.hallNo || slot.room === room.name));
        if (matches) {
          slots.push({
            templateId: tpl._id,
            classId: tpl.classId?._id || tpl.classId,
            className: tpl.classId?.name || 'Class',
            day: slot.day,
            period: slot.period,
            subject: slot.subject,
            teacher: slot.teacher,
            isLab: slot.isLab,
            span: slot.span || 1
          });
        }
      });
    });

    res.json({ ok: true, data: slots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ══════════════════════════════════════════════════════
//  CAMPUS FACILITIES: ROOM STATUS & MAINTENANCE (Phase 1E)
// ══════════════════════════════════════════════════════

// GET /rooms/:id/affected-slots — Preview slots affected by status change
router.get('/rooms/:id/affected-slots', async (req, res) => {
  try {
    const room = await M.Room.findById(req.params.id).lean();
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const templates = await M.SemesterTemplate.find({
      status: 'published',
      $or: [
        { 'grid.roomId': room._id },
        { 'grid.room': room.hallNo },
        { 'grid.room': room.name }
      ]
    }).populate('classId', 'name deptName code').lean();

    const affectedSlots = [];
    templates.forEach(tpl => {
      (tpl.grid || []).forEach(slot => {
        const matches = (slot.roomId && String(slot.roomId) === String(room._id)) ||
          (slot.room && (slot.room === room.hallNo || slot.room === room.name));
        if (matches) {
          affectedSlots.push({
            templateId: tpl._id,
            classId: tpl.classId?._id || tpl.classId,
            className: tpl.classId?.name || 'Class',
            day: slot.day,
            period: slot.period,
            subject: slot.subject,
            teacher: slot.teacher,
            isLab: slot.isLab,
            span: slot.span || 1
          });
        }
      });
    });

    res.json({ ok: true, count: affectedSlots.length, affectedSlots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /rooms/:id/status — Transition room status (e.g. Maintenance), record history & affected slots
router.patch('/rooms/:id/status', requireManager, async (req, res) => {
  try {
    const { status, reason, alternativeRoomId } = req.body;
    const allowed = ['Available', 'Reserved', 'Maintenance', 'Temporarily Unavailable', 'Inactive'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${allowed.join(', ')}` });
    }

    const room = await M.Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const oldStatus = room.status;
    if (oldStatus === status) {
      return res.json({ ok: true, room, message: 'Status is already ' + status });
    }

    // Identify affected timetable slots
    const templates = await M.SemesterTemplate.find({
      status: 'published',
      $or: [
        { 'grid.roomId': room._id },
        { 'grid.room': room.hallNo },
        { 'grid.room': room.name }
      ]
    }).populate('classId', 'name deptName code').lean();

    const affectedSlots = [];
    templates.forEach(tpl => {
      (tpl.grid || []).forEach(slot => {
        const matches = (slot.roomId && String(slot.roomId) === String(room._id)) ||
          (slot.room && (slot.room === room.hallNo || slot.room === room.name));
        if (matches) {
          affectedSlots.push({
            templateId: tpl._id,
            classId: tpl.classId?._id || tpl.classId,
            className: tpl.classId?.name || 'Class',
            day: slot.day,
            period: slot.period,
            subject: slot.subject,
            teacher: slot.teacher,
            isLab: slot.isLab
          });
        }
      });
    });

    // If alternative room specified, assign it via Override records
    let altRoom = null;
    if (alternativeRoomId) {
      altRoom = await M.Room.findById(alternativeRoomId);
      if (!altRoom) return res.status(400).json({ error: 'Alternative room not found' });
      if (altRoom.status !== 'Available') {
        return res.status(400).json({ error: `Alternative room is currently ${altRoom.status}` });
      }

      const today = new Date();
      for (const slot of affectedSlots) {
        await M.Override.create({
          date: today,
          classId: slot.classId,
          period: slot.period,
          type: 'room_change',
          originalSlot: { room: room.hallNo, roomId: room._id },
          newSlot: { room: altRoom.hallNo, roomId: altRoom._id },
          reason: reason || `Relocation due to ${room.hallNo} maintenance`,
          approvedBy: req.user.name
        });
      }
    }

    room.statusHistory.push({
      oldStatus,
      newStatus: status,
      changedBy: req.user.name,
      changedAt: new Date(),
      reason: reason || '',
      affectedSlots: affectedSlots.length
    });

    room.status = status;
    await room.save();

    let actionLabel = 'Room Status Changed';
    let severity = 'info';
    if (status === 'Maintenance') {
      actionLabel = 'Room Maintenance Started';
      severity = 'warn';
    } else if (oldStatus === 'Maintenance' && status === 'Available') {
      actionLabel = 'Room Maintenance Ended';
      severity = 'info';
    }

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      actionLabel, `${room.hallNo}: ${oldStatus} → ${status}`,
      'data', severity, req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'room-status',
        entityId: room._id,
        entityType: 'Room',
        before: { status: oldStatus },
        after: { status },
        reason: reason || '',
        affectedSlots: affectedSlots.length,
        alternativeRoom: altRoom ? altRoom.hallNo : null
      }
    );

    res.json({
      ok: true,
      room,
      affectedSlotsCount: affectedSlots.length,
      affectedSlots,
      alternativeRoom: altRoom ? { _id: altRoom._id, hallNo: altRoom.hallNo } : null
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /rooms/:id/alternative — Explicit alternative room assignment
router.post('/rooms/:id/alternative', requireManager, async (req, res) => {
  try {
    const { alternativeRoomId, reason, date } = req.body;
    if (!alternativeRoomId) {
      return res.status(400).json({ error: 'Alternative room ID is required.' });
    }

    const [room, altRoom] = await Promise.all([
      M.Room.findById(req.params.id),
      M.Room.findById(alternativeRoomId)
    ]);
    if (!room) return res.status(404).json({ error: 'Original room not found.' });
    if (!altRoom) return res.status(404).json({ error: 'Alternative room not found.' });

    if (String(room._id) === String(altRoom._id)) {
      return res.status(400).json({ error: 'Alternative room cannot be the same room.' });
    }
    if (altRoom.status !== 'Available') {
      return res.status(400).json({ error: `Alternative room is currently ${altRoom.status}.` });
    }

    const templates = await M.SemesterTemplate.find({
      status: 'published',
      $or: [
        { 'grid.roomId': room._id },
        { 'grid.room': room.hallNo },
        { 'grid.room': room.name }
      ]
    }).populate('classId', 'name deptName code').lean();

    const affectedSlots = [];
    templates.forEach(tpl => {
      (tpl.grid || []).forEach(slot => {
        const matches = (slot.roomId && String(slot.roomId) === String(room._id)) ||
          (slot.room && (slot.room === room.hallNo || slot.room === room.name));
        if (matches) {
          affectedSlots.push({
            templateId: tpl._id,
            classId: tpl.classId?._id || tpl.classId,
            period: slot.period,
            day: slot.day
          });
        }
      });
    });

    const targetDate = date ? new Date(date) : new Date();
    for (const slot of affectedSlots) {
      await M.Override.create({
        date: targetDate,
        classId: slot.classId,
        period: slot.period,
        type: 'room_change',
        originalSlot: { room: room.hallNo, roomId: room._id },
        newSlot: { room: altRoom.hallNo, roomId: altRoom._id },
        reason: reason || `Alternative room assigned for ${room.hallNo}`,
        approvedBy: req.user.name
      });
    }

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Room Alternative Assigned', `${room.hallNo} → ${altRoom.hallNo} (${affectedSlots.length} slots)`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'room-alternative',
        entityId: room._id,
        entityType: 'Room',
        before: { room: room.hallNo },
        after: { room: altRoom.hallNo },
        reason: reason || ''
      }
    );

    res.json({
      ok: true,
      message: `Assigned alternative room ${altRoom.hallNo} for ${affectedSlots.length} slot(s).`,
      count: affectedSlots.length,
      alternativeRoom: { _id: altRoom._id, hallNo: altRoom.hallNo, capacity: altRoom.capacity }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ══════════════════════════════════════════════════════
//  CAMPUS FACILITIES: SMART BOARD REGISTRY (Phase 1G)
// ══════════════════════════════════════════════════════

// GET /boards — List registered smart boards with building and room populate
router.get('/boards', async (req, res) => {
  try {
    const boards = await M.SmartBoard.find()
      .populate('buildingId')
      .populate({ path: 'roomId', populate: { path: 'buildingId' } })
      .sort({ boardName: 1 })
      .lean();
    res.json(boards);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch smart boards: ' + err.message });
  }
});

// GET /boards/:id — Single board with complete assignment history
router.get('/boards/:id', async (req, res) => {
  try {
    const board = await M.SmartBoard.findById(req.params.id)
      .populate('buildingId')
      .populate('roomId')
      .lean();
    if (!board) return res.status(404).json({ error: 'Smart board not found' });
    res.json({ ok: true, data: board });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch board details: ' + err.message });
  }
});

// POST /boards — Register a new smart board with room assignment
router.post('/boards', requireManager, async (req, res) => {
  try {
    const { boardName, deviceId, buildingId, roomId, status, firmwareVersion } = req.body;
    if (!boardName || boardName.trim().length < 2) {
      return res.status(400).json({ error: 'Board name is required (minimum 2 characters).' });
    }
    if (!deviceId || deviceId.trim().length < 3) {
      return res.status(400).json({ error: 'Device ID is required (minimum 3 characters).' });
    }

    const cleanDeviceId = deviceId.trim().toUpperCase();
    const existing = await M.SmartBoard.findOne({ deviceId: cleanDeviceId }).lean();
    if (existing) {
      return res.status(400).json({ error: `Device ID "${cleanDeviceId}" is already registered.` });
    }

    let resolvedBuildingId = buildingId || undefined;
    let roomHallNo = '';
    let targetRoom = null;

    if (roomId) {
      targetRoom = await M.Room.findById(roomId);
      if (!targetRoom) return res.status(400).json({ error: 'Assigned room not found.' });

      // Check if room already has an active board
      const activeInRoom = await M.SmartBoard.findOne({
        roomId: targetRoom._id,
        status: { $ne: 'Inactive' }
      }).lean();
      if (activeInRoom) {
        return res.status(400).json({
          error: `Room "${targetRoom.hallNo}" already has board "${activeInRoom.boardName}" assigned.`
        });
      }

      resolvedBuildingId = targetRoom.buildingId;
      roomHallNo = targetRoom.hallNo;
    }

    const assignmentHistory = [];
    if (targetRoom) {
      assignmentHistory.push({
        roomId: targetRoom._id,
        roomHallNo: targetRoom.hallNo,
        assignedBy: req.user.name,
        assignedAt: new Date(),
        reason: 'Initial registration'
      });
    }

    const generatedApiKey = generateBoardApiKey();
    const board = await M.SmartBoard.create({
      boardName: boardName.trim(),
      deviceId: cleanDeviceId,
      buildingId: resolvedBuildingId,
      roomId: targetRoom ? targetRoom._id : undefined,
      status: status || 'Active',
      firmwareVersion: firmwareVersion?.trim() || '',
      boardApiKey: generatedApiKey,
      connectionStatus: 'Disconnected',
      registeredAt: new Date(),
      registeredBy: req.user.name,
      assignmentHistory
    });

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Board Registered', `${board.boardName} (${board.deviceId})`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'board-create',
        entityId: board._id,
        entityType: 'SmartBoard',
        after: board.toObject()
      }
    );

    if (targetRoom) {
      await logAction(
        req.user.trackId || req.user._id, req.user.name, req.user.role,
        'Board Assigned to Room', `${board.boardName} → ${targetRoom.hallNo}`,
        'data', 'info', req.ip, req.user.sessionId,
        {
          module: 'facilities',
          subType: 'board-assign',
          entityId: board._id,
          entityType: 'SmartBoard',
          after: { roomId: targetRoom._id, roomHallNo: targetRoom.hallNo }
        }
      );
    }

    res.status(201).json({ ok: true, data: board, ...board.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /boards/:id/token/regenerate — Rotate device secret key (Admin only)
router.post('/boards/:id/token/regenerate', requireManager, async (req, res) => {
  try {
    const board = await M.SmartBoard.findById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Smart board not found' });
    const newKey = generateBoardApiKey();
    board.boardApiKey = newKey;
    await board.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Board API Key Rotated', `Regenerated authorization key for ${board.boardName} (${board.deviceId})`,
      'security', 'warn', req.ip, req.user.sessionId,
      { boardId: board._id, deviceId: board.deviceId }
    );

    res.json({ ok: true, boardApiKey: newKey });
  } catch (err) {
    res.status(500).json({ error: 'Failed to regenerate board key: ' + err.message });
  }
});

// GET /boards/:id/telemetry — Device network telemetry and IP history (Admin only)
router.get('/boards/:id/telemetry', requireManager, async (req, res) => {
  try {
    const board = await M.SmartBoard.findById(req.params.id).lean();
    if (!board) return res.status(404).json({ error: 'Smart board not found' });
    res.json({
      ok: true,
      deviceId: board.deviceId,
      boardName: board.boardName,
      connectionStatus: board.connectionStatus,
      currentIp: board.currentIp,
      ipType: board.ipType,
      networkStatus: board.networkStatus,
      lastConnectedAt: board.lastConnectedAt,
      lastSeenAt: board.lastSeenAt,
      lastHeartbeatAt: board.lastHeartbeatAt,
      ipHistory: board.ipHistory || [],
      telemetry: board.telemetry || {}
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch telemetry: ' + err.message });
  }
});

// POST /boards/:id/command — Remote control command dispatch (Admin only)
router.post('/boards/:id/command', requireManager, async (req, res) => {
  try {
    const board = await M.SmartBoard.findById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Smart board not found' });
    const { command, payload } = req.body;
    if (!command) return res.status(400).json({ error: 'Command is required' });

    const result = await sendCommandToBoard(board.deviceId, command, payload);
    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Remote Command Dispatched', `Command "${command}" to ${board.boardName} (${board.deviceId})`,
      'system', 'info', req.ip, req.user.sessionId,
      { boardId: board._id, deviceId: board.deviceId, command, result }
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to dispatch command: ' + err.message });
  }
});

// PUT /boards/:id — Update board details, reassign room with assignment history
router.put('/boards/:id', requireManager, async (req, res) => {
  try {
    const board = await M.SmartBoard.findById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Smart board not found' });

    const before = board.toObject();
    const { boardName, deviceId, buildingId, roomId, status, firmwareVersion, reason } = req.body;

    if (boardName) board.boardName = boardName.trim();
    if (status) board.status = status;
    if (firmwareVersion !== undefined) board.firmwareVersion = firmwareVersion.trim();

    if (deviceId) {
      const cleanDeviceId = deviceId.trim().toUpperCase();
      if (cleanDeviceId !== board.deviceId) {
        const existing = await M.SmartBoard.findOne({
          _id: { $ne: board._id },
          deviceId: cleanDeviceId
        }).lean();
        if (existing) {
          return res.status(400).json({ error: `Device ID "${cleanDeviceId}" is already registered.` });
        }
        board.deviceId = cleanDeviceId;
      }
    }

    // Room reassignment logic
    const oldRoomIdStr = board.roomId ? String(board.roomId) : '';
    const newRoomIdStr = roomId ? String(roomId) : '';

    if (oldRoomIdStr !== newRoomIdStr) {
      // Close previous active assignment
      if (board.assignmentHistory && board.assignmentHistory.length > 0) {
        const last = board.assignmentHistory[board.assignmentHistory.length - 1];
        if (last && !last.removedAt) {
          last.removedAt = new Date();
        }
      }

      if (newRoomIdStr) {
        const newRoom = await M.Room.findById(roomId);
        if (!newRoom) return res.status(400).json({ error: 'New assigned room not found.' });

        // Check if room already has active board
        const activeInRoom = await M.SmartBoard.findOne({
          _id: { $ne: board._id },
          roomId: newRoom._id,
          status: { $ne: 'Inactive' }
        }).lean();
        if (activeInRoom) {
          return res.status(400).json({
            error: `Room "${newRoom.hallNo}" already has board "${activeInRoom.boardName}" assigned.`
          });
        }

        board.roomId = newRoom._id;
        board.buildingId = newRoom.buildingId;
        board.assignmentHistory.push({
          roomId: newRoom._id,
          roomHallNo: newRoom.hallNo,
          assignedBy: req.user.name,
          assignedAt: new Date(),
          reason: reason || 'Reassigned'
        });

        await logAction(
          req.user.trackId || req.user._id, req.user.name, req.user.role,
          'Board Assigned to Room', `${board.boardName} → ${newRoom.hallNo}`,
          'data', 'info', req.ip, req.user.sessionId,
          {
            module: 'facilities',
            subType: 'board-assign',
            entityId: board._id,
            entityType: 'SmartBoard',
            before: { roomId: before.roomId },
            after: { roomId: newRoom._id, roomHallNo: newRoom.hallNo },
            reason: reason || ''
          }
        );
      } else {
        // Unassigning board from room
        board.roomId = undefined;
        if (buildingId) board.buildingId = buildingId;

        await logAction(
          req.user.trackId || req.user._id, req.user.name, req.user.role,
          'Board Unassigned', `${board.boardName} unassigned from room`,
          'data', 'warn', req.ip, req.user.sessionId,
          {
            module: 'facilities',
            subType: 'board-unassign',
            entityId: board._id,
            entityType: 'SmartBoard',
            before: { roomId: before.roomId },
            after: { roomId: null },
            reason: reason || ''
          }
        );
      }
    } else if (buildingId && !newRoomIdStr) {
      board.buildingId = buildingId;
    }

    await board.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Board Updated', `${board.boardName} (${board.deviceId})`,
      'data', 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'board-update',
        entityId: board._id,
        entityType: 'SmartBoard',
        before,
        after: board.toObject()
      }
    );

    res.json({ ok: true, data: board, ...board.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /boards/:id/status — Toggle board status
router.patch('/boards/:id/status', requireManager, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['Active', 'Inactive', 'Maintenance'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Allowed statuses: ${allowed.join(', ')}` });
    }

    const board = await M.SmartBoard.findById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Smart board not found' });

    const oldStatus = board.status;
    board.status = status;
    await board.save();

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Board Status Changed', `${board.boardName}: ${oldStatus} → ${status}`,
      'data', status === 'Maintenance' ? 'warn' : 'info', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'board-status',
        entityId: board._id,
        entityType: 'SmartBoard',
        before: { status: oldStatus },
        after: { status }
      }
    );

    res.json({ ok: true, data: board, ...board.toObject() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /boards/:id — Deregister smart board
router.delete('/boards/:id', requireManager, async (req, res) => {
  try {
    const board = await M.SmartBoard.findById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Smart board not found' });

    await M.SmartBoard.findByIdAndDelete(board._id);

    await logAction(
      req.user.trackId || req.user._id, req.user.name, req.user.role,
      'Board Deregistered', `${board.boardName} (${board.deviceId})`,
      'data', 'warn', req.ip, req.user.sessionId,
      {
        module: 'facilities',
        subType: 'board-delete',
        entityId: board._id,
        entityType: 'SmartBoard',
        before: board.toObject()
      }
    );

    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deregister board: ' + err.message });
  }
});


// ══════════════════════════════════════════════════════
//  CAMPUS FACILITIES: AUDIT LOG (Phase 1H & Tab 6)
// ══════════════════════════════════════════════════════

// GET /facility-logs — Query decrypted facility-specific audit events
router.get('/facility-logs', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const filter = { module: 'facilities' };

    if (req.query.entityType && req.query.entityType !== 'all') {
      filter['details.entityType'] = sanitizeToString(req.query.entityType);
    }
    if (req.query.severity && req.query.severity !== 'all') {
      filter.severity = sanitizeToString(req.query.severity);
    }
    if (req.query.subType && req.query.subType !== 'all') {
      filter.subType = sanitizeToString(req.query.subType);
    }
    if (req.query.before) {
      filter.createdAt = { $lt: new Date(req.query.before) };
    }

    const [logs, total] = await Promise.all([
      M.Log.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      M.Log.countDocuments({ module: 'facilities' })
    ]);

    // Decrypt encrypted payload to expose before/after diffs and reasons
    const enriched = logs.map(l => {
      let details = l.details || {};
      let changes = l.changes || null;

      if (l.encryptedPayload) {
        const payload = decryptLog(l.encryptedPayload);
        if (payload && typeof payload === 'object') {
          if (payload.details) details = payload.details;
          if (payload.changes) changes = payload.changes;
        }
      }

      return {
        _id: l._id,
        action: l.action,
        target: l.target,
        performedBy: l.performedBy,
        role: l.role,
        severity: l.severity,
        time: l.time || l.createdAt,
        createdAt: l.createdAt,
        entityType: details.entityType || l.targetType || 'Facility',
        entityId: details.entityId || null,
        subType: l.subType,
        before: details.before || (changes?.before) || null,
        after: details.after || (changes?.after) || null,
        reason: details.reason || '',
        affectedSlots: details.affectedSlots || 0,
        alternativeRoom: details.alternativeRoom || null
      };
    });

    res.json({ ok: true, data: enriched, total });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch facility audit logs: ' + err.message });
  }
});


// ── Layout presets ──

router.get('/layout-presets', async (req, res) => {
  try {
    res.json(await M.LayoutPreset.find().sort({ name: 1 }).lean());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/layout-presets', requireManager, async (req, res) => {
  try {
    res.status(201).json(await M.LayoutPreset.create(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/layout-presets/:id', requireManager, async (req, res) => {
  try {
    const preset = await M.LayoutPreset.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' });
    if (!preset) return res.status(404).json({ error: 'Preset not found' });
    res.json(preset);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/layout-presets/:id', requireManager, async (req, res) => {
  try {
    await M.LayoutPreset.findByIdAndDelete(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Semester templates (main draft / published document) ──

router.get('/semester-templates', async (req, res) => {
  try {
    const filter = {};
    if (req.query.classId) filter.classId = sanitizeToObjectId(req.query.classId);
    if (req.query.status) filter.status = sanitizeToString(req.query.status);
    res.json(await M.SemesterTemplate.find(filter).sort({ updatedAt: -1 }).lean());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/semester-templates', requireManager, async (req, res) => {
  try {
    const template = await M.SemesterTemplate.create({ ...req.body, status: 'draft' });
    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Semester Template Created', `Draft template for class ${req.body.classId}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'entry-create' }
    );
    res.status(201).json(template);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/semester-templates/:id', async (req, res) => {
  try {
    const doc = await M.SemesterTemplate.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Template not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/semester-templates/:id', requireManager, async (req, res) => {
  try {
    const current = await M.SemesterTemplate.findById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Template not found' });
    if (current.status === 'published') {
      return res.status(403).json({ error: 'Published templates are immutable; create a new draft first' });
    }
    const updated = await M.SemesterTemplate.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/semester-templates/:id/publish', requireManager, async (req, res) => {
  try {
    const template = await M.SemesterTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    // Server-side conflict detection before publish
    const conflicts = await detectConflicts(template.grid || [], template.classId, template._id);
    if (conflicts.length) {
      return res.status(409).json({
        error: `Cannot publish: ${conflicts.length} conflict(s) detected`,
        conflicts
      });
    }

    const published = await snapshotAndPublish(template, req, req.body.changeSummary);
    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Timetable Published',
      `Template v${published.version} published for class ${published.classId}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'action' }
    );
    res.json({ ok: true, data: published });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Week instances ──

router.post('/week-instances', requireManager, async (req, res) => {
  try {
    res.status(201).json(await M.WeekInstance.create(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ── Overrides (date-specific slot changes) ──

router.get('/overrides', async (req, res) => {
  try {
    const filter = {};
    if (req.query.classId) filter.classId = sanitizeToObjectId(req.query.classId);
    if (req.query.date) filter.date = req.query.date;
    res.json(await M.Override.find(filter).sort({ date: 1 }).lean());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/overrides', requireManager, async (req, res) => {
  try {
    const override = await M.Override.create(req.body);
    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Timetable Override Created',
      `${req.body.type} on ${req.body.date} period ${req.body.period}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'entry-create' }
    );
    res.status(201).json(override);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ── Version history ──

router.get('/versions/:semesterTemplateId', async (req, res) => {
  try {
    res.json(await M.TimetableVersion.find({
      semesterTemplateId: req.params.semesterTemplateId
    }).sort({ publishedAt: -1 }).lean());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/versions/:id/restore', requireManager, async (req, res) => {
  try {
    const v = await M.TimetableVersion.findById(req.params.id).lean();
    if (!v) return res.status(404).json({ error: 'Version not found' });
    const snapshot = {
      ...v.snapshot,
      _id: undefined,
      status: 'draft',
      version: (v.snapshot.version || 1) + 1,
      publishedAt: undefined
    };
    const restored = await M.SemesterTemplate.create(snapshot);
    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      'Timetable Version Restored',
      `Restored version ${v.label} as new draft`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'action' }
    );
    res.status(201).json({ restoredTo: 'Development', template: restored });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Substitution requests ──

router.get('/substitutions', async (req, res) => {
  try {
    res.json(await M.SubstitutionRequest.find().sort({ createdAt: -1 }).lean());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/substitutions', async (req, res) => {
  try {
    const sub = await M.SubstitutionRequest.create({
      ...req.body,
      teacherId: req.user._id,
      teacherName: req.user.name
    });
    res.status(201).json(sub);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/substitutions/:id/:decision', requireManager, async (req, res) => {
  try {
    if (!['approve', 'reject'].includes(req.params.decision)) {
      return res.status(400).json({ error: 'Invalid decision — must be approve or reject' });
    }
    const sub = await M.SubstitutionRequest.findByIdAndUpdate(
      req.params.id,
      {
        status: req.params.decision === 'approve' ? 'approved' : 'rejected',
        approvedBy: req.user.name
      },
      { returnDocument: 'after' }
    );
    if (!sub) return res.status(404).json({ error: 'Substitution request not found' });
    await logAction(
      req.user.trackId, req.user.name, req.user.role,
      `Substitution ${req.params.decision === 'approve' ? 'Approved' : 'Rejected'}`,
      `Request ${req.params.id} by ${sub.teacherName}`,
      'data', 'info', req.ip, req.user.sessionId,
      { module: 'timetable', subType: 'action' }
    );
    res.json(sub);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ── Exports ──

router.get('/exports/:type', requireManager, async (req, res) => {
  try {
    const { type } = req.params;
    const { classId } = req.query;
    let rows = [];

    if (type === 'workload') {
      const templates = await M.SemesterTemplate.find({ status: 'published' }).lean();
      const map = new Map();
      templates.forEach(t => {
        (t.grid || []).forEach(slot => {
          if (!slot.teacher) return;
          const current = map.get(slot.teacher) || { teacher: slot.teacher, theory: 0, lab: 0, total: 0 };
          const span = Number(slot.span || 1);
          if (slot.isLab) current.lab += span;
          else current.theory += span;
          current.total += span;
          map.set(slot.teacher, current);
        });
      });
      rows = Array.from(map.values());
    } else if (type === 'rooms') {
      const templates = await M.SemesterTemplate.find({ status: 'published' }).lean();
      const map = new Map();
      templates.forEach(t => {
        (t.grid || []).forEach(slot => {
          if (!slot.room) return;
          const current = map.get(slot.room) || { room: slot.room, count: 0, classes: new Set() };
          current.count += Number(slot.span || 1);
          if (t.classId) current.classes.add(String(t.classId));
          map.set(slot.room, current);
        });
      });
      rows = Array.from(map.values()).map(r => ({ ...r, classes: Array.from(r.classes) }));
    } else {
      const query = { status: 'published' };
      if (classId) query.classId = classId;
      const templates = await M.SemesterTemplate.find(query).populate('classId').lean();
      templates.forEach(t => {
        (t.grid || []).forEach(slot => {
          rows.push({
            class: t.classId?.name || 'Class',
            day: slot.day,
            period: slot.period,
            span: slot.span || 1,
            subject: slot.subject,
            teacher: slot.teacher,
            room: slot.room,
            isLab: slot.isLab || false,
            combinedWith: slot.combinedWith || []
          });
        });
      });
    }

    res.json({
      ok: true,
      data: {
        type,
        generatedAt: new Date().toISOString(),
        count: rows.length,
        rows
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
