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
      pageStudents:   'enabled',
      pageTeachers:   'enabled',
      pageController: 'enabled',
      pageRooms:      'enabled',
      pageManage:     'enabled',
      pageBulk:       'enabled',
      bulkChatUi:     true,
      pageTimeTable:  'enabled',
      pageSelector:   'enabled',
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
      timetableMatch:            'warn',
      forceTimetableSlots:       false,
    }
  },

  // Teachers Management and Faculty Leave Policies
  teachers: {
    card: 'Teachers Management',
    value: {
      annualLeaveQuota:         15,
      casualLeaveAllowance:     12,
      medicalLeaveAllowance:    10,
      earnedLeaveAllowance:     15,
      maxConsecutiveLeaveDays:  3,
      medicalDocThresholdDays:  3,
      requireSubstitution:      true,
      allowPeriodLeave:         true,
      carryForward:             true,
      autoEscalatePrincipal:    false,
    }
  },

  // Module and feature toggle settings
  models: {
    card: 'Models & Features',
    value: {
      modelLeave:            true,
      modelGrievances:       true,
      modelExams:            true,
      modelNotifications:    true,
      modelBackup:           true,
      modelUndo:             true,
      modelAddStudent:       true,
      modelExportSheet:      true,
      moduleDelUseAdminPass: true,
      requireHodApproval:    true,
      modelSmartBoards:      true,
      bulkMailCredentials:   true,
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
      regulationMinAttendance: {},
    }
  },

  // Password policy and security constraints
  security: {
    card: 'Password Policy',
    value: {
      forcePasswordChange:        true,
      requireStrongPassword:      true,
      sessionTimeout:             true,
      sessionTimeoutMins:         7,
      maxSessionLifetimeHours:    24,
      studentDeviceSessionLifetimeDays: 15,
      maxLoginAttempts:           3,
      lockoutDurationMins:        15,
      allowSubAdminLogs:          false,
      logRetentionDays:           0,
      loginLocationRequired:      true,
      loginLocationAccuracyCheck: true,
      loginLocationMaxAccuracyM:  2000,
      loginLocationMaxAgeSec:     300,
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
  },

  // EAMS Controller (Command Centre) configuration
  controller: {
    card: 'Controller Settings',
    value: {
      attendanceDeadlineMin: 10,
      hardReminderEveryMin:  5,
      campusGeofence:        { lat: null, lng: null, radiusM: 400 },
      lowPresencePct:        50,
      baselineDropPts:       20,
      defaulterPct:          75,
      condonationBandPct:    [65, 75],
      digestEveryMin:        30,
      dailyReportAt:         '17:30',
      letterheadImage:       null
    }
  },

  // Student Leave policy settings
  studentLeave: {
    card: 'Student Leave Policy',
    value: {
      maxDaysByStudent:   3,
      backdateDays:       3,
      certificateDueDays: 3
    }
  },

  // Student On-Duty (OD) settings
  od: {
    card: 'On-Duty (OD) Settings',
    value: {
      outcomeDueDays:     7,
      outcomeReminderDay: 5,
      scoreWeights:       { record: 40, request: 60 }
    }
  },

  // Unified Approval Workflow engine timeouts
  approvals: {
    card: 'Approval Engine Settings',
    value: {
      remindAfterHours:   24,
      escalateAfterHours: 48
    }
  },

  // Faculty substitution rules
  substitution: {
    card: 'Faculty Substitution Settings',
    value: {
      expireBeforePeriodMin: 120
    }
  },

  // Faculty leave reminders and emergency rules
  facultyLeave: {
    card: 'Faculty Leave Settings',
    value: {
      principalReminderTimes: ['16:00', '08:00'],
      emergencyReminderEveryMin: 30
    }
  },

  // Evidence files storage & Google Drive configuration
  evidence: {
    card: 'Evidence & Drive Storage',
    value: {
      maxMB:              5,
      types:              ['pdf', 'jpg', 'png'],
      driveSharedDriveId: ''
    }
  },

  // Hostel attendance & roll-call configuration
  hostel: {
    card: 'Hostel Settings',
    value: {
      rollCall:               { reminderAt: '20:45', open: '21:00', close: '21:45', verifyBy: '22:15' },
      qrRotateSec:            15,
      selfCheckIn:            { requireBoundDevice: true, requireGeofence: true, spotCheckCount: 5 },
      outing:                 { autoApprove: true, sameDayOnly: true, maxPerWeek: 3, notDuringClassHours: true },
      homeLeave:              { daysPerMonth: 6, blackoutDates: [] },
      overdueGraceMin:        120,
      returnReminderBeforeMin: 180,
      retentionDays:          730
    }
  },

  // Student device trust & registration settings (§15)
  device: {
    card: 'Trust & Devices',
    value: {
      requireRegisteredDevice:   true,
      studentSessionDays:        15,
      credentialTtlMin:          10,
      credentialMaxAttempts:     5,
      verifyCodeTtlMin:          5,
      verifyCodeMaxAttempts:     3,
      replacementRequestsPerDay: 3,
    }
  },

  // Student trust score engine & rules (§15)
  trust: {
    card: 'Trust & Devices',
    value: {
      enabled:                         true,
      startScore:                      100,
      bands:                           { normal: 80, monitor: 60, verify: 40 },
      uninformedAbsencePenalty:        4,
      frequentAbsenceThreshold:        6,
      frequentAbsencePenalty:          2,
      countApprovedLeaveInFrequency:   false,
      teacherDeniedPenalty:            40,
      teacherDeniedLockDays:           2,
      deviceShareAbsentDays:           7,
      deviceShareLockDays:             15,
      deviceShareAttendancePenaltyPct: 5,
      disputeWindowDays:               7,
      disputeBonusPct:                 2,
      deviceWeights:                   { key: 25, match: 10, location: 10, campusIp: 5, spoofPenalty: 10 },
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
