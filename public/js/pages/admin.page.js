var _memStore = {};

// ─── DATABASE HELPER ────────────────────────────────────────────────────────
const DB = {
  get: function (collection) {
    try { return _memStore['ss3_' + collection] || []; }
    catch (e) { return []; }
  },
  set: function (collection, data) {
    _memStore['ss3_' + collection] = data;
  },
  insert: function (collection, doc) {
    const rows = DB.get(collection);
    doc._id = '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    rows.push(doc);
    DB.set(collection, rows);
    return doc;
  },
  update: function (collection, id, updates) {
    const rows = DB.get(collection);
    const index = rows.findIndex(function (row) { return row._id === id; });
    if (index >= 0) {
      rows[index] = Object.assign({}, rows[index], updates);
      DB.set(collection, rows);
    }
  },
  delete: function (collection, id) {
    DB.set(collection, DB.get(collection).filter(function (row) { return row._id !== id; }));
  },
  find: function (collection, query) {
    query = query || {};
    return DB.get(collection).filter(function (doc) {
      return Object.keys(query).every(function (key) { return doc[key] === query[key]; });
    });
  },
  one: function (collection, query) {
    query = query || {};
    return DB.get(collection).find(function (doc) {
      return Object.keys(query).every(function (key) { return doc[key] === query[key]; });
    }) || null;
  }
};

// ─── COURSE CATALOG ─────────────────────────────────────────────────────────
const COURSES = {
  UG: {
    'B.E': ['Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering',
      'Electronics & Communication Engineering', 'Computer Science Engineering',
      'Information Technology', 'Chemical Engineering', 'Biomedical Engineering'],
    'B.TECH': ['Computer Science & Engineering', 'Information Technology',
      'Electronics & Communication', 'Data Science', 'AI & ML', 'Cybersecurity'],
  },
  PG: {
    'M.E': ['Computer Science', 'VLSI Design', 'Power Systems', 'Structural Engineering'],
    'M.TECH': ['Computer Science & Engineering', 'Data Science', 'AI & ML', 'Embedded Systems'],
  }
};

// ─── SEED / INITIAL DATA ────────────────────────────────────────────────────
function initDB() {
  // No default data seeded
}

// ─── DATE UTILITIES ──────────────────────────────────────────────────────────
function getWeekDates(offset) {
  var today = new Date();
  today.setDate(today.getDate() + (offset || 0));
  var dayOfWeek = today.getDay();
  var monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

  return Array.from({ length: 5 }, function (_, i) {
    var d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().split('T')[0];
  });
}

function thisWeek() { return getWeekDates(0); }

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function timeAgo(isoDate) {
  var diffSeconds = (Date.now() - new Date(isoDate).getTime()) / 1000;
  if (diffSeconds < 60) return 'just now';
  if (diffSeconds < 3600) return Math.floor(diffSeconds / 60) + 'm ago';
  if (diffSeconds < 86400) return Math.floor(diffSeconds / 3600) + 'h ago';
  return Math.floor(diffSeconds / 86400) + 'd ago';
}

// ─── AUTHENTICATION ──────────────────────────────────────────────────────────
var currentUser = null;

var YEAR_CONFIG = { current: '', batches: [], all: [] };



// ── Session Auto-Logout after 45 minutes
(function () {
  function checkSessionExpiry() {
    var loginTime = sessionStorage.getItem('eams_login_time');
    if (loginTime) {
      var elapsed = Date.now() - parseInt(loginTime, 10);
      if (elapsed > 45 * 60 * 1000) {
        if (typeof dbToast === 'function') {
          dbToast('⚠️ Session expired. Logging out...', 'error');
        } else if (typeof showToast === 'function') {
          showToast('⚠️ Session expired. Logging out...');
        }
        setTimeout(function () {
          doLogout();
        }, 1500);
      }
    }
  }
  checkSessionExpiry();
  setInterval(checkSessionExpiry, 15000);
})();

// ─── SIDEBAR TOGGLE ──────────────────────────────────────────────────────────
function toggleAdminSidebar() {
  var sidebar = document.querySelector('#app-shell .sb');
  var mainContent = document.querySelector('.mc');
  var toggleButton = document.getElementById('sbtoggle');
  var overlay = document.getElementById('sb-overlay');
  var isMobile = window.innerWidth <= 768;

  if (isMobile) {
    var isOpen = sidebar.classList.toggle('sb-mobile-open');
    if (overlay) overlay.classList.toggle('visible', isOpen);
    toggleButton.innerHTML = isOpen ? '✖' : '☰';
  } else {
    var isHidden = sidebar.classList.toggle('sb-hidden');
    mainContent.classList.toggle('sb-expanded', isHidden);
    toggleButton.classList.toggle('closed', isHidden);
    toggleButton.innerHTML = isHidden ? '☰' : '✖';
  }
}

function bootApp() {
  // Populate user info while loader is still shown (elements exist, just hidden behind loader)
  var avatarLetter = currentUser.name[0].toUpperCase();
  document.getElementById('sb-av').textContent = avatarLetter;
  document.getElementById('sb-name').textContent = currentUser.name;
  document.getElementById('topbar-av').textContent = avatarLetter;
  document.getElementById('topbar-name').textContent = currentUser.name;
  document.getElementById('pr-av-big').textContent = avatarLetter;
  document.getElementById('pr-name-big').textContent = currentUser.name;
  document.getElementById('tdt-label').textContent =
    new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  populateAdminDropdowns();

  // ── Loader message sequence ────────────────────────
  var LOADER_STEPS = [
    { t: 0, msg: 'Initializing EAMS…' },
    { t: 150, msg: 'Connecting to Database…' },
    { t: 300, msg: 'Fetching Counts & Config…' },
    { t: 500, msg: 'Almost ready…' },
  ];

  var loaderMsgEl = document.getElementById('loader-msg');
  var loaderEtaEl = document.getElementById('loader-eta');

  function setLoaderMsg(idx, text) {
    if (!loaderMsgEl) return;
    loaderMsgEl.classList.add('msg-fade');
    setTimeout(function () {
      loaderMsgEl.textContent = text;
      loaderMsgEl.classList.remove('msg-fade');
      // Advance step dots (5 dots, indices 0-4)
      for (var s = 0; s < 5; s++) {
        var dot = document.getElementById('lstep-' + s);
        if (!dot) continue;
        dot.className = 'loader-step' + (s < idx ? ' done' : s === idx ? ' active' : '');
      }
    }, 130);
  }

  LOADER_STEPS.forEach(function (step, i) {
    if (i === 0) return; // first already set in HTML
    setTimeout(function () { setLoaderMsg(i, step.msg); }, step.t);
  });

  var TASK_NAMES = ['counts', 'depts', 'notifications', 'yearConfig'];
  var TASK_LABELS = {
    counts: 'Collection Counts', depts: 'Departments',
    notifications: 'Notifications', yearConfig: 'Year Config'
  };
  var DEFAULT_TASK_MS = 600;

  var _completedDurations = [];

  function taskAvg() {
    if (_completedDurations.length === 0) return DEFAULT_TASK_MS;
    return Math.round(_completedDurations.reduce(function (a, b) { return a + b; }, 0) / _completedDurations.length);
  }

  var _etaMs = DEFAULT_TASK_MS;
  var _pendingTasks = TASK_NAMES.slice();
  var _syncStartTime = Date.now();

  function formatEta(ms) {
    var sec = Math.max(1, Math.round(ms / 1000));
    if (sec >= 60) return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
    return sec + 's';
  }

  function updateEtaDisplay() {
    if (!loaderEtaEl) return;
    if (_pendingTasks.length === 0) {
      loaderEtaEl.innerHTML = '✔ All data loaded';
      return;
    }

    var waitingFor = _pendingTasks.slice(0, 3).map(function (n) { return TASK_LABELS[n] || n; }).join(', ');
    if (_pendingTasks.length > 3) waitingFor += ' +' + (_pendingTasks.length - 3);
    if (_etaMs <= 0) {
      loaderEtaEl.innerHTML = 'Waiting for ' + waitingFor + '…';
    } else {
      loaderEtaEl.innerHTML = 'ETA: <span class="eta-time">' + formatEta(_etaMs)
        + '</span> — loading ' + waitingFor;
    }
  }

  updateEtaDisplay();

  function onSyncProgress(taskName, pending, elapsedMs) {
    _pendingTasks = pending;
    _completedDurations.push(elapsedMs);
    if (pending.length === 0) {
      _etaMs = 0;
      updateEtaDisplay();
      return;
    }
    var avgCompleted = taskAvg();
    var maxRemaining = 0;
    pending.forEach(function () {
      var predicted = taskAvg();
      var remaining = Math.max(0, predicted - elapsedMs);
      if (remaining > maxRemaining) maxRemaining = remaining;
    });
    _etaMs = maxRemaining;
    updateEtaDisplay();
  }

  var _etaTick = setInterval(function () {
    if (_etaMs <= 0 || _pendingTasks.length === 0) return;
    _etaMs = Math.max(0, _etaMs - 1000);
    updateEtaDisplay();
  }, 1000);

  var timerDone = false;
  var fetchDone = false;
  var fetchCb = null;

  function tryReveal() {
    if (!timerDone || !fetchDone) return;
    clearInterval(_etaTick);
    _loaderActive = false;
    var loader = document.getElementById('page-loader');
    if (loader) {
      loader.classList.add('loader-fade');
      setTimeout(function () {
        loader.style.display = 'none';
        var nonSavingToasts = _toastQueue.filter(function (a) { return a[1] !== 'saving'; });
        if (nonSavingToasts.length) {
          var last = nonSavingToasts[nonSavingToasts.length - 1];
          dbToast(last[0], last[1], last[2]);
        }
        _toastQueue = [];
      }, 360);
    }
    document.getElementById('app-shell').classList.add('vis');
    if (fetchCb) fetchCb();
  }

  setTimeout(function () { timerDone = true; tryReveal(); }, 500);

  syncAllFromDB(function () {
    fetchCb = function () {
      syncBadgesFromAPI();
      var urlParams = new URLSearchParams(window.location.search);
      var initialTab = urlParams.get('tab') || urlParams.get('page');
      if (initialTab && PAGE_NAMES.indexOf(initialTab) !== -1) {
        nav(initialTab);
      } else {
        nav('dash');
      }
      populateAdminDropdowns();
    };
    fetchDone = true;
    tryReveal();
  }, onSyncProgress);
}

// ─── NAVIGATION ──────────────────────────────────────────────────────────────
var PAGE_NAMES = ['dash', 'depts', 'struct', 'students', 'teachers', 'roles', 'reports', 'logs'];

function nav(pageName) {
  if (PAGE_NAMES.indexOf(pageName) === -1) pageName = 'dash';

  window._currentPage = pageName;

  if (window.history && window.history.replaceState) {
    var url = new URL(window.location);
    url.searchParams.set('tab', pageName);
    window.history.replaceState(null, '', url);
  }

  document.querySelectorAll('.pg').forEach(function (el) { el.classList.remove('act'); });
  var targetPage = document.getElementById('pg-' + pageName);
  if (targetPage) targetPage.classList.add('act');
  document.querySelectorAll('.sb-item').forEach(function (item) { item.classList.remove('act'); });
  var activeItem = document.querySelector('.sb-item[data-page="' + pageName + '"]');
  if (activeItem) activeItem.classList.add('act');

  var pageInitializers = {
    'dash': initDash,
    'depts': function () {
      dbToast('Fetching Data, please wait', 'saving');
      renderDepartments();
      ensureLoaded(['classes', 'subjects', 'users'], function () {
        renderDepartments();
        dbToast('Fetched data successfully', 'success');
      }).catch(function (err) {
        console.error(err);
        dbToast('Loaded with warnings', 'warn');
      });
    },
    'struct': function () {
      dbToast('Fetching Data, please wait', 'saving');
      resetStructureState();
      renderDepartmentSelector();
      renderDepartments();
      ensureLoaded(['classes', 'subjects', 'assignments', 'users'], function () {
        renderDepartmentSelector();
        renderDepartments();
        dbToast('Fetched data successfully', 'success');
      }).catch(function (err) {
        console.error(err);
        dbToast('Loaded with warnings', 'warn');
      });
    },
    'students': function () {
      dbToast('Fetching Data, please wait', 'saving');
      _studentPage = 1; _studentData = []; _studentTotal = 0;
      _studentSortBy = 'regNo'; _studentSortDir = 'asc';
      document.getElementById('stb').innerHTML = '<tr><td colspan="10" style="text-align:center;padding:36px 16px;color:var(--tdi);"><span style="font-size:38px;display:block;margin-bottom:10px;">📋</span><div style="font-size:14px;font-weight:600;margin-bottom:4px;">Click <strong>Show List</strong> above to view students.</div><div style="font-size:12px;color:var(--tdi);">Select filters and click Show List to begin.</div></td></tr>';
      document.getElementById('scb').textContent = '0 students';
      document.getElementById('load-more-wrap').style.display = 'none';
      updateShowListEnabled();
      populateStudentFilterDropdowns().then(function () {
        updateShowListEnabled();
        dbToast('Fetched data successfully', 'success');
      }).catch(function (err) {
        console.error(err);
        updateShowListEnabled();
        dbToast('Loaded with warnings', 'warn');
      });
    },
    'teachers': function () {
      dbToast('Fetching Data, please wait', 'saving');
      _teacherData = [];
      _teacherSearchQuery = '';
      _teacherDesigFilter = '';
      _teacherRoleFilter = 'all';
      _teacherViewMode = 'grid';
      _teacherSortBy = '';
      _teacherSortDir = 'asc';
      var qEl = document.getElementById('tf-q'); if (qEl) qEl.value = '';
      var desigEl = document.getElementById('tf-desig'); if (desigEl) desigEl.value = '';
      document.querySelectorAll('#t-role-pills .t-pill').forEach(function (btn) {
        btn.classList.toggle('act', btn.getAttribute('data-role') === 'all');
      });
      document.querySelectorAll('#ttbl-wrap .sort-ind').forEach(function (el) { el.textContent = ''; });
      toggleTeacherView('grid');
      populateTeacherDeptDropdown();
      renderTeachers();
      ensureLoaded(['users'], function () {
        _refreshTeacherList();
        dbToast('Fetched data successfully', 'success');
      }).catch(function (err) {
        console.error(err);
        dbToast('Loaded with warnings', 'warn');
      });
    },
    'reports': function () {
      dbToast('Fetching Data, please wait', 'saving');
      initAdminReports();
      ensureLoaded(['classes'], function () {
        initAdminReports();
        dbToast('Fetched data successfully', 'success');
      }).catch(function (err) {
        console.error(err);
        dbToast('Loaded with warnings', 'warn');
      });
    },
    'logs': function () {
      dbToast('Fetching Data, please wait', 'saving');
      _logRoleFilter = '';
      _logData = [];
      _logCursor = null;
      _logHasMore = true;
      _logTotal = 0;
      DB.set('logs', []);
      _fetchLogsInitial().then(function () {
        _loaded.logs = true;
        setLogRole('');
        dbToast('Fetched data successfully', 'success');
      }).catch(function (err) {
        console.error(err);
        dbToast('Loaded with warnings', 'warn');
      });
    },
    'roles': function () {
      dbToast('Fetching Executive Roles, please wait', 'saving');
      loadExecutiveRolesData().then(function () {
        dbToast('Fetched Executive Roles successfully', 'success');
      }).catch(function (err) {
        console.error(err);
        dbToast('Loaded with warnings', 'warn');
      });
    }
  };
  if (pageInitializers[pageName]) pageInitializers[pageName]();
}

function refreshAll() {
  var currentPage = window._currentPage || 'dash';
  dbToast('Refreshing all data…', 'saving');
  Object.keys(_loaded).forEach(function (k) { _loaded[k] = false; });
  syncAllFromDB(function () {
    nav(currentPage);
    dbToast('Refreshed all data', 'success');
  });
}

// ─── ACTIVITY LOGS ───────────────────────────────────────────────────────────
var _logRoleFilter = '';
var _logData = [];
var _logCursor = null;
var _logHasMore = true;
var _logTotal = 0;

function _fetchLogsInitial() {
  return apiCall('GET', '/logs?limit=50').then(function (res) {
    var list = Array.isArray(res) ? res : (res && Array.isArray(res.logs) ? res.logs : []);
    _logData = list;
    _logTotal = res && typeof res.total === 'number' ? res.total : list.length;
    _logHasMore = res && res.hasMore;
    _logCursor = list.length ? list[list.length - 1].time : null;
    DB.set('logs', list.slice());
  });
}

function loadMoreLogs() {
  if (!_logCursor || !_logHasMore) return;
  var btn = document.getElementById('btn-load-more-logs');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading\u2026'; }
  apiCall('GET', '/logs?limit=50&before=' + encodeURIComponent(_logCursor))
    .then(function (res) {
      var list = Array.isArray(res) ? res : (res && Array.isArray(res.logs) ? res.logs : []);
      if (list.length) {
        _logData = _logData.concat(list);
        _logCursor = list[list.length - 1].time;
        _logHasMore = res && res.hasMore;
        var existing = DB.get('logs') || [];
        DB.set('logs', existing.concat(list));
      } else {
        _logHasMore = false;
      }
      renderLogs();
      if (btn) { btn.disabled = false; btn.textContent = 'Load More'; }
    })
    .catch(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'Load More'; }
    });
}

function setLogRole(role) {
  _logRoleFilter = role;
  ['all', 'admin', 'teacher', 'student', 'system'].forEach(function (r) {
    var el = document.getElementById('lrt-' + r);
    if (el) el.classList.toggle('act-pill', (r === 'all' && role === '') || r === role);
  });
  renderLogs();
}

function _logRelTime(ts) {
  var diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  var d = new Date(ts), yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString())
    return 'Yesterday ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function _logDateLabel(ts) {
  var d = new Date(ts), today = new Date(), yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
}

function addLog(action, details) {
  if (!currentUser) return;
  var la = action.toLowerCase();
  var type = 'other';
  if (la.includes('add') || la.includes('import')) type = 'add';
  else if (la.includes('update') || la.includes('edit') || la.includes('login') || la.includes('assign')) type = 'update';
  else if (la.includes('delete') || la.includes('clear') || la.includes('remove')) type = 'delete';
  var entry = {
    role: 'admin', userName: currentUser.name || 'Admin',
    action: action, details: details || '', type: type,
    timestamp: new Date().toISOString()
  };
  DB.insert('logs', entry);
  _logData.unshift(entry);
  _logTotal++;
  // Persist to server so student-side and admin logs share the same store
  var tok = getToken();
  if (tok) {
    fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify(entry)
    }).catch(function () { });
  }
}

function renderLogStatCards(total, counts) {
  var el = document.getElementById('log-stat-cards');
  if (!el) return;
  var cards = [
    { label: 'Total Logs', val: total, icon: '📋', bg: '#fff', tc: 'var(--td)', mc: 'var(--tmu)' },
    { label: 'Admin Actions', val: counts.admin, icon: '👑', bg: '#fef2f2', tc: '#dc2626', mc: 'var(--tmu)' },
    { label: 'Teacher Actions', val: counts.teacher, icon: '👩‍🏫', bg: '#eff6ff', tc: '#2563eb', mc: 'var(--tmu)' },
    { label: 'Student Actions', val: counts.student, icon: '🎓', bg: '#f0fdf4', tc: '#16a34a', mc: 'var(--tmu)' },
  ];
  el.innerHTML = cards.map(function (c) {
    return '<div style="background:' + c.bg + ';border-radius:16px;padding:18px 20px;display:flex;align-items:center;gap:14px;border:1px solid var(--br);box-shadow:0 1px 4px rgba(0,0,0,.04);">'
      + '<div style="font-size:30px;line-height:1;">' + c.icon + '</div>'
      + '<div><div style="font-size:26px;font-weight:800;color:' + c.tc + ';line-height:1.1;">' + c.val + '</div>'
      + '<div style="font-size:11px;font-weight:600;color:' + c.mc + ';margin-top:2px;">' + c.label + '</div></div>'
      + '</div>';
  }).join('');
}

function renderLogs() {
  var fromDate = document.getElementById('lfd') ? document.getElementById('lfd').value : '';
  var toDate = document.getElementById('ltd') ? document.getElementById('ltd').value : '';
  var searchQ = (document.getElementById('lsq') ? document.getElementById('lsq').value : '').toLowerCase();

  // Normalize: server stores 'time', local addLog stores 'timestamp' — support both
  var rawLogs = _logData;
  var logsArr = Array.isArray(rawLogs) ? rawLogs : [];
  var allLogs = logsArr.map(function (l) {
    return Object.assign({}, l, { _ts: l.timestamp || l.time || new Date().toISOString() });
  }).slice().reverse();

  // Stat counts from unfiltered set (always show full counts)
  var counts = { admin: 0, teacher: 0, student: 0, system: 0 };
  allLogs.forEach(function (l) {
    var r = (l.userName === 'SYSTEM' ? 'system' : (l.role || '')).toLowerCase();
    if (counts[r] !== undefined) counts[r]++;
  });
  renderLogStatCards(_logTotal, counts);

  // Apply filters
  if (_logRoleFilter) allLogs = allLogs.filter(function (l) { return l.role === _logRoleFilter; });
  if (fromDate) allLogs = allLogs.filter(function (l) { return l._ts.slice(0, 10) >= fromDate; });
  if (toDate) allLogs = allLogs.filter(function (l) { return l._ts.slice(0, 10) <= toDate; });
  if (searchQ) allLogs = allLogs.filter(function (l) {
    return (l.userName || '').toLowerCase().includes(searchQ)
      || (l.action || '').toLowerCase().includes(searchQ)
      || (l.details || '').toLowerCase().includes(searchQ);
  });

  var container = document.getElementById('fll');
  if (!container) return;
  if (!allLogs.length) {
    container.innerHTML = '<div class="emst"><span class="emico">📋</span><div class="emtx">No logs match your filters.</div></div>';
    return;
  }

  var roleStyle = {
    admin: { bg: '#fef2f2', color: '#dc2626', border: '#fca5a5', av: '#dc2626', label: 'Admin' },
    teacher: { bg: '#eff6ff', color: '#2563eb', border: '#93c5fd', av: '#2563eb', label: 'Teacher' },
    student: { bg: '#f0fdf4', color: '#16a34a', border: '#86efac', av: '#16a34a', label: 'Student' },
    system: { bg: '#f5f3ff', color: '#7c3aed', border: '#c4b5fd', av: '#7c3aed', label: 'System' },
  };
  var typeStyle = {
    add: { bg: '#dcfce7', color: '#16a34a', label: 'Added' },
    update: { bg: '#fef3c7', color: '#d97706', label: 'Updated' },
    delete: { bg: '#fee2e2', color: '#dc2626', label: 'Deleted' },
    other: { bg: '#f3f4f6', color: '#6b7280', label: 'Action' },
  };

  // Group by calendar date using normalized _ts field
  var groups = {}, order = [];
  allLogs.forEach(function (log) {
    var key = new Date(log._ts).toDateString();
    if (!groups[key]) { groups[key] = { label: _logDateLabel(log._ts), entries: [] }; order.push(key); }
    groups[key].entries.push(log);
  });

  var html = '';
  order.forEach(function (key) {
    var g = groups[key];
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
      + '<span style="font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;letter-spacing:.7px;white-space:nowrap;">' + g.label + '</span>'
      + '<span style="flex:1;height:1px;background:var(--brl);"></span>'
      + '<span style="font-size:11px;color:var(--tdi);white-space:nowrap;">' + g.entries.length + ' action' + (g.entries.length !== 1 ? 's' : '') + '</span>'
      + '</div>';

    html += '<div class="card" style="padding:0;overflow:hidden;margin-bottom:18px;">';
    g.entries.forEach(function (log, i) {
      var rs = roleStyle[log.role] || roleStyle.system;
      var ts = typeStyle[log.type] || typeStyle.other;
      var inits = (log.userName || '?').split(' ').map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
      var exact = new Date(log._ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      html += '<div style="display:flex;align-items:flex-start;gap:12px;padding:13px 18px;'
        + (i < g.entries.length - 1 ? 'border-bottom:1px solid var(--brl);' : '')
        + '" onmouseover="this.style.background=\'var(--gLt)\'" onmouseout="this.style.background=\'#fff\'">';

      html += '<div style="width:36px;height:36px;border-radius:50%;background:' + rs.av + ';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0;margin-top:1px;">' + inits + '</div>';

      html += '<div style="flex:1;min-width:0;">'
        + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px;">'
        + '<span style="font-size:13px;font-weight:700;color:var(--td);">' + (log.userName || 'Unknown') + '</span>'
        + '<span style="background:' + rs.bg + ';color:' + rs.color + ';border:1px solid ' + rs.border + ';padding:1px 9px;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;">' + rs.label + '</span>'
        + '<span style="background:' + ts.bg + ';color:' + ts.color + ';padding:1px 9px;border-radius:20px;font-size:10px;font-weight:600;">' + ts.label + '</span>'
        + '</div>'
        + '<div style="font-size:13px;font-weight:600;color:var(--td);margin-bottom:' + (log.details ? '2px' : '0') + ';">' + (log.action || '') + '</div>'
        + (log.details ? '<div style="font-size:11.5px;color:var(--tmu);">' + log.details + '</div>' : '')
        + '</div>';

      html += '<div style="flex-shrink:0;text-align:right;padding-top:1px;">'
        + '<div style="font-size:11.5px;font-weight:600;color:var(--tdi);white-space:nowrap;" title="' + exact + '">' + _logRelTime(log._ts) + '</div>'
        + '</div>';

      html += '</div>';
    });
    html += '</div>';
  });

  container.innerHTML = html;
  var wrap = document.getElementById('load-more-logs-wrap');
  if (wrap) wrap.style.display = _logHasMore ? 'block' : 'none';
}

function clearAllLogs() {
  document.getElementById('dc-confirm-id').value = 'logs';
  document.getElementById('dc-confirm-msg').textContent = 'Clear all activity logs? This cannot be undone.';
  document.getElementById('dc-confirm-btn').onclick = function () {
    requireSpecialPw(function () {
      var tok = getToken();
      var headers = { 'Content-Type': 'application/json' };
      if (tok) headers['Authorization'] = 'Bearer ' + tok;
      dbToast('Clearing logs from DB…', 'saving');
      // Try bulk clear endpoint first
      fetch('/api/logs/all', { method: 'DELETE', headers: headers })
        .catch(function () {
          return fetch('/api/logs', { method: 'GET', headers: headers })
            .then(function (r) { return r.json(); })
            .then(function (logs) {
              return Promise.all((logs || []).map(function (l) {
                return fetch('/api/logs/' + l._id, { method: 'DELETE', headers: headers });
              }));
            });
        })
        .finally(function () {
          DB.set('logs', []);
          _logData = [];
          _logCursor = null;
          _logHasMore = false;
          _logTotal = 0;
          renderLogs();
          addLog('Logs Cleared', 'All logs cleared from DB');
          closeModalBg('m-dc-confirm');
          dbToast('All logs cleared', 'success', 'Removed from Database + cache');
        });
    });
  };
  openModal_('m-dc-confirm');
}
var clrl = clearAllLogs;

function exportLogs() {
  var logs = _logData;
  downloadCSV(
    [['Role', 'User', 'Action', 'Details', 'Timestamp']].concat(
      logs.map(function (l) { return [l.role, l.userName, l.action, l.details, l.timestamp]; })
    ), 'Activity_Logs'
  );
}
var elogs = exportLogs;
var rl = renderLogs;

// ─── ANALYTICS & REPORTS ──────────────────────────────────────────────────────
function initAdminReports() {
  // Set default date range to last 30 days
  var today = new Date();
  var thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(today.getDate() - 30);

  var todayStr = today.toISOString().split('T')[0];
  var thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

  ['ard-fr', 'aro-fr', 'arstu-fr'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = thirtyDaysAgoStr;
  });
  ['ard-to', 'aro-to', 'arstu-to'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = todayStr;
  });

  // Populate department dropdowns
  var depts = DB.get('depts') || [];
  ['ars-dept', 'ars-o-dept', 'arstu-dept'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) {
      el.innerHTML = '<option value="">All Departments</option>'
        + depts.map(function (d) { return '<option value="' + d._id + '">' + d.name + '</option>'; }).join('');
    }
  });

  // Generate the initial report
  genDeptRpt();
}

function arTab(tabName) {
  var tabs = ['dept', 'overall', 'student'];
  tabs.forEach(function (t) {
    var el = document.getElementById('rpt-' + t);
    if (el) el.style.display = (t === tabName) ? 'block' : 'none';
  });

  // Update active tab buttons
  var btnContainer = document.querySelector('.rep-tab-bar');
  if (btnContainer) {
    var buttons = btnContainer.querySelectorAll('.rtab');
    buttons.forEach(function (btn) {
      var onclickVal = btn.getAttribute('onclick') || '';
      btn.classList.toggle('act', onclickVal.indexOf("'" + tabName + "'") !== -1 || onclickVal.indexOf('"' + tabName + '"') !== -1);
    });
  }

  // Generate the active tab report
  if (tabName === 'dept') genDeptRpt();
  else if (tabName === 'overall') genOverallRpt();
  else if (tabName === 'student') genStuRpt();
}

function genDeptRpt() {
  var deptId = document.getElementById('ars-dept') ? document.getElementById('ars-dept').value : '';
  var from = document.getElementById('ard-fr') ? document.getElementById('ard-fr').value : '';
  var to = document.getElementById('ard-to') ? document.getElementById('ard-to').value : '';
  var tbody = document.getElementById('arb-dept');
  if (!tbody) return;

  if (!from || !to) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--tdi);">'
      + '<span style="font-size:38px;display:block;margin-bottom:10px;">📅</span>'
      + '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">Select a date range to generate the report.</div>'
      + '<div style="font-size:12px;color:var(--tdi);">Use the date pickers above to filter by date range.</div>'
      + '</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">⏳ Loading report data...</td></tr>';

  var url = '/attendance?';
  if (from) url += 'from=' + encodeURIComponent(from) + '&';
  if (to) url += 'to=' + encodeURIComponent(to) + '&';

  apiCall('GET', url).then(function (attendance) {
    attendance = Array.isArray(attendance) ? attendance : [];
    var classes = DB.get('classes') || [];

    var filtered = attendance.filter(function (att) {
      if (!deptId) return true;
      var cls = classes.find(function (c) { return c._id === att.classId; });
      return cls && cls.deptId === deptId;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--tdi);">'
        + '<span style="font-size:38px;display:block;margin-bottom:10px;">📊</span>'
        + '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">No attendance records found.</div>'
        + '<div style="font-size:12px;color:var(--tdi);">Try selecting a different department or date range.</div>'
        + '</td></tr>';
      return;
    }

    // Group by classId + subjectId
    var groups = {};
    filtered.forEach(function (att) {
      var cls = classes.find(function (c) { return c._id === att.classId; });
      var key = att.classId + '_' + att.subjectId;
      if (!groups[key]) {
        groups[key] = {
          className: att.className || '—',
          subjectName: att.subjectName || '—',
          deptName: (cls && cls.deptName) || '—',
          totalPresent: 0,
          totalAbsent: 0,
          sessions: 0
        };
      }
      groups[key].totalPresent += (att.totalPresent || 0);
      groups[key].totalAbsent += (att.totalAbsent || 0);
      groups[key].sessions += 1;
    });

    var rowsHtml = Object.keys(groups).map(function (key, index) {
      var g = groups[key];
      var total = g.totalPresent + g.totalAbsent;
      var pct = total > 0 ? ((g.totalPresent / total) * 100).toFixed(1) : '0.0';
      return '<tr>'
        + '<td>' + (index + 1) + '</td>'
        + '<td>' + g.className + '</td>'
        + '<td>' + g.subjectName + '</td>'
        + '<td>' + g.deptName + '</td>'
        + '<td>' + g.sessions + '</td>'
        + '<td>' + g.totalPresent + '</td>'
        + '<td>' + g.totalAbsent + '</td>'
        + '<td class="b" style="color: ' + (parseFloat(pct) >= 75 ? 'var(--gD)' : 'var(--red)') + '">' + pct + '%</td>'
        + '</tr>';
    }).join('');

    tbody.innerHTML = rowsHtml;
  }).catch(function (err) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--red);">Error loading report: ' + (err.message || 'unknown error') + '</td></tr>';
  });
}

