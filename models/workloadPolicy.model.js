const mongoose = require('mongoose');

const DesignationRuleSchema = new mongoose.Schema({
  designation: { type: String, required: true, trim: true },
  minPerWeek:  { type: Number, default: 18, min: 0 },
  maxPerWeek:  { type: Number, default: 24, min: 0 },
  maxPerDay:   { type: Number, default: 5, min: 0 },
  maxInRow:    { type: Number, default: 3, min: 0 },
  floorLoad:   { type: Number, default: 10, min: 0 },
}, { _id: false });

const WorkloadPolicySchema = new mongoose.Schema({
  deptId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  deptName:         { type: String, default: '' },
  designationRules: [DesignationRuleSchema],
  updatedBy:        { type: String, default: '' },
}, { timestamps: true });

WorkloadPolicySchema.index({ deptId: 1 }, { unique: true });

module.exports = {
  WorkloadPolicy: mongoose.model('WorkloadPolicy', WorkloadPolicySchema),
};
