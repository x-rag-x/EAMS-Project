const mongoose = require('mongoose');
const M = require('../models');

const isValidObjId = (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && id.length === 24;

/**
 * Verifies whether a teacher is assigned to a specific class and subject.
 * Admins and Sub-admins bypass this verification.
 * If no assignments exist in the entire system, gracefully allows marking to prevent onboarding lockouts.
 * 
 * @param {Object} user - The authenticated user object (from req.user)
 * @param {string|Object} classIdInput - Class ID, trackId, or Class document
 * @param {string|Object} subjectIdInput - Subject ID, trackId, code, or Subject document
 * @returns {Promise<{ allowed: boolean, reason?: string, assignment?: Object }>}
 */
async function verifyTeacherAssignment(user, classIdInput, subjectIdInput) {
  if (!user) {
    return { allowed: false, reason: 'Authentication required' };
  }

  // System admin bypass
  if (user.role === 'admin') {
    return { allowed: true };
  }

  // Teacher with full admin rights bypass
  if (user.role === 'teacher' && user.isAdmin === true) {
    return { allowed: true };
  }

  if (user.role !== 'teacher') {
    return { allowed: false, reason: 'Only teachers and administrators can manage class attendance.' };
  }

  try {
    const totalAssignments = await M.Assignment.countDocuments();
    // Graceful onboarding bypass if assignments collection is empty
    if (totalAssignments === 0) {
      return { allowed: true };
    }

    // Resolve teacher candidate identifiers
    const teacherCandidates = [
      user.trackId,
      user.roleId,
      user._id ? String(user._id) : null,
      user.username
    ].filter(Boolean);

    // Resolve class candidates
    const classCandidates = [];
    if (classIdInput) {
      if (typeof classIdInput === 'object' && classIdInput._id) {
        classCandidates.push(String(classIdInput._id));
        if (classIdInput.classTrackId) classCandidates.push(classIdInput.classTrackId);
        if (classIdInput.trackId) classCandidates.push(classIdInput.trackId);
        if (classIdInput.name) classCandidates.push(classIdInput.name);
      } else {
        const rawClassStr = String(classIdInput).trim();
        classCandidates.push(rawClassStr);

        const classQueries = [{ classTrackId: rawClassStr }, { trackId: rawClassStr }, { name: rawClassStr }];
        if (isValidObjId(rawClassStr)) {
          classQueries.unshift({ _id: new mongoose.Types.ObjectId(rawClassStr) });
        }
        const cls = await M.Class.findOne({ $or: classQueries }).lean();
        if (cls) {
          classCandidates.push(String(cls._id));
          if (cls.classTrackId) classCandidates.push(cls.classTrackId);
          if (cls.trackId) classCandidates.push(cls.trackId);
          if (cls.name) classCandidates.push(cls.name);
        }
      }
    }

    // Resolve subject candidates
    const subjectCandidates = [];
    if (subjectIdInput) {
      if (typeof subjectIdInput === 'object' && subjectIdInput._id) {
        subjectCandidates.push(String(subjectIdInput._id));
        if (subjectIdInput.subjectTrackId) subjectCandidates.push(subjectIdInput.subjectTrackId);
        if (subjectIdInput.subjectCode) subjectCandidates.push(subjectIdInput.subjectCode);
        if (subjectIdInput.code) subjectCandidates.push(subjectIdInput.code);
        if (subjectIdInput.name) subjectCandidates.push(subjectIdInput.name);
      } else {
        const rawSubStr = String(subjectIdInput).trim();
        subjectCandidates.push(rawSubStr);

        const subQueries = [
          { subjectTrackId: rawSubStr },
          { trackId: rawSubStr },
          { subjectCode: rawSubStr },
          { code: rawSubStr },
          { name: rawSubStr }
        ];
        if (isValidObjId(rawSubStr)) {
          subQueries.unshift({ _id: new mongoose.Types.ObjectId(rawSubStr) });
        }
        const sub = await M.Subject.findOne({ $or: subQueries }).lean();
        if (sub) {
          subjectCandidates.push(String(sub._id));
          if (sub.subjectTrackId) subjectCandidates.push(sub.subjectTrackId);
          if (sub.subjectCode) subjectCandidates.push(sub.subjectCode);
          if (sub.code) subjectCandidates.push(sub.code);
          if (sub.name) subjectCandidates.push(sub.name);
        }
      }
    }

    const uniqueTeacherCandidates = [...new Set(teacherCandidates)];
    const uniqueClassCandidates = [...new Set(classCandidates)];
    const uniqueSubjectCandidates = [...new Set(subjectCandidates)];

    const assignment = await M.Assignment.findOne({
      $and: [
        {
          $or: [
            { teacherId: { $in: uniqueTeacherCandidates } },
            { teacherTrackId: { $in: uniqueTeacherCandidates } }
          ]
        },
        {
          $or: [
            { classId: { $in: uniqueClassCandidates } },
            { classTrackId: { $in: uniqueClassCandidates } }
          ]
        },
        {
          $or: [
            { subjectId: { $in: uniqueSubjectCandidates } },
            { subjectTrackId: { $in: uniqueSubjectCandidates } }
          ]
        }
      ]
    }).lean();

    if (!assignment) {
      return {
        allowed: false,
        reason: 'You are not assigned to teach this class and subject combination.'
      };
    }

    return { allowed: true, assignment };
  } catch (err) {
    console.error('[verifyTeacherAssignment Error]:', err);
    return { allowed: false, reason: 'Failed to verify teacher assignment: ' + err.message };
  }
}

/**
 * Verifies whether the authenticated user is the owner of an attendance session or an admin.
 *
 * @param {Object} session - LiveSession, QuickPassSession, ScanLiveSession, or RepShareSession doc
 * @param {Object} user - req.user object
 * @returns {boolean}
 */
function verifySessionOwner(session, user) {
  if (!session || !user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'teacher' && user.isAdmin === true) return true;

  const userCandidates = [
    user.trackId,
    user.roleId,
    user._id ? String(user._id) : null
  ].filter(Boolean);

  const sessionTeacherCandidates = [
    session.teacherTrackId,
    session.teacherId ? String(session.teacherId) : null
  ].filter(Boolean);

  return userCandidates.some(uId => sessionTeacherCandidates.includes(uId));
}

module.exports = {
  verifyTeacherAssignment,
  verifySessionOwner
};
