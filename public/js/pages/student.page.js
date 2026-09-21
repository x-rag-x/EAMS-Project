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
var USER = checkAuth('student');
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
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
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
  // Update topbar label
  var labels = { dashboard: 'Dashboard', profile: 'My Profile', attendance: 'Attendance', leave: 'Apply Leave', 'rep-att': 'Class Rep Attendance' };
  var tbLabel = document.getElementById('tb-page-label');
  if (tbLabel) tbLabel.textContent = labels[name] || name;
  // If data is ready, render the appropriate view
  if (_data) {
    if (name === 'dashboard') renderPortal(_data);
    else if (name === 'profile') renderProfilePage(_data);
    else if (name === 'attendance') renderAttendancePage(_data);
    else if (name === 'leave') loadLeaveData();
    else if (name === 'rep-att') loadRepPendingSession();
  } else if (name === 'leave') {
    loadLeaveData();
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

  var mustChange = sessionStorage.getItem('eams_mustChangePw') === '1';
  var html = '';
  if (mustChange) {
    html += '<div class="must-change-banner" style="background:#fff3cd;border:1.5px solid #f59e0b;border-radius:14px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:12px;">'
      + '<span style="font-size:20px;">🔐</span>'
      + '<div style="flex:1;"><div style="font-size:13px;font-weight:700;color:#92400e;">Password Change Required</div><div style="font-size:11.5px;color:#b45309;margin-top:2px;">Your default password must be changed before proceeding.</div></div>'
      + '<button onclick="openChangePw()" style="padding:8px 16px;border-radius:10px;background:#f59e0b;border:none;color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:Poppins,sans-serif;">Change Now →</button>'
      + '</div>';
  }

  html += '<div id="live-session-container"></div>';

  // Hero
  var badgeClass = oCls === 'ok' ? 'badge-ok' : oCls === 'warn' ? 'badge-warn' : 'badge-danger';
  var badgeText  = oCls === 'ok' ? '✅ On Track' : oCls === 'warn' ? '⚠️ Below Threshold' : '🚨 Critical';
  var yearToDisplay = _ACTIVE_YEAR || _GLOBAL_ACAD.academicYear || stu.academicYear || '—';

  html += '<div class="hero">'
    + '<div class="hero-av">'+initials+'</div>'
    + '<div class="hero-info">'
    + '<div class="hero-greeting">Welcome back,</div>'
    + '<div class="hero-name">'+displayName+'</div>'
    + '<div style="font-size:11.5px;color:rgba(255,255,255,.7);margin-top:2px;">'+(stu.regNo||'—')+' &nbsp;·&nbsp; '+(stu.deptName||'—')+'</div>'
    + '<div class="hero-pills">'
    + '<span class="hero-pill">🏫 '+(stu.className||'—')+'</span>'
    + '<span class="hero-pill">📅 '+yearToDisplay+'</span>'
    + (stu.isClassRep?'<span class="hero-pill">⭐ Class Rep</span>':'')
    + '</div></div>'
    + '<div class="hero-right"><div class="hero-pct-wrap">'
    + '<div class="hero-pct">'+oPct+'%</div>'
    + '<div class="hero-pct-label">Overall Attendance</div>'
    + '<span class="hero-pct-badge '+badgeClass+'">'+badgeText+'</span>'
    + '</div></div></div>';

  // Stats
  var shortage = calcShortage(att.totalPresent, att.totalClasses, minR);
  html += '<div class="stats-row">'
    + '<div class="stat-card"><div class="sc-icon">📚</div><div class="sc-val">'+att.totalClasses+'</div><div class="sc-label">Total Classes</div><div class="sc-sub">Across all subjects</div></div>'
    + '<div class="stat-card"><div class="sc-icon">✅</div><div class="sc-val" style="color:var(--gK);">'+att.totalPresent+'</div><div class="sc-label">Present</div><div class="sc-sub">Classes attended</div></div>'
    + '<div class="stat-card"><div class="sc-icon">❌</div><div class="sc-val" style="color:#ef4444;">'+att.totalAbsent+'</div><div class="sc-label">Absent</div><div class="sc-sub">Classes missed</div></div>'
    + '<div class="stat-card"><div class="sc-icon">'+(shortage>0?'⚠️':'🎯')+'</div><div class="sc-val" style="color:'+(shortage>0?'#f59e0b':'var(--gK)')+';">'+(shortage>0?shortage:'—')+'</div><div class="sc-label">'+(shortage>0?'Classes Needed':'Requirement Met')+'</div><div class="sc-sub">To reach '+minR+'% threshold</div></div>'
    + '</div>';

  // Two-col: gauge + profile quick view
  var gaugeColor = oCls==='ok'?'var(--gK)':oCls==='warn'?'#b45309':'#dc2626';
  html += '<div class="two-col">';
  html += '<div class="card">'
    + '<div class="card-hd"><div class="card-title">📊 Attendance Overview</div></div>'
    + '<div class="card-body" style="display:flex;flex-direction:column;align-items:center;padding:20px;">'
    + '<div class="gauge-outer">'+buildGaugeSVG(oPct,oCls)
    + '<div class="gauge-center"><div class="gauge-pct-txt" style="color:'+gaugeColor+';">'+oPct+'%</div><div class="gauge-lbl-txt">Overall</div></div></div>'
    + '<div style="margin-top:18px;width:100%;display:flex;flex-direction:column;gap:8px;">'
    + gaugeRow('Present',att.totalPresent,att.totalClasses,'var(--gK)')
    + gaugeRow('Absent',att.totalAbsent,att.totalClasses,'#ef4444')
    + '<div style="padding:10px 0 0;border-top:1px solid var(--brl);text-align:center;font-size:11.5px;color:var(--tmu);">Minimum required: <b style="color:'+gaugeColor+';">'+minR+'%</b>'
    + (shortage>0?' &nbsp;·&nbsp; Need <b style="color:#dc2626;">'+shortage+'</b> more classes':' &nbsp;·&nbsp; <b style="color:var(--gK);">You are on track 🎉</b>')
    + '</div></div></div></div>';

  html += '<div class="card">'
    + '<div class="card-hd"><div class="card-title">👤 Student Profile</div>'
    + '<button onclick="showView(\'profile\')" style="font-size:11px;padding:4px 12px;border-radius:12px;border:1.5px solid var(--br);background:var(--gP);color:var(--tmu);cursor:pointer;font-family:Poppins,sans-serif;">View Full Profile →</button>'
    + '</div>'
    + '<div class="card-body"><div class="profile-grid">'
    + pRow('Register No.', stu.regNo || '—')
    + pRow('Department', stu.deptName||'—')
    + pRow('Class', stu.className||'—')
    + pRow('Year', stu.year||'—')
    + pRow('Section', stu.section||'—')
    + pRow('Course', stu.courseType||'—')
    + pRow('Branch', stu.branch||'—')
    + pRow('Academic Year', stu.academicYear||'—')
    + pRow('Email', stu.email||usr.email||'—')
    + pRow('Blood Group', stu.bloodGroup||'—')
    + pRow('Last Login', usr.lastLogin ? fmtDate(usr.lastLogin) : 'First login')
    + pRow('Class Rep', stu.isClassRep?'Yes ⭐':'No')
    + '</div></div></div>';
  html += '</div>';

  // Subject table
  html += '<div class="card" style="margin-bottom:18px;">'
    + '<div class="card-hd"><div class="card-title">📖 Subject-wise Attendance</div>'
    + '<span style="font-size:11px;color:var(--tdi);">Click a subject row to see details</span>'
    + '</div>'
    + '<div style="overflow-x:auto;">'
    + '<table class="tbl"><thead><tr>'
    + '<th>Subject</th><th>Teacher</th><th>Present</th><th>Absent</th><th>Total</th><th style="min-width:140px;">Attendance</th><th>Status</th>'
    + '</tr></thead><tbody id="sub-tbody"></tbody></table></div></div>';

  html += '<div class="card">'
    + '<div class="card-hd"><div class="card-title">📅 Recent Attendance Log</div></div>'
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
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><span class="ei">📭</span><p>No attendance data found yet.</p></div></td></tr>';
    return;
  }
  var html = '';
  subjects.forEach(function(s, idx) {
    var cls = getClass(s.percentage, minR);
    var shortage = calcShortage(s.present, s.total, minR);
    var statusHtml = shortage > 0
      ? '<span class="shortage-badge">Need '+shortage+' more</span>'
      : '<span class="ok-badge">✅ On Track</span>';
    var detailId = detailPrefix + idx;
    html += '<tr style="cursor:pointer;" onclick="toggleNamedDetail(\'' + detailId + '\')">'
      + '<td class="b">📘 '+(s.subjectName||'—')+'</td>'
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
    return '<span class="att-chip '+d.status+'">'+d.date+' '+(d.status==='present'?'✅':'❌')+'</span>';
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
    calEl.innerHTML = '<div class="empty-state"><span class="ei">📭</span><p>No subjects found.</p></div>';
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
    calEl.innerHTML = '<div class="empty-state"><span class="ei">📅</span><p>No attendance records for this subject yet.</p></div>';
    return;
  }
  var map = {};
  dates.forEach(function(d) { map[d.date] = d.status; });
  var today = new Date();
  var calStart = new Date(today);
  calStart.setDate(today.getDate() - today.getDay() - 28);
  var html = '<div style="font-size:12px;font-weight:600;color:var(--tmu);margin-bottom:10px;">Last 5 weeks — ' + (subject ? subject.subjectName : '') + '</div>';
  html += '<div class="cal-grid">';
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(function(d) { html += '<div class="cal-day-hdr">'+d+'</div>'; });
  for (var i = 0; i < 35; i++) {
    var d = new Date(calStart); d.setDate(calStart.getDate()+i);
    var iso = d.toISOString().split('T')[0];
    var status = map[iso];
    var cls = 'empty';
    if (status === 'present') cls = 'present';
    else if (status === 'absent') cls = 'absent';
    var isToday = iso === new Date().toISOString().split('T')[0];
    html += '<div class="cal-day '+cls+(isToday?' today':'')+'" title="'+iso+(status?' — '+status:'')+'">'
      + (status?(status==='present'?'✅':'❌'):'<span style="opacity:.4;">'+d.getDate()+'</span>')
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
    + '<div class="att-hero-title">📊 Attendance Analytics</div>'
    + '<div class="att-hero-sub">' + (stu.name || 'Student') + ' &nbsp;·&nbsp; ' + (stu.regNo || '—') + ' &nbsp;·&nbsp; ' + (stu.deptName || '—') + '</div>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:14px;">'
    + '<div style="text-align:right;"><div style="font-size:10.5px;opacity:.8;text-transform:uppercase;letter-spacing:.5px;">Overall Attendance</div><div style="font-size:32px;font-weight:800;line-height:1.1;">' + oPct + '%</div></div>'
    + '<div class="att-hero-badge">' + (oPct >= minR ? '🎯' : '⚠️') + '</div>'
    + '</div>'
    + '</div>';

  // Stats Row
  html += '<div class="stats-row" style="margin-bottom:20px;">'
    + '<div class="stat-card"><div class="sc-icon">📚</div><div class="sc-val">' + att.totalClasses + '</div><div class="sc-label">Total Classes</div><div class="sc-sub">Across all enrolled subjects</div></div>'
    + '<div class="stat-card"><div class="sc-icon">✅</div><div class="sc-val" style="color:var(--gK);">' + att.totalPresent + '</div><div class="sc-label">Present</div><div class="sc-sub">Classes attended</div></div>'
    + '<div class="stat-card"><div class="sc-icon">❌</div><div class="sc-val" style="color:#ef4444;">' + att.totalAbsent + '</div><div class="sc-label">Absent</div><div class="sc-sub">Classes missed</div></div>'
    + '<div class="stat-card"><div class="sc-icon">' + (shortage > 0 ? '⚠️' : '🎉') + '</div><div class="sc-val" style="color:' + (shortage > 0 ? '#dc2626' : 'var(--gK)') + ';">' + (shortage > 0 ? shortage : '—') + '</div><div class="sc-label">' + (shortage > 0 ? 'Classes Needed' : 'Requirement Met') + '</div><div class="sc-sub">Minimum threshold: ' + minR + '%</div></div>'
    + '</div>';

  // Subject Cards Grid
  html += '<div style="font-size:14px;font-weight:700;color:var(--td);margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">'
    + '<span>📖 Subject-wise Performance</span>'
    + '<span style="font-size:11px;color:var(--tmu);font-weight:500;">' + (att.subjects ? att.subjects.length : 0) + ' subjects</span>'
    + '</div>';

  if (!att.subjects || !att.subjects.length) {
    html += '<div class="card" style="margin-bottom:20px;"><div class="empty-state"><span class="ei">📭</span><p>No subjects or attendance data found yet.</p></div></div>';
  } else {
    html += '<div class="att-cards-grid">';
    att.subjects.forEach(function(s, idx) {
      var cls = getClass(s.percentage, minR);
      var subShortage = calcShortage(s.present, s.total, minR);
      var pillCls = cls === 'ok' ? 'ok' : cls === 'warn' ? 'warn' : 'danger';
      html += '<div class="att-card">'
        + '<div class="att-card-hd">'
        + '<div><div class="att-sub-name">📘 ' + (s.subjectName || '—') + '</div><div class="att-teacher-name">👨‍🏫 ' + (s.teacherName || 'Faculty') + '</div></div>'
        + '<div class="att-pct-pill ' + pillCls + '">' + s.percentage + '%</div>'
        + '</div>'
        + '<div class="prog-wrap prog-' + cls + '" style="margin:10px 0;"><div class="prog-bar"><div class="prog-fill" style="width:' + s.percentage + '%;"></div></div></div>'
        + '<div class="att-stats-mini">'
        + '<span>Attended: <b style="color:var(--gK);">' + s.present + '</b> / ' + s.total + '</span>'
        + '<span style="margin-left:auto;">' + (subShortage > 0 ? '<b style="color:#dc2626;">Need ' + subShortage + ' more</b>' : '<b style="color:var(--gK);">Eligible ✅</b>') + '</span>'
        + '</div>'
        + '</div>';
    });
    html += '</div>';
  }

  // Detailed Table
  html += '<div class="card" style="margin-bottom:20px;">'
    + '<div class="card-hd"><div class="card-title">📋 Subject Attendance Table</div><span style="font-size:11px;color:var(--tdi);">Click a subject row to view session dates</span></div>'
    + '<div style="overflow-x:auto;">'
    + '<table class="tbl"><thead><tr>'
    + '<th>Subject</th><th>Teacher</th><th>Present</th><th>Absent</th><th>Total</th><th style="min-width:140px;">Attendance</th><th>Status</th>'
    + '</tr></thead><tbody id="att-tbl-tbody"></tbody></table></div></div>';

  // Calendar
  html += '<div class="card">'
    + '<div class="card-hd"><div class="card-title">📅 Recent Attendance Log</div></div>'
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

  var initials = stu.name.split(' ').map(function(w){return w[0];}).join('').slice(0,2).toUpperCase();

  // Split name into parts
  var nameParts = stu.name.split(' ');
  var firstName  = stu.firstName  || nameParts[0] || '';
  var lastName   = stu.lastName   || nameParts.slice(1).join(' ') || '';

  var html = '';

  // ── PROFILE HERO
  html += '<div class="prof-hero">'
    + '<div class="prof-hero-av">'+initials+'</div>'
    + '<div class="prof-hero-info">'
    + '<div class="prof-hero-name">'+stu.name+'</div>'
    + '<div class="prof-hero-reg">'+stu.regNo+' &nbsp;·&nbsp; '+(stu.deptName||'—')+'</div>'
    + '<div class="prof-hero-tags">'
    + '<span class="prof-hero-tag">🏫 '+(stu.className||'—')+'</span>'
    + '<span class="prof-hero-tag">📅 '+(stu.academicYear||'—')+'</span>'
    + '<span class="prof-hero-tag">📖 '+(stu.courseType||'—')+'</span>'
    + (stu.isClassRep?'<span class="prof-hero-tag rep">⭐ Class Representative</span>':'')
    + '</div></div>'
    + '</div>';

  // ── SECTION 1: PROFILE INFO
  html += '<div class="prof-section" id="prof-info-section">'
    + '<div class="prof-section-hd">'
    + '<div class="prof-section-title">🪪 Profile Information</div>'
    + '<button class="btn-out" id="prof-edit-btn" onclick="toggleProfileEdit(true)" style="font-size:11.5px;padding:6px 14px;">✏️ Edit Profile</button>'
    + '</div>'
    + '<div class="prof-section-body">'

    // ─ Identity fields
    + '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--tdi);margin-bottom:10px;">Identity</div>'
    + '<div class="fields-grid" style="margin-bottom:18px;">'
    + profField('Full Name', stu.name, 'prof-fullname', true)
    + profField('First Name', firstName, 'prof-firstname', true)
    + profField('Last Name', lastName, 'prof-lastname', true)
    + '</div>'

    // ─ Academic fields
    + '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--tdi);margin-bottom:10px;">Academic Details</div>'
    + '<div class="fields-grid" style="margin-bottom:18px;">'
    + profFieldReadonly('Register No.', stu.regNo || '—')
    + profFieldReadonly('Class', stu.className || '—')
    + profFieldReadonly('Section', stu.section || '—')
    + profFieldReadonly('Branch', stu.branch || '—')
    + profFieldReadonly('Course', stu.courseType || '—')
    + profFieldReadonly('Department', stu.deptName || '—')
    + profField('Current Year', stu.year || '—', 'prof-year', true)
    + profFieldReadonly('Academic Year', stu.academicYear || '—')
    + '</div>'

    // ─ Contact & Account fields
    + '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--tdi);margin-bottom:10px;">Contact &amp; Account</div>'
    + '<div class="fields-grid" style="margin-bottom:18px;">'
    + profField('Email', stu.email || usr.email || '—', 'prof-email', true)
    + profFieldReadonly('Username', usr.username || '—')
    + profFieldReadonly('Password', '••••••••')
    + '</div>'

    // ─ Status fields
    + '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--tdi);margin-bottom:10px;">Status &amp; Roles</div>'
    + '<div class="fields-grid">'
    + profFieldBadge('Class Representative', stu.isClassRep ? 'Yes' : 'No', stu.isClassRep ? 'fb-yes' : 'fb-no', '⭐')
    + '</div>'

    // ─ Edit actions (hidden by default)
    + '<div class="edit-actions" id="prof-edit-actions" style="display:none;">'
    + '<button class="btn-pri" onclick="saveProfileEdit()" style="padding:9px 22px;">💾 Save Changes</button>'
    + '<button class="btn-out" onclick="toggleProfileEdit(false)">Cancel</button>'
    + '</div>'
    + '</div></div>';

  // ── SECTION 2: LOGIN ACTIVITY
  var firstAccess = getFirstAccessTime(usr);
  var firstDays   = daysSince(firstAccess);
  var currentTime = new Date().toISOString();
  var currentSub  = 'Session started: ' + fmtDateTime(sessionStorage.getItem('eams_session_start') || currentTime);

  html += '<div class="prof-section">'
    + '<div class="prof-section-hd">'
    + '<div class="prof-section-title">🔒 Login Activity</div>'
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
    + '<button class="btn-out" onclick="openLoginActivity()" style="font-size:12px;padding:8px 16px;">📋 View Activity</button>'
    + '<button class="btn-warn" onclick="openModal(\'m-unknown\')" style="font-size:12px;padding:8px 16px;">⚠️ Unknown Login?</button>'
    + '<button class="btn-danger" onclick="logoutAllDevices()" style="font-size:12px;padding:8px 16px;">🔴 Logout from All Devices</button>'
    + '</div>'
    + '</div></div>';

  // ── SECTION 3: SESSION INFO
  var sessionStart = sessionStorage.getItem('eams_session_start') || new Date().toISOString();
  if (!sessionStorage.getItem('eams_session_start')) {
    sessionStorage.setItem('eams_session_start', sessionStart);
  }

  html += '<div class="prof-section">'
    + '<div class="prof-section-hd">'
    + '<div class="prof-section-title">📡 Current Session Info</div>'
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
    + '<div class="prof-section-title">🔐 Change Password</div>'
    + '</div>'
    + '<div class="prof-section-body">'
    + '<div id="prof-pw-err" class="err-msg"></div>'
    + '<div class="chpw-grid">'
    + '<div class="fg" style="margin-bottom:0;">'
    + '<label class="fl">Current Password</label>'
    + '<div class="pw-wrap"><input type="password" class="fc2" id="prof-pw-old" placeholder="Current password"><button type="button" class="pw-eye" onclick="togglePw(\'prof-pw-old\',this)">👁</button></div>'
    + '</div>'
    + '<div class="fg" style="margin-bottom:0;">'
    + '<label class="fl">New Password</label>'
    + '<div class="pw-wrap"><input type="password" class="fc2" id="prof-pw-new" placeholder="Min. 6 characters" oninput="updateStrength(this.value,\'prof-pw-strength\')"><button type="button" class="pw-eye" onclick="togglePw(\'prof-pw-new\',this)">👁</button></div>'
    + '<div class="strength-bar"><div class="strength-fill" id="prof-pw-strength" style="width:0%;"></div></div>'
    + '</div>'
    + '<div class="fg" style="margin-bottom:0;">'
    + '<label class="fl">Confirm New Password</label>'
    + '<div class="pw-wrap"><input type="password" class="fc2" id="prof-pw-confirm" placeholder="Repeat new password"><button type="button" class="pw-eye" onclick="togglePw(\'prof-pw-confirm\',this)">👁</button></div>'
    + '</div>'
    + '</div>'
    + '<div style="margin-top:16px;">'
    + '<button class="btn-pri" onclick="doChangePwInline()" style="padding:10px 28px;">Update Password</button>'
    + '</div>'
    + '</div></div>';

  document.getElementById('profile-content').innerHTML = html;

  // Start session timer
  startSessionTimer(sessionStart);
  // Parse token for expiry
  updateTokenExpiry();
}

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

// ── Profile edit toggle ─────────────────────────────────────────
var _editableFields = ['prof-fullname','prof-firstname','prof-lastname','prof-year','prof-email'];
function toggleProfileEdit(on) {
  _editableFields.forEach(function(id) {
    var display = document.getElementById(id+'-display');
    var input   = document.getElementById(id+'-input');
    if (!display || !input) return;
    if (on) { display.style.display='none'; input.style.display='block'; }
    else     { display.style.display='block'; input.style.display='none'; }
  });
  var btn = document.getElementById('prof-edit-btn');
  var acts = document.getElementById('prof-edit-actions');
  if (btn) btn.style.display = on ? 'none' : 'inline-flex';
  if (acts) acts.style.display = on ? 'flex' : 'none';
}

function saveProfileEdit() {
  var email     = (document.getElementById('prof-email-input')||{}).value || '';
  var firstName = (document.getElementById('prof-firstname-input')||{}).value || '';
  var lastName  = (document.getElementById('prof-lastname-input')||{}).value || '';
  var year      = (document.getElementById('prof-year-input')||{}).value || '';

  if (!email || !email.includes('@')) {
    toast('Please enter a valid email address.', 'error'); return;
  }

  api('/api/profile/me', {
    method: 'PUT',
    body: JSON.stringify({ email: email, firstName: firstName, lastName: lastName, currentYear: year })
  })
  .then(function(d) {
    if (d.error) { toast(d.error, 'error'); return; }
    toast('Profile updated successfully!');
    // Update display values
    var fullName = (firstName + ' ' + lastName).trim();
    setFieldDisplay('prof-fullname', fullName);
    setFieldDisplay('prof-firstname', firstName);
    setFieldDisplay('prof-lastname', lastName);
    setFieldDisplay('prof-email', email);
    setFieldDisplay('prof-year', year);
    // Update topbar
    document.getElementById('tb-name').textContent = fullName;
    document.getElementById('sb-name').textContent = fullName;
    var initials = fullName.split(' ').map(function(w){return w[0];}).join('').slice(0,2).toUpperCase();
    document.getElementById('av-initials').textContent = initials;
    document.getElementById('sb-av').textContent = initials;
    document.getElementById('prof-hero-av') && (document.getElementById('prof-hero-av').textContent = initials);
    toggleProfileEdit(false);
  })
  .catch(function(e) { toast(e.message, 'error'); });
}

function setFieldDisplay(id, val) {
  var d = document.getElementById(id+'-display');
  var i = document.getElementById(id+'-input');
  if (d) d.textContent = val;
  if (i) i.value = val;
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
      var typeLabel = a.type==='web'?'🌐 Web':a.type==='mobile'?'📱 Mobile':'❓ Unknown';
      var deviceIcon = a.type==='mobile'?'📱':'💻';
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

function logoutAllDevices() {
  if (!confirm('This will log you out of all devices including this one. Continue?')) return;
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
  if (/Mobi|Android/i.test(ua)) return '📱 Mobile';
  if (/Tablet|iPad/i.test(ua)) return '📲 Tablet';
  return '💻 Desktop';
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
    + '<span style="font-size:44px;">⚠️</span>'
    + '<div style="font-size:15px;font-weight:700;color:#dc2626;max-width:420px;text-align:center;">' + (msg || 'Unable to load attendance data') + '</div>'
    + '<div style="display:flex;gap:10px;margin-top:10px;">'
    + '<button class="btn-pri" onclick="loadStudentData()" style="padding:8px 20px;font-size:12px;cursor:pointer;">🔄 Retry</button>'
    + '<a href="index.html" class="btn-out" style="padding:8px 20px;font-size:12px;text-decoration:none;display:inline-flex;align-items:center;">← Back to Login</a>'
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
    if (d.user && shouldForcePasswordChange(d.user)) {
      sessionStorage.setItem('eams_mustChangePw', '1');
    }
    renderPortal(d);
    if (_currentView === 'profile') renderProfilePage(d);
    if (_currentView === 'attendance') renderAttendancePage(d);
    if (_currentView === 'leave') loadLeaveData();
    if (sessionStorage.getItem('eams_mustChangePw') === '1') {
      setTimeout(openChangePw, 600);
    }
    fetchStudentNotifs();
  }).catch(function(e) {
    renderErrorState(e.message);
  });
}

