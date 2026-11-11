function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── DEPARTMENT ICON HELPER ──────────────────────────────────────────────────
// Maps a department icon value to a <re-icon> element string.
// Accepts: icon key strings (e.g. 'laptop'), legacy emoji characters,
// or empty/null — all resolve to a <re-icon> element.
var _DEPT_EMOJI_TO_KEY = {
  '🏛️': 'building2', '🏛': 'building2',
  '💻': 'laptop',
  '📡': 'radio',
  '⚙️': 'settings', '⚙': 'settings',
  '⚡': 'bolt',
  '🏗️': 'tower', '🏗': 'tower',
  '🖥️': 'monitor', '🖥': 'monitor',
  '🤖': 'microchip',
  '🎨': 'palette',
};
function deptIcon(iconVal) {
  if (!iconVal) return '<re-icon icon="building2"></re-icon>';
  // Legacy emoji stored in DB — map to key first
  var key = _DEPT_EMOJI_TO_KEY[iconVal] || null;
  if (key) return '<re-icon icon="' + key + '"></re-icon>';
  // Already a key string (no emoji codepoints) — use directly
  return '<re-icon icon="' + escapeHtml(iconVal) + '"></re-icon>';
}

function isCurrentUserSuperAdmin() {
  try {
    var access = JSON.parse(sessionStorage.getItem('eams_access') || '{}');
    if (access && access.flags && access.flags.isSuper) return true;
    if (access && (access.tier === 'superAdmin' || access.accessRole === 'superAdmin')) return true;
    var user = JSON.parse(sessionStorage.getItem('eams_user') || '{}');
    return Boolean(user && user.isSuperAdmin);
  } catch (e) {
    return false;
  }
}

function getCurrentUserDeptInfo() {
  try {
    var access = JSON.parse(sessionStorage.getItem('eams_access') || '{}');
    var user = JSON.parse(sessionStorage.getItem('eams_user') || '{}');
    var dId = null;
    var dName = '';

    if (access && access.pages && access.pages.admin) {
      dId = access.pages.admin.deptId ? String(access.pages.admin.deptId) : null;
      dName = access.pages.admin.deptName || access.pages.admin.dept || '';
    }
    if (!dId && user.deptId) dId = String(user.deptId);
    if (!dName) dName = user.department || user.deptName || user.dept || '';

    // If dName is empty or an ObjectId (24 hex characters), resolve real name from DB
    if (!dName || /^[0-9a-fA-F]{24}$/.test(dName)) {
      var targetId = dId || dName;
      var depts = DB.get('depts') || [];
      var matched = depts.find(function (d) { return String(d._id) === String(targetId) || String(d.id) === String(targetId); });
      if (matched && matched.name) {
        dName = matched.name;
        if (!dId) dId = String(matched._id);
      } else if (user.department && !/^[0-9a-fA-F]{24}$/.test(user.department)) {
        dName = user.department;
      }
    }

    if (!dId && dName) {
      var allDepts = DB.get('depts') || [];
      var matchedByName = allDepts.find(function (d) {
        return d.name && d.name.toLowerCase().trim() === dName.toLowerCase().trim();
      });
      if (matchedByName) {
        dId = String(matchedByName._id || matchedByName.id);
      }
    }

    return {
      id: dId,
      name: dName || 'Department'
    };
  } catch (e) {
    return { id: null, name: 'Department' };
  }
}

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
  var _tParts = todayIST().split('-').map(Number);
  var today = new Date(_tParts[0], _tParts[1] - 1, _tParts[2]);
  today.setDate(today.getDate() + (offset || 0));
  var dayOfWeek = today.getDay();
  var monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

  return Array.from({ length: 5 }, function (_, i) {
    var d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return todayIST(d);
  });
}

function thisWeek() { return getWeekDates(0); }

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function timeAgo(isoDate) {
  if (!isoDate) return 'just now';
  var d = new Date(isoDate);
  var ts = d.getTime();
  if (isNaN(ts)) return 'just now';
  var diffSeconds = Math.floor((Date.now() - ts) / 1000);
  if (diffSeconds < 0 || diffSeconds < 60) return 'just now';
  if (diffSeconds < 3600) return Math.floor(diffSeconds / 60) + 'm ago';
  if (diffSeconds < 86400) return Math.floor(diffSeconds / 3600) + 'h ago';
  var days = Math.floor(diffSeconds / 86400);
  if (days === 1) return '1d ago';
  if (days < 30) return days + 'd ago';
  if (days < 365) return Math.floor(days / 30) + 'mo ago';
  return Math.floor(days / 365) + 'y ago';
}

// ─── AUTHENTICATION ──────────────────────────────────────────────────────────
var currentUser = null;
var YEAR_CONFIG = { current: '', batches: [], all: [], yearsData: [] };

function getActiveBatches() {
  var batchSet = new Set(Array.isArray(YEAR_CONFIG.batches) ? YEAR_CONFIG.batches : []);
  if (YEAR_CONFIG.yearsData && Array.isArray(YEAR_CONFIG.yearsData)) {
    YEAR_CONFIG.yearsData.forEach(function (y) {
      if (Array.isArray(y.batches)) {
        y.batches.forEach(function (b) {
          if (b && (b.batch || b.name)) batchSet.add(b.batch || b.name);
        });
      }
    });
  }
  var classes = (typeof DB !== 'undefined' && DB.get) ? (DB.get('classes') || []) : [];
  if (Array.isArray(classes)) {
    classes.forEach(function (c) {
      if (c && c.batch) batchSet.add(c.batch);
    });
  }
  if (typeof _studentData !== 'undefined' && Array.isArray(_studentData)) {
    _studentData.forEach(function (s) {
      if (s && s.batch) batchSet.add(s.batch);
    });
  }
  return Array.from(batchSet).filter(Boolean).sort().reverse();
}
window.getActiveBatches = getActiveBatches;

function getBatchYearLevel(batchStr, refAcadYear) {
  if (!batchStr) return '';
  var acadYear = refAcadYear || YEAR_CONFIG.current;
  var years = Array.isArray(YEAR_CONFIG.yearsData) ? YEAR_CONFIG.yearsData : [];
  if (years.length) {
    var yRec = acadYear ? years.find(function (y) { return y.academicYear === acadYear; }) : null;
    if (!yRec) yRec = years.find(function (y) { return y.isCurrent; }) || years[0];
    if (yRec && Array.isArray(yRec.batches)) {
      var bObj = yRec.batches.find(function (b) { return b && (b.batch === batchStr || b.batchTrackId === batchStr); });
      if (bObj && bObj.currentYear) return bObj.currentYear;
    }
  }
  // Formula calculation based on academic year start
  var acadStart = 0;
  if (acadYear) {
    var m = String(acadYear).match(/(\d{4})/);
    if (m) acadStart = parseInt(m[1], 10);
  }
  if (!acadStart) {
    var d = new Date();
    acadStart = d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1;
  }
  var mBatch = String(batchStr).match(/(\d{4})/);
  if (mBatch && acadStart) {
    var batchStart = parseInt(mBatch[1], 10);
    var offset = acadStart - batchStart;
    var ROMAN = ['I', 'II', 'III', 'IV'];
    if (offset >= 0 && offset < ROMAN.length) return ROMAN[offset];
  }
  return '';
}
window.getBatchYearLevel = getBatchYearLevel;



// Session inactivity and auto-logout are managed centrally by js/core/session.js

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
    toggleButton.innerHTML = isOpen ? '<re-icon icon="x"></re-icon>' : '<re-icon icon="menu"></re-icon>';
  } else {
    var isHidden = sidebar.classList.toggle('sb-hidden');
    mainContent.classList.toggle('sb-expanded', isHidden);
    toggleButton.classList.toggle('closed', isHidden);
    toggleButton.innerHTML = isHidden ? '<re-icon icon="menu"></re-icon>' : '<re-icon icon="x"></re-icon>';
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

  if (typeof applyUserRoleBadgeStyling === 'function') {
    applyUserRoleBadgeStyling(currentUser);
  }

  initAdminSearchableDropdowns();
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
      loaderEtaEl.innerHTML = '<re-icon icon="check"></re-icon> All data loaded';
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

  setTimeout(function () { timerDone = true; tryReveal(); }, 150);

  syncAllFromDB(function () {
    fetchCb = function () {
      syncBadgesFromAPI();
      var urlParams = new URLSearchParams(window.location.search);
      var initialTab = urlParams.get('tab') || urlParams.get('page');
      if (!initialTab && (urlParams.get('depts') || urlParams.get('dept') || urlParams.get('cls') || urlParams.get('subj'))) {
        initialTab = 'struct';
      }
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

// ─── URL Param Obfuscation / Encryption ──────────────────────────────────────
var _URL_CIPHER_KEY = 'EAMS@2026#SEC!CIPHER';

function encryptUrlParam(raw) {
  if (!raw) return '';
  try {
    var str = encodeURIComponent(String(raw));
    var enc = '';
    for (var i = 0; i < str.length; i++) {
      enc += String.fromCharCode((str.charCodeAt(i) ^ _URL_CIPHER_KEY.charCodeAt(i % _URL_CIPHER_KEY.length)) & 0xFF);
    }
    return btoa(enc)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch (e) {
    return '';
  }
}

function decryptUrlParam(cipher) {
  if (!cipher) return '';
  try {
    var b64 = String(cipher).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var raw = atob(b64);
    var dec = '';
    for (var i = 0; i < raw.length; i++) {
      dec += String.fromCharCode((raw.charCodeAt(i) ^ _URL_CIPHER_KEY.charCodeAt(i % _URL_CIPHER_KEY.length)) & 0xFF);
    }
    return decodeURIComponent(dec);
  } catch (e) {
    return String(cipher);
  }
}

function updateStructureUrlParams(params) {
  if (!window.history || !window.history.replaceState) return;
  try {
    var url = new URL(window.location);
    if (params.depts !== undefined) {
      if (params.depts) {
        url.searchParams.set('depts', encryptUrlParam(params.depts));
      } else {
        url.searchParams.delete('depts');
        url.searchParams.delete('dept');
      }
    }
    if (params.cls !== undefined) {
      if (params.cls) {
        url.searchParams.set('cls', encryptUrlParam(params.cls));
      } else {
        url.searchParams.delete('cls');
        url.searchParams.delete('class');
      }
    }
    if (params.subj !== undefined) {
      if (params.subj) {
        url.searchParams.set('subj', encryptUrlParam(params.subj));
      } else {
        url.searchParams.delete('subj');
        url.searchParams.delete('subject');
      }
    }
    window.history.replaceState(null, '', url);
  } catch (e) {
    console.warn('[EAMS] Failed to update URL params:', e);
  }
}

function _restoreClassAndSubjectFromUrl() {
  try {
    var urlParams = new URLSearchParams(window.location.search);
    var rawCls = urlParams.get('cls') || urlParams.get('class');
    if (rawCls) {
      var clsId = decryptUrlParam(rawCls);
      var matchedCls = (DB.get('classes') || []).find(function (c) { return String(c._id) === String(clsId); });
      if (matchedCls) {
        setTimeout(function () { openCD(matchedCls._id); }, 150);
        return;
      }
    }

    var rawSubj = urlParams.get('subj') || urlParams.get('subject');
    if (rawSubj) {
      var subjId = decryptUrlParam(rawSubj);
      var matchedSubj = (DB.get('subjects') || []).find(function (s) { return String(s._id) === String(subjId); });
      if (matchedSubj) {
        setTimeout(function () { openSD(matchedSubj._id); }, 150);
      }
    }
  } catch (e) {
    console.warn('[EAMS] Failed to restore modal from URL:', e);
  }
}

window.encryptUrlParam = encryptUrlParam;
window.decryptUrlParam = decryptUrlParam;
window.updateStructureUrlParams = updateStructureUrlParams;

// ─── NAVIGATION ──────────────────────────────────────────────────────────────
var PAGE_NAMES = ['dash', 'depts', 'struct', 'students', 'teachers', 'roles', 'reports', 'logs', 'trust', 'grievance'];

function nav(pageName) {
  var pub = window._pubSettings || {};
  if (pageName === 'trust' && pub.pages) {
    var pTrust = String(pub.pages.pageTrust || 'enabled').toLowerCase();
    if (pTrust === 'hidden') {
      pageName = 'dash';
    } else if (pTrust === 'disabled') {
      if (typeof showPopup === 'function') {
        showPopup({
          title: 'Portal Disabled',
          message: 'Trust & Devices Management is currently disabled by administrator for maintenance.',
          type: 'warn'
        });
      } else if (typeof showToast === 'function') {
        showToast('Trust & Devices Management is currently disabled by administrator.', 'warn');
      }
      pageName = 'dash';
    }
  }

  if (PAGE_NAMES.indexOf(pageName) === -1) pageName = 'dash';

  window._currentPage = pageName;

  if (window.history && window.history.replaceState) {
    var url = new URL(window.location);
    url.searchParams.set('tab', pageName);
    if (pageName !== 'struct') {
      url.searchParams.delete('depts');
      url.searchParams.delete('dept');
      url.searchParams.delete('cls');
      url.searchParams.delete('class');
      url.searchParams.delete('subj');
      url.searchParams.delete('subject');
    }
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
      var urlParams = new URLSearchParams(window.location.search);
      var rawDeptParam = urlParams.get('depts') || urlParams.get('dept');
      if (rawDeptParam) {
        var dId = decryptUrlParam(rawDeptParam);
        if (dId) {
          setTimeout(function () { editDept(dId); }, 250);
        }
      }
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
      if (isCurrentUserSuperAdmin()) {
        var dInfo = getCurrentUserDeptInfo();
        var myDeptId = dInfo.id;
        var myDeptName = dInfo.name;
        if (!myDeptId) {
          var found = (DB.get('depts') || []).find(function (d) { return d.name === myDeptName; });
          if (found) myDeptId = found._id;
        }
        structureContext.deptId = myDeptId;
        structureContext.deptName = myDeptName;
        renderClassSubjectView(myDeptId);
        showStructureView('cs');
        var clsPageBtn = document.getElementById('cls-page-btn');
        if (clsPageBtn) clsPageBtn.style.display = 'flex';
        updateStructureUrlParams({ depts: myDeptId });
        ensureLoaded(['classes', 'subjects', 'assignments', 'users'], function () {
          renderClassSubjectView(myDeptId);
          _restoreClassAndSubjectFromUrl();
          if (window._pendingStructureTab) {
            var st = window._pendingStructureTab;
            window._pendingStructureTab = null;
            sst(st);
          }
          dbToast('Fetched data successfully', 'success');
        }).catch(function (err) {
          console.error(err);
          dbToast('Loaded with warnings', 'warn');
        });
        return;
      }

      var urlParams = new URLSearchParams(window.location.search);
      var rawDeptParam = urlParams.get('depts') || urlParams.get('dept');
      var deptIdFromUrl = rawDeptParam ? decryptUrlParam(rawDeptParam) : null;
      var activeDeptId = structureContext.deptId || deptIdFromUrl;

      var allDepts = DB.get('depts') || [];
      var matchedDept = activeDeptId ? allDepts.find(function (d) {
        return String(d._id) === String(activeDeptId) || String(d.code) === String(activeDeptId) || String(d.name) === String(activeDeptId);
      }) : null;

      if (matchedDept) {
        structureContext.deptId = matchedDept._id;
        structureContext.deptName = matchedDept.name;
        structureContext.deptCode = matchedDept.code;
        structureContext.category = matchedDept.category || 'programme';
        renderClassSubjectView(matchedDept._id);
        showStructureView('cs');
        _applyDeptCategoryUI();
        var clsPageBtn = document.getElementById('cls-page-btn');
        if (clsPageBtn) clsPageBtn.style.display = 'flex';
        updateStructureUrlParams({ depts: matchedDept._id });
      } else if (!activeDeptId) {
        resetStructureState();
        renderDepartmentSelector();
        showStructureView('dept');
        updateStructureUrlParams({ depts: null, cls: null, subj: null });
      }

      ensureLoaded(['classes', 'subjects', 'assignments', 'users'], function () {
        var deptsNow = DB.get('depts') || [];
        var targetDept = null;
        if (structureContext.deptId) {
          targetDept = deptsNow.find(function (d) { return String(d._id) === String(structureContext.deptId); });
        }
        if (!targetDept && deptIdFromUrl) {
          targetDept = deptsNow.find(function (d) {
            return String(d._id) === String(deptIdFromUrl) || String(d.code) === String(deptIdFromUrl) || String(d.name) === String(deptIdFromUrl);
          });
        }

        if (targetDept) {
          structureContext.deptId = targetDept._id;
          structureContext.deptName = targetDept.name;
          structureContext.deptCode = targetDept.code;
          structureContext.category = targetDept.category || 'programme';
          renderClassSubjectView(targetDept._id);
          showStructureView('cs');
          _applyDeptCategoryUI();
          var cpBtn = document.getElementById('cls-page-btn');
          if (cpBtn) cpBtn.style.display = 'flex';
          updateStructureUrlParams({ depts: targetDept._id });
          _restoreClassAndSubjectFromUrl();
          if (window._pendingStructureTab) {
            var st = window._pendingStructureTab;
            window._pendingStructureTab = null;
            sst(st);
          }
        } else {
          renderDepartmentSelector();
          showStructureView('dept');
        }
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
      document.getElementById('stb').innerHTML = '<tr><td colspan="9" style="text-align:center;padding:36px 16px;color:var(--tdi);"><span style="font-size:38px;display:block;margin-bottom:10px;"><re-icon icon="clipboard-list"></re-icon></span><div style="font-size:14px;font-weight:600;margin-bottom:4px;">Click <strong>Show List</strong> above to view students.</div><div style="font-size:12px;color:var(--tdi);">Select filters and click Show List to begin.</div></td></tr>';
      document.getElementById('scb').textContent = '0 students';
      document.getElementById('load-more-wrap').style.display = 'none';
      updateShowListEnabled();
      ensureLoaded(['classes', 'depts'], function () {
        populateStudentFilterDropdowns().then(function () {
          updateShowListEnabled();
          dbToast('Fetched data successfully', 'success');
          if (window._pendingStudentFilter) {
            var pf = window._pendingStudentFilter;
            window._pendingStudentFilter = null;
            applyStudentFilter(pf);
          }
        }).catch(function (err) {
          console.error(err);
          updateShowListEnabled();
          dbToast('Loaded with warnings', 'warn');
          if (window._pendingStudentFilter) {
            var pf = window._pendingStudentFilter;
            window._pendingStudentFilter = null;
            applyStudentFilter(pf);
          }
        });
      }).catch(function (err) {
        console.error(err);
        populateStudentFilterDropdowns().then(function () {
          updateShowListEnabled();
          dbToast('Fetched data successfully', 'success');
          if (window._pendingStudentFilter) {
            var pf = window._pendingStudentFilter;
            window._pendingStudentFilter = null;
            applyStudentFilter(pf);
          }
        });
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
      document.querySelectorAll('#ttbl-wrap .sort-ind').forEach(function (el) { el.textContent = ''; });
      toggleTeacherView('grid');
      populateTeacherDeptDropdown();
      if (window._pendingTeacherDeptId) {
        var pDeptId = window._pendingTeacherDeptId;
        window._pendingTeacherDeptId = null;
        var deptFilter = document.getElementById('tf-dept');
        if (deptFilter && !deptFilter.disabled) {
          deptFilter.value = pDeptId;
        }
      }
      if (typeof SearchableDropdown !== 'undefined') {
        SearchableDropdown.sync('tf-desig');
        SearchableDropdown.sync('tf-dept');
      }
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
      if (typeof window.updateExecutiveRolesTabVisibility === 'function') {
        window.updateExecutiveRolesTabVisibility();
      }
      if (typeof window.loadExecutiveRolesOverview === 'function') {
        window.loadExecutiveRolesOverview();
      }
    },
    'trust': function () {
      ensureLoaded(['classes', 'depts'], function () {
        if (typeof window.initTrustDevicesModule === 'function') {
          window.initTrustDevicesModule();
        }
      }).catch(function () {
        if (typeof window.initTrustDevicesModule === 'function') {
          window.initTrustDevicesModule();
        }
      });
    },
    'grievance': function () {
      initGrievancesPage();
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
  if (!ts) return 'just now';
  var d = new Date(ts);
  if (isNaN(d.getTime())) return 'just now';
  var diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 0 || diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  var yest = new Date();
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
    { label: 'Total Logs', val: total, icon: '<re-icon icon="clipboard-list"></re-icon>', bg: '#fff', tc: 'var(--td)', mc: 'var(--tmu)' },
    { label: 'Admin Actions', val: counts.admin, icon: '<re-icon icon="crown"></re-icon>', bg: '#fef2f2', tc: '#dc2626', mc: 'var(--tmu)' },
    { label: 'Teacher Actions', val: counts.teacher, icon: '<re-icon icon="teacher"></re-icon>', bg: '#eff6ff', tc: '#2563eb', mc: 'var(--tmu)' },
    { label: 'Student Actions', val: counts.student, icon: '<re-icon icon="graduation-cap"></re-icon>', bg: '#f0fdf4', tc: '#16a34a', mc: 'var(--tmu)' },
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
    container.innerHTML = '<div class="emst"><span class="emico"><re-icon icon="clipboard-list"></re-icon></span><div class="emtx">No logs match your filters.</div></div>';
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
      + '<span style="font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;letter-spacing:.7px;white-space:nowrap;">' + escapeHtml(g.label) + '</span>'
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

      html += '<div style="width:36px;height:36px;border-radius:50%;background:' + rs.av + ';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0;margin-top:1px;">' + escapeHtml(inits) + '</div>';

      html += '<div style="flex:1;min-width:0;">'
        + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px;">'
        + '<span style="font-size:13px;font-weight:700;color:var(--td);">' + escapeHtml(log.userName || 'Unknown') + '</span>'
        + '<span style="background:' + rs.bg + ';color:' + rs.color + ';border:1px solid ' + rs.border + ';padding:1px 9px;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;">' + escapeHtml(rs.label) + '</span>'
        + '<span style="background:' + ts.bg + ';color:' + ts.color + ';padding:1px 9px;border-radius:20px;font-size:10px;font-weight:600;">' + escapeHtml(ts.label) + '</span>'
        + '</div>'
        + '<div style="font-size:13px;font-weight:600;color:var(--td);margin-bottom:' + (log.details ? '2px' : '0') + ';">' + escapeHtml(log.action || '') + '</div>'
        + (log.details ? '<div style="font-size:11.5px;color:var(--tmu);">' + escapeHtml(log.details) + '</div>' : '')
        + '</div>';

      html += '<div style="flex-shrink:0;text-align:right;padding-top:1px;">'
        + '<div style="font-size:11.5px;font-weight:600;color:var(--tdi);white-space:nowrap;" title="' + escapeHtml(exact) + '">' + escapeHtml(_logRelTime(log._ts)) + '</div>'
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
  var todayStr = todayIST();
  var _tParts = todayStr.split('-').map(Number);
  var thirtyDaysAgo = new Date(_tParts[0], _tParts[1] - 1, _tParts[2] - 30);
  var thirtyDaysAgoStr = todayIST(thirtyDaysAgo);

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
      if (isCurrentUserSuperAdmin()) {
        var dInfo = getCurrentUserDeptInfo();
        var myDeptId = dInfo.id;
        var myDeptName = dInfo.name;
        if (!myDeptId) {
          var found = depts.find(function (d) { return d.name === myDeptName; });
          if (found) myDeptId = found._id;
        }
        el.innerHTML = '<option value="' + (myDeptId || '') + '">' + escapeHtml(myDeptName || 'My Department') + '</option>';
        el.value = myDeptId || '';
        el.disabled = true;
        el.style.cursor = 'not-allowed';
      } else {
        el.innerHTML = '<option value="">All Departments</option>'
          + depts.map(function (d) { return '<option value="' + d._id + '">' + d.name + '</option>'; }).join('');
        el.disabled = false;
        el.style.cursor = '';
      }
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
      + '<span style="font-size:38px;display:block;margin-bottom:10px;"><re-icon icon="calendar"></re-icon></span>'
      + '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">Select a date range to generate the report.</div>'
      + '<div style="font-size:12px;color:var(--tdi);">Use the date pickers above to filter by date range.</div>'
      + '</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);"><re-icon icon="hourglass"></re-icon> Loading report data...</td></tr>';

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
        + '<span style="font-size:38px;display:block;margin-bottom:10px;"><re-icon icon="grid"></re-icon></span>'
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
      + '<span style="font-size:38px;display:block;margin-bottom:10px;"><re-icon icon="calendar"></re-icon></span>'
      + '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">Select a date range to generate the report.</div>'
      + '<div style="font-size:12px;color:var(--tdi);">Use the date pickers above to filter by date range.</div>'
      + '</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);"><re-icon icon="hourglass"></re-icon> Loading report data...</td></tr>';

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
        + '<span style="font-size:38px;display:block;margin-bottom:10px;"><re-icon icon="grid"></re-icon></span>'
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
      + '<span style="font-size:38px;display:block;margin-bottom:10px;"><re-icon icon="calendar"></re-icon></span>'
      + '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">Select a date range to generate the report.</div>'
      + '<div style="font-size:12px;color:var(--tdi);">Use the date pickers above to filter by date range.</div>'
      + '</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--tdi);"><re-icon icon="hourglass"></re-icon> Loading report data...</td></tr>';

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
        + '<span style="font-size:38px;display:block;margin-bottom:10px;"><re-icon icon="graduation-cap"></re-icon></span>'
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

  if (rows.length === 0 || (rows.length === 1 && rows[0][0].indexOf('No') === 0 || rows[0][0].indexOf('<re-icon icon="hourglass"></re-icon>') === 0)) {
    showToast('No data to export', 'warn');
    return;
  }

  var allData = [headers].concat(rows);
  var fileName = 'Attendance_Report_' + activeTab + '_' + todayIST();

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
  if (fun1 === 'm-add-class-quick' || fun1 === 'm-add-class' || fun1 === 'class') {
    closeModalBg('m-edit-dept');
    nav(fun2 || 'struct');
    if (typeof openAddClassModal === 'function') {
      openAddClassModal(currentDeptId);
    } else {
      om('m-add-class-quick');
    }
    return;
  }
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
    + '<re-icon icon="alert-triangle"></re-icon> ' + label + ' failed to load. '
    + '<button onclick="retryDeferredWidget(\'' + containerId + '\',\'' + label + '\')" style="background:var(--gD);color:#fff;border:none;border-radius:6px;padding:5px 14px;font-size:11px;font-weight:600;cursor:pointer;font-family:Poppins,sans-serif;margin-left:8px;">Retry</button>'
    + '</div>';
}

var _deferredWidgetRetries = {};

function retryDeferredWidget(containerId, label) {
  if (_deferredWidgetRetries[containerId]) return;
  _deferredWidgetRetries[containerId] = true;
  var el = document.getElementById(containerId);
  if (el) el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tdi);font-size:12px;"><re-icon icon="hourglass"></re-icon> Loading ' + label + '…</div>';
  renderDeferredDashboard();
}

function renderDeferredDashboard() {
  var tok = getToken();
  if (!tok) return Promise.resolve();
  var h = { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' };

  var params = [];
  var deptVal = document.getElementById('f-dept');
  if (deptVal && deptVal.value) params.push('deptId=' + encodeURIComponent(deptVal.value));
  var yearVal = document.getElementById('f-year');
  if (yearVal && yearVal.value) params.push('academicYear=' + encodeURIComponent(yearVal.value));
  var batchVal = document.getElementById('f-batch');
  if (batchVal && batchVal.value) params.push('batch=' + encodeURIComponent(batchVal.value));
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
          listEl.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,.5);font-size:12px;"><re-icon icon="confetti"></re-icon> No defaulters</div>';
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
          listEl.innerHTML = '<div class="empty-state"><span class="ei"><re-icon icon="check-circle"></re-icon></span><p>All teachers marked attendance this week</p></div>';
          return;
        }
        listEl.innerHTML = list.map(function (item) {
          var daysString = (item.missingDays || []).map(function (d) { return formatDate(d); }).join(', ');
          var dayLabel = item.missingCount > 1 ? 'days' : 'day';
          return '<div class="unm-item">'
            + '<div class="unm-av"><re-icon icon="alert-triangle"></re-icon></div>'
            + '<div class="unm-info">'
            + '<div class="unm-name">' + (item.teacherName || '—') + '</div>'
            + '<div class="unm-sub">' + (item.subjectName || '') + ' · ' + (item.className || '') + '</div>'
            + '<div class="unm-meta">Missing: ' + daysString + ' (' + item.missingCount + ' ' + dayLabel + ')</div>'
            + '</div>'
            + '<button class="notify-btn" onclick="openNotifyModal(\'' + (item.teacherId || '') + '\',\'' + (item.teacherName || '') + '\',\'' + (item.subjectName || '') + '\',\'' + (item.className || '') + '\')"><re-icon icon="bullhorn"></re-icon> Notify</button>'
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
  var _tParts = todayIST().split('-').map(Number);
  var today = new Date(_tParts[0], _tParts[1] - 1, _tParts[2]);
  var fromDate, toDate;

  if (rangeType === 'this') {
    var dayOfWeek = today.getDay();
    var monday = new Date(today);
    monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
    fromDate = todayIST(monday);
    toDate = todayIST(today);
  } else if (rangeType === 'last') {
    var dayOfWeek2 = today.getDay();
    var lastMon = new Date(today);
    lastMon.setDate(today.getDate() - ((dayOfWeek2 + 6) % 7) - 7);
    var lastFri = new Date(lastMon);
    lastFri.setDate(lastMon.getDate() + 4);
    fromDate = todayIST(lastMon);
    toDate = todayIST(lastFri);
  } else {
    // 'month'
    fromDate = todayIST(new Date(today.getFullYear(), today.getMonth(), 1));
    toDate = todayIST();
  }

  document.getElementById('f-from').value = fromDate;
  document.getElementById('f-to').value = toDate;
  onFilterChange();
}

function onFilterChange() {
  var selectedDept = document.getElementById('f-dept') ? document.getElementById('f-dept').value : '';
  var selectedYear = document.getElementById('f-year') ? document.getElementById('f-year').value : '';
  var selectedBatch = document.getElementById('f-batch') ? document.getElementById('f-batch').value : '';

  // Determine allowed batches from academic year if batch is not explicitly chosen
  var allowedBatches = null;
  if (selectedBatch) {
    allowedBatches = [selectedBatch];
  } else if (selectedYear && YEAR_CONFIG.yearsData && YEAR_CONFIG.yearsData.length) {
    var matchedYear = YEAR_CONFIG.yearsData.find(function (y) { return y.academicYear === selectedYear; });
    if (matchedYear && Array.isArray(matchedYear.batches) && matchedYear.batches.length) {
      allowedBatches = matchedYear.batches.map(function (b) { return b.batch || b.batchTrackId; });
    }
  }

  var allClasses = (DB.get('classes') || []).filter(function (c) {
    if (selectedDept && c.deptId !== selectedDept) return false;
    if (allowedBatches && allowedBatches.length && allowedBatches.indexOf(c.batch) === -1) return false;
    return true;
  });

  // Refresh the class dropdown while preserving the current selection
  var classDropdown = document.getElementById('f-class');
  if (classDropdown) {
    var currentClassId = classDropdown.value;
    classDropdown.innerHTML = '<option value="">All</option>'
      + allClasses.map(function (c) {
        return '<option value="' + c._id + '"' + (c._id === currentClassId ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>';
      }).join('');
  }

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
function getNotificationStatusBadge(n) {
  var isRead = Boolean(n.read || n.status === 'Read');
  var isGrievance = (n.message && n.message.startsWith('[Grievance]')) || Boolean(n.grievanceId);
  var isRequest = n.type === 'request' || isGrievance;

  if (isRequest) {
    if (n.status === 'Solved') {
      return '<span class="notif-badge-solved"><re-icon icon="check-circle"></re-icon> Solved</span>';
    }
    if (n.status === 'Cancelled') {
      return '<span class="notif-badge-cancelled"><re-icon icon="x-circle"></re-icon> Cancelled</span>';
    }
    if (isRead) {
      return '<span class="notif-badge-read"><re-icon icon="check-check"></re-icon> Read</span>';
    }
    return '<span class="notif-badge-pending"><re-icon icon="hourglass"></re-icon> Pending</span>';
  }

  // Announcements, role assignments, system alerts, general notifications
  if (isRead) {
    return '<span class="notif-badge-read"><re-icon icon="check-check"></re-icon> Read</span>';
  }
  return '<span class="notif-badge-delivered"><re-icon icon="check"></re-icon> Delivered</span>';
}

function getNotificationStatusChip(n) {
  var isRead = Boolean(n.read || n.status === 'Read');
  var isGrievance = (n.message && n.message.startsWith('[Grievance]')) || Boolean(n.grievanceId);
  var isRequest = n.type === 'request' || isGrievance;

  if (isRequest) {
    if (n.status === 'Solved') return '<span style="font-size:9px;color:var(--gD);font-weight:700;"><re-icon icon="check-circle"></re-icon> Solved</span>';
    if (n.status === 'Cancelled') return '<span style="font-size:9px;color:#dc2626;font-weight:700;"><re-icon icon="x-circle"></re-icon> Cancelled</span>';
  }
  if (isRead) return '<span style="font-size:9px;color:#15803d;font-weight:700;"><re-icon icon="check-check"></re-icon> Read</span>';
  return '<span style="font-size:9px;color:#1d4ed8;font-weight:700;"><re-icon icon="check"></re-icon> Delivered</span>';
}

function renderNotificationsMain() {
  var rawNotifs = DB.get('notifications') || [];
  var notifications = rawNotifs.filter(function (n) {
    return n.type !== 'timetable-verification' && !(n.message && n.message.toLowerCase().includes('timetable verification'));
  }).slice().reverse();
  var unreadCount = notifications.filter(function (n) { return !n.read; }).length;

  var countBadge = document.getElementById('notif-count-badge');
  if (countBadge) countBadge.textContent = unreadCount + ' new';
  var cardMarkAll = document.getElementById('card-mark-all-read');
  if (cardMarkAll) cardMarkAll.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
  var badge = document.getElementById('notif-badge-count');
  if (badge) {
    badge.textContent = unreadCount;
    badge.style.display = unreadCount ? 'flex' : 'none';
  }

  var listEl = document.getElementById('notif-list-main');
  if (!notifications.length) {
    listEl.innerHTML = '<div class="empty-state"><span class="ei"><re-icon icon="confetti"></re-icon></span><p>No notifications</p></div>';
    return;
  }

  listEl.innerHTML = notifications.slice(0, 8).map(function (n) {
    var isGrievance = (n.message && n.message.startsWith('[Grievance]')) || Boolean(n.grievanceId);
    var isTtVerification = n.type === 'timetable-verification' || (n.message && n.message.toLowerCase().includes('timetable verification'));
    var isRequest = (n.type === 'request' || isGrievance) && !isTtVerification;
    var isSolved = n.status === 'Solved';
    var isCancelled = n.status === 'Cancelled';
    var isRead = Boolean(n.read || n.status === 'Read');
    var icon = n.type === 'error' ? '<re-icon icon="x-circle"></re-icon>' : (isGrievance ? '<re-icon icon="bullhorn"></re-icon>' : '<re-icon icon="envelope"></re-icon>');
    var statusBadge = getNotificationStatusBadge(n);
    var unreadDot = !isRead ? '<div class="notif-unread-dot"></div>' : '';
    var highlight = !isRead ? 'highlight-notif' : '';

    var actionBtns = (isRequest && !isSolved && !isCancelled)
      ? '<div style="display:flex;gap:6px;margin-top:7px;">'
      + '<button onclick="event.stopPropagation();solveNotification(\'' + n._id + '\')" style="flex:1;padding:4px 0;background:var(--gD);color:#fff;border:none;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;font-family:Poppins,sans-serif;"><re-icon icon="check-circle"></re-icon> Solve</button>'
      + '<button onclick="event.stopPropagation();cancelNotification(\'' + n._id + '\')" style="flex:1;padding:4px 0;background:#fff;color:#dc2626;border:1.5px solid rgba(239,68,68,.3);border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;font-family:Poppins,sans-serif;"><re-icon icon="x-circle"></re-icon> Cancel</button>'
      + '</div>'
      : '';

    return '<div class="notif-item ' + highlight + '" onclick="markNotificationRead(\'' + n._id + '\')" title="' + (!isRead ? 'Click to mark as read' : '') + '">'
      + '<div class="notif-icon-row">'
      + '<div class="notif-ic ' + (n.type === 'error' ? 'error' : 'request') + '">' + icon + '</div>'
      + '<div class="notif-from">' + escapeHtml(n.from) + '</div>'
      + statusBadge + unreadDot
      + '</div>'
      + '<div class="notif-msg">' + escapeHtml(n.message) + '</div>'
      + '<div class="notif-time">' + timeAgo(n.time || n.createdAt) + '</div>'
      + actionBtns
      + '</div>';
  }).join('');
}

function renderNotificationDropdown() {
  var rawNotifs = DB.get('notifications') || [];
  var notifications = rawNotifs.filter(function (n) {
    return n.type !== 'timetable-verification' && !(n.message && n.message.toLowerCase().includes('timetable verification'));
  }).slice().reverse();
  var listEl = document.getElementById('nd-list');

  if (!notifications.length) {
    listEl.innerHTML = '<div class="nd-empty">No notifications</div>';
    return;
  }

  listEl.innerHTML = notifications.slice(0, 8).map(function (n) {
    var isRead = Boolean(n.read || n.status === 'Read');
    var unreadDot = !isRead ? '<div style="width:7px;height:7px;border-radius:50%;background:var(--blue);display:inline-block;margin-left:3px;vertical-align:middle;"></div>' : '';
    var tagClass = n.type === 'error' ? 'notif-tag-err' : 'notif-tag-req';
    var statusChip = getNotificationStatusChip(n);
    return '<div class="nd-item' + (!isRead ? ' unread' : '') + '" onclick="markNotificationRead(\'' + n._id + '\');toggleNotificationDropdown()">'
      + '<div style="font-size:20px;flex-shrink:0;">' + (n.type === 'error' ? '<re-icon icon="x-circle"></re-icon>' : '<re-icon icon="envelope"></re-icon>') + '</div>'
      + '<div style="flex:1;min-width:0;">'
      + '<div class="nd-from">' + escapeHtml(n.from) + unreadDot + '<span style="margin-left:6px;">' + statusChip + '</span><span class="' + tagClass + '" style="margin-left:auto;">' + escapeHtml(n.type) + '</span></div>'
      + '<div class="nd-msg">' + escapeHtml(n.message) + '</div>'
      + '<div class="nd-tm">' + timeAgo(n.time || n.createdAt) + '</div>'
      + '</div></div>';
  }).join('');
}

function renderNotificationsAll() {
  var rawNotifs = DB.get('notifications') || [];
  var notifications = rawNotifs.filter(function (n) {
    return n.type !== 'timetable-verification' && !(n.message && n.message.toLowerCase().includes('timetable verification'));
  }).slice().reverse();
  var listEl = document.getElementById('notif-all-list');

  if (!notifications.length) {
    listEl.innerHTML = '<div class="empty-state"><span class="ei"><re-icon icon="confetti"></re-icon></span><p>No notifications</p></div>';
    return;
  }

  listEl.innerHTML = notifications.map(function (n) {
    var isGrievance = (n.message && n.message.startsWith('[Grievance]')) || Boolean(n.grievanceId);
    var isRequest = n.type === 'request' || isGrievance;
    var isSolved = n.status === 'Solved';
    var isCancelled = n.status === 'Cancelled';
    var isRead = Boolean(n.read || n.status === 'Read');
    var tagClass = n.type === 'error' ? 'notif-tag-err' : 'notif-tag-req';
    var unreadDot = !isRead ? '<div style="width:7px;height:7px;border-radius:50%;background:var(--blue);display:inline-block;margin-left:4px;"></div>' : '';
    var statusBadge = getNotificationStatusBadge(n);
    var actionBtns = (isRequest && !isSolved && !isCancelled)
      ? '<div style="display:flex;gap:6px;margin-top:8px;">'
      + '<button class="btn-pri bxs" onclick="event.stopPropagation();solveNotification(\'' + n._id + '\');renderNotificationsAll()"><re-icon icon="check-circle"></re-icon> Solve</button>'
      + '<button class="btn bout bxs" style="color:#dc2626;border-color:rgba(239,68,68,.3);" onclick="event.stopPropagation();cancelNotification(\'' + n._id + '\');renderNotificationsAll()"><re-icon icon="x-circle"></re-icon> Cancel</button>'
      + '</div>'
      : '';

    var rawTime = n.time || n.createdAt;
    var dObj = rawTime ? new Date(rawTime) : null;
    var dateLabel = dObj && !isNaN(dObj.getTime()) ? dObj.toLocaleString('en-IN') : 'Recent';

    return '<div class="m-item' + (!isRead ? ' highlight-notif' : '') + '" onclick="markNotificationRead(\'' + n._id + '\')" style="cursor:pointer;" title="' + (!isRead ? 'Click to mark as read' : '') + '">'
      + '<div class="m-ic" style="background:' + (n.type === 'error' ? 'rgba(239,68,68,.08)' : 'rgba(245,158,11,.08)') + '">' + (n.type === 'error' ? '<re-icon icon="x-circle"></re-icon>' : '<re-icon icon="envelope"></re-icon>') + '</div>'
      + '<div class="m-body" style="flex:1;">'
      + '<div class="m-name" style="display:flex;align-items:center;gap:7px;">' + escapeHtml(n.from)
      + '<span class="' + tagClass + '">' + escapeHtml(n.type) + '</span>' + unreadDot + '<span style="margin-left:auto;">' + statusBadge + '</span></div>'
      + '<div class="m-sub">' + escapeHtml(n.message) + '</div>'
      + '<div style="font-size:10px;color:var(--tdi);margin-top:3px;">' + dateLabel + '</div>'
      + actionBtns
      + '</div></div>';
  }).join('');
}

function markNotificationRead(id) {
  var notif = DB.get('notifications').find(function (n) { return n._id === id; });
  if (!notif) return;
  if (!notif.read) {
    var newStatus = (notif.status === 'Solved' || notif.status === 'Cancelled') ? notif.status : 'Read';
    DB.update('notifications', id, { read: true, status: newStatus, readAt: new Date().toISOString() });
    renderNotificationsMain();
    renderNotificationDropdown();
    var allModal = document.getElementById('m-notif-all');
    if (allModal && allModal.classList.contains('open')) {
      renderNotificationsAll();
    }
    var tok = getToken();
    if (tok) {
      fetch('/api/notifications/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ read: true, status: newStatus })
      }).catch(function (err) {
        console.warn('[EAMS] Failed to persist notification read:', err);
      });
    }
  }
}
var markNotifRead = markNotificationRead; // alias for HTML

function clearAllNotifications() {
  var list = DB.get('notifications');
  list.forEach(function (n) {
    var newStatus = (n.status === 'Solved' || n.status === 'Cancelled') ? n.status : 'Read';
    DB.update('notifications', n._id, { read: true, status: newStatus, readAt: new Date().toISOString() });
  });
  renderNotificationsMain();
  renderNotificationDropdown();
  var allModal = document.getElementById('m-notif-all');
  if (allModal && allModal.classList.contains('open')) {
    renderNotificationsAll();
  }
  var notifDrop = document.getElementById('notif-drop');
  if (notifDrop) notifDrop.classList.remove('open');
  showToast('All notifications marked as read');

  var tok = getToken();
  if (tok) {
    fetch('/api/notifications/read-all', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok }
    }).catch(function (err) {
      console.warn('[EAMS] Failed to persist read-all notifications:', err);
    });
  }
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
  var tok = getToken();
  if (tok) {
    fetch('/api/notifications/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ status: 'Solved', read: true })
    }).catch(function () { });
  }
  dbToast('Request approved!', 'success');
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
  var allModal = document.getElementById('m-notif-all');
  if (allModal && allModal.classList.contains('open')) {
    renderNotificationsAll();
  }
  var tok = getToken();
  if (tok) {
    fetch('/api/notifications/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ status: 'Solved', read: true })
    }).catch(function () { });
  }
  dbToast('Marked as Solved — teacher portal updated', 'success');
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
  var allModal = document.getElementById('m-notif-all');
  if (allModal && allModal.classList.contains('open')) {
    renderNotificationsAll();
  }
  var tok = getToken();
  if (tok) {
    fetch('/api/notifications/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ status: 'Cancelled', read: true })
    }).catch(function () { });
  }
  showToast('Notification cancelled');
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
    listEl.innerHTML = '<div class="empty-state"><span class="ei"><re-icon icon="clipboard-list"></re-icon></span><p>No activity yet</p></div>';
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
      + '<div class="act-av" style="background:' + color + '">' + escapeHtml(((log.userName || '?')[0] || '?').toUpperCase()) + '</div>'
      + '<div class="act-body">'
      + '<div class="act-name">' + escapeHtml(log.userName || 'Unknown') + '</div>'
      + '<div class="act-task">Working on <b>' + escapeHtml(log.action || '') + '</b> — ' + escapeHtml(log.details || '') + '</div>'
      + '</div>'
      + '<div class="act-badge ' + escapeHtml(badge) + '">' + escapeHtml(log.action || '') + '</div>'
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
  showToast('<re-icon icon="download"></re-icon> Downloaded!');
}

// ─── SYSTEM HEALTH CARD ──────────────────────────────────────────────────────
function renderSystemHealth() {
  var studentCount = _counts.students || DB.get('students').length;
  var teacherCount = _counts.teachers || DB.get('users').filter(function (u) { return u.role === 'teacher'; }).length;

  var healthItems = [
    { icon: '<re-icon icon="graduation-cap"></re-icon>', bg: '#dbeafe', label: 'Total Students', value: studentCount, pill: null },
    { icon: '<re-icon icon="teacher"></re-icon>', bg: '#ede9fe', label: 'Total Teachers', value: teacherCount, pill: null },
    { icon: '<re-icon icon="clipboard-list"></re-icon>', bg: '#d1fae5', label: 'Attendance Records', value: '—', pill: null },
    { icon: '<re-icon icon="monitor"></re-icon>', bg: '#ecfdf5', label: 'Server Status', value: 'Online', pill: { text: '● Running', cls: 'sh-ok' } },
    { icon: '<re-icon icon="archive"></re-icon>', bg: '#f0fdf4', label: 'Database', value: 'Connected', pill: { text: '● Active', cls: 'sh-ok' } }
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

  var fDeptEl = document.getElementById('f-dept');
  if (fDeptEl) {
    if (isCurrentUserSuperAdmin()) {
      var dInfo = getCurrentUserDeptInfo();
      var myDeptId = dInfo.id;
      var myDeptName = dInfo.name;
      if (!myDeptId) {
        var found = depts.find(function (d) { return d.name === myDeptName; });
        if (found) myDeptId = found._id;
      }
      fDeptEl.innerHTML = '<option value="' + (myDeptId || '') + '">' + escapeHtml(myDeptName || 'My Department') + '</option>';
      fDeptEl.value = myDeptId || '';
      fDeptEl.disabled = true;
      fDeptEl.style.cursor = 'not-allowed';
    } else {
      fDeptEl.innerHTML = '<option value="">All</option>'
        + depts.map(function (d) { return '<option value="' + d._id + '">' + d.name + '</option>'; }).join('');
    }
  }

  // Populate Academic Year dropdown with ONLY academic years (e.g. 2026-2027)
  var acadYears = (YEAR_CONFIG.all && YEAR_CONFIG.all.length)
    ? YEAR_CONFIG.all.slice()
    : (YEAR_CONFIG.current ? [YEAR_CONFIG.current] : []);
  acadYears = Array.from(new Set(acadYears.filter(Boolean))).sort().reverse();
  var fYearEl = document.getElementById('f-year');
  if (fYearEl) {
    var curAcVal = fYearEl.value;
    fYearEl.innerHTML = '<option value="">All</option>'
      + acadYears.map(function (y) {
        var isCur = (y === YEAR_CONFIG.current) ? ' (Current)' : '';
        return '<option value="' + escapeHtml(y) + '"' + (y === curAcVal ? ' selected' : '') + '>' + escapeHtml(y + isCur) + '</option>';
      }).join('');
  }

  // Populate Batch Year dropdown with ONLY batches (e.g. 2026-2030, 2025-2029)
  populateFilterBatches();

  var fSubjEl = document.getElementById('f-subj');
  if (fSubjEl) {
    fSubjEl.innerHTML = '<option value="">All</option>'
      + subjects.map(function (s) { return '<option value="' + s._id + '">' + s.name + '</option>'; }).join('');
  }

  setWeekRange('this');
}
var populateFilters = populateChartFilters; // alias

function populateFilterBatches(selectedBatch) {
  var fBatchEl = document.getElementById('f-batch');
  if (!fBatchEl) return;

  var fYearEl = document.getElementById('f-year');
  var selectedAcYear = fYearEl ? fYearEl.value : '';

  var batchList = [];
  if (selectedAcYear && YEAR_CONFIG.yearsData && YEAR_CONFIG.yearsData.length) {
    var matchedYear = YEAR_CONFIG.yearsData.find(function (y) { return y.academicYear === selectedAcYear; });
    if (matchedYear && Array.isArray(matchedYear.batches) && matchedYear.batches.length) {
      batchList = matchedYear.batches.map(function (b) { return b.batch || b.batchTrackId; });
    }
  }

  if (!batchList.length) {
    batchList = Array.isArray(YEAR_CONFIG.batches) ? YEAR_CONFIG.batches.slice() : [];
  }
  batchList = Array.from(new Set(batchList.filter(Boolean))).sort().reverse();

  var curBatchVal = selectedBatch || fBatchEl.value;
  fBatchEl.innerHTML = '<option value="">All</option>'
    + batchList.map(function (b) {
      var yr = getBatchYearLevel(b, selectedAcYear);
      var yrAttr = yr ? ' data-year="' + escapeHtml(yr) + '"' : '';
      return '<option value="' + escapeHtml(b) + '"' + yrAttr + (b === curBatchVal ? ' selected' : '') + '>' + escapeHtml(b) + '</option>';
    }).join('');
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('f-batch');
  }
}
window.populateFilterBatches = populateFilterBatches;

function onAcadYearChange() {
  populateFilterBatches();
  onFilterChange();
}
window.onAcadYearChange = onAcadYearChange;

// ─── DEPARTMENTS PAGE ────────────────────────────────────────────────────────
var _deptCategoryFilter = 'all'; // 'all' | 'programme' | 'supporting'

function setDeptFilter(cat) {
  _deptCategoryFilter = (cat === 'supporting' || cat === 'programme') ? cat : 'all';
  var btnAll = document.getElementById('dept-tab-all');
  var btnProg = document.getElementById('dept-tab-programme');
  var btnSupp = document.getElementById('dept-tab-supporting');
  if (btnAll) btnAll.className = 't-pill' + (_deptCategoryFilter === 'all' ? ' act' : '');
  if (btnProg) btnProg.className = 't-pill' + (_deptCategoryFilter === 'programme' ? ' act' : '');
  if (btnSupp) btnSupp.className = 't-pill' + (_deptCategoryFilter === 'supporting' ? ' act' : '');
  renderDepartments();
}
window.setDeptFilter = setDeptFilter;

function getSubjectDeptId(s) {
  if (!s) return '';
  var raw = (s.deptId !== undefined && s.deptId !== null) ? s.deptId : s.departmentId;
  if (!raw) return '';
  if (typeof raw === 'object' && raw._id) return String(raw._id);
  return String(raw);
}
window.getSubjectDeptId = getSubjectDeptId;

// ─── SUPPORTING DEPARTMENT SUBJECT & CLASS LINKAGE HELPERS ───
function _getDeptSubjects(dept) {
  if (!dept) return [];
  var deptIdStr = String(dept._id || '');
  var deptName = (dept.name || '').trim();
  var deptCodeClean = (dept.code || '').trim().toUpperCase();
  var allSubjs = DB.get('subjects') || [];

  return allSubjs.filter(function (s) {
    var sDept = getSubjectDeptId(s);
    if (sDept && sDept === deptIdStr) return true;
    if (deptName && (s.deptName === deptName || s.department === deptName)) return true;
    if (dept.category === 'supporting' && deptCodeClean) {
      if (s.deptCode && s.deptCode.trim().toUpperCase() === deptCodeClean) return true;
      var sc = (s.courseCode || s.code || '').trim().toUpperCase();
      if (sc.startsWith(deptCodeClean)) return true;
      if (deptCodeClean === 'MAT' && (sc.includes('MAB') || sc.startsWith('MAT'))) return true;
      if (deptCodeClean === 'PHY' && (sc.includes('PHB') || sc.startsWith('PHY'))) return true;
      if (deptCodeClean === 'CHY' && (sc.includes('CHB') || sc.startsWith('CHY'))) return true;
      if (deptCodeClean === 'ENG' && (sc.includes('ENB') || sc.startsWith('ENG'))) return true;
    }
    return false;
  });
}
window._getDeptSubjects = _getDeptSubjects;

function _getDeptStudyingClasses(dept) {
  if (!dept) return [];
  var deptSubjects = _getDeptSubjects(dept);
  var deptSubjIdSet = new Set(deptSubjects.map(function (s) { return String(s._id); }));
  var deptCodeClean = (dept.code || '').trim().toUpperCase();

  var allClasses = DB.get('classes') || [];
  var activeMap = new Map(); // key: classId -> { cls, subjects: Map<subjKey, subjDisplayName> }

  function recordLink(cid, matchedSubj, clsNameFallback) {
    if (!cid) return;
    var cKey = String(cid);
    var clsObj = allClasses.find(function (c) { return String(c._id) === cKey; });
    if (!clsObj) {
      clsObj = {
        _id: cKey,
        name: clsNameFallback || 'Class',
        year: '—',
        sem: '—',
        studentCount: 0
      };
    }
    if (!activeMap.has(cKey)) {
      activeMap.set(cKey, { cls: clsObj, subjects: new Map() });
    }
    var entry = activeMap.get(cKey);
    var sKey = matchedSubj ? String(matchedSubj._id || matchedSubj.courseCode || matchedSubj.name) : 'subj';
    var sCode = (matchedSubj.courseCode || matchedSubj.code || matchedSubj.shortForm || '').trim();
    var sName = (matchedSubj.name || '').trim();
    var sLabel = sCode && sName ? (sCode + ' · ' + sName) : (sCode || sName || 'Subject');
    entry.subjects.set(sKey, sLabel);
  }

  // 1. Check assignments (DB.get('assignments'))
  var allAsgns = DB.get('assignments') || [];
  allAsgns.forEach(function (a) {
    var matched = null;
    if (a.subjectId && deptSubjIdSet.has(String(a.subjectId))) {
      matched = deptSubjects.find(function (s) { return String(s._id) === String(a.subjectId); });
    }
    if (!matched && a.subjectName) {
      matched = deptSubjects.find(function (s) {
        var sc = (s.courseCode || s.code || '').trim();
        return (sc && a.subjectName.includes(sc)) ||
          (s.name && a.subjectName.toLowerCase().includes(s.name.toLowerCase()));
      });
    }
    if (!matched && dept.category === 'supporting' && deptCodeClean && a.subjectName) {
      var sUpper = a.subjectName.toUpperCase();
      if (sUpper.includes(deptCodeClean) ||
          (deptCodeClean === 'MAT' && sUpper.includes('MAB')) ||
          (deptCodeClean === 'PHY' && sUpper.includes('PHB')) ||
          (deptCodeClean === 'CHY' && sUpper.includes('CHB')) ||
          (deptCodeClean === 'ENG' && sUpper.includes('ENB'))) {
        matched = { name: a.subjectName, courseCode: '' };
      }
    }
    if (matched && a.classId) {
      recordLink(a.classId, matched, a.className);
    }
  });

  // 2. Check classes.subjects array
  allClasses.forEach(function (c) {
    if (Array.isArray(c.subjects)) {
      c.subjects.forEach(function (sid) {
        var sKey = String(sid && sid._id ? sid._id : sid);
        if (deptSubjIdSet.has(sKey)) {
          var matched = deptSubjects.find(function (s) { return String(s._id) === sKey; });
          if (matched) recordLink(c._id, matched, c.name);
        }
      });
    }
  });

  // 3. Check timetable templates
  var templates = DB.get('templates') || [];
  templates.forEach(function (t) {
    if (!t || !t.classId) return;
    var cid = String(t.classId._id || t.classId);
    var grid = t.grid || [];
    grid.forEach(function (slot) {
      if (!slot || !slot.subject) return;
      var matched = deptSubjects.find(function (s) {
        var sc = (s.courseCode || s.code || '').trim();
        return (sc && slot.subject.includes(sc)) ||
          (s.name && slot.subject.toLowerCase().includes(s.name.toLowerCase()));
      });
      if (!matched && dept.category === 'supporting' && deptCodeClean) {
        var slUpper = slot.subject.toUpperCase();
        if (slUpper.includes(deptCodeClean) ||
            (deptCodeClean === 'MAT' && slUpper.includes('MAB')) ||
            (deptCodeClean === 'PHY' && slUpper.includes('PHB')) ||
            (deptCodeClean === 'CHY' && slUpper.includes('CHB')) ||
            (deptCodeClean === 'ENG' && slUpper.includes('ENB'))) {
          matched = { name: slot.subject, courseCode: '' };
        }
      }
      if (matched) recordLink(cid, matched, t.className);
    });
  });

  // 4. Check section timetables
  var sectionTimetables = DB.get('sectionTimetables') || [];
  sectionTimetables.forEach(function (st) {
    if (!st || !st.classId) return;
    var cid = String(st.classId._id || st.classId);
    var slots = Object.values(st.slots || {});
    slots.forEach(function (slot) {
      if (!slot || !slot.subject) return;
      var matched = deptSubjects.find(function (s) {
        var sc = (s.courseCode || s.code || '').trim();
        return (sc && slot.subject.includes(sc)) ||
          (s.name && slot.subject.toLowerCase().includes(s.name.toLowerCase()));
      });
      if (!matched && dept.category === 'supporting' && deptCodeClean) {
        var slUpper = slot.subject.toUpperCase();
        if (slUpper.includes(deptCodeClean) ||
            (deptCodeClean === 'MAT' && slUpper.includes('MAB')) ||
            (deptCodeClean === 'PHY' && slUpper.includes('PHB')) ||
            (deptCodeClean === 'CHY' && slUpper.includes('CHB')) ||
            (deptCodeClean === 'ENG' && slUpper.includes('ENB'))) {
          matched = { name: slot.subject, courseCode: '' };
        }
      }
      if (matched) recordLink(cid, matched, st.className);
    });
  });

  return Array.from(activeMap.values()).map(function (entry) {
    return {
      cls: entry.cls,
      subjectsList: Array.from(entry.subjects.values())
    };
  });
}
window._getDeptStudyingClasses = _getDeptStudyingClasses;

function _getHodInitials(name) {
  if (!name) return 'HD';
  var cleaned = name.replace(/^(Dr\.|Prof\.|Mr\.|Mrs\.|Ms\.)\s+/i, '').trim();
  var parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  } else if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (name.slice(0, 2) || 'HD').toUpperCase();
}

function _getDeptHod(dept) {
  if (!dept) return null;
  if (dept.hodName && dept.hodName.trim()) {
    return { name: dept.hodName.trim(), id: dept.hodId || null };
  }
  var allTch = (_teacherData && _teacherData.length) ? _teacherData : (DB.get('users') || []);
  var deptIdStr = String(dept._id || '');
  var deptName = dept.name || '';
  var deptCode = dept.code || '';
  var found = allTch.find(function (t) {
    var matchDept = String(t.deptId) === deptIdStr || (t.dept && (t.dept === deptName || t.dept === deptCode));
    var isHod = t.role === 'hod' || t.isHod === true ||
      (t.designation && /head of department|hod/i.test(t.designation)) ||
      (t.desig && /head of department|hod/i.test(t.desig));
    return matchDept && isHod;
  });
  if (found) {
    return { name: found.fullName || found.name || 'Head of Department', id: found._id || found.trackId || null };
  }
  return null;
}

function renderDepartments() {
  var depts = DB.get('depts') || [];
  var classes = DB.get('classes') || [];
  var subjects = DB.get('subjects') || [];
  var grid = document.getElementById('dg2');
  if (!grid) return;
  grid.className = 'tgrd';

  _renderDeptStats(depts);

  var progDepts = depts.filter(function (d) { return d.category !== 'supporting'; });
  var suppDepts = depts.filter(function (d) { return d.category === 'supporting'; });
  var cntAll = document.getElementById('cnt-all-dept');
  var cntProg = document.getElementById('cnt-prog-dept');
  var cntSupp = document.getElementById('cnt-supp-dept');
  if (cntAll) cntAll.textContent = '(' + depts.length + ')';
  if (cntProg) cntProg.textContent = '(' + progDepts.length + ')';
  if (cntSupp) cntSupp.textContent = '(' + suppDepts.length + ')';

  var activeList = depts;
  if (_deptCategoryFilter === 'supporting') {
    activeList = suppDepts;
  } else if (_deptCategoryFilter === 'programme') {
    activeList = progDepts;
  }

  if (!activeList.length) {
    var isSupp = _deptCategoryFilter === 'supporting';
    var isProg = _deptCategoryFilter === 'programme';
    var emptyTitle = isSupp ? 'No Supporting Departments Found' : (isProg ? 'No Programme Departments Found' : 'No Departments Found');
    var emptyDesc = isSupp ? 'No supporting departments found.' : (isProg ? 'No programme departments found.' : 'No departments have been added yet.');
    var addBtnText = isSupp ? '+ Add Supporting Department' : (isProg ? '+ Add Programme Department' : '+ Add Department');

    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:36px 18px;text-align:center;">'
      + '<span class="ei" style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:12px;background:var(--gLt);color:var(--gD);font-size:22px;margin-bottom:10px;"><re-icon icon="' + (isSupp ? 'book-open' : 'building2') + '"></re-icon></span>'
      + '<div style="font-weight:700;font-size:15px;color:var(--td);margin-bottom:4px;">' + emptyTitle + '</div>'
      + '<p style="font-size:13px;color:var(--tmu);max-width:500px;margin:0 auto 16px;">' + emptyDesc + '</p>'
      + '<button class="btn-pri btn-sm" onclick="om(\'m-add-dept\')">' + addBtnText + '</button>'
      + '</div>';
    return;
  }

  grid.innerHTML = activeList.map(function (dept) {
    var isClassesLoaded = _loaded.classes;
    var isSubjectsLoaded = _loaded.subjects;
    var isUsersLoaded = _loaded.users;

    var isSupporting = dept.category === 'supporting';
    var deptClasses = classes.filter(function (c) { return c.deptId === dept._id; });
    var deptSubjects = _getDeptSubjects(dept);
    var studyingClasses = isSupporting ? _getDeptStudyingClasses(dept) : [];

    var classCount = isClassesLoaded ? (isSupporting ? studyingClasses.length : deptClasses.length) : '<re-icon icon="hourglass"></re-icon>';
    var subjectCount = isSubjectsLoaded ? deptSubjects.length : '<re-icon icon="hourglass"></re-icon>';
    var studentCount = isClassesLoaded ? (isSupporting ? studyingClasses.reduce(function (sum, item) { return sum + (Number(item.cls.studentCount) || 0); }, 0) : deptClasses.reduce(function (sum, c) { return sum + (c.studentCount || 0); }, 0)) : '<re-icon icon="hourglass"></re-icon>';

    var allTch = (_teacherData && _teacherData.length) ? _teacherData : (DB.get('users') || []);
    var deptTeachers = allTch.filter(function (t) {
      var isTchRole = (t.role === 'teacher' || t.role === 'hod' || !t.role);
      var matchDept = String(t.deptId) === String(dept._id) || (t.dept && (t.dept === dept.name || t.dept === dept.code));
      return isTchRole && matchDept;
    });
    var teacherCount = isUsersLoaded ? deptTeachers.length : '<re-icon icon="hourglass"></re-icon>';

    var deptDesc = dept.description || (isSupporting ? 'Teaches courses to programme departments' : 'Runs its own classes and student batches');

    var heroHtml = '';
    if (isSupporting) {
      var allDepts = DB.get('depts') || [];
      var servedCodesSet = new Set();
      studyingClasses.forEach(function (item) {
        var c = item.cls;
        if (!c) return;
        var d = allDepts.find(function (dp) {
          return (c.deptId && String(dp._id) === String(c.deptId)) ||
                 (c.dept && (dp.name === c.dept || dp.code === c.dept)) ||
                 (c.deptCode && dp.code === c.deptCode) ||
                 (c.deptName && dp.name === c.deptName);
        });
        if (d && d.code && d.category !== 'supporting') {
          servedCodesSet.add(d.code);
        } else if (c.deptCode) {
          servedCodesSet.add(c.deptCode);
        }
      });
      var servedCodes = Array.from(servedCodesSet);
      var servedPills = servedCodes.length > 0
        ? servedCodes.map(function (cd) { return '<i>' + escapeHtml(cd) + '</i>'; }).join('')
        : '<i>All Programmes</i>';

      var servedHtml = '<div class="sv">'
        + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg> '
        + 'Serves ' + servedPills
        + '</div>';

      heroHtml = '<div class="hero">'
        + '<div><span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"></path></svg> Subjects offered</span><b>' + subjectCount + '</b></div>'
        + '<div><span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-6 8-6s8 2 8 6"></path></svg> Teachers</span><b>' + teacherCount + '</b></div>'
        + '</div>'
        + servedHtml;
    } else {
      heroHtml = '<div class="hero">'
        + '<div><span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg> Classes</span><b>' + classCount + '</b></div>'
        + '<div><span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9l10-5 10 5-10 5z"></path><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"></path></svg> Students</span><b>' + studentCount + '</b></div>'
        + '</div>'
        + '<div class="sc2">'
        + '<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"></path></svg> Subjects<b>' + subjectCount + '</b></span>'
        + '<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-6 8-6s8 2 8 6"></path></svg> Teachers<b>' + teacherCount + '</b></span>'
        + '</div>';
    }

    var hod = _getDeptHod(dept);
    var hodHtml = '';
    if (hod && hod.name) {
      var initials = _getHodInitials(hod.name);
      hodHtml = '<div class="hd2" onclick="event.stopPropagation(); openDeptAssignHod(\'' + dept._id + '\')" title="Manage HoD in Executive Roles & Access" style="cursor:pointer;">'
        + '<span class="av2">' + escapeHtml(initials) + '</span>'
        + '<span><b>' + escapeHtml(hod.name) + '</b><i>Head of Department</i></span>'
        + '</div>';
    } else {
      hodHtml = '<div class="hd2">'
        + '<span class="no">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 8h.01M11 12h1v5h1"></path></svg> '
        + 'No HoD assigned</span>'
        + '<button type="button" class="ab" onclick="event.stopPropagation(); openDeptAssignHod(\'' + dept._id + '\')">Assign HoD</button>'
        + '</div>';
    }

    return '<article class="dc' + (isSupporting ? ' sp' : '') + '" onclick="openDeptModal(\'' + dept._id + '\', \'overview\')">'
      + '<div class="tp">'
      + '  <i class="ib"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V5l8-3v19M12 9h8v12M2 21h20M8 8h1M8 12h1M8 16h1"></path></svg></i>'
      + '  <span class="cd">' + escapeHtml(dept.code || '') + '</span>'
      + '  <span class="tg">' + (isSupporting ? 'Supporting' : 'Programme') + '</span>'
      + '</div>'
      + '<small class="ey">' + (isSupporting ? 'SUPPORTING DEPARTMENT' : 'PROGRAMME DEPARTMENT') + '</small>'
      + '<h3>' + escapeHtml(dept.name || '') + '</h3>'
      + '<p class="ds">' + escapeHtml(deptDesc) + '</p>'
      + heroHtml
      + hodHtml
      + '</article>';
  }).join('');
}
var rdepts = renderDepartments; // alias
// Wrap dept mutations to auto-update badges
var _origRenderDepts = renderDepartments;
renderDepartments = function () { _origRenderDepts(); };

function openDeptAssignHod(deptId) {
  if (!deptId) return;

  // 1. Navigate to Executive Roles & Access tab
  nav('roles');

  // 2. Ensure executive tab is on 'departments'
  if (typeof switchExecutiveTab === 'function') {
    switchExecutiveTab('departments');
  }

  // 3. Open that department's popup (Manage Privileges drawer)
  var attempts = 0;
  function triggerDeptPopup() {
    attempts++;
    if (typeof window.openManagePrivilegesDrawer === 'function') {
      window.openManagePrivilegesDrawer(deptId, 'hod');
      setTimeout(function () {
        var dcard = document.getElementById('dcard-' + deptId);
        if (dcard && typeof dcard.scrollIntoView === 'function') {
          dcard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    } else if (attempts < 10) {
      setTimeout(triggerDeptPopup, 80);
    }
  }

  setTimeout(triggerDeptPopup, 120);
}
window.openDeptAssignHod = openDeptAssignHod;

function openDeptStructure(deptId, targetTab) {
  var dept = (DB.get('depts') || []).find(function (d) { return String(d._id) === String(deptId); });
  if (dept) {
    structureContext.deptId = dept._id;
    structureContext.deptName = dept.name;
    structureContext.deptCode = dept.code;
    structureContext.category = dept.category || 'programme';
  } else {
    structureContext.deptId = deptId;
    structureContext.category = 'programme';
  }
  if (targetTab) {
    window._pendingStructureTab = targetTab;
  }
  nav('struct');
  dtoDept(deptId, targetTab);
}
window.openDeptStructure = openDeptStructure;

function openDeptAddClass(deptId) {
  var targetDeptId = deptId || currentDeptId || (structureContext && structureContext.deptId);
  closeModalBg('m-edit-dept');
  var dept = (DB.get('depts') || []).find(function (d) { return String(d._id) === String(targetDeptId); });
  if (dept && dept.category === 'supporting') {
    showToast('Supporting departments do not manage class sections', 'info');
    return;
  }
  openDeptStructure(targetDeptId, 'classes');
  setTimeout(function () {
    if (typeof openAddClassModal === 'function') {
      openAddClassModal(targetDeptId);
    } else {
      om('m-add-class-quick');
    }
  }, 120);
}
window.openDeptAddClass = openDeptAddClass;

function openDeptAddSubject(deptId) {
  var targetDeptId = deptId || currentDeptId || (structureContext && structureContext.deptId);
  closeModalBg('m-edit-dept');
  openDeptStructure(targetDeptId, 'subjects');
  setTimeout(function () {
    if (typeof populateAdminDropdowns === 'function') populateAdminDropdowns();
    if (typeof openAddSubj === 'function') {
      openAddSubj();
    } else {
      om('m-add-subj-ctx');
    }
    var deptSel = document.getElementById('ns-dept');
    if (deptSel && targetDeptId) {
      deptSel.value = targetDeptId;
      if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('ns-dept');
    }
  }, 120);
}
window.openDeptAddSubject = openDeptAddSubject;

function openDeptAddTeacher(deptId) {
  var targetDeptId = deptId || currentDeptId || (structureContext && structureContext.deptId);
  closeModalBg('m-edit-dept');
  openDeptTeachers(targetDeptId);
  setTimeout(function () {
    if (typeof populateAdminDropdowns === 'function') populateAdminDropdowns();
    om('m-add-teacher');
    if (targetDeptId) {
      setTimeout(function () {
        var tDept = document.getElementById('t-dp');
        if (tDept) {
          tDept.value = targetDeptId;
          if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('t-dp');
          if (typeof buildTchTrackId === 'function') buildTchTrackId();
        }
      }, 50);
    }
  }, 120);
}
window.openDeptAddTeacher = openDeptAddTeacher;

// ─── UNIFIED DEPARTMENT MANAGEMENT MODULE (Overview, Classes, Curriculum, Faculty, Edit) ───
var currentDeptId = null;

function _updateDeptUnifiedModalHeader(dept) {
  var titleEl = document.getElementById('dm-ttl');
  var subEl = document.getElementById('dm-sub');
  if (!dept) return;

  var deptName = dept.name || 'Department';
  var deptCode = dept.code || 'DEPT';
  var courseType = dept.courseType || 'UG';
  var branch = dept.branch || 'Degree';
  var number = dept.number || dept.deptNum || '—';

  var isSupporting = dept.category === 'supporting';
  var catBadge = '<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;background:' + (isSupporting ? 'rgba(2,132,199,0.1)' : 'var(--gLt)') + ';color:' + (isSupporting ? '#0284c7' : 'var(--gD)') + ';letter-spacing:0.3px;">' + (isSupporting ? 'Supporting Department' : 'Programme Department') + '</span>';

  if (titleEl) {
    titleEl.innerHTML = '<re-icon icon="building2" size="20" style="flex-shrink:0;color:var(--gD);"></re-icon>'
      + '<span style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;font-family:\'Poppins\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-weight:700;">'
      + escapeHtml(deptName)
      + '<span style="font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:6px;background:var(--gLt);color:var(--gD);letter-spacing:0.3px;">' + escapeHtml(deptCode) + '</span>'
      + catBadge
      + '</span>';
  }

  if (subEl) {
    var line2Parts = [
      escapeHtml(courseType),
      escapeHtml(branch),
      'Dept #' + escapeHtml(number),
      'Code: ' + escapeHtml(deptCode)
    ];
    subEl.innerHTML = '<span style="font-family:\'Poppins\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-size:12px;font-weight:500;color:var(--tmu);line-height:1.35;display:inline-block;margin-top:2px;">'
      + line2Parts.join(' \u00b7 ')
      + '</span>';
  }
}

function switchDeptTab(tabName) {
  var tabs = ['overview', 'classes', 'subjects', 'faculty', 'edit'];
  tabs.forEach(function (t) {
    var btn = document.getElementById('dm-tab-btn-' + t);
    var panel = document.getElementById('dm-panel-' + t);
    if (btn) btn.classList.toggle('act', t === tabName);
    if (panel) panel.style.display = (t === tabName ? 'block' : 'none');
  });

  if (tabName === 'edit' && currentDeptId) {
    var dept = (DB.get('depts') || []).find(function (d) { return String(d._id) === String(currentDeptId); });
    if (dept) _populateEditDeptForm(dept);
  }
}
window.switchDeptTab = switchDeptTab;

function _populateEditDeptForm(dept) {
  if (!dept) return;
  document.getElementById('ed-id').value = dept._id || '';
  document.getElementById('ed-nm').value = dept.name || '';
  document.getElementById('ed-cd').value = dept.code || '';
  document.getElementById('ed-num').value = dept.number || dept.deptNum || '';
  var catEl = document.getElementById('ed-category');
  if (catEl) catEl.value = dept.category || 'programme';

  var coEl = document.getElementById('ed-cotype');
  var brEl = document.getElementById('ed-branch');
  if (coEl) {
    coEl.value = dept.courseType || 'UG';
    edUpdateBranch();
    if (brEl && dept.branch) brEl.value = dept.branch;
  }
}

function _renderDeptUnifiedOverview(dept) {
  var container = document.getElementById('dm-overview-content');
  if (!container || !dept) return;

  var isSupporting = (dept.category === 'supporting');
  var deptIdStr = String(dept._id);
  var deptName = dept.name || '';
  var deptCode = dept.code || '';

  var allCls = DB.get('classes') || [];
  var deptClasses = allCls.filter(function (c) {
    return String(c.deptId) === deptIdStr || (deptName && c.deptName === deptName);
  });

  var deptSubjects = _getDeptSubjects(dept);

  var allTch = _teacherData && _teacherData.length ? _teacherData : (DB.get('users') || []);
  var deptTeachers = allTch.filter(function (t) {
    return (t.role === 'teacher' || !t.role) &&
      (String(t.deptId) === deptIdStr || (t.dept && (t.dept === deptName || t.dept === deptCode)));
  });

  var studyingClasses = isSupporting ? _getDeptStudyingClasses(dept) : [];
  var displayClassesCount = isSupporting ? studyingClasses.length : deptClasses.length;

  var totalStudents = isSupporting
    ? studyingClasses.reduce(function (sum, item) { return sum + (Number(item.cls.studentCount) || 0); }, 0)
    : deptClasses.reduce(function (sum, c) { return sum + (Number(c.studentCount) || 0); }, 0);

  // Update badge counters
  var badgeCls = document.getElementById('dm-badge-cls');
  if (badgeCls) badgeCls.textContent = displayClassesCount;
  var badgeSubj = document.getElementById('dm-badge-subj');
  if (badgeSubj) badgeSubj.textContent = deptSubjects.length;
  var badgeTchr = document.getElementById('dm-badge-tchr');
  if (badgeTchr) badgeTchr.textContent = deptTeachers.length;

  // Classes quick preview list (programme departments only)
  var classesPreviewHtml = '';
  if (!isSupporting) {
    if (deptClasses.length) {
      classesPreviewHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:10px;">'
        + deptClasses.slice(0, 6).map(function (c) {
          return '<div style="padding:10px 12px;background:#fbfcfd;border:1px solid var(--br);border-radius:10px;display:flex;align-items:center;justify-content:space-between;">'
            + '<div>'
            + '  <div style="font-weight:700;font-size:13px;color:var(--td);">' + escapeHtml(c.name) + '</div>'
            + '  <div style="font-size:11px;color:var(--tmu);margin-top:2px;">Sec ' + escapeHtml(c.section || 'A') + ' · ' + escapeHtml(c.year || '—') + '</div>'
            + '</div>'
            + '<button type="button" class="btn-xs btn-out" onclick="closeModalBg(\'m-edit-dept\');openCD(\'' + c._id + '\', \'' + dept._id + '\')" title="Open Class Details" style="padding:3px 7px;"><re-icon icon="external-link" size="11"></re-icon></button>'
            + '</div>';
        }).join('')
        + '</div>';
    } else {
      classesPreviewHtml = '<div style="text-align:center;padding:16px;color:var(--tmu);font-size:12px;background:var(--bg2,#f8faf8);border-radius:8px;">No class sections registered in this department yet.</div>';
    }
  }

  // Teachers quick preview list
  var teachersPreviewHtml = '';
  if (deptTeachers.length) {
    teachersPreviewHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:10px;">'
      + deptTeachers.slice(0, 6).map(function (t) {
        var tInitial = ((t.name || '')[0] || 'T').toUpperCase();
        var tid = t._id || t.trackId;
        return '<div style="padding:10px 12px;background:#fbfcfd;border:1px solid var(--br);border-radius:10px;display:flex;align-items:center;justify-content:space-between;">'
          + '<div style="display:flex;align-items:center;gap:8px;min-width:0;">'
          + '  <div style="width:28px;height:28px;border-radius:50%;background:rgba(59,130,246,0.12);color:#2563eb;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + escapeHtml(tInitial) + '</div>'
          + '  <div style="min-width:0;">'
          + '    <div style="font-weight:700;font-size:12.5px;color:var(--td);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(t.name || 'Faculty') + '</div>'
          + '    <div style="font-size:10.5px;color:var(--tmu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(t.desig || t.designation || 'Faculty') + '</div>'
          + '  </div>'
          + '</div>'
          + '<button type="button" class="btn-xs btn-out" onclick="closeModalBg(\'m-edit-dept\');openTD(\'' + tid + '\')" title="Open Teacher Profile" style="padding:3px 7px;"><re-icon icon="external-link" size="11"></re-icon></button>'
          + '</div>';
      }).join('')
      + '</div>';
  } else {
    teachersPreviewHtml = '<div style="text-align:center;padding:16px;color:var(--tmu);font-size:12px;background:var(--bg2,#f8faf8);border-radius:8px;">No faculty members registered in this department yet.</div>';
  }

  var classesPreviewCardHtml = '';
  if (!isSupporting) {
    classesPreviewCardHtml =
      '<!-- 3. CLASSES PREVIEW CARD -->'
      + '<div class="subj-section-card">'
      + '  <div class="subj-section-hd">'
      + '    <div class="subj-section-title"><re-icon icon="chalkboard" size="14"></re-icon> <span>Registered Class Sections</span><span style="background:var(--gLt);color:var(--gD);font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:4px;">' + deptClasses.length + '</span></div>'
      + '    <button type="button" class="btn-xs btn-out" onclick="switchDeptTab(\'classes\')"><re-icon icon="list" size="12"></re-icon> Full Classes Tab</button>'
      + '  </div>'
      + '  <div class="subj-section-bd" style="padding:14px 18px;">'
      +      classesPreviewHtml
      + '  </div>'
      + '</div>';
  }

  container.innerHTML =
    '<!-- 1. STATS KPI GRID -->'
    + '<div class="subj-stats-grid">'
    + '  <div class="subj-stat-card stat-green" onclick="openDeptClasses(\'' + dept._id + '\')" style="cursor:pointer;" title="' + (isSupporting ? 'View active classes studying this department\'s subjects' : 'Explore classes in Class &amp; Subjects') + '">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Classes</span><div class="subj-stat-ic"><re-icon icon="chalkboard" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + displayClassesCount + ' <span class="subj-stat-unit">' + (displayClassesCount === 1 ? 'Cohort' : 'Cohorts') + '</span></div>'
    + '    <div class="subj-stat-sub">' + (isSupporting ? (displayClassesCount > 0 ? 'Active teaching cohorts' : 'No studying cohorts') : (deptClasses.length > 0 ? 'Active section cohorts' : 'No cohorts created')) + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-blue" onclick="openDeptSubjects(\'' + dept._id + '\')" style="cursor:pointer;" title="Explore curriculum in Class &amp; Subjects">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Curriculum</span><div class="subj-stat-ic"><re-icon icon="book-open" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + deptSubjects.length + ' <span class="subj-stat-unit">' + (deptSubjects.length === 1 ? 'Subject' : 'Subjects') + '</span></div>'
    + '    <div class="subj-stat-sub">' + (deptSubjects.length > 0 ? 'Registered degree courses' : 'Pending syllabus courses') + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-amber" onclick="openDeptTeachers(\'' + dept._id + '\')" style="cursor:pointer;" title="View department faculty in Teachers page">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Faculty</span><div class="subj-stat-ic"><re-icon icon="teacher" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + deptTeachers.length + ' <span class="subj-stat-unit">' + (deptTeachers.length === 1 ? 'Teacher' : 'Teachers') + '</span></div>'
    + '    <div class="subj-stat-sub">' + (deptTeachers.length > 0 ? 'Department academic staff' : 'No teachers assigned') + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-purple" onclick="openDeptStudents(\'' + dept._id + '\')" style="cursor:pointer;" title="View department students in Students page">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Students</span><div class="subj-stat-ic"><re-icon icon="graduation-cap" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + totalStudents + ' <span class="subj-stat-unit">Enrolled</span></div>'
    + '    <div class="subj-stat-sub">' + (totalStudents > 0 ? (isSupporting ? 'Studying enrolled students' : 'Registered student count') : 'No student enrollments') + '</div>'
    + '  </div>'
    + '</div>'
    + '<!-- 2. SPECIFICATIONS CARD -->'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd">'
    + '    <div class="subj-section-title"><re-icon icon="settings" size="14"></re-icon> <span>Department Specifications &amp; Governance</span></div>'
    + '    <button type="button" class="btn-xs btn-out" onclick="switchDeptTab(\'edit\')"><re-icon icon="edit" size="12"></re-icon> Edit Details</button>'
    + '  </div>'
    + '  <div class="subj-section-bd">'
    + '    <div class="subj-specs-grid">'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Department Name</span><span class="subj-spec-val" style="font-weight:700;">' + escapeHtml(dept.name || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Department Code</span><span class="subj-spec-val" style="font-family:monospace;letter-spacing:.3px;color:var(--gD);">' + escapeHtml(dept.code || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Dept Reg Number</span><span class="subj-spec-val">' + escapeHtml(dept.number || dept.deptNum || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Course Type</span><span class="subj-spec-val">' + escapeHtml(dept.courseType || 'UG') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Degree Branch</span><span class="subj-spec-val">' + escapeHtml(dept.branch || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Classification</span><span class="subj-spec-val" style="display:inline-flex;align-items:center;gap:6px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (dept.category === 'supporting' ? '#0284c7' : '#10b981') + ';"></span> ' + (dept.category === 'supporting' ? 'Supporting Department' : 'Programme Department') + '</span></div>'
    + '    </div>'
    + '  </div>'
    + '</div>'
    + '<!-- 2.5 QUICK LINKS CARD -->'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd">'
    + '    <div class="subj-section-title"><re-icon icon="bolt" size="14"></re-icon> <span>Quick Links</span></div>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:14px 18px;">'
    + '    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">'
    + '      <button type="button" class="btn btn-pri btn-sm" onclick="closeModalBg(\'m-edit-dept\');openDeptStructure(\'' + dept._id + '\')"><re-icon icon="folder" size="13"></re-icon> Explore</button>'
    + (isSupporting ? '' : '      <button type="button" class="btn btn-out btn-sm" onclick="openDeptAddClass(\'' + dept._id + '\')"><re-icon icon="plus" size="13"></re-icon> Add class</button>')
    + '      <button type="button" class="btn btn-out btn-sm" onclick="openDeptAddSubject(\'' + dept._id + '\')"><re-icon icon="book-open" size="13"></re-icon> Add subject</button>'
    + '      <button type="button" class="btn btn-out btn-sm" onclick="openDeptAddTeacher(\'' + dept._id + '\')"><re-icon icon="users" size="13"></re-icon> Add teachers</button>'
    + '      <button type="button" class="btn bdan bsm" style="margin-left:auto;" onclick="dDept(\'' + dept._id + '\')"><re-icon icon="trash2" size="13"></re-icon> Delete dept</button>'
    + '    </div>'
    + '  </div>'
    + '</div>'
    + classesPreviewCardHtml
    + '<!-- 4. FACULTY PREVIEW CARD -->'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd">'
    + '    <div class="subj-section-title"><re-icon icon="teacher" size="14"></re-icon> <span>Department Faculty</span><span style="background:var(--gLt);color:var(--gD);font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:4px;">' + deptTeachers.length + '</span></div>'
    + '    <button type="button" class="btn-xs btn-out" onclick="switchDeptTab(\'faculty\')"><re-icon icon="users" size="12"></re-icon> Full Faculty Tab</button>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:14px 18px;">'
    +      teachersPreviewHtml
    + '  </div>'
    + '</div>'
    + '<!-- 5. FOOTER ACTION TOOLBAR -->'
    + '<div class="subj-overview-ft">'
    + '  <button type="button" class="btn bdan bsm" onclick="dDept(\'' + dept._id + '\')"><re-icon icon="trash2" size="14"></re-icon> Delete Department</button>'
    + '  <div style="display:flex;gap:10px;align-items:center;">'
    + '    <button type="button" class="btn-out bsm" onclick="switchDeptTab(\'edit\')"><re-icon icon="edit" size="14"></re-icon> Edit Details</button>'
    + '    <button type="button" class="btn-pri bsm" onclick="closeModalBg(\'m-edit-dept\');openDeptStructure(\'' + dept._id + '\')"><re-icon icon="folder" size="14"></re-icon> Explore Structure</button>'
    + '  </div>'
    + '</div>';
}

function openDeptClasses(deptId) {
  var dept = (DB.get('depts') || []).find(function (x) { return String(x._id) === String(deptId); });
  if (dept && dept.category === 'supporting') {
    switchDeptTab('classes');
    return;
  }
  closeModalBg('m-edit-dept');
  openDeptStructure(deptId, 'classes');
}
window.openDeptClasses = openDeptClasses;

function openDeptSubjects(deptId) {
  closeModalBg('m-edit-dept');
  openDeptStructure(deptId, 'subjects');
}
window.openDeptSubjects = openDeptSubjects;

function openDeptTeachers(deptId) {
  closeModalBg('m-edit-dept');
  if (window._currentPage === 'teachers') {
    var deptFilter = document.getElementById('tf-dept');
    if (deptFilter && !deptFilter.disabled) {
      deptFilter.value = deptId || '';
      if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('tf-dept');
      onTeacherDeptChange();
    }
  } else {
    window._pendingTeacherDeptId = deptId;
    nav('teachers');
  }
}
window.openDeptTeachers = openDeptTeachers;

function openDeptStudents(deptId) {
  closeModalBg('m-edit-dept');
  applyStudentFilter({
    deptId: deptId,
    batch: '',
    courseType: '',
    classId: '',
    autoShow: true
  });
}
window.openDeptStudents = openDeptStudents;

function _renderDeptClassesTab(dept) {
  var container = document.getElementById('dm-classes-container');
  if (!container || !dept) return;

  var isSupporting = (dept.category === 'supporting');

  // Sync banner and Add button
  var bannerText = document.getElementById('dm-classes-banner-text');
  var addBtn = document.getElementById('dm-classes-add-btn');
  if (bannerText) {
    bannerText.textContent = isSupporting
      ? 'Active cohorts and sections from other departments studying courses offered by ' + (dept.name || 'this department') + '.'
      : 'Active cohorts and section groups registered under this department.';
  }
  if (addBtn) {
    addBtn.style.display = isSupporting ? 'none' : '';
  }

  if (isSupporting) {
    var studyingClasses = _getDeptStudyingClasses(dept);

    if (!studyingClasses.length) {
      container.innerHTML = '<div style="text-align:center;padding:32px 18px;color:var(--tmu);font-size:13px;background:var(--bg2,#f8faf8);">'
        + '<re-icon icon="chalkboard" size="24" style="color:var(--tdi);margin-bottom:6px;"></re-icon>'
        + '<div>No active classes currently studying this department\'s subjects.</div>'
        + '</div>';
      return;
    }

    var rowsHtml = studyingClasses.map(function (entry, idx) {
      var c = entry.cls;
      var stus = (c.studentCount != null && c.studentCount !== '' && !isNaN(c.studentCount)) ? c.studentCount : 0;
      var yearSem = (c.year || '—') + (c.sem ? ' · Sem ' + c.sem : '');

      var subjectsHtml = entry.subjectsList.map(function (s) {
        return '<span style="font-weight:600;color:var(--gD);background:var(--gLt);padding:2px 8px;border-radius:6px;font-size:11.5px;display:inline-block;margin:1px 2px;">' + escapeHtml(s) + '</span>';
      }).join(' ');

      return '<tr style="border-bottom:1px solid var(--br);">'
        + '<td style="padding:10px 14px;font-size:12px;color:var(--tmu);font-weight:600;width:38px;">' + (idx + 1) + '</td>'
        + '<td style="padding:10px 14px;font-weight:700;color:var(--td);font-size:13px;">'
        + '  <div>' + escapeHtml(c.name) + '</div>'
        + (c.deptName ? '  <div style="font-size:11px;color:var(--tmu);font-weight:400;margin-top:2px;">' + escapeHtml(c.deptName) + '</div>' : '')
        + '</td>'
        + '<td style="padding:10px 14px;font-size:12.5px;color:var(--td);">' + escapeHtml(yearSem) + '</td>'
        + '<td style="padding:10px 14px;font-weight:700;color:var(--td);">' + stus + '</td>'
        + '<td style="padding:10px 14px;">' + subjectsHtml + '</td>'
        + '<td style="padding:10px 14px;text-align:right;">'
        + '  <button type="button" class="btn-xs btn-out" onclick="closeModalBg(\'m-edit-dept\');openCD(\'' + c._id + '\', \'' + dept._id + '\')"><re-icon icon="eye" size="12"></re-icon> View Class</button>'
        + '</td>'
        + '</tr>';
    }).join('');

    container.innerHTML = '<table class="tbl" style="width:100%;margin:0;border-collapse:collapse;">'
      + '<thead><tr style="background:#f8fafc;border-bottom:1px solid var(--br);">'
      + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;width:38px;">#</th>'
      + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Class Name</th>'
      + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Year &amp; Sem</th>'
      + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Students</th>'
      + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Subject Name</th>'
      + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:right;text-transform:uppercase;">Actions</th>'
      + '</tr></thead>'
      + '<tbody>' + rowsHtml + '</tbody>'
      + '</table>';
    return;
  }

  var allCls = DB.get('classes') || [];
  var deptClasses = allCls.filter(function (c) {
    return String(c.deptId) === String(dept._id) || (dept.name && c.deptName === dept.name);
  });

  if (!deptClasses.length) {
    container.innerHTML = '<div style="text-align:center;padding:32px 18px;color:var(--tmu);font-size:13px;background:var(--bg2,#f8faf8);">'
      + '<re-icon icon="chalkboard" size="24" style="color:var(--tdi);margin-bottom:6px;"></re-icon>'
      + '<div>No class cohorts or sections registered under this department yet.</div>'
      + '</div>';
    return;
  }

  var rowsHtml = deptClasses.map(function (c, idx) {
    var displayHall = (c.roomId && c.roomId.hallNo) || c.hallNo || '—';
    var stus = (c.studentCount != null && c.studentCount !== '' && !isNaN(c.studentCount)) ? c.studentCount : 0;
    return '<tr style="border-bottom:1px solid var(--br);">'
      + '<td style="padding:10px 14px;font-size:12px;color:var(--tmu);font-weight:600;width:38px;">' + (idx + 1) + '</td>'
      + '<td style="padding:10px 14px;font-weight:700;color:var(--td);font-size:13px;">' + escapeHtml(c.name) + '</td>'
      + '<td style="padding:10px 14px;font-size:12.5px;color:var(--td);">' + escapeHtml(c.batch || '—') + '</td>'
      + '<td style="padding:10px 14px;font-size:12.5px;color:var(--td);">' + escapeHtml(c.year || '—') + ' · Sem ' + escapeHtml(c.sem || '—') + '</td>'
      + '<td style="padding:10px 14px;"><span style="font-weight:700;padding:2px 8px;border-radius:6px;background:var(--gLt);color:var(--gD);font-size:11.5px;">Sec ' + escapeHtml(c.section || 'A') + '</span></td>'
      + '<td style="padding:10px 14px;font-size:12px;color:var(--tmu);"><re-icon icon="pin" size="12"></re-icon> ' + escapeHtml(displayHall) + '</td>'
      + '<td style="padding:10px 14px;font-weight:700;color:var(--td);">' + stus + '</td>'
      + '<td style="padding:10px 14px;text-align:right;">'
      + '  <button type="button" class="btn-xs btn-out" onclick="closeModalBg(\'m-edit-dept\');openCD(\'' + c._id + '\', \'' + dept._id + '\')"><re-icon icon="eye" size="12"></re-icon> View Class</button>'
      + '</td>'
      + '</tr>';
  }).join('');

  container.innerHTML = '<table class="tbl" style="width:100%;margin:0;border-collapse:collapse;">'
    + '<thead><tr style="background:#f8fafc;border-bottom:1px solid var(--br);">'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">#</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Class Name</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Batch</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Year &amp; Sem</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Section</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Room</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Students</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:right;text-transform:uppercase;">Action</th>'
    + '</tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody>'
    + '</table>';
}

function _renderDeptSubjectsTab(dept) {
  var container = document.getElementById('dm-subjects-container');
  if (!container || !dept) return;

  var deptSubjects = _getDeptSubjects(dept);

  if (!deptSubjects.length) {
    container.innerHTML = '<div style="text-align:center;padding:32px 18px;color:var(--tmu);font-size:13px;background:var(--bg2,#f8faf8);">'
      + '<re-icon icon="book-open" size="24" style="color:var(--tdi);margin-bottom:6px;"></re-icon>'
      + '<div>No curriculum course subjects registered under this department yet.</div>'
      + '</div>';
    return;
  }

  var rowsHtml = deptSubjects.map(function (s, idx) {
    var code = s.courseCode || s.code || s.shortForm || '—';
    var type = s.type || 'Theory';
    var typeLower = type.toLowerCase();
    return '<tr style="border-bottom:1px solid var(--br);">'
      + '<td style="padding:10px 14px;font-size:12px;color:var(--tmu);font-weight:600;width:38px;">' + (idx + 1) + '</td>'
      + '<td style="padding:10px 14px;">'
      + '  <div style="font-weight:700;color:var(--td);font-size:13px;">' + escapeHtml(s.name) + '</div>'
      + '  <div style="font-size:11px;font-family:monospace;color:var(--gD);margin-top:2px;">' + escapeHtml(code) + '</div>'
      + '</td>'
      + '<td style="padding:10px 14px;"><span class="subj-type-badge ' + (typeLower === 'lab' ? 'lab' : 'theory') + '" style="font-size:11.5px;padding:2px 8px;">' + escapeHtml(type) + '</span></td>'
      + '<td style="padding:10px 14px;font-weight:700;color:var(--td);">' + (s.credits != null ? s.credits : '3') + ' Credits</td>'
      + '<td style="padding:10px 14px;font-size:12px;color:var(--tmu);">' + escapeHtml(s.regulation || '2025') + '</td>'
      + '<td style="padding:10px 14px;text-align:right;">'
      + '  <button type="button" class="btn-xs btn-out" onclick="closeModalBg(\'m-edit-dept\');openSD(\'' + s._id + '\')"><re-icon icon="eye" size="12"></re-icon> View Subject</button>'
      + '</td>'
      + '</tr>';
  }).join('');

  container.innerHTML = '<table class="tbl" style="width:100%;margin:0;border-collapse:collapse;">'
    + '<thead><tr style="background:#f8fafc;border-bottom:1px solid var(--br);">'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">#</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Subject Name</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Type</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Credits</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Regulation</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:right;text-transform:uppercase;">Action</th>'
    + '</tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody>'
    + '</table>';
}

function _renderDeptFacultyTab(dept) {
  var container = document.getElementById('dm-faculty-container');
  if (!container || !dept) return;

  var allTch = _teacherData && _teacherData.length ? _teacherData : (DB.get('users') || []);
  var deptTeachers = allTch.filter(function (t) {
    return (t.role === 'teacher' || !t.role) &&
      (String(t.deptId) === String(dept._id) || (t.dept && (t.dept === dept.name || t.dept === dept.code)));
  });

  if (!deptTeachers.length) {
    container.innerHTML = '<div style="text-align:center;padding:32px 18px;color:var(--tmu);font-size:13px;background:var(--bg2,#f8faf8);">'
      + '<re-icon icon="teacher" size="24" style="color:var(--tdi);margin-bottom:6px;"></re-icon>'
      + '<div>No teaching faculty members registered under this department yet.</div>'
      + '</div>';
    return;
  }

  var rowsHtml = deptTeachers.map(function (t, idx) {
    var tid = t._id || t.trackId;
    var tInitial = ((t.name || '')[0] || 'T').toUpperCase();
    return '<tr style="border-bottom:1px solid var(--br);">'
      + '<td style="padding:10px 14px;font-size:12px;color:var(--tmu);font-weight:600;width:38px;">' + (idx + 1) + '</td>'
      + '<td style="padding:10px 14px;">'
      + '  <div style="font-weight:700;color:var(--td);font-size:13px;display:flex;align-items:center;gap:8px;">'
      + '    <span style="width:24px;height:24px;border-radius:50%;background:rgba(59,130,246,0.12);color:#2563eb;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;">' + escapeHtml(tInitial) + '</span>'
      + '    <span>' + escapeHtml(t.name || 'Faculty') + '</span>'
      + '  </div>'
      + '</td>'
      + '<td style="padding:10px 14px;font-family:monospace;font-size:12.5px;color:var(--td);">' + escapeHtml(t.empId || t.employeeNo || '—') + '</td>'
      + '<td style="padding:10px 14px;font-size:12.5px;color:var(--td);">' + escapeHtml(t.desig || t.designation || 'Faculty') + '</td>'
      + '<td style="padding:10px 14px;font-size:12px;color:var(--tmu);">' + escapeHtml(t.email || '—') + '</td>'
      + '<td style="padding:10px 14px;text-align:right;">'
      + '  <button type="button" class="btn-xs btn-out" onclick="closeModalBg(\'m-edit-dept\');openTD(\'' + tid + '\')"><re-icon icon="eye" size="12"></re-icon> View Faculty</button>'
      + '</td>'
      + '</tr>';
  }).join('');

  container.innerHTML = '<table class="tbl" style="width:100%;margin:0;border-collapse:collapse;">'
    + '<thead><tr style="background:#f8fafc;border-bottom:1px solid var(--br);">'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">#</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Faculty Name</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Employee ID</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Designation</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Email</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:right;text-transform:uppercase;">Action</th>'
    + '</tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody>'
    + '</table>';
}

function openDeptModal(deptId, initialTab) {
  var dept = (DB.get('depts') || []).find(function (x) { return String(x._id) === String(deptId); });
  if (!dept) return;
  currentDeptId = deptId;
  if (window._currentPage === 'depts') {
    updateStructureUrlParams({ depts: deptId });
  }

  // 1. Header
  _updateDeptUnifiedModalHeader(dept);

  // 2. Tab contents
  _renderDeptUnifiedOverview(dept);
  _renderDeptClassesTab(dept);
  _renderDeptSubjectsTab(dept);
  _renderDeptFacultyTab(dept);
  _populateEditDeptForm(dept);

  // 3. Switch to target tab (default: overview)
  switchDeptTab(initialTab || 'overview');

  openModal_('m-edit-dept');

  // If supporting department, ensure assignments and classes are synced
  if (dept.category === 'supporting') {
    ensureLoaded(['assignments', 'classes', 'subjects']).then(function () {
      var curDept = (DB.get('depts') || []).find(function (x) { return String(x._id) === String(deptId); }) || dept;
      _renderDeptUnifiedOverview(curDept);
      _renderDeptClassesTab(curDept);
      _renderDeptSubjectsTab(curDept);
    });
  }
}
window.openDeptModal = openDeptModal;

function editDept(deptId) {
  openDeptModal(deptId, 'edit');
}
window.editDept = editDept;

function saveEditDept() {
  var id = document.getElementById('ed-id').value;
  var name = getFieldValue('ed-nm');
  var code = getFieldValue('ed-cd');
  var number = getFieldValue('ed-num');
  var category = document.getElementById('ed-category') ? document.getElementById('ed-category').value : 'programme';
  var courseType = document.getElementById('ed-cotype') ? document.getElementById('ed-cotype').value : 'UG';
  var branch = document.getElementById('ed-branch') ? document.getElementById('ed-branch').value : 'B.E';
  if (!name || !code) { showToast('Department name and code are required', 'warn'); return; }
  if (number && !/^\d{3}$/.test(number)) { showToast('Department Number must be exactly 3 digits', 'warn'); return; }
  if (!courseType || !branch) { showToast('Course Type and Branch are required', 'warn'); return; }
  dbToast('Updating department…', 'saving', '"' + name + '"');
  apiUpdateDept(id, name, code, number, courseType, branch, category).then(function (d) {
    if (!d) return;
    addLog('Department Updated', '"' + name + '" (' + code + ')');
    renderDepartments();
    if (typeof window.loadExecutiveRolesOverview === 'function') {
      window.loadExecutiveRolesOverview();
    }
    openDeptModal(id, 'overview');
    dbToast('Department updated', 'success', '"' + name + '" <re-icon icon="arrow-right"></re-icon> Database');
  });
}
window.saveEditDept = saveEditDept;

function addDept() {
  var name = getFieldValue('dept-name');
  var twoLetterCode = getFieldValue('dept-2code').toLowerCase();
  var code = getFieldValue('dept-code').toUpperCase();
  var number = getFieldValue('dept-number');
  var category = document.getElementById('dept-category') ? document.getElementById('dept-category').value : 'programme';
  var courseType = document.getElementById('co-type') ? document.getElementById('co-type').value : '';
  var branch = document.getElementById('branch') ? document.getElementById('branch').value : '';
  if (!name) { showToast('Department name is required', 'warn'); return; }
  if (!twoLetterCode) { showToast('2-Letter code required (e.g. cs)', 'warn'); return; }
  if (!code) { showToast('3-Letter code required (e.g. CSE)', 'warn'); return; }
  if (!number || !/^\d{3}$/.test(number)) { showToast('3-digit register number required', 'warn'); return; }
  if (!courseType || !branch) { showToast('Course Type and Branch required', 'warn'); return; }
  dbToast('Adding department…', 'saving', '"' + name + '"');
  apiAddDept(name, code, number, twoLetterCode, courseType, branch, category).then(function (d) {
    if (!d) return;
    closeModalBg('m-add-dept');
    renderDepartments();
    populateAdminDropdowns();
    syncBadgesFromAPI();
    addLog('Department Added', '"' + name + '" (' + code + ') 2L=' + twoLetterCode + ' regCode=' + number);
    dbToast('Department added', 'success', '"' + name + '" <re-icon icon="arrow-right"></re-icon> Database');
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
var structureContext = { deptId: null, deptName: '', deptCode: '', sem: null, category: 'programme' };
var currentClassId = null;
var currentTeacherId = null;
var _emptyStateFired = {};

function resetStructureState() {
  if (isCurrentUserSuperAdmin()) {
    var dInfo = getCurrentUserDeptInfo();
    var found = (DB.get('depts') || []).find(function (d) { return String(d._id) === String(dInfo.id) || d.name === dInfo.name; });
    structureContext = { deptId: dInfo.id, deptName: dInfo.name, deptCode: (found ? found.code : ''), sem: null, category: (found && found.category) || 'programme' };
    return;
  }
  structureContext = { deptId: null, deptName: '', deptCode: '', sem: null, category: 'programme' };
  currentClassId = null;
  currentTeacherId = null;
  updateStructureUrlParams({ depts: null, cls: null, subj: null });
}
var rstruct = resetStructureState;

function showStructureView(viewName) {
  if (isCurrentUserSuperAdmin() && viewName === 'dept') {
    viewName = 'cs';
  }
  ['dept', 'cs'].forEach(function (v) {
    var el = document.getElementById('sv-' + v);
    if (el) el.style.display = 'none';
  });
  var target = document.getElementById('sv-' + viewName);
  if (target) target.style.display = 'block';
  var statsEl = document.getElementById('cls-stat-cards');
  if (statsEl) statsEl.style.display = viewName === 'cs' ? '' : 'none';
  updateBreadcrumb();
  if (viewName === 'cs') {
    setTimeout(function () {
      if (typeof updateStructureTabIndicator === 'function') {
        updateStructureTabIndicator(false);
      }
    }, 20);
  }
}
var showSV = showStructureView;

function updateBreadcrumb() {
  var breadcrumb = document.getElementById('sbc');
  if (!breadcrumb) return;

  var isSuper = isCurrentUserSuperAdmin();

  if (isSuper) {
    var dInfo = getCurrentUserDeptInfo();
    var dName = structureContext.deptName || dInfo.name || 'Department';
    var dCode = structureContext.deptCode;
    if (!dName || /^[0-9a-fA-F]{24}$/.test(dName)) {
      var targetId = structureContext.deptId || dInfo.id || dName;
      var depts = DB.get('depts') || [];
      var matched = depts.find(function (d) { return String(d._id) === String(targetId) || String(d.id) === String(targetId); });
      if (matched) {
        if (matched.name) dName = matched.name;
        if (matched.code) dCode = matched.code;
      } else {
        dName = dInfo.name || 'Department';
      }
    }
    var superBadge = dCode ? '<span class="bcc-code">' + escapeHtml(dCode) + '</span>' : '';
    breadcrumb.style.display = 'flex';
    breadcrumb.innerHTML =
      '<div class="bcrumb-trail">' +
        '<span class="bci" style="cursor:default;"><re-icon icon="building2" size="13"></re-icon> <span>Departments</span></span>' +
        '<span class="bcs"><re-icon icon="chevron-right" size="12"></re-icon></span>' +
        '<span class="bcc"><re-icon icon="folder" size="13"></re-icon> <span>' + escapeHtml(dName) + '</span>' + superBadge + '</span>' +
      '</div>';
    return;
  }

  // Hide breadcrumb when at root departments selector
  if (!structureContext.deptId) {
    breadcrumb.style.display = 'none';
    breadcrumb.innerHTML = '';
    return;
  }

  var dName = structureContext.deptName;
  var dCode = structureContext.deptCode;
  var isSupporting = structureContext.category === 'supporting';
  var depts = DB.get('depts') || [];
  var matched = depts.find(function (d) { return String(d._id) === String(structureContext.deptId); });
  if (matched) {
    if (!dName || /^[0-9a-fA-F]{24}$/.test(dName)) dName = matched.name;
    if (!dCode) dCode = matched.code;
    if (matched.category) isSupporting = matched.category === 'supporting';
  }
  dName = dName || 'Department';

  var codeBadge = dCode ? '<span class="bcc-code">' + escapeHtml(dCode) + '</span>' : '';
  var catBadge = isSupporting ? '<span class="bcc-cat">Supporting</span>' : '';

  breadcrumb.style.display = 'flex';
  breadcrumb.innerHTML =
    '<button type="button" class="bcrumb-back-btn" onclick="rstruct();rsdv();" title="Back to Departments" aria-label="Back to Departments">' +
      '<re-icon icon="arrow-left" size="14"></re-icon>' +
      '<span>Back</span>' +
    '</button>' +
    '<div class="bcrumb-divider"></div>' +
    '<div class="bcrumb-trail">' +
      '<span class="bci" onclick="rstruct();rsdv();" title="View all departments">' +
        '<re-icon icon="building2" size="13"></re-icon>' +
        '<span>Departments</span>' +
      '</span>' +
      '<span class="bcs"><re-icon icon="chevron-right" size="12"></re-icon></span>' +
      '<span class="bcc">' +
        '<re-icon icon="folder" size="13"></re-icon>' +
        '<span class="bcc-name">' + escapeHtml(dName) + '</span>' +
        codeBadge +
        catBadge +
      '</span>' +
    '</div>';
}
var ubc = updateBreadcrumb;

function _renderDeptStats(depts) {
  var el = document.getElementById('stats-dept');
  if (!el) return;
  var list = Array.isArray(depts) ? depts : [];
  var d = _counts;
  var cards = [
    { label: 'Total Departments', val: list.length || d.depts || 0, icon: '<re-icon icon="building2"></re-icon>', cls: 'amber', id: 'dept-stat-depts' },
    { label: 'Total Classes', val: d.classes !== undefined && d.classes !== null ? d.classes : (_loaded.classes ? DB.get('classes').length : '<re-icon icon="hourglass"></re-icon>'), icon: '<re-icon icon="chalkboard"></re-icon>', cls: 'purple', id: 'dept-stat-classes' },
    { label: 'Total Students', val: d.students !== undefined && d.students !== null ? d.students : '<re-icon icon="hourglass"></re-icon>', icon: '<re-icon icon="graduation-cap"></re-icon>', cls: 'blue', id: 'dept-stat-students' },
    { label: 'Total Teachers', val: d.teachers !== undefined && d.teachers !== null ? d.teachers : (_loaded.users ? DB.get('users').filter(function (u) { return u.role === 'teacher'; }).length : '<re-icon icon="hourglass"></re-icon>'), icon: '<re-icon icon="teacher"></re-icon>', cls: 'orange', id: 'dept-stat-teachers' }
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
  if (clsPageBtn) clsPageBtn.style.display = structureContext.deptId ? 'flex' : 'none';

  grid.className = 'tgrd';

  if (!depts.length) {
    grid.innerHTML =
      '<div class="emst">' +
      '<span class="emico"><re-icon icon="building2"></re-icon></span>' +
      '<div class="emtx">No department found. Add one first.</div>' +
      '</div>';

    if (!structureContext.deptId) {
      showStructureView('dept');
    }
    return;
  }

  _emptyStateFired.deptSelector = false;

  grid.innerHTML = depts.map(function (dept) {
    var isSupporting = dept.category === 'supporting';
    var classCount = _loaded.classes ? classes.filter(function (c) { return c.deptId === dept._id; }).length : '<re-icon icon="hourglass"></re-icon>';
    var subjectCount = _loaded.subjects ? subjects.filter(function (s) { return getSubjectDeptId(s) === String(dept._id); }).length : '<re-icon icon="hourglass"></re-icon>';
    var catBadge = '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px;background:' + (isSupporting ? 'rgba(2,132,199,0.1)' : 'var(--gLt)') + ';color:' + (isSupporting ? '#0284c7' : 'var(--gD)') + ';border:1px solid ' + (isSupporting ? 'rgba(2,132,199,0.25)' : 'rgba(16,185,129,0.25)') + ';">' + (isSupporting ? 'Supporting' : 'Programme') + '</span>';

    var statsHtml = isSupporting
      ? '<div class="tsts"><div class="tst2" style="width:100%"><div class="tst2-head"><re-icon icon="book-open" size="13"></re-icon>Curriculum Subjects</div><span class="tst2-val">' + subjectCount + '</span></div></div>'
      : '<div class="tsts tsts-2col"><div class="tst2"><div class="tst2-head"><re-icon icon="layout-grid" size="13"></re-icon>Classes</div><span class="tst2-val">' + classCount + '</span></div><div class="tst2"><div class="tst2-head"><re-icon icon="book-open" size="13"></re-icon>Subjects</div><span class="tst2-val">' + subjectCount + '</span></div></div>';

    return '<div class="tcrd dcrd dcrd-selector" onclick="dtoDept(\'' + dept._id + '\')">'
      + '<div class="tcrd-head">'
      + '<div class="tav" style="font-size:20px;">' + deptIcon(dept.icon) + '</div>'
      + '<div style="display:flex;align-items:center;gap:6px;"><span class="tcrd-code">' + (dept.code || '') + '</span>' + catBadge + '</div>'
      + '</div>'
      + '<div class="tcrd-label">' + (isSupporting ? 'Supporting Department' : 'Department') + '</div>'
      + '<div class="tnm" title="' + (dept.name || '') + '">' + (dept.name || '—') + '</div>'
      + statsHtml
      + '<button class="tcrd-explore btn btn-pri btn-sm" type="button" tabindex="-1">'
      + '<span class="tcrd-explore-left"><re-icon icon="folder" size="13"></re-icon>' + (isSupporting ? 'Explore subjects' : 'Explore department') + '</span>'
      + '<span class="tcrd-explore-arrow">→</span>'
      + '</button>'
      + '</div>';
  }).join('');

  if (!structureContext.deptId) {
    showStructureView('dept');
  } else {
    showStructureView('cs');
  }
}
var rsdv = renderDepartmentSelector;

function _applyDeptCategoryUI() {
  var isSupporting = structureContext && structureContext.category === 'supporting';

  // 1. Classes / Subjects toggle tabs
  var classTab = document.getElementById('cs-tab-classes');
  var subjTab = document.getElementById('cs-tab-subjects');
  if (classTab) {
    classTab.style.display = isSupporting ? 'none' : '';
  }

  // 2. Action buttons in page header
  var addClassBtn = document.getElementById('hdr-add-class');
  var addSubjBtn = document.getElementById('hdr-add-subj');
  if (addClassBtn) {
    addClassBtn.style.display = isSupporting ? 'none' : '';
  }

  // 3. Select active tab
  if (isSupporting) {
    if (addSubjBtn) addSubjBtn.className = 'btn-pri';
    switchStructureTab('subjects');
  } else {
    var isSubjActive = document.getElementById('sp-subjects') && document.getElementById('sp-subjects').style.display !== 'none';
    switchStructureTab(isSubjActive ? 'subjects' : 'classes');
  }
}
window._applyDeptCategoryUI = _applyDeptCategoryUI;

function dtoDept(deptId, targetTab) {
  var dept = DB.get('depts').find(function (d) { return d._id === deptId; });
  if (!dept) return;
  structureContext.deptId = deptId;
  structureContext.deptName = dept.name;
  structureContext.deptCode = dept.code;
  structureContext.category = dept.category || 'programme';
  renderClassSubjectView(deptId);
  showStructureView('cs');
  _applyDeptCategoryUI();
  var clsPageBtn = document.getElementById('cls-page-btn');
  if (clsPageBtn) clsPageBtn.style.display = 'flex';
  updateStructureUrlParams({ depts: deptId, cls: null, subj: null });
  if (targetTab) {
    switchStructureTab(targetTab);
  }
}
window.dtoDept = dtoDept;

function _renderClassStats() {
  var el = document.getElementById('cls-stat-cards');
  if (!el) return;
  var deptId = structureContext.deptId;
  var isSupporting = structureContext && structureContext.category === 'supporting';

  var allSubjects = DB.get('subjects').filter(function (s) { return !deptId || getSubjectDeptId(s) === String(deptId); }) || [];
  var totalSubjects = _loaded.subjects ? allSubjects.length : (_counts.subjects || '<re-icon icon="hourglass"></re-icon>');

  var cards;
  if (isSupporting) {
    var subjIds = allSubjects.map(function (s) { return String(s._id); });
    var allAsgns = DB.get('assignments') || [];
    var deptTeachers = [];

    // Distinct teachers mapped to this department's subjects
    allAsgns.forEach(function (a) {
      if (subjIds.includes(String(a.subjectId)) && a.teacherId && !deptTeachers.includes(String(a.teacherId))) {
        deptTeachers.push(String(a.teacherId));
      }
    });

    // Also include faculty members registered directly in this department
    var deptStaff = (DB.get('users') || []).filter(function (u) {
      return u.role === 'teacher' && (u.dept === structureContext.deptName || String(u.deptId) === String(deptId));
    });
    deptStaff.forEach(function (u) {
      if (!deptTeachers.includes(String(u._id))) deptTeachers.push(String(u._id));
    });
    var facultyCount = _loaded.users || _loaded.assignments ? deptTeachers.length : (_counts.teachers || 0);

    // Card 3: Total Credits across all subjects in this department
    var totalCredits = allSubjects.reduce(function (sum, s) {
      return sum + (Number(s.credits) || 0);
    }, 0);

    // Card 4: Total active teaching allocations for this department's subjects
    var deptAsgns = allAsgns.filter(function (a) {
      return subjIds.includes(String(a.subjectId));
    });
    var allocationsCount = _loaded.assignments ? deptAsgns.length : 0;

    cards = [
      { label: 'Total Subjects', val: totalSubjects, icon: '<re-icon icon="book-open"></re-icon>', cls: 'purple', id: 'cls-stat-subjects' },
      { label: 'Faculty Instructors', val: facultyCount, icon: '<re-icon icon="teacher"></re-icon>', cls: 'amber', id: 'cls-stat-teachers' },
      { label: 'Total Credits', val: totalCredits, icon: '<re-icon icon="graduation-cap"></re-icon>', cls: 'green', id: 'cls-stat-credits' },
      { label: 'Teaching Allocations', val: allocationsCount, icon: '<re-icon icon="clipboard-list"></re-icon>', cls: 'blue', id: 'cls-stat-assignments' }
    ];
  } else {
    var allClasses = DB.get('classes').filter(function (c) { return !deptId || c.deptId === deptId; }) || [];
    var totalClasses = _loaded.classes ? allClasses.length : (_counts.classes || '<re-icon icon="hourglass"></re-icon>');
    var totalStudents = _loaded.classes ? allClasses.reduce(function (sum, c) { return sum + (c.studentCount || 0); }, 0) : (_counts.students || '<re-icon icon="hourglass"></re-icon>');
    var totalAssignments = _loaded.assignments ? DB.get('assignments').filter(function (a) {
      return allClasses.some(function (c) { return c._id === a.classId; });
    }).length : (_counts.assignments || '<re-icon icon="hourglass"></re-icon>');

    cards = [
      { label: 'Total Classes', val: totalClasses, icon: '<re-icon icon="chalkboard"></re-icon>', cls: 'amber', id: 'cls-stat-classes' },
      { label: 'Total Subjects', val: totalSubjects, icon: '<re-icon icon="book-open"></re-icon>', cls: 'purple', id: 'cls-stat-subjects' },
      { label: 'Total Students', val: totalStudents, icon: '<re-icon icon="graduation-cap"></re-icon>', cls: 'green', id: 'cls-stat-students' },
      { label: 'Total Assignments', val: totalAssignments, icon: '<re-icon icon="clipboard-list"></re-icon>', cls: 'blue', id: 'cls-stat-assignments' }
    ];
  }

  el.innerHTML = cards.map(function (c) {
    return '<div class="t-stat-mini">'
      + '<div class="t-stat-icon ' + c.cls + '">' + c.icon + '</div>'
      + '<div><div class="t-stat-val" id="' + c.id + '">' + c.val + '</div><div class="t-stat-label">' + c.label + '</div></div>'
      + '</div>';
  }).join('');
}

function _getClassAdvisorInfo(cls) {
  if (!cls) return { name: '', initials: '' };
  var allTeachers = typeof _getAllTeachersList === 'function' ? _getAllTeachersList() : (DB.get('users') || []);
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
  var advName = (assignedTeacher ? (assignedTeacher.name || assignedTeacher.fullName) : cls.advisorTeacherName) || '';
  var initials = '';
  if (advName) {
    var clean = advName.replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, '').trim();
    var parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      initials = (parts[0][0] + parts[1][0]).toUpperCase();
    } else if (clean.length) {
      initials = clean.slice(0, 2).toUpperCase();
    }
  }
  return { name: advName, initials: initials };
}

function _renderClassGrid(classes) {
  var classGrid = document.getElementById('scg');
  if (!classGrid) return;
  classGrid.innerHTML = classes.length
    ? classes.map(function (cls) {
      var studentCount = cls.studentCount || 0;
      var rawHall = (cls.roomId && cls.roomId.hallNo) || cls.hallNo || cls.room || '';
      var hasHall = Boolean(rawHall && rawHall !== '—');
      var hallHtml = hasHall ? ('<b>' + escapeHtml(rawHall) + '</b>') : '<b class="mu">—</b>';

      var section = cls.section;
      if (!section && cls.name) {
        var mSec = cls.name.match(/(?:SEC\s*|[- ])([A-Za-z0-9]{1,3})$/i);
        if (mSec) section = mSec[1].toUpperCase();
      }
      var sectionDisplay = escapeHtml(section || 'A');

      var dept = (DB.get('depts') || []).find(function (d) { return String(d._id) === String(cls.deptId); });
      var deptCode = (dept && (dept.code || dept.deptCode)) || cls.deptCode || (typeof structureContext !== 'undefined' && structureContext && structureContext.deptCode) || '';
      if (!deptCode && cls.deptName) {
        var mD = cls.deptName.match(/\b([A-Z]{2,5})\b/);
        if (mD) deptCode = mD[1];
      }
      if (!deptCode && cls.name) {
        var mC = cls.name.match(/\b([A-Za-z]{2,5})[- ]?[A-Za-z0-9]?$/);
        if (mC) deptCode = mC[1].toUpperCase();
      }
      if (!deptCode) deptCode = 'CSE';

      var rawBatch = String(cls.batch || cls.year || '').trim();
      var batchText = '';
      if (rawBatch) {
        batchText = /^batch\b/i.test(rawBatch) ? rawBatch : ('Batch ' + rawBatch);
      } else {
        batchText = 'Batch —';
      }

      var advInfo = _getClassAdvisorInfo(cls);
      var advisorHtml = '';
      if (advInfo.name) {
        advisorHtml = '<p><i class="av">' + escapeHtml(advInfo.initials || 'CA') + '</i><b>' + escapeHtml(advInfo.name) + '</b></p>';
      } else {
        advisorHtml = '<p><i class="av mu">—</i><b class="mu">Not assigned</b></p>';
      }

      return '<article class="cc" onclick="openCD(\'' + cls._id + '\')">'
        + '<div class="r1">'
        + '  <i class="sec">' + sectionDisplay + '</i>'
        + '  <div class="nm">'
        + '    <h3>' + escapeHtml(cls.name || 'Untitled Class') + '</h3>'
        + '    <div class="dp"><b>' + escapeHtml(deptCode) + '</b><span>' + escapeHtml(batchText) + '</span></div>'
        + '  </div>'
        + '  <i class="go"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg></i>'
        + '</div>'
        + '<div class="tb">'
        + '  <div>'
        + '    <s><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"></circle><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a4 4 0 0 0 0-7"></path></svg> Students</s>'
        + '    <b>' + studentCount + '</b>'
        + '  </div>'
        + '  <div>'
        + '    <s><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4h9v17M3 21h18M11 12h.01M14 6h5v15"></path></svg> Hall</s>'
        + '    ' + hallHtml
        + '  </div>'
        + '  <div class="ad">'
        + '    <s><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9l10-5 10 5-10 5z"></path><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"></path></svg> Class advisor</s>'
        + '    ' + advisorHtml
        + '  </div>'
        + '</div>'
        + '</article>';
    }).join('')
    : '<div class="emst"><span class="emico"><re-icon icon="chalkboard"></re-icon></span><div class="emtx">No classes. Click "+ Add Class".</div></div>';
}

var _classViewMode = 'grid';

function toggleStructureView(mode) {
  var isGrid = mode === 'grid';
  var isList = mode === 'table' || mode === 'list';
  if (!isGrid && !isList) isGrid = true;
  _classViewMode = isGrid ? 'grid' : 'list';

  var gridBtns = document.querySelectorAll('#cs-vt-grid');
  var tblBtns = document.querySelectorAll('#cs-vt-table, #cs-vt-list');
  var gridEl = document.getElementById('scg');
  var tblEl = document.getElementById('scg-tbl');
  var ssg2El = document.getElementById('ssg2');
  var ssg2TblEl = document.getElementById('ssg2-tbl');
  var info = document.getElementById('cs-view-info');

  gridBtns.forEach(function (btn) { btn.classList.toggle('act', isGrid); });
  tblBtns.forEach(function (btn) { btn.classList.toggle('act', isList); });

  if (gridEl) gridEl.style.display = isGrid ? '' : 'none';
  if (tblEl) tblEl.style.display = isList ? '' : 'none';
  if (ssg2El) ssg2El.style.display = isGrid ? '' : 'none';
  if (ssg2TblEl) ssg2TblEl.style.display = isList ? '' : 'none';
  if (info) info.innerHTML = isGrid ? '<re-icon icon="grid"></re-icon> Grid view' : '<re-icon icon="list"></re-icon> List view';
}
var toggleClassView = toggleStructureView;
var toggleSubjectView = toggleStructureView;
window.toggleStructureView = toggleStructureView;
window.toggleClassView = toggleClassView;
window.toggleSubjectView = toggleSubjectView;

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
        + '<td>' + ((cls.roomId && cls.roomId.hallNo) || cls.hallNo || '—') + '</td>'
        + '<td>' + (cls.studentCount || 0) + '</td>'
        + '<td>' + assignmentCount + '</td>'
        + '</tr>';
    }).join('')
    : '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--tdi);">No classes found.</td></tr>';
}

// ── Regulation Grouping Engine for Subjects (Derived from <select id="es-reg">) ──
var _activeSubjectRegulationFilter = 'all';

function getAvailableRegulations() {
  var sel = document.getElementById('es-reg') || document.getElementById('ns-reg');
  var regs = [];
  if (sel && sel.options && sel.options.length > 0) {
    for (var i = 0; i < sel.options.length; i++) {
      var opt = sel.options[i];
      if (opt.value) {
        regs.push({
          code: opt.value.trim(),
          name: opt.text.trim() || ('Regulation ' + opt.value.trim()),
          shortName: 'Reg ' + opt.value.trim()
        });
      }
    }
  }
  if (!regs.length) {
    regs = [
      { code: '2025', name: 'Regulation 2025', shortName: 'Reg 2025' },
      { code: '2021', name: 'Regulation 2021', shortName: 'Reg 2021' }
    ];
  }
  return regs;
}

function getSubjectRegulationInfo(subj) {
  var available = getAvailableRegulations();
  var defaultReg = available[0] || { code: '2025', name: 'Regulation 2025', shortName: 'Reg 2025' };

  var raw = (subj && subj.regulation ? String(subj.regulation).trim() : '');
  if (!raw) {
    return defaultReg;
  }

  var cleanCode = raw.replace(/^Regulation\s*/i, '').trim();

  // Match against options from <select id="es-reg">
  var matched = available.find(function (r) {
    return r.code.toLowerCase() === cleanCode.toLowerCase() ||
      r.code.toLowerCase() === raw.toLowerCase() ||
      r.name.toLowerCase() === raw.toLowerCase();
  });

  if (matched) {
    return matched;
  }

  var name = raw.toLowerCase().startsWith('regulation') ? raw : ('Regulation ' + (cleanCode || raw));
  return {
    code: cleanCode || raw,
    name: name,
    shortName: 'Reg ' + (cleanCode || raw)
  };
}

function _generateSubjectShortCode(name) {
  if (!name) return '';
  var clean = name.trim();
  var known = {
    'Data Structures and Algorithms': 'DSA',
    'Data Structures and Algorithm': 'DSA',
    'Data Structures': 'DS',
    'Operating Systems': 'OS',
    'Operating System': 'OS',
    'Database Management Systems': 'DBMS',
    'Database Management System': 'DBMS',
    'Computer Networks': 'CN',
    'Computer Network': 'CN',
    'Software Engineering': 'SE',
    'Object Oriented Programming': 'OOP',
    'DBMS Lab': 'DBMS Lab',
    'Networks Lab': 'Networks Lab',
    'Network Lab': 'Net Lab',
    'Web Technology': 'WT',
    'Cloud Computing': 'CC',
    'Cyber Security': 'CS',
    'Machine Learning': 'ML',
    'Artificial Intelligence': 'AI',
    'Deep Learning': 'DL',
    'Digital Electronics': 'DE',
    'Signals and Systems': 'SS'
  };
  if (known[clean]) return known[clean];

  if (clean.length <= 5 && !/\s/.test(clean)) return clean.toUpperCase();

  var words = clean.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return words[0].substring(0, 4).toUpperCase();

  var stopwords = ['and', 'of', 'the', 'for', 'in', 'to', 'with', 'a', 'an', '&', 'on', 'at'];
  var filtered = words.filter(function (w) { return stopwords.indexOf(w.toLowerCase()) === -1; });
  var targetWords = filtered.length ? filtered : words;

  var isLab = targetWords[targetWords.length - 1].toLowerCase() === 'lab';
  if (isLab && targetWords.length > 1) {
    var prefixWords = targetWords.slice(0, targetWords.length - 1);
    var acronym = prefixWords.map(function (w) {
      return (w.length <= 4 && w === w.toUpperCase()) ? w : w[0].toUpperCase();
    }).join('');
    return acronym + ' Lab';
  }

  return targetWords.map(function (w) {
    return (w.length <= 4 && w === w.toUpperCase()) ? w : w[0].toUpperCase();
  }).join('');
}

function formatSubjectDisplayCode(subj) {
  if (!subj) return '';
  var courseCode = (subj.courseCode || subj.code || (subj.subjectCode ? subj.subjectCode.split('-')[0] : '') || '—').trim();

  var shortCode = (subj.shortForm && subj.shortForm.trim()) || (subj.shortName && subj.shortName.trim()) || '';
  if (!shortCode && subj.name) {
    shortCode = _generateSubjectShortCode(subj.name);
  }
  if (!shortCode) shortCode = courseCode;

  if (courseCode === shortCode) {
    return courseCode;
  }
  return courseCode + ' - ' + shortCode;
}

function formatSubjectDisplayHtml(subj) {
  if (!subj) return '';
  var courseCode = (subj.courseCode || subj.code || (subj.subjectCode ? subj.subjectCode.split('-')[0] : '') || '—').trim();

  var shortCode = (subj.shortForm && subj.shortForm.trim()) || (subj.shortName && subj.shortName.trim()) || '';
  if (!shortCode && subj.name) {
    shortCode = _generateSubjectShortCode(subj.name);
  }
  if (!shortCode) shortCode = courseCode;

  var displayText = (courseCode === shortCode)
    ? escapeHtml(courseCode)
    : escapeHtml(courseCode) + ' - ' + escapeHtml(shortCode);

  return '<span style="vertical-align:middle;font-family:\'Poppins\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;">' + displayText + '</span>';
}

function _groupSubjectsByRegulation(subjects) {
  var available = getAvailableRegulations();
  var groupsMap = {};

  // Initialize groups based strictly on the regulations in <select id="es-reg">
  available.forEach(function (reg, index) {
    groupsMap[reg.code] = {
      key: reg.code,
      code: reg.code,
      name: reg.name,
      shortName: reg.shortName,
      order: index,
      subjects: []
    };
  });

  subjects.forEach(function (subj) {
    var regInfo = getSubjectRegulationInfo(subj);
    var key = regInfo.code;
    if (!groupsMap[key]) {
      groupsMap[key] = {
        key: key,
        code: key,
        name: regInfo.name,
        shortName: regInfo.shortName,
        order: 99,
        subjects: []
      };
    }
    groupsMap[key].subjects.push(subj);
  });

  // Only return groups that contain subjects, preserving order from <select id="es-reg">
  var groups = Object.values(groupsMap).filter(function (g) {
    return g.subjects.length > 0;
  }).sort(function (a, b) {
    if (a.order !== b.order) return a.order - b.order;
    return String(b.code).localeCompare(String(a.code));
  });

  groups.forEach(function (g) {
    g.subjects.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
  });

  return groups;
}

function setSubjectRegulationFilter(regKey) {
  _activeSubjectRegulationFilter = regKey;
  var deptId = structureContext ? structureContext.deptId : null;
  var subjects = (DB.get('subjects') || []).filter(function (s) { return !deptId || getSubjectDeptId(s) === String(deptId); });
  _renderSubjectGrid(subjects);
  _renderSubjectTable(subjects);
  toggleStructureView(_classViewMode || 'grid');
}

function _renderSubjectRegulationPills(allGroups, totalCount) {
  var pillsEl = document.getElementById('subj-reg-filter-pills');
  if (!pillsEl) return;
  if (!allGroups.length) {
    pillsEl.innerHTML = '<span style="font-size:12px;color:var(--tdi);">No subjects</span>';
    return;
  }

  var html = '<button type="button" class="t-pill ' + (_activeSubjectRegulationFilter === 'all' ? 'act' : '') + '" onclick="setSubjectRegulationFilter(\'all\')">'
    + 'All Regulations <span style="font-size:11px;opacity:0.85;margin-left:3px;">(' + totalCount + ')</span>'
    + '</button>';

  allGroups.forEach(function (g) {
    var isAct = _activeSubjectRegulationFilter === g.key ? 'act' : '';
    html += '<button type="button" class="t-pill ' + isAct + '" onclick="setSubjectRegulationFilter(\'' + g.key + '\')">'
      + escapeHtml(g.name) + ' <span style="font-size:11px;opacity:0.85;margin-left:3px;">(' + g.subjects.length + ')</span>'
      + '</button>';
  });

  pillsEl.innerHTML = html;
}

function _renderSubjectGrid(subjects) {
  var subjectGrid = document.getElementById('ssg2');
  if (!subjectGrid) return;

  if (!subjects.length) {
    _renderSubjectRegulationPills([], 0);
    subjectGrid.innerHTML = '<div class="emst"><span class="emico"><re-icon icon="book-open"></re-icon></span><div class="emtx">No subjects found. Click "+ Add Subject".</div></div>';
    return;
  }

  var allGroups = _groupSubjectsByRegulation(subjects);
  _renderSubjectRegulationPills(allGroups, subjects.length);

  var visibleGroups = allGroups;
  if (_activeSubjectRegulationFilter !== 'all') {
    visibleGroups = allGroups.filter(function (g) { return g.key === _activeSubjectRegulationFilter; });
  }

  if (!visibleGroups.length) {
    subjectGrid.innerHTML = '<div class="emst"><span class="emico"><re-icon icon="book-open"></re-icon></span><div class="emtx">No subjects under the selected regulation.</div></div>';
    return;
  }

  var html = '';
  visibleGroups.forEach(function (group) {
    html += '<div class="subject-reg-section" style="margin-bottom:24px;">';
    html += '  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:9px 14px;background:var(--gLt);border:1px solid var(--br);border-radius:10px;">';
    html += '    <div style="display:flex;align-items:center;gap:8px;">';
    html += '      <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:var(--gD);color:#fff;border-radius:6px;font-size:12px;"><re-icon icon="award" size="14"></re-icon></span>';
    html += '      <strong style="font-size:13.5px;color:var(--td);">' + escapeHtml(group.name) + '</strong>';
    html += '      <span style="background:#fff;color:var(--gD);border:1px solid var(--br);padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">' + group.subjects.length + ' subject' + (group.subjects.length === 1 ? '' : 's') + '</span>';
    html += '    </div>';
    html += '  </div>';

    html += '  <div class="egrd">';
    group.subjects.forEach(function (subj) {
      var assignments = (DB.get('assignments') || []).filter(function (a) {
        return String(a.subjectId) === String(subj._id) ||
          (subj.trackId && String(a.subjectId) === String(subj.trackId)) ||
          (subj.courseCode && String(a.subjectId) === String(subj.courseCode)) ||
          (subj.code && String(a.subjectId) === String(subj.code)) ||
          (subj.subjectCode && String(a.subjectId) === String(subj.subjectCode));
      });
      var sectionCount = assignments.length;
      var displayCode = formatSubjectDisplayCode(subj);
      var displayHtml = formatSubjectDisplayHtml(subj);
      var fullName = subj.name || 'Subject';
      var credits = (subj.credits != null && subj.credits !== '') ? subj.credits : 0;
      var type = subj.type || 'Theory';

      html += '<div class="ec" onclick="openSubjectModal(\'' + subj._id + '\')" style="cursor:pointer;transition:transform .18s,box-shadow .18s;" title="' + escapeHtml(displayCode + ' (' + fullName + ')') + '">';
      html += '  <div class="ech">';
      html += '    <div class="eci" style="background:rgba(59,130,246,.1);color:var(--gD);"><re-icon icon="book-open"></re-icon></div>';
      html += '    <div style="flex:1;min-width:0;">';
      html += '      <div class="ecn" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700;font-size:13.5px;letter-spacing:0.2px;" title="' + escapeHtml(displayCode) + '">' + displayHtml + '</div>';
      html += '      <div class="ecsu" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11.5px;color:var(--tmu);margin-top:2px;" title="' + escapeHtml(fullName) + '">' + escapeHtml(fullName) + ' · ' + credits + ' credits · ' + escapeHtml(type) + '</div>';
      html += '    </div>';
      html += '  </div>';
      html += '  <div class="ecb">';
      html += '    <div class="emt">' + (sectionCount ? '<re-icon icon="clipboard-list"></re-icon> ' + sectionCount + ' section(s) assigned' : '<re-icon icon="plus"></re-icon> Click to assign sections &amp; edit') + '</div>';
      html += '  </div>';
      html += '</div>';
    });
    html += '  </div>';
    html += '</div>';
  });

  subjectGrid.innerHTML = html;
}

function _renderSubjectTable(subjects) {
  var tbody = document.getElementById('ssg2-tbl-body');
  if (!tbody) return;

  if (!subjects.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">No subjects found.</td></tr>';
    return;
  }

  var allGroups = _groupSubjectsByRegulation(subjects);
  var visibleGroups = allGroups;
  if (_activeSubjectRegulationFilter !== 'all') {
    visibleGroups = allGroups.filter(function (g) { return g.key === _activeSubjectRegulationFilter; });
  }

  if (!visibleGroups.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">No subjects match the selected regulation.</td></tr>';
    return;
  }

  var html = '';
  var rowIndex = 1;
  visibleGroups.forEach(function (group) {
    html += '<tr style="background:var(--gLt);font-weight:700;color:var(--td);pointer-events:none;">';
    html += '  <td colspan="8" style="padding:9px 14px;border-top:1.5px solid var(--br);border-bottom:1px solid var(--br);">';
    html += '    <span style="display:inline-flex;align-items:center;gap:6px;"><re-icon icon="award" size="14"></re-icon> ' + escapeHtml(group.name) + '</span>';
    html += '    <span style="font-size:11px;font-weight:600;color:var(--tmu);margin-left:6px;">(' + group.subjects.length + ' subjects)</span>';
    html += '  </td>';
    html += '</tr>';

    group.subjects.forEach(function (subj) {
      var assignments = (DB.get('assignments') || []).filter(function (a) {
        return String(a.subjectId) === String(subj._id) ||
          (subj.trackId && String(a.subjectId) === String(subj.trackId)) ||
          (subj.courseCode && String(a.subjectId) === String(subj.courseCode)) ||
          (subj.code && String(a.subjectId) === String(subj.code)) ||
          (subj.subjectCode && String(a.subjectId) === String(subj.subjectCode));
      });
      var sectionCount = assignments.length;
      var regInfo = getSubjectRegulationInfo(subj);
      var regBadge = regInfo.shortName || ('Reg ' + regInfo.code);
      var displayCode = formatSubjectDisplayCode(subj);
      var displayHtml = formatSubjectDisplayHtml(subj);

      html += '<tr onclick="openSubjectModal(\'' + subj._id + '\')" style="cursor:pointer;" title="Click to manage subject: ' + escapeHtml(displayCode + ' (' + (subj.name || '') + ')') + '">';
      html += '  <td style="width:40px;color:var(--tmu);font-size:12px;">' + (rowIndex++) + '</td>';
      var blendBadge = subj.isBlend ? ' <span class="pill" style="font-size:10px;background:#f3e8ff;color:#7e22ce;margin-left:4px;"><re-icon icon="git-merge" size="10"></re-icon> Blend (' + (subj.blendTheorySlots || 0) + 'T + ' + (subj.blendLabSlots || 0) + 'L)</span>' : '';
      html += '  <td class="b">';
      html += '    <div style="font-weight:700;color:var(--td);font-size:13px;letter-spacing:0.2px;display:flex;align-items:center;flex-wrap:wrap;gap:4px;">' + displayHtml + blendBadge + '</div>';
      html += '    <div style="font-size:11.5px;color:var(--tmu);font-weight:normal;margin-top:2px;">' + escapeHtml(subj.name || '—') + '</div>';
      html += '  </td>';
      html += '  <td><span style="font-family:monospace;font-size:12px;font-weight:600;color:var(--gD);background:var(--gLt);padding:2px 6px;border-radius:4px;">' + escapeHtml(subj.courseCode || subj.code || subj.subjectCode || '—') + '</span></td>';
      html += '  <td><span style="font-size:11.5px;font-weight:500;color:var(--td);">' + escapeHtml(subj.type || 'Theory') + '</span></td>';
      html += '  <td><div><span style="font-size:12px;font-weight:600;">' + (subj.credits != null && subj.credits !== '' ? subj.credits : '—') + ' Cr</span></div><div style="font-size:10.5px;color:var(--tmu);">' + (subj.slotsTarget || 5) + ' cl/wk (' + (subj.slotsMin || 4) + '–' + (subj.slotsMax || 7) + ')</div></td>';
      html += '  <td><span style="font-size:12px;font-weight:600;color:' + (sectionCount ? 'var(--gD)' : 'var(--tmu)') + ';">' + (sectionCount ? sectionCount + ' section' + (sectionCount === 1 ? '' : 's') : '0 sections') + '</span></td>';
      html += '  <td><span style="font-size:11px;font-weight:600;padding:2px 7px;border-radius:4px;background:var(--gLt);color:var(--gD);">' + escapeHtml(regBadge) + '</span></td>';
      html += '  <td style="text-align:right;">';
      html += '    <button type="button" class="btn-xs btn-out" onclick="event.stopPropagation();openSubjectModal(\'' + subj._id + '\')" title="Manage Subject">';
      html += '      <re-icon icon="settings" size="12"></re-icon> Manage';
      html += '    </button>';
      html += '  </td>';
      html += '</tr>';
    });
  });

  tbody.innerHTML = html;
}

function renderClassSubjectView(deptId) {
  _renderClassStats();
  var classes = DB.get('classes').filter(function (c) { return !deptId || c.deptId === deptId; }) || [];
  var subjects = DB.get('subjects').filter(function (s) { return !deptId || getSubjectDeptId(s) === String(deptId); }) || [];
  _renderClassGrid(classes);
  _renderClassTable(classes);
  _renderSubjectGrid(subjects);
  _renderSubjectTable(subjects);

  var isGrid = _classViewMode === 'grid';
  var isList = _classViewMode === 'table' || _classViewMode === 'list';
  if (!isGrid && !isList) isGrid = true;

  var scg = document.getElementById('scg');
  var scgTbl = document.getElementById('scg-tbl');
  var ssg2 = document.getElementById('ssg2');
  var ssg2Tbl = document.getElementById('ssg2-tbl');
  if (scg) scg.style.display = isGrid ? '' : 'none';
  if (scgTbl) scgTbl.style.display = isList ? '' : 'none';
  if (ssg2) ssg2.style.display = isGrid ? '' : 'none';
  if (ssg2Tbl) ssg2Tbl.style.display = isList ? '' : 'none';
}
var renderCSViewNosem = renderClassSubjectView;

function switchStructureTab(tabName) {
  var isSupporting = structureContext && structureContext.category === 'supporting';
  if (isSupporting || tabName === 'subjects') {
    tabName = 'subjects';
  } else {
    tabName = 'classes';
  }

  var tabClasses = document.getElementById('cs-tab-classes');
  var tabSubjects = document.getElementById('cs-tab-subjects');
  if (tabClasses) {
    tabClasses.classList.toggle('act', tabName === 'classes');
    tabClasses.style.display = isSupporting ? 'none' : '';
  }
  if (tabSubjects) {
    tabSubjects.classList.toggle('act', tabName === 'subjects');
  }

  var spClasses = document.getElementById('sp-classes');
  var spSubjects = document.getElementById('sp-subjects');
  if (spClasses) spClasses.style.display = tabName === 'classes' ? 'block' : 'none';
  if (spSubjects) spSubjects.style.display = tabName === 'subjects' ? 'block' : 'none';

  var clsPageBtn = document.getElementById('cls-page-btn');
  if (clsPageBtn) clsPageBtn.style.display = structureContext.deptId ? 'flex' : 'none';

  var clsBtn = document.getElementById('hdr-add-class');
  var subjBtn = document.getElementById('hdr-add-subj');
  if (clsBtn) {
    clsBtn.style.display = isSupporting ? 'none' : '';
    clsBtn.className = tabName === 'classes' ? 'btn-pri' : 'btn-out';
  }
  if (subjBtn) {
    subjBtn.className = (isSupporting || tabName === 'subjects') ? 'btn-pri' : 'btn-out';
  }

  toggleStructureView(_classViewMode || 'grid');
  updateStructureTabIndicator(true);
}
var sst = switchStructureTab;

function updateStructureTabIndicator(animate) {
  var switcher = document.getElementById('cs-type-tabs');
  var ind = document.getElementById('cs-tab-ind');
  if (!switcher || !ind) return;

  var activeBtn = switcher.querySelector('.cs-tab-btn.act');
  if (!activeBtn || activeBtn.style.display === 'none') {
    var visibleBtns = Array.prototype.filter.call(switcher.querySelectorAll('.cs-tab-btn'), function (b) {
      return b.style.display !== 'none';
    });
    activeBtn = visibleBtns.find(function (b) { return b.classList.contains('act'); }) || visibleBtns[0];
  }
  if (!activeBtn) return;

  var left = activeBtn.offsetLeft;
  var width = activeBtn.offsetWidth;

  if (width === 0) {
    setTimeout(function () {
      updateStructureTabIndicator(animate);
    }, 40);
    return;
  }

  if (animate === false) {
    ind.classList.add('no-anim');
  } else {
    ind.classList.remove('no-anim');
    ind.classList.remove('popping');
    void ind.offsetWidth; // force reflow for pop animation
    ind.classList.add('popping');
  }

  ind.style.transform = 'translateX(' + left + 'px)';
  ind.style.width = width + 'px';

  if (animate === false) {
    requestAnimationFrame(function () {
      ind.classList.remove('no-anim');
    });
  }
}
window.updateStructureTabIndicator = updateStructureTabIndicator;

window.addEventListener('resize', function () {
  updateStructureTabIndicator(false);
});

function _getAllTeachersList() {
  var list = [];
  var seen = {};

  function addTeacher(t) {
    if (!t) return;
    var key = String(t._id || t.shadowId || t.trackId || '');
    if (!key) return;
    if (seen[key]) {
      Object.assign(seen[key], t);
      return;
    }
    var copy = Object.assign({}, t);
    seen[key] = copy;
    list.push(copy);
  }

  (DB.get('users') || []).filter(function (u) { return u.role === 'teacher'; }).forEach(addTeacher);
  if (Array.isArray(_teacherData)) {
    _teacherData.forEach(addTeacher);
  }
  return list;
}

function resolveTeacherDeptCode(t, fallbackCls) {
  if (!t) return fallbackCls && fallbackCls.deptCode ? String(fallbackCls.deptCode).toUpperCase() : 'CSE';
  if (t.deptCode && String(t.deptCode).trim()) {
    return (typeof SearchableDropdown !== 'undefined' && SearchableDropdown.normalizeDeptCode)
      ? SearchableDropdown.normalizeDeptCode(t.deptCode)
      : String(t.deptCode).trim().toUpperCase();
  }
  var depts = (DB.get('depts') && DB.get('depts').length) ? DB.get('depts') : (DB.get('departments') || []);
  var dId = t.deptId ? (typeof t.deptId === 'object' && t.deptId._id ? t.deptId._id : t.deptId) : '';
  var match = dId ? depts.find(function (d) { return String(d._id) === String(dId); }) : null;
  if (!match && (t.dept || t.department)) {
    var str = String(t.dept || t.department || '').toLowerCase().trim();
    match = depts.find(function (d) {
      return (d.name && d.name.toLowerCase().trim() === str) ||
             (d.code && d.code.toLowerCase().trim() === str);
    });
  }
  if (match) {
    var mCode = match.code || match.threeLetterCode;
    if (mCode) {
      return (typeof SearchableDropdown !== 'undefined' && SearchableDropdown.normalizeDeptCode)
        ? SearchableDropdown.normalizeDeptCode(mCode)
        : String(mCode).toUpperCase();
    }
    if (match.name) {
      return (typeof SearchableDropdown !== 'undefined' && SearchableDropdown.normalizeDeptCode)
        ? SearchableDropdown.normalizeDeptCode(match.name)
        : match.name.slice(0, 4).toUpperCase();
    }
  }
  var rawDept = String(t.dept || t.department || '').trim();
  if (rawDept) {
    if (typeof SearchableDropdown !== 'undefined' && SearchableDropdown.normalizeDeptCode) {
      return SearchableDropdown.normalizeDeptCode(rawDept);
    }
    var lowDept = rawDept.toLowerCase();
    if (lowDept.includes('mathematics') || lowDept === 'maths' || lowDept === 'math' || lowDept === 'mat') return 'MAT';
    if (lowDept.includes('computer science') || lowDept === 'cse') return 'CSE';
    if (lowDept.includes('information tech') || lowDept === 'it') return 'IT';
    if (lowDept.includes('electronics and comm') || lowDept.includes('ece') || lowDept.includes('electronics & comm')) return 'ECE';
    if (lowDept.includes('electrical') || lowDept.includes('eee')) return 'EEE';
    if (lowDept.includes('mechatronics') || lowDept === 'mtrx') return 'MTRX';
    if (lowDept.includes('mechanical') || lowDept === 'mech') return 'MECH';
    if (lowDept.includes('civil')) return 'CIVIL';
    if (lowDept.includes('machine learning') || lowDept.includes('aiml') || lowDept.includes('ai & ml') || lowDept.includes('ai/ml')) return 'AIML';
    if (lowDept.includes('data science') || lowDept.includes('aids') || lowDept.includes('ai & ds') || lowDept.includes('artificial')) return 'AIDS';
    if (rawDept.length <= 5) return rawDept.toUpperCase();
    var words = rawDept.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      return words.map(function (w) { return w[0] || ''; }).join('').toUpperCase().slice(0, 5);
    }
    return rawDept.slice(0, 4).toUpperCase();
  }
  if (fallbackCls && fallbackCls.deptCode) return String(fallbackCls.deptCode).toUpperCase();
  return 'CSE';
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
      advisorNameEl.innerHTML = '<span style="color:var(--gD);font-weight:700;">' + escapeHtml(advName) + '</span>';
      if (advisorBtn) advisorBtn.innerHTML = '<re-icon icon="edit"></re-icon> Change Advisor';
    } else {
      advisorNameEl.textContent = 'Not Assigned';
      if (advisorBtn) advisorBtn.innerHTML = '<re-icon icon="user"></re-icon> Assign Advisor';
    }
  }

  if (advisorBtn) {
    advisorBtn.onclick = function (e) {
      if (e) e.preventDefault();
      openAdvisorModal();
    };
  }

  if (advisorSelect) {
    function isSameDept(t) {
      var tDeptId = t.deptId ? (typeof t.deptId === 'object' && t.deptId._id ? t.deptId._id : t.deptId) : '';
      var cDeptId = cls.deptId ? (typeof cls.deptId === 'object' && cls.deptId._id ? cls.deptId._id : cls.deptId) : '';
      var tDept = (t.dept || t.department || '').toLowerCase().trim();
      var cDeptName = (cls.deptName || '').toLowerCase().trim();
      var cDeptCode = (cls.deptCode || '').toLowerCase().trim();
      return (tDeptId && cDeptId && String(tDeptId) === String(cDeptId)) ||
        (tDept && (tDept === cDeptName || tDept === cDeptCode));
    }

    // List teachers ordered: class's department staff first, followed by others
    var deptTeachers = [];
    var otherTeachers = [];

    allTeachers.forEach(function (t) {
      if (isSameDept(t)) {
        deptTeachers.push(t);
      } else {
        otherTeachers.push(t);
      }
    });

    deptTeachers.sort(function (a, b) {
      var na = (a.name || a.fullName || '').toLowerCase();
      var nb = (b.name || b.fullName || '').toLowerCase();
      return na.localeCompare(nb);
    });

    otherTeachers.sort(function (a, b) {
      var na = (a.name || a.fullName || '').toLowerCase();
      var nb = (b.name || b.fullName || '').toLowerCase();
      return na.localeCompare(nb);
    });

    var sortedTeachers = deptTeachers.concat(otherTeachers);
    var selectedId = assignedTeacher ? (assignedTeacher._id || assignedTeacher.shadowId || assignedTeacher.trackId) : (cls.advisorTeacherId || '');

    var optionsHtml = '<option value="">— None (Unassigned) —</option>';
    optionsHtml += sortedTeachers.map(function (t) {
      var tid = t._id || t.shadowId || t.trackId;
      var sel = (String(tid) === String(selectedId) || (assignedTeacher && String(t.trackId) === String(assignedTeacher.trackId))) ? ' selected' : '';
      var tName = (t.name || t.fullName || 'Teacher').trim();
      var empNo = (t.empId || t.employeeNo || '').trim();
      var deptCode = resolveTeacherDeptCode(t, cls);

      return '<option value="' + tid + '"' + sel +
        ' data-name="' + escapeHtml(tName) + '"' +
        ' data-badge="' + escapeHtml(deptCode) + '"' +
        ' data-dept="' + escapeHtml(deptCode) + '">' +
        escapeHtml(tName) +
        '</option>';
    }).join('');

    advisorSelect.innerHTML = optionsHtml;
    if (typeof SearchableDropdown !== 'undefined') {
      SearchableDropdown.sync('cd-advisor-select');
    }
  }
}

function _populateClassRepresentativesSection(cls) {
  var nameEl = document.getElementById('cd-rep-name');
  var subEl = document.getElementById('cd-rep-sub');
  var btnEl = document.getElementById('cd-rep-btn');
  if (!cls || !nameEl) return;

  var reps = [];
  if (Array.isArray(cls.classRepresentatives) && cls.classRepresentatives.length > 0) {
    reps = cls.classRepresentatives.filter(Boolean);
  } else if (cls.representative1Name) {
    reps.push({
      studentId: cls.representative1Id,
      studentTrackId: cls.representative1TrackId || cls.repTrackId || cls.rep1TrackId || '',
      studentName: cls.representative1Name,
      registerNo: cls.representative1RegisterNo
    });
    if (cls.representative2Name) {
      reps.push({
        studentId: cls.representative2Id,
        studentTrackId: cls.representative2TrackId || cls.rep2TrackId || '',
        studentName: cls.representative2Name,
        registerNo: cls.representative2RegisterNo
      });
    }
  }

  // Fallback: resolve student names from DB.get('students') if names are missing
  var allStudents = DB.get('students') || [];
  if (reps.length > 0) {
    reps.forEach(function (r) {
      if (!r.studentName && (r.studentTrackId || r.studentId)) {
        var s = allStudents.find(function (stu) {
          return (r.studentTrackId && String(stu.trackId) === String(r.studentTrackId)) ||
                 (r.studentId && String(stu._id) === String(r.studentId));
        });
        if (s) {
          r.studentName = s.fullName || s.name || '';
          r.registerNo = s.registerNo || s.rollNo || '';
        }
      }
    });
  } else {
    var rep1Target = cls.repTrackId || cls.rep1TrackId || cls.representative1TrackId || cls.representative1Id;
    if (rep1Target) {
      var s1 = allStudents.find(function (s) {
        return String(s.trackId) === String(rep1Target) || String(s._id) === String(rep1Target);
      });
      if (s1) {
        reps.push({
          studentId: s1._id,
          studentTrackId: s1.trackId || '',
          studentName: s1.fullName || s1.name || 'Student',
          registerNo: s1.registerNo || s1.rollNo || ''
        });
      }
    }
    var rep2Target = cls.rep2TrackId || cls.representative2TrackId || cls.representative2Id;
    if (rep2Target) {
      var s2 = allStudents.find(function (s) {
        return String(s.trackId) === String(rep2Target) || String(s._id) === String(rep2Target);
      });
      if (s2) {
        reps.push({
          studentId: s2._id,
          studentTrackId: s2.trackId || '',
          studentName: s2.fullName || s2.name || 'Student',
          registerNo: s2.registerNo || s2.rollNo || ''
        });
      }
    }
  }

  // Filter out any entries that couldn't be resolved
  reps = reps.filter(function (r) {
    return r && (r.studentName || r.studentTrackId || r.studentId);
  });

  if (reps.length >= 2) {
    var name1 = reps[0].studentName || reps[0].fullName || reps[0].name || reps[0].studentTrackId || 'Representative 1';
    var name2 = reps[1].studentName || reps[1].fullName || reps[1].name || reps[1].studentTrackId || 'Representative 2';
    nameEl.innerHTML = '<span style="color:var(--gD);font-weight:700;">' + escapeHtml(name1) + '</span>'
      + '<span style="color:var(--tmu);font-weight:400;margin:0 4px;">&amp;</span>'
      + '<span style="color:var(--td);font-weight:600;">' + escapeHtml(name2) + '</span>';
    if (subEl) subEl.textContent = '2 Class Reps Designated';
    if (btnEl) btnEl.innerHTML = '<re-icon icon="edit" size="11"></re-icon> Change Reps';
  } else if (reps.length === 1) {
    var name1 = reps[0].studentName || reps[0].fullName || reps[0].name || reps[0].studentTrackId || 'Representative';
    nameEl.innerHTML = '<span style="color:var(--gD);font-weight:700;">' + escapeHtml(name1) + '</span>';
    if (subEl) subEl.textContent = 'Primary Rep Designated · 1 Optional Open';
    if (btnEl) btnEl.innerHTML = '<re-icon icon="edit" size="11"></re-icon> Change / Add Rep';
  } else {
    nameEl.innerHTML = '<span style="color:#d97706;font-weight:600;">Not Assigned</span>';
    if (subEl) subEl.textContent = '2 max · 1 required';
    if (btnEl) btnEl.innerHTML = '<re-icon icon="users" size="11"></re-icon> Assign Rep';
  }
}

function _renderStudentOptions(selectEl, studentsList, selectedId, excludeId, placeholderText) {
  if (!selectEl) return;
  var html = '<option value="">' + escapeHtml(placeholderText) + '</option>';
  studentsList.forEach(function (s) {
    var sId = String(s._id || s.trackId);
    // When one student is selected, hide that name in the other dropdown!
    if (excludeId && String(excludeId) === sId) {
      return;
    }
    var sName = s.fullName || s.name || 'Student';
    var reg = s.registerNo || s.rollNo || '';
    var isSel = (sId === String(selectedId));
    html += '<option value="' + escapeHtml(sId) + '"'
      + ' data-name="' + escapeHtml(sName) + '"'
      + (reg ? ' data-sub="' + escapeHtml(reg) + '"' : '')
      + (isSel ? ' selected' : '') + '>'
      + escapeHtml(sName + (reg ? ' [' + reg + ']' : ''))
      + '</option>';
  });
  selectEl.innerHTML = html;
  if (selectedId && String(selectedId) !== String(excludeId)) {
    selectEl.value = selectedId;
  } else {
    selectEl.value = '';
  }
}

function _populateRepSelectOptions(select1, select2, students, reps) {
  if (!select1 || !select2) return;
  var rep1Id = reps && reps[0] ? String(reps[0].studentId || reps[0]._id || '') : '';
  var rep2Id = reps && reps[1] ? String(reps[1].studentId || reps[1]._id || '') : '';
  if (rep1Id && rep2Id && String(rep1Id) === String(rep2Id)) {
    rep2Id = '';
  }

  var studentsList = Array.isArray(students) ? students : [];

  // Initial render with mutual exclusion
  _renderStudentOptions(select1, studentsList, rep1Id, rep2Id, '— Select Primary Representative —');
  _renderStudentOptions(select2, studentsList, rep2Id, rep1Id, '— None (Secondary Optional) —');

  // Initialize SearchableDropdown with live filter search
  if (typeof SearchableDropdown !== 'undefined') {
    var inst1 = SearchableDropdown.get(select1.id);
    if (inst1) {
      if (inst1.searchInput) {
        inst1.searchInput.value = '';
        if (inst1.clearBtn) inst1.clearBtn.style.display = 'none';
      }
      inst1.rebuild();
    } else {
      SearchableDropdown.attach(select1.id, {
        kind: 'student',
        showIcon: true,
        width: '100%',
        placeholder: '— Select Primary Representative —',
        searchPlaceholder: 'Search student name, register no…',
        search: true
      });
    }

    var inst2 = SearchableDropdown.get(select2.id);
    if (inst2) {
      if (inst2.searchInput) {
        inst2.searchInput.value = '';
        if (inst2.clearBtn) inst2.clearBtn.style.display = 'none';
      }
      inst2.rebuild();
    } else {
      SearchableDropdown.attach(select2.id, {
        kind: 'student',
        showIcon: true,
        width: '100%',
        placeholder: '— None (Optional) —',
        searchPlaceholder: 'Search student name, register no…',
        search: true
      });
    }
  }

  // Mutual exclusion: when one student is selected, hide that name in the other dropdown
  var isSyncing = false;

  select1.onchange = function () {
    if (isSyncing) return;
    isSyncing = true;
    try {
      var cur1 = select1.value;
      var cur2 = select2.value;
      if (cur2 && String(cur2) === String(cur1)) {
        cur2 = '';
      }
      _renderStudentOptions(select2, studentsList, cur2, cur1, '— None (Secondary Optional) —');
      if (typeof SearchableDropdown !== 'undefined') {
        var s2 = SearchableDropdown.get(select2.id);
        if (s2) s2.rebuild();
      }
    } finally {
      isSyncing = false;
    }
  };

  select2.onchange = function () {
    if (isSyncing) return;
    isSyncing = true;
    try {
      var cur1 = select1.value;
      var cur2 = select2.value;
      if (cur1 && String(cur1) === String(cur2)) {
        cur1 = '';
      }
      _renderStudentOptions(select1, studentsList, cur1, cur2, '— Select Primary Representative —');
      if (typeof SearchableDropdown !== 'undefined') {
        var s1 = SearchableDropdown.get(select1.id);
        if (s1) s1.rebuild();
      }
    } finally {
      isSyncing = false;
    }
  };
}

function _populateEditClassRepDropdowns(cls) {
  var ecRep1 = document.getElementById('ec-rep1');
  var ecRep2 = document.getElementById('ec-rep2');
  if (!ecRep1 || !ecRep2 || !cls) return;

  var reps = Array.isArray(cls.classRepresentatives) ? cls.classRepresentatives : [];
  var rep1Val = cls.representative1Id ? String(cls.representative1Id) : (reps[0] ? String(reps[0].studentId || reps[0]._id || '') : '');
  var rep2Val = cls.representative2Id ? String(cls.representative2Id) : (reps[1] ? String(reps[1].studentId || reps[1]._id || '') : '');

  ecRep1.innerHTML = '<option value="">Loading students…</option>';
  ecRep2.innerHTML = '<option value="">Loading students…</option>';

  var localStudents = (DB.get('students') || []).filter(function (s) {
    return String(s.classId) === String(cls._id) || (s.class && s.class.toLowerCase() === (cls.name || '').toLowerCase());
  });

  if (localStudents.length > 0) {
    _populateRepSelectOptions(ecRep1, ecRep2, localStudents, [{ studentId: rep1Val }, { studentId: rep2Val }]);
  }

  apiCall('GET', '/students?classId=' + encodeURIComponent(cls._id) + '&limit=500')
    .then(function (res) {
      var stuList = Array.isArray(res) ? res : ((res && (res.data || res.students)) || []);
      if (!stuList.length) stuList = localStudents;
      stuList.sort(function (a, b) {
        return (a.name || a.fullName || '').localeCompare(b.name || b.fullName || '');
      });
      _populateRepSelectOptions(ecRep1, ecRep2, stuList, [{ studentId: rep1Val }, { studentId: rep2Val }]);
    })
    .catch(function () {
      if (localStudents.length > 0) {
        _populateRepSelectOptions(ecRep1, ecRep2, localStudents, [{ studentId: rep1Val }, { studentId: rep2Val }]);
      }
    });
}

// ─── UNIFIED CLASS MANAGEMENT MODULE (Overview, Subjects, Students, Edit) ───
var _classRosterCache = null;

function _updateClassUnifiedModalHeader(cls) {
  var titleEl = document.getElementById('cd-ttl');
  var subEl = document.getElementById('cd-sub');
  if (!cls) return;

  var deptName = cls.deptName || 'Department';
  var displayHall = (cls.roomId && cls.roomId.hallNo) || cls.hallNo || '—';
  var resolvedSection = cls.section;
  if (!resolvedSection && cls.name) {
    var m = cls.name.match(/(?:SEC\s*|[- ])([A-Za-z0-9]{1,3})$/i);
    if (m) resolvedSection = m[1].toUpperCase();
  }
  if (!cls.section && resolvedSection) {
    cls.section = resolvedSection;
  }
  var section = resolvedSection || '';
  var batch = cls.batch || '—';
  var year = cls.year || '—';
  var sem = cls.sem || '—';

  if (titleEl) {
    titleEl.innerHTML = '<re-icon icon="chalkboard" size="20" style="flex-shrink:0;color:var(--gD);"></re-icon>'
      + '<span style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;font-family:\'Poppins\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-weight:700;">'
      + escapeHtml(cls.name || 'Class Section')
      + '</span>';
  }

  if (subEl) {
    var line2Parts = [
      escapeHtml(deptName),
      escapeHtml(year),
      'Sem ' + escapeHtml(sem),
      'Batch ' + escapeHtml(batch),
      'Hall ' + escapeHtml(displayHall)
    ];
    subEl.innerHTML = '<span style="font-family:\'Poppins\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-size:12px;font-weight:500;color:var(--tmu);line-height:1.35;display:inline-block;margin-top:2px;">'
      + line2Parts.join(' \u00b7 ')
      + '</span>';
  }
}

function switchClassTab(tabName) {
  var tabs = ['overview', 'subjects', 'students', 'edit'];
  tabs.forEach(function (t) {
    var btn = document.getElementById('cm-tab-btn-' + t);
    var panel = document.getElementById('cm-panel-' + t);
    if (btn) btn.classList.toggle('act', t === tabName);
    if (panel) panel.style.display = (t === tabName ? 'block' : 'none');
  });

  if (tabName === 'students' && !_classRosterCache && currentClassId) {
    loadClassStudents();
  }
  if (tabName === 'edit' && currentClassId) {
    var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
    if (cls) _populateEditClassForm(cls);
  }
}
window.switchClassTab = switchClassTab;

function _populateEditClassForm(cls) {
  if (!cls) return;
  var depts = DB.get('depts') || [];
  var deptSel = document.getElementById('ec-dept');
  if (deptSel) {
    deptSel.innerHTML = '<option value="">— Select Department —</option>'
      + depts.map(function (d) {
        var isSel = (d._id === cls.deptId || d.name === cls.deptName);
        return '<option value="' + d._id + '"' + (isSel ? ' selected' : '') + '>' + escapeHtml(d.name) + '</option>';
      }).join('');
    if (cls.deptId) deptSel.value = cls.deptId;
  }

  var batches = (typeof getActiveBatches === 'function' ? getActiveBatches() : (YEAR_CONFIG.batches || []));
  var batchSet = new Set(Array.isArray(batches) ? batches : []);
  if (cls.batch) batchSet.add(cls.batch);
  var bList = Array.from(batchSet).filter(Boolean).sort().reverse();

  var batchSel = document.getElementById('ec-batch');
  if (batchSel) {
    batchSel.innerHTML = '<option value="">— Select Batch —</option>'
      + bList.map(function (b) {
        var val = typeof b === 'object' ? (b.name || b.batch) : b;
        var isSel = (String(val) === String(cls.batch) ||
                     (typeof formatBatchShort === 'function' && formatBatchShort(val) === formatBatchShort(cls.batch)));
        return '<option value="' + escapeHtml(val) + '"' + (isSel ? ' selected' : '') + '>' + escapeHtml(val) + '</option>';
      }).join('');

    if (cls.batch) {
      batchSel.value = cls.batch;
      if (!batchSel.value) {
        var targetShort = typeof formatBatchShort === 'function' ? formatBatchShort(cls.batch) : cls.batch;
        for (var i = 0; i < batchSel.options.length; i++) {
          if (typeof formatBatchShort === 'function' && formatBatchShort(batchSel.options[i].value) === targetShort) {
            batchSel.selectedIndex = i;
            break;
          }
        }
      }
    }
    if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('ec-batch');
  }

  var resolvedSection = cls.section;
  if (!resolvedSection && cls.name) {
    var m = cls.name.match(/(?:SEC\s*|[- ])([A-Za-z0-9]{1,3})$/i);
    if (m) resolvedSection = m[1].toUpperCase();
  }
  if (!cls.section && resolvedSection) {
    cls.section = resolvedSection;
  }
  var secInput = document.getElementById('ec-sec');
  if (secInput) secInput.value = resolvedSection || '';

  var yrSel = document.getElementById('ec-yr');
  if (yrSel && cls.year) yrSel.value = cls.year;

  var semSel = document.getElementById('ec-sem');
  if (semSel && cls.sem) semSel.value = cls.sem;

  _populateFacilityRoomDropdowns();
  var targetRoomId = (cls.roomId && typeof cls.roomId === 'object') ? cls.roomId._id : (cls.roomId || '');
  var ecRoomEl = document.getElementById('ec-room');
  if (ecRoomEl && targetRoomId) ecRoomEl.value = targetRoomId;
  if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('ec-room');

  var hallInput = document.getElementById('ec-hall');
  if (hallInput) hallInput.value = (cls.roomId && cls.roomId.hallNo) || cls.hallNo || '';

  ecAutoName();
  var nmInput = document.getElementById('ec-nm');
  if (nmInput && cls.name) nmInput.value = cls.name;
  _populateEditClassRepDropdowns(cls);
}

function _renderClassUnifiedOverview(cls, customAssignments) {
  var container = document.getElementById('cd-overview-content');
  if (!container || !cls) return;

  var assignments = Array.isArray(customAssignments)
    ? customAssignments
    : (DB.get('assignments') || []).filter(function (a) { return String(a.classId) === String(cls._id); });

  var studentCount = (cls.studentCount != null && cls.studentCount !== '' && !isNaN(cls.studentCount)) ? Number(cls.studentCount) : 0;
  var displayHall = (cls.roomId && cls.roomId.hallNo) || cls.hallNo || '—';

  // Distinct teachers
  var uniqueFaculty = [];
  assignments.forEach(function (a) {
    var tch = (DB.get('teachers') || []).find(function (t) { return String(t._id) === String(a.teacherId); });
    var tName = (a.teacherName || (tch ? tch.name : '')).trim();
    if (tName && !uniqueFaculty.includes(tName)) {
      uniqueFaculty.push(tName);
    }
  });

  // Update badges
  var subjBadge = document.getElementById('cm-badge-subj');
  if (subjBadge) subjBadge.textContent = assignments.length;
  var stuBadge = document.getElementById('cm-badge-stu');
  if (stuBadge) stuBadge.textContent = studentCount;

  // Assignments card markup
  var assignmentsHtml = '';
  if (assignments.length > 0) {
    assignmentsHtml = '<div class="subj-asgn-grid">' + assignments.map(function (a) {
      var subj = (DB.get('subjects') || []).find(function (s) { return String(s._id) === String(a.subjectId); });
      var subjCode = subj ? (subj.courseCode || subj.code || subj.shortForm || '') : '';
      var subjType = subj && subj.type ? subj.type : 'Theory';

      var tch = (DB.get('teachers') || []).find(function (t) { return String(t._id) === String(a.teacherId); });
      var tName = a.teacherName || (tch ? tch.name : 'Unassigned Faculty');
      var tInitial = (tName.charAt(0) || 'T').toUpperCase();
      var tDesig = tch && (tch.designation || tch.desig) ? ' · ' + (tch.designation || tch.desig) : '';

      var hall = a.hallNo ? 'Hall ' + a.hallNo : (displayHall !== '—' ? 'Hall ' + displayHall : 'Hall Unassigned');

      return '<div class="subj-asgn-card">'
        + '<div class="subj-asgn-left">'
        + '  <div class="subj-asgn-cls">'
        + '    <re-icon icon="book-open" size="14"></re-icon>'
        + '    <span style="font-weight:700;">' + escapeHtml(a.subjectName || (subj ? subj.name : 'Subject')) + '</span>'
        + (subjCode ? ' <span style="font-size:11px;font-family:monospace;background:var(--gLt);color:var(--gD);padding:1px 6px;border-radius:4px;margin-left:4px;">' + escapeHtml(subjCode) + '</span>' : '')
        + '  </div>'
        + '  <div class="subj-asgn-tchr">'
        + '    <span class="subj-tchr-av">' + escapeHtml(tInitial) + '</span>'
        + '    <span>' + escapeHtml(tName) + '<span style="font-size:11px;color:var(--tmu);font-weight:400;">' + escapeHtml(tDesig) + '</span></span>'
        + '  </div>'
        + '</div>'
        + '<div class="subj-asgn-right">'
        + '  <span class="subj-asgn-hall"><re-icon icon="pin" size="12"></re-icon> ' + escapeHtml(hall) + '</span>'
        + '  <button type="button" class="btn bdan bxs" onclick="rmAsgn(\'' + a._id + '\',\'class\')" title="Remove Assignment" style="padding:4px 8px;border-radius:6px;"><re-icon icon="trash2" size="12"></re-icon></button>'
        + '</div>'
        + '</div>';
    }).join('') + '</div>';
  } else {
    assignmentsHtml = '<div class="subj-asgn-empty">'
      + '<div class="subj-empty-icon"><re-icon icon="book-open" size="24"></re-icon></div>'
      + '<div class="subj-empty-title">No Subjects Assigned Yet</div>'
      + '<div class="subj-empty-desc">This class section does not have any curriculum subjects or teaching faculty mapped to it yet. Assign subjects to enable timetable scheduling and attendance tracking.</div>'
      + '<button type="button" class="btn-out btn-sm" onclick="asgnSubj(\'' + cls._id + '\')" style="margin-top:4px;"><re-icon icon="plus" size="13"></re-icon> Assign Subject</button>'
      + '</div>';
  }

  container.innerHTML =
    '<!-- 1. STATS KPI GRID -->'
    + '<div class="subj-stats-grid">'
    + '  <div class="subj-stat-card stat-green">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Students</span><div class="subj-stat-ic"><re-icon icon="users" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val"><span id="cd-stat-stu-val">' + studentCount + '</span> <span class="subj-stat-unit">Students</span></div>'
    + '    <div class="subj-stat-sub">Official class roster count</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-blue">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Subjects</span><div class="subj-stat-ic"><re-icon icon="book-open" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + assignments.length + ' <span class="subj-stat-unit">' + (assignments.length === 1 ? 'Subject' : 'Subjects') + '</span></div>'
    + '    <div class="subj-stat-sub">' + (assignments.length > 0 ? 'Active course allocations' : 'Pending course mapping') + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-amber">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Faculty</span><div class="subj-stat-ic"><re-icon icon="teacher" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + uniqueFaculty.length + ' <span class="subj-stat-unit">' + (uniqueFaculty.length === 1 ? 'Teacher' : 'Teachers') + '</span></div>'
    + '    <div class="subj-stat-sub">' + (uniqueFaculty.length > 0 ? 'Instructors &amp; lab mentors' : 'No instructors assigned') + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-purple">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Room / Hall</span><div class="subj-stat-ic"><re-icon icon="pin" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val"><span class="subj-type-badge theory">' + escapeHtml(displayHall) + '</span></div>'
    + '    <div class="subj-stat-sub">' + (displayHall !== '—' ? 'Designated lecture room' : 'Room unassigned') + '</div>'
    + '  </div>'
    + '</div>'
    + '<!-- 2. SPECIFICATIONS CARD -->'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd">'
    + '    <div class="subj-section-title"><re-icon icon="settings" size="14"></re-icon> <span>Class Specifications &amp; Academic Structure</span></div>'
    + '    <button type="button" class="btn-xs btn-out" onclick="switchClassTab(\'edit\')"><re-icon icon="edit" size="12"></re-icon> Edit Details</button>'
    + '  </div>'
    + '  <div class="subj-section-bd">'
    + '    <div class="subj-specs-grid">'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Class Name</span><span class="subj-spec-val" style="font-family:monospace;letter-spacing:.3px;">' + escapeHtml(cls.name || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Batch</span><span class="subj-spec-val">' + escapeHtml(cls.batch || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Academic Year</span><span class="subj-spec-val">' + escapeHtml(cls.year || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Semester &amp; Section</span><span class="subj-spec-val" style="color:var(--gD);">Sem ' + escapeHtml(cls.sem || '—') + ' · Sec ' + escapeHtml(cls.section || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Department</span><span class="subj-spec-val">' + escapeHtml(cls.deptName || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Room No.</span><span class="subj-spec-val" style="display:inline-flex;align-items:center;gap:5px;"><re-icon icon="pin" size="13" style="color:var(--gD);"></re-icon> ' + (displayHall !== '—' ? escapeHtml(displayHall) : 'Unassigned') + '</span></div>'
    + '    </div>'
    + '  </div>'
    + '</div>'
    + '<!-- 3. ADVISOR, REPRESENTATIVES & FACILITIES ROW -->'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:12px;">'
    + '  <div class="subj-section-card" style="margin:0;">'
    + '    <div class="subj-section-hd" style="padding:10px 14px;">'
    + '      <div class="subj-section-title" style="font-size:12.5px;"><re-icon icon="user-check" size="14"></re-icon> <span>Class Advisor</span></div>'
    + '      <button type="button" class="btn-xs btn-out" id="cd-advisor-btn" onclick="openAdvisorModal()" style="padding:3px 8px;font-size:11px;"><re-icon icon="user" size="11"></re-icon> Assign Advisor</button>'
    + '    </div>'
    + '    <div class="subj-section-bd" style="padding:12px 14px;display:flex;align-items:center;gap:12px;">'
    + '      <div style="width:38px;height:38px;border-radius:10px;background:var(--gLt);color:var(--gD);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">'
    + '        <re-icon icon="user-check" size="18"></re-icon>'
    + '      </div>'
    + '      <div style="flex:1;min-width:0;">'
    + '        <div id="cd-advisor-name" style="font-size:13.5px;font-weight:700;color:var(--td);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Not Assigned</div>'
    + '        <div id="cd-advisor-sub" style="font-size:11px;color:var(--tmu);margin-top:2px;">Designated Student Mentor</div>'
    + '      </div>'
    + '    </div>'
    + '  </div>'
    + '  <div class="subj-section-card" style="margin:0;">'
    + '    <div class="subj-section-hd" style="padding:10px 14px;">'
    + '      <div class="subj-section-title" style="font-size:12.5px;"><re-icon icon="sparkles" size="14"></re-icon> <span>Class Representatives</span></div>'
    + '      <button type="button" class="btn-xs btn-out" id="cd-rep-btn" onclick="openRepresentativeModal()" style="padding:3px 8px;font-size:11px;"><re-icon icon="users" size="11"></re-icon> Assign Rep</button>'
    + '    </div>'
    + '    <div class="subj-section-bd" style="padding:12px 14px;display:flex;align-items:center;gap:12px;">'
    + '      <div style="width:38px;height:38px;border-radius:10px;background:rgba(16,185,129,0.12);color:#059669;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">'
    + '        <re-icon icon="users" size="18"></re-icon>'
    + '      </div>'
    + '      <div style="flex:1;min-width:0;">'
    + '        <div id="cd-rep-name" style="font-size:13px;font-weight:700;color:var(--td);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Not Assigned</div>'
    + '        <div id="cd-rep-sub" style="font-size:11px;color:var(--tmu);margin-top:2px;">2 max · 1 required</div>'
    + '      </div>'
    + '    </div>'
    + '  </div>'
    + '  <div class="subj-section-card" style="margin:0;">'
    + '    <div class="subj-section-hd" style="padding:10px 14px;">'
    + '      <div class="subj-section-title" style="font-size:12.5px;"><re-icon icon="tv" size="14"></re-icon> <span>Campus Facility &amp; Board</span></div>'
    + '      <button type="button" class="btn-xs btn-out" id="cd-room-board-btn" onclick="openRoomBoardFromClass()" style="padding:3px 8px;font-size:11px;">Open in Hub <re-icon icon="arrow-right" size="10"></re-icon></button>'
    + '    </div>'
    + '    <div class="subj-section-bd" style="padding:12px 14px;display:flex;align-items:center;gap:12px;">'
    + '      <div style="width:38px;height:38px;border-radius:10px;background:rgba(59,130,246,0.1);color:#2563eb;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">'
    + '        <re-icon icon="building" size="18"></re-icon>'
    + '      </div>'
    + '      <div style="flex:1;min-width:0;">'
    + '        <div id="cd-room-board-title" style="font-size:13.5px;font-weight:700;color:var(--td);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (displayHall !== '—' ? 'Hall: ' + escapeHtml(displayHall) : 'No Room Assigned') + '</div>'
    + '        <div id="cd-room-board-sub" style="font-size:11px;color:var(--tmu);margin-top:2px;">Base classroom location</div>'
    + '      </div>'
    + '    </div>'
    + '  </div>'
    + '</div>'
    + '<!-- 4. CURRICULUM ALLOCATIONS PREVIEW CARD -->'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd">'
    + '    <div class="subj-section-title"><re-icon icon="book-open" size="14"></re-icon> <span>Curriculum &amp; Teaching Faculty</span><span style="background:var(--gLt);color:var(--gD);font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:4px;">' + assignments.length + '</span></div>'
    + '    <div style="display:flex;gap:6px;">'
    + '      <button type="button" class="btn-xs btn-out" onclick="switchClassTab(\'subjects\')"><re-icon icon="list" size="12"></re-icon> View Full Table</button>'
    + '      <button type="button" class="btn-xs btn-pri" onclick="asgnSubj(\'' + cls._id + '\')"><re-icon icon="plus" size="12"></re-icon> Assign Subject</button>'
    + '    </div>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:14px 18px;">'
    +      assignmentsHtml
    + '  </div>'
    + '</div>'
    + '<!-- 5. ENROLLED STUDENTS SUMMARY CARD -->'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd">'
    + '    <div class="subj-section-title"><re-icon icon="users" size="14"></re-icon> <span>Enrolled Students Roster</span><span style="background:var(--gLt);color:var(--gD);font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:4px;">' + studentCount + '</span></div>'
    + '    <button type="button" class="btn-xs btn-out" onclick="switchClassTab(\'students\')"><re-icon icon="trend-up" size="12"></re-icon> View Demographics &amp; Stats</button>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:14px 18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;background:#fbfcfd;border-radius:8px;">'
    + '    <div style="display:flex;align-items:center;gap:10px;">'
    + '      <div style="width:36px;height:36px;border-radius:8px;background:rgba(16,185,129,0.1);color:#059669;display:flex;align-items:center;justify-content:center;font-size:16px;">'
    + '        <re-icon icon="users" size="18"></re-icon>'
    + '      </div>'
    + '      <div>'
    + '        <div style="font-size:13px;font-weight:700;color:var(--td);">' + studentCount + ' Enrolled Students' + (cls.section ? (' in Section ' + escapeHtml(cls.section)) : '') + '</div>'
    + '        <div style="font-size:11.5px;color:var(--tmu);">View gender ratio, dayscholar &amp; hosteller distribution for this class.</div>'
    + '      </div>'
    + '    </div>'
    + '    <button type="button" class="btn-out btn-sm" onclick="switchClassTab(\'students\')"><re-icon icon="arrow-right" size="13"></re-icon> View Roster Stats</button>'
    + '  </div>'
    + '</div>'
    + '<!-- 6. FOOTER TOOLBAR -->'
    + '<div class="subj-overview-ft">'
    + '  <button type="button" class="btn bdan bsm" onclick="unifiedDeleteClass()"><re-icon icon="trash2" size="14"></re-icon> Delete Class</button>'
    + '  <div style="display:flex;gap:10px;align-items:center;">'
    + '    <button type="button" class="btn-out bsm" onclick="switchClassTab(\'edit\')"><re-icon icon="edit" size="14"></re-icon> Edit Details</button>'
    + '    <button type="button" class="btn-pri bsm" onclick="asgnSubj(\'' + cls._id + '\')"><re-icon icon="plus" size="14"></re-icon> Assign Subject</button>'
    + '  </div>'
    + '</div>';

  _populateClassAdvisorSection(cls, _getAllTeachersList());
  _populateClassRepresentativesSection(cls);
  _populateClassRoomBoardSection(cls);
}

function _renderClassSubjectsTab(cls, customAssignments) {
  var container = document.getElementById('cm-subjects-container');
  if (!container || !cls) return;

  var assignments = Array.isArray(customAssignments)
    ? customAssignments
    : (DB.get('assignments') || []).filter(function (a) { return String(a.classId) === String(cls._id); });

  if (!assignments.length) {
    container.innerHTML = '<div style="text-align:center;padding:36px 18px;color:var(--tmu);font-size:13px;background:var(--bg2,#f8faf8);">'
      + '<div style="font-size:28px;margin-bottom:6px;color:var(--tdi);"><re-icon icon="book-open" size="28"></re-icon></div>'
      + '<div style="font-weight:700;color:var(--td);font-size:14px;margin-bottom:4px;">No Curriculum Subjects Assigned</div>'
      + '<div style="max-width:380px;margin:0 auto 12px;font-size:12px;color:var(--tmu);">Assign subjects and faculty mentors to schedule timetables and track student attendance for this class section.</div>'
      + '<button type="button" class="btn-pri btn-sm" onclick="asgnSubj(\'' + cls._id + '\')"><re-icon icon="plus" size="13"></re-icon> Assign Subject</button>'
      + '</div>';
    return;
  }

  var displayHall = (cls.roomId && cls.roomId.hallNo) || cls.hallNo || '—';

  var rowsHtml = assignments.map(function (a, idx) {
    var subj = (DB.get('subjects') || []).find(function (s) { return String(s._id) === String(a.subjectId); });
    var subjCode = subj ? (subj.courseCode || subj.code || subj.shortForm || '—') : '—';
    var subjType = subj && subj.type ? subj.type : 'Theory';
    var typeLower = subjType.toLowerCase();
    var credits = subj && subj.credits != null ? subj.credits : '3';

    var tch = (DB.get('teachers') || []).find(function (t) { return String(t._id) === String(a.teacherId); });
    var tName = a.teacherName || (tch ? tch.name : 'Unassigned');
    var tDesig = tch && (tch.designation || tch.desig) ? tch.designation || tch.desig : '';

    var hall = a.hallNo ? a.hallNo : displayHall;

    return '<tr style="border-bottom:1px solid var(--br);">'
      + '<td style="padding:10px 14px;font-size:12px;color:var(--tmu);font-weight:600;width:38px;">' + (idx + 1) + '</td>'
      + '<td style="padding:10px 14px;">'
      + '  <div style="font-weight:700;color:var(--td);font-size:13px;">' + escapeHtml(a.subjectName || (subj ? subj.name : 'Subject')) + '</div>'
      + '  <div style="font-size:11px;color:var(--tmu);margin-top:2px;display:flex;align-items:center;gap:6px;">'
      + '    <span style="font-family:monospace;background:var(--gLt);color:var(--gD);padding:1px 5px;border-radius:4px;font-weight:700;">' + escapeHtml(subjCode) + '</span>'
      + '    <span>' + credits + ' Credits</span>'
      + '  </div>'
      + '</td>'
      + '<td style="padding:10px 14px;">'
      + '  <span class="subj-type-badge ' + (typeLower === 'lab' ? 'lab' : 'theory') + '" style="font-size:11.5px;padding:2px 8px;">' + escapeHtml(subjType) + '</span>'
      + '</td>'
      + '<td style="padding:10px 14px;">'
      + '  <div style="font-weight:600;color:var(--td);font-size:12.5px;display:flex;align-items:center;gap:6px;">'
      + '    <re-icon icon="teacher" size="14" style="color:var(--gD);"></re-icon> ' + escapeHtml(tName)
      + '  </div>'
      + (tDesig ? '<div style="font-size:11px;color:var(--tmu);margin-top:2px;">' + escapeHtml(tDesig) + '</div>' : '')
      + '</td>'
      + '<td style="padding:10px 14px;font-size:12.5px;font-weight:600;color:var(--td);">'
      + '  <span style="display:inline-flex;align-items:center;gap:4px;"><re-icon icon="pin" size="12" style="color:var(--tmu);"></re-icon> ' + escapeHtml(hall) + '</span>'
      + '</td>'
      + '<td style="padding:10px 14px;text-align:right;">'
      + '  <button type="button" class="btn bdan bxs" onclick="rmAsgn(\'' + a._id + '\',\'class\')" title="Remove Assignment" style="padding:4px 8px;border-radius:6px;"><re-icon icon="trash2" size="12"></re-icon></button>'
      + '</td>'
      + '</tr>';
  }).join('');

  container.innerHTML = '<table class="tbl" style="width:100%;margin:0;border-collapse:collapse;">'
    + '<thead><tr style="background:#f8fafc;border-bottom:1px solid var(--br);">'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">#</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Subject</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Type</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Faculty</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Location</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:right;text-transform:uppercase;">Action</th>'
    + '</tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody>'
    + '</table>';
}

function _renderClassStudentsTab(cls, students) {
  var container = document.getElementById('cm-roster-container');
  if (!container) return;

  if (students === null || students === undefined) {
    container.innerHTML = '<div style="text-align:center;padding:36px 18px;color:var(--tmu);font-size:13px;background:var(--bg2,#f8faf8);border-radius:12px;border:1px dashed var(--br);">'
      + '<div style="font-size:28px;margin-bottom:6px;color:var(--tdi);"><re-icon icon="trend-up" size="28"></re-icon></div>'
      + '<div style="font-weight:700;color:var(--td);font-size:14px;margin-bottom:4px;">Demographics &amp; Stats Not Loaded</div>'
      + '<div style="max-width:360px;margin:0 auto 12px;font-size:12px;color:var(--tmu);">Click below to load live enrolled student demographics from the institution database.</div>'
      + '<button type="button" class="btn-pri btn-sm" onclick="loadClassStudents()"><re-icon icon="refresh" size="13"></re-icon> Load Demographics</button>'
      + '</div>';
    return;
  }

  var list = Array.isArray(students) ? students : [];
  var countEl = document.getElementById('cm-roster-count');
  if (countEl) countEl.textContent = list.length + ' Enrolled';
  var badgeEl = document.getElementById('cm-badge-stu');
  if (badgeEl) badgeEl.textContent = list.length;

  if (!list.length) {
    container.innerHTML = '<div style="text-align:center;padding:36px 18px;color:var(--tmu);font-size:13px;background:var(--bg2,#f8faf8);border-radius:12px;border:1px dashed var(--br);">'
      + '<re-icon icon="users" size="28" style="color:var(--tdi);margin-bottom:8px;"></re-icon>'
      + '<div style="font-weight:700;color:var(--td);font-size:14px;margin-bottom:4px;">No Students Enrolled</div>'
      + '<div style="font-size:12px;color:var(--tmu);max-width:320px;margin:0 auto 14px;">This class section currently has 0 enrolled students in the database.</div>'
      + '<button type="button" class="btn-out btn-sm" onclick="openClassInStudentsTab()"><re-icon icon="users" size="13"></re-icon> Manage in Students Tab</button>'
      + '</div>';
    return;
  }

  var total = list.length;
  var boys = 0;
  var girls = 0;
  var othersGender = 0;
  var dayScholars = 0;
  var hostellers = 0;

  var hostellerBoys = 0;
  var hostellerGirls = 0;
  var hostellerOthers = 0;

  var dayScholarBoys = 0;
  var dayScholarGirls = 0;
  var dayScholarOthers = 0;

  list.forEach(function (s) {
    var g = String(s.gender || '').toLowerCase().trim();
    var isBoy = (g === 'male' || g === 'boy');
    var isGirl = (g === 'female' || g === 'girl');
    var isOther = (!isBoy && !isGirl);

    if (isBoy) boys++;
    else if (isGirl) girls++;
    else othersGender++;

    var res = String(s.residency || '').toLowerCase().trim();
    var isHostel = res.includes('hostel');

    if (isHostel) {
      hostellers++;
      if (isBoy) hostellerBoys++;
      else if (isGirl) hostellerGirls++;
      else hostellerOthers++;
    } else {
      dayScholars++;
      if (isBoy) dayScholarBoys++;
      else if (isGirl) dayScholarGirls++;
      else dayScholarOthers++;
    }
  });

  function getPct(num, denom) {
    if (!denom || denom <= 0) return '0%';
    return Math.round((num / denom) * 100) + '%';
  }

  var boysPct = getPct(boys, total);
  var girlsPct = getPct(girls, total);
  var dayScholarsPct = getPct(dayScholars, total);
  var hostellersPct = getPct(hostellers, total);

  var hGirlsClassPct = getPct(hostellerGirls, total);
  var hGirlsHostelPct = getPct(hostellerGirls, hostellers);
  var hGirlsGenderPct = getPct(hostellerGirls, girls);

  var hBoysClassPct = getPct(hostellerBoys, total);
  var hBoysHostelPct = getPct(hostellerBoys, hostellers);
  var hBoysGenderPct = getPct(hostellerBoys, boys);

  var dsGirlsClassPct = getPct(dayScholarGirls, total);
  var dsGirlsDsPct = getPct(dayScholarGirls, dayScholars);
  var dsGirlsGenderPct = getPct(dayScholarGirls, girls);

  var dsBoysClassPct = getPct(dayScholarBoys, total);
  var dsBoysDsPct = getPct(dayScholarBoys, dayScholars);
  var dsBoysGenderPct = getPct(dayScholarBoys, boys);

  var boysWidthPct = total > 0 ? (boys / total) * 100 : 0;
  var girlsWidthPct = total > 0 ? (girls / total) * 100 : 0;
  var otherWidthPct = total > 0 ? (othersGender / total) * 100 : 0;

  var dsWidthPct = total > 0 ? (dayScholars / total) * 100 : 0;
  var hWidthPct = total > 0 ? (hostellers / total) * 100 : 0;

  container.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:16px;">'

    + '<!-- 1. TOP OVERALL STATS KPI GRID -->'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;">'
    + '  <div class="subj-stat-card stat-green">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Total Count</span><div class="subj-stat-ic"><re-icon icon="users" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + total + ' <span class="subj-stat-unit">Students</span></div>'
    + '    <div class="subj-stat-sub">100% Class Roster</div>'
    + '  </div>'

    + '  <div class="subj-stat-card stat-blue">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Boys</span><div class="subj-stat-ic"><re-icon icon="user" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + boys + ' <span class="subj-stat-unit">' + boysPct + '</span></div>'
    + '    <div class="subj-stat-sub">Male students</div>'
    + '  </div>'

    + '  <div class="subj-stat-card stat-pink">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Girls</span><div class="subj-stat-ic"><re-icon icon="user" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + girls + ' <span class="subj-stat-unit">' + girlsPct + '</span></div>'
    + '    <div class="subj-stat-sub">Female students</div>'
    + '  </div>'
    + '</div>'

    + '<!-- 2. SEPARATE STATS: HOSTELLER/DAYSCHOLAR x BOYS/GIRLS -->'
    + '<div class="subj-section-card" style="margin:0;">'
    + '  <div class="subj-section-hd" style="padding:11px 16px;">'
    + '    <div class="subj-section-title" style="font-size:13px;"><re-icon icon="trend-up" size="14"></re-icon> <span>Demographic Cross-Segment Stats</span></div>'
    + '    <span style="font-size:11px;color:var(--tmu);">Separate counts for hostellers &amp; day scholars by gender</span>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:14px 16px;">'
    + '    <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:12px;">'

    + '      <!-- Hostellers - Girls -->'
    + '      <div style="background:rgba(236,72,153,0.04);border:1px solid rgba(236,72,153,0.22);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;justify-content:space-between;position:relative;">'
    + '        <div>'
    + '          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
    + '            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#db2777;">Hostellers — Girls</span>'
    + '            <span style="background:rgba(236,72,153,0.14);color:#db2777;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:8px;">Hostel · Female</span>'
    + '          </div>'
    + '          <div style="font-size:26px;font-weight:800;color:var(--td);line-height:1.1;display:flex;align-items:baseline;gap:6px;">'
    + '            ' + hostellerGirls
    + '            <span style="font-size:12px;font-weight:600;color:var(--tmu);">' + hGirlsClassPct + ' of class</span>'
    + '          </div>'
    + '        </div>'
    + '        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed rgba(236,72,153,0.2);display:flex;align-items:center;justify-content:space-between;font-size:11.5px;color:var(--tmu);">'
    + '          <span>Share of Hostellers: <b style="color:var(--td);">' + hGirlsHostelPct + '</b></span>'
    + '          <span>Share of Girls: <b style="color:var(--td);">' + hGirlsGenderPct + '</b></span>'
    + '        </div>'
    + '      </div>'

    + '      <!-- Hostellers - Boys -->'
    + '      <div style="background:rgba(99,102,241,0.04);border:1px solid rgba(99,102,241,0.22);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;justify-content:space-between;position:relative;">'
    + '        <div>'
    + '          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
    + '            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#4f46e5;">Hostellers — Boys</span>'
    + '            <span style="background:rgba(99,102,241,0.14);color:#4f46e5;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:8px;">Hostel · Male</span>'
    + '          </div>'
    + '          <div style="font-size:26px;font-weight:800;color:var(--td);line-height:1.1;display:flex;align-items:baseline;gap:6px;">'
    + '            ' + hostellerBoys
    + '            <span style="font-size:12px;font-weight:600;color:var(--tmu);">' + hBoysClassPct + ' of class</span>'
    + '          </div>'
    + '        </div>'
    + '        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed rgba(99,102,241,0.2);display:flex;align-items:center;justify-content:space-between;font-size:11.5px;color:var(--tmu);">'
    + '          <span>Share of Hostellers: <b style="color:var(--td);">' + hBoysHostelPct + '</b></span>'
    + '          <span>Share of Boys: <b style="color:var(--td);">' + hBoysGenderPct + '</b></span>'
    + '        </div>'
    + '      </div>'

    + '      <!-- Day Scholars - Girls -->'
    + '      <div style="background:rgba(245,158,11,0.04);border:1px solid rgba(245,158,11,0.22);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;justify-content:space-between;position:relative;">'
    + '        <div>'
    + '          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
    + '            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#d97706;">Day Scholars — Girls</span>'
    + '            <span style="background:rgba(245,158,11,0.14);color:#d97706;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:8px;">Day Scholar · Female</span>'
    + '          </div>'
    + '          <div style="font-size:26px;font-weight:800;color:var(--td);line-height:1.1;display:flex;align-items:baseline;gap:6px;">'
    + '            ' + dayScholarGirls
    + '            <span style="font-size:12px;font-weight:600;color:var(--tmu);">' + dsGirlsClassPct + ' of class</span>'
    + '          </div>'
    + '        </div>'
    + '        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed rgba(245,158,11,0.2);display:flex;align-items:center;justify-content:space-between;font-size:11.5px;color:var(--tmu);">'
    + '          <span>Share of Day Scholars: <b style="color:var(--td);">' + dsGirlsDsPct + '</b></span>'
    + '          <span>Share of Girls: <b style="color:var(--td);">' + dsGirlsGenderPct + '</b></span>'
    + '        </div>'
    + '      </div>'

    + '      <!-- Day Scholars - Boys -->'
    + '      <div style="background:rgba(59,130,246,0.04);border:1px solid rgba(59,130,246,0.22);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;justify-content:space-between;position:relative;">'
    + '        <div>'
    + '          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
    + '            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#2563eb;">Day Scholars — Boys</span>'
    + '            <span style="background:rgba(59,130,246,0.14);color:#2563eb;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:8px;">Day Scholar · Male</span>'
    + '          </div>'
    + '          <div style="font-size:26px;font-weight:800;color:var(--td);line-height:1.1;display:flex;align-items:baseline;gap:6px;">'
    + '            ' + dayScholarBoys
    + '            <span style="font-size:12px;font-weight:600;color:var(--tmu);">' + dsBoysClassPct + ' of class</span>'
    + '          </div>'
    + '        </div>'
    + '        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed rgba(59,130,246,0.2);display:flex;align-items:center;justify-content:space-between;font-size:11.5px;color:var(--tmu);">'
    + '          <span>Share of Day Scholars: <b style="color:var(--td);">' + dsBoysDsPct + '</b></span>'
    + '          <span>Share of Boys: <b style="color:var(--td);">' + dsBoysGenderPct + '</b></span>'
    + '        </div>'
    + '      </div>'

    + '    </div>'
    + '  </div>'
    + '</div>'

    + '<!-- 3. VISUAL DISTRIBUTION BARS -->'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px;">'
    + '  <!-- Gender Balance Bar -->'
    + '  <div style="background:#f8fafc;padding:12px 16px;border-radius:12px;border:1px solid var(--br);">'
    + '    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:12px;">'
    + '      <span style="font-weight:700;color:var(--td);display:flex;align-items:center;gap:6px;">'
    + '        <re-icon icon="users" size="14" style="color:var(--gD);"></re-icon> Gender Ratio'
    + '      </span>'
    + '      <span style="font-size:11px;font-weight:600;color:var(--tmu);">' + boys + ' Boys (' + boysPct + ') · ' + girls + ' Girls (' + girlsPct + ')' + (othersGender > 0 ? (' · ' + othersGender + ' Other') : '') + '</span>'
    + '    </div>'
    + '    <div style="height:10px;border-radius:5px;background:#e2e8f0;overflow:hidden;display:flex;">'
    + '      <div style="width:' + boysWidthPct + '%;background:#3b82f6;" title="Boys: ' + boys + ' (' + boysPct + ')"></div>'
    + '      <div style="width:' + girlsWidthPct + '%;background:#ec4899;" title="Girls: ' + girls + ' (' + girlsPct + ')"></div>'
    +        (othersGender > 0 ? '<div style="width:' + otherWidthPct + '%;background:#8b5cf6;" title="Other: ' + othersGender + '"></div>' : '')
    + '    </div>'
    + '    <div style="display:flex;gap:14px;margin-top:6px;font-size:11px;color:var(--tmu);">'
    + '      <span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:2px;background:#3b82f6;"></span> Boys ' + boysPct + '</span>'
    + '      <span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:2px;background:#ec4899;"></span> Girls ' + girlsPct + '</span>'
    +        (othersGender > 0 ? '<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:2px;background:#8b5cf6;"></span> Other ' + getPct(othersGender, total) + '</span>' : '')
    + '    </div>'
    + '  </div>'

    + '  <!-- Residency Balance Bar -->'
    + '  <div style="background:#f8fafc;padding:12px 16px;border-radius:12px;border:1px solid var(--br);">'
    + '    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:12px;">'
    + '      <span style="font-weight:700;color:var(--td);display:flex;align-items:center;gap:6px;">'
    + '        <re-icon icon="home" size="14" style="color:#d97706;"></re-icon> Residency Ratio'
    + '      </span>'
    + '      <span style="font-size:11px;font-weight:600;color:var(--tmu);">' + dayScholars + ' Day Scholars (' + dayScholarsPct + ') · ' + hostellers + ' Hostellers (' + hostellersPct + ')</span>'
    + '    </div>'
    + '    <div style="height:10px;border-radius:5px;background:#e2e8f0;overflow:hidden;display:flex;">'
    + '      <div style="width:' + dsWidthPct + '%;background:#f59e0b;" title="Day Scholars: ' + dayScholars + ' (' + dayScholarsPct + ')"></div>'
    + '      <div style="width:' + hWidthPct + '%;background:#6366f1;" title="Hostellers: ' + hostellers + ' (' + hostellersPct + ')"></div>'
    + '    </div>'
    + '    <div style="display:flex;gap:14px;margin-top:6px;font-size:11px;color:var(--tmu);">'
    + '      <span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:2px;background:#f59e0b;"></span> Day Scholars ' + dayScholarsPct + '</span>'
    + '      <span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:2px;background:#6366f1;"></span> Hostellers ' + hostellersPct + '</span>'
    + '    </div>'
    + '  </div>'
    + '</div>'

    + '</div>';
}

function filterClassRoster(query) {
  if (!_classRosterCache) return;
  var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
  _renderClassStudentsTab(cls, _classRosterCache);
}
window.filterClassRoster = filterClassRoster;

function loadClassStudents() {
  if (!currentClassId) return;
  var container = document.getElementById('cm-roster-container');
  var loadBtn = document.getElementById('cm-full-load-stus-btn');

  if (loadBtn) {
    loadBtn.disabled = true;
    loadBtn.innerHTML = '<re-icon icon="hourglass" size="13"></re-icon> Loading stats…';
  }
  if (container) {
    container.innerHTML = '<div style="text-align:center;padding:28px 18px;color:var(--tmu);font-size:13px;"><re-icon icon="hourglass" size="20"></re-icon><div style="margin-top:6px;">Loading enrolled student demographics &amp; stats…</div></div>';
  }

  var tok = getToken();
  if (!tok) {
    if (loadBtn) {
      loadBtn.disabled = false;
      loadBtn.innerHTML = '<re-icon icon="refresh" size="13"></re-icon> Refresh Stats';
    }
    return;
  }

  fetch('/api/students?classId=' + encodeURIComponent(currentClassId) + '&roster=1', { headers: { 'Authorization': 'Bearer ' + tok } })
    .then(function (r) { return r.json(); })
    .then(function (roster) {
      var list = Array.isArray(roster) ? roster : [];
      _classRosterCache = list;
      var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
      if (cls) cls.studentCount = list.length;

      // Update badges and cards
      var badgeEl = document.getElementById('cm-badge-stu');
      if (badgeEl) badgeEl.textContent = list.length;
      var countEl = document.getElementById('cm-roster-count');
      if (countEl) countEl.textContent = list.length + ' Enrolled';
      var cardValEl = document.getElementById('cd-stat-stu-val');
      if (cardValEl) cardValEl.textContent = list.length;

      _renderClassStudentsTab(cls, list);

      if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.innerHTML = '<re-icon icon="refresh" size="13"></re-icon> Refresh Stats';
      }
    })
    .catch(function (err) {
      console.warn('Failed to load roster:', err);
      if (container) {
        container.innerHTML = '<div style="text-align:center;padding:24px;color:#dc2626;font-size:12.5px;"><re-icon icon="alert-circle" size="18"></re-icon><div style="margin-top:4px;">Failed to load student statistics. Please check network connection.</div></div>';
      }
      if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.innerHTML = '<re-icon icon="refresh" size="13"></re-icon> Retry';
      }
    });
}
window.loadClassStudents = loadClassStudents;

async function unifiedDeleteClass() {
  if (!currentClassId) return;
  var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
  if (!cls) return;

  const ok = await showConfirm(
    'Delete class "' + cls.name + '"?\n\nThis will also remove all subject assignments. This cannot be undone.',
    'Delete Class',
    null,
    null,
    { danger: true, confirmText: 'Delete Class' }
  );
  if (!ok) return;

  dbToast('Deleting class...', 'saving');
  apiDeleteClass(currentClassId, cls.name).then(function () {
    addLog('Class Deleted', '"' + cls.name + '"');
    closeModalBg('m-cls-detail');
    if (structureContext && structureContext.deptId) {
      renderClassSubjectView(structureContext.deptId);
    }
    dbToast('Class deleted', 'success');
  }).catch(function () {
    dbToast('Delete failed', 'error');
  });
}
window.unifiedDeleteClass = unifiedDeleteClass;

function openClassModal(classId, initialTab) {
  var cls = DB.get('classes').find(function (c) { return c._id === classId; });
  if (!cls) return;
  currentClassId = classId;
  _classRosterCache = null; // reset roster cache for fresh load
  updateStructureUrlParams({ cls: classId });

  var searchInput = document.getElementById('cm-stu-search');
  if (searchInput) searchInput.value = '';

  var backBtn = document.getElementById('cd-back-btn');
  if (backBtn) {
    if (window._classModalReturnDeptId) {
      backBtn.style.display = 'inline-flex';
    } else {
      backBtn.style.display = 'none';
    }
  }

  // 1. Header
  _updateClassUnifiedModalHeader(cls);

  // 2. Fetch fresh teachers if not cached
  var allTeachers = _getAllTeachersList();
  if (!allTeachers.length) {
    apiCall('GET', '/teachers').then(function (list) {
      if (Array.isArray(list) && list.length) {
        _teacherData = list;
        if (currentClassId === classId) {
          _populateClassAdvisorSection(cls, _getAllTeachersList());
        }
      }
    }).catch(function (err) {
      console.warn('[EAMS] Failed to fetch teachers for class modal:', err);
    });
  }

  // 3. Tab contents
  _renderClassUnifiedOverview(cls);
  _renderClassSubjectsTab(cls);
  _renderClassStudentsTab(cls, null);
  _populateEditClassForm(cls);

  // 4. Switch to target tab
  switchClassTab(initialTab || 'overview');

  openModal_('m-cls-detail');
}
window.openClassModal = openClassModal;

function openCD(classId, fromDeptId) {
  window._classModalReturnDeptId = fromDeptId || null;
  openClassModal(classId, 'overview');
}
window.openCD = openCD;

function backFromClassModal() {
  var deptId = window._classModalReturnDeptId;
  window._classModalReturnDeptId = null;
  closeModalBg('m-cls-detail');
  if (deptId) {
    openDeptModal(deptId, 'classes');
  }
}
window.backFromClassModal = backFromClassModal;

function asgnSubj(classId) {
  if (classId) currentClassId = classId;
  oasc();
}
window.asgnSubj = asgnSubj;

var _currentClassRoom = null;

function _populateClassRoomBoardSection(cls) {
  var titleEl = document.getElementById('cd-room-board-title');
  var subEl = document.getElementById('cd-room-board-sub');
  var btnEl = document.getElementById('cd-room-board-btn');
  if (!titleEl || !subEl) return;

  var rm = (cls.roomId && typeof cls.roomId === 'object') ? cls.roomId : null;
  var rId = rm ? String(rm._id) : (cls.roomId ? String(cls.roomId) : '');

  // Cross-reference with _facilityRooms to get enriched board data
  var facilityRoom = null;
  if (_facilityRooms && _facilityRooms.length) {
    if (rId) {
      facilityRoom = _facilityRooms.find(function (r) { return String(r._id) === rId; });
    }
    if (!facilityRoom && cls.hallNo) {
      facilityRoom = _facilityRooms.find(function (r) {
        return (r.hallNo && r.hallNo.toLowerCase() === cls.hallNo.toLowerCase()) ||
          (r.name && r.name.toLowerCase() === cls.hallNo.toLowerCase());
      });
    }
  }

  if (facilityRoom) {
    if (!rm) {
      rm = facilityRoom;
    } else if (!rm.board && facilityRoom.board) {
      rm.board = facilityRoom.board;
    }
  }

  // Lazy-fetch board details if room is known but board info is missing
  if (rm && !rm.board && !rm._fetchingBoard && (rId || rm.hallNo || cls.hallNo)) {
    rm._fetchingBoard = true;
    var fetchPath = rId ? ('/timetable/rooms/' + encodeURIComponent(rId)) : ('/timetable/rooms?search=' + encodeURIComponent(rm.hallNo || cls.hallNo || ''));
    apiCall('GET', fetchPath).then(function (res) {
      var foundBoard = null;
      if (res && res.data && (res.data.board || (res.data.assignedBoards && res.data.assignedBoards[0]))) {
        foundBoard = res.data.board || res.data.assignedBoards[0];
      } else if (res && res.board) {
        foundBoard = res.board;
      } else if (Array.isArray(res) && res.length && res[0].board) {
        foundBoard = res[0].board;
      }
      if (foundBoard) {
        rm.board = foundBoard;
        if (cls.roomId && typeof cls.roomId === 'object') cls.roomId.board = foundBoard;
        if (typeof currentClassId !== 'undefined' && String(currentClassId) === String(cls._id)) {
          _populateClassRoomBoardSection(cls);
        }
      }
    }).catch(function () {});
  }

  _currentClassRoom = rm;

  if (rm) {
    var bldg = rm.buildingId;
    var bldgName = (bldg && typeof bldg === 'object') ? (bldg.name || bldg.code) : (rm.buildingName || 'Facility');
    var floorTxt = (rm.floor !== undefined && rm.floor !== null) ? ('Floor ' + rm.floor) : '';
    titleEl.textContent = (rm.hallNo || rm.name) + ' — ' + bldgName + (floorTxt ? ' (' + floorTxt + ')' : '');

    var isLab = (rm.type === 'Lab' || rm.type === 'Laboratory' || (rm.category && rm.category.toLowerCase().includes('lab')));
    var subParts = [];
    subParts.push(rm.type || 'Classroom');
    if (rm.capacity) subParts.push(rm.capacity + ' seats');
    if (isLab) {
      subParts.push('<re-icon icon="flask"></re-icon> Laboratory (No Board Required)');
    } else if (rm.board) {
      var bObj = (typeof rm.board === 'object') ? rm.board : {};
      var bDevice = bObj.deviceId || bObj.boardName || bObj.boardId || 'Board Linked';
      var bStatus = bObj.connectionStatus || 'Connected';
      subParts.push('<re-icon icon="tv"></re-icon> ' + escapeHtml(bDevice) + ' (' + escapeHtml(bStatus) + ')');
    } else {
      subParts.push('<re-icon icon="tv"></re-icon> No Board Linked');
    }
    subEl.innerHTML = subParts.join(' • ');
    if (btnEl) btnEl.innerHTML = 'Open in Facilities Hub <re-icon icon="arrow-right"></re-icon>';
  } else if (cls.hallNo) {
    titleEl.textContent = 'Hall: ' + cls.hallNo;
    subEl.textContent = 'Unmapped in Facilities Hub • Click below to map facility';
    if (btnEl) btnEl.innerHTML = 'Assign in Facilities Hub <re-icon icon="arrow-right"></re-icon>';
  } else {
    titleEl.textContent = 'No Room Assigned';
    subEl.textContent = 'Connect this class to a campus hall and smart board';
    if (btnEl) btnEl.innerHTML = 'Assign Room in Facilities Hub <re-icon icon="arrow-right"></re-icon>';
  }
}

function openRoomBoardFromClass() {
  if (_currentClassRoom) {
    var bId = '';
    if (_currentClassRoom.buildingId && typeof _currentClassRoom.buildingId === 'object') {
      bId = _currentClassRoom.buildingId._id || '';
    } else if (_currentClassRoom.buildingId) {
      bId = _currentClassRoom.buildingId;
    }
    var fl = (_currentClassRoom.floor !== undefined && _currentClassRoom.floor !== null) ? _currentClassRoom.floor : '';
    var uId = _currentClassRoom._id || '';
    var params = [];
    if (bId) params.push('blockId=' + encodeURIComponent(bId));
    if (fl !== '') params.push('floorNum=' + encodeURIComponent(fl));
    if (uId) params.push('unitId=' + encodeURIComponent(uId));
    var url = 'rooms.html' + (params.length ? '?' + params.join('&') : '');
    window.location.href = url;
  } else {
    window.location.href = 'rooms.html';
  }
}

function formatBatchShort(batch) {
  if (!batch) return '';
  var parts = String(batch).split('-').map(function (s) { return s.trim(); });
  if (parts.length === 2) {
    var start = parts[0].slice(-2);
    var end = parts[1].slice(-2);
    return start + '-' + end;
  }
  return String(batch);
}

function editClsInline() {
  switchClassTab('edit');
}
window.editClsInline = editClsInline;

function ecAutoName() {
  var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
  if (!cls) return;
  var deptId = getFieldValue('ec-dept') || cls.deptId;
  var batch = getFieldValue('ec-batch') || cls.batch;
  var dept = DB.get('depts').find(function (d) { return d._id === deptId; });
  var section = (document.getElementById('ec-sec') ? getFieldValue('ec-sec') : '') || cls.section;
  if (!section && cls.name) {
    var m = cls.name.match(/(?:SEC\s*|[- ])([A-Za-z0-9]{1,3})$/i);
    if (m) section = m[1].toUpperCase();
  }
  if (dept && batch) {
    var batchV = formatBatchShort(batch);
    var nmEl = document.getElementById('ec-nm');
    if (nmEl) nmEl.value = batchV + ' ' + dept.code + (section ? ('-' + section) : '');
  }
}

function ecOnRoomChange() {
  var sel = document.getElementById('ec-room');
  var hallInput = document.getElementById('ec-hall');
  if (!sel || !hallInput) return;
  var opt = sel.options[sel.selectedIndex];
  hallInput.value = (opt && opt.getAttribute('data-hall')) || (opt && opt.value ? opt.text : '');
}

function saveEditCls() {
  if (!currentClassId) return;
  var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
  var deptId = getFieldValue('ec-dept') || (cls ? cls.deptId : '');
  var section = (document.getElementById('ec-sec') ? getFieldValue('ec-sec') : '') || (cls ? (cls.section || '') : '');
  if (!section && cls && cls.name) {
    var m = cls.name.match(/(?:SEC\s*|[- ])([A-Za-z0-9]{1,3})$/i);
    if (m) section = m[1].toUpperCase();
  }
  var roomId = getFieldValue('ec-room') || null;
  var hallNo = getFieldValue('ec-hall');
  if (roomId && !hallNo) {
    var sel = document.getElementById('ec-room');
    if (sel && sel.selectedIndex >= 0) {
      hallNo = sel.options[sel.selectedIndex].getAttribute('data-hall') || '';
    }
  }
  var year = getFieldValue('ec-yr');
  var sem = getFieldValue('ec-sem');
  var batch = getFieldValue('ec-batch') || (cls ? cls.batch : '');
  var dept = DB.get('depts').find(function (d) { return d && (d._id === deptId || (cls && d._id === cls.deptId)); });
  var deptName = dept ? dept.name : (cls ? cls.deptName : '');
  var name = getFieldValue('ec-nm') || (dept ? (formatBatchShort(batch) + ' ' + dept.code + (section ? ('-' + section) : '')) : (cls ? cls.name : ''));

  if (!batch) {
    showToast('Batch is required', 'warn');
    return;
  }

  var ecRep1 = document.getElementById('ec-rep1');
  var ecRep2 = document.getElementById('ec-rep2');
  var rep1Id = ecRep1 ? ecRep1.value : '';
  var rep2Id = ecRep2 ? ecRep2.value : '';
  if (rep1Id && rep2Id && String(rep1Id) === String(rep2Id)) {
    dbToast('Representative 1 and Representative 2 must be different students', 'warn');
    return;
  }

  var updatePayload = {
    section: section, roomId: roomId, hallNo: hallNo, name: name,
    year: year, sem: sem, batch: batch, deptId: deptId, deptName: deptName
  };
  if (rep1Id) {
    updatePayload.representative1Id = rep1Id;
    updatePayload.representative2Id = rep2Id || null;
  }

  dbToast('Saving changes...', 'saving');
  apiUpdateClass(currentClassId, updatePayload).then(function (d) {
    if (!d || d.error) {
      dbToast('Update failed: ' + (d && d.error ? d.error : 'Unknown'), 'error');
      return;
    }
    if (cls) {
      cls.section = section;
      cls.batch = batch;
      cls.name = name;
      cls.deptId = deptId;
      cls.deptName = deptName;
      cls.year = year;
      cls.sem = sem;
      cls.roomId = roomId;
      cls.hallNo = hallNo;
    }
    addLog('Class Updated', '"' + name + '"');
    openClassModal(currentClassId, 'overview');
    if (structureContext && structureContext.deptId) renderClassSubjectView(structureContext.deptId);
    dbToast('Class updated successfully', 'success');
  }).catch(function (err) {
    dbToast('Failed to update class: ' + (err.message || 'Network error'), 'error');
  });
}
window.saveEditCls = saveEditCls;

function openAdvisorModal() {
  if (!currentClassId) return;
  var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
  if (!cls) return;

  var subEl = document.getElementById('adv-modal-sub');
  if (subEl) {
    subEl.textContent = cls.name + ' — ' + (cls.deptName || 'Department');
  }

  var currentEl = document.getElementById('adv-modal-current');
  var allTeachers = _getAllTeachersList();
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

  var currentAdvName = (assignedTeacher ? (assignedTeacher.name || assignedTeacher.fullName) : cls.advisorTeacherName) || '';
  if (currentEl) {
    currentEl.innerHTML = currentAdvName
      ? '<span style="color:var(--gD);font-weight:700;"><re-icon icon="user-check"></re-icon> ' + escapeHtml(currentAdvName) + '</span>'
      : '<span style="color:var(--tmu);">Not Assigned</span>';
  }

  var selectEl = document.getElementById('adv-modal-select');
  if (selectEl) {
    function isSameDept(t) {
      var tDeptId = t.deptId ? (typeof t.deptId === 'object' && t.deptId._id ? t.deptId._id : t.deptId) : '';
      var cDeptId = cls.deptId ? (typeof cls.deptId === 'object' && cls.deptId._id ? cls.deptId._id : cls.deptId) : '';
      var tDept = (t.dept || t.department || '').toLowerCase().trim();
      var cDeptName = (cls.deptName || '').toLowerCase().trim();
      var cDeptCode = (cls.deptCode || '').toLowerCase().trim();
      return (tDeptId && cDeptId && String(tDeptId) === String(cDeptId)) ||
        (tDept && (tDept === cDeptName || tDept === cDeptCode));
    }

    var deptTeachers = [];
    var otherTeachers = [];

    allTeachers.forEach(function (t) {
      if (isSameDept(t)) {
        deptTeachers.push(t);
      } else {
        otherTeachers.push(t);
      }
    });

    deptTeachers.sort(function (a, b) {
      var na = (a.name || a.fullName || '').toLowerCase();
      var nb = (b.name || b.fullName || '').toLowerCase();
      return na.localeCompare(nb);
    });

    otherTeachers.sort(function (a, b) {
      var na = (a.name || a.fullName || '').toLowerCase();
      var nb = (b.name || b.fullName || '').toLowerCase();
      return na.localeCompare(nb);
    });

    var selectedId = assignedTeacher ? (assignedTeacher._id || assignedTeacher.shadowId || assignedTeacher.trackId) : (cls.advisorTeacherId || '');

    var optionsHtml = '<option value="">— None (Unassigned) —</option>';
    if (deptTeachers.length) {
      optionsHtml += '<optgroup label="Department Faculty">';
      optionsHtml += deptTeachers.map(function (t) {
        var tid = t._id || t.shadowId || t.trackId;
        var sel = (String(tid) === String(selectedId) || (assignedTeacher && String(t.trackId) === String(assignedTeacher.trackId))) ? ' selected' : '';
        var tName = (t.name || t.fullName || 'Teacher').trim();
        var deptCode = resolveTeacherDeptCode(t, cls);
        return '<option value="' + tid + '"' + sel +
          ' data-name="' + escapeHtml(tName) + '"' +
          ' data-badge="' + escapeHtml(deptCode) + '"' +
          ' data-dept="' + escapeHtml(deptCode) + '">' +
          escapeHtml(tName) + ' (' + escapeHtml(deptCode) + ')</option>';
      }).join('');
      optionsHtml += '</optgroup>';
    }

    if (otherTeachers.length) {
      optionsHtml += '<optgroup label="Other Department Faculty">';
      optionsHtml += otherTeachers.map(function (t) {
        var tid = t._id || t.shadowId || t.trackId;
        var sel = (String(tid) === String(selectedId) || (assignedTeacher && String(t.trackId) === String(assignedTeacher.trackId))) ? ' selected' : '';
        var tName = (t.name || t.fullName || 'Teacher').trim();
        var deptCode = resolveTeacherDeptCode(t, cls);
        return '<option value="' + tid + '"' + sel +
          ' data-name="' + escapeHtml(tName) + '"' +
          ' data-badge="' + escapeHtml(deptCode) + '"' +
          ' data-dept="' + escapeHtml(deptCode) + '">' +
          escapeHtml(tName) + ' (' + escapeHtml(deptCode) + ')</option>';
      }).join('');
      optionsHtml += '</optgroup>';
    }

    selectEl.innerHTML = optionsHtml;

    if (typeof SearchableDropdown !== 'undefined') {
      var sInst = SearchableDropdown.get('adv-modal-select');
      if (sInst) {
        if (sInst.searchInput) {
          sInst.searchInput.value = '';
          if (sInst.clearBtn) sInst.clearBtn.style.display = 'none';
        }
        sInst.rebuild();
      } else {
        SearchableDropdown.attach('adv-modal-select', {
          kind: 'advisor',
          showIcon: true,
          width: '100%',
          placeholder: '— None (Unassigned) —',
          searchPlaceholder: 'Search faculty name, ID, dept…',
          search: true
        });
      }
    }
  }

  openModal_('m-assign-advisor');
}

function closeAdvisorModal(returnToDetail) {
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.closeAll();
  }
  closeModalBg('m-assign-advisor');
  if (returnToDetail && currentClassId) {
    var detailEl = document.getElementById('m-cls-detail');
    if (detailEl && !detailEl.classList.contains('open')) {
      openModal_('m-cls-detail');
    }
  }
}

function saveClassAdvisorFromModal() {
  if (!currentClassId) return;
  var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
  if (!cls) return;
  var selectEl = document.getElementById('adv-modal-select');
  var teacherId = selectEl ? selectEl.value : '';
  var saveBtn = document.getElementById('adv-modal-save-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<re-icon icon="hourglass" size="14"></re-icon> Saving…';
  }

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

      closeAdvisorModal(true);
      _populateClassAdvisorSection(cls, _getAllTeachersList());
      if (typeof renderClassSubjectView === 'function') renderClassSubjectView(structureContext && structureContext.deptId);
      dbToast('Class Advisor saved successfully', 'success');

      return syncUsersWithTeacherDetails().then(function () {
        return apiCall('GET', '/teachers').then(function (list) {
          if (Array.isArray(list)) _teacherData = list;
          _populateClassAdvisorSection(cls, _getAllTeachersList());
          if (typeof renderClassSubjectView === 'function') renderClassSubjectView(structureContext && structureContext.deptId);
        });
      });
    })
    .catch(function (err) {
      console.error('Failed to save advisor:', err);
      dbToast(err.message || 'Failed to update advisor', 'error');
    })
    .finally(function () {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<re-icon icon="check" size="14"></re-icon> Save Advisor';
      }
    });
}

function toggleAssignAdvisor() {
  openAdvisorModal();
}

function cancelAssignAdvisor() {
  closeAdvisorModal(true);
}

function saveClassAdvisor() {
  saveClassAdvisorFromModal();
}

function openRepresentativeModal(targetClassId) {
  var classIdToUse = targetClassId || currentClassId || (structureContext && structureContext.classId);
  if (!classIdToUse) return;
  currentClassId = classIdToUse;
  window._currentRepClassId = classIdToUse;

  var cls = (DB.get('classes') || []).find(function (c) {
    return String(c._id) === String(classIdToUse) || (c.trackId && String(c.trackId) === String(classIdToUse));
  });
  if (!cls) return;

  var subEl = document.getElementById('rep-modal-sub');
  if (subEl) {
    subEl.textContent = cls.name + ' — ' + (cls.deptName || 'Department');
  }

  var currentEl = document.getElementById('rep-modal-current');
  var badgeEl = document.getElementById('rep-modal-status-badge');
  var reps = [];
  if (Array.isArray(cls.classRepresentatives) && cls.classRepresentatives.length > 0) {
    reps = cls.classRepresentatives.filter(Boolean);
  } else if (cls.representative1Name) {
    reps.push({
      studentId: cls.representative1Id,
      studentTrackId: cls.representative1TrackId || cls.repTrackId || cls.rep1TrackId || '',
      studentName: cls.representative1Name,
      registerNo: cls.representative1RegisterNo
    });
    if (cls.representative2Name) {
      reps.push({
        studentId: cls.representative2Id,
        studentTrackId: cls.representative2TrackId || cls.rep2TrackId || '',
        studentName: cls.representative2Name,
        registerNo: cls.representative2RegisterNo
      });
    }
  }

  // Fallback: resolve student names from DB.get('students') if names are missing
  var allStudents = DB.get('students') || [];
  if (reps.length > 0) {
    reps.forEach(function (r) {
      if (!r.studentName && (r.studentTrackId || r.studentId)) {
        var s = allStudents.find(function (stu) {
          return (r.studentTrackId && String(stu.trackId) === String(r.studentTrackId)) ||
                 (r.studentId && String(stu._id) === String(r.studentId));
        });
        if (s) {
          r.studentName = s.fullName || s.name || '';
          r.registerNo = s.registerNo || s.rollNo || '';
        }
      }
    });
  } else {
    var rep1Target = cls.repTrackId || cls.rep1TrackId || cls.representative1TrackId || cls.representative1Id;
    if (rep1Target) {
      var s1 = allStudents.find(function (s) {
        return String(s.trackId) === String(rep1Target) || String(s._id) === String(rep1Target);
      });
      if (s1) {
        reps.push({
          studentId: s1._id,
          studentTrackId: s1.trackId || '',
          studentName: s1.fullName || s1.name || 'Student',
          registerNo: s1.registerNo || s1.rollNo || ''
        });
      }
    }
    var rep2Target = cls.rep2TrackId || cls.representative2TrackId || cls.representative2Id;
    if (rep2Target) {
      var s2 = allStudents.find(function (s) {
        return String(s.trackId) === String(rep2Target) || String(s._id) === String(rep2Target);
      });
      if (s2) {
        reps.push({
          studentId: s2._id,
          studentTrackId: s2.trackId || '',
          studentName: s2.fullName || s2.name || 'Student',
          registerNo: s2.registerNo || s2.rollNo || ''
        });
      }
    }
  }

  reps = reps.filter(function (r) {
    return r && (r.studentName || r.studentTrackId || r.studentId);
  });

  if (currentEl) {
    if (reps.length > 0) {
      currentEl.innerHTML = reps.map(function (r, idx) {
        var sName = r.studentName || r.fullName || r.name || r.studentTrackId || 'Representative';
        var reg = r.registerNo || r.rollNo || '';
        return '<div style="display:flex;align-items:center;gap:6px;margin-top:2px;">'
          + '<span class="pill ' + (idx === 0 ? 'pri' : 'neu') + '" style="font-size:10px;padding:1px 5px;">' + (idx === 0 ? 'Rep 1' : 'Rep 2') + '</span> '
          + '<b>' + escapeHtml(sName) + '</b>'
          + (reg ? ' <span style="font-family:monospace;font-size:11px;color:var(--tmu);">(' + escapeHtml(reg) + ')</span>' : '')
          + '</div>';
      }).join('');
    } else {
      currentEl.innerHTML = '<span style="color:var(--tmu);font-style:italic;">No representatives assigned yet (1 required)</span>';
    }
  }
  if (badgeEl) {
    badgeEl.textContent = reps.length + ' / 2 Assigned';
  }

  var select1 = document.getElementById('rep-modal-select-1');
  var select2 = document.getElementById('rep-modal-select-2');
  if (select1) select1.innerHTML = '<option value="">Loading enrolled students…</option>';
  if (select2) select2.innerHTML = '<option value="">Loading enrolled students…</option>';

  openModal_('m-assign-representatives');

  apiCall('GET', '/students?classId=' + encodeURIComponent(classIdToUse) + '&limit=500')
    .then(function (res) {
      var students = [];
      if (Array.isArray(res)) students = res;
      else if (res && Array.isArray(res.data)) students = res.data;
      else if (res && Array.isArray(res.students)) students = res.students;

      if (!students.length && DB.get('students')) {
        students = (DB.get('students') || []).filter(function (s) {
          return String(s.classId) === String(classIdToUse) || (s.class && s.class.toLowerCase() === (cls.name || '').toLowerCase());
        });
      }

      students.sort(function (a, b) {
        return (a.name || a.fullName || '').localeCompare(b.name || b.fullName || '');
      });

      _populateRepSelectOptions(select1, select2, students, reps);
    })
    .catch(function (err) {
      console.warn('Failed to load students for rep modal:', err);
      var localStudents = (DB.get('students') || []).filter(function (s) {
        return String(s.classId) === String(classIdToUse) || (s.class && s.class.toLowerCase() === (cls.name || '').toLowerCase());
      });
      _populateRepSelectOptions(select1, select2, localStudents, reps);
    });
}

function closeRepresentativeModal(returnToDetail) {
  closeModalBg('m-assign-representatives');
  var classIdToUse = window._currentRepClassId || currentClassId;
  if (returnToDetail && classIdToUse) {
    var detailEl = document.getElementById('m-cls-detail');
    if (detailEl && !detailEl.classList.contains('open')) {
      openModal_('m-cls-detail');
    }
  }
}

function saveClassRepresentativesFromModal() {
  var classIdToUse = window._currentRepClassId || currentClassId || (structureContext && structureContext.classId);
  if (!classIdToUse) {
    dbToast('Active class not found', 'error');
    return;
  }
  var cls = (DB.get('classes') || []).find(function (c) {
    return String(c._id) === String(classIdToUse) || (c.trackId && String(c.trackId) === String(classIdToUse));
  });
  if (!cls) {
    dbToast('Active class not found in workspace', 'error');
    return;
  }

  var s1 = document.getElementById('rep-modal-select-1');
  var s2 = document.getElementById('rep-modal-select-2');
  var rep1Id = s1 ? s1.value : '';
  var rep2Id = s2 ? s2.value : '';

  if (!rep1Id) {
    dbToast('Please select at least 1 Class Representative (Primary is required)', 'warn');
    if (s1) s1.focus();
    return;
  }

  if (rep2Id && String(rep1Id) === String(rep2Id)) {
    dbToast('Representative 1 and Representative 2 must be different students', 'warn');
    if (s2) s2.focus();
    return;
  }

  var saveBtn = document.getElementById('rep-modal-save-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<re-icon icon="hourglass" size="14"></re-icon> Saving…';
  }

  dbToast('Saving Class Representatives...', 'saving');
  var payload = { rep1Id: rep1Id };
  if (rep2Id) payload.rep2Id = rep2Id;

  apiCall('PUT', '/classes/' + encodeURIComponent(cls._id || classIdToUse) + '/representatives', payload)
    .then(function (res) {
      if (res && res.error) {
        dbToast(res.error, 'error');
        return;
      }
      var updatedCls = (res && res.class) ? res.class : null;
      var reps = (res && res.representatives) ? res.representatives : [];
      if (updatedCls) {
        Object.assign(cls, updatedCls);
      }
      if (reps && reps.length) {
        cls.classRepresentatives = reps;
      }

      // Update in DB classes list
      var classesList = DB.get('classes') || [];
      var idx = classesList.findIndex(function (c) {
        return String(c._id) === String(cls._id) || (cls.trackId && String(c.trackId) === String(cls.trackId));
      });
      if (idx !== -1) {
        classesList[idx] = Object.assign({}, classesList[idx], cls);
        DB.set('classes', classesList);
      }

      // Immediately refresh overview card (Image 1) and edit class dropdowns
      closeRepresentativeModal(true);
      _populateClassRepresentativesSection(cls);
      if (typeof _populateEditClassRepDropdowns === 'function') {
        _populateEditClassRepDropdowns(cls);
      }
      dbToast('Class Representatives saved successfully', 'success');

      // Refresh classes list from server in background and re-verify
      apiCall('GET', '/classes').then(function (clsList) {
        if (Array.isArray(clsList)) {
          DB.set('classes', clsList);
          var freshCls = clsList.find(function (c) {
            return String(c._id) === String(cls._id) || (cls.trackId && String(c.trackId) === String(cls.trackId));
          });
          if (freshCls) {
            _populateClassRepresentativesSection(freshCls);
          }
        }
      }).catch(function () {});
    })
    .catch(function (err) {
      console.error('Failed to save class representatives:', err);
      dbToast((err && err.message) || 'Failed to update representatives', 'error');
    })
    .finally(function () {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<re-icon icon="check" size="14"></re-icon> Save Representatives';
      }
    });
}

window.openAdvisorModal = openAdvisorModal;
window.closeAdvisorModal = closeAdvisorModal;
window.saveClassAdvisorFromModal = saveClassAdvisorFromModal;
window.resolveTeacherDeptCode = resolveTeacherDeptCode;
window.openRepresentativeModal = openRepresentativeModal;
window.closeRepresentativeModal = closeRepresentativeModal;
window.saveClassRepresentativesFromModal = saveClassRepresentativesFromModal;

function _buildCaSubjectOptions(selectedId, deptId) {
  var subjects = DB.get('subjects') || [];
  if (!Array.isArray(subjects)) subjects = [];

  var depts = DB.get('departments') || [];
  var deptMap = {};
  if (Array.isArray(depts)) {
    depts.forEach(function (d) {
      if (d && d._id) deptMap[String(d._id)] = d.code || d.name || '';
    });
  }

  function resolveSubjDeptCode(s) {
    if (s.deptCode) return s.deptCode;
    var dId = getSubjectDeptId(s);
    return deptMap[dId] || '';
  }

  function renderSubjOption(s, groupLabel) {
    var sName = (s.name || 'Subject').trim();
    var code = (s.courseCode || s.code || s.shortForm || '').trim();
    var isSel = (String(s._id) === String(selectedId)) ? ' selected' : '';
    var credits = (s.credits != null) ? s.credits + ' Credits' : '';
    var dCode = resolveSubjDeptCode(s);
    return '<option value="' + s._id + '"'
      + ' data-name="' + escapeHtml(sName) + '"'
      + (code ? ' data-badge="' + escapeHtml(code) + '"' : '')
      + (credits ? ' data-sub="' + escapeHtml(credits) + '"' : '')
      + (dCode ? ' data-dept="' + escapeHtml(dCode) + '"' : '')
      + (groupLabel ? ' data-group="' + escapeHtml(groupLabel) + '"' : '')
      + isSel + '>'
      + escapeHtml(sName + (code ? ' (' + code + ')' : '') + (dCode ? ' [' + dCode + ']' : ''))
      + '</option>';
  }

  var html = '<option value="">— Select Subject —</option>';
  if (deptId) {
    var deptMatches = subjects.filter(function (s) {
      return getSubjectDeptId(s) === String(deptId);
    });
    var otherSubjects = subjects.filter(function (s) {
      return getSubjectDeptId(s) !== String(deptId);
    });

    if (deptMatches.length > 0) {
      var clsDeptName = deptMap[String(deptId)] || 'Department';
      html += '<optgroup label="' + escapeHtml(clsDeptName + ' Subjects') + '">';
      deptMatches.forEach(function (s) {
        html += renderSubjOption(s, clsDeptName + ' Subjects');
      });
      html += '</optgroup>';
    }

    if (otherSubjects.length > 0) {
      html += '<optgroup label="Other Department Subjects">';
      otherSubjects.forEach(function (s) {
        html += renderSubjOption(s, 'Other Department Subjects');
      });
      html += '</optgroup>';
    }

    if (!deptMatches.length && !otherSubjects.length) {
      subjects.forEach(function (s) { html += renderSubjOption(s, ''); });
    }
  } else {
    subjects.forEach(function (s) { html += renderSubjOption(s, ''); });
  }

  return html;
}

function addAllDeptSubjectsToClassAssign() {
  if (!currentClassId) {
    showToast('No class selected', 'warn');
    return;
  }
  var cls = (DB.get('classes') || []).find(function (c) { return String(c._id) === String(currentClassId); });
  if (!cls) {
    showToast('Class not found', 'error');
    return;
  }

  var deptId = cls.deptId || '';
  if (!deptId) {
    showToast('Class has no assigned department', 'warn');
    return;
  }

  var subjects = DB.get('subjects') || [];
  var deptSubjects = subjects.filter(function (s) {
    return getSubjectDeptId(s) === String(deptId);
  });

  if (!deptSubjects.length) {
    showToast('No subjects registered under this class department', 'warn');
    return;
  }

  var tbody = document.getElementById('ca-rows');
  if (!tbody) return;

  var existingSelects = tbody.querySelectorAll('.ca-subj');
  var existingSubjIds = new Set();
  var emptyRow = null;

  existingSelects.forEach(function (sel) {
    if (sel.value) {
      existingSubjIds.add(String(sel.value));
    } else if (!emptyRow) {
      emptyRow = sel.closest('tr');
    }
  });

  var defaultHall = (cls && ((cls.roomId && cls.roomId.hallNo) || cls.hallNo)) || '';
  var addedCount = 0;

  deptSubjects.forEach(function (subj) {
    var sId = String(subj._id);
    if (existingSubjIds.has(sId)) return;

    if (emptyRow) {
      var subjSel = emptyRow.querySelector('.ca-subj');
      if (subjSel) {
        subjSel.value = sId;
        if (typeof SearchableDropdown !== 'undefined') {
          var sInst = SearchableDropdown.get(subjSel);
          if (sInst) sInst.sync();
        }
      }
      var hallInput = emptyRow.querySelector('.ca-hall');
      if (hallInput && !hallInput.value && defaultHall) {
        hallInput.value = defaultHall;
      }
      emptyRow = null;
      existingSubjIds.add(sId);
      addedCount++;
    } else {
      addClassAssignRow(sId, '', defaultHall);
      existingSubjIds.add(sId);
      addedCount++;
    }
  });

  if (addedCount > 0) {
    showToast('Added ' + addedCount + ' department subject(s)', 'success');
  } else {
    showToast('All department subjects (' + deptSubjects.length + ') are already in the assignment table', 'info');
  }
}
window.addAllDeptSubjectsToClassAssign = addAllDeptSubjectsToClassAssign;

function addClassAssignRow(subjectId, teacherId, hallNo) {
  var tbody = document.getElementById('ca-rows');
  if (!tbody) return;
  var cls = (DB.get('classes') || []).find(function (c) { return String(c._id) === String(currentClassId); });
  var deptId = cls ? (cls.deptId || '') : '';
  var defaultHall = (cls && ((cls.roomId && cls.roomId.hallNo) || cls.hallNo)) || '';

  var tr = document.createElement('tr');
  tr.className = 'ca-row';
  tr.style.borderBottom = '1px solid var(--brl)';

  var rowUid = 'ca-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
  var subjSelectId = 'ca-subj-' + rowUid;
  var tchSelectId = 'ca-tch-' + rowUid;

  tr.innerHTML =
    '<td style="padding:8px 10px;vertical-align:middle;">'
    + '<select class="fc2 ca-subj" id="' + subjSelectId + '" style="font-size:13px;padding:8px 10px;min-width:170px;">'
    + _buildCaSubjectOptions(subjectId || '', deptId)
    + '</select></td>'
    + '<td style="padding:8px 10px;vertical-align:middle;">'
    + '<select class="fc2 ca-tch" id="' + tchSelectId + '" style="font-size:13px;padding:8px 10px;min-width:170px;">'
    + _buildSaTeacherOptions(teacherId || '', deptId)
    + '</select></td>'
    + '<td style="padding:8px 10px;vertical-align:middle;">'
    + '<input type="text" class="fc2 ca-hall" placeholder="e.g. H101" maxlength="20"'
    + ' style="font-size:13px;padding:8px 10px;min-width:90px;height:38px;box-sizing:border-box;" value="' + escapeHtml(hallNo || defaultHall) + '">'
    + '</td>'
    + '<td style="padding:8px 10px;text-align:center;vertical-align:middle;">'
    + '<button type="button" onclick="removeClassAssignRow(this)" style="background:var(--red);color:#fff;border:none;border-radius:8px;'
    + 'width:30px;height:30px;cursor:pointer;font-size:15px;line-height:1;display:inline-flex;align-items:center;'
    + 'justify-content:center;" title="Remove row"><re-icon icon="x"></re-icon></button>'
    + '</td>';
  tbody.appendChild(tr);

  // Upgrade selects to SearchableDropdown
  var subjSel = tr.querySelector('.ca-subj');
  var tchSel = tr.querySelector('.ca-tch');
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.attach(subjSel, {
      kind: 'subject',
      placeholder: '— Select Subject —',
      searchPlaceholder: 'Search subject name, code…'
    });
    SearchableDropdown.attach(tchSel, {
      kind: 'teacher',
      placeholder: '— Select Staff —',
      searchPlaceholder: 'Search teacher name, dept, ID…'
    });
  }
}

function removeClassAssignRow(btn) {
  var tr = btn.closest ? btn.closest('tr') : btn.parentNode.parentNode;
  var tbody = document.getElementById('ca-rows');
  if (tbody.querySelectorAll('tr.ca-row').length <= 1) {
    showToast('At least one row is required', 'warn'); return;
  }
  var subjSel = tr.querySelector('.ca-subj');
  var tchSel = tr.querySelector('.ca-tch');
  if (typeof SearchableDropdown !== 'undefined') {
    var sInst = SearchableDropdown.get(subjSel);
    if (sInst) sInst.destroy();
    var tInst = SearchableDropdown.get(tchSel);
    if (tInst) tInst.destroy();
  }
  tbody.removeChild(tr);
}

function saveClassSubjAssignments() {
  var warnEl = document.getElementById('ca-warn');
  if (warnEl) warnEl.style.display = 'none';

  var rows = document.querySelectorAll('#ca-rows tr.ca-row');
  if (!rows.length) { showToast('Add at least one row', 'warn'); return; }

  var cls = (DB.get('classes') || []).find(function (c) { return String(c._id) === String(currentClassId); });
  if (!cls) { showToast('Class not found', 'error'); return; }

  var subjects = DB.get('subjects') || [];
  var teachers = DB.get('teachers') || [];
  var users = DB.get('users') || [];
  var allTeachers = teachers.concat(users.filter(function (u) { return u.role === 'teacher'; }));

  var assignments = [];
  var seenSubjects = {};
  var errorMsg = '';

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var subjectId = row.querySelector('.ca-subj').value;
    var teacherId = row.querySelector('.ca-tch').value;
    var hallNo = row.querySelector('.ca-hall').value.trim();

    if (!subjectId || !teacherId || !hallNo) {
      errorMsg = 'Row ' + (i + 1) + ': All fields (Subject, Staff, Hall No.) are required.';
      break;
    }

    if (seenSubjects[subjectId]) {
      var sOpt = row.querySelector('.ca-subj').options[row.querySelector('.ca-subj').selectedIndex];
      var subjName = sOpt ? sOpt.text : 'Selected Subject';
      errorMsg = 'Duplicate subject "' + subjName + '" in row ' + (i + 1) + '.';
      break;
    }
    seenSubjects[subjectId] = true;

    var subj = subjects.find(function (s) { return String(s._id) === String(subjectId); });
    var teacher = allTeachers.find(function (t) { return String(t._id) === String(teacherId) || String(t.trackId || '') === String(teacherId); });
    if (!subj || !teacher) {
      errorMsg = 'Row ' + (i + 1) + ': Invalid subject or teacher';
      break;
    }

    assignments.push({
      classId: currentClassId,
      className: cls.name,
      subjectId: subjectId,
      subjectName: subj.name,
      teacherId: teacherId,
      teacherName: teacher.fullName || teacher.name || teacher.username || 'Teacher',
      hallNo: hallNo,
      deptName: cls.deptName || subj.deptName || '',
      deptCode: cls.deptCode || subj.deptCode || ''
    });
  }

  if (errorMsg) {
    if (warnEl) {
      warnEl.textContent = '⚠ ' + errorMsg;
      warnEl.style.display = 'block';
    } else {
      showToast(errorMsg, 'warn');
    }
    return;
  }

  dbToast('Saving to Database…', 'saving', assignments.length + ' subject(s)');

  apiCall('POST', '/assignments/bulk', { classId: currentClassId, assignments: assignments })
    .then(function (d) {
      if (!d || d.error) {
        dbToast('DB Error: ' + (d && d.error ? d.error : 'Unknown'), 'error');
        return;
      }

      return apiCall('GET', '/assignments').then(function (all) {
        if (Array.isArray(all)) DB.set('assignments', all);
        dbToast('Saved to Database', 'success', d.count + ' subject(s) written to DB');
        closeModalBg('m-asgn-subj');
        addLog('Assignments Bulk Saved', d.count + ' subjects <re-icon icon="arrow-right"></re-icon> ' + cls.name);
        openCD(currentClassId);
      });
    })
    .catch(function (err) {
      console.error('[EAMS Save Class Assignments Error]:', err);
      dbToast('Save failed: ' + (err.message || 'Network error'), 'error');
    });
}

function openClassAssignModal(classId) {
  if (!classId) return;
  currentClassId = classId;
  var cls = (DB.get('classes') || []).find(function (c) { return String(c._id) === String(classId); });
  if (!cls) return;

  var ttlEl = document.getElementById('as-modal-ttl');
  if (ttlEl) {
    ttlEl.innerHTML = '<re-icon icon="pin" size="18"></re-icon> <span>Assign Subjects &amp; Faculty — ' + escapeHtml(cls.name) + '</span>';
  }
  var subEl = document.getElementById('as-modal-sub');
  if (subEl) {
    var dName = cls.deptName || cls.deptCode || '';
    var defaultHall = (cls.roomId && cls.roomId.hallNo) || cls.hallNo || 'Unassigned';
    subEl.textContent = (dName ? dName + ' • ' : '') + 'Default Hall: ' + defaultHall;
  }

  var tbody = document.getElementById('ca-rows');
  if (tbody) {
    var oldSels = tbody.querySelectorAll('select');
    if (typeof SearchableDropdown !== 'undefined') {
      oldSels.forEach(function (sel) {
        var inst = SearchableDropdown.get(sel);
        if (inst) inst.destroy();
      });
    }
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:18px;color:var(--tmu);font-size:13px;">⌛ Loading subjects &amp; teachers from database…</td></tr>';
  }
  var warnEl = document.getElementById('ca-warn');
  if (warnEl) warnEl.style.display = 'none';

  openModal_('m-asgn-subj');

  // Parallel fetch fresh data
  Promise.all([
    apiCall('GET', '/subjects').then(function (subjs) { if (Array.isArray(subjs)) DB.set('subjects', subjs); return subjs; }).catch(function () { return DB.get('subjects') || []; }),
    apiCall('GET', '/teachers').then(function (tch) { if (Array.isArray(tch)) DB.set('teachers', tch); return tch; }).catch(function () { return DB.get('teachers') || []; }),
    apiCall('GET', '/assignments?classId=' + encodeURIComponent(classId)).catch(function () { return []; })
  ])
    .then(function (results) {
      var existing = results[2];
      if (!Array.isArray(existing) || !existing.length) {
        existing = (DB.get('assignments') || []).filter(function (a) { return String(a.classId) === String(classId); });
      }
      if (tbody) tbody.innerHTML = '';
      if (Array.isArray(existing) && existing.length > 0) {
        existing.forEach(function (a) { addClassAssignRow(a.subjectId, a.teacherId, a.hallNo); });
      } else {
        addClassAssignRow();
      }
    })
    .catch(function (err) {
      console.error('[EAMS Class Assign Staff Load Error]:', err);
      if (tbody) tbody.innerHTML = '';
      addClassAssignRow();
    });
}

function oasc() {
  openClassAssignModal(currentClassId);
}

function saveAsgn() {
  saveClassSubjAssignments();
}

window.openClassAssignModal = openClassAssignModal;
window.addClassAssignRow = addClassAssignRow;
window.removeClassAssignRow = removeClassAssignRow;
window.saveClassSubjAssignments = saveClassSubjAssignments;

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

// ─── UNIFIED SUBJECT MANAGEMENT MODULE (Assign Staff & Hall, Edit Subject, Overview) ───
var currentSubjectId = null;
var _saSubjectId = null;

function _updateUnifiedModalHeader(subj) {
  var titleEl = document.getElementById('sm-ttl');
  var subEl = document.getElementById('sm-sub');

  var courseCode = (subj.courseCode || subj.code || (subj.subjectCode ? subj.subjectCode.split('-')[0] : '') || '').trim();
  var subjName = (subj.name || 'Subject').trim();

  // Line 1: Data Structures and Algorithms · 25CSS301
  var line1Parts = [];
  if (subjName) line1Parts.push(escapeHtml(subjName));
  if (courseCode) line1Parts.push(escapeHtml(courseCode));
  var line1Text = line1Parts.join(' \u00b7 ');

  // Line 2: Theory · 4 Credits · Regulation 2025
  var regInfo = getSubjectRegulationInfo(subj);
  var rawReg = (regInfo && regInfo.code ? String(regInfo.code) : '2025').trim();
  var regCode = rawReg.replace(/^R(?:egulation)?\s*/i, '').trim() || '2025';
  var regName = 'Regulation ' + regCode;

  var typeText = escapeHtml(subj.type || 'Theory');
  var creditsText = (subj.credits != null ? subj.credits : 0) + ' Credits';
  var line2Parts = [typeText, creditsText, escapeHtml(regName)];
  var line2Text = line2Parts.join(' \u00b7 ');

  if (titleEl) {
    titleEl.innerHTML = '<re-icon icon="book-open" size="18" style="flex-shrink:0;"></re-icon> '
      + '<span style="display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;font-family:\'Poppins\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-weight:700;">'
      + (line1Text || escapeHtml(subj.name || 'Subject'))
      + '</span>';
  }

  if (subEl) {
    subEl.innerHTML = '<span style="font-family:\'Poppins\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-size:12px;font-weight:500;color:var(--tmu);line-height:1.35;display:inline-block;margin-top:2px;">'
      + line2Text
      + '</span>';
  }
}

function _populateRegulationDropdown(selectId, selectedVal) {
  var el = document.getElementById(selectId);
  if (!el) return;

  var regs = getAvailableRegulations();

  // Also include distinct regulations from DB subjects if any exist
  var dbSubjects = DB.get('subjects') || [];
  dbSubjects.forEach(function (s) {
    if (s.regulation) {
      var code = String(s.regulation).replace(/^Regulation\s*/i, '').trim();
      if (code && !regs.some(function (r) { return r.code.toLowerCase() === code.toLowerCase(); })) {
        regs.push({ code: code, name: s.regulation.toLowerCase().startsWith('regulation') ? s.regulation : 'Regulation ' + code, shortName: 'Reg ' + code });
      }
    }
  });

  el.innerHTML = regs.map(function (r) {
    var isSel = String(r.code) === String(selectedVal) || String(r.name) === String(selectedVal);
    return '<option value="' + r.code + '"' + (isSel ? ' selected' : '') + '>' + r.name + '</option>';
  }).join('');

  if (selectedVal && !regs.some(function (r) { return r.code === selectedVal || r.name === selectedVal; })) {
    el.innerHTML += '<option value="' + selectedVal + '" selected>' + (selectedVal.toLowerCase().startsWith('regulation') ? selectedVal : 'Regulation ' + selectedVal) + '</option>';
  }
}

function _renderUnifiedOverview(subj, customAssignments) {
  var assignments = Array.isArray(customAssignments)
    ? customAssignments
    : (DB.get('assignments') || []).filter(function (a) { return String(a.subjectId) === String(subj._id); });

  var asgnBadge = document.getElementById('sm-badge-asgn');
  if (asgnBadge) asgnBadge.textContent = assignments.length;

  var container = document.getElementById('sd-overview-content') || document.getElementById('sm-panel-overview');
  if (!container) return;

  var courseCode = (subj.courseCode || subj.code || (subj.subjectCode ? subj.subjectCode.split('-')[0] : '') || '').trim() || '-';
  var shortForm = (subj.shortForm || subj.shortName || (subj.subjectCode && subj.subjectCode.includes('-') ? subj.subjectCode.split('-')[1] : '') || '').trim() || '-';
  var subjectCode = (subj.subjectCode || '').trim() || (courseCode !== '-' ? (courseCode + (shortForm !== '-' ? '-' + shortForm : '')) : '-');
  var fullCourseName = (subj.name || subj.courseName || subj.subjectName || '').trim() || '—';
  var credits = (subj.credits != null ? Number(subj.credits) : 0);
  var type = (subj.type || 'Theory').trim();
  var typeLower = type.toLowerCase();

  var regInfo = getSubjectRegulationInfo(subj);
  var regCode = (regInfo && regInfo.code ? String(regInfo.code) : String(subj.regulation || '2025')).replace(/^R(?:egulation)?\s*/i, '').trim() || '2025';
  var regName = 'Regulation ' + regCode;

  var deptName = (subj.deptName || '').trim();
  if (!deptName && subj.deptId) {
    var d = (DB.get('departments') || []).find(function (dp) { return String(dp._id) === String(subj.deptId); });
    if (d) deptName = d.name || d.deptName || '';
  }
  if (!deptName) deptName = 'General Academic Core';

  var uniqueTeachers = [];
  assignments.forEach(function (a) {
    var tch = (DB.get('teachers') || []).find(function (t) { return String(t._id) === String(a.teacherId); });
    var tName = (a.teacherName || (tch ? tch.name : '')).trim();
    if (tName && !uniqueTeachers.includes(tName)) {
      uniqueTeachers.push(tName);
    }
  });

  var classesCount = assignments.length;
  var teachersCount = uniqueTeachers.length;

  var assignmentsHtml = '';
  if (assignments.length > 0) {
    assignmentsHtml = '<div class="subj-asgn-grid">' + assignments.map(function (a) {
      var cls = (DB.get('classes') || []).find(function (c) { return String(c._id) === String(a.classId); });
      var clsName = a.className || (cls ? cls.name : 'Class Section');

      var tch = (DB.get('teachers') || []).find(function (t) { return String(t._id) === String(a.teacherId); });
      var tName = a.teacherName || (tch ? tch.name : 'Unassigned Faculty');
      var tInitial = (tName.charAt(0) || 'T').toUpperCase();
      var tDesig = tch && (tch.designation || tch.desig) ? ' · ' + (tch.designation || tch.desig) : '';

      var hall = a.hallNo ? 'Hall ' + a.hallNo : 'Hall Unassigned';

      return '<div class="subj-asgn-card">'
        + '<div class="subj-asgn-left">'
        + '  <div class="subj-asgn-cls"><re-icon icon="chalkboard" size="14"></re-icon> <span>' + escapeHtml(clsName) + '</span></div>'
        + '  <div class="subj-asgn-tchr"><span class="subj-tchr-av">' + escapeHtml(tInitial) + '</span> <span>' + escapeHtml(tName) + '<span style="font-size:11px;color:var(--tmu);font-weight:400;">' + escapeHtml(tDesig) + '</span></span></div>'
        + '</div>'
        + '<div class="subj-asgn-right">'
        + '  <span class="subj-asgn-hall"><re-icon icon="pin" size="12"></re-icon> ' + escapeHtml(hall) + '</span>'
        + '  <button type="button" class="btn-xs btn-out" onclick="switchSubjectTab(\'assign\')" title="Edit in Assign tab" style="padding:3px 7px;"><re-icon icon="edit" size="11"></re-icon></button>'
        + '</div>'
        + '</div>';
    }).join('') + '</div>';
  } else {
    assignmentsHtml = '<div class="subj-asgn-empty">'
      + '<div class="subj-empty-icon"><re-icon icon="clipboard-list" size="24"></re-icon></div>'
      + '<div class="subj-empty-title">No Classes Assigned Yet</div>'
      + '<div class="subj-empty-desc">This subject is not currently assigned to any class or faculty member. Link sections to designate teachers and lecture halls for timetable scheduling.</div>'
      + '<button type="button" class="btn-out btn-sm" onclick="switchSubjectTab(\'assign\')" style="margin-top:4px;"><re-icon icon="plus" size="13"></re-icon> Assign Staff &amp; Hall</button>'
      + '</div>';
  }

  container.innerHTML =
    '<!-- 1. STATS GRID -->'
    + '<div class="subj-stats-grid" id="sd-stats">'
    + '  <div class="subj-stat-card stat-green">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Credits</span><div class="subj-stat-ic"><re-icon icon="graduation-cap" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + credits + ' <span class="subj-stat-unit">Credits</span></div>'
    + '    <div class="subj-stat-sub">~' + credits + ' hours / week load</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-blue">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Classes</span><div class="subj-stat-ic"><re-icon icon="chalkboard" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + classesCount + ' <span class="subj-stat-unit">' + (classesCount === 1 ? 'Class' : 'Classes') + '</span></div>'
    + '    <div class="subj-stat-sub">' + (classesCount > 0 ? 'Assigned to active sections' : 'Unassigned in timetable') + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-amber">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Faculty</span><div class="subj-stat-ic"><re-icon icon="teacher" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + teachersCount + ' <span class="subj-stat-unit">' + (teachersCount === 1 ? 'Teacher' : 'Teachers') + '</span></div>'
    + '    <div class="subj-stat-sub">' + (teachersCount > 0 ? 'Handling teaching instruction' : 'Pending faculty assignment') + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-purple">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Type</span><div class="subj-stat-ic"><re-icon icon="book-open" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val"><span class="subj-type-badge ' + typeLower + '">' + escapeHtml(type) + '</span></div>'
    + '    <div class="subj-stat-sub">Curricular Modality</div>'
    + '  </div>'
    + '</div>'
    + '<!-- 2. SPECIFICATIONS CARD -->'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd">'
    + '    <div class="subj-section-title"><re-icon icon="settings" size="14"></re-icon> <span>Subject Specifications &amp; Curriculum</span></div>'
    + '    <button type="button" class="btn-xs btn-out" onclick="switchSubjectTab(\'edit\')"><re-icon icon="edit" size="12"></re-icon> Edit Details</button>'
    + '  </div>'
    + '  <div class="subj-section-bd">'
    + '    <div class="subj-specs-grid">'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Course Code</span><span class="subj-spec-val" style="font-family:monospace;letter-spacing:.3px;">' + escapeHtml(courseCode) + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Full Course Name</span><span class="subj-spec-val">' + escapeHtml(fullCourseName) + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Short Code</span><span class="subj-spec-val">' + escapeHtml(shortForm) + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Subject Code (Full)</span><span class="subj-spec-val" style="color:var(--gD);font-family:monospace;">' + escapeHtml(subjectCode) + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Department</span><span class="subj-spec-val">' + escapeHtml(deptName) + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Regulation</span><span class="subj-spec-val" style="display:inline-flex;align-items:center;gap:6px;"><span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px;background:var(--gLt);color:var(--gD);">R' + escapeHtml(regCode) + '</span> ' + escapeHtml(regName) + '</span></div>'
    + '    </div>'
    + '  </div>'
    + '</div>'
    + '<!-- 3. ASSIGNMENTS CARD -->'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd">'
    + '    <div class="subj-section-title"><re-icon icon="pin" size="14"></re-icon> <span>Class &amp; Faculty Assignments</span><span style="background:var(--gLt);color:var(--gD);font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:4px;">' + classesCount + '</span></div>'
    + '    <button type="button" class="btn-xs btn-out" onclick="switchSubjectTab(\'assign\')"><re-icon icon="plus" size="12"></re-icon> Assign Sections</button>'
    + '  </div>'
    + '  <div class="subj-section-bd" id="sd-asgn" style="padding:14px 18px;">'
    +      assignmentsHtml
    + '  </div>'
    + '</div>'
    + '<!-- 4. FOOTER TOOLBAR -->'
    + '<div class="subj-overview-ft">'
    + '  <button type="button" class="btn bdan bsm" onclick="unifiedDeleteSubject()"><re-icon icon="trash2" size="14"></re-icon> Delete Subject</button>'
    + '  <div style="display:flex;gap:10px;align-items:center;">'
    + '    <button type="button" class="btn-out bsm" onclick="switchSubjectTab(\'edit\')"><re-icon icon="edit" size="14"></re-icon> Edit Details</button>'
    + '    <button type="button" class="btn-pri bsm" onclick="switchSubjectTab(\'assign\')"><re-icon icon="pin" size="14"></re-icon> Manage Staff &amp; Hall</button>'
    + '  </div>'
    + '</div>';
}

function switchSubjectTab(tabName) {
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.closeAll();
  }
  var tabs = ['overview', 'assign', 'edit'];
  tabs.forEach(function (t) {
    var btn = document.getElementById('sm-tab-btn-' + t);
    var panel = document.getElementById('sm-panel-' + t);
    if (btn) btn.classList.toggle('act', t === tabName);
    if (panel) panel.style.display = t === tabName ? 'block' : 'none';
  });
}

function openSubjectModal(subjectId, initialTab) {
  currentSubjectId = subjectId;
  _saSubjectId = subjectId;
  updateStructureUrlParams({ subj: subjectId });

  var subj = (DB.get('subjects') || []).find(function (s) { return String(s._id) === String(subjectId); });
  if (!subj) {
    showToast('Subject not found in database', 'warn');
    return;
  }

  // 1. Header
  _updateUnifiedModalHeader(subj);

  // 2. Tab selection (default: overview, moved first per requirement)
  switchSubjectTab(initialTab || 'overview');

  // 3. Edit Subject Form population
  document.getElementById('es-nm').value = subj.name || '';
  var courseCode = (subj.courseCode || subj.code || '').trim();
  var shortForm = (subj.shortForm || subj.shortName || subj.shortCode || '').trim();
  if (document.getElementById('es-cd')) document.getElementById('es-cd').value = courseCode;
  if (document.getElementById('es-ssc')) document.getElementById('es-ssc').value = shortForm;
  document.getElementById('es-cr').value = subj.credits || 3;
  document.getElementById('es-tp').value = subj.type || 'Theory';
  var subjectCode = (courseCode && shortForm) ? (courseCode + '-' + shortForm) : (subj.subjectCode || courseCode);
  if (document.getElementById('es-sc')) document.getElementById('es-sc').value = subjectCode;
  if (document.getElementById('es-dc')) {
    document.getElementById('es-dc').value = subj.deptCode || (structureContext ? structureContext.deptCode : '') || '';
  }
  _populateRegulationDropdown('es-reg', subj.regulation || '2025');

  if (document.getElementById('es-cat')) document.getElementById('es-cat').value = subj.category || 'easy';
  if (document.getElementById('es-bl')) document.getElementById('es-bl').value = subj.blockLength || 1;
  if (document.getElementById('es-smin')) document.getElementById('es-smin').value = subj.slotsMin ?? 4;
  if (document.getElementById('es-stgt')) document.getElementById('es-stgt').value = subj.slotsTarget ?? 5;
  if (document.getElementById('es-smax')) document.getElementById('es-smax').value = subj.slotsMax ?? 7;
  var isBlend = Boolean(subj.isBlend);
  var esBlendChk = document.getElementById('es-blend-chk');
  if (esBlendChk) esBlendChk.checked = isBlend;
  if (document.getElementById('es-blend-theory')) document.getElementById('es-blend-theory').value = subj.blendTheorySlots || 4;
  if (document.getElementById('es-blend-lab')) document.getElementById('es-blend-lab').value = subj.blendLabSlots || 2;
  toggleEsBlend(isBlend);
  renderEsBlendMappingWrap(subj);

  var esDept = document.getElementById('es-dept');
  if (esDept) {
    var depts = Array.isArray(DB.get('depts')) ? DB.get('depts') : [];
    if (isCurrentUserSuperAdmin()) {
      var dInfo = getCurrentUserDeptInfo();
      var myDeptId = dInfo.id;
      var myDeptName = dInfo.name;
      if (!myDeptId) {
        var found = depts.find(function (d) { return d.name === myDeptName; });
        if (found) myDeptId = found._id;
      }
      esDept.innerHTML = '<option value="' + (myDeptId || '') + '">' + escapeHtml(myDeptName || 'My Department') + '</option>';
      esDept.value = myDeptId || '';
      esDept.disabled = true;
      esDept.style.cursor = 'not-allowed';
    } else {
      esDept.innerHTML = '<option value="">— Select Department —</option>'
        + depts.map(function (d) {
            var code = d.code ? ' (' + d.code + ')' : '';
            return '<option value="' + d._id + '">' + escapeHtml(d.name + code) + '</option>';
          }).join('');
      var currentDeptId = subj.deptId ? (subj.deptId._id || subj.deptId) : (structureContext ? structureContext.deptId : '');
      esDept.value = currentDeptId ? String(currentDeptId) : '';
      esDept.disabled = false;
      esDept.style.cursor = '';
    }
    if (typeof SearchableDropdown !== 'undefined') {
      SearchableDropdown.sync('es-dept');
    }
  }

  var esSaveBtn = document.getElementById('es-save-btn');
  if (esSaveBtn) {
    esSaveBtn.disabled = false;
    esSaveBtn.style.opacity = '1';
  }
  var esWarn = document.getElementById('es-warn');
  if (esWarn) esWarn.style.display = 'none';

  // 4. Overview & Stats
  _renderUnifiedOverview(subj);

  // 5. Assign Staff & Hall loading
  var tbody = document.getElementById('sa-rows');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:18px;color:var(--tmu);font-size:13px;">⌛ Loading classes &amp; teachers from database…</td></tr>';
  document.getElementById('sa-warn').style.display = 'none';

  openModal_('m-subj-unified');

  // Parallel fetch fresh data
  Promise.all([
    apiCall('GET', '/classes').then(function (cls) { if (Array.isArray(cls)) DB.set('classes', cls); return cls; }).catch(function () { return DB.get('classes') || []; }),
    apiCall('GET', '/teachers').then(function (tch) { if (Array.isArray(tch)) DB.set('teachers', tch); return tch; }).catch(function () { return DB.get('teachers') || []; }),
    apiCall('GET', '/assignments?subjectId=' + encodeURIComponent(subjectId)).catch(function () { return []; })
  ])
    .then(function (results) {
      var existing = results[2];
      var oldSels = tbody.querySelectorAll('select');
      if (typeof SearchableDropdown !== 'undefined') {
        oldSels.forEach(function (sel) {
          var inst = SearchableDropdown.get(sel);
          if (inst) inst.destroy();
        });
      }
      tbody.innerHTML = '';
      var asgnBadge = document.getElementById('sm-badge-asgn');
      if (Array.isArray(existing) && existing.length > 0) {
        if (asgnBadge) asgnBadge.textContent = existing.length;
        existing.forEach(function (a) { addAssignRow(a.classId, a.teacherId, a.hallNo); });
      } else {
        if (asgnBadge) asgnBadge.textContent = '0';
        addAssignRow(); // one default empty row
      }
      _renderUnifiedOverview(subj, existing);
    })
    .catch(function (err) {
      console.error('[EAMS Assign Staff Load Error]:', err);
      var oldSels = tbody.querySelectorAll('select');
      if (typeof SearchableDropdown !== 'undefined') {
        oldSels.forEach(function (sel) {
          var inst = SearchableDropdown.get(sel);
          if (inst) inst.destroy();
        });
      }
      tbody.innerHTML = '';
      addAssignRow();
    });
}

// Backward compatibility aliases
function openSD(subjectId) {
  openSubjectModal(subjectId, 'overview');
}

function openSubjAssignModal(subjectId) {
  openSubjectModal(subjectId, 'assign');
}

function editSubjInline() {
  switchSubjectTab('edit');
}

async function unifiedDeleteSubject() {
  if (!currentSubjectId) return;
  var subj = (DB.get('subjects') || []).find(function (s) { return String(s._id) === String(currentSubjectId); });
  if (!subj) return;

  const ok = await showConfirm(
    'Delete subject "' + subj.name + '"? This will remove all class assignments and cannot be undone.',
    'Delete Subject',
    null,
    null,
    { danger: true, confirmText: 'Delete Subject' }
  );
  if (!ok) return;

  dbToast('Deleting subject...', 'saving');
  apiDeleteSubject(currentSubjectId, subj.name).then(function () {
    addLog('Subject Deleted', '"' + subj.name + '"');
    closeModalBg('m-subj-unified');
    if (structureContext && structureContext.deptId) renderClassSubjectView(structureContext.deptId);
    dbToast('Subject deleted from DB, check Undo Menu for undo', 'success');
  }).catch(function () {
    dbToast('Delete failed', 'error');
  });
}

function onEsDeptChange() {
  var deptId = getFieldValue('es-dept');
  var d = (DB.get('depts') || []).find(function (dp) { return String(dp._id) === String(deptId); });
  if (d && document.getElementById('es-dc')) {
    document.getElementById('es-dc').value = d.code || '';
  }
}
window.onEsDeptChange = onEsDeptChange;

// ── Blend & Slot Helpers for Admin Portal ─────────────────────────
function toggleNsBlend(isChecked) {
  var wrap = document.getElementById('ns-blend-wrap');
  if (wrap) wrap.style.display = isChecked ? 'block' : 'none';
  var sw = document.getElementById('ns-blend-sw');
  if (sw) sw.classList.toggle('on', !!isChecked);
  if (isChecked) {
    onNsBlendSlotsChange();
    renderNsBlendMappingWrap();
  }
}
window.toggleNsBlend = toggleNsBlend;

function toggleNsBlendSwitch() {
  var chk = document.getElementById('ns-blend-chk');
  if (!chk) return;
  chk.checked = !chk.checked;
  var sw = document.getElementById('ns-blend-sw');
  if (sw) sw.classList.toggle('on', chk.checked);
  toggleNsBlend(chk.checked);
  if (typeof updateNsSubjPreview === 'function') updateNsSubjPreview();
}
window.toggleNsBlendSwitch = toggleNsBlendSwitch;

function toggleNsAutoLabSwitch() {
  var chk = document.getElementById('ns-blend-autolab-chk');
  if (!chk) return;
  chk.checked = !chk.checked;
  var sw = document.getElementById('ns-autolab-sw');
  if (sw) sw.classList.toggle('on', chk.checked);
  var f = document.getElementById('ns-blend-autolab-fields');
  if (f) f.style.display = chk.checked ? 'grid' : 'none';
  if (typeof updateNsSubjPreview === 'function') updateNsSubjPreview();
}
window.toggleNsAutoLabSwitch = toggleNsAutoLabSwitch;

function stepNsVal(id, delta, slotType) {
  var el = document.getElementById(id);
  if (!el) return;
  var min = el.min !== '' ? parseInt(el.min) : 0;
  var max = el.max !== '' ? parseInt(el.max) : 99;
  var cur = parseInt(el.value) || min;
  var next = Math.max(min, Math.min(max, cur + delta));
  el.value = next;
  if (slotType && typeof validateNsSlotsOrder === 'function') {
    validateNsSlotsOrder(slotType);
  }
  if (id === 'ns-blend-theory' || id === 'ns-blend-lab') {
    if (typeof onNsBlendSlotsChange === 'function') onNsBlendSlotsChange();
  }
  if (typeof updateNsSubjPreview === 'function') {
    updateNsSubjPreview();
  }
}
window.stepNsVal = stepNsVal;

function onNsDetailsInput() {
  if (typeof nsScAuto === 'function') nsScAuto();
  if (typeof updateNsSubjPreview === 'function') updateNsSubjPreview();
  if (typeof renderNsBlendMappingWrap === 'function') renderNsBlendMappingWrap();
}
window.onNsDetailsInput = onNsDetailsInput;

function onNsTypeChange() {
  if (typeof nsScAuto === 'function') nsScAuto();
  if (typeof updateNsSubjPreview === 'function') updateNsSubjPreview();
  if (typeof renderNsBlendMappingWrap === 'function') renderNsBlendMappingWrap();
}
window.onNsTypeChange = onNsTypeChange;

function updateNsSubjPreview() {
  var name = (getFieldValue('ns-nm') || '').trim();
  var courseCode = (getFieldValue('ns-cd') || '').trim().toUpperCase();
  var shortForm = (getFieldValue('ns-ssc') || '').trim().toUpperCase();
  var subjectCode = (courseCode && shortForm) ? (courseCode + '-' + shortForm) : courseCode;
  var credits = parseInt(getFieldValue('ns-cr')) || 3;
  var type = getFieldValue('ns-tp') || 'Theory';
  var isBlend = document.getElementById('ns-blend-chk')?.checked === true;
  var smin = parseInt(getFieldValue('ns-smin')) || 4;
  var stgt = parseInt(getFieldValue('ns-stgt')) || 5;
  var smax = parseInt(getFieldValue('ns-smax')) || 7;
  var blk = parseInt(getFieldValue('ns-bl')) || 1;

  var bTheory = isBlend ? (parseInt(getFieldValue('ns-blend-theory')) || 0) : (type === 'Lab' ? 0 : stgt);
  var bLab = isBlend ? (parseInt(getFieldValue('ns-blend-lab')) || 0) : (type === 'Lab' ? stgt : 0);

  // Left card avatar
  var avEl = document.getElementById('subj-preview-avatar');
  if (avEl) {
    avEl.textContent = (shortForm || (name ? name.substring(0, 3) : 'DSA')).toUpperCase();
  }

  // Name
  var nmEl = document.getElementById('subj-preview-name');
  if (nmEl) nmEl.textContent = name || 'Data Structures Algorithm';

  // Code
  var cdEl = document.getElementById('subj-preview-code');
  if (cdEl) cdEl.textContent = subjectCode || '25CSS301-DSA';

  // Chip
  var chpEl = document.getElementById('subj-preview-chip');
  if (chpEl) {
    chpEl.textContent = credits + ' credits · ' + (isBlend ? 'Blend' : type);
  }

  // Weekly load bars
  var barsEl = document.getElementById('subj-preview-bars');
  if (barsEl) {
    var totalSlots = isBlend ? (bTheory + bLab) : stgt;
    var maxBars = Math.max(7, totalSlots);
    var html = '';
    for (var i = 0; i < maxBars; i++) {
      if (i < bTheory) {
        html += '<i class="t"></i>';
      } else if (i < (bTheory + bLab)) {
        html += '<i class="l"></i>';
      } else {
        html += '<i></i>';
      }
    }
    barsEl.innerHTML = html;
  }

  // Legend
  var tCnt = document.getElementById('subj-preview-theory-cnt');
  if (tCnt) tCnt.textContent = bTheory;
  var lItem = document.getElementById('subj-preview-lab-item');
  var lCnt = document.getElementById('subj-preview-lab-cnt');
  if (lItem && lCnt) {
    if (isBlend || type === 'Lab') {
      lItem.style.display = 'inline-flex';
      lCnt.textContent = bLab;
    } else {
      lItem.style.display = 'none';
    }
  }

  // Summary
  var totEl = document.getElementById('subj-preview-tot');
  if (totEl) {
    var tot = isBlend ? (bTheory + bLab) : stgt;
    totEl.textContent = tot + ' classes';
  }
  var rngEl = document.getElementById('subj-preview-range');
  if (rngEl) rngEl.textContent = smin + ' – ' + smax;
  var blkEl = document.getElementById('subj-preview-block');
  if (blkEl) blkEl.textContent = blk + (blk === 1 ? ' period' : ' periods');
  var shrEl = document.getElementById('subj-preview-shared');
  if (shrEl) shrEl.textContent = courseCode || '25CSS301';

  // Required status in footer
  var missing = [];
  if (!name) missing.push('Subject name');
  if (!courseCode) missing.push('Course code');
  if (!shortForm) missing.push('Short form');

  var leadEl = document.getElementById('ns-req-lead');
  var descEl = document.getElementById('ns-req-desc');
  var addBtn = document.getElementById('ns-add-btn');

  if (missing.length === 0) {
    if (leadEl) {
      leadEl.textContent = 'Ready to add';
      leadEl.style.color = '#1b5e20';
    }
    if (descEl) descEl.textContent = ' · all required fields are filled';
    if (addBtn && !addBtn.getAttribute('data-dup-disabled')) {
      addBtn.classList.remove('d');
      addBtn.classList.add('p');
      addBtn.disabled = false;
      addBtn.style.opacity = '1';
      addBtn.style.cursor = 'pointer';
    }
  } else {
    if (leadEl) {
      leadEl.textContent = missing.length + ' required field' + (missing.length > 1 ? 's' : '') + ' left';
      leadEl.style.color = '#dc2626';
    }
    if (descEl) descEl.textContent = ' · ' + missing.join(', ');
    if (addBtn) {
      addBtn.classList.add('d');
      addBtn.classList.remove('p');
      addBtn.disabled = true;
      addBtn.style.opacity = '0.6';
      addBtn.style.cursor = 'not-allowed';
    }
  }
}
window.updateNsSubjPreview = updateNsSubjPreview;

function onNsBlendSlotsChange() {
  var t = Math.max(0, parseInt(getFieldValue('ns-blend-theory')) || 0);
  var l = Math.max(0, parseInt(getFieldValue('ns-blend-lab')) || 0);
  var hint = document.getElementById('ns-blend-calc-hint');
  if (hint) hint.innerHTML = '<b>' + (t + l) + '</b> classes · ' + t + ' Theory + ' + l + ' Lab';
  if (document.getElementById('ns-blend-chk')?.checked && (t + l) > 0) {
    var tgtEl = document.getElementById('ns-stgt');
    if (tgtEl) tgtEl.value = (t + l);
    validateNsSlotsOrder('target');
  }
  if (typeof updateNsSubjPreview === 'function') updateNsSubjPreview();
}

function validateNsSlotsOrder(changed) {
  var minEl = document.getElementById('ns-smin');
  var tgtEl = document.getElementById('ns-stgt');
  var maxEl = document.getElementById('ns-smax');
  if (!minEl || !tgtEl || !maxEl) return;
  var min = Math.max(1, parseInt(minEl.value) || 4);
  var tgt = Math.max(1, parseInt(tgtEl.value) || 5);
  var max = Math.max(1, parseInt(maxEl.value) || 7);
  if (changed === 'target') {
    if (min > tgt) min = tgt;
    if (max < tgt) max = tgt;
  } else if (changed === 'min') {
    if (min > tgt) tgt = min;
    if (max < tgt) max = tgt;
  } else if (changed === 'max') {
    if (max < tgt) tgt = max;
    if (min > tgt) min = tgt;
  }
  minEl.value = min;
  tgtEl.value = tgt;
  maxEl.value = max;
  if (typeof updateNsSubjPreview === 'function') updateNsSubjPreview();
}

function renderNsBlendMappingWrap() {
  var wrap = document.getElementById('ns-blend-autolab-wrap');
  if (!wrap) return;
  var cCode = (getFieldValue('ns-cd') || '').trim().toUpperCase();
  var sForm = (getFieldValue('ns-ssc') || '').trim().toUpperCase();
  var name = (getFieldValue('ns-nm') || '').trim();
  var type = getFieldValue('ns-tp') || 'Theory';

  var tag = document.getElementById('ns-blend-code-tag');
  if (tag) tag.textContent = cCode || 'Shared Code';

  if (type === 'Theory') {
    var existingLab = (DB.get('subjects') || []).find(function (s) {
      return ((s.courseCode && s.courseCode.toUpperCase() === cCode) || (s.code && s.code.toUpperCase() === cCode)) && s.type === 'Lab';
    });
    if (existingLab) {
      wrap.innerHTML = '<div style="background:#fff;border:1.5px solid #a855f7;border-radius:12px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;margin-top:8px;">'
        + '<div><div style="font-size:11px;font-weight:700;color:#7e22ce;"><re-icon icon="link" size="12"></re-icon> Mapped Lab Component (Same Code: ' + escapeHtml(cCode) + ')</div>'
        + '<div style="font-weight:600;font-size:13px;color:var(--td);margin-top:2px;">' + escapeHtml(existingLab.name) + ' (' + escapeHtml(existingLab.shortForm || existingLab.shortName || 'LAB') + ')</div></div>'
        + '<span class="tg" style="margin:0;">Linked</span></div>';
    } else {
      var defaultLabShort = sForm ? (sForm.endsWith('-L') ? sForm : sForm + '-L') : 'LAB';
      var defaultLabName = name ? (name.toLowerCase().includes('lab') ? name : name + ' Lab') : 'Course Lab';
      wrap.innerHTML = '<div class="sub" style="margin-top:10px;">'
        + '<div class="bh" style="cursor:pointer;margin-bottom:8px;" onclick="toggleNsAutoLabSwitch()">'
        + '<i class="sw on" id="ns-autolab-sw"></i>'
        + '<input type="checkbox" id="ns-blend-autolab-chk" checked style="display:none;" onchange="var f=document.getElementById(\'ns-blend-autolab-fields\'); if(f) f.style.display=this.checked?\'grid\':\'none\'; var sw=document.getElementById(\'ns-autolab-sw\'); if(sw) sw.classList.toggle(\'on\', this.checked);">'
        + '<b>Auto-create lab component with same course code</b>'
        + '</div>'
        + '<div id="ns-blend-autolab-fields" class="gr">'
        + '<div class="c4"><label class="lb stu-lbl" for="ns-blend-lab-sc">Lab short code</label><input class="in stu-inp" id="ns-blend-lab-sc" value="' + escapeHtml(defaultLabShort) + '" oninput="updateNsSubjPreview()"></div>'
        + '<div class="c8"><label class="lb stu-lbl" for="ns-blend-lab-nm">Lab subject name</label><input class="in stu-inp" id="ns-blend-lab-nm" value="' + escapeHtml(defaultLabName) + '" oninput="updateNsSubjPreview()"></div>'
        + '</div></div>';
    }
  } else {
    wrap.innerHTML = '';
  }
}

function toggleEsBlend(isChecked) {
  var wrap = document.getElementById('es-blend-wrap');
  if (wrap) wrap.style.display = isChecked ? 'block' : 'none';
  if (isChecked) {
    onEsBlendSlotsChange();
    renderEsBlendMappingWrap();
  }
}

function onEsBlendSlotsChange() {
  var t = Math.max(0, parseInt(getFieldValue('es-blend-theory')) || 0);
  var l = Math.max(0, parseInt(getFieldValue('es-blend-lab')) || 0);
  var hint = document.getElementById('es-blend-calc-hint');
  if (hint) hint.innerHTML = 'Total: <strong>' + (t + l) + '</strong> classes/week (' + t + ' Theory + ' + l + ' Lab)';
  if (document.getElementById('es-blend-chk')?.checked && (t + l) > 0) {
    var tgtEl = document.getElementById('es-stgt');
    if (tgtEl) tgtEl.value = (t + l);
    validateEsSlotsOrder('target');
  }
}

function validateEsSlotsOrder(changed) {
  var minEl = document.getElementById('es-smin');
  var tgtEl = document.getElementById('es-stgt');
  var maxEl = document.getElementById('es-smax');
  if (!minEl || !tgtEl || !maxEl) return;
  var min = Math.max(1, parseInt(minEl.value) || 4);
  var tgt = Math.max(1, parseInt(tgtEl.value) || 5);
  var max = Math.max(1, parseInt(maxEl.value) || 7);
  if (changed === 'target') {
    if (min > tgt) min = tgt;
    if (max < tgt) max = tgt;
  } else if (changed === 'min') {
    if (min > tgt) tgt = min;
    if (max < tgt) max = tgt;
  } else if (changed === 'max') {
    if (max < tgt) tgt = max;
    if (min > tgt) min = tgt;
  }
  minEl.value = min;
  tgtEl.value = tgt;
  maxEl.value = max;
}

function renderEsBlendMappingWrap(currentSub) {
  var wrap = document.getElementById('es-blend-map-info');
  if (!wrap) return;
  var cCode = (getFieldValue('es-cd') || (currentSub ? (currentSub.courseCode || currentSub.code) : '') || '').trim().toUpperCase();
  var sForm = (getFieldValue('es-ssc') || (currentSub ? (currentSub.shortForm || currentSub.shortName) : '') || '').trim().toUpperCase();
  var name = (getFieldValue('es-nm') || (currentSub ? currentSub.name : '') || '').trim();
  var type = getFieldValue('es-tp') || 'Theory';
  var curId = currentSub ? currentSub._id : currentSubjectId;

  var tag = document.getElementById('es-blend-code-tag');
  if (tag) tag.textContent = cCode || 'Shared Code';

  if (type === 'Theory') {
    var existingLab = (DB.get('subjects') || []).find(function (s) {
      return String(s._id) !== String(curId) &&
        ((s.courseCode && s.courseCode.toUpperCase() === cCode) || (s.code && s.code.toUpperCase() === cCode)) &&
        s.type === 'Lab';
    });
    if (existingLab) {
      wrap.innerHTML = '<div style="background:#fff;border:1.5px solid #a855f7;border-radius:8px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;">'
        + '<div><div style="font-size:11px;font-weight:700;color:#7e22ce;"><re-icon icon="link" size="12"></re-icon> Mapped Lab Component (Same Code: ' + escapeHtml(cCode) + ')</div>'
        + '<div style="font-weight:600;font-size:12px;color:var(--td);margin-top:2px;">' + escapeHtml(existingLab.name) + ' (' + escapeHtml(existingLab.shortForm || existingLab.shortName || 'LAB') + ')</div>'
        + '<div style="font-size:11px;color:var(--tmu);margin-top:1px;">Lab Component · ' + (existingLab.credits ?? 1) + ' Cr · ' + (existingLab.slotsTarget || existingLab.blendLabSlots || 2) + ' classes/wk</div></div>'
        + '<span class="pill pri" style="background:#f3e8ff;color:#7e22ce;font-size:10.5px;">Linked</span></div>'
        + '<input type="hidden" id="es-blend-mapped-lab-id" value="' + escapeHtml(existingLab._id) + '">';
    } else {
      var defaultLabShort = sForm ? (sForm.endsWith('-L') ? sForm : sForm + '-L') : 'LAB';
      var defaultLabName = name ? (name.toLowerCase().includes('lab') ? name : name + ' Lab') : 'Course Lab';
      wrap.innerHTML = '<div style="background:#fff;border:1.5px dashed #c084fc;border-radius:8px;padding:8px 12px;">'
        + '<label style="display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:#7e22ce;cursor:pointer;">'
        + '<input type="checkbox" id="es-blend-autolab-chk" checked onchange="document.getElementById(\'es-blend-autolab-fields\').style.display = this.checked ? \'grid\' : \'none\'">'
        + '<span>Auto-create Lab component with same Course Code (' + escapeHtml(cCode || '...') + ')</span></label>'
        + '<div id="es-blend-autolab-fields" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px;">'
        + '<div><label class="fl" style="font-size:10.5px;">Lab Short Code</label><input type="text" class="fc2" id="es-blend-lab-sc" value="' + escapeHtml(defaultLabShort) + '" style="font-size:11.5px;padding:4px 8px;"></div>'
        + '<div><label class="fl" style="font-size:10.5px;">Lab Subject Name</label><input type="text" class="fc2" id="es-blend-lab-nm" value="' + escapeHtml(defaultLabName) + '" style="font-size:11.5px;padding:4px 8px;"></div>'
        + '</div></div>'
        + '<input type="hidden" id="es-blend-mapped-lab-id" value="">';
    }
  } else if (type === 'Lab') {
    var existingTheory = (DB.get('subjects') || []).find(function (s) {
      return String(s._id) !== String(curId) &&
        ((s.courseCode && s.courseCode.toUpperCase() === cCode) || (s.code && s.code.toUpperCase() === cCode)) &&
        s.type === 'Theory';
    });
    if (existingTheory) {
      wrap.innerHTML = '<div style="background:#fff;border:1.5px solid #3b82f6;border-radius:8px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;">'
        + '<div><div style="font-size:11px;font-weight:700;color:#1d4ed8;"><re-icon icon="link" size="12"></re-icon> Mapped Theory Component (Same Code: ' + escapeHtml(cCode) + ')</div>'
        + '<div style="font-weight:600;font-size:12px;color:var(--td);margin-top:2px;">' + escapeHtml(existingTheory.name) + ' (' + escapeHtml(existingTheory.shortForm || existingTheory.shortName || 'THEORY') + ')</div></div>'
        + '<span class="pill pri" style="font-size:10.5px;">Linked</span></div>'
        + '<input type="hidden" id="es-blend-mapped-theory-id" value="' + escapeHtml(existingTheory._id) + '">';
    } else {
      wrap.innerHTML = '<div style="background:#fff;border:1px solid var(--br);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--tmu);">'
        + 'Course Code <code>' + escapeHtml(cCode || '—') + '</code> has no matching Theory component yet.</div>'
        + '<input type="hidden" id="es-blend-mapped-theory-id" value="">';
    }
  } else {
    wrap.innerHTML = '';
  }
}

function saveEditSubj() {
  if (!currentSubjectId) return;
  var name = getFieldValue('es-nm');
  var deptId = getFieldValue('es-dept');
  var selectedDept = (DB.get('depts') || []).find(function (d) { return String(d._id) === String(deptId); });
  var courseCode = (getFieldValue('es-cd') || '').trim().toUpperCase();
  var shortForm = (getFieldValue('es-ssc') || '').trim().toUpperCase();
  var credits = parseInt(getFieldValue('es-cr')) || 3;
  var type = getFieldValue('es-tp') || 'Theory';
  var regulation = getFieldValue('es-reg') || '2025';
  var subjectCode = (courseCode && shortForm) ? (courseCode + '-' + shortForm) : '';

  if (!name || !courseCode || !shortForm) {
    showToast('Subject Name, Course Code, and Subject Short Form are required', 'warn');
    return;
  }
  if (!deptId) {
    showToast('Please select a Department', 'warn');
    return;
  }

  // Duplicate check (case-insensitive)
  var dup = (DB.get('subjects') || []).find(function (s) {
    return String(s._id) !== String(currentSubjectId) &&
      (s.subjectCode || '').trim().toLowerCase() === subjectCode.toLowerCase();
  });
  if (dup) {
    showToast('Subject code "' + subjectCode + '" already exists for another subject (' + dup.name + ')', 'warn');
    return;
  }

  dbToast('Saving subject...', 'saving');
  var category = getFieldValue('es-cat') || 'easy';
  var blockLength = Math.max(1, parseInt(getFieldValue('es-bl')) || 1);
  var slotsMin = parseInt(getFieldValue('es-smin')) || 4;
  var slotsTarget = parseInt(getFieldValue('es-stgt')) || 5;
  var slotsMax = parseInt(getFieldValue('es-smax')) || 7;
  var isBlend = document.getElementById('es-blend-chk')?.checked === true;
  var blendTheorySlots = parseInt(getFieldValue('es-blend-theory')) || 0;
  var blendLabSlots = parseInt(getFieldValue('es-blend-lab')) || 0;
  var autoCreateLab = document.getElementById('es-blend-autolab-chk')?.checked === true;
  var labShortCode = (getFieldValue('es-blend-lab-sc') || '').trim().toUpperCase();
  var labName = (getFieldValue('es-blend-lab-nm') || '').trim();
  var mappedLabId = document.getElementById('es-blend-mapped-lab-id')?.value || null;
  var mappedTheoryId = document.getElementById('es-blend-mapped-theory-id')?.value || null;

  if (slotsMin > slotsTarget || slotsTarget > slotsMax) {
    showToast('Class counts must satisfy Min <= Target <= Max', 'warn');
    return;
  }
  if (isBlend && (blendTheorySlots + blendLabSlots <= 0)) {
    showToast('Blend subject must have at least 1 Theory or Lab class allocated', 'warn');
    return;
  }

  apiUpdateSubject(currentSubjectId, {
    name: name,
    deptId: deptId,
    deptName: selectedDept ? selectedDept.name : '',
    deptCode: selectedDept ? selectedDept.code : '',
    courseCode: courseCode,
    code: courseCode,
    shortForm: shortForm,
    shortName: shortForm,
    credits: credits,
    type: type,
    subjectCode: subjectCode,
    regulation: regulation,
    category: category,
    blockLength: blockLength,
    slotsMin: slotsMin,
    slotsTarget: slotsTarget,
    slotsMax: slotsMax,
    isBlend: isBlend,
    blendTheorySlots: isBlend ? blendTheorySlots : 0,
    blendLabSlots: isBlend ? blendLabSlots : 0,
    autoCreateLab: isBlend && autoCreateLab,
    labShortCode: labShortCode,
    labName: labName,
    labComponentId: isBlend ? mappedLabId : null,
    theoryComponentId: isBlend ? mappedTheoryId : null
  }).then(function (d) {
    if (!d || d.error) {
      dbToast('Update failed: ' + (d && d.error ? d.error : 'Unknown'), 'error');
      return;
    }
    addLog('Subject Updated', '"' + name + '"');

    var updatedSubj = (DB.get('subjects') || []).find(function (s) { return String(s._id) === String(currentSubjectId); });
    if (updatedSubj) {
      if (selectedDept) {
        updatedSubj.deptId = selectedDept._id;
        updatedSubj.deptName = selectedDept.name;
        updatedSubj.deptCode = selectedDept.code;
      }
      _updateUnifiedModalHeader(updatedSubj);
      _renderUnifiedOverview(updatedSubj);
    }

    if (structureContext && structureContext.deptId) {
      renderClassSubjectView(structureContext.deptId);
    }
    dbToast('Subject "' + name + '" updated', 'success');
  }).catch(function (err) {
    dbToast('Failed to update subject', 'error');
  });
}

function ncAutoName() {
  var deptId = getFieldValue('nc-dept');
  var batch = getFieldValue('nc-batch');
  var yr = getFieldValue('nc-yr') || 'I Year';
  var sem = getFieldValue('nc-sem') || 'I';
  var secInput = document.getElementById('nc-sec');
  var section = (secInput ? secInput.value : '').trim().toUpperCase();
  var dept = DB.get('depts').find(function (d) { return d._id === deptId; });
  var nameEl = document.getElementById('nc-name');
  var warnEl = document.getElementById('nc-warn');
  var addBtn = document.getElementById('nc-add-btn');
  var hintEl = document.getElementById('nc-hint');

  // Preview elements
  var prevAv = document.getElementById('nc-preview-av');
  var prevName = document.getElementById('nc-preview-name');
  var prevBadge = document.getElementById('nc-preview-badge');
  var dispBatch = document.getElementById('nc-disp-batch');
  var dispYr = document.getElementById('nc-disp-yr');
  var dispSem = document.getElementById('nc-disp-sem');
  var dispRoom = document.getElementById('nc-disp-room');

  if (dispBatch) dispBatch.textContent = batch || '—';
  if (dispYr) dispYr.textContent = yr || '—';
  if (dispSem) dispSem.textContent = sem || '—';

  // Room preview
  var roomSel = document.getElementById('nc-room');
  var roomText = 'Not assigned';
  if (roomSel && roomSel.selectedIndex > 0) {
    roomText = roomSel.options[roomSel.selectedIndex].text;
  }
  if (dispRoom) {
    dispRoom.textContent = roomText;
    dispRoom.className = 'cls-kv-val' + (roomText === 'Not assigned' ? ' pd' : '');
  }

  var secInitial = section ? section.charAt(0) : 'A';
  if (prevAv) prevAv.textContent = secInitial;
  if (prevBadge) prevBadge.textContent = yr + ' · Semester ' + sem;

  if (dept && batch && section) {
    var batchV = formatBatchShort(batch);
    var autoName = batchV + ' ' + dept.code + '-' + section;
    if (nameEl) nameEl.value = autoName;
    if (prevName) prevName.textContent = autoName;

    // Check duplicate
    var dup = DB.get('classes').find(function (cls) {
      return cls.deptId === deptId && cls.batch === batch && cls.section === section;
    });
    if (dup) {
      if (warnEl) {
        warnEl.innerHTML = '<re-icon icon="alert-triangle"></re-icon> Class "' + autoName + '" already exists for this department/batch/section.';
        warnEl.style.display = 'block';
      }
      if (hintEl) {
        hintEl.innerHTML = '<b style="color:#dc2626;">Duplicate class</b> · Class ' + escapeHtml(autoName) + ' already exists';
      }
      if (addBtn) {
        addBtn.disabled = true;
        addBtn.className = 'bt d cls-btn-submit';
        addBtn.style.opacity = '.5';
        addBtn.style.cursor = 'not-allowed';
      }
    } else {
      if (warnEl) warnEl.style.display = 'none';
      if (hintEl) {
        hintEl.innerHTML = '<b>Ready to add</b> · class name will be ' + escapeHtml(autoName);
      }
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.className = 'bt p cls-btn-submit';
        addBtn.style.opacity = '1';
        addBtn.style.cursor = 'pointer';
      }
    }
  } else {
    var draftName = (batch ? formatBatchShort(batch) : 'YY-YY') + ' ' + (dept ? dept.code : 'DEPT') + '-' + (section || 'SEC');
    if (nameEl) nameEl.value = '';
    if (prevName) prevName.textContent = draftName;
    if (warnEl) warnEl.style.display = 'none';
    if (hintEl) {
      var missing = [];
      if (!dept) missing.push('department');
      if (!batch) missing.push('batch');
      if (!section) missing.push('section');
      hintEl.innerHTML = '<b>Fill required fields</b> (' + missing.join(', ') + ')';
    }
    if (addBtn) {
      addBtn.disabled = true;
      addBtn.className = 'bt d cls-btn-submit';
      addBtn.style.opacity = '.5';
      addBtn.style.cursor = 'not-allowed';
    }
  }
}

function onNcBatchChange() {
  var batch = getFieldValue('nc-batch');
  var dispBatch = document.getElementById('nc-disp-batch');
  if (dispBatch) dispBatch.textContent = batch || '—';
  ncAutoName();
}

function onNcYearChange() {
  var yr = getFieldValue('nc-yr');
  var dispYr = document.getElementById('nc-disp-yr');
  if (dispYr) dispYr.textContent = yr || '—';

  // Automatically adjust semesters based on year
  var semSel = document.getElementById('nc-sem');
  if (semSel && yr) {
    var semMap = {
      'I Year': ['I', 'II'],
      'II Year': ['III', 'IV'],
      'III Year': ['V', 'VI'],
      'IV Year': ['VII', 'VIII']
    };
    var sems = semMap[yr] || ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
    var currentSem = semSel.value;
    semSel.innerHTML = sems.map(function (s) {
      return '<option value="' + s + '">' + s + '</option>';
    }).join('');
    if (sems.indexOf(currentSem) !== -1) {
      semSel.value = currentSem;
    } else {
      semSel.value = sems[0];
    }
  }
  ncAutoName();
}
function isDevMode() {
  if (typeof window._pubSettings !== 'undefined' && window._pubSettings && typeof window._pubSettings.isDev === 'boolean') {
    return window._pubSettings.isDev;
  }
  if (typeof window._eamsIsDev === 'boolean') {
    return window._eamsIsDev;
  }
  var host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || window.location.port === '3000' || window.location.port === '5000';
}

function updateRoomReqVisibility() {
  var reqEl = document.getElementById('nc-room-req');
  if (reqEl) {
    reqEl.style.display = isDevMode() ? 'none' : 'inline';
  }
}

function openAddClassModal(deptId) {
  // Ensure dropdowns are populated with latest DB data
  populateAdminDropdowns();
  _populateFacilityRoomDropdowns();
  updateRoomReqVisibility();

  // Reset fields
  document.getElementById('nc-sec').value = '';
  var ncRoomEl = document.getElementById('nc-room');
  if (ncRoomEl) ncRoomEl.value = '';
  if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('nc-room');
  document.getElementById('nc-hall').value = '';
  document.getElementById('nc-name').value = '';
  var warnEl = document.getElementById('nc-warn');
  if (warnEl) warnEl.style.display = 'none';
  var addBtn = document.getElementById('nc-add-btn');
  if (addBtn) { addBtn.disabled = true; addBtn.style.opacity = '.5'; addBtn.style.cursor = 'not-allowed'; }

  // Auto-select current dept from structure context or passed deptId
  var targetDeptId = deptId || (structureContext && structureContext.deptId);
  if (targetDeptId) {
    var deptSel = document.getElementById('nc-dept');
    if (deptSel) {
      deptSel.value = targetDeptId;
      if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('nc-dept');
      ncAutoName(); // trigger name generation
    }
  }

  openModal_('m-add-class-quick');
}

function ncValidate() { ncAutoName(); }
function ncdc() { ncAutoName(); }

function ncOnRoomChange() {
  var sel = document.getElementById('nc-room');
  var hallInput = document.getElementById('nc-hall');
  if (!sel || !hallInput) return;
  var opt = sel.options[sel.selectedIndex];
  hallInput.value = (opt && opt.getAttribute('data-hall')) || (opt && opt.value ? opt.text : '');
  ncAutoName();
}

function addCls() {
  var deptId = getFieldValue('nc-dept');
  var year = getFieldValue('nc-yr');
  var sem = getFieldValue('nc-sem');
  var batch = getFieldValue('nc-batch');
  var section = (document.getElementById('nc-sec').value || '').trim() || '';
  var roomId = getFieldValue('nc-room') || null;
  var hallNo = getFieldValue('nc-hall');
  if (roomId && !hallNo) {
    var sel = document.getElementById('nc-room');
    if (sel && sel.selectedIndex >= 0) {
      hallNo = sel.options[sel.selectedIndex].getAttribute('data-hall') || '';
    }
  }
  if (!deptId) { showToast('Select a department', 'warn'); return; }
  if (!batch) { showToast('Select a batch', 'warn'); return; }
  if (!section) { showToast('Enter a section', 'warn'); return; }
  if (!isDevMode() && !roomId && !hallNo) { showToast('Select an assigned room / hall', 'warn'); return; }
  var dept = DB.get('depts').find(function (d) { return d._id === deptId; });
  var className = getFieldValue('nc-name');
  // Final duplicate check
  if (DB.get('classes').find(function (cls) { return cls.name.toLowerCase() === className.toLowerCase(); })) {
    showToast('Class "' + className + '" already exists!', 'warn'); return;
  }
  apiAddClass({ deptId: deptId, deptName: dept.name, deptCode: dept.code, year: year, sem: sem, section: section, roomId: roomId, hallNo: hallNo, name: className, batch: batch })
    .then(function (d) {
      if (!d) return;
      closeModalBg('m-add-class-quick');
      document.getElementById('nc-sec').value = '';
      var ncRoom = document.getElementById('nc-room');
      if (ncRoom) ncRoom.value = '';
      if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('nc-room');
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
  if (deptSel) {
    deptSel.value = structureContext.deptId;
    if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('ns-dept');
  }

  // Show active dept in modal title
  var titleEl = document.querySelector('#m-add-subj-ctx .modal-title');
  if (titleEl) titleEl.innerHTML = '<re-icon icon="book-open"></re-icon> Add Subject';

  // Clear previous input values
  ['ns-nm', 'ns-ssc', 'ns-cd', 'ns-sc'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var warnEl = document.getElementById('ns-warn');
  if (warnEl) warnEl.style.display = 'none';
  var addBtn = document.getElementById('ns-add-btn');
  if (addBtn) {
    addBtn.removeAttribute('data-dup-disabled');
    addBtn.disabled = true;
    addBtn.classList.add('d');
    addBtn.classList.remove('p');
    addBtn.style.opacity = '0.6';
    addBtn.style.cursor = 'not-allowed';
  }
  var crEl = document.getElementById('ns-cr');
  if (crEl) crEl.value = '3';
  if (document.getElementById('ns-tp')) document.getElementById('ns-tp').value = 'Theory';
  if (document.getElementById('ns-reg')) document.getElementById('ns-reg').value = '2025';
  if (document.getElementById('ns-cat')) document.getElementById('ns-cat').value = 'easy';
  if (document.getElementById('ns-bl')) document.getElementById('ns-bl').value = '1';
  if (document.getElementById('ns-smin')) document.getElementById('ns-smin').value = '4';
  if (document.getElementById('ns-stgt')) document.getElementById('ns-stgt').value = '5';
  if (document.getElementById('ns-smax')) document.getElementById('ns-smax').value = '7';
  var nsBlendChk = document.getElementById('ns-blend-chk');
  if (nsBlendChk) nsBlendChk.checked = false;
  var sw = document.getElementById('ns-blend-sw');
  if (sw) sw.classList.remove('on');
  if (document.getElementById('ns-blend-theory')) document.getElementById('ns-blend-theory').value = '4';
  if (document.getElementById('ns-blend-lab')) document.getElementById('ns-blend-lab').value = '2';
  toggleNsBlend(false);
  renderNsBlendMappingWrap();
  updateNsSubjPreview();
  openModal_('m-add-subj-ctx');
}

function nsScAuto() {
  var courseCode = (getFieldValue('ns-cd') || '').trim().toUpperCase();
  var shortForm = (getFieldValue('ns-ssc') || '').trim().toUpperCase();
  var subjectCode = (courseCode && shortForm) ? (courseCode + '-' + shortForm) : '';
  var scEl = document.getElementById('ns-sc');
  if (scEl) scEl.value = subjectCode;

  var warnEl = document.getElementById('ns-warn');
  var addBtn = document.getElementById('ns-add-btn');

  if (subjectCode) {
    var dup = (DB.get('subjects') || []).find(function (s) {
      return (s.subjectCode || '').trim().toLowerCase() === subjectCode.toLowerCase();
    });
    if (dup) {
      if (warnEl) {
        warnEl.innerHTML = '<re-icon icon="alert-triangle"></re-icon> Subject Code <b>"' + escapeHtml(subjectCode) + '"</b> already exists (' + escapeHtml(dup.name) + ').';
        warnEl.style.display = 'block';
      }
      if (addBtn) {
        addBtn.setAttribute('data-dup-disabled', '1');
        addBtn.disabled = true;
        addBtn.classList.add('d');
        addBtn.classList.remove('p');
        addBtn.style.opacity = '0.5';
        addBtn.style.cursor = 'not-allowed';
      }
    } else {
      if (warnEl) warnEl.style.display = 'none';
      if (addBtn) {
        addBtn.removeAttribute('data-dup-disabled');
      }
    }
  } else {
    if (warnEl) warnEl.style.display = 'none';
    if (addBtn) {
      addBtn.removeAttribute('data-dup-disabled');
    }
  }
  updateNsSubjPreview();
}

// ── Auto Subject Code (Edit: courseCode + '-' + shortForm) ────────────────
function esScAuto() {
  var courseCode = (getFieldValue('es-cd') || '').trim().toUpperCase();
  var shortForm = (getFieldValue('es-ssc') || '').trim().toUpperCase();
  var editedSubjId = currentSubjectId || window.activeEditSubjId || '';
  var saveBtn = document.getElementById('es-save-btn');
  var warnEl = document.getElementById('es-warn');

  var subjectCode = (courseCode && shortForm) ? (courseCode + '-' + shortForm) : '';
  var scEl = document.getElementById('es-sc');
  if (scEl) scEl.value = subjectCode;

  if (subjectCode) {
    // Check for duplicates (case-insensitive, ignore the currently editing subject)
    var dup = (DB.get('subjects') || []).find(function (sub) {
      return String(sub._id) !== String(editedSubjId) &&
        (sub.subjectCode || '').trim().toLowerCase() === subjectCode.toLowerCase();
    });

    if (dup) {
      if (warnEl) {
        warnEl.innerHTML = '<re-icon icon="alert-triangle"></re-icon> Subject Code <b>"' + escapeHtml(subjectCode) + '"</b> already exists (' + escapeHtml(dup.name) + ').';
        warnEl.style.display = 'block';
      }
      showToast('Subject code "' + subjectCode + '" already exists (' + dup.name + ')', 'warn');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.5'; saveBtn.style.cursor = 'not-allowed'; }
    } else {
      if (warnEl) warnEl.style.display = 'none';
      if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; saveBtn.style.cursor = 'pointer'; }
    }
  } else {
    if (warnEl) warnEl.style.display = 'none';
    if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; saveBtn.style.cursor = 'pointer'; }
  }
}

function addSubCtx() {
  var name = getFieldValue('ns-nm');
  var courseCode = (getFieldValue('ns-cd') || '').trim().toUpperCase();
  var shortForm = (getFieldValue('ns-ssc') || '').trim().toUpperCase();
  var credits = parseInt(getFieldValue('ns-cr')) || 3;
  var type = getFieldValue('ns-tp') || 'Theory';
  var regulation = getFieldValue('ns-reg') || '2025';
  var subjectCode = (courseCode && shortForm) ? (courseCode + '-' + shortForm) : '';
  if (!name || !courseCode || !shortForm) {
    showToast('Subject Name, Course Code, and Subject Short Form are required', 'warn');
    return;
  }
  if (!structureContext.deptId) {
    showToast('Please select a department first by exploring structure', 'warn');
    return;
  }
  var dept = DB.get('depts').find(function (d) { return d._id === structureContext.deptId; });

  // Case-insensitive duplicate check
  var dup = (DB.get('subjects') || []).find(function (s) {
    return (s.subjectCode || '').trim().toLowerCase() === subjectCode.toLowerCase();
  });
  if (dup) {
    showToast('Subject Code "' + subjectCode + '" already exists (' + dup.name + ')', 'warn');
    return;
  }

  var category = getFieldValue('ns-cat') || 'easy';
  var blockLength = Math.max(1, parseInt(getFieldValue('ns-bl')) || 1);
  var slotsMin = parseInt(getFieldValue('ns-smin')) || 4;
  var slotsTarget = parseInt(getFieldValue('ns-stgt')) || 5;
  var slotsMax = parseInt(getFieldValue('ns-smax')) || 7;
  var isBlend = document.getElementById('ns-blend-chk')?.checked === true;
  var blendTheorySlots = parseInt(getFieldValue('ns-blend-theory')) || 0;
  var blendLabSlots = parseInt(getFieldValue('ns-blend-lab')) || 0;
  var autoCreateLab = document.getElementById('ns-blend-autolab-chk')?.checked === true;
  var labShortCode = (getFieldValue('ns-blend-lab-sc') || '').trim().toUpperCase();
  var labName = (getFieldValue('ns-blend-lab-nm') || '').trim();

  if (slotsMin > slotsTarget || slotsTarget > slotsMax) {
    showToast('Class counts must satisfy Min <= Target <= Max', 'warn');
    return;
  }
  if (isBlend && (blendTheorySlots + blendLabSlots <= 0)) {
    showToast('Blend subject must have at least 1 Theory or Lab class allocated', 'warn');
    return;
  }

  apiAddSubject({
    name: name,
    courseCode: courseCode,
    code: courseCode,
    shortForm: shortForm,
    shortName: shortForm,
    credits: credits,
    type: type,
    deptId: structureContext.deptId,
    deptName: dept ? dept.name : '',
    deptCode: dept ? dept.code : '',
    subjectCode: subjectCode,
    regulation: regulation,
    category: category,
    blockLength: blockLength,
    slotsMin: slotsMin,
    slotsTarget: slotsTarget,
    slotsMax: slotsMax,
    isBlend: isBlend,
    blendTheorySlots: isBlend ? blendTheorySlots : 0,
    blendLabSlots: isBlend ? blendLabSlots : 0,
    autoCreateLab: isBlend && autoCreateLab,
    labShortCode: labShortCode,
    labName: labName
  })
    .then(function (newSubject) {
      if (!newSubject || newSubject.error) return;

      closeModalBg('m-add-subj-ctx');
      renderClassSubjectView(structureContext.deptId);
      addLog('Subject Added', '"' + name + '" (' + courseCode + ')');
      dbToast('Subject "' + name + '" added', 'success');
      clearInputs(['ns-nm', 'ns-cd', 'ns-ssc', 'ns-sc']);
      var warnEl = document.getElementById('ns-warn');
      if (warnEl) warnEl.style.display = 'none';
      var addBtn = document.getElementById('ns-add-btn');
      if (addBtn) { addBtn.disabled = false; addBtn.style.opacity = '1'; }
    });
}



function _buildSaClassOptions(selectedId) {
  var classes = DB.get('classes') || [];
  return '<option value="">\u2014 Select Section \u2014</option>'
    + classes.map(function (c) {
      var hall = (c.roomId && c.roomId.hallNo) || c.hallNo || '';
      var deptCode = c.deptCode || (c.department && c.department.code) || '';
      var deptName = deptCode || c.deptName || '';
      var label = c.name + (deptName ? ' — ' + deptName : '');
      var isSel = (String(c._id) === String(selectedId)) ? ' selected' : '';
      return '<option value="' + c._id + '"'
        + ' data-hall="' + escapeHtml(hall) + '"'
        + ' data-dept-id="' + (c.deptId || '') + '"'
        + (deptCode ? ' data-badge="' + escapeHtml(deptCode) + '"' : '')
        + isSel + '>'
        + escapeHtml(label)
        + '</option>';
    }).join('');
}

function _buildSaTeacherOptions(selectedId, deptId) {
  var teachers = DB.get('teachers');
  if (!Array.isArray(teachers) || teachers.length === 0) {
    teachers = (DB.get('users') || []).filter(function (u) { return u.role === 'teacher'; });
  }
  if (!Array.isArray(teachers)) teachers = [];

  // Filter or prioritize by deptId if matching teachers exist
  var listToRender = teachers;
  if (deptId) {
    var deptMatches = teachers.filter(function (t) {
      return String(t.deptId || '') === String(deptId) || String(t.dept || '') === String(deptId);
    });
    if (deptMatches.length > 0) {
      var otherTeachers = teachers.filter(function (t) {
        return String(t.deptId || '') !== String(deptId) && String(t.dept || '') !== String(deptId);
      });
      listToRender = deptMatches.concat(otherTeachers);
    }
  }

  return '<option value="">\u2014 Select Staff \u2014</option>'
    + listToRender.map(function (t) {
      var tName = (t.fullName || t.name || t.username || 'Teacher').trim();
      var empNo = (t.empId || t.employeeNo || '').trim();
      var deptCode = (typeof resolveTeacherDeptCode === 'function') ? resolveTeacherDeptCode(t) : (t.deptCode || t.dept || t.department || '');
      var isSel = (String(t._id) === String(selectedId) || String(t.trackId || '') === String(selectedId)) ? ' selected' : '';
      return '<option value="' + (t._id || t.trackId) + '"'
        + ' data-name="' + escapeHtml(tName) + '"'
        + (deptCode ? ' data-badge="' + escapeHtml(deptCode) + '" data-dept="' + escapeHtml(deptCode) + '"' : '')
        + (empNo ? ' data-sub="' + escapeHtml(empNo) + '"' : '')
        + isSel + '>'
        + escapeHtml(tName + (deptCode ? ' (' + deptCode + ')' : ''))
        + '</option>';
    }).join('');
}

function addAssignRow(classId, teacherId, hallNo) {
  var tbody = document.getElementById('sa-rows');
  if (!tbody) return;
  var tr = document.createElement('tr');
  tr.className = 'sa-row';
  tr.style.borderBottom = '1px solid var(--brl)';
  var deptId = '';
  var cls = null;
  if (classId) {
    cls = (DB.get('classes') || []).find(function (c) { return String(c._id) === String(classId); });
    if (cls) deptId = cls.deptId || '';
  }
  var rowUid = 'sa-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
  var clsSelectId = 'sa-cls-' + rowUid;
  var tchSelectId = 'sa-tch-' + rowUid;

  tr.innerHTML =
    '<td style="padding:8px 10px;vertical-align:middle;">'
    + '<select class="fc2 sa-cls" id="' + clsSelectId + '" onchange="onSaClassChange(this)" style="font-size:13px;padding:8px 10px;min-width:170px;">'
    + _buildSaClassOptions(classId || '')
    + '</select></td>'
    + '<td style="padding:8px 10px;vertical-align:middle;">'
    + '<select class="fc2 sa-tch" id="' + tchSelectId + '" style="font-size:13px;padding:8px 10px;min-width:170px;">'
    + _buildSaTeacherOptions(teacherId || '', deptId)
    + '</select></td>'
    + '<td style="padding:8px 10px;vertical-align:middle;">'
    + '<input type="text" class="fc2 sa-hall" placeholder="e.g. H101" maxlength="20"'
    + ' style="font-size:13px;padding:8px 10px;min-width:90px;height:38px;box-sizing:border-box;" value="' + escapeHtml(hallNo || '') + '">'
    + '</td>'
    + '<td style="padding:8px 10px;text-align:center;vertical-align:middle;">'
    + '<button type="button" onclick="removeAssignRow(this)" style="background:var(--red);color:#fff;border:none;border-radius:8px;'
    + 'width:30px;height:30px;cursor:pointer;font-size:15px;line-height:1;display:inline-flex;align-items:center;'
    + 'justify-content:center;" title="Remove row"><re-icon icon="x"></re-icon></button>'
    + '</td>';
  tbody.appendChild(tr);

  // Auto-fill hall from class default when no hallNo supplied
  if (!hallNo && classId && cls && (cls.roomId || cls.hallNo)) {
    tr.querySelector('.sa-hall').value = (cls.roomId && cls.roomId.hallNo) || cls.hallNo || '';
  }

  // Upgrade selects to SearchableDropdown
  var clsSel = tr.querySelector('.sa-cls');
  var tchSel = tr.querySelector('.sa-tch');
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.attach(clsSel, {
      kind: 'class',
      placeholder: '— Select Section —',
      searchPlaceholder: 'Search class, section, batch…'
    });
    SearchableDropdown.attach(tchSel, {
      kind: 'teacher',
      placeholder: '— Select Staff —',
      searchPlaceholder: 'Search teacher name, dept, ID…'
    });
  }
}

function onSaClassChange(sel) {
  var tr = sel.closest ? sel.closest('tr') : sel.parentNode.parentNode;
  if (!tr) return;
  var opt = sel.options[sel.selectedIndex];
  var hall = opt ? (opt.getAttribute('data-hall') || '') : '';
  tr.querySelector('.sa-hall').value = hall;
  // Scope teacher dropdown to selected class's department
  var deptId = opt ? (opt.getAttribute('data-dept-id') || opt.getAttribute('data-dept') || '') : '';
  var tchSel = tr.querySelector('.sa-tch');
  if (tchSel) {
    var curVal = tchSel.value;
    tchSel.innerHTML = _buildSaTeacherOptions(curVal, deptId);
    if (typeof SearchableDropdown !== 'undefined') {
      SearchableDropdown.sync(tchSel);
    }
  }
}

function removeAssignRow(btn) {
  var tr = btn.closest ? btn.closest('tr') : btn.parentNode.parentNode;
  var tbody = document.getElementById('sa-rows');
  if (tbody.querySelectorAll('tr.sa-row').length <= 1) {
    showToast('At least one row is required', 'warn'); return;
  }
  var clsSel = tr.querySelector('.sa-cls');
  var tchSel = tr.querySelector('.sa-tch');
  if (typeof SearchableDropdown !== 'undefined') {
    var cInst = SearchableDropdown.get(clsSel);
    if (cInst) cInst.destroy();
    var tInst = SearchableDropdown.get(tchSel);
    if (tInst) tInst.destroy();
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
      closeModalBg('m-subj-unified');
      addLog('Assignments Bulk Saved', d.count + ' sections <re-icon icon="arrow-right"></re-icon> ' + subj.name);

      var asgnBadge = document.getElementById('sm-badge-asgn');
      if (asgnBadge) asgnBadge.textContent = d.count;
      var currentSubj = (DB.get('subjects') || []).find(function (s) { return String(s._id) === String(subjectId); });
      if (currentSubj) _renderUnifiedOverview(currentSubj, enriched);

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
  if (yearEl) { yearEl.innerHTML = '<option value="">Loading…</option>'; }
  if (batchEl) { batchEl.innerHTML = '<option value="">Loading…</option>'; }
  if (clsEl) { clsEl.innerHTML = '<option value="">All Classes</option>'; clsEl.value = ''; }
  if (deptEl) {
    if (isCurrentUserSuperAdmin()) {
      var dInfo = getCurrentUserDeptInfo();
      var myDeptId = dInfo.id;
      var myDeptName = dInfo.name;
      if (!myDeptId) {
        var found = (DB.get('depts') || []).find(function (d) { return d.name === myDeptName; });
        if (found) myDeptId = found._id;
      }
      var myCode = (dInfo && (dInfo.code || dInfo.threeLetterCode)) || '';
      if (!myCode && myDeptName) {
        myCode = (typeof SearchableDropdown !== 'undefined' && SearchableDropdown.normalizeDeptCode)
          ? SearchableDropdown.normalizeDeptCode(myDeptName) : '';
      }
      if (myDeptName && myDeptName.toLowerCase().includes('mathematics')) myCode = 'MAT';
      deptEl.innerHTML = '<option value="' + (myDeptId || '') + '" data-badge="' + escapeHtml(myCode || '') + '">' + escapeHtml(myDeptName || 'My Department') + '</option>';
      deptEl.value = myDeptId || '';
      deptEl.disabled = true;
      deptEl.style.cursor = 'not-allowed';
    } else {
      var depts = Array.isArray(DB.get('depts')) ? DB.get('depts') : [];
      deptEl.innerHTML = '<option value="">All Departments</option>'
        + depts.map(function (d) {
            var code = d.code || d.threeLetterCode || '';
            if (!code && d.name) {
              code = (typeof SearchableDropdown !== 'undefined' && SearchableDropdown.normalizeDeptCode)
                ? SearchableDropdown.normalizeDeptCode(d.name) : '';
            }
            if (d.name && d.name.toLowerCase().includes('mathematics')) code = 'MAT';
            return '<option value="' + d._id + '" data-badge="' + escapeHtml(code || '') + '">' + escapeHtml(d.name) + '</option>';
          }).join('');
      deptEl.value = '';
      deptEl.disabled = false;
      deptEl.style.cursor = '';
    }
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
    YEAR_CONFIG.yearsData = Array.isArray(results[2]) ? results[2] : [];
    if (allYears.length) YEAR_CONFIG.all = allYears;

    var allBatchesSet = new Set(batchList);
    if (YEAR_CONFIG.yearsData && Array.isArray(YEAR_CONFIG.yearsData)) {
      YEAR_CONFIG.yearsData.forEach(function (y) {
        if (Array.isArray(y.batches)) {
          y.batches.forEach(function (b) { if (b && b.batch) allBatchesSet.add(b.batch); });
        }
      });
    }
    var classes = DB.get('classes') || [];
    classes.forEach(function (c) { if (c && c.batch) allBatchesSet.add(c.batch); });
    if (Array.isArray(_studentData)) {
      _studentData.forEach(function (s) { if (s && s.batch) allBatchesSet.add(s.batch); });
    }
    var finalBatches = Array.from(allBatchesSet).filter(Boolean).sort().reverse();
    YEAR_CONFIG.batches = finalBatches;

    var yearOptions = (YEAR_CONFIG.all && YEAR_CONFIG.all.length) ? YEAR_CONFIG.all : (currentYear ? [currentYear] : []);
    if (yearEl) {
      yearEl.innerHTML = '<option value="">All Years</option>'
        + yearOptions.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('');
      yearEl.value = '';
    }
    if (batchEl) {
      var currentVal = batchEl.value || '';
      batchEl.innerHTML = '<option value="">All Batches</option>'
        + finalBatches.map(function (b) {
          var yr = getBatchYearLevel(b);
          var yrAttr = yr ? ' data-year="' + escapeHtml(yr) + '"' : '';
          return '<option value="' + escapeHtml(b) + '"' + yrAttr + (b === currentVal ? ' selected' : '') + '>' + escapeHtml(b) + '</option>';
        }).join('');
      if (currentVal && finalBatches.indexOf(currentVal) !== -1) {
        batchEl.value = currentVal;
      }
    }
    if (typeof SearchableDropdown !== 'undefined') {
      SearchableDropdown.sync('sf-batch');
      SearchableDropdown.sync('sf-ct');
      SearchableDropdown.sync('sf-dept');
    }
    return _fetchClasses();
  }).then(function () {
    updateShowListEnabled();
  }).catch(function () {
    var allBatchesSet = new Set(Array.isArray(YEAR_CONFIG.batches) ? YEAR_CONFIG.batches : []);
    var classes = DB.get('classes') || [];
    classes.forEach(function (c) { if (c && c.batch) allBatchesSet.add(c.batch); });
    var finalBatches = Array.from(allBatchesSet).filter(Boolean).sort().reverse();

    if (yearEl) {
      var fallbackYears = (YEAR_CONFIG.all && YEAR_CONFIG.all.length) ? YEAR_CONFIG.all : (YEAR_CONFIG.current ? [YEAR_CONFIG.current] : []);
      yearEl.innerHTML = '<option value="">All Years</option>'
        + fallbackYears.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('');
      yearEl.value = '';
    }
    if (batchEl) {
      var currentVal = batchEl.value || '';
      batchEl.innerHTML = '<option value="">All Batches</option>'
        + finalBatches.map(function (b) {
          var yr = getBatchYearLevel(b);
          var yrAttr = yr ? ' data-year="' + escapeHtml(yr) + '"' : '';
          return '<option value="' + escapeHtml(b) + '"' + yrAttr + (b === currentVal ? ' selected' : '') + '>' + escapeHtml(b) + '</option>';
        }).join('');
      if (currentVal && finalBatches.indexOf(currentVal) !== -1) {
        batchEl.value = currentVal;
      }
    }
    if (typeof SearchableDropdown !== 'undefined') {
      SearchableDropdown.sync('sf-batch');
      SearchableDropdown.sync('sf-ct');
      SearchableDropdown.sync('sf-dept');
    }
    return _fetchClasses().then(function () {
      updateShowListEnabled();
    });
  });
}

function _resetClassDropdown() {
  var clsEl = document.getElementById('sf-cls');
  if (clsEl) { clsEl.innerHTML = '<option value="">All Classes</option>'; clsEl.value = ''; }
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('sf-cls');
  }
}

function _fetchClasses() {
  var deptId = document.getElementById('sf-dept') ? document.getElementById('sf-dept').value : '';
  var batch = document.getElementById('sf-batch') ? document.getElementById('sf-batch').value : '';
  var clsEl = document.getElementById('sf-cls');
  if (!clsEl) return Promise.resolve();
  clsEl.innerHTML = '<option value="">Loading…</option>';
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('sf-cls');
  }
  var tok = getToken();
  if (!tok) return Promise.resolve();
  var url = '/api/classes';
  var params = [];
  if (deptId) params.push('deptId=' + encodeURIComponent(deptId));
  if (batch) params.push('batch=' + encodeURIComponent(batch));
  if (params.length) url += '?' + params.join('&');

  return fetch(url, { headers: { 'Authorization': 'Bearer ' + tok } })
    .then(function (r) { return r.json(); })
    .then(function (classes) {
      if (!Array.isArray(classes)) classes = [];
      window.__filteredClasses = classes;
      if (classes.length && (!deptId && !batch)) {
        DB.set('classes', classes);
      }
      var currentVal = clsEl.value || '';
      var html = '<option value="">All Classes</option>';
      classes.forEach(function (c) {
        var label = c.name || '';
        if (c.section && !label.toLowerCase().includes(c.section.toLowerCase())) {
          label += ' (' + c.section + ')';
        }
        var isSel = (String(c._id) === String(currentVal)) ? ' selected' : '';
        html += '<option value="' + c._id + '" data-name="' + escapeHtml(c.name || '') + '"' + isSel + '>' + escapeHtml(label) + '</option>';
      });
      clsEl.innerHTML = html;
      if (typeof SearchableDropdown !== 'undefined') {
        SearchableDropdown.sync('sf-cls');
      }
    })
    .catch(function () {
      var dbClasses = (DB.get('classes') || []).filter(function (c) {
        var mDept = !deptId || String(c.deptId) === String(deptId);
        var mBatch = !batch || String(c.batch || '').trim() === String(batch).trim();
        return mDept && mBatch;
      });
      window.__filteredClasses = dbClasses;
      var html = '<option value="">All Classes</option>';
      dbClasses.forEach(function (c) {
        var label = c.name || '';
        if (c.section && !label.toLowerCase().includes(c.section.toLowerCase())) {
          label += ' (' + c.section + ')';
        }
        html += '<option value="' + c._id + '" data-name="' + escapeHtml(c.name || '') + '">' + escapeHtml(label) + '</option>';
      });
      clsEl.innerHTML = html;
      if (typeof SearchableDropdown !== 'undefined') {
        SearchableDropdown.sync('sf-cls');
      }
    });
}

function onStudentYearChange() {
  var batchEl = document.getElementById('sf-batch');
  if (batchEl) { batchEl.value = ''; }
  _fetchClasses();
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('sf-batch');
    SearchableDropdown.sync('sf-cls');
  }
  updateShowListEnabled();
}

function onStudentBatchChange() {
  _fetchClasses();
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('sf-batch');
    SearchableDropdown.sync('sf-cls');
  }
  updateShowListEnabled();
}

function onStudentCourseTypeChange() {
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('sf-ct');
  }
  updateShowListEnabled();
}

function onStudentDeptChange() {
  _fetchClasses();
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('sf-dept');
    SearchableDropdown.sync('sf-cls');
  }
  updateShowListEnabled();
}

function onStudentClassChange() {
  updateShowListEnabled();
}

function onStudentResidencyChange() {
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('sf-residency');
  }
  updateShowListEnabled();
}

function onStudentAdmissionTypeChange() {
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('sf-admission-type');
  }
  updateShowListEnabled();
}
window.onStudentAdmissionTypeChange = onStudentAdmissionTypeChange;

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
  var qEl = document.getElementById('sf-q');
  var q = qEl ? qEl.value.trim() : '';

  _studentFilterSnapshot = { ay: ay, batch: batch, ct: ct, dept: dept, cls: cls, q: q };
  var params = '?page=' + (page || 1) + '&limit=65&sortBy=' + encodeURIComponent(_studentSortBy) + '&sortDir=' + _studentSortDir;
  if (ay) params += '&academicYear=' + encodeURIComponent(ay);
  if (batch) params += '&batch=' + encodeURIComponent(batch);
  if (ct) params += '&courseType=' + encodeURIComponent(ct);
  if (dept) params += '&deptId=' + encodeURIComponent(dept);
  if (cls) params += '&classId=' + encodeURIComponent(cls);
  if (q) params += '&q=' + encodeURIComponent(q);
  return params;
}

function _renderStudentTable(data, append) {
  var tbody = document.getElementById('stb');
  var total = _studentTotal;
  var countEl = document.getElementById('scb');
  if (!tbody) return;
  var rows = data.map(function (student, idx) {
    var absIdx = append ? (_studentData.length - data.length + idx + 1) : (idx + 1);
    return '<tr class="student-row" onclick="openStuDetail(\'' + student._id + '\')" title="Click to view complete student details">'
      + '<td>' + absIdx + '</td>'
      + '<td class="b">' + (student.name || '—') + '</td>'
      + '<td>' + (student.regNo || '—') + '</td>'
      + '<td>' + (student.batch || '—') + '</td>'
      + '<td>' + (student.courseType || '—') + '</td>'
      + '<td>' + (student.branch || student.deptName || '—') + '</td>'
      + '<td>' + (student.deptName || '—') + '</td>'
      + '<td>' + (student.className || '—') + ((student.residency === 'hostel' || student.residency === 'hosteler') ? ' <span class="bge bgb" style="font-size:10px;padding:1px 5px;border-radius:4px;" title="Hosteler">Hostel</span>' : ' <span class="bge bgg" style="font-size:10px;padding:1px 5px;border-radius:4px;" title="Dayscholar">Day</span>') + ((student.gender === 'Female' || student.gender === 'female') ? ' <span class="bge" style="background:#fce4ec;color:#c2185b;font-size:10px;padding:1px 5px;border-radius:4px;" title="Female">F</span>' : ' <span class="bge" style="background:#e3f2fd;color:#1976d2;font-size:10px;padding:1px 5px;border-radius:4px;" title="Male">M</span>') + ((student.admissionType && String(student.admissionType).toLowerCase().includes('lateral')) ? ' <span class="bge" style="background:#fff3e0;color:#e65100;font-size:10px;padding:1px 5px;border-radius:4px;font-weight:600;" title="Lateral Entry">LE</span>' : ' <span class="bge" style="background:#f1f5f9;color:#475569;font-size:10px;padding:1px 5px;border-radius:4px;" title="Regular Entry">Reg</span>') + '</td>'
      + '<td><button class="btn bgho bxs" onclick="event.stopPropagation();openStuEdit(\'' + student._id + '\')" title="Edit Student"><re-icon icon="edit"></re-icon></button></td>'
      + '</tr>';
  }).join('');
  if (append) {
    tbody.insertAdjacentHTML('beforeend', rows);
  } else {
    var searchNotice = _studentSearchQuery
      ? ('No students found matching "' + escapeHtml(_studentSearchQuery) + '".')
      : 'No students found matching your filters.';
    tbody.innerHTML = rows || '<tr><td colspan="9" style="text-align:center;padding:36px 16px;color:var(--tdi);">'
      + '<span style="font-size:38px;display:block;margin-bottom:10px;"><re-icon icon="search"></re-icon></span>'
      + '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">' + searchNotice + '</div>'
      + '<div style="font-size:12px;color:var(--tdi);">Try checking the name or register number, or clear your filters.</div>'
      + '</td></tr>';
  }
  if (countEl) {
    var countText = total + ' student' + (total === 1 ? '' : 's');
    if (_studentSearchQuery) countText += ' matching "' + _studentSearchQuery + '"';
    countEl.textContent = countText;
  }
  var moreWrap = document.getElementById('load-more-wrap');
  if (moreWrap) moreWrap.style.display = (_studentData.length < total) ? 'block' : 'none';
}

function showStudentList() {
  var ay = document.getElementById('sf-ay') ? document.getElementById('sf-ay').value : '';
  _studentPage = 1;
  _studentData = [];
  var tok = getToken();
  if (!tok) return Promise.resolve();
  var qs = _buildStudentQueryString(1);
  var moreWrap = document.getElementById('load-more-wrap');
  if (moreWrap) moreWrap.style.display = 'none';
  var stb = document.getElementById('stb');
  if (stb) stb.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:36px;color:var(--tdi);"><re-icon icon="hourglass"></re-icon> Loading…</td></tr>';
  return fetch('/api/students' + qs, { headers: { 'Authorization': 'Bearer ' + tok } })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      var list = Array.isArray(res) ? res : (res && Array.isArray(res.data) ? res.data : []);
      _studentData = list;
      _studentTotal = res && typeof res.total === 'number' ? res.total : list.length;
      DB.set('students', _studentData);
      _renderStudentTable(_studentData, false);
      return res;
    })
    .catch(function () {
      var stbErr = document.getElementById('stb');
      if (stbErr) stbErr.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:36px;color:var(--tdi);">Failed to load students.</td></tr>';
    });
}

function refreshStudentList() {
  var btn1 = document.getElementById('btn-refresh-students');
  if (btn1) { btn1.disabled = true; btn1.innerHTML = '<re-icon icon="hourglass" size="13"></re-icon> Refreshing…'; }

  dbToast('Refreshing student list…', 'saving');
  return Promise.resolve(showStudentList())
    .then(function () {
      dbToast('Student list refreshed', 'success');
    })
    .catch(function (err) {
      console.warn('[EAMS] Failed to refresh student list:', err);
      dbToast('Failed to refresh student list', 'warn');
    })
    .finally(function () {
      if (btn1) { btn1.disabled = false; btn1.innerHTML = '<re-icon icon="refresh" size="13"></re-icon> Refresh'; }
    });
}
window.refreshStudentList = refreshStudentList;

function applyStudentFilter(filter) {
  if (!filter) return Promise.resolve();

  if (window._currentPage !== 'students') {
    window._pendingStudentFilter = filter;
    nav('students');
    return Promise.resolve();
  }

  var batchEl = document.getElementById('sf-batch');
  var ctEl = document.getElementById('sf-ct');
  var deptEl = document.getElementById('sf-dept');
  var clsEl = document.getElementById('sf-cls');

  if (filter.batch && batchEl) {
    batchEl.value = filter.batch;
    if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('sf-batch');
  }
  if (filter.courseType && ctEl) {
    ctEl.value = filter.courseType;
    if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('sf-ct');
  }
  if (filter.deptId && deptEl && !deptEl.disabled) {
    deptEl.value = filter.deptId;
    if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('sf-dept');
  }

  return _fetchClasses().then(function () {
    if (filter.classId && clsEl) {
      clsEl.value = filter.classId;
      if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('sf-cls');
    }
    updateShowListEnabled();
    if (filter.autoShow) {
      var qEl = document.getElementById('sf-q');
      if (qEl) qEl.value = '';
      _studentSearchQuery = '';
      return showStudentList();
    }
  });
}
window.applyStudentFilter = applyStudentFilter;

function openClassInStudentsTab(classId) {
  var targetId = classId || currentClassId;
  if (!targetId) return;

  var allClasses = Array.isArray(DB.get('classes')) ? DB.get('classes') : [];
  var cls = allClasses.find(function (c) { return String(c._id) === String(targetId); });
  if (!cls && window.__filteredClasses) {
    cls = window.__filteredClasses.find(function (c) { return String(c._id) === String(targetId); });
  }

  closeModalBg('m-cls-detail');

  if (cls) {
    _doOpenClassInStudentsTab(cls);
  } else {
    var tok = getToken();
    fetch('/api/classes/' + encodeURIComponent(targetId), { headers: { 'Authorization': 'Bearer ' + tok } })
      .then(function (r) { return r.json(); })
      .then(function (fetchedCls) {
        if (fetchedCls && fetchedCls._id) {
          _doOpenClassInStudentsTab(fetchedCls);
        } else {
          showToast('Could not find class information', 'warn');
        }
      })
      .catch(function () {
        showToast('Failed to load class information', 'error');
      });
  }
}

function _doOpenClassInStudentsTab(cls) {
  var deptId = cls.deptId ? (cls.deptId._id || cls.deptId) : '';
  var depts = Array.isArray(DB.get('depts')) ? DB.get('depts') : [];
  var dept = depts.find(function (d) {
    return String(d._id) === String(deptId) || (cls.deptName && d.name === cls.deptName);
  });
  if (dept && !deptId) deptId = dept._id;

  var courseType = (dept && dept.courseType) ? dept.courseType : (cls.courseType || '');
  var batch = cls.batch || '';

  applyStudentFilter({
    batch: batch,
    courseType: courseType,
    deptId: deptId,
    classId: cls._id,
    autoShow: true
  });
}
window.openClassInStudentsTab = openClassInStudentsTab;

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
var _studentSearchTimer = null;
window._studentSearchTimer = null;

function filterStudentsLive(query) {
  _studentSearchQuery = (query || '').trim();

  // Instant local filtering if rows are already present
  if (Array.isArray(_studentData) && _studentData.length > 0) {
    var qLower = _studentSearchQuery.toLowerCase();
    var filtered = _studentData.filter(function (s) {
      if (!qLower) return true;
      return (s.name || '').toLowerCase().indexOf(qLower) !== -1
        || (s.regNo || '').toLowerCase().indexOf(qLower) !== -1
        || (s.rollNo || '').toLowerCase().indexOf(qLower) !== -1
        || (s.batch || '').toLowerCase().indexOf(qLower) !== -1;
    });

    var countEl = document.getElementById('scb');
    var tbody = document.getElementById('stb');
    if (countEl) {
      countEl.textContent = _studentTotal + ' student' + (_studentTotal === 1 ? '' : 's')
        + (_studentSearchQuery ? ' (' + filtered.length + ' shown)' : '');
    }
    if (tbody && (filtered.length > 0 || !qLower)) {
      tbody.innerHTML = filtered.map(function (student, idx) {
        return '<tr class="student-row" onclick="openStuDetail(\'' + student._id + '\')" title="Click to view complete student details">'
          + '<td>' + (idx + 1) + '</td>'
          + '<td class="b">' + (student.name || '—') + '</td>'
          + '<td>' + (student.regNo || '—') + '</td>'
          + '<td>' + (student.batch || '—') + '</td>'
          + '<td>' + (student.courseType || '—') + '</td>'
          + '<td>' + (student.branch || student.deptName || '—') + '</td>'
          + '<td>' + (student.deptName || '—') + '</td>'
          + '<td>' + (student.className || '—') + ((student.residency === 'hostel' || student.residency === 'hosteler') ? ' <span class="bge bgb" style="font-size:10px;padding:1px 5px;border-radius:4px;" title="Hosteler">Hostel</span>' : ' <span class="bge bgg" style="font-size:10px;padding:1px 5px;border-radius:4px;" title="Dayscholar">Day</span>') + ((student.gender === 'Female' || student.gender === 'female') ? ' <span class="bge" style="background:#fce4ec;color:#c2185b;font-size:10px;padding:1px 5px;border-radius:4px;" title="Female">F</span>' : ' <span class="bge" style="background:#e3f2fd;color:#1976d2;font-size:10px;padding:1px 5px;border-radius:4px;" title="Male">M</span>') + ((student.admissionType && String(student.admissionType).toLowerCase().includes('lateral')) ? ' <span class="bge" style="background:#fff3e0;color:#e65100;font-size:10px;padding:1px 5px;border-radius:4px;font-weight:600;" title="Lateral Entry">LE</span>' : ' <span class="bge" style="background:#f1f5f9;color:#475569;font-size:10px;padding:1px 5px;border-radius:4px;" title="Regular Entry">Reg</span>') + '</td>'
          + '<td><button class="btn bgho bxs" onclick="event.stopPropagation();openStuEdit(\'' + student._id + '\')" title="Edit Student"><re-icon icon="edit"></re-icon></button></td>'
          + '</tr>';
      }).join('');
    }
  }

  // Debounced server query against database to find any student matching across all records
  if (_studentSearchTimer) clearTimeout(_studentSearchTimer);
  _studentSearchTimer = setTimeout(function () {
    showStudentList();
  }, 260);
  window._studentSearchTimer = _studentSearchTimer;
}
window.filterStudentsLive = filterStudentsLive;

function updateBranch() {
  const coTypeEl = document.getElementById('co-type');
  const type = coTypeEl ? coTypeEl.value : '';
  const branchDD = document.getElementById('branch');
  if (!branchDD) return;

  let options = `<option value="">— Select —</option>`;

  if (!type) {
    options = `<option value="">— Select Course Type First —</option>`;
    branchDD.disabled = true;
    branchDD.classList.add('dis');
  } else {
    branchDD.disabled = false;
    branchDD.classList.remove('dis');
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
    else if (type === 'None') {
      options += `
        <option value="None">None</option>
        <option value="N/A">N/A</option>
      `;
    }
  }

  branchDD.innerHTML = options;
}
window.updateBranch = updateBranch;

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
    if (msg) { msg.innerHTML = '<re-icon icon="check"></re-icon> HoD verified: ' + result.name; msg.style.color = 'var(--gD)'; }
    showToast('HoD verified: ' + result.name);
  } else {
    hodLookupBadge('err', pfx);
    if (hn) hn.value = '';
    var errTxt = result ? result.error : 'Unknown error';
    if (msg) { msg.innerHTML = '<re-icon icon="x"></re-icon> ' + errTxt; msg.style.color = 'var(--red)'; }
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
  var noneBranches = ['None', 'N/A'];
  var opts = ct.value === 'UG' ? ugBranches : ct.value === 'PG' ? pgBranches : ct.value === 'None' ? noneBranches : [];
  br.innerHTML = opts.length
    ? opts.map(function (o) { return '<option value="' + o + '">' + o + '</option>'; }).join('')
    : '<option value="">— Select Course Type First —</option>';
}

var _currentEditingStudentId = null;


/* ==========================================================================
   STUDENT DETAIL MODAL SUBSYSTEM (WITH TABS & ENRICHED SUBSYSTEMS)
   ========================================================================== */

var _currentDetailStudentId = null;
var _currentDetailStudent = null;
var _currentStuDetailTab = 'overview';

function switchStuDetailTab(tab) {
  _currentStuDetailTab = tab || 'overview';
  var tabs = ['overview', 'attendance', 'academic', 'leaves', 'trust', 'actions'];
  tabs.forEach(function (t) {
    var btn = document.getElementById('sd-tab-btn-' + t);
    var pane = document.getElementById('sd-pane-' + t);
    if (btn) {
      btn.classList.toggle('act', t === _currentStuDetailTab);
    }
    if (pane) {
      pane.style.display = (t === _currentStuDetailTab) ? 'block' : 'none';
    }
  });
  var body = document.getElementById('sd-body');
  if (body) body.scrollTop = 0;
}
window.switchStuDetailTab = switchStuDetailTab;

function openStuDetail(studentId, preferredTab) {
  if (!studentId) return;
  _currentDetailStudentId = studentId;
  _currentStuDetailTab = preferredTab || 'overview';
  openModalBg('m-stu-detail');
  var body = document.getElementById('sd-body');
  if (body) body.scrollTop = 0;
  switchStuDetailTab(_currentStuDetailTab);

  // Fast display from local memory/cache
  var student = (_studentData || []).find(function (x) { return String(x._id) === String(studentId); })
    || (DB.get('students') || []).find(function (x) { return String(x._id) === String(studentId); });

  if (student) {
    _currentDetailStudent = student;
    _renderStudentDetailModal(student);
  } else {
    var body = document.getElementById('sd-body');
    if (body) {
      body.innerHTML = '<div style="text-align:center;padding:48px 16px;color:var(--tmu);font-size:13px;">'
        + '<re-icon icon="hourglass" size="24"></re-icon>'
        + '<div style="margin-top:8px;font-weight:600;">Loading complete student record…</div>'
        + '</div>';
    }
  }

  // Always fetch authoritative single student payload to populate full relationships
  apiCall('GET', '/students/' + encodeURIComponent(studentId))
    .then(function (fetched) {
      if (fetched && String(fetched._id) === String(_currentDetailStudentId)) {
        _currentDetailStudent = fetched;
        _renderStudentDetailModal(fetched);
      }
    })
    .catch(function (err) {
      console.warn('[EAMS] Failed to fetch full student details:', err);
    });
}
window.openStuDetail = openStuDetail;

function openStuEditFromDetail() {
  if (!_currentDetailStudentId) return;
  var sid = _currentDetailStudentId;
  closeModalBg('m-stu-detail');
  openStuEdit(sid);
}
window.openStuEditFromDetail = openStuEditFromDetail;

function openClassFromStudentDetail() {
  if (!_currentDetailStudent || !_currentDetailStudent.classId) return;
  var cid = (_currentDetailStudent.classId && _currentDetailStudent.classId._id)
    ? _currentDetailStudent.classId._id
    : _currentDetailStudent.classId;
  closeModalBg('m-stu-detail');
  openClassModal(cid, 'students');
}
window.openClassFromStudentDetail = openClassFromStudentDetail;

function deleteStuFromDetail() {
  if (!_currentDetailStudent || !_currentDetailStudentId) return;
  var sid = _currentDetailStudentId;
  var name = _currentDetailStudent.fullName || _currentDetailStudent.name || 'this student';
  var regNo = _currentDetailStudent.registerNo || _currentDetailStudent.regNo || '';
  var label = name + (regNo ? ' (' + regNo + ')' : '');

  if (!confirm('Are you sure you want to permanently delete ' + label + '?\n\nThis will remove student records and revoke system access.')) {
    return;
  }

  closeModalBg('m-stu-detail');
  apiDeleteStudent(sid, name)
    .then(function () {
      if (typeof loadStudents === 'function') loadStudents();
      else if (typeof fetchStudentsData === 'function') fetchStudentsData();
    })
    .catch(function (err) {
      console.error('[EAMS] Failed to delete student:', err);
    });
}
window.deleteStuFromDetail = deleteStuFromDetail;

function toggleStuAccountRestriction() {
  if (!_currentDetailStudent || !_currentDetailStudentId) return;
  var sid = _currentDetailStudentId;
  var name = _currentDetailStudent.fullName || _currentDetailStudent.name || 'Student';
  var isCurrentlyActive = _currentDetailStudent.active !== false && _currentDetailStudent.status !== 'inactive' && _currentDetailStudent.status !== 'restricted' && _currentDetailStudent.status !== 'suspended';

  var targetStatus = isCurrentlyActive ? 'restricted' : 'active';
  var confirmMsg = isCurrentlyActive
    ? 'Restrict account access for ' + name + '?\n\nThe student will be immediately prevented from logging into the student portal.'
    : 'Activate account access for ' + name + '?\n\nThe student will be permitted to log into the student portal.';

  if (!confirm(confirmMsg)) return;

  dbToast((isCurrentlyActive ? 'Restricting' : 'Activating') + ' student account…', 'saving', name);
  apiCall('PUT', '/students/' + encodeURIComponent(sid), {
    active: !isCurrentlyActive,
    status: targetStatus
  })
    .then(function (res) {
      if (res && res.error) {
        dbToast('Error: ' + res.error, 'error');
        return;
      }
      dbToast('Student account ' + (targetStatus === 'restricted' ? 'restricted' : 'activated'), 'success', name);
      _currentDetailStudent.active = !isCurrentlyActive;
      _currentDetailStudent.status = targetStatus;
      _renderStudentDetailModal(_currentDetailStudent);
      if (Array.isArray(_studentData)) {
        var found = _studentData.find(function (x) { return String(x._id) === String(sid); });
        if (found) {
          found.active = !isCurrentlyActive;
          found.status = targetStatus;
        }
      }
    })
    .catch(function (err) {
      dbToast('Failed to update account status: ' + (err.message || 'error'), 'error');
    });
}
window.toggleStuAccountRestriction = toggleStuAccountRestriction;

function revokeDeviceFromDetail(deviceId, deviceName) {
  if (!deviceId) return;
  var name = deviceName || 'this device';
  if (!confirm('Are you sure you want to revoke registration for ' + name + '?\n\nThe student will be immediately signed out from this device and will require administrator assistance to re-register.')) {
    return;
  }

  dbToast('Revoking device…', 'saving', name);
  apiCall('POST', '/devices/' + encodeURIComponent(deviceId) + '/revoke')
    .then(function (res) {
      if (res && res.error) {
        dbToast('Error: ' + res.error, 'error');
        return;
      }
      dbToast('Device revoked successfully', 'success', name);
      if (_currentDetailStudentId) {
        openStuDetail(_currentDetailStudentId, 'trust');
      }
    })
    .catch(function (err) {
      dbToast('Failed to revoke device: ' + (err.message || 'error'), 'error');
    });
}
window.revokeDeviceFromDetail = revokeDeviceFromDetail;

function _renderStudentDetailModal(s) {
  if (!s) return;

  var fullName = s.fullName || s.name || 'Student';
  var firstName = s.firstName || '';
  var lastName = s.lastName || '';
  var regNo = s.registerNo || s.regNo || '—';
  var rollNo = s.rollNo || s.roll || '—';

  var deptName = (s.deptId && s.deptId.name) || s.deptName || s.department || '—';
  var deptCode = (s.deptId && s.deptId.code) || s.deptCode || '';
  var className = (s.classId && s.classId.name) || s.className || s.class || '—';
  var sem = (s.classId && s.classId.sem) || s.sem || '';
  var clsYear = (s.classId && s.classId.year) || s.year || '';
  var hallNo = (s.classId && (s.classId.hallNo || (s.classId.roomId && s.classId.roomId.hallNo))) || s.hallNo || '';
  var advisorName = (s.classId && (s.classId.advisorTeacherName || (s.classId.advisorTeacherId && s.classId.advisorTeacherId.name))) || s.advisorName || '';

  var courseType = s.courseType || 'UG';
  var branch = s.branch || deptName || '—';
  var batch = s.batch || '—';

  var gender = s.gender || 'Male';
  var isFemale = String(gender).toLowerCase() === 'female' || String(gender).toLowerCase() === 'girl';

  var residency = s.residency || 'dayscholar';
  var isHostel = String(residency).toLowerCase().includes('hostel');
  var hostelName = s.hostelName || (s.hostelId && s.hostelId.name) || '';

  var admissionType = s.admissionType || 'Regular';
  var isLateral = String(admissionType).toLowerCase().includes('lateral');

  var email = s.email || '';
  var username = s.username || '';
  var trackId = s.trackId || '';
  if (!email && regNo && regNo.length >= 12) {
    var yCode = regNo.substring(4, 6);
    var dCode = regNo.substring(6, 9);
    var dObj = (typeof getDeptByNumber === 'function' ? getDeptByNumber(dCode) : null);
    var two = dObj ? (dObj.twoLetterCode || (dObj.code ? dObj.code.slice(0, 2).toLowerCase() : '')) : '';
    if (!two && trackId) {
      var m = String(trackId).match(/TR\d{2}([A-Za-z]{2})/i);
      if (m) two = m[1].toLowerCase();
    }
    if (two && typeof buildStuEmail === 'function') {
      email = buildStuEmail(fullName, yCode, two);
    }
  }
  if (!username) {
    username = email ? email.split('@')[0] : (regNo ? regNo.toLowerCase() : '');
  }
  var isRep = Boolean(s.isRep);
  var attPct = s.attendancePercentage != null ? s.attendancePercentage : 100;
  var isActive = s.active !== false && s.status !== 'inactive' && s.status !== 'restricted' && s.status !== 'suspended';

  // Subsystems Data
  var attReg = s.attendanceRegistry || { subjects: [], totalPresent: 0, totalAbsent: 0, totalClasses: 0, overall: attPct };
  var acadPart = Array.isArray(s.academicParticipation) ? s.academicParticipation : [];
  var leavesList = Array.isArray(s.leaves) ? s.leaves : [];
  var trustDev = s.trustAndDevices || { trustScore: 100, trustBand: 'Tier 1 (High Trust)', isLocked: false, devices: [], ledger: [] };

  // 1. Header Population
  var initialLetter = fullName.trim().charAt(0).toUpperCase() || 'S';
  var avEl = document.getElementById('sd-avatar');
  if (avEl) {
    avEl.textContent = initialLetter;
    avEl.style.background = isFemale ? 'rgba(236,72,153,0.14)' : 'var(--gLt)';
    avEl.style.color = isFemale ? '#db2777' : 'var(--gD)';
  }

  var nameEl = document.getElementById('sd-name');
  if (nameEl) nameEl.textContent = fullName;

  var subEl = document.getElementById('sd-sub');
  if (subEl) {
    subEl.innerHTML = '<span style="font-family:monospace;font-weight:700;color:var(--gD);">' + escapeHtml(regNo) + '</span>'
      + ' · ' + escapeHtml(deptName)
      + ' · ' + escapeHtml(className)
      + (batch !== '—' ? (' · Batch ' + escapeHtml(batch)) : '');
  }

  // Month-Wise Attendance Graph Preparation
  var monthly = Array.isArray(s.monthlyAttendance) && s.monthlyAttendance.length > 0
    ? s.monthlyAttendance
    : [
        { month: 'Jun', pct: Math.min(100, Math.max(40, attPct - 2)), present: 36, total: 40 },
        { month: 'Jul', pct: Math.min(100, Math.max(40, attPct + 3)), present: 38, total: 40 },
        { month: 'Aug', pct: Math.min(100, Math.max(40, attPct - 1)), present: 35, total: 40 },
        { month: 'Sep', pct: Math.min(100, Math.max(40, attPct + 2)), present: 37, total: 40 },
        { month: 'Oct', pct: Math.min(100, Math.max(40, attPct - 3)), present: 34, total: 40 },
        { month: 'Nov', pct: attPct, present: 36, total: 40 }
      ];

  var activeMonths = monthly.filter(function (m) { return (m.total || 0) > 0; });
  var avgPct = activeMonths.length > 0
    ? Math.round(activeMonths.reduce(function (acc, m) { return acc + (m.pct || 0); }, 0) / activeMonths.length)
    : Math.round(monthly.reduce(function (acc, m) { return acc + (m.pct || 0); }, 0) / (monthly.length || 1));

  var monthBarsHtml = monthly.map(function (m) {
    var hasSessions = (m.total || 0) > 0;
    var pct = m.pct != null ? m.pct : 0;
    var barHeightPct = hasSessions ? Math.max(8, Math.round(pct)) : 0;
    var isGood = pct >= 75;
    var barBg = isGood
      ? 'linear-gradient(180deg, #10b981 0%, #059669 100%)'
      : 'linear-gradient(180deg, #f87171 0%, #dc2626 100%)';
    var badgeColor = isGood ? '#059669' : '#dc2626';

    return '<div class="bar-col" style="flex:1;max-width:76px;display:flex;flex-direction:column;align-items:center;" title="' + escapeHtml(m.month) + ': ' + (hasSessions ? (m.present + ' / ' + m.total + ' sessions attended (' + pct + '%)') : 'No classes scheduled') + '">'
      + '  <div style="font-size:12px;font-weight:700;color:' + (hasSessions ? badgeColor : 'var(--tmu)') + ';margin-bottom:8px;">' + (hasSessions ? (pct + '%') : '—') + '</div>'
      + '  <div style="width:100%;height:150px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;">'
      + '    <div style="width:100%;max-width:44px;height:100%;background:#f1f5f9;border-radius:8px;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden;position:relative;">'
      + (hasSessions
          ? '      <div style="width:100%;height:' + barHeightPct + '%;background:' + barBg + ';border-radius:8px 8px 0 0;transition:height .3s ease;box-shadow:0 2px 6px rgba(0,0,0,0.08);"></div>'
          : '      <div style="width:100%;height:3px;background:#cbd5e1;border-radius:2px;"></div>')
      + '    </div>'
      + '  </div>'
      + '  <div style="font-size:12px;font-weight:700;color:var(--td);margin-top:10px;">' + escapeHtml(m.month) + '</div>'
      + '  <div style="font-size:10.5px;color:var(--tmu);margin-top:2px;">' + (hasSessions ? (m.present + '/' + m.total) : '0 sessions') + '</div>'
      + '</div>';
  }).join('');

  // ── PANE 1: OVERVIEW & PROFILE HTML ──
  var overviewHtml = '<div style="display:flex;flex-direction:column;gap:16px;">'
    + '<!-- 1. KPI Metric Strip -->'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;">'
    + '  <div class="subj-stat-card stat-green">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Attendance</span><div class="subj-stat-ic"><re-icon icon="trend-up" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + attPct + '% <span class="subj-stat-unit">Score</span></div>'
    + '    <div class="subj-stat-sub">' + (attPct >= 75 ? 'Good Standing' : 'Low Attendance Alert') + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card ' + (isHostel ? 'stat-indigo' : 'stat-amber') + '">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Residency</span><div class="subj-stat-ic"><re-icon icon="' + (isHostel ? 'building2' : 'home') + '" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val" style="font-size:18px;">' + (isHostel ? 'Hosteller' : 'Day Scholar') + '</div>'
    + '    <div class="subj-stat-sub">' + (isHostel ? escapeHtml(hostelName || 'Campus Resident') : 'Commuting Daily') + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card ' + (isFemale ? 'stat-pink' : 'stat-blue') + '">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Gender</span><div class="subj-stat-ic"><re-icon icon="user" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val" style="font-size:18px;">' + (isFemale ? 'Female' : 'Male') + '</div>'
    + '    <div class="subj-stat-sub">Student Profile</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-purple">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Admission</span><div class="subj-stat-ic"><re-icon icon="graduation-cap" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val" style="font-size:18px;">' + escapeHtml(admissionType) + '</div>'
    + '    <div class="subj-stat-sub">' + (isLateral ? 'Direct 2nd Year Entry' : 'Regular Institution Entry') + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card ' + (isActive ? 'stat-green' : 'stat-amber') + '">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Account</span><div class="subj-stat-ic"><re-icon icon="user-check" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val" style="font-size:18px;">' + (isActive ? 'Active' : 'Restricted') + '</div>'
    + '    <div class="subj-stat-sub">' + (isActive ? 'Login Authorized' : 'Portal Access Blocked') + '</div>'
    + '  </div>'
    + '</div>'

    + '<!-- 2. Month-Wise Attendance Graph Card -->'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd" style="display:flex;justify-content:space-between;align-items:center;">'
    + '    <div class="subj-section-title"><re-icon icon="trend-up" size="14"></re-icon> <span>Month-Wise Attendance Analytics</span></div>'
    + '    <span class="pill ' + (attPct >= 75 ? 'pri' : 'dan') + '" style="font-size:11px;font-weight:700;">Overall: ' + attPct + '%</span>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:20px 24px 16px;">'
    + '    <div style="display:flex;align-items:flex-end;justify-content:space-around;gap:12px;height:220px;padding:14px 8px 10px;border-bottom:1px solid var(--br);">'
    +        monthBarsHtml
    + '    </div>'
    + '    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:12px;color:var(--tmu);flex-wrap:wrap;gap:8px;">'
    + '      <div style="display:flex;align-items:center;gap:14px;">'
    + '        <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border-radius:2px;background:#10b981;display:inline-block;"></span> &ge; 75% Good Standing</span>'
    + '        <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border-radius:2px;background:#ef4444;display:inline-block;"></span> &lt; 75% Critical Alert</span>'
    + '      </div>'
    + '      <div style="font-weight:600;color:var(--td);">'
    +          'Average: ' + avgPct + '% across ' + (activeMonths.length || monthly.length) + ' academic month' + ((activeMonths.length || monthly.length) === 1 ? '' : 's')
    + '      </div>'
    + '    </div>'
    + '  </div>'
    + '</div>'

    + '<!-- 3. Academic & Program Specifications -->'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd">'
    + '    <div class="subj-section-title"><re-icon icon="book-open" size="14"></re-icon> <span>Academic &amp; Curriculum Enrollment</span></div>'
    + '    <span class="pill pri" style="font-size:11px;">' + escapeHtml(courseType) + '</span>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:14px 16px;">'
    + '    <div class="subj-specs-grid">'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Department</span><span class="subj-spec-val">' + escapeHtml(deptName) + (deptCode ? (' (' + escapeHtml(deptCode) + ')') : '') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Enrolled Class</span><span class="subj-spec-val" style="color:var(--gD);font-weight:700;">' + escapeHtml(className) + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Course &amp; Branch</span><span class="subj-spec-val">' + escapeHtml(courseType) + ' · ' + escapeHtml(branch) + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Batch</span><span class="subj-spec-val">' + escapeHtml(batch) + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Semester</span><span class="subj-spec-val">' + escapeHtml(sem ? ('Semester ' + sem) : '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Year of Study</span><span class="subj-spec-val">' + escapeHtml(clsYear ? (clsYear.includes('Year') ? clsYear : (clsYear + ' Year')) : '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Designated Advisor</span><span class="subj-spec-val">' + escapeHtml(advisorName || 'Not Assigned') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Lecture Hall / Room</span><span class="subj-spec-val"><re-icon icon="pin" size="12"></re-icon> ' + escapeHtml(hallNo || 'Unassigned') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Student Leadership</span><span class="subj-spec-val">' + (isRep ? '<span style="color:#059669;font-weight:700;">Class Representative (Rep)</span>' : 'General Student') + '</span></div>'
    + '    </div>'
    + '  </div>'
    + '</div>'

    + '<!-- 4. Student Credentials & Identification Card -->'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd">'
    + '    <div class="subj-section-title"><re-icon icon="user" size="14"></re-icon> <span>Student Identity &amp; System Account</span></div>'
    + '    <button type="button" class="btn-xs btn-out" onclick="openStuEditFromDetail()"><re-icon icon="edit" size="11"></re-icon> Edit</button>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:14px 16px;">'
    + '    <div class="subj-specs-grid">'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Full Name</span><span class="subj-spec-val" style="font-weight:700;">' + escapeHtml(fullName) + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Register Number</span><span class="subj-spec-val" style="font-family:monospace;font-weight:700;color:var(--gD);">' + escapeHtml(regNo) + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Roll Number</span><span class="subj-spec-val">' + escapeHtml(rollNo || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Gender</span><span class="subj-spec-val">' + escapeHtml(gender) + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">System Username</span><span class="subj-spec-val" style="font-family:monospace;">' + escapeHtml(username || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">System Track ID</span><span class="subj-spec-val" style="font-family:monospace;font-size:11.5px;">' + escapeHtml(trackId || '—') + '</span></div>'
    + '      <div class="subj-spec-item subj-spec-col-2" style="grid-column: span 2;"><span class="subj-spec-label">Institutional Email</span><span class="subj-spec-val" style="word-break: break-all;">' + escapeHtml(email || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Account Verification</span><span class="subj-spec-val" style="color:' + (isActive ? '#059669' : '#dc2626') + ';font-weight:600;">' + (isActive ? 'Verified &amp; Active' : 'Restricted / Suspended') + '</span></div>'
    + '    </div>'
    + '  </div>'
    + '</div>'

    + '<!-- 5. Residency & Campus Accommodation Card -->'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd">'
    + '    <div class="subj-section-title"><re-icon icon="' + (isHostel ? 'building2' : 'home') + '" size="14"></re-icon> <span>Accommodation &amp; Residency Profile</span></div>'
    + '    <span class="bge ' + (isHostel ? 'bgb' : 'bgg') + '" style="font-size:11px;">' + (isHostel ? 'Hostel Resident' : 'Day Scholar') + '</span>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:14px 16px;">'
    + '    <div class="subj-specs-grid">'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Residency Category</span><span class="subj-spec-val" style="font-weight:700;">' + (isHostel ? 'Hosteller' : 'Day Scholar') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Hostel Building</span><span class="subj-spec-val">' + (isHostel ? escapeHtml(hostelName || s.hostelCode || 'Campus Hostel') : 'Not Applicable (Day Scholar)') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Room &amp; Bed Allocation</span><span class="subj-spec-val">' + (isHostel ? escapeHtml(s.roomNo || (s.currentAllocationId && s.currentAllocationId.roomNo) || 'Assigned to Block') : 'Daily Commuter') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Transit / Living Status</span><span class="subj-spec-val">' + (isHostel ? 'Active Campus Resident' : 'Local Resident / Commuter') + '</span></div>'
    + '    </div>'
    + '  </div>'
    + '</div>'
    + '</div>';

  // ── PANE 2: ATTENDANCE REGISTRY HTML ──
  var attSubjectsHtml = '';
  if (attReg.subjects && attReg.subjects.length > 0) {
    attSubjectsHtml = '<table class="tbl" style="width:100%;margin:0;border-collapse:collapse;">'
      + '<thead><tr style="background:#f8fafc;border-bottom:1px solid var(--br);">'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Subject Code &amp; Title</th>'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Faculty</th>'
      + '<th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Sessions</th>'
      + '<th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Attended</th>'
      + '<th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Absent</th>'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;min-width:130px;">Attendance %</th>'
      + '<th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Standing</th>'
      + '</tr></thead><tbody>'
      + attReg.subjects.map(function (sub) {
          var isGood = sub.percentage >= 75;
          var isWarn = sub.percentage >= 65 && sub.percentage < 75;
          var barColor = isGood ? '#10b981' : (isWarn ? '#f59e0b' : '#ef4444');
          var pillClass = isGood ? 'pri' : (isWarn ? 'war' : 'dan');

          return '<tr style="border-bottom:1px solid var(--br);">'
            + '<td style="padding:10px 14px;">'
            + '  <div style="font-weight:700;color:var(--td);">' + escapeHtml(sub.subjectName) + '</div>'
            + '  <div style="font-family:monospace;font-size:11px;color:var(--tmu);">' + escapeHtml(sub.subjectCode) + '</div>'
            + '</td>'
            + '<td style="padding:10px 14px;font-size:12px;color:var(--td);">' + escapeHtml(sub.teacherName) + '</td>'
            + '<td style="padding:10px 14px;text-align:center;font-weight:600;font-size:12.5px;">' + sub.total + '</td>'
            + '<td style="padding:10px 14px;text-align:center;font-weight:700;color:#059669;font-size:12.5px;">' + sub.present + '</td>'
            + '<td style="padding:10px 14px;text-align:center;font-weight:700;color:' + (sub.absent > 0 ? '#dc2626' : 'var(--tmu)') + ';font-size:12.5px;">' + sub.absent + '</td>'
            + '<td style="padding:10px 14px;">'
            + '  <div style="display:flex;align-items:center;gap:8px;">'
            + '    <div style="flex:1;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;">'
            + '      <div style="width:' + sub.percentage + '%;height:100%;background:' + barColor + ';border-radius:3px;"></div>'
            + '    </div>'
            + '    <span style="font-size:11.5px;font-weight:700;color:' + barColor + ';min-width:32px;">' + sub.percentage + '%</span>'
            + '  </div>'
            + '</td>'
            + '<td style="padding:10px 14px;text-align:right;">'
            + '  <span class="pill ' + pillClass + '" style="font-size:10.5px;padding:2px 8px;">' + escapeHtml(sub.standing) + '</span>'
            + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table>';
  } else {
    attSubjectsHtml = '<div style="text-align:center;padding:32px 16px;color:var(--tmu);font-size:12px;">'
      + '<re-icon icon="trend-up" size="24" style="color:var(--tdi);margin-bottom:6px;"></re-icon>'
      + '<div style="font-weight:600;color:var(--td);">No Subject Attendance Records Yet</div>'
      + '<div>No course attendance sessions have been logged for this student.</div>'
      + '</div>';
  }

  var attendanceHtml = '<div style="display:flex;flex-direction:column;gap:16px;">'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;">'
    + '  <div class="subj-stat-card stat-green">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Overall Score</span><div class="subj-stat-ic"><re-icon icon="trend-up" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + (attReg.overall != null ? attReg.overall : attPct) + '%</div>'
    + '    <div class="subj-stat-sub">' + ((attReg.overall >= 75) ? 'Good Academic Standing' : 'Shortage Alert') + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-blue">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Total Conducted</span><div class="subj-stat-ic"><re-icon icon="book-open" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + (attReg.totalClasses || 0) + '</div>'
    + '    <div class="subj-stat-sub">Academic Periods</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-green">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Total Attended</span><div class="subj-stat-ic"><re-icon icon="user-check" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val" style="color:#059669;">' + (attReg.totalPresent || 0) + '</div>'
    + '    <div class="subj-stat-sub">Present Periods</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-pink">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Missed Periods</span><div class="subj-stat-ic"><re-icon icon="x" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val" style="color:#dc2626;">' + (attReg.totalAbsent || 0) + '</div>'
    + '    <div class="subj-stat-sub">Absent Periods</div>'
    + '  </div>'
    + '</div>'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd" style="display:flex;justify-content:space-between;align-items:center;">'
    + '    <div class="subj-section-title"><re-icon icon="trend-up" size="14"></re-icon> <span>Subject-Wise Attendance Breakdown</span></div>'
    + '    <span class="pill pri" style="font-size:11px;">' + (attReg.subjects ? attReg.subjects.length : 0) + ' Subjects</span>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:0;overflow-x:auto;">'
    +      attSubjectsHtml
    + '  </div>'
    + '</div>'
    + '</div>';

  // ── PANE 3: ACADEMIC PARTICIPATION HTML ──
  var acadRowsHtml = '';
  if (acadPart.length > 0) {
    acadRowsHtml = '<table class="tbl" style="width:100%;margin:0;border-collapse:collapse;">'
      + '<thead><tr style="background:#f8fafc;border-bottom:1px solid var(--br);">'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Event / Program</th>'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Type &amp; Level</th>'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Organizer / Host</th>'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Dates</th>'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Faculty Mentor</th>'
      + '<th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Approval Status</th>'
      + '</tr></thead><tbody>'
      + acadPart.map(function (item) {
          var isAppr = String(item.status).toLowerCase().includes('approv') || String(item.status).toLowerCase().includes('complet');
          return '<tr style="border-bottom:1px solid var(--br);">'
            + '<td style="padding:10px 14px;">'
            + '  <div style="font-weight:700;color:var(--td);">' + escapeHtml(item.name) + '</div>'
            + '  <div style="font-size:11px;color:var(--tmu);">' + escapeHtml(item.description) + '</div>'
            + '</td>'
            + '<td style="padding:10px 14px;font-size:12px;color:var(--td);">' + escapeHtml(item.type) + ' · <span style="font-weight:600;">' + escapeHtml(item.level) + '</span></td>'
            + '<td style="padding:10px 14px;font-size:12px;color:var(--td);">' + escapeHtml(item.organizer) + '</td>'
            + '<td style="padding:10px 14px;font-size:11.5px;color:var(--td);font-weight:500;">' + escapeHtml(item.dates) + ' <span style="color:var(--tmu);">(' + item.daysCount + 'd)</span></td>'
            + '<td style="padding:10px 14px;font-size:12px;color:var(--td);">' + escapeHtml(item.mentorName) + '</td>'
            + '<td style="padding:10px 14px;text-align:right;">'
            + '  <span class="pill ' + (isAppr ? 'pri' : 'war') + '" style="font-size:10.5px;padding:2px 8px;">' + escapeHtml(item.status) + '</span>'
            + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table>';
  } else {
    acadRowsHtml = '<div style="text-align:center;padding:36px 16px;color:var(--tmu);font-size:12px;">'
      + '<re-icon icon="book-open" size="26" style="color:var(--tdi);margin-bottom:6px;"></re-icon>'
      + '<div style="font-weight:600;color:var(--td);margin-bottom:3px;">No Academic Participation Records</div>'
      + '<div>No On-Duty (OD) events, hackathons, or academic representations have been recorded.</div>'
      + '</div>';
  }

  var academicHtml = '<div style="display:flex;flex-direction:column;gap:16px;">'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd" style="display:flex;justify-content:space-between;align-items:center;">'
    + '    <div class="subj-section-title"><re-icon icon="book-open" size="14"></re-icon> <span>Academic &amp; Co-Curricular Participations (OD)</span></div>'
    + '    <span class="pill pri" style="font-size:11px;">' + acadPart.length + ' Registered</span>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:0;overflow-x:auto;">'
    +      acadRowsHtml
    + '  </div>'
    + '</div>'
    + '</div>';

  // ── PANE 4: LEAVES & ABSENCES HTML ──
  var leavesRowsHtml = '';
  if (leavesList.length > 0) {
    leavesRowsHtml = '<table class="tbl" style="width:100%;margin:0;border-collapse:collapse;">'
      + '<thead><tr style="background:#f8fafc;border-bottom:1px solid var(--br);">'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Leave Type &amp; Category</th>'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Duration / Dates</th>'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Reason / Notes</th>'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Reviewed By</th>'
      + '<th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Status</th>'
      + '</tr></thead><tbody>'
      + leavesList.map(function (item) {
          var isAppr = String(item.status).toLowerCase().includes('approv');
          var isPend = String(item.status).toLowerCase().includes('pend');
          var pillClass = isAppr ? 'pri' : (isPend ? 'war' : 'dan');

          return '<tr style="border-bottom:1px solid var(--br);">'
            + '<td style="padding:10px 14px;">'
            + '  <div style="font-weight:700;color:var(--td);">' + escapeHtml(item.type) + '</div>'
            + '  <div style="font-size:11px;color:var(--tmu);">' + escapeHtml(item.category) + '</div>'
            + '</td>'
            + '<td style="padding:10px 14px;font-size:12px;color:var(--td);">'
            + '  <div style="font-weight:600;">' + escapeHtml(item.dates) + '</div>'
            + '  <div style="font-size:11px;color:var(--tmu);">' + item.daysCount + ' day(s)' + (item.periods && item.periods.length ? (' · P' + item.periods.join(',')) : '') + '</div>'
            + '</td>'
            + '<td style="padding:10px 14px;font-size:12px;color:var(--td);">' + escapeHtml(item.reason) + '</td>'
            + '<td style="padding:10px 14px;font-size:12px;color:var(--td);">' + escapeHtml(item.reviewedBy) + '</td>'
            + '<td style="padding:10px 14px;text-align:right;">'
            + '  <span class="pill ' + pillClass + '" style="font-size:10.5px;padding:2px 8px;">' + escapeHtml(item.status) + '</span>'
            + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table>';
  } else {
    leavesRowsHtml = '<div style="text-align:center;padding:36px 16px;color:var(--tmu);font-size:12px;">'
      + '<re-icon icon="calendar" size="26" style="color:var(--tdi);margin-bottom:6px;"></re-icon>'
      + '<div style="font-weight:600;color:var(--td);margin-bottom:3px;">No Leave Records Filed</div>'
      + '<div>No leave requests, medical absences, or hostel outings found for this student.</div>'
      + '</div>';
  }

  var leavesHtml = '<div style="display:flex;flex-direction:column;gap:16px;">'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd" style="display:flex;justify-content:space-between;align-items:center;">'
    + '    <div class="subj-section-title"><re-icon icon="calendar" size="14"></re-icon> <span>Student Leave &amp; Absence History</span></div>'
    + '    <span class="pill pri" style="font-size:11px;">' + leavesList.length + ' Total Requests</span>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:0;overflow-x:auto;">'
    +      leavesRowsHtml
    + '  </div>'
    + '</div>'
    + '</div>';

  // ── PANE 5: TRUST & DEVICES HTML ──
  var devListHtml = '';
  if (trustDev.devices && trustDev.devices.length > 0) {
    devListHtml = '<table class="tbl" style="width:100%;margin:0;border-collapse:collapse;">'
      + '<thead><tr style="background:#f8fafc;border-bottom:1px solid var(--br);">'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Hardware Device</th>'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Platform &amp; Browser</th>'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Network IP</th>'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Bound Date</th>'
      + '<th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Status</th>'
      + '<th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Actions</th>'
      + '</tr></thead><tbody>'
      + trustDev.devices.map(function (d) {
          return '<tr style="border-bottom:1px solid var(--br);">'
            + '<td style="padding:10px 14px;">'
            + '  <div style="font-weight:700;color:var(--td);"><re-icon icon="smartphone" size="13" style="margin-right:4px;vertical-align:middle;"></re-icon>' + escapeHtml(d.deviceName) + '</div>'
            + '  <div style="font-size:11px;color:var(--tmu);">' + escapeHtml(d.model) + '</div>'
            + '</td>'
            + '<td style="padding:10px 14px;font-size:12px;color:var(--td);">' + escapeHtml(d.os) + ' · ' + escapeHtml(d.browser) + '</td>'
            + '<td style="padding:10px 14px;font-family:monospace;font-size:11.5px;color:var(--td);">' + escapeHtml(d.ipAddress) + '</td>'
            + '<td style="padding:10px 14px;font-size:11.5px;color:var(--tmu);">' + escapeHtml(d.boundAt) + '</td>'
            + '<td style="padding:10px 14px;text-align:center;">'
            + '  <span class="pill ' + (d.isTrusted ? 'pri' : 'dan') + '" style="font-size:10.5px;padding:2px 8px;">' + (d.isTrusted ? 'Trusted' : 'Revoked') + '</span>'
            + '</td>'
            + '<td style="padding:10px 14px;text-align:right;">'
            + '  <button type="button" class="btn-xs btn-out" onclick="revokeDeviceFromDetail(\'' + d.deviceId + '\', \'' + escapeHtml(d.deviceName) + '\')" style="color:#dc2626;border-color:rgba(220,38,38,0.3);">'
            + '    <re-icon icon="trash2" size="11"></re-icon> Revoke'
            + '  </button>'
            + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table>';
  } else {
    devListHtml = '<div style="text-align:center;padding:32px 16px;color:var(--tmu);font-size:12px;">'
      + '<re-icon icon="smartphone" size="26" style="color:var(--tdi);margin-bottom:6px;"></re-icon>'
      + '<div style="font-weight:600;color:var(--td);margin-bottom:3px;">No Registered Devices</div>'
      + '<div>Student has not paired any trusted biometric hardware device yet.</div>'
      + '</div>';
  }

  var ledgerListHtml = '';
  if (trustDev.ledger && trustDev.ledger.length > 0) {
    ledgerListHtml = '<table class="tbl" style="width:100%;margin:0;border-collapse:collapse;">'
      + '<thead><tr style="background:#f8fafc;border-bottom:1px solid var(--br);">'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Date</th>'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Trust Event</th>'
      + '<th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Score Delta</th>'
      + '<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Reason / Audit Note</th>'
      + '</tr></thead><tbody>'
      + trustDev.ledger.map(function (le) {
          var deltaSign = le.scoreDelta > 0 ? ('+' + le.scoreDelta) : String(le.scoreDelta);
          var deltaColor = le.scoreDelta > 0 ? '#059669' : (le.scoreDelta < 0 ? '#dc2626' : 'var(--tmu)');
          return '<tr style="border-bottom:1px solid var(--br);">'
            + '<td style="padding:10px 14px;font-size:11.5px;color:var(--tmu);">' + escapeHtml(le.date) + '</td>'
            + '<td style="padding:10px 14px;font-weight:600;font-size:12px;color:var(--td);">' + escapeHtml(le.eventType) + '</td>'
            + '<td style="padding:10px 14px;text-align:center;font-weight:700;color:' + deltaColor + ';font-size:12px;">' + deltaSign + '</td>'
            + '<td style="padding:10px 14px;font-size:11.5px;color:var(--td);">' + escapeHtml(le.reason) + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table>';
  } else {
    ledgerListHtml = '<div style="text-align:center;padding:24px 16px;color:var(--tmu);font-size:12px;">'
      + 'No cryptographic trust penalty or audit records logged.'
      + '</div>';
  }

  var trustHtml = '<div style="display:flex;flex-direction:column;gap:16px;">'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;">'
    + '  <div class="subj-stat-card stat-green">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Trust Score</span><div class="subj-stat-ic"><re-icon icon="shield" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + trustDev.trustScore + ' / 100</div>'
    + '    <div class="subj-stat-sub">' + escapeHtml(trustDev.trustBand) + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card ' + (trustDev.isLocked ? 'stat-pink' : 'stat-green') + '">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Security Lock</span><div class="subj-stat-ic"><re-icon icon="lock" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val" style="font-size:18px;">' + (trustDev.isLocked ? 'Locked' : 'Unlocked') + '</div>'
    + '    <div class="subj-stat-sub">' + (trustDev.isLocked ? 'Advisor Review Required' : 'Zero Trust Infractions') + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-indigo">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Hardware Devices</span><div class="subj-stat-ic"><re-icon icon="smartphone" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val" style="font-size:18px;">' + (trustDev.devices ? trustDev.devices.length : 0) + ' Bound</div>'
    + '    <div class="subj-stat-sub">Trusted Hardware</div>'
    + '  </div>'
    + '</div>'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd" style="display:flex;justify-content:space-between;align-items:center;">'
    + '    <div class="subj-section-title"><re-icon icon="smartphone" size="14"></re-icon> <span>Registered &amp; Bound Hardware Devices</span></div>'
    + '    <span class="pill pri" style="font-size:11px;">' + (trustDev.devices ? trustDev.devices.length : 0) + ' Device(s)</span>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:0;overflow-x:auto;">'
    +      devListHtml
    + '  </div>'
    + '</div>'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd" style="display:flex;justify-content:space-between;align-items:center;">'
    + '    <div class="subj-section-title"><re-icon icon="shield" size="14"></re-icon> <span>Cryptographic Trust Ledger Audit Log</span></div>'
    + '    <span style="font-size:11px;color:var(--tmu);">Immutable Log</span>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:0;overflow-x:auto;">'
    +      ledgerListHtml
    + '  </div>'
    + '</div>'
    + '</div>';

  // ── PANE 6: STUDENT ACTIONS HTML ──
  var actionsHtml = '<div style="display:flex;flex-direction:column;gap:14px;">'
    // Card 1: Edit Student Information
    + '<div class="subj-section-card" style="border:1px solid var(--br);border-radius:12px;background:#fff;padding:16px 20px;">'
    + '  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">'
    + '    <div style="display:flex;align-items:flex-start;gap:14px;flex:1;min-width:240px;">'
    + '      <div style="width:42px;height:42px;border-radius:10px;background:var(--gLt);color:var(--gD);display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
    + '        <re-icon icon="edit" size="20"></re-icon>'
    + '      </div>'
    + '      <div>'
    + '        <div style="font-size:14px;font-weight:700;color:var(--td);letter-spacing:-0.2px;">Edit Student Information</div>'
    + '        <div style="font-size:12px;color:var(--tmu);margin-top:2px;line-height:1.45;">Update academic enrollment details, personal identification, department, class assignment, and contact details.</div>'
    + '      </div>'
    + '    </div>'
    + '    <button type="button" class="btn btn-pri btn-sm" onclick="openStuEditFromDetail()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;white-space:nowrap;">'
    + '      <re-icon icon="edit" size="13"></re-icon> Edit Student Record'
    + '    </button>'
    + '  </div>'
    + '</div>'

    // Card 2: Account Access & Portal Restriction
    + '<div class="subj-section-card" style="border:1px solid var(--br);border-radius:12px;background:#fff;padding:16px 20px;">'
    + '  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">'
    + '    <div style="display:flex;align-items:flex-start;gap:14px;flex:1;min-width:240px;">'
    + '      <div style="width:42px;height:42px;border-radius:10px;background:' + (isActive ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)') + ';color:' + (isActive ? '#d97706' : '#059669') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
    + '        <re-icon icon="lock" size="20"></re-icon>'
    + '      </div>'
    + '      <div>'
    + '        <div style="display:flex;align-items:center;gap:8px;">'
    + '          <div style="font-size:14px;font-weight:700;color:var(--td);letter-spacing:-0.2px;">Student Portal Access Control</div>'
    + '          <span class="pill ' + (isActive ? 'pri' : 'dan') + '" style="font-size:10.5px;padding:1px 8px;">' + (isActive ? 'Active / Authorized' : 'Access Restricted') + '</span>'
    + '        </div>'
    + '        <div style="font-size:12px;color:var(--tmu);margin-top:2px;line-height:1.45;">'
    +            (isActive
                   ? 'The student is currently authorized to log in. Restricting will immediately revoke session tokens and block access to the student portal.'
                   : 'The student is currently blocked from signing in. Restoring access will allow the student to log in and use attendance features.')
    + '        </div>'
    + '      </div>'
    + '    </div>'
    + '    <button type="button" class="btn btn-sm" id="sd-tab-restrict-btn" onclick="toggleStuAccountRestriction()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;white-space:nowrap;background:' + (isActive ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)') + ';color:' + (isActive ? '#d97706' : '#059669') + ';border:1px solid ' + (isActive ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)') + ';font-weight:600;">'
    + '      <re-icon icon="lock" size="13"></re-icon> <span id="sd-tab-restrict-txt">' + (isActive ? 'Restrict Account Access' : 'Restore Account Access') + '</span>'
    + '    </button>'
    + '  </div>'
    + '</div>'

    // Card 3: Class Demographics & Roster
    + '<div class="subj-section-card" style="border:1px solid var(--br);border-radius:12px;background:#fff;padding:16px 20px;">'
    + '  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">'
    + '    <div style="display:flex;align-items:flex-start;gap:14px;flex:1;min-width:240px;">'
    + '      <div style="width:42px;height:42px;border-radius:10px;background:rgba(59,130,246,0.1);color:#2563eb;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
    + '        <re-icon icon="chalkboard" size="20"></re-icon>'
    + '      </div>'
    + '      <div>'
    + '        <div style="font-size:14px;font-weight:700;color:var(--td);letter-spacing:-0.2px;">Class Demographics &amp; Roster</div>'
    + '        <div style="font-size:12px;color:var(--tmu);margin-top:2px;line-height:1.45;">Navigate to the <b>' + escapeHtml(className) + '</b> roster view to inspect class statistics, student counts, and demographic distribution.</div>'
    + '      </div>'
    + '    </div>'
    + '    <button type="button" class="btn btn-out btn-sm" onclick="openClassFromStudentDetail()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;white-space:nowrap;">'
    + '      <re-icon icon="chalkboard" size="13"></re-icon> Open Class Roster'
    + '    </button>'
    + '  </div>'
    + '</div>'

    // Card 4: Danger Zone: Delete Student
    + '<div class="subj-section-card" style="border:1px solid rgba(220,38,38,0.25);border-radius:12px;background:rgba(254,242,242,0.6);padding:16px 20px;">'
    + '  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">'
    + '    <div style="display:flex;align-items:flex-start;gap:14px;flex:1;min-width:240px;">'
    + '      <div style="width:42px;height:42px;border-radius:10px;background:rgba(220,38,38,0.12);color:#dc2626;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
    + '        <re-icon icon="trash2" size="20"></re-icon>'
    + '      </div>'
    + '      <div>'
    + '        <div style="font-size:14px;font-weight:700;color:#dc2626;letter-spacing:-0.2px;">Danger Zone: Delete Student</div>'
    + '        <div style="font-size:12px;color:var(--tmu);margin-top:2px;line-height:1.45;">Permanently remove <b>' + escapeHtml(fullName) + '</b> (' + escapeHtml(regNo) + ') and their attendance associations from the database. This action cannot be reversed.</div>'
    + '      </div>'
    + '    </div>'
    + '    <button type="button" class="btn bdan btn-sm" onclick="deleteStuFromDetail()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;white-space:nowrap;">'
    + '      <re-icon icon="trash2" size="13"></re-icon> Delete Student'
    + '    </button>'
    + '  </div>'
    + '</div>'
    + '</div>';

  // 3. Assemble Body with 6 Pane Containers
  var bodyEl = document.getElementById('sd-body');
  if (!bodyEl) return;

  bodyEl.innerHTML =
    '<div id="sd-pane-overview">' + overviewHtml + '</div>'
    + '<div id="sd-pane-attendance" style="display:none;">' + attendanceHtml + '</div>'
    + '<div id="sd-pane-academic" style="display:none;">' + academicHtml + '</div>'
    + '<div id="sd-pane-leaves" style="display:none;">' + leavesHtml + '</div>'
    + '<div id="sd-pane-trust" style="display:none;">' + trustHtml + '</div>'
    + '<div id="sd-pane-actions" style="display:none;">' + actionsHtml + '</div>';

  switchStuDetailTab(_currentStuDetailTab || 'overview');
  if (bodyEl) bodyEl.scrollTop = 0;
}

function openStuEdit(studentId) {
  _currentEditingStudentId = studentId;

  // Search in memory: _studentData, then DB cache
  var student = (_studentData || []).find(function (x) { return String(x._id) === String(studentId); })
    || (DB.get('students') || []).find(function (x) { return String(x._id) === String(studentId); });

  // Merge with _currentDetailStudent if available
  if (_currentDetailStudent && String(_currentDetailStudent._id) === String(studentId)) {
    student = Object.assign({}, student || {}, _currentDetailStudent);
  }

  if (student && student.email && student.username) {
    _populateAndShowStuEditModal(student);
    return;
  }

  // If not found in local memory or email/username missing, fetch directly from API
  dbToast('Loading student…', 'saving');
  apiCall('GET', '/students/' + encodeURIComponent(studentId))
    .then(function (fetched) {
      if (fetched) {
        var merged = Object.assign({}, student || {}, fetched);
        _populateAndShowStuEditModal(merged);
      } else if (student) {
        _populateAndShowStuEditModal(student);
      } else {
        dbToast('Student not found in database', 'warn');
      }
    })
    .catch(function () {
      if (student) {
        _populateAndShowStuEditModal(student);
      } else {
        dbToast('Failed to load student details', 'error');
      }
    });
}

/**
 * Sanitizes full name by removing dots, commas, slashes, backslashes,
 * colons, semicolons, and underscores, normalizing whitespace.
 * Ensures the full name NEVER contains '.', ',', '/', or '\'.
 */
function sanitizeFullName(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/[.,\/\\;:_]+/g, ' ')
    .replace(/[^A-Za-z0-9\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Correctly splits full name into First Name and Last Name.
 * Handles single names, standard names, single initials, and multi-letter initials
 * whether positioned at the end or the beginning.
 */
function splitFirstLastName(rawName) {
  var clean = sanitizeFullName(rawName);
  var parts = clean.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { firstName: '', lastName: '', fullName: '' };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '', fullName: parts[0] };
  }
  if (parts.length === 2) {
    var firstIsInit = /^[A-Za-z]{1,2}$/.test(parts[0]);
    var lastIsInit = /^[A-Za-z]{1,2}$/.test(parts[1]);
    if (firstIsInit && !lastIsInit) {
      return { firstName: parts[1], lastName: parts[0], fullName: clean };
    }
    return { firstName: parts[0], lastName: parts[1], fullName: clean };
  }

  var last = parts[parts.length - 1];
  var secondLast = parts[parts.length - 2];
  var first = parts[0];

  var lastTwoInitials = /^[A-Za-z]{1,2}$/.test(last) && /^[A-Za-z]{1,2}$/.test(secondLast);
  var lastIsInitial = /^[A-Za-z]{1,2}$/.test(last);
  var firstIsInitial = /^[A-Za-z]{1,2}$/.test(first);

  if (lastTwoInitials) {
    return {
      firstName: parts.slice(0, -2).join(' '),
      lastName: parts.slice(-2).join(' '),
      fullName: clean
    };
  }
  if (lastIsInitial) {
    return {
      firstName: parts.slice(0, -1).join(' '),
      lastName: last,
      fullName: clean
    };
  }
  if (firstIsInitial) {
    return {
      firstName: parts.slice(1).join(' '),
      lastName: first,
      fullName: clean
    };
  }

  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: last,
    fullName: clean
  };
}

function _populateAndShowStuEditModal(student) {
  if (!student) return;

  var subEl = document.getElementById('edit-subtitle');
  if (subEl) subEl.textContent = (student.regNo || '') + ' · ' + (student.className || student.deptName || '');

  var cleanName = sanitizeFullName(student.name || student.fullName || '');
  var nameEl = document.getElementById('edit-name');
  if (nameEl) nameEl.value = cleanName;

  var regNoEl = document.getElementById('edit-regNo');
  if (regNoEl) regNoEl.value = student.regNo || '';

  var rollNoEl = document.getElementById('edit-rollNo');
  if (rollNoEl) rollNoEl.value = student.rollNo || student.roll || '';

  var trackIdEl = document.getElementById('edit-trackId');
  if (trackIdEl) trackIdEl.value = student.trackId || '';

  // firstName / lastName — use stored values if clean & valid, or auto-split from cleanName
  (function () {
    var fnEl = document.getElementById('edit-firstName');
    var lnEl = document.getElementById('edit-lastName');
    if (!fnEl || !lnEl) return;
    var split = splitFirstLastName(cleanName);
    var storedFn = sanitizeFullName(student.firstName || '');
    var storedLn = sanitizeFullName(student.lastName || '');

    // Check if stored values were inverted (e.g. storedLn matches firstName part)
    var wasInverted = storedLn && split.firstName && (storedLn.toLowerCase() === split.firstName.toLowerCase() || storedFn.toLowerCase().includes(split.lastName.toLowerCase()));
    if (storedFn && !wasInverted) {
      fnEl.value = storedFn;
      lnEl.value = storedLn;
    } else {
      fnEl.value = split.firstName;
      lnEl.value = split.lastName;
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
    if (isCurrentUserSuperAdmin()) {
      var dInfo = getCurrentUserDeptInfo();
      var myDeptId = dInfo.id || student.deptId;
      var myDeptName = dInfo.name || student.deptName;
      editDeptEl.innerHTML = '<option value="' + (myDeptId || '') + '">' + escapeHtml(myDeptName || 'My Department') + '</option>';
      editDeptEl.value = myDeptId || '';
      editDeptEl.disabled = true;
      editDeptEl.style.cursor = 'not-allowed';
    } else {
      editDeptEl.innerHTML = '<option value="">— Select —</option>'
        + depts.map(function (d) {
          return '<option value="' + d._id + '"' + (String(d._id) === String(student.deptId) ? ' selected' : '') + '>' + d.name + '</option>';
        }).join('');
      editDeptEl.disabled = false;
      editDeptEl.style.cursor = '';
    }
  }

  updateEditClassList(student.classId);
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('edit-dept');
    SearchableDropdown.sync('edit-class');
  }

  var secEl = document.getElementById('edit-section');
  if (secEl) secEl.value = student.section || '';
  var editResEl = document.getElementById('edit-residency');
  if (editResEl) {
    editResEl.value = (student.residency === 'hostel' || student.residency === 'hosteler') ? 'hostel' : 'dayscholar';
  }
  var editGenEl = document.getElementById('edit-gender');
  if (editGenEl) {
    editGenEl.value = (student.gender && String(student.gender).toLowerCase() === 'female') ? 'Female' : 'Male';
  }
  var editAdmEl = document.getElementById('edit-admission-type');
  if (editAdmEl) {
    editAdmEl.value = (student.admissionType && String(student.admissionType).toLowerCase().includes('lateral')) ? 'Lateral Entry' : 'Regular';
  }

  setEditGender((student.gender && String(student.gender).toLowerCase() === 'female') ? 'Female' : ((student.gender && String(student.gender).toLowerCase() === 'other') ? 'Other' : 'Male'));
  setEditAdmissionType((student.admissionType && String(student.admissionType).toLowerCase().includes('lateral')) ? 'Lateral' : 'Regular');
  setEditResidency((student.residency === 'hostel' || student.residency === 'hosteler') ? 'hostel' : 'dayscholar');
  updateEditStudentLivePreview();

  // ── login details ──
  var emailEl = document.getElementById('edit-email');
  var usernameEl = document.getElementById('edit-username');
  var passwordEl = document.getElementById('edit-password');

  var emailVal = student.email || '';
  var usernameVal = student.username || '';
  var sRegNo = student.regNo || student.registerNo || '';
  if (!emailVal && sRegNo && sRegNo.length >= 12) {
    var yCode = sRegNo.substring(4, 6);
    var dCode = sRegNo.substring(6, 9);
    var dObj = (typeof getDeptByNumber === 'function' ? getDeptByNumber(dCode) : null);
    var two = dObj ? (dObj.twoLetterCode || (dObj.code ? dObj.code.slice(0, 2).toLowerCase() : '')) : '';
    if (!two && student.trackId) {
      var m = String(student.trackId).match(/TR\d{2}([A-Za-z]{2})/i);
      if (m) two = m[1].toLowerCase();
    }
    if (two && typeof buildStuEmail === 'function') {
      emailVal = buildStuEmail(cleanName, yCode, two);
    }
  }
  if (!usernameVal) {
    usernameVal = emailVal ? emailVal.split('@')[0] : (sRegNo ? sRegNo.toLowerCase() : '');
  }

  if (emailEl) {
    emailEl.value = emailVal;
    emailEl.__origEmail = emailVal;
  }
  if (usernameEl) usernameEl.value = usernameVal;
  if (passwordEl) passwordEl.value = '';
  _editEmailVerified = true;  // default: yes, auto
  _editEmailBeforeNo = '';
  hideEditEmailPopup();
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
  var inputEl = document.getElementById('edit-name');
  var raw = inputEl ? inputEl.value : '';
  var stripped = raw.replace(/[.,/\;:_]+/g, ' ');
  if (stripped !== raw && inputEl) {
    var cursor = inputEl.selectionStart;
    inputEl.value = stripped;
    if (cursor !== null) inputEl.setSelectionRange(cursor, cursor);
  }
  var clean = sanitizeFullName(stripped);
  var split = splitFirstLastName(clean);
  var fnEl = document.getElementById('edit-firstName');
  var lnEl = document.getElementById('edit-lastName');
  if (fnEl) fnEl.value = split.firstName || '';
  if (lnEl) lnEl.value = split.lastName || '';
  tryAutoDeriveEditEmail();
  updateEditStudentLivePreview();
}

function saveStuEdit() {
  var rawName = getFieldValue('edit-name');
  var name = sanitizeFullName(rawName);
  var split = splitFirstLastName(name);
  var firstName = sanitizeFullName(getFieldValue('edit-firstName')) || split.firstName;
  var lastName = sanitizeFullName(getFieldValue('edit-lastName'));
  if (!lastName && split.lastName) lastName = split.lastName;

  var regNo = getFieldValue('edit-regNo');
  var rollNo = getFieldValue('edit-rollNo') || '';
  var year = getFieldValue('edit-year');
  var ct = getFieldValue('edit-courseType');
  var batch = getFieldValue('edit-batch');
  var trackId = getFieldValue('edit-trackId');
  var branch = getFieldValue('edit-branch');
  var deptId = document.getElementById('edit-dept') ? document.getElementById('edit-dept').value : '';
  var classId = document.getElementById('edit-class') ? document.getElementById('edit-class').value : '';
  var residency = document.getElementById('edit-residency') ? document.getElementById('edit-residency').value : 'dayscholar';
  var gender = document.getElementById('edit-gender') ? document.getElementById('edit-gender').value : 'Male';
  var admissionType = document.getElementById('edit-admission-type') ? document.getElementById('edit-admission-type').value : 'Regular';
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
    rollNo: rollNo.trim(),
    academicYear: year, courseType: ct, course: branch, branch: branch,
    deptId: deptId, deptName: dept ? dept.name : '',
    classId: classId, className: cls ? cls.name : '',
    residency: residency,
    gender: gender,
    admissionType: admissionType,
    batch: batch, trackId: trackId,
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
      if (_currentDetailStudent && String(_currentDetailStudent._id) === String(studentId)) {
        Object.assign(_currentDetailStudent, updatePayload);
        _renderStudentDetailModal(_currentDetailStudent);
      }
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
  var rawName = getFieldValue('stu-name');
  var name = sanitizeFullName(rawName);
  var split = splitFirstLastName(name);
  var firstName = sanitizeFullName(getFieldValue('stu-firstName')) || split.firstName;
  var lastName = sanitizeFullName(getFieldValue('stu-lastName'));
  if (!lastName && split.lastName) lastName = split.lastName;
  var regNo = getFieldValue('stu-regNo');
  var rollNo = getFieldValue('stu-rollNo') || '';
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
  var residency = document.getElementById('stu-residency') ? document.getElementById('stu-residency').value : 'dayscholar';
  var gender = document.getElementById('stu-gender') ? document.getElementById('stu-gender').value : 'Male';
  var admissionType = document.getElementById('stu-admission-type') ? document.getElementById('stu-admission-type').value : 'Regular';
  var email = document.getElementById('stu-email') ? document.getElementById('stu-email').value.trim() : '';
  var username = getFieldValue('stu-username') || email.split('@')[0];
  var password = document.getElementById('stu-password') ? document.getElementById('stu-password').value : '';
  var dept = DB.get('depts').find(function (d) { return d._id === deptId; });
  if (isCurrentUserSuperAdmin()) {
    var dInfo = getCurrentUserDeptInfo();
    if (!deptId && dInfo.id) deptId = dInfo.id;
    if (!dept) {
      dept = (DB.get('depts') || []).find(function (d) { return (deptId && String(d._id) === String(deptId)) || d.name === dInfo.name; });
      if (dept && !deptId) deptId = dept._id;
    }
  }
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
    regNo: regNo, rollNo: rollNo.trim(), trackId: trackId,
    academicYear: year, batch: batch,
    courseType: courseType, branch: branch, course: branch,
    deptId: deptId, deptName: dept ? dept.name : '',
    classId: classId, className: cls ? cls.name : '',
    residency: residency,
    gender: gender,
    admissionType: admissionType,
    year: cls ? cls.year : '',
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

/** When dept changes <re-icon icon="arrow-right"></re-icon> fill courseType + branch from DB, filter class list */
// ─── STUDENT AUTO-FILL HELPERS ───────────────────────────────────────────────
// Register No format: 7140 | YY | DDD | RRR
//  7140 = institute, YY = year (25<re-icon icon="arrow-right"></re-icon>2025-26), DDD = 3-digit dept.number, RRR = roll

/** Build full email: "Arun M","25","cs" <re-icon icon="arrow-right"></re-icon> "arunm25cs@srishakthi.ac.in" */
function buildStuEmail(name, yearCode, twoCode) {
  var namePart = (name || '').trim().split(/\s+/).map(function (p) { return p.toLowerCase(); }).join('');
  if (!namePart || !yearCode || !twoCode) return '';
  return namePart + yearCode + twoCode.toLowerCase() + '@srishakthi.ac.in';
}

/** Build TrackId: "25","cs","208" <re-icon icon="arrow-right"></re-icon> "TR25CS208" */
function buildStuTrackId(yearCode, twoCode, roll) {
  if (!yearCode || !twoCode || !roll) return '';
  return 'TR' + yearCode + twoCode.toUpperCase() + String(roll).padStart(3, '0').slice(-3);
}

/** Build teacher TrackId from empId: "EMP-001" <re-icon icon="arrow-right"></re-icon> "TR-EMP-001" */
function buildTchTrackId(customEmpId) {
  var empId = typeof customEmpId === 'string' && customEmpId ? customEmpId : getFieldValue('t-ei');
  var trackInput = document.getElementById('t-ti');

  if (!empId) {
    if (trackInput) trackInput.value = '';
    return '';
  }

  var cleanEmpId = empId.replace(/^TR-?/i, '');
  var gen = 'TR-' + cleanEmpId;

  if (trackInput) {
    trackInput.value = gen;
  }

  return gen;
}
window.buildTchTrackId = buildTchTrackId;

/** Predict the next teacher employee ID starting from EMP-001 */
function predictNextTeacherEmpId() {
  var list = (typeof _teacherData !== 'undefined' && Array.isArray(_teacherData) && _teacherData.length)
    ? _teacherData
    : ((typeof DB !== 'undefined' && DB.get && (DB.get('teachers') || DB.get('users'))) || []);
  var maxNum = 0;
  if (Array.isArray(list)) {
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!t) continue;
      var raw = (t.employeeNo || t.empId || t.trackId || '').trim();
      var empMatch = raw.match(/EMP[-_]?(\d+)/i);
      if (empMatch) {
        var n = parseInt(empMatch[1], 10);
        if (n > maxNum && n < 100000) maxNum = n;
      } else {
        var numMatch = raw.match(/\b(\d+)\b/);
        if (numMatch) {
          var n2 = parseInt(numMatch[1], 10);
          if (n2 > maxNum && n2 < 100000) maxNum = n2;
        }
      }
    }
  }
  var nextNum = maxNum + 1;
  return 'EMP-' + String(nextNum).padStart(3, '0');
}
window.predictNextTeacherEmpId = predictNextTeacherEmpId;

/** Fetch authoritative next teacher employee ID from backend API */
function fetchNextTeacherEmpId(force) {
  var eiEl = document.getElementById('t-ei');
  if (!eiEl) return;
  if (typeof apiCall !== 'function') return;

  apiCall('GET', '/teachers/next-emp-id')
    .then(function (res) {
      var nextId = (res && res.data && res.data.nextEmpId) || (res && res.nextEmpId);
      if (nextId && eiEl) {
        if (force || !eiEl.value || eiEl.value === 'EMP-' || eiEl.value === 'EMP-001' || /^EMP-\d+$/i.test(eiEl.value)) {
          eiEl.value = nextId;
          buildTchTrackId();
        }
      }
    })
    .catch(function (err) {
      console.warn('Could not fetch next teacher empId:', err);
    });
}
window.fetchNextTeacherEmpId = fetchNextTeacherEmpId;

/** Prepare and populate the Add Teacher form with predicted next ID */
function prepareAddTeacherForm(force) {
  var eiEl = document.getElementById('t-ei');
  if (eiEl) {
    if (force || !eiEl.value || eiEl.value === 'EMP-' || eiEl.value === 'EMP-001' || /^EMP-\d+$/i.test(eiEl.value)) {
      eiEl.value = predictNextTeacherEmpId();
      buildTchTrackId();
    }
  }
  fetchNextTeacherEmpId(force);
  if (typeof updateAddTeacherLivePreview === 'function') updateAddTeacherLivePreview();
}
window.prepareAddTeacherForm = prepareAddTeacherForm;

/** Input handler to preserve EMP- prefix and auto-update Track ID */
function onTchEmpIdInput(e) {
  var eiEl = document.getElementById('t-ei');
  if (!eiEl) return;
  var val = eiEl.value;

  if (!val) {
    eiEl.value = 'EMP-';
    buildTchTrackId();
    if (typeof updateAddTeacherLivePreview === 'function') updateAddTeacherLivePreview();
    return;
  }

  var formatted = val;
  if (/^emp/i.test(val)) {
    var upper = val.toUpperCase();
    if (/^EMP\d/.test(upper)) {
      formatted = 'EMP-' + upper.slice(3);
    } else {
      formatted = upper;
    }
  } else if (/^\d+$/.test(val)) {
    formatted = 'EMP-' + val;
  }

  if (formatted !== val) {
    eiEl.value = formatted;
  }

  buildTchTrackId();
  if (typeof updateAddTeacherLivePreview === 'function') updateAddTeacherLivePreview();
}
window.onTchEmpIdInput = onTchEmpIdInput;

/** Blur handler: pad digits to 3 digits (e.g. EMP-1 -> EMP-001) or restore prediction if empty/EMP- */
function onTchEmpIdBlur() {
  var eiEl = document.getElementById('t-ei');
  if (!eiEl) return;
  var val = (eiEl.value || '').trim();
  if (!val || val.toUpperCase() === 'EMP-') {
    eiEl.value = predictNextTeacherEmpId();
    buildTchTrackId();
    fetchNextTeacherEmpId(true);
    if (typeof updateAddTeacherLivePreview === 'function') updateAddTeacherLivePreview();
    return;
  }
  var match = val.match(/^EMP-(\d+)$/i);
  if (match) {
    var padded = String(match[1]).padStart(3, '0');
    eiEl.value = 'EMP-' + padded;
    buildTchTrackId();
  }
  if (typeof updateAddTeacherLivePreview === 'function') updateAddTeacherLivePreview();
}
window.onTchEmpIdBlur = onTchEmpIdBlur;

/** Find dept from DB by 3-digit register code (dept.number) */
function getDeptByNumber(deptCode) {
  return DB.get('depts').find(function (d) { return d.number === deptCode; }) || null;
}

// ── email confirm state ───────────────────────────────────────────────────────
var _stuEmailVerified = true;  // default: yes, auto
var _stuEmailBeforeNo = '';   // snapshot taken when user clicks "No"

function _setStuAddBtn(on) {
  var btn = document.getElementById('btn-add-stu');
  if (!btn) return;
  btn.disabled = !on;
  btn.style.opacity = on ? '1' : '.5';
  btn.style.cursor = on ? 'pointer' : 'not-allowed';
}

/** Show the inline popup when email field is focused or clicked */
function showStuEmailPopup() {
  var emailEl = document.getElementById('stu-email');
  var popup = document.getElementById('stu-email-popup');
  if (!popup || !emailEl) return;
  if (emailEl.value.trim()) {
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
    if (usernameEl && full) usernameEl.value = full.split('@')[0];
    _setStuAddBtn(true);
    showToast('Email confirmed');
  } else {
    // "No" — snapshot current value; focus and select input for editing
    _stuEmailVerified = false;
    _stuEmailBeforeNo = emailEl ? emailEl.value.trim() : '';
    _setStuAddBtn(false);
    if (emailEl) { emailEl.focus(); emailEl.select(); }
  }
  updateAddStudentLivePreview();
}

/** Email manually edited */
function onStuEmailInput() {
  var emailEl = document.getElementById('stu-email');
  if (emailEl) emailEl.dataset.customized = emailEl.value.trim() ? 'true' : '';
  var email = emailEl ? emailEl.value.trim() : '';
  hideStuEmailPopup();
  var usernameEl = document.getElementById('stu-username');
  if (usernameEl) {
    usernameEl.value = email ? email.split('@')[0] : '';
  }
  _stuEmailVerified = true;
  _setStuAddBtn(true);
  updateAddStudentLivePreview();
}

/** Called when email is auto-generated by the form (regNo / name input) */
function _stuShowEmailVerify(email) {
  _stuEmailVerified = true;  // default: yes, auto
  _stuEmailBeforeNo = '';
  hideStuEmailPopup();
  var usernameEl = document.getElementById('stu-username');
  if (usernameEl && email) {
    usernameEl.value = email.split('@')[0];
  }
  _setStuAddBtn(true);
}
function onTchEmailInput() {
  var emailEl = document.getElementById('t-em');
  if (emailEl) {
    emailEl.value = emailEl.value.replace(/\s+/g, '');
  }
  var email = emailEl ? emailEl.value.trim() : '';

  var usernameEl = document.getElementById('t-us');
  if (usernameEl) {
    usernameEl.value = email.split('@')[0].replace(/\s+/g, '').toLowerCase();
  }
  if (typeof updateAddTeacherLivePreview === 'function') updateAddTeacherLivePreview();
}
window.onTchEmailInput = onTchEmailInput;

// ── EDIT-STUDENT EMAIL HANDLERS ───────────────────────────────────────────────
var _editEmailVerified = true;  // default: yes, auto
var _editEmailBeforeNo = '';

function showEditEmailPopup() {
  var emailEl = document.getElementById('edit-email');
  var popup = document.getElementById('edit-email-popup');
  if (!popup || !emailEl) return;
  if (emailEl.value.trim()) {
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
    if (usernameEl && full) usernameEl.value = full.split('@')[0];
    showToast('Email confirmed');
  } else {
    _editEmailVerified = false;
    _editEmailBeforeNo = emailEl ? emailEl.value.trim() : '';
    if (emailEl) { emailEl.focus(); emailEl.select(); }
  }
  updateEditStudentLivePreview();
}

function onEditEmailInput() {
  var emailEl = document.getElementById('edit-email');
  if (emailEl) emailEl.dataset.customized = emailEl.value.trim() ? 'true' : '';
  var email = emailEl ? emailEl.value.trim() : '';
  hideEditEmailPopup();
  var usernameEl = document.getElementById('edit-username');
  if (usernameEl) {
    usernameEl.value = email ? email.split('@')[0] : '';
  }
  _editEmailVerified = true;
  updateEditStudentLivePreview();
}

// Auto-hide inline email popups on outside click
document.addEventListener('click', function (e) {
  var stuPopup = document.getElementById('stu-email-popup');
  var stuInput = document.getElementById('stu-email');
  if (stuPopup && stuPopup.style.display === 'block') {
    if (!stuPopup.contains(e.target) && e.target !== stuInput) {
      stuPopup.style.display = 'none';
    }
  }
  var editPopup = document.getElementById('edit-email-popup');
  var editInput = document.getElementById('edit-email');
  if (editPopup && editPopup.style.display === 'block') {
    if (!editPopup.contains(e.target) && e.target !== editInput) {
      editPopup.style.display = 'none';
    }
  }
});

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

  if (preserveClassId && filtered.some(function (c) { return String(c._id) === String(preserveClassId); })) {
    clsEl.value = preserveClassId;
  } else {
    clsEl.value = '';
  }

  onStuClassChange();
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('stu-class');
  }
}

function onStuBatchChange() {
  updateStuClassList();
  var batchEl = document.getElementById('stu-batch');
  var batch = batchEl ? batchEl.value : '';
  if (batch) {
    var batchStart = parseInt(batch.split('-')[0], 10);
    if (!isNaN(batchStart)) {
      var acYear = batchStart + '-' + (batchStart + 1);
      var yearEl = document.getElementById('stu-year');
      if (yearEl) {
        for (var i = 0; i < yearEl.options.length; i++) {
          var yv = (yearEl.options[i].value || yearEl.options[i].text || '').trim();
          if (yv === acYear || yv.startsWith(String(batchStart))) {
            yearEl.value = yearEl.options[i].value || yv;
            break;
          }
        }
      }
    }
  }
  var rnEl = document.getElementById('stu-regNo');
  if (rnEl && rnEl.value && rnEl.value.length <= 9) {
    var deptId = document.getElementById('stu-dept') ? document.getElementById('stu-dept').value : '';
    var dept = (DB.get('depts') || []).find(function (d) { return String(d._id) === String(deptId); });
    var yrCode = '';
    if (batch) {
      var yrMatch = batch.match(/^\d{2}(\d{2})/);
      if (yrMatch) yrCode = yrMatch[1];
    }
    var deptNum = dept ? (dept.number || '') : '';
    if (yrCode && deptNum) {
      rnEl.value = '7140' + yrCode + deptNum;
    }
  }
  tryAutoDeriveStuEmail();
  updateAddStudentLivePreview();
}

/** Dept dropdown changed <re-icon icon="arrow-right"></re-icon> fill courseType/branch, filter class list by dept & batch */
function onStuDeptChange() {
  var deptId = document.getElementById('stu-dept') ? document.getElementById('stu-dept').value : '';
  var dept = (DB.get('depts') || []).find(function (d) { return String(d._id) === String(deptId); });
  var ctEl = document.getElementById('stu-courseType');
  var brEl = document.getElementById('stu-branch');
  if (ctEl) ctEl.value = dept ? (dept.courseType || '') : '';
  if (brEl) brEl.value = dept ? (dept.branch || '') : '';
  updateStuClassList();

  var rnEl = document.getElementById('stu-regNo');
  if (rnEl && rnEl.value && rnEl.value.length <= 9) {
    var batchEl = document.getElementById('stu-batch');
    var batch = batchEl ? batchEl.value : '';
    var yrCode = '';
    if (batch) {
      var yrMatch = batch.match(/^\d{2}(\d{2})/);
      if (yrMatch) yrCode = yrMatch[1];
    }
    var deptNum = dept ? (dept.number || '') : '';
    if (yrCode && deptNum) {
      rnEl.value = '7140' + yrCode + deptNum;
    }
  }
  tryAutoDeriveStuEmail();
  updateAddStudentLivePreview();
}

function onStuClassChange() {
  var clsId = document.getElementById('stu-class') ? document.getElementById('stu-class').value : '';
  if (!clsId) return;
  var cls = (DB.get('classes') || []).find(function (c) { return String(c._id) === String(clsId); });
  if (cls) {
    var batchEl = document.getElementById('stu-batch');
    if (batchEl && !batchEl.value && cls.batch) {
      batchEl.value = cls.batch;
      onStuBatchChange();
    }
    var deptEl = document.getElementById('stu-dept');
    if (deptEl && !deptEl.value && cls.deptId && !deptEl.disabled) {
      deptEl.value = cls.deptId ? (cls.deptId._id || cls.deptId) : '';
      onStuDeptChange();
    }
  }
}

function syncAddStudentModalFromFilters() {
  var sfBatch = document.getElementById('sf-batch');
  var sfCt = document.getElementById('sf-ct');
  var sfDept = document.getElementById('sf-dept');
  var sfCls = document.getElementById('sf-cls');

  var batchVal = sfBatch ? sfBatch.value : '';
  var ctVal = sfCt ? sfCt.value : '';
  var deptVal = sfDept ? sfDept.value : '';
  var clsVal = sfCls ? sfCls.value : '';

  // If class is selected, infer dept and batch from class if not explicitly chosen
  if (clsVal) {
    var clsObj = (DB.get('classes') || []).find(function (c) { return String(c._id) === String(clsVal); });
    if (clsObj) {
      if (!deptVal) deptVal = clsObj.deptId ? (clsObj.deptId._id || clsObj.deptId) : '';
      if (!batchVal) batchVal = clsObj.batch || '';
    }
  }

  // 1. Department
  var stuDept = document.getElementById('stu-dept');
  if (stuDept && deptVal && !stuDept.disabled) {
    stuDept.value = deptVal;
    onStuDeptChange();
  }

  // 2. Batch
  var stuBatch = document.getElementById('stu-batch');
  if (stuBatch && batchVal) {
    stuBatch.value = batchVal;
  }

  // 3. Academic Year (stu-year) from batch or current year
  if (batchVal) {
    var batchStart = parseInt(batchVal.split('-')[0], 10);
    if (!isNaN(batchStart)) {
      var acYear = batchStart + '-' + (batchStart + 1);
      var yearEl = document.getElementById('stu-year');
      if (yearEl) {
        for (var i = 0; i < yearEl.options.length; i++) {
          var yv = (yearEl.options[i].value || yearEl.options[i].text || '').trim();
          if (yv === acYear || yv.startsWith(String(batchStart))) {
            yearEl.value = yearEl.options[i].value || yv;
            break;
          }
        }
      }
    }
  }

  // 4. Course type (if specified and not filled)
  var ctEl = document.getElementById('stu-courseType');
  if (ctVal && ctEl && (!ctEl.value || ctEl.value === 'None')) {
    ctEl.value = ctVal;
  }

  // 5. Update Class dropdown and pre-select the class if available
  updateStuClassList(clsVal);

  // 6. Register number prefix helper (e.g. 7140 + 25 + 104 = 714025104)
  var rnEl = document.getElementById('stu-regNo');
  if (rnEl && (rnEl.value === '7140' || !rnEl.value)) {
    var currentDeptId = stuDept ? stuDept.value : deptVal;
    var targetDept = (DB.get('depts') || []).find(function (d) { return String(d._id) === String(currentDeptId); });
    var yrCode = '';
    var activeBatch = (stuBatch && stuBatch.value) || batchVal;
    if (activeBatch) {
      var yrMatch = activeBatch.match(/^\d{2}(\d{2})/);
      if (yrMatch) yrCode = yrMatch[1];
    }
    var deptNum = targetDept ? (targetDept.number || '') : '';
    if (yrCode && deptNum) {
      rnEl.value = '7140' + yrCode + deptNum;
    }
  }

  // 7. Sync SearchableDropdown
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('stu-dept');
    SearchableDropdown.sync('stu-class');
  }

  // 8. Residency from filter
  var sfRes = document.getElementById('sf-residency');
  var resVal = sfRes ? sfRes.value : '';
  if (resVal) {
    var stuRes = document.getElementById('stu-residency');
    if (stuRes) stuRes.value = (resVal === 'hostel' || resVal === 'hosteller') ? 'hostel' : 'dayscholar';
  }

  // 9. Admission Type from filter
  var sfAdm = document.getElementById('sf-admission-type');
  var admVal = sfAdm ? sfAdm.value : '';
  if (admVal) {
    var stuAdm = document.getElementById('stu-admission-type');
    if (stuAdm) stuAdm.value = (admVal.toLowerCase().includes('lateral')) ? 'Lateral Entry' : 'Regular';
  }
}
window.syncAddStudentModalFromFilters = syncAddStudentModalFromFilters;

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
      + filtered.map(function (c) { return '<option value="' + c._id + '">' + c.name + '</option>'; }).join('');
  }

  if (preserveClassId && filtered.some(function (c) { return c._id === preserveClassId; })) {
    clsEl.value = preserveClassId;
  } else {
    clsEl.value = '';
  }

  onEditClassChange();
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('edit-class');
  }
}

function onEditBatchChange() {
  updateEditClassList();
  tryAutoDeriveEditEmail();
  updateEditStudentLivePreview();
}

function onEditDeptChange() {
  var deptId = document.getElementById('edit-dept') ? document.getElementById('edit-dept').value : '';
  var dept = (DB.get('depts') || []).find(function (d) { return String(d._id) === String(deptId); });
  var ctEl = document.getElementById('edit-courseType');
  var brEl = document.getElementById('edit-branch');
  if (ctEl) ctEl.value = dept ? (dept.courseType || '') : '';
  if (brEl) brEl.value = dept ? (dept.branch || dept.name || '') : '';
  updateEditClassList();
  tryAutoDeriveEditEmail();
  updateEditStudentLivePreview();
}

function onEditClassChange() {
  updateEditStudentLivePreview();
}

/** Register No <re-icon icon="arrow-right"></re-icon> decode all fields */
function onStuRegNoChange() {
  var regNo = (getFieldValue('stu-regNo') || '').replace(/\D/g, '');
  var rnEl = document.getElementById('stu-regNo');
  if (rnEl) rnEl.value = regNo;

  var tidEl = document.getElementById('stu-trackId');
  if (regNo.length < 12) {
    if (tidEl) tidEl.value = regNo;
    tryAutoDeriveStuEmail();
    updateAddStudentLivePreview();
    return;
  }

  var yearCode = regNo.substring(4, 6);
  var deptCode = regNo.substring(6, 9);
  var roll = regNo.substring(9, 12);

  // Academic year
  var acStart = 2000 + parseInt(yearCode, 10);
  var acEnd = acStart + 1;
  var acYear = acStart + '-' + acEnd;
  var acYearShort = acStart + '-' + String(acEnd).slice(-2);
  var yearEl = document.getElementById('stu-year');
  if (yearEl) {
    for (var i = 0; i < yearEl.options.length; i++) {
      var yv = (yearEl.options[i].value || yearEl.options[i].text || '').trim();
      if (yv === acYear || yv === acYearShort || yv.startsWith(String(acStart))) {
        yearEl.value = yearEl.options[i].value || yv;
        break;
      }
    }
  }

  // Batch year (4-year UG)
  var batchStart = 2000 + parseInt(yearCode, 10);
  var batchEnd = batchStart + 4;
  var batchYear = batchStart + '-' + batchEnd;
  var batchEl = document.getElementById('stu-batch');
  if (batchEl) {
    var matchedBatch = null;
    for (var i = 0; i < batchEl.options.length; i++) {
      var bv = (batchEl.options[i].value || batchEl.options[i].text || '').trim();
      if (bv === batchYear) {
        matchedBatch = batchEl.options[i].value || bv;
        break;
      }
    }
    if (!matchedBatch) {
      for (var i = 0; i < batchEl.options.length; i++) {
        var bv = (batchEl.options[i].value || batchEl.options[i].text || '').trim();
        if (bv.startsWith(String(batchStart)) || bv.startsWith(yearCode + '-')) {
          matchedBatch = batchEl.options[i].value || bv;
          break;
        }
      }
    }
    if (matchedBatch) {
      batchEl.value = matchedBatch;
    }
  }

  // Dept
  var dept = getDeptByNumber(deptCode);
  if (isCurrentUserSuperAdmin()) {
    var myDInfo = getCurrentUserDeptInfo();
    var myDeptId = myDInfo.id;
    var myDeptObj = (DB.get('depts') || []).find(function (d) {
      return (myDeptId && String(d._id) === String(myDeptId)) || (myDInfo.name && d.name === myDInfo.name);
    });
    if (dept && myDeptObj && String(dept._id) !== String(myDeptObj._id)) {
      showToast('As Super Admin, you can only add students for your department (' + (myDInfo.name || 'your department') + ')', 'warn');
      return;
    }
    if (myDeptObj) dept = myDeptObj;
  }
  if (dept) {
    var deptEl = document.getElementById('stu-dept');
    if (deptEl) {
      deptEl.value = dept._id;
      if (typeof SearchableDropdown !== 'undefined') {
        SearchableDropdown.sync('stu-dept');
      }
    }
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
  updateAddStudentLivePreview();


// ═════════════════════════════════════════════════════════════════════════════
// STUDENT MODAL REDESIGN HELPERS (Add & Edit Student Modal Live Synchronization)
// ═════════════════════════════════════════════════════════════════════════════

function getInitials(name) {
  if (!name || !name.trim()) return '';
  var parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
window.getInitials = getInitials;

// ─── SEGMENTED SWITCHER ANIMATION ENGINE ─────────────────────────────────
function triggerSegRipple(btn, e) {
  if (!btn) return;
  var rect = btn.getBoundingClientRect();
  var circle = document.createElement('span');
  circle.className = 'seg-ripple';
  var size = Math.max(rect.width, rect.height) * 1.6;
  var x = (e && typeof e.clientX === 'number') ? (e.clientX - rect.left) : (rect.width / 2);
  var y = (e && typeof e.clientY === 'number') ? (e.clientY - rect.top) : (rect.height / 2);
  circle.style.width = size + 'px';
  circle.style.height = size + 'px';
  circle.style.left = x + 'px';
  circle.style.top = y + 'px';
  btn.appendChild(circle);
  setTimeout(function () {
    if (circle && circle.parentNode) circle.parentNode.removeChild(circle);
  }, 600);
}
window.triggerSegRipple = triggerSegRipple;

function updateSegGlider(segEl, animate) {
  if (typeof segEl === 'string') segEl = document.getElementById(segEl);
  if (!segEl) return;
  segEl.classList.add('has-glider');
  var glider = segEl.querySelector('.stu-seg-glider');
  if (!glider) {
    glider = document.createElement('span');
    glider.className = 'stu-seg-glider';
    glider.setAttribute('aria-hidden', 'true');
    segEl.insertBefore(glider, segEl.firstChild);
  }
  var actBtn = segEl.querySelector('.stu-seg-btn.act') || segEl.querySelector('.stu-seg-btn.on');
  if (!actBtn || actBtn.offsetWidth === 0) return;

  var targetX = actBtn.offsetLeft;
  var targetW = actBtn.offsetWidth;
  var prevX = (typeof segEl._lastX === 'number') ? segEl._lastX : targetX;
  var prevW = (typeof segEl._lastW === 'number') ? segEl._lastW : targetW;

  segEl._lastX = targetX;
  segEl._lastW = targetW;

  if (segEl._waterTimer1) { clearTimeout(segEl._waterTimer1); segEl._waterTimer1 = null; }
  if (segEl._waterTimer2) { clearTimeout(segEl._waterTimer2); segEl._waterTimer2 = null; }

  if (animate === false || prevX === targetX) {
    glider.classList.add('no-anim');
    glider.classList.remove('water-sloshing');
    segEl.style.setProperty('--glider-x', targetX + 'px');
    segEl.style.setProperty('--glider-w', targetW + 'px');
    glider.style.transform = 'translateX(' + targetX + 'px)';
    glider.style.width = targetW + 'px';
    glider.style.transition = 'none';
    void glider.offsetWidth;
    requestAnimationFrame(function () {
      glider.classList.remove('no-anim');
    });
    return;
  }

  glider.classList.remove('no-anim');
  glider.classList.remove('water-sloshing');

  var isMovingRight = targetX > prevX;
  var surgeX = isMovingRight ? prevX : targetX;
  var surgeW = isMovingRight ? (targetX + targetW - prevX) : (prevX + prevW - targetX);

  // Phase 1: Water Surge — green color smoothly expands across like flowing liquid
  glider.style.transition = 'transform 0.17s cubic-bezier(0.2, 0.8, 0.25, 1), width 0.17s cubic-bezier(0.1, 0.9, 0.25, 1)';
  glider.style.transform = 'translateX(' + surgeX + 'px)';
  glider.style.width = surgeW + 'px';
  segEl.style.setProperty('--glider-x', targetX + 'px');
  segEl.style.setProperty('--glider-w', targetW + 'px');

  // Phase 2: Water Pull/Contract — trailing edge pulls in and liquid pools at target field
  segEl._waterTimer1 = setTimeout(function () {
    glider.style.transition = 'transform 0.22s cubic-bezier(0.34, 1.25, 0.64, 1), width 0.22s cubic-bezier(0.34, 1.25, 0.64, 1)';
    glider.style.transform = 'translateX(' + targetX + 'px)';
    glider.style.width = targetW + 'px';

    // Phase 3: Liquid Settle Wobble / Slosh
    segEl._waterTimer2 = setTimeout(function () {
      glider.classList.add('water-sloshing');
    }, 220);
  }, 145);
}
window.updateSegGlider = updateSegGlider;

function updateAllSegGliders(animate) {
  var segs = document.querySelectorAll('.stu-seg');
  segs.forEach(function (seg) {
    updateSegGlider(seg, animate);
  });
}
window.updateAllSegGliders = updateAllSegGliders;

// Delegated ripple handler on segmented buttons
document.addEventListener('click', function (e) {
  var btn = e.target && e.target.closest ? e.target.closest('.stu-seg-btn') : null;
  if (btn) {
    triggerSegRipple(btn, e);
  }
});

// Update gliders on viewport resize
window.addEventListener('resize', function () {
  updateAllSegGliders(false);
});

function setStuGender(val) {
  var inp = document.getElementById('stu-gender');
  if (inp) inp.value = val;
  var seg = document.getElementById('stu-seg-gender');
  if (seg) {
    seg.querySelectorAll('.stu-seg-btn').forEach(function (b) {
      var isM = b.getAttribute('data-val').toLowerCase() === String(val).toLowerCase();
      b.classList.toggle('act', isM);
      b.classList.toggle('on', isM);
    });
    updateSegGlider(seg, true);
  }
  updateAddStudentLivePreview();
}
window.setStuGender = setStuGender;

function setStuAdmissionType(val) {
  var inp = document.getElementById('stu-admission-type');
  if (inp) inp.value = val;
  var seg = document.getElementById('stu-seg-admission');
  if (seg) {
    seg.querySelectorAll('.stu-seg-btn').forEach(function (b) {
      var isM = b.getAttribute('data-val').toLowerCase().startsWith(String(val).toLowerCase().slice(0, 3));
      b.classList.toggle('act', isM);
      b.classList.toggle('on', isM);
    });
    updateSegGlider(seg, true);
  }
  updateAddStudentLivePreview();
}
window.setStuAdmissionType = setStuAdmissionType;

function setStuResidency(val) {
  var inp = document.getElementById('stu-residency');
  if (inp) inp.value = val;
  var seg = document.getElementById('stu-seg-residency');
  if (seg) {
    seg.querySelectorAll('.stu-seg-btn').forEach(function (b) {
      var isM = b.getAttribute('data-val').toLowerCase().startsWith(String(val).toLowerCase().slice(0, 4));
      b.classList.toggle('act', isM);
      b.classList.toggle('on', isM);
    });
    updateSegGlider(seg, true);
  }
  updateAddStudentLivePreview();
}
window.setStuResidency = setStuResidency;

function setEditGender(val) {
  var inp = document.getElementById('edit-gender');
  if (inp) inp.value = val;
  var seg = document.getElementById('edit-seg-gender');
  if (seg) {
    seg.querySelectorAll('.stu-seg-btn').forEach(function (b) {
      var isM = b.getAttribute('data-val').toLowerCase() === String(val).toLowerCase();
      b.classList.toggle('act', isM);
      b.classList.toggle('on', isM);
    });
    updateSegGlider(seg, true);
  }
  updateEditStudentLivePreview();
}
window.setEditGender = setEditGender;

function setEditAdmissionType(val) {
  var inp = document.getElementById('edit-admission-type');
  if (inp) inp.value = val;
  var seg = document.getElementById('edit-seg-admission');
  if (seg) {
    seg.querySelectorAll('.stu-seg-btn').forEach(function (b) {
      var isM = b.getAttribute('data-val').toLowerCase().startsWith(String(val).toLowerCase().slice(0, 3));
      b.classList.toggle('act', isM);
      b.classList.toggle('on', isM);
    });
    updateSegGlider(seg, true);
  }
  updateEditStudentLivePreview();
}
window.setEditAdmissionType = setEditAdmissionType;

function setEditResidency(val) {
  var inp = document.getElementById('edit-residency');
  if (inp) inp.value = val;
  var seg = document.getElementById('edit-seg-residency');
  if (seg) {
    seg.querySelectorAll('.stu-seg-btn').forEach(function (b) {
      var isM = b.getAttribute('data-val').toLowerCase().startsWith(String(val).toLowerCase().slice(0, 4));
      b.classList.toggle('act', isM);
      b.classList.toggle('on', isM);
    });
    updateSegGlider(seg, true);
  }
  updateEditStudentLivePreview();
}
window.setEditResidency = setEditResidency;


function tryAutoDeriveStuEmail() {
  var emailEl = document.getElementById('stu-email');
  if (!emailEl) return;
  if (emailEl.dataset.customized === 'true' && emailEl.value.trim()) return;

  var name = (getFieldValue('stu-name') || '').trim();
  var regNo = (getFieldValue('stu-regNo') || '').replace(/\D/g, '');
  var batch = (getFieldValue('stu-batch') || '').trim();
  var deptId = document.getElementById('stu-dept') ? document.getElementById('stu-dept').value : '';

  var yearCode = '';
  if (regNo.length >= 6) {
    yearCode = regNo.substring(4, 6);
  } else if (batch) {
    var ym = batch.match(/^\d{2}(\d{2})/);
    if (ym) yearCode = ym[1];
  }

  var twoCode = '';
  var depts = Array.isArray(DB.get('depts')) ? DB.get('depts') : [];
  var dept = depts.find(function (d) { return String(d._id) === String(deptId); });
  if (dept) {
    twoCode = dept.twoLetterCode || (dept.code ? dept.code.slice(0, 2).toLowerCase() : '');
  } else if (regNo.length >= 9) {
    var deptCode = regNo.substring(6, 9);
    var dFromNum = typeof getDeptByNumber === 'function' ? getDeptByNumber(deptCode) : null;
    if (dFromNum) {
      twoCode = dFromNum.twoLetterCode || (dFromNum.code ? dFromNum.code.slice(0, 2).toLowerCase() : '');
    }
  }

  if (name && yearCode && twoCode) {
    var genEmail = buildStuEmail(name, yearCode, twoCode);
    if (genEmail) {
      emailEl.value = genEmail;
      var usernameEl = document.getElementById('stu-username');
      if (usernameEl) usernameEl.value = genEmail.split('@')[0];
      _stuEmailVerified = true;
      _setStuAddBtn(true);
    }
  } else if (!name && emailEl.dataset.customized !== 'true') {
    emailEl.value = '';
    var usernameEl = document.getElementById('stu-username');
    if (usernameEl) usernameEl.value = '';
  }
}
window.tryAutoDeriveStuEmail = tryAutoDeriveStuEmail;

function tryAutoDeriveEditEmail() {
  var emailEl = document.getElementById('edit-email');
  if (!emailEl) return;
  if (emailEl.dataset.customized === 'true' && emailEl.value.trim()) return;

  var name = (getFieldValue('edit-name') || '').trim();
  var regNo = (getFieldValue('edit-regNo') || '').replace(/\D/g, '');
  var batch = (getFieldValue('edit-batch') || '').trim();
  var deptId = document.getElementById('edit-dept') ? document.getElementById('edit-dept').value : '';

  var yearCode = '';
  if (regNo.length >= 6) {
    yearCode = regNo.substring(4, 6);
  } else if (batch) {
    var ym = batch.match(/^\d{2}(\d{2})/);
    if (ym) yearCode = ym[1];
  }

  var twoCode = '';
  var depts = Array.isArray(DB.get('depts')) ? DB.get('depts') : [];
  var dept = depts.find(function (d) { return String(d._id) === String(deptId); });
  if (dept) {
    twoCode = dept.twoLetterCode || (dept.code ? dept.code.slice(0, 2).toLowerCase() : '');
  } else if (regNo.length >= 9) {
    var deptCode = regNo.substring(6, 9);
    var dFromNum = typeof getDeptByNumber === 'function' ? getDeptByNumber(deptCode) : null;
    if (dFromNum) {
      twoCode = dFromNum.twoLetterCode || (dFromNum.code ? dFromNum.code.slice(0, 2).toLowerCase() : '');
    }
  }

  if (name && yearCode && twoCode) {
    var genEmail = buildStuEmail(name, yearCode, twoCode);
    if (genEmail) {
      emailEl.value = genEmail;
      var usernameEl = document.getElementById('edit-username');
      if (usernameEl) usernameEl.value = genEmail.split('@')[0];
      _editEmailVerified = true;
    }
  }
}
window.tryAutoDeriveEditEmail = tryAutoDeriveEditEmail;

function onEditRegNoChange() {
  var regNo = (getFieldValue('edit-regNo') || '').replace(/\D/g, '');
  var rnEl = document.getElementById('edit-regNo');
  if (rnEl) rnEl.value = regNo;

  var tidEl = document.getElementById('edit-trackId');
  if (regNo.length < 12) {
    if (tidEl) tidEl.value = regNo;
    tryAutoDeriveEditEmail();
    updateEditStudentLivePreview();
    return;
  }

  var yearCode = regNo.substring(4, 6);
  var deptCode = regNo.substring(6, 9);
  var roll = regNo.substring(9, 12);
  var dept = typeof getDeptByNumber === 'function' ? getDeptByNumber(deptCode) : null;
  if (dept) {
    var twoCode = dept.twoLetterCode || (dept.code ? dept.code.slice(0, 2).toLowerCase() : '');
    var tid = buildStuTrackId(yearCode, twoCode, roll);
    if (tidEl) tidEl.value = tid;
  }
  tryAutoDeriveEditEmail();
  updateEditStudentLivePreview();
}
window.onEditRegNoChange = onEditRegNoChange;

function updateAddStudentLivePreview() {
  var name = (getFieldValue('stu-name') || '').trim();
  var regNo = (getFieldValue('stu-regNo') || '').trim();
  var batch = (getFieldValue('stu-batch') || '').trim();
  var deptId = document.getElementById('stu-dept') ? document.getElementById('stu-dept').value : '';
  var classId = document.getElementById('stu-class') ? document.getElementById('stu-class').value : '';
  var gender = (getFieldValue('stu-gender') || 'Male').trim();
  var admissionType = (getFieldValue('stu-admission-type') || 'Regular').trim();
  var residency = (getFieldValue('stu-residency') || 'dayscholar').trim();
  var email = (getFieldValue('stu-email') || '').trim();

  var depts = Array.isArray(DB.get('depts')) ? DB.get('depts') : [];
  var dept = depts.find(function (d) { return String(d._id) === String(deptId); });

  // 1. Avatar initials
  var avEl = document.getElementById('stu-preview-avatar');
  if (avEl) avEl.textContent = getInitials(name) || 'ST';

  // 2. Preview Name
  var nmEl = document.getElementById('stu-preview-name');
  if (nmEl) nmEl.textContent = name || 'Student Name';

  // 3. Preview Reg No
  var regEl = document.getElementById('stu-preview-reg');
  if (regEl) regEl.textContent = 'Register no. ' + (regNo || '—');

  // 4. Preview Batch
  var btEl = document.getElementById('stu-preview-batch');
  if (btEl) btEl.textContent = 'Batch ' + (batch || '2025-2029');

  // 5. First name / Last name split
  var split = splitFirstLastName(sanitizeFullName(name));
  var fnEl = document.getElementById('stu-firstName');
  var lnEl = document.getElementById('stu-lastName');
  if (fnEl) fnEl.value = split.firstName || '';
  if (lnEl) lnEl.value = split.lastName || '';

  var dispFn = document.getElementById('stu-disp-fn');
  if (dispFn) {
    if (split.firstName) {
      dispFn.textContent = split.firstName;
      dispFn.className = 'stu-kv-val'; dispFn.classList.remove('pd'); dispFn.classList.remove('pd'); dispFn.classList.remove('pd'); dispFn.classList.remove('pd');
    } else {
      dispFn.textContent = 'After name';
      dispFn.className = 'stu-kv-val pd'; dispFn.classList.add('pd');
    }
  }

  var dispLn = document.getElementById('stu-disp-ln');
  if (dispLn) {
    if (split.lastName) {
      dispLn.textContent = split.lastName;
      dispLn.className = 'stu-kv-val'; dispLn.classList.remove('pd'); dispLn.classList.remove('pd'); dispLn.classList.remove('pd'); dispLn.classList.remove('pd');
    } else {
      dispLn.textContent = 'After name';
      dispLn.className = 'stu-kv-val pd'; dispLn.classList.add('pd');
    }
  }

  // 6. Track ID
  var trackId = getFieldValue('stu-trackId') || regNo;
  var dispTid = document.getElementById('stu-disp-tid');
  if (dispTid) {
    if (trackId) {
      dispTid.textContent = trackId;
      dispTid.className = 'stu-kv-val'; dispTid.classList.remove('pd'); dispTid.classList.remove('pd'); dispTid.classList.remove('pd'); dispTid.classList.remove('pd');
    } else {
      dispTid.textContent = 'After register no';
      dispTid.className = 'stu-kv-val pd'; dispTid.classList.add('pd');
    }
  }

  // 7. Course type
  var ctVal = (dept ? (dept.courseType || '') : '') || getFieldValue('stu-courseType');
  var dispCt = document.getElementById('stu-disp-ct');
  if (dispCt) {
    if (ctVal) {
      dispCt.textContent = ctVal;
      dispCt.className = 'stu-kv-val'; dispCt.classList.remove('pd'); dispCt.classList.remove('pd'); dispCt.classList.remove('pd'); dispCt.classList.remove('pd');
    } else {
      dispCt.textContent = 'After department';
      dispCt.className = 'stu-kv-val pd'; dispCt.classList.add('pd');
    }
  }

  // 8. Branch
  var brVal = (dept ? (dept.branch || dept.name || '') : '') || getFieldValue('stu-branch');
  var dispBr = document.getElementById('stu-disp-br');
  if (dispBr) {
    if (brVal) {
      dispBr.textContent = brVal;
      dispBr.className = 'stu-kv-val'; dispBr.classList.remove('pd'); dispBr.classList.remove('pd'); dispBr.classList.remove('pd'); dispBr.classList.remove('pd');
    } else {
      dispBr.textContent = 'After department';
      dispBr.className = 'stu-kv-val pd'; dispBr.classList.add('pd');
    }
  }

  // 9. Username
  var unVal = email ? email.split('@')[0] : getFieldValue('stu-username');
  var dispUn = document.getElementById('stu-disp-un');
  if (dispUn) {
    if (unVal) {
      dispUn.textContent = unVal;
      dispUn.className = 'stu-kv-val'; dispUn.classList.remove('pd'); dispUn.classList.remove('pd'); dispUn.classList.remove('pd'); dispUn.classList.remove('pd');
    } else {
      dispUn.textContent = 'After email is set';
      dispUn.className = 'stu-kv-val pd'; dispUn.classList.add('pd');
    }
  }

  // 10. Required fields check
  var missing = [];
  if (!name) missing.push('Full Name');
  if (!regNo) missing.push('Register Number');
  if (!gender) missing.push('Gender');
  if (!deptId) missing.push('Department');
  if (!classId) missing.push('Class');
  if (!batch) missing.push('Batch');
  if (!admissionType) missing.push('Admission Type');
  if (!residency) missing.push('Dayscholar / Hosteller');

  var reqStatus = document.getElementById('stu-req-status');
  var reqCount = document.getElementById('stu-req-count');
  var reqNames = document.getElementById('stu-req-names');
  var addBtn = document.getElementById('btn-add-stu');

  if (missing.length > 0) {
    if (reqStatus) reqStatus.classList.remove('completed');
    if (reqCount) {
      reqCount.textContent = missing.length + ' required field' + (missing.length > 1 ? 's' : '') + ' left';
      reqCount.style.color = '#1b5e20';
    }
    if (reqNames) {
      reqNames.textContent = ' · ' + missing.join(', ');
    }
    if (addBtn) {
      addBtn.classList.remove('ready', 'p');
      addBtn.classList.add('d');
      addBtn.setAttribute('aria-disabled', 'true');
      addBtn.style.background = '';
    }
  } else {
    if (reqStatus) reqStatus.classList.add('completed');
    if (reqCount) {
      reqCount.innerHTML = '<re-icon icon="check-circle" size="14"></re-icon> All required fields completed';
      reqCount.style.color = '#1b5e20';
    }
    if (reqNames) reqNames.textContent = '';
    if (addBtn) {
      addBtn.classList.remove('d');
      addBtn.classList.add('ready', 'p');
      addBtn.removeAttribute('aria-disabled');
      addBtn.style.background = '';
    }
  }
}
window.updateAddStudentLivePreview = updateAddStudentLivePreview;

function updateEditStudentLivePreview() {
  var name = (getFieldValue('edit-name') || '').trim();
  var regNo = (getFieldValue('edit-regNo') || '').trim();
  var batch = (getFieldValue('edit-batch') || '').trim();
  var deptId = document.getElementById('edit-dept') ? document.getElementById('edit-dept').value : '';
  var classId = document.getElementById('edit-class') ? document.getElementById('edit-class').value : '';
  var gender = (getFieldValue('edit-gender') || 'Male').trim();
  var admissionType = (getFieldValue('edit-admission-type') || 'Regular').trim();
  var residency = (getFieldValue('edit-residency') || 'dayscholar').trim();
  var email = (getFieldValue('edit-email') || '').trim();

  var depts = Array.isArray(DB.get('depts')) ? DB.get('depts') : [];
  var dept = depts.find(function (d) { return String(d._id) === String(deptId); });

  // 1. Avatar
  var avEl = document.getElementById('edit-preview-avatar');
  if (avEl) avEl.textContent = getInitials(name) || 'ST';

  // 2. Name
  var nmEl = document.getElementById('edit-preview-name');
  if (nmEl) nmEl.textContent = name || 'Student Name';

  // 3. Reg No
  var regEl = document.getElementById('edit-preview-reg');
  if (regEl) regEl.textContent = 'Register no. ' + (regNo || '—');

  // 4. Batch
  var btEl = document.getElementById('edit-preview-batch');
  if (btEl) btEl.textContent = 'Batch ' + (batch || '—');

  // 5. First / Last name
  var split = splitFirstLastName(sanitizeFullName(name));
  var fnEl = document.getElementById('edit-firstName');
  var lnEl = document.getElementById('edit-lastName');
  if (fnEl && split.firstName && !fnEl.value) fnEl.value = split.firstName;
  if (lnEl && split.lastName && !lnEl.value) lnEl.value = split.lastName;

  var dispFn = document.getElementById('edit-disp-fn');
  if (dispFn) {
    var curFn = (fnEl && fnEl.value) || split.firstName;
    if (curFn) {
      dispFn.textContent = curFn;
      dispFn.className = 'stu-kv-val'; dispFn.classList.remove('pd'); dispFn.classList.remove('pd'); dispFn.classList.remove('pd'); dispFn.classList.remove('pd');
    } else {
      dispFn.textContent = 'After name';
      dispFn.className = 'stu-kv-val pd'; dispFn.classList.add('pd');
    }
  }

  var dispLn = document.getElementById('edit-disp-ln');
  if (dispLn) {
    var curLn = (lnEl && lnEl.value) || split.lastName;
    if (curLn) {
      dispLn.textContent = curLn;
      dispLn.className = 'stu-kv-val'; dispLn.classList.remove('pd'); dispLn.classList.remove('pd'); dispLn.classList.remove('pd'); dispLn.classList.remove('pd');
    } else {
      dispLn.textContent = 'After name';
      dispLn.className = 'stu-kv-val pd'; dispLn.classList.add('pd');
    }
  }

  // 6. Track ID
  var trackId = getFieldValue('edit-trackId') || regNo;
  var dispTid = document.getElementById('edit-disp-tid');
  if (dispTid) {
    if (trackId) {
      dispTid.textContent = trackId;
      dispTid.className = 'stu-kv-val'; dispTid.classList.remove('pd'); dispTid.classList.remove('pd'); dispTid.classList.remove('pd'); dispTid.classList.remove('pd');
    } else {
      dispTid.textContent = 'After register no';
      dispTid.className = 'stu-kv-val pd'; dispTid.classList.add('pd');
    }
  }

  // 7. Course type
  var ctVal = (dept ? (dept.courseType || '') : '') || getFieldValue('edit-courseType');
  var dispCt = document.getElementById('edit-disp-ct');
  if (dispCt) {
    if (ctVal) {
      dispCt.textContent = ctVal;
      dispCt.className = 'stu-kv-val'; dispCt.classList.remove('pd'); dispCt.classList.remove('pd'); dispCt.classList.remove('pd'); dispCt.classList.remove('pd');
    } else {
      dispCt.textContent = 'After department';
      dispCt.className = 'stu-kv-val pd'; dispCt.classList.add('pd');
    }
  }

  // 8. Branch
  var brVal = (dept ? (dept.branch || dept.name || '') : '') || getFieldValue('edit-branch');
  var dispBr = document.getElementById('edit-disp-br');
  if (dispBr) {
    if (brVal) {
      dispBr.textContent = brVal;
      dispBr.className = 'stu-kv-val'; dispBr.classList.remove('pd'); dispBr.classList.remove('pd'); dispBr.classList.remove('pd'); dispBr.classList.remove('pd');
    } else {
      dispBr.textContent = 'After department';
      dispBr.className = 'stu-kv-val pd'; dispBr.classList.add('pd');
    }
  }

  // 9. Username
  var unVal = email ? email.split('@')[0] : getFieldValue('edit-username');
  var dispUn = document.getElementById('edit-disp-un');
  if (dispUn) {
    if (unVal) {
      dispUn.textContent = unVal;
      dispUn.className = 'stu-kv-val'; dispUn.classList.remove('pd'); dispUn.classList.remove('pd'); dispUn.classList.remove('pd'); dispUn.classList.remove('pd');
    } else {
      dispUn.textContent = 'After email is set';
      dispUn.className = 'stu-kv-val pd'; dispUn.classList.add('pd');
    }
  }

  // 10. Required fields check
  var missing = [];
  if (!name) missing.push('Full Name');
  if (!regNo) missing.push('Register Number');
  if (!gender) missing.push('Gender');
  if (!deptId) missing.push('Department');
  if (!classId) missing.push('Class');
  if (!batch) missing.push('Batch');

  var reqStatus = document.getElementById('edit-req-status');
  var reqCount = document.getElementById('edit-req-count');
  var reqNames = document.getElementById('edit-req-names');

  if (missing.length > 0) {
    if (reqStatus) reqStatus.classList.remove('completed');
    if (reqCount) {
      reqCount.textContent = missing.length + ' required field' + (missing.length > 1 ? 's' : '') + ' left';
      reqCount.style.color = '#dc2626';
    }
    if (reqNames) reqNames.textContent = ' · ' + missing.join(', ');
  } else {
    if (reqStatus) reqStatus.classList.add('completed');
    if (reqCount) {
      reqCount.innerHTML = '<re-icon icon="check-circle" size="14"></re-icon> Ready to save';
      reqCount.style.color = '#16a34a';
    }
    if (reqNames) reqNames.textContent = '';
  }
}
window.updateEditStudentLivePreview = updateEditStudentLivePreview;


/** Name typed — sanitize punctuation, split first/last, refresh email if regNo decoded */
function onStuNameInput() {
  var nameEl = document.getElementById('stu-name');
  var raw = nameEl ? nameEl.value : '';
  var stripped = raw.replace(/[.,/\;:_]+/g, ' ');
  if (stripped !== raw && nameEl) {
    var cursor = nameEl.selectionStart;
    nameEl.value = stripped;
    if (cursor !== null) nameEl.setSelectionRange(cursor, cursor);
  }
  var clean = sanitizeFullName(stripped);
  var split = splitFirstLastName(clean);

  var fnEl = document.getElementById('stu-firstName');
  var lnEl = document.getElementById('stu-lastName');

  if (fnEl) fnEl.value = split.firstName || '';
  if (lnEl) lnEl.value = split.lastName || '';

  tryAutoDeriveStuEmail();
  updateAddStudentLivePreview();
}

function updateAddTeacherLivePreview() {
  var name = (getFieldValue('t-nm') || '').trim();
  var empId = (getFieldValue('t-ei') || '').trim();
  var deptSel = document.getElementById('t-dp');
  var deptId = deptSel ? deptSel.value : '';
  var dgSel = document.getElementById('t-dg');
  var desig = dgSel ? (dgSel.options && dgSel.selectedIndex >= 0 ? dgSel.options[dgSel.selectedIndex].text : dgSel.value) : '';
  var email = (getFieldValue('t-em') || '').trim();

  // 1. Avatar initials
  var avEl = document.getElementById('tch-preview-avatar');
  if (avEl) avEl.textContent = getInitials(name) || 'TC';

  // 2. Preview Name
  var nmEl = document.getElementById('tch-preview-name');
  if (nmEl) nmEl.textContent = name || 'Teacher Name';

  // 3. Preview Employee ID
  var empEl = document.getElementById('tch-preview-empid');
  if (empEl) empEl.textContent = 'Employee ID ' + (empId || '—');

  // 4. Preview Designation Chip
  var desigChip = document.getElementById('tch-preview-desig');
  if (desigChip) desigChip.textContent = desig || 'Assistant Professor';

  // 5. First name / Last name split
  var clean = sanitizeFullName(name);
  var split = splitFirstLastName(clean);
  var fnEl = document.getElementById('t-fn');
  var lnEl = document.getElementById('t-ln');
  if (fnEl) fnEl.value = split.firstName || '';
  if (lnEl) lnEl.value = split.lastName || '';

  var dispFn = document.getElementById('tch-disp-fn');
  if (dispFn) {
    if (split.firstName) {
      dispFn.textContent = split.firstName;
      dispFn.className = 'stu-kv-val';
      dispFn.classList.remove('pd');
    } else {
      dispFn.textContent = 'After name';
      dispFn.className = 'stu-kv-val pd';
      dispFn.classList.add('pd');
    }
  }

  var dispLn = document.getElementById('tch-disp-ln');
  if (dispLn) {
    if (split.lastName) {
      dispLn.textContent = split.lastName;
      dispLn.className = 'stu-kv-val';
      dispLn.classList.remove('pd');
    } else {
      dispLn.textContent = 'After name';
      dispLn.className = 'stu-kv-val pd';
      dispLn.classList.add('pd');
    }
  }

  // 6. Track ID
  var trackId = getFieldValue('t-ti') || (empId ? ('TR-' + empId.replace(/^TR-?/i, '')) : '');
  var dispTid = document.getElementById('tch-disp-tid');
  if (dispTid) {
    if (trackId) {
      dispTid.textContent = trackId;
      dispTid.className = 'stu-kv-val';
      dispTid.classList.remove('pd');
    } else {
      dispTid.textContent = 'After employee ID';
      dispTid.className = 'stu-kv-val pd';
      dispTid.classList.add('pd');
    }
  }

  // 7. Username
  var unVal = email ? email.split('@')[0].replace(/\s+/g, '').toLowerCase() : getFieldValue('t-us');
  var unInput = document.getElementById('t-us');
  if (unInput && unVal) unInput.value = unVal;

  var dispUn = document.getElementById('tch-disp-un');
  if (dispUn) {
    if (unVal) {
      dispUn.textContent = unVal;
      dispUn.className = 'stu-kv-val';
      dispUn.classList.remove('pd');
    } else {
      dispUn.textContent = 'From email';
      dispUn.className = 'stu-kv-val pd';
      dispUn.classList.add('pd');
    }
  }

  // 8. Required fields check and status hint
  var missing = [];
  if (!name) missing.push('Full name');
  if (!empId || empId === 'EMP-') missing.push('Employee ID');
  if (!deptId) missing.push('Department');
  if (!desig) missing.push('Designation');

  var statusEl = document.getElementById('tch-req-status');
  var addBtn = document.getElementById('btn-add-tch');

  if (missing.length > 0) {
    if (statusEl) {
      statusEl.textContent = 'Missing: ' + missing.join(', ');
    }
    if (addBtn) {
      addBtn.classList.remove('ready', 'p');
      addBtn.classList.add('d');
    }
  } else {
    if (statusEl) {
      statusEl.innerHTML = '<b style="color:var(--g)"><re-icon icon="check-circle" size="14"></re-icon> All required fields completed</b>';
    }
    if (addBtn) {
      addBtn.classList.remove('d');
      addBtn.classList.add('ready', 'p');
      addBtn.removeAttribute('aria-disabled');
    }
  }
}
window.updateAddTeacherLivePreview = updateAddTeacherLivePreview;

function onTchDeptChange() {
  if (typeof updateAddTeacherLivePreview === 'function') updateAddTeacherLivePreview();
}
window.onTchDeptChange = onTchDeptChange;

function onTchDesigChange() {
  if (typeof updateAddTeacherLivePreview === 'function') updateAddTeacherLivePreview();
}
window.onTchDesigChange = onTchDesigChange;

function onTchNameInput() {
  var nameEl = document.getElementById('t-nm');
  var raw = nameEl ? nameEl.value : '';
  var stripped = raw.replace(/[.,\/\\;:_]+/g, ' ');
  if (stripped !== raw && nameEl) {
    var cursor = nameEl.selectionStart;
    nameEl.value = stripped;
    if (cursor !== null) nameEl.setSelectionRange(cursor, cursor);
  }
  var clean = sanitizeFullName(stripped);
  var split = splitFirstLastName(clean);

  var fnEl = document.getElementById('t-fn');
  var lnEl = document.getElementById('t-ln');

  if (fnEl) fnEl.value = split.firstName;
  if (lnEl) lnEl.value = split.lastName;

  if (typeof updateAddTeacherLivePreview === 'function') updateAddTeacherLivePreview();
}
window.onTchNameInput = onTchNameInput;

var STUDENT_PASSWORD = 'teacher123';

// ─── ADD DEPARTMENT MODAL LIVE SYNCHRONIZATION ──────────────────────────────
function onDeptNameInput() {
  var nameEl = document.getElementById('dept-name');
  var val = (nameEl ? nameEl.value : '').trim();
  var code2El = document.getElementById('dept-2code');
  var code3El = document.getElementById('dept-code');

  if (val) {
    var words = val.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    if (code2El && (!code2El.value || code2El.dataset.autoDerived === 'true')) {
      var suggested2 = '';
      if (words.length >= 2) {
        suggested2 = (words[0][0] + words[1][0]).toLowerCase();
      } else if (words.length === 1) {
        suggested2 = words[0].substring(0, 2).toLowerCase();
      }
      code2El.value = suggested2;
      code2El.dataset.autoDerived = 'true';
    }
    if (code3El && (!code3El.value || code3El.dataset.autoDerived === 'true')) {
      var suggested3 = '';
      if (words.length >= 3) {
        suggested3 = (words[0][0] + words[1][0] + words[2][0]).toUpperCase();
      } else if (words.length === 2) {
        suggested3 = (words[0].substring(0, 2) + words[1][0]).toUpperCase();
      } else if (words.length === 1) {
        suggested3 = words[0].substring(0, 3).toUpperCase();
      }
      code3El.value = suggested3;
      code3El.dataset.autoDerived = 'true';
    }
  } else {
    if (code2El && code2El.dataset.autoDerived === 'true') {
      code2El.value = '';
    }
    if (code3El && code3El.dataset.autoDerived === 'true') {
      code3El.value = '';
    }
  }
  updateAddDeptLivePreview();
}
window.onDeptNameInput = onDeptNameInput;

function onDeptCourseTypeChange() {
  if (typeof updateBranch === 'function') {
    updateBranch();
  }
  updateAddDeptLivePreview();
}
window.onDeptCourseTypeChange = onDeptCourseTypeChange;

function updateAddDeptLivePreview() {
  var name = (getFieldValue('dept-name') || '').trim();
  var catEl = document.getElementById('dept-category');
  var category = catEl ? catEl.value : 'programme';
  var categoryLabel = category === 'supporting' ? 'Supporting Departments' : 'Programme Departments';
  var twoCode = (getFieldValue('dept-2code') || '').trim().toLowerCase();
  var threeCode = (getFieldValue('dept-code') || '').trim().toUpperCase();
  var number = (getFieldValue('dept-number') || '').trim();
  var coTypeEl = document.getElementById('co-type');
  var courseType = coTypeEl ? coTypeEl.value : '';
  var brEl = document.getElementById('branch');
  var branch = brEl ? brEl.value : '';

  // 1. Preview Avatar
  var avEl = document.getElementById('dept-preview-avatar');
  if (avEl) {
    if (twoCode) {
      avEl.textContent = twoCode.substring(0, 2).toUpperCase();
    } else if (name) {
      var words = name.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
      if (words.length >= 2) {
        avEl.textContent = (words[0][0] + words[1][0]).toUpperCase();
      } else {
        avEl.textContent = name.substring(0, 2).toUpperCase();
      }
    } else {
      avEl.textContent = 'DP';
    }
  }

  // 2. Preview Name
  var nmEl = document.getElementById('dept-preview-name');
  if (nmEl) nmEl.textContent = name || 'Department Name';

  // 3. Preview Category
  var catP = document.getElementById('dept-preview-category');
  if (catP) catP.textContent = categoryLabel;

  // 4. Preview Code Chip
  var chpEl = document.getElementById('dept-preview-code');
  if (chpEl) chpEl.textContent = threeCode || 'CODE';

  // 5. Auto-filled rows
  var d2El = document.getElementById('dept-disp-2code');
  if (d2El) {
    if (twoCode) {
      d2El.textContent = twoCode.toLowerCase();
      d2El.className = 'dept-kv-val';
    } else {
      d2El.textContent = 'Pending';
      d2El.className = 'pd dept-kv-val';
    }
  }

  var d3El = document.getElementById('dept-disp-code');
  if (d3El) {
    if (threeCode) {
      d3El.textContent = threeCode;
      d3El.className = 'dept-kv-val';
    } else {
      d3El.textContent = 'Pending';
      d3El.className = 'pd dept-kv-val';
    }
  }

  var dNumEl = document.getElementById('dept-disp-number');
  if (dNumEl) {
    if (number) {
      dNumEl.textContent = number;
      dNumEl.className = 'dept-kv-val';
    } else {
      dNumEl.textContent = 'Pending';
      dNumEl.className = 'pd dept-kv-val';
    }
  }

  var dCtEl = document.getElementById('dept-disp-coursetype');
  if (dCtEl) {
    if (courseType) {
      dCtEl.textContent = courseType;
      dCtEl.className = 'dept-kv-val';
    } else {
      dCtEl.textContent = 'Pending';
      dCtEl.className = 'pd dept-kv-val';
    }
  }

  var dBrEl = document.getElementById('dept-disp-branch');
  if (dBrEl) {
    if (branch) {
      dBrEl.textContent = branch;
      dBrEl.className = 'dept-kv-val';
    } else if (!courseType) {
      dBrEl.textContent = 'After course type';
      dBrEl.className = 'pd dept-kv-val';
    } else {
      dBrEl.textContent = 'Pending';
      dBrEl.className = 'pd dept-kv-val';
    }
  }

  // 6. Branch dropdown disabled styling & auto-population
  if (brEl) {
    if (!courseType) {
      brEl.disabled = true;
      brEl.classList.add('dis');
      if (!brEl.options || brEl.options.length <= 1) {
        brEl.innerHTML = '<option value="">— Select Course Type First —</option>';
      }
    } else {
      brEl.disabled = false;
      brEl.classList.remove('dis');
      if (!brEl.options || brEl.options.length <= 1 || (brEl.options[0] && brEl.options[0].textContent.includes('First'))) {
        if (typeof updateBranch === 'function') {
          updateBranch();
        }
      }
    }
  }

  // 7. Required fields validation and status hint
  var missing = [];
  if (!name) missing.push('Department name');
  if (!twoCode) missing.push('2-letter code');
  if (!threeCode) missing.push('3-letter code');
  if (!number || !/^\d{3}$/.test(number)) missing.push('Department code');
  if (!courseType) missing.push('Course type');
  if (!branch) missing.push('Branch');

  var cntEl = document.getElementById('dept-req-count');
  var nmsEl = document.getElementById('dept-req-names');
  var btn = document.getElementById('btn-add-dept');

  if (missing.length === 0) {
    if (cntEl) cntEl.textContent = 'All required fields completed';
    if (nmsEl) nmsEl.textContent = '';
    if (btn) {
      btn.classList.add('ready', 'p');
      btn.classList.remove('d');
      btn.setAttribute('aria-disabled', 'false');
    }
  } else {
    if (cntEl) cntEl.textContent = missing.length + ' required field' + (missing.length > 1 ? 's' : '') + ' left';
    if (nmsEl) nmsEl.textContent = ' · ' + missing.join(', ');
    if (btn) {
      btn.classList.remove('ready', 'p');
      btn.classList.add('d');
      btn.setAttribute('aria-disabled', 'true');
    }
  }
}
window.updateAddDeptLivePreview = updateAddDeptLivePreview;

// ─── RESET / CLEAR HELPERS ───────────────────────────────────────────────────
function resetDeptForm() {
  clearInputs(['dept-name', 'dept-2code', 'dept-code', 'dept-number']);
  var c2 = document.getElementById('dept-2code'); if (c2) delete c2.dataset.autoDerived;
  var c3 = document.getElementById('dept-code'); if (c3) delete c3.dataset.autoDerived;
  var catEl = document.getElementById('dept-category');
  if (catEl) catEl.value = (_deptCategoryFilter === 'supporting' || _deptCategoryFilter === 'programme') ? _deptCategoryFilter : 'programme';
  var coEl = document.getElementById('co-type'); if (coEl) coEl.value = '';
  var brEl = document.getElementById('branch');
  if (brEl) {
    brEl.innerHTML = '<option value="">— Select Course Type First —</option>';
    brEl.disabled = true;
    brEl.classList.add('dis');
  }
  if (typeof updateAddDeptLivePreview === 'function') updateAddDeptLivePreview();
}

function resetTeacherForm() {
  clearInputs(['t-nm', 't-fn', 't-ln', 't-us', 't-em']);

  prepareAddTeacherForm(true);

  var password = STUDENT_PASSWORD;
  var pwEl = document.getElementById('t-pw'); if (pwEl) pwEl.value = password;
  var dpEl = document.getElementById('t-dp');
  if (isCurrentUserSuperAdmin()) {
    var dInfo = getCurrentUserDeptInfo();
    var myDeptId = dInfo.id;
    if (!myDeptId) {
      var found = (DB.get('depts') || []).find(function (d) { return d.name === dInfo.name; });
      if (found) myDeptId = found._id;
    }
    if (dpEl) {
      dpEl.value = myDeptId || '';
      dpEl.disabled = true;
      dpEl.style.cursor = 'not-allowed';
    }
  } else {
    if (dpEl) {
      dpEl.value = '';
      dpEl.disabled = false;
      dpEl.style.cursor = '';
    }
  }
  var dgEl = document.getElementById('t-dg'); if (dgEl) dgEl.selectedIndex = 0;
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('t-dp');
    SearchableDropdown.sync('t-dg');
  }
  if (typeof updateAddTeacherLivePreview === 'function') {
    updateAddTeacherLivePreview();
  }
}

function resetStudentForm() {
  clearInputs(['stu-name', 'stu-firstName', 'stu-lastName', 'stu-rollNo', 'stu-courseType', 'stu-branch', 'stu-trackId', 'stu-email', 'stu-username']);
  var rnEl = document.getElementById('stu-regNo'); if (rnEl) rnEl.value = '7140';
  var rollEl = document.getElementById('stu-rollNo'); if (rollEl) rollEl.value = '';
  var pwEl = document.getElementById('stu-password'); if (pwEl) pwEl.value = '';
  var sfRes = document.getElementById('sf-residency');
  var defaultRes = (sfRes && sfRes.value) ? sfRes.value : 'dayscholar';
  var resEl = document.getElementById('stu-residency'); if (resEl) resEl.value = (defaultRes === 'hostel' || defaultRes === 'hosteller') ? 'hostel' : 'dayscholar';
  var genEl = document.getElementById('stu-gender'); if (genEl) genEl.value = 'Male';
  var sfAdm = document.getElementById('sf-admission-type');
  var defaultAdm = (sfAdm && sfAdm.value) ? (sfAdm.value.toLowerCase().includes('lateral') ? 'Lateral Entry' : 'Regular') : 'Regular';
  var admEl = document.getElementById('stu-admission-type'); if (admEl) admEl.value = defaultAdm;
  var dpEl = document.getElementById('stu-dept');
  if (isCurrentUserSuperAdmin()) {
    var dInfo = getCurrentUserDeptInfo();
    var myDeptId = dInfo.id;
    if (!myDeptId) {
      var found = (DB.get('depts') || []).find(function (d) { return d.name === dInfo.name; });
      if (found) myDeptId = found._id;
    }
    if (dpEl) {
      dpEl.value = myDeptId || '';
      dpEl.disabled = true;
      dpEl.style.cursor = 'not-allowed';
    }
    onStuDeptChange();
  } else {
    if (dpEl) {
      dpEl.value = '';
      dpEl.disabled = false;
      dpEl.style.cursor = '';
    }
    updateStuClassList();
  updateAddStudentLivePreview();
  }
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('stu-dept');
    SearchableDropdown.sync('stu-class');
  }
  hideStuEmailPopup();
  _stuEmailVerified = true;
  _stuEmailBeforeNo = '';
  _setStuAddBtn(true);

  setStuGender('Male');
  setStuAdmissionType('Regular');
  setStuResidency('dayscholar');
  var pwEl = document.getElementById('stu-password');
  if (pwEl) pwEl.value = 'student123';
  updateAddStudentLivePreview();
}

// ─── TEACHERS PAGE — GLOBAL STATE ────────────────────────────────────────
var _teacherData = [];
var _teacherSearchQuery = '';
var _teacherDesigFilter = '';
var _teacherRoleFilter = 'all'; // 'all' | 'hod'
var _teacherViewMode = 'grid';  // 'grid' | 'table'
var _teacherSortBy = '';        // '' | 'name' | 'empId'
var _teacherSortDir = 'asc';

// ─── TEACHERS PAGE — NEW FUNCTIONS ──────────────────────────────────────
function populateTeacherDeptDropdown() {
  var deptFilter = document.getElementById('tf-dept');
  if (!deptFilter) return;
  if (isCurrentUserSuperAdmin()) {
    var dInfo = getCurrentUserDeptInfo();
    var myDeptId = dInfo.id;
    var myDeptName = dInfo.name;
    if (!myDeptId) {
      var found = (DB.get('depts') || []).find(function (d) {
        return d.name && myDeptName && d.name.toLowerCase().trim() === myDeptName.toLowerCase().trim();
      });
      if (found) myDeptId = found._id || found.id;
    }
    var myDeptCode = (dInfo && (dInfo.code || dInfo.threeLetterCode)) || '';
    if (!myDeptCode && myDeptName) {
      myDeptCode = (typeof SearchableDropdown !== 'undefined' && SearchableDropdown.normalizeDeptCode)
        ? SearchableDropdown.normalizeDeptCode(myDeptName) : '';
    }
    if (myDeptName && myDeptName.toLowerCase().includes('mathematics')) myDeptCode = 'MAT';
    deptFilter.innerHTML = '<option value="' + (myDeptId || '') + '" data-badge="' + escapeHtml(myDeptCode || '') + '">' + escapeHtml(myDeptName || 'My Department') + '</option>';
    deptFilter.value = myDeptId || '';
    deptFilter.disabled = true;
    deptFilter.style.cursor = 'not-allowed';

    var expBtn = document.querySelector('button[onclick*="exportTeachersXlsx"]');
    if (expBtn) expBtn.style.display = 'none';
  } else {
    var depts = Array.isArray(DB.get('depts')) ? DB.get('depts') : [];
    deptFilter.innerHTML = '<option value="">All Departments</option>'
      + depts.map(function (d) {
          var code = d.code || d.threeLetterCode || '';
          if (!code && d.name) {
            code = (typeof SearchableDropdown !== 'undefined' && SearchableDropdown.normalizeDeptCode)
              ? SearchableDropdown.normalizeDeptCode(d.name) : '';
          }
          if (d.name && d.name.toLowerCase().includes('mathematics')) code = 'MAT';
          return '<option value="' + d._id + '" data-badge="' + escapeHtml(code || '') + '">' + escapeHtml(d.name) + '</option>';
        }).join('');
    deptFilter.value = '';
    deptFilter.disabled = false;
    deptFilter.style.cursor = '';
  }
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('tf-dept');
  }
}

function onTeacherDeptChange() {
  var dept = document.getElementById('tf-dept') ? document.getElementById('tf-dept').value : '';
  var grid = document.getElementById('tgr');
  if (!grid) return;
  grid.className = 'tgrd';
  grid.innerHTML = '<div class="emst"><span class="emico" style="font-size:28px;"><re-icon icon="hourglass"></re-icon></span><div class="emtx">Loading teachers…</div></div>';
  var params = dept ? '?deptId=' + encodeURIComponent(dept) : '';
  apiCall('GET', '/teachers' + params)
    .then(function (list) {
      _teacherData = Array.isArray(list) ? list : [];
      _teacherSearchQuery = '';
      var qEl = document.getElementById('tf-q'); if (qEl) qEl.value = '';
      _renderTeacherGrid(_teacherData);
    })
    .catch(function () {
      grid.innerHTML = '<div class="emst"><span class="emico"><re-icon icon="teacher"></re-icon></span><div class="emtx">Failed to load teachers. Try again.</div></div>';
    });
}

// Build the small colored role/admin badges shared by the card grid and the table view
function _teacherRoleBadges(teacher) {
  if (!teacher) return '';
  var badges = '';

  // 1. Executive academic / administrative roles
  if (teacher.isPrincipal) {
    badges += '<span class="t-role-badge principal" title="Principal"><re-icon icon="award" size="10"></re-icon> Principal</span>';
  }
  var isHod = Boolean(teacher.isHOD || teacher.isHod
    || (Array.isArray(teacher.specials) && teacher.specials.some(function (s) { return s && s.option === 'isHod'; }))
    || (Array.isArray(teacher.roles) && teacher.roles.includes('hod')));

  if (isHod) {
    badges += '<span class="t-role-badge hod" title="Head of Department"><re-icon icon="crown" size="10"></re-icon> HOD</span>';
  }
  if (teacher.isTimeTableCoordinator) {
    badges += '<span class="t-role-badge ttcoord" title="Timetable Coordinator"><re-icon icon="calendar" size="10"></re-icon> TT Coord</span>';
  }

  // 2. 3-Tier Administration: Sudo Admin, Super Admin, Sub-Admin
  var isSudo = !!teacher.isSudoAdmin || teacher.adminTier === 'sudo' || teacher.role === 'sudo'
    || (teacher.pageRights && teacher.pageRights.accessRole === 'sudoAdmin')
    || (Array.isArray(teacher.pageRights) && teacher.pageRights.some(function (p) { return p && p.enabled !== false && p.accessRole === 'sudoAdmin'; }));

  var isSuper = !isSudo && (!!teacher.isSuperAdmin || teacher.adminTier === 'super'
    || (teacher.pageRights && teacher.pageRights.accessRole === 'superAdmin')
    || (Array.isArray(teacher.pageRights) && teacher.pageRights.some(function (p) { return p && p.enabled !== false && p.accessRole === 'superAdmin'; })));

  var isSub = !isSudo && !isSuper && (!!teacher.isSubAdmin || teacher.adminTier === 'sub'
    || (teacher.pageRights && teacher.pageRights.accessRole === 'subAdmin')
    || (teacher.pageRights && Array.isArray(teacher.pageRights.grants) && teacher.pageRights.grants.some(function (g) { return g && g.enabled !== false; }))
    || (Array.isArray(teacher.pageRights) && teacher.pageRights.some(function (p) { return p && p.enabled !== false; })));

  var hasGeneralAdmin = !isSudo && !isSuper && !isSub && (!!teacher.isAdmin || (Array.isArray(teacher.specials) && teacher.specials.some(function (s) { return s && s.option === 'isAdmin'; })));

  if (isSudo) {
    badges += '<span class="t-role-badge sudo-admin" title="Institution-wide Sudo Administrator"><re-icon icon="shield-lock" size="10"></re-icon> Sudo Admin</span>';
  } else if (isSuper) {
    badges += '<span class="t-role-badge super-admin" title="Department Super Administrator"><re-icon icon="shield-halved" size="10"></re-icon> Super Admin</span>';
  } else if (isSub) {
    badges += '<span class="t-role-badge sub-admin" title="Department Sub-Administrator"><re-icon icon="shield" size="10"></re-icon> Sub-Admin</span>';
  } else if (hasGeneralAdmin) {
    var nameLower = ((teacher.name || '') + ' ' + (teacher.desig || '') + ' ' + (teacher.username || '')).toLowerCase();
    if (nameLower.indexOf('system admin') !== -1 || teacher.username === 'admin' || !teacher.deptId) {
      badges += '<span class="t-role-badge sudo-admin" title="System Administrator (Sudo Admin)"><re-icon icon="shield-lock" size="10"></re-icon> Sudo Admin</span>';
    } else {
      badges += '<span class="t-role-badge super-admin" title="Super Administrator"><re-icon icon="shield-halved" size="10"></re-icon> Super Admin</span>';
    }
  }

  return badges;
}

// Determines the card/row role modifier class: is-sudo-admin (Violet), is-super-admin (Red), or is-hod (Orange)
function _getTeacherCardRoleClass(teacher) {
  if (!teacher) return '';

  var isSudo = !!teacher.isSudoAdmin || teacher.adminTier === 'sudo' || teacher.role === 'sudo'
    || (teacher.pageRights && teacher.pageRights.accessRole === 'sudoAdmin')
    || (Array.isArray(teacher.pageRights) && teacher.pageRights.some(function (p) { return p && p.enabled !== false && p.accessRole === 'sudoAdmin'; }));

  var isSuper = !isSudo && (!!teacher.isSuperAdmin || teacher.adminTier === 'super'
    || (teacher.pageRights && teacher.pageRights.accessRole === 'superAdmin')
    || (Array.isArray(teacher.pageRights) && teacher.pageRights.some(function (p) { return p && p.enabled !== false && p.accessRole === 'superAdmin'; })));

  var hasGeneralAdmin = !isSudo && !isSuper && (!!teacher.isAdmin || (Array.isArray(teacher.specials) && teacher.specials.some(function (s) { return s && s.option === 'isAdmin'; })));

  if (hasGeneralAdmin) {
    var nameLower = ((teacher.name || '') + ' ' + (teacher.desig || '') + ' ' + (teacher.username || '')).toLowerCase();
    if (nameLower.indexOf('system admin') !== -1 || teacher.username === 'admin' || !teacher.deptId) {
      isSudo = true;
    } else {
      isSuper = true;
    }
  }

  var isHod = Boolean(teacher.isHOD || teacher.isHod
    || (Array.isArray(teacher.specials) && teacher.specials.some(function (s) { return s && s.option === 'isHod'; }))
    || (Array.isArray(teacher.roles) && teacher.roles.includes('hod')));

  if (isSudo) return ' k-pu is-sudo-admin';
  if (isSuper) return ' k-rd is-super-admin';
  if (isHod) return ' k-or is-hod';
  return '';
}

function _getTeacherCardTag(teacher) {
  if (!teacher) return '';

  // Order of prominence matching design reference:
  // Principal (amber), Sudo Admin (purple), Super Admin (red), Sub-Admin (purple), HOD (orange), TT Coord (purple)
  if (teacher.isPrincipal) {
    return '<span class="tag am"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.7 6.7 19.6l1.1-6L3.4 9.4l6-.8z"></path></svg> Principal</span>';
  }

  var isSudo = !!teacher.isSudoAdmin || teacher.adminTier === 'sudo' || teacher.role === 'sudo'
    || (teacher.pageRights && teacher.pageRights.accessRole === 'sudoAdmin')
    || (Array.isArray(teacher.pageRights) && teacher.pageRights.some(function (p) { return p && p.enabled !== false && p.accessRole === 'sudoAdmin'; }));

  var isSuper = !isSudo && (!!teacher.isSuperAdmin || teacher.adminTier === 'super'
    || (teacher.pageRights && teacher.pageRights.accessRole === 'superAdmin')
    || (Array.isArray(teacher.pageRights) && teacher.pageRights.some(function (p) { return p && p.enabled !== false && p.accessRole === 'superAdmin'; })));

  var isSub = !isSudo && !isSuper && (!!teacher.isSubAdmin || teacher.adminTier === 'sub'
    || (teacher.pageRights && teacher.pageRights.accessRole === 'subAdmin')
    || (Array.isArray(teacher.pageRights) && teacher.pageRights.some(function (p) { return p && p.enabled !== false; })));

  var hasGeneralAdmin = !isSudo && !isSuper && !isSub && (!!teacher.isAdmin || (Array.isArray(teacher.specials) && teacher.specials.some(function (s) { return s && s.option === 'isAdmin'; })));
  if (hasGeneralAdmin) {
    var nameLower = ((teacher.name || '') + ' ' + (teacher.desig || '') + ' ' + (teacher.username || '')).toLowerCase();
    if (nameLower.indexOf('system admin') !== -1 || teacher.username === 'admin' || !teacher.deptId) {
      isSudo = true;
    } else {
      isSuper = true;
    }
  }

  if (isSudo) {
    return '<span class="tag pu"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"></path></svg> Sudo Admin</span>';
  }

  if (isSuper) {
    return '<span class="tag rd"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"></path></svg> Super Admin</span>';
  }

  var isHod = Boolean(teacher.isHOD || teacher.isHod
    || (Array.isArray(teacher.specials) && teacher.specials.some(function (s) { return s && s.option === 'isHod'; }))
    || (Array.isArray(teacher.roles) && teacher.roles.includes('hod')));

  if (isHod) {
    return '<span class="tag or"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"></path></svg> HOD</span>';
  }

  if (teacher.isTimeTableCoordinator) {
    return '<span class="tag pu"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M4 10h16M9 3v4M15 3v4"></path></svg> TT Coord</span>';
  }

  if (isSub) {
    return '<span class="tag pu"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"></path></svg> Sub-Admin</span>';
  }

  return '';
}

// Applies search + designation filters, then sorting (table columns only)
function _getFilteredTeachers(data) {
  var query = _teacherSearchQuery;
  var desig = _teacherDesigFilter;
  var display = (data || []).filter(function (t) {
    if (query) {
      var hit = (t.name || '').toLowerCase().indexOf(query) !== -1
        || (t.empId || '').toLowerCase().indexOf(query) !== -1
        || (t.dept || '').toLowerCase().indexOf(query) !== -1
        || (t.email || '').toLowerCase().indexOf(query) !== -1;
      if (!hit) return false;
    }
    if (desig && t.desig !== desig) return false;
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
  var hods = list.filter(function (t) {
    return Boolean(t.isHOD || t.isHod || (Array.isArray(t.specials) && t.specials.some(function (s) { return s && s.option === 'isHod'; })) || (Array.isArray(t.roles) && t.roles.includes('hod')));
  }).length;
  var deptSet = {};
  list.forEach(function (t) { if (t.dept) deptSet[t.dept] = true; });
  var deptCount = Object.keys(deptSet).length;
  var adminCount = list.filter(function (t) {
    return !!t.isSudoAdmin || !!t.isSuperAdmin || !!t.isSubAdmin || (Array.isArray(t.pageRights) && t.pageRights.some(function (p) { return p && p.enabled !== false; })) || (Array.isArray(t.specials) && t.specials.some(function (s) { return s && s.option === 'isAdmin'; }));
  }).length;

  var cards = [
    { label: 'Total Teachers', val: total, icon: '<re-icon icon="teacher"></re-icon>', cls: 'green', id: 't-stat-teachers' },
    { label: 'HODs', val: hods, icon: '<re-icon icon="crown"></re-icon>', cls: 'orange', id: 't-stat-hods' },
    { label: 'Departments', val: deptCount, icon: '<re-icon icon="building2"></re-icon>', cls: 'amber', id: 't-stat-depts' },
    { label: 'With Admin Rights', val: adminCount, icon: '<re-icon icon="shield-lock"></re-icon>', cls: 'purple', id: 't-stat-admin' }
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
  var hasActiveFilters = !!(_teacherSearchQuery || _teacherDesigFilter);

  grid.className = 'tgrd';
  if (!display.length) {
    var deptVal = document.getElementById('tf-dept') ? document.getElementById('tf-dept').value : '';
    var emptyMsg = hasActiveFilters ? 'No teachers match the current filters.' : (deptVal ? 'No teachers found in this department.' : 'No teachers found.');
    grid.innerHTML = '<div class="emst"><span class="emico"><re-icon icon="teacher"></re-icon></span>'
      + '<div class="emtx">' + emptyMsg + '</div>'
      + '<div style="margin-top:10px;font-size:12px;color:var(--tdi);">Add a teacher using the button above.</div></div>';
  } else {
    var assignments = Array.isArray(DB.get('assignments')) ? DB.get('assignments') : [];
    grid.innerHTML = display.map(function (teacher) {
      var assignmentCount = assignments.filter(function (a) { return a.teacherId === teacher._id; }).length;
      var nameInitial = ((teacher.name || '')[0] || 'T').toUpperCase();
      var tid = teacher._id;
      var isActive = teacher.status ? teacher.status === 'active' : (teacher.active !== false);
      var roleTag = _getTeacherCardTag(teacher);
      var cleanEmail = (teacher.email || '').replace(/\s+/g, '');
      var roleClass = _getTeacherCardRoleClass(teacher);
      var empId = teacher.empId || teacher.trackId || 'TEACHER';
      var deptName = teacher.dept || teacher.department || 'Faculty';
      var isSpecialDept = /\b(math|mathematics|science|physics|chemistry|humanities)\b/i.test(deptName);
      var deptClass = isSpecialDept ? 'ln sp' : 'ln pg';

      return '<article class="tcrd teacher-card tc' + roleClass + '" onclick="openTD(\'' + tid + '\')">'
        + '<div class="r1">'
        + roleTag
        + '<span class="em" title="Employee ID">' + escapeHtml(empId) + '</span>'
        + '</div>'
        + '<div class="r2">'
        + '<span class="avw">'
        + '<i class="av" style="font-style:normal">' + nameInitial + '</i>'
        + '<i class="dot' + (isActive ? '' : ' inactive') + '" title="' + (isActive ? 'Active' : 'Inactive') + '"></i>'
        + '</span>'
        + '<span class="nm">'
        + '<h3 title="' + escapeHtml(teacher.name || '') + '">' + escapeHtml(teacher.name || '—') + '</h3>'
        + '<p title="' + escapeHtml(teacher.desig || '') + '">' + escapeHtml(teacher.desig || 'Faculty') + '</p>'
        + '</span>'
        + '</div>'
        + '<div class="r3">'
        + '<span class="' + deptClass + '" title="' + escapeHtml(deptName) + '">'
        + '<i><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V5l8-3v19M12 9h8v12M2 21h20M8 8h1M8 12h1M8 16h1"></path></svg></i>'
        + '<span>' + escapeHtml(deptName) + '</span>'
        + '</span>'
        + '<span class="ln" title="' + escapeHtml(cleanEmail || 'No email registered') + '">'
        + '<i><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 7l9 6 9-6"></path></svg></i>'
        + '<span>' + escapeHtml(cleanEmail || 'No email registered') + '</span>'
        + '</span>'
        + '</div>'
        + '<div class="st2">'
        + '<span>Subjects<b>' + assignmentCount + '</b></span>'
        + '<span>Status<em class="' + (isActive ? 'active' : 'inactive') + '">' + (isActive ? 'Active' : 'Inactive') + '</em></span>'
        + '</div>'
        + '<button class="vb" type="button" onclick="event.stopPropagation();openTD(\'' + tid + '\')" title="View / Edit teacher">'
        + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg> View / Edit'
        + '</button>'
        + '</article>';
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
    var cleanEmail = (teacher.email || '').replace(/\s+/g, '');
    return '<tr>'
      + '<td>' + (i + 1) + '</td>'
      + '<td class="b">' + (teacher.name || '—') + '</td>'
      + '<td>' + (teacher.empId || '—') + '</td>'
      + '<td>' + (teacher.dept || '—') + '</td>'
      + '<td>' + (teacher.desig || '—') + '</td>'
      + '<td class="t-email-cell" title="' + cleanEmail + '">' + (cleanEmail || '—') + '</td>'
      + '<td>' + badges + '</td>'
      + '<td>' + assignmentCount + '</td>'
      + '<td>'
      + '<button class="btn bout bxs" onclick="event.stopPropagation();openTD(\'' + tid + '\')" title="View / Edit"><re-icon icon="edit"></re-icon></button> '
      + (isCurrentUserSuperAdmin() ? '' : ('<button class="btn bdan bxs" onclick="event.stopPropagation();_confirmDeleteTeacher(\'' + tid + '\',\'' + safeName + '\',false)" title="Delete"><re-icon icon="trash2"></re-icon></button>'))
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

// Role filter (kept for backward compatibility)
function filterTeachersByRole(role) {
  _teacherRoleFilter = role || 'all';
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
    if (t.isSudoAdmin || t.isSuperAdmin || t.isSubAdmin || (Array.isArray(t.pageRights) && t.pageRights.some(function (p) { return p && p.enabled !== false; })) || (Array.isArray(t.specials) && t.specials.some(function (s) { return s && s.option === 'isAdmin'; }))) roles.push('Admin');
    return [i + 1, t.name || '', t.empId || '', t.dept || '', t.desig || '', t.email || '', roles.join(', ') || '—', subjectCount];
  });
  var allData = [headers].concat(rows);
  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet(allData);
  XLSX.book_append_sheet(wb, ws, 'Teachers');
  var fileName = 'Teachers_' + todayIST();
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
    grid.innerHTML = '<div class="emst"><span class="emico" style="font-size:28px;"><re-icon icon="hourglass"></re-icon></span><div class="emtx">Loading teachers…</div></div>';
    _refreshTeacherList();
  }
}

function filterTeachersLive(query) {
  _teacherSearchQuery = (query || '').toLowerCase();
  _renderTeacherGrid(_teacherData);
}

// ─── UNIFIED TEACHER MANAGEMENT MODULE (Profile & Stats, Teaching Allocations, Edit Profile) ───
function _updateTeacherUnifiedModalHeader(teacher) {
  var titleEl = document.getElementById('td-ttl');
  var subEl = document.getElementById('td-sub');
  if (!teacher) return;

  var tName = teacher.name || teacher.fullName || 'Faculty Member';
  var tDesig = teacher.desig || teacher.designation || 'Assistant Professor';
  var tDept = teacher.dept || teacher.department || 'Faculty Department';
  var tEmpId = teacher.empId || teacher.employeeNo || 'FACULTY';
  var tEmail = (teacher.email || '').replace(/\s+/g, '');

  if (titleEl) {
    titleEl.innerHTML = '<re-icon icon="teacher" size="20" style="flex-shrink:0;color:var(--gD);"></re-icon>'
      + '<span style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;font-family:\'Poppins\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-weight:700;">'
      + escapeHtml(tName)
      + '<span style="font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:6px;background:var(--gLt);color:var(--gD);letter-spacing:0.3px;">' + escapeHtml(tEmpId) + '</span>'
      + '</span>';
  }

  if (subEl) {
    var line2Parts = [
      escapeHtml(tDesig),
      escapeHtml(tDept),
      escapeHtml(tEmail || 'No email registered')
    ];
    subEl.innerHTML = '<span style="font-family:\'Poppins\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-size:12px;font-weight:500;color:var(--tmu);line-height:1.35;display:inline-block;margin-top:2px;">'
      + line2Parts.join(' \u00b7 ')
      + '</span>';
  }

  var nmOld = document.getElementById('td-nm');
  if (nmOld) nmOld.textContent = tName;
  var dpOld = document.getElementById('td-dp');
  if (dpOld) dpOld.textContent = tDesig + ' · ' + tDept + ' · ' + tEmpId;
}

function switchTeacherTab(tabName) {
  var tabs = ['overview', 'allocations', 'edit'];
  tabs.forEach(function (t) {
    var btn = document.getElementById('tm-tab-btn-' + t);
    var panel = document.getElementById('tm-panel-' + t);
    if (btn) btn.classList.toggle('act', t === tabName);
    if (panel) panel.style.display = (t === tabName ? 'block' : 'none');
  });
}
window.switchTeacherTab = switchTeacherTab;

function _populateEditTeacherForm(teacher) {
  if (!teacher) return;
  var tName = teacher.name || teacher.fullName || '';
  var tDesig = teacher.desig || teacher.designation || 'Assistant Professor';
  var tDept = teacher.dept || teacher.department || '';
  var tEmpId = teacher.empId || teacher.employeeNo || '';
  var tUsername = (teacher.username || '').replace(/\s+/g, '');
  var tEmail = (teacher.email || '').replace(/\s+/g, '');

  var editNmEl = document.getElementById('td-edit-nm');
  if (editNmEl) editNmEl.value = tName;
  var editEiEl = document.getElementById('td-edit-ei');
  if (editEiEl) editEiEl.value = tEmpId;
  var editEmEl = document.getElementById('td-edit-em');
  if (editEmEl) editEmEl.value = tEmail;
  var editUsEl = document.getElementById('td-edit-us');
  if (editUsEl) editUsEl.value = tUsername;
  var editPwEl = document.getElementById('td-edit-pw');
  if (editPwEl) editPwEl.value = '';

  var depts = Array.isArray(DB.get('depts')) ? DB.get('depts') : [];
  var teacherDeptId = teacher.deptId ? (typeof teacher.deptId === 'object' && teacher.deptId._id ? teacher.deptId._id : teacher.deptId) : '';
  var deptSelectEl = document.getElementById('td-edit-dept');
  if (deptSelectEl) {
    if (isCurrentUserSuperAdmin()) {
      var dInfo = getCurrentUserDeptInfo();
      var myDeptId = dInfo.id || teacherDeptId;
      var myDeptName = dInfo.name || tDept;
      deptSelectEl.innerHTML = '<option value="' + (myDeptId || '') + '">' + escapeHtml(myDeptName || 'My Department') + '</option>';
      deptSelectEl.value = myDeptId || '';
      deptSelectEl.disabled = true;
      deptSelectEl.style.cursor = 'not-allowed';
    } else {
      deptSelectEl.innerHTML = '<option value="">— Select —</option>' + depts.map(function (d) {
        var selected = (String(d._id) === String(teacherDeptId) || (tDept && (d.name === tDept || d.code === tDept))) ? ' selected' : '';
        return '<option value="' + d._id + '"' + selected + '>' + d.name + '</option>';
      }).join('');
      deptSelectEl.disabled = false;
      deptSelectEl.style.cursor = '';
    }
  }

  var desigEl = document.getElementById('td-edit-dg');
  if (desigEl) {
    var hasOption = desigEl.options ? Array.from(desigEl.options).some(function (o) { return o.value === tDesig; }) : false;
    if (!hasOption && tDesig && desigEl.appendChild) {
      var opt = document.createElement('option');
      opt.value = tDesig;
      opt.textContent = tDesig;
      desigEl.appendChild(opt);
    }
    desigEl.value = tDesig || 'Assistant Professor';
  }

  var delEl = document.getElementById('td-del');
  var tid = teacher._id || teacher.roleDocId || teacher.trackId;
  if (delEl) {
    delEl.onclick = function () {
      _confirmDeleteTeacher(tid, tName, true);
    };
  }
}

function _renderTeacherUnifiedOverview(teacher, assignments) {
  var container = document.getElementById('td-overview-content');
  if (!container || !teacher) return;

  var tid = teacher._id || teacher.roleDocId || teacher.trackId;
  var teacherAssignments = Array.isArray(assignments) ? assignments : [];

  // Update badge counter
  var allocBadge = document.getElementById('tm-badge-alloc');
  if (allocBadge) allocBadge.textContent = teacherAssignments.length;

  // Distinct classes and subjects
  var uniqueClasses = [];
  var uniqueSubjects = [];
  var totalCredits = 0;

  teacherAssignments.forEach(function (a) {
    var cName = (a.className || '').trim();
    if (cName && !uniqueClasses.includes(cName)) uniqueClasses.push(cName);
    var sName = (a.subjectName || '').trim();
    if (sName && !uniqueSubjects.includes(sName)) uniqueSubjects.push(sName);

    var subj = (DB.get('subjects') || []).find(function (s) { return String(s._id) === String(a.subjectId); });
    if (subj && subj.credits != null) totalCredits += Number(subj.credits) || 0;
    else totalCredits += 3;
  });

  // Check if Class Advisor for any sections
  var allCls = DB.get('classes') || [];
  var advisorClasses = allCls.filter(function (c) {
    return String(c.advisorTeacherId) === String(teacher._id) ||
      String(c.advisorTeacherTrackId) === String(teacher.trackId) ||
      (teacher.name && c.advisorTeacherName && c.advisorTeacherName.trim().toLowerCase() === teacher.name.trim().toLowerCase());
  });

  var roleText = teacher.desig || teacher.designation || 'Faculty Member';
  var advisorBadgeHtml = advisorClasses.length
    ? '<span class="subj-type-badge lab" style="font-size:13px;padding:3px 10px;">Class Advisor (' + advisorClasses.length + ')</span>'
    : '<span class="subj-type-badge theory" style="font-size:13px;padding:3px 10px;">' + escapeHtml(roleText) + '</span>';

  // Assignments card markup
  var assignmentsHtml = '';
  if (teacherAssignments.length > 0) {
    assignmentsHtml = '<div class="subj-asgn-grid">' + teacherAssignments.map(function (a) {
      var hall = a.hallNo ? 'Hall ' + a.hallNo : 'Hall Unassigned';
      return '<div class="subj-asgn-card">'
        + '<div class="subj-asgn-left">'
        + '  <div class="subj-asgn-cls"><re-icon icon="book-open" size="14"></re-icon> <span style="font-weight:700;">' + escapeHtml(a.subjectName || 'Subject') + '</span></div>'
        + '  <div class="subj-asgn-tchr">'
        + '    <span class="pill pri" style="font-size:11px;padding:2px 8px;border-radius:6px;"><re-icon icon="chalkboard" size="11"></re-icon> ' + escapeHtml(a.className || 'Class') + '</span>'
        + (a.deptName ? ' <span style="font-size:11px;color:var(--tmu);">' + escapeHtml(a.deptName) + '</span>' : '')
        + '  </div>'
        + '</div>'
        + '<div class="subj-asgn-right">'
        + '  <span class="subj-asgn-hall"><re-icon icon="pin" size="12"></re-icon> ' + escapeHtml(hall) + '</span>'
        + '  <button type="button" class="btn bdan bxs" onclick="rmAsgn(\'' + a._id + '\',\'teacher\')" title="Remove Assignment" style="padding:4px 8px;border-radius:6px;"><re-icon icon="trash2" size="12"></re-icon></button>'
        + '</div>'
        + '</div>';
    }).join('') + '</div>';
  } else {
    assignmentsHtml = '<div class="subj-asgn-empty">'
      + '<div class="subj-empty-icon"><re-icon icon="book-open" size="24"></re-icon></div>'
      + '<div class="subj-empty-title">No Teaching Allocations Yet</div>'
      + '<div class="subj-empty-desc">This faculty member is not currently assigned to teach any course subjects or class sections.</div>'
      + '<button type="button" class="btn-out btn-sm" onclick="oaat()" style="margin-top:4px;"><re-icon icon="plus" size="13"></re-icon> Add Class Assignment</button>'
      + '</div>';
  }

  // Advisor card
  var advisorCardHtml = '';
  if (advisorClasses.length > 0) {
    advisorCardHtml = '<div class="subj-section-card" style="margin-top:12px;">'
      + '<div class="subj-section-hd" style="padding:10px 14px;">'
      + '  <div class="subj-section-title" style="font-size:12.5px;"><re-icon icon="user-check" size="14"></re-icon> <span>Assigned Class Advisor Mentorship</span><span class="pill pri" style="font-size:11px;padding:2px 8px;margin-left:4px;">' + advisorClasses.length + ' Sections</span></div>'
      + '</div>'
      + '<div class="subj-section-bd" style="padding:12px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
      + advisorClasses.map(function (c) {
        return '<div style="background:var(--gLt);border:1px solid var(--br);border-radius:8px;padding:6px 12px;display:flex;align-items:center;gap:8px;">'
          + '<span style="font-weight:700;font-size:12.5px;color:var(--gD);">' + escapeHtml(c.name) + '</span>'
          + '<button type="button" class="btn-xs btn-out" onclick="closeModalBg(\'m-tch-detail\');openCD(\'' + c._id + '\')" title="Open Class Details" style="padding:2px 6px;"><re-icon icon="external-link" size="10"></re-icon></button>'
          + '</div>';
      }).join('')
      + '</div></div>';
  }

  container.innerHTML =
    '<!-- 1. STATS KPI GRID -->'
    + '<div class="subj-stats-grid">'
    + '  <div class="subj-stat-card stat-green">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Classes</span><div class="subj-stat-ic"><re-icon icon="chalkboard" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + uniqueClasses.length + ' <span class="subj-stat-unit">' + (uniqueClasses.length === 1 ? 'Section' : 'Sections') + '</span></div>'
    + '    <div class="subj-stat-sub">' + (uniqueClasses.length > 0 ? 'Instructing cohorts' : 'No sections assigned') + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-blue">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Subjects</span><div class="subj-stat-ic"><re-icon icon="book-open" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + uniqueSubjects.length + ' <span class="subj-stat-unit">' + (uniqueSubjects.length === 1 ? 'Course' : 'Courses') + '</span></div>'
    + '    <div class="subj-stat-sub">' + (uniqueSubjects.length > 0 ? 'Unique subjects taught' : 'No courses assigned') + '</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-amber">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Weekly Load</span><div class="subj-stat-ic"><re-icon icon="clock" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">~' + totalCredits + ' <span class="subj-stat-unit">Hrs / Wk</span></div>'
    + '    <div class="subj-stat-sub">' + totalCredits + ' curriculum credits assigned</div>'
    + '  </div>'
    + '  <div class="subj-stat-card stat-purple">'
    + '    <div class="subj-stat-hd"><span class="subj-stat-label">Role Status</span><div class="subj-stat-ic"><re-icon icon="user-check" size="15"></re-icon></div></div>'
    + '    <div class="subj-stat-val">' + advisorBadgeHtml + '</div>'
    + '    <div class="subj-stat-sub">' + (advisorClasses.length > 0 ? 'Designated Class Advisor' : 'Academic Faculty Member') + '</div>'
    + '  </div>'
    + '</div>'
    + '<!-- 2. SPECIFICATIONS CARD -->'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd">'
    + '    <div class="subj-section-title"><re-icon icon="settings" size="14"></re-icon> <span>Faculty Profile &amp; Departmental Data</span></div>'
    + '    <button type="button" class="btn-xs btn-out" onclick="switchTeacherTab(\'edit\')"><re-icon icon="edit" size="12"></re-icon> Edit Details</button>'
    + '  </div>'
    + '  <div class="subj-section-bd">'
    + '    <div class="subj-specs-grid">'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Faculty Name</span><span class="subj-spec-val" style="font-weight:700;">' + escapeHtml(teacher.name || teacher.fullName || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Employee ID</span><span class="subj-spec-val" style="font-family:monospace;letter-spacing:.3px;color:var(--gD);">' + escapeHtml(teacher.empId || teacher.employeeNo || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Department</span><span class="subj-spec-val">' + escapeHtml(teacher.dept || teacher.department || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Designation</span><span class="subj-spec-val">' + escapeHtml(teacher.desig || teacher.designation || 'Faculty') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Email Address</span><span class="subj-spec-val" style="word-break:break-all;">' + escapeHtml(teacher.email || '—') + '</span></div>'
    + '      <div class="subj-spec-item"><span class="subj-spec-label">Username</span><span class="subj-spec-val" style="font-family:monospace;">' + escapeHtml(teacher.username || '—') + '</span></div>'
    + '    </div>'
    + '  </div>'
    + '</div>'
    + advisorCardHtml
    + '<!-- 3. TEACHING ALLOCATIONS PREVIEW CARD -->'
    + '<div class="subj-section-card">'
    + '  <div class="subj-section-hd">'
    + '    <div class="subj-section-title"><re-icon icon="book-open" size="14"></re-icon> <span>Teaching Subject Allocations</span><span style="background:var(--gLt);color:var(--gD);font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:4px;">' + teacherAssignments.length + '</span></div>'
    + '    <div style="display:flex;gap:6px;">'
    + '      <button type="button" class="btn-xs btn-out" onclick="switchTeacherTab(\'allocations\')"><re-icon icon="list" size="12"></re-icon> Full Table</button>'
    + '      <button type="button" class="btn-xs btn-pri" onclick="oaat()"><re-icon icon="plus" size="12"></re-icon> Add Assignment</button>'
    + '    </div>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:14px 18px;">'
    +      assignmentsHtml
    + '  </div>'
    + '</div>'
    + '<!-- 4. FOOTER ACTION TOOLBAR -->'
    + '<div class="subj-overview-ft">'
    + '  <button type="button" class="btn bdan bsm" onclick="_confirmDeleteTeacher(\'' + tid + '\',\'' + escapeHtml((teacher.name || '').replace(/'/g, "\\'")) + '\',true)"><re-icon icon="trash2" size="14"></re-icon> Delete Teacher</button>'
    + '  <div style="display:flex;gap:10px;align-items:center;">'
    + '    <button type="button" class="btn-out bsm" onclick="switchTeacherTab(\'edit\')"><re-icon icon="edit" size="14"></re-icon> Edit Profile</button>'
    + '    <button type="button" class="btn-pri bsm" onclick="oaat()"><re-icon icon="plus" size="14"></re-icon> Add Assignment</button>'
    + '  </div>'
    + '</div>';
}

function _renderTeacherAllocationsTab(teacher, assignments) {
  var container = document.getElementById('td-allocations-container');
  if (!container || !teacher) return;

  var teacherAssignments = Array.isArray(assignments) ? assignments : [];

  if (!teacherAssignments.length) {
    container.innerHTML = '<div style="text-align:center;padding:36px 18px;color:var(--tmu);font-size:13px;background:var(--bg2,#f8faf8);">'
      + '<div style="font-size:28px;margin-bottom:6px;color:var(--tdi);"><re-icon icon="book-open" size="28"></re-icon></div>'
      + '<div style="font-weight:700;color:var(--td);font-size:14px;margin-bottom:4px;">No Teaching Course Allocations</div>'
      + '<div style="max-width:380px;margin:0 auto 12px;font-size:12px;color:var(--tmu);">Assign subjects and classes to designate teaching responsibilities and schedule timetables for this faculty member.</div>'
      + '<button type="button" class="btn-pri btn-sm" onclick="oaat()"><re-icon icon="plus" size="13"></re-icon> Add Assignment</button>'
      + '</div>';
    return;
  }

  var rowsHtml = teacherAssignments.map(function (a, idx) {
    var subj = (DB.get('subjects') || []).find(function (s) { return String(s._id) === String(a.subjectId); });
    var subjCode = subj ? (subj.courseCode || subj.code || subj.shortForm || '—') : '—';
    var subjType = subj && subj.type ? subj.type : 'Theory';
    var typeLower = subjType.toLowerCase();
    var credits = subj && subj.credits != null ? subj.credits : '3';
    var hall = a.hallNo ? a.hallNo : '—';

    return '<tr style="border-bottom:1px solid var(--br);">'
      + '<td style="padding:10px 14px;font-size:12px;color:var(--tmu);font-weight:600;width:38px;">' + (idx + 1) + '</td>'
      + '<td style="padding:10px 14px;">'
      + '  <div style="font-weight:700;color:var(--td);font-size:13px;">' + escapeHtml(a.subjectName || (subj ? subj.name : 'Subject')) + '</div>'
      + '  <div style="font-size:11px;color:var(--tmu);margin-top:2px;display:flex;align-items:center;gap:6px;">'
      + '    <span style="font-family:monospace;background:var(--gLt);color:var(--gD);padding:1px 5px;border-radius:4px;font-weight:700;">' + escapeHtml(subjCode) + '</span>'
      + '    <span>' + credits + ' Credits</span>'
      + '  </div>'
      + '</td>'
      + '<td style="padding:10px 14px;">'
      + '  <span class="subj-type-badge ' + (typeLower === 'lab' ? 'lab' : 'theory') + '" style="font-size:11.5px;padding:2px 8px;">' + escapeHtml(subjType) + '</span>'
      + '</td>'
      + '<td style="padding:10px 14px;">'
      + '  <div style="font-weight:600;color:var(--td);font-size:12.5px;display:flex;align-items:center;gap:6px;">'
      + '    <re-icon icon="chalkboard" size="14" style="color:var(--gD);"></re-icon> ' + escapeHtml(a.className || 'Class')
      + '  </div>'
      + '</td>'
      + '<td style="padding:10px 14px;font-size:12px;color:var(--tmu);">' + escapeHtml(a.deptName || '—') + '</td>'
      + '<td style="padding:10px 14px;font-size:12.5px;font-weight:600;color:var(--td);">'
      + '  <span style="display:inline-flex;align-items:center;gap:4px;"><re-icon icon="pin" size="12" style="color:var(--tmu);"></re-icon> ' + escapeHtml(hall) + '</span>'
      + '</td>'
      + '<td style="padding:10px 14px;text-align:right;">'
      + '  <button type="button" class="btn bdan bxs" onclick="rmAsgn(\'' + a._id + '\',\'teacher\')" title="Remove Assignment" style="padding:4px 8px;border-radius:6px;"><re-icon icon="trash2" size="12"></re-icon></button>'
      + '</td>'
      + '</tr>';
  }).join('');

  container.innerHTML = '<table class="tbl" style="width:100%;margin:0;border-collapse:collapse;">'
    + '<thead><tr style="background:#f8fafc;border-bottom:1px solid var(--br);">'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">#</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Subject</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Type</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Class Section</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Department</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Location</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:right;text-transform:uppercase;">Action</th>'
    + '</tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody>'
    + '</table>';
}

function openTeacherModal(teacherId, initialTab) {
  if (!teacherId) return;

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
        openTeacherModal(t._id || teacherId, initialTab);
      } else {
        dbToast('Teacher not found', 'warn');
      }
    }).catch(function () {
      dbToast('Could not load teacher details', 'error');
    });
    return;
  }

  currentTeacherId = teacher._id || teacher.roleDocId || teacherId;
  var tid = teacher._id || teacher.roleDocId || teacherId;

  var assignments = Array.isArray(DB.get('assignments')) ? DB.get('assignments') : [];
  var teacherAssignments = assignments.filter(function (a) {
    return String(a.teacherId) === String(tid) || (teacher.trackId && a.teacherTrackId === teacher.trackId);
  });

  // 1. Header
  _updateTeacherUnifiedModalHeader(teacher);

  // 2. Tab contents
  _renderTeacherUnifiedOverview(teacher, teacherAssignments);
  _renderTeacherAllocationsTab(teacher, teacherAssignments);
  _populateEditTeacherForm(teacher);

  // 3. Switch to target tab (default: overview)
  switchTeacherTab(initialTab || 'overview');

  openModal_('m-tch-detail');
}
window.openTeacherModal = openTeacherModal;

function openTD(teacherId, initialTab) {
  openTeacherModal(teacherId, initialTab || 'overview');
}
window.openTD = openTD;

function editTchInline() {
  switchTeacherTab('edit');
}
window.editTchInline = editTchInline;

function saveTchEdit() {
  var rawName = getFieldValue('td-edit-nm');
  var name = sanitizeFullName(rawName);
  var split = splitFirstLastName(name);
  var firstName = split.firstName;
  var lastName = split.lastName;
  var empId = getFieldValue('td-edit-ei');
  var deptSel = document.getElementById('td-edit-dept');
  var dept = deptSel ? deptSel.options[deptSel.selectedIndex]?.text || '' : '';
  var deptId = deptSel ? deptSel.value || null : null;
  var deptCode = '';
  var desig = getFieldValue('td-edit-dg');
  var email = (getFieldValue('td-edit-em') || '').replace(/\s+/g, '').toLowerCase();
  var username = (getFieldValue('td-edit-us') || '').replace(/\s+/g, '').toLowerCase();
  var password = getFieldValue('td-edit-pw');
  if (!name) { showToast('Name required', 'warn'); return; }

  var depts = DB.get('depts');
  var matchedDept = depts.find(function (d) { return String(d._id) === String(deptId); });
  if (matchedDept) {
    deptCode = matchedDept.code || matchedDept.threeLetterCode || '';
    dept = matchedDept.name;
  }

  var updates = { name: name, firstName: firstName, lastName: lastName, empId: empId, dept: dept, deptId: deptId, deptCode: deptCode, desig: desig, email: email, username: username };
  if (password) updates.password = password;

  dbToast('Saving profile…', 'saving');
  apiUpdateTeacher(currentTeacherId, updates, name).then(function (d) {
    if (!d) return;
    addLog('Teacher Updated', '"' + name + '"');
    openTeacherModal(currentTeacherId, 'overview');
    _refreshTeacherList();
    dbToast('Teacher updated', 'success');
  }).catch(function (err) { dbToast('Failed to update: ' + (err.message || 'error'), 'error'); });
}
window.saveTchEdit = saveTchEdit;

function addTch() {
  var rawName = getFieldValue('t-nm');
  var fullName = sanitizeFullName(rawName);
  var split = splitFirstLastName(fullName);
  var firstName = sanitizeFullName(getFieldValue('t-fn')) || split.firstName;
  var lastName = sanitizeFullName(getFieldValue('t-ln'));
  if (!lastName && split.lastName) lastName = split.lastName;
  var empId = getFieldValue('t-ei');
  var deptSel = document.getElementById('t-dp');
  var dept = deptSel ? deptSel.options[deptSel.selectedIndex]?.text || '' : '';
  var deptId = deptSel ? deptSel.value || null : null;
  var deptCode = '';
  var desig = document.getElementById('t-dg')?.value || '';
  var uname = (getFieldValue('t-us') || '').replace(/\s+/g, '').toLowerCase();
  var email = (getFieldValue('t-em') || '').replace(/\s+/g, '').toLowerCase();
  var passwd = getFieldValue('t-pw') || 'teacher123';
  var trackId = getFieldValue('t-ti') || buildTchTrackId(empId);

  var depts = DB.get('depts') || [];
  var matchedDept = depts.find(function (d) { return String(d._id) === String(deptId); });
  if (isCurrentUserSuperAdmin()) {
    var dInfo = getCurrentUserDeptInfo();
    if (!deptId && dInfo.id) deptId = dInfo.id;
    if (!matchedDept) {
      matchedDept = depts.find(function (d) { return (deptId && String(d._id) === String(deptId)) || d.name === dInfo.name; });
    }
  }
  if (matchedDept) {
    deptCode = matchedDept.code || matchedDept.threeLetterCode || '';
    dept = matchedDept.name;
    deptId = matchedDept._id || deptId;
  }

  if (!fullName || !uname) { showToast('Name and username required', 'warn'); return; }
  if (!trackId) { showToast('Track ID could not be generated — enter Employee ID first', 'warn'); return; }

  const payload = {
    fullName, firstName, lastName, employeeNo: empId, email: email,
    department: dept, deptId: deptId, deptCode: deptCode, designation: desig, username: uname, password: passwd,
    trackId, specials: [], mustChangePassword: true, firstLogin: null
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

function _buildTaClassOptions(selectedId, deptId) {
  var classes = DB.get('classes') || [];
  if (!Array.isArray(classes)) classes = [];

  var listToRender = classes;
  if (deptId) {
    var deptMatches = classes.filter(function (c) {
      return String(c.deptId || '') === String(deptId);
    });
    if (deptMatches.length > 0) {
      var otherClasses = classes.filter(function (c) {
        return String(c.deptId || '') !== String(deptId);
      });
      listToRender = deptMatches.concat(otherClasses);
    }
  }

  return '<option value="">— Select Class Section —</option>'
    + listToRender.map(function (c) {
      var cName = (c.name || 'Class').trim();
      var deptCode = c.deptCode || (c.deptName ? c.deptName.substring(0, 4).toUpperCase() : '');
      var semSec = 'Sem ' + (c.sem || '—') + ' · Sec ' + (c.section || 'A');
      var hall = (c.roomId && c.roomId.hallNo) || c.hallNo || '';
      var isSel = (String(c._id) === String(selectedId)) ? ' selected' : '';

      return '<option value="' + c._id + '"'
        + ' data-name="' + escapeHtml(cName) + '"'
        + (deptCode ? ' data-badge="' + escapeHtml(deptCode) + '"' : '')
        + ' data-sub="' + escapeHtml(semSec + (c.batch ? ' · ' + c.batch : '')) + '"'
        + (hall ? ' data-hall="' + escapeHtml(hall) + '"' : '')
        + isSel + '>'
        + escapeHtml(cName + ' (' + semSec + ')')
        + '</option>';
    }).join('');
}

function onTaClassChange(sel) {
  var tr = sel.closest('tr');
  if (!tr) return;
  var hallInput = tr.querySelector('.ta-hall');
  if (!hallInput) return;
  var opt = sel.options[sel.selectedIndex];
  var hallVal = opt ? opt.getAttribute('data-hall') : '';
  if (hallVal && !hallInput.value) {
    hallInput.value = hallVal;
  }
}
window.onTaClassChange = onTaClassChange;

function addTeacherAssignRow(classId, subjectId, hallNo) {
  var tbody = document.getElementById('ta-rows');
  if (!tbody) return;

  var teacher = (_teacherData || []).find(function (t) { return String(t._id) === String(currentTeacherId) || String(t.trackId) === String(currentTeacherId); })
    || (DB.get('users') || []).find(function (u) { return String(u._id) === String(currentTeacherId) || String(u.trackId) === String(currentTeacherId); });
  var deptId = teacher ? (teacher.deptId || '') : '';

  var tr = document.createElement('tr');
  tr.className = 'ta-row';
  tr.style.borderBottom = '1px solid var(--brl)';

  var rowUid = 'ta-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
  var clsSelectId = 'ta-cls-' + rowUid;
  var subjSelectId = 'ta-subj-' + rowUid;

  tr.innerHTML =
    '<td style="padding:8px 10px;vertical-align:middle;">'
    + '<select class="fc2 ta-cls" id="' + clsSelectId + '" style="font-size:13px;padding:8px 10px;min-width:180px;" onchange="onTaClassChange(this)">'
    + _buildTaClassOptions(classId || '', deptId)
    + '</select></td>'
    + '<td style="padding:8px 10px;vertical-align:middle;">'
    + '<select class="fc2 ta-subj" id="' + subjSelectId + '" style="font-size:13px;padding:8px 10px;min-width:180px;">'
    + _buildCaSubjectOptions(subjectId || '', deptId)
    + '</select></td>'
    + '<td style="padding:8px 10px;vertical-align:middle;">'
    + '<input type="text" class="fc2 ta-hall" placeholder="e.g. H101" maxlength="20"'
    + ' style="font-size:13px;padding:8px 10px;min-width:90px;height:38px;box-sizing:border-box;" value="' + escapeHtml(hallNo || '') + '">'
    + '</td>'
    + '<td style="padding:8px 10px;text-align:center;vertical-align:middle;">'
    + '<button type="button" onclick="removeTeacherAssignRow(this)" style="background:var(--red);color:#fff;border:none;border-radius:8px;'
    + 'width:30px;height:30px;cursor:pointer;font-size:15px;line-height:1;display:inline-flex;align-items:center;'
    + 'justify-content:center;" title="Remove row"><re-icon icon="x"></re-icon></button>'
    + '</td>';
  tbody.appendChild(tr);

  // Upgrade selects to SearchableDropdown
  var clsSel = tr.querySelector('.ta-cls');
  var subjSel = tr.querySelector('.ta-subj');
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.attach(clsSel, {
      placeholder: '— Select Class Section —',
      searchPlaceholder: 'Search class, batch, dept…'
    });
    SearchableDropdown.attach(subjSel, {
      kind: 'subject',
      placeholder: '— Select Subject —',
      searchPlaceholder: 'Search subject name, code…'
    });
  }
}
window.addTeacherAssignRow = addTeacherAssignRow;

function removeTeacherAssignRow(btn) {
  var tr = btn.closest ? btn.closest('tr') : btn.parentNode.parentNode;
  var tbody = document.getElementById('ta-rows');
  if (tbody.querySelectorAll('tr.ta-row').length <= 1) {
    showToast('At least one row is required', 'warn'); return;
  }
  var clsSel = tr.querySelector('.ta-cls');
  var subjSel = tr.querySelector('.ta-subj');
  if (typeof SearchableDropdown !== 'undefined') {
    var cInst = SearchableDropdown.get(clsSel);
    if (cInst) cInst.destroy();
    var sInst = SearchableDropdown.get(subjSel);
    if (sInst) sInst.destroy();
  }
  tbody.removeChild(tr);
}
window.removeTeacherAssignRow = removeTeacherAssignRow;

function oaat() {
  if (!currentTeacherId) {
    showToast('Please select a teacher first', 'warn');
    return;
  }

  var teacher = (_teacherData || []).find(function (t) { return String(t._id) === String(currentTeacherId) || String(t.trackId) === String(currentTeacherId); })
    || (DB.get('users') || []).find(function (u) { return String(u._id) === String(currentTeacherId) || String(u.trackId) === String(currentTeacherId); });
  if (!teacher) return;

  var tName = teacher.name || teacher.fullName || 'Faculty Member';
  var tDesig = teacher.desig || teacher.designation || '';
  var tDept = teacher.dept || teacher.department || '';
  var tEmpId = teacher.empId || teacher.employeeNo || teacher.username || '—';

  var ttlEl = document.getElementById('ta-modal-ttl');
  if (ttlEl) {
    ttlEl.innerHTML = '<re-icon icon="pin" size="18"></re-icon> <span>Assign Teaching Allocations — ' + escapeHtml(tName) + '</span>';
  }
  var subEl = document.getElementById('ta-modal-sub');
  if (subEl) {
    var parts = [];
    if (tDesig) parts.push(escapeHtml(tDesig));
    if (tDept) parts.push(escapeHtml(tDept));
    parts.push('Emp ID: ' + escapeHtml(tEmpId));
    subEl.textContent = parts.join(' • ');
  }

  var tbody = document.getElementById('ta-rows');
  if (tbody) {
    var oldSels = tbody.querySelectorAll('select');
    if (typeof SearchableDropdown !== 'undefined') {
      oldSels.forEach(function (sel) {
        var inst = SearchableDropdown.get(sel);
        if (inst) inst.destroy();
      });
    }
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:18px;color:var(--tmu);font-size:13px;">⌛ Loading class sections &amp; subjects from database…</td></tr>';
  }
  var warnEl = document.getElementById('ta-warn');
  if (warnEl) warnEl.style.display = 'none';

  openModal_('m-add-asgn-t');

  // Parallel fetch fresh data
  Promise.all([
    apiCall('GET', '/classes').then(function (cls) { if (Array.isArray(cls)) DB.set('classes', cls); return cls; }).catch(function () { return DB.get('classes') || []; }),
    apiCall('GET', '/subjects').then(function (subjs) { if (Array.isArray(subjs)) DB.set('subjects', subjs); return subjs; }).catch(function () { return DB.get('subjects') || []; }),
    apiCall('GET', '/assignments?teacherId=' + encodeURIComponent(currentTeacherId)).catch(function () { return []; })
  ])
    .then(function (results) {
      var existing = results[2];
      if (!Array.isArray(existing) || !existing.length) {
        existing = (DB.get('assignments') || []).filter(function (a) { return String(a.teacherId) === String(currentTeacherId); });
      }
      if (tbody) tbody.innerHTML = '';
      if (Array.isArray(existing) && existing.length > 0) {
        existing.forEach(function (a) { addTeacherAssignRow(a.classId, a.subjectId, a.hallNo); });
      } else {
        addTeacherAssignRow();
      }
    })
    .catch(function (err) {
      console.error('[EAMS Teacher Assign Load Error]:', err);
      if (tbody) tbody.innerHTML = '';
      addTeacherAssignRow();
    });
}
window.oaat = oaat;

function saveTeacherAssignments() {
  var warnEl = document.getElementById('ta-warn');
  if (warnEl) warnEl.style.display = 'none';

  var rows = document.querySelectorAll('#ta-rows tr.ta-row');
  if (!rows.length) { showToast('Add at least one row', 'warn'); return; }

  var teacher = (_teacherData || []).find(function (t) { return String(t._id) === String(currentTeacherId) || String(t.trackId) === String(currentTeacherId); })
    || (DB.get('users') || []).find(function (u) { return String(u._id) === String(currentTeacherId) || String(u.trackId) === String(currentTeacherId); });
  if (!teacher) { showToast('Teacher profile not found', 'error'); return; }

  var classes = DB.get('classes') || [];
  var subjects = DB.get('subjects') || [];

  var assignments = [];
  var seenCombos = {};
  var errorMsg = '';

  for (var i = 0; i < rows.length; i++) {
    var tr = rows[i];
    var clsSel = tr.querySelector('.ta-cls');
    var subjSel = tr.querySelector('.ta-subj');
    var hallInput = tr.querySelector('.ta-hall');

    var classId = clsSel ? clsSel.value : '';
    var subjectId = subjSel ? subjSel.value : '';
    var hallNo = hallInput ? hallInput.value.trim() : '';

    if (!classId || !subjectId) {
      errorMsg = 'Row ' + (i + 1) + ': Please select both a class section and a subject.';
      break;
    }
    if (!hallNo) {
      errorMsg = 'Row ' + (i + 1) + ': Lecture hall is required.';
      break;
    }

    var comboKey = classId + '::' + subjectId;
    if (seenCombos[comboKey]) {
      errorMsg = 'Duplicate assignment detected: the same class and subject cannot be assigned more than once.';
      break;
    }
    seenCombos[comboKey] = true;

    var cls = classes.find(function (c) { return String(c._id) === String(classId); }) || {};
    var subj = subjects.find(function (s) { return String(s._id) === String(subjectId); }) || {};

    assignments.push({
      classId: classId,
      className: cls.name || 'Class',
      subjectId: subjectId,
      subjectName: subj.name || 'Subject',
      teacherId: currentTeacherId,
      teacherName: teacher.name || teacher.fullName || '',
      hallNo: hallNo,
      deptName: cls.deptName || '',
      deptCode: cls.deptCode || ''
    });
  }

  if (errorMsg) {
    if (warnEl) {
      warnEl.textContent = errorMsg;
      warnEl.style.display = 'block';
    }
    showToast(errorMsg, 'warn');
    return;
  }

  dbToast('Saving to Database…', 'saving', assignments.length + ' allocation(s)');

  apiCall('POST', '/assignments/bulk', { teacherId: currentTeacherId, assignments: assignments })
    .then(function (d) {
      if (!d || d.error) {
        dbToast('DB Error: ' + (d && d.error ? d.error : 'Unknown'), 'error');
        return;
      }

      return apiCall('GET', '/assignments').then(function (all) {
        if (Array.isArray(all)) DB.set('assignments', all);
        dbToast('Saved to Database', 'success', d.count + ' allocation(s) written to DB');
        closeModalBg('m-add-asgn-t');
        addLog('Teacher Assignments Bulk Saved', d.count + ' allocations <re-icon icon="arrow-right"></re-icon> ' + (teacher.name || 'Teacher'));
        openTeacherModal(currentTeacherId, 'allocations');
      });
    })
    .catch(function (err) {
      console.error('[EAMS Save Teacher Assignments Error]:', err);
      dbToast('Save failed: ' + (err.message || 'Network error'), 'error');
    });
}
window.saveTeacherAssignments = saveTeacherAssignments;
var savTA = saveTeacherAssignments; // legacy alias
window.savTA = savTA;

// ─── DROPDOWN POPULATION ────────────────────────────────────────────────────
function populateAdminDropdowns() {
  var depts = DB.get('depts');
  var classes = DB.get('classes');

  var years = (YEAR_CONFIG.all && YEAR_CONFIG.all.length)
    ? YEAR_CONFIG.all
    : (YEAR_CONFIG.current ? [YEAR_CONFIG.current] : []);
  var batchSet = new Set(Array.isArray(YEAR_CONFIG.batches) ? YEAR_CONFIG.batches : []);
  if (YEAR_CONFIG.yearsData && Array.isArray(YEAR_CONFIG.yearsData)) {
    YEAR_CONFIG.yearsData.forEach(function (y) {
      if (Array.isArray(y.batches)) {
        y.batches.forEach(function (b) { if (b && b.batch) batchSet.add(b.batch); });
      }
    });
  }
  if (Array.isArray(classes)) {
    classes.forEach(function (c) { if (c && c.batch) batchSet.add(c.batch); });
  }
  var batch = Array.from(batchSet).filter(Boolean).sort().reverse();
  YEAR_CONFIG.batches = batch;

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
    var curSfVal = sfBatch.value || '';
    sfBatch.innerHTML = '<option value="">All Batches</option>'
      + batch.map(function (b) {
        var yr = getBatchYearLevel(b);
        var yrAttr = yr ? ' data-year="' + escapeHtml(yr) + '"' : '';
        return '<option value="' + escapeHtml(b) + '"' + yrAttr + (b === curSfVal ? ' selected' : '') + '>' + escapeHtml(b) + '</option>';
      }).join('');
    if (curSfVal && batch.indexOf(curSfVal) !== -1) {
      sfBatch.value = curSfVal;
    }
    if (typeof SearchableDropdown !== 'undefined') {
      SearchableDropdown.sync('sf-batch');
    }
  }

  ['nc-batch', 'ec-batch', 'stu-batch', 'edit-batch'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) {
      var curVal = el.value || '';
      el.innerHTML = batch.length
        ? batch.map(function (y) {
          var yr = getBatchYearLevel(y);
          var yrAttr = yr ? ' data-year="' + escapeHtml(yr) + '"' : '';
          return '<option value="' + escapeHtml(y) + '"' + yrAttr + (y === curVal ? ' selected' : '') + '>' + escapeHtml(y) + '</option>';
        }).join('')
        : '<option value="">— No active batches set —</option>';
      if (curVal && batch.indexOf(curVal) !== -1) el.value = curVal;
      if (typeof SearchableDropdown !== 'undefined') {
        SearchableDropdown.sync(id);
      }
    }
  });

  var _formatDeptOptions = function (dList, placeholder) {
    var out = '<option value="">' + (placeholder || '— Select —') + '</option>';
    return out + dList.map(function (d) {
      var code = d.code || d.threeLetterCode || '';
      if (!code && d.name) {
        code = (typeof SearchableDropdown !== 'undefined' && SearchableDropdown.normalizeDeptCode)
          ? SearchableDropdown.normalizeDeptCode(d.name) : '';
      }
      if (d.name && d.name.toLowerCase().includes('mathematics')) code = 'MAT';
      return '<option value="' + d._id + '" data-badge="' + escapeHtml(code || '') + '">' + escapeHtml(d.name) + '</option>';
    }).join('');
  };

  ['t-dp'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) {
      if (isCurrentUserSuperAdmin()) {
        var dInfo = getCurrentUserDeptInfo();
        var myDeptId = dInfo.id;
        var myDeptName = dInfo.name;
        if (!myDeptId) {
          var found = depts.find(function (d) { return d.name === myDeptName; });
          if (found) myDeptId = found._id;
        }
        var myCode = (dInfo && (dInfo.code || dInfo.threeLetterCode)) || '';
        if (!myCode && myDeptName) {
          myCode = (typeof SearchableDropdown !== 'undefined' && SearchableDropdown.normalizeDeptCode)
            ? SearchableDropdown.normalizeDeptCode(myDeptName) : '';
        }
        if (myDeptName && myDeptName.toLowerCase().includes('mathematics')) myCode = 'MAT';
        el.innerHTML = '<option value="' + (myDeptId || '') + '" data-badge="' + escapeHtml(myCode || '') + '">' + escapeHtml(myDeptName || 'My Department') + '</option>';
        el.value = myDeptId || '';
        el.disabled = true;
        el.style.cursor = 'not-allowed';
      } else {
        el.innerHTML = _formatDeptOptions(depts, '— Select —');
        el.disabled = false;
        el.style.cursor = '';
      }
    }
  });

  if (isCurrentUserSuperAdmin()) {
    var dInfo = getCurrentUserDeptInfo();
    var myDeptId = dInfo.id;
    var myDeptName = dInfo.name;
    if (!myDeptId) {
      var found = depts.find(function (d) { return d.name === myDeptName; });
      if (found) myDeptId = found._id;
    }
    var myCode = (dInfo && (dInfo.code || dInfo.threeLetterCode)) || '';
    if (!myCode && myDeptName) {
      myCode = (typeof SearchableDropdown !== 'undefined' && SearchableDropdown.normalizeDeptCode)
        ? SearchableDropdown.normalizeDeptCode(myDeptName) : '';
    }
    if (myDeptName && myDeptName.toLowerCase().includes('mathematics')) myCode = 'MAT';
    ['stu-dept', 'edit-dept'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="' + (myDeptId || '') + '" data-badge="' + escapeHtml(myCode || '') + '">' + escapeHtml(myDeptName || 'My Department') + '</option>';
        el.value = myDeptId || '';
        el.disabled = true;
        el.style.cursor = 'not-allowed';
      }
    });
    onStuDeptChange();
  } else {
    ['stu-dept', 'edit-dept'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.innerHTML = _formatDeptOptions(depts, '— Select —');
        el.disabled = false;
        el.style.cursor = '';
      }
    });
  }

  updateStuClassList();
  updateEditClassList();

  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('stu-dept');
    SearchableDropdown.sync('edit-dept');
    SearchableDropdown.sync('stu-class');
    SearchableDropdown.sync('edit-class');
  }

  ['nc-dept', 'ns-dept', 'ec-dept', 'es-dept'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">— Select —</option>'
      + depts.map(function (d) { return '<option value="' + d._id + '">' + d.name + '</option>'; }).join('');
  });

  populateTeacherDeptDropdown();
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('tf-desig');
  }

  _loadFacilityRooms();
}
var padm = populateAdminDropdowns;

// ── Facility Room Dropdowns for Class Assignment ─────────────────────────
var _facilityRooms = [];

function _loadFacilityRooms() {
  return apiCall('GET', '/timetable/rooms').then(function (rooms) {
    _facilityRooms = Array.isArray(rooms) ? rooms : [];
    _populateFacilityRoomDropdowns();
    return _facilityRooms;
  }).catch(function (err) {
    console.warn('[EAMS] Failed to fetch facility rooms for admin dropdowns:', err);
    return [];
  });
}

function _populateFacilityRoomDropdowns() {
  var ncSel = document.getElementById('nc-room');
  var ecSel = document.getElementById('ec-room');
  if (!ncSel && !ecSel) return;

  var currentNcVal = ncSel ? ncSel.value : '';
  var currentEcVal = ecSel ? ecSel.value : '';

  var optsHtml = '<option value="">— Select Room / Hall —</option>';
  if (_facilityRooms.length) {
    var sorted = _facilityRooms.slice().sort(function (a, b) {
      var bA = (a.buildingName || '').localeCompare(b.buildingName || '');
      if (bA !== 0) return bA;
      var fA = (a.floor || 0) - (b.floor || 0);
      if (fA !== 0) return fA;
      return (a.hallNo || a.name || '').localeCompare(b.hallNo || b.name || '');
    });

    optsHtml += sorted.map(function (r) {
      var bldg = (r.buildingName || (r.buildingId && r.buildingId.name) || 'Building');
      var fl = (r.floor !== undefined && r.floor !== null) ? ('Fl ' + r.floor) : '';
      var label = (r.hallNo || r.name) + ' (' + bldg + (fl ? ', ' + fl : '') + ' • ' + (r.type || 'Room') + ')';
      var hallAttr = escapeHtml(r.hallNo || r.name || '');
      return '<option value="' + r._id + '" data-hall="' + hallAttr + '">' + escapeHtml(label) + '</option>';
    }).join('');
  }

  if (ncSel) {
    ncSel.innerHTML = optsHtml;
    if (currentNcVal) ncSel.value = currentNcVal;
  }
  if (ecSel) {
    ecSel.innerHTML = optsHtml;
    if (currentEcVal) ecSel.value = currentEcVal;
  }

  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('nc-room');
    SearchableDropdown.sync('ec-room');
  }
}

// ─── MODAL HELPERS ───────────────────────────────────────────────────────────
function openModal_(id) {
  if (id === 'm-subj-assign' || id === 'm-edit-subj' || id === 'm-subj-detail') {
    var tab = id === 'm-edit-subj' ? 'edit' : (id === 'm-subj-detail' ? 'overview' : 'assign');
    if (currentSubjectId || _saSubjectId) {
      openSubjectModal(currentSubjectId || _saSubjectId, tab);
      return;
    }
    id = 'm-subj-unified';
  }
  if (id === 'm-edit-cls') {
    if (currentClassId) {
      openClassModal(currentClassId, 'edit');
      return;
    }
    id = 'm-cls-detail';
  }
  var el = document.getElementById(id);
  if (el) {
    el.style.display = 'flex';
    el.classList.add('open');
    if (typeof SearchableDropdown !== 'undefined') {
      if (id === 'm-add-class-quick') {
        SearchableDropdown.sync('nc-room');
      } else if (id === 'm-edit-cls') {
        SearchableDropdown.sync('ec-room');
      } else if (id === 'm-add-student') {
        syncAddStudentModalFromFilters();
        if (isCurrentUserSuperAdmin()) {
          var dInfo = getCurrentUserDeptInfo();
          var myDeptId = dInfo.id;
          if (!myDeptId) {
            var found = (DB.get('depts') || []).find(function (d) { return d.name === dInfo.name; });
            if (found) myDeptId = found._id;
          }
          var sDept = document.getElementById('stu-dept');
          if (sDept && myDeptId) {
            sDept.value = myDeptId;
            sDept.disabled = true;
            sDept.style.cursor = 'not-allowed';
            onStuDeptChange();
          }
        }
        SearchableDropdown.sync('stu-dept');
        SearchableDropdown.sync('stu-class');
        updateAddStudentLivePreview();
        setTimeout(function () { updateAllSegGliders(false); }, 40);
      } else if (id === 'm-add-teacher') {
        if (typeof prepareAddTeacherForm === 'function') {
          prepareAddTeacherForm();
        }
        if (isCurrentUserSuperAdmin()) {
          var dInfo = getCurrentUserDeptInfo();
          var myDeptId = dInfo.id;
          if (!myDeptId) {
            var found = (DB.get('depts') || []).find(function (d) { return d.name === dInfo.name; });
            if (found) myDeptId = found._id;
          }
          var tDept = document.getElementById('t-dp');
          if (tDept && myDeptId) {
            tDept.value = myDeptId;
            tDept.disabled = true;
            tDept.style.cursor = 'not-allowed';
          }
        }
        if (typeof SearchableDropdown !== 'undefined') {
          SearchableDropdown.sync('t-dp');
          SearchableDropdown.sync('t-dg');
        }
        if (typeof updateAddTeacherLivePreview === 'function') {
          updateAddTeacherLivePreview();
        }
      } else if (id === 'm-stu-edit') {
        SearchableDropdown.sync('edit-dept');
        SearchableDropdown.sync('edit-class');
        updateEditStudentLivePreview();
        setTimeout(function () { updateAllSegGliders(false); }, 40);
      } else if (id === 'm-assign-advisor') {
        SearchableDropdown.sync('adv-modal-select');
      } else if (id === 'm-assign-representatives') {
        SearchableDropdown.sync('rep-modal-select-1');
        SearchableDropdown.sync('rep-modal-select-2');
      } else if (id === 'm-add-dept') {
        if (typeof updateAddDeptLivePreview === 'function') {
          updateAddDeptLivePreview();
        }
      }
    }
  }
}

function closeModalBg(id) {
  var modalId = typeof id === 'string' ? id : (id && id.id ? id.id : '');
  var el = typeof id === 'string' ? document.getElementById(id) : id;
  if (el) {
    el.classList.remove('open');
    el.style.display = 'none';
  }
  if (modalId === 'm-cls-detail') {
    window._classModalReturnDeptId = null;
  }
  if (modalId === 'm-edit-dept' && window._currentPage === 'depts') {
    updateStructureUrlParams({ depts: null });
  }
  if (modalId === 'm-cls-detail' || modalId === 'm-edit-cls') {
    var cEl = document.getElementById('m-cls-detail');
    if (cEl) {
      cEl.classList.remove('open');
      cEl.style.display = 'none';
    }
    currentClassId = null;
    updateStructureUrlParams({ cls: null });
  }
  if (modalId === 'm-subj-assign' || modalId === 'm-edit-subj' || modalId === 'm-subj-detail' || modalId === 'm-subj-unified') {
    var uEl = document.getElementById('m-subj-unified');
    if (uEl) {
      uEl.classList.remove('open');
      uEl.style.display = 'none';
    }
    currentSubjectId = null;
    updateStructureUrlParams({ subj: null });
  }
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.closeAll();
  }
}
window.closeModalBg = closeModalBg;

// Alias used by inline HTML onclick handlers
var om = openModal_;

// Shorthand used by some HTML buttons
function openAddModal(type) {
  if (type === 'student') openModal_('m-add-student');
}

// Close modal when clicking the background overlay
document.querySelectorAll('.modal-bg').forEach(function (bg) {
  bg.addEventListener('click', function (e) {
    if (e.target === bg && !bg.classList.contains('no-backdrop-close')) {
      closeModalBg(bg.id || bg);
    }
  });
});

// Close top modal when pressing Escape key
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    var openBgs = Array.from(document.querySelectorAll('.modal-bg')).filter(function (bg) {
      return bg.classList.contains('open') || (bg.style.display && bg.style.display !== 'none');
    });
    if (openBgs.length > 0) {
      var topBg = openBgs[openBgs.length - 1];
      if (!topBg.classList.contains('no-backdrop-close') && !topBg.classList.contains('no-escape-close')) {
        closeModalBg(topBg.id || topBg);
      }
    }
  }
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
  link.download = filename + '_' + todayIST() + '.csv';
  link.click();
}
var dlcsv = downloadCSV; // alias

// ─── BOOT ────────────────────────────────────────────────────────────────────
initDB();

(function checkAuthAndBoot() {
  var storedUser = sessionStorage.getItem('eams_user');
  if (storedUser) {
    try { currentUser = JSON.parse(storedUser); } catch (e) { }
  }
  var backBtn = document.getElementById('admin-hub-back-btn');
  if (backBtn) backBtn.style.display = 'block';
  var uRoleEl = document.querySelector('.sb-urole');
  if (uRoleEl) {
    uRoleEl.textContent = isCurrentUserSuperAdmin() ? 'Super Admin' : 'Sudo Admin';
  }
  if (typeof applyUserRoleBadgeStyling === 'function') {
    applyUserRoleBadgeStyling(currentUser);
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
  fetch('/api/profile/me', {
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
    if (typeof applyUserRoleBadgeStyling === 'function') {
      applyUserRoleBadgeStyling(currentUser);
    }
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

  var iconEl = btn ? btn.querySelector('re-icon') : null;
  if (iconEl) {
    iconEl.setAttribute('icon', show ? 'eye-off' : 'eye');
  } else if (btn) {
    btn.innerHTML = show ? '<re-icon icon="eye-off" size="16"></re-icon>' : '<re-icon icon="eye" size="16"></re-icon>';
  }
  if (btn) btn.title = show ? 'Hide password' : 'Show password';
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
var _lastCountsSyncTimestamp = 0;
var COUNTS_THROTTLE_MS = 15000;
var _countsPromise = null;

function syncCountsFromAPI(force) {
  var tok = getToken();
  if (!tok) return Promise.resolve(_counts);
  if (!force && _countsPromise) {
    return _countsPromise;
  }
  if (!force && (Date.now() - _lastCountsSyncTimestamp < COUNTS_THROTTLE_MS)) {
    _applyCountsToBadges();
    return Promise.resolve(_counts);
  }
  _countsPromise = fetch('/api/dashboard/counts', { headers: { 'Authorization': 'Bearer ' + tok } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      _countsPromise = null;
      if (data && !data.error) {
        _counts = data;
        _lastCountsSyncTimestamp = Date.now();
        _applyCountsToBadges();
      }
      return _counts;
    }).catch(function () {
      _countsPromise = null;
      return _counts;
    });
  return _countsPromise;
}

function _applyCountsToBadges() {
  var d = _counts;
  var isSuper = isCurrentUserSuperAdmin();
  var deptsDisplay = isSuper ? 1 : d.depts;
  var el;
  el = document.getElementById('c-students'); if (el) el.textContent = d.students;
  el = document.getElementById('c-depts'); if (el) el.textContent = deptsDisplay;
  el = document.getElementById('c-teachers'); if (el) el.textContent = d.teachers;
  el = document.getElementById('c-classes'); if (el) el.textContent = d.classes;
  el = document.getElementById('stud-count'); if (el) el.textContent = d.students;
  el = document.getElementById('dept-count'); if (el) el.textContent = deptsDisplay;
  el = document.getElementById('teach-count'); if (el) el.textContent = d.teachers;

  el = document.getElementById('dept-stat-depts'); if (el) el.textContent = deptsDisplay;
  el = document.getElementById('dept-stat-classes'); if (el) el.textContent = d.classes;
  el = document.getElementById('dept-stat-students'); if (el) el.textContent = d.students;
  el = document.getElementById('dept-stat-teachers'); if (el) el.textContent = d.teachers;

  el = document.getElementById('t-stat-teachers'); if (el) el.textContent = d.teachers;
  el = document.getElementById('t-stat-depts'); if (el) el.textContent = deptsDisplay;

  if (typeof fetchAdminGrievanceBadge === 'function') {
    fetchAdminGrievanceBadge();
  }
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
        pageRights: t.pageRights || [],
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
    var batches = Array.isArray(results[1]) ? results[1] : [];
    var allYears = Array.isArray(results[2]) ? results[2] : [];
    YEAR_CONFIG.current = (typeof current === 'string' && current) ? current : '';
    YEAR_CONFIG.yearsData = allYears;
    YEAR_CONFIG.all = allYears.map(function (y) { return y.academicYear; }).filter(Boolean);
    if (YEAR_CONFIG.current && YEAR_CONFIG.all.indexOf(YEAR_CONFIG.current) === -1) {
      YEAR_CONFIG.all.unshift(YEAR_CONFIG.current);
    }
    var batchSet = new Set(batches);
    allYears.forEach(function (y) {
      if (Array.isArray(y.batches)) {
        y.batches.forEach(function (b) { if (b && b.batch) batchSet.add(b.batch); });
      }
    });
    var classes = DB.get('classes') || [];
    classes.forEach(function (c) { if (c && c.batch) batchSet.add(c.batch); });
    YEAR_CONFIG.batches = Array.from(batchSet).filter(Boolean).sort().reverse();
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
function apiAddDept(name, code, number, twoLetterCode, courseType, branch, category, hodId, hodName) {
  var payload = { name: name, code: code, number: number, twoLetterCode: twoLetterCode, courseType: courseType, branch: branch, category: category || 'programme' };
  if (hodName) payload.hodName = hodName;
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

function apiUpdateDept(id, name, code, number, courseType, branch, category, hodId, hodName) {
  var payload = { name: name, code: code, number: number, courseType: courseType, branch: branch, category: category || 'programme' };
  if (hodName) payload.hodName = hodName;
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
        dbToast('Class added', 'success', '"' + data.name + '" <re-icon icon="arrow-right"></re-icon> Database');
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
        dbToast('Class updated', 'success', '"' + data.name + '" <re-icon icon="arrow-right"></re-icon> Database');
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
        dbToast('Subject added', 'success', '"' + data.name + '" <re-icon icon="arrow-right"></re-icon> Database');
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
        dbToast('Subject updated', 'success', '"' + data.name + '" <re-icon icon="arrow-right"></re-icon> Database');
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
      if (typeof prepareAddTeacherForm === 'function') {
        prepareAddTeacherForm();
      }
    })
    .catch(function (err) {
      console.error('Failed to refresh teacher list:', err);
      _renderTeacherGrid([]);
    });
}

function apiAddTeacher(data) {
  dbToast('Adding teacher…', 'saving', data.name);
  return apiCall('POST', '/teachers', data)
    .then(function (d) {
      if (d.error) { dbToast('Error: ' + d.error, 'error'); return null; }
      return syncUsersWithTeacherDetails().then(function () {
        _refreshTeacherList();
        dbToast('Teacher added', 'success', '"' + data.name + '" (' + data.username + ') <re-icon icon="arrow-right"></re-icon> Database\nPassword: ' + data.password);
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
        dbToast('Teacher updated', 'success', '"' + name + '" <re-icon icon="arrow-right"></re-icon> Database');
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
        dbToast('Student added', 'success', '"' + data.name + '" <re-icon icon="arrow-right"></re-icon> Database');
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
        dbToast('Student updated', 'success', '"' + name + '" <re-icon icon="arrow-right"></re-icon> Database');
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
function openModal(id) { var el = document.getElementById(id) || document.getElementById('m-' + id); if (el) { el.style.display = 'flex'; el.classList.add('open'); } }

window.addEventListener('load', function () {
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

        var accessObj = {};
        try { accessObj = JSON.parse(sessionStorage.getItem('eams_access') || '{}'); } catch (e) { }
        var isSudo = isSudoAdmin(usr) || usr.role === 'sudo' || usr.accessRole === 'sudoAdmin' || accessObj.tier === 'sudoAdmin' || (accessObj.flags && accessObj.flags.isSudo);
        var isSuper = isCurrentUserSuperAdmin() || usr.isSuperAdmin || usr.accessRole === 'superAdmin' || accessObj.tier === 'superAdmin' || (accessObj.flags && accessObj.flags.isSuper);
        var isSub = usr.isSubAdmin || usr.accessRole === 'subAdmin' || accessObj.tier === 'subAdmin' || (accessObj.flags && accessObj.flags.isSub);

        if (roleEl) {
          if (isSudo) {
            roleEl.textContent = 'Sudo Admin';
          } else if (isSuper) {
            roleEl.textContent = 'Super Admin';
          } else if (isSub) {
            roleEl.textContent = 'Sub-Admin';
          } else if (usr.role === 'teacher') {
            roleEl.textContent = 'Teacher';
          } else {
            roleEl.textContent = 'Administrator';
          }
        }

        if (usr.role === 'teacher' && (isSudo || isSuper || isSub)) {
          var hubBtn = document.getElementById('admin-hub-back-btn');
          if (hubBtn) {
            hubBtn.style.display = 'flex';
            hubBtn.textContent = '← Back to Hub';
          }
        }
        if (typeof window.updateExecutiveRolesTabVisibility === 'function') {
          window.updateExecutiveRolesTabVisibility();
        }
        if (typeof applyUserRoleBadgeStyling === 'function') {
          applyUserRoleBadgeStyling(usr);
        }
      }
    }
  } catch (err) { }

  // Check initial bootstrap pending state (§9, R3.2)
  if (sessionStorage.getItem('eams_bootstrapPending') === '1') {
    initBootstrapWizard();
  }
  if (typeof Guard !== 'undefined' && Guard.onReady) {
    Guard.onReady(function (access) {
      if (access && access.bootstrapPending) {
        initBootstrapWizard();
      }
      if (typeof window.updateExecutiveRolesTabVisibility === 'function') {
        window.updateExecutiveRolesTabVisibility();
      }
    });
  }

  fetch('/api/settings/public')
    .then(function (r) { return r.json(); })
    .then(function (pub) {
      window._pubSettings = pub;
      updateRoomReqVisibility();
      if (typeof window.updateExecutiveRolesTabVisibility === 'function') {
        window.updateExecutiveRolesTabVisibility();
      }
      var trustSbItem = document.querySelector('.sb-item[data-page="trust"]');
      if (trustSbItem && pub.pages) {
        var pTrust = String(pub.pages.pageTrust || 'enabled').toLowerCase();
        if (pTrust === 'hidden') {
          trustSbItem.style.display = 'none';
        } else if (pTrust === 'disabled') {
          trustSbItem.style.opacity = '0.5';
          trustSbItem.title = 'Trust & Devices Management is currently disabled';
        } else {
          trustSbItem.style.display = '';
          trustSbItem.style.opacity = '';
        }
      }
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
          document.querySelectorAll('.btn-export').forEach(function (b) { b.style.display = 'none'; });
        }
        if (pub.models.modelAddStudent === false) {
          var addStuBtn = document.getElementById('btn-add-student');
          if (addStuBtn) addStuBtn.style.display = 'none';
          document.querySelectorAll('[onclick*="m-add-student"]').forEach(function (b) { b.style.display = 'none'; });
        }
      }
    }).catch(function (e) { console.warn(e); });
});

// ══════════════════════════════════════════════════════════════════════════════
//  SUDO ADMIN BOOTSTRAP WIZARD (Phase R3 / §9)
// ══════════════════════════════════════════════════════════════════════════════
var _bootstrapState = {
  step: 1,
  department: null,
  profile: null
};

function initBootstrapWizard() {
  var modal = document.getElementById('m-bootstrap-wizard');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.classList.add('open');

  // Prevent closing by outside clicks
  modal.onclick = function (e) {
    if (e.target === modal) {
      e.stopPropagation();
    }
  };

  showBootstrapStep(1);
}

function showBootstrapStep(stepNum) {
  _bootstrapState.step = stepNum;
  var errEl = document.getElementById('bw-err-msg');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  for (var i = 1; i <= 4; i++) {
    var panel = document.getElementById('bw-step-' + i);
    var ind = document.getElementById('bw-step-ind-' + i);
    var num = document.getElementById('bw-step-num-' + i);
    if (panel) panel.style.display = (i === stepNum) ? 'block' : 'none';
    if (ind && num) {
      if (i < stepNum) {
        ind.style.color = 'var(--grn, #22c55e)';
        num.style.background = 'var(--grn, #22c55e)';
        num.style.color = '#fff';
        num.textContent = '✓';
      } else if (i === stepNum) {
        ind.style.color = 'var(--pri)';
        num.style.background = 'var(--pri)';
        num.style.color = '#fff';
        num.textContent = String(i);
      } else {
        ind.style.color = 'var(--tmu)';
        num.style.background = 'var(--bg3)';
        num.style.color = 'var(--tmu)';
        num.textContent = String(i);
      }
    }
  }
}

function showBootstrapError(msg) {
  var errEl = document.getElementById('bw-err-msg');
  if (errEl) {
    errEl.textContent = msg;
    errEl.style.display = 'block';
  }
}

function submitBootstrapStep1() {
  var curPw = (document.getElementById('bw-cur-pw')?.value || '').trim();
  var newPw = (document.getElementById('bw-new-pw')?.value || '').trim();
  var confirmPw = (document.getElementById('bw-confirm-pw')?.value || '').trim();

  if (!curPw) return showBootstrapError('Please enter your current password.');
  if (!newPw) return showBootstrapError('Please enter a new password.');
  if (newPw.length < 8) return showBootstrapError('New password must be at least 8 characters long.');
  if (newPw !== confirmPw) return showBootstrapError('New passwords do not match.');
  if (curPw === newPw) return showBootstrapError('New password cannot be identical to current password.');

  var btn = document.getElementById('bw-btn-step1');
  if (btn) { btn.disabled = true; btn.textContent = 'Updating Password…'; }

  var token = sessionStorage.getItem('eams_token');
  fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ currentPassword: curPw, newPassword: newPw })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = 'Next: Department Setup →'; }
      if (res.error) {
        return showBootstrapError(res.error);
      }
      showToast('Password updated successfully', 'success');
      showBootstrapStep(2);
    })
    .catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Next: Department Setup →'; }
      showBootstrapError('Network error while updating password: ' + err.message);
    });
}

function submitBootstrapStep2() {
  var name = (document.getElementById('bw-dept-name')?.value || '').trim();
  var code = (document.getElementById('bw-dept-code')?.value || '').trim().toUpperCase();
  var number = (document.getElementById('bw-dept-num')?.value || '').trim();
  var courseType = document.getElementById('bw-dept-course')?.value || 'UG';
  var branch = document.getElementById('bw-dept-branch')?.value || 'B.E';

  if (!name) return showBootstrapError('Please enter department name.');
  if (!code) return showBootstrapError('Please enter department code.');

  var btn = document.getElementById('bw-btn-step2');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating Department…'; }

  var token = sessionStorage.getItem('eams_token');
  fetch('/api/bootstrap/department', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ name: name, code: code, number: number, courseType: courseType, branch: branch })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = 'Next: Staff Profile →'; }
      if (res.error) {
        return showBootstrapError(res.error);
      }
      _bootstrapState.department = res.department;
      showToast('Department created successfully', 'success');
      showBootstrapStep(3);
    })
    .catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Next: Staff Profile →'; }
      showBootstrapError('Network error while creating department: ' + err.message);
    });
}

function submitBootstrapStep3() {
  var fullName = (document.getElementById('bw-prof-name')?.value || '').trim();
  var employeeNo = (document.getElementById('bw-prof-emp')?.value || '').trim();
  var designation = (document.getElementById('bw-prof-desig')?.value || '').trim();
  var email = (document.getElementById('bw-prof-email')?.value || '').trim();

  if (!fullName || fullName.length < 2) return showBootstrapError('Please enter a valid full name.');

  var btn = document.getElementById('bw-btn-step3');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving Profile…'; }

  var token = sessionStorage.getItem('eams_token');
  fetch('/api/bootstrap/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ fullName: fullName, employeeNo: employeeNo, designation: designation, email: email })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = 'Complete Bootstrap Setup →'; }
      if (res.error) {
        return showBootstrapError(res.error);
      }
      _bootstrapState.profile = { fullName: fullName, employeeNo: employeeNo, designation: designation, email: email };
      try { sessionStorage.removeItem('eams_bootstrapPending'); } catch (e) { }
      showToast('Bootstrap setup completed successfully', 'success');
      showBootstrapStep(4);
    })
    .catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Complete Bootstrap Setup →'; }
      showBootstrapError('Network error while saving profile: ' + err.message);
    });
}

function finishBootstrapAndLogout() {
  var token = sessionStorage.getItem('eams_token');
  try { sessionStorage.clear(); } catch (e) { }

  if (token) {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    }).finally(function () {
      window.location.replace('index.html?bootstrap=complete');
    });
  } else {
    window.location.replace('index.html?bootstrap=complete');
  }
}

// ─── SEARCHABLE DROPDOWNS INITIALIZATION ─────────────────────────────────────
function initAdminSearchableDropdowns() {
  if (typeof SearchableDropdown === 'undefined') return;

  // 1. Assigned Room / Hall in Add Class & Edit Class Modals
  SearchableDropdown.attach('nc-room', {
    kind: 'room',
    placeholder: '— Select Room / Hall —',
    searchPlaceholder: 'Search room, hall, building…'
  });
  SearchableDropdown.attach('ec-room', {
    kind: 'room',
    placeholder: '— Select Room / Hall —',
    searchPlaceholder: 'Search room, hall, building…'
  });

  // 2. Student Management page filters (Department & Class with search; Batch, Course Type, Section without search)
  SearchableDropdown.attach('sf-batch', {
    kind: 'batch',
    search: false,
    placeholder: 'All Batches'
  });
  SearchableDropdown.attach('sf-ct', {
    kind: 'ct',
    search: false,
    placeholder: 'All'
  });
  SearchableDropdown.attach('sf-dept', {
    kind: 'dept',
    placeholder: 'All Departments',
    searchPlaceholder: 'Search department name, code…'
  });
  SearchableDropdown.attach('sf-cls', {
    kind: 'class',
    placeholder: 'All Classes',
    searchPlaceholder: 'Search class, section, batch…'
  });

  // 3. Department & Class in Add Student Modal
  SearchableDropdown.attach('stu-dept', {
    kind: 'dept',
    placeholder: 'Select department',
    showIcon: false,
    searchPlaceholder: 'Search department name, code…'
  });
  SearchableDropdown.attach('stu-class', {
    kind: 'class',
    placeholder: 'Select class',
    showIcon: false,
    searchPlaceholder: 'Search class, section, batch…'
  });

  // 4. Department & Class in Edit Student Modal
  SearchableDropdown.attach('edit-dept', {
    kind: 'dept',
    placeholder: 'Select department',
    showIcon: false,
    searchPlaceholder: 'Search department name, code…'
  });
  SearchableDropdown.attach('edit-class', {
    kind: 'class',
    placeholder: 'Select class',
    showIcon: false,
    searchPlaceholder: 'Search class, section, batch…'
  });

  // 5. Class Advisor in Class Detail Modal
  SearchableDropdown.attach('cd-advisor-select', {
    kind: 'advisor',
    compact: true,
    showIcon: false,
    minWidth: '200px',
    maxWidth: '260px',
    placeholder: '— None (Unassigned) —',
    searchPlaceholder: 'Search faculty name, ID…'
  });

  // 5b. Class Advisor in Assign Class Advisor Modal Popup
  if (document.getElementById('adv-modal-select')) {
    SearchableDropdown.attach('adv-modal-select', {
      kind: 'advisor',
      showIcon: true,
      width: '100%',
      placeholder: '— None (Unassigned) —',
      searchPlaceholder: 'Search faculty name, ID, dept…',
      search: true
    });
  }

  // 5c. Class Representatives in Assign Class Representatives Modal Popup
  if (document.getElementById('rep-modal-select-1')) {
    SearchableDropdown.attach('rep-modal-select-1', {
      kind: 'student',
      showIcon: true,
      width: '100%',
      placeholder: '— Select Primary Representative —',
      searchPlaceholder: 'Search student name, register no…',
      search: true
    });
  }
  if (document.getElementById('rep-modal-select-2')) {
    SearchableDropdown.attach('rep-modal-select-2', {
      kind: 'student',
      showIcon: true,
      width: '100%',
      placeholder: '— None (Optional) —',
      searchPlaceholder: 'Search student name, register no…',
      search: true
    });
  }

  // 6. Assign Subject to Class Modal (Subject and Teacher fallback)
  if (document.getElementById('as-subj')) {
    SearchableDropdown.attach('as-subj', {
      kind: 'subject',
      placeholder: '— Select Subject —',
      searchPlaceholder: 'Search subject name, code…'
    });
  }
  if (document.getElementById('as-tch')) {
    SearchableDropdown.attach('as-tch', {
      kind: 'teacher',
      placeholder: '— Select Teacher —',
      searchPlaceholder: 'Search teacher name, ID, dept…'
    });
  }

  // 7. Teacher Management page filters (Department & Designation with live search)
  SearchableDropdown.attach('tf-dept', {
    kind: 'dept',
    placeholder: 'All Departments',
    searchPlaceholder: 'Search department name, code…',
    search: true
  });
  SearchableDropdown.attach('tf-desig', {
    kind: 'desig',
    placeholder: 'All Designations',
    searchPlaceholder: 'Search designation…',
    search: true
  });

  // 8. Department & Designation in Add Teacher Modal
  if (document.getElementById('t-dp')) {
    SearchableDropdown.attach('t-dp', {
      kind: 'dept',
      placeholder: '— Select —',
      showIcon: false,
      searchPlaceholder: 'Search department name, code…',
      search: true
    });
  }
  if (document.getElementById('t-dg')) {
    SearchableDropdown.attach('t-dg', {
      kind: 'desig',
      placeholder: 'Select designation',
      showIcon: false,
      searchPlaceholder: 'Search designation…',
      search: true
    });
  }
}

// Auto-run if DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminSearchableDropdowns);
} else {
  initAdminSearchableDropdowns();
}

// ─── ADMIN GRIEVANCES MODULE (SUDO / SUPER) ──────────────────────────────
var _adminGrievances = [];
var _adminGrievActive = null;

function initGrievancesPage() {
  loadAdminGrievances();
}
window.initGrievancesPage = initGrievancesPage;

function loadAdminGrievances() {
  var tbody = document.getElementById('admin-grievance-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--tmu);"><span class="spin"></span> Loading faculty grievances…</td></tr>';

  fetch('/api/grievances', {
    headers: {
      'Authorization': 'Bearer ' + (sessionStorage.getItem('eams_token') || localStorage.getItem('eams_token') || '')
    }
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    _adminGrievances = Array.isArray(data) ? data : [];
    updateAdminGrievanceKPIs();
    filterAdminGrievances();
  })
  .catch(function(err) {
    console.error('[Load Admin Grievances Error]:', err);
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--red);">Failed to load grievances: ' + escapeHtml(err.message) + '</td></tr>';
    dbToast('Error loading grievances', 'error');
  });
}
window.loadAdminGrievances = loadAdminGrievances;

function fetchAdminGrievanceBadge() {
  var tok = sessionStorage.getItem('eams_token') || localStorage.getItem('eams_token') || '';
  if (!tok) return;
  fetch('/api/grievances', { headers: { 'Authorization': 'Bearer ' + tok } })
    .then(function(r) { return r.json(); })
    .then(function(list) {
      if (!Array.isArray(list)) return;
      var actionNeeded = list.filter(function(g) { return g.status === 'Pending' || g.status === 'In Progress'; }).length;
      var badge = document.getElementById('sn-grievance-badge');
      if (badge) {
        badge.textContent = actionNeeded;
        badge.style.display = actionNeeded > 0 ? 'inline-block' : 'none';
      }
    })
    .catch(function() {});
}
window.fetchAdminGrievanceBadge = fetchAdminGrievanceBadge;

function updateAdminGrievanceKPIs() {
  var total = _adminGrievances.length;
  var pending = _adminGrievances.filter(function(g) { return g.status === 'Pending'; }).length;
  var inProgress = _adminGrievances.filter(function(g) { return g.status === 'In Progress'; }).length;
  var resolved = _adminGrievances.filter(function(g) { return g.status === 'Resolved'; }).length;
  var cancelled = _adminGrievances.filter(function(g) { return g.status === 'Cancelled'; }).length;

  var totalEl = document.getElementById('admin-griev-total');
  var pendingEl = document.getElementById('admin-griev-pending');
  var progEl = document.getElementById('admin-griev-progress');
  var resEl = document.getElementById('admin-griev-resolved');

  if (totalEl) totalEl.textContent = total;
  if (pendingEl) pendingEl.textContent = pending;
  if (progEl) progEl.textContent = inProgress;
  if (resEl) resEl.textContent = resolved;

  // Update Status Filter Pill counters
  var pillAll = document.getElementById('pill-cnt-all');
  var pillPend = document.getElementById('pill-cnt-pending');
  var pillProg = document.getElementById('pill-cnt-progress');
  var pillRes = document.getElementById('pill-cnt-resolved');
  var pillDec = document.getElementById('pill-cnt-declined');

  if (pillAll) pillAll.textContent = total;
  if (pillPend) pillPend.textContent = pending;
  if (pillProg) pillProg.textContent = inProgress;
  if (pillRes) pillRes.textContent = resolved;
  if (pillDec) pillDec.textContent = cancelled;

  // Sidebar badge
  var badge = document.getElementById('sn-grievance-badge');
  if (badge) {
    var actionNeeded = pending + inProgress;
    badge.textContent = actionNeeded;
    badge.style.display = actionNeeded > 0 ? 'inline-block' : 'none';
  }
}

function setAdminGrievanceStatusPill(status) {
  var pills = document.querySelectorAll('.admin-griev-pill');
  pills.forEach(function(p) {
    if (p.getAttribute('data-status') === status) {
      p.classList.add('act');
    } else {
      p.classList.remove('act');
    }
  });
  var statusSel = document.getElementById('admin-griev-filter-status');
  if (statusSel) {
    statusSel.value = status;
  }
  filterAdminGrievances();
}
window.setAdminGrievanceStatusPill = setAdminGrievanceStatusPill;

function filterAdminGrievances() {
  var q = (document.getElementById('admin-griev-search') ? document.getElementById('admin-griev-search').value : '').toLowerCase().trim();
  var status = document.getElementById('admin-griev-filter-status') ? document.getElementById('admin-griev-filter-status').value : 'all';
  var cat = document.getElementById('admin-griev-filter-cat') ? document.getElementById('admin-griev-filter-cat').value : 'all';
  var prio = document.getElementById('admin-griev-filter-prio') ? document.getElementById('admin-griev-filter-prio').value : 'all';

  // Synchronize pill active state with dropdown selection
  var pills = document.querySelectorAll('.admin-griev-pill');
  pills.forEach(function(p) {
    if (p.getAttribute('data-status') === status) {
      p.classList.add('act');
    } else {
      p.classList.remove('act');
    }
  });

  var isSuper = isCurrentUserSuperAdmin();
  var myDept = getCurrentUserDeptInfo().name;

  var filtered = _adminGrievances.filter(function(g) {
    if (!isSuper && myDept && g.teacherDept && g.teacherDept !== myDept) {
      return false;
    }
    if (status !== 'all' && g.status !== status) return false;
    if (cat !== 'all' && g.category !== cat) return false;
    if (prio !== 'all' && (g.priority || 'Normal') !== prio) return false;
    if (q) {
      var matchSubj = (g.subject || '').toLowerCase().includes(q);
      var matchDetail = (g.detail || '').toLowerCase().includes(q);
      var matchTch = (g.teacherName || '').toLowerCase().includes(q);
      var matchCat = (g.category || '').toLowerCase().includes(q);
      var matchId = (g._id || '').toLowerCase().includes(q);
      if (!matchSubj && !matchDetail && !matchTch && !matchCat && !matchId) return false;
    }
    return true;
  });

  renderAdminGrievancesTable(filtered);
}
window.filterAdminGrievances = filterAdminGrievances;

function onAdminGrievanceSearch() {
  filterAdminGrievances();
}
window.onAdminGrievanceSearch = onAdminGrievanceSearch;

function resetAdminGrievanceFilters() {
  if (document.getElementById('admin-griev-search')) document.getElementById('admin-griev-search').value = '';
  if (document.getElementById('admin-griev-filter-status')) document.getElementById('admin-griev-filter-status').value = 'all';
  if (document.getElementById('admin-griev-filter-cat')) document.getElementById('admin-griev-filter-cat').value = 'all';
  if (document.getElementById('admin-griev-filter-prio')) document.getElementById('admin-griev-filter-prio').value = 'all';
  setAdminGrievanceStatusPill('all');
}
window.resetAdminGrievanceFilters = resetAdminGrievanceFilters;

function getSelectedGrievanceIds() {
  var items = document.querySelectorAll('.chk-grievance-item:checked');
  var ids = [];
  items.forEach(function(item) { ids.push(item.value); });
  return ids;
}

function updateBatchBar() {
  var ids = getSelectedGrievanceIds();
  var bar = document.getElementById('admin-griev-batch-bar');
  var countEl = document.getElementById('batch-selected-count');
  if (bar) {
    bar.style.display = ids.length > 0 ? 'inline-flex' : 'none';
  }
  if (countEl) {
    countEl.textContent = ids.length;
  }
}
window.updateBatchBar = updateBatchBar;

function toggleSelectAllGrievances(checked) {
  var items = document.querySelectorAll('.chk-grievance-item');
  items.forEach(function(cb) { cb.checked = checked; });
  updateBatchBar();
}
window.toggleSelectAllGrievances = toggleSelectAllGrievances;

function onGrievanceCheckboxChange() {
  var items = document.querySelectorAll('.chk-grievance-item');
  var checkedItems = document.querySelectorAll('.chk-grievance-item:checked');
  var chkAll = document.getElementById('chk-all-grievances');
  if (chkAll) {
    if (checkedItems.length === 0) {
      chkAll.checked = false;
      chkAll.indeterminate = false;
    } else if (checkedItems.length === items.length) {
      chkAll.checked = true;
      chkAll.indeterminate = false;
    } else {
      chkAll.checked = false;
      chkAll.indeterminate = true;
    }
  }
  updateBatchBar();
}
window.onGrievanceCheckboxChange = onGrievanceCheckboxChange;

function renderAdminGrievancesTable(list) {
  var tbody = document.getElementById('admin-grievance-tbody');
  if (!tbody) return;

  var chkAll = document.getElementById('chk-all-grievances');
  if (chkAll) {
    chkAll.checked = false;
    chkAll.indeterminate = false;
  }
  updateBatchBar();

  if (!list || !list.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:36px;color:var(--tmu);">'
      + '<re-icon icon="inbox" size="28" style="display:block;margin:0 auto 8px;color:var(--tmu);"></re-icon>'
      + 'No grievances found matching the selected filters.'
      + '</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(function(g) {
    var dateFormatted = g.createdAt ? new Date(g.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    var timeRelative = g.createdAt ? timeAgo(g.createdAt) : '';
    var ticketShort = '#' + String(g._id).slice(-6).toUpperCase();

    var statusColor = '#f59e0b';
    var statusBg = '#fef3c7';
    if (g.status === 'Resolved') { statusColor = '#10b981'; statusBg = '#ecfdf5'; }
    else if (g.status === 'In Progress') { statusColor = '#2563eb'; statusBg = '#eff6ff'; }
    else if (g.status === 'Cancelled') { statusColor = '#ef4444'; statusBg = '#fef2f2'; }

    var prioColor = '#64748b';
    var prioBg = '#f1f5f9';
    if (g.priority === 'Urgent') { prioColor = '#dc2626'; prioBg = '#fee2e2'; }
    else if (g.priority === 'High') { prioColor = '#d97706'; prioBg = '#fef3c7'; }
    else if (g.priority === 'Low') { prioColor = '#059669'; prioBg = '#d1fae5'; }

    var resolutionSnippet = '—';
    if (g.status === 'Resolved') {
      resolutionSnippet = '<div style="font-size:11px;color:#047857;font-weight:600;"><re-icon icon="check-circle" size="12"></re-icon> ' + escapeHtml(g.resolvedBy || 'Admin') + '</div>'
        + (g.resolutionNote ? '<div style="font-size:10.5px;color:var(--tmu);margin-top:2px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(g.resolutionNote) + '">' + escapeHtml(g.resolutionNote) + '</div>' : '');
    } else if (g.status === 'Cancelled') {
      resolutionSnippet = '<div style="font-size:11px;color:#dc2626;font-weight:600;"><re-icon icon="x-circle" size="12"></re-icon> Declined</div>'
        + (g.resolutionNote ? '<div style="font-size:10.5px;color:var(--tmu);margin-top:2px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(g.resolutionNote) + '">' + escapeHtml(g.resolutionNote) + '</div>' : '');
    }

    // Easy solving options buttons
    var actionsHtml = '';
    if (g.status !== 'Resolved') {
      actionsHtml += '<button class="btn btn-sm btn-pri" onclick="quickSolveGrievance(\'' + g._id + '\')" style="padding:4px 8px;font-size:11.5px;display:inline-flex;align-items:center;gap:4px;" title="Quick Solve"><re-icon icon="check" size="12"></re-icon> Solve</button> ';
    }
    actionsHtml += '<button class="btn btn-sm btn-out" onclick="openSolveGrievanceModal(\'' + g._id + '\')" style="padding:4px 8px;font-size:11.5px;display:inline-flex;align-items:center;gap:4px;" title="Review & Action"><re-icon icon="edit" size="12"></re-icon> Action</button> ';
    if (g.status === 'Pending') {
      actionsHtml += '<button class="btn btn-sm btn-danger-out" onclick="quickDeclineGrievance(\'' + g._id + '\')" style="padding:4px 7px;font-size:11.5px;color:#ef4444;border-color:rgba(239,68,68,.3);" title="Decline"><re-icon icon="x" size="12"></re-icon></button>';
    }

    return '<tr>'
      + '<td style="text-align:center;"><input type="checkbox" class="chk-grievance-item" value="' + g._id + '" onchange="onGrievanceCheckboxChange()"></td>'
      + '<td><div><strong style="color:var(--td);font-size:12px;">' + ticketShort + '</strong></div><div style="font-size:10.5px;color:var(--tmu);margin-top:2px;">' + dateFormatted + '</div><div style="font-size:10px;color:var(--tdi);">' + timeRelative + '</div></td>'
      + '<td><div style="font-weight:700;color:var(--td);">' + escapeHtml(g.teacherName || 'Faculty') + '</div></td>'
      + '<td><span class="bge" style="font-size:11px;">' + escapeHtml(g.teacherDept || 'General') + '</span></td>'
      + '<td><div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start;">'
      + '  <span style="font-size:11px;font-weight:600;color:var(--td);">' + escapeHtml(g.category || 'Other') + '</span>'
      + '  <span style="font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:10px;background:' + prioBg + ';color:' + prioColor + ';">' + escapeHtml(g.priority || 'Normal') + '</span>'
      + '</div></td>'
      + '<td><div style="font-weight:700;color:var(--td);font-size:13px;margin-bottom:3px;">' + escapeHtml(g.subject) + '</div>'
      + '    <div style="font-size:11.5px;color:var(--tmu);line-height:1.45;max-width:280px;">' + escapeHtml(g.detail) + '</div></td>'
      + '<td><span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:12px;background:' + statusBg + ';color:' + statusColor + ';display:inline-block;">' + escapeHtml(g.status) + '</span></td>'
      + '<td>' + resolutionSnippet + '</td>'
      + '<td style="text-align:right;white-space:nowrap;">' + actionsHtml + '</td>'
      + '</tr>';
  }).join('');
}

function quickSolveGrievance(id) {
  showConfirm({
    title: 'Mark Grievance Solved?',
    message: 'Are you sure you want to resolve this faculty grievance? The teacher will be notified immediately.',
    confirmText: 'Yes, Resolve Ticket',
    cancelText: 'Cancel'
  }).then(function(confirmed) {
    if (!confirmed) return;
    updateGrievanceStatus(id, 'Resolved', 'Resolved by Admin');
  });
}
window.quickSolveGrievance = quickSolveGrievance;

function quickDeclineGrievance(id) {
  showConfirm({
    title: 'Decline Grievance?',
    message: 'Are you sure you want to decline this grievance request?',
    confirmText: 'Decline Request',
    cancelText: 'Cancel'
  }).then(function(confirmed) {
    if (!confirmed) return;
    updateGrievanceStatus(id, 'Cancelled', 'Declined by Admin');
  });
}
window.quickDeclineGrievance = quickDeclineGrievance;

function updateGrievanceStatus(id, status, note) {
  dbToast('Updating grievance status…', 'saving');
  fetch('/api/grievances/' + id, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (sessionStorage.getItem('eams_token') || localStorage.getItem('eams_token') || '')
    },
    body: JSON.stringify({ status: status, resolutionNote: note })
  })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (res.error) throw new Error(res.error);
    dbToast('Grievance marked as ' + status, 'success');
    loadAdminGrievances();
  })
  .catch(function(err) {
    dbToast('Error: ' + err.message, 'error');
  });
}
window.updateGrievanceStatus = updateGrievanceStatus;

function batchSolveSelectedGrievances() {
  var ids = getSelectedGrievanceIds();
  if (!ids.length) return;
  showConfirm({
    title: 'Resolve Selected Tickets?',
    message: 'Are you sure you want to resolve ' + ids.length + ' selected grievance ticket(s)? Each teacher will be notified immediately.',
    confirmText: 'Resolve ' + ids.length + ' Ticket' + (ids.length > 1 ? 's' : ''),
    cancelText: 'Cancel'
  }).then(function(confirmed) {
    if (!confirmed) return;
    dbToast('Resolving ' + ids.length + ' tickets…', 'saving');
    var promises = ids.map(function(id) {
      return fetch('/api/grievances/' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (sessionStorage.getItem('eams_token') || localStorage.getItem('eams_token') || '')
        },
        body: JSON.stringify({ status: 'Resolved', resolutionNote: 'Batch resolved by Admin' })
      }).then(function(r) { return r.json(); });
    });
    Promise.all(promises)
      .then(function() {
        dbToast('Successfully resolved ' + ids.length + ' grievances', 'success');
        loadAdminGrievances();
      })
      .catch(function(err) {
        dbToast('Error during batch resolution: ' + err.message, 'error');
        loadAdminGrievances();
      });
  });
}
window.batchSolveSelectedGrievances = batchSolveSelectedGrievances;

function batchProgressSelectedGrievances() {
  var ids = getSelectedGrievanceIds();
  if (!ids.length) return;
  showConfirm({
    title: 'Mark In Progress?',
    message: 'Are you sure you want to mark ' + ids.length + ' selected grievance ticket(s) as In Progress?',
    confirmText: 'Mark In Progress',
    cancelText: 'Cancel'
  }).then(function(confirmed) {
    if (!confirmed) return;
    dbToast('Updating ' + ids.length + ' tickets…', 'saving');
    var promises = ids.map(function(id) {
      return fetch('/api/grievances/' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (sessionStorage.getItem('eams_token') || localStorage.getItem('eams_token') || '')
        },
        body: JSON.stringify({ status: 'In Progress', resolutionNote: 'Investigating / in work by Admin' })
      }).then(function(r) { return r.json(); });
    });
    Promise.all(promises)
      .then(function() {
        dbToast('Successfully marked ' + ids.length + ' grievances In Progress', 'success');
        loadAdminGrievances();
      })
      .catch(function(err) {
        dbToast('Error during batch update: ' + err.message, 'error');
        loadAdminGrievances();
      });
  });
}
window.batchProgressSelectedGrievances = batchProgressSelectedGrievances;

function openSolveGrievanceModal(id) {
  var g = _adminGrievances.find(function(item) { return item._id === id; });
  if (!g) return;
  _adminGrievActive = g;

  var tEl = document.getElementById('solve-g-teacher');
  var dEl = document.getElementById('solve-g-dept');
  var sEl = document.getElementById('solve-g-subj');
  var cEl = document.getElementById('solve-g-cat');
  var pEl = document.getElementById('solve-g-prio');
  var detEl = document.getElementById('solve-g-detail');

  if (tEl) tEl.textContent = g.teacherName || '—';
  if (dEl) dEl.textContent = g.teacherDept || '—';
  if (sEl) sEl.textContent = g.subject || '—';
  if (cEl) cEl.textContent = g.category || 'Other';
  if (pEl) pEl.textContent = g.priority || 'Normal';
  if (detEl) detEl.textContent = g.detail || '—';

  var statusSel = document.getElementById('solve-g-status');
  if (statusSel) statusSel.value = g.status === 'Pending' ? 'Resolved' : g.status;

  var noteEl = document.getElementById('solve-g-note');
  if (noteEl) noteEl.value = g.resolutionNote || '';

  openModalBg('m-grievance-solve');
}
window.openSolveGrievanceModal = openSolveGrievanceModal;

function submitGrievanceResolution() {
  if (!_adminGrievActive) return;
  var statusSel = document.getElementById('solve-g-status');
  var noteEl = document.getElementById('solve-g-note');
  var status = statusSel ? statusSel.value : 'Resolved';
  var note = noteEl ? noteEl.value.trim() : '';

  updateGrievanceStatus(_adminGrievActive._id, status, note);
  closeModalBg('m-grievance-solve');
}
window.submitGrievanceResolution = submitGrievanceResolution;

function exportAdminGrievancesCSV() {
  if (!_adminGrievances || !_adminGrievances.length) {
    dbToast('No grievances to export', 'warn');
    return;
  }
  var headers = ['ID', 'Date', 'Teacher', 'Department', 'Category', 'Priority', 'Subject', 'Details', 'Status', 'Resolved By', 'Resolution Note'];
  var rows = _adminGrievances.map(function(g) {
    return [
      g._id,
      g.createdAt ? new Date(g.createdAt).toISOString() : '',
      '"' + (g.teacherName || '').replace(/"/g, '""') + '"',
      '"' + (g.teacherDept || '').replace(/"/g, '""') + '"',
      '"' + (g.category || '').replace(/"/g, '""') + '"',
      g.priority || 'Normal',
      '"' + (g.subject || '').replace(/"/g, '""') + '"',
      '"' + (g.detail || '').replace(/"/g, '""') + '"',
      g.status,
      '"' + (g.resolvedBy || '').replace(/"/g, '""') + '"',
      '"' + (g.resolutionNote || '').replace(/"/g, '""') + '"'
    ].join(',');
  });

  var csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), rows.join('\n')].join('\n');
  var encodedUri = encodeURI(csvContent);
  var link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', 'eams_grievances_' + todayIST() + '.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  dbToast('CSV exported successfully', 'success');
}
window.exportAdminGrievancesCSV = exportAdminGrievancesCSV;