function genOverallRpt() {
  var deptId = document.getElementById('ars-o-dept') ? document.getElementById('ars-o-dept').value : '';
  var from = document.getElementById('aro-fr') ? document.getElementById('aro-fr').value : '';
  var to = document.getElementById('aro-to') ? document.getElementById('aro-to').value : '';
  var tbody = document.getElementById('arb-overall');
  if (!tbody) return;

  if (!from || !to) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--tdi);">'
      + '<span style="font-size:38px;display:block;margin-bottom:10px;">📅</span>'
      + '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">Select a date range to generate the report.</div>'
      + '<div style="font-size:12px;color:var(--tdi);">Use the date pickers above to filter by date range.</div>'
      + '</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">⏳ Loading report data...</td></tr>';

  var url = '/attendance?';
  if (from) url += 'from=' + encodeURIComponent(from) + '&';
  if (to) url += 'to=' + encodeURIComponent(to) + '&';

  apiCall('GET', url).then(function (attendance) {
    attendance = Array.isArray(attendance) ? attendance : [];

    var depts = DB.get('depts') || [];
    var classes = DB.get('classes') || [];
    var students = DB.get('students') || [];

    // Group by department
    var deptGroups = {};
    depts.forEach(function (d) {
      if (deptId && d._id !== deptId) return;
      deptGroups[d._id] = {
        name: d.name,
        classCount: 0,
        studentCount: 0,
        totalPresent: 0,
        totalAbsent: 0,
        recordCount: 0
      };
    });

    classes.forEach(function (c) {
      if (deptGroups[c.deptId]) {
        deptGroups[c.deptId].classCount++;
      }
    });

    students.forEach(function (s) {
      if (deptGroups[s.deptId]) {
        deptGroups[s.deptId].studentCount++;
      }
    });

    attendance.forEach(function (att) {
      var cls = classes.find(function (c) { return c._id === att.classId; });
      if (cls && deptGroups[cls.deptId]) {
        var dg = deptGroups[cls.deptId];
        dg.totalPresent += (att.totalPresent || 0);
        dg.totalAbsent += (att.totalAbsent || 0);
        dg.recordCount += (att.records ? att.records.length : 0);
      }
    });

    var activeDepts = Object.keys(deptGroups);
    if (activeDepts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--tdi);">'
        + '<span style="font-size:38px;display:block;margin-bottom:10px;">📊</span>'
        + '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">No departments found or matches.</div>'
        + '</td></tr>';
      return;
    }

    var rowsHtml = activeDepts.map(function (id, index) {
      var dg = deptGroups[id];
      var total = dg.totalPresent + dg.totalAbsent;
      var pct = total > 0 ? ((dg.totalPresent / total) * 100).toFixed(1) : '0.0';
      return '<tr>'
        + '<td>' + (index + 1) + '</td>'
        + '<td class="b">' + dg.name + '</td>'
        + '<td>' + dg.classCount + '</td>'
        + '<td>' + dg.studentCount + '</td>'
        + '<td>' + dg.recordCount + '</td>'
        + '<td>' + dg.totalPresent + '</td>'
        + '<td>' + dg.totalAbsent + '</td>'
        + '<td class="b" style="color: ' + (parseFloat(pct) >= 75 ? 'var(--gD)' : 'var(--red)') + '">' + pct + '%</td>'
        + '</tr>';
    }).join('');

    tbody.innerHTML = rowsHtml;
  }).catch(function (err) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--red);">Error loading report: ' + (err.message || 'unknown error') + '</td></tr>';
  });
}

function genStuRpt() {
  var deptId = document.getElementById('arstu-dept') ? document.getElementById('arstu-dept').value : '';
  var from = document.getElementById('arstu-fr') ? document.getElementById('arstu-fr').value : '';
  var to = document.getElementById('arstu-to') ? document.getElementById('arstu-to').value : '';
  var tbody = document.getElementById('arb-student');
  if (!tbody) return;

  if (!from || !to) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:36px;color:var(--tdi);">'
      + '<span style="font-size:38px;display:block;margin-bottom:10px;">📅</span>'
      + '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">Select a date range to generate the report.</div>'
      + '<div style="font-size:12px;color:var(--tdi);">Use the date pickers above to filter by date range.</div>'
      + '</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--tdi);">⏳ Loading report data...</td></tr>';

  var url = '/attendance?';
  if (from) url += 'from=' + encodeURIComponent(from) + '&';
  if (to) url += 'to=' + encodeURIComponent(to) + '&';

  apiCall('GET', url).then(function (attendance) {
    attendance = Array.isArray(attendance) ? attendance : [];
    var students = DB.get('students') || [];
    if (deptId) {
      students = students.filter(function (s) { return s.deptId === deptId; });
    }

    if (students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:36px;color:var(--tdi);">'
        + '<span style="font-size:38px;display:block;margin-bottom:10px;">👨‍🎓</span>'
        + '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">No students found.</div>'
        + '</td></tr>';
      return;
    }

    var studentStats = {};
    students.forEach(function (s) {
      studentStats[s.regNo] = {
        name: s.name,
        regNo: s.regNo,
        deptName: s.deptName || '—',
        present: 0,
        absent: 0
      };
    });

    attendance.forEach(function (att) {
      if (Array.isArray(att.records)) {
        att.records.forEach(function (rec) {
          if (studentStats[rec.regNo]) {
            if (rec.status === 'present') studentStats[rec.regNo].present++;
            else if (rec.status === 'absent') studentStats[rec.regNo].absent++;
          }
        });
      }
    });

    var rowsHtml = students.map(function (s, index) {
      var stat = studentStats[s.regNo];
      var total = stat.present + stat.absent;
      var pct = total > 0 ? ((stat.present / total) * 100).toFixed(1) : '0.0';
      return '<tr>'
        + '<td>' + (index + 1) + '</td>'
        + '<td class="b">' + stat.name + '</td>'
        + '<td>' + stat.regNo + '</td>'
        + '<td>' + stat.deptName + '</td>'
        + '<td class="b" style="color: ' + (parseFloat(pct) >= 75 ? 'var(--gD)' : 'var(--red)') + '">' + pct + '%</td>'
        + '</tr>';
    }).join('');

    tbody.innerHTML = rowsHtml;
  }).catch(function (err) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--red);">Error loading report: ' + (err.message || 'unknown error') + '</td></tr>';
  });
}

function expAdminRpt(type, format) {
  var activeTab = 'dept';
  if (document.getElementById('rpt-overall') && document.getElementById('rpt-overall').style.display !== 'none') activeTab = 'overall';
  else if (document.getElementById('rpt-student') && document.getElementById('rpt-student').style.display !== 'none') activeTab = 'student';

  var tableBodyEl = document.getElementById('arb-' + activeTab);
  if (!tableBodyEl) return;

  var headers = [];
  var rows = [];

  var headerSelector = '#pg-reports #rpt-' + activeTab + ' table thead tr th';
  document.querySelectorAll(headerSelector).forEach(function (th) {
    headers.push(th.textContent.trim());
  });

  tableBodyEl.querySelectorAll('tr').forEach(function (tr) {
    var row = [];
    tr.querySelectorAll('td').forEach(function (td) {
      row.push(td.textContent.trim());
    });
    if (row.length > 0) rows.push(row);
  });

  if (rows.length === 0 || (rows.length === 1 && rows[0][0].indexOf('No') === 0 || rows[0][0].indexOf('⏳') === 0)) {
    showToast('No data to export', 'warn');
    return;
  }

  var allData = [headers].concat(rows);
  var fileName = 'Attendance_Report_' + activeTab + '_' + new Date().toISOString().split('T')[0];

  if (format === 'csv') {
    downloadCSV(allData, fileName);
  } else if (format === 'xlsx') {
    if (typeof XLSX === 'undefined') {
      showToast('XLSX library not loaded yet', 'warn');
      return;
    }
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(allData);
    XLSX.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, fileName + ".xlsx");
  }
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function initDash() {
  // FAST PATH — runs immediately from cached data
  dbToast('Fetching Data, please wait', 'saving');
  populateChartFilters();
  renderNotificationsMain();
  renderActivityFeed();
  renderSystemHealth();
  apiCall('GET', '/settings/maintenance').then(function (d) {
    var badge = document.getElementById('sb-maint-badge');
    if (badge) badge.style.display = (d && d.active) ? 'inline-flex' : 'none';
  }).catch(function () { });
  // DEFERRED PATH — runs after shell paints
  requestAnimationFrame(function () {
    setTimeout(function () {
      renderDeferredDashboard().then(function () {
        dbToast('Fetched data successfully', 'success');
      }).catch(function (err) {
        console.error(err);
        dbToast('Dashboard loaded', 'success');
      });
    }, 50);
  });
}
function shiftToMenu(fun1, fun2) {
  om(fun1);
  nav(fun2);
}

function syncBadgesFromAPI() {
  syncCountsFromAPI();
}

// ─── DEFERRED DASHBOARD HELPERS ──────────────────────────────────────────────
function fetchWithTimeout(url, timeoutMs, headers) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  return fetch(url, { headers: headers, signal: controller.signal })
    .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .catch(function (err) { clearTimeout(timer); throw err; });
}

function showWidgetRetry(containerId, label) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tdi);font-size:12px;">'
    + '⚠️ ' + label + ' failed to load. '
    + '<button onclick="retryDeferredWidget(\'' + containerId + '\',\'' + label + '\')" style="background:var(--gD);color:#fff;border:none;border-radius:6px;padding:5px 14px;font-size:11px;font-weight:600;cursor:pointer;font-family:Poppins,sans-serif;margin-left:8px;">Retry</button>'
    + '</div>';
}

var _deferredWidgetRetries = {};

function retryDeferredWidget(containerId, label) {
  if (_deferredWidgetRetries[containerId]) return;
  _deferredWidgetRetries[containerId] = true;
  var el = document.getElementById(containerId);
  if (el) el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tdi);font-size:12px;">⏳ Loading ' + label + '…</div>';
  renderDeferredDashboard();
}

function renderDeferredDashboard() {
  var tok = getToken();
  if (!tok) return Promise.resolve();
  var h = { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' };

  var params = [];
  var deptVal = document.getElementById('f-dept');
  if (deptVal && deptVal.value) params.push('deptId=' + encodeURIComponent(deptVal.value));
  var classVal = document.getElementById('f-class');
  if (classVal && classVal.value) params.push('classId=' + encodeURIComponent(classVal.value));
  var fromVal = document.getElementById('f-from');
  if (fromVal && fromVal.value) params.push('from=' + encodeURIComponent(fromVal.value));
  var toVal = document.getElementById('f-to');
  if (toVal && toVal.value) params.push('to=' + encodeURIComponent(toVal.value));
  var dateVal = document.getElementById('f-date');
  if (dateVal && dateVal.value) params.push('date=' + encodeURIComponent(dateVal.value));
  params.push('reportType=' + (reportType || 'overall'));
  var qs = params.join('&');

  var pending = [];

  // Attendance overview — timeboxed 8s
  if (!_deferredWidgetRetries['bar-chart']) {
    pending.push(fetchWithTimeout('/api/dashboard/attendance-overview?' + qs, 8000, h)
      .then(function (data) {
        renderBars(data.chartItems || []);
        var csP = document.getElementById('cs-present');
        var csA = document.getElementById('cs-absent');
        var csPct = document.getElementById('cs-pct');
        if (csP) csP.textContent = data.summary && data.summary.present !== undefined ? data.summary.present : '—';
        if (csA) csA.textContent = data.summary && data.summary.absent !== undefined ? data.summary.absent : '—';
        if (csPct) csPct.textContent = data.summary && data.summary.pct !== undefined ? data.summary.pct : '—%';
      }).catch(function () {
        showWidgetRetry('bar-chart', 'Attendance chart');
      }));
  }

  // Defaulters — timeboxed 8s
  if (!_deferredWidgetRetries['def-list']) {
    pending.push(fetchWithTimeout('/api/dashboard/defaulters', 8000, h)
      .then(function (data) {
        var list = Array.isArray(data) ? data : [];
        document.getElementById('def-total-label').textContent = list.length + ' student' + (list.length !== 1 ? 's' : '');
        var listEl = document.getElementById('def-list');
        if (!list.length) {
          listEl.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,.5);font-size:12px;">🎉 No defaulters</div>';
          return;
        }
        listEl.innerHTML = list.slice(0, 6).map(function (s) {
          return '<div class="def-item">'
            + '<div class="def-av">' + (s.name ? s.name[0] : '?') + '</div>'
            + '<div style="flex:1;min-width:0;">'
            + '<div class="def-name">' + s.name + '</div>'
            + '<div class="def-cls">' + (s.className || '—') + '</div>'
            + '</div>'
            + '<div class="def-pct-badge">' + s.pct + '%</div>'
            + '</div>';
        }).join('');
        window._defaultersFullList = list;
      }).catch(function () {
        showWidgetRetry('def-list', 'Defaulters');
      }));
  }

  // Unmarked teachers — timeboxed 8s (existing endpoint)
  if (!_deferredWidgetRetries['unmarked-list']) {
    pending.push(fetchWithTimeout('/api/attendance/unmarked-teachers', 8000, h)
      .then(function (data) {
        var list = Array.isArray(data) ? data : [];
        var badge = document.getElementById('unmarked-count-badge');
        if (badge) badge.textContent = list.length + ' pending';
        var listEl = document.getElementById('unmarked-list');
        if (!list.length) {
          listEl.innerHTML = '<div class="empty-state"><span class="ei">✅</span><p>All teachers marked attendance this week</p></div>';
          return;
        }
        listEl.innerHTML = list.map(function (item) {
          var daysString = (item.missingDays || []).map(function (d) { return formatDate(d); }).join(', ');
          var dayLabel = item.missingCount > 1 ? 'days' : 'day';
          return '<div class="unm-item">'
            + '<div class="unm-av">⚠️</div>'
            + '<div class="unm-info">'
            + '<div class="unm-name">' + (item.teacherName || '—') + '</div>'
            + '<div class="unm-sub">' + (item.subjectName || '') + ' · ' + (item.className || '') + '</div>'
            + '<div class="unm-meta">Missing: ' + daysString + ' (' + item.missingCount + ' ' + dayLabel + ')</div>'
            + '</div>'
            + '<button class="notify-btn" onclick="openNotifyModal(\'' + (item.teacherId || '') + '\',\'' + (item.teacherName || '') + '\',\'' + (item.subjectName || '') + '\',\'' + (item.className || '') + '\')">📢 Notify</button>'
            + '</div>';
        }).join('');
      }).catch(function () {
        showWidgetRetry('unmarked-list', 'Unmarked teachers');
      }));
  }

  return Promise.all(pending);
}

// ─── BAR CHART ───────────────────────────────────────────────────────────────
var reportType = 'overall';

function setReportType(type) {
  reportType = type;
  document.getElementById('rp-overall').classList.toggle('act', type === 'overall');
  document.getElementById('rp-specific').classList.toggle('act', type === 'specific');
  document.getElementById('date-overall-row').style.display = type === 'overall' ? 'flex' : 'none';
  document.getElementById('date-specific-row').style.display = type === 'specific' ? 'flex' : 'none';
  onFilterChange();
}

function setWeekRange(rangeType) {
  var today = new Date();
  var fromDate, toDate;

  if (rangeType === 'this') {
    var dayOfWeek = today.getDay();
    var monday = new Date(today);
    monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
    fromDate = monday.toISOString().split('T')[0];
    toDate = new Date(today).toISOString().split('T')[0];
  } else if (rangeType === 'last') {
    var dayOfWeek2 = today.getDay();
    var lastMon = new Date(today);
    lastMon.setDate(today.getDate() - ((dayOfWeek2 + 6) % 7) - 7);
    var lastFri = new Date(lastMon);
    lastFri.setDate(lastMon.getDate() + 4);
    fromDate = lastMon.toISOString().split('T')[0];
    toDate = lastFri.toISOString().split('T')[0];
  } else {
    // 'month'
    fromDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    toDate = today.toISOString().split('T')[0];
  }

  document.getElementById('f-from').value = fromDate;
  document.getElementById('f-to').value = toDate;
  onFilterChange();
}

function onFilterChange() {
  var selectedDept = document.getElementById('f-dept').value;
  var allClasses = DB.get('classes').filter(function (c) {
    return !selectedDept || c.deptId === selectedDept;
  });

  // Refresh the class dropdown while preserving the current selection
  var classDropdown = document.getElementById('f-class');
  var currentClassId = classDropdown.value;
  classDropdown.innerHTML = '<option value="">All</option>'
    + allClasses.map(function (c) {
      return '<option value="' + c._id + '"' + (c._id === currentClassId ? ' selected' : '') + '>' + c.name + '</option>';
    }).join('');

  renderDeferredDashboard();
}

function buildBarChart() {
  renderDeferredDashboard();
}

function renderBars(items) {
  var wrapper = document.getElementById('bar-chart');
  if (!items.length) {
    wrapper.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--tdi);font-size:12px;">No data for selected filters</div>';
    return;
  }

  var topIndex = items.reduce(function (maxIdx, item, idx) {
    return item.pct > items[maxIdx].pct ? idx : maxIdx;
  }, 0);

  wrapper.innerHTML = items.map(function (item, index) {
    var barHeight = item.total > 0 ? Math.max(20, Math.round((item.pct / 100) * 130)) : 14;
    var barClass = 'bar-pill ';
    if (item.type === 'weekend' || item.type === 'nodata') barClass += 'striped';
    else if (item.type === 'high') barClass += 'solid-dark';
    else if (item.type === 'mid') barClass += 'solid-light';
    else barClass += 'absent';

    var pctLabel = (index === topIndex && item.total > 0) ? '<div class="bar-pct-label">' + item.pct + '%</div>' : '';
    var titleAttr = item.total > 0 ? ' title="' + (item.full || item.label) + ': ' + item.present + 'P / ' + item.absent + 'A (' + item.pct + '%)"' : '';
    var todayClass = item.isToday ? ' today' : '';

    return '<div class="bar-col">'
      + '<div class="bar-outer">' + pctLabel
      + '<div class="' + barClass + '" style="height:' + barHeight + 'px;"' + titleAttr + '></div></div>'
      + '<div class="bar-day' + todayClass + '">' + item.label + '</div>'
      + '</div>';
  }).join('');
}

// ─── GAUGE ───────────────────────────────────────────────────────────────────
function updateGauge() {
  // Gauge now populated via deferred API data
}

// ─── NOTIFICATIONS ───────────────────────────────────────────────────────────
function renderNotificationsMain() {
  var notifications = DB.get('notifications').slice().reverse();
  var unreadCount = notifications.filter(function (n) { return !n.read; }).length;

  document.getElementById('notif-count-badge').textContent = unreadCount + ' new';
  var badge = document.getElementById('notif-badge-count');
  badge.textContent = unreadCount;
  badge.style.display = unreadCount ? 'flex' : 'none';

  var listEl = document.getElementById('notif-list-main');
  if (!notifications.length) {
    listEl.innerHTML = '<div class="empty-state"><span class="ei">🎉</span><p>No notifications</p></div>';
    return;
  }

  listEl.innerHTML = notifications.slice(0, 8).map(function (n) {
    var isGrievance = n.message && n.message.startsWith('[Grievance]');
    var isSolved = n.status === 'Solved';
    var isCancelled = n.status === 'Cancelled';
    var icon = n.type === 'error' ? '❌' : (isGrievance ? '📣' : '📩');
    var tagClass = isSolved ? 'notif-tag-req' : (n.type === 'error' ? 'notif-tag-err' : 'notif-tag-req');
    var statusBadge = isSolved
      ? '<span style="background:#e8f5e9;color:var(--gD);font-size:9px;font-weight:700;padding:2px 7px;border-radius:8px;border:1px solid var(--gLr);">✅ Solved</span>'
      : isCancelled
        ? '<span style="background:#fef2f2;color:#dc2626;font-size:9px;font-weight:700;padding:2px 7px;border-radius:8px;border:1px solid rgba(239,68,68,.2);">❌ Cancelled</span>'
        : '<span style="background:#fef3c7;color:#92400e;font-size:9px;font-weight:700;padding:2px 7px;border-radius:8px;border:1px solid rgba(245,158,11,.25);">⏳ Pending</span>';
    var unreadDot = !n.read ? '<div class="notif-unread-dot"></div>' : '';
    var highlight = !n.read ? 'highlight-notif' : '';

    var actionBtns = (!isSolved && !isCancelled)
      ? '<div style="display:flex;gap:6px;margin-top:7px;">'
      + '<button onclick="event.stopPropagation();solveNotification(\'' + n._id + '\')" style="flex:1;padding:4px 0;background:var(--gD);color:#fff;border:none;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;font-family:Poppins,sans-serif;">✅ Solve</button>'
      + '<button onclick="event.stopPropagation();cancelNotification(\'' + n._id + '\')" style="flex:1;padding:4px 0;background:#fff;color:#dc2626;border:1.5px solid rgba(239,68,68,.3);border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;font-family:Poppins,sans-serif;">❌ Cancel</button>'
      + '</div>'
      : '';

    return '<div class="notif-item ' + highlight + '" onclick="markNotificationRead(\'' + n._id + '\')">'
      + '<div class="notif-icon-row">'
      + '<div class="notif-ic ' + (n.type === 'error' ? 'error' : 'request') + '">' + icon + '</div>'
      + '<div class="notif-from">' + n.from + '</div>'
      + statusBadge + unreadDot
      + '</div>'
      + '<div class="notif-msg">' + n.message + '</div>'
      + '<div class="notif-time">' + timeAgo(n.time) + '</div>'
      + actionBtns
      + '</div>';
  }).join('');
}

function renderNotificationDropdown() {
  var notifications = DB.get('notifications').slice().reverse();
  var listEl = document.getElementById('nd-list');

  if (!notifications.length) {
    listEl.innerHTML = '<div class="nd-empty">No notifications</div>';
    return;
  }

  listEl.innerHTML = notifications.slice(0, 8).map(function (n) {
    var isSolved = n.status === 'Solved';
    var isCancelled = n.status === 'Cancelled';
    var unreadDot = !n.read ? '<div style="width:7px;height:7px;border-radius:50%;background:var(--blue);display:inline-block;margin-left:3px;vertical-align:middle;"></div>' : '';
    var tagClass = n.type === 'error' ? 'notif-tag-err' : 'notif-tag-req';
    var statusChip = isSolved
      ? '<span style="font-size:9px;color:var(--gD);font-weight:700;">✅</span>'
      : isCancelled
        ? '<span style="font-size:9px;color:#dc2626;font-weight:700;">❌</span>'
        : '<span style="font-size:9px;color:#92400e;font-weight:700;">⏳</span>';
    return '<div class="nd-item' + (!n.read ? ' unread' : '') + '" onclick="markNotificationRead(\'' + n._id + '\');toggleNotificationDropdown()">'
      + '<div style="font-size:20px;flex-shrink:0;">' + (n.type === 'error' ? '❌' : '📩') + '</div>'
      + '<div style="flex:1;min-width:0;">'
      + '<div class="nd-from">' + n.from + unreadDot + statusChip + '<span class="' + tagClass + '" style="margin-left:auto;">' + n.type + '</span></div>'
      + '<div class="nd-msg">' + n.message + '</div>'
      + '<div class="nd-tm">' + timeAgo(n.time) + '</div>'
      + '</div></div>';
  }).join('');
}

function renderNotificationsAll() {
  var notifications = DB.get('notifications').slice().reverse();
  var listEl = document.getElementById('notif-all-list');

  if (!notifications.length) {
    listEl.innerHTML = '<div class="empty-state"><span class="ei">🎉</span><p>No notifications</p></div>';
    return;
  }

  listEl.innerHTML = notifications.map(function (n) {
    var isSolved = n.status === 'Solved';
    var isCancelled = n.status === 'Cancelled';
    var tagClass = n.type === 'error' ? 'notif-tag-err' : 'notif-tag-req';
    var unreadDot = !n.read ? '<div style="width:7px;height:7px;border-radius:50%;background:var(--blue);display:inline-block;margin-left:4px;"></div>' : '';
    var statusChip = isSolved
      ? '<span style="background:#e8f5e9;color:var(--gD);font-size:9px;font-weight:700;padding:2px 7px;border-radius:8px;border:1px solid var(--gLr);margin-left:auto;">✅ Solved</span>'
      : isCancelled
        ? '<span style="background:#fef2f2;color:#dc2626;font-size:9px;font-weight:700;padding:2px 7px;border-radius:8px;border:1px solid rgba(239,68,68,.2);margin-left:auto;">❌ Cancelled</span>'
        : '<span style="background:#fef3c7;color:#92400e;font-size:9px;font-weight:700;padding:2px 7px;border-radius:8px;border:1px solid rgba(245,158,11,.25);margin-left:auto;">⏳ Pending</span>';
    var actionBtns = (!isSolved && !isCancelled)
      ? '<div style="display:flex;gap:6px;margin-top:8px;">'
      + '<button class="btn-pri bxs" onclick="event.stopPropagation();solveNotification(\'' + n._id + '\');renderNotificationsAll()">✅ Solve</button>'
      + '<button class="btn bout bxs" style="color:#dc2626;border-color:rgba(239,68,68,.3);" onclick="event.stopPropagation();cancelNotification(\'' + n._id + '\');renderNotificationsAll()">❌ Cancel</button>'
      + '</div>'
      : '';

    return '<div class="m-item" onclick="markNotificationRead(\'' + n._id + '\')">'
      + '<div class="m-ic" style="background:' + (n.type === 'error' ? 'rgba(239,68,68,.08)' : 'rgba(245,158,11,.08)') + '">' + (n.type === 'error' ? '❌' : '📩') + '</div>'
      + '<div class="m-body" style="flex:1;">'
      + '<div class="m-name" style="display:flex;align-items:center;gap:7px;">' + n.from
      + '<span class="' + tagClass + '">' + n.type + '</span>' + unreadDot + statusChip + '</div>'
      + '<div class="m-sub">' + n.message + '</div>'
      + '<div style="font-size:10px;color:var(--tdi);margin-top:3px;">' + new Date(n.time).toLocaleString('en-IN') + '</div>'
      + actionBtns
      + '</div></div>';
  }).join('');
}

function markNotificationRead(id) {
  DB.update('notifications', id, { read: true });
  renderNotificationsMain();
  renderNotificationDropdown();
}
var markNotifRead = markNotificationRead; // alias for HTML

function clearAllNotifications() {
  DB.get('notifications').forEach(function (n) {
    DB.update('notifications', n._id, { read: true });
  });
  renderNotificationsMain();
  renderNotificationDropdown();
  document.getElementById('notif-drop').classList.remove('open');
  showToast('✅ All marked as read');
}
var clearAllNotifs = clearAllNotifications;

function approveRequest(id) {
  var notification = DB.get('notifications').find(function (x) { return x._id === id; });
  DB.update('notifications', id, { read: true, approved: true, status: 'Solved', solvedAt: new Date().toISOString() });
  if (notification && notification.grievanceId) {
    DB.update('teacher-grievances', notification.grievanceId, { status: 'Resolved', resolvedAt: new Date().toISOString() });
  }
  addLog('Request Approved', 'Approved request from ' + (notification ? notification.from : 'teacher'));
  renderNotificationsAll();
  renderNotificationsMain();
  dbToast('✅ Request approved!', 'success');
}

function solveNotification(id) {
  var n = DB.get('notifications').find(function (x) { return x._id === id; });
  if (!n) return;
  DB.update('notifications', id, { read: true, status: 'Solved', solvedAt: new Date().toISOString() });

  if (n.grievanceId) {
    DB.update('teacher-grievances', n.grievanceId, { status: 'Resolved', resolvedAt: new Date().toISOString(), resolvedBy: 'Admin' });
  }
  addLog('Notification Solved', 'Admin resolved notification from ' + (n.from || 'teacher'));
  renderNotificationsMain();
  renderNotificationDropdown();
  dbToast('✅ Marked as Solved — teacher portal updated', 'success');
}

function cancelNotification(id) {
  var n = DB.get('notifications').find(function (x) { return x._id === id; });
  if (!n) return;
  DB.update('notifications', id, { read: true, status: 'Cancelled', cancelledAt: new Date().toISOString() });
  if (n.grievanceId) {
    DB.update('teacher-grievances', n.grievanceId, { status: 'Cancelled', cancelledAt: new Date().toISOString() });
  }
  addLog('Notification Cancelled', 'Admin dismissed notification from ' + (n.from || 'teacher'));
  renderNotificationsMain();
  renderNotificationDropdown();
  showToast('❌ Notification cancelled');
}

function toggleNotificationDropdown() {
  var dropdown = document.getElementById('notif-drop');
  dropdown.classList.toggle('open');
  if (dropdown.classList.contains('open')) renderNotificationDropdown();
}
var toggleNotifDrop = toggleNotificationDropdown;

document.addEventListener('click', function (e) {
  var dropdown = document.getElementById('notif-drop');
  if (dropdown && !dropdown.contains(e.target) && !e.target.closest('.tb-icon')) {
    dropdown.classList.remove('open');
  }
});



// ─── UNMARKED TEACHERS ───────────────────────────────────────────────────────
function getUnmarked() {
  var assignments = DB.get('assignments');
  var attendance = DB.get('attendance');
  var weekDates = thisWeek();
  var unmarkedList = [];

  assignments.forEach(function (assignment) {
    var markedRecords = attendance.filter(function (a) {
      return a.classId === assignment.classId
        && a.subjectId === assignment.subjectId
        && weekDates.includes(a.date);
    });
    var markedDays = new Set(markedRecords.map(function (a) { return a.date; }));
    var missingDays = weekDates.filter(function (d) { return !markedDays.has(d); });

    if (missingDays.length > 0) {
      unmarkedList.push(Object.assign({}, assignment, {
        missingDays: missingDays,
        missingCount: missingDays.length
      }));
    }
  });

  return unmarkedList;
}

function renderUnmarkedTeachers() {
  // Replaced by deferred API path
}
var renderUnmarked = renderUnmarkedTeachers; // alias

var notifyTarget = null;

function openNotifyModal(teacherId, teacherName, subjectName, className) {
  notifyTarget = { tid: teacherId, tname: teacherName };
  document.getElementById('notify-sub').textContent = 'To: ' + teacherName;
  document.getElementById('notify-msg').value =
    'Dear ' + teacherName + ',\n\nThis is a reminder to mark attendance for '
    + subjectName + ' (' + className + ') for the missing days this week.\n\nRegards,\nAdministrator';
  openModal_('m-notify');
}

function sendNotification() {
  var message = document.getElementById('notify-msg').value.trim();
  var priority = document.getElementById('notify-priority').value;
  if (!message) { showToast('Please enter a message', 'warn'); return; }
  if (!notifyTarget) { closeModalBg('m-notify'); return; }

  DB.insert('teacher-notifications', {
    toTeacherId: notifyTarget.tid,
    toTeacherName: notifyTarget.tname,
    from: 'Administrator',
    message: message,
    priority: priority,
    type: 'attendance-alert',
    time: new Date().toISOString(),
    read: false
  });

  addLog('Notification Sent', 'Attendance reminder (' + priority + ') sent to ' + notifyTarget.tname);
  closeModalBg('m-notify');
  dbToast('Reminder sent to ' + notifyTarget.tname + '!', 'success');
  notifyTarget = null;
}

// ─── ACTIVITY FEED ───────────────────────────────────────────────────────────
var AVATAR_COLORS = ['#388e3c', '#3b82f6', '#8b5cf6', '#f59e0b', '#0891b2', '#ef4444'];

