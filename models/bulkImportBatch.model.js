const mongoose = require('mongoose');

const BulkImportBatchSchema = new mongoose.Schema({
  batchTrackId: { type: String, required: true, unique: true, trim: true },
  title:        { type: String, default: '', trim: true },
  type: {
    type: String,
    required: true,
    enum: ['dept', 'teacher', 'class', 'subject', 'student']
  },
  parentBatchId: { type: mongoose.Schema.Types.ObjectId, ref: 'BulkImportBatch', default: null },
  archivedBy:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  lastMessageAt:      { type: Date, default: Date.now },
  lastMessagePreview: { type: String, default: '' },
  messageSeq:         { type: Number, default: 0 },
  seenBy: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    seq:    { type: Number, default: 0 }
  }],

  originalFileName: { type: String, default: '' },
  fileBufferBase64: { type: String, default: '' },
  fileRef: {
    gridFsId: { type: mongoose.Schema.Types.ObjectId, default: null },
    size:     { type: Number, default: 0 },
    sha256:   { type: String, default: '' }
  },
  mimeType: { type: String, default: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },

  uploadedBy: {
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    trackId:  { type: String, default: '' },
    name:     { type: String, default: '' },
    role:     { type: String, default: '' },
    deptId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    deptName: { type: String, default: '' },
    scope:    { type: mongoose.Schema.Types.Mixed, default: null }
  },

  deviceDetails: {
    ip:         { type: String, default: '' },
    userAgent:  { type: String, default: '' },
    sessionId:  { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now }
  },

  status: {
    type: String,
    enum: [
      'draft',                   // Created empty chat with selected type
      'uploading',               // File receiving
      'processing',              // Parse & validation job running
      'staged',                  // Uploaded and parsed; waiting to resolve skipped logs
      'skipped_resolved',        // All skipped items acknowledged with Done
      'pending_sudo_initial',    // Forwarded to sudo admin for initial approval
      'sudo_initial_approved',   // Sudo admin approved initial request; verification open
      'verifying',               // In progress: individual student/teacher verifications
      'verified_all',            // 100% of eligible rows verified
      'pending_final_approval',  // Submitted for final admin/sudo approval
      'committing',              // Background commit job running
      'committed',               // Committed to live DB and backed up
      'rejected',                // Rejected by admin
      'failed',                  // Stage/rescan/commit job failed, retryable
      'cancelled'                // Cancelled by uploader
    ],
    default: 'draft'
  },

  progress: {
    jobKind:  { type: String, default: '' }, // 'stage' | 'rescan' | 'commit' | 'backup'
    phase:    { type: String, default: '' },
    percent:  { type: Number, default: 0 },
    phases: [{
      key:        { type: String },
      label:      { type: String },
      status:     { type: String, default: 'pending' }, // 'pending' | 'running' | 'done' | 'warn' | 'error'
      percent:    { type: Number, default: 0 },
      detail:     { type: String, default: '' },
      startedAt:  { type: Date, default: null },
      finishedAt: { type: Date, default: null }
    }],
    counters: {
      total:     { type: Number, default: 0 },
      processed: { type: Number, default: 0 },
      eligible:  { type: Number, default: 0 },
      skipped:   { type: Number, default: 0 },
      committed: { type: Number, default: 0 }
    },
    heartbeatAt: { type: Date, default: null },
    error:       { type: String, default: '' }
  },

  rejection: {
    by:     { type: String, default: '' },
    at:     { type: Date, default: null },
    reason: { type: String, default: '' },
    stage:  { type: String, default: '' }
  },

  totalRows:     { type: Number, default: 0 },
  eligibleCount: { type: Number, default: 0 },
  skippedCount:  { type: Number, default: 0 },
  verifiedCount: { type: Number, default: 0 },

  // Staged data rows waiting for verification
  eligibleRows: [{
    rowNumber:      { type: Number, required: true },
    data:           { type: mongoose.Schema.Types.Mixed, default: {} },
    isVerified:     { type: Boolean, default: false },
    verifiedAt:     { type: Date, default: null },
    verifiedBy:     { type: String, default: '' },
    emailSent:      { type: Boolean, default: false },
    emailSentAt:    { type: Date, default: null },
    emailRecipient: { type: String, default: '' },
    devBypass:      { type: Boolean, default: false },
    notes:          { type: String, default: '' },
    committed:      { type: Boolean, default: false },
    committedAt:    { type: Date, default: null },
    commitError:    { type: String, default: '' }
  }],

  // Skipped / error rows that require Done acknowledgement
  skippedRows: [{
    rowNumber: { type: Number, required: true },
    name:      { type: String, default: '' },
    issues:    [{ type: String }],
    data:      { type: mongoose.Schema.Types.Mixed, default: {} },
    isDone:    { type: Boolean, default: false },
    isResolved: { type: Boolean, default: false },
    doneAt:    { type: Date, default: null }
  }],

  // Initial Sudo Admin review
  sudoInitialApproval: {
    approved:   { type: Boolean, default: false },
    approvedBy: { type: String, default: '' },
    approvedAt: { type: Date, default: null },
    notes:      { type: String, default: '' }
  },

  // Final Admin / Sudo review before commit
  finalApproval: {
    approved:   { type: Boolean, default: false },
    approvedBy: { type: String, default: '' },
    approvedAt: { type: Date, default: null },
    notes:      { type: String, default: '' }
  },

  // Verification logs (for 24h limit & audit tracking)
  verificationAudit: [{
    rowNumber:  Number,
    entityName: String,
    identifier: String,
    email:      String,
    verifiedBy: String,
    verifiedAt: { type: Date, default: Date.now },
    ip:         String,
    userAgent:  String
  }],

  // Google Drive initial folder & sheet upload details
  drive: {
    folderId:   { type: String, default: '' },
    folderName: { type: String, default: '' },
    folderUrl:  { type: String, default: '' },
    fileId:     { type: String, default: '' },
    fileUrl:    { type: String, default: '' },
    status:     { type: String, default: 'pending' },
    uploadedAt: { type: Date, default: null },
    error:      { type: String, default: '' }
  },

  // Google Drive & Local ZIP Backup details
  backup: {
    driveFileId:      { type: String, default: '' },
    driveWebViewLink: { type: String, default: '' },
    localPath:        { type: String, default: '' },
    zipSize:          { type: Number, default: 0 },
    md5:              { type: String, default: '' },
    archivedAt:       { type: Date, default: null },
    status:           { type: String, default: 'pending', enum: ['pending', 'done', 'failed'] }
  },

  // State roadmap log
  roadmap: [{
    stage:     { type: String, required: true },
    status:    { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    user:      { type: String, default: '' },
    details:   { type: mongoose.Schema.Types.Mixed, default: {} }
  }]
}, { timestamps: true });

BulkImportBatchSchema.index({ status: 1 });
BulkImportBatchSchema.index({ 'uploadedBy.userId': 1 });
BulkImportBatchSchema.index({ createdAt: -1 });
BulkImportBatchSchema.index({ 'uploadedBy.userId': 1, lastMessageAt: -1 });
BulkImportBatchSchema.index({ status: 1, lastMessageAt: -1 });
BulkImportBatchSchema.index({ 'verificationAudit.verifiedAt': -1 });

const BulkChatMessageSchema = new mongoose.Schema({
  batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'BulkImportBatch', required: true, index: true },
  seq:     { type: Number, required: true },
  author:  { type: String, enum: ['system', 'user'], default: 'system' },
  kind:    { type: String, enum: ['card', 'event', 'text'], default: 'card' },
  card:    { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  actor: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name:   { type: String, default: '' },
    role:   { type: String, default: '' }
  },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

BulkChatMessageSchema.index({ batchId: 1, seq: 1 }, { unique: true });

module.exports = {
  BulkImportBatch: mongoose.model('BulkImportBatch', BulkImportBatchSchema),
  BulkChatMessage: mongoose.model('BulkChatMessage', BulkChatMessageSchema)
};
