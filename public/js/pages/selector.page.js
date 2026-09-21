function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// SELECTOR PAGE JS
var currentUser = checkAuth('any');

var portalPagesState = {
  pageStudents: 'enabled',
  pageTeachers: 'enabled',
  pageManage: 'enabled',
  pageBulk: 'enabled',
  pageTimeTable: 'enabled',
  pageSelector: 'enabled',
};

var revealed = false;
function revealSelectorUI() {
  if (revealed) return;
  revealed = true;
  var loader = document.getElementById('page-loader');
  if (loader) {
    loader.classList.add('loader-fade');
    setTimeout(function () {
      loader.style.display = 'none';
    }, 350);
  }
  var shell = document.getElementById('app-shell');
  if (shell) shell.classList.add('vis');
}

(function initSelector() {
  if (!currentUser) return;

  try {
    var loaderMsgEl = document.getElementById('loader-msg');
    function setLoaderMsg(idx, text) {
      if (!loaderMsgEl) return;
      loaderMsgEl.classList.add('msg-fade');
      setTimeout(function () {
        loaderMsgEl.textContent = text;
        loaderMsgEl.classList.remove('msg-fade');
        for (var s = 0; s < 4; s++) {
          var dot = document.getElementById('lstep-' + s);
          if (!dot) continue;
          dot.className = 'loader-step' + (s < idx ? ' done' : s === idx ? ' active' : '');
        }
      }, 100);
    }

    var LOADER_STEPS = [
      { t: 0, msg: 'Initializing EAMS Workspace Hub…' },
      { t: 150, msg: 'Evaluating Active Rights & Modules…' },
      { t: 300, msg: 'Configuring Available Workspaces…' },
      { t: 450, msg: 'Almost ready…' }
    ];

    LOADER_STEPS.forEach(function (step, i) {
      if (i === 0) return;
      setTimeout(function () { setLoaderMsg(i, step.msg); }, step.t);
    });

    // Hydrate topbar from current session immediately
    hydrateUserHeader(currentUser);
    renderRoleTags(currentUser);
    renderCards();
  } catch (err) {
    console.error('[Selector] Critical initialization error:', err);
  } finally {
    // Safety fallback: guaranteed reveal after 600ms
    setTimeout(revealSelectorUI, 600);
  }

  // Fetch fresh profile and portal settings in background
  Promise.all([
    syncFreshProfile().catch(function(e) { console.warn('[Selector] Fresh profile fetch error:', e); }),
    fetchPortalStatus().catch(function(e) { console.warn('[Selector] Portal status fetch error:', e); })
  ]).then(function() {
    renderCards();
    revealSelectorUI();
  }).catch(function() {
    revealSelectorUI();
  });

  // Auto-sync whenever the window regains focus or storage changes
  window.addEventListener('focus', function() {
    syncFreshProfile();
    fetchPortalStatus();
  });
  window.addEventListener('storage', function(e) {
    if (e.key === 'eams_user') {
      try {
        currentUser = JSON.parse(sessionStorage.getItem('eams_user') || '{}');
        hydrateUserHeader(currentUser);
        renderRoleTags(currentUser);
        renderCards();
      } catch (err) {}
    }
  });
})();

