'use strict';

/**
 * Request Tracker — derives a read-only progress tracker for a student's
 * Leave or OD request from fields that already exist on the documents.
 *
 * Nothing here changes the approval workflow. It only describes it.
 *
 * Output contract (JSON-safe, attached to API responses as `tracker`):
 * {
 *   kind:     'leave' | 'od',
 *   outcome:  'in_progress' | 'approved' | 'rejected' | 'returned' | 'cancelled',
 *   headline: 'Waiting for HoD' | 'Approved' | 'Rejected by Mentor' | ...,
 *   steps: [{
 *     key:    'applied' | 'mentor' | 'advisor' | 'hod' | 'principal',
 *     label:  'Applied' | 'Mentor' | 'Advisor' | 'HoD' | 'Principal',
 *     state:  'done' | 'current' | 'rejected' | 'returned' | 'skipped' | 'upcoming',
 *     actor:  string,        // who acted, or who the request is waiting on
 *     at:     ISO string | null,
 *     remark: string,        // reviewer remark (rejection / return reason)
 *     auto:   boolean        // true when a stage was auto-approved (same approver)
 *   }]
 * }
 */

const LABELS = {
  applied: 'Applied',
  mentor: 'Mentor',
  advisor: 'Advisor',
  hod: 'HoD',
  principal: 'Principal'
};

const LEAVE_DECISIONS = { Approved: 'done', Rejected: 'rejected', Returned: 'returned' };
const OD_FINISHED = ['approved', 'awaiting_outcome', 'evidence_overdue', 'completed'];

function iso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function makeStep(key, state, extra) {
  const s = Object.assign({
    key,
    label: LABELS[key] || key,
    state,
    actor: '',
    at: null,
    remark: '',
    auto: false
  }, extra || {});
  s.timestamp = s.at || s.timestamp || null;
  s.remarks = s.remark || s.remarks || '';
  return s;
}

/**
 * Normalises the step list so the states always read as one coherent journey:
 *  - nothing after a rejected/returned step is still "in play" (becomes skipped)
 *  - only the first unfinished step is "current"; later ones are "upcoming"
 *  - a cancelled request leaves unfinished steps skipped
 */
function settle(steps, opts) {
  const o = opts || {};
  const out = steps.map(s => Object.assign({}, s));

  // Fallbacks for older records that carry a terminal status but no per-stage evidence.
  if (o.rejectedFallback && !out.some(s => s.state === 'rejected')) {
    const first = out.find(s => s.key !== 'applied' && s.state !== 'done');
    if (first) first.state = 'rejected';
  }
  if (o.returnedFallback && !out.some(s => s.state === 'returned')) {
    const first = out.find(s => s.key !== 'applied' && s.state !== 'done');
    if (first) first.state = 'returned';
  }

  let halted = false;
  let currentSeen = false;
  for (const s of out) {
    if (halted) {
      if (s.state !== 'done') s.state = 'skipped';
      continue;
    }
    if (s.state === 'rejected' || s.state === 'returned') {
      halted = true;
      continue;
    }
    if (s.state === 'done') continue;
    if (o.cancelled) {
      s.state = 'skipped';
      continue;
    }
    if (!currentSeen && (s.state === 'current' || s.state === 'upcoming')) {
      s.state = 'current';
      currentSeen = true;
    } else {
      s.state = 'upcoming';
    }
  }
  return out;
}

function summarise(kind, steps, cancelled) {
  const rejected = steps.find(s => s.state === 'rejected');
  const returned = steps.find(s => s.state === 'returned');
  const current = steps.find(s => s.state === 'current');
  let outcome = 'in_progress';
  let headline = current ? 'Waiting for ' + current.label : 'In progress';

  if (cancelled) {
    outcome = 'cancelled';
    headline = 'Cancelled';
  } else if (rejected) {
    outcome = 'rejected';
    headline = 'Rejected by ' + rejected.label;
  } else if (returned) {
    outcome = 'returned';
    headline = 'Returned by ' + returned.label + ' for correction';
  } else if (!current && steps.every(s => s.state === 'done')) {
    outcome = 'approved';
    headline = 'Approved';
  }
  return { kind, outcome, headline, steps, nodes: steps };
}

/**
 * Student leave: Applied -> Advisor (an HoD step appears only if the record
 * actually carries an HoD decision state).
 * Supports both write paths in the codebase:
 *   - /api/student-leave/*  sets advisorStatus / advisorRemarks / advisorReviewedAt
 *   - /api/leave/review/:id sets only status / reviewedBy / reviewedAt / reviewRemarks
 */
