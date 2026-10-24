const crypto = require('crypto');
const M = require('../models');
const { getSettings } = require('./settingsCache');

const SAFE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv'
]);

function sanitizeMimeType(rawMime) {
  if (!rawMime || typeof rawMime !== 'string') return 'application/octet-stream';
  const clean = rawMime.toLowerCase().split(';')[0].trim();
  return SAFE_MIME_TYPES.has(clean) ? clean : 'application/octet-stream';
}

// Cloud-based evidence storage (zero local disk storage)
/**
 * Calculate MD5 checksum of a buffer or stream
 */
function calculateMD5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Initialize Google Drive client if credentials and package exist
 */
function getGoogleDriveClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) return null;

  try {
    const { google } = require('googleapis');
    let credentials;
    try {
      credentials = JSON.parse(serviceAccountJson);
    } catch (e) {
      if (fs.existsSync(serviceAccountJson)) {
        credentials = JSON.parse(fs.readFileSync(serviceAccountJson, 'utf8'));
      } else {
        return null;
      }
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive']
    });

    return google.drive({ version: 'v3', auth });
  } catch (err) {
    console.warn('[DriveStore] googleapis package not loaded or failed to authenticate:', err.message);
    return null;
  }
}

/**
 * Upload a file buffer to Google Drive Shared Drive or local fallback.
 *
 * @param {Object} params
 * @param {Buffer} params.buffer - File buffer
 * @param {string} params.originalName - Name of the file
 * @param {string} params.mimeType - MIME type
 * @param {string} params.uploadedBy - TrackId of uploader
 * @param {string} [params.requestId] - Associated request ID (e.g. OD-2026-000481)
 * @param {string} [params.requestType] - 'student_leave' | 'od' | 'faculty_leave'
 * @returns {Promise<Object>} Stored evidence document
 */
