function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── CONTROLLER PORTAL JAVASCRIPT ────────────────────────────────
var currentUser = checkAuth('any');
var controllerContext = null;
var selectedDeptFilter = '';
var activeLeaveTab = 'student';
var leaveFilterStatus = 'all';
var cachedLeaves = [];
var cachedDefaulters = [];
var cachedFaculty = [];
var cachedStudents = [];
var cachedMonthlyReport = [];
var cachedSemReport = [];
var cachedTimetables = [];

// Action modal state
var pendingLeaveAction = null; // { type: 'approve'|'reject', ids: [] }

(function init() {
  if (!currentUser) return;

  var loaderMsgEl = document.getElementById('loader-msg');
  function setLoaderMsg(idx, text) {
    if (!loaderMsgEl) return;
    loaderMsgEl.textContent = text;
    for (var s = 0; s < 4; s++) {
      var dot = document.getElementById('lstep-' + s);
      if (dot) dot.className = 'loader-step' + (s < idx ? ' done' : s === idx ? ' active' : '');
    }
  }

  var LOADER_STEPS = [
    { t: 0, msg: 'Connecting to Controller Hub…' },
    { t: 250, msg: 'Evaluating Jurisdiction & Permissions…' },
    { t: 500, msg: 'Hydrating Department Metrics…' },
    { t: 750, msg: 'Ready.' }
  ];

  LOADER_STEPS.forEach(function (s, i) {
    setTimeout(function () { setLoaderMsg(i, s.msg); }, s.t);
  });

  // Set today's date in pickers
  var todayISO = new Date().toISOString().split('T')[0];
  var attPicker = document.getElementById('att-date-picker');
  if (attPicker) attPicker.value = todayISO;
  var recPicker = document.getElementById('records-date-picker');
  if (recPicker) recPicker.value = todayISO;
  var monthPicker = document.getElementById('rpt-month-picker');
  if (monthPicker) monthPicker.value = todayISO.slice(0, 7);

  // Set topbar date
  var dateBadge = document.getElementById('topbar-date-label');
  if (dateBadge) {
    var d = new Date();
    dateBadge.textContent = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Bootstrap controller context from backend
  fetchControllerInit().then(function () {
    var loader = document.getElementById('page-loader');
    if (loader) {
      loader.classList.add('loader-fade');
      setTimeout(function () { loader.style.display = 'none'; }, 350);
    }
    var shell = document.getElementById('app-shell');
    if (shell) shell.classList.add('vis');

    // Initial Dashboard Load
    loadDashboardData();
  });
})();

function fetchControllerInit() {
  var token = getToken();
  return fetch('/api/controller/init?_t=' + Date.now(), {
    headers: { 'Authorization': 'Bearer ' + token }
  })
    .then(function (r) {
      if (!r.ok) {
        if (r.status === 403) {
          showToast('Access denied: HOD or Principal credentials required.');
          window.location.replace('selector.html');
          return null;
        }
      }
      return r.json();
    })
    .then(function (data) {
      if (!data || data.error) return;

      controllerContext = data.context || {};
      hydrateControllerHeader(controllerContext);

      // Populate Department dropdown if Principal
      if (controllerContext.role === 'principal') {
        var wrap = document.getElementById('dept-filter-wrap');
        var select = document.getElementById('global-dept-select');
        if (wrap && select) {
          wrap.style.display = 'flex';
          var depts = data.departments || [];
          select.innerHTML = '<option value="">All Departments (College-wide)</option>' +
            depts.map(function (d) {
              return '<option value="' + d._id + '">' + d.name + ' (' + (d.code || d.threeLetterCode || '') + ')</option>';
            }).join('');
        }

        // Show principal-specific dashboard widgets
        var compCard = document.getElementById('principal-comparison-card');
        if (compCard) compCard.style.display = 'block';
        var hodCard = document.getElementById('principal-hod-card');
        if (hodCard) hodCard.style.display = 'block';
      }

      // Update badge counts
      if (data.badges) {
        var leaveBadge = document.getElementById('sb-leave-badge');
        if (leaveBadge) {
          var count = data.badges.totalPendingLeaves || 0;
          leaveBadge.textContent = count;
          leaveBadge.style.display = count > 0 ? 'inline-block' : 'none';
        }
      }
    })
    .catch(function (err) {
      console.error('[Controller Init Error]:', err);
      showToast('Error loading controller context');
    });
}

function hydrateControllerHeader(ctx) {
  var name = ctx.name || 'User';
  var initial = (name.charAt(0) || 'C').toUpperCase();

  var avEl = document.getElementById('u-av');
  if (avEl) avEl.textContent = initial;

  var nameEl = document.getElementById('u-name');
  if (nameEl) nameEl.textContent = name;

  var roleEl = document.getElementById('u-role');
  if (roleEl) {
    roleEl.textContent = ctx.role === 'principal' ? 'Principal' : ('HOD · ' + (ctx.deptCode || ctx.deptName || 'Dept'));
  }

  var scopeText = document.getElementById('scope-text');
  var scopeIcon = document.getElementById('scope-icon');
  if (scopeText && scopeIcon) {
    if (ctx.role === 'principal') {
      scopeIcon.textContent = '🏫';
      scopeText.textContent = 'Institutional Scope (All Departments)';
    } else {
      scopeIcon.textContent = '🏛️';
      scopeText.textContent = 'HOD Jurisdiction: ' + (ctx.deptName || ctx.deptCode || 'Department');
    }
  }

  var titleEl = document.getElementById('sidebar-role-title');
  var subEl = document.getElementById('sidebar-role-subtitle');
  if (titleEl && subEl) {
    if (ctx.role === 'principal') {
      titleEl.textContent = 'Principal Hub';
      subEl.textContent = 'COLLEGE EXECUTIVE';
    } else {
      titleEl.textContent = 'HOD Portal';
      subEl.textContent = (ctx.deptCode || 'DEPT') + ' JURISDICTION';
    }
  }

  var authorTag = document.getElementById('broadcast-author-tag');
  if (authorTag) {
    authorTag.textContent = ctx.role === 'principal' ? 'Principal Directive' : ('HOD · ' + (ctx.deptCode || 'Department'));
  }
}

function onGlobalDeptChange(val) {
  selectedDeptFilter = val;
  var actPage = document.querySelector('.ctrl-page.act');
  if (actPage) {
    var pageId = actPage.id.replace('pg-', '');
    loadSectionData(pageId);
  }
}

// ── NAVIGATION ROUTING ──────────────────────────────────────────
function nav(pageId) {
  var allPages = document.querySelectorAll('.ctrl-page');
  allPages.forEach(function (p) { p.classList.remove('act'); });

  var targetPage = document.getElementById('pg-' + pageId);
  if (targetPage) targetPage.classList.add('act');

  var allNavs = document.querySelectorAll('.sb-item');
  allNavs.forEach(function (n) {
    if (n.getAttribute('data-page') === pageId) n.classList.add('act');
    else n.classList.remove('act');
  });

  // Close mobile sidebar
  var sb = document.getElementById('sidebar');
  var backdrop = document.getElementById('sb-backdrop');
  if (sb) sb.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');

  loadSectionData(pageId);
}

function toggleSidebar() {
  var sb = document.getElementById('sidebar');
  var backdrop = document.getElementById('sb-backdrop');
  if (sb) sb.classList.toggle('open');
  if (backdrop) backdrop.classList.toggle('open');
}

function loadSectionData(pageId) {
  switch (pageId) {
    case 'dash':
      loadDashboardData();
      break;
    case 'attendance':
      loadDailyAttendance();
      break;
    case 'leaves':
      loadLeavesData();
      break;
    case 'teachers':
      loadFacultyData();
      break;
    case 'students':
      loadStudentsData();
      break;
    case 'records':
      loadPeriodRecords();
      break;
    case 'defaulters':
      loadDefaultersData();
      break;
    case 'reports':
      loadMonthlyReport();
      break;
    case 'broadcast':
      loadBroadcastHistory();
      break;
    case 'calendar':
      loadAcademicCalendar();
      break;
    case 'timetable':
      loadTimetableClasses();
      break;
    case 'profile':
      loadProfileData();
      break;
  }
}

// ── 1. DASHBOARD OVERVIEW ───────────────────────────────────────
function loadDashboardData() {
  var token = getToken();
  var url = '/api/controller/dashboard?_t=' + Date.now();
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || data.error) return;

      var m = data.metrics || {};
      var stStudents = document.getElementById('stat-students');
      if (stStudents) stStudents.textContent = m.totalStudents != null ? m.totalStudents : '—';

      var stFaculty = document.getElementById('stat-faculty');
      if (stFaculty) stFaculty.textContent = m.totalFaculty != null ? m.totalFaculty : '—';

      var stClasses = document.getElementById('stat-classes');
      if (stClasses) stClasses.textContent = m.totalClasses != null ? m.totalClasses : '—';

      var todayAtt = m.todayAttendance || {};
      var stTodayAtt = document.getElementById('stat-today-att');
      if (stTodayAtt) stTodayAtt.textContent = (todayAtt.pct != null ? todayAtt.pct : 0) + '%';

      var tbPresent = document.getElementById('tb-present');
      if (tbPresent) tbPresent.textContent = todayAtt.present || 0;
      var tbAbsent = document.getElementById('tb-absent');
      if (tbAbsent) tbAbsent.textContent = todayAtt.absent || 0;
      var tbTotal = document.getElementById('tb-total');
      if (tbTotal) tbTotal.textContent = todayAtt.total || 0;

      var progBar = document.getElementById('today-progress-bar');
      if (progBar) progBar.style.width = (todayAtt.pct || 0) + '%';

      var tbClasses = document.getElementById('tb-classes-marked');
      if (tbClasses && data.activeClassesSummary) {
        tbClasses.textContent = data.activeClassesSummary.markedToday + ' / ' + data.activeClassesSummary.total;
      }

      // Render 7-Day Chart
      renderTrendChart(data.trendChart || []);

      // Render Principal Department Comparison
      if (data.deptComparison && data.deptComparison.length) {
        renderDeptComparison(data.deptComparison);
      }

      // Render HOD Matrix
      if (data.hodMatrix && data.hodMatrix.length) {
        renderHodMatrix(data.hodMatrix);
      }
    })
    .catch(function (err) {
      console.error('[Dashboard Load Error]:', err);
    });
}

