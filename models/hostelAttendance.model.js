const mongoose = require('mongoose');

// ── 1. RollCall (Nightly roll-call session per block) ─────────────────────────
const RollCallSchema = new mongoose.Schema({
  date: { type: String, required: true, trim: true }, // 'YYYY-MM-DD'
  blockId: { type: mongoose.Schema.Types.ObjectId, ref: 'Block', required: true },
  opensAt: { type: String, default: '21:00' }, // HH:mm
  closesAt: { type: String, default: '21:45' }, // HH:mm
  verifyBy: { type: String, default: '22:15' }, // HH:mm
  status: { type: String, enum: ['scheduled', 'open', 'closed', 'verified'], default: 'scheduled' },
  openedBy: { type: String, default: null, trim: true }, // Warden trackId
  openedAt: { type: Date, default: null },
  closedBy: { type: String, default: null, trim: true },
  closedAt: { type: Date, default: null },
  verifiedBy: { type: String, default: null, trim: true },
  verifiedAt: { type: Date, default: null },
  qrSecret: { type: String, required: true }, // Secret seed for HMAC 15s rotating tokens; server-side only
  spotCheckList: { type: [String], default: [] }, // Array of studentTrackIds selected for random spot-check
  counts: {
    total: { type: Number, default: 0 },
    present: { type: Number, default: 0 },
    late: { type: Number, default: 0 },
    leave: { type: Number, default: 0 },
    medical: { type: Number, default: 0 },
    excused: { type: Number, default: 0 },
    absent: { type: Number, default: 0 },
    unmarked: { type: Number, default: 0 },
  },
}, { timestamps: true });

RollCallSchema.index({ date: 1, blockId: 1 }, { unique: true });
RollCallSchema.index({ status: 1 });

// ── 2. HostelAttendance (Resident roll-call record) ───────────────────────────
const AttendanceHistorySchema = new mongoose.Schema({
  prevStatus: { type: String, required: true },
  newStatus: { type: String, required: true },
  method: { type: String, required: true },
  by: { type: String, required: true },
  at: { type: Date, default: Date.now },
  note: { type: String, default: '' },
}, { _id: false });

const HostelAttendanceSchema = new mongoose.Schema({
  rollCallId: { type: mongoose.Schema.Types.ObjectId, ref: 'RollCall', required: true },
  date: { type: String, required: true, trim: true }, // 'YYYY-MM-DD'
  blockId: { type: mongoose.Schema.Types.ObjectId, ref: 'Block', required: true },
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'HostelRoom', default: null },
  studentTrackId: { type: String, required: true, trim: true },
  status: {
    type: String,
    enum: [
      'Present',
      'Late',
      'On leave',
      'Overdue',
      'Medical',
      'Excused',
      'Absent (unverified)',
      'Absent (confirmed)',
    ],
    default: 'Absent (unverified)',
  },
  method: {
    type: String,
    enum: ['qr', 'warden', 'auto-leave', 'auto-medical', 'auto-od', 'system'],
    default: 'system',
  },
  markedBy: { type: String, default: 'system', trim: true },
  markedAt: { type: Date, default: Date.now },
  lateMinutes: { type: Number, default: 0 },
  note: { type: String, default: '', trim: true },
  locked: { type: Boolean, default: false }, // true for auto-leave / medical / OD
  isSpotCheck: { type: Boolean, default: false },
  spotCheckVerified: { type: Boolean, default: false },
  parentCall: {
    status: { type: String, enum: ['none', 'pending', 'consent', 'refused', 'unreachable'], default: 'none' },
    number: { type: String, default: '' },
    calledAt: { type: Date, default: null },
    by: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  history: { type: [AttendanceHistorySchema], default: [] },
}, { timestamps: true });

HostelAttendanceSchema.index({ studentTrackId: 1, date: 1 }, { unique: true });
HostelAttendanceSchema.index({ rollCallId: 1, status: 1 });
HostelAttendanceSchema.index({ blockId: 1, date: 1 });

module.exports = {
  RollCall: mongoose.model('RollCall', RollCallSchema),
  HostelAttendance: mongoose.model('HostelAttendance', HostelAttendanceSchema),
};
