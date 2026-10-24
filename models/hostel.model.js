const mongoose = require('mongoose');

// ── 1. Hostel (Boys / Girls) ─────────────────────────────────────────────────
const HostelSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    gender: { type: String, enum: ['boys', 'girls'], required: true },
    geofence: {
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
        radiusM: { type: Number, default: 250 }, // default 250m radius
    },
    curfew: { type: String, default: '21:00', trim: true }, // 24-hr format HH:mm
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: true });

// ── 2. Block (1 per Warden) ──────────────────────────────────────────────────
const BlockSchema = new mongoose.Schema({
    hostelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // e.g. 'BH-A', 'GH-1'
    name: { type: String, required: true, trim: true }, // e.g. 'Cauvery Block'
    floors: { type: Number, default: 3, min: 1 },
    wardenTrackId: { type: String, default: null, trim: true }, // Teacher trackId
}, { timestamps: true });

BlockSchema.index({ hostelId: 1 });
BlockSchema.index({ wardenTrackId: 1 });

// ── 3. Room ──────────────────────────────────────────────────────────────────
const RoomSchema = new mongoose.Schema({
    blockId: { type: mongoose.Schema.Types.ObjectId, ref: 'Block', required: true },
    floor: { type: Number, required: true, min: 0 },
    roomNo: { type: String, required: true, trim: true }, // e.g. '101', 'F1-02'
    capacity: { type: Number, required: true, min: 1, default: 3 },
    beds: { type: [String], default: ['A', 'B', 'C'] }, // list of bed identifiers
    status: { type: String, enum: ['active', 'maintenance'], default: 'active' },
}, { timestamps: true });

RoomSchema.index({ blockId: 1, roomNo: 1 }, { unique: true });
RoomSchema.index({ blockId: 1, floor: 1 });

// ── 4. Bed Allocation ────────────────────────────────────────────────────────
const AllocationHistorySchema = new mongoose.Schema({
    action: { type: String, required: true },
    by: { type: String, required: true },
    at: { type: Date, default: Date.now },
    note: { type: String, default: '' },
    prevBed: { type: String, default: '' },
    newBed: { type: String, default: '' },
}, { _id: false });

const AllocationSchema = new mongoose.Schema({
    studentTrackId: { type: String, required: true, trim: true },
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'HostelRoom', required: true },
    bed: { type: String, required: true, trim: true }, // e.g. 'A', 'B'
    academicYear: { type: String, required: true, trim: true }, // e.g. '2026-2027'
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'vacated'], default: 'pending' },
    requestedAt: { type: Date, default: Date.now },
    decidedBy: { type: String, default: null, trim: true },
    decidedAt: { type: Date, default: null },
    history: { type: [AllocationHistorySchema], default: [] },
}, { timestamps: true });

AllocationSchema.index({ studentTrackId: 1, academicYear: 1, status: 1 });
AllocationSchema.index({ roomId: 1, bed: 1, academicYear: 1, status: 1 });

const Hostel = mongoose.model('Hostel', HostelSchema);
const Block = mongoose.model('Block', BlockSchema);
const HostelRoom = mongoose.model('HostelRoom', RoomSchema);
const HostelAllocation = mongoose.model('HostelAllocation', AllocationSchema);

module.exports = {
    Hostel,
    Block,
    HostelBlock: Block,
    HostelRoom,
    RoomHostel: HostelRoom,
    HostelAllocation,
    Allocation: HostelAllocation,
};
