const mongoose = require('mongoose');

const YearSchema = new mongoose.Schema({
  academicYear : { type: String, required: true, unique: true, trim: true },
  batches: [{
    batchTrackId : { type: String, required: true, trim: true },
    batch        : { type: String, required: true, trim: true },
    currentYear  : { type: String, enum: ['I', 'II', 'III', 'IV'], required: true },
    currentSem   : { type: String, enum: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'], required: true }
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

module.exports = {
  Year: mongoose.model('Year', YearSchema),
};
