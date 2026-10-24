const M = require('../models');
const { getTodayIST } = require('../middleware/scope');
const { getSettings } = require('../utils/settingsCache');
const { recordApprovalHistory } = require('../utils/approvalWorkflow');
const { todayIST: toIST } = require('../utils/institutionTime');

/**
 * Daily job to check completed OD events and manage outcome deadlines.
 */
async function runODCompletionJob() {
  const todayIST = getTodayIST();
  const settings = await getSettings(['od']);
  const odConfig = settings.od || {};
  const outcomeDueDays = Number(odConfig.outcomeDueDays) || 7;

  let transitionedToAwaiting = 0;
  let transitionedToOverdue = 0;

  // 1. Move approved requests whose event end date has passed into 'awaiting_outcome'
  const pastApprovedRequests = await M.ODRequest.find({
    status: 'approved',
    'eventDetails.endDate': { $lt: todayIST }
  });

  for (const od of pastApprovedRequests) {
    od.status = 'awaiting_outcome';
    const dueAt = new Date(Date.now() + outcomeDueDays * 24 * 60 * 60 * 1000);
    if (!od.outcome) od.outcome = {};
    od.outcome.dueAt = dueAt;
    await od.save();

    await recordApprovalHistory({
      requestId: od.requestId,
      requestType: 'od',
      actorId: 'system_job',
      actorName: 'OD Completion Engine',
      actorRole: 'system',
      action: 'event_ended_awaiting_outcome',
      comment: `Event ended on ${od.eventDetails.endDate}. Outcome and evidence due by ${toIST(dueAt)}.`,
      previousState: 'approved',
      newState: 'awaiting_outcome'
    });

    transitionedToAwaiting++;
  }

  // 2. Mark overdue outcomes
  const now = new Date();
  const overdueRequests = await M.ODRequest.find({
    status: 'awaiting_outcome',
    'outcome.dueAt': { $lt: now },
    'outcome.primaryOutcome': null
  });

  for (const od of overdueRequests) {
    od.status = 'evidence_overdue';
    await od.save();

    await recordApprovalHistory({
      requestId: od.requestId,
      requestType: 'od',
      actorId: 'system_job',
      actorName: 'OD Completion Engine',
      actorRole: 'system',
      action: 'outcome_evidence_overdue',
      comment: `Evidence submission is overdue (past deadline ${od.outcome?.dueAt?.toISOString()?.slice(0, 10)}). Class Advisor notified.`,
      previousState: 'awaiting_outcome',
      newState: 'evidence_overdue'
    });

    transitionedToOverdue++;
  }

  return {
    todayIST,
    transitionedToAwaiting,
    transitionedToOverdue
  };
}

module.exports = {
  runODCompletionJob
};
