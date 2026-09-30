/**
 * EAMS Smart Board WebSocket & Infrastructure Service (Plan 2: Board Integration)
 * - Mounts /ws/board for classroom Smart Board kiosks & ESP32 devices
 * - Mounts /ws/monitor for admin real-time monitoring dashboard
 * - Manages cryptographic board auth, auto-IP detection, heartbeats, & telemetry
 * - Resolves live timetable context (period, class, subject, teacher, overrides)
 * - Dispatches remote commands (reload, identify, resync, ping)
 */

const { WebSocketServer, WebSocket } = require('ws');
const url = require('url');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cfg = require('../config');
const M = require('../models');
const { logAction } = require('../utils/logAction');

// Active socket collections
const activeBoardSockets = new Map(); // deviceId -> { ws, boardId, deviceId, roomId, ip, connectedAt, lastHeartbeat, telemetry }
const activeMonitors = new Set();      // Set<WebSocket>

let wssBoard = null;
let wssMonitor = null;
let staleSweeperInterval = null;

// Standard Bell Timings (fallback if TimingSet not configured)
const DEFAULT_BELL_PERIODS = [
  { periodNumber: 1, start: '08:30', end: '09:15', label: 'Period 1', isBreak: false },
  { periodNumber: 2, start: '09:15', end: '10:00', label: 'Period 2', isBreak: false },
  { periodNumber: 0, start: '10:00', end: '10:15', label: 'Morning Break', isBreak: true, breakType: 'Interval' },
  { periodNumber: 3, start: '10:15', end: '11:00', label: 'Period 3', isBreak: false },
  { periodNumber: 4, start: '11:00', end: '11:45', label: 'Period 4', isBreak: false },
  { periodNumber: 5, start: '11:45', end: '12:30', label: 'Period 5', isBreak: false },
  { periodNumber: 6, start: '12:30', end: '13:15', label: 'Period 6', isBreak: false },
  { periodNumber: 0, start: '13:15', end: '14:00', label: 'Lunch Break', isBreak: true, breakType: 'Lunch' },
  { periodNumber: 7, start: '14:00', end: '14:45', label: 'Period 7', isBreak: false },
  { periodNumber: 8, start: '14:45', end: '15:30', label: 'Period 8', isBreak: false },
  { periodNumber: 0, start: '15:30', end: '15:45', label: 'Tea Break', isBreak: true, breakType: 'Tea' },
  { periodNumber: 9, start: '15:45', end: '16:30', label: 'Period 9', isBreak: false }
];

/**
 * Clean & normalize IP address from HTTP request / WebSocket
 */
