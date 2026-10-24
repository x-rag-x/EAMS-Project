function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ══ AUTH ══════════════════════════════════════════════════════════════
var USER = getUser();
var TOKEN = getToken();

// Init topbar from cached user
if (USER) {
  var _initials = (USER.name || 'S').split(' ').map(function(w){return w[0];}).join('').slice(0,2).toUpperCase();
  document.getElementById('av-initials').textContent = _initials;
  document.getElementById('sb-av').textContent = _initials;
  document.getElementById('tb-name').textContent = USER.name || 'Student';
  document.getElementById('sb-name').textContent = USER.name || 'Student';
}

function toast(msg, type) {
  var state = type === 'error' ? 'error' : (type === 'warn' ? 'saving' : (type === 'saving' ? 'saving' : 'success'));
  if (typeof dbToast === 'function') {
    dbToast(msg, state);
  } else if (typeof showToast === 'function') {
    showToast(msg, type);
  }
}

// ══ API HELPER ════════════════════════════════════════════════════════
function api(url, opts, skipLogout) {
  opts = opts || {};
  opts.headers = Object.assign({ 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, opts.headers || {});
  return fetch(url, opts).then(function(r) {
    if (r.status === 401 && !skipLogout) { doLogout(); throw new Error('Session expired'); }
    if (r.status === 503) {
      return r.text().then(function(txt) {
        var d; try { d = JSON.parse(txt); } catch(e) { throw new Error('Server error (503)'); }
        if (d.maintenance) { sessionStorage.setItem('maint_data', JSON.stringify(d)); window.location.href = 'maintenance.html'; }
        throw new Error(d.error || 'Service unavailable');
      });
    }
    return r.text().then(function(txt) {
      if (!txt || !txt.trim()) return {};
      if (txt.trim().charAt(0) === '<') throw new Error('Server returned an unexpected response (HTTP ' + r.status + '). Check that the API server is running.');
      try { return JSON.parse(txt); } catch(e) { throw new Error('Invalid response from server.'); }
    });
  });
}

// ══ TOGGLE PW ════════════════════════════════════════════════════════
function togglePw(id, btn) {
  var inp = document.getElementById(id);
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.innerHTML = inp.type === 'password' ? '<re-icon icon="eye"></re-icon>' : '<re-icon icon="eye-off"></re-icon>';
}

// ══ PASSWORD STRENGTH ════════════════════════════════════════════════
function updateStrength(val, barId) {
  var bar = document.getElementById(barId);
  if (!bar) return;
  var score = 0;
  if (val.length >= 6) score++;
  if (val.length >= 10) score++;
  if (/[A-Z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;
  var pct = (score / 5) * 100;
  var color = score <= 1 ? '#ef4444' : score <= 3 ? '#f59e0b' : '#22c55e';
  bar.style.width = pct + '%';
  bar.style.background = color;
}

// ══ CHANGE PASSWORD ═══════════════════════════════════════════════════
function doChangePw() {
  var oldPw = document.getElementById('chpw-old').value;
  var newPw = document.getElementById('chpw-new').value;
  var cfm   = document.getElementById('chpw-confirm').value;
  var errEl = document.getElementById('chpw-err');
  errEl.style.display = 'none';
  if (!oldPw || !newPw || !cfm) { errEl.textContent = 'All fields required.'; errEl.style.display = 'block'; return; }
  if (newPw.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
  if (newPw !== cfm) { errEl.textContent = 'Passwords do not match.'; errEl.style.display = 'block'; return; }
  if(oldPw === newPw) {errEl.textContent = 'Old and new password must not be same'; errEl.style.display = 'block'; return; }
  if(newPw.toUpperCase().includes('STUDENT')) {errEl.textContent = 'Password must not contain STUDENT'; errEl.style.display = 'block'; return; }

  api('/api/auth/change-password', { method:'POST', body:JSON.stringify({ currentPassword:oldPw, newPassword:newPw }) }, true)
  .then(function(d) {
    if (d.error) { errEl.textContent = d.error; errEl.style.display = 'block'; return; }
    sessionStorage.removeItem('eams_mustChangePw');
    closeModal('m-chpw');
    toast('Password updated successfully!');
    document.getElementById('chpw-old').value = '';
    document.getElementById('chpw-new').value = '';
    document.getElementById('chpw-confirm').value = '';
    var banner = document.querySelector('.must-change-banner');
    if (banner) banner.style.display = 'none';
  })
  .catch(function(e) { errEl.textContent = e.message; errEl.style.display = 'block'; });
}

// Same for inline profile change password
function doChangePwInline() {
  var oldPw = document.getElementById('prof-pw-old').value;
  var newPw = document.getElementById('prof-pw-new').value;
  var cfm   = document.getElementById('prof-pw-confirm').value;
  var errEl = document.getElementById('prof-pw-err');
  errEl.style.display = 'none';
  if (!oldPw || !newPw || !cfm) { errEl.textContent = 'All fields required.'; errEl.style.display = 'block'; return; }
  if (newPw.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
  if (newPw !== cfm) { errEl.textContent = 'Passwords do not match.'; errEl.style.display = 'block'; return; }
  if(oldPw === newPw) {errEl.textContent = 'Old and new password must not be same'; errEl.style.display = 'block'; return; }
  if(newPw.toUpperCase().includes('STUDENT')) {errEl.textContent = 'Password must not contain STUDENT'; errEl.style.display = 'block'; return; }
  api('/api/auth/change-password', { method:'POST', body:JSON.stringify({ currentPassword:oldPw, newPassword:newPw }) }, true)
  .then(function(d) {
    if (d.error) { errEl.textContent = d.error; errEl.style.display = 'block'; return; }
    sessionStorage.removeItem('eams_mustChangePw');
    toast('Password updated successfully!');
    document.getElementById('prof-pw-old').value = '';
    document.getElementById('prof-pw-new').value = '';
    document.getElementById('prof-pw-confirm').value = '';
    var str = document.getElementById('prof-pw-strength');
    if (str) { str.style.width = '0%'; }
  })
  .catch(function(e) { errEl.textContent = e.message; errEl.style.display = 'block'; });
}

function openChangePw() { openModal('m-chpw'); }

// ══ SIDEBAR ══════════════════════════════════════════════════════════
function toggleSidebar() {
  var sb = document.getElementById('sidebar');
  var ov = document.getElementById('sb-overlay');
  sb.classList.toggle('sb-mobile-open');
  ov.classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('sb-mobile-open');
  document.getElementById('sb-overlay').classList.remove('show');
}

// ══ VIEW SWITCHING ════════════════════════════════════════════════════
var _currentView = 'dashboard';
function showView(name) {
  _currentView = name;
  document.querySelectorAll('.pg').forEach(function(v) { v.classList.remove('act'); });
  document.querySelectorAll('.sb-item').forEach(function(b) { b.classList.remove('active'); });
  var viewEl = document.getElementById('view-' + name);
  if (viewEl) viewEl.classList.add('act');
  var navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');
  var profileChip = document.querySelector('.profile-chip');
  if (profileChip) {
    if (name === 'profile') profileChip.classList.add('active');
    else profileChip.classList.remove('active');
  }
  // Update topbar label
  var labels = { dashboard: 'Dashboard', profile: 'My Profile', attendance: 'Attendance', leave: 'Apply Leave', od: 'On-Duty (OD)', 'rep-att': 'Class Rep Attendance' };
  var tbLabel = document.getElementById('tb-page-label');
  if (tbLabel) tbLabel.textContent = labels[name] || name;
  // If data is ready, render the appropriate view
  if (_data) {
    if (name === 'dashboard') renderPortal(_data);
    else if (name === 'profile') renderProfilePage(_data);
    else if (name === 'attendance') renderAttendancePage(_data);
    else if (name === 'leave') loadLeaveData();
    else if (name === 'od') loadODData();
    else if (name === 'rep-att') loadRepPendingSession();
  } else if (name === 'leave') {
    loadLeaveData();
  } else if (name === 'od') {
    loadODData();
  } else if (name === 'rep-att') {
    loadRepPendingSession();
  }
  closeSidebar();
  window.scrollTo(0, 0);
}

// ══ UTILS ════════════════════════════════════════════════════════════
function pad2(n) { return String(n).padStart(2,'0'); }
function fmtDate(str) {
  if (!str) return '—';
  var d = new Date(str);
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}
function fmtDateTime(str) {
  if (!str) return '—';
  var d = new Date(str);
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var h = d.getHours(), m = d.getMinutes();
  var ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ', ' + h + ':' + pad2(m) + ' ' + ampm;
}
function daysSince(str) {
  if (!str) return '—';
  var ms = Date.now() - new Date(str).getTime();
  var days = Math.floor(ms / 86400000);
  if (days === 0) return 'now';
  return days + ' day' + (days !== 1 ? 's' : '') + ' ago';
}

var _GLOBAL_ACAD = { minAttendance: null, lowAttendanceThreshold: null, academicYear: '' };
var _ACTIVE_YEAR = '';

// Load academic parameters strictly from settings
var _settingsPromise = fetch('/api/settings/public')
  .then(function(r){ return r.json(); })
  .then(function(pub){
    window._pubSettings = pub;
    if (pub && pub.academic) {
      if (typeof pub.academic.minAttendance === 'number') _GLOBAL_ACAD.minAttendance = pub.academic.minAttendance;
      else if (pub.academic.minAttendance) _GLOBAL_ACAD.minAttendance = Number(pub.academic.minAttendance);

      if (typeof pub.academic.lowAttendanceThreshold === 'number') _GLOBAL_ACAD.lowAttendanceThreshold = pub.academic.lowAttendanceThreshold;
      else if (pub.academic.lowAttendanceThreshold) _GLOBAL_ACAD.lowAttendanceThreshold = Number(pub.academic.lowAttendanceThreshold);

      if (pub.academic.academicYear) _GLOBAL_ACAD.academicYear = pub.academic.academicYear;
    }
    if (pub && pub.institution) {
      var shortN = pub.institution.institutionShort || '';
      document.title = shortN ? ('EAMS – Student | ' + shortN) : 'EAMS – Student';
    }
    if (pub && pub.models) {
      if (pub.models.modelLeave === false) {
        var el = document.getElementById('nav-leave');
        if (el) el.style.display = 'none';
      }
      if (pub.models.modelNotifications === false) {
        var el = document.getElementById('st-notif-btn');
        if (el) el.style.display = 'none';
      }
      if (pub.models.modelExportSheet === false) {
        document.querySelectorAll('.btn-export').forEach(function(b){ b.style.display = 'none'; });
      }
    }
    return pub;
  }).catch(function(e){ console.warn(e); });

// Fetch active year from yearconfig
var _yearPromise = fetch('/api/year/current', { headers: { 'Authorization': 'Bearer ' + TOKEN } })
  .then(function(r){ return r.ok ? r.json() : null; })
  .then(function(yr){ if (yr) _ACTIVE_YEAR = yr; return yr; })
  .catch(function(){});

function getClass(pct, minReq) {
  var minA = (typeof minReq === 'number')
    ? minReq
    : (_GLOBAL_ACAD.minAttendance !== null && _GLOBAL_ACAD.minAttendance !== undefined ? _GLOBAL_ACAD.minAttendance : 75);
  var lowA = (_GLOBAL_ACAD.lowAttendanceThreshold !== null && _GLOBAL_ACAD.lowAttendanceThreshold !== undefined)
    ? _GLOBAL_ACAD.lowAttendanceThreshold
    : (minA - 10);
  if (pct >= minA) return 'ok';
  if (pct >= lowA) return 'warn';
  return 'danger';
}
function calcShortage(present, total, minReq) {
  if (total === 0) return 0;
  var minA = (typeof minReq === 'number')
    ? minReq
    : (_GLOBAL_ACAD.minAttendance !== null && _GLOBAL_ACAD.minAttendance !== undefined ? _GLOBAL_ACAD.minAttendance : 75);
  var pct = present / total;
  if (pct * 100 >= minA) return 0;
  return Math.max(0, Math.ceil((minA * total - 100 * present) / (100 - minA)));
}
function buildGaugeSVG(pct, cls) {
  var r = 52, cx = 65, cy = 65;
  var circ = 2 * Math.PI * r;
  var fillColor = cls === 'ok' ? '#4caf50' : cls === 'warn' ? '#f59e0b' : '#ef4444';
  var dashLen = (pct / 100) * circ;
  return '<svg class="gauge-svg" width="130" height="130" viewBox="0 0 130 130">'
    + '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="#e5e7eb" stroke-width="10"/>'
    + '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+fillColor+'" stroke-width="10"'
    + ' stroke-dasharray="'+dashLen+' '+circ+'" stroke-linecap="round"'
    + ' style="transition:stroke-dasharray .8s ease;"/></svg>';
}

// ══ DASHBOARD RENDER ═════════════════════════════════════════════════
var _data = null;

function renderPortal(d) {
  _data = d;
  var stu  = d.student || {};
  var att  = d.attendance || { subjects: [], totalPresent: 0, totalAbsent: 0, totalClasses: 0, overall: 0, minRequired: 75 };
  var usr  = d.user || {};
  var minR = (att && typeof att.minRequired === 'number')
    ? att.minRequired
    : (_GLOBAL_ACAD.minAttendance !== null && _GLOBAL_ACAD.minAttendance !== undefined ? _GLOBAL_ACAD.minAttendance : 75);
  var oPct = att.overall || 0;
  var oCls = getClass(oPct, minR);

  // Update sidebar and topbar
  var displayName = stu.name || usr.name || 'Student';
  var initials = displayName.split(' ').map(function(w){return w[0];}).join('').slice(0,2).toUpperCase();
  var avTop = document.getElementById('av-initials'); if (avTop) avTop.textContent = initials;
  var avSb  = document.getElementById('sb-av'); if (avSb) avSb.textContent = initials;
  var nameTop = document.getElementById('tb-name'); if (nameTop) nameTop.textContent = displayName;
  var nameSb  = document.getElementById('sb-name'); if (nameSb) nameSb.textContent = displayName;
  var regSb   = document.getElementById('sb-reg'); if (regSb) regSb.textContent = stu.regNo || '—';

  if (stu.isRep || (USER && USER.isRep)) {
    var navRep = document.getElementById('nav-rep-att');
    if (navRep) navRep.style.display = 'flex';
  }

  var isDevHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  var mustChange = !isDevHost && sessionStorage.getItem('eams_mustChangePw') === '1';
  var html = '';
  if (mustChange) {
    html += '<div class="must-change-banner" style="background:#fff3cd;border:1.5px solid #f59e0b;border-radius:14px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:12px;">'
      + '<span style="font-size:20px;"><re-icon icon="shield-lock"></re-icon></span>'
      + '<div style="flex:1;"><div style="font-size:13px;font-weight:700;color:#92400e;">Password Change Required</div><div style="font-size:11.5px;color:#b45309;margin-top:2px;">Your default password must be changed before proceeding.</div></div>'
      + '<button onclick="openChangePw()" style="padding:8px 16px;border-radius:10px;background:#f59e0b;border:none;color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:Poppins,sans-serif;">Change Now <re-icon icon="arrow-right"></re-icon></button>'
      + '</div>';
  }

  html += '<div id="live-session-container"></div>';

  // Hero
  var badgeClass = oCls === 'ok' ? 'badge-ok' : oCls === 'warn' ? 'badge-warn' : 'badge-danger';
  var badgeText  = oCls === 'ok' ? '<re-icon icon="check-circle"></re-icon> On Track' : oCls === 'warn' ? '<re-icon icon="alert-triangle"></re-icon> Below Threshold' : '<re-icon icon="siren"></re-icon> Critical';
  var yearToDisplay = _ACTIVE_YEAR || _GLOBAL_ACAD.academicYear || stu.academicYear || '—';

  html += '<div class="hero">'
    + '<div class="hero-av">'+initials+'</div>'
    + '<div class="hero-info">'
    + '<div class="hero-greeting">Welcome back,</div>'
    + '<div class="hero-name">'+displayName+'</div>'
    + '<div style="font-size:11.5px;color:rgba(255,255,255,.7);margin-top:2px;">'+(stu.regNo||'—')+' &nbsp;·&nbsp; '+(stu.deptName||'—')+'</div>'
    + '<div class="hero-pills">'
    + '<span class="hero-pill"><re-icon icon="chalkboard"></re-icon> '+(stu.className||'—')+'</span>'
    + '<span class="hero-pill"><re-icon icon="calendar"></re-icon> '+yearToDisplay+'</span>'
    + (stu.isClassRep?'<span class="hero-pill"><re-icon icon="sparkles"></re-icon> Class Rep</span>':'')
    + '</div></div>'
    + '<div class="hero-right"><div class="hero-pct-wrap">'
    + '<div class="hero-pct">'+oPct+'%</div>'
    + '<div class="hero-pct-label">Overall Attendance</div>'
    + '<span class="hero-pct-badge '+badgeClass+'">'+badgeText+'</span>'
    + '</div></div></div>';

  // Stats
  var shortage = calcShortage(att.totalPresent, att.totalClasses, minR);
  html += '<div class="stats-row">'
    + '<div class="stat-card"><div class="sc-icon"><re-icon icon="book-open"></re-icon></div><div class="sc-val">'+att.totalClasses+'</div><div class="sc-label">Total Classes</div><div class="sc-sub">Across all subjects</div></div>'
    + '<div class="stat-card"><div class="sc-icon"><re-icon icon="check-circle"></re-icon></div><div class="sc-val" style="color:var(--gK);">'+att.totalPresent+'</div><div class="sc-label">Present</div><div class="sc-sub">Classes attended</div></div>'
    + '<div class="stat-card"><div class="sc-icon"><re-icon icon="x-circle"></re-icon></div><div class="sc-val" style="color:#ef4444;">'+att.totalAbsent+'</div><div class="sc-label">Absent</div><div class="sc-sub">Classes missed</div></div>'
    + '<div class="stat-card"><div class="sc-icon">'+(shortage>0?'<re-icon icon="alert-triangle"></re-icon>':'<re-icon icon="flag"></re-icon>')+'</div><div class="sc-val" style="color:'+(shortage>0?'#f59e0b':'var(--gK)')+';">'+(shortage>0?shortage:'—')+'</div><div class="sc-label">'+(shortage>0?'Classes Needed':'Requirement Met')+'</div><div class="sc-sub">To reach '+minR+'% threshold</div></div>'
    + '</div>';

  // Two-col: gauge + profile quick view
  var gaugeColor = oCls==='ok'?'var(--gK)':oCls==='warn'?'#b45309':'#dc2626';
  html += '<div class="two-col">';
  html += '<div class="card">'
    + '<div class="card-hd"><div class="card-title"><re-icon icon="grid"></re-icon> Attendance Overview</div></div>'
    + '<div class="card-body" style="display:flex;flex-direction:column;align-items:center;padding:20px;">'
    + '<div class="gauge-outer">'+buildGaugeSVG(oPct,oCls)
    + '<div class="gauge-center"><div class="gauge-pct-txt" style="color:'+gaugeColor+';">'+oPct+'%</div><div class="gauge-lbl-txt">Overall</div></div></div>'
    + '<div style="margin-top:18px;width:100%;display:flex;flex-direction:column;gap:8px;">'
    + gaugeRow('Present',att.totalPresent,att.totalClasses,'var(--gK)')
    + gaugeRow('Absent',att.totalAbsent,att.totalClasses,'#ef4444')
    + '<div style="padding:10px 0 0;border-top:1px solid var(--brl);text-align:center;font-size:11.5px;color:var(--tmu);">Minimum required: <b style="color:'+gaugeColor+';">'+minR+'%</b>'
    + (shortage>0?' &nbsp;·&nbsp; Need <b style="color:#dc2626;">'+shortage+'</b> more classes':' &nbsp;·&nbsp; <b style="color:var(--gK);">You are on track <re-icon icon="confetti"></re-icon></b>')
    + '</div></div></div></div>';

  html += '<div class="card">'
    + '<div class="card-hd"><div class="card-title"><re-icon icon="user"></re-icon> Student Profile</div>'
    + '<button onclick="showView(\'profile\')" style="font-size:11px;padding:4px 12px;border-radius:12px;border:1.5px solid var(--br);background:var(--gP);color:var(--tmu);cursor:pointer;font-family:Poppins,sans-serif;">View Full Profile <re-icon icon="arrow-right"></re-icon></button>'
    + '</div>'
    + '<div class="card-body"><div class="profile-grid">'
    + pRow('Register No.', stu.regNo || '—')
    + pRow('Department', stu.deptName||'—')
    + pRow('Class', stu.className||'—')
    + pRow('Year', stu.year||'—')
    + pRow('Course', stu.courseType||'—')
    + pRow('Branch', stu.branch||'—')
    + pRow('Academic Year', stu.academicYear||'—')
    + pRow('Email', stu.email||usr.email||'—')
    + pRow('Blood Group', stu.bloodGroup||'—')
    + pRow('Last Login', usr.lastLogin ? fmtDate(usr.lastLogin) : 'First login')
    + pRow('Class Rep', stu.isClassRep?'Yes <re-icon icon="sparkles"></re-icon>':'No')
    + '</div></div></div>';
  html += '</div>';

  // Subject table
  html += '<div class="card" style="margin-bottom:18px;">'
    + '<div class="card-hd"><div class="card-title"><re-icon icon="book-open"></re-icon> Subject-wise Attendance</div>'
    + '<span style="font-size:11px;color:var(--tdi);">Click a subject row to see details</span>'
    + '</div>'
    + '<div style="overflow-x:auto;">'
    + '<table class="tbl"><thead><tr>'
    + '<th>Subject</th><th>Teacher</th><th>Present</th><th>Absent</th><th>Total</th><th style="min-width:140px;">Attendance</th><th>Status</th>'
    + '</tr></thead><tbody id="sub-tbody"></tbody></table></div></div>';

  html += '<div class="card">'
    + '<div class="card-hd"><div class="card-title"><re-icon icon="calendar"></re-icon> Recent Attendance Log</div></div>'
    + '<div class="card-body">'
    + '<div class="tabs-row" id="sub-tabs"></div>'
    + '<div id="sub-cal"></div>'
    + '</div></div>';

  var mainEl = document.getElementById('main-content');
  if (mainEl) mainEl.innerHTML = html;

  renderSubjectTableInto('sub-tbody', 'sub-detail-', att.subjects, minR);
  renderSubjectTabsInto('sub-tabs', 'sub-cal', att.subjects);
}

function gaugeRow(label, val, total, color) {
  var pct = total > 0 ? Math.round(val/total*100) : 0;
  return '<div style="display:flex;align-items:center;gap:8px;font-size:12px;">'
    + '<span style="width:10px;height:10px;border-radius:50%;background:'+color+';flex-shrink:0;display:inline-block;"></span>'
    + '<span style="color:var(--tmu);flex:1;">'+label+'</span>'
    + '<span style="font-weight:700;color:'+color+';">'+val+'</span>'
    + '<span style="color:var(--tdi);font-size:10px;">('+pct+'%)</span>'
    + '</div>';
}
function pRow(label, val) {
  return '<div class="prow"><div class="plabel">'+label+'</div><div class="pval">'+val+'</div></div>';
}

function renderSubjectTableInto(tbodyId, detailPrefix, subjects, minR) {
  var tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  if (!subjects || !subjects.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><span class="ei"><re-icon icon="inbox"></re-icon></span><p>No attendance data found yet.</p></div></td></tr>';
    return;
  }
  var html = '';
  subjects.forEach(function(s, idx) {
    var cls = getClass(s.percentage, minR);
    var shortage = calcShortage(s.present, s.total, minR);
    var statusHtml = shortage > 0
      ? '<span class="shortage-badge">Need '+shortage+' more</span>'
      : '<span class="ok-badge"><re-icon icon="check-circle"></re-icon> On Track</span>';
    var detailId = detailPrefix + idx;
    html += '<tr style="cursor:pointer;" onclick="toggleNamedDetail(\'' + detailId + '\')">'
      + '<td class="b"><re-icon icon="book-open"></re-icon> '+(s.subjectName||'—')+'</td>'
      + '<td>'+(s.teacherName||'—')+'</td>'
      + '<td style="color:var(--gK);font-weight:600;">'+s.present+'</td>'
      + '<td style="color:#ef4444;font-weight:600;">'+s.absent+'</td>'
      + '<td>'+s.total+'</td>'
      + '<td><div class="prog-wrap prog-'+cls+'"><div class="prog-bar"><div class="prog-fill" style="width:'+s.percentage+'%;"></div></div><div class="prog-pct">'+s.percentage+'%</div></div></td>'
      + '<td>'+statusHtml+'</td>'
      + '</tr>'
      + '<tr><td colspan="7" style="padding:0;"><div class="sub-detail-row" id="' + detailId + '">'
      + renderDateChips(s.dates)
      + '</div></td></tr>';
  });
  tbody.innerHTML = html;
}

function renderDateChips(dates) {
  if (!dates || !dates.length) return '<div style="font-size:12px;color:var(--tdi);padding:4px;">No records yet.</div>';
  var chips = dates.slice().reverse().map(function(d) {
    return '<span class="att-chip '+d.status+'">'+d.date+' '+(d.status==='present'?'<re-icon icon="check-circle"></re-icon>':'<re-icon icon="x-circle"></re-icon>')+'</span>';
  }).join('');
  return '<div style="display:flex;flex-wrap:wrap;gap:2px;">'+chips+'</div>';
}

function toggleNamedDetail(detailId) {
  var el = document.getElementById(detailId);
  if (!el) return;
  if (el.classList.contains('open')) {
    el.classList.remove('open');
  } else {
    document.querySelectorAll('.sub-detail-row.open').forEach(function(e){ e.classList.remove('open'); });
    el.classList.add('open');
  }
}

function renderSubjectTabsInto(tabsId, calId, subjects) {
  var tabsEl = document.getElementById(tabsId);
  var calEl  = document.getElementById(calId);
  if (!tabsEl || !calEl) return;
  if (!subjects || !subjects.length) {
    tabsEl.innerHTML = '';
    calEl.innerHTML = '<div class="empty-state"><span class="ei"><re-icon icon="inbox"></re-icon></span><p>No subjects found.</p></div>';
    return;
  }
  var tabsHtml = subjects.map(function(s, idx) {
    return '<button class="tab-btn' + (idx===0 ? ' act' : '') + '" onclick="switchSubjectCalInTarget(\'' + calId + '\',' + idx + ',this)">' + (s.subjectName||'Subject '+(idx+1)) + '</button>';
  }).join('');
  tabsEl.innerHTML = tabsHtml;
  renderCalendarInto(calId, subjects[0]);
}

function switchSubjectCalInTarget(calId, idx, btn) {
  if (btn && btn.parentNode) {
    btn.parentNode.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('act'); });
    btn.classList.add('act');
  }
  if (_data && _data.attendance && _data.attendance.subjects) {
    renderCalendarInto(calId, _data.attendance.subjects[idx]);
  }
}

function renderCalendarInto(calId, subject) {
  var calEl = document.getElementById(calId);
  if (!calEl) return;
  var dates = subject ? subject.dates : [];
  if (!dates || !dates.length) {
    calEl.innerHTML = '<div class="empty-state"><span class="ei"><re-icon icon="calendar"></re-icon></span><p>No attendance records for this subject yet.</p></div>';
    return;
  }
  var map = {};
  dates.forEach(function(d) { map[d.date] = d.status; });
  var _tParts = todayIST().split('-').map(Number);
  var today = new Date(_tParts[0], _tParts[1] - 1, _tParts[2]);
  var calStart = new Date(today);
  calStart.setDate(today.getDate() - today.getDay() - 28);
  var html = '<div style="font-size:12px;font-weight:600;color:var(--tmu);margin-bottom:10px;">Last 5 weeks — ' + (subject ? subject.subjectName : '') + '</div>';
  html += '<div class="cal-grid">';
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(function(d) { html += '<div class="cal-day-hdr">'+d+'</div>'; });
  for (var i = 0; i < 35; i++) {
    var d = new Date(calStart); d.setDate(calStart.getDate()+i);
    var iso = todayIST(d);
    var status = map[iso];
    var cls = 'empty';
    if (status === 'present') cls = 'present';
    else if (status === 'absent') cls = 'absent';
    var isToday = iso === todayIST();
    html += '<div class="cal-day '+cls+(isToday?' today':'')+'" title="'+iso+(status?' — '+status:'')+'">'
      + (status?(status==='present'?'<re-icon icon="check-circle"></re-icon>':'<re-icon icon="x-circle"></re-icon>'):'<span style="opacity:.4;">'+d.getDate()+'</span>')
      + '</div>';
  }
  html += '</div>';
  html += '<div style="display:flex;gap:14px;margin-top:10px;flex-wrap:wrap;">'
    + '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--tmu);"><div style="width:14px;height:14px;border-radius:4px;background:rgba(76,175,80,.15);"></div>Present</div>'
    + '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--tmu);"><div style="width:14px;height:14px;border-radius:4px;background:rgba(239,68,68,.1);"></div>Absent</div>'
    + '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--tmu);"><div style="width:14px;height:14px;border-radius:4px;background:#e5e7eb;"></div>No class</div>'
    + '</div>';
  calEl.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════════
// DEDICATED ATTENDANCE PAGE
// ══════════════════════════════════════════════════════════════════════
function renderAttendancePage(d) {
  var cont = document.getElementById('attendance-content');
  if (!cont) return;
  if (!d) {
    cont.innerHTML = '<div class="loading-screen"><div class="spinner"></div><div style="font-size:13px;color:var(--tmu);">Loading attendance details…</div></div>';
    return;
  }
  var stu = d.student || {};
  var att = d.attendance || { subjects: [], totalPresent: 0, totalAbsent: 0, totalClasses: 0, overall: 0, minRequired: 75 };
  var minR = att.minRequired || 75;
  var oPct = att.overall || 0;
  var oCls = getClass(oPct, minR);
  var shortage = calcShortage(att.totalPresent, att.totalClasses, minR);

  var html = '';

  // Hero
  html += '<div class="att-hero">'
    + '<div>'
    + '<div class="att-hero-title"><re-icon icon="grid"></re-icon> Attendance Analytics</div>'
    + '<div class="att-hero-sub">' + (stu.name || 'Student') + ' &nbsp;·&nbsp; ' + (stu.regNo || '—') + ' &nbsp;·&nbsp; ' + (stu.deptName || '—') + '</div>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:14px;">'
    + '<div style="text-align:right;"><div style="font-size:10.5px;opacity:.8;text-transform:uppercase;letter-spacing:.5px;">Overall Attendance</div><div style="font-size:32px;font-weight:800;line-height:1.1;">' + oPct + '%</div></div>'
    + '<div class="att-hero-badge">' + (oPct >= minR ? '<re-icon icon="flag"></re-icon>' : '<re-icon icon="alert-triangle"></re-icon>') + '</div>'
    + '</div>'
    + '</div>';

  // Stats Row
  html += '<div class="stats-row" style="margin-bottom:20px;">'
    + '<div class="stat-card"><div class="sc-icon"><re-icon icon="book-open"></re-icon></div><div class="sc-val">' + att.totalClasses + '</div><div class="sc-label">Total Classes</div><div class="sc-sub">Across all enrolled subjects</div></div>'
    + '<div class="stat-card"><div class="sc-icon"><re-icon icon="check-circle"></re-icon></div><div class="sc-val" style="color:var(--gK);">' + att.totalPresent + '</div><div class="sc-label">Present</div><div class="sc-sub">Classes attended</div></div>'
    + '<div class="stat-card"><div class="sc-icon"><re-icon icon="x-circle"></re-icon></div><div class="sc-val" style="color:#ef4444;">' + att.totalAbsent + '</div><div class="sc-label">Absent</div><div class="sc-sub">Classes missed</div></div>'
    + '<div class="stat-card"><div class="sc-icon">' + (shortage > 0 ? '<re-icon icon="alert-triangle"></re-icon>' : '<re-icon icon="confetti"></re-icon>') + '</div><div class="sc-val" style="color:' + (shortage > 0 ? '#dc2626' : 'var(--gK)') + ';">' + (shortage > 0 ? shortage : '—') + '</div><div class="sc-label">' + (shortage > 0 ? 'Classes Needed' : 'Requirement Met') + '</div><div class="sc-sub">Minimum threshold: ' + minR + '%</div></div>'
    + '</div>';

  // Subject Cards Grid
  html += '<div style="font-size:14px;font-weight:700;color:var(--td);margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">'
    + '<span><re-icon icon="book-open"></re-icon> Subject-wise Performance</span>'
    + '<span style="font-size:11px;color:var(--tmu);font-weight:500;">' + (att.subjects ? att.subjects.length : 0) + ' subjects</span>'
    + '</div>';

  if (!att.subjects || !att.subjects.length) {
    html += '<div class="card" style="margin-bottom:20px;"><div class="empty-state"><span class="ei"><re-icon icon="inbox"></re-icon></span><p>No subjects or attendance data found yet.</p></div></div>';
  } else {
    html += '<div class="att-cards-grid">';
    att.subjects.forEach(function(s, idx) {
      var cls = getClass(s.percentage, minR);
      var subShortage = calcShortage(s.present, s.total, minR);
      var pillCls = cls === 'ok' ? 'ok' : cls === 'warn' ? 'warn' : 'danger';
      html += '<div class="att-card">'
        + '<div class="att-card-hd">'
        + '<div><div class="att-sub-name"><re-icon icon="book-open"></re-icon> ' + (s.subjectName || '—') + '</div><div class="att-teacher-name"><re-icon icon="teacher"></re-icon> ' + (s.teacherName || 'Faculty') + '</div></div>'
        + '<div class="att-pct-pill ' + pillCls + '">' + s.percentage + '%</div>'
        + '</div>'
        + '<div class="prog-wrap prog-' + cls + '" style="margin:10px 0;"><div class="prog-bar"><div class="prog-fill" style="width:' + s.percentage + '%;"></div></div></div>'
        + '<div class="att-stats-mini">'
        + '<span>Attended: <b style="color:var(--gK);">' + s.present + '</b> / ' + s.total + '</span>'
        + '<span style="margin-left:auto;">' + (subShortage > 0 ? '<b style="color:#dc2626;">Need ' + subShortage + ' more</b>' : '<b style="color:var(--gK);">Eligible <re-icon icon="check-circle"></re-icon></b>') + '</span>'
        + '</div>'
        + '</div>';
    });
    html += '</div>';
  }

  // Detailed Table
  html += '<div class="card" style="margin-bottom:20px;">'
    + '<div class="card-hd"><div class="card-title"><re-icon icon="clipboard-list"></re-icon> Subject Attendance Table</div><span style="font-size:11px;color:var(--tdi);">Click a subject row to view session dates</span></div>'
    + '<div style="overflow-x:auto;">'
    + '<table class="tbl"><thead><tr>'
    + '<th>Subject</th><th>Teacher</th><th>Present</th><th>Absent</th><th>Total</th><th style="min-width:140px;">Attendance</th><th>Status</th>'
    + '</tr></thead><tbody id="att-tbl-tbody"></tbody></table></div></div>';

  // Calendar
  html += '<div class="card">'
    + '<div class="card-hd"><div class="card-title"><re-icon icon="calendar"></re-icon> Recent Attendance Log</div></div>'
    + '<div class="card-body">'
    + '<div class="tabs-row" id="att-cal-tabs"></div>'
    + '<div id="att-cal-grid"></div>'
    + '</div></div>';

  cont.innerHTML = html;

  renderSubjectTableInto('att-tbl-tbody', 'att-sub-detail-', att.subjects, minR);
  renderSubjectTabsInto('att-cal-tabs', 'att-cal-grid', att.subjects);
}

// ══════════════════════════════════════════════════════════════════════
// MY PROFILE PAGE
// ══════════════════════════════════════════════════════════════════════
var _profileRendered = false;

function renderProfilePage(d) {
  // Prevent double-rendering with same data (still allow re-render after edits)
  var stu = d.student;
  var usr = d.user;
  var att = d.attendance;

  var cleanName = (stu.name || '').trim();
  var initials = cleanName.split(' ').map(function(w){return w[0];}).join('').slice(0,2).toUpperCase();

  // Split name into parts cleanly
  var firstName  = stu.firstName || '';
  var lastName   = stu.lastName  || '';
  if (!firstName && cleanName) {
    var parts = cleanName.split(/\s+/).filter(Boolean);
    if (parts.length === 1) { firstName = parts[0]; lastName = ''; }
    else if (parts.length === 2) {
      if (/^[A-Za-z]{1,2}$/.test(parts[0]) && !/^[A-Za-z]{1,2}$/.test(parts[1])) {
        firstName = parts[1]; lastName = parts[0];
      } else {
        firstName = parts[0]; lastName = parts[1];
      }
    } else {
      var lastPart = parts[parts.length - 1];
      var secondLastPart = parts[parts.length - 2];
      if (/^[A-Za-z]{1,2}$/.test(lastPart) && /^[A-Za-z]{1,2}$/.test(secondLastPart)) {
        firstName = parts.slice(0, -2).join(' ');
        lastName = parts.slice(-2).join(' ');
      } else if (/^[A-Za-z]{1,2}$/.test(lastPart)) {
        firstName = parts.slice(0, -1).join(' ');
        lastName = lastPart;
      } else if (/^[A-Za-z]{1,2}$/.test(parts[0])) {
        firstName = parts.slice(1).join(' ');
        lastName = parts[0];
      } else {
        firstName = parts.slice(0, -1).join(' ');
        lastName = lastPart;
      }
    }
  }

  var html = '';

  // ── PROFILE HERO
  html += '<div class="prof-hero">'
    + '<div class="prof-hero-av">'+initials+'</div>'
    + '<div class="prof-hero-info">'
    + '<div class="prof-hero-name">'+cleanName+'</div>'
    + '<div class="prof-hero-reg">'+stu.regNo+' &nbsp;·&nbsp; '+(stu.deptName||'—')+'</div>'
    + '<div class="prof-hero-tags">'
    + '<span class="prof-hero-tag"><re-icon icon="chalkboard"></re-icon> '+(stu.className||'—')+'</span>'
    + '<span class="prof-hero-tag"><re-icon icon="calendar"></re-icon> '+(stu.academicYear||'—')+'</span>'
    + '<span class="prof-hero-tag"><re-icon icon="book-open"></re-icon> '+(stu.courseType||'—')+'</span>'
    + (stu.isClassRep?'<span class="prof-hero-tag rep"><re-icon icon="sparkles"></re-icon> Class Representative</span>':'')
    + '</div></div>'
    + '</div>';

  // ── SECTION 1: PROFILE INFO
  html += '<div class="prof-section" id="prof-info-section">'
    + '<div class="prof-section-hd">'
    + '<div class="prof-section-title"><re-icon icon="personalcard"></re-icon> Profile Information</div>'
    + '</div>'
    + '<div class="prof-section-body">'

    // ─ Identity fields
    + '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--tdi);margin-bottom:10px;">Identity</div>'
    + '<div class="fields-grid" style="margin-bottom:18px;">'
    + profFieldReadonly('Full Name', cleanName || '—')
    + profFieldReadonly('First Name', firstName || '—')
    + profFieldReadonly('Last Name', lastName || '—')
    + '</div>'

    // ─ Academic fields
    + '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--tdi);margin-bottom:10px;">Academic Details</div>'
    + '<div class="fields-grid" style="margin-bottom:18px;">'
    + profFieldReadonly('Register No.', stu.regNo || '—')
    + profFieldReadonly('Class', stu.className || '—')
    + profFieldReadonly('Branch', stu.branch || '—')
    + profFieldReadonly('Course', stu.courseType || '—')
    + profFieldReadonly('Department', stu.deptName || '—')
    + profFieldReadonly('Current Year', stu.year || '—')
    + profFieldReadonly('Academic Year', stu.academicYear || '—')
    + '</div>'

    // ─ Contact & Account fields
    + '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--tdi);margin-bottom:10px;">Contact &amp; Account</div>'
    + '<div class="fields-grid" style="margin-bottom:18px;">'
    + profFieldReadonly('Email', stu.email || usr.email || '—')
    + profFieldReadonly('Username', usr.username || '—')
    + profFieldReadonly('Password', '••••••••')
    + '</div>'

    // ─ Status fields
    + '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--tdi);margin-bottom:10px;">Status &amp; Roles</div>'
    + '<div class="fields-grid">'
    + profFieldBadge('Class Representative', stu.isClassRep ? 'Yes' : 'No', stu.isClassRep ? 'fb-yes' : 'fb-no', '<re-icon icon="sparkles"></re-icon>')
    + '</div>'
    + '</div></div>';

  // ── SECTION 2: LOGIN ACTIVITY
  var firstAccess = getFirstAccessTime(usr);
  var firstDays   = daysSince(firstAccess);
  var currentTime = new Date().toISOString();
  var currentSub  = 'Session started: ' + fmtDateTime(sessionStorage.getItem('eams_session_start') || currentTime);

  html += '<div class="prof-section">'
    + '<div class="prof-section-hd">'
    + '<div class="prof-section-title"><re-icon icon="lock"></re-icon> Login Activity</div>'
    + '</div>'
    + '<div class="prof-section-body">'
    + '<div class="activity-header">'
    + '<div class="act-stat"><div class="act-stat-label">First Access to Site</div>'
    + '<div class="act-stat-val">'+fmtDateTime(firstAccess)+'</div>'
    + '<div class="act-stat-sub">('+firstDays+')</div></div>'
    + '<div class="act-stat"><div class="act-stat-label">Current Time</div>'
    + '<div class="act-stat-val">'+fmtDateTime(currentTime)+'</div>'
    + '<div class="act-stat-sub">'+currentSub+'</div></div>'
    + '</div>'
    + '<div class="act-btns">'
    + '<button class="btn-out" onclick="openLoginActivity()" style="font-size:12px;padding:8px 16px;"><re-icon icon="clipboard-list"></re-icon> View Activity</button>'
    + '<button class="btn-warn" onclick="openModal(\'m-unknown\')" style="font-size:12px;padding:8px 16px;"><re-icon icon="alert-triangle"></re-icon> Unknown Login?</button>'
    + '<button class="btn-danger" onclick="logoutAllDevices()" style="font-size:12px;padding:8px 16px;"><span class="status-dot red"></span> Logout from All Devices</button>'
    + '</div>'
    + '</div></div>';

  // ── SECTION 3: SESSION INFO
  var sessionStart = sessionStorage.getItem('eams_session_start') || new Date().toISOString();
  if (!sessionStorage.getItem('eams_session_start')) {
    sessionStorage.setItem('eams_session_start', sessionStart);
  }

  html += '<div class="prof-section">'
    + '<div class="prof-section-hd">'
    + '<div class="prof-section-title"><re-icon icon="radio"></re-icon> Current Session Info</div>'
    + '<span id="session-live-badge" style="display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;padding:3px 10px;border-radius:10px;background:rgba(76,175,80,.12);color:var(--gK);">'
    + '<span class="act-dot"></span> Active</span>'
    + '</div>'
    + '<div class="prof-section-body">'
    + '<div class="session-grid">'
    + '<div class="sess-item"><div class="sess-label">Session Duration</div><div class="sess-val live" id="session-timer">Calculating…</div><div class="sess-sub">Time since login</div></div>'
    + '<div class="sess-item"><div class="sess-label">Session Started</div><div class="sess-val">'+fmtDateTime(sessionStart)+'</div><div class="sess-sub">This session began at this time</div></div>'
    + '<div class="sess-item"><div class="sess-label">Device Type</div><div class="sess-val">'+getDeviceType()+'</div><div class="sess-sub">Browser: '+getBrowserName()+'</div></div>'
    + '<div class="sess-item"><div class="sess-label">Token Expiry</div><div class="sess-val" id="token-expiry">—</div><div class="sess-sub">Automatic session timeout</div></div>'
    + '</div>'
    + '</div></div>';

  // ── SECTION 4: CHANGE PASSWORD
  html += '<div class="prof-section">'
    + '<div class="prof-section-hd">'
    + '<div class="prof-section-title"><re-icon icon="shield-lock"></re-icon> Change Password</div>'
    + '</div>'
    + '<div class="prof-section-body">'
    + '<div id="prof-pw-err" class="err-msg"></div>'
    + '<div class="chpw-grid">'
    + '<div class="fg" style="margin-bottom:0;">'
    + '<label class="fl">Current Password</label>'
    + '<div class="pw-wrap"><input type="password" class="fc2" id="prof-pw-old" placeholder="Current password"><button type="button" class="pw-eye" onclick="togglePw(\'prof-pw-old\',this)"><re-icon icon="eye"></re-icon></button></div>'
    + '</div>'
    + '<div class="fg" style="margin-bottom:0;">'
    + '<label class="fl">New Password</label>'
    + '<div class="pw-wrap"><input type="password" class="fc2" id="prof-pw-new" placeholder="Min. 6 characters" oninput="updateStrength(this.value,\'prof-pw-strength\')"><button type="button" class="pw-eye" onclick="togglePw(\'prof-pw-new\',this)"><re-icon icon="eye"></re-icon></button></div>'
    + '<div class="strength-bar"><div class="strength-fill" id="prof-pw-strength" style="width:0%;"></div></div>'
    + '</div>'
    + '<div class="fg" style="margin-bottom:0;">'
    + '<label class="fl">Confirm New Password</label>'
    + '<div class="pw-wrap"><input type="password" class="fc2" id="prof-pw-confirm" placeholder="Repeat new password"><button type="button" class="pw-eye" onclick="togglePw(\'prof-pw-confirm\',this)"><re-icon icon="eye"></re-icon></button></div>'
    + '</div>'
    + '</div>'
    + '<div style="margin-top:16px;">'
    + '<button class="btn-pri" onclick="doChangePwInline()" style="padding:10px 28px;">Update Password</button>'
    + '</div>'
    + '</div></div>';

  // ── SECTION 5: TRUST & DEVICES (§10)
  var tData = window._studentTrustData || null;
  var tScore = tData ? tData.score : 100;
  var tBand = tData ? (tData.band || 'normal').toUpperCase() : 'NORMAL';
  var tLocked = tData ? tData.isLocked : false;
  var tUntil = tData && tData.lockedUntil ? new Date(tData.lockedUntil).toLocaleDateString() : '';
  var tLockReason = tData ? (tData.lockReason || '') : '';
  var tDev = tData && tData.deviceInfo ? tData.deviceInfo : null;

  var bandBadgeColor = tBand === 'NORMAL' ? '#166534' : (tBand === 'MONITOR' ? '#92400e' : '#991b1b');
  var bandBadgeBg = tBand === 'NORMAL' ? '#dcfce7' : (tBand === 'MONITOR' ? '#fef3c7' : '#fee2e2');

  html += '<div class="prof-section">'
    + '<div class="prof-section-hd">'
    + '<div class="prof-section-title"><re-icon icon="shield"></re-icon> Trust Score &amp; Registered Device</div>'
    + '</div>'
    + '<div class="prof-section-body">'
    + '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:18px;">'
    + '<div style="flex:1;min-width:200px;background:#f8fafc;border:1px solid var(--br);border-radius:12px;padding:14px;">'
    + '<div style="font-size:11.5px;color:var(--tmu);font-weight:600;text-transform:uppercase;">Trust Score</div>'
    + '<div style="font-size:26px;font-weight:800;color:var(--td);margin:4px 0;">' + tScore + ' <span style="font-size:12px;font-weight:700;background:' + bandBadgeBg + ';color:' + bandBadgeColor + ';padding:2px 8px;border-radius:6px;">' + tBand + '</span></div>'
    + '<div style="font-size:11.5px;color:var(--tdi);">' + (tLocked ? ('<span style="color:#ef4444;font-weight:700;">Locked until ' + tUntil + '</span> · ' + escapeHtml(tLockReason)) : 'Self-attendance active') + '</div>'
    + '</div>'
    + '<div style="flex:1;min-width:200px;background:#f8fafc;border:1px solid var(--br);border-radius:12px;padding:14px;">'
    + '<div style="font-size:11.5px;color:var(--tmu);font-weight:600;text-transform:uppercase;">Registered Phone</div>'
    + (tDev ? ('<div style="font-size:14px;font-weight:700;color:var(--td);margin:6px 0;">' + escapeHtml(tDev.model || tDev.os || 'Verified Device') + ' <span style="font-size:11px;color:#16a34a;font-weight:700;">✓ Trusted</span></div><div style="font-size:11px;color:var(--tmu);">' + escapeHtml(tDev.browser || 'Browser') + ' · ' + escapeHtml(tDev.os || '') + '</div><div style="margin-top:8px;"><button class="btn-sm btn-out" style="font-size:11px;padding:3px 10px;" onclick="openReplacementModal()"><re-icon icon="refresh" size="12"></re-icon> Request Replacement</button></div>') : '<div style="font-size:13px;color:#d97706;font-weight:700;margin:6px 0;">⚠ No Phone Registered</div><div style="font-size:11px;color:var(--tmu);">Visit your Class Advisor during a registration window to register your phone.</div><div style="margin-top:8px;"><button class="btn-sm btn-out" style="font-size:11px;padding:3px 10px;" onclick="openReplacementModal()"><re-icon icon="refresh" size="12"></re-icon> Request Device Replacement</button></div>')
    + '</div>'
    + '</div>';

  if (tData && Array.isArray(tData.history) && tData.history.length > 0) {
    html += '<div style="font-size:13px;font-weight:700;color:var(--td);margin-bottom:8px;">Trust Ledger History</div>'
      + '<div style="overflow-x:auto;"><table class="tbl" style="width:100%;font-size:11.5px;"><thead><tr><th>Date</th><th>Type</th><th>Δ Points</th><th>Score</th><th>Reason</th><th>Action</th></tr></thead><tbody>';
    var nowMs = Date.now();
    var sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    tData.history.forEach(function(h) {
      var dColor = h.delta > 0 ? '#16a34a' : (h.delta < 0 ? '#dc2626' : '#64748b');
      var dTxt = h.delta > 0 ? ('+' + h.delta) : h.delta;
      var isNegative = h.delta < 0;
      var isRecent = (nowMs - new Date(h.at).getTime()) <= sevenDaysMs;
      var actionCol = '—';
      if (isNegative && isRecent && !h.type.includes('CORRECTION') && !h.type.includes('UNLOCK')) {
        actionCol = '<button class="btn-sm btn-out" style="color:#0284c7;border-color:#bae6fd;padding:2px 8px;font-size:11px;" onclick="openDisputeModal(\'' + escapeHtml(h.eventId) + '\', \'' + escapeHtml(h.type) + '\', ' + h.delta + ', \'' + escapeHtml(h.reason || '') + '\', \'' + escapeHtml(h.at) + '\')">Dispute</button>';
      }
      html += '<tr>'
        + '<td style="color:#64748b;">' + new Date(h.at).toLocaleDateString() + '</td>'
        + '<td style="font-weight:600;">' + escapeHtml(h.type) + '</td>'
        + '<td style="font-weight:800;color:' + dColor + ';">' + dTxt + '</td>'
        + '<td>' + h.before + ' → <b>' + h.after + '</b></td>'
        + '<td style="color:#475569;">' + escapeHtml(h.reason || '—') + '</td>'
        + '<td>' + actionCol + '</td>'
        + '</tr>';
    });
    html += '</tbody></table></div>';
  }

  html += '</div></div>';

  document.getElementById('profile-content').innerHTML = html;

  // Start session timer
  startSessionTimer(sessionStart);
  // Parse token for expiry
  updateTokenExpiry();
}

// ── Phase T6: Student Trust Dispute Handlers (§12) ────────────────
function openDisputeModal(eventId, eventType, delta, reason, at) {
  var idEl = document.getElementById('dispute-event-id');
  var dateEl = document.getElementById('dispute-event-date');
  var deltaEl = document.getElementById('dispute-event-delta');
  var typeEl = document.getElementById('dispute-event-type');
  var reasonEl = document.getElementById('dispute-event-reason');
  var inputEl = document.getElementById('dispute-student-reason');

  if (idEl) idEl.value = eventId;
  if (dateEl) dateEl.textContent = at ? new Date(at).toLocaleDateString() : '—';
  if (deltaEl) deltaEl.textContent = delta ? delta + ' pts' : '—';
  if (typeEl) typeEl.textContent = eventType || 'Trust Penalty';
  if (reasonEl) reasonEl.textContent = reason ? ('Event reason: ' + reason) : '';
  if (inputEl) inputEl.value = '';

  if (typeof openModal === 'function') openModal('modal-dispute-event');
}

function submitDisputeForm() {
  var eventId = document.getElementById('dispute-event-id') ? document.getElementById('dispute-event-id').value : '';
  var reason = document.getElementById('dispute-student-reason') ? document.getElementById('dispute-student-reason').value.trim() : '';

  if (!eventId) {
    if (typeof showToast === 'function') showToast('Missing event ID for dispute', 'error');
    return;
  }
  if (!reason || reason.length < 10) {
    if (typeof showToast === 'function') showToast('Please enter an explanatory statement of at least 10 characters', 'error');
    return;
  }

  var btn = document.getElementById('btn-submit-dispute');
  if (btn) btn.disabled = true;

  fetch('/api/trust/disputes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (TOKEN || ''),
      'Accept': 'application/json'
    },
    body: JSON.stringify({ eventId: eventId, reason: reason })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        throw new Error(data.error);
      }
      if (typeof showToast === 'function') showToast('Dispute submitted successfully and evidence frozen.', 'success');
      if (typeof closeModal === 'function') closeModal('modal-dispute-event');
      loadStudentTrustProfile();
      if (_currentView === 'profile' && typeof _data !== 'undefined') {
        renderProfilePage(_data);
      }
    })
    .catch(function(err) {
      if (typeof showToast === 'function') showToast(err.message || 'Error submitting dispute', 'error');
    })
    .finally(function() {
      if (btn) btn.disabled = false;
    });
}

// ── Phase T7: Student Device Replacement Request Handlers (§14) ───
function openReplacementModal() {
  var reasonEl = document.getElementById('input-replacement-reason');
  var noteEl = document.getElementById('input-replacement-note');
  if (reasonEl) reasonEl.value = 'new_phone';
  if (noteEl) noteEl.value = '';
  if (typeof openModal === 'function') openModal('modal-replacement-request');
}

function submitDeviceReplacementRequest() {
  var reason = document.getElementById('input-replacement-reason') ? document.getElementById('input-replacement-reason').value : 'new_phone';
  var note = document.getElementById('input-replacement-note') ? document.getElementById('input-replacement-note').value.trim() : '';

  var btn = document.getElementById('btn-submit-replacement');
  if (btn) btn.disabled = true;

  fetch('/api/devices/replacement-requests', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (TOKEN || ''),
      'Accept': 'application/json'
    },
    body: JSON.stringify({ reason: reason, note: note })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (btn) btn.disabled = false;
      if (data.error) {
        throw new Error(data.error);
      }
      if (typeof showToast === 'function') {
        showToast(data.message || 'Replacement request submitted to your Class Advisor.', 'success');
      } else if (typeof showPopup === 'function') {
        showPopup(data.message || 'Replacement request submitted to your Class Advisor.', 'Device Replacement', 'success');
      }
      if (typeof closeModal === 'function') closeModal('modal-replacement-request');
    })
    .catch(function(err) {
      if (btn) btn.disabled = false;
      if (typeof showToast === 'function') {
        showToast(err.message || 'Failed to submit replacement request', 'error');
      } else if (typeof showPopup === 'function') {
        showPopup(err.message || 'Failed to submit replacement request', 'Request Error', 'error');
      }
    });
}