function renderActivityFeed() {
  var recentLogs = DB.get('logs').slice().reverse().slice(0, 6);
  var listEl = document.getElementById('activity-list');

  if (!recentLogs.length) {
    listEl.innerHTML = '<div class="empty-state"><span class="ei">📋</span><p>No activity yet</p></div>';
    return;
  }

  var badgeMap = {
    'Login': 'ab-green',
    'Student Added': 'ab-blue',
    'Teacher Added': 'ab-blue',
    'Notification Sent': 'ab-amber',
    'Attendance Marked': 'ab-green',
    'Logs Cleared': 'ab-red'
  };

  listEl.innerHTML = recentLogs.map(function (log, index) {
    var color = AVATAR_COLORS[index % AVATAR_COLORS.length];
    var badge = badgeMap[log.action] || 'ab-green';
    return '<div class="activity-item">'
      + '<div class="act-av" style="background:' + color + '">' + ((log.userName || '?')[0] || '?').toUpperCase() + '</div>'
      + '<div class="act-body">'
      + '<div class="act-name">' + log.userName + '</div>'
      + '<div class="act-task">Working on <b>' + log.action + '</b> — ' + log.details + '</div>'
      + '</div>'
      + '<div class="act-badge ' + badge + '">' + log.action + '</div>'
      + '</div>';
  }).join('');
}
var renderActivity = renderActivityFeed; // alias

// ─── DEFAULTERS ──────────────────────────────────────────────────────────────
function renderDefaulters(showFull) {
  // Replaced by deferred API path
}

function downloadDefaulters() {
  var list = window._defaultersFullList || [];
  if (!list.length) { showToast('No defaulter data to download'); return; }
  downloadCSV(
    [['Name', 'Reg No', 'Class', 'Dept', 'Attendance%']].concat(
      list.map(function (s) { return [s.name, s.regNo, s.className || '', s.deptName || '', s.pct + '%']; })
    ),
    'Defaulters'
  );
  showToast('⬇️ Downloaded!');
}

// ─── SYSTEM HEALTH CARD ──────────────────────────────────────────────────────
function renderSystemHealth() {
  var studentCount = _counts.students || DB.get('students').length;
  var teacherCount = _counts.teachers || DB.get('users').filter(function (u) { return u.role === 'teacher'; }).length;

  var healthItems = [
    { icon: '👨‍🎓', bg: '#dbeafe', label: 'Total Students', value: studentCount, pill: null },
    { icon: '👩‍🏫', bg: '#ede9fe', label: 'Total Teachers', value: teacherCount, pill: null },
    { icon: '📋', bg: '#d1fae5', label: 'Attendance Records', value: '—', pill: null },
    { icon: '🖥️', bg: '#ecfdf5', label: 'Server Status', value: 'Online', pill: { text: '● Running', cls: 'sh-ok' } },
    { icon: '🗃️', bg: '#f0fdf4', label: 'Database', value: 'Connected', pill: { text: '● Active', cls: 'sh-ok' } }
  ];

  var listEl = document.getElementById('sys-health-list');
  if (!listEl) return;

  listEl.innerHTML = healthItems.map(function (item) {
    var pillHtml = item.pill
      ? '<div class="sh-pill ' + item.pill.cls + '">' + item.pill.text + '</div>' : '';
    return '<div class="sh-item">'
      + '<div class="sh-ic" style="background:' + item.bg + '">' + item.icon + '</div>'
      + '<div class="sh-body"><div class="sh-label">' + item.label + '</div><div class="sh-val">' + item.value + '</div></div>'
      + pillHtml + '</div>';
  }).join('');
}

// ─── CHART FILTER POPULATION ────────────────────────────────────────────────
function populateChartFilters() {
  var depts = DB.get('depts') || [];
  var subjects = DB.get('subjects') || [];

  document.getElementById('f-dept').innerHTML = '<option value="">All</option>'
    + depts.map(function (d) { return '<option value="' + d._id + '">' + d.name + '</option>'; }).join('');

  var years = (YEAR_CONFIG.current ? [YEAR_CONFIG.current] : []).concat(YEAR_CONFIG.batches || []);
  years = Array.from(new Set(years.filter(Boolean))).sort().reverse();
  document.getElementById('f-year').innerHTML = '<option value="">All</option>'
    + years.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('');

  document.getElementById('f-subj').innerHTML = '<option value="">All</option>'
    + subjects.map(function (s) { return '<option value="' + s._id + '">' + s.name + '</option>'; }).join('');

  setWeekRange('this');
}
var populateFilters = populateChartFilters; // alias

