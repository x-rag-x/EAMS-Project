/**
 * services/timetable.socket.js
 * Real-Time Presence & Live Collaboration WebSocket Server:
 * - Mounts /ws/timetable for real-time collaboration in draft workspaces.
 * - Broadcasts live cell outlines (USER_EDITING_SLOT / SLOT_HELD) with 30s auto-expiry.
 * - Broadcasts applied operations (OP_BROADCAST) to peer clients for instant synchronization.
 * - Emits ACCESS_REVOKED to freeze client screens if rights are revoked mid-session.
 */

'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const url = require('url');
const jwt = require('jsonwebtoken');
const cfg = require('../config');

// Active socket collections: draftId -> Set<{ ws, userId, userName, userColor }>
const activeDraftRooms = new Map();
// Active slot locks: `${draftId}:${classId}:${slotKey}` -> { userId, userName, expiresAt, timer }
const activeSlotHolds = new Map();
// User sockets: userId -> Set<ws>
const userSockets = new Map();

let wssTimetable = null;

function extractUpgradeToken(req) {
  const parsedUrl = url.parse(req.url, true);
  if (parsedUrl.query && parsedUrl.query.token) {
    return parsedUrl.query.token;
  }
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(';');
    for (const c of cookies) {
      const [k, v] = c.trim().split('=');
      if (k === 'token' || k === 'authToken' || k === 'jwt') {
        return decodeURIComponent(v);
      }
    }
  }
  return null;
}

/**
 * Initializes Timetable Collaboration WebSocket Server.
 * @param {http.Server} httpServer
 */
function handleTimetableUpgrade(req, socket, head) {
  const pathname = url.parse(req.url).pathname;
  if (pathname !== '/ws/timetable') {
    return;
  }

  const token = extractUpgradeToken(req);
  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\nUnauthorized: Missing token');
    socket.destroy();
    return;
  }

  let decoded = null;
  try {
    decoded = jwt.verify(token, cfg.JWT_SECRET);
  } catch (_) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\nUnauthorized: Invalid token');
    socket.destroy();
    return;
  }

  req.user = decoded;

  wssTimetable.handleUpgrade(req, socket, head, (ws) => {
    wssTimetable.emit('connection', ws, req);
  });
}

function initTimetableSocket(httpServer, opts = {}) {
  if (wssTimetable) return;

  wssTimetable = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  wssTimetable.on('error', (_err) => {
    // Gracefully handle server-level WebSocket errors
  });

  if (opts.attachUpgrade !== false && httpServer) {
    httpServer.on('upgrade', (req, socket, head) => {
      handleTimetableUpgrade(req, socket, head);
    });
  }

  wssTimetable.on('connection', (ws, req) => {
    handleConnection(ws, req);
  });
}

/**
 * Handles incoming connection and message dispatch.
 */
