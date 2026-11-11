'use strict';
const fs = require('fs');

let code = fs.readFileSync('models/timetableWorkspace.model.js', 'utf8').replace(/\r\n/g, '\n');

// 1. Add versionBucketMinutes and seq to TimetableWorkspaceSchema if missing
if (!code.includes('versionBucketMinutes:')) {
  code = code.replace(
    '  lastActivityAt:{ type: Date, default: Date.now },',
    '  versionBucketMinutes: { type: Number, enum: [5, 10, 15, 30, 60], default: 15 },\n  seq:           { type: Number, default: 0 },\n  lastActivityAt:{ type: Date, default: Date.now },'
  );
}

// 2. Add slotRevs and seq to WorkspaceClassDraftSchema if missing
if (!code.includes('slotRevs:')) {
  code = code.replace(
    '  revision:          { type: Number, default: 1 },',
    '  slotRevs:          { type: Schema.Types.Mixed, default: {} },\n  seq:               { type: Number, default: 0 },\n  revision:          { type: Number, default: 1 },'
  );
}

// 3. Add TimetableDraft, DraftOp, and DraftVersion schemas before module.exports
if (!code.includes('const DraftOpSchema = new Schema({')) {
  const schemas = `
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
`;
  code = code.replace(
    'module.exports = {',
    schemas + '\nmodule.exports = {'
  );

  code = code.replace(
    '  TimetableUserState:   mongoose.model(\'TimetableUserState\', TimetableUserStateSchema)\n};',
    '  TimetableUserState:   mongoose.model(\'TimetableUserState\', TimetableUserStateSchema),\n  TimetableDraft:       mongoose.model(\'TimetableDraft\', TimetableDraftSchema),\n  DraftOp:              mongoose.model(\'DraftOp\', DraftOpSchema),\n  DraftVersion:         mongoose.model(\'DraftVersion\', DraftVersionSchema)\n};'
  );
}

fs.writeFileSync('models/timetableWorkspace.model.js', code, 'utf8');
console.log('[OK] models/timetableWorkspace.model.js updated with Phase 3 models!');