function syncFreshProfile() {
  var token = getToken();
  if (!token) return Promise.resolve();

  return fetch('/api/profile/me?_t=' + Date.now(), {
    headers: { 'Authorization': 'Bearer ' + token, 'Cache-Control': 'no-cache' }
  })
  .then(function(r) { return r.json(); })
  .then(function(profile) {
    if (profile && !profile.error) {
      currentUser = Object.assign({}, currentUser, {
        name: profile.fullName || profile.name || currentUser.name,
        username: profile.username || currentUser.username,
        dept: profile.department || currentUser.dept || '',
        desig: profile.designation || currentUser.desig || '',
        isAdmin: !!profile.isAdmin,
        adminRights: profile.adminRights || currentUser.adminRights || [],
        adminFlag: profile.adminFlag || currentUser.adminFlag || (profile.role === 'admin' ? 'superadmin' : 'none'),
        isHod: !!profile.isHod || (Array.isArray(profile.specials) && profile.specials.some(function(s){ return s.option === 'isHod'; })),
        isTimeTableCoordinator: !!profile.isTimeTableCoordinator
      });
      sessionStorage.setItem('eams_user', JSON.stringify(currentUser));
      hydrateUserHeader(currentUser);
      renderRoleTags(currentUser);
      renderCards();
    }
  })
  .catch(function(err) {
    console.warn('[Selector] Fresh profile auto-sync fallback:', err);
  });
}

function hydrateUserHeader(user) {
  var name = user.name || user.username || 'User';
  var initial = (name.charAt(0) || 'U').toUpperCase();
  
  var avEl = document.getElementById('u-av');
  if (avEl) avEl.textContent = initial;

  var nameEl = document.getElementById('u-name');
  if (nameEl) nameEl.textContent = name;

  var roleEl = document.getElementById('u-role');
  if (roleEl) {
    var roleText = 'User';
    if (user.adminFlag === 'principal') {
      roleText = 'Principal · Executive Oversight';
    } else if (user.role === 'admin') {
      roleText = user.adminFlag === 'subadmin' ? 'Sub-Administrator' : 'Super Administrator';
    } else if (user.isHod) {
      roleText = 'Head of Department (HOD)';
      if (user.dept) roleText += ' · ' + user.dept;
    } else {
      roleText = user.desig || 'Faculty';
      if (user.dept) roleText += ' · ' + user.dept;
      if (user.isAdmin) roleText += ' (Admin Access)';
    }
    roleEl.textContent = roleText;
  }

  var welcomeEl = document.getElementById('welcome-title');
  if (welcomeEl) {
    var firstName = name.split(' ')[0] || name;
    welcomeEl.textContent = 'Welcome back, ' + firstName;
  }
}

function renderRoleTags(user) {
  var tagsBar = document.getElementById('role-tags-bar');
  if (!tagsBar) return;

  var tags = [];

  if (user.adminFlag === 'principal') {
    tags.push('<span class="role-tag-pill active" style="background:#eef2ff;border-color:#c7d2fe;color:#3730a3;">🏛️ Principal · Institutional Executive</span>');
  }
  if (user.adminFlag === 'subadmin') {
    tags.push('<span class="role-tag-pill active" style="background:#f5f3ff;border-color:#ddd6fe;color:#5b21b6;">⚡ Sub-Administrator</span>');
  }
  if (user.isHod) {
    tags.push('<span class="role-tag-pill active" style="background:#fdf2f8;border-color:#fbcfe8;color:#9d174d;">🏛️ Head of Department (HOD)</span>');
  }
  if (user.role === 'teacher') {
    tags.push('<span class="role-tag-pill active">👩‍🏫 Faculty Member</span>');
  }
  if (user.isTimeTableCoordinator) {
    tags.push('<span class="role-tag-pill active" style="background:#fffbeb;border-color:#fde68a;color:#92400e;">🗓️ Timetable Coordinator</span>');
  }

  var rightsList = [];
  if (Array.isArray(user.adminRights)) {
    rightsList = user.adminRights;
  } else if (typeof user.adminRights === 'string') {
    rightsList = user.adminRights === 'all' ? ['all'] : user.adminRights.split(',').map(function(s){ return s.trim(); });
  }

  var isFullSuperAdmin = user.role === 'admin' && user.adminFlag !== 'subadmin' && user.adminFlag !== 'principal';
  var hasAllRights = rightsList.includes('all');

  if (isFullSuperAdmin || (user.isAdmin && hasAllRights && user.adminFlag !== 'principal')) {
    tags.push('<span class="role-tag-pill active" style="background:#fef2f2;border-color:#fecaca;color:#991b1b;">🛡️ Full Admin Authority</span>');
  } else if (user.isAdmin && rightsList.length) {
    var validRights = rightsList.filter(function(r){ return r && r !== 'none'; });
    if (validRights.length) {
      tags.push('<span class="role-tag-pill active" style="background:#eef2ff;border-color:#c7d2fe;color:#3730a3;">⚡ Admin Privileges (' + validRights.length + ' modules)</span>');
    }
  }

  tagsBar.innerHTML = tags.join('');
}

