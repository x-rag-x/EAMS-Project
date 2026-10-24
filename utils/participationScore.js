const M = require('../models');
const { getSettings } = require('./settingsCache');

/**
 * Computes the Participation Record score (0–100) based on student's historical participation and attendance.
 * Only the Participation Record score is visible to the student.
 *
 * @param {string} studentTrackId
 * @returns {Promise<{ score: number, isNew: boolean, breakdown: object }>}
 */
async function calculateParticipationRecord(studentTrackId) {
  if (!studentTrackId) {
    return {
      score: 32.5,
      isNew: true,
      breakdown: {
        verifiedActivities: 15,
        evidenceOnTime: 10,
        certificates: 7.5,
        attendance: 0,
        cleanRecord: 15,
        note: 'New — no history yet'
      }
    };
  }

  // 1. Fetch student's past participation records
  const allODs = await M.ODRequest.find({ studentTrackId }).lean();
  
  // Find completed / outcome submitted activities
  const completedODs = allODs.filter(o => 
    o.status === 'completed' || 
    (o.outcome && o.outcome.primaryOutcome) ||
    (o.verification && o.verification.status === 'verified')
  );

  const isNew = completedODs.length === 0;

  let verifiedScore = 0;
  let onTimeScore = 0;
  let certificateScore = 0;

  if (isNew) {
    // Half marks for first three parts if new
    verifiedScore = 15;
    onTimeScore = 10;
    certificateScore = 7.5;
  } else {
    // Verified activities: 30 pts (Share of past activities verified)
    const verifiedCount = completedODs.filter(o => o.verification && o.verification.status === 'verified').length;
    verifiedScore = Math.round((verifiedCount / completedODs.length) * 30 * 10) / 10;

    // Evidence on time: 20 pts (Submitted within 7 days of event end date)
    const onTimeCount = completedODs.filter(o => {
      if (!o.outcome || !o.outcome.submittedAt || !o.eventDetails || !o.eventDetails.endDate) return false;
      const endD = new Date(o.eventDetails.endDate + 'T23:59:59.999Z');
      const subD = new Date(o.outcome.submittedAt);
      const diffDays = (subD - endD) / (1000 * 60 * 60 * 24);
      return diffDays <= 7;
    }).length;
    onTimeScore = Math.round((onTimeCount / completedODs.length) * 20 * 10) / 10;

    // Certificates: 15 pts (Share with valid certificate/proof)
    const certCount = completedODs.filter(o => 
      o.outcome && o.outcome.evidence && (o.outcome.evidence.driveFileId || o.outcome.evidence.webViewLink)
    ).length;
    certificateScore = Math.round((certCount / completedODs.length) * 15 * 10) / 10;
  }

  // Attendance: 20 pts (20 at >= 90%, scaled down to 0 at 65%)
  let attendancePct = 85; // Sensible default if not recorded
  try {
    const student = await M.Student.findOne({ trackId: studentTrackId }, 'attendance').lean();
    if (student && typeof student.attendance === 'number') {
      attendancePct = student.attendance;
    } else {
      // Check StudentAttendance model first (stores precomputed overallPercentage)
      const studentAtt = await M.StudentAttendance.findOne({ studentTrackId }).lean();
      if (studentAtt && typeof studentAtt.overallPercentage === 'number') {
        attendancePct = studentAtt.overallPercentage;
      } else {
        // Calculate from ClassAttendance records
        const attRecords = await M.ClassAttendance.find({ 'periods.records.studentTrackId': studentTrackId })
          .sort({ date: -1 })
          .limit(100)
          .lean();
        if (attRecords.length > 0) {
          let present = 0;
          let total = 0;
          for (const session of attRecords) {
            if (!Array.isArray(session.periods)) continue;
            for (const period of session.periods) {
              const rec = (period.records || []).find(r => r.studentTrackId === studentTrackId);
              if (rec) {
                total++;
                if (rec.status === 'P' || rec.status === 'present' || rec.status === 'OD') present++;
              }
            }
          }
          if (total > 0) attendancePct = Math.round((present / total) * 100);
        }
      }
    }
  } catch (e) {
    // Fallback stays at 85%
  }

  let attendanceScore = 0;
  if (attendancePct >= 90) {
    attendanceScore = 20;
  } else if (attendancePct <= 65) {
    attendanceScore = 0;
  } else {
    attendanceScore = Math.round((((attendancePct - 65) / 25) * 20) * 10) / 10;
  }

  // Clean record: 15 pts (-5 per rejected OD or invalid evidence in past 12 months)
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const penaltyCount = allODs.filter(o => {
    const isRecent = new Date(o.createdAt) >= oneYearAgo;
    if (!isRecent) return false;
    const isRejected = o.status === 'rejected';
    const isInvalid = o.verification && o.verification.status === 'invalid';
    return isRejected || isInvalid;
  }).length;

  const cleanScore = Math.max(0, 15 - (penaltyCount * 5));

  const totalScore = Math.round((verifiedScore + onTimeScore + certificateScore + attendanceScore + cleanScore) * 10) / 10;

  return {
    score: totalScore,
    isNew,
    breakdown: {
      verifiedActivities: verifiedScore,
      evidenceOnTime: onTimeScore,
      certificates: certificateScore,
      attendance: attendanceScore,
      cleanRecord: cleanScore,
      attendancePct,
      penaltyCount,
      completedCount: completedODs.length,
      note: isNew ? 'New — no history yet' : undefined
    }
  };
}

