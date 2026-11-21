'use strict';

const globals = require('globals');

const frontendGlobals = {
  // EAMS Core APIs & Auth
  api: 'readonly',
  apiCall: 'readonly',
  apiDownload: 'readonly',
  getToken: 'readonly',
  TOKEN: 'readonly',
  getUser: 'readonly',
  recordSessionActivity: 'readonly',
  doLogout: 'readonly',
  SESSION: 'readonly',
  currentUser: 'readonly',
  Guard: 'readonly',
  DeviceKey: 'readonly',

  // UI Components & Dialogs
  showToast: 'readonly',
  dbToast: 'readonly',
  toast: 'readonly',
  dbtoast: 'readonly',
  actionToast: 'readonly',
  flushToastQueue: 'readonly',
  _toastQueue: 'writable',
  openModal: 'readonly',
  closeModal: 'readonly',
  showConfirm: 'readonly',
  showPrompt: 'readonly',
  showPopup: 'readonly',
  openModalBg: 'readonly',
  closeModalBg: 'readonly',
  openModal_: 'readonly',
  openForceChangePwModal: 'readonly',
  showForcePwModal: 'readonly',
  openODDetailModal: 'readonly',
  openRepConfirmModal: 'readonly',
  SearchableDropdown: 'readonly',
  reIconReplace: 'readonly',

  // Escaping & Sanitization
  escapeHtml: 'readonly',
  esc: 'readonly',
  safeHref: 'readonly',

  // Tab Workspace
  TabWorkspace: 'readonly',
  buildTabId: 'readonly',
  resolveFriendlyTabTitle: 'readonly',
  switchTab: 'readonly',
  navigateToTab: 'readonly',
  renderCurrentView: 'readonly',
  CURRENT_TAB: 'writable',

  // Data Stores & Config
  DB: 'readonly',
  YEAR_CONFIG: 'readonly',
  UIStates: 'readonly',
  TIMING_SETS: 'readonly',
  STUDENT: 'readonly',
  _masterData: 'writable',
  _teacherData: 'writable',
  _loaderActive: 'writable',
  _activeAlerts: 'writable',
  _lastOverdueCount: 'writable',
  TeacherTimetable: 'readonly',
  WorkloadShared: 'readonly',
  EamsTracker: 'readonly',

  // Date & User Helpers
  todayIST: 'readonly',
  formatDateISO: 'readonly',
  isSudoAdmin: 'readonly',
  isAdminUser: 'readonly',
  isHod: 'readonly',
  hasPageRight: 'readonly',
  applyUserRoleBadgeStyling: 'readonly',

  // Domain & Page Actions
  renderDepartments: 'readonly',
  syncFromAPI: 'readonly',
  syncUserStateToDb: 'readonly',
  switchEnv: 'readonly',
  switchExecutiveTab: 'readonly',
  loadStudents: 'readonly',
  fetchStudentsData: 'readonly',
  rosterInit: 'readonly',
  registryInit: 'readonly',
  nav: 'readonly',
  loadLiveAlertsRail: 'readonly',
  approveUnlockRequest: 'readonly',
  rejectUnlockRequest: 'readonly',
  hodApproveInboxSubAdmin: 'readonly',
  hodDenyInboxSubAdmin: 'readonly',
  markAllRep: 'readonly',
  submitRepConfirmedAttendance: 'readonly',
  validateRepHeadcount: 'readonly',
  loadNotifications: 'readonly',
  versionId: 'writable',
  renderQrToCanvas: 'readonly',
  fetchTodaySessions: 'readonly',
  loadFacultyDepartmentsForFinder: 'readonly',
  getSelectedClassId: 'readonly',
  render: 'readonly',

  // Third-party & UMD
  XLSX: 'readonly',
  qrcode: 'readonly',
  define: 'readonly',
  module: 'readonly',
  global: 'readonly'
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dev/**',
      '.agents/**',
      '.antigravity/**',
      'coverage/**',
      'tests/fixtures/**',
      'tests/snapshots/**'
    ]
  },
  // a) Node backend & config
  {
    files: [
      'routes/**/*.js',
      'middleware/**/*.js',
      'models/**/*.js',
      'services/**/*.js',
      'utils/**/*.js',
      'jobs/**/*.js',
      'config/**/*.js',
      'scripts/**/*.js',
      'server.js'
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  // b) Browser frontend
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...frontendGlobals
      }
    },
    rules: {
      'no-undef': 'error'
    }
  },
  // c) Tests
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error'
    }
  }
];
