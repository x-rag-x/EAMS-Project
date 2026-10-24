const mongoose = require('mongoose');

const FacultyLeavePolicySchema = new mongoose.Schema({
  deptCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },
  deptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null
  },
  allowances: {
    casualLeave: { type: Number, default: 12, min: 0 },
    medicalLeave: { type: Number, default: 10, min: 0 },
    earnedLeave: { type: Number, default: 15, min: 0 }
  },
  annualLeaveQuota: {
    type: Number,
    default: 15,
    min: 0
  },
  carryForwardEarned: {
    type: Boolean,
    default: true
  },
  medicalDocThresholdDays: {
    type: Number,
    default: 3,
    min: 1
  },
  maxConsecutiveLeaveDays: {
    type: Number,
    default: 3,
    min: 1
  },
  requireSubstitution: {
    type: Boolean,
    default: true
  },
  allowPeriodLeave: {
    type: Boolean,
    default: true
  },
  autoEscalatePrincipal: {
    type: Boolean,
    default: false
  },
  revision: {
    type: Number,
    default: 1
  },
  revisedBy: {
    trackId: { type: String, default: '' },
    name: { type: String, default: '' },
    role: { type: String, default: '' }
  },
  revisedAt: {
    type: Date,
    default: Date.now
  },
  history: [{
    revision: Number,
    annualLeaveQuota: Number,
    allowances: {
      casualLeave: Number,
      medicalLeave: Number,
      earnedLeave: Number
    },
    carryForwardEarned: Boolean,
    medicalDocThresholdDays: Number,
    maxConsecutiveLeaveDays: Number,
    requireSubstitution: Boolean,
    allowPeriodLeave: Boolean,
    autoEscalatePrincipal: Boolean,
    revisedBy: {
      trackId: String,
      name: String,
      role: String
    },
    revisedAt: { type: Date, default: Date.now },
    reason: { type: String, default: '' }
  }]
}, { timestamps: true });

const FacultyLeavePolicyModel = mongoose.models.FacultyLeavePolicy || mongoose.model('FacultyLeavePolicy', FacultyLeavePolicySchema);

module.exports = {
  FacultyLeavePolicy: FacultyLeavePolicyModel
};
