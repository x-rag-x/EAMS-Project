// ── Client-Side Timing Marks Collector (S0.2) ──
window._eamsLoginTiming = {
  marks: {},
  durations: {},
  initTime: (window.performance && performance.now) ? performance.now() : Date.now(),

  mark: function (name, metadata) {
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    var relMs = Math.round(now - this.initTime);
    this.marks[name] = relMs;
    try {
      if (window.performance && performance.mark) {
        performance.mark('eams-login-' + name);
      }
    } catch (e) {}

    if (this.marks.submit && name !== 'submit') {
      this.durations['submit_to_' + name] = relMs - this.marks.submit;
    }
    if (this.marks.load && name !== 'load') {
      this.durations['load_to_' + name] = relMs - this.marks.load;
    }

    if (metadata) {
      if (!this.meta) this.meta = {};
      this.meta[name] = metadata;
    }

    try {
      sessionStorage.setItem('eams_login_timing', JSON.stringify({
        marks: this.marks,
        durations: this.durations,
        meta: this.meta,
        serverTiming: this.serverTiming || null
      }));
    } catch (e) {}

    var isDebug = (window._pubSettings && window._pubSettings.advanced && window._pubSettings.advanced.debugMode) || window._eamsDebug;
    if (isDebug) {
      console.log('[Timing Mark] ' + name + ' at +' + relMs + 'ms' + (metadata ? ' (' + JSON.stringify(metadata) + ')' : ''));
    }
  },

  setServerTiming: function (headerValue) {
    if (!headerValue) return;
    this.serverTiming = headerValue;
    try {
      sessionStorage.setItem('eams_login_timing', JSON.stringify({
        marks: this.marks,
        durations: this.durations,
        meta: this.meta,
        serverTiming: this.serverTiming
      }));
    } catch (e) {}
    var isDebug = (window._pubSettings && window._pubSettings.advanced && window._pubSettings.advanced.debugMode) || window._eamsDebug;
    if (isDebug) {
      console.log('[Server-Timing]:', headerValue);
    }
  }
};

