/**
 * tests/test-security-audit-fixes.js
 * Verification test suite for 5 Medium-severity security audit fixes:
 * 1. CSP connect-src wildcard removal in server.js
 * 2. Token & board key localStorage migration to sessionStorage
 * 3. Sudo tier derivation from pageRights only & reserved admin usernames
 * 4. File streaming mime-type allow-list, attachment disposition, and sandbox CSP
 * 5. WebSocket maxPayload (64 KiB) and connection capping in board.socket.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running Security Audit Fixes Verification Tests ---');

// ── Test 1: CSP connect-src in server.js ──
console.log('1. Verifying CSP connect-src in server.js...');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert(!serverSrc.includes('"ws:"'), 'server.js must not contain bare wildcard "ws:" in CSP connect-src');
assert(!serverSrc.includes('"wss:"'), 'server.js must not contain bare wildcard "wss:" in CSP connect-src');
assert(serverSrc.includes('"ws://localhost:*"'), 'server.js should restrict local dev ws to localhost');
console.log('   ✓ CSP connect-src wildcard ws:/wss: successfully restricted.');

// ── Test 2: Token & board key storage in frontend ──
console.log('2. Verifying token & board key storage across frontend scripts...');
const loginPageSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'login.page.js'), 'utf8');
assert(!loginPageSrc.includes("localStorage.setItem('eams_board_key'"), 'login.page.js must never store plain text eams_board_key in localStorage');
assert(!loginPageSrc.includes("localStorage.setItem('eams_token'"), 'login.page.js must never store eams_token in localStorage');

const hodSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'shared', 'hod.js'), 'utf8');
assert(!hodSrc.includes("localStorage.getItem('eams_token')"), 'hod.js must not read eams_token from localStorage');

const workloadSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'shared', 'workload.shared.js'), 'utf8');
assert(!workloadSrc.includes("localStorage.getItem('eams_token')"), 'workload.shared.js must not read eams_token from localStorage');

const roomsSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'rooms.page.js'), 'utf8');
assert(!roomsSrc.includes("localStorage.getItem('eams_token')"), 'rooms.page.js must not read eams_token from localStorage');
console.log('   ✓ Token & plain board key scrubbed from localStorage across frontend.');

// ── Test 3: Sudo tier derivation & username reservations ──
console.log('3. Verifying sudo tier resolution and username reservations...');
const { resolveAccess } = require('../utils/resolveAccess');

// User named 'admin' with NO sudo pageRights should NOT receive sudo tier
const fakeAdminUser = {
  username: 'admin',
  trackId: 'TR-ADMIN001',
  role: 'teacher',
  isAdmin: false,
  specials: [],
  pageRights: []
};
const fakeRes = resolveAccess(fakeAdminUser);
assert.strictEqual(fakeRes.tier, 'none', 'User named admin without sudo pageRights must not receive sudo tier');
assert.strictEqual(fakeRes.flags.isSudo, false, 'User named admin without sudo pageRights must have isSudo=false');

// Legitimate admin user with pageRights.accessRole = 'sudoAdmin' and isAdmin special DOES receive sudo tier
const legitAdminUser = {
  username: 'admin',
  trackId: 'TR-ADMIN001',
  role: 'teacher',
  isAdmin: true,
  specials: [{ option: 'isAdmin', value: true }],
  pageRights: {
    accessRole: 'sudoAdmin',
    version: 1,
    grants: [{ page: '*', module: '*', accessRole: 'sudoAdmin', actions: ['*'], enabled: true }]
  }
};
const legitRes = resolveAccess(legitAdminUser);
assert.strictEqual(legitRes.tier, 'sudoAdmin', 'Legitimate admin with sudo pageRights must resolve to sudoAdmin tier');
assert.strictEqual(legitRes.flags.isSudo, true, 'Legitimate admin must have isSudo=true');

// Check reserved username lists in routes and scan.js
const teacherRoutesSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'teachers.routes.js'), 'utf8');
assert(teacherRoutesSrc.includes("'admin'") && teacherRoutesSrc.includes('RESERVED_USERNAMES'), 'teachers.routes.js must enforce RESERVED_USERNAMES including admin');

const usersRoutesSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'users.routes.js'), 'utf8');
assert(usersRoutesSrc.includes("'admin'") && usersRoutesSrc.includes('RESERVED_USERNAMES'), 'users.routes.js must enforce RESERVED_USERNAMES including admin');

const scanSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'bulk', 'scan.js'), 'utf8');
assert(scanSrc.includes('RESERVED_USERNAMES'), 'services/bulk/scan.js must enforce RESERVED_USERNAMES');
console.log('   ✓ Sudo tier derived from pageRights only, admin username reserved across routes.');

// ── Test 4: Files route security headers & mimeType allow-list ──
console.log('4. Verifying /api/files route sandbox CSP, attachment disposition & mimeType allow-list...');
const { SAFE_MIME_TYPES, sanitizeMimeType } = require('../utils/driveStore');

assert.strictEqual(sanitizeMimeType('text/html'), 'application/octet-stream', 'HTML mimeType must be sanitized to octet-stream');
assert.strictEqual(sanitizeMimeType('image/svg+xml'), 'application/octet-stream', 'SVG mimeType must be sanitized to octet-stream');
assert.strictEqual(sanitizeMimeType('application/javascript'), 'application/octet-stream', 'JS mimeType must be sanitized to octet-stream');
assert.strictEqual(sanitizeMimeType('application/pdf'), 'application/pdf', 'PDF mimeType must remain application/pdf');
assert.strictEqual(sanitizeMimeType('image/png'), 'image/png', 'PNG mimeType must remain image/png');

const filesRoutesSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'files.routes.js'), 'utf8');
assert(filesRoutesSrc.includes("res.setHeader('Content-Security-Policy', \"sandbox; default-src 'none'\")"), 'files.routes.js must set sandbox CSP');
assert(filesRoutesSrc.includes("res.setHeader('X-Content-Type-Options', 'nosniff')"), 'files.routes.js must set nosniff header');
assert(filesRoutesSrc.includes('Content-Disposition') && filesRoutesSrc.includes('attachment'), 'files.routes.js must set attachment Content-Disposition');
console.log('   ✓ File streaming sandbox CSP, attachment disposition, and mime-type allow-list verified.');

// ── Test 5: WebSocket maxPayload & connection capping in board.socket.js ──
console.log('5. Verifying board.socket.js maxPayload & connection capping...');
const boardSocketSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'board.socket.js'), 'utf8');
assert(boardSocketSrc.includes('maxPayload'), 'board.socket.js must configure maxPayload');
assert(boardSocketSrc.includes('64 * 1024') || boardSocketSrc.includes('65536'), 'board.socket.js must set maxPayload to 64 KiB');
assert(boardSocketSrc.includes('MAX_CONCURRENT_PER_IP'), 'board.socket.js must enforce concurrent connection limit per IP');
assert(boardSocketSrc.includes('checkDeviceRateLimit'), 'board.socket.js must enforce device connection attempt rate limiting');
console.log('   ✓ WebSocket maxPayload 64 KiB, IP connection ceiling, and device rate-limiting verified.');

console.log('\nAll 5 Security Audit Fixes verified and PASSED successfully!');
