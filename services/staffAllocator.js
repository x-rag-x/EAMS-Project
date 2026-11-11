const mongoose = require('mongoose');
const M = require('../models');
const { logAction, getNextLogTrackId } = require('../utils/logAction');

/**
 * Staff Allocator Service (Phase 3)
 * Implements automated faculty allocation adhering to Rules R5, R9, R10, R11, R15, R16.
 */

/**
 * Calculates teacher's allowed weekly load considering workload policies and responsibilities.
 */
async function getTeacherAllowedLoad(teacher, workloadPolicy) {
  const isDbConnected = (mongoose.connection && mongoose.connection.readyState === 1);
  const designation = teacher.designation || 'Assistant Professor';
  
  let baseMax = 20;
  let floorLoad = 10;

  if (workloadPolicy && Array.isArray(workloadPolicy.designationRules)) {
    const rule = workloadPolicy.designationRules.find(r => r.designation.toLowerCase() === designation.toLowerCase());
    if (rule) {
      baseMax = rule.maxPerWeek || 20;
      floorLoad = rule.floorLoad || 10;
    }
  }

  // Calculate responsibility deductions
  let totalDeduction = 0;
  if (isDbConnected && Array.isArray(teacher.responsibilities) && teacher.responsibilities.length) {
    try {
      const respDocs = await M.Responsibility.find({ _id: { $in: teacher.responsibilities } }).lean();
      respDocs.forEach(r => {
        totalDeduction += (Number(r.workloadDeduction) || 0);
      });
    } catch (_) {}
  }

  const allowed = Math.max(floorLoad, baseMax - totalDeduction);
  return {
    baseMax,
    totalDeduction,
    floorLoad,
    allowed
  };
}

/**
 * Computes seniority score from joiningDate (earlier joining = higher seniority)
 */
function computeSeniorityScore(joiningDate) {
  if (!joiningDate) return 5;
  const joinYear = new Date(joiningDate).getFullYear();
  const currentYear = new Date().getFullYear();
  const yearsExperience = Math.max(0, currentYear - joinYear);
  // Scale: 1 year = 3 points, up to 35 max
  return Math.min(35, 5 + (yearsExperience * 3));
}

/**
 * Proposes faculty allocations for all sections in a batch.
 */
