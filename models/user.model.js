const mongoose = require('mongoose');
const { normalizeYearRange, toBatchTrackId } = require('../utils/yearFormat');

// Teacher user schema definition
const TeacherSchema = new mongoose.Schema({
  fullName:     { type: String, required: true, trim: true },
  firstName:    { type: String, default: '', trim: true },
  lastName:     { type: String, trim: true, default: null },
  trackId:      { type: String, required: true, unique: true, trim: true },
  gender:           { type: String, enum: ['female', 'male', 'other', 'unspecified', 'Female', 'Male'], default: 'unspecified' },
  bootstrapPending: { type: Boolean, default: false },
  isDefaultPassword: { type: Boolean, default: false },
  firstBootAt:      { type: Date, default: null },
  employeeNo:   { type: String, default: '', trim: true },
  department:   { type: String, default: '', trim: true },
  deptId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  deptCode:     { type: String, default: '', trim: true, uppercase: true },
  designation:  { type: String, default: '', trim: true },
  email:        { type: String, default: '', lowercase: true, trim: true, set: v => (v ? String(v).replace(/\s+/g, '').toLowerCase() : '') },
  username:     { type: String, required: true, unique: true, trim: true, lowercase: true, set: v => (v ? String(v).replace(/\s+/g, '').toLowerCase() : '') },
  password:     { type: String, required: true, select: false },

  specials: [{
    option:     { 
      type: String, 
      enum: [
        'isAdmin', 'isPrincipal', 'isHod', 'isClassAdvisor',
        'isTimeTableCoordinator', 'isExamCoordinator', 'isPlacementCoordinator', 'isWarden',
        'HodDeptTrackId', 'ClassAdvisorTrackId', 'TTDeptTrackId'
      ]
    },
    key:        { type: String, default: '', trim: true },
    value:      { type: mongoose.Schema.Types.Mixed, default: true },
  }],

  pageRights: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({ accessRole: 'none', version: 0, grants: [] })
  },

  accessVersion: { type: Number, default: 0 },

  responsibilities: { type: [String], default: [] },

  preferences: {
    defaultAttendanceStatus: { type: String, enum: ['Present', 'Absent', 'Unmarked'], default: 'Present' },
    autoAttendancePrompt: { type: Boolean, default: true },
    promptLeadMinutes: { type: Number, enum: [0, 5, 10], default: 5 },
  },

  mustChangePassword: { type: Boolean, default: false },

  passwordHistory: {
    type: [{
      hash:      { type: String, required: true },
      changedAt: { type: Date, default: Date.now }
    }],
    select: false,
    default: []
  },

}, { timestamps: true });

TeacherSchema.index({ deptId: 1 });
TeacherSchema.index({ deptCode: 1 });
TeacherSchema.index({ 'specials.option': 1 });
TeacherSchema.index({ 'pageRights.page': 1 });
TeacherSchema.index({ 'pageRights.accessRole': 1 });
TeacherSchema.index({ 'pageRights.scope': 1 });
TeacherSchema.index({ 'pageRights.deptId': 1 });
TeacherSchema.index({ 'pageRights.grants.page': 1 });
TeacherSchema.index({ bootstrapPending: 1 });

