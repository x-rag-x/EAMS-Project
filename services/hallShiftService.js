const mongoose = require('mongoose');
const M = require('../models');
const { logAction, getNextLogTrackId } = require('../utils/logAction');
const { DEFAULT_TIMINGS, timesOverlap, getSlotClockTimes } = require('./clashDetector');

const DOW_MAP = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Returns full Day name from YYYY-MM-DD
 */
function getDayNameFromDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return DOW_MAP[d.getDay()] || '';
}

/**
 * Detects clashes between an exam's hall allocations and regular class schedules.
 * Generates HallShift conflict documents for affected classes.
 */
async function detectHallShifts(examOrId) {
  const isDbConnected = (mongoose.connection && mongoose.connection.readyState === 1);
  if (!isDbConnected) return [];

  let exam = examOrId;
  if (typeof examOrId === 'string' || examOrId instanceof mongoose.Types.ObjectId) {
    exam = await M.Exam.findById(examOrId).lean();
  }
  if (!exam || !Array.isArray(exam.sessions)) return [];

  const createdShifts = [];

  try {
    for (const session of exam.sessions) {
      const halls = Array.isArray(session.halls) ? session.halls : [];
      if (!halls.length || !session.date) continue;

      const dayName = getDayNameFromDate(session.date);
      if (!dayName || dayName === 'Sunday') continue;

      const sessionStart = session.timing?.start || (session.session === 'AN' ? '13:30' : '09:30');
      const sessionEnd = session.timing?.end || (session.session === 'AN' ? '16:30' : '12:30');

      // Find published templates
      const templates = await M.SemesterTemplate.find({ status: 'published' }).lean();

      for (const t of templates) {
        if (!Array.isArray(t.grid)) continue;

        for (const slot of t.grid) {
          if (slot.day !== dayName || !slot.roomId) continue;

          // Check if slot uses one of exam's halls
          const isHallClash = halls.some(h => String(h) === String(slot.roomId));
          if (!isHallClash) continue;

          // Check clock-time overlap
          const slotTimes = getSlotClockTimes(slot, DEFAULT_TIMINGS.SET_1);
          if (timesOverlap(sessionStart, sessionEnd, slotTimes.start, slotTimes.end)) {
            // Find class name
            let className = slot.className || '';
            if (!className && t.classId) {
              const cls = await M.Class.findById(t.classId).lean();
              if (cls) className = cls.name || cls.section;
            }

            // Find alternative free rooms (right category, not in exam halls)
            const examHallIds = halls.map(String);
            const candidateRooms = await M.Room.find({
              _id: { $nin: examHallIds },
              category: { $in: ['Hall', 'Room', 'Theory'] },
              status: { $ne: 'Inactive' }
            }).limit(3).lean();

            const suggestedHalls = candidateRooms.map(r => ({
              hallId: r._id,
              hallName: r.hallNo || r.name,
              capacity: r.capacity || 60
            }));

            // Check if a shift already exists for this exam, date, and class
            const existing = await M.HallShift.findOne({
              examId: exam._id,
              date: session.date,
              classId: t.classId,
              currentHallId: slot.roomId,
              status: 'pending'
            });

            if (!existing) {
              const trackId = await getNextLogTrackId();
              const shift = new M.HallShift({
                trackId: `HS-${trackId}`,
                examId: exam._id,
                date: session.date,
                session: session.session || 'FN',
                classId: t.classId,
                className,
                currentHallId: slot.roomId,
                currentHall: slot.room || 'Current Hall',
                suggestedHalls,
                status: 'pending'
              });
              await shift.save();
              createdShifts.push(shift);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('Error in detectHallShifts:', err.message);
  }

  return createdShifts;
}

/**
 * Accepts a hall shift proposal and updates the class timetable slot room.
 */
async function acceptHallShift(shiftId, acceptedBy, chosenHallId = null) {
  const isDbConnected = (mongoose.connection && mongoose.connection.readyState === 1);
  if (!isDbConnected) {
    return { ok: true, message: 'Shift accepted (offline mode)' };
  }

  const shift = await M.HallShift.findById(shiftId);
  if (!shift) throw new Error('Hall shift document not found.');
  if (shift.status === 'accepted') throw new Error('Shift is already accepted.');

  const targetHallId = chosenHallId || (shift.suggestedHalls[0] && shift.suggestedHalls[0].hallId);
  if (!targetHallId) throw new Error('No target replacement hall available.');

  const targetRoomDoc = await M.Room.findById(targetHallId).lean();
  const targetHallName = targetRoomDoc ? (targetRoomDoc.hallNo || targetRoomDoc.name) : 'New Hall';

  // Update published SemesterTemplate
  if (shift.classId) {
    const dayName = getDayNameFromDate(shift.date);
    const template = await M.SemesterTemplate.findOne({ classId: shift.classId, status: 'published' });
    if (template && Array.isArray(template.grid)) {
      template.grid.forEach(s => {
        if (s.day === dayName && String(s.roomId) === String(shift.currentHallId)) {
          s.roomId = targetHallId;
          s.room = targetHallName;
          s.placementReason = `Relocated from ${shift.currentHall} due to exam hall reservation (Hall Shift ${shift.trackId})`;
        }
      });
      await template.save();
    }
  }

  shift.status = 'accepted';
  shift.acceptedBy = acceptedBy || 'TTC';
  shift.acceptedAt = new Date();
  await shift.save();

  await logAction({
    action: 'ACCEPT_HALL_SHIFT',
    category: 'TIMETABLE',
    details: { shiftId: shift._id, trackId: shift.trackId, newHall: targetHallName, date: shift.date },
    user: { name: acceptedBy || 'TTC' }
  });

  return {
    ok: true,
    message: `Hall shift accepted: relocated class to ${targetHallName}.`,
    shift
  };
}

/**
 * Releases all pending hall shifts for a cancelled or unfinalized exam.
 */
async function releaseHallShifts(examId) {
  const isDbConnected = (mongoose.connection && mongoose.connection.readyState === 1);
  if (!isDbConnected) return { ok: true, count: 0 };

  const res = await M.HallShift.updateMany(
    { examId, status: 'pending' },
    { $set: { status: 'released' } }
  );

  return { ok: true, count: res.modifiedCount || 0 };
}

module.exports = {
  detectHallShifts,
  acceptHallShift,
  releaseHallShifts,
  getDayNameFromDate
};
