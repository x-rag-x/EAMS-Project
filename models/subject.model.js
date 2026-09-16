const mongoose = require('mongoose');

const SubjectSchema = new mongoose.Schema({
  trackId: { type: String, trim: true },
  subjectCode:  { type: String, required: true, trim: true, unique: true, sparse: true },
  name:     { type: String, required: true, trim: true },
  shortName:{ type: String, trim: true, default: '' },
  code:     { type: String, required: true, trim: true },
  credits:  { type: Number, default: 3 },
  type:     { type: String, enum: ['Theory','Lab','Project'], default: 'Theory' },
  deptId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  deptName: { type: String, default: '' },
  deptCode: { type: String, default: '' },
}, { timestamps: true });

SubjectSchema.index({ deptId: 1 });

module.exports = {
  Subject: mongoose.model('Subject', SubjectSchema),
};
