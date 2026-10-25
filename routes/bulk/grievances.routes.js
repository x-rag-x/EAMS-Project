/**
 * routes/bulk/grievances.routes.js
 * Endpoints for reporting, resolving, and downloading skipped row grievances.
 */

const express = require('express');
const router = express.Router();
const M = require('../../models');
const { authMiddleware, requirePage } = require('../../middleware/auth');
const { loadBatch, isAdminRole } = require('../../services/bulk/access');
const { postMessage } = require('../../services/bulk/messages');
const { bus } = require('../../services/bulk/progress');
const { notifySudoOnGrievance, notifySenderOnGrievanceResolved } = require('../../services/bulk/notifications');

/**
 * 1. POST /batches/:id/grievances
 * Submits a problem report on skipped rows.
 * Server builds the report text itself and enforces 5/hour rate limiting.
 */
router.post('/batches/:id/grievances', authMiddleware, requirePage('bulk', 'create'), loadBatch('view'), async (req, res) => {
  try {
    const batch = req.batch;

    // Rate limiting: max 5 grievances per hour per chat
    const oneHourAgo = new Date(Date.now() - 3600000);
    const recentCount = await M.BulkChatMessage.countDocuments({
      batchId: batch._id,
      card: 'grievance',
      createdAt: { $gte: oneHourAgo }
    });

    if (recentCount >= 5) {
      return res.status(429).json({
        error: 'Rate limit reached: Maximum 5 problem reports per hour per import chat.'
      });
    }

    const note = req.body.note ? String(req.body.note).trim().slice(0, 500) : '';
    const rawRows = Array.isArray(req.body.rows) ? req.body.rows.map(Number).filter(n => !isNaN(n)) : [];

    const skipped = batch.skippedRows || [];
    const targetRows = rawRows.length > 0
      ? rawRows
      : skipped.filter(r => !r.isDone && !r.isResolved).map(r => r.rowNumber);

    if (targetRows.length === 0) {
      return res.status(400).json({ error: 'No skipped rows specified or pending.' });
    }

    // Build the error report text on server side (never trust client report text)
    const matchingRows = skipped.filter(r => targetRows.includes(r.rowNumber));
    const trackId = batch.batchTrackId || batch._id;
    const typeLabel = batch.type || 'records';
    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

    let reportLines = [
      `Import ${trackId} · ${typeLabel} · ${batch.originalFileName || 'sheet'} · ${dateStr}`,
      `Total ${(batch.eligibleCount || 0) + (batch.skippedCount || 0)} · Eligible ${batch.eligibleCount || 0} · Skipped ${batch.skippedCount || 0} (${skipped.filter(r => !r.isDone && !r.isResolved).length} pending)`,
      '----------------------------------------'
    ];

    for (const r of matchingRows) {
      const idStr = r.data?.identifier || r.data?.name || r.data?.fullName || r.data?.registerNo || r.data?.employeeNo || r.data?.code || 'Row ' + r.rowNumber;
      const issuesStr = Array.isArray(r.issues) && r.issues.length ? r.issues.join('; ') : (r.reason || 'Invalid data');
      reportLines.push(`Row ${r.rowNumber}  ${idStr} — ${issuesStr}`);
    }

    let reportText = reportLines.join('\n');
    if (reportText.length > 8000) {
      reportText = reportText.slice(0, 7950) + '\n… [truncated]';
    }

    // Append grievance message into chat transcript
    const msgDoc = await postMessage(batch._id, {
      kind: 'text',
      card: 'grievance',
      author: 'user',
      actor: req.user,
      payload: {
        text: reportText,
        note: note,
        rows: targetRows,
        status: 'open',
        senderId: req.user._id,
        createdAt: new Date().toISOString()
      }
    });

    // Increment batch counters
    const updatedBatch = await M.BulkImportBatch.findOneAndUpdate(
      { _id: batch._id },
      { $inc: { 'grievance.open': 1, 'grievance.total': 1 } },
      { returnDocument: 'after' }
    );

    // Notify sudo administrators
    notifySudoOnGrievance(batch, { text: reportText, note, rows: targetRows }, req.user);

    // Broadcast counter update
    bus.emit(`batch:${batch._id}`, {
      type: 'grievance',
      data: updatedBatch.grievance
    });

    res.json({
      ok: true,
      message: `Problem report sent to administrators (${targetRows.length} rows flagged)`,
      data: {
        messageId: msgDoc._id,
        grievance: updatedBatch.grievance
      }
    });
  } catch (err) {
    console.error('[Grievances Submit Error]:', err.message);
    res.status(500).json({ error: 'Failed to submit problem report: ' + err.message });
  }
});