// ─── DEPARTMENTS PAGE ────────────────────────────────────────────────────────
function renderDepartments() {
  var depts = DB.get('depts') || [];
  var classes = DB.get('classes') || [];
  var subjects = DB.get('subjects') || [];
  var grid = document.getElementById('dg2');
  grid.className = 'tgrd';

  if (!grid) return;

  _renderDeptStats(depts);

  if (!depts.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="ei">🏛️</span>
        <p style="font-size: 13.5px;">No department found.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = depts.map(function (dept) {
    var isClassesLoaded = _loaded.classes;
    var isSubjectsLoaded = _loaded.subjects;
    var isUsersLoaded = _loaded.users;

    var deptClasses = classes.filter(function (c) { return c.deptId === dept._id; });
    var classCount = isClassesLoaded ? deptClasses.length : '⏳';
    var subjectCount = isSubjectsLoaded ? subjects.filter(function (s) { return s.deptId === dept._id; }).length : '⏳';
    var studentCount = isClassesLoaded ? deptClasses.reduce(function (sum, c) { return sum + (c.studentCount || 0); }, 0) : '⏳';
    var teacherCount = isUsersLoaded ? DB.get('users').filter(function (u) {
      return u.role === 'teacher' && (u.dept === dept.name || u.deptId === dept._id);
    }).length : '⏳';

    return '<div class="tcrd">'
      + '<div class="tav" style="font-size:28px;background:linear-gradient(135deg,var(--gM),var(--gB));">' + (dept.icon || '🏛️') + '</div>'
      + '<div class="tnm">' + dept.name + '</div>'
      + '<div class="tdp">' + dept.code + '</div>'
      + '<div class="tsts">'
      + '<div class="tst2"><span>' + classCount + '</span>Classes</div>'
      + '<div class="tst2"><span>' + subjectCount + '</span>Subjects</div>'
      + '<div class="tst2"><span>' + studentCount + '</span>Students</div>'
      + '<div class="tst2"><span>' + teacherCount + '</span>Teachers</div>'
      + '</div>'
      + '<div style="display:flex;gap:6px;margin-top:12px;justify-content:center;flex-wrap:wrap;">'
      + '<button class="btn-pri bxs" onclick="nav(\'struct\');setTimeout(function(){dtoDept(\'' + dept._id + '\')},200)">📂 Explore</button>'
      + '<button class="btn bgho bxs" onclick="editDept(\'' + dept._id + '\')">✏️ Edit</button>'
      + '<button class="btn bdan bxs" onclick="dDept(\'' + dept._id + '\')">🗑 Del</button>'
      + '</div></div>';
  }).join('');
}
var rdepts = renderDepartments; // alias
// Wrap dept mutations to auto-update badges
var _origRenderDepts = renderDepartments;
renderDepartments = function () { _origRenderDepts(); };

function editDept(deptId) {
  var dept = DB.get('depts').find(function (x) { return x._id === deptId; });
  if (!dept) return;
  document.getElementById('ed-id').value = deptId;
  document.getElementById('ed-nm').value = dept.name || '';
  document.getElementById('ed-cd').value = dept.code || '';
  document.getElementById('ed-num').value = dept.number || dept.deptNum || '';

  // Course Type + Branch
  var coEl = document.getElementById('ed-cotype');
  var brEl = document.getElementById('ed-branch');
  if (coEl) {
    coEl.value = dept.courseType || '';
    edUpdateBranch();                     // populate branch options first
    if (brEl) brEl.value = dept.branch || '';
  }

  // HoD fields — pre-fill without re-triggering lookup
  hodLookupReset('ed-');
  var hodIdEl = document.getElementById('ed-hod-id');
  var hodNmEl = document.getElementById('ed-hod-name');
  if (hodIdEl) hodIdEl.value = dept.hodTrackId || dept.hodId || '';
  if (hodNmEl) hodNmEl.value = dept.hodName || '';
  // If name already exists, show green tick
  if (hodNmEl && hodNmEl.value) hodLookupBadge('ok', 'ed-');

  openModal_('m-edit-dept');
}

function saveEditDept() {
  var id = document.getElementById('ed-id').value;
  var name = getFieldValue('ed-nm');
  var code = getFieldValue('ed-cd');
  var number = getFieldValue('ed-num');
  var courseType = document.getElementById('ed-cotype') ? document.getElementById('ed-cotype').value : 'UG';
  var branch = document.getElementById('ed-branch') ? document.getElementById('ed-branch').value : 'B.E';
  var hodId = getFieldValue('ed-hod-id') || null;
  var hodName = getFieldValue('ed-hod-name') || '';
  if (!name || !code) { showToast('Department name and code are required', 'warn'); return; }
  if (number && !/^\d{3}$/.test(number)) { showToast('Department Number must be exactly 3 digits', 'warn'); return; }
  if (!courseType || !branch) { showToast('Course Type and Branch are required', 'warn'); return; }
  if (hodId && !hodName) { showToast('Re-verify HoD TrackID — name not resolved', 'warn'); return; }
  dbToast('Updating department…', 'saving', '"' + name + '"');
  apiUpdateDept(id, name, code, number, courseType, branch, hodId, hodName).then(function (d) {
    if (!d) return;
    addLog('Department Updated', '"' + name + '" (' + code + ')');
    closeModalBg('m-edit-dept');
    renderDepartments();
    hodLookupReset('ed-');
    dbToast('Department updated', 'success', '"' + name + '" → Database');
  });
}

function addDept() {
  var name = getFieldValue('dept-name');
  var twoLetterCode = getFieldValue('dept-2code').toLowerCase();
  var code = getFieldValue('dept-code').toUpperCase();
  var number = getFieldValue('dept-number');
  var courseType = document.getElementById('co-type') ? document.getElementById('co-type').value : '';
  var branch = document.getElementById('branch') ? document.getElementById('branch').value : '';
  var hodId = getFieldValue('hod-id') || null;
  var hodName = getFieldValue('hod-name') || '';
  if (!name) { showToast('Department name is required', 'warn'); return; }
  if (!twoLetterCode) { showToast('2-Letter code required (e.g. cs)', 'warn'); return; }
  if (!code) { showToast('3-Letter code required (e.g. CSE)', 'warn'); return; }
  if (!number || !/^\d{3}$/.test(number)) { showToast('3-digit register number required', 'warn'); return; }
  if (!courseType || !branch) { showToast('Course Type and Branch required', 'warn'); return; }
  var okEl = document.getElementById('hod-ok');
  if (hodId && (!hodName || !okEl || okEl.style.display === 'none')) { showToast('HoD TrackID verification pending or failed', 'warn'); return; }
  dbToast('Adding department…', 'saving', '"' + name + '"');
  apiAddDept(name, code, number, twoLetterCode, courseType, branch, hodId, hodName).then(function (d) {
    if (!d) return;
    closeModalBg('m-add-dept');
    renderDepartments();
    populateAdminDropdowns();
    syncBadgesFromAPI();
    addLog('Department Added', '"' + name + '" (' + code + ') 2L=' + twoLetterCode + ' regCode=' + number);
    dbToast('Department added', 'success', '"' + name + '" → Database');
    resetDeptForm();
  });
}

function dDept(deptId) {
  var dept = DB.get('depts').find(function (x) { return x._id === deptId; });
  requireSpecialPw(function () { dDeptConfirmed(deptId, dept); });
}
function dDeptConfirmed(deptId, dept) {
  document.getElementById('dc-confirm-id').value = deptId;
  document.getElementById('dc-confirm-msg').textContent =
    'Delete department "' + (dept ? dept.name : '') + '"? All linked classes and subjects will be removed.';
  document.getElementById('dc-confirm-btn').onclick = function () {
    dbToast('Deleting...', 'saving');
    apiDeleteDept(deptId, dept ? dept.name : '').then(function () {
      addLog('Department Deleted', '"' + (dept ? dept.name : '') + '"');
      closeModalBg('m-dc-confirm');
      renderDepartments();
      syncBadgesFromAPI();
      dbToast('Deleted', 'success');
      window.location.reload();
    }).catch(function () { dbToast('Delete failed', 'error'); });
  };
  openModal_('m-dc-confirm');
}

// ─── STRUCTURE PAGE (CLASSES & SUBJECTS) ────────────────────────────────────
var structureContext = { deptId: null, deptName: '', deptCode: '', sem: null };
var currentClassId = null;
var currentTeacherId = null;
var _emptyStateFired = {};

function resetStructureState() {
  structureContext = { deptId: null, deptName: '', deptCode: '', sem: null };
}
var rstruct = resetStructureState;

function showStructureView(viewName) {
  ['dept', 'cs'].forEach(function (v) {
    var el = document.getElementById('sv-' + v);
    if (el) el.style.display = 'none';
  });
  var target = document.getElementById('sv-' + viewName);
  if (target) target.style.display = 'block';
  var statsEl = document.getElementById('cls-stat-cards');
  if (statsEl) statsEl.style.display = viewName === 'cs' ? '' : 'none';
  updateBreadcrumb();
}
var showSV = showStructureView;

function updateBreadcrumb() {
  var breadcrumb = document.getElementById('sbc');
  var items = [{ label: 'Departments', fn: 'rstruct();rsdv();' }];
  if (structureContext.deptId) {
    items.push({ label: structureContext.deptName, fn: 'dtoDept(\'' + structureContext.deptId + '\')' });
  }
  breadcrumb.innerHTML = items.map(function (item, index) {
    if (index < items.length - 1) {
      return '<span class="bci" onclick="' + item.fn + '">' + item.label + '</span><span class="bcs">›</span>';
    }
    return '<span class="bcc">' + item.label + '</span>';
  }).join('');
}
var ubc = updateBreadcrumb;

function _renderDeptStats(depts) {
  var el = document.getElementById('stats-dept');
  if (!el) return;
  var list = Array.isArray(depts) ? depts : [];
  var d = _counts;
  var cards = [
    { label: 'Total Departments', val: list.length || d.depts || 0, icon: '🏛️', cls: 'amber', id: 'dept-stat-depts' },
    { label: 'Total Classes', val: d.classes !== undefined && d.classes !== null ? d.classes : (_loaded.classes ? DB.get('classes').length : '⏳'), icon: '🏫', cls: 'purple', id: 'dept-stat-classes' },
    { label: 'Total Students', val: d.students !== undefined && d.students !== null ? d.students : '⏳', icon: '👨‍🎓', cls: 'blue', id: 'dept-stat-students' },
    { label: 'Total Teachers', val: d.teachers !== undefined && d.teachers !== null ? d.teachers : (_loaded.users ? DB.get('users').filter(function (u) { return u.role === 'teacher'; }).length : '⏳'), icon: '👨‍🏫', cls: 'orange', id: 'dept-stat-teachers' }
  ];
  el.innerHTML = cards.map(function (c) {
    return '<div class="t-stat-mini">'
      + '<div class="t-stat-icon ' + c.cls + '">' + c.icon + '</div>'
      + '<div><div class="t-stat-val" id="' + c.id + '">' + c.val + '</div><div class="t-stat-label">' + c.label + '</div></div>'
      + '</div>';
  }).join('');
  syncBadgesFromAPI();
}

function renderDepartmentSelector() {
  var depts = DB.get('depts') || [];
  var classes = DB.get('classes') || [];
  var subjects = DB.get('subjects') || [];
  var grid = document.getElementById('sdg');

  if (!grid) return;

  var clsPageBtn = document.getElementById('cls-page-btn');
  if (clsPageBtn) clsPageBtn.style.display = 'none';

  grid.className = 'tgrd';

  if (!depts.length) {
    grid.innerHTML =
      '<div class="emst">' +
      '<span class="emico">🏛️</span>' +
      '<div class="emtx">No department found. Add one first.</div>' +
      '</div>';

    showStructureView('dept');
    return;
  }

  _emptyStateFired.deptSelector = false;

  grid.innerHTML = depts.map(function (dept) {
    var classCount = _loaded.classes ? classes.filter(function (c) { return c.deptId === dept._id; }).length : '⏳';
    var subjectCount = _loaded.subjects ? subjects.filter(function (s) { return s.deptId === dept._id; }).length : '⏳';

    return '<div class="tcrd" onclick="dtoDept(\'' + dept._id + '\')">'
      + '<div class="tav" style="font-size:28px;background:linear-gradient(135deg,var(--gM),var(--gB));">' + (dept.icon || '🏛️') + '</div>'
      + '<div class="tnm">' + dept.name + '</div>'
      + '<div class="tdp">' + dept.code + '</div>'
      + '<div class="tsts">'
      + '<div class="tst2"><span>' + classCount + '</span>Classes</div>'
      + '<div class="tst2"><span>' + subjectCount + '</span>Subjects</div>'
      + '</div>'
      + '<div style="margin-top:12px;font-size:11px;color:var(--gM);font-weight:600;">Explore →</div>'
      + '</div>';
  }).join('');

  showStructureView('dept');
}
var rsdv = renderDepartmentSelector;

function dtoDept(deptId) {
  var dept = DB.get('depts').find(function (d) { return d._id === deptId; });
  if (!dept) return;
  structureContext.deptId = deptId;
  structureContext.deptName = dept.name;
  structureContext.deptCode = dept.code;
  renderClassSubjectView(deptId);
  showStructureView('cs');
  var clsPageBtn = document.getElementById('cls-page-btn');
  if (clsPageBtn) clsPageBtn.style.display = 'flex';
}

function _renderClassStats() {
  var el = document.getElementById('cls-stat-cards');
  if (!el) return;
  var deptId = structureContext.deptId;
  var allClasses = DB.get('classes').filter(function (c) { return !deptId || c.deptId === deptId; }) || [];
  var allSubjects = DB.get('subjects').filter(function (s) { return !deptId || s.deptId === deptId; }) || [];
  var totalClasses = _loaded.classes ? allClasses.length : (_counts.classes || '⏳');
  var totalSubjects = _loaded.subjects ? allSubjects.length : (_counts.subjects || '⏳');
  var totalStudents = _loaded.classes ? allClasses.reduce(function (sum, c) { return sum + (c.studentCount || 0); }, 0) : (_counts.students || '⏳');
  var totalAssignments = _loaded.assignments ? DB.get('assignments').filter(function (a) {
    return allClasses.some(function (c) { return c._id === a.classId; });
  }).length : (_counts.assignments || '⏳');

  var cards = [
    { label: 'Total Classes', val: totalClasses, icon: '🏫', cls: 'amber', id: 'cls-stat-classes' },
    { label: 'Total Subjects', val: totalSubjects, icon: '📚', cls: 'purple', id: 'cls-stat-subjects' },
    { label: 'Total Students', val: totalStudents, icon: '👨‍🎓', cls: 'green', id: 'cls-stat-students' },
    { label: 'Total Assignments', val: totalAssignments, icon: '📋', cls: 'blue', id: 'cls-stat-assignments' }
  ];
  el.innerHTML = cards.map(function (c) {
    return '<div class="t-stat-mini">'
      + '<div class="t-stat-icon ' + c.cls + '">' + c.icon + '</div>'
      + '<div><div class="t-stat-val" id="' + c.id + '">' + c.val + '</div><div class="t-stat-label">' + c.label + '</div></div>'
      + '</div>';
  }).join('');
}

function _renderClassGrid(classes) {
  var classGrid = document.getElementById('scg');
  if (!classGrid) return;
  classGrid.innerHTML = classes.length
    ? classes.map(function (cls) {
      var studentCount = cls.studentCount || 0;
      var assignmentCount = DB.get('assignments').filter(function (a) { return a.classId === cls._id; }).length;
      return '<div class="ec" onclick="openCD(\'' + cls._id + '\')">'
        + '<div class="ech"><div class="eci" style="background:var(--gLt)">🏫</div>'
        + '<div><div class="ecn">' + cls.name + '</div>'
        + '<div class="ecsu">Hall: ' + (cls.hallNo || '—') + ' · Sec ' + (cls.section || '—') + ' · ' + cls.deptName + '</div></div></div>'
        + '<div class="ecb"><div class="emt">' + studentCount + ' students · ' + assignmentCount + ' subjects</div></div>'
        + '</div>';
    }).join('')
    : '<div class="emst"><span class="emico">🏫</span><div class="emtx">No classes. Click "+ Add Class".</div></div>';
}

var _classViewMode = 'grid';

function toggleClassView(mode) {
  _classViewMode = mode;
  var gridBtn = document.getElementById('cs-vt-grid');
  var tblBtn = document.getElementById('cs-vt-table');
  var gridEl = document.getElementById('scg');
  var tblEl = document.getElementById('scg-tbl');
  var info = document.getElementById('cs-view-info');
  if (gridBtn) gridBtn.classList.toggle('act', mode === 'grid');
  if (tblBtn) tblBtn.classList.toggle('act', mode === 'table');
  if (gridEl) gridEl.style.display = mode === 'grid' ? '' : 'none';
  if (tblEl) tblEl.style.display = mode === 'table' ? '' : 'none';
  if (info) info.textContent = mode === 'grid' ? '▦ Grid view' : '☰ Table view';
}

function _renderClassTable(classes) {
  var tbody = document.getElementById('scg-tbl-body');
  if (!tbody) return;
  tbody.innerHTML = classes.length
    ? classes.map(function (cls, i) {
      var assignmentCount = DB.get('assignments').filter(function (a) { return a.classId === cls._id; }).length;
      return '<tr onclick="openCD(\'' + cls._id + '\')" style="cursor:pointer;">'
        + '<td>' + (i + 1) + '</td>'
        + '<td class="b">' + cls.name + '</td>'
        + '<td>' + (cls.batch || '—') + '</td>'
        + '<td>' + (cls.section || '—') + '</td>'
        + '<td>' + (cls.year || '—') + '</td>'
        + '<td>' + (cls.sem || '—') + '</td>'
        + '<td>' + (cls.hallNo || '—') + '</td>'
        + '<td>' + (cls.studentCount || 0) + '</td>'
        + '<td>' + assignmentCount + '</td>'
        + '</tr>';
    }).join('')
    : '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--tdi);">No classes found.</td></tr>';
}

function _renderSubjectGrid(subjects) {
  var subjectGrid = document.getElementById('ssg2');
  if (!subjectGrid) return;
  subjectGrid.innerHTML = subjects.length
    ? subjects.map(function (subj) {
      var assignments = DB.get('assignments').filter(function (a) { return a.subjectId === subj._id; });
      var sectionCount = assignments.length;
      return '<div class="ec" onclick="openSubjAssignModal(\'' + subj._id + '\')" style="cursor:pointer;">'
        + '<div class="ech"><div class="eci" style="background:rgba(59,130,246,.1)">📚</div>'
        + '<div style="flex:1"><div class="ecn">' + subj.name + '</div>'
        + '<div class="ecsu">' + subj.code + ' · ' + subj.credits + ' credits · ' + subj.type + '</div></div>'
        + '<button class="btn-xs btn-out" onclick="event.stopPropagation();openSD(\'' + subj._id + '\')" title="Subject Details / Edit" style="flex-shrink:0;margin-left:6px;padding:4px 10px;font-size:11px;">ℹ Details</button>'
        + '</div>'
        + '<div class="ecb"><div class="emt">' + (sectionCount ? '📋 ' + sectionCount + ' section(s) assigned' : '➕ Click to assign sections') + '</div></div>'
        + '</div>';
    }).join('')
    : '<div class="emst"><span class="emico">📚</span><div class="emtx">No subjects. Click "+ Add Subject".</div></div>';
}

function _renderSubjectTable(subjects) {
  var tbody = document.getElementById('ssg2-tbl-body');
  if (!tbody) return;
  tbody.innerHTML = subjects.length
    ? subjects.map(function (subj, i) {
      var assignments = DB.get('assignments').filter(function (a) { return a.subjectId === subj._id; });
      var sectionCount = assignments.length;
      return '<tr onclick="openSubjAssignModal(\'' + subj._id + '\')" style="cursor:pointer;">'
        + '<td>' + (i + 1) + '</td>'
        + '<td class="b">' + subj.name + '</td>'
        + '<td>' + (subj.code || '—') + '</td>'
        + '<td>' + (subj.type || '—') + '</td>'
        + '<td>' + (subj.credits || '—') + '</td>'
        + '<td>' + sectionCount + '</td>'
        + '</tr>';
    }).join('')
    : '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--tdi);">No subjects found.</td></tr>';
}

function renderClassSubjectView(deptId) {
  _renderClassStats();
  var classes = DB.get('classes').filter(function (c) { return !deptId || c.deptId === deptId; }) || [];
  var subjects = DB.get('subjects').filter(function (s) { return !deptId || s.deptId === deptId; }) || [];
  _renderClassGrid(classes);
  _renderClassTable(classes);
  _renderSubjectGrid(subjects);
  _renderSubjectTable(subjects);

  var scg = document.getElementById('scg');
  var scgTbl = document.getElementById('scg-tbl');
  var ssg2 = document.getElementById('ssg2');
  var ssg2Tbl = document.getElementById('ssg2-tbl');
  if (scg) scg.style.display = _classViewMode === 'grid' ? '' : 'none';
  if (scgTbl) scgTbl.style.display = _classViewMode === 'table' ? '' : 'none';
  if (ssg2) ssg2.style.display = _classViewMode === 'grid' ? '' : 'none';
  if (ssg2Tbl) ssg2Tbl.style.display = _classViewMode === 'table' ? '' : 'none';
}
var renderCSViewNosem = renderClassSubjectView;

function switchStructureTab(tabName) {
  document.querySelectorAll('#sv-cs .tab').forEach(function (tab, index) {
    tab.classList.toggle('act', index === (tabName === 'classes' ? 0 : 1));
  });
  document.getElementById('sp-classes').style.display = tabName === 'classes' ? 'block' : 'none';
  document.getElementById('sp-subjects').style.display = tabName === 'subjects' ? 'block' : 'none';

  var clsPageBtn = document.getElementById('cls-page-btn');
  if (clsPageBtn) clsPageBtn.style.display = structureContext.deptId ? 'flex' : 'none';

  var clsBtn = document.getElementById('hdr-add-class');
  var subjBtn = document.getElementById('hdr-add-subj');
  if (clsBtn) clsBtn.className = tabName === 'classes' ? 'btn-pri' : 'btn-out';
  if (subjBtn) subjBtn.className = tabName === 'subjects' ? 'btn-pri' : 'btn-out';
}
var sst = switchStructureTab;

function _getAllTeachersList() {
  if (Array.isArray(_teacherData) && _teacherData.length) {
    return _teacherData;
  }
  var usersTeachers = (DB.get('users') || []).filter(function (u) { return u.role === 'teacher'; });
  if (usersTeachers.length) return usersTeachers;
  return [];
}

function _populateClassAdvisorSection(cls, teachers) {
  var advisorSelect = document.getElementById('cd-advisor-select');
  var advisorBtn = document.getElementById('cd-advisor-btn');
  var advisorNameEl = document.getElementById('cd-advisor-name');
  if (!cls) return;

  var allTeachers = Array.isArray(teachers) && teachers.length ? teachers : _getAllTeachersList();
  var assignedTeacher = null;

  if (cls.advisorTeacherId) {
    assignedTeacher = allTeachers.find(function (t) {
      return String(t._id) === String(cls.advisorTeacherId) ||
             String(t.shadowId) === String(cls.advisorTeacherId) ||
             String(t.trackId) === String(cls.advisorTeacherId);
    });
  }
  if (!assignedTeacher && cls.advisorTeacherTrackId) {
    assignedTeacher = allTeachers.find(function (t) {
      return String(t.trackId) === String(cls.advisorTeacherTrackId);
    });
  }
  if (!assignedTeacher) {
    assignedTeacher = allTeachers.find(function (t) {
      return Array.isArray(t.specials) && t.specials.some(function (s) {
        return (s.option === 'isClassAdvisor' || s.option === 'ClassAdvisorTrackId') &&
          (s.key === cls.name || s.key === cls.trackId || s.value === cls.name || s.value === cls.trackId);
      });
    });
  }

  if (advisorNameEl) {
    if (assignedTeacher || cls.advisorTeacherName) {
      var advName = (assignedTeacher ? (assignedTeacher.name || assignedTeacher.fullName) : cls.advisorTeacherName) || 'Assigned';
      advisorNameEl.innerHTML = '<span style="color:var(--gD);font-weight:700;">⭐ ' + advName + '</span>';
      if (advisorBtn) advisorBtn.textContent = '✏️ Change Advisor';
    } else {
      advisorNameEl.textContent = 'Not Assigned';
      if (advisorBtn) advisorBtn.textContent = '👤 Assign Advisor';
    }
  }

  if (advisorSelect) {
    var deptTeachers = allTeachers.filter(function (t) {
      var tDeptId = t.deptId ? (typeof t.deptId === 'object' && t.deptId._id ? t.deptId._id : t.deptId) : '';
      var cDeptId = cls.deptId ? (typeof cls.deptId === 'object' && cls.deptId._id ? cls.deptId._id : cls.deptId) : '';
      var tDept = (t.dept || t.department || '').toLowerCase().trim();
      var cDeptName = (cls.deptName || '').toLowerCase().trim();
      var cDeptCode = (cls.deptCode || '').toLowerCase().trim();
      return (tDeptId && cDeptId && String(tDeptId) === String(cDeptId)) ||
             (tDept && (tDept === cDeptName || tDept === cDeptCode));
    });
    if (!deptTeachers.length) deptTeachers = allTeachers;

    var selectedId = assignedTeacher ? (assignedTeacher._id || assignedTeacher.shadowId || assignedTeacher.trackId) : (cls.advisorTeacherId || '');
    advisorSelect.innerHTML = '<option value="">— None (Unassigned) —</option>' + deptTeachers.map(function (t) {
      var tid = t._id || t.shadowId || t.trackId;
      var sel = (String(tid) === String(selectedId) || (assignedTeacher && String(t.trackId) === String(assignedTeacher.trackId))) ? ' selected' : '';
      var tName = t.name || t.fullName || 'Teacher';
      var tInfo = t.empId || t.employeeNo || t.dept || t.department || 'Faculty';
      return '<option value="' + tid + '"' + sel + '>' + tName + ' (' + tInfo + ')</option>';
    }).join('');
  }
}

function openCD(classId) {
  var cls = DB.get('classes').find(function (c) { return c._id === classId; });
  if (!cls) return;
  currentClassId = classId;

  document.getElementById('cd-ttl').textContent = cls.name + ' — ' + cls.deptName;
  document.getElementById('cd-sub').textContent = 'Year: ' + cls.year + ' | Sem: ' + cls.sem + ' | Section: ' + cls.section + ' | Hall: ' + (cls.hallNo || '—');

  var classAssignments = DB.get('assignments').filter(function (a) { return a.classId === classId; });

  // ── Class Advisor Display & Dropdown Population
  var advisorSelect = document.getElementById('cd-advisor-select');
  var advisorBtn = document.getElementById('cd-advisor-btn');
  var advisorSaveBtn = document.getElementById('cd-advisor-save-btn');
  var advisorCancelBtn = document.getElementById('cd-advisor-cancel-btn');

  if (advisorSelect) advisorSelect.style.display = 'none';
  if (advisorSaveBtn) advisorSaveBtn.style.display = 'none';
  if (advisorCancelBtn) advisorCancelBtn.style.display = 'none';
  if (advisorBtn) {
    advisorBtn.style.display = 'inline-block';
    advisorBtn.textContent = '👤 Assign Advisor';
  }

  var allTeachers = _getAllTeachersList();
  _populateClassAdvisorSection(cls, allTeachers);

  if (!allTeachers.length) {
    apiCall('GET', '/teachers').then(function (list) {
      if (Array.isArray(list) && list.length) {
        _teacherData = list;
        if (currentClassId === classId) {
          _populateClassAdvisorSection(cls, list);
        }
      }
    }).catch(function (err) {
      console.warn('[EAMS] Failed to fetch teachers for class modal:', err);
    });
  }

  document.getElementById('cd-stats').innerHTML =
    '<div style="background:var(--gP);border-radius:11px;padding:14px;text-align:center;">'
    + '<div style="font-size:24px;font-weight:800;color:var(--gK)">' + (cls.studentCount || '—') + '</div>'
    + '<div style="font-size:10px;color:var(--tdi);margin-top:3px;text-transform:uppercase;">Students</div></div>'
    + '<div style="background:var(--gP);border-radius:11px;padding:14px;text-align:center;">'
    + '<div style="font-size:24px;font-weight:800;color:var(--td)">' + classAssignments.length + '</div>'
    + '<div style="font-size:10px;color:var(--tdi);margin-top:3px;text-transform:uppercase;">Subjects</div></div>'
    + '<div style="background:var(--gP);border-radius:11px;padding:14px;text-align:center;">'
    + '<div style="font-size:24px;font-weight:800;color:var(--teal)">' + (cls.hallNo || '—') + '</div>'
    + '<div style="font-size:10px;color:var(--tdi);margin-top:3px;text-transform:uppercase;">Hall No.</div></div>';

  document.getElementById('cd-asgn').innerHTML = classAssignments.length
    ? classAssignments.map(function (a) {
      return '<div class="arow">'
        + '<div class="ainfo">'
        + '<div class="anm">📚 ' + a.subjectName + '</div>'
        + '<div class="acls">👩‍🏫 ' + (a.teacherName || 'Unassigned') + '</div>'
        + '</div>'
        + '<button class="btn bdan bxs" onclick="rmAsgn(\'' + a._id + '\',\'class\')">✖</button>'
        + '</div>';
    }).join('')
    : '<div style="text-align:center;padding:18px;color:var(--tdi);font-size:12px;">No subjects assigned. Click "+ Assign Subject".</div>';

  document.getElementById('cd-sc').textContent = cls.studentCount || '—';
  // Show loading state while fetching roster
  document.getElementById('cd-stus').innerHTML = '<div style="text-align:center;padding:14px;color:var(--tdi);font-size:12px;">⏳ Loading roster…</div>';

  document.getElementById('cd-del').onclick = function () {
    if (!confirm('Delete class "' + cls.name + '"?\nThis will also remove all subject assignments. This cannot be undone.')) return;
    dbToast('Deleting...', 'saving');
    apiDeleteClass(classId, cls.name).then(function () {
      addLog('Class Deleted', '"' + cls.name + '"');
      closeModalBg('m-cls-detail');
      renderClassSubjectView(structureContext.deptId);
      dbToast('Class deleted', 'success');
    }).catch(function () { dbToast('Delete failed', 'error'); });
  };

  openModal_('m-cls-detail');

  // Fetch lightweight roster from API (fires only when class is opened)
  var tok = getToken();
  if (!tok) return;
  fetch('/api/students?classId=' + encodeURIComponent(classId) + '&roster=1', { headers: { 'Authorization': 'Bearer ' + tok } })
    .then(function (r) { return r.json(); })
    .then(function (roster) {
      var list = Array.isArray(roster) ? roster : [];
      document.getElementById('cd-sc').textContent = list.length;
      document.getElementById('cd-stus').innerHTML = list.length
        ? '<div class="tw"><table class="tbl"><thead><tr><th>#</th><th>Name</th><th>Reg No.</th></tr></thead><tbody>'
        + list.map(function (s, i) {
          return '<tr><td>' + (i + 1) + '</td><td class="b">' + s.name + '</td><td>' + s.regNo + '</td></tr>';
        }).join('')
        + '</tbody></table></div>'
        : '<div style="text-align:center;padding:14px;color:var(--tdi);font-size:12px;">No students enrolled.</div>';
    })
    .catch(function () {
      document.getElementById('cd-stus').innerHTML = '<div style="text-align:center;padding:14px;color:var(--tdi);font-size:12px;">Failed to load roster.</div>';
    });
}

function editClsInline() {
  if (!currentClassId) return;
  var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
  if (!cls) return;
  document.getElementById('ec-dept').value = cls.deptId || '';
  document.getElementById('ec-sec').value = cls.section || '';
  document.getElementById('ec-hall').value = cls.hallNo || '';
  document.getElementById('ec-yr').value = cls.year || '';
  document.getElementById('ec-sem').value = cls.sem || '';
  document.getElementById('ec-batch').value = cls.batch || '';
  ecAutoName();
  // Auto-generate name display (read-only)
  var dept = DB.get('depts').find(function (d) { return d._id === cls.deptId; });
  document.getElementById('ec-nm').value = cls.name || (dept ? cls.batch + '-' + dept.code + '-' + cls.section : '');
  closeModalBg('m-cls-detail');
  openModal_('m-edit-cls');
}

function ecAutoName() {
  var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
  if (!cls) return;
  var dept = DB.get('depts').find(function (d) { return d._id === cls.deptId; });
  var section = document.getElementById('ec-sec').value.trim() || cls.section;
  if (dept && cls.batch && section)
    document.getElementById('ec-nm').value = cls.batch + '-' + dept.code + '-' + section;
}

function saveEditCls() {
  if (!currentClassId) return;
  var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
  var deptName = getFieldValue('ec-dept') || '';
  var section = getFieldValue('ec-sec') || '';
  var hallNo = getFieldValue('ec-hall');
  var year = getFieldValue('ec-yr');
  var sem = getFieldValue('ec-sem');
  var batch = getFieldValue('ec-batch');
  var dept = DB.get('depts').find(function (d) { return d && cls && d._id === cls.deptId; });
  var name = dept ? (batch + '-' + dept.code + '-' + section) : getFieldValue('ec-nm');
  dbToast('Saving changes...', 'saving');
  apiUpdateClass(currentClassId, { section: section, hallNo: hallNo, name: name, year: year, sem: sem, batch: batch, deptName: deptName }).then(function (d) {
    if (!d) return;
    addLog('Class Updated', '"' + name + '"');
    closeModalBg('m-edit-cls');
    openCD(currentClassId);
    if (structureContext.deptId) renderClassSubjectView(structureContext.deptId);
    dbToast('Class updated', 'success');
  });
}

function toggleAssignAdvisor() {
  var advisorSelect = document.getElementById('cd-advisor-select');
  var advisorBtn = document.getElementById('cd-advisor-btn');
  var advisorSaveBtn = document.getElementById('cd-advisor-save-btn');
  var advisorCancelBtn = document.getElementById('cd-advisor-cancel-btn');

  if (advisorSelect && advisorSelect.options.length <= 1) {
    var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
    var allTeachers = _getAllTeachersList();
    if (allTeachers.length && cls) {
      _populateClassAdvisorSection(cls, allTeachers);
    } else if (cls) {
      advisorSelect.innerHTML = '<option value="">Loading teachers…</option>';
      apiCall('GET', '/teachers').then(function (list) {
        if (Array.isArray(list)) {
          _teacherData = list;
          _populateClassAdvisorSection(cls, list);
        }
      });
    }
  }

  if (advisorSelect) advisorSelect.style.display = 'inline-block';
  if (advisorSaveBtn) advisorSaveBtn.style.display = 'inline-block';
  if (advisorCancelBtn) advisorCancelBtn.style.display = 'inline-block';
  if (advisorBtn) advisorBtn.style.display = 'none';
}

function cancelAssignAdvisor() {
  var advisorSelect = document.getElementById('cd-advisor-select');
  var advisorBtn = document.getElementById('cd-advisor-btn');
  var advisorSaveBtn = document.getElementById('cd-advisor-save-btn');
  var advisorCancelBtn = document.getElementById('cd-advisor-cancel-btn');
  if (advisorSelect) advisorSelect.style.display = 'none';
  if (advisorSaveBtn) advisorSaveBtn.style.display = 'none';
  if (advisorCancelBtn) advisorCancelBtn.style.display = 'none';
  if (advisorBtn) advisorBtn.style.display = 'inline-block';
}

function saveClassAdvisor() {
  if (!currentClassId) return;
  var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
  if (!cls) return;
  var selectEl = document.getElementById('cd-advisor-select');
  var teacherId = selectEl ? selectEl.value : '';

  dbToast('Saving Class Advisor...', 'saving');
  apiCall('PUT', '/classes/' + currentClassId + '/advisor', { teacherId: teacherId || null })
    .then(function (res) {
      if (res && res.class) {
        cls.advisorTeacherId = res.class.advisorTeacherId;
        cls.advisorTeacherName = res.class.advisorTeacherName;
        cls.advisorTeacherTrackId = res.class.advisorTeacherTrackId;
      } else if (!teacherId) {
        cls.advisorTeacherId = null;
        cls.advisorTeacherName = '';
        cls.advisorTeacherTrackId = '';
      }
      return syncUsersWithTeacherDetails().then(function () {
        return apiCall('GET', '/teachers').then(function (list) {
          if (Array.isArray(list)) _teacherData = list;
        });
      });
    })
    .then(function () {
      openCD(currentClassId);
      dbToast('Class Advisor saved', 'success');
    })
    .catch(function (err) {
      dbToast(err.message || 'Failed to update advisor', 'error');
    });
}

function oasc() {
  var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
  if (!cls) return;
  document.getElementById('as-cls').value = cls.name;
  var deptSubjects = DB.get('subjects').filter(function (s) { return s.deptId === cls.deptId; });
  document.getElementById('as-subj').innerHTML = deptSubjects.map(function (s) {
    return '<option value="' + s._id + '">' + s.name + ' (' + s.code + ')</option>';
  }).join('') || '<option>No subjects</option>';

  var allTeachers = _getAllTeachersList();
  if (!allTeachers.length) {
    apiCall('GET', '/teachers').then(function (list) {
      if (Array.isArray(list)) {
        _teacherData = list;
        document.getElementById('as-tch').innerHTML = list.map(function (t) {
          return '<option value="' + t._id + '">' + (t.name || t.fullName) + '</option>';
        }).join('') || '<option value="">No teachers</option>';
      }
    });
  }
  document.getElementById('as-tch').innerHTML = allTeachers.map(function (t) {
    return '<option value="' + t._id + '">' + (t.name || t.fullName) + '</option>';
  }).join('') || '<option value="">No teachers</option>';
  openModal_('m-asgn-subj');
}

function saveAsgn() {
  var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
  var subjId = document.getElementById('as-subj').value;
  var subjEl = document.getElementById('as-subj');
  var subjName = subjEl.selectedOptions[0] ? subjEl.selectedOptions[0].text : '';
  var tchId = document.getElementById('as-tch').value;
  var tchEl = document.getElementById('as-tch');
  var tchName = tchEl.selectedOptions[0] ? tchEl.selectedOptions[0].text : '';
  if (!subjId) { showToast('Select a subject', 'warn'); return; }
  if (!tchId) { showToast('Select a teacher', 'warn'); return; }
  if (DB.one('assignments', { classId: currentClassId, subjectId: subjId })) { showToast('Already assigned', 'warn'); return; }
  dbToast('Saving...', 'saving');
  apiCall('POST', '/assignments', {
    classId: currentClassId, className: cls.name,
    subjectId: subjId, subjectName: subjName.split(' (')[0],
    teacherId: tchId, teacherName: tchName,
    deptName: cls.deptName, deptCode: cls.deptCode
  }).then(function (d) {
    if (!d || d.error) { dbToast('DB Error: ' + (d && d.error ? d.error : 'Unknown'), 'error'); return; }
    return apiCall('GET', '/assignments').then(function (all) {
      if (Array.isArray(all)) DB.set('assignments', all);
      closeModalBg('m-asgn-subj');
      openCD(currentClassId);
      addLog('Subject Assigned', '"' + subjName + '" → ' + cls.name);
      dbToast('Assignment saved', 'success');
    });
  }).catch(function () {
    dbToast('Network error saving assignment', 'error');
  });
}

function rmAsgn(assignmentId, fromView) {
  dbToast('Removing...', 'saving');
  apiCall('DELETE', '/assignments/' + assignmentId).then(function (d) {
    if (d && d.error) { dbToast('Error: ' + d.error, 'error'); return; }
    return apiCall('GET', '/assignments').then(function (all) {
      if (Array.isArray(all)) DB.set('assignments', all);
      addLog('Assignment Removed', '');
      if (fromView === 'class') openCD(currentClassId);
      else openTD(currentTeacherId);
      dbToast('Removed', 'success');
    });
  }).catch(function () {
    dbToast('Network error removing assignment', 'error');
  });
}

function openSD(subjectId) {
  currentSubjectId = subjectId;
  var subj = DB.get('subjects').find(function (s) { return s._id === subjectId; });
  if (!subj) return;
  document.getElementById('sd-ttl').textContent = subj.name;
  document.getElementById('sd-sub').textContent = subj.code + ' · ' + subj.credits + ' Credits · ' + subj.type + ' · ' + subj.deptName;

  var assignments = DB.get('assignments').filter(function (a) { return a.subjectId === subjectId; });
  document.getElementById('sd-stats').innerHTML =
    '<div style="background:var(--gP);border-radius:11px;padding:14px;text-align:center;">'
    + '<div style="font-size:24px;font-weight:800;color:var(--gK)">' + subj.credits + '</div>'
    + '<div style="font-size:10px;color:var(--tdi);margin-top:3px;text-transform:uppercase;">Credits</div></div>'
    + '<div style="background:var(--gP);border-radius:11px;padding:14px;text-align:center;">'
    + '<div style="font-size:24px;font-weight:800;color:var(--td)">' + assignments.length + '</div>'
    + '<div style="font-size:10px;color:var(--tdi);margin-top:3px;text-transform:uppercase;">Classes</div></div>'
    + '<div style="background:rgba(59,130,246,.08);border-radius:11px;padding:14px;text-align:center;">'
    + '<div style="font-size:14px;font-weight:700;color:#2563eb">' + subj.type + '</div>'
    + '<div style="font-size:10px;color:var(--tdi);margin-top:3px;text-transform:uppercase;">Type</div></div>';

  document.getElementById('sd-asgn').innerHTML = assignments.length
    ? assignments.map(function (a) {
      return '<div class="arow"><div class="ainfo">'
        + '<div class="anm">🏫 ' + a.className + '</div>'
        + '<div class="acls">👩‍🏫 ' + (a.teacherName || 'Unassigned') + '</div>'
        + '</div></div>';
    }).join('')
    : '<div style="text-align:center;padding:14px;color:var(--tdi);font-size:12px;">Not assigned to any class.</div>';

  document.getElementById('sd-del').onclick = function () {
    if (!confirm('Delete subject "' + subj.name + '"? This cannot be undone.')) return;
    dbToast('Deleting...', 'saving');
    apiDeleteSubject(subjectId, subj.name).then(function () {
      addLog('Subject Deleted', '"' + subj.name + '"');
      closeModalBg('m-subj-detail');
      renderClassSubjectView(structureContext.deptId);
      dbToast('Subject deleted from DB, check Undo Menu for undo', 'success');
    }).catch(function () { dbToast('Delete failed', 'error'); });
  };
  openModal_('m-subj-detail');
}

var currentSubjectId = null;
function editSubjInline() {
  if (!currentSubjectId) return;
  var subj = DB.get('subjects').find(function (s) { return s._id === currentSubjectId; });
  if (!subj) return;
  document.getElementById('es-nm').value = subj.name || '';
  if (document.getElementById('es-ssc')) document.getElementById('es-ssc').value = subj.shortName || subj.shortCode || '';
  document.getElementById('es-cd').value = subj.code || '';
  document.getElementById('es-cr').value = subj.credits || 3;
  document.getElementById('es-tp').value = subj.type || 'Theory';
  closeModalBg('m-subj-detail');
  openModal_('m-edit-subj');
}

function saveEditSubj() {
  if (!currentSubjectId) return;
  var name = getFieldValue('es-nm');
  var shortName = getFieldValue('es-ssc');
  var code = getFieldValue('es-cd');
  var credits = parseInt(getFieldValue('es-cr')) || 3;
  var type = getFieldValue('es-tp') || 'Theory';
  if (!name || !code) { showToast('Name and code required', 'warn'); return; }
  apiUpdateSubject(currentSubjectId, { name: name, shortName: shortName, code: code, credits: credits, type: type }).then(function (d) {
    if (!d) return;
    addLog('Subject Updated', '"' + name + '"');
    closeModalBg('m-edit-subj');
    if (structureContext.deptId) renderClassSubjectView(structureContext.deptId);
    showToast('Subject "' + name + '" updated');
  });
}

function ncAutoName() {
  var deptId = getFieldValue('nc-dept');
  var batch = getFieldValue('nc-batch');
  var sem = getFieldValue('nc-sem');
  var section = (document.getElementById('nc-sec').value || '').trim();
  var dept = DB.get('depts').find(function (d) { return d._id === deptId; });
  var nameEl = document.getElementById('nc-name');
  var warnEl = document.getElementById('nc-warn');
  var addBtn = document.getElementById('nc-add-btn');
  if (dept && batch && section) {
    var batchV = batch.slice(2, 4) + '-' + batch.slice(5, 7);
    var autoName = batchV + ' ' + dept.code + '-' + section;
    nameEl.value = autoName;
    // Check duplicate
    var dup = DB.get('classes').find(function (cls) {
      return cls.deptId === deptId && cls.batch === batch && cls.section === section;
    });
    if (dup) {
      warnEl.textContent = '⚠️ Class "' + autoName + '" already exists for this department/batch/section.';
      warnEl.style.display = 'block';
      addBtn.disabled = true;
      addBtn.style.opacity = '.5';
      addBtn.style.cursor = 'not-allowed';
    } else {
      warnEl.style.display = 'none';
      addBtn.disabled = false;
      addBtn.style.opacity = '1';
      addBtn.style.cursor = 'pointer';
    }
  } else {
    nameEl.value = '';
    warnEl.style.display = 'none';
    addBtn.disabled = true;
    addBtn.style.opacity = '.5';
  }
}
function openAddClassModal() {
  // Ensure dropdowns are populated with latest DB data
  populateAdminDropdowns();

  // Reset fields
  document.getElementById('nc-sec').value = '';
  document.getElementById('nc-hall').value = '';
  document.getElementById('nc-name').value = '';
  var warnEl = document.getElementById('nc-warn');
  if (warnEl) warnEl.style.display = 'none';
  var addBtn = document.getElementById('nc-add-btn');
  if (addBtn) { addBtn.disabled = true; addBtn.style.opacity = '.5'; addBtn.style.cursor = 'not-allowed'; }

  // Auto-select current dept from structure context
  if (structureContext && structureContext.deptId) {
    var deptSel = document.getElementById('nc-dept');
    if (deptSel) {
      deptSel.value = structureContext.deptId;
      ncAutoName(); // trigger name generation
    }
  }

  openModal_('m-add-class-quick');
}

function ncValidate() { ncAutoName(); }
function ncdc() { ncAutoName(); }

function addCls() {
  var deptId = getFieldValue('nc-dept');
  var year = getFieldValue('nc-yr');
  var sem = getFieldValue('nc-sem');
  var batch = getFieldValue('nc-batch');
  var section = (document.getElementById('nc-sec').value || '').trim() || '';
  var hallNo = getFieldValue('nc-hall');
  if (!deptId) { showToast('Select a department', 'warn'); return; }
  if (!batch) { showToast('Select a batch', 'warn'); return; }
  if (!section) { showToast('Enter a section', 'warn'); return; }
  if (!hallNo) { showToast('Enter a hall number', 'warn'); return; }
  var dept = DB.get('depts').find(function (d) { return d._id === deptId; });
  var className = getFieldValue('nc-name');
  // Final duplicate check
  if (DB.get('classes').find(function (cls) { return cls.name.toLowerCase() === className.toLowerCase(); })) {
    showToast('Class "' + className + '" already exists!', 'warn'); return;
  }
  apiAddClass({ deptId: deptId, deptName: dept.name, deptCode: dept.code, year: year, sem: sem, section: section, hallNo: hallNo, name: className, batch: batch })
    .then(function (d) {
      if (!d) return;
      closeModalBg('m-add-class-quick');
      document.getElementById('nc-sec').value = '';
      document.getElementById('nc-hall').value = '';
      document.getElementById('nc-name').value = '';
      document.getElementById('nc-warn').style.display = 'none';
      document.getElementById('nc-add-btn').disabled = true;
      document.getElementById('nc-add-btn').style.opacity = '.5';
      if (structureContext.deptId === deptId) renderClassSubjectView(deptId);
      addLog('Class Added', '"' + className + '"');
      dbToast('Class "' + className + '" added to DB', 'success');
    });
}

function openAddSubj() {
  if (!structureContext.deptId) {
    showToast('Please explore a department first before adding a subject.', 'warn');
    return;
  }

  // Auto-select current dept from structure context
  var deptSel = document.getElementById('ns-dept');
  if (deptSel) deptSel.value = structureContext.deptId;

  // Show active dept in modal title
  var titleEl = document.querySelector('#m-add-subj-ctx .modal-title');
  if (titleEl) titleEl.textContent = '📚 Add Subject';

  // Clear previous input values
  ['ns-nm', 'ns-ssc', 'ns-cd', 'ns-sc'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var crEl = document.getElementById('ns-cr');
  if (crEl) crEl.value = '3';
  openModal_('m-add-subj-ctx');
}

function nsScAuto() {
  var deptId = getFieldValue('ns-dept');
  var shortCode = getFieldValue('ns-ssc');
  var code = getFieldValue('ns-cd');
  var type = getFieldValue('ns-tp')[0].toUpperCase();
  if (deptId && code && type) {
    var dept = DB.get('depts').find(function (d) { return d._id === deptId; });
    var subjectCode = code + '-' + shortCode;
    document.getElementById('ns-sc').value = subjectCode;
  } else {
    document.getElementById('ns-sc').value = '';
    showToast('Please select a department, code and type', 'warn'); return;
  }

  var dup = DB.get('subjects').find(function (sub) {
    return sub.subjectCode === subjectCode;
  });

  if (dup) {
    showToast('Subject code already exists', 'warn');
    document.getElementById('es-save-btn').disabled = true;
    document.getElementById('es-save-btn').style.opacity = '0.5';
  } else {
    document.getElementById('es-save-btn').disabled = false;
    document.getElementById('es-save-btn').style.opacity = '1';
  }
}

// ── Auto Subject Code (Edit) ──────────────────────────────────────────────
function esScAuto() {
  var deptCode = getFieldValue('es-dc');
  var shortCode = getFieldValue('es-ssc');
  var code = getFieldValue('es-cd');
  var type = getFieldValue('es-tp')[0].toUpperCase();
  var editedSubjId = window.activeEditSubjId || '';

  if (deptCode && code && type) {
    var subjectCode = code + '-' + shortCode;
    document.getElementById('es-sc').value = subjectCode;
  } else {
    document.getElementById('es-sc').value = '';
    showToast('Please select a department, code and type', 'warn');
    return;
  }

  // Check for duplicates (ignore the currently editing subject)
  var dup = DB.get('subjects').find(function (sub) {
    return sub._id !== editedSubjId && sub.subjectCode === subjectCode;
  });

  if (dup) {
    showToast('Subject code already exists', 'warn');
    document.getElementById('es-save-btn').disabled = true;
    document.getElementById('es-save-btn').style.opacity = '0.5';
  } else {
    document.getElementById('es-save-btn').disabled = false;
    document.getElementById('es-save-btn').style.opacity = '1';
  }
}

function addSubCtx() {
  var name = getFieldValue('ns-nm');
  var code = getFieldValue('ns-cd');
  var credits = parseInt(getFieldValue('ns-cr')) || 3;
  var type = getFieldValue('ns-tp') || 'Theory';
  var shortCode = getFieldValue('ns-ssc');
  var subjectName = shortCode + '-' + type + ' ' + code;
  var subjectCode = getFieldValue('ns-sc');
  if (!name || !code) { showToast('Name and code required', 'warn'); return; }
  if (!structureContext.deptId) { showToast('Please select a department first by exploring structure', 'warn'); return; }
  var dept = DB.get('depts').find(function (d) { return d._id === structureContext.deptId; });
  if (DB.get('subjects').find(function (s) { return s.subjectCode === subjectCode; })) { showToast('Subject code already exists', 'warn'); return; }
  apiAddSubject({ name: name, shortName: shortCode, code: code, credits: credits, type: type, deptId: structureContext.deptId, deptName: dept.name, deptCode: dept.code, subjectCode: subjectCode })
    .then(function (newSubject) {
      if (!newSubject || newSubject.error) return;

      closeModalBg('m-add-subj-ctx');
      renderClassSubjectView(structureContext.deptId);
      addLog('Subject Added', '"' + name + '" (' + code + ')');
      dbToast('Subject "' + name + '" added', 'success');
      clearInputs(['ns-nm', 'ns-cd']);
    });
}

// ─── SUBJECT STAFF & HALL ASSIGNMENT MODAL ────────────────────────────────────
var _saSubjectId = null;

function openSubjAssignModal(subjectId) {
  _saSubjectId = subjectId;

  // Read subject info from cache or fallback
  var subj = (DB.get('subjects') || []).find(function (s) { return String(s._id) === String(subjectId); });
  var subjName = subj ? subj.name : 'Subject';
  var subInfo = subj ? (subj.code + ' · ' + (subj.credits || 0) + ' Credits · ' + (subj.type || 'Theory') + (subj.deptName ? ' · ' + subj.deptName : '')) : '';

  // Set header
  document.getElementById('sa-ttl').textContent = '\u{1F4CC} ' + subjName + ' — Assign Staff & Hall';
  document.getElementById('sa-sub').textContent = subInfo;
  document.getElementById('sa-warn').style.display = 'none';

  // Show modal immediately with loading state
  var tbody = document.getElementById('sa-rows');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:18px;color:var(--tmu);font-size:13px;">\u23f3 Loading classes &amp; teachers from database…</td></tr>';
  openModal_('m-subj-assign');

  // Fetch classes, teachers, and existing assignments in parallel to ensure fresh data
  Promise.all([
    apiCall('GET', '/classes').then(function (cls) { if (Array.isArray(cls)) DB.set('classes', cls); return cls; }).catch(function () { return DB.get('classes') || []; }),
    apiCall('GET', '/teachers').then(function (tch) { if (Array.isArray(tch)) DB.set('teachers', tch); return tch; }).catch(function () { return DB.get('teachers') || []; }),
    apiCall('GET', '/assignments?subjectId=' + encodeURIComponent(subjectId)).catch(function () { return []; })
  ])
    .then(function (results) {
      var existing = results[2];
      tbody.innerHTML = '';
      if (Array.isArray(existing) && existing.length > 0) {
        existing.forEach(function (a) { addAssignRow(a.classId, a.teacherId, a.hallNo); });
      } else {
        addAssignRow(); // one default empty row
      }
    })
    .catch(function (err) {
      console.error('[EAMS Assign Staff Load Error]:', err);
      tbody.innerHTML = '';
      addAssignRow();
      dbToast('Could not load existing assignments from DB', 'warn');
    });
}

function _buildSaClassOptions(selectedId) {
  var classes = DB.get('classes') || [];
  return '<option value="">\u2014 Select Section \u2014</option>'
    + classes.map(function (c) {
      var hall = c.hallNo || '';
      var deptName = c.deptCode || c.deptName || '';
      var label = c.name + (deptName ? ' — ' + deptName : '');
      return '<option value="' + c._id + '" data-hall="' + hall + '" data-dept="' + (c.deptId || '') + '"'
        + (String(c._id) === String(selectedId) ? ' selected' : '') + '>' + label + '</option>';
    }).join('');
}

function _buildSaTeacherOptions(selectedId, deptId) {
  var teachers = DB.get('teachers');
  if (!Array.isArray(teachers) || teachers.length === 0) {
    teachers = (DB.get('users') || []).filter(function (u) { return u.role === 'teacher'; });
  }
  if (!Array.isArray(teachers)) teachers = [];

  // Filter by deptId if matching teachers exist; otherwise show all teachers
  var listToRender = teachers;
  if (deptId) {
    var deptMatches = teachers.filter(function (t) {
      return String(t.deptId || '') === String(deptId) || String(t.dept || '') === String(deptId);
    });
    if (deptMatches.length > 0) {
      listToRender = deptMatches;
    }
  }

  return '<option value="">\u2014 Select Staff \u2014</option>'
    + listToRender.map(function (t) {
      var tName = t.fullName || t.name || t.username || 'Teacher';
      var deptBadge = t.deptCode || t.dept || t.department ? ' (' + (t.deptCode || t.dept || t.department) + ')' : '';
      return '<option value="' + t._id + '"' + (String(t._id) === String(selectedId) ? ' selected' : '') + '>' + tName + deptBadge + '</option>';
    }).join('');
}

function addAssignRow(classId, teacherId, hallNo) {
  var tbody = document.getElementById('sa-rows');
  var tr = document.createElement('tr');
  tr.className = 'sa-row';
  tr.style.borderBottom = '1px solid var(--brl)';
  var deptId = '';
  var cls = null;
  if (classId) {
    cls = (DB.get('classes') || []).find(function (c) { return String(c._id) === String(classId); });
    if (cls) deptId = cls.deptId || '';
  }
  tr.innerHTML =
    '<td style="padding:8px 10px;">'
    + '<select class="fc2 sa-cls" onchange="onSaClassChange(this)" style="font-size:13px;padding:8px 10px;min-width:150px;">'
    + _buildSaClassOptions(classId || '')
    + '</select></td>'
    + '<td style="padding:8px 10px;">'
    + '<select class="fc2 sa-tch" style="font-size:13px;padding:8px 10px;min-width:160px;">'
    + _buildSaTeacherOptions(teacherId || '', deptId)
    + '</select></td>'
    + '<td style="padding:8px 10px;">'
    + '<input type="text" class="fc2 sa-hall" placeholder="e.g. H101" maxlength="20"'
    + ' style="font-size:13px;padding:8px 10px;min-width:90px;" value="' + (hallNo || '') + '">'
    + '</td>'
    + '<td style="padding:8px 10px;text-align:center;">'
    + '<button onclick="removeAssignRow(this)" style="background:var(--red);color:#fff;border:none;border-radius:8px;'
    + 'width:28px;height:28px;cursor:pointer;font-size:15px;line-height:1;display:inline-flex;align-items:center;'
    + 'justify-content:center;" title="Remove row">✕</button>'
    + '</td>';
  tbody.appendChild(tr);
  // Auto-fill hall from class default when no hallNo supplied
  if (!hallNo && classId && cls && cls.hallNo) {
    tr.querySelector('.sa-hall').value = cls.hallNo;
  }
}

function onSaClassChange(sel) {
  var tr = sel.closest ? sel.closest('tr') : sel.parentNode.parentNode;
  if (!tr) return;
  var opt = sel.options[sel.selectedIndex];
  var hall = opt ? (opt.getAttribute('data-hall') || '') : '';
  tr.querySelector('.sa-hall').value = hall;
  // Scope teacher dropdown to selected class's department
  var deptId = opt ? (opt.getAttribute('data-dept') || '') : '';
  var tchSel = tr.querySelector('.sa-tch');
  if (tchSel) {
    var curVal = tchSel.value;
    tchSel.innerHTML = _buildSaTeacherOptions(curVal, deptId);
  }
}

function removeAssignRow(btn) {
  var tr = btn.closest ? btn.closest('tr') : btn.parentNode.parentNode;
  var tbody = document.getElementById('sa-rows');
  if (tbody.querySelectorAll('tr.sa-row').length <= 1) {
    showToast('At least one row is required', 'warn'); return;
  }
  tbody.removeChild(tr);
}

function saveSubjAssignments() {
  var warnEl = document.getElementById('sa-warn');
  warnEl.style.display = 'none';
  var rows = document.querySelectorAll('#sa-rows tr.sa-row');
  if (!rows.length) { showToast('Add at least one row', 'warn'); return; }
  var assignments = [];
  var seenClasses = {};
  var errorMsg = '';
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var classId = row.querySelector('.sa-cls').value;
    var teacherId = row.querySelector('.sa-tch').value;
    var hallNo = row.querySelector('.sa-hall').value.trim();
    if (!classId || !teacherId || !hallNo) {
      errorMsg = 'Row ' + (i + 1) + ': All fields (Section, Staff, Hall No.) are required.';
      break;
    }
    if (seenClasses[classId]) {
      var clsName = row.querySelector('.sa-cls').options[row.querySelector('.sa-cls').selectedIndex].text;
      errorMsg = 'Duplicate section "' + clsName + '" in row ' + (i + 1) + '.';
      break;
    }
    seenClasses[classId] = true;
    assignments.push({ classId: classId, teacherId: teacherId, hallNo: hallNo });
  }
  if (errorMsg) {
    warnEl.textContent = '\u26a0 ' + errorMsg;
    warnEl.style.display = 'block';
    return;
  }
  apiBulkSaveAssignments(_saSubjectId, assignments);
}

function apiBulkSaveAssignments(subjectId, assignments) {
  var subj = (DB.get('subjects') || []).find(function (s) { return String(s._id) === String(subjectId); });
  var classes = DB.get('classes') || [];
  var teachers = DB.get('teachers') || [];
  var users = DB.get('users') || [];
  var allTeachers = teachers.concat(users.filter(function (u) { return u.role === 'teacher'; }));

  if (!subj) { dbToast('Subject not found in Database', 'error'); return; }

  // Enrich rows with display names before sending to server
  var enriched = [];
  var rowErr = '';
  for (var i = 0; i < assignments.length; i++) {
    var row = assignments[i];
    var cls = classes.find(function (c) { return String(c._id) === String(row.classId); });
    var teacher = allTeachers.find(function (t) { return String(t._id) === String(row.teacherId); });
    if (!cls || !teacher) { rowErr = 'Row ' + (i + 1) + ': invalid class or teacher'; break; }
    enriched.push({
      subjectId: subjectId,
      subjectName: subj.name,
      classId: row.classId,
      className: cls.name,
      teacherId: row.teacherId,
      teacherName: teacher.fullName || teacher.name || teacher.username || 'Teacher',
      hallNo: row.hallNo,
      deptName: cls.deptName || subj.deptName || '',
      deptCode: cls.deptCode || subj.deptCode || ''
    });
  }
  if (rowErr) { showToast(rowErr, 'warn'); return; }

  dbToast('Saving to Database…', 'saving', enriched.length + ' section(s)');

  apiCall('POST', '/assignments/bulk', { subjectId: subjectId, assignments: enriched })
    .then(function (d) {
      if (!d || d.error) {
        dbToast('DB Error: ' + (d && d.error ? d.error : 'Unknown'), 'error');
        return;
      }

      dbToast('Saved to Database', 'success', d.count + ' section(s) written to DB');
      closeModalBg('m-subj-assign');
      addLog('Assignments Bulk Saved', d.count + ' sections → ' + subj.name);

      apiCall('GET', '/assignments')
        .then(function (allAssignments) {
          if (Array.isArray(allAssignments)) {
            DB.set('assignments', allAssignments);
          }
          if (structureContext && structureContext.deptId) renderClassSubjectView(structureContext.deptId);
        })
        .catch(function () {
          if (structureContext && structureContext.deptId) renderClassSubjectView(structureContext.deptId);
        });
    })
    .catch(function (err) {
      console.error('Bulk save error:', err);
      dbToast('Failed to save assignments', 'error');
    });
}


// ─── STUDENTS PAGE — GLOBAL STATE ─────────────────────────────────────────
var _studentPage = 1;
var _studentData = [];
var _studentTotal = 0;
var _studentSortBy = 'regNo';
var _studentSortDir = 'asc';
var _studentFilterSnapshot = {};

// ─── STUDENTS PAGE — NEW FUNCTIONS ──────────────────────────────────────
function populateStudentFilterDropdowns() {
  var yearEl = document.getElementById('sf-ay');
  var batchEl = document.getElementById('sf-batch');
  var deptEl = document.getElementById('sf-dept');
  var clsEl = document.getElementById('sf-cls');
  var secEl = document.getElementById('sf-sec');
  if (yearEl) { yearEl.innerHTML = '<option value="">⏳ Loading…</option>'; }
  if (batchEl) { batchEl.innerHTML = '<option value="">⏳ Loading…</option>'; }
  if (clsEl) { clsEl.innerHTML = '<option value="">All Classes</option>'; clsEl.value = ''; }
  if (secEl) { secEl.innerHTML = '<option value="">All</option>'; secEl.value = ''; }
  if (deptEl) {
    var depts = Array.isArray(DB.get('depts')) ? DB.get('depts') : [];
    deptEl.innerHTML = '<option value="">All Departments</option>'
      + depts.map(function (d) { return '<option value="' + d._id + '">' + d.name + '</option>'; }).join('');
    deptEl.value = '';
  }
  var tok = getToken();
  if (!tok) return Promise.resolve();
  return Promise.all([
    fetch('/api/year/current', { headers: { 'Authorization': 'Bearer ' + tok } }).then(function (r) { return r.json(); }),
    fetch('/api/year/batches', { headers: { 'Authorization': 'Bearer ' + tok } }).then(function (r) { return r.json(); }),
    fetch('/api/year', { headers: { 'Authorization': 'Bearer ' + tok } }).then(function (r) { return r.json(); })
  ]).then(function (results) {
    var currentYear = (typeof results[0] === 'string' && results[0]) ? results[0] : (YEAR_CONFIG.current || '');
    var batchList = Array.isArray(results[1]) ? results[1] : (Array.isArray(YEAR_CONFIG.batches) ? YEAR_CONFIG.batches : []);
    var allYears = Array.isArray(results[2]) ? results[2].map(function (y) { return y.academicYear; }).filter(Boolean) : [];
    YEAR_CONFIG.current = currentYear;
    YEAR_CONFIG.batches = batchList;
    if (allYears.length) YEAR_CONFIG.all = allYears;
    var yearOptions = (YEAR_CONFIG.all && YEAR_CONFIG.all.length) ? YEAR_CONFIG.all : (currentYear ? [currentYear] : []);
    if (yearEl) {
      yearEl.innerHTML = '<option value="">All Years</option>'
        + yearOptions.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('');
      yearEl.value = '';
    }
    if (batchEl) {
      batchEl.innerHTML = '<option value="">All Batches</option>'
        + batchList.map(function (b) { return '<option value="' + b + '">' + b + '</option>'; }).join('');
    }
  }).catch(function () {
    if (yearEl) {
      var fallbackYears = (YEAR_CONFIG.all && YEAR_CONFIG.all.length) ? YEAR_CONFIG.all : (YEAR_CONFIG.current ? [YEAR_CONFIG.current] : []);
      yearEl.innerHTML = '<option value="">All Years</option>'
        + fallbackYears.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('');
      yearEl.value = '';
    }
    if (batchEl) {
      var batchOpts = Array.isArray(YEAR_CONFIG.batches) ? YEAR_CONFIG.batches : [];
      batchEl.innerHTML = '<option value="">All Batches</option>'
        + batchOpts.map(function (b) { return '<option value="' + b + '">' + b + '</option>'; }).join('');
    }
  });
  updateShowListEnabled();
}

function _resetClassDropdown() {
  var clsEl = document.getElementById('sf-cls');
  var secEl = document.getElementById('sf-sec');
  if (clsEl) { clsEl.innerHTML = '<option value="">All Classes</option>'; clsEl.value = ''; }
  if (secEl) { secEl.innerHTML = '<option value="">All</option>'; secEl.value = ''; }
}

function _fetchClasses() {
  var deptId = document.getElementById('sf-dept') ? document.getElementById('sf-dept').value : '';
  var batch = document.getElementById('sf-batch') ? document.getElementById('sf-batch').value : '';
  var clsEl = document.getElementById('sf-cls');
  var secEl = document.getElementById('sf-sec');
  if (!deptId || !clsEl) { _resetClassDropdown(); return; }
  if (secEl) { secEl.innerHTML = '<option value="">All</option>'; secEl.value = ''; }
  clsEl.innerHTML = '<option value="">Loading…</option>';
  var tok = getToken();
  if (!tok) return;
  var url = '/api/classes?deptId=' + encodeURIComponent(deptId);
  if (batch) url += '&batch=' + encodeURIComponent(batch);
  fetch(url, { headers: { 'Authorization': 'Bearer ' + tok } })
    .then(function (r) { return r.json(); })
    .then(function (classes) {
      if (!Array.isArray(classes)) return;
      window.__filteredClasses = classes;
      clsEl.innerHTML = '<option value="">All Classes</option>'
        + classes.map(function (c) { return '<option value="' + c._id + '" data-name="' + c.name.replace(/"/g, '&quot;') + '">' + c.name + '</option>'; }).join('');
      clsEl.value = '';
    })
    .catch(function () { clsEl.innerHTML = '<option value="">All Classes</option>'; });
}

function onStudentYearChange() {
  var batchEl = document.getElementById('sf-batch');
  var ctEl = document.getElementById('sf-ct');
  var deptEl = document.getElementById('sf-dept');
  if (batchEl) { batchEl.value = ''; }
  if (ctEl) { ctEl.value = ''; }
  if (deptEl) { deptEl.value = ''; }
  _resetClassDropdown();
  updateShowListEnabled();
}

function onStudentBatchChange() {
  var ctEl = document.getElementById('sf-ct');
  var deptEl = document.getElementById('sf-dept');
  if (ctEl) { ctEl.value = ''; }
  if (deptEl) { deptEl.value = ''; }
  _resetClassDropdown();
  updateShowListEnabled();
}

function onStudentCourseTypeChange() {
  var deptEl = document.getElementById('sf-dept');
  if (deptEl) { deptEl.value = ''; }
  _resetClassDropdown();
  updateShowListEnabled();
}

function onStudentDeptChange() {
  _resetClassDropdown();
  var deptId = document.getElementById('sf-dept') ? document.getElementById('sf-dept').value : '';
  if (deptId) {
    _fetchClasses();
  }
  updateShowListEnabled();
}

function onStudentClassChange() {
  var clsEl = document.getElementById('sf-cls');
  var secEl = document.getElementById('sf-sec');
  if (!secEl) return;
  var classes = window.__filteredClasses || [];
  var selectedId = clsEl ? clsEl.value : '';
  if (!selectedId) {
    secEl.innerHTML = '<option value="">All</option>';
    updateShowListEnabled();
    return;
  }
  var selectedOpt = clsEl.querySelector('option[value="' + selectedId + '"]');
  var selectedName = selectedOpt ? selectedOpt.getAttribute('data-name') : '';
  var sections = classes
    .filter(function (c) { return c.name === selectedName && c.section; })
    .map(function (c) { return c.section; });
  var unique = [];
  sections.forEach(function (s) { if (unique.indexOf(s) === -1) unique.push(s); });
  unique.sort();
  secEl.innerHTML = '<option value="">All</option>'
    + unique.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join('');
  updateShowListEnabled();
}

function onStudentSectionChange() {
  updateShowListEnabled();
}

function updateShowListEnabled() {
  var btn = document.getElementById('btn-show-list');
  if (!btn) return;
  btn.disabled = false;
  btn.style.opacity = '1';
  btn.style.cursor = 'pointer';
}

function _buildStudentQueryString(page) {
  var ay = document.getElementById('sf-ay') ? document.getElementById('sf-ay').value : '';
  var batch = document.getElementById('sf-batch') ? document.getElementById('sf-batch').value : '';
  var ct = document.getElementById('sf-ct') ? document.getElementById('sf-ct').value : '';
  var dept = document.getElementById('sf-dept') ? document.getElementById('sf-dept').value : '';
  var cls = document.getElementById('sf-cls') ? document.getElementById('sf-cls').value : '';
  var section = document.getElementById('sf-sec') ? document.getElementById('sf-sec').value : '';
  _studentFilterSnapshot = { ay: ay, batch: batch, ct: ct, dept: dept, cls: cls, section: section };
  var params = '?page=' + (page || 1) + '&limit=65&sortBy=' + encodeURIComponent(_studentSortBy) + '&sortDir=' + _studentSortDir;
  if (ay) params += '&academicYear=' + encodeURIComponent(ay);
  if (batch) params += '&batch=' + encodeURIComponent(batch);
  if (ct) params += '&courseType=' + encodeURIComponent(ct);
  if (dept) params += '&deptId=' + encodeURIComponent(dept);
  if (cls) params += '&classId=' + encodeURIComponent(cls);
  if (section) params += '&section=' + encodeURIComponent(section);
  return params;
}

function _renderStudentTable(data, append) {
  var tbody = document.getElementById('stb');
  var total = _studentTotal;
  var countEl = document.getElementById('scb');
  if (!tbody) return;
  var rows = data.map(function (student, idx) {
    var absIdx = append ? (_studentData.length - data.length + idx + 1) : (idx + 1);
    return '<tr>'
      + '<td>' + absIdx + '</td>'
      + '<td class="b">' + (student.name || '—') + '</td>'
      + '<td>' + (student.regNo || '—') + '</td>'
      + '<td>' + (student.academicYear || '—') + '</td>'
      + '<td>' + (student.courseType || '—') + '</td>'
      + '<td>' + (student.branch || student.deptName || '—') + '</td>'
      + '<td>' + (student.deptName || '—') + '</td>'
      + '<td>' + (student.className || '—') + '</td>'
      + '<td>' + (student.section || '—') + '</td>'
      + '<td><button class="btn bgho bxs" onclick="openStuEdit(\'' + student._id + '\')">✏️</button></td>'
      + '</tr>';
  }).join('');
  if (append) {
    tbody.insertAdjacentHTML('beforeend', rows);
  } else {
    tbody.innerHTML = rows || '<tr><td colspan="10" style="text-align:center;padding:36px 16px;color:var(--tdi);">'
      + '<span style="font-size:38px;display:block;margin-bottom:10px;">👨‍🎓</span>'
      + '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">No students found matching your filters.</div>'
      + '<div style="font-size:12px;color:var(--tdi);">Try adjusting your filters or add a student using the button above.</div>'
      + '</td></tr>';
  }
  if (countEl) countEl.textContent = total + ' student' + (total === 1 ? '' : 's');
  var moreWrap = document.getElementById('load-more-wrap');
  if (moreWrap) moreWrap.style.display = (_studentData.length < total) ? 'block' : 'none';
}

function showStudentList() {
  var ay = document.getElementById('sf-ay') ? document.getElementById('sf-ay').value : '';
  _studentPage = 1;
  _studentData = [];
  var tok = getToken();
  if (!tok) return;
  var qs = _buildStudentQueryString(1);
  document.getElementById('load-more-wrap').style.display = 'none';
  document.getElementById('stb').innerHTML = '<tr><td colspan="10" style="text-align:center;padding:36px;color:var(--tdi);">⏳ Loading…</td></tr>';
  fetch('/api/students' + qs, { headers: { 'Authorization': 'Bearer ' + tok } })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      var list = Array.isArray(res) ? res : (res && Array.isArray(res.data) ? res.data : []);
      _studentData = list;
      _studentTotal = res && typeof res.total === 'number' ? res.total : list.length;
      DB.set('students', _studentData);
      _renderStudentTable(_studentData, false);
    })
    .catch(function () {
      document.getElementById('stb').innerHTML = '<tr><td colspan="10" style="text-align:center;padding:36px;color:var(--tdi);">Failed to load students.</td></tr>';
    });
}

function loadMoreStudents() {
  _studentPage++;
  var tok = getToken();
  if (!tok) return;
  var qs = _buildStudentQueryString(_studentPage);
  document.getElementById('btn-load-more').disabled = true;
  document.getElementById('btn-load-more').textContent = 'Loading…';
  fetch('/api/students' + qs, { headers: { 'Authorization': 'Bearer ' + tok } })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      var list = Array.isArray(res) ? res : (res && Array.isArray(res.data) ? res.data : []);
      _studentData = _studentData.concat(list);
      _studentTotal = res && typeof res.total === 'number' ? res.total : _studentData.length;
      DB.set('students', _studentData);
      _renderStudentTable(list, true);
      document.getElementById('btn-load-more').disabled = false;
      document.getElementById('btn-load-more').textContent = 'Load More';
    })
    .catch(function () {
      _studentPage--;
      document.getElementById('btn-load-more').disabled = false;
      document.getElementById('btn-load-more').textContent = 'Load More';
      showToast('Failed to load more students', 'error');
    });
}