function fetchPortalStatus() {
  return fetch('/api/settings/public?_t=' + Date.now())
    .then(function(r) { return r.json(); })
    .then(function(pub) {
      if (pub) {
        if (pub.institution) {
          var shortN = pub.institution.institutionShort || '';
          document.title = 'Workspace Hub' + (shortN ? (' · ' + shortN) : ' · EAMS');
          if (pub.institution.institutionName) {
            var sub = document.getElementById('sel-inst-sub');
            if (sub) sub.textContent = pub.institution.institutionName;
          }
          var foot = document.getElementById('sel-footer-inst');
          if (foot) foot.textContent = (shortN || 'EAMS') + (pub.institution.institutionName ? (' · ' + pub.institution.institutionName) : '');
        }
        if (pub.pages) {
          portalPagesState = Object.assign({}, portalPagesState, pub.pages);
          var user = currentUser || getUser() || {};
          if (user.role === 'teacher' && !user.isAdmin && !user.isHod && !user.isTimeTableCoordinator && (portalPagesState.pageSelector === 'hidden' || portalPagesState.pageSelector === 'disabled')) {
            window.location.replace('teacher.html');
            return;
          }
        }
      }
    })
    .catch(function(err) {});
}

function getPortalDefinitions(user) {
  var isSuperAdmin = user.role === 'admin' && user.adminFlag !== 'subadmin' && user.adminFlag !== 'principal';
  var pages = portalPagesState || {};

  var teacherState = isSuperAdmin ? 'enabled' : (pages.pageTeachers || 'enabled');
  var ttState = isSuperAdmin ? 'enabled' : (pages.pageTimeTable || 'enabled');
  var manageState = isSuperAdmin ? 'enabled' : (pages.pageManage || 'enabled');
  var bulkState = isSuperAdmin ? 'enabled' : (pages.pageBulk || 'enabled');

  return [
    {
      id: 'controller',
      title: 'Controller Portal',
      desc: 'Attendance tracking, leave approval workflows, defaulters notices, and broadcasting.',
      icon: '🏛️',
      tag: user.adminFlag === 'principal' ? 'Principal · College-wide' : (user.isHod ? ('HOD · ' + (user.dept || 'Department')) : 'Executive Hub'),
      link: 'controller.html',
      accent: '#4f46e5',
      iconBg: '#eef2ff',
      tagBg: '#eef2ff',
      tagCol: '#3730a3',
      highlights: ['Attendance Overview', 'Leave Approvals', 'Defaulters Notice', 'Broadcast Hub'],
      btnText: 'Launch Controller',
      state: 'enabled',
      allowed: !!user.isHod || user.adminFlag === 'principal' || (user.role === 'admin' && user.adminFlag === 'superadmin')
    },
    {
      id: 'teacher',
      title: 'Teacher Portal',
      desc: 'Mark daily student attendance, manage assigned subject rosters, track class records, and view schedule allocations.',
      icon: '👩‍🏫',
      tag: 'Primary Workspace',
      link: 'teacher.html',
      accent: '#2e7d32',
      iconBg: '#e8f5e9',
      tagBg: '#e8f5e9',
      tagCol: '#1b5e20',
      highlights: ['Take Attendance', 'Class Rosters', 'Attendance Logs', 'My Schedule'],
      btnText: 'Open Portal',
      state: teacherState,
      allowed: user.role === 'teacher' && teacherState !== 'hidden'
    },
    {
      id: 'timetable',
      title: 'Timetable Management',
      desc: 'Create master schedules, allocate teacher periods, manage class slots, and timetable coordination.',
      icon: '📅',
      tag: 'Timetable Hub',
      link: 'timetable.html',
      accent: '#d97706',
      iconBg: '#fffbeb',
      tagBg: '#fffbeb',
      tagCol: '#92400e',
      highlights: ['Master Timetables', 'Slot Allocations', 'Coordination'],
      btnText: 'Manage Timetable',
      state: ttState,
      allowed: (hasRight('timetablePage') || hasRight('all') || user.isTimeTableCoordinator || user.role === 'admin') && ttState !== 'hidden'
    },
    {
      id: 'manage',
      title: 'Data & Exam Management',
      desc: 'Institution calendar terms, examination schedules, subject catalogs, and year batch data.',
      icon: '📋',
      tag: 'Academic Data',
      link: 'manage.html',
      accent: '#0284c7',
      iconBg: '#f0f9ff',
      tagBg: '#f0f9ff',
      tagCol: '#0369a1',
      highlights: ['College Calendar', 'Exam Schedules', 'Batch Years'],
      btnText: 'Open Manager',
      state: manageState,
      allowed: (hasRight('managePage') || hasRight('all') || user.role === 'admin') && manageState !== 'hidden'
    },
    {
      id: 'control',
      title: 'Control Dashboard',
      desc: 'System health monitoring, user grid, audit logs, backup and maintenance controls.',
      icon: '🎛️',
      tag: 'Control & Logs',
      link: 'control.html',
      accent: '#4f46e5',
      iconBg: '#eef2ff',
      tagBg: '#eef2ff',
      tagCol: '#3730a3',
      highlights: ['System Health', 'Audit Activity Logs', 'Backup & Undo'],
      btnText: 'Open Control',
      state: 'enabled',
      allowed: hasRight('controlPage') || hasRight('all') || user.role === 'admin'
    },
    {
      id: 'bulk',
      title: 'Bulk Upload & Operations',
      desc: 'Mass import students, faculty, departments, classes, and subjects via formatted spreadsheets.',
      icon: '📦',
      tag: 'Bulk Operations',
      link: 'bulk.html',
      accent: '#7c3aed',
      iconBg: '#f5f3ff',
      tagBg: '#f5f3ff',
      tagCol: '#5b21b6',
      highlights: ['Spreadsheet Import', 'Mass Students', 'Data Verification'],
      btnText: 'Bulk Operations',
      state: bulkState,
      allowed: (hasRight('bulkPage') || hasRight('all') || user.role === 'admin') && bulkState !== 'hidden'
    },
    {
      id: 'settings',
      title: 'System Settings',
      desc: 'Institutional preferences, security policies, portal switches, and change history audit trail.',
      icon: '⚙️',
      tag: 'Configuration',
      link: 'settings.html',
      accent: '#e11d48',
      iconBg: '#fff1f2',
      tagBg: '#fff1f2',
      tagCol: '#9f1239',
      highlights: ['Pages & Portals', 'Security Rules', 'Change History'],
      btnText: 'Configure Settings',
      state: 'enabled',
      allowed: hasRight('settingsPage') || hasRight('settingsModule') || hasRight('controlPage') || hasRight('all') || user.role === 'admin'
    },
    {
      id: 'export',
      title: 'Export & Report Center',
      desc: 'Institutional attendance registers, defaulter analysis, faculty workloads, and batch PDF/Excel downloads.',
      icon: '📊',
      tag: 'Reports & Export',
      link: 'export.html',
      accent: '#0d9488',
      iconBg: '#f0fdfa',
      tagBg: '#f0fdfa',
      tagCol: '#0f766e',
      highlights: ['Class Registers', 'Defaulter Lists', 'PDF & Excel Packs'],
      btnText: 'Open Export Center',
      state: 'enabled',
      allowed: hasRight('reports') || hasRight('all') || user.role === 'admin' || user.role === 'teacher'
    },
    {
      id: 'admin',
      title: 'Full Admin Console',
      desc: 'Master administration for departments, faculty structure, student lifecycle, and system governance.',
      icon: '🛡️',
      tag: 'Master Admin',
      link: 'admin.html',
      accent: '#b91c1c',
      iconBg: '#fef2f2',
      tagBg: '#fef2f2',
      tagCol: '#991b1b',
      highlights: ['Full Department Control', 'Staff & Student CRUD', 'Full Authority'],
      btnText: 'Launch Admin Console',
      state: 'enabled',
      allowed: user.adminFlag !== 'principal' && user.adminFlag !== 'subadmin' && (hasRight('all') || (user.role === 'admin' && user.adminFlag !== 'subadmin'))
    }
  ];
}

