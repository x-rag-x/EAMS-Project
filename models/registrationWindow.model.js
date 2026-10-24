const mongoose = require('mongoose');

/**
 * RegistrationWindow Schema (§4, T1.1)
 *
 * Controls time-boxed windows during which Class Advisors can generate device registration tickets.
 * Created per department or per class by Super Admin or Sudo Admin.
 */
const RegistrationWindowSchema = new mongoose.Schema({
  windowTrackId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  scope: {
    type: String,
    enum: ['department', 'class'],
    required: true,
    index: true
  },
  deptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
    index: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    default: null,
    index: true
  },
  from: {
    type: Date,
    required: true
  },
  to: {
    type: Date,
    required: true
  },
  createdBy: {
    trackId: { type: String, default: '' },
    name: { type: String, default: '' }
  },
  note: {
    type: String,
    default: '',
    trim: true
  },
  active: {
    type: Boolean,
    default: true,
    index: true
  }
}, { timestamps: true });

RegistrationWindowSchema.index({ deptId: 1, from: 1, to: 1 });
RegistrationWindowSchema.index({ classId: 1, from: 1, to: 1 });

module.exports = {
  RegistrationWindow: mongoose.model('RegistrationWindow', RegistrationWindowSchema),
};
