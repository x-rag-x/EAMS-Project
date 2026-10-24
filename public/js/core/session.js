/**
 * Returns YYYY-MM-DD in IST (Asia/Kolkata).
 * Eliminates midnight to 5:30 AM IST UTC rollover bug where toISOString().slice(0, 10) was yesterday.
 * @param {Date|string|number} [d] - Optional date to format in IST (defaults to now)
 * @returns {string} YYYY-MM-DD
 */
function todayIST(d) {
  var date = d ? new Date(d) : new Date();
  if (isNaN(date.getTime())) return '';
  try {
    var fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return fmt.format(date);
  } catch (e) {
    var utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    var istDate = new Date(utc + (330 * 60000));
    var y = istDate.getFullYear();
    var m = String(istDate.getMonth() + 1).padStart(2, '0');
    var day = String(istDate.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
}
if (typeof window !== 'undefined') {
  window.todayIST = todayIST;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
if (typeof window !== 'undefined') {
  window.escapeHtml = escapeHtml;
}

function getToken() {
  return sessionStorage.getItem('eams_token') || '';
}

function getUser() {
  try {
    var stored = sessionStorage.getItem('eams_user');
    return stored ? JSON.parse(stored) : null;
  } catch (e) {
    return null;
  }
}

function isAdminUser(user) {
  if (!user) return false;
  if (['admin', 'sudo'].includes(user.role)) return true;
  if (user.role === 'teacher') {
    return Boolean(
      user.isSudoAdmin ||
      user.isSuperAdmin ||
      user.isSubAdmin ||
      ['sudoAdmin', 'superAdmin', 'subAdmin'].includes(user.accessRole) ||
      (user.access && user.access.level && user.access.level !== 'none') ||
      (Array.isArray(user.specials) && user.specials.some(function(s) { return s && s.option === 'isAdmin' && s.value !== false; }))
    );
  }
  return false;
}

function isSudoAdmin(user) {
  if (!user) return false;
  if (user.isSudoAdmin === true) return true;
  if (user.accessRole === 'sudoAdmin') return true;
  if (user.access && user.access.level === 'sudo') return true;
  return false;
}

function checkAuth() {
  var user = getUser();
  var token = getToken();
  if (!user || !token) {
    if (typeof window.Guard === 'object' && typeof window.Guard.init === 'function') {
      return user;
    }
    window.location.href = 'index.html';
    return null;
  }
  return user;
}

function isCurrentUserSuperAdmin() {
  try {
    var access = JSON.parse(sessionStorage.getItem('eams_access') || '{}');
    if (access && access.flags && access.flags.isSuper) return true;
    if (access && (access.tier === 'superAdmin' || access.accessRole === 'superAdmin')) return true;
    var user = JSON.parse(sessionStorage.getItem('eams_user') || '{}');
    return Boolean(user && (user.isSuperAdmin || user.accessRole === 'superAdmin' || user.adminTier === 'super'));
  } catch (e) {
    return false;
  }
}

function getUserRoleCategory(user) {
  var u = user;
  if (!u) {
    try {
      u = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : (typeof getUser === 'function' ? getUser() : JSON.parse(sessionStorage.getItem('eams_user') || '{}'));
    } catch (e) {
      u = {};
    }
  }
  if (!u) return '';

  var accessObj = {};
  try { accessObj = JSON.parse(sessionStorage.getItem('eams_access') || '{}'); } catch (e) { }

  var isSudo = !!u.isSudoAdmin || u.adminTier === 'sudo' || u.role === 'sudo' || u.accessRole === 'sudoAdmin'
    || (accessObj.tier === 'sudoAdmin') || (accessObj.flags && accessObj.flags.isSudo)
    || (typeof isSudoAdmin === 'function' && isSudoAdmin(u))
    || (u.pageRights && u.pageRights.accessRole === 'sudoAdmin')
    || (Array.isArray(u.pageRights) && u.pageRights.some(function (p) { return p && p.enabled !== false && p.accessRole === 'sudoAdmin'; }));

  var isSuper = !isSudo && (!!u.isSuperAdmin || u.adminTier === 'super' || u.accessRole === 'superAdmin'
    || (accessObj.tier === 'superAdmin') || (accessObj.flags && accessObj.flags.isSuper)
    || (typeof isCurrentUserSuperAdmin === 'function' && isCurrentUserSuperAdmin())
    || (u.pageRights && u.pageRights.accessRole === 'superAdmin')
    || (Array.isArray(u.pageRights) && u.pageRights.some(function (p) { return p && p.enabled !== false && p.accessRole === 'superAdmin'; })));

  var hasGeneralAdmin = !isSudo && !isSuper && (!!u.isAdmin || (Array.isArray(u.specials) && u.specials.some(function (s) { return s && s.option === 'isAdmin'; })));
  if (hasGeneralAdmin) {
    var nameLower = ((u.name || '') + ' ' + (u.desig || '') + ' ' + (u.username || '')).toLowerCase();
    if (nameLower.indexOf('system admin') !== -1 || u.username === 'admin' || !u.deptId) {
      isSudo = true;
    } else {
      isSuper = true;
    }
  }

  var isHod = !isSudo && !isSuper && Boolean(u.isHOD || u.isHod
    || (Array.isArray(u.specials) && u.specials.some(function (s) { return s && s.option === 'isHod'; }))
    || (Array.isArray(u.roles) && u.roles.includes('hod'))
    || (accessObj && accessObj.isHod));

  if (isSudo) return 'sudo';
  if (isSuper) return 'super';
  if (isHod) return 'hod';
  return '';
}

function applyUserRoleBadgeStyling(user) {
  var role = getUserRoleCategory(user);
  var roleClass = role ? (role === 'hod' ? 'is-hod' : 'is-' + role + '-admin') : '';
  var allRoleClasses = ['is-sudo-admin', 'is-super-admin', 'is-hod'];

  var targetIds = ['topbar-av', 'sb-av', 'pr-av-big', 'topbar-avatar', 'u-av', 'tpav', 'av-initials', 'sb-user-avatar'];
  targetIds.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) {
      allRoleClasses.forEach(function (cls) { el.classList.remove(cls); });
      if (roleClass) el.classList.add(roleClass);
    }
  });

  var chips = document.querySelectorAll('.profile-chip');
  chips.forEach(function (chip) {
    allRoleClasses.forEach(function (cls) { chip.classList.remove(cls); });
    if (roleClass) chip.classList.add(roleClass);
  });

  var uRoleEl = document.querySelector('.sb-urole');
  if (uRoleEl) {
    allRoleClasses.forEach(function (cls) { uRoleEl.classList.remove(cls); });
    if (roleClass) uRoleEl.classList.add(roleClass);
  }
}

