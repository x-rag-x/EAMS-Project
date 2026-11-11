/**
 * public/js/pages/control.roster.js
 *
 * Attendance Roster Page Controller (AttReg Part 1)
 * Admin-only day view and period forensics:
 * - Cascading selectors: Dept -> Class -> Date
 * - Full-day matrix view (default)
 * - Forensic period detail view (joined to LoginHistory & device trust)
 * - Interactive student drawer with trust breakdown
 * - URL deep linking without local storage
 */

(function () {
  'use strict';

  var rosterState = {
    departments: [],
    classes: [],
    selectedDeptId: '',
    selectedClassId: '',
    selectedDate: '',
    selectedPeriod: null, // null = full day matrix, 1..N = period forensics
    searchQuery: '',
    activeFilter: 'all', // all, absent, low-trust, shared-device, unmarked
    rosterData: null,
    loading: false
  };

  function getTodayIST() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function readUrlParams() {
    var p = new URLSearchParams(window.location.search);
    return {
      classId: p.get('classId') || '',
      date: p.get('date') || '',
      period: p.get('period') ? parseInt(p.get('period'), 10) : null
    };
  }

  function updateUrlParams() {
    if (!window.history || !window.history.replaceState) return;
    var url = new URL(window.location);
    var curTab = url.searchParams.get('tab');
    if (curTab && curTab !== 'roster') return;

    if (curTab === 'roster') {
      url.searchParams.set('tab', 'roster');
    }

    var classObj = (rosterState.classes || []).find(function (c) {
      return String(c.id) === String(rosterState.selectedClassId) ||
             String(c.trackId) === String(rosterState.selectedClassId) ||
             String(c.name) === String(rosterState.selectedClassId);
    });
    var trackIdToSet = classObj ? (classObj.trackId || classObj.name || classObj.id) : rosterState.selectedClassId;
    if (trackIdToSet) url.searchParams.set('classId', trackIdToSet);
    else url.searchParams.delete('classId');

    if (rosterState.selectedDate) url.searchParams.set('date', rosterState.selectedDate);
    else url.searchParams.delete('date');

    if (rosterState.selectedPeriod) url.searchParams.set('period', rosterState.selectedPeriod);
    else url.searchParams.delete('period');

    window.history.replaceState(null, '', url);
  }

  function rosterInit() {
    var curTab = (new URL(window.location)).searchParams.get('tab');
    var urlP = readUrlParams();
    rosterState.selectedClassId = urlP.classId;
    rosterState.selectedDate = urlP.date || getTodayIST();
    rosterState.selectedPeriod = urlP.period;

    loadRosterOptions().then(function () {
      if (rosterState.selectedClassId && rosterState.selectedDate && curTab === 'roster') {
        fetchRoster();
      }
    });

    bindEvents();
  }

  function bindEvents() {
    var searchEl = document.getElementById('roster-search');
    if (searchEl && !searchEl._bound) {
      searchEl._bound = true;
      searchEl.addEventListener('input', function (e) {
        rosterState.searchQuery = e.target.value.toLowerCase().trim();
        renderRosterTable();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === '/' && document.activeElement !== searchEl && document.getElementById('pg-roster').classList.contains('act')) {
          e.preventDefault();
          searchEl.focus();
        }
        if (e.key === 'Escape') {
          closeStudentDrawer();
        }
      });
    }

    var drawerOverlay = document.getElementById('roster-drawer-overlay');
    if (drawerOverlay && !drawerOverlay._bound) {
      drawerOverlay._bound = true;
      drawerOverlay.addEventListener('click', closeStudentDrawer);
    }
  }

  function loadRosterOptions() {
    var isTeacherPortal = typeof window !== 'undefined' && window.location && window.location.pathname && window.location.pathname.toLowerCase().indexOf('teacher') !== -1;
    var url = '/attendance-records/roster/options' + (isTeacherPortal ? '?scope=advisor' : '');
    return apiCall('GET', url)
      .then(function (res) {
        if (!res || !res.ok) return;
        rosterState.departments = res.data.departments || [];
        rosterState.classes = res.data.classes || [];

        renderDeptSelector();
        renderClassSelector();

        var dateInput = document.getElementById('roster-date-input');
        if (dateInput) {
          dateInput.value = rosterState.selectedDate;
          dateInput.onchange = function (e) {
            rosterState.selectedDate = e.target.value;
            updateUrlParams();
            fetchRoster();
          };
        }
      })
      .catch(function (err) {
        console.error('Failed to load roster options:', err);
        if (typeof showToast === 'function') showToast(err.message, 'error');
      });
  }

  function renderDeptSelector() {
    var sel = document.getElementById('roster-dept-sel');
    if (!sel) return;
    var isTeacherPortal = typeof window !== 'undefined' && window.location && window.location.pathname && window.location.pathname.toLowerCase().indexOf('teacher') !== -1;
    var depts = rosterState.departments || [];

    var html = '';
    if (!isTeacherPortal && depts.length > 1) {
      html += '<option value="">All Departments</option>';
    } else if (isTeacherPortal && depts.length > 1) {
      html += '<option value="">All Advised Departments</option>';
    }

    depts.forEach(function (d) {
      html += '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + ' (' + escapeHtml(d.code) + ')</option>';
    });
    sel.innerHTML = html;

    if (depts.length === 1) {
      rosterState.selectedDeptId = depts[0].id;
      sel.value = depts[0].id;
      sel.disabled = true;
      sel.title = 'Scoped to your advised department (' + depts[0].name + ')';
    } else if (rosterState.selectedDeptId && depts.some(function (d) { return d.id === rosterState.selectedDeptId; })) {
      sel.value = rosterState.selectedDeptId;
      sel.disabled = false;
    } else {
      sel.value = (isTeacherPortal && depts.length > 0) ? depts[0].id : '';
      rosterState.selectedDeptId = sel.value;
      sel.disabled = false;
    }

    sel.onchange = function (e) {
      rosterState.selectedDeptId = e.target.value;
      renderClassSelector();
    };
  }

  function renderClassSelector() {
    var sel = document.getElementById('roster-class-sel');
    if (!sel) return;
    var filtered = rosterState.classes;
    if (rosterState.selectedDeptId) {
      filtered = filtered.filter(function (c) {
        return c.deptId === rosterState.selectedDeptId;
      });
    }

    var html = '';
    if (filtered.length > 1) {
      html += '<option value="">Select Class...</option>';
    }
    filtered.forEach(function (c) {
      var label = c.name + ' · ' + (c.batch || '') + ' · Sem ' + (c.sem || '');
      var optVal = c.trackId || c.name || c.id;
      html += '<option value="' + escapeHtml(optVal) + '">' + escapeHtml(label) + '</option>';
    });
    sel.innerHTML = html;

    var matchClass = filtered.find(function(c) {
      return (c.trackId && c.trackId === rosterState.selectedClassId) ||
             (c.id && c.id === rosterState.selectedClassId) ||
             (c.name && c.name === rosterState.selectedClassId);
    });
    if (matchClass) {
      rosterState.selectedClassId = matchClass.trackId || matchClass.name || matchClass.id;
      sel.value = rosterState.selectedClassId;
    } else if (filtered.length > 0) {
      rosterState.selectedClassId = filtered[0].trackId || filtered[0].name || filtered[0].id;
      sel.value = rosterState.selectedClassId;
      var curTab = (new URL(window.location)).searchParams.get('tab');
      if (curTab === 'roster') updateUrlParams();
    } else {
      rosterState.selectedClassId = '';
      var bodyEl = document.getElementById('roster-content-area');
      if (bodyEl) {
        bodyEl.innerHTML = '<div style="padding:60px 20px;text-align:center;background:#fff;border-radius:12px;border:1px dashed var(--br);color:var(--tmu);"><re-icon icon="calendar" size="32" style="margin-bottom:10px;opacity:0.5;"></re-icon><div style="font-size:15px;font-weight:600;color:var(--td);margin-bottom:4px;">No Advised Classes Available</div><div style="font-size:12.5px;">Attendance Roster displays classes where you are assigned as Class Advisor.</div></div>';
      }
    }

    sel.onchange = function (e) {
      rosterState.selectedClassId = e.target.value;
      updateUrlParams();
      fetchRoster();
    };
  }

  function fetchRoster() {
    if (!rosterState.selectedClassId || !rosterState.selectedDate) return;
    rosterState.loading = true;
    renderLoadingState();

    var url = '/attendance-records/roster?classId=' + encodeURIComponent(rosterState.selectedClassId) +
      '&date=' + encodeURIComponent(rosterState.selectedDate);

    if (rosterState.selectedPeriod) {
      url += '&period=' + encodeURIComponent(rosterState.selectedPeriod);
    }

    apiCall('GET', url)
      .then(function (res) {
        rosterState.loading = false;
        if (!res || !res.ok) throw new Error(res.error || 'Failed to fetch roster');
        rosterState.rosterData = res.data;
        renderRosterUI();
      })
      .catch(function (err) {
        rosterState.loading = false;
        console.error('Roster fetch error:', err);
        renderErrorState(err.message);
      });
  }

  function renderLoadingState() {
    var bodyEl = document.getElementById('roster-content-area');
    if (!bodyEl) return;
    bodyEl.innerHTML = '<div style="padding:60px 20px;text-align:center;color:var(--tmu);"><div class="three-body" style="margin:0 auto 16px;"><div class="three-body__dot"></div><div class="three-body__dot"></div><div class="three-body__dot"></div></div>Loading class attendance roster…</div>';
  }

  function renderErrorState(msg) {
    var bodyEl = document.getElementById('roster-content-area');
    if (!bodyEl) return;
    bodyEl.innerHTML = '<div style="padding:40px 20px;text-align:center;background:#fff;border-radius:12px;border:1px solid #fee2e2;color:#991b1b;"><div style="font-size:16px;font-weight:700;margin-bottom:6px;"><re-icon icon="alert-triangle"></re-icon> Unable to Load Roster</div><div style="font-size:13px;color:#7f1d1d;">' + escapeHtml(msg) + '</div></div>';
  }

  function renderRosterUI() {
    var data = rosterState.rosterData;
    var bodyEl = document.getElementById('roster-content-area');
    if (!data || !bodyEl) return;

    var html = '';

    // 1. KPI Stats Cards
    var enrolled = data.strength ? data.strength.enrolled : (data.students || []).length;
    var hasDiscrepancy = data.strength && data.strength.hasDiscrepancy;
    var markedMax = data.strength ? data.strength.markedMax : 0;

    var presentTotal = 0;
    var absentTotal = 0;
    var leaveTotal = 0;

    (data.periods || []).forEach(function (p) {
      if (p.stats) {
        presentTotal += (p.stats.present || 0);
        absentTotal += (p.stats.absent || 0);
        leaveTotal += ((p.stats.od || 0) + (p.stats.leave || 0));
      }
    });

    var periodsCount = (data.periods || []).filter(function (p) { return p.stats && p.stats.total > 0; }).length || 1;
    var avgPresent = Math.round(presentTotal / periodsCount);
    var avgAbsent = Math.round(absentTotal / periodsCount);

    var lastSavedStr = data.lastSaved
      ? new Date(data.lastSaved).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      : 'Not recorded';

    html += '<div class="att-kpi-strip">';
    html += '<div class="att-kpi-card highlight"><span class="att-kpi-lbl">Class Strength</span><span class="att-kpi-val">' + enrolled;
    if (hasDiscrepancy) {
      html += ' <span style="font-size:11px;color:#b45309;font-weight:600;" title="Attendance was marked for ' + markedMax + ' students (snapshot differs from current roster)">⚠ Marked ' + markedMax + '</span>';
    }
    html += '</span><span class="att-kpi-sub">' + escapeHtml(data.class.name) + ' (' + escapeHtml(data.class.dept) + ')</span></div>';

    html += '<div class="att-kpi-card"><span class="att-kpi-lbl">Avg Present</span><span class="att-kpi-val" style="color:#16a34a;">' + avgPresent + '</span><span class="att-kpi-sub">' + (enrolled > 0 ? Math.round((avgPresent / enrolled) * 100) : 0) + '% attendance</span></div>';
    html += '<div class="att-kpi-card warn"><span class="att-kpi-lbl">Avg Absent</span><span class="att-kpi-val" style="color:#dc2626;">' + avgAbsent + '</span><span class="att-kpi-sub">' + (enrolled > 0 ? Math.round((avgAbsent / enrolled) * 100) : 0) + '% absence</span></div>';
    var cal = data.calendar || { dayType: 'working', isHoliday: false };
    var dayTypeStr = cal.dayType || 'working';
    html += '<div class="att-kpi-card"><span class="att-kpi-lbl">Day Status</span><span class="att-kpi-val" style="font-size:16px;text-transform:capitalize;">' + escapeHtml(dayTypeStr) + '</span><span class="att-kpi-sub">' + (cal.isHoliday ? 'Academic Holiday' : 'Regular Timetable') + '</span></div>';
    html += '<div class="att-kpi-card"><span class="att-kpi-lbl">Last Saved</span><span class="att-kpi-val" style="font-size:16px;font-family:\'JetBrains Mono\',monospace;">' + lastSavedStr + '</span><span class="att-kpi-sub">IST Clock</span></div>';
    html += '</div>';

    // 2. Period Strip (Tabs to toggle between full day matrix and period forensics)
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--td);text-transform:uppercase;letter-spacing:0.5px;">Schedule & Period Sessions</div>';
    html += '<button class="btn btn-sm btn-out" onclick="window.toggleRosterPeriod(null)" style="' + (rosterState.selectedPeriod === null ? 'background:var(--gD);color:#fff;border-color:var(--gD);' : '') + '">● Full-Day Matrix</button>';
    html += '</div>';

    html += '<div class="att-period-strip">';
    (data.periods || []).forEach(function (p) {
      var isAct = rosterState.selectedPeriod === p.number;
      var methodClass = 'method-' + (p.method || 'manual').toLowerCase().replace(/[^a-z0-9]/g, '-');
      html += '<div class="att-period-chip ' + (isAct ? 'act' : '') + '" onclick="window.toggleRosterPeriod(' + p.number + ')">';
      html += '<span class="att-pchip-num">P' + p.number + '</span>';
      html += '<span class="att-pchip-method ' + methodClass + '">' + escapeHtml(p.method) + '</span>';
      html += '<div><div class="att-pchip-sub" title="' + escapeHtml(p.subject.name || '') + '">' + escapeHtml(p.subject.name || 'Period ' + p.number) + '</div>';
      var teacherInfo = escapeHtml(p.teacher.name || '—') + (p.room ? ' · Rm ' + escapeHtml(p.room) : '');
      if (p.markedAt) {
        teacherInfo += ' · ' + new Date(p.markedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      } else if (p.span > 1) {
        teacherInfo += p.isSpanContinuation ? ' · Cont. of P' + p.spanRootPeriod : ' · ' + p.span + ' Periods';
      }
      html += '<div class="att-pchip-teacher" title="' + escapeHtml(teacherInfo) + '">' + teacherInfo + '</div></div>';
      html += '</div>';
    });
    html += '</div>';

    // 3. Filter Chips
    html += '<div class="att-filter-chips">';
    html += '<span style="font-size:11px;font-weight:700;color:var(--tmu);margin-right:4px;">FILTER:</span>';
    var chips = [
      { id: 'all', label: 'All Students' },
      { id: 'absent', label: 'Absent' },
      { id: 'low-trust', label: 'Low Trust (<50)' },
      { id: 'shared-device', label: 'Shared Device' },
      { id: 'unmarked', label: 'Not Marked' }
    ];
    chips.forEach(function (c) {
      var isAct = rosterState.activeFilter === c.id;
      html += '<button class="att-fchip ' + (isAct ? 'act' : '') + '" onclick="window.setRosterFilter(\'' + c.id + '\')">' + escapeHtml(c.label) + '</button>';
    });
    html += '</div>';

    // 4. Main Table Placeholder
    html += '<div id="roster-table-container"></div>';

    bodyEl.innerHTML = html;
    renderRosterTable();
  }

  function renderRosterTable() {
    var container = document.getElementById('roster-table-container');
    var data = rosterState.rosterData;
    if (!container || !data) return;

    var students = (data.students || []).filter(function (s) {
      // Search query filter
      if (rosterState.searchQuery) {
        var q = rosterState.searchQuery;
        var nameMatch = (s.name || '').toLowerCase().includes(q);
        var regMatch = (s.regNo || '').toLowerCase().includes(q);
        if (!nameMatch && !regMatch) return false;
      }

      // Category chip filter
      if (rosterState.activeFilter === 'absent') {
        if (rosterState.selectedPeriod) return s.status === 'AB' || s.status === 'A';
        return (s.cells || '').includes('A');
      }
      if (rosterState.activeFilter === 'low-trust') {
        return s.trust && s.trust.score !== null && s.trust.score < 50;
      }
      if (rosterState.activeFilter === 'shared-device') {
        return s.device && s.device.isShared;
      }
      if (rosterState.activeFilter === 'unmarked') {
        if (rosterState.selectedPeriod) return s.status === '–';
        return (s.cells || '').includes('–');
      }
      return true;
    });

    if (students.length === 0) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--tmu);background:#fff;border-radius:12px;border:1px solid var(--br);">No students found matching current filters.</div>';
      return;
    }

    var isPeriodMode = Boolean(rosterState.selectedPeriod);
    var html = '<div class="att-roster-wrap"><table class="att-roster-table"><thead><tr>';

    // Headers
    html += '<th class="att-col-sticky-1">#</th>';
    html += '<th class="att-col-sticky-2">Reg No</th>';
    html += '<th class="att-col-sticky-3" style="text-align:left;">Student Name</th>';

    if (!isPeriodMode) {
      // Full Day Matrix Headers
      var pCount = (data.periods || []).length || data.periodsPerDay || 7;
      for (var p = 1; p <= pCount; p++) {
        html += '<th style="width:38px;">P' + p + '</th>';
      }
      html += '<th style="width:70px;">Day %</th>';
    } else {
      // Period Forensic Headers
      html += '<th style="width:65px;">Status</th>';
      html += '<th style="width:85px;">Marked At</th>';
      html += '<th style="width:90px;">Method</th>';
      html += '<th>Device Fingerprint</th>';
      html += '<th style="width:90px;">Device Trust</th>';
      html += '<th>Login Session</th>';
    }
    html += '</tr></thead><tbody>';

    // Rows
    students.forEach(function (st, idx) {
      html += '<tr style="cursor:pointer;" onclick="window.openStudentDrawer(\'' + escapeHtml(st.trackId) + '\')">';
      html += '<td class="att-col-sticky-1">' + (idx + 1) + '</td>';
      html += '<td class="att-col-sticky-2"><strong>' + escapeHtml(st.regNo) + '</strong></td>';
      html += '<td class="att-col-sticky-3" style="text-align:left;font-weight:500;">' + escapeHtml(st.name) + '</td>';

      if (!isPeriodMode) {
        // Full Day Matrix Cells
        var cells = st.cells || '';
        for (var c = 0; c < cells.length; c++) {
          var glyph = cells[c];
          var cellClass = 'att-glyph-dash';
          if (glyph === 'P') cellClass = 'att-glyph-p';
          else if (glyph === 'A') cellClass = 'att-glyph-ab';
          else if (glyph === 'L' || glyph === 'O') cellClass = 'att-glyph-l';
          html += '<td class="' + cellClass + '">' + glyph + '</td>';
        }
        var pctColor = st.dayPct < 75 ? '#dc2626' : (st.dayPct < 85 ? '#d97706' : '#16a34a');
        html += '<td style="font-weight:700;color:' + pctColor + ';">' + st.dayPct + '%</td>';
      } else {
        // Forensic Details Cells
        var statusColor = st.status === 'P' ? '#16a34a' : (st.status === 'AB' ? '#dc2626' : '#64748b');
        html += '<td style="font-weight:800;color:' + statusColor + ';">' + escapeHtml(st.status) + '</td>';

        var timeStr = st.markedAt
          ? new Date(st.markedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '—';
        html += '<td style="font-family:\'JetBrains Mono\',monospace;font-size:11px;">' + timeStr + '</td>';

        var mClass = 'method-' + (st.method || 'manual').toLowerCase().replace(/[^a-z0-9]/g, '-');
        html += '<td><span class="att-pchip-method ' + mClass + '">' + escapeHtml(st.method) + '</span></td>';

        // Device
        var devInfo = '—';
        if (st.device && st.device.id) {
          devInfo = escapeHtml(st.device.type || 'Phone') + ' · ' + escapeHtml(st.device.browser || 'Browser') + ' · ' + escapeHtml(st.device.ip || '');
          if (st.device.isShared) {
            devInfo += ' <span style="color:#dc2626;font-weight:700;">⚠ Shared</span>';
          }
        }
        html += '<td style="text-align:left;font-size:11px;">' + devInfo + '</td>';

        // Trust badge
        var tScore = st.trust ? st.trust.score : null;
        var tBand = st.trust ? st.trust.band : 'na';
        var tBadge = '<span class="trust-badge trust-' + tBand + '">';
        if (tScore !== null) tBadge += '▮ ' + tScore;
        else tBadge += 'N/A';
        tBadge += '</span>';
        html += '<td>' + tBadge + '</td>';

        // Login session
        var sessInfo = '—';
        if (st.loginSession && st.loginSession.sessionId) {
          sessInfo = '<span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;">' + escapeHtml(st.loginSession.sessionId.slice(-8)) + '</span>';
          if (st.loginSession.address) {
            sessInfo += ' <span style="color:var(--tmu);font-size:10.5px;">(' + escapeHtml(st.loginSession.address) + ')</span>';
          }
        }
        html += '<td style="text-align:left;font-size:11px;">' + sessInfo + '</td>';
      }

      html += '</tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  // ── Forensic Student Drawer ──
  function openStudentDrawer(studentTrackId) {
    if (!studentTrackId || !rosterState.selectedClassId || !rosterState.selectedDate) return;

    var overlay = document.getElementById('roster-drawer-overlay');
    var drawer = document.getElementById('roster-drawer');
    var bodyEl = document.getElementById('roster-drawer-content');
    if (!overlay || !drawer || !bodyEl) return;

    overlay.classList.add('act');
    drawer.classList.add('act');
    bodyEl.innerHTML = '<div style="padding:40px;text-align:center;color:var(--tmu);"><div class="three-body" style="margin:0 auto 12px;"><div class="three-body__dot"></div><div class="three-body__dot"></div><div class="three-body__dot"></div></div>Loading student forensic profile…</div>';

    var url = '/attendance-records/roster/student?classId=' + encodeURIComponent(rosterState.selectedClassId) +
      '&date=' + encodeURIComponent(rosterState.selectedDate) +
      '&studentTrackId=' + encodeURIComponent(studentTrackId);

    apiCall('GET', url)
      .then(function (res) {
        if (!res || !res.ok) throw new Error(res.error || 'Failed to load dossier');
        renderDrawerData(res.data);
      })
      .catch(function (err) {
        console.error('Drawer error:', err);
        bodyEl.innerHTML = '<div style="padding:20px;color:#dc2626;">Failed to load dossier: ' + escapeHtml(err.message) + '</div>';
      });
  }

  function renderDrawerData(data) {
    var bodyEl = document.getElementById('roster-drawer-content');
    var titleEl = document.getElementById('roster-drawer-title');
    var subEl = document.getElementById('roster-drawer-sub');
    if (!bodyEl) return;

    if (titleEl) titleEl.textContent = data.student.name;
    if (subEl) subEl.textContent = 'Reg No: ' + data.student.regNo + ' · ' + data.class.name + ' · ' + data.date;

    var html = '';

    (data.periods || []).forEach(function (p) {
      html += '<div style="border:1px solid var(--br);border-radius:10px;padding:12px;margin-bottom:14px;background:#fff;">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
      html += '<div><strong>Period ' + p.periodNumber + '</strong> · ' + escapeHtml(p.subject || 'Subject') + '</div>';
      var stColor = p.status === 'P' ? '#16a34a' : '#dc2626';
      html += '<span style="font-weight:800;color:' + stColor + ';">' + escapeHtml(p.status) + '</span>';
      html += '</div>';

      html += '<div style="font-size:12px;color:var(--tmu);margin-bottom:8px;">';
      html += 'Method: <strong>' + escapeHtml(p.method) + '</strong>';
      if (p.markedAt) {
        html += ' · Marked At: ' + new Date(p.markedAt).toLocaleTimeString('en-IN');
      }
      html += '</div>';

      // Device info
      if (p.device && p.device.id) {
        html += '<div style="background:#f8fafc;padding:8px 10px;border-radius:6px;font-size:11.5px;margin-bottom:8px;">';
        html += '<div>📱 <strong>Device:</strong> ' + escapeHtml(p.device.type) + ' · ' + escapeHtml(p.device.browser) + ' (' + escapeHtml(p.device.os) + ')</div>';
        html += '<div>🌐 <strong>IP Address:</strong> ' + escapeHtml(p.device.ip) + '</div>';
        if (p.device.address) {
          html += '<div>📍 <strong>Address:</strong> ' + escapeHtml(p.device.address) + '</div>';
        }
        html += '</div>';
      }

      // Trust breakdown signals
      if (p.trust && p.trust.score !== null) {
        html += '<div style="margin-top:10px;">';
        html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
        html += '<span style="font-size:11px;font-weight:700;color:var(--tmu);">DEVICE TRUST SCORE</span>';
        html += '<span class="trust-badge trust-' + p.trust.band + '">▮ ' + p.trust.score + ' / 100 (' + p.trust.band.toUpperCase() + ')</span>';
        html += '</div>';

        if (p.trust.flags && p.trust.flags.length > 0) {
          html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;">';
          p.trust.flags.forEach(function (f) {
            html += '<span style="background:#fee2e2;color:#991b1b;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;">⚠ ' + escapeHtml(f) + '</span>';
          });
          html += '</div>';
        }

        html += '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-top:4px;">';
        (p.trust.signals || []).forEach(function (sig) {
          var icon = sig.ok ? '✓' : '✗';
          var color = sig.ok ? '#16a34a' : '#dc2626';
          html += '<tr style="border-bottom:1px solid #f1f5f9;">';
          html += '<td style="padding:4px 0;color:var(--td);">' + escapeHtml(sig.key) + '</td>';
          html += '<td style="padding:4px 0;text-align:right;font-weight:700;color:' + color + ';">' + icon + ' ' + sig.earned + '/' + sig.max + '</td>';
          html += '</tr>';
        });
        html += '</table>';
        html += '</div>';
      } else {
        html += '<div style="font-size:11.5px;color:var(--tmu);font-style:italic;">No session device linked for ' + escapeHtml(p.method) + ' (Trust: N/A)</div>';
      }

      html += '</div>';
    });

    bodyEl.innerHTML = html;
  }

  function closeStudentDrawer() {
    var overlay = document.getElementById('roster-drawer-overlay');
    var drawer = document.getElementById('roster-drawer');
    if (overlay) overlay.classList.remove('act');
    if (drawer) drawer.classList.remove('act');
  }

  // ── Global Handlers Attached to Window ──
  window.toggleRosterPeriod = function (pNum) {
    rosterState.selectedPeriod = pNum;
    updateUrlParams();
    fetchRoster();
  };

  window.setRosterFilter = function (filterId) {
    rosterState.activeFilter = filterId;
    renderRosterTable();
  };

  window.openStudentDrawer = openStudentDrawer;
  window.closeStudentDrawer = closeStudentDrawer;
  window.fetchRoster = fetchRoster;

  // Expose
  window.rosterInit = rosterInit;
})();
