const mongoose = require('mongoose');

const AlertSchema = new mongoose.Schema({
  alertKey: {
    type: String,
    required: true,
    unique: true
  },
  ruleId: {
    type: String,
    enum: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  severity: {
    type: String,
    enum: ['critical', 'warning', 'info'],
    default: 'warning'
  },
  deptCode: {
    type: String,
    default: null,
    index: true
  },
  classId: {
    type: String,
    default: null
  },
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ClassSession',
    default: null
  },
  audience: [{
    type: String,
    enum: ['teacher', 'hod', 'principal', 'advisor', 'warden', 'ttc']
  }],
  status: {
    type: String,
    enum: ['active', 'acknowledged', 'snoozed', 'resolved'],
    default: 'active',
    index: true
  },
  acknowledgedBy: {
    trackId: String,
    name:    String,
    at:      Date
  },
  snoozedUntil: {
    type: Date,
    default: null
  },
  resolvedAt: {
    type: Date,
    default: null
  },
  autoResolved: {
    type: Boolean,
    default: false
  },
  context: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

AlertSchema.index({ status: 1, severity: 1, createdAt: -1 });
AlertSchema.index({ deptCode: 1, status: 1 });

module.exports = {
  Alert: mongoose.model('Alert', AlertSchema)
};
