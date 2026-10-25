const userModels = require('./user.model');
const departmentModels = require('./department.model');
const classModels = require('./class.model');
const subjectModels = require('./subject.model');
const assignmentModels = require('./assignment.model');
const attendanceModels = require('./attendance.model');
const timetableModels = require('./timetable.model');
const calendarModels = require('./calendar.model');
const examModels = require('./exam.model');
const yearModels = require('./year.model');
const settingsModels = require('./settings.model');
const systemModels = require('./system.model');
const leaveModels = require('./leave.model');
const liveAttModels = require('./liveSessionAtt.model');
const exportModels = require('./export.model');
const specialActivityModels = require('./specialActivity.model');
const actingRoleModels = require('./actingRole.model');
const approvalHistoryModels = require('./approvalHistory.model');
const attendanceEntitlementModels = require('./attendanceEntitlement.model');
const activityEvidenceModels = require('./activityEvidence.model');
const classSessionModels = require('./classSession.model');
const alertModels = require('./alert.model');
const academicEventModels = require('./academicEvent.model');
const odRequestModels = require('./odRequest.model');
const facultyLeavePolicyModels = require('./facultyLeavePolicy.model');
const hostelModels = require('./hostel.model');
const hostelAttendanceModels = require('./hostelAttendance.model');
const hostelLeaveModels = require('./hostelLeave.model');
const movementEventModels = require('./movementEvent.model');
const deviceBindingModels = require('./deviceBinding.model');
const securityBlockModels = require('./securityBlock.model');
const passwordModels = require('./password.model');
const loginSessionModels = require('./loginSession.model');
const roleAssignmentModels = require('./roleAssignment.model');
const accessRequestModels = require('./accessRequest.model');
const studentDeviceModels = require('./studentDevice.model');
const deviceRegistrationTicketModels = require('./deviceRegistrationTicket.model');
const registrationWindowModels = require('./registrationWindow.model');
const trustEventModels = require('./trustEvent.model');
const deviceReplacementRequestModels = require('./deviceReplacementRequest.model');
const trustDisputeModels = require('./trustDispute.model');
const attendanceAdjustmentModels = require('./attendanceAdjustment.model');
const deviceShareCaseModels = require('./deviceShareCase.model');
const bulkImportBatchModels = require('./bulkImportBatch.model');
const bulkChatSnapshotModels = require('./bulkChatSnapshot.model');

module.exports = {
  ...bulkImportBatchModels,
  ...bulkChatSnapshotModels,
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
  ...specialActivityModels,
  ...actingRoleModels,
  ...approvalHistoryModels,
  ...attendanceEntitlementModels,
  ...activityEvidenceModels,
  ...classSessionModels,
  ...alertModels,
  ...academicEventModels,
  ...odRequestModels,
  ...facultyLeavePolicyModels,
  ...hostelModels,
  ...hostelAttendanceModels,
  ...hostelLeaveModels,
  ...movementEventModels,
  ...deviceBindingModels,
  ...securityBlockModels,
  ...passwordModels,
  ...loginSessionModels,
  ...roleAssignmentModels,
  ...accessRequestModels,
  ...studentDeviceModels,
  ...deviceRegistrationTicketModels,
  ...registrationWindowModels,
  ...trustEventModels,
  ...deviceReplacementRequestModels,
  ...trustDisputeModels,
  ...attendanceAdjustmentModels,
  ...deviceShareCaseModels,
};
