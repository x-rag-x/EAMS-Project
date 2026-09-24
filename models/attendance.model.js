const mongoose = require('mongoose');

const ClassAttendanceSchema = new mongoose.Schema({
   batch:          { type: String, required: true },
   year:           { type: Number, required: true },
   sem:            { type: Number, required: true },
   classId:        { type: String, required: true },
   departmentCode: { type: String, required: true },
   date:           { type: Date, required: true },
   periods:        [{
        periodNumbers:  { type: [Number], required: true },
        subjectTrackId: { type: String, required: true },
        teacherTrackId: { type: String, required: true },
        markedBy:       { type: String, required: true },
        markedAt:       { type: Date, required: true },
        topic:          { type: String, default: '', trim: true },
        notes:          { type: String, default: '', trim: true },
        records: [{
            studentTrackId: { type: String, required: true },
            status:         { type: String, enum: ['P', 'AB'], required: true },
        }]
    }],
    isFinalized:    { type: Boolean, default: false },
    createdAt:      { type: Date, default: Date.now },
    updatedAt:      { type: Date, default: Date.now }
});

ClassAttendanceSchema.index({ classId: 1, date: 1 });

const StudentAttendanceSchema = new mongoose.Schema({
    studentTrackId:    { type: String, required: true, unique: true },
    batch:             { type: String, required: true },
    departmentCode:    { type: String, required: true },
    classId:           { type: String, required: true },
    overallPercentage: { type: Number, default: 100 },
    records: [{
        subjectTrackId:   { type: String, required: true },
        sem:              { type: Number, required: true },
        classesHeld:      { type: Number, required: true },
        classesAttended:  { type: Number, required: true },
        updatedAt:        { type: Date, required: true }
    }]
});

StudentAttendanceSchema.index({ overallPercentage: 1 });
StudentAttendanceSchema.index({ classId: 1 });


const ExamAttendanceSchema = new mongoose.Schema({
    examTrackId:    { type: String, required: true },
    examTitle:      { type: String, default: '' },
    examType:       { type: String, default: '' },
    date:           { type: Date, required: true },
    hallNo:         { type: String, required: true, trim: true },
    teacherTrackId: { type: String, required: true },
    teacherName:    { type: String, required: true },
    markedAt:       { type: Date, required: true },

    records: [{
        studentTrackId: { type: String, required: true },
        regNo:          { type: String, required: true },
        status:         { type: String, enum: ['P', 'AB'], default: 'P' }
    }, { _id: false }],

    totalPresent: { type: Number, default: 0 },
    totalAbsent:  { type: Number, default: 0 },

    isFinalized:  { type: Boolean, default: false },
}, { timestamps: true });

ExamAttendanceSchema.index({ examTrackId: 1, hallNo: 1 }, { unique: true });

// Quick Pass Session Schema (Item 13 & 14)
const QuickPassSessionSchema = new mongoose.Schema({
  sessionTrackId:  { type: String, required: true, unique: true, index: true },
  teacherId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
  teacherTrackId:  { type: String, required: true },
  classId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  subjectId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  date:            { type: String, required: true },
  periodNumber:    { type: Number, default: 1 },

  // Rotation config (snapshot from settings at creation time)
  rotationCount:   { type: Number, default: 2 },
  rotationTimeSec: { type: Number, default: 60 },
  currentRotation: { type: Number, default: 1 },

  // Code history — one per rotation
  codes: [{
    code:        { type: String, required: true }, // 12-char uppercase alphanumeric
    rotation:    { type: Number, required: true },
    generatedAt: { type: Date, default: Date.now },
    expiresAt:   { type: Date, required: true },
  }],

  active:          { type: Boolean, default: true },
  startedAt:       { type: Date, default: Date.now },
  endedAt:         { type: Date },

  // Student records
  records: [{
    studentId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    studentTrackId:  { type: String, required: true },
    regNo:           { type: String, default: '' },
    studentName:     { type: String, default: '' },
    codeUsed:        { type: String },       // which 12-char code they entered
    rotation:        { type: Number },       // which rotation they joined in
    markedAt:        { type: Date, default: Date.now },
    latitude:        { type: Number },
    longitude:       { type: Number },
    locationAccuracy:{ type: Number },
    ipAddress:       { type: String, default: '' },
    deviceId:        { type: String, default: '' },
    userAgent:       { type: String, default: '' },
  }],

  isFinalSaved:    { type: Boolean, default: false },
}, { timestamps: true });

QuickPassSessionSchema.index({ classId: 1, active: 1 });
QuickPassSessionSchema.index({ teacherTrackId: 1, active: 1 });

