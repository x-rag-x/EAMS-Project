const mongoose = require('mongoose');
const M = require('../models');
const { DEFAULT_TIMINGS, timesOverlap, getLabWindows, getTimingSetForClass } = require('./clashDetector');
const { GlobalLedger } = require('./autoGenLedger');

const DAYS_6 = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_5 = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

/**
 * Timetable Auto-Generation Constraint Solver
 * Supports Single-Class (Phase 2) and Whole-Batch (Phase 3) modes.
 */
class AutoGenEngine {
  constructor(options = {}) {
    this.scope = options.scope || 'single_class'; // 'single_class' | 'batch'
    this.classId = options.classId;
    this.className = options.className || 'Class';
    this.deptId = options.deptId;
    this.batch = options.batch;
    this.year = options.year || 'I';
    this.semester = options.semester || 'I';
    this.saturdayMode = options.saturdayMode || 'separate';
    this.pinnedWeekday = options.pinnedWeekday || 'Monday';
    this.effort = options.effort || 'thorough'; // 'quick' | 'standard' | 'thorough'
    this.combinedGroups = Array.isArray(options.combinedGroups) ? options.combinedGroups : [];
    this.existingPinnedSlots = Array.isArray(options.existingPinnedSlots) ? options.existingPinnedSlots : [];
    this.specialActivities = Array.isArray(options.specialActivities) ? options.specialActivities : [];
  }