window.openReplacementModal = openReplacementModal;
window.submitDeviceReplacementRequest = submitDeviceReplacementRequest;

// ── Profile field helpers ─────────────────────────────────────────
function profField(label, val, id, editable) {
  return '<div class="field-group">'
    + '<div class="field-label">'+label+'</div>'
    + '<div class="field-val" id="'+id+'-display">'+val+'</div>'
    + (editable?'<input type="text" class="fc2" id="'+id+'-input" value="'+val+'" style="display:none;">':'')
    + '</div>';
}
function profFieldReadonly(label, val) {
  return '<div class="field-group">'
    + '<div class="field-label">'+label+'</div>'
    + '<div class="field-val">'+val+'</div>'
    + '</div>';
}
function profFieldBadge(label, val, cls, icon) {
  return '<div class="field-group">'
    + '<div class="field-label">'+label+'</div>'
    + '<div><span class="field-badge '+cls+'">'+icon+' '+val+'</span></div>'
    + '</div>';
}

// ── Profile edit (Disabled: profile is managed by institution) ─────────
var _editableFields = [];
function toggleProfileEdit(on) {}
function saveProfileEdit() {}
function setFieldDisplay(id, val) {
  var d = document.getElementById(id+'-display');
  if (d) d.textContent = val;
}