function sortStudentsBy(column) {
  if (_studentSortBy === column) {
    _studentSortDir = _studentSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _studentSortBy = column;
    _studentSortDir = 'asc';
  }
  // Update sort indicators
  document.querySelectorAll('.sort-ind').forEach(function (el) {
    var col = el.getAttribute('data-sort');
    if (col === _studentSortBy) {
      el.textContent = _studentSortDir === 'asc' ? ' ▲' : ' ▼';
    } else {
      el.textContent = '';
    }
  });
  if (_studentData.length === 0) return;
  showStudentList();
}

function _refreshStudentList() {
  // Re-fetch the current list silently (called after add/edit/delete)
  if (_studentData.length === 0) return;
  showStudentList();
}

var _studentSearchQuery = '';
function filterStudentsLive(query) {
  _studentSearchQuery = (query || '').toLowerCase();
  if (!_studentData.length) {
    // No data loaded yet — do nothing (search is live only on loaded data)
    return;
  }
  var filtered = _studentData.filter(function (s) {
    if (!_studentSearchQuery) return true;
    return (s.name || '').toLowerCase().indexOf(_studentSearchQuery) !== -1
      || (s.regNo || '').toLowerCase().indexOf(_studentSearchQuery) !== -1;
  });
  var countEl = document.getElementById('scb');
  var tbody = document.getElementById('stb');
  if (countEl) countEl.textContent = _studentTotal + ' student' + (_studentTotal === 1 ? '' : 's')
    + (_studentSearchQuery ? ' (' + filtered.length + ' shown)' : '');
  if (tbody) {
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:36px 16px;color:var(--tdi);">'
        + '<span style="font-size:38px;display:block;margin-bottom:10px;">🔍</span>'
        + '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">No students match your search.</div>'
        + '</td></tr>';
    } else {
      tbody.innerHTML = filtered.map(function (student, idx) {
        return '<tr>'
          + '<td>' + (idx + 1) + '</td>'
          + '<td class="b">' + (student.name || '—') + '</td>'
          + '<td>' + (student.regNo || '—') + '</td>'
          + '<td>' + (student.academicYear || '—') + '</td>'
          + '<td>' + (student.courseType || '—') + '</td>'
          + '<td>' + (student.branch || student.deptName || '—') + '</td>'
          + '<td>' + (student.deptName || '—') + '</td>'
          + '<td>' + (student.className || '—') + '</td>'
          + '<td>' + (student.section || '—') + '</td>'
          + '<td><button class="btn bgho bxs" onclick="openStuEdit(\'' + student._id + '\')">✏️</button></td>'
          + '</tr>';
      }).join('');
    }
  }
}

function updateBranch() {
  const type = document.getElementById('co-type').value;
  const branchDD = document.getElementById('branch');

  let options = `<option value="">— Select —</option>`;

  if (type === 'UG') {
    options += `
      <option value="B.E">B.E</option>
      <option value="B.TECH">B.TECH</option>
    `;
  }
  else if (type === 'PG') {
    options += `
      <option value="M.E">M.E</option>
      <option value="M.TECH">M.TECH</option>
    `;
  }

  branchDD.innerHTML = options;
}

// ─── HOD TRACKID LOOKUP ──────────────────────────────────────────────────────
// Debounced 600 ms + 3 s minimum spinner. Checks isHod before accepting.
// API endpoint expected: GET /api/teachers/trackid/:id
//   Response: { fullName: "...", isHod: true|false }  OR  { error: "..." }
// pfx '' = Add Dept modal   |   pfx 'ed-' = Edit Dept modal

var _hodLookupTimer = null;   // debounce handle (add modal)
var _hodLookupMinTimer = null; // minimum 3-second spinner timer (add modal)
var _edHodLookupTimer = null;   // debounce handle (edit modal)
var _edHodLookupMinTimer = null; // minimum 3-second spinner timer (edit modal)

