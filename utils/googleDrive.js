/**
 * utils/googleDrive.js
 *
 * Integrates with Google Drive CLI / API to upload encrypted EAMS backup archives
 * and generate shareable web access links.
 */

const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

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
      `Content-Type: ${mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}\r\n` +
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
 * Finds an existing folder in Google Drive by its exact name under a specific parent folder.
 * Defaults parent to the bulk Uploads/ folder if parentId is not specified.
 */
async function findFolderByName(name, parentId) {
  try {
    const token = await getDriveAccessToken();
    if (!token) return null;

    let targetParent = parentId;
    if (!targetParent) {
      const uploadsFolder = await getOrCreateBulkUploadsFolder();
      targetParent = uploadsFolder ? uploadsFolder.folderId : BULK_BACKUP_FOLDER_ID;
    }

    const safeName = String(name || '').replace(/'/g, "\\'");
    const q = encodeURIComponent(`'${targetParent}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      return {
        folderId: data.files[0].id,
        folderName: data.files[0].name,
        folderUrl: `https://drive.google.com/drive/folders/${data.files[0].id}`
      };
    }
    return null;
  } catch (err) {
    console.warn('[GoogleDrive] findFolderByName error:', err.message);
    return null;
  }
}

module.exports = {
  uploadFileToDrive,
  uploadBufferToDrive,
  createBatchFolder,
  findFolderByName,
  getOrCreateBulkUploadsFolder,
  BACKUP_FOLDER_ID,
  BULK_BACKUP_FOLDER_ID,
  getDriveAccessToken
};