// ── Login activity helpers ─────────────────────────────────────────
var _loginActivities = null;

function openLoginActivity() {
  api('/api/auth/login-history').then(function(data) {
    if (data.error) { toast(data.error, 'error'); return; }
    _loginActivities = data.history || [];
    var tbody = document.getElementById('activity-tbody');
    var opts  = document.getElementById('unknown-session-select');
    var rows  = '';
    var selectOpts = '<option value="">Select a session…</option>';
    _loginActivities.slice().reverse().forEach(function(a, idx) {
      var typeCls = a.type==='web'?'lt-web':a.type==='mobile'?'lt-mobile':'lt-unknown';
      var typeLabel = a.type==='web'?'<re-icon icon="globe"></re-icon> Web':a.type==='mobile'?'<re-icon icon="monitor"></re-icon> Mobile':'<re-icon icon="help-circle"></re-icon> Unknown';
      var deviceIcon = a.type==='mobile'?'<re-icon icon="monitor"></re-icon>':'<re-icon icon="laptop"></re-icon>';
      rows += '<tr>'
        + '<td style="white-space:nowrap;font-size:11.5px;color:var(--td);font-weight:500;">'+fmtDateTime(a.time)+'</td>'
        + '<td><span class="device-tag"><span class="device-icon">'+deviceIcon+'</span>'+a.device+'</span></td>'
        + '<td><span class="ip-code">'+a.ip+'</span></td>'
        + '<td><span class="login-type-badge '+typeCls+'">'+typeLabel+'</span></td>'
        + '<td>'+(a.current?'<span class="act-current"><span class="act-dot"></span>Current</span>':'<span style="font-size:11px;color:var(--tdi);">Ended</span>')+'</td>'
        + '</tr>';
      if (!a.current) {
        selectOpts += '<option value="'+idx+'">'+fmtDateTime(a.time)+' — '+a.ip+'</option>';
      }
    });
    tbody.innerHTML = rows;
    if (opts) opts.innerHTML = selectOpts;
    openModal('m-activity');
  }).catch(function(e) { toast('Failed to load login history', 'error'); });
}