function handleConnection(ws, req) {
  let currentDraftId = null;
  let currentUserId = null;
  let currentUserName = '';

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('error', (_err) => {
    // Gracefully handle socket error without allowing unhandled RangeError or socket drop to terminate Node.js process
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      switch (msg.type) {
        case 'JOIN_DRAFT': {
          const { draftId, userId, userName, token } = msg;
          if (!draftId) return;

          currentDraftId = String(draftId);
          currentUserId = userId ? String(userId) : 'anon';
          currentUserName = userName || 'Collaborator';

          // Register in userSockets
          if (!userSockets.has(currentUserId)) {
            userSockets.set(currentUserId, new Set());
          }
          userSockets.get(currentUserId).add(ws);

          // Register in draft room
          if (!activeDraftRooms.has(currentDraftId)) {
            activeDraftRooms.set(currentDraftId, new Set());
          }
          const room = activeDraftRooms.get(currentDraftId);
          room.add(ws);

          // Build list of active peers in draft
          const activePeers = [];
          for (const peerWs of room) {
            if (peerWs._peerInfo) activePeers.push(peerWs._peerInfo);
          }

          ws._peerInfo = { userId: currentUserId, userName: currentUserName };

          // Notify sender of active peers and current slot holds
          const existingHolds = [];
          const now = Date.now();
          activeSlotHolds.forEach((hold, key) => {
            if (key.startsWith(`${currentDraftId}:`) && hold.expiresAt > now) {
              const parts = key.split(':');
              existingHolds.push({
                classId: parts[1],
                slotKey: parts[2],
                userId: hold.userId,
                userName: hold.userName,
                expiresAt: hold.expiresAt
              });
            }
          });

          safeSend(ws, {
            type: 'ROOM_JOINED',
            draftId: currentDraftId,
            peers: activePeers,
            holds: existingHolds
          });

          // Broadcast peer joined to others in draft
          broadcastToDraft(currentDraftId, {
            type: 'PEER_JOINED',
            userId: currentUserId,
            userName: currentUserName
          }, ws);
          break;
        }

        case 'USER_EDITING_SLOT': {
          const { classId, slotKey } = msg;
          if (!currentDraftId || !classId || !slotKey) return;

          const holdKey = `${currentDraftId}:${classId}:${slotKey}`;
          const existingHold = activeSlotHolds.get(holdKey);
          if (existingHold?.timer) clearTimeout(existingHold.timer);

          const expiresAt = Date.now() + 30000; // auto-expiry
          const timer = setTimeout(() => {
            activeSlotHolds.delete(holdKey);
            broadcastToDraft(currentDraftId, {
              type: 'SLOT_RELEASED',
              classId,
              slotKey
            });
          }, 30000);

          activeSlotHolds.set(holdKey, {
            userId: currentUserId,
            userName: currentUserName,
            expiresAt,
            timer
          });

          broadcastToDraft(currentDraftId, {
            type: 'SLOT_HELD',
            classId,
            slotKey,
            userId: currentUserId,
            userName: currentUserName,
            expiresAt
          }, ws);
          break;
        }

        case 'USER_LEFT_SLOT': {
          const { classId, slotKey } = msg;
          if (!currentDraftId || !classId || !slotKey) return;

          const holdKey = `${currentDraftId}:${classId}:${slotKey}`;
          const existing = activeSlotHolds.get(holdKey);
          if (existing?.timer) clearTimeout(existing.timer);
          activeSlotHolds.delete(holdKey);

          broadcastToDraft(currentDraftId, {
            type: 'SLOT_RELEASED',
            classId,
            slotKey
          });
          break;
        }

        case 'PING':
          safeSend(ws, { type: 'PONG', timestamp: Date.now() });
          break;

        default:
          break;
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    if (currentUserId && userSockets.has(currentUserId)) {
      const set = userSockets.get(currentUserId);
      set.delete(ws);
      if (!set.size) userSockets.delete(currentUserId);
    }

    if (currentDraftId && activeDraftRooms.has(currentDraftId)) {
      const room = activeDraftRooms.get(currentDraftId);
      room.delete(ws);
      if (!room.size) activeDraftRooms.delete(currentDraftId);

      // Clean up any holds held by this user
      activeSlotHolds.forEach((hold, key) => {
        if (key.startsWith(`${currentDraftId}:`) && hold.userId === currentUserId) {
          if (hold.timer) clearTimeout(hold.timer);
          activeSlotHolds.delete(key);
          const parts = key.split(':');
          broadcastToDraft(currentDraftId, {
            type: 'SLOT_RELEASED',
            classId: parts[1],
            slotKey: parts[2]
          });
        }
      });

      broadcastToDraft(currentDraftId, {
        type: 'PEER_LEFT',
        userId: currentUserId,
        userName: currentUserName
      });
    }
  });
}

function safeSend(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (_) {}
  }
}

/**
 * Broadcasts an event to all connected peers in a specific draft.
 */
function broadcastToDraft(draftId, message, senderWs = null) {
  if (!draftId) return;
  const room = activeDraftRooms.get(String(draftId));
  if (!room) return;

  const payload = JSON.stringify(message);
  for (const client of room) {
    if (client !== senderWs && client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (_) {}
    }
  }
}

/**
 * Emits ACCESS_REVOKED to a user across all active sessions.
 */
function emitAccessRevoked(userId, workspaceId) {
  if (!userId) return;
  const sockets = userSockets.get(String(userId));
  if (!sockets) return;

  const payload = JSON.stringify({
    type: 'ACCESS_REVOKED',
    workspaceId: String(workspaceId)
  });

  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payload);
      } catch (_) {}
    }
  }
}

module.exports = {
  initTimetableSocket,
  handleTimetableUpgrade,
  broadcastToDraft,
  emitAccessRevoked
};
