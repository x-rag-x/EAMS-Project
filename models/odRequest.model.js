const mongoose = require('mongoose');

const ODRequestSchema = new mongoose.Schema({
  requestId:          { type: String, unique: true, required: true }, // TR-OD-00000
  trackId:            { type: String, unique: true, sparse: true },   // Alias / unique trackId
  eventId:            { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicEvent', default: null },
  eventDetails: {
    name:             { type: String, required: true, trim: true },
    organizer:        { type: String, required: true, trim: true },
    type:             { type: String, default: 'Technical' },
    subType:          { type: String, default: 'Hackathon' },
    level:            { type: String, default: 'Inter-Collegiate' },
    mode:             { type: String, enum: ['Offline', 'Online', 'Hybrid'], default: 'Offline' },
    hostCollege:      { type: String, default: '' },
    city:             { type: String, default: '' },
    venue:            { type: String, default: '' },
    websiteUrl:       { type: String, default: '' },
    startDate:        { type: String, required: true }, // YYYY-MM-DD
    endDate:          { type: String, required: true }, // YYYY-MM-DD
    description:      { type: String, default: '' }
  },
  studentId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  studentTrackId:     { type: String, required: true },
  studentName:        { type: String, required: true },
  studentRegNo:       { type: String, required: true },
  classId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  className:          { type: String, required: true },
  deptId:             { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  deptCode:           { type: String, default: '' },
  year:               { type: Number, default: 1 },
  section:            { type: String, default: 'A' },
  advisorTrackId:     { type: String, default: '' },
  advisorName:        { type: String, default: '' },
  mentorTrackId:      { type: String, required: true }, // EAMS faculty trackId
  mentorName:         { type: String, required: true },
  mentorDept:         { type: String, default: '' },
  coverage:           { type: String, enum: ['full_day', 'fn', 'an', 'periods', 'none'], default: 'full_day' },
  periods:            { type: [Number], default: [] },
  dates:              [{ type: String, required: true }], // Array of YYYY-MM-DD
  daysCount:          { type: Number, required: true },
  isGroupOD:          { type: Boolean, default: false },
  groupFacultyTrackId:{ type: String, default: null },
  evidenceAtRequest:  [{
    driveFileId:      { type: String, default: '' },
    webViewLink:      { type: String, default: '' },
    md5Checksum:      { type: String, default: '' },
    fileName:         { type: String, default: '' },
    type:             { type: String, enum: ['event_proof', 'registration_proof', 'invitation', 'certificate', 'other'], default: 'event_proof' }
  }],
  requestPrincipal:   { type: Boolean, default: false },
  status: {
    type: String,
    enum: [
      'pending',
      'approved',
      'rejected',
      'returned',
      'awaiting_outcome',
      'evidence_overdue',
      'completed',
      'cancelled'
    ],
    default: 'pending'
  },
  currentStage: {
    type: String,
    enum: ['mentor', 'advisor', 'hod', 'principal', 'completed', 'rejected'],
    default: 'mentor'
  },
  approvalChain: [{
    stage:            { type: String, required: true },
    approverTrackId:  { type: String, required: true },
    approverName:     { type: String, default: '' },
    approverRole:     { type: String, default: '' },
    status:           { type: String, enum: ['approved', 'rejected', 'returned', 'skipped_merged'], default: 'approved' },
    decidedAt:        { type: Date, default: Date.now },
    remarks:          { type: String, default: '' }
  }],
  outcome: {
    primaryOutcome:   {
      type: String,
      enum: [
        'Participated',
        'Shortlisted',
        'Finalist',
        'Runner-Up',
        'Winner',
        'Presented',
        'Published',
        'Selected',
        'Certified',
        null
      ],
      default: null
    },
    submittedAt:      { type: Date, default: null },
    dueAt:            { type: Date, default: null },
    reminderSentAt:   { type: Date, default: null },
    evidence: {
      driveFileId:    { type: String, default: null },
      webViewLink:    { type: String, default: null },
      md5Checksum:    { type: String, default: null },
      fileName:       { type: String, default: null },
      mimeType:       { type: String, default: null },
      sizeBytes:      { type: Number, default: 0 }
    }
  },
  verification: {
    status:           { type: String, enum: ['pending', 'verified', 'invalid', 'needs_correction'], default: 'pending' },
    verifiedByTrackId:{ type: String, default: null },
    verifiedByName:   { type: String, default: null },
    verifiedByRole:   { type: String, default: null },
    verifiedAt:       { type: Date, default: null },
    comment:          { type: String, default: '' },
    duplicateFlag:    { type: String, default: null }
  },
  partialRejections: [{
    dates:            [{ type: String }],
    periods:          [{ type: Number }],
    rejectedBy:       { type: String, required: true },
    rejectedAt:       { type: Date, default: Date.now },
    reason:           { type: String, required: true }
  }],
  history: [{
    action:           { type: String, required: true },
    actorId:          { type: String, required: true },
    actorName:        { type: String, default: '' },
    actorRole:        { type: String, default: '' },
    at:               { type: Date, default: Date.now },
    comment:          { type: String, default: '' }
  }]
}, { timestamps: true });

ODRequestSchema.pre('save', function () {
  if (!this.trackId && this.requestId) {
    this.trackId = this.requestId;
  }
});

ODRequestSchema.pre('validate', function () {
  if (!this.trackId && this.requestId) {
    this.trackId = this.requestId;
  }
});

ODRequestSchema.index({ studentTrackId: 1, createdAt: -1 });
ODRequestSchema.index({ classId: 1, status: 1 });
ODRequestSchema.index({ deptCode: 1, status: 1 });
ODRequestSchema.index({ currentStage: 1, status: 1 });
ODRequestSchema.index({ dates: 1, studentTrackId: 1 });
ODRequestSchema.index({ eventId: 1 });
ODRequestSchema.index({ status: 1, currentStage: 1, deptCode: 1 });
ODRequestSchema.index({ dates: 1, deptCode: 1 });

const ODRequestModel = mongoose.models.ODRequest || mongoose.model('ODRequest', ODRequestSchema);

// ── Group OD Invite Model (Teacher -> Student Head -> Members -> OD Request) ──
const GroupODInviteSchema = new mongoose.Schema({
  inviteId:           { type: String, unique: true, required: true }, // TR-GOD-00000
  facultyTrackId:     { type: String, required: true },
  facultyName:        { type: String, required: true },
  teamHeadTrackId:    { type: String, required: true },
  teamHeadName:       { type: String, required: true },
  teamHeadRegNo:      { type: String, default: '' },
  teamHeadDept:       { type: String, default: '' },
  teamHeadClass:      { type: String, default: '' },
  status: {
    type: String,
    enum: ['invited', 'submitted_by_student', 'completed', 'cancelled'],
    default: 'invited'
  },
  eventDetails: {
    name:             { type: String, default: '' },
    organizer:        { type: String, default: '' },
    type:             { type: String, default: 'Technical' },
    subType:          { type: String, default: 'Symposium' },
    level:            { type: String, default: 'Inter-Collegiate' },
    mode:             { type: String, default: 'Offline' },
    hostCollege:      { type: String, default: '' },
    city:             { type: String, default: '' },
    venue:            { type: String, default: '' },
    startDate:        { type: String, default: '' },
    endDate:          { type: String, default: '' },
    description:      { type: String, default: '' }
  },
  members: [{
    studentTrackId:   { type: String, required: true },
    studentName:      { type: String, default: '' },
    studentRegNo:     { type: String, default: '' },
    className:        { type: String, default: '' },
    deptCode:         { type: String, default: '' }
  }],
  notes:              { type: String, default: '' },
  submittedAt:        { type: Date, default: null }
}, { timestamps: true });

GroupODInviteSchema.index({ teamHeadTrackId: 1, status: 1 });
GroupODInviteSchema.index({ facultyTrackId: 1, status: 1 });

const GroupODInviteModel = mongoose.models.GroupODInvite || mongoose.model('GroupODInvite', GroupODInviteSchema);

module.exports = {
  ODRequest: ODRequestModel,
  GroupODInvite: GroupODInviteModel
};
