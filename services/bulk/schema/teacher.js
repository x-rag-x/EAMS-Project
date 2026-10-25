const { sanitizeFullName, splitFirstLastName } = require('../../../utils/nameFormat');

const columns = [
  {
    key: 'name',
    label: 'Name',
    required: true,
    aliases: ['name', 'fullname', 'teachername', 'staffname'],
    example: 'Dr. Sarah Connor',
    help: 'Full legal name of the faculty member',
    format: 'Text, 3-80 chars',
    allowed: [],
    rules: ['trimmed', 'normalized case', 'honorifics preserved'],
    description: 'Full official name of the teacher as printed on institution records.',
    commonMistakes: ['Single word names without surname', 'Numbers or symbols in name'],
    normalize: v => sanitizeFullName(v),
    validate: (v) => {
      if (!v) return 'Name missing';
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
    description: 'Academic department the faculty member belongs to.',
    commonMistakes: ['Department not yet created in system', 'Spelling department name wrong'],
    normalize: v => String(v || '').trim(),
    validate: (v) => {
      if (!v) return 'Department missing';
      return null;
    }
  },
  {
    key: 'employeeNo',
    label: 'EmployeeID',
    required: true,
    aliases: ['employeeid', 'empid', 'employeeno', 'staffid'],
    example: 'EMP-4019',
    help: 'Unique institution employee identifier',
    format: 'Unique, letters/digits/-',
    allowed: [],
    rules: ['unique per teacher', 'alphanumeric and dashes'],
    description: 'Staff payroll or identity card number assigned by management.',
    commonMistakes: ['Duplicate EmployeeID across teachers', 'Using another teacher\'s ID'],
    normalize: v => String(v || '').trim(),
    validate: (v) => {
      if (!v) return 'EmployeeID missing';
      return null;
    }
  },
  {
    key: 'designation',
    label: 'Designation',
    required: false,
    aliases: ['designation', 'desig', 'role', 'title'],
    example: 'Associate Professor',
    help: 'Academic rank / role designation',
    format: 'Assistant Professor | Associate Professor | Professor | HOD',
    allowed: ['Assistant Professor', 'Associate Professor', 'Professor', 'HOD', 'Lecturer'],
    rules: ['defaults to Assistant Professor if blank'],
    description: 'Teaching position or academic rank held in the institution.',
    commonMistakes: ['Typing non-standard abbreviations'],
    normalize: v => String(v || 'Assistant Professor').trim() || 'Assistant Professor',
    validate: () => null
  },
  {
    key: 'username',
    label: 'Username',
    required: true,
    aliases: ['username', 'user', 'loginid'],
    example: 'sconnor',
    help: 'Unique portal login username (no SB- or TR- prefix)',
    format: 'Lowercase letters & digits, 3-30 chars',
    allowed: [],
    rules: ['unique across all users', 'no SB- or TR- prefixes', 'lowercase'],
    description: 'Login username used for EAMS authentication.',
    commonMistakes: ['Prefixing with "TR-" or "SB-" (system handles prefixes automatically)', 'Spaces in username'],
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
    key: 'email',
    label: 'Email',
    required: false,
    aliases: ['email', 'mail', 'emailaddress'],
    example: 'sarah.c@college.edu',
    help: 'Official institutional contact email',
    format: 'Valid email address',
    allowed: [],
    rules: ['valid email format', 'used for initial credential delivery'],
    description: 'Destination email address where login credentials and system notices are dispatched.',
    commonMistakes: ['Typo in domain like "gmial.com" or "yaho.com"', 'Missing @ symbol'],
    normalize: v => String(v || '').trim().toLowerCase(),
    validate: (v) => {
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        return 'Invalid email format';
      }
      return null;
    }
  },
  {
    key: 'gender',
    label: 'Gender',
    required: false,
    aliases: ['gender', 'sex'],
    example: 'Female',
    help: 'Male, Female, or unspecified',
    format: 'Male | Female | unspecified',
    allowed: ['Male', 'Female', 'unspecified'],
    rules: ['defaults to unspecified if blank'],
    description: 'Gender demographic information for institutional compliance reports.',
    commonMistakes: ['Typing "M" or "F" instead of Male/Female'],
    normalize: v => String(v || 'unspecified').trim(),
    validate: () => null
  },
  {
    key: 'password',
    label: 'Password',
    required: false,
    aliases: ['password', 'pass'],
    example: 'Teacher@123',
    help: 'Initial login password (defaults to teacher123)',
    format: 'Min 6 chars',
    allowed: [],
    rules: ['defaults to teacher123 if blank', 'forced change on first login'],
    description: 'Temporary initial password. If omitted, teacher123 is set.',
    commonMistakes: ['Password shorter than 6 characters'],
    normalize: v => String(v || 'teacher123').trim() || 'teacher123',
    validate: (v) => {
      if (v && v.length < 6) return 'Password must be at least 6 characters';
      return null;
    }
  }
];

const exampleRows = [
  {
    Name: 'Dr. Sarah Connor',
    Department: 'CSE',
    EmployeeID: 'EMP-4019',
    Designation: 'Associate Professor',
    Username: 'sconnor',
    Email: 'sarah.c@college.edu',
    Gender: 'Female',
    Password: 'teacher123'
  },
  {
    Name: 'Raj Kumar',
    Department: 'ECE',
    EmployeeID: 'EMP-4020',
    Designation: 'Assistant Professor',
    Username: 'rajkumar',
    Email: 'raj.k@college.edu',
    Gender: 'Male',
    Password: 'teacher123'
  },
  {
    Name: 'Jane Smith',
    Department: 'CSE',
    EmployeeID: 'EMP-4021',
    Designation: 'Professor',
    Username: 'jsmith',
    Email: 'jane.s@college.edu',
    Gender: 'Female',
    Password: 'teacher123'
  }
];

const commonMistakes = [
  'Prefixing username with "TR-" or "SB-"',
  'Duplicate EmployeeID or Username across faculty records',
  'Department code not matching an existing department in the database',
  'Typo in email address preventing credential delivery'
];

const limits = {
  maxFileSizeMb: 10,
  maxRows: 5000,
  formats: ['.xlsx', '.csv'],
  firstSheetOnly: true
};

module.exports = {
  type: 'teacher',
  label: 'Teachers',
  columns,
  exampleRows,
  commonMistakes,
  limits,
  uniqueKeys: ['employeeNo', 'username']
};
