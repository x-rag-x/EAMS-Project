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

  setTimeout(function () { timerDone = true; tryReveal(); }, 500);

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

// ─── SUPPORTING DEPARTMENT SUBJECT & CLASS LINKAGE HELPERS ───
function _getDeptSubjects(dept) {
  if (!dept) return [];
  var deptIdStr = String(dept._id || '');
  var deptName = (dept.name || '').trim();
  var deptCodeClean = (dept.code || '').trim().toUpperCase();
  var allSubjs = DB.get('subjects') || [];

  return allSubjs.filter(function (s) {
    if (s.deptId && String(s.deptId) === deptIdStr) return true;
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

function renderDepartments() {
  var depts = DB.get('depts') || [];
  var classes = DB.get('classes') || [];
  var subjects = DB.get('subjects') || [];
  var grid = document.getElementById('dg2');
  grid.className = 'tgrd';

  if (!grid) return;

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
    var teacherCount = isUsersLoaded ? DB.get('users').filter(function (u) {
      return u.role === 'teacher' && (u.dept === dept.name || u.deptId === dept._id);
    }).length : '<re-icon icon="hourglass"></re-icon>';

    var isSupporting = dept.category === 'supporting';
    var catBadge = '<span style="font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:6px;background:' + (isSupporting ? 'rgba(2,132,199,0.1)' : 'var(--gLt)') + ';color:' + (isSupporting ? '#0284c7' : 'var(--gD)') + ';border:1px solid ' + (isSupporting ? 'rgba(2,132,199,0.25)' : 'rgba(16,185,129,0.25)') + ';">' + (isSupporting ? 'Supporting' : 'Programme') + '</span>';

    return '<div class="tcrd dcrd" onclick="openDeptModal(\'' + dept._id + '\', \'overview\')" style="cursor:pointer;">'
      + '<div class="tcrd-head">'
      + '<div class="tav" style="font-size:20px;">' + deptIcon(dept.icon) + '</div>'
      + '<div style="display:flex;align-items:center;gap:6px;"><span class="tcrd-code">' + dept.code + '</span>' + catBadge + '</div>'
      + '</div>'
      + '<div class="tcrd-label">Department</div>'
      + '<div class="tnm">' + dept.name + '</div>'
      + '<div class="tsts">'
      + '<div class="tst2"><div class="tst2-head"><re-icon icon="layout-grid" size="13"></re-icon>Classes</div><span class="tst2-val">' + classCount + '</span></div>'
      + '<div class="tst2"><div class="tst2-head"><re-icon icon="book-open" size="13"></re-icon>Subjects</div><span class="tst2-val">' + subjectCount + '</span></div>'
      + '<div class="tst2"><div class="tst2-head"><re-icon icon="graduation-cap" size="13"></re-icon>Students</div><span class="tst2-val">' + studentCount + '</span></div>'
      + '<div class="tst2"><div class="tst2-head"><re-icon icon="users" size="13"></re-icon>Teachers</div><span class="tst2-val">' + teacherCount + '</span></div>'
      + '</div>'
      + (typeof teacherCount === 'number' && teacherCount === 0 ? '<div class="tcrd-notice"><re-icon icon="info"></re-icon>No HoD assigned</div>' : '')
      + '</div>';
  }).join('');
}
var rdepts = renderDepartments; // alias
// Wrap dept mutations to auto-update badges
var _origRenderDepts = renderDepartments;
renderDepartments = function () { _origRenderDepts(); };

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
    var subjectCount = _loaded.subjects ? subjects.filter(function (s) { return s.deptId === dept._id; }).length : '<re-icon icon="hourglass"></re-icon>';
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

  var allSubjects = DB.get('subjects').filter(function (s) { return !deptId || s.deptId === deptId; }) || [];
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

function _renderClassGrid(classes) {
  var classGrid = document.getElementById('scg');
  if (!classGrid) return;
  classGrid.innerHTML = classes.length
    ? classes.map(function (cls) {
      var studentCount = cls.studentCount || 0;
      var assignmentCount = DB.get('assignments').filter(function (a) { return a.classId === cls._id; }).length;
      var hallDisplay = (cls.roomId && cls.roomId.hallNo) || cls.hallNo || '—';
      return '<div class="ec" onclick="openCD(\'' + cls._id + '\')">'
        + '<div class="ech"><div class="eci" style="background:var(--gLt)"><re-icon icon="chalkboard"></re-icon></div>'
        + '<div><div class="ecn">' + cls.name + '</div>'
        + '<div class="ecsu">Hall: ' + hallDisplay + ' · Sec ' + (cls.section || '—') + ' · ' + cls.deptName + '</div></div></div>'
        + '<div class="ecb"><div class="emt">' + studentCount + ' students · ' + assignmentCount + ' subjects</div></div>'
        + '</div>';
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
  var subjects = (DB.get('subjects') || []).filter(function (s) { return !deptId || s.deptId === deptId; });
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
      html += '  <td class="b">';
      html += '    <div style="font-weight:700;color:var(--td);font-size:13px;letter-spacing:0.2px;">' + displayHtml + '</div>';
      html += '    <div style="font-size:11.5px;color:var(--tmu);font-weight:normal;margin-top:2px;">' + escapeHtml(subj.name || '—') + '</div>';
      html += '  </td>';
      html += '  <td><span style="font-family:monospace;font-size:12px;font-weight:600;color:var(--gD);background:var(--gLt);padding:2px 6px;border-radius:4px;">' + escapeHtml(subj.courseCode || subj.code || subj.subjectCode || '—') + '</span></td>';
      html += '  <td><span style="font-size:11.5px;font-weight:500;color:var(--td);">' + escapeHtml(subj.type || 'Theory') + '</span></td>';
      html += '  <td><span style="font-size:12px;font-weight:600;">' + (subj.credits != null && subj.credits !== '' ? subj.credits : '—') + '</span></td>';
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
  var subjects = DB.get('subjects').filter(function (s) { return !deptId || s.deptId === deptId; }) || [];
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
}
var sst = switchStructureTab;

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
        ' data-dept="' + escapeHtml(deptCode) + '"' +
        (empNo ? ' data-sub="' + escapeHtml(empNo) + '"' : '') + '>' +
        escapeHtml(tName) +
        '</option>';
    }).join('');

    advisorSelect.innerHTML = optionsHtml;
    if (typeof SearchableDropdown !== 'undefined') {
      SearchableDropdown.sync('cd-advisor-select');
    }
  }
}