function renderTrendChart(items) {
  var wrap = document.getElementById('chart-bars-wrap');
  if (!wrap) return;

  if (!items.length) {
    wrap.innerHTML = '<div class="chart-placeholder">No attendance records found for the past 7 days.</div>';
    return;
  }

  wrap.innerHTML = items.map(function (item) {
    var pillarClass = item.pct >= 75 ? 'high' : item.pct >= 50 ? 'mid' : 'low';
    var heightPct = Math.max(item.pct, 6);
    return '' +
      '<div class="chart-bar-col">' +
        '<span class="chart-bar-pct">' + item.pct + '%</span>' +
        '<div class="chart-bar-pillar ' + pillarClass + '" style="height:' + heightPct + '%;"></div>' +
        '<span class="chart-bar-day">' + item.day + '</span>' +
      '</div>';
  }).join('');
}

function renderDeptComparison(depts) {
  var grid = document.getElementById('dept-compare-grid');
  if (!grid) return;

  grid.innerHTML = depts.map(function (d) {
    return '' +
      '<div class="dept-compare-card">' +
        '<div class="dept-compare-hd">' +
          '<span class="dept-compare-name">' + d.name + '</span>' +
          '<span class="dept-compare-pct">' + d.todayPct + '%</span>' +
        '</div>' +
        '<div class="dept-compare-sub">HOD: <strong>' + d.hodName + '</strong></div>' +
        '<div class="dept-compare-sub" style="margin-top:4px;">Students: ' + d.studentCount + ' · Faculty: ' + d.facultyCount + '</div>' +
      '</div>';
  }).join('');
}

