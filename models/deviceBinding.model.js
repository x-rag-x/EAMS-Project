const mongoose = require('mongoose');

const DeviceBindingSchema = new mongoose.Schema({
  studentTrackId: { type: String, required: true, trim: true },
  deviceId: { type: String, required: true, trim: true },
  label: { type: String, default: 'Mobile Device', trim: true },
  boundAt: { type: Date, default: Date.now },
  approvedBy: { type: String, default: null, trim: true }, // Warden trackId
  active: { type: Boolean, default: true },
}, { timestamps: true });

DeviceBindingSchema.index({ studentTrackId: 1, active: 1 });
DeviceBindingSchema.index({ deviceId: 1 });

module.exports = {
  DeviceBinding: mongoose.model('DeviceBinding', DeviceBindingSchema),
};
