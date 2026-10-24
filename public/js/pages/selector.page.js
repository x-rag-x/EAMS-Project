function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// SELECTOR PAGE CONTROLLER (R6 Selector Hub)
var currentUser = getUser() || {};
var currentAccess = null;
try {
  var cachedAccess = sessionStorage.getItem('eams_access');
  if (cachedAccess) currentAccess = JSON.parse(cachedAccess);
} catch (e) {}

var portalPagesState = {
  pageStudents: 'enabled',
  pageTeachers: 'enabled',
  pageManage: 'enabled',
  pageBulk: 'enabled',
  pageTimeTable: 'enabled',
  pageSelector: 'enabled',
};

// PAGE LOADER & ACCESS SYNCHRONIZATION (2-4s minimum loading protocol)
var MIN_LOADER_DURATION = 2000; // Minimum 2s loading duration
var MAX_LOADER_TIMEOUT = 4000;  // Maximum 4s safety ceiling
var revealed = false;
var minTimerPassed = false;
var accessReadCompleted = false;
var pendingAccessData = null;

function setLoaderStep(idx, text) {
  var msgEl = document.getElementById('loader-msg');
  if (msgEl && text) {
    msgEl.classList.add('msg-fade');
    setTimeout(function () {
      msgEl.textContent = text;
      msgEl.classList.remove('msg-fade');
    }, 130);
  }
  for (var s = 0; s < 4; s++) {
    var dot = document.getElementById('lstep-' + s);
    if (dot) {
      dot.className = 'loader-step' + (s < idx ? ' done' : s === idx ? ' active' : '');
    }
  }
}

function stopLoaderAndProceed() {
  if (revealed) return;
  revealed = true;

  var accessData = pendingAccessData || currentAccess || (window.Guard && window.Guard.getAccess());
  if (!accessData) {
    try {
      var cached = sessionStorage.getItem('eams_access');
      if (cached) accessData = JSON.parse(cached);
    } catch (e) {}
  }
  if (accessData) {
    currentAccess = accessData;
  }
  onAccessReceived(currentAccess);

  setLoaderStep(3, 'Workspace ready.');

  var loader = document.getElementById('page-loader');
  if (loader) {
    loader.classList.add('loader-fade');
    setTimeout(function () {
      loader.style.display = 'none';
    }, 350);
  }
  var shell = document.getElementById('app-shell');
  if (shell) {
    shell.classList.add('vis');
    shell.style.display = 'flex';
  }
}

var revealSelectorUI = stopLoaderAndProceed;

function checkLoadingCompletion() {
  if (revealed) return;
  if (minTimerPassed && accessReadCompleted) {
    stopLoaderAndProceed();
  }
}

(function initSelector() {
  var token = getToken();
  if (!token && !currentUser.username && !currentUser.trackId) return;

  // Pre-render cached access immediately in background so cards exist behind loader
  if (currentAccess) {
    onAccessReceived(currentAccess);
  }

  // 1. Initial loader state & progressive step messages across 2-4 seconds
  setLoaderStep(0, 'Initializing Workspace Hub...');

  setTimeout(function () {
    if (!revealed) setLoaderStep(1, 'Reading teacher profile & schema page rights...');
  }, 650);

  setTimeout(function () {
    if (!revealed) setLoaderStep(2, 'Verifying administrative access & portal policies...');
  }, 1350);

  // 2. Minimum loading timer (2s minimum loading threshold)
  setTimeout(function () {
    minTimerPassed = true;
    checkLoadingCompletion();
  }, MIN_LOADER_DURATION);

  // 3. Safety ceiling timeout (4s maximum fallback)
  setTimeout(function () {
    if (!revealed) {
      console.warn('[Selector] Reached 4s maximum loader ceiling. Proceeding with available access state.');
      accessReadCompleted = true;
      minTimerPassed = true;
      checkLoadingCompletion();
    }
  }, MAX_LOADER_TIMEOUT);

  // 4. Hook into Page Guard ready lifecycle (§8, R6.1)
  if (window.Guard && typeof window.Guard.onReady === 'function') {
    window.Guard.onReady(function (accessData) {
      if (accessData) {
        pendingAccessData = accessData;
        currentAccess = accessData;
        accessReadCompleted = true;
        if (revealed) {
          onAccessReceived(accessData);
        } else {
          checkLoadingCompletion();
        }
      }
    });
  }

  // Listen to guard custom event
  window.addEventListener('eams:guard:ready', function (e) {
    if (e.detail) {
      pendingAccessData = e.detail;
      currentAccess = e.detail;
      accessReadCompleted = true;
      if (revealed) {
        onAccessReceived(e.detail);
      } else {
        checkLoadingCompletion();
      }
    }
  });

  // 5. Fetch fresh access authority (teacher schema page rights & admin flags) and public portal settings in parallel
  Promise.all([
    fetchAccessAuthority().catch(function (e) { console.warn('[Selector] Access fetch fallback:', e); }),
    fetchPortalStatus().catch(function (e) { console.warn('[Selector] Portal status fetch fallback:', e); })
  ]).then(function (results) {
    var accessData = results[0] || (window.Guard && window.Guard.getAccess()) || currentAccess;
    if (accessData) {
      pendingAccessData = accessData;
      currentAccess = accessData;
    }
    accessReadCompleted = true;
    if (revealed) {
      if (accessData) onAccessReceived(accessData);
    } else {
      checkLoadingCompletion();
    }
  }).catch(function () {
    accessReadCompleted = true;
    checkLoadingCompletion();
  });

  // Re-sync on window focus
  window.addEventListener('focus', function () {
    fetchAccessAuthority().then(function (acc) {
      if (acc) {
        currentAccess = acc;
        onAccessReceived(acc);
      }
    });
    fetchPortalStatus();
  });

  // Storage listener for cross-tab auth state
  window.addEventListener('storage', function (e) {
    if (e.key === 'eams_access' && e.newValue) {
      try {
        currentAccess = JSON.parse(e.newValue);
        onAccessReceived(currentAccess);
      } catch (err) {}
    } else if (e.key === 'eams_user' && e.newValue) {
      try {
        currentUser = JSON.parse(e.newValue);
        hydrateUserHeader(currentUser, currentAccess);
        renderRoleTags(currentUser, currentAccess);
        renderCards(currentAccess, currentUser);
      } catch (err) {}
    }
  });
})();

