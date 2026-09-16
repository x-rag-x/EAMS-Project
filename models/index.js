const userModels       = require('./user.model');
const departmentModels = require('./department.model');
const classModels      = require('./class.model');
const subjectModels    = require('./subject.model');
const assignmentModels = require('./assignment.model');
const attendanceModels = require('./attendance.model');
const timetableModels  = require('./timetable.model');
const calendarModels   = require('./calendar.model');
const examModels       = require('./exam.model');
const yearModels       = require('./year.model');
const settingsModels   = require('./settings.model');
const systemModels     = require('./system.model');
const leaveModels      = require('./leave.model');
const liveAttModels    = require('./liveSessionAtt.model');
const exportModels     = require('./export.model');

module.exports = {
  ...userModels,
  ...departmentModels,
  ...classModels,
  ...subjectModels,
  ...assignmentModels,
  ...attendanceModels,
  ...timetableModels,
  ...calendarModels,
  ...examModels,
  ...yearModels,
  ...settingsModels,
  ...systemModels,
  ...leaveModels,
  ...liveAttModels,
  ...exportModels,
};
