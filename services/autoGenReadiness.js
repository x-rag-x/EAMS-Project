const M = require('../models');
const { computeCapacity } = require('./capacityMeter');
const { getLabWindows } = require('./clashDetector');

/**
 * Evaluates auto-generation readiness for a department/batch or single class.
 *
 * @param {Object} params
 * @param {string|ObjectId} params.deptId
 * @param {string} params.batch
 * @param {string|ObjectId} [params.classId]
 * @param {string} [params.saturdayMode='separate']
 * @returns {Promise<Object>} { ok, blockers, warnings, feasibility }
 */
async function checkAutoGenReadiness({ deptId, batch, classId, saturdayMode = 'separate' }) {
  const blockers = [];
  const warnings = [];
  const feasibility = {
    totalSections: 0,
    totalLabSubjects: 0,
    availableLabWindows: 0,
    doubleWindowsNeeded: 0,
    doubleWindowsAvailable: 0,
    capacityMode: saturdayMode,
    allottedSlots: 0,
    totalCapacity: saturdayMode === 'copy_weekday' ? 45 : 54,
    hasLockedSubjectSet: false
  };

  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
      blockers.push({
        type: 'NO_SUBJECT_SET',
        msg: `No Semester Subject Set exists for batch "${batch}". Create one in Manage > Subjects Manager first.`
      });
      return {
        ok: false,
        blockers,
        warnings,
        feasibility
      };
    }

    // 1. Check SemesterSubjectSet
    let setQuery = {};
    if (batch && String(batch).trim() !== '' && String(batch).trim() !== 'undefined') {
      setQuery.batch = String(batch).trim();
    }
    if (deptId && deptId !== 'undefined' && deptId !== 'null') {
      if (mongoose.Types.ObjectId.isValid(deptId)) {
        setQuery.deptId = deptId;
      } else {
        const dDoc = await M.Department.findOne({ code: new RegExp('^' + String(deptId).trim() + '$', 'i') }).lean();
        if (dDoc) setQuery.deptId = dDoc._id;
      }
    }
    
    // Look for Locked or HOD_Approved set first, or fall back to any status to give informative error
    const subjectSet = await M.SemesterSubjectSet.findOne(setQuery).sort({ updatedAt: -1 }).lean();

    if (!subjectSet) {
      blockers.push({
        type: 'NO_SUBJECT_SET',
        msg: `No Semester Subject Set exists for batch "${batch}". Create one in Manage > Subjects Manager first.`
      });
    } else {
      if (subjectSet.status !== 'Locked' && subjectSet.status !== 'HOD_Approved') {
        blockers.push({
          type: 'SUBJECT_SET_NOT_LOCKED',
          msg: `Semester Subject Set is in "${subjectSet.status}" status. It must be HOD-Approved or Locked before generating timetables.`
        });
      } else {
        feasibility.hasLockedSubjectSet = true;
      }

      // 2. Check target slots and blend allocation
      const subjects = Array.isArray(subjectSet.subjects) ? subjectSet.subjects : [];
      if (!subjects.length) {
        blockers.push({
          type: 'EMPTY_SUBJECTS',
          msg: 'The Semester Subject Set contains no subjects.'
        });
      } else {
        let totalAllotted = 0;
        let labCount = 0;
        let theoryCount = 0;

        subjects.forEach(s => {
          const slots = s.isBlend ? ((s.blendTheorySlots || 0) + (s.blendLabSlots || 0)) : (s.slotsTarget || s.slotsMin || 5);
          totalAllotted += slots;
          if (s.component === 'lab' || (s.isBlend && s.blendLabSlots > 0)) {
            labCount++;
          }
          if (s.component === 'theory' || (s.isBlend && s.blendTheorySlots > 0)) {
            theoryCount++;
          }
          if (slots <= 0) {
            warnings.push({
              type: 'ZERO_SLOT_SUBJECT',
              msg: `Subject has 0 weekly target slots allocated.`
            });
          }
        });

        feasibility.allottedSlots = totalAllotted;
        feasibility.totalLabSubjects = labCount;
        feasibility.doubleWindowsNeeded = theoryCount; // R3: 1 double per theory subject per week

        // Capacity calculation check
        const cap = computeCapacity(subjectSet, saturdayMode);
        if (cap.isOverCapacity) {
          blockers.push({
            type: 'CAPACITY_OVERFLOW',
            msg: `Subject set requires ${cap.allotted} slots, which exceeds matrix capacity (${cap.totalCapacity}). Reduce subject hours or adjust Saturday mode.`
          });
        }
      }
    }

    // 3. Check Target Class / Sections
    const { normalizeYearRange } = require('../utils/yearFormat');
    let classes = [];
    if (classId) {
      const cls = await M.Class.findById(classId).lean();
      if (cls) classes.push(cls);
    } else {
      const classQuery = {};
      if (deptId && deptId !== 'undefined' && deptId !== 'null') {
        if (mongoose.Types.ObjectId.isValid(deptId)) {
          classQuery.deptId = deptId;
        } else {
          const dDoc = await M.Department.findOne({ code: new RegExp('^' + String(deptId).trim() + '$', 'i') }).lean();
          if (dDoc) classQuery.deptId = dDoc._id;
        }
      }
      if (batch && batch !== 'undefined' && String(batch).trim() !== '') {
        const normBatch = normalizeYearRange(batch);
        classQuery.$or = [
          { batch: normBatch },
          { batch: String(batch).trim() },
          { name: new RegExp('^' + String(batch).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
        ];
      }
      if (Object.keys(classQuery).length > 0) {
        classes = await M.Class.find(classQuery).lean();
      }
    }
    feasibility.totalSections = classes.length;

    if (!classes.length && classId) {
      blockers.push({
        type: 'CLASS_NOT_FOUND',
        msg: 'Target class could not be found.'
      });
    }

    // 4. Check Class Advisor & Curriculum Assignments per class
    for (const cls of classes) {
      let advisorTeacherId = cls.advisorTeacherId || cls.advisorId || null;
      let advisorTeacherName = cls.advisorTeacherName || cls.advisor || cls.incharge || cls.classAdvisor || '';
      let advisorTeacherTrackId = cls.advisorTeacherTrackId || cls.advisorTrackId || '';

      // Fallback 1: check active RoleAssignment
      if (!advisorTeacherId && !advisorTeacherName && cls._id) {
        try {
          const roleAssign = await M.RoleAssignment.findOne({
            role: 'classAdvisor',
            scopeId: cls._id,
            active: true
          }).lean();
          if (roleAssign) {
            advisorTeacherId = roleAssign.teacherId;
            advisorTeacherName = roleAssign.teacherName;
            advisorTeacherTrackId = roleAssign.teacherTrackId;
          }
        } catch (_) {}
      }

      // Fallback 2: check Teacher specials
      if (!advisorTeacherId && !advisorTeacherName) {
        try {
          const matchConds = [];
          if (cls.name) {
            matchConds.push({ 'specials.key': cls.name }, { 'specials.value': cls.name });
          }
          if (cls.trackId) {
            matchConds.push({ 'specials.key': cls.trackId }, { 'specials.value': cls.trackId });
          }
          if (matchConds.length) {
            const advTeacher = await M.Teacher.findOne({
              'specials.option': 'isClassAdvisor',
              $or: matchConds
            }).lean();
            if (advTeacher) {
              advisorTeacherId = advTeacher._id;
              advisorTeacherName = advTeacher.fullName || advTeacher.name;
              advisorTeacherTrackId = advTeacher.trackId;
            }
          }
        } catch (_) {}
      }

      const hasAdvisor = !!(advisorTeacherId || advisorTeacherName || advisorTeacherTrackId);
      if (!hasAdvisor) {
        warnings.push({
          type: 'NO_CLASS_ADVISOR',
          msg: `Class "${cls.name || cls.section}" has no Class Advisor assigned. Each Class Advisor is required to teach at least one subject to their advised class.`
        });
      }

      // Check teacher assignments
      const assignments = await M.CurriculumAssignment.find({ classId: cls._id }).lean();
      if (!assignments.length) {
        warnings.push({
          type: 'UNASSIGNED_FACULTY',
          msg: `Class "${cls.name || cls.section}" has no faculty assignments in Curriculum Assignment. Fallback faculty will be allocated.`
        });
      }
    }

    // 5. Check Lab Rooms available
    const labRooms = await M.Room.find({ category: 'Lab', status: { $ne: 'Inactive' } }).lean();
    if (!labRooms.length && feasibility.totalLabSubjects > 0) {
      blockers.push({
        type: 'NO_LAB_ROOMS',
        msg: 'No active Lab rooms found in Rooms & Facilities registry for scheduled lab subjects.'
      });
    }

    // 6. Check Lab Windows Feasibility
    const sampleClassId = classId || (classes[0] && classes[0]._id);
    const labWindows = await getLabWindows(sampleClassId);
    const cleanPerDay = (labWindows.clean || []).length;
    const shortPerDay = (labWindows.shortBreak || []).length;
    const daysCount = saturdayMode === 'copy_weekday' ? 5 : 6;
    feasibility.availableLabWindows = (cleanPerDay + shortPerDay) * daysCount;
    feasibility.doubleWindowsAvailable = daysCount * 3; // Approx 3 non-lunch double slots per day

    if (feasibility.totalLabSubjects > daysCount) {
      warnings.push({
        type: 'LAB_COUNT_HIGH',
        msg: `Batch has ${feasibility.totalLabSubjects} labs for ${daysCount} days. Daily lab distribution policy allows at most 1 lab per day, so multiple labs may need to be scheduled on the same day.`
      });
    }

    // 7. Check Workload Policy
    if (deptId) {
      const policy = await M.WorkloadPolicy.findOne({ deptId }).lean();
      if (!policy) {
        warnings.push({
          type: 'DEFAULT_WORKLOAD_POLICY',
          msg: 'No department-specific Workload Policy configured; standard institutional rules (max 24 hrs/week) will be used.'
        });
      }
    }

  } catch (err) {
    blockers.push({
      type: 'READINESS_CHECK_ERROR',
      msg: `Internal error during readiness check: ${err.message}`
    });
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    feasibility
  };
}

module.exports = {
  checkAutoGenReadiness,
};