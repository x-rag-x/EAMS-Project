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
var currentUser = getUser();
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
  var todayISO = todayIST();
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

    // Initial Load - load whichever page is currently active (defaults to 'board')
    var actPage = document.querySelector('.ctrl-page.act');
    var pageId = actPage ? actPage.id.replace('pg-', '') : 'board';
    loadSectionData(pageId);
    initRealtimeStream();
  });
})();

// ── REAL-TIME SSE STREAM & LIVE INDICATOR ──
var _controllerEventSource = null;
var _fallbackPollTimer = null;
var _reconnectTimeout = null;

function setLiveIndicator(state, text) {
  var indicator = document.getElementById('topbar-live-status');
  var textEl = document.getElementById('topbar-live-text');
  if (!indicator || !textEl) return;

  indicator.classList.remove('live', 'polling', 'error');
  if (state) indicator.classList.add(state);

  if (text) {
    textEl.textContent = text;
  } else if (state === 'live') {
    textEl.textContent = 'Live';
  } else if (state === 'polling') {
    textEl.textContent = 'Live';
  } else if (state === 'error') {
    textEl.textContent = 'Offline';
  } else {
    textEl.textContent = 'Live';
  }
}

function isLiveBoardActive() {
  var boardPage = document.getElementById('pg-board');
  return Boolean(boardPage && boardPage.classList.contains('act'));
}

function startFallbackPolling() {
  if (_fallbackPollTimer) return;
  _fallbackPollTimer = setInterval(function () {
    if (isLiveBoardActive()) {
      reloadLiveBoardData();
    }
  }, 20000);
}

function stopFallbackPolling() {
  if (_fallbackPollTimer) {
    clearInterval(_fallbackPollTimer);
    _fallbackPollTimer = null;
  }
}

function initRealtimeStream() {
  var token = getToken();
  if (!token) return;

  setLiveIndicator('live', 'Live');

  if (typeof window.EventSource === 'undefined') {
    startFallbackPolling();
    return;
  }

  fetch('/api/controller/stream-ticket', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    }
  })
    .then(function (res) {
      if (!res.ok) throw new Error('Ticket status ' + res.status);
      return res.json();
    })
    .then(function (ticketData) {
      if (!ticketData.ok || !ticketData.ticket) throw new Error(ticketData.error || 'No ticket');

      if (_controllerEventSource) {
        try { _controllerEventSource.close(); } catch (_) {}
        _controllerEventSource = null;
      }

      var sseUrl = '/api/controller/stream?ticket=' + encodeURIComponent(ticketData.ticket);
      var es = new EventSource(sseUrl);
      _controllerEventSource = es;

      es.onopen = function () {
        setLiveIndicator('live', 'Live');
        stopFallbackPolling();
      };

      es.onerror = function () {
        setLiveIndicator('live', 'Live');
        try { es.close(); } catch (_) {}
        _controllerEventSource = null;
        startFallbackPolling();

        if (_reconnectTimeout) clearTimeout(_reconnectTimeout);
        _reconnectTimeout = setTimeout(function () {
          initRealtimeStream();
        }, 30000);
      };

      es.addEventListener('session.update', function () {
        if (isLiveBoardActive()) reloadLiveBoardData();
      });

      es.addEventListener('session.nudge', function () {
        if (isLiveBoardActive()) reloadLiveBoardData();
      });

      es.addEventListener('alert.new', function () {
        loadLiveAlerts();
      });

      es.addEventListener('alert.resolved', function () {
        loadLiveAlerts();
      });

      es.addEventListener('calendar:holiday', function () {
        if (isLiveBoardActive()) reloadLiveBoardData();
      });

      es.addEventListener('attendance:lock-extended', function () {
        if (isLiveBoardActive()) reloadLiveBoardData();
      });
    })
    .catch(function (err) {
      console.warn('[Controller SSE Init]:', err.message);
      setLiveIndicator('live', 'Live');
      startFallbackPolling();
    });
}

window.addEventListener('beforeunload', function () {
  if (_controllerEventSource) {
    try { _controllerEventSource.close(); } catch (_) {}
  }
  stopFallbackPolling();
});

window.setLiveIndicator = setLiveIndicator;
window.initRealtimeStream = initRealtimeStream;

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
      updateCtrlTtVerificationBadge();
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
      scopeIcon.innerHTML = '<re-icon icon="chalkboard"></re-icon>';
      scopeText.textContent = 'Institutional Scope (All Departments)';
    } else {
      scopeIcon.innerHTML = '<re-icon icon="building2"></re-icon>';
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
    case 'board':
      reloadLiveBoardData();
      break;
    case 'inbox':
      loadInboxData();
      break;
    case 'dash':
      loadDashboardData();
      break;
    case 'attendance':
      loadDailyAttendance();
      break;
    case 'leaves':
      loadLeavesData();
      break;
    case 'faculty-leave':
      loadFacultyLeaveData();
      break;
    case 'participation':
      loadParticipationTracker();
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
    case 'tt-verify':
      loadCtrlTimetableVerificationPage();
      break;
    case 'timetable':
      loadTimetableClasses();
      break;
    case 'workload':
      loadWorkloadSection();
      break;
    case 'profile':
      loadProfileData();
      break;
    case 'audit':
      loadAuditLogData();
      break;
    case 'settings':
      loadDeptSettings();
      break;
  }
}

// ── 0. REAL-TIME LIVE BOARD ─────────────────────────────────────
var _cachedBoardSessions = [];
var _problemsOnly = false;
var _timeMachineActive = false;
var _tmDate = null;
var _tmTime = null;
var _currentSessionActionId = null;
var _subCandidatesCache = [];
var _currentStudentRecord = null;

function reloadLiveBoardData() {
  var token = getToken();
  var url = '/api/controller/board?_t=' + Date.now();
  if (_timeMachineActive && _tmDate) {
    url += '&date=' + encodeURIComponent(_tmDate);
    if (_tmTime) url += '&at=' + encodeURIComponent(_tmTime);
  }
  if (selectedDeptFilter) {
    url += '&deptId=' + encodeURIComponent(selectedDeptFilter);
  }

  var container = document.getElementById('board-tiles-container');
  if (container) {
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--tmu);"><div class="spin" style="margin:0 auto 10px;"></div>Loading classroom sessions…</div>';
  }

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || data.error) throw new Error(data?.error || 'Failed to load board');

      var sum = data.summary || {};
      var runningEl = document.getElementById('kpi-running');
      if (runningEl) runningEl.textContent = sum.running != null ? sum.running : (data.runningNowCount != null ? data.runningNowCount : 0);

      var onTimeEl = document.getElementById('kpi-on-time');
      if (onTimeEl) onTimeEl.textContent = sum.onTime != null ? sum.onTime : (data.onTimeCount != null ? data.onTimeCount : 0);

      var inWinEl = document.getElementById('kpi-in-window');
      if (inWinEl) inWinEl.textContent = sum.inWindow != null ? sum.inWindow : (data.inWindowCount != null ? data.inWindowCount : 0);

      var overEl = document.getElementById('kpi-overdue');
      if (overEl) overEl.textContent = sum.overdue != null ? sum.overdue : (data.overdueCount != null ? data.overdueCount : 0);

      var subEl = document.getElementById('kpi-needs-sub');
      if (subEl) subEl.textContent = sum.needsSub != null ? sum.needsSub : (data.needsSubCount != null ? data.needsSubCount : 0);

      var turnoutEl = document.getElementById('kpi-present-pct');
      if (turnoutEl) turnoutEl.textContent = (sum.presentPct != null ? sum.presentPct : (data.turnoutRate != null ? data.turnoutRate : '—')) + '%';

      _cachedBoardSessions = data.sessions || data.tiles || [];
      filterBoardTiles();

      var matrixView = document.getElementById('board-view-matrix');
      if (matrixView && matrixView.style.display !== 'none') {
        loadDayMatrix();
      }

      loadLiveAlerts();
      setLiveIndicator('live', 'Live');
    })
    .catch(function (err) {
      console.error('[Live Board Load Error]:', err);
      if (container) {
        container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--tmu);">Failed to load live sessions: ' + escapeHtml(err.message) + '</div>';
      }
    });
}

function filterBoardTiles() {
  var yearVal = document.getElementById('board-year-select')?.value || '';
  var secVal = document.getElementById('board-sec-select')?.value || '';
  var searchVal = (document.getElementById('board-search-input')?.value || '').toLowerCase().trim();

  var filtered = _cachedBoardSessions.filter(function (s) {
    if (yearVal && String(s.year) !== yearVal) return false;
    if (secVal && String(s.section).toUpperCase() !== secVal.toUpperCase()) return false;
    if (_problemsOnly) {
      var isProblem = s.isOverdue || s.needsSub || (s.flags && s.flags.includes('unresolved_sub')) || s.overdue || s.status === 'overdue' || s.status === 'unresolved_sub';
      if (!isProblem) return false;
    }
    if (searchVal) {
      var match = (s.className || '').toLowerCase().includes(searchVal) ||
        (s.teacherName || '').toLowerCase().includes(searchVal) ||
        (s.subjectName || '').toLowerCase().includes(searchVal) ||
        (s.subjectCode || '').toLowerCase().includes(searchVal) ||
        (s.room || '').toLowerCase().includes(searchVal);
      if (!match) return false;
    }
    return true;
  });

  renderBoardTiles(filtered);
}

function renderBoardTiles(sessions) {
  var container = document.getElementById('board-tiles-container');
  if (!container) return;

  if (!sessions.length) {
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--tmu);font-size:13.5px;">No classroom sessions match the active criteria.</div>';
    return;
  }

  container.innerHTML = sessions.map(function (s) {
    var id = s._id || s.sessionId || s.id;
    var isMarked = s.isMarked || s.status === 'marked' || s.marked;
    var isOverdue = s.isOverdue || s.overdue || s.status === 'overdue';
    var needsSub = s.needsSub || (s.flags && s.flags.includes('unresolved_sub')) || s.status === 'unresolved_sub';
    var inWindow = s.inWindow || s.status === 'in_window';

    var cardBorder = needsSub ? 'border-left: 4px solid #ef4444;' :
      isOverdue ? 'border-left: 4px solid #dc2626;' :
      inWindow ? 'border-left: 4px solid #f59e0b;' :
      isMarked ? 'border-left: 4px solid #10b981;' : 'border-left: 4px solid #6366f1;';

    var statusPill = '';
    if (isMarked) {
      statusPill = '<span class="tile-status marked" style="background:#ecfdf5;color:#059669;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;"><re-icon icon="check-circle" size="12"></re-icon> Marked' + (s.turnoutPct != null ? (' (' + s.turnoutPct + '%)') : '') + '</span>';
    } else if (needsSub) {
      statusPill = '<span class="tile-status" style="background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;"><re-icon icon="alert-triangle" size="12"></re-icon> Needs Sub</span>';
    } else if (isOverdue) {
      statusPill = '<span class="tile-status" style="background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;"><re-icon icon="alert-circle" size="12"></re-icon> Overdue &gt;10m</span>';
    } else if (inWindow) {
      statusPill = '<span class="tile-status" style="background:#fffbeb;color:#d97706;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;"><re-icon icon="timer" size="12"></re-icon> In Window &lt;10m</span>';
    } else {
      statusPill = '<span class="tile-status" style="background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">Scheduled</span>';
    }

    var actionBtns = '';
    if (!isMarked) {
      if (isOverdue) {
        actionBtns += '<button class="btn btn-sm btn-sec" style="font-size:11px;padding:3px 7px;" onclick="nudgeTeacherSession(\'' + id + '\')" title="Send urgent reminder nudge to teacher"><re-icon icon="bell" size="12"></re-icon> Nudge</button> ';
      }
      actionBtns += '<button class="btn btn-sm btn-sec" style="font-size:11px;padding:3px 7px;" onclick="openSubstituteModal(\'' + id + '\', \'' + escapeHtml(s.teacherName || '') + '\', \'Period ' + (s.periodNumber || '—') + ' · ' + escapeHtml(s.className || '') + '\')" title="Assign substitute"><re-icon icon="refresh" size="12"></re-icon> Sub</button> ';
      actionBtns += '<button class="btn btn-sm btn-sec" style="font-size:11px;padding:3px 7px;" onclick="openMoveRoomModal(\'' + id + '\', \'' + escapeHtml(s.room || '') + '\')" title="Move Room"><re-icon icon="pin" size="12"></re-icon> Room</button> ';
      actionBtns += '<button class="btn btn-sm btn-sec" style="font-size:11px;padding:3px 7px;color:#ef4444;" onclick="openCancelSessionModal(\'' + id + '\', \'' + (s.periodNumber || '—') + '\', \'' + escapeHtml(s.className || '') + '\')" title="Cancel Period"><re-icon icon="x" size="12"></re-icon></button> ';
    }
    actionBtns += '<button class="btn btn-sm btn-sec" style="font-size:11px;padding:3px 7px;" onclick="openSessionNoteModal(\'' + id + '\')" title="Attach Note"><re-icon icon="file-text" size="12"></re-icon></button> ';
    actionBtns += '<button class="btn btn-sm btn-pri" style="font-size:11px;padding:3px 7px;" onclick="openClassDrawer(\'' + (s.classId || id) + '\')" title="Open Class Live View"><re-icon icon="maximize" size="12"></re-icon> Live</button>';

    return '<div class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px;' + cardBorder + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">' +
        '<div style="cursor:pointer;" onclick="openClassDrawer(\'' + (s.classId || id) + '\')" title="Click to view real-time class roster">' +
          '<div style="font-size:14px;font-weight:700;color:var(--td);display:flex;align-items:center;gap:6px;">' +
            escapeHtml(s.className || 'Class') + ' <re-icon icon="external-link" size="11" style="color:var(--tmu);"></re-icon>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--tmu);margin-top:2px;">Period ' + (s.periodNumber || '—') + (s.start ? (' · ' + s.start + '–' + s.end) : '') + '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
          '<span class="badge" style="background:#f1f5f9;color:#334155;font-weight:600;"><re-icon icon="pin" size="10"></re-icon> ' + escapeHtml(s.room || 'TBD') + '</span>' +
          statusPill +
        '</div>' +
      '</div>' +
      '<div style="font-size:13px;color:var(--td);">' +
        '<div><strong>Subject:</strong> ' + escapeHtml(s.subjectName || s.subjectCode || '—') + '</div>' +
        '<div style="color:var(--tmu);margin-top:2px;"><strong>Faculty:</strong> ' + escapeHtml(s.teacherName || 'Faculty') + (s.isSubstitute ? ' <span class="chip chip-blue" style="font-size:10px;">Sub</span>' : '') + '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:4px;flex-wrap:wrap;margin-top:auto;border-top:1px solid #f1f5f9;padding-top:8px;">' +
        actionBtns +
      '</div>' +
    '</div>';
  }).join('');
}

function switchLiveBoardView(view) {
  var btnGrid = document.getElementById('btn-view-grid');
  var btnMatrix = document.getElementById('btn-view-matrix');
  var viewGrid = document.getElementById('board-view-grid');
  var viewMatrix = document.getElementById('board-view-matrix');

  if (view === 'grid') {
    if (btnGrid) btnGrid.classList.add('act');
    if (btnMatrix) btnMatrix.classList.remove('act');
    if (viewGrid) viewGrid.style.display = 'block';
    if (viewMatrix) viewMatrix.style.display = 'none';
  } else {
    if (btnMatrix) btnMatrix.classList.add('act');
    if (btnGrid) btnGrid.classList.remove('act');
    if (viewGrid) viewGrid.style.display = 'none';
    if (viewMatrix) viewMatrix.style.display = 'block';
    loadDayMatrix();
  }
}

function loadDayMatrix() {
  var tbody = document.getElementById('matrix-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--tmu);"><div class="spin" style="margin:0 auto 10px;"></div>Loading day matrix…</td></tr>';

  var token = getToken();
  var url = '/api/controller/day-matrix?_t=' + Date.now();
  if (_timeMachineActive && _tmDate) url += '&date=' + encodeURIComponent(_tmDate);

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || data.error) throw new Error(data?.error || 'Failed to load day matrix');
      renderDayMatrix(data.matrix || data.rows || []);
    })
    .catch(function (err) {
      console.error('[Day Matrix Error]:', err);
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--tmu);">Failed to load day matrix: ' + escapeHtml(err.message) + '</td></tr>';
    });
}

function renderDayMatrix(rows) {
  var tbody = document.getElementById('matrix-tbody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--tmu);">No class sections found for today.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function (row) {
    var cellsHtml = '';
    for (var p = 1; p <= 8; p++) {
      var period = (row.periods || []).find(function (x) { return x.periodNumber === p; }) || row['p' + p];
      if (period && (period.subject || period.subjectCode || period.subjectName)) {
        var subName = period.subjectCode || period.subjectName || period.subject || '';
        var facName = period.teacherName || period.teacher || '';
        var isMarked = period.status === 'marked' || period.isMarked;
        var bg = isMarked ? '#ecfdf5' : period.status === 'overdue' ? '#fef2f2' : period.status === 'in_window' ? '#fffbeb' : '#f8fafc';
        var col = isMarked ? '#059669' : period.status === 'overdue' ? '#dc2626' : period.status === 'in_window' ? '#d97706' : '#334155';
        cellsHtml += '<td style="background:' + bg + ';color:' + col + ';padding:8px 6px;text-align:center;border:1px solid #e2e8f0;font-size:11px;">' +
          '<div style="font-weight:700;">' + escapeHtml(subName) + '</div>' +
          '<div style="font-size:10px;opacity:0.85;">' + escapeHtml(facName) + '</div>' +
        '</td>';
      } else {
        cellsHtml += '<td style="color:#94a3b8;font-size:11px;text-align:center;border:1px solid #e2e8f0;padding:8px 6px;">—</td>';
      }
    }

    return '<tr>' +
      '<td style="font-weight:700;color:var(--td);border:1px solid #e2e8f0;padding:10px 12px;">' + escapeHtml(row.className || row.name || 'Class') + '</td>' +
      cellsHtml +
    '</tr>';
  }).join('');
}

function toggleTimeMachine() {
  var bar = document.getElementById('time-machine-bar');
  var btn = document.getElementById('btn-view-timemachine');
  if (!bar) return;
  if (bar.style.display === 'none' || !bar.style.display) {
    bar.style.display = 'flex';
    if (btn) btn.classList.add('act');
    var tmDate = document.getElementById('tm-date-picker');
    if (tmDate && !tmDate.value) tmDate.value = todayIST();
  } else {
    resetLiveTimeMachine();
  }
}

function applyTimeMachine() {
  var dateVal = document.getElementById('tm-date-picker')?.value;
  var timeVal = document.getElementById('tm-time-picker')?.value;
  if (!dateVal) {
    showToast('Please select a replay date.');
    return;
  }
  _timeMachineActive = true;
  _tmDate = dateVal;
  _tmTime = timeVal || '09:15';
  var lbl = document.getElementById('tm-active-label');
  if (lbl) lbl.style.display = 'inline-flex';
  reloadLiveBoardData();
}

function resetLiveTimeMachine() {
  _timeMachineActive = false;
  _tmDate = null;
  _tmTime = null;
  var bar = document.getElementById('time-machine-bar');
  if (bar) bar.style.display = 'none';
  var lbl = document.getElementById('tm-active-label');
  if (lbl) lbl.style.display = 'none';
  var btn = document.getElementById('btn-view-timemachine');
  if (btn) btn.classList.remove('act');
  reloadLiveBoardData();
}

function toggleProblemsOnly() {
  _problemsOnly = !_problemsOnly;
  var btn = document.getElementById('btn-problems-toggle');
  if (btn) {
    if (_problemsOnly) btn.classList.add('act');
    else btn.classList.remove('act');
  }
  filterBoardTiles();
}

function generateTodaySessions() {
  var token = getToken();
  showToast('Synchronizing class sessions from active timetables…', 'info');
  fetch('/api/controller/sessions/generate', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ date: todayIST() })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast(res.message || 'Timetable sessions synced successfully!', 'success');
    reloadLiveBoardData();
  })
  .catch(function (err) {
    console.error('[Sync Timetable Error]:', err);
    showToast('Sync failed: ' + err.message, 'error');
  });
}

function confirmDeclareHoliday() {
  var dateVal = document.getElementById('hol-date')?.value;
  var typeVal = document.getElementById('hol-type')?.value || 'holiday';
  var descVal = document.getElementById('hol-desc')?.value || '';

  if (!dateVal) {
    showToast('Please select an event/holiday date.');
    return;
  }
  if (!descVal.trim()) {
    showToast('Please provide a reason or event description.');
    return;
  }

  var token = getToken();
  fetch('/api/controller/calendar/holiday', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      date: dateVal,
      type: typeVal,
      comments: descVal.trim()
    })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast(res.message || 'Academic event/holiday declared!', 'success');
    closeModal('m-declare-holiday');
    reloadLiveBoardData();
  })
  .catch(function (err) {
    console.error('[Declare Holiday Error]:', err);
    showToast('Failed to declare event: ' + err.message, 'error');
  });
}

function confirmExtendAttendanceLock() {
  var minsVal = document.getElementById('lock-ext-mins')?.value || 60;
  var reasonVal = document.getElementById('lock-ext-reason')?.value || '';

  if (!reasonVal.trim()) {
    showToast('Please provide justification for extending the lock.');
    return;
  }

  var token = getToken();
  fetch('/api/controller/attendance/extend-lock', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      minutes: Number(minsVal),
      reason: reasonVal.trim()
    })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast(res.message || 'Attendance lock window extended!', 'success');
    closeModal('m-extend-lock');
    reloadLiveBoardData();
  })
  .catch(function (err) {
    console.error('[Extend Lock Error]:', err);
    showToast('Failed to extend lock: ' + err.message, 'error');
  });
}

function loadLiveAlerts() {
  var list = document.getElementById('board-alerts-list');
  var badge = document.getElementById('alerts-count-badge');
  var sbBadge = document.getElementById('sb-live-alert-badge');
  if (!list) return;

  var token = getToken();
  fetch('/api/controller/alerts?status=active', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    var alerts = data.alerts || [];
    _activeAlerts = alerts;
    if (badge) badge.textContent = alerts.length;
    if (sbBadge) {
      sbBadge.textContent = alerts.length;
      sbBadge.style.display = alerts.length > 0 ? 'inline-block' : 'none';
    }

    if (!alerts.length) {
      list.innerHTML = '<div style="text-align:center;padding:24px 10px;color:#94a3b8;font-size:12px;">No active alerts. System running smoothly.</div>';
      return;
    }

    list.innerHTML = alerts.map(function (a) {
      var id = a._id || a.id;
      var sevBg = a.severity === 'critical' ? '#fef2f2' : a.severity === 'warning' ? '#fffbeb' : '#eff6ff';
      var sevCol = a.severity === 'critical' ? '#dc2626' : a.severity === 'warning' ? '#d97706' : '#2563eb';
      return '<div class="alert-item" style="padding:10px;border-radius:8px;background:' + sevBg + ';border:1px solid ' + sevCol + '33;margin-bottom:8px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">' +
          '<div style="font-size:12.5px;font-weight:700;color:' + sevCol + ';">' + escapeHtml(a.title || a.message || 'Alert') + '</div>' +
          '<span style="font-size:10px;color:#64748b;">' + (a.createdAt ? new Date(a.createdAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '') + '</span>' +
        '</div>' +
        '<div style="font-size:11.5px;color:#475569;margin-top:3px;">' + escapeHtml(a.description || a.context?.reason || '') + '</div>' +
        '<div style="display:flex;gap:4px;justify-content:flex-end;margin-top:6px;">' +
          '<button class="btn btn-sm btn-sec" style="font-size:10.5px;padding:2px 6px;" onclick="ackAlert(\'' + id + '\')">Acknowledge</button>' +
          '<button class="btn btn-sm btn-sec" style="font-size:10.5px;padding:2px 6px;" onclick="resolveAlert(\'' + id + '\')">Resolve</button>' +
        '</div>' +
      '</div>';
    }).join('');
  })
  .catch(function (err) {
    console.error('[Live Alerts Error]:', err);
  });
}