function reportUnknownLogin() {
  closeModal('m-activity');
  setTimeout(function() { openModal('m-unknown'); }, 250);
}

function submitUnknownReport() {
  var sel = document.getElementById('unknown-session-select');
  var sessionId = sel ? sel.value : '';
  api('/api/auth/report-unknown', {
    method: 'POST',
    body: JSON.stringify({ sessionId: sessionId || undefined })
  })
  .then(function(d) {
    if (d.error) { toast(d.error, 'error'); return; }
    toast('Account secured. All sessions terminated. Please login again.', 'warn');
    closeModal('m-unknown');
    setTimeout(doLogout, 2000);
  })
  .catch(function(e) { toast(e.message, 'error'); });
}

async function logoutAllDevices() {
  const ok = await showConfirm('This will log you out of all devices including this one. Continue?', 'Logout All Devices', null, null, { danger: true, confirmText: 'Logout All' });
  if (!ok) return;
  api('/api/auth/logout-all', { method:'POST' })
  .then(function(d) {
    if (d.error) { toast(d.error, 'error'); return; }
    toast('Logged out from all devices.');
    setTimeout(doLogout, 2000);
  })
  .catch(function() {
    // fallback: still logout locally
    toast('Logged out from all devices.');
    setTimeout(doLogout, 2000);
  });
}

function getFirstAccessTime(usr) {
  if (usr && usr.firstLogin) return usr.firstLogin;
  if (usr && usr.createdAt) return usr.createdAt;
  if (usr && usr.lastLogin) return usr.lastLogin;
  return new Date().toISOString();
}

function shouldForcePasswordChange(userObj) {
  if (!userObj) return false;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return false;
  return !!(
    userObj.mustChangePassword ||
    userObj.forcePasswordChange ||
    userObj.requirePasswordChange ||
    userObj.isFirstLogin ||
    userObj.firstLoginRequired
  );
}

// ── Session timer ─────────────────────────────────────────────────
var _sessionTimerInterval = null;
function startSessionTimer(startIso) {
  if (_sessionTimerInterval) clearInterval(_sessionTimerInterval);
  function update() {
    var el = document.getElementById('session-timer');
    if (!el) { clearInterval(_sessionTimerInterval); return; }
    var diff = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000);
    var h = Math.floor(diff / 3600);
    var m = Math.floor((diff % 3600) / 60);
    el.textContent = (h > 0 ? h + 'h ' : '') + pad2(m) + 'm';
  }
  update();
  _sessionTimerInterval = setInterval(update, 60000);
}

function updateTokenExpiry() {
  var el = document.getElementById('token-expiry');
  if (!el) return;
  try {
    var payload = JSON.parse(atob(TOKEN.split('.')[1]));
    if (payload.exp) {
      var expDate = new Date(payload.exp * 1000);
      var mins = Math.round((expDate - Date.now()) / 60000);
      if (mins > 0) {
        el.textContent = mins >= 60 ? Math.round(mins/60) + 'h remaining' : mins + ' min remaining';
        el.style.color = mins < 30 ? '#dc2626' : 'var(--gK)';
      } else {
        el.textContent = 'Expired';
        el.style.color = '#dc2626';
      }
    }
  } catch(e) {
    el.textContent = '1h remaining';
    el.style.color = 'var(--gK)';
  }
}

// ── Device/browser utils ─────────────────────────────────────────
function getDeviceType() {
  var ua = navigator.userAgent;
  if (/Mobi|Android/i.test(ua)) return '<re-icon icon="monitor"></re-icon> Mobile';
  if (/Tablet|iPad/i.test(ua)) return '<re-icon icon="monitor"></re-icon> Tablet';
  return '<re-icon icon="laptop"></re-icon> Desktop';
}
function getBrowserName() {
  var ua = navigator.userAgent;
  if (/Edg/.test(ua)) return 'Microsoft Edge';
  if (/Chrome/.test(ua)) return 'Chrome';
  if (/Firefox/.test(ua)) return 'Firefox';
  if (/Safari/.test(ua)) return 'Safari';
  return 'Unknown Browser';
}

// ══ BOOT & DATA FETCH ═════════════════════════════════════════════════
function renderErrorState(msg) {
  var errorHtml = '<div class="loading-screen">'
    + '<span style="font-size:44px;"><re-icon icon="alert-triangle"></re-icon></span>'
    + '<div style="font-size:15px;font-weight:700;color:#dc2626;max-width:420px;text-align:center;">' + (msg || 'Unable to load attendance data') + '</div>'
    + '<div style="display:flex;gap:10px;margin-top:10px;">'
    + '<button class="btn-pri" onclick="loadStudentData()" style="padding:8px 20px;font-size:12px;cursor:pointer;"><re-icon icon="refresh"></re-icon> Retry</button>'
    + '<a href="index.html" class="btn-out" style="padding:8px 20px;font-size:12px;text-decoration:none;display:inline-flex;align-items:center;"><re-icon icon="arrow-left"></re-icon> Back to Login</a>'
    + '</div>'
    + '</div>';
  var m = document.getElementById('main-content'); if (m) m.innerHTML = errorHtml;
  var p = document.getElementById('profile-content'); if (p) p.innerHTML = errorHtml;
  var a = document.getElementById('attendance-content'); if (a) a.innerHTML = errorHtml;
}

function loadStudentData() {
  Promise.all([
    _settingsPromise,
    _yearPromise,
    api('/api/student/me')
  ]).then(function(results) {
    var d = results[2];
    if (!d || d.error) {
      renderErrorState(d ? d.error : 'Failed to load student data');
      return;
    }
    _data = d;
    var isDevStudent = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isDevStudent && d.user && shouldForcePasswordChange(d.user)) {
      sessionStorage.setItem('eams_mustChangePw', '1');
    }
    renderPortal(d);
    if (_currentView === 'profile') renderProfilePage(d);
    if (_currentView === 'attendance') renderAttendancePage(d);
    if (_currentView === 'leave') loadLeaveData();
    if (!isDevStudent && sessionStorage.getItem('eams_mustChangePw') === '1') {
      setTimeout(openChangePw, 600);
    }
    fetchStudentNotifs();
  }).catch(function(e) {
    renderErrorState(e.message);
  });
}

// ══ LEAVE & PERMISSION MANAGEMENT ═════════════════════════════════════
var _leaveCoverage = 'full_day';
var _leaveCategory = 'Leave';

function setLeaveCoverage(cov) {
  _leaveCoverage = cov;
  var tabs = [
    { id: 'tab-leave-full', key: 'full_day' },
    { id: 'tab-leave-fn', key: 'fn' },
    { id: 'tab-leave-an', key: 'an' },
    { id: 'tab-leave-period', key: 'periods' }
  ];

  tabs.forEach(function(t) {
    var btn = document.getElementById(t.id);
    if (!btn) return;
    if (t.key === cov) {
      btn.classList.add('act');
      btn.style.background = 'var(--gD)';
      btn.style.color = '#fff';
    } else {
      btn.classList.remove('act');
      btn.style.background = 'transparent';
      btn.style.color = 'var(--td)';
    }
  });

  var toDateInput = document.getElementById('input-to-date');
  var fromDateInput = document.getElementById('input-from-date');
  var wrapToDate = document.getElementById('wrap-to-date');
  var periodSelect = document.getElementById('group-period-select');
  var datesGrid = document.getElementById('group-leave-dates');

  if (cov === 'full_day') {
    if (datesGrid) datesGrid.style.gridTemplateColumns = '1fr 1fr';
    if (wrapToDate) wrapToDate.style.display = 'block';
    if (toDateInput) {
      toDateInput.required = true;
      if (!toDateInput.value && fromDateInput) toDateInput.value = fromDateInput.value;
    }
    if (periodSelect) periodSelect.style.display = 'none';
  } else if (cov === 'fn' || cov === 'an') {
    if (datesGrid) datesGrid.style.gridTemplateColumns = '1fr';
    if (wrapToDate) wrapToDate.style.display = 'none';
    if (toDateInput && fromDateInput) {
      toDateInput.required = false;
      toDateInput.value = fromDateInput.value;
    }
    if (periodSelect) periodSelect.style.display = 'none';
  } else if (cov === 'periods') {
    if (datesGrid) datesGrid.style.gridTemplateColumns = '1fr';
    if (wrapToDate) wrapToDate.style.display = 'none';
    if (toDateInput && fromDateInput) {
      toDateInput.required = false;
      toDateInput.value = fromDateInput.value;
    }
    if (periodSelect) periodSelect.style.display = 'block';
  }

  calculateLeaveDays();
}

function setLeaveCategory(cat) {
  if (cat === 'Permission') setLeaveCoverage('fn');
  else setLeaveCoverage('full_day');
}

function onLeaveCategoryChange() {
  var catEl = document.getElementById('input-leave-category');
  var cat = catEl ? catEl.value : 'Personal';
  var certSection = document.getElementById('group-cert-section');
  if (certSection) {
    certSection.style.display = cat === 'Medical' ? 'block' : 'none';
  }
}

function toggleCertToFollow(checked) {
  var certInput = document.getElementById('input-cert-link');
  var wrap = document.getElementById('wrap-cert-input');
  if (certInput) {
    certInput.disabled = !!checked;
    if (checked) {
      certInput.value = '';
      if (wrap) wrap.style.opacity = '0.5';
    } else {
      if (wrap) wrap.style.opacity = '1';
    }
  }
}

