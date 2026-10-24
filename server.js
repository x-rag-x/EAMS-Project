console.log("> Starting EAMS...");

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const cfg = require('./config');
require('./config/db');
require('./utils/serverState');

const app = express();
// Trust reverse proxy if explicitly enabled, running on Railway, or in production (unless explicitly false)
const isBehindProxy = process.env.TRUST_PROXY === 'true' ||
  Boolean(process.env.RAILWAY_ENVIRONMENT) ||
  Boolean(process.env.RAILWAY_STATIC_URL) ||
  (cfg.NODE_ENV === 'production' && process.env.TRUST_PROXY !== 'false');

if (isBehindProxy) {
  app.set('trust proxy', 1);
} else {
  app.set('trust proxy', false);
}

// Configure global application middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
      scriptSrcElem: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
      styleSrcElem:  ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
      styleSrcAttr:  ["'unsafe-inline'"],
      fontSrc:       ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc:        ["'self'", "data:", "blob:", "http://localhost:*", "http://127.0.0.1:*", "https://*.tile.openstreetmap.org", "https://*.basemaps.cartocdn.com", "https://server.arcgisonline.com", "https://unpkg.com"],
      connectSrc:    ["'self'", "http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*", "ws://127.0.0.1:*", "https://*.tile.openstreetmap.org", "https://*.basemaps.cartocdn.com", "https://server.arcgisonline.com", "https://unpkg.com"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({origin: cfg.CORS_ORIGIN,credentials: true}));
// Attach unique request ID for distributed tracing and secure error reporting
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload' });
  }
  next(err);
});
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', require('./routes/index'));

// Helper to identify non-fatal transient Mongo network dropouts
function isTransientMongoError(err) {
  if (!err) return false;
  return err.name === 'MongoServerSelectionError' ||
    err.name === 'MongoNetworkError' ||
    err.code === 'ECONNRESET' ||
    err.code === 'ETIMEDOUT';
}

// Process-level handling: log and exit on unhandled rejections / uncaught exceptions (except transient Mongo drops)
process.on('unhandledRejection', (reason) => {
  console.error('[EAMS Unhandled Rejection]:', reason);
  if (isTransientMongoError(reason)) {
    return;
  }
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('[EAMS Uncaught Exception]:', err);
  if (isTransientMongoError(err)) {
    return;
  }
  process.exit(1);
});

// QR Attendance entry point (attendance page only)
app.get('/attendance', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'attendance.html'));
});

// Hostel portal entry point (wardens and residents)
app.get('/hostel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'hostel.html'));
});

// HOD / Controller portal entry point
app.get(['/hod', '/hod.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'controller.html'));
});

// Global Express error handler
app.use((err, req, res, next) => {
  const reqId = req.id || 'N/A';
  if (err.name === 'MongoServerSelectionError' || err.name === 'MongoNetworkError') {
    return res.status(503).json({
      error: 'Database connection temporarily interrupted. Please retry in a moment.',
      dbOffline: true,
      requestId: reqId
    });
  }
  console.error(`[EAMS Express Error] [ReqID: ${reqId}]:`, err);
  if (res.headersSent) {
    return next(err);
  }
  const status = Number(err.status) || 500;
  const isProd = cfg.NODE_ENV === 'production';
  // Expose specific error messages only for client-side errors (4xx) or during non-production debugging
  const errorMessage = (status < 500 || !isProd)
    ? (err.message || 'Error processing request')
    : 'An unexpected internal server error occurred. Please contact administrator.';
  res.status(status).json({ error: errorMessage, requestId: reqId });
});

// Start HTTP & WebSocket server listener
const http = require('http');
const server = http.createServer(app);
const { initBoardSocket } = require('./services/board.socket');
initBoardSocket(server);

// Start Bell Scheduler
const { startBellScheduler } = require('./services/bellScheduler');
startBellScheduler();

// Start Sub-Admin Grant Expiry Scheduler (§10, R7.5)
const { startSubAdminExpiryScheduler } = require('./services/subAdminExpiryService');
startSubAdminExpiryScheduler();

// Start Daily Trust Engine Scheduler (§8, T4.2)
const { startTrustDailyScheduler } = require('./services/trustDailyService');
startTrustDailyScheduler();

// Start Bulk Background Job Sweeper (§8.6)
const { startBulkSweeper } = require('./services/bulk/sweeper');
startBulkSweeper();

const PORT = process.env.PORT || cfg.PORT;
server.listen(PORT, () => {
  console.log(`   1/5: Environment set for: ${cfg.NODE_ENV}`);
  console.log(`   2/5: EAMS API running → http://localhost:${PORT}`);
  console.log(`> Connecting Database...`)
});