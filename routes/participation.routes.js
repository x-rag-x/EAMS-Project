const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { isSudo, isSudoAdmin } = require('../utils/access');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { getNextRequestId } = require('../utils/requestIds');
const { recordApprovalHistory } = require('../utils/approvalWorkflow');
const { calculateParticipationRecord, calculateODVerificationScore, calculateRequestEvidence } = require('../utils/participationScore');
const { getTodayIST } = require('../middleware/scope');

router.use(authMiddleware);

// Helper to escape CSV fields
function escapeCsv(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

// ── 1. POST /api/participation/log — Log Participation (No-OD Events, Phase L5 §5.10) ──
router.post('/log', async (req, res) => {
  try {
    const isStudent = req.user.role === 'student';
    let student = null;

    if (isStudent) {
      student = await M.Student.findOne({
        $or: [
          { _id: mongoose.isValidObjectId(req.user._id) ? req.user._id : undefined },
          { trackId: req.user.trackId }
        ].filter(Boolean)
      }).lean();
    } else {
      // Faculty logging participation on behalf of student
      const { studentTrackId, studentRegNo } = req.body;
      student = await M.Student.findOne({
        $or: [
          { trackId: studentTrackId },
          { registerNo: studentRegNo }
        ].filter(Boolean)
      }).lean();
    }

    if (!student) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    const {
      eventId, eventName, organizer, type, subType, level, mode, hostCollege, city, venue, websiteUrl,
      startDate, endDate, description, mentorTrackId, outcome, evidence
    } = req.body;

    if (!eventName || !organizer || !startDate || !endDate) {
      return res.status(400).json({ error: 'Event name, organizer, start date, and end date are required' });
    }

    // Resolve Class and Advisor
    let cls = null;
    if (student.classId) {
      if (mongoose.isValidObjectId(student.classId)) cls = await M.Class.findById(student.classId).lean();
      if (!cls) cls = await M.Class.findOne({ trackId: student.classId }).lean();
    }
    if (!cls && student.class) {
      cls = await M.Class.findOne({ $or: [{ name: student.class }, { trackId: student.class }] }).lean();
    }

    const requestId = await getNextRequestId('LOG');

    // No attendance coverage needed for logged events (weekend / holiday / off-hours)
    const newRecord = await M.ODRequest.create({
      requestId,
      eventId: mongoose.isValidObjectId(eventId) ? eventId : null,
      eventDetails: {
        name: sanitizeToString(eventName),
        organizer: sanitizeToString(organizer),
        type: sanitizeToString(type) || 'Technical',
        subType: sanitizeToString(subType) || 'Workshop',
        level: sanitizeToString(level) || 'College',
        mode: sanitizeToString(mode) || 'Offline',
        hostCollege: sanitizeToString(hostCollege) || '',
        city: sanitizeToString(city) || '',
        venue: sanitizeToString(venue) || '',
        websiteUrl: sanitizeToString(websiteUrl) || '',
        startDate: sanitizeToString(startDate),
        endDate: sanitizeToString(endDate),
        description: sanitizeToString(description) || ''
      },
      studentId: student._id,
      studentTrackId: student.trackId,
      studentName: student.fullName || student.name || (student.firstName ? `${student.firstName} ${student.lastName || ''}`.trim() : '') || 'Student',
      studentRegNo: student.registerNo || student.admissionNo || student.trackId || '',
      classId: cls?._id || student.classId,
      className: cls?.name || student.class || 'Class',
      deptId: student.deptId || cls?.deptId || null,
      deptCode: student.deptCode || cls?.deptCode || 'DEPT',
      year: student.year || 1,
      section: student.section || 'A',
      advisorTrackId: cls?.advisorTeacherTrackId || '',
      advisorName: '',
      mentorTrackId: mentorTrackId || '',
      mentorName: '',
      coverage: 'none',
      periods: [],
      dates: [sanitizeToString(startDate)],
      daysCount: 0,
      isGroupOD: false,
      status: 'awaiting_outcome', // Ready for verification / outcome
      currentStage: 'advisor',
      outcome: outcome ? {
        primaryOutcome: outcome.primaryOutcome || 'Participated',
        submittedAt: new Date(),
        evidence: evidence || null
      } : {
        primaryOutcome: 'Participated',
        submittedAt: new Date(),
        evidence: evidence || null
      },
      verification: {
        status: 'pending',
        verifiedByTrackId: null,
        verifiedByName: null,
        verifiedByRole: null,
        verifiedAt: null,
        comment: ''
      }
    });

    await recordApprovalHistory({
      requestId,
      requestType: 'od',
      actorId: req.user.trackId,
      actorName: req.user.fullName || req.user.name || '',
      actorRole: req.user.role,
      action: 'participation_logged',
      comment: `Academic Participation logged: ${eventName} (No-OD)`
    });

    return res.json({
      ok: true,
      message: 'Academic participation logged successfully. Pending verification.',
      record: newRecord
    });
  } catch (err) {
    console.error('[Log Participation Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to log participation' });
  }
});

