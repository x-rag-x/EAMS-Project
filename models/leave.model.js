const mongoose = require('mongoose');

const LeaveRequestSchema = new mongoose.Schema({
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
  leaveType:      { type: String, default: 'Casual Leave' },
  slot:           { type: String, enum: ['Full Day', 'FN', 'AN', 'Custom Periods'], default: 'Full Day' },
  periods:        { type: [Number], default: [] },
  fromDate:       { type: String, required: true }, // YYYY-MM-DD
  toDate:         { type: String, required: true }, // YYYY-MM-DD
  dates:          [{ type: String }],               // Array of 'YYYY-MM-DD'
  daysCount:      { type: Number, required: true }, // e.g. 0.5 for half day, 1, 2, etc.
  reason:         { type: String, required: true, trim: true },
  isEmergency:    { type: Boolean, default: false },
  escalationLevel:{ type: String, enum: ['advisor', 'hod', 'principal'], default: 'advisor' },
  status:         { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'], default: 'Pending' },
  advisorStatus:  { type: String, enum: ['Pending', 'Approved', 'Rejected', 'N/A'], default: 'Pending' },
  advisorRemarks: { type: String, default: '' },
  advisorReviewedAt: { type: Date, default: null },
  hodStatus:      { type: String, enum: ['Pending', 'Approved', 'Rejected', 'N/A'], default: 'N/A' },
  hodReviewedBy:  { type: String, default: '' },
  hodReviewedAt:  { type: Date, default: null },
  hodRemarks:     { type: String, default: '' },
  reviewedBy:     { type: String, default: '' },
  reviewedAt:     { type: Date, default: null },
  reviewRemarks:  { type: String, default: '' },
  notificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification', default: null }
}, { timestamps: true });

LeaveRequestSchema.index({ studentId: 1, createdAt: -1 });
LeaveRequestSchema.index({ advisorId: 1, status: 1 });
LeaveRequestSchema.index({ deptId: 1, status: 1 });
LeaveRequestSchema.index({ classId: 1, dates: 1, status: 1 });
LeaveRequestSchema.index({ studentTrackId: 1, dates: 1, status: 1 });

const TeacherLeaveRequestSchema = new mongoose.Schema({
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
  fromDate:         { type: String, required: true }, // YYYY-MM-DD
  toDate:           { type: String, required: true }, // YYYY-MM-DD
  dates:            [{ type: String }],               // Array of 'YYYY-MM-DD'
  daysCount:        { type: Number, required: true },
  reason:           { type: String, required: true, trim: true },
  isEmergency:      { type: Boolean, default: false },
  status:           { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'], default: 'Pending' },
  escalationLevel:  { type: String, enum: ['hod', 'principal'], default: 'hod' },
  hodStatus:        { type: String, enum: ['Pending', 'Approved', 'Rejected', 'N/A'], default: 'Pending' },
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
    status:                   { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    notes:                    { type: String, default: '' }
  }],
}, { timestamps: true });

TeacherLeaveRequestSchema.index({ teacherId: 1, createdAt: -1 });
TeacherLeaveRequestSchema.index({ deptId: 1, status: 1 });
TeacherLeaveRequestSchema.index({ dates: 1, status: 1 });

module.exports = {
  LeaveRequest:        mongoose.model('LeaveRequest', LeaveRequestSchema),
  TeacherLeaveRequest: mongoose.model('TeacherLeaveRequest', TeacherLeaveRequestSchema),
};
