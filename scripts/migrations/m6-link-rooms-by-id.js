/**
 * scripts/migrations/m6-link-rooms-by-id.js
 * Migration M6: Link Free-Text Rooms to Registered Room ObjectIds
 * 
 * Scans Assignment, Class, and WorkspaceClassDraft documents, mapping
 * free-text hall numbers to canonical Room._id references.
 *
 * Usage:
 *   node scripts/migrations/m6-link-rooms-by-id.js [--dry-run]
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const cfg = require('../../config');
const M = require('../../models');

/**
 * Normalizes room identifier for case-insensitive matching.
 */
function normalizeHallString(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase().replace(/[\s\-_]/g, '');
}

/**
 * Core migration runner callable via CLI or directly in tests.
 *
 * @param {Object} opts - { dryRun: Boolean }
 * @returns {Promise<Object>} Migration report
 */
async function linkRoomsById(opts = {}) {
  const isDryRun = opts.dryRun !== undefined ? opts.dryRun : process.argv.includes('--dry-run');

  if (opts.connect && mongoose.connection.readyState !== 1 && cfg.MONGO_URI) {
    try {
      await mongoose.connect(cfg.MONGO_URI, { dbName: cfg.DB_NAME, serverSelectionTimeoutMS: 2000 });
    } catch (_) {}
  }

  const rooms = await M.Room.find({}).lean();
  const roomMap = new Map();
  rooms.forEach(r => {
    if (r.hallNo) roomMap.set(normalizeHallString(r.hallNo), r);
    if (r.name) roomMap.set(normalizeHallString(r.name), r);
  });

  const report = {
    dryRun: isDryRun,
    assignmentsMatched: 0,
    assignmentsUnmatched: 0,
    classesMatched: 0,
    classesUnmatched: 0,
    draftSlotsMatched: 0,
    unmatchedHalls: []
  };

  // 1. Process Assignments
  const assignments = await M.Assignment.find({
    $or: [{ roomId: null }, { roomId: { $exists: false } }],
    hallNo: { $exists: true, $ne: '' }
  });

  for (const a of assignments) {
    const key = normalizeHallString(a.hallNo);
    const room = roomMap.get(key);
    if (room) {
      report.assignmentsMatched++;
      if (!isDryRun) {
        a.roomId = room._id;
        await a.save();
      }
    } else {
      report.assignmentsUnmatched++;
      if (!report.unmatchedHalls.includes(a.hallNo)) {
        report.unmatchedHalls.push(a.hallNo);
      }
    }
  }

  // 2. Process Classes
  const classes = await M.Class.find({
    $or: [{ roomId: null }, { roomId: { $exists: false } }],
    hallNo: { $exists: true, $ne: '' }
  });

  for (const c of classes) {
    const key = normalizeHallString(c.hallNo);
    const room = roomMap.get(key);
    if (room) {
      report.classesMatched++;
      if (!isDryRun) {
        c.roomId = room._id;
        await c.save();
      }
    } else {
      report.classesUnmatched++;
      if (!report.unmatchedHalls.includes(c.hallNo)) {
        report.unmatchedHalls.push(c.hallNo);
      }
    }
  }

  // 3. Process WorkspaceClassDrafts
  const drafts = await M.WorkspaceClassDraft.find({});
  for (const d of drafts) {
    let modified = false;
    const grid = d.grid || [];
    for (const slot of grid) {
      if (slot.room && !slot.roomId) {
        const key = normalizeHallString(slot.room);
        const room = roomMap.get(key);
        if (room) {
          slot.roomId = room._id;
          report.draftSlotsMatched++;
          modified = true;
        }
      }
    }
    if (modified && !isDryRun) {
      d.markModified('grid');
      await d.save();
    }
  }

  return report;
}

if (require.main === module) {
  linkRoomsById({ connect: true })
    .then(report => {
      console.log('--- Migration M6: Link Rooms By ID Completed ---');
      console.log(`Dry Run: ${report.dryRun}`);
      console.log(`Assignments Matched: ${report.assignmentsMatched}, Unmatched: ${report.assignmentsUnmatched}`);
      console.log(`Classes Matched: ${report.classesMatched}, Unmatched: ${report.classesUnmatched}`);
      console.log(`Draft Slots Matched: ${report.draftSlotsMatched}`);
      if (report.unmatchedHalls.length) {
        console.warn(`Unmatched free-text halls (${report.unmatchedHalls.length}):`, report.unmatchedHalls);
      }
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration M6 Error:', err);
      process.exit(1);
    });
}

module.exports = {
  linkRoomsById,
  normalizeHallString
};
