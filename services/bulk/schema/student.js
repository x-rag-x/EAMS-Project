const { sanitizeFullName } = require('../../../utils/nameFormat');
const { normalizeYearRange, isValidYearRange } = require('../../../utils/yearFormat');

const validCourses = ['UG', 'PG', 'M.E', 'M.TECH', 'B.E', 'B.TECH'];

const columns = [
  {
    key: 'fullName',
    label: 'FullName',
    required: true,
    aliases: ['fullname', 'name', 'studentname'],
    example: 'Alex Mercer',
    help: 'Full legal name of the student',
    format: 'Text, 3-80 chars',
    allowed: [],
    rules: ['trimmed', 'normalized case', 'special characters sanitized'],
    description: 'Student full legal name for academic transcripts and attendance roster.',
    commonMistakes: ['Entering initials only without full name', 'Numbers in name'],
    normalize: v => sanitizeFullName(v),
    validate: (v) => {
      if (!v) return 'FullName missing';
      return null;
    }
  },
  {
    key: 'registerNo',
    label: 'RegisterNo',
    required: true,
    aliases: ['registerno', 'regno', 'rollno', 'studentregisterno', 'studentregno'],
    example: '7376222CS101',
    help: 'Unique university register / roll number',
    format: 'Unique alphanumeric identifier',
    allowed: [],
    rules: ['unique per student', 'must not already exist in DB or earlier sheet rows'],
    description: 'Official university register number or institutional roll identifier.',
    commonMistakes: ['Duplicate register number in same file or database', 'Special characters or spaces'],
    normalize: v => String(v || '').trim(),
    validate: (v) => {
      if (!v) return 'RegisterNo missing';
      return null;
    }
  },
  {
    key: 'gender',
    label: 'Gender',
    required: true,
    aliases: ['gender', 'sex'],
    example: 'Male',
    help: 'Male, Female, or Other',
    format: 'Male | Female | Other',
    allowed: ['Male', 'Female', 'Other'],
    rules: ['capitalized (Male, Female, Other)'],
    description: 'Demographic gender classification for regulatory hostel and scholarship records.',
    commonMistakes: ['Abbreviating to "M" or "F" instead of Male or Female'],
    normalize: v => {
      const s = String(v || '').trim();
      return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
    },
    validate: (v) => {
      if (!v) return 'Gender missing';
      if (!['Male', 'Female', 'Other'].includes(v)) {
        return 'Gender must be Male, Female, or Other';
      }
      return null;
    }
  },
  {
    key: 'academicYear',
    label: 'AcademicYear',
    required: true,
    aliases: ['academicyear', 'ay'],
    example: '2025-2026',
    help: 'Admission/current academic year range (YYYY-YYYY format)',
    format: 'YYYY-YYYY (e.g. 2025-2026)',
    allowed: [],
    rules: ['standard YYYY-YYYY range'],
    description: 'Current academic calendar term of admission.',
    commonMistakes: ['Single year like "2025"', 'Using forward slash "2025/2026"'],
    normalize: v => normalizeYearRange(v),
    validate: (v) => {
      if (!v) return 'AcademicYear missing';
      if (!isValidYearRange(v)) {
        return `AcademicYear "${v}" invalid: must follow YYYY-YYYY format (e.g. 2025-2026)`;
      }
      return null;
    }
  },
  {
    key: 'batch',
    label: 'Batch',
    required: true,
    aliases: ['batch', 'batchname'],
    example: '2025-2029',
    help: 'Graduation cohort range (YYYY-YYYY format)',
    format: 'YYYY-YYYY (e.g. 2025-2029)',
    allowed: [],
    rules: ['must match an active batch configured in current Academic Year'],
    description: 'Expected 4-year or 2-year cohort batch cycle.',
    commonMistakes: ['Batch not created under Academic Year in Settings', 'Invalid cohort year span'],
    normalize: v => normalizeYearRange(v),
    validate: (v) => {
      if (!v) return 'Batch missing';
      if (!isValidYearRange(v)) {
        return `Batch "${v}" invalid: must follow YYYY-YYYY format (e.g. 2025-2029)`;
      }
      return null;
    }
  },
  {
    key: 'courseType',
    label: 'CourseType',
    required: true,
    aliases: ['coursetype', 'course'],
    example: 'UG',
    help: 'UG, PG, B.E, B.TECH, M.E, or M.TECH',
    format: 'UG | PG | B.E | B.TECH | M.E | M.TECH',
    allowed: ['UG', 'PG', 'B.E', 'B.TECH', 'M.E', 'M.TECH'],
    rules: ['uppercase standard degree type'],
    description: 'Undergraduate or Postgraduate program level.',
    commonMistakes: ['Typing "Undergraduate" or "B.Tech" without uppercase'],
    normalize: v => String(v || '').trim().toUpperCase(),
    validate: (v) => {
      if (!v) return 'CourseType missing';
      if (!validCourses.includes(v)) {
        return `CourseType "${v}" unknown`;
      }
      return null;
    }
  },
  {
    key: 'branch',
    label: 'Branch',
    required: true,
    aliases: ['branch', 'degreebranch', 'degree'],
    example: 'B.E',
    help: 'Degree branch specialization',
    format: 'B.E | B.TECH | M.E | M.TECH',
    allowed: ['B.E', 'B.TECH', 'M.E', 'M.TECH'],
    rules: ['must match department branch offering'],
    description: 'Degree specialization program under the department.',
    commonMistakes: ['Typing "BE" without dots'],
    normalize: v => String(v || '').trim().toUpperCase(),
    validate: (v) => {
      if (!v) return 'Branch missing';
      return null;
    }
  },
  {
    key: 'department',
    label: 'Department',
    required: true,
    aliases: ['department', 'dept', 'deptname', 'deptcode'],
    example: 'CSE',
    help: 'Department code or official name',
    format: 'Dept code or full name',
    allowed: [],
    rules: ['must exist in database', 'case-insensitive match'],
    description: 'Academic department the student is enrolled in.',
    commonMistakes: ['Department not found in database', 'Using non-existent department code'],
    normalize: v => String(v || '').trim(),
    validate: (v) => {
      if (!v) return 'Department missing';
      return null;
    }
  },
  {
    key: 'class',
    label: 'Class',
    required: true,
    aliases: ['class', 'classname', 'section'],
    example: '25-29 CSE',
    help: 'Class section name',
    format: 'Class section name (e.g. 25-29 CSE)',
    allowed: [],
    rules: ['must exist in database under matching department and batch cohort'],
    description: 'Specific classroom section cohort where student is scheduled.',
    commonMistakes: ['Class does not belong to the selected Department', 'Class not yet imported/created'],
    normalize: v => String(v || '').trim(),
    validate: (v) => {
      if (!v) return 'Class missing';
      return null;
    }
  },
  {
    key: 'email',
    label: 'Email',
    required: true,
    aliases: ['email', 'mail', 'emailaddress'],
    example: 'alex.m@student.edu',
    help: 'Student contact/login email',
    format: 'Valid student email',
    allowed: [],
    rules: ['valid email format', 'used for credential dispatch'],
    description: 'Destination email address where student portal login credentials are sent.',
    commonMistakes: ['Typo in domain like "gmial.com"', 'Invalid characters in email'],
    normalize: v => String(v || '').trim().toLowerCase(),
    validate: (v) => {
      if (!v) return 'Email missing';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        return 'Invalid email format';
      }
      return null;
    }
  },
  {
    key: 'username',
    label: 'Username',
    required: true,
    aliases: ['username', 'user', 'loginid'],
    example: 'amercer',
    help: 'Unique portal login username (no SB- or TR- prefix)',
    format: 'Lowercase letters & digits, 3-30 chars',
    allowed: [],
    rules: ['unique across all users', 'no SB- or TR- prefixes'],
    description: 'Portal login username for EAMS student attendance app.',
    commonMistakes: ['Prefixing username with "SB-" (system generates track IDs automatically)', 'Duplicate username'],
    normalize: v => String(v || '').trim().toLowerCase(),
    validate: (v) => {
      if (!v) return 'Username missing';
      if (v.startsWith('sb-') || v.startsWith('tr-')) {
        return "Username prefixes 'SB-' and 'TR-' are reserved";
      }
      return null;
    }
  },
  {
    key: 'residency',
    label: 'Residency',
    required: false,
    aliases: ['residency', 'residencetype', 'residence', 'stay', 'staytype', 'hostelordayscholar', 'dayscholarorhosteller'],
    example: 'dayscholar',
    help: 'dayscholar or hosteller (defaults to dayscholar)',
    format: 'dayscholar | hosteller',
    allowed: ['dayscholar', 'hosteller'],
    rules: ['defaults to dayscholar if omitted'],
    description: 'Residential accommodation status for movement and hostel tracking.',
    commonMistakes: ['Typo in dayscholar / hosteller'],
    normalize: (v) => {
      const s = String(v || '').toLowerCase().trim();
      if (s.includes('hostel')) return 'hostel';
      return 'dayscholar';
    },
    validate: (v, raw) => {
      if (raw) {
        const s = String(raw).toLowerCase().trim();
        if (!s.includes('hostel') && !s.includes('day') && !s.includes('scholar')) {
          return `Residency "${raw}" invalid: must be Dayscholar or Hosteller`;
        }
      }
      return null;
    }
  },
  {
    key: 'password',
    label: 'Password',
    required: false,
    aliases: ['password', 'pass'],
    example: 'Student@123',
    help: 'Initial login password (defaults to Student@123)',
    format: 'Min 6 chars',
    allowed: [],
    rules: ['defaults to Student@123 if omitted', 'mandatory change on first login'],
    description: 'Initial login password dispatched in credential notification.',
    commonMistakes: ['Password shorter than 6 characters'],
    normalize: v => String(v || 'Student@123').trim() || 'Student@123',
    validate: () => null
  }
];

