const mongoose = require('mongoose');

/**
 * LoginSession Schema (§3.10, Phase S7)
 * Standalone collection for high-throughput session management.
 * Replaces embedded array scans in LoginHistory with direct O(1) indexed lookups.
 */
const LoginSessionSchema = new mongoose.Schema({
  trackId:         { type: String, required: true, trim: true, index: true },
  username:        { type: String, trim: true, lowercase: true, index: true },
  sessionId:       { type: String, required: true, unique: true },
  role:            { type: String, enum: ['student', 'teacher', 'admin', 'board'], required: true },
  identityType:    { type: String, enum: ['human', 'board'], default: 'human' },
  sessionClass:    { type: String, enum: ['staff', 'student', 'student-device', 'board'], default: 'staff' },
  deviceTrackId:   { type: String, default: '' },
  deviceId:        { type: String, default: '' },
  deviceInstallId: { type: String, default: '' },
  deviceName:      { type: String, default: '' },
  deviceInfo:      { type: mongoose.Schema.Types.Mixed, default: null },
  ip:              { type: String, default: '' },
  ua:              { type: String, default: '' },
  userAgent:       { type: String, default: '' },
  location: {
    latitude:  { type: Number, default: null },
    longitude: { type: Number, default: null },
    accuracy:  { type: Number, default: null },
    address:   { type: String, default: '' },
  },
  createdAt:    { type: Date, default: Date.now },
  loginTime:    { type: Date, default: Date.now },
  lastActivity: { type: Date, default: Date.now, index: true },
  expiresAt:    { type: Date, required: true },
  active:       { type: Boolean, default: true, index: true },
  logoutAt:     { type: Date, default: null },
  logoutMethod: { type: String, enum: ['manual', 'auto', 'forced', 'admin_reset', 'unknown_report', null], default: null },
  refreshHash:  { type: String, default: null },
  authToken:    { type: String, default: null },
}, { timestamps: true });

// Compound indexes for session queries and monitor sweeps
LoginSessionSchema.index({ trackId: 1, active: 1 });
LoginSessionSchema.index({ username: 1, active: 1 });
LoginSessionSchema.index({ active: 1, role: 1, lastActivity: 1 });

// TTL index: Mongo automatically removes expired session documents after expiresAt
LoginSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const LoginSession = mongoose.model('LoginSession', LoginSessionSchema);

module.exports = {
  LoginSession,
  ActiveSession: LoginSession,
};
