const JSZip = require('jszip');
const bcrypt = require('@node-rs/bcrypt');
const M = require('../../models');
const cfg = require('../../config');
const { createTracker } = require('./progress');
const { transition } = require('./stateMachine');
const { postMessage } = require('./messages');
const storage = require('./storage');
const { uploadBulkBackupZip } = require('../../utils/driveStore');
const { normalizeYearRange, toBatchTrackId, buildStudentTrackId } = require('../../utils/yearFormat');
const { sanitizeFullName, splitFirstLastName } = require('../../utils/nameFormat');
const { logAction } = require('../../utils/logAction');

/**
 * Resumable commit job: commits eligible records to live DB, builds archive with
 * redacted passwords, uploads backup to Google Drive, and purges credentials.
 */
async function runCommitJob(batchId, user, reqMeta = {}) {
  const tracker = createTracker(batchId, 'commit');

  try {
    const batch = await M.BulkImportBatch.findById(batchId);
    if (!batch) throw new Error('Batch not found');

    // 1. Commit records to Live Collections
    await tracker.start('rows', 'Saving records to database');

    const eligibleRows = batch.eligibleRows || [];
    const rowsToCommit = eligibleRows.filter(r => !r.committed && (['dept', 'class', 'subject'].includes(batch.type) || r.isVerified));
    const allDepts = await M.Department.find({}).lean();

    let addedCount = eligibleRows.filter(r => r.committed).length;
    const commitErrors = [];

    for (let i = 0; i < rowsToCommit.length; i++) {
      const entry = rowsToCommit[i];
      const data = entry.data || {};

      try {
        if (batch.type === 'student') {
          const defaultPassword = data.password || cfg.STUDENT_PASSWORD || 'Student@123';
          const hash = await bcrypt.hash(defaultPassword, cfg.BCRYPT_ROUNDS);
          const generatedTrackId = (data.trackId && !data.trackId.startsWith('TRSTU_') && !data.trackId.startsWith('STU'))
            ? data.trackId
            : buildStudentTrackId(data.registerNo, data.deptId || data.department, data.batch, data.academicYear, allDepts);

          const normBatch = normalizeYearRange(data.batch);
          const normAcadYear = normalizeYearRange(data.academicYear);
          const cls = await M.Class.findOne({ name: data.class }).lean();

          const cleanFullName = sanitizeFullName(data.fullName);
          const split = splitFirstLastName(cleanFullName);
          const firstName = data.firstName ? sanitizeFullName(data.firstName) : split.firstName;
          const lastName = (data.lastName !== undefined && data.lastName !== null && data.lastName !== '')
            ? sanitizeFullName(data.lastName)
            : (split.lastName || null);

          // Atomic row creation with rollback compensation on error
          let createdStudent = null;
          try {
            createdStudent = await M.Student.create({
              fullName: cleanFullName,
              firstName,
              lastName,
              registerNo: data.registerNo,
              gender: data.gender,
              batch: normBatch,
              batchTrackId: toBatchTrackId(normBatch),
              admissionYear: normAcadYear,
              academicYear: normAcadYear,
              courseType: data.courseType,
              branch: data.branch,
              department: data.department,
              deptId: data.deptId,
              class: data.class,
              classId: cls ? cls._id : null,
              residency: data.residency ? (String(data.residency).toLowerCase().includes('hostel') ? 'hostel' : 'dayscholar') : 'dayscholar',
              email: data.email,
              username: data.username,
              password: hash,
              trackId: generatedTrackId,
              mustChangePassword: true
            });

            const existingUser = await M.User.findOne({ username: data.username }).lean();
            if (existingUser && existingUser.trackId && existingUser.trackId !== generatedTrackId) {
              throw new Error(`Username "${data.username}" is already assigned to ${existingUser.role} (${existingUser.trackId}).`);
            }

            await M.User.findOneAndUpdate(
              { username: data.username },
              {
                $set: { status: 'active' },
                $setOnInsert: { username: data.username, role: 'student', trackId: generatedTrackId }
              },
              { upsert: true }
            );
          } catch (createErr) {
            if (createdStudent && createdStudent._id) {
              await M.Student.deleteOne({ _id: createdStudent._id }).catch(() => {});
            }
            throw createErr;
          }

          entry.committed = true;
          entry.committedAt = new Date();
          addedCount++;
        } else if (batch.type === 'teacher') {
          const defaultPassword = data.password || cfg.TEACHER_PASSWORD || 'teacher123';
          const hash = await bcrypt.hash(defaultPassword, cfg.BCRYPT_ROUNDS);
          const generatedTrackId = 'TRTCH' + (data.employeeNo ? String(data.employeeNo).trim() : Date.now());

          const cleanFullName = sanitizeFullName(data.fullName);
          const split = splitFirstLastName(cleanFullName);
          const firstName = data.firstName ? sanitizeFullName(data.firstName) : split.firstName;
          const lastName = (data.lastName !== undefined && data.lastName !== null && data.lastName !== '')
            ? sanitizeFullName(data.lastName)
            : (split.lastName || null);

          let createdTeacher = null;
          try {
            createdTeacher = await M.Teacher.create({
              fullName: cleanFullName,
              firstName,
              lastName,
              employeeNo: data.employeeNo,
              department: data.department,
              deptId: data.deptId,
              deptCode: data.deptCode,
              designation: data.designation,
              username: data.username,
              password: hash,
              email: data.email || '',
              gender: data.gender || 'unspecified',
              trackId: generatedTrackId,
              mustChangePassword: true
            });

            const existingUser = await M.User.findOne({ username: data.username }).lean();
            if (existingUser && existingUser.trackId && existingUser.trackId !== generatedTrackId) {
              throw new Error(`Username "${data.username}" is already assigned to ${existingUser.role} (${existingUser.trackId}).`);
            }

            await M.User.findOneAndUpdate(
              { username: data.username },
              {
                $set: { status: 'active' },
                $setOnInsert: { username: data.username, role: 'teacher', trackId: generatedTrackId }
              },
              { upsert: true }
            );
          } catch (tErr) {
            if (createdTeacher && createdTeacher._id) {
              await M.Teacher.deleteOne({ _id: createdTeacher._id }).catch(() => {});
            }
            throw tErr;
          }

          entry.committed = true;
          entry.committedAt = new Date();
          addedCount++;
        } else if (batch.type === 'dept') {
          await M.Department.create({
            name: data.name,
            code: data.code,
            icon: data.icon || 'building2',
            number: data.number || '',
            courseType: data.courseType || 'UG',
            branch: data.branch || 'B.E',
            category: (data.category && String(data.category).toLowerCase().includes('supp')) ? 'supporting' : 'programme'
          });
          entry.committed = true;
          entry.committedAt = new Date();
          addedCount++;
        } else if (batch.type === 'class') {
          // A10: Robust semester & hall mapping
          await M.Class.create({
            name: data.name,
            deptId: data.deptId,
            deptName: data.deptName,
            deptCode: data.deptCode,
            year: data.year,
            sem: data.sem || data.semester || 'I',
            hallNo: data.hallNo || data.hall || '',
            batch: normalizeYearRange(data.batch)
          });
          entry.committed = true;
          entry.committedAt = new Date();
          addedCount++;
        } else if (batch.type === 'subject') {
          await M.Subject.create({
            name: data.name,
            code: data.code,
            subjectCode: data.subjectCode,
            credits: data.credits,
            type: data.type,
            deptId: data.deptId,
            deptName: data.deptName,
            deptCode: data.deptCode
          });
          entry.committed = true;
          entry.committedAt = new Date();
          addedCount++;
        }
      } catch (rowErr) {
        entry.commitError = rowErr.message;
        commitErrors.push({ rowNumber: entry.rowNumber, error: rowErr.message });
      }

      // Live progress updates
      if ((i + 1) % 25 === 0 || i === rowsToCommit.length - 1) {
        const pct = rowsToCommit.length ? Math.round(((i + 1) / rowsToCommit.length) * 100) : 100;
        await tracker.tick('rows', pct, `${i + 1} / ${rowsToCommit.length} records committed`, {
          committed: addedCount
        });
        await M.BulkImportBatch.updateOne(
          { _id: batchId },
          { $set: { eligibleRows: batch.eligibleRows } }
        ).catch(() => {});
      }
    }

    await tracker.done('rows', `Committed ${addedCount} records successfully`);

    // 2. Build ZIP Archive (Passwords redacted per A2)
    await tracker.start('zip', 'Compiling archive and scrubbing credentials');
    const zip = new JSZip();

    let origBuffer = null;
    if (batch.fileRef && batch.fileRef.gridFsId) {
      origBuffer = await storage.get(batch.fileRef.gridFsId).catch(() => null);
    } else if (batch.fileBufferBase64) {
      origBuffer = Buffer.from(batch.fileBufferBase64, 'base64');
    }

    if (origBuffer) {
      zip.file(batch.originalFileName || 'original_upload.xlsx', origBuffer);
    }

    const sanitizedRecords = (batch.eligibleRows || []).map(r => {
      const rec = { ...(r.data || {}) };
      delete rec.password;
      return rec;
    });

    zip.file('uploaded_user_details.json', JSON.stringify({
      batchTrackId: batch.batchTrackId,
      importType: batch.type,
      totalUploaded: batch.totalRows,
      eligibleCount: batch.eligibleCount,
      verifiedCount: batch.verifiedCount,
      records: sanitizedRecords
    }, null, 2));

    zip.file('device_details.json', JSON.stringify({
      uploader: batch.uploadedBy,
      device: batch.deviceDetails,
      approverDevice: {
        approverName: user.name || 'Sudo Admin',
        approverIp: reqMeta.ip || '127.0.0.1',
        approverUserAgent: reqMeta.userAgent || ''
      }
    }, null, 2));

    zip.file('verification_logs.json', JSON.stringify({
      verificationAudit: batch.verificationAudit,
      individualRows: (batch.eligibleRows || []).map(r => ({
        rowNumber: r.rowNumber,
        isVerified: r.isVerified,
        verifiedAt: r.verifiedAt,
        verifiedBy: r.verifiedBy,
        emailSent: r.emailSent,
        emailSentAt: r.emailSentAt,
        emailRecipient: r.emailRecipient
      }))
    }, null, 2));

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });

    await tracker.done('zip', `${(zipBuffer.length / 1024).toFixed(1)} KB backup package ready`);

    // 3. Backup to Google Drive (Resilient fallback: Drive failure does not block DB commit - A4)
    await tracker.start('backup', 'Uploading backup archive to Google Drive');
    let backupMeta = {
      driveFileId: '',
      driveWebViewLink: '',
      localPath: '',
      zipSize: zipBuffer.length,
      md5: '',
      archivedAt: null,
      status: 'pending'
    };

    try {
      const backupResult = await uploadBulkBackupZip({
        buffer: zipBuffer,
        zipFileName: `BULK_ARCHIVE_${batch.batchTrackId}.zip`,
        batchTrackId: batch.batchTrackId,
        type: batch.type,
        uploaderTrackId: batch.uploadedBy?.trackId || 'ADMIN',
        uploadedBy: batch.uploadedBy?.trackId || 'ADMIN'
      });

      const ok = Boolean(backupResult && backupResult.webViewLink);
      backupMeta = {
        driveFileId: ok ? backupResult.driveFileId : '',
        driveWebViewLink: backupResult.webViewLink || backupResult.driveWebViewLink || '',
        localPath: backupResult.localPath || '',
        zipSize: backupResult.size || backupResult.zipSize || zipBuffer.length,
        md5: backupResult.md5Checksum || backupResult.md5 || '',
        archivedAt: new Date(),
        status: ok ? 'done' : 'failed',
        error: ok ? '' : 'Google Drive upload failed'
      };

      if (ok) {
        await tracker.done('backup', 'Backup securely archived to Google Drive');
      } else {
        await tracker.warn('backup', 'Google Drive backup upload failed — Retry Backup available');
      }
    } catch (bErr) {
      console.warn('[BulkCommit Backup Notice]: Google Drive backup warning:', bErr.message);
      backupMeta.status = 'failed';
      backupMeta.error = bErr.message;
      await tracker.warn('backup', `Google Drive backup failed (${bErr.message}) — Retry Backup available`);
    }

    // 4. Purge plaintext passwords from MongoDB storage (A2, F-06)
    await M.BulkImportBatch.updateOne(
      { _id: batch._id },
      { $unset: { 'eligibleRows.$[].data.password': '', 'skippedRows.$[].data.password': '' } }
    );
    for (const r of (batch.eligibleRows || [])) {
      if (r.data) delete r.data.password;
    }
    for (const r of (batch.skippedRows || [])) {
      if (r.data) delete r.data.password;
    }

    batch.backup = backupMeta;
    batch.finalApproval = {
      approved: true,
      approvedBy: user.name || 'Sudo Admin',
      approvedAt: new Date(),
      notes: reqMeta.notes || 'Final approval and commit executed'
    };

    await batch.save();

    // 5. CAS Transition to committed
    const committedBatch = await transition(batch, 'committed', {
      user,
      from: ['committing', 'pending_final_approval', 'verified_all']
    });
    batch.status = 'committed';

    // 6. Post completion card to transcript
    await postMessage(batch._id, {
      kind: 'card',
      card: 'complete',
      author: 'system',
      payload: {
        addedCount,
        backupStatus: backupMeta.status,
        driveUrl: backupMeta.driveWebViewLink
      }
    });

    // 7. Audit log
    logAction(
      user.trackId || user._id,
      user.name,
      user.role,
      `Bulk ${batch.type.toUpperCase()} Import Completed`,
      `${addedCount} records committed to live database. Google Drive backup ${backupMeta.status}.`,
      'data',
      'info',
      reqMeta.ip || '127.0.0.1',
      reqMeta.sessionId || '',
      {
        module: 'admin',
        subType: 'bulk-import',
        batchTrackId: batch.batchTrackId,
        driveBackupId: backupMeta.driveFileId
      }
    );

    return {
      ok: true,
      addedCount,
      commitErrors,
      backup: backupMeta
    };
  } catch (err) {
    console.error('[BulkCommit Error]:', err);
    await tracker.fail('commit', err);

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
        stage: 'commit'
      }
    }).catch(() => {});

    throw err;
  }
}

