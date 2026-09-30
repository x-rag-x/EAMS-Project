const mongoose = require('mongoose');

const SpecialActivitySchema = new mongoose.Schema({
  trackId:           { type: String, trim: true },
  name:              { type: String, required: true, trim: true },
  shortLabel:        { type: String, required: true, trim: true }, // Short tag rendered in the timetable grid (e.g. 'VERBAL', 'QUANTS')
  category:          { type: String, enum: ['soft-skill', 'value-added', 'combined-elective', 'placement', 'other'], default: 'other' },
  defaultTeacherIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' }],
  deptId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  isActive:          { type: Boolean, default: true },
}, { timestamps: true });

SpecialActivitySchema.index({ deptId: 1 });
SpecialActivitySchema.index({ shortLabel: 1 });
SpecialActivitySchema.index({ name: 1 });

module.exports = {
  SpecialActivity: mongoose.model('SpecialActivity', SpecialActivitySchema),
};
