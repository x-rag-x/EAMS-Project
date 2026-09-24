#!/usr/bin/env node
// Merge teacher username duplicates differing only by case or whitespace

const mongoose = require('mongoose');
const cfg = require('../config');

const APPLY = process.argv.includes('--apply');
const usernamesInUse = new Set();

async function main() {
  await mongoose.connect(cfg.MONGO_URI, { dbName: cfg.DB_NAME });

  const Teacher = mongoose.connection.db.collection('teachers');
  const User = mongoose.connection.db.collection('users');

  const all = await Teacher.find({}).toArray();
  const normalizedBy = new Map();

  all.forEach(t => {
    const raw = t.username == null ? '' : String(t.username).toLowerCase().trim();
    if (!normalizedBy.has(raw)) normalizedBy.set(raw, []);
    normalizedBy.get(raw).push(t);
  });

  // All usernames currently present (teachers + shadow users) to avoid collisions
  all.forEach(t => { if (t.username) usernamesInUse.add(String(t.username).toLowerCase()); });
  (await User.find({ username: { $exists: true } }).toArray()).forEach(u =>
    usernamesInUse.add(String(u.username).toLowerCase())
  );

  let plan = [];
  for (const [base, group] of normalizedBy) {
    if (group.length < 2) continue;
    group.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const keep = group[0];
    for (let i = 1; i < group.length; i++) {
      const dup = group[i];
      let candidate = base;
      let n = 1;
      do { candidate = `${base}_dup${n++}`; } while (usernamesInUse.has(candidate));
      usernamesInUse.add(candidate);
      plan.push({ _id: dup._id, fullName: dup.fullName, from: dup.username, to: candidate, keptBy: keep.fullName });
    }
  }

  if (!plan.length) {
    console.log('✅ No conflicting teacher usernames found. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  console.log(APPLY ? '🔧 APPLYING FIXES\n' : '🔍 DRY RUN — no changes made. Re-run with --apply.\n');
  plan.forEach(p => {
    console.log(`  ${p.fullName} (${p._id})`);
    console.log(`    username: "${p.from}"  →  "${p.to}"   (kept for ${p.keptBy})`);
  });

  if (!APPLY) {
    await mongoose.disconnect();
    return;
  }

  let renamed = 0, shadowSynced = 0, shadowFailed = 0;
  for (const p of plan) {
    const upd = await Teacher.updateOne({ _id: p._id }, { $set: { username: p.to } });
    if (upd.modifiedCount) renamed++;

    const shadow = await User.findOne({ username: p.from, role: 'teacher' });
    if (shadow) {
      const clash = await User.findOne({ username: p.to });
      if (clash) { console.warn(`  ⚠ shadow user for ${p.fullName} not renamed — "@${p.to}" taken by ${clash.role}`); shadowFailed++; }
      else { await User.updateOne({ _id: shadow._id }, { $set: { username: p.to } }); shadowSynced++; }
    }
  }

  console.log(`\n✅ Done. Teachers renamed: ${renamed} | Shadow users synced: ${shadowSynced} | Shadow skips: ${shadowFailed}`);
  await mongoose.disconnect();
}

main().catch(async e => { console.error('Error:', e.message); process.exit(1); });
