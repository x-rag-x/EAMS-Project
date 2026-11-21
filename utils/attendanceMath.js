/**
 * utils/attendanceMath.js
 * 
 * Attendance Mathematics & Analytics Utility
 * Re-exports normalized functions from utils/attendanceCalc.js (Resolves Checklist B33).
 */

'use strict';

const {
  calculateAttendancePct,
  calculateDefaulterBand,
  calculateClassesNeeded
} = require('./attendanceCalc');

module.exports = {
  calculateAttendancePct,
  calculateDefaulterBand,
  calculateClassesNeeded
};
