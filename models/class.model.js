const mongoose = require('mongoose');

const ClassSchema = new mongoose.Schema({
  trackId: { type: String, trim: true },
  name:     { type: String, required: true, trim: true },
  deptId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  deptName: { type: String, required: true },
  deptCode: { type: String, required: true },
  year:     { type: String, required: true },
  batch:    { type: String, required: true },
  sem:      { type: String, required: true },
  section:  { type: String, required: true },
  hallNo:   { type: String, required: true },
  advisorTeacherId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null },
  advisorTeacherName:    { type: String, default: '' },
  advisorTeacherTrackId: { type: String, default: '' },
}, { timestamps: true });

ClassSchema.index({ deptId: 1 });
ClassSchema.index({ deptId: 1, batch: 1 });

module.exports = {
  Class: mongoose.model('Class', ClassSchema),
};
