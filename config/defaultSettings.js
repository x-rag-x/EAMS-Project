// System settings default configurations and seed definitions

const DEFAULT_SETTINGS_MAP = {
  // Institution details configuration
  institution: {
    card: 'Institution Details',
    value: {
      institutionName:    '',
      institutionShort:   '',
      institutionTagline: '',
      institutionLogoUrl: '',
      institutionAddress: '',
      institutionEmail:   '',
      institutionPhone:   '',
      institutionWebsite: '',
    }
  },

  // Pages and portal access control settings
  pages: {
    card: 'Pages & Portals',
    value: {
      pageStudents:  'enabled',
      pageTeachers:  'enabled',
      pageManage:    'enabled',
      pageBulk:      'enabled',
      pageTimeTable: 'enabled',
      pageSelector:  'enabled',
    }
  },

  // Attendance policy and session rules
  attendance: {
    card: 'Attendance Policy',
    value: {
      markAttendance:            true,
      liveSessions:              true,
      quickPass:                 true,
      rotationCount:             2,
      rotationTimeSec:           60,
      qrIntervalSec:             60,
      forwardToRep:              true,
      allowAttendanceEdit:       true,
      maxAttendanceBackdateDays: 3,
      requirePeriodRemark:       false,
      autoLockAttendanceHours:   24,
      defaultAttendanceStatus:   'Present',
    }
  },

  // Module and feature toggle settings
  models: {
    card: 'Models & Features',
    value: {
      modelAssignments:      true,
      modelLeave:            true,
      modelGrievances:       true,
      modelExams:            true,
      modelNotifications:    true,
      modelBackup:           true,
      modelUndo:             true,
      modelAddStudent:       true,
      modelExportSheet:      true,
      moduleDelUseAdminPass: true,
    }
  },

  // Academic calendar and attendance thresholds
  academic: {
    card: 'Academic Settings',
    value: {
      academicYear:           '2026-2027',
      currentSemesterType:    'Odd',
      minAttendance:          75,
      lowAttendanceThreshold: 65,
      workingDays:            6,
      periodsPerDay:          7,
    }
  },

  // Password policy and security constraints
  security: {
    card: 'Password Policy',
    value: {
      forcePasswordChange:       true,
      requireStrongPassword:     true,
      sessionTimeout:            true,
      sessionTimeoutMins:        60,
      maxLoginAttempts:          3,
      lockoutDurationMins:       15,
    }
  },

  // System broadcast popup configuration
  broadcast: {
    card: 'System Broadcasts',
    value: {
      defaultPopupDurationSec:  10,
      autoExpireHours:          24,
      allowTeacherBroadcasts:   false,
    }
  },

  // Advanced system utilities and debugging flags
  advanced: {
    card: 'System Utilities',
    value: {
      debugMode:         false,
      multiAdminSession: true,
      autoSeedDemoData:  false,
      errorsCount:       20,
    }
  },

  // Operational maintenance mode configuration
  maintenance: {
    card: 'System Utilities',
    value: {
      active:        false,
      message:       'System under maintenance. Please try again later.',
      affectedRoles: [],
      endTime:       null,
      startedAt:     null,
    }
  }
};

const DEFAULT_SETTINGS_LIST = Object.entries(DEFAULT_SETTINGS_MAP).map(([key, item]) => ({
  key,
  card: item.card,
  value: item.value,
}));

module.exports = {
  DEFAULT_SETTINGS_MAP,
  DEFAULT_SETTINGS_LIST,
};
