/**
 * tests/index.js
 * Master test runner for EAMS.
 * Executes feature verification, bulk review suites, and security checks.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const SUITES = [
  'tests/test-feature-corrections.js',
  'tests/test-bulk-f31-f32.js',
  'tests/test-bulk-f33-f34.js',
  'tests/test-bulk-f35-f36.js',
  'tests/test-bulk-f37-f38.js',
  'tests/test-bulk-f39-f40.js',
  'tests/bulk-golden-test.js',
  'tests/bulk-p4-p5-test.js',
  'tests/test-bulk-p1.js',
  'tests/test-bulk-p2.js',
  'tests/test-bulk-p3.js',
  'tests/test-bulk-p4.js',
  'tests/test-bulk-p5.js',
  'tests/test-bulk-p6.js',
  'tests/test-bulk-p7.js',
  'tests/test-bulk-p8.js',
  'scripts/check-xss-patterns.js'
];

console.log('======================================================');
console.log('--- EAMS Master Test Runner ---');
console.log('======================================================');

let passed = 0;
let failed = 0;

for (const suite of SUITES) {
  const relPath = suite;
  const absPath = path.join(ROOT_DIR, suite);
  console.log(`\n[RUNNING] ${relPath}`);
  try {
    const stdout = execFileSync(process.execPath, [absPath], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (stdout.trim()) {
      console.log(stdout.trim());
    }
    console.log(`[PASS] ${relPath}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${relPath}`);
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.error(err.stderr);
    failed++;
  }
}

console.log('\n======================================================');
console.log(`Master Test Results: ${passed} passed, ${failed} failed (${SUITES.length} total)`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