// ── Device Identity Context (S3.6) ──
function getOrCreateDeviceInstallId() {
  try {
    var id = localStorage.getItem('eams_device_install_id');
    if (!id) {
      if (window.crypto && window.crypto.randomUUID) {
        id = window.crypto.randomUUID();
      } else {
        id = 'inst_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      }
      localStorage.setItem('eams_device_install_id', id);
    }
    return id;
  } catch (e) {
    return 'inst_ephemeral_' + Date.now();
  }
}

function detectBrowserAndOS() {
  var ua = navigator.userAgent || '';
  var browser = 'Other';
  var os = 'Other';

  if (/edg/i.test(ua)) browser = 'Edge';
  else if (/brave/i.test(ua)) browser = 'Brave';
  else if (/opr|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';

  if (/windows/i.test(ua)) os = 'Windows';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/mac os|macintosh/i.test(ua)) os = 'MacOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  return { browser: browser, os: os };
}

function getClientDeviceInfo() {
  var installId = getOrCreateDeviceInstallId();
  var bOs = detectBrowserAndOS();
  var deviceType = /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent)
    ? 'Mobile'
    : (/Tablet/i.test(navigator.userAgent) ? 'Tablet' : 'Desktop');
  var deviceName = bOs.browser + ' on ' + bOs.os + ' (' + deviceType + ')';

  return {
    installId: installId,
    deviceId: installId,
    deviceName: deviceName,
    deviceType: deviceType,
    browser: bOs.browser,
    os: bOs.os,
    platform: navigator.platform || 'Unknown',
    userAgent: navigator.userAgent || '',
    screen: window.screen ? (window.screen.width + 'x' + window.screen.height + ' (' + (window.screen.colorDepth || 24) + '-bit)') : null,
    pixelRatio: window.devicePixelRatio || 1,
    language: navigator.language || navigator.userLanguage || 'en',
    timezone: (window.Intl && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
    touchSupport: ('ontouchstart' in window) || (navigator.maxTouchPoints > 0),
    hardwareConcurrency: navigator.hardwareConcurrency || null
  };
}

// ── Fast Background Geolocation Prefetch (§3.7) ──
var locPromise = null;
var locState = { s: 'idle', p: null, code: null, at: null };

function setChip(state, accuracy, extraMsg) {
  var chip = document.getElementById('loc-chip');
  var text = document.getElementById('loc-chip-text');
  var actionBtn = document.getElementById('loc-chip-btn');
  var drawer = document.getElementById('loc-help-drawer');
  if (!chip || !text) return;

  chip.setAttribute('data-state', state);

  var isDevOrBypassed = !!(window._eamsIsDev || window._eamsLocDisabled);
  if (state === 'idle') {
    text.textContent = window._eamsIsDev ? 'Location check disabled (Dev mode)' : (window._eamsLocDisabled ? 'Location optional' : 'Location required for security');
    if (actionBtn) actionBtn.style.display = 'none';
    if (drawer) drawer.style.display = 'none';
  } else if (state === 'requesting') {
    text.textContent = 'Acquiring location…';
    if (actionBtn) actionBtn.style.display = 'none';
    if (drawer) drawer.style.display = 'none';
  } else if (state === 'ready') {
    var accText = (typeof accuracy === 'number') ? ' (±' + Math.round(accuracy) + 'm)' : '';
    text.textContent = (window._eamsIsDev ? 'Location detected (Dev mode)' : 'Location verified') + accText;
    if (actionBtn) actionBtn.style.display = 'none';
    if (drawer) drawer.style.display = 'none';
  } else if (state === 'blocked') {
    if (isDevOrBypassed) {
      text.textContent = 'Location bypassed (Dev mode)';
      if (actionBtn) actionBtn.style.display = 'none';
    } else {
      text.textContent = extraMsg || 'Location blocked';
      if (actionBtn) {
        actionBtn.textContent = 'How to allow';
        actionBtn.onclick = function () { toggleLocHelp(true); };
        actionBtn.style.display = 'inline';
      }
    }
  } else if (state === 'unavailable') {
    if (isDevOrBypassed) {
      text.textContent = 'Location optional (Dev mode)';
      if (actionBtn) actionBtn.style.display = 'none';
    } else {
      text.textContent = extraMsg || 'Location unavailable';
      if (actionBtn) {
        actionBtn.textContent = 'Retry';
        actionBtn.onclick = function () {
          locPromise = null;
          prefetchLocation(true);
        };
        actionBtn.style.display = 'inline';
      }
    }
  }
}

function toggleLocHelp(show) {
  var drawer = document.getElementById('loc-help-drawer');
  if (!drawer) return;
  drawer.style.display = show ? 'block' : 'none';
}

function getLocationFast() {
  if (!navigator.geolocation) {
    var err = new Error('Geolocation unsupported');
    err.code = 2;
    return Promise.reject(err);
  }
  var once = function (o) {
    return new Promise(function (ok, no) {
      navigator.geolocation.getCurrentPosition(ok, no, o);
    });
  };

  if (typeof Promise.any === 'function') {
    return Promise.any([
      once({ enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 4000 }),
      once({ enableHighAccuracy: true, maximumAge: 0, timeout: 12000 })
    ]).catch(function (agg) {
      var err = (agg && agg.errors) ? (agg.errors.find(function (e) { return e.code === 1; }) || agg.errors[0]) : agg;
      throw err;
    });
  }

  // Fallback for older browsers without Promise.any
  return once({ enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 4000 })
    .catch(function () {
      return once({ enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
    });
}

function prefetchLocation(force) {
  if (locPromise && !force) return locPromise;
  setChip('requesting');
  locPromise = getLocationFast().then(
    function (p) {
      locState = { s: 'ready', p: p, code: null, at: Date.now() };
      window._eamsLoginTiming.mark('location ready', { accuracy: p.coords.accuracy });
      setChip('ready', p.coords.accuracy);
      return p;
    },
    function (e) {
      var code = (e && e.code) ? e.code : 2;
      locState = { s: 'error', p: null, code: code, at: Date.now() };
      window._eamsLoginTiming.mark('location ready', { error: true, code: code });
      if (window._eamsIsDev || window._eamsLocDisabled) {
        setChip('idle');
      } else {
        setChip(code === 1 ? 'blocked' : 'unavailable');
      }
      throw e;
    }
  );
  return locPromise;
}

// ── Smart Board Kiosk Toggle (§3.1, §5) ──
var isBoardMode = false;
function toggleBoardMode(forcedState) {
  if (typeof forcedState === 'boolean') {
    isBoardMode = forcedState;
  } else {
    isBoardMode = !isBoardMode;
  }
  var heading = document.getElementById('login-heading');
  var lblU = document.getElementById('lbl-u');
  var inpU = document.getElementById('lu');
  var lblP = document.getElementById('lbl-p');
  var inpP = document.getElementById('lp');
  var lbnTxt = document.getElementById('lbn-txt');
  var sbToggleTxt = document.getElementById('sb-toggle-text');
  var chipWrap = document.querySelector('.loc-chip-wrap');

  if (isBoardMode) {
    if (heading) heading.textContent = 'Smart Board Kiosk Sign In';
    if (lblU) lblU.textContent = 'Device ID';
    if (inpU) {
      inpU.placeholder = 'e.g. TR-RMB-LH38';
      if (!inpU.value.toUpperCase().startsWith('TR-') && !inpU.value.toUpperCase().startsWith('SB-')) inpU.value = 'TR-';
    }
    if (lblP) lblP.textContent = 'Board API Key';
    if (inpP) inpP.placeholder = 'Enter 64-char API key';
    if (lbnTxt) lbnTxt.textContent = 'Connect Board';
    if (sbToggleTxt) sbToggleTxt.textContent = 'Standard User Sign In';
    if (chipWrap) chipWrap.style.display = 'none';
  } else {
    if (heading) heading.textContent = 'Sign In';
    if (lblU) lblU.textContent = 'Username';
    if (inpU) {
      inpU.placeholder = 'Enter username';
      if (inpU.value.toUpperCase().startsWith('SB-') || inpU.value.toUpperCase().startsWith('TR-')) inpU.value = '';
    }
    if (lblP) lblP.textContent = 'Password';
    if (inpP) inpP.placeholder = 'Enter password';
    if (lbnTxt) lbnTxt.textContent = 'Sign In';
    if (sbToggleTxt) sbToggleTxt.textContent = 'Smart Board Kiosk Sign In';
    if (chipWrap) chipWrap.style.display = '';
  }
  if (inpU) inpU.focus();
}

// ── Page Initialization ──
document.addEventListener('DOMContentLoaded', function () {
  window._eamsLoginTiming.mark('load');

  // Immediately prefetch location on load for all logins
  try { prefetchLocation(); } catch (e) {}

  var firstFocusRecorded = false;
  function handleFirstFocus() {
    if (!firstFocusRecorded) {
      firstFocusRecorded = true;
      window._eamsLoginTiming.mark('first focus');
    }
    prefetchLocation();
  }

  var uInp = document.getElementById('lu');
  var pInp = document.getElementById('lp');
  if (uInp) uInp.addEventListener('focusin', handleFirstFocus, { once: true });
  if (pInp) pInp.addEventListener('focusin', handleFirstFocus, { once: true });

  // Pre-check permissions without prompting
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(function (s) {
      if (s.state === 'denied') {
        setChip('blocked');
      } else if (s.state === 'granted') {
        prefetchLocation();
      }
      s.onchange = function () {
        if (s.state === 'granted') {
          locPromise = null;
          prefetchLocation(true);
        } else if (s.state === 'denied') {
          locPromise = null;
          locState = { s: 'error', p: null, code: 1, at: Date.now() };
          setChip('blocked');
        }
      };
    }).catch(function () {});
  }

  function sanitizeReturnUrl(url) {
    if (!url || typeof url !== 'string') return null;
    var trimmed = url.trim();
    // Reject absolute URLs, scheme-relative URLs, backslashes, and script URIs
    if (/^(?:[a-z]+:|\/\/|\\)/i.test(trimmed)) return null;
    if (/^(?:javascript|data|vbscript):/i.test(trimmed)) return null;

    var allowedPages = [
      'attendance.html',
      'student.html',
      'teacher.html',
      'selector.html',
      'controller.html',
      'admin.html',
      'manage.html',
      'control.html',
      'bulk.html',
      'export.html',
      'logs.html',
      'rooms.html',
      'settings.html',
      'timetable.html'
    ];

    var pageMatch = trimmed.match(/^([a-zA-Z0-9_\-]+\.html)(?:\?.*)?$/);
    if (pageMatch && allowedPages.includes(pageMatch[1].toLowerCase())) {
      return trimmed;
    }
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const type = params.get('type') || 'info';
  const time = parseInt(params.get('time') || '0', 10);
  const method = params.get('method');
  const returnUrl = sanitizeReturnUrl(params.get('returnUrl') || params.get('redirect') || params.get('next'));

  if (method === 'att') {
    const sid = params.get('sid') || '';
    const qid = params.get('qid') || '';
    let t = params.get('t');
    if (!t) {
      t = btoa(String(Date.now()));
    }
    const attReturnUrl = 'attendance.html?sid=' + encodeURIComponent(sid) + '&qid=' + encodeURIComponent(qid) + '&t=' + encodeURIComponent(t);
    sessionStorage.setItem('eams_return_url', attReturnUrl);

    // Update URL with &t=<encryptedTime>
    history.replaceState({}, '', 'index.html?method=att&sid=' + encodeURIComponent(sid) + '&qid=' + encodeURIComponent(qid) + '&t=' + encodeURIComponent(t));

    // Fast-path: if student is already authenticated, redirect straight to attendance
    const existingToken = sessionStorage.getItem('eams_token');
    let existingUser = null;
    try { existingUser = JSON.parse(sessionStorage.getItem('eams_user')); } catch (e) {}
    if (existingToken && existingUser && existingUser.role === 'student') {
      window.location.href = attReturnUrl;
      return;
    }
  } else if (returnUrl) {
    sessionStorage.setItem('eams_return_url', returnUrl);
    var verify = params.get('verify') === 'true';
    if (verify) {
      sessionStorage.setItem('eams_verify_return', 'true');
    }
    history.replaceState({}, '', 'index.html?returnUrl=' + encodeURIComponent(returnUrl) + (verify ? '&verify=true' : ''));

    // Check if user is already logged in
    var existingToken = sessionStorage.getItem('token') || sessionStorage.getItem('eams_token');
    var existingUser = null;
    try { existingUser = JSON.parse(sessionStorage.getItem('user') || sessionStorage.getItem('eams_user')); } catch (e) {}
    if (existingToken && existingUser) {
      if (verify && returnUrl.indexOf('timetable') !== -1) {
        if (canUserAccessTimetable(existingUser)) {
          sessionStorage.removeItem('eams_return_url');
          sessionStorage.removeItem('eams_verify_return');
          window.location.href = returnUrl;
          return;
        } else {
          sessionStorage.removeItem('eams_return_url');
          sessionStorage.removeItem('eams_verify_return');
          history.replaceState({}, '', 'index.html');
          var errBox = document.getElementById('lerr');
          if (errBox) {
            errBox.textContent = 'User is not authorized to access this page. Coordinator or Admin credentials required.';
            errBox.style.display = 'block';
          }
          msgToast('User is not authorized to access Timetable page.', 'error');
        }
      } else if (!verify) {
        sessionStorage.removeItem('eams_return_url');
        window.location.href = returnUrl;
        return;
      }
    }
  } else {
    history.replaceState({}, '', 'index.html');
  }

  // Phase T3: If student has a trusted device session, attempt silent refresh before prompting for login
  var currentToken = sessionStorage.getItem('eams_token');
  var logoutReason = params.get('logout');
  if (!currentToken && !logoutReason && typeof window.DeviceKey === 'object' && typeof window.DeviceKey.trySessionRefresh === 'function') {
    window.DeviceKey.trySessionRefresh().then(function (res) {
      if (res && res.token && res.user && res.user.role === 'student') {
        if (method === 'att') {
          var sid = params.get('sid') || '';
          var qid = params.get('qid') || '';
          var t = params.get('t') || btoa(String(Date.now()));
          window.location.href = 'attendance.html?sid=' + encodeURIComponent(sid) + '&qid=' + encodeURIComponent(qid) + '&t=' + encodeURIComponent(t);
        } else if (returnUrl && returnUrl.indexOf('admin') === -1 && returnUrl.indexOf('teacher') === -1) {
          sessionStorage.removeItem('eams_return_url');
          window.location.href = returnUrl;
        } else {
          window.location.href = 'student.html';
        }
      }
    }).catch(function () {});
  }

  switch (params.get('logout')) {
    case 'timeout':
      msgToast('Session expired. Please Sign in again.', type);
      break;
    case 'manual':
      msgToast('Logged out successfully.', type);
      break;
    case 'error':
      msgToast('Logged out due to an unexpected error.', type);
      break;
  }

  if (params.get('bootstrap') === 'complete') {
    msgToast('Initial setup completed successfully! Please sign in with your new password.', 'success');
  }

  if (sessionStorage.getItem('eams_bootstrapPending') === '1' && sessionStorage.getItem('eams_token')) {
    initBootstrapWizard();
  }

  if (time > 0) { setTimeout(hideMsgToast, time); }
});

function canUserAccessTimetable(user) {
  if (!user) return false;
  if (user.isSudoAdmin || user.isSuperAdmin || user.isSubAdmin || user.isAdmin) return true;
  if (['sudoAdmin', 'superAdmin', 'subAdmin', 'admin'].includes(user.accessRole)) return true;
  if (user.role === 'admin' || user.role === 'sudo') return true;
  if (user.isTimeTableCoordinator === true || user.isHod === true || user.isPrincipal === true) return true;
  if (user.pages && (user.pages.timetable || user.pages['timetable'])) return true;
  if (user.access && (user.access.level === 'full' || user.access.level === 'sudo' || (Array.isArray(user.access.pages) && user.access.pages.includes('timetable')) || (user.access.pages && user.access.pages.timetable))) return true;
  if (Array.isArray(user.pageRights) && user.pageRights.some(function(p) { return p && p.enabled !== false && (p.page === '*' || p.page === 'timetable'); })) return true;
  if (Array.isArray(user.specials) && user.specials.some(function (s) { return s && (s.option === 'isAdmin' || s.option === 'isHod' || s.option === 'isTimeTableCoordinator'); })) return true;
  return false;
}

function msgToast(message, type) {
  type = type || "info";
  const toast = document.getElementById("msg-toast");
  const text = document.getElementById("msg-toast-text");

  if (!toast || !text) return;
  text.textContent = message;

  toast.className = "";
  toast.id = "msg-toast";
  toast.classList.add(type);
  toast.classList.add("show");
}

function hideMsgToast() {
  document.getElementById("msg-toast")?.classList.remove("show");
}

(function checkPublicStatusOnLoad() {
  fetch('/api/settings/public?_t=' + Date.now())
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d) return;

      // 1. Maintenance Check
      if (d.maintenance && d.maintenance.active) {
        var notice = document.getElementById('maint-notice');
        if (notice) notice.style.display = 'block';
      }

      // 2. Active Broadcast Banner
      if (d.broadcast && d.broadcast.systemBannerActive && d.broadcast.systemBannerMessage) {
        var bannerBox = document.getElementById('login-broadcast-banner');
        if (!bannerBox) {
          bannerBox = document.createElement('div');
          bannerBox.id = 'login-broadcast-banner';
          bannerBox.style.cssText = 'background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;font-size:12px;color:#92400e;margin-bottom:14px;display:flex;align-items:center;gap:8px;font-weight:500;';
          var formBox = document.querySelector('.lc') || document.body;
          if (formBox && formBox.firstChild) {
            formBox.insertBefore(bannerBox, formBox.firstChild);
          }
        }
        bannerBox.innerHTML = '<span><re-icon icon="bullhorn"></re-icon></span> <span>' + escapeHtml(d.broadcast.systemBannerMessage) + '</span>';
      }

      if (d.institution) {
        if (d.institution.institutionShort) {
          document.title = 'EAMS – Sign In | ' + d.institution.institutionShort;
        }
        if (d.institution.institutionName) {
          var lb = document.getElementById('login-inst-name') || document.querySelector('.lb');
          if (lb) lb.textContent = d.institution.institutionName;
        }
      }

      // 3. Environment & Geolocation Settings
      window._eamsIsDev = !!(d.isDev || (d.security && d.security.isDev));
      window._eamsLocDisabled = !!(d.security && d.security.loginLocationRequired === false);
      if (window._eamsIsDev || window._eamsLocDisabled) {
        if (locState.s === 'idle') {
          setChip('idle');
        }
      }
      if (window._eamsIsDev) {
        initDevModeUI();
      }
    })
    .catch(function () { });
})();

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Unified Single-Call Sign In (§3.5, S3.1, S3.2) ──
var signingIn = false;

