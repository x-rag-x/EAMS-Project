const mongoose = require('mongoose');

/**
 * SecurityBlock Model
 *
 * Multi-dimensional security blocking for login abuse prevention.
 * Supports blocking by: account, device, IP, and account+device combo.
 *
 * Uses MongoDB TTL index on `expiresAt` for automatic document expiry.
 */
const SecurityBlockSchema = new mongoose.Schema({
  blockType: {
    type: String,
    enum: ['account', 'device', 'ip', 'account_device'],
    required: true,
  },
  identifier: { type: String, required: true },       // Composite key for the block scope
  username:   { type: String, default: '', trim: true, lowercase: true },
  deviceId:   { type: String, default: '' },
  ip:         { type: String, default: '' },
  reason:     { type: String, default: 'Too many failed login attempts' },
  failedCount:{ type: Number, default: 0 },
  blockedAt:  { type: Date, default: Date.now },
  expiresAt:  { type: Date, required: true },
  active:     { type: Boolean, default: true },
  createdBy:  { type: String, default: 'system' },
}, { timestamps: true });

// Compound index for fast block lookups
SecurityBlockSchema.index({ blockType: 1, identifier: 1, active: 1 });
// TTL index: MongoDB automatically removes expired documents
SecurityBlockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Quick lookup by username or IP for admin monitoring
SecurityBlockSchema.index({ username: 1, active: 1 });
SecurityBlockSchema.index({ ip: 1, active: 1 });

module.exports = {
  SecurityBlock: mongoose.model('SecurityBlock', SecurityBlockSchema),
};