function cleanIp(req) {
  let ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
  if (typeof ip === 'string' && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  if (typeof ip === 'string' && ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

function detectIpType(ip) {
  if (!ip) return 'IPv4';
  return ip.includes(':') ? 'IPv6' : 'IPv4';
}

/**
 * Format 24-hour time to 12-hour AM/PM string
 */
function to12h(timeStr) {
  if (!timeStr) return '';
  const parts = String(timeStr).split(':');
  let h = parseInt(parts[0], 10);
  if (isNaN(h)) return timeStr;
  const m = (parts[1] || '00').slice(0, 2);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

/**
 * Broadcast event to all active admin monitoring sockets
 */
function broadcastToMonitors(event, payload) {
  if (!activeMonitors.size) return;
  const msg = JSON.stringify({
    event,
    type: event,
    ...payload,
    data: payload,
    timestamp: new Date().toISOString()
  });
  for (const client of activeMonitors) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(msg); } catch (e) { /* ignore */ }
    }
  }
}

/**
 * Generate a cryptographically secure high-entropy API key for a board
 */
function generateBoardApiKey() {
  return 'sbk_' + crypto.randomBytes(24).toString('hex');
}

/**
 * Resolve active timetable slot, room metadata, and bell status for a room
 */
async function resolveRoomTimetableContext(roomId, customTime = null) {
  if (!roomId) return null;
  const room = await M.Room.findById(roomId).populate('buildingId').lean();
  if (!room) return null;

  const now = customTime ? new Date(customTime) : new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayDay = dayNames[now.getDay()];

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const currentTime24 = `${hours}:${minutes}`;

  // Get Bell Timings
  let timingPeriods = DEFAULT_BELL_PERIODS;
  try {
    const timingSet = await M.TimingSet.findOne({ isDefault: true }).lean();
    if (timingSet && Array.isArray(timingSet.periods) && timingSet.periods.length) {
      timingPeriods = timingSet.periods;
    }
  } catch (err) {
    // fallback
  }

  // Determine current period slot
  let currentPeriod = null;
  let nextPeriod = null;
  let scheduleStatus = 'free'; // 'in_class' | 'break' | 'free' | 'pre_class' | 'day_ended'

  const firstSlot = timingPeriods.find(p => !p.isBreak && p.start);
  const lastSlot = [...timingPeriods].reverse().find(p => !p.isBreak && p.end);

  if (firstSlot && currentTime24 < firstSlot.start) {
    scheduleStatus = 'pre_class';
    nextPeriod = firstSlot;
  } else if (lastSlot && currentTime24 > lastSlot.end) {
    scheduleStatus = 'day_ended';
  } else {
    for (let i = 0; i < timingPeriods.length; i++) {
      const p = timingPeriods[i];
      if (currentTime24 >= p.start && currentTime24 <= p.end) {
        currentPeriod = p;
        if (p.isBreak) {
          scheduleStatus = 'break';
        } else {
          scheduleStatus = 'in_class';
        }
        // Find next non-break period
        for (let j = i + 1; j < timingPeriods.length; j++) {
          if (!timingPeriods[j].isBreak) {
            nextPeriod = timingPeriods[j];
            break;
          }
        }
        break;
      }
    }
  }

  // Resolve scheduled slot in published timetable
  let currentSlot = null;
  let nextSlot = null;

  if (currentPeriod && !currentPeriod.isBreak) {
    const periodNum = currentPeriod.periodNumber || currentPeriod.number;
    try {
      const template = await M.SemesterTemplate.findOne({
        status: 'published',
        'grid.day': todayDay,
        'grid.period': periodNum,
        $or: [
          { 'grid.roomId': room._id },
          { 'grid.room': room.hallNo }
        ]
      }).populate('classId').lean();

      if (template) {
        const slot = template.grid.find(g =>
          g.day === todayDay &&
          g.period === periodNum &&
          (String(g.roomId) === String(room._id) || g.room === room.hallNo)
        );

        if (slot) {
          currentSlot = {
            period: periodNum,
            time12: `${to12h(currentPeriod.start)} – ${to12h(currentPeriod.end)}`,
            subject: slot.subject,
            teacher: slot.teacher,
            section: slot.section || (template.classId?.name) || '',
            type: slot.type || 'Theory',
            isSubstitute: false,
            originalTeacher: null
          };

          // Check for active override (substitute, cancellation)
          const startOfDay = new Date(now);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(now);
          endOfDay.setHours(23, 59, 59, 999);

          const override = await M.Override.findOne({
            date: { $gte: startOfDay, $lte: endOfDay },
            period: periodNum,
            $or: [
              { 'newSlot.roomId': room._id },
              { 'originalSlot.roomId': room._id },
              { 'newSlot.room': room.hallNo },
              { 'originalSlot.room': room.hallNo }
            ]
          }).lean();

          if (override) {
            if (override.type === 'cancelled') {
              currentSlot = null;
              scheduleStatus = 'free';
            } else if (override.type === 'substitute' && override.newSlot) {
              currentSlot.isSubstitute = true;
              currentSlot.originalTeacher = currentSlot.teacher;
              currentSlot.teacher = override.newSlot.teacher || override.newSlot.substituteTeacher || currentSlot.teacher;
            }
          }
        }
      }
    } catch (err) {
      console.error('Error resolving active timetable slot:', err);
    }
  }

  // Resolve next slot
  if (nextPeriod) {
    const nextPeriodNum = nextPeriod.periodNumber || nextPeriod.number;
    try {
      const nextTemplate = await M.SemesterTemplate.findOne({
        status: 'published',
        'grid.day': todayDay,
        'grid.period': nextPeriodNum,
        $or: [
          { 'grid.roomId': room._id },
          { 'grid.room': room.hallNo }
        ]
      }).populate('classId').lean();

      if (nextTemplate) {
        const slot = nextTemplate.grid.find(g =>
          g.day === todayDay &&
          g.period === nextPeriodNum &&
          (String(g.roomId) === String(room._id) || g.room === room.hallNo)
        );
        if (slot) {
          nextSlot = {
            period: nextPeriodNum,
            time12: `${to12h(nextPeriod.start)} – ${to12h(nextPeriod.end)}`,
            subject: slot.subject,
            teacher: slot.teacher,
            section: slot.section || (nextTemplate.classId?.name) || '',
            type: slot.type || 'Theory'
          };
        }
      }
    } catch (err) {
      // ignore
    }
  }

  return {
    room: {
      id: room._id,
      hallNo: room.hallNo,
      name: room.name,
      type: room.type,
      capacity: room.capacity,
      floor: room.floor,
      buildingName: room.buildingName || room.buildingId?.name || '',
      buildingCode: room.buildingId?.code || '',
      campus: room.buildingId?.campus || 'Main',
      coordinates: {
        latitude: room.latitude,
        longitude: room.longitude,
        geofenceRadius: room.geofenceRadius || 50
      }
    },
    today: todayDay,
    currentTime: currentTime24,
    currentTime12: to12h(currentTime24),
    scheduleStatus: currentSlot ? 'in_class' : scheduleStatus,
    currentPeriod: currentPeriod ? {
      periodNumber: currentPeriod.periodNumber || currentPeriod.number,
      label: currentPeriod.label,
      start: currentPeriod.start,
      end: currentPeriod.end,
      time12: `${to12h(currentPeriod.start)} – ${to12h(currentPeriod.end)}`,
      isBreak: currentPeriod.isBreak || false
    } : null,
    currentSlot,
    nextSlot,
    resolvedAt: now.toISOString()
  };
}

/**
 * Handle incoming connection from a Smart Board kiosk / device
 */
async function handleBoardConnection(ws, req) {
  const parsedUrl = url.parse(req.url, true);
  const query = parsedUrl.query || {};
  const ip = cleanIp(req);
  const ipType = detectIpType(ip);
  const userAgent = req.headers['user-agent'] || 'EAMS-SmartBoard-Client';

  let authenticatedBoard = null;
  let deviceId = query.device || query.deviceId || '';
  const token = query.token || '';
  const apiKey = query.apiKey || query.key || '';

  // 1. Try JWT verification if token provided
  if (token) {
    try {
      const decoded = jwt.verify(token, cfg.JWT_SECRET);
      if (decoded && decoded.deviceId) {
        deviceId = decoded.deviceId;
      }
    } catch (err) {
      // token expired or invalid
    }
  }

  // 2. Lookup board in DB by deviceId or apiKey
  if (deviceId) {
    authenticatedBoard = await M.SmartBoard.findOne({ deviceId });
  } else if (apiKey) {
    authenticatedBoard = await M.SmartBoard.findOne({ boardApiKey: apiKey });
  }

  // 3. Security Guard: Reject unregistered or unauthorized boards
  if (!authenticatedBoard) {
    ws.send(JSON.stringify({
      type: 'error',
      code: 'UNAUTHORIZED_DEVICE',
      message: 'Unregistered or unauthorized smart board device identity.'
    }));
    try {
      await logAction(
        'SYSTEM', 'Smart Board Gateway', 'system',
        'Unauthorized Board Connection Attempt',
        `Rejected connection from IP ${ip} (Device ID: "${deviceId || 'unknown'}")`,
        'security', 'warn', ip, 'WS_BOARD',
        { deviceId, ip, userAgent }
      );
    } catch (e) { /* ignore */ }
    ws.close(4001, 'Unauthorized device');
    return;
  }

  deviceId = authenticatedBoard.deviceId;

  // Check if board already has an active socket; disconnect previous if replacing
  if (activeBoardSockets.has(deviceId)) {
    const existing = activeBoardSockets.get(deviceId);
    try {
      existing.ws.close(4000, 'Replaced by new connection session');
    } catch (e) { /* ignore */ }
  }

  // Update Board IP metadata & connection status
  const now = new Date();
  const previousIp = authenticatedBoard.currentIp;
  const ipChanged = previousIp && previousIp !== ip;

  authenticatedBoard.connectionStatus = 'Connected';
  authenticatedBoard.networkStatus = 'online';
  authenticatedBoard.currentIp = ip;
  authenticatedBoard.ipType = ipType;
  authenticatedBoard.lastConnectedAt = now;
  authenticatedBoard.lastSeenAt = now;
  authenticatedBoard.lastHeartbeatAt = now;

  if (ipChanged || !authenticatedBoard.ipHistory.length) {
    authenticatedBoard.ipHistory.unshift({
      ip,
      ipType,
      detectedAt: now,
      userAgent
    });
    // Keep max 20 historical IP entries
    if (authenticatedBoard.ipHistory.length > 20) {
      authenticatedBoard.ipHistory = authenticatedBoard.ipHistory.slice(0, 20);
    }
  }

  await authenticatedBoard.save();

  // Audit Connection
  try {
    await logAction(
      'SYSTEM', 'Smart Board Gateway', 'system',
      'Smart Board Connected',
      `Board "${authenticatedBoard.boardName}" (${deviceId}) connected from IP ${ip}${ipChanged ? ` (IP changed from ${previousIp})` : ''}`,
      'system', 'info', ip, 'WS_BOARD',
      { deviceId, ip, boardName: authenticatedBoard.boardName, roomId: authenticatedBoard.roomId }
    );
  } catch (e) { /* ignore */ }

  // Store in active connections
  const sessionEntry = {
    ws,
    boardId: authenticatedBoard._id,
    deviceId,
    boardName: authenticatedBoard.boardName,
    roomId: authenticatedBoard.roomId,
    ip,
    ipType,
    userAgent,
    connectedAt: now,
    lastHeartbeat: Date.now(),
    telemetry: authenticatedBoard.telemetry || {}
  };
  activeBoardSockets.set(deviceId, sessionEntry);

  // Notify Admin Monitors
  broadcastToMonitors('board:connected', {
    deviceId,
    boardId: authenticatedBoard._id,
    boardName: authenticatedBoard.boardName,
    roomId: authenticatedBoard.roomId,
    ip,
    ipType,
    connectedAt: now.toISOString()
  });

  // Resolve initial Timetable Context
  const context = await resolveRoomTimetableContext(authenticatedBoard.roomId);

  // Send init acknowledgment to board
  ws.send(JSON.stringify({
    type: 'init_ack',
    deviceId,
    boardName: authenticatedBoard.boardName,
    status: 'Connected',
    ip,
    ipType,
    serverTime: now.toISOString(),
    context
  }));

  // Handle incoming messages from Board
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      sessionEntry.lastHeartbeat = Date.now();

      if (msg.type === 'heartbeat') {
        const tel = msg.telemetry || {};
        sessionEntry.telemetry = { ...sessionEntry.telemetry, ...tel };

        // Respond with heartbeat ACK
        ws.send(JSON.stringify({
          type: 'heartbeat_ack',
          timestamp: Date.now(),
          ping: msg.ping || null
        }));

        // Throttled update to database (every 60s)
        if (Date.now() - (sessionEntry._lastDbSync || 0) > 60000) {
          sessionEntry._lastDbSync = Date.now();
          M.SmartBoard.updateOne(
            { deviceId },
            { $set: { lastSeenAt: new Date(), lastHeartbeatAt: new Date(), telemetry: sessionEntry.telemetry } }
          ).exec().catch(() => {});
        }

        // Broadcast telemetry to admin monitor
        broadcastToMonitors('board:heartbeat', {
          deviceId,
          lastSeenAt: new Date().toISOString(),
          telemetry: sessionEntry.telemetry
        });
      }

      if (msg.type === 'request_context') {
        const freshContext = await resolveRoomTimetableContext(authenticatedBoard.roomId);
        ws.send(JSON.stringify({
          type: 'context_update',
          context: freshContext
        }));
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', clientTime: msg.time, serverTime: Date.now() }));
      }
    } catch (err) {
      console.error('Error parsing board WS message:', err);
    }
  });

  // Handle Socket Closure
  ws.on('close', async (code, reason) => {
    activeBoardSockets.delete(deviceId);
    const closeTime = new Date();

    try {
      await M.SmartBoard.updateOne(
        { deviceId },
        { $set: { connectionStatus: 'Disconnected', networkStatus: 'offline', lastSeenAt: closeTime } }
      );
      await logAction(
        'SYSTEM', 'Smart Board Gateway', 'system',
        'Smart Board Disconnected',
        `Board "${authenticatedBoard.boardName}" (${deviceId}) disconnected (Code: ${code}, Reason: ${reason || 'Normal'})`,
        'system', 'info', ip, 'WS_BOARD',
        { deviceId, code, reason: reason ? reason.toString() : '' }
      );
    } catch (e) { /* ignore */ }

    broadcastToMonitors('board:disconnected', {
      deviceId,
      disconnectedAt: closeTime.toISOString(),
      code,
      reason: reason ? reason.toString() : ''
    });
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error on board ${deviceId}:`, err.message);
  });
}

/**
 * Handle incoming connection from an Admin Monitor dashboard
 */
function handleMonitorConnection(ws, req) {
  const ip = cleanIp(req);
  activeMonitors.add(ws);

  // Send current active board states
  const liveBoards = [];
  activeBoardSockets.forEach((entry, dId) => {
    liveBoards.push({
      deviceId: dId,
      boardId: entry.boardId,
      boardName: entry.boardName,
      roomId: entry.roomId,
      ip: entry.ip,
      ipType: entry.ipType,
      connectedAt: entry.connectedAt,
      lastHeartbeat: new Date(entry.lastHeartbeat).toISOString(),
      telemetry: entry.telemetry
    });
  });

  ws.send(JSON.stringify({
    event: 'monitor:init',
    liveBoards,
    activeCount: liveBoards.length,
    timestamp: new Date().toISOString()
  }));

  ws.on('close', () => {
    activeMonitors.delete(ws);
  });

  ws.on('error', () => {
    activeMonitors.delete(ws);
  });
}

/**
 * Sweeper running every 10 seconds to detect stale board sockets
 */
function startStaleSweeper() {
  if (staleSweeperInterval) clearInterval(staleSweeperInterval);
  staleSweeperInterval = setInterval(async () => {
    const now = Date.now();
    const timeoutMs = 45000; // 45s without heartbeat = disconnected

    for (const [deviceId, session] of activeBoardSockets.entries()) {
      if (now - session.lastHeartbeat > timeoutMs) {
        console.log(`Smart board ${deviceId} heartbeat timed out (>45s). Marking Disconnected.`);
        try {
          session.ws.close(4008, 'Heartbeat timeout');
        } catch (e) { /* ignore */ }
        activeBoardSockets.delete(deviceId);

        try {
          await M.SmartBoard.updateOne(
            { deviceId },
            { $set: { connectionStatus: 'Disconnected', networkStatus: 'offline', lastSeenAt: new Date() } }
          );
        } catch (e) { /* ignore */ }

        broadcastToMonitors('board:disconnected', {
          deviceId,
          disconnectedAt: new Date().toISOString(),
          reason: 'Heartbeat timeout'
        });
      }
    }
  }, 10000);
}

/**
 * Dispatch remote command to a connected board
 */
async function sendCommandToBoard(deviceId, command, payload = {}) {
  const session = activeBoardSockets.get(deviceId);
  if (!session || session.ws.readyState !== WebSocket.OPEN) {
    return { success: false, reason: 'Board is currently offline or unreachable.' };
  }

  const message = JSON.stringify({
    type: 'command',
    command, // 'reload' | 'identify' | 'resync' | 'ping'
    payload,
    dispatchedAt: new Date().toISOString()
  });

  session.ws.send(message);

  // Broadcast command event to monitoring channel
  broadcastToMonitors('board:command_dispatched', {
    deviceId,
    command,
    dispatchedAt: new Date().toISOString()
  });

  return { success: true, command, deviceId };
}

/**
 * Public function to push refreshed timetable context to a specific board or all boards in a room
 */
async function pushContextToRoomBoards(roomId) {
  if (!roomId) return;
  const context = await resolveRoomTimetableContext(roomId);
  for (const [deviceId, session] of activeBoardSockets.entries()) {
    if (String(session.roomId) === String(roomId) && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'context_update',
        context
      }));
    }
  }
}

/**
 * Initialize WebSocket service attaching to Node HTTP Server
 */
function initBoardSocket(httpServer) {
  wssBoard = new WebSocketServer({ noServer: true });
  wssMonitor = new WebSocketServer({ noServer: true });

  // Route incoming HTTP Upgrade requests based on URL pathname
  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = url.parse(req.url).pathname;

    if (pathname === '/ws/board') {
      wssBoard.handleUpgrade(req, socket, head, (ws) => {
        wssBoard.emit('connection', ws, req);
      });
    } else if (pathname === '/ws/monitor') {
      wssMonitor.handleUpgrade(req, socket, head, (ws) => {
        wssMonitor.emit('connection', ws, req);
      });
    }
  });

  wssBoard.on('connection', (ws, req) => handleBoardConnection(ws, req));
  wssMonitor.on('connection', (ws, req) => handleMonitorConnection(ws, req));

  startStaleSweeper();
  console.log('   ✓ WebSocket Engine: /ws/board and /ws/monitor active');
}

module.exports = {
  initBoardSocket,
  generateBoardApiKey,
  resolveRoomTimetableContext,
  sendCommandToBoard,
  pushContextToRoomBoards,
  broadcastToMonitors,
  activeBoardSockets,
  activeMonitors
};