if (typeof window !== 'undefined') {
  window.isAdminUser = isAdminUser;
  window.isSudoAdmin = isSudoAdmin;
  window.isCurrentUserSuperAdmin = isCurrentUserSuperAdmin;
  window.getUserRoleCategory = getUserRoleCategory;
  window.applyUserRoleBadgeStyling = applyUserRoleBadgeStyling;
  window.checkAuth = checkAuth;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { applyUserRoleBadgeStyling(); });
    } else {
      applyUserRoleBadgeStyling();
    }
    window.addEventListener('load', function () { applyUserRoleBadgeStyling(); });
  }
}

function freezeUIOnLogout(reason) {
  try {
    document.body.style.pointerEvents = 'none';
    document.body.style.cursor = 'not-allowed';
    document.body.style.userSelect = 'none';

    // Intercept and swallow all mouse and keyboard interactions
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
      overlay.innerHTML = '<div style="width:58px;height:58px;border-radius:50%;background:#e8f5e9;border:2px solid #a5d6a7;display:flex;align-items:center;justify-content:center;font-size:26px;box-shadow:0 8px 30px rgba(0,0,0,0.35);"><re-icon icon="lock"></re-icon></div>' +
        '<div style="font-size:18px;font-weight:700;letter-spacing:-0.3px;color:#ffffff;">' + (reason || 'Signing Out…') + '</div>' +
        '<div style="font-size:12.5px;color:#a5d6a7;font-weight:500;">Securing session and clearing credentials…</div>' +
        '<div style="width:22px;height:22px;border:2.5px solid rgba(255,255,255,0.25);border-top-color:#a5d6a7;border-radius:50%;animation:spinLoader 0.6s linear infinite;margin-top:4px;"></div>';
      document.body.appendChild(overlay);
    }
  } catch (err) {}
}

async function doLogout(reasonType) {
  var isAutoTimeout = reasonType === 'timeout' || reasonType === 'auto';
  if (isAutoTimeout) {
    if (typeof dbToast === 'function') {
      dbToast('Session expired. Logging out...', 'error');
    } else if (typeof showToast === 'function') {
      showToast('Session expired. Logging out...', 'error');
    }
  }
  var msg = isAutoTimeout ? 'Session Expired — Logging Out…' : 'Signing Out…';
  freezeUIOnLogout(msg);

  try {
    var token = getToken();
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: isAutoTimeout ? 'auto' : 'manual' })
      }).catch(function () {});
    }
  } catch (err) {}
  sessionStorage.clear();
  var targetUrl = isAutoTimeout ? 'index.html?logout=timeout' : 'index.html?logout=manual';
  try { if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, '', targetUrl); } catch (e) {}
  try { if (typeof window !== 'undefined' && window.location && window.location.replace) window.location.replace(targetUrl); } catch (e) {}
}

