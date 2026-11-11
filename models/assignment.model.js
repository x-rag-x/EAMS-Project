const mongoose = require('mongoose');

const AssignmentSchema = new mongoose.Schema({
  trackId:          { type: String, trim: true },
  subjectId:        { type: String, required: true },
  subjectName:      { type: String },
  classId:          { type: String, required: true },
  className:        { type: String },
  teacherId:        { type: String, required: true },
  teacherName:      { type: String },
  hallNo:           { type: String },
  roomId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null },
  periodsPerWeek:   { type: Number, default: 4 },
  isLab:            { type: Boolean, default: false },
  createdBy:        { type: mongoose.Schema.Types.Mixed, default: null },
  updatedBy:        { type: mongoose.Schema.Types.Mixed, default: null },          
  deptName:         { type: String },
  deptCode:         { type: String },
  remarks:          { type: String, default: '', trim: true },
  source:           { type: String, enum: ['timetable', 'manual'], default: 'manual' },
  timetableTrackId: { type: String, default: null }
}, { timestamps: true });

AssignmentSchema.index({ subjectId: 1 });
AssignmentSchema.index({ classId: 1 });
AssignmentSchema.index({ teacherId: 1 });
AssignmentSchema.index({ roomId: 1 });

module.exports = {
  Assignment: mongoose.model('Assignment', AssignmentSchema),
};
