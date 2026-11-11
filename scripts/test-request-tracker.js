'use strict';
/**
 * Plain-node checks for utils/requestTracker.js (no database, no framework).
 * Run: node scripts/test-request-tracker.js
 */
const assert = require('assert');
const { buildLeaveTracker, buildOdTracker } = require('../utils/requestTracker');

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const states = t => t.steps.map(s => s.key + ':' + s.state).join(' ');

console.log('Leave tracker');
check('pending -> applied done, advisor current', () => {
  const t = buildLeaveTracker({ status: 'Pending', advisorStatus: 'Pending', advisorName: 'Priya', createdAt: '2026-10-28T05:00:00Z' });
  assert.strictEqual(states(t), 'applied:done advisor:current');
  assert.strictEqual(t.outcome, 'in_progress');
  assert.strictEqual(t.headline, 'Waiting for Advisor');
});
check('approved via /student-leave fields', () => {
  const t = buildLeaveTracker({ status: 'Approved', advisorStatus: 'Approved', advisorName: 'Priya', advisorReviewedAt: '2026-10-28T08:00:00Z' });
  assert.strictEqual(states(t), 'applied:done advisor:done');
  assert.strictEqual(t.outcome, 'approved');
});
check('approved via legacy /leave/review (status only)', () => {
  const t = buildLeaveTracker({ status: 'Approved', advisorStatus: 'Pending', reviewedBy: 'Mrs Priya', reviewedAt: '2026-10-28T08:00:00Z', reviewRemarks: 'ok' });
  assert.strictEqual(states(t), 'applied:done advisor:done');
  assert.strictEqual(t.steps[1].actor, 'Mrs Priya');
});
check('rejected keeps the remark', () => {
  const t = buildLeaveTracker({ status: 'Rejected', advisorStatus: 'Rejected', advisorRemarks: 'Exam week' });
  assert.strictEqual(states(t), 'applied:done advisor:rejected');
  assert.strictEqual(t.steps[1].remark, 'Exam week');
  assert.strictEqual(t.headline, 'Rejected by Advisor');
});
check('returned for correction', () => {
  const t = buildLeaveTracker({ status: 'Returned', advisorStatus: 'Returned', advisorRemarks: 'Attach letter' });
  assert.strictEqual(t.outcome, 'returned');
});
check('cancelled while pending -> advisor skipped', () => {
  const t = buildLeaveTracker({ status: 'Cancelled', advisorStatus: 'Pending' });
  assert.strictEqual(states(t), 'applied:done advisor:skipped');
  assert.strictEqual(t.outcome, 'cancelled');
});
check('no HoD step for plain student leave', () => {
  const t = buildLeaveTracker({ status: 'Pending', hodStatus: 'N/A' });
  assert.ok(!t.steps.some(s => s.key === 'hod'));
});

console.log('OD tracker');
const od = extra => Object.assign({ status: 'pending', currentStage: 'advisor', approvalChain: [], advisorName: 'Priya', mentorName: 'Kumar', deptCode: 'CSE' }, extra);
check('waiting at advisor', () => {
  const t = buildOdTracker(od());
  assert.strictEqual(states(t), 'applied:done advisor:current mentor:upcoming hod:upcoming');
});
check('waiting at hod after advisor+mentor approved', () => {
  const t = buildOdTracker(od({ currentStage: 'hod', approvalChain: [
    { stage: 'advisor', status: 'approved', approverName: 'Priya', decidedAt: '2026-10-28T06:00:00Z' },
    { stage: 'mentor', status: 'approved', approverName: 'Kumar', decidedAt: '2026-10-28T07:00:00Z' }
  ] }));
  assert.strictEqual(states(t), 'applied:done advisor:done mentor:done hod:current');
  assert.strictEqual(t.headline, 'Waiting for HoD');
});
check('stage merge shows as done + auto', () => {
  const t = buildOdTracker(od({ currentStage: 'hod', approvalChain: [
    { stage: 'advisor', status: 'approved', approverName: 'Priya' },
    { stage: 'mentor', status: 'skipped_merged', approverName: 'Priya' }
  ] }));
  assert.strictEqual(t.steps[2].state, 'done');
  assert.strictEqual(t.steps[2].auto, true);
});
check('fully approved', () => {
  const t = buildOdTracker(od({ status: 'approved', currentStage: 'completed', approvalChain: [
    { stage: 'advisor', status: 'approved' }, { stage: 'mentor', status: 'approved' }, { stage: 'hod', status: 'approved' }
  ] }));
  assert.strictEqual(t.outcome, 'approved');
  assert.strictEqual(t.headline, 'Approved');
});
check('principal step appears only when requested', () => {
  assert.ok(!buildOdTracker(od()).steps.some(s => s.key === 'principal'));
  assert.ok(buildOdTracker(od({ requestPrincipal: true })).steps.some(s => s.key === 'principal'));
});
check('advisor rejection skips the remaining stages', () => {
  const t = buildOdTracker(od({ status: 'rejected', currentStage: 'rejected', approvalChain: [
    { stage: 'advisor', status: 'rejected', approverName: 'Priya', remarks: 'No proof' }
  ] }));
  assert.strictEqual(states(t), 'applied:done advisor:rejected mentor:skipped hod:skipped');
  assert.strictEqual(t.steps[1].remark, 'No proof');
});
check('hod rejection keeps earlier ticks', () => {
  const t = buildOdTracker(od({ status: 'rejected', currentStage: 'rejected', approvalChain: [
    { stage: 'advisor', status: 'approved' }, { stage: 'mentor', status: 'approved' },
    { stage: 'hod', status: 'rejected', remarks: 'Clash with exams' }
  ] }));
  assert.strictEqual(states(t), 'applied:done advisor:done mentor:done hod:rejected');
});
check('legacy rejected without chain marks first unfinished stage', () => {
  const t = buildOdTracker(od({ status: 'rejected', currentStage: 'rejected' }));
  assert.strictEqual(states(t), 'applied:done advisor:rejected mentor:skipped hod:skipped');
});
check('returned uses supplied correction note', () => {
  const t = buildOdTracker(od({ status: 'returned', currentStage: 'mentor', approvalChain: [{ stage: 'advisor', status: 'approved' }] }), { returnedRemark: 'Add invite letter' });
  assert.strictEqual(states(t), 'applied:done advisor:done mentor:returned hod:skipped');
  assert.strictEqual(t.steps[2].remark, 'Add invite letter');
});
check('cancelled leaves unfinished stages skipped', () => {
  const t = buildOdTracker(od({ status: 'cancelled' }));
  assert.strictEqual(states(t), 'applied:done advisor:skipped mentor:skipped hod:skipped');
});
check('completed legacy record without chain is all done', () => {
  const t = buildOdTracker(od({ status: 'completed', currentStage: 'completed' }));
  assert.strictEqual(t.outcome, 'approved');
});

console.log('\n' + passed + ' checks passed' + (process.exitCode ? ' (with failures)' : ''));