// ─── SESSION INACTIVITY & TIMEOUT MANAGEMENT ───
(function() {
  var IDLE_CHECK_INTERVAL = 5000; // Check every 5 seconds

  function getTimeoutConfig() {
    var enabledStr = sessionStorage.getItem('eams_session_timeout');
    // Default is enabled (true) unless explicitly configured as 'false'
    var isEnabled = (enabledStr !== 'false');
    var rawMins = sessionStorage.getItem('eams_session_timeout_mins');
    var mins = (rawMins && !isNaN(parseInt(rawMins, 10))) ? parseInt(rawMins, 10) : 7;
    return {
      enabled: isEnabled,
      mins: mins,
      ms: mins * 60 * 1000
    };
  }

  function recordSessionActivity() {
    if (typeof sessionStorage === 'undefined') return;
    if (!sessionStorage.getItem('eams_token')) return;
    var nowStr = Date.now().toString();
    sessionStorage.setItem('eams_last_activity', nowStr);
    sessionStorage.setItem('eams_login_time', nowStr);
    try { localStorage.setItem('eams_last_activity', nowStr); } catch (e) {}
  }

  if (typeof window !== 'undefined') {
    window.recordSessionActivity = recordSessionActivity;
    window.getTimeoutConfig = getTimeoutConfig;
  }

  // Intercept all API calls so each API call automatically extends logout time
  if (typeof window !== 'undefined' && window.fetch) {
    var _origFetch = window.fetch;
    window.fetch = function() {
      var url = arguments[0];
      if (typeof url === 'string' && (url.includes('/api/') || url.startsWith('/api'))) {
        if (!url.includes('/api/auth/logout') && !url.includes('/api/settings/public')) {
          recordSessionActivity();
        }
      }
      return _origFetch.apply(this, arguments);
    };
  }

  // Listen to all user interactions to reset idle timer
  var lastUserEvent = 0;
  function onUserInteraction() {
    var now = Date.now();
    if (now - lastUserEvent > 1000) {
      lastUserEvent = now;
      recordSessionActivity();
    }
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    ['click', 'keydown', 'keypress', 'mousedown', 'mousemove', 'scroll', 'touchstart', 'touchmove'].forEach(function(evt) {
      window.addEventListener(evt, onUserInteraction, { passive: true, capture: true });
    });
  }

  // Sync security settings from public endpoint
  function syncTimeoutSettings() {
    if (typeof fetch === 'function') {
      fetch('/api/settings/public')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.security) {
            var timeoutEnabled = data.security.sessionTimeout !== false;
            var timeoutMins = data.security.sessionTimeoutMins !== undefined ? Number(data.security.sessionTimeoutMins) : 7;
            sessionStorage.setItem('eams_session_timeout', timeoutEnabled ? 'true' : 'false');
            sessionStorage.setItem('eams_session_timeout_mins', String(timeoutMins));
          }
        }).catch(function() {});
    }
  }

  if (sessionStorage.getItem('eams_token') && !sessionStorage.getItem('eams_last_activity')) {
    recordSessionActivity();
  }
  syncTimeoutSettings();

  function checkSessionExpiry() {
    if (!sessionStorage.getItem('eams_token')) return;

    // Phase T3: 15-day student device sessions are exempt
    if (sessionStorage.getItem('eams_session_class') === 'student-device') return;

    var cfg = getTimeoutConfig();
    // When false: do not logout until tab closes or logout btn is clicked
    if (!cfg.enabled) {
      return;
    }

    var sTime = parseInt(sessionStorage.getItem('eams_last_activity') || sessionStorage.getItem('eams_login_time'), 10);
    var lTime = 0;
    try {
      lTime = parseInt(localStorage.getItem('eams_last_activity'), 10) || 0;
    } catch (e) {}

    var latestActivity = Math.max(sTime || 0, lTime || 0);
    if (latestActivity > 0) {
      var elapsed = Date.now() - latestActivity;
      if (elapsed > cfg.ms) {
        doLogout('timeout');
      }
    }
  }

  checkSessionExpiry();
  setInterval(checkSessionExpiry, IDLE_CHECK_INTERVAL);
})();
