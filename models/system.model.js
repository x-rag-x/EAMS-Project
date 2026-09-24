const mongoose = require('mongoose');

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // Counter sequence identifier (e.g., 'logId', 'exportId')
  seq: { type: Number, default: 0 }
});

const LoginHistorySchema = new mongoose.Schema({
  username:   { type: String, required: true, trim: true, lowercase: true, unique: true},
  trackId:    { type: String,  unique: true, sparse: true },
  role:       { type: String, enum: ['student', 'teacher', 'admin'], required: true},
  firstLogin: { type: Date },
  lastLogin:  { type: Date },
  totalLogins: { type: Number, default: 0 },
  failedLogins: { type: Number, default: 0 },
  lockedUntil:  { type: Date, default: null },
  history: [{
    sessionId:    { type: String },
    time:         { type: Date },
    current:      { type: String, enum: ['Logged In', 'Logged Out'] },
    ip:           { type: String },
    userAgent:    { type: String },
    loginTime:    { type: Date },
    logoutTime:   { type: Date },
    logoutMethod: { type: String, enum: ['manual', 'auto', 'forced', null], default: null },
    deviceType:   { type: String, enum: ['Desktop', 'Mobile', 'Tablet', 'Unknown'] },
    browser:      { type: String, enum: ['Chrome','Firefox','Edge','Safari','Opera','Brave','Other'] },
    os:           { type: String, enum: ['Windows','Linux','MacOS','Android','iOS','Other'] },
    status:       { type: String, enum: ['success', 'failed'] },
    location: {
      latitude:  { type: Number },
      longitude: { type: Number },
      accuracy:  { type: Number },
      address:   { type: String, default: '' },
    },
    
    authToken:    { type: String }, // SHA-256 hash of JWT token
    createdAt:    { type: Date },
    expiresAt:    { type: Date },
    active:       { type: Boolean, default: false },
    lastActivity: { type: Date },
  }],
}, { timestamps: true });

LoginHistorySchema.index({ "history.active": 1, "history.current": 1 });
LoginHistorySchema.index({ trackId: 1, "history.sessionId": 1 });
LoginHistorySchema.index({ "history.sessionId": 1 });

const NotificationSchema = new mongoose.Schema({
  type:          { type: String, enum: ['request','error','info','attendance-alert','leave-request','leave-approval','leave-rejection'], default: 'request' },
  from:          { type: String, required: true },
  fromRole:      { type: String, default: 'Teacher' },
  toTeacherId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null },
  toTeacherTrackId: { type: String, default: '' },
  toTeacherName: { type: String, default: '' },
  toStudentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
  toStudentName: { type: String, default: '' },
  toStudentTrackId: { type: String, default: '' },
  leaveRequestId:{ type: mongoose.Schema.Types.ObjectId, ref: 'LeaveRequest', default: null },
  message:       { type: String, required: true },
  priority:      { type: String, enum: ['Normal','High','Urgent'], default: 'Normal' },
  status:        { type: String, enum: ['Pending','Solved','Cancelled'], default: 'Pending' },
  read:          { type: Boolean, default: false },
  grievanceId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Grievance', default: null },
  solvedAt:      { type: Date },
  cancelledAt:   { type: Date },
  time:          { type: Date },
}, { timestamps: true });

const GrievanceSchema = new mongoose.Schema({
  teacherId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  teacherName: { type: String, required: true },
  subject:     { type: String, required: true },
  category:    { type: String, default: 'Other' },
  detail:      { type: String, required: true },
  status:      { type: String, enum: ['Pending','Resolved','Cancelled'], default: 'Pending' },
  resolvedBy:  { type: String, default: '' },
  resolvedAt:  { type: Date },
  cancelledAt: { type: Date },
}, { timestamps: true });

