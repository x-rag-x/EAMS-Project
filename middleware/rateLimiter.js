/**
 * middleware/rateLimiter.js
 * 
 * General Per-User / IP Write Rate Limiting & Account Protection (Resolves Checklist N13, B7, L9).
 * - Enforces per-user rate limiters across state-changing write endpoints (POST/PUT/PATCH/DELETE).
 * - Implements strict rate limiting for approvals, exports, uploads, and attendance marking.
 * - Implements per-user password attempt throttling in addition to IP limiting to prevent account lockout abuse.
 */

'use strict';

const rateLimit = require('express-rate-limit');
const existingLimiters = require('../utils/rateLimiters');

// General per-user/IP mutating write rate limiter (N13)
const writeRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 120, // 120 mutating requests per 5 minutes per user
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  skip: (req) => {
    // Only apply to mutating HTTP methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return true;
    if (process.env.NODE_ENV === 'development') return true;
    return false;
  },
  message: {
    error: 'Too many write requests submitted from this account or IP. Please slow down and try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for sensitive approval workflows (N13)
const approvalRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30, // 30 approvals per 5 minutes
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  skip: () => process.env.NODE_ENV === 'development',
  message: {
    error: 'Approval action rate limit exceeded. Please wait a few minutes before submitting further decisions.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for heavy data exports (N13)
const exportRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20, // 20 export requests per 5 minutes
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  skip: () => process.env.NODE_ENV === 'development',
  message: {
    error: 'Export rate limit reached. Please wait a few minutes before downloading additional reports.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Per-user password attempt throttling to prevent account lockout abuse (B7, L9)
const passwordAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 failed attempts per user identifier within window
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const username = (req.body?.identifier || req.body?.username || '').toLowerCase().trim();
    return username || req.ip;
  },
  validate: { keyGeneratorIpFallback: false },
  skip: () => process.env.NODE_ENV === 'development',
  message: {
    error: 'Too many failed login attempts for this user account. Password attempts are throttled. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  ...existingLimiters,
  writeRateLimiter,
  approvalRateLimiter,
  exportRateLimiter,
  passwordAttemptLimiter
};