/**
 * 2. PATCH /batches/:id/grievances/:msgId
 * Marks a reported grievance as resolved (Admin only).
 */
router.patch('/batches/:id/grievances/:msgId', authMiddleware, requirePage('bulk', 'create'), loadBatch('view'), async (req, res) => {
  try {
    const batch = req.batch;
    if (!isAdminRole(req.user)) {
      return res.status(403).json({ error: 'Requires administrator privileges to resolve grievances.' });
    }

    const msg = await M.BulkChatMessage.findOne({
      _id: req.params.msgId,
      batchId: batch._id,
      card: 'grievance'
    });

    if (!msg) {
      return res.status(404).json({ error: 'Grievance message not found.' });
    }

    if (msg.payload && msg.payload.status === 'resolved') {
      return res.status(409).json({ error: 'Grievance has already been resolved.' });
    }

    const replyNote = req.body.replyNote ? String(req.body.replyNote).trim().slice(0, 500) : '';

    msg.payload = Object.assign({}, msg.payload, {
      status: 'resolved',
      resolvedBy: req.user.name || req.user.fullName || 'Admin',
      resolvedAt: new Date().toISOString(),
      replyNote: replyNote
    });
    msg.markModified('payload');
    await msg.save();

    // Decrement open grievance count
    const updatedBatch = await M.BulkImportBatch.findOneAndUpdate(
      { _id: batch._id },
      [
        {
          $set: {
            'grievance.open': { $max: [0, { $subtract: ['$grievance.open', 1] }] }
          }
        }
      ],
      { returnDocument: 'after' }
    );

    // Append resolution event in transcript
    const adminName = req.user.name || req.user.fullName || 'Admin';
    await postMessage(batch._id, {
      kind: 'event',
      card: 'event',
      author: 'system',
      payload: {
        text: `⚑ Grievance resolved by ${adminName}${replyNote ? ' · Note: ' + replyNote : ''}`,
        grievanceMsgId: msg._id
      }
    });

    // Notify the reporting user
    if (msg.payload.senderId) {
      notifySenderOnGrievanceResolved(batch, { senderId: msg.payload.senderId }, req.user);
    }

    // Broadcast counter update
    bus.emit(`batch:${batch._id}`, {
      type: 'grievance',
      data: updatedBatch.grievance
    });

    res.json({
      ok: true,
      message: 'Grievance marked as resolved.',
      data: {
        status: 'resolved',
        grievance: updatedBatch.grievance
      }
    });
  } catch (err) {
    console.error('[Grievances Resolve Error]:', err.message);
    res.status(500).json({ error: 'Failed to resolve grievance: ' + err.message });
  }
});

/**
 * 3. GET /batches/:id/grievances
 * Lists all grievances for the batch.
 */
router.get('/batches/:id/grievances', authMiddleware, requirePage('bulk', 'create'), loadBatch('view'), async (req, res) => {
  try {
    const batch = req.batch;
    const grievances = await M.BulkChatMessage.find({
      batchId: batch._id,
      card: 'grievance'
    }).sort({ createdAt: -1 }).lean();

    res.json({
      ok: true,
      data: {
        grievances: grievances || [],
        counters: batch.grievance || { open: 0, total: 0 }
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load grievances: ' + err.message });
  }
});

/**
 * 4. GET /batches/:id/skipped-report.csv
 * Downloads a structured CSV report of all skipped rows for audit and offline resolution.
 */
router.get('/batches/:id/skipped-report.csv', authMiddleware, requirePage('bulk', 'create'), loadBatch('view'), async (req, res) => {
  try {
    const batch = req.batch;
    const skipped = batch.skippedRows || [];

    const headers = ['Row Number', 'Identifier', 'Reason', 'Detailed Issues', 'Status'];
    const rows = [headers.join(',')];

    for (const r of skipped) {
      const idStr = r.data?.identifier || r.data?.name || r.data?.fullName || r.data?.registerNo || r.data?.employeeNo || r.data?.code || '—';
      const reasonStr = (r.reason || '').replace(/"/g, '""');
      const issuesStr = Array.isArray(r.issues) ? r.issues.join('; ').replace(/"/g, '""') : '';
      const statusStr = (r.isDone || r.isResolved) ? 'Done' : 'Pending';

      rows.push([
        r.rowNumber || '',
        `"${idStr.replace(/"/g, '""')}"`,
        `"${reasonStr}"`,
        `"${issuesStr}"`,
        statusStr
      ].join(','));
    }

    const csvContent = rows.join('\r\n');
    const filename = `${batch.batchTrackId || ('BATCH-' + String(batch._id).slice(-6))}_skipped_report.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate skipped rows CSV: ' + err.message });
  }
});

module.exports = router;
