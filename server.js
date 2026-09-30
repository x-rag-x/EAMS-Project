console.log("> Starting EAMS...");

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const cfg = require('./config');
require('./config/db');
require('./utils/serverState');

const app = express();
// Only trust reverse proxy if explicitly enabled via environment or when running in production
if (process.env.TRUST_PROXY === 'true' || (cfg.NODE_ENV === 'production' && process.env.TRUST_PROXY !== 'false')) {
  app.set('trust proxy', 1);
} else {
  app.set('trust proxy', false);
}
const upload = multer({ storage: multer.memoryStorage() });

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
      connectSrc:    ["'self'", "http://localhost:*", "http://127.0.0.1:*", "ws:", "wss:", "https://*.tile.openstreetmap.org", "https://*.basemaps.cartocdn.com", "https://server.arcgisonline.com", "https://unpkg.com"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({origin: cfg.CORS_ORIGIN,credentials: true}));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', require('./routes/index'));

// QR Attendance entry point (attendance page only)
app.get('/attendance', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'attendance.html'));
});

// Start HTTP & WebSocket server listener
const http = require('http');
const server = http.createServer(app);
const { initBoardSocket } = require('./services/board.socket');
initBoardSocket(server);

const PORT = process.env.PORT || cfg.PORT;
server.listen(PORT, () => {
  console.log(`   1/5: Environment set for: ${cfg.NODE_ENV}`);
  console.log(`   2/5: EAMS API running → http://localhost:${PORT}`);
  console.log(`> Connecting Database...`)
});