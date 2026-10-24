// SETTINGS & SECURITY HUB CLIENT LOGIC
var TOKEN = getToken();
var currentUser = null;
var currentTab = 'institution';
var currentHistoryPage = 1;
var historySearchDebounce = null;
var dirtyState = false;

var SETTINGS_STATE = {
  institution: {},
  pages: {
    pageStudents: 'enabled',
    pageTeachers: 'enabled',
    pageController: 'enabled',
    pageRooms: 'enabled',
    pageManage: 'enabled',
    pageBulk: 'enabled',
    pageTimeTable: 'enabled',
    pageSelector: 'enabled',
  },
  attendance: {},
  teachers: {},
  models: {},
  academic: {},
  security: {},
  device: {},
  trust: {},
  broadcast: {},
  advanced: {},
};
window.SETTINGS_STATE = SETTINGS_STATE;

// ── Settings Live Sync Status Controller ──
function setSettingStatus(status, customText) {
  var badge = document.getElementById('setting-status');
  if (!badge) return;
  var textEl = document.getElementById('setting-status-text');
  badge.className = 'setting-sync-badge status-' + status;
  var label = customText;
  if (!label) {
    if (status === 'saved') label = 'Saved';
    else if (status === 'saving') label = 'Saving';
    else if (status === 'loading') label = 'Loading';
    else if (status === 'error') label = 'Error';
    else label = status;
  }
  if (textEl) textEl.textContent = label;
  if (status === 'saved') badge.title = 'All settings saved to database';
  else if (status === 'saving') badge.title = 'Saving settings to database…';
  else if (status === 'loading') badge.title = 'Loading settings configuration…';
  else if (status === 'error') badge.title = 'Settings sync error occurred';
}
window.setSettingStatus = setSettingStatus;

(function initSettings() {
  currentUser = getUser();
  if (!currentUser) return;

  hydrateUser();
  updateClock();
  setInterval(updateClock, 1000);

  // Check URL params for active tab
  var urlParams = new URLSearchParams(window.location.search);
  var tabParam = urlParams.get('tab') || 'institution';
  nav(tabParam);

  loadAllSettings().then(function () {
    trackDirtyInputs();
  });
})();

function hydrateUser() {
  var nameEl = document.getElementById('sb-name');
  var roleEl = document.getElementById('sb-role');
  var avEl = document.getElementById('sb-av');
  var backBtn = document.getElementById('back-hub-btn');
  var backText = document.getElementById('back-hub-text');

  if (currentUser) {
    var name = currentUser.name || currentUser.fullName || currentUser.username || 'Admin';
    if (nameEl) nameEl.textContent = name;
    if (avEl) avEl.textContent = name.charAt(0).toUpperCase();

    var label = 'Dashboard';
    if (currentUser.role === 'teacher') {
      if (roleEl) roleEl.textContent = 'Faculty';
      label = 'Hub';
    } else {
      if (roleEl) roleEl.textContent = 'Admin';
      var ref = (document.referrer || '').toLowerCase();
      if (ref.includes('control.html')) {
        label = 'Control';
      } else {
        label = 'Dashboard';
      }
    }

    if (backText) backText.textContent = 'Back';
    if (backBtn) backBtn.title = 'Back to ' + label;
  }
}