function renderHodMatrix(hods) {
  var tbody = document.getElementById('hod-matrix-tbody');
  if (!tbody) return;

  tbody.innerHTML = hods.map(function (h) {
    return '' +
      '<tr>' +
        '<td><strong>' + h.deptName + '</strong></td>' +
        '<td><span class="chip chip-blue">' + h.deptCode + '</span></td>' +
        '<td>' + h.hodName + '</td>' +
        '<td>' + h.courseType + '</td>' +
        '<td>' + h.branch + '</td>' +
      '</tr>';
  }).join('');
}

// ── 2. DAILY ATTENDANCE OVERVIEW ────────────────────────────────
function changeAttendanceDate(delta) {
  var picker = document.getElementById('att-date-picker');
  if (!picker || !picker.value) return;
  var d = new Date(picker.value);
  d.setDate(d.getDate() + delta);
  picker.value = d.toISOString().split('T')[0];
  loadDailyAttendance();
}

function setAttendanceToday() {
  var picker = document.getElementById('att-date-picker');
  if (!picker) return;
  picker.value = new Date().toISOString().split('T')[0];
  loadDailyAttendance();
}

function loadDailyAttendance() {
  var token = getToken();
  var dateStr = document.getElementById('att-date-picker')?.value || new Date().toISOString().split('T')[0];
  var url = '/api/controller/attendance/daily?date=' + encodeURIComponent(dateStr);
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  var tbody = document.getElementById('att-classes-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="text-center">Loading daily attendance…</td></tr>';

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || data.error) return;

      var sum = data.summary || {};
      var chipP = document.getElementById('chip-att-present');
      if (chipP) chipP.textContent = 'Present: ' + (sum.totalPresent || 0);
      var chipA = document.getElementById('chip-att-absent');
      if (chipA) chipA.textContent = 'Absent: ' + (sum.totalAbsent || 0);
      var chipC = document.getElementById('chip-att-classes');
      if (chipC) chipC.textContent = 'Classes: ' + (sum.markedClasses || 0) + ' / ' + (sum.totalClasses || 0);

      var classes = data.classes || [];
      if (!classes.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No classes registered or scheduled for this date.</td></tr>';
        return;
      }

      tbody.innerHTML = classes.map(function (c) {
        var statusHtml = c.markedPeriodsCount === 0
          ? '<span class="status-tag rejected">Unmarked</span>'
          : c.isFullyMarked
            ? '<span class="status-tag approved">Complete</span>'
            : '<span class="status-tag pending">Partial (' + c.markedPeriodsCount + ' periods)</span>';

        return '' +
          '<tr>' +
            '<td><strong>' + c.className + '</strong></td>' +
            '<td>' + c.deptName + ' (' + c.deptCode + ')</td>' +
            '<td>Yr ' + c.year + ' / Sem ' + c.sem + '</td>' +
            '<td>' + c.advisorName + '</td>' +
            '<td>' + c.markedPeriodsCount + ' periods</td>' +
            '<td><span style="color:#10b981;font-weight:700;">' + c.totalPresent + '</span></td>' +
            '<td><span style="color:#ef4444;font-weight:700;">' + c.totalAbsent + '</span></td>' +
            '<td><strong>' + c.pct + '%</strong></td>' +
            '<td>' + statusHtml + '</td>' +
          '</tr>';
      }).join('');
    })
    .catch(function (err) {
      console.error('[Attendance Daily Error]:', err);
    });
}

// ── 3. LEAVE APPROVALS WORKFLOW ─────────────────────────────────
function switchLeaveTab(tab) {
  activeLeaveTab = tab;
  var btnStu = document.getElementById('tab-btn-student-leaves');
  var btnTea = document.getElementById('tab-btn-teacher-leaves');
  if (btnStu && btnTea) {
    btnStu.className = 'ctrl-tab' + (tab === 'student' ? ' act' : '');
    btnTea.className = 'ctrl-tab' + (tab === 'teacher' ? ' act' : '');
  }
  loadLeavesData();
}

function filterLeaves(status, btn) {
  leaveFilterStatus = status;
  var pills = document.querySelectorAll('.filter-pills .pill-btn');
  pills.forEach(function (p) { p.classList.remove('act'); });
  if (btn) btn.classList.add('act');
  loadLeavesData();
}

function loadLeavesData() {
  var token = getToken();
  var endpoint = activeLeaveTab === 'teacher' ? '/api/controller/leaves/teacher' : '/api/controller/leaves/student';
  var url = endpoint + '?status=' + encodeURIComponent(leaveFilterStatus);
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  var tbody = document.getElementById('leaves-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="text-center">Loading leave requests…</td></tr>';

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (leaves) {
      cachedLeaves = Array.isArray(leaves) ? leaves : [];
      renderLeavesTable(cachedLeaves);
    })
    .catch(function (err) {
      console.error('[Leaves Load Error]:', err);
    });
}

