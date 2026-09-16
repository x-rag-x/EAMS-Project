var TOKEN = sessionStorage.getItem('eams_token');
var currentUser = null;
var currentSection = 'overview';
var currentSubType = 'all';
var currentSeverity = 'all';
var currentSearch = '';
var fromDate = '';
var toDate = '';

var logsList = [];
var currentCursor = null;
var hasMoreLogs = false;
var isLoading = false;
var searchDebounceTimer = null;
var serverStats = {};

// Sub-filter configuration per section
var SECTION_CHIPS = {
  overview: [
    { id: 'all', label: '🗂️ All Activities' },
    { id: 'session', label: '🔑 Logins & Sessions' },
    { id: 'entry-create', label: '➕ Creations' },
    { id: 'field-edit', label: '✏️ Field Edits' },
    { id: 'entry-delete', label: '🗑️ Deletions' },
    { id: 'attendance', label: '📅 Attendance' },
    { id: 'security', label: '🚨 Security Events' }
  ],
  admin: [
    { id: 'all', label: '🗂️ All Admin Logs' },
    { id: 'session', label: '🔑 Admin Sessions' },
    { id: 'entry-create', label: '➕ Records Added' },
    { id: 'field-edit', label: '✏️ Updates & Diffs' },
    { id: 'entry-delete', label: '🗑️ Removed Records' },
    { id: 'bulk-action', label: '📦 Bulk Operations' },
    { id: 'action', label: '⚡ Administrative Actions' }
  ],
  teacher: [
    { id: 'all', label: '🗂️ All Teacher Logs' },
    { id: 'session', label: '🔑 Faculty Sessions' },
    { id: 'attendance', label: '📅 Attendance Marked' },
    { id: 'leave', label: '📝 Leaves Reviewed' },
    { id: 'entry-create', label: '📋 Grievances / Submissions' }
  ],
  student: [
    { id: 'all', label: '🗂️ All Student Logs' },
    { id: 'session', label: '🔑 Student Logins' },
    { id: 'attendance', label: '📊 Daily Attendance' },
    { id: 'leave', label: '🏖️ Leave Queries' }
  ],
  system: [
    { id: 'all', label: '🗂️ All System Logs' },
    { id: 'backup', label: '🗄️ Database Backups' },
    { id: 'export', label: '⬇️ Data Exports' },
    { id: 'broadcast', label: '📢 System Broadcasts' },
    { id: 'danger', label: '⚠️ Bulk Clears / Purges' },
    { id: 'security', label: '🔒 Lockouts & Resets' }
  ]
};

var SECTION_META = {
  overview: {
    title: 'System Audit Overview',
    desc: 'Real-time audit trail of every session, edit, deletion, and security event.'
  },
  admin: {
    title: 'Administrator Audit Logs',
    desc: 'Management actions, department/class edits, faculty rights, and structural changes.'
  },
  teacher: {
    title: 'Faculty & Teacher Logs',
    desc: 'Attendance submissions, exam attendance logs, leave approvals, and grievances.'
  },
  student: {
    title: 'Student Activity Logs',
    desc: 'Student authentication sessions, daily attendance summaries, and leave queries.'
  },
  system: {
    title: 'System & Control Logs',
    desc: 'Automated background tasks, database backups, exports, broadcasts, and security alerts.'
  }
};

// INITIALIZATION
document.addEventListener('DOMContentLoaded', function () {
  checkAuthentication();
  setupEventListeners();
  loadStats();
  switchSection('overview');
});

function checkAuthentication() {
  if (!TOKEN) {
    window.location.href = 'index.html?logout=timeout';
    return;
  }
  try {
    currentUser = JSON.parse(sessionStorage.getItem('eams_user'));
  } catch (e) {
    currentUser = null;
  }

  if (!currentUser) {
    window.location.href = 'index.html?logout=timeout';
    return;
  }

  // Hydrate User Profile
  var name = currentUser.name || currentUser.fullName || currentUser.username || 'User';
  var role = currentUser.role || 'admin';
  document.getElementById('sb-user-name').textContent = name;
  document.getElementById('sb-user-role').textContent = role.toUpperCase();
  document.getElementById('sb-user-avatar').textContent = name.charAt(0).toUpperCase();

  // Sub-admin / Admin validation
  if (role === 'admin') {
    var clearBtn = document.getElementById('btn-clear-all');
    if (clearBtn) clearBtn.style.display = 'inline-flex';
  }

  // Back button text & routing
  var backBtn = document.getElementById('btn-back-hub');
  if (backBtn) {
    if (role === 'teacher') {
      backBtn.textContent = '← Back to Hub';
    } else {
      var ref = (document.referrer || '').toLowerCase();
      if (ref.includes('control.html')) {
        backBtn.textContent = '← Back to Control Panel';
      } else {
        backBtn.textContent = '← Back to Dashboard';
      }
    }
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

function freezeUIOnLogout(reason) {
  try {
    document.body.style.pointerEvents = 'none';
    document.body.style.cursor = 'not-allowed';
    document.body.style.userSelect = 'none';

    var blockInteraction = function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      return false;
    };

    ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'mousemove', 'keydown', 'keypress', 'keyup', 'touchstart', 'touchend', 'contextmenu', 'selectstart'].forEach(function (evt) {
      window.addEventListener(evt, blockInteraction, { capture: true, passive: false });
    });

    var existingOverlay = document.getElementById('logout-freeze-overlay');
    if (!existingOverlay) {
      var overlay = document.createElement('div');
      overlay.id = 'logout-freeze-overlay';
      overlay.className = 'logout-freeze-overlay';
      overlay.innerHTML = '<div style="width:58px;height:58px;border-radius:50%;background:#e8f5e9;border:2px solid #a5d6a7;display:flex;align-items:center;justify-content:center;font-size:26px;box-shadow:0 8px 30px rgba(0,0,0,0.35);">🔒</div>' +
        '<div style="font-size:18px;font-weight:700;letter-spacing:-0.3px;color:#ffffff;">' + (reason || 'Signing Out…') + '</div>' +
        '<div style="font-size:12.5px;color:#a5d6a7;font-weight:500;">Securing session and clearing credentials…</div>' +
        '<div style="width:22px;height:22px;border:2.5px solid rgba(255,255,255,0.25);border-top-color:#a5d6a7;border-radius:50%;animation:spinLoader 0.6s linear infinite;margin-top:4px;"></div>';
      document.body.appendChild(overlay);
    }
  } catch (err) {}
}