function updateClock() {
  var now = new Date();
  var clockEl = document.getElementById('top-time');
  if (clockEl) {
    clockEl.textContent = now.toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
}

function goBackHub() {
  if (currentUser && currentUser.role === 'teacher') {
    window.location.href = 'selector.html';
  } else {
    var ref = (document.referrer || '').toLowerCase();
    if (ref.includes('control.html')) {
      window.location.href = 'control.html';
    } else {
      window.location.href = 'admin.html';
    }
  }
}

// ─── SIDEBAR TOGGLE (Matching admin.html / admin.page.js) ─────────────────────
function toggleAdminSidebar() {
  var sidebar = document.querySelector('#app-shell .sb') || document.querySelector('.sb');
  var mainContent = document.querySelector('.mc');
  var toggleButton = document.getElementById('sbtoggle');
  var overlay = document.getElementById('sb-overlay');
  var isMobile = window.innerWidth <= 768;

  if (isMobile) {
    var isOpen = sidebar.classList.toggle('sb-mobile-open');
    if (overlay) overlay.classList.toggle('visible', isOpen);
    if (toggleButton) toggleButton.innerHTML = isOpen ? '<re-icon icon="x"></re-icon>' : '<re-icon icon="menu"></re-icon>';
  } else {
    var isHidden = sidebar.classList.toggle('sb-hidden');
    if (mainContent) mainContent.classList.toggle('sb-expanded', isHidden);
    if (toggleButton) {
      toggleButton.classList.toggle('closed', isHidden);
      toggleButton.innerHTML = isHidden ? '<re-icon icon="menu"></re-icon>' : '<re-icon icon="x"></re-icon>';
    }
    var saveBar = document.getElementById('save-bar');
    if (saveBar) saveBar.classList.toggle('sb-wide', isHidden);
  }
}
window.toggleAdminSidebar = toggleAdminSidebar;
window.toggleSidebar = toggleAdminSidebar;

// Tab Navigation
function nav(tabName) {
  if (tabName === 'years') {
    window.location.href = 'manage.html?tab=years';
    return;
  }
  var validTabs = ['institution', 'pages', 'attendance', 'teachers', 'models', 'security', 'trust', 'academic', 'broadcast', 'history', 'advanced'];
  if (validTabs.indexOf(tabName) === -1) tabName = 'institution';
  currentTab = tabName;

  if (window.history && window.history.replaceState) {
    var url = new URL(window.location);
    url.searchParams.set('tab', tabName);
    window.history.replaceState(null, '', url);
  }

  document.querySelectorAll('.pg').forEach(function (el) { el.classList.remove('act'); });
  var targetPg = document.getElementById('pg-' + tabName);
  if (targetPg) targetPg.classList.add('act');

  document.querySelectorAll('.sb-item').forEach(function (btn) {
    btn.classList.remove('act');
    if (btn.getAttribute('onclick') && btn.getAttribute('onclick').indexOf("'" + tabName + "'") !== -1) {
      btn.classList.add('act');
    }
  });

  if (window.innerWidth <= 768) {
    var sidebar = document.querySelector('#app-shell .sb') || document.querySelector('.sb');
    var overlay = document.getElementById('sb-overlay');
    var toggleButton = document.getElementById('sbtoggle');
    if (sidebar && sidebar.classList.contains('sb-mobile-open')) {
      sidebar.classList.remove('sb-mobile-open');
      if (overlay) overlay.classList.remove('visible');
      if (toggleButton) toggleButton.innerHTML = '<re-icon icon="menu"></re-icon>';
    }
  }

  if (tabName === 'history') {
    loadHistory(1);
  }
  checkDirtyState();
}

// Tri-State Segmented Control Handler
function setTriState(key, mode, btn) {
  SETTINGS_STATE.pages[key] = mode;
  var wrap = btn.closest('.tristate-wrap');
  if (wrap) {
    wrap.querySelectorAll('.tristate-btn').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
  }
  checkDirtyState();
  if (typeof triggerAutoSaveForCard === 'function') {
    triggerAutoSaveForCard('pages', key);
  }
}

function applyTriStateUI(key, mode) {
  SETTINGS_STATE.pages[key] = mode || 'enabled';
  var wrap = document.querySelector('.tristate-wrap[data-key="' + key + '"]');
  if (!wrap) return;

  wrap.querySelectorAll('.tristate-btn').forEach(function (btn) {
    btn.classList.remove('active');
    if (mode === 'enabled' && btn.classList.contains('enabled')) btn.classList.add('active');
    if (mode === 'disabled' && btn.classList.contains('disabled')) btn.classList.add('active');
    if (mode === 'hidden' && btn.classList.contains('hidden-mode')) btn.classList.add('active');
  });
}

// Baseline Snapshot Store for Accurate Dirty Tracking
var BASELINE_SNAPSHOT = window.BASELINE_SNAPSHOT || {};
window.BASELINE_SNAPSHOT = BASELINE_SNAPSHOT;
var ALL_SETTING_CARDS = ['institution', 'pages', 'attendance', 'teachers', 'models', 'security', 'device', 'trust', 'academic', 'broadcast', 'advanced'];

function getCardValues(cardKey) {
  if (cardKey === 'institution') {
    return {
      institutionName: (document.getElementById('inst-name')?.value || '').trim(),
      institutionShort: (document.getElementById('inst-short')?.value || '').trim(),
      institutionTagline: (document.getElementById('inst-tagline')?.value || '').trim(),
      institutionAddress: (document.getElementById('inst-addr')?.value || '').trim(),
      institutionEmail: (document.getElementById('inst-email')?.value || '').trim(),
      institutionPhone: (document.getElementById('inst-phone')?.value || '').trim(),
      institutionWebsite: (document.getElementById('inst-web')?.value || '').trim(),
    };
  } else if (cardKey === 'pages') {
    return {
      pageStudents: SETTINGS_STATE.pages.pageStudents || 'enabled',
      pageTeachers: SETTINGS_STATE.pages.pageTeachers || 'enabled',
      pageController: SETTINGS_STATE.pages.pageController || 'enabled',
      pageRooms: SETTINGS_STATE.pages.pageRooms || 'enabled',
      pageManage: SETTINGS_STATE.pages.pageManage || 'enabled',
      pageBulk: SETTINGS_STATE.pages.pageBulk || 'enabled',
      pageTimeTable: SETTINGS_STATE.pages.pageTimeTable || 'enabled',
      pageSelector: SETTINGS_STATE.pages.pageSelector || 'enabled',
    };
  } else if (cardKey === 'attendance') {
    var rotSec = parseInt(document.getElementById('att-rotation-time')?.value, 10) || 60;
    return {
      markAttendance: document.getElementById('att-mark') ? document.getElementById('att-mark').checked : true,
      liveSessions: document.getElementById('att-live') ? document.getElementById('att-live').checked : true,
      quickPass: document.getElementById('att-quick-pass') ? document.getElementById('att-quick-pass').checked : true,
      rotationCount: parseInt(document.getElementById('att-rotation-count')?.value, 10) || 2,
      rotationTimeSec: rotSec,
      qrIntervalSec: rotSec,
      forwardToRep: document.getElementById('att-rep') ? document.getElementById('att-rep').checked : true,
      allowAttendanceEdit: document.getElementById('att-edit') ? document.getElementById('att-edit').checked : true,
      forceTimetableSlots: document.getElementById('att-force-timetable') ? document.getElementById('att-force-timetable').checked : false,
      requirePeriodRemark: document.getElementById('att-remark') ? document.getElementById('att-remark').checked : false,
      maxAttendanceBackdateDays: parseInt(document.getElementById('att-backdate')?.value, 10) || 0,
      autoLockAttendanceHours: parseInt(document.getElementById('att-autolock')?.value, 10) || 24,
      defaultAttendanceStatus: document.getElementById('att-default-status')?.value || 'Present',
    };
  } else if (cardKey === 'teachers') {
    return {
      annualLeaveQuota: parseInt(document.getElementById('tch-leave-quota')?.value, 10) || 15,
      casualLeaveAllowance: parseInt(document.getElementById('tch-cl-quota')?.value, 10) || 12,
      medicalLeaveAllowance: parseInt(document.getElementById('tch-ml-quota')?.value, 10) || 10,
      earnedLeaveAllowance: parseInt(document.getElementById('tch-el-quota')?.value, 10) || 15,
      maxConsecutiveLeaveDays: parseInt(document.getElementById('tch-max-consecutive')?.value, 10) || 3,
      medicalDocThresholdDays: parseInt(document.getElementById('tch-med-threshold')?.value, 10) || 3,
      requireSubstitution: document.getElementById('tch-req-sub') ? document.getElementById('tch-req-sub').checked : true,
      allowPeriodLeave: document.getElementById('tch-allow-period') ? document.getElementById('tch-allow-period').checked : true,
      carryForward: document.getElementById('tch-carry-forward') ? document.getElementById('tch-carry-forward').checked : true,
      autoEscalatePrincipal: document.getElementById('tch-auto-escalate') ? document.getElementById('tch-auto-escalate').checked : false,
    };
  } else if (cardKey === 'models') {
    return {
      modelLeave: document.getElementById('mod-leave') ? document.getElementById('mod-leave').checked : true,
      modelGrievances: document.getElementById('mod-griev') ? document.getElementById('mod-griev').checked : true,
      modelExams: document.getElementById('mod-exams') ? document.getElementById('mod-exams').checked : true,
      modelNotifications: document.getElementById('mod-notif') ? document.getElementById('mod-notif').checked : true,
      modelBackup: document.getElementById('mod-backup') ? document.getElementById('mod-backup').checked : true,
      modelUndo: document.getElementById('mod-undo') ? document.getElementById('mod-undo').checked : true,
      modelAddStudent: document.getElementById('mod-addstud') ? document.getElementById('mod-addstud').checked : true,
      modelExportSheet: document.getElementById('mod-export') ? document.getElementById('mod-export').checked : true,
      moduleDelUseAdminPass: document.getElementById('mod-delpass') ? document.getElementById('mod-delpass').checked : true,
      modelSmartBoards: document.getElementById('mod-smartboards') ? document.getElementById('mod-smartboards').checked : true,
    };
  } else if (cardKey === 'security') {
    return {
      forcePasswordChange: document.getElementById('sec-forcepw') ? document.getElementById('sec-forcepw').checked : true,
      requireStrongPassword: document.getElementById('sec-strongpw') ? document.getElementById('sec-strongpw').checked : true,
      sessionTimeout: document.getElementById('sec-timeout') ? document.getElementById('sec-timeout').checked : true,
      allowSubAdminLogs: document.getElementById('sec-subadmin-logs') ? document.getElementById('sec-subadmin-logs').checked : false,
      sessionTimeoutMins: parseInt(document.getElementById('sec-timeout-mins')?.value, 10) || 7,
      maxLoginAttempts: parseInt(document.getElementById('sec-maxlogin')?.value, 10) || 3,
      lockoutDurationMins: parseInt(document.getElementById('sec-lockout-mins')?.value, 10) || 15,
      logRetentionDays: parseInt(document.getElementById('sec-log-retention')?.value, 10) || 0,
      loginLocationRequired: document.getElementById('sec-loc-required') ? document.getElementById('sec-loc-required').checked : true,
      loginLocationAccuracyCheck: document.getElementById('sec-loc-acc-check') ? document.getElementById('sec-loc-acc-check').checked : true,
      loginLocationMaxAccuracyM: document.getElementById('sec-loc-max-acc')?.value !== '' ? (parseInt(document.getElementById('sec-loc-max-acc')?.value, 10) ?? 2000) : 2000,
      loginLocationMaxAgeSec: parseInt(document.getElementById('sec-loc-max-age')?.value, 10) || 300
    };
  } else if (cardKey === 'device') {
    return {
      requireRegisteredDevice: document.getElementById('dev-req-bound') ? document.getElementById('dev-req-bound').checked : true,
      studentSessionDays: parseInt(document.getElementById('dev-session-days')?.value, 10) || 15,
      credentialTtlMin: parseInt(document.getElementById('dev-cred-ttl')?.value, 10) || 10,
      credentialMaxAttempts: parseInt(document.getElementById('dev-cred-attempts')?.value, 10) || 5,
      verifyCodeTtlMin: parseInt(document.getElementById('dev-code-ttl')?.value, 10) || 5,
      verifyCodeMaxAttempts: parseInt(document.getElementById('dev-code-attempts')?.value, 10) || 3,
      replacementRequestsPerDay: parseInt(document.getElementById('dev-rep-limit')?.value, 10) || 3
    };
  } else if (cardKey === 'trust') {
    return {
      enabled: document.getElementById('trust-enabled') ? document.getElementById('trust-enabled').checked : true,
      startScore: parseInt(document.getElementById('trust-start-score')?.value, 10) || 100,
      bands: {
        normal: parseInt(document.getElementById('trust-band-normal')?.value, 10) || 80,
        monitor: parseInt(document.getElementById('trust-band-monitor')?.value, 10) || 60,
        verify: parseInt(document.getElementById('trust-band-verify')?.value, 10) || 40
      },
      uninformedAbsencePenalty: parseInt(document.getElementById('trust-uninformed-pen')?.value, 10) || 4,
      frequentAbsenceThreshold: parseInt(document.getElementById('trust-freq-thresh')?.value, 10) || 6,
      frequentAbsencePenalty: parseInt(document.getElementById('trust-freq-pen')?.value, 10) || 2,
      countApprovedLeaveInFrequency: document.getElementById('trust-leave-freq') ? document.getElementById('trust-leave-freq').checked : false,
      teacherDeniedPenalty: parseInt(document.getElementById('trust-denied-pen')?.value, 10) || 40,
      teacherDeniedLockDays: parseInt(document.getElementById('trust-denied-lock')?.value, 10) || 2,
      deviceShareAbsentDays: parseInt(document.getElementById('trust-share-absent')?.value, 10) || 7,
      deviceShareLockDays: parseInt(document.getElementById('trust-share-lock')?.value, 10) || 15,
      deviceShareAttendancePenaltyPct: parseInt(document.getElementById('trust-share-pct')?.value, 10) || 5,
      disputeWindowDays: parseInt(document.getElementById('trust-dispute-days')?.value, 10) || 7,
      disputeBonusPct: parseInt(document.getElementById('trust-dispute-bonus')?.value, 10) || 2,
      deviceWeights: {
        key: parseInt(document.getElementById('trust-wt-key')?.value, 10) || 25,
        match: parseInt(document.getElementById('trust-wt-match')?.value, 10) || 10,
        location: parseInt(document.getElementById('trust-wt-loc')?.value, 10) || 10,
        campusIp: parseInt(document.getElementById('trust-wt-ip')?.value, 10) || 5,
        spoofPenalty: parseInt(document.getElementById('trust-wt-spoof')?.value, 10) || 10
      }
    };
  } else if (cardKey === 'academic') {
    var regMinMap = {};
    document.querySelectorAll('.reg-minatt-input').forEach(function(inp) {
      var code = inp.getAttribute('data-reg-code');
      if (code) {
        regMinMap[code] = parseInt(inp.value, 10) || 75;
      }
    });

    return {
      academicYear: (document.getElementById('acad-year')?.value || '2026-2027').trim(),
      currentSemesterType: document.getElementById('acad-semtype')?.value || 'Odd',
      minAttendance: parseInt(document.getElementById('acad-minatt')?.value, 10) || 75,
      lowAttendanceThreshold: parseInt(document.getElementById('acad-lowatt')?.value, 10) || 65,
      workingDays: parseInt(document.getElementById('acad-workdays')?.value, 10) || 6,
      periodsPerDay: parseInt(document.getElementById('acad-periods')?.value, 10) || 7,
      regulationMinAttendance: regMinMap,
    };
  } else if (cardKey === 'broadcast') {
    return {
      defaultPopupDurationSec: parseInt(document.getElementById('bcast-duration')?.value, 10) || 10,
      autoExpireHours: parseInt(document.getElementById('bcast-expire')?.value, 10) || 24,
      allowTeacherBroadcasts: document.getElementById('bcast-teacher-allow') ? document.getElementById('bcast-teacher-allow').checked : false,
    };
  } else if (cardKey === 'advanced') {
    return {
      debugMode: document.getElementById('adv-debug') ? document.getElementById('adv-debug').checked : false,
      multiAdminSession: document.getElementById('adv-multisess') ? document.getElementById('adv-multisess').checked : true,
      autoSeedDemoData: document.getElementById('adv-seed') ? document.getElementById('adv-seed').checked : false,
      errorsCount: parseInt(document.getElementById('adv-errors-count')?.value, 10) || 20,
    };
  }
  return {};
}

function recordBaselineSnapshot(cardKey) {
  if (typeof BASELINE_SNAPSHOT !== 'object' || BASELINE_SNAPSHOT === null) {
    BASELINE_SNAPSHOT = {};
    window.BASELINE_SNAPSHOT = BASELINE_SNAPSHOT;
  }
  try {
    if (cardKey) {
      BASELINE_SNAPSHOT[cardKey] = JSON.stringify(getCardValues(cardKey));
    } else {
      ALL_SETTING_CARDS.forEach(function (c) {
        BASELINE_SNAPSHOT[c] = JSON.stringify(getCardValues(c));
      });
    }
  } catch (err) {
    console.warn('[recordBaselineSnapshot Warning]:', err);
  }
}

function getDirtyCards() {
  if (typeof BASELINE_SNAPSHOT !== 'object' || BASELINE_SNAPSHOT === null) {
    BASELINE_SNAPSHOT = {};
    window.BASELINE_SNAPSHOT = BASELINE_SNAPSHOT;
    return [];
  }
  var dirty = [];
  ALL_SETTING_CARDS.forEach(function (card) {
    if (!BASELINE_SNAPSHOT[card]) return;
    try {
      var current = JSON.stringify(getCardValues(card));
      if (current !== BASELINE_SNAPSHOT[card]) {
        dirty.push(card);
      }
    } catch (e) {
      console.warn('[getDirtyCards Warning on ' + card + ']:', e);
    }
  });
  return dirty;
}

function checkDirtyState() {
  var dirtyCards = getDirtyCards();
  dirtyState = dirtyCards.length > 0;
  var bar = document.getElementById('save-bar');
  if (bar) {
    if (dirtyState && currentTab !== 'history') {
      bar.classList.add('show');
    } else {
      bar.classList.remove('show');
    }
  }
}

function markDirty(dirty) {
  dirtyState = !!dirty;
  var bar = document.getElementById('save-bar');
  if (bar) {
    if (dirtyState && currentTab !== 'history') bar.classList.add('show');
    else bar.classList.remove('show');
  }
  if (!dirty) {
    recordBaselineSnapshot();
  }
  checkDirtyState();
}

// Load All Settings from MongoDB
function loadAllSettings() {
  setSettingStatus('loading', 'Loading');
  return apiCall('GET', '/settings')
    .then(function (data) {
      if (!data || data.error) {
        setSettingStatus('error', 'Error');
        showToast('Could not load settings from server');
        return;
      }

      // 1. Institution
      var inst = data.institution || {};
      setVal('inst-name', inst.institutionName || '');
      setVal('inst-short', inst.institutionShort || '');
      setVal('inst-tagline', inst.institutionTagline || '');
      setVal('inst-addr', inst.institutionAddress || '');
      setVal('inst-email', inst.institutionEmail || '');
      setVal('inst-phone', inst.institutionPhone || '');
      setVal('inst-web', inst.institutionWebsite || '');

      // 2. Pages (Tri-State)
      var pages = data.pages || {};
      applyTriStateUI('pageStudents', pages.pageStudents || 'enabled');
      applyTriStateUI('pageTeachers', pages.pageTeachers || 'enabled');
      applyTriStateUI('pageController', pages.pageController || 'enabled');
      applyTriStateUI('pageRooms', pages.pageRooms || 'enabled');
      applyTriStateUI('pageManage', pages.pageManage || 'enabled');
      applyTriStateUI('pageBulk', pages.pageBulk || 'enabled');
      applyTriStateUI('pageTimeTable', pages.pageTimeTable || 'enabled');
      applyTriStateUI('pageSelector', pages.pageSelector || 'enabled');

      // 3. Attendance
      var att = data.attendance || {};
      setChk('att-mark', att.markAttendance !== false);
      setChk('att-live', att.liveSessions !== false);
      setChk('att-quick-pass', att.quickPass !== false);
      setChk('att-rep', att.forwardToRep !== false);
      setChk('att-edit', att.allowAttendanceEdit !== false);
      setChk('att-force-timetable', !!att.forceTimetableSlots);
      setChk('att-remark', !!att.requirePeriodRemark);
      setVal('att-backdate', att.maxAttendanceBackdateDays !== undefined ? att.maxAttendanceBackdateDays : 3);
      setVal('att-autolock', att.autoLockAttendanceHours !== undefined ? att.autoLockAttendanceHours : 24);
      setVal('att-rotation-count', att.rotationCount !== undefined ? att.rotationCount : 2);
      var rotTime = att.rotationTimeSec !== undefined ? att.rotationTimeSec : (att.qrIntervalSec !== undefined ? att.qrIntervalSec : 60);
      setVal('att-rotation-time', rotTime);
      setVal('att-qr-interval', rotTime);
      setVal('att-default-status', att.defaultAttendanceStatus || 'Present');

      // Teachers Management
      var tch = data.teachers || {};
      setVal('tch-leave-quota', tch.annualLeaveQuota !== undefined ? tch.annualLeaveQuota : 15);
      setVal('tch-cl-quota', tch.casualLeaveAllowance !== undefined ? tch.casualLeaveAllowance : 12);
      setVal('tch-ml-quota', tch.medicalLeaveAllowance !== undefined ? tch.medicalLeaveAllowance : 10);
      setVal('tch-el-quota', tch.earnedLeaveAllowance !== undefined ? tch.earnedLeaveAllowance : 15);
      setVal('tch-max-consecutive', tch.maxConsecutiveLeaveDays !== undefined ? tch.maxConsecutiveLeaveDays : 3);
      setVal('tch-med-threshold', tch.medicalDocThresholdDays !== undefined ? tch.medicalDocThresholdDays : 3);
      setChk('tch-req-sub', tch.requireSubstitution !== false);
      setChk('tch-allow-period', tch.allowPeriodLeave !== false);
      setChk('tch-carry-forward', tch.carryForward !== false);
      setChk('tch-auto-escalate', !!tch.autoEscalatePrincipal);

      // 4. Models
      var mod = data.models || {};
      setChk('mod-leave', mod.modelLeave !== false);
      setChk('mod-griev', mod.modelGrievances !== false);
      setChk('mod-exams', mod.modelExams !== false);
      setChk('mod-notif', mod.modelNotifications !== false);
      setChk('mod-backup', mod.modelBackup !== false);
      setChk('mod-undo', mod.modelUndo !== false);
      setChk('mod-addstud', mod.modelAddStudent !== false);
      setChk('mod-export', mod.modelExportSheet !== false);
      setChk('mod-delpass', mod.moduleDelUseAdminPass !== false);
      setChk('mod-smartboards', mod.modelSmartBoards !== false);

      // 5. Security
      var sec = data.security || {};
      setChk('sec-forcepw', sec.forcePasswordChange !== false);
      setChk('sec-strongpw', sec.requireStrongPassword !== false);
      setChk('sec-timeout', sec.sessionTimeout !== false);
      setChk('sec-subadmin-logs', !!sec.allowSubAdminLogs);
      setVal('sec-timeout-mins', sec.sessionTimeoutMins !== undefined ? sec.sessionTimeoutMins : 7);
      setVal('sec-maxlogin', sec.maxLoginAttempts || 3);
      setVal('sec-lockout-mins', sec.lockoutDurationMins || 15);
      setVal('sec-log-retention', sec.logRetentionDays || 0);
      setChk('sec-loc-required', sec.loginLocationRequired !== false);
      setChk('sec-loc-acc-check', sec.loginLocationAccuracyCheck !== false);
      setVal('sec-loc-max-acc', sec.loginLocationMaxAccuracyM !== undefined ? sec.loginLocationMaxAccuracyM : 2000);
      setVal('sec-loc-max-age', sec.loginLocationMaxAgeSec !== undefined ? sec.loginLocationMaxAgeSec : 300);

      // 5b. Device Registration & Sessions (§15)
      var dev = data.device || {};
      setChk('dev-req-bound', dev.requireRegisteredDevice !== false);
      setVal('dev-session-days', dev.studentSessionDays || 15);
      setVal('dev-cred-ttl', dev.credentialTtlMin || 10);
      setVal('dev-cred-attempts', dev.credentialMaxAttempts || 5);
      setVal('dev-code-ttl', dev.verifyCodeTtlMin || 5);
      setVal('dev-code-attempts', dev.verifyCodeMaxAttempts || 3);
      setVal('dev-rep-limit', dev.replacementRequestsPerDay || 3);

      // 5c. Trust Score Engine (§15)
      var tr = data.trust || {};
      setChk('trust-enabled', tr.enabled !== false);
      setVal('trust-start-score', tr.startScore || 100);
      setVal('trust-band-normal', tr.bands?.normal || 80);
      setVal('trust-band-monitor', tr.bands?.monitor || 60);
      setVal('trust-band-verify', tr.bands?.verify || 40);
      setVal('trust-uninformed-pen', tr.uninformedAbsencePenalty || 4);
      setVal('trust-freq-thresh', tr.frequentAbsenceThreshold || 6);
      setVal('trust-freq-pen', tr.frequentAbsencePenalty || 2);
      setChk('trust-leave-freq', !!tr.countApprovedLeaveInFrequency);
      setVal('trust-denied-pen', tr.teacherDeniedPenalty || 40);
      setVal('trust-denied-lock', tr.teacherDeniedLockDays || 2);
      setVal('trust-share-absent', tr.deviceShareAbsentDays || 7);
      setVal('trust-share-lock', tr.deviceShareLockDays || 15);
      setVal('trust-share-pct', tr.deviceShareAttendancePenaltyPct || 5);
      setVal('trust-dispute-days', tr.disputeWindowDays || 7);
      setVal('trust-dispute-bonus', tr.disputeBonusPct || 2);
      setVal('trust-wt-key', tr.deviceWeights?.key || 25);
      setVal('trust-wt-match', tr.deviceWeights?.match || 10);
      setVal('trust-wt-loc', tr.deviceWeights?.location || 10);
      setVal('trust-wt-ip', tr.deviceWeights?.campusIp || 5);
      setVal('trust-wt-spoof', tr.deviceWeights?.spoofPenalty || 10);

      // 6. Academic
      var acad = data.academic || {};
      setVal('acad-year', acad.academicYear || '2026-2027');
      setVal('acad-semtype', acad.currentSemesterType || 'Odd');
      var globalMin = acad.minAttendance !== undefined ? acad.minAttendance : 75;
      setVal('acad-minatt', globalMin);
      setVal('acad-lowatt', acad.lowAttendanceThreshold !== undefined ? acad.lowAttendanceThreshold : 65);
      setVal('acad-workdays', acad.workingDays !== undefined ? acad.workingDays : 6);
      setVal('acad-periods', acad.periodsPerDay !== undefined ? acad.periodsPerDay : 7);

      var badge = document.getElementById('acad-global-min-badge');
      if (badge) badge.textContent = globalMin + '%';

      renderRegulationMinAttInputs(acad.regulationsList || [], acad.regulationMinAttendance || {});

      // 7. Broadcast Settings
      var bcast = data.broadcast || {};
      setVal('bcast-duration', bcast.defaultPopupDurationSec || 10);
      setVal('bcast-expire', bcast.autoExpireHours || 24);
      setChk('bcast-teacher-allow', !!bcast.allowTeacherBroadcasts);

      // 8. Advanced
      var adv = data.advanced || {};
      setChk('adv-debug', !!adv.debugMode);
      setChk('adv-multisess', adv.multiAdminSession !== false);
      setChk('adv-seed', !!adv.autoSeedDemoData);
      setVal('adv-errors-count', adv.errorsCount || 20);

      recordBaselineSnapshot();
      setSettingStatus('saved', 'Saved');
      checkDirtyState();
    })
    .catch(function (err) {
      setSettingStatus('error', 'Error');
      showToast('Network error loading settings: ' + (err.message || ''));
    });
}

function setVal(id, v) {
  var el = document.getElementById(id);
  if (el && v !== undefined && v !== null) {
    el.value = v;
    if (String(v).trim() !== '') el.removeAttribute('placeholder');
  }
}

function setChk(id, v) {
  var el = document.getElementById(id);
  if (el && v !== undefined) {
    el.checked = !!v;
    el.removeAttribute('placeholder');
  }
}

// ── Card Element Mapper & Restoration ──
function getCardKeyForElement(el) {
  if (!el) return null;
  var id = el.id || '';
  if (id.startsWith('dev-')) return 'device';
  if (id.startsWith('trust-')) return 'trust';
  if (id.startsWith('inst-')) return 'institution';
  if (id.startsWith('att-')) return 'attendance';
  if (id.startsWith('tch-')) return 'teachers';
  if (id.startsWith('mod-')) return 'models';
  if (id.startsWith('sec-')) return 'security';
  if (id.startsWith('acad-') || el.classList.contains('reg-minatt-input')) return 'academic';
  if (id.startsWith('bcast-')) return 'broadcast';
  if (id.startsWith('adv-')) return 'advanced';

  var pg = el.closest('.pg');
  if (pg && pg.id) {
    var raw = pg.id.replace('pg-', '');
    if (raw === 'trust') {
      return id.startsWith('dev-') ? 'device' : 'trust';
    }
    return raw;
  }
  return null;
}
window.getCardKeyForElement = getCardKeyForElement;

function restoreCardValues(cardKey, snapshot) {
  if (!snapshot) return;
  var d;
  try {
    d = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
  } catch (err) {
    console.warn('[restoreCardValues Parse Error]:', err);
    return;
  }
  if (!d) return;

  if (cardKey === 'institution') {
    setVal('inst-name', d.institutionName || '');
    setVal('inst-short', d.institutionShort || '');
    setVal('inst-tagline', d.institutionTagline || '');
    setVal('inst-addr', d.institutionAddress || '');
    setVal('inst-email', d.institutionEmail || '');
    setVal('inst-phone', d.institutionPhone || '');
    setVal('inst-web', d.institutionWebsite || '');
  } else if (cardKey === 'pages') {
    applyTriStateUI('pageStudents', d.pageStudents || 'enabled');
    applyTriStateUI('pageTeachers', d.pageTeachers || 'enabled');
    applyTriStateUI('pageController', d.pageController || 'enabled');
    applyTriStateUI('pageRooms', d.pageRooms || 'enabled');
    applyTriStateUI('pageManage', d.pageManage || 'enabled');
    applyTriStateUI('pageBulk', d.pageBulk || 'enabled');
    applyTriStateUI('pageTimeTable', d.pageTimeTable || 'enabled');
    applyTriStateUI('pageSelector', d.pageSelector || 'enabled');
  } else if (cardKey === 'attendance') {
    setChk('att-mark', d.markAttendance !== false);
    setChk('att-live', d.liveSessions !== false);
    setChk('att-quick-pass', d.quickPass !== false);
    setChk('att-rep', d.forwardToRep !== false);
    setChk('att-edit', d.allowAttendanceEdit !== false);
    setChk('att-force-timetable', !!d.forceTimetableSlots);
    setChk('att-remark', !!d.requirePeriodRemark);
    setVal('att-backdate', d.maxAttendanceBackdateDays !== undefined ? d.maxAttendanceBackdateDays : 3);
    setVal('att-autolock', d.autoLockAttendanceHours !== undefined ? d.autoLockAttendanceHours : 24);
    setVal('att-rotation-count', d.rotationCount !== undefined ? d.rotationCount : 2);
    var rot = d.rotationTimeSec !== undefined ? d.rotationTimeSec : (d.qrIntervalSec !== undefined ? d.qrIntervalSec : 60);
    setVal('att-rotation-time', rot);
    setVal('att-qr-interval', rot);
    setVal('att-default-status', d.defaultAttendanceStatus || 'Present');
  } else if (cardKey === 'teachers') {
    setVal('tch-leave-quota', d.annualLeaveQuota !== undefined ? d.annualLeaveQuota : 15);
    setVal('tch-cl-quota', d.casualLeaveAllowance !== undefined ? d.casualLeaveAllowance : 12);
    setVal('tch-ml-quota', d.medicalLeaveAllowance !== undefined ? d.medicalLeaveAllowance : 10);
    setVal('tch-el-quota', d.earnedLeaveAllowance !== undefined ? d.earnedLeaveAllowance : 15);
    setVal('tch-max-consecutive', d.maxConsecutiveLeaveDays !== undefined ? d.maxConsecutiveLeaveDays : 3);
    setVal('tch-med-threshold', d.medicalDocThresholdDays !== undefined ? d.medicalDocThresholdDays : 3);
    setChk('tch-req-sub', d.requireSubstitution !== false);
    setChk('tch-allow-period', d.allowPeriodLeave !== false);
    setChk('tch-carry-forward', d.carryForward !== false);
    setChk('tch-auto-escalate', !!d.autoEscalatePrincipal);
  } else if (cardKey === 'models') {
    setChk('mod-leave', d.modelLeave !== false);
    setChk('mod-griev', d.modelGrievances !== false);
    setChk('mod-exams', d.modelExams !== false);
    setChk('mod-notif', d.modelNotifications !== false);
    setChk('mod-backup', d.modelBackup !== false);
    setChk('mod-undo', d.modelUndo !== false);
    setChk('mod-addstud', d.modelAddStudent !== false);
    setChk('mod-export', d.modelExportSheet !== false);
    setChk('mod-delpass', d.moduleDelUseAdminPass !== false);
    setChk('mod-smartboards', d.modelSmartBoards !== false);
  } else if (cardKey === 'security') {
    setChk('sec-forcepw', d.forcePasswordChange !== false);
    setChk('sec-strongpw', d.requireStrongPassword !== false);
    setChk('sec-timeout', d.sessionTimeout !== false);
    setChk('sec-subadmin-logs', !!d.allowSubAdminLogs);
    setVal('sec-timeout-mins', d.sessionTimeoutMins !== undefined ? d.sessionTimeoutMins : 7);
    setVal('sec-maxlogin', d.maxLoginAttempts || 3);
    setVal('sec-lockout-mins', d.lockoutDurationMins || 15);
    setVal('sec-log-retention', d.logRetentionDays || 0);
    setChk('sec-loc-required', d.loginLocationRequired !== false);
    setChk('sec-loc-acc-check', d.loginLocationAccuracyCheck !== false);
    setVal('sec-loc-max-acc', d.loginLocationMaxAccuracyM !== undefined ? d.loginLocationMaxAccuracyM : 2000);
    setVal('sec-loc-max-age', d.loginLocationMaxAgeSec !== undefined ? d.loginLocationMaxAgeSec : 300);
  } else if (cardKey === 'device') {
    setChk('dev-req-bound', d.requireRegisteredDevice !== false);
    setVal('dev-session-days', d.studentSessionDays || 15);
    setVal('dev-cred-ttl', d.credentialTtlMin || 10);
    setVal('dev-cred-attempts', d.credentialMaxAttempts || 5);
    setVal('dev-code-ttl', d.verifyCodeTtlMin || 5);
    setVal('dev-code-attempts', d.verifyCodeMaxAttempts || 3);
    setVal('dev-rep-limit', d.replacementRequestsPerDay || 3);
  } else if (cardKey === 'trust') {
    setChk('trust-enabled', d.enabled !== false);
    setVal('trust-start-score', d.startScore || 100);
    if (d.bands) {
      setVal('trust-band-normal', d.bands.normal || 80);
      setVal('trust-band-monitor', d.bands.monitor || 60);
      setVal('trust-band-verify', d.bands.verify || 40);
    }
    setVal('trust-uninformed-pen', d.uninformedAbsencePenalty || 4);
    setVal('trust-freq-thresh', d.frequentAbsenceThreshold || 6);
    setVal('trust-freq-pen', d.frequentAbsencePenalty || 2);
    setChk('trust-leave-freq', !!d.countApprovedLeaveInFrequency);
    setVal('trust-denied-pen', d.teacherDeniedPenalty || 40);
    setVal('trust-denied-lock', d.teacherDeniedLockDays || 2);
    setVal('trust-share-absent', d.deviceShareAbsentDays || 7);
    setVal('trust-share-lock', d.deviceShareLockDays || 15);
    setVal('trust-share-pct', d.deviceShareAttendancePenaltyPct || 5);
    setVal('trust-dispute-days', d.disputeWindowDays || 7);
    setVal('trust-dispute-bonus', d.disputeBonusPct || 2);
    if (d.deviceWeights) {
      setVal('trust-wt-key', d.deviceWeights.key || 25);
      setVal('trust-wt-match', d.deviceWeights.match || 10);
      setVal('trust-wt-loc', d.deviceWeights.location || 10);
      setVal('trust-wt-ip', d.deviceWeights.campusIp || 5);
      setVal('trust-wt-spoof', d.deviceWeights.spoofPenalty || 10);
    }
  } else if (cardKey === 'academic') {
    setVal('acad-year', d.academicYear || '2026-2027');
    setVal('acad-semtype', d.currentSemesterType || 'Odd');
    setVal('acad-minatt', d.minAttendance || 75);
    setVal('acad-lowatt', d.lowAttendanceThreshold || 65);
    setVal('acad-workdays', d.workingDays || 6);
    setVal('acad-periods', d.periodsPerDay || 7);
    if (d.regulationMinAttendance) {
      document.querySelectorAll('.reg-minatt-input').forEach(function (inp) {
        var code = inp.getAttribute('data-reg-code');
        if (code && d.regulationMinAttendance[code] !== undefined) {
          inp.value = d.regulationMinAttendance[code];
        }
      });
    }
  } else if (cardKey === 'broadcast') {
    setVal('bcast-duration', d.defaultPopupDurationSec || 10);
    setVal('bcast-expire', d.autoExpireHours || 24);
    setChk('bcast-teacher-allow', !!d.allowTeacherBroadcasts);
  } else if (cardKey === 'advanced') {
    setChk('adv-debug', !!d.debugMode);
    setChk('adv-multisess', d.multiAdminSession !== false);
    setChk('adv-seed', !!d.autoSeedDemoData);
    setVal('adv-errors-count', d.errorsCount || 20);
  }
}
window.restoreCardValues = restoreCardValues;

// ── Auto-Save Coordinator with 5-Second ActionToast Undo ──
var pendingAutoSaveCards = new Set();
var autoSaveBaselineBeforeChange = {};
var autoSaveInputDebounceTimer = null;
var isAutoSaving = false;

function triggerAutoSaveForCard(cardKey, fieldName) {
  if (!cardKey) return;

  var currentValStr = JSON.stringify(getCardValues(cardKey));
  var baseValStr = BASELINE_SNAPSHOT[cardKey];
  if (baseValStr && currentValStr === baseValStr && !pendingAutoSaveCards.has(cardKey)) {
    return;
  }

  // Freeze baseline snapshot before uncommitted change
  if (!pendingAutoSaveCards.has(cardKey)) {
    autoSaveBaselineBeforeChange[cardKey] = baseValStr || currentValStr;
    pendingAutoSaveCards.add(cardKey);
  }

  // Update status immediately to Saving
  setSettingStatus('saving', 'Saving');

  var cardTitle = cardKey.charAt(0).toUpperCase() + cardKey.slice(1);
  var msg = fieldName
    ? (fieldName + ' changed. Auto-saving in 5s...')
    : (cardTitle + ' settings changed. Auto-saving in 5s...');

  if (typeof actionToast === 'function') {
    actionToast({
      title: 'Saving Settings',
      message: msg,
      duration: 5,
      confirmText: 'Undo',
      onConfirm: function () {
        commitAutoSave();
      },
      onCancel: function () {
        revertAutoSave();
      }
    });
  } else {
    setTimeout(commitAutoSave, 5000);
  }
}
window.triggerAutoSaveForCard = triggerAutoSaveForCard;

function commitAutoSave() {
  if (pendingAutoSaveCards.size === 0) {
    setSettingStatus('saved', 'Saved');
    return;
  }
  isAutoSaving = true;
  setSettingStatus('saving', 'Saving');
  var cardsToSave = Array.from(pendingAutoSaveCards);
  pendingAutoSaveCards.clear();
  autoSaveBaselineBeforeChange = {};

  var promises = cardsToSave.map(function (c) {
    var payload = getCardValues(c);
    return apiCall('PUT', '/settings/' + c, { value: payload })
      .then(function (res) {
        if (res && res.error) throw new Error(res.error);
        recordBaselineSnapshot(c);
        return true;
      });
  });

  Promise.all(promises)
    .then(function () {
      isAutoSaving = false;
      setSettingStatus('saved', 'Saved');
      checkDirtyState();
    })
    .catch(function (err) {
      isAutoSaving = false;
      console.error('[commitAutoSave Error]:', err);
      setSettingStatus('error', 'Error');
      if (typeof showToast === 'function') {
        showToast('Error saving settings: ' + (err.message || ''));
      }
    });
}
window.commitAutoSave = commitAutoSave;

function revertAutoSave() {
  var cardsToRevert = Array.from(pendingAutoSaveCards);
  pendingAutoSaveCards.clear();

  cardsToRevert.forEach(function (c) {
    var snap = autoSaveBaselineBeforeChange[c] || BASELINE_SNAPSHOT[c];
    if (snap) {
      restoreCardValues(c, snap);
    }
  });
  autoSaveBaselineBeforeChange = {};
  setSettingStatus('saved', 'Saved');
  if (typeof showToast === 'function') {
    showToast('Changes undone');
  }
  checkDirtyState();
}
window.revertAutoSave = revertAutoSave;

// Save Card Payload (kept for programmatic compatibility)
function saveCard(cardKey, opts) {
  if (!cardKey) return Promise.resolve(false);
  var isSilent = opts && opts.silent;
  var payload;
  try {
    payload = getCardValues(cardKey);
  } catch (err) {
    if (!isSilent && typeof dbToast === 'function') dbToast('Save failed', 'error', err.message || 'Error extracting ' + cardKey + ' values');
    return Promise.resolve(false);
  }
  var cardTitle = cardKey.charAt(0).toUpperCase() + cardKey.slice(1);

  if (!isSilent && typeof dbToast === 'function') dbToast('Saving ' + cardTitle + ' to Database...', 'saving');
  setSettingStatus('saving', 'Saving');

  return apiCall('PUT', '/settings/' + cardKey, { value: payload })
    .then(function (res) {
      if (res && res.error) {
        setSettingStatus('error', 'Error');
        if (!isSilent && typeof dbToast === 'function') dbToast('Save failed', 'error', res.error);
        return false;
      }
      setSettingStatus('saved', 'Saved');
      if (!isSilent && typeof dbToast === 'function') dbToast('Settings saved', 'success', cardTitle + ' settings saved & audited');
      if (cardKey === 'security') {
        try {
          sessionStorage.setItem('eams_session_timeout', payload.sessionTimeout !== false ? 'true' : 'false');
          sessionStorage.setItem('eams_session_timeout_mins', String(payload.sessionTimeoutMins || 7));
        } catch(e) {}
      }
      try {
        recordBaselineSnapshot(cardKey);
        checkDirtyState();
      } catch (snapErr) {
        console.warn('[Snapshot Warning]:', snapErr);
      }
      return true;
    })
    .catch(function (err) {
      setSettingStatus('error', 'Error');
      if (!isSilent && typeof dbToast === 'function') dbToast('Save failed', 'error', err.message || 'Failed to save ' + cardTitle + ' settings');
      return false;
    });
}

function saveCurrentTab() {
  var dirty = getDirtyCards();
  if (dirty.length === 0) {
    if (currentTab === 'trust') {
      saveCard('device');
      saveCard('trust');
    } else if (currentTab !== 'history') {
      saveCard(currentTab);
    }
    return;
  }
  setSettingStatus('saving', 'Saving');
  var promises = dirty.map(function (c) { return saveCard(c, { silent: true }); });
  Promise.all(promises).then(function (results) {
    var allSuccess = results.every(function (r) { return r === true; });
    if (allSuccess) {
      setSettingStatus('saved', 'Saved');
      if (typeof dbToast === 'function') dbToast('All settings saved', 'success', dirty.length + ' configuration card(s) saved & audited');
    } else {
      setSettingStatus('error', 'Error');
      if (typeof dbToast === 'function') dbToast('Partial save completed', 'warn', 'Some settings may not have saved cleanly');
    }
    checkDirtyState();
  }).catch(function (err) {
    setSettingStatus('error', 'Error');
    if (typeof dbToast === 'function') dbToast('Save failed', 'error', err.message || 'Network error saving settings');
  });
}

function discardChanges() {
  loadAllSettings().then(function () {
    if (typeof dbToast === 'function') dbToast('Changes discarded', 'info');
  });
}

// Dirty Form Tracker & Auto-Save Listener
function trackDirtyInputs() {
  function isIgnored(id) {
    return id === 'hist-search' || id === 'hist-card-filter' ||
      id === 'pw-cur' || id === 'pw-new' || id === 'pw-conf' ||
      id === 'reset-admin-pw';
  }

  function getFieldLabel(target) {
    if (!target) return '';
    var formGroup = target.closest('.form-group') || target.closest('.toggle-row');
    if (formGroup) {
      var labelEl = formGroup.querySelector('.form-label') || formGroup.querySelector('.toggle-label');
      if (labelEl) {
        var clone = labelEl.cloneNode(true);
        clone.querySelectorAll('.key-label').forEach(function (k) { k.remove(); });
        var txt = clone.textContent.replace(/\s+/g, ' ').trim();
        if (txt) return txt;
      }
    }
    return target.id || '';
  }

  // Handle immediate changes (toggles, selects, and text blur)
  document.addEventListener('change', function (e) {
    if (!e || !e.target) return;
    if (isIgnored(e.target.id)) return;
    if (!e.target.closest('.mc')) return;

    var card = getCardKeyForElement(e.target);
    if (card) {
      triggerAutoSaveForCard(card, getFieldLabel(e.target));
    }
    checkDirtyState();
  });

  // Handle debounced typing for text and number inputs
  document.addEventListener('input', function (e) {
    if (!e || !e.target) return;
    if (isIgnored(e.target.id)) return;
    if (!e.target.closest('.mc')) return;
    if (e.target.type === 'checkbox' || e.target.type === 'radio' || e.target.tagName === 'SELECT') return;

    var card = getCardKeyForElement(e.target);
    if (!card) return;

    clearTimeout(autoSaveInputDebounceTimer);
    autoSaveInputDebounceTimer = setTimeout(function () {
      triggerAutoSaveForCard(card, getFieldLabel(e.target));
    }, 500);
    checkDirtyState();
  });
}

// Flush uncommitted saves if user navigates away
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', function () {
    if (pendingAutoSaveCards && pendingAutoSaveCards.size > 0) {
      if (typeof window._activeActionToastDismiss === 'function') {
        window._activeActionToastDismiss(true);
      }
    }
  });
}