// ══ LEAVE & PERMISSION MANAGEMENT ═════════════════════════════════════
var _leaveCategory = 'Leave';

function setLeaveCategory(cat) {
  _leaveCategory = cat;
  var btnFull = document.getElementById('tab-leave-full');
  var btnPerm = document.getElementById('tab-leave-perm');
  var grpFull = document.getElementById('group-full-day');
  var grpHalf = document.getElementById('group-half-day');
  var fromInp = document.getElementById('input-from-date');
  var toInp = document.getElementById('input-to-date');
  var permInp = document.getElementById('input-perm-date');

  if (cat === 'Leave') {
    if (btnFull) { btnFull.style.background = 'var(--gD)'; btnFull.style.color = '#fff'; }
    if (btnPerm) { btnPerm.style.background = 'transparent'; btnPerm.style.color = 'var(--td)'; }
    if (grpFull) grpFull.style.display = 'block';
    if (grpHalf) grpHalf.style.display = 'none';
    if (fromInp) fromInp.required = true;
    if (toInp) toInp.required = true;
    if (permInp) permInp.required = false;
  } else {
    if (btnPerm) { btnPerm.style.background = 'var(--gD)'; btnPerm.style.color = '#fff'; }
    if (btnFull) { btnFull.style.background = 'transparent'; btnFull.style.color = 'var(--td)'; }
    if (grpFull) grpFull.style.display = 'none';
    if (grpHalf) grpHalf.style.display = 'block';
    if (fromInp) fromInp.required = false;
    if (toInp) toInp.required = false;
    if (permInp) {
      permInp.required = true;
      if (!permInp.value) permInp.value = new Date().toISOString().split('T')[0];
    }
  }
}

