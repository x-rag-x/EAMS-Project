const mongoose = require('mongoose');
const { normalizeYearRange } = require('../utils/yearFormat');

const ExamScheduleRowSchema = new mongoose.Schema({
  date        : { type: String, required: true },
  session     : { type: String, enum: ['FN', 'AN', 'Both'], default: 'FN' },
  timing      : {
    start: { type: String, default: '09:30' },
    end:   { type: String, default: '12:30' }
  },
  subjectId   : { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null },
  subjectCode : { type: String, default: '' },
  subjectName : { type: String, default: '' },
  halls       : [{ type: String, trim: true }]
}, { _id: false });

const ExamSchema = new mongoose.Schema({
  ExamTrackId  : { type: String, required: true, unique: true },
  batch        : { type: String, required: true, trim: true, set: v => normalizeYearRange(v) },
  academicYear : { type: String, default: '', trim: true, set: v => normalizeYearRange(v) },
  year         : { type: String, default: 'I' },
  semester     : { type: String, enum: ['I','II','III','IV', 'V', 'VI', 'VII', 'VIII'], required: true },
  deptId       : { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  deptName     : { type: String, default: '' },
  classId      : { type: mongoose.Schema.Types.ObjectId, ref: 'Class', default: null },
  className    : { type: String, default: '' },
  examType     : { type: String, enum: ['Internal 1','Internal 2','Practicals','Semester'], required: true },
  title        : { type: String, required: true, trim: true },
  Dates        : { type: [String], required: true },
  timing       : { start : { type: String, default: '09:30' }, end: { type: String, default: '12:30' } },
  schedule     : { type: [ExamScheduleRowSchema], default: [] },
  notes        : { type: String, default: '' },
  status       : { type: String, enum: ['upcoming','ongoing','completed','cancelled'], default: 'upcoming' },
  createdBy    : { type: String, default: '' },
  createdAt    : { type: Date, default: Date.now },
  history: [{
    updatedBy    : { type: String, default: '' },
    updatedAt    : { type: Date, default: null },
    field        : { type: String, default: '' },
    oldValue     : { type: String, default: '' },
    newValue     : { type: String, default: '' },  
  }],
  isFinalized      : { type: Boolean, default: false },
  finalizedBy      : { type: String, default: null },
  finalizedAt      : { type: Date, default: null },
  unfinalizedBy    : { type: String, default: null },
  unfinalizedAt    : { type: Date, default: null },
  unfinalizeReason : { type: String, default: '' },
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

ExamSchema.virtual('startDate').get(function() {
  if (!Array.isArray(this.Dates) || this.Dates.length === 0) return '';
  const sorted = [...this.Dates].filter(Boolean).sort();
  return sorted[0] || '';
});

ExamSchema.virtual('endDate').get(function() {
  if (!Array.isArray(this.Dates) || this.Dates.length === 0) return '';
  const sorted = [...this.Dates].filter(Boolean).sort();
  return sorted[sorted.length - 1] || '';
});

ExamSchema.index({ deptId: 1, batch: 1, semester: 1 });
ExamSchema.index({ classId: 1 });

module.exports = {
  Exam: mongoose.model('Exam', ExamSchema),
};