// Change History & Audit Logs
function debounceHistorySearch() {
  clearTimeout(historySearchDebounce);
  historySearchDebounce = setTimeout(function () {
    loadHistory(1);
  }, 350);
}

function resetHistoryFilters() {
  var cardFilter = document.getElementById('hist-card-filter');
  var dateFilter = document.getElementById('hist-date-filter');
  var search = document.getElementById('hist-search');
  if (cardFilter) cardFilter.value = 'all';
  if (dateFilter) dateFilter.value = '';
  if (search) search.value = '';
  loadHistory(1);
}

function formatHistoryDateHeader(dateObj) {
  var now = new Date();
  var todayKey = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var yesterdayKey = todayKey - 86400000;
  var targetKey = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()).getTime();

  var dateFormatted = dateObj.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  if (targetKey === todayKey) {
    return {
      primary: 'Today',
      secondary: '· ' + dateFormatted
    };
  } else if (targetKey === yesterdayKey) {
    return {
      primary: 'Yesterday',
      secondary: '· ' + dateFormatted
    };
  } else {
    return {
      primary: dateFormatted,
      secondary: ''
    };
  }
}

function groupHistoryByDate(logs) {
  var groupsMap = new Map();
  logs.forEach(function (item) {
    var d = new Date(item.timestamp);
    if (isNaN(d.getTime())) d = new Date();
    var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        date: d,
        items: []
      });
    }
    groupsMap.get(key).items.push(item);
  });
  return Array.from(groupsMap.values());
}

