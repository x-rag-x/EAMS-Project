const M = require('../../models');
const { createTracker } = require('./progress');
const { runStage } = require('./stage');
const { transition } = require('./stateMachine');
const { postMessage } = require('./messages');
const storage = require('./storage');
const { createBatchFolder, uploadBufferToDrive } = require('../../utils/googleDrive');
const { logAction } = require('../../utils/logAction');

/**
 * Assembles an execution context with complete administrative privileges and identity.
 * If user lacks privilege flags, hydrates from DB Teacher/Student document and resolveAccess.
 */
async function buildExecutionContext(user, batch) {
  let effectiveUser = user ? (typeof user.toObject === 'function' ? user.toObject() : { ...user }) : {};

  const trackId = effectiveUser.trackId || batch?.uploadedBy?.trackId;
  const userId = effectiveUser._id || batch?.uploadedBy?.userId;
  const role = effectiveUser.role || batch?.uploadedBy?.role || 'teacher';

  if ((effectiveUser.isSudoAdmin === undefined || !effectiveUser.pageRights) && (trackId || userId)) {
    try {
      const model = role === 'student' ? M.Student : M.Teacher;
      const query = trackId ? { trackId } : { _id: userId };
      const doc = await model.findOne(query).lean();
      if (doc) {
        const { resolveAccess } = require('../../utils/resolveAccess');
        const access = resolveAccess(doc);
        effectiveUser = {
          ...doc,
          ...access,
          ...effectiveUser,
          isSudoAdmin: access.isSudoAdmin,
          isAdmin: access.isAdmin,
          isSuperAdmin: access.isSuperAdmin,
          isSubAdmin: access.isSubAdmin,
          accessRole: access.tier,
          adminFlag: access.adminFlag,
          hasInstitutionReach: access.hasInstitutionReach,
          pageRights: access.pageRights,
          specials: doc.specials || [],
          department: doc.department || effectiveUser.department || batch?.uploadedBy?.deptName,
          deptId: doc.deptId || effectiveUser.deptId || batch?.uploadedBy?.deptId
        };
      }
    } catch (e) {
      console.warn('[BulkPipeline] User hydration notice:', e.message);
    }
  }

  if (!effectiveUser.trackId && batch?.uploadedBy?.trackId) effectiveUser.trackId = batch.uploadedBy.trackId;
  if (!effectiveUser.name && batch?.uploadedBy?.name) effectiveUser.name = batch.uploadedBy.name;
  if (!effectiveUser.role && batch?.uploadedBy?.role) effectiveUser.role = batch.uploadedBy.role;
  if (!effectiveUser.department && batch?.uploadedBy?.deptName) effectiveUser.department = batch.uploadedBy.deptName;
  if (!effectiveUser.deptId && batch?.uploadedBy?.deptId) effectiveUser.deptId = batch.uploadedBy.deptId;

  return {
    user: effectiveUser,
    scope: effectiveUser.scope || batch?.uploadedBy?.scope || null
  };
}

/**
 * Executes the stage pipeline in the background.
 * Non-blocking, writes live progress to DB and event bus.
 */
