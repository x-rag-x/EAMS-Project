var _toastQueue = [];
var _loaderActive = true;
var _dbToastTimer = null;
var _dbToastDuration = 2000;

function _ensureToastContainer() {
  var t = document.getElementById('toast');
  if (!t && document.body) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  return t;
}

function _ensureDbToastContainer() {
  var el = document.getElementById('db-toast');
  if (!el && document.body) {
    el = document.createElement('div');
    el.id = 'db-toast';
    document.body.appendChild(el);
  }
  return el;
}

function showToast(msg, type) {
  var t = _ensureToastContainer();
  if (!t) return;

  if (/<[a-z][\s\S]*>/i.test(msg)) {
    t.innerHTML = msg;
  } else {
    t.textContent = msg;
  }

  var typeClass = type ? (type === 'black' ? ' t-black black' : ' t-' + type) : '';
  t.className = 'toast' + typeClass + ' show';

  clearTimeout(t._tid);
  var duration = (type === 'black') ? 3500 : 3000;
  t._tid = setTimeout(function() {
    t.className = 'toast';
  }, duration);
}
var showT = showToast;

function dbToast(msg, state, changes) {
  var pl = document.getElementById('page-loader');
  if (pl && pl.style.display !== 'none' && !pl.classList.contains('loader-fade')) {
    _toastQueue.push([msg, state, changes]);
    return;
  }
  _loaderActive = false;

  // state: 'saving' | 'success' | 'error' | 'warn' | 'info'
  var el = _ensureDbToastContainer();
  if (!el) return;

  clearTimeout(_dbToastTimer);
  _dbToastTimer = null;
  el.className = 'show ' + (state || 'saving');

  var icon = state === 'success' ? '✓' : state === 'error' ? '❌' : state === 'warn' ? '⚠️' : state === 'info' ? 'ℹ️' : '';
  var spinHtml = state === 'saving' ? '<div class="db-spin"></div>' : '';

  var closeBtn = '<span id="db-toast-close" style="position:absolute;top:6px;right:8px;cursor:pointer;font-size:10px;">✖</span>';

  // Progress bar — only rendered when there is a countdown (not in saving state)
  var progressBar = state !== 'saving'
    ? '<div id="db-toast-bar"></div>'
    : '';

  el.innerHTML =
    progressBar +
    closeBtn +
    spinHtml +
    '<div style="display:flex;flex-direction:column;gap:4px;">' +
    '<div style="font-size:13px;font-weight:700;">' +
    icon + (icon ? ' ' : '') + msg +
    '</div>' +
    (changes
      ? '<div style="font-size:12.5px;font-weight:600;opacity:.95;">' + changes + '</div>'
      : ''
    ) +
    '</div>';

  // Close button functionality
  var closeEl = document.getElementById('db-toast-close');
  if (closeEl) {
    closeEl.onclick = function () {
      el.classList.remove('show');
      clearTimeout(_dbToastTimer);
      _dbToastTimer = null;
    };
  }

  // CRITICAL FIX: When state is 'saving', DO NOT auto-close.
  // Wait indefinitely with the spinner active until an explicit success/error/warn update arrives.
  if (state === 'saving') {
    el.onmouseenter = null;
    el.onmouseleave = null;
    return;
  }

  // Kick off bar animation (scaleX 1 → 0 over _dbToastDuration ms)
  var barEl = document.getElementById('db-toast-bar');
  var _remainingMs = _dbToastDuration;

  function startBar(durationMs) {
    if (!barEl) return;
    barEl.style.transition = 'none';
    barEl.style.transform = 'scaleX(1)';
    barEl.getBoundingClientRect();
    barEl.style.transition = 'transform ' + durationMs + 'ms linear';
    barEl.style.transform = 'scaleX(0)';
  }

  function pauseBar() {
    if (!barEl) return;
    var computed = window.getComputedStyle(barEl).transform;
    barEl.style.transition = 'none';
    barEl.style.transform = computed;
    var scaleX = 1;
    if (computed && computed !== 'none') {
      var m = computed.match(/matrix\(([^,]+)/);
      if (m) scaleX = parseFloat(m[1]);
    }
    _remainingMs = Math.max(0, Math.round(scaleX * _dbToastDuration));
  }

  startBar(_remainingMs);

  // Hover: freeze bar + pause countdown
  el.onmouseenter = function () {
    clearTimeout(_dbToastTimer);
    pauseBar();
  };

  el.onmouseleave = function () {
    startBar(_remainingMs);
    _dbToastTimer = setTimeout(function () {
      el.classList.remove('show');
    }, _remainingMs);
  };

  // Auto hide for completed / terminal states
  _dbToastTimer = setTimeout(function () {
    el.classList.remove('show');
  }, _dbToastDuration);
}

function flushToastQueue() {
  _loaderActive = false;
  _toastQueue.forEach(function(a) { dbToast(a[0], a[1], a[2]); });
  _toastQueue = [];
}

var _actionToast = { interval: null };

function actionToast(opts) {
  if (opts.key && window._lastActionToastKey === opts.key) return;
  if (opts.key) window._lastActionToastKey = opts.key;
  clearActionToastTimers();
  var old = document.getElementById('action-toast');
  if (old) { old.classList.remove('at-show'); old.remove(); }
  var duration = (typeof opts.duration === 'number') ? opts.duration : 5;
  var remaining = duration;
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
  requestAnimationFrame(function() {
    requestAnimationFrame(function() { toast.classList.add('at-show'); });
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
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 420);
    if (runConfirm && typeof opts.onConfirm === 'function') {
      try { opts.onConfirm(); } catch (e) { console.error(e); }
    }
  }
  _actionToast.interval = setInterval(function() {
    remaining--;
    if (timerEl) timerEl.textContent = remaining;
    if (remaining <= 0) { dismiss(true); }
  }, 1000);
  toast.querySelector('.at-cancel').addEventListener('click', function(e) {
    e.preventDefault();
    dismiss(false);
    if (typeof opts.onCancel === 'function') opts.onCancel();
  });
  window._activeActionToastDismiss = dismiss;
}

function clearActionToastTimers() {
  if (_actionToast.interval) { clearInterval(_actionToast.interval); _actionToast.interval = null; }
}

// Global window exposure for unified app-wide access
if (typeof window !== 'undefined') {
  window.showToast = showToast;
  window.showT = showToast;
  window.dbToast = dbToast;
  window.dbtoast = dbToast;
  window.toast = function (msg, type) {
    if (type === 'saving' || type === 'success' || type === 'error' || type === 'warn') {
      dbToast(msg, type);
    } else {
      showToast(msg, type);
    }
  };
  window.flushToastQueue = flushToastQueue;
  window.actionToast = actionToast;
  window.clearActionToastTimers = clearActionToastTimers;
}