function loadHistory(page) {
  currentHistoryPage = page || 1;
  var container = document.getElementById('history-list-container');
  var cardFilterEl = document.getElementById('hist-card-filter');
  var dateFilterEl = document.getElementById('hist-date-filter');
  var searchEl = document.getElementById('hist-search');
  var resetBtn = document.getElementById('hist-reset-filters-btn');

  var cardFilter = cardFilterEl ? cardFilterEl.value : 'all';
  var dateFilter = dateFilterEl ? dateFilterEl.value.trim() : '';
  var search = searchEl ? searchEl.value.trim() : '';

  var hasFilter = (cardFilter && cardFilter !== 'all') || Boolean(dateFilter) || Boolean(search);
  if (resetBtn) resetBtn.style.display = hasFilter ? 'inline-flex' : 'none';

  if (container) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--tmu);"><re-icon icon="hourglass"></re-icon> Fetching audit records from Database...</div>';
  }

  var qs = '?page=' + currentHistoryPage + '&limit=50';
  if (cardFilter && cardFilter !== 'all') qs += '&card=' + encodeURIComponent(cardFilter);
  if (dateFilter) qs += '&date=' + encodeURIComponent(dateFilter);
  if (search) qs += '&search=' + encodeURIComponent(search);

  apiCall('GET', '/settings/history' + qs)
    .then(function (data) {
      if (!data || !data.logs || data.logs.length === 0) {
        if (container) {
          container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tdi);font-size:13px;"><re-icon icon="inbox"></re-icon> No setting change records found matching your filter.</div>';
        }
        updatePagination(0, 1);
        return;
      }

      var dateGroups = groupHistoryByDate(data.logs);
      var html = dateGroups.map(function (grp) {
        var headerInfo = formatHistoryDateHeader(grp.date);
        var countLabel = grp.items.length + (grp.items.length === 1 ? ' change' : ' changes');

        var itemsHtml = grp.items.map(function (item) {
          var prevStr = formatDiffVal(item.previousValue);
          var nextStr = formatDiffVal(item.newValue);
          var timeStr = new Date(item.timestamp).toLocaleTimeString('en-IN', {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
          });
          var authorName = item.updatedBy?.name || item.updatedBy?.username || 'Admin';
          var authorRole = (item.updatedBy?.role || 'admin').toUpperCase();

          return '<div class="history-card-item">' +
            '<div style="flex:1;">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
            '<span class="key-label" style="background:#eef2ff;color:#3730a3;">' + escapeHtml(item.card) + '</span>' +
            '<strong style="font-size:13.5px;color:var(--td);">' + escapeHtml(item.field) + '</strong>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;font-size:12px;">' +
            '<span class="diff-tag diff-prev">' + escapeHtml(prevStr) + '</span>' +
            '<span style="color:var(--tdi);font-weight:700;"><re-icon icon="arrow-right"></re-icon></span>' +
            '<span class="diff-tag diff-next">' + escapeHtml(nextStr) + '</span>' +
            '</div>' +
            '</div>' +
            '<div style="text-align:right;">' +
            '<div style="font-size:12px;font-weight:600;color:var(--td);display:flex;align-items:center;gap:6px;justify-content:flex-end;">' +
            '<span>' + escapeHtml(authorName) + '</span>' +
            '<span class="sb-urole" style="font-size:9px;">' + escapeHtml(authorRole) + '</span>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--tmu);margin-top:3px;font-family:\'JetBrains Mono\',monospace;display:flex;align-items:center;gap:4px;justify-content:flex-end;">' +
            '<re-icon icon="timer" size="12"></re-icon> ' + escapeHtml(timeStr) +
            '</div>' +
            '</div>' +
            '</div>';
        }).join('');

        return '<div class="history-date-group">' +
          '<div class="history-date-header">' +
          '<div class="history-date-left">' +
          '<span class="history-date-icon"><re-icon icon="calendar" size="16"></re-icon></span>' +
          '<span class="history-date-primary">' + escapeHtml(headerInfo.primary) + '</span>' +
          (headerInfo.secondary ? '<span class="history-date-secondary">' + escapeHtml(headerInfo.secondary) + '</span>' : '') +
          '</div>' +
          '<span class="history-date-badge">' + escapeHtml(countLabel) + '</span>' +
          '</div>' +
          '<div class="history-date-items">' +
          itemsHtml +
          '</div>' +
          '</div>';
      }).join('');

      if (container) container.innerHTML = html;
      updatePagination(data.total, data.pages);
    })
    .catch(function (err) {
      if (container) {
        container.innerHTML = '<div style="text-align:center;padding:30px;color:#dc2626;"><re-icon icon="x-circle"></re-icon> Error loading history: ' + escapeHtml(err.message || '') + '</div>';
      }
    });
}

