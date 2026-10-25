/**
 * services/bulk/undo.js
 * Non-destructive reset engine for bulk import workflows (P7, §8.4).
 * Preserves all files, Drive items, committed DB records, messages, and audit trail.
 */

'use strict';

const M = require('../../models');
const { postMessage } = require('./messages');
const { bus } = require('./progress');
const { logAction } = require('../../utils/logAction');
const { isSudoCaller, isSuperAdmin, allRowsInScope } = require('./access');

const RESETTABLE_STATUSES = [
  'draft',
  'staged',
  'skipped_resolved',
  'pending_sudo_initial',
  'sudo_initial_approved',
  'verifying',
  'verified_all',
  'sudo_review',
  'pending_final_approval',
  'rejected',
  'failed',
  'cancelled'
];

const NON_RESETTABLE_REASONS = {
  uploading:  'Cannot undo while a file is actively uploading.',
  processing: 'Cannot undo while spreadsheet processing and validation is in progress.',
  committing: 'Cannot undo while database commit is executing.',
  committed:  'Committed imports cannot be undone (legal record preserved in database).',
  closed:     'Closed imports cannot be undone.'
};

/**
 * Validates whether user has role authority to undo this specific batch stage.
 * Owner can undo up to pending_sudo_initial.
 * Sudo admin and Super Admin (in scope) can undo anytime prior to committing.
 */
function canUserUndo(user, batch) {
  if (!user || !batch) return false;
  if (isSudoCaller(user)) return true;

  const isOwner = batch.uploadedBy?.userId && String(batch.uploadedBy.userId) === String(user._id);
  const isPreApproval = ['draft', 'staged', 'skipped_resolved', 'pending_sudo_initial', 'rejected', 'failed', 'cancelled'].includes(batch.status);

  if (isOwner && isPreApproval) {
    return true;
  }

  if (isSuperAdmin(user) && allRowsInScope(batch, user)) {
    return true;
  }

  return false;
}

/**
 * Executes atomic non-destructive undo.
 * Takes a snapshot, CAS-resets workflow fields to draft, bumps epoch, posts event,
 * emits SSE reset, and logs audit.
 */
async function undoAllActions(batchId, user, options = {}) {
  const batch = await M.BulkImportBatch.findById(batchId);
  if (!batch) {
    const err = new Error('Batch not found');
    err.status = 404;
    throw err;
  }

  // 1. Guard status
  if (!RESETTABLE_STATUSES.includes(batch.status)) {
    const reason = NON_RESETTABLE_REASONS[batch.status] || `Cannot undo batch in status "${batch.status}".`;
    const err = new Error(reason);
    err.status = 409;
    err.code = 'UNDO_NOT_ALLOWED';
    throw err;
  }

  // Guard closed
  if (batch.closed && batch.closed.at) {
    const err = new Error('Closed imports cannot be undone.');
    err.status = 409;
    err.code = 'BATCH_CLOSED';
    throw err;
  }

  // 2. Guard user permission
  if (!canUserUndo(user, batch)) {
    const err = new Error('Permission denied: only Sudo administrators or the batch owner (pre-approval) can undo all actions.');
    err.status = 403;
    err.code = 'PERMISSION_DENIED';
    throw err;
  }

  const fromEpoch = batch.epoch || 0;
  const fromStatus = batch.status;

  // 3. Take snapshot before resetting
  let snapshot = null;
  try {
    snapshot = await M.BulkChatSnapshot.create({
      batchId: batch._id,
      epoch: fromEpoch,
      status: fromStatus,
      eligibleRows: batch.eligibleRows || [],
      skippedRows: batch.skippedRows || [],
      counters: {
        total: batch.totalRows || 0,
        eligible: batch.eligibleCount || 0,
        skipped: batch.skippedCount || 0,
        verified: batch.verifiedCount || 0
      },
      approvals: {
        sudoInitialApproval: batch.sudoInitialApproval || {},
        finalApproval: batch.finalApproval || {},
        rejection: batch.rejection || {}
      },
      progress: batch.progress || {},
      takenBy: user.name || 'Admin',
      takenAt: new Date(),
      state: 'pending'
    });
  } catch (snapErr) {
    console.error('[BulkUndo] Snapshot creation error:', snapErr.message);
  }

  // 4. Atomic CAS reset with epoch increment
  const updated = await M.BulkImportBatch.findOneAndUpdate(
    {
      _id: batch._id,
      epoch: fromEpoch,
      status: { $in: RESETTABLE_STATUSES }
    },
    {
      $set: {
        status: 'draft',
        eligibleRows: [],
        skippedRows: [],
        totalRows: 0,
        eligibleCount: 0,
        skippedCount: 0,
        verifiedCount: 0,
        progress: {},
        sudoInitialApproval: {},
        finalApproval: {},
        rejection: {},
        removedRows: [],
        reviewChanges: [],
        'grievance.open': 0
      },
      $inc: { epoch: 1 },
      $push: {
        roadmap: {
          stage: 'draft',
          status: 'UNDO',
          user: user.name || 'Admin',
          details: {
            fromEpoch,
            snapshotId: snapshot ? snapshot._id : null
          }
        }
      }
    },
    { returnDocument: 'after' }
  );

  if (!updated) {
    if (snapshot) {
      await M.BulkChatSnapshot.updateOne({ _id: snapshot._id }, { $set: { state: 'void' } }).catch(() => {});
    }
    const conflictErr = new Error('Conflict: batch status or epoch changed concurrently. Please refresh.');
    conflictErr.status = 409;
    throw conflictErr;
  }

  // Mark snapshot applied
  if (snapshot) {
    await M.BulkChatSnapshot.updateOne({ _id: snapshot._id }, { $set: { state: 'applied' } }).catch(() => {});
  }

  // 5. Post chat event stamped with the NEW epoch
  const userName = user.name || 'Admin';
  await postMessage(batch._id, {
    kind: 'event',
    author: 'system',
    actor: {
      userId: user._id,
      name: userName,
      role: user.role,
      tier: isSudoCaller(user) ? 'sudo' : (isSuperAdmin(user) ? 'super' : 'staff')
    },
    payload: {
      text: `↩ All actions undone by ${userName} · files, Drive items and saved records were kept`,
      epoch: updated.epoch
    }
  });

  // 6. Emit SSE reset event
  bus.emit(`batch:${batch._id}`, {
    type: 'reset',
    data: {
      batchTrackId: batch.batchTrackId,
      epoch: updated.epoch,
      status: 'draft'
    }
  });

  // 7. Audit log (awaited)
  try {
    await logAction({
      trackId: 'BULK-' + (batch.batchTrackId || batch._id),
      action: 'bulk.undo_all',
      userId: user._id,
      userRole: user.role || 'admin',
      details: {
        batchTrackId: batch.batchTrackId,
        fromEpoch,
        newEpoch: updated.epoch,
        fromStatus,
        snapshotId: snapshot ? snapshot._id : null
      }
    });
  } catch (logErr) {
    console.warn('[BulkUndo] logAction notice:', logErr.message);
  }

  return {
    ok: true,
    message: 'All actions undone. Workflow reset to draft.',
    batch: updated,
    epoch: updated.epoch,
    snapshotId: snapshot ? snapshot._id : null
  };
}

module.exports = {
  RESETTABLE_STATUSES,
  NON_RESETTABLE_REASONS,
  canUserUndo,
  undoAllActions
};