// ─── UNIFIED CLASS MANAGEMENT MODULE (Overview, Subjects, Students, Edit) ───
var _classRosterCache = null;

function _updateClassUnifiedModalHeader(cls) {
  var titleEl = document.getElementById('cd-ttl');
  var subEl = document.getElementById('cd-sub');
  if (!cls) return;

  var deptName = cls.deptName || 'Department';
  var displayHall = (cls.roomId && cls.roomId.hallNo) || cls.hallNo || '—';
  var section = cls.section || 'A';
  var batch = cls.batch || '—';
  var year = cls.year || '—';
  var sem = cls.sem || '—';

  if (titleEl) {
    titleEl.innerHTML = '<re-icon icon="chalkboard" size="20" style="flex-shrink:0;color:var(--gD);"></re-icon>'
      + '<span style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;font-family:\'Poppins\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-weight:700;">'
      + escapeHtml(cls.name || 'Class Section')
      + '<span style="font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:6px;background:var(--gLt);color:var(--gD);letter-spacing:0.3px;">SEC ' + escapeHtml(section) + '</span>'
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

  var batches = (typeof getActiveBatches === 'function' ? getActiveBatches() : (DB.get('batches') || []));
  var batchSel = document.getElementById('ec-batch');
  if (batchSel) {
    var bList = Array.isArray(batches) ? batches : [];
    batchSel.innerHTML = '<option value="">— Select Batch —</option>'
      + bList.map(function (b) {
        var val = typeof b === 'object' ? (b.name || b.batch) : b;
        var isSel = String(val) === String(cls.batch);
        return '<option value="' + escapeHtml(val) + '"' + (isSel ? ' selected' : '') + '>' + escapeHtml(val) + '</option>';
      }).join('');
    if (cls.batch) batchSel.value = cls.batch;
  }

  var secInput = document.getElementById('ec-sec');
  if (secInput) secInput.value = cls.section || '';

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
    + '<!-- 3. ADVISOR & FACILITIES ROW -->'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px;">'
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
    + '    <button type="button" class="btn-xs btn-out" onclick="switchClassTab(\'students\')"><re-icon icon="users" size="12"></re-icon> Open Students Tab</button>'
    + '  </div>'
    + '  <div class="subj-section-bd" style="padding:14px 18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;background:#fbfcfd;border-radius:8px;">'
    + '    <div style="display:flex;align-items:center;gap:10px;">'
    + '      <div style="width:36px;height:36px;border-radius:8px;background:rgba(16,185,129,0.1);color:#059669;display:flex;align-items:center;justify-content:center;font-size:16px;">'
    + '        <re-icon icon="users" size="18"></re-icon>'
    + '      </div>'
    + '      <div>'
    + '        <div style="font-size:13px;font-weight:700;color:var(--td);">' + studentCount + ' Enrolled Students in Section ' + escapeHtml(cls.section || 'A') + '</div>'
    + '        <div style="font-size:11.5px;color:var(--tmu);">Search, sort, or inspect individual register numbers in the Students Roster tab.</div>'
    + '      </div>'
    + '    </div>'
    + '    <button type="button" class="btn-out btn-sm" onclick="switchClassTab(\'students\')"><re-icon icon="arrow-right" size="13"></re-icon> View Roster</button>'
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
    container.innerHTML = '<div style="text-align:center;padding:36px 18px;color:var(--tmu);font-size:13px;background:var(--bg2,#f8faf8);">'
      + '<div style="font-size:28px;margin-bottom:6px;color:var(--tdi);"><re-icon icon="users" size="28"></re-icon></div>'
      + '<div style="font-weight:700;color:var(--td);font-size:14px;margin-bottom:4px;">Students Roster Not Loaded</div>'
      + '<div style="max-width:360px;margin:0 auto 12px;font-size:12px;color:var(--tmu);">Click below to load the live enrolled student list from the institution database.</div>'
      + '<button type="button" class="btn-pri btn-sm" onclick="loadClassStudents()"><re-icon icon="users" size="13"></re-icon> Load Students</button>'
      + '</div>';
    return;
  }

  var list = Array.isArray(students) ? students : [];
  var countEl = document.getElementById('cm-roster-count');
  if (countEl) countEl.textContent = list.length + ' Enrolled';
  var badgeEl = document.getElementById('cm-badge-stu');
  if (badgeEl) badgeEl.textContent = list.length;

  if (!list.length) {
    container.innerHTML = '<div style="text-align:center;padding:32px 18px;color:var(--tmu);font-size:13px;background:var(--bg2,#f8faf8);">'
      + '<re-icon icon="users" size="24" style="color:var(--tdi);margin-bottom:6px;"></re-icon>'
      + '<div>No students enrolled matching current criteria.</div>'
      + '</div>';
    return;
  }

  var rowsHtml = list.map(function (s, idx) {
    return '<tr style="border-bottom:1px solid var(--br);">'
      + '<td style="padding:9px 14px;font-size:12px;color:var(--tmu);font-weight:600;width:38px;">' + (idx + 1) + '</td>'
      + '<td style="padding:9px 14px;font-weight:700;color:var(--td);font-size:13px;">' + escapeHtml(s.name || 'Student') + '</td>'
      + '<td style="padding:9px 14px;font-family:monospace;font-size:12.5px;color:var(--gD);font-weight:700;">' + escapeHtml(s.regNo || '—') + '</td>'
      + '<td style="padding:9px 14px;font-size:12px;color:var(--tmu);">' + escapeHtml(s.rollNo || s.roll || '—') + '</td>'
      + '<td style="padding:9px 14px;text-align:right;">'
      + '  <span class="pill pri" style="font-size:11px;padding:2px 8px;border-radius:10px;">Enrolled</span>'
      + '</td>'
      + '</tr>';
  }).join('');

  container.innerHTML = '<table class="tbl" style="width:100%;margin:0;border-collapse:collapse;">'
    + '<thead><tr style="background:#f8fafc;border-bottom:1px solid var(--br);">'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">#</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Student Name</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Register No.</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:left;text-transform:uppercase;">Roll No.</th>'
    + '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tmu);text-align:right;text-transform:uppercase;">Status</th>'
    + '</tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody>'
    + '</table>';
}

