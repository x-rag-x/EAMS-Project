const mongoose = require('mongoose');

/**
 * RoleAssignment Model (§4.5, R4.1)
 * Persistent record of all assigned executive roles and responsibilities.
 * Rows are never deleted: ending a role sets active: false, to: Date, and unsets slotKey/holderKey.
 */
const RoleAssignmentSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: [
      'principal',
      'hod',
      'superAdmin',
      'ttCoordinator',
      'placementCoordinator',
      'classAdvisor',
      'warden',
      'sudoAdmin'
    ],
    required: true,
    trim: true
  },
  scopeType: {
    type: String,
    enum: ['institution', 'department', 'class', 'block'],
    required: true
  },
  scopeId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  deptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    required: true
  },
  teacherTrackId: {
    type: String,
    required: true,
    trim: true
  },
  teacherName: {
    type: String,
    required: true,
    trim: true
  },
  active: {
    type: Boolean,
    default: true,
    index: true
  },
  from: {
    type: Date,
    default: Date.now
  },
  to: {
    type: Date,
    default: null
  },
  slotKey: {
    type: String,
    trim: true
  },
  holderKey: {
    type: String,
    trim: true
  },
  assignedBy: {
    trackId: { type: String, default: '', trim: true },
    name:    { type: String, default: '', trim: true }
  },
  endedBy: {
    trackId: { type: String, default: '', trim: true },
    name:    { type: String, default: '', trim: true }
  },
  endReason: {
    type: String,
    default: '',
    trim: true
  },
  replacedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    default: null
  }
}, { timestamps: true });

// Sparse unique indexes to guarantee single-holder invariant per slot and per holder
RoleAssignmentSchema.index({ slotKey: 1 }, { unique: true, sparse: true });
RoleAssignmentSchema.index({ holderKey: 1 }, { unique: true, sparse: true });

// Query indexes
RoleAssignmentSchema.index({ teacherId: 1, active: 1 });
RoleAssignmentSchema.index({ deptId: 1, role: 1, active: 1 });
RoleAssignmentSchema.index({ role: 1, active: 1 });
RoleAssignmentSchema.index({ from: -1 });

module.exports = {
  RoleAssignment: mongoose.model('RoleAssignment', RoleAssignmentSchema)
};
