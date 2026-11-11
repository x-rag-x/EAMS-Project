/**
 * scripts/backfillAttendanceMethod.js
 *
 * AttReg B4: Backfills historical ClassAttendance documents with periods[].source.
 * Recovers method from Log collection (attendanceClassDaily) and sessions from
 * ScanLiveSession / QuickPassSession when unique match exists.
 *
 * Usage:
 *   node scripts/backfillAttendanceMethod.js --dry-run
 *   node scripts/backfillAttendanceMethod.js
 */

const mongoose = require('mongoose');
const cfg = require('../config');
const M = require('../models');

const isDryRun = process.argv.includes('--dry-run');

async function backfill() {
  console.log(`Starting Attendance Method Backfill (dryRun=${isDryRun})...`);
  await mongoose.connect(cfg.MONGO_URI, { dbName: cfg.DB_NAME });

  const cursor = M.ClassAttendance.find({
    $or: [
      { 'periods.source': { $exists: false } },
      { 'periods.source.method': { $exists: false } }
    ]
  }).cursor();

  let totalDocs = 0;
  let updatedDocs = 0;
  let totalPeriods = 0;
  let methodFoundCount = 0;
  let sessionLinkedCount = 0;

  for await (const doc of cursor) {
    totalDocs++;
    let docModified = false;

    for (let pIdx = 0; pIdx < doc.periods.length; pIdx++) {
      totalPeriods++;
      const p = doc.periods[pIdx];

      if (p.source && p.source.method) continue;

      const pNum = (p.periodNumbers && p.periodNumbers[0]) || p.periodNumber || (pIdx + 1);
      const dateStr = doc.date ? doc.date.toISOString().slice(0, 10) : '';

      // Try finding corresponding daily class log
      let method = 'Unknown (legacy)';
      let sessionTrackId = '';
      let sessionModel = '';
      let via = 'direct';

      const logDoc = await M.Log.findOne({
        'meta.classId': String(doc.classId),
        'meta.date': dateStr,
        'attendanceClassDaily.periods.periodNumber': pNum
      }).lean();

      if (logDoc && logDoc.attendanceClassDaily && Array.isArray(logDoc.attendanceClassDaily.periods)) {
        const pLog = logDoc.attendanceClassDaily.periods.find(lp => lp.periodNumber === pNum);
        if (pLog && pLog.method) {
          method = pLog.method;
          methodFoundCount++;
        }
      }

      // Try uniquely recovering session link if session-based
      if (method === 'Live QR' || method === 'QuickPass Code' || method === 'Unknown (legacy)') {
        const qrCandidates = await M.ScanLiveSession.find({
          classId: doc.classId,
          date: dateStr,
          periodNumber: pNum,
          isFinalSaved: true
        }).lean();

        if (qrCandidates.length === 1) {
          method = 'Live QR';
          sessionTrackId = qrCandidates[0].sessionTrackId;
          sessionModel = 'ScanLiveSession';
          sessionLinkedCount++;
        } else {
          const qpCandidates = await M.QuickPassSession.find({
            classId: doc.classId,
            date: dateStr,
            periodNumber: pNum
          }).lean();

          if (qpCandidates.length === 1) {
            method = 'QuickPass Code';
            sessionTrackId = String(qpCandidates[0]._id);
            sessionModel = 'QuickPassSession';
            sessionLinkedCount++;
          }
        }
      }

      p.source = {
        method,
        sessionTrackId,
        sessionModel,
        via
      };
      p.periodNumber = pNum;
      docModified = true;
    }

    if (docModified) {
      updatedDocs++;
      if (!isDryRun) {
        await doc.save();
      }
    }
  }

  console.log('--- Backfill Summary ---');
  console.log(`Scanned docs: ${totalDocs}`);
  console.log(`Updated docs: ${updatedDocs}`);
  console.log(`Total periods evaluated: ${totalPeriods}`);
  console.log(`Methods identified: ${methodFoundCount}`);
  console.log(`Unique sessions linked: ${sessionLinkedCount}`);
  console.log(isDryRun ? 'DRY RUN COMPLETE — No changes committed.' : 'BACKFILL COMMITTED.');

  await mongoose.disconnect();
}

backfill().catch(err => {
  console.error('Backfill error:', err);
  process.exit(1);
});
