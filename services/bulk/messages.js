const M = require('../../models');
const { bus } = require('./progress');

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
    actor: actor ? {
      userId: actor._id || actor.userId || null,
      name:   actor.name || actor.fullName || actor.username || 'System',
      role:   actor.role || 'system'
    } : { name: 'System', role: 'system' },
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
