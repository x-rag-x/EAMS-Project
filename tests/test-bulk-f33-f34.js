/**
 * tests/test-bulk-f33-f34.js
 * Verification for F-33 (RBAC requirePage coverage) and F-34 (7 icon aliases)
 */

const assert = require('assert');
const express = require('express');

// Test F-34: Icon Aliases
console.log('Running F-34 Icon Aliases Test...');
require('../public/js/core/icons.js');
const missingIcons = ['activity', 'alert-octagon', 'check-circle-2', 'file-spreadsheet', 'hard-drive', 'log-out', 'upload-cloud'];
for (const ic of missingIcons) {
  const svg = global.getIconSvg(ic);
  assert(svg, `Expected SVG for ${ic}`);
  assert(!svg.includes('help-circle'), `Expected ${ic} to not fall back to help-circle`);
}
console.log('  [PASS] F-34: All 7 icon aliases resolve to concrete icons and avoid help-circle glyph');

// Test F-33: RBAC requirePage Coverage
console.log('Running F-33 requirePage Coverage Test...');
const batchesRoutes = require('../routes/bulk/batches.routes');
const reviewRoutes = require('../routes/bulk/review.routes');
const uploadRoutes = require('../routes/bulk/upload.routes');
const eventsRoutes = require('../routes/bulk/events.routes');
const metaRoutes = require('../routes/bulk/meta.routes');

function inspectRouterGuards(routerInstance) {
  const guardedRoutes = [];
  for (const layer of routerInstance.stack) {
    if (layer.route) {
      const path = layer.route.path;
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      const handlerNames = layer.route.stack.map(s => s.name || s.handle.name || 'anonymous');
      guardedRoutes.push({ path, methods, handlerNames });
    }
  }
  return guardedRoutes;
}

const batchesStack = inspectRouterGuards(batchesRoutes);
const reviewStack = inspectRouterGuards(reviewRoutes);
const uploadStack = inspectRouterGuards(uploadRoutes);
const eventsStack = inspectRouterGuards(eventsRoutes);

// Verify pageAccessGuard (requirePage) is present on each route
for (const r of batchesStack) {
  const hasGuard = r.handlerNames.includes('pageAccessGuard');
  assert(hasGuard, `Expected batches route ${r.methods} ${r.path} to have pageAccessGuard`);
}
console.log(`  [PASS] F-33: All ${batchesStack.length} batches routes enforce pageAccessGuard`);

for (const r of reviewStack) {
  const hasGuard = r.handlerNames.includes('pageAccessGuard');
  assert(hasGuard, `Expected review route ${r.methods} ${r.path} to have pageAccessGuard`);
}
console.log(`  [PASS] F-33: All ${reviewStack.length} review routes enforce pageAccessGuard`);

for (const r of uploadStack) {
  const hasGuard = r.handlerNames.includes('pageAccessGuard');
  assert(hasGuard, `Expected upload route ${r.methods} ${r.path} to have pageAccessGuard`);
}
console.log(`  [PASS] F-33: All ${uploadStack.length} upload routes enforce pageAccessGuard`);

for (const r of eventsStack) {
  const hasGuard = r.handlerNames.includes('pageAccessGuard');
  assert(hasGuard, `Expected events route ${r.methods} ${r.path} to have pageAccessGuard`);
}
console.log(`  [PASS] F-33: All ${eventsStack.length} events routes enforce pageAccessGuard`);

console.log('All F-33 & F-34 tests passed successfully!');
