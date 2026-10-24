const mongoose = require('mongoose');

const MovementEventSchema = new mongoose.Schema({
  studentTrackId: { type: String, required: true, trim: true },
  leaveId: { type: mongoose.Schema.Types.ObjectId, ref: 'HostelLeave', required: true },
  direction: { type: String, enum: ['out', 'back'], required: true },
  at: { type: Date, default: Date.now },
  geo: { type: String, enum: ['ok', 'outside', 'denied'], default: 'ok' },
  late: { type: Boolean, default: false },
  lateMinutes: { type: Number, default: 0 },
  deviceId: { type: String, default: '', trim: true },
}, { timestamps: true });

MovementEventSchema.index({ studentTrackId: 1, at: -1 });
MovementEventSchema.index({ leaveId: 1 });

module.exports = {
  MovementEvent: mongoose.model('MovementEvent', MovementEventSchema),
};