function ackAlert(id) {
  var token = getToken();
  fetch('/api/controller/alerts/' + id + '/ack', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  })
  .then(function () {
    showToast('Alert acknowledged', 'info');
    loadLiveAlerts();
  });
}

function resolveAlert(id) {
  var token = getToken();
  fetch('/api/controller/alerts/' + id + '/resolve', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  })
  .then(function () {
    showToast('Alert resolved', 'success');
    loadLiveAlerts();
  });
}

function nudgeTeacherSession(sessionId) {
  var token = getToken();
  fetch('/api/controller/sessions/' + sessionId + '/nudge', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast('Urgent reminder nudge sent to faculty member!', 'success');
  })
  .catch(function (err) {
    showToast('Nudge failed: ' + err.message, 'error');
  });
}

// Live Board Session Modals
function openSubstituteModal(sessionId, teacherName, periodInfo) {
  _currentSessionActionId = sessionId;
  var desc = document.getElementById('sub-modal-session-desc');
  if (desc) desc.textContent = periodInfo || 'Period Assignment';
  var list = document.getElementById('sub-candidates-list');
  if (list) list.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px;"><div class="spin" style="margin:0 auto 10px;"></div>Searching available faculty…</div>';

  var modal = document.getElementById('substitute-picker-modal');
  if (modal) modal.classList.add('open');

  var token = getToken();
  fetch('/api/controller/free-teachers?_t=' + Date.now(), {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    var candidates = data.freeTeachers || data.candidates || [];
    _subCandidatesCache = candidates;
    renderSubstituteCandidates(candidates);
  })
  .catch(function (err) {
    if (list) list.innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;font-size:12px;">Failed to find faculty: ' + escapeHtml(err.message) + '</div>';
  });
}

function renderSubstituteCandidates(candidates) {
  var list = document.getElementById('sub-candidates-list');
  if (!list) return;
  if (!candidates.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px;">No free faculty found at this period.</div>';
    return;
  }
  list.innerHTML = candidates.map(function (c) {
    var trackId = c.trackId || c._id;
    return '<label style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;">' +
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<input type="radio" name="sub-candidate-radio" value="' + trackId + '">' +
        '<div>' +
          '<div style="font-size:13px;font-weight:700;color:var(--td);">' + escapeHtml(c.fullName || c.name || 'Faculty') + '</div>' +
          '<div style="font-size:11.5px;color:var(--tmu);">' + escapeHtml(c.department || c.deptCode || '') + ' · ' + escapeHtml(c.designation || 'Faculty') + '</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="btn btn-sm btn-pri" style="font-size:11px;padding:3px 8px;" onclick="confirmAssignSubstituteFromRadio(\'' + trackId + '\')">Assign</button>' +
    '</label>';
  }).join('');
}

function filterSubstituteCandidates(query) {
  var q = (query || '').toLowerCase().trim();
  if (!q) {
    renderSubstituteCandidates(_subCandidatesCache);
    return;
  }
  var filtered = _subCandidatesCache.filter(function (c) {
    return (c.fullName || c.name || '').toLowerCase().includes(q) ||
      (c.department || c.deptCode || '').toLowerCase().includes(q) ||
      (c.designation || '').toLowerCase().includes(q);
  });
  renderSubstituteCandidates(filtered);
}

function confirmAssignSubstituteFromRadio(trackId) {
  if (!_currentSessionActionId) return;
  var reason = document.getElementById('sub-assign-reason')?.value || '';
  var token = getToken();

  fetch('/api/controller/sessions/' + _currentSessionActionId + '/substitute', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ substituteTrackId: trackId, reason: reason })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast('Substitute assigned successfully!', 'success');
    closeSubstituteModal();
    reloadLiveBoardData();
  })
  .catch(function (err) {
    showToast('Assignment failed: ' + err.message, 'error');
  });
}

function closeSubstituteModal() {
  var modal = document.getElementById('substitute-picker-modal');
  if (modal) modal.classList.remove('open');
  _currentSessionActionId = null;
}

function openCancelSessionModal(sessionId, period, className) {
  _currentSessionActionId = sessionId;
  var pEl = document.getElementById('cancel-modal-period');
  var cEl = document.getElementById('cancel-modal-class');
  if (pEl) pEl.textContent = period;
  if (cEl) cEl.textContent = className;
  var reason = document.getElementById('cancel-session-reason');
  if (reason) reason.value = '';
  var modal = document.getElementById('cancel-session-modal');
  if (modal) modal.classList.add('open');
}

function closeCancelSessionModal() {
  var modal = document.getElementById('cancel-session-modal');
  if (modal) modal.classList.remove('open');
  _currentSessionActionId = null;
}

function confirmCancelSession() {
  if (!_currentSessionActionId) return;
  var reason = document.getElementById('cancel-session-reason')?.value || '';
  if (!reason.trim()) {
    showToast('Cancellation reason is required.');
    return;
  }
  var token = getToken();
  fetch('/api/controller/sessions/' + _currentSessionActionId + '/cancel', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason.trim() })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast('Period cancelled.', 'success');
    closeCancelSessionModal();
    reloadLiveBoardData();
  })
  .catch(function (err) {
    showToast('Cancellation failed: ' + err.message, 'error');
  });
}

function openMoveRoomModal(sessionId, currentRoom) {
  _currentSessionActionId = sessionId;
  var input = document.getElementById('move-room-name');
  if (input) input.value = currentRoom || '';
  var modal = document.getElementById('move-room-modal');
  if (modal) modal.classList.add('open');
}

function closeMoveRoomModal() {
  var modal = document.getElementById('move-room-modal');
  if (modal) modal.classList.remove('open');
  _currentSessionActionId = null;
}

function confirmMoveRoom() {
  if (!_currentSessionActionId) return;
  var room = document.getElementById('move-room-name')?.value || '';
  var reason = document.getElementById('move-room-reason')?.value || '';
  if (!room.trim()) {
    showToast('Room name/number is required.');
    return;
  }
  var token = getToken();
  fetch('/api/controller/sessions/' + _currentSessionActionId + '/room', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: room.trim(), reason: reason.trim() })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast('Session room relocated to ' + room.trim(), 'success');
    closeMoveRoomModal();
    reloadLiveBoardData();
  })
  .catch(function (err) {
    showToast('Room move failed: ' + err.message, 'error');
  });
}

function openSessionNoteModal(sessionId) {
  _currentSessionActionId = sessionId;
  var text = document.getElementById('session-note-text');
  if (text) text.value = '';
  var modal = document.getElementById('session-note-modal');
  if (modal) modal.classList.add('open');
}

function closeSessionNoteModal() {
  var modal = document.getElementById('session-note-modal');
  if (modal) modal.classList.remove('open');
  _currentSessionActionId = null;
}

function confirmSaveSessionNote() {
  if (!_currentSessionActionId) return;
  var note = document.getElementById('session-note-text')?.value || '';
  if (!note.trim()) {
    showToast('Please enter note text.');
    return;
  }
  var token = getToken();
  fetch('/api/controller/sessions/' + _currentSessionActionId + '/note', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: note.trim() })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast('Executive note attached!', 'success');
    closeSessionNoteModal();
    reloadLiveBoardData();
  })
  .catch(function (err) {
    showToast('Failed to save note: ' + err.message, 'error');
  });
}

// Student record & warning letter
function openStudentRecordModal(trackId) {
  var modal = document.getElementById('student-record-modal');
  if (modal) modal.classList.add('open');

  var token = getToken();
  fetch('/api/controller/students/' + trackId + '/record', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    _currentStudentRecord = data;
    var st = data.student || {};
    var srName = document.getElementById('sr-name');
    if (srName) srName.textContent = st.name || st.fullName || 'Student';
    var srSub = document.getElementById('sr-sub-info');
    if (srSub) srSub.textContent = 'Roll: ' + (st.rollNo || '—') + ' · Reg: ' + (st.registerNo || '—') + ' · ' + (st.className || '') + ' · ' + (st.deptCode || '');
    var srAv = document.getElementById('sr-avatar');
    if (srAv) srAv.textContent = (st.name ? st.name.charAt(0) : 'S').toUpperCase();

    var pct = data.attendancePct != null ? data.attendancePct : 0;
    var srPct = document.getElementById('sr-overall-pct');
    if (srPct) srPct.textContent = pct + '%';

    var bandBadge = document.getElementById('sr-band-badge');
    if (bandBadge) {
      bandBadge.className = 'sr-band-badge ' + (pct >= 75 ? 'good' : pct >= 65 ? 'average' : 'danger');
      bandBadge.textContent = pct >= 75 ? 'Good Standing' : pct >= 65 ? 'Average / At Risk' : 'Critical Defaulter';
    }

    var projText = document.getElementById('sr-projection-text');
    if (projText) {
      if (pct >= 75) {
        projText.textContent = 'Safe margin: Student meets institutional minimum requirement.';
      } else {
        var needed = data.classesNeeded || Math.ceil((0.75 * (data.totalConducted || 10) - (data.totalAttended || 0)) / 0.25);
        projText.textContent = 'Must attend next ' + Math.max(1, needed) + ' consecutive classes to reach 75%.';
      }
    }

    var countsText = document.getElementById('sr-counts-text');
    if (countsText) countsText.textContent = (data.totalAttended || 0) + ' attended of ' + (data.totalConducted || 0) + ' held classes';

    var subTbody = document.getElementById('sr-subject-tbody');
    if (subTbody) {
      var subs = data.subjects || [];
      if (!subs.length) {
        subTbody.innerHTML = '<tr><td colspan="6" class="text-center">No subject attendance records found.</td></tr>';
      } else {
        subTbody.innerHTML = subs.map(function (sub) {
          var spct = sub.pct != null ? sub.pct : 0;
          return '<tr>' +
            '<td><strong>' + escapeHtml(sub.name || sub.code) + '</strong></td>' +
            '<td>' + escapeHtml(sub.faculty || 'Faculty') + '</td>' +
            '<td>' + (sub.conducted || 0) + '</td>' +
            '<td>' + (sub.attended || 0) + '</td>' +
            '<td><strong>' + spct + '%</strong></td>' +
            '<td><span class="status-tag ' + (spct >= 75 ? 'approved' : 'rejected') + '">' + (spct >= 75 ? 'Pass' : 'Defaulter') + '</span></td>' +
          '</tr>';
        }).join('');
      }
    }
  })
  .catch(function (err) {
    showToast('Failed to load student record: ' + err.message, 'error');
  });
}

function closeStudentRecordModal() {
  var modal = document.getElementById('student-record-modal');
  if (modal) modal.classList.remove('open');
  _currentStudentRecord = null;
}

function generateWarningLetterFromCurrent() {
  if (!_currentStudentRecord) return;
  var st = _currentStudentRecord.student || {};
  var wlRef = document.getElementById('wl-ref-no');
  if (wlRef) wlRef.textContent = 'EAMS/WL/' + new Date().getFullYear() + '/' + (st.registerNo || '001');
  var wlDate = document.getElementById('wl-date');
  if (wlDate) wlDate.textContent = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  var wlParent = document.getElementById('wl-parent-name');
  if (wlParent) wlParent.innerHTML = 'The Parent / Guardian of <strong>' + escapeHtml(st.name || 'Student') + '</strong>';
  var wlDetails = document.getElementById('wl-student-details');
  if (wlDetails) wlDetails.textContent = 'Roll No: ' + (st.rollNo || '—') + ' · Register No: ' + (st.registerNo || '—') + ' · Class: ' + (st.className || '—');

  var modal = document.getElementById('warning-letter-modal');
  if (modal) modal.classList.add('open');
}

function closeWarningLetterModal() {
  var modal = document.getElementById('warning-letter-modal');
  if (modal) modal.classList.remove('open');
}

function printWarningLetter() {
  window.print();
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
  picker.value = todayIST(d);
  loadDailyAttendance();
}

function setAttendanceToday() {
  var picker = document.getElementById('att-date-picker');
  if (!picker) return;
  picker.value = todayIST();
  loadDailyAttendance();
}

function loadDailyAttendance() {
  var token = getToken();
  var dateStr = document.getElementById('att-date-picker')?.value || todayIST();
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
    var emergencyBadge = isEmergency ? '<span class="status-tag emergency"><re-icon icon="siren"></re-icon> Emergency</span>' : '<span style="color:#64748b;">Regular</span>';

    var statusTag = leave.status === 'Approved'
      ? '<span class="status-tag approved">Approved</span>'
      : leave.status === 'Rejected'
        ? '<span class="status-tag rejected">Rejected</span>'
        : '<span class="status-tag pending">Pending</span>';

    var dateRange = leave.fromDate === leave.toDate ? leave.fromDate : (leave.fromDate + ' <re-icon icon="arrow-right"></re-icon> ' + leave.toDate);

    return '' +
      '<tr>' +
        '<td><input type="checkbox" class="leave-item-check" data-id="' + leave._id + '"></td>' +
        '<td><strong>' + name + '</strong></td>' +
        '<td>' + classDept + '</td>' +
        '<td>' + (leave.category || 'Leave') + ' · ' + (leave.leaveType || 'Casual') + '</td>' +
        '<td>' + dateRange + '</td>' +
        '<td><strong>' + leave.daysCount + ' d</strong></td>' +
        '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(leave.reason || '') + '">' + escapeHtml(leave.reason || '') + '</td>' +
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

  if (title) title.innerHTML = (action === 'approve' ? '<re-icon icon="check-circle"></re-icon> Bulk Approve ' : '<re-icon icon="x-circle"></re-icon> Bulk Reject ') + ids.length + ' Request(s)';
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

  if (title) title.innerHTML = (action === 'approve' ? '<re-icon icon="check-circle"></re-icon> Approve Leave' : '<re-icon icon="x-circle"></re-icon> Reject Leave');
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
    if (t.isPrincipal) specials.push('<span class="chip chip-purple">Principal</span>');
    if (t.isHod) specials.push('<span class="chip chip-yellow">HOD</span>');
    if (t.isTimeTableCoordinator) specials.push('<span class="chip chip-green">TT Coord</span>');
    if (t.isAdmin) specials.push('<span class="chip chip-purple">Admin</span>');
    var specHtml = specials.length ? specials.join(' ') : '—';

    var markingTag = t.todayMarkingStatus === 'Marked'
      ? '<span class="status-tag approved"><re-icon icon="check-circle"></re-icon> Marked (' + t.todayPeriodsMarked + ')</span>'
      : '<span class="status-tag pending"><re-icon icon="hourglass"></re-icon> Pending</span>';

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
  var dateStr = document.getElementById('records-date-picker')?.value || todayIST();
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

function changeRecordsDate(delta) {
  var picker = document.getElementById('records-date-picker');
  if (!picker) return;
  var current = picker.value ? new Date(picker.value) : new Date();
  current.setDate(current.getDate() + delta);
  picker.value = todayIST(current);
  loadPeriodRecords();
}

// ── 7. DEFAULTERS REPORT & BULK MEET ME ACTION ───────────────────
var _activeDefaulterBand = 'all';

function loadDefaultersData(band) {
  if (band) _activeDefaulterBand = band;
  var token = getToken();
  var url = '/api/controller/defaulters?band=' + encodeURIComponent(_activeDefaulterBand) + '&_t=' + Date.now();
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  var tbody = document.getElementById('defaulters-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="text-center"><div class="spin" style="margin:0 auto 10px;"></div>Calculating defaulter students…</td></tr>';

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      cachedDefaulters = data.defaulters || [];
      var badge = document.getElementById('defaulter-count-badge');
      if (badge) badge.textContent = (data.totalDefaulters != null ? data.totalDefaulters : cachedDefaulters.length) + ' Defaulters Found';

      var bAll = document.getElementById('count-def-all');
      if (bAll) bAll.textContent = data.totalDefaulters != null ? data.totalDefaulters : cachedDefaulters.length;
      var bCond = document.getElementById('count-def-cond');
      if (bCond) bCond.textContent = data.condonationCount != null ? data.condonationCount : 0;
      var bCrit = document.getElementById('count-def-crit');
      if (bCrit) bCrit.textContent = data.criticalCount != null ? data.criticalCount : 0;

      var threshLbl = document.getElementById('defaulter-threshold-lbl');
      if (threshLbl) threshLbl.textContent = '< ' + (data.threshold || 75) + '%';

      if (!cachedDefaulters.length) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center">No students in this band below minimum attendance threshold! <re-icon icon="confetti"></re-icon></td></tr>';
        return;
      }

      tbody.innerHTML = cachedDefaulters.map(function (d) {
        var shortfall = Math.max(0, Math.round(((d.threshold || 75) - d.pct) * 10) / 10) + '%';
        var bandBadge = d.band === 'condonation'
          ? '<span class="status-tag pending" style="background:#fffbeb;color:#d97706;">Condonation (65-75%)</span>'
          : '<span class="status-tag rejected" style="background:#fef2f2;color:#dc2626;">Critical (&lt;65%)</span>';
        var classesNeededStr = d.classesNeeded != null ? (d.classesNeeded + ' classes') : '—';

        return '<tr>' +
          '<td><input type="checkbox" class="defaulter-item-check" data-trackid="' + escapeHtml(d.studentTrackId) + '" checked></td>' +
          '<td><strong>' + escapeHtml(d.regNo || '—') + '</strong></td>' +
          '<td><strong>' + escapeHtml(d.name || 'Student') + '</strong></td>' +
          '<td>' + escapeHtml(d.className || '') + ' - ' + escapeHtml(d.section || '') + '</td>' +
          '<td>' + escapeHtml(d.deptName || '') + '</td>' +
          '<td>' + (d.classesHeld || 0) + '</td>' +
          '<td>' + (d.classesAttended || 0) + '</td>' +
          '<td><strong style="color:#ef4444;">' + d.pct + '%</strong></td>' +
          '<td>' + bandBadge + '</td>' +
          '<td><span class="chip chip-red">' + classesNeededStr + '</span></td>' +
          '<td><button class="btn btn-sm btn-sec" onclick="openStudentRecordModal(\'' + escapeHtml(d.studentTrackId) + '\')"><re-icon icon="search" size="12"></re-icon> Profile</button></td>' +
        '</tr>';
      }).join('');
    })
    .catch(function (err) {
      console.error('[Defaulters Error]:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="text-center" style="color:#ef4444;">Failed to load defaulters: ' + escapeHtml(err.message) + '</td></tr>';
    });
}

function filterDefaulterBand(band) {
  _activeDefaulterBand = band || 'all';
  var tabs = ['all', 'condonation', 'critical'];
  tabs.forEach(function (t) {
    var el = document.getElementById(t === 'all' ? 'tab-def-all' : t === 'condonation' ? 'tab-def-condonation' : 'tab-def-critical');
    if (el) {
      if (t === _activeDefaulterBand) el.classList.add('act');
      else el.classList.remove('act');
    }
  });
  loadDefaultersData(_activeDefaulterBand);
}

function exportDefaultersCsv() {
  var token = getToken();
  window.open('/api/controller/export/defaulters.csv?token=' + encodeURIComponent(token), '_blank');
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
  var tabs = ['daily', 'punctuality', 'heatmap', 'monthly', 'semester'];
  tabs.forEach(function (t) {
    var btn = document.getElementById(t === 'daily' ? 'tab-btn-daily-rpt' : t === 'punctuality' ? 'tab-btn-punct-rpt' : t === 'heatmap' ? 'tab-btn-heat-rpt' : t === 'monthly' ? 'tab-btn-monthly-rpt' : 'tab-btn-sem-rpt');
    var sec = document.getElementById(t === 'daily' ? 'rpt-daily-sec' : t === 'punctuality' ? 'rpt-punct-sec' : t === 'heatmap' ? 'rpt-heat-sec' : t === 'monthly' ? 'rpt-monthly-sec' : 'rpt-semester-sec');
    if (btn) {
      if (t === tab) btn.classList.add('act');
      else btn.classList.remove('act');
    }
    if (sec) {
      sec.style.display = (t === tab ? 'block' : 'none');
    }
  });

  if (tab === 'daily') loadDailyReport();
  else if (tab === 'punctuality') loadPunctualityReport();
  else if (tab === 'heatmap') loadHeatmapReport();
  else if (tab === 'monthly') loadMonthlyReport();
  else if (tab === 'semester') loadSemesterReport();
}

function loadDailyReport() {
  var token = getToken();
  var dateStr = document.getElementById('rpt-daily-picker')?.value || todayIST();
  var url = '/api/controller/reports/daily?date=' + encodeURIComponent(dateStr);
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  var tbody = document.getElementById('daily-rpt-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center"><div class="spin" style="margin:0 auto 10px;"></div>Generating operations roll-up…</td></tr>';

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var s = data.summary || {};
      var setVal = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
      setVal('dr-scheduled', s.totalScheduled || 0);
      setVal('dr-held', s.held || 0);
      setVal('dr-ontime', (s.onTimeRate || 0) + '%');
      setVal('dr-late', s.markedLate || 0);
      setVal('dr-overdue', s.overdue || 0);
      setVal('dr-presence', (s.averagePresence || 0) + '%');

      var insightsBox = document.getElementById('dr-insights-box');
      if (insightsBox) {
        if (Array.isArray(data.insights) && data.insights.length) {
          insightsBox.style.display = 'block';
          insightsBox.innerHTML = '<strong>Operational Insights:</strong><ul style="margin:4px 0 0 16px;padding:0;">' +
            data.insights.map(function(ins) { return '<li>' + escapeHtml(ins) + '</li>'; }).join('') + '</ul>';
        } else {
          insightsBox.style.display = 'none';
        }
      }

      var rows = data.sectionsBreakdown || [];
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No session data recorded for ' + dateStr + '.</td></tr>';
        return;
      }

      tbody.innerHTML = rows.map(function (row) {
        return '<tr>' +
          '<td><strong>' + escapeHtml(row.className) + '</strong></td>' +
          '<td>' + (row.scheduled || 0) + '</td>' +
          '<td><span style="color:#059669;font-weight:700;">' + (row.held || 0) + '</span></td>' +
          '<td><span style="color:#2563eb;font-weight:700;">' + (row.onTime || 0) + ' (' + (row.onTimePct || 0) + '%)</span></td>' +
          '<td><span style="color:#d97706;font-weight:700;">' + (row.late || 0) + '</span></td>' +
          '<td><strong>' + (row.presencePct || 0) + '%</strong></td>' +
        '</tr>';
      }).join('');
    })
    .catch(function (err) {
      console.error('[Daily Report Error]:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color:#ef4444;">Failed to load daily report: ' + escapeHtml(err.message) + '</td></tr>';
    });
}

