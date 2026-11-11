const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * 1. ClassSubjectSet: Curriculum Definition Record (Section 2.2 / N20, C12, C13)
 * Tracks the authoritative curriculum configuration for each section,
 * its human author, and cryptographic SHA-256 hash of assignments.
 */
const ClassSubjectSetItemSchema = new Schema({
  subjectId:      { type: Schema.Types.ObjectId, ref: 'Subject' },
  subjectCode:    { type: String, default: '' },
  subjectName:    { type: String, default: '' },
  teacherId:      { type: Schema.Types.ObjectId, ref: 'Teacher' },
  teacherName:    { type: String, default: '' },
  roomId:         { type: Schema.Types.ObjectId, ref: 'Room' },
  hallNo:         { type: String, default: '' },
  periodsPerWeek: { type: Number, default: 4 },
  isLab:          { type: Boolean, default: false }
}, { _id: false });

const ClassSubjectSetSchema = new Schema({
  classId:   { type: Schema.Types.ObjectId, ref: 'Class', required: true, unique: true },
  version:   { type: Number, default: 1 },
  rowsHash:  { type: String, required: true }, // SHA-256 of canonical assignment rows
  items:     [ClassSubjectSetItemSchema],
  createdBy: {
    userId:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name:    { type: String, required: true },
    trackId: { type: String, default: '' }
  },
  updatedBy: {
    userId:  { type: Schema.Types.ObjectId, ref: 'User' },
    name:    { type: String, default: '' },
    trackId: { type: String, default: '' }
  }
}, { timestamps: true });

// classId unique index declared on field definition above
ClassSubjectSetSchema.index({ rowsHash: 1 });

/**
 * 2. SubjectSetConfirmation: Gate Clearance Token (Section 2.3 / Invariant Z15)
 * Dedicated collection recording human verification before AutoGen runs.
 * Gated with 30-day expiration token bound to the specific rowsHash.
 */
const SubjectSetConfirmationSchema = new Schema({
  draftId:         { type: Schema.Types.ObjectId, required: true },
  classId:         { type: Schema.Types.ObjectId, ref: 'Class', required: true },
  rowsHash:        { type: String, required: true },
  confirmedBy:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
  confirmedByName: { type: String, default: '' },
  confirmedAt:     { type: Date, default: Date.now },
  expiresAt:       { type: Date, default: () => new Date(Date.now() + 30 * 86400000) } // 30 days
}, { timestamps: true });

SubjectSetConfirmationSchema.index({ draftId: 1, classId: 1, rowsHash: 1 });
SubjectSetConfirmationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * 3. TeacherAvailability: Faculty Constraints & Preferences (Section 2.4 / K10, C19)
 * Persistent faculty schedule constraints used for conflict warnings and AutoGen placement.
 */
const TeacherAvailabilitySchema = new Schema({
  teacherId:      { type: Schema.Types.ObjectId, ref: 'Teacher', required: true, unique: true },
  unavailable:    [{
    day:          { type: String, required: true },
    period:       { type: Number, required: true }
  }],
  preferred:      [{
    day:          { type: String, required: true },
    period:       { type: Number, required: true }
  }],
  maxPerDay:      { type: Number, default: 4, min: 1, max: 10 },
  maxConsecutive: { type: Number, default: 2, min: 1, max: 6 },
  updatedBy:      { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// teacherId unique index declared on field definition above

module.exports = {
  ClassSubjectSet: mongoose.model('ClassSubjectSet', ClassSubjectSetSchema),
  SubjectSetConfirmation: mongoose.model('SubjectSetConfirmation', SubjectSetConfirmationSchema),
  TeacherAvailability: mongoose.model('TeacherAvailability', TeacherAvailabilitySchema)
};
