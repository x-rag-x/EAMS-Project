/**
 * routes/accessRequest.routes.js
 *
 * Full Sub-Admin Lifecycle: Access Requests & Approval Workflows (§4.6, §10, §11, R7.1, R7.4)
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { sanitizeToString, sanitizeToObjectId } = require('../utils/sanitizeQuery');

/**
 * Generate unique, sequential-formatted Request ID: AR-000001
 */
async function generateRequestId() {
  const count = await M.AccessRequest.countDocuments();
  const candidate = `AR-${String(count + 1).padStart(6, '0')}`;
  const exists = await M.AccessRequest.findOne({ requestId: candidate });
  if (!exists) return candidate;
  return `AR-${Date.now().toString().slice(-6)}`;
}

/**
 * Check whether a user is the HOD (or acting HOD / Sudo Admin) for a given department
 */
async function isHodOfDept(user, deptId) {
  if (!user) return false;
  const isSudo = Boolean(user.isSudoAdmin || user.access?.flags?.isSudo);
  if (isSudo) return true;

  const targetDeptId = deptId ? String(deptId) : null;
  if (!targetDeptId) return false;

  const userDeptId = String(user.deptId || user.access?.pages?.admin?.deptId || '');
  const teacherId = user.roleDocId || user._id;

  // 1. Direct user flags
  const isHodFlag = Boolean(user.isHod || user.access?.flags?.isHod);
  if (isHodFlag && userDeptId === targetDeptId) {
    return true;
  }

  // 2. Department document hodId check
  try {
    const dept = await M.Department.findById(targetDeptId).lean();
    if (dept && dept.hodId && String(dept.hodId) === String(teacherId)) {
      return true;
    }
  } catch (_) {}

  // 3. Active RoleAssignment for hod
  try {
    const roleAssign = await M.RoleAssignment.findOne({
      deptId: targetDeptId,
      role: 'hod',
      teacherId: teacherId,
      active: true
    }).lean();
    if (roleAssign) return true;
  } catch (_) {}

  // 4. Active ActingRole for hod
  try {
    if (M.ActingRole) {
      const acting = await M.ActingRole.findOne({
        deptId: targetDeptId,
        role: 'hod',
        actingTeacherId: teacherId,
        active: true
      }).lean();
      if (acting) return true;
    }
  } catch (_) {}

  return false;
}