function exportDailyReportCsv() {
  var token = getToken();
  window.open('/api/controller/reports/export/daily?token=' + encodeURIComponent(token), '_blank');
}

function loadPunctualityReport() {
  var token = getToken();
  var url = '/api/controller/reports/punctuality?_t=' + Date.now();
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  var tbody = document.getElementById('punct-rpt-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center"><div class="spin" style="margin:0 auto 10px;"></div>Auditing faculty punctuality…</td></tr>';

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var teachers = data.teachers || [];
      if (!teachers.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No faculty teaching data available.</td></tr>';
        return;
      }

      tbody.innerHTML = teachers.map(function (t) {
        var onTimeColor = t.onTimeRate >= 85 ? '#059669' : t.onTimeRate >= 70 ? '#d97706' : '#dc2626';
        return '<tr>' +
          '<td><strong>' + escapeHtml(t.name) + '</strong></td>' +
          '<td>' + escapeHtml(t.deptCode || '—') + '</td>' +
          '<td>' + (t.totalAssigned || 0) + '</td>' +
          '<td>' + (t.totalConducted || 0) + '</td>' +
          '<td>' + (t.tapRate || 0) + '%</td>' +
          '<td><strong style="color:' + onTimeColor + ';">' + (t.onTimeRate || 0) + '%</strong></td>' +
          '<td>' + (t.medianMinutes != null ? (t.medianMinutes + ' mins') : '—') + '</td>' +
          '<td>' + (t.substitutionsConducted || 0) + '</td>' +
        '</tr>';
      }).join('');
    })
    .catch(function (err) {
      console.error('[Punctuality Report Error]:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="color:#ef4444;">Failed to load punctuality: ' + escapeHtml(err.message) + '</td></tr>';
    });
}

function exportPunctualityCsv() {
  var token = getToken();
  window.open('/api/controller/reports/export/punctuality?token=' + encodeURIComponent(token), '_blank');
}

function loadHeatmapReport() {
  var token = getToken();
  var url = '/api/controller/reports/heatmap?_t=' + Date.now();
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  var tbody = document.getElementById('heatmap-grid-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="text-center"><div class="spin" style="margin:0 auto 10px;"></div>Building presence heatmap…</td></tr>';

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var heatmap = data.heatmap || {};
      var days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      tbody.innerHTML = days.map(function (d) {
        var daySlots = heatmap[d] || {};
        var cellsHtml = [];
        for (var p = 1; p <= 8; p++) {
          var pct = daySlots['P' + p];
          var cellContent = '—';
          var bg = '#f8fafc';
          var col = '#94a3b8';

          if (pct != null) {
            cellContent = pct + '%';
            if (pct >= 85) { bg = '#ecfdf5'; col = '#059669'; }
            else if (pct >= 75) { bg = '#f0fdf4'; col = '#16a34a'; }
            else if (pct >= 65) { bg = '#fffbeb'; col = '#d97706'; }
            else { bg = '#fef2f2'; col = '#dc2626'; }
          }

          cellsHtml.push('<td style="background:' + bg + ';color:' + col + ';font-weight:700;text-align:center;padding:10px 8px;border:1px solid #e2e8f0;font-size:12px;">' + cellContent + '</td>');
        }

        return '<tr><td style="font-weight:700;color:var(--td);border:1px solid #e2e8f0;padding:10px 12px;">' + d + '</td>' + cellsHtml.join('') + '</tr>';
      }).join('');
    })
    .catch(function (err) {
      console.error('[Heatmap Error]:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="color:#ef4444;">Failed to build heatmap: ' + escapeHtml(err.message) + '</td></tr>';
    });
}

function loadMonthlyReport() {
  var token = getToken();
  var monthStr = document.getElementById('rpt-month-picker')?.value || todayIST().slice(0, 7);
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
  var isDaily = document.getElementById('rpt-daily-sec')?.style.display !== 'none';
  var isPunct = document.getElementById('rpt-punct-sec')?.style.display !== 'none';

  if (isDaily) {
    exportDailyReportCsv();
    return;
  }
  if (isPunct) {
    exportPunctualityCsv();
    return;
  }

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
      showToast('<re-icon icon="bullhorn"></re-icon> Broadcast announcement dispatched successfully!');
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
            '<div style="font-size:13px;color:var(--td);line-height:1.4;">' + escapeHtml(b.message || '') + '</div>' +
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
  checkTimetablePendingAlert();
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

// ── 11b. FACULTY WORKLOAD & SCHEDULE ────────────────────────────
function loadWorkloadSection() {
  if (typeof WorkloadShared === 'undefined') {
    console.warn('[WorkloadShared] Module not loaded');
    return;
  }
  var isPrincipal = controllerContext.role === 'principal';
  WorkloadShared.init({
    containerId: 'ctrl-workload-container',
    deptSelectId: 'ctrl-workload-dept-select',
    isPrincipal: isPrincipal,
    deptId: isPrincipal ? (selectedDeptFilter || null) : controllerContext.deptId,
    deptName: controllerContext.deptName || controllerContext.deptCode || ''
  });
}

// ── 11c. TIMETABLE VERIFICATION & APPROVALS (HOD & PRINCIPAL) ───
var _ctrlTtRequests = [];
var _ctrlTtFilter = 'pending';

function updateCtrlTtVerificationBadge(optionalCount) {
  if (typeof optionalCount === 'number') {
    var badge = document.getElementById('sb-tt-verify-badge');
    if (badge) {
      badge.textContent = optionalCount;
      badge.style.display = optionalCount > 0 ? 'inline-block' : 'none';
    }
    return;
  }
  var token = getToken();
  fetch('/api/timetable/verification-requests?status=pending', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    var items = res && res.data ? res.data : (Array.isArray(res) ? res : []);
    var count = Array.isArray(items) ? items.length : 0;
    var badge = document.getElementById('sb-tt-verify-badge');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
    var viewBadge = document.getElementById('ctrl-tt-view-badge');
    if (viewBadge) {
      viewBadge.textContent = count;
      viewBadge.style.display = count > 0 ? 'inline-block' : 'none';
    }
  })
  .catch(function () {});
}

function checkTimetablePendingAlert() {
  var token = getToken();
  fetch('/api/timetable/verification-requests?status=pending', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    var items = res && res.data ? res.data : (Array.isArray(res) ? res : []);
    var count = Array.isArray(items) ? items.length : 0;
    var alertEl = document.getElementById('ctrl-tt-pending-alert');
    var badgeEl = document.getElementById('ctrl-tt-view-badge');
    var msgEl = document.getElementById('ctrl-tt-pending-alert-msg');
    if (badgeEl) {
      badgeEl.textContent = count;
      badgeEl.style.display = count > 0 ? 'inline-block' : 'none';
    }
    if (alertEl) {
      if (count > 0) {
        alertEl.style.display = 'flex';
        if (msgEl) {
          var names = items.slice(0, 3).map(function(x) { return x.className || 'Class'; }).join(', ');
          msgEl.textContent = count + ' timetable schedule draft' + (count > 1 ? 's are' : ' is') + ' awaiting your verification (' + names + (count > 3 ? '...' : '') + ').';
        }
      } else {
        alertEl.style.display = 'none';
      }
    }
    updateCtrlTtVerificationBadge(count);
  })
  .catch(function () {});
}

async function loadCtrlTimetableVerificationPage() {
  var container = document.getElementById('ctrl-tt-table-container');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:36px;color:var(--tmu);font-size:13px;">Loading verification requests…</div>';

  try {
    var token = getToken();
    var res = await fetch('/api/timetable/verification-requests', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (r) { return r.json(); });

    _ctrlTtRequests = res && res.data ? res.data : (Array.isArray(res) ? res : []);

    var pendingCount = _ctrlTtRequests.filter(function(r) { return (r.verificationStatus || r.status) === 'pending'; }).length;
    var approvedCount = _ctrlTtRequests.filter(function(r) { return (r.verificationStatus || r.status) === 'approved'; }).length;
    var publishedCount = _ctrlTtRequests.filter(function(r) { return (r.verificationStatus || r.status) === 'published'; }).length;

    var elPending = document.getElementById('ctrl-tt-kpi-pending');
    var elApproved = document.getElementById('ctrl-tt-kpi-approved');
    var elPublished = document.getElementById('ctrl-tt-kpi-published');
    if (elPending) elPending.textContent = pendingCount;
    if (elApproved) elApproved.textContent = approvedCount;
    if (elPublished) elPublished.textContent = publishedCount;

    updateCtrlTtVerificationBadge(pendingCount);

    renderCtrlTtTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:36px;color:#dc2626;font-size:13px;">Failed to load verification requests: ' + escapeHtml(err.message) + '</div>';
  }
}

function filterCtrlTtRequests(filter) {
  _ctrlTtFilter = filter;
  var btnPending = document.getElementById('ctrl-tt-filter-pending');
  var btnAll = document.getElementById('ctrl-tt-filter-all');
  if (btnPending) btnPending.classList.toggle('act', filter === 'pending');
  if (btnAll) btnAll.classList.toggle('act', filter === 'all');
  renderCtrlTtTable();
}

function renderCtrlTtTable() {
  var container = document.getElementById('ctrl-tt-table-container');
  if (!container) return;

  var filtered = _ctrlTtRequests;
  if (_ctrlTtFilter === 'pending') {
    filtered = _ctrlTtRequests.filter(function(r) { return (r.verificationStatus || r.status) === 'pending'; });
  }

  if (!filtered.length) {
    container.innerHTML = '<div style="text-align:center;padding:48px 24px;color:var(--tmu);">'
      + '<div style="font-size:32px;margin-bottom:8px;"><re-icon icon="clipboard-list"></re-icon></div>'
      + '<div style="font-weight:700;font-size:14px;color:var(--td);margin-bottom:4px;">No Verification Requests Found</div>'
      + '<div style="font-size:12px;">' + (_ctrlTtFilter === 'pending' ? 'There are currently no timetable drafts awaiting your verification.' : 'No timetable verification requests have been submitted.') + '</div>'
      + '</div>';
    return;
  }

  var html = '<table class="table" style="width:100%;border-collapse:collapse;font-size:12.5px;">'
    + '<thead>'
    + '<tr style="border-bottom:1.5px solid var(--br);background:var(--bg2,#f8faf8);text-align:left;">'
    + '<th style="padding:10px 14px;">Class / Section</th>'
    + '<th style="padding:10px 14px;">Version</th>'
    + '<th style="padding:10px 14px;">Submitted By</th>'
    + '<th style="padding:10px 14px;">Date</th>'
    + '<th style="padding:10px 14px;">Status</th>'
    + '<th style="padding:10px 14px;">Notes</th>'
    + '<th style="padding:10px 14px;min-width:240px;text-align:right;">Actions</th>'
    + '</tr>'
    + '</thead>'
    + '<tbody>'
    + filtered.map(function(r) {
        var status = r.verificationStatus || r.status || 'pending';
        var isPending = status === 'pending';
        var isApproved = status === 'approved';
        var isPublished = status === 'published';
        var isRejected = status === 'rejected';

        var reqDate = (r.verificationRequest && r.verificationRequest.requestedAt) || r.createdAt;
        var dateStr = reqDate ? new Date(reqDate).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
        var submitter = (r.verificationRequest && r.verificationRequest.requestedBy) || r.savedBy || 'Coordinator';

        return '<tr style="border-bottom:1px solid var(--br);">'
          + '<td style="padding:10px 14px;font-weight:700;color:var(--td);"><re-icon icon="chalkboard"></re-icon> ' + escapeHtml(r.className || 'General') + '</td>'
          + '<td style="padding:10px 14px;"><span class="badge" style="background:#eef2ff;color:#4338ca;font-size:11px;font-weight:600;">' + escapeHtml(r.versionName || ('v' + r.version)) + '</span></td>'
          + '<td style="padding:10px 14px;font-size:12px;"><re-icon icon="user"></re-icon> ' + escapeHtml(submitter) + '</td>'
          + '<td style="padding:10px 14px;font-size:11.5px;color:var(--tmu);font-family:monospace;">' + dateStr + '</td>'
          + '<td style="padding:10px 14px;">'
          + (isPending ? '<span class="badge" style="background:#fef3c7;color:#b45309;"><re-icon icon="hourglass"></re-icon> Pending Review</span>' : '')
          + (isApproved ? '<span class="badge" style="background:#dcfce7;color:#15803d;"><re-icon icon="check"></re-icon> Approved</span>' : '')
          + (isPublished ? '<span class="badge" style="background:#dbeafe;color:#1d4ed8;"><re-icon icon="rocket"></re-icon> Published</span>' : '')
          + (isRejected ? '<span class="badge" style="background:#fee2e2;color:#b91c1c;"><re-icon icon="x"></re-icon> Rejected</span>' : '')
          + (status === 'withdrawn' ? '<span class="badge" style="background:#f1f5f9;color:#64748b;"><re-icon icon="x"></re-icon> Withdrawn</span>' : '')
          + '</td>'
          + '<td style="padding:10px 14px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--tmu);" title="' + escapeHtml((r.verificationRequest && r.verificationRequest.notes) || r.changeSummary || '') + '">'
          + escapeHtml((r.verificationRequest && r.verificationRequest.notes) || r.changeSummary || '—')
          + ((r.verificationRequest && r.verificationRequest.comment) ? '<br><small style="color:#15803d;"><b>HoD:</b> ' + escapeHtml(r.verificationRequest.comment) + '</small>' : '')
          + '</td>'
          + '<td style="padding:10px 14px;text-align:right;">'
          + '<div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;">'
          + '<button type="button" class="btn btn-sm btn-sec" onclick="openCtrlTimetableMatrixModal(\'' + escapeHtml(r._id) + '\')" style="font-size:11.5px;padding:4px 10px;"><re-icon icon="grid"></re-icon> View Matrix &amp; Changes</button>'
          + (isPending ? '<button type="button" class="btn btn-sm btn-pri" onclick="ctrlReviewTimetable(\'' + escapeHtml(r._id) + '\', \'approve\')" style="font-size:11.5px;padding:4px 12px;background:#16a34a;font-weight:700;"><re-icon icon="check"></re-icon> Approve</button>'
          + '<button type="button" class="btn btn-sm btn-danger" onclick="ctrlReviewTimetable(\'' + escapeHtml(r._id) + '\', \'reject\')" style="font-size:11.5px;padding:4px 9px;"><re-icon icon="x"></re-icon> Reject</button>' : '')
          + '</div>'
          + '</td>'
          + '</tr>';
      }).join('')
    + '</tbody></table>';

  container.innerHTML = html;
}

async function ctrlReviewTimetable(id, action) {
  var comment = '';
  // Locate item details from cached inbox or dedicated verification requests
  var inboxItem = (typeof _inboxItems !== 'undefined' && Array.isArray(_inboxItems))
    ? _inboxItems.find(function (i) { return String(i.id || i._id) === String(id); })
    : null;
  var reqItem = (typeof _ctrlTtRequests !== 'undefined' && Array.isArray(_ctrlTtRequests))
    ? _ctrlTtRequests.find(function (r) { return String(r._id) === String(id); })
    : null;

  var className = (reqItem && reqItem.className) || (inboxItem && inboxItem.context && (inboxItem.context.className || inboxItem.context.class)) || (inboxItem && inboxItem.department) || 'Selected Class';
  var versionName = (reqItem && (reqItem.versionName || ('v' + reqItem.version))) || (inboxItem && inboxItem.context && (inboxItem.context.versionName || inboxItem.context.version)) || 'Current Draft';
  var submitter = (reqItem && ((reqItem.verificationRequest && reqItem.verificationRequest.requestedBy) || reqItem.savedBy)) || (inboxItem && (inboxItem.requester || (inboxItem.context && inboxItem.context.submitter))) || 'Coordinator';
  var notes = (reqItem && ((reqItem.verificationRequest && reqItem.verificationRequest.notes) || reqItem.changeSummary)) || (inboxItem && inboxItem.context && inboxItem.context.notes) || '';

  if (action === 'reject') {
    var promptFn = window.showPrompt || (typeof showPrompt === 'function' ? showPrompt : null);
    var promptHtml = '<div style="margin-bottom:12px;font-size:13.5px;color:var(--td);line-height:1.5;">' +
      'Please enter your review feedback or reason for rejecting this timetable schedule:' +
      '</div>' +
      '<div style="background:var(--bg2,#f8fafc);border:1px solid var(--br);border-radius:12px;padding:12px 14px;margin-bottom:12px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;flex-wrap:wrap;">' +
          '<span style="font-weight:700;font-size:14px;color:var(--td);display:inline-flex;align-items:center;gap:6px;">' +
            '<re-icon icon="chalkboard" size="14" style="color:#dc2626;"></re-icon> ' + escapeHtml(className) +
          '</span>' +
          '<span class="badge" style="background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;font-size:11px;padding:2px 8px;border-radius:6px;font-weight:700;">' +
            'Version: ' + escapeHtml(versionName) +
          '</span>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--tmu);"><re-icon icon="user" size="12"></re-icon> Submitted by: <b style="color:var(--td);">' + escapeHtml(submitter) + '</b></div>' +
      '</div>';

    comment = promptFn
      ? await promptFn({
          title: 'Reject Timetable Schedule',
          type: 'danger',
          icon: 'x-circle',
          html: promptHtml,
          inputLabel: 'Rejection Reason / Revision Notes:',
          placeholder: 'Specify what conflicts or adjustments are needed (e.g. Period clashing, lab reallocation)...',
          multiline: true,
          confirmText: 'Reject Schedule',
          cancelText: 'Cancel'
        })
      : await prompt('Please enter the reason for rejecting this timetable schedule (optional):');
    if (comment === null) return;
  } else {
    var confFn = window.showConfirm || (typeof showConfirm === 'function' ? showConfirm : null);
    var confirmHtml = '<div style="margin-bottom:14px;font-size:13.5px;color:var(--td);line-height:1.5;">' +
      'Are you sure you want to approve this timetable schedule for department publication?' +
      '</div>' +
      '<div style="background:var(--bg2,#f8fafc);border:1px solid var(--br);border-radius:12px;padding:12px 14px;margin-bottom:14px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;flex-wrap:wrap;">' +
          '<span style="font-weight:700;font-size:14px;color:var(--td);display:inline-flex;align-items:center;gap:6px;">' +
            '<re-icon icon="chalkboard" size="15" style="color:#16a34a;"></re-icon> ' + escapeHtml(className) +
          '</span>' +
          '<span class="badge" style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;font-size:11px;padding:2px 8px;border-radius:6px;font-weight:700;display:inline-flex;align-items:center;gap:4px;">' +
            '<re-icon icon="git-branch" size="11"></re-icon> ' + escapeHtml(versionName) +
          '</span>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--tmu);display:flex;align-items:center;gap:6px;">' +
          '<re-icon icon="user" size="12"></re-icon> Submitted by: <b style="color:var(--td);">' + escapeHtml(submitter) + '</b>' +
        '</div>' +
        (notes ? (
          '<div style="font-size:12px;color:var(--td);background:#fff;border:1px solid var(--br);border-radius:8px;padding:8px 10px;margin-top:8px;display:flex;align-items:flex-start;gap:6px;">' +
            '<re-icon icon="message-square" size="12" style="color:#2563eb;margin-top:2px;flex-shrink:0;"></re-icon>' +
            '<span style="font-style:italic;color:var(--td);">"' + escapeHtml(notes) + '"</span>' +
          '</div>'
        ) : '') +
      '</div>' +
      '<div style="font-size:11.5px;color:var(--tmu);line-height:1.45;display:flex;align-items:center;gap:6px;">' +
        '<re-icon icon="info" size="13" style="color:#16a34a;flex-shrink:0;"></re-icon>' +
        '<span>Approving verifies this schedule. Coordinators can then publish it live to production for student and faculty portals.</span>' +
      '</div>';

    var confirmed = confFn
      ? await confFn({
          title: 'Approve Timetable Schedule',
          type: 'success',
          icon: 'check',
          confirmText: 'Approve Schedule',
          cancelText: 'Cancel',
          html: confirmHtml
        })
      : await confirm('Approve this timetable schedule for department publication?');
    if (!confirmed) return;
  }

  try {
    showToast('Processing timetable ' + action + '…', 'info');
    var token = getToken();
    var res = await fetch('/api/timetable/verification-requests/' + id + '/review', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, comment: comment || '' })
    }).then(function (r) { return r.json(); });

    if (res && res.error) throw new Error(res.error);

    showToast(res && res.message ? res.message : ('Timetable ' + (action === 'approve' ? 'approved' : 'rejected') + ' successfully!'), 'success');
    closeCtrlMatrixModal();
    await loadCtrlTimetableVerificationPage();
    if (typeof loadInboxData === 'function') loadInboxData();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

function closeCtrlMatrixModal() {
  var modal = document.getElementById('ctrl-ver-matrix-modal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(function() { modal.remove(); }, 150);
  }
}

