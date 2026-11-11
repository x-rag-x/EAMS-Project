'use strict';

const mongoose = require('mongoose');

const TRACKED_COUNT_FIELDS = [
  'departments',
  'students',
  'teachers',
  'activeTeachers',
  'subjects',
  'classes',
  'attendanceRecords',
];

const AggregatedCountSchema = new mongoose.Schema({
  key: {
    type: String,
    required: [true, 'Singleton key is required'],
    unique: true,
    default: 'global',
    trim: true,
    immutable: true,
  },
  departments: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'departments count cannot be negative'],
    validate: {
      validator: Number.isInteger,
      message: '{VALUE} is not an integer count for departments',
    },
  },
  students: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'students count cannot be negative'],
    validate: {
      validator: Number.isInteger,
      message: '{VALUE} is not an integer count for students',
    },
  },
  teachers: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'teachers count cannot be negative'],
    validate: {
      validator: Number.isInteger,
      message: '{VALUE} is not an integer count for teachers',
    },
  },
  activeTeachers: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'activeTeachers count cannot be negative'],
    validate: {
      validator: Number.isInteger,
      message: '{VALUE} is not an integer count for activeTeachers',
    },
  },
  subjects: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'subjects count cannot be negative'],
    validate: {
      validator: Number.isInteger,
      message: '{VALUE} is not an integer count for subjects',
    },
  },
  classes: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'classes count cannot be negative'],
    validate: {
      validator: Number.isInteger,
      message: '{VALUE} is not an integer count for classes',
    },
  },
  attendanceRecords: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'attendanceRecords count cannot be negative'],
    validate: {
      validator: Number.isInteger,
      message: '{VALUE} is not an integer count for attendanceRecords',
    },
  },
  lastRecalculatedAt: {
    type: Date,
    default: Date.now,
  },
  lastRecalculatedBy: {
    type: String,
    default: 'system',
    trim: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({}),
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Explicit unique index on singleton key for fast O(1) lookup
// key unique index declared on field definition above

// Virtual to access entity counts as a clean dictionary
AggregatedCountSchema.virtual('counts').get(function () {
  return {
    departments: this.departments ?? 0,
    students: this.students ?? 0,
    teachers: this.teachers ?? 0,
    activeTeachers: this.activeTeachers ?? 0,
    subjects: this.subjects ?? 0,
    classes: this.classes ?? 0,
    attendanceRecords: this.attendanceRecords ?? 0,
  };
});

// Instance method to format clean count response
AggregatedCountSchema.methods.toCountsObject = function () {
  return {
    departments: this.departments ?? 0,
    students: this.students ?? 0,
    teachers: this.teachers ?? 0,
    activeTeachers: this.activeTeachers ?? 0,
    subjects: this.subjects ?? 0,
    classes: this.classes ?? 0,
    attendanceRecords: this.attendanceRecords ?? 0,
    lastRecalculatedAt: this.lastRecalculatedAt ?? null,
  };
};

// Pre-save sanity clamp: guarantees values never persist as negative or non-integer
AggregatedCountSchema.pre('save', function () {
  for (const field of TRACKED_COUNT_FIELDS) {
    if (typeof this[field] === 'number') {
      if (this[field] < 0 || isNaN(this[field])) {
        this[field] = 0;
      } else {
        this[field] = Math.floor(this[field]);
      }
    } else if (this[field] === undefined || this[field] === null) {
      this[field] = 0;
    }
  }
});

const AggregatedCount = mongoose.model('AggregatedCount', AggregatedCountSchema);
AggregatedCount.TRACKED_FIELDS = TRACKED_COUNT_FIELDS;
AggregatedCount.SINGLETON_KEY = 'global';

module.exports = {
  AggregatedCount,
};
