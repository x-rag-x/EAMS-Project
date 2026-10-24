const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware, requirePage, scopeFilter, assertInScope } = require('../middleware/auth');
const { isSudo } = require('../utils/access');
const { logAction } = require('../utils/logAction');
const { sanitizeToString } = require('../utils/sanitizeQuery');

/**
 * Access guard for subjects:
 * Allows:
 *  1. Sudo Admins (institution scope)
 *  2. Users with admin page rights for the given action on tab 'struct'
 *  3. Timetable Coordinators, HODs, or users with timetable page rights
 */
function requireSubjectAccess(action = 'view') {
  const adminGuard = requirePage('admin', action, { tab: 'struct' });

  return async function subjectAccessGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required.' });
    }

    // 1. Sudo Admin has unconditional institution-wide authority
    if (isSudo(req)) {
      req.scope = { type: 'institution', deptId: null, deptName: null };
      return next();
    }

    // 2. Check Admin Structure rights first
    let adminPassed = false;
    await new Promise(resolve => {
      adminGuard(req, {
        status: () => ({ json: () => resolve() })
      }, () => {
        adminPassed = true;
        resolve();
      });
    });

    if (adminPassed) {
      return next();
    }

    // 3. Check Timetable Coordinator / HOD / Timetable Page rights
    const u = req.user;
    const access = req.access || {};
    const specialsList = Array.isArray(u.specials) ? u.specials : [];

    const isTtCoord = Boolean(
      u.isTimeTableCoordinator === true ||
      access.isTimeTableCoordinator === true ||
      access.flags?.isTimeTableCoordinator === true ||
      specialsList.some(s => s && s.option === 'isTimeTableCoordinator' && s.value !== false && s.value !== 'false')
    );

    const isHod = Boolean(
      u.isHod === true ||
      access.isHod === true ||
      access.flags?.isHod === true ||
      specialsList.some(s => s && s.option === 'isHod' && s.value !== false && s.value !== 'false')
    );

    const ttGrant = access.pages?.timetable;
    const hasTtPage = Boolean(
      ttGrant &&
      (Array.isArray(ttGrant.actions) ? (ttGrant.actions.includes('*') || ttGrant.actions.includes(action)) : true)
    );

    if (isTtCoord || isHod || hasTtPage) {
      let userDeptId = ttGrant?.deptId || u.deptId || u.departmentId || null;
      let userDeptName = ttGrant?.dept || u.department || u.deptName || u.TTdeptName || null;

      // If userDeptId is missing but userDeptName is available, resolve deptId from Department
      if (!userDeptId && userDeptName) {
        try {
          const dDoc = await M.Department.findOne({
            $or: [
              { name: new RegExp(`^${userDeptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
              { code: new RegExp(`^${userDeptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
            ]
          }).select('_id name code').lean();
          if (dDoc) {
            userDeptId = dDoc._id;
            userDeptName = dDoc.name;
          }
        } catch (_) {}
      }

      const isInstitutionScope = ttGrant?.scope === 'institution';
      req.scope = {
        type: isInstitutionScope ? 'institution' : 'department',
        deptId: isInstitutionScope ? null : userDeptId,
        deptName: isInstitutionScope ? null : userDeptName
      };

      return next();
    }

    return res.status(403).json({
      error: 'Access denied: insufficient page rights',
      details: 'Requires Admin Structure rights or Timetable Coordinator rights',
      page: 'timetable',
      action,
      tab: 'subjects'
    });
  };
}

router.get('/', authMiddleware, async (req, res) => {
  const filter = {};
  if (req.query.deptId) filter.deptId = sanitizeToString(req.query.deptId);
  if (req.query.regulation) filter.regulation = sanitizeToString(req.query.regulation);
  res.json(await M.Subject.find(filter).sort({ name: 1 }));
});

router.post('/', authMiddleware, requireSubjectAccess('create'), async (req, res) => {
  try {
    if (req.scope && req.scope.type === 'department') {
      if (req.scope.deptId) {
        req.body.deptId = req.scope.deptId;
      } else if (req.body.deptId) {
        if (!assertInScope(req, req.body.deptId)) {
          return res.status(403).json({ error: 'Access denied: department is outside your authorized scope' });
        }
      }
    }
    const name = (req.body.name || '').trim();
    const cCode = (req.body.courseCode || req.body.code || '').trim().toUpperCase();
    const sForm = (req.body.shortForm || req.body.shortName || '').trim().toUpperCase();
    if (!name || !cCode || !sForm) {
      return res.status(400).json({ error: 'Subject Name, Course Code, and Subject Short Form are required' });
    }
    const subjectCode = `${cCode}-${sForm}`;

    // Case-insensitive uniqueness check
    const existing = await M.Subject.findOne({
      subjectCode: { $regex: new RegExp(`^${subjectCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });
    if (existing) {
      return res.status(400).json({
        error: `Subject Code "${subjectCode}" already exists (${existing.name}). Please use a different Course Code or Short Form.`
      });
    }

    req.body.name = name;
    req.body.courseCode = cCode;
    req.body.code = cCode;
    req.body.shortForm = sForm;
    req.body.shortName = sForm;
    req.body.subjectCode = subjectCode;

    if (req.body.deptId && (!req.body.deptName || !req.body.deptCode)) {
      try {
        const dObj = await M.Department.findById(req.body.deptId).select('name code').lean();
        if (dObj) {
          if (!req.body.deptName) req.body.deptName = dObj.name;
          if (!req.body.deptCode) req.body.deptCode = dObj.code;
        }
      } catch (_) {}
    }

    const subj = await M.Subject.create(req.body);
    const logModule = req.access?.pages?.timetable && !req.access?.pages?.admin ? 'timetable' : 'admin';
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Subject Added',
      `${subj.name} (${subj.courseCode || subj.code})`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: logModule,
        subType: 'entry-create',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights || Boolean(req.access?.pages?.timetable),
        changes: { before: null, after: subj.toObject ? subj.toObject() : subj }
      }
    );
    res.status(201).json(subj);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        error: `Subject Code "${req.body.subjectCode || 'entered'}" is already registered. Please choose another.`
      });
    }
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', authMiddleware, requireSubjectAccess('edit'), async (req, res) => {
  try {
    const before = await M.Subject.findById(req.params.id).lean();
    if (!before) {
      return res.status(404).json({ error: 'Subject not found' });
    }
    if (!assertInScope(req, before.deptId)) {
      return res.status(403).json({ error: 'Access denied: subject is outside your department scope' });
    }
    if (req.body.deptId) {
      if (String(req.body.deptId) !== String(before.deptId) && !assertInScope(req, req.body.deptId)) {
        return res.status(403).json({ error: 'Access denied: target department is outside your authorized scope' });
      }
      if (!req.body.deptName || !req.body.deptCode) {
        try {
          const dObj = await M.Department.findById(req.body.deptId).select('name code').lean();
          if (dObj) {
            if (!req.body.deptName) req.body.deptName = dObj.name;
            if (!req.body.deptCode) req.body.deptCode = dObj.code;
          }
        } catch (_) {}
      }
    }
    const cCode = (req.body.courseCode || req.body.code || (before ? before.courseCode : '') || '').trim().toUpperCase();
    const sForm = (req.body.shortForm !== undefined ? req.body.shortForm : (req.body.shortName !== undefined ? req.body.shortName : (before ? (before.shortForm || before.shortName) : '')) || '').trim().toUpperCase();
    if (req.body.shortForm !== undefined && !sForm) {
      return res.status(400).json({ error: 'Subject Short Form cannot be empty' });
    }
    if (cCode) {
      req.body.courseCode = cCode;
      req.body.code = cCode;
    }
    if (sForm) {
      req.body.shortForm = sForm;
      req.body.shortName = sForm;
    }
    if (cCode && sForm) {
      const targetSubjectCode = `${cCode}-${sForm}`;
      req.body.subjectCode = targetSubjectCode;

      // Case-insensitive uniqueness check excluding current subject
      const existing = await M.Subject.findOne({
        _id: { $ne: req.params.id },
        subjectCode: { $regex: new RegExp(`^${targetSubjectCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      });
      if (existing) {
        return res.status(400).json({
          error: `Subject Code "${targetSubjectCode}" already exists (${existing.name}). Please use a different Course Code or Short Form.`
        });
      }
    }
    const subj = await M.Subject.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' }).lean();
    const logModule = req.access?.pages?.timetable && !req.access?.pages?.admin ? 'timetable' : 'admin';
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Subject Updated',
      subj?.name || '',
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: logModule,
        subType: 'field-edit',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights || Boolean(req.access?.pages?.timetable),
        changes: { before, after: subj }
      }
    );
    res.json(subj);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        error: `Subject Code "${req.body.subjectCode || 'entered'}" is already registered. Please choose another.`
      });
    }
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authMiddleware, requireSubjectAccess('delete'), async (req, res) => {
  try {
    const subj = await M.Subject.findById(req.params.id).lean();
    if (subj) {
      if (!assertInScope(req, subj.deptId)) {
        return res.status(403).json({ error: 'Access denied: subject is outside your department scope' });
      }
      await M.UndoLog.create({
        collectionName: 'subjects', label: `Subject: ${subj.name} (${subj.code || ''})`,
        snapshot: subj, deletedBy: req.user.name, expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      });
      await M.Subject.findByIdAndDelete(req.params.id);
    }
    const logModule = req.access?.pages?.timetable && !req.access?.pages?.admin ? 'timetable' : 'admin';
    await logAction(
      req.user.trackId || req.user._id,
      req.user.name,
      req.user.role,
      'Subject Deleted',
      subj?.name || '',
      'data',
      'warning',
      req.ip,
      req.user.sessionId,
      {
        module: logModule,
        subType: 'entry-delete',
        trackId: req.user.trackId,
        actingWithAdminRights: req.user.actingWithAdminRights || Boolean(req.access?.pages?.timetable),
        changes: { before: subj, after: null }
      }
    );
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;