async function openCtrlTimetableMatrixModal(id) {
  showToast('Loading timetable matrix & diff…', 'info');
  try {
    var token = getToken();
    var res = await fetch('/api/timetable/verification-requests/' + id + '/details', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (r) { return r.json(); });

    var data = (res && res.data) ? res.data : res;
    if (!data || !data.request) throw new Error('Schedule details not found');

    var req = data.request;
    var submittedSlots = data.submittedSlots || [];
    var diff = data.diff || { added: [], removed: [], modified: [], unchangedCount: 0 };
    var stats = data.stats || { totalSlots: submittedSlots.length, addedCount: 0, modifiedCount: 0, removedCount: 0, unchangedCount: 0 };
    var status = req.verificationStatus || req.status || 'pending';
    var isPending = status === 'pending';
    var isApproved = status === 'approved';

    var reqDate = (req.verificationRequest && req.verificationRequest.requestedAt) || req.createdAt;
    var dateStr = reqDate ? new Date(reqDate).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    var submitter = (req.verificationRequest && req.verificationRequest.requestedBy) || req.savedBy || 'Coordinator';

    var slotMap = new Map();
    submittedSlots.forEach(function(s) {
      var pNum = typeof s.period === 'number' ? s.period : (parseInt(String(s.period || '1').replace(/\D/g, ''), 10) || 1);
      slotMap.set(s.day + '_' + pNum, s);
    });

    var addedKeys = new Set((diff.added || []).map(function(s) {
      var pNum = typeof s.period === 'number' ? s.period : (parseInt(String(s.period || '1').replace(/\D/g, ''), 10) || 1);
      return s.day + '_' + pNum;
    }));
    var modifiedKeys = new Set((diff.modified || []).map(function(m) { return m.day + '_' + m.period; }));

    var days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var maxPeriod = Math.max.apply(null, [8].concat(submittedSlots.map(function(s) {
      return typeof s.period === 'number' ? s.period : (parseInt(String(s.period || '1').replace(/\D/g, ''), 10) || 1);
    })));
    var periods = [];
    for (var i = 1; i <= maxPeriod; i++) periods.push(i);

    closeCtrlMatrixModal();

    var backdrop = document.createElement('div');
    backdrop.className = 'modal-bg open';
    backdrop.id = 'ctrl-ver-matrix-modal';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:99999;backdrop-filter:blur(3px);padding:16px;';

    backdrop.innerHTML = '<div class="card" style="max-width:960px;width:95vw;max-height:92vh;display:flex;flex-direction:column;padding:0;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,0.3);">'
      + '<div style="padding:16px 20px;border-bottom:1px solid var(--br);display:flex;justify-content:space-between;align-items:flex-start;background:var(--bg2,#f8faf8);">'
      + '<div>'
      + '<div style="font-size:11px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:0.5px;">HOD Verification &amp; Audit Matrix</div>'
      + '<h2 style="margin:2px 0 0 0;font-size:18px;font-weight:800;color:var(--td);display:flex;align-items:center;gap:8px;">'
      + '<re-icon icon="grid"></re-icon> ' + escapeHtml(req.className || 'Class Schedule') + ' · ' + escapeHtml(req.versionName || ('v' + req.version))
      + '</h2>'
      + '<div style="font-size:12px;color:var(--tmu);margin-top:4px;">'
      + 'Submitted by <b>' + escapeHtml(submitter) + '</b> on ' + dateStr + ' · '
      + (isPending ? '<span class="badge" style="background:#fef3c7;color:#b45309;padding:2px 8px;">Pending Review</span>' : '')
      + (isApproved ? '<span class="badge" style="background:#dcfce7;color:#15803d;padding:2px 8px;">Approved by HoD</span>' : '')
      + (status === 'published' ? '<span class="badge" style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;">Live in Production</span>' : '')
      + (status === 'rejected' ? '<span class="badge" style="background:#fee2e2;color:#b91c1c;padding:2px 8px;">Rejected by HoD</span>' : '')
      + '</div>'
      + '</div>'
      + '<button type="button" class="btn btn-sm btn-sec" onclick="closeCtrlMatrixModal()" style="font-size:16px;padding:4px 8px;line-height:1;">✕</button>'
      + '</div>'

      + '<div class="ver-matrix-tabs">'
      + '<button type="button" class="ver-matrix-tab act" id="ctrl-tab-btn-matrix">'
      + '<re-icon icon="grid"></re-icon> Timetable Matrix (' + submittedSlots.length + ' Slots)'
      + '</button>'
      + '<button type="button" class="ver-matrix-tab" id="ctrl-tab-btn-diff">'
      + '<re-icon icon="refresh"></re-icon> What Changed (' + (stats.addedCount + stats.modifiedCount + stats.removedCount) + ' Changes)'
      + '</button>'
      + '</div>'

      + '<div style="padding:16px 20px;overflow-y:auto;flex:1;">'
      + '<!-- TAB 1: MATRIX VIEW -->'
      + '<div id="ctrl-matrix-tab-view" style="display:block;">'
      + '<div style="overflow-x:auto;">'
      + '<table style="width:100%;border-collapse:collapse;min-width:700px;font-size:11.5px;text-align:center;">'
      + '<thead>'
      + '<tr style="background:#f0fdf4;border-bottom:2px solid var(--br);">'
      + '<th style="padding:8px;border:1px solid var(--br);width:100px;text-align:left;font-weight:700;color:var(--td);">Day / Period</th>'
      + periods.map(function(p) { return '<th style="padding:8px 4px;border:1px solid var(--br);font-weight:700;color:var(--td);min-width:90px;">Period ' + p + '</th>'; }).join('')
      + '</tr>'
      + '</thead>'
      + '<tbody>'
      + days.map(function(d) {
          return '<tr>'
            + '<td style="padding:8px 10px;border:1px solid var(--br);font-weight:700;text-align:left;background:var(--bg2,#f8faf8);color:var(--td);">' + d + '</td>'
            + periods.map(function(p) {
                var key = d + '_' + p;
                var slot = slotMap.get(key);
                if (!slot) return '<td style="padding:6px;border:1px solid var(--br);color:var(--tmu);background:#ffffff;">—</td>';
                var isAdded = addedKeys.has(key);
                var isMod = modifiedKeys.has(key);
                var bg = isAdded ? '#f0fdf4' : (isMod ? '#fffbeb' : '#ffffff');
                var border = isAdded ? '#86efac' : (isMod ? '#fde68a' : 'var(--br)');

                return '<td style="padding:6px;border:1px solid ' + border + ';background:' + bg + ';text-align:left;vertical-align:top;">'
                  + '<div style="font-weight:700;color:var(--td);font-size:11.5px;line-height:1.2;">' + escapeHtml(slot.subject || '—') + '</div>'
                  + '<div style="font-size:10.5px;color:var(--tmu);margin-top:2px;">' + escapeHtml(slot.teacher || '—') + '</div>'
                  + '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;font-size:10px;">'
                  + '<span style="color:var(--tmu);font-weight:600;">' + escapeHtml(slot.room || '') + '</span>'
                  + (slot.isLab ? '<span class="badge" style="font-size:9px;padding:1px 4px;background:#fef3c7;color:#b45309;">Lab</span>' : '')
                  + '</div>'
                  + (isAdded ? '<div style="font-size:9px;color:#16a34a;font-weight:700;margin-top:2px;">+ Added</div>' : '')
                  + (isMod ? '<div style="font-size:9px;color:#d97706;font-weight:700;margin-top:2px;">~ Modified</div>' : '')
                  + '</td>';
              }).join('')
            + '</tr>';
        }).join('')
      + '</tbody></table>'
      + '</div>'
      + '</div>'

      + '<!-- TAB 2: WHAT CHANGED VIEW -->'
      + '<div id="ctrl-diff-tab-view" style="display:none;">'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;margin-bottom:16px;">'
      + '<div style="padding:10px;border-radius:8px;background:var(--bg2,#f8faf8);border:1px solid var(--br);text-align:center;"><div style="font-size:20px;font-weight:700;color:var(--td);">' + stats.totalSlots + '</div><div style="font-size:11px;color:var(--tmu);font-weight:600;">Total Slots</div></div>'
      + '<div style="padding:10px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0;text-align:center;"><div style="font-size:20px;font-weight:700;color:#16a34a;">+' + stats.addedCount + '</div><div style="font-size:11px;color:#166534;font-weight:600;">Added</div></div>'
      + '<div style="padding:10px;border-radius:8px;background:#fffbeb;border:1px solid #fde68a;text-align:center;"><div style="font-size:20px;font-weight:700;color:#d97706;">~' + stats.modifiedCount + '</div><div style="font-size:11px;color:#92400e;font-weight:600;">Modified</div></div>'
      + '<div style="padding:10px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;text-align:center;"><div style="font-size:20px;font-weight:700;color:#dc2626;">−' + stats.removedCount + '</div><div style="font-size:11px;color:#991b1b;font-weight:600;">Removed</div></div>'
      + '<div style="padding:10px;border-radius:8px;background:var(--bg2,#f8faf8);border:1px solid var(--br);text-align:center;"><div style="font-size:20px;font-weight:700;color:var(--td);">' + stats.unchangedCount + '</div><div style="font-size:11px;color:var(--tmu);font-weight:600;">Unchanged</div></div>'
      + '</div>'

      + '<div style="margin-bottom:16px;padding:12px 14px;border-radius:8px;background:#f0fdf4;border:1px solid var(--br);">'
      + '<div style="font-size:12px;font-weight:700;color:var(--td);margin-bottom:4px;">Submission Notes from Submitter:</div>'
      + '<div style="font-size:12.5px;color:var(--td);">' + escapeHtml((req.verificationRequest && req.verificationRequest.notes) || req.changeSummary || 'No notes provided.') + '</div>'
      + ((req.verificationRequest && req.verificationRequest.comment) ? '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--br);font-size:12px;color:#166534;"><b>HoD Remark:</b> ' + escapeHtml(req.verificationRequest.comment) + ' (' + escapeHtml(req.verificationRequest.approvedBy || 'HoD') + ')</div>' : '')
      + '</div>'

      + '<div>'
      + '<div style="font-size:12.5px;font-weight:700;color:var(--td);margin-bottom:8px;">Detailed Difference Breakdown</div>'
      + ((diff.added.length || diff.modified.length || diff.removed.length) ? '<div style="display:flex;flex-direction:column;gap:8px;">'
        + diff.modified.map(function(m) {
            return '<div style="padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;display:flex;align-items:flex-start;gap:8px;">'
              + '<span style="color:#d97706;font-size:14px;margin-top:1px;"><re-icon icon="refresh"></re-icon></span>'
              + '<div><b>' + m.day + ' Period ' + m.period + ':</b> Changed from <span style="text-decoration:line-through;color:var(--tmu);">' + escapeHtml((m.previous && m.previous.subject) || 'Empty') + ' (' + escapeHtml((m.previous && m.previous.teacher) || '—') + ', ' + escapeHtml((m.previous && m.previous.room) || '—') + ')</span> <re-icon icon="arrow-right"></re-icon> <b style="color:var(--td);">' + escapeHtml((m.current && m.current.subject) || 'Empty') + ' (' + escapeHtml((m.current && m.current.teacher) || '—') + ', ' + escapeHtml((m.current && m.current.room) || '—') + ')</b></div>'
              + '</div>';
          }).join('')
        + diff.added.map(function(a) {
            return '<div style="padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12px;display:flex;align-items:flex-start;gap:8px;">'
              + '<span style="color:#16a34a;font-size:14px;margin-top:1px;"><re-icon icon="check"></re-icon></span>'
              + '<div><b>' + a.day + ' Period ' + a.period + ':</b> <b style="color:#166534;">+ Added</b> ' + escapeHtml(a.subject || '—') + ' (' + escapeHtml(a.teacher || '—') + ', Room: ' + escapeHtml(a.room || '—') + ')</div>'
              + '</div>';
          }).join('')
        + diff.removed.map(function(r) {
            return '<div style="padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:12px;display:flex;align-items:flex-start;gap:8px;">'
              + '<span style="color:#dc2626;font-size:14px;margin-top:1px;"><re-icon icon="trash2"></re-icon></span>'
              + '<div><b>' + r.day + ' Period ' + r.period + ':</b> <b style="color:#991b1b;">− Removed</b> ' + escapeHtml(r.subject || '—') + ' (' + escapeHtml(r.teacher || '—') + ')</div>'
              + '</div>';
          }).join('')
        + '</div>' : '<div style="padding:20px;text-align:center;color:var(--tmu);font-size:12.5px;background:var(--bg2,#f8faf8);border-radius:8px;">No differences detected compared to active production schedule.</div>')
      + '</div>'
      + '</div>'
      + '</div>'

      + '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:12px 20px;border-top:1px solid var(--br);background:var(--bg2,#f8faf8);">'
      + (isPending ? '<button type="button" class="btn btn-sm btn-danger" style="padding:8px 16px;font-weight:600;" onclick="ctrlReviewTimetable(\'' + id + '\', \'reject\')"><re-icon icon="x"></re-icon> Reject</button>'
      + '<button type="button" class="btn btn-sm btn-pri" style="background:#16a34a;padding:8px 20px;font-weight:700;" onclick="ctrlReviewTimetable(\'' + id + '\', \'approve\')"><re-icon icon="check"></re-icon> Approve Timetable</button>' : '')
      + '<button type="button" class="btn btn-sm btn-sec" onclick="closeCtrlMatrixModal()">Close</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(backdrop);

    var tabMatrix = document.getElementById('ctrl-tab-btn-matrix');
    var tabDiff = document.getElementById('ctrl-tab-btn-diff');
    var viewMatrix = document.getElementById('ctrl-matrix-tab-view');
    var viewDiff = document.getElementById('ctrl-diff-tab-view');

    if (tabMatrix && tabDiff && viewMatrix && viewDiff) {
      tabMatrix.onclick = function() {
        tabMatrix.classList.add('act');
        tabDiff.classList.remove('act');
        viewMatrix.style.display = 'block';
        viewDiff.style.display = 'none';
      };
      tabDiff.onclick = function() {
        tabDiff.classList.add('act');
        tabMatrix.classList.remove('act');
        viewMatrix.style.display = 'none';
        viewDiff.style.display = 'block';
      };
    }
  } catch (err) {
    showToast('Failed to open matrix modal: ' + err.message, 'error');
  }
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

// ── 13. APPROVALS INBOX (HOD & EXECUTIVE QUEUE) ─────────────────
var _inboxItems = [];
var _inboxFilter = 'all';

function loadInboxData() {
  var container = document.getElementById('inbox-items-container');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tmu);"><div class="spin" style="margin:0 auto 10px;"></div>Loading approvals queue…</div>';

  var token = getToken();

  Promise.allSettled([
    fetch('/api/controller/inbox?_t=' + Date.now(), {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (r) { return r.json(); }),
    fetch('/api/access-requests?status=pending_hod&_t=' + Date.now(), {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (r) { return r.json(); }),
    fetch('/api/timetable/verification-requests?status=pending&_t=' + Date.now(), {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (r) { return r.json(); })
  ])
  .then(function (results) {
    var ctrlData = results[0].status === 'fulfilled' ? results[0].value : [];
    var accessData = results[1].status === 'fulfilled' ? results[1].value : {};
    var ttData = results[2].status === 'fulfilled' ? results[2].value : [];

    var ctrlItems = Array.isArray(ctrlData) ? ctrlData : (ctrlData.items || []);
    var accessItems = (accessData.requests || []).map(function (r) {
      return {
        type: 'role_access',
        id: r.requestId,
        title: 'Sub-Admin Role Delegation: ' + (r.forTeacherName || 'Faculty Member'),
        subtitle: 'Requested by ' + (r.requestedBy?.name || 'Administrator') + ' • Dept: ' + (r.deptName || 'Department'),
        badge: 'Role Access',
        badgeClass: 'warning',
        createdAt: r.createdAt,
        requester: r.forTeacherName,
        department: r.deptName || '',
        desc: 'Modules: ' + (r.grants || []).map(function (g) { return g.page + ' (' + (g.actions || []).join(', ') + ')'; }).join(', ') +
              (r.reason ? ' • Reason: ' + r.reason : '')
      };
    });

    var ttRaw = Array.isArray(ttData) ? ttData : ((ttData && ttData.data) ? ttData.data : []);
    var ttItems = ttRaw.map(function (tt) {
      var vName = tt.versionName || ('v' + tt.version);
      var submitter = (tt.verificationRequest && tt.verificationRequest.requestedBy) || tt.savedBy || 'Coordinator';
      var notes = (tt.verificationRequest && tt.verificationRequest.notes) || tt.changeSummary || 'Draft ready for departmental verification';
      return {
        id: String(tt._id),
        type: 'timetable_verification',
        title: 'Timetable Verification: ' + (tt.className || 'Class') + ' (' + vName + ')',
        subtitle: 'Submitted by ' + submitter + ' · ' + notes,
        badge: 'Timetable Verification',
        badgeClass: 'warning',
        createdAt: (tt.verificationRequest && tt.verificationRequest.requestedAt) || tt.createdAt,
        requester: submitter,
        department: tt.className || '',
        context: {
          className: tt.className || 'General',
          versionName: vName,
          submitter: submitter,
          notes: notes
        },
        actions: ['view_matrix', 'approve', 'reject']
      };
    });

    // Merge and deduplicate by id
    var seenIds = new Set();
    _inboxItems = [];
    ctrlItems.concat(accessItems).concat(ttItems).forEach(function (item) {
      if (!item) return;
      var idStr = String(item.id || item._id);
      if (!seenIds.has(idStr)) {
        seenIds.add(idStr);
        _inboxItems.push(item);
      }
    });

    _inboxItems.sort(function (a, b) {
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });

    // Count categories
    var counts = {
      all: _inboxItems.length,
      faculty_leave: 0,
      student_od: 0,
      attendance_unlock: 0,
      unresolved_substitution: 0,
      evidence_overdue: 0,
      role_access: 0,
      timetable_verification: 0
    };

    _inboxItems.forEach(function (i) {
      if (counts[i.type] != null) counts[i.type]++;
    });

    Object.keys(counts).forEach(function (k) {
      var el = document.getElementById('inbox-count-' + k);
      if (el) el.textContent = counts[k];
    });

    var sbBadge = document.getElementById('sb-inbox-badge');
    if (sbBadge) {
      sbBadge.textContent = counts.all;
      sbBadge.style.display = counts.all > 0 ? 'inline-block' : 'none';
    }

    if (typeof updateCtrlTtVerificationBadge === 'function') {
      updateCtrlTtVerificationBadge(counts.timetable_verification);
    }

    renderInboxItems();
  })
  .catch(function (err) {
    console.error('[loadInboxData err]:', err);
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tmu);">Failed to load inbox items: ' + escapeHtml(err.message) + '</div>';
  });
}

function filterInbox(type, btn) {
  _inboxFilter = type || 'all';
  document.querySelectorAll('#inbox-filter-chips .filter-chip').forEach(function (c) {
    c.classList.remove('act');
  });
  if (btn) btn.classList.add('act');
  renderInboxItems();
}

function renderInboxItems() {
  var container = document.getElementById('inbox-items-container');
  if (!container) return;

  var items = _inboxItems;
  if (_inboxFilter !== 'all') {
    items = items.filter(function (i) { return i.type === _inboxFilter; });
  }

  if (items.length === 0) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:44px 20px;color:var(--tmu);font-size:13px;border-radius:14px;">' +
      '<div style="font-size:28px;margin-bottom:8px;"><re-icon icon="inbox" size="32"></re-icon></div>' +
      '<div style="font-weight:700;font-size:14px;color:var(--td);margin-bottom:4px;">No Pending Items</div>' +
      '<div>There are currently no pending approval items in this queue.</div>' +
      '</div>';
    return;
  }

  container.innerHTML = items.map(function (item) {
    var id = item.id || item._id;
    var badgeCol = item.type === 'faculty_leave' ? '#dc2626' : item.type === 'student_od' ? '#2563eb' : item.type === 'attendance_unlock' ? '#d97706' : item.type === 'evidence_overdue' ? '#dc2626' : item.type === 'role_access' ? '#7c3aed' : item.type === 'timetable_verification' ? '#b45309' : '#475569';
    var badgeBg = item.type === 'faculty_leave' ? '#fef2f2' : item.type === 'student_od' ? '#eff6ff' : item.type === 'attendance_unlock' ? '#fffbeb' : item.type === 'evidence_overdue' ? '#fef2f2' : item.type === 'role_access' ? '#f5f3ff' : item.type === 'timetable_verification' ? '#fef3c7' : '#f1f5f9';
    var typeIcon = item.type === 'faculty_leave' ? 'user-x' : item.type === 'student_od' ? 'award' : item.type === 'attendance_unlock' ? 'lock-open' : item.type === 'evidence_overdue' ? 'alert-triangle' : item.type === 'role_access' ? 'shield' : item.type === 'timetable_verification' ? 'calendar-days' : 'inbox';

    var dateStr = item.createdAt ? new Date(item.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

    var actionsHtml = '';
    if (item.type === 'role_access') {
      actionsHtml = '<button type="button" class="btn btn-sm btn-pri" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;padding:6px 13px;border-radius:8px;" onclick="hodApproveInboxSubAdmin(\'' + id + '\')"><re-icon icon="check" size="12"></re-icon> Endorse &amp; Forward</button> ' +
        '<button type="button" class="btn btn-sm btn-sec" style="display:inline-flex;align-items:center;gap:5px;color:#ef4444;font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px;border:1px solid #fca5a5;" onclick="hodDenyInboxSubAdmin(\'' + id + '\')"><re-icon icon="x" size="12"></re-icon> Reject</button>';
    } else if (item.type === 'faculty_leave') {
      actionsHtml = '<button type="button" class="btn btn-sm btn-sec" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px;" onclick="openFacultyLeaveReviewModal(\'' + id + '\')"><re-icon icon="search" size="12"></re-icon> Review</button> ' +
        '<button type="button" class="btn btn-sm btn-pri" style="display:inline-flex;align-items:center;gap:5px;background:#16a34a;font-weight:700;font-size:12px;padding:6px 14px;border-radius:8px;" onclick="quickPermitFacultyLeave(\'' + id + '\')"><re-icon icon="check" size="12"></re-icon> Permit</button> ' +
        '<button type="button" class="btn btn-sm btn-danger" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px;" onclick="quickRejectFacultyLeave(\'' + id + '\')"><re-icon icon="x" size="12"></re-icon> Reject</button>';
    } else if (item.type === 'student_od') {
      actionsHtml = '<button type="button" class="btn btn-sm btn-sec" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px;" onclick="openODDetailModal(\'' + id + '\')"><re-icon icon="search" size="12"></re-icon> View</button> ' +
        '<button type="button" class="btn btn-sm btn-pri" style="display:inline-flex;align-items:center;gap:5px;background:#16a34a;font-weight:700;font-size:12px;padding:6px 14px;border-radius:8px;" onclick="approveOD(\'' + id + '\')"><re-icon icon="check" size="12"></re-icon> Approve</button> ' +
        '<button type="button" class="btn btn-sm btn-danger" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px;" onclick="rejectOD(\'' + id + '\')"><re-icon icon="x" size="12"></re-icon> Reject</button>';
    } else if (item.type === 'attendance_unlock') {
      actionsHtml = '<button type="button" class="btn btn-sm btn-pri" style="display:inline-flex;align-items:center;gap:5px;background:#16a34a;font-weight:700;font-size:12px;padding:6px 14px;border-radius:8px;" onclick="approveUnlockRequest(\'' + id + '\')"><re-icon icon="check" size="12"></re-icon> Unlock</button> ' +
        '<button type="button" class="btn btn-sm btn-sec" style="display:inline-flex;align-items:center;gap:5px;color:#ef4444;font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px;border:1px solid #fca5a5;" onclick="rejectUnlockRequest(\'' + id + '\')"><re-icon icon="x" size="12"></re-icon> Reject</button>';
    } else if (item.type === 'unresolved_substitution') {
      actionsHtml = '<button type="button" class="btn btn-sm btn-pri" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;padding:6px 13px;border-radius:8px;" onclick="openDirectAssignSubModal(\'' + id + '\')"><re-icon icon="refresh" size="12"></re-icon> Assign Sub</button>';
    } else if (item.type === 'evidence_overdue') {
      actionsHtml = '<button type="button" class="btn btn-sm btn-danger" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;" onclick="openRejectODModal(\'' + id + '\')"><re-icon icon="alert-triangle" size="12"></re-icon> Revoke OD</button> ' +
        '<button type="button" class="btn btn-sm btn-sec" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px;" onclick="openODDetailModal(\'' + id + '\')">View</button>';
    } else if (item.type === 'timetable_verification') {
      actionsHtml = '<button type="button" class="btn btn-sm btn-sec" onclick="openCtrlTimetableMatrixModal(\'' + id + '\')" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:6px 13px;border-radius:8px;border:1px solid var(--br);background:#fff;color:var(--td);transition:all .15s;"><re-icon icon="grid" size="13"></re-icon> View Matrix</button> ' +
        '<button type="button" class="btn btn-sm btn-pri" style="display:inline-flex;align-items:center;gap:6px;background:#16a34a;color:#fff;font-weight:700;font-size:12px;padding:6px 15px;border-radius:8px;border:none;box-shadow:0 2px 6px rgba(22,163,74,0.25);transition:all .15s;" onclick="ctrlReviewTimetable(\'' + id + '\', \'approve\')"><re-icon icon="check" size="13"></re-icon> Approve</button> ' +
        '<button type="button" class="btn btn-sm btn-danger" style="display:inline-flex;align-items:center;gap:6px;background:#dc2626;color:#fff;font-weight:600;font-size:12px;padding:6px 13px;border-radius:8px;border:none;box-shadow:0 2px 6px rgba(220,38,38,0.2);transition:all .15s;" onclick="ctrlReviewTimetable(\'' + id + '\', \'reject\')"><re-icon icon="x" size="13"></re-icon> Reject</button>';
    }

    // Format rich metadata context
    var detailsHtml = '';
    if (item.type === 'timetable_verification') {
      var cName = (item.context && (item.context.className || item.context.class)) || item.department || '';
      var vName = (item.context && (item.context.versionName || item.context.version)) || '';
      var notes = (item.context && item.context.notes) || '';
      var submitter = (item.context && item.context.submitter) || item.requester || '';

      var chips = [];
      if (cName) {
        chips.push('<span class="badge" style="background:var(--bg2,#f8fafc);color:var(--td);border:1px solid var(--br);font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;"><re-icon icon="chalkboard" size="12" style="color:#b45309;"></re-icon> Class: <b style="color:var(--td);">' + escapeHtml(cName) + '</b></span>');
      }
      if (vName) {
        chips.push('<span class="badge" style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;"><re-icon icon="git-branch" size="12" style="color:#2563eb;"></re-icon> Version: <b style="color:#1e40af;">' + escapeHtml(vName) + '</b></span>');
      }
      if (submitter) {
        chips.push('<span class="badge" style="background:#f1f5f9;color:#475569;border:1px solid var(--br);font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;"><re-icon icon="user" size="12"></re-icon> <span style="color:var(--td);">' + escapeHtml(submitter) + '</span></span>');
      }

      detailsHtml = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px;">' + chips.join('') + '</div>';

      if (notes) {
        detailsHtml += '<div style="margin-top:7px;padding:6px 12px;background:rgba(245,158,11,0.06);border-left:3px solid #f59e0b;border-radius:0 6px 6px 0;font-size:12px;color:var(--td);display:flex;align-items:flex-start;gap:6px;">' +
          '<re-icon icon="message-square" size="12" style="color:#b45309;margin-top:2px;flex-shrink:0;"></re-icon>' +
          '<span><b>Coordinator Note:</b> ' + escapeHtml(notes) + '</span>' +
        '</div>';
      }
    } else if (item.type === 'faculty_leave') {
      var ctx = item.context || {};
      var chips = [];
      if (ctx.daysCount) {
        chips.push('<span class="badge" style="background:var(--bg2,#f8fafc);color:var(--td);border:1px solid var(--br);font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;"><re-icon icon="calendar" size="12"></re-icon> ' + escapeHtml(String(ctx.daysCount)) + ' Day(s)</span>');
      }
      if (ctx.unresolvedCount > 0) {
        chips.push('<span class="badge" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;"><re-icon icon="alert-triangle" size="12"></re-icon> ' + ctx.unresolvedCount + ' Unresolved Sub</span>');
      }
      if (ctx.substitutionsCount) {
        chips.push('<span class="badge" style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;"><re-icon icon="user-check" size="12"></re-icon> ' + ctx.substitutionsCount + ' Sub(s)</span>');
      }
      detailsHtml = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px;">' + chips.join('') + '</div>';
      if (ctx.reason) {
        detailsHtml += '<div style="margin-top:7px;padding:6px 12px;background:rgba(220,38,38,0.05);border-left:3px solid #dc2626;border-radius:0 6px 6px 0;font-size:12px;color:var(--td);display:flex;align-items:flex-start;gap:6px;">' +
          '<re-icon icon="message-square" size="12" style="color:#dc2626;margin-top:2px;flex-shrink:0;"></re-icon>' +
          '<span><b>Reason:</b> ' + escapeHtml(ctx.reason) + '</span>' +
        '</div>';
      }
    } else if (item.type === 'student_od') {
      var ctx = item.context || {};
      var chips = [];
      if (ctx.eventName) {
        chips.push('<span class="badge" style="background:var(--bg2,#f8fafc);color:var(--td);border:1px solid var(--br);font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;"><re-icon icon="award" size="12" style="color:#2563eb;"></re-icon> ' + escapeHtml(ctx.eventName) + '</span>');
      }
      if (ctx.daysCount) {
        chips.push('<span class="badge" style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;"><re-icon icon="calendar" size="12"></re-icon> ' + ctx.daysCount + ' Day(s)</span>');
      }
      if (ctx.score != null) {
        chips.push('<span class="badge" style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;"><re-icon icon="shield-check" size="12"></re-icon> Score: ' + ctx.score + '/100</span>');
      }
      detailsHtml = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px;">' + chips.join('') + '</div>';
    } else if (item.type === 'attendance_unlock') {
      var ctx = item.context || {};
      var chips = [];
      if (item.department) {
        chips.push('<span class="badge" style="background:var(--bg2,#f8fafc);color:var(--td);border:1px solid var(--br);font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;"><re-icon icon="chalkboard" size="12"></re-icon> ' + escapeHtml(item.department) + '</span>');
      }
      if (ctx.periodNumber) {
        chips.push('<span class="badge" style="background:#fffbeb;color:#b45309;border:1px solid #fde68a;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;"><re-icon icon="clock" size="12"></re-icon> Period ' + escapeHtml(String(ctx.periodNumber)) + '</span>');
      }
      if (ctx.date) {
        chips.push('<span class="badge" style="background:#f1f5f9;color:#475569;border:1px solid var(--br);font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;"><re-icon icon="calendar" size="12"></re-icon> ' + escapeHtml(ctx.date) + '</span>');
      }
      detailsHtml = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px;">' + chips.join('') + '</div>';
    } else if (item.desc) {
      detailsHtml = '<div style="font-size:12px;color:var(--td);margin-top:6px;">' + escapeHtml(item.desc) + '</div>';
    } else if (item.context && typeof item.context === 'object') {
      var validEntries = Object.entries(item.context).filter(function (e) {
        var k = e[0].toLowerCase();
        return !k.endsWith('id') && k !== '_id' && k !== 'type' && e[1] != null && String(e[1]).trim() !== '';
      });
      if (validEntries.length > 0) {
        detailsHtml = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px;">' +
          validEntries.map(function (e) {
            var label = e[0].replace(/([A-Z])/g, ' $1').replace(/^./, function (s) { return s.toUpperCase(); });
            return '<span class="badge" style="background:var(--bg2,#f8fafc);color:var(--td);border:1px solid var(--br);font-size:11.5px;font-weight:600;padding:3px 8px;border-radius:6px;">' + escapeHtml(label) + ': <b>' + escapeHtml(String(e[1])) + '</b></span>';
          }).join('') +
        '</div>';
      }
    }

    return '<div class="card inbox-item-card" style="padding:16px 20px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;border-radius:14px;border:1px solid var(--br);border-left:4px solid ' + badgeCol + ';box-shadow:0 2px 8px rgba(0,0,0,0.03);transition:all .2s ease;">' +
      '<div style="flex:1;min-width:280px;">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap;">' +
          '<span class="badge" style="background:' + badgeBg + ';color:' + badgeCol + ';font-weight:700;padding:3px 9px;border-radius:6px;font-size:11px;display:inline-flex;align-items:center;gap:5px;letter-spacing:0.3px;">' +
            '<re-icon icon="' + typeIcon + '" size="12"></re-icon> ' + escapeHtml(item.badge || item.type) +
          '</span>' +
          '<div style="font-size:14.5px;font-weight:700;color:var(--td);">' + escapeHtml(item.title) + '</div>' +
          (dateStr ? ('<span style="font-size:11.5px;color:var(--tmu);margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-family:monospace;"><re-icon icon="clock" size="11"></re-icon>' + dateStr + '</span>') : '') +
        '</div>' +
        '<div style="font-size:12.5px;color:var(--tmu);margin-bottom:4px;">' + escapeHtml(item.subtitle) + '</div>' +
        detailsHtml +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex-shrink:0;">' +
        actionsHtml +
      '</div>' +
    '</div>';
  }).join('');
}

function approveUnlockRequest(id) {
  var token = getToken();
  fetch('/api/controller/unlock-requests/' + id + '/approve', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast('Attendance lock request approved!', 'success');
    loadInboxData();
  })
  .catch(function (err) {
    showToast('Failed to approve unlock: ' + err.message, 'error');
  });
}

async function rejectUnlockRequest(id) {
  var note = await showPrompt('Enter reason for rejecting unlock request:', '', 'Reject Unlock');
  if (!note || !note.trim()) return;

  var token = getToken();
  fetch('/api/controller/unlock-requests/' + id + '/reject', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: note.trim() })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast('Unlock request rejected', 'info');
    loadInboxData();
  })
  .catch(function (err) {
    showToast('Failed to reject unlock: ' + err.message, 'error');
  });
}

