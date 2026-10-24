const express = require('express');
const router = express.Router();
const { authMiddleware, requirePage } = require('../../middleware/auth');
const { loadBatch } = require('../../services/bulk/access');
const { bus } = require('../../services/bulk/progress');

/**
 * GET /api/bulk/batches/:id/events
 * Real-time Server-Sent Events (SSE) stream for batch progress, status, and messages
 */
router.get('/batches/:id/events', authMiddleware, requirePage('bulk', 'view'), loadBatch('view'), (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const sendEvent = (event) => {
    try {
      const idPrefix = event.seq ? `id: ${event.seq}\n` : '';
      const eventName = event.type || 'message';
      const dataPayload = JSON.stringify(event.data || {});
      res.write(`${idPrefix}event: ${eventName}\ndata: ${dataPayload}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    } catch (err) {
      console.warn('[SSE Send Warning]:', err.message);
    }
  };

  // 1. Initial snapshot of current batch state
  sendEvent({
    type: 'snapshot',
    data: {
      status: req.batch.status,
      progress: req.batch.progress || null,
      lastSeq: req.batch.messageSeq || 0
    }
  });

  // 2. Subscribe to event bus for this batch
  const channel = `batch:${req.batch._id}`;
  bus.on(channel, sendEvent);

  // 3. Keep-alive heartbeat every 15s to prevent proxy timeouts
  const heartbeatTimer = setInterval(() => {
    try {
      res.write(':hb\n\n');
      if (typeof res.flush === 'function') res.flush();
    } catch (_) {}
  }, 15000);

  // 4. Clean up listener on connection close
  req.on('close', () => {
    clearInterval(heartbeatTimer);
    bus.off(channel, sendEvent);
  });
});

/**
 * GET /api/bulk/batches/:id/progress
 * Polling fallback endpoint for clients where SSE connection drops or is blocked
 */
router.get('/batches/:id/progress', authMiddleware, requirePage('bulk', 'view'), loadBatch('view'), (req, res) => {
  res.json({
    ok: true,
    status: req.batch.status,
    progress: req.batch.progress || null,
    lastSeq: req.batch.messageSeq || 0
  });
});

module.exports = router;