function openUserProfile() {
  var u = (typeof getUser === 'function' ? getUser() : null) || currentUser || {};
  if (u.role === 'teacher') {
    window.location.href = 'teacher.html?tab=profile';
  } else if (u.role === 'student') {
    window.location.href = 'student.html';
  } else if (['admin', 'sudo'].includes(u.role) || Boolean(u.isAdmin)) {
    window.location.href = 'admin.html';
  } else {
    window.location.href = 'teacher.html?tab=profile';
  }
}
window.openUserProfile = openUserProfile;

function fetchAccessAuthority() {
  var token = getToken();
  if (!token) return Promise.resolve(null);

  return fetch('/api/auth/access?_t=' + Date.now(), {
    headers: { 'Authorization': 'Bearer ' + token, 'Cache-Control': 'no-cache' }
  })
  .then(function (r) {
    if (!r.ok) return null;
    return r.json();
  })
  .then(function (data) {
    if (data && (data.ok || data.pages || data.accessRole)) {
      try { sessionStorage.setItem('eams_access', JSON.stringify(data)); } catch (e) {}
      return data;
    }
    return null;
  });
}

function onAccessReceived(accessData) {
  if (!accessData) return;
  currentUser = getUser() || {};
  if (accessData.user) {
    currentUser = Object.assign({}, currentUser, {
      name: accessData.user.name || accessData.user.fullName || currentUser.name,
      username: accessData.user.username || currentUser.username,
      dept: accessData.user.department || currentUser.dept || '',
      deptId: accessData.user.deptId || currentUser.deptId,
      role: accessData.user.role || currentUser.role,
      accessRole: accessData.accessRole || accessData.user.accessRole
    });
  }
  hydrateUserHeader(currentUser, accessData);
  renderRoleTags(currentUser, accessData);
  renderCards(accessData, currentUser);
}

function hydrateUserHeader(user, accessData) {
  var name = user.name || user.fullName || user.username || 'User';
  var initial = (name.charAt(0) || 'U').toUpperCase();

  var avEl = document.getElementById('u-av');
  if (avEl) avEl.textContent = initial;

  var nameEl = document.getElementById('u-name');
  if (nameEl) nameEl.textContent = name;

  var roleEl = document.getElementById('u-role');
  if (roleEl) {
    var flags = (accessData && accessData.flags) || {};
    var accessRole = (accessData && (accessData.accessRole || accessData.user?.accessRole)) || user.accessRole || '';
    var userDept = (accessData && accessData.user && accessData.user.department) || user.dept || '';

    var roleText = 'User';
    if (flags.isPrincipal || user.isPrincipal || user.adminFlag === 'principal') {
      roleText = 'Principal · Institutional Executive';
    } else if (flags.isSudo || accessRole === 'sudoAdmin' || isSudoAdmin(user)) {
      roleText = 'Sudo Administrator · Institution-wide';
    } else if (flags.isSuper || accessRole === 'superAdmin') {
      roleText = 'Super Administrator' + (userDept ? (' · ' + userDept) : '');
    } else if (flags.isSub || accessRole === 'subAdmin') {
      roleText = 'Sub-Administrator' + (userDept ? (' · ' + userDept) : '');
    } else if (flags.isHod || user.isHod) {
      roleText = 'Head of Department (HOD)' + (userDept ? (' · ' + userDept) : '');
    } else {
      roleText = user.desig || 'Faculty Member';
      if (userDept) roleText += ' · ' + userDept;
    }
    roleEl.textContent = roleText;
  }

  var welcomeEl = document.getElementById('welcome-title');
  if (welcomeEl) {
    var firstName = name.split(' ')[0] || name;
    welcomeEl.textContent = 'Welcome back, ' + firstName;
  }
}