function calculateLeaveDays() {
  var from = document.getElementById('input-from-date') ? document.getElementById('input-from-date').value : '';
  var to = document.getElementById('input-to-date') ? document.getElementById('input-to-date').value : '';
  var calcEl = document.getElementById('leave-days-calc');
  if (!calcEl) return;
  if (!from || !to) { calcEl.textContent = '1 Day'; return; }
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

function loadLeaveData() {
  var today = new Date().toISOString().split('T')[0];
  var fromInp = document.getElementById('input-from-date');
  var toInp = document.getElementById('input-to-date');
  var permInp = document.getElementById('input-perm-date');
  if (fromInp && !fromInp.value) fromInp.value = today;
  if (toInp && !toInp.value) toInp.value = today;
  if (permInp && !permInp.value) permInp.value = today;
  calculateLeaveDays();

  // 1. Fetch Advisor info
  api('/api/leave/advisor-info').then(function(d) {
    var nameEl = document.getElementById('leave-adv-name');
    var clsEl = document.getElementById('leave-adv-cls');
    if (nameEl) {
      if (d && d.advisor) {
        nameEl.innerHTML = '⭐ ' + d.advisor.name;
        if (clsEl) clsEl.textContent = (d.className || 'Class') + ' — ' + (d.advisor.designation || 'Class Advisor');
      } else {
        nameEl.textContent = 'No Class Advisor assigned';
        if (clsEl) clsEl.textContent = d.className || 'Class';
      }
    }
  }).catch(function() {});

  // 2. Fetch My Leave Requests
  api('/api/leave/my-requests').then(function(requests) {
    var list = Array.isArray(requests) ? requests : [];
    
    // Stats calculation
    var approvedLeaves = list.filter(function(r) { return r.status === 'Approved'; });
    var totalApprovedDays = approvedLeaves.reduce(function(acc, r) { return acc + (r.daysCount || (r.category === 'Permission' ? 0.5 : 1)); }, 0);
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
          var slotText = r.category === 'Permission' ? (' [' + (r.slot || 'Half Day') + ']') : '';
          return '<div style="background:#fffbeb;border:1.5px solid #fef3c7;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;">'
            + '<div style="font-weight:700;font-size:13px;color:#92400e;">' + (r.category === 'Permission' ? '⏱️ Permission' : '🌴 ' + r.leaveType) + ' <span style="font-size:11px;font-weight:600;color:#b45309;">' + slotText + '</span></div>'
            + '<span style="background:#fef3c7;color:#b45309;font-size:10px;font-weight:800;padding:2px 8px;border-radius:8px;border:1px solid #fde68a;">Pending</span>'
            + '</div>'
            + '<div style="font-size:12px;color:var(--td);font-weight:600;">📅 ' + dateDisplay + ' (' + (r.daysCount || (r.category === 'Permission' ? 0.5 : 1)) + ' day)</div>'
            + '<div style="font-size:11.5px;color:var(--tmu);line-height:1.4;">💬 ' + r.reason + '</div>'
            + '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;padding-top:6px;border-top:1px dashed #fde68a;">'
            + '<span style="font-size:10.5px;color:var(--tdi);">Applied ' + daysSince(r.createdAt) + '</span>'
            + '<button class="btn-warn bsm" onclick="cancelLeaveRequest(\'' + r._id + '\')" style="padding:4px 10px;font-size:11px;">Cancel</button>'
            + '</div>'
            + '</div>';
        }).join('');
      }
    }

    // Render History Table
    var tbody = document.getElementById('tbody-leave-history');
    if (tbody) {
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">No leave applications found.</td></tr>';
      } else {
        tbody.innerHTML = list.map(function(r) {
          var dateDisplay = r.fromDate === r.toDate ? fmtDate(r.fromDate) : (fmtDate(r.fromDate) + ' – ' + fmtDate(r.toDate));
          var statusBg = r.status === 'Approved' ? '#dcfce7' : r.status === 'Rejected' ? '#fee2e2' : r.status === 'Cancelled' ? '#f3f4f6' : '#fef3c7';
          var statusColor = r.status === 'Approved' ? '#166534' : r.status === 'Rejected' ? '#991b1b' : r.status === 'Cancelled' ? '#4b5563' : '#92400e';
          var statusBadge = '<span style="background:' + statusBg + ';color:' + statusColor + ';font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:8px;">' + r.status + '</span>';
          var canCancel = r.status === 'Pending';

          return '<tr>'
            + '<td style="font-size:11.5px;color:var(--tdi);">' + fmtDate(r.createdAt) + '</td>'
            + '<td><strong>' + (r.category === 'Permission' ? '⏱️ Permission' : '🌴 Leave') + '</strong><br><span style="font-size:11px;color:var(--tmu);">' + r.leaveType + '</span></td>'
            + '<td>' + dateDisplay + (r.slot && r.slot !== 'Full Day' ? ' <span style="font-size:10px;background:var(--gP);padding:1px 5px;border-radius:4px;">' + r.slot + '</span>' : '') + '</td>'
            + '<td><span style="font-weight:700;">' + (r.daysCount || (r.category === 'Permission' ? 0.5 : 1)) + '</span></td>'
            + '<td style="max-width:180px;white-space:normal;font-size:11.5px;color:var(--td);">' + r.reason + '</td>'
            + '<td>' + statusBadge + '</td>'
            + '<td style="font-size:11.5px;color:var(--tmu);">' + (r.reviewRemarks ? ('💬 ' + r.reviewRemarks) : (r.reviewedBy ? ('By ' + r.reviewedBy) : '—')) + '</td>'
            + '<td>' + (canCancel ? '<button class="btn-out bsm" onclick="cancelLeaveRequest(\'' + r._id + '\')" style="padding:3px 8px;font-size:10.5px;color:#dc2626;border-color:#fca5a5;">Cancel</button>' : '—') + '</td>'
            + '</tr>';
        }).join('');
      }
    }
  }).catch(function() {
    var tbody = document.getElementById('tbody-leave-history');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">Failed to load history.</td></tr>';
  });
}