async function doSignIn() {
  if (signingIn) return;
  window._eamsLoginTiming.mark('submit');

  var uInp = document.getElementById('lu');
  var pInp = document.getElementById('lp');
  var usernameInput = uInp ? uInp.value.trim() : '';
  var passwordInput = pInp ? pInp.value.trim() : '';
  var errorBox = document.getElementById('lerr');
  var signInButton = document.getElementById('lbn');
  if (errorBox) errorBox.style.display = 'none';

  if (!usernameInput || !passwordInput) {
    if (window._eamsIsDev && usernameInput && !passwordInput && !isBoardMode) {
      return doDevSignIn(usernameInput);
    }
    if (errorBox) {
      errorBox.textContent = isBoardMode
        ? 'Please enter Device ID and Board API Key.'
        : 'Please enter username and password.';
      errorBox.style.display = 'block';
    }
    return;
  }

  signingIn = true;
  if (uInp) uInp.disabled = true;
  if (pInp) pInp.disabled = true;
  if (signInButton) {
    signInButton.disabled = true;
    signInButton.innerHTML = '<div class="spin"></div><span>Signing In…</span>';
  }

  // Auto-detect Smart Board Device ID
  var isBoardAuth = isBoardMode || usernameInput.toUpperCase().startsWith('SB-') || usernameInput.toUpperCase().startsWith('TR-');

  var locationPayload = null;
  var locationErrorPayload = null;

  if (!isBoardAuth) {
    if (!locPromise) {
      prefetchLocation();
    }

    // If location is currently acquiring or idle, wait for it with a budget
    if (locState.s === 'requesting' || (locPromise && locState.s === 'idle')) {
      if (signInButton) {
        signInButton.innerHTML = '<div class="spin"></div><span>Acquiring location…</span>';
      }
      var waitBudgetMs = (window._eamsIsDev || window._eamsLocDisabled) ? 4000 : 8000;
      var timeoutTimer = null;
      var timeoutPromise = new Promise(function (resolve) {
        timeoutTimer = setTimeout(function () {
          resolve({ timeout: true });
        }, waitBudgetMs);
      });

      try {
        var raceResult = await Promise.race([locPromise, timeoutPromise]);
        clearTimeout(timeoutTimer);
        if (raceResult && raceResult.timeout && locState.s !== 'ready') {
          locationErrorPayload = 'PROMPT_TIMEOUT';
        }
      } catch (raceErr) {
        clearTimeout(timeoutTimer);
      }
    }

    if (locState.s === 'ready' && locState.p) {
      locationPayload = {
        latitude: locState.p.coords.latitude,
        longitude: locState.p.coords.longitude,
        accuracy: locState.p.coords.accuracy,
        ageMs: Math.max(0, Date.now() - (locState.at || Date.now()))
      };
    } else if (locState.s === 'error') {
      if (locState.code === 1) {
        locationErrorPayload = 'PERMISSION_DENIED';
      } else if (locationErrorPayload !== 'PROMPT_TIMEOUT') {
        locationErrorPayload = 'POSITION_UNAVAILABLE';
      }
    }
  }

  var clientDevice = getClientDeviceInfo();
  var payload = {
    username: usernameInput,
    password: passwordInput,
    device: clientDevice,
    location: locationPayload,
    locationError: locationErrorPayload
  };

  try {
    var response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    var serverTiming = response.headers ? response.headers.get('Server-Timing') : null;
    if (serverTiming) window._eamsLoginTiming.setServerTiming(serverTiming);
    window._eamsLoginTiming.mark('response', { endpoint: 'login', status: response.status });

    var data = await response.json();
    data._httpStatus = response.status;

    if (response.status === 503 || data.maintenance) {
      sessionStorage.setItem('maint_data', JSON.stringify(data));
      doRedirect('maintenance.html');
      return;
    }

    if (response.status === 423 || data.code === 'LOCATION_LOCKED') {
      resetSignInUI();
      setChip('blocked', null, 'Account locked: location denied');
      toggleLocHelp(true);
      if (errorBox) {
        errorBox.textContent = data.error || 'Account locked for 1 hour due to denied location permission. Please contact administrator.';
        errorBox.style.display = 'block';
      }
      msgToast('Account locked for 1 hour: Location access was not granted.', 'error');
      if (pInp) pInp.value = '';
      return;
    }

    if (response.status === 403 && (data.code === 'LOCATION_REQUIRED' || data.code === 'LOCATION_INVALID')) {
      resetSignInUI();
      setChip('unavailable', null, data.error || 'Location required');
      if (errorBox) {
        errorBox.textContent = data.error || 'Location coordinates are required to sign in.';
        errorBox.style.display = 'block';
      }
      msgToast(data.error || 'Location is required to sign in', 'error');
      return;
    }

    if (response.status === 403 && (data.code === 'PORTAL_DISABLED' || data.code === 'STUDENTS_LOGIN_PAUSED' || data.portalDisabled)) {
      resetSignInUI();
      var msg = data.error || (data.code === 'STUDENTS_LOGIN_PAUSED' ? 'Students Login are paused temporary.' : 'Portal is currently disabled by administrator.');
      if (errorBox) {
        errorBox.textContent = msg;
        errorBox.style.display = 'block';
      }
      msgToast(msg, 'error');
      if (pInp) pInp.value = '';
      return;
    }

    if (data && data.registration) {
      resetSignInUI();
      startDeviceRegistrationFlow(data);
      return;
    }

    if (!response.ok || data.error) {
      resetSignInUI();
      if (errorBox) {
        errorBox.textContent = data.error || 'Invalid credentials. Please try again.';
        errorBox.style.display = 'block';
      }
      if (pInp) pInp.value = '';
      return;
    }

    // Success!
    handleLoginResponse(data);
  } catch (netErr) {
    resetSignInUI();
    if (errorBox) {
      errorBox.textContent = 'Cannot reach server. Please check your network and try again.';
      errorBox.style.display = 'block';
    }
  }
}

