const mongoose = require('mongoose');
const M = require('../models');
const { isSudoAdmin } = require('./access');
const { readOverrideSlot, refMatches, getTeacherIdentity, normName, resolveTeacherRange } = require('./teacherSchedule');
const { getSetting } = require('./settingsCache');
const { todayIST } = require('./institutionTime');

const isValidObjId = (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && id.length === 24;

/**
 * Verifies whether a teacher is assigned to a specific class and subject.
 * Admins and Sub-admins bypass this verification.
 * If no assignments exist in the entire system, gracefully allows marking to prevent onboarding lockouts.
 * Also permits substitute teachers if an active Override exists for that date, period, and class.
 * 
 * @param {Object} user - The authenticated user object (from req.user)
 * @param {string|Object} classIdInput - Class ID, trackId, or Class document
 * @param {string|Object} subjectIdInput - Subject ID, trackId, code, or Subject document
 * @param {Object} [context] - Optional context containing { date, periodNumber }
 * @returns {Promise<{ allowed: boolean, reason?: string, assignment?: Object, via?: string, overrideId?: any }>}
 */
async function verifyTeacherAssignment(user, classIdInput, subjectIdInput, context = {}) {
  if (!user) {
    return { allowed: false, reason: 'Authentication required' };
  }

  // Sudo admin bypass
  if (isSudoAdmin(user)) {
    return { allowed: true };
  }

  if (user.role !== 'teacher') {
    return { allowed: false, reason: 'Only teachers and administrators can manage class attendance.' };
  }

  try {
    const modelsSettings = await getSetting('models');
    const featSettings = await getSetting('features');
    const ttSettings = await getSetting('timetable');
    const attendanceLinkEnabled = Boolean(
      (modelsSettings?.timetable?.attendanceLink !== undefined)
        ? modelsSettings.timetable.attendanceLink
        : ((featSettings?.timetable?.attendanceLink !== undefined)
            ? featSettings.timetable.attendanceLink
            : ttSettings?.attendanceLink)
    );

    const totalAssignments = await M.Assignment.countDocuments();
    // Graceful onboarding bypass if assignments collection is empty ONLY when attendanceLink is disabled
    if (totalAssignments === 0 && !attendanceLinkEnabled) {
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

    // Session-based Authority Check (Section 10.4, C16)
    // A teacher scheduled or substituted on today's ClassSession retains valid authority
    if (context && (context.sessionId || context.date || context.periodNumber || context.period)) {
      let sessionDoc = null;
      if (context.sessionId && mongoose.isValidObjectId(context.sessionId)) {
        sessionDoc = await M.ClassSession.findById(context.sessionId).lean();
      } else if (context.date && (context.periodNumber || context.period)) {
        const rawDate = context.date;
        const dateStr = typeof rawDate === 'string'
          ? rawDate.split('T')[0]
          : (rawDate instanceof Date ? todayIST(rawDate) : '');
        const pNum = Number(context.periodNumber || context.period || 1);
        if (dateStr && !isNaN(pNum)) {
          sessionDoc = await M.ClassSession.findOne({
            date: dateStr,
            classId: { $in: uniqueClassCandidates },
            periodNumber: pNum
          }).lean();
        }
      }

      if (sessionDoc) {
        const schedId = sessionDoc.scheduledTeacher?.trackId || '';
        const actualId = sessionDoc.actualTeacher?.trackId || '';
        const isSessionTeacher = uniqueTeacherCandidates.some(tc =>
          (schedId && String(schedId).trim() === String(tc).trim()) ||
          (actualId && String(actualId).trim() === String(tc).trim()) ||
          (sessionDoc.scheduledTeacher?.name && normName(sessionDoc.scheduledTeacher.name) === normName(tc)) ||
          (sessionDoc.actualTeacher?.name && normName(sessionDoc.actualTeacher.name) === normName(tc))
        );

        if (isSessionTeacher) {
          return {
            allowed: true,
            via: 'session',
            session: sessionDoc
          };
        }
      }
    }

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
      // Check substitute teacher authorization via Day Override
      if (context && (context.date || context.periodNumber || context.period)) {
        const rawDate = context.date;
        const pNum = Number(context.periodNumber || context.period || 1);
        let startOfUtc = null;
        let endOfUtc = null;
        let dateStr = '';

        if (rawDate) {
          dateStr = typeof rawDate === 'string'
            ? rawDate.split('T')[0]
            : (rawDate instanceof Date ? todayIST(rawDate) : '');
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            startOfUtc = new Date(dateStr + 'T00:00:00.000Z');
            endOfUtc = new Date(dateStr + 'T23:59:59.999Z');
          }
        }

        if (startOfUtc && endOfUtc && !isNaN(pNum)) {
          const objIdCandidates = uniqueClassCandidates.filter(c => isValidObjId(c)).map(c => new mongoose.Types.ObjectId(c));
          if (objIdCandidates.length > 0) {
            const targetPQuery = (Array.isArray(context.periodNumbers) && context.periodNumbers.length)
              ? { $in: context.periodNumbers }
              : pNum;
            const ovQuery = {
              type: 'substitute',
              date: { $gte: startOfUtc, $lte: endOfUtc },
              period: targetPQuery,
              classId: { $in: objIdCandidates }
            };

            const matchingOverrides = await M.Override.find(ovQuery).lean();
            if (matchingOverrides.length > 0) {
              const idn = await getTeacherIdentity(user);
              for (const ov of matchingOverrides) {
                const slotInfo = readOverrideSlot(ov.newSlot);
                const isMatch = (idn && refMatches(slotInfo, idn)) ||
                  uniqueTeacherCandidates.some(tc =>
                    (slotInfo.teacherTrackId && String(slotInfo.teacherTrackId).trim() === String(tc).trim()) ||
                    (slotInfo.teacherId && String(slotInfo.teacherId).trim() === String(tc).trim()) ||
                    (slotInfo.teacher && normName(slotInfo.teacher) === normName(tc))
                  );

                if (isMatch) {
                  return {
                    allowed: true,
                    via: 'substitution',
                    overrideId: ov._id,
                    assignment: null
                  };
                }
              }
            }
          }

          // Check if teacher is the scheduled faculty for this slot in the timetable
          const idn = await getTeacherIdentity(user);
          if (idn) {
            const days = await resolveTeacherRange(idn, dateStr, dateStr);
            const daySlots = (days && days[0] && Array.isArray(days[0].slots))
              ? days[0].slots.filter(s => s.status === 'scheduled')
              : [];

            const slotMatch = daySlots.find(s => {
              const matchPeriod = s.periodNumber === pNum || (Array.isArray(s.periods) && s.periods.includes(pNum));
              if (!matchPeriod) return false;
              const matchClass = uniqueClassCandidates.some(c =>
                String(s.classId) === String(c) || (s.className && s.className.toLowerCase() === String(c).toLowerCase())
              );
              if (!matchClass) return false;
              if (uniqueSubjectCandidates.length > 0) {
                const matchSub = uniqueSubjectCandidates.some(subId =>
                  String(s.subjectId) === String(subId) ||
                  (s.subject && s.subject.toLowerCase() === String(subId).toLowerCase()) ||
                  (s.subjectName && s.subjectName.toLowerCase() === String(subId).toLowerCase())
                );
                if (!matchSub) return false;
              }
              return true;
            });

            if (slotMatch) {
              return {
                allowed: true,
                via: 'timetable',
                assignment: null,
                slot: slotMatch
              };
            }
          }
        }
      }

      if (attendanceLinkEnabled) {
        return {
          allowed: false,
          reason: 'You are not assigned to this class and subject, and have no scheduled session authority.'
        };
      }

      // Verify timetableMatch / forceTimetableSlots policy for unassigned combinations
      const attSettings = await getSetting('attendance');
      const isStrict = !!(attSettings && attSettings.forceTimetableSlots);
      const matchPolicy = isStrict ? 'block' : (attSettings?.timetableMatch || 'warn');

      if (matchPolicy === 'allow') {
        return {
          allowed: true,
          via: 'open_mode',
          assignment: null
        };
      }
      if (matchPolicy === 'warn') {
        return {
          allowed: true,
          via: 'unscheduled_warn',
          warning: 'Unscheduled combination: You are not assigned to teach this class and subject combination.',
          assignment: null
        };
      }
      return {
        allowed: false,
        reason: 'Timetable Match Policy (Block): You are not assigned to teach this class and subject combination.'
      };
    }

    if (attendanceLinkEnabled) {
      return {
        allowed: false,
        reason: 'You are not assigned to this class and subject, and have no scheduled session authority.'
      };
    }

    // Verify timetable schedule matching policy (allow, warn, block)
    const attSettings = await getSetting('attendance');
    const isStrict = !!(attSettings && attSettings.forceTimetableSlots);
    const matchPolicy = isStrict ? 'block' : (attSettings?.timetableMatch || 'warn');

    if (matchPolicy !== 'allow' && !isSudoAdmin(user)) {
      const rawDate = context.date;
      const dateStr = typeof rawDate === 'string'
        ? rawDate.split('T')[0]
        : (rawDate instanceof Date ? todayIST(rawDate) : '');
      const pNum = Number(context.periodNumber || context.period || 1);

      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(pNum)) {
        const idn = await getTeacherIdentity(user);
        if (!idn) {
          if (matchPolicy === 'block') {
            return { allowed: false, reason: 'Teacher identity not found for timetable verification.' };
          }
        } else {
          const days = await resolveTeacherRange(idn, dateStr, dateStr);
          const daySlots = (days && days[0] && Array.isArray(days[0].slots))
            ? days[0].slots.filter(s => s.status === 'scheduled')
            : [];

          const slotMatch = daySlots.find(s => {
            const matchPeriod = s.periodNumber === pNum || (Array.isArray(s.periods) && s.periods.includes(pNum));
            if (!matchPeriod) return false;
            const matchClass = uniqueClassCandidates.some(c =>
              String(s.classId) === String(c) || (s.className && s.className.toLowerCase() === String(c).toLowerCase())
            );
            if (!matchClass) return false;
            if (uniqueSubjectCandidates.length > 0) {
              const matchSub = uniqueSubjectCandidates.some(subId =>
                String(s.subjectId) === String(subId) ||
                (s.subject && s.subject.toLowerCase() === String(subId).toLowerCase()) ||
                (s.subjectName && s.subjectName.toLowerCase() === String(subId).toLowerCase())
              );
              if (!matchSub) return false;
            }
            return true;
          });

          if (!slotMatch) {
            if (matchPolicy === 'block') {
              return {
                allowed: false,
                reason: 'Timetable Match Policy (Block): Attendance marking is restricted to scheduled timetable slots and approved substitutions only.'
              };
            } else if (matchPolicy === 'warn') {
              return {
                allowed: true,
                assignment,
                via: 'unscheduled_warn',
                warning: 'Unscheduled period: This period is not on your scheduled timetable for today.'
              };
            }
          } else {
            return {
              allowed: true,
              assignment,
              via: slotMatch.role === 'substitute' ? 'substitution' : 'timetable',
              slot: slotMatch
            };
          }
        }
      }
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
  if (isSudoAdmin(user)) return true;

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
