const mongoose = require('mongoose');

const LeaveRequestSchema = new mongoose.Schema({
  requestId:      { type: String }, // LV-YYYY-XXXXXX
  studentId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  studentTrackId: { type: String, required: true },
  studentName:    { type: String, required: true },
  studentRegNo:   { type: String, required: true },
  classId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  className:      { type: String, required: true },
  deptId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  deptName:       { type: String, default: '' },
  advisorId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null },
  advisorTrackId: { type: String, default: '' },
  advisorName:    { type: String, default: '' },
  category:       { type: String, enum: ['Leave', 'Permission'], default: 'Leave' },
  leaveCategory:  { type: String, enum: ['Personal', 'Medical', 'Family function', 'Emergency', 'Other'], default: 'Personal' },
  leaveType:      { type: String, default: 'Casual Leave' },
  slot:           { type: String, enum: ['Full Day', 'FN', 'AN', 'Custom Periods'], default: 'Full Day' },
  coverage:       { type: String, enum: ['full_day', 'fn', 'an', 'periods'], default: 'full_day' },
  periods:        { type: [Number], default: [] },
  fromDate:       { type: String, required: true }, // YYYY-MM-DD
  toDate:         { type: String, required: true }, // YYYY-MM-DD
  dates:          [{ type: String }],               // Array of 'YYYY-MM-DD'
  daysCount:      { type: Number, required: true }, // e.g. 0.5 for half day, 1, 2, etc.
  reason:         { type: String, required: true, trim: true },
  isEmergency:    { type: Boolean, default: false },
  escalationLevel:{ type: String, enum: ['advisor', 'hod', 'principal'], default: 'advisor' },
  status:         { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Returned'], default: 'Pending' },
  advisorStatus:  { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Returned', 'N/A'], default: 'Pending' },
  advisorRemarks: { type: String, default: '' },
  advisorReviewedAt: { type: Date, default: null },
  hodStatus:      { type: String, enum: ['Pending', 'Approved', 'Rejected', 'N/A'], default: 'N/A' },
  hodReviewedBy:  { type: String, default: '' },
  hodReviewedAt:  { type: Date, default: null },
  hodRemarks:     { type: String, default: '' },
  reviewedBy:     { type: String, default: '' },
  reviewedAt:     { type: Date, default: null },
  reviewRemarks:  { type: String, default: '' },
  notificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification', default: null },
  certificate: {
    driveFileId:  { type: String, default: null },
    webViewLink:  { type: String, default: null },
    md5Checksum:  { type: String, default: null },
    status:       { type: String, enum: ['uploaded', 'to_follow', 'overdue', 'not_required'], default: 'not_required' },
    dueAt:        { type: Date, default: null }
  },
  filedByAdvisor: { type: Boolean, default: false },
  overriddenPeriods: [{
    date:         { type: String, required: true },
    periodNumber: { type: Number, required: true },
    by:           { type: String, required: true },
    at:           { type: Date, default: Date.now },
    note:         { type: String, default: '' }
  }],
  history: [{
    action:       { type: String, required: true },
    actorId:      { type: String, required: true },
    actorName:    { type: String, default: '' },
    actorRole:    { type: String, default: '' },
    at:           { type: Date, default: Date.now },
    comment:      { type: String, default: '' }
  }]
}, { timestamps: true });

LeaveRequestSchema.index({ requestId: 1 }, { unique: true, sparse: true });
LeaveRequestSchema.index({ studentId: 1, createdAt: -1 });
LeaveRequestSchema.index({ advisorId: 1, status: 1 });
LeaveRequestSchema.index({ deptId: 1, status: 1 });
LeaveRequestSchema.index({ classId: 1, dates: 1, status: 1 });
LeaveRequestSchema.index({ studentTrackId: 1, dates: 1, status: 1 });
LeaveRequestSchema.index({ studentTrackId: 1, fromDate: 1, toDate: 1 });

const TeacherLeaveRequestSchema = new mongoose.Schema({
  requestId:        { type: String, default: null }, // FL-YYYY-XXXXXX
  teacherId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
  teacherTrackId:   { type: String, required: true },
  teacherName:      { type: String, required: true },
  employeeNo:       { type: String, default: '' },
  deptId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  deptCode:         { type: String, default: '' },
  deptName:         { type: String, default: '' },
  category:         { type: String, enum: ['Leave', 'Permission', 'On Duty (OD)'], default: 'Leave' },
  leaveType:        { type: String, default: 'Casual Leave' },
  slot:             { type: String, enum: ['Full Day', 'FN', 'AN', 'Custom Hours'], default: 'Full Day' },
  coverage:         { type: String, enum: ['full_day', 'fn', 'an', 'periods'], default: 'full_day' },
  periods:          [{ type: Number }],
  fromDate:         { type: String, required: true }, // YYYY-MM-DD
  toDate:           { type: String, required: true }, // YYYY-MM-DD
  dates:            [{ type: String }],               // Array of 'YYYY-MM-DD'
  daysCount:        { type: Number, required: true },
  balanceBreakdown: {
    leaveType:      { type: String, default: 'Casual Leave' },
    requestedDays:  { type: Number, default: 0 },
    available:      { type: Number, default: 0 },
    coveredByLeave: { type: Number, default: 0 },
    lopDays:        { type: Number, default: 0 }
  },
  reason:           { type: String, required: true, trim: true },
  isEmergency:      { type: Boolean, default: false },
  actingAdvisor: {
    classId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Class', default: null },
    className:      { type: String, default: '' },
    teacherTrackId: { type: String, default: '' },
    teacherName:    { type: String, default: '' }
  },
  actingHod: {
    deptCode:       { type: String, default: '' },
    teacherTrackId: { type: String, default: '' },
    teacherName:    { type: String, default: '' }
  },
  document: {
    driveFileId:    { type: String, default: null },
    webViewLink:    { type: String, default: null },
    name:           { type: String, default: '' }
  },
  status:           {
    type: String,
    enum: [
      'draft', 'pending_hod', 'pending_principal', 'approved', 'rejected', 'withdrawn', 'cancelled', 'returned',
      'Pending', 'Approved', 'Rejected', 'Cancelled', 'Returned'
    ],
    default: 'Pending'
  },
  escalationLevel:  { type: String, enum: ['hod', 'principal'], default: 'hod' },
  hodStatus:        { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Returned', 'Permitted', 'N/A'], default: 'Pending' },
  hodReviewedBy:    { type: String, default: '' },
  hodReviewedAt:    { type: Date, default: null },
  hodRemarks:       { type: String, default: '' },
  principalStatus:  { type: String, enum: ['Pending', 'Approved', 'Rejected', 'N/A'], default: 'N/A' },
  principalReviewedBy: { type: String, default: '' },
  principalReviewedAt: { type: Date, default: null },
  principalRemarks: { type: String, default: '' },
  substituteTeacherTrackId: { type: String, default: '' },
  substituteTeacherName:    { type: String, default: '' },
  substitutions: [{
    date:                     { type: String, required: true }, // YYYY-MM-DD
    day:                      { type: String, required: true }, // 'Monday', 'Tuesday', etc.
    periodNumber:             { type: Number, required: true },
    classId:                  { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    className:                { type: String, default: '' },
    subjectName:              { type: String, default: '' },
    subjectCode:              { type: String, default: '' },
    hallNo:                   { type: String, default: '' },
    substituteTeacherId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
    substituteTeacherTrackId: { type: String, required: true },
    substituteTeacherName:    { type: String, required: true },
    status:                   {
      type: String,
      enum: ['pending', 'requested', 'accepted', 'rejected', 'confirmed', 'released', 'expired'],
      default: 'pending'
    },
    assignedBy:               { type: String, enum: ['teacher', 'hod', 'ttc', 'principal', 'admin'], default: 'teacher' },
    isUnresolved:             { type: Boolean, default: false },
    rejectionReason:          { type: String, default: '' },
    notes:                    { type: String, default: '' }
  }],
  history: [{
    action:       { type: String, required: true },
    actorId:      { type: String, required: true },
    actorName:    { type: String, default: '' },
    actorRole:    { type: String, default: '' },
    at:           { type: Date, default: Date.now },
    comment:      { type: String, default: '' }
  }]
}, { timestamps: true });

TeacherLeaveRequestSchema.index({ requestId: 1 }, { unique: true, sparse: true });
TeacherLeaveRequestSchema.index({ teacherId: 1, createdAt: -1 });
TeacherLeaveRequestSchema.index({ deptId: 1, status: 1 });
TeacherLeaveRequestSchema.index({ dates: 1, status: 1 });
TeacherLeaveRequestSchema.index({ 'substitutions.substituteTeacherTrackId': 1, 'substitutions.date': 1 });

const LeaveRequestModel = mongoose.models.LeaveRequest || mongoose.model('LeaveRequest', LeaveRequestSchema);
const TeacherLeaveRequestModel = mongoose.models.TeacherLeaveRequest || mongoose.model('TeacherLeaveRequest', TeacherLeaveRequestSchema);

module.exports = {
  LeaveRequest:        LeaveRequestModel,
  StudentLeaveRequest: LeaveRequestModel,
  StudentLeave:        LeaveRequestModel,
  TeacherLeaveRequest: TeacherLeaveRequestModel,
};