function doLogout(reasonType) {
  var isAutoTimeout = reasonType === 'timeout' || reasonType === 'auto';
  var msg = isAutoTimeout ? 'Session Expired — Logging Out…' : 'Signing Out…';
  freezeUIOnLogout(msg);

  fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: isAutoTimeout ? 'auto' : 'manual' })
  }).finally(function () {
    sessionStorage.clear();
    var targetUrl = isAutoTimeout ? 'index.html?logout=timeout' : 'index.html?logout=manual';
    history.replaceState(null, '', targetUrl);
    setTimeout(function() {
      window.location.replace(targetUrl);
    }, 400);
  });
}

function toggleSidebar() {
  var sb = document.getElementById('sidebar');
  var backdrop = document.getElementById('sb-backdrop');
  if (sb) {
    sb.classList.toggle('open');
    if (backdrop) {
      backdrop.style.display = sb.classList.contains('open') ? 'block' : 'none';
    }
  }
}

// STATS LOADING & RENDERING
function loadStats() {
  fetch('/api/logs/stats', {
    headers: { 'Authorization': 'Bearer ' + TOKEN }
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && !data.error) {
        serverStats = data;
        updateSidebarBadges(data);
        renderStatusCards();
      }
    })
    .catch(function () { });
}

function updateSidebarBadges(stats) {
  document.getElementById('badge-overview-count').textContent = stats.totalLogs || 0;
  document.getElementById('badge-admin-count').textContent = stats.adminLogs || 0;
  document.getElementById('badge-teacher-count').textContent = stats.teacherLogs || 0;
  document.getElementById('badge-student-count').textContent = stats.studentLogs || 0;
  document.getElementById('badge-system-count').textContent = stats.systemLogs || 0;
}