function renderLeavesTable(leaves) {
  var tbody = document.getElementById('leaves-tbody');
  if (!tbody) return;

  if (!leaves.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center">No leave requests found for this filter.</td></tr>';
    return;
  }

  tbody.innerHTML = leaves.map(function (leave) {
    var name = leave.studentName || leave.teacherName || '—';
    var classDept = leave.className || (leave.deptName + ' (' + leave.deptCode + ')') || '—';
    var isEmergency = !!leave.isEmergency;
    var emergencyBadge = isEmergency ? '<span class="status-tag emergency">🚨 Emergency</span>' : '<span style="color:#64748b;">Regular</span>';

    var statusTag = leave.status === 'Approved'
      ? '<span class="status-tag approved">Approved</span>'
      : leave.status === 'Rejected'
        ? '<span class="status-tag rejected">Rejected</span>'
        : '<span class="status-tag pending">Pending</span>';

    var dateRange = leave.fromDate === leave.toDate ? leave.fromDate : (leave.fromDate + ' → ' + leave.toDate);

    return '' +
      '<tr>' +
        '<td><input type="checkbox" class="leave-item-check" data-id="' + leave._id + '"></td>' +
        '<td><strong>' + name + '</strong></td>' +
        '<td>' + classDept + '</td>' +
        '<td>' + (leave.category || 'Leave') + ' · ' + (leave.leaveType || 'Casual') + '</td>' +
        '<td>' + dateRange + '</td>' +
        '<td><strong>' + leave.daysCount + ' d</strong></td>' +
        '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + leave.reason + '">' + leave.reason + '</td>' +
        '<td>' + emergencyBadge + '</td>' +
        '<td>' + statusTag + '</td>' +
        '<td>' +
          '<div style="display:flex;gap:4px;">' +
            '<button class="btn btn-sm btn-pri" onclick="openSingleLeaveAction(\'approve\', \'' + leave._id + '\')">Approve</button>' +
            '<button class="btn btn-sm btn-danger" onclick="openSingleLeaveAction(\'reject\', \'' + leave._id + '\')">Reject</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
  }).join('');
}

function toggleSelectAllLeaves(master) {
  var checks = document.querySelectorAll('.leave-item-check');
  checks.forEach(function (c) { c.checked = master.checked; });
}

function handleBulkLeaveAction(action) {
  var checked = document.querySelectorAll('.leave-item-check:checked');
  if (!checked.length) {
    showToast('Please select at least one leave request to ' + action + '.');
    return;
  }

  var ids = Array.from(checked).map(function (c) { return c.getAttribute('data-id'); });
  pendingLeaveAction = { type: action, ids: ids };

  var modal = document.getElementById('leave-action-modal');
  var title = document.getElementById('leave-modal-action-title');
  var submitBtn = document.getElementById('leave-modal-submit-btn');

  if (title) title.textContent = (action === 'approve' ? '✅ Bulk Approve ' : '❌ Bulk Reject ') + ids.length + ' Request(s)';
  if (submitBtn) {
    submitBtn.textContent = action === 'approve' ? 'Confirm Approval' : 'Confirm Rejection';
    submitBtn.className = action === 'approve' ? 'btn btn-pri' : 'btn btn-danger';
  }
  if (modal) modal.classList.add('open');
}

function openSingleLeaveAction(action, id) {
  pendingLeaveAction = { type: action, ids: [id] };
  var modal = document.getElementById('leave-action-modal');
  var title = document.getElementById('leave-modal-action-title');
  var submitBtn = document.getElementById('leave-modal-submit-btn');

  if (title) title.textContent = (action === 'approve' ? '✅ Approve Leave' : '❌ Reject Leave');
  if (submitBtn) {
    submitBtn.textContent = action === 'approve' ? 'Confirm Approval' : 'Confirm Rejection';
    submitBtn.className = action === 'approve' ? 'btn btn-pri' : 'btn btn-danger';
  }
  if (modal) modal.classList.add('open');
}

function closeLeaveActionModal() {
  var modal = document.getElementById('leave-action-modal');
  if (modal) modal.classList.remove('open');
  pendingLeaveAction = null;
  var remarks = document.getElementById('leave-action-remarks');
  if (remarks) remarks.value = '';
}

function confirmLeaveAction() {
  if (!pendingLeaveAction) return;

  var token = getToken();
  var endpoint = pendingLeaveAction.type === 'approve' ? '/api/controller/leaves/approve' : '/api/controller/leaves/reject';
  var remarks = document.getElementById('leave-action-remarks')?.value || '';

  fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({
      ids: pendingLeaveAction.ids,
      type: activeLeaveTab,
      remarks: remarks
    })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.error) {
        showToast('Error: ' + res.error);
        return;
      }
      showToast('Successfully processed ' + res.count + ' leave request(s)!');
      closeLeaveActionModal();
      loadLeavesData();
    })
    .catch(function (err) {
      console.error('[Confirm Leave Action Error]:', err);
      showToast('Failed to update leaves');
    });
}

// ── 4. FACULTY OVERVIEW ─────────────────────────────────────────
function loadFacultyData() {
  var token = getToken();
  var url = '/api/controller/faculty?_t=' + Date.now();
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  var tbody = document.getElementById('faculty-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading faculty list…</td></tr>';

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      cachedFaculty = Array.isArray(data) ? data : [];
      renderFacultyTable(cachedFaculty);
    })
    .catch(function (err) {
      console.error('[Faculty Load Error]:', err);
    });
}