/**
 * GET /api/access-requests
 * Query access requests with role-aware scoping (§10, §11)
 * - Sudo Admin: sees all
 * - HOD: sees own department or requested by self
 * - Super Admin: sees own department or requested by self
 * - Staff: sees requested for self or by self
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const isSudo = Boolean(req.user.isSudoAdmin || req.access?.flags?.isSudo);
    const isSuper = Boolean(req.access?.flags?.isSuper);
    const isHod = Boolean(req.user.isHod || req.access?.flags?.isHod);
    const callerDeptId = req.access?.pages?.admin?.deptId || req.user.deptId;
    const callerTrackId = req.user.trackId || String(req.user._id);

    const filter = {};
    if (req.query.status) {
      const s = req.query.status;
      if (s === 'pending') {
        filter.status = { $in: ['pending', 'pending_hod', 'pending_sudo'] };
      } else if (s === 'approved') {
        filter.status = { $in: ['approved', 'approved_with_changes'] };
      } else if (s === 'denied') {
        filter.status = { $in: ['denied', 'denied_by_hod'] };
      } else if (['pending_hod', 'pending_sudo', 'approved', 'approved_with_changes', 'denied', 'denied_by_hod', 'withdrawn', 'expired'].includes(s)) {
        filter.status = s;
      }
    }

    if (!isSudo) {
      if ((isSuper || isHod) && callerDeptId) {
        filter.$or = [
          { deptId: callerDeptId },
          { 'requestedBy.trackId': callerTrackId },
          { forTeacherTrackId: callerTrackId }
        ];
      } else {
        filter.$or = [
          { forTeacherTrackId: callerTrackId },
          { 'requestedBy.trackId': callerTrackId }
        ];
      }
    } else if (req.query.deptId) {
      filter.deptId = sanitizeToObjectId(req.query.deptId);
    }

    const requests = await M.AccessRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({
      ok: true,
      requests
    });
  } catch (err) {
    console.error('[GET /api/access-requests error]:', err);
    res.status(500).json({ error: 'Failed to fetch access requests', details: err.message });
  }
});

/**
 * POST /api/access-requests
 * Create a new access request (§8, §10, R6.3, R7.3)
 * Both Super Admin and Sudo Admin can create sub-admin requests.
 * Workflow: Enters pending_hod -> HOD approves -> pending_sudo -> Sudo confirms.
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const isSudo = Boolean(req.user.isSudoAdmin || req.access?.flags?.isSudo);
    const isSuper = Boolean(req.access?.flags?.isSuper);
    const callerDeptId = req.access?.pages?.admin?.deptId || req.user.deptId;

    let { forTeacherId, grants, page, pages, scope, durationDays, actions, tabs, validFrom, validTo, reason } = req.body;

    reason = sanitizeToString(reason);
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Business reason is required for access request', code: 'REASON_REQUIRED' });
    }

    // Determine target teacher
    let targetTeacherId = forTeacherId ? sanitizeToObjectId(forTeacherId) : (req.user.roleDocId || req.user._id);
    const targetTeacher = await M.Teacher.findById(targetTeacherId).lean();
    if (!targetTeacher) {
      return res.status(404).json({ error: 'Target faculty member not found', code: 'TEACHER_NOT_FOUND' });
    }

    // Super Admin Scope Enforcement (§10)
    if (!isSudo && isSuper) {
      if (callerDeptId && String(targetTeacher.deptId) !== String(callerDeptId)) {
        return res.status(403).json({
          error: 'Super Admins can only request access for faculty in their own department.',
          code: 'CROSS_DEPT_FORBIDDEN'
        });
      }
    }

    // Normalize grants array (handles array of grants, array of pages, or single page)
    let grantsList = [];
    const durDays = Number(durationDays) || 7;
    const fromDate = validFrom ? new Date(validFrom) : new Date();
    const toDate = validTo ? new Date(validTo) : new Date(fromDate.getTime() + durDays * 24 * 60 * 60 * 1000);
    const sanitizedActions = Array.isArray(actions) && actions.length > 0 ? actions.map(a => sanitizeToString(a).toLowerCase()) : ['view'];
    const sanitizedTabs = Array.isArray(tabs) ? tabs.map(t => sanitizeToString(t)) : [];

    if (Array.isArray(grants) && grants.length > 0) {
      grantsList = grants;
    } else if (Array.isArray(pages) && pages.length > 0) {
      grantsList = pages.map(p => {
        const pageKey = sanitizeToString(p).toLowerCase();
        return {
          page: pageKey,
          scope: isSudo ? (scope || 'department') : 'department',
          deptId: targetTeacher.deptId || null,
          deptName: targetTeacher.department || '',
          actions: sanitizedActions,
          tabs: sanitizedTabs,
          validFrom: fromDate,
          validTo: toDate,
          enabled: true
        };
      }).filter(g => Boolean(g.page));
    } else if (page) {
      const pageKey = sanitizeToString(page).toLowerCase();
      grantsList = [{
        page: pageKey,
        scope: isSudo ? (scope || 'department') : 'department',
        deptId: targetTeacher.deptId || null,
        deptName: targetTeacher.department || '',
        actions: sanitizedActions,
        tabs: sanitizedTabs,
        validFrom: fromDate,
        validTo: toDate,
        enabled: true
      }];
    } else {
      return res.status(400).json({ error: 'Page/module or grants array is required', code: 'PAGE_REQUIRED' });
    }

    if (grantsList.length === 0) {
      return res.status(400).json({ error: 'At least one valid page must be selected', code: 'PAGE_REQUIRED' });
    }

    // Validate dates & enforce department-only scope for Super Admins
    const maxDays = 180;
    const nowMs = Date.now();
    for (const g of grantsList) {
      if (!g.page) return res.status(400).json({ error: 'Each grant requires a page identifier' });
      if (!isSudo) {
        g.scope = 'department';
        g.deptId = targetTeacher.deptId || null;
      }
      if (!g.validTo) {
        g.validTo = new Date(nowMs + 7 * 24 * 60 * 60 * 1000);
      } else {
        g.validTo = new Date(g.validTo);
      }
      g.validFrom = g.validFrom ? new Date(g.validFrom) : new Date();

      if (g.validTo.getTime() - g.validFrom.getTime() > maxDays * 24 * 60 * 60 * 1000) {
        return res.status(400).json({
          error: `Requested duration exceeds maximum allowed limit of ${maxDays} days.`,
          code: 'MAX_DURATION_EXCEEDED'
        });
      }
    }

    const requestId = await generateRequestId();
    const requesterRole = isSudo ? 'sudoAdmin' : (isSuper ? 'superAdmin' : 'teacher');

    // Check if requester is already the HOD for this department
    const requesterIsHod = await isHodOfDept(req.user, targetTeacher.deptId);
    let initialStatus = 'pending_hod';
    let hodApprovalDoc = {
      status: 'pending',
      decidedBy: { teacherId: null, trackId: '', name: '' },
      decidedAt: null,
      decisionNote: ''
    };

    if (requesterIsHod) {
      initialStatus = 'pending_sudo';
      hodApprovalDoc = {
        status: 'approved',
        decidedBy: {
          teacherId: req.user.roleDocId || req.user._id,
          trackId: req.user.trackId || String(req.user._id),
          name: req.user.fullName || req.user.name || req.user.username
        },
        decidedAt: new Date(),
        decisionNote: 'Auto-approved by Department HOD upon creation'
      };
    }

    const pagesArray = Array.from(new Set(grantsList.map(g => g.page)));

    const newRequest = await M.AccessRequest.create({
      requestId,
      forTeacherId: targetTeacher._id,
      forTeacherTrackId: targetTeacher.trackId || String(targetTeacher._id),
      forTeacherName: targetTeacher.fullName || targetTeacher.name || targetTeacher.username,
      deptId: targetTeacher.deptId || null,
      deptName: targetTeacher.department || '',
      requestedBy: {
        teacherId: req.user.roleDocId || req.user._id,
        trackId: req.user.trackId || String(req.user._id),
        name: req.user.fullName || req.user.name || req.user.username,
        role: requesterRole
      },
      pages: pagesArray,
      grants: grantsList,
      reason,
      hodApproval: hodApprovalDoc,
      status: initialStatus
    });

    // Notify appropriate approvers (non-blocking)
    setImmediate(async () => {
      try {
        if (M.Notification) {
          const reqName = req.user.fullName || req.user.name || req.user.username;
          const pagesStr = pagesArray.join(', ');
          const notifMsg = initialStatus === 'pending_hod'
            ? `New Sub-Admin Access Request [${requestId}]: ${reqName} requested access to "${pagesStr}" for ${targetTeacher.fullName || 'Faculty'}. Awaiting Department HOD approval.`
            : `New Sub-Admin Access Request [${requestId}]: ${reqName} requested access to "${pagesStr}" for ${targetTeacher.fullName || 'Faculty'}. Approved by HOD, awaiting Sudo Admin confirmation.`;

          await M.Notification.create({
            type: 'request',
            from: reqName,
            fromRole: requesterRole,
            message: notifMsg,
            priority: 'High',
            status: 'Pending'
          });
        }
      } catch (notifErr) {
        console.warn('[access-request notify warning]:', notifErr.message);
      }
    });

    await logAction(
      req.user.trackId || String(req.user._id),
      req.user.fullName || req.user.name || req.user.username,
      req.user.role || 'teacher',
      'Access Request Submitted',
      `Submitted access request ${requestId} for ${targetTeacher.fullName} (Status: ${initialStatus}). Reason: ${reason}`,
      'admin',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'access-request-create', requestId, forTeacherId: targetTeacher._id, status: initialStatus }
    );

    const userFacingMsg = initialStatus === 'pending_hod'
      ? `Access request ${requestId} submitted. Awaiting HOD approval, then Sudo confirmation.`
      : `Access request ${requestId} submitted. Awaiting Sudo Administrator confirmation.`;

    res.status(201).json({
      ok: true,
      requestId,
      status: initialStatus,
      message: userFacingMsg,
      request: newRequest
    });
  } catch (err) {
    console.error('[POST /api/access-requests error]:', err);
    res.status(500).json({ error: 'Failed to submit access request', details: err.message });
  }
});

/**
 * POST /api/access-requests/:id/hod-approve
 * Department HOD reviews and endorses sub-admin request (§10, R7.4)
 * Moves request to pending_sudo for final Sudo confirmation.
 */