function renderStatusCards() {
  var container = document.getElementById('status-cards-container');
  if (!container) return;

  var cards = [];
  if (currentSection === 'overview') {
    cards = [
      { ic: '📋', cls: 'blue', val: serverStats.totalLogs || 0, lbl: 'Total Audit Logs' },
      { ic: '⚡', cls: 'green', val: serverStats.todayLogs || 0, lbl: 'Actions Logged Today' },
      { ic: '🟢', cls: 'purple', val: serverStats.activeSessions || 0, lbl: 'Active Online Sessions' },
      { ic: '🚨', cls: 'red', val: serverStats.criticalEvents || 0, lbl: 'Critical Security Events' }
    ];
  } else if (currentSection === 'admin') {
    cards = [
      { ic: '👑', cls: 'red', val: serverStats.adminLogs || 0, lbl: 'Total Admin Logs' },
      { ic: '🔒', cls: 'amber', val: serverStats.lockedCount || 0, lbl: 'Locked Accounts' },
      { ic: '⚡', cls: 'blue', val: serverStats.todayLogs || 0, lbl: 'Today Activities' },
      { ic: '🛡️', cls: 'green', val: 'Active', lbl: 'Audit Guard Status' }
    ];
  } else if (currentSection === 'teacher') {
    cards = [
      { ic: '👩‍🏫', cls: 'blue', val: serverStats.teacherLogs || 0, lbl: 'Faculty Action Logs' },
      { ic: '📅', cls: 'green', val: 'Realtime', lbl: 'Attendance Logging' },
      { ic: '📝', cls: 'purple', val: 'Audited', lbl: 'Exam Submissions' },
      { ic: '⚡', cls: 'amber', val: serverStats.activeSessions || 0, lbl: 'Active Faculty' }
    ];
  } else if (currentSection === 'student') {
    cards = [
      { ic: '🎓', cls: 'green', val: serverStats.studentLogs || 0, lbl: 'Student Logs' },
      { ic: '📊', cls: 'blue', val: 'Aggregated', lbl: 'Daily Attendance' },
      { ic: '🏖️', cls: 'purple', val: 'Captured', lbl: 'Leave Queries' },
      { ic: '🟢', cls: 'amber', val: serverStats.activeSessions || 0, lbl: 'Active Students' }
    ];
  } else if (currentSection === 'system') {
    cards = [
      { ic: '🤖', cls: 'purple', val: serverStats.systemLogs || 0, lbl: 'System & Control Logs' },
      { ic: '🗄️', cls: 'blue', val: 'Encrypted', lbl: 'Log AES-256 Storage' },
      { ic: '📢', cls: 'amber', val: 'Audited', lbl: 'Broadcast History' },
      { ic: '🚨', cls: 'red', val: serverStats.criticalEvents || 0, lbl: 'Critical Alerts' }
    ];
  }

  container.innerHTML = cards.map(function (c) {
    return '<div class="stat-card">' +
      '<div class="stat-ic ' + c.cls + '">' + c.ic + '</div>' +
      '<div>' +
        '<div class="stat-val">' + c.val + '</div>' +
        '<div class="stat-lbl">' + c.lbl + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// SECTION SWITCHING
function switchSection(sectionKey) {
  currentSection = sectionKey;
  currentSubType = 'all';

  // Update Sidebar Active state
  document.querySelectorAll('.sb-item').forEach(function (btn) {
    btn.classList.toggle('act', btn.getAttribute('data-section') === sectionKey);
  });

  // Update Topbar metadata
  var meta = SECTION_META[sectionKey] || SECTION_META.overview;
  document.getElementById('page-section-title').innerHTML = meta.title;
  document.getElementById('page-section-desc').textContent = meta.desc;

  // Render Section Status Cards
  renderStatusCards();

  // Render Sub-filter chips
  renderSubfilterChips();

  // Fetch Logs
  fetchLogs(true);
}

function renderSubfilterChips() {
  var container = document.getElementById('subfilter-chips-container');
  if (!container) return;

  var chips = SECTION_CHIPS[currentSection] || SECTION_CHIPS.overview;
  container.innerHTML = chips.map(function (chip) {
    var isAct = chip.id === currentSubType ? 'act' : '';
    return '<button class="chip-btn ' + isAct + '" onclick="setSubType(\'' + chip.id + '\')">' + chip.label + '</button>';
  }).join('');
}

function setSubType(subType) {
  currentSubType = subType;
  renderSubfilterChips();
  fetchLogs(true);
}

// EVENT LISTENERS & FILTERING
function setupEventListeners() {
  // Real-time debounce search
  var searchInput = document.getElementById('filter-search');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(function () {
        currentSearch = searchInput.value.trim();
        fetchLogs(true);
      }, 350);
    });
  }
}

function onSearchInput() {
  // Handled by event listener debounce
}

function onFilterChange() {
  fromDate = document.getElementById('filter-from-date').value;
  toDate = document.getElementById('filter-to-date').value;
  currentSeverity = document.getElementById('filter-severity').value;
  fetchLogs(true);
}

function refreshCurrentLogs() {
  loadStats();
  fetchLogs(true);
  showToast('🔄 Audit logs refreshed', 'info');
}

// LOG FETCHING & RENDERING
function fetchLogs(reset) {
  if (isLoading) return;
  isLoading = true;

  if (reset) {
    currentCursor = null;
    logsList = [];
    var container = document.getElementById('log-feed-container');
    if (container) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">⏳ Fetching decrypted audit trail…</div>';
    }
  }

  var params = new URLSearchParams();
  params.set('limit', '40');

  if (currentSection !== 'overview') {
    params.set('module', currentSection);
  }
  if (currentSubType !== 'all') {
    params.set('subType', currentSubType);
  }
  if (currentSeverity !== 'all') {
    params.set('severity', currentSeverity);
  }
  if (currentSearch) {
    params.set('search', currentSearch);
  }
  if (fromDate) params.set('from', fromDate);
  if (toDate) params.set('to', toDate);
  if (currentCursor) params.set('before', currentCursor);

  fetch('/api/logs?' + params.toString(), {
    headers: { 'Authorization': 'Bearer ' + TOKEN }
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      isLoading = false;
      if (data.error) {
        showToast('❌ ' + data.error, 'error');
        return;
      }

      var incoming = data.logs || [];
      if (reset) {
        logsList = incoming;
      } else {
        logsList = logsList.concat(incoming);
      }

      hasMoreLogs = data.hasMore;
      if (incoming.length > 0) {
        currentCursor = incoming[incoming.length - 1].createdAt || incoming[incoming.length - 1].time;
      }

      renderLogsList();

      var loadMoreWrap = document.getElementById('load-more-wrap');
      if (loadMoreWrap) {
        loadMoreWrap.style.display = hasMoreLogs ? 'block' : 'none';
      }
    })
    .catch(function (err) {
      isLoading = false;
      showToast('❌ Failed to fetch logs: ' + err.message, 'error');
    });
}

function loadMoreLogs() {
  if (hasMoreLogs && !isLoading) {
    fetchLogs(false);
  }
}

