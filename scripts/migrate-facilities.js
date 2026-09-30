/**
 * Migration Script: Facilities Schema Expansion (Plan 1)
 *
 * Usage:
 *   node scripts/migrate-facilities.js --dry-run   # Preview changes without modifying database
 *   node scripts/migrate-facilities.js              # Apply migration
 */

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();
const mongoose = require('mongoose');
const cfg = require('../config');
const M = require('../models');

const isDryRun = process.argv.includes('--dry-run');

function generateBuildingCode(name, existingCodes) {
  if (!name) return 'BLDG';
  // Extract alphanumeric words
  const words = name.trim().split(/\s+/).filter(Boolean);
  let baseCode = '';
  if (words.length === 1) {
    baseCode = words[0].slice(0, 4).toUpperCase();
  } else {
    baseCode = words.map(w => w[0]).join('').toUpperCase();
  }
  // Sanitize to 2-10 uppercase alphanumeric chars
  baseCode = baseCode.replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (baseCode.length < 2) baseCode = (baseCode + 'BLDG').slice(0, 4);

  let candidate = baseCode;
  let counter = 1;
  while (existingCodes.has(candidate)) {
    candidate = `${baseCode}${counter}`.slice(0, 10);
    counter++;
  }
  existingCodes.add(candidate);
  return candidate;
}

const TYPE_MAP = {
  classroom: 'Theory',
  lab: 'Lab',
  seminar_hall: 'Seminar',
  special_hall: 'Other',
  Theory: 'Theory',
  Lab: 'Lab',
  Seminar: 'Seminar',
  Workshop: 'Workshop',
  Other: 'Other'
};

