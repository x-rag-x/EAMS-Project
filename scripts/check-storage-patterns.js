'use strict';

/**
 * scripts/check-storage-patterns.js
 * Scans timetable frontend code for localStorage and sessionStorage references.
 * Implements the Phase 0 Ratchet Check (Z7):
 *   - Legacy baseline allows at most 14 existing references across known keys:
 *       - 'tt_freeze_panes'
 *       - 'eams_tt_workspace'
 *       - 'eams_user' / 'user' / 'token' profile & session bootstrap
 *   - Fails if:
 *       1. Total count rises above baseline
 *       2. Any unauthorized/unknown storage key is introduced
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_FILES = [
  'public/js/pages/timetable.page.js',
  'public/js/core/tabWorkspace.js'
];

const ALLOWED_KEYS = [
  'tt_freeze_panes',
  'eams_tt_workspace',
  'eams_user',
  'user',
  'token',
  'eams_token'
];

const MAX_BASELINE_COUNT = 14;

function runStorageRatchet() {
  console.log('======================================================');
  console.log('--- Timetable Phase 0: Storage Guard Ratchet Check ---');
  console.log('======================================================\n');

  let totalReferences = 0;
  const violations = [];
  const foundReferences = [];

  for (const relPath of TARGET_FILES) {
    const fullPath = path.join(ROOT, relPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`File not found: ${relPath}`);
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      if (line.includes('localStorage') || line.includes('sessionStorage')) {
        totalReferences++;
        foundReferences.push({ file: relPath, line: lineNum, text: line.trim() });

        // Check if referencing an unknown key
        const keyMatch = line.match(/(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*['"`]([^'"`]+)['"`]/);
        if (keyMatch) {
          const key = keyMatch[1];
          if (!ALLOWED_KEYS.includes(key)) {
            violations.push({
              file: relPath,
              line: lineNum,
              reason: `Unauthorized new storage key: "${key}". All new state must use WorkspaceUserState in DB.`
            });
          }
        }
      }
    });
  }

  console.log(`Found ${totalReferences} existing storage references (Baseline allowance: ${MAX_BASELINE_COUNT}):`);
  foundReferences.forEach(ref => {
    console.log(`  ${ref.file}:${ref.line} -> ${ref.text}`);
  });

  if (totalReferences > MAX_BASELINE_COUNT) {
    violations.push({
      reason: `Storage reference count ratcheted up! Expected <= ${MAX_BASELINE_COUNT}, got ${totalReferences}.`
    });
  }

  if (violations.length > 0) {
    console.error('\n[FAIL] Storage Guard Ratchet Violations:');
    violations.forEach(v => {
      console.error(`  - ${v.file ? `${v.file}:${v.line} ` : ''}${v.reason}`);
    });
    process.exit(1);
  }

  console.log('\n[PASS] Storage Guard Ratchet: No new storage keys or count increases detected.');
  console.log('======================================================\n');
}

if (require.main === module) {
  runStorageRatchet();
}

module.exports = { runStorageRatchet };
