/**
 * Verification test for Bug Fixes: Crashes from names that do not exist
 *
 * Checks:
 * 1. utils/reconcileAttendance exports reconcilePeriodOverride and routes/studentLeave.routes loads cleanly.
 * 2. utils/hostelCrossCheck.js & utils/participationScore.js no longer reference non-existent M.Attendance.
 * 3. public/js/pages/controller.page.js declares _liveDateOverride and getTodayStr.
 * 4. public/js/pages/control.page.js defines showExpiryDialog, startExpiryPolling, and ugApplyFilters.
 * 5. public/js/pages/rooms.page.js defines loadInitialData.
 * 6. scripts/start.js defines branch in student creation and avoids yr redeclaration.
 * 7. package.json scripts point to existing files in scripts/ rather than dev/ or .antigravity/.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Testing bug fixes for non-existent / undefined symbols...\n');

// 1. reconcilePeriodOverride
const reconcileAtt = require('../utils/reconcileAttendance');
assert.strictEqual(typeof reconcileAtt.reconcilePeriodOverride, 'function', 'reconcilePeriodOverride must be exported as a function');
const studentLeaveRoutes = require('../routes/studentLeave.routes');
assert.ok(studentLeaveRoutes, 'studentLeave.routes must load cleanly with reconcilePeriodOverride');
console.log('✓ 1. reconcilePeriodOverride exported and imported by studentLeave.routes OK');

// 2. M.Attendance removed from hostelCrossCheck and participationScore
const hostelCrossCheckSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'hostelCrossCheck.js'), 'utf8');
assert.ok(!hostelCrossCheckSrc.includes('M.Attendance.'), 'hostelCrossCheck.js must not reference M.Attendance');
assert.ok(hostelCrossCheckSrc.includes('M.ClassAttendance.find'), 'hostelCrossCheck.js must query M.ClassAttendance');

const participationScoreSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'participationScore.js'), 'utf8');
assert.ok(!participationScoreSrc.includes('M.Attendance.'), 'participationScore.js must not reference M.Attendance');
assert.ok(participationScoreSrc.includes('M.StudentAttendance.findOne') && participationScoreSrc.includes('M.ClassAttendance.find'), 'participationScore.js must query M.StudentAttendance / M.ClassAttendance');

const hostelCrossCheck = require('../utils/hostelCrossCheck');
const participationScore = require('../utils/participationScore');
assert.strictEqual(typeof hostelCrossCheck.runHostelCrossChecks, 'function');
assert.strictEqual(typeof participationScore.calculateParticipationRecord, 'function');
console.log('✓ 2. M.Attendance removed and replaced with ClassAttendance/StudentAttendance OK');

// 3. controller.page.js: _liveDateOverride and getTodayStr
const controllerPageSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'controller.page.js'), 'utf8');
assert.ok(controllerPageSrc.includes('var _liveDateOverride = null;') || controllerPageSrc.includes('let _liveDateOverride = null;'), 'controller.page.js must declare _liveDateOverride');
assert.ok(controllerPageSrc.includes('function getTodayStr()'), 'controller.page.js must define getTodayStr()');
console.log('✓ 3. controller.page.js declares _liveDateOverride and defines getTodayStr OK');

// 4. control.page.js: showExpiryDialog, startExpiryPolling, ugApplyFilters
const controlPageSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'control.page.js'), 'utf8');
assert.ok(controlPageSrc.includes('function showExpiryDialog()'), 'control.page.js must define showExpiryDialog()');
assert.ok(controlPageSrc.includes('function startExpiryPolling()'), 'control.page.js must define startExpiryPolling()');
assert.ok(controlPageSrc.includes('function ugApplyFilters()'), 'control.page.js must define ugApplyFilters()');
console.log('✓ 4. control.page.js defines showExpiryDialog, startExpiryPolling, and ugApplyFilters OK');

// 5. rooms.page.js: loadInitialData
const roomsPageSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'rooms.page.js'), 'utf8');
assert.ok(roomsPageSrc.includes('function loadInitialData()') || roomsPageSrc.includes('loadInitialData = loadAllData'), 'rooms.page.js must define loadInitialData');
console.log('✓ 5. rooms.page.js defines loadInitialData OK');

// 6. scripts/start.js: branch defined and yr not redeclared
const startJsSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'start.js'), 'utf8');
assert.ok(startJsSrc.includes('const branch') || startJsSrc.includes('let branch') || startJsSrc.includes('var branch'), 'scripts/start.js must declare branch before student create');
// Check that within the same scope in manageMenu, yr is not declared with duplicate var in same function
const manageMenuBlock = startJsSrc.substring(startJsSrc.indexOf('async function manageMenu()'), startJsSrc.indexOf('async function pickYear'));
const varYrMatches = manageMenuBlock.match(/var\s+yr\b/g);
assert.ok(!varYrMatches || varYrMatches.length <= 1, 'manageMenu must not have duplicate var yr declarations in the same function');
console.log('✓ 6. scripts/start.js branch defined and yr redeclaration resolved OK');

// 7. package.json scripts
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
assert.strictEqual(pkg.scripts.setup, 'node scripts/start.js', 'package.json setup must point to scripts/start.js');
assert.strictEqual(pkg.scripts.att, undefined, 'package.json must not point to missing dev/attendanceDev.js');
assert.strictEqual(pkg.scripts.memory, 'node scripts/memory.js', 'package.json memory must point to scripts/memory.js');
assert.strictEqual(pkg.scripts['track:chat'], 'node scripts/track_chat.js', 'package.json track:chat must point to scripts/track_chat.js');
assert.ok(fs.existsSync(path.join(__dirname, '..', 'scripts', 'start.js')), 'scripts/start.js must exist on disk');
assert.ok(fs.existsSync(path.join(__dirname, '..', 'scripts', 'memory.js')), 'scripts/memory.js must exist on disk');
assert.ok(fs.existsSync(path.join(__dirname, '..', 'scripts', 'track_chat.js')), 'scripts/track_chat.js must exist on disk');
console.log('✓ 7. package.json scripts point to existing files in scripts/ OK');

console.log('\nAll 7 bug fix verifications PASSED successfully!');
