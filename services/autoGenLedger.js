const mongoose = require('mongoose');
const M = require('../models');
const { DEFAULT_TIMINGS, timesOverlap, getSlotClockTimes } = require('./clashDetector');

/**
 * Global Ledger (Phase 3)
 * Institutional multi-batch constraint ledger for faculty, room, and hall commitments.
 */
class GlobalLedger {
  constructor(options = {}) {
    this.targetBatch = options.targetBatch || '';
    this.timingSet = options.timingSet || DEFAULT_TIMINGS.SET_1;
    
    // Maps key: `${id}_${day}_${period}` -> slot metadata
    this.teacherSlots = new Map();
    this.roomSlots = new Map();
    
    // Map key: `${id}_${day}` -> array of time windows [{ start, end, slot, classId }]
    this.teacherClockWindows = new Map();
    this.roomClockWindows = new Map();

    // Conflict cards raised for other batches
    this.conflictCards = [];
    this.historyStack = [];
    this.checkpoints = [];
  }

  /**
   * Loads active Production timetable slots from other batches so they stay untouched.
   */
  async loadProductionSnapshots(excludeBatch = null) {
    const isDbConnected = (mongoose.connection && mongoose.connection.readyState === 1);
    if (!isDbConnected) return 0;

    let loadedCount = 0;
    try {
      const activeBatch = excludeBatch || this.targetBatch;
      const otherClasses = await M.Class.find(activeBatch ? { batch: { $ne: activeBatch } } : {}).lean();
      const otherClassIds = otherClasses.map(c => c._id);

      if (!otherClassIds.length) return 0;

      // 1. Read from SectionTimetable
      const sectionTables = await M.SectionTimetable.find({ classId: { $in: otherClassIds } }).lean();
      for (const st of sectionTables) {
        const slotsObj = st.slots || {};
        Object.keys(slotsObj).forEach(day => {
          const daySlots = slotsObj[day] || [];
          daySlots.forEach(slot => {
            if (slot && slot.period) {
              this.commitSlot(slot, st.classId, st.batch || 'Other Batch', true);
              loadedCount++;
            }
          });
        });
      }

      // 2. Read from published SemesterTemplate grids
      const publishedTemplates = await M.SemesterTemplate.find({
        classId: { $in: otherClassIds },
        status: 'published'
      }).lean();

      for (const t of publishedTemplates) {
        if (Array.isArray(t.grid)) {
          t.grid.forEach(slot => {
            if (slot && slot.day && slot.period) {
              this.commitSlot(slot, t.classId, 'Published Template', true);
              loadedCount++;
            }
          });
        }
      }
    } catch (err) {
      console.warn('Error loading production snapshots into ledger:', err.message);
    }

    return loadedCount;
  }

