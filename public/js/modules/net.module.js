/**
 * public/js/modules/net.module.js
 * EAMS Timetable v3 — Network Quality Monitor & Lite Mode Engine (Phase 7, Section 2 & 4)
 *
 * Implements:
 * 1. Online / Offline status tracking and connectivity heartbeat probe
 * 2. EWMA (Exponentially Weighted Moving Average) latency tracking
 * 3. Lite Mode detection (Save-Data, 2G/3G, high latency > 800ms)
 * 4. html[data-tt-lite] attribute controller
 * 5. Event dispatching for offline module and UI adapters
 */

(function (window) {
  'use strict';

  let _online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  let _liteMode = false;
  let _ewmaLatency = 200; // ms
  let _lastProbeTime = 0;
  let _listeners = [];
  let _heartbeatTimer = null;
  let _reconnectAttempts = 0;
  let _nextRetrySec = 0;
  let _countdownTimer = null;
  let _abortController = null;
  let _bgStopped = false;
  let _isReconnecting = false;

  function evaluateLiteMode() {
    let shouldBeLite = false;

    if (typeof navigator !== 'undefined' && navigator.connection) {
      const conn = navigator.connection;
      if (conn.saveData === true) shouldBeLite = true;
      if (['slow-2g', '2g', '3g'].includes(conn.effectiveType)) shouldBeLite = true;
    }

    if (_ewmaLatency > 800) shouldBeLite = true;

    // Check manual override from user preference
    const manualPref = sessionStorage.getItem('tt_lite_mode');
    if (manualPref !== null) {
      shouldBeLite = manualPref === 'true';
    }

    setLiteMode(shouldBeLite);
  }

  function setLiteMode(enabled) {
    _liteMode = Boolean(enabled);
    if (typeof document !== 'undefined' && document.documentElement) {
      if (_liteMode) {
        document.documentElement.setAttribute('data-tt-lite', 'true');
      } else {
        document.documentElement.removeAttribute('data-tt-lite');
      }
    }
    notifyListeners();
  }

  function notifyListeners() {
    const detail = {
      online: _online,
      liteMode: _liteMode,
      latency: Math.round(_ewmaLatency),
      reconnecting: !_online && !_bgStopped,
      attempt: _reconnectAttempts,
      nextRetryIn: _nextRetrySec
    };

    _listeners.forEach(cb => {
      try { cb(detail); } catch (e) { console.error('[TimetableNet listener error]:', e); }
    });

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tt-connection-change', { detail }));
    }
  }

  let _consecutiveFailures = 0;

  function getRetryGap(attempt) {
    if (!attempt || attempt <= 1) return 10;
    if (attempt === 2) return 15;
    return 20;
  }

  function startCountdown() {
    if (_countdownTimer) clearInterval(_countdownTimer);
    if (_bgStopped || _online) return;

    if (_nextRetrySec <= 0) _nextRetrySec = getRetryGap(_reconnectAttempts || 1);
    _countdownTimer = setInterval(() => {
      if (_bgStopped || _online) {
        clearInterval(_countdownTimer);
        _countdownTimer = null;
        return;
      }

      if (_nextRetrySec > 1) {
        _nextRetrySec--;
        notifyListeners();
      } else {
        _nextRetrySec = 0;
        clearInterval(_countdownTimer);
        _countdownTimer = null;
        pingProbe();
      }
    }, 1000);
  }

  async function pingProbe() {
    if (_bgStopped) return;
    if (typeof fetch === 'undefined') return;

    // Abort existing in-flight probe if any
    if (_abortController) {
      try { _abortController.abort(); } catch (_) {}
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    _abortController = controller;
    const start = Date.now();
    _isReconnecting = !_online;

    // If already offline, notify listeners of current state
    if (!_online) {
      notifyListeners();
    }

    let succeeded = false;
    let res = null;

    try {
      const timeout = setTimeout(() => {
        if (controller && !controller.signal.aborted) controller.abort();
      }, 5000);

      // Probe primary /api/timetable/ping, with fallback to /timetable/ping
      const pingUrls = ['/api/timetable/ping', '/timetable/ping'];
      for (const url of pingUrls) {
        try {
          res = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
            signal: controller ? controller.signal : undefined
          });
          // Any HTTP status < 500 (204, 200, 304, 401, 403) confirms the backend web server is reachable
          if (res && res.status < 500) {
            succeeded = true;
            break;
          }
        } catch (_) {}
      }
      clearTimeout(timeout);

      const elapsed = Date.now() - start;
      _lastProbeTime = Date.now();
      _ewmaLatency = (_ewmaLatency * 0.8) + (elapsed * 0.2);

      if (succeeded) {
        _consecutiveFailures = 0;
        const wasOffline = !_online;
        _online = true;
        _reconnectAttempts = 0;
        _nextRetrySec = 0;
        _isReconnecting = false;
        if (_countdownTimer) {
          clearInterval(_countdownTimer);
          _countdownTimer = null;
        }
        evaluateLiteMode();
        if (wasOffline) {
          notifyListeners();
        }
        startHeartbeat();
      } else {
        throw new Error('All ping endpoints unreachable');
      }
    } catch (err) {
      if (_bgStopped) return;
      _consecutiveFailures++;
      const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

      // Only enter offline reconnect mode if browser hardware is offline OR 2 consecutive probes fail
      if (isBrowserOffline || _consecutiveFailures >= 2) {
        _online = false;
        _isReconnecting = true;
        _reconnectAttempts++;
        _nextRetrySec = getRetryGap(_reconnectAttempts);
        evaluateLiteMode();
        notifyListeners();
        startCountdown();
      } else {
        // First transient hitch while browser claims online: do not flash offline, schedule next probe calmly
        _nextRetrySec = getRetryGap(1);
        startCountdown();
      }
    } finally {
      if (_abortController === controller) {
        _abortController = null;
      }
    }
  }

  function startHeartbeat() {
    if (_heartbeatTimer) clearInterval(_heartbeatTimer);
    if (_bgStopped) return;

    if (!_online) {
      startCountdown();
      return;
    }

    _heartbeatTimer = setInterval(() => {
      if (!_bgStopped && _online) {
        pingProbe();
      }
    }, 30000);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      _bgStopped = false;
      _consecutiveFailures = 0;
      _reconnectAttempts = 0;
      _nextRetrySec = 0;
      _online = true;
      if (_countdownTimer) {
        clearInterval(_countdownTimer);
        _countdownTimer = null;
      }
      notifyListeners();
      pingProbe();
    });

    window.addEventListener('offline', () => {
      _online = false;
      _consecutiveFailures = 2;
      _reconnectAttempts = 1;
      _nextRetrySec = getRetryGap(1);
      notifyListeners();
      startCountdown();
    });

    if (navigator.connection && typeof navigator.connection.addEventListener === 'function') {
      navigator.connection.addEventListener('change', () => {
        evaluateLiteMode();
      });
    }

    // Initial run
    evaluateLiteMode();
    startHeartbeat();
  }

  const TimetableNet = {
    isOnline: () => _online,
    isLiteMode: () => _liteMode,
    isReconnecting: () => !_online && !_bgStopped,
    getLatency: () => Math.round(_ewmaLatency),
    getReconnectState: () => ({
      online: _online,
      reconnecting: !_online && !_bgStopped,
      attempt: _reconnectAttempts,
      nextRetryIn: _nextRetrySec
    }),
    pingProbe,
    reconnectNow: () => {
      if (_countdownTimer) {
        clearInterval(_countdownTimer);
        _countdownTimer = null;
      }
      _nextRetrySec = 0;
      return pingProbe();
    },
    stopBackgroundProcesses: () => {
      _bgStopped = true;
      if (_abortController) {
        try { _abortController.abort(); } catch (_) {}
        _abortController = null;
      }
      if (_heartbeatTimer) {
        clearInterval(_heartbeatTimer);
        _heartbeatTimer = null;
      }
      if (_countdownTimer) {
        clearInterval(_countdownTimer);
        _countdownTimer = null;
      }
    },
    resumeHeartbeat: () => {
      _bgStopped = false;
      startHeartbeat();
      if (!_online) {
        startCountdown();
      }
    },
    setOnline: (val) => {
      _online = Boolean(val);
      if (_online) {
        _reconnectAttempts = 0;
        _nextRetrySec = 0;
        _isReconnecting = false;
        if (_countdownTimer) {
          clearInterval(_countdownTimer);
          _countdownTimer = null;
        }
        startHeartbeat();
      }
      notifyListeners();
    },
    toggleLiteMode: () => {
      const next = !_liteMode;
      sessionStorage.setItem('tt_lite_mode', String(next));
      setLiteMode(next);
      return next;
    },
    setLiteMode,
    onConnectionChange: (cb) => {
      if (typeof cb === 'function') {
        _listeners.push(cb);
        cb({
          online: _online,
          liteMode: _liteMode,
          latency: Math.round(_ewmaLatency),
          reconnecting: !_online && !_bgStopped,
          attempt: _reconnectAttempts,
          nextRetryIn: _nextRetrySec
        });
      }
    }
  };

  window.TimetableNet = TimetableNet;
})(typeof window !== 'undefined' ? window : global);
