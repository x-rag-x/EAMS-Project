const mongoose = require('mongoose');

const ExamSchema = new mongoose.Schema({
  ExamTrackId      : { type: String, required: true, unique: true},
  batch        : { type: String, required: true },
  academicYear : { type: String, default: '' },
  year         : { type: String, default: 'I' },
  semester     : { type: String, enum: ['I','II','III','IV', 'V', 'VI', 'VII', 'VIII'], required: true },
  deptName     : { type: String, default: '' },
  examType     : { type: String, enum: ['Internal 1','Internal 2','Practicals','Semester'], required: true },
  title        : { type: String, required: true, trim: true },
  Dates        : { type: [String], required: true },
  timing       : { start : { type: String, default: '09:30' }, end: { type: String, default: '12:30' } },
  notes        : { type: String, default: '' },
  status       : { type: String, enum: ['upcoming','ongoing','completed','cancelled'], default: 'upcoming' },
  createdBy    : { type: String, default: '' },
  createdAt    : { type: Date, default: Date.now },
  history: [{
    updatedBy    : { type: String, default: '' },
    updatedAt    : { type: Date, default: null},
    field        : { type: String, default: '' },
    oldValue     : { type: String, default: '' },
    newValue     : { type: String, default: '' },  
  }],
  isFinalized  : { type: Boolean, default: false },
  finalizedBy  : { type: String, default: null },
  finalizedAt  : { type: Date, default: null },
});

module.exports = {
  Exam: mongoose.model('Exam', ExamSchema),
};