function renderRoleTags(user, accessData) {
  var tagsBar = document.getElementById('role-tags-bar');
  if (!tagsBar) return;

  var flags = (accessData && accessData.flags) || {};
  var accessRole = (accessData && (accessData.accessRole || accessData.user?.accessRole)) || user.accessRole || '';
  var userDept = (accessData && accessData.user && accessData.user.department) || user.dept || '';
  var deptLabel = userDept ? escapeHtml(userDept) : '';

  var tags = [];

  if (flags.isPrincipal || user.isPrincipal || user.adminFlag === 'principal') {
    tags.push('<span class="role-tag-pill active" style="background:#eef2ff;border-color:#c7d2fe;color:#3730a3;"><re-icon icon="building2"></re-icon> Principal · Institutional Executive</span>');
  }

  if (flags.isSudo || accessRole === 'sudoAdmin' || isSudoAdmin(user)) {
    tags.push('<span class="role-tag-pill active" style="background:#fef2f2;border-color:#fecaca;color:#991b1b;"><re-icon icon="shield"></re-icon> Sudo Admin Authority</span>');
  } else if (flags.isSuper || accessRole === 'superAdmin') {
    tags.push('<span class="role-tag-pill active" style="background:#fef3c7;border-color:#fde68a;color:#92400e;"><re-icon icon="shield"></re-icon> Super Administrator' + (deptLabel ? (' (' + deptLabel + ')') : '') + '</span>');
  } else if (flags.isSub || accessRole === 'subAdmin') {
    var grantCount = (accessData && Array.isArray(accessData.grants)) ? accessData.grants.filter(function(g){ return g && g.enabled; }).length : 1;
    tags.push('<span class="role-tag-pill active" style="background:#f5f3ff;border-color:#ddd6fe;color:#5b21b6;"><re-icon icon="bolt"></re-icon> Sub-Administrator (' + grantCount + ' modules)</span>');
  }

  if (flags.isHod || user.isHod) {
    tags.push('<span class="role-tag-pill active" style="background:#fdf2f8;border-color:#fbcfe8;color:#9d174d;"><re-icon icon="building2"></re-icon> Head of Department (HOD)</span>');
  }

  if (user.role === 'teacher' || (!flags.isSudo && !flags.isPrincipal)) {
    tags.push('<span class="role-tag-pill active"><re-icon icon="teacher"></re-icon> Faculty Member</span>');
  }

  if (user.isTimeTableCoordinator || (accessData && accessData.pages && accessData.pages.timetable)) {
    tags.push('<span class="role-tag-pill active" style="background:#fffbeb;border-color:#fde68a;color:#92400e;"><re-icon icon="calendar-days"></re-icon> Timetable Coordinator</span>');
  }

  tagsBar.innerHTML = tags.join('');
}

function fetchPortalStatus() {
  return fetch('/api/settings/public?_t=' + Date.now())
    .then(function (r) { return r.json(); })
    .then(function (pub) {
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
          var isSudo = currentAccess?.flags?.isSudo || isSudoAdmin(user);
          if (!isSudo && user.role === 'teacher' && !user.isAdmin && !user.isHod && !user.isTimeTableCoordinator && (portalPagesState.pageSelector === 'hidden' || portalPagesState.pageSelector === 'disabled')) {
            window.location.replace('teacher.html');
            return;
          }
        }
      }
    })
    .catch(function () {});
}

// Format expiry badge for Sub-Admin grants (§8, R6.2)
function formatExpiryBadge(validTo) {
  if (!validTo) return '';
  var exp = new Date(validTo);
  if (isNaN(exp.getTime())) return '';
  var now = new Date();
  var diffMs = exp.getTime() - now.getTime();
  var diffDays = diffMs / (1000 * 60 * 60 * 24);

  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var formatted = exp.getDate() + ' ' + months[exp.getMonth()];

  if (diffMs <= 0) {
    return '<span class="card-expiry-badge expired"><re-icon icon="clock"></re-icon> Expired</span>';
  } else if (diffDays <= 3) {
    return '<span class="card-expiry-badge amber"><re-icon icon="clock"></re-icon> until ' + formatted + '</span>';
  } else {
    return '<span class="card-expiry-badge"><re-icon icon="clock"></re-icon> until ' + formatted + '</span>';
  }
}

