/**
 * utils/urlValidation.js
 * Validates external evidence and certificate URLs.
 * Invariant S5: Accept only https: URLs on drive.google.com and docs.google.com,
 * or registered driveFileIds. Rejects javascript:, data:, http:, and third-party hosts.
 */

function isValidDriveUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return false;
  const trimmed = urlString.trim();
  // Reject javascript:, data:, vbscript:, etc.
  if (/^(?:javascript|data|vbscript):/i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    return hostname === 'drive.google.com' ||
           hostname === 'docs.google.com' ||
           hostname.endsWith('.drive.google.com') ||
           hostname.endsWith('.docs.google.com');
  } catch (e) {
    return false;
  }
}

function isValidDriveFileId(fileId) {
  if (!fileId || typeof fileId !== 'string') return false;
  const trimmed = fileId.trim();
  // Standard Google Drive file ID format: 10-100 alphanumeric and -_ characters
  return /^[a-zA-Z0-9_-]{10,100}$/.test(trimmed);
}

module.exports = {
  isValidDriveUrl,
  isValidDriveFileId,
};