async function uploadEvidenceFile({
  buffer,
  originalName,
  mimeType,
  uploadedBy,
  requestId = null,
  requestType = 'od'
}) {
  const size = buffer.length;
  const md5Checksum = calculateMD5(buffer);

  // Check duplicate file checksum across earlier submissions
  const duplicate = await M.ActivityEvidence.findOne({ md5Checksum }).lean();
  let duplicateWarning = null;
  if (duplicate) {
    duplicateWarning = `Duplicate file detected: identical content was previously submitted for ${duplicate.requestId || 'another request'} by ${duplicate.uploadedBy}.`;
  }

  const drive = getGoogleDriveClient();
  const settings = await getSettings(['evidence']);
  const sharedDriveId = settings.evidence?.driveSharedDriveId || process.env.GOOGLE_SHARED_DRIVE_ID;

  let driveFileId = null;
  let webViewLink = '';
  let storageProvider = 'gdrive';
  let localPath = null;

  if (drive && sharedDriveId) {
    try {
      const { Readable } = require('stream');
      const stream = new Readable();
      stream.push(buffer);
      stream.push(null);

      const fileMetadata = {
        name: `${Date.now()}_${originalName}`,
        parents: [sharedDriveId]
      };

      const media = {
        mimeType: sanitizeMimeType(mimeType),
        body: stream
      };

      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink, md5Checksum',
        supportsAllDrives: true
      });

      driveFileId = response.data.id;
      webViewLink = response.data.webViewLink || '';
      storageProvider = 'gdrive';
    } catch (gErr) {
      console.warn('[DriveStore] Google Drive service account upload failed, trying OAuth buffer upload:', gErr.message);
    }
  }

  // Fallback to OAuth2 uploadBufferToDrive if service account was not configured or failed
  if (!driveFileId) {
    try {
      const { uploadBufferToDrive, BULK_BACKUP_FOLDER_ID } = require('./googleDrive');
      const gResult = await uploadBufferToDrive(
        buffer,
        `${Date.now()}_${originalName}`,
        sanitizeMimeType(mimeType),
        sharedDriveId || BULK_BACKUP_FOLDER_ID
      );
      if (gResult && gResult.fileId) {
        driveFileId = gResult.fileId;
        webViewLink = gResult.driveUrl || `https://drive.google.com/file/d/${gResult.fileId}/view?usp=drivesdk`;
        storageProvider = 'gdrive';
      }
    } catch (oauthErr) {
      console.warn('[DriveStore] OAuth2 Drive upload error:', oauthErr.message);
    }
  }

  if (!driveFileId) {
    driveFileId = `doc_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    storageProvider = 'cloud-pending';
    webViewLink = '';
  }

  const evidenceDoc = await M.ActivityEvidence.create({
    driveFileId,
    originalName,
    mimeType: sanitizeMimeType(mimeType),
    size,
    md5Checksum,
    webViewLink,
    storageProvider,
    localPath: null,
    uploadedBy,
    requestId,
    requestType
  });

  return {
    evidence: evidenceDoc,
    duplicateWarning
  };
}

/**
 * Handle a pasted Google Drive link by verifying and storing metadata.
 *
 * @param {Object} params
 * @param {string} params.driveLink - URL pasted by user
 * @param {string} params.uploadedBy - Track ID
 * @param {string} [params.requestId]
 * @param {string} [params.requestType]
 */
async function importFromDriveLink({ driveLink, uploadedBy, requestId = null, requestType = 'od' }) {
  // Extract file ID from typical Drive URLs: /file/d/<id>/view or id=<id>
  const match = driveLink.match(/\/d\/([a-zA-Z0-9_-]+)/) || driveLink.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error('Invalid Google Drive URL format. Please provide a standard Google Drive sharing link.');
  }

  const externalFileId = match[1];
  const drive = getGoogleDriveClient();

  let originalName = 'GoogleDrive_Document';
  let mimeType = 'application/octet-stream';
  let size = 0;
  let md5Checksum = crypto.createHash('md5').update(externalFileId).digest('hex');

  if (drive) {
    try {
      const meta = await drive.files.get({
        fileId: externalFileId,
        fields: 'id, name, mimeType, size, md5Checksum, webViewLink',
        supportsAllDrives: true
      });

      if (meta.data) {
        originalName = meta.data.name || originalName;
        mimeType = meta.data.mimeType || mimeType;
        size = Number(meta.data.size) || 0;
        if (meta.data.md5Checksum) md5Checksum = meta.data.md5Checksum;
      }
    } catch (err) {
      throw new Error('Unable to access Google Drive file. Ensure file sharing is set to "Anyone with the link can view".');
    }
  }

  const evidenceDoc = await M.ActivityEvidence.create({
    driveFileId: externalFileId,
    originalName,
    mimeType: sanitizeMimeType(mimeType),
    size,
    md5Checksum,
    webViewLink: driveLink,
    storageProvider: 'gdrive',
    uploadedBy,
    requestId,
    requestType
  });

  return { evidence: evidenceDoc };
}

/**
 * Retrieve file stream and metadata for permission-checked download
 *
 * @param {string} driveFileId
 * @returns {Promise<{ stream: ReadableStream, originalName: string, mimeType: string, size: number }>}
 */
async function getFileStream(driveFileId) {
  const record = await M.ActivityEvidence.findOne({ driveFileId }).lean();
  if (!record) {
    throw new Error('File not found');
  }

  const drive = getGoogleDriveClient();
  if (drive) {
    const res = await drive.files.get(
      { fileId: driveFileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    );
    return {
      stream: res.data,
      originalName: record.originalName,
      mimeType: sanitizeMimeType(record.mimeType),
      size: record.size
    };
  }

  throw new Error('Storage provider unavailable or credentials missing');
}

/**
 * Upload a complete bulk import backup ZIP directly to Google Drive (zero local disk storage)
 */
async function uploadBulkBackupZip({ buffer, zipFileName, batchTrackId, uploadedBy, folderId }) {
  const size = buffer.length;
  const md5Checksum = calculateMD5(buffer);

  let driveFileId = `backup_${batchTrackId}_${Date.now()}`;
  let webViewLink = '';
  let storageProvider = 'Google Drive';

  // Upload to Google Drive directly via buffer (zero local disk storage)
  try {
    const { uploadBufferToDrive, BULK_BACKUP_FOLDER_ID } = require('./googleDrive');
    const targetFolderId = folderId || BULK_BACKUP_FOLDER_ID;
    const gResult = await uploadBufferToDrive(
      buffer,
      zipFileName || `BULK_ARCHIVE_${batchTrackId}_${Date.now()}.zip`,
      'application/zip',
      targetFolderId
    );

    if (gResult && gResult.fileId) {
      driveFileId = gResult.fileId;
      webViewLink = gResult.driveUrl || `https://drive.google.com/file/d/${gResult.fileId}/view?usp=drivesdk`;
      storageProvider = 'Google Drive';
    }
  } catch (gErr) {
    console.warn('[DriveStore:BulkZip] Google Drive upload failed:', gErr.message);
  }

  return {
    driveFileId,
    webViewLink,
    storageProvider,
    localPath: null,
    size,
    md5Checksum,
    archivedAt: new Date()
  };
}

module.exports = {
  uploadEvidenceFile,
  importFromDriveLink,
  getFileStream,
  calculateMD5,
  uploadBulkBackupZip,
  SAFE_MIME_TYPES,
  sanitizeMimeType
};
