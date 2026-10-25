const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const M = require('../../models');
const { authMiddleware, requirePage } = require('../../middleware/auth');
const { loadBatch } = require('../../services/bulk/access');
const { transition } = require('../../services/bulk/stateMachine');
const { postMessage } = require('../../services/bulk/messages');
const { runStageJob, runRescanJob } = require('../../services/bulk/pipeline');
const { runCommitJob } = require('../../services/bulk/commit');
const storage = require('../../services/bulk/storage');

const MAX_FILE_MB = 10;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 }
});

function validateFile(file) {
  if (!file) throw new Error('No spreadsheet file uploaded');
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = ['.xlsx', '.csv'];
  if (!allowed.includes(ext)) {
    throw new Error(`Unsupported file type "${ext}". Please upload an .xlsx or .csv spreadsheet file.`);
  }

  // Magic bytes check for .xlsx (must start with PK / 0x50 0x4B)
  if (ext === '.xlsx') {
    if (!file.buffer || file.buffer.length < 4 || file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b) {
      throw new Error('Corrupted or invalid Excel file. File does not have a valid XLSX header signature.');
    }
  }
}

// ── 1. UPLOAD FILE & START BACKGROUND STAGE JOB ──
router.post(
  '/batches/:id/upload',
  authMiddleware,
  requirePage('bulk', 'create'),
  loadBatch('ownerOrSudo'),
  upload.single('file'),
  async (req, res) => {
    try {
      validateFile(req.file);

      // Guard transition from draft -> uploading
      req.batch = await transition(req.batch._id, 'uploading', {
        from: ['draft'],
        user: req.user
      });

      try {
        // Persist buffer to MongoDB GridFS
        const fileRef = await storage.put(req.file.buffer, req.file.originalname, {
          batchId: req.batch._id,
          uploaderId: req.user._id,
          mimetype: req.file.mimetype
        });

        const updateFields = {
          fileRef,
          originalFileName: req.file.originalname,
          mimeType: req.file.mimetype
        };
        if (req.scope) {
          updateFields['uploadedBy.scope'] = req.scope;
        }

        await M.BulkImportBatch.updateOne(
          { _id: req.batch._id },
          {
            $set: updateFields
          }
        );

        // Append file card to transcript
        await postMessage(req.batch._id, {
          kind: 'card',
          card: 'file',
          author: 'user',
          actor: req.user,
          payload: {
            name: req.file.originalname,
            size: req.file.size
          }
        });

        // Append progress card to transcript
        await postMessage(req.batch._id, {
          kind: 'card',
          card: 'progress',
          author: 'system',
          payload: { jobKind: 'stage' }
        });

        // Transition uploading -> processing
        req.batch = await transition(req.batch._id, 'processing', {
          from: ['uploading'],
          user: req.user
        });
      } catch (innerErr) {
        // Reset state back to draft so upload is retryable
        try {
          await transition(req.batch._id, 'draft', {
            from: ['uploading'],
            user: req.user,
            details: { error: innerErr.message }
          });
        } catch (_) {}
        throw innerErr;
      }

      // Return 202 Accepted immediately
      res.status(202).json({
        ok: true,
        status: 'processing',
        batchId: req.batch._id
      });

      // Launch async stage job in background
      setImmediate(() => {
        runStageJob(req.batch._id, req.user, {
          ip: req.ip,
          sessionId: req.user.sessionId
        }).catch(err => {
          console.error('[Async runStageJob Uncaught]:', err);
        });
      });
    } catch (err) {
      console.error('[BulkUpload Error]:', err);
      res.status(err.status || 400).json({ error: err.message });
    }
  }
);

