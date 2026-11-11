const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * GridSlotSchema: Canonical slot shape across workspaces and commits
 */
const GridSlotSchema = new Schema({
  day:                { type: String, required: true },
  period:             { type: Number, required: true },
  span:               { type: Number, default: 1 },
  spanRootPeriod:     { type: Number, default: null },
  spanIndex:          { type: Number, default: 0 },
  isSpanContinuation: { type: Boolean, default: false },
  subject:            { type: String, default: '' },
  subjectId:          { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
  subjectCode:        { type: String, default: '' },
  teacher:            { type: String, default: '' },
  teacherId:          { type: Schema.Types.ObjectId, ref: 'Teacher', default: null },
  teacherTrackId:     { type: String, default: '' },
  room:               { type: String, default: '' },
  roomId:             { type: Schema.Types.ObjectId, ref: 'Room', default: null },
  isLab:              { type: Boolean, default: false },
  type:               { type: String, default: 'Theory' },
  combinedWith:       [{ type: String }],
  combinedGroupId:    { type: Schema.Types.ObjectId, default: null },
  reservedForDeptId:  { type: Schema.Types.ObjectId, ref: 'Department', default: null },
  reservedLabel:      { type: String, default: '' },
  state:              { type: String, default: '' },
  activityId:         { type: Schema.Types.ObjectId, ref: 'SpecialActivity', default: null },
  activityLabel:      { type: String, default: '' },
  primaryClassId:     { type: Schema.Types.ObjectId, ref: 'Class', default: null },
  primaryClassName:   { type: String, default: '' },
  note:               { type: String, default: '' }
}, { _id: false });

// ── TimetableWorkspace: Workspace Definition ──
const TimetableWorkspaceSchema = new Schema({
  trackId:       { type: String, required: true, unique: true, trim: true }, // e.g. WS-2026-000007
  name:          { type: String, required: true, trim: true },
  slug:          { type: String, required: true, trim: true, lowercase: true },
  deptId:        { type: Schema.Types.ObjectId, ref: 'Department', required: true },
  deptName:      { type: String, default: '' },
  ownerId:       { type: Schema.Types.ObjectId, ref: 'Teacher', required: true },
  ownerName:     { type: String, default: '' },
  academicYear:  { type: String, default: '' },
  semester:      { type: Schema.Types.Mixed, default: 'Odd' },
  label:         { type: String, default: '' },
  status:        { type: String, enum: ['open', 'archived'], default: 'open' },
  classIds:      [{ type: Schema.Types.ObjectId, ref: 'Class' }],
  forkedFrom: {
    kind:        { type: String, enum: ['production', 'workspace'], default: 'production' },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'TimetableWorkspace', default: null },
    atTrackId:   { type: String, default: null }
  },
  collaborators: [{
    teacherId:   { type: Schema.Types.ObjectId, ref: 'Teacher', required: true },
    teacherName: { type: String, default: '' },
    role:        { type: String, enum: ['editor', 'viewer'], default: 'editor' },
    addedBy:     { type: Schema.Types.ObjectId, ref: 'User' },
    addedAt:     { type: Date, default: Date.now }
  }],
  versionBucketMinutes: { type: Number, enum: [5, 10, 15, 30, 60], default: 15 },
  seq:           { type: Number, default: 0 },
  lastActivityAt:{ type: Date, default: Date.now },
  createdBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  archivedAt:    { type: Date, default: null },
  archivedBy:    { type: Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

TimetableWorkspaceSchema.index({ deptId: 1, slug: 1 }, { unique: true });
TimetableWorkspaceSchema.index({ deptId: 1, status: 1 });
TimetableWorkspaceSchema.index({ ownerId: 1, status: 1 });
TimetableWorkspaceSchema.index({ 'collaborators.teacherId': 1 });

// ── WorkspaceClassDraft: Per-Class Working Grid in Workspace ──
const WorkspaceClassDraftSchema = new Schema({
  workspaceId:       { type: Schema.Types.ObjectId, ref: 'TimetableWorkspace', required: true },
  classId:           { type: Schema.Types.ObjectId, ref: 'Class', required: true },
  className:         { type: String, default: '' },
  grid:              [GridSlotSchema],
  baseTrackId:       { type: String, default: null },
  baseSeq:           { type: Number, default: 0 },
  slotRevs:          { type: Schema.Types.Mixed, default: {} },
  seq:               { type: Number, default: 0 },
  revision:          { type: Number, default: 1 },
  state:             { type: String, enum: ['editing', 'submitted', 'approved', 'rejected', 'deployed'], default: 'editing' },
  submittedTrackId:  { type: String, default: null },
  updatedBy:         { type: Schema.Types.ObjectId, ref: 'User', default: null },
  updatedByName:     { type: String, default: '' }
}, { timestamps: true });

WorkspaceClassDraftSchema.index({ workspaceId: 1, classId: 1 }, { unique: true });
WorkspaceClassDraftSchema.index({ classId: 1 });

// ── WorkspaceCheckpoint: Development Snapshot Point ──
const WorkspaceCheckpointSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'TimetableWorkspace', required: true },
  seq:         { type: Number, required: true },
  name:        { type: String, required: true, trim: true },
  note:        { type: String, default: '', trim: true },
  kind:        { type: String, enum: ['checkpoint', 'pre-merge', 'restore', 'submit'], default: 'checkpoint' },
  classes: [{
    classId:   { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    className: { type: String, default: '' },
    grid:      [GridSlotSchema],
    stats: {
      slots:    { type: Number, default: 0 },
      added:    { type: Number, default: 0 },
      modified: { type: Number, default: 0 },
      removed:  { type: Number, default: 0 }
    }
  }],
  author: {
    id:        { type: Schema.Types.ObjectId, ref: 'User', default: null },
    name:      { type: String, default: '' }
  },
  createdAt:   { type: Date, default: Date.now }
}, { timestamps: true });

WorkspaceCheckpointSchema.index({ workspaceId: 1, seq: -1 });

// ── WorkspaceShare: Cross-Department & Multi-Role Collaborator Share (Phase 5) ──
const WorkspaceShareSchema = new Schema({
  workspaceId:    { type: Schema.Types.ObjectId, ref: 'TimetableWorkspace', required: true },
  scope:          { type: String, enum: ['workspace', 'draft', 'class'], default: 'workspace' },
  draftId:        { type: Schema.Types.ObjectId, ref: 'TimetableDraft', default: null },
  classId:        { type: Schema.Types.ObjectId, ref: 'Class', default: null }, // legacy or single
  classIds:       [{ type: Schema.Types.ObjectId, ref: 'Class' }],
  toDeptId:       { type: Schema.Types.ObjectId, ref: 'Department', default: null },
  toDeptName:     { type: String, default: '' },
  userId:         { type: Schema.Types.ObjectId, ref: 'User', default: null },
  userName:       { type: String, default: '' },
  userDeptId:     { type: Schema.Types.ObjectId, ref: 'Department', default: null },
  level:          { type: String, enum: ['view', 'fill', 'edit', 'viewer', 'commenter', 'editor'], default: 'viewer' },
  editorMode:     { type: String, enum: ['full', 'fill'], default: 'full' },
  fill: {
    staff:        { type: Boolean, default: true },
    subject:      { type: Boolean, default: true },
    room:         { type: Boolean, default: false },
    assignStaff:  { type: Boolean, default: true },
    assignSubject:{ type: Boolean, default: true },
    assignRoom:   { type: Boolean, default: false }
  },
  source:         { type: String, enum: ['direct', 'link', 'request'], default: 'direct' },
  status:         { type: String, enum: ['active', 'done', 'revoked', 'expired'], default: 'active' },
  expiresAt:      { type: Date, default: null },
  sharedBy: {
    id:           { type: Schema.Types.ObjectId, ref: 'User', default: null },
    name:         { type: String, default: '' }
  },
  sharedAt:       { type: Date, default: Date.now },
  levelChangedAt: { type: Date, default: null },
  doneAt:         { type: Date, default: null },
  revokedAt:      { type: Date, default: null },
  note:           { type: String, default: '', trim: true }
}, { timestamps: true });

WorkspaceShareSchema.index({ workspaceId: 1, toDeptId: 1, status: 1 });
WorkspaceShareSchema.index({ toDeptId: 1, status: 1 });
WorkspaceShareSchema.index({ workspaceId: 1, userId: 1, status: 1 });
WorkspaceShareSchema.index({ userId: 1, status: 1 });

// ── TimetableUserState: Replaces localStorage / sessionStorage for Timetable State ──
const TimetableUserStateSchema = new Schema({
  userId:            { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  env:               { type: String, enum: ['production', 'development'], default: 'production' },
  activeWorkspaceId: { type: Schema.Types.ObjectId, ref: 'TimetableWorkspace', default: null },
  openTabs: [{
    id:              { type: String, required: true },
    title:           { type: String, default: '' },
    sectionName:     { type: String, default: '' },
    viewType:        { type: String, default: 'section' },
    classId:         { type: Schema.Types.Mixed, default: null },
    viewParams:      { type: Schema.Types.Mixed, default: {} },
    mode:            { type: String, default: 'production' }
  }],
  prefs: {
    freezePanes:     { type: Boolean, default: true }
  }
}, { timestamps: true });

// userId index is declared unique on field definition above


// ── TimetableDraft: Named scenario draft within a Development Workspace ──
const TimetableDraftSchema = new Schema({
  trackId:       { type: String, required: true, unique: true, trim: true }, // e.g. DR-2026-000001 or TR-DR-0004
  urlCode:       { type: String, default: '' },
  workspaceId:   { type: Schema.Types.ObjectId, ref: 'TimetableWorkspace', required: true, index: true },
  name:          { type: String, required: true, trim: true },
  classIds:      [{ type: Schema.Types.ObjectId, ref: 'Class' }],
  state:         { type: String, enum: ['editing', 'submitted', 'approved', 'deployed', 'archived'], default: 'editing' },
  seq:           { type: Number, default: 0 },
  lastEditAt:    { type: Date, default: Date.now },
  lastEditBy:    { type: Schema.Types.ObjectId, ref: 'User' },
  versionCount:  { type: Number, default: 0 },
  createdBy:     { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

TimetableDraftSchema.index({ workspaceId: 1, seq: -1 });

// ── DraftOp: Append-only granular cell operation log (Phase 3) ──
const DraftOpSchema = new Schema({
  draftId:     { type: Schema.Types.ObjectId, required: true, index: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'TimetableWorkspace', default: null, index: true },
  classId:     { type: Schema.Types.ObjectId, ref: 'Class', required: true },
  seq:         { type: Number, required: true },
  slotKey:     { type: String, required: true }, // e.g. 'Monday_1'
  type:        { type: String, enum: ['slot.set', 'slot.clear', 'slot.move', 'slot.swap', 'slot.span', 'class.add', 'class.remove', 'autogen', 'restore', 'merge', 'import'], required: true },
  before:      { type: Schema.Types.Mixed, default: null },
  after:       { type: Schema.Types.Mixed, default: null },
  userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
  userName:    { type: String, default: '' },
  deviceId:    { type: String, default: '' },
  clientOpId:  { type: String, required: true }, // ULID from client
  editedAt:    { type: Date, required: true },
  receivedAt:  { type: Date, default: Date.now },
  groupId:     { type: String, default: null },
  offline:     { type: Boolean, default: false }
}, { timestamps: true });

DraftOpSchema.index({ draftId: 1, clientOpId: 1 }, { unique: true });
DraftOpSchema.index({ draftId: 1, seq: -1 });
DraftOpSchema.index({ draftId: 1, classId: 1, slotKey: 1, seq: -1 });

// ── DraftVersion: 15-Minute IST Time Bucket Version (Phase 3) ──
const DraftVersionSchema = new Schema({
  draftId:     { type: Schema.Types.ObjectId, required: true, index: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'TimetableWorkspace', default: null },
  bucketKey:   { type: String, required: true }, // e.g. '2026-10-31T16:15'
  startedAt:   { type: Date, required: true },
  endedAt:     { type: Date, required: true },
  firstSeq:    { type: Number, required: true },
  lastSeq:     { type: Number, required: true },
  opCount:     { type: Number, default: 0 },
  status:      { type: String, enum: ['open', 'closed'], default: 'open' },
  authors: [{
    userId:    { type: Schema.Types.ObjectId, ref: 'User' },
    name:      { type: String, default: '' }
  }],
  classIds:    [{ type: Schema.Types.ObjectId, ref: 'Class' }],
  stats: {
    added:     { type: Number, default: 0 },
    changed:   { type: Number, default: 0 },
    removed:   { type: Number, default: 0 }
  },
  endSnapshot: { type: Schema.Types.Mixed, default: {} }, // { [classId]: [GridSlot] }
  pinned:      { type: Boolean, default: false },
  label:       { type: String, default: '' },
  source:      { type: String, enum: ['auto', 'manual', 'autogen', 'restore', 'merge'], default: 'auto' },
  late:        { type: Boolean, default: false }
}, { timestamps: true });

DraftVersionSchema.index({ draftId: 1, bucketKey: 1, source: 1 });
DraftVersionSchema.index({ draftId: 1, startedAt: -1 });

// ── WorkspaceLink: Shareable Cryptographic URL State (Phase 5) ──
const WorkspaceLinkSchema = new Schema({
  workspaceId:    { type: Schema.Types.ObjectId, ref: 'TimetableWorkspace', required: true },
  scope:          { type: String, enum: ['workspace', 'draft'], default: 'workspace' },
  draftId:        { type: Schema.Types.ObjectId, ref: 'TimetableDraft', default: null },
  level:          { type: String, enum: ['viewer', 'commenter', 'editor'], default: 'viewer' },
  enabled:        { type: Boolean, default: false },
  requireApproval:{ type: Boolean, default: false }, // ALWAYS true for level='editor'
  code:           { type: String, default: '', index: true },
  epoch:          { type: Number, default: 0 },
  expiresAt:      { type: Date, default: null },
  createdBy:      { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

WorkspaceLinkSchema.index({ workspaceId: 1, scope: 1, draftId: 1 });

// ── WorkspaceAccessRequest: Pending Approval Queue (Phase 5) ──
const WorkspaceAccessRequestSchema = new Schema({
  workspaceId:    { type: Schema.Types.ObjectId, ref: 'TimetableWorkspace', required: true },
  draftId:        { type: Schema.Types.ObjectId, ref: 'TimetableDraft', default: null },
  requesterId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  requesterName:  { type: String, required: true },
  requestedLevel: { type: String, enum: ['viewer', 'commenter', 'editor'], required: true },
  via:            { type: String, enum: ['link', 'manual'], default: 'link' },
  status:         { type: String, enum: ['pending', 'approved', 'declined', 'expired'], default: 'pending' },
  decidedBy:      { type: Schema.Types.ObjectId, ref: 'User', default: null },
  decidedAt:      { type: Date, default: null },
  note:           { type: String, default: '' }
}, { timestamps: true });

WorkspaceAccessRequestSchema.index({ workspaceId: 1, requesterId: 1, status: 1 });

// ── WorkspaceComment: Threaded Comments (Phase 5) ──
const WorkspaceCommentSchema = new Schema({
  workspaceId:    { type: Schema.Types.ObjectId, ref: 'TimetableWorkspace', required: true, index: true },
  draftId:        { type: Schema.Types.ObjectId, ref: 'TimetableDraft', default: null },
  anchor: {
    type:         { type: String, enum: ['slot', 'class', 'workspace'], required: true },
    classId:      { type: Schema.Types.ObjectId, ref: 'Class', default: null },
    slotKey:      { type: String, default: '' },
    slotHash:     { type: String, default: '' },
    headTrackId:  { type: String, default: '' }
  },
  threadId:       { type: Schema.Types.ObjectId, default: null },
  parentId:       { type: Schema.Types.ObjectId, default: null },
  body:           { type: String, required: true, maxlength: 1000 },
  authorId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  authorName:     { type: String, required: true },
  mentions:       [{ type: Schema.Types.ObjectId, ref: 'User' }],
  status:         { type: String, enum: ['open', 'resolved'], default: 'open' },
  resolvedBy:     { type: Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt:     { type: Date, default: null }
}, { timestamps: true });

WorkspaceCommentSchema.index({ workspaceId: 1, 'anchor.classId': 1, 'anchor.slotKey': 1 });

module.exports = {
  GridSlotSchema,
  TimetableWorkspace:     mongoose.model('TimetableWorkspace', TimetableWorkspaceSchema),
  WorkspaceClassDraft:    mongoose.model('WorkspaceClassDraft', WorkspaceClassDraftSchema),
  WorkspaceCheckpoint:    mongoose.model('WorkspaceCheckpoint', WorkspaceCheckpointSchema),
  WorkspaceShare:         mongoose.model('WorkspaceShare', WorkspaceShareSchema),
  TimetableUserState:     mongoose.model('TimetableUserState', TimetableUserStateSchema),
  TimetableDraft:         mongoose.model('TimetableDraft', TimetableDraftSchema),
  DraftOp:                mongoose.model('DraftOp', DraftOpSchema),
  DraftVersion:           mongoose.model('DraftVersion', DraftVersionSchema),
  WorkspaceLink:          mongoose.model('WorkspaceLink', WorkspaceLinkSchema),
  WorkspaceAccessRequest: mongoose.model('WorkspaceAccessRequest', WorkspaceAccessRequestSchema),
  WorkspaceComment:       mongoose.model('WorkspaceComment', WorkspaceCommentSchema)
};