function renderFacultyTable(teachers) {
  var tbody = document.getElementById('faculty-tbody');
  if (!tbody) return;

  if (!teachers.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">No faculty members found.</td></tr>';
    return;
  }

  tbody.innerHTML = teachers.map(function (t) {
    var specials = [];
    if (t.isHod) specials.push('<span class="chip chip-yellow">HOD</span>');
    if (t.isClassAdvisor) specials.push('<span class="chip chip-blue">Advisor</span>');
    if (t.isTimeTableCoordinator) specials.push('<span class="chip chip-green">TT Coord</span>');
    var specHtml = specials.length ? specials.join(' ') : '—';

    var markingTag = t.todayMarkingStatus === 'Marked'
      ? '<span class="status-tag approved">✅ Marked (' + t.todayPeriodsMarked + ')</span>'
      : '<span class="status-tag pending">⏳ Pending</span>';

    return '' +
      '<tr>' +
        '<td><strong>' + t.employeeNo + '</strong></td>' +
        '<td><strong>' + t.fullName + '</strong></td>' +
        '<td>' + t.designation + '</td>' +
        '<td>' + t.department + '</td>' +
        '<td>' + specHtml + '</td>' +
        '<td>' + markingTag + '</td>' +
        '<td>' + t.email + '</td>' +
      '</tr>';
  }).join('');
}

function filterFacultyTable(q) {
  var query = (q || '').toLowerCase().trim();
  if (!query) {
    renderFacultyTable(cachedFaculty);
    return;
  }
  var filtered = cachedFaculty.filter(function (t) {
    return (t.fullName || '').toLowerCase().includes(query) ||
      (t.employeeNo || '').toLowerCase().includes(query) ||
      (t.designation || '').toLowerCase().includes(query) ||
      (t.department || '').toLowerCase().includes(query);
  });
  renderFacultyTable(filtered);
}

// ── 5. STUDENT DIRECTORY ────────────────────────────────────────
function loadStudentsData() {
  var token = getToken();
  var url = '/api/controller/students?_t=' + Date.now();
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  var tbody = document.getElementById('students-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center">Loading student records…</td></tr>';

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      cachedStudents = Array.isArray(data) ? data : [];
      renderStudentsTable(cachedStudents);
    })
    .catch(function (err) {
      console.error('[Students Load Error]:', err);
    });
}

function renderStudentsTable(students) {
  var tbody = document.getElementById('students-tbody');
  if (!tbody) return;

  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">No student records found.</td></tr>';
    return;
  }

  tbody.innerHTML = students.map(function (s) {
    var pct = s.attendancePct;
    var standing = pct >= 75
      ? '<span class="status-tag approved">Good (' + pct + '%)</span>'
      : pct >= 65
        ? '<span class="status-tag pending">Average (' + pct + '%)</span>'
        : '<span class="status-tag rejected">Defaulter (' + pct + '%)</span>';

    return '' +
      '<tr>' +
        '<td><strong>' + s.registerNo + '</strong></td>' +
        '<td><strong>' + s.fullName + '</strong></td>' +
        '<td>' + s.class + ' - ' + s.section + '</td>' +
        '<td>' + s.department + '</td>' +
        '<td>' + (s.batchTrackId || s.admissionYear || '—') + '</td>' +
        '<td>' + s.classesAttended + ' / ' + s.classesHeld + '</td>' +
        '<td><strong>' + pct + '%</strong></td>' +
        '<td>' + standing + '</td>' +
      '</tr>';
  }).join('');
}

function filterStudentsTable(q) {
  var query = (q || '').toLowerCase().trim();
  if (!query) {
    renderStudentsTable(cachedStudents);
    return;
  }
  var filtered = cachedStudents.filter(function (s) {
    return (s.fullName || '').toLowerCase().includes(query) ||
      (s.registerNo || '').toLowerCase().includes(query) ||
      (s.class || '').toLowerCase().includes(query);
  });
  renderStudentsTable(filtered);
}

// ── 6. PERIOD RECORDS & TEACHING NOTES ──────────────────────────
var cachedPeriodRecords = [];