async function runStageJob(batchId, user, reqMeta = {}) {
  const tracker = createTracker(batchId, 'stage');

  try {
    const batch = await M.BulkImportBatch.findById(batchId);
    if (!batch) throw new Error('Batch not found');

    // Stage 0: Uploading the file
    let buffer = null;
    await runStage(tracker, 'stage', 0, async () => {
      await tracker.start('receive', 'File received on server');
      if (batch.fileRef && batch.fileRef.gridFsId) {
        buffer = await storage.get(batch.fileRef.gridFsId);
      } else if (batch.fileBufferBase64) {
        buffer = Buffer.from(batch.fileBufferBase64, 'base64');
      }
      if (!buffer || !buffer.length) {
        throw new Error('Spreadsheet file payload is empty or could not be loaded');
      }
      await tracker.done('receive', `${(buffer.length / (1024 * 1024)).toFixed(2)} MB loaded`);
    });

    // Stage 1: Saving to Drive (Sequential, non-fatal)
    const driveMeta = {
      folderId: '',
      folderName: '',
      folderUrl: '',
      fileId: '',
      fileUrl: '',
      status: 'pending',
      uploadedAt: null,
      error: ''
    };

    await runStage(tracker, 'stage', 1, async () => {
      await tracker.start('drive', 'Saving spreadsheet to Google Drive');
      try {
        let folderId = batch.drive?.folderId;
        let folderName = batch.drive?.folderName || batch.batchTrackId;
        let folderUrl = batch.drive?.folderUrl;

        if (!folderId) {
          const { provisionDriveFolder } = require('./driveFolder');
          const prov = await provisionDriveFolder(batch._id);
          if (prov && prov.folderId) {
            folderId = prov.folderId;
            folderName = prov.folderName || batch.batchTrackId;
            folderUrl = prov.folderUrl;
          }
        }

        if (folderId) {
          driveMeta.folderId = folderId;
          driveMeta.folderName = folderName;
          driveMeta.folderUrl = folderUrl || `https://drive.google.com/drive/folders/${folderId}`;

          const driveFile = await uploadBufferToDrive(
            buffer,
            batch.originalFileName || `${batch.batchTrackId}.xlsx`,
            batch.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            folderId
          );

          if (driveFile && driveFile.fileId) {
            driveMeta.fileId = driveFile.fileId;
            driveMeta.fileUrl = driveFile.driveUrl;
            driveMeta.status = 'uploaded';
            driveMeta.uploadedAt = new Date();
            await tracker.done('drive', `Archived in folder ${folderName}`);
          } else {
            driveMeta.status = 'file_failed';
            await tracker.warn('drive', 'Drive file upload could not be verified');
          }
        } else {
          driveMeta.status = 'folder_failed';
          await tracker.warn('drive', 'Google Drive folder could not be created');
        }
      } catch (gErr) {
        console.warn('[BulkPipeline] Google Drive upload warning:', gErr.message);
        driveMeta.status = 'error';
        driveMeta.error = gErr.message;
        await tracker.warn('drive', `Google Drive notice: ${gErr.message}`);
      }
    });

    // Stage 2: Reading spreadsheet
    const { scanAndValidateWorkbook } = require('./scan');
    const fakeReq = await buildExecutionContext(user, batch);

    await runStage(tracker, 'stage', 2, async () => {
      await tracker.start('read', 'Parsing spreadsheet rows and headers');
      await tracker.done('read', 'Workbook parsed');
    });

    // Stage 3: Validating data
    let scanResult = null;
    await runStage(tracker, 'stage', 3, async () => {
      await tracker.start('validate', 'Validating constraints, foreign keys, and formats');
      scanResult = await scanAndValidateWorkbook(batch.type, buffer, fakeReq, {
        onProgress: ({ processed, total, eligible, skipped }) => {
          const pct = total ? Math.round((processed / total) * 100) : 0;
          tracker.tick('validate', pct, `${processed} / ${total} · ${eligible} ready · ${skipped} skipped`, {
            processed,
            total,
            eligible,
            skipped
          });
        }
      });
      await tracker.done('validate', `${scanResult.eligibleRows.length} eligible, ${scanResult.skippedRows.length} skipped`);
    });

    // Stage 4: Cleaning up
    let updatedBatch = null;
    await runStage(tracker, 'stage', 4, async () => {
      await tracker.start('save', 'Persisting staged records to database');
      const isAutoVerified = ['dept', 'class', 'subject'].includes(batch.type);
      const verifiedCount = isAutoVerified ? scanResult.eligibleRows.length : 0;

      updatedBatch = await M.BulkImportBatch.findOneAndUpdate(
        { _id: batch._id },
        {
          $set: {
            totalRows: scanResult.totalRows,
            eligibleCount: scanResult.eligibleRows.length,
            skippedCount: scanResult.skippedRows.length,
            verifiedCount,
            eligibleRows: scanResult.eligibleRows,
            skippedRows: scanResult.skippedRows,
            drive: driveMeta
          },
          $push: {
            uploads: {
              epoch: batch.epoch || 0,
              name: batch.originalFileName || `${batch.batchTrackId}.xlsx`,
              size: buffer.length,
              sha256: batch.fileRef?.sha256 || '',
              gridFsId: batch.fileRef?.gridFsId || null,
              drive: {
                fileId: driveMeta.fileId || '',
                url: driveMeta.fileUrl || ''
              },
              at: new Date(),
              by: user._id || null
            }
          }
        },
        { returnDocument: 'after' }
      );

      await transition(updatedBatch, 'staged', {
        user,
        from: ['processing', 'uploading'],
        details: {
          totalRows: scanResult.totalRows,
          eligible: scanResult.eligibleRows.length,
          skipped: scanResult.skippedRows.length
        }
      });

      await tracker.done('save', `${scanResult.eligibleRows.length} ready for review`);
    });

    // Stage 5: Done (hold 1.5s, then summary card posted)
    const doneHoldMs = (process.env.BULK_STAGE_HOLD_MS !== undefined ? parseInt(process.env.BULK_STAGE_HOLD_MS, 10) : 1500);
    await runStage(tracker, 'stage', 5, async () => {
      // Done stage complete
    }, { holdMs: doneHoldMs, mode: 'after' });

    // Post Summary card to transcript
    await postMessage(batch._id, {
      kind: 'card',
      card: 'summary',
      author: 'system',
      payload: {
        eligibleCount: scanResult.eligibleRows.length,
        skippedCount: scanResult.skippedRows.length,
        totalRows: scanResult.totalRows,
        driveFolder: driveMeta.folderName,
        driveUrl: driveMeta.folderUrl
      }
    });

    // Audit log
    logAction(
      user.trackId || user._id,
      user.name,
      user.role,
      'BULK_IMPORT_STAGED',
      `Bulk ${batch.type.toUpperCase()} import staged: ${scanResult.eligibleRows.length} eligible, ${scanResult.skippedRows.length} skipped (${batch.batchTrackId})`,
      'data',
      'info',
      reqMeta.ip || '127.0.0.1',
      reqMeta.sessionId || '',
      {
        module: 'admin',
        subType: 'bulk-import',
        batchTrackId: batch.batchTrackId,
        type: batch.type,
        total: scanResult.totalRows,
        eligible: scanResult.eligibleRows.length,
        skipped: scanResult.skippedRows.length,
        driveFolder: driveMeta.folderName,
        driveUrl: driveMeta.folderUrl
      }
    );

    return updatedBatch;
  } catch (err) {
    console.error('[BulkPipeline Stage Error]:', err);
    await tracker.fail('stage', err);

    await M.BulkImportBatch.updateOne(
      { _id: batchId },
      {
        $set: {
          status: 'failed',
          'progress.error': err.message
        }
      }
    ).catch(() => {});

    await postMessage(batchId, {
      kind: 'card',
      card: 'error',
      author: 'system',
      payload: {
        error: err.message,
        stage: 'stage'
      }
    }).catch(() => {});

    throw err;
  }
}

