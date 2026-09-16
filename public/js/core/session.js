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

function hasRight(right) {
  var user = getUser();
  if (!user) return false;
  if (user.role === 'admin' && user.adminFlag !== 'subadmin') return true;
  var rights = user.adminRights;
  if (rights === 'all') return true;
  var rightsList = [];
  if (Array.isArray(rights)) {
    rightsList = rights;
  } else if (typeof rights === 'string') {
    rightsList = rights.split(',').map(function(s){ return s.trim(); });
  }
  if (rightsList.includes('all')) return true;
  if (right && rightsList.includes(right)) return true;
  if (right === 'settingsPage' && (rightsList.includes('settingsModule') || rightsList.includes('controlPage'))) return true;
  return false;
}

function checkAuth(role, specificRight) {
  var user = getUser();
  if (!user) { window.location.href = 'index.html'; return null; }
  
  if (role === 'any') return user;

  if (role) {
    if (user.role === role) return user;

    // Allow teacher with admin privileges to access admin-guarded pages
    if (role === 'admin' && user.role === 'teacher' && user.isAdmin) {
      if (specificRight && !hasRight(specificRight)) {
        window.location.href = 'index.html';
        return null;
      }
      return user;
    }

    window.location.href = 'index.html';
    return null;
  }
  return user;
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
      overlay.innerHTML = '<div style="width:58px;height:58px;border-radius:50%;background:#e8f5e9;border:2px solid #a5d6a7;display:flex;align-items:center;justify-content:center;font-size:26px;box-shadow:0 8px 30px rgba(0,0,0,0.35);">🔒</div>' +
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
      dbToast('⚠️ Session expired. Logging out...', 'error');
    } else if (typeof showToast === 'function') {
      showToast('⚠️ Session expired. Logging out...', 'error');
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
  history.replaceState(null, '', targetUrl);
  window.location.replace(targetUrl);
}

(function() {
  function checkSessionExpiry() {
    var loginTime = sessionStorage.getItem('eams_login_time');
    if (loginTime) {
      var elapsed = Date.now() - parseInt(loginTime, 10);
      if (elapsed > 45 * 60 * 1000) {
        doLogout('timeout');
      }
    }
  }
  checkSessionExpiry();
  setInterval(checkSessionExpiry, 15000);
})();

// Update activity timestamp on user interaction
document.addEventListener('click', function () {
  if (sessionStorage.getItem('eams_token')) {
    sessionStorage.setItem('eams_login_time', Date.now().toString());
  }
}, true);
