const M = require('../models');
const { getSettings } = require('./settingsCache');
const { logAction } = require('./logAction');

/**
 * utils/trustEngine.js
 *
 * Electronic Attendance Management System (EAMS) - Trust Score Engine (§7, §8, §15, T4.1)
 * Manages immutable TrustEvent ledger operations, band computation, locks, and self-attendance gating.
 */

const DEFAULT_BANDS = {
  normal: 80,
  monitor: 60,
  verify: 40
};

/**
 * Computes trust band from numeric score (§3, §8)
 * @param {number} score - 0 to 100
 * @param {object} [bandsConfig] - { normal: 80, monitor: 60, verify: 40 }
 * @returns {'normal'|'monitor'|'verify'|'disabled'}
 */
function computeTrustBand(score, bandsConfig) {
  const bands = bandsConfig || DEFAULT_BANDS;
  const num = typeof score === 'number' ? score : 100;
  if (num >= (bands.normal || 80)) return 'normal';
  if (num >= (bands.monitor || 60)) return 'monitor';
  if (num >= (bands.verify || 40)) return 'verify';
  return 'disabled';
}

/**
 * Applies a TrustEvent delta and updates the student cache in an idempotent manner (§8).
 *
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.studentId
 * @param {string} [params.studentTrackId]
 * @param {string} params.type - Enum from TrustEvent schema
 * @param {number} [params.delta=0] - Point change (positive or negative)
 * @param {string} params.refKey - Unique idempotency key (e.g. 'UNINFORMED_ABSENCE:2026-10-04')
 * @param {object} [params.refs] - { sessionTrackId, date, disputeId, caseId, reversesEventId }
 * @param {string} [params.reason='']
 * @param {object|string} [params.actor='system'] - 'system' or { trackId, name, role }
 * @param {number} [params.lockDays] - Number of days to lock self-attendance (optional)
 * @param {string} [params.lockReason] - Reason for lock (optional)
 * @param {string} [params.ip='']
 * @returns {Promise<object>} Outcome { ok, applied, idempotent, event, studentTrust }
 */
async function applyTrustEvent(params) {
  const {
    studentId,
    studentTrackId,
    type,
    delta = 0,
    refKey,
    refs = {},
    reason = '',
    actor = 'system',
    lockDays = 0,
    lockReason = '',
    ip = ''
  } = params;

  if (!studentId || !refKey || !type) {
    return { ok: false, error: 'studentId, refKey, and type are required', code: 'INVALID_PARAMS' };
  }

  // 1. Idempotency Check: if event with refKey already exists for student, do NOT reapply (§8)
  const existingEvent = await M.TrustEvent.findOne({ studentId, refKey }).lean();
  if (existingEvent) {
    const student = await M.Student.findById(studentId).lean();
    return {
      ok: true,
      applied: false,
      idempotent: true,
      event: existingEvent,
      studentTrust: student?.trust || { score: existingEvent.after, band: computeTrustBand(existingEvent.after) }
    };
  }

  // 2. Fetch student document
  const student = await M.Student.findById(studentId);
  if (!student) {
    return { ok: false, error: 'Student record not found', code: 'STUDENT_NOT_FOUND' };
  }

  // 3. Score Calculation & Clamping (0–100)
  const before = typeof student.trust?.score === 'number' ? student.trust.score : 100;
  let after = before + (Number(delta) || 0);
  after = Math.max(0, Math.min(100, Math.round(after)));

  // 4. Resolve band from settings
  const settingsMap = await getSettings(['trust']);
  const band = computeTrustBand(after, settingsMap?.trust?.bands);

  // 5. Lock Evaluation (§4, §7.2, §8)
  let lockedUntil = student.trust?.lockedUntil || null;
  let currentLockReason = student.trust?.lockReason || '';
  let currentLockEventId = student.trust?.lockEventId || '';

  const eventId = 'TE-' + Math.random().toString(36).substring(2, 9).toUpperCase() + Date.now().toString(36).toUpperCase();

  if (lockDays && lockDays > 0) {
    lockedUntil = new Date(Date.now() + lockDays * 24 * 60 * 60 * 1000);
    currentLockReason = lockReason || reason || 'Administrative lock';
    currentLockEventId = eventId;
  } else if (type === 'UNLOCK' || type === 'ADMIN_RESET') {
    lockedUntil = null;
    currentLockReason = '';
    currentLockEventId = '';
  }

  // 6. Create immutable TrustEvent ledger record
  const newEvent = new M.TrustEvent({
    eventId,
    studentId: student._id,
    studentTrackId: studentTrackId || student.trackId,
    type,
    delta: Number(delta) || 0,
    before,
    after,
    refKey,
    refs: refs || {},
    reason: reason || '',
    actor: actor || 'system',
    at: new Date()
  });

  await newEvent.save();

  // 7. Update Student cache
  student.trust = {
    score: after,
    band,
    lockedUntil,
    lockReason: currentLockReason,
    lockEventId: currentLockEventId,
    updatedAt: new Date()
  };

  await student.save();

  // 8. Audit log Action
  try {
    const actorTrackId = typeof actor === 'object' && actor ? (actor.trackId || '') : 'system';
    const actorName = typeof actor === 'object' && actor ? (actor.name || '') : 'System Engine';
    const actorRole = typeof actor === 'object' && actor ? (actor.role || 'system') : 'system';

    logAction(
      actorTrackId || student.trackId,
      actorName,
      actorRole,
      `Trust Score Changed: ${type}`,
      `Trust delta ${delta > 0 ? '+' + delta : delta} applied to student ${student.registerNo || student.username} (${before} -> ${after}). Reason: ${reason || 'N/A'}${lockDays ? ` (Locked for ${lockDays}d)` : ''}`,
      'trust',
      'info',
      ip || '127.0.0.1',
      '',
      {
        module: 'trust',
        subType: type,
        studentTrackId: student.trackId,
        refKey,
        eventId,
        delta,
        before,
        after
      }
    ).catch(() => {});
  } catch (logErr) {}

  return {
    ok: true,
    applied: true,
    event: newEvent,
    studentTrust: student.trust
  };
}

