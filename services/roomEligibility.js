/**
 * services/roomEligibility.js
 *
 * Registered Rooms & Eligibility Engine (Phase 4):
 * - Replaces free-text room strings everywhere in timetable scheduling.
 * - Strict reference to registered Room documents by ObjectId.
 * - Enforces category and type eligibility matrix:
 *     Theory: category in ['Room', 'Hall'] AND type in ['Theory', 'Seminar']
 *     Lab: category === 'Lab' OR type in ['Lab', 'Workshop']
 *     Seminar: type === 'Seminar' OR category === 'Hall'
 *     Training: category in ['Room', 'Hall', 'Lab']
 * - Campus invariants:
 *     status: 'Available' ONLY (rejects Maintenance, Reserved, Inactive)
 *     building.type: 'Academic' | 'Laboratory' ONLY
 */

'use strict';

const mongoose = require('mongoose');
const M = require('../models');

const ELIGIBLE_BUILDING_TYPES = new Set(['Academic', 'Laboratory']);

/**
 * Normalizes slot type string to canonical type
 */
function normalizeSlotType(slotType, isLab) {
  if (isLab) return 'Lab';
  if (!slotType) return 'Theory';
  const s = String(slotType).trim().toLowerCase();
  if (s.includes('lab') || s.includes('workshop') || s.includes('practical')) return 'Lab';
  if (s.includes('seminar') || s.includes('symposium')) return 'Seminar';
  if (s.includes('train') || s.includes('placement') || s.includes('career')) return 'Training';
  return 'Theory';
}

/**
 * Checks eligibility of a room document for a specific slot type.
 *
 * @param {Object} room - The Room mongoose/lean document (with building populated or buildingType attached)
 * @param {String} slotType - 'Theory' | 'Lab' | 'Seminar' | 'Training'
 * @param {Object} options - { isLab: Boolean, enrolledCount: Number, minCapacity: Number }
 * @returns {{ eligible: Boolean, code: String, reason: String, room: Object }}
 */
function checkRoomEligibility(room, slotType = 'Theory', options = {}) {
  if (!room || typeof room !== 'object' || (!room._id && !room.id)) {
    return {
      eligible: false,
      code: 'ROOM_NOT_REGISTERED',
      reason: 'Room is not a registered campus facility.',
      room: null
    };
  }

  // 1. Status Invariant: status must be 'Available'
  const status = String(room.status || 'Available').trim();
  if (status.toLowerCase() !== 'available') {
    const latestHistory = Array.isArray(room.statusHistory) && room.statusHistory.length
      ? room.statusHistory[room.statusHistory.length - 1]
      : null;
    const reasonText = latestHistory?.reason ? ` (${latestHistory.reason})` : '';
    return {
      eligible: false,
      code: 'ROOM_UNAVAILABLE',
      reason: `Room ${room.hallNo || room.name || 'selected'} is currently unavailable [${status}]${reasonText}.`,
      room
    };
  }

  // 2. Building Invariant: building.type must be 'Academic' or 'Laboratory'
  let buildingType = null;
  if (room.buildingId && typeof room.buildingId === 'object' && room.buildingId.type) {
    buildingType = room.buildingId.type;
  } else if (room.buildingType) {
    buildingType = room.buildingType;
  }

  if (buildingType && !ELIGIBLE_BUILDING_TYPES.has(buildingType)) {
    return {
      eligible: false,
      code: 'BUILDING_INELIGIBLE',
      reason: `Building ${room.buildingName || ''} (${buildingType}) is not designated for academic instruction.`,
      room
    };
  }

  // 3. Category & Type Matrix
  const targetType = normalizeSlotType(slotType, options.isLab);
  const cat = String(room.category || 'Room').trim();
  const roomType = String(room.type || 'Theory').trim();

  let matchesCategory = false;

  switch (targetType) {
    case 'Theory':
      // Theory requires category Room/Hall AND type Theory/Seminar
      matchesCategory = ['Room', 'Hall'].includes(cat) && ['Theory', 'Seminar'].includes(roomType);
      if (!matchesCategory) {
        return {
          eligible: false,
          code: 'ROOM_NOT_ELIGIBLE',
          reason: `Theory slots require category Room/Hall and type Theory/Seminar (got category '${cat}', type '${roomType}').`,
          room
        };
      }
      break;

    case 'Lab':
      // Lab requires category Lab OR type Lab/Workshop
      matchesCategory = cat === 'Lab' || ['Lab', 'Workshop'].includes(roomType);
      if (!matchesCategory) {
        return {
          eligible: false,
          code: 'ROOM_NOT_ELIGIBLE',
          reason: `Lab slots require category Lab or type Lab/Workshop (got category '${cat}', type '${roomType}').`,
          room
        };
      }
      break;

    case 'Seminar':
      // Seminar requires type Seminar OR category Hall
      matchesCategory = roomType === 'Seminar' || cat === 'Hall';
      if (!matchesCategory) {
        return {
          eligible: false,
          code: 'ROOM_NOT_ELIGIBLE',
          reason: `Seminar slots require type Seminar or category Hall (got category '${cat}', type '${roomType}').`,
          room
        };
      }
      break;

    case 'Training':
      // Training requires category Room, Hall, or Lab
      matchesCategory = ['Room', 'Hall', 'Lab'].includes(cat);
      if (!matchesCategory) {
        return {
          eligible: false,
          code: 'ROOM_NOT_ELIGIBLE',
          reason: `Training slots require category Room, Hall, or Lab (got category '${cat}').`,
          room
        };
      }
      break;

    default:
      matchesCategory = true;
  }

  // 4. Capacity & Workstations
  const enrolledCount = Number(options.enrolledCount || options.minCapacity || 0);
  if (enrolledCount > 0 && room.capacity && room.capacity < enrolledCount) {
    return {
      eligible: false,
      code: 'CAPACITY_EXCEEDED',
      reason: `Class enrolled strength (${enrolledCount}) exceeds room capacity (${room.capacity}).`,
      room
    };
  }

  return {
    eligible: true,
    code: 'OK',
    reason: 'Room meets all academic and facility eligibility requirements.',
    room
  };
}