// LOG RENDERING & GROUPING
function renderLogsList() {
  var container = document.getElementById('log-feed-container');
  if (!container) return;

  if (logsList.length === 0) {
    container.innerHTML = '<div class="empty-state">' +
      '<div class="empty-icon">📭</div>' +
      '<div class="empty-title">No Audit Logs Found</div>' +
      '<div style="font-size:12.5px;">No activity records match your active section or filters.</div>' +
    '</div>';
    return;
  }

  // Group logs by Calendar Date
  var groups = {};
  var groupOrder = [];

  logsList.forEach(function (log) {
    var ts = log.time || log.createdAt || new Date().toISOString();
    var dateKey = new Date(ts).toDateString();
    if (!groups[dateKey]) {
      groups[dateKey] = {
        label: formatDateLabel(ts),
        entries: []
      };
      groupOrder.push(dateKey);
    }
    groups[dateKey].entries.push(log);
  });

  var html = '';
  groupOrder.forEach(function (dateKey) {
    var group = groups[dateKey];
    html += '<div class="date-divider">' +
      '<span class="date-badge">' + group.label + '</span>' +
      '<span class="date-line"></span>' +
      '<span class="date-count">' + group.entries.length + ' ' + (group.entries.length === 1 ? 'activity' : 'activities') + '</span>' +
    '</div>';

    html += '<div class="log-list-card">';
    group.entries.forEach(function (log) {
      html += renderLogRow(log);
    });
    html += '</div>';
  });

  container.innerHTML = html;
}