// Student user schema definition
const StudentSchema = new mongoose.Schema({
  fullName:     { type: String, required: true, trim: true },
  firstName:    { type: String, default: '', trim: true },
  lastName:     { type: String, trim: true, default: null },
  gender:       {
    type: String,
    enum: ['Male', 'Female', 'Other'],
    default: 'Male',
    set: v => {
      if (!v) return 'Male';
      const s = String(v).trim().toLowerCase();
      if (s === 'female') return 'Female';
      if (s === 'male') return 'Male';
      if (s === 'other') return 'Other';
      return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
    }
  },
  trackId: { type: String, required: true, unique: true, trim: true },
  registerNo:   { type: String, default: '', trim: true },
  class:        { type: String, default: '' },
  classId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  courseType:    { type: String, enum: ['None', 'UG','PG'], default: 'None'},
  branch:       { type: String, enum: ['None', 'M.E','M.TECH','B.E','B.TECH'], default: 'None' },
  department:   { type: String, default: '' },
  deptId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  admissionYear: { type: String, default: '', set: v => normalizeYearRange(v) },
  batchTrackId:  { type: String, default: '', trim: true },
  batch:         { type: String, default: '', trim: true, set: v => normalizeYearRange(v) },
  manageId:      { type: mongoose.Schema.Types.ObjectId, ref: 'DataManagement' },
  email:        { type: String, default: '', lowercase: true, trim: true },
  username:     { type: String, required: true, unique: true, trim: true, lowercase: true },
  password:     { type: String, required: true, select: false },
  isRep:        { type: Boolean, default: false },
  attendancePercentage: { type: Number, default: 100 },
  residency:            {
    type: String,
    enum: ['hostel', 'dayscholar'],
    default: 'dayscholar',
    set: v => (v && String(v).toLowerCase().includes('hostel') ? 'hostel' : (v ? String(v).toLowerCase().trim() : 'dayscholar'))
  },
  hostelId:             { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', default: null },
  blockId:              { type: mongoose.Schema.Types.ObjectId, ref: 'Block', default: null },
  currentAllocationId:  { type: mongoose.Schema.Types.ObjectId, ref: 'HostelAllocation', default: null },
  guardians: [{
    name:       { type: String, trim: true, default: '' },
    relation:   { type: String, trim: true, default: '' },
    phone:      { type: String, trim: true, default: '' },
    isPrimary:  { type: Boolean, default: false },
  }],
  mustChangePassword:   { type: Boolean, default: true },
  passwordHistory:      { type: [{ hash: { type: String, required: true }, changedAt: { type: Date, default: Date.now } }], select: false, default: [] },

  // Trust Score cache of ledger (§4, §8, T4.1)
  trust: {
    score:       { type: Number, default: 100, min: 0, max: 100 },
    band:        { type: String, enum: ['normal', 'monitor', 'verify', 'disabled'], default: 'normal' },
    lockedUntil: { type: Date, default: null },
    lockReason:  { type: String, default: '', trim: true },
    lockEventId: { type: String, default: '', trim: true },
    updatedAt:   { type: Date, default: Date.now },
  },
}, { timestamps: true });

StudentSchema.pre('save', function (next) {
  if (this.batch) {
    this.batch = normalizeYearRange(this.batch);
    if (!this.batchTrackId || this.isModified('batch')) {
      this.batchTrackId = toBatchTrackId(this.batch) || this.batchTrackId;
    }
  }
  if (this.admissionYear) {
    this.admissionYear = normalizeYearRange(this.admissionYear);
  }
  if (typeof next === 'function') next();
});

StudentSchema.index({ deptId: 1 });
StudentSchema.index({ deptId: 1, classId: 1 });
StudentSchema.index({ deptId: 1, batchTrackId: 1 });
StudentSchema.index({ batch: 1 });
StudentSchema.index({ classId: 1 });
StudentSchema.index({ fullName: 1 });
StudentSchema.index({ registerNo: 1 });
StudentSchema.index({ attendancePercentage: 1 });
StudentSchema.index({ 'trust.score': 1 });
StudentSchema.index({ 'trust.lockedUntil': 1 });
StudentSchema.index({ residency: 1 });
StudentSchema.index({ gender: 1 });

// Base shadow user schema for session and status tracking
const UserSchema = new mongoose.Schema({
  username:   { type: String, required: true, unique: true, trim: true, lowercase: true },
  role:       { type: String, enum: ['teacher','student'], required: true },
  trackId:    { type: String,  unique: true, sparse: true },
  status:     { type: String, enum: ['active', 'inactive', 'locked'], default: 'active' },
  online:     { type: Boolean, default: false },
  failedLogins: { type: Number, default: 0 },
  lockedUntil:  { type: Date, default: null },
  bootstrapPending: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = {
  Teacher: mongoose.model('Teacher', TeacherSchema),
  Student: mongoose.model('Student', StudentSchema),
  User:    mongoose.model('User', UserSchema),
};