const mongoose = require('mongoose');

/**
 * Password Model (Unified Credential Store)
 *
 * Stores hashed credentials for all human identities (students, teachers, admins)
 * in a dedicated collection. Decouples credential authentication from domain models.
 */
const PasswordSchema = new mongoose.Schema({
  trackId: {
    type: String,
    required: true,
    unique: true,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  hash: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'reset-required'],
    default: 'active',
  },
  mustChangePassword: {
    type: Boolean,
    default: false,
  },
  passwordChangedAt: {
    type: Date,
    default: Date.now,
  },
  passwordHistory: [{
    hash: { type: String, required: true },
    changedAt: { type: Date, default: Date.now },
  }],
  migratedFrom: {
    type: String,
    enum: ['admin', 'teacher', 'student', null],
    default: null,
  },
  migratedAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

PasswordSchema.index({ status: 1 });

module.exports = {
  Password: mongoose.model('Password', PasswordSchema),
};