async function startDeviceRegistrationFlow(regData) {
  var loginForm = document.getElementById('login-form');
  var heading = document.getElementById('login-heading');
  var sbLinkWrap = document.querySelector('.sb-toggle-wrap');
  var regPanel = document.getElementById('device-reg-panel');

  if (loginForm) loginForm.style.display = 'none';
  if (sbLinkWrap) sbLinkWrap.style.display = 'none';
  if (heading) heading.textContent = 'Device Registration';

  if (!regPanel) {
    regPanel = document.createElement('div');
    regPanel.id = 'device-reg-panel';
    if (loginForm && loginForm.parentNode) {
      loginForm.parentNode.insertBefore(regPanel, loginForm.nextSibling);
    }
  }
  regPanel.style.display = 'block';

  var studentName = (regData.student && (regData.student.fullName || regData.student.username)) || 'Student';
  var pwaStatus = window.DeviceKey ? window.DeviceKey.checkIosPwaStatus() : { isIos: false, needsHomeScreen: false };

  regPanel.innerHTML = `
    <div style="text-align:center;padding:6px 0;">
      <div style="font-size:36px;margin-bottom:8px;">📱</div>
      <h3 style="font-size:16px;font-weight:700;margin:0 0 6px;color:var(--t,#1e293b);">Registering Phone</h3>
      <p style="font-size:13px;color:var(--td,#475569);margin:0 0 16px;">Binding this phone to <b>${studentName}</b></p>
      ${pwaStatus.needsHomeScreen ? `
        <div style="background:#fffbeb;border:1px solid #fef3c7;border-radius:10px;padding:12px;text-align:left;font-size:12px;color:#92400e;margin-bottom:16px;line-height:1.5;">
          <b><re-icon icon="alert-triangle"></re-icon> iPhone Safari Notice:</b><br>
          To prevent iOS Safari from clearing registered device keys after 7 days, please tap <b>Share &rarr; Add to Home Screen</b> first, then open EAMS from your Home Screen.
        </div>
      ` : ''}
      <div id="reg-status-spinner" style="display:flex;align-items:center;justify-content:center;gap:10px;font-size:13px;color:var(--td,#475569);margin:16px 0;">
        <div class="spin" style="width:18px;height:18px;border:2px solid var(--br,#cbd5e1);border-top-color:var(--gM,#16a34a);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
        <span id="reg-status-msg">Generating secure device key…</span>
      </div>
    </div>
  `;

  try {
    if (!window.DeviceKey) {
      throw new Error('Device key cryptographic module is not loaded');
    }

    // 1. Generate / retrieve non-extractable key
    var keyEntry = await window.DeviceKey.initOrGetDeviceKey(regData.student.trackId);
    var installId = window.DeviceKey.getOrCreateInstallId();
    var fingerprintHash = await window.DeviceKey.getFingerprintHash();
    var deviceInfo = await window.DeviceKey.getDeviceInfo();
    var storedThumbprints = await window.DeviceKey.getAllStoredKeyThumbprints();

    var statusMsg = document.getElementById('reg-status-msg');
    if (statusMsg) statusMsg.textContent = 'Submitting device public key…';

    // 2. Submit public key to /api/devices/register/key
    var res = await fetch('/api/devices/register/key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + regData.regToken
      },
      body: JSON.stringify({
        publicKeyJwk: keyEntry.publicKeyJwk,
        installId: installId,
        fingerprintHash: fingerprintHash,
        info: deviceInfo,
        storedKeyThumbprints: storedThumbprints
      })
    });

    var data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Failed to register device profile');
    }

    // 3. Show 6-digit verification code on student screen (§5)
    var verifyCode = data.verifyCode;
    var expiresInSec = data.expiresInSec || 300;

    regPanel.innerHTML = `
      <div style="text-align:center;padding:6px 0;">
        <div style="font-size:36px;margin-bottom:6px;">🔐</div>
        <h3 style="font-size:16px;font-weight:700;margin:0 0 6px;color:var(--t,#1e293b);">Verification Code</h3>
        <p style="font-size:12.5px;color:var(--td,#475569);margin:0 0 16px;">
          Show this 6-digit code to your <b>Class Advisor</b> to complete phone registration:
        </p>

        <div style="background:var(--gLt,#f0fdf4);border:2px dashed var(--gM,#16a34a);border-radius:12px;padding:16px 10px;margin:0 auto 16px;max-width:280px;">
          <div style="font-family:monospace;font-size:32px;font-weight:800;letter-spacing:6px;color:var(--gD,#15803d);">${verifyCode}</div>
          <div style="font-size:11px;color:var(--tmu,#94a3b8);margin-top:6px;">Expires in <span id="reg-code-timer">05:00</span></div>
        </div>

        <div style="display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;color:var(--td,#475569);margin-bottom:18px;">
          <div class="spin" style="width:14px;height:14px;border:2px solid var(--br,#cbd5e1);border-top-color:var(--gM,#16a34a);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
          <span>Waiting for advisor verification…</span>
        </div>

        <button type="button" class="lbn" id="reg-cancel-btn" style="background:none;border:1px solid var(--br,#cbd5e1);color:var(--td,#475569);font-weight:500;box-shadow:none;">
          Cancel Registration
        </button>
      </div>
    `;

    document.getElementById('reg-cancel-btn').onclick = function () {
      clearInterval(pollTimer);
      clearInterval(countTimer);
      resetToSignInForm();
    };

    // Countdown timer
    var timerEl = document.getElementById('reg-code-timer');
    var secondsLeft = expiresInSec;
    var countTimer = setInterval(function () {
      secondsLeft--;
      if (secondsLeft <= 0) {
        clearInterval(countTimer);
        clearInterval(pollTimer);
        if (timerEl) timerEl.textContent = 'Expired';
        msgToast('Verification code expired. Please request a new code from your advisor.', 'error');
        resetToSignInForm();
        return;
      }
      var mins = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
      var secs = String(secondsLeft % 60).padStart(2, '0');
      if (timerEl) timerEl.textContent = mins + ':' + secs;
    }, 1000);

    // Poll verification status every 2.5s (§5: advisor types 6-digit code -> device TRUSTED)
    var pollTimer = setInterval(async function () {
      try {
        var statusRes = await fetch('/api/devices/register/status?_t=' + Date.now(), {
          headers: { 'Authorization': 'Bearer ' + regData.regToken }
        });
        var statusData = await statusRes.json();
        if (statusData && statusData.verified) {
          clearInterval(pollTimer);
          clearInterval(countTimer);

          if (statusData.deviceTrackId && keyEntry) {
            keyEntry.deviceTrackId = statusData.deviceTrackId;
            try {
              await window.DeviceKey.storeKeyEntry(keyEntry);
            } catch (kErr) {}
          }

          // Confirmed!
          regPanel.innerHTML = `
            <div style="text-align:center;padding:16px 0;">
              <div style="width:54px;height:54px;border-radius:50%;background:#dcfce7;color:#16a34a;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px;font-weight:bold;">✓</div>
              <h3 style="font-size:18px;font-weight:700;margin:0 0 6px;color:var(--t,#1e293b);">Phone Registered!</h3>
              <p style="font-size:13px;color:var(--td,#475569);margin:0 0 20px;line-height:1.5;">
                Your device has been verified and trusted by your Class Advisor.<br>
                You can now sign in with your regular password.
              </p>
              <button type="button" class="lbn" id="reg-done-btn">Sign In with Password</button>
            </div>
          `;

          document.getElementById('reg-done-btn').onclick = function () {
            resetToSignInForm();
          };
          msgToast('Device registered and trusted successfully!', 'success');
        } else if (statusData && statusData.error) {
          clearInterval(pollTimer);
          clearInterval(countTimer);
          msgToast(statusData.error, 'error');
          resetToSignInForm();
        }
      } catch (pollErr) {
        // network polling error, retry
      }
    }, 2500);

  } catch (err) {
    regPanel.innerHTML = `
      <div style="text-align:center;padding:16px 0;">
        <div style="font-size:36px;margin-bottom:8px;">❌</div>
        <h3 style="font-size:16px;font-weight:700;margin:0 0 6px;color:#dc2626;">Registration Error</h3>
        <p style="font-size:13px;color:var(--td,#475569);margin:0 0 18px;line-height:1.5;">${err.message || 'Could not complete device registration.'}</p>
        <button type="button" class="lbn" id="reg-retry-btn">Back to Sign In</button>
      </div>
    `;
    document.getElementById('reg-retry-btn').onclick = function () {
      resetToSignInForm();
    };
  }

  function resetToSignInForm() {
    if (regPanel) regPanel.style.display = 'none';
    if (loginForm) loginForm.style.display = 'block';
    if (sbLinkWrap) sbLinkWrap.style.display = 'block';
    if (heading) heading.textContent = 'Sign In';
    var pInp = document.getElementById('lp');
    if (pInp) { pInp.value = ''; pInp.focus(); }
  }
}

