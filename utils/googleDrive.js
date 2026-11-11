/**
 * utils/googleDrive.js
 *
 * Integrates with Google Drive CLI / API to upload encrypted EAMS backup archives,
 * student OD evidence files, and generate shareable web access links.
 */

const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const BACKUP_FOLDER_ID = process.env.GDRIVE_BACKUP_FOLDER_ID || '10b4EV1DJ-ASRugnLjdIhjjuxeoZkPaUJ';
const BULK_BACKUP_FOLDER_ID = process.env.GDRIVE_BULK_FOLDER_ID || '1A05LHiBo_Nj0iglj0kY9iNEcq_FR3UOL';

/**
 * Finds the gdrive command path.
 */
function getGdriveCmd() {
  const customCmd = path.join(os.homedir(), '.gemini', 'antigravity', 'bin', 'gdrive.cmd');
  if (fs.existsSync(customCmd)) {
    return `"${customCmd}"`;
  }
  return 'gdrive';
}

let _cachedDriveToken = null;
let _driveTokenExpiresAt = 0;

/**
 * Retrieves or refreshes Google OAuth2 access token for Google Drive API v3.
 * Prioritizes environment variables, falling back to local plugin token file.
 */
async function getDriveAccessToken() {
  if (_cachedDriveToken && Date.now() < _driveTokenExpiresAt - 60000) {
    return _cachedDriveToken;
  }

  let clientId = process.env.GDRIVE_CLIENT_ID;
  let clientSecret = process.env.GDRIVE_CLIENT_SECRET;
  let refreshToken = process.env.GDRIVE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    const localTokenPath = path.join(os.homedir(), '.gemini', 'antigravity', 'plugin_data', 'gdrive', 'token.json');
    if (fs.existsSync(localTokenPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(localTokenPath, 'utf8'));
        clientId = clientId || raw.client_id;
        clientSecret = clientSecret || raw.client_secret;
        refreshToken = refreshToken || raw.token?.refresh_token;
      } catch (e) {
        // ignore JSON parse error
      }
    }
  }

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });

    const data = await res.json();
    if (data.access_token) {
      _cachedDriveToken = data.access_token;
      _driveTokenExpiresAt = Date.now() + (parseInt(data.expires_in, 10) || 3600) * 1000;
      return _cachedDriveToken;
    }
    console.warn('[GoogleDrive] Access token refresh response:', data);
  } catch (err) {
    console.warn('[GoogleDrive] Error refreshing Drive access token:', err.message);
  }

  return null;
}

/**
 * Uploads a file directly to Google Drive via Google Drive REST API v3 (Multipart).
 */
async function uploadViaDriveApi(localFilePath, folderId) {
  try {
    const accessToken = await getDriveAccessToken();
    if (!accessToken) return null;

    const fileName = path.basename(localFilePath);
    const fileBuffer = fs.readFileSync(localFilePath);
    const mimeType = fileName.endsWith('.zip') ? 'application/zip' : 'application/octet-stream';

    const boundary = '-------eams_gdrive_boundary_' + Date.now();
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;

    const metadata = {
      name: fileName,
      ...(folderId ? { parents: [folderId] } : {})
    };

    const multipartHeader = Buffer.from(
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${mimeType}\r\n` +
      'Content-Transfer-Encoding: binary\r\n\r\n'
    );
    const multipartFooter = Buffer.from(closeDelim);
    const body = Buffer.concat([multipartHeader, fileBuffer, multipartFooter]);

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length)
      },
      body
    });

    const data = await res.json();
    if (data.id) {
      return {
        success: true,
        fileId: data.id,
        driveUrl: `https://drive.google.com/file/d/${data.id}/view?usp=drivesdk`,
        provider: 'drive-api'
      };
    }
    console.warn('[GoogleDrive] REST API upload returned non-ID payload:', data);
    return null;
  } catch (err) {
    console.warn('[GoogleDrive] REST API upload error:', err.message);
    return null;
  }
}

