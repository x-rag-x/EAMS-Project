/**
 * routes/manageAdmins.routes.js
 *
 * Manage Portal Admin Management API
 * Backed by modern M.Teacher.pageRights access system.
 * Allows viewing, granting, and revoking Manage portal delegated access.
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const M = require('../models');
const { authMiddleware, requirePage, isSudo } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');
const { sanitizeToObjectId } = require('../utils/sanitizeQuery');
const { parseAllowedTabs } = require('../config/pageRegistry');
const { assertNotLastSudoAdmin } = require('../utils/adminGuards');

/**
 * GET /api/manage-admins
 * Returns all teachers who have access to the Manage portal
 */
router.get('/', authMiddleware, requirePage('manage', 'view', { tab: 'settings' }), async (req, res) => {
  try {
    const teachers = await M.Teacher.find({
      $or: [
        { 'pageRights.grants.page': 'manage' },
        { 'pageRights.grants.page': '*' },
        { 'pageRights.accessRole': 'sudoAdmin' },
        { 'specials.option': 'isAdmin' }
      ]
    }).select('fullName username email department deptId specials pageRights createdAt').lean();

    const result = [];
    const seenTeacherIds = new Set();

    for (const t of teachers) {
      const isSudoUser = t.pageRights?.accessRole === 'sudoAdmin' || (Array.isArray(t.specials) && t.specials.some(s => s && s.option === 'isAdmin'));
      const grants = (Array.isArray(t.pageRights?.grants) ? t.pageRights.grants : []).filter(g => g && g.enabled !== false && (g.page === 'manage' || g.page === '*'));

      if (grants.length > 0) {
        for (const g of grants) {
          let perms = [];
          if (Array.isArray(g.allowedTabs) && g.allowedTabs.length && !g.allowedTabs.includes('*')) {
            perms = g.allowedTabs;
          } else if (g.module && g.module !== '*') {
            perms = parseAllowedTabs('manage', g.module);
          } else {
            perms = ['calendar', 'exam', 'attendance', 'settings'];
          }

          result.push({
            _id: String(g._id || t._id),
            grantId: String(g._id || ''),
            teacherId: String(t._id),
            name: t.fullName,
            username: t.username,
            email: t.email || '',
            department: t.department || '',
            type: 'teacher',
            active: g.enabled !== false,
            isFullAdmin: isSudoUser,
            permissions: perms,
            addedBy: g.grantedBy?.name || (isSudoUser ? 'System' : 'Administrator'),
            grantedAt: g.grantedAt || t.createdAt || new Date()
          });
          seenTeacherIds.add(String(t._id));
        }
      } else if (isSudoUser && !seenTeacherIds.has(String(t._id))) {
        result.push({
          _id: String(t._id),
          grantId: '',
          teacherId: String(t._id),
          name: t.fullName,
          username: t.username,
          email: t.email || '',
          department: t.department || '',
          type: 'teacher',
          active: true,
          isFullAdmin: true,
          permissions: ['calendar', 'exam', 'attendance', 'settings'],
          addedBy: 'Super Administrator',
          grantedAt: t.createdAt || new Date()
        });
        seenTeacherIds.add(String(t._id));
      }
    }

    res.json(result);
  } catch (err) {
    console.error('[GET /api/manage-admins error]:', err);
    res.status(500).json({ error: 'Failed to fetch manage portal admins', details: err.message });
  }
});

/**
 * POST /api/manage-admins
 * Grant Manage portal access to a teacher
 */
