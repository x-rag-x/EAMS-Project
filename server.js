const pkg = require('./package.json');
console.log('\n  ┌─────────────────────────────────────────────────────────────┐');
console.log(`  │   Muster — Attendance Management System            v${pkg.version || '2.5.3'}   │`);
console.log('  └─────────────────────────────────────────────────────────────┘\n');

require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
if (process.env.FORCE_DNS === 'true') {
  const servers = process.env.DNS_SERVERS
    ? process.env.DNS_SERVERS.split(',').map(s => s.trim()).filter(Boolean)
    : ['8.8.8.8', '8.8.4.4'];
  try {
    dns.setServers(servers);
    console.log(`  [DNS] Forced DNS resolver → ${servers.join(', ')}`);
  } catch (e) {
    console.warn(`  [DNS] Failed to override DNS servers: ${e.message}`);
  }
}

const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');
const cfg = require('./config');
require('./config/db');
require('./utils/serverState');

const app = express();
// Prevent NoSQL query-operator injection from nested query parameters (Checklist N10)
app.set('query parser', 'simple');
app.use((req, res, next) => {
  if (req.query && typeof req.query === 'object') {
    for (const key of Object.keys(req.query)) {
      if (key.includes('$') || key.startsWith('.')) {
        return res.status(400).json({ error: 'Invalid query parameter: operators are not allowed' });
      }
    }
  }
  next();
});
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

// Nonce generation middleware for Content Security Policy
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

// Configure global application middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`, "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
      scriptSrcElem: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`, "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
      styleSrcElem:  ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
      styleSrcAttr:  ["'unsafe-inline'"],
      fontSrc:       ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc:        ["'self'", "data:", "blob:", "http://localhost:*", "http://127.0.0.1:*", "https://*.tile.openstreetmap.org", "https://*.basemaps.cartocdn.com", "https://server.arcgisonline.com", "https://unpkg.com"],
      connectSrc:    ["'self'", "http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*", "ws://127.0.0.1:*", "ws:", "wss:", "https://*.tile.openstreetmap.org", "https://*.basemaps.cartocdn.com", "https://server.arcgisonline.com", "https://unpkg.com"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// S7: Tighten CSP for migrated portals (student and attendance have zero inline handlers/scripts)
app.use((req, res, next) => {
  const p = (req.path || '').toLowerCase();
  if (p === '/student.html' || p === '/attendance.html' || p === '/student' || p === '/attendance') {
    const nonce = res.locals.cspNonce;
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' https://cdnjs.cloudflare.com https://unpkg.com`,
      `script-src-elem 'self' 'nonce-${nonce}' https://cdnjs.cloudflare.com https://unpkg.com`,
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
      "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
      "style-src-attr 'unsafe-inline'",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: http://localhost:* http://127.0.0.1:* https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://server.arcgisonline.com https://unpkg.com",
      "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://server.arcgisonline.com https://unpkg.com"
    ].join('; '));
  }
  next();
});
app.use(cors({origin: cfg.CORS_ORIGIN,credentials: true}));
// Attach unique request ID for distributed tracing and secure error reporting
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  next();
});

// Single canonical compression layer active via compression() (Checklist B13)

app.use(express.json({ limit: '1mb' }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload' });
  }
  next(err);
});
const APP_VERSION = require('./package.json').version || '1.0.0';

// Public Health & Operational Probes (Checklist R4)
app.get('/healthz', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get('/readyz', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const isConnected = mongoose.connection && mongoose.connection.readyState === 1;
  if (!isConnected) {
    return res.status(503).json({ ok: false, status: 'not_ready', db: 'disconnected' });
  }
  res.status(200).json({ ok: true, status: 'ready', db: 'connected', version: APP_VERSION });
});
const globalBuildVersion = `${APP_VERSION}-${Date.now().toString(36)}`;
const htmlCache = new Map();

function stampUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (/^(?:https?:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('#')) {
    return url;
  }
  const cleanUrl = url.split('?')[0].split('#')[0];
  if (!/\.(?:js|css|svg|png|jpg|jpeg|ico|webp)$/i.test(cleanUrl)) {
    return url;
  }
  const relPath = cleanUrl.replace(/^\/+/, '');
  const absPath = path.join(__dirname, 'public', relPath);
  let v = globalBuildVersion;
  try {
    const stat = fs.statSync(absPath);
    v = Math.floor(stat.mtimeMs).toString(36);
  } catch (_) {}
  return `${cleanUrl}?v=${v}`;
}

