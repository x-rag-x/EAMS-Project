const mongoose = require('mongoose');

const AssignmentSchema = new mongoose.Schema({
  trackId: { type: String, trim: true },
  subjectId:   { type: String, required: true },
  subjectName: { type: String },
  classId:     { type: String, required: true },
  className:   { type: String },
  teacherId:   { type: String, required: true },
  teacherName: { type: String },
  hallNo:      { type: String },          
  deptName:    { type: String },
  deptCode:    { type: String }
}, { timestamps: true });

AssignmentSchema.index({ subjectId: 1 });
AssignmentSchema.index({ classId: 1 });
AssignmentSchema.index({ teacherId: 1 });

module.exports = {
  Assignment: mongoose.model('Assignment', AssignmentSchema),
};