/** Reset all badge/message state — pfx '' = add modal, 'ed-' = edit modal */
function hodLookupReset(pfx) {
  pfx = pfx || '';
  [pfx + 'hod-spin', pfx + 'hod-ok', pfx + 'hod-err'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  var msgId = pfx ? pfx + 'hod-lookup-msg' : 'hod-lookup-msg';
  var msg = document.getElementById(msgId);
  if (msg) { msg.textContent = ''; msg.style.color = ''; }
}

/** Show one badge, hide the others */
function hodLookupBadge(which, pfx) {   // which: 'spin' | 'ok' | 'err'
  pfx = pfx || '';
  ['spin', 'ok', 'err'].forEach(function (k) {
    var el = document.getElementById(pfx + 'hod-' + k);
    if (el) el.style.display = (k === which) ? 'inline-block' : 'none';
  });
}

/** Called every keystroke — debounces 600 ms, then checks isHod + fetches name */
function scheduleHodLookup(rawId, pfx) {
  pfx = pfx || '';
  var timerKey = pfx ? '_edHodLookupTimer' : '_hodLookupTimer';
  var minTimerKey = pfx ? '_edHodLookupMinTimer' : '_hodLookupMinTimer';
  var id = (rawId || '').trim();

  // Clear previous debounce + minimum timer
  if (window[timerKey]) clearTimeout(window[timerKey]);
  if (window[minTimerKey]) clearTimeout(window[minTimerKey]);

  // Reset everything when field is empty
  if (!id) {
    hodLookupReset(pfx);
    var hn = document.getElementById(pfx + 'hod-name');
    if (hn) hn.value = '';
    return;
  }

  // Debounce: wait 600 ms of silence before starting
  window[timerKey] = setTimeout(function () {
    hodLookupBadge('spin', pfx);
    var msgId = pfx ? pfx + 'hod-lookup-msg' : 'hod-lookup-msg';
    var msg = document.getElementById(msgId);
    if (msg) { msg.textContent = 'Looking up TrackID…'; msg.style.color = 'var(--tmu)'; }

    var tok = getToken();
    var fetchDone = false;
    var minDone = false;
    var fetchResult = null; // { ok, name, error }

    // Minimum 3-second spinner so it doesn't flash
    window[minTimerKey] = setTimeout(function () {
      minDone = true;
      if (fetchDone) applyHodResult(fetchResult, pfx);
    }, 3000);

    // Actual API call — GET /api/teachers/trackid/:id
    fetch('/api/teachers/trackid/' + encodeURIComponent(id), {
      headers: { 'Authorization': tok ? 'Bearer ' + tok : '' }
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        fetchDone = true;
        if (data && data.fullName) {
          fetchResult = { ok: true, name: data.fullName };
        } else {
          fetchResult = { ok: false, error: data && data.error ? data.error : 'TrackID not found' };
        }
        if (minDone) applyHodResult(fetchResult, pfx);
      })
      .catch(function () {
        fetchDone = true;
        fetchResult = { ok: false, error: 'Network error — check connection' };
        if (minDone) applyHodResult(fetchResult, pfx);
      });

  }, 600);
}

/** Apply result after both fetch + 3-second minimum are done */
function applyHodResult(result, pfx) {
  pfx = pfx || '';
  var hn = document.getElementById(pfx + 'hod-name');
  var msgId = pfx ? pfx + 'hod-lookup-msg' : 'hod-lookup-msg';
  var msg = document.getElementById(msgId);

  if (result && result.ok) {
    hodLookupBadge('ok', pfx);
    if (hn) hn.value = result.name;
    if (msg) { msg.textContent = '✔ HoD verified: ' + result.name; msg.style.color = 'var(--gD)'; }
    showToast('✔ HoD verified: ' + result.name);
  } else {
    hodLookupBadge('err', pfx);
    if (hn) hn.value = '';
    var errTxt = result ? result.error : 'Unknown error';
    if (msg) { msg.textContent = '✘ ' + errTxt; msg.style.color = 'var(--red)'; }
    showToast(errTxt, 'warn');
  }
}

/** Branch dropdown updater for Edit Dept modal */
function edUpdateBranch() {
  var ct = document.getElementById('ed-cotype');
  var br = document.getElementById('ed-branch');
  if (!ct || !br) return;
  var ugBranches = ['B.E', 'B.Tech'];
  var pgBranches = ['M.E', 'M.Tech'];
  var opts = ct.value === 'UG' ? ugBranches : ct.value === 'PG' ? pgBranches : [];
  br.innerHTML = opts.length
    ? opts.map(function (o) { return '<option value="' + o + '">' + o + '</option>'; }).join('')
    : '<option value="">— Select Course Type First —</option>';
}

var _currentEditingStudentId = null;

function openStuEdit(studentId) {
  _currentEditingStudentId = studentId;

  // Search in memory: _studentData, then DB cache
  var student = (_studentData || []).find(function (x) { return String(x._id) === String(studentId); })
    || (DB.get('students') || []).find(function (x) { return String(x._id) === String(studentId); });

  if (student) {
    _populateAndShowStuEditModal(student);
    return;
  }

  // If not found in local memory, fetch directly from API
  dbToast('Loading student…', 'saving');
  apiCall('GET', '/students/' + encodeURIComponent(studentId))
    .then(function (fetched) {
      if (fetched) {
        _populateAndShowStuEditModal(fetched);
      } else {
        dbToast('Student not found in database', 'warn');
      }
    })
    .catch(function () {
      dbToast('Failed to load student details', 'error');
    });
}

function _populateAndShowStuEditModal(student) {
  if (!student) return;

  var subEl = document.getElementById('edit-subtitle');
  if (subEl) subEl.textContent = (student.regNo || '') + ' · ' + (student.className || student.deptName || '');

  var nameEl = document.getElementById('edit-name');
  if (nameEl) nameEl.value = student.name || '';

  var regNoEl = document.getElementById('edit-regNo');
  if (regNoEl) regNoEl.value = student.regNo || '';

  var trackIdEl = document.getElementById('edit-trackId');
  if (trackIdEl) trackIdEl.value = student.trackId || '';

  // firstName / lastName — use stored values or auto-split from name
  (function () {
    var fnEl = document.getElementById('edit-firstName');
    var lnEl = document.getElementById('edit-lastName');
    if (!fnEl || !lnEl) return;
    if (student.firstName || student.lastName) {
      fnEl.value = student.firstName || '';
      lnEl.value = student.lastName || '';
    } else {
      var parts = (student.name || '').split(/\s+/).filter(Boolean);
      if (parts.length === 1) { fnEl.value = parts[0]; lnEl.value = ''; }
      else if (parts.length === 2) { fnEl.value = parts[0]; lnEl.value = parts[1]; }
      else if (parts.length >= 3) { lnEl.value = parts[parts.length - 1]; fnEl.value = parts.slice(0, parts.length - 1).join(' '); }
    }
  }());

  var yearOptions = (YEAR_CONFIG.all && YEAR_CONFIG.all.length)
    ? YEAR_CONFIG.all.slice()
    : (YEAR_CONFIG.current ? [YEAR_CONFIG.current] : []);

  // Determine matching academic year strictly from YearConfig
  var selectedYear = '';
  if (student.academicYear) {
    if (yearOptions.indexOf(student.academicYear) !== -1) {
      selectedYear = student.academicYear;
    } else {
      var expanded = student.academicYear.replace(/^(\d{4})-(\d{2})$/, function (_, y1, y2) {
        return y1 + '-' + y1.slice(0, 2) + y2;
      });
      selectedYear = yearOptions.indexOf(expanded) !== -1 ? expanded : (YEAR_CONFIG.current || yearOptions[0] || '');
    }
  } else {
    selectedYear = YEAR_CONFIG.current || yearOptions[0] || '';
  }

  var editYearEl = document.getElementById('edit-year');
  if (editYearEl) {
    editYearEl.innerHTML = yearOptions.length
      ? yearOptions.map(function (y) {
        return '<option value="' + y + '"' + (y === selectedYear ? ' selected' : '') + '>' + y + '</option>';
      }).join('')
      : '<option value="">— No current academic year set —</option>';
  }

  var batchOptions = Array.isArray(YEAR_CONFIG.batches) ? YEAR_CONFIG.batches.slice() : [];
  if (student.batch && batchOptions.indexOf(student.batch) === -1) {
    batchOptions.push(student.batch);
  }
  var editBatchEl = document.getElementById('edit-batch');
  if (editBatchEl) {
    editBatchEl.innerHTML = batchOptions.length
      ? batchOptions.map(function (b) {
        return '<option' + (b === student.batch ? ' selected' : '') + '>' + b + '</option>';
      }).join('')
      : '<option value="">— No active batches set —</option>';
  }

  var ctEl = document.getElementById('edit-courseType');
  if (ctEl) ctEl.value = student.courseType || '';
  onEditCourseTypeChange(student.branch || student.course);
  setTimeout(function () {
    var brEl = document.getElementById('edit-branch');
    if (brEl) brEl.value = student.branch || student.course || '';
  }, 50);

  var depts = Array.isArray(DB.get('depts')) ? DB.get('depts') : [];
  var editDeptEl = document.getElementById('edit-dept');
  if (editDeptEl) {
    editDeptEl.innerHTML = '<option value="">— Select —</option>'
      + depts.map(function (d) {
        return '<option value="' + d._id + '"' + (String(d._id) === String(student.deptId) ? ' selected' : '') + '>' + d.name + '</option>';
      }).join('');
  }

  updateEditClassList(student.classId);

  var secEl = document.getElementById('edit-section');
  if (secEl) secEl.value = student.section || '';

  // ── login details ──
  var emailEl = document.getElementById('edit-email');
  var usernameEl = document.getElementById('edit-username');
  var passwordEl = document.getElementById('edit-password');
  if (emailEl) emailEl.value = student.email || '';
  if (usernameEl) usernameEl.value = student.username || (student.email ? student.email.split('@')[0] : '');
  if (passwordEl) passwordEl.value = '';
  _editEmailVerified = true;  // existing email is already confirmed
  _editEmailBeforeNo = '';
  openModal_('m-stu-edit');
}

function onEditCourseTypeChange(selectedCourse) {
  var courseType = document.getElementById('edit-courseType') ? document.getElementById('edit-courseType').value : '';
  var el = document.getElementById('edit-branch');
  if (!el) return;
  el.innerHTML = '<option value="">— Select —</option>'
    + (COURSES[courseType] ? Object.keys(COURSES[courseType]).map(function (c) {
      return '<option' + (c === selectedCourse ? ' selected' : '') + '>' + c + '</option>';
    }).join('') : '');
}

/** Auto-split full name into first/last when editing */
function onEditNameInput() {
  var parts = getFieldValue('edit-name').split(/\s+/).filter(Boolean);
  var fn = '', ln = '';
  if (parts.length === 1) { fn = parts[0]; ln = ''; }
  else if (parts.length === 2) { fn = parts[0]; ln = parts[1]; }
  else if (parts.length >= 3) { ln = parts[0]; fn = parts.slice(1).join(' '); }
  var fnEl = document.getElementById('edit-firstName');
  var lnEl = document.getElementById('edit-lastName');
  if (fnEl) fnEl.value = fn;
  if (lnEl) lnEl.value = ln;
}

function saveStuEdit() {
  var name = getFieldValue('edit-name');
  var firstName = getFieldValue('edit-firstName');
  var lastName = getFieldValue('edit-lastName');
  var regNo = getFieldValue('edit-regNo');
  var year = getFieldValue('edit-year');
  var ct = getFieldValue('edit-courseType');
  var batch = getFieldValue('edit-batch');
  var trackId = getFieldValue('edit-trackId');
  var branch = getFieldValue('edit-branch');
  var deptId = document.getElementById('edit-dept') ? document.getElementById('edit-dept').value : '';
  var classId = document.getElementById('edit-class') ? document.getElementById('edit-class').value : '';
  var section = getFieldValue('edit-section');
  var email = document.getElementById('edit-email') ? document.getElementById('edit-email').value.trim() : '';
  var username = getFieldValue('edit-username') || (email ? email.split('@')[0] : '');
  var password = document.getElementById('edit-password') ? document.getElementById('edit-password').value : '';

  if (!name || !regNo || !deptId || !classId) {
    showToast('Name, Register No, Department and Class are required'); return;
  }

  var studentId = _currentEditingStudentId;
  if (!studentId) {
    var allStudents = (_studentData || []).concat(DB.get('students') || []);
    var match = allStudents.find(function (s) { return s.regNo === regNo || s.name === name; });
    if (match) studentId = match._id;
  }
  if (!studentId) { showToast('Student not found'); return; }

  var depts = Array.isArray(DB.get('depts')) ? DB.get('depts') : [];
  var classes = Array.isArray(DB.get('classes')) ? DB.get('classes') : [];
  var dept = depts.find(function (d) { return String(d._id) === String(deptId); });
  var cls = classes.find(function (c) { return String(c._id) === String(classId); });

  dbToast('Saving', 'saving');
  var updatePayload = {
    name: name,
    firstName: firstName, lastName: lastName, regNo: regNo,
    academicYear: year, courseType: ct, course: branch, branch: branch,
    deptId: deptId, deptName: dept ? dept.name : '',
    classId: classId, className: cls ? cls.name : '',
    section: section, batch: batch, trackId: trackId,
    email: email, username: username
  };
  if (password) updatePayload.password = password;
  apiUpdateStudent(
    studentId, updatePayload,
    name
  )
    .then(function (d) {
      if (!d) return;
      addLog('Student Updated', '"' + name + '"');
      closeModalBg('m-stu-edit');
      _refreshStudentList();
      dbToast('Student updated', 'success');
    });
}

function dStuFromEdit() {
  var studentId = _currentEditingStudentId;
  var allStudents = (_studentData || []).concat(DB.get('students') || []);
  var student = allStudents.find(function (s) { return String(s._id) === String(studentId); });
  var sName = student ? student.name : getFieldValue('edit-name');
  if (!studentId) { showToast('Student not found', 'warn'); return; }
  document.getElementById('dc-confirm-id').value = studentId;
  document.getElementById('dc-confirm-msg').textContent = 'Delete student "' + (sName || '') + '"?';
  document.getElementById('dc-confirm-btn').onclick = function () {
    apiDeleteStudent(studentId, sName).then(function () {
      addLog('Student Deleted', '"' + sName + '"');
      closeModalBg('m-dc-confirm');
      closeModalBg('m-stu-edit');
      _refreshStudentList();
      syncBadgesFromAPI();
      dbToast('Deleted', 'success');
    }).catch(function () { dbToast('Delete failed', 'error'); });
  };
  openModal_('m-dc-confirm');
}

function addStu() {
  var name = getFieldValue('stu-name');
  var firstName = getFieldValue('stu-firstName');
  var lastName = getFieldValue('stu-lastName');
  var regNo = getFieldValue('stu-regNo');
  var trackId = getFieldValue('stu-trackId');
  if (!trackId && regNo.length >= 12) {
    var _yr = regNo.substring(4, 6);
    var _dc = regNo.substring(6, 9);
    var _rl = regNo.substring(9, 12);
    var _dp = DB.get('depts').find(function (d) { return d.number === _dc; });
    var _tc = _dp
      ? (_dp.twoLetterCode || (_dp.code ? _dp.code.slice(0, 2).toLowerCase() : ''))
      : '';
    trackId = buildStuTrackId(_yr, _tc, _rl);
    // Write it back into the field so the user can see it
    var _tidEl = document.getElementById('stu-trackId');
    if (_tidEl) _tidEl.value = trackId;
  }
  if (!trackId) { showToast('Track ID could not be generated — ensure the department has a 2-letter code', 'warn'); return; }
  var year = document.getElementById('stu-year') ? document.getElementById('stu-year').value : '';
  var batch = document.getElementById('stu-batch') ? document.getElementById('stu-batch').value : '';
  var courseType = document.getElementById('stu-courseType') ? document.getElementById('stu-courseType').value : '';
  var branch = document.getElementById('stu-branch') ? document.getElementById('stu-branch').value : '';
  var deptId = document.getElementById('stu-dept') ? document.getElementById('stu-dept').value : '';
  var classId = document.getElementById('stu-class') ? document.getElementById('stu-class').value : '';
  var section = getFieldValue('stu-section');
  var email = document.getElementById('stu-email') ? document.getElementById('stu-email').value.trim() : '';
  var username = getFieldValue('stu-username') || email.split('@')[0];
  var password = document.getElementById('stu-password') ? document.getElementById('stu-password').value : '';
  var dept = DB.get('depts').find(function (d) { return d._id === deptId; });
  var cls = DB.get('classes').find(function (c) { return c._id === classId; });

  if (!name) { showToast('Student name is required', 'warn'); return; }
  if (!regNo || regNo.length < 12) { showToast('Valid 12-digit Register Number required', 'warn'); return; }
  if (!classId) { showToast('Class is required', 'warn'); return; }
  if (!email) { showToast('Email is required', 'warn'); return; }
  if (!_stuEmailVerified) {
    showToast('Please confirm the email first (click the email field)', 'warn');
    document.getElementById('stu-email').focus(); return;
  }
  apiAddStudent({
    name: name, firstName: firstName, lastName: lastName,
    regNo: regNo, trackId: trackId,
    academicYear: year, batch: batch,
    courseType: courseType, branch: branch, course: branch,
    deptId: deptId, deptName: dept ? dept.name : '',
    classId: classId, className: cls ? cls.name : '',
    year: cls ? cls.year : '', section: section,
    email: email, username: username, password: password
  }).then(function (d) {
    if (!d) return;
    addLog('Student Added', '"' + name + '" (' + regNo + ')');
    closeModalBg('m-add-student');
    _refreshStudentList();
    syncBadgesFromAPI();
    resetStudentForm();
  });
}

function onCourseTypeChange() {
  // kept for edit-student form compatibility
  var courseType = document.getElementById('stu-courseType') ? document.getElementById('stu-courseType').value : '';
  var el = document.getElementById('stu-branch');
  if (!el) return;
  el.innerHTML = '<option value="">— Select —</option>'
    + (COURSES[courseType] ? Object.keys(COURSES[courseType]).map(function (c) { return '<option>' + c + '</option>'; }).join('') : '');
}

function onBranchChange() { /* no-op — branch is set automatically from dept */ }

// ─── ADD-STUDENT AUTO-FILL HANDLERS ─────────────────────────────────────────

/** When dept changes → fill courseType + branch from DB, filter class list */
// ─── STUDENT AUTO-FILL HELPERS ───────────────────────────────────────────────
// Register No format: 7140 | YY | DDD | RRR
//  7140 = institute, YY = year (25→2025-26), DDD = 3-digit dept.number, RRR = roll

/** Build full email: "Arun M","25","cs" → "arunm25cs@srishakthi.ac.in" */
function buildStuEmail(name, yearCode, twoCode) {
  var namePart = (name || '').trim().split(/\s+/).map(function (p) { return p.toLowerCase(); }).join('');
  if (!namePart || !yearCode || !twoCode) return '';
  return namePart + yearCode + twoCode.toLowerCase() + '@srishakthi.ac.in';
}

/** Build TrackId: "25","cs","208" → "TR25CS208" */
function buildStuTrackId(yearCode, twoCode, roll) {
  if (!yearCode || !twoCode || !roll) return '';
  return 'TR' + yearCode + twoCode.toUpperCase() + String(roll).padStart(3, '0').slice(-3);
}

/** Build teacher TrackId from empId: "EMP001" → "TREMP001" */
function buildTchTrackId() {
  var empId = getFieldValue('t-ei');
  var trackInput = document.getElementById('t-ti');

  if (!empId) {
    if (trackInput) trackInput.value = '';
    return '';
  }

  var gen = 'TR-' + empId;

  if (trackInput) {
    trackInput.value = gen;
  }

  return gen;
}

/** Find dept from DB by 3-digit register code (dept.number) */
function getDeptByNumber(deptCode) {
  return DB.get('depts').find(function (d) { return d.number === deptCode; }) || null;
}

// ── email confirm state ───────────────────────────────────────────────────────
var _stuEmailVerified = false;
var _stuEmailBeforeNo = '';   // snapshot taken when user clicks "No"

function _setStuAddBtn(on) {
  var btn = document.getElementById('btn-add-stu');
  if (!btn) return;
  btn.disabled = !on;
  btn.style.opacity = on ? '1' : '.5';
  btn.style.cursor = on ? 'pointer' : 'not-allowed';
}

/** Show the inline popup when email field is focused */
function showStuEmailPopup() {
  var emailEl = document.getElementById('stu-email');
  var popup = document.getElementById('stu-email-popup');
  if (!popup || !emailEl) return;
  if (emailEl.value.trim() && !_stuEmailVerified) {
    popup.style.display = 'block';
  }
}

function hideStuEmailPopup() {
  var popup = document.getElementById('stu-email-popup');
  if (popup) popup.style.display = 'none';
}

/** "Yes" / "No" popup buttons */
function stuEmailVerify(correct) {
  hideStuEmailPopup();
  var emailEl = document.getElementById('stu-email');
  var usernameEl = document.getElementById('stu-username');
  if (correct) {
    _stuEmailVerified = true;
    _stuEmailBeforeNo = '';
    var full = emailEl ? emailEl.value.trim() : '';
    if (usernameEl) usernameEl.value = full.split('@')[0];
    _setStuAddBtn(true);
    showToast('✓ Email confirmed');
  } else {
    // "No" — snapshot current value; any change to it will unlock Add button
    _stuEmailVerified = false;
    _stuEmailBeforeNo = emailEl ? emailEl.value.trim() : '';
    _setStuAddBtn(false);
    if (emailEl) { emailEl.focus(); emailEl.select(); }
  }
}

/** Email manually edited */
function onStuEmailInput() {
  var emailEl = document.getElementById('stu-email');
  var email = emailEl ? emailEl.value.trim() : '';
  _stuEmailVerified = false;
  hideStuEmailPopup();
  // If they changed the email after clicking "No" → auto-enable Add button
  if (_stuEmailBeforeNo && email && email !== _stuEmailBeforeNo) {
    _stuEmailVerified = true;
    var usernameEl = document.getElementById('stu-username');
    if (usernameEl) usernameEl.value = email.split('@')[0];
    _setStuAddBtn(true);
  } else {
    _setStuAddBtn(false);
  }
}

/** Called when email is auto-generated by the form (regNo / name input) */
function _stuShowEmailVerify(email) {
  _stuEmailVerified = false;
  _stuEmailBeforeNo = '';
  hideStuEmailPopup();
  _setStuAddBtn(false);
}
function onTchEmailInput() {
  var emailEl = document.getElementById('t-em');
  var email = emailEl ? emailEl.value.trim() : '';

  var usernameEl = document.getElementById('t-us');
  usernameEl.value = email.split('@')[0];
}

// ── EDIT-STUDENT EMAIL HANDLERS ───────────────────────────────────────────────
var _editEmailVerified = false;
var _editEmailBeforeNo = '';

function showEditEmailPopup() {
  var emailEl = document.getElementById('edit-email');
  var popup = document.getElementById('edit-email-popup');
  if (!popup || !emailEl) return;
  if (emailEl.value.trim() && !_editEmailVerified) {
    popup.style.display = 'block';
  }
}

function hideEditEmailPopup() {
  var popup = document.getElementById('edit-email-popup');
  if (popup) popup.style.display = 'none';
}

function editEmailVerify(correct) {
  hideEditEmailPopup();
  var emailEl = document.getElementById('edit-email');
  var usernameEl = document.getElementById('edit-username');
  if (correct) {
    _editEmailVerified = true;
    _editEmailBeforeNo = '';
    var full = emailEl ? emailEl.value.trim() : '';
    if (usernameEl) usernameEl.value = full.split('@')[0];
    showToast('✓ Email confirmed');
  } else {
    _editEmailVerified = false;
    _editEmailBeforeNo = emailEl ? emailEl.value.trim() : '';
    if (emailEl) { emailEl.focus(); emailEl.select(); }
  }
}

function onEditEmailInput() {
  var emailEl = document.getElementById('edit-email');
  var email = emailEl ? emailEl.value.trim() : '';
  hideEditEmailPopup();
  if (_editEmailBeforeNo && email && email !== _editEmailBeforeNo) {
    _editEmailVerified = true;
    var usernameEl = document.getElementById('edit-username');
    if (usernameEl) usernameEl.value = email.split('@')[0];
  } else if (email !== (document.getElementById('edit-email').__origEmail || email)) {
    _editEmailVerified = false;
  }
}

/** Update class dropdown based on selected dept and batch for Add Student */
function updateStuClassList(preserveClassId) {
  var deptId = document.getElementById('stu-dept') ? document.getElementById('stu-dept').value : '';
  var batch = document.getElementById('stu-batch') ? document.getElementById('stu-batch').value.trim() : '';
  var clsEl = document.getElementById('stu-class');
  if (!clsEl) return;

  var allClasses = Array.isArray(DB.get('classes')) ? DB.get('classes') : [];
  var filtered = allClasses.filter(function (c) {
    var matchDept = !deptId || String(c.deptId) === String(deptId);
    var matchBatch = !batch || String(c.batch || '').trim() === String(batch).trim();
    return matchDept && matchBatch;
  });

  if (filtered.length === 0) {
    clsEl.innerHTML = '<option value="">— ' + (batch ? 'No classes for batch ' + batch : 'Select batch first') + ' —</option>';
  } else {
    clsEl.innerHTML = '<option value="">— Select —</option>'
      + filtered.map(function (c) { return '<option value="' + c._id + '">' + c.name + (c.section ? ' (' + c.section + ')' : '') + '</option>'; }).join('');
  }

  if (preserveClassId && filtered.some(function (c) { return c._id === preserveClassId; })) {
    clsEl.value = preserveClassId;
  } else {
    clsEl.value = '';
  }

  onStuClassChange();
}

function onStuBatchChange() {
  updateStuClassList();
}

/** Dept dropdown changed → fill courseType/branch, filter class list by dept & batch */
function onStuDeptChange() {
  var deptId = document.getElementById('stu-dept') ? document.getElementById('stu-dept').value : '';
  var dept = DB.get('depts').find(function (d) { return d._id === deptId; });
  var ctEl = document.getElementById('stu-courseType');
  var brEl = document.getElementById('stu-branch');
  if (ctEl) ctEl.value = dept ? (dept.courseType || '') : '';
  if (brEl) brEl.value = dept ? (dept.branch || '') : '';
  updateStuClassList();
}

function onStuClassChange() {
  var classId = document.getElementById('stu-class') ? document.getElementById('stu-class').value : '';
  var cls = DB.get('classes').find(function (c) { return c._id === classId; });
  var secEl = document.getElementById('stu-section');
  if (secEl) secEl.value = cls && cls.section ? cls.section : '';
}

/** Update class dropdown based on selected dept and batch for Edit Student */
function updateEditClassList(preserveClassId) {
  var deptId = document.getElementById('edit-dept') ? document.getElementById('edit-dept').value : '';
  var batch = document.getElementById('edit-batch') ? document.getElementById('edit-batch').value.trim() : '';
  var clsEl = document.getElementById('edit-class');
  if (!clsEl) return;

  var allClasses = Array.isArray(DB.get('classes')) ? DB.get('classes') : [];
  var filtered = allClasses.filter(function (c) {
    var matchDept = !deptId || String(c.deptId) === String(deptId);
    var matchBatch = !batch || String(c.batch || '').trim() === String(batch).trim();
    return matchDept && matchBatch;
  });

  if (filtered.length === 0) {
    clsEl.innerHTML = '<option value="">— ' + (batch ? 'No classes for batch ' + batch : 'Select batch first') + ' —</option>';
  } else {
    clsEl.innerHTML = '<option value="">— Select —</option>'
      + filtered.map(function (c) { return '<option value="' + c._id + '">' + c.name + (c.section ? ' (' + c.section + ')' : '') + '</option>'; }).join('');
  }

  if (preserveClassId && filtered.some(function (c) { return c._id === preserveClassId; })) {
    clsEl.value = preserveClassId;
  } else {
    clsEl.value = '';
  }

  onEditClassChange();
}

function onEditBatchChange() {
  updateEditClassList();
}

function onEditDeptChange() {
  var deptId = document.getElementById('edit-dept') ? document.getElementById('edit-dept').value : '';
  var dept = DB.get('depts').find(function (d) { return d._id === deptId; });
  var ctEl = document.getElementById('edit-courseType');
  var brEl = document.getElementById('edit-branch');
  if (ctEl) ctEl.value = dept ? (dept.courseType || '') : '';
  if (brEl) brEl.value = dept ? (dept.branch || '') : '';
  updateEditClassList();
}

function onEditClassChange() {
  var classId = document.getElementById('edit-class') ? document.getElementById('edit-class').value : '';
  var cls = DB.get('classes').find(function (c) { return c._id === classId; });
  var secEl = document.getElementById('edit-section');
  if (secEl && cls && cls.section) secEl.value = cls.section;
}

/** Register No → decode all fields */
function onStuRegNoChange() {
  var regNo = (getFieldValue('stu-regNo') || '').replace(/\D/g, '');
  var rnEl = document.getElementById('stu-regNo');
  if (rnEl) rnEl.value = regNo;
  if (regNo.length < 12) return;

  var yearCode = regNo.substring(4, 6);
  var deptCode = regNo.substring(6, 9);
  var roll = regNo.substring(9, 12);

  // Academic year
  var acYear = '20' + yearCode + '-' + (parseInt(yearCode, 10) + 1);
  var yearEl = document.getElementById('stu-year');
  if (yearEl) {
    for (var i = 0; i < yearEl.options.length; i++) {
      if (yearEl.options[i].value === acYear || yearEl.options[i].text === acYear) {
        yearEl.value = acYear; break;
      }
    }
  }

  // Batch year
  var batchYear = '20' + yearCode + '-' + (parseInt(yearCode, 10) + 4);
  var yearEl = document.getElementById('stu-batch');
  if (yearEl) {
    for (var i = 0; i < yearEl.options.length; i++) {
      if (yearEl.options[i].value === batchYear || yearEl.options[i].text === batchYear) {
        yearEl.value = batchYear; break;
      }
    }
  }

  // Dept
  var dept = getDeptByNumber(deptCode);
  if (dept) {
    var deptEl = document.getElementById('stu-dept');
    if (deptEl) { deptEl.value = dept._id; }
    var ctEl = document.getElementById('stu-courseType');
    var brEl = document.getElementById('stu-branch');
    if (ctEl) ctEl.value = dept.courseType || '';
    if (brEl) brEl.value = dept.branch || '';
  }

  // Update class dropdown with decoded dept and batch
  updateStuClassList();

  var twoCode = dept
    ? (dept.twoLetterCode || (dept.code ? dept.code.slice(0, 2).toLowerCase() : ''))
    : '';

  // TrackId
  var tid = buildStuTrackId(yearCode, twoCode, roll);
  var tidEl = document.getElementById('stu-trackId');
  if (tidEl) tidEl.value = tid;

  // Email
  var name = getFieldValue('stu-name');
  var email = buildStuEmail(name, yearCode, twoCode);
  var emailEl = document.getElementById('stu-email');
  if (emailEl) emailEl.value = email;
  _stuShowEmailVerify(email);
}

/** Name typed → split first/last, refresh email if regNo decoded */
function onStuNameInput() {
  var trimmed = (document.getElementById('stu-name').value || '').trim();
  var parts = trimmed.split(/\s+/).filter(Boolean);

  var fn = '';
  var ln = '';

  if (parts.length === 1) {
    fn = parts[0];
  }
  else if (parts.length === 2) {
    fn = parts[0];
    ln = parts[1];
  }
  else {
    var last = parts[parts.length - 1];
    var secondLast = parts[parts.length - 2];

    var twoInitials =
      /^[A-Za-z]{1,2}$/.test(last) &&
      /^[A-Za-z]{1,2}$/.test(secondLast);

    if (twoInitials) {
      fn = parts.slice(0, -2).join(' ');
      ln = parts.slice(-2).join(' ');
    } else {
      fn = parts.slice(0, -1).join(' ');
      ln = last;
    }
  }

  var fnEl = document.getElementById('stu-firstName');
  var lnEl = document.getElementById('stu-lastName');

  if (fnEl) fnEl.value = fn;
  if (lnEl) lnEl.value = ln;


  var regNo = (getFieldValue('stu-regNo') || '');
  if (regNo.length >= 12) {
    var yearCode = regNo.substring(4, 6);
    var deptCode = regNo.substring(6, 9);
    var dept = getDeptByNumber(deptCode);
    var twoCode = dept
      ? (dept.twoLetterCode || (dept.code ? dept.code.slice(0, 2).toLowerCase() : ''))
      : '';
    if (dept && twoCode) {
      var email = buildStuEmail(trimmed, yearCode, twoCode);
      var emailEl = document.getElementById('stu-email');
      if (emailEl) emailEl.value = email;
      _stuShowEmailVerify(email);
      // Also refresh trackId in case name changed before regNo was fully decoded
      var roll = regNo.substring(9, 12);
      var tidEl = document.getElementById('stu-trackId');
      if (tidEl && !tidEl.value) tidEl.value = buildStuTrackId(yearCode, twoCode, roll);
    }
  }
}

function onTchNameInput() {
  var trimmed = (document.getElementById('t-nm').value || '').trim();
  var parts = trimmed.split(/\s+/).filter(Boolean);

  var fn = '';
  var ln = '';

  if (parts.length === 1) {
    fn = parts[0];
  }
  else if (parts.length === 2) {
    fn = parts[0];
    ln = parts[1];
  }
  else {
    var last = parts[parts.length - 1];
    var secondLast = parts[parts.length - 2];

    var twoInitials =
      /^[A-Za-z]{1,2}$/.test(last) &&
      /^[A-Za-z]{1,2}$/.test(secondLast);

    if (twoInitials) {
      fn = parts.slice(0, -2).join(' ');
      ln = parts.slice(-2).join(' ');
    } else {
      fn = parts.slice(0, -1).join(' ');
      ln = last;
    }
  }

  document.getElementById('t-fn').value = fn;
  document.getElementById('t-ln').value = ln;
}

var ADMIN_RIGHTS_OPTIONS = ['all', 'controlPage', 'timetablePage', 'managePage', 'adderModules', 'deletings', 'bulkPage', 'settingsPage', 'settingsModule', 'reportsModule', 'downloadDatas'];
var STUDENT_PASSWORD = 'teacher123';

// ─── RESET / CLEAR HELPERS ───────────────────────────────────────────────────
function resetDeptForm() {
  clearInputs(['dept-name', 'dept-2code', 'dept-code', 'dept-number', 'hod-id', 'hod-name']);
  var coEl = document.getElementById('co-type'); if (coEl) coEl.value = '';
  var brEl = document.getElementById('branch'); if (brEl) brEl.innerHTML = '<option value="">— Select Course Type First —</option>';
  hodLookupReset('');
}

function resetTeacherForm() {
  clearInputs(['t-nm', 't-fn', 't-ln', 't-ei', 't-us', 't-ti']);

  var password = STUDENT_PASSWORD;
  var pwEl = document.getElementById('t-pw'); if (pwEl) pwEl.value = password;
  var dpEl = document.getElementById('t-dp'); if (dpEl) dpEl.value = '';
  var dgEl = document.getElementById('t-dg'); if (dgEl) dgEl.selectedIndex = 0;
  ['t-hod', 't-advisor', 't-examcoord', 't-tt', 't-warden', 't-placement'].concat(
    ADMIN_RIGHTS_OPTIONS.map(function (r) { return 't-' + r; })
  ).forEach(function (id) {
    var el = document.getElementById(id); if (el) el.checked = false;
  });
}

function resetStudentForm() {
  clearInputs(['stu-name', 'stu-firstName', 'stu-lastName', 'stu-courseType', 'stu-branch', 'stu-trackId', 'stu-section', 'stu-email', 'stu-username']);
  var rnEl = document.getElementById('stu-regNo'); if (rnEl) rnEl.value = '7140';
  var pwEl = document.getElementById('stu-password'); if (pwEl) pwEl.value = '';
  var dpEl = document.getElementById('stu-dept'); if (dpEl) dpEl.value = '';
  updateStuClassList();
  hideStuEmailPopup();
  _stuEmailVerified = false;
  _stuEmailBeforeNo = '';
  _setStuAddBtn(false);
}

// ─── TEACHERS PAGE — GLOBAL STATE ────────────────────────────────────────
var _teacherData = [];
var _teacherSearchQuery = '';
var _teacherDesigFilter = '';
var _teacherRoleFilter = 'all'; // 'all' | 'hod' | 'advisor'
var _teacherViewMode = 'grid';  // 'grid' | 'table'
var _teacherSortBy = '';        // '' | 'name' | 'empId'
var _teacherSortDir = 'asc';

// ─── TEACHERS PAGE — NEW FUNCTIONS ──────────────────────────────────────
function populateTeacherDeptDropdown() {
  var deptFilter = document.getElementById('tf-dept');
  if (!deptFilter) return;
  var depts = Array.isArray(DB.get('depts')) ? DB.get('depts') : [];
  deptFilter.innerHTML = '<option value="">All Departments</option>'
    + depts.map(function (d) { return '<option value="' + d._id + '">' + d.name + '</option>'; }).join('');
  deptFilter.value = '';
}

function onTeacherDeptChange() {
  var dept = document.getElementById('tf-dept') ? document.getElementById('tf-dept').value : '';
  var grid = document.getElementById('tgr');
  if (!grid) return;
  grid.className = 'tgrd';
  grid.innerHTML = '<div class="emst"><span class="emico" style="font-size:28px;">⏳</span><div class="emtx">Loading teachers…</div></div>';
  var params = dept ? '?deptId=' + encodeURIComponent(dept) : '';
  apiCall('GET', '/teachers' + params)
    .then(function (list) {
      _teacherData = Array.isArray(list) ? list : [];
      _teacherSearchQuery = '';
      var qEl = document.getElementById('tf-q'); if (qEl) qEl.value = '';
      _renderTeacherGrid(_teacherData);
    })
    .catch(function () {
      grid.innerHTML = '<div class="emst"><span class="emico">👩‍🏫</span><div class="emtx">Failed to load teachers. Try again.</div></div>';
    });
}

// Build the small colored role/admin badges shared by the card grid and the table view
function _teacherRoleBadges(teacher) {
  var hasAdmin = Array.isArray(teacher.adminRights) && teacher.adminRights.length && teacher.adminRights.indexOf('none') === -1;
  return (teacher.isHOD ? '<span class="t-role-badge hod">HOD</span>' : '')
    + (teacher.isClassAdvisor ? '<span class="t-role-badge advisor">Class Advisor</span>' : '')
    + (hasAdmin ? '<span class="t-role-badge admin">Admin</span>' : '');
}

// Applies search + designation + role-pill filters, then sorting (table columns only)
function _getFilteredTeachers(data) {
  var query = _teacherSearchQuery;
  var desig = _teacherDesigFilter;
  var role = _teacherRoleFilter;
  var display = (data || []).filter(function (t) {
    if (query) {
      var hit = (t.name || '').toLowerCase().indexOf(query) !== -1
        || (t.empId || '').toLowerCase().indexOf(query) !== -1
        || (t.dept || '').toLowerCase().indexOf(query) !== -1
        || (t.email || '').toLowerCase().indexOf(query) !== -1;
      if (!hit) return false;
    }
    if (desig && t.desig !== desig) return false;
    if (role === 'hod' && !t.isHOD) return false;
    if (role === 'advisor' && !t.isClassAdvisor) return false;
    return true;
  });
  if (_teacherSortBy) {
    var field = _teacherSortBy;
    var dir = _teacherSortDir === 'desc' ? -1 : 1;
    display = display.slice().sort(function (a, b) {
      var av = (a[field] || '').toString().toLowerCase();
      var bv = (b[field] || '').toString().toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }
  return display;
}

// Renders the 4 mini stat cards. Reflects the currently-loaded dept scope (_teacherData),
// not the search/role/designation view-filters below it — same convention as the Dashboard.
function _renderTeacherStats(data) {
  var el = document.getElementById('t-stat-cards');
  if (!el) return;
  var list = Array.isArray(data) ? data : [];
  var total = list.length;
  var hods = list.filter(function (t) { return t.isHOD; }).length;
  var deptSet = {};
  list.forEach(function (t) { if (t.dept) deptSet[t.dept] = true; });
  var deptCount = Object.keys(deptSet).length;
  var adminCount = list.filter(function (t) {
    return Array.isArray(t.adminRights) && t.adminRights.length && t.adminRights.indexOf('none') === -1;
  }).length;

  var cards = [
    { label: 'Total Teachers', val: total, icon: '👩‍🏫', cls: 'green', id: 't-stat-teachers' },
    { label: 'HODs', val: hods, icon: '👑', cls: 'blue', id: 't-stat-hods' },
    { label: 'Departments', val: deptCount, icon: '🏛️', cls: 'amber', id: 't-stat-depts' },
    { label: 'With Admin Rights', val: adminCount, icon: '🔐', cls: 'purple', id: 't-stat-admin' }
  ];
  el.innerHTML = cards.map(function (c) {
    return '<div class="t-stat-mini">'
      + '<div class="t-stat-icon ' + c.cls + '">' + c.icon + '</div>'
      + '<div><div class="t-stat-val" id="' + c.id + '">' + c.val + '</div><div class="t-stat-label">' + c.label + '</div></div>'
      + '</div>';
  }).join('');
}

function _renderTeacherGrid(data) {
  var grid = document.getElementById('tgr');
  if (!grid) return;

  _renderTeacherStats(data);

  var display = _getFilteredTeachers(data);
  var hasActiveFilters = !!(_teacherSearchQuery || _teacherDesigFilter || (_teacherRoleFilter && _teacherRoleFilter !== 'all'));

  grid.className = 'tgrd';
  if (!display.length) {
    var deptVal = document.getElementById('tf-dept') ? document.getElementById('tf-dept').value : '';
    var emptyMsg = hasActiveFilters ? 'No teachers match the current filters.' : (deptVal ? 'No teachers found in this department.' : 'No teachers found.');
    grid.innerHTML = '<div class="emst"><span class="emico">👩‍🏫</span>'
      + '<div class="emtx">' + emptyMsg + '</div>'
      + '<div style="margin-top:10px;font-size:12px;color:var(--tdi);">Add a teacher using the button above.</div></div>';
  } else {
    var assignments = Array.isArray(DB.get('assignments')) ? DB.get('assignments') : [];
    grid.innerHTML = display.map(function (teacher) {
      var assignmentCount = assignments.filter(function (a) { return a.teacherId === teacher._id; }).length;
      var nameInitial = ((teacher.name || '')[0] || 'T').toUpperCase();
      var tid = teacher._id;
      var isActive = teacher.status ? teacher.status === 'active' : (teacher.active !== false);
      var badges = _teacherRoleBadges(teacher);
      return '<div class="tcrd" onclick="openTD(\'' + tid + '\')">'
        + '<div class="tav">' + nameInitial
        + '<span class="t-status-dot' + (isActive ? '' : ' inactive') + '" title="' + (isActive ? 'Active' : 'Inactive') + '"></span>'
        + '</div>'
        + '<div class="tnm">' + (teacher.name || '—') + '</div>'
        + '<div class="tdp">' + (teacher.desig || '—') + ' · ' + (teacher.dept || '—') + '</div>'
        + (teacher.email ? '<div class="t-email" title="' + teacher.email + '">✉️ ' + teacher.email + '</div>' : '')
        + (badges ? '<div style="margin-top:8px;">' + badges + '</div>' : '')
        + '<div class="tsts">'
        + '<div class="tst2"><span>' + assignmentCount + '</span>Subjects</div>'
        + '<div class="tst2"><span>' + (teacher.empId || '—') + '</span>Emp ID</div>'
        + '</div>'
        + '<div style="display:flex;gap:6px;margin-top:12px;justify-content:center;flex-wrap:wrap;">'
        + '<button class="btn bgho bxs" onclick="event.stopPropagation();openTD(\'' + tid + '\')" title="View / Edit teacher">✏️ Edit</button>'
        + '</div></div>';
    }).join('');
  }

  _renderTeacherTable(display);
}

// Renders the table view body from an already-filtered/sorted list
function _renderTeacherTable(list) {
  var tbody = document.getElementById('ttbl-body');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:28px;color:var(--tdi);">No teachers match the current filters.</td></tr>';
    return;
  }
  var assignments = Array.isArray(DB.get('assignments')) ? DB.get('assignments') : [];
  tbody.innerHTML = list.map(function (teacher, i) {
    var tid = teacher._id;
    var assignmentCount = assignments.filter(function (a) { return a.teacherId === tid; }).length;
    var badges = _teacherRoleBadges(teacher) || '<span style="color:var(--tdi);">—</span>';
    var safeName = (teacher.name || '').replace(/'/g, "\\'");
    return '<tr>'
      + '<td>' + (i + 1) + '</td>'
      + '<td class="b">' + (teacher.name || '—') + '</td>'
      + '<td>' + (teacher.empId || '—') + '</td>'
      + '<td>' + (teacher.dept || '—') + '</td>'
      + '<td>' + (teacher.desig || '—') + '</td>'
      + '<td class="t-email-cell" title="' + (teacher.email || '') + '">' + (teacher.email || '—') + '</td>'
      + '<td>' + badges + '</td>'
      + '<td>' + assignmentCount + '</td>'
      + '<td>'
      + '<button class="btn bout bxs" onclick="event.stopPropagation();openTD(\'' + tid + '\')" title="View / Edit">✏️</button> '
      + '<button class="btn bdan bxs" onclick="event.stopPropagation();_confirmDeleteTeacher(\'' + tid + '\',\'' + safeName + '\',false)" title="Delete">🗑️</button>'
      + '</td>'
      + '</tr>';
  }).join('');
}

// Switches between grid and table views (both are kept rendered in sync; this just toggles visibility)
function toggleTeacherView(mode) {
  _teacherViewMode = mode;
  var gridBtn = document.getElementById('t-vt-grid');
  var tblBtn = document.getElementById('t-vt-table');
  var gridEl = document.getElementById('tgr');
  var tblEl = document.getElementById('ttbl-wrap');
  if (gridBtn) gridBtn.classList.toggle('act', mode === 'grid');
  if (tblBtn) tblBtn.classList.toggle('act', mode === 'table');
  if (gridEl) gridEl.style.display = mode === 'grid' ? '' : 'none';
  if (tblEl) tblEl.style.display = mode === 'table' ? '' : 'none';
}

// Role filter pills — All / HOD / Class Advisor / TT Coordinator
function filterTeachersByRole(role) {
  _teacherRoleFilter = role;
  document.querySelectorAll('#t-role-pills .t-pill').forEach(function (btn) {
    btn.classList.toggle('act', btn.getAttribute('data-role') === role);
  });
  _renderTeacherGrid(_teacherData);
}

// Designation dropdown filter
function filterTeachersByDesig() {
  var el = document.getElementById('tf-desig');
  _teacherDesigFilter = el ? el.value : '';
  _renderTeacherGrid(_teacherData);
}

// Sortable table columns — Name / Emp ID
function sortTeachersBy(column) {
  if (_teacherSortBy === column) {
    _teacherSortDir = _teacherSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _teacherSortBy = column;
    _teacherSortDir = 'asc';
  }
  document.querySelectorAll('#ttbl-wrap .sort-ind').forEach(function (el) {
    var col = el.getAttribute('data-sort');
    el.textContent = (col === _teacherSortBy) ? (_teacherSortDir === 'asc' ? ' ▲' : ' ▼') : '';
  });
  _renderTeacherGrid(_teacherData);
}

// Exports the currently filtered + sorted teacher list to an .xlsx file
function exportTeachersXlsx() {
  if (typeof XLSX === 'undefined') { showToast('XLSX library not loaded yet', 'warn'); return; }
  var list = _getFilteredTeachers(_teacherData);
  if (!list.length) { showToast('No teachers to export', 'warn'); return; }
  var assignments = Array.isArray(DB.get('assignments')) ? DB.get('assignments') : [];
  var headers = ['#', 'Name', 'Emp ID', 'Department', 'Designation', 'Email', 'Roles', 'Subjects'];
  var rows = list.map(function (t, i) {
    var tid = t.trackId || t._id;
    var subjectCount = assignments.filter(function (a) { return a.teacherId === tid; }).length;
    var roles = [];
    if (t.isHOD) roles.push('HOD');
    if (t.isClassAdvisor) roles.push('Class Advisor');
    if (t.isTimeTableCoordinator) roles.push('TT Coordinator');
    if (Array.isArray(t.adminRights) && t.adminRights.length && t.adminRights.indexOf('none') === -1) roles.push('Admin');
    return [i + 1, t.name || '', t.empId || '', t.dept || '', t.desig || '', t.email || '', roles.join(', ') || '—', subjectCount];
  });
  var allData = [headers].concat(rows);
  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet(allData);
  XLSX.book_append_sheet(wb, ws, 'Teachers');
  var fileName = 'Teachers_' + new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, fileName + '.xlsx');
  showToast('Exported ' + rows.length + ' teacher(s)', 'success');
}

// Shared delete-confirmation flow — used by both the detail modal's Delete button
// and the new table view's inline Delete action.
function _confirmDeleteTeacher(tid, name, closeDetailModal) {
  requireSpecialPw(function () {
    document.getElementById('dc-confirm-msg').textContent =
      'Delete teacher "' + name + '"? This permanently removes them and all their assignments. Restorable via Undo for 10 days.';
    document.getElementById('dc-confirm-btn').textContent = 'Confirm Delete';
    document.getElementById('dc-confirm-btn').onclick = function () {
      var btn = document.getElementById('dc-confirm-btn');
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      apiDeleteTeacher(tid, name).then(function () {
        DB.delete('users', tid);
        DB.get('assignments').filter(function (a) { return a.teacherId === tid; })
          .forEach(function (a) { DB.delete('assignments', a._id); });
        addLog('Teacher Deleted', '"' + name + '"');
        closeModalBg('m-dc-confirm');
        if (closeDetailModal) closeModalBg('m-tch-detail');
        _teacherData = _teacherData.filter(function (t) { return (t.trackId || t._id) !== tid; });
        _renderTeacherGrid(_teacherData);
      }).catch(function (err) {
        dbToast('Delete failed: ' + (err.message || 'server error'), 'error');
      }).finally(function () {
        btn.disabled = false;
        btn.textContent = 'Confirm Delete';
      });
    };
    openModal_('m-dc-confirm');
  });
}

function renderTeachers() {
  var grid = document.getElementById('tgr');
  if (!grid) return;
  if (_teacherData.length) {
    _renderTeacherGrid(_teacherData);
  } else {
    grid.innerHTML = '<div class="emst"><span class="emico" style="font-size:28px;">⏳</span><div class="emtx">Loading teachers…</div></div>';
    _refreshTeacherList();
  }
}

function filterTeachersLive(query) {
  _teacherSearchQuery = (query || '').toLowerCase();
  _renderTeacherGrid(_teacherData);
}

function openTD(teacherId) {
  if (!teacherId) return;

  // Look up across _teacherData first, then DB.get('users')
  var teacher = (_teacherData || []).find(function (t) {
    return String(t._id) === String(teacherId) ||
           String(t.trackId) === String(teacherId) ||
           String(t.shadowId) === String(teacherId) ||
           String(t.employeeNo) === String(teacherId) ||
           String(t.empId) === String(teacherId);
  });

  if (!teacher) {
    teacher = (DB.get('users') || []).find(function (u) {
      return (String(u._id) === String(teacherId) ||
              String(u.trackId) === String(teacherId) ||
              String(u.shadowId) === String(teacherId) ||
              String(u.roleDocId) === String(teacherId)) &&
             (u.role === 'teacher' || !u.role);
    });
  }

  if (!teacher) {
    dbToast('Loading teacher details…', 'saving');
    apiCall('GET', '/teachers/' + teacherId).then(function (t) {
      if (t && (t._id || t.trackId)) {
        if (!_teacherData) _teacherData = [];
        _teacherData.push(t);
        openTD(t._id || teacherId);
      } else {
        dbToast('Teacher not found', 'warn');
      }
    }).catch(function () {
      dbToast('Could not load teacher details', 'error');
    });
    return;
  }

  currentTeacherId = teacher._id || teacher.roleDocId || teacherId;

  var tName = teacher.name || teacher.fullName || '';
  var tDesig = teacher.desig || teacher.designation || 'Assistant Professor';
  var tDept = teacher.dept || teacher.department || '';
  var tEmpId = teacher.empId || teacher.employeeNo || '';
  var tUsername = teacher.username || '';

  var nmEl = document.getElementById('td-nm');
  if (nmEl) nmEl.textContent = tName || 'Teacher Details';

  var dpEl = document.getElementById('td-dp');
  if (dpEl) dpEl.textContent = (tDesig || '—') + ' · ' + (tDept || '—') + ' · ' + (tEmpId || '—');

  var editNmEl = document.getElementById('td-edit-nm');
  if (editNmEl) editNmEl.value = tName;

  var editEiEl = document.getElementById('td-edit-ei');
  if (editEiEl) editEiEl.value = tEmpId;

  var editUsEl = document.getElementById('td-edit-us');
  if (editUsEl) editUsEl.value = tUsername;

  var editPwEl = document.getElementById('td-edit-pw');
  if (editPwEl) editPwEl.value = '';

  var sp = Array.isArray(teacher.specials) ? teacher.specials : [];
  var KNOWN_SPECIAL_CHECKBOXES = {
    isHod: 'td-sp-hod', isClassAdvisor: 'td-sp-advisor', isExamCoordinator: 'td-sp-exam',
    isTimeTableCoordinator: 'td-sp-tt', isWarden: 'td-sp-warden', isPlacementCoordinator: 'td-sp-placement'
  };
  Object.keys(KNOWN_SPECIAL_CHECKBOXES).forEach(function (opt) {
    var el = document.getElementById(KNOWN_SPECIAL_CHECKBOXES[opt]);
    if (el) el.checked = sp.some(function (s) { return s.option === opt; });
  });
  _editSpecialsCustom = sp.filter(function (s) { return !KNOWN_SPECIAL_CHECKBOXES.hasOwnProperty(s.option); });

  var ar = Array.isArray(teacher.adminRights) ? teacher.adminRights : [];
  ADMIN_RIGHTS_OPTIONS.forEach(function (r) {
    var el = document.getElementById('td-ar-' + r);
    if (el) el.checked = ar.indexOf(r) !== -1;
  });

  var depts = Array.isArray(DB.get('depts')) ? DB.get('depts') : [];
  var teacherDeptId = teacher.deptId ? (typeof teacher.deptId === 'object' && teacher.deptId._id ? teacher.deptId._id : teacher.deptId) : '';
  var deptSelectEl = document.getElementById('td-edit-dept');
  if (deptSelectEl) {
    deptSelectEl.innerHTML = '<option value="">— Select —</option>' + depts.map(function (d) {
      var selected = (String(d._id) === String(teacherDeptId) || (tDept && (d.name === tDept || d.code === tDept))) ? ' selected' : '';
      return '<option value="' + d._id + '"' + selected + '>' + d.name + '</option>';
    }).join('');
  }

  var desigEl = document.getElementById('td-edit-dg');
  if (desigEl) {
    var hasOption = Array.from(desigEl.options).some(function (o) { return o.value === tDesig; });
    if (!hasOption && tDesig) {
      var opt = document.createElement('option');
      opt.value = tDesig;
      opt.textContent = tDesig;
      desigEl.appendChild(opt);
    }
    desigEl.value = tDesig || 'Assistant Professor';
  }

  var tid = teacher._id || teacher.roleDocId || teacherId;
  var assignments = Array.isArray(DB.get('assignments')) ? DB.get('assignments') : [];
  var teacherAssignments = assignments.filter(function (a) { return String(a.teacherId) === String(tid) || (teacher.trackId && a.teacherTrackId === teacher.trackId); });
  
  var asgnEl = document.getElementById('td-asgn');
  if (asgnEl) {
    asgnEl.innerHTML = teacherAssignments.length
      ? teacherAssignments.map(function (a) {
        return '<div class="arow">'
          + '<div class="ainfo">'
          + '<div class="anm">📚 ' + a.subjectName + '</div>'
          + '<div class="acls">🏫 ' + a.className + ' · ' + (a.deptName || '') + '</div>'
          + '</div>'
          + '<button class="btn bdan bxs" onclick="rmAsgn(\'' + a._id + '\',\'teacher\')">✖</button>'
          + '</div>';
      }).join('')
      : '<div style="text-align:center;padding:18px;color:var(--tdi);font-size:12px;">No assignments.</div>';
  }

  var delEl = document.getElementById('td-del');
  if (delEl) {
    delEl.onclick = function () {
      _confirmDeleteTeacher(tid, tName, true);
    };
  }

  openModal_('m-tch-detail');
}

function saveTchEdit() {
  var name = getFieldValue('td-edit-nm');
  var empId = getFieldValue('td-edit-ei');
  var deptSel = document.getElementById('td-edit-dept');
  var dept = deptSel ? deptSel.options[deptSel.selectedIndex]?.text || '' : '';
  var deptId = deptSel ? deptSel.value || null : null;
  var deptCode = '';
  var desig = getFieldValue('td-edit-dg');
  var username = getFieldValue('td-edit-us');
  var password = getFieldValue('td-edit-pw');
  if (!name) { showToast('Name required', 'warn'); return; }

  var depts = DB.get('depts');
  var matchedDept = depts.find(function (d) { return String(d._id) === String(deptId); });
  if (matchedDept) {
    deptCode = matchedDept.code || matchedDept.threeLetterCode || '';
    dept = matchedDept.name;
  }

  var specials = [];
  if (document.getElementById('td-sp-hod').checked) specials.push({ option: 'isHod', value: true, key: dept });
  if (document.getElementById('td-sp-advisor').checked) specials.push({ option: 'isClassAdvisor', value: true, key: dept });
  if (document.getElementById('td-sp-exam').checked) specials.push({ option: 'isExamCoordinator', value: true, key: dept });
  if (document.getElementById('td-sp-tt').checked) specials.push({ option: 'isTimeTableCoordinator', value: true, key: dept });
  if (document.getElementById('td-sp-warden').checked) specials.push({ option: 'isWarden', value: true, key: dept });
  if (document.getElementById('td-sp-placement').checked) specials.push({ option: 'isPlacementCoordinator', value: true, key: dept });
  specials = specials.concat(_editSpecialsCustom);

  var adminRights = ADMIN_RIGHTS_OPTIONS.filter(function (r) {
    var el = document.getElementById('td-ar-' + r);
    return el && el.checked;
  });
  if (!adminRights.length) adminRights = ['none'];

  var updates = { name: name, empId: empId, dept: dept, deptId: deptId, deptCode: deptCode, desig: desig, username: username, specials: specials, adminRights: adminRights };
  if (password) updates.password = password;

  apiUpdateTeacher(currentTeacherId, updates, name).then(function (d) {
    if (!d) return;
    addLog('Teacher Updated', '"' + name + '"');
    closeModalBg('m-tch-detail');
    _refreshTeacherList();
    dbToast('Teacher updated', 'success');
  }).catch(function (err) { dbToast('Failed to update: ' + (err.message || 'error'), 'error'); });
}

function addTch() {
  var fullName = getFieldValue('t-nm');
  var firstName = getFieldValue('t-fn');
  var lastName = getFieldValue('t-ln');
  var empId = getFieldValue('t-ei');
  var deptSel = document.getElementById('t-dp');
  var dept = deptSel ? deptSel.options[deptSel.selectedIndex]?.text || '' : '';
  var deptId = deptSel ? deptSel.value || null : null;
  var deptCode = '';
  var desig = document.getElementById('t-dg')?.value || '';
  var uname = getFieldValue('t-us')?.toLowerCase();
  var email = getFieldValue('t-em') || '';
  var passwd = getFieldValue('t-pw') || 'teacher123';
  var trackId = getFieldValue('t-ti') || buildTchTrackId(empId);

  var depts = DB.get('depts');
  var matchedDept = depts.find(function (d) { return String(d._id) === String(deptId); });
  if (matchedDept) {
    deptCode = matchedDept.code || matchedDept.threeLetterCode || '';
    dept = matchedDept.name;
  }

  var isHOD = document.getElementById('t-hod')?.checked || false;
  var isAdv = document.getElementById('t-advisor')?.checked || false;
  var isExam = document.getElementById('t-examcoord')?.checked || false;
  var isTt = document.getElementById('t-tt')?.checked || false;
  var isWarden = document.getElementById('t-warden')?.checked || false;
  var isPlacement = document.getElementById('t-placement')?.checked || false;

  if (!fullName || !uname) { showToast('Name and username required', 'warn'); return; }
  if (!trackId) { showToast('Track ID could not be generated — enter Employee ID first', 'warn'); return; }

  var specials = [];

  if (isHOD) specials.push({ option: 'isHod', value: true, key: dept });
  if (isAdv) specials.push({ option: 'isClassAdvisor', value: true, key: dept });
  if (isExam) specials.push({ option: 'isExamCoordinator', value: true, key: dept });
  if (isTt) specials.push({ option: 'isTimeTableCoordinator', value: true, key: dept });
  if (isWarden) specials.push({ option: 'isWarden', value: true, key: dept });
  if (isPlacement) specials.push({ option: 'isPlacementCoordinator', value: true, key: dept });

  var adminRights = ADMIN_RIGHTS_OPTIONS.filter(function (r) {
    var el = document.getElementById('t-' + r);
    return el && el.checked;
  });
  if (!adminRights.length) adminRights = ['none'];

  const payload = {
    fullName, firstName, lastName, employeeNo: empId, email: email,
    department: dept, deptId: deptId, deptCode: deptCode, designation: desig, email, username: uname, password: passwd,
    trackId, specials, adminRights, mustChangePassword: true, firstLogin: null
  };

  apiAddTeacher(payload)
    .then(function (d) {
      if (!d) return;

      addLog('Teacher Added', '"' + fullName + '" trackId=' + trackId);
      closeModalBg('m-add-teacher');
      _refreshTeacherList();
      syncBadgesFromAPI();
      dbToast('Teacher "' + fullName + '" added to Database — Password: ' + passwd, 'success');
      resetTeacherForm();
    });
}

function oaat() {
  var depts = DB.get('depts');
  document.getElementById('at-dp').innerHTML = '<option value="">— Select Dept —</option>'
    + depts.map(function (d) { return '<option value="' + d._id + '">' + d.name + '</option>'; }).join('');
  document.getElementById('at-cl').innerHTML = '<option value="">— Select Class —</option>';
  document.getElementById('at-sb').innerHTML = '<option value="">— Select Subject —</option>';
  openModal_('m-add-asgn-t');
}

function atdc() {
  var deptId = document.getElementById('at-dp').value;
  var classes = DB.get('classes').filter(function (c) { return !deptId || c.deptId === deptId; });
  var subjects = DB.get('subjects').filter(function (s) { return !deptId || s.deptId === deptId; });
  document.getElementById('at-cl').innerHTML = '<option value="">— Select Class —</option>'
    + classes.map(function (c) { return '<option value="' + c._id + '">' + c.name + '</option>'; }).join('');
  document.getElementById('at-sb').innerHTML = '<option value="">— Select Subject —</option>'
    + subjects.map(function (s) { return '<option value="' + s._id + '">' + s.name + ' (' + s.code + ')</option>'; }).join('');
}

function savTA() {
  var classId = document.getElementById('at-cl').value;
  var subjectId = document.getElementById('at-sb').value;
  if (!classId || !subjectId) { showToast('Select class and subject', 'warn'); return; }
  var cls = DB.get('classes').find(function (c) { return c._id === classId; });
  var subj = DB.get('subjects').find(function (s) { return s._id === subjectId; });
  var teacher = (_teacherData || []).find(function (t) { return String(t._id) === String(currentTeacherId) || String(t.trackId) === String(currentTeacherId); }) || (DB.get('users') || []).find(function (u) { return String(u._id) === String(currentTeacherId) || String(u.trackId) === String(currentTeacherId); });
  if (DB.one('assignments', { classId: classId, subjectId: subjectId })) { showToast('Already assigned', 'warn'); return; }
  dbToast('Saving...', 'saving');
  apiCall('POST', '/assignments', {
    classId: classId, className: cls.name,
    subjectId: subjectId, subjectName: subj.name,
    teacherId: currentTeacherId, teacherName: teacher ? (teacher.name || teacher.fullName) : '',
    deptName: cls.deptName, deptCode: cls.deptCode
  }).then(function (d) {
    if (!d || d.error) { dbToast('DB Error: ' + (d && d.error ? d.error : 'Unknown'), 'error'); return; }
    return apiCall('GET', '/assignments').then(function (all) {
      if (Array.isArray(all)) DB.set('assignments', all);
      addLog('Assignment Added', '"' + subj.name + '" → ' + cls.name);
      closeModalBg('m-add-asgn-t');
      openTD(currentTeacherId);
      dbToast('Assignment added to Database', 'success');
    });
  }).catch(function () {
    dbToast('Network error saving assignment', 'error');
  });
}

// ─── DROPDOWN POPULATION ────────────────────────────────────────────────────
function populateAdminDropdowns() {
  var depts = DB.get('depts');
  var classes = DB.get('classes');

  var years = (YEAR_CONFIG.all && YEAR_CONFIG.all.length)
    ? YEAR_CONFIG.all
    : (YEAR_CONFIG.current ? [YEAR_CONFIG.current] : []);
  var batch = Array.isArray(YEAR_CONFIG.batches) ? YEAR_CONFIG.batches : [];

  ['stu-year', 'edit-year'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = years.length
      ? years.map(function (y) { return '<option>' + y + '</option>'; }).join('')
      : '<option value="">— No current academic year set —</option>';
  });
  var sfAy = document.getElementById('sf-ay');
  if (sfAy) {
    sfAy.innerHTML = '<option value="">— Select —</option>'
      + years.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('');
    sfAy.value = '';
  }

  var sfBatch = document.getElementById('sf-batch');
  if (sfBatch) {
    sfBatch.innerHTML = '<option value="">— Select —</option>'
      + batch.map(function (b) { return '<option value="' + b + '">' + b + '</option>'; }).join('');
    sfBatch.value = '';
  }

  ['nc-batch', 'stu-batch', 'edit-batch'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = batch.length
      ? batch.map(function (y) { return '<option>' + y + '</option>'; }).join('')
      : '<option value="">— No active batches set —</option>';
  });

  ['t-dp'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">— Select —</option>'
      + depts.map(function (d) { return '<option value="' + d._id + '">' + d.name + '</option>'; }).join('');
  });

  ['stu-dept', 'edit-dept'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">— Select —</option>'
      + depts.map(function (d) { return '<option value="' + d._id + '">' + d.name + '</option>'; }).join('');
  });

  updateStuClassList();
  updateEditClassList();

  ['nc-dept', 'ns-dept'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">— Select —</option>'
      + depts.map(function (d) { return '<option value="' + d._id + '">' + d.name + '</option>'; }).join('');
  });
}
var padm = populateAdminDropdowns;

