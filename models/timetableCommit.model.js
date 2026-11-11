const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Grid slot sub-schema matching timetable grid structure
 */
const GridSlotSchema = new Schema({
  day:               { type: String, required: true },
  period:            { type: Number, required: true },
  span:              { type: Number, default: 1 },
  subject:           { type: String, default: '' },
  subjectId:         { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
  subjectCode:       { type: String, default: '' },
  teacher:           { type: String, default: '' },
  teacherId:         { type: Schema.Types.ObjectId, ref: 'Teacher', default: null },
  teacherTrackId:    { type: String, default: '' },
  room:              { type: String, default: '' },
  roomId:            { type: Schema.Types.ObjectId, ref: 'Room', default: null },
  isLab:             { type: Boolean, default: false },
  note:              { type: String, default: '' },
  state:             { type: String, default: '' },
  activityId:        { type: Schema.Types.ObjectId, ref: 'SpecialActivity', default: null },
  activityLabel:     { type: String, default: '' },
  combinedGroupId:   { type: Schema.Types.ObjectId, default: null },
  reservedForDeptId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
  reservedLabel:     { type: String, default: '' }
}, { _id: false });

// ── TimetableCommit: Production History Header ──
const TimetableCommitSchema = new Schema({
  trackId:       { type: String, required: true, unique: true, trim: true }, // e.g. TT-2026-000042
  seq:           { type: Number, required: true },
  type:          { type: String, enum: ['workspace', 'hotfix', 'revert', 'baseline', 'import'], default: 'workspace' },
  workspaceId:   { type: Schema.Types.ObjectId, ref: 'TimetableWorkspace', default: null },
  workspaceName: { type: String, default: '' },
  classIds:      [{ type: Schema.Types.ObjectId, ref: 'Class' }],
  classNames:    [{ type: String }],
  message:       { type: String, required: true, trim: true },
  notes:         { type: String, default: '', trim: true },
  author: {
    id:          { type: Schema.Types.ObjectId, ref: 'User', default: null },
    name:        { type: String, default: '' },
    trackId:     { type: String, default: '' }
  },
  approver: {
    id:          { type: Schema.Types.ObjectId, ref: 'User', default: null },
    name:        { type: String, default: '' },
    trackId:     { type: String, default: '' },
    at:          { type: Date, default: null },
    comment:     { type: String, default: '' }
  },
  goLiveAt:      { type: Date, default: null },
  resolution:    { type: String, enum: ['none', 'merged', 'keep-mine'], default: 'none' },
  status: {
    type: String,
    enum: [
      'pending_approval',
      'approved',
      'rejected',
      'withdrawn',
      'deploying',
      'deployed',
      'deployed_with_warnings',
      'failed'
    ],
    default: 'pending_approval'
  },
  deployRunId:   { type: Schema.Types.ObjectId, ref: 'DeployRun', default: null }
}, { timestamps: true });

TimetableCommitSchema.index({ seq: -1 });
TimetableCommitSchema.index({ status: 1 });
TimetableCommitSchema.index({ classIds: 1 });
TimetableCommitSchema.index({ createdAt: -1 });

// ── TimetableCommitClass: Production History Payload (Per Class) ──
const TimetableCommitClassSchema = new Schema({
  commitTrackId: { type: String, required: true, trim: true },
  classId:       { type: Schema.Types.ObjectId, ref: 'Class', required: true },
  className:     { type: String, default: '' },
  deptId:        { type: Schema.Types.ObjectId, ref: 'Department', default: null },
  version:       { type: Number, required: true, default: 1 },
  parentTrackId: { type: String, default: null },
  grid:          [GridSlotSchema],
  diff: {
    added:       { type: Number, default: 0 },
    modified:    { type: Number, default: 0 },
    removed:     { type: Number, default: 0 },
    unchanged:   { type: Number, default: 0 }
  }
}, { timestamps: true });

TimetableCommitClassSchema.index({ commitTrackId: 1, classId: 1 }, { unique: true });
TimetableCommitClassSchema.index({ classId: 1, version: -1 });

// ── DeployRun: Pipeline Execution Record ──
const DeployStageSchema = new Schema({
  key:        { type: Number, required: true }, // 0 to 7
  label:      { type: String, required: true },
  status:     { type: String, enum: ['pending', 'running', 'success', 'warning', 'failed', 'skipped'], default: 'pending' },
  startedAt:  { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  counts:     { type: Schema.Types.Mixed, default: {} },
  error:      { type: String, default: null },
  retryable:  { type: Boolean, default: false }
}, { _id: false });

const DeployRunSchema = new Schema({
  commitTrackId: { type: String, required: true, trim: true },
  startedBy: {
    id:          { type: Schema.Types.ObjectId, ref: 'User', default: null },
    name:        { type: String, default: '' },
    trackId:     { type: String, default: '' }
  },
  startedAt:     { type: Date, default: Date.now },
  finishedAt:    { type: Date, default: null },
  status: {
    type: String,
    enum: ['running', 'success', 'success_with_warnings', 'failed'],
    default: 'running'
  },
  stages: [DeployStageSchema],
  report: {
    assignments: {
      created:   { type: Number, default: 0 },
      updated:   { type: Number, default: 0 },
      repointed: { type: Number, default: 0 },
      removed:   { type: Number, default: 0 },
      orphans:   [{ type: String }]
    },
    boards: {
      rooms:     { type: Number, default: 0 },
      pushed:    { type: Number, default: 0 },
      failed:    { type: Number, default: 0 }
    },
    notifications: {
      teachers:       { type: Number, default: 0 },
      students:       { type: Number, default: 0 },
      hods:           { type: Number, default: 0 },
      supportingHods: { type: Number, default: 0 }
    },
    cache: {
      invalidated: { type: Boolean, default: false }
    }
  }
}, { timestamps: true });

DeployRunSchema.index({ commitTrackId: 1 });
DeployRunSchema.index({ startedAt: -1 });

const TimetableCommit = mongoose.model('TimetableCommit', TimetableCommitSchema);
const TimetableCommitClass = mongoose.model('TimetableCommitClass', TimetableCommitClassSchema);
const DeployRun = mongoose.model('DeployRun', DeployRunSchema);

module.exports = {
  TimetableCommit,
  TimetableCommitClass,
  DeployRun
};