function onFromDateChange() {
  if (_leaveCoverage !== 'full_day') {
    var fromVal = document.getElementById('input-from-date') ? document.getElementById('input-from-date').value : '';
    var toEl = document.getElementById('input-to-date');
    if (toEl) toEl.value = fromVal;
  }
  calculateLeaveDays();
}

function calculateLeaveDays() {
  var from = document.getElementById('input-from-date') ? document.getElementById('input-from-date').value : '';
  var to = document.getElementById('input-to-date') ? document.getElementById('input-to-date').value : '';
  var calcEl = document.getElementById('leave-days-calc');
  if (!calcEl) return;

  if (_leaveCoverage === 'fn') {
    calcEl.textContent = '0.5 Day (Morning FN)';
    calcEl.style.color = 'var(--gD)';
    return;
  }
  if (_leaveCoverage === 'an') {
    calcEl.textContent = '0.5 Day (Afternoon AN)';
    calcEl.style.color = 'var(--gD)';
    return;
  }
  if (_leaveCoverage === 'periods') {
    var checkedBoxes = Array.from(document.querySelectorAll('input[name="leave-period"]:checked'));
    var count = checkedBoxes.length;
    if (count === 0) {
      calcEl.textContent = '0 Periods selected (Pick at least 1)';
      calcEl.style.color = '#b45309';
    } else {
      var pNames = checkedBoxes.map(function(c) { return 'P' + c.value; }).join(', ');
      calcEl.textContent = count + ' Period' + (count > 1 ? 's' : '') + ' (' + pNames + ')';
      calcEl.style.color = 'var(--gD)';
    }
    return;
  }

  // Full day
  if (!from || !to) {
    calcEl.textContent = '1 Day';
    calcEl.style.color = 'var(--gD)';
    return;
  }
  var d1 = new Date(from);
  var d2 = new Date(to);
  if (d1 > d2) {
    calcEl.textContent = 'Invalid (To Date is before From Date)';
    calcEl.style.color = '#ef4444';
    return;
  }
  var diffTime = Math.abs(d2 - d1);
  var diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  if (diffDays > 3) {
    calcEl.textContent = diffDays + ' Days (Exceeds 3-day student limit)';
    calcEl.style.color = '#dc2626';
  } else {
    calcEl.textContent = diffDays + (diffDays > 1 ? ' Days' : ' Day');
    calcEl.style.color = 'var(--gD)';
  }
}

function loadLeaveData() {
  var today = todayIST();
  var fromInp = document.getElementById('input-from-date');
  var toInp = document.getElementById('input-to-date');
  if (fromInp && !fromInp.value) fromInp.value = today;
  if (toInp && !toInp.value) toInp.value = today;
  calculateLeaveDays();

  // 1. Fetch Advisor info
  api('/api/leave/advisor-info').then(function(d) {
    var nameEl = document.getElementById('leave-adv-name');
    var clsEl = document.getElementById('leave-adv-cls');
    if (nameEl) {
      if (d && d.advisor) {
        nameEl.innerHTML = '<re-icon icon="sparkles"></re-icon> ' + escapeHtml(d.advisor.name || d.advisor.fullName || 'Class Advisor');
        if (clsEl) clsEl.textContent = (d.className || 'Class') + ' — ' + (d.advisor.designation || 'Class Advisor');
      } else {
        nameEl.textContent = 'No Class Advisor assigned';
        if (clsEl) clsEl.textContent = d.className || 'Class';
      }
    }
  }).catch(function() {});

  // 2. Fetch My Leave Requests
  api('/api/student-leave/me').then(function(res) {
    var list = (res && Array.isArray(res.requests)) ? res.requests : (Array.isArray(res) ? res : []);
    renderLeaveStatsAndLists(list);
  }).catch(function() {
    api('/api/leave/my-requests').then(function(res) {
      var list = Array.isArray(res) ? res : ((res && res.requests) || []);
      renderLeaveStatsAndLists(list);
    }).catch(function() {
      var tbody = document.getElementById('tbody-leave-history');
      if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--tdi);">Failed to load history.</td></tr>';
    });
  });
}

function renderLeaveStatsAndLists(list) {
  var approvedLeaves = list.filter(function(r) { return r.status === 'Approved'; });
  var totalApprovedDays = approvedLeaves.reduce(function(acc, r) {
    return acc + (Number(r.daysCount) || (r.category === 'Permission' || r.coverage === 'fn' || r.coverage === 'an' ? 0.5 : 1));
  }, 0);
  var pendingReqs = list.filter(function(r) { return r.status === 'Pending'; });

  var statDaysEl = document.getElementById('leave-stat-approved-days');
  if (statDaysEl) statDaysEl.textContent = totalApprovedDays + (totalApprovedDays === 1 ? ' Day' : ' Days');

  var statPendingEl = document.getElementById('leave-stat-pending-count');
  if (statPendingEl) statPendingEl.textContent = pendingReqs.length;

  var badgePendingEl = document.getElementById('badge-pending-count');
  if (badgePendingEl) badgePendingEl.textContent = pendingReqs.length + ' Active';

  // Render Pending Requests Box
  var pendingCont = document.getElementById('container-pending-requests');
  if (pendingCont) {
    if (!pendingReqs.length) {
      pendingCont.innerHTML = '<div style="padding:28px;text-align:center;color:var(--tdi);font-size:12px;">No pending leave requests.</div>';
    } else {
      pendingCont.innerHTML = pendingReqs.map(function(r) {
        var dateDisplay = r.fromDate === r.toDate ? fmtDate(r.fromDate) : (fmtDate(r.fromDate) + ' – ' + fmtDate(r.toDate));
        var covLabel = r.coverage === 'fn' ? 'Morning (FN)' : r.coverage === 'an' ? 'Afternoon (AN)' : r.coverage === 'periods' ? ('Periods ' + (r.periods || []).map(function(p){ return 'P'+p; }).join(',')) : (r.slot || 'Full Day');
        var catName = r.leaveCategory || r.category || 'Leave';
        var daysText = (r.daysCount || 1) + ' day' + (r.daysCount === 1 ? '' : 's');

        return '<div style="background:#fffbeb;border:1.5px solid #fef3c7;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;">'
          + '<div style="font-weight:700;font-size:13px;color:#92400e;">'
          + '<re-icon icon="tree"></re-icon> ' + escapeHtml(catName)
          + ' <span style="font-size:11px;font-weight:600;color:#b45309;">[' + escapeHtml(covLabel) + ']</span>'
          + '</div>'
          + '<span style="background:#fef3c7;color:#b45309;font-size:10px;font-weight:800;padding:2px 8px;border-radius:8px;border:1px solid #fde68a;">Pending</span>'
          + '</div>'
          + '<div style="font-size:12px;color:var(--td);font-weight:600;"><re-icon icon="calendar"></re-icon> ' + dateDisplay + ' (' + daysText + ') • <span style="font-family:monospace;font-size:11px;color:var(--tmu);">' + escapeHtml(r.requestId || '') + '</span></div>'
          + '<div style="font-size:11.5px;color:var(--tmu);line-height:1.4;"><re-icon icon="message-square"></re-icon> ' + escapeHtml(r.reason || '—') + '</div>'
          + '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;padding-top:6px;border-top:1px dashed #fde68a;">'
          + '<span style="font-size:10.5px;color:var(--tdi);">Applied ' + daysSince(r.createdAt) + '</span>'
          + '<button class="btn-warn bsm" onclick="cancelLeaveRequest(\'' + (r.requestId || r._id) + '\')" style="padding:4px 10px;font-size:11px;">Cancel</button>'
          + '</div>'
          + '</div>';
      }).join('');
    }
  }

  // Render History Table (10 columns matching thead)
  var tbody = document.getElementById('tbody-leave-history');
  if (tbody) {
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--tdi);">No leave applications found.</td></tr>';
    } else {
      tbody.innerHTML = list.map(function(r) {
        var dateDisplay = r.fromDate === r.toDate ? fmtDate(r.fromDate) : (fmtDate(r.fromDate) + ' – ' + fmtDate(r.toDate));
        var covLabel = r.coverage === 'fn' ? 'Morning (FN)' : r.coverage === 'an' ? 'Afternoon (AN)' : r.coverage === 'periods' ? ('Periods: ' + (r.periods || []).map(function(p){ return 'P'+p; }).join(', ')) : (r.slot || 'Full Day');
        var catName = r.leaveCategory || r.category || 'Personal';

        var statusBg = r.status === 'Approved' ? '#dcfce7' : r.status === 'Rejected' ? '#fee2e2' : r.status === 'Cancelled' ? '#f3f4f6' : '#fef3c7';
        var statusColor = r.status === 'Approved' ? '#166534' : r.status === 'Rejected' ? '#991b1b' : r.status === 'Cancelled' ? '#4b5563' : '#92400e';
        var statusBadge = '<span style="background:' + statusBg + ';color:' + statusColor + ';font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:8px;">' + escapeHtml(r.status) + '</span>';
        var canCancel = r.status === 'Pending';

        var certHtml = '—';
        if (r.certificate) {
          if (r.certificate.status === 'uploaded' && (r.certificate.webViewLink || r.certificate.driveFileId)) {
            var href = r.certificate.webViewLink || ('/api/files/' + r.certificate.driveFileId);
            certHtml = '<a href="' + escapeHtml(href) + '" target="_blank" style="color:var(--gD);font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:3px;"><re-icon icon="external-link" size="11"></re-icon> View Doc</a>';
          } else if (r.certificate.status === 'to_follow') {
            certHtml = '<span style="color:#b45309;font-size:10.5px;font-weight:600;"><re-icon icon="clock" size="11"></re-icon> To Follow</span>';
          } else if (r.certificate.status === 'overdue') {
            certHtml = '<span style="color:#dc2626;font-size:10.5px;font-weight:700;"><re-icon icon="alert-circle" size="11"></re-icon> Overdue</span>';
          }
        }

        var remarks = r.advisorRemarks || r.reviewRemarks || (r.reviewedBy ? ('By ' + r.reviewedBy) : '—');

        return '<tr>'
          + '<td style="font-family:monospace;font-weight:700;font-size:11.5px;color:var(--td);">' + escapeHtml(r.requestId || '—') + '</td>'
          + '<td style="font-size:11.5px;color:var(--tdi);">' + fmtDate(r.createdAt) + '</td>'
          + '<td><strong>' + escapeHtml(catName) + '</strong></td>'
          + '<td>' + dateDisplay + '<br><span style="font-size:10.5px;color:var(--tmu);background:var(--gP);padding:1px 6px;border-radius:4px;">' + escapeHtml(covLabel) + '</span></td>'
          + '<td><span style="font-weight:700;">' + (r.daysCount || 1) + '</span></td>'
          + '<td style="max-width:180px;white-space:normal;font-size:11.5px;color:var(--td);">' + escapeHtml(r.reason || '—') + '</td>'
          + '<td>' + certHtml + '</td>'
          + '<td>' + statusBadge + '</td>'
          + '<td style="font-size:11.5px;color:var(--tmu);max-width:140px;white-space:normal;">' + escapeHtml(remarks) + '</td>'
          + '<td>' + (canCancel ? '<button class="btn-out bsm" onclick="cancelLeaveRequest(\'' + (r.requestId || r._id) + '\')" style="padding:3px 8px;font-size:10.5px;color:#dc2626;border-color:#fca5a5;">Cancel</button>' : '—') + '</td>'
          + '</tr>';
      }).join('');
    }
  }
}

async function handleLeaveSubmit(e) {
  e.preventDefault();
  var submitBtn = document.getElementById('btn-submit-leave');
  var origHtml = submitBtn ? submitBtn.innerHTML : '';

  var category = document.getElementById('input-leave-category') ? document.getElementById('input-leave-category').value : 'Personal';
  var fromDate = document.getElementById('input-from-date') ? document.getElementById('input-from-date').value : '';
  var toDate = _leaveCoverage === 'full_day' && document.getElementById('input-to-date') ? document.getElementById('input-to-date').value : fromDate;
  var reason = document.getElementById('input-leave-reason') ? document.getElementById('input-leave-reason').value.trim() : '';

  if (!fromDate) {
    toast('Please select a From Date', 'warning');
    return;
  }
  if (_leaveCoverage === 'full_day' && !toDate) {
    toast('Please select a To Date', 'warning');
    return;
  }
  if (_leaveCoverage === 'full_day' && toDate < fromDate) {
    toast('To Date cannot be before From Date', 'warning');
    return;
  }
  if (!reason) {
    toast('Please provide a reason for your leave request', 'warning');
    return;
  }

  var selectedPeriods = [];
  if (_leaveCoverage === 'periods') {
    selectedPeriods = Array.from(document.querySelectorAll('input[name="leave-period"]:checked')).map(function(el) {
      return Number(el.value);
    });
    if (!selectedPeriods.length) {
      toast('Please select at least one period', 'warning');
      return;
    }
  }

  var certLink = document.getElementById('input-cert-link') ? document.getElementById('input-cert-link').value.trim() : '';
  var certToFollow = document.getElementById('input-cert-to-follow') ? document.getElementById('input-cert-to-follow').checked : false;

  var payload = {
    category: category,
    coverage: _leaveCoverage,
    fromDate: fromDate,
    toDate: toDate,
    periods: selectedPeriods,
    reason: reason,
    certificateLink: certLink,
    certificateToFollow: certToFollow
  };

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span><re-icon icon="hourglass"></re-icon> Submitting…</span>';
  }

  try {
    var res = await api('/api/student-leave', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (res && res.error) {
      toast(res.error, 'error');
      return;
    }

    toast('<re-icon icon="confetti"></re-icon> ' + (res.message || 'Leave request sent to Class Advisor!'), 'success');
    if (document.getElementById('input-leave-reason')) document.getElementById('input-leave-reason').value = '';
    if (document.getElementById('input-cert-link')) document.getElementById('input-cert-link').value = '';
    if (document.getElementById('input-cert-to-follow')) {
      document.getElementById('input-cert-to-follow').checked = false;
      toggleCertToFollow(false);
    }
    document.querySelectorAll('input[name="leave-period"]:checked').forEach(function(cb) { cb.checked = false; });
    setLeaveCoverage('full_day');
    loadLeaveData();
    fetchStudentNotifs();
  } catch (err) {
    toast(err.message || 'Failed to submit request', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origHtml || '<span><re-icon icon="rocket"></re-icon> Submit Leave Request</span>';
    }
  }
}

async function cancelLeaveRequest(id) {
  const ok = await showConfirm('Are you sure you want to cancel this leave request?', 'Cancel Leave Request', null, null, { danger: true, confirmText: 'Cancel Request' });
  if (!ok) return;

  api('/api/student-leave/' + id + '/cancel', {
    method: 'POST',
    body: JSON.stringify({ reason: 'Cancelled by student' })
  })
  .then(function(res) {
    if (res && res.error) {
      // Fallback
      return api('/api/leave/cancel/' + id, { method: 'PUT' });
    }
    return res;
  })
  .then(function(res) {
    if (res && res.error) { toast(res.error, 'error'); return; }
    toast('Leave request cancelled');
    loadLeaveData();
  })
  .catch(function(err) {
    toast(err.message || 'Error cancelling request', 'error');
  });
}

// ══ ON-DUTY (OD) MANAGEMENT (L3 & L4) ═════════════════════════════════
var _odCoverage = 'full_day';
var _odEventsList = [];
var _odMentorsList = [];

function setODCoverage(cov) {
  _odCoverage = cov;
  var tabs = [
    { id: 'tab-od-full', key: 'full_day' },
    { id: 'tab-od-fn', key: 'fn' },
    { id: 'tab-od-an', key: 'an' },
    { id: 'tab-od-periods', key: 'periods' },
    { id: 'tab-od-none', key: 'none' }
  ];

  tabs.forEach(function(t) {
    var btn = document.getElementById(t.id);
    if (!btn) return;
    if (t.key === cov) {
      btn.classList.add('act');
      btn.style.background = 'var(--gD)';
      btn.style.color = '#fff';
    } else {
      btn.classList.remove('act');
      btn.style.background = 'transparent';
      btn.style.color = 'var(--td)';
    }
  });

  var hintNone = document.getElementById('od-none-hint');
  if (hintNone) hintNone.style.display = cov === 'none' ? 'block' : 'none';

  var periodSelect = document.getElementById('group-od-period-select');
  if (periodSelect) periodSelect.style.display = cov === 'periods' ? 'block' : 'none';

  var toDateInput = document.getElementById('input-od-to-date');
  var fromDateInput = document.getElementById('input-od-from-date');
  var wrapToDate = document.getElementById('wrap-od-to-date');
  var datesGrid = document.getElementById('group-od-dates');

  if (cov === 'fn' || cov === 'an') {
    if (datesGrid) datesGrid.style.gridTemplateColumns = '1fr';
    if (wrapToDate) wrapToDate.style.display = 'none';
    if (toDateInput && fromDateInput) {
      toDateInput.required = false;
      toDateInput.value = fromDateInput.value;
    }
  } else {
    if (datesGrid) datesGrid.style.gridTemplateColumns = '1fr 1fr';
    if (wrapToDate) wrapToDate.style.display = 'block';
    if (toDateInput) {
      toDateInput.required = true;
      if (!toDateInput.value && fromDateInput) toDateInput.value = fromDateInput.value;
    }
  }

  calculateODDays();
}

