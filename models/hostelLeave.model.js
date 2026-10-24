const mongoose = require('mongoose');

const ParentCallSchema = new mongoose.Schema({
  status: { type: String, enum: ['pending', 'consent', 'refused', 'unreachable'], default: 'pending' },
  number: { type: String, default: '', trim: true },
  calledAt: { type: Date, default: null },
  by: { type: String, default: null, trim: true }, // Warden trackId
  note: { type: String, default: '', trim: true },
}, { _id: false });

const HostelLeaveSchema = new mongoose.Schema({
  studentTrackId: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ['outing', 'home', 'medical', 'od', 'emergency'],
    required: true,
  },
  from: { type: Date, required: true },
  to: { type: Date, required: true },
  destination: { type: String, required: true, trim: true },
  reason: { type: String, required: true, trim: true },
  autoApproved: { type: Boolean, default: false },
  parentCall: { type: ParentCallSchema, default: () => ({ status: 'pending' }) },
  academicLeaveId: { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveRequest', default: null },
  odRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ODRequest', default: null },
  status: {
    type: String,
    enum: [
      'pending_parent_call',
      'pending_warden',
      'pending_advisor',
      'approved',
      'rejected',
      'cancelled',
      'out',
      'returned',
      'overdue',
    ],
    default: 'pending_warden',
  },
  decidedBy: { type: String, default: null, trim: true },
  decidedAt: { type: Date, default: null },
  decisionNote: { type: String, default: '', trim: true },
  actualOut: { type: Date, default: null },
  actualBack: { type: Date, default: null },
  isLate: { type: Boolean, default: false },
  lateMinutes: { type: Number, default: 0 },
}, { timestamps: true });

HostelLeaveSchema.index({ studentTrackId: 1, status: 1 });
HostelLeaveSchema.index({ from: 1, to: 1 });
HostelLeaveSchema.index({ status: 1 });

module.exports = {
  HostelLeave: mongoose.model('HostelLeave', HostelLeaveSchema),
};