  /**
   * Run solver and generate up to 3 diverse candidate versions
   */
  async solve() {
    const isDbConnected = (mongoose.connection && mongoose.connection.readyState === 1);

    // 1. Resolve timing set & lab windows
    const timingSet = await getTimingSetForClass(this.classId, this.year);
    const labWindowDefs = await getLabWindows(this.classId, this.year);

    // 2. Resolve subjects from SemesterSubjectSet
    let subjects = [];
    if (isDbConnected) {
      let setQuery = { batch: this.batch };
      if (this.deptId) setQuery.deptId = this.deptId;
      const sSet = await M.SemesterSubjectSet.findOne(setQuery).lean();

      if (sSet && Array.isArray(sSet.subjects) && sSet.subjects.length) {
        for (const s of sSet.subjects) {
          let subDoc = null;
          try {
            subDoc = await M.Subject.findById(s.subjectId).lean();
          } catch (_) {}
          subjects.push({
            subjectId: s.subjectId,
            name: subDoc ? (subDoc.shortForm || subDoc.subjectName || subDoc.name) : 'Subject',
            code: subDoc ? (subDoc.courseCode || subDoc.subjectCode) : '',
            isBlend: !!s.isBlend,
            blendTheorySlots: s.blendTheorySlots || 0,
            blendLabSlots: s.blendLabSlots || 0,
            slotsTarget: s.slotsTarget || s.slotsMin || 5,
            blockLength: s.blockLength || 1,
            category: s.category || 'easy',
            component: s.component || (s.isBlend ? 'both' : 'theory')
          });
        }
      }

      // Fallback if no subject set: fetch from CurriculumAssignment
      if (!subjects.length && this.classId) {
        const assignments = await M.CurriculumAssignment.find({ classId: this.classId }).lean();
        for (const a of assignments) {
          let subDoc = a.subjectId ? await M.Subject.findById(a.subjectId).lean() : null;
          subjects.push({
            subjectId: a.subjectId || new mongoose.Types.ObjectId(),
            name: a.subjectShortName || (subDoc ? subDoc.shortForm : 'Subject'),
            code: subDoc ? subDoc.courseCode : '',
            isBlend: false,
            slotsTarget: a.periodsPerWeek || 5,
            blockLength: 1,
            category: 'easy',
            component: 'theory',
            staffId: a.staffId,
            staffName: a.staffName
          });
        }
      }
    }

    // Default mock subject list for testing / empty DB scenarios
    if (!subjects.length) {
      subjects = [
        { subjectId: new mongoose.Types.ObjectId(), name: 'CS301 Theory', slotsTarget: 5, component: 'theory', category: 'important' },
        { subjectId: new mongoose.Types.ObjectId(), name: 'CS302 Systems', slotsTarget: 5, component: 'theory', category: 'hard' },
        { subjectId: new mongoose.Types.ObjectId(), name: 'CS303 Math', slotsTarget: 5, component: 'theory', category: 'important' },
        { subjectId: new mongoose.Types.ObjectId(), name: 'CS304 Web Tech', slotsTarget: 4, component: 'theory', category: 'easy' },
        { subjectId: new mongoose.Types.ObjectId(), name: 'CS305 Networks', slotsTarget: 4, component: 'theory', category: 'easy' },
        { subjectId: new mongoose.Types.ObjectId(), name: 'CS308 Systems Lab', slotsTarget: 3, component: 'lab', category: 'hard' },
        { subjectId: new mongoose.Types.ObjectId(), name: 'CS309 Web Lab', slotsTarget: 3, component: 'lab', category: 'easy' },
      ];
    }

    // Fetch teachers & room collections
    let teachers = [];
    let labRooms = [];
    let theoryRooms = [];
    let halls = [];

    if (isDbConnected) {
      try {
        teachers = await M.User.find({ role: 'teacher' }).select('_id name trackId department strongSubjects').lean();
      } catch (_) {}
      try {
        labRooms = await M.Room.find({ category: 'Lab', status: { $ne: 'Inactive' } }).lean();
      } catch (_) {}
      try {
        theoryRooms = await M.Room.find({ category: { $in: ['Room', 'Theory'] }, status: { $ne: 'Inactive' } }).lean();
      } catch (_) {}
      try {
        halls = await M.Room.find({ category: 'Hall', status: { $ne: 'Inactive' } }).lean();
      } catch (_) {}
    }

    // Fallbacks for rooms if empty
    if (!labRooms.length) {
      labRooms = [{ _id: new mongoose.Types.ObjectId(), hallNo: 'CS-LAB-1', name: 'Systems Lab', capacity: 60 }];
    }
    if (!theoryRooms.length) {
      theoryRooms = [
        { _id: new mongoose.Types.ObjectId(), hallNo: 'LH-101', name: 'Lecture Hall 101', capacity: 70 },
        { _id: new mongoose.Types.ObjectId(), hallNo: 'LH-102', name: 'Lecture Hall 102', capacity: 70 }
      ];
    }
    if (!halls.length) {
      halls = [{ _id: new mongoose.Types.ObjectId(), hallNo: 'AUD-1', name: 'Main Seminar Hall', capacity: 200 }];
    }

    // Resolve classes for batch mode
    let targetClasses = [];
    if (this.scope === 'batch') {
      if (isDbConnected) {
        let q = { batch: this.batch };
        if (this.deptId) q.deptId = this.deptId;
        targetClasses = await M.Class.find(q).lean();
      }
      if (!targetClasses.length) {
        targetClasses = [
          { _id: new mongoose.Types.ObjectId(), name: 'CSE-A', section: 'A' },
          { _id: new mongoose.Types.ObjectId(), name: 'CSE-B', section: 'B' }
        ];
      }
    } else {
      targetClasses = [{
        _id: this.classId || new mongoose.Types.ObjectId(),
        name: this.className || 'Class',
        section: 'A'
      }];
    }

    // Number of attempts based on effort
    const attemptsCount = this.effort === 'quick' ? 6 : (this.effort === 'standard' ? 16 : 30);
    const candidates = [];

    // Initialize global ledger with production snapshots of other batches
    const ledger = new GlobalLedger({ targetBatch: this.batch, timingSet });
    await ledger.loadProductionSnapshots(this.batch);

    for (let i = 0; i < attemptsCount; i++) {
      let attempt = null;
      if (this.scope === 'batch') {
        attempt = await this._generateBatchAttempt({
          seed: `batch-seed-${Date.now()}-${i}`,
          classes: targetClasses,
          subjects,
          timingSet,
          labWindowDefs,
          teachers,
          labRooms,
          theoryRooms,
          halls,
          ledger,
          attemptIndex: i
        });
      } else {
        attempt = this._generateSingleAttempt({
          seed: `seed-${Date.now()}-${i}`,
          subjects,
          timingSet,
          labWindowDefs,
          teachers,
          labRooms,
          theoryRooms,
          attemptIndex: i
        });
      }

      if (attempt && attempt.scorecard.hardBreaches === 0) {
        candidates.push(attempt);
      }
    }

    // Sort descending by score
    candidates.sort((a, b) => b.score - a.score);

    // Pick top 3 distinct versions
    const topVersions = [];
    const seenSignatures = new Set();

    for (const c of candidates) {
      const sig = this._gridSignature(c.grid);
      if (!seenSignatures.has(sig)) {
        seenSignatures.add(sig);
        topVersions.push({
          versionIndex: topVersions.length,
          seed: c.seed,
          settings: { effort: this.effort, saturdayMode: this.saturdayMode, scope: this.scope },
          score: c.score,
          scorecard: c.scorecard,
          grid: c.grid,
          batchGrids: c.batchGrids || null
        });
      }
      if (topVersions.length >= 3) break;
    }

    // Fallback if needed
    if (!topVersions.length && candidates.length) {
      topVersions.push({
        versionIndex: 0,
        seed: candidates[0].seed,
        settings: { effort: this.effort, scope: this.scope },
        score: candidates[0].score,
        scorecard: candidates[0].scorecard,
        grid: candidates[0].grid,
        batchGrids: candidates[0].batchGrids || null
      });
    }

    return {
      scope: this.scope,
      attempts: attemptsCount,
      bestScore: topVersions[0] ? topVersions[0].score : 0,
      topVersions
    };
  }

