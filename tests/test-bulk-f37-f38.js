/**
 * tests/test-bulk-f37-f38.js
 * Verification suite for F-37 (P7 legacy file cleanup & unmounting) and F-38 (Repo hygiene & test scripts).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

console.log('Running F-37 & F-38 Verification Suite...');

// 1. F-37: Legacy router unmounting
const bulkIndexPath = path.resolve(__dirname, '../routes/bulk/index.js');
const bulkIndexContent = fs.readFileSync(bulkIndexPath, 'utf8');
assert(
  !bulkIndexContent.includes("require('../bulkImport.routes')") &&
  !bulkIndexContent.includes('require("./bulkImport.routes")'),
  'routes/bulk/index.js must NOT mount legacy bulkImport.routes'
);
console.log('  [PASS] F-37: routes/bulk/index.js does not mount legacy router');

// 2. F-37: Legacy files deleted from public/
const deletedFiles = [
  'public/bulk-legacy.html',
  'public/js/pages/bulk-legacy.page.js',
  'public/js/pages/bulk.page.js'
];
for (const relPath of deletedFiles) {
  const absPath = path.resolve(__dirname, '..', relPath);
  assert(!fs.existsSync(absPath), `Legacy file must be removed: ${relPath}`);
}
console.log('  [PASS] F-37: All legacy bulk files (bulk-legacy.html, bulk-legacy.page.js, bulk.page.js) are deleted');

// 3. F-38: Package.json test and check:xss scripts exist and point to existing files
const pkgPath = path.resolve(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

assert(pkg.scripts && pkg.scripts.test, 'package.json must define a test script');
assert(pkg.scripts && pkg.scripts['check:xss'], 'package.json must define a check:xss script');

const testMatch = pkg.scripts.test.match(/^node\s+([^\s]+)/);
assert(testMatch, 'test script must run via node');
assert(fs.existsSync(path.resolve(__dirname, '..', testMatch[1])), `test script target must exist: ${testMatch[1]}`);

const xssMatch = pkg.scripts['check:xss'].match(/^node\s+([^\s]+)/);
assert(xssMatch, 'check:xss script must run via node');
assert(fs.existsSync(path.resolve(__dirname, '..', xssMatch[1])), `check:xss script target must exist: ${xssMatch[1]}`);
console.log('  [PASS] F-38: package.json has test and check:xss scripts pointing to valid existing files');

// 4. F-38: check:xss script runs successfully
const xssOutput = execFileSync(process.execPath, [path.resolve(__dirname, '../scripts/check-xss-patterns.js')], {
  encoding: 'utf8'
});
assert(xssOutput.includes('[PASS]'), 'check-xss-patterns.js must pass');
console.log('  [PASS] F-38: scripts/check-xss-patterns.js passes security scan');

console.log('All F-37 & F-38 tests passed successfully!');
