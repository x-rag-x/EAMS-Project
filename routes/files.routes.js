const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const { authMiddleware } = require('../middleware/auth');
const { isSudoAdmin } = require('../utils/access');
const { canView: canViewBatchAccess, isSudoCaller } = require('../services/bulk/access');
const { uploadEvidenceFile, importFromDriveLink, getFileStream, sanitizeMimeType } = require('../utils/driveStore');
const { getSettings } = require('../utils/settingsCache');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const M = require('../models');

// Strict sandbox CSP and nosniff header for all /api/files endpoints
router.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Strict regex pattern for backup ZIP archives: backup_<batch>_<timestamp>.zip
const BACKUP_FILENAME_REGEX = /^backup_[A-Za-z0-9_-]+\.zip$/;


/**
 * Checks if the authenticated caller has permission to view/download a batch archive
 */
function canUserViewBatch(user, batch) {
  if (!user) return false;
  if (isSudoCaller(user) || isSudoAdmin(user)) return true;
  if (!batch) return false;
  if (canViewBatchAccess(user, batch)) return true;
  if (user.trackId && batch.uploadedBy?.trackId && user.trackId === batch.uploadedBy.trackId) return true;
  if (Array.isArray(user.allowedBatches) && batch.batchTrackId && user.allowedBatches.includes(batch.batchTrackId)) return true;
  return false;
}

// Configure multer for memory storage with max 5MB default
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB ceiling; granular check done against settings
});

/**
 * POST /api/files — Upload evidence file
 */
router.post('/', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const settings = await getSettings(['evidence']);
    const evSettings = settings.evidence || {};
    const maxMB = Number(evSettings.maxMB) || 5;
    const allowedTypes = Array.isArray(evSettings.types) ? evSettings.types : ['pdf', 'jpg', 'png'];

    // Check size limit
    if (req.file.size > maxMB * 1024 * 1024) {
      return res.status(400).json({
        error: `File size exceeds the allowed limit of ${maxMB} MB`
      });
    }

    // Check type limit
    const originalExt = (req.file.originalname.split('.').pop() || '').toLowerCase();
    const isAllowedExt = allowedTypes.includes(originalExt) ||
      (originalExt === 'jpeg' && allowedTypes.includes('jpg'));

    if (!isAllowedExt) {
      return res.status(400).json({
        error: `File type '.${originalExt}' not supported. Allowed formats: ${allowedTypes.join(', ')}`
      });
    }

    const requestId = sanitizeToString(req.body.requestId);
    const requestType = sanitizeToString(req.body.requestType) || 'od';

    const result = await uploadEvidenceFile({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      uploadedBy: req.user.trackId || String(req.user._id),
      requestId,
      requestType
    });

    return res.status(201).json({
      ok: true,
      message: 'File uploaded successfully',
      file: {
        driveFileId: result.evidence.driveFileId,
        name: result.evidence.originalName,
        size: result.evidence.size,
        mimeType: result.evidence.mimeType,
        webViewLink: result.evidence.webViewLink,
        uploadedAt: result.evidence.uploadedAt
      },
      warning: result.duplicateWarning
    });
  } catch (err) {
    console.error('[Upload File Error]:', err);
    return res.status(500).json({ error: err.message || 'File upload failed' });
  }
});

/**
 * POST /api/files/from-drive-link — Link external Google Drive document
 */
router.post('/from-drive-link', authMiddleware, async (req, res) => {
  try {
    const driveLink = sanitizeToString(req.body.driveLink);
    const requestId = sanitizeToString(req.body.requestId);
    const requestType = sanitizeToString(req.body.requestType) || 'od';

    if (!driveLink) {
      return res.status(400).json({ error: 'driveLink is required' });
    }

    const result = await importFromDriveLink({
      driveLink,
      uploadedBy: req.user.trackId || String(req.user._id),
      requestId,
      requestType
    });

    return res.status(201).json({
      ok: true,
      message: 'Drive link validated and registered',
      file: {
        driveFileId: result.evidence.driveFileId,
        name: result.evidence.originalName,
        webViewLink: result.evidence.webViewLink
      }
    });
  } catch (err) {
    console.error('[Drive Link Error]:', err);
    return res.status(400).json({ error: err.message || 'Invalid or inaccessible Google Drive link' });
  }
});

