const mongoose = require('mongoose');

// Timetable slot schema definition (individual teacher slots)
const TimetableSchema = new mongoose.Schema({
  trackId: { type: String, required: true }, // Teacher track identifier
  teacherName: { type: String, required: true },
  deptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  className: { type: String, required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  subjectName: { type: String, required: true },
  day: { type: String, enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], required: true },
  start: { type: String, required: true },
  end: { type: String, required: true },
  periodNumber: { type: Number },
  span: { type: Number, default: 1 }, // Continuous periods span (e.g., 3 for labs)
  startPeriod: { type: Number },
  endPeriod: { type: Number },
  timingSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'TimingSet', default: null },
  timingSetName: { type: String, default: '' },
  type: { type: String, enum: ['Theory', 'Lab', 'Combined', 'Elective'], default: 'Theory' },
  hallNo: { type: String, default: '' },
  hallCapacity: { type: Number },
  isCombined: { type: Boolean, default: false },
  combinedClassIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
  combinedClassNames: [String],
  isSubstitute: { type: Boolean, default: false },
  originalTeacherId: { type: String, default: '' },
  // Dev Mode draft tracking & cross-department conflict sync:
  isDraft: { type: Boolean, default: false },
  draftId: { type: mongoose.Schema.Types.ObjectId, ref: 'TimetableDraft', default: null },
  slotKey: { type: String }, // e.g. 'Monday_1'
}, { timestamps: true });

TimetableSchema.index({ trackId: 1, day: 1, periodNumber: 1, isDraft: 1 });
TimetableSchema.index({ hallNo: 1, day: 1, periodNumber: 1, isDraft: 1 });
TimetableSchema.index({ draftId: 1 });

// Production section timetable schema
const SectionTimetableSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, unique: true },
  className: String,
  deptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  deptName: String,
  timingSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'TimingSet', default: null },
  timingSetName: String,
  slots: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedBy: String,
}, { timestamps: true });

// Development Mode draft timetable schema (working copy with HOD review workflow)
const TimetableDraftSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  className: String,
  deptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  deptName: String,
  timingSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'TimingSet', default: null },
  timingSetName: String,
  slots: { type: mongoose.Schema.Types.Mixed, default: {} },
  classMeta: {
    hallNo: { type: String, default: '' },
    advisorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null },
    advisorName: { type: String, default: '' }
  },
  status: {
    type: String,
    enum: ['draft', 'pending_hod_approval', 'changes_requested', 'published'],
    default: 'draft'
  },
  createdBy: String, // Coordinator trackId
  createdByName: String,
  updatedBy: String,
  // HOD Submission & Review:
  submittedAt: Date,
  submissionNote: String,
  hodRemarks: String,
  reviewedBy: String, // HOD trackId
  reviewedByName: String,
  reviewedAt: Date,
  validationErrors: [{ type: String }],
}, { timestamps: true });

TimetableDraftSchema.index({ classId: 1, status: 1 });
TimetableDraftSchema.index({ deptId: 1, status: 1 });

// Backup schema for archiving replaced production timetables
const TimetableBackupSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  className: String,
  deptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  deptName: String,
  slots: { type: mongoose.Schema.Types.Mixed, default: {} },
  approvedBy: String, // HOD who confirmed
  publishedAt: { type: Date },
  archivedAt: { type: Date, default: Date.now },
  versionLabel: String,
}, { timestamps: true });