/**
 * Computes Request Evidence score (0–100) live while filling/reviewing the request.
 *
 * @param {object} draft
 * @returns {{ score: number, breakdown: object }}
 */
function calculateRequestEvidence(draft = {}) {
  const eventDetails = draft.eventDetails || draft;
  const evidenceList = draft.evidenceAtRequest || draft.evidence || [];

  // 1. Required fields complete (25 pts)
  let requiredFields = 0;
  if (eventDetails.name || draft.eventName) requiredFields += 5;
  if (eventDetails.organizer || draft.organizer) requiredFields += 5;
  if (eventDetails.startDate && eventDetails.endDate) requiredFields += 5;
  if (draft.mentorTrackId) requiredFields += 5;
  if (eventDetails.description || draft.description) requiredFields += 5;

  // 2. Event proof (30 pts): Official link, poster, or known event in registry
  let eventProof = 0;
  const hasEventProofFile = evidenceList.some(e => e.type === 'event_proof' || e.category === 'event_proof');
  const hasOfficialLink = Boolean(eventDetails.websiteUrl || draft.websiteUrl);
  const isKnownEvent = Boolean(draft.eventId);

  if (hasEventProofFile) eventProof = 30;
  else if (hasOfficialLink && isKnownEvent) eventProof = 30;
  else if (hasOfficialLink) eventProof = 20;
  else if (isKnownEvent) eventProof = 20;

  // 3. Registration proof (30 pts)
  let regProof = 0;
  const hasRegProof = evidenceList.some(e => e.type === 'registration_proof' || e.category === 'registration_proof');
  if (hasRegProof) {
    regProof = 30;
  } else if (eventDetails.level === 'Department' || eventDetails.level === 'College') {
    // For internal campus events, formal external registration proof is waived to 25 pts
    regProof = 25;
  }

  // 4. Consistency (15 pts): Dates inside event dates, valid dates, valid mentor
  let consistency = 0;
  const start = eventDetails.startDate || draft.startDate;
  const end = eventDetails.endDate || draft.endDate;
  if (start && end && start <= end) {
    consistency += 8;
  }
  if (draft.mentorTrackId) {
    consistency += 7;
  }

  const totalScore = requiredFields + eventProof + regProof + consistency;

  return {
    score: totalScore,
    breakdown: {
      requiredFields,
      eventProof,
      registrationProof: regProof,
      consistency
    }
  };
}

/**
 * Calculates overall OD Verification Score (0–100) combining Participation Record and Request Evidence.
 * Shown only to reviewers (Advisor, Mentor, HOD, Principal).
 *
 * @param {string} studentTrackId
 * @param {object} draft
 * @returns {Promise<object>}
 */
async function calculateODVerificationScore(studentTrackId, draft = {}) {
  const settings = await getSettings();
  const weights = settings?.od?.scoreWeights || { record: 40, request: 60 };

  const weightRecord = typeof weights.record === 'number' ? weights.record : 40;
  const weightRequest = typeof weights.request === 'number' ? weights.request : 60;

  const [partRecord, reqEvidence] = await Promise.all([
    calculateParticipationRecord(studentTrackId),
    Promise.resolve(calculateRequestEvidence(draft))
  ]);

  const overallScore = Math.round(
    ((partRecord.score * (weightRecord / 100)) + (reqEvidence.score * (weightRequest / 100))) * 10
  ) / 10;

  return {
    overallScore,
    weights: { record: weightRecord, request: weightRequest },
    participationRecord: partRecord,
    requestEvidence: reqEvidence
  };
}

module.exports = {
  calculateParticipationRecord,
  calculateRequestEvidence,
  calculateODVerificationScore
};
