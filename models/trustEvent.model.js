const mongoose = require('mongoose');

/**
 * models/trustEvent.model.js
 *
 * Immutable append-only ledger for Student Trust Score changes (§4, §8, T4.1)
 * Every score mutation writes a TrustEvent with a unique refKey for idempotency.
 * Schema pre-hooks strictly reject updates or deletions.
 */

const TrustEventSchema = new mongoose.Schema({
  eventId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    default: function () {
      return 'TE-' + Math.random().toString(36).substring(2, 9).toUpperCase() + Date.now().toString(36).toUpperCase();
    }
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
    index: true
  },
  studentTrackId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: [
      'INITIAL',
      'UNINFORMED_ABSENCE',
      'FREQUENT_ABSENCE',
      'TEACHER_DENIED',
      'DEVICE_SHARED',
      'ADMIN_ADJUST',
      'ADMIN_RESET',
      'LEAVE_APPROVED_REVERSAL',
      'DISPUTE_ACCEPTED_CORRECTION',
      'LOCK',
      'UNLOCK'
    ]
  },
  delta: {
    type: Number,
    required: true,
    default: 0
  },
  before: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  after: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  refKey: {
    type: String,
    required: true,
    trim: true
  },
  refs: {
    sessionTrackId:   { type: String, default: null, trim: true },
    date:             { type: String, default: null, trim: true },
    disputeId:        { type: String, default: null, trim: true },
    caseId:           { type: String, default: null, trim: true },
    reversesEventId:  { type: String, default: null, trim: true }
  },
  reason: {
    type: String,
    default: '',
    trim: true
  },
  actor: {
    type: mongoose.Schema.Types.Mixed,
    default: 'system' // can be 'system' or { trackId, name, role }
  },
  at: {
    type: Date,
    default: Date.now,
    immutable: true
  }
}, {
  timestamps: { createdAt: 'at', updatedAt: false }
});

// Idempotency compound unique index: one event per refKey per student (§8)
TrustEventSchema.index({ studentId: 1, refKey: 1 }, { unique: true });
TrustEventSchema.index({ studentTrackId: 1, at: -1 });
TrustEventSchema.index({ type: 1, at: -1 });

// Immutability hooks: prevent any modifications or deletions on ledger records
const blockMutation = function (next) {
  const err = new Error('TrustEvent records are immutable ledger entries and cannot be updated or deleted.');
  err.code = 'IMMUTABLE_RECORD';
  return next(err);
};

TrustEventSchema.pre('updateOne', blockMutation);
TrustEventSchema.pre('updateMany', blockMutation);
TrustEventSchema.pre('findOneAndUpdate', blockMutation);
TrustEventSchema.pre('deleteOne', blockMutation);
TrustEventSchema.pre('deleteMany', blockMutation);
TrustEventSchema.pre('findOneAndDelete', blockMutation);
TrustEventSchema.pre('findOneAndRemove', blockMutation);

module.exports = {
  TrustEvent: mongoose.model('TrustEvent', TrustEventSchema)
};