function renderCards() {
  var grid = document.getElementById('portal-cards');
  if (!grid) return;

  var user = currentUser || getUser() || {};
  var allPortals = getPortalDefinitions(user);

  // Filter allowed portals
  var allowedPortals = allPortals.filter(function(card) {
    return card.allowed;
  });

  if (allowedPortals.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 48px 24px; background: #fff; border: 1px solid var(--br); border-radius: 16px; color: var(--tmu); font-size: 13.5px;">'
      + '<div style="font-size:32px;margin-bottom:10px;">🔒</div>'
      + '<div style="font-weight:700;color:var(--td);margin-bottom:4px;">No active workspaces assigned</div>'
      + '<div>Please contact your system administrator for access permissions.</div>'
      + '</div>';
    return;
  }

  grid.innerHTML = allowedPortals.map(function(card) {
    var isDisabled = card.state === 'disabled';

    var highlightsHtml = (card.highlights || []).map(function(h) {
      return '<span class="card-highlight-item">' + h + '</span>';
    }).join('');

    var tagHtml = isDisabled
      ? '<span class="disabled-badge">🔒 Disabled / Maintenance</span>'
      : '<span class="card-tag" style="background:' + card.tagBg + ';color:' + card.tagCol + ';">' + card.tag + '</span>';

    var cardClass = 'sel-card' + (isDisabled ? ' disabled-portal' : '');
    var cardHref = isDisabled ? 'javascript:void(0)' : card.link;
    var clickAttr = isDisabled ? 'onclick="showDisabledNotice(event, \'' + card.title + '\')"' : '';

    var btnHtml = isDisabled
      ? '<button class="card-btn" style="background:#94a3b8;cursor:not-allowed;box-shadow:none;">🔒 Locked</button>'
      : '<button class="card-btn" style="background:' + card.accent + ';">' + card.btnText + ' <span class="card-arrow">→</span></button>';

    return '' +
      '<a href="' + cardHref + '" class="' + cardClass + '" ' + clickAttr + ' style="--card-accent:' + (isDisabled ? '#d97706' : card.accent) + ';">' +
        '<div class="card-top">' +
          '<div class="card-icon" style="background:' + card.iconBg + ';">' + card.icon + '</div>' +
          tagHtml +
        '</div>' +
        '<div class="card-body">' +
          '<h2 class="card-title">' + card.title + '</h2>' +
          '<p class="card-desc">' + card.desc + '</p>' +
          '<div class="card-highlights">' + highlightsHtml + '</div>' +
        '</div>' +
        '<div class="card-footer">' +
          '<span class="card-tag" style="background:' + card.tagBg + ';color:' + card.tagCol + ';">' + card.tag + '</span>' +
          btnHtml +
        '</div>' +
      '</a>';
  }).join('');
}

function showDisabledNotice(event, portalTitle) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  showToast('🔒 ' + portalTitle + ' is currently disabled by administrator for maintenance.');
}

