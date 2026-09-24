const M = require('../models');
const { getSettings } = require('../utils/settingsCache');

async function getCachedSettings() {
  try {
    return await getSettings(['pages', 'attendance', 'models', 'academic', 'security']);
  } catch (err) {
    return {};
  }
}

// Verify student portal access permissions
async function checkStudentPortalGuard(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  const settings = await getCachedSettings();
  const pageStudents = settings.pages?.pageStudents ?? 'enabled';
  if (pageStudents === 'disabled' || pageStudents === 'hidden' || pageStudents === false) {
    return res.status(403).json({
      error: 'Student Portal is currently disabled by administrator.',
      portalDisabled: true,
      portal: 'student'
    });
  }
  next();
}

// Verify attendance marking permissions
async function checkAttendanceMarkGuard(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  const settings = await getCachedSettings();
  const markAttendance = settings.attendance?.markAttendance ?? true;
  if (markAttendance === false) {
    return res.status(403).json({
      error: 'Attendance marking is currently locked by administrator.',
      featureDisabled: true
    });
  }
  next();
}

// Verify live session feature availability
async function checkLiveSessionGuard(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  const settings = await getCachedSettings();
  const markAttendance = settings.attendance?.markAttendance ?? true;
  const liveSessions = settings.attendance?.liveSessions ?? true;
  if (markAttendance === false || liveSessions === false) {
    return res.status(403).json({
      error: 'Live Attendance Sessions are currently disabled by administrator.',
      featureDisabled: true
    });
  }
  next();
}

// Verify generic module enablement status
function checkModuleGuard(moduleKey, moduleName) {
  return async function (req, res, next) {
    if (req.user && req.user.role === 'admin') return next();
    const settings = await getCachedSettings();
    const isEnabled = settings.models?.[moduleKey] ?? true;
    if (isEnabled === false) {
      return res.status(403).json({
        error: `${moduleName} module is currently disabled by administrator.`,
        moduleDisabled: true
      });
    }
    next();
  };
}

module.exports = {
  checkStudentPortalGuard,
  checkAttendanceMarkGuard,
  checkLiveSessionGuard,
  checkModuleGuard,
  getCachedSettings
};
