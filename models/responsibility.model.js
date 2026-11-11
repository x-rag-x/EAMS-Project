const mongoose = require('mongoose');

const ResponsibilitySchema = new mongoose.Schema({
  trackId:              { type: String, required: true, unique: true },
  name:                 { type: String, required: true, trim: true },
  scope:                { type: String, enum: ['department', 'institute'], default: 'institute' },
  workloadPeriodsPerWeek: { type: Number, required: true, min: 0 },
  deptId:               { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  deptName:             { type: String, default: '' },
  assignedTeachers:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' }],
  createdBy:            { type: String, default: '' },
}, { timestamps: true });

ResponsibilitySchema.index({ scope: 1 });
ResponsibilitySchema.index({ deptId: 1 });
ResponsibilitySchema.index({ assignedTeachers: 1 });

module.exports = {
  Responsibility: mongoose.model('Responsibility', ResponsibilitySchema),
};
