const mongoose = require('mongoose');

const ApprovalHistorySchema = new mongoose.Schema({
  requestId: {
    type: String,
    required: true,
    index: true
  },
  requestType: {
    type: String,
    enum: ['student_leave', 'od', 'faculty_leave', 'hostel_leave', 'substitution'],
    required: true
  },
  actorId: {
    type: String,
    required: true
  },
  actorName: {
    type: String,
    default: ''
  },
  actorRole: {
    type: String,
    required: true // 'student' | 'advisor' | 'mentor' | 'hod' | 'principal' | 'warden' | 'system'
  },
  acting: {
    type: Boolean,
    default: false
  },
  action: {
    type: String,
    required: true // 'submit' | 'permit' | 'approve' | 'reject' | 'return' | 'cancel' | 'verify' | 'override' | 'escalate' | 'remind'
  },
  comment: {
    type: String,
    default: ''
  },
  previousState: {
    type: String,
    default: null
  },
  newState: {
    type: String,
    default: null
  },
  requestVersion: {
    type: Number,
    default: 1
  },
  at: {
    type: Date,
    default: Date.now
  },
  ip: {
    type: String,
    default: ''
  }
}, { timestamps: true });

ApprovalHistorySchema.index({ requestId: 1, at: 1 });
ApprovalHistorySchema.index({ actorId: 1, at: -1 });

module.exports = {
  ApprovalHistory: mongoose.model('ApprovalHistory', ApprovalHistorySchema)
};
