const mongoose = require('mongoose');

const CalendarDaySchema = new mongoose.Schema({
  CalendarTrackId    : { type: String, required: true, unique: true},
  date         : { type: Date, required: true, unique: true },
  month        : { type: String, default: '' },
  year         : { type: String, default: '' },
  day          : { type: String, 
    enum: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], 
    required: true },
  details: [{
    year        : { type: String, enum: ['I', 'II', 'III', 'IV', 'All'] },
    dayType     : { type: String, enum: ['working', 'leave', 'holiday', 'exam', 'half-day', 'vacation', 'event', 'assessment'], default: 'working'},
    comments    : { type: String, default: '', trim: true },
    timing      : { start : { type: String, default: '08:30' }, end: { type: String, default: '16:30' }},
    // E3 Scoping:
    deptId      : { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    deptName    : { type: String, default: '' },
    batch       : { type: String, default: '', trim: true },
    classId     : { type: mongoose.Schema.Types.ObjectId, ref: 'Class', default: null },
    className   : { type: String, default: '' },
    // E4 Ownership:
    examId      : { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', default: null },
    examTrackId : { type: String, default: '', trim: true },
    // E7 Schedule Details:
    session     : { type: String, default: 'FN' },
    subjectId   : { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null },
    subjectCode : { type: String, default: '' },
    subjectName : { type: String, default: '' },
    halls       : [{ type: String, trim: true }],
  }],
  createdBy    : { type: String, default: '' },
  createdAt    : { type: Date, default: Date.now },
  history: [{
    updatedBy    : { type: String, default: '' },
    updatedAt    : { type: Date, default: null},
    field        : { type: String, default: '' },
    oldValue     : { type: String, default: '' },
    newValue     : { type: String, default: '' },
  }],
  isFinalized   : { type: Boolean, default: false },
  finalizedBy   : { type: String, default: null },
  finalizedAt   : { type: Date, default: null },
});

CalendarDaySchema.index({ 'details.examTrackId': 1 });
CalendarDaySchema.index({ 'details.deptId': 1 });
CalendarDaySchema.index({ 'details.classId': 1 });

const CalendarDay = mongoose.model('CalendarDay', CalendarDaySchema);

module.exports = {
  CalendarDay,
  AcademicCalendar: CalendarDay,
  Calendar: CalendarDay,
};

