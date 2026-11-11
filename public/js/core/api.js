// Centralized API Client with Adaptive Low-Bandwidth Timeout, SWR Cache, Auto-Retry, Session Tracking, 401/403/429/503 Handling, and In-Flight Deduplication

var _apiInFlight = new Map();
var _apiCache = new Map();
var _lowBandwidthBannerTimeout = null;

function isLowBandwidthEnvironment() {
  try {
    if (typeof window !== 'undefined') {
      if (window.EAMS_LOW_BANDWIDTH === true) return true;
      if (sessionStorage.getItem('eams_low_bandwidth') === '1') return true;
    }
    if (typeof navigator !== 'undefined' && navigator.connection) {
      var c = navigator.connection;
      var eff = (c.effectiveType || '').toLowerCase();
      if (eff === 'slow-2g' || eff === '2g' || eff === '3g' || c.saveData === true || (c.rtt && c.rtt > 650) || (c.downlink && c.downlink < 1.0)) {
        return true;
      }
    }
  } catch (_) {}
  return false;
}

function showNetworkWarning(msg, type) {
  if (typeof document === 'undefined') return;
  var pill = document.getElementById('eams-net-indicator');
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'eams-net-indicator';
    pill.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:999998;background:#1e293b;color:#f8fafc;padding:8px 14px;border-radius:20px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;box-shadow:0 4px 12px rgba(0,0,0,0.22);transition:all 0.25s ease;border:1px solid #334155;';
    if (document.body) document.body.appendChild(pill);
  }
  var color = type === 'warn' ? '#f59e0b' : (type === 'danger' ? '#ef4444' : (type === 'success' ? '#10b981' : '#3b82f6'));
  pill.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + color + ';"></span> <span>' + (msg || 'Slow network connection') + '</span>';
  pill.style.display = 'flex';
  pill.style.opacity = '1';

  clearTimeout(_lowBandwidthBannerTimeout);
  _lowBandwidthBannerTimeout = setTimeout(function () {
    if (pill) {
      pill.style.opacity = '0';
      setTimeout(function () { if (pill) pill.style.display = 'none'; }, 250);
    }
  }, 4500);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', function () {
    showNetworkWarning('Connection restored (online)', 'success');
  });
  window.addEventListener('offline', function () {
    showNetworkWarning('Connection lost (working offline)', 'danger');
  });
}

function show503Banner(msg) {
  if (typeof document === 'undefined') return;
  var banner = document.getElementById('eams-503-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'eams-503-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#b91c1c;color:#fff;text-align:center;padding:10px 16px;font-size:13px;font-weight:600;box-shadow:0 2px 10px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;gap:8px;';
    banner.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fca5a5;"></span> <span id="eams-503-banner-text"></span>';
    if (document.body) document.body.prepend(banner);
  }
  var textEl = document.getElementById('eams-503-banner-text');
  if (textEl) textEl.textContent = msg || 'Database or service temporarily unavailable. Please retry in a moment.';
  banner.style.display = 'flex';
  setTimeout(function () {
    if (banner) banner.style.display = 'none';
  }, 8000);
}

/**
 * Universal api() wrapper supporting both fetch-style and apiCall-style invocations:
 *   api(url, options)
 *   api(method, path, body, options)
 */