/**
 * Retries Google Drive backup ZIP upload only
 */
async function retryBackupOnly(batchId, user) {
  const batch = await M.BulkImportBatch.findById(batchId);
  if (!batch) throw new Error('Batch not found');
  if (batch.status !== 'committed') {
    throw new Error('Only committed batches can retry backup archive');
  }

  const zip = new JSZip();
  let origBuffer = null;
  if (batch.fileRef && batch.fileRef.gridFsId) {
    origBuffer = await storage.get(batch.fileRef.gridFsId).catch(() => null);
  } else if (batch.fileBufferBase64) {
    origBuffer = Buffer.from(batch.fileBufferBase64, 'base64');
  }

  if (origBuffer) {
    zip.file(batch.originalFileName || 'original_upload.xlsx', origBuffer);
  }

  const sanitizedRecords = (batch.eligibleRows || []).map(r => {
    const rec = { ...(r.data || {}) };
    delete rec.password;
    return rec;
  });

  zip.file('uploaded_user_details.json', JSON.stringify({
    batchTrackId: batch.batchTrackId,
    importType: batch.type,
    records: sanitizedRecords
  }, null, 2));

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  const backupResult = await uploadBulkBackupZip({
    buffer: zipBuffer,
    zipFileName: `BULK_ARCHIVE_${batch.batchTrackId}.zip`,
    batchTrackId: batch.batchTrackId,
    type: batch.type,
    uploaderTrackId: batch.uploadedBy?.trackId || 'ADMIN',
    uploadedBy: batch.uploadedBy?.trackId || 'ADMIN'
  });

  const ok = Boolean(backupResult && backupResult.webViewLink);
  batch.backup = {
    driveFileId: ok ? backupResult.driveFileId : '',
    driveWebViewLink: backupResult.webViewLink || backupResult.driveWebViewLink || '',
    localPath: backupResult.localPath || '',
    zipSize: backupResult.size || backupResult.zipSize || zipBuffer.length,
    md5: backupResult.md5Checksum || backupResult.md5 || '',
    archivedAt: new Date(),
    status: ok ? 'done' : 'failed',
    error: ok ? '' : 'Google Drive upload failed'
  };

  await batch.save();
  return batch.backup;
}

module.exports = {
  runCommitJob,
  retryBackupOnly
};