// Version changelog schema
const TimetableVersionSchema = new mongoose.Schema({
  deptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  deptName: String,
  classIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
  submittedBy: String, // Coordinator
  approvedBy: String, // HOD
  publishedAt: { type: Date, default: Date.now },
  summary: String,
  changeLog: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

// ── NEW SCHEMAS FOR PLAN 2 (FEATURES 4 & 13) ──

// Building Schema for campus building hierarchy
const BuildingSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  floors: { type: Number, default: 4 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Room Schema for campus room management & capacity validation
const RoomSchema = new mongoose.Schema({
  hallNo: { type: String, required: true, unique: true, trim: true },
  name: { type: String, trim: true },
  type: { type: String, enum: ['Theory', 'Lab', 'Seminar', 'Workshop', 'Other'], default: 'Theory' },
  capacity: { type: Number, required: true, default: 60 },
  buildingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Building', default: null },
  buildingName: { type: String, default: '' },
  floor: { type: Number, default: 1 },
  deptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  deptName: { type: String, default: '' },
  facilities: [{ type: String }],
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

RoomSchema.index({ type: 1 });
RoomSchema.index({ buildingId: 1 });

// Timing Set Schema for institutional staggered timing sets
const TimingSetSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true }, // 'SET_1', 'SET_2'
  name: { type: String, required: true }, // 'Timing Set 1 (Years I & IV)', 'Timing Set 2 (Years II & III)'
  applicableYears: [{ type: String }], // ['1', '4', 'I', 'IV']
  periods: [{
    periodNumber: { type: Number, required: true },
    start: { type: String, required: true }, // '08:30'
    end: { type: String, required: true }, // '09:15'
    label: { type: String }, // 'Period 1'
    isBreak: { type: Boolean, default: false },
    breakType: { type: String, enum: ['Interval', 'Lunch', 'Tea', 'None'], default: 'None' }
  }],
  isDefault: { type: Boolean, default: false }
}, { timestamps: true });

// Academic Week Instance Schema (Tier 2 in Storage Hierarchy)
const TimetableWeekSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  className: { type: String, required: true },
  deptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  deptName: { type: String },
  academicYear: { type: String },
  semester: { type: String },
  weekNumber: { type: Number, required: true },
  startDate: { type: String, required: true }, // 'YYYY-MM-DD'
  endDate: { type: String, required: true }, // 'YYYY-MM-DD'
  status: { type: String, enum: ['Generated', 'Modified', 'Published', 'Locked'], default: 'Generated' },
  slots: { type: mongoose.Schema.Types.Mixed, default: {} },
  publishedBy: { type: String },
  publishedAt: { type: Date },
}, { timestamps: true });

TimetableWeekSchema.index({ classId: 1, weekNumber: 1 });
TimetableWeekSchema.index({ classId: 1, startDate: 1 });

// Day Instance Overrides Schema (Tier 3 in Storage Hierarchy: date-specific delta overrides)
const TimetableDayOverrideSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  className: { type: String },
  deptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  date: { type: String, required: true }, // 'YYYY-MM-DD'
  day: { type: String, required: true }, // 'Mon', 'Tue', etc.
  isHoliday: { type: Boolean, default: false },
  holidayReason: { type: String, default: '' },
  overrides: [{
    periodNumber: { type: Number, required: true },
    span: { type: Number, default: 1 },
    action: { type: String, enum: ['swap', 'substitute', 'cancel', 'replace'], required: true },
    swapWithPeriod: { type: Number },
    substituteTeacherId: { type: String },
    substituteTeacherName: { type: String },
    originalSlot: { type: mongoose.Schema.Types.Mixed },
    newSlot: { type: mongoose.Schema.Types.Mixed },
    reason: { type: String }
  }],
  status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
  updatedBy: { type: String }
}, { timestamps: true });

// Timetable Template Schema for reusable institutional & department timetable blueprints (Plan 3: Feature 9)
const TimetableTemplateSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true }, // 'FE_STD', 'SE_CORE', 'LAB_HEAVY', 'ENG_MON_FRI', 'ENG_MON_SAT'
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  timingSetCode: { type: String, enum: ['SET_1', 'SET_2'], default: 'SET_1' },
  applicableYears: [{ type: String }], // ['1', '4'] or ['2', '3']
  workingDays: [{ type: String }], // ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  periodsPerDay: { type: Number, default: 9 },
  defaultLabDuration: { type: Number, default: 3 }, // 3 continuous periods
  rules: {
    maxTheoryPerDay: { type: Number, default: 2 },
    maxLabPerDay: { type: Number, default: 1 },
    maxTeacherPeriodsPerDay: { type: Number, default: 4 },
    avoidFirstPeriodLab: { type: Boolean, default: true },
    preferredLabPeriods: [{ type: Number }], // [4, 7] (P4-P6 or P7-P9)
  },
  isSystem: { type: Boolean, default: false },
  deptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  deptName: { type: String, default: '' },
  createdBy: { type: String },
}, { timestamps: true });

TimetableTemplateSchema.index({ deptId: 1 });

module.exports = {
  Timetable: mongoose.model('Timetable', TimetableSchema),
  SectionTimetable: mongoose.model('SectionTimetable', SectionTimetableSchema),
  TimetableDraft: mongoose.model('TimetableDraft', TimetableDraftSchema),
  TimetableBackup: mongoose.model('TimetableBackup', TimetableBackupSchema),
  TimetableVersion: mongoose.model('TimetableVersion', TimetableVersionSchema),
  Room: mongoose.model('Room', RoomSchema),
  Building: mongoose.model('Building', BuildingSchema),
  TimingSet: mongoose.model('TimingSet', TimingSetSchema),
  TimetableWeek: mongoose.model('TimetableWeek', TimetableWeekSchema),
  TimetableDayOverride: mongoose.model('TimetableDayOverride', TimetableDayOverrideSchema),
  TimetableTemplate: mongoose.model('TimetableTemplate', TimetableTemplateSchema),
};