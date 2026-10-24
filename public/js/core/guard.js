/**
 * public/js/core/guard.js
 * 
 * Electronic Attendance Management System (EAMS) - Page Guard & Continuous Checks
 * 
 * Invariants & Lifecycle:
 *  1. Token Check: If unauthenticated, redirect to index.html with sanitized next relative path.
 *  2. Access Gate: Fetch GET /api/auth/access before rendering page or trusting client storage.
 *  3. Page Authorization: If page not granted, flash toast and redirect to access.landing.
 *  4. Tab Guard: Remove unauthorized tabs from DOM; deep links fallback to first allowed tab.
 *  5. Action Guard: Hide elements carrying data-requires="<action>"; expose Guard.can(action).
 *  6. Continuous Check: Staff session ping every 60s, on visibility change, and on window focus.
 *  7. Students excluded from ping per D6.
 */

(function (window, document) {
  'use strict';

  if (!window.todayIST) {
    window.todayIST = function(d) {
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
    };
  }

  var PAGE_ALIASES = {
    'maintenance-admin': 'maintenance',
    'maintenance': 'maintenance'
  };

  var ALLOWED_PAGES_LIST = [
    'admin',
    'manage',
    'control',
    'bulk',
    'export',
    'logs',
    'maintenance',
    'maintenance-admin',
    'rooms',
    'settings',
    'timetable',
    'teacher',
    'controller',
    'selector',
    'student',
    'attendance'
  ];

  function getCurrentPageKey() {
    var raw = window.location.pathname.split('/').pop().replace(/\.html$/, '').toLowerCase() || 'index';
    return PAGE_ALIASES[raw] || raw;
  }

  function sanitizeNextPath(url) {
    if (!url || typeof url !== 'string') return null;
    var trimmed = url.trim();
    if (/^(?:[a-z]+:|\/\/|\\)/i.test(trimmed)) return null;
    if (/^(?:javascript|data|vbscript):/i.test(trimmed)) return null;

    var match = trimmed.match(/^([a-zA-Z0-9_\-]+)(?:\.html)?(?:\?.*)?$/);
    if (!match) return null;
    var baseName = match[1].toLowerCase();
    if (ALLOWED_PAGES_LIST.includes(baseName)) {
      return trimmed.endsWith('.html') || trimmed.includes('.html?') ? trimmed : (match[1] + '.html' + (trimmed.includes('?') ? trimmed.slice(trimmed.indexOf('?')) : ''));
    }
    return null;
  }

  function showNotificationToast(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type || 'info');
      return;
    }
    if (typeof window.dbToast === 'function') {
      window.dbToast(msg, type || 'info');
      return;
    }
    // Fallback inline banner
    var toast = document.getElementById('toast') || document.getElementById('db-toast');
    if (toast) {
      toast.textContent = msg;
      toast.className = 'toast show ' + (type || 'info');
      setTimeout(function () {
        toast.className = toast.className.replace('show', '').trim();
      }, 4500);
    } else {
      console.warn('[EAMS Guard]:', msg);
    }
  }

  function handleAuthFailure(reason) {
    if (typeof window.doLogout === 'function') {
      window.doLogout(reason || 'timeout');
      return;
    }
    try { sessionStorage.clear(); } catch (e) {}
    window.location.replace('index.html?logout=' + encodeURIComponent(reason || 'timeout'));
  }

  var Guard = {
    access: null,
    currentAccessVersion: null,
    isReady: false,
    _readyCallbacks: [],
    _lastPingAt: 0,
    _pingTimer: null,

    onReady: function (cb) {
      if (typeof cb !== 'function') return;
      if (this.isReady) {
        cb(this.access);
      } else {
        this._readyCallbacks.push(cb);
      }
    },

    getAccess: function () {
      return this.access;
    },

    can: function (action, tabKey) {
      if (!this.access) return false;
      if (this.access.flags && this.access.flags.isSudo) return true;

      var pageKey = getCurrentPageKey();
      var pageInfo = this.access.pages && (this.access.pages[pageKey] || this.access.pages[pageKey.replace(/\.html$/, '')]);
      if (!pageInfo) return false;

      // Tab-specific action override
      if (tabKey && pageInfo.tabActions && pageInfo.tabActions[tabKey]) {
        var tabActions = pageInfo.tabActions[tabKey];
        if (Array.isArray(tabActions)) {
          return tabActions.includes('*') || tabActions.includes(action);
        }
      }

      var actions = pageInfo.actions || [];
      return actions.includes('*') || actions.includes(action);
    },

    canTab: function (pageKey, tabKey) {
      if (!this.access) return false;
      if (this.access.flags && this.access.flags.isSudo) return true;

      var targetPage = pageKey || getCurrentPageKey();
      var pageInfo = this.access.pages && (this.access.pages[targetPage] || this.access.pages[targetPage.replace(/\.html$/, '')]);
      if (!pageInfo) return false;

      if (!tabKey) return true;
      var allowed = pageInfo.allowedTabs;
      if (Array.isArray(allowed)) {
        if (allowed.includes('*')) return true;
        return allowed.includes(tabKey);
      }
      return true;
    },

    applyActionRestrictions: function (scope) {
      var root = scope || document;
      var requiredEls = root.querySelectorAll('[data-requires]');
      var self = this;

      requiredEls.forEach(function (el) {
        var action = el.getAttribute('data-requires');
        if (!action) return;

        // Optional tab context on element
        var tabContext = el.getAttribute('data-tab-context') || null;
        if (!self.can(action, tabContext)) {
          el.style.display = 'none';
          el.setAttribute('data-guard-hidden', 'true');
          if (el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'SELECT') {
            el.disabled = true;
          }
        } else {
          if (el.getAttribute('data-guard-hidden') === 'true') {
            el.style.display = '';
            el.removeAttribute('data-guard-hidden');
            if (el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'SELECT') {
              el.disabled = false;
            }
          }
        }
      });
    },

    applyTabRestrictions: function () {
      var self = this;
      var pageKey = getCurrentPageKey();
      var pageInfo = this.access && this.access.pages && (this.access.pages[pageKey] || this.access.pages[pageKey.replace(/\.html$/, '')]);
      if (!pageInfo) return;

      var allowedTabs = pageInfo.allowedTabs;
      if (!allowedTabs || allowedTabs.includes('*')) return;

      // Remove unauthorized tabs from sidebar and navigation bars
      var tabEls = document.querySelectorAll('.sb-item[data-page], [data-tab], .tab-btn[data-target]');
      tabEls.forEach(function (el) {
        var tabKey = el.getAttribute('data-page') || el.getAttribute('data-tab') || el.getAttribute('data-target');
        if (tabKey && !self.canTab(pageKey, tabKey)) {
          el.remove();
        }
      });

      // Prune inter-page links in sidebar for pages the user doesn't have access to
      if (this.access && this.access.pages && !(this.access.flags && this.access.flags.isSudo)) {
        var pageButtons = document.querySelectorAll('.sb-item:not([data-page])');
        pageButtons.forEach(function (btn) {
          var onclickStr = btn.getAttribute('onclick') || '';
          var hrefMatch = onclickStr.match(/(?:window\.location(?:\.href)?|location\.href)\s*=\s*['"]([a-zA-Z0-9_\-]+)\.html['"]/);
          if (hrefMatch && hrefMatch[1]) {
            var targetPageKey = hrefMatch[1].toLowerCase();
            if (!self.access.pages[targetPageKey]) {
              btn.remove();
            }
          }
        });
      }

      // Handle deep-linked tab in URL (?tab=...)
      var params = new URLSearchParams(window.location.search);
      var currentTab = params.get('tab') || params.get('page');
      if (currentTab && !self.canTab(pageKey, currentTab)) {
        var fallbackTab = (allowedTabs && allowedTabs.length && allowedTabs[0] !== '*')
          ? allowedTabs[0]
          : 'overview';

        params.set('tab', fallbackTab);
        var newSearch = params.toString() ? ('?' + params.toString()) : '';
        window.history.replaceState(null, '', window.location.pathname + newSearch);

        if (typeof window.nav === 'function') {
          try { window.nav(fallbackTab); } catch (e) {}
        }
      }
    },

    revealPage: function () {
      this.isReady = true;

      var pageKey = getCurrentPageKey();

      // Pages that manage their own multi-step data loading & loader lifecycle
      // (e.g. selector, admin, manage, timetable, controller, control, rooms, hostel)
      // must control their own loader dismissal and app-shell reveal to prevent
      // premature flash of blank/unhydrated content.
      var customLoaderPages = [
        'selector',
        'admin',
        'manage',
        'timetable',
        'controller',
        'control',
        'rooms',
        'hostel'
      ];
      var hasCustomLoader = customLoaderPages.includes(pageKey);

      if (!hasCustomLoader) {
        // Dismiss loader overlay if present
        var loader = document.getElementById('page-loader') || document.querySelector('.page-loader-overlay');
        if (loader) {
          loader.style.display = 'none';
        }

        // Show app shell
        var shell = document.getElementById('app-shell') || document.querySelector('.app-shell');
        if (shell) {
          shell.classList.add('vis');
          shell.style.display = '';
        }
      }

      // Check flash toast
      try {
        var flash = sessionStorage.getItem('eams_flash_toast');
        if (flash) {
          sessionStorage.removeItem('eams_flash_toast');
          var parsed = JSON.parse(flash);
          setTimeout(function () {
            showNotificationToast(parsed.msg, parsed.type || 'info');
          }, 350);
        }
      } catch (e) {}

      // Fire ready callbacks
      while (this._readyCallbacks.length > 0) {
        var cb = this._readyCallbacks.shift();
        try { cb(this.access); } catch (err) { console.error('[Guard Callback Error]:', err); }
      }

      // Dispatch DOM Event
      try {
        window.dispatchEvent(new CustomEvent('eams:guard:ready', { detail: this.access }));
      } catch (e) {}
    },

    refreshAccess: function () {
      var self = this;
      var token = sessionStorage.getItem('eams_token');
      if (!token) {
        handleAuthFailure('timeout');
        return Promise.reject(new Error('No token'));
      }

      return fetch('/api/auth/access', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/json'
        }
      })
      .then(function (res) {
        if (res.status === 401) {
          handleAuthFailure('timeout');
          throw new Error('Unauthorized');
        }
        if (!res.ok) {
          throw new Error('Failed to fetch access rights');
        }
        return res.json();
      })
      .then(function (data) {
        self.access = data;
        self.currentAccessVersion = data.accessVersion;
        try {
          sessionStorage.setItem('eams_access', JSON.stringify(data));
        } catch (e) {}

        var pageKey = getCurrentPageKey();

        if (data.bootstrapPending) {
          try { sessionStorage.setItem('eams_bootstrapPending', '1'); } catch (e) {}
          if (pageKey !== 'index') {
            window.location.replace('index.html');
            return;
          }
        } else {
          try { sessionStorage.removeItem('eams_bootstrapPending'); } catch (e) {}
        }

        var isAllowed = data.pages && (Boolean(data.pages[pageKey]) || Boolean(data.pages[pageKey.replace(/\.html$/, '')]));

        if (!isAllowed && pageKey !== 'index' && pageKey !== 'selector') {
          sessionStorage.setItem('eams_flash_toast', JSON.stringify({
            msg: "You don't have access to " + pageKey,
            type: 'error'
          }));
          window.location.replace(data.landing || 'teacher.html');
          return;
        }

        self.applyTabRestrictions();
        self.applyActionRestrictions();
        return data;
      });
    },

    pingServer: function () {
      var self = this;
      var token = sessionStorage.getItem('eams_token');
      if (!token) return;

      var now = Date.now();
      // Throttle pings to at most once per 5 seconds
      if (now - self._lastPingAt < 5000) return;
      self._lastPingAt = now;

      fetch('/api/auth/ping', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        }
      })
      .then(function (res) {
        if (res.status === 401) {
          handleAuthFailure('timeout');
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.success) return;

        // Check if accessVersion changed (grant edited, revoked, or expired)
        if (data.accessVersion !== undefined && self.currentAccessVersion !== null) {
          if (data.accessVersion !== self.currentAccessVersion) {
            console.log('[EAMS Guard]: Access version changed (' + self.currentAccessVersion + ' -> ' + data.accessVersion + '). Refreshing access...');
            self.refreshAccess().catch(function (err) {
              console.error('[EAMS Guard Refresh Error]:', err);
            });
          }
        }
      })
      .catch(function (err) {
        // Network blips during ping are non-fatal
      });
    },

    startContinuousPing: function () {
      var self = this;
      // D6 invariant: students and student-device sessions are not pinged
      if (self.access && (self.access.accessRole === 'student' || self.access.kind === 'student' || self.access.role === 'student')) {
        return;
      }
      if (sessionStorage.getItem('eams_session_class') === 'student-device') {
        return;
      }

      if (self._pingTimer) clearInterval(self._pingTimer);

      // Ping every 60s
      self._pingTimer = setInterval(function () {
        self.pingServer();
      }, 60 * 1000);

      // Ping on visibilitychange (when tab becomes active)
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
          self.pingServer();
        }
      });

      // Ping on window focus
      window.addEventListener('focus', function () {
        self.pingServer();
      });
    },

    init: function () {
      var self = this;
      var pageKey = getCurrentPageKey();

      // Skip guard on login index page
      if (pageKey === 'index' || window.location.pathname.endsWith('index.html')) {
        return;
      }

      var token = sessionStorage.getItem('eams_token');

      // ── Step 1: Token Check ──
      if (!token) {
        var performRedirect = function () {
          // Attendance deep link preservation
          if (pageKey === 'attendance') {
            var sp = new URLSearchParams(window.location.search);
            var sid = sp.get('sid');
            var qid = sp.get('qid');
            var t = sp.get('t');
            if (sid || qid) {
              window.location.replace('index.html?method=att&sid=' + encodeURIComponent(sid || '') + '&qid=' + encodeURIComponent(qid || '') + '&t=' + encodeURIComponent(t || ''));
              return;
            }
          }

          // admin.html and teacher.html do not keep next (per §3.8 rule)
          if (pageKey === 'admin' || pageKey === 'teacher') {
            window.location.replace('index.html');
            return;
          }

          // All other staff pages keep next parameter with sanitized relative path
          var relativeUrl = pageKey + '.html' + (window.location.search || '');
          var cleanNext = sanitizeNextPath(relativeUrl);
          if (cleanNext) {
            window.location.replace('index.html?next=' + encodeURIComponent(cleanNext));
          } else {
            window.location.replace('index.html');
          }
        };

        // Phase T3: On student and attendance pages, attempt seamless 15-day device session refresh
        if ((pageKey === 'student' || pageKey === 'attendance') && typeof window.DeviceKey === 'object' && typeof window.DeviceKey.trySessionRefresh === 'function') {
          window.DeviceKey.trySessionRefresh().then(function (res) {
            if (res && res.token) {
              self.init();
            } else {
              performRedirect();
            }
          }).catch(function () {
            performRedirect();
          });
          return;
        }

        performRedirect();
        return;
      }

      if (sessionStorage.getItem('eams_bootstrapPending') === '1' && pageKey !== 'index') {
        window.location.replace('index.html');
        return;
      }

      // ── Step 2: Access Check ──
      fetch('/api/auth/access', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/json'
        }
      })
      .then(function (res) {
        if (res.status === 401) {
          handleAuthFailure('timeout');
          throw new Error('Unauthorized');
        }
        if (!res.ok) {
          throw new Error('Access check failed: HTTP ' + res.status);
        }
        return res.json();
      })
      .then(function (data) {
        self.access = data;
        self.currentAccessVersion = data.accessVersion;

        try {
          sessionStorage.setItem('eams_access', JSON.stringify(data));
        } catch (e) {}

        if (data.bootstrapPending) {
          try { sessionStorage.setItem('eams_bootstrapPending', '1'); } catch (e) {}
          if (pageKey !== 'index') {
            window.location.replace('index.html');
            return;
          }
        } else {
          try { sessionStorage.removeItem('eams_bootstrapPending'); } catch (e) {}
        }

        // ── Step 3: Authorization Gate ──
        var isAllowed = data.pages && (Boolean(data.pages[pageKey]) || Boolean(data.pages[pageKey.replace(/\.html$/, '')]));

        if (!isAllowed) {
          sessionStorage.setItem('eams_flash_toast', JSON.stringify({
            msg: "You don't have access to " + pageKey,
            type: 'error'
          }));
          window.location.replace(data.landing || 'teacher.html');
          return;
        }

        // ── Step 4 & 5: Tab & Action Checks ──
        self.applyTabRestrictions();
        self.applyActionRestrictions();

        // ── Step 6: Reveal Page ──
        self.revealPage();

        // ── Step 7: Continuous Checks (Staff) ──
        self.startContinuousPing();
      })
      .catch(function (err) {
        if (err.message !== 'Unauthorized') {
          console.error('[EAMS Guard Init Error]:', err);
          // Allow existing fallback if DB offline
          showNotificationToast('Connection issue while verifying access permissions. Retrying...', 'warn');
          setTimeout(function () {
            self.init();
          }, 4000);
        }
      });
    }
  };

  window.Guard = Guard;

  // Auto-initialize when DOM is interactive
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      Guard.init();
    });
  } else {
    Guard.init();
  }

})(window, document);