function api(arg1, arg2, arg3, arg4) {
  var method, path, body, options;
  if (typeof arg1 === 'string' && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(arg1)) {
    method = arg1.toUpperCase();
    path = arg2;
    body = arg3;
    options = Object.assign({}, arg4);
  } else {
    path = arg1;
    options = Object.assign({}, arg2);
    method = (options.method || 'GET').toUpperCase();
    body = options.body;
  }

  var isBg = Boolean(options && (options.background === true || (options.headers && (options.headers['x-background-request'] === 'true' || options.headers['X-Background-Request'] === 'true'))));
  if (!isBg && typeof recordSessionActivity === 'function') {
    recordSessionActivity();
  }

  // Normalize path
  var cleanPath = path;
  if (typeof cleanPath === 'string' && !cleanPath.startsWith('http://') && !cleanPath.startsWith('https://')) {
    if (cleanPath.startsWith('/api')) {
      // already starts with /api
    } else if (cleanPath.startsWith('/')) {
      cleanPath = '/api' + cleanPath;
    } else {
      cleanPath = '/api/' + cleanPath;
    }
  }

  var cacheKey = method + ':' + cleanPath;

  // Deduplicate identical in-flight GET requests
  var dedupeKey = null;
  if (method === 'GET' && options.dedupe !== false && typeof cleanPath === 'string') {
    dedupeKey = 'GET:' + cleanPath;
    if (_apiInFlight.has(dedupeKey)) {
      return _apiInFlight.get(dedupeKey);
    }
  }

  var tok = null;
  try {
    tok = sessionStorage.getItem('eams_token');
  } catch (e) {}
  if (!tok && typeof TOKEN !== 'undefined') tok = TOKEN;
  if (!tok && typeof getToken === 'function') tok = getToken();

  var isTeacherPortal = typeof window !== 'undefined' && window.location && window.location.pathname && window.location.pathname.toLowerCase().indexOf('teacher') !== -1;
  var headers = Object.assign({}, options.headers || {});
  if (isTeacherPortal && !headers['X-Portal'] && !headers['x-portal']) {
    headers['X-Portal'] = 'teacher';
  }
  if (tok && !headers['Authorization'] && !headers['authorization']) {
    headers['Authorization'] = 'Bearer ' + tok;
  }

  // Process body and Content-Type
  var finalBody = body;
  if (finalBody !== undefined && finalBody !== null) {
    if (typeof finalBody === 'object' && !(finalBody instanceof FormData) && !(finalBody instanceof URLSearchParams) && !(finalBody instanceof Blob)) {
      finalBody = JSON.stringify(finalBody);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }
  }

  // Adaptive timeout for low bandwidth networks (60s on low bandwidth, 45s normal)
  var isSlowNet = isLowBandwidthEnvironment();
  var defaultTimeout = isSlowNet ? 60000 : 45000;
  var timeoutMs = options.timeout || defaultTimeout;

  // Max retries on low-bandwidth / network timeouts (GET requests default to 2 retries)
  var maxRetries = options.retries !== undefined ? options.retries : (method === 'GET' ? 2 : 0);

  function executeFetchWithRetry(attempt) {
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      try {
        controller.abort(new Error('Request timeout (' + timeoutMs + 'ms)'));
      } catch (e) {
        controller.abort();
      }
    }, timeoutMs);

    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timeoutId);
        controller.abort();
      } else {
        options.signal.addEventListener('abort', function () {
          clearTimeout(timeoutId);
          controller.abort();
        });
      }
    }

    return fetch(cleanPath, {
      method: method,
      headers: headers,
      body: finalBody,
      signal: controller.signal
    }).then(function (r) {
      clearTimeout(timeoutId);

      // 401 Unauthorized / Expired session
      if (r.status === 401) {
        if (typeof doLogout === 'function') {
          doLogout('timeout');
        } else {
          try { sessionStorage.clear(); } catch (e) {}
          window.location.replace('index.html');
        }
        var err401 = new Error('Authentication failed / Session expired');
        err401.status = 401;
        throw err401;
      }

      var ct = r.headers.get('content-type') || '';

      // Handle 204 No Content
      if (r.status === 204) {
        var emptyData = {};
        decorateData(emptyData, r);
        return emptyData;
      }

      // Verify JSON content-type
      var isJson = ct.includes('application/json');

      return r.text().then(function (rawText) {
        var data;
        if (!rawText || !rawText.trim()) {
          data = {};
        } else if (isJson) {
          try {
            data = JSON.parse(rawText);
          } catch (e) {
            throw new Error('Malformed JSON response from ' + cleanPath);
          }
        } else {
          if (!r.ok) {
            throw new Error('HTTP ' + r.status + ' from ' + cleanPath);
          }
          throw new Error('Non-JSON response (' + r.status + ') from ' + cleanPath);
        }

        // 403 Forbidden with specific codes
        if (r.status === 403 && data) {
          if (data.code === 'BOOTSTRAP_REQUIRED' || data.bootstrapPending) {
            try { sessionStorage.setItem('eams_bootstrapPending', '1'); } catch (e) {}
            window.location.replace('index.html');
            throw new Error(data.error || 'Bootstrap required');
          }
          if (data.code === 'PASSWORD_CHANGE_REQUIRED') {
            if (typeof showForcePwModal === 'function') {
              showForcePwModal();
            } else if (typeof window.showForcePwModal === 'function') {
              window.showForcePwModal();
            } else if (typeof openForceChangePwModal === 'function') {
              openForceChangePwModal();
            } else if (typeof openModal === 'function' && document.getElementById('m-change-password')) {
              openModal('m-change-password');
            }
            if (typeof showToast === 'function') showToast(data.error || 'Password change required before proceeding.', 'warn');
            throw new Error(data.error || 'Password change required');
          }
          if (data.portalDisabled && typeof showToast === 'function') {
            showToast(data.error || 'Portal disabled by administrator', 'warn');
          }
        }

        // 429 Too Many Requests (Rate Limited)
        if (r.status === 429) {
          var retryAfter = r.headers.get('Retry-After') || r.headers.get('retry-after');
          var retryMsg = (data && data.error) || ('Rate limit reached. Please retry in ' + (retryAfter ? retryAfter + 's' : 'a moment.'));
          if (typeof showToast === 'function') showToast(retryMsg, 'warning');
          var err429 = new Error(retryMsg);
          err429.status = 429;
          err429.retryAfter = retryAfter;
          throw err429;
        }

        // 503 Service Unavailable / Offline
        if (r.status === 503) {
          if (data && data.maintenance) {
            try { sessionStorage.setItem('maint_data', JSON.stringify(data)); } catch (e) {}
            window.location.replace('maintenance.html');
            throw new Error('System under maintenance');
          }
          var msg503 = (data && data.error) || 'Service temporarily unavailable. Please retry.';
          show503Banner(msg503);
          if (typeof showToast === 'function') showToast(msg503, 'danger');
          var err503 = new Error(msg503);
          err503.status = 503;
          throw err503;
        }

        decorateData(data, r);

        if (options.throwOnError && (!r.ok || (data && data.error))) {
          var throwErr = new Error((data && data.error) || ('Request failed with status ' + r.status));
          throwErr.status = r.status;
          throwErr.data = data;
          throw throwErr;
        }

        // Cache successful GET responses for low-bandwidth resilience
        if (method === 'GET' && options.cache !== false) {
          _apiCache.set(cacheKey, { data: data, timestamp: Date.now() });
        } else if (method !== 'GET') {
          // Mutating action succeeded: invalidate related cache entries
          var prefix = cleanPath.split('?')[0];
          _apiCache.forEach(function (val, key) {
            if (key.includes(prefix) || key.includes('leave') || key.includes('od') || key.includes('attendance')) {
              _apiCache.delete(key);
            }
          });
        }

        return data;
      });
    }).catch(function (err) {
      clearTimeout(timeoutId);

      // Auto-retry on network dropouts or timeouts if retries remain
      var isTimeoutOrNetworkError = (err.name === 'AbortError' || (err.message && err.message.includes('timeout')) || err instanceof TypeError);
      if (isTimeoutOrNetworkError && attempt < maxRetries) {
        var backoffMs = Math.min(1000 * Math.pow(1.5, attempt), 3000);
        showNetworkWarning('Weak connection: retrying (' + (attempt + 1) + '/' + maxRetries + ')...', 'warn');
        return new Promise(function (resolve) {
          setTimeout(resolve, backoffMs);
        }).then(function () {
          return executeFetchWithRetry(attempt + 1);
        });
      }

      // If network fails completely but cached data is available, return cached data
      if (method === 'GET' && _apiCache.has(cacheKey)) {
        var cachedEntry = _apiCache.get(cacheKey);
        showNetworkWarning('Slow network: Showing cached records', 'warn');
        var fallbackData = Object.assign({}, cachedEntry.data);
        fallbackData.__isCached = true;
        fallbackData.__isStale = true;
        decorateData(fallbackData, { ok: true, status: 200, headers: new Headers() });
        return fallbackData;
      }

      throw err;
    });
  }

  var fetchPromise = executeFetchWithRetry(0);

  if (dedupeKey) {
    _apiInFlight.set(dedupeKey, fetchPromise);
    fetchPromise.finally(function () {
      _apiInFlight.delete(dedupeKey);
    });
  }

  return fetchPromise;
}

