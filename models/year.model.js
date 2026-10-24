const mongoose = require('mongoose');
const { normalizeYearRange, toBatchTrackId } = require('../utils/yearFormat');

const YearSchema = new mongoose.Schema({
  academicYear : { type: String, required: true, unique: true, trim: true, set: v => normalizeYearRange(v) },
  batches: [{
    batchTrackId : { type: String, required: true, trim: true },
    batch        : { type: String, required: true, trim: true, set: v => normalizeYearRange(v) },
    currentYear  : { type: String, enum: ['I', 'II', 'III', 'IV'], required: true },
    currentSem   : { type: String, enum: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'], required: true },
    regulation   : { type: String, trim: true, default: '' }
  }],
  regulations: [{
    code          : { type: String, required: true, trim: true },
    name          : { type: String, default: '', trim: true },
    year          : { type: String, trim: true },
    isDefault     : { type: Boolean, default: false },
    minAttendance : { type: Number, default: 75 }
  }],
  semesterDates: [{
    year         : { type: String, enum: ['I', 'II', 'III', 'IV'], required: true },
    semester     : { type: String, enum: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'], required: true },
    startDate    : { type: Date, default: null },
    endDate      : { type: Date, default: null }
  }],
  createdBy    : { type: String, default: '' },
  createdAt    : { type: Date, default: Date.now },
  history: [{
    field        : { type: String, default: '' },
    oldValue     : { type: String, default: '' },
    newValue     : { type: String, default: '' },
    updatedBy    : { type: String, default: '' },
    updatedAt    : { type: Date, default: null }
  }],
  isCurrent    : { type: Boolean, default: false }
});

YearSchema.pre('save', function (next) {
  if (this.academicYear) this.academicYear = normalizeYearRange(this.academicYear);
  if (Array.isArray(this.batches)) {
    this.batches.forEach(b => {
      if (b && b.batch) {
        b.batch = normalizeYearRange(b.batch);
        if (!b.batchTrackId) b.batchTrackId = toBatchTrackId(b.batch);
      }
    });
  }
  if (typeof next === 'function') next();
});

module.exports = {
  Year: mongoose.model('Year', YearSchema),
};
