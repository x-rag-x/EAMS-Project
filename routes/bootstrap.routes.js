const express = require('express');
const router = express.Router();
const M = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { logAction } = require('../utils/logAction');

/**
 * Middleware enforcing Sudo Admin and active bootstrapPending state (§9, R3.2)
 */
function requireBootstrapSudo(req, res, next) {
  if (!req.user || !req.user.isSudoAdmin) {
    return res.status(403).json({
      error: 'Only Sudo Admin can perform initial system bootstrap.',
      code: 'FORBIDDEN'
    });
  }

  if (!req.user.bootstrapPending) {
    return res.status(400).json({
      error: 'System bootstrap has already been completed.',
      code: 'BOOTSTRAP_ALREADY_COMPLETED'
    });
  }

  next();
}

/**
 * POST /api/bootstrap/department
 * Step 2 of Sudo Bootstrap: Create initial department and associate with Sudo Admin
 */
router.post('/department', authMiddleware, requireBootstrapSudo, async (req, res) => {
  try {
    const { name, code, number, courseType, branch, icon } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Department name is required', code: 'INVALID_NAME' });
    }
    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'Department code is required', code: 'INVALID_CODE' });
    }

    const trimmedName = name.trim();
    const upperCode = code.trim().toUpperCase();

    // Check uniqueness
    const existing = await M.Department.findOne({
      $or: [{ code: upperCode }, { name: trimmedName }]
    }).lean();

    if (existing) {
      return res.status(400).json({
        error: existing.code === upperCode
          ? `Department code "${upperCode}" is already in use.`
          : `Department "${trimmedName}" already exists.`,
        code: 'DUPLICATE_DEPARTMENT'
      });
    }

    const trackId = `DP-${upperCode}001`;
    const dept = await M.Department.create({
      name: trimmedName,
      code: upperCode,
      threeLetterCode: upperCode,
      number: (number || '').trim(),
      courseType: ['UG', 'PG'].includes(courseType) ? courseType : 'UG',
      branch: ['M.E', 'M.TECH', 'B.E', 'B.TECH'].includes(branch) ? branch : 'B.E',
      icon: (icon || 'building2').trim(),
      trackId
    });

    // Associate initial department with the current Sudo Teacher
    const teacherId = req.user.roleId || req.user._id;
    await M.Teacher.updateOne(
      { $or: [{ _id: teacherId }, { username: req.user.username }] },
      {
        $set: {
          department: dept.name,
          deptId: dept._id,
          deptCode: dept.code
        }
      }
    );

    await logAction(
      req.user.trackId || req.user._id,
      req.user.name || req.user.username,
      req.user.role || 'teacher',
      'Bootstrap Department Created',
      `Initial department ${dept.name} (${dept.code}) created during system bootstrap`,
      'data',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'bootstrap',
        departmentId: dept._id,
        actingWithAdminRights: true
      }
    );

    return res.status(201).json({
      ok: true,
      message: `Department ${dept.name} created successfully.`,
      department: dept
    });
  } catch (err) {
    console.error('[Bootstrap Department Error]:', err);
    return res.status(500).json({ error: 'Failed to configure bootstrap department', details: err.message });
  }
});

/**
 * POST /api/bootstrap/profile
 * Step 3 of Sudo Bootstrap: Configure personal details and complete bootstrap
 */
router.post('/profile', authMiddleware, requireBootstrapSudo, async (req, res) => {
  try {
    const { fullName, firstName, lastName, employeeNo, designation, email } = req.body;

    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      return res.status(400).json({ error: 'Valid full name is required', code: 'INVALID_NAME' });
    }

    const trimmedFullName = fullName.trim();
    const fName = (firstName || trimmedFullName.split(' ')[0] || '').trim();
    const lName = (lastName !== undefined ? lastName : trimmedFullName.slice(fName.length).trim()) || null;
    const empNo = (employeeNo || '').trim();
    const desig = (designation || 'System Administrator').trim();
    const emailAddr = (email || '').toLowerCase().trim();

    const teacherId = req.user.roleId || req.user._id;

    // Update Sudo Teacher and clear bootstrapPending
    await M.Teacher.updateOne(
      { $or: [{ _id: teacherId }, { username: req.user.username }] },
      {
        $set: {
          fullName: trimmedFullName,
          firstName: fName,
          lastName: lName,
          employeeNo: empNo,
          designation: desig,
          email: emailAddr,
          bootstrapPending: false
        }
      }
    );

    // Update shadow User record
    await M.User.updateOne(
      { username: req.user.username },
      {
        $set: {
          bootstrapPending: false
        }
      }
    );

    await logAction(
      req.user.trackId || req.user._id,
      trimmedFullName,
      req.user.role || 'teacher',
      'Bootstrap Profile Completed',
      `Sudo Admin profile configured for "${trimmedFullName}". System bootstrap completed.`,
      'system',
      'info',
      req.ip,
      req.user.sessionId,
      {
        module: 'admin',
        subType: 'bootstrap',
        completed: true,
        actingWithAdminRights: true
      }
    );

    return res.json({
      ok: true,
      message: 'System bootstrap completed successfully. Please sign in to proceed.',
      completed: true
    });
  } catch (err) {
    console.error('[Bootstrap Profile Error]:', err);
    return res.status(500).json({ error: 'Failed to configure bootstrap profile', details: err.message });
  }
});

module.exports = router;