function doRedirect(url) {
  window._eamsLoginTiming.mark('redirect', { destination: url });
  window.location.href = url;
}

function handleLoginResponse(data) {
  sessionStorage.setItem('eams_token', data.token);
  sessionStorage.setItem('eams_sessionId', data.sessionId || '');
  sessionStorage.setItem('eams_session_class', data.sessionClass || 'staff');
  if (data.deviceTrackId) {
    sessionStorage.setItem('eams_device_track_id', data.deviceTrackId);
  }
  var isDevMode = !!(window._eamsIsDev || (window._pubSettings && (window._pubSettings.isDev || (window._pubSettings.security && window._pubSettings.security.isDev))));
  sessionStorage.setItem('eams_mustChangePw', (!isDevMode && data.mustChangePassword) ? '1' : '0');
  sessionStorage.setItem('eams_login_time', Date.now().toString());

  if (!isDevMode && data.bootstrapPending) {
    sessionStorage.setItem('eams_bootstrapPending', '1');
    sessionStorage.setItem('eams_user', JSON.stringify(data.user || {}));
    resetSignInUI();
    initBootstrapWizard();
    return;
  }

  if (data.identityType === 'board' || data.role === 'board') {
    if (data.board && data.board.deviceId) {
      localStorage.setItem('eams_board_deviceId', data.board.deviceId);
      // Scrub any plain text board passwords and tokens from persistent localStorage
      localStorage.removeItem('eams_board_key');
      localStorage.removeItem('eams_token');
      // Store device token for kiosk reboot recovery, and session token in sessionStorage
      localStorage.setItem('eams_board_token', data.token);
      sessionStorage.setItem('eams_board_token', data.token);
      sessionStorage.setItem('eams_token', data.token);
    }
    doRedirect('board.html');
    return;
  }

  sessionStorage.setItem('eams_user', JSON.stringify(data.user));

  var returnUrl = sessionStorage.getItem('eams_return_url');
  var verifyReturn = sessionStorage.getItem('eams_verify_return') === 'true';

  if (returnUrl) {
    sessionStorage.removeItem('eams_return_url');
    sessionStorage.removeItem('eams_verify_return');
    // §3.8: admin.html and teacher.html don't keep next (open default landing page)
    var cleanReturn = returnUrl.split('?')[0].replace(/^\//, '');
    if (cleanReturn === 'admin.html' || cleanReturn === 'teacher.html') {
      // Discard and proceed to server redirectTo below
    } else {
      if (verifyReturn && returnUrl.indexOf('timetable') !== -1) {
        if (canUserAccessTimetable(data.user)) {
          doRedirect(returnUrl);
          return;
        } else {
          sessionStorage.removeItem('eams_token');
          sessionStorage.removeItem('eams_user');
          sessionStorage.removeItem('token');
          sessionStorage.removeItem('user');
          sessionStorage.removeItem('eams_sessionId');
          sessionStorage.removeItem('eams_return_url');
          sessionStorage.removeItem('eams_verify_return');
          history.replaceState({}, '', 'index.html');
          resetSignInUI();
          var errBox = document.getElementById('lerr');
          if (errBox) {
            errBox.textContent = 'User is not authorized to access this page. Coordinator or Admin credentials required.';
            errBox.style.display = 'block';
          }
          msgToast('User is not authorized to access Timetable page.', 'error');
          var pInp = document.getElementById('lp');
          if (pInp) pInp.value = '';
          return;
        }
      }
      doRedirect(returnUrl);
      return;
    }
  }

  // Follow server-determined redirectTo (§3.3 & §3.5)
  var targetUrl = data.redirectTo || data.redirectUrl;
  if (targetUrl) {
    if (targetUrl.startsWith('/')) targetUrl = targetUrl.slice(1);
    doRedirect(targetUrl);
    return;
  }

  if (data.role === 'student' || (data.user && data.user.role === 'student')) {
    doRedirect('student.html');
    return;
  }

  var isTeacherRole = data.role === 'teacher' || (data.user && data.user.role === 'teacher');
  var isAdminTeacher = Boolean(
    data.role === 'admin' ||
    data.role === 'sudo' ||
    (data.user && (data.user.isAdmin || data.user.isSudoAdmin || data.user.isSuperAdmin || data.user.isSubAdmin || data.user.role === 'admin' || data.user.role === 'sudo'))
  );

  if (isAdminTeacher) {
    doRedirect('selector.html');
  } else {
    doRedirect('teacher.html');
  }
}

function resetSignInUI() {
  signingIn = false;
  var signInButton = document.getElementById('lbn');
  var lbnTxt = document.getElementById('lbn-txt');
  if (signInButton) {
    signInButton.disabled = false;
    signInButton.innerHTML = isBoardMode
      ? '<span id="lbn-txt">Connect Board</span>'
      : '<span id="lbn-txt">Sign In</span>';
  }
  var lu = document.getElementById('lu');
  if (lu) {
    lu.disabled = false;
  }
  var lp = document.getElementById('lp');
  if (lp) {
    lp.disabled = false;
  }
}

['lu', 'lp'].forEach(function (fieldId) {
  var el = document.getElementById(fieldId);
  if (el) {
    el.addEventListener('keypress', function (event) {
      if (event.key === 'Enter') {
        doSignIn();
      }
    });
  }
});

function togglePw(inputId, btn) {
  var inp = document.getElementById(inputId);
  if (!inp) return;

  var show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';

  btn.innerHTML = show ? '<re-icon icon="eye-off"></re-icon>' : '<re-icon icon="eye"></re-icon>';
  btn.title = show ? 'Hide password' : 'Show password';
}

document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
document.addEventListener('keydown', function (e) {
  if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I', 'J', 'C', 'K'].includes(e.key)) || (e.ctrlKey && e.key === 'U')) {
    e.preventDefault();
    return false;
  }
});

