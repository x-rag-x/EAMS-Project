/**
 * utils/attendanceMigration.js
 *
 * Merges existing duplicate ClassAttendance documents having the same classId and date,
 * normalizes session dates to UTC midnight, drops legacy non-unique index { classId: 1, date: 1 },
 * and ensures the unique index { classId: 1, date: 1 } is applied on the collection.
 */

const M = require('../models');

async function mergeDuplicateClassAttendance() {
  try {
    if (!M.ClassAttendance || !M.ClassAttendance.collection) return;

    // 1. Fetch all ClassAttendance documents sorted by createdAt asc
    const allDocs = await M.ClassAttendance.find().sort({ createdAt: 1, _id: 1 }).lean();
    if (!allDocs || allDocs.length === 0) {
      await ensureUniqueIndex();
      return;
    }

    // Group documents by classId and normalized UTC midnight date
    const groups = new Map();
    for (const doc of allDocs) {
      const d = new Date(doc.date);
      const normalizedDateStr = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
      const key = `${String(doc.classId)}_${normalizedDateStr}`;

      if (!groups.has(key)) {
        groups.set(key, {
          classId: doc.classId,
          normalizedDate: new Date(normalizedDateStr),
          docs: []
        });
      }
      groups.get(key).docs.push(doc);
    }

    let mergedCount = 0;
    let deletedCount = 0;

    for (const [key, group] of groups.entries()) {
      const { docs, normalizedDate, classId } = group;

      if (docs.length > 1) {
        // Merge duplicates into the earliest created document
        const primaryDoc = docs[0];
        const duplicateDocs = docs.slice(1);
        const duplicateIds = duplicateDocs.map(d => d._id);

        const mergedPeriods = [...(primaryDoc.periods || [])];

        for (const dup of duplicateDocs) {
          if (!Array.isArray(dup.periods)) continue;

          for (const p of dup.periods) {
            const pNum = p.periodNumber || (Array.isArray(p.periodNumbers) ? p.periodNumbers[0] : null);
            const exists = mergedPeriods.some(existing => {
              const existingNum = existing.periodNumber || (Array.isArray(existing.periodNumbers) ? existing.periodNumbers[0] : null);
              const sameSubj = existing.subjectTrackId === p.subjectTrackId;
              const sameNum = pNum !== null && existingNum !== null && Number(existingNum) === Number(pNum);
              return sameSubj && sameNum;
            });

            if (!exists) {
              mergedPeriods.push(p);
            }
          }
        }

        // Update primary document with merged periods and normalized UTC midnight date
        await M.ClassAttendance.updateOne(
          { _id: primaryDoc._id },
          {
            $set: {
              date: normalizedDate,
              periods: mergedPeriods,
              updatedAt: new Date()
            }
          }
        );

        // Delete duplicate documents
        await M.ClassAttendance.deleteMany({ _id: { $in: duplicateIds } });
        mergedCount++;
        deletedCount += duplicateIds.length;
        console.log(`[Attendance Migration]: Merged ${docs.length} duplicate documents for class ${classId} on ${normalizedDate.toISOString()}`);
      } else {
        // Normalize single doc's date to UTC midnight if needed
        const singleDoc = docs[0];
        const docDate = new Date(singleDoc.date);
        if (docDate.getTime() !== normalizedDate.getTime()) {
          await M.ClassAttendance.updateOne(
            { _id: singleDoc._id },
            { $set: { date: normalizedDate } }
          );
        }
      }
    }

    if (mergedCount > 0) {
      console.log(`[Attendance Migration]: Successfully merged ${mergedCount} duplicate groups (deleted ${deletedCount} duplicate docs).`);
    }

    // 2. Ensure unique index on { classId: 1, date: 1 }
    await ensureUniqueIndex();
  } catch (err) {
    console.error('[Attendance Migration Error]:', err.message);
  }
}

async function ensureUniqueIndex() {
  try {
    const indexes = await M.ClassAttendance.collection.indexes();
    const existingIndex = indexes.find(idx => idx.name === 'classId_1_date_1');

    if (existingIndex && !existingIndex.unique) {
      console.log('[Attendance Migration]: Dropping non-unique classId_1_date_1 index...');
      await M.ClassAttendance.collection.dropIndex('classId_1_date_1');
    }

    // Create unique index if it doesn't already exist as unique
    if (!existingIndex || !existingIndex.unique) {
      console.log('[Attendance Migration]: Creating unique index on { classId: 1, date: 1 }...');
      await M.ClassAttendance.collection.createIndex(
        { classId: 1, date: 1 },
        { unique: true, name: 'classId_1_date_1' }
      );
      console.log('[Attendance Migration]: Unique index created successfully.');
    }
  } catch (idxErr) {
    console.warn('[Attendance Migration Index Warning]:', idxErr.message);
  }
}

module.exports = { mergeDuplicateClassAttendance, ensureUniqueIndex };
