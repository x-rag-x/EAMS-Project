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
    normalize: v => String(v || 'Student@123').trim() || 'Student@123',
    validate: () => null
  }
];

module.exports = {
  type: 'student',
  label: 'Students',
  columns,
  uniqueKeys: ['registerNo', 'username']
};