(function devDetect() {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return;
  var warned = false;
  setInterval(function () {
    var d = window.outerWidth - window.innerWidth > 200 || window.outerHeight - window.innerHeight > 200;
    if (d && !warned) {
      warned = true;
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Poppins,sans-serif;font-size:18px;color:#dc2626;flex-direction:column;gap:12px;"><span style="font-size:48px;">&#128274;</span><b>Developer tools are not allowed on this platform.</b></div>';
    }
  }, 1500);
})();

// ══════════════════════════════════════════════════════════════════════════════
//  INITIAL SETUP BOOTSTRAP WIZARD (Phase R3 / §9)
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
  modal.onclick = function(e) {
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
        ind.style.color = 'var(--success, #16a34a)';
        num.style.background = 'var(--success, #16a34a)';
        num.style.color = '#fff';
        num.textContent = '✓';
      } else if (i === stepNum) {
        ind.style.color = 'var(--gK, #2e7d32)';
        num.style.background = 'var(--gK, #2e7d32)';
        num.style.color = '#fff';
        num.textContent = String(i);
      } else {
        ind.style.color = 'var(--tmu, #5a7a5a)';
        num.style.background = 'var(--gLt, #e8f5e9)';
        num.style.color = 'var(--tmu, #5a7a5a)';
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
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (btn) { btn.disabled = false; btn.textContent = 'Next: Department Setup →'; }
    if (res.error) {
      return showBootstrapError(res.error);
    }
    msgToast('Password updated successfully', 'success');
    showBootstrapStep(2);
  })
  .catch(function(err) {
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
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (btn) { btn.disabled = false; btn.textContent = 'Next: Staff Profile →'; }
    if (res.error) {
      return showBootstrapError(res.error);
    }
    _bootstrapState.department = res.department;
    msgToast('Department created successfully', 'success');
    showBootstrapStep(3);
  })
  .catch(function(err) {
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
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (btn) { btn.disabled = false; btn.textContent = 'Complete Bootstrap Setup →'; }
    if (res.error) {
      return showBootstrapError(res.error);
    }
    _bootstrapState.profile = { fullName: fullName, employeeNo: employeeNo, designation: designation, email: email };
    try { sessionStorage.removeItem('eams_bootstrapPending'); } catch (e) {}
    msgToast('Bootstrap setup completed successfully', 'success');
    showBootstrapStep(4);
  })
  .catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Complete Bootstrap Setup →'; }
    showBootstrapError('Network error while saving profile: ' + err.message);
  });
}

