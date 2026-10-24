'use strict';

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
const { resolveRoomCurrentContext } = require('../utils/timetableResolver');

// Active socket collections
const activeBoardSockets = new Map(); // deviceId -> { ws, boardId, deviceId, roomId, ip, connectedAt, lastHeartbeat, telemetry }
const activeMonitors = new Set();      // Set<WebSocket>

// Rate limiting & connection capping maps
const ipConnections = new Map();       // ip -> count
const MAX_CONCURRENT_PER_IP = 10;
const deviceAttempts = new Map();      // deviceId -> [timestamps]
const MAX_DEVICE_ATTEMPTS_PER_MIN = 20;

function checkDeviceRateLimit(deviceId) {
  if (!deviceId) return true;
  const now = Date.now();
  const windowStart = now - 60000;
  let timestamps = deviceAttempts.get(deviceId) || [];
  timestamps = timestamps.filter(t => t > windowStart);
  if (timestamps.length >= MAX_DEVICE_ATTEMPTS_PER_MIN) {
    deviceAttempts.set(deviceId, timestamps);
    return false;
  }
  timestamps.push(now);
  deviceAttempts.set(deviceId, timestamps);
  return true;
}

// In-memory single-use tickets for WebSocket connection (30s lifetime)
const boardWsTickets = new Map(); // ticketString -> { deviceId, boardId, expiresAt }

function issueWsTicket(deviceId, boardId) {
  const ticket = crypto.randomBytes(24).toString('hex');
  boardWsTickets.set(ticket, {
    deviceId: String(deviceId).toUpperCase(),
    boardId: String(boardId),
    expiresAt: Date.now() + 30000 // 30 seconds
  });
  return { ticket, expiresIn: 30 };
}

function consumeWsTicket(ticket) {
  if (!ticket || typeof ticket !== 'string') return null;
  const record = boardWsTickets.get(ticket);
  if (!record) return null;
  boardWsTickets.delete(ticket); // Single use!
  if (Date.now() > record.expiresAt) {
    return null; // Expired
  }
  return record;
}

