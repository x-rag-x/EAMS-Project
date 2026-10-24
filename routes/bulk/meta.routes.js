const express = require('express');
const router = express.Router();
const M = require('../../models');
const { authMiddleware, requirePage } = require('../../middleware/auth');
const { isSudoCaller } = require('../../services/bulk/access');
const { normalizeYearRange } = require('../../utils/yearFormat');

/**
 * GET /api/bulk/capabilities
 * Returns type enablement, prerequisites, and setup checklist
 */
router.get('/capabilities', authMiddleware, async (req, res) => {
  try {
    const isSudo = isSudoCaller(req.user);
    const userRole = req.user.role;
    const bulkPage = req.access?.pages?.bulk || req.user?.pages?.bulk;
    const rawRights = req.user?.pageRights;
    const hasPageGrant = Array.isArray(rawRights) && rawRights.some(r => {
      if (typeof r === 'string') return r === 'bulk';
      if (r && typeof r === 'object') return r.page === 'bulk' && (!r.actions || r.actions.includes('create') || r.actions.includes('view'));
      return false;
    });
    const canBulk = isSudo || userRole === 'admin' || (bulkPage?.actions || []).includes('create') || hasPageGrant;
    const tabOk = (t) => isSudo || !bulkPage?.allowedTabs || bulkPage.allowedTabs.length === 0 || bulkPage.allowedTabs.includes(t);

    const [deptCount, teacherCount, classCount, subjectCount, studentCount, activeYearDoc] = await Promise.all([
      M.Department.countDocuments({}),
      M.Teacher.countDocuments({}),
      M.Class.countDocuments({}),
      M.Subject.countDocuments({}),
      M.Student.countDocuments({}),
      M.Year.findOne({ isCurrent: true }).lean()
    ]);

    const hasActiveBatches = Boolean(activeYearDoc && Array.isArray(activeYearDoc.batches) && activeYearDoc.batches.length > 0);

    const setup = {
      dept:    deptCount > 0,
      teacher: teacherCount > 0,
      class:   classCount > 0,
      subject: subjectCount > 0,
      student: studentCount > 0
    };

    const types = {};

    // 1. Departments: global scope only (sudo / super)
    if (!canBulk || !tabOk('dept')) {
      types.dept = { enabled: false, reason: 'You do not have bulk upload access permission for departments' };
    } else if (!isSudo) {
      types.dept = { enabled: false, reason: 'Department creation requires global administrator privileges' };
    } else {
      types.dept = { enabled: true, reason: '' };
    }

    // 2. Teachers: >= 1 department in scope
    if (!canBulk || !tabOk('teacher')) {
      types.teacher = { enabled: false, reason: 'You do not have bulk upload access permission for teachers' };
    } else if (deptCount === 0) {
      types.teacher = { enabled: false, reason: 'Add departments first before importing teachers' };
    } else {
      types.teacher = { enabled: true, reason: '' };
    }

    // 3. Classes: >= 1 department and active batches in current Academic Year
    if (!canBulk || !tabOk('class')) {
      types.class = { enabled: false, reason: 'You do not have bulk upload access permission for classes' };
    } else if (deptCount === 0) {
      types.class = { enabled: false, reason: 'Add departments first before importing classes' };
    } else if (!hasActiveBatches) {
      types.class = { enabled: false, reason: 'No active batch — set up the current Academic Year in Settings first' };
    } else {
      types.class = { enabled: true, reason: '' };
    }

    // 4. Subjects: >= 1 department
    if (!canBulk || !tabOk('subject')) {
      types.subject = { enabled: false, reason: 'You do not have bulk upload access permission for subjects' };
    } else if (deptCount === 0) {
      types.subject = { enabled: false, reason: 'Add departments first before importing subjects' };
    } else {
      types.subject = { enabled: true, reason: '' };
    }

    // 5. Students: >= 1 department, >= 1 class, active batch
    if (!canBulk || !tabOk('student')) {
      types.student = { enabled: false, reason: 'You do not have bulk upload access permission for students' };
    } else if (deptCount === 0) {
      types.student = { enabled: false, reason: 'Add departments first before importing students' };
    } else if (!hasActiveBatches) {
      types.student = { enabled: false, reason: 'No active academic year batches found' };
    } else if (classCount === 0) {
      types.student = { enabled: false, reason: 'Add classes first before importing students' };
    } else {
      types.student = { enabled: true, reason: '' };
    }

    const payload = {
      isSudo,
      user: {
        _id: req.user._id,
        name: req.user.name || req.user.username,
        role: req.user.role,
        deptId: req.user.deptId || null
      },
      setup,
      capabilities: types,
      types: types
    };

    res.json({
      ok: true,
      data: payload,
      ...payload
    });
  } catch (err) {
    console.error('[BulkCapabilities Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

const { schemas } = require('../../services/bulk/schema');

/**
 * GET /api/bulk/schema
 * Returns column reference and validation schema for all 5 data types
 */
router.get('/schema', authMiddleware, requirePage('bulk', 'view'), (req, res) => {
  const result = {};
  for (const [key, def] of Object.entries(schemas)) {
    result[key] = {
      type: def.type,
      label: def.label,
      columns: def.columns.map(c => ({
        key: c.key,
        label: c.label,
        required: Boolean(c.required),
        aliases: c.aliases || [],
        example: c.example || '',
        help: c.help || ''
      }))
    };
  }
  const payload = Object.assign({ schemas: result }, result);
  res.json({ ok: true, data: payload, schemas: result });
});

module.exports = router;
