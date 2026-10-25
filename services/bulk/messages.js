const M = require('../../models');
const { bus } = require('./progress');

function resolveActorTier(actor, author) {
  if (author === 'system' || !actor || actor.role === 'system') return 'system';
  if (actor.tier) return actor.tier;
  try {
    const { resolveAccess } = require('../../utils/resolveAccess');
    const acc = resolveAccess(actor);
    if (acc.tier === 'sudoAdmin' || acc.flags?.isSudo) return 'sudo';
    if (acc.tier === 'superAdmin' || acc.flags?.isSuper) return 'super';
    if (acc.tier === 'subAdmin' || acc.flags?.isSub) return 'sub';
  } catch (e) {}
  const role = String(actor.role || '').toLowerCase();
  if (role === 'sudo' || role === 'admin') return 'sudo';
  if (role === 'super' || role === 'superadmin') return 'super';
  if (role === 'sub' || role === 'subadmin') return 'sub';
  if (role === 'system') return 'system';
  return 'staff';
}


function preview(card, payload = {}) {
  if (payload.text) return String(payload.text).slice(0, 80);
  switch (card) {
    case 'type':
      return `Selected import type: ${payload.type || ''}`;
    case 'column-ref':
      return `Column reference for ${payload.type || ''}`;
    case 'upload':
      return 'File upload dropzone ready';
    case 'file':
      return `Uploaded ${payload.name || 'spreadsheet'}`;
    case 'progress':
      return `Processing ${payload.jobKind || 'batch'}...`;
    case 'summary':
      return `Summary: ${payload.eligibleCount || payload.eligible || 0} ready, ${payload.skippedCount || payload.skipped || 0} skipped`;
    case 'sudo-review':
      return payload.approved ? 'Approved by Sudo Admin' : 'Forwarded for Sudo Admin approval';
    case 'verify':
      return 'Verification in progress';
    case 'final':
      return 'Submitted for final approval';
    case 'complete':
      return `Committed ${payload.addedCount || 0} records to database`;
    case 'error':
      return `Import error: ${payload.error || 'Failed'}`;
    case 'rejected':
      return `Rejected: ${payload.reason || 'Not approved'}`;
    case 'grievance':
      return `⚑ Grievance: ${payload.rows?.length || 0} row(s) flagged`;
    default:
      return 'Batch update';
  }
}

/**
 * Appends a message to the batch transcript.
 * Server is the sole author of the transcript.
 */
async function postMessage(batchId, {
  kind = 'card',
  card = '',
  author = 'system',
  actor = null,
  payload = {}
}) {
  const previewText = preview(card, payload);

  const batch = await M.BulkImportBatch.findOneAndUpdate(
    { _id: batchId },
    {
      $inc: { messageSeq: 1 },
      $set: {
        lastMessageAt: new Date(),
        lastMessagePreview: previewText
      }
    },
    { returnDocument: 'after', projection: { messageSeq: 1 } }
  );

  if (!batch) {
    throw new Error('Batch not found for postMessage');
  }

  const seq = batch.messageSeq;
  const msgDoc = await M.BulkChatMessage.create({
    batchId,
    seq,
    kind,
    card,
    author,
    actor: (actor && author !== 'system') ? {
      userId:   actor._id || actor.userId || null,
      trackId:  actor.trackId || null,
      username: actor.username || null,
      name:     actor.name || actor.fullName || actor.username || 'User',
      role:     actor.role || 'staff',
      tier:     resolveActorTier(actor, author)
    } : {
      userId: null,
      trackId: null,
      username: null,
      name:   (actor && actor.name) || 'EAMS Assistant',
      role:   'system',
      tier:   'system'
    },
    payload
  });

  bus.emit(`batch:${batchId}`, {
    type: 'message',
    seq,
    data: msgDoc
  });

  return msgDoc;
}

module.exports = {
  preview,
  postMessage
};
