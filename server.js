const pkg = require('./package.json');
console.log('\n  ┌─────────────────────────────────────────────────────────────┐');
console.log(`  │   EAMS — Electronic Attendance Management System   v${pkg.version || '2.5.0'}   │`);
console.log('  └─────────────────────────────────────────────────────────────┘\n');

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();

const express = require('express');
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

// Nonce generation middleware for Content Security Policy (§S7)
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

// Native Gzip Compression Middleware for Low-Bandwidth Networks
app.use((req, res, next) => {
  const enc = req.headers['accept-encoding'] || '';
  if (!enc || req.method === 'HEAD') return next();

  const originalSend = res.send;
  res.send = function (body) {
    if (res.headersSent) return originalSend.call(this, body);
    if (res.getHeader('Content-Encoding') || res.getHeader('content-encoding')) {
      return originalSend.call(this, body);
    }

    const ct = (res.getHeader('content-type') || '').toString();
    const isCompressible = /json|text|javascript|css|xml|svg/i.test(ct) || (typeof body === 'string' && !ct);
    if (!isCompressible) return originalSend.call(this, body);

    let buf;
    if (Buffer.isBuffer(body)) buf = body;
    else if (typeof body === 'string') buf = Buffer.from(body);
    else return originalSend.call(this, body);

    if (buf.length < 512) return originalSend.call(this, body);

    if (enc.includes('gzip')) {
      zlib.gzip(buf, (err, gzipped) => {
        if (err || !gzipped) return originalSend.call(res, body);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.removeHeader('Content-Length');
        originalSend.call(res, gzipped);
      });
    } else {
      return originalSend.call(this, body);
    }
  };
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload' });
  }
  next(err);
});
const APP_VERSION = require('./package.json').version || '1.0.0';
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

// Immutable caching middleware for version-fingerprinted assets
app.use((req, res, next) => {
  if (req.query && req.query.v) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
  maxAge: cfg.NODE_ENV === 'production' ? '1d' : 3600000,
  etag: true,
  lastModified: true
}));

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
const { initTimetableSocket } = require('./services/timetable.socket');
initTimetableSocket(server);

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
  console.log(`  [1/4] Environment   →  ${cfg.NODE_ENV}`);
  console.log(`  [2/4] HTTP Server   →  http://localhost:${PORT}`);
  console.log(`        • WebSockets  : /ws/board, /ws/monitor, /ws/timetable active`);
  console.log(`        • Schedulers  : Bell (30s) · SubAdmin (60s) · Trust (24h)`);
  console.log(`        • Background  : Bulk sweeper & GoLive workers active`);
});

// Start Timetable Scheduled Go-Live Worker (§Phase 9, FP P6)
const { startTimetableGoLiveJob } = require('./jobs/timetableGoLive');
startTimetableGoLiveJob();