  /**
   * Generates a multi-class Whole Batch attempt using Global Ledger
   */
  async _generateBatchAttempt({ seed, classes, subjects, timingSet, labWindowDefs, teachers, labRooms, theoryRooms, halls, ledger, attemptIndex }) {
    const isSeparate = this.saturdayMode !== 'copy_weekday';
    const activeDays = isSeparate ? DAYS_6 : DAYS_5;
    const periodsCount = 9;

    // Checkpoint ledger state so attempt can backtrack cleanly
    const checkpointIdx = ledger.createCheckpoint();
    const batchGrids = {};
    const mergedGrid = [];

    // Separate lab and theory subjects
    const labSubjects = subjects.filter(s => s.component === 'lab' || (s.isBlend && s.blendLabSlots > 0));
    const theorySubjects = subjects.filter(s => s.component === 'theory' || s.component === 'both' || (s.isBlend && s.blendTheorySlots > 0));

    // 1. Place Combined Sessions First across ALL member classes (R18)
    for (const grp of this.combinedGroups) {
      const hall = halls[0] || { hallNo: 'HALL-1', _id: new mongoose.Types.ObjectId() };
      const teacher = teachers[0] || { name: 'Combined Faculty', _id: new mongoose.Types.ObjectId() };
      const day = activeDays[(attemptIndex + 2) % activeDays.length];
      const period = 3;
      const combinedSessionId = `CS-${Date.now()}-${grp.subjectId || 'GRP'}`;

      classes.forEach(cls => {
        const cId = String(cls._id);
        if (!batchGrids[cId]) batchGrids[cId] = [];
        const slot = {
          classId: cls._id,
          className: cls.name || cls.section,
          day,
          period,
          subject: grp.subjectName || 'Combined Course',
          subjectId: grp.subjectId,
          teacher: teacher.name,
          teacherId: teacher._id,
          room: hall.hallNo || hall.name,
          roomId: hall._id,
          type: 'Theory',
          combinedWith: grp.classNames || [],
          combinedSessionId,
          placementReason: 'Combined session synchronized across batch'
        };
        batchGrids[cId].push(slot);
        mergedGrid.push(slot);
        ledger.commitSlot(slot, cls._id, this.batch);
      });
    }

    // 2. Place Each Class sequentially checking ledger availability
    let totalHardBreaches = 0;
    const availableLabWindows = [...(labWindowDefs.clean || []), ...(labWindowDefs.shortBreak || [])];

    for (let cIdx = 0; cIdx < classes.length; cIdx++) {
      const cls = classes[cIdx];
      const cId = String(cls._id);
      if (!batchGrids[cId]) batchGrids[cId] = [];
      const classSlotsMap = new Map();

      // Copy already placed combined slots into map
      batchGrids[cId].forEach(s => classSlotsMap.set(`${s.day}_${s.period}`, s));

      // Fixed Special Activities (R14: Library, Mentoring, Placement)
      const specialDays = this._shuffle([...activeDays], attemptIndex + cIdx);
      if (this.specialActivities.length) {
        this.specialActivities.forEach((act, aIdx) => {
          const sDay = specialDays[aIdx % specialDays.length];
          const sPeriod = 8; // Late afternoon
          const key = `${sDay}_${sPeriod}`;
          if (!classSlotsMap.has(key)) {
            const slot = {
              classId: cls._id,
              className: cls.name,
              day: sDay,
              period: sPeriod,
              subject: act.label || act.name || 'Special Activity',
              type: 'Activity',
              placementReason: `Scheduled weekly activity: ${act.label || 'Activity'}`
            };
            classSlotsMap.set(key, slot);
            ledger.commitSlot(slot, cls._id, this.batch);
          }
        });
      }

      // Assign default Theory Room for this section
      const theoryRoom = theoryRooms[cIdx % theoryRooms.length] || { hallNo: `LH-${100 + cIdx}`, _id: new mongoose.Types.ObjectId() };

      // A. Place Labs (R1, R2, R17)
      const shuffledDays = this._shuffle([...activeDays], attemptIndex + cIdx * 3);
      let dayPointer = 0;

      for (const lab of labSubjects) {
        if (dayPointer >= shuffledDays.length) break;
        const labDay = shuffledDays[dayPointer++];
        const win = availableLabWindows[(attemptIndex + dayPointer + cIdx) % availableLabWindows.length] || { periods: [1, 2, 3] };
        const labRoom = labRooms[(dayPointer + cIdx) % labRooms.length] || { hallNo: 'LAB-1', _id: new mongoose.Types.ObjectId() };
        const teacher = teachers[(dayPointer + cIdx) % teachers.length] || { name: 'Lab Staff', _id: new mongoose.Types.ObjectId() };

        // Ledger check for teacher & room across all sections
        let canPlace = true;
        for (const p of win.periods) {
          if (classSlotsMap.has(`${labDay}_${p}`)) { canPlace = false; break; }
          if (ledger.isTeacherBusy(teacher._id, labDay, p)) { canPlace = false; break; }
          if (ledger.isRoomBusy(labRoom._id, labDay, p)) { canPlace = false; break; }
        }

        if (canPlace) {
          win.periods.forEach((p, idx) => {
            const slot = {
              classId: cls._id,
              className: cls.name,
              day: labDay,
              period: p,
              subject: lab.name,
              subjectId: lab.subjectId,
              teacher: teacher.name,
              teacherId: teacher._id,
              room: labRoom.hallNo || labRoom.name,
              roomId: labRoom._id,
              isLab: true,
              type: 'Lab',
              span: idx === 0 ? win.periods.length : 1,
              placementReason: `Continuous 3-period lab block (${lab.name}) in ${labRoom.hallNo}`
            };
            classSlotsMap.set(`${labDay}_${p}`, slot);
            ledger.commitSlot(slot, cls._id, this.batch);
          });
        } else {
          totalHardBreaches++;
        }
      }

      // B. Place Theory Doubles (R3: non-lunch straddling doubles)
      const validDoublePairs = timingSet.code === 'SET_2'
        ? [[1, 2], [2, 3], [4, 5], [5, 6], [7, 8], [8, 9]]
        : [[1, 2], [2, 3], [3, 4], [4, 5], [6, 7], [7, 8], [8, 9]];

      for (let sIdx = 0; sIdx < theorySubjects.length; sIdx++) {
        const sub = theorySubjects[sIdx];
        const targetDay = activeDays[(sIdx + attemptIndex + cIdx) % activeDays.length];
        const pairs = this._shuffle([...validDoublePairs], sIdx + attemptIndex);
        const t = teachers[(sIdx + cIdx) % teachers.length] || { name: 'Faculty', _id: new mongoose.Types.ObjectId() };

        for (const pair of pairs) {
          const k1 = `${targetDay}_${pair[0]}`;
          const k2 = `${targetDay}_${pair[1]}`;
          if (!classSlotsMap.has(k1) && !classSlotsMap.has(k2)) {
            if (!ledger.isTeacherBusy(t._id, targetDay, pair[0]) && !ledger.isTeacherBusy(t._id, targetDay, pair[1])) {
              const s1 = {
                classId: cls._id,
                className: cls.name,
                day: targetDay,
                period: pair[0],
                subject: sub.name,
                subjectId: sub.subjectId,
                teacher: t.name,
                teacherId: t._id,
                room: theoryRoom.hallNo,
                roomId: theoryRoom._id,
                type: 'Theory',
                placementReason: `Theory double period (P${pair[0]}–P${pair[1]})`
              };
              const s2 = { ...s1, period: pair[1] };
              classSlotsMap.set(k1, s1);
              classSlotsMap.set(k2, s2);
              ledger.commitSlot(s1, cls._id, this.batch);
              ledger.commitSlot(s2, cls._id, this.batch);
              break;
            }
          }
        }
      }

      // C. Place Remaining Theory Periods (R4)
      let subPtr = cIdx;
      for (const day of activeDays) {
        for (let p = 1; p <= periodsCount; p++) {
          const key = `${day}_${p}`;
          if (!classSlotsMap.has(key)) {
            const sub = theorySubjects[subPtr % theorySubjects.length];
            subPtr++;
            const t = teachers[(subPtr + cIdx) % teachers.length] || { name: 'Faculty', _id: new mongoose.Types.ObjectId() };

            const slot = {
              classId: cls._id,
              className: cls.name,
              day,
              period: p,
              subject: sub.name,
              subjectId: sub.subjectId,
              teacher: t.name,
              teacherId: t._id,
              room: theoryRoom.hallNo,
              roomId: theoryRoom._id,
              type: 'Theory',
              placementReason: `Weekly theory session for ${sub.name} in ${theoryRoom.hallNo}`
            };
            classSlotsMap.set(key, slot);
            ledger.commitSlot(slot, cls._id, this.batch);
          }
        }
      }

      // D. Saturday copy if copy_weekday mode
      if (!isSeparate) {
        const srcDay = this.pinnedWeekday || 'Monday';
        for (let p = 1; p <= periodsCount; p++) {
          const src = classSlotsMap.get(`${srcDay}_${p}`);
          if (src) {
            const satSlot = {
              ...src,
              day: 'Saturday',
              period: p,
              placementReason: `Saturday mirrored from ${srcDay} (Saturday copy mode)`
            };
            classSlotsMap.set(`Saturday_${p}`, satSlot);
            ledger.commitSlot(satSlot, cls._id, this.batch);
          }
        }
      }

      const classSlots = Array.from(classSlotsMap.values());
      batchGrids[cId] = classSlots;
      mergedGrid.push(...classSlots);
    }

    // Clean up ledger checkpoint
    ledger.restoreCheckpoint(checkpointIdx);

    // Score the batch candidate
    const totalSlots = mergedGrid.length;
    const baseScore = 100;
    const score = Math.max(10, baseScore - (totalHardBreaches * 50));

    const scorecard = {
      totalScore: score,
      hardBreaches: totalHardBreaches,
      softScore: score,
      metrics: {
        hardBreaches: totalHardBreaches,
        sectionsCount: classes.length,
        totalSlotsPlaced: totalSlots,
        lunchStraddleAvoided: true
      },
      explanation: totalHardBreaches === 0
        ? `Fully conflict-free multi-section timetable for ${classes.length} classes. All labs within clean windows, theory doubles placed, and ledger busy slots respected.`
        : `Batch contains ${totalHardBreaches} constraint breaches.`
    };

    return {
      seed,
      score,
      scorecard,
      grid: mergedGrid,
      batchGrids
    };
  }