router.post('/:id/hod-approve', authMiddleware, async (req, res) => {
  try {
    const reqIdParam = req.params.id;
    const request = await M.AccessRequest.findOne({
      $or: [
        { requestId: reqIdParam },
        ...(mongoose.Types.ObjectId.isValid(reqIdParam) ? [{ _id: reqIdParam }] : [])
      ]
    });

    if (!request) {
      return res.status(404).json({ error: 'Access request not found', code: 'NOT_FOUND' });
    }

    if (!['pending_hod', 'pending'].includes(request.status)) {
      return res.status(400).json({ error: `Request cannot be approved by HOD: status is "${request.status}"`, code: 'INVALID_STATUS' });
    }

    const authorized = await isHodOfDept(req.user, request.deptId);
    if (!authorized) {
      return res.status(403).json({ error: 'Only the Department HOD (or Sudo Admin) can approve this request.', code: 'FORBIDDEN_HOD' });
    }

    const note = sanitizeToString(req.body.note || req.body.decisionNote) || 'Endorsed by Department HOD';

    request.hodApproval = {
      status: 'approved',
      decidedBy: {
        teacherId: req.user.roleDocId || req.user._id,
        trackId: req.user.trackId || String(req.user._id),
        name: req.user.fullName || req.user.name || req.user.username
      },
      decidedAt: new Date(),
      decisionNote: note
    };
    request.status = 'pending_sudo';
    await request.save();

    // Notify Sudo Admins (non-blocking)
    setImmediate(async () => {
      try {
        if (M.Notification) {
          const hodName = req.user.fullName || req.user.name || req.user.username;
          await M.Notification.create({
            type: 'request',
            from: hodName,
            fromRole: 'hod',
            message: `Sub-Admin Request [${request.requestId}]: HOD ${hodName} endorsed access for ${request.forTeacherName}. Awaiting your Sudo confirmation.`,
            priority: 'High',
            status: 'Pending'
          });
        }
      } catch (e) {
        console.warn('[hod-approve notify err]:', e.message);
      }
    });

    await logAction(
      req.user.trackId || String(req.user._id),
      req.user.fullName || req.user.name || req.user.username,
      req.user.role || 'teacher',
      'Access Request HOD Approved',
      `HOD approved request ${request.requestId} for ${request.forTeacherName}. Note: ${note}`,
      'admin',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'access-request-hod-approve', requestId: request.requestId, teacherId: request.forTeacherId }
    );

    res.json({
      ok: true,
      message: `Access request ${request.requestId} approved by HOD. Awaiting Sudo Administrator confirmation.`,
      request
    });
  } catch (err) {
    console.error('[POST /api/access-requests/:id/hod-approve error]:', err);
    res.status(500).json({ error: 'Failed to approve request as HOD', details: err.message });
  }
});

