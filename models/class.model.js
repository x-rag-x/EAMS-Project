const mongoose = require('mongoose');
const { normalizeYearRange } = require('../utils/yearFormat');

const ClassSchema = new mongoose.Schema({
  trackId: { type: String, trim: true },
  name:     { type: String, required: true, trim: true },
  deptId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  deptName: { type: String, required: true },
  deptCode: { type: String, required: true },
  year:     { type: String, required: true },
  batch:    { type: String, required: true, trim: true, set: v => normalizeYearRange(v) },
  section:  { type: String, default: '', trim: true },
  sem:      { type: String, required: true },
  roomId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null },
  hallNo:   { type: String, default: '', trim: true },
  advisorTeacherId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null },
  advisorTeacherName:    { type: String, default: '' },
  advisorTeacherTrackId: { type: String, default: '' },
  secondaryAdvisorTeacherId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null },
  secondaryAdvisorTeacherName:    { type: String, default: '' },
  secondaryAdvisorTeacherTrackId: { type: String, default: '' },
  classRepresentatives: [{
    studentId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    studentTrackId: { type: String, default: '', trim: true },
    studentName:    { type: String, default: '', trim: true },
    registerNo:     { type: String, default: '', trim: true },
    rollNo:         { type: String, default: '', trim: true },
    isPrimary:      { type: Boolean, default: false }
  }],
  repTrackId:                { type: String, default: '', trim: true },
  repTrackIds:               [{ type: String, default: '', trim: true }],
  rep1TrackId:               { type: String, default: '', trim: true },
  rep2TrackId:               { type: String, default: '', trim: true },
  representative1Id:         { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
  representative1Name:       { type: String, default: '' },
  representative1TrackId:    { type: String, default: '' },
  representative1RegisterNo: { type: String, default: '' },
  representative2Id:         { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
  representative2Name:       { type: String, default: '' },
  representative2TrackId:    { type: String, default: '' },
  representative2RegisterNo: { type: String, default: '' },
}, { timestamps: true });

ClassSchema.pre('save', function (next) {
  if (this.batch) this.batch = normalizeYearRange(this.batch);
  if (!this.section && this.name) {
    const m = this.name.match(/(?:SEC\s*|[- ])([A-Za-z0-9]{1,3})$/i);
    if (m) this.section = m[1].toUpperCase();
  }
  if (typeof next === 'function') next();
});

ClassSchema.index({ deptId: 1 });
ClassSchema.index({ deptId: 1, batch: 1 });
ClassSchema.index({ roomId: 1 });
ClassSchema.index({ repTrackId: 1 });
ClassSchema.index({ repTrackIds: 1 });

module.exports = {
  Class: mongoose.model('Class', ClassSchema),
};
