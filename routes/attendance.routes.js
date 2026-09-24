const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware, adminOnly, requireRole } = require('../middleware/auth');
const { attendanceClearLimiter, attendanceMarkLimiter, attendanceUpdateLimiter } = require('../utils/rateLimiters');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { checkAttendanceMarkGuard, getCachedSettings } = require('../middleware/portalGuard');
const { verifyTeacherAssignment } = require('../utils/assignmentAuth');

function parseYearNum(val) {
  if (typeof val === 'number') return val;
  if (!val) return 1;
  const str = String(val).toUpperCase();
  if (str.includes('IV') || str === '4') return 4;
  if (str.includes('III') || str === '3') return 3;
  if (str.includes('II') || str === '2') return 2;
  if (str.includes('I') || str === '1') return 1;
  const num = parseInt(str, 10);
  return isNaN(num) ? 1 : num;
}

function parseSemNum(val) {
  if (typeof val === 'number') return val;
  if (!val) return 1;
  const str = String(val).toUpperCase();
  const romanMap = { VIII: 8, VII: 7, VI: 6, V: 5, IV: 4, III: 3, II: 2, I: 1 };
  for (const [r, n] of Object.entries(romanMap)) {
    if (str.includes(r)) return n;
  }
  const num = parseInt(str, 10);
  return isNaN(num) ? 1 : num;
}

function normalizeStatus(status) {
  if (!status) return 'P';
  const s = String(status).toUpperCase().trim();
  if (s === 'PRESENT' || s === 'P') return 'P';
  return 'AB';
}

const { computeStudentAttendance } = require('../utils/attendanceCalculator');

async function syncStudentAttendanceCounters(studentTrackId, targetClassId) {
  try {
    await computeStudentAttendance(studentTrackId, targetClassId);
  } catch (err) {
    console.error('Error syncing student attendance counter:', err);
  }
}