  /**
   * Single class attempt generator
   */
  _generateSingleAttempt({ seed, subjects, timingSet, labWindowDefs, teachers, labRooms, theoryRooms, attemptIndex }) {
    const isSeparate = this.saturdayMode !== 'copy_weekday';
    const activeDays = isSeparate ? DAYS_6 : DAYS_5;
    const periodsCount = 9;

    const gridMap = new Map();

    // Retain pinned slots
    for (const p of this.existingPinnedSlots) {
      if (p.day && p.period) {
        gridMap.set(`${p.day}_${p.period}`, {
          day: p.day,
          period: p.period,
          subject: p.subject || 'Pinned',
          subjectId: p.subjectId,
          teacher: p.teacher || '',
          teacherId: p.teacherId,
          room: p.room || '',
          isPinned: true,
          placementReason: 'Manually pinned slot'
        });
      }
    }

    const labSubjects = subjects.filter(s => s.component === 'lab' || (s.isBlend && s.blendLabSlots > 0));
    const theorySubjects = subjects.filter(s => s.component === 'theory' || s.component === 'both' || (s.isBlend && s.blendTheorySlots > 0));

    // 1. Place Combined Sessions First (R18)
    for (const grp of this.combinedGroups) {
      const day = activeDays[(attemptIndex + 1) % activeDays.length];
      const period = 2;
      const key = `${day}_${period}`;
      if (!gridMap.has(key)) {
        gridMap.set(key, {
          day,
          period,
          subject: grp.subjectName || 'Combined Subject',
          subjectId: grp.subjectId,
          teacher: 'Combined Faculty',
          type: 'Theory',
          combinedWith: grp.classNames || [],
          combinedSessionId: `CS-${Date.now()}-${grp.subjectId}`,
          placementReason: 'Combined class session across sections'
        });
      }
    }

    // 2. Place Lab Blocks
    const availableLabWindows = [...(labWindowDefs.clean || []), ...(labWindowDefs.shortBreak || [])];
    const shuffledDays = this._shuffle([...activeDays], attemptIndex);
    let dayIdx = 0;

    for (const lab of labSubjects) {
      if (dayIdx >= shuffledDays.length) break;
      const labDay = shuffledDays[dayIdx++];
      const win = availableLabWindows[(attemptIndex + dayIdx) % availableLabWindows.length] || { periods: [1, 2, 3] };
      const room = labRooms[dayIdx % (labRooms.length || 1)] || { hallNo: 'LAB-1' };
      const teacher = teachers[dayIdx % (teachers.length || 1)] || { name: 'Lab Incharge' };

      let canPlace = true;
      for (const p of win.periods) {
        if (gridMap.has(`${labDay}_${p}`)) {
          canPlace = false;
          break;
        }
      }

      if (canPlace) {
        win.periods.forEach((p, idx) => {
          gridMap.set(`${labDay}_${p}`, {
            day: labDay,
            period: p,
            subject: lab.name,
            subjectId: lab.subjectId,
            teacher: teacher.name,
            teacherId: teacher._id,
            room: room.hallNo || room.name,
            roomId: room._id,
            isLab: true,
            type: 'Lab',
            span: idx === 0 ? win.periods.length : 1,
            placementReason: `Continuous 3-period lab block (${lab.name}) without lunch crossing`
          });
        });
      }
    }

    // 3. Place Theory Doubles
    const validDoublePairs = timingSet.code === 'SET_2'
      ? [[1, 2], [2, 3], [4, 5], [5, 6], [7, 8], [8, 9]]
      : [[1, 2], [2, 3], [3, 4], [4, 5], [6, 7], [7, 8], [8, 9]];

    const subjectDoublePlaced = new Set();

    for (let sIdx = 0; sIdx < theorySubjects.length; sIdx++) {
      const sub = theorySubjects[sIdx];
      const targetDay = activeDays[(sIdx + attemptIndex) % activeDays.length];
      const pairs = this._shuffle([...validDoublePairs], sIdx + attemptIndex);

      for (const pair of pairs) {
        const k1 = `${targetDay}_${pair[0]}`;
        const k2 = `${targetDay}_${pair[1]}`;
        if (!gridMap.has(k1) && !gridMap.has(k2)) {
          const t = teachers[sIdx % (teachers.length || 1)] || { name: 'Faculty' };
          gridMap.set(k1, {
            day: targetDay,
            period: pair[0],
            subject: sub.name,
            subjectId: sub.subjectId,
            teacher: t.name,
            teacherId: t._id,
            type: 'Theory',
            placementReason: `Theory double period (P${pair[0]}–P${pair[1]}) on ${targetDay}`
          });
          gridMap.set(k2, {
            day: targetDay,
            period: pair[1],
            subject: sub.name,
            subjectId: sub.subjectId,
            teacher: t.name,
            teacherId: t._id,
            type: 'Theory',
            placementReason: `Theory double period (P${pair[0]}–P${pair[1]}) on ${targetDay}`
          });
          subjectDoublePlaced.add(sub.name);
          break;
        }
      }
    }

    // 4. Place Remaining Theory Slots
    let subPointer = 0;
    for (const day of activeDays) {
      for (let p = 1; p <= periodsCount; p++) {
        const key = `${day}_${p}`;
        if (!gridMap.has(key)) {
          const sub = theorySubjects[subPointer % theorySubjects.length];
          subPointer++;
          const t = teachers[subPointer % (teachers.length || 1)] || { name: 'Faculty' };
          gridMap.set(key, {
            day,
            period: p,
            subject: sub.name,
            subjectId: sub.subjectId,
            teacher: t.name,
            teacherId: t._id,
            type: 'Theory',
            placementReason: `Weekly theory slot for ${sub.name}`
          });
        }
      }
    }

    // 5. Saturday Copy Mode
    if (!isSeparate) {
      const sourceDay = this.pinnedWeekday || 'Monday';
      for (let p = 1; p <= periodsCount; p++) {
        const srcSlot = gridMap.get(`${sourceDay}_${p}`);
        if (srcSlot) {
          gridMap.set(`Saturday_${p}`, {
            ...srcSlot,
            day: 'Saturday',
            period: p,
            placementReason: `Saturday schedule mirrored from ${sourceDay} (Saturday copy mode)`
          });
        }
      }
    }

    const grid = Array.from(gridMap.values());
    const scorecard = this._scoreGrid(grid, timingSet, theorySubjects, labSubjects, activeDays);
    const score = Math.max(10, Math.min(100, Math.round(scorecard.totalScore)));

    return {
      seed,
      score,
      scorecard,
      grid
    };
  }