function loadPeriodRecords() {
  var token = getToken();
  var dateStr = document.getElementById('records-date-picker')?.value || new Date().toISOString().split('T')[0];
  var url = '/api/controller/records?date=' + encodeURIComponent(dateStr);
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  var tbody = document.getElementById('records-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center">Auditing period records…</td></tr>';

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (records) {
      cachedPeriodRecords = Array.isArray(records) ? records : [];
      renderPeriodRecordsTable(cachedPeriodRecords, dateStr);
    })
    .catch(function (err) {
      console.error('[Period Records Error]:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="color:#ef4444;">Failed to load period records.</td></tr>';
    });
}

function renderPeriodRecordsTable(records, dateStr) {
  var tbody = document.getElementById('records-tbody');
  if (!tbody) return;

  if (!records || !records.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">No teaching records logged for ' + (dateStr || 'selected filter') + '.</td></tr>';
    return;
  }

  tbody.innerHTML = records.map(function (rec) {
    var timeStr = rec.markedAt ? new Date(rec.markedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    var topicDisplay = rec.topic && rec.topic !== '—' ? '<strong>' + rec.topic + '</strong>' : '<span style="color:#94a3b8;font-style:italic;">No topic entered</span>';
    var notesDisplay = rec.notes && rec.notes !== '—' ? rec.notes : '<span style="color:#94a3b8;font-style:italic;">—</span>';
    var periodsStr = Array.isArray(rec.periodNumbers) && rec.periodNumbers.length ? rec.periodNumbers.join(', ') : (rec.periodNumber || '1');
    return '' +
      '<tr>' +
        '<td><strong>' + rec.className + (rec.section && rec.section !== '—' ? ' (' + rec.section + ')' : '') + '</strong></td>' +
        '<td>Period ' + periodsStr + '</td>' +
        '<td><span class="chip chip-blue">' + rec.subjectTrackId + '</span></td>' +
        '<td>' + rec.markedBy + '</td>' +
        '<td>' + topicDisplay + '</td>' +
        '<td style="color:#475569;">' + notesDisplay + '</td>' +
        '<td><span class="status-tag approved">' + rec.presentCount + ' / ' + rec.totalCount + '</span></td>' +
        '<td style="color:#64748b;font-size:12px;">' + timeStr + '</td>' +
      '</tr>';
  }).join('');
}

function filterPeriodRecords(q) {
  var query = (q || '').toLowerCase().trim();
  if (!query) {
    renderPeriodRecordsTable(cachedPeriodRecords);
    return;
  }
  var filtered = cachedPeriodRecords.filter(function (rec) {
    return (rec.topic && rec.topic.toLowerCase().includes(query)) ||
      (rec.notes && rec.notes.toLowerCase().includes(query)) ||
      (rec.className && rec.className.toLowerCase().includes(query)) ||
      (rec.markedBy && rec.markedBy.toLowerCase().includes(query)) ||
      (rec.subjectTrackId && String(rec.subjectTrackId).toLowerCase().includes(query));
  });
  renderPeriodRecordsTable(filtered);
}

// ── 7. DEFAULTERS REPORT & BULK MEET ME ACTION ───────────────────
function loadDefaultersData() {
  var token = getToken();
  var url = '/api/controller/defaulters?_t=' + Date.now();
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  var tbody = document.getElementById('defaulters-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="text-center">Calculating defaulter students…</td></tr>';

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      cachedDefaulters = data.defaulters || [];
      var badge = document.getElementById('defaulter-count-badge');
      if (badge) badge.textContent = cachedDefaulters.length + ' Defaulters Found';

      var threshLbl = document.getElementById('defaulter-threshold-lbl');
      if (threshLbl) threshLbl.textContent = '< ' + (data.threshold || 75) + '%';

      if (!cachedDefaulters.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No students below minimum attendance threshold! 🎉</td></tr>';
        return;
      }

      tbody.innerHTML = cachedDefaulters.map(function (d) {
        var shortfall = (d.threshold - d.pct) + '%';
        return '' +
          '<tr>' +
            '<td><input type="checkbox" class="defaulter-item-check" data-trackid="' + d.studentTrackId + '" checked></td>' +
            '<td><strong>' + d.regNo + '</strong></td>' +
            '<td>' + d.name + '</td>' +
            '<td>' + d.className + ' - ' + d.section + '</td>' +
            '<td>' + d.deptName + '</td>' +
            '<td>' + d.classesHeld + '</td>' +
            '<td>' + d.classesAttended + '</td>' +
            '<td><strong style="color:#ef4444;">' + d.pct + '%</strong></td>' +
            '<td><span class="chip chip-red">-' + shortfall + '</span></td>' +
          '</tr>';
      }).join('');
    })
    .catch(function (err) {
      console.error('[Defaulters Error]:', err);
    });
}

function toggleSelectAllDefaulters(master) {
  var checks = document.querySelectorAll('.defaulter-item-check');
  checks.forEach(function (c) { c.checked = master.checked; });
}

function openMeetDefaultersModal() {
  var checked = document.querySelectorAll('.defaulter-item-check:checked');
  if (!checked.length) {
    showToast('Please select at least one defaulter student.');
    return;
  }
  var countEl = document.getElementById('modal-selected-count');
  if (countEl) countEl.textContent = checked.length;

  var modal = document.getElementById('meet-modal');
  if (modal) modal.classList.add('open');
}

function closeMeetDefaultersModal() {
  var modal = document.getElementById('meet-modal');
  if (modal) modal.classList.remove('open');
  var note = document.getElementById('meet-custom-note');
  if (note) note.value = '';
}

function confirmSendMeetNotice() {
  var checked = document.querySelectorAll('.defaulter-item-check:checked');
  var trackIds = Array.from(checked).map(function (c) { return c.getAttribute('data-trackid'); });
  var note = document.getElementById('meet-custom-note')?.value || '';

  var token = getToken();
  fetch('/api/controller/defaulters/meet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({
      studentTrackIds: trackIds,
      customNote: note
    })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.error) {
        showToast('Error: ' + res.error);
        return;
      }
      showToast('Dispatched meet notices to ' + res.sentCount + ' students & copied ' + res.advisorsNotified + ' advisors!');
      closeMeetDefaultersModal();
    })
    .catch(function (err) {
      console.error('[Meet Notice Error]:', err);
      showToast('Failed to dispatch notices');
    });
}

// ── 8. ATTENDANCE REPORTS & CSV EXPORT ───────────────────────────
function switchReportTab(tab) {
  var btnMon = document.getElementById('tab-btn-monthly-rpt');
  var btnSem = document.getElementById('tab-btn-sem-rpt');
  var secMon = document.getElementById('rpt-monthly-sec');
  var secSem = document.getElementById('rpt-semester-sec');

  if (tab === 'monthly') {
    if (btnMon) btnMon.className = 'ctrl-tab act';
    if (btnSem) btnSem.className = 'ctrl-tab';
    if (secMon) secMon.style.display = 'block';
    if (secSem) secSem.style.display = 'none';
    loadMonthlyReport();
  } else {
    if (btnMon) btnMon.className = 'ctrl-tab';
    if (btnSem) btnSem.className = 'ctrl-tab act';
    if (secMon) secMon.style.display = 'none';
    if (secSem) secSem.style.display = 'block';
    loadSemesterReport();
  }
}

