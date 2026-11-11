const mongoose = require('mongoose');
const { normalizeYearRange } = require('../utils/yearFormat');

const ExamSessionSchema = new mongoose.Schema({
  date:           { type: String, required: true }, // 'YYYY-MM-DD'
  session:        { type: String, enum: ['FN', 'AN'], default: 'FN' },
  subjectId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null },
  subjectName:    { type: String, default: '' },
  halls:          [{ type: mongoose.Schema.Types.ObjectId, ref: 'Room' }],
  hallNames:      [{ type: String }],
  calendarMarkId: { type: String, default: '' },
  timing:         {
    start: { type: String, default: '09:30' },
    end:   { type: String, default: '12:30' }
  }
}, { _id: false });

const ExamSchema = new mongoose.Schema({
  ExamTrackId:  { type: String, required: true, unique: true },
  batch:        { type: String, required: true, trim: true, set: v => normalizeYearRange(v) },
  academicYear: { type: String, default: '', trim: true, set: v => normalizeYearRange(v) },
  year:         { type: String, default: 'I' },
  semester:     { type: String, enum: ['I','II','III','IV', 'V', 'VI', 'VII', 'VIII'], required: true },
  deptId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  deptName:     { type: String, default: '' },
  classIds:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
  isCommonExam: { type: Boolean, default: false },
  examType:     { type: String, enum: ['Internal 1','Internal 2','Practicals','Semester'], required: true },
  title:        { type: String, required: true, trim: true },
  sessions:     [ExamSessionSchema],
  Dates:        { type: [String], default: [] },
  timing:       {
    start: { type: String, default: '09:30' },
    end:   { type: String, default: '12:30' }
  },
  notes:        { type: String, default: '' },
  status:       { type: String, enum: ['upcoming','ongoing','completed','cancelled'], default: 'upcoming' },
  createdBy:    { type: String, default: '' },
  history: [{
    updatedBy: { type: String, default: '' },
    updatedAt: { type: Date, default: null },
    field:     { type: String, default: '' },
    oldValue:  { type: String, default: '' },
    newValue:  { type: String, default: '' },
  }],
  isFinalized:  { type: Boolean, default: false },
  finalizedBy:  { type: String, default: null },
  finalizedAt:  { type: Date, default: null },
  cancelledBy:  { type: String, default: '' },
  cancelledAt:  { type: Date, default: null },
  cancelReason: { type: String, default: '' },
}, { timestamps: true });

ExamSchema.index({ deptId: 1 });
ExamSchema.index({ batch: 1 });
ExamSchema.index({ semester: 1 });
ExamSchema.index({ Dates: 1 });
ExamSchema.index({ status: 1 });
ExamSchema.index({ 'sessions.date': 1 });

function syncExamDatesAndStatus(doc) {
  if (!doc) return;
  // If sessions provided, sync Dates from sessions
  if (Array.isArray(doc.sessions) && doc.sessions.length > 0) {
    const rawDates = doc.sessions.map(s => s && s.date ? String(s.date).split('T')[0] : '').filter(Boolean);
    doc.Dates = Array.from(new Set(rawDates)).sort();
  } else if (Array.isArray(doc.Dates) && doc.Dates.length > 0) {
    // If Dates provided without sessions, create default session entries
    const defTiming = doc.timing || { start: '09:30', end: '12:30' };
    doc.sessions = doc.Dates.map(d => ({
      date: String(d).split('T')[0],
      session: 'FN',
      timing: defTiming,
      halls: [],
      hallNames: []
    }));
  }

  // Derive status unless explicitly cancelled
  if (doc.cancelledAt || doc.status === 'cancelled') {
    doc.status = 'cancelled';
    return;
  }
  const dates = Array.isArray(doc.Dates) ? doc.Dates.filter(Boolean).sort() : [];
  if (!dates.length) {
    doc.status = 'upcoming';
    return;
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  if (todayStr < minDate) {
    doc.status = 'upcoming';
  } else if (todayStr > maxDate) {
    doc.status = 'completed';
  } else {
    doc.status = 'ongoing';
  }
}

ExamSchema.pre('validate', function () {
  syncExamDatesAndStatus(this);
});

ExamSchema.pre('save', function () {
  syncExamDatesAndStatus(this);
});

module.exports = {
  Exam: mongoose.model('Exam', ExamSchema),
};