async function hodApproveInboxSubAdmin(requestId) {
  var ok = await showConfirm('Endorse sub-admin access request ' + requestId + ' and forward for Sudo Administrator confirmation?', 'HOD Endorsement');
  if (!ok) return;

  var token = getToken();
  fetch('/api/access-requests/' + requestId + '/hod-approve', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    }
  })
  .then(function (res) { return res.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast(res.message || 'Request endorsed and forwarded to Sudo Admin', 'success');
    loadInboxData();
  })
  .catch(function (err) {
    console.error('[hodApproveInboxSubAdmin err]:', err);
    showToast('Failed to endorse: ' + err.message, 'error');
  });
}

async function hodDenyInboxSubAdmin(requestId) {
  var reason = await showPrompt('Enter reason for denying access request ' + requestId + ':', '', 'HOD Denial');
  if (!reason || !reason.trim()) return;

  var token = getToken();
  fetch('/api/access-requests/' + requestId + '/hod-deny', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ reason: reason.trim() })
  })
  .then(function (res) { return res.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast(res.message || 'Request denied by HOD', 'info');
    loadInboxData();
  })
  .catch(function (err) {
    console.error('[hodDenyInboxSubAdmin err]:', err);
    showToast('Failed to deny: ' + err.message, 'error');
  });
}

// ── 14. FACULTY LEAVE & SUBSTITUTIONS ───────────────────────────
var _pendingDirectAssign = null;

function loadFacultyLeaveData() {
  var token = getToken();
  var url = '/api/leave/faculty/pending?_t=' + Date.now();
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  var tbody = document.getElementById('fl-pending-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="text-center"><div class="spin" style="margin:0 auto 10px;"></div>Loading pending leave requests…</td></tr>';

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var requests = data.requests || (Array.isArray(data) ? data : []);
      var pendingCount = requests.length;

      var kpiPending = document.getElementById('fl-kpi-pending');
      if (kpiPending) kpiPending.textContent = pendingCount;
      var tabCount = document.getElementById('fl-tab-pending-count');
      if (tabCount) tabCount.textContent = pendingCount;
      var sbBadge = document.getElementById('sb-fl-badge');
      if (sbBadge) {
        sbBadge.textContent = pendingCount;
        sbBadge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
      }

      var todaySubs = 0;
      var unresolved = 0;
      requests.forEach(function (r) {
        (r.substitutions || []).forEach(function (s) {
          if (s.date === todayIST()) todaySubs++;
          if (s.isUnresolved || s.status === 'rejected') unresolved++;
        });
      });

      var kpiSubs = document.getElementById('fl-kpi-today-subs');
      if (kpiSubs) kpiSubs.textContent = todaySubs;
      var tabTodayCount = document.getElementById('fl-tab-today-count');
      if (tabTodayCount) tabTodayCount.textContent = todaySubs;

      var kpiUnres = document.getElementById('fl-kpi-unresolved');
      if (kpiUnres) kpiUnres.textContent = unresolved;
      var tabUnresCount = document.getElementById('fl-tab-unresolved-count');
      if (tabUnresCount) tabUnresCount.textContent = unresolved;

      renderFacultyLeavePendingTable(requests);
      renderFacultyLeaveTodayTable(requests);
      renderFacultyLeaveUnresolvedTable(requests);
    })
    .catch(function (err) {
      console.error('[Faculty Leave Load Error]:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="text-center">Failed to load faculty leaves: ' + escapeHtml(err.message) + '</td></tr>';
    });
}

function renderFacultyLeavePendingTable(requests) {
  var tbody = document.getElementById('fl-pending-tbody');
  if (!tbody) return;

  if (!requests.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center">No pending faculty leave requests in queue.</td></tr>';
    return;
  }

  tbody.innerHTML = requests.map(function (r) {
    var id = r._id || r.requestId;
    var dateRange = r.fromDate === r.toDate ? r.fromDate : (r.fromDate + ' → ' + r.toDate);
    var subs = r.substitutions || [];
    var subsHtml = subs.length
      ? ('<span class="badge" style="background:#e0f2fe;color:#0369a1;">' + subs.length + ' slot(s)</span>')
      : '<span style="color:#94a3b8;">None required</span>';

    var urgency = r.isEmergency
      ? '<span class="status-tag emergency"><re-icon icon="siren"></re-icon> Emergency</span>'
      : '<span style="color:#64748b;">Regular</span>';

    var lopSplit = r.lopSplit ? (r.lopSplit.paidDays + ' Paid / ' + r.lopSplit.lopDays + ' LOP') : (r.daysCount + ' d');

    return '<tr>' +
      '<td><span class="badge" style="background:#f1f5f9;color:#334155;font-weight:700;">' + escapeHtml(r.requestId || id) + '</span></td>' +
      '<td><strong>' + escapeHtml(r.teacherName || 'Faculty') + '</strong></td>' +
      '<td>' + escapeHtml(r.deptCode || r.deptName || '—') + '</td>' +
      '<td>' + escapeHtml(r.leaveType || 'Leave') + '</td>' +
      '<td>' + escapeHtml(dateRange) + '</td>' +
      '<td><strong>' + escapeHtml(lopSplit) + '</strong></td>' +
      '<td>' + subsHtml + '</td>' +
      '<td>' + urgency + '</td>' +
      '<td>' +
        '<div style="display:flex;gap:4px;">' +
          '<button class="btn btn-sm btn-sec" onclick="openFacultyLeaveReviewModal(\'' + id + '\')"><re-icon icon="search" size="12"></re-icon> Review</button> ' +
          '<button class="btn btn-sm btn-pri" onclick="quickPermitFacultyLeave(\'' + id + '\')"><re-icon icon="check" size="12"></re-icon> Permit</button> ' +
          '<button class="btn btn-sm btn-danger" onclick="quickRejectFacultyLeave(\'' + id + '\')"><re-icon icon="x" size="12"></re-icon> Reject</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function renderFacultyLeaveTodayTable(requests) {
  var tbody = document.getElementById('fl-today-tbody');
  if (!tbody) return;

  var todayISO = todayIST();
  var todaySubs = [];
  requests.forEach(function (r) {
    (r.substitutions || []).forEach(function (s) {
      if (s.date === todayISO) {
        todaySubs.push({
          leaveId: r._id || r.requestId,
          facultyName: r.teacherName,
          slot: s
        });
      }
    });
  });

  if (!todaySubs.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">No faculty substitutions active for today.</td></tr>';
    return;
  }

  tbody.innerHTML = todaySubs.map(function (item) {
    var s = item.slot;
    return '<tr>' +
      '<td><strong>Period ' + (s.periodNumber || s.period || '—') + '</strong></td>' +
      '<td>' + escapeHtml(s.className || 'Class') + '</td>' +
      '<td>' + escapeHtml(s.subjectName || s.subjectCode || '—') + '</td>' +
      '<td>' + escapeHtml(s.room || 'TBD') + '</td>' +
      '<td>' + escapeHtml(item.facultyName || 'Faculty') + '</td>' +
      '<td><strong>' + escapeHtml(s.substituteTeacherName || 'Substitute') + '</strong></td>' +
      '<td><span class="status-tag approved">' + escapeHtml(s.status || 'Assigned') + '</span></td>' +
      '<td>' + escapeHtml(s.assignedBy || 'HOD') + '</td>' +
    '</tr>';
  }).join('');
}

function renderFacultyLeaveUnresolvedTable(requests) {
  var tbody = document.getElementById('fl-unresolved-tbody');
  if (!tbody) return;

  var unresolvedSlots = [];
  requests.forEach(function (r) {
    (r.substitutions || []).forEach(function (s) {
      if (s.isUnresolved || s.status === 'rejected') {
        unresolvedSlots.push({
          leaveId: r._id || r.requestId,
          facultyName: r.teacherName,
          slot: s
        });
      }
    });
  });

  if (!unresolvedSlots.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">No unresolved slots. All teaching coverage secured! <re-icon icon="check-circle"></re-icon></td></tr>';
    return;
  }

  tbody.innerHTML = unresolvedSlots.map(function (item) {
    var s = item.slot;
    return '<tr>' +
      '<td>' + escapeHtml(s.date || '—') + '</td>' +
      '<td><strong>Period ' + (s.periodNumber || s.period || '—') + '</strong></td>' +
      '<td>' + escapeHtml(s.className || 'Class') + (s.room ? (' (' + s.room + ')') : '') + '</td>' +
      '<td>' + escapeHtml(s.subjectName || s.subjectCode || '—') + '</td>' +
      '<td>' + escapeHtml(item.facultyName || 'Faculty') + '</td>' +
      '<td><span class="status-tag rejected"><re-icon icon="alert-triangle"></re-icon> ' + escapeHtml(s.declineReason || 'Substitute Declined') + '</span></td>' +
      '<td>' +
        '<button class="btn btn-sm btn-pri" onclick="openDirectAssignSubModal(\'' + item.leaveId + '\', \'' + (s._id || s.slotId || '') + '\', \'Period ' + (s.periodNumber || '') + ' · ' + escapeHtml(s.className || '') + '\')">' +
          '<re-icon icon="refresh" size="12"></re-icon> Assign Sub' +
        '</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function switchFacultyLeaveTab(tab) {
  var tabs = ['pending', 'today', 'unresolved', 'calendar', 'policy'];
  tabs.forEach(function (t) {
    var btn = document.getElementById('tab-fl-' + t);
    var view = document.getElementById('fl-view-' + t);
    if (btn) {
      if (t === tab) btn.classList.add('act');
      else btn.classList.remove('act');
    }
    if (view) {
      view.style.display = (t === tab ? 'block' : 'none');
    }
  });

  if (tab === 'calendar') {
    loadFacultyLeaveCalendar();
  } else if (tab === 'policy') {
    loadFacultyLeavePolicyView();
  }
}

function loadFacultyLeaveCalendar() {
  var container = document.getElementById('fl-calendar-container');
  if (!container) return;
  container.innerHTML = '<div class="card" style="padding:24px;text-align:center;color:var(--tmu);"><re-icon icon="calendar" size="24"></re-icon><div style="font-size:14px;font-weight:600;margin-top:8px;color:var(--td);">Faculty Leave Schedule</div><div style="font-size:12px;margin-top:4px;">No faculty scheduled on leave for this month outside today.</div></div>';
}

function loadFacultyLeavePolicyView() {
  var container = document.getElementById('fl-policy-container');
  if (!container) return;
  var token = getToken();
  var dept = (typeof selectedDeptFilter !== 'undefined' && selectedDeptFilter) || controllerContext?.deptCode || '';
  fetch('/api/leave/policy?deptCode=' + encodeURIComponent(dept), {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    var pol = data.policy || data || {};
    var al = pol.allowances || {};
    var cl = al.casualLeave != null ? al.casualLeave : (pol.clQuota != null ? pol.clQuota : 12);
    var ml = al.medicalLeave != null ? al.medicalLeave : (pol.mlQuota != null ? pol.mlQuota : 10);
    var el = al.earnedLeave != null ? al.earnedLeave : (pol.elQuota != null ? pol.elQuota : 15);
    var aq = pol.annualLeaveQuota != null ? pol.annualLeaveQuota : 15;
    var thresh = pol.medicalDocThresholdDays != null ? pol.medicalDocThresholdDays : 3;
    var maxConsec = pol.maxConsecutiveLeaveDays != null ? pol.maxConsecutiveLeaveDays : 3;

    container.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;">' +
      '<div class="card" style="padding:14px;"><div style="font-size:12px;color:var(--tmu);">Total Annual Quota</div><div style="font-size:22px;font-weight:700;color:var(--td);margin-top:4px;">' + aq + ' days</div></div>' +
      '<div class="card" style="padding:14px;"><div style="font-size:12px;color:var(--tmu);">Casual Leave (CL)</div><div style="font-size:22px;font-weight:700;color:var(--td);margin-top:4px;">' + cl + ' days</div></div>' +
      '<div class="card" style="padding:14px;"><div style="font-size:12px;color:var(--tmu);">Medical Leave (ML)</div><div style="font-size:22px;font-weight:700;color:var(--td);margin-top:4px;">' + ml + ' days</div></div>' +
      '<div class="card" style="padding:14px;"><div style="font-size:12px;color:var(--tmu);">Earned Leave (EL)</div><div style="font-size:22px;font-weight:700;color:var(--td);margin-top:4px;">' + el + ' days</div></div>' +
      '<div class="card" style="padding:14px;"><div style="font-size:12px;color:var(--tmu);">Max Consecutive Days</div><div style="font-size:22px;font-weight:700;color:var(--td);margin-top:4px;">' + maxConsec + ' days</div></div>' +
      '<div class="card" style="padding:14px;"><div style="font-size:12px;color:var(--tmu);">Medical Proof Threshold</div><div style="font-size:22px;font-weight:700;color:var(--td);margin-top:4px;">&gt; ' + thresh + ' days</div></div>' +
    '</div>' +
    '<div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">' +
      '<button class="btn btn-pri" onclick="nav(\'settings\')"><re-icon icon="settings" size="14"></re-icon> Configure Department Leave Policy</button>' +
      '<button class="btn btn-sec" onclick="openFacultyLeavePolicyModal()"><re-icon icon="edit" size="14"></re-icon> Quick Modal</button>' +
    '</div>';
  })
  .catch(function (err) {
    container.innerHTML = '<div style="padding:20px;color:var(--tmu);">Failed to load policy: ' + escapeHtml(err.message) + '</div>';
  });
}

function openFacultyLeaveReviewModal(id) {
  var title = document.getElementById('fl-rev-title');
  var sub = document.getElementById('fl-rev-sub');
  var body = document.getElementById('fl-rev-body');
  var actions = document.getElementById('fl-rev-actions');

  if (title) title.textContent = 'Faculty Leave Review';
  if (sub) sub.textContent = 'Request ID: ' + id;
  if (body) body.innerHTML = '<div style="text-align:center;padding:30px;"><div class="spin" style="margin:0 auto 10px;"></div>Loading details…</div>';

  var modal = document.getElementById('m-fl-review');
  if (modal) modal.style.display = 'flex';

  var token = getToken();
  fetch('/api/leave/faculty/' + id, {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    var req = data.leaveRequest || data;
    var isPrincipal = controllerContext?.role === 'principal';

    if (body) {
      var subsHtml = (req.substitutions || []).map(function (s) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;font-size:12px;">' +
          '<div><strong>Period ' + (s.periodNumber || s.period || '—') + '</strong> · ' + escapeHtml(s.className || 'Class') + ' (' + escapeHtml(s.subjectName || s.subjectCode || '') + ')</div>' +
          '<div>Sub: <strong>' + escapeHtml(s.substituteTeacherName || 'None') + '</strong> <span class="status-tag ' + (s.status === 'accepted' ? 'approved' : 'pending') + '">' + escapeHtml(s.status || 'Pending') + '</span></div>' +
        '</div>';
      }).join('');

      body.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
        '<div class="card" style="padding:12px;"><div style="font-size:11px;color:var(--tmu);">Faculty Applicant</div><div style="font-size:14px;font-weight:700;color:var(--td);margin-top:2px;">' + escapeHtml(req.teacherName || 'Faculty') + '</div><div style="font-size:12px;color:var(--tmu);">' + escapeHtml(req.deptCode || req.department || '') + '</div></div>' +
        '<div class="card" style="padding:12px;"><div style="font-size:11px;color:var(--tmu);">Leave Type &amp; Duration</div><div style="font-size:14px;font-weight:700;color:var(--td);margin-top:2px;">' + escapeHtml(req.leaveType || 'Casual') + ' · ' + (req.daysCount || 1) + ' Day(s)</div><div style="font-size:12px;color:var(--tmu);">' + escapeHtml(req.fromDate) + ' → ' + escapeHtml(req.toDate) + '</div></div>' +
      '</div>' +
      '<div class="card" style="padding:12px;"><div style="font-size:11px;color:var(--tmu);">Reason for Leave</div><div style="font-size:13px;color:var(--td);margin-top:4px;">' + escapeHtml(req.reason || 'None provided') + '</div></div>' +
      '<div><label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:6px;">Teaching Coverage &amp; Substitutions:</label>' + (subsHtml || '<div style="color:var(--tmu);font-size:12px;">No substitution slots required for this period.</div>') + '</div>';
    }

    if (actions) {
      actions.innerHTML = '<button class="btn btn-sec" onclick="closeModal(\'m-fl-review\')">Close</button> ' +
        '<button class="btn btn-sec" style="color:#d97706;" onclick="decideFacultyLeave(\'' + id + '\', \'return\')"><re-icon icon="undo" size="12"></re-icon> Return</button> ' +
        '<button class="btn btn-danger" onclick="decideFacultyLeave(\'' + id + '\', \'reject\')"><re-icon icon="x" size="12"></re-icon> Reject</button> ' +
        (isPrincipal
          ? '<button class="btn btn-pri" onclick="decideFacultyLeave(\'' + id + '\', \'principal-approve\')"><re-icon icon="check" size="12"></re-icon> Final Approval</button>'
          : '<button class="btn btn-pri" onclick="decideFacultyLeave(\'' + id + '\', \'permit\')"><re-icon icon="check" size="12"></re-icon> Permit &amp; Forward to Principal</button>');
    }
  })
  .catch(function (err) {
    if (body) body.innerHTML = '<div style="color:#ef4444;text-align:center;">Failed to load details: ' + escapeHtml(err.message) + '</div>';
  });
}

async function decideFacultyLeave(id, action) {
  var token = getToken();
  var endpoint = '';
  var bodyData = {};

  if (action === 'permit') {
    endpoint = '/api/leave/faculty/' + id + '/hod-permit';
    bodyData = { comment: 'Permitted and recommended by HOD' };
  } else if (action === 'reject') {
    var reason = await showPrompt('Enter reason for rejecting leave request:', '', 'Reject Leave');
    if (!reason || !reason.trim()) return;
    endpoint = '/api/leave/faculty/' + id + '/hod-reject';
    bodyData = { reason: reason.trim() };
  } else if (action === 'return') {
    var note = await showPrompt('Enter correction remarks to return to faculty:', '', 'Return Leave');
    if (!note || !note.trim()) return;
    endpoint = '/api/leave/faculty/' + id + '/hod-return';
    bodyData = { note: note.trim() };
  } else if (action === 'principal-approve') {
    endpoint = '/api/leave/faculty/' + id + '/principal-approve';
  }

  fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyData)
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast(res.message || 'Leave action completed successfully!', 'success');
    closeModal('m-fl-review');
    loadFacultyLeaveData();
    loadInboxData();
  })
  .catch(function (err) {
    showToast('Action failed: ' + err.message, 'error');
  });
}