/**
 * GET /api/files/:id — Secure permission-checked file streaming & bulk backup download
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const fileId = sanitizeToString(req.params.id);

    if (!fileId) {
      return res.status(400).json({ error: 'File identifier is required' });
    }

    // Reject any path traversal characters in the requested file identifier
    if (fileId.includes('..') || fileId.includes('/') || fileId.includes('\\')) {
      return res.status(400).json({ error: 'Invalid file identifier' });
    }

    const isBackupRequest = fileId.startsWith('backup_') || fileId.endsWith('.zip');

    if (isBackupRequest) {
      // 1. Accept only strict backup archive filename format
      if (!BACKUP_FILENAME_REGEX.test(fileId)) {
        return res.status(400).json({
          error: 'Invalid backup file format. Expected backup_<batch>_<timestamp>.zip'
        });
      }

      // 2. Extract batch identifier from backup_<batch>_<timestamp>.zip
      const match = fileId.match(/^backup_(.+)_\d+\.zip$/) || fileId.match(/^backup_(.+)\.zip$/);
      const batchIdentifier = match ? match[1] : null;

      let batch = null;
      if (M.BulkImportBatch && mongoose.connection && mongoose.connection.readyState === 1) {
        try {
          const baseName = fileId.replace(/\.zip$/i, '');
          const orConditions = [
            { 'backup.driveFileId': baseName },
            { 'backup.driveFileId': fileId }
          ];
          if (batchIdentifier) {
            orConditions.push({ batchTrackId: batchIdentifier });
            if (mongoose.Types.ObjectId.isValid(batchIdentifier)) {
              orConditions.push({ _id: batchIdentifier });
            }
          }
          batch = await M.BulkImportBatch.findOne({ $or: orConditions }).lean();
        } catch (dbErr) {
          console.warn('[Files Route] BulkImportBatch lookup failed:', dbErr.message);
        }
      }

      if (!batch && req.batch) {
        batch = req.batch;
      }

      // 3. Verify caller may see that batch
      if (batch) {
        if (!canUserViewBatch(req.user, batch)) {
          return res.status(403).json({ error: 'You do not have permission to view or download this batch backup' });
        }
        if (batch.backup && batch.backup.driveWebViewLink) {
          return res.redirect(batch.backup.driveWebViewLink);
        }
      } else {
        const isSudo = isSudoCaller(req.user) || isSudoAdmin(req.user);
        const userAllowed = Array.isArray(req.user.allowedBatches) && batchIdentifier && req.user.allowedBatches.includes(batchIdentifier);
        const userOwnsBatch = batchIdentifier && (req.user.batch === batchIdentifier || req.user.batchTrackId === batchIdentifier);

        if (!isSudo && !userAllowed && !userOwnsBatch) {
          return res.status(403).json({ error: 'You do not have permission to view or download this batch backup' });
        }
      }

      return res.status(404).json({ error: 'Backup archive stored in Google Drive. Check batch details in Bulk Import.' });
    }

    // Evidence file streaming branch
    const evidence = await M.ActivityEvidence.findOne({ driveFileId: fileId }).lean();

    if (!evidence) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Permission check: uploader, teacher, admin, advisor, HOD, principal can view
    const isOwner = evidence.uploadedBy === req.user.trackId || evidence.uploadedBy === String(req.user._id);
    const isPrivileged = isSudoAdmin(req.user) || req.user.role === 'teacher';

    if (!isOwner && !isPrivileged) {
      return res.status(403).json({ error: 'You do not have permission to view this file' });
    }

    const fileStreamObj = await getFileStream(fileId);
    const safeMime = sanitizeMimeType(fileStreamObj.mimeType);

    res.setHeader('Content-Type', safeMime);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileStreamObj.originalName)}"`);
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (fileStreamObj.size) {
      res.setHeader('Content-Length', fileStreamObj.size);
    }

    fileStreamObj.stream.pipe(res);
  } catch (err) {
    console.error('[File Stream Error]:', err);
    return res.status(500).json({ error: err.message || 'Error streaming file' });
  }
});

module.exports = router;
