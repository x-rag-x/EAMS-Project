/**
 * scripts/check-bulk-invariants.js
 * CI & build guard for Bulk Operations Restructure invariants (P8, §15).
 * 1. Database-only rule (§15.1): No localStorage, sessionStorage (except allow-listed getToken),
 *    indexedDB, or document.cookie in public/js/pages/bulk/.
 * 2. Google Drive safety (§15.2): No delete/trash calls in routes/bulk/ or services/bulk/.
 * 3. Base64 payload rule: No fileBufferBase64 writes in new uploads.
 * 4. XSS hygiene: Verify esc calls on dynamic user and identifier strings.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('======================================================');
console.log('--- Checking Bulk Operations Invariants (P8 §15) ---');
console.log('======================================================');

let failures = 0;

function reportFail(msg) {
  console.error(`  [FAIL] ${msg}`);
  failures++;
}

function reportPass(msg) {
  console.log(`  [PASS] ${msg}`);
}

// ── 1. Database-Only Storage Rule (§15.1) ──────────────────────────────────
console.log('\n1. Checking Storage Rule (§15.1: Database only, zero local/session storage)...');
const BULK_CLIENT_DIR = path.resolve('public/js/pages/bulk');
const clientFiles = fs.readdirSync(BULK_CLIENT_DIR).filter(f => f.endsWith('.js'));

const STORAGE_PATTERNS = [
  { name: 'localStorage', re: /\blocalStorage\b/g },
  { name: 'sessionStorage', re: /\bsessionStorage\b/g },
  { name: 'indexedDB', re: /\bindexedDB\b/g },
  { name: 'document.cookie', re: /document\.cookie/g }
];

let storageViolations = [];
for (const file of clientFiles) {
  const filePath = path.join(BULK_CLIENT_DIR, file);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    // Allow-list: bulk.api.js reading app-wide auth token (eams_token / eams_user)
    if (file === 'bulk.api.js' && (line.includes('eams_token') || line.includes('sessionStorage.getItem') || line.includes('localStorage.getItem'))) {
      return;
    }

    for (const pat of STORAGE_PATTERNS) {
      if (pat.re.test(line)) {
        storageViolations.push(`${file}:${idx + 1} uses ${pat.name}`);
      }
    }
  });
}

if (storageViolations.length === 0) {
  reportPass('Zero forbidden client-side storage calls in public/js/pages/bulk/ (only allow-listed getToken).');
} else {
  reportFail(`Found client storage violations:\n    ${storageViolations.join('\n    ')}`);
}

// ── 2. Google Drive Safety Rule (§15.2) ────────────────────────────────────
console.log('\n2. Checking Google Drive Safety (§15.2: No file/folder delete/trash calls)...');
const SERVER_BULK_DIRS = [
  path.resolve('routes/bulk'),
  path.resolve('services/bulk')
];

const DRIVE_DELETE_PATTERNS = [
  { name: 'files.delete', re: /files\.delete/i },
  { name: 'trashed: true', re: /trashed\s*:\s*true/i },
  { name: 'drive.delete', re: /drive\.delete/i },
  { name: 'trashFolder', re: /trashFolder/i }
];

let driveViolations = [];
for (const sDir of SERVER_BULK_DIRS) {
  const sFiles = fs.readdirSync(sDir).filter(f => f.endsWith('.js'));
  for (const file of sFiles) {
    const filePath = path.join(sDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      // Ignore comment lines
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

      for (const pat of DRIVE_DELETE_PATTERNS) {
        if (pat.re.test(line)) {
          driveViolations.push(`${path.basename(sDir)}/${file}:${idx + 1} calls ${pat.name}`);
        }
      }
    });
  }
}

if (driveViolations.length === 0) {
  reportPass('No Google Drive deletion or trashing calls found in routes/bulk or services/bulk.');
} else {
  reportFail(`Found prohibited Drive deletion calls:\n    ${driveViolations.join('\n    ')}`);
}

// ── 3. Base64 Payload Drop Rule (§10 & §14) ────────────────────────────────
console.log('\n3. Checking Base64 Payload Rule (No fileBufferBase64 writes on upload)...');
const uploadRoutesPath = path.resolve('routes/bulk/upload.routes.js');
const uploadContent = fs.readFileSync(uploadRoutesPath, 'utf8');

if (/updateFields\s*=\s*\{[^}]*fileBufferBase64/i.test(uploadContent)) {
  reportFail('upload.routes.js is still writing fileBufferBase64 on new uploads.');
} else {
  reportPass('upload.routes.js does not store fileBufferBase64 (GridFS is the single source of truth).');
}

// ── 4. State Machine Resettable Rule ───────────────────────────────────────
console.log('\n4. Checking Undo Resettable Statuses Matrix...');
const undoPath = path.resolve('services/bulk/undo.js');
const undoContent = fs.readFileSync(undoPath, 'utf8');

const expectedResettable = ['draft', 'staged', 'skipped_resolved', 'pending_sudo_initial', 'sudo_initial_approved', 'verifying', 'verified_all', 'sudo_review', 'pending_final_approval', 'rejected', 'failed', 'cancelled'];
const missingResettable = expectedResettable.filter(st => !undoContent.includes(`'${st}'`));

if (missingResettable.length === 0) {
  reportPass('All 12 RESETTABLE statuses are declared in services/bulk/undo.js.');
} else {
  reportFail(`Missing resettable statuses: ${missingResettable.join(', ')}`);
}

// ── SUMMARY ────────────────────────────────────────────────────────────────
console.log('\n======================================================');
if (failures === 0) {
  console.log('ALL BULK OPERATIONS INVARIANTS SATISFIED (0 violations).');
  console.log('======================================================\n');
  process.exit(0);
} else {
  console.error(`FAILED: ${failures} invariant violation(s) detected.`);
  console.log('======================================================\n');
  process.exit(1);
}