function handleLeaveSubmit(e) {
  e.preventDefault();
  var submitBtn = document.getElementById('btn-submit-leave');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span>⏳ Submitting…</span>'; }

  var payload = {
    category: _leaveCategory,
    reason: document.getElementById('input-leave-reason').value
  };

  if (_leaveCategory === 'Leave') {
    payload.leaveType = document.getElementById('input-leave-type').value;
    payload.fromDate = document.getElementById('input-from-date').value;
    payload.toDate = document.getElementById('input-to-date').value;
    payload.slot = 'Full Day';
  } else {
    var pDate = document.getElementById('input-perm-date').value;
    var slot = document.getElementById('input-perm-slot').value;
    payload.leaveType = 'Half Day Permission (' + slot + ')';
    payload.fromDate = pDate;
    payload.toDate = pDate;
    payload.slot = slot;
    payload.periods = slot === 'FN' ? [1, 2, 3, 4] : [5, 6, 7, 8];
  }

  api('/api/leave/apply', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
  .then(function(res) {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<span>🚀 Submit Leave Request</span>'; }
    if (res.error) { toast(res.error, 'error'); return; }
    toast('🎉 Leave request sent to Class Advisor!', 'success');
    document.getElementById('input-leave-reason').value = '';
    loadLeaveData();
    fetchStudentNotifs();
  })
  .catch(function(err) {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<span>🚀 Submit Leave Request</span>'; }
    toast(err.message || 'Failed to submit request', 'error');
  });
}

function cancelLeaveRequest(id) {
  if (!confirm('Are you sure you want to cancel this leave request?')) return;
  api('/api/leave/cancel/' + id, { method: 'PUT' })
    .then(function(res) {
      if (res.error) { toast(res.error, 'error'); return; }
      toast('Leave request cancelled');
      loadLeaveData();
    })
    .catch(function(err) {
      toast(err.message || 'Error cancelling request', 'error');
    });
}

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
    var icon = isApproval ? '✅' : isRejection ? '❌' : '🔔';
    var bg = isApproval ? 'rgba(34,197,94,0.08)' : isRejection ? 'rgba(239,68,68,0.08)' : 'var(--gP)';
    var border = isApproval ? '#86efac' : isRejection ? '#fca5a5' : 'var(--brl)';
    return '<div style="padding:10px 14px;border-bottom:1px solid var(--brl);display:flex;gap:10px;align-items:flex-start;background:' + (n.read ? '#fff' : bg) + ';border-left:3px solid ' + border + ';">'
      + '<div style="font-size:16px;">' + icon + '</div>'
      + '<div style="flex:1;">'
      + '<div style="font-size:11.5px;font-weight:700;color:var(--td);">' + n.from + '</div>'
      + '<div style="font-size:11px;color:var(--tmu);margin-top:2px;line-height:1.4;">' + n.message + '</div>'
      + '<div style="font-size:10px;color:var(--tdi);margin-top:3px;">' + daysSince(n.time || n.createdAt) + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

function toggleStudentNotifs() {
  var drop = document.getElementById('st-ndrop');
  if (!drop) return;
  var isOpen = drop.style.display === 'block';
  drop.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) fetchStudentNotifs();
}