function buildLeaveTracker(leave) {
  const r = leave || {};
  const cancelled = /^cancelled$/i.test(String(r.status || ''));
  const steps = [];

  steps.push(makeStep('applied', 'done', {
    actor: r.studentName || '',
    at: iso(r.createdAt)
  }));

  let decision = LEAVE_DECISIONS[r.advisorStatus] || null;
  let at = iso(r.advisorReviewedAt);
  let actor = r.advisorName || '';
  let remark = r.advisorRemarks || '';

  if (!decision && LEAVE_DECISIONS[r.status]) {
    decision = LEAVE_DECISIONS[r.status];
    at = iso(r.reviewedAt);
    actor = r.reviewedBy || actor;
    remark = r.reviewRemarks || '';
  }

  steps.push(makeStep('advisor', decision || 'current', {
    actor: decision ? (r.reviewedBy || actor) : actor,
    at,
    remark: decision ? remark : ''
  }));

  const hodState = { Pending: 'upcoming', Approved: 'done', Rejected: 'rejected' }[r.hodStatus];
  if (hodState) {
    steps.push(makeStep('hod', hodState, {
      actor: r.hodReviewedBy || '',
      at: iso(r.hodReviewedAt),
      remark: r.hodRemarks || ''
    }));
  }

  return summarise('leave', settle(steps, { cancelled }), cancelled);
}

/**
 * OD: Applied -> Mentor -> Advisor -> HoD.
 * Mirrors utils/approvalWorkflow.js WORKFLOW_STAGES.od, including the stage-merge
 * rule (a stage with the same approver is auto-approved and recorded as
 * `skipped_merged` in approvalChain).
 *
 * @param {Object} od
 * @param {{ returnedRemark?: string }} [opts]
 */
function buildOdTracker(od, opts) {
  const r = od || {};
  const o = opts || {};
  const chain = Array.isArray(r.approvalChain) ? r.approvalChain : [];
  const status = String(r.status || '').toLowerCase();
  const cancelled = status === 'cancelled';
  const finished = OD_FINISHED.includes(status) || r.currentStage === 'completed';

  const stages = ['mentor', 'advisor', 'hod'];
  if (r.requestPrincipal || r.currentStage === 'principal' || chain.some(c => c && c.stage === 'principal')) {
    stages.push('principal');
  }

  const nominal = {
    mentor: r.mentorName || '',
    advisor: r.advisorName || '',
    hod: r.deptCode ? 'HoD, ' + r.deptCode : '',
    principal: ''
  };

  const lastEntry = key => {
    for (let i = chain.length - 1; i >= 0; i--) {
      if (chain[i] && chain[i].stage === key) return chain[i];
    }
    return null;
  };

  const steps = [makeStep('applied', 'done', {
    actor: r.studentName || '',
    at: iso(r.createdAt)
  })];

  for (const key of stages) {
    const entry = lastEntry(key);
    let state = 'upcoming';
    const extra = { actor: nominal[key] };

    if (entry) {
      extra.actor = entry.approverName || nominal[key];
      extra.at = iso(entry.decidedAt);
      if (entry.status === 'approved') {
        state = 'done';
        extra.remark = entry.remarks || '';
      } else if (entry.status === 'skipped_merged') {
        state = 'done';
        extra.auto = true;
      } else if (entry.status === 'rejected') {
        state = 'rejected';
        extra.remark = entry.remarks || '';
      } else if (entry.status === 'returned') {
        state = 'returned';
        extra.remark = entry.remarks || '';
      }
    } else if (finished) {
      state = 'done';
    } else if (status === 'returned' && r.currentStage === key) {
      state = 'returned';
      extra.remark = o.returnedRemark || '';
    } else if (status === 'pending' && r.currentStage === key) {
      state = 'current';
    }
    steps.push(makeStep(key, state, extra));
  }

  const settled = settle(steps, {
    cancelled,
    rejectedFallback: status === 'rejected',
    returnedFallback: status === 'returned'
  });
  if (status === 'returned' && o.returnedRemark) {
    const ret = settled.find(s => s.state === 'returned' && !s.remark);
    if (ret) ret.remark = o.returnedRemark;
  }
  return summarise('od', settled, cancelled);
}

/** Adds `tracker` to each leave request. Pure; does not touch the database. */
function attachLeaveTrackers(list) {
  return (Array.isArray(list) ? list : []).map(r => Object.assign({}, r, { tracker: buildLeaveTracker(r) }));
}

/**
 * Adds `tracker` to each OD request. Returned ODs need one extra query because the
 * correction note lives in ApprovalHistory, not on the request itself.
 */
async function attachOdTrackers(list) {
  const items = Array.isArray(list) ? list : [];
  const returnedIds = items
    .filter(r => r && String(r.status || '').toLowerCase() === 'returned' && (r.requestId || r.trackId))
    .map(r => r.requestId || r.trackId);

  const remarkById = {};
  if (returnedIds.length) {
    try {
      const M = require('../models');
      const rows = await M.ApprovalHistory.find({
        requestId: { $in: returnedIds },
        requestType: 'od',
        action: 'returned'
      }).sort({ at: 1 }).lean();
      for (const row of rows) remarkById[row.requestId] = row.comment || '';
    } catch (err) {
      console.warn('[requestTracker] could not load return remarks:', err.message);
    }
  }

  return items.map(r => Object.assign({}, r, {
    tracker: buildOdTracker(r, { returnedRemark: remarkById[r.requestId || r.trackId] || '' })
  }));
}

module.exports = {
  buildLeaveTracker,
  buildOdTracker,
  buildODTracker: buildOdTracker,
  attachLeaveTrackers,
  attachOdTrackers
};