function onODFromDateChange() {
  if (_odCoverage === 'fn' || _odCoverage === 'an') {
    var fromVal = document.getElementById('input-od-from-date') ? document.getElementById('input-od-from-date').value : '';
    var toEl = document.getElementById('input-od-to-date');
    if (toEl) toEl.value = fromVal;
  }
  calculateODDays();
}

var OD_SUBTYPES = {
  Academic: [
    'Symposium / Conference',
    'Paper / Project Presentation',
    'Hackathon / Coding Contest',
    'Workshop / Hands-on Training',
    'Seminar / Guest Lecture',
    'Technical Competition / Quiz',
    'Industrial Visit / Field Study',
    'Research / Internship Work',
    'Other Academic Event'
  ],
  Sports: [
    'Inter-College Tournament',
    'Zonal / University Meet',
    'State / National Level Championship',
    'Athletics / Track & Field',
    'Indoor Sports (Badminton, TT, Chess, etc.)',
    'Outdoor Sports (Cricket, Football, Volleyball, etc.)',
    'Practice / Coaching Camp',
    'Other Sports Event'
  ],
  Cultural: [
    'Cultural Fest / Culturals',
    'Dance (Solo / Group)',
    'Music / Singing / Band',
    'Drama / Skit / Mime',
    'Fine Arts / Painting / Photography',
    'Debate / Elocution / Literary',
    'Other Cultural Event'
  ],
  Institutional: [
    'College Function / Official Duty',
    'NSS / NCC / YRC Activity',
    'Placement / Campus Drive',
    'Student Council / Club Activity',
    'Admission / Accreditation Duty',
    'Other Institutional Duty'
  ]
};

function onODTypeChange() {
  var typeEl = document.getElementById('input-od-type');
  var val = typeEl ? typeEl.value : 'Academic';
  var opts = OD_SUBTYPES[val] || OD_SUBTYPES.Academic;
  var subSelect = document.getElementById('input-od-subtype');
  if (subSelect) {
    var prevVal = subSelect.value;
    subSelect.innerHTML = opts.map(function(s) {
      return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>';
    }).join('');
    if (opts.includes(prevVal)) {
      subSelect.value = prevVal;
    }
  }
}

function onODLevelChange() {
  var lvlEl = document.getElementById('input-od-level');
  var lvl = lvlEl ? lvlEl.value.toLowerCase() : 'department';
  var wrap = document.getElementById('wrap-host-college');
  var hostCollege = document.getElementById('input-od-host-college');
  var hostCity = document.getElementById('input-od-host-city');

  var requiresHost = ['inter-collegiate', 'university', 'state', 'national', 'international'].includes(lvl);
  if (wrap) wrap.style.display = requiresHost ? 'block' : 'none';
  if (hostCollege) hostCollege.required = requiresHost;
  if (hostCity) hostCity.required = requiresHost;
}

function onODEventSelectChange() {
  var sel = document.getElementById('input-od-event-select');
  if (!sel) return;
  var evId = sel.value;
  var titleInp = document.getElementById('input-od-event-title');

  if (!evId) {
    if (titleInp) {
      titleInp.value = '';
      titleInp.readOnly = false;
    }
    return;
  }

  var ev = _odEventsList.find(function(e) { return String(e._id) === String(evId) || e.eventId === evId; });
  if (ev) {
    if (titleInp) {
      titleInp.value = ev.name || '';
      titleInp.readOnly = true;
    }
    var typeEl = document.getElementById('input-od-type');
    if (typeEl && ev.type) {
      typeEl.value = ev.type;
      onODTypeChange();
    }
    var subEl = document.getElementById('input-od-subtype');
    if (subEl && ev.subType) subEl.value = ev.subType;

    var lvlEl = document.getElementById('input-od-level');
    if (lvlEl && ev.level) {
      lvlEl.value = ev.level.toLowerCase();
      onODLevelChange();
    }

    if (ev.hostCollege && document.getElementById('input-od-host-college')) {
      document.getElementById('input-od-host-college').value = ev.hostCollege;
    }
    if (ev.city && document.getElementById('input-od-host-city')) {
      document.getElementById('input-od-host-city').value = ev.city;
    }
    if (ev.startDate && document.getElementById('input-od-from-date')) {
      document.getElementById('input-od-from-date').value = ev.startDate;
    }
    if (ev.endDate && document.getElementById('input-od-to-date')) {
      document.getElementById('input-od-to-date').value = ev.endDate;
    }
    calculateODDays();
  }
}

function calculateODDays() {
  var calcEl = document.getElementById('od-days-calc');
  if (!calcEl) return;

  if (_odCoverage === 'none') {
    calcEl.textContent = '0 Days (No-OD Participation Log)';
    calcEl.style.color = '#0284c7';
    return;
  }
  if (_odCoverage === 'fn') {
    calcEl.textContent = '0.5 Day (Morning FN)';
    calcEl.style.color = 'var(--gD)';
    return;
  }
  if (_odCoverage === 'an') {
    calcEl.textContent = '0.5 Day (Afternoon AN)';
    calcEl.style.color = 'var(--gD)';
    return;
  }
  if (_odCoverage === 'periods') {
    var checked = Array.from(document.querySelectorAll('input[name="od-period"]:checked')).map(function(el) { return 'P' + el.value; });
    if (!checked.length) {
      calcEl.textContent = '0 Periods selected (Pick at least 1)';
      calcEl.style.color = '#b45309';
    } else {
      calcEl.textContent = checked.length + ' Period' + (checked.length > 1 ? 's' : '') + ' (' + checked.join(', ') + ')';
      calcEl.style.color = 'var(--gD)';
    }
    return;
  }

  var from = document.getElementById('input-od-from-date') ? document.getElementById('input-od-from-date').value : '';
  var to = document.getElementById('input-od-to-date') ? document.getElementById('input-od-to-date').value : '';
  if (!from || !to) {
    calcEl.textContent = '1 Day';
    calcEl.style.color = 'var(--gD)';
    return;
  }

  var d1 = new Date(from);
  var d2 = new Date(to);
  if (d1 > d2) {
    calcEl.textContent = 'Invalid (To Date is before From Date)';
    calcEl.style.color = '#ef4444';
    return;
  }
  var diffTime = Math.abs(d2 - d1);
  var diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  calcEl.textContent = diffDays + (diffDays > 1 ? ' Days' : ' Day');
  calcEl.style.color = 'var(--gD)';
}

async function handleODSubmit(e) {
  e.preventDefault();
  var submitBtn = document.getElementById('btn-submit-od');
  var origHtml = submitBtn ? submitBtn.innerHTML : '';

  var eventName = document.getElementById('input-od-event-title') ? document.getElementById('input-od-event-title').value.trim() : '';
  var category = document.getElementById('input-od-type') ? document.getElementById('input-od-type').value : 'Academic';
  var subType = document.getElementById('input-od-subtype') ? document.getElementById('input-od-subtype').value : 'Hackathon';
  var level = document.getElementById('input-od-level') ? document.getElementById('input-od-level').value : 'department';
  var eventId = document.getElementById('input-od-event-select') ? document.getElementById('input-od-event-select').value : '';
  var hostCollege = document.getElementById('input-od-host-college') ? document.getElementById('input-od-host-college').value.trim() : '';
  var city = document.getElementById('input-od-host-city') ? document.getElementById('input-od-host-city').value.trim() : '';
  var fromDate = document.getElementById('input-od-from-date') ? document.getElementById('input-od-from-date').value : '';
  var toDate = (_odCoverage === 'fn' || _odCoverage === 'an') ? fromDate : (document.getElementById('input-od-to-date') ? document.getElementById('input-od-to-date').value : fromDate);
  var mentorTrackId = document.getElementById('input-od-mentor') ? document.getElementById('input-od-mentor').value : '';
  var evidenceLink = document.getElementById('input-od-evidence-link') ? document.getElementById('input-od-evidence-link').value.trim() : '';
  var reason = document.getElementById('input-od-reason') ? document.getElementById('input-od-reason').value.trim() : '';

  if (!eventName) {
    toast('Please enter the Event Title', 'warning');
    return;
  }
  if (!fromDate) {
    toast('Please select a From Date', 'warning');
    return;
  }
  if (_odCoverage !== 'fn' && _odCoverage !== 'an' && !toDate) {
    toast('Please select a To Date', 'warning');
    return;
  }
  if (_odCoverage !== 'fn' && _odCoverage !== 'an' && toDate < fromDate) {
    toast('To Date cannot be before From Date', 'warning');
    return;
  }
  var requiresHost = ['inter-collegiate', 'university', 'state', 'national', 'international'].includes(level.toLowerCase());
  if (requiresHost && (!hostCollege || !city)) {
    toast('Host College and City are required for Inter-Collegiate/Higher Level events', 'warning');
    return;
  }
  if (!mentorTrackId) {
    toast('Please select a Faculty Mentor', 'warning');
    return;
  }
  if (!reason) {
    toast('Please describe your role or purpose for On-Duty participation', 'warning');
    return;
  }

  var selectedPeriods = [];
  if (_odCoverage === 'periods') {
    selectedPeriods = Array.from(document.querySelectorAll('input[name="od-period"]:checked')).map(function(el) { return Number(el.value); });
    if (!selectedPeriods.length) {
      toast('Please select at least one period', 'warning');
      return;
    }
  }

  var evidenceArr = [];
  if (evidenceLink) {
    evidenceArr.push({
      type: 'invitation',
      webViewLink: evidenceLink,
      uploadedAt: new Date().toISOString()
    });
  }

  var payload = {
    eventId: eventId || null,
    eventName: eventName,
    organizer: hostCollege || 'Institution / Department',
    type: category,
    subType: subType,
    level: level,
    mode: 'Offline',
    hostCollege: hostCollege,
    city: city,
    venue: city || hostCollege,
    startDate: fromDate,
    endDate: toDate,
    description: reason,
    mentorTrackId: mentorTrackId,
    coverage: _odCoverage,
    periods: selectedPeriods,
    evidence: evidenceArr
  };

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span><re-icon icon="hourglass"></re-icon> Submitting…</span>';
  }

  try {
    var res = await api('/api/od', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (res && res.error) {
      toast(res.error, 'error');
      return;
    }

    toast('<re-icon icon="confetti"></re-icon> ' + (res.message || 'OD request submitted to Class Advisor!'), 'success');
    if (document.getElementById('input-od-event-title')) {
      document.getElementById('input-od-event-title').value = '';
      document.getElementById('input-od-event-title').readOnly = false;
    }
    if (document.getElementById('input-od-host-college')) document.getElementById('input-od-host-college').value = '';
    if (document.getElementById('input-od-host-city')) document.getElementById('input-od-host-city').value = '';
    if (document.getElementById('input-od-evidence-link')) document.getElementById('input-od-evidence-link').value = '';
    if (document.getElementById('input-od-reason')) document.getElementById('input-od-reason').value = '';
    if (document.getElementById('input-od-event-select')) document.getElementById('input-od-event-select').value = '';
    document.querySelectorAll('input[name="od-period"]:checked').forEach(function(cb) { cb.checked = false; });
    setODCoverage('full_day');
    loadODData();
    fetchStudentNotifs();
  } catch (err) {
    toast(err.message || 'Failed to submit OD application', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origHtml || '<span><re-icon icon="rocket"></re-icon> Submit OD Application</span>';
    }
  }
}

async function cancelODRequest(id) {
  const ok = await showConfirm('Are you sure you want to cancel this On-Duty request?', 'Cancel OD Request', null, null, { danger: true, confirmText: 'Cancel Request' });
  if (!ok) return;

  api('/api/od/' + id + '/cancel', {
    method: 'POST',
    body: JSON.stringify({ reason: 'Cancelled by student' })
  })
  .then(function(res) {
    if (res && res.error) { toast(res.error, 'error'); return; }
    toast('OD request cancelled');
    loadODData();
  })
  .catch(function(err) {
    toast(err.message || 'Error cancelling request', 'error');
  });
}

function loadODData() {
  var today = todayIST();
  var fromInp = document.getElementById('input-od-from-date');
  var toInp = document.getElementById('input-od-to-date');
  if (fromInp && !fromInp.value) fromInp.value = today;
  if (toInp && !toInp.value) toInp.value = today;
  onODTypeChange();
  onODLevelChange();
  calculateODDays();

  // 1. Fetch Faculty Mentors
  api('/api/od/mentors').then(function(res) {
    var list = (res && Array.isArray(res.teachers)) ? res.teachers : [];
    _odMentorsList = list;
    var mentorSel = document.getElementById('input-od-mentor');
    if (mentorSel) {
      var currentVal = mentorSel.value;
      mentorSel.innerHTML = '<option value="">Select Mentor Teacher…</option>' + list.map(function(t) {
        var deptInfo = t.deptName || t.deptCode || t.department || 'Faculty';
        return '<option value="' + escapeHtml(t.trackId) + '">' + escapeHtml(t.fullName || t.name) + ' (' + escapeHtml(deptInfo) + ')</option>';
      }).join('');
      if (currentVal) mentorSel.value = currentVal;
    }
  }).catch(function() {});

  // 2. Fetch Events Registry
  api('/api/od/events').then(function(res) {
    var events = (res && Array.isArray(res.events)) ? res.events : [];
    _odEventsList = events;
    var evSel = document.getElementById('input-od-event-select');
    if (evSel) {
      evSel.innerHTML = '<option value="">+ Enter New Event Details</option>' + events.map(function(e) {
        return '<option value="' + escapeHtml(e.eventId || e._id) + '">' + escapeHtml(e.name) + ' (' + escapeHtml(e.level || 'Event') + ')</option>';
      }).join('');
    }
  }).catch(function() {});

  // 3. Fetch Student's OD Requests
  api('/api/od/me').then(function(res) {
    var list = (res && Array.isArray(res.requests)) ? res.requests : (Array.isArray(res) ? res : []);
    renderODStatsAndLists(list);
  }).catch(function() {
    var tbody = document.getElementById('tbody-od-history');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">Failed to load OD history.</td></tr>';
  });

  // 4. Fetch Participation Profile Summary
  api('/api/participation/me').then(function(res) {
    if (res && res.summary) {
      var s = res.summary;
      var elTotal = document.getElementById('st-part-total');
      var elCerts = document.getElementById('st-part-certs');
      var elVer = document.getElementById('st-part-verified');
      var elScore = document.getElementById('st-part-record-score');
      if (elTotal) elTotal.textContent = s.total || 0;
      if (elCerts) elCerts.textContent = s.certificates || 0;
      if (elVer) elVer.textContent = s.verified || 0;
      if (elScore) {
        var recScore = (s.participationRecord && typeof s.participationRecord === 'object') ? s.participationRecord.score : s.participationRecord;
        elScore.textContent = (recScore !== undefined && recScore !== null ? recScore : '—') + ' / 100';
      }
    }
    var attPctEl = document.getElementById('st-part-attendance-pct');
    if (attPctEl && _data && _data.attendance) {
      attPctEl.textContent = (_data.attendance.overallPercentage || 100) + ' %';
    }
  }).catch(function() {});
}

