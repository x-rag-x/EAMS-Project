const mongoose = require('mongoose');

const BulkChatSnapshotSchema = new mongoose.Schema({
  batchId:      { type: mongoose.Schema.Types.ObjectId, ref: 'BulkImportBatch', required: true, index: true },
  epoch:        { type: Number, required: true },
  status:       { type: String, required: true },
  eligibleRows: { type: mongoose.Schema.Types.Mixed, default: [] },
  skippedRows:  { type: mongoose.Schema.Types.Mixed, default: [] },
  counters:     { type: mongoose.Schema.Types.Mixed, default: {} },
  approvals:    { type: mongoose.Schema.Types.Mixed, default: {} },
  progress:     { type: mongoose.Schema.Types.Mixed, default: {} },
  takenBy:      { type: String, default: '' },
  takenAt:      { type: Date, default: Date.now },
  state:        { type: String, enum: ['pending', 'applied', 'void'], default: 'pending' }
}, { timestamps: true });

BulkChatSnapshotSchema.index({ batchId: 1, epoch: 1 });

module.exports = {
  BulkChatSnapshot: mongoose.model('BulkChatSnapshot', BulkChatSnapshotSchema)
};
