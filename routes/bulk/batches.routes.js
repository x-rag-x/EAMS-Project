const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const M = require('../../models');
const { authMiddleware, requirePage } = require('../../middleware/auth');
const { isSudoCaller, loadBatch, listFilter, toClient } = require('../../services/bulk/access');
const { postMessage } = require('../../services/bulk/messages');

/**
 * Generates an 8-character uppercase alphanumeric track ID (e.g. TR-BATCH-MVDFA9BM)
 */
function generateBatchTrackId() {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 8; i++) {
    rand += chars[crypto.randomInt(0, chars.length)];
  }
  return `TR-BATCH-${rand}`;
}

/**
 * Count total student and teacher verifications performed across the system in the last 24 hours
 */
async function get24HourVerificationCount() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await M.BulkImportBatch.aggregate([
    { $match: { type: { $in: ['student', 'teacher'] } } },
    { $unwind: '$eligibleRows' },
    {
      $match: {
        'eligibleRows.isVerified': true,
        'eligibleRows.devBypass': { $ne: true },
        'eligibleRows.verifiedAt': { $ne: null, $gte: twentyFourHoursAgo }
      }
    },
    { $count: 'total' }
  ]);
  return (result[0] && result[0].total) ? result[0].total : 0;
}

// ── 1. LIST BATCHES (SIDEBAR / HISTORY) ──
router.get('/batches', authMiddleware, requirePage('bulk', 'view'), async (req, res) => {
  try {
    const filter = listFilter(req.user);
    const { status, type, uploader, q, cursor, limit = 50, since, includeArchived, archived } = req.query;

    const query = { ...filter };

    if (archived === 'true' || archived === true) {
      query.archivedBy = req.user._id;
    } else if (!includeArchived && archived !== 'all') {
      query.archivedBy = { $ne: req.user._id };
    }

    if (status) {
      if (status === 'awaiting_sudo') {
        query.status = { $in: ['pending_sudo_initial', 'pending_final_approval'] };
      } else {
        query.status = status;
      }
    }

    if (type) query.type = type;

    if (uploader && isSudoCaller(req.user)) {
      query['uploadedBy.userId'] = uploader;
    }

    if (since) {
      query.lastMessageAt = { $gt: new Date(Number(since) || since) };
    }

    if (cursor) {
      query.lastMessageAt = { $lt: new Date(cursor) };
    }

    if (q) {
      const escaped = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const searchOr = [
        { batchTrackId: regex },
        { title: regex },
        { originalFileName: regex },
        { 'uploadedBy.name': regex }
      ];

      if (query.$or) {
        query.$and = (query.$and || []).concat([
          { $or: query.$or },
          { $or: searchOr }
        ]);
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
    }

    const leanProjection = {
      _id: 1,
      batchTrackId: 1,
      title: 1,
      type: 1,
      status: 1,
      uploadedBy: 1,
      totalRows: 1,
      eligibleCount: 1,
      skippedCount: 1,
      verifiedCount: 1,
      lastMessageAt: 1,
      lastMessagePreview: 1,
      messageSeq: 1,
      seenBy: 1,
      archivedBy: 1,
      createdAt: 1,
      parentBatchId: 1,
      'progress.percent': 1,
      'progress.jobKind': 1,
      'progress.phase': 1,
      rejection: 1
    };

    const batches = await M.BulkImportBatch.find(query, leanProjection)
      .sort({ lastMessageAt: -1 })
      .limit(Math.min(100, Math.max(1, Number(limit))))
      .lean();

    const formatted = batches.map(b => {
      const userSeen = (b.seenBy || []).find(s => String(s.userId) === String(req.user._id));
      const hasUnread = userSeen ? ((b.messageSeq || 0) > (userSeen.seq || 0)) : (b.messageSeq > 0);
      const isArchived = Array.isArray(b.archivedBy) && b.archivedBy.some(id => String(id) === String(req.user._id));
      return {
        ...b,
        hasUnread,
        isArchived,
        trackId: b.batchTrackId || '',
        uploaderName: b.uploadedBy?.name || ''
      };
    });

    const nextCursor = batches.length ? batches[batches.length - 1].lastMessageAt : null;
    res.json({
      ok: true,
      data: {
        batches: formatted,
        nextCursor
      },
      batches: formatted,
      nextCursor
    });
  } catch (err) {
    console.error('[BulkBatches List Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 2. CREATE DRAFT BATCH ──
router.post('/batches', authMiddleware, requirePage('bulk', 'create'), async (req, res) => {
  try {
    const { type, parentBatchId } = req.body;
    const validTypes = ['dept', 'teacher', 'class', 'subject', 'student'];
    if (!type || !validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Allowed: ${validTypes.join(', ')}` });
    }

    // Role scope check
    if (type === 'dept' && !isSudoCaller(req.user)) {
      return res.status(403).json({ error: 'Department creation requires global administrator privileges' });
    }

    const batchTrackId = generateBatchTrackId();
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
    const title = `${typeLabel} Import · ${batchTrackId.slice(-6)}`;

    const batch = await M.BulkImportBatch.create({
      batchTrackId,
      title,
      type,
      parentBatchId: parentBatchId || null,
      status: 'draft',
      uploadedBy: {
        userId:   req.user._id,
        trackId:  req.user.trackId || '',
        name:     req.user.name || req.user.username || 'User',
        role:     req.user.role || '',
        deptId:   req.user.deptId || null,
        deptName: req.user.deptName || '',
        scope:    req.scope || null
      },
      deviceDetails: {
        ip:         req.ip || '127.0.0.1',
        userAgent:  req.headers['user-agent'] || '',
        sessionId:  req.user.sessionId || '',
        uploadedAt: new Date()
      },
      messageSeq: 0,
      roadmap: [{
        stage: 'draft',
        status: 'INITIALIZED',
        timestamp: new Date(),
        user: req.user.name || req.user.username,
        details: { type }
      }]
    });

    // Seed initial conversational cards
    await postMessage(batch._id, {
      kind: 'card',
      card: 'type',
      author: 'user',
      actor: req.user,
      payload: { type }
    });

    await postMessage(batch._id, {
      kind: 'card',
      card: 'column-ref',
      author: 'system',
      payload: { type }
    });

    await postMessage(batch._id, {
      kind: 'card',
      card: 'upload',
      author: 'system',
      payload: { type }
    });

    const refreshed = await M.BulkImportBatch.findById(batch._id);
    const clientBatch = toClient(refreshed, req.user);
    res.status(201).json({
      ok: true,
      data: { batch: clientBatch },
      batch: clientBatch
    });
  } catch (err) {
    console.error('[BulkBatches Create Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 3. GET ACTIVE RESUME BANNER (LEGACY COMPATIBILITY) ──
router.get('/batches/active', authMiddleware, requirePage('bulk', 'view'), async (req, res) => {
  try {
    const query = {
      'uploadedBy.userId': req.user._id,
      status: { $in: ['staged', 'skipped_resolved', 'pending_sudo_initial', 'sudo_initial_approved', 'verifying', 'verified_all', 'pending_final_approval'] }
    };
    if (isSudoCaller(req.user)) {
      delete query['uploadedBy.userId'];
    }

    const batch = await M.BulkImportBatch.findOne(query).sort({ updatedAt: -1 });
    if (!batch) return res.json({ batch: null });

    const limit24h = await get24HourVerificationCount();
    res.json({
      batch: toClient(batch, req.user),
      limit24h
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 4. GET SINGLE BATCH DETAILS ──
router.get('/batches/:id', authMiddleware, requirePage('bulk', 'view'), loadBatch('view'), async (req, res) => {
  try {
    const limit24h = await get24HourVerificationCount();
    const previewLimit = req.query.includeAllRows === 'true' ? null : 50;
    const clientBatch = toClient(req.batch, req.user, { previewLimit });
    res.json({
      ok: true,
      data: { batch: clientBatch, limit24h },
      batch: clientBatch,
      limit24h
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 5. GET BATCH MESSAGES (TRANSCRIPT) ──
router.get('/batches/:id/messages', authMiddleware, requirePage('bulk', 'view'), loadBatch('view'), async (req, res) => {
  try {
    const afterSeq = Number(req.query.afterSeq !== undefined ? req.query.afterSeq : req.query.since) || 0;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

    const messages = await M.BulkChatMessage.find({
      batchId: req.batch._id,
      seq: { $gt: afterSeq }
    })
      .sort({ seq: 1 })
      .limit(limit)
      .lean();

    res.json({
      ok: true,
      data: {
        messages,
        lastSeq: req.batch.messageSeq || 0
      },
      messages,
      lastSeq: req.batch.messageSeq || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 6. RENAME BATCH TITLE ──
router.patch('/batches/:id', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    const title = String(req.body.title || '').trim().slice(0, 80);
    if (!title) return res.status(400).json({ error: 'Title cannot be empty' });

    req.batch.title = title;
    await req.batch.save();

    res.json({ ok: true, title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 7. ARCHIVE / UNARCHIVE BATCH (PER-USER HIDE) ──
router.post('/batches/:id/archive', authMiddleware, requirePage('bulk', 'view'), loadBatch('view'), async (req, res) => {
  try {
    const shouldArchive = req.body.archived !== false;
    if (shouldArchive) {
      await M.BulkImportBatch.updateOne(
        { _id: req.batch._id },
        { $addToSet: { archivedBy: req.user._id } }
      );
    } else {
      await M.BulkImportBatch.updateOne(
        { _id: req.batch._id },
        { $pull: { archivedBy: req.user._id } }
      );
    }
    res.json({ ok: true, archived: shouldArchive });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 8. POST COMMENT TO CHAT ──
router.post('/batches/:id/comments', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    const text = String(req.body.text || '').trim();
    if (!text || text.length > 1000) {
      return res.status(400).json({ error: 'Comment must be between 1 and 1000 characters' });
    }

    const msg = await postMessage(req.batch._id, {
      kind: 'text',
      author: 'user',
      actor: req.user,
      payload: { text }
    });

    res.json({
      ok: true,
      data: { message: msg },
      message: msg
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 9. MARK MESSAGES SEEN (UNREAD TRACKING) ──
router.post('/batches/:id/seen', authMiddleware, requirePage('bulk', 'view'), loadBatch('view'), async (req, res) => {
  try {
    const seq = Number(req.body.seq) || req.batch.messageSeq || 0;

    await M.BulkImportBatch.updateOne(
      { _id: req.batch._id, 'seenBy.userId': req.user._id },
      { $set: { 'seenBy.$.seq': seq } }
    );

    // If not in seenBy, push
    await M.BulkImportBatch.updateOne(
      { _id: req.batch._id, 'seenBy.userId': { $ne: req.user._id } },
      { $push: { seenBy: { userId: req.user._id, seq } } }
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 10. CLONE BATCH (AFTER REJECTION) ──
router.post('/batches/:id/clone', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    const type = req.batch.type;
    const batchTrackId = generateBatchTrackId();
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
    const title = `${typeLabel} Import · ${batchTrackId.slice(-6)} (Retry)`;

    const newBatch = await M.BulkImportBatch.create({
      batchTrackId,
      title,
      type,
      parentBatchId: req.batch._id,
      status: 'draft',
      uploadedBy: {
        userId:   req.user._id,
        trackId:  req.user.trackId || '',
        name:     req.user.name || req.user.username || 'User',
        role:     req.user.role || '',
        deptId:   req.user.deptId || null,
        deptName: req.user.deptName || '',
        scope:    req.scope || req.batch.uploadedBy?.scope || null
      },
      deviceDetails: {
        ip:         req.ip || '127.0.0.1',
        userAgent:  req.headers['user-agent'] || '',
        sessionId:  req.user.sessionId || '',
        uploadedAt: new Date()
      },
      messageSeq: 0,
      roadmap: [{
        stage: 'draft',
        status: 'CLONED_FROM_' + req.batch.batchTrackId,
        timestamp: new Date(),
        user: req.user.name || req.user.username,
        details: { parentBatchId: req.batch._id }
      }]
    });

    await postMessage(newBatch._id, {
      kind: 'card',
      card: 'type',
      author: 'user',
      actor: req.user,
      payload: { type }
    });

    await postMessage(newBatch._id, {
      kind: 'card',
      card: 'column-ref',
      author: 'system',
      payload: { type }
    });

    await postMessage(newBatch._id, {
      kind: 'card',
      card: 'upload',
      author: 'system',
      payload: { type }
    });

    const clientBatch = toClient(newBatch, req.user);
    res.status(201).json({
      ok: true,
      data: { batch: clientBatch },
      batch: clientBatch
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 11. GET PAGINATED ROWS ──
router.get('/batches/:id/rows', authMiddleware, requirePage('bulk', 'view'), loadBatch('view'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const filter = String(req.query.filter || 'all').toLowerCase().trim();
    const q = String(req.query.q || '').toLowerCase().trim();

    const allRows = (req.batch.eligibleRows || []).map(r => {
      const rowObj = r && typeof r.toObject === 'function' ? r.toObject() : { ...r };
      if (rowObj && rowObj.data && rowObj.data.password !== undefined) {
        const copy = { ...rowObj, data: { ...rowObj.data } };
        delete copy.data.password;
        return copy;
      }
      return rowObj;
    });

    const verifiedCount = allRows.filter(r => r.isVerified).length;
    const pendingCount = allRows.length - verifiedCount;

    let filtered = allRows;
    if (filter === 'pending') {
      filtered = filtered.filter(r => !r.isVerified);
    } else if (filter === 'verified') {
      filtered = filtered.filter(r => r.isVerified);
    }

    if (q) {
      filtered = filtered.filter(r => {
        const d = r.data || {};
        return (d.fullName || d.name || '').toLowerCase().includes(q) ||
               (d.registerNo || d.regNo || '').toLowerCase().includes(q) ||
               (d.employeeNo || d.empId || '').toLowerCase().includes(q) ||
               (d.trackId || '').toLowerCase().includes(q) ||
               (d.email || '').toLowerCase().includes(q) ||
               String(r.rowNumber || '').includes(q);
      });
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const pagedRows = filtered.slice(start, start + limit);

    const result = {
      rows: pagedRows,
      total,
      page,
      limit,
      totalPages,
      counts: {
        total: allRows.length,
        verified: verifiedCount,
        pending: pendingCount
      }
    };

    res.json({
      ok: true,
      data: result,
      ...result
    });
  } catch (err) {
    console.error('[BulkBatches Rows Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 12. GET SINGLE ROW WITH PASSWORD (FOR VERIFY MODAL EDIT ONLY) ──
router.get('/batches/:id/rows/:rowNumber', authMiddleware, requirePage('bulk', 'view'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    const rowNum = Number(req.params.rowNumber);
    const row = (req.batch.eligibleRows || []).find(r => r.rowNumber === rowNum);
    if (!row) {
      return res.status(404).json({ error: `Row ${rowNum} not found in eligible records` });
    }
    res.json({ ok: true, row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.generateBatchTrackId = generateBatchTrackId;
module.exports.get24HourVerificationCount = get24HourVerificationCount;
