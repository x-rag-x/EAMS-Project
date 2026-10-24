const mongoose = require('mongoose');

const AttendanceEntitlementSchema = new mongoose.Schema({
  studentTrackId: {
    type: String,
    required: true,
    index: true
  },
  classId: {
    type: String,
    required: true,
    index: true
  },
  date: {
    type: String,
    required: true, // YYYY-MM-DD (IST)
    index: true
  },
  periodNumbers: {
    type: [Number],
    default: [] // Empty means all periods for the date
  },
  countsAs: {
    type: String,
    enum: ['present', 'absent'],
    required: true
  },
  reason: {
    type: String,
    enum: ['od', 'leave'],
    required: true
  },
  locked: {
    type: Boolean,
    default: true
  },
  pending: {
    type: Boolean,
    default: false
  },
  sourceType: {
    type: String,
    enum: ['OD_REQUEST', 'LEAVE_REQUEST', 'HOSTEL_LEAVE'],
    required: true
  },
  sourceId: {
    type: String,
    required: true
  },
  label: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['active', 'cancelled', 'rejected'],
    default: 'active'
  }
}, { timestamps: true });

AttendanceEntitlementSchema.index({ classId: 1, date: 1, status: 1 });
AttendanceEntitlementSchema.index({ studentTrackId: 1, date: 1, status: 1 });
AttendanceEntitlementSchema.index({ sourceId: 1 });
AttendanceEntitlementSchema.index({ studentTrackId: 1, sourceId: 1, date: 1 });

module.exports = {
  AttendanceEntitlement: mongoose.model('AttendanceEntitlement', AttendanceEntitlementSchema)
};