function quickPermitFacultyLeave(id) {
  decideFacultyLeave(id, 'permit');
}

function quickRejectFacultyLeave(id) {
  decideFacultyLeave(id, 'reject');
}

function openDirectAssignSubModal(leaveId, slotId, details) {
  _pendingDirectAssign = { leaveId: leaveId, slotId: slotId };
  var info = document.getElementById('fl-assign-sub-info');
  if (info) info.textContent = details || 'Select substitute faculty for teaching coverage';

  var list = document.getElementById('fl-sub-candidates-list');
  if (list) list.innerHTML = '<div style="text-align:center;color:#64748b;font-size:12px;padding:12px;"><div class="spin" style="margin:0 auto 10px;"></div>Searching free teachers…</div>';

  var modal = document.getElementById('m-fl-assign-sub');
  if (modal) modal.style.display = 'flex';

  var token = getToken();
  fetch('/api/substitution/free-teachers?period=1&date=' + todayIST(), {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    var candidates = data.candidates || [];
    if (!candidates.length) {
      if (list) list.innerHTML = '<div style="text-align:center;color:#64748b;font-size:12px;padding:12px;">No free faculty members available for this slot.</div>';
      return;
    }
    if (list) {
      list.innerHTML = candidates.map(function (c) {
        var trackId = c.trackId || c._id;
        return '<label style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;">' +
          '<input type="radio" name="fl-assign-sub-radio" value="' + trackId + '">' +
          '<div>' +
            '<div style="font-size:13px;font-weight:700;color:#0f172a;">' + escapeHtml(c.name || c.fullName) + '</div>' +
            '<div style="font-size:11.5px;color:#64748b;">' + escapeHtml(c.deptCode || c.department || '') + ' · ' + escapeHtml(c.designation || 'Faculty') + '</div>' +
          '</div>' +
        '</label>';
      }).join('');
    }
  })
  .catch(function (err) {
    if (list) list.innerHTML = '<div style="text-align:center;color:#ef4444;font-size:12px;padding:12px;">Failed to find faculty: ' + escapeHtml(err.message) + '</div>';
  });
}

function confirmDirectAssignSub() {
  if (!_pendingDirectAssign) return;
  var radio = document.querySelector('input[name="fl-assign-sub-radio"]:checked');
  if (!radio) {
    showToast('Please select a substitute faculty member.');
    return;
  }
  var reason = document.getElementById('fl-assign-reason')?.value || '';
  var token = getToken();

  fetch('/api/substitution/direct-assign', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      leaveId: _pendingDirectAssign.leaveId,
      slotId: _pendingDirectAssign.slotId,
      substituteTrackId: radio.value,
      reason: reason.trim()
    })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast('Substitute directly assigned!', 'success');
    closeModal('m-fl-assign-sub');
    loadFacultyLeaveData();
  })
  .catch(function (err) {
    showToast('Assignment failed: ' + err.message, 'error');
  });
}

function openFacultyLeavePolicyModal() {
  var modal = document.getElementById('m-fl-policy-edit');
  if (modal) modal.style.display = 'flex';
  var sub = document.getElementById('fl-policy-sub');
  if (sub) sub.textContent = 'Department: ' + (controllerContext?.deptCode || 'Department');

  var token = getToken();
  fetch('/api/leave/policy?deptCode=' + encodeURIComponent(controllerContext?.deptCode || ''), {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    var p = data.policy || data || {};
    var cl = document.getElementById('pol-cl');
    if (cl) cl.value = p.clQuota != null ? p.clQuota : 12;
    var ml = document.getElementById('pol-ml');
    if (ml) ml.value = p.mlQuota != null ? p.mlQuota : 10;
    var el = document.getElementById('pol-el');
    if (el) el.value = p.elQuota != null ? p.elQuota : 15;
    var thresh = document.getElementById('pol-threshold');
    if (thresh) thresh.value = p.medicalDocThresholdDays != null ? p.medicalDocThresholdDays : 3;
    var cf = document.getElementById('pol-carry-forward');
    if (cf) cf.checked = !!p.allowCarryForward;
  });
}

function saveDepartmentLeavePolicy() {
  var cl = Number(document.getElementById('pol-cl')?.value) || 12;
  var ml = Number(document.getElementById('pol-ml')?.value) || 10;
  var el = Number(document.getElementById('pol-el')?.value) || 15;
  var thresh = Number(document.getElementById('pol-threshold')?.value) || 3;
  var cf = document.getElementById('pol-carry-forward')?.checked || false;
  var reason = document.getElementById('pol-reason')?.value || '';

  if (!reason.trim()) {
    showToast('Please provide a reason for policy revision.');
    return;
  }

  var token = getToken();
  fetch('/api/leave/policy', {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deptCode: controllerContext?.deptCode || 'CSE',
      clQuota: cl,
      mlQuota: ml,
      elQuota: el,
      medicalDocThresholdDays: thresh,
      allowCarryForward: cf,
      reason: reason.trim()
    })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast('Department leave policy updated!', 'success');
    closeModal('m-fl-policy-edit');
  })
  .catch(function (err) {
    showToast('Update failed: ' + err.message, 'error');
  });
}

// ── 14B. DEPARTMENT SETTINGS & LEAVE POLICY ─────────────────────
var _currentDeptPolicy = null;
var _institutionalDefaults = null;

function loadDeptSettings() {
  var token = getToken();
  var dept = (typeof selectedDeptFilter !== 'undefined' && selectedDeptFilter) || controllerContext?.deptCode || '';
  var scopeTitle = document.getElementById('dept-policy-scope-title');
  if (scopeTitle) {
    scopeTitle.textContent = 'Department Jurisdiction: ' + (dept || 'All Departments');
  }

  fetch('/api/leave/policy?deptCode=' + encodeURIComponent(dept), {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    var p = data.policy || {};
    _currentDeptPolicy = p;
    _institutionalDefaults = data.defaults || {};

    var revBadge = document.getElementById('dept-policy-rev-badge');
    if (revBadge) {
      revBadge.textContent = 'Revision ' + (p.revision || 1);
    }

    var aqEl = document.getElementById('dept-pol-annual-quota');
    if (aqEl) aqEl.value = p.annualLeaveQuota != null ? p.annualLeaveQuota : (_institutionalDefaults.annualLeaveQuota ?? 15);

    var clEl = document.getElementById('dept-pol-cl');
    if (clEl) clEl.value = (p.allowances && p.allowances.casualLeave != null) ? p.allowances.casualLeave : (p.clQuota != null ? p.clQuota : (_institutionalDefaults.casualLeaveAllowance ?? 12));

    var mlEl = document.getElementById('dept-pol-ml');
    if (mlEl) mlEl.value = (p.allowances && p.allowances.medicalLeave != null) ? p.allowances.medicalLeave : (p.mlQuota != null ? p.mlQuota : (_institutionalDefaults.medicalLeaveAllowance ?? 10));

    var elEl = document.getElementById('dept-pol-el');
    if (elEl) elEl.value = (p.allowances && p.allowances.earnedLeave != null) ? p.allowances.earnedLeave : (p.elQuota != null ? p.elQuota : (_institutionalDefaults.earnedLeaveAllowance ?? 15));

    var cfEl = document.getElementById('dept-pol-carry-forward');
    if (cfEl) cfEl.checked = p.carryForwardEarned != null ? !!p.carryForwardEarned : (p.allowCarryForward != null ? !!p.allowCarryForward : !!_institutionalDefaults.carryForward);

    var mcEl = document.getElementById('dept-pol-max-consec');
    if (mcEl) mcEl.value = p.maxConsecutiveLeaveDays != null ? p.maxConsecutiveLeaveDays : (_institutionalDefaults.maxConsecutiveLeaveDays ?? 3);

    var dtEl = document.getElementById('dept-pol-doc-thresh');
    if (dtEl) dtEl.value = p.medicalDocThresholdDays != null ? p.medicalDocThresholdDays : (_institutionalDefaults.medicalDocThresholdDays ?? 3);

    var rsEl = document.getElementById('dept-pol-require-sub');
    if (rsEl) rsEl.checked = p.requireSubstitution != null ? !!p.requireSubstitution : (_institutionalDefaults.requireSubstitution !== false);

    var apEl = document.getElementById('dept-pol-allow-period');
    if (apEl) apEl.checked = p.allowPeriodLeave != null ? !!p.allowPeriodLeave : (_institutionalDefaults.allowPeriodLeave !== false);

    var aeEl = document.getElementById('dept-pol-auto-escalate');
    if (aeEl) aeEl.checked = p.autoEscalatePrincipal != null ? !!p.autoEscalatePrincipal : !!_institutionalDefaults.autoEscalatePrincipal;

    var reasonEl = document.getElementById('dept-pol-reason');
    if (reasonEl) reasonEl.value = '';

    // Render Revision History Table
    renderDeptPolicyHistory(p.history || []);
  })
  .catch(function (err) {
    showToast('Failed to load department settings: ' + err.message, 'error');
  });
}

function renderDeptPolicyHistory(history) {
  var tbody = document.getElementById('dept-policy-history-tbody');
  if (!tbody) return;

  if (!history || !history.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:20px;color:var(--tmu);">No previous revisions recorded. Current policy is Revision 1.</td></tr>';
    return;
  }

  tbody.innerHTML = history.slice().reverse().map(function (h) {
    var dateStr = h.revisedAt ? new Date(h.revisedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    var revBy = (h.revisedBy && (h.revisedBy.name || h.revisedBy.role)) ? (escapeHtml(h.revisedBy.name || '') + ' (' + escapeHtml(h.revisedBy.role || 'HOD') + ')') : 'Administrator';
    var al = h.allowances || {};
    var quotaStr = 'Annual: ' + (h.annualLeaveQuota || 15) + ' | CL: ' + (al.casualLeave != null ? al.casualLeave : 12) + ', ML: ' + (al.medicalLeave != null ? al.medicalLeave : 10) + ', EL: ' + (al.earnedLeave != null ? al.earnedLeave : 15);
    var rules = [];
    if (h.maxConsecutiveLeaveDays != null) rules.push('Max ' + h.maxConsecutiveLeaveDays + 'd consec');
    if (h.medicalDocThresholdDays != null) rules.push('ML doc &gt;' + h.medicalDocThresholdDays + 'd');
    if (h.requireSubstitution) rules.push('Sub required');
    if (h.allowPeriodLeave) rules.push('Period leave ok');
    if (h.carryForwardEarned) rules.push('EL carry forward');
    if (h.autoEscalatePrincipal) rules.push('Auto escalate');
    var rulesStr = rules.join(' · ') || 'Default rules';

    return '<tr>' +
      '<td><span class="status-tag" style="background:#f1f5f9;color:#334155;font-weight:700;">Rev ' + (h.revision || '—') + '</span></td>' +
      '<td>' + dateStr + '</td>' +
      '<td>' + revBy + '</td>' +
      '<td><code>' + quotaStr + '</code></td>' +
      '<td style="font-size:12px;">' + rulesStr + '</td>' +
      '<td style="font-size:12px;color:var(--td);">' + escapeHtml(h.reason || 'Routine revision') + '</td>' +
    '</tr>';
  }).join('');
}

function saveDeptPolicySettings() {
  var dept = (typeof selectedDeptFilter !== 'undefined' && selectedDeptFilter) || controllerContext?.deptCode || '';
  if (!dept) {
    showToast('Department code could not be determined.', 'error');
    return;
  }

  var reasonEl = document.getElementById('dept-pol-reason');
  var reason = reasonEl ? reasonEl.value.trim() : '';
  if (!reason) {
    showToast('Please provide an operational revision reason for the audit trail.', 'warning');
    if (reasonEl) reasonEl.focus();
    return;
  }

  var annualQuota = Number(document.getElementById('dept-pol-annual-quota')?.value) || 15;
  var cl = Number(document.getElementById('dept-pol-cl')?.value) || 12;
  var ml = Number(document.getElementById('dept-pol-ml')?.value) || 10;
  var el = Number(document.getElementById('dept-pol-el')?.value) || 15;
  var carryForward = document.getElementById('dept-pol-carry-forward')?.checked || false;
  var maxConsec = Number(document.getElementById('dept-pol-max-consec')?.value) || 3;
  var docThresh = Number(document.getElementById('dept-pol-doc-thresh')?.value) || 3;
  var requireSub = document.getElementById('dept-pol-require-sub')?.checked || false;
  var allowPeriod = document.getElementById('dept-pol-allow-period')?.checked || false;
  var autoEscalate = document.getElementById('dept-pol-auto-escalate')?.checked || false;

  var token = getToken();
  fetch('/api/leave/policy', {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deptCode: dept,
      annualLeaveQuota: annualQuota,
      allowances: {
        casualLeave: cl,
        medicalLeave: ml,
        earnedLeave: el
      },
      carryForwardEarned: carryForward,
      maxConsecutiveLeaveDays: maxConsec,
      medicalDocThresholdDays: docThresh,
      requireSubstitution: requireSub,
      allowPeriodLeave: allowPeriod,
      autoEscalatePrincipal: autoEscalate,
      reason: reason
    })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast(res.message || 'Department leave policy updated successfully!', 'success');
    loadDeptSettings();
    if (typeof loadFacultyLeavePolicyView === 'function') {
      loadFacultyLeavePolicyView();
    }
  })
  .catch(function (err) {
    showToast('Failed to save policy: ' + err.message, 'error');
  });
}

function resetDeptPolicyToDefaults() {
  if (!_institutionalDefaults) {
    showToast('Institutional defaults not available.', 'warning');
    return;
  }
  var defs = _institutionalDefaults;
  var aqEl = document.getElementById('dept-pol-annual-quota');
  if (aqEl) aqEl.value = defs.annualLeaveQuota ?? 15;
  var clEl = document.getElementById('dept-pol-cl');
  if (clEl) clEl.value = defs.casualLeaveAllowance ?? 12;
  var mlEl = document.getElementById('dept-pol-ml');
  if (mlEl) mlEl.value = defs.medicalLeaveAllowance ?? 10;
  var elEl = document.getElementById('dept-pol-el');
  if (elEl) elEl.value = defs.earnedLeaveAllowance ?? 15;
  var cfEl = document.getElementById('dept-pol-carry-forward');
  if (cfEl) cfEl.checked = !!defs.carryForward;
  var mcEl = document.getElementById('dept-pol-max-consec');
  if (mcEl) mcEl.value = defs.maxConsecutiveLeaveDays ?? 3;
  var dtEl = document.getElementById('dept-pol-doc-thresh');
  if (dtEl) dtEl.value = defs.medicalDocThresholdDays ?? 3;
  var rsEl = document.getElementById('dept-pol-require-sub');
  if (rsEl) rsEl.checked = defs.requireSubstitution !== false;
  var apEl = document.getElementById('dept-pol-allow-period');
  if (apEl) apEl.checked = defs.allowPeriodLeave !== false;
  var aeEl = document.getElementById('dept-pol-auto-escalate');
  if (aeEl) aeEl.checked = !!defs.autoEscalatePrincipal;

  var reasonEl = document.getElementById('dept-pol-reason');
  if (reasonEl) reasonEl.value = 'Reset to institutional defaults';
  showToast('Populated fields with institutional default settings. Click "Save & Apply Policy" to commit.', 'info');
}

window.loadDeptSettings = loadDeptSettings;
window.saveDeptPolicySettings = saveDeptPolicySettings;
window.resetDeptPolicyToDefaults = resetDeptPolicyToDefaults;

// ── 15. ACADEMIC PARTICIPATION COMMAND CENTRE ───────────────────
var _cachedParticipationRecords = [];
var _pendingODRevocationId = null;

function loadParticipationTracker() {
  var token = getToken();
  var search = document.getElementById('part-filter-search')?.value || '';
  var type = document.getElementById('part-filter-type')?.value || '';
  var level = document.getElementById('part-filter-level')?.value || '';
  var status = document.getElementById('part-filter-status')?.value || '';

  var url = '/api/participation/tracker?_t=' + Date.now();
  if (search) url += '&search=' + encodeURIComponent(search);
  if (type) url += '&type=' + encodeURIComponent(type);
  if (level) url += '&level=' + encodeURIComponent(level);
  if (status) url += '&status=' + encodeURIComponent(status);
  if (selectedDeptFilter) url += '&deptId=' + encodeURIComponent(selectedDeptFilter);

  var tbody = document.getElementById('part-roster-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="text-center"><div class="spin" style="margin:0 auto 10px;"></div>Loading participation records…</td></tr>';

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var summary = data.summary || {};
      _cachedParticipationRecords = data.records || [];

      var setVal = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v != null ? v : 0; };
      setVal('part-kpi-total', summary.total);
      setVal('part-kpi-pending', summary.pending);
      setVal('part-kpi-approved', summary.approved);
      setVal('part-kpi-principal', summary.awaitingPrincipal);
      setVal('part-kpi-completed', summary.completed);
      setVal('part-kpi-verified', summary.verified);
      setVal('part-kpi-certificates', summary.certificates);
      setVal('part-kpi-winners', summary.winners);

      var sbBadge = document.getElementById('sb-part-badge');
      if (sbBadge) {
        sbBadge.textContent = summary.pending || 0;
        sbBadge.style.display = (summary.pending > 0 ? 'inline-block' : 'none');
      }

      renderParticipationRosterTable(_cachedParticipationRecords);
      renderParticipationEventsTable(_cachedParticipationRecords);
      renderParticipationStudentsTable(_cachedParticipationRecords);
      renderParticipationQueueTable(_cachedParticipationRecords);
      renderParticipationCharts(data.charts || {});
    })
    .catch(function (err) {
      console.error('[Participation Load Error]:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="text-center">Failed to load records: ' + escapeHtml(err.message) + '</td></tr>';
    });
}

