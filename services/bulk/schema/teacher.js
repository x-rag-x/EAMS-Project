const { sanitizeFullName, splitFirstLastName } = require('../../../utils/nameFormat');

const columns = [
  {
    key: 'name',
    label: 'Name',
    required: true,
    aliases: ['name', 'fullname', 'teachername', 'staffname'],
    example: 'Dr. Sarah Connor',
    help: 'Full legal name of the faculty member',
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
    normalize: v => String(v || 'teacher123').trim() || 'teacher123',
    validate: () => null
  }
];

module.exports = {
  type: 'teacher',
  label: 'Teachers',
  columns,
  uniqueKeys: ['employeeNo', 'username']
};