/**
 * POST /api/access-requests/:id/hod-deny
 * Department HOD rejects sub-admin request (§10, R7.4)
 */
router.post('/:id/hod-deny', authMiddleware, async (req, res) => {
  try {
    const reason = sanitizeToString(req.body.reason || req.body.decisionNote);
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'A denial reason is required.', code: 'REASON_REQUIRED' });
    }

    const reqIdParam = req.params.id;
    const request = await M.AccessRequest.findOne({
      $or: [
        { requestId: reqIdParam },
        ...(mongoose.Types.ObjectId.isValid(reqIdParam) ? [{ _id: reqIdParam }] : [])
      ]
    });

    if (!request) {
      return res.status(404).json({ error: 'Access request not found', code: 'NOT_FOUND' });
    }

    if (!['pending_hod', 'pending'].includes(request.status)) {
      return res.status(400).json({ error: `Request cannot be denied by HOD: status is "${request.status}"`, code: 'INVALID_STATUS' });
    }

    const authorized = await isHodOfDept(req.user, request.deptId);
    if (!authorized) {
      return res.status(403).json({ error: 'Only the Department HOD (or Sudo Admin) can deny this request.', code: 'FORBIDDEN_HOD' });
    }

    request.hodApproval = {
      status: 'denied',
      decidedBy: {
        teacherId: req.user.roleDocId || req.user._id,
        trackId: req.user.trackId || String(req.user._id),
        name: req.user.fullName || req.user.name || req.user.username
      },
      decidedAt: new Date(),
      decisionNote: reason
    };
    request.status = 'denied_by_hod';
    request.decisionNote = `Denied by HOD: ${reason}`;
    await request.save();

    // In-app notifications
    setImmediate(async () => {
      try {
        if (M.Notification) {
          const hodName = req.user.fullName || req.user.name || req.user.username;
          await M.Notification.create({
            type: 'info',
            from: hodName,
            fromRole: 'hod',
            toTeacherId: request.forTeacherId,
            toTeacherName: request.forTeacherName || '',
            toTeacherTrackId: request.forTeacherTrackId || '',
            message: `Access Request Denied by HOD [${request.requestId}]: ${reason}`,
            priority: 'Normal',
            status: 'Pending'
          });
        }
      } catch (e) {
        console.warn('[hod-deny notify err]:', e.message);
      }
    });

    await logAction(
      req.user.trackId || String(req.user._id),
      req.user.fullName || req.user.name || req.user.username,
      req.user.role || 'teacher',
      'Access Request Denied by HOD',
      `HOD denied request ${request.requestId}. Reason: ${reason}`,
      'admin',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'access-request-hod-deny', requestId: request.requestId, reason }
    );

    res.json({
      ok: true,
      message: `Access request ${request.requestId} has been denied by HOD.`,
      request
    });
  } catch (err) {
    console.error('[POST /api/access-requests/:id/hod-deny error]:', err);
    res.status(500).json({ error: 'Failed to deny access request as HOD', details: err.message });
  }
});