  /**
   * Checks if teacher is already occupied in clock time on given day
   */
  isTeacherBusy(teacherId, day, period, startTime = null, endTime = null) {
    if (!teacherId || !day || !period) return false;
    const tId = String(teacherId);

    // 1. Direct period check
    const pKey = `${tId}_${day}_${period}`;
    if (this.teacherSlots.has(pKey)) return true;

    // 2. Clock-time check across timing sets (e.g. SET_1 vs SET_2)
    if (startTime && endTime) {
      const wKey = `${tId}_${day}`;
      const windows = this.teacherClockWindows.get(wKey) || [];
      for (const win of windows) {
        if (timesOverlap(startTime, endTime, win.start, win.end)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Checks if room is already occupied
   */
  isRoomBusy(roomId, day, period, startTime = null, endTime = null) {
    if (!roomId || !day || !period) return false;
    const rId = String(roomId);

    // 1. Direct period check
    const pKey = `${rId}_${day}_${period}`;
    if (this.roomSlots.has(pKey)) return true;

    // 2. Clock-time check
    if (startTime && endTime) {
      const wKey = `${rId}_${day}`;
      const windows = this.roomClockWindows.get(wKey) || [];
      for (const win of windows) {
        if (timesOverlap(startTime, endTime, win.start, win.end)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Commits a slot to the ledger
   */
  commitSlot(slot, classId, batch = '', isProductionLocked = false) {
    if (!slot || !slot.day || !slot.period) return;
    const day = slot.day;
    const period = Number(slot.period);
    const times = getSlotClockTimes(slot, this.timingSet);

    const record = {
      ...slot,
      classId,
      batch: batch || this.targetBatch,
      isProductionLocked,
      start: times.start,
      end: times.end
    };

    // 1. Register teacher
    if (slot.teacherId) {
      const tId = String(slot.teacherId);
      const pKey = `${tId}_${day}_${period}`;
      this.teacherSlots.set(pKey, record);

      const wKey = `${tId}_${day}`;
      const wins = this.teacherClockWindows.get(wKey) || [];
      wins.push({ start: times.start, end: times.end, slot: record, classId });
      this.teacherClockWindows.set(wKey, wins);
    }

    // 2. Register room
    if (slot.roomId) {
      const rId = String(slot.roomId);
      const pKey = `${rId}_${day}_${period}`;
      this.roomSlots.set(pKey, record);

      const wKey = `${rId}_${day}`;
      const wins = this.roomClockWindows.get(wKey) || [];
      wins.push({ start: times.start, end: times.end, slot: record, classId });
      this.roomClockWindows.set(wKey, wins);
    }
  }

  /**
   * Removes a slot from the ledger
   */
  removeSlot(slot, classId) {
    if (!slot || !slot.day || !slot.period) return;
    const day = slot.day;
    const period = Number(slot.period);

    if (slot.teacherId) {
      const tId = String(slot.teacherId);
      this.teacherSlots.delete(`${tId}_${day}_${period}`);
      const wKey = `${tId}_${day}`;
      const wins = (this.teacherClockWindows.get(wKey) || []).filter(
        w => !(w.slot.period === period && String(w.classId) === String(classId))
      );
      this.teacherClockWindows.set(wKey, wins);
    }

    if (slot.roomId) {
      const rId = String(slot.roomId);
      this.roomSlots.delete(`${rId}_${day}_${period}`);
      const wKey = `${rId}_${day}`;
      const wins = (this.roomClockWindows.get(wKey) || []).filter(
        w => !(w.slot.period === period && String(w.classId) === String(classId))
      );
      this.roomClockWindows.set(wKey, wins);
    }
  }

  /**
   * Proposes a conflict card when another batch's slot needs to shift
   */
  proposeChange(otherBatch, change) {
    const cardId = `CARD-${Date.now()}-${this.conflictCards.length + 1}`;
    const card = {
      cardId,
      type: 'slot_change',
      batch: otherBatch,
      class: change.className || 'Class',
      teacher: change.teacherName || 'Faculty',
      subject: change.subjectName || 'Subject',
      from: change.from || { day: 'Monday', period: 1 },
      to: change.to || { day: 'Tuesday', period: 2 },
      reason: change.reason || 'Resolves faculty clash across batches',
      impact: change.impact || [],
      similar: change.similar || 0,
      status: 'pending'
    };
    this.conflictCards.push(card);
    return card;
  }

  /**
   * Accept conflict card
   */
  acceptCard(cardId) {
    const card = this.conflictCards.find(c => c.cardId === cardId);
    if (!card) return null;
    card.status = 'accepted';
    this.historyStack.push({ action: 'accept', cardId });
    return card;
  }

  /**
   * Deny conflict card
   */
  denyCard(cardId) {
    const card = this.conflictCards.find(c => c.cardId === cardId);
    if (!card) return null;
    card.status = 'denied';
    this.historyStack.push({ action: 'deny', cardId });
    return card;
  }

  /**
   * Undo last card action
   */
  undoLastCard() {
    const last = this.historyStack.pop();
    if (!last) return null;
    const card = this.conflictCards.find(c => c.cardId === last.cardId);
    if (card) card.status = 'pending';
    return card;
  }

  /**
   * Save ledger state checkpoint for backtracking
   */
  createCheckpoint() {
    const snap = {
      teacherSlots: new Map(this.teacherSlots),
      roomSlots: new Map(this.roomSlots),
      teacherClockWindows: new Map([...this.teacherClockWindows.entries()].map(([k, v]) => [k, [...v]])),
      roomClockWindows: new Map([...this.roomClockWindows.entries()].map(([k, v]) => [k, [...v]]))
    };
    this.checkpoints.push(snap);
    return this.checkpoints.length - 1;
  }

  /**
   * Restore ledger state from checkpoint
   */
  restoreCheckpoint(idx = null) {
    const snap = (idx !== null) ? this.checkpoints[idx] : this.checkpoints.pop();
    if (!snap) return;
    this.teacherSlots = new Map(snap.teacherSlots);
    this.roomSlots = new Map(snap.roomSlots);
    this.teacherClockWindows = new Map([...snap.teacherClockWindows.entries()].map(([k, v]) => [k, [...v]]));
    this.roomClockWindows = new Map([...snap.roomClockWindows.entries()].map(([k, v]) => [k, [...v]]));
  }
}

module.exports = {
  GlobalLedger,
};
