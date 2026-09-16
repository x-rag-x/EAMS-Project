const rateLimit = require('express-rate-limit');

// Rate limiters for sensitive endpoints and operations

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const deleteAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too many delete verification attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const liveSessionMarkLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  message: { error: 'Too many attendance marking attempts. Please try again after 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const criticalDeleteLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 2,
  message: { error: 'Too many bulk deletion requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const attendanceClearLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 60 minutes
  max: 2,
  message: { error: 'Too many attendance clear requests. Please try again after 1 hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const qrAttendanceLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 15,
  message: { error: 'Too many QR attendance requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  authLimiter,
  deleteAuthLimiter,
  liveSessionMarkLimiter,
  criticalDeleteLimiter,
  attendanceClearLimiter,
  qrAttendanceLimiter,
};
