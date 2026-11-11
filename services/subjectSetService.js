/**
 * services/subjectSetService.js
 *
 * Subject Set Record, Auditing & Verification Gate Service (Phase 4):
 * - Canonical SHA-256 hash calculation across class curriculum allocations.
 * - Manages ClassSubjectSet records with author audit tracking (createdBy, updatedBy).
 * - Enforces the AutoGen Verification Gate clearance via SubjectSetConfirmation.
 */

'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const M = require('../models');

/**
 * Computes canonical SHA-256 hash of subject set rows.
 *
 * @param {Array<Object>} items
 * @returns {String} Hex SHA-256 digest
 */
function computeRowsHash(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return crypto.createHash('sha256').update('EMPTY_SUBJECT_SET').digest('hex');
  }

  // Canonicalize each row
  const normalized = items.map(item => {
    const sCode = String(item.subjectCode || item.code || item.shortForm || '').trim().toUpperCase();
    const sId = item.subjectId ? String(item.subjectId) : '';
    const sName = String(item.subjectName || item.name || '').trim();
    const tId = item.teacherId || item.staffId ? String(item.teacherId || item.staffId) : '';
    const tName = String(item.teacherName || item.staffName || '').trim();
    const rId = item.roomId ? String(item.roomId) : '';
    const hallNo = String(item.hallNo || item.room || '').trim().toUpperCase();
    const periods = Number(item.periodsPerWeek || item.hours || 4);
    const isLab = Boolean(item.isLab || sName.toLowerCase().includes('lab') || sCode.toLowerCase().includes('lab'));

    return {
      sortKey: `${sCode}:${sName}:${tId}:${rId}:${periods}:${isLab ? '1' : '0'}`,
      sCode,
      sId,
      sName,
      tId,
      tName,
      rId,
      hallNo,
      periods,
      isLab
    };
  });

  // Sort deterministically
  normalized.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const content = normalized
    .map(r => `${r.sCode}|${r.sId}|${r.tId}|${r.rId}|${r.hallNo}|${r.periods}|${r.isLab ? 1 : 0}`)
    .join('\n');

  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Synchronizes ClassSubjectSet from assignments or allocations.
 *
 * @param {ObjectId|String} classId
 * @param {Array<Object>} assignmentRows
 * @param {Object} actor - { _id, name, trackId }
 * @returns {Promise<Object>} The updated or created ClassSubjectSet
 */
async function syncClassSubjectSet(classId, assignmentRows = [], actor = {}) {
  if (!classId) throw new Error('classId is required to sync ClassSubjectSet');

  const normalizedItems = assignmentRows.map(row => ({
    subjectId:      row.subjectId && mongoose.isValidObjectId(row.subjectId) ? row.subjectId : null,
    subjectCode:    String(row.subjectCode || row.code || '').trim(),
    subjectName:    String(row.subjectName || row.name || '').trim(),
    teacherId:      (row.teacherId || row.staffId) && mongoose.isValidObjectId(row.teacherId || row.staffId) ? (row.teacherId || row.staffId) : null,
    teacherName:    String(row.teacherName || row.staffName || '').trim(),
    roomId:         row.roomId && mongoose.isValidObjectId(row.roomId) ? row.roomId : null,
    hallNo:         String(row.hallNo || row.room || '').trim(),
    periodsPerWeek: Number(row.periodsPerWeek || row.hours || 4),
    isLab:          Boolean(row.isLab)
  }));

  const rowsHash = computeRowsHash(normalizedItems);

  let record = await M.ClassSubjectSet.findOne({ classId });

  const actorInfo = {
    userId:  actor._id || actor.id || new mongoose.Types.ObjectId(),
    name:    actor.name || 'System User',
    trackId: actor.trackId || ''
  };

  if (!record) {
    record = await M.ClassSubjectSet.create({
      classId,
      version: 1,
      rowsHash,
      items: normalizedItems,
      createdBy: actorInfo,
      updatedBy: actorInfo
    });
  } else {
    // If hash changed, increment version
    if (record.rowsHash !== rowsHash) {
      record.version += 1;
      record.rowsHash = rowsHash;
      record.items = normalizedItems;
      record.updatedBy = actorInfo;
      await record.save();
    }
  }

  return record;
}

/**
 * Verifies if an AutoGen run is permitted by checking for an active SubjectSetConfirmation.
 *
 * @param {ObjectId|String} draftId
 * @param {ObjectId|String} classId
 * @param {String} expectedHash
 * @returns {Promise<{ confirmed: Boolean, confirmation?: Object, reason?: String }>}
 */
async function verifySubjectSetGate(draftId, classId, expectedHash) {
  if (!draftId || !classId) {
    return {
      confirmed: false,
      reason: 'draftId and classId are required to verify gate.'
    };
  }

  // Find confirmation matching draft, class, and rowsHash
  const confirmation = await M.SubjectSetConfirmation.findOne({
    draftId,
    classId,
    rowsHash: expectedHash,
    expiresAt: { $gt: new Date() }
  }).lean();

  if (!confirmation) {
    return {
      confirmed: false,
      reason: 'Subject Set has not been confirmed for this draft or curriculum hash has changed.'
    };
  }

  return {
    confirmed: true,
    confirmation
  };
}

module.exports = {
  computeRowsHash,
  syncClassSubjectSet,
  verifySubjectSetGate
};