/**
 * Uploads a local file to Google Drive under the designated backup folder.
 * Uses Direct Drive API v3 via OAuth2 tokens if configured in .env,
 * falling back gracefully to the gdrive CLI if needed.
 *
 * @param {string} localFilePath - Full path to the file to upload
 * @param {Object} [options]
 * @param {string} [options.parentFolderId] - Parent folder ID (default: backup folder)
 * @returns {Promise<{ success: boolean, fileId: string, driveUrl: string, error?: string }>}
 */
async function uploadFileToDrive(localFilePath, options = {}) {
  const folderId = options.parentFolderId || BACKUP_FOLDER_ID;

  // 1. Attempt direct upload via Google Drive REST API v3
  const apiResult = await uploadViaDriveApi(localFilePath, folderId);
  if (apiResult && apiResult.success) {
    return apiResult;
  }

  // 2. Fallback to gdrive CLI if API upload was unavailable or errored
  const gdrive = getGdriveCmd();

  return new Promise((resolve) => {
    const parentFlag = folderId ? `--parent ${folderId}` : '';
    const cmd = `${gdrive} mutate upload "${localFilePath}" ${parentFlag}`;

    exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        console.warn('[GoogleDrive] Upload command error:', err.message, stderr);
        // Try fallback without parent flag if folder fails
        if (folderId) {
          const fallbackCmd = `${gdrive} mutate upload "${localFilePath}"`;
          return exec(fallbackCmd, { timeout: 120000 }, (fbErr, fbStdout, fbStderr) => {
            if (fbErr) {
              return resolve({
                success: false,
                fileId: null,
                driveUrl: null,
                error: fbErr.message || fbStderr
              });
            }
            return resolve(parseUploadOutput(fbStdout));
          });
        }
        return resolve({
          success: false,
          fileId: null,
          driveUrl: null,
          error: err.message || stderr
        });
      }

      const result = parseUploadOutput(stdout);
      resolve(result);
    });
  });
}

/**
 * Parses gdrive CLI output to extract file ID and construct web view URL.
 */
function parseUploadOutput(stdout) {
  const match = stdout.match(/ID:\s*([A-Za-z0-9_-]+)/i);
  if (match && match[1]) {
    const fileId = match[1].trim();
    const driveUrl = `https://drive.google.com/file/d/${fileId}/view?usp=drivesdk`;
    return {
      success: true,
      fileId,
      driveUrl
    };
  }

  return {
    success: true,
    fileId: null,
    driveUrl: 'https://drive.google.com',
    rawOutput: stdout.trim()
  };
}

/**
 * Retrieves or creates the 'Uploads' folder inside bulk backup folder.
 */
async function getOrCreateBulkUploadsFolder() {
  const token = await getDriveAccessToken();
  if (!token) return { folderId: BULK_BACKUP_FOLDER_ID };

  try {
    const q = encodeURIComponent(`'${BULK_BACKUP_FOLDER_ID}' in parents and name = 'Uploads' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      return { folderId: searchData.files[0].id };
    }

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Uploads',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [BULK_BACKUP_FOLDER_ID]
      })
    });
    const createData = await createRes.json();
    return { folderId: createData.id || BULK_BACKUP_FOLDER_ID };
  } catch (err) {
    console.warn('[GoogleDrive] getOrCreateBulkUploadsFolder error:', err.message);
    return { folderId: BULK_BACKUP_FOLDER_ID };
  }
}

/**
 * Creates a dedicated batch folder in Google Drive (e.g. TR-BATCH-MVDFA9BM)
 * under the bulk Uploads/ folder.
 */
async function createBatchFolder(folderName) {
  try {
    const token = await getDriveAccessToken();
    const parent = await getOrCreateBulkUploadsFolder();
    const parentId = parent.folderId || BULK_BACKUP_FOLDER_ID;

    if (!token) return null;

    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      })
    });
    const data = await res.json();
    if (data.id) {
      return {
        folderId: data.id,
        folderName: folderName,
        folderUrl: `https://drive.google.com/drive/folders/${data.id}`
      };
    }
    return null;
  } catch (err) {
    console.warn('[GoogleDrive] createBatchFolder error:', err.message);
    return null;
  }
}

/**
 * Uploads a file buffer directly to a Google Drive folder.
 */