// ─── MODAL HELPERS ───────────────────────────────────────────────────────────
function openModal_(id) { var el = document.getElementById(id); if (el) { el.style.display = 'flex'; el.classList.add('open'); } }
function closeModalBg(id) { var el = document.getElementById(id); if (el) { el.classList.remove('open'); el.style.display = 'none'; } }

// Alias used by inline HTML onclick handlers
var om = openModal_;

// Shorthand used by some HTML buttons
function openAddModal(type) {
  if (type === 'student') openModal_('m-add-student');
}

// Close modal when clicking the background overlay
document.querySelectorAll('.modal-bg').forEach(function (bg) {
  bg.addEventListener('click', function (e) {
    if (e.target === bg) bg.classList.remove('open');
  });
});

// ─── UTILITY FUNCTIONS ───────────────────────────────────────────────────────
function getFieldValue(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : '';
}
var gv = getFieldValue; // alias

function clearInputs(ids) {
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
}
var cli = clearInputs; // alias


var showT = showToast; // alias

function downloadCSV(rows, filename) {
  var csvContent = rows.map(function (row) {
    return row.map(function (cell) {
      return '"' + String(cell || '').replace(/"/g, '""') + '"';
    }).join(',');
  }).join('\n');
  var blob = new Blob([csvContent], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = filename + '_' + new Date().toISOString().split('T')[0] + '.csv';
  link.click();
}
var dlcsv = downloadCSV; // alias

// ─── BOOT ────────────────────────────────────────────────────────────────────
initDB();

(function checkAuthAndBoot() {
  var storedUser = sessionStorage.getItem('eams_user');
  if (!storedUser) { window.location.href = 'index.html'; return; }
  try {
    currentUser = JSON.parse(storedUser);
  } catch (e) {
    window.location.href = 'index.html';
    return;
  }
  var isFullAdmin = currentUser.role === 'admin';
  var isTeacherAdmin = currentUser.role === 'teacher' && currentUser.isAdmin && (currentUser.adminRights === 'all' || (Array.isArray(currentUser.adminRights) && currentUser.adminRights.includes('all')));
  if (!currentUser || (!isFullAdmin && !isTeacherAdmin)) {
    window.location.href = 'index.html';
    return;
  }
  if (currentUser.role === 'teacher') {
    var backBtn = document.getElementById('admin-hub-back-btn');
    if (backBtn) backBtn.style.display = 'block';
    var uRoleEl = document.querySelector('.sb-urole');
    if (uRoleEl) uRoleEl.textContent = 'Teacher (Admin)';
  }
  try {
    bootApp();
  } catch (err) {
    console.error('[EAMS] bootApp() threw before loader gate was set up:', err);
    _loaderActive = false;
    var loaderEl = document.getElementById('page-loader');
    if (loaderEl) loaderEl.style.display = 'none';
    var shellEl = document.getElementById('app-shell');
    if (shellEl) shellEl.classList.add('vis');
    showToast('Something went wrong while loading the page — check the console (F12) for details', 'warn');
  }
  setTimeout(updateAllSidebarBadges, 800);
})();

// --- PROFILE: Save Name ---
function saveProfileName() {
  var inp = document.getElementById('pr-edit-name');
  var newName = inp ? inp.value.trim() : '';
  if (!newName) { showToast('Please enter a name'); return; }
  var token = getToken();
  fetch('/api/users/' + currentUser._id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ name: newName })
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.error) { dbToast('Error: ' + d.error, 'error'); return; }
    currentUser.name = newName;
    sessionStorage.setItem('eams_user', JSON.stringify(currentUser));
    var avatarLetter = newName[0].toUpperCase();
    document.getElementById('pr-av-big').textContent = avatarLetter;
    document.getElementById('pr-name-big').textContent = newName;
    document.getElementById('sb-name').textContent = newName;
    document.getElementById('topbar-av').textContent = avatarLetter;
    document.getElementById('topbar-name').textContent = newName;
    document.getElementById('sb-av').textContent = avatarLetter;
    dbToast('Name updated successfully', 'success');
  }).catch(function () {
    dbToast('Server error', 'error');
  });
}

function saveProfilePassword() {
  var cur = document.getElementById('pr-pw-cur').value.trim();
  var nw = document.getElementById('pr-pw-new').value.trim();
  var conf = document.getElementById('pr-pw-conf').value.trim();
  var err = document.getElementById('pr-pw-err');
  var ok = document.getElementById('pr-pw-ok');
  err.style.display = 'none'; ok.style.display = 'none';
  if (!cur || !nw || !conf) { err.textContent = 'Please fill all fields.'; err.style.display = 'block'; return; }
  if (nw.length < 6) { err.textContent = 'New password must be at least 6 characters.'; err.style.display = 'block'; return; }
  if (nw !== conf) { err.textContent = 'Passwords do not match.'; err.style.display = 'block'; return; }
  var token = getToken();
  fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ currentPassword: cur, newPassword: nw })
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.error) { err.textContent = d.error; err.style.display = 'block'; return; }
    ok.textContent = 'Password updated successfully!';
    ok.style.display = 'block';
    ['pr-pw-cur', 'pr-pw-new', 'pr-pw-conf'].forEach(function (id) { document.getElementById(id).value = ''; });
  }).catch(function () { err.textContent = 'Server error.'; err.style.display = 'block'; });
}

// --- SIDEBAR BADGE UPDATES ---
function updateAllSidebarBadges() {
  var stuCount = _counts.students || DB.get('students').length;
  var tchCount = _counts.teachers || DB.get('users').filter(function (u) { return u.role === 'teacher' && u.active !== false; }).length;
  var deptCount = _counts.depts || DB.get('depts').length;
  var el;
  el = document.getElementById('stud-count'); if (el) el.textContent = stuCount;
  el = document.getElementById('teach-count'); if (el) el.textContent = tchCount;
  el = document.getElementById('dept-count'); if (el) el.textContent = deptCount;
  syncCountsFromAPI();
}

function togglePwField(inputId, btn) {
  var inp = document.getElementById(inputId);
  if (!inp) return;

  var show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';

  btn.textContent = show ? '🙈' : '👁';
  btn.title = show ? 'Hide password' : 'Show password';
}

// ═══════════════════════════════════════════════════════
// Security
// ═══════════════════════════════════════════════════════

// document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
// document.addEventListener('keydown', function (e) {
//  if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I', 'J', 'C', 'K'].includes(e.key)) || (e.ctrlKey && e.key === 'U')) { e.preventDefault(); return false; }
// });

// ═══════════════════════════════════════════════════════
//  ACTION TOAST  — countdown toast with cancel + auto-action - Main Function
// ═══════════════════════════════════════════════════════
var _actionToast = { interval: null };

function actionToast(opts) {

  if (opts.key && window._lastActionToastKey === opts.key) return;
  if (opts.key) window._lastActionToastKey = opts.key;

  // ── kill any already-running toast ──
  clearActionToastTimers();
  var old = document.getElementById('action-toast');
  if (old) { old.classList.remove('at-show'); old.remove(); }

  var duration = (typeof opts.duration === 'number') ? opts.duration : 5;
  var remaining = duration;

  // ── build DOM ──
  var toast = document.createElement('div');
  toast.id = 'action-toast';
  toast.innerHTML =
    '<div class="at-bar-track"><div class="at-bar-fill" id="at-bar-fill"></div></div>' +
    '<div class="at-body">' +
    '<div class="at-left">' +
    '<div class="at-title">' + (opts.title || '') + '</div>' +
    '<div class="at-sub">' + (opts.message || '') + '</div>' +
    '</div>' +
    '<div class="at-right">' +
    '<span class="at-timer" id="at-timer">' + remaining + '</span>' +
    '<button class="at-cancel">' + (opts.confirmText || 'Cancel') + '</button>' +
    '</div>' +
    '</div>';

  document.body.appendChild(toast);

  requestAnimationFrame(function () {
    requestAnimationFrame(function () { toast.classList.add('at-show'); });
  });

  var barFill = document.getElementById('at-bar-fill');
  if (barFill) {
    barFill.style.transition = 'none';
    barFill.style.transform = 'scaleX(1)';
    barFill.getBoundingClientRect();
    barFill.style.transition = 'transform ' + duration + 's linear';
    barFill.style.transform = 'scaleX(0)';
  }

  var timerEl = document.getElementById('at-timer');

  function dismiss(runConfirm) {
    clearActionToastTimers();
    toast.classList.remove('at-show');
    toast.classList.add('at-hide');
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 420);
    if (opts.key) window._lastActionToastKey = null;
    if (runConfirm) { if (opts.onConfirm) opts.onConfirm(); }
    else { if (opts.onCancel) opts.onCancel(); }
  }

  toast.querySelector('.at-cancel').onclick = function () { dismiss(false); };

  _actionToast.interval = setInterval(function () {
    remaining--;
    if (timerEl) timerEl.textContent = remaining;
    if (remaining <= 0) dismiss(true);
  }, 1000);
}

function clearActionToastTimers() {
  if (_actionToast.interval) clearInterval(_actionToast.interval);
  _actionToast.interval = null;
}

// ═══════════════════════════════════════════════════════
//  DB SYNC LAYER — All data fetched from Database - MongoDB
// ═══════════════════════════════════════════════════════

// API helper
function apiCall(method, path, body) {
  var tok = getToken();
  return fetch('/api' + path, {
    method: method,
    headers: { 'Content-Type': 'application/json', 'Authorization': tok ? 'Bearer ' + tok : '' },
    body: body ? JSON.stringify(body) : undefined
  }).then(function (r) {
    if (!r.ok) {
      return r.json().catch(function () { return {}; }).then(function (e) {
        return { error: e.error || ('HTTP ' + r.status) };
      });
    }
    return r.json();
  });
}

