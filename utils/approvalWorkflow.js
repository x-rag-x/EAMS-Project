const M = require('../models');
const { todayInInstitutionTz } = require('./institutionTime');

/**
 * Shared Multi-Stage Approval Workflow Engine
 */

/**
 * Define canonical stages for request types
 */
const WORKFLOW_STAGES = {
  student_leave: ['advisor'],
  od: ['advisor', 'mentor', 'hod', 'principal'],
  faculty_leave: ['hod', 'principal']
};

/**
 * Resolve the effective approver for a stage, accounting for active Acting Roles.
 *
 * @param {Object} params
 * @param {string} params.stage - 'advisor' | 'mentor' | 'hod' | 'principal'
 * @param {string} params.targetKey - classId for advisor, deptCode for HOD
 * @param {string} [params.nominalApproverTrackId] - The regular holder's trackId
 * @param {string} [params.dateStr] - YYYY-MM-DD IST
 * @returns {Promise<{ approverTrackId: string, isActing: boolean, appointedBy: string|null }>}
 */
async function resolveStageApprover({ stage, targetKey, nominalApproverTrackId, dateStr }) {
  const today = dateStr || await todayInInstitutionTz();

  if (stage === 'advisor' || stage === 'hod') {
    // Check if an ActingRole is currently active for this class or department
    const actingRole = await M.ActingRole.findOne({
      role: stage,
      key: targetKey,
      status: { $in: ['active', 'pending'] },
      from: { $lte: today },
      to: { $gte: today }
    }).lean();

    if (actingRole) {
      return {
        approverTrackId: actingRole.holderTrackId,
        isActing: true,
        appointedBy: actingRole.appointedBy
      };
    }
  }

  return {
    approverTrackId: nominalApproverTrackId || null,
    isActing: false,
    appointedBy: null
  };
}

/**
 * Record an audit timeline entry into ApprovalHistory.
 */
async function recordApprovalHistory({
  requestId,
  requestType,
  actorId,
  actorName = '',
  actorRole,
  acting = false,
  action,
  comment = '',
  previousState = null,
  newState = null,
  requestVersion = 1,
  ip = ''
}) {
  return await M.ApprovalHistory.create({
    requestId,
    requestType,
    actorId,
    actorName,
    actorRole,
    acting,
    action,
    comment,
    previousState,
    newState,
    requestVersion,
    at: new Date(),
    ip
  });
}

/**
 * Advance workflow to next stage, with automatic stage merge.
 * If the next stage approver is identical to the current actor, merges stages.
 *
 * @param {Object} params
 * @param {string} params.requestType - 'student_leave' | 'od' | 'faculty_leave'
 * @param {string} params.currentStage - 'advisor' | 'mentor' | 'hod'
 * @param {Object} params.stageApproverMap - Map of stage -> trackId
 * @param {string} params.actorTrackId
 * @param {string} params.actorName
 * @param {boolean} [params.requestPrincipal=false]
 * @returns {{ nextStage: string|null, isComplete: boolean, mergedStages: Array<string> }}
 */
function getNextWorkflowStage({
  requestType,
  currentStage,
  stageApproverMap = {},
  actorTrackId,
  requestPrincipal = false
}) {
  const stages = WORKFLOW_STAGES[requestType] || [];
  const currentIndex = stages.indexOf(currentStage);

  if (currentIndex === -1 || currentIndex >= stages.length - 1) {
    return { nextStage: null, isComplete: true, mergedStages: [] };
  }

  let nextIdx = currentIndex + 1;
  const mergedStages = [];

  while (nextIdx < stages.length) {
    const stageName = stages[nextIdx];

    // For OD, principal stage is only reached if requested
    if (stageName === 'principal' && requestType === 'od' && !requestPrincipal) {
      return { nextStage: null, isComplete: true, mergedStages };
    }

    const nextApproverId = stageApproverMap[stageName];

    // Check Stage Merge rule
    if (nextApproverId && nextApproverId === actorTrackId) {
      mergedStages.push(stageName);
      nextIdx++;
      continue;
    }

    return { nextStage: stageName, isComplete: false, mergedStages };
  }

  return { nextStage: null, isComplete: true, mergedStages };
}

/**
 * Check if a request has breached reminder (24h) or escalation (48h) SLA.
 *
 * @param {Date|string} lastActionAt
 * @param {number} [remindHours=24]
 * @param {number} [escalateHours=48]
 * @returns {{ needsReminder: boolean, isOverdue: boolean, hoursElapsed: number }}
 */
function evaluateApprovalSLA(lastActionAt, remindHours = 24, escalateHours = 48) {
  const elapsedMs = Date.now() - new Date(lastActionAt).getTime();
  const hoursElapsed = Math.floor(elapsedMs / (3600 * 1000));

  return {
    needsReminder: hoursElapsed >= remindHours && hoursElapsed < escalateHours,
    isOverdue: hoursElapsed >= escalateHours,
    hoursElapsed
  };
}

module.exports = {
  WORKFLOW_STAGES,
  resolveStageApprover,
  recordApprovalHistory,
  getNextWorkflowStage,
  advanceWorkflowStage: getNextWorkflowStage,
  evaluateApprovalSLA
};