/**
 * Checks whether self-attendance is currently allowed for student (§7.2)
 * @param {object} student - Student doc or lean object
 * @returns {{ allowed: boolean, isLocked?: boolean, code?: string, reason?: string }}
 */
function isSelfAttendanceAllowed(student) {
  if (!student) {
    return { allowed: false, code: 'STUDENT_NOT_FOUND', reason: 'Student not found' };
  }

  const trust = student.trust || {};
  const score = typeof trust.score === 'number' ? trust.score : 100;
  const lockedUntil = trust.lockedUntil ? new Date(trust.lockedUntil) : null;
  const isLocked = Boolean(lockedUntil && lockedUntil > new Date());

  if (isLocked) {
    const untilStr = lockedUntil.toLocaleDateString();
    return {
      allowed: false,
      isLocked: true,
      code: 'SELF_ATTENDANCE_LOCKED',
      reason: `Self-attendance is locked until ${untilStr}. Reason: ${trust.lockReason || 'Administrative lock'}. Please meet your department admin with your advisor's consent.`
    };
  }

  if (score < 40) {
    return {
      allowed: false,
      isLocked: false,
      code: 'TRUST_SCORE_LOW',
      reason: `Self-attendance disabled because your trust score (${score}) is below 40. Manual attendance required. Please meet your department admin.`
    };
  }

  return {
    allowed: true,
    score,
    band: trust.band || computeTrustBand(score)
  };
}

/**
 * Retrieves student trust ledger history (§10, T4.6)
 * @param {string|mongoose.Types.ObjectId} studentId
 * @param {object} [options] - { limit: 50, skip: 0 }
 */
async function getStudentTrustLedger(studentId, options = {}) {
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 50));
  const skip = Math.max(0, Number(options.skip) || 0);

  const [events, total] = await Promise.all([
    M.TrustEvent.find({ studentId })
      .sort({ at: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    M.TrustEvent.countDocuments({ studentId })
  ]);

  return { events, total, limit, skip };
}

module.exports = {
  computeTrustBand,
  applyTrustEvent,
  isSelfAttendanceAllowed,
  getStudentTrustLedger,
  DEFAULT_BANDS
};