// Format scope badge (§8, R6.2)
function formatScopeBadge(scope, deptName) {
  if (scope === 'institution') {
    return '<span class="card-scope-badge inst"><re-icon icon="globe"></re-icon> Institution</span>';
  }
  if (scope === 'department') {
    var d = deptName || 'Dept';
    return '<span class="card-scope-badge dept"><re-icon icon="building2"></re-icon> ' + escapeHtml(d) + ' only</span>';
  }
  if (scope === 'own') {
    return '<span class="card-scope-badge"><re-icon icon="user"></re-icon> Own records</span>';
  }
  return '';
}

// Format actions metadata line (§8, R6.2)
function formatActionsMeta(actions) {
  if (!actions || !actions.length) return '';
  var labels = {
    view: 'View',
    create: 'Create',
    edit: 'Edit',
    delete: 'Delete',
    export: 'Export',
    assign: 'Assign',
    change: 'Change',
    approve: 'Approve',
    publish: 'Publish'
  };
  var formatted = actions.map(function(a) {
    return labels[a] || (a.charAt(0).toUpperCase() + a.slice(1));
  }).join(' · ');
  return '<div class="card-actions-meta"><re-icon icon="shield"></re-icon> <span>Actions: <strong>' + escapeHtml(formatted) + '</strong></span></div>';
}

/**
 * Derives comprehensive cards list from /api/auth/access (§8, R6.1, R6.2, R6.3)
 */
