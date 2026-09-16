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
    pageManage: 'enabled',
    pageBulk: 'enabled',
    pageTimeTable: 'enabled',
    pageSelector: 'enabled',
  },
  attendance: {},
  models: {},
  academic: {},
  security: {},
  broadcast: {},
  advanced: {},
};

(function initSettings() {
  currentUser = checkAuth('admin', 'settingsPage');
  if (!currentUser) return;

  hydrateUser();
  updateClock();
  setInterval(updateClock, 1000);

  // Check URL params for active tab
  var urlParams = new URLSearchParams(window.location.search);
  var tabParam = urlParams.get('tab') || 'institution';
  nav(tabParam);

  loadAllSettings();
  trackDirtyInputs();
})();

function hydrateUser() {
  var nameEl = document.getElementById('sb-name');
  var roleEl = document.getElementById('sb-role');
  var avEl = document.getElementById('sb-av');
  var backBtn = document.getElementById('back-hub-btn');

  if (currentUser) {
    var name = currentUser.name || currentUser.fullName || currentUser.username || 'Admin';
    if (nameEl) nameEl.textContent = name;
    if (avEl) avEl.textContent = name.charAt(0).toUpperCase();

    if (currentUser.role === 'teacher') {
      if (roleEl) roleEl.textContent = 'Faculty';
      if (backBtn) backBtn.textContent = '← Back to Hub';
    } else {
      if (roleEl) roleEl.textContent = 'Admin';
      var ref = (document.referrer || '').toLowerCase();
      if (ref.includes('control.html')) {
        if (backBtn) backBtn.textContent = '← Back to Control Panel';
      } else {
        if (backBtn) backBtn.textContent = '← Back to Dashboard';
      }
    }
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

// Tab Navigation
function nav(tabName) {
  var validTabs = ['institution', 'pages', 'attendance', 'models', 'security', 'academic', 'broadcast', 'history', 'advanced'];
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
var BASELINE_SNAPSHOT = {};
var ALL_SETTING_CARDS = ['institution', 'pages', 'attendance', 'models', 'security', 'academic', 'broadcast', 'advanced'];

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
      requirePeriodRemark: document.getElementById('att-remark') ? document.getElementById('att-remark').checked : false,
      maxAttendanceBackdateDays: parseInt(document.getElementById('att-backdate')?.value, 10) || 0,
      autoLockAttendanceHours: parseInt(document.getElementById('att-autolock')?.value, 10) || 24,
      defaultAttendanceStatus: document.getElementById('att-default-status')?.value || 'Present',
    };
  } else if (cardKey === 'models') {
    return {
      modelAssignments: document.getElementById('mod-assign') ? document.getElementById('mod-assign').checked : true,
      modelLeave: document.getElementById('mod-leave') ? document.getElementById('mod-leave').checked : true,
      modelGrievances: document.getElementById('mod-griev') ? document.getElementById('mod-griev').checked : true,
      modelExams: document.getElementById('mod-exams') ? document.getElementById('mod-exams').checked : true,
      modelNotifications: document.getElementById('mod-notif') ? document.getElementById('mod-notif').checked : true,
      modelBackup: document.getElementById('mod-backup') ? document.getElementById('mod-backup').checked : true,
      modelUndo: document.getElementById('mod-undo') ? document.getElementById('mod-undo').checked : true,
      modelAddStudent: document.getElementById('mod-addstud') ? document.getElementById('mod-addstud').checked : true,
      modelExportSheet: document.getElementById('mod-export') ? document.getElementById('mod-export').checked : true,
      moduleDelUseAdminPass: document.getElementById('mod-delpass') ? document.getElementById('mod-delpass').checked : true,
    };
  } else if (cardKey === 'security') {
    return {
      forcePasswordChange: document.getElementById('sec-forcepw') ? document.getElementById('sec-forcepw').checked : true,
      requireStrongPassword: document.getElementById('sec-strongpw') ? document.getElementById('sec-strongpw').checked : true,
      sessionTimeout: document.getElementById('sec-timeout') ? document.getElementById('sec-timeout').checked : true,
      allowSubAdminLogs: document.getElementById('sec-subadmin-logs') ? document.getElementById('sec-subadmin-logs').checked : false,
      sessionTimeoutMins: parseInt(document.getElementById('sec-timeout-mins')?.value, 10) || 60,
      maxLoginAttempts: parseInt(document.getElementById('sec-maxlogin')?.value, 10) || 3,
      lockoutDurationMins: parseInt(document.getElementById('sec-lockout-mins')?.value, 10) || 15,
      logRetentionDays: parseInt(document.getElementById('sec-log-retention')?.value, 10) || 0,
    };
  } else if (cardKey === 'academic') {
    return {
      academicYear: (document.getElementById('acad-year')?.value || '2026-2027').trim(),
      currentSemesterType: document.getElementById('acad-semtype')?.value || 'Odd',
      minAttendance: parseInt(document.getElementById('acad-minatt')?.value, 10) || 75,
      lowAttendanceThreshold: parseInt(document.getElementById('acad-lowatt')?.value, 10) || 65,
      workingDays: parseInt(document.getElementById('acad-workdays')?.value, 10) || 6,
      periodsPerDay: parseInt(document.getElementById('acad-periods')?.value, 10) || 7,
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
  if (cardKey) {
    BASELINE_SNAPSHOT[cardKey] = JSON.stringify(getCardValues(cardKey));
  } else {
    ALL_SETTING_CARDS.forEach(function (c) {
      BASELINE_SNAPSHOT[c] = JSON.stringify(getCardValues(c));
    });
  }
}

function getDirtyCards() {
  var dirty = [];
  ALL_SETTING_CARDS.forEach(function (card) {
    if (!BASELINE_SNAPSHOT[card]) return;
    var current = JSON.stringify(getCardValues(card));
    if (current !== BASELINE_SNAPSHOT[card]) {
      dirty.push(card);
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
  if (!dirty) {
    recordBaselineSnapshot();
    checkDirtyState();
  } else {
    checkDirtyState();
  }
}

// Load All Settings from MongoDB
function loadAllSettings() {
  return apiCall('GET', '/settings')
    .then(function (data) {
      if (!data || data.error) {
        showToast('❌ Could not load settings from server');
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
      setChk('att-remark', !!att.requirePeriodRemark);
      setVal('att-backdate', att.maxAttendanceBackdateDays !== undefined ? att.maxAttendanceBackdateDays : 3);
      setVal('att-autolock', att.autoLockAttendanceHours !== undefined ? att.autoLockAttendanceHours : 24);
      setVal('att-rotation-count', att.rotationCount !== undefined ? att.rotationCount : 2);
      var rotTime = att.rotationTimeSec !== undefined ? att.rotationTimeSec : (att.qrIntervalSec !== undefined ? att.qrIntervalSec : 60);
      setVal('att-rotation-time', rotTime);
      setVal('att-qr-interval', rotTime);
      setVal('att-default-status', att.defaultAttendanceStatus || 'Present');

      // 4. Models
      var mod = data.models || {};
      setChk('mod-assign', mod.modelAssignments !== false);
      setChk('mod-leave', mod.modelLeave !== false);
      setChk('mod-griev', mod.modelGrievances !== false);
      setChk('mod-exams', mod.modelExams !== false);
      setChk('mod-notif', mod.modelNotifications !== false);
      setChk('mod-backup', mod.modelBackup !== false);
      setChk('mod-undo', mod.modelUndo !== false);
      setChk('mod-addstud', mod.modelAddStudent !== false);
      setChk('mod-export', mod.modelExportSheet !== false);
      setChk('mod-delpass', mod.moduleDelUseAdminPass !== false);

      // 5. Security
      var sec = data.security || {};
      setChk('sec-forcepw', sec.forcePasswordChange !== false);
      setChk('sec-strongpw', sec.requireStrongPassword !== false);
      setChk('sec-timeout', sec.sessionTimeout !== false);
      setChk('sec-subadmin-logs', !!sec.allowSubAdminLogs);
      setVal('sec-timeout-mins', sec.sessionTimeoutMins || 60);
      setVal('sec-maxlogin', sec.maxLoginAttempts || 3);
      setVal('sec-lockout-mins', sec.lockoutDurationMins || 15);
      setVal('sec-log-retention', sec.logRetentionDays || 0);

      // 6. Academic
      var acad = data.academic || {};
      setVal('acad-year', acad.academicYear || '2026-2027');
      setVal('acad-semtype', acad.currentSemesterType || 'Odd');
      setVal('acad-minatt', acad.minAttendance !== undefined ? acad.minAttendance : 75);
      setVal('acad-lowatt', acad.lowAttendanceThreshold !== undefined ? acad.lowAttendanceThreshold : 65);
      setVal('acad-workdays', acad.workingDays !== undefined ? acad.workingDays : 6);
      setVal('acad-periods', acad.periodsPerDay !== undefined ? acad.periodsPerDay : 7);

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
      checkDirtyState();
    })
    .catch(function (err) {
      showToast('❌ Network error loading settings: ' + (err.message || ''));
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

// Save Card Payload
function saveCard(cardKey) {
  var payload = getCardValues(cardKey);
  var cardTitle = cardKey.charAt(0).toUpperCase() + cardKey.slice(1);

  dbToast('Saving ' + cardTitle + ' to Database...', 'saving');
  return apiCall('PUT', '/settings/' + cardKey, { value: payload })
    .then(function (res) {
      if (res && res.error) {
        dbToast('Save failed', 'error', res.error);
        return false;
      }
      dbToast('Settings saved', 'success', cardTitle + ' settings saved & audited');
      recordBaselineSnapshot(cardKey);
      checkDirtyState();
      return true;
    })
    .catch(function (err) {
      dbToast('Save failed', 'error', err.message || 'Failed to save ' + cardTitle + ' settings');
      return false;
    });
}

function saveCurrentTab() {
  var dirty = getDirtyCards();
  if (dirty.length === 0) {
    if (currentTab !== 'history') saveCard(currentTab);
    return;
  }
  dbToast('Saving ' + dirty.length + ' changed card(s) to Database...', 'saving');
  var promises = dirty.map(function (c) { return saveCard(c); });
  Promise.all(promises).then(function (results) {
    var allSuccess = results.every(function (r) { return r === true; });
    if (allSuccess) {
      dbToast('All settings saved', 'success', dirty.length + ' configuration card(s) saved & audited');
    } else {
      dbToast('Partial save completed', 'warn', 'Some settings may not have saved cleanly');
    }
    checkDirtyState();
  }).catch(function (err) {
    dbToast('Save failed', 'error', err.message || 'Network error saving settings');
  });
}

function discardChanges() {
  loadAllSettings().then(function () {
    dbToast('Changes discarded', 'info');
  });
}

// Dirty Form Tracker
function trackDirtyInputs() {
  function handleInputEvent(e) {
    if (!e || !e.target) return;
    // Ignore non-settings inputs (search, password update, modals)
    var id = e.target.id;
    if (id === 'hist-search' || id === 'hist-card-filter' ||
      id === 'pw-cur' || id === 'pw-new' || id === 'pw-conf' ||
      id === 'reset-admin-pw') {
      return;
    }
    if (e.target.closest('.mc')) checkDirtyState();
  }

  document.addEventListener('input', handleInputEvent);
  document.addEventListener('change', handleInputEvent);
}

function markDirty(dirty) {
  dirtyState = dirty;
  var bar = document.getElementById('save-bar');
  if (bar) {
    if (dirty && currentTab !== 'history') bar.classList.add('show');
    else bar.classList.remove('show');
  }
}

// Change History & Audit Logs
function debounceHistorySearch() {
  clearTimeout(historySearchDebounce);
  historySearchDebounce = setTimeout(function () {
    loadHistory(1);
  }, 350);
}

function loadHistory(page) {
  currentHistoryPage = page || 1;
  var container = document.getElementById('history-list-container');
  var cardFilter = document.getElementById('hist-card-filter').value;
  var search = document.getElementById('hist-search').value.trim();

  if (container) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--tmu);">⏳ Fetching audit records from Database...</div>';
  }

  var qs = '?page=' + currentHistoryPage + '&limit=25';
  if (cardFilter && cardFilter !== 'all') qs += '&card=' + encodeURIComponent(cardFilter);
  if (search) qs += '&search=' + encodeURIComponent(search);

  apiCall('GET', '/settings/history' + qs)
    .then(function (data) {
      if (!data || !data.logs || data.logs.length === 0) {
        if (container) {
          container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tdi);font-size:13px;">📭 No setting change records found matching your filter.</div>';
        }
        updatePagination(0, 1);
        return;
      }

      var html = data.logs.map(function (item) {
        var prevStr = formatDiffVal(item.previousValue);
        var nextStr = formatDiffVal(item.newValue);
        var dateStr = new Date(item.timestamp).toLocaleString('en-IN', {
          dateStyle: 'medium', timeStyle: 'short'
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
          '<span style="color:var(--tdi);font-weight:700;">→</span>' +
          '<span class="diff-tag diff-next">' + escapeHtml(nextStr) + '</span>' +
          '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
          '<div style="font-size:12px;font-weight:600;color:var(--td);display:flex;align-items:center;gap:6px;justify-content:flex-end;">' +
          '<span>' + escapeHtml(authorName) + '</span>' +
          '<span class="sb-urole" style="font-size:9px;">' + escapeHtml(authorRole) + '</span>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--tmu);margin-top:3px;font-family:\'JetBrains Mono\',monospace;">' + escapeHtml(dateStr) + '</div>' +
          '</div>' +
          '</div>';
      }).join('');

      if (container) container.innerHTML = html;
      updatePagination(data.total, data.pages);
    })
    .catch(function (err) {
      if (container) {
        container.innerHTML = '<div style="text-align:center;padding:30px;color:#dc2626;">❌ Error loading history: ' + escapeHtml(err.message || '') + '</div>';
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
    showToast('⚠️ Please fill all password fields');
    return;
  }
  if (nw.length < 8) {
    showToast('⚠️ New password must be at least 8 characters');
    return;
  }
  if (nw !== conf) {
    showToast('⚠️ New passwords do not match');
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
    showToast('⚠️ Admin password required');
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
