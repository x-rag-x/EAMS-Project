const columns = [
  {
    key: 'name',
    label: 'Name',
    required: true,
    aliases: ['name', 'deptname', 'departmentname', 'department'],
    example: 'Computer Science & Engineering',
    help: 'Full official name of the academic department',
    normalize: v => String(v || '').trim(),
    validate: (v) => {
      if (!v) return 'DeptName missing';
      return null;
    }
  },
  {
    key: 'code',
    label: 'Code',
    required: true,
    aliases: ['code', 'deptcode'],
    example: 'CSE',
    help: 'Unique uppercase department code',
    normalize: v => String(v || '').trim().toUpperCase(),
    validate: (v) => {
      if (!v) return 'Code missing';
      return null;
    }
  },
  {
    key: 'number',
    label: 'Number',
    required: true,
    aliases: ['number', 'deptnumber', 'no'],
    example: '104',
    help: 'Administrative index or sequence number',
    normalize: v => String(v || '').trim(),
    validate: (v) => {
      if (!v) return 'Number missing';
      return null;
    }
  },
  {
    key: 'courseType',
    label: 'CourseType',
    required: true,
    aliases: ['coursetype', 'course'],
    example: 'UG',
    help: 'Academic level: UG or PG',
    normalize: v => String(v || '').trim().toUpperCase(),
    validate: (v) => {
      if (!v) return 'CourseType missing';
      if (!['UG', 'PG'].includes(v)) return `CourseType "${v}" invalid: must be UG or PG`;
      return null;
    }
  },
  {
    key: 'branch',
    label: 'Branch',
    required: true,
    aliases: ['branch', 'degreebranch', 'degree'],
    example: 'B.E',
    help: 'Degree branch: B.E, B.TECH, M.E, or M.TECH',
    normalize: v => String(v || '').trim().toUpperCase(),
    validate: (v) => {
      if (!v) return 'Branch missing';
      if (!['B.E', 'B.TECH', 'M.E', 'M.TECH'].includes(v)) {
        return `Branch "${v}" invalid: must be B.E, B.TECH, M.E, or M.TECH`;
      }
      return null;
    }
  },
  {
    key: 'category',
    label: 'Category',
    required: false,
    aliases: ['category', 'deptcategory', 'classification', 'departmentcategory'],
    example: 'Programme',
    help: 'Programme or Supportive',
    normalize: v => {
      const s = String(v || '').toLowerCase().trim();
      if (s.includes('supp')) return 'supporting';
      return 'programme';
    },
    validate: (v, raw) => {
      if (raw) {
        const s = String(raw).toLowerCase().trim();
        if (!s.includes('supp') && !s.includes('prog')) {
          return `Category "${raw}" invalid: must be Programme or Supportive`;
        }
      }
      return null;
    }
  },
  {
    key: 'icon',
    label: 'Icon',
    required: false,
    aliases: ['icon', 'depticon'],
    example: 'building2',
    help: 'Visual UI icon name (defaults to building2)',
    normalize: v => String(v || 'building2').trim() || 'building2',
    validate: () => null
  }
];

module.exports = {
  type: 'dept',
  label: 'Departments',
  columns,
  uniqueKeys: ['code', 'name']
};