router.post('/', authMiddleware, requirePage('manage', 'edit', { tab: 'settings' }), async (req, res) => {
  try {
    const { teacherId, permissions } = req.body;
    const tId = sanitizeToObjectId(teacherId);
    if (!tId) {
      return res.status(400).json({ error: 'Faculty member ID is required' });
    }

    const teacher = await M.Teacher.findById(tId);
    if (!teacher) {
      return res.status(404).json({ error: 'Faculty member not found' });
    }

    const selectedPerms = Array.isArray(permissions) && permissions.length > 0
      ? permissions.filter(p => ['calendar', 'exam', 'attendance', 'settings'].includes(p))
      : ['calendar', 'exam', 'attendance', 'settings'];

    const grantId = new mongoose.Types.ObjectId();
    const isAll = selectedPerms.length === 4;
    const moduleRule = isAll ? '*' : selectedPerms.join(',');

    const isCallerSudo = isSudo(req);

    const newGrant = {
      _id: grantId,
      page: 'manage',
      module: moduleRule,
      scope: isCallerSudo ? 'institution' : 'department',
      deptId: teacher.deptId || null,
      dept: teacher.department || '',
      actions: ['view', 'create', 'edit'],
      allowedTabs: selectedPerms,
      tabActions: selectedPerms.reduce((acc, tab) => {
        acc[tab] = ['view', 'create', 'edit'];
        return acc;
      }, {}),
      enabled: true,
      validFrom: new Date(),
      source: isCallerSudo ? 'sudo' : 'superAdmin',
      grantedBy: {
        trackId: req.user.trackId || String(req.user._id),
        name: req.user.fullName || req.user.name || req.user.username
      },
      grantedAt: new Date()
    };

    let pr = teacher.pageRights || { accessRole: 'none', version: 0, grants: [] };
    if (!Array.isArray(pr.grants)) pr.grants = [];

    // Replace any existing manage portal grant with the updated one
    pr.grants = pr.grants.filter(g => g.page !== 'manage');
    pr.grants.push(newGrant);

    if (pr.accessRole === 'none' || !pr.accessRole) {
      pr.accessRole = 'subAdmin';
    }
    pr.version = (pr.version || 0) + 1;

    teacher.pageRights = { ...pr };
    teacher.markModified('pageRights');
    teacher.accessVersion = (teacher.accessVersion || 0) + 1;
    await teacher.save();

    await logAction(
      req.user.trackId || String(req.user._id),
      req.user.name || req.user.fullName || req.user.username,
      req.user.role || 'admin',
      'Manage Portal Access Granted',
      `Granted Manage portal access to ${teacher.fullName} (${selectedPerms.join(', ')})`,
      'manage',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'manage', subType: 'grant-manage-access', teacherId: teacher._id, grantId }
    );

    res.json({
      ok: true,
      message: 'Manage portal access granted successfully',
      data: { grantId, teacherId: teacher._id }
    });
  } catch (err) {
    console.error('[POST /api/manage-admins error]:', err);
    res.status(500).json({ error: 'Failed to grant manage portal access', details: err.message });
  }
});

/**
 * DELETE /api/manage-admins/:id
 * Revoke Manage portal access from a teacher or grant
 */
router.delete('/:id', authMiddleware, requirePage('manage', 'edit', { tab: 'settings' }), async (req, res) => {
  try {
    const idStr = String(req.params.id);
    let teacher = null;

    if (mongoose.isValidObjectId(idStr)) {
      teacher = await M.Teacher.findOne({
        $or: [
          { _id: idStr },
          { 'pageRights.grants._id': idStr }
        ]
      });
    }

    if (!teacher) {
      teacher = await M.Teacher.findOne({ trackId: idStr });
    }

    if (!teacher) {
      return res.status(404).json({ error: 'Manage portal admin record not found' });
    }

    const isTargetSudo = teacher.pageRights?.accessRole === 'sudoAdmin' || (Array.isArray(teacher.specials) && teacher.specials.some(s => s && s.option === 'isAdmin'));
    if (isTargetSudo) {
      const lastCheck = await assertNotLastSudoAdmin(teacher._id);
      if (!lastCheck.allowed) {
        return res.status(400).json({ error: `Cannot revoke: ${lastCheck.reason || 'Cannot remove last sudo admin'}` });
      }
      if (!isSudo(req)) {
        return res.status(403).json({ error: 'Only Sudo Admin can revoke full administrator privileges' });
      }
    }

    let pr = teacher.pageRights || { accessRole: 'none', version: 0, grants: [] };
    if (!Array.isArray(pr.grants)) pr.grants = [];

    // Remove any grant matching either the grant ID or page 'manage'
    pr.grants = pr.grants.filter(g => String(g._id) !== idStr && g.page !== 'manage');

    const liveGrants = pr.grants.filter(g => g.enabled);
    if (liveGrants.length === 0 && pr.accessRole === 'subAdmin') {
      pr.accessRole = 'none';
    }
    pr.version = (pr.version || 0) + 1;

    teacher.pageRights = { ...pr };
    teacher.markModified('pageRights');
    teacher.accessVersion = (teacher.accessVersion || 0) + 1;
    await teacher.save();

    await logAction(
      req.user.trackId || String(req.user._id),
      req.user.name || req.user.fullName || req.user.username,
      req.user.role || 'admin',
      'Manage Portal Access Revoked',
      `Revoked Manage portal access from ${teacher.fullName}`,
      'manage',
      'info',
      req.ip,
      req.user.sessionId,
      { module: 'manage', subType: 'revoke-manage-access', teacherId: teacher._id }
    );

    res.json({
      ok: true,
      message: `Manage portal access revoked for ${teacher.fullName}`
    });
  } catch (err) {
    console.error('[DELETE /api/manage-admins error]:', err);
    res.status(500).json({ error: 'Failed to revoke manage portal access', details: err.message });
  }
});

module.exports = router;