function finishBootstrapAndLogout() {
  var token = sessionStorage.getItem('eams_token');
  try {
    sessionStorage.clear();
  } catch (e) {}

  function completeResetOnIndex() {
    var modal = document.getElementById('m-bootstrap-wizard');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('open');
    }
    var pInp = document.getElementById('lp');
    if (pInp) { pInp.value = ''; pInp.focus(); }
    resetSignInUI();
    msgToast('Initial setup completed! Please sign in with your new password.', 'success');
  }

  if (token) {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    }).finally(function() {
      completeResetOnIndex();
    });
  } else {
    completeResetOnIndex();
  }
}

// ══════════════════════════════════════════════════════
//  DEVELOPMENT QUICK-LOGIN FLOATING WIDGET
// ══════════════════════════════════════════════════════

var _devUsersList = [];
var _devActiveTab = 'all';

function initDevModeUI() {
  var pInp = document.getElementById('lp');
  if (pInp) {
    pInp.removeAttribute('required');
    pInp.setAttribute('placeholder', 'Enter password (optional in dev)');
  }
  var uInp = document.getElementById('lu');
  if (uInp) {
    uInp.setAttribute('placeholder', 'Enter username (press Enter in dev)');
  }
  initDevFloatingWidget();
}

async function doDevSignIn(username) {
  if (!username) return;
  if (signingIn) return;
  signingIn = true;

  var uInp = document.getElementById('lu');
  if (uInp) uInp.value = username;

  var btn = document.getElementById('lbn');
  var btnTxt = document.getElementById('lbn-txt');
  var origText = btnTxt ? btnTxt.textContent : 'Sign In';
  if (btn) btn.disabled = true;
  if (btnTxt) btnTxt.textContent = 'Signing in…';

  var errorBox = document.getElementById('lerr');
  if (errorBox) errorBox.style.display = 'none';

  // Highlight active row in dev floating widget if visible
  var activeItem = document.querySelector('.dev-user-item[data-username="' + username + '"]');
  if (activeItem) {
    activeItem.classList.add('loading');
  }

  try {
    var deviceInfo = getClientDeviceInfo();
    var devLocation = (locState && locState.s === 'ready' && locState.p) ? {
      latitude: locState.p.coords.latitude,
      longitude: locState.p.coords.longitude,
      accuracy: locState.p.coords.accuracy,
      ageMs: Math.max(0, Date.now() - (locState.at || Date.now()))
    } : null;
    var res = await fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        username: username,
        device: deviceInfo,
        location: devLocation
      })
    });

    var data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Dev sign-in failed');
    }

    if (activeItem) activeItem.classList.remove('loading');
    handleLoginResponse(data);
  } catch (err) {
    console.error('[dev-login error]', err);
    signingIn = false;
    if (btn) btn.disabled = false;
    if (btnTxt) btnTxt.textContent = origText;
    if (activeItem) activeItem.classList.remove('loading');
    if (errorBox) {
      errorBox.textContent = err.message || 'Login failed';
      errorBox.style.display = 'block';
    }
    msgToast(err.message || 'Dev login failed', 'error');
  }
}
window.doDevSignIn = doDevSignIn;

async function initDevFloatingWidget() {
  if (document.getElementById('dev-floating-widget')) return;

  var widgetWrap = document.createElement('div');
  widgetWrap.id = 'dev-floating-widget';
  widgetWrap.className = 'dev-floating-container';
  widgetWrap.innerHTML = `
    <!-- Floating Pill Button -->
    <button type="button" id="dev-pill-btn" class="dev-floating-pill" title="Dev Quick Login (Click to open accounts)">
      <span class="dev-dot"></span>
      <re-icon icon="bolt" size="14"></re-icon>
      <span class="dev-pill-label">Dev Accounts</span>
      <span class="dev-pill-badge" id="dev-pill-badge">…</span>
    </button>

    <!-- Floating Popover Card -->
    <div id="dev-popover-card" class="dev-floating-card" style="display:none;" aria-hidden="true">
      <div class="dev-card-header">
        <div class="dev-card-title-wrap">
          <div class="dev-card-title">
            <re-icon icon="bolt" size="16"></re-icon>
            <span>Dev Quick Login</span>
          </div>
          <span class="dev-env-tag">DEV MODE</span>
        </div>
        <button type="button" id="dev-card-close" class="dev-card-close" aria-label="Close Quick Login">
          <re-icon icon="x" size="15"></re-icon>
        </button>
      </div>

      <p class="dev-card-sub">Click any account below to sign in instantly without entering a password.</p>

      <div class="dev-search-wrap">
        <span class="dev-search-icon"><re-icon icon="search" size="14"></re-icon></span>
        <input type="text" id="dev-user-search" class="dev-search-input" placeholder="Search by name, username, role, dept..." autocomplete="off">
        <button type="button" id="dev-search-clear" class="dev-search-clear" style="display:none;"><re-icon icon="x" size="12"></re-icon></button>
      </div>

      <div class="dev-tabs">
        <button type="button" class="dev-tab active" data-tab="all">All (<span id="dev-cnt-all">0</span>)</button>
        <button type="button" class="dev-tab" data-tab="Admin">Admin (<span id="dev-cnt-admin">0</span>)</button>
        <button type="button" class="dev-tab" data-tab="Faculty">Faculty (<span id="dev-cnt-fac">0</span>)</button>
        <button type="button" class="dev-tab" data-tab="Student">Student (<span id="dev-cnt-stu">0</span>)</button>
      </div>

      <div id="dev-users-list" class="dev-users-list">
        <div class="dev-loading-state">
          <span class="dev-spinner"></span>
          <span>Loading available accounts…</span>
        </div>
      </div>

      <div class="dev-card-footer">
        <span class="dev-footer-hint"><re-icon icon="sparkles" size="13"></re-icon> Tip: Type any username in the form &amp; hit Enter to log in</span>
      </div>
    </div>
  `;

  document.body.appendChild(widgetWrap);

  var pillBtn = document.getElementById('dev-pill-btn');
  var card = document.getElementById('dev-popover-card');
  var closeBtn = document.getElementById('dev-card-close');
  var searchInp = document.getElementById('dev-user-search');
  var clearBtn = document.getElementById('dev-search-clear');
  var tabs = widgetWrap.querySelectorAll('.dev-tab');

  function toggleCard(open) {
    var shouldOpen = typeof open === 'boolean' ? open : (card.style.display === 'none');
    card.style.display = shouldOpen ? 'flex' : 'none';
    card.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
    pillBtn.classList.toggle('active', shouldOpen);
    if (shouldOpen) {
      if (searchInp) {
        setTimeout(function() { searchInp.focus(); }, 100);
      }
    }
  }

  pillBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    toggleCard();
  });

  closeBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    toggleCard(false);
  });

  // Close when clicking outside
  document.addEventListener('click', function(e) {
    if (!widgetWrap.contains(e.target) && card.style.display !== 'none') {
      toggleCard(false);
    }
  });

  // ESC key closes
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && card.style.display !== 'none') {
      toggleCard(false);
    }
  });

  // Filter tabs
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      tabs.forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      _devActiveTab = tab.getAttribute('data-tab');
      renderDevUsersList();
    });
  });

  // Search input
  if (searchInp) {
    searchInp.addEventListener('input', function() {
      if (clearBtn) clearBtn.style.display = searchInp.value ? 'inline-flex' : 'none';
      renderDevUsersList();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      searchInp.value = '';
      clearBtn.style.display = 'none';
      searchInp.focus();
      renderDevUsersList();
    });
  }

  fetchDevUsers();
}

