const mongoose = require('mongoose');
const { Schema } = mongoose;

// ── Sub-schemas ──

const PeriodSchema = new Schema({
  periodNumber: Number,
  number:       Number,
  start:        String,       // '08:30'
  end:          String,       // '09:15'
  label:        String,       // 'Period 1'
  isBreak:      { type: Boolean, default: false },
  breakType:    { type: String, default: 'None' },
  type:         { type: String, enum: ['period', 'break', 'lunch', 'tea', 'Interval'], default: 'period' }
}, { _id: false });

const GridSlotSchema = new Schema({
  day:            String,                                         // 'Monday'
  period:         Number,                                         // 1-9
  assignmentId:   { type: Schema.Types.ObjectId, ref: 'CurriculumAssignment' },
  subject:        String,
  subjectId:      { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
  teacher:        String,
  teacherId:      { type: Schema.Types.ObjectId, ref: 'Teacher', default: null },
  teacherTrackId: { type: String, default: '' },
  room:           String,
  roomId:         { type: Schema.Types.ObjectId, ref: 'Room' },
  combinedWith:   [String],
  isLab:          Boolean,
  span:           { type: Number, default: 1 },
  state:          String,
  activityId:     { type: Schema.Types.ObjectId, ref: 'SpecialActivity', default: null },
  activityLabel:  { type: String, default: '' }
}, { _id: false });


// ── Core timetable slot record (individual teacher slots) ──

const TimetableSchema = new Schema({
  trackId:       { type: String, required: true },                 // Teacher track identifier
  teacherName:   { type: String, required: true },
  classId:       { type: Schema.Types.ObjectId, ref: 'Class', required: true },
  className:     { type: String, required: true },
  subjectId:     { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
  subjectName:   { type: String, default: '' },
  activityId:    { type: Schema.Types.ObjectId, ref: 'SpecialActivity', default: null },
  activityLabel: { type: String, default: '' },
  day:           { type: String, enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], required: true },
  start:         { type: String, required: true },                 // '08:30'
  end:           { type: String, required: true },                 // '09:15'
}, { timestamps: true });


// ── Production section timetable (slots as Mixed object) ──

const SectionTimetableSchema = new Schema({
  classId:   { type: Schema.Types.ObjectId, ref: 'Class', required: true, unique: true },
  className: String,
  deptId:    { type: Schema.Types.ObjectId, ref: 'Department' },
  deptName:  String,
  slots:     { type: Schema.Types.Mixed, default: {} },
  updatedBy: String,
}, { timestamps: true });


// ── Timing set definitions ──

const TimingSetSchema = new Schema({
  code:              { type: String },                           // 'SET_1'
  name:              { type: String },                           // 'Timing Set 1 (Years I & IV)'
  applicableYears:   [{ type: Schema.Types.Mixed }],             // ['1', '4', 'I', 'IV']
  periods:           [PeriodSchema],
  morningBreakAfter: Number,
  lunchAfter:        Number,
  isDefault:         { type: Boolean, default: false },
}, { timestamps: true });


// ── Building schema (campus building hierarchy) ──

const BuildingSchema = new Schema({
  name:      { type: String, required: true, trim: true },
  subName:   { type: String, trim: true, default: '' },
  code:      { type: String, required: true, trim: true, uppercase: true },
  type:      { type: String, enum: ['Academic', 'Laboratory', 'Administrative', 'Hostel', 'Sports', 'Other'], default: 'Academic' },
  campus:    { type: String, trim: true, default: 'Main Campus' },
  floors:    { type: Number, default: 1, min: 1, max: 50 },
  ip:        { type: String, trim: true, default: '' },
  status:    { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  latitude:  { type: Number, min: -90, max: 90 },
  longitude: { type: Number, min: -180, max: 180 },
}, { timestamps: true });

BuildingSchema.index({ code: 1, campus: 1 }, { unique: true });


// ── Room schema (campus room management & capacity validation) ──

const RoomSchema = new Schema({
  hallNo:           { type: String, required: true, trim: true },
  name:             { type: String, trim: true, default: '' },
  category:         { type: String, enum: ['Room', 'Hall', 'Lab'], default: 'Room' },
  type:             { type: String, enum: ['Theory', 'Lab', 'Seminar', 'Workshop', 'Other'], default: 'Theory' },
  capacity:         { type: Number, required: true, min: 1, max: 2000 },
  buildingId:       { type: Schema.Types.ObjectId, ref: 'Building' },
  buildingName:     { type: String, default: '' },
  floor:            { type: Number, default: 0, min: 0, max: 50 },
  status:           { type: String, enum: ['Available', 'Reserved', 'Maintenance', 'Temporarily Unavailable', 'Inactive'], default: 'Available' },
  deptId:           { type: Schema.Types.ObjectId, ref: 'Department' },
  deptName:         { type: String, default: '' },
  ipAddress:        { type: String, trim: true, default: '' },
  wifiSpeed:        { type: String, trim: true, default: '150 Mbps' },
  mobileSpeed:      { type: String, trim: true, default: '5G' },
  incharge:         {
    name:  { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
  },
  workstationsCount:{ type: Number, default: 0 },
  labStatus:        { type: String, enum: ['Available', 'In-Use', 'Maintenance'], default: 'Available' },
  bookings:         [{
    bookingId: { type: String, required: true },
    title:     { type: String, required: true },
    organizer: { type: String, default: '' },
    date:      { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime:   { type: String, required: true },
    status:    { type: String, enum: ['Confirmed', 'Pending', 'Cancelled'], default: 'Confirmed' },
    notes:     { type: String, default: '' },
    bookedBy:  { type: String, default: '' },
    bookedAt:  { type: Date, default: Date.now }
  }],
  latitude:         { type: Number, min: -90, max: 90 },
  longitude:        { type: Number, min: -180, max: 180 },
  locationAccuracy: { type: Number, min: 0 },
  geofenceRadius:   { type: Number, default: 50, min: 5, max: 1000 },
  capacityHistory:  [{
    oldCapacity: Number,
    newCapacity: Number,
    changedBy:   String,
    changedAt:   { type: Date, default: Date.now },
    reason:      String,
  }],
  statusHistory:    [{
    oldStatus: String,
    newStatus: String,
    changedBy: String,
    changedAt: { type: Date, default: Date.now },
    reason:    String,
    affectedSlots: Number,
  }],
}, { timestamps: true });

RoomSchema.index({ buildingId: 1, floor: 1, hallNo: 1 }, { unique: true });
RoomSchema.index({ status: 1 });
RoomSchema.index({ deptId: 1 });


// ── SmartBoard schema (board registry - physical layer) ──

const SmartBoardSchema = new Schema({
  boardName:       { type: String, required: true, trim: true },
  deviceId:        { type: String, required: true, unique: true, trim: true },
  buildingId:      { type: Schema.Types.ObjectId, ref: 'Building' },
  roomId:          { type: Schema.Types.ObjectId, ref: 'Room' },
  status:          { type: String, enum: ['Active', 'Inactive', 'Maintenance'], default: 'Active' },
  firmwareVersion: { type: String, default: '' },
  registeredAt:    { type: Date, default: Date.now },
  registeredBy:    String,
  assignmentHistory: [{
    roomId:     Schema.Types.ObjectId,
    roomHallNo: String,
    assignedBy: String,
    assignedAt: { type: Date, default: Date.now },
    removedAt:  Date,
    reason:     String,
  }],
  // ── Plan 2: Board Integration Fields ──
  boardApiKey:     { type: String, default: '' }, // Cryptographic device authorization key
  connectionStatus: { type: String, enum: ['Connected', 'Disconnected', 'Reconnecting', 'Unauthorized', 'Maintenance'], default: 'Disconnected' },
  currentIp:       { type: String, default: '' },
  ipType:          { type: String, enum: ['IPv4', 'IPv6', ''], default: '' },
  networkStatus:   { type: String, enum: ['online', 'offline', 'degraded', ''], default: 'offline' },
  lastConnectedAt: Date,
  lastSeenAt:      Date,
  lastHeartbeatAt: Date,
  ipHistory: [{
    ip:         String,
    ipType:     String,
    detectedAt: { type: Date, default: Date.now },
    userAgent:  String,
  }],
  telemetry: { type: Schema.Types.Mixed, default: {} },
  pairingCode: { type: String, trim: true, default: '' },
  pairingCodeExpiresAt: { type: Date, default: null },
}, { timestamps: true });

SmartBoardSchema.index({ roomId: 1 });
SmartBoardSchema.index({ connectionStatus: 1 });
SmartBoardSchema.index({ boardApiKey: 1 });
SmartBoardSchema.index({ pairingCode: 1 });


// ── Curriculum assignment (subject → teacher → class mapping for auto-generation) ──

const CurriculumAssignmentSchema = new Schema({
  classId:          { type: Schema.Types.ObjectId, ref: 'Class', required: true },
  subjectId:        { type: Schema.Types.ObjectId, ref: 'Subject' },
  subjectShortName: String,
  staffId:          { type: Schema.Types.ObjectId, ref: 'User' },
  staffName:        String,
  credits:          Number,
  periodsPerWeek:   { type: Number, min: 1 },
  preferredPeriods: [Number],
  roomPreference:   String,
}, { timestamps: true });


// ── Semester template (master grid per class — draft/published/archived) ──

const SemesterTemplateSchema = new Schema({
  classId:      { type: Schema.Types.ObjectId, ref: 'Class', required: true },
  timingSetId:  { type: Schema.Types.ObjectId, ref: 'TimingSet' },
  academicYear: String,
  semester:     String,
  status:       { type: String, enum: ['draft', 'pending_approval', 'approved', 'published', 'archived'], default: 'draft' },
  grid:         [GridSlotSchema],
  version:      { type: Number, default: 1 },
  versionName:  { type: String, default: '' },
  publishedAt:  Date,
  publishedBy:  String,
}, { timestamps: true });

SemesterTemplateSchema.index({ classId: 1, academicYear: 1, semester: 1, status: 1 });


// ── Week instance (per-week snapshot of a semester template) ──

const WeekInstanceSchema = new Schema({
  semesterTemplateId: { type: Schema.Types.ObjectId, ref: 'SemesterTemplate', required: true },
  weekStartDate:      Date,
  status:             { type: String, enum: ['Generated', 'Modified', 'Published', 'Locked'], default: 'Generated' },
  modifiedSlots:      [GridSlotSchema],
}, { timestamps: true });


// ── Day-level overrides (cancel, substitute, room change, holiday) ──

const OverrideSchema = new Schema({
  date:         Date,
  classId:      { type: Schema.Types.ObjectId, ref: 'Class' },
  period:       Number,
  type:         { type: String, enum: ['cancelled', 'substitute', 'room_change', 'holiday'], required: true },
  originalSlot: Schema.Types.Mixed,
  newSlot:      Schema.Types.Mixed,
  reason:       String,
  approvedBy:   String,
  requestId:    String,
}, { timestamps: true });

OverrideSchema.index({ classId: 1, date: 1, period: 1 });


// ── Version history & verification (development drafts and production snapshots) ──

const TimetableVersionSchema = new Schema({
  semesterTemplateId:  { type: Schema.Types.ObjectId, ref: 'SemesterTemplate' },
  classId:             { type: Schema.Types.ObjectId, ref: 'Class' },
  className:           { type: String, default: '' },
  type:                { type: String, enum: ['development', 'production'], default: 'development' },
  version:             { type: Number, default: 1 },
  versionName:         { type: String, default: '' },
  label:               String,
  changeSummary:       String,
  snapshot:            Schema.Types.Mixed,
  status:              { type: String, enum: ['draft', 'pending_approval', 'approved', 'published', 'rejected', 'archived'], default: 'draft' },
  publishedBy:         String,
  publishedAt:         Date,
  savedBy:             String,
  verificationStatus:  { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
  verificationRequest: {
    requestedBy: String,
    requestedAt: Date,
    notes:       String,
    hodId:       { type: Schema.Types.ObjectId, ref: 'User' },
    hodName:     String,
    approvedBy:  String,
    approvedAt:  Date,
    comment:     String
  },
}, { timestamps: true });

TimetableVersionSchema.index({ classId: 1, type: 1, version: -1 });
TimetableVersionSchema.index({ status: 1 });
TimetableVersionSchema.index({ verificationStatus: 1 });


// ── Substitution requests (teacher leave substitution workflow) ──

const SubstitutionRequestSchema = new Schema({
  leaveRequestId:      String,
  teacherId:           String,
  teacherName:         String,
  date:                Date,
  affectedSlots:       [Schema.Types.Mixed],
  candidateSubstitutes: [Schema.Types.Mixed],
  assignedSubstitutes:  [Schema.Types.Mixed],
  status:              { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedBy:          String,
  reason:              String,
}, { timestamps: true });


// ── Layout presets (saved scheduling configurations) ──

const LayoutPresetSchema = new Schema({
  name:              { type: String, required: true, trim: true },
  description:       String,
  workingDays:       [String],
  defaultLabDuration: { type: Number, default: 3 },
  defaultRoomType:   String,
  timingSet:         String,
  preferredSubjects: [String],
  grid:              [GridSlotSchema],
  isStructuralTemplate: { type: Boolean, default: false },
  createdBy:         String,
  version:           { type: Number, default: 1 },
}, { timestamps: true });


// ── Day instances (resolved authoritative per-date daily schedule) ──

const DayInstanceSchema = new Schema({
  classId:             { type: Schema.Types.ObjectId, ref: 'Class', required: true },
  date:                { type: String, required: true }, // 'YYYY-MM-DD'
  day:                 { type: String, required: true },
  semesterTemplateId:  { type: Schema.Types.ObjectId, ref: 'SemesterTemplate' },
  weekInstanceId:      { type: Schema.Types.ObjectId, ref: 'WeekInstance' },
  isHoliday:           { type: Boolean, default: false },
  holidayReason:       { type: String, default: '' },
  slots: [{
    period:                   Number,
    span:                     { type: Number, default: 1 },
    subject:                  String,
    subjectCode:              String,
    teacher:                  String,
    teacherId:                { type: Schema.Types.ObjectId, ref: 'Teacher' },
    teacherTrackId:           String,
    room:                     String,
    roomId:                   { type: Schema.Types.ObjectId, ref: 'Room' },
    isLab:                    Boolean,
    isCancelled:              Boolean,
    isSubstituted:            Boolean,
    substituteTeacher:        String,
    substituteTeacherTrackId: String,
    overrideId:               { type: Schema.Types.ObjectId, ref: 'Override' },
    activityId:               { type: Schema.Types.ObjectId, ref: 'SpecialActivity', default: null },
    activityLabel:            { type: String, default: '' },
    note:                     String
  }],
  resolvedAt:          { type: Date, default: Date.now },
  resolvedBy:          String
}, { timestamps: true });
DayInstanceSchema.index({ classId: 1, date: 1 }, { unique: true });


// ── Exports ──

const OverrideModel = mongoose.model('Override', OverrideSchema);

module.exports = {
  Timetable:              mongoose.model('Timetable', TimetableSchema),
  SectionTimetable:       mongoose.model('SectionTimetable', SectionTimetableSchema),
  TimingSet:              mongoose.model('TimingSet', TimingSetSchema),
  Building:               mongoose.model('Building', BuildingSchema),
  Room:                   mongoose.model('Room', RoomSchema),
  SmartBoard:             mongoose.model('SmartBoard', SmartBoardSchema),
  CurriculumAssignment:   mongoose.model('CurriculumAssignment', CurriculumAssignmentSchema),
  SemesterTemplate:       mongoose.model('SemesterTemplate', SemesterTemplateSchema),
  WeekInstance:           mongoose.model('WeekInstance', WeekInstanceSchema),
  Override:               OverrideModel,
  TimetableDayOverride:   OverrideModel,
  TimetableVersion:       mongoose.model('TimetableVersion', TimetableVersionSchema),
  SubstitutionRequest:    mongoose.model('SubstitutionRequest', SubstitutionRequestSchema),
  LayoutPreset:           mongoose.model('LayoutPreset', LayoutPresetSchema),
  DayInstance:            mongoose.model('DayInstance', DayInstanceSchema),
};