function loadMonthlyReport() {
  var token = getToken();
  var monthStr = document.getElementById('rpt-month-picker')?.value || new Date().toISOString().slice(0, 7);
  var url = '/api/controller/reports/monthly?month=' + encodeURIComponent(monthStr);
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  var tbody = document.getElementById('monthly-rpt-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center">Generating monthly report…</td></tr>';

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      cachedMonthlyReport = data.report || [];
      if (!cachedMonthlyReport.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No attendance data found for ' + monthStr + '.</td></tr>';
        return;
      }

      tbody.innerHTML = cachedMonthlyReport.map(function (row) {
        return '' +
          '<tr>' +
            '<td><strong>' + row.className + ' - ' + row.section + '</strong></td>' +
            '<td>' + row.deptName + '</td>' +
            '<td>Yr ' + row.year + ' / Sem ' + row.sem + '</td>' +
            '<td>' + row.daysConducted + ' days</td>' +
            '<td><span style="color:#10b981;font-weight:700;">' + row.totalPresent + '</span></td>' +
            '<td><span style="color:#ef4444;font-weight:700;">' + row.totalAbsent + '</span></td>' +
            '<td><strong>' + row.pct + '%</strong></td>' +
          '</tr>';
      }).join('');
    })
    .catch(function (err) {
      console.error('[Monthly Report Error]:', err);
    });
}

function loadSemesterReport() {
  var token = getToken();
  var sem = document.getElementById('rpt-sem-select')?.value || '1';
  var url = '/api/controller/reports/semester?sem=' + encodeURIComponent(sem);
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  var tbody = document.getElementById('sem-rpt-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center">Generating semester report…</td></tr>';

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      cachedSemReport = Array.isArray(data) ? data : [];
      if (!cachedSemReport.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No subject records found for Semester ' + sem + '.</td></tr>';
        return;
      }

      tbody.innerHTML = cachedSemReport.map(function (row) {
        return '' +
          '<tr>' +
            '<td><span class="chip chip-blue">' + row.code + '</span></td>' +
            '<td><strong>' + row.name + '</strong></td>' +
            '<td>' + row.deptCode + '</td>' +
            '<td>Sem ' + row.sem + '</td>' +
            '<td>' + row.classesHeld + '</td>' +
            '<td>' + row.classesAttended + '</td>' +
            '<td><strong>' + row.pct + '%</strong></td>' +
          '</tr>';
      }).join('');
    })
    .catch(function (err) {
      console.error('[Semester Report Error]:', err);
    });
}

function exportReportToCsv() {
  var isMonthly = document.getElementById('rpt-monthly-sec')?.style.display !== 'none';
  var csvRows = [];

  if (isMonthly) {
    if (!cachedMonthlyReport.length) {
      showToast('No monthly report data to export.');
      return;
    }
    csvRows.push(['Class', 'Department', 'Year', 'Semester', 'Days Conducted', 'Present Count', 'Absent Count', 'Attendance %']);
    cachedMonthlyReport.forEach(function (r) {
      csvRows.push([r.className + ' - ' + r.section, r.deptName, r.year, r.sem, r.daysConducted, r.totalPresent, r.totalAbsent, r.pct + '%']);
    });
  } else {
    if (!cachedSemReport.length) {
      showToast('No semester report data to export.');
      return;
    }
    csvRows.push(['Subject Code', 'Subject Name', 'Department', 'Semester', 'Classes Held', 'Classes Attended', 'Attendance %']);
    cachedSemReport.forEach(function (r) {
      csvRows.push([r.code, r.name, r.deptCode, r.sem, r.classesHeld, r.classesAttended, r.pct + '%']);
    });
  }

  var csvContent = 'data:text/csv;charset=utf-8,' + csvRows.map(function (e) { return e.join(','); }).join('\n');
  var encodedUri = encodeURI(csvContent);
  var link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', (isMonthly ? 'monthly_attendance_report' : 'semester_attendance_report') + '.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Exported report to CSV!');
}

// ── 9. BROADCAST HUB ────────────────────────────────────────────
function handleSendBroadcast(e) {
  e.preventDefault();
  var msg = document.getElementById('bc-msg')?.value || '';
  var level = document.getElementById('bc-level')?.value || 'info';
  var target = document.getElementById('bc-target')?.value || 'all';

  var token = getToken();
  fetch('/api/controller/broadcast', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({
      message: msg,
      level: level,
      targetRoles: target === 'all' ? ['all'] : [target]
    })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.error) {
        showToast('Error: ' + res.error);
        return;
      }
      showToast('📢 Broadcast announcement dispatched successfully!');
      var msgBox = document.getElementById('bc-msg');
      if (msgBox) msgBox.value = '';
      loadBroadcastHistory();
    })
    .catch(function (err) {
      console.error('[Broadcast Error]:', err);
      showToast('Failed to dispatch broadcast');
    });
}

