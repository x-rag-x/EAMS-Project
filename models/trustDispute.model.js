const mongoose = require('mongoose');

/**
 * models/trustDispute.model.js
 *
 * Trust and Attendance Dispute Schema (§12, T6.1)
 * Records student disputes with auto-attached frozen evidence snapshot,
 * teacher statement, advisor review, and department admin decisions.
 */

const TrustDisputeSchema = new mongoose.Schema({
  disputeTrackId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    default: function () {
      return 'DISP-' + Math.random().toString(36).substring(2, 8).toUpperCase() + Date.now().toString(36).toUpperCase();
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
  studentName: { type: String, default: '' },
  regNo: { type: String, default: '' },
  deptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true,
    index: true
  },
  deptCode: { type: String, default: '' },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    index: true
  },
  className: { type: String, default: '' },

  // The disputed trust event
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TrustEvent',
    default: null,
    index: true
  },
  eventTrackId: { type: String, default: '' },
  eventRefKey: { type: String, default: '' },
  eventType: { type: String, default: '' },
  pointsDeducted: { type: Number, default: 0 },
  eventDate: { type: Date, default: null },

  // Student statement
  reason: {
    type: String,
    required: true,
    trim: true
  },

  // Lifecycle status
  status: {
    type: String,
    enum: [
      'PENDING_TEACHER',     // Waiting for teacher statement (optional 48 h)
      'PENDING_ADVISOR',     // Forwarded to Class Advisor
      'PENDING_ADMIN',       // Supported by advisor, waiting for Dept Super Admin / Sudo
      'ACCEPTED',            // Admin accepted, auto-corrections applied
      'REJECTED_BY_ADVISOR', // Advisor rejected
      'REJECTED_BY_ADMIN',   // Super Admin / Sudo rejected
      'WITHDRAWN'            // Student withdrew
    ],
    default: 'PENDING_TEACHER',
    index: true
  },

  // Frozen Evidence Snapshot (§12)
  evidenceSnapshot: {
    attendanceSession: { type: mongoose.Schema.Types.Mixed, default: null },
    teacherVerification: { type: mongoose.Schema.Types.Mixed, default: null },
    deviceSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    trustBefore: { type: Number, default: 100 },
    trustAfter: { type: Number, default: 100 },
    riskReasons: { type: [String], default: [] },
    originalTrustEvent: { type: mongoose.Schema.Types.Mixed, default: null },
    frozenAt: { type: Date, default: Date.now }
  },

  // Teacher involved & optional 48h statement
  teacherInvolved: {
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    teacherTrackId: { type: String, default: '' },
    teacherName: { type: String, default: '' },
    statement: { type: String, default: '' },
    submittedAt: { type: Date, default: null },
    deadline: { type: Date, default: null }
  },

  // Class Advisor review
  advisorReview: {
    advisorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    advisorTrackId: { type: String, default: '' },
    advisorName: { type: String, default: '' },
    action: { type: String, enum: ['SUPPORT', 'REJECT', null], default: null },
    note: { type: String, default: '' },
    reviewedAt: { type: Date, default: null }
  },

  // Department Super Admin / Sudo decision
  adminDecision: {
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedByName: { type: String, default: '' },
    decidedByRole: { type: String, default: '' },
    decision: { type: String, enum: ['ACCEPT', 'REJECT', null], default: null },
    note: { type: String, default: '' },
    newTrustScoreSet: { type: Number, default: null },
    decidedAt: { type: Date, default: null }
  },

  // Automatic correction transaction results (§12)
  resolution: {
    attendanceCorrected: { type: Boolean, default: false },
    trustPointsRestored: { type: Number, default: 0 },
    correctionEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'TrustEvent', default: null },
    lockRemoved: { type: Boolean, default: false },
    adjustmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AttendanceAdjustment', default: null },
    adjustmentPct: { type: Number, default: 0 },
    grievanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Grievance', default: null },
    resolvedAt: { type: Date, default: null }
  }
}, { timestamps: true });

TrustDisputeSchema.index({ studentId: 1, eventId: 1 });
TrustDisputeSchema.index({ deptId: 1, status: 1 });
TrustDisputeSchema.index({ classId: 1, status: 1 });
TrustDisputeSchema.index({ createdAt: -1 });

module.exports = {
  TrustDispute: mongoose.model('TrustDispute', TrustDisputeSchema)
};