function renderParticipationRosterTable(records) {
  var tbody = document.getElementById('part-roster-tbody');
  if (!tbody) return;

  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center">No academic participation or OD records found.</td></tr>';
    return;
  }

  tbody.innerHTML = records.map(function (r) {
    var id = r._id || r.requestId;
    var evt = r.eventDetails || {};
    var dates = (r.dates || []).join(', ') || (evt.startDate === evt.endDate ? evt.startDate : (evt.startDate + ' → ' + evt.endDate));

    var statusCol = r.status === 'approved' ? '#059669' : r.status === 'pending' ? '#d97706' : r.status === 'completed' ? '#2563eb' : '#dc2626';
    var statusBg = r.status === 'approved' ? '#ecfdf5' : r.status === 'pending' ? '#fffbeb' : r.status === 'completed' ? '#eff6ff' : '#fef2f2';

    var actionsHtml = '<button class="btn btn-sm btn-sec" onclick="openODDetailModal(\'' + id + '\')"><re-icon icon="search" size="12"></re-icon> View</button>';
    if (r.status === 'pending') {
      actionsHtml += ' <button class="btn btn-sm btn-pri" onclick="approveOD(\'' + id + '\')"><re-icon icon="check" size="12"></re-icon></button>';
      actionsHtml += ' <button class="btn btn-sm btn-danger" onclick="rejectOD(\'' + id + '\')"><re-icon icon="x" size="12"></re-icon></button>';
    } else if (r.status === 'approved') {
      actionsHtml += ' <button class="btn btn-sm btn-danger" onclick="openRejectODModal(\'' + id + '\')" title="Revoke Approved OD"><re-icon icon="alert-triangle" size="12"></re-icon> Revoke</button>';
    }

    var scorePill = r.odVerificationScore != null
      ? '<span class="badge" style="background:#e0e7ff;color:#4338ca;font-weight:700;">' + r.odVerificationScore + ' pts</span>'
      : '<span style="color:#94a3b8;">—</span>';

    return '<tr>' +
      '<td><span class="badge" style="background:#f1f5f9;color:#334155;font-weight:700;">' + escapeHtml(r.requestId || id) + '</span></td>' +
      '<td><strong>' + escapeHtml(r.studentName || 'Student') + '</strong><br><small style="color:var(--tmu);">' + escapeHtml(r.studentRegNo || '') + '</small></td>' +
      '<td>' + escapeHtml(r.className || '') + ' · ' + escapeHtml(r.deptCode || '') + '</td>' +
      '<td><strong>' + escapeHtml(evt.name || 'Event') + '</strong><br><small style="color:var(--tmu);">' + escapeHtml(evt.organizer || '') + '</small></td>' +
      '<td>' + escapeHtml(evt.type || 'Technical') + ' (' + escapeHtml(evt.level || 'College') + ')</td>' +
      '<td>' + escapeHtml(dates) + '</td>' +
      '<td><span class="badge" style="background:' + statusBg + ';color:' + statusCol + ';font-weight:700;">' + escapeHtml(r.status || 'pending') + '</span></td>' +
      '<td>' + escapeHtml(r.outcome?.primaryOutcome || 'Pending Verification') + '</td>' +
      '<td>' + scorePill + '</td>' +
      '<td><div style="display:flex;gap:4px;">' + actionsHtml + '</div></td>' +
    '</tr>';
  }).join('');
}

function renderParticipationEventsTable(records) {
  var tbody = document.getElementById('part-events-tbody');
  if (!tbody) return;

  var eventsMap = {};
  records.forEach(function (r) {
    var e = r.eventDetails || {};
    var name = e.name || 'Untitled Event';
    if (!eventsMap[name]) {
      eventsMap[name] = {
        name: name,
        organizer: e.organizer || '—',
        type: e.type || 'Technical',
        level: e.level || 'College',
        dates: (e.startDate || '') + (e.endDate ? (' → ' + e.endDate) : ''),
        participants: 0,
        approved: 0,
        verified: 0,
        certificates: 0
      };
    }
    eventsMap[name].participants++;
    if (r.status === 'approved' || r.status === 'completed') eventsMap[name].approved++;
    if (r.verification?.status === 'verified') eventsMap[name].verified++;
    if (r.outcome?.evidence?.driveFileId || r.outcome?.evidence?.webViewLink) eventsMap[name].certificates++;
  });

  var list = Object.values(eventsMap);
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center">No academic events tracked.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(function (ev) {
    return '<tr>' +
      '<td><strong>' + escapeHtml(ev.name) + '</strong></td>' +
      '<td>' + escapeHtml(ev.organizer) + '</td>' +
      '<td>' + escapeHtml(ev.type) + ' (' + escapeHtml(ev.level) + ')</td>' +
      '<td>' + escapeHtml(ev.dates) + '</td>' +
      '<td><strong>' + ev.participants + '</strong></td>' +
      '<td><span style="color:#059669;font-weight:700;">' + ev.approved + '</span></td>' +
      '<td><span style="color:#0891b2;font-weight:700;">' + ev.verified + '</span></td>' +
      '<td>' + ev.certificates + '</td>' +
      '<td><button class="btn btn-sm btn-sec" onclick="filterByEventName(\'' + escapeHtml(ev.name) + '\')"><re-icon icon="search" size="12"></re-icon> View Students</button></td>' +
    '</tr>';
  }).join('');
}

function filterByEventName(name) {
  var searchInput = document.getElementById('part-filter-search');
  if (searchInput) searchInput.value = name;
  switchParticipationTab('roster');
  loadParticipationTracker();
}

function renderParticipationStudentsTable(records) {
  var tbody = document.getElementById('part-students-tbody');
  if (!tbody) return;

  var stuMap = {};
  records.forEach(function (r) {
    var key = r.studentRegNo || r.studentTrackId || r.studentName;
    if (!stuMap[key]) {
      stuMap[key] = {
        name: r.studentName,
        regNo: r.studentRegNo || '—',
        classDept: (r.className || '') + ' · ' + (r.deptCode || ''),
        total: 0,
        verified: 0,
        certificates: 0,
        wins: 0,
        score: 0
      };
    }
    stuMap[key].total++;
    if (r.verification?.status === 'verified') stuMap[key].verified++;
    if (r.outcome?.evidence?.driveFileId || r.outcome?.evidence?.webViewLink) stuMap[key].certificates++;
    if (['Winner', 'Runner-Up', 'Finalist'].includes(r.outcome?.primaryOutcome)) stuMap[key].wins++;
    if (r.odVerificationScore) stuMap[key].score += r.odVerificationScore;
  });

  var list = Object.values(stuMap);
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center">No student participation profiles found.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(function (s) {
    return '<tr>' +
      '<td><strong>' + escapeHtml(s.name) + '</strong></td>' +
      '<td>' + escapeHtml(s.regNo) + '</td>' +
      '<td>' + escapeHtml(s.classDept) + '</td>' +
      '<td><strong>' + s.total + '</strong></td>' +
      '<td><span style="color:#0891b2;font-weight:700;">' + s.verified + '</span></td>' +
      '<td>' + s.certificates + '</td>' +
      '<td><span style="color:#ca8a04;font-weight:700;">' + s.wins + '</span></td>' +
      '<td><span class="badge" style="background:#e0e7ff;color:#4338ca;font-weight:700;">' + s.score + ' pts</span></td>' +
      '<td><button class="btn btn-sm btn-sec" onclick="filterByEventName(\'' + escapeHtml(s.name) + '\')"><re-icon icon="search" size="12"></re-icon> Activities</button></td>' +
    '</tr>';
  }).join('');
}

function renderParticipationQueueTable(records) {
  var tbody = document.getElementById('part-queue-tbody');
  if (!tbody) return;

  var queue = records.filter(function (r) {
    return r.status === 'pending' || r.status === 'evidence_overdue' || r.status === 'awaiting_outcome';
  });

  if (!queue.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">No pending authorizations or overdue evidence in queue. <re-icon icon="check-circle"></re-icon></td></tr>';
    return;
  }

  tbody.innerHTML = queue.map(function (r) {
    var id = r._id || r.requestId;
    var evt = r.eventDetails || {};
    var dates = (r.dates || []).join(', ') || (evt.startDate === evt.endDate ? evt.startDate : (evt.startDate + ' → ' + evt.endDate));

    var stageBadge = r.currentStage === 'principal'
      ? '<span class="chip chip-purple">Awaiting Principal</span>'
      : r.status === 'evidence_overdue'
        ? '<span class="status-tag rejected">Evidence Overdue</span>'
        : '<span class="chip chip-yellow">HOD Review</span>';

    return '<tr>' +
      '<td><span class="badge" style="background:#f1f5f9;color:#334155;font-weight:700;">' + escapeHtml(r.requestId || id) + '</span></td>' +
      '<td><strong>' + escapeHtml(r.studentName) + '</strong> (' + escapeHtml(r.studentRegNo || '') + ')</td>' +
      '<td>' + escapeHtml(evt.name || 'Event') + '</td>' +
      '<td>' + escapeHtml(dates) + '</td>' +
      '<td>' + stageBadge + '</td>' +
      '<td><span class="badge" style="background:#e0e7ff;color:#4338ca;font-weight:700;">' + (r.odVerificationScore || 0) + ' pts</span></td>' +
      '<td>' +
        '<div style="display:flex;gap:4px;">' +
          '<button class="btn btn-sm btn-sec" onclick="openODDetailModal(\'' + id + '\')">Details</button> ' +
          (r.status === 'pending' ? '<button class="btn btn-sm btn-pri" onclick="approveOD(\'' + id + '\')">Approve</button>' : '') +
          (r.status === 'evidence_overdue' ? '<button class="btn btn-sm btn-danger" onclick="openRejectODModal(\'' + id + '\')">Revoke</button>' : '') +
        '</div>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function renderParticipationCharts(charts) {
  function renderSvgBarChart(containerId, dataMap, barColor) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var entries = Object.entries(dataMap || {});
    if (!entries.length) {
      el.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;font-size:12px;">No distribution data available yet.</div>';
      return;
    }
    var maxVal = Math.max.apply(null, entries.map(function (e) { return e[1]; })) || 1;
    var barsHtml = entries.map(function (e) {
      var label = e[0];
      var count = e[1];
      var pct = Math.max(8, Math.round((count / maxVal) * 100));
      return '<div style="margin-bottom:8px;">' +
        '<div style="display:flex;justify-content:space-between;font-size:11.5px;color:#334155;margin-bottom:2px;">' +
          '<span>' + escapeHtml(label) + '</span>' +
          '<strong>' + count + '</strong>' +
        '</div>' +
        '<div style="background:#e2e8f0;height:8px;border-radius:4px;overflow:hidden;">' +
          '<div style="background:' + barColor + ';width:' + pct + '%;height:100%;border-radius:4px;transition:width 0.3s ease;"></div>' +
        '</div>' +
      '</div>';
    }).join('');

    el.innerHTML = '<div style="padding:12px 4px;">' + barsHtml + '</div>';
  }

  renderSvgBarChart('chart-part-by-type', charts.byType, '#6366f1');
  renderSvgBarChart('chart-part-by-level', charts.byLevel, '#0ea5e9');
  renderSvgBarChart('chart-part-by-outcome', charts.byOutcome, '#10b981');
  renderSvgBarChart('chart-part-by-month', charts.byMonth, '#f59e0b');
}

function switchParticipationTab(tab) {
  var tabs = ['roster', 'events', 'students', 'charts', 'queue'];
  tabs.forEach(function (t) {
    var btn = document.getElementById('tab-btn-part-' + t);
    var view = document.getElementById('part-view-' + t);
    if (btn) {
      if (t === tab) btn.classList.add('act');
      else btn.classList.remove('act');
    }
    if (view) {
      view.style.display = (t === tab ? 'block' : 'none');
    }
  });
}

function onParticipationFilterChange() {
  clearTimeout(window._partFilterTimer);
  window._partFilterTimer = setTimeout(function () {
    loadParticipationTracker();
  }, 250);
}

function openODDetailModal(id) {
  var title = document.getElementById('part-detail-title');
  var sub = document.getElementById('part-detail-sub');
  var body = document.getElementById('part-detail-body');
  var actions = document.getElementById('part-detail-actions');

  if (title) title.textContent = 'Activity Details';
  if (sub) sub.textContent = 'Request ID: ' + id;
  if (body) body.innerHTML = '<div style="text-align:center;padding:30px;"><div class="spin" style="margin:0 auto 10px;"></div>Loading activity details…</div>';

  var modal = document.getElementById('m-part-detail');
  if (modal) modal.style.display = 'flex';

  var token = getToken();
  fetch('/api/od/' + id, {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    var od = data.odRequest || data.request || data;
    var evt = od.eventDetails || {};
    var dates = (od.dates || []).join(', ') || (evt.startDate === evt.endDate ? evt.startDate : (evt.startDate + ' → ' + evt.endDate));

    if (body) {
      body.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
        '<div class="card" style="padding:12px;"><div style="font-size:11px;color:var(--tmu);">Student</div><div style="font-size:14px;font-weight:700;color:var(--td);margin-top:2px;">' + escapeHtml(od.studentName || 'Student') + '</div><div style="font-size:12px;color:var(--tmu);">' + escapeHtml(od.studentRegNo || '') + ' · ' + escapeHtml(od.className || '') + '</div></div>' +
        '<div class="card" style="padding:12px;"><div style="font-size:11px;color:var(--tmu);">Event &amp; Organiser</div><div style="font-size:14px;font-weight:700;color:var(--td);margin-top:2px;">' + escapeHtml(evt.name || 'Event') + '</div><div style="font-size:12px;color:var(--tmu);">' + escapeHtml(evt.organizer || '') + '</div></div>' +
      '</div>' +
      '<div class="card" style="padding:12px;">' +
        '<div style="font-size:11px;color:var(--tmu);">Event Description &amp; Verification Score</div>' +
        '<div style="font-size:13px;color:var(--td);margin-top:4px;">' + escapeHtml(evt.description || 'No description provided') + '</div>' +
        '<div style="margin-top:8px;display:flex;gap:8px;align-items:center;">' +
          '<span class="badge" style="background:#e0e7ff;color:#4338ca;font-weight:700;">Score: ' + (od.odVerificationScore || 0) + ' pts</span>' +
          '<span class="badge" style="background:#f1f5f9;color:#334155;">Type: ' + escapeHtml(evt.type || 'Technical') + ' (' + escapeHtml(evt.level || 'College') + ')</span>' +
        '</div>' +
      '</div>' +
      '<div class="card" style="padding:12px;">' +
        '<div style="font-size:11px;color:var(--tmu);">Attendance Coverage Dates</div>' +
        '<div style="font-size:13px;font-weight:600;color:var(--td);margin-top:2px;">' + escapeHtml(dates) + '</div>' +
      '</div>';
    }

    if (actions) {
      var btns = '<button class="btn btn-sec" onclick="closeModal(\'m-part-detail\')">Close</button>';
      if (od.status === 'pending') {
        btns += ' <button class="btn btn-sec" style="color:#d97706;" onclick="returnOD(\'' + id + '\')"><re-icon icon="undo" size="12"></re-icon> Return</button>';
        btns += ' <button class="btn btn-danger" onclick="rejectOD(\'' + id + '\')"><re-icon icon="x" size="12"></re-icon> Reject</button>';
        btns += ' <button class="btn btn-pri" onclick="approveOD(\'' + id + '\')"><re-icon icon="check" size="12"></re-icon> Approve OD</button>';
      } else if (od.status === 'approved') {
        btns += ' <button class="btn btn-danger" onclick="closeModal(\'m-part-detail\'); openRejectODModal(\'' + id + '\')"><re-icon icon="alert-triangle" size="12"></re-icon> Revoke Approved OD</button>';
      }
      actions.innerHTML = btns;
    }
  })
  .catch(function (err) {
    if (body) body.innerHTML = '<div style="color:#ef4444;text-align:center;">Failed to load activity details: ' + escapeHtml(err.message) + '</div>';
  });
}

function approveOD(id) {
  var token = getToken();
  fetch('/api/od/' + id + '/approve', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comments: 'Approved by HOD' })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast(res.message || 'OD request approved!', 'success');
    closeModal('m-part-detail');
    loadParticipationTracker();
    loadInboxData();
  })
  .catch(function (err) {
    showToast('Approval failed: ' + err.message, 'error');
  });
}

async function rejectOD(id) {
  var reason = await showPrompt('Enter reason for rejecting OD request:', '', 'Reject OD');
  if (!reason || !reason.trim()) return;

  var token = getToken();
  fetch('/api/od/' + id + '/reject', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason.trim() })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast(res.message || 'OD request rejected', 'info');
    closeModal('m-part-detail');
    loadParticipationTracker();
    loadInboxData();
  })
  .catch(function (err) {
    showToast('Rejection failed: ' + err.message, 'error');
  });
}

async function returnOD(id) {
  var comments = await showPrompt('Enter correction comments to return to student:', '', 'Return OD');
  if (!comments || !comments.trim()) return;

  var token = getToken();
  fetch('/api/od/' + id + '/return', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comments: comments.trim() })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast(res.message || 'OD request returned to student for corrections', 'info');
    closeModal('m-part-detail');
    loadParticipationTracker();
    loadInboxData();
  })
  .catch(function (err) {
    showToast('Return failed: ' + err.message, 'error');
  });
}

function openRejectODModal(id) {
  _pendingODRevocationId = id;
  var wrap = document.getElementById('part-reject-dates-wrap');
  var prevBox = document.getElementById('part-reject-preview-box');
  var reason = document.getElementById('part-reject-reason');
  if (prevBox) prevBox.style.display = 'none';
  if (reason) reason.value = '';
  if (wrap) wrap.innerHTML = '<div style="color:var(--tmu);font-size:12px;">Loading dates…</div>';

  var modal = document.getElementById('m-part-reject-od');
  if (modal) modal.style.display = 'flex';

  var token = getToken();
  fetch('/api/od/' + id, {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    var od = data.odRequest || data.request || data;
    var dates = od.dates || [];
    if (wrap) {
      if (!dates.length) {
        wrap.innerHTML = '<div style="color:var(--tmu);font-size:12px;">No specific attendance dates registered.</div>';
      } else {
        wrap.innerHTML = dates.map(function (d) {
          return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#334155;background:#fff;padding:4px 8px;border-radius:6px;border:1px solid #cbd5e1;cursor:pointer;">' +
            '<input type="checkbox" name="part-revoke-date" value="' + d + '" checked> ' + d +
          '</label>';
        }).join('');
      }
    }
  });
}

function previewODRevocation() {
  if (!_pendingODRevocationId) return;
  var checks = document.querySelectorAll('input[name="part-revoke-date"]:checked');
  var dates = Array.from(checks).map(function (c) { return c.value; });
  var reason = document.getElementById('part-reject-reason')?.value || '';

  if (!reason.trim()) {
    showToast('Please enter a reason for revocation before previewing.');
    return;
  }

  var token = getToken();
  fetch('/api/od/' + _pendingODRevocationId + '/reject-approved?dryRun=true', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dates: dates, reason: reason.trim() })
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    var prev = data.preview || {};
    var box = document.getElementById('part-reject-preview-box');
    if (box) {
      box.style.display = 'block';
      box.innerHTML = '<strong>Revocation Impact Preview:</strong><br>' +
        '• Converted to Absent: ' + (prev.convertedCount != null ? prev.convertedCount : (prev.recordsReverted || dates.length)) + ' period(s)<br>' +
        '• Affected Dates: ' + dates.join(', ');
    }
  })
  .catch(function (err) {
    showToast('Preview failed: ' + err.message, 'error');
  });
}

function confirmODRevocation() {
  if (!_pendingODRevocationId) return;
  var checks = document.querySelectorAll('input[name="part-revoke-date"]:checked');
  var dates = Array.from(checks).map(function (c) { return c.value; });
  var reason = document.getElementById('part-reject-reason')?.value || '';

  if (!reason.trim()) {
    showToast('A revocation reason is required.');
    return;
  }

  var token = getToken();
  fetch('/api/od/' + _pendingODRevocationId + '/reject-approved', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dates: dates, reason: reason.trim() })
  })
  .then(function (r) { return r.json(); })
  .then(function (res) {
    if (res.error) throw new Error(res.error);
    showToast('Approved OD revoked. Attendance records converted to Absent.', 'success');
    closeModal('m-part-reject-od');
    loadParticipationTracker();
    loadInboxData();
  })
  .catch(function (err) {
    showToast('Revocation failed: ' + err.message, 'error');
  });
}

function exportParticipationCsv() {
  var token = getToken();
  var dept = selectedDeptFilter || controllerContext?.deptCode || '';
  window.open('/api/participation/tracker/export.csv?deptCode=' + encodeURIComponent(dept) + '&token=' + encodeURIComponent(token), '_blank');
}

// ── 16. EXECUTIVE AUDIT LOG ─────────────────────────────────────
var _auditSearchTimer = null;
var _auditCurrentPage = 1;
var _auditTotalPages = 1;