/**
 * Re-scans an existing staged batch against latest database state
 */
async function runRescanJob(batchId, user, reqMeta = {}) {
  const tracker = createTracker(batchId, 'rescan');

  try {
    const batch = await M.BulkImportBatch.findById(batchId);
    if (!batch) throw new Error('Batch not found');

    if (batch.status !== 'processing') {
      await transition(batch, 'processing', {
        user,
        from: ['staged', 'skipped_resolved']
      });

      await postMessage(batchId, {
        kind: 'card',
        card: 'progress',
        author: 'system',
        payload: { jobKind: 'rescan' }
      });
    }

    await tracker.start('read', 'Loading workbook from storage');
    let buffer = null;
    if (batch.fileRef && batch.fileRef.gridFsId) {
      buffer = await storage.get(batch.fileRef.gridFsId);
    } else if (batch.fileBufferBase64) {
      buffer = Buffer.from(batch.fileBufferBase64, 'base64');
    }

    if (!buffer || !buffer.length) {
      throw new Error('Spreadsheet file payload is not available for rescan');
    }
    await tracker.done('read', 'Loaded workbook');

    await tracker.start('validate', 'Re-validating all rows against updated reference collections');
    const { scanAndValidateWorkbook } = require('./scan');

    const fakeReq = await buildExecutionContext(user, batch);

    const scanResult = await scanAndValidateWorkbook(batch.type, buffer, fakeReq, {
      onProgress: ({ processed, total, eligible, skipped }) => {
        const pct = total ? Math.round((processed / total) * 100) : 0;
        tracker.tick('validate', pct, `Rescanning: ${processed} / ${total}`, {
          processed,
          total,
          eligible,
          skipped
        });
      }
    });
    await tracker.done('validate', `Rescan: ${scanResult.eligibleRows.length} eligible, ${scanResult.skippedRows.length} skipped`);

    await tracker.start('save', 'Merging previous verification history');

    // Preserve previously verified rows
    const prevVerifiedMap = new Map();
    for (const r of (batch.eligibleRows || [])) {
      if (r.isVerified) {
        prevVerifiedMap.set(r.rowNumber, r);
      }
    }

    const mergedEligible = scanResult.eligibleRows.map(newRow => {
      const prev = prevVerifiedMap.get(newRow.rowNumber);
      if (prev) {
        return {
          ...newRow,
          isVerified: true,
          verifiedAt: prev.verifiedAt,
          verifiedBy: prev.verifiedBy,
          emailSent: prev.emailSent,
          emailSentAt: prev.emailSentAt,
          emailRecipient: prev.emailRecipient,
          devBypass: prev.devBypass,
          notes: prev.notes || newRow.notes
        };
      }
      return newRow;
    });

    const isAutoVerified = ['dept', 'class', 'subject'].includes(batch.type);
    const verifiedCount = isAutoVerified
      ? mergedEligible.length
      : mergedEligible.filter(r => r.isVerified).length;

    const updatedBatch = await M.BulkImportBatch.findOneAndUpdate(
      { _id: batch._id },
      {
        $set: {
          totalRows: scanResult.totalRows,
          eligibleCount: mergedEligible.length,
          skippedCount: scanResult.skippedRows.length,
          verifiedCount,
          eligibleRows: mergedEligible,
          skippedRows: scanResult.skippedRows
        }
      },
      { returnDocument: 'after' }
    );

    await transition(updatedBatch, 'staged', {
      user,
      from: ['processing'],
      details: {
        rescan: true,
        totalRows: scanResult.totalRows,
        eligible: mergedEligible.length,
        skipped: scanResult.skippedRows.length
      }
    });

    await tracker.done('save', 'Rescan successfully updated batch');

    await postMessage(batch._id, {
      kind: 'card',
      card: 'summary',
      author: 'system',
      payload: {
        eligibleCount: mergedEligible.length,
        skippedCount: scanResult.skippedRows.length,
        totalRows: scanResult.totalRows,
        rescanned: true
      }
    });

    logAction(
      user.trackId || user._id,
      user.name,
      user.role,
      'BULK_IMPORT_RESCANNED',
      `Bulk ${batch.type.toUpperCase()} import rescanned: ${mergedEligible.length} eligible, ${scanResult.skippedRows.length} skipped (${batch.batchTrackId})`,
      'data',
      'info',
      reqMeta.ip || '127.0.0.1',
      reqMeta.sessionId || '',
      {
        module: 'admin',
        subType: 'bulk-import',
        batchTrackId: batch.batchTrackId,
        type: batch.type,
        total: scanResult.totalRows,
        eligible: mergedEligible.length,
        skipped: scanResult.skippedRows.length
      }
    );

    return updatedBatch;
  } catch (err) {
    console.error('[BulkPipeline Rescan Error]:', err);
    await tracker.fail('rescan', err);

    await M.BulkImportBatch.updateOne(
      { _id: batchId },
      {
        $set: {
          status: 'failed',
          'progress.error': err.message
        }
      }
    ).catch(() => {});

    await postMessage(batchId, {
      kind: 'card',
      card: 'error',
      author: 'system',
      payload: {
        error: err.message,
        stage: 'rescan'
      }
    }).catch(() => {});

    throw err;
  }
}

module.exports = {
  runStageJob,
  runRescanJob
};