async function runMigration() {
  console.log(`\n======================================================`);
  console.log(` EAMS Facilities Migration — Plan 1: Rooms & Buildings`);
  console.log(` Mode: ${isDryRun ? '🔍 DRY RUN (Preview only)' : '🚀 LIVE EXECUTION'}`);
  console.log(`======================================================\n`);

  try {
    const mongoUri = process.env.MONGO_URI || cfg.MONGO_URI;
    console.log(`Connecting to MongoDB...`);
    await mongoose.connect(mongoUri);
    console.log(`Connected successfully.\n`);

    // ── 1. MIGRATE BUILDINGS ──
    console.log(`── 1. Analyzing Buildings ──`);
    const rawBuildings = await mongoose.connection.collection('buildings').find({}).toArray();
    console.log(`Found ${rawBuildings.length} building(s).`);

    const buildingCodeMap = new Map();
    const existingCodes = new Set();

    // First collect any already-existing codes
    for (const b of rawBuildings) {
      if (b.code) existingCodes.add(String(b.code).toUpperCase().trim());
    }

    const buildingUpdates = [];
    for (const b of rawBuildings) {
      const updates = {};
      const changes = [];

      let code = b.code ? String(b.code).toUpperCase().trim() : null;
      if (!code) {
        code = generateBuildingCode(b.name, existingCodes);
        updates.code = code;
        changes.push(`code: '${code}' (generated from '${b.name}')`);
      } else {
        existingCodes.add(code);
      }
      buildingCodeMap.set(String(b._id), { name: b.name, code });

      if (!b.type || !['Academic', 'Laboratory', 'Administrative', 'Hostel', 'Sports', 'Other'].includes(b.type)) {
        updates.type = 'Academic';
        changes.push(`type: 'Academic' (default)`);
      }

      if (!b.campus) {
        updates.campus = 'Main Campus';
        changes.push(`campus: 'Main Campus' (default)`);
      }

      if (!b.floors || typeof b.floors !== 'number' || b.floors < 1) {
        updates.floors = 4;
        changes.push(`floors: 4 (default)`);
      }

      if (!b.status || !['Active', 'Inactive'].includes(b.status)) {
        updates.status = 'Active';
        changes.push(`status: 'Active' (default)`);
      }

      if (b.latitude === undefined) updates.latitude = null;
      if (b.longitude === undefined) updates.longitude = null;

      if (changes.length > 0) {
        buildingUpdates.push({ id: b._id, name: b.name, updates, changes });
      }
    }

    console.log(`Buildings requiring updates: ${buildingUpdates.length} of ${rawBuildings.length}`);
    for (const item of buildingUpdates) {
      console.log(`  Building [${item.name}] (${item.id}):`);
      item.changes.forEach(c => console.log(`    + ${c}`));
      if (!isDryRun) {
        await mongoose.connection.collection('buildings').updateOne(
          { _id: item.id },
          { $set: item.updates }
        );
      }
    }

    // ── 2. MIGRATE ROOMS ──
    console.log(`\n── 2. Analyzing Rooms ──`);
    const rawRooms = await mongoose.connection.collection('rooms').find({}).toArray();
    console.log(`Found ${rawRooms.length} room(s).`);

    const roomUpdates = [];
    for (const r of rawRooms) {
      const updates = {};
      const changes = [];

      // hallNo
      if (!r.hallNo) {
        const hallNo = r.name ? String(r.name).trim() : `R-${String(r._id).slice(-4)}`;
        updates.hallNo = hallNo;
        changes.push(`hallNo: '${hallNo}' (from name)`);
      }

      // type mapping
      const mappedType = TYPE_MAP[r.type] || 'Theory';
      if (r.type !== mappedType) {
        updates.type = mappedType;
        changes.push(`type: '${r.type}' -> '${mappedType}'`);
      }

      // status mapping
      if (!r.status || !['Available', 'Reserved', 'Maintenance', 'Temporarily Unavailable', 'Inactive'].includes(r.status)) {
        const status = r.active === false ? 'Inactive' : 'Available';
        updates.status = status;
        changes.push(`status: '${status}' (from active: ${r.active})`);
      }

      // capacity
      const capacity = (typeof r.capacity === 'number' && r.capacity > 0) ? r.capacity : 40;
      if (r.capacity !== capacity) {
        updates.capacity = capacity;
        changes.push(`capacity: ${capacity} (default)`);
      }

      // floor
      if (r.floor === undefined || r.floor === null) {
        updates.floor = 0;
        changes.push(`floor: 0 (default)`);
      }

      // buildingName
      if (!r.buildingName && r.buildingId) {
        const bInfo = buildingCodeMap.get(String(r.buildingId));
        if (bInfo) {
          updates.buildingName = bInfo.name;
          changes.push(`buildingName: '${bInfo.name}'`);
        }
      }

      // geofenceRadius
      if (r.geofenceRadius === undefined || r.geofenceRadius === null) {
        updates.geofenceRadius = 50;
        changes.push(`geofenceRadius: 50m (default)`);
      }

      // capacityHistory
      if (!Array.isArray(r.capacityHistory) || r.capacityHistory.length === 0) {
        updates.capacityHistory = [{
          oldCapacity: capacity,
          newCapacity: capacity,
          changedBy: 'System Migration',
          changedAt: new Date(),
          reason: 'Initial migration baseline'
        }];
        changes.push(`capacityHistory: initialized with baseline [${capacity}]`);
      }

      // statusHistory
      if (!Array.isArray(r.statusHistory) || r.statusHistory.length === 0) {
        updates.statusHistory = [{
          oldStatus: updates.status || r.status || 'Available',
          newStatus: updates.status || r.status || 'Available',
          changedBy: 'System Migration',
          changedAt: new Date(),
          reason: 'Initial migration baseline',
          affectedSlots: 0
        }];
        changes.push(`statusHistory: initialized with baseline`);
      }

      if (changes.length > 0) {
        roomUpdates.push({ id: r._id, hallNo: r.hallNo || updates.hallNo, changes, updates });
      }
    }

    console.log(`Rooms requiring updates: ${roomUpdates.length} of ${rawRooms.length}`);
    for (const item of roomUpdates) {
      console.log(`  Room [${item.hallNo}] (${item.id}):`);
      item.changes.forEach(c => console.log(`    + ${c}`));
      if (!isDryRun) {
        await mongoose.connection.collection('rooms').updateOne(
          { _id: item.id },
          { $set: item.updates }
        );
      }
    }

    // ── 3. ENSURE INDEXES ──
    if (!isDryRun) {
      console.log(`\n── 3. Syncing Indexes ──`);
      try {
        await M.Building.syncIndexes();
        console.log(`Building indexes synchronized.`);
      } catch (idxErr) {
        console.warn(`Warning syncing Building indexes:`, idxErr.message);
      }
      try {
        await M.Room.syncIndexes();
        console.log(`Room indexes synchronized.`);
      } catch (idxErr) {
        console.warn(`Warning syncing Room indexes:`, idxErr.message);
      }
      try {
        await M.SmartBoard.syncIndexes();
        console.log(`SmartBoard indexes synchronized.`);
      } catch (idxErr) {
        console.warn(`Warning syncing SmartBoard indexes:`, idxErr.message);
      }
    }

    console.log(`\n======================================================`);
    console.log(isDryRun
      ? ` 🔍 DRY RUN COMPLETE: ${buildingUpdates.length} building(s) and ${roomUpdates.length} room(s) would be updated.`
      : ` ✅ MIGRATION COMPLETE: ${buildingUpdates.length} building(s) and ${roomUpdates.length} room(s) successfully updated.`);
    console.log(`======================================================\n`);

  } catch (err) {
    console.error(`❌ Migration failed:`, err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runMigration();
