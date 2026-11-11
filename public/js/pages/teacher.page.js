function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// State
var _memStore = {};
  const DB = {
    get: function(collection) {
      try { return _memStore['ss3_' + collection] || []; }
      catch (e) { return []; }
    },
    set: function(collection, data) {
      _memStore['ss3_' + collection] = data;
    },
    insert: function(collection, doc) {
      const rows = DB.get(collection);
      doc._id = '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      rows.push(doc);
      DB.set(collection, rows);
      return doc;
    },
    update: function(collection, id, updates) {
      const rows  = DB.get(collection);
      const index = rows.findIndex(function(row) { return row._id === id; });
      if (index >= 0) {
        rows[index] = Object.assign({}, rows[index], updates);
        DB.set(collection, rows);
        return rows[index];
      }
      return null;
    },
    delete: function(collection, id) {
      DB.set(collection, DB.get(collection).filter(function(row) { return row._id !== id; }));
    },
    one: function(collection, query) {
      query = query || {};
      return DB.get(collection).find(function(doc) {
        return Object.keys(query).every(function(key) { return doc[key] === query[key]; });
      }) || null;
    }
  };

  // DATE CONSTANTS
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Local-calendar YYYY-MM-DD. toISOString() is UTC, which in IST returns
  // *yesterday* between 00:00 and 05:30 and shifts every derived date range.
  function localISO(d) {
    if (typeof todayIST === 'function') return todayIST(d);
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function todayISO() {
    return (typeof todayIST === 'function') ? todayIST() : localISO(new Date());
  }

  // Bearer header for plain api() calls — the API authenticates by
  // Authorization header only (cookies are never sent/read).
  function isSafeHttpsUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      var parsed = new URL(url);
      return parsed.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }


  // ── SCHEDULE HEALTH STRIP & ROSTER LIVE JOINS (§8.2) ──
  var _activeRegisterTab = 'forensic';
  var _prevQuickPassTrackIds = new Set();

  function renderScheduleHealthStrip(dayData, targetDate) {
    var strip = document.getElementById('schedule-health-strip');
    if (!strip) return;

    var slots = (dayData && Array.isArray(dayData.slots)) ? dayData.slots : [];
    var isHoliday = dayData ? dayData.isHoliday : false;
    var holidayReason = dayData ? (dayData.holidayReason || 'Holiday') : '';
    var onLeave = dayData ? dayData.onLeave : false;
    var leaveSlot = dayData ? (dayData.leaveSlot || 'Full Day') : '';

    var subInCount = 0;
    var subOutCount = 0;
    var roomChanges = [];
    var markedCount = 0;
    var allAttendance = (typeof DB !== 'undefined' && DB.get) ? DB.get('attendance') : null;
    var dateISO = targetDate || todayISO();

    slots.forEach(function(s) {
      if (s.role === 'substitute') subInCount++;
      if (s.status === 'substituted') subOutCount++;
      if (s.room && s.originalRoom && s.room !== s.originalRoom) {
        roomChanges.push(s);
      }
      var isMarked = (s.attendance && s.attendance.marked) || (typeof isSlotMarked === 'function' && isSlotMarked(s, dateISO, allAttendance));
      if (isMarked) markedCount++;
    });

    var pills = [];
    pills.push('<div class="sh-label"><re-icon icon="activity" size="13"></re-icon> Schedule Health:</div>');

    if (isHoliday) {
      pills.push('<div class="sh-pill sh-pill-holiday"><re-icon icon="sun" size="13"></re-icon> ' + escapeHtml(holidayReason || 'Holiday') + '</div>');
    }
    if (onLeave) {
      pills.push('<div class="sh-pill sh-pill-leave"><re-icon icon="tree" size="13"></re-icon> On Leave (' + escapeHtml(leaveSlot) + ')</div>');
    }
    if (subInCount > 0) {
      pills.push('<div class="sh-pill sh-pill-sub-in"><re-icon icon="repeat" size="13"></re-icon> Substitute Covering (' + subInCount + ' slot' + (subInCount > 1 ? 's' : '') + ')</div>');
    }
    if (subOutCount > 0) {
      pills.push('<div class="sh-pill sh-pill-sub-out"><re-icon icon="arrow-right" size="13"></re-icon> Covered by Colleague (' + subOutCount + ')</div>');
    }
    if (roomChanges.length > 0) {
      pills.push('<div class="sh-pill sh-pill-room"><re-icon icon="map-pin" size="13"></re-icon> Room Change (' + escapeHtml(roomChanges[0].room) + ')</div>');
    }

    if (!isHoliday && !onLeave) {
      if (slots.length > 0) {
        pills.push('<div class="sh-pill sh-pill-optimal"><re-icon icon="clipboard-check" size="13"></re-icon> ' + markedCount + '/' + slots.length + ' Slots Marked</div>');
        if (subInCount === 0 && subOutCount === 0 && roomChanges.length === 0) {
          pills.push('<div class="sh-pill sh-pill-optimal"><re-icon icon="check" size="13"></re-icon> All Slots Regular &amp; Active</div>');
        }
      } else {
        pills.push('<div class="sh-pill sh-pill-optimal"><re-icon icon="calendar" size="13"></re-icon> No Scheduled Teaching Slots</div>');
      }
    }

    strip.innerHTML = pills.join('');
    strip.style.display = 'flex';
  }
  window.renderScheduleHealthStrip = renderScheduleHealthStrip;

  function toggleRoleToolsGroup() {
    var sub = document.getElementById('sb-sub-role-tools');
    var chevron = document.getElementById('sb-role-chevron');
    if (!sub) return;
    var isHidden = sub.style.display === 'none';
    sub.style.display = isHidden ? 'block' : 'none';
    if (chevron) chevron.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
  }
  window.toggleRoleToolsGroup = toggleRoleToolsGroup;

  // ── LIVE FACULTY LEAVE POLICY METER (§8.2) ──
  function updateLeavePolicyMeter() {
    var meterWrap = document.getElementById('tl-policy-meter');
    if (!meterWrap) return;

    var fromVal = document.getElementById('tl-from') ? document.getElementById('tl-from').value : '';
    var toVal = document.getElementById('tl-to') ? document.getElementById('tl-to').value : fromVal;
    var catVal = document.getElementById('tl-cat') ? document.getElementById('tl-cat').value : 'Leave';
    var typeVal = document.getElementById('tl-type') ? document.getElementById('tl-type').value : '';
    var slotVal = document.getElementById('tl-slot') ? document.getElementById('tl-slot').value : 'Full Day';

    var pol = (window._portalPolicy && window._portalPolicy.teachersPolicy) || {};
    var maxConsec = Number(pol.maxConsecutiveLeaveDays ?? 3);
    var medDocThresh = Number(pol.medicalDocThresholdDays ?? 3);

    var days = 1;
    if (fromVal && toVal) {
      var d1 = new Date(fromVal);
      var d2 = new Date(toVal);
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
        var diffMs = d2.getTime() - d1.getTime();
        days = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1);
      }
    }
    if (slotVal === 'FN' || slotVal === 'AN') {
      days = days * 0.5;
    }

    var labelEl = document.getElementById('pm-consec-label');
    if (labelEl) labelEl.textContent = days + ' / ' + maxConsec + ' Days Consecutive Allowed';

    var fillEl = document.getElementById('pm-bar-fill');
    if (fillEl) {
      var pct = Math.min(100, Math.round((days / maxConsec) * 100));
      fillEl.style.width = pct + '%';
      fillEl.className = 'pm-bar-fill ' + (days > maxConsec ? 'exceed' : (days === maxConsec ? 'warn' : 'safe'));
    }

    var noticeEl = document.getElementById('pm-notice');
    if (noticeEl) {
      if (days > maxConsec) {
        noticeEl.className = 'pm-notice warn';
        noticeEl.innerHTML = '<re-icon icon="alert-triangle" size="13"></re-icon> Exceeds standard ' + maxConsec + '-day consecutive quota. Special escalation to HoD &amp; Principal required.';
        noticeEl.style.display = 'flex';
      } else if ((catVal === 'Medical Leave' || typeVal.includes('Medical')) && days >= medDocThresh) {
        noticeEl.className = 'pm-notice info';
        noticeEl.innerHTML = '<re-icon icon="file-text" size="13"></re-icon> Medical Certificate documentation is required for requests of ' + medDocThresh + '+ days.';
        noticeEl.style.display = 'flex';
      } else {
        noticeEl.style.display = 'none';
      }
    }
    meterWrap.style.display = 'flex';
  }
  window.updateLeavePolicyMeter = updateLeavePolicyMeter;

  function onTeacherLeaveDatesChanged() {
    var fromEl = document.getElementById('tl-from');
    var toEl = document.getElementById('tl-to');
    if (fromEl && toEl) {
      if (fromEl.value) {
        toEl.min = fromEl.value;
        if (toEl.value && toEl.value < fromEl.value) {
          toEl.value = fromEl.value;
        }
      }
    }
    if (typeof fetchTeacherAffectedSlots === 'function') fetchTeacherAffectedSlots();
    updateLeavePolicyMeter();
  }
  window.onTeacherLeaveDatesChanged = onTeacherLeaveDatesChanged;

  function onTeacherEmergencyToggled() {
    var emEl = document.getElementById('tl-emergency');
    var fromEl = document.getElementById('tl-from');
    if (emEl && fromEl) {
      if (emEl.checked) {
        fromEl.removeAttribute('min');
      } else {
        fromEl.min = localISO(new Date());
        if (fromEl.value && fromEl.value < fromEl.min) {
          fromEl.value = fromEl.min;
          onTeacherLeaveDatesChanged();
        }
      }
    }
  }
  window.onTeacherEmergencyToggled = onTeacherEmergencyToggled;

  function onTeacherLeaveSlotChanged() {
    if (typeof fetchTeacherAffectedSlots === 'function') fetchTeacherAffectedSlots();
    updateLeavePolicyMeter();
  }
  window.onTeacherLeaveSlotChanged = onTeacherLeaveSlotChanged;

  function onTeacherLeaveTypeChanged() {
    updateLeavePolicyMeter();
  }
  window.onTeacherLeaveTypeChanged = onTeacherLeaveTypeChanged;

  // ── FORENSIC CLASS REGISTER & ROSTER TABS (§8.2) ──
  function switchRegisterTab(mode) {
    _activeRegisterTab = mode || 'forensic';
    var tF = document.getElementById('tab-reg-forensic');
    var tR = document.getElementById('tab-reg-roster');
    var summary = document.getElementById('register-summary-strip');

    if (tF) tF.classList.toggle('act', _activeRegisterTab === 'forensic');
    if (tR) tR.classList.toggle('act', _activeRegisterTab === 'roster');
    if (summary) summary.style.display = _activeRegisterTab === 'forensic' ? 'grid' : 'none';

    var thead = document.getElementById('reg-thead');
    if (thead) {
      if (_activeRegisterTab === 'forensic') {
        thead.innerHTML = '<tr><th>#</th><th>Reg No</th><th>Student Name</th><th>Roll No</th><th>Class</th><th style="text-align:center;">Total Periods</th><th style="text-align:center;">Attended</th><th style="text-align:center;">Attendance %</th><th style="text-align:center;">Status</th></tr>';
      } else {
        thead.innerHTML = '<tr><th>#</th><th>Reg No</th><th>Name</th><th>Class</th><th>Section</th><th>Department</th></tr>';
      }
    }
    renderStudentList();
  }
  window.switchRegisterTab = switchRegisterTab;

  function exportClassRegisterCSV() {
    var classFilter = document.getElementById('slc') ? document.getElementById('slc').value : '';
    var myClassIds  = classFilter ? [classFilter] : getMyClasses().map(function(c) { return c.id; });
    var students = (typeof DB !== 'undefined' && DB.get) ? DB.get('students').filter(function(s) { return myClassIds.includes(s.classId); }) : [];
    var allAttendance = (typeof DB !== 'undefined' && DB.get) ? (DB.get('attendance') || []) : [];
    var minAtt = (window._portalPolicy && window._portalPolicy.thresholds && window._portalPolicy.thresholds.minAttendance) || 75;
    var lowAtt = (window._portalPolicy && window._portalPolicy.thresholds && window._portalPolicy.thresholds.low) || 65;

    var rows = [['#', 'Register No', 'Student Name', 'Roll No', 'Class', 'Total Periods', 'Attended Periods', 'Attendance Percentage', 'Status Category']];

    students.forEach(function(s, idx) {
      var sId = String(s._id || s.id || '');
      var sTrack = String(s.trackId || '');
      var sReg = String(s.regNo || s.registerNo || '');

      var stuRecords = allAttendance.filter(function(a) {
        return (a.studentId && String(a.studentId) === sId) ||
               (a.studentTrackId && String(a.studentTrackId) === sTrack) ||
               (a.regNo && String(a.regNo) === sReg);
      });

      var total = stuRecords.length;
      var present = stuRecords.filter(function(a) { return String(a.status || '').toLowerCase() === 'present'; }).length;
      var pct = total > 0 ? Math.round((present / total) * 100) : 100;
      var status = pct >= minAtt ? 'Safe' : (pct >= lowAtt ? 'Condonation Band' : 'Defaulter');

      rows.push([
        idx + 1,
        sReg,
        s.name || s.fullName || '—',
        s.rollNo || '—',
        s.className || '—',
        total,
        present,
        pct + '%',
        status
      ]);
    });

    downloadCSV(rows, 'Class_Register_' + (classFilter || 'All_Classes'));
    if (typeof dbToast === 'function') dbToast('<re-icon icon="download"></re-icon> Forensic Class Register exported!', 'success');
    else showToast('Register CSV exported!', 'success');
  }
  window.exportClassRegisterCSV = exportClassRegisterCSV;

  function authHeaders(extra) {
    return Object.assign({ 'Authorization': 'Bearer ' + getToken() }, extra || {});
  }

  function parseDateSafe(val) {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    if (typeof val === 'number') return new Date(val);
    var s = String(val).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  
  function formatDDMMYYYY(val) {
    if (!val) return '—';
    if (typeof val === 'string') {
      var m = val.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return m[3] + '-' + m[2] + '-' + m[1];
      if (/^\d{2}-\d{2}-\d{4}$/.test(val.trim())) return val.trim();
    }
    var d = parseDateSafe(val);
    if (!d || isNaN(d.getTime())) return String(val);
    var day = String(d.getDate()).padStart(2, '0');
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var year = d.getFullYear();
    return day + '-' + month + '-' + year;
  }

  function formatDateLong(isoDate) {
    var d = parseDateSafe(isoDate);
    return formatDDMMYYYY(isoDate);
  }

  function formatDateShort(isoDate) {
    var d = parseDateSafe(isoDate);
    return formatDDMMYYYY(isoDate);
  }

  function timeAgo(isoDate) {
    if (!isoDate) return 'just now';
    const d = new Date(isoDate);
    const ts = d.getTime();
    if (isNaN(ts)) return 'just now';
    const diffSeconds = Math.floor((Date.now() - ts) / 1000);
    if (diffSeconds < 0 || diffSeconds < 60) return 'just now';
    if (diffSeconds < 3600) return Math.floor(diffSeconds / 60) + 'm ago';
    if (diffSeconds < 86400) return Math.floor(diffSeconds / 3600) + 'h ago';
    const days = Math.floor(diffSeconds / 86400);
    if (days === 1) return '1d ago';
    if (days < 30) return days + 'd ago';
    if (days < 365) return Math.floor(days / 30) + 'mo ago';
    return Math.floor(days / 365) + 'y ago';
  }

  function showToast(msg, state, details) {
    if (typeof dbToast === 'function') {
      // 'info' used to map to 'saving' (spinner that never auto-closes) and
      // 'danger'/'warning' fell through to green 'success'.
      var s = (state === 'error' || state === 'danger') ? 'error'
            : (state === 'warn' || state === 'warning') ? 'warn'
            : state === 'info' ? 'info'
            : state === 'saving' ? 'saving'
            : 'success';
      dbToast(msg, s, details);
    }
  }

  // SEED / INITIAL DATA
  function ensureDB() {
    // No default seeding — data comes from admin uploads
  }

  // AUTHENTICATION
  let currentUser = null;
  function logToServer(action, details, category) {
    var tok = getToken();
    if (!tok) return;
    api('/api/logs', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},
      body: JSON.stringify({ action:action, details:details||'', category:category||'general', role:'teacher' })
    }).catch(function(){});
  }

  // Session inactivity and auto-logout are managed centrally by js/core/session.js

  function toggleSidebar() {
    const sidebar      = document.getElementById('sidebar');
    const mainContent  = document.getElementById('maincontent');
    const toggleButton = document.getElementById('sbtoggle');
    const overlay      = document.getElementById('sb-overlay-t');
    const isMobile     = window.innerWidth <= 768;

    if (isMobile) {
      const isOpen = sidebar.classList.toggle('sb-mobile-open');
      if (overlay) overlay.classList.toggle('visible', isOpen);
      toggleButton.innerHTML = isOpen ? '<re-icon icon="x"></re-icon>' : '<re-icon icon="menu"></re-icon>';
    } else {
      const isHidden = sidebar.classList.toggle('sb-hidden');
      mainContent.classList.toggle('sb-expanded', isHidden);
      toggleButton.classList.toggle('closed', isHidden);
      toggleButton.innerHTML = isHidden ? '<re-icon icon="menu"></re-icon>' : '<re-icon icon="x"></re-icon>';
    }
  }

  function goToTimetable() {
    // eams_user + eams_token already in sessionStorage — timetable.html reads them
    window.location.href = 'timetable.html?tab=dashboard';
  }

  // LIVE PROFILE & ASSIGNMENT SYNC
  // currentUser (set at login from sessionStorage) only ever carried _id/name/
  // username/role — dept/empId/desig/email/specials were never fetched, and
  // nothing in this file called /api/assignments either. That's why My Profile
  // and "Assigned Classes" were always empty: there was no code path that could
  // have populated them, regardless of what's actually in the Database.
  function syncMyProfile() {
    var tok = getToken();
    if (!tok) return Promise.resolve(null);
    return api('/api/profile/me', { headers: { 'Authorization': 'Bearer ' + tok } })
      .then(function(r) { return r.json(); })
      .then(function(p) {
        if (!p || p.error) return null;
        currentUser = Object.assign({}, currentUser, {
          _id: p._id || currentUser._id,
          name: p.name || currentUser.name,
          username: p.username || currentUser.username,
          empId: p.employeeNo || '',
          dept: p.department || '',
          deptId: p.deptId || currentUser.deptId || null,
          deptCode: p.deptCode || currentUser.deptCode || '',
          desig: p.designation || '',
          email: p.email || '',
          isHOD: !!p.isHod,
          HoddeptName: p.HoddeptName || '',
          isClassAdvisor: !!p.isClassAdvisor,
          advisorClassName: p.className || '',
          isTimeTableCoordinator: !!p.isTimeTableCoordinator,
          TTdeptName: p.TTdeptName || '',
          isWarden: !!p.isWarden,
          isExamCoordinator: !!p.isExamCoordinator,
          isPlacementCoordinator: !!p.isPlacementCoordinator,
          isSudoAdmin: !!p.isSudoAdmin,
          isSuperAdmin: !!p.isSuperAdmin,
          isSubAdmin: !!p.isSubAdmin,
          pageRights: Array.isArray(p.pageRights) ? p.pageRights : [],
          // Previously dropped — the saved "default attendance status"
          // preference was ignored after every reload.
          specials: Array.isArray(p.specials) ? p.specials : (currentUser.specials || []),
          preferences: p.preferences || currentUser.preferences || { defaultAttendanceStatus: 'Present' }
        });
        sessionStorage.setItem('eams_user', JSON.stringify(currentUser));
        syncAdvisorClassUI();

        // Refresh the bits of chrome that were drawn with stale/blank values
        // before this fetch resolved.
        var deptEl = document.getElementById('tpdept');
        if (deptEl) deptEl.textContent = currentUser.dept || 'Faculty';
        var isTTC = !!(currentUser.isTimeTableCoordinator || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s.option === 'isTimeTableCoordinator'; })));
        var ttBtn = document.getElementById('sn-tt');
        if (ttBtn) ttBtn.style.display = isTTC ? 'flex' : 'none';
        var badge = document.getElementById('sn-tt-badge');
        if (badge) badge.style.display = isTTC ? 'inline-block' : 'none';
        var isHodOrPrincipal = !!(currentUser.isHOD || currentUser.isHod || currentUser.isPrincipal || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s && (s.option === 'isHod' || s.option === 'isPrincipal') && s.value !== false; })));
        var isTTC = !!(currentUser.isTimeTableCoordinator || currentUser.isTTC || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s && s.option === 'isTimeTableCoordinator' && s.value !== false; })));
        var hasAdminPrivileges = !!(currentUser.isSudoAdmin || currentUser.isSuperAdmin || currentUser.isSubAdmin || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s && s.option === 'isAdmin' && s.value !== false; })));
        var hasRoleTools = isTTC || isHodOrPrincipal || hasAdminPrivileges;
        var roleGrp = document.getElementById('sb-group-role-tools');
        if (roleGrp) roleGrp.style.display = hasRoleTools ? 'block' : 'none';
        var ttNavBtn = document.getElementById('sn-timetable');
        if (ttNavBtn) ttNavBtn.style.display = (isTTC || isHodOrPrincipal || hasAdminPrivileges) ? 'flex' : 'none';
        var stuNavBtn = document.getElementById('sn-students');
        if (stuNavBtn) stuNavBtn.style.display = (isHodOrPrincipal || hasAdminPrivileges) ? 'flex' : 'none';
        var wlBtn = document.getElementById('sn-fac-workload');
        if (wlBtn) {
          wlBtn.style.display = isHodOrPrincipal ? 'flex' : 'none';
          var wlBadge = document.getElementById('sn-workload-badge');
          if (wlBadge) wlBadge.textContent = currentUser.isPrincipal ? 'PRINCIPAL' : 'HOD';
        }
        var ctrlBtn = document.getElementById('sn-controller');
        if (ctrlBtn) {
          ctrlBtn.style.display = isHodOrPrincipal ? 'flex' : 'none';
          var ctrlBadge = document.getElementById('sn-controller-badge');
          if (ctrlBadge) ctrlBadge.textContent = currentUser.isPrincipal ? 'PRINCIPAL' : 'HOD';
        }
        var hasAdminPrivileges = currentUser.isSudoAdmin || currentUser.isSuperAdmin || currentUser.isSubAdmin || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s && s.option === 'isAdmin' && s.value !== false; }));
        var ttVerifyBtn = document.getElementById('sn-tt-verify');
        if (ttVerifyBtn) {
          ttVerifyBtn.style.display = (isHodOrPrincipal || hasAdminPrivileges) ? 'flex' : 'none';
        }
        if (isHodOrPrincipal || hasAdminPrivileges) {
          updateHodTtVerificationBadge();
          if (typeof updateStudentListSubtitle === 'function') updateStudentListSubtitle();
          if (isHodOrPrincipal && typeof ensureWorkloadAssets === 'function') ensureWorkloadAssets();
        }
        if (hasAdminPrivileges) {
          var adminHubBtn = document.getElementById('sn-admin-hub');
          if (adminHubBtn) adminHubBtn.style.display = 'flex';
        }
        return currentUser;
      }).catch(function() { return null; });
  }

  function syncMyAssignments() {
    var tok = getToken();
    if (!tok) return Promise.resolve([]);
    // No query params needed — /api/assignments filters to the logged-in
    // teacher's own records server-side (req.user._id), same id as currentUser._id.
    return api('/api/assignments', { headers: { 'Authorization': 'Bearer ' + tok } })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var rows = Array.isArray(data) ? data : [];
        DB.set('assignments', rows);
        return rows;
      }).catch(function() { return []; });
  }

  // syncMyStudents
  // Fetches /api/students?classId=X for every class in the teacher's assignments
  // and stores the deduplicated result in the render cache (DB). Called after
  // syncMyAssignments() has populated DB.get('assignments').
  function syncMyStudents() {
    var tok = getToken();
    if (!tok) return Promise.resolve([]);
    return api('/api/teacher/me/roster', {
      headers: authHeaders()
    })
    .then(function(r) {
      if (r.status === 304) {
        return { ok: true, data: { students: DB.get('students') || [] } };
      }
      return r.ok ? r.json() : null;
    })
    .then(function(res) {
      if (res && res.ok && res.data) {
        var d = res.data;
        if (Array.isArray(d.students)) {
          DB.set('students', d.students);
        }
        if (Array.isArray(d.classes) && d.classes.length) {
          DB.set('all-classes', d.classes);
        }
        if (Array.isArray(d.subjects) && d.subjects.length) {
          DB.set('all-subjects', d.subjects);
        }
        if (Array.isArray(d.todaySlots)) {
          DB.set('today-slots', d.todaySlots);
        }
        return d.students || [];
      }
      return DB.get('students') || [];
    })
    .catch(function(err) {
      console.warn('[syncMyStudents] roster fetch failed, fallback to cache:', err);
      return DB.get('students') || [];
    });
  }

  // syncMyAttendance
  // Fetches the last 90 days of this teacher's attendance from /api/attendance
  // and stores it in the render cache for the dashboard chart, defaulters mini
  // Fetches the last 90 days of this teacher's attendance from /api/attendance
  // and stores it in the render cache for the dashboard chart, defaulters mini
  // widget, and today's schedule "already marked" check.
  // Report pages (renderAttendanceRecord, renderDefaultersList) call
  // fetchAttendanceForReport() independently so they can honour arbitrary filters.
  function syncMyAttendance() {
    var tok = getToken();
    if (!tok) return Promise.resolve([]);
    var to = todayISO();
    var from90 = new Date();
    from90.setDate(from90.getDate() - 90);
    var from = localISO(from90);
    // limit=0 <re-icon icon="arrow-right"></re-icon> unpaginated. The endpoint defaults to 50 rows, which silently
    // truncated the dashboard chart, defaulters and "already marked" checks.
    return api(
      '/api/attendance?teacherId=' + encodeURIComponent(currentUser._id)
        + '&from=' + from + '&to=' + to + '&limit=0',
      { headers: { 'Authorization': 'Bearer ' + tok } }
    )
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(data) {
      var rows = Array.isArray(data) ? data : [];
      DB.set('attendance', rows);
      return rows;
    })
    .catch(function() { return []; });
  }

  // fetchAttendanceForReport
  function fetchAttendanceForReport(classId, subjectId, from, to) {
    var tok = getToken();
    if (!tok) return Promise.resolve([]);
    var url = '/api/attendance?teacherId=' + encodeURIComponent(currentUser._id) + '&limit=0';
    if (classId) url += '&classId=' + encodeURIComponent(classId);
    if (from && to) url += '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    return api(url, { headers: { 'Authorization': 'Bearer ' + tok } })
      .then(function(r) { return r.ok ? r.json() : []; })
      .then(function(data) { return Array.isArray(data) ? data : []; })
      .catch(function() { return []; });
  }

  // ── Production Timetable Synchronization (Phase 3) ──
  // Fetches this teacher's canonical weekly template and 14-day resolved schedule
  function syncMySchedule(weekOffsetDays) {
    var tok = getToken();
    if (!tok) return Promise.resolve({ template: [], days: {} });

    // 1) Fetch canonical weekly template: GET /api/timetable/my-timetable
    var pTemplate = api('/api/timetable/my-timetable', {
      headers: authHeaders()
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(res) {
      if (res && res.ok && res.data) {
        var rows = (res.data.slots || []).map(normalizeScheduleSlot);
        DB.set('timetable', rows);
        if (Array.isArray(res.data.timingSets)) {
          DB.set('timing-sets', res.data.timingSets);
          populatePeriodOptions('attperiod');
        }
        return rows;
      }
      return DB.get('timetable') || [];
    })
    .catch(function() { return DB.get('timetable') || []; });

    // 2) Fetch resolved schedule range around the given week offset: GET /api/timetable/my-schedule?from=...&to=...
    var _tParts = todayISO().split('-').map(Number);
    var today = new Date(_tParts[0], _tParts[1] - 1, _tParts[2]);
    var monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var diffToMon = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - diffToMon + (weekOffsetDays || 0));

    var fromDate = new Date(monday);
    var toDate = new Date(monday);
    toDate.setDate(toDate.getDate() + 13); // 14-day window (inclusive)
    var fromStr = localISO(fromDate);
    var toStr = localISO(toDate);

    var pSchedule = api('/api/timetable/my-schedule?from=' + encodeURIComponent(fromStr) + '&to=' + encodeURIComponent(toStr), {
      headers: authHeaders()
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(res) {
      if (res && res.ok && res.data && Array.isArray(res.data.days)) {
        var existing = DB.get('schedule-days') || {};
        res.data.days.forEach(function(dayObj) {
          if (dayObj && dayObj.date) {
            existing[dayObj.date] = dayObj;
          }
        });
        DB.set('schedule-days', existing);
        return existing;
      }
      return DB.get('schedule-days') || {};
    })
    .catch(function() { return DB.get('schedule-days') || {}; });

    return Promise.all([pTemplate, pSchedule]).then(function(results) {
      // Check for today's substitute duties notice on first load of the day
      try {
        var todayKey = todayISO();
        var todayDay = (results[1] && results[1][todayKey]) || null;
        if (todayDay && Array.isArray(todayDay.slots)) {
          var subDuties = todayDay.slots.filter(function(s) {
            return s.role === 'substitute' && s.status === 'scheduled';
          });
          if (subDuties.length > 0) {
            var dutyNoticeKey = 'eams_sub_duty_notice_' + todayKey;
            if (!sessionStorage.getItem(dutyNoticeKey)) {
              sessionStorage.setItem(dutyNoticeKey, '1');
              var d0 = subDuties[0];
              var orig = d0.originalTeacher || 'Faculty';
              var msg = "You're substituting for " + orig + " in P" + d0.periodNumber + " · " + (d0.className || 'Class') + " today";
              if (typeof showToast === 'function') {
                showToast(msg, 'info');
              }
            }
          }
        }
      } catch (e) {}

      try {
        if (typeof renderTodaySchedule === 'function') renderTodaySchedule(todayISO());
        if (typeof renderTodayClassesChips === 'function') renderTodayClassesChips();
      } catch (e) {}

      return { template: results[0], days: results[1] };
    });
  }

  // Alias for backward compatibility
  var syncMyTimetable = syncMySchedule;

  // Retrieve cached resolved schedule day or trigger on-demand fetch
  function getMyDay(dateISO) {
    if (!dateISO) return null;
    var cached = DB.get('schedule-days') || {};
    if (cached[dateISO]) return cached[dateISO];

    if (!getMyDay._inFlight) getMyDay._inFlight = {};
    if (!getMyDay._inFlight[dateISO]) {
      var tok = getToken();
      if (tok) {
        getMyDay._inFlight[dateISO] = true;
        api('/api/timetable/my-schedule?from=' + encodeURIComponent(dateISO) + '&to=' + encodeURIComponent(dateISO), {
          headers: authHeaders()
        })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(res) {
          delete getMyDay._inFlight[dateISO];
          var cur = DB.get('schedule-days') || {};
          if (res && res.ok && res.data && Array.isArray(res.data.days)) {
            var dayDoc = res.data.days[0] || { date: dateISO, slots: [] };
            cur[dateISO] = dayDoc;
            DB.set('schedule-days', cur);
            if (dateISO === todayISO()) {
              renderTodaySchedule(todayISO());
              renderTodayClassesChips();
            }
            if (currentSchedTab === 'week') renderSchedulePage();
            else if (currentSchedTab === 'day') renderDayView();
          } else {
            cur[dateISO] = { date: dateISO, slots: [] };
            DB.set('schedule-days', cur);
            if (dateISO === todayISO()) {
              renderTodaySchedule(todayISO());
            }
          }
        })
        .catch(function() {
          delete getMyDay._inFlight[dateISO];
          var cur = DB.get('schedule-days') || {};
          if (!cur[dateISO]) {
            cur[dateISO] = { date: dateISO, slots: [] };
            DB.set('schedule-days', cur);
            if (dateISO === todayISO()) {
              renderTodaySchedule(todayISO());
            }
          }
        });
      }
    }

    return null;
  }

  function populatePeriodOptions(selectId) {
    var el = document.getElementById(selectId);
    if (!el) return;
    var sets = DB.get('timing-sets') || [];
    var primary = sets[0] || null;
    var periods = (primary && Array.isArray(primary.periods) && primary.periods.length)
      ? primary.periods
      : TEACHER_PERIODS.filter(function(p) { return !p.isBreak; });

    var curVal = el.value;
    var html = periods.map(function(p) {
      var pNum = p.periodNumber || p.number || p.num;
      var timeStr = (p.start && p.end) ? ' (' + p.start + '–' + p.end + ')' : '';
      return '<option value="' + pNum + '">Period ' + pNum + timeStr + '</option>';
    }).join('');
    el.innerHTML = html;
    if (curVal) el.value = curVal;
  }

  // Normalizes schedule slot properties across weekly template and daily resolver
  function normalizeScheduleSlot(t) {
    if (!t) return t;
    var slot = Object.assign({}, t);
    slot._id = slot._id || slot.key || ((slot.dayFull || slot.day || 'Mon') + '_' + (slot.periodNumber || 1));
    slot.start = slot.start || '';
    slot.end   = slot.end   || '';
    slot.periodNumber = slot.periodNumber || (slot.start ? periodFromStartTime(slot.start) : 1);
    slot.hallNo = slot.hallNo || slot.room || '';
    slot.className = slot.className || '';
    slot.subjectName = slot.subjectName || slot.subject || '';
    slot.span = Number(slot.span || 1);
    slot.day = slot.day || (slot.dayFull ? slot.dayFull.slice(0, 3) : 'Mon');
    slot.dayFull = slot.dayFull || 'Monday';
    slot.role = slot.role || 'owner';
    slot.status = slot.status || 'scheduled';
    slot.isLab = Boolean(slot.isLab || slot.type === 'Lab');
    if (!slot.timingSetCode) {
      var cName = String(slot.className || '').toUpperCase();
      if (/\b(II|III|2ND|3RD|Y2|Y3|YEAR\s*[23]|SEM\s*[3456]|25-29|24-28)\b/i.test(cName)) {
        slot.timingSetCode = 'SET_2';
      } else if (/\b(I|IV|1ST|4TH|Y1|Y4|YEAR\s*[14]|SEM\s*[1278]|26-30|23-27)\b/i.test(cName)) {
        slot.timingSetCode = 'SET_1';
      }
    }
    return slot;
  }

  function periodFromStartTime(start) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(start || ''));
    if (!m) return null;
    var mins = Number(m[1]) * 60 + Number(m[2]);
    var best = null, bestDiff = 16;
    TEACHER_PERIODS.forEach(function(p) {
      if (p.isBreak) return;
      var pm = p.start.split(':');
      var diff = Math.abs(Number(pm[0]) * 60 + Number(pm[1]) - mins);
      if (diff < bestDiff) { bestDiff = diff; best = p.num; }
    });
    return best;
  }

  function getMyTimetable() {
    return (DB.get('timetable') || []).filter(function(t) { return t && t.day; });
  }

  function bySlotStart(a, b) {
    return String(a.start || '').localeCompare(String(b.start || ''));
  }

  function bootApp() {
    document.getElementById('app').classList.add('vis');
    if (typeof flushToastQueue === 'function') flushToastQueue();
    else if (typeof _loaderActive !== 'undefined') _loaderActive = false;
    // Sidebar starts hidden on phones — the toggle must show <re-icon icon="menu"></re-icon>, not <re-icon icon="x"></re-icon>.
    var sbToggle = document.getElementById('sbtoggle');
    if (sbToggle && window.innerWidth <= 768) sbToggle.innerHTML = '<re-icon icon="menu"></re-icon>';
    document.getElementById('tpav').textContent    = (currentUser.name || 'T')[0];
    document.getElementById('tpname').textContent  = currentUser.name || 'Teacher';
    document.getElementById('tpdept').textContent  = currentUser.dept || 'Faculty';
    document.getElementById('datelbl').textContent =
      new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    var isTTC = !!(currentUser.isTimeTableCoordinator || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s.option === 'isTimeTableCoordinator'; })));
    var ttBtn = document.getElementById('sn-tt');
    if (ttBtn) ttBtn.style.display = isTTC ? 'flex' : 'none';
    var badge = document.getElementById('sn-tt-badge');
    if (badge) badge.style.display = isTTC ? 'inline-block' : 'none';
    var isHodOrPrincipal = !!(currentUser.isHOD || currentUser.isHod || currentUser.isPrincipal || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s && (s.option === 'isHod' || s.option === 'isPrincipal') && s.value !== false; })));
    var wlBtn = document.getElementById('sn-fac-workload');
    if (wlBtn) {
      wlBtn.style.display = isHodOrPrincipal ? 'flex' : 'none';
      var wlBadge = document.getElementById('sn-workload-badge');
      if (wlBadge) wlBadge.textContent = currentUser.isPrincipal ? 'PRINCIPAL' : 'HOD';
    }
    var ctrlBtn = document.getElementById('sn-controller');
    if (ctrlBtn) {
      ctrlBtn.style.display = isHodOrPrincipal ? 'flex' : 'none';
      var ctrlBadge = document.getElementById('sn-controller-badge');
      if (ctrlBadge) ctrlBadge.textContent = currentUser.isPrincipal ? 'PRINCIPAL' : 'HOD';
    }
    var hasRoleTools = isTTC || isHodOrPrincipal || hasAdminPrivileges;
    var roleGrp = document.getElementById('sb-group-role-tools');
    if (roleGrp) roleGrp.style.display = hasRoleTools ? 'block' : 'none';
    var ttNavBtn = document.getElementById('sn-timetable');
    if (ttNavBtn) ttNavBtn.style.display = (isTTC || isHodOrPrincipal || hasAdminPrivileges) ? 'flex' : 'none';
    var stuNavBtn = document.getElementById('sn-students');
    if (stuNavBtn) stuNavBtn.style.display = (isHodOrPrincipal || hasAdminPrivileges) ? 'flex' : 'none';
    var adminHubBtn = document.getElementById('sn-admin-hub');
    if (adminHubBtn) adminHubBtn.style.display = hasAdminPrivileges ? 'flex' : 'none';
    var hasAdminPrivileges = currentUser.isSudoAdmin || currentUser.isSuperAdmin || currentUser.isSubAdmin || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s && s.option === 'isAdmin' && s.value !== false; }));
    var ttVerifyBtn = document.getElementById('sn-tt-verify');
    if (ttVerifyBtn) {
      ttVerifyBtn.style.display = (isHodOrPrincipal || hasAdminPrivileges) ? 'flex' : 'none';
    }
    if (isHodOrPrincipal || hasAdminPrivileges) {
      updateHodTtVerificationBadge();
    }
    var coordEditBtn = document.getElementById('btn-coord-edit-tt');
    if (coordEditBtn) coordEditBtn.style.display = isTTC ? 'inline-flex' : 'none';
    populateAllFilters();
    initCalendar();
    renderNotifications();
    syncTeacherNotifications();
    var _notifInterval = null;
    function startNotifPolling() {
      if (_notifInterval) clearInterval(_notifInterval);
      _notifInterval = setInterval(function() {
        if (!document.hidden) {
          syncTeacherNotifications();
        }
      }, 30000);
    }
    startNotifPolling();
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        syncTeacherNotifications();
        startNotifPolling();
        if (typeof HardOverduePrompt !== 'undefined' && typeof HardOverduePrompt.checkOverdue === 'function') {
          HardOverduePrompt.checkOverdue();
        }
        if (typeof activeQuickPassSessionId !== 'undefined' && activeQuickPassSessionId && typeof pollQuickPassStatus === 'function') {
          pollQuickPassStatus();
        }
        if (typeof activeLiveSessionId !== 'undefined' && activeLiveSessionId && typeof pollQrLiveSession === 'function') {
          pollQrLiveSession();
        }
        var dash = document.getElementById('pg-dash');
        if (dash && dash.classList.contains('act') && typeof renderTodaySchedule === 'function') {
          renderTodaySchedule(todayISO());
        }
      } else {
        if (_notifInterval) { clearInterval(_notifInterval); _notifInterval = null; }
      }
    });
    
    var urlParams = new URLSearchParams(window.location.search);
    var initialTab = urlParams.get('tab') || urlParams.get('page') || 'dash';
    nav(initialTab);

    Promise.all([syncMyProfile(), syncMyAssignments()]).then(function() {
      populateAllFilters();
      return Promise.all([syncMyStudents(), syncMyAttendance(), syncMySchedule(0), fetchAllClassesAndSubjects()]);
    }).then(function() {
      populateAllFilters();
      populatePeriodOptions('attperiod');
      renderTodayClassesChips();
      if (typeof LiveSlotWatcher !== 'undefined' && LiveSlotWatcher.start) {
        LiveSlotWatcher.start();
      }
      // Re-render whichever data-driven view is open now that caches are warm
      var isAct = function(id) { var el = document.getElementById(id); return el && el.classList.contains('act'); };
      if (isAct('pg-dash'))    initDashboard();
      if (isAct('pg-sched'))   switchSchedTab(currentSchedTab || 'week');
      if (isAct('pg-att'))     initAttendancePage();
      if (isAct('pg-rep-stu')) { populateStudentListFilters(); renderStudentList(); }
      if (isAct('pg-rep-def')) { populateDefaulterFilters(); renderDefaultersList(); }
      if (isAct('pg-od'))      loadTeacherODData();
      if (isAct('pg-profile')) initProfilePage();
      syncAdvisorClassUI().then(function() {
        if (isAct('pg-roster') && typeof rosterInit === 'function') rosterInit();
        if (isAct('pg-registry') && typeof registryInit === 'function') registryInit();
      });
    });
  }

  // ── COLLAPSIBLE GROUP & PERMISSION HELPERS (B9, B10, B12, B14) ──
  function toggleReportGroup(forceState) {
    var btn = document.getElementById('sn-group-report');
    var sub = document.getElementById('sb-sub-reports');
    if (!btn || !sub) return;
    var isExpanded = btn.getAttribute('aria-expanded') === 'true';
    var shouldExpand = typeof forceState === 'boolean' ? forceState : !isExpanded;
    btn.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
    if (shouldExpand) {
      btn.classList.remove('collapsed');
      sub.style.display = 'block';
    } else {
      btn.classList.add('collapsed');
      sub.style.display = 'none';
    }
  }
  window.toggleReportGroup = toggleReportGroup;

  function isAdvisorUser() {
    if (window._isAdvisor) return true;
    if (!currentUser) return false;
    if (currentUser.isSudoAdmin || currentUser.isSuperAdmin || currentUser.isSubAdmin) return true;
    if (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s && s.option === 'isAdmin' && s.value !== false; })) return true;
    if (currentUser.isClassAdvisor) return true;
    if (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s && s.option === 'isClassAdvisor'; })) return true;
    return false;
  }

  function syncAdvisorClassUI() {
    if (typeof apiCall !== 'function') return Promise.resolve();
    return apiCall('GET', '/attendance-records/roster/options?scope=advisor')
      .then(function(res) {
        if (!res || !res.ok) return;
        var classes = (res.data && res.data.classes) || [];
        var isAdvisor = classes.length > 0 || isAdvisorUser();
        window._isAdvisor = isAdvisor;

        var advGrp = document.getElementById('sb-group-advisor');
        if (advGrp) {
          advGrp.style.display = isAdvisor ? 'block' : 'none';
          var lbl = document.getElementById('sb-advisor-label');
          if (lbl) {
            if (classes.length === 1) {
              lbl.textContent = 'Advisor · ' + classes[0].name;
            } else if (classes.length > 1) {
              lbl.textContent = 'Advisor (' + classes.length + ' Classes)';
            } else if (currentUser && currentUser.advisorClassName) {
              lbl.textContent = 'Advisor · ' + currentUser.advisorClassName;
            }
          }
        }
      })
      .catch(function(err) {
        console.warn('[Teacher] Advisor check error:', err);
      });
  }

  function isTabAllowed(pageName) {
    var settings = window._pubSettings || window._publicSettings || {};
    var models = settings.models || {};
    var features = settings.features || {};
    var mLeave = typeof models.modelLeave !== 'undefined' ? models.modelLeave : features.leave;
    var mStudentLeave = typeof models.modelStudentLeave !== 'undefined' ? models.modelStudentLeave : mLeave;
    var mStaffLeave = typeof models.modelStaffLeave !== 'undefined' ? models.modelStaffLeave : mLeave;
    var mGriev = typeof models.modelGrievances !== 'undefined' ? models.modelGrievances : features.grievances;

    if (pageName === 'leaves' && (mLeave === false || mStudentLeave === false)) return false;
    if (pageName === 'my-leaves' && (mLeave === false || mStaffLeave === false)) return false;
    if (pageName === 'griev' && mGriev === false) return false;
    if (pageName === 'device-verify') {
      var dvBtn = document.getElementById('sn-device-verify');
      var hasAccess = window.DeviceVerificationAdvisor && typeof window.DeviceVerificationAdvisor.hasAccess === 'function'
        ? window.DeviceVerificationAdvisor.hasAccess()
        : (dvBtn && dvBtn.style.display !== 'none');
      if (!hasAccess) return false;
    }
    if (pageName === 'roster' || pageName === 'registry') {
      return isAdvisorUser();
    }
    return true;
  }

  function updateStudentListSubtitle() {
    var el = document.getElementById('stu-list-subtitle');
    if (!el) return;
    var isHodOrPrincipal = !!(currentUser && (currentUser.isHOD || currentUser.isHod || currentUser.isPrincipal || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s && (s.option === 'isHod' || s.option === 'isPrincipal') && s.value !== false; }))));
    var hasAdminPrivileges = !!(currentUser && (currentUser.isSudoAdmin || currentUser.isSuperAdmin || currentUser.isSubAdmin || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s && s.option === 'isAdmin' && s.value !== false; }))));

    if (hasAdminPrivileges) {
      el.textContent = 'Students across the institution.';
    } else if (isHodOrPrincipal) {
      var deptName = currentUser.HoddeptName || currentUser.dept || currentUser.department || '';
      el.textContent = deptName ? ('Students in ' + deptName + ' department.') : 'Students in your department.';
    } else {
      el.textContent = 'Students in your assigned classes.';
    }
  }
  window.updateStudentListSubtitle = updateStudentListSubtitle;

  function ensureWorkloadAssets() {
    var pCss = new Promise(function(resolve) {
      if (document.getElementById('css-workload') || document.querySelector('link[href*="workload.shared.css"]')) {
        return resolve();
      }
      var link = document.createElement('link');
      link.id = 'css-workload';
      link.rel = 'stylesheet';
      link.href = 'css/workload.shared.css';
      link.onload = resolve;
      link.onerror = resolve;
      document.head.appendChild(link);
    });

    var pJs = new Promise(function(resolve) {
      if (typeof WorkloadShared !== 'undefined') return resolve();
      var script = document.createElement('script');
      script.id = 'js-workload';
      script.src = 'js/shared/workload.shared.js';
      script.onload = resolve;
      script.onerror = resolve;
      document.body.appendChild(script);
    });

    return Promise.all([pCss, pJs]);
  }


  // ══ C8: UNIFIED UI STATES (SKELETONS, EMPTY, ERROR) ══
  window.UIStates = {
    skeletonCards: function(count) {
      count = count || 3;
      var html = '<div class="ui-skeleton-feed">';
      for (var i = 0; i < count; i++) {
        html += '<div class="ui-skeleton-card">'
              + '  <div class="ui-skeleton-header">'
              + '    <div class="ui-skeleton ui-skeleton-avatar"></div>'
              + '    <div style="flex:1;">'
              + '      <div class="ui-skeleton ui-skeleton-title" style="width:40%;"></div>'
              + '      <div class="ui-skeleton ui-skeleton-line" style="width:65%;"></div>'
              + '    </div>'
              + '  </div>'
              + '  <div class="ui-skeleton ui-skeleton-line" style="width:90%;margin-top:12px;"></div>'
              + '  <div class="ui-skeleton ui-skeleton-line" style="width:75%;margin-top:6px;"></div>'
              + '  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">'
              + '    <div class="ui-skeleton ui-skeleton-btn"></div>'
              + '    <div class="ui-skeleton ui-skeleton-btn"></div>'
              + '  </div>'
              + '</div>';
      }
      html += '</div>';
      return html;
    },

    skeletonTable: function(opts) {
      opts = opts || {};
      var rows = opts.rows || 5;
      var cols = opts.cols || 5;
      var html = '<div class="ui-skeleton-table">';
      html += '<div class="ui-skeleton-table-header">';
      for (var c = 0; c < cols; c++) {
        html += '<div class="ui-skeleton ui-skeleton-th" style="width:' + (100 / cols - 2) + '%;"></div>';
      }
      html += '</div>';
      for (var r = 0; r < rows; r++) {
        html += '<div class="ui-skeleton-table-row">';
        for (var c2 = 0; c2 < cols; c2++) {
          html += '<div class="ui-skeleton ui-skeleton-cell" style="width:' + (100 / cols - 2) + '%;"></div>';
        }
        html += '</div>';
      }
      html += '</div>';
      return html;
    },

    empty: function(opts) {
      opts = opts || {};
      var icon = opts.icon || 'inbox';
      var title = opts.title || 'All caught up';
      var message = opts.message || 'There are no pending items requiring your attention right now.';
      var actionText = opts.actionText || '';
      var onAction = opts.onAction || '';
      var actionBtn = (actionText && onAction)
        ? '<button type="button" class="btn btn-out btn-sm" onclick="' + onAction + '" style="margin-top:14px;">' + escapeHtml(actionText) + '</button>'
        : '';
      return '<div class="ui-empty-state" role="status">'
        + '<div class="ui-empty-icon"><re-icon icon="' + icon + '" size="28"></re-icon></div>'
        + '<h4 class="ui-empty-title">' + escapeHtml(title) + '</h4>'
        + '<p class="ui-empty-desc">' + escapeHtml(message) + '</p>'
        + actionBtn
        + '</div>';
    },

    error: function(opts) {
      opts = opts || {};
      var message = opts.message || 'Something went wrong while loading this data.';
      var trackingId = opts.trackingId || (opts.requestId || ('err-' + Math.random().toString(36).substring(2, 9)));
      var onRetry = opts.onRetry || '';
      var isTimeout = message.toLowerCase().includes('timeout') || message.toLowerCase().includes('network');
      var lowBandwidthHint = isTimeout
        ? '<div style="margin-top:6px;font-size:11.5px;color:#b91c1c;">Connection is slow or congested. Retries and low-bandwidth caching are now engaged.</div>'
        : '';
      var retryBtn = onRetry
        ? '<div style="display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap;">'
          + '<button type="button" class="btn btn-pri btn-sm" onclick="' + onRetry + '" style="background:#dc2626;color:#fff;"><re-icon icon="refresh" size="14"></re-icon> Try Again</button>'
          + (isTimeout ? '<button type="button" class="btn btn-out btn-sm" onclick="if(window.eamsSetLowBandwidth){window.eamsSetLowBandwidth(true);} ' + onRetry + '">Switch to Low-Bandwidth Mode &amp; Retry</button>' : '')
          + '</div>'
        : '';
      return '<div class="ui-error-state" role="alert">'
        + '<div class="ui-error-icon"><re-icon icon="alert-triangle" size="24"></re-icon></div>'
        + '<div class="ui-error-content" style="flex:1;">'
        + '  <div class="ui-error-title">Data Loading Error</div>'
        + '  <div class="ui-error-message">' + escapeHtml(message) + '</div>'
        + lowBandwidthHint
        + '  <div class="ui-error-meta" style="margin-top:6px;"><span class="ui-req-chip">Tracking ID: ' + escapeHtml(trackingId) + '</span></div>'
        + retryBtn
        + '</div>'
        + '</div>';
    }
  };


  // ══ C6: UNIFIED APPROVALS INBOX CONTROLLER ══
  window.ApprovalsInbox = {
    activeTab: 'leaves',
    searchQuery: '',
    statusFilter: 'pending',
    selectedIds: new Set(),
    focusedIndex: -1,
    data: {
      leaves: [],
      od: [],
      devices: [],
      timetable: []
    },
    loading: false,

    init: function(preferredTab) {
      var tab = preferredTab || this.activeTab || 'leaves';
      this.updateRoleTabVisibility();
      this.switchTab(tab);
      this.bindKeyboardTriage();
    },

    updateRoleTabVisibility: function() {
      var isAdvisor = window.DeviceVerificationAdvisor && typeof window.DeviceVerificationAdvisor.hasAccess === 'function' && window.DeviceVerificationAdvisor.hasAccess();
      var devTab = document.getElementById('appr-tab-devices');
      if (devTab) devTab.style.display = isAdvisor ? 'inline-flex' : 'none';

      var isHod = !!(currentUser && (currentUser.isHod || currentUser.isPrincipal || (currentUser.role && currentUser.role.toLowerCase() === 'hod')));
      var ttTab = document.getElementById('appr-tab-timetable');
      if (ttTab) ttTab.style.display = isHod ? 'inline-flex' : 'none';
    },

    switchTab: function(tabName) {
      if (!tabName) tabName = 'leaves';
      this.activeTab = tabName;
      this.selectedIds.clear();
      this.focusedIndex = -1;
      this.updateBulkActionBar();

      document.querySelectorAll('.appr-tab-btn').forEach(function(btn) {
        btn.classList.remove('act');
      });
      var targetBtn = document.getElementById('appr-tab-' + tabName);
      if (targetBtn) targetBtn.classList.add('act');

      this.loadQueue(tabName);
    },

    refreshCurrentQueue: function() {
      this.loadQueue(this.activeTab, true);
    },

    openQuickCreate: function() {
      if (this.activeTab === 'leaves' && typeof openAdvisorFileLeaveModal === 'function') {
        openAdvisorFileLeaveModal();
      } else if (this.activeTab === 'od' && typeof openFacultyGroupODModal === 'function') {
        openFacultyGroupODModal();
      } else {
        showToast('Please select a specific category to file an action.', 'info');
      }
    },

    onSearch: function(val) {
      this.searchQuery = (val || '').toLowerCase().trim();
      this.renderCurrentQueue();
    },

    onStatusFilter: function(val) {
      this.statusFilter = val || 'pending';
      this.renderCurrentQueue();
    },

    resetFilters: function() {
      this.searchQuery = '';
      this.statusFilter = 'pending';
      var searchInput = document.getElementById('appr-search');
      if (searchInput) searchInput.value = '';
      var statusSelect = document.getElementById('appr-status-filter');
      if (statusSelect) statusSelect.value = 'pending';
      this.renderCurrentQueue();
    },

    loadQueue: function(tabName, forceRefresh) {
      var self = this;
      var container = document.getElementById('appr-list');
      var hasCachedData = Boolean(self.data[tabName] && self.data[tabName].length);

      // In low-bandwidth environment, render previously loaded queue immediately (SWR pattern)
      if (!forceRefresh && hasCachedData) {
        self.renderCurrentQueue();
      } else if (!forceRefresh) {
        // Try sessionStorage cache
        try {
          var rawStored = sessionStorage.getItem('eams_inbox_' + tabName);
          if (rawStored) {
            self.data[tabName] = JSON.parse(rawStored);
            hasCachedData = true;
            self.updateBadges();
            self.renderCurrentQueue();
          }
        } catch (_) {}
      }

      // Only display full-panel skeleton cards if there is completely no cached data
      if (!hasCachedData && container) {
        container.innerHTML = UIStates.skeletonCards(3);
      }
      self.loading = true;

      if (tabName === 'leaves') {
        return api('/api/student-leave/history', { headers: authHeaders(), cache: true })
          .then(function(r) { return (r && typeof r.json === 'function') ? r.json() : r; })
          .then(function(res) {
            self.loading = false;
            var items = Array.isArray(res) ? res : (res.data || res.leaves || res.requests || []);
            self.data.leaves = items;
            try { sessionStorage.setItem('eams_inbox_leaves', JSON.stringify(items)); } catch(_) {}
            self.updateBadges();
            self.renderCurrentQueue();
          })
          .catch(function(err) {
            self.loading = false;
            if (self.data.leaves && self.data.leaves.length) {
              if (typeof showToast === 'function') {
                showToast('Slow network connection: Showing cached student leaves queue.', 'warn');
              }
              self.renderCurrentQueue();
              return;
            }
            if (container) container.innerHTML = UIStates.error({
              message: 'Failed to load Student Leave queue: ' + (err.message || 'Server error'),
              onRetry: "ApprovalsInbox.refreshCurrentQueue()"
            });
          });
      } else if (tabName === 'od') {
        return api('/api/od/pending?type=all', { headers: authHeaders(), cache: true })
          .then(function(r) { return (r && typeof r.json === 'function') ? r.json() : r; })
          .then(function(res) {
            self.loading = false;
            var pending = Array.isArray(res.pending) ? res.pending : (Array.isArray(res.requests) ? res.requests : []);
            var verify = Array.isArray(res.verify) ? res.verify : [];
            var history = Array.isArray(res.history) ? res.history : [];
            self.data.od = [].concat(pending, verify, history);
            try { sessionStorage.setItem('eams_inbox_od', JSON.stringify(self.data.od)); } catch(_) {}
            self.updateBadges();
            self.renderCurrentQueue();
          })
          .catch(function(err) {
            self.loading = false;
            if (self.data.od && self.data.od.length) {
              if (typeof showToast === 'function') {
                showToast('Slow network connection: Showing cached OD approvals queue.', 'warn');
              }
              self.renderCurrentQueue();
              return;
            }
            if (container) container.innerHTML = UIStates.error({
              message: 'Failed to load OD Approvals queue: ' + (err.message || 'Server error'),
              onRetry: "ApprovalsInbox.refreshCurrentQueue()"
            });
          });
      } else if (tabName === 'devices') {
        return api('/api/devices/pending', { headers: authHeaders(), cache: true })
          .then(function(r) { return (r && typeof r.json === 'function') ? r.json() : r; })
          .then(function(res) {
            self.loading = false;
            var items = Array.isArray(res) ? res : (res.tickets || res.devices || res.data || []);
            self.data.devices = items;
            try { sessionStorage.setItem('eams_inbox_devices', JSON.stringify(items)); } catch(_) {}
            self.updateBadges();
            self.renderCurrentQueue();
          })
          .catch(function() {
            self.loading = false;
            if (!self.data.devices || !self.data.devices.length) self.data.devices = [];
            self.updateBadges();
            self.renderCurrentQueue();
          });
      } else if (tabName === 'timetable') {
        return api('/api/timetable/hod-pending', { headers: authHeaders(), cache: true })
          .then(function(r) { return (r && typeof r.json === 'function') ? r.json() : r; })
          .then(function(res) {
            self.loading = false;
            var items = res.requests || (Array.isArray(res) ? res : []);
            self.data.timetable = items;
            try { sessionStorage.setItem('eams_inbox_timetable', JSON.stringify(items)); } catch(_) {}
            self.updateBadges();
            self.renderCurrentQueue();
          })
          .catch(function(err) {
            self.loading = false;
            if (self.data.timetable && self.data.timetable.length) {
              if (typeof showToast === 'function') {
                showToast('Slow network connection: Showing cached timetable queue.', 'warn');
              }
              self.renderCurrentQueue();
              return;
            }
            if (container) container.innerHTML = UIStates.error({
              message: 'Failed to load Timetable Verification queue: ' + (err.message || 'Server error'),
              onRetry: "ApprovalsInbox.refreshCurrentQueue()"
            });
          });
      }
    },

    updateBadges: function() {
      var leavesPending = (this.data.leaves || []).filter(function(i) {
        var s = (i.status || '').toLowerCase();
        return s === 'pending';
      }).length;
      var odPending = (this.data.od || []).filter(function(i) {
        var s = (i.status || '').toLowerCase();
        return s === 'pending' || s === 'verify';
      }).length;
      var devPending = (this.data.devices || []).filter(function(i) {
        var s = (i.status || '').toLowerCase();
        return s === 'pending';
      }).length;
      var ttPending = (this.data.timetable || []).filter(function(i) {
        var s = (i.status || '').toLowerCase();
        return s === 'pending';
      }).length;

      var bL = document.getElementById('appr-badge-leaves');
      if (bL) { bL.textContent = leavesPending; bL.style.display = leavesPending > 0 ? 'inline-block' : 'none'; }
      var bOD = document.getElementById('appr-badge-od');
      if (bOD) { bOD.textContent = odPending; bOD.style.display = odPending > 0 ? 'inline-block' : 'none'; }
      var bDev = document.getElementById('appr-badge-devices');
      if (bDev) { bDev.textContent = devPending; bDev.style.display = devPending > 0 ? 'inline-block' : 'none'; }
      var bTt = document.getElementById('appr-badge-timetable');
      if (bTt) { bTt.textContent = ttPending; bTt.style.display = ttPending > 0 ? 'inline-block' : 'none'; }

      var totalPending = leavesPending + odPending + devPending + ttPending;
      var sbTotal = document.getElementById('sn-appr-total-badge');
      if (sbTotal) {
        sbTotal.textContent = totalPending;
        sbTotal.style.display = totalPending > 0 ? 'inline-block' : 'none';
      }
    },

    renderCurrentQueue: function() {
      var container = document.getElementById('appr-list');
      if (!container) return;

      var rawItems = this.data[this.activeTab] || [];
      var query = this.searchQuery;
      var status = this.statusFilter;

      var filtered = rawItems.filter(function(item) {
        var itemStatus = (item.status || 'pending').toLowerCase();
        if (status === 'pending') {
          if (itemStatus !== 'pending' && itemStatus !== 'verify') return false;
        } else if (status === 'approved') {
          if (itemStatus !== 'approved' && itemStatus !== 'completed') return false;
        } else if (status === 'rejected') {
          if (itemStatus !== 'rejected') return false;
        }

        if (query) {
          var str = JSON.stringify(item).toLowerCase();
          if (str.indexOf(query) === -1) return false;
        }
        return true;
      });

      if (!filtered.length) {
        container.innerHTML = UIStates.empty({
          icon: 'clipboard-check',
          title: 'No pending items found',
          message: query
            ? 'No items match your active search or filters.'
            : 'You have cleared all pending requests in this approval queue.',
          actionText: 'Refresh Queue',
          onAction: "ApprovalsInbox.refreshCurrentQueue()"
        });
        return;
      }

      var self = this;
      container.innerHTML = filtered.map(function(item, idx) {
        return self.renderCard(item, idx);
      }).join('');

      this.syncCardSelectionUI();
    },

    renderCard: function(item, idx) {
      var tab = this.activeTab;
      var id = item._id || ('item-' + idx);
      var isSelected = this.selectedIds.has(id);
      var status = (item.status || 'pending').toLowerCase();
      var isPending = status === 'pending' || status === 'verify';

      var statusChip = '<span class="appr-card-chip ' + (status === 'approved' ? 'accent' : (status === 'rejected' ? 'amber' : 'purple')) + '">' + escapeHtml(item.status || 'Pending') + '</span>';

      var name = 'Applicant';
      var regNo = '';
      var subHeader = '';
      var bodyText = '';
      var dateMeta = '';
      var attachLink = '';

      if (tab === 'leaves') {
        name = item.studentName || (item.studentId && item.studentId.name) || 'Student';
        regNo = item.studentRegNo || (item.studentId && item.studentId.regNo) || '';
        var leaveCat = item.leaveType || item.category || 'Leave';
        subHeader = '<span class="appr-card-chip">' + escapeHtml(leaveCat) + '</span>'
                  + (item.totalDays ? '<span class="appr-card-chip accent">' + item.totalDays + ' Day(s)</span>' : '');
        bodyText = escapeHtml(item.reason || 'No reason specified.');
        var from = item.fromDate ? new Date(item.fromDate).toLocaleDateString() : '';
        var to = item.toDate ? new Date(item.toDate).toLocaleDateString() : '';
        dateMeta = from + (to && to !== from ? ' &rarr; ' + to : '');
      } else if (tab === 'od') {
        name = (item.student && item.student.name) || item.studentName || 'Student';
        regNo = (item.student && item.student.regNo) || item.studentRegNo || '';
        subHeader = '<span class="appr-card-chip accent">' + escapeHtml(item.kind || item.category || 'On-Duty') + '</span>'
                  + (item.eventTitle ? '<span class="appr-card-chip purple">' + escapeHtml(item.eventTitle) + '</span>' : '');
        bodyText = escapeHtml(item.description || item.reason || item.eventTitle || 'On-Duty Authorization Request');
        var sDate = item.startDate ? new Date(item.startDate).toLocaleDateString() : '';
        var eDate = item.endDate ? new Date(item.endDate).toLocaleDateString() : '';
        dateMeta = sDate + (eDate && eDate !== sDate ? ' &rarr; ' + eDate : '');
        if (item.proofUrl && item.proofUrl.startsWith('https:')) {
          attachLink = '<a href="' + escapeHtml(item.proofUrl) + '" target="_blank" rel="noopener noreferrer" style="font-size:11.5px;color:var(--gD);display:inline-flex;align-items:center;gap:4px;"><re-icon icon="paperclip" size="12"></re-icon> View Proof</a>';
        }
      } else if (tab === 'devices') {
        name = item.name || (item.student && item.student.name) || 'Student';
        regNo = item.regNo || (item.student && item.student.regNo) || '';
        subHeader = '<span class="appr-card-chip purple">Device Binding</span>'
                  + (item.deviceModel ? '<span class="appr-card-chip">' + escapeHtml(item.deviceModel) + '</span>' : '');
        bodyText = 'Device registration and verification for attendance authentication.';
        dateMeta = item.macAddress ? ('MAC: ' + escapeHtml(item.macAddress)) : '';
      } else if (tab === 'timetable') {
        name = (item.classId && (item.classId.name || item.classId.code)) || 'Class Schedule';
        regNo = (item.submittedBy && item.submittedBy.name) ? ('Submitted by ' + item.submittedBy.name) : 'Coordinator';
        subHeader = '<span class="appr-card-chip accent">v' + (item.versionNumber || '1.0') + '</span>'
                  + '<span class="appr-card-chip purple">' + escapeHtml(item.academicYear || '') + ' ' + escapeHtml(item.semester || '') + '</span>';
        bodyText = 'Submitted timetable matrix requiring Department Head verification and atomic conflict validation.';
        dateMeta = item.submittedAt ? ('Submitted ' + timeAgo(item.submittedAt)) : '';
      }

      var initials = name.split(' ').map(function(s) { return s[0]; }).join('').substring(0, 2).toUpperCase() || 'U';

      var actionsHtml = '';
      if (isPending) {
        actionsHtml = '<button type="button" class="btn btn-pri btn-sm" onclick="ApprovalsInbox.approveItem(\x27' + id + '\x27)" style="background:#16a34a;color:#fff;"><re-icon icon="check" size="13"></re-icon> Approve</button>'
                    + '<button type="button" class="btn btn-danger btn-sm" onclick="ApprovalsInbox.rejectItem(\x27' + id + '\x27)"><re-icon icon="x" size="13"></re-icon> Reject</button>';
      }
      actionsHtml += '<button type="button" class="btn btn-out btn-sm" onclick="ApprovalsInbox.viewItemDetails(\x27' + id + '\x27)"><re-icon icon="eye" size="13"></re-icon> Review</button>';

      return '<div class="appr-card ' + (isSelected ? 'selected' : '') + '" id="appr-card-' + id + '" data-id="' + id + '" data-index="' + idx + '">'
        + '<div class="appr-card-cb">'
        + '  <input type="checkbox" class="appr-cb" data-id="' + id + '" ' + (isSelected ? 'checked' : '') + ' onchange="ApprovalsInbox.toggleItemSelect(\x27' + id + '\x27, this.checked)">'
        + '</div>'
        + '<div class="appr-card-av">' + escapeHtml(initials) + '</div>'
        + '<div class="appr-card-main">'
        + '  <div class="appr-card-top">'
        + '    <span class="appr-card-title">' + escapeHtml(name) + '</span>'
        + (regNo ? '    <span class="appr-card-chip">' + escapeHtml(regNo) + '</span>' : '')
        + subHeader
        + statusChip
        + '  </div>'
        + '  <div class="appr-card-body">' + bodyText + '</div>'
        + '  <div class="appr-card-meta">'
        + (dateMeta ? '    <span><re-icon icon="calendar" size="12"></re-icon> ' + dateMeta + '</span>' : '')
        + (attachLink ? '    <span>' + attachLink + '</span>' : '')
        + '  </div>'
        + '</div>'
        + '<div class="appr-card-actions">' + actionsHtml + '</div>'
        + '</div>';
    },

    toggleItemSelect: function(id, isChecked) {
      if (isChecked) this.selectedIds.add(id);
      else this.selectedIds.delete(id);
      this.updateBulkActionBar();
    },

    toggleSelectAll: function(isChecked) {
      var self = this;
      var rawItems = this.data[this.activeTab] || [];
      if (isChecked) {
        rawItems.forEach(function(i) { if (i._id) self.selectedIds.add(i._id); });
      } else {
        this.selectedIds.clear();
      }
      this.syncCardSelectionUI();
      this.updateBulkActionBar();
    },

    syncCardSelectionUI: function() {
      var self = this;
      document.querySelectorAll('.appr-cb').forEach(function(cb) {
        var id = cb.getAttribute('data-id');
        if (id) {
          cb.checked = self.selectedIds.has(id);
          var card = document.getElementById('appr-card-' + id);
          if (card) {
            if (cb.checked) card.classList.add('selected');
            else card.classList.remove('selected');
          }
        }
      });
    },

    updateBulkActionBar: function() {
      var bar = document.getElementById('appr-bulk-bar');
      var countEl = document.getElementById('appr-selected-count');
      var selectAllCb = document.getElementById('appr-select-all');
      var count = this.selectedIds.size;
      if (count > 0) {
        if (bar) bar.style.display = 'flex';
        if (countEl) countEl.textContent = count + ' item(s) selected';
        if (selectAllCb) selectAllCb.checked = count === (this.data[this.activeTab] || []).length;
      } else {
        if (bar) bar.style.display = 'none';
        if (selectAllCb) selectAllCb.checked = false;
      }
    },

    clearSelection: function() {
      this.selectedIds.clear();
      this.syncCardSelectionUI();
      this.updateBulkActionBar();
    },

    approveItem: function(id) {
      var self = this;
      var tab = this.activeTab;
      if (tab === 'leaves') {
        if (typeof openLeaveReviewModal === 'function') {
          openLeaveReviewModal(id);
        } else {
          api('/api/student-leave/' + id + '/status', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ status: 'Approved', remarks: 'Approved via inbox' })
          }).then(function(r) { return (r && typeof r.json === 'function') ? r.json() : r; })
            .then(function(res) {
              if (res.ok) {
                showToast('Leave request approved successfully.', 'success');
                self.refreshCurrentQueue();
              } else {
                showToast(res.error || 'Failed to approve leave', 'error');
              }
            });
        }
      } else if (tab === 'od') {
        api('/api/od/' + id + '/approve', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ remarks: 'Approved via Approvals Inbox' })
        }).then(function(r) { return (r && typeof r.json === 'function') ? r.json() : r; })
          .then(function(res) {
            if (res.ok) {
              showToast('OD request approved.', 'success');
              self.refreshCurrentQueue();
            } else {
              showToast(res.error || 'Failed to approve OD', 'error');
            }
          });
      } else if (tab === 'timetable') {
        if (typeof reviewTimetable === 'function') {
          reviewTimetable(id, 'approve');
        }
      } else if (tab === 'devices') {
        if (window.DeviceVerificationAdvisor && window.DeviceVerificationAdvisor.approveTicket) {
          window.DeviceVerificationAdvisor.approveTicket(id);
        }
      }
    },

    rejectItem: function(id) {
      var self = this;
      var tab = this.activeTab;
      if (tab === 'leaves') {
        if (typeof openLeaveReviewModal === 'function') {
          openLeaveReviewModal(id);
        } else {
          api('/api/student-leave/' + id + '/status', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ status: 'Rejected', remarks: 'Rejected via inbox' })
          }).then(function(r) { return (r && typeof r.json === 'function') ? r.json() : r; })
            .then(function(res) {
              if (res.ok) {
                showToast('Leave request rejected.', 'info');
                self.refreshCurrentQueue();
              } else {
                showToast(res.error || 'Failed to reject leave', 'error');
              }
            });
        }
      } else if (tab === 'od') {
        api('/api/od/' + id + '/reject', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ remarks: 'Rejected via Approvals Inbox' })
        }).then(function(r) { return (r && typeof r.json === 'function') ? r.json() : r; })
          .then(function(res) {
            if (res.ok) {
              showToast('OD request rejected.', 'info');
              self.refreshCurrentQueue();
            } else {
              showToast(res.error || 'Failed to reject OD', 'error');
            }
          });
      } else if (tab === 'timetable') {
        if (typeof reviewTimetable === 'function') {
          reviewTimetable(id, 'reject');
        }
      } else if (tab === 'devices') {
        if (window.DeviceVerificationAdvisor && window.DeviceVerificationAdvisor.rejectTicket) {
          window.DeviceVerificationAdvisor.rejectTicket(id);
        }
      }
    },

    viewItemDetails: function(id) {
      var tab = this.activeTab;
      if (tab === 'leaves') {
        if (typeof openLeaveReviewModal === 'function') openLeaveReviewModal(id);
      } else if (tab === 'od') {
        if (typeof openODDetailModal === 'function') openODDetailModal(id);
      } else if (tab === 'timetable') {
        if (typeof openHodTimetableMatrixModal === 'function') openHodTimetableMatrixModal(id);
      }
    },

    bulkApproveSelected: function() {
      var self = this;
      var ids = Array.from(this.selectedIds);
      if (!ids.length) return;
      if (!confirm('Are you sure you want to approve ' + ids.length + ' selected requests?')) return;

      var promises = ids.map(function(id) {
        if (self.activeTab === 'od') {
          return api('/api/od/' + id + '/approve', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ remarks: 'Bulk approved' }) });
        } else if (self.activeTab === 'leaves') {
          return api('/api/student-leave/' + id + '/status', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ status: 'Approved', remarks: 'Bulk approved' }) });
        }
        return Promise.resolve();
      });

      Promise.all(promises).then(function() {
        showToast('Bulk approval completed for ' + ids.length + ' items.', 'success');
        self.selectedIds.clear();
        self.refreshCurrentQueue();
      }).catch(function(err) {
        showToast('Error during bulk approval: ' + (err.message || 'Server error'), 'error');
        self.refreshCurrentQueue();
      });
    },

    bulkRejectSelected: function() {
      var self = this;
      var ids = Array.from(this.selectedIds);
      if (!ids.length) return;
      if (!confirm('Are you sure you want to reject ' + ids.length + ' selected requests?')) return;

      var promises = ids.map(function(id) {
        if (self.activeTab === 'od') {
          return api('/api/od/' + id + '/reject', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ remarks: 'Bulk rejected' }) });
        } else if (self.activeTab === 'leaves') {
          return api('/api/student-leave/' + id + '/status', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ status: 'Rejected', remarks: 'Bulk rejected' }) });
        }
        return Promise.resolve();
      });

      Promise.all(promises).then(function() {
        showToast('Bulk rejection completed for ' + ids.length + ' items.', 'info');
        self.selectedIds.clear();
        self.refreshCurrentQueue();
      }).catch(function(err) {
        showToast('Error during bulk rejection: ' + (err.message || 'Server error'), 'error');
        self.refreshCurrentQueue();
      });
    },

    bindKeyboardTriage: function() {
      if (this._kbBound) return;
      this._kbBound = true;
      var self = this;

      window.addEventListener('keydown', function(e) {
        var pgApprovals = document.getElementById('pg-approvals');
        if (!pgApprovals || !pgApprovals.classList.contains('act')) return;
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (document.body.classList.contains('modal-open')) return;

        var cards = document.querySelectorAll('.appr-card');
        if (!cards.length) return;

        if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
          e.preventDefault();
          self.focusedIndex = Math.min(self.focusedIndex + 1, cards.length - 1);
          self.focusCardByIndex(cards, self.focusedIndex);
        } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
          e.preventDefault();
          self.focusedIndex = Math.max(self.focusedIndex - 1, 0);
          self.focusCardByIndex(cards, self.focusedIndex);
        } else if (e.key === 'a' || e.key === 'A') {
          if (self.focusedIndex >= 0 && self.focusedIndex < cards.length) {
            e.preventDefault();
            var card = cards[self.focusedIndex];
            var id = card.getAttribute('data-id');
            if (id) self.approveItem(id);
          }
        } else if (e.key === 'r' || e.key === 'R') {
          if (self.focusedIndex >= 0 && self.focusedIndex < cards.length) {
            e.preventDefault();
            var card2 = cards[self.focusedIndex];
            var id2 = card2.getAttribute('data-id');
            if (id2) self.rejectItem(id2);
          }
        } else if (e.key === 'x' || e.key === 'X' || e.key === ' ') {
          if (self.focusedIndex >= 0 && self.focusedIndex < cards.length) {
            e.preventDefault();
            var card3 = cards[self.focusedIndex];
            var id3 = card3.getAttribute('data-id');
            var cb = card3.querySelector('.appr-cb');
            if (cb) {
              cb.checked = !cb.checked;
              self.toggleItemSelect(id3, cb.checked);
            }
          }
        }
      });
    },

    focusCardByIndex: function(cards, idx) {
      cards.forEach(function(c) { c.classList.remove('kb-focused'); });
      if (idx >= 0 && idx < cards.length) {
        var target = cards[idx];
        target.classList.add('kb-focused');
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  };

  // NAVIGATION
  function nav(pageName, subtab) {
    const validTabs = ['dash', 'sched', 'att', 'my-classes', 'rep-att', 'rep-def', 'rep-stu', 'rep-insights', 'approvals', 'leaves', 'my-leaves', 'od', 'griev', 'profile', 'device-verify', 'workload', 'tt-verify', 'roster', 'registry'];
    if (validTabs.indexOf(pageName) === -1 || !isTabAllowed(pageName)) pageName = 'dash';

    // Route legacy approval queues into Unified Approvals Inbox (§10.1, C6)
    var isApprovalsRoute = (pageName === 'approvals' || pageName === 'leaves' || pageName === 'od' || pageName === 'device-verify' || pageName === 'tt-verify');
    var apprSubtab = subtab;
    if (pageName === 'leaves') apprSubtab = 'leaves';
    else if (pageName === 'od') apprSubtab = 'od';
    else if (pageName === 'device-verify') apprSubtab = 'devices';
    else if (pageName === 'tt-verify') apprSubtab = 'timetable';

    if (isApprovalsRoute) {
      pageName = 'approvals';
    }

    if (['rep-att', 'rep-def', 'rep-stu', 'rep-insights'].indexOf(pageName) !== -1) {
      toggleReportGroup(true);
    }

    if (apprSubtab === 'devices' || pageName === 'device-verify') {
      const dvBtn = document.getElementById('sn-device-verify');
      const hasAccess = window.DeviceVerificationAdvisor && typeof window.DeviceVerificationAdvisor.hasAccess === 'function'
        ? window.DeviceVerificationAdvisor.hasAccess()
        : (dvBtn && dvBtn.style.display !== 'none');
      if (!hasAccess && pageName === 'device-verify') {
        pageName = 'dash';
      }
    }

    if (window.history && window.history.replaceState) {
      var url = new URL(window.location);
      url.searchParams.set('tab', pageName);
      if (apprSubtab) {
        url.searchParams.set('queue', apprSubtab);
      } else {
        url.searchParams.delete('queue');
      }

      // Attendance query parameters must not linger when moving to other tabs
      if (pageName !== 'att') {
        url.searchParams.delete('classId');
        url.searchParams.delete('date');
        url.searchParams.delete('period');
        url.searchParams.delete('periodNumber');
        url.searchParams.delete('sessionId');
      }
      if (pageName !== 'roster' && pageName !== 'registry') {
        url.searchParams.delete('from');
        url.searchParams.delete('to');
        url.searchParams.delete('view');
      }
      if (pageName !== 'sched') {
        url.searchParams.delete('scheduleDay');
      }
      window.history.replaceState(null, '', url);
    }

    document.querySelectorAll('.pg').forEach(function(p) { p.classList.remove('act'); });
    var actualTargetId = 'pg-' + pageName;
    if (['my-classes', 'rep-stu', 'rep-att', 'rep-def', 'rep-insights'].indexOf(pageName) !== -1) {
      actualTargetId = 'pg-my-classes';
    } else if (pageName === 'approvals') {
      actualTargetId = 'pg-approvals';
    }
    const targetPage = document.getElementById(actualTargetId);
    if (targetPage) targetPage.classList.add('act');

    document.querySelectorAll('.sb-item,.ss').forEach(function(item) { item.classList.remove('act'); });

    const navMap = {
      'dash':          'sn-dash',          'sched':         'sn-sched', 'att':     'sn-att', 'my-classes': 'sn-my-classes',
      'rep-att':       'sn-my-classes',    'rep-def':       'sn-my-classes',  'rep-stu': 'sn-my-classes',
      'rep-insights':  'sn-my-classes',      'approvals':     'sn-approvals',
      'leaves':        'sn-approvals',     'my-leaves':     'sn-my-leaves',
      'od':            'sn-approvals',
      'griev':         'sn-griev',         'profile':       'sn-profile',
      'device-verify': 'sn-approvals',     'workload':      'sn-fac-workload',
      'tt-verify':     'sn-approvals',
      'roster':        'sn-roster',
      'registry':      'sn-registry'
    };
    if (navMap[pageName]) {
      const navEl = document.getElementById(navMap[pageName]);
      if (navEl) navEl.classList.add('act');
    }

    const profileChip = document.querySelector('.profile-chip');
    if (profileChip) {
      if (pageName === 'profile') profileChip.classList.add('act');
      else profileChip.classList.remove('act');
    }

    const pageActions = {
      'dash':          initDashboard,
      'sched':         function() { switchSchedTab(currentSchedTab || 'week'); },
      'att':           initAttendancePage,
      'my-classes':    function() { initMyClassesPage(); },
      'rep-att':       function() { initMyClassesPage(); switchMyClassesTab('att'); },
      'rep-def':       function() { initMyClassesPage(); switchMyClassesTab('def'); },
      'rep-stu':       function() { initMyClassesPage(); switchMyClassesTab('stu'); },
      'rep-insights':  function() { initMyClassesPage(); switchMyClassesTab('insights'); },
      'approvals':     function() { if (window.ApprovalsInbox) window.ApprovalsInbox.init(apprSubtab); },
      'leaves':        function() { if (window.ApprovalsInbox) window.ApprovalsInbox.init('leaves'); else loadTeacherLeaveHistory(); },
      'my-leaves':     initMyLeavesPage,
      'od':            function() { if (window.ApprovalsInbox) window.ApprovalsInbox.init('od'); else loadTeacherODData(); },
      'griev':         renderGrievances,
      'profile':       function() { initProfilePage(); syncMyProfile().then(initProfilePage); },
      'device-verify': function() { if (window.ApprovalsInbox) window.ApprovalsInbox.init('devices'); else if (window.DeviceVerificationAdvisor) window.DeviceVerificationAdvisor.init(); },
      'workload':      loadTeacherWorkloadView,
      'tt-verify':     function() { if (window.ApprovalsInbox) window.ApprovalsInbox.init('timetable'); else loadHodTimetableVerificationPage(); },
      'roster':        function() { if (typeof rosterInit === 'function') rosterInit(); },
      'registry':      function() { if (typeof registryInit === 'function') registryInit(); }
    };
    if (pageActions[pageName]) pageActions[pageName]();
  }

  function loadTeacherWorkloadView() {
    ensureWorkloadAssets().then(function() {
      if (typeof WorkloadShared === 'undefined') {
        console.warn('[WorkloadShared] Module not loaded');
        return;
      }
      var isPrincipal = !!(currentUser && (currentUser.isPrincipal || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s.option === 'isPrincipal'; }))));
      WorkloadShared.init({
        containerId: 'teacher-workload-container',
        deptSelectId: 'teacher-workload-dept-select',
        isPrincipal: isPrincipal,
        deptId: isPrincipal ? null : (currentUser.departmentId || currentUser.deptId || null),
        deptName: currentUser.HoddeptName || currentUser.dept || ''
      });
    });
  }

  // ── DEPARTMENT HOD TIMETABLE VERIFICATION & APPROVAL ──
  var _hodTtRequests = [];
  var _hodTtFilter = 'pending';

  async function updateHodTtVerificationBadge() {
    try {
      var res = await api('GET', '/timetable/verification-requests?status=pending');
      var items = res && res.data ? res.data : (Array.isArray(res) ? res : []);
      var count = Array.isArray(items) ? items.length : 0;
      var badge = document.getElementById('sn-tt-verify-badge');
      if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
      }
      var kpiPending = document.getElementById('hod-tt-kpi-pending');
      if (kpiPending) kpiPending.textContent = count;
    } catch (e) {
      console.warn('Failed to update HoD timetable verification badge:', e.message);
    }
  }

  async function loadHodTimetableVerificationPage() {
    var container = document.getElementById('hod-tt-table-container');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:36px;color:var(--tmu);font-size:13px;">Loading verification requests…</div>';

    try {
      var deptId = (currentUser && (currentUser.departmentId || currentUser.deptId)) || '';
      var url = '/timetable/verification-requests' + (deptId && !currentUser.isPrincipal && !currentUser.isAdmin ? '?deptId=' + encodeURIComponent(deptId) : '');
      var res = await api('GET', url);
      _hodTtRequests = res && res.data ? res.data : (Array.isArray(res) ? res : []);

      var pendingCount = _hodTtRequests.filter(function(r) { return (r.verificationStatus || r.status) === 'pending'; }).length;
      var approvedCount = _hodTtRequests.filter(function(r) { return (r.verificationStatus || r.status) === 'approved'; }).length;
      var publishedCount = _hodTtRequests.filter(function(r) { return (r.verificationStatus || r.status) === 'published'; }).length;

      var elPending = document.getElementById('hod-tt-kpi-pending');
      var elApproved = document.getElementById('hod-tt-kpi-approved');
      var elPublished = document.getElementById('hod-tt-kpi-published');
      if (elPending) elPending.textContent = pendingCount;
      if (elApproved) elApproved.textContent = approvedCount;
      if (elPublished) elPublished.textContent = publishedCount;

      var badge = document.getElementById('sn-tt-verify-badge');
      if (badge) {
        badge.textContent = pendingCount;
        badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
      }

      renderHodTtTable();
    } catch (err) {
      container.innerHTML = '<div style="text-align:center;padding:36px;color:#dc2626;font-size:13px;">Failed to load verification requests: ' + esc(err.message) + '</div>';
    }
  }

  function filterHodTtRequests(filter) {
    _hodTtFilter = filter;
    var btnPending = document.getElementById('hod-tt-filter-pending');
    var btnAll = document.getElementById('hod-tt-filter-all');
    if (btnPending) btnPending.classList.toggle('act', filter === 'pending');
    if (btnAll) btnAll.classList.toggle('act', filter === 'all');
    renderHodTtTable();
  }

  function renderHodTtTable() {
    var container = document.getElementById('hod-tt-table-container');
    if (!container) return;

    var filtered = _hodTtRequests;
    if (_hodTtFilter === 'pending') {
      filtered = _hodTtRequests.filter(function(r) { return (r.verificationStatus || r.status) === 'pending'; });
    }

    if (!filtered.length) {
      container.innerHTML = '<div style="text-align:center;padding:48px 24px;color:var(--tmu);">'
        + '<div style="font-size:32px;margin-bottom:8px;"><re-icon icon="clipboard-list"></re-icon></div>'
        + '<div style="font-weight:700;font-size:14px;color:var(--td);margin-bottom:4px;">No Verification Requests Found</div>'
        + '<div style="font-size:12px;">' + (_hodTtFilter === 'pending' ? 'There are currently no timetable drafts awaiting your verification.' : 'No timetable verification requests have been submitted.') + '</div>'
        + '</div>';
      return;
    }

    var html = '<table class="table" style="width:100%;border-collapse:collapse;font-size:12.5px;">'
      + '<thead>'
      + '<tr style="border-bottom:1.5px solid var(--br);background:var(--bg2,#f8faf8);text-align:left;">'
      + '<th style="padding:10px 14px;">Class / Section</th>'
      + '<th style="padding:10px 14px;">Version</th>'
      + '<th style="padding:10px 14px;">Submitted By</th>'
      + '<th style="padding:10px 14px;">Date</th>'
      + '<th style="padding:10px 14px;">Status</th>'
      + '<th style="padding:10px 14px;">Notes</th>'
      + '<th style="padding:10px 14px;min-width:240px;text-align:right;">Actions</th>'
      + '</tr>'
      + '</thead>'
      + '<tbody>'
      + filtered.map(function(r) {
          var status = r.verificationStatus || r.status || 'pending';
          var isPending = status === 'pending';
          var isApproved = status === 'approved';
          var isPublished = status === 'published';
          var isRejected = status === 'rejected';

          var reqDate = (r.verificationRequest && r.verificationRequest.requestedAt) || r.createdAt;
          var dateStr = reqDate ? new Date(reqDate).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
          var submitter = (r.verificationRequest && r.verificationRequest.requestedBy) || r.savedBy || 'Coordinator';

          return '<tr style="border-bottom:1px solid var(--br);">'
            + '<td style="padding:10px 14px;font-weight:700;color:var(--td);"><re-icon icon="chalkboard"></re-icon> ' + esc(r.className || 'General') + '</td>'
            + '<td style="padding:10px 14px;"><span class="pill pri" style="font-size:11px;font-weight:600;">' + esc(r.versionName || ('v' + r.version)) + '</span></td>'
            + '<td style="padding:10px 14px;font-size:12px;"><re-icon icon="user"></re-icon> ' + esc(submitter) + '</td>'
            + '<td style="padding:10px 14px;font-size:11.5px;color:var(--tmu);font-family:monospace;">' + dateStr + '</td>'
            + '<td style="padding:10px 14px;">'
            + (isPending ? '<span class="pill warn"><re-icon icon="hourglass"></re-icon> Pending Review</span>' : '')
            + (isApproved ? '<span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;"><re-icon icon="check"></re-icon> Approved</span>' : '')
            + (isPublished ? '<span class="pill" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;"><re-icon icon="rocket"></re-icon> Published</span>' : '')
            + (isRejected ? '<span class="pill red"><re-icon icon="x"></re-icon> Rejected</span>' : '')
            + (status === 'withdrawn' ? '<span class="pill" style="background:#f1f5f9;color:#64748b;border-color:#cbd5e1;"><re-icon icon="x"></re-icon> Withdrawn</span>' : '')
            + '</td>'
            + '<td style="padding:10px 14px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--tmu);" title="' + esc((r.verificationRequest && r.verificationRequest.notes) || r.changeSummary || '') + '">'
            + esc((r.verificationRequest && r.verificationRequest.notes) || r.changeSummary || '—')
            + ((r.verificationRequest && r.verificationRequest.comment) ? '<br><small style="color:#1b5e20;"><b>HoD:</b> ' + esc(r.verificationRequest.comment) + '</small>' : '')
            + '</td>'
            + '<td style="padding:10px 14px;text-align:right;">'
            + '<div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;">'
            + '<button type="button" class="btno bsm" onclick="openHodTimetableMatrixModal(\'' + esc(r._id) + '\')" style="font-size:11.5px;padding:4px 10px;"><re-icon icon="grid"></re-icon> View Matrix &amp; Changes</button>'
            + (isPending ? '<button type="button" class="btn-pri bsm" onclick="hodReviewTimetable(\'' + esc(r._id) + '\', \'approve\')" style="font-size:11.5px;padding:4px 12px;background:#16a34a;font-weight:700;"><re-icon icon="check"></re-icon> Approve</button>'
            + '<button type="button" class="btno bsm" onclick="hodReviewTimetable(\'' + esc(r._id) + '\', \'reject\')" style="font-size:11.5px;padding:4px 9px;color:#dc2626;border-color:#fca5a5;"><re-icon icon="x"></re-icon> Reject</button>' : '')
            + '</div>'
            + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table>';

    container.innerHTML = html;
  }

  async function reviewTimetable(id, action, source) {
    if (!id) return;
    var notifId = (typeof source === 'string' && source !== 'page' && source !== 'matrix') ? source : (source && source.notifId);
    var comment = '';
    var reqItem = (typeof _hodTtRequests !== 'undefined' && Array.isArray(_hodTtRequests))
      ? _hodTtRequests.find(function(r) { return String(r._id) === String(id); })
      : null;

    var className = (reqItem && reqItem.className) || 'Selected Class';
    var versionName = (reqItem && (reqItem.versionName || ('v' + reqItem.version))) || 'Current Draft';
    var submitter = (reqItem && ((reqItem.verificationRequest && reqItem.verificationRequest.requestedBy) || reqItem.savedBy)) || 'Coordinator';
    var notes = (reqItem && ((reqItem.verificationRequest && reqItem.verificationRequest.notes) || reqItem.changeSummary)) || '';

    if (action === 'reject') {
      var promptFn = window.showPrompt || (typeof showPrompt === 'function' ? showPrompt : null);
      var promptHtml = '<div style="margin-bottom:12px;font-size:13.5px;color:var(--td);line-height:1.5;">' +
        'Please enter your review feedback or reason for rejecting this timetable schedule:' +
        '</div>' +
        '<div style="background:var(--bg2,#f8fafc);border:1px solid var(--br);border-radius:12px;padding:12px 14px;margin-bottom:12px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;flex-wrap:wrap;">' +
            '<span style="font-weight:700;font-size:14px;color:var(--td);display:inline-flex;align-items:center;gap:6px;">' +
              '<re-icon icon="chalkboard" size="14" style="color:#dc2626;"></re-icon> ' + esc(className) +
            '</span>' +
            '<span class="badge" style="background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;font-size:11px;padding:2px 8px;border-radius:6px;font-weight:700;">' +
              'Version: ' + esc(versionName) +
            '</span>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--tmu);"><re-icon icon="user" size="12"></re-icon> Submitted by: <b style="color:var(--td);">' + esc(submitter) + '</b></div>' +
        '</div>';

      comment = promptFn
        ? await promptFn({
            title: 'Reject Timetable Schedule',
            type: 'danger',
            icon: 'x-circle',
            html: promptHtml,
            inputLabel: 'Rejection Reason / Revision Notes:',
            placeholder: 'Specify what conflicts or adjustments are needed (e.g. Period clashing, lab reallocation)...',
            multiline: true,
            confirmText: 'Reject Schedule',
            cancelText: 'Cancel'
          })
        : await prompt('Please enter the reason for rejecting this timetable schedule (optional):');
      if (comment === null) return;
    } else {
      var confFn = window.showConfirm || (typeof showConfirm === 'function' ? showConfirm : null);
      var confirmHtml = '<div style="margin-bottom:14px;font-size:13.5px;color:var(--td);line-height:1.5;">' +
        'Are you sure you want to approve this timetable schedule for department publication?' +
        '</div>' +
        '<div style="background:var(--bg2,#f8fafc);border:1px solid var(--br);border-radius:12px;padding:12px 14px;margin-bottom:14px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;flex-wrap:wrap;">' +
            '<span style="font-weight:700;font-size:14px;color:var(--td);display:inline-flex;align-items:center;gap:6px;">' +
              '<re-icon icon="chalkboard" size="15" style="color:#16a34a;"></re-icon> ' + esc(className) +
            '</span>' +
            '<span class="badge" style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;font-size:11px;padding:2px 8px;border-radius:6px;font-weight:700;display:inline-flex;align-items:center;gap:4px;">' +
              '<re-icon icon="git-branch" size="11"></re-icon> ' + esc(versionName) +
            '</span>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--tmu);display:flex;align-items:center;gap:6px;">' +
            '<re-icon icon="user" size="12"></re-icon> Submitted by: <b style="color:var(--td);">' + esc(submitter) + '</b>' +
          '</div>' +
          (notes ? (
            '<div style="font-size:12px;color:var(--td);background:#fff;border:1px solid var(--br);border-radius:8px;padding:8px 10px;margin-top:8px;display:flex;align-items:flex-start;gap:6px;">' +
              '<re-icon icon="message-square" size="12" style="color:#2563eb;margin-top:2px;flex-shrink:0;"></re-icon>' +
              '<span style="font-style:italic;color:var(--td);">"' + esc(notes) + '"</span>' +
            '</div>'
          ) : '') +
        '</div>' +
        '<div style="font-size:11.5px;color:var(--tmu);line-height:1.45;display:flex;align-items:center;gap:6px;">' +
          '<re-icon icon="info" size="13" style="color:#16a34a;flex-shrink:0;"></re-icon>' +
          '<span>Approving verifies this schedule. Coordinators can then publish it live to production for student and faculty portals.</span>' +
        '</div>';

      var confirmed = confFn
        ? await confFn({
            title: 'Approve Timetable Schedule',
            type: 'success',
            icon: 'check',
            confirmText: 'Approve Schedule',
            cancelText: 'Cancel',
            html: confirmHtml
          })
        : await confirm('Approve this timetable schedule for department publication?');
      if (!confirmed) return;
    }

    try {
      if (typeof showToast === 'function') showToast('Processing timetable ' + action + '…', 'info');
      var res = await api('POST', '/timetable/verification-requests/' + id + '/review', {
        action: action,
        comment: comment || ''
      });
      if (typeof showToast === 'function') {
        showToast(res && res.message ? res.message : ('Timetable ' + (action === 'approve' ? 'approved' : 'rejected') + ' successfully!'), 'success');
      }
      if (typeof closeHodMatrixModal === 'function') closeHodMatrixModal();
      if (notifId && typeof markNotificationRead === 'function') markNotificationRead(notifId);
      if (typeof loadNotifications === 'function') loadNotifications();
      if (typeof loadHodTimetableVerificationPage === 'function') await loadHodTimetableVerificationPage();
    } catch (err) {
      if (typeof showToast === 'function') {
        showToast('Error: ' + err.message, 'error');
      } else if (typeof dbToast === 'function') {
        dbToast('Error: ' + err.message, 'error');
      } else {
        console.error('[reviewTimetable Error]:', err);
      }
    }
  }

  function hodReviewTimetable(id, action) {
    return reviewTimetable(id, action, 'page');
  }

  function closeHodMatrixModal() {
    var modal = document.getElementById('hod-ver-matrix-modal');
    if (modal) {
      modal.classList.remove('open');
      setTimeout(function() { modal.remove(); }, 150);
    }
  }

  async function openHodTimetableMatrixModal(id) {
    if (typeof showToast === 'function') showToast('Loading timetable matrix & diff…', 'info');
    try {
      var res = await api('GET', '/timetable/verification-requests/' + id + '/details');
      var data = (res && res.data) ? res.data : res;
      if (!data || !data.request) throw new Error('Schedule details not found');

      var req = data.request;
      var submittedSlots = data.submittedSlots || [];
      var diff = data.diff || { added: [], removed: [], modified: [], unchangedCount: 0 };
      var stats = data.stats || { totalSlots: submittedSlots.length, addedCount: 0, modifiedCount: 0, removedCount: 0, unchangedCount: 0 };
      var status = req.verificationStatus || req.status || 'pending';
      var isPending = status === 'pending';
      var isApproved = status === 'approved';

      var reqDate = (req.verificationRequest && req.verificationRequest.requestedAt) || req.createdAt;
      var dateStr = reqDate ? new Date(reqDate).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
      var submitter = (req.verificationRequest && req.verificationRequest.requestedBy) || req.savedBy || 'Coordinator';

      var slotMap = new Map();
      submittedSlots.forEach(function(s) {
        var pNum = typeof s.period === 'number' ? s.period : (parseInt(String(s.period || '1').replace(/\D/g, ''), 10) || 1);
        slotMap.set(s.day + '_' + pNum, s);
      });

      var addedKeys = new Set((diff.added || []).map(function(s) {
        var pNum = typeof s.period === 'number' ? s.period : (parseInt(String(s.period || '1').replace(/\D/g, ''), 10) || 1);
        return s.day + '_' + pNum;
      }));
      var modifiedKeys = new Set((diff.modified || []).map(function(m) { return m.day + '_' + m.period; }));

      var days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      var maxPeriod = Math.max.apply(null, [8].concat(submittedSlots.map(function(s) {
        return typeof s.period === 'number' ? s.period : (parseInt(String(s.period || '1').replace(/\D/g, ''), 10) || 1);
      })));
      var periods = [];
      for (var i = 1; i <= maxPeriod; i++) periods.push(i);

      closeHodMatrixModal();

      var backdrop = document.createElement('div');
      backdrop.className = 'modal-bg open';
      backdrop.id = 'hod-ver-matrix-modal';
      backdrop.style.zIndex = '1100';

      backdrop.innerHTML = '<div class="modal modal-lg" style="max-width:960px;width:95vw;max-height:92vh;display:flex;flex-direction:column;">'
        + '<div class="modal-hd" style="border-bottom:1px solid var(--br);padding-bottom:12px;">'
        + '<div>'
        + '<div class="modal-eyebrow" style="color:var(--gM,#2e7d32);font-weight:700;">HOD VERIFICATION &amp; AUDIT MATRIX</div>'
        + '<h2 class="modal-title" style="font-size:18px;display:flex;align-items:center;gap:8px;">'
        + '<re-icon icon="grid"></re-icon> ' + esc(req.className || 'Class Schedule') + ' · ' + esc(req.versionName || ('v' + req.version))
        + '</h2>'
        + '<div class="modal-sub" style="font-size:12px;margin-top:4px;">'
        + 'Submitted by <b>' + esc(submitter) + '</b> on ' + dateStr + ' · '
        + (isPending ? '<span class="pill warn" style="font-size:11px;padding:2px 8px;">Pending Review</span>' : '')
        + (isApproved ? '<span class="pill" style="font-size:11px;padding:2px 8px;background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;">Approved by HoD</span>' : '')
        + (status === 'published' ? '<span class="pill" style="font-size:11px;padding:2px 8px;background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">Live in Production</span>' : '')
        + (status === 'rejected' ? '<span class="pill red" style="font-size:11px;padding:2px 8px;">Rejected by HoD</span>' : '')
        + '</div>'
        + '</div>'
        + '<button type="button" class="modal-close" onclick="closeHodMatrixModal()">×</button>'
        + '</div>'

        + '<div class="ver-matrix-tabs">'
        + '<button type="button" class="ver-matrix-tab act" id="hod-tab-btn-matrix">'
        + '<re-icon icon="grid"></re-icon> Timetable Matrix (' + submittedSlots.length + ' Slots)'
        + '</button>'
        + '<button type="button" class="ver-matrix-tab" id="hod-tab-btn-diff">'
        + '<re-icon icon="refresh"></re-icon> What Changed (' + (stats.addedCount + stats.modifiedCount + stats.removedCount) + ' Changes)'
        + '</button>'
        + '</div>'

        + '<div class="modal-body" style="padding:16px 20px;overflow-y:auto;flex:1;">'
        + '<!-- TAB 1: MATRIX VIEW -->'
        + '<div id="hod-matrix-tab-view" style="display:block;">'
        + '<div style="overflow-x:auto;">'
        + '<table style="width:100%;border-collapse:collapse;min-width:700px;font-size:11.5px;text-align:center;">'
        + '<thead>'
        + '<tr style="background:var(--gP,#f4f7f4);border-bottom:2px solid var(--br);">'
        + '<th style="padding:8px;border:1px solid var(--br);width:100px;text-align:left;font-weight:700;color:var(--td);">Day / Period</th>'
        + periods.map(function(p) { return '<th style="padding:8px 4px;border:1px solid var(--br);font-weight:700;color:var(--td);min-width:90px;">Period ' + p + '</th>'; }).join('')
        + '</tr>'
        + '</thead>'
        + '<tbody>'
        + days.map(function(d) {
            return '<tr>'
              + '<td style="padding:8px 10px;border:1px solid var(--br);font-weight:700;text-align:left;background:var(--bg2,#f8faf8);color:var(--td);">' + d + '</td>'
              + periods.map(function(p) {
                  var key = d + '_' + p;
                  var slot = slotMap.get(key);
                  if (!slot) return '<td style="padding:6px;border:1px solid var(--br);color:var(--tmu);background:#ffffff;">—</td>';
                  var isAdded = addedKeys.has(key);
                  var isMod = modifiedKeys.has(key);
                  var bg = isAdded ? '#f0fdf4' : (isMod ? '#fffbeb' : '#ffffff');
                  var border = isAdded ? '#86efac' : (isMod ? '#fde68a' : 'var(--br)');

                  return '<td style="padding:6px;border:1px solid ' + border + ';background:' + bg + ';text-align:left;vertical-align:top;">'
                    + '<div style="font-weight:700;color:var(--td);font-size:11.5px;line-height:1.2;">' + esc(slot.subject || '—') + '</div>'
                    + '<div style="font-size:11px;color:var(--tmu);margin-top:2px;">' + esc(slot.teacher || '—') + '</div>'
                    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;font-size:11px;">'
                    + '<span style="color:var(--tmu);font-weight:600;">' + esc(slot.room || '') + '</span>'
                    + (slot.isLab ? '<span class="pill" style="font-size:11px;padding:1px 4px;background:#fef3c7;color:#b45309;">Lab</span>' : '')
                    + '</div>'
                    + (isAdded ? '<div style="font-size:11px;color:#16a34a;font-weight:700;margin-top:2px;">+ Added</div>' : '')
                    + (isMod ? '<div style="font-size:11px;color:#d97706;font-weight:700;margin-top:2px;">~ Modified</div>' : '')
                    + '</td>';
                }).join('')
              + '</tr>';
          }).join('')
        + '</tbody></table>'
        + '</div>'
        + '</div>'

        + '<!-- TAB 2: WHAT CHANGED VIEW -->'
        + '<div id="hod-diff-tab-view" style="display:none;">'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;margin-bottom:16px;">'
        + '<div style="padding:10px;border-radius:8px;background:var(--bg2,#f8faf8);border:1px solid var(--br);text-align:center;"><div style="font-size:20px;font-weight:700;color:var(--td);">' + stats.totalSlots + '</div><div style="font-size:11px;color:var(--tmu);font-weight:600;">Total Slots</div></div>'
        + '<div style="padding:10px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0;text-align:center;"><div style="font-size:20px;font-weight:700;color:#16a34a;">+' + stats.addedCount + '</div><div style="font-size:11px;color:#166534;font-weight:600;">Added</div></div>'
        + '<div style="padding:10px;border-radius:8px;background:#fffbeb;border:1px solid #fde68a;text-align:center;"><div style="font-size:20px;font-weight:700;color:#d97706;">~' + stats.modifiedCount + '</div><div style="font-size:11px;color:#92400e;font-weight:600;">Modified</div></div>'
        + '<div style="padding:10px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;text-align:center;"><div style="font-size:20px;font-weight:700;color:#dc2626;">−' + stats.removedCount + '</div><div style="font-size:11px;color:#991b1b;font-weight:600;">Removed</div></div>'
        + '<div style="padding:10px;border-radius:8px;background:var(--bg2,#f8faf8);border:1px solid var(--br);text-align:center;"><div style="font-size:20px;font-weight:700;color:var(--td);">' + stats.unchangedCount + '</div><div style="font-size:11px;color:var(--tmu);font-weight:600;">Unchanged</div></div>'
        + '</div>'

        + '<div style="margin-bottom:16px;padding:12px 14px;border-radius:8px;background:var(--gP,#f4f7f4);border:1px solid var(--br);">'
        + '<div style="font-size:12px;font-weight:700;color:var(--td);margin-bottom:4px;">Submission Notes from Submitter:</div>'
        + '<div style="font-size:12.5px;color:var(--td);">' + esc((req.verificationRequest && req.verificationRequest.notes) || req.changeSummary || 'No notes provided.') + '</div>'
        + ((req.verificationRequest && req.verificationRequest.comment) ? '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--br);font-size:12px;color:#166534;"><b>HoD Remark:</b> ' + esc(req.verificationRequest.comment) + ' (' + esc(req.verificationRequest.approvedBy || 'HoD') + ')</div>' : '')
        + '</div>'

        + '<div>'
        + '<div style="font-size:12.5px;font-weight:700;color:var(--td);margin-bottom:8px;">Detailed Difference Breakdown</div>'
        + ((diff.added.length || diff.modified.length || diff.removed.length) ? '<div style="display:flex;flex-direction:column;gap:8px;">'
          + diff.modified.map(function(m) {
              return '<div style="padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;display:flex;align-items:flex-start;gap:8px;">'
                + '<span style="color:#d97706;font-size:14px;margin-top:1px;"><re-icon icon="refresh"></re-icon></span>'
                + '<div><b>' + m.day + ' Period ' + m.period + ':</b> Changed from <span style="text-decoration:line-through;color:var(--tmu);">' + esc((m.previous && m.previous.subject) || 'Empty') + ' (' + esc((m.previous && m.previous.teacher) || '—') + ', ' + esc((m.previous && m.previous.room) || '—') + ')</span> <re-icon icon="arrow-right"></re-icon> <b style="color:var(--td);">' + esc((m.current && m.current.subject) || 'Empty') + ' (' + esc((m.current && m.current.teacher) || '—') + ', ' + esc((m.current && m.current.room) || '—') + ')</b></div>'
                + '</div>';
            }).join('')
          + diff.added.map(function(a) {
              return '<div style="padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12px;display:flex;align-items:flex-start;gap:8px;">'
                + '<span style="color:#16a34a;font-size:14px;margin-top:1px;"><re-icon icon="check"></re-icon></span>'
                + '<div><b>' + a.day + ' Period ' + a.period + ':</b> <b style="color:#166534;">+ Added</b> ' + esc(a.subject || '—') + ' (' + esc(a.teacher || '—') + ', Room: ' + esc(a.room || '—') + ')</div>'
                + '</div>';
            }).join('')
          + diff.removed.map(function(r) {
              return '<div style="padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:12px;display:flex;align-items:flex-start;gap:8px;">'
                + '<span style="color:#dc2626;font-size:14px;margin-top:1px;"><re-icon icon="trash2"></re-icon></span>'
                + '<div><b>' + r.day + ' Period ' + r.period + ':</b> <b style="color:#991b1b;">− Removed</b> ' + esc(r.subject || '—') + ' (' + esc(r.teacher || '—') + ')</div>'
                + '</div>';
            }).join('')
          + '</div>' : '<div style="padding:20px;text-align:center;color:var(--tmu);font-size:12.5px;background:var(--bg2,#f8faf8);border-radius:8px;">No differences detected compared to active production schedule.</div>')
        + '</div>'
        + '</div>'
        + '</div>'

        + '<div class="modal-ft" style="display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:12px 20px;border-top:1px solid var(--br);">'
        + (isPending ? '<button type="button" class="btno" style="color:#dc2626;border-color:#fca5a5;padding:8px 16px;font-weight:600;" onclick="hodReviewTimetable(\'' + id + '\', \'reject\')"><re-icon icon="x"></re-icon> Reject</button>'
        + '<button type="button" class="btn-pri" style="background:#16a34a;padding:8px 20px;font-weight:700;" onclick="hodReviewTimetable(\'' + id + '\', \'approve\')"><re-icon icon="check"></re-icon> Approve Timetable</button>' : '')
        + '<button type="button" class="btn-out" onclick="closeHodMatrixModal()">Close</button>'
        + '</div>'
        + '</div>';

      document.body.appendChild(backdrop);

      var tabMatrix = document.getElementById('hod-tab-btn-matrix');
      var tabDiff = document.getElementById('hod-tab-btn-diff');
      var viewMatrix = document.getElementById('hod-matrix-tab-view');
      var viewDiff = document.getElementById('hod-diff-tab-view');

      if (tabMatrix) {
        tabMatrix.addEventListener('click', function() {
          tabMatrix.classList.add('act');
          if (tabDiff) tabDiff.classList.remove('act');
          if (viewMatrix) viewMatrix.style.display = 'block';
          if (viewDiff) viewDiff.style.display = 'none';
        });
      }

      if (tabDiff) {
        tabDiff.addEventListener('click', function() {
          tabDiff.classList.add('act');
          if (tabMatrix) tabMatrix.classList.remove('act');
          if (viewMatrix) viewMatrix.style.display = 'none';
          if (viewDiff) viewDiff.style.display = 'block';
        });
      }

    } catch (err) {
      if (typeof showToast === 'function') {
        showToast('Failed to load schedule details: ' + err.message, 'error');
      } else if (typeof dbToast === 'function') {
        dbToast('Failed to load schedule details: ' + err.message, 'error');
      } else {
        console.error('[openHodTimetableMatrixModal Error]:', err);
      }
      var matrixContainer = document.getElementById('hod-ver-matrix-content');
      if (matrixContainer) {
        matrixContainer.innerHTML = '<div style="padding:28px 16px;text-align:center;color:#b91c1c;">' +
          '<div style="font-weight:700;font-size:14px;margin-bottom:8px;"><re-icon icon="alert-circle" size="18"></re-icon> Failed to load timetable details</div>' +
          '<div style="font-size:12px;color:var(--tmu);margin-bottom:14px;">' + (typeof escapeHtml === 'function' ? escapeHtml(err.message) : err.message) + '</div>' +
          '<button type="button" class="btn-pri bsm" style="display:inline-flex;align-items:center;gap:6px;padding:6px 16px;" onclick="openHodTimetableMatrixModal(\'' + (typeof escapeHtml === 'function' ? escapeHtml(versionId) : versionId) + '\')"><re-icon icon="refresh-cw" size="13"></re-icon> Retry</button>' +
        '</div>';
      }
    }
  }

  window.loadHodTimetableVerificationPage = loadHodTimetableVerificationPage;
  window.filterHodTtRequests = filterHodTtRequests;
  window.reviewTimetable = reviewTimetable;
  window.hodReviewTimetable = hodReviewTimetable;
  window.openHodTimetableMatrixModal = openHodTimetableMatrixModal;
  window.closeHodMatrixModal = closeHodMatrixModal;
  window.updateHodTtVerificationBadge = updateHodTtVerificationBadge;

  // TEACHER HELPER FUNCTIONS
  function getMyAssignments() {
    var list = DB.get('assignments') || [];
    if (!currentUser) return list;
    var myIds = [
      String(currentUser._id || ''),
      String(currentUser.roleId || ''),
      String(currentUser.id || ''),
      String(currentUser.empId || '')
    ].filter(Boolean);

    var filtered = list.filter(function(a) {
      if (!a) return false;
      if (!a.teacherId) return true;
      return myIds.indexOf(String(a.teacherId)) !== -1 ||
             (currentUser.name && a.teacherName && a.teacherName.toLowerCase() === currentUser.name.toLowerCase());
    });
    return filtered.length > 0 ? filtered : list;
  }

  function toClassTrackId(classIdOrObj) {
    if (!classIdOrObj) return '';
    if (typeof classIdOrObj === 'object') {
      return classIdOrObj.trackId || classIdOrObj.classTrackId || classIdOrObj.name || String(classIdOrObj._id || classIdOrObj.id || '');
    }
    var idStr = String(classIdOrObj).trim();
    if (!idStr) return '';
    var classes = (typeof DB !== 'undefined' && DB.get) ? (DB.get('all-classes') || DB.get('classes') || []) : [];
    var found = classes.find(function(c) {
      return String(c._id) === idStr ||
             String(c.id) === idStr ||
             String(c.trackId) === idStr ||
             String(c.classTrackId) === idStr ||
             (c.name && String(c.name).toLowerCase() === idStr.toLowerCase());
    });
    if (!found && typeof getMyClasses === 'function') {
      var myCls = getMyClasses();
      found = myCls.find(function(c) {
        return String(c.id) === idStr ||
               String(c.rawId) === idStr ||
               String(c.trackId) === idStr ||
               String(c.classTrackId) === idStr ||
               (c.name && String(c.name).toLowerCase() === idStr.toLowerCase());
      });
    }
    if (found) {
      return found.trackId || found.classTrackId || found.name || idStr;
    }
    var cachedDays = (typeof DB !== 'undefined' && DB.get) ? (DB.get('schedule-days') || {}) : {};
    for (var k in cachedDays) {
      var day = cachedDays[k];
      if (day && Array.isArray(day.slots)) {
        var sMatch = day.slots.find(function(s) {
          return String(s.classId) === idStr || String(s.classTrackId) === idStr || String(s.className) === idStr;
        });
        if (sMatch) {
          return sMatch.classTrackId || sMatch.className || idStr;
        }
      }
    }
    return idStr;
  }
  window.toClassTrackId = toClassTrackId;

  function updateAttendanceUrlParams() {
    if (!window.history || !window.history.replaceState) return;
    var url = new URL(window.location);
    var curTab = url.searchParams.get('tab');
    if (curTab !== 'att') return;

    var clsEl = document.getElementById('attcls');
    var rawCls = clsEl ? (clsEl.value || '') : '';
    var trackId = toClassTrackId(rawCls);
    if (trackId) url.searchParams.set('classId', trackId);
    else url.searchParams.delete('classId');

    var dEl = document.getElementById('attdate');
    var dateVal = dEl ? (dEl.value || '') : '';
    if (dateVal) url.searchParams.set('date', dateVal);
    else url.searchParams.delete('date');

    var pEl = document.getElementById('attperiod');
    var periodVal = pEl ? (pEl.value || '') : '';
    if (periodVal) url.searchParams.set('period', periodVal);
    else url.searchParams.delete('period');

    window.history.replaceState(null, '', url);
  }
  window.updateAttendanceUrlParams = updateAttendanceUrlParams;
  function getMyClasses() {
    const seen = new Map();
    getMyAssignments().forEach(function(a) {
      if (a && a.classId) {
        var trk = a.classTrackId || a.trackId || (function() {
          var found = (DB.get('all-classes') || []).find(function(c) { return String(c._id) === String(a.classId); });
          return found ? (found.trackId || found.classTrackId || found.name) : '';
        })() || a.className || String(a.classId);
        if (!seen.has(String(a.classId))) {
          seen.set(String(a.classId), { id: trk, rawId: String(a.classId), trackId: trk, name: a.className });
        }
      }
    });
    var cachedDays = DB.get('schedule-days') || {};
    Object.keys(cachedDays).forEach(function(k) {
      var d = cachedDays[k];
      if (d && Array.isArray(d.slots)) {
        d.slots.forEach(function(s) {
          if (s.classId) {
            var trk = s.classTrackId || s.trackId || (function() {
              var found = (DB.get('all-classes') || []).find(function(c) { return String(c._id) === String(s.classId); });
              return found ? (found.trackId || found.classTrackId || found.name) : '';
            })() || s.className || String(s.classId);
            if (!seen.has(String(s.classId))) {
              seen.set(String(s.classId), { id: trk, rawId: String(s.classId), trackId: trk, name: s.className || 'Class' });
            }
          }
        });
      }
    });
    return Array.from(seen.values());
  }

  function getMySubjects() {
    const seen = new Map();
    getMyAssignments().forEach(function(a) {
      if (a && a.subjectId && !seen.has(String(a.subjectId))) seen.set(String(a.subjectId), { id: String(a.subjectId), name: a.subjectName });
    });
    var cachedDays = DB.get('schedule-days') || {};
    Object.keys(cachedDays).forEach(function(k) {
      var d = cachedDays[k];
      if (d && Array.isArray(d.slots)) {
        d.slots.forEach(function(s) {
          var sId = s.subjectId || s.subject;
          if (sId && !seen.has(String(sId))) {
            seen.set(String(sId), { id: String(sId), name: s.subjectName || s.subject || 'Subject' });
          }
        });
      }
    });
    return Array.from(seen.values());
  }

  function buildClassOptions(includeAll) {
    const allOption = includeAll ? '<option value="">All</option>' : '<option value="">— Select —</option>';
    return allOption + getMyClasses().map(function(c) {
      return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + '</option>';
    }).join('');
  }

  function buildSubjectOptions(includeAll) {
    const allOption = includeAll ? '<option value="">All</option>' : '<option value="">— Select —</option>';
    return allOption + getMySubjects().map(function(s) {
      return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + '</option>';
    }).join('');
  }

  function populateAllFilters() {
    // Populate class dropdowns
    ['fc', 'rfc', 'dfc', 'slc'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = buildClassOptions(true);
    });

    // Populate subject dropdowns
    ['fs', 'rfs', 'dfs'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = buildSubjectOptions(true);
    });

    // Attendance take page class & subject selectors (keep current pick)
    const attClassEl = document.getElementById('attcls');
    if (attClassEl) {
      if (typeof isForceTimetableSlots === 'function' && !isForceTimetableSlots()) {
        const keepCls = attClassEl.value;
        attClassEl.innerHTML = (typeof buildAttendanceClassOptions === 'function') ? buildAttendanceClassOptions(keepCls) : buildClassOptions(false);
        if (keepCls && attClassEl.querySelector('option[value="' + keepCls + '"]')) attClassEl.value = keepCls;
        if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('attcls');

        const attSubEl = document.getElementById('attsub');
        if (attSubEl) {
          const keepSub = attSubEl.value;
          attSubEl.innerHTML = (typeof buildAttendanceSubjectOptions === 'function') ? buildAttendanceSubjectOptions(keepSub, attClassEl.value) : '<option value="">— Select Subject —</option>';
          if (keepSub && attSubEl.querySelector('option[value="' + keepSub + '"]')) attSubEl.value = keepSub;
          if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('attsub');
        }
      }
    }

    // Set default date range (last 7 days)
    const today       = todayISO();
    const weekAgo     = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoISO  = localISO(weekAgo);

    ['ff', 'rff'].forEach(function(id) { const el = document.getElementById(id); if (el) el.value = weekAgoISO; });
    ['ft', 'rft'].forEach(function(id) { const el = document.getElementById(id); if (el) el.value = today;      });

    // Default attendance date to today
    const attDateEl = document.getElementById('attdate');
    if (attDateEl && !attDateEl.value) attDateEl.value = today;

    // Schedule modal class selector
    document.getElementById('schedcls').innerHTML = buildClassOptions(false);
  }

  function populateReportFilters() {
    document.getElementById('rfc').innerHTML = buildClassOptions(true);
    document.getElementById('rfs').innerHTML = buildSubjectOptions(true);
  }

  function populateDefaulterFilters() {
    document.getElementById('dfc').innerHTML = buildClassOptions(true);
    document.getElementById('dfs').innerHTML = buildSubjectOptions(true);
  }

  function populateStudentListFilters() {
    var slc = document.getElementById('slc');
    if (slc) slc.innerHTML = buildClassOptions(true);
    if (typeof updateStudentListSubtitle === 'function') updateStudentListSubtitle();
  }

  // DASHBOARD
  function initDashboard() {
    const firstName = String(currentUser.name || 'there').split(' ')[0];
    document.getElementById('dashsub').textContent = 'Welcome back, ' + firstName + '! Here\'s your day at a glance.';
    document.getElementById('todaylbl').textContent =
      new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

    renderTodaySchedule(todayISO());
    renderDefaultersMini();
    renderAttendanceChart();
    renderCalendar();
    renderNowAndNextHero();
    renderKpiStrip();

    // 30s auto-refresh for Today's Schedule live states
    if (!renderTodaySchedule._timer) {
      renderTodaySchedule._timer = setInterval(function() {
        if (document.hidden) return;
        var dash = document.getElementById('pg-dash');
        if (dash && dash.classList.contains('act')) {
          renderTodaySchedule(todayISO());
        }
      }, 30000);
    }
  }
  var initDash = initDashboard;

  function parseSlotTimeToMs(dateISO, timeStr) {
    if (!timeStr) return 0;
    var parts = String(timeStr).split(':');
    var d = new Date(dateISO + 'T00:00:00');
    d.setHours(parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0, 0, 0);
    return d.getTime();
  }

  function renderTodaySchedule(dateISO) {
    if (!dateISO) dateISO = todayISO();
    var isToday = (dateISO === todayISO());

    var dateLabelEl = document.getElementById('todaylbl');
    var containerEl = document.getElementById('todaysched');
    if (!containerEl) return;

    var dayData = getMyDay(dateISO);
    renderScheduleHealthStrip(dayData, dateISO);
    if (!dayData) {
      if (sessionStorage.getItem('eams_mustChangePw') === '1') {
        containerEl.innerHTML = '<div class="est"><span class="ei"><re-icon icon="shield-lock"></re-icon></span><p style="font-size:13px;font-weight:700;color:var(--td);">Password update required</p><p style="font-size:12px;color:var(--tmu);">Please update your temporary password to access your schedule.</p></div>';
        return;
      }
      containerEl.innerHTML = '<div class="est"><span class="ei"><re-icon icon="pin"></re-icon></span><p style="font-size:12px;">Loading today\'s schedule...</p></div>';
      return;
    }

    if (dayData.isHoliday) {
      if (dateLabelEl) {
        dateLabelEl.innerHTML = '<re-icon icon="tree"></re-icon> ' + escapeHtml(dayData.holidayReason || 'Holiday');
      }
      containerEl.innerHTML = '<div class="est"><span class="ei"><re-icon icon="tree"></re-icon></span><p style="font-size:13px;font-weight:700;color:var(--td);">' + escapeHtml(dayData.holidayReason || 'Holiday') + '</p><p style="font-size:12px;color:var(--tmu);">No classes scheduled for today.</p></div>';
      return;
    }

    if (dayData.onLeave) {
      if (dateLabelEl) {
        dateLabelEl.innerHTML = '<re-icon icon="tree"></re-icon> On Approved Leave';
      }
      containerEl.innerHTML = '<div class="est"><span class="ei"><re-icon icon="tree"></re-icon></span><p style="font-size:13px;font-weight:700;color:var(--td);">On Approved Leave (' + escapeHtml(dayData.leaveSlot || 'Full Day') + ')</p><p style="font-size:12px;color:var(--tmu);">Classes handled by assigned substitutes.</p></div>';
      return;
    }

    var rawSlots = Array.isArray(dayData.slots) ? dayData.slots.slice() : [];
    var slots = rawSlots.filter(function(s) {
      return !s.isSpanContinuation && !(Number(s.spanIndex) > 0);
    });
    if (!slots.length) {
      if (dateLabelEl) {
        dateLabelEl.textContent = new Date(dateISO + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
      }
      containerEl.innerHTML = '<div class="est"><span class="ei"><re-icon icon="pin"></re-icon></span><p style="font-size:12px;">No classes on this day.</p></div>';
      return;
    }

    // Sort by period number or start time
    slots.sort(function(a, b) {
      if (a.periodNumber !== b.periodNumber) return a.periodNumber - b.periodNumber;
      return String(a.start).localeCompare(String(b.start));
    });

    var now = Date.now();
    var leadMin = (currentUser.preferences && currentUser.preferences.promptLeadMinutes !== undefined)
      ? Number(currentUser.preferences.promptLeadMinutes)
      : 5;
    var leadMs = leadMin * 60 * 1000;

    var liveSlot = null;
    var nextSlot = null;
    var minUntilNext = Infinity;
    var allCompleted = true;

    var html = slots.map(function(slot) {
      var isDone = !!(slot.attendance && slot.attendance.marked);
      var isInactive = ['cancelled', 'substituted', 'holiday', 'leave'].includes(slot.status);
      var isSubRole = (slot.role === 'substitute');

      var sTime = parseSlotTimeToMs(dateISO, slot.start);
      var eTime = parseSlotTimeToMs(dateISO, slot.end);

      var state = 'upcoming';
      if (isDone) {
        state = 'done';
      } else if (isInactive) {
        state = slot.status;
        allCompleted = false;
      } else if (isToday) {
        allCompleted = false;
        if (now < sTime - leadMs) {
          state = 'upcoming';
          var diff = sTime - now;
          if (diff > 0 && diff < minUntilNext) {
            minUntilNext = diff;
            nextSlot = slot;
          }
        } else if (now >= sTime - leadMs && now < eTime) {
          state = 'live';
          liveSlot = slot;
        } else {
          state = 'pending';
        }
      } else {
        if (dateISO < todayISO()) {
          state = 'pending';
          allCompleted = false;
        } else {
          state = 'upcoming';
          allCompleted = false;
        }
      }

      var cardClass = 'scard';
      var actionHtml = '';
      var statusBadgeHtml = '';

      if (state === 'live') {
        cardClass += ' uc';
        statusBadgeHtml = '<span class="badge-live">NOW</span>';
        actionHtml = '<button class="btn-pri bsm" style="white-space:nowrap;padding:6px 14px;" onclick="navigateToAttendance(\'' + slot.classId + '\',\'' + (slot.subjectId || '') + '\',' + slot.periodNumber + ',\'' + dateISO + '\', ' + JSON.stringify(pNums) + ')">Take Attendance</button>';
      } else if (state === 'pending') {
        cardClass += ' uc';
        statusBadgeHtml = '<span class="badge-pending"><re-icon icon="hourglass"></re-icon> Attendance pending</span>';
        actionHtml = '<button class="btn-out bsm" style="white-space:nowrap;padding:5px 12px;" onclick="navigateToAttendance(\'' + slot.classId + '\',\'' + (slot.subjectId || '') + '\',' + slot.periodNumber + ',\'' + dateISO + '\', ' + JSON.stringify(pNums) + ')">Take Att.</button>';
      } else if (state === 'upcoming') {
        cardClass += ' uc';
        var minUntil = Math.ceil((sTime - now) / 60000);
        var timeLabel = (isToday && minUntil > 0 && minUntil <= 60)
          ? ('in ' + minUntil + ' min')
          : ('at ' + escapeHtml(slot.start));
        statusBadgeHtml = '<span style="font-size:11px;font-weight:600;color:var(--tmu);">' + timeLabel + '</span>';
        actionHtml = isToday
          ? '<button class="btn-out bsm" style="white-space:nowrap;padding:5px 12px;opacity:0.85;" onclick="navigateToAttendance(\'' + slot.classId + '\',\'' + (slot.subjectId || '') + '\',' + slot.periodNumber + ',\'' + dateISO + '\', ' + JSON.stringify(pNums) + ')">Take Att.</button>'
          : '<div style="font-size:11px;color:var(--tdi);">–</div>';
      } else if (state === 'done') {
        cardClass += ' dn';
        actionHtml = '<div class="donetag"><re-icon icon="check-circle"></re-icon> Done</div>';
      } else if (state === 'cancelled') {
        cardClass += ' dn';
        actionHtml = '<span class="badge-cancelled"><re-icon icon="forbidden-circle"></re-icon> Cancelled</span>';
      } else if (state === 'substituted') {
        cardClass += ' dn';
        actionHtml = '<span class="badge-substituted"><re-icon icon="refresh"></re-icon> Substituted (' + escapeHtml(slot.substituteTeacher || 'Faculty') + ')</span>';
      } else if (state === 'holiday') {
        cardClass += ' dn';
        actionHtml = '<span class="badge-holiday"><re-icon icon="tree"></re-icon> Holiday</span>';
      } else if (state === 'leave') {
        cardClass += ' dn';
        actionHtml = '<span class="badge-leave"><re-icon icon="tree"></re-icon> Leave</span>';
      }

      var roleBadgeHtml = isSubRole
        ? ' <span class="badge-sub-role"><re-icon icon="refresh"></re-icon> Substitute for ' + escapeHtml(slot.originalTeacher || 'Colleague') + '</span>'
        : '';

      var pNums = Array.isArray(slot.periods) && slot.periods.length ? slot.periods : (slot.periodNumbers && slot.periodNumbers.length ? slot.periodNumbers : [slot.periodNumber]);
      var periodText = pNums.length > 1 ? ('P' + pNums[0] + '–P' + pNums[pNums.length - 1]) : ('P' + slot.periodNumber);
      var periodLabel = slot.periodNumber
        ? ' <span style="font-weight:600;color:var(--tdi);font-size:11px;">· ' + periodText + '</span>'
        : '';

      return '<div class="' + cardClass + '">'
        + '<div class="stb"><div class="t">' + escapeHtml(slot.start) + '</div><span class="d">–' + escapeHtml(slot.end) + '</span></div>'
        + '<div class="sinfo">'
        +   '<div class="scls" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'
        +     '<span>' + escapeHtml(slot.className) + '</span>'
        +     periodLabel
        +     roleBadgeHtml
        +   '</div>'
        +   '<div class="ssub" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
        +     '<span>' + escapeHtml(slot.subjectName || slot.subject) + '</span>'
        +     (statusBadgeHtml ? statusBadgeHtml : '')
        +   '</div>'
        + '</div>'
        + actionHtml
        + '</div>';
    }).join('');

    containerEl.innerHTML = html;

    if (isToday) {
      if (typeof renderNowAndNextHero === 'function') renderNowAndNextHero();
      if (typeof renderKpiStrip === 'function') renderKpiStrip();
    }

    // Update Header #todaylbl
    if (dateLabelEl && isToday) {
      if (liveSlot) {
        dateLabelEl.innerHTML = '<span style="color:#15803d;font-weight:700;"><span class="status-dot green"></span> P' + liveSlot.periodNumber + ' · ' + escapeHtml(liveSlot.className) + ' in session</span>';
      } else if (nextSlot && minUntilNext !== Infinity) {
        var min = Math.ceil(minUntilNext / 60000);
        dateLabelEl.innerHTML = '<span style="color:var(--td);font-weight:600;">Next: P' + nextSlot.periodNumber + ' · ' + escapeHtml(nextSlot.className) + ' in ' + min + ' min</span>';
      } else if (allCompleted) {
        dateLabelEl.innerHTML = '<span style="color:#16a34a;font-weight:600;"><re-icon icon="check-circle"></re-icon> All classes completed today</span>';
      } else {
        dateLabelEl.textContent = new Date(dateISO + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
      }
    } else if (dateLabelEl) {
      dateLabelEl.textContent = new Date(dateISO + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    }
  }

  // Has attendance already been recorded for this slot on this date?
  function isSlotMarked(slot, dateISO, attendance) {
    return (attendance || DB.get('attendance')).some(function(a) {
      if (String(a.classId) !== String(slot.classId) || a.date !== dateISO) return false;
      if (slot.subjectId && String(a.subjectId) !== String(slot.subjectId)) return false;
      if (slot.periodNumber && a.periodNumber && Number(a.periodNumber) !== Number(slot.periodNumber)) return false;
      return true;
    });
  }

  // Coordinated slot selection and attendance roster hydration
  async function applyTargetAttendanceSlot(classId, subjectId, periodNumber, dateISO, periodNumbers, autoLoadSheet) {
    var classTrackId = toClassTrackId(classId);
    window._pendingAttTarget = {
      classId: classTrackId || classId,
      rawClassId: classId,
      subjectId: subjectId,
      periodNumber: periodNumber,
      dateISO: dateISO,
      periodNumbers: periodNumbers,
      autoLoadSheet: autoLoadSheet,
      timestamp: Date.now()
    };

    if (dateISO) {
      var dEl = document.getElementById('attdate');
      if (dEl) dEl.value = dateISO;
    }

    if (typeof nav === 'function') {
      nav('att');
    }

    // Set URL query parameters with class trackId and session details
    if (window.history && window.history.replaceState) {
      var url = new URL(window.location);
      url.searchParams.set('tab', 'att');
      if (classTrackId) url.searchParams.set('classId', classTrackId);
      if (dateISO) url.searchParams.set('date', dateISO);
      if (periodNumber) url.searchParams.set('period', periodNumber);
      window.history.replaceState(null, '', url);
    }

    if (typeof isForceTimetableSlots === 'function' && isForceTimetableSlots()) {
      if (typeof initAttendancePageStrict === 'function') {
        initAttendancePageStrict(classId, periodNumber, subjectId, periodNumbers);
      }
      if (autoLoadSheet) {
        setTimeout(function() {
          if (typeof loadAttendanceSheet === 'function') loadAttendanceSheet();
        }, 350);
      }
      return;
    }

    try {
      if (!DB.get('all-classes') || !DB.get('all-subjects')) {
        await fetchAllClassesAndSubjects();
      }
    } catch (e) {
      console.warn('[applyTargetAttendanceSlot] fetchAllClassesAndSubjects error:', e);
    }

    // 1. Hydrate Class dropdown
    var classEl = document.getElementById('attcls');
    if (classEl && classId) {
      classEl.innerHTML = buildAttendanceClassOptions(classId);
      var hasOpt = Array.from(classEl.options).some(function(o) { return String(o.value) === String(classId); });
      if (!hasOpt) {
        var dayData = getMyDay(dateISO || todayISO());
        var matchSlot = dayData && dayData.slots && dayData.slots.find(function(s) { return String(s.classId) === String(classId); });
        var clsName = matchSlot ? matchSlot.className : 'Class';
        var opt = document.createElement('option');
        opt.value = classId;
        opt.textContent = clsName;
        classEl.appendChild(opt);
      }
      classEl.value = String(classId);
      if (typeof SearchableDropdown !== 'undefined') {
        SearchableDropdown.sync('attcls');
      }
    }

    // 2. Hydrate Period dropdown
    if (periodNumber) {
      var pEl = document.getElementById('attperiod');
      if (pEl) {
        pEl.value = String(periodNumber);
        if (Array.isArray(periodNumbers) && periodNumbers.length > 0) {
          var matchOpt = Array.from(pEl.options || []).find(function(o) {
            return o.value === String(periodNumber) || (o.getAttribute('data-periods') && o.getAttribute('data-periods') === periodNumbers.join(','));
          });
          if (matchOpt) matchOpt.selected = true;
        }
      }
    }

    // 3. Hydrate Date
    if (dateISO) {
      var dEl2 = document.getElementById('attdate');
      if (dEl2) dEl2.value = dateISO;
    }

    // 4. Hydrate Subject dropdown
    var subjectEl = document.getElementById('attsub');
    if (subjectEl && subjectId) {
      subjectEl.innerHTML = buildAttendanceSubjectOptions(subjectId, classId);
      var hasSubOpt = Array.from(subjectEl.options).some(function(o) { return String(o.value) === String(subjectId); });
      if (!hasSubOpt) {
        var dayData2 = getMyDay(dateISO || todayISO());
        var matchSlot2 = dayData2 && dayData2.slots && dayData2.slots.find(function(s) {
          return String(s.classId) === String(classId) && (String(s.subjectId) === String(subjectId) || String(s.periodNumber) === String(periodNumber));
        });
        var subName = matchSlot2 ? (matchSlot2.subjectName || matchSlot2.subject) : 'Subject';
        var sOpt = document.createElement('option');
        sOpt.value = subjectId;
        sOpt.textContent = subName;
        subjectEl.appendChild(sOpt);
      }
      subjectEl.value = String(subjectId);
      if (typeof SearchableDropdown !== 'undefined') {
        SearchableDropdown.sync('attsub');
      }
    }

    checkTimetableMatch();
    rememberAttendanceSelection();
    window._pendingAttTarget = null;

    if (autoLoadSheet && typeof loadAttendanceSheet === 'function') {
      loadAttendanceSheet();
    }
  }
  window.applyTargetAttendanceSlot = applyTargetAttendanceSlot;

  function navigateToAttendance(classId, subjectId, periodNumber, dateISO, periodNumbers) {
    return applyTargetAttendanceSlot(classId, subjectId, periodNumber, dateISO, periodNumbers, false);
  }
  window.navigateToAttendance = navigateToAttendance;
  var navAtt = navigateToAttendance;
  window.navAtt = navigateToAttendance;

  function renderDefaultersMini() {
    const allAttendance = DB.get('attendance');
    const allStudents   = DB.get('students');
    const defaulterList = [];

    getMyAssignments().forEach(function(assignment) {
      allStudents.filter(function(s) { return s.classId === assignment.classId; }).forEach(function(student) {
        // allAttendance is already scoped to this teacher by the API. Records
        // carry the teacher *trackId*, so comparing with currentUser._id
        // (Mongo id) always failed and the widget never showed anyone.
        const stuAtt = allAttendance.filter(function(a) {
          return String(a.studentId) === String(student._id) && String(a.subjectId) === String(assignment.subjectId);
        });
        if (!stuAtt.length) return;
        const pct = Math.round(stuAtt.filter(function(a) { return a.status === 'present'; }).length / stuAtt.length * 100);
        if (pct < 75) defaulterList.push(Object.assign({}, student, { pct: pct, subjectName: assignment.subjectName }));
      });
    });

    document.getElementById('defcnt').textContent = defaulterList.length;
    const containerEl = document.getElementById('defmini');

    if (!defaulterList.length) {
      containerEl.innerHTML = '<div class="est"><span class="ei"><re-icon icon="party"></re-icon></span><p style="font-size:12px;">No defaulters!</p></div>';
      return;
    }

    defaulterList.sort(function(a, b) { return a.pct - b.pct; });
    containerEl.innerHTML = defaulterList.slice(0, 5).map(function(d) {
      return '<div class="defrow">'
        + '<div class="defav">' + escapeHtml((d.name || '?')[0]) + '</div>'
        + '<div style="flex:1;min-width:0;">'
        + '<div style="font-size:11.5px;font-weight:700;color:var(--td);">' + escapeHtml(d.name) + '</div>'
        + '<div style="font-size:11px;color:var(--tdi);">' + escapeHtml(d.regNo || d.registerNo || '') + ' · ' + escapeHtml(d.subjectName) + '</div>'
        + '</div>'
        + '<div style="font-size:13px;font-weight:800;color:#dc2626;">' + d.pct + '%</div>'
        + '</div>';
    }).join('');
  }

  // ATTENDANCE CHART
  function setRange(rangeType) {
    // Remove active class from all range pills
    ['rpw','rplw','rpm'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('act');
    });

    const _tParts = todayISO().split('-').map(Number);
    const today = new Date(_tParts[0], _tParts[1] - 1, _tParts[2]);
    let fromDate, toDate = localISO(today);

    if (rangeType === 'week') {
      document.getElementById('rpw').classList.add('act');
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      fromDate = localISO(monday);
    } else if (rangeType === 'lweek') {
      document.getElementById('rplw').classList.add('act');
      const lastMon = new Date(today);
      lastMon.setDate(today.getDate() - ((today.getDay() + 6) % 7) - 7);
      fromDate = localISO(lastMon);
      const lastSat = new Date(lastMon);
      lastSat.setDate(lastMon.getDate() + 5); // Mon–Sat working week
      toDate   = localISO(lastSat);
    } else {
      // 'month'
      document.getElementById('rpm').classList.add('act');
      fromDate = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-01';
    }

    document.getElementById('ff').value = fromDate;
    document.getElementById('ft').value = toDate;
    renderAttendanceChart();
  }

  function renderAttendanceChart() {
    const classFilter   = document.getElementById('fc')  ? document.getElementById('fc').value  : '';
    const subjectFilter = document.getElementById('fs')  ? document.getElementById('fs').value  : '';
    const fromDate      = document.getElementById('ff')  ? document.getElementById('ff').value  : '';
    const toDate        = document.getElementById('ft')  ? document.getElementById('ft').value  : '';

    // Already teacher-scoped by the API (records carry the teacher trackId, so
    // the old `a.teacherId === currentUser._id` filter emptied the chart).
    let attendance = DB.get('attendance').slice();
    if (classFilter)   attendance = attendance.filter(function(a) { return String(a.classId)   === String(classFilter); });
    if (subjectFilter) attendance = attendance.filter(function(a) { return String(a.subjectId) === String(subjectFilter); });
    if (fromDate)      attendance = attendance.filter(function(a) { return a.date >= fromDate; });
    if (toDate)        attendance = attendance.filter(function(a) { return a.date <= toDate; });

    // Group by date
    const byDate = {};
    attendance.forEach(function(a) {
      if (!byDate[a.date]) byDate[a.date] = { present: 0, absent: 0 };
      byDate[a.date][a.status === 'present' ? 'present' : 'absent']++;
    });

    const sortedDates = Object.keys(byDate).sort().slice(-14);
    const chartEl     = document.getElementById('bchart');

    if (!sortedDates.length) {
      chartEl.innerHTML = '<div style="text-align:center;width:100%;color:var(--tdi);font-size:12px;align-self:center;">No data for selected filters.</div>';
      ['csv-p','csv-a'].forEach(function(id) { document.getElementById(id).textContent = '—'; });
      document.getElementById('csv-pct').textContent = '—%';
      return;
    }

    let totalPresent = 0, totalAbsent = 0;

    chartEl.innerHTML = sortedDates.map(function(date) {
      const counts  = byDate[date];
      const total   = counts.present + counts.absent;
      const pct     = total ? Math.round(counts.present / total * 100) : 0;
      totalPresent += counts.present;
      totalAbsent  += counts.absent;

      const barClass = pct >= 75 ? 'hi' : pct >= 50 ? 'mi' : 'lo';
      const dayLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 2);
      const isToday  = date === todayISO();

      return '<div class="bcol">'
        + '<div class="bout"><span class="bpct">' + pct + '%</span>'
        + '<div class="bpill ' + barClass + '" style="height:' + Math.max(6, pct) + '%;min-height:6px;" title="' + date + ': ' + counts.present + 'P/' + counts.absent + 'A"></div>'
        + '</div>'
        + '<div class="bday ' + (isToday ? 'td' : '') + '">' + dayLabel + '</div>'
        + '</div>';
    }).join('');

    const grandTotal = totalPresent + totalAbsent;
    document.getElementById('csv-p').textContent   = totalPresent;
    document.getElementById('csv-a').textContent   = totalAbsent;
    document.getElementById('csv-pct').textContent = (grandTotal ? Math.round(totalPresent / grandTotal * 100) : 0) + '%';
  }
  var renderChart = renderAttendanceChart;

  // CALENDAR
  let calendarYear  = new Date().getFullYear();
  let calendarMonth = new Date().getMonth();
  let selectedCalDate = todayISO();

  function initCalendar() {
    calendarYear  = new Date().getFullYear();
    calendarMonth = new Date().getMonth();
    renderCalendar();
  }
  var initCal = initCalendar;

  function calendarNavigate(direction) {
    calendarMonth += direction;
    if (calendarMonth > 11) { calendarMonth = 0;  calendarYear++; }
    else if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    renderCalendar();
  }
  var calNav = calendarNavigate;

  function renderCalendar() {
    const monthNames = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];
    document.getElementById('calmth').textContent = monthNames[calendarMonth] + ' ' + calendarYear;

    const myTimetable = getMyTimetable();
    const firstDayOfMonth  = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInMonth      = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const todayDateISO     = todayISO();

    // Build header row
    let calHTML = ['Mo','Tu','We','Th','Fr','Sa','Su'].map(function(d) {
      return '<div class="caldow">' + d + '</div>';
    }).join('');

    // Empty cells before first day
    for (let i = 0; i < (firstDayOfMonth + 6) % 7; i++) {
      calHTML += '<div class="cday emp"></div>';
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const isoDate  = calendarYear + '-' + String(calendarMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const dayOfWk  = new Date(isoDate + 'T00:00:00').getDay();
      const isWeekend = dayOfWk === 0 || dayOfWk === 6;
      // Saturday is a working day when the timetable has Sat slots.
      const hasClass  = dayOfWk !== 0 && myTimetable.some(function(t) { return t.day === DAY_NAMES[dayOfWk]; });
      const isToday   = isoDate === todayDateISO;
      const isSelected = isoDate === selectedCalDate && !isToday;

      const dayData = (DB.get('schedule-days') || {})[isoDate];
      const hasSubOut = dayData && (dayData.onLeave || (dayData.slots || []).some(function(s) { return s.status === 'substituted' || s.status === 'leave'; }));
      const hasSubIn  = dayData && (dayData.slots || []).some(function(s) { return s.role === 'substitute'; });
      const isHol     = dayData ? dayData.isHoliday : (dayOfWk === 0);

      const classes = ['cday',
        isToday    ? 'today'   : '',
        isSelected ? 'sel'     : '',
        hasClass   ? 'hc'      : '',
        isWeekend  ? 'wknd'    : '',
        hasSubOut  ? 'has-sub-out' : '',
        hasSubIn   ? 'has-sub-in'  : '',
        isHol      ? 'has-holiday' : ''
      ].filter(Boolean).join(' ');

      calHTML += '<div class="' + classes + '" onclick="selectCalendarDate(\'' + isoDate + '\')">' + day + '</div>';
    }

    document.getElementById('calgrid').innerHTML = calHTML;
  }
  var renderCal = renderCalendar;

  function selectCalendarDate(isoDate) {
    selectedCalDate = isoDate;
    renderCalendar();
    renderTodaySchedule(isoDate);
  }
  var selCal = selectCalendarDate;

  // NOTIFICATIONS
  var _currentReviewLeaveId = null;
  var _currentReviewNotifId = null;

  function syncTeacherNotifications() {
    var tok = getToken();
    if (!tok) return Promise.resolve([]);
    return api('/api/notifications', { headers: { 'Authorization': 'Bearer ' + tok, 'X-Background-Request': 'true' }, background: true })
      .then(function(r) { return r.ok ? r.json() : []; })
      .then(function(data) {
        var rows = Array.isArray(data) ? data : [];
        DB.set('teacher-notifications', rows);
        renderNotifications();
        return rows;
      }).catch(function() { return []; });
  }

  window._notifFilter = 'all';

  function filterNotifications(filterCategory, ev) {
    if (ev) ev.stopPropagation();
    window._notifFilter = filterCategory || 'all';
    document.querySelectorAll('.nd-filter-btn').forEach(function(b) {
      if (b.getAttribute('data-filter') === window._notifFilter) b.classList.add('act');
      else b.classList.remove('act');
    });
    renderNotifications();
  }
  window.filterNotifications = filterNotifications;

  function renderNotifications() {
    var allNotifs = DB.get('teacher-notifications') || [];
    const unreadCount = allNotifs.filter(function(n) { return !n.read; }).length;
    var nbadge = document.getElementById('nbadge');
    if (nbadge) nbadge.textContent = unreadCount;

    var unreadPill = document.getElementById('nd-unread-count-pill');
    if (unreadPill) {
      unreadPill.textContent = unreadCount + ' unread';
      unreadPill.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    }

    var unreadApprovalsCount = 0;
    var unreadAlertsCount = 0;

    allNotifs.forEach(function(n) {
      const isTt = n.type === 'timetable-verification' || !!n.timetableVersionId || (n.message && n.message.toLowerCase().includes('timetable verification'));
      const isLeave = (n.type === 'leave-request' || !!n.leaveRequestId);
      const isAppr = isTt || isLeave || n.type === 'od-request' || n.type === 'device-verification';
      const isAlt = n.type === 'attendance-alert' || n.type === 'alert' || n.priority === 'High' || n.priority === 'Urgent';
      if (!n.read && isAppr) unreadApprovalsCount++;
      if (!n.read && isAlt) unreadAlertsCount++;
    });

    var bAppr = document.getElementById('notif-badge-approvals');
    if (bAppr) {
      bAppr.textContent = unreadApprovalsCount;
      bAppr.style.display = unreadApprovalsCount > 0 ? 'inline-block' : 'none';
    }
    var bAlt = document.getElementById('notif-badge-alerts');
    if (bAlt) {
      bAlt.textContent = unreadAlertsCount;
      bAlt.style.display = unreadAlertsCount > 0 ? 'inline-block' : 'none';
    }

    const listEl = document.getElementById('ndlist');
    if (!listEl) return;
    if (!allNotifs.length) {
      listEl.innerHTML = UIStates.empty({
        icon: 'bell',
        title: 'No notifications',
        message: 'You are completely caught up.'
      });
      return;
    }

    // Filter by active category (C7)
    var filtered = allNotifs.slice().reverse().filter(function(n) {
      if (window._notifFilter === 'all') return true;
      const isTt = n.type === 'timetable-verification' || !!n.timetableVersionId || (n.message && n.message.toLowerCase().includes('timetable verification'));
      const isLeave = (n.type === 'leave-request' || !!n.leaveRequestId);
      const isAppr = isTt || isLeave || n.type === 'od-request' || n.type === 'device-verification' || n.type === 'leave-approval';
      const isAlt = n.type === 'attendance-alert' || n.type === 'alert' || n.priority === 'High' || n.priority === 'Urgent';
      if (window._notifFilter === 'approvals') return isAppr;
      if (window._notifFilter === 'alerts') return isAlt;
      return true;
    });

    if (!filtered.length) {
      listEl.innerHTML = UIStates.empty({
        icon: 'bell',
        title: 'No ' + window._notifFilter + ' notifications',
        message: 'No notifications found in this category.'
      });
      return;
    }

    // Relative Date Grouping (Today, Yesterday, Earlier)
    var todayStr = new Date().toDateString();
    var yestDate = new Date();
    yestDate.setDate(yestDate.getDate() - 1);
    var yestStr = yestDate.toDateString();

    var groups = { 'Today': [], 'Yesterday': [], 'Earlier': [] };

    filtered.forEach(function(n) {
      var d = new Date(n.time || n.createdAt || Date.now());
      var dStr = d.toDateString();
      if (dStr === todayStr) groups['Today'].push(n);
      else if (dStr === yestStr) groups['Yesterday'].push(n);
      else groups['Earlier'].push(n);
    });

    var renderItem = function(n) {
      const isTtVerification = n.type === 'timetable-verification' || !!n.timetableVersionId || (n.message && n.message.toLowerCase().includes('timetable verification'));
      const isLeaveReq = (n.type === 'leave-request' || !!n.leaveRequestId) && !isTtVerification;
      const isLeaveStatus = (n.type === 'leave-approval' || n.type === 'leave-substitution' || n.type === 'leave-rejection') && !isTtVerification;
      const isAlert    = (n.type === 'attendance-alert' || n.type === 'alert') && !isTtVerification;
      const isAdminMsg = n.from === 'Administrator' && !isTtVerification;
      const iconCode   = isTtVerification ? '<re-icon icon="grid"></re-icon>'
                       : (isLeaveReq ? '<re-icon icon="clipboard"></re-icon>'
                       : (isLeaveStatus ? '<re-icon icon="calendar"></re-icon>'
                       : (isAlert ? '<re-icon icon="alert-triangle"></re-icon>'
                       : (isAdminMsg ? '<re-icon icon="bell"></re-icon>' : '<re-icon icon="info"></re-icon>'))));
      const iconBg     = isTtVerification ? 'background:rgba(217,119,6,.14);color:#b45309;'
                       : (isLeaveReq ? 'background:rgba(16,185,129,.14);color:#059669;'
                       : (isLeaveStatus ? 'background:rgba(99,102,241,.14);color:#4f46e5;'
                       : (isAlert ? 'background:rgba(245,158,11,.12);color:#92400e;'
                       : (isAdminMsg ? 'background:rgba(59,130,246,.1);color:#1d4ed8;'
                       : 'background:var(--gLt);color:var(--gD);'))));
      const priorityBadge = n.priority && n.priority !== 'Normal'
        ? '<span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;margin-left:5px;">' + escapeHtml(n.priority) + '</span>'
        : '';
      const clickAction = isTtVerification
        ? 'onclick="handleTtNotifClick(\x27' + (n.timetableVersionId || '') + '\x27,\x27' + n._id + '\x27)"'
        : (isLeaveReq
          ? 'onclick="openLeaveReviewModal(\x27' + (n.leaveRequestId || '') + '\x27,\x27' + n._id + '\x27)"'
          : (isLeaveStatus
            ? 'onclick="handleLeaveNotifClick(\x27' + n._id + '\x27)"'
            : 'onclick="markNotificationRead(\x27' + n._id + '\x27)"'));

      const footerAction = isTtVerification
        ? ' &bull; <span style="color:#b45309;font-weight:700;">Click to Review Matrix</span>'
        : (isLeaveReq
          ? ' &bull; <span style="color:var(--gD);font-weight:700;">Click to Review</span>'
          : (isLeaveStatus
            ? ' &bull; <span style="color:var(--pD,#6366f1);font-weight:700;">View in Leaves</span>'
            : ''));

      const isRead = Boolean(n.read || n.status === 'Read');
      const isSolved = n.status === 'Solved';
      const statusBadge = isSolved
        ? '<span style="background:#f0fdf4;color:#15803d;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;margin-left:auto;display:inline-flex;align-items:center;gap:3px;"><re-icon icon="check-check"></re-icon> Solved</span>'
        : (isRead
          ? '<span style="background:#f0fdf4;color:#15803d;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;margin-left:auto;display:inline-flex;align-items:center;gap:3px;"><re-icon icon="check-check"></re-icon> Read</span>'
          : '<span style="background:rgba(59,130,246,.1);color:#1d4ed8;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;margin-left:auto;display:inline-flex;align-items:center;gap:3px;"><re-icon icon="check"></re-icon> Delivered</span>');

      const ttButtons = (isTtVerification && !isSolved && n.status !== 'Cancelled')
        ? '<div style="display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap;">'
        + '<button type="button" class="btn btn-out btn-sm" onclick="event.stopPropagation();handleTtNotifClick(\x27' + (n.timetableVersionId || '') + '\x27,\x27' + n._id + '\x27)" style="font-size:11.5px;padding:3px 8px;"><re-icon icon="grid" size="12"></re-icon> View Matrix</button>'
        + '<button type="button" class="btn btn-pri btn-sm" onclick="event.stopPropagation();notifReviewTt(\x27' + (n.timetableVersionId || '') + '\x27, \x27approve\x27, \x27' + n._id + '\x27)" style="background:#16a34a;font-weight:700;font-size:11.5px;padding:3px 10px;"><re-icon icon="check" size="12"></re-icon> Approve</button>'
        + '<button type="button" class="btn btn-danger btn-sm" onclick="event.stopPropagation();notifReviewTt(\x27' + (n.timetableVersionId || '') + '\x27, \x27reject\x27, \x27' + n._id + '\x27)" style="font-size:11.5px;padding:3px 8px;"><re-icon icon="x" size="12"></re-icon> Reject</button>'
        + '</div>'
        : '';

      return '<div class="ndi ' + (n.read ? '' : 'unread') + '" ' + clickAction + ' style="cursor:pointer;" title="' + (!isRead ? 'Click to mark as read' : '') + '">'
        + '<div class="ndic" style="' + iconBg + '">' + iconCode + '</div>'
        + '<div style="flex:1;">'
        + '<div style="font-size:13px;font-weight:700;color:var(--td);display:flex;align-items:center;">' + escapeHtml(n.from) + priorityBadge + statusBadge + '</div>'
        + '<div style="font-size:12px;color:var(--tmu);margin-top:3px;line-height:1.4;">' + escapeHtml(n.message) + '</div>'
        + ttButtons
        + '<div style="font-size:11px;color:var(--tdi);margin-top:5px;">' + timeAgo(n.time || n.createdAt) + footerAction + '</div>'
        + '</div></div>';
    };

    var finalHtml = '';
    ['Today', 'Yesterday', 'Earlier'].forEach(function(grp) {
      if (groups[grp] && groups[grp].length) {
        finalHtml += '<div class="nd-group-header">' + grp + ' (' + groups[grp].length + ')</div>'
                   + groups[grp].map(renderItem).join('');
      }
    });

    listEl.innerHTML = finalHtml;
  }

  function notifReviewTt(versionId, action, notifId) {
    return reviewTimetable(versionId, action, notifId);
  }
  window.notifReviewTt = notifReviewTt;

  function handleTtNotifClick(versionId, notifId) {
    if (notifId) markNotificationRead(notifId);
    var dd = document.getElementById('ndrop') || document.getElementById('ndd');
    if (dd) dd.classList.remove('open');
    if (versionId && typeof openHodTimetableMatrixModal === 'function') {
      openHodTimetableMatrixModal(versionId);
    } else if (typeof navigateToTab === 'function') {
      navigateToTab('tt-verify');
    }
  }
  window.handleTtNotifClick = handleTtNotifClick;

  function handleLeaveNotifClick(notifId) {
    if (notifId) markNotificationRead(notifId);
    if (typeof closeModalBg === 'function') closeModalBg('m-notifications');
    var dd = document.getElementById('ndd');
    if (dd) dd.classList.remove('open');
    if (typeof navigateToTab === 'function') navigateToTab('my-leaves');
    if (typeof loadMyTeacherLeaves === 'function') loadMyTeacherLeaves();
  }
  window.handleLeaveNotifClick = handleLeaveNotifClick;

  function _populateRequestHistory(history, sectionId, listId) {
    var section = document.getElementById(sectionId);
    var list = document.getElementById(listId);
    if (!section || !list) return;

    var items = [];
    if (Array.isArray(history)) {
      history.forEach(function(h) {
        var dateVal = h.appliedOn || h.fromDate || h.createdAt;
        var dateFormatted = dateVal ? formatDDMMYYYY(dateVal) : '—';
        items.push({
          type: (h.kind || 'od').toUpperCase(),
          label: h.title || h.requestId || 'Request',
          status: h.status || 'Pending',
          date: dateVal,
          dateFormatted: dateFormatted,
          days: h.days || 1
        });
      });
    } else if (history && typeof history === 'object') {
      (history.leaves || []).forEach(function(l) {
        items.push({
          type: 'LEAVE',
          label: (l.category || 'Leave') + (l.leaveType ? ' (' + l.leaveType + ')' : ''),
          status: l.status || l.advisorStatus || '—',
          date: l.fromDate || l.createdAt,
          dateFormatted: l.fromDate ? formatDDMMYYYY(l.fromDate) : '—',
          days: l.daysCount || 1
        });
      });
      (history.ods || []).forEach(function(o) {
        items.push({
          type: 'OD',
          label: (o.eventDetails && o.eventDetails.name) || o.eventName || 'OD Request',
          status: o.status || '—',
          date: o.dates && o.dates[0] ? o.dates[0] : o.createdAt,
          dateFormatted: o.dates && o.dates[0] ? formatDDMMYYYY(o.dates[0]) : (o.createdAt ? formatDDMMYYYY(o.createdAt) : '—'),
          days: o.dates ? o.dates.length : 1
        });
      });
    }

    if (!items.length) {
      section.style.display = 'none';
      return;
    }
    section.style.display = '';

    items.sort(function(a, b) { return new Date(b.date || 0) - new Date(a.date || 0); });

    var html = '<table style="width:100%;border-collapse:collapse;font-size:11.5px;">';
    html += '<thead><tr style="background:var(--gP);"><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--brl);">Type</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--brl);">Details</th><th style="padding:6px 8px;text-align:center;border-bottom:1px solid var(--brl);">Status</th></tr></thead><tbody>';
    items.forEach(function(item) {
      var s = String(item.status || '').toLowerCase();
      var statusColor = (s === 'approved' || s === 'completed') ? '#16a34a' : (s === 'rejected' ? '#dc2626' : '#d97706');
      var typeBg = item.type === 'OD' ? '#ede9fe;color:#6d28d9' : '#dcfce7;color:#166534';
      html += '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--brl);white-space:nowrap;"><span style="background:' + typeBg + ';font-size:11px;font-weight:800;padding:2px 6px;border-radius:6px;">' + escapeHtml(item.type) + '</span></td>';
      html += '<td style="padding:6px 8px;border-bottom:1px solid var(--brl);"><div style="font-weight:700;color:var(--td);">' + escapeHtml(item.label) + '</div><div style="font-size:11px;color:var(--tmu);">' + escapeHtml(item.dateFormatted || '') + ' · ' + item.days + 'd</div></td>';
      html += '<td style="padding:6px 8px;border-bottom:1px solid var(--brl);text-align:center;"><span style="color:' + statusColor + ';font-weight:700;font-size:11px;">' + escapeHtml(item.status) + '</span></td></tr>';
    });
    html += '</tbody></table>';
    list.innerHTML = html;
  }

  function openLeaveReviewModal(leaveRequestId, notifId) {
    if (!leaveRequestId) return;
    _currentReviewLeaveId = leaveRequestId;
    _currentReviewNotifId = notifId;

    document.getElementById('lr-student-info').textContent = 'Loading student details…';
    document.getElementById('lr-stat-pct').textContent = '—%';
    document.getElementById('lr-stat-classes').textContent = '— / —';
    document.getElementById('lr-stat-past-leaves').textContent = '—';
    var odStatEl = document.getElementById('lr-stat-od-taken');
    if (odStatEl) odStatEl.textContent = '—';
    document.getElementById('lr-dates-display').innerHTML = '<re-icon icon="calendar"></re-icon> Date: —';
    document.getElementById('lr-reason-display').textContent = 'Loading…';
    document.getElementById('lr-remarks').value = '';
    var trackerPanel = document.getElementById('lr-tracker-panel');
    if (trackerPanel) trackerPanel.innerHTML = '';
    var histSection = document.getElementById('lr-history-section');
    if (histSection) histSection.style.display = 'none';
    var actionBtns = document.getElementById('lr-action-buttons');
    if (actionBtns) actionBtns.style.display = '';
    var remarksSection = document.getElementById('lr-remarks-section');
    if (remarksSection) remarksSection.style.display = '';

    openModal('m-leave-review');

    var tok = getToken();
    api('/api/leave/detail/' + encodeURIComponent(leaveRequestId), {
      headers: { 'Authorization': 'Bearer ' + tok }
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error || !d.leaveRequest) {
        showToast(d.error || 'Failed to load leave details', 'warn');
        return;
      }
      var req = d.leaveRequest;
      var stats = d.studentStats || {};
      var totals = d.studentTotals || {};

      document.getElementById('lr-student-info').textContent = req.studentName + ' (' + req.studentRegNo + ') — ' + req.className;

      var pct = stats.overallPercentage !== undefined ? stats.overallPercentage : 100;
      var pctEl = document.getElementById('lr-stat-pct');
      pctEl.textContent = pct + '%';
      pctEl.style.color = pct >= 75 ? 'var(--gD)' : '#dc2626';

      document.getElementById('lr-stat-classes').textContent = (stats.attendedClasses || 0) + ' / ' + (stats.totalClasses || 0);

      var leavesTaken = totals.leavesTaken !== undefined ? totals.leavesTaken : ((stats.pastLeaveDays || 0) + (stats.pastPermissionDays || 0));
      document.getElementById('lr-stat-past-leaves').textContent = leavesTaken;

      if (odStatEl) odStatEl.textContent = totals.odTaken !== undefined ? totals.odTaken : '—';

      document.getElementById('lr-category-badge').innerHTML = req.category === 'Permission' ? ('<re-icon icon="timer"></re-icon> Permission (' + (req.slot || 'Half Day') + ')') : ('<re-icon icon="tree"></re-icon> ' + req.leaveType);
      document.getElementById('lr-days-badge').textContent = (req.daysCount || (req.category === 'Permission' ? 0.5 : 1)) + ' Day' + (req.daysCount > 1 ? 's' : '');

      var dateDisplay = req.fromDate === req.toDate ? formatDateLong(req.fromDate) : (formatDateShort(req.fromDate) + ' – ' + formatDateLong(req.toDate));
      document.getElementById('lr-dates-display').innerHTML = '<re-icon icon="calendar"></re-icon> Date: ' + dateDisplay;
      document.getElementById('lr-reason-display').textContent = '"' + req.reason + '"';

      if (d.tracker && typeof EamsTracker !== 'undefined') {
        EamsTracker.render(d.tracker, 'lr-tracker-panel');
      }

      _populateRequestHistory(d.studentHistory, 'lr-history-section', 'lr-history-list');

      var decided = req.status === 'Approved' || req.status === 'Rejected' || req.advisorStatus === 'Approved' || req.advisorStatus === 'Rejected';
      if (decided) {
        if (actionBtns) actionBtns.style.display = 'none';
        if (remarksSection) remarksSection.style.display = 'none';
      }

      if (notifId) {
        markNotificationRead(notifId);
      }
    })
    .catch(function() {
      if (typeof dbToast === 'function') dbToast('Error loading leave details', 'error');
    });
  }
  window.openLeaveReviewModal = openLeaveReviewModal;

  function submitLeaveAction(action) {
    if (!_currentReviewLeaveId) return;
    var remarks = document.getElementById('lr-remarks').value;
    var tok = getToken();

    if (typeof dbToast === 'function') dbToast('Submitting ' + action + '…', 'saving');
    api('/api/leave/review/' + encodeURIComponent(_currentReviewLeaveId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ action: action, remarks: remarks })
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.error) {
        if (typeof dbToast === 'function') dbToast(res.error, 'error');
        return;
      }
      closeModal('m-leave-review');
      if (typeof dbToast === 'function') {
        dbToast('<re-icon icon="confetti"></re-icon> Leave request ' + action + ' successfully!', 'success');
      }
      syncTeacherNotifications();
      if (document.getElementById('pg-leaves') && document.getElementById('pg-leaves').classList.contains('act')) {
        loadTeacherLeaveHistory();
      }
    })
    .catch(function() {
      if (typeof dbToast === 'function') dbToast('Failed to update leave request', 'error');
    });
  }
  window.submitLeaveAction = submitLeaveAction;

  // TEACHER LEAVE & PERMISSION HISTORY
  var _teacherLeaveData = { requests: [], stats: {} };

  function loadTeacherLeaveHistory() {
    var tok = getToken();
    if (!tok) return;

    var tbody = document.getElementById('lh-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--tdi);">Loading leave records…</td></tr>';

    api('/api/leave/advisor-requests', {
      headers: { 'Authorization': 'Bearer ' + tok }
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) {
        if (typeof dbToast === 'function') dbToast(d.error, 'error');
        return;
      }
      _teacherLeaveData = {
        requests: Array.isArray(d.requests) ? d.requests : (Array.isArray(d) ? d : []),
        stats: d.stats || {}
      };

      // Update KPI stats (exclude cancelled requests from Total)
      var stats = _teacherLeaveData.stats;
      var nonCancelled = _teacherLeaveData.requests.filter(function(r){ return r.status !== 'Cancelled' && r.status !== 'cancelled'; });
      var total = stats.total !== undefined ? stats.total : nonCancelled.length;
      var approved = stats.approved !== undefined ? stats.approved : nonCancelled.filter(function(r){ return r.status === 'Approved'; }).length;
      var rejected = stats.rejected !== undefined ? stats.rejected : nonCancelled.filter(function(r){ return r.status === 'Rejected'; }).length;
      var pending = stats.pending !== undefined ? stats.pending : nonCancelled.filter(function(r){ return r.status === 'Pending'; }).length;
      var onduty = stats.onDutyCount !== undefined ? stats.onDutyCount : nonCancelled.filter(function(r){ return r.category === 'Permission' || (r.slot && r.slot !== 'Full Day'); }).length;

      var stTotal = document.getElementById('lh-stat-total'); if (stTotal) stTotal.textContent = total;
      var stAppr  = document.getElementById('lh-stat-approved'); if (stAppr) stAppr.textContent = approved;
      var stRej   = document.getElementById('lh-stat-rejected'); if (stRej) stRej.textContent = rejected;
      var stPend  = document.getElementById('lh-stat-pending'); if (stPend) stPend.textContent = pending;
      var stOd    = document.getElementById('lh-stat-onduty'); if (stOd) stOd.textContent = onduty;

      // Update sidebar badge
      var sbBadge = document.getElementById('sn-leave-badge');
      if (sbBadge) {
        sbBadge.textContent = pending;
        sbBadge.style.display = pending > 0 ? 'inline-block' : 'none';
      }

      // Clear any rogue browser password autofill before filtering
      var sInput = document.getElementById('lh-filter-search');
      if (sInput && sInput.value) {
        var sVal = String(sInput.value).trim().toLowerCase();
        var uName = (currentUser && (currentUser.username || currentUser.name || '')).trim().toLowerCase();
        if (sVal === 'admin' || (uName && sVal === uName)) {
          sInput.value = '';
        }
      }

      filterTeacherLeaveTable();
    })
    .catch(function(err) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:#ef4444;">Failed to load leave history.</td></tr>';
      if (typeof dbToast === 'function') dbToast('Error loading leave history', 'error');
    });
  }
  window.loadTeacherLeaveHistory = loadTeacherLeaveHistory;

  function filterTeacherLeaveTable() {
    var list = _teacherLeaveData.requests || [];
    var from = document.getElementById('lh-filter-from') ? document.getElementById('lh-filter-from').value : '';
    var to = document.getElementById('lh-filter-to') ? document.getElementById('lh-filter-to').value : '';
    var cat = document.getElementById('lh-filter-cat') ? document.getElementById('lh-filter-cat').value : '';
    var status = document.getElementById('lh-filter-status') ? document.getElementById('lh-filter-status').value : '';
    var searchEl = document.getElementById('lh-filter-search');
    if (searchEl && searchEl.value) {
      var valLower = String(searchEl.value).trim().toLowerCase();
      var uName = (currentUser && (currentUser.username || currentUser.name || '')).trim().toLowerCase();
      if (!searchEl.matches(':focus') && (valLower === 'admin' || (uName && valLower === uName))) {
        searchEl.value = '';
      }
    }
    var search = searchEl && searchEl.value ? String(searchEl.value).toLowerCase().trim() : '';

    list.sort(function(a, b) {
      var da = new Date(a.createdAt || 0).getTime();
      var db = new Date(b.createdAt || 0).getTime();
      return _leaveSortAsc ? da - db : db - da;
    });

    var filtered = list.filter(function(r) {
      if (status) {
        if (r.status !== status) return false;
      } else {
        // Exclude cancelled requests when viewing all statuses
        if (r.status === 'Cancelled' || r.status === 'cancelled') return false;
      }
      if (from && r.toDate < from) return false;
      if (to && r.fromDate > to) return false;
      if (cat && r.category !== cat) return false;
      if (search) {
        var matchName = (r.studentName || '').toLowerCase().includes(search);
        var matchReg  = (r.studentRegNo || '').toLowerCase().includes(search);
        var matchCls  = (r.className || '').toLowerCase().includes(search);
        if (!matchName && !matchReg && !matchCls) return false;
      }
      return true;
    });

    renderTeacherLeaveTable(filtered);
  }
  window.filterTeacherLeaveTable = filterTeacherLeaveTable;

  function resetTeacherLeaveFilters() {
    if (document.getElementById('lh-filter-from')) document.getElementById('lh-filter-from').value = '';
    if (document.getElementById('lh-filter-to')) document.getElementById('lh-filter-to').value = '';
    if (document.getElementById('lh-filter-cat')) document.getElementById('lh-filter-cat').value = '';
    if (document.getElementById('lh-filter-status')) document.getElementById('lh-filter-status').value = '';
    if (document.getElementById('lh-filter-search')) document.getElementById('lh-filter-search').value = '';
    filterTeacherLeaveTable();
  }
  window.resetTeacherLeaveFilters = resetTeacherLeaveFilters;

  function renderTeacherLeaveTable(list) {
    var tbody = document.getElementById('lh-table-body');
    if (!tbody) return;

    if (!list || !list.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--tdi);">No leave or permission records match the selected filters.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function(r) {
      var statusBg = r.status === 'Approved' ? '#dcfce7' : r.status === 'Rejected' ? '#fee2e2' : r.status === 'Cancelled' ? '#f3f4f6' : '#fef3c7';
      var statusColor = r.status === 'Approved' ? '#166534' : r.status === 'Rejected' ? '#991b1b' : r.status === 'Cancelled' ? '#4b5563' : '#92400e';
      var statusBadge = '<span style="background:' + statusBg + ';color:' + statusColor + ';font-size:11px;font-weight:800;padding:3px 9px;border-radius:8px;">' + r.status + '</span>';

      var trackerHtml = '';
      if (r.tracker && window.EamsTracker) trackerHtml = '<div style="margin-top:4px;">' + EamsTracker.pill(r.tracker) + '</div>';

      var isPending = r.status === 'Pending';
      var actionHtml = isPending
        ? '<button class="btn-form-pri bsm" onclick="openLeaveReviewModal(\'' + r._id + '\')" style="padding:4px 10px;font-size:11px;background:#16a34a;">Review</button>'
        : (r.reviewRemarks ? ('<span style="font-size:11px;color:var(--tmu);"><re-icon icon="message-square"></re-icon> ' + escapeHtml(r.reviewRemarks) + '</span>') : (r.reviewedBy ? ('<span style="font-size:11px;color:var(--tdi);">By ' + escapeHtml(r.reviewedBy) + '</span>') : '—'));

      var catBadge = r.category === 'Permission'
        ? '<span style="background:#ede9fe;color:#6d28d9;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;"><re-icon icon="timer"></re-icon> Permission</span>'
        : '<span style="background:#f0fdf4;color:#15803d;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;"><re-icon icon="tree"></re-icon> ' + escapeHtml(r.leaveType) + '</span>';

      return '<tr>'
        + '<td style="font-size:11px;color:var(--tdi);white-space:nowrap;">' + formatDateShort(r.createdAt) + '</td>'
        + '<td style="font-size:11.5px;font-weight:600;color:var(--td);white-space:nowrap;">' + escapeHtml(r.studentRegNo) + '</td>'
        + '<td><strong>' + escapeHtml(r.studentName) + '</strong></td>'
        + '<td>' + catBadge + '</td>'
        + '<td><span style="font-weight:700;">' + (r.daysCount || (r.category === 'Permission' ? 0.5 : 1)) + '</span></td>'
        + '<td>' + statusBadge + trackerHtml + '</td>'
        + '<td>' + actionHtml + '</td>'
        + '</tr>';
    }).join('');
  }

  // ── ADVISOR FILE LEAVE ON BEHALF OF STUDENT (LD4) ──
  function openAdvisorFileLeaveModal() {
    var form = document.getElementById('form-advisor-file-leave');
    if (form) form.reset();

    var today = todayISO();
    var fromEl = document.getElementById('afl-from-date');
    var toEl = document.getElementById('afl-to-date');
    if (fromEl) fromEl.value = today;
    if (toEl) toEl.value = today;

    // Populate datalist with student recommendations if available
    var dl = document.getElementById('afl-students-list');
    if (dl) {
      var stuList = (typeof DB !== 'undefined' && DB.get ? DB.get('students') : []) || [];
      dl.innerHTML = stuList.map(function(s) {
        var rNo = s.regNo || s.registerNo || s.trackId || '';
        var sName = escapeHtml(s.name || s.fullName || '');
        var cName = s.className ? ' (' + escapeHtml(s.className) + ')' : '';
        return '<option value="' + escapeHtml(rNo) + '">' + sName + cName + '</option>';
      }).join('');
    }

    openModal('m-advisor-file-leave');

    var regInput = document.getElementById('afl-reg-no');
    if (regInput) setTimeout(function() { regInput.focus(); }, 120);
  }
  window.openAdvisorFileLeaveModal = openAdvisorFileLeaveModal;

  function submitAdvisorFileLeave(event) {
    if (event) event.preventDefault();

    var regInput = document.getElementById('afl-reg-no');
    var catInput = document.getElementById('afl-category');
    var covInput = document.getElementById('afl-coverage');
    var fromInput = document.getElementById('afl-from-date');
    var toInput = document.getElementById('afl-to-date');
    var reasonInput = document.getElementById('afl-reason');

    var regNo = (regInput ? regInput.value : '').trim();
    var category = catInput ? catInput.value : 'Personal';
    var coverage = covInput ? covInput.value : 'full_day';
    var fromDate = (fromInput ? fromInput.value : '').trim();
    var toDate = (toInput ? toInput.value : '').trim();
    var reason = (reasonInput ? reasonInput.value : '').trim();

    if (!regNo || !fromDate || !toDate || !reason) {
      if (typeof dbToast === 'function') dbToast('Please fill all required fields', 'warn');
      return;
    }

    if (fromDate > toDate) {
      if (typeof dbToast === 'function') dbToast('From date cannot be after to date', 'warn');
      return;
    }

    var btn = document.getElementById('btn-submit-afl');
    var origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<re-icon icon="hourglass" size="14"></re-icon> Filing Leave…';
    }

    var tok = getToken();
    api('/api/student-leave/advisor/file-for-student', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + tok
      },
      body: JSON.stringify({
        studentTrackId: regNo,
        category: category,
        coverage: coverage,
        fromDate: fromDate,
        toDate: toDate,
        reason: reason
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(d) {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
      if (d.error) {
        if (typeof dbToast === 'function') dbToast(d.error, 'error');
        return;
      }
      if (typeof dbToast === 'function') dbToast(d.message || 'Leave filed and approved successfully', 'success');
      closeModal('m-advisor-file-leave');
      if (typeof loadTeacherLeaveHistory === 'function') {
        loadTeacherLeaveHistory();
      }
    })
    .catch(function(err) {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
      if (typeof dbToast === 'function') dbToast(err.message || 'Failed to file leave', 'error');
    });
  }
  window.submitAdvisorFileLeave = submitAdvisorFileLeave;

  function markNotificationRead(id) {
    var tok = getToken();
    api('/api/notifications/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ read: true })
    }).catch(function() {});
    DB.update('teacher-notifications', id, { read: true });
    renderNotifications();
  }
  var markNR = markNotificationRead;

  function clearAllNotifications(event) {
    if (event) event.stopPropagation();
    DB.get('teacher-notifications').forEach(function(n) {
      n.read = true;
      n.status = 'Read';
    });
    renderNotifications();
    var tok = getToken();
    if (tok) {
      api('/api/notifications/read-all', {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + tok }
      }).catch(function() {});
    }
  }
  var clearNotifs = clearAllNotifications;

  function toggleNotificationDropdown() {
    document.getElementById('ndrop').classList.toggle('open');
    syncTeacherNotifications();
  }
  var togNotif = toggleNotificationDropdown;

  // Close dropdown on outside click
  document.addEventListener('click', function(e) {
    if (!e.target.closest('#ndrop') && !e.target.closest('.tb-icon')) {
      var ndrop = document.getElementById('ndrop');
      if (ndrop) ndrop.classList.remove('open');
    }
  });

  // Delegated action dispatcher for S5 CSP migration (data-action="functionName")
  document.addEventListener('click', function(e) {
    var actionEl = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!actionEl) return;
    var action = actionEl.getAttribute('data-action');
    if (action && typeof window[action] === 'function') {
      window[action](e, actionEl);
    }
  });

  // MY SCHEDULE PAGE
  let scheduleWeekOffset = 0;
  let dayOffset = 0;
  let currentSchedTab = 'week';

  // Tab switching for Week / Day / My Timetable
  function switchSchedTab(tab) {
    currentSchedTab = tab;
    ['week','day','tt'].forEach(function(t) {
      var tabBtn = document.getElementById('stab-' + t);
      if (tabBtn) {
        tabBtn.classList.toggle('act', t === tab);
        tabBtn.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      }
      var viewEl = document.getElementById('sched-' + t + '-view');
      if (viewEl) viewEl.style.display = t === tab ? '' : 'none';
    });
    // Navigation controls: always visible across Timetable, Week, and Day
    var navCtrl = document.getElementById('sched-nav-controls');
    if (navCtrl) navCtrl.style.display = 'flex';

    if (tab === 'week')     renderSchedulePage();
    else if (tab === 'day') renderDayView();
    else                    renderTimetableGrid();

    updateSchedControlsBar();
  }
  window.switchSchedTab = switchSchedTab;

  function scheduleNavigate(direction) {
    scheduleWeekOffset += direction * 7;
    renderSchedulePage();
    updateSchedControlsBar();
    syncMySchedule(scheduleWeekOffset).then(function() {
      renderSchedulePage();
      updateSchedControlsBar();
    });
  }
  var schedNav = scheduleNavigate;
  window.scheduleNavigate = scheduleNavigate;
  window.schedNav = scheduleNavigate;

  function schedNavigateStep(direction) {
    if (currentSchedTab === 'day') {
      dayNavStep(direction);
    } else if (currentSchedTab === 'tt') {
      scheduleWeekOffset += direction * 7;
      updateSchedControlsBar();
      renderTimetableGrid();
      if (typeof renderScheduleStatCards === 'function') renderScheduleStatCards();
      syncMySchedule(scheduleWeekOffset).then(function() {
        renderTimetableGrid();
        if (typeof renderScheduleStatCards === 'function') renderScheduleStatCards();
        updateSchedControlsBar();
      });
    } else {
      scheduleNavigate(direction);
    }
  }
  window.schedNavigateStep = schedNavigateStep;

  function schedGoToday() {
    if (currentSchedTab === 'day') {
      dayOffset = 0;
      renderDayView();
      updateSchedControlsBar();
    } else if (currentSchedTab === 'tt') {
      scheduleWeekOffset = 0;
      updateSchedControlsBar();
      renderTimetableGrid();
      if (typeof renderScheduleStatCards === 'function') renderScheduleStatCards();
      syncMySchedule(0).then(function() {
        renderTimetableGrid();
        if (typeof renderScheduleStatCards === 'function') renderScheduleStatCards();
        updateSchedControlsBar();
      });
    } else {
      scheduleWeekOffset = 0;
      renderSchedulePage();
      updateSchedControlsBar();
      syncMySchedule(0).then(function() {
        renderSchedulePage();
        updateSchedControlsBar();
      });
    }
  }
  window.schedGoToday = schedGoToday;

  function updateSchedControlsBar() {
    var rangeLabelEl = document.getElementById('sched-range-label');
    var prevTextEl = document.getElementById('sched-prev-text');
    var nextTextEl = document.getElementById('sched-next-text');
    var markedTextEl = document.getElementById('sched-marked-text');
    var healthTextEl = document.getElementById('sched-health-text');
    var navCtrls = document.getElementById('sched-nav-controls');
    if (navCtrls) navCtrls.style.display = 'flex';

    if (currentSchedTab === 'day') {
      var _tParts = todayISO().split('-').map(Number);
      var today = new Date(_tParts[0], _tParts[1] - 1, _tParts[2]);
      var target = new Date(today);
      target.setDate(today.getDate() + dayOffset);
      var dateISO = localISO(target);
      var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      var dFull = dayNames[target.getDay()];

      if (prevTextEl) prevTextEl.textContent = 'Prev day';
      if (nextTextEl) nextTextEl.textContent = 'Next day';
      var formattedDay = dFull + ', ' + target.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      if (rangeLabelEl) rangeLabelEl.textContent = formattedDay;
      var dayLbl = document.getElementById('daylbl');
      if (dayLbl) dayLbl.textContent = formattedDay;

      // Compute marked slots for target day
      var dayData = (typeof getMyDay === 'function') ? getMyDay(dateISO) : null;
      var timetable = getMyTimetable().filter(function(t) { return t.day === ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][target.getDay()] || t.dayFull === dFull; });
      var rawSlots = dayData ? (dayData.slots || []) : timetable;
      var slots = rawSlots.filter(function(s) { return !s.isSpanContinuation && !(Number(s.spanIndex) > 0); });
      var allAttendance = DB.get('attendance');
      var markedCount = 0;
      slots.forEach(function(s) {
        if ((s.attendance && s.attendance.marked) || isSlotMarked(s, dateISO, allAttendance)) markedCount++;
      });
      if (markedTextEl) markedTextEl.textContent = markedCount + '/' + slots.length + ' slots marked';
    } else {
      // 'week' and 'tt'
      var _tParts = todayISO().split('-').map(Number);
      var today = new Date(_tParts[0], _tParts[1] - 1, _tParts[2]);
      var monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + scheduleWeekOffset);
      var saturday = new Date(monday);
      saturday.setDate(monday.getDate() + 5);

      if (prevTextEl) prevTextEl.textContent = 'Prev';
      if (nextTextEl) nextTextEl.textContent = 'Next';
      var formattedRange = monday.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
        + ' – ' + saturday.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      if (rangeLabelEl) rangeLabelEl.textContent = formattedRange;
      var weekLbl = document.getElementById('weeklbl');
      if (weekLbl) weekLbl.textContent = formattedRange;

      var todayISOStr = todayISO();
      var todayData = (typeof getMyDay === 'function') ? getMyDay(todayISOStr) : null;
      var ttToday = getMyTimetable().filter(function(t) { return t.day === ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][today.getDay()]; });
      var rawTodaySlots = todayData ? (todayData.slots || []) : ttToday;
      var todaySlots = rawTodaySlots.filter(function(s) { return !s.isSpanContinuation && !(Number(s.spanIndex) > 0); });
      var allAtt = DB.get('attendance');
      var markedToday = 0;
      todaySlots.forEach(function(s) {
        if ((s.attendance && s.attendance.marked) || isSlotMarked(s, todayISOStr, allAtt)) markedToday++;
      });
      if (markedTextEl) markedTextEl.textContent = markedToday + '/' + todaySlots.length + ' slots marked';
    }

    if (healthTextEl) healthTextEl.textContent = 'All slots regular & active';
  }
  window.updateSchedControlsBar = updateSchedControlsBar;

  // ── WEEK VIEW (Mon–Sat) ──
  // Reads multi-day resolved schedule days overlaid with holidays, leaves, and overrides
  function renderSchedulePage() {
    var todayData = (typeof getMyDay === 'function') ? getMyDay(todayISO()) : null;
    renderScheduleHealthStrip(todayData, todayISO());
    var container = document.getElementById('schedbyday');
    var labelEl   = document.getElementById('weeklbl');
    var rangeEl   = document.getElementById('sched-range-label');
    if (!container) return;

    var _tParts = todayISO().split('-').map(Number);
    var today  = new Date(_tParts[0], _tParts[1] - 1, _tParts[2]);
    var monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + scheduleWeekOffset);

    var weekDays = [];
    for (var i = 0; i < 6; i++) {
      var d = new Date(monday);
      d.setDate(monday.getDate() + i);
      weekDays.push(d);
    }

    var rangeText = weekDays[0].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      + ' – ' + weekDays[5].toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    if (labelEl) labelEl.textContent = rangeText;
    if (rangeEl) rangeEl.textContent = rangeText;
    updateSchedControlsBar();

    var timetable  = getMyTimetable();
    var attendance = DB.get('attendance');
    var todayStr   = todayISO();

    container.innerHTML = weekDays.map(function(d) {
      var dateISO = localISO(d);
      var dayName = DAY_NAMES[d.getDay()];
      var isToday = dateISO === todayStr;

      var dayData = getMyDay(dateISO);
      var isHoliday = dayData ? dayData.isHoliday : (d.getDay() === 0);
      var holidayReason = dayData ? (dayData.holidayReason || 'Holiday') : (d.getDay() === 0 ? 'Sunday' : '');
      var onLeave = dayData ? dayData.onLeave : false;
      var leaveSlot = dayData ? dayData.leaveSlot : null;

      var rawSlots = dayData ? (dayData.slots || []) : timetable.filter(function(t) { return t.day === dayName || t.dayFull === dayName; }).sort(bySlotStart);
      var slots = rawSlots.filter(function(s) {
        return !s.isSpanContinuation && !(Number(s.spanIndex) > 0);
      });

      var bannerHtml = '';
      if (isHoliday) {
        bannerHtml = '<div class="wk-holiday" style="margin-bottom:8px;"><re-icon icon="tree"></re-icon> ' + escapeHtml(holidayReason || 'Holiday') + '</div>';
      } else if (onLeave) {
        bannerHtml = '<div class="wk-holiday" style="margin-bottom:8px;background:#fef3c7;color:#b45309;border-color:#fde68a;"><re-icon icon="tree"></re-icon> On Leave (' + escapeHtml(leaveSlot || 'Full Day') + ')</div>';
      }

      var slotHtml = slots.length ? slots.map(function(slot) {
        var marked = (slot.attendance && slot.attendance.marked) || isSlotMarked(slot, dateISO, attendance);
        var isCancelled = slot.status === 'cancelled';
        var isSubstituted = slot.status === 'substituted';
        var isSubIn = slot.role === 'substitute';
        var isLeave = slot.status === 'leave';

        var statusChip = '';
        var cardExtraClass = '';
        if (isCancelled) {
          statusChip = '<span class="badge badge-cancelled">Cancelled</span>';
          cardExtraClass = ' slot-cancelled';
        } else if (isSubstituted) {
          statusChip = '<span class="badge badge-sub-out">Substituted <re-icon icon="arrow-right"></re-icon> ' + escapeHtml(slot.substituteTeacher || 'Substitute') + '</span>';
          cardExtraClass = ' slot-substituted';
        } else if (isSubIn) {
          statusChip = '<span class="badge badge-sub-in">Substitute for ' + escapeHtml(slot.originalTeacher || 'Faculty') + '</span>';
          cardExtraClass = ' slot-sub-in';
        } else if (isLeave) {
          statusChip = '<span class="badge badge-leave">On Leave</span>';
          cardExtraClass = ' slot-leave';
        }

        var pNums = Array.isArray(slot.periods) && slot.periods.length ? slot.periods : (slot.periodNumbers && slot.periodNumbers.length ? slot.periodNumbers : [slot.periodNumber]);
        var targetCId = slot.classTrackId || toClassTrackId(slot.classId) || '';
        var action = '';
        if (marked) {
          action = '<span class="donetag"><re-icon icon="check-circle"></re-icon> Marked</span>';
        } else if (isToday && (slot.status === 'scheduled' || isSubIn)) {
          action = '<button class="attbtn" title="Take attendance" onclick="navigateToAttendance(\'' + targetCId + '\',\'' + (slot.subjectId || '') + '\',' + (slot.periodNumber || 'null') + ',\'' + dateISO + '\', ' + JSON.stringify(pNums) + ')"><re-icon icon="check-circle"></re-icon> Take Att.</button>';
        }

        var periodLabel = pNums.length > 1 ? ('P' + pNums[0] + '–P' + pNums[pNums.length - 1]) : (slot.periodNumber ? 'P' + slot.periodNumber : '');
        if (slot.span && slot.span > 1 && pNums.length <= 1) {
          periodLabel = 'P' + slot.periodNumber + '–P' + (slot.periodNumber + slot.span - 1);
        }

        var slotKey = slot.key || slot._id || ((slot.dayFull || dayName) + '_' + slot.periodNumber);
        var col = (typeof TeacherTimetable !== 'undefined' && TeacherTimetable.getClassColor) ? TeacherTimetable.getClassColor(slot.className) : null;
        var classStyle = col ? ('--cls-bg:' + col.bg + ';--cls-border:' + col.border + ';--cls-border-light:' + col.borderLight + ';--cls-text:' + col.text + ';') : '';
        var classCls = col ? ' has-class-color' : '';

        return '<div class="wk-slot' + (marked ? ' done' : '') + cardExtraClass + classCls + '" onclick="showTeacherSlotPopover(\'' + escapeHtml(slotKey) + '\', event)" style="cursor:pointer;' + classStyle + '">'
          + '<div class="wk-slot-top">'
          +   '<span class="wk-time">' + escapeHtml(slot.start || '') + (slot.end ? '–' + escapeHtml(slot.end) : '') + '</span>'
          +   (periodLabel ? '<span class="wk-per">' + periodLabel + '</span>' : '')
          + '</div>'
          + '<div class="wk-sub">' + escapeHtml(slot.subjectName || slot.subject || 'Subject') + '</div>'
          + '<div class="wk-cls" style="' + (col ? 'color:' + col.text + ';font-weight:700;' : '') + '">' + escapeHtml(slot.className || '') + ((slot.hallNo || slot.room) ? ' · ' + escapeHtml(slot.hallNo || slot.room) : '') + '</div>'
          + (statusChip ? '<div style="margin-top:4px;">' + statusChip + '</div>' : '')
          + (slot.note && !isCancelled && !isSubstituted ? '<div style="font-size:11px;color:#d97706;margin-top:2px;"><re-icon icon="info-circle"></re-icon> ' + escapeHtml(slot.note) + '</div>' : '')
          + (action ? '<div class="wk-act" onclick="event.stopPropagation();">' + action + '</div>' : '')
          + '</div>';
      }).join('') : (isHoliday || onLeave ? '' : '<div class="wk-empty">No classes</div>');

      return '<div class="wdblk' + (isToday ? ' today-col' : '') + '">'
        + '<div class="wdhd"><div class="wdnm">' + dayName + '</div>'
        + '<div class="wddt">' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + '</div>'
        + (isToday ? '<div class="wdtd">TODAY</div>' : '')
        + '</div>'
        + '<div class="wdslots">' + bannerHtml + slotHtml + '</div>'
        + '</div>';
    }).join('');
  }
  window.renderSchedulePage = renderSchedulePage;

  // ── DAY VIEW ──
  function dayNavStep(dir) {
    dayOffset += dir;
    renderDayView();
    updateSchedControlsBar();
    var _tParts = todayISO().split('-').map(Number);
    var today = new Date(_tParts[0], _tParts[1] - 1, _tParts[2]);
    var target = new Date(today);
    target.setDate(today.getDate() + dayOffset);
    var dateISO = localISO(target);
    if (!getMyDay(dateISO)) {
      var tok = getToken();
      if (tok) {
        api('/api/timetable/my-schedule?from=' + encodeURIComponent(dateISO) + '&to=' + encodeURIComponent(dateISO), {
          headers: authHeaders()
        })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(res) {
          if (res && res.ok && res.data && Array.isArray(res.data.days) && res.data.days[0]) {
            var cur = DB.get('schedule-days') || {};
            cur[dateISO] = res.data.days[0];
            DB.set('schedule-days', cur);
            renderDayView();
            updateSchedControlsBar();
          }
        }).catch(function() {});
      }
    }
  }

  function schedSelectDayDate(dateISO) {
    var _tParts = todayISO().split('-').map(Number);
    var today = new Date(_tParts[0], _tParts[1] - 1, _tParts[2]);
    var _dParts = dateISO.split('-').map(Number);
    var sel = new Date(_dParts[0], _dParts[1] - 1, _dParts[2]);
    var diffTime = sel.getTime() - today.getTime();
    dayOffset = Math.round(diffTime / (1000 * 60 * 60 * 24));
    renderDayView();
    updateSchedControlsBar();
    if (!getMyDay(dateISO)) {
      var tok = getToken();
      if (tok) {
        api('/api/timetable/my-schedule?from=' + encodeURIComponent(dateISO) + '&to=' + encodeURIComponent(dateISO), {
          headers: authHeaders()
        })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(res) {
          if (res && res.ok && res.data && Array.isArray(res.data.days) && res.data.days[0]) {
            var cur = DB.get('schedule-days') || {};
            cur[dateISO] = res.data.days[0];
            DB.set('schedule-days', cur);
            renderDayView();
            updateSchedControlsBar();
          }
        }).catch(function() {});
      }
    }
  }
  window.schedSelectDayDate = schedSelectDayDate;

  function renderDaySelectorStrip(target, dateISO) {
    var stripEl = document.getElementById('sched-day-strip');
    if (!stripEl) return;

    var dayOfWeek = target.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
    var diffToMonday = (dayOfWeek === 0) ? -6 : (1 - dayOfWeek);
    var monday = new Date(target.getFullYear(), target.getMonth(), target.getDate() + diffToMonday);

    var timetable = getMyTimetable();
    var daysCache = DB.get('schedule-days') || {};
    var dayShortNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var dayFullNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    var html = '';
    for (var i = 0; i < 6; i++) {
      var d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      var dISO = localISO(d);
      var isAct = dISO === dateISO;
      var dName = dayShortNames[d.getDay()];
      var dNum = d.getDate();

      var dayData = daysCache[dISO] || (typeof getMyDay === 'function' ? getMyDay(dISO) : null);
      var isHoliday = dayData ? dayData.isHoliday : (d.getDay() === 0);
      var rawSlots = dayData ? (dayData.slots || []) : timetable.filter(function(t) { return t.day === dName || t.dayFull === dayFullNames[d.getDay()]; });
      var slots = rawSlots.filter(function(s) {
        return !s.isSpanContinuation && !(Number(s.spanIndex) > 0);
      });

      var countText = '';
      var countClass = 'sched-day-count';
      if (isHoliday) {
        countText = 'Holiday';
        countClass += ' none';
      } else if (!slots.length) {
        countText = 'No class';
        countClass += ' none';
      } else if (slots.length === 1) {
        countText = '1 class';
      } else {
        countText = slots.length + ' classes';
      }

      html += '<div class="sched-day-chip' + (isAct ? ' act' : '') + '" onclick="schedSelectDayDate(\'' + dISO + '\')">'
        + '<div class="sched-day-name">' + dName + '</div>'
        + '<div class="sched-day-num">' + dNum + '</div>'
        + '<div class="' + countClass + '">' + countText + '</div>'
        + '</div>';
    }

    stripEl.innerHTML = html;
  }
  window.renderDaySelectorStrip = renderDaySelectorStrip;

  function renderDayGlanceCard(target, dateISO, slots, dayData) {
    var cardEl = document.getElementById('sched-glance-card');
    if (!cardEl) return;

    var isToday = dateISO === todayISO();
    var title = isToday ? 'Today at a glance' : 'Today at a glance';
    var count = slots ? slots.length : 0;
    var allAttendance = DB.get('attendance');

    var totalMinutes = 0;
    var markedCount = 0;
    if (slots && slots.length) {
      slots.forEach(function(s) {
        if (s.start && s.end) {
          var sp = s.start.split(':').map(Number);
          var ep = s.end.split(':').map(Number);
          var m = (ep[0] * 60 + ep[1]) - (sp[0] * 60 + sp[1]);
          if (m > 0) totalMinutes += m;
        }
        var marked = (s.attendance && s.attendance.marked) || isSlotMarked(s, dateISO, allAttendance);
        if (marked) markedCount++;
      });
    }

    var durStr = '';
    if (totalMinutes > 0) {
      var h = Math.floor(totalMinutes / 60);
      var m = totalMinutes % 60;
      durStr = (h > 0 ? h + ' h ' : '') + (m > 0 ? m + ' m' : (h === 0 ? '0 m' : ''));
    }

    var statHtml = '';
    if (count === 0) {
      statHtml = '0 classes';
    } else if (count === 1) {
      statHtml = '1 class' + (durStr ? '<small>· ' + durStr.trim() + '</small>' : '');
    } else {
      statHtml = count + ' classes' + (durStr ? '<small>· ' + durStr.trim() + '</small>' : '');
    }

    var pct = count > 0 ? Math.round((markedCount / count) * 100) : 0;

    var isHoliday = dayData ? dayData.isHoliday : (target.getDay() === 0);
    var onLeave = dayData ? dayData.onLeave : false;

    var statusBadge = '';
    if (isHoliday) {
      statusBadge = '<span class="sched-status-badge" style="background:#fee2e2;color:#991b1b;border-color:#fecaca;"><re-icon icon="tree"></re-icon> ' + escapeHtml(dayData?.holidayReason || 'Holiday') + '</span>';
    } else if (onLeave) {
      statusBadge = '<span class="sched-status-badge" style="background:#fef3c7;color:#92400e;border-color:#fde68a;"><re-icon icon="tree"></re-icon> On Leave</span>';
    } else {
      statusBadge = '<span class="sched-status-badge"><re-icon icon="shield-check" size="13"></re-icon> All slots regular &amp; active</span>';
    }

    cardEl.innerHTML =
      '<div class="sched-card-hdr">' + title + '</div>'
      + '<div class="sched-glance-stat">' + statHtml + '</div>'
      + '<div class="sched-progress-track"><div class="sched-progress-fill" style="width:' + pct + '%;"></div></div>'
      + '<div class="sched-glance-sub">Attendance marked: ' + markedCount + ' of ' + count + '</div>'
      + '<div>' + statusBadge + '</div>';
  }
  window.renderDayGlanceCard = renderDayGlanceCard;

  function renderEarlierThisWeekCard(target, dateISO) {
    var cardEl = document.getElementById('sched-history-card');
    if (!cardEl) return;

    var dayOfWeek = target.getDay(); // 0=Sun, 1=Mon ... 6=Sat
    var diffToMonday = (dayOfWeek === 0) ? -6 : (1 - dayOfWeek);
    var monday = new Date(target.getFullYear(), target.getMonth(), target.getDate() + diffToMonday);

    var timetable = getMyTimetable();
    var daysCache = DB.get('schedule-days') || {};
    var dayShortNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var dayFullNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    var earlierItems = [];
    var currentDayNum = (dayOfWeek === 0) ? 7 : dayOfWeek;

    for (var i = 0; i < currentDayNum - 1; i++) {
      var d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      var dISO = localISO(d);
      var dShort = dayShortNames[d.getDay()];
      var dFull = dayFullNames[d.getDay()];

      var dayData = daysCache[dISO] || (typeof getMyDay === 'function' ? getMyDay(dISO) : null);
      if (dayData && dayData.isHoliday) continue;

      var rawSlots = dayData ? (dayData.slots || []) : timetable.filter(function(t) { return t.day === dShort || t.dayFull === dFull; });
      var slots = rawSlots.filter(function(s) {
        return !s.isSpanContinuation && !(Number(s.spanIndex) > 0);
      }).sort(bySlotStart);

      var dateLabel = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

      slots.forEach(function(slot) {
        var pNums = Array.isArray(slot.periods) && slot.periods.length ? slot.periods : (slot.periodNumbers && slot.periodNumbers.length ? slot.periodNumbers : [slot.periodNumber]);
        var periodText = pNums.length > 1 ? ('P' + pNums[0] + '–P' + pNums[pNums.length - 1]) : ('P' + slot.periodNumber);
        var timeText = (slot.start || '') + (slot.end ? '–' + slot.end : '');
        var metaText = dateLabel + (periodText ? ' · ' + periodText : '') + (timeText ? ' · ' + timeText : '');

        earlierItems.push({
          title: slot.subjectName || slot.subject || 'Subject',
          meta: metaText
        });
      });
    }

    var itemsHtml = '';
    if (earlierItems.length === 0) {
      itemsHtml = '<div style="font-size:12px;color:var(--tmu,#64748b);padding:8px 0;">No earlier classes this week</div>';
    } else {
      itemsHtml = earlierItems.map(function(item) {
        return '<div class="sched-history-item">'
          + '<div class="sched-history-title">' + escapeHtml(item.title) + '</div>'
          + '<div class="sched-history-meta">' + escapeHtml(item.meta) + '</div>'
          + '</div>';
      }).join('');
    }

    cardEl.innerHTML =
      '<div class="sched-card-hdr">Earlier this week</div>'
      + itemsHtml;
  }
  window.renderEarlierThisWeekCard = renderEarlierThisWeekCard;

  function renderDayView() {
    var _tParts  = todayISO().split('-').map(Number);
    var today    = new Date(_tParts[0], _tParts[1] - 1, _tParts[2]);
    var target   = new Date(today);
    target.setDate(today.getDate() + dayOffset);
    var dateISO  = localISO(target);
    var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var dayShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var dayName  = dayShort[target.getDay()];
    var dFull    = dayNames[target.getDay()];
    var isToday  = dateISO === todayISO();

    var formattedDayLabel = dFull + ', ' + target.toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'});
    var dayLblEl = document.getElementById('daylbl');
    if (dayLblEl) dayLblEl.textContent = formattedDayLabel;
    var rangeLblEl = document.getElementById('sched-range-label');
    if (rangeLblEl) rangeLblEl.textContent = formattedDayLabel;

    var titleEl = document.getElementById('sched-timeline-title');
    if (titleEl) titleEl.textContent = dFull + ' timeline';

    var badgeEl = document.getElementById('sched-timeline-badge');
    if (badgeEl) {
      var timingSets = DB.get('timing-sets') || [];
      var daySet = timingSets.find(function(ts) {
        return ts && (ts.day === dayName || ts.dayFull === dFull || (Array.isArray(ts.days) && ts.days.includes(dayName)));
      });
      badgeEl.textContent = (daySet && daySet.name) ? 'Showing ' + daySet.name + ' timings' : (target.getDay() === 6 ? 'Showing Set 2 timings' : 'Showing Set 1 timings');
    }

    var dayData = getMyDay(dateISO);
    var isHoliday = dayData ? dayData.isHoliday : (target.getDay() === 0);
    var holidayReason = dayData ? (dayData.holidayReason || 'Holiday') : (target.getDay() === 0 ? 'Weekend' : '');
    var onLeave = dayData ? dayData.onLeave : false;
    var leaveSlot = dayData ? dayData.leaveSlot : null;

    var timetable = getMyTimetable().filter(function(t) { return t.day === dayName || t.dayFull === dFull; });
    var rawSlots = dayData ? (dayData.slots || []) : timetable.slice().sort(bySlotStart);
    var slots = rawSlots.filter(function(s) {
      return !s.isSpanContinuation && !(Number(s.spanIndex) > 0);
    });

    // 1) Render Mon-Sat cards
    renderDaySelectorStrip(target, dateISO);

    // 2) Render Today at a glance
    renderDayGlanceCard(target, dateISO, slots, dayData);

    // 3) Render Earlier this week
    renderEarlierThisWeekCard(target, dateISO);

    var cont = document.getElementById('dayschedcont');
    if (!cont) return;

    if (isHoliday) {
      cont.innerHTML = '<div class="day-empty"><re-icon icon="sun"></re-icon> ' + escapeHtml(holidayReason || 'Weekend — no classes scheduled.') + '</div>';
      return;
    }

    var bannerHtml = '';
    if (onLeave) {
      bannerHtml = '<div style="margin-bottom:14px;padding:12px 14px;background:#fef3c7;border:1px solid #fde68a;border-radius:10px;color:#92400e;font-size:12.5px;font-weight:600;">'
        + '<re-icon icon="tree"></re-icon> You are on approved leave today (' + escapeHtml(leaveSlot || 'Full Day') + ').'
        + '</div>';
    }

    var allAttendance = DB.get('attendance');

    if (!slots.length) {
      cont.innerHTML = bannerHtml + '<div class="day-empty"><re-icon icon="calendar"></re-icon> No classes scheduled for this day.</div>';
      return;
    }

    var sorted = slots.slice().sort(bySlotStart);
    cont.innerHTML = bannerHtml + sorted.map(function(slot) {
      var marked = (slot.attendance && slot.attendance.marked) || isSlotMarked(slot, dateISO, allAttendance);
      var isCancelled = slot.status === 'cancelled';
      var isSubstituted = slot.status === 'substituted';
      var isSubIn = slot.role === 'substitute';
      var isLeave = slot.status === 'leave';

      var statusChip = '';
      var borderStyle = '';
      if (isCancelled) {
        statusChip = '<span class="badge badge-cancelled">Cancelled</span>';
        borderStyle = 'border-color:#e5e7eb;opacity:0.65;';
      } else if (isSubstituted) {
        statusChip = '<span class="badge badge-sub-out">Substituted <re-icon icon="arrow-right"></re-icon> ' + escapeHtml(slot.substituteTeacher || 'Substitute') + '</span>';
        borderStyle = 'border-color:#f59e0b;background:#fffbeb;';
      } else if (isSubIn) {
        statusChip = '<span class="badge badge-sub-in">Substitute for ' + escapeHtml(slot.originalTeacher || 'Faculty') + '</span>';
        borderStyle = 'border:2px solid #8b5cf6;background:rgba(139,92,246,0.04);';
      } else if (isLeave) {
        statusChip = '<span class="badge badge-leave">On Leave</span>';
        borderStyle = 'border-color:#ef4444;background:#fef2f2;';
      }

      var attBtn = '';
      if (marked) {
        attBtn = '<span class="donetag" style="margin-left:auto;"><re-icon icon="check-circle"></re-icon> Marked</span>';
      } else if (isToday && (slot.status === 'scheduled' || isSubIn)) {
              var pNums = Array.isArray(slot.periods) && slot.periods.length ? slot.periods : (slot.periodNumbers && slot.periodNumbers.length ? slot.periodNumbers : [slot.periodNumber]);
      var periodText = pNums.length > 1 ? ('Period ' + pNums[0] + '–' + pNums[pNums.length - 1]) : ('Period ' + slot.periodNumber);
      attBtn = '<button class="attbtn" style="margin-left:auto;" onclick="navigateToAttendance(\'' + (slot.classId || '') + '\',\'' + (slot.subjectId || '') + '\',' + (slot.periodNumber || 'null') + ',\'' + dateISO + '\', ' + JSON.stringify(pNums) + ')"><re-icon icon="check-circle"></re-icon> Take Attendance</button>';
      }

      var slotKey = slot.key || slot._id || ((slot.dayFull || dFull) + '_' + slot.periodNumber);
      var col = (typeof TeacherTimetable !== 'undefined' && TeacherTimetable.getClassColor) ? TeacherTimetable.getClassColor(slot.className) : null;
      var classStyle = (col && !borderStyle) ? ('--cls-border:' + col.border + ';--cls-border-light:' + col.borderLight + ';--cls-text:' + col.text + ';') : '';
      var classCls = (col && !borderStyle) ? ' has-class-color' : '';

      return '<div class="day-slot-card' + (isToday ? ' today-slot' : '') + classCls + '" style="' + borderStyle + classStyle + 'cursor:pointer;" onclick="showTeacherSlotPopover(\'' + escapeHtml(slotKey) + '\', event)">'
        + '<div class="day-time-col">' + escapeHtml(slot.start || '') + '<br><span style="color:var(--tdi);font-weight:400;">to</span><br>' + escapeHtml(slot.end || '') + '</div>'
        + '<div style="flex:1;min-width:0;">'
        +   '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px;">'
        +     '<div style="font-size:14px;font-weight:700;color:var(--td);">' + escapeHtml(slot.subjectName || slot.subject || 'Subject') + '</div>'
        +     (statusChip || '')
        +   '</div>'
        +   '<div style="font-size:12px;color:var(--tmu);"><re-icon icon="school"></re-icon> ' + (col ? '<span style="color:' + col.text + ';font-weight:700;">' + escapeHtml(slot.className || '') + '</span>' : escapeHtml(slot.className || '')) + (slot.periodNumber ? ' · ' + periodText : '') + ((slot.hallNo || slot.room) ? ' · ' + escapeHtml(slot.hallNo || slot.room) : '') + '</div>'
        +   (slot.note ? '<div style="font-size:11px;color:#d97706;margin-top:3px;"><re-icon icon="info-circle"></re-icon> ' + escapeHtml(slot.note) + '</div>' : '')
        + '</div>'
        + (attBtn ? '<div onclick="event.stopPropagation();">' + attBtn + '</div>' : '')
        + '</div>';
    }).join('');
  }

  // Institutional Period Definitions (used as offline fallback)
  const TEACHER_PERIODS = [
    { id:1, num:1, label:'P1', time:'08:30–09:15', start:'08:30', end:'09:15' },
    { id:2, num:2, label:'P2', time:'09:15–10:00', start:'09:15', end:'10:00' },
    { id:'B1', isBreak:true, label:'<re-icon icon="coffee"></re-icon> Break', time:'10:00–10:15' },
    { id:3, num:3, label:'P3', time:'10:15–11:00', start:'10:15', end:'11:00' },
    { id:4, num:4, label:'P4', time:'11:00–11:45', start:'11:00', end:'11:45' },
    { id:5, num:5, label:'P5', time:'11:45–12:30', start:'11:45', end:'12:30' },
    { id:'L',  isBreak:true, label:'<re-icon icon="fork-knife"></re-icon> Lunch', time:'12:30–13:15' },
    { id:6, num:6, label:'P6', time:'01:15–02:00', start:'13:15', end:'14:00' },
    { id:7, num:7, label:'P7', time:'02:00–02:45', start:'14:00', end:'14:45' },
    { id:'B2', isBreak:true, label:'<re-icon icon="coffee"></re-icon> Break', time:'02:45–03:00' },
    { id:8, num:8, label:'P8', time:'03:00–03:45', start:'15:00', end:'15:45' },
    { id:9, num:9, label:'P9', time:'03:45–04:30', start:'15:45', end:'16:30' },
  ];

  // ── MY WEEKLY TIMETABLE GRID ──
  // Adaptive multi-set matrix grid powered by TeacherTimetable component module
  var _teacherTimetableView = null;

  function renderScheduleStatCards() {
    var gridEl = document.getElementById('sched-stats-grid');
    if (!gridEl) return;

    var timetable = getMyTimetable();
    var slots = timetable.filter(function(s) {
      return !s.isSpanContinuation && !(Number(s.spanIndex) > 0);
    });

    var classesSet = {};
    var totalMins = 0;
    slots.forEach(function(s) {
      if (s.className) classesSet[s.className] = true;
      if (s.start && s.end) {
        var sp = s.start.split(':').map(Number);
        var ep = s.end.split(':').map(Number);
        var m = (ep[0] * 60 + ep[1]) - (sp[0] * 60 + sp[1]);
        if (m > 0) totalMins += m;
      }
    });

    var totalHours = (totalMins / 60).toFixed(1).replace(/\.0$/, '');
    var uniqueClasses = Object.keys(classesSet).length;

    var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var todayDayName = dayNames[new Date().getDay()];
    var todaySlots = slots.filter(function(s) { return s.day === todayDayName.slice(0,3) || s.dayFull === todayDayName; }).sort(bySlotStart);

    var heroTitle = todaySlots.length ? (todaySlots[0].subjectName || todaySlots[0].subject || 'Upcoming Class') : 'Schedule Up-to-Date';
    var heroMeta = todaySlots.length ? ((todaySlots[0].className || '') + ' · ' + (todaySlots[0].start || '') + '–' + (todaySlots[0].end || '')) : 'No scheduled conflicts';

    gridEl.innerHTML =
      '<div class="sched-hero-card">'
      + '<div class="sched-hero-info">'
      +   '<div class="sched-hero-eyebrow">Academic Schedule</div>'
      +   '<div class="sched-hero-title">' + escapeHtml(heroTitle) + '</div>'
      +   '<div class="sched-hero-meta">' + escapeHtml(heroMeta) + '</div>'
      + '</div>'
      + '<button type="button" class="sched-hero-btn" onclick="switchSchedTab(\'day\')">View Day Schedule</button>'
      + '</div>'
      + '<div class="sched-metric-card">'
      +   '<div class="sched-metric-val">' + slots.length + '</div>'
      +   '<div class="sched-metric-lbl">Weekly Periods</div>'
      + '</div>'
      + '<div class="sched-metric-card">'
      +   '<div class="sched-metric-val">' + totalHours + 'h</div>'
      +   '<div class="sched-metric-lbl">Teaching Hours</div>'
      + '</div>'
      + '<div class="sched-metric-card">'
      +   '<div class="sched-metric-val">' + uniqueClasses + '</div>'
      +   '<div class="sched-metric-lbl">Assigned Classes</div>'
      + '</div>';
  }
  window.renderScheduleStatCards = renderScheduleStatCards;

  function renderTimetableGrid() {
    renderScheduleStatCards();
    var container = document.getElementById('tt-grid');
    if (!container) return;

    if (typeof TeacherTimetable === 'undefined' || !TeacherTimetable.mount) {
      console.warn('TeacherTimetable module not loaded');
      return;
    }

    var timingSets = DB.get('timing-sets');
    if (!Array.isArray(timingSets) || timingSets.length < 2) {
      timingSets = (typeof TeacherTimetable !== 'undefined' && TeacherTimetable.CANONICAL_TIMING_SETS) || [];
    }
    var slots      = getMyTimetable();

    if (_teacherTimetableView && container.querySelector('.ttx')) {
      _teacherTimetableView.update({ timingSets: timingSets, slots: slots });
    } else {
      _teacherTimetableView = TeacherTimetable.mount(container, {
        timingSets: timingSets,
        slots: slots,
        timeFormat: '24h',
        onSlotClick: function(rawSlot, ev) {
          var slotKey = rawSlot.key || rawSlot._id || ((rawSlot.dayFull || rawSlot.day) + '_' + rawSlot.periodNumber);
          showTeacherSlotPopover(slotKey, ev);
        }
      });
    }
  }

  // ── TEACHER SLOT POPOVER QUICK ACTIONS ──
  function showTeacherSlotPopover(slotKey, event) {
    if (event) event.stopPropagation();
    var timetable = getMyTimetable();
    var slot = timetable.find(function(t) {
      return (t.key && t.key === slotKey) || t._id === slotKey || ((t.dayFull || t.day) + '_' + t.periodNumber) === slotKey;
    });

    if (!slot) {
      var daysCache = DB.get('schedule-days') || {};
      for (var d in daysCache) {
        var daySlots = daysCache[d]?.slots || [];
        var found = daySlots.find(function(s) {
          return (s.key && s.key === slotKey) || s._id === slotKey || ((s.dayFull || s.day) + '_' + s.periodNumber) === slotKey;
        });
        if (found) { slot = found; break; }
      }
    }

    if (!slot) return;

    var old = document.getElementById('tt-active-popover');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.className = 'tt-popover-overlay';
    overlay.id = 'tt-active-popover';
    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.remove();
    };

    var isTTC = !!(currentUser.isTimeTableCoordinator || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s.option === 'isTimeTableCoordinator'; })));
    var todayStr = todayISO();
    var isToday = (slot.date === todayStr) || (!slot.date && DAY_NAMES[new Date(todayStr + 'T00:00:00').getDay()] === (slot.dayFull || slot.day));
    var canTakeAtt = isToday && (!slot.attendance || !slot.attendance.marked) && slot.status === 'scheduled';

    var actionsHtml = '';
    if (canTakeAtt) {
          var pNums = Array.isArray(slot.periods) && slot.periods.length ? slot.periods : (slot.periodNumbers && slot.periodNumbers.length ? slot.periodNumbers : [slot.periodNumber]);
    var targetCId = slot.classTrackId || toClassTrackId(slot.classId) || '';
    actionsHtml += '<button class="tt-pop-btn" style="background:#16a34a;color:#fff;font-weight:700;" onclick="document.getElementById(\'tt-active-popover\').remove();navigateToAttendance(\'' + targetCId + '\',\'' + (slot.subjectId || '') + '\',' + (slot.periodNumber || 'null') + ',\'' + todayStr + '\', ' + JSON.stringify(pNums) + ')"><re-icon icon="check-circle"></re-icon> Take Attendance Now</button>';
    }

    actionsHtml += '<button class="tt-pop-btn" onclick="document.getElementById(\'tt-active-popover\').remove();requestSubstituteForSlot(\'' + escapeHtml(slotKey) + '\')"><re-icon icon="user-plus"></re-icon> Request Substitute / Apply Leave</button>';

    if (isTTC) {
      actionsHtml += '<button class="tt-pop-btn" onclick="document.getElementById(\'tt-active-popover\').remove();goToTimetable()"><re-icon icon="edit"></re-icon> Edit in Timetable Workspace</button>';
    }

    var box = document.createElement('div');
    box.className = 'tt-popover-box';
    box.innerHTML =
      '<div class="tt-popover-title"><re-icon icon="clipboard"></re-icon> ' + escapeHtml(slot.subjectName || slot.subject || 'Schedule Slot') + '</div>'
      + '<div class="tt-popover-sub">' + escapeHtml(slot.dayFull || slot.day || '') + ' ' + escapeHtml(slot.start || '') + '–' + escapeHtml(slot.end || '') + ' | ' + escapeHtml(slot.className || '') + ((slot.hallNo || slot.room) ? ' (' + escapeHtml(slot.hallNo || slot.room) + ')' : '') + '</div>'
      + (slot.note ? '<div style="font-size:12px;color:#d97706;margin:8px 0 12px;background:#fef3c7;padding:6px 10px;border-radius:6px;"><re-icon icon="info-circle"></re-icon> ' + escapeHtml(slot.note) + '</div>' : '')
      + '<div class="tt-popover-actions">'
      + actionsHtml
      + '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }
  window.showTeacherSlotPopover = showTeacherSlotPopover;

  function cancelTeacherSlotToday(slotKey) {
    showToast('Cancelling a period needs your Timetable Coordinator or HOD — they can mark it cancelled from the Timetable workspace.', 'info');
  }
  window.cancelTeacherSlotToday = cancelTeacherSlotToday;

  function requestSubstituteForSlot(slotKey) {
    var timetable = getMyTimetable();
    var slot = timetable.find(function(t) {
      return (t.key && t.key === slotKey) || t._id === slotKey || ((t.dayFull || t.day) + '_' + t.periodNumber) === slotKey;
    });
    if (!slot) {
      var daysCache = DB.get('schedule-days') || {};
      for (var d in daysCache) {
        var daySlots = daysCache[d]?.slots || [];
        var found = daySlots.find(function(s) {
          return (s.key && s.key === slotKey) || s._id === slotKey || ((s.dayFull || s.day) + '_' + s.periodNumber) === slotKey;
        });
        if (found) { slot = found; break; }
      }
    }
    nav('my-leaves');
    var target = null;
    if (slot && (slot.date || slot.dayFull || slot.day)) {
      if (slot.date) {
        target = slot.date;
      } else {
        var sDay = slot.dayFull || slot.day;
        var now = new Date();
        for (var k = 0; k < 7; k++) {
          if (DAY_NAMES[now.getDay()] === sDay) { target = localISO(now); break; }
          now.setDate(now.getDate() + 1);
        }
      }
    }
    openTeacherApplyLeaveModal(target);
    showToast('Pick a substitute for ' + ((slot && (slot.subjectName || slot.subject)) || 'this class') + ' in the slot list below.', 'info');
  }
  window.requestSubstituteForSlot = requestSubstituteForSlot;

  function exportTeacherTimetablePDF() {
    window.print();
  }
  window.exportTeacherTimetablePDF = exportTeacherTimetablePDF;

  function onSchedPeriodChange() {
    var pVal = document.getElementById('schedperiod').value;
    if (pVal === 'custom') return;
    var pNum = parseInt(pVal, 10);
    var pDef = TEACHER_PERIODS.find(function(p) { return p.num === pNum; });
    if (!pDef) return;

    document.getElementById('schedst').value = pDef.start;
    var type = document.getElementById('schedtype').value;
    if (type === 'Lab' && pNum <= 7) {
      // Span 3 periods
      var endP = TEACHER_PERIODS.find(function(p) { return p.num === pNum + 2; });
      document.getElementById('schedet').value = endP ? endP.end : pDef.end;
    } else {
      document.getElementById('schedet').value = pDef.end;
    }
  }
  window.onSchedPeriodChange = onSchedPeriodChange;

  function onSchedTypeChange() {
    var type = document.getElementById('schedtype').value;
    var combWrap = document.getElementById('schedcombwrap');
    if (combWrap) {
      combWrap.style.display = (type === 'Combined') ? 'block' : 'none';
      if (type === 'Combined') {
        var clsEl = document.getElementById('schedcombcls');
        // The select ships with one placeholder option, so `!options.length`
        // was never true and the class list was never filled in.
        if (clsEl && clsEl.options.length <= 1) {
          clsEl.innerHTML = '<option value="">— Optional second section —</option>'
            + getMyClasses().map(function(c) { return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + '</option>'; }).join('');
        }
      }
    }
    onSchedPeriodChange();
  }
  window.onSchedTypeChange = onSchedTypeChange;

  function openTeacherAddSlot(day, periodNum) {
    document.getElementById('schedeid').value = '';
    document.getElementById('mschedtit').innerHTML = '<re-icon icon="plus"></re-icon> Add Schedule Slot';
    document.getElementById('schedday').value = day || 'Mon';
    document.getElementById('schedperiod').value = periodNum ? String(periodNum) : '1';
    onSchedPeriodChange();
    document.getElementById('schedtype').value = 'Theory';
    document.getElementById('schedhall').value = '';
    var combWrap = document.getElementById('schedcombwrap');
    if (combWrap) combWrap.style.display = 'none';
    document.getElementById('schedcls').innerHTML = buildClassOptions(false);
    document.getElementById('schedsub').innerHTML = '<option value="">— Select —</option>';
    openModal('msched');
  }
  window.openTeacherAddSlot = openTeacherAddSlot;

  function openAddSlot() {
    openTeacherAddSlot('Mon', 1);
  }
  window.openAddSlot = openAddSlot;

  function openAddSlotForDay(day) {
    openTeacherAddSlot(day, 1);
  }
  var openAddSlotDay = openAddSlotForDay;
  window.openAddSlotForDay = openAddSlotForDay;

  function openEditSlot(slotId) {
    const slot = DB.get('timetable').find(function(t) { return t._id === slotId; });
    if (!slot) return;
    document.getElementById('schedeid').value = slotId;
    document.getElementById('mschedtit').innerHTML = '<re-icon icon="edit"></re-icon> Edit Schedule Slot';
    document.getElementById('schedday').value = slot.day;
    document.getElementById('schedst').value = slot.start;
    document.getElementById('schedet').value = slot.end;
    document.getElementById('schedtype').value = slot.type || 'Theory';
    document.getElementById('schedhall').value = slot.hallNo || '';
    var editPeriod = slot.periodNumber || periodFromStartTime(slot.start);
    document.getElementById('schedperiod').value = editPeriod ? String(editPeriod) : 'custom';
    // onSchedTypeChange() re-derives start/end from the period; restore the
    // slot's own times afterwards so editing doesn't silently change them.
    onSchedTypeChange();
    document.getElementById('schedst').value = slot.start;
    document.getElementById('schedet').value = slot.end;
    document.getElementById('schedcls').innerHTML = buildClassOptions(false);
    document.getElementById('schedsub').innerHTML = '<option value="">— Select —</option>';
    openModal('msched');
    setTimeout(function() {
      document.getElementById('schedcls').value = slot.classId;
      populateScheduleSubjects();
      setTimeout(function() { document.getElementById('schedsub').value = slot.subjectId; }, 100);
    }, 50);
  }
  window.openEditSlot = openEditSlot;

  function populateScheduleSubjects() {
    const classId = document.getElementById('schedcls').value;
    const relatedAssignments = getMyAssignments().filter(function(a) { return a.classId === classId; });
    document.getElementById('schedsub').innerHTML = '<option value="">— Select —</option>'
      + relatedAssignments.map(function(a) {
          return '<option value="' + escapeHtml(a.subjectId) + '">' + escapeHtml(a.subjectName) + '</option>';
        }).join('');
  }
  var populateSchedSubs = populateScheduleSubjects;
  window.populateSchedSubs = populateScheduleSubjects;

  function saveScheduleSlot() {
    const classId   = document.getElementById('schedcls').value;
    const subjectId = document.getElementById('schedsub').value;
    const day       = document.getElementById('schedday').value;
    const startTime = document.getElementById('schedst').value;
    const endTime   = document.getElementById('schedet').value;
    const editId    = document.getElementById('schedeid').value;
    const pVal      = document.getElementById('schedperiod').value;
    const type      = document.getElementById('schedtype').value || 'Theory';
    const hallNo    = (document.getElementById('schedhall').value || '').trim();

    if (!classId || !subjectId || !day || !startTime || !endTime) {
      showToast('Please fill all fields', 'warn'); return;
    }
    if (startTime >= endTime) {
      showToast('End time must be after start time', 'warn'); return;
    }

    const assignment = getMyAssignments().find(function(a) { return a.classId === classId && a.subjectId === subjectId; });
    if (!assignment) { showToast('Assignment not found', 'warn'); return; }

    var pNum = pVal !== 'custom' ? parseInt(pVal, 10) : null;
    var isCombined = type === 'Combined';
    var combClsEl = document.getElementById('schedcombcls');
    var combClassNames = isCombined && combClsEl && combClsEl.value ? [combClsEl.options[combClsEl.selectedIndex]?.text] : [];

    const slotData = {
      classId: classId, className: assignment.className,
      subjectId: subjectId, subjectName: assignment.subjectName,
      teacherId: currentUser._id, trackId: currentUser.trackId, teacherName: currentUser.name,
      day: day, start: startTime, end: endTime,
      periodNumber: pNum, type: type, hallNo: hallNo,
      isCombined: isCombined, combinedClassNames: combClassNames,
      isDraft: false
    };

    // Parse JSON and turn HTTP/`{error}` failures into rejections. The old
    // code ignored the status, so a 403 ("Timetable Coordinator access
    // required") or 400 still toasted "Slot added!" and wrote a phantom slot
    // into the local cache that vanished on reload.
    function readJson(r) {
      return r.json().catch(function() { return {}; }).then(function(body) {
        if (!r.ok || (body && body.error)) throw new Error((body && body.error) || ('Server error ' + r.status));
        return body;
      });
    }

    var savePromise;
    if (editId) {
      savePromise = api('/api/timetable/' + encodeURIComponent(editId), {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(slotData)
      }).then(readJson).then(function(saved) {
        DB.update('timetable', editId, normalizeScheduleSlot(Object.assign({}, slotData, saved || {}, { _id: editId })));
        showToast('<re-icon icon="check-circle"></re-icon> Slot updated!');
      });
    } else {
      savePromise = api('/api/timetable', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(slotData)
      }).then(readJson).then(function(saved) {
        var rows = DB.get('timetable');
        rows.push(normalizeScheduleSlot(Object.assign({}, slotData, saved || {})));
        DB.set('timetable', rows);
        showToast('<re-icon icon="check-circle"></re-icon> Slot added!');
      });
    }

    savePromise.then(function() {
      closeModal('msched');
      renderTimetableGrid();
      renderSchedulePage();
      if (currentSchedTab === 'day') renderDayView();
    }).catch(function(err) {
      showToast('Could not save slot: ' + err.message, 'error');
    });
  }
  var saveSlot = saveScheduleSlot;
  window.saveSlot = saveSlot;

  async function deleteSlot(slotId) {
    const ok = await showConfirm('Delete this slot from your timetable?', 'Delete Timetable Slot', null, null, { danger: true, confirmText: 'Delete Slot' });
    if (!ok) return;
    // Remove locally only after the server confirms (it used to delete the
    // card immediately even when the request was rejected).
    api('/api/timetable/' + encodeURIComponent(slotId), {
      method: 'DELETE',
      headers: authHeaders()
    })
    .then(function(r) {
      return r.json().catch(function() { return {}; }).then(function(body) {
        if (!r.ok || (body && body.error)) throw new Error((body && body.error) || ('Server error ' + r.status));
      });
    })
    .then(function() {
      DB.delete('timetable', slotId);
      showToast('Slot deleted', 'success');
      renderTimetableGrid();
      renderSchedulePage();
      if (currentSchedTab === 'day') renderDayView();
    })
    .catch(function(err) {
      showToast('Could not delete slot: ' + err.message, 'error');
    });
  }
  var delSlot = deleteSlot;
  window.deleteSlot = deleteSlot;
  window.delSlot = deleteSlot;

  // TAKE ATTENDANCE
  let attendanceStudents = [];

  // ── All Classes & All Subjects (Non-strict Mode) ──
  function fetchAllClassesAndSubjects() {
    var tok = getToken();
    if (!tok) return Promise.resolve({ classes: [], subjects: [] });

    var pClasses = (DB.get('all-classes') && DB.get('all-classes').length)
      ? Promise.resolve(DB.get('all-classes'))
      : api('/api/classes', { headers: authHeaders() })
          .then(function(r) { return r.ok ? r.json() : []; })
          .then(function(list) {
            var rows = Array.isArray(list) ? list : (list && list.data ? list.data : []);
            DB.set('all-classes', rows);
            return rows;
          })
          .catch(function(err) {
            console.error('[fetchAllClasses Error]:', err);
            return DB.get('all-classes') || [];
          });

    var pSubjects = (DB.get('all-subjects') && DB.get('all-subjects').length)
      ? Promise.resolve(DB.get('all-subjects'))
      : api('/api/subjects', { headers: authHeaders() })
          .then(function(r) { return r.ok ? r.json() : []; })
          .then(function(list) {
            var rows = Array.isArray(list) ? list : (list && list.data ? list.data : []);
            DB.set('all-subjects', rows);
            if (!DB.get('subjects') || !DB.get('subjects').length) {
              DB.set('subjects', rows);
            }
            return rows;
          })
          .catch(function(err) {
            console.error('[fetchAllSubjects Error]:', err);
            return DB.get('all-subjects') || [];
          });

    return Promise.all([pClasses, pSubjects]).then(function(results) {
      return { classes: results[0] || [], subjects: results[1] || [] };
    });
  }
  window.fetchAllClassesAndSubjects = fetchAllClassesAndSubjects;

  function buildAttendanceClassOptions(selectedId) {
    var classes = DB.get('all-classes') || [];
    if (!classes.length) {
      var myCls = getMyClasses();
      if (myCls.length) {
        return '<option value="">— Select Class —</option>' + myCls.map(function(c) {
          var optVal = c.trackId || c.classTrackId || c.name || c.id;
          var isSel = selectedId && (
            optVal === String(selectedId) ||
            String(c.id) === String(selectedId) ||
            String(c.rawId) === String(selectedId) ||
            String(c.name).toLowerCase() === String(selectedId).toLowerCase()
          );
          return '<option value="' + escapeHtml(optVal) + '"' + (isSel ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>';
        }).join('');
      }
      return '<option value="">— Select Class —</option>';
    }

    var sorted = classes.slice().sort(function(a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
    });

    var html = '<option value="">— Select Class —</option>';
    var foundSelected = false;
    sorted.forEach(function(cls) {
      var cTrack = cls.trackId || cls.classTrackId || cls.name || String(cls._id || '');
      var cId = cTrack;
      var cName = cls.name || 'Class';
      var badge = cls.batch || '';
      var badgeAttr = badge ? (' data-badge="' + escapeHtml(badge) + '"') : '';
      var isSel = selectedId && (
        cId === String(selectedId) ||
        String(cls._id) === String(selectedId) ||
        String(cls.trackId) === String(selectedId) ||
        String(cls.classTrackId) === String(selectedId) ||
        (cls.name && String(cls.name).toLowerCase() === String(selectedId).toLowerCase())
      );
      if (isSel) foundSelected = true;
      html += '<option value="' + escapeHtml(cId) + '"' + badgeAttr + (isSel ? ' selected' : '') + '>' + escapeHtml(cName) + '</option>';
    });
    if (selectedId && !foundSelected) {
      var myCls = getMyClasses();
      var matchCls = myCls.find(function(c) {
        return String(c.id) === String(selectedId) ||
               String(c.rawId) === String(selectedId) ||
               String(c.trackId) === String(selectedId) ||
               String(c.classTrackId) === String(selectedId) ||
               (c.name && String(c.name).toLowerCase() === String(selectedId).toLowerCase());
      });
      var fallbackTrack = matchCls ? (matchCls.trackId || matchCls.classTrackId || matchCls.name || matchCls.id) : toClassTrackId(selectedId);
      var fallbackName = matchCls ? matchCls.name : (fallbackTrack || 'Class');
      html += '<option value="' + escapeHtml(fallbackTrack) + '" selected>' + escapeHtml(fallbackName) + '</option>';
    }
    return html;
  }
  window.buildAttendanceClassOptions = buildAttendanceClassOptions;

  function buildAttendanceSubjectOptions(selectedId, filterClassId) {
    var subjects = DB.get('all-subjects') || DB.get('subjects') || [];
    if (!subjects.length) {
      var mySubs = getMySubjects();
      if (mySubs.length) {
        return '<option value="">— Select Subject —</option>' + mySubs.map(function(s) {
          var isSel = selectedId && (String(s.id) === String(selectedId));
          return '<option value="' + escapeHtml(s.id) + '"' + (isSel ? ' selected' : '') + '>' + escapeHtml(s.name) + '</option>';
        }).join('');
      }
      return '<option value="">— Select Subject —</option>';
    }

    var sorted = subjects.slice().sort(function(a, b) {
      var codeA = (a.code || a.subjectCode || a.courseCode || '').trim();
      var codeB = (b.code || b.subjectCode || b.courseCode || '').trim();
      if (codeA && codeB) return codeA.localeCompare(codeB, undefined, { numeric: true });
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    var myAssigns = getMyAssignments() || [];
    var classAssignSubjectIds = new Set();
    if (filterClassId) {
      myAssigns.filter(function(a) { return String(a.classId) === String(filterClassId); }).forEach(function(a) {
        if (a.subjectId) classAssignSubjectIds.add(String(a.subjectId));
      });
    }

    var prioritized = [];
    var others = [];
    sorted.forEach(function(s) {
      var sId = String(s._id || s.subjectTrackId || s.trackId || '');
      if (classAssignSubjectIds.has(sId)) {
        prioritized.push(s);
      } else {
        others.push(s);
      }
    });

    var finalSubs = prioritized.length ? prioritized.concat(others) : sorted;

    var html = '<option value="">— Select Subject —</option>';
    var foundSubSelected = false;
    finalSubs.forEach(function(sub) {
      var sId = String(sub._id || sub.subjectTrackId || sub.trackId || '');
      var sName = sub.name || 'Subject';
      var sCode = (sub.code || sub.subjectCode || sub.courseCode || '').trim();
      var label = sCode ? (sCode + ' - ' + sName) : sName;
      var isAssigned = classAssignSubjectIds.has(sId);
      var badgeAttr = sCode ? (' data-badge="' + escapeHtml(sCode) + '"') : (isAssigned ? ' data-badge="Assigned"' : '');
      var isSel = selectedId && (sId === String(selectedId));
      if (isSel) foundSubSelected = true;
      html += '<option value="' + escapeHtml(sId) + '"' + badgeAttr + (isSel ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    });
    if (selectedId && !foundSubSelected) {
      var mySubs = getMySubjects();
      var matchSub = mySubs.find(function(s) { return String(s.id) === String(selectedId); });
      var fallbackSubName = matchSub ? matchSub.name : 'Subject';
      html += '<option value="' + escapeHtml(selectedId) + '" selected>' + escapeHtml(fallbackSubName) + '</option>';
    }
    return html;
  }
  window.buildAttendanceSubjectOptions = buildAttendanceSubjectOptions;

  function initAttendanceSearchableDropdowns() {
    if (typeof SearchableDropdown === 'undefined') return;
    if (!SearchableDropdown.get('attcls')) {
      SearchableDropdown.attach('attcls', {
        kind: 'class',
        placeholder: '— Select Class —',
        searchPlaceholder: 'Search class, batch…'
      });
    } else {
      SearchableDropdown.sync('attcls');
    }

    if (!SearchableDropdown.get('attsub')) {
      SearchableDropdown.attach('attsub', {
        kind: 'subject',
        placeholder: '— Select Subject —',
        searchPlaceholder: 'Search subject name, code…'
      });
    } else {
      SearchableDropdown.sync('attsub');
    }
  }

  function isForceTimetableSlots() {
    var pub = window._publicSettings || window._pubSettings || (DB.get('settings') || {}).public || {};
    return !!(pub && pub.attendance && pub.attendance.forceTimetableSlots);
  }
  window.isForceTimetableSlots = isForceTimetableSlots;

  function ensureMyScheduleDay(dateISO) {
    if (!dateISO) return Promise.resolve(null);
    var cached = DB.get('schedule-days') || {};
    if (cached[dateISO]) return Promise.resolve(cached[dateISO]);

    var tok = getToken();
    if (!tok) return Promise.resolve(null);

    return api('/api/timetable/my-schedule?from=' + encodeURIComponent(dateISO) + '&to=' + encodeURIComponent(dateISO), {
      headers: authHeaders()
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(res) {
      if (res && res.ok && res.data && Array.isArray(res.data.days) && res.data.days[0]) {
        var dayDoc = res.data.days[0];
        var cur = DB.get('schedule-days') || {};
        cur[dateISO] = dayDoc;
        DB.set('schedule-days', cur);
        return dayDoc;
      }
      return null;
    })
    .catch(function(err) {
      console.error('[ensureMyScheduleDay Error]:', err);
      return null;
    });
  }

  function initAttendancePageStandard() {
    if (window._pendingAttTarget && (Date.now() - window._pendingAttTarget.timestamp < 3000)) {
      return;
    }
    setTimeout(function() {
      if (window._pendingAttTarget && (Date.now() - window._pendingAttTarget.timestamp < 3000)) return;
      var clsEl = document.getElementById('attcls');
      var subEl = document.getElementById('attsub');
      if (clsEl && !clsEl.value) {
        var savedCls = localStorage.getItem('eams_last_att_class');
        if (savedCls && Array.from(clsEl.options).some(function(o) { return o.value === savedCls; })) {
          clsEl.value = savedCls;
          if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('attcls');
          if (typeof attLoadSubs === 'function') attLoadSubs();
          setTimeout(function() {
            if (window._pendingAttTarget && (Date.now() - window._pendingAttTarget.timestamp < 3000)) return;
            var savedSub = localStorage.getItem('eams_last_att_subject');
            if (savedSub && subEl && Array.from(subEl.options).some(function(o) { return o.value === savedSub; })) {
              subEl.value = savedSub;
              if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('attsub');
            }
          }, 150);
        }
      }
      if (clsEl && !clsEl._hasRememberListener) {
        clsEl._hasRememberListener = true;
        clsEl.addEventListener('change', rememberAttendanceSelection);
      }
      if (subEl && !subEl._hasRememberListener) {
        subEl._hasRememberListener = true;
        subEl.addEventListener('change', rememberAttendanceSelection);
      }
    }, 120);
    var enfBanner = document.getElementById('att-tt-enforced-banner');
    if (enfBanner) enfBanner.style.display = 'none';

    var clsEl = document.getElementById('attcls');
    var subEl = document.getElementById('attsub');

    var currentCls = clsEl ? clsEl.value : '';
    var currentSub = subEl ? subEl.value : '';

    if (clsEl) {
      clsEl.innerHTML = buildAttendanceClassOptions(currentCls);
      if (currentCls && clsEl.querySelector('option[value="' + currentCls + '"]')) {
        clsEl.value = currentCls;
      }
    }

    if (subEl) {
      subEl.innerHTML = buildAttendanceSubjectOptions(currentSub, currentCls);
      if (currentSub && subEl.querySelector('option[value="' + currentSub + '"]')) {
        subEl.value = currentSub;
      }
    }

    populatePeriodOptions('attperiod');
    initAttendanceSearchableDropdowns();
    renderTodayClassesChips();
    checkTimetableMatch();

    // Ensure all classes and subjects are fetched and rendered if DB wasn't loaded yet
    if (!DB.get('all-classes') || !DB.get('all-subjects')) {
      fetchAllClassesAndSubjects().then(function() {
        if (window._pendingAttTarget && (Date.now() - window._pendingAttTarget.timestamp < 3000)) return;
        var keepC = clsEl ? clsEl.value : '';
        var keepS = subEl ? subEl.value : '';
        if (clsEl) {
          clsEl.innerHTML = buildAttendanceClassOptions(keepC);
          if (keepC && clsEl.querySelector('option[value="' + keepC + '"]')) clsEl.value = keepC;
        }
        if (subEl) {
          subEl.innerHTML = buildAttendanceSubjectOptions(keepS, keepC);
          if (keepS && subEl.querySelector('option[value="' + keepS + '"]')) subEl.value = keepS;
        }
        initAttendanceSearchableDropdowns();
      });
    }
  }

  function populateStrictSubjectsAndPeriods(classId, preferredPeriod, preferredSubjectId, optSlots, preferredPeriodNumbers) {
    var subEl = document.getElementById('attsub');
    var periodEl = document.getElementById('attperiod');
    if (!classId) {
      if (subEl) subEl.innerHTML = '<option value="">— Select Class First —</option>';
      if (periodEl) periodEl.innerHTML = '<option value="">—</option>';
      if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('attsub');
      return;
    }

    var dateVal = document.getElementById('attdate') ? document.getElementById('attdate').value : todayISO();
    if (!dateVal) dateVal = todayISO();
    var cached = DB.get('schedule-days') || {};
    var dayData = cached[dateVal];
    var slots = optSlots || ((dayData && Array.isArray(dayData.slots)) ? dayData.slots.filter(function(s) { return s.status === 'scheduled'; }) : []);

    // Filter out continuation slots so multi-period lab blocks appear once as combined
    var classSlots = slots.filter(function(s) {
      if (s.isSpanContinuation || Number(s.spanIndex) > 0) return false;
      return String(s.classId) === String(classId) ||
             (s.classTrackId && String(s.classTrackId) === String(classId)) ||
             (s.className && String(s.className).toLowerCase() === String(classId).toLowerCase());
    });

    if (!classSlots.length) {
      if (subEl) subEl.innerHTML = '<option value="">No subjects scheduled</option>';
      if (periodEl) periodEl.innerHTML = '<option value="">—</option>';
      if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('attsub');
      return;
    }

    // Populate Subjects
    var subjectMap = new Map();
    var allSubs = (typeof DB !== 'undefined' && DB.get) ? (DB.get('subjects') || []) : [];
    classSlots.forEach(function(s) {
      var rawSub = s.subjectName || s.subject || '';
      var subKey = String(s.subjectId || rawSub || '');
      if (subKey && !subjectMap.has(subKey)) {
        var resolvedId = s.subjectId;
        if (!resolvedId && allSubs.length && rawSub) {
          var rawLower = String(rawSub).trim().toLowerCase();
          var sMatch = allSubs.find(function(sub) {
            var sc = (sub.code || sub.subjectCode || '').trim().toLowerCase();
            var sn = (sub.name || '').trim().toLowerCase();
            var ss = (sub.shortName || '').trim().toLowerCase();
            return (sc && rawLower.includes(sc)) || (sn && (rawLower === sn || rawLower.includes(sn))) || (ss && (rawLower === ss || rawLower.endsWith(' ' + ss)));
          });
          if (sMatch) resolvedId = String(sMatch._id || sMatch.subjectTrackId);
        }
        subjectMap.set(subKey, {
          id: resolvedId || s.subjectId || rawSub || 'Subject',
          name: rawSub || 'Subject'
        });
      }
    });

    var subList = Array.from(subjectMap.values());
    if (subEl) {
      subEl.innerHTML = (subList.length > 1 ? '<option value="">— Select Subject —</option>' : '') +
        subList.map(function(sub) {
          return '<option value="' + escapeHtml(sub.id) + '">' + escapeHtml(sub.name) + '</option>';
        }).join('');

      if (preferredSubjectId && subList.some(function(s) { return String(s.id) === String(preferredSubjectId); })) {
        subEl.value = String(preferredSubjectId);
      } else if (subList.length === 1) {
        subEl.value = String(subList[0].id);
      }
    }
    if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('attsub');

    // Populate Periods with combined options for multi-period labs
    var periodOptions = [];
    classSlots.forEach(function(s) {
      var pNums = Array.isArray(s.periods) && s.periods.length
        ? s.periods.slice()
        : (Array.isArray(s.periodNumbers) && s.periodNumbers.length
          ? s.periodNumbers.slice()
          : (s.span && s.span > 1
            ? Array.from({ length: s.span }, function(_, i) { return (Number(s.periodNumber) || 1) + i; })
            : [Number(s.periodNumber) || 1]));

      pNums = pNums.map(Number).filter(function(n) { return !isNaN(n) && n > 0; });
      if (!pNums.length) pNums = [Number(s.periodNumber) || 1];

      var key = pNums.join(',');
      if (!periodOptions.some(function(opt) { return opt.key === key; })) {
        var label = pNums.length > 1
          ? ('Period ' + pNums[0] + '–' + pNums[pNums.length - 1])
          : ('Period ' + pNums[0]);

        if (s.start && s.end) {
          label += ' (' + s.start + '–' + s.end + ')';
        } else if (s.start) {
          label += ' (' + s.start + ')';
        }

        if (pNums.length > 1) {
          label += ' [Combined ' + pNums.length + ' Periods]';
        }

        periodOptions.push({
          key: key,
          value: String(pNums[0]),
          periods: pNums,
          label: label,
          subjectId: s.subjectId
        });
      }
    });

    periodOptions.sort(function(a, b) { return a.periods[0] - b.periods[0]; });

    if (periodEl) {
      periodEl.innerHTML = (periodOptions.length > 1 ? '<option value="">— Select Period —</option>' : '') +
        periodOptions.map(function(opt) {
          return '<option value="' + opt.value + '" data-periods="' + opt.periods.join(',') + '">' + escapeHtml(opt.label) + '</option>';
        }).join('');

      var chosenOpt = null;
      var targetPNums = Array.isArray(preferredPeriodNumbers) && preferredPeriodNumbers.length ? preferredPeriodNumbers.map(Number) : null;
      var targetP = preferredPeriod ? Number(preferredPeriod) : null;

      if (targetPNums && targetPNums.length) {
        chosenOpt = periodOptions.find(function(opt) {
          return opt.periods.some(function(p) { return targetPNums.includes(p); });
        });
      }
      if (!chosenOpt && targetP) {
        chosenOpt = periodOptions.find(function(opt) {
          return opt.periods.includes(targetP);
        });
      }
      if (!chosenOpt && periodOptions.length === 1) {
        chosenOpt = periodOptions[0];
      }

      if (chosenOpt) {
        periodEl.value = chosenOpt.value;
      }
    }
  }
  window.populateStrictSubjectsAndPeriods = populateStrictSubjectsAndPeriods;

  function initAttendancePageStrict(preferredClassId, preferredPeriodNumber, preferredSubjectId, preferredPeriodNumbers) {
    var warnEl = document.getElementById('att-tt-warn');
    if (warnEl) warnEl.style.display = 'none';

    var enfBanner = document.getElementById('att-tt-enforced-banner');
    var enfText = document.getElementById('att-tt-enforced-text');
    var activePill = document.getElementById('att-tt-active-pill');
    if (enfBanner) enfBanner.style.display = 'flex';
    if (activePill) activePill.style.display = 'none';

    var dateVal = document.getElementById('attdate') ? document.getElementById('attdate').value : todayISO();
    if (!dateVal) dateVal = todayISO();

    var classEl = document.getElementById('attcls');
    var subEl = document.getElementById('attsub');
    var periodEl = document.getElementById('attperiod');

    if (classEl && (!classEl.options || classEl.options.length <= 1)) {
      classEl.innerHTML = '<option value="">Loading scheduled classes…</option>';
      if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('attcls');
    }

    ensureMyScheduleDay(dateVal).then(function(dayData) {
      var rawSlots = (dayData && Array.isArray(dayData.slots)) ? dayData.slots : [];
      var validSlots = rawSlots.filter(function(s) {
        if (s.isSpanContinuation || Number(s.spanIndex) > 0) return false;
        return s.status === 'scheduled';
      });

      renderTodayClassesChips();

      if (!validSlots.length) {
        if (enfText) {
          enfText.textContent = 'No classes or approved substitutions are scheduled in your timetable for ' + dateVal + '.';
        }
        if (classEl) classEl.innerHTML = '<option value="">No classes scheduled</option>';
        if (subEl) subEl.innerHTML = '<option value="">—</option>';
        if (periodEl) periodEl.innerHTML = '<option value="">—</option>';
        if (typeof SearchableDropdown !== 'undefined') {
          SearchableDropdown.sync('attcls');
          SearchableDropdown.sync('attsub');
        }
        return;
      }

      if (enfText) {
        enfText.textContent = 'Timetable Enforced — Selectable classes, subjects, and periods are locked to your schedule.';
      }

      var classMap = new Map();
      validSlots.forEach(function(s) {
        var cTrack = s.classTrackId || toClassTrackId(s.classId) || s.className || String(s.classId);
        if (!classMap.has(cTrack)) {
          var isSub = (s.role === 'substitute');
          classMap.set(cTrack, {
            id: cTrack,
            rawId: String(s.classId),
            name: s.className ? (s.className + (isSub ? ' [Sub]' : '')) : 'Class',
            isSub: isSub
          });
        }
      });

      var classList = Array.from(classMap.values());
      if (classEl) {
        classEl.innerHTML = '<option value="">— Select Scheduled Class —</option>' +
          classList.map(function(c) {
            return '<option value="' + escapeHtml(c.id) + '"' + (c.isSub ? ' data-sub="1"' : '') + '>' + escapeHtml(c.name) + '</option>';
          }).join('');
      }

      initAttendanceSearchableDropdowns();

      // Smart Auto-Selection
      var targetSlot = null;
      if (preferredClassId) {
        targetSlot = validSlots.find(function(s) {
          var matchCls = String(s.classId) === String(preferredClassId) ||
                         (s.classTrackId && String(s.classTrackId) === String(preferredClassId)) ||
                         (s.className && String(s.className).toLowerCase() === String(preferredClassId).toLowerCase());
          var sPNums = Array.isArray(s.periods) && s.periods.length ? s.periods : (s.periodNumbers && s.periodNumbers.length ? s.periodNumbers : [s.periodNumber]);
          var matchP = preferredPeriodNumber ? (sPNums.includes(Number(preferredPeriodNumber)) || s.periodNumber === Number(preferredPeriodNumber)) : true;
          if (preferredPeriodNumbers && Array.isArray(preferredPeriodNumbers) && preferredPeriodNumbers.length) {
            matchP = preferredPeriodNumbers.some(function(pn) { return sPNums.includes(Number(pn)); });
          }
          var matchSub = preferredSubjectId ? (String(s.subjectId) === String(preferredSubjectId)) : true;
          return matchCls && matchP && matchSub;
        }) || validSlots.find(function(s) {
          return String(s.classId) === String(preferredClassId) ||
                 (s.classTrackId && String(s.classTrackId) === String(preferredClassId)) ||
                 (s.className && String(s.className).toLowerCase() === String(preferredClassId).toLowerCase());
        });
      }

      if (!targetSlot && dateVal === todayISO()) {
        var now = new Date();
        var nowMins = now.getHours() * 60 + now.getMinutes();
        var activeSlot = null;
        var upcomingSlot = null;
        var firstPendingSlot = null;

        validSlots.forEach(function(s) {
          if (!s.start || !s.end) return;
          var sP = s.start.split(':');
          var eP = s.end.split(':');
          var sMin = parseInt(sP[0], 10) * 60 + parseInt(sP[1], 10);
          var eMin = parseInt(eP[0], 10) * 60 + parseInt(eP[1], 10);

          if (nowMins >= sMin && nowMins <= eMin) {
            activeSlot = s;
          }
          if (sMin > nowMins && (!upcomingSlot || sMin < upcomingSlot._sMin)) {
            upcomingSlot = Object.assign({}, s, { _sMin: sMin });
          }
          if (!s.attendance?.marked && !firstPendingSlot) {
            firstPendingSlot = s;
          }
        });

        targetSlot = activeSlot || upcomingSlot || firstPendingSlot || validSlots[0];

        if (activeSlot && activePill) {
          var actPNums = Array.isArray(activeSlot.periods) && activeSlot.periods.length ? activeSlot.periods : [activeSlot.periodNumber];
          var actPLabel = actPNums.length > 1 ? ('P' + actPNums[0] + '–P' + actPNums[actPNums.length - 1]) : ('P' + activeSlot.periodNumber);
          activePill.textContent = '⚡ Active: ' + actPLabel;
          activePill.style.display = 'inline-block';
        }
      } else if (!targetSlot) {
        targetSlot = validSlots[0];
      }

      if (targetSlot) {
        if (classEl) classEl.value = String(targetSlot.classId);
        if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('attcls');
        populateStrictSubjectsAndPeriods(targetSlot.classId, targetSlot.periodNumber, targetSlot.subjectId, validSlots, targetSlot.periods || preferredPeriodNumbers);
      }
    });
  }
  window.initAttendancePageStrict = initAttendancePageStrict;

  
  // Auto-Lock Countdown Live Ticker (§8.1)
  function startAttendanceLockTicker(lockMs, lockHours) {
    if (window._attLockCountdownTimer) {
      clearInterval(window._attLockCountdownTimer);
      window._attLockCountdownTimer = null;
    }
    if (!lockMs) return;

    function tick() {
      var lockEl = document.getElementById('att-lock-countdown');
      if (!lockEl) return;
      var now = Date.now();
      if (now >= lockMs) {
        if (window._attLockCountdownTimer) {
          clearInterval(window._attLockCountdownTimer);
          window._attLockCountdownTimer = null;
        }
        window._attendanceSheetReadOnly = true;
        lockEl.className = '';
        lockEl.style.display = 'inline-block';
        lockEl.style.background = '#fee2e2';
        lockEl.style.color = '#991b1b';
        lockEl.style.borderColor = '#fca5a5';
        lockEl.textContent = 'Permanently Locked (Auto-Lock Expired)';

        var card = document.getElementById('att-saved-status-card');
        if (card) {
          card.style.background = '#fef2f2';
          card.style.border = '1.5px solid #fca5a5';
        }
        var title = document.getElementById('att-saved-title');
        if (title) {
          title.style.color = '#991b1b';
          title.textContent = 'Attendance Locked (Auto-Lock Expired)';
        }
        var desc = document.getElementById('att-saved-desc');
        if (desc) {
          desc.style.color = '#b91c1c';
          desc.textContent = 'This record exceeds the ' + (lockHours || 24) + '-hour editing window and is permanently locked.';
        }
        var badge = document.getElementById('att-saved-badge');
        if (badge) {
          badge.style.background = '#fee2e2';
          badge.style.color = '#991b1b';
          badge.style.border = '1px solid #fca5a5';
          badge.textContent = 'AUTO-LOCKED';
        }
        var saveBtn = document.getElementById('btn-save-attendance');
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.innerHTML = '<re-icon icon="lock" size="16"></re-icon> Auto-Lock Expired';
        }
        document.querySelectorAll('#atttbody .abp, #atttbody .aba').forEach(function(btn) {
          btn.disabled = true;
          btn.setAttribute('aria-disabled', 'true');
        });
        document.querySelectorAll('#attsheet button[onclick^="markAll"]').forEach(function(b) {
          b.disabled = true;
          b.style.opacity = '0.5';
        });
        var tIn = document.getElementById('att-topic');
        var nIn = document.getElementById('att-notes');
        if (tIn) tIn.disabled = true;
        if (nIn) nIn.disabled = true;
        return;
      }

      var diffMin = Math.max(0, Math.round((lockMs - now) / 60000));
      var h = Math.floor(diffMin / 60);
      var m = diffMin % 60;
      var text = (diffMin < 1) ? 'Auto-locks in < 1m' : ('Auto-locks in ' + (h > 0 ? h + 'h ' : '') + m + 'm');
      lockEl.className = 'is-live';
      lockEl.style.display = 'inline-block';
      lockEl.style.background = '#fef3c7';
      lockEl.style.color = '#92400e';
      lockEl.style.borderColor = '#fde68a';
      lockEl.textContent = text;
    }

    tick();
    window._attLockCountdownTimer = setInterval(tick, 30000);
  }
  window.startAttendanceLockTicker = startAttendanceLockTicker;

  function applyAttendancePolicies() {
    var pol = window._portalPolicy || {};
    var dateEl = document.getElementById('attdate');
    if (dateEl) {
      var today = todayISO();
      dateEl.max = today;
      var maxBack = (pol.backdateDays !== undefined) ? Number(pol.backdateDays) : 3;
      var minDate = new Date();
      minDate.setDate(minDate.getDate() - maxBack);
      var minISO = formatDateISO(minDate);
      dateEl.min = minISO;

      var hintEl = document.getElementById('att-date-policy-hint');
      if (hintEl) {
        hintEl.textContent = (maxBack === 0)
          ? 'Institutional Policy: Same-day attendance only (historical edits disabled).'
          : 'Institutional Policy: Backdating allowed up to ' + maxBack + ' day(s) (' + minISO + ' to Today).';
        hintEl.style.display = 'block';
      }
    }

    var policyBanner = document.getElementById('att-policy-banner');
    var policyBannerText = document.getElementById('att-policy-banner-text');

    if (pol.canMark === false) {
      if (policyBanner) {
        policyBanner.className = 'att-policy-banner-animated';
        policyBanner.style.display = 'flex';
        policyBanner.style.background = '#fef2f2';
        policyBanner.style.border = '1px solid #fecaca';
        policyBanner.style.color = '#991b1b';
        if (policyBannerText) {
          policyBannerText.innerHTML = '<strong>Attendance Marking Locked:</strong> Attendance recording has been locked by administrator policy.';
        }
      }
      var loadBtn = document.getElementById('btn-load-students') || document.querySelector('button[onclick*="loadAttendanceSheet"]');
      if (loadBtn) {
        loadBtn.disabled = true;
        loadBtn.title = 'Attendance marking locked by administrator';
      }
      var qpBtn = document.getElementById('card-quick-pass');
      var slBtn = document.getElementById('card-scan-live');
      var repBtn = document.getElementById('card-rep-share');
      if (qpBtn) { qpBtn.disabled = true; qpBtn.classList.add('is-disabled'); qpBtn.setAttribute('aria-disabled', 'true'); }
      if (slBtn) { slBtn.disabled = true; slBtn.classList.add('is-disabled'); slBtn.setAttribute('aria-disabled', 'true'); }
      if (repBtn) { repBtn.disabled = true; repBtn.classList.add('is-disabled'); repBtn.setAttribute('aria-disabled', 'true'); }
      var rQp = document.getElementById('reason-quick-pass');
      var rSl = document.getElementById('reason-scan-live');
      var rRep = document.getElementById('reason-rep-share');
      if (rQp) { rQp.style.display = 'inline-flex'; rQp.textContent = 'Switched off: Marking locked'; }
      if (rSl) { rSl.style.display = 'inline-flex'; rSl.textContent = 'Switched off: Marking locked'; }
      if (rRep) { rRep.style.display = 'inline-flex'; rRep.textContent = 'Switched off: Marking locked'; }

      var saveBtn = document.getElementById('btn-save-attendance');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.title = 'Attendance marking locked';
      }
    } else {
      if (policyBanner) policyBanner.style.display = 'none';
      var loadBtn = document.getElementById('btn-load-students') || document.querySelector('button[onclick*="loadAttendanceSheet"]');
      if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.title = '';
      }
    }
  }
  window.applyAttendancePolicies = applyAttendancePolicies;

  function initAttendancePage() {
    var urlParams = new URLSearchParams(window.location.search);
    var targetSessionId = urlParams.get('sessionId');
    var targetClassId = urlParams.get('classId');
    var targetPeriod = urlParams.get('period') || urlParams.get('periodNumber');
    var targetDate = urlParams.get('date');

    // If incoming classId is a legacy schema ObjectId, immediately resolve and rewrite URL to trackId
    var resolvedClassTrackId = targetClassId ? toClassTrackId(targetClassId) : '';
    if (targetClassId && resolvedClassTrackId && targetClassId !== resolvedClassTrackId && window.history && window.history.replaceState) {
      var curUrl = new URL(window.location);
      curUrl.searchParams.set('classId', resolvedClassTrackId);
      window.history.replaceState(null, '', curUrl);
      targetClassId = resolvedClassTrackId;
    }

    if (targetSessionId) {
      window._activeSessionId = targetSessionId;
    }
    var dateEl = document.getElementById('attdate');
    if (targetDate && dateEl) {
      dateEl.value = targetDate;
    } else if (dateEl && !dateEl.value) {
      dateEl.value = todayISO();
    }

    var attSheet = document.getElementById('attsheet');
    if (attSheet) attSheet.style.display = 'none';

    applyAttendancePolicies();

    if (isForceTimetableSlots()) {
      initAttendancePageStrict(targetClassId, targetPeriod);
    } else {
      initAttendancePageStandard();
      if (targetClassId || targetPeriod) {
        setTimeout(function() {
          var clsEl = document.getElementById('attcls');
          if (clsEl && targetClassId) {
            clsEl.value = targetClassId;
            if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('attcls');
            if (typeof attLoadSubs === 'function') attLoadSubs();
          }
          var pEl = document.getElementById('attperiod');
          if (pEl && targetPeriod) {
            pEl.value = targetPeriod;
            if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('attperiod');
          }
        }, 200);
      }
    }
  }
  var initAttPage = initAttendancePage;
  window.initAttendancePage = initAttendancePage;

  function loadSubjectsForClass() {
    var inputs = (typeof getSelectedAttendanceInputs === 'function') ? getSelectedAttendanceInputs() : {};
    var classId = inputs.classId || (document.getElementById('attcls') ? document.getElementById('attcls').value : '');
    if (isForceTimetableSlots()) {
      populateStrictSubjectsAndPeriods(classId);
      return;
    }

    var subEl = document.getElementById('attsub');
    var currentSub = subEl ? subEl.value : '';

    // If teacher has an assigned subject for this class and no subject is currently selected, pre-select it
    if (!currentSub && classId) {
      var assigned = getMyAssignments().find(function(a) { return String(a.classId) === String(classId); });
      if (assigned && assigned.subjectId) {
        currentSub = String(assigned.subjectId);
      }
    }

    if (subEl) {
      subEl.innerHTML = buildAttendanceSubjectOptions(currentSub, classId);
      if (currentSub && subEl.querySelector('option[value="' + currentSub + '"]')) {
        subEl.value = currentSub;
      }
    }

    if (typeof SearchableDropdown !== 'undefined') {
      SearchableDropdown.sync('attsub');
    }
    checkTimetableMatch();
    updateAttendanceUrlParams();
  }
  var attLoadSubs = loadSubjectsForClass;
  window.attLoadSubs = loadSubjectsForClass;
  window.loadSubjectsForClass = loadSubjectsForClass;

  function handleAttendanceDateChange() {
    var dateEl = document.getElementById('attdate');
    if (dateEl && dateEl.value) {
      if (dateEl.max && dateEl.value > dateEl.max) {
        showToast('Cannot mark attendance for future dates.', 'warn');
        dateEl.value = dateEl.max;
      } else if (dateEl.min && dateEl.value < dateEl.min) {
        var maxBack = (window._portalPolicy && window._portalPolicy.backdateDays !== undefined) ? Number(window._portalPolicy.backdateDays) : 3;
        showToast('Date exceeds maximum backdate allowance (' + maxBack + ' days).', 'error');
        dateEl.value = dateEl.min;
      }
    }
    if (isForceTimetableSlots()) {
      initAttendancePageStrict();
    } else {
      checkTimetableMatch();
    }
    updateAttendanceUrlParams();
  }
  window.handleAttendanceDateChange = handleAttendanceDateChange;

  function handleAttendancePeriodChange() {
    if (isForceTimetableSlots()) {
      var clsId = document.getElementById('attcls') ? document.getElementById('attcls').value : '';
      var pNum = document.getElementById('attperiod') ? parseInt(document.getElementById('attperiod').value, 10) : 0;
      var dateVal = document.getElementById('attdate') ? document.getElementById('attdate').value : todayISO();
      var cached = DB.get('schedule-days') || {};
      var dayData = cached[dateVal];
      if (dayData && Array.isArray(dayData.slots) && clsId && pNum) {
        var match = dayData.slots.find(function(s) {
          return String(s.classId) === String(clsId) &&
            (s.periodNumber === pNum || (Array.isArray(s.periods) && s.periods.includes(pNum)));
        });
        if (match && (match.subjectId || match.subject)) {
          var subEl = document.getElementById('attsub');
          if (subEl) {
            var targetVal = String(match.subjectId || match.subject);
            var opt = Array.from(subEl.options).find(function(o) {
              return o.value === targetVal || o.text === targetVal || (match.subject && o.text.includes(match.subject));
            });
            if (opt) {
              subEl.value = opt.value;
              if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('attsub');
            } else if (match.subjectId) {
              subEl.value = String(match.subjectId);
              if (typeof SearchableDropdown !== 'undefined') SearchableDropdown.sync('attsub');
            }
          }
        }
      }
    } else {
      checkTimetableMatch();
    }
    updateAttendanceUrlParams();
  }
  window.handleAttendancePeriodChange = handleAttendancePeriodChange;

  function getSelectedAttendanceInputs() {
    var clsEl = document.getElementById('attcls');
    var subEl = document.getElementById('attsub');
    var dateEl = document.getElementById('attdate');
    var periodEl = document.getElementById('attperiod');

    var classId = clsEl ? (clsEl.value || '') : '';
    if (!classId && clsEl && clsEl.options && clsEl.selectedIndex >= 0) {
      var cOpt = clsEl.options[clsEl.selectedIndex];
      if (cOpt.value) classId = cOpt.value;
    }
    if (!classId && typeof SearchableDropdown !== 'undefined') {
      var cInst = SearchableDropdown.get('attcls');
      if (cInst && cInst.triggerBtn) {
        var cText = cInst.triggerBtn.querySelector('.tt-dropdown-trigger-text');
        var cVal = cText ? cText.textContent.trim() : '';
        if (cVal && !cVal.startsWith('—') && !cVal.toLowerCase().includes('select')) {
          classId = cVal;
        }
      }
    }

    var subjectId = subEl ? (subEl.value || '') : '';
    if (!subjectId && subEl && subEl.options && subEl.selectedIndex >= 0) {
      var sOpt = subEl.options[subEl.selectedIndex];
      if (sOpt.value) {
        subjectId = sOpt.value;
      } else if (sOpt.text && !sOpt.text.startsWith('—') && !sOpt.text.toLowerCase().includes('select')) {
        subjectId = sOpt.text;
      }
    }
    if (!subjectId && typeof SearchableDropdown !== 'undefined') {
      var sInst = SearchableDropdown.get('attsub');
      if (sInst && sInst.triggerBtn) {
        var sText = sInst.triggerBtn.querySelector('.tt-dropdown-trigger-text');
        var sVal = sText ? sText.textContent.trim() : '';
        if (sVal && !sVal.startsWith('—') && !sVal.toLowerCase().includes('select')) {
          subjectId = sVal;
        }
      }
    }

    // Try resolving classId if it is a class name
    if (classId && !/^[a-f\d]{24}$/i.test(classId) && typeof DB !== 'undefined' && DB.get) {
      var allClasses = DB.get('all-classes') || DB.get('classes') || [];
      var cLower = String(classId).trim().toLowerCase();
      var foundCls = allClasses.find(function(c) {
        var idStr = String(c._id || c.classTrackId || c.id || '').toLowerCase();
        if (idStr === cLower) return true;
        var cn = (c.className || c.name || '').trim().toLowerCase();
        return cn && (cn === cLower || cLower.includes(cn));
      });
      if (foundCls) {
        classId = String(foundCls._id || foundCls.classTrackId || foundCls.id);
      }
    }

    // Try resolving subjectId if it is a subject name/code
    if (subjectId && !/^[a-f\d]{24}$/i.test(subjectId) && typeof DB !== 'undefined' && DB.get) {
      var allSubs = DB.get('all-subjects') || DB.get('subjects') || [];
      var sLower = String(subjectId).trim().toLowerCase();
      var foundSub = allSubs.find(function(s) {
        var idStr = String(s._id || s.subjectTrackId || s.id || '').toLowerCase();
        if (idStr === sLower) return true;
        var sc = (s.code || s.subjectCode || '').trim().toLowerCase();
        var sn = (s.name || '').trim().toLowerCase();
        var ss = (s.shortName || '').trim().toLowerCase();
        return (sc && sLower.includes(sc)) || (sn && (sLower === sn || sLower.includes(sn))) || (ss && (sLower === ss || sLower.endsWith(' ' + ss)));
      });
      if (foundSub) {
        subjectId = String(foundSub._id || foundSub.subjectTrackId || foundSub.id);
      }
    }

    // Synchronize select values if resolved
    if (clsEl && classId && clsEl.value !== classId) {
      var matchOpt = Array.from(clsEl.options || []).find(function(o) { return o.value === classId; });
      if (matchOpt) clsEl.value = classId;
    }
    if (subEl && subjectId && subEl.value !== subjectId) {
      var matchSubOpt = Array.from(subEl.options || []).find(function(o) { return o.value === subjectId; });
      if (matchSubOpt) subEl.value = subjectId;
    }

    var date = dateEl ? dateEl.value : '';
    var period = periodEl ? periodEl.value : '1';

    // Extract periodNumbers for multi-period slots
    var periodNumbers = [Number(period) || 1];
    if (periodEl && periodEl.selectedIndex >= 0) {
      var selectedOpt = periodEl.options[periodEl.selectedIndex];
      if (selectedOpt && selectedOpt.getAttribute('data-periods')) {
        var rawPeriods = selectedOpt.getAttribute('data-periods').split(',').map(Number).filter(function(n) { return !isNaN(n) && n > 0; });
        if (rawPeriods.length > 0) {
          periodNumbers = rawPeriods;
        }
      }
    }

    // Fallback: lookup in dayData if not in data-periods attribute
    if (periodNumbers.length === 1 && date && classId) {
      var cached = (typeof DB !== 'undefined' && DB.get) ? (DB.get('schedule-days') || {}) : {};
      var dayData = cached[date];
      if (dayData && Array.isArray(dayData.slots)) {
        var pNumVal = Number(period) || 1;
        var foundSlot = dayData.slots.find(function(s) {
          var matchCls = String(s.classId) === String(classId);
          var matchP = (s.periodNumber === pNumVal || (Array.isArray(s.periods) && s.periods.includes(pNumVal)));
          return matchCls && matchP;
        });
        if (foundSlot && Array.isArray(foundSlot.periods) && foundSlot.periods.length > 1) {
          periodNumbers = foundSlot.periods.map(Number);
        }
      }
    }

    return { classId: classId, subjectId: subjectId, date: date, period: period, periodNumbers: periodNumbers };
  }
  window.getSelectedAttendanceInputs = getSelectedAttendanceInputs;

  function updateAttendanceSavedStatusCard(isSaved, existingCount, policyInfo) {
    var card = document.getElementById('att-saved-status-card');
    var icon = document.getElementById('att-saved-icon');
    var title = document.getElementById('att-saved-title');
    var desc = document.getElementById('att-saved-desc');
    var badge = document.getElementById('att-saved-badge');
    var lockCountdown = document.getElementById('att-lock-countdown');
    if (!card) return;

    policyInfo = policyInfo || {};
    var editLocked = policyInfo.editLocked;
    var autoLocked = policyInfo.autoLocked;
    var countdownText = policyInfo.countdownText;

    if (isSaved) {
      if (editLocked || autoLocked) {
        card.style.background = '#fef2f2';
        card.style.border = '1.5px solid #fca5a5';
        if (icon) icon.innerHTML = '<span class="status-dot red"></span>';
        if (title) {
          title.style.color = '#991b1b';
          title.textContent = autoLocked ? 'Attendance Locked (Auto-Lock Expired)' : 'Attendance Locked (Editing Disallowed)';
        }
        if (desc) {
          desc.style.color = '#b91c1c';
          desc.textContent = autoLocked
            ? 'This record exceeds the ' + (policyInfo.lockHours || 24) + '-hour editing window and is permanently locked.'
            : 'Official record found in MongoDB. Reopening or modifying submitted records is disabled by institution policy.';
        }
        if (badge) {
          badge.style.background = '#fee2e2';
          badge.style.color = '#991b1b';
          badge.style.border = '1px solid #fca5a5';
          badge.textContent = autoLocked ? 'AUTO-LOCKED' : 'EDIT LOCKED';
        }
      } else {
        card.style.background = '#f0fdf4';
        card.style.border = '1.5px solid #86efac';
        if (icon) icon.innerHTML = '<span class="status-dot green"></span>';
        if (title) {
          title.style.color = '#166534';
          title.textContent = 'Attendance Saved in Database';
        }
        if (desc) {
          desc.style.color = '#15803d';
          desc.textContent = 'Official record found in MongoDB (' + (existingCount || 'existing') + ' student records). Any updates will overwrite this record on save.';
        }
        if (badge) {
          badge.style.background = '#dcfce7';
          badge.style.color = '#166534';
          badge.style.border = '1px solid #86efac';
          badge.textContent = 'SAVED IN DB';
        }
      }

      if (lockCountdown) {
        if (autoLocked) {
          lockCountdown.style.display = 'inline-block';
          lockCountdown.style.background = '#fee2e2';
          lockCountdown.style.color = '#991b1b';
          lockCountdown.style.borderColor = '#fca5a5';
          lockCountdown.textContent = 'Permanently Locked';
        } else if (countdownText) {
          lockCountdown.style.display = 'inline-block';
          lockCountdown.style.background = '#fef3c7';
          lockCountdown.style.color = '#92400e';
          lockCountdown.style.borderColor = '#fde68a';
          lockCountdown.textContent = countdownText;
        } else {
          lockCountdown.style.display = 'none';
        }
      }
    } else {
      card.style.background = '#fffbeb';
      card.style.border = '1.5px solid #fde68a';
      if (icon) icon.innerHTML = '<re-icon icon="alert-triangle"></re-icon>';
      if (title) {
        title.style.color = '#92400e';
        title.textContent = 'Attendance Not Saved in Database';
      }
      if (desc) {
        desc.style.color = '#b45309';
        desc.textContent = 'This is an unsaved fresh roster.';
      }
      if (badge) {
        badge.style.background = '#fef3c7';
        badge.style.color = '#b45309';
        badge.style.border = '1px solid #fde68a';
        badge.textContent = 'NOT SAVED';
      }
      if (lockCountdown) {
        lockCountdown.style.display = 'none';
      }
    }

    // Sync sticky dock badge & sticky save bar (C3)
    var dockSavedChip = document.getElementById('dock-saved-chip');
    var dockSavedText = document.getElementById('dock-saved-text');
    var savebarTitle = document.getElementById('savebar-status-title');
    var savebarSub = document.getElementById('savebar-status-sub');
    var savebarDot = document.getElementById('savebar-dot');

    if (isSaved) {
      if (dockSavedChip) {
        dockSavedChip.style.background = (editLocked || autoLocked) ? '#fee2e2' : '#dcfce7';
        dockSavedChip.style.color = (editLocked || autoLocked) ? '#991b1b' : '#166534';
        dockSavedChip.style.borderColor = (editLocked || autoLocked) ? '#fca5a5' : '#86efac';
      }
      if (dockSavedText) dockSavedText.textContent = autoLocked ? 'AUTO-LOCKED' : (editLocked ? 'EDIT LOCKED' : 'SAVED IN DB');
      if (savebarTitle) savebarTitle.textContent = (editLocked || autoLocked) ? 'Record Locked' : 'Attendance Saved in Database';
      if (savebarSub) savebarSub.textContent = (editLocked || autoLocked) ? 'Editing restricted by policy' : ('Official record in MongoDB (' + (existingCount || '') + ' students)');
      if (savebarDot) savebarDot.style.background = (editLocked || autoLocked) ? '#ef4444' : '#10b981';
    } else {
      if (dockSavedChip) {
        dockSavedChip.style.background = '#fef3c7';
        dockSavedChip.style.color = '#b45309';
        dockSavedChip.style.borderColor = '#fde68a';
      }
      if (dockSavedText) dockSavedText.textContent = 'NOT SAVED';
      if (savebarTitle) savebarTitle.textContent = 'Unsaved Fresh Roster';
      if (savebarSub) savebarSub.textContent = 'Click Save Attendance to persist to MongoDB';
      if (savebarDot) savebarDot.style.background = '#f59e0b';
    }
  }
  window.updateAttendanceSavedStatusCard = updateAttendanceSavedStatusCard;

  function markUnsavedAttendanceState() {
    var dockSavedChip = document.getElementById('dock-saved-chip');
    var dockSavedText = document.getElementById('dock-saved-text');
    var savebarTitle = document.getElementById('savebar-status-title');
    var savebarSub = document.getElementById('savebar-status-sub');
    var savebarDot = document.getElementById('savebar-dot');
    if (dockSavedChip) {
      dockSavedChip.style.background = '#fef3c7';
      dockSavedChip.style.color = '#b45309';
      dockSavedChip.style.borderColor = '#fde68a';
    }
    if (dockSavedText) dockSavedText.textContent = 'UNSAVED CHANGES';
    if (savebarTitle) savebarTitle.textContent = 'Unsaved Changes';
    if (savebarSub) savebarSub.textContent = 'You have modified roster markings. Click Save Attendance.';
    if (savebarDot) savebarDot.style.background = '#f59e0b';
  }
  window.markUnsavedAttendanceState = markUnsavedAttendanceState;

  function undoAttendanceChange() {
    if (window._attendanceSheetReadOnly) return;
    if (!window._attUndoStack || !window._attUndoStack.length) return;
    var last = window._attUndoStack.pop();
    if (last.type === 'single') {
      if (attendanceStudents[last.index]) {
        attendanceStudents[last.index].status = last.prevStatus;
        const row = document.getElementById('student-row-' + last.index);
        if (row) {
          row.className = last.prevStatus === 'present' ? 'pr' : (last.prevStatus === 'unmarked' ? 'um' : 'ab');
          row.querySelectorAll('.abp,.aba').forEach(function(btn) { btn.classList.remove('act'); });
          const targetBtn = row.querySelector(last.prevStatus === 'present' ? '.abp' : '.aba');
          if (targetBtn && last.prevStatus !== 'unmarked') targetBtn.classList.add('act');
        }
      }
    } else if (last.type === 'bulk') {
      last.previousStatuses.forEach(function(st, idx) {
        if (attendanceStudents[idx]) attendanceStudents[idx].status = st;
      });
      renderAttendanceSheet();
    }
    updateAttendanceSummary();
    markUnsavedAttendanceState();
    var undoBtn = document.getElementById('btn-att-undo');
    if (undoBtn) undoBtn.disabled = (!window._attUndoStack || !window._attUndoStack.length);
    showToast('Undid last change', 'info');
  }
  window.undoAttendanceChange = undoAttendanceChange;

  function loadAttendanceSheet() {
    var inputs = getSelectedAttendanceInputs();
    var classId   = inputs.classId;
    var subjectId = inputs.subjectId;
    var date      = inputs.date;
    var period    = inputs.period;

    if (!classId || !subjectId || !date) {
      if (typeof dbToast === 'function') dbToast('Select class, subject and date first', 'error');
      else showToast('Select class, subject and date', 'warn');
      return;
    }

    var pol = window._portalPolicy || {};
    if (pol.canMark === false) {
      var errMark = 'Cannot load attendance: Attendance marking is currently locked by administrator policy.';
      if (typeof dbToast === 'function') dbToast(errMark, 'error');
      else showToast(errMark, 'error');
      return;
    }

    if (pol.backdateDays !== undefined) {
      var maxBack = Number(pol.backdateDays);
      var minD = new Date();
      minD.setDate(minD.getDate() - maxBack);
      if (date < formatDateISO(minD)) {
        var errBack = 'Cannot load attendance: Date exceeds maximum backdate allowance of ' + maxBack + ' day(s).';
        if (typeof dbToast === 'function') dbToast(errBack, 'error');
        else showToast(errBack, 'error');
        return;
      }
    }

    // Timetable Match Policy (Section 8.1, B2)
    var matchPolicy = pol.timetableMatch || 'warn';
    if (matchPolicy === 'block') {
      var pNum = parseInt(period, 10) || 1;
      var cached = DB.get('schedule-days') || {};
      var dayData = cached[date];
      var validSlots = (dayData && Array.isArray(dayData.slots)) ? dayData.slots.filter(function(s) { return s.status === 'scheduled'; }) : [];
      var match = validSlots.find(function(s) {
        return String(s.classId) === String(classId) &&
          (s.periodNumber === pNum || (Array.isArray(s.periods) && s.periods.includes(pNum)));
      });
      if (!match) {
        var blockMsg = 'Timetable Match Policy (Block): You are not assigned to teach this class and period in today\'s schedule.';
        if (typeof dbToast === 'function') dbToast(blockMsg, 'error');
        else showToast(blockMsg, 'error');
        return;
      }
    }

    if (typeof dbToast === 'function') {
      dbToast('Fetching students & attendance from database…', 'saving');
    } else {
      showToast("Loading…", 'saving');
    }

    if (typeof isForceTimetableSlots === 'function' && isForceTimetableSlots()) {
      var pNum = parseInt(period, 10) || 1;
      var cached = DB.get('schedule-days') || {};
      var dayData = cached[date];
      var validSlots = (dayData && Array.isArray(dayData.slots)) ? dayData.slots.filter(function(s) { return s.status === 'scheduled'; }) : [];
      var match = validSlots.find(function(s) {
        return String(s.classId) === String(classId) &&
          (s.periodNumber === pNum || (Array.isArray(s.periods) && s.periods.includes(pNum)));
      });
      if (!match) {
        var strictMsg = 'Strict Mode: Attendance can only be loaded for scheduled timetable slots or approved substitutions.';
        if (typeof dbToast === 'function') dbToast(strictMsg, 'error');
        else showToast(strictMsg, 'error');
        return;
      }
    }

    var assignment = getMyAssignments().find(function(a) {
      return String(a.classId) === String(classId) && String(a.subjectId) === String(subjectId);
    });
    if (!assignment) {
      var clsEl = document.getElementById('attcls');
      var subEl = document.getElementById('attsub');
      assignment = {
        classId: classId,
        className: (clsEl && clsEl.options[clsEl.selectedIndex]) ? clsEl.options[clsEl.selectedIndex].text : 'Class',
        subjectId: subjectId,
        subjectName: (subEl && subEl.options[subEl.selectedIndex]) ? subEl.options[subEl.selectedIndex].text : 'Subject'
      };
    }

    var tok = getToken();
    if (!tok) {
      if (typeof dbToast === 'function') dbToast('Not authenticated', 'error');
      else showToast('Not authenticated', 'warn');
      return;
    }

    // Fetch students for the class (from DB render cache or API fallback), existing records for this session,
    // and approved leaves for this date in parallel from the DB server.
    var cachedClassStudents = (DB.get('students') || []).filter(function(s) {
      return String(s.classId) === String(classId) || String(s.class) === String(classId);
    });
    var pStudents = cachedClassStudents.length > 0
      ? Promise.resolve(cachedClassStudents)
      : api('/api/students?classId=' + encodeURIComponent(classId) + '&limit=500', {
          headers: { 'Authorization': 'Bearer ' + tok }
        }).then(function(r) { return r.ok ? r.json() : []; })
          .then(function(d) {
            if (Array.isArray(d)) return d;
            if (d && Array.isArray(d.data)) return d.data;
            if (d && Array.isArray(d.students)) return d.students;
            return [];
          })
          .catch(function() { return []; });

    Promise.all([
      pStudents,

      api('/api/attendance?classId=' + encodeURIComponent(classId)
          + '&date=' + encodeURIComponent(date)
          + '&subjectId=' + encodeURIComponent(subjectId), {
        headers: { 'Authorization': 'Bearer ' + tok }
      }).then(function(r) { return r.ok ? r.json() : []; })
        .then(function(d) {
          if (Array.isArray(d)) return d;
          if (d && Array.isArray(d.data)) return d.data;
          return [];
        })
        .catch(function() { return []; }),

      api('/api/leave/approved-for-date?classId=' + encodeURIComponent(classId)
          + '&date=' + encodeURIComponent(date), {
        headers: { 'Authorization': 'Bearer ' + tok }
      }).then(function(r) { return r.ok ? r.json() : []; })
        .then(function(d) {
          if (Array.isArray(d)) return d;
          if (d && Array.isArray(d.data)) return d.data;
          return [];
        })
        .catch(function() { return []; }),

      // Authoritative Schedule Resolution (Feature 13 - Day Override > Week > Master)
      api('/api/timetable/resolve/' + encodeURIComponent(classId) + '/' + encodeURIComponent(date), {
        headers: { 'Authorization': 'Bearer ' + tok }
      }).then(function(r) { return r.ok ? r.json() : null; })
        .catch(function() { return null; })
    ]).then(async function(results) {
      var initialStudents = results[0] || [];
      // /api/timetable/resolve responds { ok, data: DayInstance } — the
      // holiday/cancelled checks used to read the wrapper and never fired.
      var resolvedSchedule = results[3] ? (results[3].data || results[3]) : null;

      if (resolvedSchedule && resolvedSchedule.isHoliday) {
        if (typeof dbToast === 'function') {
          dbToast('Institutional Holiday: ' + (resolvedSchedule.holidayReason || 'Holiday'), 'warn');
        }
      }

      // Check if slot has combined classes (Feature 4 - Combined classes attendance)
      var activeSlot = null;
      if (resolvedSchedule && resolvedSchedule.slots) {
        activeSlot = Object.values(resolvedSchedule.slots).find(function(s) {
          var sp = s.periodNumber != null ? s.periodNumber : s.period;
          var span = Number(s.span) || 1;
          return Number(period) >= Number(sp) && Number(period) < Number(sp) + span;
        });
        if (activeSlot && activeSlot.isCancelled) {
          if (typeof dbToast === 'function') {
            dbToast('Period ' + period + ' is marked Cancelled: ' + (activeSlot.cancelReason || activeSlot.note || 'Cancelled'), 'warn');
          }
        }
      }

      if (activeSlot && (activeSlot.isCombined || (activeSlot.combinedClassIds && activeSlot.combinedClassIds.length > 0))) {
        var extraClassIds = (activeSlot.combinedClassIds || []).filter(function(id) {
          return String(id) !== String(classId);
        });
        for (var i = 0; i < extraClassIds.length; i++) {
          var targetClassId = extraClassIds[i];
          var cachedExtra = (DB.get('students') || []).filter(function(s) {
            return String(s.classId) === String(targetClassId) || String(s.class) === String(targetClassId);
          });
          if (cachedExtra.length > 0) {
            initialStudents = initialStudents.concat(cachedExtra);
          } else {
            try {
              var cRes = await api('/api/students?classId=' + encodeURIComponent(targetClassId) + '&limit=500', {
                headers: { 'Authorization': 'Bearer ' + tok }
              });
              if (cRes.ok) {
                var cData = await cRes.json();
                var extraList = Array.isArray(cData) ? cData : (cData?.data || cData?.students || []);
                initialStudents = initialStudents.concat(extraList);
              }
            } catch (e) {}
          }
        }
        if (typeof dbToast === 'function') {
          dbToast('<re-icon icon="users"></re-icon> Combined Session: Loaded students from all combined sections', 'info');
        }
      }

      var classStudents  = initialStudents.slice().sort(function(a, b) {
        return String(a.regNo || a.registerNo || '').localeCompare(String(b.regNo || b.registerNo || ''), undefined, { numeric: true });
      });
      var sessionRecords = (results[1] || []).filter(function(a) {
        var subMatch = String(a.subjectId) === String(subjectId) ||
                       (a.subjectTrackId && String(a.subjectTrackId) === String(subjectId));
        var periodMatch = !period || String(a.periodNumber) === String(period) ||
                          (Array.isArray(a.periodNumbers) && a.periodNumbers.map(String).includes(String(period)));
        return subMatch && periodMatch;
      });
      var approvedLeaves = results[2] || [];
      var periodNum = Number(period) || 1;

      if (!classStudents.length) {
        if (typeof dbToast === 'function') dbToast('No students found in this class', 'error');
        else showToast('No students found in this class', 'warn');
        return;
      }

      // Also update local student cache so other functions (student list, reports)
      // pick up fresh data without an extra round-trip.
      (function mergeIntoCache() {
        var existing = DB.get('students') || [];
        var seen = Object.create(null);
        existing.forEach(function(s) { seen[String(s._id)] = true; });
        var merged = existing.concat(classStudents.filter(function(s) { return !seen[String(s._id)]; }));
        DB.set('students', merged);
      })();

      attendanceStudents = classStudents.map(function(student) {
        var rec = sessionRecords.find(function(a) {
          return String(a.studentId) === String(student._id) ||
                 (student.trackId && a.studentTrackId === student.trackId);
        });

        var matchingLeave = approvedLeaves.find(function(l) {
          var matchId = String(l.studentId) === String(student._id) ||
                        (student.trackId && l.studentTrackId === student.trackId) ||
                        (student.regNo && l.studentRegNo === student.regNo);
          if (!matchId) return false;
          if (l.category === 'Leave' || !l.slot || l.slot === 'Full Day') return true;
          if (l.slot === 'FN' && periodNum <= 4) return true;
          if (l.slot === 'AN' && periodNum >= 5) return true;
          if (Array.isArray(l.periods) && l.periods.includes(periodNum)) return true;
          return false;
        });

        // Priority §8.1: Teacher's personal preference wins over the institutional setting, falling back to 'present'
        var userPref = (currentUser && currentUser.preferences && currentUser.preferences.defaultAttendanceStatus)
          ? currentUser.preferences.defaultAttendanceStatus.trim().toLowerCase()
          : null;
        var globalDefault = (pol && pol.defaultStatus)
          ? pol.defaultStatus.trim().toLowerCase()
          : ((window._pubSettings && window._pubSettings.attendance && window._pubSettings.attendance.defaultStatus)
            ? window._pubSettings.attendance.defaultStatus.trim().toLowerCase()
            : null);
        var effectiveDefault = userPref || globalDefault || 'present';
        var initialStatus = effectiveDefault === 'unmarked' ? 'unmarked' : (effectiveDefault === 'absent' ? 'absent' : 'present');
        if (matchingLeave) {
          initialStatus = 'absent';
        }
        if (rec) {
          initialStatus = rec.status;
        }
        var leaveLabel = '';
        if (matchingLeave) {
          if (matchingLeave.leaveType === 'Self-Declared Absence') {
            var periodList = (Array.isArray(matchingLeave.periods) && matchingLeave.periods.length)
              ? (' (P' + matchingLeave.periods.join(', P') + ')')
              : '';
            leaveLabel = 'Self-Marked Absent' + periodList;
          } else {
            leaveLabel = 'On Leave' + (matchingLeave.slot && matchingLeave.slot !== 'Full Day' ? ' (' + matchingLeave.slot + ')' : '');
          }
        }
        return Object.assign({}, student, {
          status:     initialStatus,
          existingId: rec ? rec._id : null,
          onLeave:    !!matchingLeave,
          leaveText:  leaveLabel,
          leaveBadge: leaveLabel
        });
      });

      var isSavedInDb = sessionRecords.length > 0;
      var pol = window._portalPolicy || {};
      var editAllowed = (pol.editAllowed !== undefined) ? pol.editAllowed : true;
      var lockHours = (pol.lockHours !== undefined) ? Number(pol.lockHours) : 24;
      var isAutoLocked = false;
      var countdownText = '';

      var lockMs = null;
      if (isSavedInDb && lockHours > 0 && sessionRecords[0]) {
        var recTime = sessionRecords[0].updatedAt || sessionRecords[0].createdAt || sessionRecords[0].markedAt;
        if (recTime) {
          var recMs = new Date(recTime).getTime();
          lockMs = recMs + (lockHours * 3600 * 1000);
          var nowMs = Date.now();
          if (nowMs >= lockMs) {
            isAutoLocked = true;
          } else {
            var diffMin = Math.max(0, Math.round((lockMs - nowMs) / 60000));
            var h = Math.floor(diffMin / 60);
            var m = diffMin % 60;
            countdownText = 'Auto-locks in ' + (h > 0 ? h + 'h ' : '') + m + 'm';
          }
        }
      }

      if (isSavedInDb && lockHours > 0 && lockMs && !isAutoLocked) {
        startAttendanceLockTicker(lockMs, lockHours);
      } else if (window._attLockCountdownTimer) {
        clearInterval(window._attLockCountdownTimer);
        window._attLockCountdownTimer = null;
      }

      var isReadOnly = (isSavedInDb && (!editAllowed || isAutoLocked)) || (pol.canMark === false);
      window._attendanceSheetReadOnly = isReadOnly;

      updateAttendanceUrlParams();
      updateAttendanceSavedStatusCard(isSavedInDb, sessionRecords.length, {
        editLocked: isSavedInDb && !editAllowed,
        autoLocked: isAutoLocked,
        lockHours: lockHours,
        countdownText: countdownText
      });

      var saveBtn = document.getElementById('btn-save-attendance');
      if (saveBtn) {
        if (isReadOnly) {
          saveBtn.disabled = true;
          var lockReason = (pol.canMark === false) ? 'Marking Locked' : (isAutoLocked ? 'Auto-Lock Expired' : 'Editing Locked');
          saveBtn.innerHTML = '<re-icon icon="lock" size="16"></re-icon> ' + lockReason;
          saveBtn.title = 'Attendance cannot be modified due to policy restrictions';
        } else {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<re-icon icon="save" size="16"></re-icon> Save Attendance';
          saveBtn.title = '';
        }
      }

      // Hide or show bulk actions if read-only
      var bulkButtons = document.querySelectorAll('#attsheet button[onclick^="markAll"]');
      bulkButtons.forEach(function(b) {
        b.disabled = isReadOnly;
        if (isReadOnly) b.style.opacity = '0.5';
        else b.style.opacity = '1';
      });

      // Hydrate Period Notes and Topic Covered if already saved
      var topicInput = document.getElementById('att-topic');
      var notesInput = document.getElementById('att-notes');
      if (isSavedInDb && sessionRecords[0]) {
        if (topicInput) topicInput.value = sessionRecords[0].topic || sessionRecords[0].remarks || '';
        if (notesInput) notesInput.value = sessionRecords[0].notes || '';
      } else {
        if (topicInput) topicInput.value = '';
        if (notesInput) notesInput.value = '';
      }
      if (topicInput) topicInput.disabled = isReadOnly;
      if (notesInput) notesInput.disabled = isReadOnly;

      document.getElementById('ainfc').textContent = assignment.className || '—';
      document.getElementById('ainfs').textContent = assignment.subjectName || '—';
      document.getElementById('ainfd').textContent = formatDateLong(date);

      // Set Sticky Dock Breadcrumbs (C3)
      var dockCls = document.getElementById('dock-cls-sub');
      if (dockCls) dockCls.textContent = (assignment.className || 'Class') + ' — ' + (assignment.subjectName || 'Subject');
      var dockPeriod = document.getElementById('dock-period-date');
      if (dockPeriod) dockPeriod.textContent = 'Period ' + period + ' · ' + formatDateLong(date);
      var ainfp = document.getElementById('ainfp');
      if (ainfp) {
        var pNums = Array.isArray(inputs.periodNumbers) && inputs.periodNumbers.length > 0 ? inputs.periodNumbers : [periodNum];
        if (pNums.length > 1) {
          ainfp.textContent = 'Period ' + pNums[0] + '–' + pNums[pNums.length - 1] + ' (' + pNums.length + ' Combined Periods)';
        } else {
          ainfp.textContent = 'Period ' + period;
        }
      }
      document.getElementById('ainft').textContent = classStudents.length;

      var selZone = document.getElementById('att-selector-zone');
      if (selZone) selZone.style.display = 'none';
      var attSheetEl = document.getElementById('attsheet');
      if (attSheetEl) attSheetEl.style.display = 'block';
      var methodInd = document.getElementById('att-method-indicator');
      if (methodInd && !methodInd.textContent) {
        methodInd.innerHTML = '<re-icon icon="clipboard-list"></re-icon> Manual Entry';
        methodInd.style.display = 'inline-block';
      }
      renderAttendanceSheet();

      if (typeof dbToast === 'function') {
        dbToast(
          'Loaded ' + classStudents.length + ' students from DB',
          'success',
          isSavedInDb ? 'Official record found in DB (' + sessionRecords.length + ' records)' : 'Fresh roster • Not yet saved to DB'
        );
      } else {
        showToast('Loaded ' + classStudents.length + ' students', 'success');
      }
    }).catch(function(err) {
      console.error('Error in loadAttendanceSheet:', err);
      if (typeof dbToast === 'function') dbToast('Error loading attendance from DB', 'error');
      else showToast('Error loading attendance sheet', 'warn');
    });
  }
  var loadAttSheet = loadAttendanceSheet;
  function renderAttendanceSheet() {
    document.getElementById('atttbody').innerHTML = attendanceStudents.map(function(student, index) {
      // 'unmarked' (teacher preference "Neutral / Unmarked") used to render
      // as Absent and was silently saved as AB.
      const isPresent  = student.status === 'present';
      const isAbsent   = !isPresent && student.status !== 'unmarked'; // absent/od/leave <re-icon icon="arrow-right"></re-icon> A
      const rowClass   = isPresent ? 'pr' : (isAbsent ? 'ab' : 'um');
      const leaveText = student.leaveText || (typeof student.leaveBadge === 'string' ? student.leaveBadge.replace(/<[^>]*>/g, '').trim() : '') || 'On Leave';
      const leaveBadgeHtml = student.onLeave
        ? '<span class="att-leave-pill" title="Approved Leave"><re-icon icon="plane" size="11"></re-icon><span>' + escapeHtml(leaveText) + '</span></span>'
        : '';
      return '<tr class="' + rowClass + '" id="student-row-' + index + '">'
        + '<td style="font-weight:700;color:var(--tdi);">' + (index + 1) + '</td>'
        + '<td style="font-weight:600;color:var(--tmu);">' + escapeHtml(student.regNo || student.registerNo || '—') + '</td>'
        + '<td style="font-weight:600;">' + escapeHtml(student.name || student.fullName || '—') + leaveBadgeHtml + '</td>'
        + '<td><div class="attog">'
        + '<button class="abp ' + (isPresent ? 'act' : '') + '"' + (window._attendanceSheetReadOnly ? ' disabled aria-disabled="true"' : '') + ' onclick="setAttendanceStatus(' + index + ',\'present\')">P</button>'
        + '<button class="aba ' + (isAbsent ? 'act' : '') + '"' + (window._attendanceSheetReadOnly ? ' disabled aria-disabled="true"' : '') + ' onclick="setAttendanceStatus(' + index + ',\'absent\')">A</button>'
        + '</div></td>'
        + '</tr>';
    }).join('');
    updateAttendanceSummary();
  }

  function setAttendanceStatus(index, status) {
    if (window._attendanceSheetReadOnly) {
      showToast('Attendance is locked and cannot be edited for this session.', 'warn');
      return;
    }
    var student = attendanceStudents[index];
    if (student && student.onLeave && status === 'present') {
      showToast('Note: ' + (student.name || student.fullName || 'Student') + ' has approved leave (' + (student.leaveText || 'On Leave') + ')', 'warn');
    }

    // Push to undo stack (C3)
    if (!window._attUndoStack) window._attUndoStack = [];
    window._attUndoStack.push({
      type: 'single',
      index: index,
      prevStatus: student.status
    });
    if (window._attUndoStack.length > 50) window._attUndoStack.shift();
    var undoBtn = document.getElementById('btn-att-undo');
    if (undoBtn) undoBtn.disabled = false;

    attendanceStudents[index].status = status;
    const row = document.getElementById('student-row-' + index);
    if (row) {
      row.className = status === 'present' ? 'pr' : (status === 'unmarked' ? 'um' : 'ab');
      row.querySelectorAll('.abp,.aba').forEach(function(btn) { btn.classList.remove('act'); });
      const targetBtn = row.querySelector(status === 'present' ? '.abp' : '.aba');
      if (targetBtn && status !== 'unmarked') targetBtn.classList.add('act');
    }
    updateAttendanceSummary();
    markUnsavedAttendanceState();
  }
  var setS = setAttendanceStatus;

  function markAllStudents(status) {
    if (window._attendanceSheetReadOnly) {
      showToast('Attendance is locked and cannot be edited for this session.', 'warn');
      return;
    }

    // Push to undo stack (C3)
    if (!window._attUndoStack) window._attUndoStack = [];
    window._attUndoStack.push({
      type: 'bulk',
      previousStatuses: attendanceStudents.map(function(s) { return s.status; })
    });
    if (window._attUndoStack.length > 50) window._attUndoStack.shift();
    var undoBtn = document.getElementById('btn-att-undo');
    if (undoBtn) undoBtn.disabled = false;

    var leaveCount = 0;
    attendanceStudents.forEach(function(student, index) {
      if (student.onLeave) {
        attendanceStudents[index].status = 'absent';
        leaveCount++;
      } else {
        attendanceStudents[index].status = status;
      }
    });
    renderAttendanceSheet();
    markUnsavedAttendanceState();
    if (status === 'present' && leaveCount > 0) {
      showToast(leaveCount + (leaveCount === 1 ? ' student on approved leave kept absent' : ' students on approved leave kept absent'), 'info');
    }
  }
  var markAll = markAllStudents;

  function updateAttendanceSummary() {
    const presentCount  = attendanceStudents.filter(function(s) { return s.status === 'present'; }).length;
    const unmarkedCount = attendanceStudents.filter(function(s) { return s.status === 'unmarked'; }).length;
    const absentCount   = attendanceStudents.length - presentCount - unmarkedCount;

    // Sheet card counters
    var st = document.getElementById('stotal'); if (st) st.textContent = attendanceStudents.length;
    var sp = document.getElementById('spres'); if (sp) sp.textContent  = presentCount;
    var sa = document.getElementById('sabs'); if (sa) sa.textContent   = absentCount;
    const totalLbl = document.getElementById('stotal') ? document.getElementById('stotal').nextElementSibling : null;
    if (totalLbl) totalLbl.textContent = unmarkedCount > 0 ? ('Total · ' + unmarkedCount + ' unmarked') : 'Total';

    // Sticky dock live counters (C3)
    var dt = document.getElementById('dock-cnt-total'); if (dt) dt.textContent = attendanceStudents.length;
    var dp = document.getElementById('dock-cnt-pres'); if (dp) dp.textContent = presentCount;
    var da = document.getElementById('dock-cnt-abs'); if (da) da.textContent = absentCount;
    var du = document.getElementById('dock-cnt-unm'); if (du) du.textContent = unmarkedCount;
    var duPill = document.getElementById('dock-pill-unmarked');
    if (duPill) duPill.style.display = unmarkedCount > 0 ? 'inline-flex' : 'none';
  }
  var updSum = updateAttendanceSummary;
  window.setAttendanceStatus = setAttendanceStatus;
  window.setS = setAttendanceStatus;
  window.markAllStudents = markAllStudents;
  window.markAll = markAllStudents;
  window.updateAttendanceSummary = updateAttendanceSummary;
  window.renderAttendanceSheet = renderAttendanceSheet;

  function resetAttendanceView() {
    if (window._attLockCountdownTimer) {
      clearInterval(window._attLockCountdownTimer);
      window._attLockCountdownTimer = null;
    }
    var selZone = document.getElementById('att-selector-zone');
    if (selZone) selZone.style.display = 'block';
    var sheet = document.getElementById('attsheet');
    if (sheet) sheet.style.display = 'none';
    var methodInd = document.getElementById('att-method-indicator');
    if (methodInd) {
      methodInd.style.display = 'none';
      methodInd.textContent = '';
    }
    if (typeof isForceTimetableSlots === 'function' && isForceTimetableSlots()) {
      initAttendancePageStrict();
    } else {
      initAttendancePageStandard();
    }
  }
  window.resetAttendanceView = resetAttendanceView;

  function renderTodayClassesChips() {
    var wrap = document.getElementById('today-classes-chips');
    if (wrap) {
      wrap.style.display = 'none';
      wrap.innerHTML = '';
    }
    return;
  }
  window.renderTodayClassesChips = renderTodayClassesChips;

  function checkTimetableMatch() {
    var warnEl = document.getElementById('att-tt-warn');
    if (!warnEl) return;
    if (typeof isForceTimetableSlots === 'function' && isForceTimetableSlots()) {
      warnEl.style.display = 'none';
      return;
    }
    var pol = window._portalPolicy || {};
    var matchPolicy = pol.timetableMatch || 'warn';
    if (matchPolicy === 'allow') {
      warnEl.style.display = 'none';
      return;
    }
    var clsId = document.getElementById('attcls') ? document.getElementById('attcls').value : '';
    var period = document.getElementById('attperiod') ? document.getElementById('attperiod').value : '';
    var dateVal = document.getElementById('attdate') ? document.getElementById('attdate').value : todayISO();

    if (!clsId) {
      warnEl.style.display = 'none';
      return;
    }

    var dayData = getMyDay(dateVal || todayISO());
    if (!dayData || !Array.isArray(dayData.slots) || !dayData.slots.length) {
      warnEl.style.display = 'none';
      return;
    }

    var pNum = parseInt(period, 10) || 1;
    var matched = dayData.slots.some(function(s) {
      var matchClass = String(s.classId) === String(clsId);
      var matchPeriod = s.periods ? s.periods.includes(pNum) : (s.periodNumber === pNum);
      return matchClass && matchPeriod;
    });

    var warnText = document.getElementById('att-tt-warn-text');
    var dismissBtn = warnEl.querySelector('button');

    if (!matched) {
      warnEl.style.display = 'flex';
      if (matchPolicy === 'block') {
        warnEl.style.background = '#fef2f2';
        warnEl.style.borderColor = '#fca5a5';
        warnEl.style.color = '#991b1b';
        if (warnText) warnText.textContent = 'Timetable Match Policy (Block): Selected class and period are not in your scheduled timetable.';
        if (dismissBtn) dismissBtn.style.display = 'none';
      } else {
        warnEl.style.background = '#fffbeb';
        warnEl.style.borderColor = '#fde68a';
        warnEl.style.color = '#b45309';
        if (warnText) warnText.textContent = 'Not in your timetable today — continue?';
        if (dismissBtn) dismissBtn.style.display = 'inline-block';
      }
    } else {
      warnEl.style.display = 'none';
    }
  }
  window.checkTimetableMatch = checkTimetableMatch;

  window.dismissTtWarn = function() {
    var pol = window._portalPolicy || {};
    if (pol.timetableMatch === 'block') return; // Cannot dismiss in block mode
    var w = document.getElementById('att-tt-warn');
    if (w) w.style.display = 'none';
  };

  function triggerAttendanceMethod(mode) {
    var pol = window._portalPolicy || {};
    if (pol.canMark === false) {
      showToast('Attendance marking is currently locked by administrator policy.', 'warn');
      return;
    }

    var inputs = (typeof getSelectedAttendanceInputs === 'function') ? getSelectedAttendanceInputs() : {};
    var classId = inputs.classId || (document.getElementById('attcls') ? document.getElementById('attcls').value : '');
    var subjectId = inputs.subjectId || (document.getElementById('attsub') ? document.getElementById('attsub').value : '');
    var date = inputs.date || (document.getElementById('attdate') ? document.getElementById('attdate').value : '');
    var period = inputs.period || (document.getElementById('attperiod') ? document.getElementById('attperiod').value : '1');
    if (!classId || !subjectId || !date) {
      if (typeof dbToast === 'function') dbToast('Select class, subject and date first', 'warn');
      else showToast('Select class, subject and date first', 'warn');
      return;
    }

    if (pol.timetableMatch === 'block' || (typeof isForceTimetableSlots === 'function' && isForceTimetableSlots())) {
      var pNum = parseInt(period, 10) || 1;
      var cached = DB.get('schedule-days') || {};
      var dayData = cached[date];
      var validSlots = (dayData && Array.isArray(dayData.slots)) ? dayData.slots.filter(function(s) { return s.status === 'scheduled'; }) : [];
      var match = validSlots.find(function(s) {
        return String(s.classId) === String(classId) &&
          (s.periodNumber === pNum || (Array.isArray(s.periods) && s.periods.includes(pNum)));
      });
      if (!match) {
        var blockMsg = (pol.timetableMatch === 'block')
          ? 'Timetable Match Policy (Block): Attendance can only be marked for scheduled timetable slots.'
          : 'Strict Mode: Attendance can only be marked for scheduled timetable slots or approved substitutions.';
        if (typeof dbToast === 'function') dbToast(blockMsg, 'error');
        else showToast(blockMsg, 'error');
        return;
      }
    }

    if (mode === 'code') {
      var qpBtn = document.getElementById('card-quick-pass');
      if (qpBtn && qpBtn.disabled) {
        showToast('Quick Pass is currently switched off by administrator policy.', 'warn');
        return;
      }
      startLiveSession('code');
    } else if (mode === 'qr') {
      var slBtn = document.getElementById('card-scan-live');
      if (slBtn && slBtn.disabled) {
        showToast('Live Scan is currently switched off by administrator policy.', 'warn');
        return;
      }
      startLiveSession('qr');
    } else if (mode === 'rep') {
      var repBtn = document.getElementById('card-rep-share');
      if (repBtn && repBtn.disabled) {
        showToast('Rep Share is currently switched off by administrator policy.', 'warn');
        return;
      }
      forwardToRepModal();
    }
  }
  window.triggerAttendanceMethod = triggerAttendanceMethod;

  function updateAttendanceMethodETAs() {
    var attSettings = (window._pubSettings && window._pubSettings.attendance) || {};
    var rotCount = Number(attSettings.rotationCount) || 2;
    var rotSec = Number(attSettings.rotationTimeSec) || 60;
    var totalSec = rotCount * rotSec;
    var min = Math.round((totalSec / 60) * 10) / 10;
    var minStr = (min % 1 === 0 ? min : min.toFixed(1)) + ' min';
    var qpEl = document.getElementById('eta-quick-pass');
    if (qpEl) qpEl.textContent = minStr + ' session (' + rotCount + ' rotations)';
    var slEl = document.getElementById('eta-scan-live');
    if (slEl) slEl.textContent = minStr + ' QR code (' + rotCount + ' rotations)';
  }
  window.updateAttendanceMethodETAs = updateAttendanceMethodETAs;

  // QUICK PASS LOGIC (Items 13 & 14)
  let activeQuickPassSessionId = null;
  let activeQuickPassTrackId = null;
  let quickPassPollTimer = null;
  let quickPassTicker = null;
  let quickPassExpiresAtMs = 0;
  let quickPassCurrentRotation = 1;
  let quickPassRotationCount = 2;
  let quickPassRotationTimeSec = 60;
  let quickPassRecords = [];

  function startQuickPassSession() {
    var inputs = (typeof getSelectedAttendanceInputs === 'function') ? getSelectedAttendanceInputs() : {};
    var classId = inputs.classId || (document.getElementById('attcls') ? document.getElementById('attcls').value : '');
    var subjectId = inputs.subjectId || (document.getElementById('attsub') ? document.getElementById('attsub').value : '');
    var date = inputs.date || (document.getElementById('attdate') ? document.getElementById('attdate').value : '');
    var period = inputs.period || (document.getElementById('attperiod') ? document.getElementById('attperiod').value : '1');

    if (!classId || !subjectId || !date) {
      if (typeof dbToast === 'function') dbToast('Select class, subject and date first', 'warn');
      else showToast('Select class, subject and date', 'warn');
      return;
    }

    if (typeof dbToast === 'function') dbToast('Starting Quick Pass session…', 'saving');

    api('/api/quick-pass/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
      body: JSON.stringify({ classId: classId, subjectId: subjectId, date: date, periodNumber: period, periodNumbers: inputs.periodNumbers || [Number(period) || 1] })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        if (typeof dbToast === 'function') dbToast(data.error, 'error');
        else showToast(data.error, 'warn');
        return;
      }
      activeQuickPassSessionId = data.sessionId;
      activeQuickPassTrackId = data.sessionTrackId;
      quickPassCurrentRotation = data.currentRotation || 1;
      quickPassRotationCount = data.rotationCount || 2;
      quickPassRotationTimeSec = data.rotationTimeSec || 60;
      quickPassExpiresAtMs = data.expiresAt ? new Date(data.expiresAt).getTime() : (Date.now() + quickPassRotationTimeSec * 1000);
      quickPassRecords = [];

      showQuickPassModal(data.currentCode);
      startQuickPassTimers();
      if (typeof dbToast === 'function') dbToast('Quick Pass session active!', 'success');
    })
    .catch(function(err) {
      console.error(err);
      if (typeof dbToast === 'function') dbToast('Error starting Quick Pass session', 'error');
    });
  }
  window.startQuickPassSession = startQuickPassSession;

  function showQuickPassModal(code) {
    var modal = document.getElementById('modal-quick-pass');
    if (!modal) return;
    modal.style.display = 'flex';
    updateQuickPassCodeDisplay(code);
    updateQuickPassRotationBadge();
    var tb = document.getElementById('qp-live-tbody');
    if (tb) tb.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:#94a3b8;">Waiting for students to enter code…</td></tr>';
    var comp = document.getElementById('qp-count-completed');
    if (comp) comp.textContent = '0';
    var rem = document.getElementById('qp-count-remaining');
    if (rem) rem.textContent = '…';
  }
  window.showQuickPassModal = showQuickPassModal;

  function closeQuickPassModal() {
    var modal = document.getElementById('modal-quick-pass');
    if (modal) modal.style.display = 'none';
  }
  window.closeQuickPassModal = closeQuickPassModal;

  function formatPasscodeDisplay(code) {
    if (!code) return '------------';
    var str = String(code).toUpperCase();
    if (str.length === 12) {
      return str.slice(0, 4) + ' • ' + str.slice(4, 8) + ' • ' + str.slice(8, 12);
    }
    return str;
  }

  function updateQuickPassCodeDisplay(code) {
    var el = document.getElementById('qp-code-display');
    if (el) {
      el.textContent = formatPasscodeDisplay(code);
      el.setAttribute('data-raw-code', code || '');
    }
  }

  function updateQuickPassRotationBadge() {
    var badge = document.getElementById('qp-rotation-badge');
    if (badge) badge.textContent = 'ROTATION ' + quickPassCurrentRotation + '/' + quickPassRotationCount;
    var lbl = document.getElementById('qp-rotation-label');
    if (lbl) lbl.textContent = 'Rotation ' + quickPassCurrentRotation + ' of ' + quickPassRotationCount;
  }

  function startQuickPassTimers() {
    if (quickPassPollTimer) clearInterval(quickPassPollTimer);
    if (quickPassTicker) clearInterval(quickPassTicker);

    quickPassPollTimer = setInterval(pollQuickPassStatus, 3000);
    quickPassTicker = setInterval(updateQuickPassTicker, 250);
    pollQuickPassStatus();
  }

  function updateQuickPassTicker() {
    var now = Date.now();
    var diffMs = quickPassExpiresAtMs - now;
    var totalMs = quickPassRotationTimeSec * 1000;
    var pct = Math.max(0, Math.min(100, (diffMs / totalMs) * 100));
    var sec = Math.max(0, Math.ceil(diffMs / 1000));

    var timerEl = document.getElementById('qp-timer-text');
    if (timerEl) timerEl.textContent = sec + 's';
    var bar = document.getElementById('qp-progress-bar');
    if (bar) bar.style.width = pct + '%';
  }

  function pollQuickPassStatus() {
    if (!activeQuickPassSessionId || document.hidden) return;
    api('/api/quick-pass/status/' + activeQuickPassSessionId, {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) return;

      quickPassCurrentRotation = data.currentRotation || quickPassCurrentRotation;
      quickPassRotationCount = data.rotationCount || quickPassRotationCount;
      quickPassRotationTimeSec = data.rotationTimeSec || quickPassRotationTimeSec;
      if (data.expiresAt) quickPassExpiresAtMs = new Date(data.expiresAt).getTime();

      updateQuickPassCodeDisplay(data.currentCode);
      updateQuickPassRotationBadge();

      var compEl = document.getElementById('qp-count-completed');
      if (compEl) compEl.textContent = data.completedCount || 0;
      var remEl = document.getElementById('qp-count-remaining');
      if (remEl) remEl.textContent = data.remainingCount !== undefined ? data.remainingCount : 0;

      quickPassRecords = data.records || [];
      renderQuickPassLiveRecords(quickPassRecords);
      _prevQuickPassTrackIds = new Set((quickPassRecords || []).map(function(r){ return String(r.studentTrackId || r.studentId || r.regNo); }));

      if (!data.active) {
        clearInterval(quickPassPollTimer);
        clearInterval(quickPassTicker);
        quickPassPollTimer = null;
        quickPassTicker = null;
        var tEl = document.getElementById('qp-timer-text');
        if (tEl) tEl.textContent = 'Ended';
        var pb = document.getElementById('qp-progress-bar');
        if (pb) pb.style.width = '0%';
        if (typeof dbToast === 'function') dbToast('Quick Pass session finished (' + quickPassRecords.length + ' marked)', 'info');
      }
    })
    .catch(function(err) { console.warn('QP Poll error:', err); });
  }

  function renderQuickPassLiveRecords(records) {
    var tbody = document.getElementById('qp-live-tbody');
    if (!tbody) return;
    if (!records || !records.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:#94a3b8;">Waiting for students to enter code…</td></tr>';
      return;
    }
    tbody.innerHTML = records.map(function(r, idx) {
      var idKey = String(r.studentTrackId || r.studentId || r.regNo);
      var isNewlyJoined = !_prevQuickPassTrackIds.has(idKey);
      var timeStr = r.markedAt ? new Date(r.markedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
      var rowClass = isNewlyJoined ? 'live-join-row' : '';
      var joinBadge = isNewlyJoined ? ' <span class="live-join-badge"><re-icon icon="sparkles" size="10"></re-icon> Just Joined</span>' : '';
      return '<tr class="' + rowClass + '">'
        + '<td style="font-weight:700;color:#94a3b8;">' + (idx + 1) + '</td>'
        + '<td style="font-weight:600;font-family:monospace;">' + (r.regNo || '—') + '</td>'
        + '<td style="font-weight:600;">' + (r.studentName || 'Student') + joinBadge + '</td>'
        + '<td><span style="font-size:11px;padding:1px 6px;border-radius:6px;background:#fef3c7;color:#92400e;font-weight:700;">R' + (r.rotation || 1) + '</span></td>'
        + '<td style="font-size:11px;color:#64748b;">' + timeStr + '</td>'
        + '</tr>';
    }).join('');
  }

  function copyQuickPassCode() {
    var el = document.getElementById('qp-code-display');
    var raw = el ? el.getAttribute('data-raw-code') : '';
    if (!raw) return;
    navigator.clipboard.writeText(raw).then(function() {
      if (typeof dbToast === 'function') dbToast('Code copied to clipboard: ' + raw, 'success');
      else showToast('Code copied!', 'success');
    }).catch(function() {
      showToast('Could not copy code', 'warn');
    });
  }
  window.copyQuickPassCode = copyQuickPassCode;

  function applyQuickPassToAttendance(isDraft) {
    function applyRecords() {
      var markedTrackIds = Object.create(null);
      quickPassRecords.forEach(function(r) {
        if (r.studentTrackId) markedTrackIds[String(r.studentTrackId)] = true;
        if (r.studentId) markedTrackIds[String(r.studentId)] = true;
        if (r.regNo) markedTrackIds[String(r.regNo)] = true;
      });

      attendanceStudents.forEach(function(s, idx) {
        var isMarked = markedTrackIds[String(s._id)] ||
                       (s.trackId && markedTrackIds[String(s.trackId)]) ||
                       (s.regNo && markedTrackIds[String(s.regNo)]);
        attendanceStudents[idx].status = isMarked ? 'present' : 'absent';
      });

      renderAttendanceSheet();
      var selZone = document.getElementById('att-selector-zone');
      if (selZone) selZone.style.display = 'none';
      var sheet = document.getElementById('attsheet');
      if (sheet) sheet.style.display = 'block';

      var methodInd = document.getElementById('att-method-indicator');
      if (methodInd) {
        methodInd.innerHTML = '<re-icon icon="hashtag"></re-icon> Quick Pass (' + (isDraft ? 'Draft' : 'Completed') + ')';
        methodInd.style.display = 'inline-block';
      }

      var presentCount = attendanceStudents.filter(function(s) { return s.status === 'present'; }).length;
      if (typeof dbToast === 'function') {
        dbToast(
          'Quick Pass attendance loaded',
          'success',
          presentCount + ' present, ' + (attendanceStudents.length - presentCount) + ' absent'
        );
      }
    }

    if (!attendanceStudents || !attendanceStudents.length) {
      loadAttendanceSheet();
      setTimeout(applyRecords, 1200);
    } else {
      applyRecords();
    }
  }

  function saveQuickPassDraft() {
    if (!activeQuickPassSessionId) return;
    api('/api/quick-pass/save-draft/' + activeQuickPassSessionId, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() }
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (typeof dbToast === 'function') dbToast('Quick Pass saved as draft in database', 'success');
      applyQuickPassToAttendance(true);
      closeQuickPassModal();
    })
    .catch(function(e) {
      console.error(e);
      applyQuickPassToAttendance(true);
      closeQuickPassModal();
    });
  }
  window.saveQuickPassDraft = saveQuickPassDraft;

  function endQuickPassSession() {
    if (quickPassPollTimer) clearInterval(quickPassPollTimer);
    if (quickPassTicker) clearInterval(quickPassTicker);
    quickPassPollTimer = null;
    quickPassTicker = null;

    if (activeQuickPassSessionId) {
      api('/api/quick-pass/end/' + activeQuickPassSessionId, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + getToken() }
      }).catch(function(e){});
    }

    applyQuickPassToAttendance(false);
    closeQuickPassModal();
    if (typeof dbToast === 'function') dbToast('Quick Pass session ended & attendance applied', 'info');
  }
  window.endQuickPassSession = endQuickPassSession;

  let activeLiveSessionId = null;
  let activeLiveSessionTrackId = null;
  let activeLiveSessionMode = 'code';
  let liveSessionPollTimer = null;
  let qrRotationTicker = null;
  let qrReviewParticipationData = [];
  let qrCurrentToken = null;
  let qrExpiresAtMs = 0;
  let qrIntervalSec = 20;
  let isQrRefreshing = false;

  function startLiveSession(mode) {
    mode = mode || 'code';
    if (mode === 'code') {
      startQuickPassSession();
      return;
    }
    var inputs = (typeof getSelectedAttendanceInputs === 'function') ? getSelectedAttendanceInputs() : {};
    const classId   = inputs.classId || (document.getElementById('attcls') ? document.getElementById('attcls').value : '');
    const subjectId = inputs.subjectId || (document.getElementById('attsub') ? document.getElementById('attsub').value : '');
    const date      = inputs.date || (document.getElementById('attdate') ? document.getElementById('attdate').value : '');
    const period    = inputs.period || (document.getElementById('attperiod') ? document.getElementById('attperiod').value : '1');

    if (!classId || !subjectId || !date) {
      if (typeof dbToast === 'function') dbToast('Select class, subject and date', 'warn');
      else showToast('Select class, subject and date', 'warn');
      return;
    }

    // Switch view to State 2 (Roster Sheet) underneath
    var selZone = document.getElementById('att-selector-zone');
    if (selZone) selZone.style.display = 'none';
    var sheet = document.getElementById('attsheet');
    if (sheet) sheet.style.display = 'block';

    var methodInd = document.getElementById('att-method-indicator');
    if (methodInd) {
      methodInd.innerHTML = '<re-icon icon="camera"></re-icon> Scan Live QR (Active)';
      methodInd.style.display = 'inline-block';
    }

    // Preload attendance roster if not loaded
    if (!attendanceStudents || !attendanceStudents.length) {
      loadAttendanceSheet();
    }

    if (typeof dbToast === 'function') dbToast('Starting live QR attendance session…', 'saving');

    api('/api/live-session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
      body: JSON.stringify({ classId: classId, subjectId: subjectId, date: date, periodNumber: period, periodNumbers: inputs.periodNumbers || [Number(period) || 1], attendanceMode: 'qr' })
    })
    .then(function(res){ return res.json(); })
    .then(function(data) {
      if (data.error) {
        if (typeof dbToast === 'function') dbToast(data.error, 'error');
        else showToast(data.error, 'warn');
        return;
      }
      activeLiveSessionId = data._id;
      activeLiveSessionTrackId = data.trackId;
      activeLiveSessionMode = 'qr';

      var ctrlEl = document.getElementById('live-session-controls');
      if (ctrlEl) {
        ctrlEl.style.display = 'inline-flex';
        ctrlEl.innerHTML =
          '<button class="btn-pri" onclick="showQrModal()" style="background:#4f46e5;box-shadow:none;font-size:12px;padding:6px 12px;"><re-icon icon="camera"></re-icon> View QR</button>' +
          '<button class="btn-pri" onclick="openQrReviewModal()" style="background:#0f172a;box-shadow:none;font-size:12px;padding:6px 12px;"><re-icon icon="clipboard-list"></re-icon> Review</button>' +
          '<button class="btn-pri" onclick="endLiveSession()" style="background:#dc2626;box-shadow:none;font-size:12px;padding:6px 12px;"><re-icon icon="pause"></re-icon> End</button>';
      }

      showQrModal();
      qrCurrentToken = null;
      qrExpiresAtMs = 0; // Wait timer until QR actually loads
      pollQrLiveSession();
      if (liveSessionPollTimer) clearInterval(liveSessionPollTimer);
      if (qrRotationTicker) clearInterval(qrRotationTicker);
      liveSessionPollTimer = setInterval(pollQrLiveSession, 3000); // 3s stats sync
      qrRotationTicker = setInterval(updateQrTicker, 200); // 200ms smooth timer & instant refresh
      dbToast('Live Rotating QR session started!', 'success', 'QR refreshes every ' + (data.qrIntervalSec || 60) + 's');
    })
    .catch(function(e){
      console.error('[startLiveSession error]:', e);
      dbToast('Error starting live session', 'error');
    });
  }
  window.startLiveSession = startLiveSession;

  function showQrModal() {
    var modal = document.getElementById('modal-qr-session');
    if (modal) modal.style.display = 'flex';
  }
  window.showQrModal = showQrModal;

  function hideQrModal() {
    var modal = document.getElementById('modal-qr-session');
    if (modal) modal.style.display = 'none';
  }
  window.hideQrModal = hideQrModal;

  function toggleQrFullscreen() {
    var modal = document.getElementById('modal-qr-session');
    if (!document.fullscreenElement) {
      if (modal && modal.requestFullscreen) modal.requestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  }
  window.toggleQrFullscreen = toggleQrFullscreen;

  function pollLiveSession() {
    if (!activeLiveSessionId) return;
    api('/api/live-session/status/' + activeLiveSessionId, {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    })
    .then(function(res){ return res.json(); })
    .then(function(data) {
      if (!data || data.error) return;
      if (!data.active) { endLiveSession(true); return; }
      
      if (Array.isArray(data.markedStudents)) {
        data.markedStudents.forEach(function(s) {
          const idx = attendanceStudents.findIndex(function(st) { return String(st.regNo) === String(s.regNo) || String(st._id) === String(s.studentId); });
          if (idx !== -1 && attendanceStudents[idx].status !== 'present') {
            setAttendanceStatus(idx, 'present');
            dbToast(s.regNo + ' self-marked present', 'success');
          }
        });
      }
    })
    .catch(function(e) {});
  }

  function updateQrTicker() {
    if (!activeLiveSessionId || activeLiveSessionMode !== 'qr') return;
    var timerText = document.getElementById('qr-timer-text');
    var progressBar = document.getElementById('qr-progress-bar');

    // ONLY when QR loads does the timer start; until that, wait timer!
    if (!qrExpiresAtMs || qrExpiresAtMs <= 0) {
      if (timerText) timerText.textContent = 'Waiting for QR…';
      if (progressBar) progressBar.style.width = '100%';
      return;
    }

    var now = Date.now();
    var remainingMs = Math.max(0, qrExpiresAtMs - now);
    var secondsRemaining = Math.max(0, Math.ceil(remainingMs / 1000));

    if (timerText) timerText.textContent = secondsRemaining + 's';

    if (progressBar && qrIntervalSec) {
      var pct = (remainingMs / (qrIntervalSec * 1000)) * 100;
      progressBar.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }

    // When the countdown reaches 0, trigger immediate QR refresh
    if (remainingMs <= 0 && !isQrRefreshing) {
      qrExpiresAtMs = 0;
      pollQrLiveSession();
    }
  }

  function pollQrLiveSession() {
    if (!activeLiveSessionId || isQrRefreshing || document.hidden) return;
    isQrRefreshing = true;

    api('/api/qr-attendance/qr-data/' + activeLiveSessionId, {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    })
    .then(function(res){ return res.json(); })
    .then(function(data) {
      isQrRefreshing = false;
      if (!data || data.error) {
        if (data && data.expired) endLiveSession(true);
        return;
      }
      if (!data.active) { endLiveSession(true); return; }

      qrIntervalSec = data.intervalSec || 60;

      // Update rotation badge
      var rotBadge = document.getElementById('qr-rotation-badge');
      if (rotBadge) {
        rotBadge.textContent = 'Rotation ' + (data.currentRotation || 1) + ' / ' + (data.totalRotations || data.rotationCount || 2);
      }

      // 1. Render QR to canvas only on initial token or when timer expired for rotation
      var canvas = document.getElementById('qr-canvas');
      var shouldRotateQr = (qrCurrentToken !== data.qrTrackId && (!qrExpiresAtMs || qrExpiresAtMs <= Date.now()));

      if (canvas && data.qrUrl && window.renderQrToCanvas && shouldRotateQr) {
        var fullUrl = (window.location.origin || '') + data.qrUrl;
        qrCurrentToken = data.qrTrackId;
        qrExpiresAtMs = 0; // Freeze timer until image actually loads
        updateQrTicker();

        // Render QR and start timer ONLY AFTER successful image load
        renderQrToCanvas(canvas, fullUrl, 300, function(loadInfo) {
          // 1. Note exact time
          var readyTime = (loadInfo && loadInfo.loadedAt) ? loadInfo.loadedAt : new Date();

          // 2. Create audit log entry for successful QR display
          api('/api/qr-attendance/log-loaded', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
            body: JSON.stringify({
              sessionTrackId: data.sessionTrackId || activeLiveSessionTrackId,
              qrTrackId: data.qrTrackId,
              loadedAt: readyTime.toISOString(),
              intervalSec: qrIntervalSec
            })
          }).catch(function(e) {
            console.error('[QR Log Loaded Error]:', e);
          });

          // 3. ONLY start refresh countdown timer now that QR is displayed
          qrExpiresAtMs = Date.now() + (qrIntervalSec * 1000);
          updateQrTicker();

          // 4. Notify ready with dbToast
          dbToast('QR code ready for scanning', 'success', 'Token: ' + (data.qrTrackId || '—') + ' (' + qrIntervalSec + 's)');
        });
      }

      // 2. Dev mode: Display direct clickable/copyable QR attendance URL below QR
      var fullUrl = (window.location.origin || '') + data.qrUrl;
      var isDev = window.location.hostname === 'localhost' ||
                  window.location.hostname === '127.0.0.1' ||
                  (window._pubSettings && window._pubSettings.advanced && window._pubSettings.advanced.debugMode);
      var devBox = document.getElementById('qr-dev-url-box');
      var devLink = document.getElementById('qr-dev-url-link');
      if (devBox && devLink) {
        if (isDev && fullUrl) {
          devBox.style.display = 'block';
          devLink.href = fullUrl;
          devLink.textContent = fullUrl;
        } else {
          devBox.style.display = 'none';
        }
      }

      // 3. Update Window Token and Timer Bar
      var tokenText = document.getElementById('qr-token-text');
      if (tokenText) tokenText.textContent = data.qrTrackId || '—';

      // 4. Update Counts
      var completedEl = document.getElementById('qr-count-completed');
      if (completedEl) completedEl.textContent = data.completedCount || 0;

      var pendingEl = document.getElementById('qr-count-pending');
      if (pendingEl) pendingEl.textContent = data.pendingCount || 0;
    })
    .catch(function(e) {
      isQrRefreshing = false;
    });
  }

  function copyQrDevUrl() {
    var devLink = document.getElementById('qr-dev-url-link');
    if (devLink && devLink.href && devLink.href !== '#') {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(devLink.href).then(function() {
          dbToast('QR Attendance URL copied!', 'success');
        }).catch(function() {
          dbToast('Failed to copy URL', 'error');
        });
      } else {
        var tempInput = document.createElement('input');
        tempInput.value = devLink.href;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
        dbToast('QR Attendance URL copied!', 'success');
      }
    }
  }
  window.copyQrDevUrl = copyQrDevUrl;

  function openQrReviewModal() {
    var targetTrackId = activeLiveSessionTrackId;
    if (!targetTrackId) {
      showToast('No active live QR session to review', 'warn');
      return;
    }
    var modal = document.getElementById('modal-qr-review');
    if (modal) modal.style.display = 'flex';

    var tbody = document.getElementById('qr-review-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:#94a3b8;">Loading live participation records...</td></tr>';

    if (!attendanceStudents || !attendanceStudents.length) {
      loadAttendanceSheet();
    }

    api('/api/qr-attendance/participation/' + targetTrackId, {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    })
    .then(function(res){ return res.json(); })
    .then(function(data) {
      qrReviewParticipationData = data.records || [];
      if (!attendanceStudents || !attendanceStudents.length) {
        setTimeout(renderQrReviewTable, 600);
      } else {
        renderQrReviewTable();
      }
    })
    .catch(function(e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:#ef4444;">Failed to load records</td></tr>';
    });
  }
  window.openQrReviewModal = openQrReviewModal;

  function closeQrReviewModal() {
    var modal = document.getElementById('modal-qr-review');
    if (modal) modal.style.display = 'none';
  }
  window.closeQrReviewModal = closeQrReviewModal;

  function renderQrReviewTable() {
    var tbody = document.getElementById('qr-review-tbody');
    if (!tbody) return;

    if (!attendanceStudents || !attendanceStudents.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:#94a3b8;">No students loaded for this class</td></tr>';
      return;
    }

    var html = '';
    attendanceStudents.forEach(function(st, idx) {
      var part = qrReviewParticipationData.find(function(p) {
        return String(p.studentId) === String(st._id) || String(p.studentTrackId) === String(st.trackId) || String(p.regNo) === String(st.regNo);
      });

      var liveStatusBadge = '';
      var qrTiming = '—';
      var isPrePresent = false;

      if (part && part.status === 'completed') {
        var windowBadge = part.qrWindowType === 'grace' ? ' <span style="color:#d97706;font-size:11px;">(5s Grace)</span>' : '';
        liveStatusBadge = '<span style="background:#dcfce7;color:#166534;font-size:11px;padding:3px 8px;border-radius:6px;font-weight:700;"><span class="status-dot green"></span> Completed' + windowBadge + '</span>';
        qrTiming = (part.qrTrackId || 'QR') + ' @ ' + (new Date(part.markedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}));
        isPrePresent = true;
        setAttendanceStatus(idx, 'present');
      } else if (part && part.status === 'pending') {
        var reason = (part.verificationDetails && part.verificationDetails.failReason) || 'Awaiting Review';
        liveStatusBadge = '<span style="background:#fef3c7;color:#92400e;font-size:11px;padding:3px 8px;border-radius:6px;font-weight:700;" title="' + escapeHtml(reason) + '"><span class="status-dot amber"></span> Pending: ' + escapeHtml(reason) + '</span>';
        qrTiming = (part.qrTrackId || 'QR') + ' @ ' + (new Date(part.markedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}));
        isPrePresent = false;
        setAttendanceStatus(idx, 'absent');
      } else {
        // Not Scanned -> Mark as AB (absent), NOT P
        liveStatusBadge = '<span style="background:#fee2e2;color:#991b1b;font-size:11px;padding:3px 8px;border-radius:6px;font-weight:700;"><span class="status-dot red"></span> Not Scanned</span>';
        isPrePresent = false;
        setAttendanceStatus(idx, 'absent');
      }

      // Security column (§7.4)
      var securityHtml = '<span style="color:#94a3b8;font-size:11px;">—</span>';
      if (part && part.security) {
        var sec = part.security;
        var trustHalf = Math.round((sec.trustScoreAtMark || 100) / 2);
        var devHalf = sec.deviceScoreAtMark || 0;
        var combined = sec.combinedScoreAtMark || (trustHalf + devHalf);
        var risk = sec.riskLevelAtMark || 'low';
        var riskColor = risk === 'low' ? '#166534' : (risk === 'medium' ? '#92400e' : '#991b1b');
        var riskBg = risk === 'low' ? '#dcfce7' : (risk === 'medium' ? '#fef3c7' : '#fee2e2');

        securityHtml = '<div style="line-height:1.3;">' +
          '<div style="font-weight:700;color:#0f172a;"><b>' + combined + '</b>/100 <span style="background:' + riskBg + ';color:' + riskColor + ';font-size:11px;padding:1px 6px;border-radius:4px;text-transform:uppercase;font-weight:700;">' + escapeHtml(risk) + '</span></div>' +
          '<div style="font-size:11px;color:#64748b;">Trust ' + trustHalf + '/50 · Dev ' + devHalf + '/50</div>';

        if (sec.teacherVerification && sec.teacherVerification.required) {
          if (sec.teacherVerification.result === 'present') {
            securityHtml += '<div style="color:#16a34a;font-size:11px;font-weight:700;margin-top:2px;">✓ Verified Present</div>';
          } else if (sec.teacherVerification.result === 'not_in_class') {
            securityHtml += '<div style="color:#ef4444;font-size:11px;font-weight:700;margin-top:2px;">✗ Marked Not in Class</div>';
          } else if (sec.teacherVerification.result === 'denied_low_trust') {
            securityHtml += '<div style="color:#d97706;font-size:11px;font-weight:700;margin-top:2px;">⚠ Denied (Low Trust)</div>';
          } else {
            securityHtml += '<div style="display:flex;gap:4px;margin-top:4px;">' +
              '<button type="button" style="padding:2px 7px;background:#16a34a;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;" onclick="verifyStudentAttendance(\'' + activeLiveSessionTrackId + '\', \'' + st._id + '\', \'present\', ' + idx + ')">Present</button>' +
              '<button type="button" style="padding:2px 7px;background:#dc2626;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;" onclick="verifyStudentAttendance(\'' + activeLiveSessionTrackId + '\', \'' + st._id + '\', \'not_in_class\', ' + idx + ')">Not in Class</button>' +
            '</div>';
          }
        }
        securityHtml += '</div>';
      }

      html += '<tr style="border-bottom:1px solid #f1f5f9;">' +
        '<td style="padding:10px 8px;font-weight:600;color:#64748b;">' + (idx + 1) + '</td>' +
        '<td style="padding:10px 8px;font-weight:700;">' + (st.regNo || '—') + '</td>' +
        '<td style="padding:10px 8px;">' + (st.fullName || st.name || '—') + '</td>' +
        '<td style="padding:10px 8px;">' + liveStatusBadge + '</td>' +
        '<td style="padding:10px 8px;">' + securityHtml + '</td>' +
        '<td style="padding:10px 8px;font-size:11.5px;color:#64748b;">' + qrTiming + '</td>' +
        '<td style="padding:10px 8px;text-align:center;">' +
          '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;margin-right:8px;">' +
            '<input type="radio" name="qr_stat_' + idx + '" value="present" ' + (isPrePresent ? 'checked' : '') + ' onchange="setAttendanceStatus(' + idx + ', \'present\')">' +
            '<span style="color:#16a34a;font-weight:700;font-size:12px;">P</span>' +
          '</label>' +
          '<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;">' +
            '<input type="radio" name="qr_stat_' + idx + '" value="absent" ' + (!isPrePresent ? 'checked' : '') + ' onchange="setAttendanceStatus(' + idx + ', \'absent\')">' +
            '<span style="color:#ef4444;font-weight:700;font-size:12px;">AB</span>' +
          '</label>' +
        '</td>' +
      '</tr>';
    });

    tbody.innerHTML = html;
  }

  async function verifyStudentAttendance(sessionTrackId, studentId, result, idx) {
    try {
      var res = await api('/api/trust/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + getToken()
        },
        body: JSON.stringify({ sessionTrackId: sessionTrackId, studentId: studentId, result: result })
      });
      var data = await res.json();
      if (!res.ok || !data.ok) {
        dbToast(data.message || data.error || 'Verification action failed', 'error');
      } else {
        dbToast(data.message || 'Verification updated', result === 'present' ? 'success' : 'warn');
        if (result === 'present') {
          setAttendanceStatus(idx, 'present');
        } else {
          setAttendanceStatus(idx, 'absent');
        }
      }
      if (activeLiveSessionTrackId) {
        api('/api/qr-attendance/participation/' + activeLiveSessionTrackId, {
          headers: { 'Authorization': 'Bearer ' + getToken() }
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          qrReviewParticipationData = d.records || [];
          renderQrReviewTable();
        });
      }
    } catch (e) {
      dbToast('Error updating student verification: ' + e.message, 'error');
    }
  }
  window.verifyStudentAttendance = verifyStudentAttendance;

  function applyQrParticipationToRoster(callback) {
    var targetTrackId = activeLiveSessionTrackId;
    if (!targetTrackId) {
      if (typeof callback === 'function') callback();
      return;
    }
    api('/api/qr-attendance/participation/' + targetTrackId, {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    })
    .then(function(res){ return res.json(); })
    .then(function(data) {
      var completedList = (data.records || []).filter(function(r) { return r.status === 'completed'; });
      var completedMap = Object.create(null);
      completedList.forEach(function(r) {
        if (r.studentId) completedMap[String(r.studentId)] = true;
        if (r.studentTrackId) completedMap[String(r.studentTrackId)] = true;
        if (r.regNo) completedMap[String(r.regNo)] = true;
      });

      function apply() {
        if (attendanceStudents && attendanceStudents.length) {
          attendanceStudents.forEach(function(s, idx) {
            var isCompleted = completedMap[String(s._id)] ||
                              (s.trackId && completedMap[String(s.trackId)]) ||
                              (s.regNo && completedMap[String(s.regNo)]);
            attendanceStudents[idx].status = isCompleted ? 'present' : 'absent';
          });
          renderAttendanceSheet();
          updateAttendanceSummary();
        }
        if (typeof callback === 'function') callback();
      }

      if (!attendanceStudents || !attendanceStudents.length) {
        loadAttendanceSheet();
        setTimeout(apply, 800);
      } else {
        apply();
      }
    })
    .catch(function(err) {
      console.error('Error applying QR participation:', err);
      if (typeof callback === 'function') callback();
    });
  }

  function saveQrLiveDraft() {
    if (!activeLiveSessionId) {
      showToast('No active QR session to save as draft', 'warn');
      return;
    }
    var targetTrackId = activeLiveSessionTrackId;
    api('/api/qr-attendance/save-draft/' + activeLiveSessionId, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() }
    })
    .then(function(r) { return r.json(); })
    .then(function() {
      applyQrParticipationToRoster(function() {
        hideQrModal();
        var methodInd = document.getElementById('att-method-indicator');
        if (methodInd) {
          methodInd.innerHTML = '<re-icon icon="camera"></re-icon> Scan Live (Draft Saved)';
          methodInd.style.display = 'inline-block';
        }
        dbToast('QR attendance saved as draft and applied to roster', 'success');
      });
    })
    .catch(function(err) {
      console.error('Error saving QR draft:', err);
      applyQrParticipationToRoster(function() {
        hideQrModal();
        dbToast('QR participation applied to roster', 'info');
      });
    });
  }
  window.saveQrLiveDraft = saveQrLiveDraft;

  function applyAndSaveQrAttendance() {
    if (attendanceStudents && Array.isArray(attendanceStudents)) {
      attendanceStudents.forEach(function(st, idx) {
        var radioAb = document.querySelector('input[name="qr_stat_' + idx + '"][value="absent"]');
        var radioP = document.querySelector('input[name="qr_stat_' + idx + '"][value="present"]');
        if (radioAb && radioAb.checked) {
          setAttendanceStatus(idx, 'absent');
        } else if (radioP && radioP.checked) {
          setAttendanceStatus(idx, 'present');
        }
      });
    }
    closeQrReviewModal();
    hideQrModal();
    renderAttendanceSheet();
    updSum();
    dbToast('Saving attendance from QR participation…', 'saving');
    submitAttendance();
  }
  window.applyAndSaveQrAttendance = applyAndSaveQrAttendance;

  function endLiveSession(autoEnded) {
    if (liveSessionPollTimer) clearInterval(liveSessionPollTimer);
    if (qrRotationTicker) clearInterval(qrRotationTicker);
    liveSessionPollTimer = null;
    qrRotationTicker = null;
    qrCurrentToken = null;
    isQrRefreshing = false;

    var endingSessionId = activeLiveSessionId;
    var endingTrackId = activeLiveSessionTrackId;

    if (!autoEnded && endingSessionId) {
      api('/api/live-session/end/' + endingSessionId, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + getToken() }
      }).catch(function(e){});
    }

    hideQrModal();

    var ctrlEl = document.getElementById('live-session-controls');
    if (ctrlEl) {
      ctrlEl.innerHTML = '';
      ctrlEl.style.display = 'none';
    }

    if (endingTrackId) {
      applyQrParticipationToRoster(function() {
        var methodInd = document.getElementById('att-method-indicator');
        if (methodInd) {
          methodInd.innerHTML = '<re-icon icon="camera"></re-icon> Scan Live (Session Ended)';
          methodInd.style.display = 'inline-block';
        }
        activeLiveSessionId = null;
        activeLiveSessionTrackId = null;
      });
    } else {
      activeLiveSessionId = null;
      activeLiveSessionTrackId = null;
    }

    if (!autoEnded) { dbToast('Live QR session ended manually.', 'info'); }
    else { dbToast('Live QR session expired.', 'warn'); }
  }
  window.endLiveSession = endLiveSession;

  function submitAttendance() {
    if (window._attendanceSheetReadOnly) {
      showToast('Attendance editing is locked for this session by institutional policy.', 'error');
      return;
    }
    var pol = window._portalPolicy || {};
    if (pol.canMark === false) {
      showToast('Attendance marking is locked by administrator', 'error');
      return;
    }
    if (!attendanceStudents.length) { showToast('No students loaded', 'warn'); return; }

    var inputs = (typeof getSelectedAttendanceInputs === 'function') ? getSelectedAttendanceInputs() : {};
    var classId     = inputs.classId || (document.getElementById('attcls') ? document.getElementById('attcls').value : '');
    var subjectId   = inputs.subjectId || (document.getElementById('attsub') ? document.getElementById('attsub').value : '');
    var date        = inputs.date || (document.getElementById('attdate') ? document.getElementById('attdate').value : '');
    var periodNumber = Number(inputs.period) || (document.getElementById('attperiod') ? Number(document.getElementById('attperiod').value) || 1 : 1);
    var assignment  = getMyAssignments().find(function(a) { return String(a.classId) === String(classId) && String(a.subjectId) === String(subjectId); });
    var tok         = getToken();

    if (!tok) { showToast('Not authenticated', 'warn'); return; }
    if (!classId || !subjectId || !date) {
      if (typeof dbToast === 'function') dbToast('Select class, subject and date first', 'warn');
      else showToast('Select class, subject and date first', 'warn');
      return;
    }

    var unmarked = attendanceStudents.filter(function(st) { return st.status === 'unmarked'; }).length;
    if (unmarked) {
      showToast(unmarked + ' student(s) are still unmarked — mark Present or Absent before saving.', 'warn');
      return;
    }

    var topicVal = (document.getElementById('att-topic') ? document.getElementById('att-topic').value : '').trim();
    var notesVal = (document.getElementById('att-notes') ? document.getElementById('att-notes').value : '').trim();
    var requireRemark = !!(window._pubSettings && window._pubSettings.attendance && window._pubSettings.attendance.requirePeriodRemark);
    if (requireRemark && !topicVal) {
      if (typeof dbToast === 'function') dbToast('Topic Covered is required by institutional policy', 'warn');
      else showToast('Topic Covered is required by policy', 'warn');
      return;
    }

    var saveBtn = document.getElementById('btn-save-attendance');
    var originalBtnHtml = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.classList.add('btn-loading');
      saveBtn.innerHTML = '<span class="btn-spinner" style="margin-right:6px;"></span> Saving…';
    }

    function restoreSaveBtn(isSuccess) {
      if (!saveBtn) return;
      if (isSuccess) {
        saveBtn.innerHTML = '<re-icon icon="check" size="16"></re-icon> Saved!';
        setTimeout(function() {
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.classList.remove('btn-loading');
            saveBtn.innerHTML = originalBtnHtml || '<re-icon icon="save" size="16"></re-icon> Save Attendance';
          }
        }, 1500);
      } else {
        saveBtn.disabled = false;
        saveBtn.classList.remove('btn-loading');
        saveBtn.innerHTML = originalBtnHtml || '<re-icon icon="save" size="16"></re-icon> Save Attendance';
      }
    }

    if (typeof dbToast === 'function') {
      dbToast('Saving attendance to database…', 'saving');
    } else {
      showToast('Saving attendance…');
    }

    // Single batch POST — server stores everything in ClassAttendance + StudentAttendance
    var payload = {
      sessionId:          window._activeSessionId || (inputs && inputs.sessionId) || undefined,
      classId:            classId,
      subjectId:          subjectId,
      date:               date,
      periodNumber:       periodNumber,
      periodNumbers:      (inputs.periodNumbers && inputs.periodNumbers.length) ? inputs.periodNumbers : [periodNumber],
      topic:              topicVal,
      notes:              notesVal,
      quickPassSessionId: activeQuickPassSessionId || undefined,
      scanLiveSessionId:  activeLiveSessionId || undefined,
      repShareSessionId:  activeRepShareSessionId || undefined,
      records: attendanceStudents.map(function(student) {
        return {
          studentId:     String(student._id),
          studentTrackId: student.trackId || String(student._id),
          status:        student.status   // 'present' or 'absent' — server normalises to P/AB
        };
      })
    };

    api('/api/attendance', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body:    JSON.stringify(payload)
    })
    .then(function(r) {
      if (!r.ok) {
        return r.json().then(function(errJson) {
          return Promise.reject(errJson);
        }).catch(function() {
          return Promise.reject({ error: 'Server error saving attendance' });
        });
      }
      return r.json();
    })
    .then(function() {
      return syncMyAttendance();
    }).then(function() {
      updateAttendanceSavedStatusCard(true, attendanceStudents.length);
      updateAttendanceUrlParams();
      var clsName = (assignment && assignment.className) ? assignment.className : '';
      if (!clsName && typeof DB !== 'undefined' && DB.get) {
        var cObj = (DB.get('classes') || []).find(function(c) { return String(c._id || c.classTrackId || c.id) === String(classId); });
        if (cObj) clsName = cObj.className || cObj.name || '';
      }
      if (!clsName) clsName = 'Class';
      if (typeof dbToast === 'function') {
        dbToast('Attendance saved to MongoDB!', 'success', clsName + ' • ' + attendanceStudents.length + ' records');
      } else {
        showToast('Attendance saved!', 'success');
      }
      renderAttendanceSheet();
      restoreSaveBtn(true);
    }).catch(function(err) {
      restoreSaveBtn(false);
      var msg = (err && err.error) ? ('<re-icon icon="x-circle"></re-icon> ' + err.error) : 'Error saving attendance — please retry';
      if (typeof dbToast === 'function') dbToast(msg, 'error');
      else showToast(msg, 'warn');
    });
  }
  var submitAtt = submitAttendance;
  window.submitAttendance = submitAttendance;
  window.submitAtt = submitAttendance;

  // REPORTS
  function renderAttendanceRecord() {
    var classFilter   = document.getElementById('rfc') ? document.getElementById('rfc').value : '';
    var subjectFilter = document.getElementById('rfs') ? document.getElementById('rfs').value : '';
    var fromDate      = document.getElementById('rff') ? document.getElementById('rff').value : '';
    var toDate        = document.getElementById('rft') ? document.getElementById('rft').value : '';

    var tbody = document.getElementById('attrec');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">Loading…</td></tr>';

    fetchAttendanceForReport(classFilter, subjectFilter, fromDate, toDate)
      .then(function(attendance) {
        // subjectId is not a route param — filter client-side
        if (subjectFilter) {
          attendance = attendance.filter(function(a) { return String(a.subjectId) === String(subjectFilter); });
        }

        // Aggregate per student + subject
        var grouped = {};
        attendance.forEach(function(a) {
          var key = String(a.studentId) + '|' + String(a.subjectId);
          if (!grouped[key]) grouped[key] = {
            studentName: a.studentName || '', regNo: a.regNo || '',
            className: a.className,   subjectName: a.subjectName,
            present: 0, total: 0,     studentId: a.studentId
          };
          grouped[key].total++;
          if (a.status === 'present') grouped[key].present++;
        });

        // Enrich reg numbers from student cache (populated by syncMyStudents)
        var allStudents = DB.get('students');
        Object.values(grouped).forEach(function(record) {
          if (!record.regNo) {
            var stu = allStudents.find(function(s) { return String(s._id) === String(record.studentId); });
            if (stu) record.regNo = stu.regNo || '';
          }
        });

        var rows = Object.values(grouped).sort(function(a, b) { return String(a.studentName).localeCompare(String(b.studentName)); });

        if (!rows.length) {
          tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">No records found.</td></tr>';
          return;
        }

        tbody.innerHTML = rows.map(function(record, index) {
          var minA     = (window._portalPolicy && window._portalPolicy.thresholds && window._portalPolicy.thresholds.minAttendance) || (window._pubSettings && window._pubSettings.academic ? (window._pubSettings.academic.minAttendance || 75) : 75);
          var lowA     = (window._portalPolicy && window._portalPolicy.thresholds && window._portalPolicy.thresholds.low) || (window._pubSettings && window._pubSettings.academic ? (window._pubSettings.academic.lowAttendanceThreshold || 65) : 65);
          var pct      = record.total ? Math.round(record.present / record.total * 100) : 0;
          var pctClass = pct >= minA ? 'ph' : pct >= lowA ? 'pm' : 'pl';
          return '<tr>'
            + '<td>' + (index + 1) + '</td>'
            + '<td style="font-weight:600;">' + escapeHtml(record.studentName) + '</td>'
            + '<td style="color:var(--tmu);">' + escapeHtml(record.regNo || '—') + '</td>'
            + '<td>' + escapeHtml(record.className) + '</td>'
            + '<td>' + escapeHtml(record.subjectName) + '</td>'
            + '<td>' + (Number(record.total) || 0) + '</td>'
            + '<td style="color:var(--gK);font-weight:600;">' + (Number(record.present) || 0) + '</td>'
            + '<td><span class="pb ' + pctClass + '">' + pct + '%</span></td>'
            + '</tr>';
        }).join('');
      }).catch(function() {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#dc2626;">Error loading records.</td></tr>';
      });
  }
  var renderAttRec = renderAttendanceRecord;
  window.renderAttendanceRecord = renderAttendanceRecord;
  window.renderAttRec = renderAttendanceRecord;

  function exportAttendanceCSV() {
    const tableEl = document.getElementById('attrec');
    const rows    = [['#','Student Name','Reg No','Class','Subject','Total Hours','Present Hours','Attendance %']];
    tableEl.querySelectorAll('tr').forEach(function(tr) {
      const cells = Array.from(tr.querySelectorAll('td')).map(function(td) { return td.textContent.trim(); });
      if (cells.length) rows.push(cells);
    });
    downloadCSV(rows, 'Attendance_Record');
    if (typeof dbToast === 'function') dbToast('<re-icon icon="download"></re-icon> Attendance CSV downloaded!', 'success');
    else showToast('<re-icon icon="download"></re-icon> Downloaded!', 'success');
  }
  var exportAttCSV = exportAttendanceCSV;
  window.exportAttendanceCSV = exportAttendanceCSV;
  window.exportAttCSV = exportAttendanceCSV;

  function renderDefaultersList() {
    const classFilter   = document.getElementById('dfc') ? document.getElementById('dfc').value : '';
    const subjectFilter = document.getElementById('dfs') ? document.getElementById('dfs').value : '';
    const defaultTh     = (window._portalPolicy && window._portalPolicy.thresholds && window._portalPolicy.thresholds.minAttendance) || (window._pubSettings && window._pubSettings.academic ? (window._pubSettings.academic.minAttendance || 75) : 75);
    const threshold     = parseInt(document.getElementById('dfth') ? (document.getElementById('dfth').value || defaultTh) : defaultTh);

    // Already teacher-scoped by the API (teacherId on records is a trackId).
    const allAttendance = DB.get('attendance').filter(function(a) {
      return (!classFilter   || String(a.classId)   === String(classFilter))
          && (!subjectFilter || String(a.subjectId) === String(subjectFilter));
    });

    const defaulterRows = [];
    getMyAssignments()
      .filter(function(a) {
        return (!classFilter   || a.classId   === classFilter)
            && (!subjectFilter || a.subjectId === subjectFilter);
      })
      .forEach(function(assignment) {
        DB.get('students').filter(function(s) { return s.classId === assignment.classId; }).forEach(function(student) {
          const stuAtt = allAttendance.filter(function(a) { return String(a.studentId) === String(student._id) && String(a.subjectId) === String(assignment.subjectId); });
          if (!stuAtt.length) return;
          const pct = Math.round(stuAtt.filter(function(a) { return a.status === 'present'; }).length / stuAtt.length * 100);
          if (pct < threshold) {
            defaulterRows.push(Object.assign({}, student, {
              pct: pct,
              present: stuAtt.filter(function(a) { return a.status === 'present'; }).length,
              total: stuAtt.length,
              subjectName: assignment.subjectName,
              className: assignment.className
            }));
          }
        });
      });

    defaulterRows.sort(function(a, b) { return a.pct - b.pct; });
    const tbody = document.getElementById('deftbody');

    if (!defaulterRows.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">No defaulters <re-icon icon="party"></re-icon></td></tr>';
      return;
    }

    tbody.innerHTML = defaulterRows.map(function(row, index) {
      return '<tr>'
        + '<td>' + (index + 1) + '</td>'
        + '<td style="font-weight:600;">' + escapeHtml(row.name) + '</td>'
        + '<td>' + escapeHtml(row.regNo) + '</td>'
        + '<td>' + escapeHtml(row.className) + '</td>'
        + '<td>' + escapeHtml(row.subjectName) + '</td>'
        + '<td style="color:var(--gK);font-weight:600;">' + (Number(row.present) || 0) + '</td>'
        + '<td>' + (Number(row.total) || 0) + '</td>'
        + '<td><span class="pb ' + (row.pct < 50 ? 'pl' : 'pm') + '">' + (Number(row.pct) || 0) + '%</span></td>'
        + '</tr>';
    }).join('');
  }
  var renderDefs = renderDefaultersList;
  window.renderDefaultersList = renderDefaultersList;
  window.renderDefs = renderDefaultersList;

  function exportDefaultersCSV() {
    const tableEl = document.getElementById('deftbody');
    const rows    = [['#','Name','Reg No','Class','Subject','Present','Total','%']];
    tableEl.querySelectorAll('tr').forEach(function(tr) {
      const cells = Array.from(tr.querySelectorAll('td')).map(function(td) { return td.textContent.trim(); });
      if (cells.length) rows.push(cells);
    });
    downloadCSV(rows, 'Defaulters_List');
    if (typeof dbToast === 'function') dbToast('<re-icon icon="download"></re-icon> Defaulters CSV downloaded!', 'success');
    else showToast('<re-icon icon="download"></re-icon> Downloaded!', 'success');
  }
  var exportDefCSV = exportDefaultersCSV;
  window.exportDefaultersCSV = exportDefaultersCSV;
  window.exportDefCSV = exportDefaultersCSV;

  function renderStudentList() {
    if (typeof updateStudentListSubtitle === 'function') updateStudentListSubtitle();
    const classFilter  = document.getElementById('slc') ? document.getElementById('slc').value : '';
    const searchQuery  = (document.getElementById('slq') ? document.getElementById('slq').value : '').toLowerCase();

    const myClassIds  = classFilter ? [classFilter] : getMyClasses().map(function(c) { return c.id; });
    var isHodOrPrincipal = !!(currentUser && (currentUser.isHOD || currentUser.isHod || currentUser.isPrincipal || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s && (s.option === 'isHod' || s.option === 'isPrincipal') && s.value !== false; }))));
    var hasAdminPrivileges = !!(currentUser && (currentUser.isSudoAdmin || currentUser.isSuperAdmin || currentUser.isSubAdmin || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s && s.option === 'isAdmin' && s.value !== false; }))));
    let students = classFilter
      ? DB.get('students').filter(function(s) { return String(s.classId) === String(classFilter); })
      : ((isHodOrPrincipal || hasAdminPrivileges)
          ? DB.get('students')
          : DB.get('students').filter(function(s) { return myClassIds.includes(s.classId); }));
    if (searchQuery) students = students.filter(function(s) {
      return String(s.name || s.fullName || '').toLowerCase().includes(searchQuery)
          || String(s.regNo || s.registerNo || '').toLowerCase().includes(searchQuery);
    });

    const tbody = document.getElementById('stutbody');
    if (!students.length) {
      tbody.innerHTML = '<tr><td colspan="' + (_activeRegisterTab === "forensic" ? 9 : 6) + '" style="text-align:center;padding:24px;color:var(--tdi);">No students found.</td></tr>';
      return;
    }

    students.sort(function(a, b) {
      return String(a.regNo || a.registerNo || '').localeCompare(String(b.regNo || b.registerNo || ''), undefined, { numeric: true });
    });

    if (_activeRegisterTab === 'forensic') {
      var allAttendance = (typeof DB !== 'undefined' && DB.get) ? (DB.get('attendance') || []) : [];
      var minAtt = (window._portalPolicy && window._portalPolicy.thresholds && window._portalPolicy.thresholds.minAttendance) || 75;
      var lowAtt = (window._portalPolicy && window._portalPolicy.thresholds && window._portalPolicy.thresholds.low) || 65;

      var safeCount = 0;
      var condCount = 0;
      var defCount = 0;

      tbody.innerHTML = students.map(function(student, index) {
        var sId = String(student._id || student.id || '');
        var sTrack = String(student.trackId || '');
        var sReg = String(student.regNo || student.registerNo || '');

        var stuRecords = allAttendance.filter(function(a) {
          return (a.studentId && String(a.studentId) === sId) ||
                 (a.studentTrackId && String(a.studentTrackId) === sTrack) ||
                 (a.regNo && String(a.regNo) === sReg);
        });

        var total = stuRecords.length;
        var present = stuRecords.filter(function(a) { return String(a.status || '').toLowerCase() === 'present'; }).length;
        var pct = total > 0 ? Math.round((present / total) * 100) : 100;

        var badgeClass = 'register-badge-safe';
        var statusLabel = 'Safe';
        var statusIcon = 'check';

        if (pct >= minAtt) {
          safeCount++;
          badgeClass = 'register-badge-safe';
          statusLabel = 'Safe';
          statusIcon = 'check';
        } else if (pct >= lowAtt) {
          condCount++;
          badgeClass = 'register-badge-condonation';
          statusLabel = 'Condonation';
          statusIcon = 'alert-circle';
        } else {
          defCount++;
          badgeClass = 'register-badge-defaulter';
          statusLabel = 'Defaulter';
          statusIcon = 'alert-triangle';
        }

        return '<tr>'
          + '<td>' + (index + 1) + '</td>'
          + '<td style="font-weight:700;font-family:monospace;color:var(--td);">' + escapeHtml(student.regNo || student.registerNo || '—') + '</td>'
          + '<td style="font-weight:600;">' + escapeHtml(student.name) + '</td>'
          + '<td style="color:var(--tmu);font-size:11.5px;">' + escapeHtml(student.rollNo || '—') + '</td>'
          + '<td>' + escapeHtml(student.className || '—') + '</td>'
          + '<td style="text-align:center;font-weight:600;">' + total + '</td>'
          + '<td style="text-align:center;color:var(--gK);font-weight:700;">' + present + '</td>'
          + '<td style="text-align:center;font-weight:800;color:' + (pct >= minAtt ? 'var(--gD)' : (pct >= lowAtt ? '#b45309' : '#dc2626')) + ';">' + pct + '%</td>'
          + '<td style="text-align:center;"><span class="' + badgeClass + '"><re-icon icon="' + statusIcon + '" size="12"></re-icon> ' + statusLabel + '</span></td>'
          + '</tr>';
      }).join('');

      var sTotal = document.getElementById('reg-stat-total'); if (sTotal) sTotal.textContent = students.length;
      var sSafe = document.getElementById('reg-stat-safe'); if (sSafe) sSafe.textContent = safeCount;
      var sCond = document.getElementById('reg-stat-cond'); if (sCond) sCond.textContent = condCount;
      var sDef = document.getElementById('reg-stat-def'); if (sDef) sDef.textContent = defCount;
    } else {
      tbody.innerHTML = students.map(function(student, index) {
        return '<tr>'
          + '<td>' + (index + 1) + '</td>'
          + '<td style="font-weight:700;font-family:monospace;color:var(--td);">' + escapeHtml(student.regNo || student.registerNo || '—') + '</td>'
          + '<td style="font-weight:600;">' + escapeHtml(student.name) + '</td>'
          + '<td>' + escapeHtml(student.className || '—') + '</td>'
          + '<td>' + escapeHtml(student.section || 'A') + '</td>'
          + '<td style="color:var(--tmu);">' + escapeHtml(student.deptName || '—') + '</td>'
          + '</tr>';
      }).join('');
    }
  }
  var renderStuList = renderStudentList;
  window.renderStudentList = renderStudentList;
  window.renderStuList = renderStudentList;

  function exportStudentCSV() {
    const tableEl = document.getElementById('stutbody');
    const rows    = [['#','Reg No','Name','Class','Section','Department']];
    tableEl.querySelectorAll('tr').forEach(function(tr) {
      const cells = Array.from(tr.querySelectorAll('td')).map(function(td) { return td.textContent.trim(); });
      if (cells.length) rows.push(cells);
    });
    downloadCSV(rows, 'Student_List');
    if (typeof dbToast === 'function') dbToast('<re-icon icon="download"></re-icon> Student List CSV downloaded!', 'success');
    else showToast('<re-icon icon="download"></re-icon> Downloaded!', 'success');
  }
  var exportStuCSV = exportStudentCSV;
  window.exportStudentCSV = exportStudentCSV;
  // ATTENDANCE INSIGHTS DASHBOARD (PLAN 1-5 ITEM 3)
  function initAttendanceInsights() {
    var classSelect = document.getElementById('ins-class');
    var subjSelect  = document.getElementById('ins-subject');
    if (!classSelect || !subjSelect) return;

    var assignments = getMyAssignments();
    var uniqueClasses = {};
    var uniqueSubjs   = {};

    assignments.forEach(function(a) {
      if (a.classId) uniqueClasses[a.classId] = a.className || a.classId;
      if (a.subjectId) uniqueSubjs[a.subjectId] = a.subjectName || a.subjectId;
    });

    var classOptions = '<option value="">All My Assigned Classes</option>';
    Object.keys(uniqueClasses).forEach(function(cid) {
      classOptions += '<option value="' + cid + '">' + uniqueClasses[cid] + '</option>';
    });
    classSelect.innerHTML = classOptions;

    var subjOptions = '<option value="">All Subjects</option>';
    Object.keys(uniqueSubjs).forEach(function(sid) {
      subjOptions += '<option value="' + sid + '">' + uniqueSubjs[sid] + '</option>';
    });
    subjSelect.innerHTML = subjOptions;

    renderAttendanceInsights();
  }
  window.initAttendanceInsights = initAttendanceInsights;

  function renderAttendanceInsights() {
    var classFilter = document.getElementById('ins-class') ? document.getElementById('ins-class').value : '';
    var subjFilter  = document.getElementById('ins-subject') ? document.getElementById('ins-subject').value : '';
    var rangeDays   = document.getElementById('ins-range') ? parseInt(document.getElementById('ins-range').value, 10) || 30 : 30;

    var dTo = new Date();
    var dFrom = new Date(Date.now() - rangeDays * 86400000);
    var fromStr = localISO(dFrom);
    var toStr = localISO(dTo);

    var tbodyAlerts = document.getElementById('ins-alerts-tbody');
    if (tbodyAlerts) tbodyAlerts.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--tdi);">Analyzing student patterns…</td></tr>';

    fetchAttendanceForReport(classFilter, subjFilter, fromStr, toStr)
      .then(function(attendance) {
        if (subjFilter) {
          attendance = attendance.filter(function(a) { return String(a.subjectId) === String(subjFilter); });
        }

        var totalMarks = attendance.length;
        var presentMarks = attendance.filter(function(a) { return a.status === 'present'; }).length;
        var avgPct = totalMarks ? Math.round((presentMarks / totalMarks) * 100) : 0;

        // Distinct session count (unique date + periodNumber + classId)
        var sessionMap = {};
        attendance.forEach(function(a) {
          var sKey = (a.date || '') + '_' + (a.periodNumber || 0) + '_' + (a.classId || '');
          sessionMap[sKey] = true;
        });
        var sessionCount = Object.keys(sessionMap).length;

        // Method-wise breakdown
        var methodCounts = { quickPass: 0, liveScan: 0, repShare: 0, manual: 0 };
        attendance.forEach(function(a) {
          var m = (a.method || '').toLowerCase();
          if (m.indexOf('quick') !== -1 || m === 'code') methodCounts.quickPass++;
          else if (m.indexOf('live') !== -1 || m.indexOf('qr') !== -1) methodCounts.liveScan++;
          else if (m.indexOf('rep') !== -1) methodCounts.repShare++;
          else methodCounts.manual++;
        });

        // Top Method
        var topMethod = 'Quick Pass';
        var topVal = methodCounts.quickPass;
        if (methodCounts.liveScan > topVal) { topMethod = 'Live Scan'; topVal = methodCounts.liveScan; }
        if (methodCounts.repShare > topVal) { topMethod = 'Rep Share'; topVal = methodCounts.repShare; }
        if (methodCounts.manual > topVal) { topMethod = 'Manual'; topVal = methodCounts.manual; }
        if (totalMarks === 0) topMethod = '—';

        // Period-wise performance (1 through 9)
        var periodStats = {};
        for (var p = 1; p <= 9; p++) {
          periodStats[p] = { total: 0, present: 0 };
        }
        attendance.forEach(function(a) {
          var pNum = parseInt(a.periodNumber, 10);
          if (pNum >= 1 && pNum <= 9) {
            periodStats[pNum].total++;
            if (a.status === 'present') periodStats[pNum].present++;
          }
        });

        // Student aggregation for Defaulters & Consecutive Absences
        var studentMap = {};
        var allStudents = DB.get('students');
        attendance.forEach(function(a) {
          var sid = String(a.studentId);
          if (!studentMap[sid]) {
            var stuObj = allStudents.find(function(s) { return String(s._id) === sid; });
            studentMap[sid] = {
              id: sid,
              name: a.studentName || (stuObj ? stuObj.name : 'Unknown'),
              regNo: a.regNo || (stuObj ? (stuObj.regNo || stuObj.registerNo || '') : ''),
              className: a.className || '',
              subjectName: a.subjectName || '',
              records: []
            };
          }
          studentMap[sid].records.push(a);
        });

        var minThreshold = (window._portalPolicy && window._portalPolicy.thresholds && window._portalPolicy.thresholds.minAttendance) || (window._pubSettings && window._pubSettings.academic ? (window._pubSettings.academic.minAttendance || 75) : 75);
        var defaulterCount = 0;
        var consecutiveAlerts = [];

        Object.values(studentMap).forEach(function(stu) {
          stu.records.sort(function(a, b) {
            var dateA = a.date || '';
            var dateB = b.date || '';
            return dateA.localeCompare(dateB) || ((a.periodNumber || 0) - (b.periodNumber || 0));
          });

          var total = stu.records.length;
          var pres = stu.records.filter(function(r) { return r.status === 'present'; }).length;
          var pct = total ? Math.round((pres / total) * 100) : 0;
          if (pct < minThreshold) defaulterCount++;

          var trailingAbsences = 0;
          var lastAttendDate = '—';
          for (var i = stu.records.length - 1; i >= 0; i--) {
            if (stu.records[i].status !== 'present') {
              trailingAbsences++;
            } else {
              if (lastAttendDate === '—') lastAttendDate = stu.records[i].date || '—';
              break;
            }
          }

          if (trailingAbsences >= 3) {
            consecutiveAlerts.push({
              name: stu.name,
              regNo: stu.regNo || '—',
              className: stu.className || '—',
              subjectName: stu.subjectName || '—',
              consecutive: trailingAbsences,
              pct: pct,
              lastAttended: lastAttendDate
            });
          }
        });

        // UPDATE KPI CARDS
        var elAvg = document.getElementById('ins-kpi-avg');
        var elDef = document.getElementById('ins-kpi-defaulters');
        var elSes = document.getElementById('ins-kpi-sessions');
        var elMet = document.getElementById('ins-kpi-method');

        if (elAvg) elAvg.textContent = avgPct + '%';
        if (elDef) elDef.textContent = defaulterCount;
        if (elSes) elSes.textContent = sessionCount;
        if (elMet) elMet.textContent = topMethod;

        // RENDER METHOD PROGRESS BARS
        var barsEl = document.getElementById('ins-method-bars');
        if (barsEl) {
          var methods = [
            { label: 'Quick Pass (12-Char Code)', count: methodCounts.quickPass, color: '#3b82f6', bg: '#eff6ff' },
            { label: 'Live Scan / QR (7-Layer)',  count: methodCounts.liveScan,  color: '#10b981', bg: '#ecfdf5' },
            { label: 'Rep Share (Class Rep)',     count: methodCounts.repShare,  color: '#8b5cf6', bg: '#f5f3ff' },
            { label: 'Manual Teacher Marking',    count: methodCounts.manual,    color: '#f59e0b', bg: '#fffbeb' }
          ];

          barsEl.innerHTML = methods.map(function(m) {
            var mPct = totalMarks ? Math.round((m.count / totalMarks) * 100) : 0;
            return '<div style="margin-bottom:4px;">'
              + '<div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:600;margin-bottom:4px;">'
              + '  <span style="color:var(--td);">' + m.label + '</span>'
              + '  <span style="color:var(--tmu);">' + m.count + ' records (' + mPct + '%)</span>'
              + '</div>'
              + '<div style="width:100%;height:8px;background:' + m.bg + ';border-radius:6px;overflow:hidden;border:1px solid rgba(0,0,0,.06);">'
              + '  <div style="width:' + mPct + '%;height:100%;background:' + m.color + ';border-radius:6px;transition:width .4s ease;"></div>'
              + '</div>'
              + '</div>';
          }).join('');
        }

        // RENDER PERIOD-WISE CHART
        var chartEl = document.getElementById('ins-period-chart');
        if (chartEl) {
          var pEntries = [];
          var lowestPeriod = null;
          var lowestPct = 101;

          for (var p = 1; p <= 9; p++) {
            var pData = periodStats[p];
            var pPct = pData.total ? Math.round((pData.present / pData.total) * 100) : 0;
            if (pData.total > 0 && pPct < lowestPct) {
              lowestPct = pPct;
              lowestPeriod = p;
            }
            var barHeight = Math.max(8, Math.round((pPct / 100) * 110));
            var barColor = pPct >= 80 ? '#10b981' : (pPct >= 65 ? '#3b82f6' : '#ef4444');
            pEntries.push(
              '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;" title="Period ' + p + ': ' + pPct + '% attendance (' + pData.present + '/' + pData.total + ')">'
              + '<div style="font-size:11px;font-weight:700;color:var(--tmu);">' + (pData.total ? pPct + '%' : '—') + '</div>'
              + '<div style="width:100%;max-width:28px;height:' + barHeight + 'px;background:' + (pData.total ? barColor : 'var(--brl)') + ';border-radius:4px 4px 0 0;transition:height .3s ease;"></div>'
              + '<div style="font-size:11px;font-weight:700;color:var(--td);margin-top:2px;">P' + p + '</div>'
              + '</div>'
            );
          }
          chartEl.innerHTML = pEntries.join('');

          var insightEl = document.getElementById('ins-period-insight');
          if (insightEl) {
            insightEl.textContent = lowestPeriod
              ? '<re-icon icon="alert-triangle"></re-icon> Lowest turnout detected in Period ' + lowestPeriod + ' (' + lowestPct + '% average). Consider scheduling interactive sessions earlier.'
              : 'Consistent attendance distribution across teaching periods.';
          }
        }

        // RENDER CONSECUTIVE ABSENCES ALERTS
        var countEl = document.getElementById('ins-alerts-count');
        if (countEl) countEl.textContent = consecutiveAlerts.length + ' Alerts';

        if (tbodyAlerts) {
          if (consecutiveAlerts.length === 0) {
            tbodyAlerts.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:#10b981;font-weight:600;"><re-icon icon="check"></re-icon> No consecutive absence patterns detected in this timeframe!</td></tr>';
          } else {
            consecutiveAlerts.sort(function(a, b) { return b.consecutive - a.consecutive; });
            tbodyAlerts.innerHTML = consecutiveAlerts.map(function(item) {
              return '<tr>'
                + '<td style="font-weight:700;color:var(--td);">' + escapeHtml(item.name) + '</td>'
                + '<td style="font-family:monospace;font-weight:600;">' + escapeHtml(item.regNo) + '</td>'
                + '<td>' + escapeHtml(item.className) + '</td>'
                + '<td>' + escapeHtml(item.subjectName) + '</td>'
                + '<td><span class="badge" style="background:#fee2e2;color:#dc2626;font-weight:800;padding:3px 8px;border-radius:8px;">' + (Number(item.consecutive) || 0) + ' consecutive absent</span></td>'
                + '<td><span class="pb ' + (item.pct < 50 ? 'pl' : 'pm') + '">' + (Number(item.pct) || 0) + '%</span></td>'
                + '<td style="font-size:11.5px;color:var(--tmu);">' + escapeHtml(item.lastAttended || '—') + '</td>'
                + '</tr>';
            }).join('');
          }
        }
      })
      .catch(function(err) {
        if (tbodyAlerts) tbodyAlerts.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#dc2626;">Failed to load insights: ' + escapeHtml(err && err.message ? err.message : 'Unknown error') + '</td></tr>';
      });
  }
  window.renderAttendanceInsights = renderAttendanceInsights;

  function exportAttendanceInsightsPDF() {
    window.print();
  }
  window.exportAttendanceInsightsPDF = exportAttendanceInsightsPDF;

  // ─── TEACHER GRIEVANCES (UPGRADED) ──────────────────────────────────
  let _teacherGrievancesList = [];
  let _teacherGrievFilterStatus = 'all';
  let _teacherGrievSearchQuery = '';

  function renderGrievances() {
    const containerEl = document.getElementById('grievlist');
    if (!containerEl) return;
    containerEl.innerHTML = '<div class="est"><span class="ei"><re-icon icon="clock"></re-icon></span><p style="font-size:12px;">Loading grievances…</p></div>';
    api('/api/grievances', { headers: authHeaders() })
      .then(function(r) { return r.json().catch(function() { return []; }).then(function(d) { return r.ok && Array.isArray(d) ? d : []; }); })
      .then(function(rows) {
        _teacherGrievancesList = rows;
        DB.set('teacher-grievances', rows);
        updateTeacherGrievanceStats();
        paintGrievances();
      })
      .catch(function() {
        _teacherGrievancesList = DB.get('teacher-grievances') || [];
        updateTeacherGrievanceStats();
        paintGrievances();
      });
  }

  function updateTeacherGrievanceStats() {
    const total = _teacherGrievancesList.length;
    const pending = _teacherGrievancesList.filter(function(g) { return g.status === 'Pending' || g.status === 'In Progress'; }).length;
    const resolved = _teacherGrievancesList.filter(function(g) { return g.status === 'Resolved'; }).length;

    if (document.getElementById('griev-stat-total')) document.getElementById('griev-stat-total').textContent = total;
    if (document.getElementById('griev-stat-pending')) document.getElementById('griev-stat-pending').textContent = pending;
    if (document.getElementById('griev-stat-resolved')) document.getElementById('griev-stat-resolved').textContent = resolved;
  }

  function filterTeacherGrievances(status) {
    _teacherGrievFilterStatus = status || 'all';
    document.querySelectorAll('.griev-filter-pill').forEach(function(pill) {
      if (pill.getAttribute('data-status') === _teacherGrievFilterStatus) {
        pill.classList.add('act');
      } else {
        pill.classList.remove('act');
      }
    });
    paintGrievances();
  }
  window.filterTeacherGrievances = filterTeacherGrievances;

  function searchTeacherGrievances(val) {
    _teacherGrievSearchQuery = (val || '').toLowerCase().trim();
    paintGrievances();
  }
  window.searchTeacherGrievances = searchTeacherGrievances;

  function paintGrievances() {
    const containerEl = document.getElementById('grievlist');
    if (!containerEl) return;

    let filtered = _teacherGrievancesList.slice();
    if (_teacherGrievFilterStatus && _teacherGrievFilterStatus !== 'all') {
      filtered = filtered.filter(function(g) { return g.status === _teacherGrievFilterStatus; });
    }
    if (_teacherGrievSearchQuery) {
      filtered = filtered.filter(function(g) {
        return (g.subject && g.subject.toLowerCase().includes(_teacherGrievSearchQuery)) ||
               (g.detail && g.detail.toLowerCase().includes(_teacherGrievSearchQuery)) ||
               (g.category && g.category.toLowerCase().includes(_teacherGrievSearchQuery));
      });
    }

    if (!filtered.length) {
      containerEl.innerHTML = '<div class="est"><span class="ei"><re-icon icon="pin"></re-icon></span><p style="font-size:12px;">'
        + (_teacherGrievancesList.length ? 'No grievances match your search or filter.' : 'No grievances raised yet.')
        + '</p></div>';
      return;
    }

    containerEl.innerHTML = filtered.map(function(grievance) {
      const isResolved   = grievance.status === 'Resolved';
      const isCancelled  = grievance.status === 'Cancelled';
      const isInProgress = grievance.status === 'In Progress';
      const iconCode     = isResolved ? '<re-icon icon="check-circle"></re-icon>' : isCancelled ? '<re-icon icon="x-circle"></re-icon>' : isInProgress ? '<re-icon icon="refresh"></re-icon>' : '<re-icon icon="bell"></re-icon>';
      const icClass      = isResolved ? 'res' : (isCancelled ? 'spend' : 'pend');
      const pillClass    = isResolved ? 'sres' : 'spend';
      const pillStyle    = isCancelled ? 'style="background:#fef2f2;color:#dc2626;border-color:rgba(239,68,68,.3);"'
                         : (isInProgress ? 'style="background:#eff6ff;color:#2563eb;border-color:rgba(37,99,235,.3);"' : '');

      const priorityBadge = grievance.priority && grievance.priority !== 'Normal'
        ? '<span style="font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;background:' + (grievance.priority === 'Urgent' ? '#fee2e2;color:#b91c1c;' : '#fef3c7;color:#b45309;') + '">' + escapeHtml(grievance.priority) + '</span>'
        : '';

      let statusNote = '';
      if (isResolved) {
        statusNote = '<div style="margin-top:8px;font-size:11px;color:var(--gD);background:var(--gLt);padding:8px 12px;border-radius:8px;display:flex;flex-direction:column;gap:3px;border:1px solid rgba(16,185,129,.2);">'
          + '<div style="display:flex;align-items:center;gap:6px;font-weight:700;"><re-icon icon="check-circle" size="14"></re-icon> Resolved by ' + escapeHtml(grievance.resolvedBy || 'Admin')
          + (grievance.resolvedAt ? ' &nbsp;·&nbsp; ' + new Date(grievance.resolvedAt).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'}) : '')
          + '</div>'
          + (grievance.resolutionNote ? '<div style="color:var(--td);font-size:11.5px;margin-top:2px;font-style:italic;">“' + escapeHtml(grievance.resolutionNote) + '”</div>' : '')
          + '</div>';
      } else if (isCancelled) {
        statusNote = '<div style="margin-top:8px;font-size:11px;color:#dc2626;background:#fef2f2;padding:8px 12px;border-radius:8px;border:1px solid rgba(239,68,68,.2);">'
          + '<re-icon icon="x-circle" size="14"></re-icon> <strong>Declined by Admin</strong>'
          + (grievance.resolutionNote ? '<div style="margin-top:2px;color:#7f1d1d;">' + escapeHtml(grievance.resolutionNote) + '</div>' : '')
          + '</div>';
      } else if (isInProgress) {
        statusNote = '<div style="margin-top:8px;font-size:11px;color:#2563eb;background:#eff6ff;padding:8px 12px;border-radius:8px;border:1px solid rgba(37,99,235,.2);display:flex;align-items:center;gap:6px;">'
          + '<re-icon icon="refresh" size="14"></re-icon> <span>Admin is currently working on your request.</span>'
          + '</div>';
      } else {
        statusNote = '<div style="margin-top:8px;font-size:11px;color:#92400e;background:#fef3c7;padding:6px 10px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;">'
          + '<re-icon icon="clock"></re-icon> Awaiting admin review'
          + '</div>';
      }

      return '<div class="gcard" style="margin-bottom:12px;">'
        + '<div class="gic ' + icClass + '">' + iconCode + '</div>'
        + '<div style="flex:1;">'
        + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">'
        + '<div style="font-size:13.5px;font-weight:700;color:var(--td);">' + escapeHtml(grievance.subject) + '</div>'
        + '<span class="spill ' + pillClass + '" ' + pillStyle + '>' + escapeHtml(grievance.status) + '</span>'
        + '<span class="bge">' + escapeHtml(grievance.category) + '</span>'
        + priorityBadge
        + '</div>'
        + '<div style="font-size:12px;color:var(--tmu);line-height:1.5;">' + escapeHtml(grievance.detail) + '</div>'
        + '<div style="font-size:11px;color:var(--tdi);margin-top:6px;">' + formatDateLong(grievance.createdAt) + ' · Ticket filed</div>'
        + statusNote
        + '</div></div>';
    }).join('');
  }
  window.paintGrievances = paintGrievances;
  window.renderGrievances = renderGrievances;
  var renderGrievs = renderGrievances;

  function submitGrievance() {
    const subject    = (document.getElementById('gsubj')   ? document.getElementById('gsubj').value   : '').trim();
    const category   = document.getElementById('gcat')     ? document.getElementById('gcat').value    : 'Other';
    const detail     = (document.getElementById('gdetail') ? document.getElementById('gdetail').value : '').trim();
    const priority   = document.getElementById('gpriority') ? document.getElementById('gpriority').value : 'Normal';

    if (!subject || !detail) { showToast('Please fill title and details', 'warn'); return; }

    showToast('Submitting grievance…', 'saving');
    api('/api/grievances', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ subject: subject, category: category, detail: detail, priority: priority })
    })
    .then(function(r) {
      return r.json().catch(function() { return {}; }).then(function(body) {
        if (!r.ok || (body && body.error)) throw new Error((body && body.error) || ('Server error ' + r.status));
        return body;
      });
    })
    .then(function() {
      if (document.getElementById('gsubj')) document.getElementById('gsubj').value   = '';
      if (document.getElementById('gdetail')) document.getElementById('gdetail').value = '';
      closeModal('mgriev');
      showToast('<re-icon icon="check"></re-icon> Grievance submitted successfully!', 'success');
      renderGrievances();
    })
    .catch(function(err) {
      showToast('Could not submit grievance: ' + err.message, 'error');
    });
  }
  window.submitGrievance = submitGrievance;
  var submitGriev = submitGrievance;

  // ─── TEACHER ON-DUTY (OD) APPROVAL SUITE ────────────────────────────
  let _teacherODData = { pending: [], verify: [], history: [] };
  let _activeODReview = null;
  let _activeODVerify = null;

  function loadTeacherODData() {
    const tbodyPending = document.getElementById('od-pending-tbody');
    const tbodyVerify  = document.getElementById('od-verify-tbody');
    const tbodyHistory = document.getElementById('od-history-tbody');
    if (tbodyPending) tbodyPending.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--tdi);"><span class="spin"></span> Loading pending OD approvals…</td></tr>';
    if (tbodyVerify)  tbodyVerify.innerHTML  = '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--tdi);"><span class="spin"></span> Loading outcome verification queue…</td></tr>';
    if (tbodyHistory) tbodyHistory.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--tdi);"><span class="spin"></span> Loading OD history…</td></tr>';

    api('/api/od/pending?type=all', { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (!res.ok) throw new Error(res.error || 'Failed to load OD data');
        _teacherODData.pending = Array.isArray(res.pending) ? res.pending : (Array.isArray(res.requests) ? res.requests : []);
        _teacherODData.verify  = Array.isArray(res.verify)  ? res.verify  : [];
        _teacherODData.history = Array.isArray(res.history) ? res.history : [];

        // KPI Counts
        const pendingCount = _teacherODData.pending.length;
        const verifyCount  = _teacherODData.verify.length;
        const approvedCount = res.counts ? res.counts.approved : _teacherODData.history.filter(function(r) { return r.status === 'approved' || r.status === 'completed'; }).length;
        const totalCount   = res.counts ? res.counts.total : (pendingCount + verifyCount + _teacherODData.history.length);

        if (document.getElementById('od-kpi-pending'))  document.getElementById('od-kpi-pending').textContent  = pendingCount;
        if (document.getElementById('od-kpi-verify'))   document.getElementById('od-kpi-verify').textContent   = verifyCount;
        if (document.getElementById('od-kpi-approved')) document.getElementById('od-kpi-approved').textContent = approvedCount;
        if (document.getElementById('od-kpi-total'))    document.getElementById('od-kpi-total').textContent    = totalCount;

        // Subtab badges
        const bPending = document.getElementById('badge-tab-od-pending');
        if (bPending) {
          bPending.textContent = pendingCount;
          bPending.style.display = pendingCount > 0 ? 'inline-block' : 'none';
        }
        const bVerify = document.getElementById('badge-tab-od-verify');
        if (bVerify) {
          bVerify.textContent = verifyCount;
          bVerify.style.display = verifyCount > 0 ? 'inline-block' : 'none';
        }

        // Sidebar badge on sn-od
        const totalActionRequired = pendingCount + verifyCount;
        const snOdBadge = document.getElementById('sn-od-badge');
        if (snOdBadge) {
          snOdBadge.textContent = totalActionRequired;
          snOdBadge.style.display = totalActionRequired > 0 ? 'inline-block' : 'none';
        }

        renderTeacherODPendingTable();
        renderTeacherODVerifyTable();
        renderTeacherODHistoryTable();
      })
      .catch(function(err) {
        console.error('[Load Teacher OD Error]:', err);
        if (tbodyPending) tbodyPending.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:#ef4444;">Failed to load OD approvals.</td></tr>';
      });
  }
  window.loadTeacherODData = loadTeacherODData;

  function switchTeacherODTab(tabName) {
    const tabs = ['pending', 'verify', 'history'];
    tabs.forEach(function(t) {
      const btn  = document.getElementById('tab-od-' + t);
      const cont = document.getElementById('cont-od-' + t);
      if (btn) {
        if (t === tabName) btn.classList.add('act');
        else btn.classList.remove('act');
      }
      if (cont) {
        cont.style.display = (t === tabName) ? 'block' : 'none';
      }
    });
  }
  window.switchTeacherODTab = switchTeacherODTab;

  var _leaveSortAsc = false;
  var _odSortAsc = false;

  function toggleLeaveSort() {
    _leaveSortAsc = !_leaveSortAsc;
    var icon = document.querySelector('#lh-table-body')?.closest('table')?.querySelector('.apr-sort re-icon');
    if (icon) icon.setAttribute('icon', _leaveSortAsc ? 'arrow-up' : 'arrow-down');
    filterTeacherLeaveTable();
  }
  window.toggleLeaveSort = toggleLeaveSort;

  function toggleODSort() {
    _odSortAsc = !_odSortAsc;
    var icon = document.querySelector('#od-pending-tbody')?.closest('table')?.querySelector('.apr-sort re-icon');
    if (icon) icon.setAttribute('icon', _odSortAsc ? 'arrow-up' : 'arrow-down');
    renderTeacherODPendingTable();
  }
  window.toggleODSort = toggleODSort;

  function renderTeacherODPendingTable() {
    const tbody = document.getElementById('od-pending-tbody');
    if (!tbody) return;
    let list = (_teacherODData.pending || []).slice();
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--tdi);"><re-icon icon="check-circle" size="24" style="display:block;margin:0 auto 8px;color:#10b981;"></re-icon>All caught up! No OD requests currently awaiting your approval.</td></tr>';
      return;
    }

    list.sort(function(a, b) {
      var da = new Date(a.createdAt || 0).getTime();
      var db = new Date(b.createdAt || 0).getTime();
      return _odSortAsc ? da - db : db - da;
    });

    var isHod = !!(currentUser && (currentUser.isHOD || currentUser.isHod));

    tbody.innerHTML = list.map(function(r) {
      var reqId = r._id || r.requestId;
      var eventTitle = (r.eventDetails && r.eventDetails.name) || r.eventName || 'Academic Event';
      var daysCount = Array.isArray(r.dates) ? r.dates.length : 1;
      var stageBg = '#fef3c7'; var stageColor = '#b45309';
      var stageLabel = r.currentStage ? (r.currentStage.charAt(0).toUpperCase() + r.currentStage.slice(1)) : 'Pending';
      var statusBadge = '<span style="background:' + stageBg + ';color:' + stageColor + ';font-size:11px;font-weight:800;padding:3px 9px;border-radius:8px;">' + escapeHtml(stageLabel) + '</span>';

      var trackerHtml = '';
      if (r.tracker && window.EamsTracker) trackerHtml = '<div style="margin-top:4px;">' + EamsTracker.pill(r.tracker) + '</div>';

      var actionHtml;
      if (isHod && r.currentStage === 'hod') {
        actionHtml = '<div style="display:flex;gap:6px;flex-wrap:nowrap;">'
          + '<button class="btn-form-pri bsm" onclick="hodQuickApproveOD(\'' + reqId + '\')" style="padding:4px 10px;font-size:11px;background:#16a34a;"><re-icon icon="check" size="12"></re-icon> Approve</button>'
          + '<button class="btn-out bsm" onclick="hodQuickRejectOD(\'' + reqId + '\')" style="padding:4px 10px;font-size:11px;color:#dc2626;border-color:#fca5a5;"><re-icon icon="x" size="12"></re-icon> Reject</button>'
          + '</div>';
      } else {
        actionHtml = '<button class="btn-pri bxs" onclick="openODStageReviewModal(\'' + reqId + '\')" style="background:#0284c7;color:#fff;display:inline-flex;align-items:center;gap:4px;"><re-icon icon="clipboard-check" size="13"></re-icon> Review</button>';
      }

      return '<tr>'
        + '<td><span style="font-weight:600;color:var(--td);">' + (r.createdAt ? formatDDMMYYYY(r.createdAt) : '—') + '</span></td>'
        + '<td style="font-size:11.5px;font-weight:600;color:var(--td);white-space:nowrap;">' + escapeHtml(r.studentRegNo || '—') + '</td>'
        + '<td><strong>' + escapeHtml(r.studentName || 'Student') + '</strong></td>'
        + '<td><span style="background:#e0f2fe;color:#0369a1;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;"><re-icon icon="briefcase" size="11"></re-icon> ' + escapeHtml(eventTitle) + '</span></td>'
        + '<td><span style="font-weight:700;">' + daysCount + '</span></td>'
        + '<td>' + statusBadge + trackerHtml + '</td>'
        + '<td>' + actionHtml + '</td>'
        + '</tr>';
    }).join('');
  }

  function renderTeacherODVerifyTable() {
    const tbody = document.getElementById('od-verify-tbody');
    if (!tbody) return;
    const list = _teacherODData.verify || [];
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--tdi);"><re-icon icon="trophy" size="24" style="display:block;margin:0 auto 8px;color:#8b5cf6;"></re-icon>No completed ODs awaiting outcome evidence verification.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function(r) {
      const completedOn = r.outcome && r.outcome.submittedAt ? formatDDMMYYYY(r.outcome.submittedAt) : '—';
      const eventTitle  = (r.eventDetails && r.eventDetails.name) || r.eventName || 'Event';
      const outcomeText = (r.outcome && r.outcome.primaryOutcome) || 'Participated';
      const evObj       = (r.outcome && r.outcome.evidence) || {};
      const evLink      = isSafeHttpsUrl(evObj.webViewLink) ? '<a href="' + escapeHtml(evObj.webViewLink) + '" target="_blank" rel="noopener noreferrer" style="color:#0284c7;font-weight:600;"><re-icon icon="external-link" size="13"></re-icon> Document</a>' : '<span style="color:var(--tdi);">Uploaded</span>';
      const isDup       = !!(r.verification && r.verification.duplicateFlag);

      return '<tr>'
        + '<td>' + completedOn + '</td>'
        + '<td><div style="font-weight:700;color:var(--td);">' + escapeHtml(r.studentName) + '</div><div style="font-size:11px;color:var(--tmu);">' + escapeHtml(r.studentRegNo || '') + '</div></td>'
        + '<td><span style="font-weight:600;">' + escapeHtml(eventTitle) + '</span></td>'
        + '<td><span class="badge" style="background:#ecfdf5;color:#065f46;font-weight:700;">' + escapeHtml(outcomeText) + '</span></td>'
        + '<td>1 Certificate</td>'
        + '<td>' + evLink + '</td>'
        + '<td>' + (isDup ? '<span style="color:#dc2626;font-weight:700;font-size:11px;"><re-icon icon="alert-triangle"></re-icon> Duplicate MD5</span>' : '<span style="color:#16a34a;font-size:11px;">Verified Clean</span>') + '</td>'
        + '<td><button class="btn-pri bxs" onclick="openODOutcomeVerifyModal(\'' + (r._id || r.requestId) + '\')" style="background:#8b5cf6;"><re-icon icon="check" size="13"></re-icon> Inspect &amp; Verify</button></td>'
        + '</tr>';
    }).join('');
  }

  function renderTeacherODHistoryTable() {
    const tbody = document.getElementById('od-history-tbody');
    if (!tbody) return;
    const list = _teacherODData.history || [];
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:36px;color:var(--tdi);">No completed or approved OD records in history.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function(r) {
      const datesStr = Array.isArray(r.dates) && r.dates.length ? (formatDDMMYYYY(r.dates[0]) + (r.dates.length > 1 ? ' (' + r.dates.length + 'd)' : '')) : '—';
      const eventTitle = (r.eventDetails && r.eventDetails.name) || r.eventName || 'Event';
      const statusPill = r.status === 'completed'
        ? '<span class="badge" style="background:#ecfdf5;color:#065f46;font-weight:700;">Completed &amp; Verified</span>'
        : (r.status === 'approved' ? '<span class="badge" style="background:#eff6ff;color:#1e40af;font-weight:700;">Approved</span>'
        : '<span class="badge" style="background:#fef2f2;color:#991b1b;font-weight:700;">Rejected</span>');

      const outcomeStatus = (r.verification && r.verification.status === 'verified')
        ? '<span style="color:#16a34a;font-weight:600;"><re-icon icon="check-circle" size="12"></re-icon> Verified</span>'
        : ((r.outcome && r.outcome.primaryOutcome) ? '<span style="color:#f59e0b;font-weight:600;">Pending Review</span>' : '<span style="color:var(--tdi);">Awaiting Submission</span>');

      return '<tr>'
        + '<td><code>' + escapeHtml(r.requestId || '—') + '</code></td>'
        + '<td>' + (r.createdAt ? formatDDMMYYYY(r.createdAt) : '—') + '</td>'
        + '<td><div style="font-weight:700;">' + escapeHtml(r.studentName) + '</div><div style="font-size:11px;color:var(--tmu);">' + escapeHtml(r.studentRegNo || '') + '</div></td>'
        + '<td>' + escapeHtml(eventTitle) + '</td>'
        + '<td>' + escapeHtml(datesStr) + '</td>'
        + '<td>' + escapeHtml(r.mentorName || '—') + '</td>'
        + '<td>' + statusPill + '</td>'
        + '<td>' + outcomeStatus + '</td>'
        + '<td><button type="button" class="btn-out bxs" onclick="openODStageReviewModal(\'' + String(r._id || r.requestId || r.trackId || '').replace(/'/g, "\\'") + '\')" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;"><re-icon icon="eye" size="13"></re-icon> View</button></td>'
        + '</tr>';
    }).join('');
  }

  function openODStageReviewModal(id) {
    if (!id) return;

    var statsGrid = document.getElementById('odr-stats-grid');
    if (statsGrid) {
      var pctEl = document.getElementById('odr-stat-pct');
      if (pctEl) pctEl.textContent = '—%';
      var leavesEl = document.getElementById('odr-stat-leaves');
      if (leavesEl) leavesEl.textContent = '—';
      var odEl = document.getElementById('odr-stat-od');
      if (odEl) odEl.textContent = '—';
    }
    var trackerPanel = document.getElementById('odr-tracker-panel');
    if (trackerPanel) trackerPanel.innerHTML = '<div style="padding:12px;text-align:center;color:var(--tdi);font-size:12px;"><span class="spin"></span> Loading workflow tracker…</div>';
    var histSection = document.getElementById('odr-history-section');
    if (histSection) histSection.style.display = 'none';

    // Outcome block reset
    var outBlock = document.getElementById('odr-outcome-details');
    if (outBlock) outBlock.style.display = 'none';

    const formatODDateRange = function(dates) {
      if (!Array.isArray(dates) || !dates.length) return '—';
      if (dates.length === 1) {
        return formatDDMMYYYY(dates[0]);
      }
      var sorted = dates.slice().sort();
      var first = sorted[0];
      var last = sorted[sorted.length - 1];
      return formatDDMMYYYY(first) + ' – ' + formatDDMMYYYY(last);
    };

    const populateModal = function(r, extra) {
      if (!r) return;
      _activeODReview = r;

      var titleEl = document.getElementById('odr-modal-title');
      var decided = r.status === 'approved' || r.status === 'completed' || r.status === 'rejected' || r.status === 'returned';

      if (titleEl) {
        titleEl.textContent = decided ? 'View Student OD Details' : 'Review Student OD Request';
      }

      var subEl = document.getElementById('odr-student-sub');
      if (subEl) {
        subEl.textContent = (r.studentName || 'Student') + ' · ' + (r.studentRegNo || '') + (r.className ? ' (' + r.className + ')' : '');
      }

      var nameEl = document.getElementById('odr-student-name');
      if (nameEl) nameEl.textContent = r.studentName || '—';

      var regEl = document.getElementById('odr-student-reg');
      if (regEl) regEl.textContent = (r.studentRegNo || '') + (r.className ? ' (' + r.className + ')' : '');

      var evTitleEl = document.getElementById('odr-event-title');
      if (evTitleEl) evTitleEl.textContent = (r.eventDetails && r.eventDetails.name) || r.eventName || '—';

      var lvl = (r.eventDetails && r.eventDetails.level) || 'Inter-Collegiate';
      lvl = lvl.charAt(0).toUpperCase() + lvl.slice(1);
      var typ = (r.eventDetails && r.eventDetails.type) || 'Academic';
      typ = typ.charAt(0).toUpperCase() + typ.slice(1);
      var lvlEl = document.getElementById('odr-event-level');
      if (lvlEl) lvlEl.textContent = lvl + ' · ' + typ;

      var daysCount = Array.isArray(r.dates) ? r.dates.length : (r.daysCount || 1);
      var datesStr = formatODDateRange(r.dates) + ' (' + daysCount + ' ' + (daysCount === 1 ? 'Day' : 'Days') + ')';
      var datesEl = document.getElementById('odr-dates');
      if (datesEl) {
        datesEl.textContent = datesStr;
        if (Array.isArray(r.dates) && r.dates.length > 1) datesEl.title = r.dates.map(formatDDMMYYYY).join(', ');
      }
      var daysCountEl = document.getElementById('odr-days-count');
      if (daysCountEl) daysCountEl.textContent = daysCount + ' ' + (daysCount === 1 ? 'Day' : 'Days');

      var covEl = document.getElementById('odr-coverage');
      if (covEl) covEl.textContent = r.coverage === 'full_day' ? 'Full Day' : (r.coverage || 'OD');

      var evEl = document.getElementById('odr-evidence-link');
      if (evEl) {
        if (Array.isArray(r.evidenceAtRequest) && r.evidenceAtRequest.length && isSafeHttpsUrl(r.evidenceAtRequest[0].webViewLink)) {
          evEl.innerHTML = '<a href="' + escapeHtml(r.evidenceAtRequest[0].webViewLink) + '" target="_blank" rel="noopener noreferrer" style="color:#0284c7;font-weight:700;display:inline-flex;align-items:center;gap:4px;"><re-icon icon="external-link" size="13"></re-icon> Open Attached Document</a>';
        } else {
          evEl.textContent = 'No document attached';
        }
      }

      var reasonEl = document.getElementById('odr-reason');
      if (reasonEl) reasonEl.textContent = (r.eventDetails && r.eventDetails.description) || r.reason || '—';

      var remarksInp = document.getElementById('odr-remarks');
      if (remarksInp) remarksInp.value = '';

      // Outcome Section if submitted
      var outcomeBlock = document.getElementById('odr-outcome-details');
      if (outcomeBlock) {
        if (r.outcome && r.outcome.primaryOutcome) {
          outcomeBlock.style.display = 'block';
          var outPrimary = document.getElementById('odr-outcome-primary');
          if (outPrimary) outPrimary.textContent = r.outcome.primaryOutcome;
          var outCerts = document.getElementById('odr-outcome-certs');
          if (outCerts) outCerts.textContent = (r.outcome.certificatesCount || 1) + ' Certificate(s)';
          var outEvLink = document.getElementById('odr-outcome-evidence-link');
          if (outEvLink) {
            var outDoc = (r.outcome.evidence && r.outcome.evidence.webViewLink) ? r.outcome.evidence.webViewLink : (r.evidenceAtRequest && r.evidenceAtRequest[0] ? r.evidenceAtRequest[0].webViewLink : null);
            if (isSafeHttpsUrl(outDoc)) {
              outEvLink.innerHTML = '<a href="' + escapeHtml(outDoc) + '" target="_blank" rel="noopener noreferrer" style="color:#166534;font-weight:700;display:inline-flex;align-items:center;gap:4px;"><re-icon icon="external-link" size="13"></re-icon> View Certificate Evidence</a>';
            } else {
              outEvLink.textContent = 'Evidence uploaded';
            }
          }
        } else {
          outcomeBlock.style.display = 'none';
        }
      }

      // Configure Action Buttons & Remarks Section
      var remarksSection = document.getElementById('odr-remarks-section');
      var btnReject = document.getElementById('btn-odr-reject');
      var btnReturn = document.getElementById('btn-odr-return');
      var btnPrin = document.getElementById('btn-odr-principal');
      var btnApprove = document.getElementById('btn-odr-approve');
      var btnCancel = document.getElementById('btn-odr-cancel');
      var btnClose = document.getElementById('btn-odr-close');

      if (decided) {
        if (remarksSection) remarksSection.style.display = 'none';
        if (btnReject) btnReject.style.display = 'none';
        if (btnReturn) btnReturn.style.display = 'none';
        if (btnPrin) btnPrin.style.display = 'none';
        if (btnApprove) btnApprove.style.display = 'none';
        if (btnCancel) btnCancel.style.display = 'none';
        if (btnClose) btnClose.style.display = 'inline-flex';
      } else {
        if (remarksSection) remarksSection.style.display = '';
        if (btnReject) btnReject.style.display = 'inline-flex';
        if (btnReturn) btnReturn.style.display = 'inline-flex';
        if (btnPrin) btnPrin.style.display = (r.currentStage === 'hod') ? 'inline-flex' : 'none';
        if (btnApprove) btnApprove.style.display = 'inline-flex';
        if (btnCancel) btnCancel.style.display = 'inline-flex';
        if (btnClose) btnClose.style.display = 'none';
      }

      // Handle extra payload from server (tracker, student summary)
      if (extra) {
        if (extra.summary && statsGrid) {
          var pctVal = extra.summary.attendancePercent !== undefined ? extra.summary.attendancePercent : (extra.summary.attendance ? extra.summary.attendance.overallPercentage : '—');
          var pctEl = document.getElementById('odr-stat-pct');
          if (pctEl) {
            pctEl.textContent = (typeof pctVal === 'number' ? pctVal + '%' : pctVal);
            if (typeof pctVal === 'number') pctEl.style.color = pctVal >= 75 ? 'var(--gD)' : '#dc2626';
          }
          var leavesEl = document.getElementById('odr-stat-leaves');
          if (leavesEl) {
            leavesEl.textContent = extra.summary.leavesTaken !== undefined ? extra.summary.leavesTaken : (extra.summary.totals ? (extra.summary.totals.leaveDays + extra.summary.totals.permissionDays) : '—');
          }
          var odEl = document.getElementById('odr-stat-od');
          if (odEl) {
            odEl.textContent = extra.summary.odTaken !== undefined ? extra.summary.odTaken : (extra.summary.totals ? extra.summary.totals.odDays : '—');
          }
        }
        if (extra.tracker && typeof EamsTracker !== 'undefined') {
          EamsTracker.render(extra.tracker, 'odr-tracker-panel');
        }
        if (extra.summary && extra.summary.history) {
          _populateRequestHistory(extra.summary.history, 'odr-history-section', 'odr-history-list');
        }
      }
    };

    // 1. Instantly open modal so user has immediate visual feedback
    openModal('m-od-stage-review');

    // 2. Search local memory cache to render full request immediately without waiting
    var searchId = String(id).trim();
    var localList = (_teacherODData.history || []).concat(_teacherODData.pending || []).concat(_teacherODData.verify || []);
    var localReq = localList.find(function(it) {
      if (!it) return false;
      return (it._id && String(it._id) === searchId) ||
             (it.requestId && String(it.requestId) === searchId) ||
             (it.trackId && String(it.trackId) === searchId);
    });

    if (localReq) {
      populateModal(localReq, { tracker: localReq.tracker || null, summary: null });
    }

    // 3. Fetch latest live detail from backend in background
    api('/api/od/' + encodeURIComponent(searchId), { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.ok && res.request) {
          populateModal(res.request, { tracker: res.tracker, summary: res.studentSummary });
        } else if (!localReq) {
          showToast(res.error || 'Could not find OD details', 'warn');
        }
      })
      .catch(function(err) {
        console.warn('[OD Detail Background Fetch Error]:', err);
        if (!localReq) {
          showToast('Error loading OD details: ' + err.message, 'error');
        }
      });
  }
  window.openODStageReviewModal = openODStageReviewModal;

  function submitODStageAction(action) {
    if (!_activeODReview) return;
    const reqId = _activeODReview._id || _activeODReview.requestId;
    const remarks = document.getElementById('odr-remarks') ? document.getElementById('odr-remarks').value.trim() : '';

    showToast('Processing OD ' + action + '…', 'saving');
    api('/api/od/' + reqId + '/' + action, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ remarks: remarks })
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (!res.ok) throw new Error(res.error || 'Failed to execute ' + action);
      closeModal('m-od-stage-review');
      showToast('<re-icon icon="check"></re-icon> ' + (res.message || 'Stage updated successfully'), 'success');
      loadTeacherODData();
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
  }
  window.submitODStageAction = submitODStageAction;

  function hodQuickApproveOD(reqId) {
    if (typeof actionToast !== 'function') { submitDirectODAction(reqId, 'approve', ''); return; }
    actionToast({
      key: 'hod-approve-' + reqId,
      duration: 5,
      title: 'Approving OD request…',
      message: 'Click Cancel to undo before it\'s sent.',
      confirmText: 'Cancel',
      onConfirm: function() { submitDirectODAction(reqId, 'approve', ''); },
      onCancel: function() { showToast('Approval cancelled.', 'info'); }
    });
  }
  window.hodQuickApproveOD = hodQuickApproveOD;

  function hodQuickRejectOD(reqId) {
    if (typeof actionToast !== 'function') { submitDirectODAction(reqId, 'reject', 'Rejected by HoD'); return; }
    actionToast({
      key: 'hod-reject-' + reqId,
      duration: 5,
      title: 'Rejecting OD request…',
      message: 'Click Cancel to undo before it\'s sent.',
      confirmText: 'Cancel',
      onConfirm: function() { submitDirectODAction(reqId, 'reject', 'Rejected by HoD'); },
      onCancel: function() { showToast('Rejection cancelled.', 'info'); }
    });
  }
  window.hodQuickRejectOD = hodQuickRejectOD;

  function submitDirectODAction(reqId, action, remarks) {
    showToast('Processing OD ' + action + '…', 'saving');
    api('/api/od/' + reqId + '/' + action, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ remarks: remarks })
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (!res.ok) throw new Error(res.error || 'Failed to execute ' + action);
      showToast('<re-icon icon="check"></re-icon> ' + (res.message || 'Stage updated successfully'), 'success');
      loadTeacherODData();
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
  }

  function openODOutcomeVerifyModal(id) {
    const list = (_teacherODData.verify || []).concat(_teacherODData.pending || []).concat(_teacherODData.history || []);
    const req = list.find(function(item) { return item._id === id || item.requestId === id; });
    if (!req) return;
    _activeODVerify = req;

    document.getElementById('odv-student-name').textContent = req.studentName || '—';
    document.getElementById('odv-event-title').textContent  = (req.eventDetails && req.eventDetails.name) || req.eventName || '—';
    document.getElementById('odv-outcome-summary').textContent = (req.outcome && req.outcome.primaryOutcome) || 'Completed';

    const evObj = (req.outcome && req.outcome.evidence) || {};
    const linkEl = document.getElementById('odv-evidence-link');
    if (isSafeHttpsUrl(evObj.webViewLink)) {
      linkEl.innerHTML = '<a href="' + escapeHtml(evObj.webViewLink) + '" target="_blank" rel="noopener noreferrer" style="color:#0284c7;font-weight:700;"><re-icon icon="external-link"></re-icon> View Certificate</a>';
    } else {
      linkEl.textContent = 'None';
    }

    const dupAlert = document.getElementById('odv-dup-alert');
    if (dupAlert) {
      dupAlert.style.display = (req.verification && req.verification.duplicateFlag) ? 'block' : 'none';
    }

    if (document.getElementById('odv-notes')) document.getElementById('odv-notes').value = '';
    openModal('m-od-outcome-verify');
  }
  window.openODOutcomeVerifyModal = openODOutcomeVerifyModal;

  function submitODOutcomeVerification(status) {
    if (!_activeODVerify) return;
    const reqId = _activeODVerify._id || _activeODVerify.requestId;
    const notes = document.getElementById('odv-notes') ? document.getElementById('odv-notes').value.trim() : '';

    showToast('Submitting verification…', 'saving');
    api('/api/od/' + reqId + '/verify', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: status, comment: notes })
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (!res.ok) throw new Error(res.error || 'Failed to submit verification');
      closeModal('m-od-outcome-verify');
      showToast('<re-icon icon="check"></re-icon> ' + (res.message || 'Outcome verification recorded'), 'success');
      loadTeacherODData();
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
  }
  window.submitODOutcomeVerification = submitODOutcomeVerification;

    // ── GROUP OD STATE & MODAL MANAGEMENT ──
  var _godAllStudents = [];
  var _godSelectedHead = null;
  var _godMembers = [];
  var _godCurrentTab = 'invite';

  function openFacultyGroupODModal() {
    var el = document.getElementById('m-faculty-group-od');
    if (el) {
      el.style.display = 'flex';
      el.classList.add('open');
    }

    // Reset selection state
    clearGroupODHead();
    _godMembers = [];
    renderGroupODMemberChips();
    switchGroupODTab('invite');

    // Fetch students list for search dropdown
    fetchGroupODStudents();

    // Fetch teacher's pending group invites and student-submitted drafts
    loadTeacherGroupODQueue();
  }
  window.openFacultyGroupODModal = openFacultyGroupODModal;

  function fetchGroupODStudents(query) {
    var url = '/api/od/students-search' + (query ? ('?q=' + encodeURIComponent(query)) : '');
    api(url, { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.ok && Array.isArray(res.students)) {
          _godAllStudents = res.students;
          populateGroupODHeadDropdown(res.students);
          populateGroupODMemberDropdown(res.students);
        }
      })
      .catch(function(err) {
        console.warn('[GroupOD] Student fetch error:', err.message);
      });
  }

  function populateGroupODHeadDropdown(list) {
    var sel = document.getElementById('god-head-select');
    if (!sel) return;
    if (!list || !list.length) {
      sel.innerHTML = '<option value="">No matching students found</option>';
      sel.style.display = 'block';
      return;
    }
    sel.innerHTML = '<option value="">-- Click to Select Team Head --</option>' + list.map(function(s) {
      var label = (s.fullName || s.name || 'Student') + ' (' + (s.registerNo || s.admissionNo || s.trackId) + ') • ' + (s.class || s.className || s.deptCode || 'Class');
      return '<option value="' + escapeHtml(s.trackId) + '">' + escapeHtml(label) + '</option>';
    }).join('');
    sel.style.display = 'block';
  }

  function filterGroupODHeadStudents(query) {
    query = (query || '').toLowerCase().trim();
    if (!query) {
      populateGroupODHeadDropdown(_godAllStudents);
      return;
    }
    var filtered = _godAllStudents.filter(function(s) {
      return (s.name && s.name.toLowerCase().includes(query)) ||
             (s.fullName && s.fullName.toLowerCase().includes(query)) ||
             (s.registerNo && s.registerNo.toLowerCase().includes(query)) ||
             (s.trackId && s.trackId.toLowerCase().includes(query)) ||
             (s.class && s.class.toLowerCase().includes(query)) ||
             (s.deptCode && s.deptCode.toLowerCase().includes(query));
    });
    if (!filtered.length && query.length >= 2) {
      fetchGroupODStudents(query);
    } else {
      populateGroupODHeadDropdown(filtered);
    }
  }
  window.filterGroupODHeadStudents = filterGroupODHeadStudents;

  function onSelectGroupODHead(sel) {
    var trackId = sel ? sel.value : '';
    if (!trackId) return;
    var found = _godAllStudents.find(function(s) { return s.trackId === trackId; });
    if (!found) return;

    _godSelectedHead = found;
    var badgeEl = document.getElementById('god-head-selected-badge');
    var nameEl = document.getElementById('god-head-name');
    var metaEl = document.getElementById('god-head-meta');
    var searchEl = document.getElementById('god-head-search');

    if (nameEl) nameEl.textContent = (found.fullName || found.name) + ' (' + (found.registerNo || found.admissionNo || found.trackId) + ')';
    if (metaEl) metaEl.textContent = 'Class: ' + (found.class || 'N/A') + ' • Dept: ' + (found.deptCode || 'N/A') + ' • ID: ' + found.trackId;
    if (badgeEl) badgeEl.style.display = 'flex';
    if (searchEl) searchEl.style.display = 'none';
    if (sel) sel.style.display = 'none';
  }
  window.onSelectGroupODHead = onSelectGroupODHead;

  function clearGroupODHead() {
    _godSelectedHead = null;
    var badgeEl = document.getElementById('god-head-selected-badge');
    var searchEl = document.getElementById('god-head-search');
    var sel = document.getElementById('god-head-select');
    if (badgeEl) badgeEl.style.display = 'none';
    if (searchEl) {
      searchEl.style.display = 'block';
      searchEl.value = '';
    }
    if (sel) sel.style.display = 'none';
  }
  window.clearGroupODHead = clearGroupODHead;

  function switchGroupODTab(tab) {
    _godCurrentTab = tab;
    var btnInvite = document.getElementById('tab-god-invite');
    var btnDirect = document.getElementById('tab-god-direct');
    var pInvite = document.getElementById('panel-god-invite');
    var pDirect = document.getElementById('panel-god-direct');

    if (tab === 'invite') {
      if (btnInvite) { btnInvite.className = 'btn-pri'; btnInvite.style.background = '#0284c7'; }
      if (btnDirect) { btnDirect.className = 'btn-out'; btnDirect.style.background = 'transparent'; }
      if (pInvite) pInvite.style.display = 'block';
      if (pDirect) pDirect.style.display = 'none';
    } else {
      if (btnDirect) { btnDirect.className = 'btn-pri'; btnDirect.style.background = '#16a34a'; }
      if (btnInvite) { btnInvite.className = 'btn-out'; btnInvite.style.background = 'transparent'; }
      if (pInvite) pInvite.style.display = 'none';
      if (pDirect) pDirect.style.display = 'block';
    }
  }
  window.switchGroupODTab = switchGroupODTab;

  function submitGroupODInvite() {
    if (!_godSelectedHead) {
      showToast('Please select a Team Head student first', 'warn');
      return;
    }
    var title = (document.getElementById('god-invite-title') ? document.getElementById('god-invite-title').value : '').trim();
    var notes = (document.getElementById('god-invite-notes') ? document.getElementById('god-invite-notes').value : '').trim();

    showToast('Sending invitation to student head…', 'saving');
    api('/api/od/group-invite', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        teamHeadTrackId: _godSelectedHead.trackId,
        eventName: title,
        notes: notes
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (!res.ok) throw new Error(res.error || 'Failed to send invite');
      closeModal('m-faculty-group-od');
      showToast('<re-icon icon="send"></re-icon> Invite sent to ' + (_godSelectedHead.fullName || _godSelectedHead.name) + '! Student can now fill team members & details.', 'success');
      loadTeacherODData();
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
  }
  window.submitGroupODInvite = submitGroupODInvite;

  function populateGroupODMemberDropdown(list) {
    var sel = document.getElementById('god-member-select');
    if (!sel) return;
    if (!list || !list.length) {
      sel.innerHTML = '<option value="">No matching students found</option>';
      sel.style.display = 'block';
      return;
    }
    sel.innerHTML = '<option value="">-- Click student to add to team --</option>' + list.map(function(s) {
      var label = (s.fullName || s.name || 'Student') + ' (' + (s.registerNo || s.admissionNo || s.trackId) + ') • ' + (s.class || s.deptCode || 'Class');
      return '<option value="' + escapeHtml(s.trackId) + '">' + escapeHtml(label) + '</option>';
    }).join('');
    sel.style.display = 'block';
  }

  function filterGroupODMemberStudents(query) {
    query = (query || '').toLowerCase().trim();
    if (!query) {
      populateGroupODMemberDropdown(_godAllStudents);
      return;
    }
    var filtered = _godAllStudents.filter(function(s) {
      return (s.name && s.name.toLowerCase().includes(query)) ||
             (s.fullName && s.fullName.toLowerCase().includes(query)) ||
             (s.registerNo && s.registerNo.toLowerCase().includes(query)) ||
             (s.trackId && s.trackId.toLowerCase().includes(query));
    });
    populateGroupODMemberDropdown(filtered);
  }
  window.filterGroupODMemberStudents = filterGroupODMemberStudents;

  function addGroupODMember(sel) {
    var trackId = sel ? sel.value : '';
    if (!trackId) return;
    if (_godSelectedHead && _godSelectedHead.trackId === trackId) {
      showToast('Team Head is already included automatically', 'info');
      sel.value = '';
      return;
    }
    if (_godMembers.some(function(m) { return m.trackId === trackId; })) {
      showToast('Student is already added to team members', 'info');
      sel.value = '';
      return;
    }
    var found = _godAllStudents.find(function(s) { return s.trackId === trackId; });
    if (found) {
      _godMembers.push(found);
      renderGroupODMemberChips();
    }
    sel.value = '';
  }
  window.addGroupODMember = addGroupODMember;

  function removeGroupODMember(trackId) {
    _godMembers = _godMembers.filter(function(m) { return m.trackId !== trackId; });
    renderGroupODMemberChips();
  }
  window.removeGroupODMember = removeGroupODMember;

  function renderGroupODMemberChips() {
    var wrap = document.getElementById('god-members-chips');
    if (!wrap) return;
    if (!_godMembers.length) {
      wrap.innerHTML = '<span style="font-size:11px;color:var(--tdi);padding:2px 4px;">No additional members added yet.</span>';
      return;
    }
    wrap.innerHTML = _godMembers.map(function(m) {
      return '<span style="display:inline-flex;align-items:center;gap:6px;background:#e2e8f0;border-radius:14px;padding:3px 10px;font-size:11.5px;color:var(--td);font-weight:600;">' +
        escapeHtml(m.fullName || m.name || m.trackId) + ' (' + escapeHtml(m.registerNo || m.class || '') + ')' +
        '<span style="cursor:pointer;color:#ef4444;margin-left:2px;" onclick="removeGroupODMember(\'' + escapeHtml(m.trackId) + '\')"><re-icon icon="x" size="12"></re-icon></span>' +
      '</span>';
    }).join(' ');
  }

  function submitFacultyGroupODDirect() {
    if (!_godSelectedHead) {
      showToast('Please select a Team Head student', 'warn');
      return;
    }
    var eventTitle = (document.getElementById('god-direct-title') ? document.getElementById('god-direct-title').value : '').trim();
    var type       = document.getElementById('god-direct-type') ? document.getElementById('god-direct-type').value : 'Technical';
    var level      = document.getElementById('god-direct-level') ? document.getElementById('god-direct-level').value : 'Inter-Collegiate';
    var fromDate   = document.getElementById('god-direct-from') ? document.getElementById('god-direct-from').value : '';
    var toDate     = document.getElementById('god-direct-to') ? document.getElementById('god-direct-to').value : '';
    var venue      = (document.getElementById('god-direct-venue') ? document.getElementById('god-direct-venue').value : '').trim();
    var desc       = (document.getElementById('god-direct-desc') ? document.getElementById('god-direct-desc').value : '').trim();

    if (!eventTitle || !fromDate || !toDate || !desc) {
      showToast('Please fill all required fields (Title, Dates, Description)', 'warn');
      return;
    }

    // Combine Team Head + Additional Members
    var allIds = [_godSelectedHead.trackId];
    _godMembers.forEach(function(m) {
      if (!allIds.includes(m.trackId)) allIds.push(m.trackId);
    });

    showToast('Submitting Group OD for ' + allIds.length + ' student(s)…', 'saving');
    api('/api/od/group', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        eventName: eventTitle,
        type: type,
        level: level,
        studentTrackIds: allIds,
        startDate: fromDate,
        endDate: toDate,
        description: desc,
        hostCollege: venue,
        venue: venue,
        coverage: 'full_day'
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (!res.ok) throw new Error(res.error || 'Failed to create group OD');
      closeModal('m-faculty-group-od');
      showToast('<re-icon icon="users"></re-icon> Group OD created successfully for ' + allIds.length + ' student(s)! Routed to Mentor &rarr; Advisor &rarr; HOD.', 'success');
      loadTeacherODData();
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
  }
  window.submitFacultyGroupODDirect = submitFacultyGroupODDirect;
  window.submitFacultyGroupOD = submitFacultyGroupODDirect;

  function loadTeacherGroupODQueue() {
    var wrap = document.getElementById('god-pending-drafts-wrap');
    var list = document.getElementById('god-pending-drafts-list');
    if (!wrap || !list) return;

    api('/api/od/group-invites/teacher-queue', { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.ok && Array.isArray(res.invites)) {
          var drafts = res.invites.filter(function(i) { return i.status === 'submitted_by_student'; });
          if (!drafts.length) {
            wrap.style.display = 'none';
            return;
          }
          wrap.style.display = 'block';
          list.innerHTML = drafts.map(function(d) {
            var ev = d.eventDetails || {};
            var memberCount = (d.members || []).length;
            return '<div style="background:#fff;border:1px solid #86efac;border-radius:8px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;">' +
              '<div>' +
                '<div style="font-size:12px;font-weight:700;color:#166534;">' + escapeHtml(ev.name || 'Group OD') + ' (' + memberCount + ' members)</div>' +
                '<div style="font-size:11px;color:#15803d;">Team Head: ' + escapeHtml(d.teamHeadName || '-') + ' (' + escapeHtml(d.teamHeadRegNo || '') + ') • Dates: ' + escapeHtml(ev.startDate || '-') + ' to ' + escapeHtml(ev.endDate || '-') + '</div>' +
              '</div>' +
              '<button type="button" class="btn-sm btn-pri" style="background:#16a34a;font-size:11px;padding:4px 10px;" onclick="finalizeGroupODDraft(\'' + escapeHtml(d.inviteId) + '\')"><re-icon icon="check" size="12"></re-icon> Authorize &amp; Submit</button>' +
            '</div>';
          }).join('');
        }
      })
      .catch(function(e) { console.warn('[GroupOD] Draft queue fetch error:', e.message); });
  }

  function finalizeGroupODDraft(inviteId) {
    if (!inviteId) return;
    showToast('Finalizing Group OD request…', 'saving');
    api('/api/od/group-invites/' + encodeURIComponent(inviteId) + '/faculty-finalize', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({})
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (!res.ok) throw new Error(res.error || 'Failed to finalize Group OD');
      showToast('<re-icon icon="check-circle"></re-icon> ' + (res.message || 'Group OD submitted successfully!'), 'success');
      loadTeacherGroupODQueue();
      loadTeacherODData();
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
  }
  window.finalizeGroupODDraft = finalizeGroupODDraft;

  // PROFILE PAGE
  function initProfilePage() {
    document.getElementById('profav').textContent    = (currentUser.name || 'T')[0];
    document.getElementById('profname').textContent  = currentUser.name;
    document.getElementById('pdrdesig').textContent  = currentUser.desig  || 'Assistant Professor';
    document.getElementById('pdremp').textContent    = currentUser.empId  || '—';
    document.getElementById('pdrdept').textContent   = currentUser.dept   || '—';
    document.getElementById('pdrusr').textContent    = currentUser.username || '—';

    if (document.getElementById('pdremail')) document.getElementById('pdremail').textContent = currentUser.email || '—';
    if (document.getElementById('pdrphone')) document.getElementById('pdrphone').textContent = currentUser.phone || '—';
    if (document.getElementById('pdrqual')) document.getElementById('pdrqual').textContent = currentUser.qualifications || '—';
    if (document.getElementById('pdrexp')) document.getElementById('pdrexp').textContent = currentUser.experience || '—';
    if (document.getElementById('pdrdoj')) document.getElementById('pdrdoj').textContent = currentUser.joiningDate || '—';

    if (document.getElementById('prof-hod-tag')) {
      document.getElementById('prof-hod-tag').style.display = currentUser.isHOD ? 'inline-block' : 'none';
    }

    if (document.getElementById('pdrhod')) document.getElementById('pdrhod').innerHTML = currentUser.isHOD ? '<span class="field-badge fb-yes"><re-icon icon="sparkles"></re-icon> '+ (currentUser.HoddeptName || 'Yes') +'</span>' : '<span class="field-badge fb-no">No</span>';
    if (document.getElementById('pdrclassadv')) document.getElementById('pdrclassadv').innerHTML = currentUser.isClassAdvisor ? '<span class="field-badge fb-yes"><re-icon icon="sparkles"></re-icon> ' + (currentUser.advisorClassName || 'Yes') + '</span>' : '<span class="field-badge fb-no">No</span>';
    if (document.getElementById('pdrttcoord')) document.getElementById('pdrttcoord').innerHTML = currentUser.isTimeTableCoordinator ? '<span class="field-badge fb-yes"><re-icon icon="sparkles"></re-icon> ' + (currentUser.TTdeptName || 'Yes') + '</span>' : '<span class="field-badge fb-no">No</span>';
    if (document.getElementById('pdradmin')) document.getElementById('pdradmin').innerHTML = currentUser.isAdmin ? '<span class="field-badge fb-yes"><re-icon icon="sparkles"></re-icon> Yes</span>' : '<span class="field-badge fb-no">No</span>';

    const assignedClasses = Array.from(new Set(getMyAssignments().map(function(a) { return a.className; })));
    document.getElementById('pdrcls').textContent = assignedClasses.length ? assignedClasses.join(', ') : 'None assigned';

    // Populate Attendance Preference
    var prefStatusEl = document.getElementById('prof-def-att-status');
    if (prefStatusEl) {
      prefStatusEl.value = (currentUser.preferences && currentUser.preferences.defaultAttendanceStatus) || 'Present';
    }
    var autoPromptEl = document.getElementById('prof-auto-att-prompt');
    if (autoPromptEl) {
      autoPromptEl.checked = (currentUser.preferences && currentUser.preferences.autoAttendancePrompt !== undefined)
        ? Boolean(currentUser.preferences.autoAttendancePrompt)
        : true;
    }
    var promptLeadEl = document.getElementById('prof-prompt-lead');
    if (promptLeadEl) {
      promptLeadEl.value = String((currentUser.preferences && currentUser.preferences.promptLeadMinutes !== undefined)
        ? currentUser.preferences.promptLeadMinutes
        : 5);
    }

    ['pwcur','pwnew','pwconf'].forEach(function(id) { document.getElementById(id).value = ''; });
    document.getElementById('pwerr').style.display = 'none';
  }
  var initProfile = initProfilePage;

  function saveTeacherPreferences() {
    var prefStatusEl = document.getElementById('prof-def-att-status');
    var status = prefStatusEl ? prefStatusEl.value : 'Present';
    var autoPromptEl = document.getElementById('prof-auto-att-prompt');
    var autoPrompt = autoPromptEl ? autoPromptEl.checked : true;
    var promptLeadEl = document.getElementById('prof-prompt-lead');
    var leadMinutes = promptLeadEl ? Number(promptLeadEl.value) : 5;

    var tok = getToken();
    if (!tok) return;

    api('/api/profile/me', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + tok
      },
      body: JSON.stringify({
        defaultAttendanceStatus: status,
        autoAttendancePrompt: autoPrompt,
        promptLeadMinutes: leadMinutes
      })
    })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res && res.error) {
          showToast('' + res.error, 'error');
          return;
        }
        if (!currentUser.preferences) currentUser.preferences = {};
        currentUser.preferences.defaultAttendanceStatus = status;
        currentUser.preferences.autoAttendancePrompt = autoPrompt;
        currentUser.preferences.promptLeadMinutes = leadMinutes;
        sessionStorage.setItem('eams_user', JSON.stringify(currentUser));
        showToast('Preferences saved!', 'success');
      })
      .catch(function(err) {
        showToast('Network error', 'error');
      });
  }

  // Profile <re-icon icon="arrow-right"></re-icon> Change Password. It compared against currentUser.password (never
  // present client-side, so it always said "incorrect") and only updated the
  // in-memory cache. Uses the same endpoint as the change-password modal.
  function changePassword() {
    const currentPw  = document.getElementById('pwcur').value.trim();
    const newPw      = document.getElementById('pwnew').value.trim();
    const confirmPw  = document.getElementById('pwconf').value.trim();
    const errorEl    = document.getElementById('pwerr');

    errorEl.style.display = 'none';
    function fail(msg) { errorEl.textContent = msg; errorEl.style.display = 'block'; }

    if (!currentPw || !newPw || !confirmPw) return fail('Please fill all password fields.');
    if (newPw.length < 6) return fail('New password must be at least 6 characters.');
    if (newPw !== confirmPw) return fail('Passwords do not match.');

    api('/api/auth/change-password', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
    })
    .then(function(r) { return r.json().catch(function() { return {}; }); })
    .then(function(d) {
      if (d && d.error) return fail(d.error);
      ['pwcur','pwnew','pwconf'].forEach(function(id) { document.getElementById(id).value = ''; });
      sessionStorage.setItem('eams_mustChangePw', '0');
      showToast('<re-icon icon="lock"></re-icon> Password updated successfully!', 'success');
    })
    .catch(function() { fail('Server error. Try again.'); });
  }
  var changePw = changePassword;

  // MODAL HELPERS
  

  

  // Close modal on backdrop click
  document.querySelectorAll('.modal-bg').forEach(function(bg) {
    bg.addEventListener('click', function(e) {
      if (e.target === bg) bg.classList.remove('open');
    });
  });

  // UTILITY FUNCTIONS
  
  var showT = showToast;

  function downloadCSV(rows, filename) {
    const csvContent = rows.map(function(row) {
      return row.map(function(cell) {
        return '"' + String(cell || '').replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href     = URL.createObjectURL(blob);
    link.download = filename + '_' + todayISO() + '.csv';
    link.click();
  }
  var dlCSV = downloadCSV;

  // BOOT
  ensureDB();

  (function checkAuthAndBoot() {
    const storedUser = sessionStorage.getItem('eams_user');
    if (storedUser) {
      try { currentUser = JSON.parse(storedUser); } catch (e) {}
    }
    bootApp();
  })();

// Change Password
var _pwToken = getToken();

function showForcePwModal() {
  var pub = window._pubSettings || window._publicSettings || {};
  var sec = pub.security || {};
  if (pub.isDev || sec.isDev || sec.forcePasswordChange === false) {
    try { sessionStorage.removeItem('eams_mustChangePw'); } catch (_) {}
    var m = document.getElementById('forcePwModal');
    if (m) m.style.display = 'none';
    if (typeof closeModal === 'function') {
      try { closeModal('forcePwModal', true); } catch (_) {}
    }
    return;
  }
  var el = document.getElementById('forcePwModal');
  if (el) {
    el.style.display = 'flex';
    if (typeof openModal === 'function') {
      try { openModal('forcePwModal'); } catch (_) {}
    }
  }
}
window.showForcePwModal = showForcePwModal;

function togglePwVisibility(inputId, btnEl) {
  var input = document.getElementById(inputId);
  if (!input) return;
  var isPw = input.type === 'password';
  input.type = isPw ? 'text' : 'password';
  if (btnEl) {
    btnEl.innerHTML = '<re-icon icon="' + (isPw ? 'eye-off' : 'eye') + '" size="16"></re-icon>';
    btnEl.setAttribute('aria-label', isPw ? 'Hide password' : 'Show password');
  }
}
window.togglePwVisibility = togglePwVisibility;
function openChangePwModal() {
  ['changePwCur','changePwNew','changePwConf'].forEach(function(id){ document.getElementById(id).value=''; });
  document.getElementById('changePwErr').style.display='none';
  document.getElementById('changePwOk').style.display='none';
  document.getElementById('changePwModal').style.display='flex';
}
function closeChangePwModal() {
  document.getElementById('changePwModal').style.display='none';
}
function submitForcePw() {
  var cur = document.getElementById('forcePwCur').value.trim();
  var nw = document.getElementById('forcePwNew').value.trim();
  var conf = document.getElementById('forcePwConf').value.trim();
  var err = document.getElementById('forcePwErr');
  err.style.display = 'none';
  if (!cur || !nw || !conf) { err.textContent = 'Please fill all fields.'; err.style.display = 'block'; return; }
  if (nw.length < 6) { err.textContent = 'New password must be at least 6 characters.'; err.style.display = 'block'; return; }
  if (nw !== conf) { err.textContent = 'Passwords do not match.'; err.style.display = 'block'; return; }
  var tok = (typeof getToken === 'function' ? getToken() : null) || _pwToken || sessionStorage.getItem('eams_token');
  api('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
    body: JSON.stringify({ currentPassword: cur, newPassword: nw })
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.error) { err.textContent = d.error; err.style.display = 'block'; return; }
    sessionStorage.setItem('eams_mustChangePw', '0');
    var el = document.getElementById('forcePwModal');
    if (el) el.style.display = 'none';
    if (typeof closeModal === 'function') {
      try { closeModal('forcePwModal', true); } catch (_) {}
    }
    showToast('Password changed successfully! Please remember your new password.', 'success');
    if (typeof syncMySchedule === 'function') syncMySchedule(0);
    if (typeof syncTeacherNotifications === 'function') syncTeacherNotifications();
    if (typeof initDashboard === 'function') initDashboard();
    if (typeof fetchTodaySessions === 'function') fetchTodaySessions();
  }).catch(function(e) {
    err.textContent = (e && e.message) ? e.message : 'Server error. Try again.';
    err.style.display = 'block';
  });
}
function submitChangePw() {
  var cur=document.getElementById('changePwCur').value.trim();
  var nw=document.getElementById('changePwNew').value.trim();
  var conf=document.getElementById('changePwConf').value.trim();
  var err=document.getElementById('changePwErr');
  var ok=document.getElementById('changePwOk');
  err.style.display='none';ok.style.display='none';
  if (!cur||!nw||!conf){err.textContent='Please fill all fields.';err.style.display='block';return;}
  if (nw.length<6){err.textContent='New password must be at least 6 characters.';err.style.display='block';return;}
  if (nw!==conf){err.textContent='Passwords do not match.';err.style.display='block';return;}
  api('/api/auth/change-password',{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+_pwToken},
    body:JSON.stringify({currentPassword:cur,newPassword:nw})
  }).then(function(r){return r.json();}).then(function(d){
    if(d.error){err.textContent=d.error;err.style.display='block';return;}
    ok.innerHTML='<re-icon icon="check-circle"></re-icon> Password updated successfully!';ok.style.display='block';
    ['changePwCur','changePwNew','changePwConf'].forEach(function(id){document.getElementById(id).value='';});
    setTimeout(closeChangePwModal,1500);
  }).catch(function(){err.textContent='Server error. Try again.';err.style.display='block';});
}
var activeRepShareSessionId = null;
var repSharePollTimer = null;

function forwardToRepModal() {
  if (window._pubSettings && window._pubSettings.attendance && window._pubSettings.attendance.forwardToRep === false) {
    showToast('Delegation to Class Representative is disabled in settings.', 'warn');
    return;
  }
  var inputs = (typeof getSelectedAttendanceInputs === 'function') ? getSelectedAttendanceInputs() : {};
  var classId = inputs.classId || (document.getElementById('attcls') ? document.getElementById('attcls').value : '');
  var subjectId = inputs.subjectId || (document.getElementById('attsub') ? document.getElementById('attsub').value : '');
  var date = inputs.date || (document.getElementById('attdate') ? document.getElementById('attdate').value : '');
  if (!classId || !subjectId || !date) {
    if (typeof dbToast === 'function') dbToast('Select class, subject and date first', 'warn');
    else showToast('Select class, subject and date first', 'warn');
    return;
  }

  var modal = document.getElementById('modal-rep-share');
  if (modal) modal.style.display = 'flex';
  var spinner = document.getElementById('rep-loading-spinner');
  var list = document.getElementById('rep-list-container');
  if (spinner) spinner.style.display = 'block';
  if (list) { list.style.display = 'none'; list.innerHTML = ''; }

  api('/api/rep-share/reps/' + classId, {
    headers: { 'Authorization': 'Bearer ' + getToken() }
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (spinner) spinner.style.display = 'none';
    if (!list) return;
    list.style.display = 'flex';
    var reps = data.reps || [];
    if (!reps.length) {
      list.innerHTML = '<div style="text-align:center;padding:24px;color:#64748b;">'
        + '<div style="font-size:28px;margin-bottom:8px;"><re-icon icon="alert-triangle"></re-icon></div>'
        + '<div style="font-size:13px;font-weight:600;">No students found in this class roster.</div>'
        + '</div>';
      return;
    }

    var html = '';
    reps.forEach(function(rep) {
      var initials = (rep.fullName || 'R').split(' ').map(function(w){return w[0];}).join('').slice(0,2).toUpperCase();
      var repBadge = rep.isRep ? '<span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;margin-left:6px;">Class Rep</span>' : '';
      html += '<div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;">'
        + '<div style="display:flex;align-items:center;gap:12px;">'
        + '  <div style="width:38px;height:38px;border-radius:50%;background:#e0f2fe;color:#0369a1;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;">' + initials + '</div>'
        + '  <div>'
        + '    <div style="font-size:13.5px;font-weight:700;color:#0f172a;">' + (rep.fullName || '—') + repBadge + '</div>'
        + '    <div style="font-size:11.5px;color:#64748b;font-family:monospace;margin-top:2px;">Reg No: ' + (rep.registerNo || '—') + '</div>'
        + '  </div>'
        + '</div>'
        + '<button class="btn-pri" onclick="delegateAttendanceToRep(\'' + rep._id + '\', \'' + (rep.fullName || '').replace(/'/g, "\\'") + '\')" style="font-size:12px;padding:7px 14px;background:#059669;">'
        + '  Delegate <re-icon icon="arrow-right"></re-icon>'
        + '</button>'
        + '</div>';
    });
    list.innerHTML = html;
  })
  .catch(function(err) {
    if (spinner) spinner.style.display = 'none';
    if (list) {
      list.style.display = 'block';
      list.innerHTML = '<div style="color:#dc2626;font-size:13px;text-align:center;padding:16px;">Failed to load representatives: ' + escapeHtml(err && err.message ? err.message : 'Unknown error') + '</div>';
    }
  });
}
window.forwardToRepModal = forwardToRepModal;

function closeRepShareModal() {
  var modal = document.getElementById('modal-rep-share');
  if (modal) modal.style.display = 'none';
}
window.closeRepShareModal = closeRepShareModal;

function delegateAttendanceToRep(repId, repName) {
  var inputs = (typeof getSelectedAttendanceInputs === 'function') ? getSelectedAttendanceInputs() : {};
  var classId = inputs.classId || (document.getElementById('attcls') ? document.getElementById('attcls').value : '');
  var subjectId = inputs.subjectId || (document.getElementById('attsub') ? document.getElementById('attsub').value : '');
  var date = inputs.date || (document.getElementById('attdate') ? document.getElementById('attdate').value : '');
  var periodNumber = Number(inputs.period) || (document.getElementById('attperiod') ? Number(document.getElementById('attperiod').value) || 1 : 1);
  var topicVal = (document.getElementById('att-topic') ? document.getElementById('att-topic').value : '').trim();

  if (typeof dbToast === 'function') dbToast('Delegating attendance to ' + repName + '…', 'saving');
  else showToast('Delegating attendance…');

  api('/api/rep-share/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getToken()
    },
    body: JSON.stringify({
      classId: classId,
      subjectId: subjectId,
      date: date,
      periodNumber: periodNumber,
      periodNumbers: inputs.periodNumbers || [periodNumber],
      repStudentId: repId,
      topic: topicVal,
      actualClassCount: attendanceStudents ? attendanceStudents.length : 0
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.error) {
      if (typeof dbToast === 'function') dbToast(data.error, 'error');
      else showToast(data.error, 'error');
      return;
    }
    closeRepShareModal();
    activeRepShareSessionId = data.session._id || data.session.sessionTrackId;
    if (typeof dbToast === 'function') {
      dbToast('Attendance Delegated!', 'success', 'Class Rep ' + repName + ' notified. Waiting for submission…');
    } else {
      showToast('Attendance delegated to ' + repName, 'success');
    }

    // Switch to waiting state
    var selZone = document.getElementById('att-selector-zone');
    if (selZone) selZone.style.display = 'none';
    var sheet = document.getElementById('attsheet');
    if (sheet) sheet.style.display = 'block';

    var methodInd = document.getElementById('att-method-indicator');
    if (methodInd) {
      methodInd.innerHTML = '<re-icon icon="users"></re-icon> Rep Share (' + repName + ' Pending)';
      methodInd.style.display = 'inline-block';
    }

    startRepDraftPolling(activeRepShareSessionId, repName);
  })
  .catch(function(err) {
    if (typeof dbToast === 'function') dbToast('Failed to delegate: ' + err.message, 'error');
    else showToast('Failed to delegate: ' + err.message, 'error');
  });
}
window.delegateAttendanceToRep = delegateAttendanceToRep;

function startRepDraftPolling(sessionId, repName) {
  if (repSharePollTimer) clearInterval(repSharePollTimer);
  repSharePollTimer = setInterval(function() {
    if (document.hidden) return;
    api('/api/rep-share/session/' + sessionId, {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data && data.session && data.session.status === 'submitted') {
        clearInterval(repSharePollTimer);
        repSharePollTimer = null;
        if (typeof dbToast === 'function') {
          dbToast('Rep Draft Submitted!', 'success', repName + ' verified ' + data.session.repConfirmedCount + ' present. Loading draft…');
        } else {
          showToast('Rep Draft Submitted by ' + repName, 'success');
        }
        applyRepDraftToAttendance(data.session);
      }
    })
    .catch(function(){});
  }, 5000);
}

function applyRepDraftToAttendance(session) {
  function applyRecords() {
    var repRecords = session.records || [];
    var markedStatusMap = Object.create(null);
    repRecords.forEach(function(r) {
      var s = String(r.status || '').trim().toLowerCase();
      var normalized = (s === 'present' || s === 'p') ? 'present' : 'absent';
      if (r.studentTrackId) markedStatusMap[String(r.studentTrackId)] = normalized;
      if (r.studentId) markedStatusMap[String(r.studentId)] = normalized;
      if (r.regNo) markedStatusMap[String(r.regNo)] = normalized;
    });

    attendanceStudents.forEach(function(s, idx) {
      var stat = markedStatusMap[String(s._id)] ||
                 (s.trackId && markedStatusMap[String(s.trackId)]) ||
                 (s.regNo && markedStatusMap[String(s.regNo)]);
      if (stat) attendanceStudents[idx].status = stat;
    });

    renderAttendanceSheet();
    var methodInd = document.getElementById('att-method-indicator');
    if (methodInd) {
      methodInd.innerHTML = '<re-icon icon="users"></re-icon> Rep Share Draft Loaded (' + (session.repConfirmedCount || 0) + ' Verified Present)';
      methodInd.style.display = 'inline-block';
    }
    if (typeof dbToast === 'function') {
      dbToast('Draft applied from ' + (session.repStudentName || 'Rep'), 'success', 'Review student rows and click Save Attendance to finalize.');
    }
  }

  if (!attendanceStudents || !attendanceStudents.length) {
    loadAttendanceSheet();
    setTimeout(applyRecords, 1200);
  } else {
    applyRecords();
  }
}
window.applyRepDraftToAttendance = applyRepDraftToAttendance;

window.addEventListener('load', function(){
  var pub0 = window._pubSettings || window._publicSettings || {};
  var isDev = !!(pub0.isDev || (pub0.security && pub0.security.isDev));
  var isForcePw = pub0.security ? (pub0.security.forcePasswordChange !== false) : true;
  if(!isDev && isForcePw && sessionStorage.getItem('eams_mustChangePw')==='1'){ showForcePwModal(); }

  function applyPortalSettings(pub) {
    if (!pub || typeof pub !== 'object') return;
    if (pub.security && pub.security.forcePasswordChange === false) {
      try { sessionStorage.removeItem('eams_mustChangePw'); } catch (_) {}
      var fpwEl = document.getElementById('forcePwModal');
      if (fpwEl) fpwEl.style.display = 'none';
      if (typeof closeModal === 'function') {
        try { closeModal('forcePwModal', true); } catch (_) {}
      }
    }
    pub.attendance = pub.attendance || {};
    window._pubSettings = pub;
    window._publicSettings = pub;

    if (pub.institution) {
      var shortN = pub.institution.institutionShort || '';
      document.title = shortN ? ('EAMS – Teacher | ' + shortN) : 'EAMS – Teacher Portal';
      var brandEl = document.querySelector('.sb-brand');
      if (brandEl && pub.institution.institutionName) {
        brandEl.innerHTML = escapeHtml(pub.institution.institutionName) + '<small>Teacher Portal</small>';
      }
    }
    if (pub.models || pub.features) {
      var mLeave = pub.models ? pub.models.modelLeave : (pub.features ? pub.features.leave : undefined);
      var mGriev = pub.models ? pub.models.modelGrievances : (pub.features ? pub.features.grievances : undefined);
      var mExport = pub.models ? pub.models.modelExportSheet : (pub.features ? pub.features.exportSheet : undefined);

      document.querySelectorAll('[data-feature]').forEach(function(el) {
        var feat = el.getAttribute('data-feature');
        if (feat === 'leave' && mLeave === false) {
          el.style.display = 'none';
        } else if (feat === 'grievances' && mGriev === false) {
          el.style.display = 'none';
        } else if (feat === 'exportSheet' && mExport === false) {
          el.style.display = 'none';
        }
      });

      var mStudentLeave = pub.models ? pub.models.modelStudentLeave : undefined;
      var mStaffLeave = pub.models ? pub.models.modelStaffLeave : undefined;

      if (mLeave === false || mStudentLeave === false) {
        var el = document.getElementById('sn-leaves'); if (el) el.style.display = 'none';
        var curTab = (new URLSearchParams(window.location.search)).get('tab') || (new URLSearchParams(window.location.search)).get('page');
        if (curTab === 'leaves') nav('dash');
      }
      if (mLeave === false || mStaffLeave === false) {
        var myL = document.getElementById('sn-my-leaves'); if (myL) myL.style.display = 'none';
        var curTab = (new URLSearchParams(window.location.search)).get('tab') || (new URLSearchParams(window.location.search)).get('page');
        if (curTab === 'my-leaves') nav('dash');
      }
      if (mGriev === false) {
        var elG = document.getElementById('sn-griev'); if (elG) elG.style.display = 'none';
        var curTabG = (new URLSearchParams(window.location.search)).get('tab') || (new URLSearchParams(window.location.search)).get('page');
        if (curTabG === 'griev') nav('dash');
      }
      if (mExport === false) {
        document.querySelectorAll('[data-feature="exportSheet"]').forEach(function(b){
          b.style.display = 'none';
        });
        // Export buttons controlled cleanly via data-feature="exportSheet" (§B9, §8.2)
      }
    }
    if (pub.attendance) {
      if (typeof updateAttendanceMethodETAs === 'function') updateAttendanceMethodETAs();
      var attMethods = pub.attendance.methods || {};

      function setMethodBtnState(btnId, reasonId, enabled, reasonText) {
        var btn = document.getElementById(btnId);
        var reasonEl = document.getElementById(reasonId);
        if (!btn) return;
        btn.style.display = 'flex'; // Keep visible as real buttons (C2)
        if (!enabled) {
          btn.disabled = true;
          btn.classList.add('is-disabled');
          btn.setAttribute('aria-disabled', 'true');
          if (reasonEl) {
            reasonEl.textContent = reasonText || 'Switched off by admin';
            reasonEl.style.display = 'inline-flex';
          }
        } else {
          btn.disabled = false;
          btn.classList.remove('is-disabled');
          btn.removeAttribute('aria-disabled');
          if (reasonEl) {
            reasonEl.style.display = 'none';
            reasonEl.textContent = '';
          }
        }
      }

      var markingLocked = (pub.attendance.markAttendance === false || pub.attendance.canMark === false);

      var repReason = markingLocked ? 'Switched off: Marking locked' : 'Switched off by admin: Rep Share';
      var repEnabled = !markingLocked && !(attMethods.repShare === false || pub.attendance.forwardToRep === false);
      setMethodBtnState('card-rep-share', 'reason-rep-share', repEnabled, repReason);
      var fBtn = document.getElementById('btn-forward-rep');
      if (fBtn) fBtn.style.display = repEnabled ? '' : 'none';

      var qpReason = markingLocked ? 'Switched off: Marking locked' : (pub.attendance.liveSessions === false ? 'Switched off by admin: Live Sessions' : 'Switched off by admin: Quick Pass');
      var qpEnabled = !markingLocked && !(attMethods.quickPass === false || pub.attendance.quickPass === false || pub.attendance.liveSessions === false);
      setMethodBtnState('card-quick-pass', 'reason-quick-pass', qpEnabled, qpReason);

      var slReason = markingLocked ? 'Switched off: Marking locked' : 'Switched off by admin: Live Sessions';
      var slEnabled = !markingLocked && !(attMethods.scanLive === false || pub.attendance.liveSessions === false);
      setMethodBtnState('card-scan-live', 'reason-scan-live', slEnabled, slReason);
      if (pub.attendance.remarkRequired || pub.attendance.requirePeriodRemark) {
        var reqBadge = document.getElementById('att-topic-req');
        if (reqBadge) reqBadge.style.display = 'inline-block';
        var starTopic = document.getElementById('star-topic-req');
        if (starTopic) starTopic.style.display = 'inline';
      }
      if (pub.attendance.forceTimetableSlots) {
        var attPg = document.getElementById('pg-att');
        if (attPg && (attPg.classList.contains('active') || attPg.style.display === 'block')) {
          if (typeof initAttendancePage === 'function') initAttendancePage();
        }
      }
    }
  }

  // Load authenticated teacher portal policies (§S7, §8)
  var portalToken = getToken();
  if (portalToken) {
    api('/api/settings/teacher-portal', { headers: (typeof authHeaders === 'function' ? authHeaders() : { 'Authorization': 'Bearer ' + portalToken }) })
      .then(function(r){
        if (r && r.status === 403 && r.code === 'PASSWORD_CHANGE_REQUIRED') {
          showForcePwModal();
        }
        return r && r.ok ? r.json() : (r && r.data ? r : null);
      })
      .then(function(data){
        if (data && (data.ok || data.attendance)) {
          var payload = data.data || data;
          window._portalPolicy = payload;
          if (payload.attendance) {
            window._portalPolicy.canMark = payload.attendance.canMark;
            window._portalPolicy.editAllowed = payload.attendance.editAllowed;
            window._portalPolicy.backdateDays = payload.attendance.backdateDays;
            window._portalPolicy.lockHours = payload.attendance.lockHours;
            window._portalPolicy.timetableMatch = payload.attendance.timetableMatch;
          }
          if (payload.controller) {
            window._portalPolicy.deadlineMin = payload.controller.attendanceDeadlineMin;
          }
          applyPortalSettings(payload);
          if (typeof applyAttendancePolicies === 'function') {
            applyAttendancePolicies();
          }
        }
      })
      .catch(function(err){ console.warn('[Portal policy load error]:', err); });

    if (typeof HardOverduePrompt !== 'undefined' && typeof HardOverduePrompt.start === 'function') {
      HardOverduePrompt.start();
    }
  } else {
    // Unauthenticated fallback: basic public layout
    api('/api/settings/public')
      .then(function(r){ return r.json(); })
      .then(function(pub){ applyPortalSettings(pub); })
      .catch(function(e){ console.warn(e); });
  }
});

// ─────────────────────────────────────────────────────────────
// PLAN 4 (FEATURES 6 & 11): FACULTY LEAVE & SUBSTITUTION LOGIC
// ─────────────────────────────────────────────────────────────

var _myTeacherLeaves = [];
var _currentAffectedSlots = [];
var _targetSlotForSubstitute = null;
var _tlCurrentSubTab = 'apps';
var _hodPendingLeaves = [];

function initMyLeavesPage() {
  loadMyTeacherLeaves();
  loadFacultyDepartmentsForFinder();
  // DB.get('user') was never populated (always []), so the HOD tab never
  // appeared. The server enforces HOD/Admin on these endpoints regardless.
  var canReview = !!(currentUser && (currentUser.isHOD || currentUser.isHod || currentUser.isAdmin));
  var btnHod = document.getElementById('tab-tl-hod-pending');
  if (btnHod) btnHod.style.display = canReview ? '' : 'none';
  if (canReview) loadHodTeacherLeaves();
  switchTeacherLeaveSubTab(_tlCurrentSubTab || 'apps');
}

function switchTeacherLeaveSubTab(subTab) {
  _tlCurrentSubTab = subTab;
  var btnApps = document.getElementById('tab-tl-apps');
  var btnDuties = document.getElementById('tab-tl-duties');
  var btnHod = document.getElementById('tab-tl-hod-pending');
  var contApps = document.getElementById('cont-tl-apps');
  var contDuties = document.getElementById('cont-tl-duties');
  var contHod = document.getElementById('cont-tl-hod-pending');

  if (btnApps) btnApps.classList.toggle('act', subTab === 'apps');
  if (btnDuties) btnDuties.classList.toggle('act', subTab === 'duties');
  if (btnHod) btnHod.classList.toggle('act', subTab === 'hod-pending');
  if (contApps) contApps.style.display = subTab === 'apps' ? '' : 'none';
  if (contDuties) contDuties.style.display = subTab === 'duties' ? '' : 'none';
  if (contHod) contHod.style.display = subTab === 'hod-pending' ? '' : 'none';

  if (subTab === 'hod-pending') {
    loadHodTeacherLeaves();
  }
}

function loadHodTeacherLeaves() {
  var tbody = document.getElementById('tl-hod-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--tdi);">Loading department requests…</td></tr>';

  api('/api/leave/teacher/pending-hod', { headers: authHeaders() })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      _hodPendingLeaves = Array.isArray(data) ? data : [];
      var badge = document.getElementById('tl-hod-badge');
      if (badge) {
        badge.textContent = _hodPendingLeaves.length;
        badge.style.display = _hodPendingLeaves.length > 0 ? 'inline-block' : 'none';
      }
      renderHodTeacherLeavesTable();
    })
    .catch(function(err) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#dc2626;">Failed to load department requests.</td></tr>';
    });
}
window.loadHodTeacherLeaves = loadHodTeacherLeaves;

function renderHodTeacherLeavesTable() {
  var tbody = document.getElementById('tl-hod-tbody');
  if (!tbody) return;

  if (_hodPendingLeaves.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:#16a34a;font-weight:600;"><re-icon icon="check"></re-icon> No pending department leave requests to review.</td></tr>';
    return;
  }

  tbody.innerHTML = _hodPendingLeaves.map(function(l) {
    var dateRange = l.fromDate === l.toDate ? formatDDMMYYYY(l.fromDate) : (formatDDMMYYYY(l.fromDate) + ' to ' + formatDDMMYYYY(l.toDate));
    var subsHtml = (l.substitutions && l.substitutions.length > 0)
      ? l.substitutions.map(function(s) {
          return '<div style="font-size:11px;margin:2px 0;"><strong>' + escapeHtml(s.className || 'Class') + ' · P' + escapeHtml(s.periodNumber) + ':</strong> ' + escapeHtml(s.substituteTeacherName || 'Substitute') + '</div>';
        }).join('')
      : '<span style="color:var(--tmu);font-size:11px;">None</span>';

    return '<tr>'
      + '<td><strong>' + escapeHtml(l.teacherName || 'Faculty') + '</strong><div style="font-size:11px;color:var(--tmu);">' + escapeHtml(l.employeeNo || l.teacherEmpId || l.deptCode || '') + '</div></td>'
      + '<td><span class="tt-slot-badge badge-theory">' + escapeHtml(l.category) + '</span><div style="font-size:11px;color:var(--tmu);">' + escapeHtml(l.leaveType) + '</div></td>'
      + '<td><strong>' + dateRange + '</strong><div style="font-size:11px;color:var(--tdi);">' + (l.slot || 'Full Day') + '</div></td>'
      + '<td><strong>' + (l.daysCount || 1) + 'd</strong></td>'
      + '<td style="font-size:11.5px;max-width:180px;white-space:normal;">' + escapeHtml(l.reason || '—') + '</td>'
      + '<td>' + subsHtml + '</td>'
      + '<td style="text-align:center;white-space:nowrap;">'
      + '  <button class="btno bsm" style="margin-right:6px;font-size:11px;padding:4px 10px;background:var(--gD);color:#fff;border-color:var(--gD);" onclick="approveTeacherLeaveHod(\'' + l._id + '\')"><re-icon icon="check"></re-icon> Approve</button>'
      + '  <button class="btno bsm" style="font-size:11px;padding:4px 10px;color:#dc2626;border-color:rgba(220,38,38,0.4);" onclick="rejectTeacherLeaveHod(\'' + l._id + '\')"><re-icon icon="x"></re-icon> Reject</button>'
      + '</td>'
      + '</tr>';
  }).join('');
}

async function approveTeacherLeaveHod(id) {
  const ok = await showConfirm(
    'Approve this faculty leave request?\n\nThis will automatically create Timetable Day Overrides for all arranged substitute slots and notify the substitute teachers.',
    'Approve Faculty Leave'
  );
  if (!ok) return;
  api('/api/leave/teacher/' + id + '/hod-approve', {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' })
  })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) {
        showToast(data.error, 'error');
      } else {
        showToast('Leave approved & timetable substitutions registered!', 'success');
        loadHodTeacherLeaves();
      }
    })
    .catch(function(err) {
      showToast('Failed to approve leave: ' + err.message, 'error');
    });
}
window.approveTeacherLeaveHod = approveTeacherLeaveHod;

async function rejectTeacherLeaveHod(id) {
  var reason = await showPrompt('Enter reason for rejecting this leave request:', '', 'Reject Leave Request');
  if (reason === null) return;
  api('/api/leave/teacher/' + id + '/hod-reject', {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ remarks: reason })
  })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) {
        showToast(data.error, 'error');
      } else {
        showToast('Leave request rejected', 'info');
        loadHodTeacherLeaves();
      }
    })
    .catch(function(err) {
      showToast('Failed to reject leave: ' + err.message, 'error');
    });
}
window.rejectTeacherLeaveHod = rejectTeacherLeaveHod;

function loadMyTeacherLeaves() {
  var tbodyApps = document.getElementById('tl-apps-tbody');
  if (tbodyApps) tbodyApps.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--tdi);">Loading your leave requests…</td></tr>';

  // Load configured annualLeaveQuota from portal settings
  if (window._pubSettings && window._pubSettings.teachers && window._pubSettings.teachers.annualLeaveQuota !== undefined) {
    window._teacherAnnualLeaveQuota = Number(window._pubSettings.teachers.annualLeaveQuota) || 15;
    updateTeacherLeaveKPIs();
  } else {
    api('/api/settings/teacher-portal')
      .then(function(r) { return r.json(); })
      .then(function(s) {
        var payload = s && s.data ? s.data : s;
        if (payload && payload.teachers && payload.teachers.annualLeaveQuota !== undefined) {
          window._teacherAnnualLeaveQuota = Number(payload.teachers.annualLeaveQuota) || 15;
          updateTeacherLeaveKPIs();
        }
      })
      .catch(function() {});
  }

  // Fetch real-time balance breakdown if available
  api('/api/leave/balance', { headers: authHeaders() })
    .then(function(r) { return r.json(); })
    .then(function(bal) {
      if (bal && bal.ok && bal.data) {
        if (typeof bal.data.annualLeaveQuota === 'number') {
          window._teacherAnnualLeaveQuota = bal.data.annualLeaveQuota;
        }
        if (typeof bal.data.remainingLeaves === 'number') {
          window._teacherRemainingLeaves = bal.data.remainingLeaves;
        }
        updateTeacherLeaveKPIs();
      }
    })
    .catch(function() {});

  api('/api/leave/teacher/my-requests', { headers: authHeaders() })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      _myTeacherLeaves = Array.isArray(data) ? data : [];
      renderTeacherLeavesTable();
      updateTeacherLeaveKPIs();
      renderTeacherSubstituteDuties();
    })
    .catch(function(err) {
      if (tbodyApps) tbodyApps.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#dc2626;">Failed to load leave requests.</td></tr>';
    });
}

function updateTeacherLeaveKPIs() {
  var total = _myTeacherLeaves.length;
  var pending = _myTeacherLeaves.filter(function(l) {
    return ['Pending', 'pending', 'pending_hod', 'pending_principal'].includes(l.status);
  }).length;
  var subs = _myTeacherLeaves.reduce(function(acc, l) { return acc + (l.substitutions ? l.substitutions.length : 0); }, 0);

  // Calculate approved leave days taken
  var approvedDays = _myTeacherLeaves
    .filter(function(l) { return String(l.status).toLowerCase() === 'approved'; })
    .reduce(function(acc, l) {
      var d = Number(l.daysCount);
      if (isNaN(d) || d <= 0) {
        d = Array.isArray(l.dates) && l.dates.length ? l.dates.length : 1;
      }
      return acc + d;
    }, 0);

  var totalQuota = (typeof window._teacherAnnualLeaveQuota === 'number') ? window._teacherAnnualLeaveQuota : 15;
  var remainingLeaves = Math.max(0, totalQuota - approvedDays);
  if (typeof window._teacherRemainingLeaves === 'number') {
    remainingLeaves = window._teacherRemainingLeaves;
  }

  var elTot = document.getElementById('tl-stat-total');
  var elRem = document.getElementById('tl-stat-remaining') || document.getElementById('tl-stat-approved');
  var elApp = document.getElementById('tl-stat-approved');
  var elPen = document.getElementById('tl-stat-pending');
  var elSub = document.getElementById('tl-stat-subs');

  if (elTot) elTot.textContent = total;
  if (elRem) elRem.textContent = remainingLeaves;
  if (elApp && elApp !== elRem) elApp.textContent = remainingLeaves;
  if (elPen) elPen.textContent = pending;
  if (elSub) elSub.textContent = subs;
}

function renderTeacherLeavesTable() {
  var tbody = document.getElementById('tl-apps-tbody');
  if (!tbody) return;

  if (_myTeacherLeaves.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--tdi);">No leave requests submitted yet. Click <strong>"Apply for Leave"</strong> to begin.</td></tr>';
    return;
  }

  tbody.innerHTML = _myTeacherLeaves.map(function(l) {
    var appliedDate = l.createdAt ? formatDDMMYYYY(l.createdAt) : '—';
    var dateRange = l.fromDate === l.toDate ? formatDDMMYYYY(l.fromDate) : (formatDDMMYYYY(l.fromDate) + ' to ' + formatDDMMYYYY(l.toDate));

    var subsBadge = '';
    if (l.substitutions && l.substitutions.length > 0) {
      subsBadge = l.substitutions.map(function(s) {
        return '<span class="tt-slot-badge badge-sub" style="display:inline-block;margin:2px 3px;font-size:11px;">P' + escapeHtml(s.periodNumber) + ': ' + escapeHtml(s.substituteTeacherName) + '</span>';
      }).join('');
    } else {
      subsBadge = '<span style="color:var(--tdi);font-size:11px;">None</span>';
    }

    var isDraft = l.status === 'draft';
    var isPendingHod = l.status === 'pending_hod' || (l.status === 'Pending' && (l.hodStatus === 'Pending' || !l.hodStatus));
    var isPendingPrincipal = l.status === 'pending_principal' || (l.hodStatus === 'Approved' && l.principalStatus === 'Pending');
    var isApproved = String(l.status).toLowerCase() === 'approved';
    var isRejected = String(l.status).toLowerCase() === 'rejected';

    var statusColor = '#d97706';
    var statusBg = 'rgba(217,119,6,0.1)';
    var statusText = l.status;

    if (isDraft) {
      statusColor = '#475569';
      statusBg = 'rgba(100,116,139,0.12)';
      statusText = 'Draft';
    } else if (isApproved) {
      statusColor = '#16a34a';
      statusBg = 'rgba(22,163,74,0.12)';
      statusText = 'Approved';
    } else if (isRejected) {
      statusColor = '#dc2626';
      statusBg = 'rgba(220,38,38,0.12)';
      statusText = 'Rejected';
    } else if (isPendingPrincipal) {
      statusColor = '#2563eb';
      statusBg = 'rgba(37,99,235,0.12)';
      statusText = 'Pending Principal';
    } else if (isPendingHod) {
      statusColor = '#d97706';
      statusBg = 'rgba(217,119,6,0.12)';
      statusText = l.isEmergency ? 'Pending HOD (Urgent)' : 'Pending HOD';
    }

    var hodStatusHtml = '—';
    if (!isDraft) {
      if (l.hodStatus === 'Approved' || l.hodStatus === 'Permitted') {
        hodStatusHtml = '<span style="color:#16a34a;font-weight:700;"><re-icon icon="check" size="12"></re-icon> Approved</span>';
      } else if (l.hodStatus === 'Rejected') {
        hodStatusHtml = '<span style="color:#dc2626;font-weight:700;"><re-icon icon="x" size="12"></re-icon> Rejected</span>';
      } else if (l.hodStatus === 'N/A') {
        hodStatusHtml = '<span style="color:var(--tmu);font-size:11px;">N/A</span>';
      } else {
        hodStatusHtml = '<span style="color:#d97706;font-weight:700;"><re-icon icon="clock" size="12"></re-icon> Pending</span>';
      }
    }

    var actionHtml = '<span style="color:var(--tdi);font-size:11px;">—</span>';
    if (isDraft) {
      actionHtml = '<button class="btno bsm" style="font-size:11px;padding:3px 9px;color:#2563eb;border-color:rgba(37,99,235,0.4);" onclick="editTeacherLeaveDraft(\'' + l._id + '\')"><re-icon icon="edit-3" size="12"></re-icon> Edit</button>'
        + '<button class="btno bsm" style="color:#dc2626;border-color:rgba(220,38,38,0.3);font-size:11px;padding:3px 7px;margin-left:4px;" onclick="deleteTeacherLeaveDraft(\'' + l._id + '\')"><re-icon icon="trash-2" size="12"></re-icon></button>';
    } else if (isPendingHod || isPendingPrincipal) {
      actionHtml = '<button class="btno bsm" style="color:#dc2626;border-color:rgba(220,38,38,0.3);" onclick="cancelTeacherLeaveReq(\'' + (l.requestId || l._id) + '\')">Cancel</button>';
    }

    return '<tr>'
      + '<td style="font-weight:600;font-size:12px;">' + appliedDate + (l.requestId ? '<div style="font-size:10.5px;color:var(--tmu);font-family:monospace;font-weight:600;margin-top:2px;">' + escapeHtml(l.requestId) + '</div>' : '') + '</td>'
      + '<td><span class="tt-slot-badge badge-theory">' + escapeHtml(l.category) + '</span><div style="font-size:11px;color:var(--tmu);margin-top:2px;">' + escapeHtml(l.leaveType) + '</div></td>'
      + '<td><div style="font-weight:700;font-size:12px;">' + dateRange + '</div><div style="font-size:11px;color:var(--tdi);">' + (l.slot || 'Full Day') + '</div></td>'
      + '<td style="font-weight:700;">' + (l.daysCount || 1) + 'd</td>'
      + '<td style="font-size:12px;max-width:180px;white-space:normal;">' + escapeHtml(l.reason || '—') + '</td>'
      + '<td>' + subsBadge + '</td>'
      + '<td>' + hodStatusHtml + '</td>'
      + '<td><span style="display:inline-block;padding:3px 9px;border-radius:10px;font-size:11px;font-weight:800;background:' + statusBg + ';color:' + statusColor + ';">' + statusText + '</span></td>'
      + '<td>' + actionHtml + '</td>'
      + '</tr>';
  }).join('');
}

function renderTeacherSubstituteDuties() {
  var tbody = document.getElementById('tl-duties-tbody');
  if (!tbody) return;

  var fromDate = todayISO();
  var dTo = new Date();
  dTo.setDate(dTo.getDate() + 13);
  var toDate = localISO(dTo);

  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--tdi);">Loading substitution duties…</td></tr>';

  api('/api/timetable/my-schedule?from=' + encodeURIComponent(fromDate) + '&to=' + encodeURIComponent(toDate), {
    headers: authHeaders()
  })
    .then(function(res) {
      if (!res.ok) throw new Error('Failed to load schedule');
      return res.json();
    })
    .then(function(result) {
      var days = result?.data?.days || [];
      var duties = [];
      days.forEach(function(day) {
        (day.slots || []).forEach(function(slot) {
          if (slot.role === 'substitute') {
            duties.push(Object.assign({}, slot, {
              date: day.date,
              dayName: day.dayFull || day.day
            }));
          }
        });
      });

      duties.sort(function(a, b) {
        return (a.date || '').localeCompare(b.date || '') || (a.periodNumber || 0) - (b.periodNumber || 0);
      });

      if (duties.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--tdi);">No upcoming substitution duties assigned.</td></tr>';
        return;
      }

      var todayStr = todayISO();
      tbody.innerHTML = duties.map(function(s) {
        var isToday = s.date === todayStr;
        var isMarked = s.attendance && s.attendance.marked;
        var actionCol = '';

        if (isToday) {
          if (isMarked) {
            actionCol = '<span style="color:#16a34a;font-weight:700;display:inline-flex;align-items:center;gap:4px;"><re-icon icon="check-circle"></re-icon> Done</span>';
          } else {
            actionCol = '<button class="attbtn" onclick="navigateToAttendance(\'' + (s.classTrackId || toClassTrackId(s.classId) || '') + '\',\'' + (s.subjectId || '') + '\',' + (s.periodNumber || 1) + ',\'' + s.date + '\')"><re-icon icon="clipboard-list"></re-icon> Take Att.</button>';
          }
        } else if (s.date > todayStr) {
          actionCol = '<span style="color:var(--tmu);font-size:12px;background:var(--bg2,#f1f5f9);padding:3px 8px;border-radius:6px;font-weight:600;">Upcoming</span>';
        } else {
          actionCol = isMarked
            ? '<span style="color:#16a34a;font-size:12px;font-weight:700;"><re-icon icon="check-circle"></re-icon> Done</span>'
            : '<span style="color:var(--tdi);font-size:12px;">Past</span>';
        }

        var timeDisplay = (s.start && s.end) ? ' (' + s.start + '–' + s.end + ')' : '';
        return '<tr>'
          + '<td style="font-weight:700;">' + escapeHtml(s.date) + '</td>'
          + '<td><strong>Period ' + s.periodNumber + '</strong>' + timeDisplay + '</td>'
          + '<td><span class="tt-slot-badge badge-comb">' + escapeHtml(s.className || '—') + '</span></td>'
          + '<td><strong>' + escapeHtml(s.subjectName || '—') + '</strong>' + (s.subjectCode ? ' <span style="font-size:11px;color:var(--tmu);">(' + escapeHtml(s.subjectCode) + ')</span>' : '') + '</td>'
          + '<td>' + escapeHtml(s.room || '—') + '</td>'
          + '<td><span class="tt-slot-badge badge-sub">Substitute for ' + escapeHtml(s.originalTeacher || 'Faculty') + '</span></td>'
          + '<td>' + actionCol + '</td>'
          + '</tr>';
      }).join('');
    })
    .catch(function() {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--tdi);">No upcoming substitution duties assigned.</td></tr>';
    });
}

async function cancelTeacherLeaveReq(id) {
  const ok = await showConfirm('Are you sure you want to cancel this leave request?', 'Cancel Leave Request', null, null, { danger: true, confirmText: 'Cancel Request' });
  if (!ok) return;
  api('/api/leave/teacher/cancel/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: authHeaders()
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    if (data.error) showToast(data.error, 'danger');
    else {
      showToast('Leave request cancelled successfully', 'success');
      loadMyTeacherLeaves();
    }
  })
  .catch(function(err) { showToast(err.message, 'danger'); });
}

// ── LEAVE APPLICATION & AFFECTED SLOTS MODAL ──

var _currentEditingDraftId = null;

function openTeacherApplyLeaveModal(prefillDate, draftData) {
  _currentEditingDraftId = draftData ? (draftData._id || draftData.requestId || null) : null;

  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var startStr = (draftData && draftData.fromDate) || prefillDate || localISO(tomorrow);
  var endStr = (draftData && draftData.toDate) || startStr;
  var todayStr = localISO(new Date());

  var fromEl = document.getElementById('tl-from');
  var toEl = document.getElementById('tl-to');
  if (fromEl) {
    fromEl.value = startStr;
    fromEl.defaultValue = startStr;
    fromEl.min = todayStr;
  }
  if (toEl) {
    toEl.value = endStr;
    toEl.defaultValue = endStr;
    toEl.min = startStr;
  }

  var catEl = document.getElementById('tl-cat');
  if (catEl && draftData && draftData.category) catEl.value = draftData.category;

  var typeEl = document.getElementById('tl-type');
  if (typeEl && draftData && draftData.leaveType) typeEl.value = draftData.leaveType;

  var slotEl = document.getElementById('tl-slot');
  if (slotEl && draftData && draftData.slot) slotEl.value = draftData.slot;

  var rEl = document.getElementById('tl-reason');
  if (rEl) {
    rEl.value = (draftData && draftData.reason && draftData.reason !== 'Draft') ? draftData.reason : '';
    rEl.defaultValue = rEl.value;
  }

  var emEl = document.getElementById('tl-emergency');
  if (emEl) {
    emEl.checked = Boolean(draftData && draftData.isEmergency);
    emEl.defaultChecked = emEl.checked;
    if (emEl.checked && fromEl) fromEl.removeAttribute('min');
  }

  var modalEl = document.getElementById('m-teacher-apply-leave');
  if (modalEl) {
    modalEl.dataset.noDirtyConfirm = 'true';
    modalEl.dataset.dirty = 'false';
  }

  openModal('m-teacher-apply-leave');
  fetchTeacherAffectedSlots();
  updateLeavePolicyMeter();
}
window.openTeacherApplyLeaveModal = openTeacherApplyLeaveModal;

function editTeacherLeaveDraft(id) {
  var draft = _myTeacherLeaves.find(function(l) {
    return String(l._id) === String(id) || String(l.requestId) === String(id);
  });
  if (!draft) return;
  openTeacherApplyLeaveModal(draft.fromDate, draft);
}
window.editTeacherLeaveDraft = editTeacherLeaveDraft;

async function deleteTeacherLeaveDraft(id) {
  var ok = await showConfirm('Are you sure you want to delete this saved leave draft?', 'Delete Draft', null, null, { danger: true, confirmText: 'Delete Draft' });
  if (!ok) return;
  api('/api/leave/teacher/draft/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: authHeaders()
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    if (data.error) showToast(data.error, 'danger');
    else {
      showToast('Leave draft deleted', 'info');
      loadMyTeacherLeaves();
    }
  })
  .catch(function(err) {
    showToast(err.message, 'danger');
  });
}
window.deleteTeacherLeaveDraft = deleteTeacherLeaveDraft;

function fetchTeacherAffectedSlots() {
  var fromDate = document.getElementById('tl-from')?.value;
  var toDate = document.getElementById('tl-to')?.value || fromDate;
  var slot = document.getElementById('tl-slot')?.value || 'Full Day';
  var cont = document.getElementById('tl-affected-slots-container');
  var badge = document.getElementById('tl-slots-count-badge');

  if (!fromDate) {
    if (cont) cont.innerHTML = '<div style="text-align:center;padding:16px;color:var(--tdi);font-size:12px;">Select valid dates above.</div>';
    return;
  }
  if (toDate < fromDate) {
    if (cont) cont.innerHTML = '<div style="text-align:center;padding:16px;color:#dc2626;font-size:12px;">To Date cannot be earlier than From Date.</div>';
    return;
  }

  if (cont) cont.innerHTML = '<div style="text-align:center;padding:16px;color:var(--tdi);font-size:12px;"><re-icon icon="search"></re-icon> Detecting scheduled teaching slots…</div>';

  api('/api/leave/affected-slots?fromDate=' + encodeURIComponent(fromDate) + '&toDate=' + encodeURIComponent(toDate) + '&slot=' + encodeURIComponent(slot), {
    headers: authHeaders()
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    _currentAffectedSlots = (data.affectedSlots || []).map(function(s) {
      return Object.assign({}, s, {
        substituteTeacherTrackId: '',
        substituteTeacherName: '',
        substituteTeacherId: null
      });
    });

    if (badge) badge.textContent = _currentAffectedSlots.length + ' class slot(s)';
    renderAffectedSlotsList();
  })
  .catch(function(err) {
    if (cont) cont.innerHTML = '<div style="text-align:center;padding:16px;color:#dc2626;font-size:12px;">Failed to fetch schedule slots.</div>';
  });
}

function renderAffectedSlotsList() {
  var cont = document.getElementById('tl-affected-slots-container');
  if (!cont) return;

  if (_currentAffectedSlots.length === 0) {
    cont.innerHTML = '<div style="text-align:center;padding:16px;color:#16a34a;font-size:12.5px;font-weight:700;"><re-icon icon="check-circle"></re-icon> No scheduled classes on these selected dates/periods! No substitutions required.</div>';
    return;
  }

  cont.innerHTML = _currentAffectedSlots.map(function(slot, idx) {
    var subAssigned = slot.substituteTeacherName;
    var subDisplay = subAssigned
      ? '<span style="font-size:12px;font-weight:800;color:#16a34a;background:rgba(22,163,74,0.12);padding:4px 10px;border-radius:10px;display:inline-flex;align-items:center;gap:5px;"><re-icon icon="check-circle"></re-icon> Sub: ' + escapeHtml(slot.substituteTeacherName) + '</span>'
      : '<span style="font-size:11.5px;font-weight:700;color:#d97706;background:rgba(217,119,6,0.1);padding:4px 9px;border-radius:10px;"><re-icon icon="alert-triangle"></re-icon> Substitute Required</span>';

    return '<div style="display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid var(--brl);border-radius:10px;padding:10px 14px;flex-wrap:wrap;gap:8px;">'
      + '<div>'
      + '  <div style="font-size:13px;font-weight:800;color:var(--td);">' + escapeHtml(slot.className || 'Class') + ' · Period ' + escapeHtml(slot.periodNumber) + ' (' + escapeHtml(slot.day || '') + ', ' + formatDDMMYYYY(slot.date) + ')</div>'
      + '  <div style="font-size:11.5px;color:var(--tmu);margin-top:2px;">Subject: <strong>' + escapeHtml(slot.subjectName) + '</strong> (' + escapeHtml(slot.subjectCode || '—') + ') · Room: ' + escapeHtml(slot.hallNo || '—') + '</div>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + subDisplay
      + '  <button type="button" class="btn-out bsm" onclick="openSubstituteFinderModal(' + idx + ')" style="padding:4px 10px;font-size:11.5px;display:inline-flex;align-items:center;gap:4px;">'
      + '    <re-icon icon="user-plus" size="13"></re-icon> ' + (subAssigned ? 'Change' : 'Find Substitute')
      + '  </button>'
      + '</div>'
      + '</div>';
  }).join('');
}

var _targetSlotForSubstitute = null;
function openSubstituteFinderModal(slotIdx) {
  _targetSlotForSubstitute = slotIdx;
  var slot = _currentAffectedSlots[slotIdx];
  if (!slot) return;

  var subHeader = document.getElementById('fsf-header-sub');
  if (subHeader) {
    subHeader.textContent = 'Finding available faculty for ' + slot.className + ' (Period ' + slot.periodNumber + ' on ' + slot.date + ')';
  }

  var dInput = document.getElementById('fsf-date');
  if (dInput) dInput.value = slot.date;

  var pInput = document.getElementById('fsf-period');
  if (pInput) pInput.value = slot.periodNumber;

  openModal('m-free-slot-finder');
  runFreeSlotSearch();
}

function runFreeSlotSearch() {
  var date = document.getElementById('fsf-date')?.value;
  var period = document.getElementById('fsf-period')?.value;
  var cont = document.getElementById('fsf-results-tbody');
  if (!cont) return;

  if (!date || !period) {
    cont.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--tdi);">Select date and period.</td></tr>';
    return;
  }

  cont.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--tdi);"><re-icon icon="search"></re-icon> Checking live faculty availability…</td></tr>';

  api('/api/leave/substitutes/available?date=' + encodeURIComponent(date) + '&periodNumber=' + encodeURIComponent(period), {
    headers: authHeaders()
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    var teachers = data.availableTeachers || [];
    if (teachers.length === 0) {
      cont.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#dc2626;font-weight:600;">No free teachers found for this period. You may mark slot emergency or appoint HOD directly.</td></tr>';
      return;
    }

    cont.innerHTML = teachers.map(function(t) {
      return '<tr>'
        + '<td style="font-weight:700;">' + escapeHtml(t.name) + '</td>'
        + '<td><span class="tt-slot-badge badge-theory">' + escapeHtml(t.deptCode || t.department || '—') + '</span></td>'
        + '<td style="color:var(--tmu);font-size:11.5px;">' + escapeHtml(t.workloadToday || '0') + ' slot(s) today</td>'
        + '<td><span style="color:#16a34a;font-weight:800;font-size:11.5px;background:rgba(22,163,74,0.1);padding:3px 8px;border-radius:6px;"><re-icon icon="check"></re-icon> Free</span></td>'
        + '<td><button class="btn-pri bxs" onclick="selectSubstituteTeacher(\'' + t.trackId + '\', \'' + escapeHtml(t.name).replace(/'/g, "\\'") + '\', \'' + (t._id || '') + '\')">Assign</button></td>'
        + '</tr>';
    }).join('');
  })
  .catch(function() {
    cont.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#dc2626;">Error querying free slots.</td></tr>';
  });
}

function selectSubstituteTeacher(trackId, name, teacherId) {
  if (_targetSlotForSubstitute === null || !_currentAffectedSlots[_targetSlotForSubstitute]) return;

  _currentAffectedSlots[_targetSlotForSubstitute].substituteTeacherTrackId = trackId;
  _currentAffectedSlots[_targetSlotForSubstitute].substituteTeacherName = name;
  _currentAffectedSlots[_targetSlotForSubstitute].substituteTeacherId = teacherId;

  closeModalBg('m-free-slot-finder', true);
  renderAffectedSlotsList();
  showToast('Assigned ' + name + ' as substitute for slot ' + (_targetSlotForSubstitute + 1), 'success');
}

async function submitTeacherLeaveApplication(isDraft) {
  isDraft = Boolean(isDraft);
  var category = document.getElementById('tl-cat')?.value || 'Leave';
  var leaveType = document.getElementById('tl-type')?.value || 'Casual Leave';
  var slot = document.getElementById('tl-slot')?.value || 'Full Day';
  var fromDate = document.getElementById('tl-from')?.value;
  var toDate = document.getElementById('tl-to')?.value || fromDate;
  var reason = document.getElementById('tl-reason')?.value || '';
  var isEmergency = document.getElementById('tl-emergency')?.checked || false;

  if (!fromDate) {
    showToast('Please select a valid start date', 'warning');
    return;
  }
  if (toDate < fromDate) {
    showToast('End date (To Date) cannot be earlier than start date (From Date)', 'warning');
    return;
  }

  if (!isDraft && !reason.trim()) {
    showToast('Please enter a reason for the leave', 'warning');
    return;
  }

  var unassignedSlots = _currentAffectedSlots.filter(function(s) { return !s.substituteTeacherTrackId; });
  if (!isDraft && unassignedSlots.length > 0 && !isEmergency) {
    const ok = await showConfirm(
      'You have ' + unassignedSlots.length + ' scheduled class(es) without an assigned substitute teacher. Would you like to proceed anyway?',
      'Unassigned Substitutes Warning',
      null,
      null,
      { type: 'warn', confirmText: 'Proceed Anyway' }
    );
    if (!ok) return;
  }

  var payload = {
    draftId: _currentEditingDraftId || undefined,
    isDraft: isDraft,
    category: category,
    leaveType: leaveType,
    slot: slot,
    fromDate: fromDate,
    toDate: toDate,
    reason: (reason || (isDraft ? 'Draft' : '')).trim(),
    isEmergency: isEmergency,
    substitutions: _currentAffectedSlots
      .filter(function(s) { return !!s.substituteTeacherTrackId; })
      .map(function(s) {
        return {
          date: s.date,
          day: s.day,
          periodNumber: s.periodNumber,
          classId: s.classId,
          className: s.className,
          subjectName: s.subjectName,
          hallNo: s.hallNo,
          substituteTeacherTrackId: s.substituteTeacherTrackId,
          substituteTeacherName: s.substituteTeacherName,
          substituteTeacherId: s.substituteTeacherId
        };
      })
  };

  api('/api/leave/teacher/apply', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    if (data.error) {
      showToast(data.error, 'danger');
    } else {
      _currentEditingDraftId = null;
      var msg = isDraft
        ? 'Leave application draft saved successfully!'
        : 'Faculty leave request submitted successfully!';
      showToast(msg, 'success');
      // Force close without dirty/unsaved changes prompt
      closeModalBg('m-teacher-apply-leave', true);
      loadMyTeacherLeaves();
    }
  })
  .catch(function(err) {
    showToast(err.message, 'danger');
  });
}
window.submitTeacherLeaveApplication = submitTeacherLeaveApplication;

// Anti-DevTools handlers removed (S9 fix)

function hideMsgToast() { /* no-op - toast hidden by timer */ }

// ─────────────────────────────────────────────────────────────
// PHASE 4: LIVE SLOT WATCHER (AUTO-POPUP) & LIVE SLOT PROMPT
// ─────────────────────────────────────────────────────────────

var LiveSlotWatcher = (function () {
  var TICK_MS = 30000, timer = null;

  function isBusy() {
    var attSheet = document.getElementById('attsheet');
    if (attSheet && attSheet.style.display === 'block') return true;

    var attendanceModals = ['modal-quick-pass', 'modal-qr-session', 'modal-rep-share', 'modal-qr-review'];
    var hasOpenAttModal = attendanceModals.some(function(id) {
      var m = document.getElementById(id);
      return m && (m.style.display === 'flex' || m.style.display === 'block');
    });
    if (hasOpenAttModal) return true;

    var anyModalBg = Array.from(document.querySelectorAll('.modal-bg.open')).some(function(el) {
      return el.id !== 'm-live-slot';
    });
    if (anyModalBg) return true;

    return false;
  }

  function candidates() {
    var today = todayISO();
    var dayData = getMyDay(today);
    if (!dayData || !Array.isArray(dayData.slots) || dayData.isHoliday || dayData.onLeave) {
      return [];
    }

    var now = Date.now();
    var leadMin = (currentUser.preferences && currentUser.preferences.promptLeadMinutes !== undefined)
      ? Number(currentUser.preferences.promptLeadMinutes)
      : 5;
    var leadMs = leadMin * 60 * 1000;

    var matched = dayData.slots.filter(function(slot) {
      if (!['owner', 'substitute'].includes(slot.role)) return false;
      if (slot.status !== 'scheduled') return false;
      if (slot.attendance && slot.attendance.marked) return false;
      if (slot.isSpanContinuation) return false;

      var sTime = parseSlotTimeToMs(today, slot.start);
      var eTime = parseSlotTimeToMs(today, slot.end);

      // Within prompt window: start - lead <= now < end
      if (now < sTime - leadMs || now >= eTime) return false;

      // Check sessionStorage for dismiss or snooze
      var k = 'eams_slotprompt_' + today + '_' + slot.classId + '_' + slot.periodNumber;
      var rawPrompt = sessionStorage.getItem(k);
      if (rawPrompt) {
        try {
          var parsed = JSON.parse(rawPrompt);
          if (parsed.dismissed) return false;
          if (parsed.snoozeUntil && parsed.snoozeUntil > now) return false;
        } catch (e) {}
      }

      return true;
    });

    // Deduplicate any repeated entries for the same class session / root period
    var seen = new Set();
    var uniqueCandidates = [];
    matched.forEach(function(s) {
      var key = (s.classId || s.className) + '_' + (s.spanRootPeriod || s.periodNumber);
      if (!seen.has(key)) {
        seen.add(key);
        uniqueCandidates.push(s);
      }
    });

    return uniqueCandidates;
  }

  function tick() {
    if (document.visibilityState !== 'visible' || isBusy()) return;
    if (typeof HardOverduePrompt !== 'undefined' && typeof HardOverduePrompt.checkOverdue === 'function') {
      HardOverduePrompt.checkOverdue();
    }
    var autoPrompt = (currentUser.preferences && currentUser.preferences.autoAttendancePrompt !== undefined)
      ? currentUser.preferences.autoAttendancePrompt
      : true;
    if (!autoPrompt) return;

    var due = candidates();
    if (due && due.length) {
      LiveSlotPrompt.open(due);
    }
  }

  function start() {
    if (!timer) {
      tick();
      timer = setInterval(tick, TICK_MS);
    }
  }

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') tick();
  });

  return { start: start, tick: tick, candidates: candidates, isBusy: isBusy };
})();
window.LiveSlotWatcher = LiveSlotWatcher;

var LiveSlotPrompt = (function () {
  var _currentSlots = [];

  function open(slots) {
    if (!Array.isArray(slots) || !slots.length) return;
    _currentSlots = slots;

    var modalEl = document.getElementById('m-live-slot');
    if (!modalEl) return;

    var primarySlot = slots[0];
    var titleEl = document.getElementById('mls-title');
    var subEl = document.getElementById('mls-sub');
    var bodyEl = document.getElementById('mls-body');

    var isSub = primarySlot.role === 'substitute';
    if (titleEl) {
      titleEl.innerHTML = (slots.length > 1)
        ? '<re-icon icon="check-circle" size="18"></re-icon> Classes starting now'
        : (isSub ? '<re-icon icon="refresh" size="18"></re-icon> Substitution Class starting now' : '<re-icon icon="check-circle" size="18"></re-icon> Class starting now');
    }

    if (subEl) {
      var rawRoom = primarySlot.room || primarySlot.hallNo || '';
      var roomStr = rawRoom ? (/^(room|lh|hall|lab)/i.test(rawRoom) ? rawRoom : 'Room ' + rawRoom) : 'Room TBD';
      subEl.textContent = 'P' + primarySlot.periodNumber + ' · ' + primarySlot.start + '–' + primarySlot.end + ' · ' + roomStr;
    }

    if (bodyEl) {
      bodyEl.innerHTML = slots.map(function(s) {
        var subBadge = (s.role === 'substitute')
          ? '<span class="badge-sub-role"><re-icon icon="refresh"></re-icon> Substitute for ' + escapeHtml(s.originalTeacher || 'Faculty') + '</span>'
          : '';
        return '<div class="mls-slot-card">'
          + '<div class="mls-slot-header">'
          +   '<div class="mls-class-name">' + escapeHtml(s.className) + '</div>'
          +   '<span class="tt-slot-badge ' + (s.isLab ? 'badge-lab' : 'tt-badge') + '">' + escapeHtml(s.type || 'Theory') + '</span>'
          + '</div>'
          + '<div class="mls-subject-name">' + escapeHtml(s.subjectName || s.subject) + '</div>'
          + (subBadge ? '<div style="margin-top:6px;">' + subBadge + '</div>' : '')
          + '</div>';
      }).join('');
    }

    // Check attendance settings toggles for method buttons
    var pub = window._publicSettings || (DB.get('settings') || {}).public || {};
    var att = pub.attendance || {};
    var repBtn = document.getElementById('mls-rep');
    if (repBtn) repBtn.style.display = (att.forwardToRep === false) ? 'none' : 'inline-flex';
    var codeBtn = document.getElementById('mls-code');
    if (codeBtn) codeBtn.style.display = (att.quickPass === false || att.liveSessions === false) ? 'none' : 'inline-flex';
    var qrBtn = document.getElementById('mls-qr');
    if (qrBtn) qrBtn.style.display = (att.liveSessions === false) ? 'none' : 'inline-flex';

    modalEl.classList.add('open');
    modalEl.style.display = 'flex';

    var manualBtn = document.getElementById('mls-manual');
    if (manualBtn) manualBtn.focus();
  }

  function close(action) {
    var due = _currentSlots || [];
    var today = todayISO();

    due.forEach(function(s) {
      var k = 'eams_slotprompt_' + today + '_' + s.classId + '_' + s.periodNumber;
      if (action === 'dismiss') {
        sessionStorage.setItem(k, JSON.stringify({ dismissed: true }));
      } else if (action === 'snooze') {
        sessionStorage.setItem(k, JSON.stringify({ snoozeUntil: Date.now() + 5 * 60 * 1000 }));
      }
    });

    var modalEl = document.getElementById('m-live-slot');
    if (modalEl) {
      modalEl.classList.remove('open');
      modalEl.style.display = 'none';
    }
    _currentSlots = [];
  }

  function method(m) {
    var due = _currentSlots.slice();
    if (!due.length) {
      close('dismiss');
      return;
    }
    var slot = due[0];

    // Mark dismissed in sessionStorage so it doesn't re-prompt
    var today = todayISO();
    due.forEach(function(s) {
      var k = 'eams_slotprompt_' + today + '_' + s.classId + '_' + s.periodNumber;
      sessionStorage.setItem(k, JSON.stringify({ dismissed: true }));
    });

    var modalEl = document.getElementById('m-live-slot');
    if (modalEl) {
      modalEl.classList.remove('open');
      modalEl.style.display = 'none';
    }
    _currentSlots = [];

    navigateToAttendance(slot.classTrackId || toClassTrackId(slot.classId), slot.subjectId, slot.periodNumber, today);

    setTimeout(function() {
      if (m === 'manual') {
        loadAttendanceSheet();
      } else {
        triggerAttendanceMethod(m);
      }
    }, 450);
  }

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var m = document.getElementById('m-live-slot');
      if (m && (m.classList.contains('open') || m.style.display === 'flex')) {
        close('dismiss');
      }
    }
  });

  function startClass() {
    var due = _currentSlots.slice();
    if (!due.length) {
      close('dismiss');
      return;
    }
    var slot = due[0];
    var startBtn = document.getElementById('mls-start');
    var origHtml = startBtn ? startBtn.innerHTML : '';
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.innerHTML = '<re-icon icon="loader" size="14"></re-icon> Starting...';
    }

    var doStart = function(coords) {
      api('/api/sessions/today', { headers: authHeaders() })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(res) {
          var sessions = (res && res.sessions) ? res.sessions : [];
          var match = sessions.find(function(s) {
            return s.periodNumber === slot.periodNumber && (
              String(s.classId) === String(slot.classId) ||
              s.className === slot.className
            );
          });
          if (!match && sessions.length) {
            match = sessions.find(function(s) { return s.periodNumber === slot.periodNumber; });
          }
          if (match && match._id) {
            return api('/api/sessions/start', {
              method: 'POST',
              headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
              body: JSON.stringify({
                sessionId: match._id,
                lat: coords ? coords.latitude : null,
                lng: coords ? coords.longitude : null,
                geo: coords ? null : 'denied'
              })
            }).then(function(r) { return r.json(); });
          } else {
            return { ok: true, message: 'Class session verified' };
          }
        })
        .then(function(startRes) {
          if (startRes && startRes.ok) {
            if (typeof showToast === 'function') {
              showToast('Class started successfully! (Campus geofence verified)', 'success');
            } else if (typeof toast === 'function') {
              toast('Class started successfully! (Campus geofence verified)', 'success');
            }
          }
          close('dismiss');
        })
        .catch(function(err) {
          console.warn('Start class error', err);
          close('dismiss');
        })
        .finally(function() {
          if (startBtn) {
            startBtn.disabled = false;
            startBtn.innerHTML = origHtml;
          }
        });
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function(pos) { doStart(pos.coords); },
        function() { doStart(null); },
        { enableHighAccuracy: true, timeout: 3500, maximumAge: 60000 }
      );
    } else {
      doStart(null);
    }
  }

  return {
    open: open,
    close: close,
    method: method,
    startClass: startClass,
    get currentSlots() { return _currentSlots; }
  };
})();
window.LiveSlotPrompt = LiveSlotPrompt;

// ─────────────────────────────────────────────────────────────
// HARD OVERDUE ATTENDANCE PROMPT & BANNER (BUG FIX B1)
// ─────────────────────────────────────────────────────────────

var HardOverduePrompt = (function () {
  var _overdueSlots = [];
  var _activeSlot = null;
  var _deadlineMin = 10;
  var _hardReminderEveryMin = 5;
  var _timer = null;

  async function checkOverdue() {
    try {
      if (document.hidden) return;
      var tok = getToken();
      if (!tok) return;

      var res = await api('/api/sessions/today', {
        headers: (typeof authHeaders === 'function') ? authHeaders() : { 'Authorization': 'Bearer ' + tok }
      });
      if (!res || !res.ok) return;

      var data = await res.json();
      _deadlineMin = Number(data.deadlineMin) || (window._portalPolicy && window._portalPolicy.deadlineMin) || 10;
      _hardReminderEveryMin = Number(data.hardReminderEveryMin) || 5;

      var overdue = Array.isArray(data.overdueSessions) ? data.overdueSessions : [];
      _overdueSlots = overdue;

      var banner = document.getElementById('overdue-banner');
      var bannerText = document.getElementById('overdue-banner-text');

      if (overdue.length > 0) {
        _activeSlot = overdue[0];
        var slot = _activeSlot;
        var pNum = slot.periodNumber || (slot.slot && slot.slot.periodNumber) || 1;
        var clsName = slot.className || (slot.class && slot.class.name) || 'Class';
        var subjName = slot.subjectName || slot.subject || '';

        if (banner) {
          banner.style.display = 'block';
          if (bannerText) {
            bannerText.textContent = 'ATTENDANCE OVERDUE: ' + clsName + ' Period ' + pNum + ' exceeds the ' + _deadlineMin + '-minute institutional deadline.';
          }
        }

        // Update modal dynamic contents
        var subEl = document.getElementById('hard-overdue-sub');
        if (subEl) {
          subEl.textContent = 'Slot start + ' + _deadlineMin + ' min deadline exceeded (' + clsName + ' P' + pNum + ')';
        }
        var msgEl = document.getElementById('hard-overdue-msg');
        if (msgEl) {
          msgEl.textContent = 'Attendance for ' + clsName + ' (Period ' + pNum + (subjName ? ' · ' + subjName : '') + ') was not saved within the required ' + _deadlineMin + '-minute institutional window. Institutional regulations require attendance to be recorded immediately.';
        }

        // Check modal snooze / prompt interval
        var now = Date.now();
        var dismissedKey = 'eams_hard_overdue_dismissed_' + (slot._id || (slot.classId + '_' + pNum));
        var dismissedAt = Number(sessionStorage.getItem(dismissedKey)) || 0;
        var reminderIntervalMs = _hardReminderEveryMin * 60 * 1000;

        if (!dismissedAt || (now - dismissedAt >= reminderIntervalMs)) {
          open();
        }
      } else {
        _activeSlot = null;
        if (banner) banner.style.display = 'none';
        close();
      }
    } catch (err) {
      console.warn('[HardOverduePrompt error]:', err);
    }
  }

  function open() {
    var modal = document.getElementById('m-hard-overdue');
    if (modal) {
      modal.classList.add('open');
      modal.style.display = 'flex';
    }
  }

  function close() {
    var modal = document.getElementById('m-hard-overdue');
    if (modal) {
      modal.classList.remove('open');
      modal.style.display = 'none';
    }
  }

  function takeAttendanceNow() {
    var slot = _activeSlot || (_overdueSlots.length ? _overdueSlots[0] : null);
    if (slot) {
      var pNum = slot.periodNumber || 1;
      var dismissedKey = 'eams_hard_overdue_dismissed_' + (slot._id || (slot.classId + '_' + pNum));
      sessionStorage.setItem(dismissedKey, String(Date.now()));
    }
    close();

    if (slot) {
      var sClassId = slot.classId || (slot.class && slot.class._id) || '';
      var sSubjId = slot.subjectId || (slot.subject && slot.subject._id) || '';
      var sPeriod = slot.periodNumber || 1;
      var sDate = slot.date || todayISO();

      navigateToAttendance(sClassId, sSubjId, sPeriod, sDate);
      setTimeout(function () {
        loadAttendanceSheet();
      }, 400);
    } else {
      nav('mark');
    }
  }

  function toggleReport() {
    var form = document.getElementById('hard-problem-form');
    var btn = document.getElementById('btn-hard-report');
    if (!form) return;

    if (form.style.display === 'none' || !form.style.display) {
      form.style.display = 'block';
      if (btn) {
        btn.innerHTML = '<re-icon icon="send" size="14"></re-icon> Submit Report to HOD';
        btn.classList.add('btn-pri');
      }
    } else {
      submitReport();
    }
  }

  async function submitReport() {
    var slot = _activeSlot || (_overdueSlots.length ? _overdueSlots[0] : null);
    var reasonEl = document.getElementById('hard-problem-reason');
    var noteEl = document.getElementById('hard-problem-note');
    var btn = document.getElementById('btn-hard-report');

    var reason = reasonEl ? reasonEl.value : 'Class not held';
    var note = noteEl ? noteEl.value.trim() : '';

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-spinner" style="margin-right:6px;"></span> Submitting...';
    }

    try {
      var tok = getToken();
      var res = await api('/api/sessions/report-problem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + tok
        },
        body: JSON.stringify({
          sessionId: slot ? slot._id : null,
          reason: reason,
          note: note
        })
      });
      var data = await res.json();
      if (data.ok) {
        if (typeof dbToast === 'function') {
          dbToast('Problem reported to HOD successfully', 'success');
        } else {
          showToast('Problem reported to HOD successfully', 'success');
        }
        if (slot) {
          var pNum = slot.periodNumber || 1;
          var dismissedKey = 'eams_hard_overdue_dismissed_' + (slot._id || (slot.classId + '_' + pNum));
          sessionStorage.setItem(dismissedKey, String(Date.now() + 86400000));
        }
        close();
        checkOverdue();
      } else {
        showToast(data.error || 'Failed to submit report', 'error');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<re-icon icon="alert-triangle" size="14"></re-icon> Report a Problem';
        btn.classList.remove('btn-pri');
      }
    }
  }

  function start() {
    checkOverdue();
    if (!_timer) {
      _timer = setInterval(checkOverdue, 30000);
    }
  }

  return {
    checkOverdue: checkOverdue,
    takeAttendanceNow: takeAttendanceNow,
    toggleReport: toggleReport,
    submitReport: submitReport,
    open: open,
    close: close,
    start: start,
    get activeSlot() { return _activeSlot; },
    get overdueSlots() { return _overdueSlots; },
    get deadlineMin() { return _deadlineMin; }
  };
})();
window.HardOverduePrompt = HardOverduePrompt;

  var myStrongSubjects = [];
  var myUnavailableSlots = [];
  var catalogSubjects = [];

  async function loadTeacherStrongSubjectsAndSlots() {
    try {
      var tok = getToken();
      if (!tok) return;
      var r = await api('/api/profile/me', { headers: { 'Authorization': 'Bearer ' + tok } });
      var me = await r.json();
      if (me) {
        myStrongSubjects = Array.isArray(me.strongSubjects) ? me.strongSubjects : [];
        myUnavailableSlots = Array.isArray(me.unavailableSlots) ? me.unavailableSlots : [];
      }
      var sRes = await api('/api/subjects', { headers: { 'Authorization': 'Bearer ' + tok } });
      var sData = await sRes.json();
      catalogSubjects = Array.isArray(sData) ? sData : (sData && sData.data ? sData.data : []);
      populateStrongSubjectSelect();
      renderStrongSubjectChips();
      renderUnavailableSlotsList();
    } catch (e) {
      console.warn('Error loading strong subjects/slots', e);
    }
  }

  function populateStrongSubjectSelect() {
    var sel = document.getElementById('prof-strong-subj-select');
    if (!sel) return;
    var currentIds = new Set(myStrongSubjects.map(function(s) { return typeof s === 'object' ? String(s._id) : String(s); }));
    var available = catalogSubjects.filter(function(s) { return !currentIds.has(String(s._id)); });
    sel.innerHTML = '<option value="">Select subject to add…</option>' +
      available.map(function(s) {
        return '<option value="' + s._id + '">' + (s.code ? escapeHtml(s.code) + ' - ' : '') + escapeHtml(s.name) + '</option>';
      }).join('');
  }

  function renderStrongSubjectChips() {
    var c = document.getElementById('prof-strong-chips');
    if (!c) return;
    if (!myStrongSubjects.length) {
      c.innerHTML = '<span style="font-size:12px;color:var(--tmu);">No strong subjects selected yet.</span>';
      return;
    }
    c.innerHTML = myStrongSubjects.map(function(s) {
      var sObj = typeof s === 'object' ? s : catalogSubjects.find(function(x) { return String(x._id) === String(s); });
      var label = sObj ? (sObj.shortName || sObj.code || sObj.name) : 'Subject';
      var sid = sObj ? sObj._id : s;
      return '<span class="pill pri" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;font-size:12px;">' +
        escapeHtml(label) +
        '<span style="cursor:pointer;color:#ef4444;font-weight:700;" onclick="removeStrongSubject(\'' + sid + '\')">&times;</span></span>';
    }).join('');
  }

  window.addStrongSubject = function() {
    var sel = document.getElementById('prof-strong-subj-select');
    var sid = sel ? sel.value : null;
    if (!sid) return;
    var sObj = catalogSubjects.find(function(s) { return String(s._id) === String(sid); });
    if (sObj) myStrongSubjects.push(sObj);
    populateStrongSubjectSelect();
    renderStrongSubjectChips();
  };

  window.removeStrongSubject = function(sid) {
    myStrongSubjects = myStrongSubjects.filter(function(s) {
      var id = typeof s === 'object' ? String(s._id) : String(s);
      return id !== String(sid);
    });
    populateStrongSubjectSelect();
    renderStrongSubjectChips();
  };

  window.saveStrongSubjects = async function() {
    try {
      var tok = getToken();
      if (!tok) return;
      var sids = myStrongSubjects.map(function(s) { return typeof s === 'object' ? s._id : s; });
      var res = await api('/api/profile/strong-subjects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ subjectIds: sids })
      });
      var data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast('Strong subjects saved successfully!', 'success');
    } catch (err) {
      showToast('Error saving: ' + err.message, 'error');
    }
  };

  function renderUnavailableSlotsList() {
    var c = document.getElementById('prof-unavail-slots-list');
    if (!c) return;
    if (!myUnavailableSlots.length) {
      c.innerHTML = '<span style="font-size:12px;color:var(--tmu);">No unavailable slot requests logged.</span>';
      return;
    }
    c.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px;">' +
      myUnavailableSlots.map(function(slot, idx) {
        var statusBadge = slot.hodApproved
          ? '<span class="pill" style="background:#dcfce7;color:#15803d;font-size:11px;">HOD Approved</span>'
          : '<span class="pill" style="background:#fef3c7;color:#b45309;font-size:11px;">Pending Approval</span>';
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#fff;border:1px solid var(--br);border-radius:8px;font-size:12.5px;">' +
          '<div><b>' + slot.day + ' Period ' + slot.period + '</b> ' + (slot.reason ? '<span style="color:var(--tmu);margin-left:8px;">(' + escapeHtml(slot.reason) + ')</span>' : '') + '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' + statusBadge +
          '<button type="button" class="btn-out" style="padding:2px 8px;font-size:11px;color:#ef4444;" onclick="removeUnavailableSlot(' + idx + ')">Remove</button></div>' +
          '</div>';
      }).join('') + '</div>';
  }

  window.addUnavailableSlot = async function() {
    var day = document.getElementById('prof-unavail-day') ? document.getElementById('prof-unavail-day').value : 'Mon';
    var period = Number(document.getElementById('prof-unavail-period') ? document.getElementById('prof-unavail-period').value : 1) || 1;
    var reason = document.getElementById('prof-unavail-reason') ? document.getElementById('prof-unavail-reason').value : '';
    myUnavailableSlots.push({ day: day, period: period, reason: reason, hodApproved: false });
    try {
      var tok = getToken();
      if (!tok) return;
      var res = await api('/api/profile/unavailable-slots', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ slots: myUnavailableSlots })
      });
      var data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast('Slot requested successfully', 'success');
      if (document.getElementById('prof-unavail-reason')) document.getElementById('prof-unavail-reason').value = '';
      renderUnavailableSlotsList();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  };

  window.removeUnavailableSlot = async function(idx) {
    myUnavailableSlots.splice(idx, 1);
    try {
      var tok = getToken();
      if (!tok) return;
      var res = await api('/api/profile/unavailable-slots', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ slots: myUnavailableSlots })
      });
      var data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast('Slot removed', 'success');
      renderUnavailableSlotsList();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  };

  // ── C1 & C4 & C5 HELPER ENGINE ──
  function quickStartSlot(classId, subjectId, periodNumber, dateISO, pNums) {
    if (typeof applyTargetAttendanceSlot === 'function') {
      return applyTargetAttendanceSlot(classId, subjectId, periodNumber, dateISO, pNums, true);
    }
    navigateToAttendance(classId, subjectId, periodNumber, dateISO, pNums);
    setTimeout(function() {
      if (typeof loadAttendanceSheet === 'function') {
        loadAttendanceSheet();
      }
    }, 380);
  }
  window.quickStartSlot = quickStartSlot;

  function rememberAttendanceSelection() {
    var clsEl = document.getElementById('attcls');
    var subEl = document.getElementById('attsub');
    if (clsEl && clsEl.value) localStorage.setItem('eams_last_att_class', clsEl.value);
    if (subEl && subEl.value) localStorage.setItem('eams_last_att_subject', subEl.value);
  }
  window.rememberAttendanceSelection = rememberAttendanceSelection;

  // C4: Dashboard Now and Next Hero Card
  function renderNowAndNextHero() {
    var heroCont = document.getElementById('now-next-hero-container');
    if (!heroCont) return;

    var today = todayISO();
    var dayData = getMyDay(today);
    if (!dayData || dayData.isHoliday || dayData.onLeave || !Array.isArray(dayData.slots) || !dayData.slots.length) {
      heroCont.innerHTML = '';
      return;
    }

    var validSlots = dayData.slots.filter(function(s) {
      if (s.isSpanContinuation || Number(s.spanIndex) > 0) return false;
      return ['scheduled'].includes(s.status);
    });
    if (!validSlots.length) {
      heroCont.innerHTML = '';
      return;
    }

    var nowMs = Date.now();
    var liveSlot = null;
    var nextSlot = null;
    var minDiff = Infinity;
    var allCompleted = true;

    validSlots.forEach(function(s) {
      var isDone = !!(s.attendance && s.attendance.marked);
      if (!isDone) allCompleted = false;

      var sTime = parseSlotTimeToMs(today, s.start);
      var eTime = parseSlotTimeToMs(today, s.end);
      if (nowMs >= sTime && nowMs < eTime) {
        liveSlot = s;
      } else if (sTime > nowMs && (sTime - nowMs < minDiff)) {
        minDiff = sTime - nowMs;
        nextSlot = s;
      }
    });

    if (liveSlot) {
      var pNums = Array.isArray(liveSlot.periods) && liveSlot.periods.length ? liveSlot.periods : [liveSlot.periodNumber];
      heroCont.innerHTML = '<div class="now-next-hero">'
        + '<div class="hero-content">'
        + '<span class="hero-status-tag"><span class="slot-hero-pulse"></span> HAPPENING NOW &middot; Period ' + liveSlot.periodNumber + '</span>'
        + '<div class="hero-title">' + escapeHtml(liveSlot.className) + ' &mdash; ' + escapeHtml(liveSlot.subjectName || liveSlot.subject) + '</div>'
        + '<div class="hero-meta">'
        + '<span><re-icon icon="clock" size="14"></re-icon> ' + escapeHtml(liveSlot.start + (liveSlot.end ? (' &ndash; ' + liveSlot.end) : '')) + '</span>'
        + '<span>&bull;</span>'
        + '<span><re-icon icon="map-pin" size="14"></re-icon> Room ' + escapeHtml(liveSlot.room || 'Assigned Hall') + '</span>'
        + '</div>'
        + '</div>'
        + '<div>'
        + '<button type="button" class="btn-hero-action" onclick="quickStartSlot(&apos;' + (liveSlot.classTrackId || toClassTrackId(liveSlot.classId)) + '&apos;, &apos;' + (liveSlot.subjectId || '') + '&apos;, ' + liveSlot.periodNumber + ', &apos;' + today + '&apos;)">'
        + '<re-icon icon="bolt" size="16"></re-icon> Take Attendance Now'
        + '</button>'
        + '</div>'
        + '</div>';
    } else if (nextSlot) {
      var pNums = Array.isArray(nextSlot.periods) && nextSlot.periods.length ? nextSlot.periods : [nextSlot.periodNumber];
      var minUntil = Math.max(1, Math.ceil((parseSlotTimeToMs(today, nextSlot.start) - nowMs) / 60000));
      heroCont.innerHTML = '<div class="now-next-hero">'
        + '<div class="hero-content">'
        + '<span class="hero-status-tag" style="background:rgba(255,255,255,0.25);"><re-icon icon="clock" size="13"></re-icon> UPCOMING IN ' + minUntil + ' MINS &middot; Period ' + nextSlot.periodNumber + '</span>'
        + '<div class="hero-title">' + escapeHtml(nextSlot.className) + ' &mdash; ' + escapeHtml(nextSlot.subjectName || nextSlot.subject) + '</div>'
        + '<div class="hero-meta">'
        + '<span><re-icon icon="clock" size="14"></re-icon> Starts at ' + escapeHtml(nextSlot.start) + '</span>'
        + '<span>&bull;</span>'
        + '<span><re-icon icon="map-pin" size="14"></re-icon> Room ' + escapeHtml(nextSlot.room || 'Assigned Hall') + '</span>'
        + '</div>'
        + '</div>'
        + '<div>'
        + '<button type="button" class="btn-hero-action" onclick="quickStartSlot(&apos;' + (nextSlot.classTrackId || toClassTrackId(nextSlot.classId)) + '&apos;, &apos;' + (nextSlot.subjectId || '') + '&apos;, ' + nextSlot.periodNumber + ', &apos;' + today + '&apos;, ' + JSON.stringify(pNums) + ')">'
        + '<re-icon icon="arrow-right" size="16"></re-icon> Prepare Attendance'
        + '</button>'
        + '</div>'
        + '</div>';
    } else if (allCompleted && validSlots.length > 0) {
      heroCont.innerHTML = '<div class="now-next-hero" style="background:linear-gradient(135deg, #0f766e 0%, #0d9488 50%, #14b8a6 100%);box-shadow:0 10px 25px -5px rgba(13,148,136,0.3);">'
        + '<div class="hero-content">'
        + '<span class="hero-status-tag" style="background:rgba(255,255,255,0.25);"><re-icon icon="check-circle" size="13"></re-icon> ALL CLASSES MARKED</span>'
        + '<div class="hero-title">Great work! All scheduled sessions completed today.</div>'
        + '<div class="hero-meta">'
        + '<span>All ' + validSlots.length + ' scheduled periods marked and persisted to database.</span>'
        + '</div>'
        + '</div>'
        + '<div>'
        + '<button type="button" class="btn-hero-action" style="color:#0f766e;" onclick="nav(&apos;sched&apos;)">'
        + '<re-icon icon="calendar-days" size="16"></re-icon> View Full Schedule'
        + '</button>'
        + '</div>'
        + '</div>';
    } else {
      heroCont.innerHTML = '';
    }
  }
  window.renderNowAndNextHero = renderNowAndNextHero;

  // C4: Dashboard KPI Strip
  function renderKpiStrip() {
    var today = todayISO();
    var dayData = getMyDay(today);
    var validSlots = (dayData && Array.isArray(dayData.slots)) ? dayData.slots.filter(function(s) {
      return !s.isSpanContinuation && !(Number(s.spanIndex) > 0) && s.status === 'scheduled';
    }) : [];

    var markedSlots = validSlots.filter(function(s) { return !!(s.attendance && s.attendance.marked); });

    var kpiClasses = document.getElementById('kpi-classes-today');
    if (kpiClasses) {
      kpiClasses.textContent = validSlots.length ? (markedSlots.length + ' / ' + validSlots.length) : '0';
    }

    var kpiRate = document.getElementById('kpi-avg-rate');
    if (kpiRate) {
      var allAtt = DB.get('attendance') || [];
      var presentCount = allAtt.filter(function(a) { return a.status === 'present'; }).length;
      var ratePct = allAtt.length ? Math.round((presentCount / allAtt.length) * 100) : 88;
      kpiRate.textContent = ratePct + '%';
    }

    var kpiDefs = document.getElementById('kpi-defaulters-cnt');
    if (kpiDefs) {
      var miniCnt = document.getElementById('defcnt');
      kpiDefs.textContent = miniCnt ? (miniCnt.textContent || '0') : '0';
    }

    var kpiAppr = document.getElementById('kpi-pending-approvals');
    if (kpiAppr) {
      var sbTotal = document.getElementById('sn-appr-total-badge');
      var lBadge = document.getElementById('sn-leave-badge');
      var oBadge = document.getElementById('sn-od-badge');
      var tBadge = document.getElementById('sn-tt-verify-badge');
      var sum = 0;
      if (sbTotal && sbTotal.style.display !== 'none') {
        sum = parseInt(sbTotal.textContent, 10) || 0;
      } else {
        sum = (lBadge && lBadge.style.display !== 'none' ? parseInt(lBadge.textContent, 10) || 0 : 0)
            + (oBadge && oBadge.style.display !== 'none' ? parseInt(oBadge.textContent, 10) || 0 : 0)
            + (tBadge && tBadge.style.display !== 'none' ? parseInt(tBadge.textContent, 10) || 0 : 0);
      }
      kpiAppr.textContent = sum;
    }
  }
  window.renderKpiStrip = renderKpiStrip;

  // ── C5: UNIFIED "MY CLASSES" TABBED CONTROLLER ──
  var _myClassesActiveTab = 'stu';
  var _mcPagination = { stu: 1, att: 1, def: 1, pageSize: 20 };
  var _mcCachedData = { stu: [], att: [], def: [] };

  function initMyClassesPage() {
    var clsSelect = document.getElementById('mc-filter-class');
    if (clsSelect) {
      var myClasses = getMyClasses();
      var curVal = clsSelect.value;
      clsSelect.innerHTML = '<option value="">All My Assigned Classes</option>' + myClasses.map(function(c) {
        return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
      }).join('');
      if (curVal && myClasses.some(function(c) { return String(c.id) === String(curVal); })) {
        clsSelect.value = curVal;
      }
    }

    var subSelect = document.getElementById('mc-filter-subject');
    if (subSelect) {
      var assignments = getMyAssignments();
      var seenSub = {};
      var opts = '<option value="">All Subjects</option>';
      assignments.forEach(function(a) {
        if (a.subjectId && !seenSub[a.subjectId]) {
          seenSub[a.subjectId] = true;
          opts += '<option value="' + a.subjectId + '">' + escapeHtml(a.subjectName || a.subject || 'Subject') + '</option>';
        }
      });
      subSelect.innerHTML = opts;
    }

    var fromEl = document.getElementById('mc-filter-from');
    var toEl = document.getElementById('mc-filter-to');
    if (fromEl && !fromEl.value) {
      var d = new Date();
      d.setDate(1);
      fromEl.value = formatDateISO(d);
    }
    if (toEl && !toEl.value) {
      toEl.value = todayISO();
    }

    switchMyClassesTab(_myClassesActiveTab || 'stu');
  }
  window.initMyClassesPage = initMyClassesPage;

  function switchMyClassesTab(tabName) {
    if (!tabName) tabName = 'stu';
    _myClassesActiveTab = tabName;

    // Toggle Tab Buttons
    document.querySelectorAll('#my-classes-tabs .classes-tab-btn').forEach(function(btn) {
      btn.classList.remove('act');
    });
    var activeBtn = document.getElementById('mctab-' + tabName);
    if (activeBtn) activeBtn.classList.add('act');

    // Toggle Panels
    ['stu', 'att', 'def', 'insights'].forEach(function(t) {
      var panel = document.getElementById('mc-panel-' + t);
      if (panel) panel.style.display = (t === tabName) ? 'block' : 'none';
    });

    // Adapt Shared Filter Dock fields
    var fgSub = document.getElementById('mc-fg-subject');
    var fgFrom = document.getElementById('mc-fg-from');
    var fgTo = document.getElementById('mc-fg-to');
    var fgTh = document.getElementById('mc-fg-threshold');
    var fgSrch = document.getElementById('mc-fg-search');

    if (tabName === 'stu') {
      if (fgSub) fgSub.style.display = 'none';
      if (fgFrom) fgFrom.style.display = 'none';
      if (fgTo) fgTo.style.display = 'none';
      if (fgTh) fgTh.style.display = 'none';
      if (fgSrch) fgSrch.style.display = 'block';
    } else if (tabName === 'att') {
      if (fgSub) fgSub.style.display = 'block';
      if (fgFrom) fgFrom.style.display = 'block';
      if (fgTo) fgTo.style.display = 'block';
      if (fgTh) fgTh.style.display = 'none';
      if (fgSrch) fgSrch.style.display = 'none';
    } else if (tabName === 'def') {
      if (fgSub) fgSub.style.display = 'block';
      if (fgFrom) fgFrom.style.display = 'none';
      if (fgTo) fgTo.style.display = 'none';
      if (fgTh) fgTh.style.display = 'block';
      if (fgSrch) fgSrch.style.display = 'block';
    } else if (tabName === 'insights') {
      if (fgSub) fgSub.style.display = 'block';
      if (fgFrom) fgFrom.style.display = 'block';
      if (fgTo) fgTo.style.display = 'block';
      if (fgTh) fgTh.style.display = 'none';
      if (fgSrch) fgSrch.style.display = 'none';
    }

    // Trigger tab render
    if (tabName === 'stu') renderStudentListMC();
    else if (tabName === 'att') renderAttendanceRecordMC();
    else if (tabName === 'def') renderDefaultersListMC();
    else if (tabName === 'insights') renderAttendanceInsightsMC();
  }
  window.switchMyClassesTab = switchMyClassesTab;

  function syncMyClassesFilter(changedField) {
    _mcPagination[_myClassesActiveTab] = 1;
    if (_myClassesActiveTab === 'stu') renderStudentListMC();
    else if (_myClassesActiveTab === 'att') renderAttendanceRecordMC();
    else if (_myClassesActiveTab === 'def') renderDefaultersListMC();
    else if (_myClassesActiveTab === 'insights') renderAttendanceInsightsMC();
  }
  window.syncMyClassesFilter = syncMyClassesFilter;

  function changeMyClassesPage(tab, delta) {
    _mcPagination[tab] = Math.max(1, (_mcPagination[tab] || 1) + delta);
    if (tab === 'stu') renderStudentListMC();
    else if (tab === 'att') renderAttendanceRecordMC();
    else if (tab === 'def') renderDefaultersListMC();
  }
  window.changeMyClassesPage = changeMyClassesPage;

  function renderStudentListMC() {
    var classFilter = document.getElementById('mc-filter-class') ? document.getElementById('mc-filter-class').value : '';
    var searchQuery = (document.getElementById('mc-filter-search') ? document.getElementById('mc-filter-search').value : '').toLowerCase().trim();

    var myClassIds = classFilter ? [classFilter] : getMyClasses().map(function(c) { return c.id; });
    var allStudents = DB.get('students') || [];
    var filtered = allStudents.filter(function(s) {
      return myClassIds.includes(s.classId) || myClassIds.includes(s.class);
    });

    if (searchQuery) {
      filtered = filtered.filter(function(s) {
        return String(s.name || s.fullName || '').toLowerCase().includes(searchQuery)
            || String(s.regNo || s.registerNo || '').toLowerCase().includes(searchQuery);
      });
    }

    filtered.sort(function(a, b) {
      return String(a.regNo || a.registerNo || '').localeCompare(String(b.regNo || b.registerNo || ''), undefined, { numeric: true });
    });

    _mcCachedData.stu = filtered;
    var page = _mcPagination.stu || 1;
    var pageSize = _mcPagination.pageSize || 20;
    var totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page > totalPages) page = totalPages;
    _mcPagination.stu = page;

    var start = (page - 1) * pageSize;
    var pageStudents = filtered.slice(start, start + pageSize);

    var tbody = document.getElementById('stutbody-mc');
    if (tbody) {
      if (!pageStudents.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--tdi);">No students found matching current filter.</td></tr>';
      } else {
        tbody.innerHTML = pageStudents.map(function(s, idx) {
          return '<tr>'
            + '<td>' + (start + idx + 1) + '</td>'
            + '<td style="font-weight:700;font-family:monospace;color:var(--td);">' + escapeHtml(s.regNo || s.registerNo || '—') + '</td>'
            + '<td style="font-weight:600;">' + escapeHtml(s.name || s.fullName || '—') + '</td>'
            + '<td>' + escapeHtml(s.className || '—') + '</td>'
            + '<td>' + escapeHtml(s.section || 'A') + '</td>'
            + '<td style="color:var(--tmu);">' + escapeHtml(s.deptName || '—') + '</td>'
            + '</tr>';
        }).join('');
      }
    }

    var infoEl = document.getElementById('mc-stu-info');
    if (infoEl) infoEl.textContent = 'Showing ' + (filtered.length ? (start + 1) : 0) + '–' + Math.min(start + pageSize, filtered.length) + ' of ' + filtered.length + ' students';
    var pageLbl = document.getElementById('mc-stu-page-lbl');
    if (pageLbl) pageLbl.textContent = page + ' / ' + totalPages;
    var prevBtn = document.getElementById('mc-stu-prev');
    if (prevBtn) prevBtn.disabled = (page <= 1);
    var nextBtn = document.getElementById('mc-stu-next');
    if (nextBtn) nextBtn.disabled = (page >= totalPages);
  }
  window.renderStudentListMC = renderStudentListMC;

  function renderAttendanceRecordMC() {
    var classFilter = document.getElementById('mc-filter-class') ? document.getElementById('mc-filter-class').value : '';
    var subjectFilter = document.getElementById('mc-filter-subject') ? document.getElementById('mc-filter-subject').value : '';
    var fromDate = document.getElementById('mc-filter-from') ? document.getElementById('mc-filter-from').value : '';
    var toDate = document.getElementById('mc-filter-to') ? document.getElementById('mc-filter-to').value : '';

    var tbody = document.getElementById('attrec-mc');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">Loading attendance records…</td></tr>';

    fetchAttendanceForReport(classFilter, subjectFilter, fromDate, toDate)
      .then(function(records) {
        if (subjectFilter) {
          records = records.filter(function(r) { return String(r.subjectId) === String(subjectFilter); });
        }

        var grouped = {};
        records.forEach(function(a) {
          var key = String(a.studentId) + '|' + String(a.subjectId);
          if (!grouped[key]) grouped[key] = {
            studentName: a.studentName || '', regNo: a.regNo || '',
            className: a.className, subjectName: a.subjectName,
            present: 0, total: 0, studentId: a.studentId
          };
          grouped[key].total++;
          if (a.status === 'present') grouped[key].present++;
        });

        var allStudents = DB.get('students') || [];
        Object.values(grouped).forEach(function(rec) {
          if (!rec.regNo) {
            var s = allStudents.find(function(item) { return String(item._id) === String(rec.studentId); });
            if (s) rec.regNo = s.regNo || '';
          }
        });

        var rows = Object.values(grouped).sort(function(a, b) {
          return String(a.studentName).localeCompare(String(b.studentName));
        });

        _mcCachedData.att = rows;
        var page = _mcPagination.att || 1;
        var pageSize = _mcPagination.pageSize || 20;
        var totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
        if (page > totalPages) page = totalPages;
        _mcPagination.att = page;

        var start = (page - 1) * pageSize;
        var pageRows = rows.slice(start, start + pageSize);

        if (tbody) {
          if (!pageRows.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">No attendance records found for selected filters.</td></tr>';
          } else {
            var minA = window._pubSettings && window._pubSettings.academic ? (window._pubSettings.academic.minAttendance || 75) : 75;
            var lowA = window._pubSettings && window._pubSettings.academic ? (window._pubSettings.academic.lowAttendanceThreshold || 65) : 65;

            tbody.innerHTML = pageRows.map(function(r, idx) {
              var pct = r.total ? Math.round(r.present / r.total * 100) : 0;
              var pctClass = pct >= minA ? 'ph' : pct >= lowA ? 'pm' : 'pl';
              return '<tr>'
                + '<td>' + (start + idx + 1) + '</td>'
                + '<td style="font-weight:600;">' + escapeHtml(r.studentName) + '</td>'
                + '<td style="color:var(--tmu);font-family:monospace;">' + escapeHtml(r.regNo || '—') + '</td>'
                + '<td>' + escapeHtml(r.className || '—') + '</td>'
                + '<td>' + escapeHtml(r.subjectName || '—') + '</td>'
                + '<td>' + (Number(r.total) || 0) + '</td>'
                + '<td style="color:var(--gK);font-weight:600;">' + (Number(r.present) || 0) + '</td>'
                + '<td><span class="pb ' + pctClass + '">' + pct + '%</span></td>'
                + '</tr>';
            }).join('');
          }
        }

        var infoEl = document.getElementById('mc-att-info');
        if (infoEl) infoEl.textContent = 'Showing ' + (rows.length ? (start + 1) : 0) + '–' + Math.min(start + pageSize, rows.length) + ' of ' + rows.length + ' records';
        var pageLbl = document.getElementById('mc-att-page-lbl');
        if (pageLbl) pageLbl.textContent = page + ' / ' + totalPages;
        var prevBtn = document.getElementById('mc-att-prev');
        if (prevBtn) prevBtn.disabled = (page <= 1);
        var nextBtn = document.getElementById('mc-att-next');
        if (nextBtn) nextBtn.disabled = (page >= totalPages);
      }).catch(function() {
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#dc2626;">Error loading attendance records.</td></tr>';
      });
  }
  window.renderAttendanceRecordMC = renderAttendanceRecordMC;

  function renderDefaultersListMC() {
    var classFilter = document.getElementById('mc-filter-class') ? document.getElementById('mc-filter-class').value : '';
    var subjectFilter = document.getElementById('mc-filter-subject') ? document.getElementById('mc-filter-subject').value : '';
    var threshold = parseInt(document.getElementById('mc-filter-threshold') ? document.getElementById('mc-filter-threshold').value : '75', 10) || 75;
    var searchQuery = (document.getElementById('mc-filter-search') ? document.getElementById('mc-filter-search').value : '').toLowerCase().trim();

    var allAttendance = (DB.get('attendance') || []).filter(function(a) {
      return (!classFilter || String(a.classId) === String(classFilter))
          && (!subjectFilter || String(a.subjectId) === String(subjectFilter));
    });

    var defaulterRows = [];
    getMyAssignments().filter(function(a) {
      return (!classFilter || a.classId === classFilter)
          && (!subjectFilter || a.subjectId === subjectFilter);
    }).forEach(function(assignment) {
      (DB.get('students') || []).filter(function(s) { return s.classId === assignment.classId; }).forEach(function(student) {
        var stuAtt = allAttendance.filter(function(a) {
          return String(a.studentId) === String(student._id) && String(a.subjectId) === String(assignment.subjectId);
        });
        if (!stuAtt.length) return;
        var pct = Math.round(stuAtt.filter(function(a) { return a.status === 'present'; }).length / stuAtt.length * 100);
        if (pct < threshold) {
          defaulterRows.push(Object.assign({}, student, {
            pct: pct,
            present: stuAtt.filter(function(a) { return a.status === 'present'; }).length,
            total: stuAtt.length,
            subjectName: assignment.subjectName,
            className: assignment.className
          }));
        }
      });
    });

    if (searchQuery) {
      defaulterRows = defaulterRows.filter(function(r) {
        return String(r.name || r.fullName || '').toLowerCase().includes(searchQuery)
            || String(r.regNo || r.registerNo || '').toLowerCase().includes(searchQuery);
      });
    }

    defaulterRows.sort(function(a, b) { return a.pct - b.pct; });
    _mcCachedData.def = defaulterRows;

    var page = _mcPagination.def || 1;
    var pageSize = _mcPagination.pageSize || 20;
    var totalPages = Math.max(1, Math.ceil(defaulterRows.length / pageSize));
    if (page > totalPages) page = totalPages;
    _mcPagination.def = page;

    var start = (page - 1) * pageSize;
    var pageRows = defaulterRows.slice(start, start + pageSize);

    var tbody = document.getElementById('deftbody-mc');
    if (tbody) {
      if (!pageRows.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">No defaulters found below ' + threshold + '%! <re-icon icon="party"></re-icon></td></tr>';
      } else {
        tbody.innerHTML = pageRows.map(function(r, idx) {
          return '<tr>'
            + '<td>' + (start + idx + 1) + '</td>'
            + '<td style="font-weight:600;">' + escapeHtml(r.name || r.fullName || '—') + '</td>'
            + '<td style="font-family:monospace;color:var(--tmu);">' + escapeHtml(r.regNo || '—') + '</td>'
            + '<td>' + escapeHtml(r.className || '—') + '</td>'
            + '<td>' + escapeHtml(r.subjectName || '—') + '</td>'
            + '<td style="color:var(--gK);font-weight:600;">' + (Number(r.present) || 0) + '</td>'
            + '<td>' + (Number(r.total) || 0) + '</td>'
            + '<td><span class="pb ' + (r.pct < 50 ? 'pl' : 'pm') + '">' + r.pct + '%</span></td>'
            + '</tr>';
        }).join('');
      }
    }

    var infoEl = document.getElementById('mc-def-info');
    if (infoEl) infoEl.textContent = 'Showing ' + (defaulterRows.length ? (start + 1) : 0) + '–' + Math.min(start + pageSize, defaulterRows.length) + ' of ' + defaulterRows.length + ' defaulters';
    var pageLbl = document.getElementById('mc-def-page-lbl');
    if (pageLbl) pageLbl.textContent = page + ' / ' + totalPages;
    var prevBtn = document.getElementById('mc-def-prev');
    if (prevBtn) prevBtn.disabled = (page <= 1);
    var nextBtn = document.getElementById('mc-def-next');
    if (nextBtn) nextBtn.disabled = (page >= totalPages);
  }
  window.renderDefaultersListMC = renderDefaultersListMC;

  function renderAttendanceInsightsMC() {
    var cont = document.getElementById('mc-insights-content');
    var origInsights = document.getElementById('pg-rep-insights');
    if (!cont || !origInsights) return;

    // Move or replicate insights content
    if (!cont.hasChildNodes() || cont.innerHTML.trim() === '') {
      var cloned = origInsights.cloneNode(true);
      cloned.removeAttribute('id');
      cloned.style.display = 'block';
      // remove duplicate page header in cloned panel
      var clonedHd = cloned.querySelector('.page-hd');
      if (clonedHd) clonedHd.remove();
      cont.appendChild(cloned);
    }
    if (typeof renderAttendanceInsights === 'function') {
      renderAttendanceInsights();
    }
  }
  window.renderAttendanceInsightsMC = renderAttendanceInsightsMC;

  function exportMyClassesActiveTab() {
    if (_myClassesActiveTab === 'stu') {
      var rows = [['#', 'Reg No', 'Name', 'Class', 'Section', 'Department']];
      (_mcCachedData.stu || []).forEach(function(s, i) {
        rows.push([i + 1, s.regNo || '', s.name || s.fullName || '', s.className || '', s.section || 'A', s.deptName || '']);
      });
      downloadCSV(rows, 'MyClasses_Students');
      showToast('Student Directory CSV exported', 'success');
    } else if (_myClassesActiveTab === 'att') {
      var rows = [['#', 'Student Name', 'Reg No', 'Class', 'Subject', 'Total Hours', 'Present Hours', 'Attendance %']];
      (_mcCachedData.att || []).forEach(function(r, i) {
        var pct = r.total ? Math.round(r.present / r.total * 100) : 0;
        rows.push([i + 1, r.studentName || '', r.regNo || '', r.className || '', r.subjectName || '', r.total || 0, r.present || 0, pct + '%']);
      });
      downloadCSV(rows, 'MyClasses_Attendance');
      showToast('Attendance Record CSV exported', 'success');
    } else if (_myClassesActiveTab === 'def') {
      var rows = [['#', 'Name', 'Reg No', 'Class', 'Subject', 'Present', 'Total', '%']];
      (_mcCachedData.def || []).forEach(function(r, i) {
        rows.push([i + 1, r.name || r.fullName || '', r.regNo || '', r.className || '', r.subjectName || '', r.present || 0, r.total || 0, r.pct + '%']);
      });
      downloadCSV(rows, 'MyClasses_Defaulters');
      showToast('Defaulters CSV exported', 'success');
    } else if (_myClassesActiveTab === 'insights') {
      if (typeof exportAttendanceInsightsPDF === 'function') exportAttendanceInsightsPDF();
    }
  }
  window.exportMyClassesActiveTab = exportMyClassesActiveTab;

  function refreshMyClassesActiveTab() {
    if (_myClassesActiveTab === 'stu') renderStudentListMC();
    else if (_myClassesActiveTab === 'att') renderAttendanceRecordMC();
    else if (_myClassesActiveTab === 'def') renderDefaultersListMC();
    else if (_myClassesActiveTab === 'insights') renderAttendanceInsightsMC();
    showToast('Refreshed data', 'info');
  }
  window.refreshMyClassesActiveTab = refreshMyClassesActiveTab;
