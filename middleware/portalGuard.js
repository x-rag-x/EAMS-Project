const M = require('../models');
const { getSettings } = require('../utils/settingsCache');
const { isAdminUser } = require('../utils/access');

async function getCachedSettings() {
  try {
    return await getSettings(['pages', 'attendance', 'models', 'academic', 'security']);
  } catch (err) {
    return {};
  }
}

// Verify student portal access permissions
async function checkStudentPortalGuard(req, res, next) {
  if (req.user && isAdminUser(req.user)) return next();
  const settings = await getCachedSettings();
  const pageStudents = settings.pages?.pageStudents ?? 'enabled';
  if (pageStudents === 'disabled' || pageStudents === 'hidden' || pageStudents === false) {
    return res.status(403).json({
      error: 'Students Login are paused temporary.',
      code: 'STUDENTS_LOGIN_PAUSED',
      portalDisabled: true,
      portal: 'student'
    });
  }
  next();
}

// Verify attendance marking permissions
async function checkAttendanceMarkGuard(req, res, next) {
  if (req.user && isAdminUser(req.user)) return next();
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
  if (req.user && isAdminUser(req.user)) return next();
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
    if (req.user && isAdminUser(req.user)) return next();
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

// Verify controller portal access permissions
async function checkControllerPortalGuard(req, res, next) {
  if (req.user && isAdminUser(req.user)) return next();
  const settings = await getCachedSettings();
  const pageController = settings.pages?.pageController ?? 'enabled';
  if (pageController === 'disabled' || pageController === 'hidden' || pageController === false) {
    return res.status(403).json({
      error: 'Controller Portal is currently disabled by administrator.',
      portalDisabled: true,
      portal: 'controller'
    });
  }
  next();
}

// Verify rooms portal access permissions
async function checkRoomsPortalGuard(req, res, next) {
  if (req.user && isAdminUser(req.user)) return next();
  const settings = await getCachedSettings();
  const pageRooms = settings.pages?.pageRooms ?? 'enabled';
  if (pageRooms === 'disabled' || pageRooms === 'hidden' || pageRooms === false) {
    return res.status(403).json({
      error: 'Room & Facilities Portal is currently disabled by administrator.',
      portalDisabled: true,
      portal: 'rooms'
    });
  }
  next();
}

module.exports = {
  checkStudentPortalGuard,
  checkControllerPortalGuard,
  checkRoomsPortalGuard,
  checkAttendanceMarkGuard,
  checkLiveSessionGuard,
  checkModuleGuard,
  getCachedSettings
};