var _counts = { depts: 0, classes: 0, subjects: 0, students: 0, users: 0, teachers: 0, assignments: 0, logs: 0, notifications: 0, pendingNotifs: 0 };
var _loaded = { depts: false, classes: false, subjects: false, students: false, users: false, assignments: false, logs: false, notifications: false };

function syncCountsFromAPI() {
  var tok = getToken();
  if (!tok) return Promise.resolve(_counts);
  return fetch('/api/dashboard/counts', { headers: { 'Authorization': 'Bearer ' + tok } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && !data.error) {
        _counts = data;
        _applyCountsToBadges();
      }
      return _counts;
    }).catch(function () { return _counts; });
}

function _applyCountsToBadges() {
  var d = _counts;
  var el;
  el = document.getElementById('c-students'); if (el) el.textContent = d.students;
  el = document.getElementById('c-depts'); if (el) el.textContent = d.depts;
  el = document.getElementById('c-teachers'); if (el) el.textContent = d.teachers;
  el = document.getElementById('c-classes'); if (el) el.textContent = d.classes;
  el = document.getElementById('stud-count'); if (el) el.textContent = d.students;
  el = document.getElementById('dept-count'); if (el) el.textContent = d.depts;
  el = document.getElementById('teach-count'); if (el) el.textContent = d.teachers;

  el = document.getElementById('dept-stat-depts'); if (el) el.textContent = d.depts;
  el = document.getElementById('dept-stat-classes'); if (el) el.textContent = d.classes;
  el = document.getElementById('dept-stat-students'); if (el) el.textContent = d.students;
  el = document.getElementById('dept-stat-teachers'); if (el) el.textContent = d.teachers;

  el = document.getElementById('t-stat-teachers'); if (el) el.textContent = d.teachers;
  el = document.getElementById('t-stat-depts'); if (el) el.textContent = d.depts;
}

function ensureLoaded(collections, callback) {
  var toLoad = collections.filter(function (c) { return !_loaded[c]; });
  if (!toLoad.length) { if (callback) callback(); return Promise.resolve(); }

  var promises = toLoad.map(function (c) {
    if (c === 'users') return syncUsersWithTeacherDetails().then(function () { _loaded.users = true; });
    if (c === 'logs') return _fetchLogsInitial().then(function () { _loaded.logs = true; });
    return syncFromAPI(c, '/' + c).then(function () { _loaded[c] = true; });
  });

  return Promise.all(promises).then(function () {
    if (callback) callback();
  });
}

// Sync a collection from API into the in-memory render cache (DB server is source of truth)
function syncFromAPI(collection, apiPath) {
  var tok = getToken();
  if (!tok) return Promise.resolve([]);
  return fetch('/api' + apiPath, { headers: { 'Authorization': 'Bearer ' + tok } })
    .then(function (r) {
      if (r.status === 401) {
        console.warn('[EAMS] syncFromAPI got 401 on ' + apiPath + ' — redirecting to login');
        sessionStorage.removeItem('eams_token');
        sessionStorage.removeItem('eams_user');
        window.location.href = 'index.html';
        return [];
      }
      return r.json();
    })
    .then(function (data) {
      var arr = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : null);
      if (arr) {
        DB.set(collection, arr);
        syncCountsFromAPI();
        return arr;
      }
      console.warn('[EAMS] syncFromAPI unexpected response for ' + apiPath + ':', data);
      return [];
    }).catch(function (err) {
      console.error('[EAMS] syncFromAPI fetch error for ' + apiPath + ':', err);
      return [];
    });
}

function syncTeacherDirectory() {
  return apiCall('GET', '/teachers').then(function (teacherList) {
    if (!Array.isArray(teacherList)) return DB.get('users');
    var byTrack = {};
    teacherList.forEach(function (t) { if (t.trackId) byTrack[t.trackId] = t; });
    var merged = DB.get('users').map(function (u) {
      if (u.role !== 'teacher' || !u.trackId || !byTrack[u.trackId]) return u;
      var t = byTrack[u.trackId];
      return Object.assign({}, u, {
        dept: t.dept, department: t.department,
        deptId: t.deptId, deptCode: t.deptCode,
        empId: t.empId, employeeNo: t.employeeNo,
        desig: t.desig, designation: t.designation,
        email: t.email, specials: t.specials || [],
        adminRights: t.adminRights || [],
        isHOD: t.isHOD, isClassAdvisor: t.isClassAdvisor,
        isTimeTableCoordinator: t.isTimeTableCoordinator,
        shadowId: u._id,
        _id: t._id
      });
    });
    DB.set('users', merged);
    return merged;
  }).catch(function () { return DB.get('users'); });
}

function syncUsersWithTeacherDetails() {
  return syncFromAPI('users', '/users').then(syncTeacherDirectory);
}

function syncYearConfig() {
  var tok = getToken();
  if (!tok) return Promise.resolve(YEAR_CONFIG);
  return Promise.all([
    apiCall('GET', '/year/current'),
    apiCall('GET', '/year/batches'),
    apiCall('GET', '/year')
  ]).then(function (results) {
    var current = results[0];
    var batches = results[1];
    var allYears = Array.isArray(results[2]) ? results[2] : [];
    YEAR_CONFIG.current = (typeof current === 'string' && current) ? current : '';
    YEAR_CONFIG.batches = Array.isArray(batches) ? batches : [];
    YEAR_CONFIG.all = allYears.map(function (y) { return y.academicYear; }).filter(Boolean);
    if (YEAR_CONFIG.current && YEAR_CONFIG.all.indexOf(YEAR_CONFIG.current) === -1) {
      YEAR_CONFIG.all.unshift(YEAR_CONFIG.current);
    }
    return YEAR_CONFIG;
  }).catch(function () { return YEAR_CONFIG; });
}

// Sync initial eager data (counts, depts, notifications, yearConfig)
function syncAllFromDB(cb, onProgress) {
  dbToast('Fetching from Database…', 'saving');
  var syncStart = Date.now();
  var taskDefs = [
    { name: 'counts', p: syncCountsFromAPI() },
    { name: 'depts', p: syncFromAPI('depts', '/depts').then(function (r) { _loaded.depts = true; return r; }) },
    { name: 'notifications', p: syncFromAPI('notifications', '/notifications').then(function (r) { _loaded.notifications = true; return r; }) },
    { name: 'yearConfig', p: syncYearConfig() },
  ];

  ['classes', 'subjects', 'students', 'users', 'assignments', 'logs'].forEach(function (c) {
    if (!DB.get(c)) DB.set(c, []);
  });

  var pending = taskDefs.map(function (t) { return t.name; });

  var tracked = taskDefs.map(function (task) {
    return task.p.then(function (result) {
      pending = pending.filter(function (n) { return n !== task.name; });
      if (onProgress) onProgress(task.name, pending.slice(), Date.now() - syncStart);
      return result;
    }).catch(function (err) {
      pending = pending.filter(function (n) { return n !== task.name; });
      if (onProgress) onProgress(task.name, pending.slice(), Date.now() - syncStart);
      throw err;
    });
  });

  Promise.all(tracked).then(function (results) {
    dbToast('Synced from Database', 'success');
    if (cb) cb();
  }).catch(function (err) {
    console.error('[EAMS] syncAllFromDB failed:', err);
    dbToast('Sync failed', 'error');
    if (cb) cb();
  });
}

// ── DEPT OPERATIONS ──────────────────────────────────
function apiAddDept(name, code, number, twoLetterCode, courseType, branch, hodId, hodName) {
  var payload = { name: name, code: code, number: number, twoLetterCode: twoLetterCode, courseType: courseType, branch: branch, hodName: hodName || '' };
  if (hodId) payload.hodId = hodId;
  return apiCall('POST', '/depts', payload)
    .then(function (d) {
      if (d.error) { dbToast('Error: ' + d.error, 'error'); return null; }
      return syncFromAPI('depts', '/depts').then(function () {
        return d;
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); return null; });
}

function apiUpdateDept(id, name, code, number, courseType, branch, hodId, hodName) {
  var payload = { name: name, code: code, number: number, courseType: courseType, branch: branch, hodName: hodName || '' };
  if (hodId) payload.hodId = hodId; // only include hodId when non-empty
  return apiCall('PUT', '/depts/' + id, payload)
    .then(function (d) {
      if (d.error) { dbToast('Error: ' + d.error, 'error'); return null; }
      return syncFromAPI('depts', '/depts').then(function () {
        return d;
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); return null; });
}

function apiDeleteDept(id, name) {
  dbToast('Deleting department…', 'saving', '"' + name + '"');
  return apiCall('DELETE', '/depts/' + id)
    .then(function (d) {
      if (d && d.error) { dbToast('Error: ' + d.error, 'error'); throw new Error(d.error); }
      return syncFromAPI('depts', '/depts').then(function () {
        dbToast('Department deleted', 'success', '"' + name + '" removed from Database');
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); throw err; });
}

// ── CLASS OPERATIONS ─────────────────────────────────
function apiAddClass(data) {
  dbToast('Adding class…', 'saving', data.name);
  return apiCall('POST', '/classes', data)
    .then(function (d) {
      if (d.error) { dbToast('Error: ' + d.error, 'error'); return null; }
      return syncFromAPI('classes', '/classes').then(function () {
        dbToast('Class added', 'success', '"' + data.name + '" → Database');
        return d;
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); return null; });
}

function apiDeleteClass(id, name) {
  dbToast('Deleting class…', 'saving', '"' + name + '"');
  return apiCall('DELETE', '/classes/' + id)
    .then(function (d) {
      if (d && d.error) { dbToast('Error: ' + d.error, 'error'); throw new Error(d.error); }
      return syncFromAPI('classes', '/classes').then(function () {
        dbToast('Class deleted', 'success', '"' + name + '" removed');
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); throw err; });
}

function apiUpdateClass(id, data) {
  dbToast('Updating class…', 'saving', data.name);
  return apiCall('PUT', '/classes/' + id, data)
    .then(function (d) {
      if (d.error) { dbToast('Error: ' + d.error, 'error'); return null; }
      return syncFromAPI('classes', '/classes').then(function () {
        dbToast('Class updated', 'success', '"' + data.name + '" → Database');
        return d;
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); return null; });
}

// ── SUBJECT OPERATIONS ───────────────────────────────
function apiAddSubject(data) {
  dbToast('Adding subject…', 'saving', data.name);
  return apiCall('POST', '/subjects', data)
    .then(function (d) {
      if (d.error) { dbToast('Error: ' + d.error, 'error'); return null; }
      return syncFromAPI('subjects', '/subjects').then(function () {
        dbToast('Subject added', 'success', '"' + data.name + '" → Database');
        return d;
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); return null; });
}

function apiUpdateSubject(id, data) {
  dbToast('Updating subject…', 'saving', data.name);
  return apiCall('PUT', '/subjects/' + id, data)
    .then(function (d) {
      if (d.error) { dbToast('Error: ' + d.error, 'error'); return null; }
      return syncFromAPI('subjects', '/subjects').then(function () {
        dbToast('Subject updated', 'success', '"' + data.name + '" → Database');
        return d;
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); return null; });
}

function apiDeleteSubject(id, name) {
  dbToast('Deleting subject…', 'saving', '"' + name + '"');
  return apiCall('DELETE', '/subjects/' + id)
    .then(function (d) {
      if (d && d.error) { dbToast('Error: ' + d.error, 'error'); throw new Error(d.error); }
      return syncFromAPI('subjects', '/subjects').then(function () {
        dbToast('Subject deleted', 'success', '"' + name + '" removed');
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); throw err; });
}

// ── TEACHER OPERATIONS ──────────────────────────────
function _refreshTeacherList() {
  var dept = document.getElementById('tf-dept') ? document.getElementById('tf-dept').value : '';
  var params = dept ? '?deptId=' + encodeURIComponent(dept) : '';
  apiCall('GET', '/teachers' + params)
    .then(function (list) {
      _teacherData = Array.isArray(list) ? list : [];
      _renderTeacherGrid(_teacherData);
    })
    .catch(function () { });
}

function apiAddTeacher(data) {
  dbToast('Adding teacher…', 'saving', data.name);
  return apiCall('POST', '/teachers', data)
    .then(function (d) {
      if (d.error) { dbToast('Error: ' + d.error, 'error'); return null; }
      return syncUsersWithTeacherDetails().then(function () {
        _refreshTeacherList();
        dbToast('Teacher added', 'success', '"' + data.name + '" (' + data.username + ') → Database\nPassword: ' + data.password);
        return d;
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); return null; });
}

function apiDeleteTeacher(id, name) {
  dbToast('Deleting teacher…', 'saving', '"' + name + '"');
  return apiCall('DELETE', '/teachers/' + id)
    .then(function (d) {
      if (d && d.error) { dbToast('Error: ' + d.error, 'error'); throw new Error(d.error); }
      return syncUsersWithTeacherDetails().then(function () {
        _refreshTeacherList();
        dbToast('Teacher deleted', 'success', '"' + name + '" removed from DB — undoable 10 days');
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); throw err; });
}

function apiUpdateTeacher(id, data, name) {
  dbToast('Updating teacher…', 'saving', name);
  return apiCall('PUT', '/teachers/' + id, data)
    .then(function (d) {
      if (d.error) { dbToast('Error: ' + d.error, 'error'); return null; }
      return syncUsersWithTeacherDetails().then(function () {
        _refreshTeacherList();
        dbToast('Teacher updated', 'success', '"' + name + '" → Database');
        return d;
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); return null; });
}

// ── STUDENT OPERATIONS ──────────────────────────────
function apiAddStudent(data) {
  dbToast('Adding student…', 'saving', data.name);
  return apiCall('POST', '/students', data)
    .then(function (d) {
      if (d.error) { dbToast('Error: ' + d.error, 'error'); return null; }
      return syncFromAPI('students', '/students').then(function () {
        dbToast('Student added', 'success', '"' + data.name + '" → Database');
        return d;
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); return null; });
}

function apiDeleteStudent(id, name) {
  dbToast('Deleting student…', 'saving', '"' + name + '"');
  return apiCall('DELETE', '/students/' + id)
    .then(function (d) {
      if (d && d.error) { dbToast('Error: ' + d.error, 'error'); throw new Error(d.error); }
      return syncFromAPI('students', '/students').then(function () {
        dbToast('Student deleted', 'success', '"' + name + '" removed');
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); throw err; });
}

function apiUpdateStudent(id, data, name) {
  dbToast('Updating student…', 'saving', name);
  return apiCall('PUT', '/students/' + id, data)
    .then(function (d) {
      if (d.error) { dbToast('Error: ' + d.error, 'error'); return null; }
      return syncFromAPI('students', '/students').then(function () {
        dbToast('Student updated', 'success', '"' + name + '" → Database');
        return d;
      });
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); return null; });
}

// ── SETTINGS OPERATIONS (in-memory cache — DB server is source of truth) ──
var _memSettings = {};

function apiGetSettings() {
  return apiCall('GET', '/settings').then(function (d) {
    if (!d.error) _memSettings = d;
    return d;
  });
}

function apiSaveSetting(key, value, label) {
  dbToast('Saving ' + (label || key) + '…', 'saving');
  return apiCall('PUT', '/settings/' + key, { value: value })
    .then(function (d) {
      if (d && d.error) { dbToast('Error: ' + d.error, 'error'); return null; }
      _memSettings[key] = value;
      dbToast((label || key) + ' saved', 'success', 'Updated in Database');
      return d;
    })
    .catch(function (err) { dbToast('Failed: ' + (err.message || 'error'), 'error'); return null; });
}

// ═══════════════════════════════════════════════════════
//  SPECIAL DELETE PASSWORD
// ═══════════════════════════════════════════════════════

var _specialPwCallback = null;

function requireSpecialPw(cb) {
  _specialPwCallback = cb;
  document.getElementById('sppw-input').value = '';
  document.getElementById('sppw-err').style.display = 'none';
  openModal_('m-special-pw');
}

function verifySpecialPw() {
  var pw = document.getElementById('sppw-input').value.trim();
  var errEl = document.getElementById('sppw-err');
  errEl.style.display = 'none';
  if (!pw) { errEl.textContent = 'Enter password.'; errEl.style.display = 'block'; return; }
  dbToast('Verifying password…', 'saving');
  apiCall('POST', '/settings/verify-delete-password', { password: pw })
    .then(function (d) {
      if (d.valid) {
        closeModalBg('m-special-pw');
        dbToast('Verified', 'success');
        if (_specialPwCallback) { _specialPwCallback(); _specialPwCallback = null; }
      } else {
        errEl.textContent = d.error || 'Incorrect password.';
        errEl.style.display = 'block';
        dbToast('Wrong password', 'error');
      }
    }).catch(function () {
      dbToast('Server error', 'error');
      errEl.textContent = 'Server error.';
      errEl.style.display = 'block';
    });
}

// Wrap confirm dialog to require special password for deletions
function openDangerConfirm(id, msg, cb) {
  requireSpecialPw(function () {
    document.getElementById('dc-confirm-id').value = id || '';
    document.getElementById('dc-confirm-msg').textContent = msg;
    document.getElementById('dc-confirm-btn').onclick = cb;
    openModal_('m-dc-confirm');
  });
}

function openClearStorageModal() {
  document.querySelectorAll('.clr-chk').forEach(function (c) { c.checked = false; });
  document.getElementById('clr-all').checked = false;
  openModal_('m-clear-storage');
}

function toggleClearAll(master) {
  document.querySelectorAll('.clr-chk').forEach(function (c) { c.checked = master.checked; });
}

function confirmClearStorage() {
  var checked = Array.from(document.querySelectorAll('.clr-chk:checked')).map(function (c) { return c.value; });
  if (!checked.length) {
    showToast('Nothing selected, Tick at least one item to clear.');
    return;
  }

  var cleared = [];
  var loggedOut = false;

  dbToast('Clearing…', 'saving');

  checked.forEach(function (key) {
    if (key === 'settings') {
      _memSettings = {};
      cleared.push('Settings');

    } else if (key === 'session_token') {
      sessionStorage.removeItem('eams_token');
      cleared.push('Auth Token');
      loggedOut = true;

    } else if (key === 'session_user') {
      sessionStorage.removeItem('eams_user');
      cleared.push('Session User');

    } else {
      delete _memStore['ss3_' + key];
      cleared.push(key.charAt(0).toUpperCase() + key.slice(1));
    }
  });

  closeModalBg('m-clear-storage');
  dbToast('Cache cleared', 'success', cleared.join(' · ') + ' removed — Database unaffected.');

  if (loggedOut) {
    setTimeout(function () { doLogout(); }, 1200);
    return;
  }
  var allMain = ['depts', 'classes', 'subjects', 'students', 'users', 'assignments', 'attendance', 'notifications', 'logs'];
  var clearedAllMain = allMain.every(function (k) { return checked.indexOf(k) !== -1; });
  if (clearedAllMain) {
    setTimeout(function () { syncAllFromDB(); }, 600);
  }

}

// ── Teacher card click delegation ─────────────────────────────────────────
(function () {
  var tgr = document.getElementById('tgr');
  if (!tgr) return;
  tgr.addEventListener('click', function (e) {
    var target = e.target.closest('[data-id]');
    if (!target) return;
    openTD(target.getAttribute('data-id'));
  });
})();

// openModal wrapper for admin page modals
function openModal(id) { var el = document.getElementById(id); if (el) { el.style.display = 'flex'; el.classList.add('open'); } }

window.addEventListener('load', function() {
  try {
    var rawUser = sessionStorage.getItem('eams_user');
    if (rawUser) {
      var usr = JSON.parse(rawUser);
      if (usr) {
        var nm = usr.name || usr.fullName || usr.username || 'Administrator';
        var av = nm.charAt(0).toUpperCase();
        var avEl = document.getElementById('sb-av');
        var nmEl = document.getElementById('sb-name');
        var roleEl = document.querySelector('.sb-urole');
        if (avEl) avEl.textContent = av;
        if (nmEl) nmEl.textContent = nm;
        if (usr.role === 'teacher' && usr.isAdmin) {
          if (roleEl) roleEl.textContent = 'Teacher (Admin)';
          var hubBtn = document.getElementById('admin-hub-back-btn');
          if (hubBtn) {
            hubBtn.style.display = 'flex';
            hubBtn.textContent = '← Back to Hub';
          }
        }
      }
    }
  } catch (err) {}

  fetch('/api/settings/public')
    .then(function(r){ return r.json(); })
    .then(function(pub){
      window._pubSettings = pub;
      if (pub.institution) {
        var shortN = pub.institution.institutionShort || 'SIET';
        document.title = 'EAMS – Admin Dashboard | ' + shortN;
        var logoEl = document.querySelector('.sb-brand');
        if (logoEl && pub.institution.institutionName) {
          logoEl.innerHTML = (pub.institution.institutionShort || 'EAMS') + ' Admin';
        }
      }
      if (pub.models) {
        if (pub.models.modelExportSheet === false) {
          document.querySelectorAll('.btn-export').forEach(function(b){ b.style.display = 'none'; });
        }
        if (pub.models.modelAddStudent === false) {
          var addStuBtn = document.getElementById('btn-add-student');
          if (addStuBtn) addStuBtn.style.display = 'none';
        }
      }
    }).catch(function(e){ console.warn(e); });
});

// ── EXECUTIVE ROLES MANAGEMENT (Principal, HOD, Sub-Admin) ─────────
var _executiveRolesData = { principal: null, hods: [], subadmins: [], departments: [], teachers: [] };
var _currentRoleTab = 'principal';

function switchRoleTab(tabName) {
  _currentRoleTab = tabName || 'principal';

  // Toggle Tab button states
  ['principal', 'hod', 'subadmin'].forEach(function (tab) {
    var btn = document.getElementById('rtab-btn-' + tab);
    if (btn) {
      if (tab === _currentRoleTab) btn.classList.add('act');
      else btn.classList.remove('act');
    }

    // Toggle Section views
    var sec = document.getElementById('role-sec-' + tab);
    if (sec) {
      sec.style.display = (tab === _currentRoleTab) ? 'block' : 'none';
    }

    // Toggle Top Action buttons
    var actBtn = document.getElementById('btn-role-action-' + tab);
    if (actBtn) {
      actBtn.style.display = (tab === _currentRoleTab) ? 'inline-flex' : 'none';
    }
  });
}

function loadExecutiveRolesData() {
  var token = getToken();
  return fetch('/api/users/executive/roles?_t=' + Date.now(), {
    headers: { 'Authorization': 'Bearer ' + token }
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && !data.error) {
        _executiveRolesData = data;
        renderExecutiveRolesUI();
        switchRoleTab(_currentRoleTab);
      }
    })
    .catch(function (err) {
      console.error('[Executive Roles Error]:', err);
    });
}

function renderExecutiveRolesUI() {
  var p = _executiveRolesData.principal;
  var nameEl = document.getElementById('principal-display-name');
  var metaEl = document.getElementById('principal-display-meta');
  var badgeEl = document.getElementById('principal-status-badge');

  if (p) {
    if (nameEl) nameEl.textContent = p.fullName;
    if (metaEl) metaEl.textContent = 'Username: @' + p.username + ' · Email: ' + (p.email || '—') + ' · Employee ID: ' + (p.employeeNo || '—');
    if (badgeEl) {
      badgeEl.textContent = 'Active (Principal)';
      badgeEl.className = 'bge bgg';
    }
  } else {
    if (nameEl) nameEl.textContent = 'No Principal Appointed';
    if (metaEl) metaEl.textContent = 'Click Assign Principal to appoint institutional executive.';
    if (badgeEl) {
      badgeEl.textContent = 'Not Appointed';
      badgeEl.className = 'bge bgr';
    }
  }

  // Render HODs Table
  var hodsTbody = document.getElementById('roles-hods-tbody');
  if (hodsTbody) {
    var hods = _executiveRolesData.hods || [];
    if (!hods.length) {
      hodsTbody.innerHTML = '<tr><td colspan="6" class="text-center">No departments registered.</td></tr>';
    } else {
      hodsTbody.innerHTML = hods.map(function (h) {
        var hodBadge = h.hodName === 'Not Assigned'
          ? '<span style="color:#ef4444;font-weight:600;">Not Assigned</span>'
          : '<strong style="color:var(--td);">' + h.hodName + '</strong>';

        return '' +
          '<tr>' +
            '<td><strong>' + h.deptName + '</strong></td>' +
            '<td><span class="bge bgc">' + (h.deptCode || '—') + '</span></td>' +
            '<td>' + hodBadge + '</td>' +
            '<td>' + (h.hodEmpNo || '—') + '</td>' +
            '<td>' + (h.hodEmail || '—') + '</td>' +
            '<td>' +
              '<button class="btn-sm btn-pri" onclick="openAssignHodModal(\'' + h.deptId + '\')">' + (h.hodName === 'Not Assigned' ? 'Appoint HOD' : 'Change HOD') + '</button>' +
            '</td>' +
          '</tr>';
      }).join('');
    }
  }

  // Render Sub-Admins Table
  var subTbody = document.getElementById('roles-subadmins-tbody');
  if (subTbody) {
    var subadmins = _executiveRolesData.subadmins || [];
    if (!subadmins.length) {
      subTbody.innerHTML = '<tr><td colspan="6" class="text-center">No sub-administrators configured.</td></tr>';
    } else {
      subTbody.innerHTML = subadmins.map(function (s) {
        var rights = Array.isArray(s.adminRights) ? s.adminRights : [];
        var rightsBadges = rights.map(function (r) {
          return '<span class="bge bgy" style="font-size:10px;margin-right:3px;">' + r + '</span>';
        }).join('');

        return '' +
          '<tr>' +
            '<td><strong>' + s.fullName + '</strong></td>' +
            '<td>@' + s.username + '</td>' +
            '<td>' + (s.department || '—') + '</td>' +
            '<td><span class="bge bgb">' + s.type + '</span></td>' +
            '<td>' + (rightsBadges || 'None') + '</td>' +
            '<td>' +
              '<button class="btn-sm btn-pri" onclick="openGrantSubAdminModal(\'' + s._id + '\')">Edit Rights</button>' +
            '</td>' +
          '</tr>';
      }).join('');
    }
  }
}

// ── Modals Handlers for Roles ──
function openAssignPrincipalModal() {
  var p = _executiveRolesData.principal;
  var fn = document.getElementById('prin-fullname');
  var un = document.getElementById('prin-username');
  var pw = document.getElementById('prin-password');
  var em = document.getElementById('prin-email');
  var emp = document.getElementById('prin-empno');

  if (p) {
    if (fn) fn.value = p.fullName || '';
    if (un) un.value = p.username || 'principal';
    if (pw) pw.value = '';
    if (em) em.value = p.email || '';
    if (emp) emp.value = p.employeeNo || '';
  } else {
    if (fn) fn.value = '';
    if (un) un.value = 'principal';
    if (pw) pw.value = '';
    if (em) em.value = '';
    if (emp) emp.value = 'PRIN001';
  }
  openModalBg('m-assign-principal');
}

function submitAssignPrincipal() {
  var fullName = document.getElementById('prin-fullname')?.value?.trim();
  var username = document.getElementById('prin-username')?.value?.trim();
  var password = document.getElementById('prin-password')?.value;
  var email = document.getElementById('prin-email')?.value?.trim();
  var employeeNo = document.getElementById('prin-empno')?.value?.trim();

  if (!fullName || !username) {
    showToast('Full Name and Username are required');
    return;
  }

  var token = getToken();
  fetch('/api/users/executive/assign-principal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ fullName: fullName, username: username, password: password, email: email, employeeNo: employeeNo })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.error) {
        showToast('Error: ' + res.error);
        return;
      }
      showToast(res.message || 'Principal assigned successfully!');
      closeModalBg('m-assign-principal');
      loadExecutiveRolesData();
    })
    .catch(function (err) {
      console.error(err);
      showToast('Failed to assign Principal');
    });
}

function openAssignHodModal(deptId) {
  var deptSelect = document.getElementById('hod-dept-select');
  var teacherSelect = document.getElementById('hod-teacher-select');

  var depts = _executiveRolesData.departments || [];
  var teachers = _executiveRolesData.teachers || [];

  if (deptSelect) {
    deptSelect.innerHTML = '<option value="">Select Department…</option>' +
      depts.map(function (d) {
        return '<option value="' + d._id + '"' + (deptId && String(d._id) === String(deptId) ? ' selected' : '') + '>' + d.name + ' (' + d.code + ')</option>';
      }).join('');
  }

  if (teacherSelect) {
    teacherSelect.innerHTML = '<option value="">Select Faculty Member…</option>' +
      teachers.map(function (t) {
        return '<option value="' + t._id + '">' + t.fullName + ' (' + (t.department || 'No Dept') + ')</option>';
      }).join('');
  }

  openModalBg('m-assign-hod');
}

function onHodModalDeptChange(deptId) {
  var dept = (_executiveRolesData.departments || []).find(function (d) { return String(d._id) === String(deptId); });
  var teacherSelect = document.getElementById('hod-teacher-select');
  var teachers = _executiveRolesData.teachers || [];

  if (teacherSelect && dept) {
    // Put teachers in this department first
    var deptTeachers = teachers.filter(function (t) { return t.department === dept.name; });
    var otherTeachers = teachers.filter(function (t) { return t.department !== dept.name; });

    teacherSelect.innerHTML = '<option value="">Select Faculty Member…</option>' +
      '<optgroup label="Faculty in ' + dept.name + '">' +
      deptTeachers.map(function (t) { return '<option value="' + t._id + '">' + t.fullName + '</option>'; }).join('') +
      '</optgroup>' +
      '<optgroup label="Other Departments">' +
      otherTeachers.map(function (t) { return '<option value="' + t._id + '">' + t.fullName + ' (' + t.department + ')</option>'; }).join('') +
      '</optgroup>';
  }
}

function submitAssignHod() {
  var deptId = document.getElementById('hod-dept-select')?.value;
  var teacherId = document.getElementById('hod-teacher-select')?.value;

  if (!deptId || !teacherId) {
    showToast('Please select both Department and Faculty Member.');
    return;
  }

  var token = getToken();
  fetch('/api/users/executive/assign-hod', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ deptId: deptId, teacherId: teacherId })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.error) {
        showToast('Error: ' + res.error);
        return;
      }
      showToast(res.message || 'HOD appointed successfully!');
      closeModalBg('m-assign-hod');
      loadExecutiveRolesData();
    })
    .catch(function (err) {
      console.error(err);
      showToast('Failed to appoint HOD');
    });
}

function openGrantSubAdminModal(teacherId) {
  var teacherSelect = document.getElementById('subadmin-teacher-select');
  var teachers = _executiveRolesData.teachers || [];

  if (teacherSelect) {
    teacherSelect.innerHTML = '<option value="">Select Faculty Member…</option>' +
      teachers.map(function (t) {
        return '<option value="' + t._id + '"' + (teacherId && String(t._id) === String(teacherId) ? ' selected' : '') + '>' + t.fullName + ' (' + (t.department || '—') + ')</option>';
      }).join('');
  }

  var subadmin = (_executiveRolesData.subadmins || []).find(function (s) { return String(s._id) === String(teacherId); });
  var rights = subadmin ? subadmin.adminRights : ['controlPage'];

  document.querySelectorAll('.subadmin-module-chk').forEach(function (chk) {
    chk.checked = Array.isArray(rights) && rights.includes(chk.value);
  });

  openModalBg('m-grant-subadmin');
}

function submitGrantSubAdmin() {
  var teacherId = document.getElementById('subadmin-teacher-select')?.value;
  if (!teacherId) {
    showToast('Please select a Faculty member.');
    return;
  }

  var checkedModules = Array.from(document.querySelectorAll('.subadmin-module-chk:checked')).map(function (c) { return c.value; });
  if (!checkedModules.length) {
    checkedModules = ['none'];
  }

  var token = getToken();
  fetch('/api/users/executive/grant-subadmin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ teacherId: teacherId, adminRights: checkedModules })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.error) {
        showToast('Error: ' + res.error);
        return;
      }
      showToast(res.message || 'Sub-Admin rights granted successfully!');
      closeModalBg('m-grant-subadmin');
      loadExecutiveRolesData();
    })
    .catch(function (err) {
      console.error(err);
      showToast('Failed to grant Sub-Admin rights');
    });
}