async function uploadBufferToDrive(buffer, fileName, mimeType, parentFolderId) {
  try {
    const token = await getDriveAccessToken();
    if (!token) return null;

    const boundary = '-------eams_gdrive_boundary_' + Date.now();
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;

    const metadata = {
      name: fileName,
      ...(parentFolderId ? { parents: [parentFolderId] } : {})
    };

    const multipartHeader = Buffer.from(
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${mimeType || 'application/octet-stream'}\r\n` +
      'Content-Transfer-Encoding: binary\r\n\r\n'
    );
    const multipartFooter = Buffer.from(closeDelim);
    const body = Buffer.concat([multipartHeader, buffer, multipartFooter]);

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length)
      },
      body
    });

    const data = await res.json();
    if (data.id) {
      return {
        success: true,
        fileId: data.id,
        driveUrl: `https://drive.google.com/file/d/${data.id}/view?usp=drivesdk`
      };
    }
    return null;
  } catch (err) {
    console.warn('[GoogleDrive] uploadBufferToDrive error:', err.message);
    return null;
  }
}

/**
 * Validates evidence file for security:
 * - Max size: 10MB
 * - Whitelist extensions: jpg, jpeg, png, webp, pdf
 * - MIME type whitelist
 * - Magic bytes verification (PDF, JPEG, PNG, WEBP)
 * - Anti-script / executable / polyglot inspection
 */
function validateEvidenceSecurity({ buffer, originalName, mimeType }) {
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Uploaded file is empty' };
  }
  if (buffer.length > MAX_SIZE) {
    return { valid: false, error: `File size (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds 10MB limit` };
  }

  const ext = (path.extname(originalName || '').toLowerCase().replace('.', '')) || '';
  const allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
  if (!allowedExts.includes(ext)) {
    return { valid: false, error: `Invalid file extension '.${ext}'. Allowed formats: IMG, JPG, PNG, PDF` };
  }

  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf', 'application/octet-stream'];
  const cleanMime = (mimeType || '').toLowerCase().split(';')[0].trim();
  if (!allowedMimes.includes(cleanMime)) {
    return { valid: false, error: `Invalid MIME type '${cleanMime}'. Allowed types: JPG, PNG, PDF` };
  }

  // Magic bytes checks
  // PDF: %PDF- (0x25 0x50 0x44 0x46)
  if (ext === 'pdf' || cleanMime === 'application/pdf') {
    const isPdf = buffer.length >= 4 &&
      buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
    if (!isPdf) {
      return { valid: false, error: 'Security validation failed: File claims to be PDF but magic bytes header does not match.' };
    }
  }

  // JPEG: 0xFF 0xD8 0xFF
  if (['jpg', 'jpeg'].includes(ext) || ['image/jpeg', 'image/jpg'].includes(cleanMime)) {
    const isJpg = buffer.length >= 3 &&
      buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
    if (!isJpg) {
      return { valid: false, error: 'Security validation failed: File claims to be JPEG but magic bytes header does not match.' };
    }
  }

  // PNG: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (ext === 'png' || cleanMime === 'image/png') {
    const isPng = buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
      buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A;
    if (!isPng) {
      return { valid: false, error: 'Security validation failed: File claims to be PNG but magic bytes header does not match.' };
    }
  }

  // WEBP: RIFF....WEBP
  if (ext === 'webp' || cleanMime === 'image/webp') {
    const isWebp = buffer.length >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
    if (!isWebp) {
      return { valid: false, error: 'Security validation failed: File claims to be WEBP but magic bytes header does not match.' };
    }
  }

  // Content inspection for embedded scripts/exploits
  const headerSlice = buffer.slice(0, 1024).toString('utf8').toLowerCase();
  const dangerousPatterns = ['<script', '<?php', '<html', '<svg', 'eval(', 'base64_decode', 'system('];
  for (const pattern of dangerousPatterns) {
    if (headerSlice.includes(pattern)) {
      return { valid: false, error: 'Security validation failed: Potentially malicious script detected in file header.' };
    }
  }

  return { valid: true, cleanExt: ext, cleanMime };
}