/**
 * Validates a timetable slot's room assignment.
 * Rejects free-text strings without registered roomId.
 *
 * @param {Object} slot - { room, roomId, type, isLab }
 * @param {Object} context - { roomMap: Map<id, roomDoc>, enrolledCount: Number }
 * @returns {{ ok: Boolean, error?: String, code?: String, room?: Object }}
 */
async function validateSlotRoom(slot, context = {}) {
  if (!slot) return { ok: true };

  const roomId = slot.roomId;
  const roomString = slot.room ? String(slot.room).trim() : '';

  // If slot specifies no room, allow if room is optional in context
  if (!roomId && !roomString) {
    return { ok: true, room: null };
  }

  // If slot has a free-text room string but no roomId
  if (!roomId && roomString) {
    return {
      ok: false,
      code: 'ROOM_NOT_REGISTERED',
      error: `Free-text room '${roomString}' is not permitted. Please select a registered campus room.`
    };
  }

  // Resolve room document
  let roomDoc = null;
  const roomKey = String(roomId);

  if (context.roomMap && context.roomMap.has(roomKey)) {
    roomDoc = context.roomMap.get(roomKey);
  } else {
    roomDoc = await M.Room.findById(roomId).populate('buildingId').lean();
  }

  if (!roomDoc) {
    return {
      ok: false,
      code: 'ROOM_NOT_REGISTERED',
      error: `Room ID '${roomId}' does not exist in the campus facility registry.`
    };
  }

  const eligibility = checkRoomEligibility(roomDoc, slot.type, {
    isLab: slot.isLab,
    enrolledCount: context.enrolledCount
  });

  if (!eligibility.eligible) {
    return {
      ok: false,
      code: eligibility.code,
      error: eligibility.reason,
      room: roomDoc
    };
  }

  return {
    ok: true,
    code: 'OK',
    room: roomDoc
  };
}

/**
 * Retrieves eligible rooms matching a given query, enriched with availability, home room flag, and building tree.
 *
 * @param {Object} query - { slotType, isLab, classId, deptId, minCapacity, search }
 * @returns {Promise<Array>}
 */
async function getEligibleRooms(query = {}) {
  const { slotType = 'Theory', isLab, classId, deptId, minCapacity, search } = query;

  // 1. Fetch Class if classId provided to identify Home Room and student count
  let homeRoomId = null;
  let enrolledCount = 0;
  if (classId && mongoose.isValidObjectId(classId)) {
    const classDoc = await M.Class.findById(classId).select('roomId studentCount enrolledCount').lean();
    if (classDoc) {
      if (classDoc.roomId) homeRoomId = String(classDoc.roomId);
      enrolledCount = Number(classDoc.studentCount || classDoc.enrolledCount || 0);
    }
  }

  const effectiveMinCapacity = minCapacity ? Number(minCapacity) : enrolledCount;

  // 2. Fetch Buildings (filter for Academic and Laboratory)
  const buildings = await M.Building.find({
    status: { $ne: 'Inactive' },
    type: { $in: ['Academic', 'Laboratory'] }
  }).lean();

  const buildingIds = buildings.map(b => b._id);
  const buildingMap = new Map(buildings.map(b => [String(b._id), b]));

  // 3. Build Room query
  const roomFilter = {
    buildingId: { $in: buildingIds }
  };

  if (search && String(search).trim()) {
    const s = String(search).trim();
    roomFilter.$or = [
      { hallNo: { $regex: s, $options: 'i' } },
      { name: { $regex: s, $options: 'i' } },
      { deptName: { $regex: s, $options: 'i' } }
    ];
  }

  if (effectiveMinCapacity > 0) {
    roomFilter.capacity = { $gte: effectiveMinCapacity };
  }

  const rawRooms = await M.Room.find(roomFilter).sort({ buildingName: 1, floor: 1, hallNo: 1 }).lean();

  // 4. Enrich and check eligibility for each room
  const enriched = rawRooms.map(r => {
    const bld = buildingMap.get(String(r.buildingId));
    const roomWithBuilding = {
      ...r,
      buildingType: bld?.type || 'Academic',
      buildingSubName: bld?.subName || ''
    };

    const eligibility = checkRoomEligibility(roomWithBuilding, slotType, {
      isLab: Boolean(isLab),
      enrolledCount: effectiveMinCapacity
    });

    const isHomeRoom = homeRoomId ? String(r._id) === homeRoomId : false;

    return {
      _id: r._id,
      hallNo: r.hallNo,
      name: r.name,
      category: r.category,
      type: r.type,
      capacity: r.capacity,
      workstationsCount: r.workstationsCount || 0,
      buildingId: r.buildingId,
      buildingName: r.buildingName || bld?.name || '',
      buildingType: roomWithBuilding.buildingType,
      floor: r.floor,
      status: r.status,
      deptId: r.deptId,
      deptName: r.deptName,
      isHomeRoom,
      eligible: eligibility.eligible,
      eligibilityCode: eligibility.code,
      eligibilityReason: eligibility.reason
    };
  });

  return enriched;
}

module.exports = {
  checkRoomEligibility,
  validateSlotRoom,
  getEligibleRooms,
  normalizeSlotType,
  ELIGIBLE_BUILDING_TYPES
};
