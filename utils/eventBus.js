const EventEmitter = require('events');
const crypto = require('crypto');

class ControllerEventBus extends EventEmitter {}
const eventBus = new ControllerEventBus();
eventBus.setMaxListeners(200);

// Active SSE client connections
const activeClients = new Set();

// One-time stream ticket cache (expires after 60 seconds)
const ticketMap = new Map();

/**
 * Generate a one-time ticket for SSE authentication.
 *
 * @param {Object} payload - { trackId, role, deptCodes }
 * @returns {string} ticket
 */
function createStreamTicket(payload) {
  const ticket = crypto.randomBytes(24).toString('hex');
  ticketMap.set(ticket, {
    payload,
    expiresAt: Date.now() + 60 * 1000
  });
  return ticket;
}

/**
 * Validate and consume a stream ticket.
 *
 * @param {string} ticket
 * @returns {Object|null} payload if valid
 */
function consumeStreamTicket(ticket) {
  if (!ticket || !ticketMap.has(ticket)) return null;

  const data = ticketMap.get(ticket);
  ticketMap.delete(ticket);

  if (Date.now() > data.expiresAt) return null;
  return data.payload;
}

// Clean up stale tickets every minute
setInterval(() => {
  const now = Date.now();
  for (const [t, data] of ticketMap.entries()) {
    if (now > data.expiresAt) ticketMap.delete(t);
  }
}, 60 * 1000).unref();

/**
 * Register an active SSE response client.
 */
function registerClient(res, clientInfo) {
  const client = { res, ...clientInfo };
  activeClients.add(client);

  res.on('close', () => {
    activeClients.delete(client);
  });
}

/**
 * Broadcast event to connected SSE clients matching scope.
 *
 * @param {string} eventName
 * @param {Object} data
 * @param {string|null} [deptCode=null]
 */
function broadcastSSE(eventName, data, deptCode = null) {
  const payloadStr = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of activeClients) {
    // If deptCode specified, filter for clients whose scope includes deptCode
    if (deptCode && client.deptCodes && !client.deptCodes.includes('ALL') && !client.deptCodes.includes(deptCode.toUpperCase())) {
      continue;
    }

    try {
      client.res.write(payloadStr);
    } catch (e) {
      activeClients.delete(client);
    }
  }
}

// Keepalive tick every 20 seconds
setInterval(() => {
  for (const client of activeClients) {
    try {
      client.res.write(': keepalive\n\n');
    } catch (e) {
      activeClients.delete(client);
    }
  }
}, 20 * 1000).unref();

module.exports = {
  eventBus,
  createStreamTicket,
  consumeStreamTicket,
  registerClient,
  broadcastSSE
};
