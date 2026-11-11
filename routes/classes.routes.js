const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware, requirePage, scopeFilter, assertInScope } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const countService = require('../services/countService');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { normalizeYearRange } = require('../utils/yearFormat');

router.get('/', authMiddleware, async (req, res) => {
  try {
    const filter = {};
    if (req.query.deptId) filter.deptId = sanitizeToString(req.query.deptId);
    if (req.query.batch) {
      const b = sanitizeToString(req.query.batch);
      const normB = normalizeYearRange(b);
      const altB = normB.includes('-') && normB.length === 9
        ? normB.replace(/-(\d{4})$/, function (_, y) { return '-' + y.slice(-2); })
        : normB;
      filter.batch = { $in: [normB, b, altB].filter(Boolean) };
    }
    const classes = await M.Class.find(filter)
      .populate({
        path: 'roomId',
        populate: { path: 'buildingId' }
      })
      .sort({ name: 1 })
      .lean();
    // Attach studentCount per class via aggregate to avoid client-side full scan
    const classIds = classes.map(function (c) { return c._id; });
    const counts = classIds.length
      ? await M.Student.aggregate([
          { $match: { classId: { $in: classIds } } },
          { $group: { _id: '$classId', count: { $sum: 1 } } }
        ])
      : [];
    const countMap = {};
    counts.forEach(function (c) { countMap[String(c._id)] = c.count; });
    classes.forEach(function (cls) {
      if (!cls.section && cls.name) {
        const m = cls.name.match(/(?:SEC\s*|[- ])([A-Za-z0-9]{1,3})$/i);
        if (m) cls.section = m[1].toUpperCase();
      }
      cls.studentCount = countMap[String(cls._id)] || 0;
    });

    // Populate board on roomId so class views immediately know the linked smart board
    const roomIds = classes.map(function (c) { return c.roomId && (c.roomId._id || c.roomId); }).filter(Boolean);
    if (roomIds.length) {
      const boards = await M.SmartBoard.find({ roomId: { $in: roomIds }, status: { $ne: 'Inactive' } }).lean();
      const boardMap = new Map();
      boards.forEach(function (b) { boardMap.set(String(b.roomId), b); });
      classes.forEach(function (cls) {
        if (cls.roomId && typeof cls.roomId === 'object') {
          cls.roomId.board = boardMap.get(String(cls.roomId._id)) || null;
        }
      });
    }

    // Enrich class representatives with live student details and repTrackId
    await enrichClassRepresentatives(classes);

    res.json(classes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function enrichClassRepresentatives(classes) {
  if (!Array.isArray(classes) || classes.length === 0) return;
  const allRepTrackIds = new Set();
  const allRepObjectIds = new Set();

  classes.forEach(function (cls) {
    if (cls.repTrackId) allRepTrackIds.add(String(cls.repTrackId).trim());
    if (Array.isArray(cls.repTrackIds)) {
      cls.repTrackIds.forEach(id => id && allRepTrackIds.add(String(id).trim()));
    }
    if (cls.rep1TrackId) allRepTrackIds.add(String(cls.rep1TrackId).trim());
    if (cls.rep2TrackId) allRepTrackIds.add(String(cls.rep2TrackId).trim());
    if (cls.representative1TrackId) allRepTrackIds.add(String(cls.representative1TrackId).trim());
    if (cls.representative2TrackId) allRepTrackIds.add(String(cls.representative2TrackId).trim());

    if (cls.representative1Id && mongoose.isValidObjectId(cls.representative1Id)) {
      allRepObjectIds.add(String(cls.representative1Id));
    }
    if (cls.representative2Id && mongoose.isValidObjectId(cls.representative2Id)) {
      allRepObjectIds.add(String(cls.representative2Id));
    }
    if (Array.isArray(cls.classRepresentatives)) {
      cls.classRepresentatives.forEach(r => {
        if (r && r.studentTrackId) allRepTrackIds.add(String(r.studentTrackId).trim());
        if (r && r.studentId && mongoose.isValidObjectId(r.studentId)) allRepObjectIds.add(String(r.studentId));
      });
    }
  });

  const repTrackIdList = Array.from(allRepTrackIds).filter(Boolean);
  const repObjectIdList = Array.from(allRepObjectIds).filter(id => mongoose.isValidObjectId(id)).map(id => new mongoose.Types.ObjectId(id));

  let repStudents = [];
  if (repTrackIdList.length > 0 || repObjectIdList.length > 0) {
    const orClauses = [];
    if (repTrackIdList.length > 0) orClauses.push({ trackId: { $in: repTrackIdList } });
    if (repObjectIdList.length > 0) orClauses.push({ _id: { $in: repObjectIdList } });
    repStudents = await M.Student.find({ $or: orClauses }).lean();
  }

  const studentByTrackId = new Map();
  const studentById = new Map();
  repStudents.forEach(s => {
    if (s.trackId) studentByTrackId.set(String(s.trackId), s);
    studentById.set(String(s._id), s);
  });

  classes.forEach(function (cls) {
    const reps = [];
    const seenIds = new Set();

    const addRep = (s, isPrimary) => {
      if (!s) return;
      const idKey = String(s._id || s.trackId);
      if (seenIds.has(idKey)) return;
      seenIds.add(idKey);
      reps.push({
        studentId: s._id,
        studentTrackId: s.trackId || '',
        studentName: s.fullName || s.name || '',
        registerNo: s.registerNo || '',
        rollNo: s.rollNo || '',
        email: s.email || '',
        phone: s.phone || '',
        avatar: s.avatar || '',
        isPrimary: Boolean(isPrimary)
      });
    };

    if (Array.isArray(cls.classRepresentatives) && cls.classRepresentatives.length > 0) {
      cls.classRepresentatives.forEach((r, idx) => {
        const s = (r.studentTrackId && studentByTrackId.get(String(r.studentTrackId))) ||
                  (r.studentId && studentById.get(String(r.studentId)));
        if (s) {
          addRep(s, idx === 0 || r.isPrimary);
        } else if (r.studentName) {
          reps.push(r);
        }
      });
    }

    const rep1Target = cls.repTrackId || cls.rep1TrackId || cls.representative1TrackId || cls.representative1Id;
    if (rep1Target) {
      const s1 = studentByTrackId.get(String(rep1Target)) || studentById.get(String(rep1Target));
      if (s1) addRep(s1, true);
    }

    const rep2Target = cls.rep2TrackId || cls.representative2TrackId || cls.representative2Id;
    if (rep2Target) {
      const s2 = studentByTrackId.get(String(rep2Target)) || studentById.get(String(rep2Target));
      if (s2) addRep(s2, false);
    }

    if (reps.length > 0) {
      cls.classRepresentatives = reps;
      cls.repTrackId = reps[0].studentTrackId || cls.repTrackId || '';
      cls.repTrackIds = reps.map(r => r.studentTrackId).filter(Boolean);
      cls.rep1TrackId = reps[0].studentTrackId || cls.rep1TrackId || '';
      cls.representative1Id = reps[0].studentId || cls.representative1Id || null;
      cls.representative1Name = reps[0].studentName || cls.representative1Name || '';
      cls.representative1TrackId = reps[0].studentTrackId || cls.representative1TrackId || '';
      cls.representative1RegisterNo = reps[0].registerNo || cls.representative1RegisterNo || '';
      if (reps[1]) {
        cls.rep2TrackId = reps[1].studentTrackId || cls.rep2TrackId || '';
        cls.representative2Id = reps[1].studentId || cls.representative2Id || null;
        cls.representative2Name = reps[1].studentName || cls.representative2Name || '';
        cls.representative2TrackId = reps[1].studentTrackId || cls.representative2TrackId || '';
        cls.representative2RegisterNo = reps[1].registerNo || cls.representative2RegisterNo || '';
      }
    } else {
      cls.repTrackId = cls.repTrackId || '';
      cls.repTrackIds = Array.isArray(cls.repTrackIds) ? cls.repTrackIds : [];
      cls.rep1TrackId = cls.rep1TrackId || '';
      cls.rep2TrackId = cls.rep2TrackId || '';
    }
  });
}

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const classId = req.params.id;
    let cls = null;
    if (mongoose.isValidObjectId(classId)) {
      cls = await M.Class.findById(classId)
        .populate({ path: 'roomId', populate: { path: 'buildingId' } })
        .lean();
    }
    if (!cls) {
      cls = await M.Class.findOne({ $or: [{ trackId: classId }, { classTrackId: classId }] })
        .populate({ path: 'roomId', populate: { path: 'buildingId' } })
        .lean();
    }
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    if (!cls.section && cls.name) {
      const m = cls.name.match(/(?:SEC\s*|[- ])([A-Za-z0-9]{1,3})$/i);
      if (m) cls.section = m[1].toUpperCase();
    }
    cls.studentCount = await M.Student.countDocuments({ classId: cls._id }).catch(() => 0);

    await enrichClassRepresentatives([cls]);
    if (cls.roomId) {
      const board = await M.SmartBoard.findOne({ roomId: cls.roomId._id, status: { $ne: 'Inactive' } }).lean();
      if (board) cls.roomId.board = board;
    }
    res.json(cls);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const allowedClassFields = [
  'name', 'deptId', 'deptName', 'deptCode', 'year', 'batch',
  'section', 'sem', 'roomId', 'hallNo', 'advisorTeacherId',
  'advisorTeacherName', 'advisorTeacherTrackId',
  'secondaryAdvisorTeacherId', 'secondaryAdvisorTeacherName',
  'secondaryAdvisorTeacherTrackId',
  'classRepresentatives',
  'repTrackId', 'repTrackIds', 'rep1TrackId', 'rep2TrackId',
  'representative1Id', 'representative1Name', 'representative1TrackId', 'representative1RegisterNo',
  'representative2Id', 'representative2Name', 'representative2TrackId', 'representative2RegisterNo'
];

router.post('/', authMiddleware, requirePage('admin', 'create', { tab: 'struct' }), async (req, res) => {
  try {
    if (req.scope && req.scope.type === 'department' && req.scope.deptId) {
      req.body.deptId = req.scope.deptId;
    }
    const safeData = {};
    for (const f of allowedClassFields) {
      if (req.body[f] !== undefined) safeData[f] = req.body[f];
    }
    if (!safeData.roomId || safeData.roomId === '' || safeData.roomId === 'null') {
      safeData.roomId = null;
    }
    if (safeData.roomId && !safeData.hallNo) {
      const rm = await M.Room.findById(safeData.roomId).lean();
      if (rm) safeData.hallNo = rm.hallNo;
    }
    if (safeData.batch) safeData.batch = normalizeYearRange(safeData.batch);
    if (!safeData.section && safeData.name) {
      const m = safeData.name.match(/(?:SEC\s*|[- ])([A-Za-z0-9]{1,3})$/i);
      if (m) safeData.section = m[1].toUpperCase();
    }
    let cls = await M.Class.create(safeData);
    await countService.modifyCount('classes', 1).catch(() => {});
    if (cls.roomId) {
      cls = await M.Class.findById(cls._id).populate({ path: 'roomId', populate: { path: 'buildingId' } });
      const board = await M.SmartBoard.findOne({ roomId: cls.roomId._id, status: { $ne: 'Inactive' } }).lean();
      if (board && cls.roomId) cls.roomId.board = board;
      try {
        const { pushContextToRoomBoards } = require('../services/board.socket');
        pushContextToRoomBoards(cls.roomId._id).catch(() => {});
      } catch (e) {}
    }
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Class Added',
      `${cls.name} (Batch ${cls.batch || ''})`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'entry-create',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: null, after: cls.toObject ? cls.toObject() : cls }
      }
    );
    res.status(201).json(cls);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', authMiddleware, requirePage('admin', 'edit', { tab: 'struct' }), async (req, res) => {
  try {
    const before = await M.Class.findById(req.params.id).lean();
    if (before && !assertInScope(req, before.deptId)) {
      return res.status(403).json({ error: 'Access denied: class is outside your department scope' });
    }
    const safeUpdate = {};
    for (const f of allowedClassFields) {
      if (req.body[f] !== undefined) safeUpdate[f] = req.body[f];
    }
    if (safeUpdate.roomId !== undefined && (!safeUpdate.roomId || safeUpdate.roomId === '' || safeUpdate.roomId === 'null')) {
      safeUpdate.roomId = null;
    }
    if (safeUpdate.roomId && !safeUpdate.hallNo) {
      const rm = await M.Room.findById(safeUpdate.roomId).lean();
      if (rm) safeUpdate.hallNo = rm.hallNo;
    }
    if (safeUpdate.batch) safeUpdate.batch = normalizeYearRange(safeUpdate.batch);
    if (!safeUpdate.section && safeUpdate.name) {
      const m = safeUpdate.name.match(/(?:SEC\s*|[- ])([A-Za-z0-9]{1,3})$/i);
      if (m) safeUpdate.section = m[1].toUpperCase();
    }
    if (safeUpdate.representative1Id !== undefined || safeUpdate.representative2Id !== undefined || safeUpdate.classRepresentatives !== undefined || safeUpdate.repTrackId !== undefined) {
      const rep1 = safeUpdate.representative1Id;
      const rep2 = safeUpdate.representative2Id;
      const repIds = [rep1, rep2].filter(Boolean);
      const selectedObjIds = repIds.filter(id => mongoose.isValidObjectId(id));
      if (selectedObjIds.length > 0) {
        const foundStudents = await M.Student.find({ _id: { $in: selectedObjIds } }).lean();
        const s1 = foundStudents.find(s => String(s._id) === String(rep1));
        const s2 = foundStudents.find(s => String(s._id) === String(rep2));
        const repArray = [];
        if (s1) {
          repArray.push({
            studentId: s1._id,
            studentTrackId: s1.trackId || '',
            studentName: s1.fullName || s1.name || '',
            registerNo: s1.registerNo || '',
            rollNo: s1.rollNo || '',
            isPrimary: true
          });
          safeUpdate.representative1Name = s1.fullName || s1.name || '';
          safeUpdate.representative1TrackId = s1.trackId || '';
          safeUpdate.representative1RegisterNo = s1.registerNo || '';
          safeUpdate.repTrackId = s1.trackId || '';
          safeUpdate.rep1TrackId = s1.trackId || '';
        }
        if (s2) {
          repArray.push({
            studentId: s2._id,
            studentTrackId: s2.trackId || '',
            studentName: s2.fullName || s2.name || '',
            registerNo: s2.registerNo || '',
            rollNo: s2.rollNo || '',
            isPrimary: false
          });
          safeUpdate.representative2Name = s2.fullName || s2.name || '';
          safeUpdate.representative2TrackId = s2.trackId || '';
          safeUpdate.representative2RegisterNo = s2.registerNo || '';
          safeUpdate.rep2TrackId = s2.trackId || '';
        }
        safeUpdate.repTrackIds = repArray.map(r => r.studentTrackId).filter(Boolean);
        if (repArray.length > 0) {
          safeUpdate.classRepresentatives = repArray;
        }

        await M.Student.updateMany(
          { classId: req.params.id, _id: { $nin: selectedObjIds } },
          { $set: { isRep: false } }
        );
        await M.Student.updateMany(
          { _id: { $in: selectedObjIds } },
          { $set: { isRep: true } }
        );
      }
    }
    const cls = await M.Class.findByIdAndUpdate(req.params.id, safeUpdate, { returnDocument: 'after' })
      .populate({ path: 'roomId', populate: { path: 'buildingId' } })
      .lean();
    if (cls && cls.roomId) {
      const board = await M.SmartBoard.findOne({ roomId: cls.roomId._id, status: { $ne: 'Inactive' } }).lean();
      if (board) cls.roomId.board = board;
      try {
        const { pushContextToRoomBoards } = require('../services/board.socket');
        pushContextToRoomBoards(cls.roomId._id).catch(() => {});
      } catch (e) {}
    }
    if (before && before.roomId && (!cls?.roomId || String(before.roomId) !== String(cls.roomId._id || cls.roomId))) {
      try {
        const { pushContextToRoomBoards } = require('../services/board.socket');
        pushContextToRoomBoards(before.roomId).catch(() => {});
      } catch (e) {}
    }
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Class Updated',
      cls?.name || '',
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before, after: cls }
      }
    );
    res.json(cls);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/advisor', authMiddleware, requirePage('admin', 'assign', { tab: 'roles' }), async (req, res) => {
  try {
    const classId = req.params.id;
    const { teacherId } = req.body;

    const cls = await M.Class.findById(classId);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const classTrackId = cls.trackId || String(cls._id);
    const className = cls.name;
    const prevAdvisorName = cls.advisorTeacherName || 'None';

    // 1. Remove Class Advisor specials from any teacher currently assigned to this class
    const prevTeachers = await M.Teacher.find({
      $or: [
        { 'specials.key': className },
        { 'specials.key': classTrackId },
        { 'specials.value': className },
        { 'specials.value': classTrackId },
        ...(cls.advisorTeacherId ? [{ _id: cls.advisorTeacherId }] : [])
      ]
    });

    for (const pt of prevTeachers) {
      if (Array.isArray(pt.specials)) {
        pt.specials = pt.specials.filter(s => {
          if (s.option === 'isClassAdvisor') {
            if (s.key === className || s.key === classTrackId || s.value === className || s.value === classTrackId || (cls.advisorTeacherId && String(pt._id) === String(cls.advisorTeacherId))) {
              return false;
            }
          }
          return true;
        });
        await pt.save();
      }
    }

    let assignedTeacher = null;

    if (teacherId) {
      if (mongoose.isValidObjectId(teacherId)) {
        assignedTeacher = await M.Teacher.findById(teacherId);
      }
      if (!assignedTeacher) {
        assignedTeacher = await M.Teacher.findOne({ trackId: teacherId });
      }
      if (!assignedTeacher) {
        const shadow = await M.User.findById(teacherId);
        if (shadow && shadow.trackId) {
          assignedTeacher = await M.Teacher.findOne({ trackId: shadow.trackId });
        }
      }
      if (!assignedTeacher) return res.status(404).json({ error: 'Teacher not found' });

      cls.advisorTeacherId = assignedTeacher._id;
      cls.advisorTeacherName = assignedTeacher.fullName;
      cls.advisorTeacherTrackId = assignedTeacher.trackId || '';
      await cls.save();

      if (!Array.isArray(assignedTeacher.specials)) assignedTeacher.specials = [];

      assignedTeacher.specials = assignedTeacher.specials.filter(s =>
        !(s.option === 'isClassAdvisor' && (s.key === className || s.key === classTrackId))
      );

      assignedTeacher.specials.push({
        option: 'isClassAdvisor',
        key: className,
        value: true
      });

      await assignedTeacher.save();

      await logAction(
        req.user.trackId || req.user._id,
        req.user.name,
        req.user.role,
        'Class Advisor Assigned',
        `Assigned ${assignedTeacher.fullName} as Class Advisor for ${cls.name}`,
        'data',
        'info',
        req.ip,
        req.user.sessionId,
        {
          module: 'admin',
          subType: 'field-edit',
          trackId: req.user.trackId,
          actingWithAdminRights: req.user.actingWithAdminRights,
          changes: {
            before: { advisor: prevAdvisorName },
            after: { advisor: assignedTeacher.fullName }
          }
        }
      );
    } else {
      cls.advisorTeacherId = null;
      cls.advisorTeacherName = '';
      cls.advisorTeacherTrackId = '';
      await cls.save();

      await logAction(
        req.user.trackId || req.user._id,
        req.user.name,
        req.user.role,
        'Class Advisor Removed',
        `Removed Class Advisor from ${cls.name}`,
        'data',
        'info',
        req.ip,
        req.user.sessionId,
        {
          module: 'admin',
          subType: 'field-edit',
          trackId: req.user.trackId,
          actingWithAdminRights: req.user.actingWithAdminRights,
          changes: {
            before: { advisor: prevAdvisorName },
            after: { advisor: 'None' }
          }
        }
      );
    }

    res.json({
      success: true,
      class: cls,
      advisor: assignedTeacher ? {
        _id: assignedTeacher._id,
        name: assignedTeacher.fullName,
        trackId: assignedTeacher.trackId
      } : null
    });
  } catch (err) {
    console.error('Assign class advisor error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/representatives', authMiddleware, async (req, res, next) => {
  if (req.user && (req.user.role === 'sudo' || req.user.role === 'admin' || req.user.isSuperAdmin)) {
    return next();
  }
  const structGuard = requirePage('admin', 'edit', { tab: 'struct' });
  const rolesGuard = requirePage('admin', 'assign', { tab: 'roles' });
  structGuard(req, res, (err) => {
    if (!err && !res.headersSent) return next();
    rolesGuard(req, res, next);
  });
}, async (req, res) => {
  try {
    const classId = req.params.id;
    let cls = null;
    if (mongoose.isValidObjectId(classId)) {
      cls = await M.Class.findById(classId);
    }
    if (!cls) {
      cls = await M.Class.findOne({ $or: [{ trackId: classId }, { classTrackId: classId }] });
    }
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    if (!assertInScope(req, cls.deptId)) {
      return res.status(403).json({ error: 'Access denied: class is outside your department scope' });
    }

    // Extract representative IDs from rep1Id/rep2Id or representativeIds array
    let repIds = [];
    if (Array.isArray(req.body.representativeIds)) {
      repIds = req.body.representativeIds.filter(Boolean);
    } else {
      if (req.body.rep1Id) repIds.push(req.body.rep1Id);
      if (req.body.rep2Id) repIds.push(req.body.rep2Id);
    }

    // Validation 1: At least 1 representative is required
    if (!repIds.length || !repIds[0]) {
      return res.status(400).json({ error: 'At least 1 class representative is required.' });
    }

    // Validation 2: Maximum 2 representatives allowed per class
    if (repIds.length > 2) {
      return res.status(400).json({ error: 'Maximum 2 class representatives allowed per class.' });
    }

    // Validation 3: Cannot select the same student twice
    if (repIds.length === 2 && String(repIds[0]) === String(repIds[1])) {
      return res.status(400).json({ error: 'Representative 1 and Representative 2 must be different students.' });
    }

    // Query selected students
    const validObjIds = repIds.filter(id => mongoose.isValidObjectId(id));
    const foundStudents = await M.Student.find({
      $or: [
        { _id: { $in: validObjIds } },
        { trackId: { $in: repIds } }
      ]
    });

    if (foundStudents.length < repIds.length) {
      return res.status(404).json({ error: 'One or more selected students could not be found.' });
    }

    // Verify all selected students belong to this class
    const classMatch = foundStudents.every(s => 
      (s.classId && String(s.classId) === String(cls._id)) ||
      (s.class && s.class.toLowerCase() === cls.name.toLowerCase())
    );
    if (!classMatch) {
      return res.status(400).json({ error: 'Selected representatives must be enrolled in this class.' });
    }

    // Order students matching repIds order (primary first)
    const orderedStudents = repIds.map(id => 
      foundStudents.find(s => String(s._id) === String(id) || String(s.trackId) === String(id))
    ).filter(Boolean);

    const prevReps = (cls.classRepresentatives || []).map(r => r.studentName).join(', ') || 'None';

    const repArray = orderedStudents.map((s, idx) => ({
      studentId: s._id,
      studentTrackId: s.trackId || '',
      studentName: s.fullName || s.name || '',
      registerNo: s.registerNo || '',
      rollNo: s.rollNo || '',
      isPrimary: idx === 0
    }));

    cls.classRepresentatives = repArray;
    cls.repTrackId = repArray[0]?.studentTrackId || '';
    cls.repTrackIds = repArray.map(r => r.studentTrackId).filter(Boolean);
    cls.rep1TrackId = repArray[0]?.studentTrackId || '';
    cls.representative1Id = repArray[0]?.studentId || null;
    cls.representative1Name = repArray[0]?.studentName || '';
    cls.representative1TrackId = repArray[0]?.studentTrackId || '';
    cls.representative1RegisterNo = repArray[0]?.registerNo || '';
    cls.representative2Id = repArray[1]?.studentId || null;
    cls.representative2Name = repArray[1]?.studentName || '';
    cls.representative2TrackId = repArray[1]?.studentTrackId || '';
    cls.rep2TrackId = repArray[1]?.studentTrackId || '';
    cls.representative2RegisterNo = repArray[1]?.registerNo || '';
    await cls.save();

    // Synchronize M.Student.isRep for all students in this class
    const selectedObjIds = orderedStudents.map(s => s._id);
    await M.Student.updateMany(
      { classId: cls._id, _id: { $nin: selectedObjIds } },
      { $set: { isRep: false } }
    );
    await M.Student.updateMany(
      { _id: { $in: selectedObjIds } },
      { $set: { isRep: true } }
    );

    const newReps = repArray.map(r => `${r.studentName} (${r.registerNo || 'No Reg'})`).join(', ');

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Class Representatives Assigned',
      `Assigned ${newReps} as Class Representatives for ${cls.name}`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: {
          before: { representatives: prevReps },
          after: { representatives: newReps }
        }
      }
    );

    res.json({
      ok: true,
      success: true,
      class: cls,
      representatives: repArray
    });
  } catch (err) {
    console.error('Assign class representatives error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authMiddleware, requirePage('admin', 'delete', { tab: 'struct' }), async (req, res) => {
  try {
    const cls = await M.Class.findById(req.params.id).lean();
    if (cls) {
      if (!assertInScope(req, cls.deptId)) {
        return res.status(403).json({ error: 'Access denied: class is outside your department scope' });
      }
      await M.UndoLog.create({
        collectionName: 'classes', label: `Class: ${cls.name}`,
        snapshot: cls, deletedBy: req.user.name, expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      });
      await M.Class.findByIdAndDelete(req.params.id);
      await countService.modifyCount('classes', -1).catch(() => {});
    }
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Class Deleted',
      cls?.name || '',
      'data',
      'warning',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'entry-delete',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights,
        changes: { before: cls, after: null }
      }
    );
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;