function stampHtmlAssets(html) {
  return html
    .replace(/(<script\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (match, prefix, src, suffix) => {
      return `${prefix}${stampUrl(src)}${suffix}`;
    })
    .replace(/(<link\b[^>]*\bhref=["'])([^"']+)(["'][^>]*>)/gi, (match, prefix, href, suffix) => {
      return `${prefix}${stampUrl(href)}${suffix}`;
    });
}

function serveStampedHtml(filePath, res) {
  try {
    const isProd = cfg.NODE_ENV === 'production';
    const stat = fs.statSync(filePath);
    const cached = htmlCache.get(filePath);
    if (isProd && cached && cached.mtimeMs === stat.mtimeMs) {
      return res.type('html').send(cached.content);
    }
    let html = fs.readFileSync(filePath, 'utf8');
    html = stampHtmlAssets(html);
    if (isProd) {
      htmlCache.set(filePath, { mtimeMs: stat.mtimeMs, content: html });
    }
    return res.type('html').send(html);
  } catch (err) {
    return res.status(404).send('Not Found');
  }
}

// Intercept HTML page requests to dynamically stamp asset URLs for cache busting
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let relPath = req.path;
  if (relPath === '/') relPath = '/index.html';
  if (relPath.endsWith('.html')) {
    const safePath = path.normalize(relPath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(__dirname, 'public', safePath);
    if (fs.existsSync(fullPath)) {
      return serveStampedHtml(fullPath, res);
    }
  }
  next();
});

// In-Memory Gzip Cache for High-Traffic Static Assets in Low-Bandwidth Networks
const staticGzipCache = new Map();
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const p = req.path;
  if (!/\.(?:js|css|svg)$/i.test(p)) return next();
  const enc = req.headers['accept-encoding'] || '';
  if (!enc.includes('gzip')) return next();

  const safePath = path.normalize(p).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(__dirname, 'public', safePath);
  if (!fs.existsSync(fullPath)) return next();

  try {
    const stat = fs.statSync(fullPath);
    if (stat.size < 1024) return next();

    const ct = p.endsWith('.js') ? 'application/javascript; charset=utf-8' : (p.endsWith('.css') ? 'text/css; charset=utf-8' : 'image/svg+xml');
    const cached = staticGzipCache.get(fullPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      res.setHeader('Content-Type', ct);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(cached.buffer);
    }

    const raw = fs.readFileSync(fullPath);
    zlib.gzip(raw, (err, gzipped) => {
      if (err || !gzipped) return next();
      staticGzipCache.set(fullPath, { mtimeMs: stat.mtimeMs, buffer: gzipped });
      res.setHeader('Content-Type', ct);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(gzipped);
    });
  } catch (_) {
    next();
  }
});


const compression = require('compression');
app.use(compression());

// Immutable caching middleware for version-fingerprinted assets (static only, Checklist N19)
app.use((req, res, next) => {
  if (!req.path.startsWith('/api') && req.query && req.query.v) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  next();
});

// Backward compatibility route for legacy timetable service worker registrations
app.get('/tt-sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.resolve(__dirname, 'public/js/tt-sw.js'));
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
    if (filePath.endsWith('tt-sw.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
  maxAge: cfg.NODE_ENV === 'production' ? '1d' : 3600000,
  etag: true,
  lastModified: true
}));

const { writeRateLimiter } = require('./middleware/rateLimiter');
app.use('/api', writeRateLimiter);

// Prevent authenticated API responses from being publicly cached (Checklist N19)
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use('/api', require('./routes/index'));

// Forward direct /timetable API requests to index router (ensures resilience for both /api/timetable and /timetable)
app.use('/timetable', (req, res, next) => {
  req.url = '/timetable' + req.url;
  require('./routes/index')(req, res, next);
});

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
  console.error('[Muster Unhandled Rejection]:', reason);
  if (isTransientMongoError(reason)) {
    return;
  }
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('[Muster Uncaught Exception]:', err);
  if (isTransientMongoError(err)) {
    return;
  }
  process.exit(1);
});

// Student portal entry point
app.get(['/student', '/student.html'], (req, res) => {
  serveStampedHtml(path.join(__dirname, 'public', 'student.html'), res);
});

// Teacher portal entry point
app.get(['/teacher', '/teacher.html'], (req, res) => {
  serveStampedHtml(path.join(__dirname, 'public', 'teacher.html'), res);
});