/**
 * POST /api/access-requests/:id/approve
 * Sudo Admin approves the request and provisions grants (§10, R7.4)
 * Final confirmation: transitions status to approved.
 */
router.post('/:id/approve', authMiddleware, async (req, res) => {
  try {
    const isSudo = Boolean(req.user.isSudoAdmin || req.access?.flags?.isSudo);
    if (!isSudo) {
      return res.status(403).json({ error: 'Only Sudo Administrator can confirm and approve access requests.', code: 'FORBIDDEN' });
    }

    const reqIdParam = req.params.id;
    const request = await M.AccessRequest.findOne({
      $or: [
        { requestId: reqIdParam },
        ...(mongoose.Types.ObjectId.isValid(reqIdParam) ? [{ _id: reqIdParam }] : [])
      ]
    });

    if (!request) {
      return res.status(404).json({ error: 'Access request not found', code: 'NOT_FOUND' });
    }

    if (!['pending_sudo', 'pending', 'pending_hod'].includes(request.status)) {
      return res.status(400).json({ error: `Request cannot be approved: status is "${request.status}"`, code: 'INVALID_STATUS' });
    }

    const teacher = await M.Teacher.findById(request.forTeacherId);
    if (!teacher) {
      return res.status(404).json({ error: 'Target faculty member not found', code: 'TEACHER_NOT_FOUND' });
    }

    // Write grants to teacher record
    let pr = teacher.pageRights || { accessRole: 'none', version: 0, grants: [] };
    if (!Array.isArray(pr.grants)) pr.grants = [];

    const grantsToApply = request.grants.map(g => ({
      _id: new mongoose.Types.ObjectId(),
      page: g.page,
      scope: g.scope || 'department',
      deptId: g.deptId || teacher.deptId || null,
      dept: g.deptName || teacher.department || '',
      actions: g.actions || ['view'],
      tabs: g.tabs || [],
      validFrom: g.validFrom || new Date(),
      validTo: g.validTo,
      enabled: true,
      source: 'request',
      requestId: request.requestId,
      grantedBy: {
        trackId: req.user.trackId || String(req.user._id),
        name: req.user.fullName || req.user.name || req.user.username
      },
      grantedAt: new Date()
    }));

    pr.grants.push(...grantsToApply);
    if (pr.accessRole === 'none') {
      pr.accessRole = 'subAdmin';
    }
    pr.version = (pr.version || 0) + 1;
    teacher.pageRights = { ...pr };
    teacher.markModified('pageRights');
    teacher.accessVersion = (teacher.accessVersion || 0) + 1;
    await teacher.save();

    // Mark HOD approval satisfied if skipped/overridden by Sudo
    if (!request.hodApproval || request.hodApproval.status === 'pending') {
      request.hodApproval = {
        status: 'approved',
        decidedBy: {
          teacherId: req.user.roleDocId || req.user._id,
          trackId: req.user.trackId || String(req.user._id),
          name: req.user.fullName || req.user.name || req.user.username
        },
        decidedAt: new Date(),
        decisionNote: 'Directly confirmed by Sudo Administrator override'
      };
    }

    // Mark request approved
    request.status = 'approved';
    request.decidedBy = {
      teacherId: req.user.roleDocId || req.user._id,
      trackId: req.user.trackId || String(req.user._id),
      name: req.user.fullName || req.user.name || req.user.username
    };
    request.decidedAt = new Date();
    request.approvedGrants = request.grants;
    await request.save();

    // In-app notifications
    setImmediate(async () => {
      try {
        if (M.Notification) {
          const decName = req.user.fullName || req.user.name || req.user.username;
          await M.Notification.create({
            type: 'info',
            from: decName,
            fromRole: 'sudoAdmin',
            toTeacherId: teacher._id,
            toTeacherName: teacher.fullName || '',
            toTeacherTrackId: teacher.trackId || '',
            message: `Access Request Approved [${request.requestId}]: Sudo Admin confirmed and provisioned sub-admin access for ${teacher.fullName}.`,
            priority: 'Normal',
            status: 'Pending'
          });
        }
      } catch (e) {
        console.warn('[approve notify err]:', e.message);
      }
    });

    await logAction(
      req.user.trackId,
      req.user.name,
      req.user.role,
      'Access Request Approved',
      `Approved request ${request.requestId} for ${teacher.fullName}`,
      'admin',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'access-request-approve', requestId: request.requestId, teacherId: teacher._id }
    );

    res.json({
      ok: true,
      message: `Access request ${request.requestId} confirmed and privileges provisioned for ${teacher.fullName}.`,
      request
    });
  } catch (err) {
    console.error('[POST /api/access-requests/:id/approve error]:', err);
    res.status(500).json({ error: 'Failed to approve access request', details: err.message });
  }
});

