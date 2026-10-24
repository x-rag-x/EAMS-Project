const mongoose = require('mongoose');

/**
 * StudentDevice Schema (§4, T1.1)
 *
 * Tracks hardware browser profiles bound to students for attendance and session trust.
 * Bound via non-extractable WebCrypto ECDSA P-256 key pair in IndexedDB.
 */
const StudentDeviceSchema = new mongoose.Schema({
  deviceTrackId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
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
  status: {
    type: String,
    enum: ['PENDING', 'TRUSTED', 'REVOKED', 'REPLACED', 'FAILED'],
    default: 'PENDING',
    index: true
  },
  publicKeyJwk: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  keyThumbprint: {
    type: String,
    default: '',
    trim: true
  },
  installId: {
    type: String,
    required: true,
    trim: true
  },
  fingerprintHash: {
    type: String,
    default: '',
    trim: true
  },
  info: {
    ua: { type: String, default: '' },
    browser: { type: String, default: '' },
    os: { type: String, default: '' },
    osVersion: { type: String, default: '' },
    model: { type: String, default: '' },
    mobile: { type: Boolean, default: false },
    screen: { type: String, default: '' },
    tz: { type: String, default: '' },
    lang: { type: String, default: '' },
    pwa: { type: Boolean, default: false }
  },
  registeredBy: {
    trackId: { type: String, default: '' },
    name: { type: String, default: '' }
  },
  ticketId: {
    type: String,
    default: '',
    trim: true
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  lastSeenAt: {
    type: Date,
    default: null
  },
  lastIp: {
    type: String,
    default: ''
  },
  revokedAt: {
    type: Date,
    default: null
  },
  revokedBy: {
    trackId: { type: String, default: '' },
    name: { type: String, default: '' }
  },
  revokeReason: {
    type: String,
    default: ''
  },
  replacedBy: {
    type: String,
    default: '',
    trim: true
  }
}, { timestamps: true });

// Partial unique indexes enforcing one active device per student and one student per browser install
StudentDeviceSchema.index(
  { studentId: 1 },
  { unique: true, partialFilterExpression: { status: 'TRUSTED' } }
);

StudentDeviceSchema.index(
  { installId: 1 },
  { unique: true, partialFilterExpression: { status: 'TRUSTED' } }
);

StudentDeviceSchema.index({ keyThumbprint: 1 });
StudentDeviceSchema.index({ fingerprintHash: 1, status: 1 });
StudentDeviceSchema.index({ deptId: 1, status: 1 });
StudentDeviceSchema.index({ classId: 1, status: 1 });

module.exports = {
  StudentDevice: mongoose.model('StudentDevice', StudentDeviceSchema),
};
