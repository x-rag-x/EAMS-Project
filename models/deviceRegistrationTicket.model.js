const mongoose = require('mongoose');

/**
 * DeviceRegistrationTicket Schema (§4, T1.1)
 *
 * Manages the 2-step verification protocol between Class Advisor and Student phone:
 * Step 1: Advisor issues 12-char credential (10 min expiry, 5 attempts).
 * Step 2: Student phone claims ticket, submits public key, displays 6-digit code (5 min expiry, 3 attempts).
 * Advisor enters 6-digit code to verify and activate trust.
 * Retained for 90 days (TTL purge).
 */
const DeviceRegistrationTicketSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
    index: true
  },
  studentTrackId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  deptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    default: null
  },
  issuedBy: {
    trackId: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, default: 'advisor' }
  },
  kind: {
    type: String,
    enum: ['new', 'replacement'],
    default: 'new'
  },
  credentialHash: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  attempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 5
  },
  stage: {
    type: String,
    enum: ['ISSUED', 'CLAIMED', 'CODE_SHOWN', 'VERIFIED', 'EXPIRED', 'LOCKED', 'CANCELLED'],
    default: 'ISSUED',
    index: true
  },
  claimedFrom: {
    ip: { type: String, default: '' },
    installId: { type: String, default: '' },
    fingerprintHash: { type: String, default: '' }
  },
  deviceTrackId: {
    type: String,
    default: '',
    trim: true
  },
  verifyCodeHash: {
    type: String,
    default: '',
    trim: true
  },
  verifyExpiresAt: {
    type: Date,
    default: null
  },
  verifyAttempts: {
    type: Number,
    default: 0
  },
  verifyMaxAttempts: {
    type: Number,
    default: 3
  },
  usedAt: {
    type: Date,
    default: null
  },
  purgeAt: {
    type: Date,
    default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
  }
}, { timestamps: true });

DeviceRegistrationTicketSchema.index({ studentId: 1, stage: 1 });
DeviceRegistrationTicketSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

module.exports = {
  DeviceRegistrationTicket: mongoose.model('DeviceRegistrationTicket', DeviceRegistrationTicketSchema),
};