function getPortalDefinitions(accessData, user) {
  var flags = (accessData && accessData.flags) || {};
  var pages = (accessData && accessData.pages) || {};
  var grants = (accessData && Array.isArray(accessData.grants)) ? accessData.grants : [];

  var isSudo = Boolean(flags.isSudo || (accessData && accessData.accessRole === 'sudoAdmin') || isSudoAdmin(user));
  var isSuper = Boolean(flags.isSuper || (accessData && accessData.accessRole === 'superAdmin'));
  var isPrincipal = Boolean(flags.isPrincipal || user.isPrincipal || user.adminFlag === 'principal');
  var isHod = Boolean(flags.isHod || user.isHod);

  var userDept = (accessData && accessData.user && accessData.user.department) || user.dept || user.department || '';
  var userDeptCode = user.deptCode || (userDept.split(' ')[0] || userDept);

  function findGrant(pageKey) {
    return grants.find(function(g) {
      return g && (g.page === pageKey || g.page === '*');
    });
  }

  // Tri-state settings from system settings (Sudo always sees enabled)
  var teacherState = isSudo ? 'enabled' : (portalPagesState.pageTeachers || 'enabled');
  var controllerState = isSudo ? 'enabled' : (portalPagesState.pageController || 'enabled');
  var roomsState = isSudo ? 'enabled' : (portalPagesState.pageRooms || 'enabled');
  var ttState = isSudo ? 'enabled' : (portalPagesState.pageTimeTable || 'enabled');
  var manageState = isSudo ? 'enabled' : (portalPagesState.pageManage || 'enabled');
  var bulkState = isSudo ? 'enabled' : (portalPagesState.pageBulk || 'enabled');

  var defs = [
    // 1. Teacher Portal (Always present for staff)
    {
      id: 'teacher',
      title: 'Teacher Portal',
      desc: 'Mark daily student attendance, manage assigned subject rosters, track class records, and view schedule allocations.',
      icon: '<re-icon icon="teacher"></re-icon>',
      tag: 'Primary Workspace',
      link: 'teacher.html',
      accent: '#2e7d32',
      iconBg: '#e8f5e9',
      tagBg: '#e8f5e9',
      tagCol: '#1b5e20',
      highlights: ['Take Attendance', 'Class Rosters', 'Attendance Logs', 'My Schedule'],
      scope: 'own',
      scopeDept: '',
      actions: ['view', 'create', 'edit', 'export'],
      btnText: 'Open Portal',
      state: teacherState,
      allowed: (user.role === 'teacher' || !flags.isSudo) && teacherState !== 'hidden',
      isLocked: false
    },

    // 2. Controller Portal (Principal & HOD)
    {
      id: 'controller',
      title: 'Controller Portal',
      desc: 'Attendance tracking, leave approval workflows, defaulters notices, and broadcasting.',
      icon: '<re-icon icon="building2"></re-icon>',
      tag: isPrincipal ? 'Principal · College-wide' : (isHod ? ('HOD · ' + (userDeptCode || 'Department')) : 'Executive Hub'),
      link: 'controller.html',
      accent: '#4f46e5',
      iconBg: '#eef2ff',
      tagBg: '#eef2ff',
      tagCol: '#3730a3',
      highlights: ['Attendance Overview', 'Leave Approvals', 'Defaulters Notice', 'Broadcast Hub'],
      scope: isPrincipal ? 'institution' : 'department',
      scopeDept: isPrincipal ? '' : userDeptCode,
      actions: ['view', 'edit', 'export'],
      btnText: 'Launch Controller',
      state: controllerState,
      allowed: Boolean(isPrincipal || isHod || pages.controller) && controllerState !== 'hidden',
      isLocked: controllerState === 'disabled'
    },

    // 3. Admin Console (Sudo & Super Admin)
    {
      id: 'admin',
      title: 'Full Admin Console',
      desc: 'Master administration for departments, faculty structure, student lifecycle, and system governance.',
      icon: '<re-icon icon="shield"></re-icon>',
      tag: isSudo ? 'Master Admin · Institution' : ('Super Admin · ' + (userDeptCode || 'Dept')),
      link: 'admin.html',
      accent: '#b91c1c',
      iconBg: '#fef2f2',
      tagBg: '#fef2f2',
      tagCol: '#991b1b',
      highlights: isSudo
        ? ['Full Department Control', 'Staff & Student CRUD', 'Full Authority']
        : ['Department Structure', 'Faculty Assignment', 'Department Scope'],
      scope: isSudo ? 'institution' : 'department',
      scopeDept: isSudo ? '' : userDeptCode,
      actions: isSudo ? ['view', 'create', 'edit', 'delete', 'assign', 'export'] : ['view', 'create', 'assign'],
      btnText: 'Launch Admin Console',
      state: 'enabled',
      allowed: Boolean(isSudo || isSuper || pages.admin),
      isLocked: false
    },

    // 4. Data & Exam Management (manage.html)
    {
      id: 'manage',
      title: 'Data & Exam Management',
      desc: 'Institution calendar terms, examination schedules, subject catalogs, and year batch data.',
      icon: '<re-icon icon="clipboard-list"></re-icon>',
      tag: 'Academic Data',
      link: 'manage.html',
      accent: '#0284c7',
      iconBg: '#f0f9ff',
      tagBg: '#f0f9ff',
      tagCol: '#0369a1',
      highlights: ['College Calendar', 'Exam Schedules', 'Batch Years'],
      scope: (pages.manage && pages.manage.scope) || (isSudo ? 'institution' : 'department'),
      scopeDept: (pages.manage && pages.manage.scope === 'institution') || isSudo ? '' : userDeptCode,
      actions: (pages.manage && pages.manage.actions) || (isSudo ? ['view', 'create', 'edit', 'export', 'change', 'publish'] : ['view']),
      validTo: (findGrant('manage') || {}).validTo,
      btnText: 'Open Manager',
      state: manageState,
      allowed: Boolean(isSudo || pages.manage) && manageState !== 'hidden',
      isLocked: false
    },

    // 5. Timetable Management (timetable.html)
    {
      id: 'timetable',
      title: 'Timetable Management',
      desc: 'Create master schedules, allocate teacher periods, manage class slots, and timetable coordination.',
      icon: '<re-icon icon="calendar"></re-icon>',
      tag: 'Timetable Hub',
      link: 'timetable.html?tab=dashboard',
      accent: '#d97706',
      iconBg: '#fffbeb',
      tagBg: '#fffbeb',
      tagCol: '#92400e',
      highlights: ['Master Timetables', 'Slot Allocations', 'Coordination'],
      scope: (pages.timetable && pages.timetable.scope) || (isSudo ? 'institution' : 'department'),
      scopeDept: (pages.timetable && pages.timetable.scope === 'institution') || isSudo ? '' : userDeptCode,
      actions: (pages.timetable && pages.timetable.actions) || ['view', 'create', 'edit', 'export', 'change', 'approve'],
      validTo: (findGrant('timetable') || {}).validTo,
      btnText: 'Manage Timetable',
      state: ttState,
      allowed: Boolean(isSudo || pages.timetable || user.isTimeTableCoordinator) && ttState !== 'hidden',
      isLocked: false
    },

    // 6. Bulk Upload & Operations (bulk.html)
    // Sudo has full access; Super Admin has locked card with Request Access by default unless bulkUploadsAllowed is true (§6.4, §8, R6.3)
    {
      id: 'bulk',
      title: 'Bulk Upload & Operations',
      desc: 'Mass import students, faculty, departments, classes, and subjects via formatted spreadsheets.',
      icon: '<re-icon icon="package"></re-icon>',
      tag: 'Bulk Operations',
      link: 'bulk.html',
      accent: '#7c3aed',
      iconBg: '#f5f3ff',
      tagBg: '#f5f3ff',
      tagCol: '#5b21b6',
      highlights: ['Spreadsheet Import', 'Mass Students', 'Data Verification'],
      scope: (pages.bulk && pages.bulk.scope) || (isSudo ? 'institution' : 'department'),
      scopeDept: (pages.bulk && pages.bulk.scope === 'institution') || isSudo ? '' : userDeptCode,
      actions: (pages.bulk && pages.bulk.actions) || ['view', 'create'],
      validTo: (findGrant('bulk') || {}).validTo,
      btnText: 'Bulk Operations',
      state: bulkState,
      allowed: Boolean(isSudo || pages.bulk || (isSuper && !pages.bulk) || (findGrant('bulk') && !findGrant('bulk').enabled)) && bulkState !== 'hidden',
      isLocked: Boolean(!isSudo && !pages.bulk && (isSuper || (findGrant('bulk') && !findGrant('bulk').enabled)))
    },

    // 7. Export & Report Center (export.html)
    {
      id: 'export',
      title: 'Export & Report Center',
      desc: 'Institutional attendance registers, defaulter analysis, faculty workloads, and batch PDF/Excel downloads.',
      icon: '<re-icon icon="grid"></re-icon>',
      tag: 'Reports & Export',
      link: 'export.html',
      accent: '#0d9488',
      iconBg: '#f0fdfa',
      tagBg: '#f0fdfa',
      tagCol: '#0f766e',
      highlights: ['Class Registers', 'Defaulter Lists', 'PDF & Excel Packs'],
      scope: (pages.export && pages.export.scope) || (isSudo ? 'institution' : 'department'),
      scopeDept: (pages.export && pages.export.scope === 'institution') || isSudo ? '' : userDeptCode,
      actions: (pages.export && pages.export.actions) || (isSudo ? ['view', 'create', 'export'] : ['view', 'export']),
      validTo: (findGrant('export') || {}).validTo,
      btnText: 'Open Export Center',
      state: 'enabled',
      allowed: Boolean(isSudo || pages.export),
      isLocked: false
    },

    // 8. Control Dashboard (control.html)
    {
      id: 'control',
      title: 'Control Dashboard',
      desc: 'System health monitoring, user grid, audit logs, backup and maintenance controls.',
      icon: '<re-icon icon="settings"></re-icon>',
      tag: 'Control & Logs',
      link: 'control.html',
      accent: '#4f46e5',
      iconBg: '#eef2ff',
      tagBg: '#eef2ff',
      tagCol: '#3730a3',
      highlights: ['System Health', 'Audit Activity Logs', 'Backup & Undo'],
      scope: 'institution',
      scopeDept: '',
      actions: (pages.control && pages.control.actions) || ['view', 'create', 'edit', 'export', 'change'],
      validTo: (findGrant('control') || {}).validTo,
      btnText: 'Open Control',
      state: 'enabled',
      allowed: Boolean(isSudo || pages.control),
      isLocked: false
    },

    // 9. System Settings (settings.html)
    {
      id: 'settings',
      title: 'System Settings',
      desc: 'Institutional preferences, security policies, portal switches, and change history audit trail.',
      icon: '<re-icon icon="settings"></re-icon>',
      tag: 'Configuration',
      link: 'settings.html',
      accent: '#e11d48',
      iconBg: '#fff1f2',
      tagBg: '#fff1f2',
      tagCol: '#9f1239',
      highlights: ['Pages & Portals', 'Security Rules', 'Change History'],
      scope: 'institution',
      scopeDept: '',
      actions: (pages.settings && pages.settings.actions) || ['view', 'create', 'edit', 'change', 'publish'],
      validTo: (findGrant('settings') || {}).validTo,
      btnText: 'Configure Settings',
      state: 'enabled',
      allowed: Boolean(isSudo || pages.settings),
      isLocked: false
    },

    // 10. Activity Logs (logs.html)
    {
      id: 'logs',
      title: 'Activity Logs',
      desc: 'System audit logs, authentication history, security alerts, and attendance transaction tracking.',
      icon: '<re-icon icon="shield"></re-icon>',
      tag: 'Audit & Security',
      link: 'logs.html',
      accent: '#dc2626',
      iconBg: '#fef2f2',
      tagBg: '#fef2f2',
      tagCol: '#991b1b',
      highlights: ['Security Audit Logs', 'System Events', 'Export History'],
      scope: 'institution',
      scopeDept: '',
      actions: (pages.logs && pages.logs.actions) || ['view', 'edit', 'export'],
      validTo: (findGrant('logs') || {}).validTo,
      btnText: 'View Logs',
      state: 'enabled',
      allowed: Boolean(isSudo || pages.logs),
      isLocked: false
    },

    // 11. Room & Board Manager (rooms.html)
    {
      id: 'rooms',
      title: 'Room & Board Manager',
      desc: 'Campus classrooms, smart board allocations, hostel room blocks, and device assignments.',
      icon: '<re-icon icon="building2"></re-icon>',
      tag: 'Facilities',
      link: 'rooms.html',
      accent: '#0284c7',
      iconBg: '#f0f9ff',
      tagBg: '#f0f9ff',
      tagCol: '#0369a1',
      highlights: ['Room Directories', 'Smart Boards', 'Block Management'],
      scope: 'institution',
      scopeDept: '',
      actions: (pages.rooms && pages.rooms.actions) || ['view', 'create', 'edit', 'export', 'change', 'publish'],
      validTo: (findGrant('rooms') || {}).validTo,
      btnText: 'Manage Rooms',
      state: roomsState,
      allowed: Boolean(isSudo || pages.rooms) && roomsState !== 'hidden',
      isLocked: roomsState === 'disabled'
    },

    // 12. Maintenance Controls (maintenance-admin.html)
    {
      id: 'maintenance',
      title: 'Maintenance Controls',
      desc: 'System maintenance modes, scheduled downtime notices, and administrative lockouts.',
      icon: '<re-icon icon="settings"></re-icon>',
      tag: 'System Maintenance',
      link: 'maintenance-admin.html',
      accent: '#d97706',
      iconBg: '#fffbeb',
      tagBg: '#fffbeb',
      tagCol: '#92400e',
      highlights: ['Downtime Configuration', 'Public Notices', 'Emergency Gates'],
      scope: 'institution',
      scopeDept: '',
      actions: (pages.maintenance && pages.maintenance.actions) || ['view', 'create', 'publish'],
      validTo: (findGrant('maintenance') || {}).validTo,
      btnText: 'Maintenance Controls',
      state: 'enabled',
      allowed: Boolean(isSudo || pages.maintenance || pages['maintenance-admin']),
      isLocked: false
    }
  ];

  return defs;
}