// ── 2. GET /api/participation/me — Student's Full Participation Profile (§5.13) ──
router.get('/me', async (req, res) => {
  try {
    const studentTrackId = req.user.trackId;
    const activities = await M.ODRequest.find({ studentTrackId }).sort({ createdAt: -1 }).lean();

    const recordScore = await calculateParticipationRecord(studentTrackId);

    // Calculate aggregated metrics
    const totalCount = activities.length;
    const verifiedCount = activities.filter(a => a.verification && a.verification.status === 'verified').length;
    const certificatesCount = activities.filter(a => 
      a.outcome && a.outcome.evidence && (a.outcome.evidence.driveFileId || a.outcome.evidence.webViewLink)
    ).length;
    const winnersCount = activities.filter(a => 
      a.outcome && ['Winner', 'Runner-Up', 'Finalist'].includes(a.outcome.primaryOutcome)
    ).length;

    // Breakdown by Type
    const byType = {};
    const byLevel = {};
    for (const a of activities) {
      const t = a.eventDetails?.type || 'Other';
      const l = a.eventDetails?.level || 'College';
      byType[t] = (byType[t] || 0) + 1;
      byLevel[l] = (byLevel[l] || 0) + 1;
    }

    return res.json({
      ok: true,
      summary: {
        total: totalCount,
        verified: verifiedCount,
        certificates: certificatesCount,
        winners: winnersCount,
        participationRecord: recordScore
      },
      byType,
      byLevel,
      activities
    });
  } catch (err) {
    console.error('[Participation Me Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve participation profile' });
  }
});

// ── 3. GET /api/participation/student/:trackId — View Any Student's Profile ──
router.get('/student/:trackId', async (req, res) => {
  try {
    const trackId = sanitizeToString(req.params.trackId);
    const student = await M.Student.findOne({ trackId }).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const activities = await M.ODRequest.find({ studentTrackId: trackId }).sort({ createdAt: -1 }).lean();
    const recordScore = await calculateParticipationRecord(trackId);

    const totalCount = activities.length;
    const verifiedCount = activities.filter(a => a.verification && a.verification.status === 'verified').length;
    const certificatesCount = activities.filter(a => 
      a.outcome && a.outcome.evidence && (a.outcome.evidence.driveFileId || a.outcome.evidence.webViewLink)
    ).length;
    const winnersCount = activities.filter(a => 
      a.outcome && ['Winner', 'Runner-Up', 'Finalist'].includes(a.outcome.primaryOutcome)
    ).length;

    const byType = {};
    const byLevel = {};
    for (const a of activities) {
      const t = a.eventDetails?.type || 'Other';
      const l = a.eventDetails?.level || 'College';
      byType[t] = (byType[t] || 0) + 1;
      byLevel[l] = (byLevel[l] || 0) + 1;
    }

    return res.json({
      ok: true,
      student: {
        trackId: student.trackId,
        name: student.name,
        registerNo: student.registerNo,
        class: student.class,
        department: student.department || student.deptCode,
        year: student.year
      },
      summary: {
        total: totalCount,
        verified: verifiedCount,
        certificates: certificatesCount,
        winners: winnersCount,
        participationRecord: recordScore
      },
      byType,
      byLevel,
      activities
    });
  } catch (err) {
    console.error('[Participation Student Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve student profile' });
  }
});

