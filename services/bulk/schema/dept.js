const columns = [
  {
    key: 'name',
    label: 'Name',
    required: true,
    aliases: ['name', 'deptname', 'departmentname', 'department'],
    example: 'Computer Science & Engineering',
    help: 'Full official name of the academic department',
    format: 'Text, 3-80 chars',
    allowed: [],
    rules: ['trimmed', 'must be unique', 'letters & spaces'],
    description: 'Full official institutional name of the academic department.',
    commonMistakes: ['Merged cells', 'Missing department name', 'Duplicate department names'],
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
    format: '2-8 uppercase letters',
    allowed: [],
    rules: ['trimmed', 'uppercase', 'unique'],
    description: 'Short uppercase code used across system identifiers and timetable tags.',
    commonMistakes: ['Trailing spaces ("CSE ")', 'Lowercase code ("cse")', 'Special symbols'],
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
    format: '1-4 digit number',
    allowed: [],
    rules: ['numeric string', 'unique identifier code'],
    description: 'Administrative code assigned by academic council or university.',
    commonMistakes: ['Non-numeric text', 'Missing code number'],
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
    format: 'UG | PG',
    allowed: ['UG', 'PG'],
    rules: ['must be UG or PG', 'uppercase'],
    description: 'Curricular level offering (Undergraduate or Postgraduate).',
    commonMistakes: ['Typing "Undergraduate" instead of "UG"', 'Lowercase "ug"'],
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
    format: 'B.E | B.TECH | M.E | M.TECH',
    allowed: ['B.E', 'B.TECH', 'M.E', 'M.TECH'],
    rules: ['standard degree branch abbreviation'],
    description: 'Conferred degree qualification associated with the department.',
    commonMistakes: ['Missing dots ("BE" instead of "B.E")', 'Unknown qualification names'],
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
    format: 'Programme | Supportive',
    allowed: ['Programme', 'Supportive'],
    rules: ['defaults to Programme if omitted'],
    description: 'Programme departments confer degrees; Supportive departments provide allied foundational courses.',
    commonMistakes: ['Misspelling "Supportive"'],
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
    format: 'Icon name string',
    allowed: ['building2', 'laptop', 'radio', 'settings', 'bolt', 'tower', 'monitor', 'microchip', 'palette'],
    rules: ['defaults to building2 if omitted'],
    description: 'Icon shown on department tiles and badges across the application.',
    commonMistakes: ['Typing file extensions like "icon.png"'],
    normalize: v => String(v || 'building2').trim() || 'building2',
    validate: () => null
  }
];

const exampleRows = [
  {
    Name: 'Computer Science & Engineering',
    Code: 'CSE',
    Number: '104',
    CourseType: 'UG',
    Branch: 'B.E',
    Category: 'Programme',
    Icon: 'laptop'
  },
  {
    Name: 'Electronics & Communication Engineering',
    Code: 'ECE',
    Number: '105',
    CourseType: 'UG',
    Branch: 'B.E',
    Category: 'Programme',
    Icon: 'radio'
  },
  {
    Name: 'Science & Humanities',
    Code: 'S&H',
    Number: '100',
    CourseType: 'UG',
    Branch: 'B.E',
    Category: 'Supportive',
    Icon: 'building2'
  }
];

const commonMistakes = [
  'Trailing whitespace in Code (e.g. "CSE ")',
  'Duplicate Department Names or Codes within the institution',
  'Using full words like "Undergraduate" instead of "UG"',
  'Merged header rows or multi-column titles'
];

const limits = {
  maxFileSizeMb: 10,
  maxRows: 5000,
  formats: ['.xlsx', '.csv'],
  firstSheetOnly: true
};

module.exports = {
  type: 'dept',
  label: 'Departments',
  columns,
  exampleRows,
  commonMistakes,
  limits,
  uniqueKeys: ['code', 'name']
};
