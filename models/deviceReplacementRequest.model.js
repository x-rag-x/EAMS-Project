const mongoose = require('mongoose');

/**
 * DeviceReplacementRequest Schema (§14, §16, T5.3, T7.4)
 *
 * Tracks student requests for device replacement (lost, repaired, reset, new phone)
 * and advisor outside-window requests routed to Department Super Admin.
 */
const DeviceReplacementRequestSchema = new mongoose.Schema({
  requestId: {
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
    required: true,
    index: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['replacement', 'outside_window'],
    default: 'replacement',
    index: true
  },
  reason: {
    type: String,
    enum: ['lost', 'repaired', 'reset', 'new_phone', 'outside_window', 'other'],
    default: 'new_phone'
  },
  note: {
    type: String,
    trim: true,
    default: ''
  },
  status: {
    type: String,
    enum: ['PENDING_ADVISOR', 'FORWARDED_TO_ADMIN', 'APPROVED', 'REJECTED'],
    default: 'PENDING_ADVISOR',
    index: true
  },
  reviewedByAdvisor: {
    trackId: { type: String, default: '' },
    name: { type: String, default: '' },
    at: { type: Date, default: null },
    note: { type: String, default: '' }
  },
  reviewedByAdmin: {
    trackId: { type: String, default: '' },
    name: { type: String, default: '' },
    at: { type: Date, default: null },
    note: { type: String, default: '' }
  },
  ticketId: {
    type: String,
    default: '',
    trim: true
  }
}, {
  timestamps: true
});

DeviceReplacementRequestSchema.index({ deptId: 1, status: 1 });
DeviceReplacementRequestSchema.index({ classId: 1, status: 1 });
DeviceReplacementRequestSchema.index({ studentId: 1, status: 1 });

const DeviceReplacementRequest = mongoose.models.DeviceReplacementRequest ||
  mongoose.model('DeviceReplacementRequest', DeviceReplacementRequestSchema);

module.exports = {
  DeviceReplacementRequest,
  DeviceReplacementRequestSchema
};