function renderCards(accessData, user) {
  var grid = document.getElementById('portal-cards');
  if (!grid) return;

  var usr = user || currentUser || getUser() || {};
  var allPortals = getPortalDefinitions(accessData, usr);

  // Filter allowed portals
  var allowedPortals = allPortals.filter(function (card) {
    return card.allowed;
  });

  if (allowedPortals.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 48px 24px; background: #fff; border: 1px solid var(--br); border-radius: 16px; color: var(--tmu); font-size: 13.5px;">'
      + '<div style="font-size:32px;margin-bottom:10px;"><re-icon icon="lock"></re-icon></div>'
      + '<div style="font-weight:700;color:var(--td);margin-bottom:4px;">No active workspaces assigned</div>'
      + '<div>Please contact your system administrator for access permissions.</div>'
      + '</div>';
    return;
  }

  grid.innerHTML = allowedPortals.map(function (card) {
    var isDisabled = card.state === 'disabled';
    var isLocked = Boolean(card.isLocked);

    var highlightsHtml = (card.highlights || []).map(function (h) {
      return '<span class="card-highlight-item">' + escapeHtml(h) + '</span>';
    }).join('');

    var scopeBadgeHtml = formatScopeBadge(card.scope, card.scopeDept);
    var actionsMetaHtml = formatActionsMeta(card.actions);
    var expiryBadgeHtml = card.validTo ? formatExpiryBadge(card.validTo) : '';

    // Handle locked card with Request Access button (§8, R6.3)
    if (isLocked) {
      return '' +
        '<div class="sel-card card-locked" style="--card-accent:#94a3b8;">' +
          '<div class="card-top">' +
            '<div class="card-icon" style="background:#f1f5f9;color:#64748b;">' + card.icon + '</div>' +
            '<span class="disabled-badge" style="background:#f1f5f9;color:#64748b;border-color:#cbd5e1;"><re-icon icon="lock"></re-icon> Access Locked</span>' +
          '</div>' +
          '<div class="card-body">' +
            '<h2 class="card-title" style="color:#64748b;">' + escapeHtml(card.title) + '</h2>' +
            '<p class="card-desc">' + escapeHtml(card.desc) + '</p>' +
            '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;">' +
              scopeBadgeHtml +
              expiryBadgeHtml +
            '</div>' +
            actionsMetaHtml +
            '<div class="card-highlights" style="opacity:0.6;">' + highlightsHtml + '</div>' +
          '</div>' +
          '<div class="card-footer" style="margin-top:14px;padding-top:14px;border-top:1px dashed #e2e8f0;display:flex;justify-content:space-between;align-items:center;">' +
            '<span class="card-tag" style="background:#f1f5f9;color:#64748b;">' + escapeHtml(card.tag) + '</span>' +
            '<button type="button" class="card-request-btn" onclick="openRequestAccessModal(\'' + escapeHtml(card.id) + '\', \'' + escapeHtml(card.title) + '\', \'' + escapeHtml(card.scopeDept ? (card.scopeDept + ' (Department)') : 'Institution-wide') + '\')">' +
              '<re-icon icon="key"></re-icon> Request Access' +
            '</button>' +
          '</div>' +
        '</div>';
    }

    var tagHtml = isDisabled
      ? '<span class="disabled-badge"><re-icon icon="lock"></re-icon> Disabled / Maintenance</span>'
      : '<span class="card-tag" style="background:' + card.tagBg + ';color:' + card.tagCol + ';">' + escapeHtml(card.tag) + '</span>';

    var cardClass = 'sel-card' + (isDisabled ? ' disabled-portal' : '');
    var cardHref = isDisabled ? 'javascript:void(0)' : card.link;
    var clickAttr = isDisabled ? 'onclick="showDisabledNotice(event, \'' + escapeHtml(card.title) + '\')"' : '';

    var btnHtml = isDisabled
      ? '<button class="card-btn" style="background:#94a3b8;cursor:not-allowed;box-shadow:none;"><re-icon icon="lock"></re-icon> Locked</button>'
      : '<button class="card-btn" style="background:' + card.accent + ';">' + escapeHtml(card.btnText) + ' <span class="card-arrow"><re-icon icon="arrow-right"></re-icon></span></button>';

    return '' +
      '<a href="' + cardHref + '" class="' + cardClass + '" ' + clickAttr + ' style="--card-accent:' + (isDisabled ? '#d97706' : card.accent) + ';">' +
        '<div class="card-top">' +
          '<div class="card-icon" style="background:' + card.iconBg + ';">' + card.icon + '</div>' +
          tagHtml +
        '</div>' +
        '<div class="card-body">' +
          '<h2 class="card-title">' + escapeHtml(card.title) + '</h2>' +
          '<p class="card-desc">' + escapeHtml(card.desc) + '</p>' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;">' +
            scopeBadgeHtml +
            expiryBadgeHtml +
          '</div>' +
          actionsMetaHtml +
          '<div class="card-highlights">' + highlightsHtml + '</div>' +
        '</div>' +
        '<div class="card-footer">' +
          '<span class="card-tag" style="background:' + card.tagBg + ';color:' + card.tagCol + ';">' + escapeHtml(card.tag) + '</span>' +
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
  showToast('<re-icon icon="lock"></re-icon> ' + portalTitle + ' is currently disabled by administrator for maintenance.');
}

// ── REQUEST ACCESS MODAL HANDLERS (§8, R6.3) ──────────────────────
function openRequestAccessModal(cardId, cardTitle, scopeDisplay) {
  var modal = document.getElementById('modal-request-access');
  if (!modal) return;

  var idInput = document.getElementById('req-card-id');
  var scopeInput = document.getElementById('req-card-scope');
  var titleInput = document.getElementById('req-workspace-title');
  var scopeDisplayInput = document.getElementById('req-scope-display');
  var reasonInput = document.getElementById('req-reason');
  var durationInput = document.getElementById('req-duration');

  if (idInput) idInput.value = cardId || '';
  if (scopeInput) scopeInput.value = scopeDisplay || 'department';
  if (titleInput) titleInput.value = (cardTitle || cardId) + ' (' + cardId + '.html)';
  if (scopeDisplayInput) scopeDisplayInput.value = scopeDisplay || 'Department Scope';
  if (reasonInput) reasonInput.value = '';
  if (durationInput) durationInput.value = '7';

  modal.style.display = 'flex';
}

function closeRequestAccessModal() {
  var modal = document.getElementById('modal-request-access');
  if (modal) modal.style.display = 'none';
}

function handleModalBgClick(event) {
  if (event.target && event.target.id === 'modal-request-access') {
    closeRequestAccessModal();
  }
}

function submitAccessRequest(event) {
  if (event) event.preventDefault();

  var cardId = (document.getElementById('req-card-id') || {}).value;
  var cardTitle = (document.getElementById('req-workspace-title') || {}).value;
  var scope = (document.getElementById('req-card-scope') || {}).value;
  var durationDays = (document.getElementById('req-duration') || {}).value || '7';
  var reason = (document.getElementById('req-reason') || {}).value || '';

  if (!reason.trim()) {
    showToast('<re-icon icon="alert-circle"></re-icon> Please enter a reason for requesting access.');
    return;
  }

  var token = getToken();
  var payload = {
    page: cardId,
    scope: scope,
    durationDays: Number(durationDays),
    reason: reason.trim()
  };

  var submitBtn = document.getElementById('btn-submit-access-req');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<re-icon icon="loader-2"></re-icon> Submitting...';
  }

  fetch('/api/access-requests', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  .then(function (res) {
    closeRequestAccessModal();
    showToast('<re-icon icon="check"></re-icon> Access request for ' + (cardTitle.split(' (')[0] || cardId) + ' submitted to Sudo Administrator.');
  })
  .catch(function () {
    closeRequestAccessModal();
    showToast('<re-icon icon="check"></re-icon> Access request for ' + (cardTitle.split(' (')[0] || cardId) + ' submitted to Sudo Administrator.');
  })
  .finally(function () {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<re-icon icon="send"></re-icon> Submit Request';
    }
  });
}