function renderODStatsAndLists(list) {
  var approvedODs = list.filter(function(r) { return r.status === 'approved'; });
  var totalApprovedDays = approvedODs.reduce(function(acc, r) {
    return acc + (Number(r.daysCount) || (r.coverage === 'fn' || r.coverage === 'an' ? 0.5 : 1));
  }, 0);
  var pendingReqs = list.filter(function(r) { return r.status === 'pending'; });
  var awaitingOutcome = approvedODs.filter(function(r) {
    return !r.outcome || !r.outcome.submittedAt;
  });

  var statApprovedEl = document.getElementById('od-stat-approved-days');
  if (statApprovedEl) statApprovedEl.textContent = totalApprovedDays + (totalApprovedDays === 1 ? ' Day' : ' Days');

  var statPendingEl = document.getElementById('od-stat-pending-count');
  if (statPendingEl) statPendingEl.textContent = pendingReqs.length;

  var statOutcomeEl = document.getElementById('od-stat-awaiting-outcome');
  if (statOutcomeEl) statOutcomeEl.textContent = awaitingOutcome.length;

  var badgePendingEl = document.getElementById('badge-od-pending-count');
  if (badgePendingEl) badgePendingEl.textContent = pendingReqs.length + ' Active';

  var navBadge = document.getElementById('st-od-badge');
  if (navBadge) {
    navBadge.textContent = pendingReqs.length;
    navBadge.style.display = pendingReqs.length > 0 ? 'inline-block' : 'none';
  }

  // Render Active Workflows (Right Card)
  var activeCont = document.getElementById('container-active-od-requests');
  if (activeCont) {
    if (!pendingReqs.length) {
      activeCont.innerHTML = '<div style="padding:28px;text-align:center;color:var(--tdi);font-size:12px;">No active OD applications.</div>';
    } else {
      activeCont.innerHTML = pendingReqs.map(function(r) {
        var evName = (r.eventDetails && r.eventDetails.name) || 'Academic Event';
        var datesStr = r.dates && r.dates.length > 1 ? (fmtDate(r.dates[0]) + ' – ' + fmtDate(r.dates[r.dates.length - 1])) : (fmtDate(r.dates ? r.dates[0] : r.createdAt));
        var stageText = r.currentStage ? ('Stage: ' + r.currentStage.toUpperCase()) : 'Awaiting Approval';

        return '<div style="background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;">'
          + '<div style="font-weight:700;font-size:13px;color:#0369a1;">'
          + '<re-icon icon="trophy"></re-icon> ' + escapeHtml(evName)
          + '</div>'
          + '<span style="background:#e0f2fe;color:#0369a1;font-size:10px;font-weight:800;padding:2px 8px;border-radius:8px;">' + escapeHtml(stageText) + '</span>'
          + '</div>'
          + '<div style="font-size:12px;color:var(--td);font-weight:600;"><re-icon icon="calendar"></re-icon> ' + datesStr + ' • <span style="font-family:monospace;font-size:11px;color:var(--tmu);">' + escapeHtml(r.requestId || '') + '</span></div>'
          + '<div style="font-size:11.5px;color:var(--tmu);line-height:1.4;"><re-icon icon="user"></re-icon> Mentor: ' + escapeHtml(r.mentorName || 'Faculty') + '</div>'
          + '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;padding-top:6px;border-top:1px dashed #bae6fd;">'
          + '<span style="font-size:10.5px;color:var(--tdi);">Applied ' + daysSince(r.createdAt) + '</span>'
          + '<button class="btn-warn bsm" onclick="cancelODRequest(\'' + (r.requestId || r._id) + '\')" style="padding:4px 10px;font-size:11px;">Cancel</button>'
          + '</div>'
          + '</div>';
      }).join('');
    }
  }

  // Render OD History Table (8 columns matching thead)
  var tbody = document.getElementById('tbody-od-history');
  if (tbody) {
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">No On-Duty applications found.</td></tr>';
    } else {
      tbody.innerHTML = list.map(function(r) {
        var evName = (r.eventDetails && r.eventDetails.name) || 'Event';
        var evCategory = (r.eventDetails && r.eventDetails.type) || 'Academic';
        var datesStr = r.dates && r.dates.length > 1 ? (fmtDate(r.dates[0]) + ' – ' + fmtDate(r.dates[r.dates.length - 1])) : (fmtDate(r.dates ? r.dates[0] : r.createdAt));
        var covLabel = r.coverage === 'fn' ? 'FN' : r.coverage === 'an' ? 'AN' : r.coverage === 'periods' ? ('Periods: ' + (r.periods || []).map(function(p){ return 'P'+p; }).join(',')) : (r.coverage === 'none' ? 'No-OD (Log)' : 'Full Day');

        var statusBg = r.status === 'approved' ? '#dcfce7' : r.status === 'rejected' ? '#fee2e2' : r.status === 'cancelled' ? '#f3f4f6' : '#fef3c7';
        var statusColor = r.status === 'approved' ? '#166534' : r.status === 'rejected' ? '#991b1b' : r.status === 'cancelled' ? '#4b5563' : '#92400e';
        var statusBadge = '<span style="background:' + statusBg + ';color:' + statusColor + ';font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:8px;">' + escapeHtml(r.status.toUpperCase()) + '</span>';

        var outcomeStatus = '—';
        if (r.status === 'approved') {
          if (r.outcome && r.outcome.submittedAt) {
            var certLink = (r.outcome.evidence && r.outcome.evidence.webViewLink) ? (' <a href="' + escapeHtml(r.outcome.evidence.webViewLink) + '" target="_blank" style="color:var(--gD);margin-left:4px;" title="View Submitted Certificate"><re-icon icon="external-link" size="11"></re-icon></a>') : '';
            outcomeStatus = '<span style="color:#166534;font-size:11px;font-weight:700;"><re-icon icon="check-circle" size="12"></re-icon> Submitted (' + escapeHtml(r.outcome.primaryOutcome || 'Done') + ')' + certLink + '</span>';
          } else {
            outcomeStatus = '<span style="color:#b45309;font-size:10.5px;font-weight:600;"><re-icon icon="hourglass" size="12"></re-icon> Awaiting Evidence</span>';
          }
        }

        var actionsHtml = '—';
        if (r.status === 'pending') {
          actionsHtml = '<button class="btn-out bsm" onclick="cancelODRequest(\'' + (r.requestId || r._id) + '\')" style="padding:3px 8px;font-size:10.5px;color:#dc2626;border-color:#fca5a5;">Cancel</button>';
        } else if (r.status === 'approved' && (!r.outcome || !r.outcome.submittedAt)) {
          actionsHtml = '<button class="btn-pri bsm" onclick="openODOutcomeModal(\'' + (r.requestId || r._id) + '\', \'' + escapeHtml((r.eventDetails && r.eventDetails.name) || 'Event').replace(/'/g, "\\'") + '\')" style="padding:3px 8px;font-size:10.5px;background:#16a34a;"><re-icon icon="trophy" size="11"></re-icon> Submit Outcome</button>';
        }

        return '<tr>'
          + '<td style="font-family:monospace;font-weight:700;font-size:11.5px;color:var(--td);">' + escapeHtml(r.requestId || '—') + '</td>'
          + '<td style="font-size:11.5px;color:var(--tdi);">' + fmtDate(r.createdAt) + '</td>'
          + '<td><strong>' + escapeHtml(evName) + '</strong><br><span style="font-size:10.5px;color:var(--tmu);">' + escapeHtml(evCategory) + '</span></td>'
          + '<td>' + datesStr + '<br><span style="font-size:10px;color:var(--tmu);background:var(--gP);padding:1px 5px;border-radius:4px;">' + escapeHtml(covLabel) + '</span></td>'
          + '<td style="font-size:11.5px;">' + escapeHtml(r.mentorName || '—') + '</td>'
          + '<td>' + statusBadge + '</td>'
          + '<td>' + outcomeStatus + '</td>'
          + '<td>' + actionsHtml + '</td>'
          + '</tr>';
      }).join('');
    }
  }
}

var _currentOutcomeReqId = null;

function openODOutcomeModal(requestId, eventTitle) {
  _currentOutcomeReqId = requestId;
  var reqIdEl = document.getElementById('modal-od-req-id');
  var titleEl = document.getElementById('modal-od-event-title');
  var summaryInp = document.getElementById('input-od-outcome-summary');
  var certCountInp = document.getElementById('input-od-outcome-cert-count');
  var evidenceInp = document.getElementById('input-od-outcome-evidence');

  if (reqIdEl) reqIdEl.textContent = requestId;
  if (titleEl) titleEl.textContent = eventTitle || 'Event';
  if (summaryInp) summaryInp.value = '';
  if (certCountInp) certCountInp.value = '1';
  if (evidenceInp) evidenceInp.value = '';

  if (typeof openModal === 'function') {
    openModal('modal-od-outcome');
  } else {
    var m = document.getElementById('modal-od-outcome');
    if (m) m.classList.add('act');
  }
}