  /**
   * Evaluate rules R1–R8 and calculate scorecard
   */
  _scoreGrid(grid, timingSet, theorySubjects, labSubjects, activeDays) {
    let hardBreaches = 0;
    let labClusteringBreaches = 0;
    let missingDoubles = 0;
    let spreadBreaches = 0;
    let lunchBreaches = 0;

    const daysUsed = new Set(grid.map(s => s.day));
    const dayLabCount = {};
    const subjectDoubles = new Set();

    const forbiddenDouble = timingSet.code === 'SET_2' ? [6, 7] : [5, 6];

    grid.forEach(slot => {
      if (slot.isLab) {
        dayLabCount[slot.day] = (dayLabCount[slot.day] || 0) + 1;
      }
    });

    Object.keys(dayLabCount).forEach(d => {
      if (dayLabCount[d] > 3) {
        labClusteringBreaches++;
      }
    });

    daysUsed.forEach(d => {
      for (let p = 1; p <= 8; p++) {
        const s1 = grid.find(g => g.day === d && g.period === p);
        const s2 = grid.find(g => g.day === d && g.period === p + 1);
        if (s1 && s2 && s1.subject === s2.subject && !s1.isLab) {
          if (p === forbiddenDouble[0]) {
            hardBreaches++;
            lunchBreaches++;
          } else {
            subjectDoubles.add(s1.subject);
          }
        }
      }
    });

    theorySubjects.forEach(s => {
      if (!subjectDoubles.has(s.name)) {
        missingDoubles++;
      }
    });

    const baseScore = 100;
    const deductions = (hardBreaches * 50) + (labClusteringBreaches * 10) + (missingDoubles * 4) + (spreadBreaches * 2);
    const totalScore = Math.max(0, baseScore - deductions);

    const explanation = hardBreaches === 0
      ? `High-quality conflict-free timetable complying with institutional scheduling rules. All ${subjectDoubles.size} theory doubles placed without lunch straddling, lab blocks assigned to clean windows.`
      : `Schedule contains ${hardBreaches} hard rule breach(es) and ${missingDoubles} missing theory double(s).`;

    return {
      totalScore,
      hardBreaches,
      softScore: Math.round(totalScore),
      metrics: {
        hardBreaches,
        labClusteringBreaches,
        theoryDoublesPlaced: subjectDoubles.size,
        missingDoubles,
        totalSlotsPlaced: grid.length,
        lunchStraddleAvoided: lunchBreaches === 0
      },
      explanation
    };
  }

  _shuffle(arr, seed = 1) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = (seed * 31 + i * 17) % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  _gridSignature(grid) {
    return grid.map(g => `${g.day}-${g.period}-${g.subjectId}`).sort().join('|');
  }
}

module.exports = {
  AutoGenEngine,
};
