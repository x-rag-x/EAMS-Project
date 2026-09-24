const { getSetting } = require('../utils/settingsCache');

// Check active maintenance mode and restrict access for affected user roles
async function checkMaintenance(req, res, next) {
  if (req.user?.role === 'admin' || (req.user?.role === 'teacher' && req.user?.isAdmin)) {
    return next();
  }
  const v = await getSetting('maintenance');
  if (v?.active) {
    const affected = v.affectedRoles?.length ? v.affectedRoles : ['teacher', 'student'];
    if (affected.includes(req.user?.role)) {
      return res.status(503).json({
        error: v.message || 'System is under maintenance.',
        maintenance: true,
        message: v.message || 'System is under maintenance.',
        affectedRoles: affected,
        endTime: v.endTime || null,
        startedAt: v.startedAt || null,
      });
    }
  }
  next();
}

module.exports = { checkMaintenance };