const LogSchema = new mongoose.Schema({
  logTrackId:            { type: String, unique: true, sparse: true, index: true },
  userName:              { type: String, required: true },
  role:                  { type: String, default: 'admin' },
  trackId:               { type: String, default: '' },
  action:                { type: String, required: true },
  details:               { type: String, default: '' },
  category:              { type: String, default: 'general' },
  severity:              { type: String, default: 'info' },
  ip:                    { type: String, default: '' },
  sessionId:             { type: String, default: '', index: true },
  location: {
    latitude:  { type: Number, default: null },
    longitude: { type: Number, default: null },
    accuracy:  { type: Number, default: null },
    address:   { type: String, default: '' },
  },
  module:                { type: String, default: 'system' },
  subType:               { type: String, default: 'action' },
  actingWithAdminRights: { type: Boolean, default: false },
  encryptedPayload:      { type: String, default: '' },
  changes: {
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after:  { type: mongoose.Schema.Types.Mixed, default: null },
  },
  attendanceSummary: {
    studentTrackId: { type: String },
    studentName:    { type: String },
    date:           { type: String },
    classId:        { type: String },
    periods: [{
      periodNumber:   { type: Number },
      subjectTrackId: { type: String },
      subjectName:    { type: String },
      status:         { type: String },
      markedBy:       { type: String },
      markedAt:       { type: Date },
    }],
  },
  attendanceClassDaily: {
    classId:        { type: String, index: true },
    className:      { type: String, default: '' },
    date:           { type: String, index: true },
    periods: [{
      periodNumber:    { type: Number },
      subjectTrackId:  { type: String },
      subjectName:     { type: String },
      teacherTrackId:  { type: String },
      teacherName:     { type: String },
      teacherSessionId:{ type: String },
      method:          { type: String, default: 'Manual' },
      topic:           { type: String, default: '' },
      markedAt:        { type: Date },
      stats: {
        total:   { type: Number, default: 0 },
        present: { type: Number, default: 0 },
        absent:  { type: Number, default: 0 },
        od:      { type: Number, default: 0 }
      },
      records: [{
        studentTrackId: { type: String },
        regNo:          { type: String },
        name:           { type: String },
        status:         { type: String }
      }],
      history: [{
        action:          { type: String },
        teacherTrackId:  { type: String },
        teacherName:     { type: String },
        teacherSessionId:{ type: String },
        method:          { type: String },
        changedAt:       { type: Date },
        summary:         { type: String }
      }]
    }]
  },
  time: { type: Date, default: Date.now },
}, { timestamps: true });

LogSchema.index({ createdAt: -1 });
LogSchema.index({ module: 1, subType: 1, createdAt: -1 });
LogSchema.index({ 'attendanceSummary.studentTrackId': 1, 'attendanceSummary.date': 1 });
LogSchema.index({ 'attendanceClassDaily.classId': 1, 'attendanceClassDaily.date': 1 });

const crypto = require('crypto');

const LiveSessionSchema = new mongoose.Schema({
  trackId:        { type: String, default: () => 'TR_LS_' + crypto.randomBytes(6).toString('hex').toUpperCase() },
  teacherId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
  teacherTrackId: { type: String, default: '' },
  classId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  subjectId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  date:           { type: String, required: true },
  passcode:       { type: String, default: null },
  attendanceMode: { type: String, enum: ['code', 'qr'], default: 'code' },
  qrSecret:       { type: String, default: '' },
  qrIntervalSec:  { type: Number, default: 20 },
  expiresAt:      { type: Date, required: true },
  active:         { type: Boolean, default: true },
  latitude:       { type: Number, default: null },
  longitude:      { type: Number, default: null },
  maxRadiusMeters:{ type: Number, default: 200 },
  markedStudents: [{
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    regNo:     { type: String },
    time:      { type: Date, default: Date.now },
    ip:        { type: String },
    deviceId:  { type: String, default: '' },
    source:    { type: String, enum: ['code', 'qr', 'passcode'], default: 'code' }
  }]
}, { timestamps: true });


const ManageAdminSchema = new mongoose.Schema({
  trackId    : { type: String, required: true, unique: true},
  role       : { type: String, enum: ['admin','teacher']},
  permissions: { type: [String], default: ['calendar','exam','attendance'] },
  addedBy    : { type: String, default: 'Admin' },
  createdAt  : { type: Date, default: Date.now },
  status     : { type: String, enum: ['active','inactive'], default: 'active' },
});

module.exports = {
  Counter:      mongoose.model('Counter',      CounterSchema),
  LoginHistory: mongoose.model('LoginHistory', LoginHistorySchema),
  Notification: mongoose.model('Notification', NotificationSchema),
  Grievance:    mongoose.model('Grievance',    GrievanceSchema),
  Log:          mongoose.model('Log',          LogSchema),
  LiveSession:  mongoose.model('LiveSession',  LiveSessionSchema),
  ManageAdmin:  mongoose.model('ManageAdmin', ManageAdminSchema),
};