// ── 4. GET /api/participation/events — Academic Event Registry with Stats ──
router.get('/events', async (req, res) => {
  try {
    const q = sanitizeToString(req.query.q);
    const filter = {};
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { organizer: { $regex: q, $options: 'i' } },
        { hostCollege: { $regex: q, $options: 'i' } }
      ];
    }
    const events = await M.AcademicEvent.find(filter).sort({ startDate: -1 }).limit(100).lean();

    // Attach participant counts
    for (const ev of events) {
      const count = await M.ODRequest.countDocuments({
        $or: [{ eventId: ev._id }, { 'eventDetails.name': ev.name }]
      });
      ev.participantsCount = count;
    }

    return res.json({ ok: true, events });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve event registry' });
  }
});

// ── 5. GET /api/participation/events/:id — Single Event Details with Participants ──
router.get('/events/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const query = mongoose.isValidObjectId(id) ? { $or: [{ _id: id }, { eventId: id }] } : { eventId: id };
    const event = await M.AcademicEvent.findOne(query).lean();
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const participants = await M.ODRequest.find({
      $or: [{ eventId: event._id }, { 'eventDetails.name': event.name }]
    }).sort({ createdAt: -1 }).lean();

    return res.json({ ok: true, event, participants });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve event detail' });
  }
});

