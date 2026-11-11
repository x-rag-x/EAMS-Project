const mongoose = require('mongoose');

// 1. AutoGenDraft — named snapshot of the development workspace
const AutoGenDraftSchema = new mongoose.Schema({
  trackId:              { type: String, required: true, unique: true },
  name:                 { type: String, required: true, trim: true },
  batch:                { type: String, required: true, trim: true },
  deptId:               { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  deptName:             { type: String, default: '' },
  saturdayMode:         { type: String, enum: ['separate', 'copy_weekday'], default: 'separate' },
  pinnedWeekday:        { type: String, enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', ''], default: '' },
  productionSnapshotAt: { type: Date, default: null },
  contents:             { type: mongoose.Schema.Types.Mixed, default: {} }, // classId -> grid
  status:               { type: String, enum: ['active', 'saved', 'archived'], default: 'active' },
  savedBy:              { type: String, default: '' },
  isAutoGenDraft:       { type: Boolean, default: true },
}, { timestamps: true });

AutoGenDraftSchema.index({ deptId: 1, batch: 1 });
AutoGenDraftSchema.index({ status: 1 });

// 2. AutoGenRun — single run attempt record
const AutoGenRunSchema = new mongoose.Schema({
  trackId:        { type: String, required: true, unique: true },
  draftId:        { type: mongoose.Schema.Types.ObjectId, ref: 'AutoGenDraft' },
  deptId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  batch:          { type: String, required: true },
  scope:          { type: String, enum: ['batch', 'single_class'], default: 'batch' },
  targetClassId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Class', default: null },
  effort:         { type: String, enum: ['quick', 'standard', 'thorough'], default: 'thorough' },
  saturdayMode:   { type: String, enum: ['separate', 'copy_weekday'], default: 'separate' },
  combinedGroups: { type: mongoose.Schema.Types.Mixed, default: [] },
  pinnedOrder:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
  status:         { type: String, enum: ['pending', 'running', 'completed', 'stopped', 'failed'], default: 'pending' },
  startedAt:      { type: Date, default: null },
  completedAt:    { type: Date, default: null },
  stoppedBy:      { type: String, default: '' },
  attempts:       { type: Number, default: 0 },
  bestScore:      { type: Number, default: null },
  topVersions:    [{
    versionIndex: { type: Number, default: 0 },
    seed:         String,
    settings:     mongoose.Schema.Types.Mixed,
    score:        Number,
    scorecard:    mongoose.Schema.Types.Mixed,
    grid:         mongoose.Schema.Types.Mixed
  }],
  startedBy:      { type: String, required: true },
  log:            [{ at: { type: Date, default: Date.now }, msg: String }],
}, { timestamps: true });

AutoGenRunSchema.index({ deptId: 1, batch: 1, status: 1 });

// 3. HallShift — hall conflict requests raised by exam overlap
const HallShiftSchema = new mongoose.Schema({
  trackId:          { type: String, required: true, unique: true },
  examId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  date:             { type: String, required: true },
  session:          { type: String, enum: ['FN', 'AN'], required: true },
  classId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  className:        { type: String, default: '' },
  currentHallId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null },
  currentHall:      { type: String, default: '' },
  suggestedHalls:   [{
    hallId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
    hallName: String,
    capacity: Number
  }],
  status:           { type: String, enum: ['pending', 'accepted', 'released'], default: 'pending' },
  acceptedBy:       { type: String, default: '' },
  acceptedAt:       { type: Date, default: null },
  notifiedTeachers: [String],
  notifiedStudents: [String],
}, { timestamps: true });

HallShiftSchema.index({ examId: 1, date: 1 });
HallShiftSchema.index({ status: 1 });

module.exports = {
  AutoGenDraft: mongoose.model('AutoGenDraft', AutoGenDraftSchema),
  AutoGenRun:   mongoose.model('AutoGenRun', AutoGenRunSchema),
  HallShift:    mongoose.model('HallShift', HallShiftSchema),
};