function clearStudentNotifs() {
  var unread = _studentNotifs.filter(function(n) { return !n.read; });
  var promises = unread.map(function(n) {
    return api('/api/notifications/' + n._id, { method: 'PUT', body: JSON.stringify({ read: true }) }, true);
  });
  Promise.all(promises).then(function() {
    fetchStudentNotifs();
  });
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
          + '<span style="font-size:24px;">✅</span>'
          + '<div style="flex:1;"><div style="font-size:13px;font-weight:700;color:#0f766e;">Attendance Marked</div><div style="font-size:11.5px;color:#115e59;margin-top:2px;">You have successfully marked your attendance for '+d.subjectName+'.</div></div>'
          + '</div>';
      } else {
        cont.innerHTML = '<div style="background:#fdf4ff;border:1.5px solid #f0abfc;border-radius:14px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:12px;">'
          + '<span style="font-size:24px;">📡</span>'
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
  fetch('/api/live-session/mark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sessionStorage.getItem('eams_token') },
    body: JSON.stringify({ sessionId: activeLiveSessionId, passcode: code })
  })
  .then(function(res){ return res.json(); })
  .then(function(d) {
    if (d.error) { dbToast(d.error, 'error'); return; }
    dbToast('Attendance Self-Marked!', 'success', 'Passcode verified');
    pollLiveSessionActive();
  })
  .catch(function(e){ dbToast('Error submitting passcode', 'error'); });
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
      if (title) title.textContent = '⚡ Quick Pass Attendance Active: ' + (d.session.subjectName || 'Current Lecture');
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
    err.textContent = '⚠️ Headcount (' + count + ') does not match marked present count (' + present + ').';
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

// Security
document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
document.addEventListener('keydown', function(e) {
  if (e.key==='F12'||(e.ctrlKey&&e.shiftKey&&['I','J','C'].includes(e.key))||(e.ctrlKey&&e.key==='U')) {
    e.preventDefault(); return false;
  }
});