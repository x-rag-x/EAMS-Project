const mongoose = require('mongoose');

/**
 * models/attendanceAdjustment.model.js
 *
 * Attendance percentage adjustment model (§12, §13, T-D6)
 * Stores visible percentage deltas (e.g. +2% for accepted dispute, -5% for friend-marking penalty)
 * without corrupting raw attendance records. Affects eligibility/75% calculations.
 */

const AttendanceAdjustmentSchema = new mongoose.Schema({
  adjustmentTrackId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    default: function () {
      return 'ADJ-' + Math.random().toString(36).substring(2, 8).toUpperCase() + Date.now().toString(36).toUpperCase();
    }
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
  semester: {
    type: Number,
    required: true
  },
  academicYear: {
    type: String,
    default: ''
  },
  deltaPct: {
    type: Number,
    required: true // e.g. +2 for dispute bonus, -5 for friend-marking penalty
  },
  kind: {
    type: String,
    enum: ['DISPUTE_BONUS', 'DEVICE_SHARE_PENALTY', 'ADMIN_MANUAL'],
    required: true
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  refDisputeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TrustDispute',
    default: null
  },
  refCaseId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  appliedBy: {
    type: String,
    required: true
  },
  appliedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

AttendanceAdjustmentSchema.index({ studentId: 1, semester: 1, kind: 1 });
AttendanceAdjustmentSchema.index({ studentTrackId: 1, createdAt: -1 });

module.exports = {
  AttendanceAdjustment: mongoose.model('AttendanceAdjustment', AttendanceAdjustmentSchema)
};
