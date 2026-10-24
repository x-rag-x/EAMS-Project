const mongoose = require('mongoose');

const ClassSessionSchema = new mongoose.Schema({
  date: {
    type: String,
    required: true, // YYYY-MM-DD in IST
    index: true
  },
  classId: {
    type: String,
    required: true,
    index: true
  },
  className: {
    type: String,
    default: ''
  },
  deptCode: {
    type: String,
    required: true,
    uppercase: true,
    index: true
  },
  year: {
    type: mongoose.Schema.Types.Mixed,
    default: 1
  },
  section: {
    type: String,
    default: 'A'
  },
  periodNumber: {
    type: Number,
    required: true,
    index: true
  },
  span: {
    type: Number,
    default: 1
  },
  start: {
    type: String,
    required: true // HH:MM
  },
  end: {
    type: String,
    required: true // HH:MM
  },
  timingSetId: {
    type: String,
    default: null
  },
  slotType: {
    type: String,
    enum: ['theory', 'lab', 'library', 'sports', 'training', 'seminar', 'exam'],
    default: 'theory'
  },
  subjectId: {
    type: String,
    default: null
  },
  subjectName: {
    type: String,
    default: ''
  },
  room: {
    type: String,
    default: ''
  },
  scheduledTeacher: {
    trackId: { type: String, default: '' },
    name:    { type: String, default: '' }
  },
  actualTeacher: {
    trackId: { type: String, default: null },
    name:    { type: String, default: null }
  },
  source: {
    type: String,
    enum: ['timetable', 'substitution', 'extra'],
    default: 'timetable'
  },
  status: {
    type: String,
    enum: ['scheduled', 'cancelled', 'holiday', 'exam'],
    default: 'scheduled'
  },
  startClass: {
    at:  { type: Date, default: null },
    geo: { type: String, enum: ['ok', 'outside', 'denied'], default: null }
  },
  attendance: {
    savedAt:           { type: Date, default: null },
    savedBy:           { type: String, default: null },
    minutesAfterStart: { type: Number, default: null },
    onTime:            { type: Boolean, default: null },
    present:           { type: Number, default: 0 },
    absent:            { type: Number, default: 0 },
    od:                { type: Number, default: 0 },
    leave:             { type: Number, default: 0 },
    hostelLeave:       { type: Number, default: 0 },
    total:             { type: Number, default: 0 }
  },
  leavePendingPrincipal: {
    type: Boolean,
    default: false
  },
  notes: [{
    by:   { type: String },
    text: { type: String },
    at:   { type: Date, default: Date.now }
  }],
  flags: {
    type: [String],
    default: []
  }
}, { timestamps: true });

// Invariant unique index & query optimization indexes
ClassSessionSchema.index({ date: 1, classId: 1, periodNumber: 1 }, { unique: true });
ClassSessionSchema.index({ date: 1, deptCode: 1, periodNumber: 1 });
ClassSessionSchema.index({ date: 1, 'actualTeacher.trackId': 1 });
ClassSessionSchema.index({ date: 1, 'scheduledTeacher.trackId': 1 });

module.exports = {
  ClassSession: mongoose.model('ClassSession', ClassSessionSchema)
};