function formatDiffVal(val) {
  if (val === null || val === undefined) return 'None';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function updatePagination(total, totalPages) {
  var infoEl = document.getElementById('hist-page-info');
  var prevBtn = document.getElementById('hist-prev-btn');
  var nextBtn = document.getElementById('hist-next-btn');

  if (infoEl) infoEl.textContent = 'Showing page ' + currentHistoryPage + ' of ' + Math.max(1, totalPages) + ' (' + total + ' changes total)';
  if (prevBtn) prevBtn.disabled = currentHistoryPage <= 1;
  if (nextBtn) nextBtn.disabled = currentHistoryPage >= totalPages;
}

function histChangePage(delta) {
  loadHistory(currentHistoryPage + delta);
}

// Admin Password Reset
function changeAdminPassword() {
  var cur = document.getElementById('pw-cur').value.trim();
  var nw = document.getElementById('pw-new').value.trim();
  var conf = document.getElementById('pw-conf').value.trim();

  if (!cur || !nw || !conf) {
    showToast('Please fill all password fields');
    return;
  }
  if (nw.length < 8) {
    showToast('New password must be at least 8 characters');
    return;
  }
  if (nw !== conf) {
    showToast('New passwords do not match');
    return;
  }

  dbToast('Updating password…', 'saving');
  apiCall('POST', '/auth/change-password', { currentPassword: cur, newPassword: nw })
    .then(function (res) {
      if (res && res.error) {
        dbToast('Password update failed', 'error', res.error);
        return;
      }
      document.getElementById('pw-cur').value = '';
      document.getElementById('pw-new').value = '';
      document.getElementById('pw-conf').value = '';
      dbToast('Password updated', 'success', 'Your password has been changed successfully');
    })
    .catch(function (err) {
      dbToast('Password update failed', 'error', err.message || 'Network error');
    });
}

// Factory Reset
function openResetModal() {
  document.getElementById('reset-admin-pw').value = '';
  document.getElementById('reset-modal').classList.add('open');
}

function closeResetModal() {
  document.getElementById('reset-modal').classList.remove('open');
}

function executeResetSettings() {
  var pw = document.getElementById('reset-admin-pw').value.trim();
  if (!pw) {
    showToast('Admin password required');
    return;
  }

  dbToast('Restoring factory defaults…', 'saving');
  apiCall('POST', '/settings/reset', { password: pw })
    .then(function (res) {
      if (res && res.error) {
        dbToast('Reset failed', 'error', res.error);
        return;
      }
      closeResetModal();
      dbToast('Factory reset complete', 'success', 'Settings restored to defaults');
      setTimeout(function () {
        loadAllSettings();
      }, 500);
    })
    .catch(function (err) {
      dbToast('Reset failed', 'error', err.message || 'Network error');
    });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRegulationMinAttInputs(regsList, regMinAttMap) {
  var grid = document.getElementById('acad-regulations-grid');
  if (!grid) return;

  function doRender(regs) {
    if (!regs || !regs.length) {
      grid.innerHTML = '<div style="color:var(--tmu);font-size:12px;padding:8px 0;">No curriculum regulations configured yet. Manage them in <a href="manage.html?tab=years" style="color:var(--gD);font-weight:600;text-decoration:underline;">Years tab (manage.html)</a>.</div>';
      return;
    }
    var globalFallback = parseInt(document.getElementById('acad-minatt')?.value, 10) || 75;
    var html = '';
    regs.forEach(function (r) {
      var code = r.code || r.year || '';
      var name = r.name || ('Regulation ' + code);
      var currentVal = (regMinAttMap && regMinAttMap[code] !== undefined)
        ? regMinAttMap[code]
        : (r.minAttendance !== undefined ? r.minAttendance : globalFallback);

      html += '<div class="card" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;box-shadow:none;">';
      html += '  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap;">';
      html += '    <div style="font-weight:700;font-size:13px;color:var(--td);display:flex;align-items:center;gap:6px;">';
      html += '      <re-icon icon="scroll" size="14"></re-icon> ' + escapeHtml(name);
      html += '    </div>';
      if (r.isDefault) {
        html += '  <span style="background:#f0fdf4;border:1px solid #86efac;color:var(--gK);font-size:10px;font-weight:700;padding:2px 8px;border-radius:9px;white-space:nowrap;">● Default Regulation</span>';
      }
      html += '    <span class="key-label">' + escapeHtml(code) + '</span>';
      html += '  </div>';
      html += '  <div class="form-group" style="margin-top:6px;">';
      html += '    <label class="form-label" style="font-size:11.5px;">Min. Attendance Requirement (%) <span class="key-label">reg.' + escapeHtml(code) + '</span></label>';
      html += '    <input type="number" class="form-input reg-minatt-input" data-reg-code="' + escapeHtml(code) + '" min="0" max="100" value="' + currentVal + '" placeholder="75" oninput="checkDirtyState()">';
      html += '    <span class="field-hint">Required for students and batches enrolled under ' + escapeHtml(name) + '.</span>';
      html += '  </div>';
      html += '</div>';
    });
    grid.innerHTML = html;
  }

  if (regsList && regsList.length) {
    doRender(regsList);
  } else {
    apiCall('GET', '/year/regulations').then(function (data) {
      doRender(Array.isArray(data) ? data : []);
    }).catch(function () {
      doRender([
        { code: '2021', name: 'Regulation 2021', year: '2021', isDefault: false, minAttendance: 75 },
        { code: '2025', name: 'Regulation 2025', year: '2025', isDefault: true, minAttendance: 75 }
      ]);
    });
  }
}


// ============================================================================
// KEY-LABEL INTERACTIVE HOVER EXPLANATION SYSTEM (TRUE/FALSE & EFFECT ENGINE)
// ============================================================================

var KEY_EXPLANATIONS = {
  "institutionName": {
    "type": "string",
    "name": "Full Institution Name",
    "desc": "The official accredited name of the college or university, displayed across report headers, hall tickets, transcripts, and formal document exports.",
    "neutral": "Defines the institutional headline in PDF exports, login cards, and official administrative announcements."
  },
  "institutionShort": {
    "type": "string",
    "name": "Short Name / Acronym",
    "desc": "Official abbreviated name or acronym (e.g. VCET, MIT) used in compact navigation bars, mobile headers, and student register number prefixes.",
    "neutral": "Sets the identity tag shown in badges, breadcrumbs, compact headers, and system audit logs."
  },
  "institutionTagline": {
    "type": "string",
    "name": "Accreditation Tagline",
    "desc": "Accreditation status and institutional affiliations (e.g. 'Autonomous | Approved by AICTE | Affiliated to Anna University').",
    "neutral": "Rendered as an official accreditation subtitle on printed PDF reports, grade sheets, and letterhead headers."
  },
  "institutionAddress": {
    "type": "string",
    "name": "Campus Address",
    "desc": "Complete physical postal address of the institution for official correspondence and regulatory compliance.",
    "neutral": "Populates official institutional footer and contact blocks across generated attendance summaries and reports."
  },
  "institutionEmail": {
    "type": "string",
    "name": "Official Contact Email",
    "desc": "Primary institutional email address used as the sender contact for automated notifications, alerts, and system dispatches.",
    "neutral": "Displays as the official reply-to and inquiry contact address across student and faculty portals."
  },
  "institutionPhone": {
    "type": "string",
    "name": "Contact Phone",
    "desc": "Primary administrative phone number or PBX switchboard line for institutional contact and emergency inquiries.",
    "neutral": "Shown in system contact footers, error dialogues, and automated message dispatches."
  },
  "institutionWebsite": {
    "type": "string",
    "name": "Website URL",
    "desc": "Canonical domain URL of the college or university portal.",
    "neutral": "Hyperlinked in official notifications, communication dispatches, and footer copyright statements."
  },
  "pageStudents": {
    "type": "tristate",
    "name": "Students Portal (student.html)",
    "enabledLabel": "Accessible",
    "desc": "Master Tri-State access and visibility controller for student self-service portal (student.html) and mobile views.",
    "effects": {
      "enabled": "Accessible: Students can log in, view live attendance rosters, check OD/leave status, timetable schedules, and scan attendance QR codes.",
      "disabled": "Disabled: Portal card displays a 'Locked / Paused' badge in selectors. Student login is paused with a maintenance notice; API returns 403 STUDENTS_LOGIN_PAUSED.",
      "hidden": "Hidden: Completely hides the student portal link from navigation, role selectors, and public UI. Direct URL access is blocked."
    }
  },
  "pageTeachers": {
    "type": "tristate",
    "name": "Teachers Portal (teacher.html)",
    "enabledLabel": "Accessible",
    "desc": "Master Tri-State access and visibility controller for faculty portal (teacher.html) and classroom attendance management.",
    "effects": {
      "enabled": "Accessible: Faculty can log in, record attendance (Quick Pass, Live QR, CR delegation), manage student rosters, and submit leave requests.",
      "disabled": "Disabled: Faculty portal card displays as 'Locked'. Teacher login is suspended with a temporary pause banner; marking endpoints reject writes.",
      "hidden": "Hidden: Completely removes the teacher portal option from the role selector and workspace navigation. Direct URL navigation is blocked."
    }
  },
  "pageController": {
    "type": "tristate",
    "name": "Controller Hub (controller.html)",
    "enabledLabel": "Enabled",
    "desc": "Master Tri-State access controller for Controller Hub (controller.html) executive command centre and real-time radar.",
    "effects": {
      "enabled": "Enabled / Accessible: Authorized Principals, HODs, and Controllers can access campus radar, defaulter threshold bands, and live attendance tracking.",
      "disabled": "Disabled: Controller Hub card appears in the selector with a 'Locked / Maintenance' badge. Dashboard metrics and approval actions are frozen.",
      "hidden": "Hidden: Completely removes the Controller Hub card from the workspace launcher. Direct access to controller.html is blocked."
    }
  },
  "pageRooms": {
    "type": "tristate",
    "name": "Room & Board Facilities (rooms.html)",
    "enabledLabel": "Enabled",
    "desc": "Master Tri-State access controller for Room & Board Facilities management (rooms.html) and hostel roll-call modules.",
    "effects": {
      "enabled": "Enabled / Accessible: Wardens and facility coordinators can manage room allocations, resident check-ins, boarder roll calls, and smart boards.",
      "disabled": "Disabled: Facility management card appears locked in launcher. Allocation modifications and roll-call submissions are paused.",
      "hidden": "Hidden: Completely hides Room & Board Facilities from workspace selector and navigation menus."
    }
  },
  "pageManage": {
    "type": "tristate",
    "name": "Data & Calendar Manager (manage.html)",
    "enabledLabel": "Enabled",
    "desc": "Master Tri-State access controller for academic calendar, term dates, and exam scheduling tools (manage.html).",
    "effects": {
      "enabled": "Enabled / Accessible: Administrators can configure batch schedules, term calendars, working day patterns, and examination sessions.",
      "disabled": "Disabled: Displays with a 'Locked' badge in the workspace selector. Scheduling forms are read-only to prevent concurrent edits.",
      "hidden": "Hidden: Completely removes Data & Calendar Manager from the workspace selector and navigation."
    }
  },
  "pageBulk": {
    "type": "tristate",
    "name": "Bulk Upload Portal (bulk.html)",
    "enabledLabel": "Enabled",
    "desc": "Master Tri-State access controller for mass CSV and Excel spreadsheet ingestion pipelines (bulk.html).",
    "effects": {
      "enabled": "Enabled / Accessible: Administrators can execute mass data ingestion for student rosters, faculty accounts, and timetable mappings.",
      "disabled": "Disabled: Bulk portal appears locked. File upload endpoints reject file parsing and database writes to prevent unverified batch changes.",
      "hidden": "Hidden: Completely hides the Bulk Upload portal from the workspace selector and admin navigation."
    }
  },
  "pageTimeTable": {
    "type": "tristate",
    "name": "Timetable Hub (timetable.html)",
    "enabledLabel": "Enabled",
    "desc": "Master Tri-State access controller for master weekly period schedule and hall allocator (timetable.html).",
    "effects": {
      "enabled": "Enabled / Accessible: Department coordinators can build, edit, and publish weekly period timetables and lecture hall assignments.",
      "disabled": "Disabled: Timetable Hub card displays locked. Schedule builders are frozen; existing schedules remain in read-only mode.",
      "hidden": "Hidden: Completely hides Timetable Hub from workspace selector and navigation."
    }
  },
  "pageSelector": {
    "type": "tristate",
    "name": "Workspace Selector Hub (selector.html)",
    "enabledLabel": "Enabled",
    "desc": "Controls the post-authentication role launcher hub (selector.html) for multi-role institutional users.",
    "effects": {
      "enabled": "Enabled / Accessible: Users with multiple roles (e.g. HOD who also teaches) see the interactive workspace launcher card hub upon login.",
      "disabled": "Disabled: Bypasses the launcher hub with a locked notice; directly routes authenticated faculty to their primary default dashboard (teacher.html).",
      "hidden": "Hidden: Completely suppresses selector.html; automatically redirects users straight to their primary role page upon login."
    }
  },
  "markAttendance": {
    "type": "boolean",
    "name": "Mark Attendance (Master Switch)",
    "desc": "Global kill-switch controlling all real-time attendance marking operations across the institution.",
    "trueEffect": "Attendance marking is active across Quick Pass, QR Live Scan, and Class Representative delegations.",
    "falseEffect": "Freezes all attendance recording institution-wide; teachers and representatives cannot mark or submit rosters."
  },
  "quickPass": {
    "type": "boolean",
    "name": "Quick Pass Attendance",
    "desc": "One-click whole-class attendance entry mode designed for rapid classroom roll call.",
    "trueEffect": "Teachers can mark entire classes in seconds with bulk present/absent toggles and fast review.",
    "falseEffect": "Disables Quick Pass mode; teachers must use QR sessions or manual individual roll calls."
  },
  "liveSessions": {
    "type": "boolean",
    "name": "Live Passcode Sessions",
    "desc": "Dynamic rotating QR passcode self-attendance mechanism projected on smart classroom displays.",
    "trueEffect": "Enables rotating QR codes with 15-60s cryptographic rotation for student self-scanning.",
    "falseEffect": "Disables dynamic QR sessions; students cannot scan to mark attendance."
  },
  "forwardToRep": {
    "type": "boolean",
    "name": "Forward to Class Representative",
    "desc": "Allows faculty members to securely delegate period attendance recording to the designated class representative.",
    "trueEffect": "Faculty can assign a period's roll call to the authenticated class representative in emergencies.",
    "falseEffect": "Disallows delegation; only the assigned faculty member can record and submit attendance."
  },
  "allowAttendanceEdit": {
    "type": "boolean",
    "name": "Allow Attendance Edit",
    "desc": "Controls whether faculty can revise attendance records after initial submission.",
    "trueEffect": "Teachers can adjust previously submitted rosters within the backdate and lock duration window.",
    "falseEffect": "Submissions are permanently immutable once submitted; only Superadmins can authorize corrections."
  },
  "requirePeriodRemark": {
    "type": "boolean",
    "name": "Require Mandatory Period Remark",
    "desc": "Enforces syllabus coverage or instructional remarks before an attendance submission is accepted.",
    "trueEffect": "Teachers must enter a syllabus or session note before the system allows attendance submission.",
    "falseEffect": "Session remarks field is optional; attendance can be saved without entering text notes."
  },
  "forceTimetableSlots": {
    "type": "boolean",
    "name": "Force Only Timetable Slots",
    "desc": "Restricts attendance recording strictly to officially scheduled periods and rooms.",
    "trueEffect": "Teachers can only take attendance for periods, subjects, and rooms officially allocated in their timetable.",
    "falseEffect": "Allows flexible ad-hoc marking for substituted, combined, or rescheduled class sessions."
  },
  "maxAttendanceBackdateDays": {
    "type": "number",
    "name": "Max Attendance Backdate (Days)",
    "desc": "Maximum number of past days for which a faculty member can retroactively record or update attendance.",
    "neutral": "Restricts historical edits (e.g. 3 days). Sessions older than this threshold require administrator unlock."
  },
  "autoLockAttendanceHours": {
    "type": "number",
    "name": "Auto-Lock Period (Hours)",
    "desc": "Elapsed hours after class conclusion before an attendance submission is automatically locked against further edits.",
    "neutral": "Locks submitted attendance records after specified hours (e.g. 24h), preventing subsequent faculty tampering."
  },
  "rotationCount": {
    "type": "number",
    "name": "Live Session Rotations",
    "desc": "Number of consecutive dynamic QR code rotations generated per live attendance session.",
    "neutral": "Controls how many QR refresh cycles occur (e.g. 2 rotations) before the live session automatically terminates."
  },
  "rotationTimeSec": {
    "type": "number",
    "name": "Rotation Duration (Seconds)",
    "desc": "Lifespan in seconds of each dynamic cryptographic QR passcode before cycling to the next token.",
    "neutral": "Sets QR token validity duration (e.g. 60s). Shorter intervals prevent unauthorized photo sharing or proxy scanning."
  },
  "defaultAttendanceStatus": {
    "type": "string",
    "name": "System Default Roster State",
    "desc": "Initial default status pre-assigned to all students upon opening a fresh attendance session.",
    "neutral": "Preset to 'Present' (for exception marking absentees) or 'Absent' (requiring affirmative check-in per student)."
  },
  "annualLeaveQuota": {
    "type": "number",
    "name": "Annual Total Leave Quota (Days)",
    "desc": "Total annual aggregate leave days allocated to permanent faculty members before loss-of-pay.",
    "neutral": "Sets maximum annual paid leave allowance (e.g. 15 days) across all general leave categories."
  },
  "casualLeaveAllowance": {
    "type": "number",
    "name": "Casual Leave (CL) Allowance",
    "desc": "Annual entitlement cap for short-term personal or unforeseen casual absences.",
    "neutral": "Caps casual leave days (e.g. 12 days per year); applications exceeding this deduct from LOP."
  },
  "medicalLeaveAllowance": {
    "type": "number",
    "name": "Medical Leave (ML) Allowance",
    "desc": "Dedicated annual pool of sick leave days allocated for genuine health conditions.",
    "neutral": "Limits medical leave days (e.g. 10 days per year); consecutive claims require doctor documentation."
  },
  "earnedLeaveAllowance": {
    "type": "number",
    "name": "Earned Leave (EL) Allowance",
    "desc": "Annual accrued vacation or earned leave quota credited based on active service.",
    "neutral": "Defines earned leave allocation (e.g. 15 days) eligible for vacation periods or rollover."
  },
  "maxConsecutiveLeaveDays": {
    "type": "number",
    "name": "Max Consecutive Leave Days",
    "desc": "Upper limit of continuous leave days that can be approved without institutional executive escalation.",
    "neutral": "Leaves exceeding this threshold (e.g. 3 consecutive days) trigger mandatory Principal approval."
  },
  "medicalDocThresholdDays": {
    "type": "number",
    "name": "Medical Certificate Due (Days)",
    "desc": "Consecutive medical leave duration that triggers mandatory medical certificate attachment.",
    "neutral": "Absences meeting or exceeding this number (e.g. 3 days) require an uploaded medical certificate to submit."
  },
  "requireSubstitution": {
    "type": "boolean",
    "name": "Require Mandatory Period Substitution",
    "desc": "Enforces faculty peer substitution for all affected timetable periods before leave submission.",
    "trueEffect": "Faculty must identify and secure substitute teachers for every affected period before leave submits.",
    "falseEffect": "Leave can be submitted without prior peer substitution; department arranges coverage post-approval."
  },
  "allowPeriodLeave": {
    "type": "boolean",
    "name": "Allow Hour / Period Permission Leaves",
    "desc": "Enables short-duration permission passes (1-2 periods) without deducting half or full leave days.",
    "trueEffect": "Faculty can apply for 1-2 period permission leaves for urgent work without full-day quota deduction.",
    "falseEffect": "Restricts faculty leave to full-day or standard half-day units only."
  },
  "carryForward": {
    "type": "boolean",
    "name": "Carry Forward Unused Earned Leaves",
    "desc": "Controls whether unexhausted earned leave days rollover into the subsequent academic calendar year.",
    "trueEffect": "Unused earned leave balances accumulate and carry over into the next academic year.",
    "falseEffect": "Unused earned leaves lapse automatically at the end of the academic year."
  },
  "autoEscalatePrincipal": {
    "type": "boolean",
    "name": "Auto-Escalate to Principal if HOD Unresponsive",
    "desc": "Automated escalation trigger when an HOD fails to review a pending leave request within timeout.",
    "trueEffect": "Unreviewed leave requests automatically escalate to the Principal's dashboard after the deadline.",
    "falseEffect": "Requests remain in the HOD's approval queue indefinitely until explicit manual action is taken."
  },
  "modelLeave": {
    "type": "boolean",
    "name": "Student & Faculty Leave / OD Subsystem",
    "desc": "Master feature toggle for the entire leave and on-duty application and approval workflow engine.",
    "trueEffect": "Leave and OD applications, multi-tier approvals, and substitution workflows are fully operational.",
    "falseEffect": "Disables the leave module globally; hides application forms, approval queues, and leave tabs."
  },
  "modelGrievances": {
    "type": "boolean",
    "name": "Grievance Redressal System",
    "desc": "Feature toggle for student, faculty, and parent grievance lodging and resolution workflows.",
    "trueEffect": "Users can file anonymous or named grievances, and administrators can manage resolution SLAs.",
    "falseEffect": "Hides the grievance redressal portal and blocks grievance submission endpoints."
  },
  "modelExams": {
    "type": "boolean",
    "name": "Examination & Internal Assessment Module",
    "desc": "Controls access to examination scheduling, hall ticket generation, and internal marks compilation.",
    "trueEffect": "Enables exam schedules, assessment scoring, hall ticket clearance, and marks entry.",
    "falseEffect": "Disables examination interfaces and restricts marks entry tools across all portals."
  },
  "modelNotifications": {
    "type": "boolean",
    "name": "Push Notification & Alert Dispatcher",
    "desc": "Enables real-time push notification banners, SMS dispatches, and email event triggers.",
    "trueEffect": "Dispatches instant alerts for attendance defaulters, approved leaves, and campus broadcasts.",
    "falseEffect": "Suppresses automated notifications; only critical system errors are recorded in logs."
  },
  "modelBackup": {
    "type": "boolean",
    "name": "Automated Database Backup Engine",
    "desc": "Controls scheduled automated MongoDB database dumps and archive rotation.",
    "trueEffect": "Runs automated daily database snapshots to local storage and encrypted cloud destinations.",
    "falseEffect": "Suspends automated scheduled backups; requires manual administrative database dumps."
  },
  "modelUndo": {
    "type": "boolean",
    "name": "Soft-Delete with Undo Trash Bin",
    "desc": "Protects against accidental data loss by placing deleted items into a recoverable trash bin.",
    "trueEffect": "Deleted entities (students, classes, subjects) are archived with a temporary restore option.",
    "falseEffect": "Deletions execute immediately and permanently purge records from the database."
  },
  "modelAddStudent": {
    "type": "boolean",
    "name": "Direct Student Enrollment Interface",
    "desc": "Enables manual single-student registration dialogs in the administration portal.",
    "trueEffect": "Staff can manually enroll new students via the 'Add Student' modal dialog.",
    "falseEffect": "Restricts student creation exclusively to bulk CSV imports or external ERP synchronization."
  },
  "modelExportSheet": {
    "type": "boolean",
    "name": "Excel & CSV Export Engine",
    "desc": "Enables client-side and server-side spreadsheet export capabilities across data grids.",
    "trueEffect": "Users can export attendance rosters, student directories, and grade sheets to CSV/Excel.",
    "falseEffect": "Export buttons are hidden to prevent mass unauthorized extraction of student data."
  },
  "moduleDelUseAdminPass": {
    "type": "boolean",
    "name": "Admin Password Required for Deletions",
    "desc": "Security gate demanding the master admin password before executing high-impact deletions.",
    "trueEffect": "Deleting classes, batches, or departments prompts for the administrator's password.",
    "falseEffect": "Deletions proceed with standard confirmation dialogs without requiring re-authentication."
  },
  "requireHodApproval": {
    "type": "boolean",
    "name": "Require HOD Approval on Class Actions",
    "desc": "Mandates formal HOD sign-off before class curriculum adjustments or cancellations take effect.",
    "trueEffect": "Departmental schedule and section modifications mandate formal HOD electronic sign-off.",
    "falseEffect": "Coordinators and instructors can publish class modifications directly without prior HOD sign-off."
  },
  "modelSmartBoards": {
    "type": "boolean",
    "name": "Smart Classroom & Smart Board Sync",
    "desc": "Enables IoT companion view and projection synchronization for smart boards in classrooms.",
    "trueEffect": "Enables smart board interactive companion views and automated classroom display synchronization.",
    "falseEffect": "Disables smart board synchronization endpoints and hides classroom display options."
  },
  "forcePasswordChange": {
    "type": "boolean",
    "name": "Mandatory First-Login Password Change",
    "desc": "Forces users with temporary or default passwords to establish a private credential on initial sign-in.",
    "trueEffect": "Users logging in with default passwords must immediately configure a secure new password.",
    "falseEffect": "Users can continue utilizing default credentials indefinitely without being prompted."
  },
  "requireStrongPassword": {
    "type": "boolean",
    "name": "Enforce Complex Password Rules",
    "desc": "Enforces minimum complexity: 8+ characters including uppercase, lowercase, numbers, and symbols.",
    "trueEffect": "New passwords must satisfy complexity requirements; simple passwords are rejected.",
    "falseEffect": "Allows simple alphanumeric passwords with minimal length restrictions."
  },
  "sessionTimeout": {
    "type": "boolean",
    "name": "Inactive Session Timeout Gating",
    "desc": "Automatically invalidates authenticated browser tokens after an idle period to prevent session hijacking.",
    "trueEffect": "Idle browser sessions automatically log out after the configured timeout duration.",
    "falseEffect": "User sessions persist indefinitely until the user explicitly clicks log out."
  },
  "sessionTimeoutMins": {
    "type": "number",
    "name": "Inactive Session Duration (Minutes)",
    "desc": "Idle minutes elapsed without user interaction before an authenticated session is revoked.",
    "neutral": "Controls session expiration (e.g. 60 min). Shorter intervals increase physical security."
  },
  "maxLoginAttempts": {
    "type": "number",
    "name": "Max Login Attempts",
    "desc": "Threshold of consecutive failed authentication attempts permitted before locking an account.",
    "neutral": "Protects against brute-force attacks (e.g. 3 attempts). Exceeding this triggers a timed lockout."
  },
  "lockoutDurationMins": {
    "type": "number",
    "name": "Lockout Duration (Minutes)",
    "desc": "Duration an account remains frozen after exceeding the maximum failed login attempt threshold.",
    "neutral": "Sets lockout cooldown (e.g. 15 min) before the account allows further password attempts."
  },
  "allowSubAdminLogs": {
    "type": "boolean",
    "name": "Allow Sub-Admin Action Logging",
    "desc": "Controls whether sub-administrator operations and config changes are tracked in audit trails.",
    "trueEffect": "Logs all actions and setting alterations made by delegated sub-admins into encrypted audit records.",
    "falseEffect": "Restricts detailed administrative audit logging strictly to root Superadmin operations."
  },
  "logRetentionDays": {
    "type": "number",
    "name": "Log Retention Horizon (Days)",
    "desc": "Retention lifespan for encrypted AES-256-GCM audit trail entries before archival or purging.",
    "neutral": "Configures audit log retention (0 = preserve indefinitely; e.g. 90 = purge after 90 days)."
  },
  "loginLocationRequired": {
    "type": "boolean",
    "name": "Require Geolocation on Authentication",
    "desc": "Requires mobile and desktop browsers to provide GPS coordinates during user login.",
    "trueEffect": "Authentication fails if the browser refuses to provide coordinates or if outside campus bounds.",
    "falseEffect": "Users can authenticate from any network or location without geolocation verification."
  },
  "loginLocationAccuracyCheck": {
    "type": "boolean",
    "name": "Strict GPS Accuracy Validation",
    "desc": "Validates GPS precision radius to filter out inaccurate cell tower triangulation or spoofed coordinates.",
    "trueEffect": "Rejects coarse or low-precision location readings exceeding the maximum accuracy threshold.",
    "falseEffect": "Accepts any coordinates returned by the browser regardless of uncertainty radius."
  },
  "loginLocationMaxAccuracyM": {
    "type": "number",
    "name": "Max Geolocation Accuracy (Meters)",
    "desc": "Maximum acceptable GPS uncertainty radius in meters for login verification.",
    "neutral": "Limits location fuzziness (e.g. 2000m). Fixes with wider uncertainty radii are rejected as imprecise."
  },
  "loginLocationMaxAgeSec": {
    "type": "number",
    "name": "Max Geolocation Age (Seconds)",
    "desc": "Maximum allowed age of cached GPS fixes to prevent replay of historic location coordinates.",
    "neutral": "Rejects cached coordinate fixes older than this threshold (e.g. 300s), ensuring live positioning."
  },
  "requireRegisteredDevice": {
    "type": "boolean",
    "name": "Require Registered Device for Self-Attendance",
    "desc": "Enforces cryptographic hardware binding for student self-attendance QR scanning.",
    "trueEffect": "Students can only check in using their pre-registered, cryptographic hardware-bound phone.",
    "falseEffect": "Students can mark attendance from any secondary phone, tablet, or shared desktop browser."
  },
  "studentSessionDays": {
    "type": "number",
    "name": "Student Session Duration (Days)",
    "desc": "Validity duration of a student's bound device authentication token before re-verification.",
    "neutral": "Sets device token lifespan (e.g. 15 days). When expired, the student must re-verify credentials."
  },
  "credentialTtlMin": {
    "type": "number",
    "name": "Registration Credential TTL (Minutes)",
    "desc": "Lifespan of the enrollment QR code or deep link issued for initial device binding.",
    "neutral": "Sets how long a device pairing invitation token remains active (e.g. 10 min) before expiry."
  },
  "credentialMaxAttempts": {
    "type": "number",
    "name": "Max Credential Pairing Attempts",
    "desc": "Maximum failed pairing attempts allowed before a device registration token is revoked.",
    "neutral": "Limits enrollment attempts (e.g. 5 attempts) to protect against pairing code interception."
  },
  "verifyCodeTtlMin": {
    "type": "number",
    "name": "6-Digit Code TTL (Minutes)",
    "desc": "Expiration window for 6-digit secondary verification codes dispatched for device transfers.",
    "neutral": "Sets one-time verification passcode lifespan (e.g. 5 min); expired codes are rejected."
  },
  "verifyCodeMaxAttempts": {
    "type": "number",
    "name": "Max 6-Digit Verify Attempts",
    "desc": "Maximum invalid 6-digit OTP code attempts allowed before revoking the verification session.",
    "neutral": "Limits passcode guessing attempts (e.g. 3 attempts) before locking the device registration attempt."
  },
  "replacementRequestsPerDay": {
    "type": "number",
    "name": "Replacement Requests Per Day",
    "desc": "Daily cap on how many device replacement or re-binding requests an individual student can initiate.",
    "neutral": "Prevents frequent device transfers (e.g. 3 per day) to deter student phone-swapping for proxy attendance."
  },
  "enabled": {
    "type": "boolean",
    "name": "Enable Trust Score Gating",
    "desc": "Master toggle for the student behavioral trust score engine and attendance integrity gating.",
    "trueEffect": "Evaluates student attendance integrity via dynamic trust scores (1-100), gating privileges.",
    "falseEffect": "Disables trust score calculations and restrictions; all students are treated with equal standing."
  },
  "countApprovedLeaveInFrequency": {
    "type": "boolean",
    "name": "Count Approved Leave in Frequency Rule",
    "desc": "Controls whether formally approved leaves contribute toward frequent absence pattern calculations.",
    "trueEffect": "Both approved leaves and unexcused absences factor into chronic absence pattern detection.",
    "falseEffect": "Only unauthorized absences count toward frequent absence penalty calculations."
  },
  "startScore": {
    "type": "number",
    "name": "Initial Baseline Score",
    "desc": "Default trust score assigned to newly enrolled students upon account creation.",
    "neutral": "Sets baseline starting score (typically 100); infractions reduce this score over time."
  },
  "bands.normal": {
    "type": "number",
    "name": "Normal Band Floor",
    "desc": "Minimum trust score threshold required to maintain unrestricted normal standing (Green Band).",
    "neutral": "Students at or above this score (e.g. 80) enjoy full self-check-in and Quick Pass privileges."
  },
  "bands.monitor": {
    "type": "number",
    "name": "Monitor Band Floor",
    "desc": "Trust score threshold defining the monitored standing zone (Amber Band).",
    "neutral": "Students in this range (e.g. 60-79) receive warnings and are subject to randomized GPS spot-checks."
  },
  "bands.verify": {
    "type": "number",
    "name": "Teacher Verify Band Floor",
    "desc": "Critical trust score threshold below which self-check-in privileges are revoked (Red Band).",
    "neutral": "Students below this score (e.g. <40) cannot self-scan QR codes; teacher must physically verify presence."
  },
  "uninformedAbsencePenalty": {
    "type": "number",
    "name": "Uninformed Absence Penalty",
    "desc": "Trust score points deducted when a student is absent without prior approved leave or OD.",
    "neutral": "Deducts points (e.g. 4 pts per day) from the student's trust score for unexcused non-attendance."
  },
  "frequentAbsenceThreshold": {
    "type": "number",
    "name": "Frequent Absence Threshold (Days)",
    "desc": "Number of absent days within a 30-day window that triggers chronic absence penalties.",
    "neutral": "Threshold of absences (e.g. 6 days) before compound frequent absence penalties apply."
  },
  "frequentAbsencePenalty": {
    "type": "number",
    "name": "Frequent Absence Penalty",
    "desc": "Compound trust score deduction applied when the frequent absence threshold is crossed.",
    "neutral": "Applies additional penalty points (e.g. 2 pts) for recurring attendance irregularities."
  },
  "teacherDeniedPenalty": {
    "type": "number",
    "name": "Teacher Denied Penalty",
    "desc": "Severe penalty applied when a faculty member denies a student's fraudulent attendance claim.",
    "neutral": "Deducts heavy score penalty (e.g. 40 pts) when a teacher catches a student proxy-marking or falsely claiming presence."
  },
  "teacherDeniedLockDays": {
    "type": "number",
    "name": "Teacher Denied Lock Duration (Days)",
    "desc": "Days a student's self-attendance is suspended following a teacher-denied attendance claim.",
    "neutral": "Locks self-scan capabilities (e.g. 2 days); student must be manually marked by the teacher."
  },
  "deviceShareLockDays": {
    "type": "number",
    "name": "Device Share Lock Duration (Days)",
    "desc": "Lockout penalty duration applied when a phone is detected submitting attendance for multiple students.",
    "neutral": "Suspends the device and implicated student accounts (e.g. 15 days) from digital self-attendance."
  },
  "deviceShareAbsentDays": {
    "type": "number",
    "name": "Device Share Absent Days",
    "desc": "Number of historical session days marked absent when fraudulent device sharing is detected.",
    "neutral": "Retroactively marks past days as absent (e.g. 7 days) upon confirmed buddy punching."
  },
  "deviceShareAttendancePenaltyPct": {
    "type": "number",
    "name": "Device Share Attendance Adjustment (%)",
    "desc": "Overall cumulative semester attendance percentage deducted upon confirmed proxy marking.",
    "neutral": "Directly reduces overall semester attendance percentage (e.g. 5%) as a disciplinary penalty."
  },
  "disputeWindowDays": {
    "type": "number",
    "name": "Dispute Window (Days)",
    "desc": "Calendar days a student has to file an electronic dispute against an attendance penalty or absence.",
    "neutral": "Allows students to submit evidence and appeal within window (e.g. 7 days); expired records cannot be disputed."
  },
  "disputeBonusPct": {
    "type": "number",
    "name": "Dispute Accepted Attendance Bonus (%)",
    "desc": "Attendance percentage restored or bonus applied when an administrator upholds a student's dispute.",
    "neutral": "Credits restitution percentage (e.g. 2%) and clears false penalty marks when an appeal is upheld."
  },
  "deviceWeights.key": {
    "type": "number",
    "name": "Cryptographic Key Signature Weight",
    "desc": "Integrity weight awarded when the request contains a valid hardware Keystore asymmetric signature.",
    "neutral": "Confidence score contribution (e.g. 25 pts) verifying the physical device TPM/secure enclave."
  },
  "deviceWeights.match": {
    "type": "number",
    "name": "Install ID & Fingerprint Match",
    "desc": "Integrity weight awarded when device hardware fingerprint matches stored enrollment credentials.",
    "neutral": "Confidence score contribution (e.g. 10 pts) for hardware fingerprint consistency."
  },
  "deviceWeights.location": {
    "type": "number",
    "name": "Classroom GPS Inside Radius",
    "desc": "Integrity weight awarded when student GPS coordinates lie strictly inside the scheduled classroom geofence.",
    "neutral": "Confidence score contribution (e.g. 10 pts) confirming physical presence within the room radius."
  },
  "deviceWeights.campusIp": {
    "type": "number",
    "name": "Campus Wi-Fi / IP Match",
    "desc": "Integrity weight awarded when the check-in request originates from the institutional Wi-Fi network.",
    "neutral": "Confidence score contribution (e.g. 5 pts) verifying connection to approved campus access points."
  },
  "deviceWeights.spoofPenalty": {
    "type": "number",
    "name": "Spoofing Detection Penalty",
    "desc": "Penalty deducted when mock location providers, VPNs, or location spoofers are detected.",
    "neutral": "Immediate score reduction (e.g. 10 pts) applied for mock location provider or proxy detection."
  },
  "academicYear": {
    "type": "string",
    "name": "Active Academic Year",
    "desc": "Current operational academic year governing student batches, terms, and curriculum versioning.",
    "neutral": "Controls academic session boundaries (e.g. '2026-2027') for course offerings and attendance records."
  },
  "currentSemesterType": {
    "type": "string",
    "name": "Current Semester Type",
    "desc": "Active academic semester cycle determining current class offerings (Odd vs Even).",
    "neutral": "Switches operational views and attendance tracking across Odd (Sem 1,3,5,7) or Even (Sem 2,4,6,8) terms."
  },
  "minAttendance": {
    "type": "number",
    "name": "Default Min. Attendance Requirement (%)",
    "desc": "Institutional minimum attendance percentage required for students to qualify for semester examinations.",
    "neutral": "Standard institutional threshold (e.g. 75%); students falling below this are barred from exams unless condoned."
  },
  "lowAttendanceThreshold": {
    "type": "number",
    "name": "Low Attendance Warning (%)",
    "desc": "Early-warning percentage threshold that flags students at risk of semester condonation or exam debarment.",
    "neutral": "Triggers automated warning notices and alerts parents/advisors when attendance falls below this point (e.g. 65%)."
  },
  "workingDays": {
    "type": "number",
    "name": "Working Days per Week",
    "desc": "Configures whether the institutional academic week runs for 5 days or 6 days.",
    "neutral": "Defines timetable schedule columns (Monday\u2013Friday vs Monday\u2013Saturday) and expected working day counts."
  },
  "periodsPerDay": {
    "type": "number",
    "name": "Academic Periods per Day",
    "desc": "Standard number of instructional timetable periods scheduled in each regular academic working day.",
    "neutral": "Establishes daily period slots (e.g. 7 or 8 periods) used to calculate total semester attendance hours."
  },
  "defaultPopupDurationSec": {
    "type": "number",
    "name": "Default Popup Duration (Seconds)",
    "desc": "Screen display duration in seconds before a mandatory institutional broadcast popup can be dismissed.",
    "neutral": "Forces users to view critical announcements for at least this long (e.g. 10s) before dismissal."
  },
  "autoExpireHours": {
    "type": "number",
    "name": "Auto-Expire Duration (Hours)",
    "desc": "Lifespan of published broadcast bulletins before they are automatically archived.",
    "neutral": "Broadcast notices auto-expire and disappear from dashboards after specified hours (e.g. 24h)."
  },
  "allowTeacherBroadcasts": {
    "type": "boolean",
    "name": "Allow Authorized Faculty Broadcasts",
    "desc": "Permits verified teaching faculty to dispatch targeted announcements to their enrolled class sections.",
    "trueEffect": "Faculty can send urgent class notifications directly to their enrolled student rosters.",
    "falseEffect": "Restricts broadcast authoring exclusively to central administrative accounts."
  },
  "debugMode": {
    "type": "boolean",
    "name": "Debug Mode",
    "desc": "Enables verbose diagnostic logging, API payload dumps, and execution latency profiling.",
    "trueEffect": "Outputs verbose debug information, performance traces, and database query logs to browser console.",
    "falseEffect": "Runs in clean production mode with standard suppressed error and log output."
  },
  "multiAdminSession": {
    "type": "boolean",
    "name": "Allow Multiple Admin Sessions",
    "desc": "Controls whether multiple administrators can maintain concurrent active sessions.",
    "trueEffect": "Allows multiple administrative users to log in simultaneously from different devices.",
    "falseEffect": "Logging in as administrator terminates any other active administrative sessions immediately."
  },
  "autoSeedDemoData": {
    "type": "boolean",
    "name": "Auto-seed Demo Data",
    "desc": "Enables automatic population of sample students, teachers, and attendance history on clean databases.",
    "trueEffect": "Injects mock demo records and sample attendance fixtures when database collections are empty.",
    "falseEffect": "Leaves empty collections untouched; ensures production database remains pristine."
  },
  "errorsCount": {
    "type": "number",
    "name": "Recent Error Logs Limit",
    "desc": "Maximum number of recent encrypted system exceptions and API failure traces displayed in System Health.",
    "neutral": "Sets maximum error log history capacity (e.g. 20 entries) rendered in the administrative diagnostic viewer."
  }
};

function getKeyExplanation(key) {
  if (KEY_EXPLANATIONS[key]) {
    return KEY_EXPLANATIONS[key];
  }

  // Handle dynamic regulation keys (e.g. reg.2025, reg.2021)
  var regMatch = key.match(/^reg\.(.+)$/i);
  if (regMatch) {
    var regCode = regMatch[1];
    return {
      type: 'number',
      name: 'Regulation ' + regCode + ' Minimum Attendance (%)',
      desc: 'Mandatory minimum attendance percentage required for students enrolled under Regulation ' + regCode + ' to qualify for semester examinations.',
      neutral: 'Overrides the institutional default minAttendance. Batches under Regulation ' + regCode + ' falling below this percentage are marked as exam defaulters.'
    };
  }

  // Handle bare regulation code (e.g. 2021, 2025)
  if (/^20\d\d$/i.test(key)) {
    return {
      type: 'string',
      name: 'Curriculum Regulation ' + key,
      desc: 'Academic curriculum regulation code ' + key + ', defining subject syllabi, credit allocations, and passing standards for enrolled batches.',
      neutral: 'Identifies the curriculum regulation framework applied to student cohorts enrolled under this scheme.'
    };
  }

  // Smart fallback
  return {
    type: 'string',
    name: key.replace(/([A-Z])/g, ' $1').replace(/^./, function (str) { return str.toUpperCase(); }),
    desc: 'System configuration property `' + key + '` governing runtime behavior in the EAMS database.',
    neutral: 'Modifying this parameter updates the operational rules for this setting domain.'
  };
}

function initKeyLabelHover() {
  var popover = document.getElementById('key-label-popover');
  if (!popover) {
    popover = document.createElement('div');
    popover.id = 'key-label-popover';
    popover.className = 'key-label-popover';
    document.body.appendChild(popover);
  }

  var currentTarget = null;
  var hideTimeout = null;

  function renderPopoverContent(targetKey, info) {
    var typeClass = 'type-' + (info.type || 'string');
    var typeLabel = info.type === 'boolean' ? 'Toggle' : (info.type === 'tristate' ? 'Tri-State' : (info.type === 'number' ? 'Number' : 'Setting'));

    var html = '';
    html += '<div class="kl-pop-hd">';
    html += '  <span class="kl-pop-key">' + escapeHtml(targetKey) + '</span>';
    html += '  <span class="kl-pop-type ' + typeClass + '">' + typeLabel + '</span>';
    html += '</div>';

    if (info.name) {
      html += '<div class="kl-pop-name">' + escapeHtml(info.name) + '</div>';
    }

    html += '<div class="kl-pop-desc">' + escapeHtml(info.desc || 'System configuration parameter for this module.') + '</div>';

    html += '<div class="kl-pop-effects">';
    if (info.type === 'tristate' || info.effects) {
      var eff = info.effects || {};
      var enabledLabel = info.enabledLabel || 'Enabled';
      if (eff.enabled) {
        html += '  <div class="kl-pop-row row-enabled">';
        html += '    <span class="kl-pop-badge badge-enabled">' + escapeHtml(enabledLabel) + '</span>';
        html += '    <span class="kl-pop-text">' + escapeHtml(eff.enabled) + '</span>';
        html += '  </div>';
      }
      if (eff.disabled) {
        html += '  <div class="kl-pop-row row-disabled">';
        html += '    <span class="kl-pop-badge badge-disabled">Disabled</span>';
        html += '    <span class="kl-pop-text">' + escapeHtml(eff.disabled) + '</span>';
        html += '  </div>';
      }
      if (eff.hidden) {
        html += '  <div class="kl-pop-row row-hidden">';
        html += '    <span class="kl-pop-badge badge-hidden">Hidden</span>';
        html += '    <span class="kl-pop-text">' + escapeHtml(eff.hidden) + '</span>';
        html += '  </div>';
      }
    } else if (info.type === 'boolean' || info.trueEffect || info.falseEffect) {
      if (info.trueEffect) {
        html += '  <div class="kl-pop-row row-true">';
        html += '    <span class="kl-pop-badge badge-true">true</span>';
        html += '    <span class="kl-pop-text">' + escapeHtml(info.trueEffect) + '</span>';
        html += '  </div>';
      }
      if (info.falseEffect) {
        html += '  <div class="kl-pop-row row-false">';
        html += '    <span class="kl-pop-badge badge-false">false</span>';
        html += '    <span class="kl-pop-text">' + escapeHtml(info.falseEffect) + '</span>';
        html += '  </div>';
      }
    } else if (info.neutral) {
      html += '  <div class="kl-pop-row row-neutral">';
      html += '    <span class="kl-pop-badge badge-neutral">Effect</span>';
      html += '    <span class="kl-pop-text">' + escapeHtml(info.neutral) + '</span>';
      html += '  </div>';
    }
    html += '</div>';

    html += '<div class="kl-pop-ft">';
    html += '  <span class="ft-engine"><re-icon icon="sliders" size="12"></re-icon> EAMS Configuration Engine</span>';
    html += '  <span>Active in real-time</span>';
    html += '</div>';

    popover.innerHTML = html;
  }

  function positionPopover(target) {
    if (!target) return;
    var rect = target.getBoundingClientRect();
    var popWidth = popover.offsetWidth || 340;
    var popHeight = popover.offsetHeight || 190;
    var pad = 12;

    var left = rect.left + (rect.width / 2) - (popWidth / 2);
    left = Math.max(pad, Math.min(window.innerWidth - popWidth - pad, left));

    var top = rect.top - popHeight - 10;
    if (top < pad) {
      top = rect.bottom + 10;
    }

    popover.style.left = Math.round(left) + 'px';
    popover.style.top = Math.round(top) + 'px';
  }

  function showFor(target) {
    clearTimeout(hideTimeout);
    currentTarget = target;
    var rawKey = (target.textContent || '').trim();
    if (!rawKey) return;

    var info = getKeyExplanation(rawKey);
    renderPopoverContent(rawKey, info);
    positionPopover(target);
    popover.classList.add('visible');
    // Reposition once rendered to ensure exact height matching
    requestAnimationFrame(function () {
      if (currentTarget) positionPopover(currentTarget);
    });
  }

  function hide() {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(function () {
      popover.classList.remove('visible');
      currentTarget = null;
    }, 120);
  }

  document.addEventListener('mouseover', function (e) {
    var kl = e.target.closest ? e.target.closest('.key-label') : null;
    if (kl) {
      showFor(kl);
    } else if (!e.target.closest('.key-label-popover')) {
      hide();
    }
  });

  document.addEventListener('mouseout', function (e) {
    var kl = e.target.closest ? e.target.closest('.key-label') : null;
    if (kl) {
      var rel = e.relatedTarget;
      if (!rel || (!rel.closest('.key-label-popover') && !rel.closest('.key-label'))) {
        hide();
      }
    }
  });

  popover.addEventListener('mouseenter', function () {
    clearTimeout(hideTimeout);
  });

  popover.addEventListener('mouseleave', function () {
    hide();
  });

  window.addEventListener('scroll', function () {
    if (currentTarget && popover.classList.contains('visible')) {
      positionPopover(currentTarget);
    }
  }, { passive: true });

  window.addEventListener('resize', function () {
    if (currentTarget && popover.classList.contains('visible')) {
      positionPopover(currentTarget);
    }
  }, { passive: true });
}

// Automatically initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initKeyLabelHover);
} else {
  initKeyLabelHover();
}
