const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { hostelScopeMiddleware } = require('../middleware/hostelScope');
const { generateQRToken, verifyQRToken } = require('../utils/qrToken');
const { canOverrideStatus } = require('../utils/hostelPrecedence');
const { runHostelCrossChecks } = require('../utils/hostelCrossCheck');
const { verifyCampusGeofence } = require('../utils/geofence');
const { sanitizeToString } = require('../utils/sanitizeQuery');
const { todayIST } = require('../utils/institutionTime');

// SSE Tickets Map
const streamTickets = new Map();

function getTodayIST() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

// All hostel routes require authentication and hostel scope resolution
router.use(authMiddleware, hostelScopeMiddleware);

// ── 1. SETUP ENDPOINTS (Admin Only) ──────────────────────────────────────────

// List Hostels
router.get('/setup/hostels', async (req, res) => {
  try {
    const hostels = await M.Hostel.find().sort({ code: 1 }).lean();
    return res.json({ ok: true, data: hostels });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Create Hostel
router.post('/setup/hostels', async (req, res) => {
  try {
    if (!req.hostelScope.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { code, name, gender, geofence, curfew } = req.body;
    if (!code || !name || !gender) {
      return res.status(400).json({ error: 'Code, name, and gender are required' });
    }
    const hostel = await M.Hostel.create({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      gender,
      geofence: geofence || { lat: null, lng: null, radiusM: 250 },
      curfew: curfew || '21:00',
    });
    return res.json({ ok: true, message: 'Hostel created successfully', data: hostel });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Update Hostel
router.put('/setup/hostels/:id', async (req, res) => {
  try {
    if (!req.hostelScope.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { name, geofence, curfew, status } = req.body;
    const hostel = await M.Hostel.findByIdAndUpdate(
      req.params.id,
      { $set: { name, geofence, curfew, status } },
      { returnDocument: 'after' }
    );
    return res.json({ ok: true, message: 'Hostel updated successfully', data: hostel });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// List Blocks
router.get('/setup/blocks', async (req, res) => {
  try {
    const blocks = await M.Block.find().populate('hostelId').sort({ code: 1 }).lean();
    return res.json({ ok: true, data: blocks });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Create Block
router.post('/setup/blocks', async (req, res) => {
  try {
    if (!req.hostelScope.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { hostelId, code, name, floors, wardenTrackId } = req.body;
    if (!hostelId || !code || !name) {
      return res.status(400).json({ error: 'Hostel ID, code, and name are required' });
    }
    const block = await M.Block.create({
      hostelId,
      code: code.trim().toUpperCase(),
      name: name.trim(),
      floors: Number(floors) || 3,
      wardenTrackId: wardenTrackId || null,
    });
    return res.json({ ok: true, message: 'Block created successfully', data: block });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Update Block
router.put('/setup/blocks/:id', async (req, res) => {
  try {
    if (!req.hostelScope.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { name, floors, wardenTrackId } = req.body;
    const block = await M.Block.findByIdAndUpdate(
      req.params.id,
      { $set: { name, floors: Number(floors), wardenTrackId } },
      { returnDocument: 'after' }
    );
    return res.json({ ok: true, message: 'Block updated successfully', data: block });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Bulk Room Generator
router.post('/setup/rooms/generate', async (req, res) => {
  try {
    if (!req.hostelScope.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { blockId, floors, roomsPerFloor, bedsPerRoom, startFloor = 1 } = req.body;
    if (!blockId || !floors || !roomsPerFloor) {
      return res.status(400).json({ error: 'blockId, floors, and roomsPerFloor are required' });
    }

    const capacity = Number(bedsPerRoom) || 3;
    const bedLabels = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, capacity);
    const roomsToInsert = [];

    const fCount = Number(floors);
    const rCount = Number(roomsPerFloor);
    const sFloor = Number(startFloor);

    for (let f = sFloor; f < sFloor + fCount; f++) {
      for (let r = 1; r <= rCount; r++) {
        const roomNo = `${f}${String(r).padStart(2, '0')}`; // e.g. 101, 102
        roomsToInsert.push({
          blockId,
          floor: f,
          roomNo,
          capacity,
          beds: bedLabels,
          status: 'active',
        });
      }
    }

    // Upsert rooms so existing ones aren't wiped
    let createdCount = 0;
    for (const rData of roomsToInsert) {
      const exists = await M.HostelRoom.findOne({ blockId: rData.blockId, roomNo: rData.roomNo });
      if (!exists) {
        await M.HostelRoom.create(rData);
        createdCount++;
      }
    }

    return res.json({
      ok: true,
      message: `Generated ${createdCount} new rooms for block`,
      data: { createdCount, totalPlanned: roomsToInsert.length }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Vacate All Allocations for New Academic Year
router.post('/setup/new-year', async (req, res) => {
  try {
    if (!req.hostelScope.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { newAcademicYear } = req.body;
    if (!newAcademicYear) return res.status(400).json({ error: 'newAcademicYear is required' });

    const result = await M.HostelAllocation.updateMany(
      { status: 'approved' },
      {
        $set: { status: 'vacated' },
        $push: {
          history: {
            action: 'vacated_new_year',
            by: req.user.trackId || req.user.username,
            at: new Date(),
            note: `Reset for new academic year: ${newAcademicYear}`
          }
        }
      }
    );

    await M.Student.updateMany(
      { residency: 'hostel' },
      { $set: { currentAllocationId: null } }
    );

    return res.json({
      ok: true,
      message: `All active allocations vacated. Residents can now select beds for ${newAcademicYear}.`,
      data: { modifiedCount: result.modifiedCount }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// List Wardens (Teachers with isWarden)
router.get('/setup/wardens', async (req, res) => {
  try {
    const teachers = await M.Teacher.find({
      $or: [
        { 'specials.option': 'isWarden' },
        { designation: /warden/i }
      ]
    }).select('fullName username trackId email department specials').lean();
    return res.json({ ok: true, data: teachers });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── 2. ROOM & ALLOCATION ENDPOINTS ───────────────────────────────────────────

// Free Rooms & Beds
router.get('/rooms/free', async (req, res) => {
  try {
    const { blockId, floor } = req.query;
    const filter = { status: 'active' };
    if (blockId) filter.blockId = blockId;
    if (floor !== undefined) filter.floor = Number(floor);

    const rooms = await M.HostelRoom.find(filter).sort({ floor: 1, roomNo: 1 }).lean();
    if (!rooms.length) return res.json({ ok: true, data: [] });

    const roomIds = rooms.map(r => r._id);
    const activeAllocations = await M.HostelAllocation.find({
      roomId: { $in: roomIds },
      status: { $in: ['pending', 'approved'] },
    }).lean();

    const takenMap = new Map(); // roomId -> Set of taken beds
    for (const alloc of activeAllocations) {
      const rId = String(alloc.roomId);
      if (!takenMap.has(rId)) takenMap.set(rId, new Set());
      takenMap.get(rId).add(alloc.bed);
    }

    const result = rooms.map(r => {
      const taken = takenMap.get(String(r._id)) || new Set();
      const freeBeds = r.beds.filter(b => !taken.has(b));
      return {
        ...r,
        takenBeds: Array.from(taken),
        freeBeds,
        availableCount: freeBeds.length,
      };
    });

    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Student's Current Room & Bed Info
router.get('/my-room', async (req, res) => {
  try {
    if (!req.user.trackId) return res.status(400).json({ error: 'Missing user track ID' });
    const student = await M.Student.findOne({ trackId: req.user.trackId })
      .populate('hostelId')
      .populate('blockId')
      .lean();

    if (!student) return res.status(404).json({ error: 'Student record not found' });

    let allocation = null;
    if (student.currentAllocationId) {
      allocation = await M.HostelAllocation.findById(student.currentAllocationId)
        .populate({
          path: 'roomId',
          populate: { path: 'blockId', populate: { path: 'hostelId' } }
        }).lean();
    } else {
      allocation = await M.HostelAllocation.findOne({
        studentTrackId: student.trackId,
        status: { $in: ['pending', 'approved'] }
      }).populate({
        path: 'roomId',
        populate: { path: 'blockId', populate: { path: 'hostelId' } }
      }).sort({ createdAt: -1 }).lean();
    }

    return res.json({
      ok: true,
      data: {
        student,
        allocation,
        residency: student.residency || 'dayscholar',
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Student Request Bed Allocation
router.post('/allocations', async (req, res) => {
  try {
    const { roomId, bed, academicYear = '2026-2027' } = req.body;
    const studentTrackId = req.user.trackId;
    if (!roomId || !bed || !studentTrackId) {
      return res.status(400).json({ error: 'roomId and bed are required' });
    }

    const room = await M.HostelRoom.findById(roomId).populate('blockId').lean();
    if (!room) return res.status(404).json({ error: 'Room not found' });

    // Check if bed is already taken in this academic year
    const existing = await M.HostelAllocation.findOne({
      roomId,
      bed,
      academicYear,
      status: { $in: ['pending', 'approved'] },
    });
    if (existing) {
      return res.status(409).json({ error: `Bed ${bed} in room ${room.roomNo} is already occupied or held by another resident.` });
    }

    // Check if student already has a pending or approved allocation
    const currentStudentAlloc = await M.HostelAllocation.findOne({
      studentTrackId,
      academicYear,
      status: { $in: ['pending', 'approved'] },
    });
    if (currentStudentAlloc) {
      // Mark old allocation as vacated if changing
      currentStudentAlloc.status = 'vacated';
      currentStudentAlloc.history.push({
        action: 'changed_request',
        by: studentTrackId,
        at: new Date(),
        note: `Switched request to Room ${room.roomNo} Bed ${bed}`
      });
      await currentStudentAlloc.save();
    }

    const newAlloc = await M.HostelAllocation.create({
      studentTrackId,
      roomId,
      bed,
      academicYear,
      status: 'pending',
      requestedAt: new Date(),
      history: [{
        action: 'requested',
        by: studentTrackId,
        at: new Date(),
        note: `Resident requested Room ${room.roomNo} Bed ${bed}`
      }]
    });

    // Update student residency to hostel and link block/hostel
    await M.Student.findOneAndUpdate(
      { trackId: studentTrackId },
      {
        $set: {
          residency: 'hostel',
          hostelId: room.blockId.hostelId,
          blockId: room.blockId._id,
        }
      }
    );

    return res.json({
      ok: true,
      message: 'Bed requested successfully. Awaiting warden approval.',
      data: newAlloc
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Warden: List Allocations (e.g. pending approvals)
router.get('/allocations', async (req, res) => {
  try {
    const { status = 'pending', blockId } = req.query;
    const filter = {};
    if (status) filter.status = status;

    let targetBlockIds = [];
    if (blockId) {
      targetBlockIds = [blockId];
    } else if (req.hostelScope.isWarden) {
      targetBlockIds = req.hostelScope.assignedBlockIds;
    }

    const query = { ...filter };
    const allocs = await M.HostelAllocation.find(query)
      .populate({
        path: 'roomId',
        populate: { path: 'blockId', populate: { path: 'hostelId' } }
      })
      .sort({ requestedAt: -1 })
      .lean();

    // Filter by warden's assigned blocks
    const filtered = allocs.filter(a => {
      if (!a.roomId || !a.roomId.blockId) return false;
      const bId = String(a.roomId.blockId._id || a.roomId.blockId);
      if (targetBlockIds.length && !targetBlockIds.includes(bId)) return false;

      // HD15 rule: If block belongs to girls' hostel and user cannot see girls detail, exclude
      const isGirls = a.roomId.blockId.hostelId && a.roomId.blockId.hostelId.gender === 'girls';
      if (isGirls && !req.hostelScope.canSeeGirlsDetail) return false;

      return true;
    });

    // Attach student details
    const studentTrackIds = filtered.map(a => a.studentTrackId);
    const students = await M.Student.find({ trackId: { $in: studentTrackIds } })
      .select('fullName registerNo department class section phone guardians trackId')
      .lean();
    const studentMap = new Map(students.map(s => [s.trackId, s]));

    const enriched = filtered.map(a => ({
      ...a,
      student: studentMap.get(a.studentTrackId) || null,
    }));

    return res.json({ ok: true, data: enriched });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Warden: Approve Bed Allocation
router.post('/allocations/:id/approve', async (req, res) => {
  try {
    if (!req.hostelScope.isWarden && !req.hostelScope.isAdmin) {
      return res.status(403).json({ error: 'Warden or Admin access required' });
    }

    const alloc = await M.HostelAllocation.findById(req.params.id).populate('roomId');
    if (!alloc) return res.status(404).json({ error: 'Allocation not found' });

    alloc.status = 'approved';
    alloc.decidedBy = req.user.trackId || req.user.username;
    alloc.decidedAt = new Date();
    alloc.history.push({
      action: 'approved',
      by: req.user.trackId || req.user.username,
      at: new Date(),
      note: 'Warden approved bed allocation'
    });
    await alloc.save();

    // Set currentAllocationId on student
    await M.Student.findOneAndUpdate(
      { trackId: alloc.studentTrackId },
      { $set: { currentAllocationId: alloc._id, residency: 'hostel' } }
    );

    return res.json({ ok: true, message: 'Bed allocation approved successfully', data: alloc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Warden: Reject Bed Allocation
router.post('/allocations/:id/reject', async (req, res) => {
  try {
    if (!req.hostelScope.isWarden && !req.hostelScope.isAdmin) {
      return res.status(403).json({ error: 'Warden or Admin access required' });
    }
    const { reason = 'Rejected by warden' } = req.body;
    const alloc = await M.HostelAllocation.findById(req.params.id);
    if (!alloc) return res.status(404).json({ error: 'Allocation not found' });

    alloc.status = 'rejected';
    alloc.decidedBy = req.user.trackId || req.user.username;
    alloc.decidedAt = new Date();
    alloc.history.push({
      action: 'rejected',
      by: req.user.trackId || req.user.username,
      at: new Date(),
      note: reason
    });
    await alloc.save();

    return res.json({ ok: true, message: 'Bed allocation rejected', data: alloc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Warden: Move Resident to New Bed
router.post('/allocations/move', async (req, res) => {
  try {
    if (!req.hostelScope.isWarden && !req.hostelScope.isAdmin) {
      return res.status(403).json({ error: 'Warden or Admin access required' });
    }
    const { studentTrackId, newRoomId, newBed, reason = 'Room relocation' } = req.body;
    if (!studentTrackId || !newRoomId || !newBed) {
      return res.status(400).json({ error: 'studentTrackId, newRoomId, and newBed are required' });
    }

    // Check if new bed is free
    const isOccupied = await M.HostelAllocation.findOne({
      roomId: newRoomId,
      bed: newBed,
      status: { $in: ['pending', 'approved'] }
    });
    if (isOccupied) return res.status(409).json({ error: 'Target bed is already occupied' });

    // Vacate old allocation
    await M.HostelAllocation.updateMany(
      { studentTrackId, status: 'approved' },
      {
        $set: { status: 'vacated' },
        $push: {
          history: {
            action: 'moved_out',
            by: req.user.trackId || req.user.username,
            at: new Date(),
            note: reason
          }
        }
      }
    );

    // Create new approved allocation
    const newAlloc = await M.HostelAllocation.create({
      studentTrackId,
      roomId: newRoomId,
      bed: newBed,
      academicYear: '2026-2027',
      status: 'approved',
      requestedAt: new Date(),
      decidedBy: req.user.trackId || req.user.username,
      decidedAt: new Date(),
      history: [{
        action: 'moved_in',
        by: req.user.trackId || req.user.username,
        at: new Date(),
        note: reason
      }]
    });

    await M.Student.findOneAndUpdate(
      { trackId: studentTrackId },
      { $set: { currentAllocationId: newAlloc._id } }
    );

    return res.json({ ok: true, message: 'Resident moved successfully', data: newAlloc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── 3. ROLL CALL LIFECYCLE & SHEET ENDPOINTS ─────────────────────────────────

// Get or Prepare Tonight's Roll Call for Warden's Block
router.get('/rollcalls/today', async (req, res) => {
  try {
    const today = getTodayIST();
    let { blockId } = req.query;

    if (!blockId) {
      if (req.hostelScope.assignedBlockIds.length) {
        blockId = req.hostelScope.assignedBlockIds[0];
      } else {
        const firstBlock = await M.Block.findOne().lean();
        if (firstBlock) blockId = String(firstBlock._id);
      }
    }

    if (!blockId) return res.status(400).json({ error: 'No block found' });

    let rollCall = await M.RollCall.findOne({ date: today, blockId }).populate('blockId').lean();

    if (!rollCall) {
      const qrSecret = crypto.randomBytes(32).toString('hex');
      const newRc = await M.RollCall.create({
        date: today,
        blockId,
        opensAt: '21:00',
        closesAt: '21:45',
        verifyBy: '22:15',
        status: 'scheduled',
        qrSecret,
        counts: { total: 0, present: 0, late: 0, leave: 0, medical: 0, excused: 0, absent: 0, unmarked: 0 }
      });
      rollCall = await M.RollCall.findById(newRc._id).populate('blockId').lean();
    }

    return res.json({ ok: true, data: rollCall });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Warden Opens Roll Call
router.post('/rollcalls/:id/open', async (req, res) => {
  try {
    if (!req.hostelScope.isWarden && !req.hostelScope.isAdmin) {
      return res.status(403).json({ error: 'Warden or Admin access required' });
    }

    const rollCall = await M.RollCall.findById(req.params.id);
    if (!rollCall) return res.status(404).json({ error: 'Roll call not found' });

    const today = rollCall.date;
    const blockId = rollCall.blockId;

    // Find all approved allocations in this block
    const blockRooms = await M.HostelRoom.find({ blockId }).select('_id').lean();
    const roomIds = blockRooms.map(r => r._id);

    const allocations = await M.HostelAllocation.find({
      roomId: { $in: roomIds },
      status: 'approved',
    }).populate('roomId').lean();

    const studentTrackIds = allocations.map(a => a.studentTrackId);

    // Auto-fill locked leaves/ODs
    const activeLeaves = await M.HostelLeave.find({
      studentTrackId: { $in: studentTrackIds },
      status: { $in: ['out', 'approved'] },
      from: { $lte: new Date(`${today}T23:59:59.999Z`) },
      to:   { $gte: new Date(`${today}T00:00:00.000Z`) },
    }).lean();

    const leaveByStudent = new Map(activeLeaves.map(l => [l.studentTrackId, l]));

    let leaveCount = 0;
    let medicalCount = 0;
    let excusedCount = 0;
    let unmarkedCount = 0;

    for (const alloc of allocations) {
      const sId = alloc.studentTrackId;
      const leave = leaveByStudent.get(sId);

      let initialStatus = 'Absent (unverified)';
      let method = 'system';
      let locked = false;

      if (leave) {
        if (leave.type === 'medical') {
          initialStatus = 'Medical';
          method = 'auto-medical';
          locked = true;
          medicalCount++;
        } else if (leave.type === 'od') {
          initialStatus = 'Excused';
          method = 'auto-od';
          locked = true;
          excusedCount++;
        } else if (leave.status === 'out') {
          initialStatus = 'On leave';
          method = 'auto-leave';
          locked = true;
          leaveCount++;
        } else {
          unmarkedCount++;
        }
      } else {
        unmarkedCount++;
      }

      await M.HostelAttendance.findOneAndUpdate(
        { rollCallId: rollCall._id, studentTrackId: sId, date: today },
        {
          $setOnInsert: {
            rollCallId: rollCall._id,
            date: today,
            blockId,
            roomId: alloc.roomId._id,
            studentTrackId: sId,
            status: initialStatus,
            method,
            locked,
            markedBy: 'system',
            markedAt: new Date(),
          }
        },
        { upsert: true, returnDocument: 'after' }
      );
    }

    rollCall.status = 'open';
    rollCall.openedBy = req.user.trackId || req.user.username;
    rollCall.openedAt = new Date();
    rollCall.counts = {
      total: allocations.length,
      present: 0,
      late: 0,
      leave: leaveCount,
      medical: medicalCount,
      excused: excusedCount,
      absent: 0,
      unmarked: unmarkedCount,
    };
    await rollCall.save();

    return res.json({
      ok: true,
      message: 'Roll call opened. Auto-filled approved passes and locked medical/OD records.',
      data: rollCall
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Warden Closes Roll Call (Triggers spot-checks)
router.post('/rollcalls/:id/close', async (req, res) => {
  try {
    if (!req.hostelScope.isWarden && !req.hostelScope.isAdmin) {
      return res.status(403).json({ error: 'Warden or Admin access required' });
    }

    const rollCall = await M.RollCall.findById(req.params.id);
    if (!rollCall) return res.status(404).json({ error: 'Roll call not found' });

    // Mark remaining unmarked records as Absent (unverified)
    await M.HostelAttendance.updateMany(
      {
        rollCallId: rollCall._id,
        status: 'Absent (unverified)',
        locked: false,
        method: 'system'
      },
      {
        $set: {
          status: 'Absent (unverified)',
          markedBy: 'system_close',
          markedAt: new Date()
        }
      }
    );

    // Pick random spot checks from QR-marked residents
    const qrAttendees = await M.HostelAttendance.find({
      rollCallId: rollCall._id,
      method: 'qr',
      status: 'Present',
    }).select('studentTrackId').lean();

    const spotCheckCount = 5;
    const shuffled = qrAttendees.sort(() => 0.5 - Math.random());
    const selectedSpotChecks = shuffled.slice(0, spotCheckCount).map(a => a.studentTrackId);

    if (selectedSpotChecks.length) {
      await M.HostelAttendance.updateMany(
        { rollCallId: rollCall._id, studentTrackId: { $in: selectedSpotChecks } },
        { $set: { isSpotCheck: true } }
      );
    }

    rollCall.status = 'closed';
    rollCall.closedBy = req.user.trackId || req.user.username;
    rollCall.closedAt = new Date();
    rollCall.spotCheckList = selectedSpotChecks;

    // Recount
    const stats = await M.HostelAttendance.aggregate([
      { $match: { rollCallId: rollCall._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const cMap = {};
    stats.forEach(s => { cMap[s._id] = s.count; });

    rollCall.counts = {
      total: rollCall.counts.total,
      present: cMap['Present'] || 0,
      late: cMap['Late'] || 0,
      leave: cMap['On leave'] || 0,
      medical: cMap['Medical'] || 0,
      excused: cMap['Excused'] || 0,
      absent: (cMap['Absent (unverified)'] || 0) + (cMap['Absent (confirmed)'] || 0),
      unmarked: 0,
    };
    await rollCall.save();

    return res.json({
      ok: true,
      message: `Roll call closed. ${selectedSpotChecks.length} residents selected for spot-check. Ready for verification.`,
      data: rollCall
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Warden Verifies Roll Call (Finalizes Night Session)
router.post('/rollcalls/:id/verify', async (req, res) => {
  try {
    if (!req.hostelScope.isWarden && !req.hostelScope.isAdmin) {
      return res.status(403).json({ error: 'Warden or Admin access required' });
    }

    const rollCall = await M.RollCall.findById(req.params.id);
    if (!rollCall) return res.status(404).json({ error: 'Roll call not found' });

    rollCall.status = 'verified';
    rollCall.verifiedBy = req.user.trackId || req.user.username;
    rollCall.verifiedAt = new Date();
    await rollCall.save();

    return res.json({ ok: true, message: 'Roll call verified and finalized.', data: rollCall });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Warden Roster Sheet
router.get('/rollcalls/:id/sheet', async (req, res) => {
  try {
    const rollCall = await M.RollCall.findById(req.params.id).populate('blockId').lean();
    if (!rollCall) return res.status(404).json({ error: 'Roll call not found' });

    // Check HD15 privacy rule:
    const block = await M.Block.findById(rollCall.blockId._id || rollCall.blockId).populate('hostelId').lean();
    const isGirlsBlock = block && block.hostelId && block.hostelId.gender === 'girls';
    if (isGirlsBlock && !req.hostelScope.canSeeGirlsDetail) {
      return res.status(403).json({ error: 'Access restricted: Girls hostel roster details only visible to women wardens' });
    }

    const attendanceRecords = await M.HostelAttendance.find({ rollCallId: rollCall._id })
      .populate('roomId')
      .sort({ 'roomId.floor': 1, 'roomId.roomNo': 1 })
      .lean();

    const trackIds = attendanceRecords.map(r => r.studentTrackId);
    const students = await M.Student.find({ trackId: { $in: trackIds } })
      .select('fullName registerNo class section department guardians trackId')
      .lean();
    const sMap = new Map(students.map(s => [s.trackId, s]));

    const sheet = attendanceRecords.map(rec => ({
      ...rec,
      student: sMap.get(rec.studentTrackId) || null,
    }));

    return res.json({
      ok: true,
      data: {
        rollCall,
        sheet,
        counts: rollCall.counts,
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Rotating QR Token for Warden Lobby Display
router.get('/rollcalls/:id/qr', async (req, res) => {
  try {
    if (!req.hostelScope.isWarden && !req.hostelScope.isAdmin) {
      return res.status(403).json({ error: 'Warden or Admin access required' });
    }

    const rollCall = await M.RollCall.findById(req.params.id);
    if (!rollCall) return res.status(404).json({ error: 'Roll call not found' });
    if (rollCall.status !== 'open') {
      return res.status(400).json({ error: `Roll call is currently ${rollCall.status}. Please open it first.` });
    }

    const token = generateQRToken(String(rollCall._id), rollCall.qrSecret, 15);
    const expiresMs = 15000 - (Date.now() % 15000);

    return res.json({
      ok: true,
      data: {
        token,
        expiresInMs: expiresMs,
        rotateSec: 15,
        status: rollCall.status,
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Warden Manual Exception Mark / Verification Card
router.post('/rollcalls/:id/mark', async (req, res) => {
  try {
    if (!req.hostelScope.isWarden && !req.hostelScope.isAdmin) {
      return res.status(403).json({ error: 'Warden or Admin access required' });
    }
    const { items = [] } = req.body; // [{ studentTrackId, status, note, lateMinutes }]
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    const rollCall = await M.RollCall.findById(req.params.id);
    if (!rollCall) return res.status(404).json({ error: 'Roll call not found' });

    for (const item of items) {
      const { studentTrackId, status, note = '', lateMinutes = 0 } = item;
      const rec = await M.HostelAttendance.findOne({ rollCallId: rollCall._id, studentTrackId });
      if (rec) {
        rec.history.push({
          prevStatus: rec.status,
          newStatus: status,
          method: 'warden',
          by: req.user.trackId || req.user.username,
          at: new Date(),
          note
        });
        rec.status = status;
        rec.method = 'warden';
        rec.markedBy = req.user.trackId || req.user.username;
        rec.markedAt = new Date();
        rec.note = note;
        rec.lateMinutes = Number(lateMinutes) || 0;
        await rec.save();
      }
    }

    // Refresh roll call counts
    const stats = await M.HostelAttendance.aggregate([
      { $match: { rollCallId: rollCall._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const cMap = {};
    stats.forEach(s => { cMap[s._id] = s.count; });

    rollCall.counts.present = cMap['Present'] || 0;
    rollCall.counts.late = cMap['Late'] || 0;
    rollCall.counts.leave = cMap['On leave'] || 0;
    rollCall.counts.medical = cMap['Medical'] || 0;
    rollCall.counts.excused = cMap['Excused'] || 0;
    rollCall.counts.absent = (cMap['Absent (unverified)'] || 0) + (cMap['Absent (confirmed)'] || 0);
    await rollCall.save();

    return res.json({ ok: true, message: 'Roster updated successfully', counts: rollCall.counts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Warden Log Parent Phone Call
router.post('/rollcalls/:id/parent-call', async (req, res) => {
  try {
    if (!req.hostelScope.isWarden && !req.hostelScope.isAdmin) {
      return res.status(403).json({ error: 'Warden or Admin access required' });
    }
    const { studentTrackId, outcome, number, note = '' } = req.body;
    if (!studentTrackId || !outcome) {
      return res.status(400).json({ error: 'studentTrackId and outcome are required' });
    }

    const rec = await M.HostelAttendance.findOne({ rollCallId: req.params.id, studentTrackId });
    if (!rec) return res.status(404).json({ error: 'Attendance record not found' });

    rec.parentCall = {
      status: outcome,
      number: number || '',
      calledAt: new Date(),
      by: req.user.trackId || req.user.username,
      note,
    };
    await rec.save();

    return res.json({ ok: true, message: 'Parent call logged successfully', data: rec.parentCall });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── 4. STUDENT SELF CHECK-IN & MOVEMENT ───────────────────────────────────────

// Student Self Check-In via Rotating QR
router.post('/checkin', async (req, res) => {
  try {
    const { token, deviceId, lat, lng } = req.body;
    const studentTrackId = req.user.trackId;

    if (!token || !studentTrackId) {
      return res.status(400).json({ error: 'Token is required' });
    }

    // 1. Get student & current allocation
    const student = await M.Student.findOne({ trackId: studentTrackId }).populate('blockId').lean();
    if (!student || student.residency !== 'hostel' || !student.blockId) {
      return res.status(403).json({ error: 'You are not registered as an active hostel resident.' });
    }

    // 2. Token parts
    const parts = token.split('.');
    if (parts.length !== 3) return res.status(400).json({ error: 'Invalid QR token structure' });
    const rollCallId = parts[0];

    const rollCall = await M.RollCall.findById(rollCallId).populate('blockId');
    if (!rollCall) return res.status(404).json({ error: 'Roll call session not found' });
    if (rollCall.status !== 'open') {
      return res.status(400).json({ error: `Roll call is ${rollCall.status}. Check-in is not open.` });
    }

    // 3. Verify block match
    if (String(rollCall.blockId._id || rollCall.blockId) !== String(student.blockId._id || student.blockId)) {
      return res.status(403).json({ error: 'QR does not belong to your assigned block.' });
    }

    // 4. Verify HMAC token
    const tokenCheck = verifyQRToken(token, rollCall.qrSecret, 15);
    if (!tokenCheck.valid) {
      return res.status(400).json({ error: tokenCheck.error || 'Token expired or invalid' });
    }

    // 5. Device Binding Check
    if (deviceId) {
      const binding = await M.DeviceBinding.findOne({ studentTrackId, deviceId, active: true });
      if (!binding) {
        // If first device, auto bind
        const existingCount = await M.DeviceBinding.countDocuments({ studentTrackId });
        if (existingCount === 0) {
          await M.DeviceBinding.create({
            studentTrackId,
            deviceId,
            label: 'Primary Phone',
            active: true,
            boundAt: new Date()
          });
        } else {
          return res.status(403).json({
            error: 'Unrecognised device. You can only check in from your approved bound phone. Request a device change from your warden.'
          });
        }
      }
    }

    // 6. Geofence verification
    const blockDoc = await M.Block.findById(student.blockId).populate('hostelId').lean();
    if (blockDoc && blockDoc.hostelId && blockDoc.hostelId.geofence && blockDoc.hostelId.geofence.lat) {
      const fence = blockDoc.hostelId.geofence;
      if (lat && lng) {
        const geoCheck = await verifyCampusGeofence({ lat, lng, customGeofence: fence });
        if (!geoCheck.inside) {
          return res.status(403).json({ error: 'You must be physically inside the hostel premises to check in.' });
        }
      }
    }

    // 7. Record Attendance
    const today = rollCall.date;
    const existingRec = await M.HostelAttendance.findOne({ rollCallId: rollCall._id, studentTrackId });
    if (existingRec && existingRec.locked) {
      return res.status(400).json({ error: `Your attendance is locked as ${existingRec.status} (approved leave or medical).` });
    }

    // Check if back after curfew
    const curfewStr = (blockDoc && blockDoc.hostelId && blockDoc.hostelId.curfew) || '21:00';
    const [cHour, cMin] = curfewStr.split(':').map(Number);
    const now = new Date();
    const isLate = now.getHours() > cHour || (now.getHours() === cHour && now.getMinutes() > cMin);
    const lateMinutes = isLate ? ((now.getHours() - cHour) * 60 + (now.getMinutes() - cMin)) : 0;

    const newStatus = isLate ? 'Late' : 'Present';

    const updated = await M.HostelAttendance.findOneAndUpdate(
      { rollCallId: rollCall._id, studentTrackId },
      {
        $set: {
          status: newStatus,
          method: 'qr',
          markedBy: studentTrackId,
          markedAt: now,
          lateMinutes,
        },
        $push: {
          history: {
            prevStatus: existingRec ? existingRec.status : 'Absent (unverified)',
            newStatus,
            method: 'qr',
            by: studentTrackId,
            at: now,
            note: isLate ? `Checked in late by ${lateMinutes}m` : 'QR scan in block lobby'
          }
        }
      },
      { returnDocument: 'after', upsert: true }
    );

    // Increment roll call present/late count
    if (isLate) {
      rollCall.counts.late = (rollCall.counts.late || 0) + 1;
    } else {
      rollCall.counts.present = (rollCall.counts.present || 0) + 1;
    }
    if (rollCall.counts.unmarked > 0) rollCall.counts.unmarked -= 1;
    await rollCall.save();

    return res.json({
      ok: true,
      message: isLate ? `Checked in! Recorded as LATE (${lateMinutes} min after curfew).` : 'Checked in successfully! You are marked PRESENT.',
      data: updated
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Student Movement: "Leaving now" / "I'm back"
router.post('/movement', async (req, res) => {
  try {
    const { direction, leaveId, lat, lng, deviceId } = req.body;
    const studentTrackId = req.user.trackId;

    if (!direction || !leaveId || !studentTrackId) {
      return res.status(400).json({ error: 'direction (out|back) and leaveId are required' });
    }

    const leave = await M.HostelLeave.findById(leaveId);
    if (!leave) return res.status(404).json({ error: 'Pass record not found' });
    if (leave.studentTrackId !== studentTrackId) {
      return res.status(403).json({ error: 'Unauthorized: Pass does not belong to you' });
    }
    if (!['approved', 'out'].includes(leave.status)) {
      return res.status(400).json({ error: `Cannot record movement for pass with status ${leave.status}` });
    }

    // Geofence check
    const student = await M.Student.findOne({ trackId: studentTrackId }).populate('blockId').lean();
    let geoStatus = 'ok';
    if (student && student.blockId) {
      const blockDoc = await M.Block.findById(student.blockId).populate('hostelId').lean();
      if (blockDoc && blockDoc.hostelId && blockDoc.hostelId.geofence && blockDoc.hostelId.geofence.lat) {
        const fence = blockDoc.hostelId.geofence;
        if (lat && lng) {
          const geoCheck = await verifyCampusGeofence({ lat, lng, customGeofence: fence });
          geoStatus = geoCheck.inside ? 'ok' : 'outside';
        }
      }
    }

    const now = new Date();
    let isLate = false;
    let lateMinutes = 0;

    if (direction === 'out') {
      leave.status = 'out';
      leave.actualOut = now;
      await leave.save();
    } else if (direction === 'back') {
      leave.status = 'returned';
      leave.actualBack = now;

      // Check if returned after scheduled pass time
      if (now > new Date(leave.to)) {
        isLate = true;
        lateMinutes = Math.round((now.getTime() - new Date(leave.to).getTime()) / 60000);
        leave.isLate = true;
        leave.lateMinutes = lateMinutes;
      }
      await leave.save();
    }

    const movement = await M.MovementEvent.create({
      studentTrackId,
      leaveId: leave._id,
      direction,
      at: now,
      geo: geoStatus,
      late: isLate,
      lateMinutes,
      deviceId: deviceId || '',
    });

    return res.json({
      ok: true,
      message: direction === 'out' ? 'Recorded departure! Safe travels.' : (isLate ? `Recorded return! Logged as LATE (${lateMinutes} min).` : 'Welcome back! Return recorded.'),
      data: { leave, movement }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Device Binding Request
router.post('/device/bind', async (req, res) => {
  try {
    const { deviceId, label = 'Mobile Device' } = req.body;
    const studentTrackId = req.user.trackId;
    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });

    const existing = await M.DeviceBinding.findOne({ studentTrackId, deviceId });
    if (existing) {
      return res.json({ ok: true, message: 'Device already registered', data: existing });
    }

    const count = await M.DeviceBinding.countDocuments({ studentTrackId });
    // First device is auto-approved; secondary device requires warden approval
    const isAuto = count === 0;

    const binding = await M.DeviceBinding.create({
      studentTrackId,
      deviceId,
      label,
      active: isAuto,
      approvedBy: isAuto ? 'system_auto' : null,
      boundAt: new Date()
    });

    return res.json({
      ok: true,
      message: isAuto ? 'Device bound successfully!' : 'Device binding request submitted to warden for approval.',
      data: binding
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Warden: Approve Device Binding
router.post('/devices/:id/approve', async (req, res) => {
  try {
    if (!req.hostelScope.isWarden && !req.hostelScope.isAdmin) {
      return res.status(403).json({ error: 'Warden or Admin access required' });
    }
    const binding = await M.DeviceBinding.findById(req.params.id);
    if (!binding) return res.status(404).json({ error: 'Binding request not found' });

    // Deactivate previous devices
    await M.DeviceBinding.updateMany(
      { studentTrackId: binding.studentTrackId, _id: { $ne: binding._id } },
      { $set: { active: false } }
    );

    binding.active = true;
    binding.approvedBy = req.user.trackId || req.user.username;
    await binding.save();

    return res.json({ ok: true, message: 'Device binding approved. Previous devices deactivated.', data: binding });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── 5. LEAVES & OUTINGS ENDPOINTS ─────────────────────────────────────────────

// Apply for Outing / Home Leave
router.post('/leaves', async (req, res) => {
  try {
    const { type, from, to, destination, reason } = req.body;
    const studentTrackId = req.user.trackId;

    if (!type || !from || !to || !destination || !reason) {
      return res.status(400).json({ error: 'type, from, to, destination, and reason are required' });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (isNaN(fromDate) || isNaN(toDate) || fromDate >= toDate) {
      return res.status(400).json({ error: 'Invalid dates: to date must be after from date' });
    }

    let autoApproved = false;
    let initialStatus = 'pending_warden';

    // Smart checks for Local Outing
    if (type === 'outing') {
      // 1. Same day check
      const isSameDay = fromDate.toDateString() === toDate.toDateString();
      // 2. Before curfew check (21:00)
      const toHour = toDate.getHours();
      const beforeCurfew = toHour < 21 || (toHour === 21 && toDate.getMinutes() === 0);

      // 3. Weekly quota check
      const oneWeekAgo = new Date(Date.now() - 7 * 86400000);
      const pastOutingsCount = await M.HostelLeave.countDocuments({
        studentTrackId,
        type: 'outing',
        createdAt: { $gte: oneWeekAgo },
        status: { $in: ['approved', 'out', 'returned'] }
      });

      if (isSameDay && beforeCurfew && pastOutingsCount < 3) {
        autoApproved = true;
        initialStatus = 'approved';
      }
    }

    // Smart checks for Home Leave
    let academicLeaveId = null;
    if (type === 'home') {
      // Check if dates span working days
      const daysDiff = Math.ceil((toDate - fromDate) / 86400000);
      const includesWorkingDays = daysDiff > 2 || [1, 2, 3, 4, 5].includes(fromDate.getDay()) || [1, 2, 3, 4, 5].includes(toDate.getDay());

      if (includesWorkingDays && (M.StudentLeaveRequest || M.StudentLeave)) {
        // Auto-create linked academic leave
        const student = await M.Student.findOne({ trackId: studentTrackId }).lean();
        if (student) {
          const cls = student.classId ? await M.Class.findById(student.classId).lean() : null;
          const fromDateStr = todayIST(fromDate);
          const toDateStr = todayIST(toDate);
          const { getNextRequestId } = require('../utils/requestIds');
          const requestId = await getNextRequestId('LV').catch(() => 'LV-' + Date.now());

          let advisorId = null;
          let advisorTrackId = '';
          let advisorName = '';
          if (cls) {
            const adv = await M.Teacher.findOne({
              'specials.option': 'isClassAdvisor',
              $or: [
                { 'specials.key': cls.name },
                { 'specials.key': cls.trackId },
                { 'specials.value': cls.name },
                { 'specials.value': cls.trackId },
                { 'specials.value': true, 'specials.key': cls.name }
              ]
            }, 'trackId fullName name').lean();
            if (adv) {
              advisorTrackId = adv.trackId;
              advisorName = adv.fullName || adv.name;
              advisorId = adv._id;
            }
          }

          if (student.classId) {
            const LeaveModel = M.StudentLeaveRequest || M.StudentLeave;
            const acadLeave = await LeaveModel.create({
              requestId,
              studentId: student._id,
              studentTrackId: student.trackId,
              studentName: student.fullName || student.name || 'Student',
              studentRegNo: student.registerNo || student.admissionNo || '—',
              classId: student.classId,
              className: cls?.name || student.class || 'Unknown Class',
              deptId: student.deptId || cls?.deptId || null,
              deptName: student.department || cls?.deptName || '',
              advisorId,
              advisorTrackId,
              advisorName,
              category: 'Leave',
              leaveCategory: 'Personal',
              leaveType: 'Casual Leave',
              slot: 'Full Day',
              coverage: 'full_day',
              periods: [],
              fromDate: fromDateStr,
              toDate: toDateStr,
              dates: [fromDateStr, toDateStr],
              daysCount: Math.max(1, daysDiff),
              reason: `Hostel Home Leave: ${reason}`,
              status: 'Pending',
              filedByAdvisor: false,
            });
            academicLeaveId = acadLeave._id;
          }
        }
        initialStatus = 'pending_parent_call';
      } else {
        initialStatus = 'pending_parent_call';
      }
    }

    const newLeave = await M.HostelLeave.create({
      studentTrackId,
      type,
      from: fromDate,
      to: toDate,
      destination,
      reason,
      autoApproved,
      status: initialStatus,
      academicLeaveId,
      parentCall: { status: 'pending' },
    });

    return res.json({
      ok: true,
      message: autoApproved ? 'Outing auto-approved within allowance! Your pass is active.' : 'Leave application submitted. Awaiting approval.',
      data: newLeave
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// List Leaves
router.get('/leaves', async (req, res) => {
  try {
    const { status, studentTrackId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (studentTrackId) filter.studentTrackId = studentTrackId;

    if (req.hostelScope.isStudent) {
      filter.studentTrackId = req.user.trackId;
    }

    const leaves = await M.HostelLeave.find(filter).sort({ createdAt: -1 }).lean();
    const trackIds = leaves.map(l => l.studentTrackId);

    const students = await M.Student.find({ trackId: { $in: trackIds } })
      .select('fullName registerNo class section department guardians trackId blockId')
      .populate('blockId')
      .lean();
    const sMap = new Map(students.map(s => [s.trackId, s]));

    const enriched = leaves.map(l => ({
      ...l,
      student: sMap.get(l.studentTrackId) || null,
    }));

    return res.json({ ok: true, data: enriched });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Warden: Approve Leave
router.post('/leaves/:id/approve', async (req, res) => {
  try {
    if (!req.hostelScope.isWarden && !req.hostelScope.isAdmin) {
      return res.status(403).json({ error: 'Warden or Admin access required' });
    }
    const leave = await M.HostelLeave.findById(req.params.id);
    if (!leave) return res.status(404).json({ error: 'Leave not found' });

    leave.status = 'approved';
    leave.decidedBy = req.user.trackId || req.user.username;
    leave.decidedAt = new Date();
    await leave.save();

    return res.json({ ok: true, message: 'Pass approved', data: leave });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Warden: Reject Leave
router.post('/leaves/:id/reject', async (req, res) => {
  try {
    if (!req.hostelScope.isWarden && !req.hostelScope.isAdmin) {
      return res.status(403).json({ error: 'Warden or Admin access required' });
    }
    const { reason = 'Rejected by warden' } = req.body;
    const leave = await M.HostelLeave.findById(req.params.id);
    if (!leave) return res.status(404).json({ error: 'Leave not found' });

    leave.status = 'rejected';
    leave.decisionNote = reason;
    leave.decidedBy = req.user.trackId || req.user.username;
    leave.decidedAt = new Date();
    await leave.save();

    return res.json({ ok: true, message: 'Pass rejected', data: leave });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── 6. REPORTS & SNAPSHOTS ───────────────────────────────────────────────────

// Night Report (07:00 summary)
router.get('/reports/night', async (req, res) => {
  try {
    const date = req.query.date || getTodayIST();
    const { blockId } = req.query;

    const query = { date };
    if (blockId) query.blockId = blockId;

    const rollCalls = await M.RollCall.find(query).populate('blockId').lean();
    const reports = [];

    for (const rc of rollCalls) {
      const absences = await M.HostelAttendance.find({
        rollCallId: rc._id,
        status: { $in: ['Absent (unverified)', 'Absent (confirmed)', 'Overdue'] }
      }).populate('roomId').lean();

      const studentTrackIds = absences.map(a => a.studentTrackId);
      const students = await M.Student.find({ trackId: { $in: studentTrackIds } })
        .select('fullName registerNo class section department guardians trackId')
        .lean();
      const sMap = new Map(students.map(s => [s.trackId, s]));

      reports.push({
        rollCall: rc,
        counts: rc.counts,
        absentResidents: absences.map(a => ({
          ...a,
          student: sMap.get(a.studentTrackId) || null,
        }))
      });
    }

    return res.json({ ok: true, data: reports });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Controller / Principal Hostel Snapshot (§10.3)
router.get('/summary', async (req, res) => {
  try {
    const today = getTodayIST();
    const hostels = await M.Hostel.find().lean();
    const summary = [];

    for (const h of hostels) {
      const blocks = await M.Block.find({ hostelId: h._id }).select('_id').lean();
      const bIds = blocks.map(b => b._id);

      const rollCalls = await M.RollCall.find({ date: today, blockId: { $in: bIds } }).lean();

      let total = 0, present = 0, late = 0, leave = 0, medical = 0, absent = 0, overdue = 0;
      rollCalls.forEach(rc => {
        total += rc.counts.total || 0;
        present += rc.counts.present || 0;
        late += rc.counts.late || 0;
        leave += rc.counts.leave || 0;
        medical += rc.counts.medical || 0;
        absent += rc.counts.absent || 0;
      });

      // Find overdue leaves
      const overdues = await M.HostelLeave.countDocuments({
        status: 'overdue',
        from: { $lte: new Date(`${today}T23:59:59.999Z`) },
      });

      summary.push({
        hostelId: h._id,
        code: h.code,
        name: h.name,
        gender: h.gender,
        curfew: h.curfew,
        counts: {
          totalResidents: total,
          inside: present + late,
          onLeave: leave,
          medical,
          late,
          absent,
          overdue: overdues,
        },
        // HD15 rule: If girls' hostel and user cannot see girls' detail, mark as counts-only
        countsOnly: h.gender === 'girls' && !req.hostelScope.canSeeGirlsDetail,
      });
    }

    return res.json({ ok: true, data: summary });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Cross-checks endpoint
router.get('/cross-checks', async (req, res) => {
  try {
    const date = req.query.date || getTodayIST();
    const alerts = await runHostelCrossChecks(date);
    return res.json({ ok: true, data: alerts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