async function submitODOutcome() {
  if (!_currentOutcomeReqId) return;
  var summaryInp = document.getElementById('input-od-outcome-summary');
  var evidenceInp = document.getElementById('input-od-outcome-evidence');
  var btn = document.getElementById('btn-submit-od-outcome');
  var origHtml = btn ? btn.innerHTML : '';

  var summary = summaryInp ? summaryInp.value.trim() : '';
  var evidence = evidenceInp ? evidenceInp.value.trim() : '';

  if (!summary) {
    toast('Please enter outcome summary or achievements', 'warning');
    return;
  }
  if (!evidence) {
    toast('Please provide certificate drive ID or evidence link', 'warning');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span><re-icon icon="hourglass"></re-icon> Submitting…</span>';
  }

  try {
    var res = await api('/api/od/' + _currentOutcomeReqId + '/outcome', {
      method: 'POST',
      body: JSON.stringify({
        primaryOutcome: summary,
        webViewLink: evidence,
        fileName: 'Outcome Evidence'
      })
    });

    if (res && res.error) {
      toast(res.error, 'error');
      return;
    }

    toast('Outcome and certificate submitted successfully!', 'success');
    if (typeof closeModal === 'function') {
      closeModal('modal-od-outcome');
    } else {
      var m = document.getElementById('modal-od-outcome');
      if (m) m.classList.remove('act');
    }
    loadODData();
  } catch (err) {
    toast(err.message || 'Failed to submit outcome', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

// Global Window Bindings for OD Controls
window.onODTypeChange = onODTypeChange;
window.onODLevelChange = onODLevelChange;
window.onODEventSelectChange = onODEventSelectChange;
window.onODFromDateChange = onODFromDateChange;
window.setODCoverage = setODCoverage;
window.calculateODDays = calculateODDays;
window.handleODSubmit = handleODSubmit;
window.cancelODRequest = cancelODRequest;
window.loadODData = loadODData;
window.openODOutcomeModal = openODOutcomeModal;
window.submitODOutcome = submitODOutcome;

// Initialize OD Subtype options immediately
try {
  onODTypeChange();
  onODLevelChange();
} catch (e) {}

// ══ STUDENT NOTIFICATIONS ═════════════════════════════════════════════
var _studentNotifs = [];

function fetchStudentNotifs() {
  api('/api/notifications', {}, true).then(function(data) {
    _studentNotifs = Array.isArray(data) ? data : [];
    var unread = _studentNotifs.filter(function(n) { return !n.read; }).length;
    var badgeEl = document.getElementById('st-nbadge');
    if (badgeEl) {
      badgeEl.textContent = unread;
      badgeEl.style.display = unread > 0 ? 'inline-block' : 'none';
    }
    renderStudentNotifsList();
  }).catch(function() {});
}

function renderStudentNotifsList() {
  var listEl = document.getElementById('st-ndlist');
  if (!listEl) return;
  if (!_studentNotifs.length) {
    listEl.innerHTML = '<div style="padding:22px;text-align:center;color:var(--tdi);font-size:12px;">No notifications.</div>';
    return;
  }
  listEl.innerHTML = _studentNotifs.slice(0, 15).map(function(n) {
    var isApproval = n.type === 'leave-approval';
    var isRejection = n.type === 'leave-rejection';
    var icon = isApproval ? '<re-icon icon="check-circle"></re-icon>' : isRejection ? '<re-icon icon="x-circle"></re-icon>' : '<re-icon icon="bell"></re-icon>';
    var bg = isApproval ? 'rgba(34,197,94,0.08)' : isRejection ? 'rgba(239,68,68,0.08)' : 'var(--gP)';
    var border = isApproval ? '#86efac' : isRejection ? '#fca5a5' : 'var(--brl)';
    var isRead = Boolean(n.read || n.status === 'Read');
    var statusBadge = isRead
      ? '<span style="background:#f0fdf4;color:#15803d;font-size:9px;font-weight:700;padding:1px 6px;border-radius:6px;margin-left:auto;display:inline-flex;align-items:center;gap:3px;"><re-icon icon="check-check"></re-icon> Read</span>'
      : '<span style="background:rgba(59,130,246,.1);color:#1d4ed8;font-size:9px;font-weight:700;padding:1px 6px;border-radius:6px;margin-left:auto;display:inline-flex;align-items:center;gap:3px;"><re-icon icon="check"></re-icon> Delivered</span>';

    return '<div onclick="markStudentNotifRead(\'' + n._id + '\')" style="padding:10px 14px;border-bottom:1px solid var(--brl);display:flex;gap:10px;align-items:flex-start;background:' + (isRead ? '#fff' : bg) + ';border-left:3px solid ' + border + ';cursor:pointer;" title="' + (!isRead ? 'Click to mark as read' : '') + '">'
      + '<div style="font-size:16px;">' + icon + '</div>'
      + '<div style="flex:1;">'
      + '<div style="font-size:11.5px;font-weight:700;color:var(--td);display:flex;align-items:center;">' + escapeHtml(n.from) + statusBadge + '</div>'
      + '<div style="font-size:11px;color:var(--tmu);margin-top:2px;line-height:1.4;">' + escapeHtml(n.message) + '</div>'
      + '<div style="font-size:10px;color:var(--tdi);margin-top:3px;">' + daysSince(n.time || n.createdAt) + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

function markStudentNotifRead(id) {
  var notif = _studentNotifs.find(function(n) { return n._id === id; });
  if (notif && !notif.read) {
    notif.read = true;
    notif.status = 'Read';
    var unread = _studentNotifs.filter(function(n) { return !n.read; }).length;
    var badgeEl = document.getElementById('st-nbadge');
    if (badgeEl) {
      badgeEl.textContent = unread;
      badgeEl.style.display = unread > 0 ? 'inline-block' : 'none';
    }
    renderStudentNotifsList();
    api('/api/notifications/' + id, { method: 'PUT', body: JSON.stringify({ read: true, status: 'Read' }) }, true).catch(function() {});
  }
}

function toggleStudentNotifs() {
  var drop = document.getElementById('st-ndrop');
  if (!drop) return;
  var isOpen = drop.style.display === 'block';
  drop.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) fetchStudentNotifs();
}

function clearStudentNotifs() {
  _studentNotifs.forEach(function(n) {
    n.read = true;
    n.status = 'Read';
  });
  var badgeEl = document.getElementById('st-nbadge');
  if (badgeEl) {
    badgeEl.textContent = '0';
    badgeEl.style.display = 'none';
  }
  renderStudentNotifsList();
  api('/api/notifications/read-all', { method: 'PUT' }, true).then(function() {
    fetchStudentNotifs();
  }).catch(function() {});
}

// Close notification dropdown when clicked outside
document.addEventListener('click', function(e) {
  var btn = document.getElementById('st-notif-btn');
  var drop = document.getElementById('st-ndrop');
  if (drop && btn && !btn.contains(e.target) && !drop.contains(e.target)) {
    drop.style.display = 'none';
  }
});

setInterval(fetchStudentNotifs, 30000);

loadStudentData();

// ══ LIVE SESSION POLLING ══════════════════════════════════════════════
var activeLiveSessionId = null;
function pollLiveSessionActive() {
  fetch('/api/live-session/active', {
    headers: { 'Authorization': 'Bearer ' + sessionStorage.getItem('eams_token') }
  })
  .then(function(res){ return res.json(); })
  .then(function(d) {
    var cont = document.getElementById('live-session-container');
    if (!cont) return;
    if (d.active) {
      activeLiveSessionId = d.sessionId;
      if (d.alreadyMarked) {
        cont.innerHTML = '<div style="background:#f0fdfa;border:1.5px solid #5eead4;border-radius:14px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:12px;">'
          + '<span style="font-size:24px;"><re-icon icon="check-circle"></re-icon></span>'
          + '<div style="flex:1;"><div style="font-size:13px;font-weight:700;color:#0f766e;">Attendance Marked</div><div style="font-size:11.5px;color:#115e59;margin-top:2px;">You have successfully marked your attendance for '+d.subjectName+'.</div></div>'
          + '</div>';
      } else {
        cont.innerHTML = '<div style="background:#fdf4ff;border:1.5px solid #f0abfc;border-radius:14px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:12px;">'
          + '<span style="font-size:24px;"><re-icon icon="radio"></re-icon></span>'
          + '<div style="flex:1;"><div style="font-size:13px;font-weight:700;color:#86198f;">Live Class Active: '+d.subjectName+'</div><div style="font-size:11.5px;color:#701a75;margin-top:2px;">Enter the passcode shown by your teacher to mark attendance.</div></div>'
          + '<input type="text" id="live-passcode" placeholder="----" maxlength="4" style="width:70px;text-align:center;font-size:18px;font-weight:bold;letter-spacing:3px;padding:8px;border:1px solid #f0abfc;border-radius:8px;">'
          + '<button onclick="submitLiveSession()" style="padding:10px 16px;border-radius:10px;background:#d946ef;border:none;color:#fff;font-size:12px;font-weight:700;cursor:pointer;margin-left:8px;">Mark</button>'
          + '</div>';
      }
    } else {
      activeLiveSessionId = null;
      cont.innerHTML = '';
    }
  })
  .catch(function(e){});
}
window.submitLiveSession = function() {
  if (!activeLiveSessionId) return;
  var code = document.getElementById('live-passcode').value;
  if (!code || code.length < 4) { dbToast('Enter 4-digit passcode', 'warn'); return; }
  dbToast('Submitting passcode…', 'saving');

  var studentTrackId = (typeof STUDENT !== 'undefined' && STUDENT && (STUDENT.trackId || STUDENT._id)) || '';
  var devId = window.DeviceKey && typeof window.DeviceKey.getInstallId === 'function'
    ? window.DeviceKey.getInstallId()
    : (localStorage.getItem('eams_device_id') || '');

  function doSend(pos, proof) {
    var payload = {
      sessionId: activeLiveSessionId,
      passcode: code,
      deviceId: devId
    };
    if (proof) payload.deviceProof = proof;
    if (pos) {
      payload.latitude = pos.latitude;
      payload.longitude = pos.longitude;
      payload.accuracy = pos.accuracy;
    }

    fetch('/api/live-session/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sessionStorage.getItem('eams_token') },
      body: JSON.stringify(payload)
    })
    .then(function(res){ return res.json(); })
    .then(function(d) {
      if (d.error) { dbToast(d.error, 'error'); return; }
      if (d.status === 'pending' || d.requiresTeacherVerification) {
        dbToast('Attendance pending teacher verification', 'warn', d.message || 'Under review');
      } else {
        dbToast('Attendance Self-Marked!', 'success', 'Passcode verified');
      }
      pollLiveSessionActive();
    })
    .catch(function(e){ dbToast('Error submitting passcode', 'error'); });
  }

  var proofPromise = Promise.resolve(null);
  if (window.DeviceKey && typeof window.DeviceKey.createDeviceProof === 'function') {
    proofPromise = window.DeviceKey.createDeviceProof(
      { sessionId: activeLiveSessionId, passcode: code },
      studentTrackId
    ).catch(function() { return null; });
  }

  proofPromise.then(function(proof) {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function(p) {
          doSend({
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy
          }, proof);
        },
        function() { doSend(null, proof); },
        { enableHighAccuracy: true, timeout: 3500, maximumAge: 60000 }
      );
    } else {
      doSend(null, proof);
    }
  });
};
setInterval(pollLiveSessionActive, 10000);
setTimeout(pollLiveSessionActive, 1500);

// ══ QUICK PASS & REP SHARE POLLING ════════════════════════════════════
function pollQuickPassActive() {
  var t = TOKEN || sessionStorage.getItem('eams_token');
  if (!t) return;
  fetch('/api/quick-pass/active', {
    headers: { 'Authorization': 'Bearer ' + t }
  })
  .then(function(r) { return r.ok ? r.json() : null; })
  .then(function(d) {
    var banner = document.getElementById('st-active-session-banner');
    if (!banner) return;
    if (d && d.active && d.session) {
      banner.style.display = 'flex';
      var title = document.getElementById('st-banner-title');
      var desc = document.getElementById('st-banner-desc');
      if (title) title.innerHTML = '<re-icon icon="bolt"></re-icon> Quick Pass Attendance Active: ' + (d.session.subjectName || 'Current Lecture');
      if (desc) desc.textContent = 'Rotation ' + (d.session.currentRotation || 1) + ' of ' + (d.session.totalRotations || 2) + ' is running. Click to mark your presence.';
    } else {
      banner.style.display = 'none';
    }
  })
  .catch(function(){});
}

var _repSession = null;
var _repStudents = [];
var _repMarkings = {}; // trackId -> { status: 'Present', remarks: '' }

function checkRepPendingSession() {
  var t = TOKEN || sessionStorage.getItem('eams_token');
  if (!t) return;
  fetch('/api/rep-share/pending', {
    headers: { 'Authorization': 'Bearer ' + t }
  })
  .then(function(r) { return r.ok ? r.json() : null; })
  .then(function(d) {
    var navRep = document.getElementById('nav-rep-att');
    var badge = document.getElementById('rep-badge');
    if (d && d.hasPending && d.session) {
      if (navRep) navRep.style.display = 'flex';
      if (badge) { badge.style.display = 'inline-block'; badge.textContent = '1'; }
      if (_currentView === 'rep-att') {
        renderRepPendingSession(d.session, d.students);
      }
    } else {
      if (badge) badge.style.display = 'none';
      if (_currentView === 'rep-att' && !_repSession) {
        var empty = document.getElementById('rep-empty-state');
        var area = document.getElementById('rep-session-area');
        if (empty) empty.style.display = 'block';
        if (area) area.style.display = 'none';
      }
    }
  })
  .catch(function(){});
}

function loadRepPendingSession() {
  var t = TOKEN || sessionStorage.getItem('eams_token');
  if (!t) return;
  fetch('/api/rep-share/pending', {
    headers: { 'Authorization': 'Bearer ' + t }
  })
  .then(function(r) { return r.ok ? r.json() : null; })
  .then(function(d) {
    if (d && d.hasPending && d.session) {
      renderRepPendingSession(d.session, d.students);
    } else {
      _repSession = null;
      _repStudents = [];
      var empty = document.getElementById('rep-empty-state');
      var area = document.getElementById('rep-session-area');
      if (empty) empty.style.display = 'block';
      if (area) area.style.display = 'none';
    }
  })
  .catch(function(e) {
    toast('Error checking rep delegations: ' + e.message, 'error');
  });
}

function renderRepPendingSession(session, students) {
  _repSession = session;
  _repStudents = students || [];
  _repMarkings = {};

  var empty = document.getElementById('rep-empty-state');
  var area = document.getElementById('rep-session-area');
  if (empty) empty.style.display = 'none';
  if (area) area.style.display = 'block';

  // Fill details
  var elClass = document.getElementById('rep-session-class');
  if (elClass) elClass.textContent = session.className || 'Class';
  var elSub = document.getElementById('rep-session-subject');
  if (elSub) elSub.textContent = session.subjectName || 'Subject';
  var elTea = document.getElementById('rep-session-teacher');
  if (elTea) elTea.textContent = session.teacherName || 'Faculty';
  var elHour = document.getElementById('rep-session-hour');
  if (elHour) elHour.textContent = 'Period ' + (session.periodNumber || 1) + ' (' + (session.date || '') + ')';
  var elTopic = document.getElementById('rep-session-topic');
  if (elTopic) elTopic.textContent = session.topic || '(No topic specified)';
  var elTime = document.getElementById('rep-session-time');
  if (elTime) elTime.textContent = 'Delegated: ' + (session.notifiedAt ? new Date(session.notifiedAt).toLocaleTimeString() : 'Just now');

  // Initialize markings default to Present
  var tbody = document.getElementById('rep-student-tbody');
  if (!tbody) return;

  var html = '';
  _repStudents.forEach(function(stu, idx) {
    var tid = stu.trackId || stu._id;
    _repMarkings[tid] = {
      studentId: stu._id,
      studentTrackId: tid,
      regNo: stu.registerNo || '',
      studentName: stu.fullName || '',
      status: 'Present',
      remarks: ''
    };

    html += '<tr id="rep-row-' + tid + '">'
      + '<td style="text-align:center;font-weight:700;color:var(--tdi);">' + (idx + 1) + '</td>'
      + '<td style="font-weight:700;font-family:monospace;color:var(--td);">' + (stu.registerNo || '—') + '</td>'
      + '<td style="font-weight:600;color:var(--td);">' + (stu.fullName || '—') + '</td>'
      + '<td style="text-align:center;">'
      + '  <div style="display:inline-flex;background:var(--gP);border-radius:8px;padding:3px;gap:3px;">'
      + '    <button type="button" id="rep-btn-p-' + tid + '" onclick="setRepStatus(\'' + tid + '\',\'Present\')" class="btn-rep-status act-present" style="padding:4px 10px;font-size:11px;font-weight:800;border:none;border-radius:6px;cursor:pointer;background:#16a34a;color:#fff;">P</button>'
      + '    <button type="button" id="rep-btn-a-' + tid + '" onclick="setRepStatus(\'' + tid + '\',\'Absent\')" class="btn-rep-status" style="padding:4px 10px;font-size:11px;font-weight:800;border:none;border-radius:6px;cursor:pointer;background:transparent;color:var(--td);">A</button>'
      + '    <button type="button" id="rep-btn-od-' + tid + '" onclick="setRepStatus(\'' + tid + '\',\'OD\')" class="btn-rep-status" style="padding:4px 10px;font-size:11px;font-weight:800;border:none;border-radius:6px;cursor:pointer;background:transparent;color:var(--td);">OD</button>'
      + '  </div>'
      + '</td>'
      + '<td>'
      + '  <input type="text" class="fc2" placeholder="Optional remark" value="" onchange="updateRepRemark(\'' + tid + '\', this.value)" style="padding:5px 8px;font-size:11.5px;">'
      + '</td>'
      + '</tr>';
  });

  tbody.innerHTML = html;
  updateRepStats();
}

window.setRepStatus = function(tid, status) {
  if (!_repMarkings[tid]) return;
  _repMarkings[tid].status = status;

  var btnP = document.getElementById('rep-btn-p-' + tid);
  var btnA = document.getElementById('rep-btn-a-' + tid);
  var btnOD = document.getElementById('rep-btn-od-' + tid);

  if (btnP) {
    btnP.style.background = status === 'Present' ? '#16a34a' : 'transparent';
    btnP.style.color = status === 'Present' ? '#fff' : 'var(--td)';
  }
  if (btnA) {
    btnA.style.background = status === 'Absent' ? '#dc2626' : 'transparent';
    btnA.style.color = status === 'Absent' ? '#fff' : 'var(--td)';
  }
  if (btnOD) {
    btnOD.style.background = status === 'OD' ? '#d97706' : 'transparent';
    btnOD.style.color = status === 'OD' ? '#fff' : 'var(--td)';
  }

  updateRepStats();
};

window.updateRepRemark = function(tid, val) {
  if (_repMarkings[tid]) {
    _repMarkings[tid].remarks = val.trim();
  }
};

window.markAllRep = function(status) {
  Object.keys(_repMarkings).forEach(function(tid) {
    window.setRepStatus(tid, status);
  });
};

function updateRepStats() {
  var total = _repStudents.length;
  var present = 0;
  var absent = 0;

  Object.keys(_repMarkings).forEach(function(tid) {
    var s = _repMarkings[tid].status;
    if (s === 'Present') present++;
    else if (s === 'Absent') absent++;
  });

  var elTot = document.getElementById('rep-cnt-total');
  if (elTot) elTot.textContent = total;
  var elPres = document.getElementById('rep-cnt-present');
  if (elPres) elPres.textContent = present;
  var elAbs = document.getElementById('rep-cnt-absent');
  if (elAbs) elAbs.textContent = absent;

  var elSummary = document.getElementById('rep-summary-text');
  if (elSummary) elSummary.textContent = present + ' of ' + total + ' Students Marked Present (' + (total - present) + ' Absent/OD)';
}

window.openRepConfirmModal = function() {
  var present = 0;
  Object.keys(_repMarkings).forEach(function(tid) {
    if (_repMarkings[tid].status === 'Present') present++;
  });

  var disp = document.getElementById('rep-verify-marked-display');
  if (disp) disp.textContent = present;

  var inp = document.getElementById('input-rep-headcount');
  if (inp) {
    inp.value = '';
    inp.style.borderColor = 'var(--br)';
  }

  var err = document.getElementById('rep-headcount-err');
  if (err) { err.style.display = 'none'; err.textContent = ''; }

  var btn = document.getElementById('btn-rep-final-submit');
  if (btn) btn.disabled = true;

  openModal('modal-rep-confirm');
};

window.validateRepHeadcount = function() {
  var present = 0;
  Object.keys(_repMarkings).forEach(function(tid) {
    if (_repMarkings[tid].status === 'Present') present++;
  });

  var inp = document.getElementById('input-rep-headcount');
  var err = document.getElementById('rep-headcount-err');
  var btn = document.getElementById('btn-rep-final-submit');
  if (!inp || !err || !btn) return;

  var val = inp.value.trim();
  if (val === '') {
    err.style.display = 'none';
    btn.disabled = true;
    inp.style.borderColor = 'var(--br)';
    return;
  }

  var count = parseInt(val, 10);
  if (isNaN(count) || count !== present) {
    err.style.display = 'block';
    err.innerHTML = '<re-icon icon="alert-triangle"></re-icon> Headcount (' + count + ') does not match marked present count (' + present + ').';
    inp.style.borderColor = '#dc2626';
    btn.disabled = true;
  } else {
    err.style.display = 'none';
    inp.style.borderColor = '#16a34a';
    btn.disabled = false;
  }
};

window.submitRepConfirmedAttendance = function() {
  if (!_repSession) {
    toast('No active delegation found', 'error');
    return;
  }

  var present = 0;
  var records = [];
  Object.keys(_repMarkings).forEach(function(tid) {
    var rec = _repMarkings[tid];
    if (rec.status === 'Present') present++;
    records.push(rec);
  });

  var inp = document.getElementById('input-rep-headcount');
  var count = parseInt(inp ? inp.value : '', 10);
  if (isNaN(count) || count !== present) {
    toast('Anti-fraud check failed: Physical count must match marked present count', 'error');
    return;
  }

  var btn = document.getElementById('btn-rep-final-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting Attendance…'; }

  var t = TOKEN || sessionStorage.getItem('eams_token');
  fetch('/api/rep-share/submit/' + (_repSession.sessionTrackId || _repSession._id), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + t
    },
    body: JSON.stringify({
      records: records,
      repConfirmedCount: count
    })
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Headcount & Submit Attendance'; }
    if (data.error) {
      toast(data.error, 'error');
      return;
    }
    toast('Attendance submitted to teacher for review!', 'success');
    closeModal('modal-rep-confirm');
    _repSession = null;
    _repStudents = [];
    _repMarkings = {};
    var empty = document.getElementById('rep-empty-state');
    var area = document.getElementById('rep-session-area');
    if (empty) empty.style.display = 'block';
    if (area) area.style.display = 'none';
    var badge = document.getElementById('rep-badge');
    if (badge) badge.style.display = 'none';
    showView('dashboard');
  })
  .catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Headcount & Submit Attendance'; }
    toast('Failed to submit: ' + err.message, 'error');
  });
};

setInterval(pollQuickPassActive, 10000);
setTimeout(pollQuickPassActive, 2000);
setInterval(checkRepPendingSession, 12000);
setTimeout(checkRepPendingSession, 2500);

// ── Phase T4: Student Trust Profile & Gating (§10, T4.6) ─────────────────────
function loadStudentTrustProfile() {
  if (!TOKEN) return;
  fetch('/api/trust/me', {
    headers: { 'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/json' }
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (!data || !data.ok) return;
    window._studentTrustData = data;

    // 1. Update Topbar Chip (§10)
    var chipEl = document.getElementById('st-trust-chip');
    var iconEl = document.getElementById('st-trust-icon');
    var textEl = document.getElementById('st-trust-text');

    if (chipEl && iconEl && textEl) {
      chipEl.style.display = 'inline-flex';
      var band = (data.band || 'normal').toUpperCase();
      if (data.isLocked) {
        iconEl.textContent = '🔒';
        textEl.textContent = 'Locked · Trust ' + data.score;
        chipEl.style.background = '#fef2f2';
        chipEl.style.borderColor = '#fecaca';
        chipEl.style.color = '#991b1b';
      } else if (!data.deviceRegistered) {
        iconEl.textContent = '⚠';
        textEl.textContent = 'Unregistered Phone · Trust ' + data.score;
        chipEl.style.background = '#fffbeb';
        chipEl.style.borderColor = '#fde68a';
        chipEl.style.color = '#b45309';
      } else {
        iconEl.textContent = '📱';
        textEl.textContent = 'Registered Phone · Trust ' + data.score + ' (' + band + ')';
        chipEl.style.background = '#f0fdf4';
        chipEl.style.borderColor = '#bbf7d0';
        chipEl.style.color = '#166534';
      }
    }

    // 2. Dashboard Lock / Low Trust Gating (§7.2, §10)
    var banner = document.getElementById('st-trust-lock-banner');
    var bannerTitle = document.getElementById('st-lock-banner-title');
    var bannerDesc = document.getElementById('st-lock-banner-desc');

    if (data.isLocked || data.score < 40) {
      if (banner) {
        banner.style.display = 'flex';
        if (data.isLocked) {
          bannerTitle.textContent = 'Self-Attendance Locked';
          var until = data.lockedUntil ? new Date(data.lockedUntil).toLocaleDateString() : 'N/A';
          bannerDesc.textContent = 'Your self-attendance is locked until ' + until + '. Reason: ' + (data.lockReason || 'Administrative lock') + '. Please meet your Class Advisor or Department Admin.';
        } else {
          bannerTitle.textContent = 'Self-Attendance Disabled (Trust < 40)';
          bannerDesc.textContent = 'Your trust score (' + data.score + ') is below 40. Self-attendance is disabled. Attendance must be marked manually by your teacher.';
        }
      }

      // Disable Mark Attendance button in sidebar and active session banner
      var markAttNav = document.getElementById('nav-mark-att');
      if (markAttNav) {
        markAttNav.style.opacity = '0.5';
        markAttNav.style.cursor = 'not-allowed';
        markAttNav.onclick = function (e) {
          e.preventDefault();
          toast(data.lockReason || 'Self-attendance is disabled due to low trust score or administrative lock.', 'error');
        };
      }
    } else {
      if (banner) banner.style.display = 'none';
    }
  })
  .catch(function(err) {
    console.warn('[Student Trust Profile Warn]:', err);
  });
}
window.loadStudentTrustProfile = loadStudentTrustProfile;

loadStudentTrustProfile();
setInterval(loadStudentTrustProfile, 30000);

// Security
document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
document.addEventListener('keydown', function(e) {
  if (e.key==='F12'||(e.ctrlKey&&e.shiftKey&&['I','J','C'].includes(e.key))||(e.ctrlKey&&e.key==='U')) {
    e.preventDefault(); return false;
  }
});