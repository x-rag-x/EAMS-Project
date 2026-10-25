const { normalizeYearRange, isValidYearRange } = require('../../../utils/yearFormat');

const columns = [
  {
    key: 'department',
    label: 'Department',
    required: true,
    aliases: ['department', 'dept', 'deptname', 'deptcode'],
    example: 'CSE',
    help: 'Department code or official department name',
    format: 'Dept code or full name',
    allowed: [],
    rules: ['must exist in database', 'case-insensitive match'],
    description: 'Academic department offering the class section.',
    commonMistakes: ['Department not created in the database yet'],
    normalize: v => String(v || '').trim(),
    validate: (v) => {
      if (!v) return 'Department missing';
      return null;
    }
  },
  {
    key: 'hallNo',
    label: 'HallNo',
    required: true,
    aliases: ['hallno', 'hall', 'room', 'roomno'],
    example: 'LH-301',
    help: 'Default lecture room or hall number',
    format: 'Room identifier (e.g. LH-301)',
    allowed: [],
    rules: ['trimmed', 'non-empty room code'],
    description: 'Primary classroom venue where class lectures and daily sessions are conducted.',
    commonMistakes: ['Leaving room number blank'],
    normalize: v => String(v || '').trim(),
    validate: (v) => {
      if (!v) return 'HallNo missing';
      return null;
    }
  },
  {
    key: 'sem',
    label: 'Semester',
    required: true,
    aliases: ['semester', 'sem'],
    example: 'III',
    help: 'Semester identifier (e.g. I, II, III or 1, 2, 3)',
    format: 'Roman or Arabic numeral (e.g. III or 3)',
    allowed: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', '1', '2', '3', '4', '5', '6', '7', '8'],
    rules: ['standard semester indicator'],
    description: 'Current term or semester of study.',
    commonMistakes: ['Entering year instead of semester'],
    normalize: v => String(v || '').trim(),
    validate: (v) => {
      if (!v) return 'Semester missing';
      return null;
    }
  },
  {
    key: 'batch',
    label: 'Batch',
    required: true,
    aliases: ['batch', 'batchname', 'graduationbatch'],
    example: '2025-2029',
    help: 'Graduation cohort range (YYYY-YYYY format)',
    format: 'YYYY-YYYY (e.g. 2025-2029)',
    allowed: [],
    rules: ['must match an active batch configured in current Academic Year'],
    description: 'Student graduation cohort span from entry to degree completion.',
    commonMistakes: ['Single year like "2025"', 'Batch not added to Settings > Academic Year'],
    normalize: v => normalizeYearRange(v),
    validate: (v) => {
      if (!v) return 'Batch missing';
      if (!isValidYearRange(v)) return `Batch "${v}" invalid: must follow YYYY-YYYY format (e.g. 2025-2029)`;
      return null;
    }
  },
  {
    key: 'year',
    label: 'Year',
    required: false,
    aliases: ['year', 'classyear'],
    example: 'II Year',
    help: 'Optional cohort year label',
    format: 'I Year | II Year | III Year | IV Year',
    allowed: ['I Year', 'II Year', 'III Year', 'IV Year'],
    rules: ['defaults to I Year if omitted'],
    description: 'Progress year representation.',
    commonMistakes: ['Number instead of Year label'],
    normalize: v => String(v || 'I Year').trim() || 'I Year',
    validate: () => null
  },
  {
    key: 'name',
    label: 'ClassName',
    required: false,
    aliases: ['classname', 'name'],
    example: '25-29 CSE',
    help: 'Explicit section name (defaults to short-batch + dept code)',
    format: 'e.g. 25-29 CSE or 25-29 CSE-A',
    allowed: [],
    rules: ['defaults to short-batch + dept if omitted', 'unique within department'],
    description: 'Distinguishable section title displayed in attendance sheets and schedules.',
    commonMistakes: ['Duplicate section name in the same department'],
    normalize: v => String(v || '').trim(),
    validate: () => null
  }
];

const exampleRows = [
  {
    Department: 'CSE',
    HallNo: 'LH-301',
    Semester: 'III',
    Batch: '2025-2029',
    Year: 'II Year',
    ClassName: '25-29 CSE'
  },
  {
    Department: 'ECE',
    HallNo: 'LH-204',
    Semester: 'III',
    Batch: '2025-2029',
    Year: 'II Year',
    ClassName: '25-29 ECE'
  },
  {
    Department: 'CSE',
    HallNo: 'LH-302',
    Semester: 'I',
    Batch: '2026-2030',
    Year: 'I Year',
    ClassName: '26-30 CSE'
  }
];

const commonMistakes = [
  'Batch range not created in Settings > Academic Year first',
  'Department code not matching an existing department',
  'Invalid batch format (e.g. "2025" instead of "2025-2029")',
  'Duplicate class names within the same academic cohort'
];

const limits = {
  maxFileSizeMb: 10,
  maxRows: 5000,
  formats: ['.xlsx', '.csv'],
  firstSheetOnly: true
};

module.exports = {
  type: 'class',
  label: 'Classes',
  columns,
  exampleRows,
  commonMistakes,
  limits,
  uniqueKeys: ['name']
};
