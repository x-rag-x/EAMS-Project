const mongoose = require('mongoose');

const ActivityEvidenceSchema = new mongoose.Schema({
  driveFileId: {
    type: String,
    required: true,
    index: true
  },
  originalName: {
    type: String,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  md5Checksum: {
    type: String,
    required: true
  },
  webViewLink: {
    type: String,
    default: ''
  },
  storageProvider: {
    type: String,
    enum: ['gdrive', 'local'],
    default: 'local'
  },
  localPath: {
    type: String,
    default: null
  },
  uploadedBy: {
    type: String,
    required: true,
    index: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  requestId: {
    type: String,
    default: null
  },
  requestType: {
    type: String,
    enum: ['student_leave', 'od', 'faculty_leave'],
    default: 'od'
  },
  verificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'invalid', 'correction'],
    default: 'pending'
  },
  verifiedBy: {
    type: String,
    default: null
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  comment: {
    type: String,
    default: ''
  }
}, { timestamps: true });

ActivityEvidenceSchema.index({ md5Checksum: 1 });
ActivityEvidenceSchema.index({ requestId: 1 });
ActivityEvidenceSchema.index({ uploadedBy: 1, uploadedAt: -1 });

module.exports = {
  ActivityEvidence: mongoose.model('ActivityEvidence', ActivityEvidenceSchema)
};
