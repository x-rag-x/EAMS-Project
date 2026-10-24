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
  sem:      { type: String, required: true },
  roomId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null },
  hallNo:   { type: String, default: '', trim: true },
  advisorTeacherId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null },
  advisorTeacherName:    { type: String, default: '' },
  advisorTeacherTrackId: { type: String, default: '' },
}, { timestamps: true });

ClassSchema.pre('save', function (next) {
  if (this.batch) this.batch = normalizeYearRange(this.batch);
  if (typeof next === 'function') next();
});

ClassSchema.index({ deptId: 1 });
ClassSchema.index({ deptId: 1, batch: 1 });
ClassSchema.index({ roomId: 1 });

module.exports = {
  Class: mongoose.model('Class', ClassSchema),
};
