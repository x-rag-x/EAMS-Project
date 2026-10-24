const mongoose = require('mongoose');

const LiveSessionsAttSchema = new mongoose.Schema({
  sessionTrackId: { type: String, required: true, index: true },
  liveSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveSession' },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  studentTrackId: { type: String, required: true, index: true },
  studentName: { type: String, default: '' },
  regNo: { type: String, default: '' },

  // QR tracking details
  qrTrackId: { type: String, required: true },
  qrWindowIndex: { type: Number },
  qrWindowType: { type: String, enum: ['current', 'grace', 'expired', 'invalid'], default: 'current' },
  qrDetails: {
    scannedQrId: { type: String },
    currentQrId: { type: String },
    previousQrId: { type: String },
    windowAgeSec: { type: Number },
    inGracePeriod: { type: Boolean, default: false },
  },

  markedAt: { type: Date, default: Date.now },
  loginTime: { type: Date },

  // Location signals
  latitude: { type: Number },
  longitude: { type: Number },
  locationAccuracy: { type: Number },
  ipAddress: { type: String, default: '' },

  // Device & session binding
  deviceId: { type: String, default: '' },
  deviceSessionId: { type: String, default: '' },
  userAgent: { type: String, default: '' },

  // Verification status
  status: {
    type: String,
    enum: ['pending', 'completed'],
    default: 'pending',
    index: true,
  },
  verificationCompletedAt: { type: Date },
  verificationDetails: {
    authOk: { type: Boolean, default: false },
    sessionOk: { type: Boolean, default: false },
    qrOk: { type: Boolean, default: false },
    expiryOk: { type: Boolean, default: false },
    deviceOk: { type: Boolean, default: false },
    deviceRegisteredOk: { type: Boolean, default: false },
    trustOk: { type: Boolean, default: false },
    riskOk: { type: Boolean, default: false },
    duplicateOk: { type: Boolean, default: false },
    locationOk: { type: Boolean, default: false },
    failReason: { type: String, default: '' }
  },

  // Security & Trust Score snapshot (§4, §7) - frozen at mark time
  security: {
    deviceTrackId: { type: String, default: '' },
    deviceProofOk: { type: Boolean, default: false },
    trustScoreAtMark: { type: Number, default: 100 },
    deviceScoreAtMark: { type: Number, default: 0 },
    combinedScoreAtMark: { type: Number, default: 50 },
    riskLevelAtMark: { type: String, enum: ['low', 'medium', 'high', 'very_high'], default: 'low' },
    riskReasons: { type: [String], default: [] },
    teacherVerification: {
      required: { type: Boolean, default: false },
      result: { type: String, default: null }, // 'present' | 'not_in_class' | null
      by: { type: String, default: null },
      at: { type: Date, default: null }
    }
  }
}, { timestamps: true });

// Prevent duplicate participation record per student per live session
LiveSessionsAttSchema.index({ sessionTrackId: 1, studentId: 1 }, { unique: true });
LiveSessionsAttSchema.index({ sessionTrackId: 1, studentTrackId: 1 });
LiveSessionsAttSchema.index({ sessionTrackId: 1, status: 1 });

module.exports = {
  LiveSessionsAtt: mongoose.model('LiveSessionsAtt', LiveSessionsAttSchema),
};
