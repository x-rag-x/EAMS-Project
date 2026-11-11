const rateLimit = require('express-rate-limit');

// Rate limiters for sensitive endpoints and operations

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: () => process.env.NODE_ENV === 'development',
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

// Attendance marking limiters: keyed per authenticated user trackId, with high-ceiling IP backstops for campus Wi-Fi / NAT
const liveSessionMarkLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many attendance marking attempts for this account. Please try again after 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// High per-IP ceiling backstop to accommodate entire classrooms/lecture halls sharing one NAT IP
const liveSessionMarkIpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 1000,
  message: { error: 'Too many attendance marking attempts from this network. Please try again after 10 minutes.' },
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
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many attendance clear requests. Please try again after 1 hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const qrAttendanceLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 15,
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many QR attendance requests for this account. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// High per-IP ceiling backstop for QR scans across campus Wi-Fi
const qrAttendanceIpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 1000,
  message: { error: 'Too many QR attendance requests from this network. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const attendanceMarkLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60,
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many attendance marking requests for this account. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// High per-IP ceiling backstop for teacher submissions
const attendanceMarkIpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 1000,
  message: { error: 'Too many attendance marking requests from this network. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const attendanceUpdateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60,
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many attendance update requests for this account. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// High per-IP ceiling backstop for attendance updates
const attendanceUpdateIpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 1000,
  message: { error: 'Too many attendance update requests from this network. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const boardHandshakeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many handshake attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// S6.3 / Proposal D1: skip successful requests, 30 failed / 15 min per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  skipSuccessfulRequests: true,
  skip: () => process.env.NODE_ENV === 'development',
  message: { error: 'Too many failed login attempts from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// S6.3 / Proposal D1: 10 failed / 15 min per username
const loginUsernameLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  skipSuccessfulRequests: true,
  skip: () => process.env.NODE_ENV === 'development',
  keyGenerator: (req) => {
    const id = (req.body?.identifier || req.body?.username || '').toLowerCase().trim();
    return id || req.ip;
  },
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many failed login attempts for this account, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Device Registration & Trust rate limiters (§5, T1.6)
const deviceTicketGenerateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 / 15 min per advisor
  skip: () => process.env.NODE_ENV === 'development',
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many registration tickets generated. Please wait 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const deviceClaimIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 / 15 min per IP
  skip: () => process.env.NODE_ENV === 'development',
  message: { error: 'Too many registration claim attempts from this IP. Please wait 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const deviceVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  skip: () => process.env.NODE_ENV === 'development',
  keyGenerator: (req) => req.params?.id || req.body?.ticketId || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many verification attempts for this ticket. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const deviceReplacementLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 3, // 3 / day per student
  skip: () => process.env.NODE_ENV === 'development',
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Maximum device replacement requests reached for today (max 3/day).' },
  standardHeaders: true,
  legacyHeaders: false,
});

const registryExportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // 30 exports per 5 minutes per user/IP
  skip: () => process.env.NODE_ENV === 'development',
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Export rate limit reached. Please wait a few minutes before generating more files.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const repShareRequestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30,
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many Rep Share delegation requests for this account. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const repShareSubmitLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20,
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many Rep Share submission attempts for this account. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const publicSettingsLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
  skip: () => process.env.NODE_ENV === 'development',
  message: { error: 'Too many settings requests from this IP. Please try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Leave, OD, Files, Participation, and Trust Rate Limiters (Audit S15)
const leaveApplyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  skip: () => process.env.NODE_ENV === 'development',
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many leave requests submitted. Please wait a few minutes before applying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const odCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  skip: () => process.env.NODE_ENV === 'development',
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many OD requests submitted. Please wait a few minutes before submitting again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const odEventCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  skip: () => process.env.NODE_ENV === 'development',
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many event registration requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const fileUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  skip: () => process.env.NODE_ENV === 'development',
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many file upload requests. Please wait a moment before uploading more files.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const fileStreamLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100,
  skip: () => process.env.NODE_ENV === 'development',
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many file download requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const trustActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  skip: () => process.env.NODE_ENV === 'development',
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many trust management requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const participationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50,
  skip: () => process.env.NODE_ENV === 'development',
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many participation requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const studentSearchLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  skip: () => process.env.NODE_ENV === 'development',
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many search requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});


const recountLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?.trackId || req.user?._id?.toString() || req.ip,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many recount requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  recountLimiter,
  studentSearchLimiter,
  repShareRequestLimiter,
  repShareSubmitLimiter,
  registryExportLimiter,
  authLimiter,
  deleteAuthLimiter,
  liveSessionMarkLimiter,
  liveSessionMarkIpLimiter,
  criticalDeleteLimiter,
  attendanceClearLimiter,
  qrAttendanceLimiter,
  qrAttendanceIpLimiter,
  attendanceMarkLimiter,
  attendanceMarkIpLimiter,
  attendanceUpdateLimiter,
  attendanceUpdateIpLimiter,
  boardHandshakeLimiter,
  loginLimiter,
  loginUsernameLimiter,
  deviceTicketGenerateLimiter,
  deviceClaimIpLimiter,
  deviceVerifyLimiter,
  deviceReplacementLimiter,
  publicSettingsLimiter,
  leaveApplyLimiter,
  odCreateLimiter,
  odEventCreateLimiter,
  fileUploadLimiter,
  fileStreamLimiter,
  trustActionLimiter,
  participationLimiter,
};

