const mongoose = require('mongoose');

/**
 * AccessRequest Model (§4.6, §10, R7.1)
 * Formal approval workflow for sub-admin privileges requested by Super Admins or Staff.
 */
const GrantItemSchema = new mongoose.Schema({
  grantId:   { type: String, trim: true },
  page:      { type: String, required: true, trim: true },
  scope:     { type: String, enum: ['institution', 'department', 'class'], default: 'department' },
  deptId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  deptName:  { type: String, default: '', trim: true },
  actions:   { type: [String], default: ['view'] },
  tabs:      { type: [String], default: [] },
  validFrom: { type: Date, default: Date.now },
  validTo:   { type: Date, required: true },
  enabled:   { type: Boolean, default: true }
}, { _id: true });

const AccessRequestSchema = new mongoose.Schema({
  requestId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  forTeacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    required: true,
    index: true
  },
  forTeacherTrackId: {
    type: String,
    required: true,
    trim: true
  },
  forTeacherName: {
    type: String,
    required: true,
    trim: true
  },
  deptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
    index: true
  },
  deptName: {
    type: String,
    default: '',
    trim: true
  },
  requestedBy: {
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    trackId:   { type: String, required: true, trim: true },
    name:      { type: String, required: true, trim: true },
    role:      { type: String, enum: ['superAdmin', 'sudoAdmin', 'teacher'], default: 'teacher' }
  },
  pages: {
    type: [String],
    default: []
  },
  grants: {
    type: [GrantItemSchema],
    default: []
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  hodApproval: {
    status: {
      type: String,
      enum: ['pending', 'approved', 'denied', 'skipped'],
      default: 'pending'
    },
    decidedBy: {
      teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null },
      trackId:   { type: String, default: '', trim: true },
      name:      { type: String, default: '', trim: true }
    },
    decidedAt: {
      type: Date,
      default: null
    },
    decisionNote: {
      type: String,
      default: '',
      trim: true
    }
  },
  status: {
    type: String,
    enum: ['pending', 'pending_hod', 'pending_sudo', 'approved', 'approved_with_changes', 'denied', 'denied_by_hod', 'withdrawn', 'expired'],
    default: 'pending_hod',
    index: true
  },
  decidedBy: {
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null },
    trackId:   { type: String, default: '', trim: true },
    name:      { type: String, default: '', trim: true }
  },
  decidedAt: {
    type: Date,
    default: null
  },
  decisionNote: {
    type: String,
    default: '',
    trim: true
  },
  approvedGrants: {
    type: [GrantItemSchema],
    default: []
  }
}, { timestamps: true });

// Query indexes
AccessRequestSchema.index({ status: 1, createdAt: -1 });
AccessRequestSchema.index({ deptId: 1, status: 1 });
AccessRequestSchema.index({ 'hodApproval.status': 1 });
AccessRequestSchema.index({ deptId: 1, 'hodApproval.status': 1 });
AccessRequestSchema.index({ 'requestedBy.trackId': 1, status: 1 });
AccessRequestSchema.index({ forTeacherId: 1, status: 1 });

const AccessRequest = mongoose.model('AccessRequest', AccessRequestSchema);

module.exports = {
  AccessRequest
};