// ── 6. GET /api/participation/tracker — Command Centre Data (C8 Tab for HOD/Principal) ──
router.get('/tracker', async (req, res) => {
  try {
    const userRole = req.user.role;
    const isPrincipal = req.user.isPrincipal || userRole === 'principal' || isSudo(req);
    const isHod = req.user.isHod || userRole === 'hod';

    // Department scope
    const filter = {};
    if (!isPrincipal) {
      if (isHod && req.user.deptCode) {
        filter.deptCode = req.user.deptCode;
      } else if (req.user.deptId) {
        filter.deptId = req.user.deptId;
      }
    } else if (req.query.deptCode && req.query.deptCode !== 'ALL') {
      filter.deptCode = sanitizeToString(req.query.deptCode);
    }

    // Additional query filters
    if (req.query.year) filter.year = Number(req.query.year);
    if (req.query.section) filter.section = sanitizeToString(req.query.section);
    if (req.query.type) filter['eventDetails.type'] = sanitizeToString(req.query.type);
    if (req.query.level) filter['eventDetails.level'] = sanitizeToString(req.query.level);
    if (req.query.status) filter.status = sanitizeToString(req.query.status);
    if (req.query.verification) filter['verification.status'] = sanitizeToString(req.query.verification);
    if (req.query.outcome) filter['outcome.primaryOutcome'] = sanitizeToString(req.query.outcome);

    if (req.query.search) {
      const s = sanitizeToString(req.query.search);
      filter.$or = [
        { studentName: { $regex: s, $options: 'i' } },
        { studentRegNo: { $regex: s, $options: 'i' } },
        { 'eventDetails.name': { $regex: s, $options: 'i' } },
        { 'eventDetails.organizer': { $regex: s, $options: 'i' } }
      ];
    }

    const records = await M.ODRequest.find(filter).sort({ createdAt: -1 }).limit(500).lean();

    // Summary KPIs
    const totalCount = records.length;
    const pendingCount = records.filter(r => r.status === 'pending').length;
    const approvedCount = records.filter(r => r.status === 'approved').length;
    const awaitingPrincipalCount = records.filter(r => r.currentStage === 'principal' && r.status === 'pending').length;
    const completedCount = records.filter(r => r.status === 'completed').length;
    const verifiedCount = records.filter(r => r.verification && r.verification.status === 'verified').length;
    const certificatesCount = records.filter(r => 
      r.outcome && r.outcome.evidence && (r.outcome.evidence.driveFileId || r.outcome.evidence.webViewLink)
    ).length;
    const winnersCount = records.filter(r => 
      r.outcome && ['Winner', 'Runner-Up', 'Finalist'].includes(r.outcome.primaryOutcome)
    ).length;
    const overdueEvidenceCount = records.filter(r => r.status === 'evidence_overdue').length;

    // Institutional Distribution Stats for SVG charts
    const typeCounts = {};
    const levelCounts = {};
    const outcomeCounts = {};
    const monthlyCounts = {};

    for (const r of records) {
      const t = r.eventDetails?.type || 'Other';
      const l = r.eventDetails?.level || 'College';
      const o = r.outcome?.primaryOutcome || (r.status === 'approved' ? 'Upcoming' : 'Pending');
      const m = r.eventDetails?.startDate ? r.eventDetails.startDate.slice(0, 7) : 'Unknown';

      typeCounts[t] = (typeCounts[t] || 0) + 1;
      levelCounts[l] = (levelCounts[l] || 0) + 1;
      outcomeCounts[o] = (outcomeCounts[o] || 0) + 1;
      monthlyCounts[m] = (monthlyCounts[m] || 0) + 1;
    }

    // Group by Event
    const eventGroupsMap = new Map();
    for (const r of records) {
      const eName = r.eventDetails?.name || 'Unnamed Event';
      if (!eventGroupsMap.has(eName)) {
        eventGroupsMap.set(eName, {
          name: eName,
          organizer: r.eventDetails?.organizer || '',
          type: r.eventDetails?.type || '',
          level: r.eventDetails?.level || '',
          startDate: r.eventDetails?.startDate || '',
          endDate: r.eventDetails?.endDate || '',
          participants: []
        });
      }
      eventGroupsMap.get(eName).participants.push(r);
    }

    const eventList = Array.from(eventGroupsMap.values()).map(eg => ({
      name: eg.name,
      organizer: eg.organizer,
      type: eg.type,
      level: eg.level,
      startDate: eg.startDate,
      endDate: eg.endDate,
      totalParticipants: eg.participants.length,
      approvedCount: eg.participants.filter(p => p.status === 'approved' || p.status === 'completed').length,
      verifiedCount: eg.participants.filter(p => p.verification?.status === 'verified').length,
      certificatesCount: eg.participants.filter(p => p.outcome?.evidence?.driveFileId || p.outcome?.evidence?.webViewLink).length,
      participants: eg.participants
    }));

    // Group by Student Leaderboard
    const studentMap = new Map();
    for (const r of records) {
      const key = r.studentTrackId || r.studentRegNo;
      if (!studentMap.has(key)) {
        studentMap.set(key, {
          studentTrackId: r.studentTrackId,
          studentName: r.studentName,
          studentRegNo: r.studentRegNo,
          deptCode: r.deptCode,
          year: r.year,
          section: r.section,
          total: 0,
          verified: 0,
          certificates: 0,
          wins: 0
        });
      }
      const st = studentMap.get(key);
      st.total++;
      if (r.verification?.status === 'verified') st.verified++;
      if (r.outcome?.evidence?.driveFileId || r.outcome?.evidence?.webViewLink) st.certificates++;
      if (['Winner', 'Runner-Up', 'Finalist'].includes(r.outcome?.primaryOutcome)) st.wins++;
    }

    const studentList = Array.from(studentMap.values()).sort((a, b) => b.verified - a.verified || b.total - a.total);

    return res.json({
      ok: true,
      kpis: {
        total: totalCount,
        pending: pendingCount,
        approved: approvedCount,
        awaitingPrincipal: awaitingPrincipalCount,
        completed: completedCount,
        verified: verifiedCount,
        certificates: certificatesCount,
        winners: winnersCount,
        overdue: overdueEvidenceCount
      },
      charts: {
        byType: typeCounts,
        byLevel: levelCounts,
        byOutcome: outcomeCounts,
        byMonth: monthlyCounts
      },
      records,
      events: eventList,
      students: studentList
    });
  } catch (err) {
    console.error('[Participation Tracker Error]:', err);
    return res.status(500).json({ error: 'Failed to load tracker data' });
  }
});