async function proposeAllocations({ batch, deptId }) {
  const isDbConnected = (mongoose.connection && mongoose.connection.readyState === 1);
  const result = {
    batch,
    deptId,
    classes: [],
    allocations: [],
    facultyWorkloads: {}
  };

  // 1. Fetch SemesterSubjectSet
  let subjectSet = null;
  if (isDbConnected) {
    let setQuery = { batch };
    if (deptId) setQuery.deptId = deptId;
    subjectSet = await M.SemesterSubjectSet.findOne(setQuery).lean();
  }

  const subjects = (subjectSet && Array.isArray(subjectSet.subjects) && subjectSet.subjects.length)
    ? subjectSet.subjects
    : [
        { subjectId: new mongoose.Types.ObjectId(), name: 'Data Structures', code: 'CS301', slotsTarget: 5, component: 'theory', category: 'hard' },
        { subjectId: new mongoose.Types.ObjectId(), name: 'Operating Systems', code: 'CS302', slotsTarget: 5, component: 'theory', category: 'important' },
        { subjectId: new mongoose.Types.ObjectId(), name: 'Discrete Math', code: 'MA301', slotsTarget: 5, component: 'theory', category: 'important' },
        { subjectId: new mongoose.Types.ObjectId(), name: 'DS Lab', code: 'CS308', slotsTarget: 3, component: 'lab', category: 'hard' },
        { subjectId: new mongoose.Types.ObjectId(), name: 'Web Dev Lab', code: 'CS309', slotsTarget: 3, component: 'lab', category: 'easy' },
      ];

  // 2. Fetch Classes in batch
  let classes = [];
  if (isDbConnected) {
    let clsQuery = { batch };
    if (deptId) clsQuery.deptId = deptId;
    classes = await M.Class.find(clsQuery).lean();
  }
  if (!classes.length) {
    classes = [
      { _id: new mongoose.Types.ObjectId(), name: 'Section A', section: 'A', advisor: 'Dr. Alan Turing' },
      { _id: new mongoose.Types.ObjectId(), name: 'Section B', section: 'B', advisor: 'Dr. Ada Lovelace' }
    ];
  }
  result.classes = classes;

  // 3. Fetch Teachers & Workload Policy
  let teachers = [];
  let workloadPolicy = null;
  if (isDbConnected) {
    if (deptId) {
      workloadPolicy = await M.WorkloadPolicy.findOne({ deptId }).lean();
    }
    let teacherFilter = {};
    if (deptId) {
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(deptId)) {
        teacherFilter = { $or: [{ deptId }, { department: deptId }] };
      } else {
        teacherFilter = { department: deptId };
      }
    }
    // Query M.Teacher first because it contains fullName, joiningDate, strongSubjects, etc.
    let tDocs = await M.Teacher.find(teacherFilter).select('_id fullName firstName lastName trackId designation department deptId joiningDate strongSubjects responsibilities specials').lean();
    if (!tDocs.length) {
      tDocs = await M.Teacher.find().select('_id fullName firstName lastName trackId designation department deptId joiningDate strongSubjects responsibilities specials').lean();
    }
    if (tDocs.length) {
      teachers = tDocs.map(t => ({
        ...t,
        name: t.fullName || t.name || 'Faculty Member'
      }));
    } else {
      let uDocs = await M.User.find({ role: 'teacher' }).select('_id name email trackId designation department').lean();
      teachers = uDocs.map(u => ({ ...u, fullName: u.name }));
    }
  }
  if (!teachers.length) {
    teachers = [
      { _id: new mongoose.Types.ObjectId(), name: 'Dr. Alan Turing', designation: 'Professor', joiningDate: new Date('2015-06-01'), strongSubjects: ['CS301', 'CS302', 'Data Structures'] },
      { _id: new mongoose.Types.ObjectId(), name: 'Dr. Ada Lovelace', designation: 'Associate Professor', joiningDate: new Date('2018-07-15'), strongSubjects: ['MA301', 'Discrete Math'] },
      { _id: new mongoose.Types.ObjectId(), name: 'Prof. Grace Hopper', designation: 'Assistant Professor', joiningDate: new Date('2021-01-10'), strongSubjects: ['CS308', 'CS309', 'DS Lab'] },
      { _id: new mongoose.Types.ObjectId(), name: 'Prof. John von Neumann', designation: 'Assistant Professor', joiningDate: new Date('2022-03-01'), strongSubjects: ['CS302', 'Operating Systems'] },
    ];
  }

  // Initialize teacher tracking
  const facultyTracker = {};
  for (const t of teachers) {
    const tId = String(t._id);
    const loadInfo = await getTeacherAllowedLoad(t, workloadPolicy);
    facultyTracker[tId] = {
      teacher: t,
      allowed: loadInfo.allowed,
      assigned: 0,
      assignedSubjects: [] // array of { subjectCode, classId }
    };
  }

  // 4. Allocation Pass: For each class, for each subject/component
  for (const cls of classes) {
    let advisorId = cls.advisorTeacherId ? String(cls.advisorTeacherId) : (cls.advisorId ? String(cls.advisorId) : '');
    let advisorName = cls.advisorTeacherName || cls.advisor || cls.incharge || cls.classAdvisor || '';
    let advisorTrackId = cls.advisorTeacherTrackId || cls.advisorTrackId || '';

    if (!advisorId && !advisorName && cls._id) {
      try {
        const roleAssign = await M.RoleAssignment.findOne({ role: 'classAdvisor', scopeId: cls._id, active: true }).lean();
        if (roleAssign) {
          advisorId = roleAssign.teacherId ? String(roleAssign.teacherId) : '';
          advisorName = roleAssign.teacherName || '';
          advisorTrackId = roleAssign.teacherTrackId || '';
        }
      } catch (_) {}
    }
    if (!advisorId && !advisorName) {
      try {
        const matchConds = [];
        if (cls.name) matchConds.push({ 'specials.key': cls.name }, { 'specials.value': cls.name });
        if (cls.trackId) matchConds.push({ 'specials.key': cls.trackId }, { 'specials.value': cls.trackId });
        if (matchConds.length) {
          const advTeacher = await M.Teacher.findOne({
            'specials.option': 'isClassAdvisor',
            $or: matchConds
          }).lean();
          if (advTeacher) {
            advisorId = String(advTeacher._id);
            advisorName = advTeacher.fullName || advTeacher.name || '';
            advisorTrackId = advTeacher.trackId || '';
          }
        }
      } catch (_) {}
    }

    let advisorHasSubject = false;

    for (const sub of subjects) {
      let subName = sub.name || sub.subjectName || 'Subject';
      let subCode = sub.code || sub.courseCode || '';

      if (isDbConnected && !sub.name && sub.subjectId) {
        try {
          const sDoc = await M.Subject.findById(sub.subjectId).lean();
          if (sDoc) {
            subName = sDoc.shortForm || sDoc.subjectName || sDoc.name;
            subCode = sDoc.courseCode || sDoc.subjectCode;
          }
        } catch (_) {}
      }

      // Determine components needing allocation (blend has separate theory & lab)
      const componentsNeeded = [];
      if (sub.isBlend) {
        if (sub.blendTheorySlots > 0) componentsNeeded.push({ type: 'theory', slots: sub.blendTheorySlots });
        if (sub.blendLabSlots > 0) componentsNeeded.push({ type: 'lab', slots: sub.blendLabSlots });
      } else if (sub.component === 'lab') {
        componentsNeeded.push({ type: 'lab', slots: sub.slotsTarget || 3 });
      } else {
        componentsNeeded.push({ type: 'theory', slots: sub.slotsTarget || 5 });
      }

      for (const comp of componentsNeeded) {
        let bestTeacher = null;
        let bestScore = -999;
        let bestReasonParts = [];

        // Score each candidate
        for (const t of teachers) {
          const tId = String(t._id);
          const state = facultyTracker[tId];
          const proposedLoad = state.assigned + comp.slots;

          // Hard Check: Cannot exceed allowed workload
          if (proposedLoad > state.allowed) continue;

          let score = 0;
          const reasonParts = [];

          // 1. Advisor bonus: prioritize class advisor teaching their assigned section
          const isAdvisor = (advisorId && (tId === advisorId || (t.trackId && t.trackId === advisorTrackId))) ||
                            (advisorName && (
                              (t.name && t.name.toLowerCase() === advisorName.toLowerCase()) ||
                              (t.fullName && t.fullName.toLowerCase() === advisorName.toLowerCase()) ||
                              String(t._id) === advisorName
                            ));
          if (isAdvisor && !advisorHasSubject && comp.type === 'theory') {
            score += 50;
            reasonParts.push('Class Advisor priority (teaches assigned class)');
          }

          // 2. Seniority bonus (4-credit, important, or hard subjects)
          const isDemandingSubject = (sub.category === 'hard' || sub.category === 'important' || sub.slotsTarget >= 5);
          if (isDemandingSubject) {
            const seniority = computeSeniorityScore(t.joiningDate);
            score += seniority;
            if (seniority >= 20) reasonParts.push(`Senior staff (joined ${t.joiningDate ? new Date(t.joiningDate).getFullYear() : 'prior'})`);
          }

          // 3. Preparation reuse across sections
          const hasSameSubjectInOtherClass = state.assignedSubjects.some(
            s => (s.subjectCode === subCode || s.subjectName === subName) && String(s.classId) !== String(cls._id)
          );
          if (hasSameSubjectInOtherClass) {
            score += 25;
            reasonParts.push('Teaches same subject in another section (preparation reuse)');
          }

          // 4. Strong subjects bonus
          const isStrong = Array.isArray(t.strongSubjects) && t.strongSubjects.some(s => {
            const sLower = String(s).toLowerCase();
            return sLower === subCode.toLowerCase() || sLower === subName.toLowerCase();
          });
          if (isStrong) {
            score += 15;
            reasonParts.push('Specialized strong subject');
          }

          // 5. Workload headroom
          const headroom = state.allowed - proposedLoad;
          score += Math.max(0, headroom * 2);

          if (score > bestScore) {
            bestScore = score;
            bestTeacher = t;
            bestReasonParts = [
              ...reasonParts,
              `load ${proposedLoad}/${state.allowed} hrs`
            ];
          }
        }

        // If no candidate fit within load, fallback to teacher with smallest overload
        if (!bestTeacher) {
          let minOverload = 999;
          for (const t of teachers) {
            const tId = String(t._id);
            const state = facultyTracker[tId];
            const overload = (state.assigned + comp.slots) - state.allowed;
            if (overload < minOverload) {
              minOverload = overload;
              bestTeacher = t;
              bestReasonParts = [`Assigned via load relief (overload ${overload} hrs)`];
            }
          }
        }

        if (bestTeacher) {
          const tId = String(bestTeacher._id);
          facultyTracker[tId].assigned += comp.slots;
          facultyTracker[tId].assignedSubjects.push({ subjectCode: subCode, subjectName: subName, classId: cls._id });

          if (advisorName && (bestTeacher.name.toLowerCase() === advisorName.toLowerCase() || String(bestTeacher._id) === advisorName)) {
            advisorHasSubject = true;
          }

          const reasonText = bestReasonParts.join('; ');
          result.allocations.push({
            classId: cls._id,
            className: cls.name || cls.section,
            subjectId: sub.subjectId,
            subjectName: subName,
            subjectCode: subCode,
            component: comp.type,
            periodsPerWeek: comp.slots,
            category: sub.category || 'easy',
            staffId: bestTeacher._id,
            staffName: bestTeacher.name,
            reason: reasonText,
            score: Math.round(bestScore)
          });
        }
      }
    }
  }

  // Populate final faculty workloads
  Object.keys(facultyTracker).forEach(tId => {
    const item = facultyTracker[tId];
    result.facultyWorkloads[tId] = {
      teacherId: item.teacher._id,
      name: item.teacher.name,
      designation: item.teacher.designation,
      allowed: item.allowed,
      assigned: item.assigned,
      headroom: item.allowed - item.assigned
    };
  });

  return result;
}