// ── 2. RETRY FAILED JOB (STAGE OR COMMIT) ──
router.post('/batches/:id/retry', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    const batch = req.batch;
    if (batch.status !== 'failed') {
      return res.status(409).json({ error: `Cannot retry batch in status "${batch.status}" — only failed batches can be retried.` });
    }

    const jobKind = batch.progress?.jobKind || 'stage';
    const targetStatus = jobKind === 'commit' ? 'committing' : 'processing';

    await transition(batch._id, targetStatus, {
      from: ['failed'],
      user: req.user
    });

    await postMessage(batch._id, {
      kind: 'card',
      card: 'progress',
      author: 'system',
      payload: { jobKind, isRetry: true }
    });

    res.status(202).json({ ok: true, status: targetStatus });

    setImmediate(() => {
      const meta = { ip: req.ip, sessionId: req.user.sessionId };
      const jobPromise = jobKind === 'commit'
        ? runCommitJob(batch._id, req.user, meta)
        : runStageJob(batch._id, req.user, meta);

      jobPromise.catch(err => {
        console.error(`[Async retry ${jobKind} job Uncaught]:`, err);
      });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── 3. RESCAN BATCH ──
router.post('/batches/:id/rescan', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    const batch = req.batch;
    if (!['staged', 'skipped_resolved'].includes(batch.status)) {
      return res.status(409).json({ error: `Cannot rescan batch in status "${batch.status}"` });
    }

    // F-31: Atomically claim the rescan job BEFORE returning 202 to reject duplicate clicks with 409
    req.batch = await transition(batch._id, 'processing', {
      from: ['staged', 'skipped_resolved'],
      user: req.user
    });

    await postMessage(batch._id, {
      kind: 'card',
      card: 'progress',
      author: 'system',
      payload: { jobKind: 'rescan' }
    });

    res.status(202).json({ ok: true, status: 'processing' });

    setImmediate(() => {
      runRescanJob(batch._id, req.user, {
        ip: req.ip,
        sessionId: req.user.sessionId
      }).catch(err => {
        console.error('[Async runRescanJob Uncaught]:', err);
      });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── 3b. RETRY DRIVE UPLOAD ONLY ──
router.post('/batches/:id/retry-drive', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    const batch = req.batch;
    const { createBatchFolder, uploadBufferToDrive } = require('../../utils/googleDrive');
    let buffer = null;
    if (batch.fileRef && batch.fileRef.gridFsId) {
      buffer = await storage.get(batch.fileRef.gridFsId);
    } else if (batch.fileBufferBase64) {
      buffer = Buffer.from(batch.fileBufferBase64, 'base64');
    }
    if (!buffer) return res.status(400).json({ error: 'Spreadsheet buffer not available' });

    const folderName = `${batch.batchTrackId}_${batch.type.toUpperCase()}`;
    const driveFolder = await createBatchFolder(folderName);
    const driveFile = await uploadBufferToDrive(
      buffer,
      batch.originalFileName || `${batch.batchTrackId}.xlsx`,
      batch.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      driveFolder.folderId
    );

    batch.drive = {
      folderId: driveFolder.folderId,
      folderName: driveFolder.folderName,
      folderUrl: driveFolder.folderUrl,
      fileId: driveFile.fileId,
      fileUrl: driveFile.driveUrl,
      status: 'uploaded',
      uploadedAt: new Date(),
      error: ''
    };
    await batch.save();

    res.json({ ok: true, drive: batch.drive });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 4. DEPRECATED / LEGACY BLOCKING STAGE WRAPPER (FOR OLD UI) ──
router.post('/stage', authMiddleware, requirePage('bulk', 'create'), upload.single('file'), async (req, res) => {
  try {
    validateFile(req.file);
    const type = req.body.type || 'dept';

    // Create draft
    const batchTrackId = require('./batches.routes').generateBatchTrackId();
    const batch = await M.BulkImportBatch.create({
      batchTrackId,
      title: `${type.toUpperCase()} Import · Legacy`,
      type,
      status: 'uploading',
      originalFileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileBufferBase64: req.file.buffer.toString('base64'),
      uploadedBy: {
        userId:   req.user._id,
        trackId:  req.user.trackId || '',
        name:     req.user.name || 'User',
        role:     req.user.role || 'teacher',
        deptId:   req.user.deptId || null,
        deptName: req.user.deptName || ''
      },
      deviceDetails: {
        ip: req.ip || '',
        userAgent: req.headers['user-agent'] || '',
        sessionId: req.user.sessionId || ''
      }
    });

    const fileRef = await storage.put(req.file.buffer, req.file.originalname, {
      batchId: batch._id,
      uploaderId: req.user._id
    });
    batch.fileRef = fileRef;
    batch.status = 'processing';
    await batch.save();

    // Run synchronous stage for legacy client
    const updated = await runStageJob(batch._id, req.user, { ip: req.ip, sessionId: req.user.sessionId });

    res.json({
      ok: true,
      batchId: updated._id,
      batchTrackId: updated.batchTrackId,
      type: updated.type,
      totalRows: updated.totalRows,
      eligibleCount: updated.eligibleCount,
      skippedCount: updated.skippedCount,
      driveFolder: updated.drive?.folderName,
      driveUrl: updated.drive?.folderUrl
    });
  } catch (err) {
    console.error('[Legacy /stage Error]:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
