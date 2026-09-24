(function() {
  var maintData = null;
  var countdownInterval = null;
  var endTime = null;
  var startTime = null;
  var refreshTimer = 30;
  var refreshIntervalId = null;

  function pad(n) { return String(n).padStart(2, '0'); }

  function fmt(dateStr) {
    if (!dateStr) return '—';
    try {
      var d = new Date(dateStr);
      return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', hour12: true });
    } catch(e) { return dateStr; }
  }

  function updateCountdown() {
    if (!endTime) return;
    var now = Date.now();
    var diff = endTime - now;
    if (diff <= 0) {
      document.getElementById('cd-h').textContent = '00';
      document.getElementById('cd-m').textContent = '00';
      document.getElementById('cd-s').textContent = '00';
      loadMaintData();
      return;
    }
    var h = Math.floor(diff / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    var s = Math.floor((diff % 60000) / 1000);
    document.getElementById('cd-h').textContent = pad(h);
    document.getElementById('cd-m').textContent = pad(m);
    document.getElementById('cd-s').textContent = pad(s);

    if (startTime) {
      var total = endTime - startTime;
      var elapsed = now - startTime;
      var pct = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
      document.getElementById('progress-fill').style.width = pct + '%';
      document.getElementById('progress-pct').textContent = pct + '% complete';
    }
  }

  function renderMaint(data) {
    maintData = data;

    if (data.message) {
      document.getElementById('maint-message').textContent = data.message;
    }

    var affected = data.affectedRoles || [];
    if (affected.length > 0) {
      var roleLabels = affected.map(function(r) {
        return r === 'teacher' ? 'Teachers' : r === 'student' ? 'Students' : r === 'subadmin' ? 'Sub-Admins' : r;
      });
      document.getElementById('maint-subtitle').textContent = 'Access is restricted for ' + roleLabels.join(', ') + '. Admins can still log in.';
      document.getElementById('pill-role').textContent = roleLabels.join(', ') + ' affected';
      document.getElementById('pill-role-wrap').style.display = 'inline-flex';
      document.getElementById('info-affected').textContent = roleLabels.join(', ');
      document.getElementById('affected-row').style.display = 'flex';
    }

    if (data.startedAt) {
      startTime = new Date(data.startedAt).getTime();
      document.getElementById('info-started').textContent = fmt(data.startedAt);
    } else {
      startTime = Date.now();
      document.getElementById('info-started').textContent = 'Just now';
    }

    if (data.endTime) {
      endTime = new Date(data.endTime).getTime();
      document.getElementById('info-end').textContent = fmt(data.endTime);
      document.getElementById('end-row').style.display = 'flex';
      document.getElementById('countdown-wrap').style.display = 'block';
      document.getElementById('progress-wrap').style.display = 'block';
      document.getElementById('pill-time').textContent = 'Ends ' + fmt(data.endTime);
      document.getElementById('pill-time-wrap').style.display = 'inline-flex';

      if (countdownInterval) clearInterval(countdownInterval);
      updateCountdown();
      countdownInterval = setInterval(updateCountdown, 1000);
    }
  }

  function loadMaintData() {
    fetch('/api/settings/maintenance')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.active) {
          window.location.href = 'index.html';
          return;
        }
        renderMaint(data);
      })
      .catch(function() {});
  }

  function startRefreshCounter() {
    refreshTimer = 30;
    if (refreshIntervalId) clearInterval(refreshIntervalId);
    refreshIntervalId = setInterval(function() {
      refreshTimer--;
      var el = document.getElementById('next-refresh');
      if (el) el.textContent = 'next check in ' + refreshTimer + 's';
      if (refreshTimer <= 0) {
        loadMaintData();
        refreshTimer = 30;
      }
    }, 1000);
  }

  var stored = sessionStorage.getItem('maint_data');
  if (stored) {
    try {
      renderMaint(JSON.parse(stored));
      sessionStorage.removeItem('maint_data');
    } catch(e) {}
  }

  loadMaintData();
  startRefreshCounter();

  document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
})();