let wssBoard = null;
let wssMonitor = null;
let staleSweeperInterval = null;

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
  // Use the new shared resolver (handles calendar holidays, overrides, week instances, published templates)
  return resolveRoomCurrentContext(roomId, customTime);
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

  // Fix F15: Reject raw board API keys passed in URL query parameters
  if (query.apiKey || query.key) {
    ws.send(JSON.stringify({
      type: 'error',
      code: 'INSECURE_AUTH_METHOD',
      message: 'Passing board API keys in URLs is prohibited. Use one-time WebSocket ticket auth.'
    }));
    try {
      await logAction(
        'SYSTEM', 'Smart Board Gateway', 'system',
        'Board Connection Rejected - Insecure Key In URL',
        `Rejected connection from IP ${ip} because board API key was passed in URL query parameters`,
        'security', 'warn', ip, 'WS_BOARD',
        { ip, userAgent }
      );
    } catch (e) { /* ignore */ }
    ws.close(4003, 'API key in URL prohibited');
    return;
  }

  const ticket = (query.ticket || '').trim();
  let ticketRecord = null;
  if (ticket) {
    ticketRecord = consumeWsTicket(ticket);
    if (!ticketRecord) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'INVALID_OR_EXPIRED_TICKET',
        message: 'WebSocket authentication ticket is invalid or expired.'
      }));
      try {
        await logAction(
          'SYSTEM', 'Smart Board Gateway', 'system',
          'Board Connection Rejected - Invalid Ticket',
          `Rejected connection from IP ${ip} (invalid or expired ticket)`,
          'security', 'warn', ip, 'WS_BOARD',
          { ip, userAgent }
        );
      } catch (e) { /* ignore */ }
      ws.close(4001, 'Invalid or expired ticket');
      return;
    }
  }

  let authenticatedBoard = null;
  const rawDeviceId = (ticketRecord ? ticketRecord.deviceId : (query.device || query.deviceId || '')).trim().toUpperCase();
  const token = (query.token || '').trim();

  // 1. Require deviceId parameter
  if (!rawDeviceId) {
    ws.send(JSON.stringify({
      type: 'error',
      code: 'DEVICE_ID_REQUIRED',
      message: 'Device ID is required for board connection.'
    }));
    try {
      await logAction(
        'SYSTEM', 'Smart Board Gateway', 'system',
        'Board Connection Rejected - Missing Device ID',
        `Rejected connection from IP ${ip} (no deviceId provided)`,
        'security', 'warn', ip, 'WS_BOARD',
        { ip, userAgent }
      );
    } catch (e) { /* ignore */ }
    ws.close(4003, 'Device ID required');
    return;
  }

  // Rate-limit device connection attempts
  if (!checkDeviceRateLimit(rawDeviceId)) {
    ws.send(JSON.stringify({
      type: 'error',
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many connection attempts for this device. Please wait.'
    }));
    ws.close(4029, 'Rate limit exceeded');
    return;
  }

  // 2. Try JWT verification if token provided (board token flow)
  let tokenValid = false;
  if (token) {
    try {
      const decoded = jwt.verify(token, cfg.BOARD_JWT_SECRET);
      if (decoded && decoded.deviceId === rawDeviceId && decoded.aud === 'board') {
        tokenValid = true;
      }
    } catch (err) {
      // token expired or invalid
    }
  }

  // 3. Lookup board in DB by deviceId
  authenticatedBoard = await M.SmartBoard.findOne({ deviceId: rawDeviceId });

  // 4. Reject unregistered or unauthorized boards
  if (!authenticatedBoard) {
    ws.send(JSON.stringify({
      type: 'error',
      code: 'UNREGISTERED_DEVICE',
      message: 'Unregistered smart board device.'
    }));
    try {
      await logAction(
        'SYSTEM', 'Smart Board Gateway', 'system',
        'Unauthorized Board Connection Attempt',
        `Rejected connection from IP ${ip} (Device ID: "${rawDeviceId}")`,
        'security', 'warn', ip, 'WS_BOARD',
        { deviceId: rawDeviceId, ip, userAgent }
      );
    } catch (e) { /* ignore */ }
    ws.close(4003, 'Unregistered device');
    return;
  }

  // 5. Check board status
  if (authenticatedBoard.status !== 'Active') {
    ws.send(JSON.stringify({
      type: 'error',
      code: 'BOARD_INACTIVE',
      message: `Smart board is currently ${authenticatedBoard.status}. Contact administrator.`
    }));
    try {
      await logAction(
        'SYSTEM', 'Smart Board Gateway', 'system',
        'Board Connection Rejected - Inactive Status',
        `Board "${authenticatedBoard.boardName}" (${rawDeviceId}) rejected: status ${authenticatedBoard.status}`,
        'security', 'warn', ip, 'WS_BOARD',
        { deviceId: rawDeviceId, status: authenticatedBoard.status, ip }
      );
    } catch (e) { /* ignore */ }
    ws.close(4003, `Board status: ${authenticatedBoard.status}`);
    return;
  }

  // 6. Require valid authentication: either ticketRecord OR valid board token
  if (!ticketRecord && !tokenValid) {
    ws.send(JSON.stringify({
      type: 'error',
      code: 'INVALID_CREDENTIALS',
      message: 'Authentication required via one-time ticket or valid board token.'
    }));
    try {
      await logAction(
        'SYSTEM', 'Smart Board Gateway', 'system',
        'Board Connection Rejected - Invalid Credentials',
        `Board "${authenticatedBoard.boardName}" (${rawDeviceId}) rejected: unauthenticated`,
        'security', 'warn', ip, 'WS_BOARD',
        { deviceId: rawDeviceId, ip }
      );
    } catch (e) { /* ignore */ }
    ws.close(4001, 'Authentication required');
    return;
  }

  const deviceId = authenticatedBoard?.deviceId;
  if (!deviceId) {
    ws.close(4001, 'Board deviceId is missing');
    return;
  }

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
async function handleMonitorConnection(ws, req) {
  const parsedUrl = url.parse(req.url, true);
  const ticket = parsedUrl.query.ticket;

  if (!ticket) {
    ws.close(4001, 'Monitor ticket required');
    return;
  }

  try {
    const decoded = jwt.verify(ticket, cfg.JWT_SECRET);
    if (decoded.type !== 'monitor') {
      ws.close(4001, 'Invalid ticket type');
      return;
    }
  } catch (err) {
    ws.close(4001, 'Invalid or expired monitor ticket');
    return;
  }

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

    // Clean expired WebSocket tickets (30s lifetime)
    for (const [t, data] of boardWsTickets.entries()) {
      if (now > data.expiresAt) boardWsTickets.delete(t);
    }

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
 * For 'ping' command, waits for pong response up to 5s to measure latency
 */
async function sendCommandToBoard(deviceId, command, payload = {}) {
  const session = activeBoardSockets.get(deviceId);
  if (!session || session.ws.readyState !== WebSocket.OPEN) {
    return { success: false, reason: 'Board is currently offline or unreachable.' };
  }

  // For ping command, wait for pong response
  if (command === 'ping') {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        session.ws.removeListener('message', pongHandler);
        resolve({ success: false, reason: 'Board did not respond to ping within 5 seconds.', latencyMs: null });
      }, 5000);

      const startTime = Date.now();

      function pongHandler(data) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'pong') {
            clearTimeout(timeout);
            session.ws.removeListener('message', pongHandler);
            const latencyMs = Date.now() - startTime;
            resolve({ success: true, command: 'ping', deviceId, latencyMs });
          }
        } catch (e) { /* ignore */ }
      }

      session.ws.on('message', pongHandler);

      const message = JSON.stringify({
        type: 'command',
        command,
        payload,
        dispatchedAt: new Date().toISOString()
      });
      session.ws.send(message);
    });
  }

  // For other commands, send and return immediately
  const message = JSON.stringify({
    type: 'command',
    command,
    payload,
    dispatchedAt: new Date().toISOString()
  });

  session.ws.send(message);

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
  const MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KiB ceiling to prevent memory exhaustion DoS
  wssBoard = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  wssMonitor = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  // Route incoming HTTP Upgrade requests based on URL pathname
  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = url.parse(req.url).pathname;

    if (pathname !== '/ws/board' && pathname !== '/ws/monitor') {
      return;
    }

    // Enforce IP-level connection ceiling to prevent socket exhaustion DoS
    const clientIp = cleanIp(req);
    const activeIpCount = ipConnections.get(clientIp) || 0;
    if (activeIpCount >= MAX_CONCURRENT_PER_IP) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    ipConnections.set(clientIp, activeIpCount + 1);
    socket.on('close', () => {
      const cur = ipConnections.get(clientIp) || 1;
      if (cur <= 1) ipConnections.delete(clientIp);
      else ipConnections.set(clientIp, cur - 1);
    });

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
  console.log('   ✓ WebSocket Engine: /ws/board and /ws/monitor active (maxPayload: 64 KiB)');
}

module.exports = {
  initBoardSocket,
  generateBoardApiKey,
  issueWsTicket,
  consumeWsTicket,
  resolveRoomTimetableContext,
  sendCommandToBoard,
  pushContextToRoomBoards,
  broadcastToMonitors,
  activeBoardSockets,
  activeMonitors
};
