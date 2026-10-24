/**
 * public/js/pages/admin.trust.js
 * 
 * Trust & Devices Admin Module (§11, §14, §15, §16, Phase T5)
 * Manages Student Device Registry, Trust Score Ledger, Two-Person Rules,
 * Registration Windows, and Approval Queues.
 */

(function (window, document) {
  'use strict';

  var _trustState = {
    students: [],
    selectedStudent: null,
    windows: [],
    queues: [],
    cases: [],
    history: [],
    searchDebounceTimer: null,
    currentSubTab: 'students'
  };

  function isCurrentUserSudo() {
    try {
      var access = JSON.parse(sessionStorage.getItem('eams_access') || '{}');
      if (access && access.flags && access.flags.isSudo) return true;
      if (access && (access.level === 'sudo' || access.tier === 'sudoAdmin' || access.accessRole === 'sudoAdmin')) return true;
      var user = JSON.parse(sessionStorage.getItem('eams_user') || '{}');
      return Boolean(user && (user.isSudoAdmin || user.role === 'sudo' || user.accessRole === 'sudoAdmin'));
    } catch (e) {
      return false;
    }
  }

  function isCurrentUserSuperAdmin() {
    try {
      var access = JSON.parse(sessionStorage.getItem('eams_access') || '{}');
      if (access && access.flags && access.flags.isSuper) return true;
      if (access && (access.tier === 'superAdmin' || access.accessRole === 'superAdmin')) return true;
      var user = JSON.parse(sessionStorage.getItem('eams_user') || '{}');
      return Boolean(user && (user.isSuperAdmin || user.accessRole === 'superAdmin'));
    } catch (e) {
      return false;
    }
  }

  function getCurrentUserDeptInfo() {
    try {
      var access = JSON.parse(sessionStorage.getItem('eams_access') || '{}');
      if (access && access.pages && access.pages.admin && access.pages.admin.deptId) {
        return {
          id: String(access.pages.admin.deptId),
          name: access.pages.admin.dept || ''
        };
      }
      var user = JSON.parse(sessionStorage.getItem('eams_user') || '{}');
      return {
        id: user.deptId ? String(user.deptId) : null,
        name: user.department || user.deptName || user.dept || ''
      };
    } catch (e) {
      return { id: null, name: '' };
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getBandBadge(band, score) {
    var b = (band || '').toLowerCase();
    if (b === 'normal') {
      return '<span style="background:#dcfce7;color:#15803d;padding:3px 8px;border-radius:12px;font-size:11.5px;font-weight:600;">Normal (' + score + ')</span>';
    } else if (b === 'monitor') {
      return '<span style="background:#fef9c3;color:#a16207;padding:3px 8px;border-radius:12px;font-size:11.5px;font-weight:600;">Monitor (' + score + ')</span>';
    } else if (b === 'verify') {
      return '<span style="background:#ffedd5;color:#c2410c;padding:3px 8px;border-radius:12px;font-size:11.5px;font-weight:600;">Teacher Verify (' + score + ')</span>';
    } else {
      return '<span style="background:#fee2e2;color:#b91c1c;padding:3px 8px;border-radius:12px;font-size:11.5px;font-weight:600;">High Risk (' + score + ')</span>';
    }
  }

  function getScoreColor(score) {
    if (score >= 80) return '#16a34a';
    if (score >= 60) return '#ca8a04';
    if (score >= 40) return '#ea580c';
    return '#dc2626';
  }

  // ─────────────────────────────────────────────────────────
  //  INIT MODULE
  // ─────────────────────────────────────────────────────────
  function initTrustDevicesModule() {
    populateDeptAndClassFilters();
    loadTrustStats();
    switchTrustSubTab(_trustState.currentSubTab || 'students');
  }

  function refreshTrustModule() {
    populateDeptAndClassFilters();
    loadTrustStats();
    if (_trustState.currentSubTab === 'students') loadTrustStudents();
    else if (_trustState.currentSubTab === 'windows') loadRegistrationWindows();
    else if (_trustState.currentSubTab === 'queues') {
      loadTrustQueues();
      loadAdminDisputes();
      loadDeviceShareCases();
    }
    else if (_trustState.currentSubTab === 'history') loadTrustHistory();
  }

  function populateDeptAndClassFilters() {
    var deptSel = document.getElementById('trust-filter-dept');
    var classSel = document.getElementById('trust-filter-class');
    var winDeptSel = document.getElementById('win-dept');
    var winClassSel = document.getElementById('win-class');
    var deptFg = document.getElementById('trust-dept-fg');

    var isSudo = isCurrentUserSudo();
    var myDept = getCurrentUserDeptInfo();

    // Populate Departments from global DB cache if available
    var depts = (typeof DB !== 'undefined' && DB.get) ? (DB.get('depts') || []) : [];
    var classes = (typeof DB !== 'undefined' && DB.get) ? (DB.get('classes') || []) : [];

    // Filter departments for Department-scoped Admin
    if (!isSudo && myDept.id) {
      if (deptFg) deptFg.style.display = 'none'; // Admin views own department
    } else {
      if (deptFg) deptFg.style.display = 'block';
    }

    function renderDepts(deptList) {
      if (deptSel) {
        var curDept = deptSel.value || '';
        deptSel.innerHTML = '<option value="">All Departments</option>' +
          deptList.map(function (d) {
            var sel = String(d._id) === String(curDept) ? ' selected' : '';
            return '<option value="' + d._id + '"' + sel + '>' + escapeHtml(d.name) + ' (' + escapeHtml(d.code || '') + ')</option>';
          }).join('');
      }
      if (winDeptSel) {
        if (!isSudo && myDept.id) {
          winDeptSel.innerHTML = '<option value="' + myDept.id + '">' + escapeHtml(myDept.name || 'My Department') + '</option>';
          winDeptSel.disabled = true;
        } else {
          winDeptSel.disabled = false;
          var curWinDept = winDeptSel.value || '';
          winDeptSel.innerHTML = '<option value="">Select Department</option>' +
            deptList.map(function (d) {
              var sel = String(d._id) === String(curWinDept) ? ' selected' : '';
              return '<option value="' + d._id + '"' + sel + '>' + escapeHtml(d.name) + ' (' + escapeHtml(d.code || '') + ')</option>';
            }).join('');
        }
      }
    }

    if (depts.length) {
      renderDepts(depts);
    }

    var activeDeptId = (!isSudo && myDept.id) ? myDept.id : (deptSel ? deptSel.value : '');
    if (classes.length) {
      updateClassDropdowns(classes, activeDeptId);
    }

    // Always fetch fresh classes & departments from API
    var promises = [
      apiCall('GET', '/classes').catch(function () { return []; }),
      apiCall('GET', '/departments').catch(function () { return []; })
    ];

    Promise.all(promises).then(function (results) {
      var fetchedClasses = Array.isArray(results[0]) ? results[0] : (results[0]?.data || []);
      var fetchedDepts = Array.isArray(results[1]) ? results[1] : (results[1]?.data || []);

      if (fetchedDepts.length) {
        if (typeof DB !== 'undefined' && DB.set) DB.set('depts', fetchedDepts);
        _trustState.allDepts = fetchedDepts;
        renderDepts(fetchedDepts);
      }

      if (fetchedClasses.length) {
        if (typeof DB !== 'undefined' && DB.set) DB.set('classes', fetchedClasses);
        _trustState.allClasses = fetchedClasses;
        var curDeptId = (!isSudo && myDept.id) ? myDept.id : (deptSel ? deptSel.value : '');
        updateClassDropdowns(fetchedClasses, curDeptId);
      }
    });
  }

  function updateClassDropdowns(classes, targetDeptId) {
    var classSel = document.getElementById('trust-filter-class');
    var winClassSel = document.getElementById('win-class');
    if (!classSel && !winClassSel) return;

    var filteredClasses = classes || [];
    if (targetDeptId) {
      filteredClasses = filteredClasses.filter(function (c) {
        var cDeptId = c.deptId ? (c.deptId._id ? String(c.deptId._id) : String(c.deptId)) : '';
        return cDeptId === String(targetDeptId);
      });
    }

    // If filteredClasses is empty but targetDeptId is set, try matching by department name/code
    if (targetDeptId && filteredClasses.length === 0 && Array.isArray(classes)) {
      var myDept = getCurrentUserDeptInfo();
      var deptName = (myDept.name || '').toLowerCase().trim();
      if (deptName) {
        filteredClasses = classes.filter(function (c) {
          var cName = (c.deptName || '').toLowerCase().trim();
          var cCode = (c.deptCode || '').toLowerCase().trim();
          return (cName && (cName.includes(deptName) || deptName.includes(cName))) ||
                 (cCode && deptName.includes(cCode));
        });
      }
    }

    // Sort classes by name
    filteredClasses.sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '');
    });

    var curVal = classSel ? classSel.value : '';
    var curWinVal = winClassSel ? winClassSel.value : '';

    var classOptions = filteredClasses.map(function (c) {
      var label = c.name || '';
      if (c.section && !label.toLowerCase().includes(c.section.toLowerCase())) {
        label += ' (' + c.section + ')';
      }
      var isSel = String(c._id) === String(curVal) ? ' selected' : '';
      return '<option value="' + c._id + '"' + isSel + '>' + escapeHtml(label) + '</option>';
    }).join('');

    var winOptions = filteredClasses.map(function (c) {
      var label = c.name || '';
      if (c.section && !label.toLowerCase().includes(c.section.toLowerCase())) {
        label += ' (' + c.section + ')';
      }
      var isSel = String(c._id) === String(curWinVal) ? ' selected' : '';
      return '<option value="' + c._id + '"' + isSel + '>' + escapeHtml(label) + '</option>';
    }).join('');

    if (classSel) classSel.innerHTML = '<option value="">All Classes</option>' + classOptions;
    if (winClassSel) winClassSel.innerHTML = '<option value="">Select Target Class</option>' + winOptions;
  }

  function onTrustDeptFilterChange() {
    var deptSel = document.getElementById('trust-filter-dept');
    var selectedDeptId = deptSel ? deptSel.value : '';
    var classes = _trustState.allClasses || ((typeof DB !== 'undefined' && DB.get) ? (DB.get('classes') || []) : []);
    updateClassDropdowns(classes, selectedDeptId);
    loadTrustStudents();
  }

  // ─────────────────────────────────────────────────────────
  //  SUBTAB SWITCHING
  // ─────────────────────────────────────────────────────────
  function switchTrustSubTab(tabName) {
    _trustState.currentSubTab = tabName;

    var tabs = ['students', 'windows', 'queues', 'history'];
    tabs.forEach(function (t) {
      var btn = document.getElementById('trust-tab-btn-' + t);
      var view = document.getElementById('trust-subtab-' + t);
      if (btn) btn.classList.toggle('act', t === tabName);
      if (view) view.style.display = (t === tabName) ? 'block' : 'none';
    });

    if (tabName === 'students') {
      loadTrustStudents();
    } else if (tabName === 'windows') {
      loadRegistrationWindows();
    } else if (tabName === 'queues') {
      loadTrustQueues();
      loadAdminDisputes();
      loadDeviceShareCases();
    } else if (tabName === 'history') {
      loadTrustHistory();
    }
  }

  // ─────────────────────────────────────────────────────────
  //  STATS KPI CARDS
  // ─────────────────────────────────────────────────────────
  function loadTrustStats() {
    apiCall('GET', '/trust/students?limit=200').then(function (data) {
      if (!data || !data.students) return;
      var students = data.students;

      var total = students.length;
      var locked = 0;
      var normal = 0;
      var withDevice = 0;

      students.forEach(function (s) {
        if (s.isLocked || s.trustScore < 40) locked++;
        if (s.trustScore >= 80 && !s.isLocked) normal++;
        if (s.deviceStatus === 'TRUSTED') withDevice++;
      });

      var elTotal = document.getElementById('trust-stat-total');
      var elLocked = document.getElementById('trust-stat-locked');
      var elNormal = document.getElementById('trust-stat-normal');
      var elDevices = document.getElementById('trust-stat-devices');

      if (elTotal) elTotal.textContent = total;
      if (elLocked) elLocked.textContent = locked;
      if (elNormal) elNormal.textContent = normal;
      if (elDevices) elDevices.textContent = withDevice;
    }).catch(function (err) {
      console.warn('Could not load trust stats:', err);
    });

    apiCall('GET', '/devices/windows').then(function (data) {
      var windows = data?.windows || [];
      var active = windows.filter(function (w) {
        var now = new Date();
        return w.active && new Date(w.from) <= now && new Date(w.to) >= now;
      }).length;
      var elWin = document.getElementById('trust-stat-windows');
      if (elWin) elWin.textContent = active;
    }).catch(function () {});
  }

  // ─────────────────────────────────────────────────────────
  //  1. STUDENTS TAB & TABLE
  // ─────────────────────────────────────────────────────────
  function debounceTrustStudentSearch() {
    clearTimeout(_trustState.searchDebounceTimer);
    _trustState.searchDebounceTimer = setTimeout(function () {
      loadTrustStudents();
    }, 350);
  }

  function loadTrustStudents() {
    var searchEl = document.getElementById('trust-filter-search');
    var deptSel = document.getElementById('trust-filter-dept');
    var classSel = document.getElementById('trust-filter-class');
    var bandSel = document.getElementById('trust-filter-band');
    var lockedChk = document.getElementById('trust-filter-locked');

    var params = [];
    if (searchEl && searchEl.value.trim()) params.push('search=' + encodeURIComponent(searchEl.value.trim()));
    if (deptSel && deptSel.value) params.push('deptId=' + encodeURIComponent(deptSel.value));
    if (classSel && classSel.value) params.push('classId=' + encodeURIComponent(classSel.value));
    if (bandSel && bandSel.value) params.push('band=' + encodeURIComponent(bandSel.value));
    if (lockedChk && lockedChk.checked) params.push('lockedOnly=true');

    var url = '/trust/students' + (params.length ? '?' + params.join('&') : '');

    var tbody = document.getElementById('trust-students-tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tmu);">Loading student trust records…</td></tr>';
    }

    apiCall('GET', url).then(function (data) {
      if (!data || !data.students) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tmu);">No student trust records found.</td></tr>';
        return;
      }
      _trustState.students = data.students;
      renderTrustStudentsTable(data.students);

      // If class dropdown has only "All Classes", populate from returned student data as fail-safe
      if (classSel && classSel.options.length <= 1 && data.students.length > 0) {
        var studentClasses = [];
        var seenIds = new Set();
        data.students.forEach(function (s) {
          var cid = s.classId ? (s.classId._id || s.classId) : null;
          var cname = (s.classId && s.classId.name) ? s.classId.name : s.class;
          if (cid && !seenIds.has(String(cid))) {
            seenIds.add(String(cid));
            studentClasses.push({
              _id: cid,
              name: cname,
              section: (s.classId && s.classId.section) ? s.classId.section : s.section
            });
          }
        });
        if (studentClasses.length > 0) {
          updateClassDropdowns(studentClasses, '');
        }
      }
    }).catch(function (err) {
      console.error('Failed to load trust students:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#dc2626;">Error loading students: ' + escapeHtml(err.message) + '</td></tr>';
      }
    });
  }

  function renderTrustStudentsTable(students) {
    var tbody = document.getElementById('trust-students-tbody');
    if (!tbody) return;

    if (!students || students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tmu);">No matching students found.</td></tr>';
      return;
    }

    var html = students.map(function (s) {
      var scoreColor = getScoreColor(s.trustScore);
      var bandBadge = getBandBadge(s.band, s.trustScore);

      var lockHtml = '';
      if (s.isLocked) {
        var lockDate = s.lockedUntil ? new Date(s.lockedUntil).toLocaleDateString() : '';
        lockHtml = '<span style="color:#dc2626;font-weight:600;display:inline-flex;align-items:center;gap:4px;" title="' + escapeHtml(s.lockReason || 'Attendance locked') + '">🔒 Locked ' + (lockDate ? 'until ' + lockDate : '') + '</span>';
      } else {
        lockHtml = '<span style="color:#16a34a;font-weight:600;">Active</span>';
      }

      var deviceHtml = '<span style="color:var(--tmu);">No device</span>';
      if (s.deviceStatus === 'TRUSTED') {
        var dModel = s.device?.model || s.device?.browser || 'Mobile';
        deviceHtml = '<span style="color:#16a34a;font-weight:600;display:inline-flex;align-items:center;gap:4px;" title="Registered & trusted key">📱 ' + escapeHtml(dModel) + '</span>';
      } else if (s.deviceStatus === 'PENDING') {
        deviceHtml = '<span style="color:#d97706;font-weight:600;">⏳ Pending</span>';
      } else if (s.deviceStatus === 'REVOKED') {
        deviceHtml = '<span style="color:#dc2626;font-weight:600;">🚫 Revoked</span>';
      }

      var consentHtml = '<span style="color:var(--tmu);">—</span>';
      if (s.advisorConsent && s.advisorConsent.consented) {
        var cNote = s.advisorConsent.note ? ': ' + s.advisorConsent.note : '';
        consentHtml = '<span style="color:#16a34a;font-weight:600;" title="Advisor consented' + escapeHtml(cNote) + '">✅ Consented</span>';
      }

      return '<tr>' +
        '<td>' +
          '<div style="font-weight:600;color:var(--td);">' + escapeHtml(s.fullName) + '</div>' +
          '<div style="font-size:11.5px;color:var(--tmu);font-family:\'JetBrains Mono\',monospace;">' + escapeHtml(s.registerNo || s.username) + '</div>' +
        '</td>' +
        '<td>' +
          '<div>' + escapeHtml(s.class || 'N/A') + '</div>' +
          '<div style="font-size:11.5px;color:var(--tmu);">' + escapeHtml(s.deptCode || s.deptName || '') + '</div>' +
        '</td>' +
        '<td>' +
          '<div style="font-size:16px;font-weight:800;font-family:\'JetBrains Mono\',monospace;color:' + scoreColor + ';">' + s.trustScore + '</div>' +
        '</td>' +
        '<td>' + bandBadge + '</td>' +
        '<td>' + lockHtml + '</td>' +
        '<td>' + deviceHtml + '</td>' +
        '<td>' + consentHtml + '</td>' +
        '<td>' +
          '<button class="btn-sm btn-pri" onclick="openTrustStudentDrawer(\'' + s._id + '\')">' +
            '<re-icon icon="search" size="12"></re-icon> View Ledger' +
          '</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    tbody.innerHTML = html;
  }

  // ─────────────────────────────────────────────────────────
  //  2. STUDENT DRAWER & LEDGER
  // ─────────────────────────────────────────────────────────
  function openTrustStudentDrawer(studentId) {
    if (typeof openModal_ === 'function') {
      openModal_('m-trust-drawer');
    } else {
      var d = document.getElementById('m-trust-drawer');
      if (d) { d.style.display = 'flex'; d.classList.add('open'); }
    }

    var nameEl = document.getElementById('trust-drawer-name');
    var subEl = document.getElementById('trust-drawer-sub');
    var scoreEl = document.getElementById('trust-drawer-score');
    var bandEl = document.getElementById('trust-drawer-band');
    var lockEl = document.getElementById('trust-drawer-lock-status');
    var consentBox = document.getElementById('trust-drawer-consent-box');
    var unlockBtn = document.getElementById('btn-drawer-unlock');

    var ledgerTbody = document.getElementById('trust-drawer-ledger-tbody');
    var devicesTbody = document.getElementById('trust-drawer-devices-tbody');

    if (nameEl) nameEl.textContent = 'Loading student…';
    if (ledgerTbody) ledgerTbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--tmu);">Loading ledger…</td></tr>';
    if (devicesTbody) devicesTbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--tmu);">Loading device history…</td></tr>';

    apiCall('GET', '/trust/students/' + studentId).then(function (data) {
      if (!data || !data.student) return;
      var s = data.student;
      _trustState.selectedStudent = data;

      if (nameEl) nameEl.textContent = s.fullName;
      if (subEl) subEl.textContent = (s.registerNo || s.username) + ' • Class: ' + (s.class || 'N/A') + ' • Dept: ' + (s.deptName || s.deptCode || 'N/A');

      if (scoreEl) {
        scoreEl.textContent = s.trustScore;
        scoreEl.style.color = getScoreColor(s.trustScore);
      }

      if (bandEl) {
        bandEl.textContent = (s.band || 'Normal').toUpperCase();
        if (s.band === 'normal') {
          bandEl.style.background = '#dcfce7'; bandEl.style.color = '#15803d';
        } else if (s.band === 'monitor') {
          bandEl.style.background = '#fef9c3'; bandEl.style.color = '#a16207';
        } else if (s.band === 'verify') {
          bandEl.style.background = '#ffedd5'; bandEl.style.color = '#c2410c';
        } else {
          bandEl.style.background = '#fee2e2'; bandEl.style.color = '#b91c1c';
        }
      }

      if (lockEl) {
        if (s.isLocked) {
          var lockDate = s.lockedUntil ? new Date(s.lockedUntil).toLocaleDateString() : '';
          lockEl.innerHTML = '<span style="color:#dc2626;">🔒 Locked until ' + lockDate + '<br><small style="color:var(--tmu);font-weight:400;">' + escapeHtml(s.lockReason || '') + '</small></span>';
          if (unlockBtn) unlockBtn.style.display = 'inline-flex';
        } else {
          lockEl.innerHTML = '<span style="color:#16a34a;">✅ Active (Self-attendance permitted)</span>';
          if (unlockBtn) unlockBtn.style.display = 'none';
        }
      }

      // Consent Box (§8)
      if (consentBox) {
        if (s.advisorConsent && s.advisorConsent.consented) {
          consentBox.style.display = 'block';
          consentBox.style.background = '#f0fdf4';
          consentBox.style.border = '1px solid #bbf7d0';
          consentBox.style.color = '#166534';
          consentBox.innerHTML = '<strong>✅ Advisor Consent on Record:</strong> Class Advisor ' +
            escapeHtml(s.advisorConsent.by?.name || 'Advisor') + ' consented on ' +
            new Date(s.advisorConsent.at).toLocaleDateString() + ' (Note: <em>"' +
            escapeHtml(s.advisorConsent.note || 'None') + '"</em>). Two-person rule satisfied; Super Admin / Sudo may proceed with Reset or Unlock.';
        } else {
          consentBox.style.display = 'block';
          consentBox.style.background = '#f8fafc';
          consentBox.style.border = '1px solid #e2e8f0';
          consentBox.style.color = '#475569';
          consentBox.innerHTML = '<strong>ℹ️ Two-Person Rule (§8):</strong> Super Admin requires advisor consent before unlocking attendance or resetting score to 100. (Sudo Admin retains institution override privilege).';
        }
      }

      // Ledger Table
      renderDrawerLedger(data.ledger || []);

      // Devices Table
      renderDrawerDevices(data.devices || []);
    }).catch(function (err) {
      console.error('Failed to load student trust detail:', err);
      if (nameEl) nameEl.textContent = 'Error loading student';
      if (ledgerTbody) ledgerTbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:16px;color:#dc2626;">' + escapeHtml(err.message) + '</td></tr>';
    });
  }

  function switchDrawerTab(tabName) {
    var isLedger = tabName === 'ledger';
    var btnLedger = document.getElementById('drawer-tab-btn-ledger');
    var btnDevices = document.getElementById('drawer-tab-btn-devices');
    var tabLedger = document.getElementById('drawer-tab-ledger');
    var tabDevices = document.getElementById('drawer-tab-devices');

    if (btnLedger) btnLedger.classList.toggle('act', isLedger);
    if (btnDevices) btnDevices.classList.toggle('act', !isLedger);
    if (tabLedger) tabLedger.style.display = isLedger ? 'block' : 'none';
    if (tabDevices) tabDevices.style.display = !isLedger ? 'block' : 'none';
  }

  function renderDrawerLedger(events) {
    var tbody = document.getElementById('trust-drawer-ledger-tbody');
    if (!tbody) return;

    if (!events || events.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--tmu);">No trust ledger events recorded yet. Score is baseline (100).</td></tr>';
      return;
    }

    var html = events.map(function (e) {
      var deltaText = e.delta > 0 ? '+' + e.delta : (e.delta === 0 ? '0' : String(e.delta));
      var deltaColor = e.delta > 0 ? '#16a34a' : (e.delta < 0 ? '#dc2626' : '#64748b');

      return '<tr>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;font-size:11px;">' + escapeHtml(e.eventId) + '</td>' +
        '<td><span style="font-weight:600;font-size:11.5px;">' + escapeHtml(e.type) + '</span></td>' +
        '<td style="font-weight:700;color:' + deltaColor + ';font-family:\'JetBrains Mono\',monospace;">' + deltaText + '</td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;font-size:11px;">' + e.before + ' → ' + e.after + '</td>' +
        '<td style="max-width:240px;word-break:break-word;">' + escapeHtml(e.reason) + '</td>' +
        '<td>' + escapeHtml(e.actor?.name || 'System') + ' <small style="color:var(--tmu);">(' + escapeHtml(e.actor?.role || 'system') + ')</small></td>' +
        '<td style="white-space:nowrap;font-size:11px;color:var(--tmu);">' + new Date(e.at).toLocaleString('en-IN') + '</td>' +
      '</tr>';
    }).join('');

    tbody.innerHTML = html;
  }

  function renderDrawerDevices(devices) {
    var tbody = document.getElementById('trust-drawer-devices-tbody');
    if (!tbody) return;

    if (!devices || devices.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--tmu);">No registered devices found.</td></tr>';
      return;
    }

    var html = devices.map(function (d) {
      var statusColor = d.status === 'TRUSTED' ? '#16a34a' : (d.status === 'REVOKED' ? '#dc2626' : '#d97706');
      var actionHtml = '—';
      if (d.status === 'TRUSTED') {
        actionHtml = '<button class="btn-sm btn-out" style="color:#dc2626;border-color:#fecaca;" onclick="openRevokeDeviceModal(\'' + d.deviceTrackId + '\')">Revoke</button>';
      }

      var hw = (d.info?.model || 'Device') + ' (' + (d.info?.os || 'OS') + ')';
      var browser = d.info?.browser || 'Browser';

      return '<tr>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;font-weight:600;">' + escapeHtml(d.deviceTrackId) + '</td>' +
        '<td>' + escapeHtml(hw) + '</td>' +
        '<td>' + escapeHtml(browser) + '</td>' +
        '<td><span style="font-weight:700;color:' + statusColor + ';">' + escapeHtml(d.status) + '</span></td>' +
        '<td style="font-size:11px;color:var(--tmu);">' + (d.verifiedAt ? new Date(d.verifiedAt).toLocaleDateString() : '—') + '</td>' +
        '<td style="font-size:11px;color:var(--tmu);">' + (d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleDateString() : '—') + '</td>' +
        '<td>' + actionHtml + '</td>' +
      '</tr>';
    }).join('');

    tbody.innerHTML = html;
  }

  // ─────────────────────────────────────────────────────────
  //  3. ADMIN ACTIONS: ADJUST, RESET, UNLOCK, REVOKE
  // ─────────────────────────────────────────────────────────
  function onAdjustDeltaInput(inputEl) {
    if (!inputEl) inputEl = document.getElementById('adjust-delta');
    if (!inputEl) return;
    if (inputEl.value !== '') {
      var val = Number(inputEl.value);
      if (val > 100) inputEl.value = 100;
      if (val < 0) inputEl.value = 0;
    }
    updateAdjustHint();
  }

  function updateAdjustHint() {
    var deltaEl = document.getElementById('adjust-delta');
    var hintEl = document.getElementById('adjust-hint');
    if (!deltaEl || !hintEl) return;

    var orig = deltaEl.dataset.originalScore !== undefined ? parseInt(deltaEl.dataset.originalScore, 10) : 100;
    if (isNaN(orig)) orig = 100;

    if (deltaEl.value === '') {
      hintEl.innerHTML = 'Current score: <strong>' + orig + '</strong>. Score is clamped between 0 and 100.';
      return;
    }

    var val = parseInt(deltaEl.value, 10);
    if (isNaN(val)) return;

    var d = val - orig;
    var deltaStr = d > 0 ? ('+' + d) : String(d);
    if (d === 0) {
      hintEl.innerHTML = 'Current score: <strong>' + orig + '</strong> (No change). Score is clamped between 0 and 100.';
    } else {
      hintEl.innerHTML = 'Current: <strong>' + orig + '</strong> &rarr; New: <strong>' + val + '</strong> (Delta: <strong style="color:' + (d > 0 ? '#16a34a' : '#dc2626') + ';">' + deltaStr + '</strong>). Clamped between 0 and 100.';
    }
  }

  function openAdjustScoreModal() {
    if (!_trustState.selectedStudent) return;
    var s = _trustState.selectedStudent.student;
    var idEl = document.getElementById('adjust-student-id');
    var nameEl = document.getElementById('adjust-student-name');
    var deltaEl = document.getElementById('adjust-delta');
    var reasonEl = document.getElementById('adjust-reason');

    if (idEl) idEl.value = s._id;
    if (nameEl) nameEl.value = s.fullName + ' (' + (s.registerNo || s.username) + ')';

    var currentScore = typeof s.trustScore === 'number' ? s.trustScore : (s.trust && typeof s.trust.score === 'number' ? s.trust.score : 100);
    currentScore = Math.max(0, Math.min(100, Math.round(currentScore)));

    if (deltaEl) {
      deltaEl.value = currentScore;
      deltaEl.dataset.originalScore = currentScore;
    }
    if (reasonEl) reasonEl.value = '';

    updateAdjustHint();

    if (typeof openModal_ === 'function') openModal_('m-adjust-trust');
  }

  function submitAdjustScore(event) {
    event.preventDefault();
    var sId = document.getElementById('adjust-student-id')?.value;
    var deltaEl = document.getElementById('adjust-delta');
    var reason = document.getElementById('adjust-reason')?.value?.trim();

    if (!sId || !deltaEl) return;

    var inputVal = parseInt(deltaEl.value, 10);
    if (isNaN(inputVal)) {
      showPopup('Please enter a valid score (0–100).', 'Invalid Score', 'warn');
      return;
    }

    if (inputVal > 100) {
      inputVal = 100;
      deltaEl.value = 100;
    }
    if (inputVal < 0) {
      inputVal = 0;
      deltaEl.value = 0;
    }

    var originalScore = deltaEl.dataset.originalScore !== undefined ? parseInt(deltaEl.dataset.originalScore, 10) : 100;
    if (isNaN(originalScore)) originalScore = 100;

    var delta = inputVal - originalScore;

    if (delta === 0) {
      showPopup('The student trust score is already ' + originalScore + '. Please enter a different score (0–100) to adjust.', 'No Change', 'warn');
      return;
    }

    if (!reason) {
      showPopup('A reason is required to document this adjustment in the ledger.', 'Reason Required', 'warn');
      return;
    }

    apiCall('POST', '/trust/students/' + sId + '/adjust', { delta: delta, reason: reason })
      .then(function (res) {
        showPopup(res.message || 'Trust score adjusted successfully.', 'Trust Score Adjusted', 'success');
        if (typeof closeModalBg === 'function') closeModalBg('m-adjust-trust');
        openTrustStudentDrawer(sId);
        loadTrustStudents();
        loadTrustStats();
      })
      .catch(function (err) {
        showPopup('Error adjusting trust score: ' + err.message, 'Adjustment Error', 'error');
      });
  }

  async function doResetStudentScore() {
    if (!_trustState.selectedStudent) return;
    var s = _trustState.selectedStudent.student;

    var reason = await showPrompt('Reset trust score to 100 for ' + s.fullName + '?\n\nPlease enter a reason for this audit event:', 'Admin reset trust score to 100', 'Reset Trust Score');
    if (reason === null) return;
    reason = reason.trim() || 'Admin reset trust score to 100';

    apiCall('POST', '/trust/students/' + s._id + '/reset', { reason: reason })
      .then(function (res) {
        showPopup(res.message || 'Trust score reset to 100.', 'Score Reset', 'success');
        openTrustStudentDrawer(s._id);
        loadTrustStudents();
        loadTrustStats();
      })
      .catch(function (err) {
        if (err.message && err.message.includes('Advisor consent is required')) {
          showPopup(err.message + '\n\nPlease ask the Class Advisor to log in and give consent under Device Verification.', 'Two-Person Rule (§8)', 'warn');
        } else {
          showPopup('Error resetting score: ' + err.message, 'Reset Failed', 'error');
        }
      });
  }

  async function doUnlockStudent() {
    if (!_trustState.selectedStudent) return;
    var s = _trustState.selectedStudent.student;

    var reason = await showPrompt('Unlock self-attendance for ' + s.fullName + '?\n\nPlease enter a reason:', 'Admin unlocked self-attendance', 'Unlock Attendance');
    if (reason === null) return;
    reason = reason.trim() || 'Admin unlocked self-attendance';

    apiCall('POST', '/trust/students/' + s._id + '/unlock', { reason: reason })
      .then(function (res) {
        showPopup(res.message || 'Self-attendance unlocked.', 'Attendance Unlocked', 'success');
        openTrustStudentDrawer(s._id);
        loadTrustStudents();
        loadTrustStats();
      })
      .catch(function (err) {
        if (err.message && err.message.includes('Advisor consent is required')) {
          showPopup(err.message + '\n\nPlease ask the Class Advisor to give consent first.', 'Two-Person Rule (§8)', 'warn');
        } else {
          showPopup('Error unlocking attendance: ' + err.message, 'Unlock Failed', 'error');
        }
      });
  }

  function openRevokeDeviceModal(deviceTrackId) {
    var idEl = document.getElementById('revoke-device-id');
    var trackEl = document.getElementById('revoke-device-track');
    var reasonEl = document.getElementById('revoke-device-reason');

    if (idEl) idEl.value = deviceTrackId;
    if (trackEl) trackEl.value = deviceTrackId;
    if (reasonEl) reasonEl.value = '';

    if (typeof openModal_ === 'function') openModal_('m-revoke-device');
  }

  function submitRevokeDevice(event) {
    event.preventDefault();
    var devId = document.getElementById('revoke-device-id')?.value;
    var reason = document.getElementById('revoke-device-reason')?.value?.trim();

    if (!devId) return;
    if (!reason) {
      showPopup('Please provide a reason for revoking this device.', 'Reason Required', 'warn');
      return;
    }

    apiCall('POST', '/devices/' + devId + '/revoke', { reason: reason })
      .then(function (res) {
        showPopup(res.message || 'Device revoked.', 'Device Revoked', 'success');
        if (typeof closeModalBg === 'function') closeModalBg('m-revoke-device');
        if (_trustState.selectedStudent) {
          openTrustStudentDrawer(_trustState.selectedStudent.student._id);
        }
        loadTrustStudents();
        loadTrustStats();
      })
      .catch(function (err) {
        showPopup('Error revoking device: ' + err.message, 'Revocation Failed', 'error');
      });
  }

  // ─────────────────────────────────────────────────────────
  //  4. REGISTRATION WINDOWS
  // ─────────────────────────────────────────────────────────
  function loadRegistrationWindows() {
    var tbody = document.getElementById('trust-windows-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--tmu);">Loading registration windows…</td></tr>';

    apiCall('GET', '/devices/windows').then(function (data) {
      var windows = data?.windows || [];
      _trustState.windows = windows;
      renderRegistrationWindowsTable(windows);
    }).catch(function (err) {
      console.error('Failed to load windows:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#dc2626;">Error: ' + escapeHtml(err.message) + '</td></tr>';
    });
  }

  function renderRegistrationWindowsTable(windows) {
    var tbody = document.getElementById('trust-windows-tbody');
    if (!tbody) return;

    if (!windows || windows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--tmu);">No registration windows found. Click "Create Registration Window" to open one.</td></tr>';
      return;
    }

    var now = new Date();
    var html = windows.map(function (w) {
      var isCurrent = w.active && new Date(w.from) <= now && new Date(w.to) >= now;
      var statusHtml = isCurrent
        ? '<span style="background:#dcfce7;color:#15803d;padding:3px 8px;border-radius:12px;font-size:11.5px;font-weight:600;">ACTIVE NOW</span>'
        : (w.active ? '<span style="color:#d97706;font-weight:600;">SCHEDULED</span>' : '<span style="color:var(--tmu);">CLOSED</span>');

      var targetName = w.scope === 'class' ? (w.classId?.name || 'Class') : (w.deptId?.name ? w.deptId.name + ' (' + w.deptId.code + ')' : 'Entire Institution');

      var actionBtn = w.active
        ? '<button class="btn-sm btn-out" style="color:#dc2626;border-color:#fecaca;" onclick="doCloseWindow(\'' + w.windowTrackId + '\')">Close Window</button>'
        : '<span style="color:var(--tmu);">—</span>';

      return '<tr>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;font-weight:600;">' + escapeHtml(w.windowTrackId) + '</td>' +
        '<td><span style="font-weight:600;text-transform:capitalize;">' + escapeHtml(w.scope) + '</span></td>' +
        '<td>' + escapeHtml(targetName) + '</td>' +
        '<td style="font-size:12px;">' + new Date(w.from).toLocaleString('en-IN') + '</td>' +
        '<td style="font-size:12px;">' + new Date(w.to).toLocaleString('en-IN') + '</td>' +
        '<td>' + statusHtml + '</td>' +
        '<td>' + escapeHtml(w.createdBy?.name || 'Admin') + '</td>' +
        '<td style="max-width:200px;font-size:12px;color:var(--tmu);">' + escapeHtml(w.note || '—') + '</td>' +
        '<td>' + actionBtn + '</td>' +
      '</tr>';
    }).join('');

    tbody.innerHTML = html;
  }

  function openCreateWindowModal() {
    populateDeptAndClassFilters();

    // Set default dates: now to 7 days from now
    var now = new Date();
    var later = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    var fromEl = document.getElementById('win-from');
    var toEl = document.getElementById('win-to');
    var noteEl = document.getElementById('win-note');
    var scopeEl = document.getElementById('win-scope');

    if (fromEl) fromEl.value = now.toISOString().slice(0, 16);
    if (toEl) toEl.value = later.toISOString().slice(0, 16);
    if (noteEl) noteEl.value = '';
    if (scopeEl) {
      scopeEl.value = 'department';
      onWindowScopeChange();
    }

    if (typeof openModal_ === 'function') openModal_('m-create-window');
  }

  function onWindowScopeChange() {
    var scope = document.getElementById('win-scope')?.value;
    var classFg = document.getElementById('win-class-fg');
    if (classFg) classFg.style.display = (scope === 'class') ? 'block' : 'none';
  }

  function onWindowDeptChange() {
    var deptId = document.getElementById('win-dept')?.value;
    var classes = _trustState.allClasses || ((typeof DB !== 'undefined' && DB.get) ? (DB.get('classes') || []) : []);
    updateClassDropdowns(classes, deptId);
  }

  function submitCreateWindow(event) {
    event.preventDefault();
    var scope = document.getElementById('win-scope')?.value;
    var deptId = document.getElementById('win-dept')?.value;
    var classId = document.getElementById('win-class')?.value;
    var from = document.getElementById('win-from')?.value;
    var to = document.getElementById('win-to')?.value;
    var note = document.getElementById('win-note')?.value?.trim();

    if (!from || !to) {
      showPopup('Please specify both start and end date/time.', 'Missing Dates', 'warn');
      return;
    }
    if (scope === 'class' && !classId) {
      showPopup('Please select a target class for class-scoped window.', 'Target Class Required', 'warn');
      return;
    }

    var body = {
      scope: scope,
      deptId: deptId || null,
      classId: scope === 'class' ? classId : null,
      from: from,
      to: to,
      note: note
    };

    apiCall('POST', '/devices/windows', body)
      .then(function (res) {
        showPopup('Registration window created successfully!', 'Registration Window Created', 'success');
        if (typeof closeModalBg === 'function') closeModalBg('m-create-window');
        loadRegistrationWindows();
        loadTrustStats();
      })
      .catch(function (err) {
        showPopup('Error creating window: ' + err.message, 'Window Creation Failed', 'error');
      });
  }

  async function doCloseWindow(windowId) {
    const ok = await showConfirm(
      'Are you sure you want to close registration window ' + windowId + '?\n\nAdvisors will no longer be able to generate tickets under this window.',
      'Close Registration Window',
      null,
      null,
      { danger: true, confirmText: 'Close Window' }
    );
    if (!ok) return;

    apiCall('DELETE', '/devices/windows/' + windowId)
      .then(function () {
        showPopup('Registration window closed.', 'Window Closed', 'info');
        loadRegistrationWindows();
        loadTrustStats();
      })
      .catch(function (err) {
        showPopup('Error closing window: ' + err.message, 'Close Window Failed', 'error');
      });
  }

  // ─────────────────────────────────────────────────────────
  //  5. QUEUES & REQUESTS
  // ─────────────────────────────────────────────────────────
  function loadTrustQueues() {
    var statusSel = document.getElementById('trust-queue-filter-status');
    var status = statusSel ? statusSel.value : '';

    var url = '/devices/replacement-requests' + (status ? '?status=' + encodeURIComponent(status) : '');
    var tbody = document.getElementById('trust-queues-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--tmu);">Loading queued requests…</td></tr>';

    apiCall('GET', url).then(function (data) {
      var reqs = data?.requests || [];
      _trustState.queues = reqs;

      // Update badge
      var badge = document.getElementById('trust-queue-badge');
      var pendingCount = reqs.filter(function (r) { return r.status === 'FORWARDED_TO_ADMIN'; }).length;
      if (badge) {
        badge.textContent = pendingCount;
        badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
      }

      renderTrustQueuesTable(reqs);
    }).catch(function (err) {
      console.error('Failed to load queues:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#dc2626;">Error: ' + escapeHtml(err.message) + '</td></tr>';
    });
  }

  function renderTrustQueuesTable(reqs) {
    var tbody = document.getElementById('trust-queues-tbody');
    if (!tbody) return;

    if (!reqs || reqs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--tmu);">No queued requests found.</td></tr>';
      return;
    }

    var html = reqs.map(function (r) {
      var s = r.studentId || {};
      var statusColor = r.status === 'APPROVED' ? '#16a34a' : (r.status === 'REJECTED' ? '#dc2626' : '#d97706');

      var actionHtml = '—';
      if (r.status === 'FORWARDED_TO_ADMIN' || r.status === 'PENDING_ADVISOR') {
        actionHtml = '<div style="display:flex;gap:4px;">' +
          '<button class="btn-sm btn-pri" onclick="doIssueReplacementTicket(\'' + r.requestId + '\')" title="Issue 12-char ticket">Issue Ticket</button>' +
          '<button class="btn-sm btn-out" style="color:#dc2626;border-color:#fecaca;" onclick="doRejectReplacementRequest(\'' + r.requestId + '\')">Reject</button>' +
        '</div>';
      }

      var advReview = r.reviewedByAdvisor?.name ? r.reviewedByAdvisor.name + (r.reviewedByAdvisor.note ? ' ("' + r.reviewedByAdvisor.note + '")' : '') : '—';

      return '<tr>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;font-weight:600;">' + escapeHtml(r.requestId) + '</td>' +
        '<td><span style="font-weight:600;">' + escapeHtml(r.type) + '</span></td>' +
        '<td>' +
          '<div style="font-weight:600;">' + escapeHtml(s.fullName || 'Student') + '</div>' +
          '<div style="font-size:11px;color:var(--tmu);font-family:\'JetBrains Mono\',monospace;">' + escapeHtml(s.registerNo || r.studentTrackId) + '</div>' +
        '</td>' +
        '<td>' + escapeHtml(r.deptId?.name || '') + '</td>' +
        '<td><span style="text-transform:capitalize;">' + escapeHtml(r.reason) + '</span>' + (r.note ? '<br><small style="color:var(--tmu);">' + escapeHtml(r.note) + '</small>' : '') + '</td>' +
        '<td><span style="font-weight:700;color:' + statusColor + ';">' + escapeHtml(r.status) + '</span></td>' +
        '<td style="font-size:11.5px;color:var(--tmu);">' + new Date(r.createdAt).toLocaleDateString() + '</td>' +
        '<td style="font-size:12px;color:var(--tmu);max-width:180px;">' + escapeHtml(advReview) + '</td>' +
        '<td>' + actionHtml + '</td>' +
      '</tr>';
    }).join('');

    tbody.innerHTML = html;
  }

  async function doIssueReplacementTicket(requestId) {
    const ok = await showConfirm(
      'Issue a device replacement ticket for request ' + requestId + '?\n\nThis will generate a new 12-character credential for the student phone.',
      'Issue Replacement Ticket'
    );
    if (!ok) return;

    apiCall('POST', '/devices/replacement-requests/' + requestId + '/issue')
      .then(function (res) {
        showPopup('Ticket ID: ' + res.ticketId + '\n12-Char Credential: ' + res.credential + '\nStudent: ' + res.studentName + ' (' + res.registerNo + ')\nValid for: 10 minutes\n\nPlease give this credential to the student to enter on their new device.', 'Replacement Ticket Issued', 'success');
        loadTrustQueues();
        loadTrustStats();
      })
      .catch(function (err) {
        showPopup('Error issuing ticket: ' + err.message, 'Ticket Issuance Failed', 'error');
      });
  }

  async function doRejectReplacementRequest(requestId) {
    var note = await showPrompt('Please enter a rejection reason for request ' + requestId + ':', 'Rejected by administrator', 'Reject Request');
    if (note === null) return;
    note = note.trim() || 'Rejected by administrator';

    apiCall('POST', '/devices/replacement-requests/' + requestId + '/reject', { note: note })
      .then(function () {
        showPopup('Request rejected.', 'Request Rejected', 'info');
        loadTrustQueues();
      })
      .catch(function (err) {
        showPopup('Error rejecting request: ' + err.message, 'Action Failed', 'error');
      });
  }

  // ─────────────────────────────────────────────────────────
  //  6. REGISTRATION HISTORY
  // ─────────────────────────────────────────────────────────
  function loadTrustHistory() {
    var stageSel = document.getElementById('trust-history-filter-stage');
    var stage = stageSel ? stageSel.value : '';

    var url = '/devices/history' + (stage ? '?stage=' + encodeURIComponent(stage) : '');
    var tbody = document.getElementById('trust-history-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--tmu);">Loading registration tickets…</td></tr>';

    apiCall('GET', url).then(function (data) {
      var tickets = data?.tickets || [];
      _trustState.history = tickets;
      renderTrustHistoryTable(tickets);
    }).catch(function (err) {
      console.error('Failed to load history:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#dc2626;">Error: ' + escapeHtml(err.message) + '</td></tr>';
    });
  }

  function renderTrustHistoryTable(tickets) {
    var tbody = document.getElementById('trust-history-tbody');
    if (!tbody) return;

    if (!tickets || tickets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--tmu);">No registration tickets recorded.</td></tr>';
      return;
    }

    var html = tickets.map(function (t) {
      var s = t.student || {};
      var stageColor = t.stage === 'VERIFIED' ? '#16a34a' : (t.stage === 'ISSUED' ? '#2563eb' : '#64748b');

      return '<tr>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;font-weight:600;">' + escapeHtml(t.ticketId) + '</td>' +
        '<td>' +
          '<div style="font-weight:600;">' + escapeHtml(s.fullName || 'Student') + '</div>' +
          '<div style="font-size:11px;color:var(--tmu);font-family:\'JetBrains Mono\',monospace;">' + escapeHtml(s.registerNo || t.studentTrackId) + '</div>' +
        '</td>' +
        '<td>' + escapeHtml(t.deptName || '') + '</td>' +
        '<td><span style="text-transform:capitalize;">' + escapeHtml(t.kind) + '</span></td>' +
        '<td><span style="font-weight:700;color:' + stageColor + ';">' + escapeHtml(t.stage) + '</span></td>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;font-size:11.5px;">' + escapeHtml(t.deviceTrackId || '—') + '</td>' +
        '<td style="font-size:12px;">' + escapeHtml(t.issuedBy?.name || 'Advisor') + '</td>' +
        '<td style="font-size:11.5px;color:var(--tmu);">' + new Date(t.createdAt).toLocaleString('en-IN') + '</td>' +
        '<td style="font-size:11.5px;color:var(--tmu);">' + (t.usedAt ? new Date(t.usedAt).toLocaleString('en-IN') : '—') + '</td>' +
      '</tr>';
    }).join('');

    tbody.innerHTML = html;
  }

  // ─────────────────────────────────────────────────────────
  //  7. ADMIN DISPUTES QUEUE & DECISION (§12, T6.3)
  // ─────────────────────────────────────────────────────────
  function loadAdminDisputes() {
    var statusSel = document.getElementById('trust-disp-filter-status');
    var status = statusSel ? statusSel.value : '';

    var url = '/trust/disputes' + (status ? '?status=' + encodeURIComponent(status) : '');
    var tbody = document.getElementById('trust-disputes-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tmu);">Loading disputes queue…</td></tr>';

    apiCall('GET', url).then(function (data) {
      var disputes = data?.disputes || [];
      _trustState.disputes = disputes;
      renderAdminDisputesTable(disputes);
    }).catch(function (err) {
      console.error('Failed to load admin disputes:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#dc2626;">Error: ' + escapeHtml(err.message) + '</td></tr>';
    });
  }

  function renderAdminDisputesTable(disputes) {
    var tbody = document.getElementById('trust-disputes-tbody');
    if (!tbody) return;

    if (!disputes || disputes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tmu);">No disputes in this queue.</td></tr>';
      return;
    }

    var html = disputes.map(function (d) {
      var s = d.studentId || {};
      var statusColor = d.status === 'ACCEPTED' ? '#16a34a' : (d.status.startsWith('REJECTED') ? '#dc2626' : '#d97706');
      var statusBg = d.status === 'ACCEPTED' ? '#dcfce7' : (d.status.startsWith('REJECTED') ? '#fee2e2' : '#fef3c7');
      var statusBadge = '<span style="background:' + statusBg + ';color:' + statusColor + ';padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">' + escapeHtml(d.status) + '</span>';

      var advAct = d.advisorReview?.action ? ('<b>' + escapeHtml(d.advisorReview.action) + '</b>' + (d.advisorReview.note ? '<br><small style="color:var(--tmu); font-size:11px;">"' + escapeHtml(d.advisorReview.note) + '"</small>' : '')) : '—';
      var dateStr = d.eventDate ? new Date(d.eventDate).toLocaleDateString() : '—';

      return '<tr>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;font-weight:600;">' + escapeHtml(d.disputeTrackId) + '</td>' +
        '<td>' +
          '<div style="font-weight:600;">' + escapeHtml(d.studentName || s.fullName || 'Student') + '</div>' +
          '<div style="font-size:11px;color:var(--tmu);font-family:\'JetBrains Mono\',monospace;">' + escapeHtml(d.regNo || s.registerNo || d.studentTrackId) + '</div>' +
        '</td>' +
        '<td>' + escapeHtml(d.className || '') + (d.deptCode ? ' (' + escapeHtml(d.deptCode) + ')' : '') + '</td>' +
        '<td><div><b>' + escapeHtml(d.eventType) + '</b></div><div style="font-size:11px;color:var(--tmu);">' + dateStr + '</div></td>' +
        '<td style="color:#dc2626;font-weight:800;">-' + (d.pointsDeducted || 0) + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td style="font-size:12px;max-width:200px;">' + advAct + '</td>' +
        '<td style="text-align:right;"><button class="btn-sm btn-pri" onclick="openAdminDisputeDrawer(\'' + d._id + '\')">Inspect &amp; Decide</button></td>' +
      '</tr>';
    }).join('');

    tbody.innerHTML = html;
  }

  function openAdminDisputeDrawer(disputeId) {
    var dispute = (_trustState.disputes || []).find(function (d) { return String(d._id) === String(disputeId); });
    if (!dispute) return;

    var titleEl = document.getElementById('admin-disp-title');
    var bodyEl = document.getElementById('admin-disp-body');
    var actEl = document.getElementById('admin-disp-actions');
    if (!bodyEl || !actEl) return;

    if (titleEl) titleEl.textContent = 'Dispute Decision · ' + dispute.disputeTrackId;

    var snap = dispute.evidenceSnapshot || {};
    var devSnap = snap.deviceSnapshot || {};

    var html = '<div style="background:#f8fafc;border:1px solid var(--bdr);border-radius:12px;padding:16px;margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
      + '<div><span style="font-size:16px;font-weight:800;">' + escapeHtml(dispute.studentName) + '</span> <span style="font-size:12px;color:var(--tmu);font-family:\'JetBrains Mono\',monospace;">(' + escapeHtml(dispute.regNo) + ')</span></div>'
      + '<span style="font-size:12px;font-weight:700;color:var(--tmu);">' + escapeHtml(dispute.className) + '</span>'
      + '</div>'
      + '<div style="font-size:12px;color:var(--tmu);margin-bottom:12px;">Disputed Event: <b>' + escapeHtml(dispute.eventType) + '</b> · Deduction: <b style="color:#dc2626;">-' + (dispute.pointsDeducted || 0) + ' pts</b> · Date: ' + (dispute.eventDate ? new Date(dispute.eventDate).toLocaleDateString() : '—') + '</div>'
      + '<div style="background:#fff;border:1px solid var(--bdr);border-radius:8px;padding:12px;">'
      + '<div style="font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Student Explanation</div>'
      + '<div style="font-size:13px;color:var(--td);margin-top:4px;line-height:1.45;">"' + escapeHtml(dispute.reason) + '"</div>'
      + '</div>'
      + '</div>';

    // Frozen Evidence Card
    html += '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px;margin-bottom:16px;font-size:12.5px;color:#1e40af;">'
      + '<div style="font-weight:800;font-size:13.5px;margin-bottom:8px;display:flex;align-items:center;gap:6px;"><re-icon icon="camera" size="14"></re-icon> Frozen Evidence Snapshot (§12)</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">'
      + '<div>• Session: <b>' + escapeHtml(snap.attendanceSession?.sessionTrackId || snap.attendanceSession?.date || 'Live Session') + '</b></div>'
      + '<div>• Verification Result: <b>' + escapeHtml(snap.teacherVerification?.result || 'N/A') + '</b></div>'
      + '<div>• Device Score at mark: <b>' + (devSnap.deviceScoreAtMark !== undefined ? devSnap.deviceScoreAtMark + '/50' : 'N/A') + '</b></div>'
      + '<div>• Assessed Risk Level: <b>' + escapeHtml(devSnap.riskLevelAtMark || 'N/A') + '</b></div>'
      + '<div>• Trust Before: <b>' + (snap.trustBefore || 100) + '</b> → After: <b>' + (snap.trustAfter || 100) + '</b></div>'
      + '<div>• Risk Reasons: <b>' + escapeHtml((snap.riskReasons || []).join(', ') || 'None') + '</b></div>'
      + '</div>'
      + '</div>';

    // Statements Review
    if (dispute.teacherInvolved?.statement) {
      html += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:14px;margin-bottom:16px;">'
        + '<div style="font-size:11.5px;font-weight:700;color:#166534;text-transform:uppercase;">Teacher Statement (' + escapeHtml(dispute.teacherInvolved.teacherName || 'Session Teacher') + ')</div>'
        + '<div style="font-size:13px;color:#14532d;margin-top:4px;">"' + escapeHtml(dispute.teacherInvolved.statement) + '"</div>'
        + '</div>';
    }
    if (dispute.advisorReview?.note) {
      html += '<div style="background:#fefce8;border:1px solid #fef08a;border-radius:12px;padding:14px;margin-bottom:16px;">'
        + '<div style="font-size:11.5px;font-weight:700;color:#854d0e;text-transform:uppercase;">Advisor Review (' + escapeHtml(dispute.advisorReview.action) + ' by ' + escapeHtml(dispute.advisorReview.advisorName || 'Advisor') + ')</div>'
        + '<div style="font-size:13px;color:#713f12;margin-top:4px;">"' + escapeHtml(dispute.advisorReview.note) + '"</div>'
        + '</div>';
    }

    // Decision Form
    var isPending = ['PENDING_ADMIN', 'PENDING_ADVISOR'].includes(dispute.status);
    if (isPending) {
      html += '<div class="card" style="padding:14px;border:1.5px dashed var(--bdr);margin-bottom:8px;">'
        + '<div style="font-size:13px;font-weight:800;color:var(--td);margin-bottom:10px;">Department Administrative Decision</div>'
        + '<div class="fg" style="margin-bottom:12px;">'
        + '<label class="fl">Decision Note <span style="color:#ef4444;">*</span></label>'
        + '<textarea class="fc" id="admin-disp-note" rows="2" placeholder="Required explanation for the decision ledger and student notification..." required></textarea>'
        + '</div>'
        + '<div class="fg">'
        + '<label class="fl">Override Target Trust Score (Optional, Leave blank to restore exact +' + (dispute.pointsDeducted || 0) + ' pts)</label>'
        + '<input type="number" class="fc" id="admin-disp-new-score" placeholder="e.g. 100" min="0" max="100">'
        + '</div>'
        + '</div>';

      actEl.innerHTML = '<button type="button" class="btn-out" onclick="closeModalBg(\'m-admin-dispute-drawer\')">Cancel</button>'
        + '<button type="button" class="btn-pri" style="background:#dc2626;border-color:#dc2626;" onclick="submitAdminDisputeDecision(\'' + dispute._id + '\', \'REJECT\')">✕ Reject Dispute</button>'
        + '<button type="button" class="btn-pri" style="background:#16a34a;border-color:#16a34a;" onclick="submitAdminDisputeDecision(\'' + dispute._id + '\', \'ACCEPT\')">✓ Accept Dispute &amp; Execute Correction</button>';
    } else {
      html += '<div style="text-align:center;padding:14px;background:#f8fafc;border-radius:10px;font-size:12.5px;color:var(--tmu);">'
        + 'Dispute was finalized with status <b>' + escapeHtml(dispute.status) + '</b>.'
        + '</div>';
      actEl.innerHTML = '<button type="button" class="btn-out" onclick="closeModalBg(\'m-admin-dispute-drawer\')">Close</button>';
    }

    bodyEl.innerHTML = html;
    if (typeof openModal_ === 'function') openModal_('m-admin-dispute-drawer');
  }

  async function submitAdminDisputeDecision(disputeId, decision) {
    var note = document.getElementById('admin-disp-note')?.value?.trim();
    if (!note) {
      showPopup('Please provide a decision note explaining your rationale.', 'Decision Note Required', 'warn');
      return;
    }

    var scoreVal = document.getElementById('admin-disp-new-score')?.value;
    var newTrustScore = scoreVal ? Number(scoreVal) : null;

    var confirmMsg = decision === 'ACCEPT'
      ? 'Are you sure you want to ACCEPT this dispute?\n\nThis will automatically:\n• Correct attendance to Present\n• Restore trust points\n• Remove active locks\n• Award +2% one-time semester bonus\n• Record an institutional grievance'
      : 'Are you sure you want to REJECT this dispute?';

    const ok = await showConfirm(
      confirmMsg,
      decision === 'ACCEPT' ? 'Accept Attendance Dispute' : 'Reject Attendance Dispute',
      null,
      null,
      { danger: decision !== 'ACCEPT', confirmText: decision === 'ACCEPT' ? 'Accept Dispute' : 'Reject Dispute' }
    );
    if (!ok) return;

    apiCall('POST', '/trust/disputes/' + disputeId + '/decide', {
      decision: decision,
      note: note,
      newTrustScore: newTrustScore
    })
      .then(function (res) {
        showPopup(res.message || 'Dispute decision processed successfully!', 'Dispute Decision Processed', 'success');
        if (typeof closeModalBg === 'function') closeModalBg('m-admin-dispute-drawer');
        loadAdminDisputes();
        loadTrustStudents();
        loadTrustStats();
      })
      .catch(function (err) {
        showPopup('Error deciding dispute: ' + err.message, 'Decision Failed', 'error');
      });
  }

  // ─────────────────────────────────────────────────────────
  //  8. DEVICE SHARING & FRIEND-MARKING CASES (§13, T7)
  // ─────────────────────────────────────────────────────────
  function loadDeviceShareCases() {
    var statusSel = document.getElementById('trust-cases-filter-status');
    var status = statusSel ? statusSel.value : '';

    var url = '/trust/cases' + (status ? '?status=' + encodeURIComponent(status) : '');
    var tbody = document.getElementById('trust-cases-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tmu);">Loading device share cases…</td></tr>';

    apiCall('GET', url).then(function (data) {
      var cases = data?.cases || [];
      _trustState.cases = cases;
      renderDeviceShareCasesTable(cases);
    }).catch(function (err) {
      console.error('Failed to load device share cases:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#dc2626;">Error: ' + escapeHtml(err.message) + '</td></tr>';
    });
  }

  function renderDeviceShareCasesTable(cases) {
    var tbody = document.getElementById('trust-cases-tbody');
    if (!tbody) return;

    if (!cases || cases.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tmu);">No device sharing cases in this queue.</td></tr>';
      return;
    }

    var html = cases.map(function (c) {
      var statusColor = c.status === 'CONFIRMED' ? '#dc2626' : (c.status === 'DISMISSED' ? '#64748b' : '#d97706');
      var statusBg = c.status === 'CONFIRMED' ? '#fee2e2' : (c.status === 'DISMISSED' ? '#f1f5f9' : '#fef3c7');
      var statusBadge = '<span style="background:' + statusBg + ';color:' + statusColor + ';padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">' + escapeHtml(c.status) + '</span>';

      var studentsHtml = (c.students || []).map(function (st) {
        var sObj = st.studentId || {};
        var sName = sObj.fullName || sObj.name || 'Student';
        var sReg = sObj.registerNo || st.studentTrackId || '—';
        return '<div style="margin-bottom:3px;"><span style="font-weight:600;">' + escapeHtml(sName) + '</span> <small style="color:var(--tmu);font-family:\'JetBrains Mono\',monospace;">(' + escapeHtml(sReg) + ')</small></div>';
      }).join('');

      var signalsHtml = (c.signals || []).map(function (sig) {
        return '<span style="display:inline-block;background:#f1f5f9;color:#334155;padding:1px 6px;border-radius:6px;font-size:10.5px;font-family:\'JetBrains Mono\',monospace;margin:1px 2px;">' + escapeHtml(sig) + '</span>';
      }).join(' ');

      var srcBadge = c.detectionSource === 'REGISTRATION'
        ? '<span style="background:#e0e7ff;color:#3730a3;padding:2px 7px;border-radius:6px;font-size:11px;font-weight:600;">Registration</span>'
        : '<span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:6px;font-size:11px;font-weight:600;">Attendance</span>';

      var dateStr = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—';

      var decisionSummary = '—';
      if (c.status === 'CONFIRMED') {
        decisionSummary = '<span style="font-size:11.5px;color:#dc2626;font-weight:600;">Penalized (-' + (c.penalties?.adjustmentPercentage || 5) + '%, ' + (c.penalties?.absentDaysApplied || 7) + 'd Abs, ' + (c.penalties?.lockDaysApplied || 15) + 'd Lock)</span>';
      } else if (c.status === 'DISMISSED') {
        decisionSummary = '<span style="font-size:11.5px;color:var(--tmu);">Dismissed by ' + escapeHtml(c.decision?.decidedBy?.name || 'Admin') + '</span>';
      } else {
        decisionSummary = '<span style="font-size:11.5px;color:#d97706;font-weight:600;">Pending Review</span>';
      }

      var actionText = c.status === 'OPEN' ? 'Review &amp; Penalize' : 'Inspect Details';

      return '<tr>' +
        '<td style="font-family:\'JetBrains Mono\',monospace;font-weight:600;">' + escapeHtml(c.caseId) + '</td>' +
        '<td>' + studentsHtml + '</td>' +
        '<td>' + srcBadge + '</td>' +
        '<td>' + signalsHtml + '</td>' +
        '<td style="font-size:11.5px;color:var(--tmu);">' + dateStr + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td style="max-width:200px;">' + decisionSummary + '</td>' +
        '<td style="text-align:right;"><button class="btn-sm btn-pri" onclick="openDeviceShareCaseDrawer(\'' + c._id + '\')">' + actionText + '</button></td>' +
      '</tr>';
    }).join('');

    tbody.innerHTML = html;
  }

  function openDeviceShareCaseDrawer(caseId) {
    var c = (_trustState.cases || []).find(function (item) {
      return String(item._id) === String(caseId) || String(item.caseId) === String(caseId);
    });
    if (!c) return;

    var titleEl = document.getElementById('admin-case-title');
    var bodyEl = document.getElementById('admin-case-body');
    var actEl = document.getElementById('admin-case-actions');
    if (!bodyEl || !actEl) return;

    if (titleEl) titleEl.textContent = 'Device Sharing Case · ' + c.caseId;

    var devInfo = c.deviceInfo || {};
    var statusColor = c.status === 'CONFIRMED' ? '#dc2626' : (c.status === 'DISMISSED' ? '#64748b' : '#d97706');

    var html = '<div style="background:#f8fafc;border:1px solid var(--bdr);border-radius:12px;padding:16px;margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
      + '<div><span style="font-size:16px;font-weight:800;color:var(--td);">' + escapeHtml(c.caseId) + '</span> · <span style="font-weight:600;color:var(--tmu);">' + escapeHtml(c.deptId?.name || 'Department') + '</span></div>'
      + '<span style="font-size:12px;font-weight:700;color:' + statusColor + ';">Status: ' + escapeHtml(c.status) + '</span>'
      + '</div>'
      + '<div style="font-size:12px;color:var(--tmu);">'
      + 'Source: <b>' + escapeHtml(c.detectionSource) + '</b> · Detected on: <b>' + new Date(c.createdAt).toLocaleString('en-IN') + '</b>'
      + '</div>'
      + '</div>';

    // Students Involved Card
    html += '<div class="card" style="padding:14px;margin-bottom:16px;border:1px solid var(--bdr);">'
      + '<div style="font-size:13px;font-weight:800;color:var(--td);margin-bottom:10px;display:flex;align-items:center;gap:6px;"><re-icon icon="users" size="14"></re-icon> Involved Students (' + (c.students || []).length + ')</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';

    (c.students || []).forEach(function (st, idx) {
      var sObj = st.studentId || {};
      html += '<div style="background:#fff;border:1px solid var(--bdr);border-radius:8px;padding:10px;">'
        + '<div style="font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Student ' + (idx === 0 ? 'A (Registered / Earlier)' : 'B (Colliding / Attempted)') + '</div>'
        + '<div style="font-size:14px;font-weight:800;color:var(--td);margin-top:2px;">' + escapeHtml(sObj.fullName || sObj.name || 'Student') + '</div>'
        + '<div style="font-size:11.5px;color:var(--tmu);font-family:\'JetBrains Mono\',monospace;">' + escapeHtml(sObj.registerNo || st.studentTrackId || '—') + '</div>'
        + (sObj.currentSemester ? '<div style="font-size:11px;color:var(--tmu);margin-top:2px;">Semester: ' + sObj.currentSemester + '</div>' : '')
        + '</div>';
    });

    html += '</div></div>';

    // Collision Signals & Device Hardware Card
    html += '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px;margin-bottom:16px;font-size:12.5px;color:#9a3412;">'
      + '<div style="font-weight:800;font-size:13px;margin-bottom:8px;display:flex;align-items:center;gap:6px;"><re-icon icon="shield-alert" size="14"></re-icon> Collision Signals &amp; Device Identity (§13)</div>'
      + '<div style="margin-bottom:8px;">Signals: ' + (c.signals || []).map(function (s) { return '<span style="background:#ffedd5;color:#c2410c;padding:2px 6px;border-radius:4px;font-weight:700;font-size:11px;margin-right:4px;">' + escapeHtml(s) + '</span>'; }).join('') + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11.5px;color:#7c2d12;">'
      + '<div>• IP Address: <b>' + escapeHtml(devInfo.ip || '—') + '</b></div>'
      + '<div>• Fingerprint Hash: <b style="font-family:\'JetBrains Mono\',monospace;">' + escapeHtml((devInfo.rawFingerprint || '').slice(0, 16) || '—') + '…</b></div>'
      + '<div style="grid-column:1 / -1;">• User Agent: <span style="font-size:11px;color:var(--tmu);">' + escapeHtml(devInfo.userAgent || '—') + '</span></div>'
      + (c.attendanceSessionId ? ('<div>• Attendance Session ID: <b>' + escapeHtml(c.attendanceSessionId) + '</b></div>') : '')
      + '</div>'
      + '</div>';

    // Penalties or Decision info
    if (c.status === 'CONFIRMED') {
      var pen = c.penalties || {};
      html += '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:14px;margin-bottom:16px;color:#991b1b;">'
        + '<div style="font-size:13px;font-weight:800;margin-bottom:4px;">⚠️ Confirmed Friend-Marking Penalties Applied</div>'
        + '<div style="font-size:12px;line-height:1.5;">'
        + '• Converted past <b>' + (pen.absentDaysApplied || 7) + ' days</b> of self-marked attendance to Absent for both students.<br>'
        + '• Self-attendance locked for <b>' + (pen.lockDaysApplied || 15) + ' days</b>.<br>'
        + '• Recorded <b>-' + (pen.adjustmentPercentage || 5) + '%</b> institutional attendance adjustment.<br>'
        + '• Ledger events recorded with reason: <em>"' + escapeHtml(c.decision?.note || 'Confirmed friend-marking') + '"</em>.'
        + '</div>'
        + '</div>';
      actEl.innerHTML = '<button type="button" class="btn-out" onclick="closeModalBg(\'m-admin-case-drawer\')">Close</button>';
    } else if (c.status === 'DISMISSED') {
      html += '<div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:12px;padding:14px;margin-bottom:16px;color:#334155;">'
        + '<div style="font-size:13px;font-weight:800;margin-bottom:4px;">Case Dismissed</div>'
        + '<div style="font-size:12px;">Dismissal note: "' + escapeHtml(c.decision?.note || 'No malicious activity confirmed') + '"</div>'
        + '</div>';
      actEl.innerHTML = '<button type="button" class="btn-out" onclick="closeModalBg(\'m-admin-case-drawer\')">Close</button>';
    } else {
      // OPEN status: Decision form
      html += '<div class="card" style="padding:16px;border:1.5px dashed var(--bdr);margin-bottom:8px;">'
        + '<div style="font-size:13px;font-weight:800;color:var(--td);margin-bottom:12px;">Execute Administrative Decision (§13)</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">'
        + '<div class="fg">'
        + '<label class="fl">Days to Convert to Absent (Past N Days)</label>'
        + '<input type="number" class="fc" id="admin-case-absent-days" value="7" min="1" max="60">'
        + '<small style="color:var(--tmu);font-size:11px;">Default 7 days per §13 policy</small>'
        + '</div>'
        + '<div class="fg">'
        + '<label class="fl">Self-Attendance Lock Duration (Days)</label>'
        + '<input type="number" class="fc" id="admin-case-lock-days" value="15" min="1" max="90">'
        + '<small style="color:var(--tmu);font-size:11px;">Default 15 days per §13 policy</small>'
        + '</div>'
        + '</div>'
        + '<div class="fg">'
        + '<label class="fl">Investigation &amp; Decision Note <span style="color:#ef4444;">*</span></label>'
        + '<textarea class="fc" id="admin-case-note" rows="2" placeholder="Required explanation for the audit log, student dispute ledger, and records..." required></textarea>'
        + '</div>'
        + '</div>';

      actEl.innerHTML = '<button type="button" class="btn-out" onclick="closeModalBg(\'m-admin-case-drawer\')">Cancel</button>'
        + '<button type="button" class="btn-out" style="color:#64748b;" onclick="submitDeviceShareDecision(\'' + c._id + '\', \'DISMISS\')">Dismiss Case (No Penalty)</button>'
        + '<button type="button" class="btn-pri" style="background:#dc2626;border-color:#dc2626;" onclick="submitDeviceShareDecision(\'' + c._id + '\', \'CONFIRM\')">🚨 Confirm &amp; Penalize Both Students</button>';
    }

    bodyEl.innerHTML = html;
    if (typeof openModal_ === 'function') openModal_('m-admin-case-drawer');
  }

  async function submitDeviceShareDecision(caseId, action) {
    var note = document.getElementById('admin-case-note')?.value?.trim();

    if (action === 'DISMISS') {
      if (!note) {
        note = await showPrompt('Please provide a dismissal note for case ' + caseId + ':', 'Dismissed by administrator', 'Dismiss Case');
        if (note === null) return;
        note = note.trim() || 'Dismissed by administrator';
      }

      const okDismiss = await showConfirm('Dismiss this device sharing case without penalties?', 'Dismiss Case');
      if (!okDismiss) return;

      apiCall('POST', '/trust/cases/' + caseId + '/dismiss', { note: note })
        .then(function (res) {
          showPopup(res.message || 'Case dismissed.', 'Case Dismissed', 'info');
          if (typeof closeModalBg === 'function') closeModalBg('m-admin-case-drawer');
          loadDeviceShareCases();
          loadTrustStats();
        })
        .catch(function (err) {
          showPopup('Error dismissing case: ' + err.message, 'Action Failed', 'error');
        });
      return;
    }

    if (action === 'CONFIRM') {
      if (!note) {
        showPopup('Please provide a decision note explaining your rationale before confirming penalties.', 'Decision Note Required', 'warn');
        return;
      }

      var absentDays = parseInt(document.getElementById('admin-case-absent-days')?.value || '7', 10);
      var lockDays = parseInt(document.getElementById('admin-case-lock-days')?.value || '15', 10);

      var confirmMsg = '⚠️ CONFIRM FRIEND-MARKING & EXECUTE PENALTIES?\n\n'
        + 'This will apply the following penalties to BOTH students (§13):\n'
        + '1. Turn all self-marked attendance in the past ' + absentDays + ' days to ABSENT.\n'
        + '2. Lock self-attendance for ' + lockDays + ' days (cannot scan QR / Quick Pass).\n'
        + '3. Apply -5% attendance adjustment to semester attendance total.\n'
        + '4. Write immutable DEVICE_SHARED trust ledger events.\n\n'
        + 'Are you sure you want to proceed?';

      const okConfirm = await showConfirm(
        confirmMsg,
        'Confirm Friend-Marking Penalties',
        null,
        null,
        { danger: true, confirmText: 'Confirm Penalties' }
      );
      if (!okConfirm) return;

      apiCall('POST', '/trust/cases/' + caseId + '/confirm', {
        absentDays: absentDays,
        lockDays: lockDays,
        reason: note
      })
        .then(function (res) {
          showPopup(res.message || 'Friend-marking penalties executed successfully!', 'Penalties Executed', 'warn');
          if (typeof closeModalBg === 'function') closeModalBg('m-admin-case-drawer');
          loadDeviceShareCases();
          loadTrustStudents();
          loadTrustStats();
        })
        .catch(function (err) {
          showPopup('Error executing case decision: ' + err.message, 'Execution Failed', 'error');
        });
    }
  }

  // ─────────────────────────────────────────────────────────
  //  WINDOW EXPORTS
  // ─────────────────────────────────────────────────────────
  window.initTrustDevicesModule = initTrustDevicesModule;
  window.refreshTrustModule = refreshTrustModule;
  window.switchTrustSubTab = switchTrustSubTab;
  window.debounceTrustStudentSearch = debounceTrustStudentSearch;
  window.loadTrustStudents = loadTrustStudents;
  window.openTrustStudentDrawer = openTrustStudentDrawer;
  window.switchDrawerTab = switchDrawerTab;
  window.openAdjustScoreModal = openAdjustScoreModal;
  window.onAdjustDeltaInput = onAdjustDeltaInput;
  window.submitAdjustScore = submitAdjustScore;
  window.doResetStudentScore = doResetStudentScore;
  window.doUnlockStudent = doUnlockStudent;
  window.openRevokeDeviceModal = openRevokeDeviceModal;
  window.submitRevokeDevice = submitRevokeDevice;
  window.openCreateWindowModal = openCreateWindowModal;
  window.onWindowScopeChange = onWindowScopeChange;
  window.onWindowDeptChange = onWindowDeptChange;
  window.onTrustDeptFilterChange = onTrustDeptFilterChange;
  window.submitCreateWindow = submitCreateWindow;
  window.doCloseWindow = doCloseWindow;
  window.loadTrustQueues = loadTrustQueues;
  window.doIssueReplacementTicket = doIssueReplacementTicket;
  window.doRejectReplacementRequest = doRejectReplacementRequest;
  window.loadTrustHistory = loadTrustHistory;
  window.loadAdminDisputes = loadAdminDisputes;
  window.renderAdminDisputesTable = renderAdminDisputesTable;
  window.openAdminDisputeDrawer = openAdminDisputeDrawer;
  window.submitAdminDisputeDecision = submitAdminDisputeDecision;
  window.loadDeviceShareCases = loadDeviceShareCases;
  window.renderDeviceShareCasesTable = renderDeviceShareCasesTable;
  window.openDeviceShareCaseDrawer = openDeviceShareCaseDrawer;
  window.submitDeviceShareDecision = submitDeviceShareDecision;

})(window, document);

