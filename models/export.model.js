const mongoose = require('mongoose');

const ExportTemplateSchema = new mongoose.Schema({
  templateName: { type: String, required: true, trim: true },
  userId:       { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'userModel' },
  userModel:    { type: String, required: true, enum: ['Admin', 'Teacher', 'Student'] },
  role:         { type: String, required: true, enum: ['admin', 'teacher', 'student'] },
  reportType:   { type: String, required: true },
  config: {
    filters:  { type: mongoose.Schema.Types.Mixed, default: {} },
    format:   { type: String, enum: ['pdf', 'excel', 'csv'], default: 'pdf' },
    options:  { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  lastUsed:   { type: Date, default: null },
  useCount:   { type: Number, default: 0 },
}, { timestamps: true });

ExportTemplateSchema.index({ userId: 1, templateName: 1 }, { unique: true });
ExportTemplateSchema.index({ userId: 1, lastUsed: -1 });
ExportTemplateSchema.index({ role: 1, reportType: 1 });

const ExportHistorySchema = new mongoose.Schema({
  exportTrackId: { type: String, required: true, unique: true, sparse: true },
  userId:        { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'userModel' },
  userModel:     { type: String, required: true, enum: ['Admin', 'Teacher', 'Student'] },
  userName:      { type: String, required: true },
  role:          { type: String, required: true, enum: ['admin', 'teacher', 'student'] },
  reportType:    { type: String, required: true },
  config: {
    filters:     { type: mongoose.Schema.Types.Mixed, default: {} },
    dateRange: {
      from:      { type: String, default: '' },
      to:        { type: String, default: '' },
    },
    options:     { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  format:        { type: String, enum: ['pdf', 'excel', 'csv', 'zip'], required: true },
  status:        { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
  fileSize:      { type: Number, default: 0 },
  recordCount:   { type: Number, default: 0 },
  generatedAt:   { type: Date, default: null },
  downloadedAt:  { type: Date, default: null },
  expiresAt:     { type: Date, required: true },
  error:         { type: String, default: '' },
  metadata: {
    ip:          { type: String, default: '' },
    userAgent:   { type: String, default: '' },
    sessionId:   { type: String, default: '' },
  },
}, { timestamps: true });

ExportHistorySchema.index({ userId: 1, generatedAt: -1 });
ExportHistorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
ExportHistorySchema.index({ status: 1, createdAt: -1 });
ExportHistorySchema.index({ role: 1, reportType: 1, createdAt: -1 });

module.exports = {
  ExportTemplate: mongoose.model('ExportTemplate', ExportTemplateSchema),
  ExportHistory:  mongoose.model('ExportHistory',  ExportHistorySchema),
};