// Scan Live Session Schema (Item 14 - migrated and expanded from LiveSessionsAtt)
const ScanLiveSessionSchema = new mongoose.Schema({
  sessionTrackId:  { type: String, required: true, unique: true, index: true },
  teacherId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
  teacherTrackId:  { type: String, required: true },
  classId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  subjectId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  date:            { type: String, required: true },
  periodNumber:    { type: Number, default: 1 },

  // Rotation config (snapshot from settings at creation time)
  rotationCount:   { type: Number, default: 2 },
  rotationTimeSec: { type: Number, default: 60 },
  currentRotation: { type: Number, default: 1 },

  qrSecret:        { type: String, default: '' },
  active:          { type: Boolean, default: true },
  startedAt:       { type: Date, default: Date.now },
  endedAt:         { type: Date },

  // QR code history — one per rotation
  qrCodes: [{
    qrTrackId:   { type: String, required: true },
    rotation:    { type: Number, required: true },
    generatedAt: { type: Date, default: Date.now },
    expiresAt:   { type: Date, required: true },
    loadedAt:    { type: Date },  // when teacher's browser rendered it
  }],

  // Student records
  records: [{
    studentId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    studentTrackId:  { type: String, required: true },
    studentName:     { type: String, default: '' },
    regNo:           { type: String, default: '' },
    qrTrackId:       { type: String, required: true },
    qrWindowIndex:   { type: Number },
    qrWindowType:    { type: String, enum: ['current', 'grace', 'expired', 'invalid'], default: 'current' },
    qrDetails:       { type: mongoose.Schema.Types.Mixed },
    rotation:        { type: Number },
    markedAt:        { type: Date, default: Date.now },
    loginTime:       { type: Date },
    latitude:        { type: Number },
    longitude:       { type: Number },
    locationAccuracy:{ type: Number },
    ipAddress:       { type: String, default: '' },
    deviceId:        { type: String, default: '' },
    deviceSessionId: { type: String, default: '' },
    userAgent:       { type: String, default: '' },
    status:          { type: String, enum: ['pending', 'completed'], default: 'pending' },
    verificationDetails: { type: mongoose.Schema.Types.Mixed },
    verificationCompletedAt: { type: Date },
  }],

  isFinalSaved:    { type: Boolean, default: false },
}, { timestamps: true });

ScanLiveSessionSchema.index({ classId: 1, active: 1 });
ScanLiveSessionSchema.index({ teacherTrackId: 1, active: 1 });

// Rep Share Session Schema (Item 12 & 14)
const RepShareSessionSchema = new mongoose.Schema({
  sessionTrackId:    { type: String, required: true, unique: true, index: true },
  teacherId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
  teacherTrackId:    { type: String, required: true },
  teacherName:       { type: String, default: '' },
  classId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  className:         { type: String, default: '' },
  subjectId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  subjectName:       { type: String, default: '' },
  date:              { type: String, required: true },
  periodNumber:      { type: Number, default: 1 },
  topic:             { type: String, default: '' },

  // Selected Rep
  repStudentId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  repStudentTrackId: { type: String, default: '' },
  repStudentName:    { type: String, default: '' },
  repRegNo:          { type: String, default: '' },
  notifiedAt:        { type: Date, default: Date.now },

  // Status flow: pending -> in-progress -> submitted -> finalized -> rejected
  status:            { type: String, enum: ['pending', 'in-progress', 'submitted', 'finalized', 'rejected'], default: 'pending' },

  // Anti-fraud: rep-confirmed class count must match actual marked present student count
  actualClassCount:  { type: Number, default: 0 },        // total roster count or marked present count
  repConfirmedCount: { type: Number },                    // entered by rep in confirmation modal

  // Attendance records marked by rep
  records: [{
    studentId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    studentTrackId: { type: String, required: true },
    regNo:          { type: String, default: '' },
    studentName:    { type: String, default: '' },
    status:         { type: String, default: 'Present' },
    remarks:        { type: String, default: '' },
    markedBy:       { type: String, default: 'rep' },
    markedAt:       { type: Date, default: Date.now },
  }],

  submittedAt:       { type: Date },
  isFinalSaved:      { type: Boolean, default: false },
}, { timestamps: true });

RepShareSessionSchema.index({ classId: 1, status: 1 });
RepShareSessionSchema.index({ repStudentTrackId: 1, status: 1 });
RepShareSessionSchema.index({ teacherTrackId: 1, status: 1 });

module.exports = {
    ClassAttendance:    mongoose.model('ClassAttendance',    ClassAttendanceSchema),
    StudentAttendance:  mongoose.model('StudentAttendance',  StudentAttendanceSchema),
    ExamAttendance:     mongoose.model('ExamAttendance',     ExamAttendanceSchema),
    QuickPassSession:   mongoose.model('QuickPassSession',   QuickPassSessionSchema),
    ScanLiveSession:    mongoose.model('ScanLiveSession',    ScanLiveSessionSchema),
    RepShareSession:    mongoose.model('RepShareSession',    RepShareSessionSchema),
};