/**
 * POST /api/access-requests/:id/approve-with-changes
 * Sudo Admin approves with customized pages / dates / actions (§10, R7.4)
 */
router.post('/:id/approve-with-changes', authMiddleware, async (req, res) => {
  try {
    const isSudo = Boolean(req.user.isSudoAdmin || req.access?.flags?.isSudo);
    if (!isSudo) {
      return res.status(403).json({ error: 'Only Sudo Administrator can approve access requests with changes.', code: 'FORBIDDEN' });
    }

    const { approvedGrants, decisionNote } = req.body;
    if (!Array.isArray(approvedGrants) || approvedGrants.length === 0) {
      return res.status(400).json({ error: 'Approved grants array is required when approving with changes.' });
    }

    const reqIdParam = req.params.id;
    const request = await M.AccessRequest.findOne({
      $or: [
        { requestId: reqIdParam },
        ...(mongoose.Types.ObjectId.isValid(reqIdParam) ? [{ _id: reqIdParam }] : [])
      ]
    });

    if (!request) return res.status(404).json({ error: 'Access request not found' });
    if (!['pending_sudo', 'pending', 'pending_hod'].includes(request.status)) {
      return res.status(400).json({ error: `Request status is already "${request.status}"` });
    }

    const teacher = await M.Teacher.findById(request.forTeacherId);
    if (!teacher) return res.status(404).json({ error: 'Target faculty member not found' });

    let pr = teacher.pageRights || { accessRole: 'none', version: 0, grants: [] };
    if (!Array.isArray(pr.grants)) pr.grants = [];

    const grantsToApply = approvedGrants.map(g => ({
      _id: new mongoose.Types.ObjectId(),
      page: sanitizeToString(g.page).toLowerCase(),
      scope: g.scope || 'department',
      deptId: g.deptId || teacher.deptId || null,
      dept: g.deptName || teacher.department || '',
      actions: Array.isArray(g.actions) ? g.actions.map(a => sanitizeToString(a).toLowerCase()) : ['view'],
      tabs: Array.isArray(g.tabs) ? g.tabs.map(t => sanitizeToString(t)) : [],
      validFrom: g.validFrom ? new Date(g.validFrom) : new Date(),
      validTo: new Date(g.validTo || (Date.now() + 7 * 24 * 60 * 60 * 1000)),
      enabled: true,
      source: 'request_modified',
      requestId: request.requestId,
      grantedBy: {
        trackId: req.user.trackId || String(req.user._id),
        name: req.user.fullName || req.user.name || req.user.username
      },
      grantedAt: new Date()
    }));

    pr.grants.push(...grantsToApply);
    if (pr.accessRole === 'none') {
      pr.accessRole = 'subAdmin';
    }
    pr.version = (pr.version || 0) + 1;
    teacher.pageRights = { ...pr };
    teacher.markModified('pageRights');
    teacher.accessVersion = (teacher.accessVersion || 0) + 1;
    await teacher.save();

    if (!request.hodApproval || request.hodApproval.status === 'pending') {
      request.hodApproval = {
        status: 'approved',
        decidedBy: {
          teacherId: req.user.roleDocId || req.user._id,
          trackId: req.user.trackId || String(req.user._id),
          name: req.user.fullName || req.user.name || req.user.username
        },
        decidedAt: new Date(),
        decisionNote: 'Directly confirmed with adjustments by Sudo Administrator'
      };
    }

    request.status = 'approved_with_changes';
    request.decisionNote = sanitizeToString(decisionNote) || 'Approved with adjustments';
    request.decidedBy = {
      teacherId: req.user.roleDocId || req.user._id,
      trackId: req.user.trackId || String(req.user._id),
      name: req.user.fullName || req.user.name || req.user.username
    };
    request.decidedAt = new Date();
    request.approvedGrants = approvedGrants;
    await request.save();

    // In-app notifications
    setImmediate(async () => {
      try {
        if (M.Notification) {
          const decName = req.user.fullName || req.user.name || req.user.username;
          await M.Notification.create({
            type: 'info',
            from: decName,
            fromRole: 'sudoAdmin',
            toTeacherId: teacher._id,
            toTeacherName: teacher.fullName || '',
            toTeacherTrackId: teacher.trackId || '',
            message: `Access Request Approved with Adjustments [${request.requestId}]: ${decisionNote || 'Adjustments made by Sudo Admin.'}`,
            priority: 'Normal',
            status: 'Pending'
          });
        }
      } catch (e) {
        console.warn('[approve-modified notify err]:', e.message);
      }
    });

    await logAction(
      req.user.trackId,
      req.user.name,
      req.user.role,
      'Access Request Approved with Changes',
      `Approved request ${request.requestId} with changes for ${teacher.fullName}. Note: ${decisionNote}`,
      'admin',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'access-request-approve-modified', requestId: request.requestId, decisionNote }
    );

    res.json({
      ok: true,
      message: `Access request ${request.requestId} approved with changes for ${teacher.fullName}.`,
      request
    });
  } catch (err) {
    console.error('[POST /api/access-requests/:id/approve-with-changes error]:', err);
    res.status(500).json({ error: 'Failed to approve request with changes', details: err.message });
  }
});

