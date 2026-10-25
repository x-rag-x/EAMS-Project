const columns = [
  {
    key: 'name',
    label: 'SubjectName',
    required: true,
    aliases: ['subjectname', 'name', 'title', 'subjecttitle'],
    example: 'Operating Systems',
    help: 'Official curricular subject course title',
    format: 'Course title text, 3-100 chars',
    allowed: [],
    rules: ['trimmed', 'descriptive course name'],
    description: 'Academic subject name as specified in the curriculum regulation.',
    commonMistakes: ['Entering subject code instead of title', 'Excessive abbreviations'],
    normalize: v => String(v || '').trim(),
    validate: (v) => {
      if (!v) return 'SubjectName missing';
      return null;
    }
  },
  {
    key: 'code',
    label: 'Code',
    required: true,
    aliases: ['code', 'subjectcode'],
    example: 'CS302',
    help: 'Unique curricular subject code',
    format: 'Alphanumeric code (e.g. CS302)',
    allowed: [],
    rules: ['unique across subjects', 'uppercase', 'alphanumeric'],
    description: 'Unique syllabus course code assigned by the university or board of studies.',
    commonMistakes: ['Duplicate subject codes', 'Trailing spaces in code'],
    normalize: v => String(v || '').trim().toUpperCase(),
    validate: (v) => {
      if (!v) return 'SubjectCode missing';
      return null;
    }
  },
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
    description: 'Host academic department managing the curriculum and faculty assignments for this course.',
    commonMistakes: ['Department not found in database'],
    normalize: v => String(v || '').trim(),
    validate: (v) => {
      if (!v) return 'Department missing';
      return null;
    }
  },
  {
    key: 'credits',
    label: 'Credits',
    required: false,
    aliases: ['credits', 'credit'],
    example: '4',
    help: 'Academic credit weighting (defaults to 3)',
    format: 'Integer or decimal number (e.g. 3 or 4)',
    allowed: [],
    rules: ['defaults to 3 if omitted', 'positive numeric value'],
    description: 'Credit points earned towards graduation upon successful course completion.',
    commonMistakes: ['Non-numeric text like "Four"'],
    normalize: v => Number(v) || 3,
    validate: () => null
  },
  {
    key: 'type',
    label: 'Type',
    required: false,
    aliases: ['type', 'subjecttype'],
    example: 'Theory',
    help: 'Theory or Practical (defaults to Theory)',
    format: 'Theory | Practical',
    allowed: ['Theory', 'Practical'],
    rules: ['defaults to Theory if omitted'],
    description: 'Instructional course delivery mode: classroom Theory or laboratory Practical.',
    commonMistakes: ['Typing "Lab" instead of "Practical"'],
    normalize: v => String(v || 'Theory').trim() || 'Theory',
    validate: () => null
  }
];

const exampleRows = [
  {
    SubjectName: 'Operating Systems',
    Code: 'CS302',
    Department: 'CSE',
    Credits: 4,
    Type: 'Theory'
  },
  {
    SubjectName: 'Database Management Systems Lab',
    Code: 'CS308',
    Department: 'CSE',
    Credits: 2,
    Type: 'Practical'
  },
  {
    SubjectName: 'Signals & Systems',
    Code: 'EC303',
    Department: 'ECE',
    Credits: 4,
    Type: 'Theory'
  }
];

const commonMistakes = [
  'Duplicate subject codes in the database',
  'Department code not matching an existing department',
  'Using non-numeric credits value'
];

const limits = {
  maxFileSizeMb: 10,
  maxRows: 5000,
  formats: ['.xlsx', '.csv'],
  firstSheetOnly: true
};

module.exports = {
  type: 'subject',
  label: 'Subjects',
  columns,
  exampleRows,
  commonMistakes,
  limits,
  uniqueKeys: ['code']
};