async function fetchDevUsers() {
  try {
    var res = await fetch('/api/auth/dev-users');
    var data = await res.json();
    if (data.ok && Array.isArray(data.users)) {
      _devUsersList = data.users;
      updateDevCounts();
      renderDevUsersList();
    } else {
      showDevUsersError(data.error || 'Failed to load dev users');
    }
  } catch (err) {
    showDevUsersError('Failed to connect to dev users endpoint');
  }
}

function updateDevCounts() {
  var all = _devUsersList.length;
  var admin = _devUsersList.filter(function(u) { return u.category === 'Admin'; }).length;
  var fac = _devUsersList.filter(function(u) { return u.category === 'Faculty'; }).length;
  var stu = _devUsersList.filter(function(u) { return u.category === 'Student'; }).length;

  var pillBadge = document.getElementById('dev-pill-badge');
  if (pillBadge) pillBadge.textContent = all;

  var cntAll = document.getElementById('dev-cnt-all');
  var cntAdmin = document.getElementById('dev-cnt-admin');
  var cntFac = document.getElementById('dev-cnt-fac');
  var cntStu = document.getElementById('dev-cnt-stu');

  if (cntAll) cntAll.textContent = all;
  if (cntAdmin) cntAdmin.textContent = admin;
  if (cntFac) cntFac.textContent = fac;
  if (cntStu) cntStu.textContent = stu;
}

function renderDevUsersList() {
  var listEl = document.getElementById('dev-users-list');
  if (!listEl) return;

  var searchInp = document.getElementById('dev-user-search');
  var q = searchInp ? searchInp.value.trim().toLowerCase() : '';

  var filtered = _devUsersList.filter(function(u) {
    if (_devActiveTab !== 'all' && u.category !== _devActiveTab) return false;
    if (q) {
      var matchU = (u.username || '').toLowerCase().includes(q);
      var matchN = (u.name || '').toLowerCase().includes(q);
      var matchB = (u.badge || '').toLowerCase().includes(q);
      var matchD = (u.dept || '').toLowerCase().includes(q);
      var matchR = (u.regNo || '').toLowerCase().includes(q);
      var matchC = (u.class || '').toLowerCase().includes(q);
      var matchBatch = (u.batch || '').toLowerCase().includes(q);
      return matchU || matchN || matchB || matchD || matchR || matchC || matchBatch;
    }
    return true;
  });

  if (!filtered.length) {
    listEl.innerHTML = `
      <div class="dev-empty-state">
        <re-icon icon="users" size="24"></re-icon>
        <p>No matching accounts found${q ? ' for "' + escapeHtml(q) + '"' : ''}</p>
      </div>
    `;
    return;
  }

  var html = '';
  filtered.forEach(function(u) {
    var initials = (u.name || u.username || 'U')
      .split(' ')
      .map(function(w) { return w[0]; })
      .join('')
      .slice(0, 2)
      .toUpperCase();

    var roleClass = 'dev-role-fac';
    if (u.badge === 'Sudo Admin') roleClass = 'dev-role-sudo';
    else if (u.badge === 'Principal') roleClass = 'dev-role-principal';
    else if (u.badge === 'Admin') roleClass = 'dev-role-admin';
    else if (u.badge === 'HOD') roleClass = 'dev-role-hod';
    else if (u.badge === 'TT Coord') roleClass = 'dev-role-tt';
    else if (u.badge === 'Class Rep') roleClass = 'dev-role-rep';
    else if (u.badge === 'Student') roleClass = 'dev-role-stu';

    var subMeta = '';
    if (u.category === 'Student') {
      var metaParts = [];
      if (u.class) metaParts.push(u.class);
      else if (u.dept) metaParts.push(u.dept);
      if (u.regNo) metaParts.push(u.regNo);
      subMeta = metaParts.join(' • ');
    } else {
      subMeta = u.dept || '';
    }

    html += `
      <div class="dev-user-item" data-username="${escapeHtml(u.username)}" onclick="doDevSignIn('${escapeHtml(u.username)}')">
        <div class="dev-user-avatar ${roleClass}">${initials}</div>
        <div class="dev-user-info">
          <div class="dev-user-top">
            <span class="dev-user-name">${escapeHtml(u.name || u.username)}</span>
            <span class="dev-badge ${roleClass}">${escapeHtml(u.badge)}</span>
          </div>
          <div class="dev-user-bottom">
            <span class="dev-user-handle">@${escapeHtml(u.username)}</span>
            ${subMeta ? `<span class="dev-user-meta">• ${escapeHtml(subMeta)}</span>` : ''}
          </div>
        </div>
        <div class="dev-user-action">
          <re-icon icon="arrow-right" size="14"></re-icon>
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;
}

function showDevUsersError(msg) {
  var listEl = document.getElementById('dev-users-list');
  if (listEl) {
    listEl.innerHTML = `
      <div class="dev-empty-state error">
        <p style="color:#dc2626;font-size:12px;">${escapeHtml(msg)}</p>
        <button type="button" class="btn-out" onclick="fetchDevUsers()" style="margin-top:8px;font-size:11px;padding:4px 10px;">Retry</button>
      </div>
    `;
  }
}
