/**
 * services/bulk/driveFolder.js
 *
 * Dedicated Google Drive Folder Provisioner for Bulk Import Chats.
 * Every bulk import chat gets exactly one folder named after its unique track ID (e.g. TR-BKTCH-7K3QF).
 * Idempotent, retryable with exponential backoff, non-blocking for end users.
 */

const M = require('../../models');
const { createBatchFolder, findFolderByName } = require('../../utils/googleDrive');
const { bus } = require('./progress');

const RETRY_DELAYS = [1000, 3000, 9000];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Provisions a dedicated Google Drive folder named exactly after the batch's batchTrackId.
 * Idempotent: checks if folder already exists before creating.
 *
 * @param {string|mongoose.Types.ObjectId} batchId
 * @returns {Promise<Object>} The drive metadata object
 */
async function provisionDriveFolder(batchId) {
  const batch = await M.BulkImportBatch.findById(batchId);
  if (!batch) {
    throw new Error(`Batch not found for Drive provisioning: ${batchId}`);
  }

  // If already ready with valid folderId, no need to recreate
  if (batch.drive && batch.drive.folderId && batch.drive.status === 'ready') {
    return batch.drive;
  }

  const folderName = batch.batchTrackId;
  let driveFolder = null;
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      // 1. Idempotency check: see if folder already exists under Uploads
      driveFolder = await findFolderByName(folderName);
      if (!driveFolder) {
        // 2. Create folder
        driveFolder = await createBatchFolder(folderName);
      }

      if (driveFolder && driveFolder.folderId) {
        break;
      }
    } catch (err) {
      lastError = err;
      console.warn(`[DriveFolder] Provision attempt ${attempt + 1} failed for ${folderName}:`, err.message);
    }

    if (attempt < RETRY_DELAYS.length) {
      await sleep(RETRY_DELAYS[attempt]);
    }
  }

  const isSuccess = Boolean(driveFolder && driveFolder.folderId);
  const now = new Date();

  const driveUpdate = isSuccess ? {
    'drive.folderId':   driveFolder.folderId,
    'drive.folderName': driveFolder.folderName || folderName,
    'drive.folderUrl':  driveFolder.folderUrl || `https://drive.google.com/drive/folders/${driveFolder.folderId}`,
    'drive.status':     'ready',
    'drive.error':      '',
    'provisioning.state': 'ready',
    'provisioning.at':    now
  } : {
    'drive.folderName': folderName,
    'drive.status':     'degraded',
    'drive.error':      lastError ? lastError.message : 'Google Drive folder could not be allocated',
    'provisioning.state': 'degraded',
    'provisioning.at':    now
  };

  const updatedBatch = await M.BulkImportBatch.findByIdAndUpdate(
    batchId,
    { $set: driveUpdate },
    { returnDocument: 'after' }
  );

  const payload = {
    folderId:   updatedBatch.drive?.folderId || '',
    folderName: updatedBatch.drive?.folderName || folderName,
    folderUrl:  updatedBatch.drive?.folderUrl || '',
    status:     updatedBatch.drive?.status || (isSuccess ? 'ready' : 'degraded'),
    provisioningState: isSuccess ? 'ready' : 'degraded'
  };

  bus.emit(`batch:${batch._id}`, {
    type: 'provisioned',
    data: payload
  });

  return updatedBatch.drive;
}

module.exports = {
  provisionDriveFolder
};