/**
 * POST /api/access-requests/:id/deny
 * Sudo Admin denies request (§10, R7.4)
 */
router.post('/:id/deny', authMiddleware, async (req, res) => {
  try {
    const isSudo = Boolean(req.user.isSudoAdmin || req.access?.flags?.isSudo);
    if (!isSudo) {
      return res.status(403).json({ error: 'Only Sudo Administrator can deny access requests.', code: 'FORBIDDEN' });
    }

    const reason = sanitizeToString(req.body.reason || req.body.decisionNote);
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'A denial reason is required.', code: 'REASON_REQUIRED' });
    }

    const reqIdParam = req.params.id;
    const request = await M.AccessRequest.findOne({
      $or: [
        { requestId: reqIdParam },
        ...(mongoose.Types.ObjectId.isValid(reqIdParam) ? [{ _id: reqIdParam }] : [])
      ]
    });

    if (!request) return res.status(404).json({ error: 'Access request not found' });
    if (!['pending_sudo', 'pending', 'pending_hod'].includes(request.status)) {
      return res.status(400).json({ error: `Request status is already "${request.status}"` });
    }

    request.status = 'denied';
    request.decisionNote = reason;
    request.decidedBy = {
      teacherId: req.user.roleDocId || req.user._id,
      trackId: req.user.trackId || String(req.user._id),
      name: req.user.fullName || req.user.name || req.user.username
    };
    request.decidedAt = new Date();
    await request.save();

    // In-app notifications
    setImmediate(async () => {
      try {
        if (M.Notification) {
          const decName = req.user.fullName || req.user.name || req.user.username;
          await M.Notification.create({
            type: 'info',
            from: decName,
            fromRole: 'sudoAdmin',
            toTeacherId: request.forTeacherId?.teacherId || null,
            toTeacherName: request.forTeacherId?.name || '',
            toTeacherTrackId: request.forTeacherId?.trackId || '',
            message: `Access Request Denied [${request.requestId}]: ${reason}`,
            priority: 'Normal',
            status: 'Pending'
          });
        }
      } catch (e) {
        console.warn('[deny notify err]:', e.message);
      }
    });

    await logAction(
      req.user.trackId,
      req.user.name,
      req.user.role,
      'Access Request Denied',
      `Denied request ${request.requestId}. Reason: ${reason}`,
      'admin',
      'warning',
      req.ip,
      req.user.sessionId,
      { module: 'admin', subType: 'access-request-deny', requestId: request.requestId, reason }
    );

    res.json({
      ok: true,
      message: `Access request ${request.requestId} has been denied.`,
      request
    });
  } catch (err) {
    console.error('[POST /api/access-requests/:id/deny error]:', err);
    res.status(500).json({ error: 'Failed to deny access request', details: err.message });
  }
});

