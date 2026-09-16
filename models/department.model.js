const mongoose = require('mongoose');

const DepartmentSchema = new mongoose.Schema({
  trackId: { type: String, trim: true },
  name:            { type: String, required: true, unique: true, trim: true },
  code:            { type: String, required: true, unique: true, trim: true, uppercase: true },
  number:          { type: String, default: '', trim: true },         // 3-digit register code e.g. "104"
  twoLetterCode:   { type: String, default: '', trim: true, lowercase: true }, // e.g. "cs"
  threeLetterCode: { type: String, default: '', trim: true, uppercase: true }, // e.g. "CSE"
  hodId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  hodName: { type: String, default: '' },
  courseType:   { type: String, enum: ['UG','PG'], default: 'UG' },
  branch:       { type: String, enum: ['M.E','M.TECH','B.E','B.TECH'], default: 'B.E' },
  icon:         { type: String, default: '🏛️', trim: true },
}, { timestamps: true });

DepartmentSchema.pre('save', function () {
  if (!this.threeLetterCode && this.code) {
    this.threeLetterCode = this.code.toUpperCase();
  }
});

module.exports = {
  Department: mongoose.model('Department', DepartmentSchema),
};