const exampleRows = [
  {
    FullName: 'Alex Mercer',
    RegisterNo: '7376222CS101',
    Gender: 'Male',
    AcademicYear: '2025-2026',
    Batch: '2025-2029',
    CourseType: 'UG',
    Branch: 'B.E',
    Department: 'CSE',
    Class: '25-29 CSE',
    Email: 'alex.m@student.edu',
    Username: 'amercer',
    Residency: 'dayscholar',
    Password: 'Student@123'
  },
  {
    FullName: 'Priya Sharma',
    RegisterNo: '7376222CS102',
    Gender: 'Female',
    AcademicYear: '2025-2026',
    Batch: '2025-2029',
    CourseType: 'UG',
    Branch: 'B.E',
    Department: 'CSE',
    Class: '25-29 CSE',
    Email: 'priya.s@student.edu',
    Username: 'psharma',
    Residency: 'hosteller',
    Password: 'Student@123'
  },
  {
    FullName: 'Rahul David',
    RegisterNo: '7376222EC101',
    Gender: 'Male',
    AcademicYear: '2025-2026',
    Batch: '2025-2029',
    CourseType: 'UG',
    Branch: 'B.E',
    Department: 'ECE',
    Class: '25-29 ECE',
    Email: 'rahul.d@student.edu',
    Username: 'rdavid',
    Residency: 'dayscholar',
    Password: 'Student@123'
  }
];

const commonMistakes = [
  'Prefixing username with "SB-" (system assigns track ID automatically)',
  'Class does not belong to the indicated Department or Batch cohort',
  'Duplicate Register Number or Username across student accounts',
  'Batch not registered in current Academic Year in Settings'
];

const limits = {
  maxFileSizeMb: 10,
  maxRows: 5000,
  formats: ['.xlsx', '.csv'],
  firstSheetOnly: true
};

module.exports = {
  type: 'student',
  label: 'Students',
  columns,
  exampleRows,
  commonMistakes,
  limits,
  uniqueKeys: ['registerNo', 'username']
};
