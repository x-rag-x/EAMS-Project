function apiCall(method, path, body) {
  if (typeof recordSessionActivity === 'function') recordSessionActivity();
  var tok = sessionStorage.getItem('eams_token');
  var cleanPath = (typeof path === 'string' && path.startsWith('/api'))
    ? path.slice(4)
    : path;
  if (typeof cleanPath === 'string' && !cleanPath.startsWith('/')) {
    cleanPath = '/' + cleanPath;
  }
  return fetch('/api' + cleanPath, {
    method: method,
    headers: { 'Content-Type': 'application/json', 'Authorization': tok ? 'Bearer ' + tok : '' },
    body: body ? JSON.stringify(body) : undefined
  }).then(function (r) {
    if (r.status === 401) {
      doLogout('timeout');
      throw new Error('Authentication failed');
    }
    var ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error('Non-JSON response (' + r.status + ') from ' + path);
    }
    return r.json().then(function (data) {
      if (r.status === 403 && data && (data.code === 'BOOTSTRAP_REQUIRED' || data.bootstrapPending)) {
        try { sessionStorage.setItem('eams_bootstrapPending', '1'); } catch (e) {}
        window.location.replace('index.html');
        throw new Error(data.error || 'Bootstrap required');
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    });
  });
}
