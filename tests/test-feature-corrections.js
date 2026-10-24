/**
 * tests/test-feature-corrections.js
 * Verification suite for the 6 Feature Corrections:
 * 1. Admin landing page
 * 2. Principal role as accessRole
 * 3. Attendance save date & class validation
 * 4. Student session length setting & documentation
 * 5. Duplicate endpoints and scripts deduplication
 * 6. Dependencies and scripts cleanup
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { landingFor, resolveAccess } = require('../utils/resolveAccess');
const { ALLOWED_ROLES, normalizePageRights, isPrincipalUser } = require('../utils/access');
const defaultSettings = require('../config/defaultSettings');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`    Error: ${err.message}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`    Error: ${err.message}`);
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('--- Feature Corrections Verification Suite ---');
  console.log('======================================================\n');

  // -------------------------------------------------------------------------
  // 1. Admin Landing Page
  // -------------------------------------------------------------------------
  console.log('1. Admin Landing Page:');
  runTest('SudoAdmin routes to admin.html', () => {
    assert.strictEqual(landingFor({ isSudo: true }), 'admin.html');
  });

  runTest('Principal routes to controller.html even if holding admin flag', () => {
    assert.strictEqual(landingFor({ isPrincipal: true, isAdmin: true }), 'controller.html');
    assert.strictEqual(landingFor({ isPrincipal: true }), 'controller.html');
  });

  runTest('HOD routes to controller.html even if holding admin flag', () => {
    assert.strictEqual(landingFor({ isHod: true, isAdmin: true, isSub: true }), 'controller.html');
    assert.strictEqual(landingFor({ isHod: true }), 'controller.html');
  });

  runTest('SuperAdmin / SubAdmin / Bootstrap route to selector.html', () => {
    assert.strictEqual(landingFor({ isSuper: true }), 'selector.html');
    assert.strictEqual(landingFor({ isSub: true }), 'selector.html');
    assert.strictEqual(landingFor({ bootstrap: true }), 'selector.html');
  });

  runTest('Standard teacher routes to teacher.html', () => {
    assert.strictEqual(landingFor({}), 'teacher.html');
  });

  // -------------------------------------------------------------------------
  // 2. Principal Role
  // -------------------------------------------------------------------------
  console.log('\n2. Principal Role:');
  runTest('ALLOWED_ROLES includes "principal"', () => {
    assert.ok(ALLOWED_ROLES.includes('principal'), 'principal must be in ALLOWED_ROLES');
  });

  runTest('normalizePageRights gives principal institution scope and clears deptId', () => {
    const grants = normalizePageRights([
      { page: 'controller', accessRole: 'principal', scope: 'own' }
    ]);
    assert.strictEqual(grants.length, 1);
    assert.strictEqual(grants[0].accessRole, 'principal');
    assert.strictEqual(grants[0].scope, 'institution');
    assert.strictEqual(grants[0].deptId, null);
  });

  runTest('isPrincipalUser recognizes accessRole: "principal" on document and pageRights', () => {
    assert.ok(isPrincipalUser({ accessRole: 'principal' }));
    assert.ok(isPrincipalUser({ pageRights: { accessRole: 'principal' } }));
    assert.ok(isPrincipalUser({ pageRights: [{ accessRole: 'principal', enabled: true, page: 'controller' }] }));
    assert.ok(isPrincipalUser({ specials: [{ option: 'isPrincipal', value: true }] }));
  });

  runTest('resolveAccess with principal grants provides controller with institution scope and controller.html landing', () => {
    const resolved = resolveAccess({
      role: 'teacher',
      pageRights: {
        accessRole: 'principal',
        grants: [{ page: 'controller', accessRole: 'principal', scope: 'institution', enabled: true }]
      }
    });
    assert.ok(resolved.flags.isPrincipal, 'flags.isPrincipal should be true');
    assert.strictEqual(resolved.landing, 'controller.html');
    assert.ok(resolved.hasInstitutionReach, 'should have institution reach');
    assert.ok(resolved.pages.controller, 'should have controller page access');
    assert.strictEqual(resolved.pages.controller.scope, 'institution');
  });

  // -------------------------------------------------------------------------
  // 3. Attendance Save (Date & Class Validation)
  // -------------------------------------------------------------------------
  console.log('\n3. Attendance Save:');
  runTest('routes/attendance.routes.js validates YYYY-MM-DD regex and calendar validity', () => {
    const code = fs.readFileSync(path.resolve('routes/attendance.routes.js'), 'utf8');
    assert.ok(code.includes('/^\\d{4}-\\d{2}-\\d{2}$/'), 'Strict date regex must be present');
    assert.ok(code.includes('Date must be a valid date in YYYY-MM-DD format'), 'Validation error message must be present');
    assert.ok(code.includes('Invalid calendar date'), 'Calendar date validation must be present');
  });

  runTest('routes/attendance.routes.js rejects future dates for non-sudo users', () => {
    const code = fs.readFileSync(path.resolve('routes/attendance.routes.js'), 'utf8');
    assert.ok(code.includes('diffDays < 0'), 'Negative diffDays check must exist');
    assert.ok(code.includes('futureDateBlocked: true'), 'futureDateBlocked flag must be returned');
  });

  runTest('routes/attendance.routes.js queries class by _id and classTrackId only, returning 404 when not found', () => {
    const code = fs.readFileSync(path.resolve('routes/attendance.routes.js'), 'utf8');
    assert.ok(code.includes('classQuery.push({ classTrackId: classIdInput });'), 'classTrackId query must be present');
    assert.ok(!code.includes('classQuery.push({ name: classIdInput });'), 'name lookup for class must NOT be present in attendance POST');
    assert.ok(code.includes('return res.status(404).json({ error: \'Class not found\' });'), '404 must be returned when class is missing');
  });

  // -------------------------------------------------------------------------
  // 4. Student Session Length Setting & Documentation
  // -------------------------------------------------------------------------
  console.log('\n4. Student Session Length Setting:');
  runTest('defaultSettings includes studentDeviceSessionLifetimeDays: 15 and maxSessionLifetimeHours: 24', () => {
    const sec = (defaultSettings.DEFAULT_SETTINGS_MAP || defaultSettings).security.value;
    assert.strictEqual(sec.studentDeviceSessionLifetimeDays, 15, 'Default student device session should be 15 days');
    assert.strictEqual(sec.maxSessionLifetimeHours, 24, 'Default max session should be 24 hours');
  });

  runTest('middleware/auth.js enforces studentDeviceSessionLifetimeDays setting', () => {
    const code = fs.readFileSync(path.resolve('middleware/auth.js'), 'utf8');
    assert.ok(code.includes('secSettings.studentDeviceSessionLifetimeDays'), 'Auth middleware must read studentDeviceSessionLifetimeDays');
    assert.ok(code.includes('studentDays * 24'), 'Student days must be multiplied by 24 for session hours');
  });

  runTest('CLAUDE.md documents the 15-day student trusted device session deviation', () => {
    const doc = fs.readFileSync(path.resolve('CLAUDE.md'), 'utf8');
    assert.ok(doc.includes('studentDeviceSessionLifetimeDays: 15'), 'CLAUDE.md must document studentDeviceSessionLifetimeDays');
    assert.ok(doc.includes('sessionClass: \'student-device\''), 'CLAUDE.md must reference student-device');
  });

  // -------------------------------------------------------------------------
  // 5. Duplicate Endpoints and Scripts
  // -------------------------------------------------------------------------
  console.log('\n5. Duplicate Endpoints and Scripts:');
  runTest('routes/index.js mounts /departments and redirects /depts with 308', () => {
    const code = fs.readFileSync(path.resolve('routes/index.js'), 'utf8');
    assert.ok(code.includes("router.use('/departments',      deptRoutes);"), 'Must mount /departments');
    assert.ok(code.includes("res.redirect(308, `/api/departments"), 'Must redirect /depts to /api/departments');
  });

  runTest('routes/index.js mounts /recycle-bin and redirects /undo with 308', () => {
    const code = fs.readFileSync(path.resolve('routes/index.js'), 'utf8');
    assert.ok(code.includes("router.use('/recycle-bin',      undoRoutes);"), 'Must mount /recycle-bin');
    assert.ok(code.includes("res.redirect(308, `/api/recycle-bin"), 'Must redirect /undo to /api/recycle-bin');
  });

  runTest('routes/profile.routes.js redirects PUT /users/:id to /api/users/:id with 307', () => {
    const code = fs.readFileSync(path.resolve('routes/profile.routes.js'), 'utf8');
    assert.ok(code.includes("res.redirect(307, `/api/users/${req.params.id}`)"), 'Must redirect profile/users/:id to /api/users/:id');
  });

  runTest('modal.js only exports modal functions and does NOT duplicate popup implementation', () => {
    const code = fs.readFileSync(path.resolve('public/js/core/modal.js'), 'utf8');
    assert.ok(code.includes('openModal'), 'Must have openModal');
    assert.ok(code.includes('closeModal'), 'Must have closeModal');
    assert.ok(!code.includes('function showPopup('), 'Must NOT duplicate showPopup');
    assert.ok(!code.includes('function showConfirm('), 'Must NOT duplicate showConfirm');
    assert.ok(!code.includes('function showPrompt('), 'Must NOT duplicate showPrompt');
  });

  runTest('popup.js remains the authoritative popup implementation', () => {
    const code = fs.readFileSync(path.resolve('public/js/core/popup.js'), 'utf8');
    assert.ok(code.includes('showPopup'), 'Must export showPopup');
    assert.ok(code.includes('showConfirm'), 'Must export showConfirm');
    assert.ok(code.includes('showPrompt'), 'Must export showPrompt');
  });

  // -------------------------------------------------------------------------
  // 6. Dependencies and Scripts
  // -------------------------------------------------------------------------
  console.log('\n6. Dependencies and Scripts:');
  runTest('package.json has removed redundant dependencies: @playwright/test, bcryptjs, mongodb', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    assert.strictEqual(pkg.dependencies['bcryptjs'], undefined, 'bcryptjs must be removed');
    assert.strictEqual(pkg.dependencies['mongodb'], undefined, 'mongodb must be removed');
    assert.ok(pkg.dependencies['@node-rs/bcrypt'], '@node-rs/bcrypt must be retained');
    assert.ok(pkg.dependencies['mongoose'], 'mongoose must be retained');
    if (pkg.devDependencies) {
      assert.strictEqual(pkg.devDependencies['@playwright/test'], undefined, '@playwright/test must be removed');
    }
  });

  runTest('All npm scripts in package.json point to valid existing files', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      const match = cmd.match(/^node\s+([^\s]+)/);
      if (match) {
        const filePath = match[1];
        assert.ok(fs.existsSync(filePath), `Script "${name}" points to non-existent file: ${filePath}`);
      }
    }
  });

  console.log('\n======================================================');
  console.log(`Results: ${passedTests}/${totalTests} tests passed (${Math.round((passedTests/totalTests)*100)}%)`);
  console.log('======================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