function renderLogRow(log) {
  var role = (log.role || 'system').toLowerCase();
  var subType = log.subType || 'action';
  var severity = log.severity || 'info';
  var userName = log.userName || 'System';
  var userInitial = userName.charAt(0).toUpperCase();

  var avatarBg = role === 'admin' 
    ? 'linear-gradient(135deg, #dc2626, #b91c1c)' 
    : (role === 'teacher' 
      ? 'linear-gradient(135deg, #1b5e20, #388e3c)' 
      : (role === 'student' 
        ? 'linear-gradient(135deg, #2e7d32, #66bb6a)' 
        : 'linear-gradient(135deg, #7c3aed, #4f46e5)'));
  var timeStr = formatRelativeTime(log.time || log.createdAt);
  var exactTime = new Date(log.time || log.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Session ID badge
  var sessId = log.sessionId || (log.sessionInfo && log.sessionInfo.sessionId) || '';
  var sessBadge = sessId
    ? '<span class="log-sess-badge" title="User Session ID: ' + escapeHtml(sessId) + '">🔑 ' + escapeHtml(sessId.length > 8 ? sessId.slice(0, 8) + '…' : sessId) + '</span>'
    : '';

  // GPS Location badge
  var loc = log.location || (log.sessionInfo && log.sessionInfo.location) || {};
  var locText = '';
  if (loc.address) {
    locText = loc.address;
  } else if (loc.latitude !== null && loc.latitude !== undefined) {
    locText = Number(loc.latitude).toFixed(4) + ', ' + Number(loc.longitude).toFixed(4);
  }
  var gpsBadge = locText
    ? '<span class="log-gps-badge" title="GPS Location: ' + escapeHtml(locText) + '">📍 ' + escapeHtml(locText.length > 28 ? locText.slice(0, 28) + '…' : locText) + '</span>'
    : '';

  // Format rich Page View description
  var pageViewDesc = getPageViewDescription(log);

  return '<div class="log-row" onclick="openLogDetail(\'' + (log._id || log.logTrackId) + '\')">' +
    '<div class="log-avatar" style="background:' + avatarBg + ';">' + userInitial + '</div>' +
    '<div class="log-content">' +
      '<div class="log-meta-line">' +
        (log.logTrackId ? '<span class="log-track-id" onclick="copyTrackId(event, \'' + log.logTrackId + '\')" title="Click to copy tracking ID">' + log.logTrackId + '</span>' : '') +
        '<span class="log-username">' + escapeHtml(userName) + '</span>' +
        '<span class="badge-role ' + role + '">' + role.toUpperCase() + '</span>' +
        '<span class="badge-subtype">' + formatSubTypeLabel(subType) + '</span>' +
        '<span class="badge-severity ' + severity + '">' + severity.toUpperCase() + '</span>' +
        (log.actingWithAdminRights ? '<span style="font-size:10px;font-weight:700;color:#d97706;background:#fef3c7;padding:1px 6px;border-radius:10px;">ADMIN RIGHT</span>' : '') +
        sessBadge +
        gpsBadge +
      '</div>' +
      '<div class="log-action-title">' + escapeHtml(log.action || 'Activity Action') + '</div>' +
      '<div class="log-page-view-desc">' + pageViewDesc + '</div>' +
    '</div>' +
    '<div class="log-right-col">' +
      '<div class="log-time" title="' + exactTime + '">' + timeStr + '</div>' +
      (log.ip ? '<div class="log-ip-badge">' + formatDisplayIp(log.ip) + '</div>' : '') +
    '</div>' +
  '</div>';
}

function formatDisplayIp(rawIp) {
  if (!rawIp) return '';
  var ip = String(rawIp).trim();
  if (ip.startsWith('::ffff:')) ip = ip.substring(7);
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1' || ip === 'localhost') return '127.0.0.1';
  return ip;
}

// FORMATTING HELPERS
function getPageViewDescription(log) {
  var action = log.action || '';
  var subType = log.subType || '';
  var details = log.details || '';

  // 1. Attendance Class Daily Summary Log (Item 18.1)
  if (log.attendanceClassDaily && Array.isArray(log.attendanceClassDaily.periods) && log.attendanceClassDaily.periods.length > 0) {
    var acd = log.attendanceClassDaily;
    var periodCount = acd.periods.length;
    var latestPeriod = acd.periods[acd.periods.length - 1];
    var pStats = latestPeriod.stats || {};
    var methodStr = latestPeriod.method ? ' via ' + latestPeriod.method : '';
    return '📅 Class Attendance for <b>' + escapeHtml(acd.className || acd.classId) + '</b> on ' + escapeHtml(acd.date || '') +
      ': <b>' + periodCount + ' Period' + (periodCount !== 1 ? 's' : '') + ' Recorded</b>' +
      ' · Last: Period ' + latestPeriod.periodNumber + ' (' + (pStats.present || 0) + '/' + (pStats.total || 0) + ' Present' + methodStr + ')';
  }

  // 2. Session / Login Log Rule:
  // If active: "<user> Logged In at <time> (Active)"
  // If ended: "<user> Logged In at <time> · Logged Out at <time> (<manual/auto>)"
  if (subType === 'session' && log.sessionInfo) {
    var sess = log.sessionInfo;
    var loginTimeStr = sess.loginTime ? new Date(sess.loginTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
    if (sess.active) {
      return '🟢 <b>' + escapeHtml(log.userName) + '</b> Logged in at ' + loginTimeStr + ' <span style="color:#16a34a;font-weight:700;">(Currently Active)</span>' + (sess.location?.address ? ' from ' + escapeHtml(sess.location.address) : '');
    } else {
      var logoutTimeStr = sess.logoutTime ? new Date(sess.logoutTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Session Ended';
      var methodStr = sess.logoutMethod ? ' (' + sess.logoutMethod + ')' : '';
      return '⚪ <b>' + escapeHtml(log.userName) + '</b> Logged in at ' + loginTimeStr + ' · Logged out at ' + logoutTimeStr + methodStr;
    }
  }

  // 3. Legacy Attendance Summary Log
  if (subType === 'attendance' && log.attendanceSummary) {
    var att = log.attendanceSummary;
    var presentCount = (att.periods || []).filter(function (p) { return p.status === 'P'; }).length;
    var totalPeriods = (att.periods || []).length;
    return '📅 Attendance for <b>' + escapeHtml(att.studentName || log.userName) + '</b> on ' + (att.date || '') + ': <b>' + presentCount + '/' + totalPeriods + ' Periods Present</b>';
  }

  // 3. Field Edits / Diff Log
  if (subType === 'field-edit' && log.changes) {
    return '✏️ ' + (details || 'Modified attributes updated with before/after audit tracking');
  }

  // 4. Default fallback
  return escapeHtml(details || action);
}

function formatSubTypeLabel(subType) {
  var map = {
    'session': '🔑 Session',
    'field-edit': '✏️ Edit',
    'entry-create': '➕ Created',
    'entry-delete': '🗑️ Deleted',
    'attendance': '📅 Attendance',
    'leave': '📝 Leave',
    'bulk-action': '📦 Bulk',
    'backup': '🗄️ Backup',
    'export': '⬇️ Export',
    'broadcast': '📢 Broadcast',
    'danger': '⚠️ Danger',
    'security': '🔒 Security',
    'action': '⚡ Action',
    'page-access': '🌐 Page View'
  };
  return map[subType] || subType;
}

function formatDateLabel(isoString) {
  var d = new Date(isoString);
  var today = new Date();
  var yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

function formatRelativeTime(isoString) {
  var ms = Date.now() - new Date(isoString).getTime();
  var sec = Math.floor(ms / 1000);
  if (sec < 60) return 'Just now';
  var min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  var days = Math.floor(hr / 24);
  return days + 'd ago';
}

function copyTrackId(event, trackId) {
  event.stopPropagation();
  navigator.clipboard.writeText(trackId).then(function () {
    showToast('📋 Copied ' + trackId, 'info');
  });
}

// LOG DETAIL MODAL
function openLogDetail(idOrTrackId) {
  var modal = document.getElementById('m-log-detail');
  var body = document.getElementById('modal-body-content');
  if (!modal || !body) return;

  body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">⏳ Loading full audit metrics & joins…</div>';
  modal.classList.add('open');

  fetch('/api/logs/detail/' + idOrTrackId, {
    headers: { 'Authorization': 'Bearer ' + TOKEN }
  })
    .then(function (r) { return r.json(); })
    .then(function (log) {
      if (log.error) {
        body.innerHTML = '<div style="color:var(--danger);padding:20px;">' + log.error + '</div>';
        return;
      }
      renderModalDetailContent(log);
    })
    .catch(function (err) {
      body.innerHTML = '<div style="color:var(--danger);padding:20px;">Failed to load detail: ' + err.message + '</div>';
    });
}

function closeDetailModal() {
  document.getElementById('m-log-detail')?.classList.remove('open');
}

function renderModalDetailContent(log) {
  var body = document.getElementById('modal-body-content');
  if (!body) return;

  // Header updates
  document.getElementById('modal-action-title').textContent = log.action || 'Log Activity Detail';
  document.getElementById('modal-track-id').textContent = log.logTrackId || 'TR-LOG-000000';
  document.getElementById('modal-timestamp').textContent = new Date(log.time || log.createdAt).toLocaleString('en-IN', {
    dateStyle: 'full', timeStyle: 'medium'
  });

  var html = '';

  // 1. Actor & Hardware Profile Card
  var modalSessId = log.sessionId || (log.sessionInfo && log.sessionInfo.sessionId) || '';
  html += '<div class="kv-grid">' +
    '<div class="kv-item"><span class="kv-lbl">Actor Name / User</span><span class="kv-val">' + escapeHtml(log.userName || 'System') + ' (' + (log.role || 'system').toUpperCase() + ')</span></div>' +
    '<div class="kv-item"><span class="kv-lbl">Tracking ID</span><span class="kv-val" style="font-family:var(--font-mono);color:var(--gD);">' + (log.trackId || '—') + '</span></div>' +
    '<div class="kv-item"><span class="kv-lbl">IP Address</span><span class="kv-val" style="font-family:var(--font-mono);">' + (formatDisplayIp(log.ip) || '—') + '</span></div>' +
    '<div class="kv-item"><span class="kv-lbl">Severity / Module</span><span class="kv-val">' + (log.severity || 'info').toUpperCase() + ' · ' + (log.module || 'general').toUpperCase() + '</span></div>' +
    '<div class="kv-item" style="grid-column:1/-1;"><span class="kv-lbl">User Session ID</span><span class="kv-val" style="font-family:var(--font-mono);display:inline-flex;align-items:center;gap:8px;">' +
      (modalSessId ? escapeHtml(modalSessId) + ' <button class="copy-pill-btn" onclick="copySessionId(event, \'' + escapeHtml(modalSessId) + '\')">📋 Copy</button>' : '—') +
    '</span></div>' +
  '</div>';

  // 2. Session / Geolocation Information
  var modalLoc = log.location || (log.sessionInfo && log.sessionInfo.location) || {};
  var hasLocOrSession = modalSessId || modalLoc.latitude || modalLoc.address || log.sessionInfo;

  if (hasLocOrSession) {
    var sess = log.sessionInfo || {};
    html += '<div style="background:var(--gLt);border:1px solid var(--gLr);border-radius:12px;padding:16px;">' +
      '<div style="font-weight:800;font-size:13.5px;color:var(--gD);margin-bottom:10px;display:flex;align-items:center;gap:6px;">' +
        '<span>📍</span> Session Geolocation &amp; Security Metrics' +
      '</div>' +
      '<div class="kv-grid" style="background:#ffffff;margin-bottom:10px;">' +
        '<div class="kv-item"><span class="kv-lbl">Device &amp; OS</span><span class="kv-val">' + (sess.deviceType || 'Desktop') + ' · ' + (sess.os || 'Windows') + '</span></div>' +
        '<div class="kv-item"><span class="kv-lbl">Browser &amp; IP</span><span class="kv-val">' + (sess.browser || 'Chrome') + ' · ' + (formatDisplayIp(sess.ip || log.ip) || '127.0.0.1') + '</span></div>' +
        '<div class="kv-item"><span class="kv-lbl">Login Status</span><span class="kv-val">' + (sess.active ? '<span style="color:#16a34a;font-weight:700;">🟢 Active Session</span>' : (sess.logoutTime ? 'Session Ended (' + (sess.logoutMethod || 'manual') + ')' : 'Captured via Gateway')) + '</span></div>' +
        '<div class="kv-item"><span class="kv-lbl">Session ID</span><span class="kv-val" style="font-family:var(--font-mono);font-size:11px;">' + (modalSessId ? escapeHtml(modalSessId.slice(0, 16) + '…') : '—') + '</span></div>' +
      '</div>' +
      (modalLoc.latitude ? (
        '<div style="font-size:12px;color:#0284c7;line-height:1.5;">' +
          '<b>GPS Coordinates:</b> <span style="font-family:var(--font-mono);font-weight:700;">' + Number(modalLoc.latitude).toFixed(6) + ', ' + Number(modalLoc.longitude).toFixed(6) + '</span>' +
          (modalLoc.accuracy ? ' (Accuracy: ±' + Math.round(modalLoc.accuracy) + 'm)' : '') + '<br>' +
          '<b>Resolved Address:</b> ' + escapeHtml(modalLoc.address || 'Address reverse-geocoded successfully') +
        '</div>'
      ) : '<div style="font-size:12px;color:#64748b;">GPS Coordinates: Device location captured via authenticated session.</div>') +
    '</div>';
  }

  // 3. Before/After Field Diff Table (If Field Edit)
  if (log.changes && (log.changes.before || log.changes.after)) {
    html += '<div>' +
      '<div style="font-weight:800;font-size:13.5px;color:var(--text-main);margin-bottom:6px;">✏️ Modified Attribute Diffs (Before vs After)</div>' +
      renderDiffTable(log.changes.before, log.changes.after) +
    '</div>';
  }

  // 4. Class Daily Attendance Sheet (Item 18.1)
  if (log.attendanceClassDaily && Array.isArray(log.attendanceClassDaily.periods) && log.attendanceClassDaily.periods.length > 0) {
    var acd = log.attendanceClassDaily;
    html += '<div>' +
      '<div style="font-weight:800;font-size:14px;color:var(--text-main);margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
        '<div style="display:flex;align-items:center;gap:6px;"><span>📅</span> Class Daily Attendance Sheet — <b>' + escapeHtml(acd.className || acd.classId) + '</b> (' + escapeHtml(acd.date || '') + ')</div>' +
        '<span style="background:var(--gLt);color:var(--gD);padding:2px 10px;border-radius:12px;font-size:11.5px;font-weight:700;">' + acd.periods.length + ' Period' + (acd.periods.length !== 1 ? 's' : '') + ' Recorded</span>' +
      '</div>' +
      '<div class="att-daily-container">' +
        acd.periods.map(function (p) {
          var pStats = p.stats || {};
          var records = Array.isArray(p.records) ? p.records : [];
          var history = Array.isArray(p.history) ? p.history : [];
          var pTime = p.markedAt ? new Date(p.markedAt).toLocaleTimeString('en-IN') : '';

          return '<div class="att-period-card">' +
            '<div class="att-period-header">' +
              '<div class="att-period-title">' +
                '<span>Period ' + p.periodNumber + '</span>' +
                '<span style="font-weight:600;font-size:12px;color:var(--tmu);">' + escapeHtml(p.subjectName || p.subjectTrackId || '') + '</span>' +
                '<span class="att-method-badge">' + escapeHtml(p.method || 'Manual') + '</span>' +
              '</div>' +
              '<div class="att-stats-summary">' +
                '<span style="color:#16a34a;">✅ ' + (pStats.present || 0) + ' Present</span> · ' +
                '<span style="color:#dc2626;">❌ ' + (pStats.absent || 0) + ' Absent</span>' +
                (pStats.od ? ' · <span style="color:#d97706;">⚡ ' + pStats.od + ' OD</span>' : '') +
              '</div>' +
            '</div>' +
            '<div class="att-meta-grid">' +
              '<div><strong>Staff:</strong> ' + escapeHtml(p.teacherName || 'Teacher') + '</div>' +
              '<div><strong>Staff Session ID:</strong> <span style="font-family:var(--font-mono);font-size:11px;">' + (p.teacherSessionId ? escapeHtml(p.teacherSessionId.slice(0, 10) + '…') : '—') + '</span> ' +
                (p.teacherSessionId ? '<button class="copy-pill-btn" onclick="copySessionId(event, \'' + escapeHtml(p.teacherSessionId) + '\')">📋</button>' : '') + '</div>' +
              '<div><strong>Marked At:</strong> ' + (pTime || '—') + '</div>' +
              (p.topic ? '<div><strong>Topic:</strong> ' + escapeHtml(p.topic) + '</div>' : '') +
            '</div>' +
            '<div style="font-size:11.5px;font-weight:700;color:var(--td);margin-bottom:6px;">Student Register Numbers &amp; Status (' + records.length + ' Students):</div>' +
            '<div class="stu-reg-chips-wrap">' +
              records.map(function (r) {
                var st = (r.status || 'P').toUpperCase();
                var cls = (st === 'P' || st === 'PRESENT') ? 'present' : ((st === 'OD' || st === 'ON DUTY') ? 'od' : 'absent');
                return '<div class="stu-reg-chip ' + cls + '" title="' + escapeHtml(r.name || '') + ' (' + st + ')">' +
                  '<span>' + escapeHtml(r.regNo || r.studentTrackId) + '</span>' +
                  '<span style="opacity:0.8;font-size:9.5px;">[' + escapeHtml(st) + ']</span>' +
                '</div>';
              }).join('') +
            '</div>' +
            (history.length > 0 ? (
              '<div class="att-history-box">' +
                '<b>Audit Trail:</b> ' + history.map(function (h) {
                  var hTime = h.changedAt ? new Date(h.changedAt).toLocaleTimeString('en-IN') : '';
                  return escapeHtml(h.summary || h.action) + ' (' + hTime + ')';
                }).join(' · ') +
              '</div>'
            ) : '') +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  // 5. Legacy Student Daily Attendance Summary View
  var hasMarkedAttendance = false;
  var markedPeriods = [];
  if (!log.attendanceClassDaily && log.attendanceSummary && Array.isArray(log.attendanceSummary.periods) && log.attendanceSummary.periods.length > 0) {
    markedPeriods = log.attendanceSummary.periods.filter(function (p) {
      return p && p.status && p.status !== '—' && p.status !== '-' && String(p.status).trim() !== '';
    });
    hasMarkedAttendance = markedPeriods.length > 0;
  }

  if (hasMarkedAttendance) {
    var att = log.attendanceSummary;
    html += '<div>' +
      '<div style="font-weight:800;font-size:13.5px;color:var(--text-main);margin-bottom:8px;display:flex;align-items:center;gap:6px;">' +
        '<span>📅</span> Student Daily Attendance Periods Sheet' +
        (att.date ? ' <span style="font-size:12px;color:var(--text-muted);font-weight:500;">(' + escapeHtml(att.date) + ')</span>' : '') +
      '</div>' +
      '<div class="periods-badge-wrap" style="display:flex;flex-wrap:wrap;gap:8px;">' +
        markedPeriods.map(function (p) {
          var pNum = p.periodNumber !== undefined ? p.periodNumber : (p.period !== undefined ? p.period : 1);
          var status = (p.status || 'P').toUpperCase();
          var subj = p.subjectName || p.subjectCode || '';
          var isPresent = status === 'P' || status === 'PRESENT';
          var isAbsent = status === 'A' || status === 'ABSENT';
          var isOD = status === 'OD' || status === 'ON DUTY';
          
          var badgeBg = isPresent ? '#e8f5e9' : (isAbsent ? '#fee2e2' : (isOD ? '#fef3c7' : '#f1f5f9'));
          var badgeBorder = isPresent ? '#a5d6a7' : (isAbsent ? '#fca5a5' : (isOD ? '#fde68a' : '#cbd5e1'));
          var badgeColor = isPresent ? '#1b5e20' : (isAbsent ? '#b91c1c' : (isOD ? '#b45309' : '#475569'));

          return '<div class="period-pill" style="background:' + badgeBg + ';border:1px solid ' + badgeBorder + ';color:' + badgeColor + ';padding:6px 12px;border-radius:8px;font-size:12px;display:inline-flex;align-items:center;gap:6px;">' +
            '<span style="font-weight:600;">Period ' + pNum + ':</span>' +
            '<b style="font-weight:800;">' + escapeHtml(status) + '</b>' +
            (subj ? '<span style="opacity:0.8;font-size:11px;">(' + escapeHtml(subj) + ')</span>' : '') +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  // 5. Raw Event Details
  if (log.details) {
    html += '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;">' +
      '<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">Log Details Message</div>' +
      '<div style="font-size:13px;color:var(--text-main);line-height:1.4;">' + escapeHtml(log.details) + '</div>' +
    '</div>';
  }

  body.innerHTML = html;
}

function renderDiffTable(before, after) {
  before = before || {};
  after = after || {};

  var allKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  var ignoredKeys = ['_id', '__v', 'password', 'passwordHistory', 'createdAt', 'updatedAt', 'history'];
  var diffKeys = allKeys.filter(function (k) {
    return !ignoredKeys.includes(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]);
  });

  if (diffKeys.length === 0) {
    return '<div style="font-size:12.5px;color:var(--text-muted);padding:8px;">No field-level differences recorded for this entry.</div>';
  }

  var html = '<table class="diff-table">' +
    '<thead>' +
      '<tr><th style="width:25%;">Field Attribute</th><th style="width:37.5%;">Previous Value</th><th style="width:37.5%;">Updated Value</th></tr>' +
    '</thead>' +
    '<tbody>';

  diffKeys.forEach(function (k) {
    var oldVal = before[k] !== undefined ? JSON.stringify(before[k]) : '—';
    var newVal = after[k] !== undefined ? JSON.stringify(after[k]) : '—';
    html += '<tr>' +
      '<td><b style="font-family:var(--font-mono);color:#475569;">' + escapeHtml(k) + '</b></td>' +
      '<td class="diff-old">' + escapeHtml(oldVal) + '</td>' +
      '<td class="diff-new">' + escapeHtml(newVal) + '</td>' +
    '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

// CSV EXPORT
function exportFilteredCSV() {
  showToast('⏳ Generating decrypted CSV audit export…', 'info');

  fetch('/api/logs/export', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      module: currentSection,
      subType: currentSubType,
      severity: currentSeverity,
      search: currentSearch,
      from: fromDate,
      to: toDate
    })
  })
    .then(function (res) {
      if (!res.ok) throw new Error('Export failed with status ' + res.status);
      return res.blob();
    })
    .then(function (blob) {
      var url = window.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'EAMS_Audit_Logs_' + currentSection + '_' + Date.now() + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('✅ CSV Export downloaded successfully', 'info');
    })
    .catch(function (err) {
      showToast('❌ CSV Export error: ' + err.message, 'error');
    });
}

// CLEAR LOGS (ADMIN ONLY MODAL FLOW)
function openClearLogsModal() {
  var modal = document.getElementById('m-clear-logs');
  if (modal) modal.classList.add('open');
}

function closeClearLogsModal() {
  var modal = document.getElementById('m-clear-logs');
  if (modal) modal.classList.remove('open');
}

function confirmClearLogs() {
  var btn = document.getElementById('btn-confirm-clear-logs');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Purging Logs…';
  }

  fetch('/api/logs/all', {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + TOKEN }
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      closeClearLogsModal();
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '🗑️ Yes, Clear All Logs';
      }
      if (data.deleted) {
        showToast('🗑️ All audit logs purged successfully', 'info');
        loadStats();
        fetchLogs(true);
      }
    })
    .catch(function (err) {
      closeClearLogsModal();
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '🗑️ Yes, Clear All Logs';
      }
      showToast('❌ Clear failed: ' + err.message, 'error');
    });
}

// TOAST MESSAGE
function showToast(msg, type) {
  var toast = document.getElementById('app-toast');
  var text = document.getElementById('toast-text');
  var icon = document.getElementById('toast-icon');
  if (!toast || !text) return;

  text.textContent = msg;
  icon.textContent = type === 'error' ? '❌' : (type === 'warn' ? '⚠️' : 'ℹ️');
  toast.classList.add('show');
  setTimeout(function () {
    toast.classList.remove('show');
  }, 3500);
}

function copySessionId(e, sessId) {
  if (e) e.stopPropagation();
  if (!sessId) return;
  if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(sessId).then(function () {
      showToast('Session ID copied to clipboard: ' + sessId, 'success');
    }).catch(function () {
      prompt('Copy Session ID:', sessId);
    });
  } else {
    prompt('Copy Session ID:', sessId);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