/**
 * Locks proposed staff allocations into CurriculumAssignment documents.
 */
async function lockAllocations({ batch, deptId, allocations, user }) {
  const isDbConnected = (mongoose.connection && mongoose.connection.readyState === 1);
  if (!isDbConnected) {
    return { ok: true, message: 'Allocations locked (offline/test mode)', count: allocations.length };
  }

  let lockedCount = 0;
  for (const a of allocations) {
    if (!a.classId || !a.staffId) continue;

    await M.CurriculumAssignment.findOneAndUpdate(
      {
        classId: a.classId,
        subjectId: a.subjectId,
        component: a.component || 'both'
      },
      {
        classId: a.classId,
        subjectId: a.subjectId,
        subjectShortName: a.subjectName,
        staffId: a.staffId,
        staffName: a.staffName,
        periodsPerWeek: a.periodsPerWeek || 5,
        component: a.component || 'both',
        reason: a.reason || ''
      },
      { upsert: true, returnDocument: 'after' }
    );
    lockedCount++;
  }

  await logAction({
    action: 'LOCK_STAFF_ALLOCATIONS',
    category: 'TIMETABLE',
    details: { batch, deptId, lockedCount },
    user: user || { name: 'System' }
  });

  return { ok: true, message: `Successfully locked ${lockedCount} curriculum assignments.`, count: lockedCount };
}

module.exports = {
  getTeacherAllowedLoad,
  computeSeniorityScore,
  proposeAllocations,
  lockAllocations,
};