function loadBroadcastHistory() {
  var token = getToken();
  fetch('/api/controller/broadcast/history?_t=' + Date.now(), {
    headers: { 'Authorization': 'Bearer ' + token }
  })
    .then(function (r) { return r.json(); })
    .then(function (history) {
      var list = document.getElementById('broadcast-history-list');
      if (!list) return;

      if (!history || !history.length) {
        list.innerHTML = '<div class="text-center" style="padding:20px;color:var(--tmu);">No past broadcasts found.</div>';
        return;
      }

      list.innerHTML = history.map(function (b) {
        var dateStr = b.dispatchedAt ? new Date(b.dispatchedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
        var tagBadge = b.tag === 'principal'
          ? '<span class="chip chip-blue">Principal</span>'
          : '<span class="chip chip-yellow">HOD</span>';

        return '' +
          '<div style="padding:12px;border:1px solid var(--br,#e2e8f0);border-radius:10px;margin-bottom:8px;background:#f8fafc;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
              '<div>' + tagBadge + ' <strong style="font-size:12.5px;color:var(--td);">' + (b.dispatchedBy?.name || 'Controller') + '</strong></div>' +
              '<span style="font-size:11px;color:var(--tmu);">' + dateStr + '</span>' +
            '</div>' +
            '<div style="font-size:13px;color:var(--td);line-height:1.4;">' + b.message + '</div>' +
          '</div>';
      }).join('');
    })
    .catch(function (err) {
      console.error('[Broadcast History Error]:', err);
    });
}

// ── 10. ACADEMIC CALENDAR ───────────────────────────────────────
function loadAcademicCalendar() {
  var token = getToken();
  var tbody = document.getElementById('calendar-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading academic calendar…</td></tr>';

  fetch('/api/controller/calendar?_t=' + Date.now(), {
    headers: { 'Authorization': 'Bearer ' + token }
  })
    .then(function (r) { return r.json(); })
    .then(function (events) {
      if (!events || !events.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No academic events registered in calendar.</td></tr>';
        return;
      }

      tbody.innerHTML = events.map(function (ev) {
        var dateStr = ev.date ? new Date(ev.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
        var dayName = ev.date ? new Date(ev.date).toLocaleDateString([], { weekday: 'long' }) : '—';
        var isWorking = ev.isWorkingDay !== false;
        var statusTag = isWorking
          ? '<span class="status-tag approved">Working Day</span>'
          : '<span class="status-tag rejected">Holiday / Off</span>';

        return '' +
          '<tr>' +
            '<td><strong>' + dateStr + '</strong></td>' +
            '<td>' + dayName + '</td>' +
            '<td>Day Order ' + (ev.dayOrder || '—') + '</td>' +
            '<td><span class="chip chip-blue">' + (ev.type || 'Academic') + '</span></td>' +
            '<td>' + (ev.description || ev.title || 'Regular Schedule') + '</td>' +
            '<td>' + statusTag + '</td>' +
          '</tr>';
      }).join('');
    })
    .catch(function (err) {
      console.error('[Calendar Error]:', err);
    });
}

// ── 11. TIMETABLE VIEW ──────────────────────────────────────────
function loadTimetableClasses() {
  var token = getToken();
  var url = '/api/controller/timetable?_t=' + Date.now();
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (timetables) {
      cachedTimetables = Array.isArray(timetables) ? timetables : [];
      var select = document.getElementById('tt-class-select');
      if (!select) return;

      if (!cachedTimetables.length) {
        select.innerHTML = '<option value="">No timetables found</option>';
        return;
      }

      select.innerHTML = '<option value="">Select Class Section…</option>' +
        cachedTimetables.map(function (tt, i) {
          return '<option value="' + i + '">' + (tt.className || 'Class ' + (i + 1)) + '</option>';
        }).join('');

      // Auto-select first if available
      if (cachedTimetables.length) {
        select.value = '0';
        renderClassTimetable('0');
      }
    })
    .catch(function (err) {
      console.error('[Timetable Load Error]:', err);
    });
}

function renderClassTimetable(idxStr) {
  var tbody = document.getElementById('timetable-display-tbody');
  if (!tbody) return;

  var idx = parseInt(idxStr, 10);
  if (isNaN(idx) || !cachedTimetables[idx]) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Select a class section from dropdown to view schedule.</td></tr>';
    return;
  }

  var tt = cachedTimetables[idx];
  var title = document.getElementById('tt-view-title');
  if (title) title.textContent = 'Master Timetable: ' + (tt.className || 'Selected Class');

  var days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var schedule = tt.schedule || tt.days || {};

  tbody.innerHTML = days.map(function (day) {
    var daySlots = schedule[day.toLowerCase()] || schedule[day] || [];
    var slotsHtml = [];

    for (var p = 1; p <= 7; p++) {
      var slot = daySlots.find(function (s) { return s.periodNumber === p || s.period === p; }) || daySlots[p - 1];
      if (slot && (slot.subjectCode || slot.subjectTrackId || slot.subject)) {
        slotsHtml.push('' +
          '<td>' +
            '<div class="tt-slot-card">' +
              '<div class="tt-slot-sub">' + (slot.subjectCode || slot.subjectTrackId || slot.subject) + '</div>' +
              '<div class="tt-slot-fac">' + (slot.teacherName || slot.teacherTrackId || 'Faculty') + '</div>' +
            '</div>' +
          '</td>');
      } else {
        slotsHtml.push('<td style="color:#94a3b8;font-size:11px;">—</td>');
      }
    }

    return '<tr><td><strong>' + day + '</strong></td>' + slotsHtml.join('') + '</tr>';
  }).join('');
}

// ── 12. MY PROFILE ──────────────────────────────────────────────
function loadProfileData() {
  if (!controllerContext) return;
  var ctx = controllerContext;

  var heroAv = document.getElementById('prof-hero-av');
  if (heroAv) heroAv.textContent = (ctx.name.charAt(0) || 'C').toUpperCase();

  var heroName = document.getElementById('prof-hero-name');
  if (heroName) heroName.textContent = ctx.name;

  var heroRole = document.getElementById('prof-hero-role');
  if (heroRole) heroRole.textContent = ctx.role === 'principal' ? 'Principal · Executive Authority' : 'Head of Department (HOD)';

  var heroDept = document.getElementById('prof-hero-dept');
  if (heroDept) heroDept.textContent = ctx.deptName ? (ctx.deptName + ' (' + ctx.deptCode + ')') : 'Sri Shakthi Institute of Engineering & Technology';

  var pUser = document.getElementById('prof-username');
  if (pUser) pUser.textContent = currentUser?.username || '—';

  var pEmail = document.getElementById('prof-email');
  if (pEmail) pEmail.textContent = ctx.email || currentUser?.email || '—';

  var pScope = document.getElementById('prof-scope');
  if (pScope) pScope.textContent = ctx.scope === 'college' ? 'Institutional (All College Departments)' : 'Department-Scoped Jurisdiction';

  var pDept = document.getElementById('prof-dept-jurisdiction');
  if (pDept) pDept.textContent = ctx.deptName || 'All Departments';
}