function loadAuditLogData(page) {
  var tbody = document.getElementById('audit-log-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="text-center"><div class="spin" style="margin:0 auto 10px;"></div>Loading executive audit stream…</td></tr>';

  var p = (typeof page === 'number') ? page : _auditCurrentPage;
  _auditCurrentPage = p;

  var token = getToken();
  var search = document.getElementById('audit-search-input')?.value || '';
  var severity = document.getElementById('audit-severity-select')?.value || '';
  var moduleFilter = document.getElementById('audit-module-select')?.value || '';

  var url = '/api/controller/audit?page=' + encodeURIComponent(_auditCurrentPage) + '&limit=25&_t=' + Date.now();
  if (search) url += '&search=' + encodeURIComponent(search);
  if (severity) url += '&severity=' + encodeURIComponent(severity);
  if (moduleFilter) url += '&module=' + encodeURIComponent(moduleFilter);

  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var logs = data.logs || [];
      _auditTotalPages = data.totalPages || 1;
      _auditCurrentPage = data.page || _auditCurrentPage;

      // Update pagination bar
      var infoEl = document.getElementById('audit-pagination-info');
      if (infoEl) {
        var total = data.total || logs.length;
        infoEl.textContent = 'Showing ' + logs.length + ' of ' + total + ' logs (Page ' + _auditCurrentPage + ' of ' + _auditTotalPages + ')';
      }
      var prevBtn = document.getElementById('audit-prev-btn');
      if (prevBtn) prevBtn.disabled = _auditCurrentPage <= 1;
      var nextBtn = document.getElementById('audit-next-btn');
      if (nextBtn) nextBtn.disabled = _auditCurrentPage >= _auditTotalPages;

      if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No audit log records match the current filters.</td></tr>';
        return;
      }

      tbody.innerHTML = logs.map(function (l) {
        var sevClass = l.severity === 'critical' ? 'chip-red' : l.severity === 'warning' ? 'chip-yellow' : 'chip-green';
        var formattedDate = l.createdAt ? new Date(l.createdAt).toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
        }) : '—';

        var detailsText = '';
        if (l.details && typeof l.details === 'object') {
          detailsText = Object.entries(l.details).map(function (e) {
            return escapeHtml(e[0]) + ': ' + escapeHtml(typeof e[1] === 'object' ? JSON.stringify(e[1]) : String(e[1]));
          }).join(' · ');
        } else {
          detailsText = escapeHtml(String(l.details || ''));
        }

        return '<tr>' +
          '<td style="white-space:nowrap;font-size:12px;color:var(--tmu);">' + escapeHtml(formattedDate) + '</td>' +
          '<td><strong>' + escapeHtml(l.actor || 'System') + '</strong><br><small style="color:var(--tmu);">' + escapeHtml(l.trackId || '') + '</small></td>' +
          '<td><span class="badge" style="background:#f1f5f9;color:#334155;">' + escapeHtml(l.role || 'system') + '</span></td>' +
          '<td><strong>' + escapeHtml(l.action || '—') + '</strong></td>' +
          '<td><span class="chip ' + sevClass + '">' + escapeHtml(l.severity || 'info') + '</span></td>' +
          '<td style="max-width:320px;font-size:12px;color:var(--td);word-break:break-word;">' + (detailsText || '—') + '</td>' +
          '<td style="font-size:11.5px;color:var(--tmu);font-family:monospace;">' + escapeHtml(l.ip || '127.0.0.1') + '</td>' +
        '</tr>';
      }).join('');
    })
    .catch(function (err) {
      console.error('[Audit Log Error]:', err);
      tbody.innerHTML = '<tr><td colspan="7" class="text-center">Failed to load audit logs: ' + escapeHtml(err.message) + '</td></tr>';
    });
}

function changeAuditPage(delta) {
  var newPage = _auditCurrentPage + delta;
  if (newPage >= 1 && newPage <= _auditTotalPages) {
    loadAuditLogData(newPage);
  }
}

function handleAuditSearch(val) {
  clearTimeout(_auditSearchTimer);
  _auditSearchTimer = setTimeout(function () {
    loadAuditLogData(1);
  }, 300);
}

// ── 17. CLASS LIVE TELEMETRY DRAWER ─────────────────────────────
var _currentDrawerClassId = null;
var _currentDrawerData = null;
var _liveDateOverride = null;

function getTodayStr() {
  var d = new Date();
  var year = d.getFullYear();
  var month = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function openClassDrawer(classIdOrSessionId) {
  var drawer = document.getElementById('class-live-drawer');
  if (!drawer) return;
  drawer.classList.add('open');

  var classId = classIdOrSessionId;
  if (typeof classIdOrSessionId === 'object' && classIdOrSessionId !== null) {
    classId = classIdOrSessionId.classId || classIdOrSessionId._id;
  }
  _currentDrawerClassId = classId;

  var titleEl = document.getElementById('drawer-class-title');
  if (titleEl) titleEl.textContent = 'Loading Class…';
  var subEl = document.getElementById('drawer-class-sub');
  if (subEl) subEl.textContent = 'Fetching live attendance telemetry…';
  var rosterList = document.getElementById('drawer-roster-list');
  if (rosterList) rosterList.innerHTML = '<div style="padding:24px;text-align:center;color:var(--tmu);"><div class="spin" style="margin:0 auto 10px;"></div>Loading class telemetry…</div>';

  var token = getToken();
  var dateStr = (typeof _liveDateOverride !== 'undefined' && _liveDateOverride)
    ? _liveDateOverride
    : (_timeMachineActive && _tmDate ? _tmDate : getTodayStr());
  fetch('/api/controller/class/' + encodeURIComponent(classId) + '/live?date=' + encodeURIComponent(dateStr) + '&_t=' + Date.now(), {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    if (data.error) throw new Error(data.error);
    _currentDrawerData = data;
    renderClassDrawer(data);
  })
  .catch(function (err) {
    console.error('[Class Live Drawer Error]:', err);
    if (titleEl) titleEl.textContent = 'Class Live View';
    if (subEl) subEl.textContent = 'Failed to load telemetry';
    if (rosterList) rosterList.innerHTML = '<div style="padding:24px;text-align:center;color:#ef4444;">Error: ' + escapeHtml(err.message) + '</div>';
  });
}

function closeClassDrawer() {
  var drawer = document.getElementById('class-live-drawer');
  if (drawer) drawer.classList.remove('open');
  _currentDrawerClassId = null;
  _currentDrawerData = null;
}

function onDrawerBackdropClick(e) {
  if (e.target && e.target.id === 'class-live-drawer') {
    closeClassDrawer();
  }
}

function renderClassDrawer(data) {
  var cls = data.classInfo || {};
  var now = data.nowSession || (data.todaySessions && data.todaySessions[0]) || {};
  var roster = data.roster || [];
  var trend = data.trend || [];

  // Header info
  var titleEl = document.getElementById('drawer-class-title');
  if (titleEl) titleEl.textContent = cls.name || 'Class Live View';
  var subEl = document.getElementById('drawer-class-sub');
  if (subEl) subEl.textContent = 'Room ' + (cls.room || '—') + ' · Advisor: ' + (cls.advisorName || '—') + ' · ' + (cls.enrolledCount || roster.length) + ' Enrolled';

  // Now Card
  var pChip = document.getElementById('drawer-now-period');
  if (pChip) pChip.textContent = now.periodNumber ? 'P' + now.periodNumber : '—';
  var subj = document.getElementById('drawer-now-subject');
  if (subj) subj.textContent = now.subjectName || 'No active session';
  var fac = document.getElementById('drawer-now-faculty');
  if (fac) fac.textContent = (now.actualTeacher && now.actualTeacher.name) || (now.scheduledTeacher && now.scheduledTeacher.name) || now.teacherName || '—';

  var subFlag = document.getElementById('drawer-now-sub-flag');
  if (subFlag) subFlag.style.display = now.isSubstitute ? 'inline' : 'none';

  var statusPill = document.getElementById('drawer-now-status-pill');
  if (statusPill) {
    var st = now.status || 'pending';
    var dotClass = st === 'active' ? 'green' : st === 'marked' ? 'blue' : st === 'cancelled' ? 'red' : 'gray';
    statusPill.innerHTML = '<span class="status-dot ' + dotClass + '"></span> ' + (st.charAt(0).toUpperCase() + st.slice(1));
  }

  var geo = document.getElementById('drawer-now-geofence');
  if (geo) {
    if (now.isStarted) {
      geo.className = 'tile-start-badge started';
      geo.textContent = 'Session In Progress';
    } else {
      geo.className = 'tile-start-badge not-started';
      geo.textContent = 'Pending Start';
    }
  }

  // Summary counts across roster for current target period
  var pCount = 0, odCount = 0, lvCount = 0, abCount = 0;
  roster.forEach(function (s) {
    if (s.status === 'Present') pCount++;
    else if (s.status === 'OD') odCount++;
    else if (s.status === 'Leave') lvCount++;
    else if (s.status === 'Absent') abCount++;
  });
  var stPres = document.getElementById('drawer-stat-present'); if (stPres) stPres.textContent = pCount;
  var stOd = document.getElementById('drawer-stat-od'); if (stOd) stOd.textContent = odCount;
  var stLv = document.getElementById('drawer-stat-leave'); if (stLv) stLv.textContent = lvCount;
  var stAb = document.getElementById('drawer-stat-absent'); if (stAb) stAb.textContent = abCount;

  // Call faculty button link
  var btnCall = document.getElementById('drawer-btn-call');
  if (btnCall) {
    var phone = (now.actualTeacher && now.actualTeacher.phone) || (now.scheduledTeacher && now.scheduledTeacher.phone) || '';
    if (phone) {
      btnCall.href = 'tel:' + phone;
      btnCall.style.display = 'inline-flex';
    } else {
      btnCall.href = '#';
      btnCall.style.display = 'none';
    }
  }

  // Periods Strip
  var strip = document.getElementById('drawer-periods-strip');
  if (strip) {
    var matrix = data.matrix || [];
    if (!matrix.length) {
      strip.innerHTML = '<div style="font-size:12px;color:var(--tmu);">No schedule for today.</div>';
    } else {
      strip.innerHTML = matrix.map(function (m) {
        var isCurrent = now.periodNumber === m.periodNumber;
        var pClass = isCurrent ? 'period-chip active' : (m.hasSession ? 'period-chip has-session' : 'period-chip');
        var pct = m.totalMarked > 0 ? Math.round((m.present / m.totalMarked) * 100) + '%' : (m.hasSession ? 'Pending' : 'Free');
        return '<div class="' + pClass + '" style="padding:6px 10px;border-radius:8px;border:1px solid #e2e8f0;background:' + (isCurrent ? '#ecfdf5' : '#f8fafc') + ';text-align:center;min-width:68px;">' +
          '<div style="font-size:11px;font-weight:700;color:' + (isCurrent ? '#047857' : '#334155') + ';">P' + m.periodNumber + '</div>' +
          '<div style="font-size:10px;color:var(--tmu);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:64px;">' + escapeHtml(m.subjectName || '—') + '</div>' +
          '<div style="font-size:10.5px;font-weight:600;color:' + (isCurrent ? '#059669' : '#64748b') + ';">' + pct + '</div>' +
        '</div>';
      }).join('');
    }
  }

  // Trend Bars
  var trendBars = document.getElementById('drawer-trend-bars');
  var trendAvg = document.getElementById('drawer-trend-avg');
  if (trendBars) {
    if (!trend.length) {
      trendBars.innerHTML = '<div style="font-size:11.5px;color:var(--tmu);padding:8px 0;">No prior attendance data.</div>';
      if (trendAvg) trendAvg.textContent = '—% avg';
    } else {
      var sum = 0, cnt = 0;
      trendBars.innerHTML = trend.map(function (t) {
        var pct = Number(t.presentPct) || 0;
        sum += pct; cnt++;
        var barColor = pct >= 80 ? '#10b981' : pct >= 75 ? '#f59e0b' : '#ef4444';
        var dStr = t.date ? t.date.slice(5) : '';
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">' +
          '<div style="font-size:10px;color:var(--tmu);">' + pct + '%</div>' +
          '<div style="width:100%;max-width:24px;background:#f1f5f9;height:48px;border-radius:4px;display:flex;align-items:flex-end;overflow:hidden;">' +
            '<div style="width:100%;height:' + pct + '%;background:' + barColor + ';border-radius:3px 3px 0 0;"></div>' +
          '</div>' +
          '<div style="font-size:9.5px;color:var(--tmu);white-space:nowrap;">' + escapeHtml(dStr) + '</div>' +
        '</div>';
      }).join('');
      if (trendAvg && cnt > 0) trendAvg.textContent = Math.round(sum / cnt) + '% 7-day avg';
    }
  }

  // Roster
  var rosterSummary = document.getElementById('drawer-roster-summary');
  if (rosterSummary) rosterSummary.textContent = roster.length + ' students · Absentees prioritized';
  var rosterList = document.getElementById('drawer-roster-list');
  if (rosterList) {
    if (!roster.length) {
      rosterList.innerHTML = '<div style="padding:16px;text-align:center;color:var(--tmu);font-size:12px;">No enrolled students found.</div>';
    } else {
      rosterList.innerHTML = roster.map(function (s) {
        var badgeBg = s.status === 'Present' ? '#ecfdf5' : s.status === 'OD' ? '#eff6ff' : s.status === 'Leave' ? '#fffbeb' : '#fef2f2';
        var badgeColor = s.status === 'Present' ? '#065f46' : s.status === 'OD' ? '#1e40af' : s.status === 'Leave' ? '#92400e' : '#991b1b';
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;">' +
          '<div style="display:flex;align-items:center;gap:10px;min-width:0;">' +
            '<div style="width:28px;height:28px;border-radius:50%;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;color:#334155;flex-shrink:0;">' +
              escapeHtml((s.name || '?').charAt(0).toUpperCase()) +
            '</div>' +
            '<div style="min-width:0;">' +
              '<div style="font-weight:600;color:var(--td);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(s.name) + '</div>' +
              '<div style="font-size:10.5px;color:var(--tmu);">' + escapeHtml(s.registerNo || s.trackId || '') + ' · Total: ' + (s.overallPct != null ? s.overallPct + '%' : '—') + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' +
            '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:' + badgeBg + ';color:' + badgeColor + ';">' + escapeHtml(s.smartTag || s.status) + '</span>' +
            '<button class="btn btn-sm btn-sec" style="padding:2px 6px;font-size:10.5px;" onclick="openStudentRecordModal(\'' + s.trackId + '\')" title="View profile">Profile</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  }
}

function drawerNudgeFaculty() {
  if (!_currentDrawerData) return;
  var now = _currentDrawerData.nowSession || (_currentDrawerData.todaySessions && _currentDrawerData.todaySessions[0]);
  if (!now || !now._id) {
    showToast('No active session selected to nudge.');
    return;
  }
  nudgeTeacherSession(now._id);
}

function drawerOpenSubstituteModal() {
  if (!_currentDrawerData) return;
  var now = _currentDrawerData.nowSession || (_currentDrawerData.todaySessions && _currentDrawerData.todaySessions[0]);
  if (!now || !now._id) {
    showToast('No session selected for substitute assignment.');
    return;
  }
  var teacherName = (now.actualTeacher && now.actualTeacher.name) || (now.scheduledTeacher && now.scheduledTeacher.name) || 'Faculty';
  var desc = 'Period ' + (now.periodNumber || '—') + ' · ' + (_currentDrawerData.classInfo?.name || '');
  openSubstituteModal(now._id, teacherName, desc);
}

function drawerOpenMoveRoomModal() {
  if (!_currentDrawerData) return;
  var now = _currentDrawerData.nowSession || (_currentDrawerData.todaySessions && _currentDrawerData.todaySessions[0]);
  if (!now || !now._id) {
    showToast('No session selected to relocate.');
    return;
  }
  openMoveRoomModal(now._id, _currentDrawerData.classInfo?.room);
}

function drawerOpenNoteModal() {
  if (!_currentDrawerData) return;
  var now = _currentDrawerData.nowSession || (_currentDrawerData.todaySessions && _currentDrawerData.todaySessions[0]);
  if (!now || !now._id) {
    showToast('No session selected to attach note.');
    return;
  }
  openSessionNoteModal(now._id);
}

function drawerOpenCancelModal() {
  if (!_currentDrawerData) return;
  var now = _currentDrawerData.nowSession || (_currentDrawerData.todaySessions && _currentDrawerData.todaySessions[0]);
  if (!now || !now._id) {
    showToast('No session selected to cancel.');
    return;
  }
  openCancelSessionModal(now._id, now.periodNumber || 1, _currentDrawerData.classInfo?.name || 'Class');
}

// ── GLOBAL WINDOW BINDINGS ──────────────────────────────────────
window.nav = nav;
window.toggleSidebar = toggleSidebar;
window.onGlobalDeptChange = onGlobalDeptChange;
window.loadSectionData = loadSectionData;

// Live Board & Drawers
window.reloadLiveBoardData = reloadLiveBoardData;
window.switchLiveBoardView = switchLiveBoardView;
window.loadDayMatrix = loadDayMatrix;
window.toggleTimeMachine = toggleTimeMachine;
window.applyTimeMachine = applyTimeMachine;
window.resetLiveTimeMachine = resetLiveTimeMachine;
window.toggleProblemsOnly = toggleProblemsOnly;
window.filterBoardTiles = filterBoardTiles;
window.generateTodaySessions = generateTodaySessions;
window.confirmDeclareHoliday = confirmDeclareHoliday;
window.confirmExtendAttendanceLock = confirmExtendAttendanceLock;
window.loadLiveAlerts = loadLiveAlerts;
window.ackAlert = ackAlert;
window.resolveAlert = resolveAlert;
window.nudgeTeacherSession = nudgeTeacherSession;
window.openSubstituteModal = openSubstituteModal;
window.closeSubstituteModal = closeSubstituteModal;
window.filterSubstituteCandidates = filterSubstituteCandidates;
window.confirmAssignSubstituteFromRadio = confirmAssignSubstituteFromRadio;
window.openCancelSessionModal = openCancelSessionModal;
window.closeCancelSessionModal = closeCancelSessionModal;
window.confirmCancelSession = confirmCancelSession;
window.openMoveRoomModal = openMoveRoomModal;
window.closeMoveRoomModal = closeMoveRoomModal;
window.confirmMoveRoom = confirmMoveRoom;
window.openSessionNoteModal = openSessionNoteModal;
window.closeSessionNoteModal = closeSessionNoteModal;
window.confirmSaveSessionNote = confirmSaveSessionNote;
window.openStudentRecordModal = openStudentRecordModal;
window.closeStudentRecordModal = closeStudentRecordModal;
window.generateWarningLetterFromCurrent = generateWarningLetterFromCurrent;
window.closeWarningLetterModal = closeWarningLetterModal;
window.printWarningLetter = printWarningLetter;
window.openClassDrawer = openClassDrawer;
window.closeClassDrawer = closeClassDrawer;
window.onDrawerBackdropClick = onDrawerBackdropClick;
window.drawerNudgeFaculty = drawerNudgeFaculty;
window.drawerOpenSubstituteModal = drawerOpenSubstituteModal;
window.drawerOpenMoveRoomModal = drawerOpenMoveRoomModal;
window.drawerOpenNoteModal = drawerOpenNoteModal;
window.drawerOpenCancelModal = drawerOpenCancelModal;

// Inbox
window.loadInboxData = loadInboxData;
window.filterInbox = filterInbox;
window.approveUnlockRequest = approveUnlockRequest;
window.rejectUnlockRequest = rejectUnlockRequest;
window.hodApproveInboxSubAdmin = hodApproveInboxSubAdmin;
window.hodDenyInboxSubAdmin = hodDenyInboxSubAdmin;

// Dashboard & Attendance
window.loadDashboardData = loadDashboardData;
window.changeAttendanceDate = changeAttendanceDate;
window.setAttendanceToday = setAttendanceToday;
window.loadDailyAttendance = loadDailyAttendance;

// Student & Teacher Leaves
window.switchLeaveTab = switchLeaveTab;
window.filterLeaves = filterLeaves;
window.loadLeavesData = loadLeavesData;
window.toggleSelectAllLeaves = toggleSelectAllLeaves;
window.handleBulkLeaveAction = handleBulkLeaveAction;
window.openSingleLeaveAction = openSingleLeaveAction;
window.closeLeaveActionModal = closeLeaveActionModal;
window.confirmLeaveAction = confirmLeaveAction;

// Faculty Leave & Substitutions
window.loadFacultyLeaveData = loadFacultyLeaveData;
window.switchFacultyLeaveTab = switchFacultyLeaveTab;
window.loadFacultyLeaveCalendar = loadFacultyLeaveCalendar;
window.loadFacultyLeavePolicyView = loadFacultyLeavePolicyView;
window.openFacultyLeaveReviewModal = openFacultyLeaveReviewModal;
window.decideFacultyLeave = decideFacultyLeave;
window.quickPermitFacultyLeave = quickPermitFacultyLeave;
window.quickRejectFacultyLeave = quickRejectFacultyLeave;
window.openDirectAssignSubModal = openDirectAssignSubModal;
window.confirmDirectAssignSub = confirmDirectAssignSub;
window.openFacultyLeavePolicyModal = openFacultyLeavePolicyModal;
window.saveDepartmentLeavePolicy = saveDepartmentLeavePolicy;

// Academic Participation & OD
window.loadParticipationTracker = loadParticipationTracker;
window.switchParticipationTab = switchParticipationTab;
window.onParticipationFilterChange = onParticipationFilterChange;
window.filterByEventName = filterByEventName;
window.openODDetailModal = openODDetailModal;
window.approveOD = approveOD;
window.rejectOD = rejectOD;
window.returnOD = returnOD;
window.openRejectODModal = openRejectODModal;
window.previewODRevocation = previewODRevocation;
window.confirmODRevocation = confirmODRevocation;
window.exportParticipationCsv = exportParticipationCsv;

// Directories, Defaulters, Reports
window.loadFacultyData = loadFacultyData;
window.filterFacultyTable = filterFacultyTable;
window.loadStudentsData = loadStudentsData;
window.filterStudentsTable = filterStudentsTable;
window.loadPeriodRecords = loadPeriodRecords;
window.changeRecordsDate = changeRecordsDate;
window.filterPeriodRecords = filterPeriodRecords;
window.loadDefaultersData = loadDefaultersData;
window.filterDefaulterBand = filterDefaulterBand;
window.toggleSelectAllDefaulters = toggleSelectAllDefaulters;
window.openMeetDefaultersModal = openMeetDefaultersModal;
window.closeMeetDefaultersModal = closeMeetDefaultersModal;
window.confirmSendMeetNotice = confirmSendMeetNotice;
window.switchReportTab = switchReportTab;
window.loadDailyReport = loadDailyReport;
window.exportDailyReportCsv = exportDailyReportCsv;
window.loadPunctualityReport = loadPunctualityReport;
window.exportPunctualityCsv = exportPunctualityCsv;
window.loadHeatmapReport = loadHeatmapReport;
window.loadMonthlyReport = loadMonthlyReport;
window.loadSemesterReport = loadSemesterReport;
window.exportReportCsv = exportReportToCsv;
window.exportReportToCsv = exportReportToCsv;
window.exportDefaultersCsv = exportDefaultersCsv;

// Broadcast, Calendar, Timetable, Profile, Audit
window.sendControllerBroadcast = handleSendBroadcast;
window.handleSendBroadcast = handleSendBroadcast;
window.loadBroadcastHistory = loadBroadcastHistory;
window.loadAcademicCalendar = loadAcademicCalendar;
window.loadTimetableClasses = loadTimetableClasses;
window.renderClassTimetable = renderClassTimetable;
window.loadWorkloadSection = loadWorkloadSection;
window.loadProfileData = loadProfileData;
window.loadAuditLogData = loadAuditLogData;
window.changeAuditPage = changeAuditPage;
window.handleAuditSearch = handleAuditSearch;

// Timetable Verification (HoD & Principal)
window.loadCtrlTimetableVerificationPage = loadCtrlTimetableVerificationPage;
window.filterCtrlTtRequests = filterCtrlTtRequests;
window.renderCtrlTtTable = renderCtrlTtTable;
window.ctrlReviewTimetable = ctrlReviewTimetable;
window.openCtrlTimetableMatrixModal = openCtrlTimetableMatrixModal;
window.closeCtrlMatrixModal = closeCtrlMatrixModal;
window.updateCtrlTtVerificationBadge = updateCtrlTtVerificationBadge;
window.checkTimetablePendingAlert = checkTimetablePendingAlert;



