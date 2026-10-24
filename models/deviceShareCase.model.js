const mongoose = require('mongoose');

/**
 * models/deviceShareCase.model.js
 *
 * Anti-proxy and Friend-marking Detection Case Schema (§13, T7.2)
 * Opened automatically when one phone/browser is shared across multiple students
 * (detected at device registration or live attendance).
 */

const DeviceShareCaseSchema = new mongoose.Schema({
  caseId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    default: function () {
      return 'DSC-' + Math.random().toString(36).substring(2, 8).toUpperCase() + Date.now().toString(36).toUpperCase();
    }
  },
  students: [{
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    studentTrackId: { type: String, required: true },
    studentName: { type: String, default: '' },
    regNo: { type: String, default: '' },
    deptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    className: { type: String, default: '' }
  }],
  deptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true,
    index: true
  },
  detectedAt: {
    type: Date,
    default: Date.now
  },
  detectionSource: {
    type: String,
    enum: ['REGISTRATION', 'ATTENDANCE'],
    required: true
  },
  signals: {
    installId: { type: String, default: '' },
    keyThumbprint: { type: String, default: '' },
    fingerprint: { type: String, default: '' },
    ip: { type: String, default: '' },
    sessionTrackId: { type: String, default: '' },
    details: { type: String, default: '' }
  },
  status: {
    type: String,
    enum: ['OPEN', 'CONFIRMED', 'DISMISSED'],
    default: 'OPEN',
    index: true
  },
  decision: {
    decidedBy: {
      trackId: { type: String, default: '' },
      name: { type: String, default: '' },
      role: { type: String, default: '' }
    },
    note: { type: String, default: '' },
    decidedAt: { type: Date, default: null }
  },
  actionsApplied: {
    marksTurnedAbsent: { type: Number, default: 0 },
    lockedDays: { type: Number, default: 0 },
    penaltyPct: { type: Number, default: 0 },
    appliedAt: { type: Date, default: null }
  }
}, { timestamps: true });

DeviceShareCaseSchema.index({ deptId: 1, status: 1 });
DeviceShareCaseSchema.index({ 'students.studentId': 1, status: 1 });
DeviceShareCaseSchema.index({ createdAt: -1 });

module.exports = {
  DeviceShareCase: mongoose.model('DeviceShareCase', DeviceShareCaseSchema)
};