/**
 * POST /api/access-requests/:id/withdraw
 * Requester withdraws pending request (§10, R7.4)
 */
router.post('/:id/withdraw', authMiddleware, async (req, res) => {
  try {
    const isSudo = Boolean(req.user.isSudoAdmin || req.access?.flags?.isSudo);
    const callerTrackId = req.user.trackId || String(req.user._id);

    const reqIdParam = req.params.id;
    const request = await M.AccessRequest.findOne({
      $or: [
        { requestId: reqIdParam },
        ...(mongoose.Types.ObjectId.isValid(reqIdParam) ? [{ _id: reqIdParam }] : [])
      ]
    });

    if (!request) return res.status(404).json({ error: 'Access request not found' });
    if (!['pending_sudo', 'pending', 'pending_hod'].includes(request.status)) {
      return res.status(400).json({ error: `Cannot withdraw request: status is "${request.status}"` });
    }

    if (!isSudo && request.requestedBy?.trackId !== callerTrackId) {
      return res.status(403).json({ error: 'Only the original requester can withdraw this request.', code: 'FORBIDDEN' });
    }

    request.status = 'withdrawn';
    await request.save();

    res.json({
      ok: true,
      message: `Access request ${request.requestId} withdrawn.`,
      request
    });
  } catch (err) {
    console.error('[POST /api/access-requests/:id/withdraw error]:', err);
    res.status(500).json({ error: 'Failed to withdraw access request', details: err.message });
  }
});

module.exports = router;
