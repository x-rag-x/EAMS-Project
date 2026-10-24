const { normalizeYearRange, isValidYearRange } = require('../../../utils/yearFormat');

const columns = [
  {
    key: 'department',
    label: 'Department',
    required: true,
    aliases: ['department', 'dept', 'deptname', 'deptcode'],
    example: 'CSE',
    help: 'Department code or official department name',
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
    normalize: v => String(v || '').trim(),
    validate: () => null
  }
];

module.exports = {
  type: 'class',
  label: 'Classes',
  columns,
  uniqueKeys: ['name']
};
