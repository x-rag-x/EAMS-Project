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
  const outcomeReminderDay = Number(odConfig.outcomeReminderDay) || 5;

  let transitionedToAwaiting = 0;
  let transitionedToOverdue = 0;
  let remindersSent = 0;

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

  // 2. Send reminders for outcome evidence approaching deadline (§8, B3)
  const now = new Date();
  const awaitingRequests = await M.ODRequest.find({
    status: 'awaiting_outcome',
    'outcome.dueAt': { $gt: now },
    'outcome.primaryOutcome': null
  });

  for (const od of awaitingRequests) {
    if (od.outcome?.dueAt) {
      const msLeft = od.outcome.dueAt.getTime() - now.getTime();
      const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
      const shouldRemind = (outcomeDueDays - daysLeft) >= outcomeReminderDay || daysLeft <= Math.max(1, outcomeDueDays - outcomeReminderDay);

      const alreadyReminded = od.outcome?.reminderSentAt || (od.history || []).some(h => h.action === 'outcome_evidence_reminder_sent');

      if (shouldRemind && !alreadyReminded) {
        if (!od.outcome) od.outcome = {};
        od.outcome.reminderSentAt = now;
        await od.save();

        await recordApprovalHistory({
          requestId: od.requestId,
          requestType: 'od',
          actorId: 'system_job',
          actorName: 'OD Completion Engine',
          actorRole: 'system',
          action: 'outcome_evidence_reminder_sent',
          comment: `Reminder: Outcome and evidence for OD [${od.requestId}] is due in ${daysLeft} day(s) (by ${toIST(od.outcome.dueAt)}).`,
          previousState: 'awaiting_outcome',
          newState: 'awaiting_outcome'
        });

        if (M.Notification) {
          try {
            await M.Notification.create({
              type: 'info',
              from: 'OD System',
              fromRole: 'system',
              toStudentId: od.studentId,
              toStudentTrackId: od.studentTrackId,
              toStudentName: od.studentName || '',
              message: `Reminder: Please submit outcome evidence for your OD request [${od.requestId}] by ${toIST(od.outcome.dueAt)} (${daysLeft} day(s) remaining).`,
              priority: 'High',
              status: 'Delivered'
            });
          } catch (notifErr) {
            console.warn('[OD Reminder Notification Error]:', notifErr.message);
          }
        }

        remindersSent++;
      }
    }
  }

  // 3. Mark overdue outcomes
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
    remindersSent,
    transitionedToOverdue
  };
}

module.exports = {
  runODCompletionJob
};