// GET /api/attendance - Query attendance records with search, filters, and pagination
router.get('/', authMiddleware, async (req, res) => {
  try {
    const qFrom = sanitizeToString(req.query.from);
    const qTo = sanitizeToString(req.query.to);
    const qDate = sanitizeToString(req.query.date);
    const qClassId = sanitizeToString(req.query.classId);
    const qTeacherId = sanitizeToString(req.query.teacherId);
    const qStatus = sanitizeToString(req.query.status);
    const qSearch = sanitizeToString(req.query.search);
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limitParam = req.query.limit;
    const limit = (limitParam === '0' || limitParam === 'all') ? 0 : Math.max(1, parseInt(limitParam || '50', 10));

    const filter = {};
    let studentCaller = null;
    if (req.user.role === 'student') {
      const studentQueries = [{ trackId: req.user.trackId }, { username: req.user.username }];
      if (typeof req.user._id === 'string' && mongoose.Types.ObjectId.isValid(req.user._id)) {
        studentQueries.push({ _id: req.user._id });
      }
      studentCaller = await M.Student.findOne({ $or: studentQueries }).lean();
      if (!studentCaller || (!studentCaller.classId && !studentCaller.class)) {
        return res.json([]);
      }
      const studentClassId = studentCaller.classId || studentCaller.class;
      const classQuery = [{ _id: studentClassId }, { classTrackId: studentClassId }, { name: studentClassId }];
      if (mongoose.Types.ObjectId.isValid(studentClassId)) {
        classQuery.unshift({ _id: new mongoose.Types.ObjectId(studentClassId) });
      }
      const cls = await M.Class.findOne({ $or: classQuery }).lean();
      const validClassIds = [String(studentClassId)];
      if (cls) {
        validClassIds.push(String(cls._id));
        if (cls.classTrackId) validClassIds.push(cls.classTrackId);
      }
      filter.classId = { $in: validClassIds };
    } else if (qClassId && qClassId !== 'all') {
      filter.$or = [{ classId: qClassId }];
      const classQuery = [];
      if (mongoose.isValidObjectId(qClassId)) {
        classQuery.push({ _id: qClassId });
      }
      classQuery.push({ classTrackId: qClassId });
      classQuery.push({ name: qClassId });

      const cls = await M.Class.findOne({ $or: classQuery }).lean();
      if (cls) {
        filter.$or.push({ classId: String(cls._id) });
        if (cls.classTrackId) filter.$or.push({ classId: cls.classTrackId });
      }
    }

    if (qDate) {
      const start = new Date(qDate + 'T00:00:00.000Z');
      const end = new Date(qDate + 'T23:59:59.999Z');
      filter.date = { $gte: start, $lte: end };
    } else if (qFrom && qTo) {
      const start = new Date(qFrom + 'T00:00:00.000Z');
      const end = new Date(qTo + 'T23:59:59.999Z');
      filter.date = { $gte: start, $lte: end };
    }

    // Query recent class attendance docs
    const classAttDocs = await M.ClassAttendance.find(filter).sort({ date: -1 }).limit(300).lean();

    // Collect unique student trackIds from the actual attendance records
    const studentTrackIds = new Set();
    for (const doc of classAttDocs) {
      for (const period of doc.periods || []) {
        for (const rec of period.records || []) {
          if (rec.studentTrackId) studentTrackIds.add(rec.studentTrackId);
        }
      }
    }

    // Fetch only the students referenced in these records
    const allStudents = studentTrackIds.size > 0
      ? await M.Student.find({
          $or: [
            { trackId: { $in: Array.from(studentTrackIds) } },
            { _id: { $in: Array.from(studentTrackIds).filter(id => mongoose.isValidObjectId(id)) } }
          ]
        }).select('_id trackId fullName registerNo classId department deptCode').lean()
      : [];
    
    const studentMap = new Map();
    allStudents.forEach(s => {
      studentMap.set(String(s._id), s);
      if (s.trackId) studentMap.set(s.trackId, s);
    });

    const allSubjects = await M.Subject.find().lean();
    const subjectMap = new Map();
    allSubjects.forEach(sub => {
      subjectMap.set(String(sub._id), sub);
      if (sub.subjectTrackId) subjectMap.set(sub.subjectTrackId, sub);
      if (sub.subjectCode) subjectMap.set(sub.subjectCode, sub);
    });

    const allClasses = await M.Class.find().lean();
    const classMap = new Map();
    allClasses.forEach(c => {
      classMap.set(String(c._id), c);
      if (c.classTrackId) classMap.set(c.classTrackId, c);
    });

    let flattened = [];
    for (const doc of classAttDocs) {
      const dateStr = doc.date ? new Date(doc.date).toISOString().split('T')[0] : '';
      const clsObj = classMap.get(doc.classId);
      const className = clsObj ? clsObj.name : doc.classId;

      for (let pIdx = 0; pIdx < (doc.periods || []).length; pIdx++) {
        const period = doc.periods[pIdx];
        if (qTeacherId && period.teacherTrackId !== qTeacherId) {
          let targetTrackId = null;
          if (mongoose.isValidObjectId(qTeacherId)) {
            const tDoc = await M.Teacher.findById(qTeacherId).select('-password').lean();
            if (tDoc) targetTrackId = tDoc.trackId;
          }
          if (!targetTrackId) {
            const uDoc = await M.User.findOne({ $or: [{ _id: qTeacherId }, { trackId: qTeacherId }] }).lean();
            if (uDoc) targetTrackId = uDoc.trackId;
          }
          if (targetTrackId && period.teacherTrackId !== targetTrackId) {
            continue;
          }
        }

        const subObj = subjectMap.get(period.subjectTrackId);
        const subjectName = subObj ? subObj.name : period.subjectTrackId;
        const subjectId = subObj ? String(subObj._id) : period.subjectTrackId;

        for (let rIdx = 0; rIdx < (period.records || []).length; rIdx++) {
          const rec = period.records[rIdx];
          if (studentCaller) {
            const isOwn = rec.studentTrackId === studentCaller.trackId ||
                          String(rec.studentTrackId) === String(studentCaller._id) ||
                          rec.studentTrackId === studentCaller.registerNo;
            if (!isOwn) continue;
          }
          const stuObj = studentMap.get(rec.studentTrackId);
          const studentId = stuObj ? String(stuObj._id) : rec.studentTrackId;
          const studentName = stuObj ? stuObj.fullName : rec.studentTrackId;
          const regNo = stuObj ? stuObj.registerNo : '';
          const department = stuObj ? (stuObj.department || stuObj.deptCode || '') : (doc.departmentCode || '');

          const statusText = rec.status === 'P' ? 'present' : (rec.status === 'OD' ? 'od' : (rec.status === 'LEAVE' ? 'leave' : 'absent'));

          flattened.push({
            _id: `${doc._id}_${pIdx}_${rIdx}`,
            docId: doc._id,
            periodIndex: pIdx,
            recordIndex: rIdx,
            classId: doc.classId,
            className,
            department,
            subjectId,
            subjectTrackId: period.subjectTrackId,
            subjectName,
            teacherId: period.teacherTrackId,
            teacherName: period.markedBy || 'Faculty',
            date: dateStr,
            periodNumber: period.periodNumber || (period.periodNumbers ? period.periodNumbers[0] : 1),
            periodNumbers: period.periodNumbers,
            studentId,
            studentTrackId: rec.studentTrackId,
            studentName,
            regNo,
            status: statusText,
            rawStatus: rec.status,
            remarks: rec.remarks || period.topic || '',
            topic: period.topic || '',
            notes: period.notes || '',
          });
        }
      }
    }

    // Status filter
    if (qStatus && qStatus !== 'all') {
      const targetStat = qStatus.toLowerCase().trim();
      flattened = flattened.filter(r => (r.status && r.status.toLowerCase() === targetStat) || (r.rawStatus && String(r.rawStatus).toLowerCase() === targetStat));
    }

    // Search filter
    if (qSearch) {
      const q = qSearch.toLowerCase().trim();
      flattened = flattened.filter(r =>
        (r.studentName && r.studentName.toLowerCase().includes(q)) ||
        (r.regNo && r.regNo.toLowerCase().includes(q)) ||
        (r.className && r.className.toLowerCase().includes(q)) ||
        (r.subjectName && r.subjectName.toLowerCase().includes(q)) ||
        (r.teacherName && r.teacherName.toLowerCase().includes(q)) ||
        (r.department && r.department.toLowerCase().includes(q)) ||
        (r.date && r.date.includes(q))
      );
    }

    const total = flattened.length;
    const stats = {
      total,
      present: flattened.filter(r => r.status === 'present').length,
      absent: flattened.filter(r => r.status === 'absent').length,
      od: flattened.filter(r => r.status === 'od' || r.status === 'leave').length,
    };

    const pages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
    const paginated = limit > 0 ? flattened.slice((page - 1) * limit, page * limit) : flattened;

    res.json(paginated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/period-notes - Query period notes with filters
router.get('/period-notes', authMiddleware, async (req, res) => {
  try {
    const qFrom = sanitizeToString(req.query.from);
    const qTo = sanitizeToString(req.query.to);
    const qClassId = sanitizeToString(req.query.classId);
    const qSubjectId = sanitizeToString(req.query.subjectId);
    const qTeacherId = sanitizeToString(req.query.teacherId);
    const qSearch = sanitizeToString(req.query.search);

    const filter = {};
    if (req.user.role === 'student') {
      const studentQueries = [{ trackId: req.user.trackId }, { username: req.user.username }];
      if (typeof req.user._id === 'string' && mongoose.Types.ObjectId.isValid(req.user._id)) {
        studentQueries.push({ _id: req.user._id });
      }
      const studentCaller = await M.Student.findOne({ $or: studentQueries }).lean();
      if (!studentCaller || (!studentCaller.classId && !studentCaller.class)) {
        return res.json([]);
      }
      const studentClassId = studentCaller.classId || studentCaller.class;
      const classQuery = [{ _id: studentClassId }, { classTrackId: studentClassId }, { name: studentClassId }];
      if (mongoose.Types.ObjectId.isValid(studentClassId)) {
        classQuery.unshift({ _id: new mongoose.Types.ObjectId(studentClassId) });
      }
      const cls = await M.Class.findOne({ $or: classQuery }).lean();
      const validClassIds = [String(studentClassId)];
      if (cls) {
        validClassIds.push(String(cls._id));
        if (cls.classTrackId) validClassIds.push(cls.classTrackId);
      }
      filter.classId = { $in: validClassIds };
    } else if (qClassId && qClassId !== 'all') {
      filter.classId = qClassId;
    }
    if (qFrom || qTo) {
      filter.date = {};
      if (qFrom) filter.date.$gte = new Date(qFrom + 'T00:00:00.000Z');
      if (qTo) filter.date.$lte = new Date(qTo + 'T23:59:59.999Z');
    }

    const docs = await M.ClassAttendance.find(filter).sort({ date: -1 }).lean();

    const [allClasses, allSubjects, allTeachers] = await Promise.all([
      M.Class.find().lean(),
      M.Subject.find().lean(),
      M.Teacher.find().lean()
    ]);

    const classMap = new Map();
    allClasses.forEach(c => {
      classMap.set(String(c._id), c.name || c.className || c.trackId);
      if (c.trackId) classMap.set(c.trackId, c.name || c.className);
    });

    const subjectMap = new Map();
    allSubjects.forEach(s => {
      subjectMap.set(String(s._id), s);
      if (s.trackId) subjectMap.set(s.trackId, s);
    });

    const teacherMap = new Map();
    allTeachers.forEach(t => {
      teacherMap.set(String(t._id), t);
      if (t.trackId) teacherMap.set(t.trackId, t);
    });

    const results = [];
    for (const doc of docs) {
      const dateStr = doc.date ? new Date(doc.date).toISOString().split('T')[0] : '';
      const className = classMap.get(String(doc.classId)) || classMap.get(doc.classId) || doc.classId;

      for (let pIdx = 0; pIdx < (doc.periods || []).length; pIdx++) {
        const period = doc.periods[pIdx];
        if (qSubjectId && qSubjectId !== 'all' && period.subjectTrackId !== qSubjectId) {
          continue;
        }
        if (qTeacherId && qTeacherId !== 'all' && period.teacherTrackId !== qTeacherId) {
          continue;
        }

        const subObj = subjectMap.get(period.subjectTrackId);
        const subjectName = subObj ? subObj.name : period.subjectTrackId;
        const teachObj = teacherMap.get(period.teacherTrackId);
        const teacherName = teachObj ? (teachObj.fullName || teachObj.name) : (period.markedBy || 'Faculty');

        const topic = period.topic || '';
        const notes = period.notes || '';

        // Search filter if provided
        if (qSearch) {
          const q = qSearch.toLowerCase().trim();
          const match = (
            topic.toLowerCase().includes(q) ||
            notes.toLowerCase().includes(q) ||
            className.toLowerCase().includes(q) ||
            subjectName.toLowerCase().includes(q) ||
            teacherName.toLowerCase().includes(q)
          );
          if (!match) continue;
        }

        const records = period.records || [];
        const presentCount = records.filter(r => r.status === 'P').length;
        const totalCount = records.length;

        results.push({
          docId: doc._id,
          periodIndex: pIdx,
          date: dateStr,
          periodNumber: period.periodNumber || (period.periodNumbers ? period.periodNumbers[0] : 1),
          classId: doc.classId,
          className,
          subjectTrackId: period.subjectTrackId,
          subjectName,
          teacherTrackId: period.teacherTrackId,
          teacherName,
          topic,
          notes,
          presentCount,
          totalCount,
          markedAt: period.markedAt
        });
      }
    }

    res.json(results);
  } catch (err) {
    console.error('[Period Notes Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/attendance/period-notes/:docId/:periodIndex - Update period notes
router.put('/period-notes/:docId/:periodIndex', authMiddleware, async (req, res) => {
  try {
    const { docId, periodIndex } = req.params;
    const { topic, notes } = req.body;
    const pIdx = parseInt(periodIndex, 10);

    const doc = await M.ClassAttendance.findById(docId);
    if (!doc || !doc.periods || !doc.periods[pIdx]) {
      return res.status(404).json({ error: 'Period attendance record not found' });
    }

    const attSettings = await getCachedSettings('attendance');
    if (req.user.role !== 'admin' && attSettings.allowAttendanceEdit === false) {
      return res.status(403).json({ error: 'Editing attendance or notes is locked by administrator.' });
    }

    if (topic !== undefined) doc.periods[pIdx].topic = String(topic).trim();
    if (notes !== undefined) doc.periods[pIdx].notes = String(notes).trim();
    doc.updatedAt = new Date();
    await doc.save();

    res.json({ success: true, message: 'Period notes updated successfully', period: doc.periods[pIdx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function appendAttendanceChangeToDailyLog(classId, dateStr, periodNum, studentTrackId, newStatus, req) {
  try {
    const student = await M.Student.findOne({ $or: [{ trackId: studentTrackId }, { _id: studentTrackId }] }).select('registerNo fullName trackId').lean();
    const regNo = student?.registerNo || studentTrackId;
    const sName = student?.fullName || studentTrackId;

    const teacherName = (req.user?.firstName && req.user?.lastName)
      ? `${req.user.firstName} ${req.user.lastName}`.trim()
      : (req.user?.fullName || req.user?.name || req.user?.username || 'Teacher');
    const teacherSessionId = req.user?.sessionId || '';
    const teacherTrackId = req.user?.trackId || String(req.user?._id || '');

    const log = await M.Log.findOne({
      category: 'attendance',
      subType: 'attendance',
      'attendanceClassDaily.classId': String(classId),
      'attendanceClassDaily.date': dateStr
    });

    if (log && log.attendanceClassDaily) {
      const periods = log.attendanceClassDaily.periods || [];
      const period = periods.find(p => p.periodNumber === Number(periodNum));
      if (period) {
        const rec = (period.records || []).find(r => r.studentTrackId === studentTrackId);
        const oldStatus = rec ? rec.status : 'Unknown';
        if (rec) rec.status = newStatus;
        else period.records.push({ studentTrackId, regNo, name: sName, status: newStatus });

        // Update stats
        let pCnt = 0, aCnt = 0, odCnt = 0;
        period.records.forEach(r => {
          if (r.status === 'P' || r.status === 'PRESENT') pCnt++;
          else if (r.status === 'OD' || r.status === 'ON DUTY') odCnt++;
          else aCnt++;
        });
        period.stats = { total: period.records.length, present: pCnt, absent: aCnt, od: odCnt };

        period.history = (period.history || []).concat([{
          action: 'Updated',
          teacherTrackId,
          teacherName,
          teacherSessionId,
          method: 'Manual Edit',
          changedAt: new Date(),
          summary: `Updated student ${regNo} (${oldStatus} -> ${newStatus}) by ${teacherName}`
        }]);

        log.time = new Date();
        log.sessionId = teacherSessionId;
        log.userName = teacherName;
        log.details = `Class ${classId} Period ${periodNum} updated: ${regNo} changed to ${newStatus} by ${teacherName}. Session: ${teacherSessionId}`;
        await log.save();
      }
    }
  } catch (err) {
    console.error('[appendAttendanceChange Error]:', err.message);
  }
}

// POST /api/attendance/update - Update an individual attendance record
router.post('/update/:id?', attendanceUpdateLimiter, authMiddleware, requireRole('teacher', 'admin'), checkAttendanceMarkGuard, async (req, res) => {
  try {
    const { status, remarks, studentTrackId, date, periodNumber } = req.body;
    const idParam = req.params.id;

    // Check institutional attendance editing policy
    const settingsDoc = await M.Settings.findOne({ key: 'attendance' }).lean();
    const attConfig = settingsDoc?.value || {};
    if (req.user.role !== 'admin') {
      if (attConfig.allowAttendanceEdit === false) {
        return res.status(403).json({ error: 'Attendance editing has been locked by institution policy.' });
      }
    }

    // Support composite ID: {docId}_{pIdx}_{rIdx}
    let classAttDoc = null;
    let pIdx = -1;
    let rIdx = -1;

    if (idParam && idParam.includes('_')) {
      const parts = idParam.split('_');
      const docId = parts[0];
      pIdx = parseInt(parts[1], 10);
      rIdx = parseInt(parts[2], 10);
      classAttDoc = await M.ClassAttendance.findById(docId);
      if (classAttDoc && classAttDoc.periods && classAttDoc.periods[pIdx] && classAttDoc.periods[pIdx].records && classAttDoc.periods[pIdx].records[rIdx]) {
        const period = classAttDoc.periods[pIdx];

        // Policy & assignment check for non-admins
        if (req.user.role !== 'admin') {
          const autoLockHours = Number(attConfig.autoLockAttendanceHours);
          if (autoLockHours > 0) {
            const classDate = classAttDoc.date ? new Date(classAttDoc.date) : (period.markedAt ? new Date(period.markedAt) : null);
            if (classDate) {
              const lockThreshold = new Date(Date.now() - autoLockHours * 3600 * 1000);
              if (classDate < lockThreshold) {
                return res.status(403).json({ error: `Attendance is locked. Edits are only permitted within ${autoLockHours} hours of the class.` });
              }
            }
          }

          const teacherTrackId = req.user.trackId || String(req.user._id);
          const isPeriodAuthor = period.teacherTrackId === teacherTrackId;
          if (!isPeriodAuthor) {
            const assignCheck = await verifyTeacherAssignment(req.user, classAttDoc.classId, period.subjectTrackId);
            if (!assignCheck.allowed) {
              return res.status(403).json({ error: 'You are not authorized to edit this attendance period.' });
            }
          }
        }

        const rec = period.records[rIdx];
        if (status) rec.status = normalizeStatus(status);
        if (remarks !== undefined) rec.remarks = remarks;
        classAttDoc.periods[pIdx].records[rIdx] = rec;
        classAttDoc.updatedAt = new Date();
        await classAttDoc.save();

        if (rec.studentTrackId) {
          syncStudentAttendanceCounters(rec.studentTrackId, classAttDoc.classId).catch(() => {});
          const pNum = period.periodNumber || (pIdx + 1);
          const dStr = classAttDoc.date ? new Date(classAttDoc.date).toISOString().split('T')[0] : (date || '');
          appendAttendanceChangeToDailyLog(classAttDoc.classId, dStr, pNum, rec.studentTrackId, rec.status, req).catch(() => {});
        }
        return res.json({ success: true, message: 'Attendance record updated successfully', record: rec });
      }
    }

    // Find record matching studentTrackId across all periods
    const effectiveStudentTrackId = studentTrackId || idParam;
    const attDoc = await M.ClassAttendance.findOne({
      "periods.records.studentTrackId": effectiveStudentTrackId,
      ...(date ? { date } : {})
    });

    if (attDoc) {
      let found = false;
      let matchedRec = null;
      let matchedPeriodNumber = 1;
      for (const p of attDoc.periods) {
        if (periodNumber && p.periodNumber !== Number(periodNumber)) continue;
        const rec = p.records.find(r => r.studentTrackId === effectiveStudentTrackId);
        if (rec) {
          if (req.user.role !== 'admin') {
            const autoLockHours = Number(attConfig.autoLockAttendanceHours);
            if (autoLockHours > 0) {
              const classDate = attDoc.date ? new Date(attDoc.date) : (p.markedAt ? new Date(p.markedAt) : null);
              if (classDate) {
                const lockThreshold = new Date(Date.now() - autoLockHours * 3600 * 1000);
                if (classDate < lockThreshold) {
                  return res.status(403).json({ error: `Attendance is locked. Edits are only permitted within ${autoLockHours} hours of the class.` });
                }
              }
            }

            const teacherTrackId = req.user.trackId || String(req.user._id);
            const isPeriodAuthor = p.teacherTrackId === teacherTrackId;
            if (!isPeriodAuthor) {
              const assignCheck = await verifyTeacherAssignment(req.user, attDoc.classId, p.subjectTrackId);
              if (!assignCheck.allowed) {
                return res.status(403).json({ error: 'You are not authorized to edit this attendance period.' });
              }
            }
          }

          if (status) rec.status = normalizeStatus(status);
          if (remarks !== undefined) rec.remarks = remarks;
          matchedRec = rec;
          matchedPeriodNumber = p.periodNumber || 1;
          found = true;
          break;
        }
      }
      if (found) {
        attDoc.updatedAt = new Date();
        await attDoc.save();
        syncStudentAttendanceCounters(effectiveStudentTrackId, attDoc.classId).catch(() => {});
        const dStr = attDoc.date ? new Date(attDoc.date).toISOString().split('T')[0] : (date || '');
        appendAttendanceChangeToDailyLog(attDoc.classId, dStr, matchedPeriodNumber, effectiveStudentTrackId, matchedRec.status, req).catch(() => {});
        return res.json({ success: true, message: 'Attendance record updated successfully', record: matchedRec });
      }
    }

    return res.status(404).json({ error: 'Attendance record not found for update' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/attendance - Save or batch update class attendance records
router.post('/', attendanceMarkLimiter, authMiddleware, requireRole('teacher', 'admin'), checkAttendanceMarkGuard, async (req, res) => {
  try {
    const isBatch = Array.isArray(req.body.records);
    const rawRecords = isBatch ? req.body.records : [req.body];

    const classIdInput = req.body.classId || (rawRecords[0] && rawRecords[0].classId);
    const subjectIdInput = req.body.subjectId || (rawRecords[0] && rawRecords[0].subjectId);
    const dateInput = req.body.date || (rawRecords[0] && rawRecords[0].date) || new Date().toISOString().split('T')[0];
    const periodNumInput = Number(req.body.periodNumber || req.body.period || (rawRecords[0] && rawRecords[0].periodNumber)) || 1;

    if (!classIdInput || !subjectIdInput) {
      return res.status(400).json({ error: 'classId and subjectId are required' });
    }

    // Verify attendance policy constraints for non-admin roles
    const settings = await getCachedSettings();
    const attSettings = settings.attendance || {};

    if (req.user.role !== 'admin') {
      // Verify max attendance backdate limit
      const maxBackdate = attSettings.maxAttendanceBackdateDays !== undefined ? Number(attSettings.maxAttendanceBackdateDays) : 3;
      const targetDate = new Date(dateInput + 'T00:00:00.000Z');
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const diffDays = Math.floor((today - targetDate) / (1000 * 60 * 60 * 24));
      if (diffDays > maxBackdate) {
        return res.status(403).json({
          error: `Attendance marking for dates older than ${maxBackdate} day(s) is locked by administrator.`,
          backdateLocked: true
        });
      }

      // Verify required period remark or topic
      const requireRemark = !!attSettings.requirePeriodRemark;
      const topicInput = req.body.topic || req.body.remarks || (rawRecords[0] && (rawRecords[0].topic || rawRecords[0].remarks));
      if (requireRemark && (!topicInput || !String(topicInput).trim())) {
        return res.status(400).json({
          error: 'Topic / Period Remark is required by institutional attendance policy.',
          remarkRequired: true
        });
      }
    }

    // Resolve Class
    const classQuery = [];
    if (mongoose.isValidObjectId(classIdInput)) {
      classQuery.push({ _id: classIdInput });
    }
    classQuery.push({ classTrackId: classIdInput });
    classQuery.push({ name: classIdInput });

    const cls = await M.Class.findOne({ $or: classQuery }).lean();
    const targetClassId = cls ? (cls.classTrackId || String(cls._id)) : classIdInput;
    const batch = cls ? cls.batch : '2025-2029';
    const year = cls ? parseYearNum(cls.year) : 1;
    const sem = cls ? parseSemNum(cls.sem) : 1;
    const departmentCode = cls ? (cls.deptCode || cls.deptName || 'GEN') : 'GEN';

    // Resolve Subject
    const subjectQuery = [];
    if (mongoose.isValidObjectId(subjectIdInput)) {
      subjectQuery.push({ _id: subjectIdInput });
    }
    subjectQuery.push({ subjectTrackId: subjectIdInput });
    subjectQuery.push({ subjectCode: subjectIdInput });
    subjectQuery.push({ name: subjectIdInput });

    const sub = await M.Subject.findOne({ $or: subjectQuery }).lean();
    const targetSubjectTrackId = sub ? (sub.subjectTrackId || sub.subjectCode || String(sub._id)) : subjectIdInput;

    // Verify teacher assignment to this class and subject (skip for admin)
    const assignCheck = await verifyTeacherAssignment(req.user, targetClassId, targetSubjectTrackId);
    if (!assignCheck.allowed) {
      return res.status(403).json({ error: assignCheck.reason });
    }


    // Resolve Teacher
    const teacherTrackId = req.user.trackId || String(req.user._id);
    const markedBy = req.user.username || req.user.fullName || req.user.name || 'Teacher';

    const referencedInputs = [...new Set(rawRecords.map(rec => rec.studentTrackId || rec.studentId).filter(Boolean))];
    const referencedObjectIds = referencedInputs.filter(id => mongoose.isValidObjectId(id));
    const allStudents = referencedInputs.length
      ? await M.Student.find({
          $or: [
            { trackId: { $in: referencedInputs } },
            ...(referencedObjectIds.length ? [{ _id: { $in: referencedObjectIds } }] : [])
          ]
        }).select('-password').lean()
      : [];
    const studentLookup = new Map();
    allStudents.forEach(s => {
      studentLookup.set(String(s._id), s);
      if (s.trackId) studentLookup.set(s.trackId, s);
    });

    const formattedRecords = [];
    const affectedTrackIds = new Set();

    for (const rec of rawRecords) {
      const sInput = rec.studentTrackId || rec.studentId;
      const stuObj = studentLookup.get(sInput);
      const studentTrackId = stuObj ? (stuObj.trackId || String(stuObj._id)) : sInput;
      const status = normalizeStatus(rec.status);
      if (studentTrackId) {
        formattedRecords.push({ studentTrackId, status });
        affectedTrackIds.add(studentTrackId);
      }
    }

    // Normalize session date to UTC midnight
    const sessionDate = new Date(dateInput + 'T00:00:00.000Z');

    // Find or create ClassAttendance document for this class and date
    let classAttDoc = await M.ClassAttendance.findOne({
      classId: targetClassId,
      date: {
        $gte: new Date(dateInput + 'T00:00:00.000Z'),
        $lte: new Date(dateInput + 'T23:59:59.999Z')
      }
    });

    const periodObj = {
      periodNumber: periodNumInput,
      periodNumbers: [periodNumInput],
      subjectTrackId: targetSubjectTrackId,
      teacherTrackId,
      markedBy,
      markedAt: new Date(),
      topic: String(req.body.topic || '').trim(),
      notes: String(req.body.notes || '').trim(),
      records: formattedRecords
    };

    if (classAttDoc) {
      // Check if period for this subject and period number already exists
      const existingPeriodIdx = classAttDoc.periods.findIndex(p =>
        (p.subjectTrackId === targetSubjectTrackId || String(p.subjectTrackId) === String(targetSubjectTrackId)) &&
        (Number(p.periodNumber) === periodNumInput || (Array.isArray(p.periodNumbers) && p.periodNumbers.includes(periodNumInput)))
      );

      if (existingPeriodIdx !== -1) {
        // Verify attendance edit permissions
        if (req.user.role !== 'admin' && attSettings.allowAttendanceEdit === false) {
          return res.status(403).json({
            error: 'Modifying previously saved attendance is locked by administrator.',
            editLocked: true
          });
        }

        // Verify auto-lock threshold for finalized attendance
        const autoLockHours = Number(attSettings.autoLockAttendanceHours) || 0;
        if (req.user.role !== 'admin' && autoLockHours > 0) {
          const existingPeriod = classAttDoc.periods[existingPeriodIdx];
          const markedAtTime = existingPeriod.markedAt ? new Date(existingPeriod.markedAt).getTime() : new Date(classAttDoc.createdAt).getTime();
          const ageHours = (Date.now() - markedAtTime) / (1000 * 60 * 60);
          if (ageHours > autoLockHours) {
            return res.status(403).json({
              error: `This attendance record was finalized and auto-locked after ${autoLockHours} hours.`,
              autoLocked: true
            });
          }
        }

        classAttDoc.periods[existingPeriodIdx] = periodObj;
      } else {
        classAttDoc.periods.push(periodObj);
      }
      classAttDoc.updatedAt = new Date();
      await classAttDoc.save();
    } else {
      classAttDoc = await M.ClassAttendance.create({
        batch,
        year,
        sem,
        classId: targetClassId,
        departmentCode,
        date: sessionDate,
        periods: [periodObj],
        isFinalized: false
      });
    }

    // Sync student counters asynchronously
    for (const stTrackId of affectedTrackIds) {
      await syncStudentAttendanceCounters(stTrackId, targetClassId);
    }

    // Consolidated Daily Class Attendance Logging (1 log per class per day, appended with period changes & student reg numbers)
    try {
      // Determine capture method
      let captureMethod = 'Manual';
      if (req.body.quickPassSessionId) captureMethod = 'QuickPass Code';
      else if (req.body.scanLiveSessionId) captureMethod = 'Live QR';
      else if (req.body.repShareSessionId) captureMethod = 'Rep Share';
      else if (req.body.method && typeof req.body.method === 'string') captureMethod = req.body.method;

      const teacherName = (req.user.firstName && req.user.lastName)
        ? `${req.user.firstName} ${req.user.lastName}`.trim()
        : (req.user.fullName || req.user.name || req.user.username || 'Teacher');
      const teacherSessionId = req.user.sessionId || (req.session && req.session.sessionId) || '';
      const teacherTrackId = req.user.trackId || String(req.user._id);

      // Build student records with register numbers
      const periodStudentRecords = [];
      let presentCount = 0;
      let absentCount = 0;
      let odCount = 0;

      for (const rec of formattedRecords) {
        const sObj = studentLookup.get(rec.studentTrackId);
        const regNo = sObj?.registerNo || sObj?.regNo || rec.studentTrackId;
        const sName = sObj?.fullName || sObj?.name || rec.studentTrackId;
        const status = rec.status || 'P';

        if (status === 'P' || status === 'PRESENT') presentCount++;
        else if (status === 'OD' || status === 'ON DUTY') odCount++;
        else absentCount++;

        periodStudentRecords.push({
          studentTrackId: rec.studentTrackId,
          regNo,
          name: sName,
          status
        });
      }

      const periodStats = {
        total: formattedRecords.length,
        present: presentCount,
        absent: absentCount,
        od: odCount
      };

      const periodLogObj = {
        periodNumber: periodNumInput,
        subjectTrackId: targetSubjectTrackId,
        subjectName: (sub && sub.name) ? `${sub.name} (${targetSubjectTrackId})` : targetSubjectTrackId,
        teacherTrackId,
        teacherName,
        teacherSessionId,
        method: captureMethod,
        topic: req.body.topic || req.body.remarks || '',
        markedAt: new Date(),
        stats: periodStats,
        records: periodStudentRecords,
        history: [{
          action: 'Initial Marking',
          teacherTrackId,
          teacherName,
          teacherSessionId,
          method: captureMethod,
          changedAt: new Date(),
          summary: `Marked ${presentCount}/${formattedRecords.length} Present via ${captureMethod}`
        }]
      };

      const dateStr = dateInput;
      const className = cls ? (cls.name || cls.classTrackId || targetClassId) : targetClassId;

      const existingDailyClassLog = await M.Log.findOne({
        category: 'attendance',
        subType: 'attendance',
        'attendanceClassDaily.classId': String(targetClassId),
        'attendanceClassDaily.date': dateStr
      });

      if (existingDailyClassLog && existingDailyClassLog.attendanceClassDaily) {
        const periods = existingDailyClassLog.attendanceClassDaily.periods || [];
        const existingPIdx = periods.findIndex(p => p.periodNumber === periodNumInput);

        if (existingPIdx >= 0) {
          // Existing period updated: calculate changes
          const oldPeriod = periods[existingPIdx];
          const oldRecords = oldPeriod.records || [];
          const changesSummary = [];

          periodStudentRecords.forEach(newRec => {
            const oldRec = oldRecords.find(o => o.studentTrackId === newRec.studentTrackId);
            if (oldRec && oldRec.status !== newRec.status) {
              changesSummary.push(`${newRec.regNo} (${oldRec.status} -> ${newRec.status})`);
            }
          });

          const updateSummary = changesSummary.length > 0
            ? `Updated ${changesSummary.length} student(s): ${changesSummary.slice(0, 5).join(', ')}${changesSummary.length > 5 ? '…' : ''}`
            : `Re-saved period by ${teacherName} (${presentCount}/${formattedRecords.length} Present)`;

          const updatedHistory = (oldPeriod.history || []).concat([{
            action: 'Updated',
            teacherTrackId,
            teacherName,
            teacherSessionId,
            method: captureMethod,
            changedAt: new Date(),
            summary: updateSummary
          }]);

          periodLogObj.history = updatedHistory;
          periods[existingPIdx] = periodLogObj;
        } else {
          periods.push(periodLogObj);
          periods.sort((a, b) => a.periodNumber - b.periodNumber);
        }

        existingDailyClassLog.attendanceClassDaily.periods = periods;
        existingDailyClassLog.time = new Date();
        existingDailyClassLog.sessionId = teacherSessionId;
        existingDailyClassLog.userName = teacherName;
        existingDailyClassLog.role = req.user.role || 'teacher';
        existingDailyClassLog.details = `Class ${className} attendance updated on ${dateStr}. Period ${periodNumInput} marked via ${captureMethod} by ${teacherName} (${presentCount}/${formattedRecords.length} Present). Session: ${teacherSessionId}`;
        await existingDailyClassLog.save();
      } else {
        // Create brand new daily class attendance log
        await logAction(
          teacherTrackId,
          teacherName,
          req.user.role || 'teacher',
          'Class Attendance Marked',
          `Class ${className} on ${dateStr} - Period ${periodNumInput} marked via ${captureMethod} by ${teacherName} (${presentCount}/${formattedRecords.length} Present). Session: ${teacherSessionId}`,
          'attendance',
          'info',
          req.ip,
          teacherSessionId,
          {
            module: 'teacher',
            subType: 'attendance',
            trackId: teacherTrackId,
            actingWithAdminRights: req.user.actingWithAdminRights,
            attendanceClassDaily: {
              classId: String(targetClassId),
              className: className,
              date: dateStr,
              periods: [periodLogObj]
            },
            req
          }
        );
      }
    } catch (attLogErr) {
      console.error('[Class Daily Attendance Log Error]:', attLogErr.message);
    }

    // Update draft sessions to final saved status if associated
    try {
      if (req.body.quickPassSessionId) {
        await M.QuickPassSession.updateOne(
          { $or: [{ _id: req.body.quickPassSessionId }, { sessionTrackId: req.body.quickPassSessionId }] },
          { isFinalSaved: true }
        );
      }
      if (req.body.scanLiveSessionId) {
        await M.ScanLiveSession.updateOne(
          { $or: [{ _id: req.body.scanLiveSessionId }, { sessionTrackId: req.body.scanLiveSessionId }] },
          { isFinalSaved: true }
        );
      }
      if (req.body.repShareSessionId) {
        await M.RepShareSession.updateOne(
          { $or: [{ _id: req.body.repShareSessionId }, { sessionTrackId: req.body.repShareSessionId }] },
          { isFinalSaved: true, status: 'finalized' }
        );
      }
    } catch (sessionFinalErr) {
      console.warn('Error marking draft session finalized:', sessionFinalErr.message);
    }

    res.status(201).json({ ok: true, classAttendanceId: classAttDoc._id, savedCount: formattedRecords.length });
  } catch (err) {
    console.error('Error saving attendance:', err);
    res.status(400).json({ error: err.message });
  }
});

// Bulk delete all attendance (admin only)
router.delete('/all', attendanceClearLimiter, authMiddleware, adminOnly, async (req, res) => {
  try {
    const res1 = await M.ClassAttendance.deleteMany({});
    const res2 = await M.StudentAttendance.deleteMany({});
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Attendance Cleared',
      `Deleted ${res1.deletedCount} class sessions`,
      'attendance',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'teacher', subType: 'attendance' }
    );
    res.json({ deleted: res1.deletedCount + res2.deletedCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete attendance records within a date range (inclusive)
router.delete('/clear', attendanceClearLimiter, authMiddleware, adminOnly, async (req, res) => {
  try {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });
    const start = new Date(from);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    const filter = { date: { $gte: start, $lte: end } };
    const res1 = await M.ClassAttendance.deleteMany(filter);
    const res2 = await M.StudentAttendance.deleteMany(filter);
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Attendance Cleared (Range)',
      `Deleted ${res1.deletedCount} class sessions from ${from} to ${to}`,
      'attendance',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'teacher', subType: 'attendance' }
    );
    res.json({ deleted: res1.deletedCount + res2.deletedCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete single session/record
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await M.ClassAttendance.findByIdAndDelete(req.params.id);
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/unmarked-teachers', authMiddleware, adminOnly, async (req, res) => {
  try {
    const today = new Date(), monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const weekDates = Array.from({ length: 5 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d.toISOString().split('T')[0]; });
    const assignments = await M.Assignment.find().lean();
    const classAttDocs = await M.ClassAttendance.find().lean();

    const unmarked = [];
    for (const a of assignments) {
      const markedDates = [];
      for (const doc of classAttDocs) {
        const docDateStr = doc.date ? new Date(doc.date).toISOString().split('T')[0] : '';
        if (doc.classId === a.classId || doc.classId === a.classTrackId) {
          for (const p of doc.periods || []) {
            if (p.teacherTrackId === a.teacherId || p.teacherTrackId === a.teacherTrackId) {
              markedDates.push(docDateStr);
            }
          }
        }
      }
      const missingDays = weekDates.filter(d => !markedDates.includes(d));
      if (missingDays.length > 0) unmarked.push({ ...a, missingDays, missingCount: missingDays.length });
    }
    res.json(unmarked);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;