function filterClassRoster(query) {
  var q = (query || '').trim().toLowerCase();
  if (!_classRosterCache) return;
  var cls = DB.get('classes').find(function (c) { return c._id === currentClassId; });
  if (!q) {
    _renderClassStudentsTab(cls, _classRosterCache);
    return;
  }
  var filtered = _classRosterCache.filter(function (s) {
    var name = (s.name || '').toLowerCase();
    var reg = (s.regNo || '').toLowerCase();
    var roll = (s.rollNo || s.roll || '').toLowerCase();
    return name.includes(q) || reg.includes(q) || roll.includes(q);
  });
  _renderClassStudentsTab(cls, filtered);
}
window.filterClassRoster = filterClassRoster;

function loadClassStudents() {
  if (!currentClassId) return;
  var container = document.getElementById('cm-roster-container');
  var loadBtn = document.getElementById('cm-full-load-stus-btn');

  if (loadBtn) {
    loadBtn.disabled = true;
    loadBtn.innerHTML = '<re-icon icon="hourglass" size="13"></re-icon> Loading roster…';
  }
  if (container) {
    container.innerHTML = '<div style="text-align:center;padding:28px 18px;color:var(--tmu);font-size:13px;"><re-icon icon="hourglass" size="20"></re-icon><div style="margin-top:6px;">Loading enrolled student roster…</div></div>';
  }

  var tok = getToken();
  if (!tok) {
    if (loadBtn) {
      loadBtn.disabled = false;
      loadBtn.innerHTML = '<re-icon icon="refresh" size="13"></re-icon> Refresh Roster';
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
        loadBtn.innerHTML = '<re-icon icon="refresh" size="13"></re-icon> Refresh Roster';
      }
    })
    .catch(function (err) {
      console.warn('Failed to load roster:', err);
      if (container) {
        container.innerHTML = '<div style="text-align:center;padding:24px;color:#dc2626;font-size:12.5px;"><re-icon icon="alert-circle" size="18"></re-icon><div style="margin-top:4px;">Failed to load student roster. Please check network connection.</div></div>';
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
  if (!rm && cls.roomId && _facilityRooms.length) {
    rm = _facilityRooms.find(function (r) { return String(r._id) === String(cls.roomId); });
  }
  if (!rm && cls.hallNo && _facilityRooms.length) {
    rm = _facilityRooms.find(function (r) {
      return (r.hallNo && r.hallNo.toLowerCase() === cls.hallNo.toLowerCase()) ||
        (r.name && r.name.toLowerCase() === cls.hallNo.toLowerCase());
    });
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
      var bInfo = typeof rm.board === 'object' ? (rm.board.boardId || 'Board Online') : 'Board Linked';
      subParts.push('<re-icon icon="tv"></re-icon> ' + bInfo);
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
  var section = (document.getElementById('ec-sec').value || '').trim() || cls.section;
  if (dept && batch && section) {
    var batchV = formatBatchShort(batch);
    document.getElementById('ec-nm').value = batchV + ' ' + dept.code + '-' + section;
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
  var section = (getFieldValue('ec-sec') || '').trim();
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
  var batch = getFieldValue('ec-batch');
  var dept = DB.get('depts').find(function (d) { return d && (d._id === deptId || (cls && d._id === cls.deptId)); });
  var deptName = dept ? dept.name : (cls ? cls.deptName : '');
  var name = getFieldValue('ec-nm') || (dept ? (formatBatchShort(batch) + ' ' + dept.code + '-' + section) : (cls ? cls.name : ''));

  if (!section) {
    showToast('Section is required', 'warn');
    return;
  }

  dbToast('Saving changes...', 'saving');
  apiUpdateClass(currentClassId, { section: section, roomId: roomId, hallNo: hallNo, name: name, year: year, sem: sem, batch: batch, deptId: deptId, deptName: deptName }).then(function (d) {
    if (!d || d.error) {
      dbToast('Update failed: ' + (d && d.error ? d.error : 'Unknown'), 'error');
      return;
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
        var empNo = (t.empId || t.employeeNo || '').trim();
        var deptCode = resolveTeacherDeptCode(t, cls);
        return '<option value="' + tid + '"' + sel + '>' + escapeHtml(tName) + ' (' + escapeHtml(deptCode) + (empNo ? ' • ' + escapeHtml(empNo) : '') + ')</option>';
      }).join('');
      optionsHtml += '</optgroup>';
    }

    if (otherTeachers.length) {
      optionsHtml += '<optgroup label="Other Department Faculty">';
      optionsHtml += otherTeachers.map(function (t) {
        var tid = t._id || t.shadowId || t.trackId;
        var sel = (String(tid) === String(selectedId) || (assignedTeacher && String(t.trackId) === String(assignedTeacher.trackId))) ? ' selected' : '';
        var tName = (t.name || t.fullName || 'Teacher').trim();
        var empNo = (t.empId || t.employeeNo || '').trim();
        var deptCode = resolveTeacherDeptCode(t, cls);
        return '<option value="' + tid + '"' + sel + '>' + escapeHtml(tName) + ' (' + escapeHtml(deptCode) + (empNo ? ' • ' + escapeHtml(empNo) : '') + ')</option>';
      }).join('');
      optionsHtml += '</optgroup>';
    }

    selectEl.innerHTML = optionsHtml;
  }

  openModal_('m-assign-advisor');
}

function closeAdvisorModal(returnToDetail) {
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
      if (structureContext.deptId) renderClassSubjectView(structureContext.deptId);
      dbToast('Class Advisor saved successfully', 'success');

      return syncUsersWithTeacherDetails().then(function () {
        return apiCall('GET', '/teachers').then(function (list) {
          if (Array.isArray(list)) _teacherData = list;
          _populateClassAdvisorSection(cls, _getAllTeachersList());
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

window.openAdvisorModal = openAdvisorModal;
window.closeAdvisorModal = closeAdvisorModal;
window.saveClassAdvisorFromModal = saveClassAdvisorFromModal;
window.resolveTeacherDeptCode = resolveTeacherDeptCode;

function _buildCaSubjectOptions(selectedId, deptId) {
  var subjects = DB.get('subjects') || [];
  if (!Array.isArray(subjects)) subjects = [];

  // Prioritize department subjects if deptId matches
  var listToRender = subjects;
  if (deptId) {
    var deptMatches = subjects.filter(function (s) {
      return String(s.deptId || '') === String(deptId) || String(s.departmentId || '') === String(deptId);
    });
    if (deptMatches.length > 0) {
      var otherSubjects = subjects.filter(function (s) {
        return String(s.deptId || '') !== String(deptId) && String(s.departmentId || '') !== String(deptId);
      });
      listToRender = deptMatches.concat(otherSubjects);
    }
  }

  return '<option value="">— Select Subject —</option>'
    + listToRender.map(function (s) {
      var sName = (s.name || 'Subject').trim();
      var code = (s.courseCode || s.code || s.shortForm || '').trim();
      var isSel = (String(s._id) === String(selectedId)) ? ' selected' : '';
      var credits = (s.credits != null) ? s.credits + ' Credits' : '';
      return '<option value="' + s._id + '"'
        + ' data-name="' + escapeHtml(sName) + '"'
        + (code ? ' data-badge="' + escapeHtml(code) + '"' : '')
        + (credits ? ' data-sub="' + escapeHtml(credits) + '"' : '')
        + isSel + '>'
        + escapeHtml(sName + (code ? ' (' + code + ')' : ''))
        + '</option>';
    }).join('');
}

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
    regulation: regulation
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
  var sem = getFieldValue('nc-sem');
  var section = (document.getElementById('nc-sec').value || '').trim();
  var dept = DB.get('depts').find(function (d) { return d._id === deptId; });
  var nameEl = document.getElementById('nc-name');
  var warnEl = document.getElementById('nc-warn');
  var addBtn = document.getElementById('nc-add-btn');
  if (dept && batch && section) {
    var batchV = formatBatchShort(batch);
    var autoName = batchV + ' ' + dept.code + '-' + section;
    nameEl.value = autoName;
    // Check duplicate
    var dup = DB.get('classes').find(function (cls) {
      return cls.deptId === deptId && cls.batch === batch && cls.section === section;
    });
    if (dup) {
      warnEl.innerHTML = '<re-icon icon="alert-triangle"></re-icon> Class "' + autoName + '" already exists for this department/batch/section.';
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
  if (deptSel) deptSel.value = structureContext.deptId;

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
    addBtn.disabled = false;
    addBtn.style.opacity = '1';
    addBtn.style.cursor = 'pointer';
  }
  var crEl = document.getElementById('ns-cr');
  if (crEl) crEl.value = '3';
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
        addBtn.disabled = true;
        addBtn.style.opacity = '0.5';
        addBtn.style.cursor = 'not-allowed';
      }
    } else {
      if (warnEl) warnEl.style.display = 'none';
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.style.opacity = '1';
        addBtn.style.cursor = 'pointer';
      }
    }
  } else {
    if (warnEl) warnEl.style.display = 'none';
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.style.opacity = '1';
      addBtn.style.cursor = 'pointer';
    }
  }
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
    regulation: regulation
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
  var res = document.getElementById('sf-residency') ? document.getElementById('sf-residency').value : '';
  _studentFilterSnapshot = { ay: ay, batch: batch, ct: ct, dept: dept, cls: cls, res: res };
  var params = '?page=' + (page || 1) + '&limit=65&sortBy=' + encodeURIComponent(_studentSortBy) + '&sortDir=' + _studentSortDir;
  if (ay) params += '&academicYear=' + encodeURIComponent(ay);
  if (batch) params += '&batch=' + encodeURIComponent(batch);
  if (ct) params += '&courseType=' + encodeURIComponent(ct);
  if (dept) params += '&deptId=' + encodeURIComponent(dept);
  if (cls) params += '&classId=' + encodeURIComponent(cls);
  if (res) params += '&residency=' + encodeURIComponent(res);
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
      + '<td>' + (student.batch || '—') + '</td>'
      + '<td>' + (student.courseType || '—') + '</td>'
      + '<td>' + (student.branch || student.deptName || '—') + '</td>'
      + '<td>' + (student.deptName || '—') + '</td>'
      + '<td>' + (student.className || '—') + ((student.residency === 'hostel' || student.residency === 'hosteler') ? ' <span class="bge bgb" style="font-size:10px;padding:1px 5px;border-radius:4px;" title="Hosteler">Hostel</span>' : ' <span class="bge bgg" style="font-size:10px;padding:1px 5px;border-radius:4px;" title="Dayscholar">Day</span>') + ((student.gender === 'Female' || student.gender === 'female') ? ' <span class="bge" style="background:#fce4ec;color:#c2185b;font-size:10px;padding:1px 5px;border-radius:4px;" title="Female">F</span>' : ' <span class="bge" style="background:#e3f2fd;color:#1976d2;font-size:10px;padding:1px 5px;border-radius:4px;" title="Male">M</span>') + '</td>'
      + '<td><button class="btn bgho bxs" onclick="openStuEdit(\'' + student._id + '\')" title="Edit Student"><re-icon icon="edit"></re-icon></button></td>'
      + '</tr>';
  }).join('');
  if (append) {
    tbody.insertAdjacentHTML('beforeend', rows);
  } else {
    tbody.innerHTML = rows || '<tr><td colspan="9" style="text-align:center;padding:36px 16px;color:var(--tdi);">'
      + '<span style="font-size:38px;display:block;margin-bottom:10px;"><re-icon icon="graduation-cap"></re-icon></span>'
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
function filterStudentsLive(query) {
  _studentSearchQuery = (query || '').toLowerCase();
  if (!_studentData.length) {
    // No data loaded yet — do nothing (search is live only on loaded data)
    return;
  }
  var filtered = _studentData.filter(function (s) {
    if (!_studentSearchQuery) return true;
    return (s.name || '').toLowerCase().indexOf(_studentSearchQuery) !== -1
      || (s.regNo || '').toLowerCase().indexOf(_studentSearchQuery) !== -1
      || (s.batch || '').toLowerCase().indexOf(_studentSearchQuery) !== -1;
  });
  var countEl = document.getElementById('scb');
  var tbody = document.getElementById('stb');
  if (countEl) countEl.textContent = _studentTotal + ' student' + (_studentTotal === 1 ? '' : 's')
    + (_studentSearchQuery ? ' (' + filtered.length + ' shown)' : '');
  if (tbody) {
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:36px 16px;color:var(--tdi);">'
        + '<span style="font-size:38px;display:block;margin-bottom:10px;"><re-icon icon="search"></re-icon></span>'
        + '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">No students match your search.</div>'
        + '</td></tr>';
    } else {
      tbody.innerHTML = filtered.map(function (student, idx) {
        return '<tr>'
          + '<td>' + (idx + 1) + '</td>'
          + '<td class="b">' + (student.name || '—') + '</td>'
          + '<td>' + (student.regNo || '—') + '</td>'
          + '<td>' + (student.batch || '—') + '</td>'
          + '<td>' + (student.courseType || '—') + '</td>'
          + '<td>' + (student.branch || student.deptName || '—') + '</td>'
          + '<td>' + (student.deptName || '—') + '</td>'
          + '<td>' + (student.className || '—') + '</td>'
          + '<td><button class="btn bgho bxs" onclick="openStuEdit(\'' + student._id + '\')"><re-icon icon="edit"></re-icon></button></td>'
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
  else if (type === 'None') {
    options += `
      <option value="None">None</option>
      <option value="N/A">N/A</option>
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
  var inputEl = document.getElementById('edit-name');
  var raw = inputEl ? inputEl.value : '';
  var stripped = raw.replace(/[.,\/\\;:_]+/g, ' ');
  if (stripped !== raw && inputEl) {
    var cursor = inputEl.selectionStart;
    inputEl.value = stripped;
    if (cursor !== null) inputEl.setSelectionRange(cursor, cursor);
  }
  var clean = sanitizeFullName(stripped);
  var split = splitFirstLastName(clean);
  var fnEl = document.getElementById('edit-firstName');
  var lnEl = document.getElementById('edit-lastName');
  if (fnEl) fnEl.value = split.firstName;
  if (lnEl) lnEl.value = split.lastName;
}

function saveStuEdit() {
  var rawName = getFieldValue('edit-name');
  var name = sanitizeFullName(rawName);
  var split = splitFirstLastName(name);
  var firstName = sanitizeFullName(getFieldValue('edit-firstName')) || split.firstName;
  var lastName = sanitizeFullName(getFieldValue('edit-lastName'));
  if (!lastName && split.lastName) lastName = split.lastName;

  var regNo = getFieldValue('edit-regNo');
  var year = getFieldValue('edit-year');
  var ct = getFieldValue('edit-courseType');
  var batch = getFieldValue('edit-batch');
  var trackId = getFieldValue('edit-trackId');
  var branch = getFieldValue('edit-branch');
  var deptId = document.getElementById('edit-dept') ? document.getElementById('edit-dept').value : '';
  var classId = document.getElementById('edit-class') ? document.getElementById('edit-class').value : '';
  var residency = document.getElementById('edit-residency') ? document.getElementById('edit-residency').value : 'dayscholar';
  var gender = document.getElementById('edit-gender') ? document.getElementById('edit-gender').value : 'Male';
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
    residency: residency,
    gender: gender,
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
    regNo: regNo, trackId: trackId,
    academicYear: year, batch: batch,
    courseType: courseType, branch: branch, course: branch,
    deptId: deptId, deptName: dept ? dept.name : '',
    classId: classId, className: cls ? cls.name : '',
    residency: residency,
    gender: gender,
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

/** Build teacher TrackId from empId: "EMP001" <re-icon icon="arrow-right"></re-icon> "TREMP001" */
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
    showToast('Email confirmed');
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
  // If they changed the email after clicking "No" <re-icon icon="arrow-right"></re-icon> auto-enable Add button
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
  if (emailEl) {
    emailEl.value = emailEl.value.replace(/\s+/g, '');
  }
  var email = emailEl ? emailEl.value.trim() : '';

  var usernameEl = document.getElementById('t-us');
  if (usernameEl) {
    usernameEl.value = email.split('@')[0].replace(/\s+/g, '').toLowerCase();
  }
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
    showToast('Email confirmed');
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

function onEditClassChange() {}

/** Register No <re-icon icon="arrow-right"></re-icon> decode all fields */
function onStuRegNoChange() {
  var regNo = (getFieldValue('stu-regNo') || '').replace(/\D/g, '');
  var rnEl = document.getElementById('stu-regNo');
  if (rnEl) rnEl.value = regNo;
  if (regNo.length < 12) return;

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

/** Name typed — sanitize punctuation, split first/last, refresh email if regNo decoded */
function onStuNameInput() {
  var nameEl = document.getElementById('stu-name');
  var raw = nameEl ? nameEl.value : '';
  var stripped = raw.replace(/[.,\/\\;:_]+/g, ' ');
  if (stripped !== raw && nameEl) {
    var cursor = nameEl.selectionStart;
    nameEl.value = stripped;
    if (cursor !== null) nameEl.setSelectionRange(cursor, cursor);
  }
  var clean = sanitizeFullName(stripped);
  var split = splitFirstLastName(clean);

  var fnEl = document.getElementById('stu-firstName');
  var lnEl = document.getElementById('stu-lastName');

  if (fnEl) fnEl.value = split.firstName;
  if (lnEl) lnEl.value = split.lastName;

  var regNo = (getFieldValue('stu-regNo') || '');
  if (regNo.length >= 12) {
    var yearCode = regNo.substring(4, 6);
    var deptCode = regNo.substring(6, 9);
    var dept = getDeptByNumber(deptCode);
    var twoCode = dept
      ? (dept.twoLetterCode || (dept.code ? dept.code.slice(0, 2).toLowerCase() : ''))
      : '';
    if (dept && twoCode) {
      var email = buildStuEmail(clean, yearCode, twoCode);
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
}

var STUDENT_PASSWORD = 'teacher123';

// ─── RESET / CLEAR HELPERS ───────────────────────────────────────────────────
function resetDeptForm() {
  clearInputs(['dept-name', 'dept-2code', 'dept-code', 'dept-number']);
  var catEl = document.getElementById('dept-category');
  if (catEl) catEl.value = _deptCategoryFilter || 'programme';
  var coEl = document.getElementById('co-type'); if (coEl) coEl.value = '';
  var brEl = document.getElementById('branch'); if (brEl) brEl.innerHTML = '<option value="">— Select Course Type First —</option>';
}

function resetTeacherForm() {
  clearInputs(['t-nm', 't-fn', 't-ln', 't-ei', 't-us', 't-ti']);

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
}

function resetStudentForm() {
  clearInputs(['stu-name', 'stu-firstName', 'stu-lastName', 'stu-courseType', 'stu-branch', 'stu-trackId', 'stu-email', 'stu-username']);
  var rnEl = document.getElementById('stu-regNo'); if (rnEl) rnEl.value = '7140';
  var pwEl = document.getElementById('stu-password'); if (pwEl) pwEl.value = '';
  var sfRes = document.getElementById('sf-residency');
  var defaultRes = (sfRes && sfRes.value) ? sfRes.value : 'dayscholar';
  var resEl = document.getElementById('stu-residency'); if (resEl) resEl.value = (defaultRes === 'hostel' || defaultRes === 'hosteller') ? 'hostel' : 'dayscholar';
  var genEl = document.getElementById('stu-gender'); if (genEl) genEl.value = 'Male';
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
  }
  if (typeof SearchableDropdown !== 'undefined') {
    SearchableDropdown.sync('stu-dept');
    SearchableDropdown.sync('stu-class');
  }
  hideStuEmailPopup();
  _stuEmailVerified = false;
  _stuEmailBeforeNo = '';
  _setStuAddBtn(false);
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

  if (isSudo) return ' is-sudo-admin';
  if (isSuper) return ' is-super-admin';
  if (isHod) return ' is-hod';
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
      var badges = _teacherRoleBadges(teacher);
      var cleanEmail = (teacher.email || '').replace(/\s+/g, '');
      var roleClass = _getTeacherCardRoleClass(teacher);
      return '<div class="tcrd teacher-card' + roleClass + '" onclick="openTD(\'' + tid + '\')">'
        + '<div class="tcrd-head">'
        + '<div class="tav' + roleClass + '">' + nameInitial
        + '<span class="t-status-dot' + (isActive ? '' : ' inactive') + '" title="' + (isActive ? 'Active' : 'Inactive') + '"></span>'
        + '</div>'
        + '<span class="tcrd-code" title="Employee ID">' + (teacher.empId || 'TEACHER') + '</span>'
        + '</div>'
        + '<div class="tcrd-label">' + (teacher.dept || 'Faculty') + '</div>'
        + '<div class="tnm" title="' + (teacher.name || '') + '">' + (teacher.name || '—') + '</div>'
        + '<div class="tdp">' + (teacher.desig || '—') + '</div>'
        + (cleanEmail ? '<div class="t-email" title="' + cleanEmail + '"><re-icon icon="envelope" size="11"></re-icon> ' + cleanEmail + '</div>' : '')
        + (badges ? '<div class="t-badges-wrap">' + badges + '</div>' : '')
        + '<div class="tsts tsts-2col">'
        + '<div class="tst2"><div class="tst2-head"><re-icon icon="book-open" size="13"></re-icon>Subjects</div><span class="tst2-val">' + assignmentCount + '</span></div>'
        + '<div class="tst2"><div class="tst2-head"><re-icon icon="circle-check" size="13"></re-icon>Status</div><span class="tst2-val tst2-val-status' + (isActive ? ' active' : ' inactive') + '">' + (isActive ? 'Active' : 'Inactive') + '</span></div>'
        + '</div>'
        + '<div class="tcrd-actions">'
        + '<button class="btn-out btn-sm" onclick="event.stopPropagation();openTD(\'' + tid + '\')" title="View / Edit teacher"><re-icon icon="edit" size="12"></re-icon> View / Edit</button>'
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
    var cleanEmail = (teacher.email || '').replace(/\s+/g, '');
    var roleClass = _getTeacherCardRoleClass(teacher);
    return '<tr class="' + roleClass.trim() + '">'
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
      } else if (id === 'm-add-teacher') {
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
      } else if (id === 'm-stu-edit') {
        SearchableDropdown.sync('edit-dept');
        SearchableDropdown.sync('edit-class');
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
    placeholder: '— Select Department —',
    searchPlaceholder: 'Search department name, code…'
  });
  SearchableDropdown.attach('stu-class', {
    kind: 'class',
    placeholder: '— Select Class —',
    searchPlaceholder: 'Search class, section, batch…'
  });

  // 4. Department & Class in Edit Student Modal
  SearchableDropdown.attach('edit-dept', {
    kind: 'dept',
    placeholder: '— Select Department —',
    searchPlaceholder: 'Search department name, code…'
  });
  SearchableDropdown.attach('edit-class', {
    kind: 'class',
    placeholder: '— Select Class —',
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