function decorateData(data, r) {
  if (data && (typeof data === 'object' || Array.isArray(data))) {
    if (data.ok === undefined) {
      Object.defineProperty(data, 'ok', { value: r ? r.ok : true, writable: true, configurable: true, enumerable: false });
    }
    if (data.status === undefined) {
      Object.defineProperty(data, 'status', { value: r ? r.status : 200, writable: true, configurable: true, enumerable: false });
    }
    if (data.headers === undefined) {
      Object.defineProperty(data, 'headers', { value: r ? r.headers : {}, writable: true, configurable: true, enumerable: false });
    }
    if (data.json === undefined) {
      Object.defineProperty(data, 'json', {
        value: function () { return Promise.resolve(this); },
        writable: true,
        configurable: true,
        enumerable: false
      });
    }
    if (data.text === undefined) {
      Object.defineProperty(data, 'text', {
        value: function () { return Promise.resolve(JSON.stringify(this)); },
        writable: true,
        configurable: true,
        enumerable: false
      });
    }
  }
}

function apiCall(method, path, body, options) {
  return api(method, path, body, Object.assign({ throwOnError: true }, options));
}

function apiDownload(path, defaultFilename) {
  if (typeof recordSessionActivity === 'function') recordSessionActivity();
  var tok = sessionStorage.getItem('eams_token');
  var cleanPath = (typeof path === 'string' && path.startsWith('/api'))
    ? path.slice(4)
    : path;
  if (typeof cleanPath === 'string' && !cleanPath.startsWith('/')) {
    cleanPath = '/' + cleanPath;
  }
  return fetch('/api' + cleanPath, {
    method: 'GET',
    headers: {
      'Authorization': tok ? 'Bearer ' + tok : '',
      'X-Portal': (typeof window !== 'undefined' && window.location && window.location.pathname && window.location.pathname.toLowerCase().indexOf('teacher') !== -1) ? 'teacher' : ''
    }
  }).then(function (r) {
    if (r.status === 401) {
      if (typeof doLogout === 'function') doLogout('timeout');
      throw new Error('Authentication failed');
    }
    if (!r.ok) {
      return r.json().catch(function () { return { error: 'Export failed (' + r.status + ')' }; }).then(function (err) {
        throw new Error(err.error || 'Export failed');
      });
    }
    var cd = r.headers.get('content-disposition') || '';
    var match = cd.match(/filename="?([^";]+)"?/);
    var filename = match ? match[1] : (defaultFilename || 'download');

    return r.blob().then(function (blob) {
      var blobUrl = window.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
      }, 100);
    });
  });
}

if (typeof window !== 'undefined') {
  window.api = api;
  window.apiCall = apiCall;
  window.apiDownload = apiDownload;
  window.eamsIsLowBandwidth = isLowBandwidthEnvironment;
  window.eamsSetLowBandwidth = function(val) {
    window.EAMS_LOW_BANDWIDTH = Boolean(val);
    try {
      if (val) sessionStorage.setItem('eams_low_bandwidth', '1');
      else sessionStorage.removeItem('eams_low_bandwidth');
    } catch (_) {}
    showNetworkWarning(val ? 'Low-Bandwidth Mode Enabled' : 'Standard Network Mode', val ? 'warn' : 'success');
  };
}