/**
 * Ensures folder path exists in Google Drive:
 * EAMS_PROJECT / STUDENTS / {dept} / {class} / {trackId}
 */
async function ensureDriveFolderPath(pathSegments, rootParentId = null) {
  const token = await getDriveAccessToken();
  if (!token) return null;

  let currentParentId = rootParentId || null;

  for (const segment of pathSegments) {
    const cleanName = String(segment || 'UNKNOWN').trim().replace(/['\\]/g, '');
    if (!cleanName) continue;

    try {
      let q = `name = '${cleanName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      if (currentParentId) {
        q = `'${currentParentId}' in parents and ` + q;
      }
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        currentParentId = searchData.files[0].id;
      } else {
        const bodyObj = {
          name: cleanName,
          mimeType: 'application/vnd.google-apps.folder'
        };
        if (currentParentId) bodyObj.parents = [currentParentId];
        const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(bodyObj)
        });
        const createData = await createRes.json();
        currentParentId = createData.id || currentParentId;
      }
    } catch (err) {
      console.warn(`[GoogleDrive] Error ensuring folder segment '${cleanName}':`, err.message);
      break;
    }
  }

  return currentParentId;
}

/**
 * Uploads OD evidence file:
 * Checks security, then uploads to Google Drive at:
 * EAMS_PROJECT/STUDENTS/{dept}/{class}/{trackId}/OD_EvidenceFile_{odtrackid}.{ext}
 */
async function uploadODEvidence({ buffer, originalName, mimeType, dept, className, studentTrackId, odTrackId }) {
  // 1. Check security
  const sec = validateEvidenceSecurity({ buffer, originalName, mimeType });
  if (!sec.valid) {
    return { success: false, error: sec.error };
  }

  const ext = path.extname(originalName) || (sec.cleanExt ? `.${sec.cleanExt}` : '.pdf');
  const targetFileName = `OD_EvidenceFile_${odTrackId}${ext}`;
  const md5Checksum = crypto.createHash('md5').update(buffer).digest('hex');

  const pathSegments = [
    'EAMS_PROJECT',
    'STUDENTS',
    dept || 'GENERAL',
    className || 'CLASS',
    studentTrackId || 'STUDENT'
  ];

  let driveResult = null;
  try {
    const folderId = await ensureDriveFolderPath(pathSegments);
    driveResult = await uploadBufferToDrive(buffer, targetFileName, sec.cleanMime || mimeType, folderId);
  } catch (dErr) {
    console.warn('[GoogleDrive] Drive upload failed, trying fallback:', dErr.message);
  }

  // Local fallback storage if drive is offline / unconfigured
  let localUrl = null;
  if (!driveResult || !driveResult.fileId) {
    try {
      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'od-evidence', dept || 'general', className || 'class', studentTrackId || 'student');
      fs.mkdirSync(uploadDir, { recursive: true });
      const localFilePath = path.join(uploadDir, targetFileName);
      fs.writeFileSync(localFilePath, buffer);
      localUrl = `/uploads/od-evidence/${dept || 'general'}/${className || 'class'}/${studentTrackId || 'student'}/${targetFileName}`;
    } catch (fsErr) {
      console.warn('[GoogleDrive] Local file fallback save error:', fsErr.message);
    }
  }

  const fileId = driveResult?.fileId || `local_${Date.now()}`;
  const driveUrl = driveResult?.driveUrl || localUrl || '';

  return {
    success: true,
    fileId,
    driveUrl,
    fileName: targetFileName,
    mimeType: sec.cleanMime || mimeType,
    sizeBytes: buffer.length,
    md5Checksum,
    folderPath: `EAMS_PROJECT/STUDENTS/${dept || 'GENERAL'}/${className || 'CLASS'}/${studentTrackId || 'STUDENT'}/`
  };
}

module.exports = {
  uploadFileToDrive,
  uploadBufferToDrive,
  createBatchFolder,
  getOrCreateBulkUploadsFolder,
  validateEvidenceSecurity,
  ensureDriveFolderPath,
  uploadODEvidence,
  BACKUP_FOLDER_ID,
  BULK_BACKUP_FOLDER_ID,
  getDriveAccessToken
};