// ── 7. GET /api/participation/tracker/export.csv — Accreditation Export ──
router.get('/tracker/export.csv', async (req, res) => {
  try {
    const isPrincipal = req.user.isPrincipal || req.user.role === 'principal' || isSudoAdmin(req.user);
    const isHod = req.user.isHod || req.user.role === 'hod';

    const filter = {};
    if (!isPrincipal) {
      if (isHod && req.user.deptCode) filter.deptCode = req.user.deptCode;
      else if (req.user.deptId) filter.deptId = req.user.deptId;
    } else if (req.query.deptCode && req.query.deptCode !== 'ALL') {
      filter.deptCode = sanitizeToString(req.query.deptCode);
    }

    if (req.query.year) filter.year = Number(req.query.year);
    if (req.query.section) filter.section = sanitizeToString(req.query.section);
    if (req.query.type) filter['eventDetails.type'] = sanitizeToString(req.query.type);
    if (req.query.level) filter['eventDetails.level'] = sanitizeToString(req.query.level);

    const records = await M.ODRequest.find(filter).sort({ createdAt: -1 }).limit(2000).lean();

    const headers = [
      'RequestId',
      'StudentName',
      'RegisterNo',
      'Department',
      'Year',
      'Section',
      'EventName',
      'Organizer',
      'Type',
      'SubType',
      'Level',
      'Mode',
      'StartDate',
      'EndDate',
      'Coverage',
      'Status',
      'PrimaryOutcome',
      'VerificationStatus',
      'VerifiedBy',
      'EvidenceFileLink'
    ];

    const rows = [headers.join(',')];

    for (const r of records) {
      const row = [
        escapeCsv(r.requestId),
        escapeCsv(r.studentName),
        escapeCsv(r.studentRegNo),
        escapeCsv(r.deptCode),
        escapeCsv(r.year),
        escapeCsv(r.section),
        escapeCsv(r.eventDetails?.name || ''),
        escapeCsv(r.eventDetails?.organizer || ''),
        escapeCsv(r.eventDetails?.type || ''),
        escapeCsv(r.eventDetails?.subType || ''),
        escapeCsv(r.eventDetails?.level || ''),
        escapeCsv(r.eventDetails?.mode || ''),
        escapeCsv(r.eventDetails?.startDate || ''),
        escapeCsv(r.eventDetails?.endDate || ''),
        escapeCsv(r.coverage || ''),
        escapeCsv(r.status || ''),
        escapeCsv(r.outcome?.primaryOutcome || ''),
        escapeCsv(r.verification?.status || ''),
        escapeCsv(r.verification?.verifiedByName || ''),
        escapeCsv(r.outcome?.evidence?.webViewLink || '')
      ];
      rows.push(row.join(','));
    }

    const csvContent = rows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="EAMS_Academic_Participation_${getTodayIST()}.csv"`);
    return res.status(200).send(csvContent);
  } catch (err) {
    console.error('[Participation CSV Export Error]:', err);
    return res.status(500).json({ error: 'Failed to export CSV' });
  }
});

// ── 8. GET /api/participation/score — Live Score Computation ──
router.get('/score', async (req, res) => {
  try {
    const studentTrackId = sanitizeToString(req.query.studentTrackId) || req.user.trackId;
    let draft = {};
    if (req.query.draft) {
      try {
        draft = JSON.parse(req.query.draft);
      } catch (e) {
        draft = {};
      }
    }

    const scoreData = await calculateODVerificationScore(studentTrackId, draft);
    return res.json({ ok: true, ...scoreData });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to compute score' });
  }
});

module.exports = router;
