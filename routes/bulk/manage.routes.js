/**
 * routes/bulk/manage.routes.js
 * 3-Dot Manager endpoints: Participants (add/change/remove/search), Delete (me/all/restore),
 * Undo all actions, and Restage (P7, §8).
 */

'use strict';

const express = require('express');
const router = express.Router();
const M = require('../../models');
const { authMiddleware, requirePage } = require('../../middleware/auth');
const { loadBatch, isSudoCaller, isSuperAdmin, isSubAdmin, canManage, allRowsInScope } = require('../../services/bulk/access');
const { postMessage } = require('../../services/bulk/messages');
const { bus } = require('../../services/bulk/progress');
const { logAction } = require('../../utils/logAction');
const { undoAllActions } = require('../../services/bulk/undo');
const { runStageJob } = require('../../services/bulk/pipeline');

// ── 1. USER SEARCH FOR PARTICIPANT PICKER ──
router.get('/users/search', authMiddleware, requirePage('bulk', 'create'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.json({ ok: true, users: [] });
    }

    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const userQuery = {
      $or: [
        { fullName: regex },
        { name: regex },
        { username: regex },
        { trackId: regex }
      ]
    };

    // Sub-admin scope restriction
    if (isSubAdmin(req.user) && req.user.deptId) {
      userQuery.deptId = req.user.deptId;
    }

    // Query Users/Teachers (Max 20, no emails per §8.2)
    const teachers = await M.Teacher.find(userQuery)
      .select('_id trackId fullName username department deptId designation')
      .limit(20)
      .lean();

    const users = teachers.map(t => ({
      userId:  t._id,
      trackId: t.trackId || '',
      name:    t.fullName || t.username,
      role:    'teacher',
      deptName: t.department || '',
      deptId:  t.deptId || null
    }));

    res.json({ ok: true, users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 2. ADD PARTICIPANT TO BATCH ──
router.post('/batches/:id/participants', authMiddleware, requirePage('bulk', 'create'), loadBatch('manage'), async (req, res) => {
  try {
    const batch = req.batch;
    if (batch.closed && batch.closed.at) {
      return res.status(400).json({ error: 'BATCH_CLOSED', message: 'Cannot add participants to a closed import chat.' });
    }

    const currentParticipants = batch.participants || [];
    if (currentParticipants.length >= 10) {
      return res.status(400).json({ error: 'MAX_PARTICIPANTS', message: 'Maximum 10 participants allowed per chat.' });
    }

    const { userId, level } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const assignedLevel = (level === 'collaborator') ? 'collaborator' : 'viewer';

    // Guard: cannot add owner or duplicate participant
    if (batch.uploadedBy?.userId && String(batch.uploadedBy.userId) === String(userId)) {
      return res.status(400).json({ error: 'ALREADY_OWNER', message: 'Batch owner is automatically a participant.' });
    }

    if (currentParticipants.some(p => String(p.userId) === String(userId))) {
      return res.status(400).json({ error: 'ALREADY_PARTICIPANT', message: 'User is already a participant in this chat.' });
    }

    // Resolve user details
    let target = await M.Teacher.findById(userId).select('fullName username trackId department deptId').lean();
    if (!target) {
      target = await M.User.findById(userId).select('name username trackId role').lean();
    }
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetName = target.fullName || target.name || target.username || 'User';
    const targetTrackId = target.trackId || '';
    const targetRole = target.role || 'teacher';
    const tier = isSudoCaller(target) ? 'sudo' : (isSuperAdmin(target) ? 'super' : 'staff');

    const newParticipant = {
      userId: target._id,
      trackId: targetTrackId,
      name: targetName,
      role: targetRole,
      tier,
      level: assignedLevel,
      addedBy: req.user._id,
      addedAt: new Date()
    };

    batch.participants.push(newParticipant);
    await batch.save();

    // 1. Post chat event
    const levelLabel = assignedLevel === 'collaborator' ? 'Collaborator' : 'Viewer';
    await postMessage(batch._id, {
      kind: 'event',
      author: 'system',
      actor: req.user,
      payload: {
        text: `${req.user.name || 'User'} added ${targetName} (${levelLabel})`
      }
    });

    // 2. In-app notification to the added user
    if (M.Notification && typeof M.Notification.create === 'function') {
      try {
        await M.Notification.create({
          type: 'info',
          from: req.user.name || 'System',
          fromRole: req.user.role || 'Staff',
          toTeacherId: target._id,
          toTeacherTrackId: targetTrackId,
          toStudentId: null,
          toStudentTrackId: '',
          message: `[EAMS Bulk] You were added as a ${levelLabel} to import ${batch.batchTrackId || batch._id}`,
          priority: 'Normal',
          status: 'Delivered',
          read: false,
          time: new Date()
        });
      } catch (notifErr) {
        console.warn('[ManageRoutes] Notification notice:', notifErr.message);
      }
    }

    // 3. Emit SSE participants event
    bus.emit(`batch:${batch._id}`, {
      type: 'participants',
      data: { participants: batch.participants }
    });

    // 4. Await audit log
    await logAction({
      trackId: 'BULK-' + (batch.batchTrackId || batch._id),
      action: 'bulk.participant.add',
      userId: req.user._id,
      userRole: req.user.role || 'staff',
      details: { addedUserId: target._id, name: targetName, level: assignedLevel }
    }).catch(() => {});

    res.json({
      ok: true,
      message: `Added ${targetName} as ${levelLabel}`,
      data: { participants: batch.participants }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 3. UPDATE PARTICIPANT LEVEL ──
router.patch('/batches/:id/participants/:userId', authMiddleware, requirePage('bulk', 'create'), loadBatch('manage'), async (req, res) => {
  try {
    const batch = req.batch;
    const targetUserId = String(req.params.userId);
    const { level } = req.body;

    if (!['viewer', 'collaborator'].includes(level)) {
      return res.status(400).json({ error: 'Level must be "viewer" or "collaborator"' });
    }

    const p = (batch.participants || []).find(part => String(part.userId) === targetUserId);
    if (!p) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    p.level = level;
    await batch.save();

    const levelLabel = level === 'collaborator' ? 'Collaborator' : 'Viewer';
    await postMessage(batch._id, {
      kind: 'event',
      author: 'system',
      actor: req.user,
      payload: {
        text: `${req.user.name || 'User'} changed ${p.name}'s role to ${levelLabel}`
      }
    });

    bus.emit(`batch:${batch._id}`, {
      type: 'participants',
      data: { participants: batch.participants }
    });

    res.json({ ok: true, data: { participants: batch.participants } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 4. REMOVE PARTICIPANT OR LEAVE CHAT ──
router.delete('/batches/:id/participants/:userId', authMiddleware, requirePage('bulk', 'create'), loadBatch('view'), async (req, res) => {
  try {
    const batch = req.batch;
    const targetUserId = String(req.params.userId);
    const isSelf = String(req.user._id) === targetUserId;

    if (!isSelf && !canManage(req.user, batch)) {
      return res.status(403).json({ error: 'Permission denied: only managers can remove participants, or participants can leave themselves.' });
    }

    const idx = (batch.participants || []).findIndex(part => String(part.userId) === targetUserId);
    if (idx === -1) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const removedParticipant = batch.participants[idx];
    batch.participants.splice(idx, 1);
    await batch.save();

    const eventText = isSelf
      ? `${removedParticipant.name} left the chat`
      : `${req.user.name || 'User'} removed ${removedParticipant.name} from the chat`;

    await postMessage(batch._id, {
      kind: 'event',
      author: 'system',
      actor: req.user,
      payload: { text: eventText }
    });

    bus.emit(`batch:${batch._id}`, {
      type: 'participants',
      data: { participants: batch.participants }
    });

    res.json({
      ok: true,
      message: isSelf ? 'You left the chat' : `Removed ${removedParticipant.name}`,
      data: { participants: batch.participants }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 5. DELETE CHAT (SCOPE: 'ME' OR 'ALL') ──
router.post('/batches/:id/delete', authMiddleware, requirePage('bulk', 'create'), loadBatch('view'), async (req, res) => {
  try {
    const batch = req.batch;
    const scope = req.body.scope === 'all' ? 'all' : 'me';

    if (scope === 'me') {
      // Per-user hide using archivedBy
      if (!Array.isArray(batch.archivedBy)) batch.archivedBy = [];
      const alreadyArchived = batch.archivedBy.some(id => String(id) === String(req.user._id));
      if (!alreadyArchived) {
        batch.archivedBy.push(req.user._id);
        await batch.save();
      }
      return res.json({
        ok: true,
        scope: 'me',
        message: 'Chat removed for you (restore available in Deleted Chats)'
      });
    }

    // scope === 'all': Delete for everyone
    if (['committing', 'committed'].includes(batch.status) || (batch.closed && batch.closed.at)) {
      return res.status(403).json({
        error: 'CANNOT_DELETE_COMMITTED',
        message: 'Committed or closed imports cannot be deleted (legal records preserved in database).'
      });
    }

    const isOwner = batch.uploadedBy?.userId && String(batch.uploadedBy.userId) === String(req.user._id);
    const isPreApproval = ['draft', 'staged', 'skipped_resolved', 'pending_sudo_initial', 'rejected', 'failed', 'cancelled'].includes(batch.status);

    if (isOwner && !isPreApproval && !isSudoCaller(req.user)) {
      return res.status(403).json({
        error: 'OWNER_PRE_APPROVAL_ONLY',
        message: 'Chat owner can only delete for everyone prior to initial approval.'
      });
    }

    if (!isOwner && !isSudoCaller(req.user) && !(isSuperAdmin(req.user) && allRowsInScope(batch, req.user))) {
      return res.status(403).json({
        error: 'PERMISSION_DENIED',
        message: 'Permission denied to delete chat for everyone.'
      });
    }

    batch.deletedAt = new Date();
    batch.deletedBy = req.user._id;
    await batch.save();

    await postMessage(batch._id, {
      kind: 'event',
      author: 'system',
      actor: req.user,
      payload: {
        text: `🗑 Chat deleted for everyone by ${req.user.name || 'Admin'} (files and Drive backup kept)`
      }
    });

    await logAction({
      trackId: 'BULK-' + (batch.batchTrackId || batch._id),
      action: 'bulk.chat.delete',
      userId: req.user._id,
      userRole: req.user.role || 'admin',
      details: { scope: 'all', batchTrackId: batch.batchTrackId }
    }).catch(() => {});

    res.json({
      ok: true,
      scope: 'all',
      message: 'Chat deleted for everyone (restore available to Sudo for 30 days)'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 6. RESTORE CHAT ──
router.post('/batches/:id/restore', authMiddleware, requirePage('bulk', 'create'), async (req, res) => {
  try {
    const rawId = req.params.id;
    const batch = await M.BulkImportBatch.findOne({
      $or: [
        { _id: rawId },
        { batchTrackId: rawId }
      ]
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const scope = req.body.scope === 'all' ? 'all' : 'me';

    if (scope === 'me') {
      if (Array.isArray(batch.archivedBy)) {
        batch.archivedBy = batch.archivedBy.filter(id => String(id) !== String(req.user._id));
        await batch.save();
      }
      return res.json({ ok: true, scope: 'me', message: 'Chat restored to your list' });
    }

    // scope === 'all': Requires sudo or super
    if (!isSudoCaller(req.user) && !isSuperAdmin(req.user)) {
      return res.status(403).json({ error: 'Requires Sudo Administrator privileges to restore chat for everyone' });
    }

    batch.deletedAt = null;
    batch.deletedBy = null;
    await batch.save();

    await postMessage(batch._id, {
      kind: 'event',
      author: 'system',
      actor: req.user,
      payload: {
        text: `Chat restored by ${req.user.name || 'Admin'}`
      }
    });

    await logAction({
      trackId: 'BULK-' + (batch.batchTrackId || batch._id),
      action: 'bulk.chat.restore',
      userId: req.user._id,
      userRole: req.user.role || 'sudo',
      details: { scope: 'all', batchTrackId: batch.batchTrackId }
    }).catch(() => {});

    res.json({ ok: true, scope: 'all', message: 'Chat restored for everyone' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 7. UNDO ALL ACTIONS ──
router.post('/batches/:id/undo', authMiddleware, requirePage('bulk', 'create'), loadBatch('view'), async (req, res) => {
  try {
    const result = await undoAllActions(req.batch._id, req.user, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

// ── 8. RESTAGE FILE FROM EARLIER UPLOAD ──
router.post('/batches/:id/restage', authMiddleware, requirePage('bulk', 'create'), loadBatch('ownerOrSudo'), async (req, res) => {
  try {
    const batch = req.batch;
    if (batch.status !== 'draft') {
      return res.status(409).json({ error: `Cannot restage batch in status "${batch.status}" — batch must be in draft.` });
    }

    const hasFile = Boolean((batch.fileRef && batch.fileRef.gridFsId) || (batch.uploads && batch.uploads.length > 0) || batch.fileBufferBase64);
    if (!hasFile) {
      return res.status(400).json({ error: 'NO_UPLOAD_FOUND', message: 'No previously uploaded spreadsheet file found to restage.' });
    }

    batch.status = 'uploading';
    await batch.save();

    await postMessage(batch._id, {
      kind: 'event',
      author: 'system',
      actor: req.user,
      payload: {
        text: `${req.user.name || 'User'} restaged the existing uploaded spreadsheet`
      }
    });

    res.status(202).json({
      ok: true,
      message: 'Restaging file in background',
      status: 'uploading'
    });

    setImmediate(() => {
      runStageJob(batch._id, req.user).catch(err => {
        console.error('[Async Restage Error]:', err.message);
      });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
