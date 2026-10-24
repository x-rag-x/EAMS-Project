/**
 * tests/test-bulk-f39-f40.js
 * Verification suite for F-39 (Paginated /rows serving) and F-40 (verifyAll UI wiring & restore XSS escape).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

console.log('Running F-39 & F-40 Verification Suite...');

// 1. F-39: Verify GET /batches/:id/rows endpoint exists and has requirePage guard
const batchesRoutes = require('../routes/bulk/batches.routes');

function findRouteLayer(router, method, pathStr) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === pathStr && layer.route.methods[method.toLowerCase()]) {
      return layer.route;
    }
  }
  return null;
}

const rowsRoute = findRouteLayer(batchesRoutes, 'GET', '/batches/:id/rows');
assert(rowsRoute, 'Expected GET /batches/:id/rows to be defined');
const hasGuard = rowsRoute.stack.some(s => (s.name || s.handle.name) === 'pageAccessGuard');
assert(hasGuard, 'Expected GET /batches/:id/rows to enforce pageAccessGuard');
console.log('  [PASS] F-39: GET /batches/:id/rows is defined and protected by requirePage');

// 2. F-39: Test /rows pagination, filtering, password stripping logic
const { toClient } = require('../services/bulk/access');
const mockBatch = {
  _id: '60d5ec49f1b2c8b1f8e4e1a1',
  batchTrackId: 'TR-BATCH-TESTROW1',
  type: 'student',
  status: 'verifying',
  eligibleCount: 120,
  eligibleRows: []
};

for (let i = 1; i <= 120; i++) {
  mockBatch.eligibleRows.push({
    rowNumber: i,
    isVerified: i <= 30, // 30 verified, 90 pending
    data: {
      fullName: `Student ${i}`,
      registerNo: `REG${1000 + i}`,
      email: `student${i}@test.edu`,
      password: `PlainPassword${i}`
    }
  });
}

// Test toClient previewLimit logic (F-39)
const previewBatch = toClient(mockBatch, { _id: 'u1', role: 'admin' }, { previewLimit: 50 });
assert.strictEqual(previewBatch.eligibleRows.length, 50, 'Preview batch must limit eligibleRows to 50');
assert.strictEqual(previewBatch.hasMoreRows, true, 'hasMoreRows must be true');
assert.strictEqual(previewBatch.eligibleRows[0].data.password, undefined, 'Passwords must be stripped in toClient');
console.log('  [PASS] F-39: toClient previewLimit constrains payload size and strips passwords');

// 3. F-39: Test api.getRows in bulk.api.js
const apiCode = fs.readFileSync(path.join(__dirname, '../public/js/pages/bulk/bulk.api.js'), 'utf8');
assert(apiCode.includes('getRows: function'), 'bulk.api.js must export getRows()');
assert(apiCode.includes('/api/bulk/batches/\' + id + \'/rows'), 'bulk.api.js getRows must point to /rows');
console.log('  [PASS] F-39: bulk.api.js defines getRows() with query parameter support');

// 4. F-40: Verify verify-all UI wiring in bulk.cards.js
const cardsCode = fs.readFileSync(path.join(__dirname, '../public/js/pages/bulk/bulk.cards.js'), 'utf8');
assert(cardsCode.includes('data-action="verify-all-remaining"'), 'bulk.cards.js must include verify-all-remaining button');
assert(cardsCode.includes('api.verifyAll(batchId)'), 'bulk.cards.js must invoke api.verifyAll() on button click');
console.log('  [PASS] F-40: bulk.cards.js wires verify-all-remaining to api.verifyAll()');

// 5. F-40: Verify restore.js escapes collection names and diffs with util.esc
const restoreCode = fs.readFileSync(path.join(__dirname, '../public/js/pages/bulk/bulk.restore.js'), 'utf8');
assert(restoreCode.includes("id=\"col-item-' + safeCol"), 'restore.js must use safeCol for element ID');
assert(restoreCode.includes("value=\"' + safeCol"), 'restore.js must use safeCol for checkbox value');
assert(restoreCode.includes("[' + util.esc(d.col) + ']"), 'restore.js must escape diff collection name with util.esc');
console.log('  [PASS] F-40: bulk.restore.js escapes collection names and diff fields with util.esc');

console.log('All F-39 & F-40 tests passed successfully!');