// QR Attendance entry point (attendance page only)
app.get('/attendance', (req, res) => {
  serveStampedHtml(path.join(__dirname, 'public', 'attendance.html'), res);
});

// Hostel portal entry point (wardens and residents)
app.get('/hostel', (req, res) => {
  serveStampedHtml(path.join(__dirname, 'public', 'hostel.html'), res);
});

// HOD / Controller portal entry point
app.get(['/hod', '/hod.html'], (req, res) => {
  serveStampedHtml(path.join(__dirname, 'public', 'controller.html'), res);
});

// Global Express error handler (N15, C5, S13, B11)
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

// Start HTTP & WebSocket server listener
const http = require('http');
const server = http.createServer(app);
// Unified WebSocket upgrade router (B10): single router for /ws/board, /ws/monitor, /ws/timetable; closes unknown paths
const { initBoardSocket, handleBoardUpgrade } = require('./services/board.socket');
initBoardSocket(server, { attachUpgrade: false });
const { initTimetableSocket, handleTimetableUpgrade } = require('./services/timetable.socket');
initTimetableSocket(server, { attachUpgrade: false });

server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url || '').split('?')[0];

  if (pathname === '/ws/board' || pathname === '/ws/monitor') {
    handleBoardUpgrade(req, socket, head);
  } else if (pathname === '/ws/timetable') {
    handleTimetableUpgrade(req, socket, head);
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\nNot Found: Unrecognized WebSocket endpoint\r\n\r\n');
    socket.destroy();
  }
});

const { startBellScheduler } = require('./services/bellScheduler');
startBellScheduler();

const { startSubAdminExpiryScheduler } = require('./services/subAdminExpiryService');
startSubAdminExpiryScheduler();

const { startTrustDailyScheduler } = require('./services/trustDailyService');
startTrustDailyScheduler();

const { startBulkSweeper } = require('./services/bulk/sweeper');
startBulkSweeper();

const PORT = process.env.PORT || cfg.PORT;
server.listen(PORT, () => {
  console.log(`  [1/4] Environment   →  ${cfg.NODE_ENV}`);
  console.log(`  [2/4] HTTP Server   →  http://localhost:${PORT}`);
  console.log(`        • WebSockets  : /ws/board, /ws/monitor, /ws/timetable active`);
  console.log(`        • Schedulers  : Bell (30s) · SubAdmin (60s) · Trust (24h)`);
  console.log(`        • Background  : Bulk sweeper & GoLive workers active`);
});

// Start Timetable Scheduled Go-Live Worker
const { startTimetableGoLiveJob } = require('./jobs/timetableGoLive');
startTimetableGoLiveJob();
// Start 6 Standardized Background Workers (Checklist B2)
const alertTick = require('./jobs/alertTick');
const odCompletion = require('./jobs/odCompletion');
const substitutionExpiry = require('./jobs/substitutionExpiry');
const timetableVersionClose = require('./jobs/timetableVersionClose');
const actingRoles = require('./jobs/actingRoles');
const dayStart = require('./jobs/dayStart');

alertTick.startJob(60 * 1000);
odCompletion.startJob(60 * 60 * 1000);
substitutionExpiry.startJob(15 * 60 * 1000);
timetableVersionClose.startJob(5 * 60 * 1000);
actingRoles.startJob(60 * 60 * 1000);
dayStart.startJob(60 * 60 * 1000);

// Graceful Shutdown Handler (Checklist R3)
function gracefulShutdown(signal) {
  console.log('[Server] Received ' + signal + '. Starting graceful shutdown...');

  // Stop background jobs
  try { alertTick.stopJob(); } catch (_) {}
  try { odCompletion.stopJob(); } catch (_) {}
  try { substitutionExpiry.stopJob(); } catch (_) {}
  try { timetableVersionClose.stopJob(); } catch (_) {}
  try { actingRoles.stopJob(); } catch (_) {}
  try { dayStart.stopJob(); } catch (_) {}

  // Stop HTTP server
  server.close(async () => {
    console.log('[Server] HTTP server closed.');
    try {
      if (mongoose.connection && mongoose.connection.readyState !== 0) {
        await mongoose.connection.close(false);
        console.log('[Server] MongoDB connection closed.');
      }
    } catch (err) {
      console.error('[Server] Error closing MongoDB connection:', err.message);
    }
    process.exit(0);
  });

  // Force exit after 10s if connections fail to close
  setTimeout(() => {
    console.error('[Server] Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
