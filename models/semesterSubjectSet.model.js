const mongoose = require('mongoose');
const { normalizeYearRange } = require('../utils/yearFormat');

const SubjectEntrySchema = new mongoose.Schema({
  subjectId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  teachingDeptId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  teachingDeptName:  { type: String, default: '' },
  slotsMin:          { type: Number, default: 5 },
  slotsTarget:       { type: Number, default: 5 },
  slotsMax:          { type: Number, default: 7 },
  blockLength:       { type: Number, default: 1 },
  isBlend:           { type: Boolean, default: false },
  blendTheorySlots:  { type: Number, default: 0 },
  blendLabSlots:     { type: Number, default: 0 },
  category:          { type: String, enum: ['important', 'easy', 'hard'], default: 'easy' },
  component:         { type: String, enum: ['theory', 'lab', 'both'], default: 'both' },
}, { _id: false });

const CombinedGroupSchema = new mongoose.Schema({
  subjectId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  subjectName: { type: String, default: '' },
  classIds:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
  classNames:  [{ type: String }],
}, { _id: false });

const ClassOverrideSchema = new mongoose.Schema({
  classId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  className:   { type: String, default: '' },
  subjectId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  slotsMin:    { type: Number },
  slotsTarget: { type: Number },
  slotsMax:    { type: Number },
}, { _id: false });

const ApprovalLogEntrySchema = new mongoose.Schema({
  action:    { type: String, required: true }, // 'Created', 'Submitted', 'HOD_Approved', 'Locked', 'Amended'
  by:        { type: String, default: '' },
  at:        { type: Date, default: Date.now },
  comment:   { type: String, default: '' },
  amendment: { type: Boolean, default: false },
  reason:    { type: String, default: '' },
}, { _id: false });

const SemesterSubjectSetSchema = new mongoose.Schema({
  trackId:           { type: String, required: true, unique: true },
  regulation:        { type: String, required: true, trim: true },
  deptId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  deptName:          { type: String, default: '' },
  batch:             { type: String, required: true, trim: true, set: v => normalizeYearRange(v) },
  year:              { type: String, enum: ['I', 'II', 'III', 'IV'], required: true },
  semester:          { type: String, enum: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'], required: true },
  classIds:          [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
  subjects:          [SubjectEntrySchema],
  perClassOverrides: [ClassOverrideSchema],
  combinedGroups:    [CombinedGroupSchema],
  status:            { type: String, enum: ['Draft', 'Submitted', 'HOD_Approved', 'Locked'], default: 'Draft' },
  approvalLog:       [ApprovalLogEntrySchema],
  lockedAt:          { type: Date, default: null },
  lockedBy:          { type: String, default: '' },
  clonedFrom:        { type: mongoose.Schema.Types.ObjectId, ref: 'SemesterSubjectSet', default: null },
  createdBy:         { type: String, default: '' },
}, { timestamps: true });

SemesterSubjectSetSchema.index({ deptId: 1, batch: 1, year: 1, semester: 1 });
SemesterSubjectSetSchema.index({ status: 1 });
SemesterSubjectSetSchema.index({ regulation: 1 });

module.exports = {
  SemesterSubjectSet: mongoose.model('SemesterSubjectSet', SemesterSubjectSetSchema),
};
