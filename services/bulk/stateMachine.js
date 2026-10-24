const M = require('../../models');
const { bus } = require('./progress');

const TRANSITIONS = {
  draft:                  ['uploading', 'cancelled'],
  uploading:              ['processing', 'failed', 'cancelled', 'draft'],
  processing:             ['staged', 'failed'],
  staged:                 ['skipped_resolved', 'processing', 'cancelled', 'failed'],
  skipped_resolved:       ['pending_sudo_initial', 'sudo_initial_approved', 'processing', 'cancelled', 'staged'],
  pending_sudo_initial:   ['sudo_initial_approved', 'rejected'],
  sudo_initial_approved:  ['verifying', 'verified_all'],
  verifying:              ['verifying', 'verified_all'],
  verified_all:           ['pending_final_approval', 'committing'],
  pending_final_approval: ['committing', 'rejected'],
  committing:             ['committed', 'failed'],
  failed:                 ['processing', 'committing', 'cancelled', 'draft'],
  rejected:               [],
  committed:              [],
  cancelled:              []
};

class StateConflictError extends Error {
  constructor(message, currentStatus, targetStatus) {
    super(message);
    this.name = 'StateConflictError';
    this.status = 409;
    this.statusCode = 409;
    this.currentStatus = currentStatus;
    this.targetStatus = targetStatus;
  }
}

/**
 * Validates and executes an atomic Compare-And-Set status transition.
 * 
 * @param {string|Object} batchOrId - Batch document or ObjectId string
 * @param {string} toStatus - Destination state
 * @param {Object} [opts] - Options: from (array of allowed current states), extraSet (fields to merge), user (audit)
 * @returns {Promise<Object>} Updated BulkImportBatch document
 */
async function transition(batchOrId, toStatus, opts = {}) {
  const batchId = (batchOrId && batchOrId._id) ? batchOrId._id : batchOrId;
  const derived = Object.keys(TRANSITIONS).filter(from => (TRANSITIONS[from] || []).includes(toStatus));
  const allowedFrom = opts.from
    ? (Array.isArray(opts.from) ? opts.from : [opts.from])
    : derived;

  const roadmapEntry = {
    stage: toStatus,
    status: 'COMPLETED',
    timestamp: new Date(),
    user: opts.user?.name || opts.user?.username || 'SYSTEM',
    details: opts.details || {}
  };

  const statusFilter = allowedFrom.length === 1 ? allowedFrom[0] : { $in: allowedFrom };

  const updateOps = {
    $set: {
      status: toStatus,
      ...(opts.extraSet || {})
    },
    $push: {
      roadmap: roadmapEntry
    }
  };

  const updated = await M.BulkImportBatch.findOneAndUpdate(
    { _id: batchId, status: statusFilter },
    updateOps,
    { returnDocument: 'after' }
  );

  if (updated) {
    bus.emit(`batch:${batchId}`, { type: 'status', data: { status: toStatus } });
    return updated;
  }

  const fresh = await M.BulkImportBatch.findById(batchId).select('status').lean();
  if (!fresh) {
    const err = new Error('Batch not found');
    err.status = 404;
    err.statusCode = 404;
    throw err;
  }

  throw new StateConflictError(
    `Cannot transition batch from status "${fresh.status}" to "${toStatus}". Allowed prior states: [${allowedFrom.join(', ')}]`,
    fresh.status,
    toStatus
  );
}

module.exports = {
  TRANSITIONS,
  StateConflictError,
  transition
};
