const mongoose = require('mongoose');

const ActingRoleSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['advisor', 'hod'],
    required: true
  },
  key: {
    type: String,
    required: true // classId for advisor, deptCode for HOD
  },
  holderTrackId: {
    type: String,
    required: true,
    index: true
  },
  appointedBy: {
    type: String,
    required: true
  },
  from: {
    type: String,
    required: true // YYYY-MM-DD (IST)
  },
  to: {
    type: String,
    required: true // YYYY-MM-DD (IST)
  },
  sourceLeaveId: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'ended', 'cancelled'],
    default: 'pending'
  }
}, { timestamps: true });

ActingRoleSchema.index({ holderTrackId: 1, status: 1 });
ActingRoleSchema.index({ role: 1, key: 1, from: 1, to: 1, status: 1 });

module.exports = {
  ActingRole: mongoose.model('ActingRole', ActingRoleSchema)
};
