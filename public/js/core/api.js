function apiCall(method, path, body) {
  var tok = sessionStorage.getItem('eams_token');
  return fetch('/api' + path, {
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
      if (data && data.error) throw new Error(data.error);
      return data;
    });
  });
}
