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

  function todayISO() {
    return new Date().toISOString().split('T')[0];
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

  function formatDateLong(isoDate) {
    var d = parseDateSafe(isoDate);
    return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  }

  function formatDateShort(isoDate) {
    var d = parseDateSafe(isoDate);
    return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—';
  }

  function timeAgo(isoDate) {
    const diffSeconds = (Date.now() - new Date(isoDate)) / 1000;
    if (diffSeconds < 60)    return 'just now';
    if (diffSeconds < 3600)  return Math.floor(diffSeconds / 60)  + 'm ago';
    if (diffSeconds < 86400) return Math.floor(diffSeconds / 3600) + 'h ago';
    return Math.floor(diffSeconds / 86400) + 'd ago';
  }

  function showToast(msg, state, details) {
    if (typeof dbToast === 'function') {
      var s = state === 'warn' || state === 'error' ? 'error' : (state === 'info' || state === 'saving' ? 'saving' : 'success');
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
    fetch('/api/logs', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},
      body: JSON.stringify({ action:action, details:details||'', category:category||'general', role:'teacher' })
    }).catch(function(){});
  }

  // Session Auto-Logout after 45 minutes
  (function() {
    function checkSessionExpiry() {
      var loginTime = sessionStorage.getItem('eams_login_time');
      if (loginTime) {
        var elapsed = Date.now() - parseInt(loginTime, 10);
        if (elapsed > 45 * 60 * 1000) {
          if (typeof dbToast === 'function') {
            dbToast('⚠️ Session expired. Logging out...', 'error');
          } else if (typeof toast === 'function') {
            toast('⚠️ Session expired. Logging out...', 'error');
          }
          sessionStorage.clear();
          window.location.replace('index.html?logout=timeout');
        }
      }
    }
    checkSessionExpiry();
    setInterval(checkSessionExpiry, 15000);
  })();

  function toggleSidebar() {
    const sidebar      = document.getElementById('sidebar');
    const mainContent  = document.getElementById('maincontent');
    const toggleButton = document.getElementById('sbtoggle');
    const overlay      = document.getElementById('sb-overlay-t');
    const isMobile     = window.innerWidth <= 768;

    if (isMobile) {
      const isOpen = sidebar.classList.toggle('sb-mobile-open');
      if (overlay) overlay.classList.toggle('visible', isOpen);
      toggleButton.innerHTML = isOpen ? '✖' : '☰';
    } else {
      const isHidden = sidebar.classList.toggle('sb-hidden');
      mainContent.classList.toggle('sb-expanded', isHidden);
      toggleButton.classList.toggle('closed', isHidden);
      toggleButton.innerHTML = isHidden ? '☰' : '✖';
    }
  }

  function goToTimetable() {
    // eams_user + eams_token already in sessionStorage — timetable.html reads them
    window.location.href = 'timetable.html';
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
    return fetch('/api/profile/me', { headers: { 'Authorization': 'Bearer ' + tok } })
      .then(function(r) { return r.json(); })
      .then(function(p) {
        if (!p || p.error) return null;
        currentUser = Object.assign({}, currentUser, {
          _id: p._id || currentUser._id,
          name: p.name || currentUser.name,
          username: p.username || currentUser.username,
          empId: p.employeeNo || '',
          dept: p.department || '',
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
          isAdmin: !!p.isAdmin,
          adminRights: p.adminRights || ''
        });
        sessionStorage.setItem('eams_user', JSON.stringify(currentUser));

        // Refresh the bits of chrome that were drawn with stale/blank values
        // before this fetch resolved.
        var deptEl = document.getElementById('tpdept');
        if (deptEl) deptEl.textContent = currentUser.dept || 'Faculty';
        var isTTC = !!(currentUser.isTimeTableCoordinator || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s.option === 'isTimeTableCoordinator'; })));
        var ttBtn = document.getElementById('sn-tt');
        if (ttBtn) ttBtn.style.display = isTTC ? 'flex' : 'none';
        var badge = document.getElementById('sn-tt-badge');
        if (badge) badge.style.display = isTTC ? 'inline-block' : 'none';
        if (currentUser.isAdmin) {
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
    return fetch('/api/assignments', { headers: { 'Authorization': 'Bearer ' + tok } })
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
    var myClasses = getMyClasses();
    if (!myClasses.length) return Promise.resolve([]);

    var promises = myClasses.map(function(c) {
      return fetch('/api/students?classId=' + encodeURIComponent(c.id), {
        headers: { 'Authorization': 'Bearer ' + tok }
      })
      .then(function(r) { return r.ok ? r.json() : []; })
      .then(function(d) {
        if (Array.isArray(d)) return d;
        if (d && Array.isArray(d.data)) return d.data;
        if (d && Array.isArray(d.students)) return d.students;
        return [];
      })
      .catch(function() { return []; });
    });

    return Promise.all(promises).then(function(results) {
      var flat = results.reduce(function(acc, arr) { return acc.concat(arr); }, []);
      var seen = Object.create(null);
      var unique = flat.filter(function(s) {
        var key = String(s._id);
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
      DB.set('students', unique);
      return unique;
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
    var from = from90.toISOString().split('T')[0];
    return fetch(
      '/api/attendance?teacherId=' + encodeURIComponent(currentUser._id)
        + '&from=' + from + '&to=' + to,
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
    var url = '/api/attendance?teacherId=' + encodeURIComponent(currentUser._id);
    if (classId) url += '&classId=' + encodeURIComponent(classId);
    if (from && to) url += '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    return fetch(url, { headers: { 'Authorization': 'Bearer ' + tok } })
      .then(function(r) { return r.ok ? r.json() : []; })
      .then(function(data) { return Array.isArray(data) ? data : []; })
      .catch(function() { return []; });
  }

  // syncMyTimetable
  // Fetches this teacher's live schedule slots from /api/timetable and caches in DB
  function syncMyTimetable() {
    var tok = getToken();
    if (!tok) return Promise.resolve([]);
    return fetch('/api/timetable?teacherId=' + encodeURIComponent(currentUser._id), {
      headers: { 'Authorization': 'Bearer ' + tok }
    })
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(data) {
      var rows = Array.isArray(data) ? data : [];
      DB.set('timetable', rows);
      return rows;
    })
    .catch(function() { return []; });
  }

  function bootApp() {
    document.getElementById('app').classList.add('vis');
    if (typeof flushToastQueue === 'function') flushToastQueue();
    else if (typeof _loaderActive !== 'undefined') _loaderActive = false;
    document.getElementById('tpav').textContent    = currentUser.name[0];
    document.getElementById('tpname').textContent  = currentUser.name;
    document.getElementById('tpdept').textContent  = currentUser.dept || 'Faculty';
    document.getElementById('datelbl').textContent =
      new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    var isTTC = !!(currentUser.isTimeTableCoordinator || (Array.isArray(currentUser.specials) && currentUser.specials.some(function(s) { return s.option === 'isTimeTableCoordinator'; })));
    var ttBtn = document.getElementById('sn-tt');
    if (ttBtn) ttBtn.style.display = isTTC ? 'flex' : 'none';
    var badge = document.getElementById('sn-tt-badge');
    if (badge) badge.style.display = isTTC ? 'inline-block' : 'none';
    populateAllFilters();
    initCalendar();
    renderNotifications();
    syncTeacherNotifications();
    setInterval(syncTeacherNotifications, 30000);
    
    var urlParams = new URLSearchParams(window.location.search);
    var initialTab = urlParams.get('tab') || urlParams.get('page') || 'dash';
    nav(initialTab);

    Promise.all([syncMyProfile(), syncMyAssignments()]).then(function() {
      populateAllFilters();
      return Promise.all([syncMyStudents(), syncMyAttendance(), syncMyTimetable()]);
    }).then(function() {
      populateAllFilters();
      if (document.getElementById('pg-dash').classList.contains('act'))    initDashboard();
      if (document.getElementById('pg-profile').classList.contains('act')) initProfilePage();
    });
  }

  // NAVIGATION
  function nav(pageName) {
    const validTabs = ['dash', 'sched', 'att', 'rep-att', 'rep-def', 'rep-stu', 'rep-insights', 'leaves', 'my-leaves', 'griev', 'profile'];
    if (validTabs.indexOf(pageName) === -1) pageName = 'dash';

    if (window.history && window.history.replaceState) {
      var url = new URL(window.location);
      url.searchParams.set('tab', pageName);
      window.history.replaceState(null, '', url);
    }

    document.querySelectorAll('.pg').forEach(function(p) { p.classList.remove('act'); });
    const targetPage = document.getElementById('pg-' + pageName);
    if (targetPage) targetPage.classList.add('act');

    document.querySelectorAll('.sb-item,.ss').forEach(function(item) { item.classList.remove('act'); });

    const navMap = {
      'dash':         'sn-dash',     'sched':     'sn-sched', 'att':     'sn-att',
      'rep-att':      'sn-ratt',     'rep-def':   'sn-rdef',  'rep-stu': 'sn-stu',
      'rep-insights': 'sn-insights', 'leaves':    'sn-leaves','my-leaves': 'sn-my-leaves',
      'griev':        'sn-griev'
    };
    if (navMap[pageName]) {
      const navEl = document.getElementById(navMap[pageName]);
      if (navEl) navEl.classList.add('act');
    }

    const pageActions = {
      'dash':         initDashboard,
      'sched':        function() { switchSchedTab(currentSchedTab || 'week'); },
      'att':          initAttendancePage,
      'rep-att':      function() { populateReportFilters(); renderAttendanceRecord(); },
      'rep-def':      function() { populateDefaulterFilters(); renderDefaultersList(); },
      'rep-stu':      function() { populateStudentListFilters(); renderStudentList(); },
      'rep-insights': initAttendanceInsights,
      'leaves':       loadTeacherLeaveHistory,
      'my-leaves':    initMyLeavesPage,
      'griev':        renderGrievances,
      'profile':      function() { initProfilePage(); syncMyProfile().then(initProfilePage); }
    };
    if (pageActions[pageName]) pageActions[pageName]();
  }

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

  function getMyClasses() {
    const seen = new Map();
    getMyAssignments().forEach(function(a) {
      if (!seen.has(a.classId)) seen.set(a.classId, { id: a.classId, name: a.className });
    });
    return Array.from(seen.values());
  }

  function getMySubjects() {
    const seen = new Map();
    getMyAssignments().forEach(function(a) {
      if (!seen.has(a.subjectId)) seen.set(a.subjectId, { id: a.subjectId, name: a.subjectName });
    });
    return Array.from(seen.values());
  }

  function buildClassOptions(includeAll) {
    const allOption = includeAll ? '<option value="">All</option>' : '<option value="">— Select —</option>';
    return allOption + getMyClasses().map(function(c) {
      return '<option value="' + c.id + '">' + c.name + '</option>';
    }).join('');
  }

  function buildSubjectOptions(includeAll) {
    const allOption = includeAll ? '<option value="">All</option>' : '<option value="">— Select —</option>';
    return allOption + getMySubjects().map(function(s) {
      return '<option value="' + s.id + '">' + s.name + '</option>';
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

    // Attendance take page class selector
    const attClassEl = document.getElementById('attcls');
    if (attClassEl) attClassEl.innerHTML = buildClassOptions(false);

    // Set default date range (last 7 days)
    const today       = todayISO();
    const weekAgo     = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoISO  = weekAgo.toISOString().split('T')[0];

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
    document.getElementById('slc').innerHTML = buildClassOptions(true);
  }

  // DASHBOARD
  function initDashboard() {
    const firstName = currentUser.name.split(' ')[0];
    document.getElementById('dashsub').textContent = 'Welcome back, ' + firstName + '! Here\'s your day at a glance.';
    document.getElementById('todaylbl').textContent =
      new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

    renderTodaySchedule(todayISO());
    renderDefaultersMini();
    renderAttendanceChart();
    renderCalendar();
  }
  var initDash = initDashboard;

  function renderTodaySchedule(dateISO) {
    const dayOfWeek   = new Date(dateISO + 'T00:00:00').getDay();
    const dayName     = DAY_NAMES[dayOfWeek];
    const timetable   = DB.get('timetable')
      .filter(function(t) { return t.teacherId === currentUser._id && t.day === dayName; })
      .sort(function(a, b) { return a.start.localeCompare(b.start); });

    const attendance  = DB.get('attendance');
    const isToday     = dateISO === todayISO();

    const dateLabelEl = document.getElementById('todaylbl');
    if (dateLabelEl) {
      dateLabelEl.textContent = new Date(dateISO + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    const containerEl = document.getElementById('todaysched');
    if (!timetable.length) {
      containerEl.innerHTML = '<div class="est"><span class="ei">&#128205;</span><p style="font-size:12px;">No classes on this day.</p></div>';
      return;
    }

    containerEl.innerHTML = timetable.map(function(slot) {
      const alreadyMarked = attendance.some(function(a) {
        return a.classId === slot.classId && a.subjectId === slot.subjectId && a.date === dateISO;
      });

      let actionHtml;
      if (alreadyMarked) {
        actionHtml = '<div class="donetag">&#9989; Done</div>';
      } else if (isToday) {
        actionHtml = '<button class="attbtn" onclick="navigateToAttendance(\'' + slot.classId + '\',\'' + slot.subjectId + '\')">Take Att.</button>';
      } else {
        actionHtml = '<div style="font-size:10px;color:var(--tdi);">–</div>';
      }

      const cardClass = 'scard ' + (isToday && !alreadyMarked ? 'uc' : alreadyMarked ? 'dn' : '');
      return '<div class="' + cardClass + '">'
        + '<div class="stb"><div class="t">' + slot.start + '</div><span class="d">–' + slot.end + '</span></div>'
        + '<div class="sinfo"><div class="scls">' + slot.className + '</div><div class="ssub">' + slot.subjectName + '</div></div>'
        + actionHtml
        + '</div>';
    }).join('');
  }

  // Navigate to the attendance page with a specific class/subject pre-selected
  function navigateToAttendance(classId, subjectId) {
    nav('att');
    setTimeout(function() {
      const classEl = document.getElementById('attcls');
      if (classEl) { classEl.value = classId; loadSubjectsForClass(); }
      setTimeout(function() {
        const subjectEl = document.getElementById('attsub');
        if (subjectEl) subjectEl.value = subjectId;
      }, 150);
    }, 200);
  }
  var navAtt = navigateToAttendance;

  function renderDefaultersMini() {
    const allAttendance = DB.get('attendance');
    const allStudents   = DB.get('students');
    const defaulterList = [];

    getMyAssignments().forEach(function(assignment) {
      allStudents.filter(function(s) { return s.classId === assignment.classId; }).forEach(function(student) {
        const stuAtt = allAttendance.filter(function(a) {
          return a.studentId === student._id && a.subjectId === assignment.subjectId && a.teacherId === currentUser._id;
        });
        if (!stuAtt.length) return;
        const pct = Math.round(stuAtt.filter(function(a) { return a.status === 'present'; }).length / stuAtt.length * 100);
        if (pct < 75) defaulterList.push(Object.assign({}, student, { pct: pct, subjectName: assignment.subjectName }));
      });
    });

    document.getElementById('defcnt').textContent = defaulterList.length;
    const containerEl = document.getElementById('defmini');

    if (!defaulterList.length) {
      containerEl.innerHTML = '<div class="est"><span class="ei">&#127881;</span><p style="font-size:12px;">No defaulters!</p></div>';
      return;
    }

    containerEl.innerHTML = defaulterList.slice(0, 5).map(function(d) {
      return '<div class="defrow">'
        + '<div class="defav">' + d.name[0] + '</div>'
        + '<div style="flex:1;min-width:0;">'
        + '<div style="font-size:11.5px;font-weight:700;color:var(--td);">' + d.name + '</div>'
        + '<div style="font-size:10px;color:var(--tdi);">' + d.regNo + ' · ' + d.subjectName + '</div>'
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

    const today = new Date();
    let fromDate, toDate = today.toISOString().split('T')[0];

    if (rangeType === 'week') {
      document.getElementById('rpw').classList.add('act');
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      fromDate = monday.toISOString().split('T')[0];
    } else if (rangeType === 'lweek') {
      document.getElementById('rplw').classList.add('act');
      const lastMon = new Date(today);
      lastMon.setDate(today.getDate() - ((today.getDay() + 6) % 7) - 7);
      fromDate = lastMon.toISOString().split('T')[0];
      const lastFri = new Date(lastMon);
      lastFri.setDate(lastMon.getDate() + 4);
      toDate   = lastFri.toISOString().split('T')[0];
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

    let attendance = DB.get('attendance').filter(function(a) { return a.teacherId === currentUser._id; });
    if (classFilter)   attendance = attendance.filter(function(a) { return a.classId   === classFilter; });
    if (subjectFilter) attendance = attendance.filter(function(a) { return a.subjectId === subjectFilter; });
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

    const myTimetable = DB.get('timetable').filter(function(t) { return t.teacherId === currentUser._id; });
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
      const hasClass  = !isWeekend && myTimetable.some(function(t) { return t.day === DAY_NAMES[dayOfWk]; });
      const isToday   = isoDate === todayDateISO;
      const isSelected = isoDate === selectedCalDate && !isToday;

      const classes = ['cday',
        isToday    ? 'today'   : '',
        isSelected ? 'sel'     : '',
        hasClass   ? 'hc'      : '',
        isWeekend  ? 'wknd'    : ''
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
    return fetch('/api/notifications', { headers: { 'Authorization': 'Bearer ' + tok } })
      .then(function(r) { return r.ok ? r.json() : []; })
      .then(function(data) {
        var rows = Array.isArray(data) ? data : [];
        DB.set('teacher-notifications', rows);
        renderNotifications();
        return rows;
      }).catch(function() { return []; });
  }

  function renderNotifications() {
    var allNotifs = DB.get('teacher-notifications');
    const unreadCount = allNotifs.filter(function(n) { return !n.read; }).length;
    var nbadge = document.getElementById('nbadge');
    if (nbadge) nbadge.textContent = unreadCount;

    var unreadLeaveCount = allNotifs.filter(function(n) {
      return !n.read && (n.type === 'leave-request' || !!n.leaveRequestId);
    }).length;
    var snBadge = document.getElementById('sn-leave-badge');
    if (snBadge) {
      snBadge.textContent = unreadLeaveCount;
      snBadge.style.display = unreadLeaveCount > 0 ? 'inline-block' : 'none';
    }

    const listEl = document.getElementById('ndlist');
    if (!listEl) return;
    if (!allNotifs.length) {
      listEl.innerHTML = '<div style="padding:28px;text-align:center;color:var(--tdi);font-size:12px;">No notifications.</div>';
      return;
    }

    listEl.innerHTML = allNotifs.slice().reverse().map(function(n) {
      const isLeaveReq = n.type === 'leave-request' || !!n.leaveRequestId;
      const isAlert    = n.type === 'attendance-alert' || n.type === 'alert';
      const isAdminMsg = n.from === 'Administrator';
      const iconCode   = isLeaveReq ? '&#128221;' : (isAlert ? '&#9888;' : (isAdminMsg ? '&#128276;' : '&#8505;'));
      const iconBg     = isLeaveReq ? 'background:rgba(16,185,129,.14);color:#059669;'
                       : (isAlert ? 'background:rgba(245,158,11,.12);color:#92400e;'
                       : isAdminMsg ? 'background:rgba(59,130,246,.1);color:#1d4ed8;'
                       : 'background:var(--gLt);color:var(--gD);');
      const priorityBadge = n.priority && n.priority !== 'Normal'
        ? '<span style="background:#fef3c7;color:#92400e;font-size:9px;font-weight:700;padding:1px 6px;border-radius:6px;margin-left:5px;">' + n.priority + '</span>'
        : '';
      const clickAction = isLeaveReq
        ? 'onclick="openLeaveReviewModal(\'' + (n.leaveRequestId || '') + '\',\'' + n._id + '\')"'
        : 'onclick="markNotificationRead(\'' + n._id + '\')"';

      return '<div class="ndi ' + (n.read ? '' : 'unread') + '" ' + clickAction + ' style="cursor:pointer;">'
        + '<div class="ndic" style="' + iconBg + '">' + iconCode + '</div>'
        + '<div style="flex:1;">'
        + '<div style="font-size:12px;font-weight:700;color:var(--td);display:flex;align-items:center;">' + n.from + priorityBadge + '</div>'
        + '<div style="font-size:11px;color:var(--tmu);margin-top:2px;line-height:1.4;">' + n.message + '</div>'
        + '<div style="font-size:10px;color:var(--tdi);margin-top:3px;">' + timeAgo(n.time || n.createdAt) + (isLeaveReq ? ' &bull; <span style="color:var(--gD);font-weight:700;">Click to Review</span>' : '') + '</div>'
        + '</div></div>';
    }).join('');
  }

  function openLeaveReviewModal(leaveRequestId, notifId) {
    if (!leaveRequestId) return;
    _currentReviewLeaveId = leaveRequestId;
    _currentReviewNotifId = notifId;

    document.getElementById('lr-student-info').textContent = 'Loading student details…';
    document.getElementById('lr-stat-pct').textContent = '—%';
    document.getElementById('lr-stat-classes').textContent = '— / —';
    document.getElementById('lr-stat-past-leaves').textContent = '—';
    document.getElementById('lr-dates-display').textContent = '📅 Date: —';
    document.getElementById('lr-reason-display').textContent = 'Loading…';
    document.getElementById('lr-remarks').value = '';

    openModal('m-leave-review');

    var tok = getToken();
    fetch('/api/leave/detail/' + encodeURIComponent(leaveRequestId), {
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

      document.getElementById('lr-student-info').textContent = req.studentName + ' (' + req.studentRegNo + ') — ' + req.className;
      
      var pct = stats.overallPercentage !== undefined ? stats.overallPercentage : 100;
      var pctEl = document.getElementById('lr-stat-pct');
      pctEl.textContent = pct + '%';
      pctEl.style.color = pct >= 75 ? 'var(--gD)' : '#dc2626';

      document.getElementById('lr-stat-classes').textContent = (stats.attendedClasses || 0) + ' / ' + (stats.totalClasses || 0);
      
      var pastTotal = (stats.pastLeaveDays || 0) + (stats.pastPermissionDays || 0);
      document.getElementById('lr-stat-past-leaves').textContent = pastTotal + (pastTotal === 1 ? ' Day' : ' Days');

      document.getElementById('lr-category-badge').textContent = req.category === 'Permission' ? ('⏱️ Permission (' + (req.slot || 'Half Day') + ')') : ('🌴 ' + req.leaveType);
      document.getElementById('lr-days-badge').textContent = (req.daysCount || (req.category === 'Permission' ? 0.5 : 1)) + ' Day' + (req.daysCount > 1 ? 's' : '');

      var dateDisplay = req.fromDate === req.toDate ? formatDateLong(req.fromDate) : (formatDateShort(req.fromDate) + ' – ' + formatDateLong(req.toDate));
      document.getElementById('lr-dates-display').textContent = '📅 Date: ' + dateDisplay;
      document.getElementById('lr-reason-display').textContent = '"' + req.reason + '"';

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
    fetch('/api/leave/review/' + encodeURIComponent(_currentReviewLeaveId), {
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
        dbToast('🎉 Leave request ' + action + ' successfully!', 'success');
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
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--tdi);">Loading leave records…</td></tr>';

    fetch('/api/leave/advisor-requests', {
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

      // Update KPI stats
      var stats = _teacherLeaveData.stats;
      var total = stats.total !== undefined ? stats.total : _teacherLeaveData.requests.length;
      var approved = stats.approved !== undefined ? stats.approved : _teacherLeaveData.requests.filter(function(r){ return r.status === 'Approved'; }).length;
      var rejected = stats.rejected !== undefined ? stats.rejected : _teacherLeaveData.requests.filter(function(r){ return r.status === 'Rejected'; }).length;
      var pending = stats.pending !== undefined ? stats.pending : _teacherLeaveData.requests.filter(function(r){ return r.status === 'Pending'; }).length;
      var onduty = stats.onDutyCount !== undefined ? stats.onDutyCount : _teacherLeaveData.requests.filter(function(r){ return r.category === 'Permission' || (r.slot && r.slot !== 'Full Day'); }).length;

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

      filterTeacherLeaveTable();
    })
    .catch(function(err) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:#ef4444;">Failed to load leave history.</td></tr>';
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
    var search = searchEl && searchEl.value ? String(searchEl.value).toLowerCase().trim() : '';

    var filtered = list.filter(function(r) {
      if (from && r.toDate < from) return false;
      if (to && r.fromDate > to) return false;
      if (cat && r.category !== cat) return false;
      if (status && r.status !== status) return false;
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
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--tdi);">No leave or permission records match the selected filters.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function(r) {
      var dateDisplay = r.fromDate === r.toDate ? formatDateShort(r.fromDate) : (formatDateShort(r.fromDate) + ' – ' + formatDateShort(r.toDate));
      var statusBg = r.status === 'Approved' ? '#dcfce7' : r.status === 'Rejected' ? '#fee2e2' : r.status === 'Cancelled' ? '#f3f4f6' : '#fef3c7';
      var statusColor = r.status === 'Approved' ? '#166534' : r.status === 'Rejected' ? '#991b1b' : r.status === 'Cancelled' ? '#4b5563' : '#92400e';
      var statusBadge = '<span style="background:' + statusBg + ';color:' + statusColor + ';font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:8px;">' + r.status + '</span>';
      
      var isPending = r.status === 'Pending';
      var actionHtml = isPending
        ? '<button class="btn-form-pri bsm" onclick="openLeaveReviewModal(\'' + r._id + '\')" style="padding:4px 10px;font-size:11px;background:#16a34a;">Review</button>'
        : (r.reviewRemarks ? ('<span style="font-size:11px;color:var(--tmu);">💬 ' + r.reviewRemarks + '</span>') : (r.reviewedBy ? ('<span style="font-size:10.5px;color:var(--tdi);">By ' + r.reviewedBy + '</span>') : '—'));

      var catBadge = r.category === 'Permission'
        ? '<span style="background:#ede9fe;color:#6d28d9;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:6px;">⏱️ Permission</span>'
        : '<span style="background:#f0fdf4;color:#15803d;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:6px;">🌴 ' + r.leaveType + '</span>';

      return '<tr>'
        + '<td style="font-size:11px;color:var(--tdi);white-space:nowrap;">' + formatDateShort(r.createdAt) + '</td>'
        + '<td><strong>' + r.studentName + '</strong><br><span style="font-size:10.5px;color:var(--tmu);">' + r.studentRegNo + '</span></td>'
        + '<td>' + r.className + '</td>'
        + '<td>' + catBadge + '</td>'
        + '<td>' + dateDisplay + (r.slot && r.slot !== 'Full Day' ? (' <span style="font-size:10px;background:var(--gP);padding:1px 5px;border-radius:4px;font-weight:600;">' + r.slot + '</span>') : '') + '</td>'
        + '<td><span style="font-weight:700;">' + (r.daysCount || (r.category === 'Permission' ? 0.5 : 1)) + '</span></td>'
        + '<td style="max-width:180px;white-space:normal;font-size:11.5px;color:var(--td);line-height:1.4;">' + r.reason + '</td>'
        + '<td>' + statusBadge + '</td>'
        + '<td>' + actionHtml + '</td>'
        + '</tr>';
    }).join('');
  }

  function markNotificationRead(id) {
    var tok = getToken();
    fetch('/api/notifications/' + id, {
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
      markNotificationRead(n._id);
    });
    renderNotifications();
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
      document.getElementById('ndrop').classList.remove('open');
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
      document.getElementById('stab-' + t).classList.toggle('act', t === tab);
      document.getElementById('sched-' + t + '-view').style.display = t === tab ? '' : 'none';
    });
    // Week nav (prev/next week) only shown on week tab
    var navCtrl = document.getElementById('sched-nav-controls');
    if (navCtrl) navCtrl.style.display = tab === 'week' ? 'flex' : 'none';
    if (tab === 'week')     renderSchedulePage();
    else if (tab === 'day') renderDayView();
    else                    renderTimetableGrid();
  }

  function scheduleNavigate(direction) {
    scheduleWeekOffset += direction * 7;
    renderSchedulePage();
  }
  var schedNav = scheduleNavigate;

  // Day View navigation
  function dayNavStep(dir) {
    dayOffset += dir;
    renderDayView();
  }

  // Render single-day schedule
  function renderDayView() {
    var today    = new Date();
    var target   = new Date(today);
    target.setDate(today.getDate() + dayOffset);
    var dateISO  = target.toISOString().split('T')[0];
    var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var dayShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var dayName  = dayShort[target.getDay()];
    var isToday  = dateISO === todayISO();

    document.getElementById('daylbl').textContent =
      dayNames[target.getDay()] + ', ' + target.toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'});

    var myTimetable  = DB.get('timetable').filter(function(t) { return t.teacherId === currentUser._id && t.day === dayName; });
    var allAttendance = DB.get('attendance');
    var cont = document.getElementById('dayschedcont');

    if (target.getDay() === 0) {
      cont.innerHTML = '<div class="day-empty">&#127774; Weekend — no classes scheduled.</div>';
      return;
    }
    if (!myTimetable.length) {
      cont.innerHTML = '<div class="day-empty">&#128197; No classes scheduled for this day.'
        + (isToday ? '<br><br><button class="btnp bsm" onclick="openAddSlotForDay(\'' + dayName + '\')">+ Add Slot</button>' : '')
        + '</div>';
      return;
    }

    var sorted = myTimetable.slice().sort(function(a,b){ return a.start.localeCompare(b.start); });
    cont.innerHTML = sorted.map(function(slot) {
      var marked = allAttendance.some(function(a) {
        return a.classId === slot.classId && a.subjectId === slot.subjectId && a.date === dateISO && a.teacherId === currentUser._id;
      });
      var attBtn = isToday && !marked
        ? '<button class="attbtn" style="margin-left:auto;" onclick="navigateToAttendance(\'' + slot.classId + '\',\'' + slot.subjectId + '\')">&#9989; Take Attendance</button>'
        : marked ? '<span class="donetag" style="margin-left:auto;">&#9989; Marked</span>' : '';

      return '<div class="day-slot-card' + (isToday ? ' today-slot' : '') + '">'
        + '<div class="day-time-col">' + slot.start + '<br><span style="color:var(--tdi);font-weight:400;">to</span><br>' + slot.end + '</div>'
        + '<div style="flex:1;">'
        + '<div style="font-size:14px;font-weight:700;color:var(--td);margin-bottom:3px;">' + slot.subjectName + '</div>'
        + '<div style="font-size:12px;color:var(--tmu);">&#127979; ' + slot.className + '</div>'
        + '</div>'
        + attBtn
        + '<div style="display:flex;flex-direction:column;gap:5px;margin-left:8px;">'
        + '<button class="btno bsm" onclick="openEditSlot(\'' + slot._id + '\')">&#9999;</button>'
        + '<button class="btno bsm" style="color:#dc2626;" onclick="deleteSlot(\'' + slot._id + '\')">&#128465;</button>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  // TEACHER PERIOD SCHEDULE DEFINITIONS (Institutional Standard)
  const TEACHER_PERIODS = [
    { id:1, num:1, label:'P1', time:'08:30–09:15', start:'08:30', end:'09:15' },
    { id:2, num:2, label:'P2', time:'09:15–10:00', start:'09:15', end:'10:00' },
    { id:'B1', isBreak:true, label:'☕ Break', time:'10:00–10:15' },
    { id:3, num:3, label:'P3', time:'10:15–11:00', start:'10:15', end:'11:00' },
    { id:4, num:4, label:'P4', time:'11:00–11:45', start:'11:00', end:'11:45' },
    { id:5, num:5, label:'P5', time:'11:45–12:30', start:'11:45', end:'12:30' },
    { id:'L',  isBreak:true, label:'🍱 Lunch', time:'12:30–13:15' },
    { id:6, num:6, label:'P6', time:'01:15–02:00', start:'13:15', end:'14:00' },
    { id:7, num:7, label:'P7', time:'02:00–02:45', start:'14:00', end:'14:45' },
    { id:'B2', isBreak:true, label:'☕ Break', time:'02:45–03:00' },
    { id:8, num:8, label:'P8', time:'03:00–03:45', start:'15:00', end:'15:45' },
    { id:9, num:9, label:'P9', time:'03:45–04:30', start:'15:45', end:'16:30' },
  ];

  // Enhanced Interactive Weekly Timetable Grid
  function renderTimetableGrid() {
    var days    = ['Mon','Tue','Wed','Thu','Fri','Sat'];
    var dayFull = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var timetable = DB.get('timetable').filter(function(t) {
      return (t.teacherId === currentUser._id || t.trackId === currentUser.trackId) && !t.isDraft;
    });

    var container = document.getElementById('tt-grid');
    if (!container) return;

    // Build table header
    var thead = '<thead><tr><th style="width:75px;">Day</th>';
    TEACHER_PERIODS.forEach(function(p) {
      if (p.isBreak) {
        thead += '<th class="tt-break-col" title="' + p.time + '"><span class="tt-break-text">' + p.label + '</span></th>';
      } else {
        thead += '<th>' + p.label + '<span class="tt-th-time">' + p.time + '</span></th>';
      }
    });
    thead += '</tr></thead>';

    // Helper: find slot starting at or matching period
    function findSlotForPeriod(daySlots, periodObj) {
      return daySlots.find(function(s) {
        if (s.periodNumber === periodObj.num) return true;
        if (s.start) {
          var sHour = parseInt(s.start.split(':')[0], 10);
          var sMin  = parseInt(s.start.split(':')[1], 10);
          var pHour = parseInt(periodObj.start.split(':')[0], 10);
          var pMin  = parseInt(periodObj.start.split(':')[1], 10);
          return Math.abs((sHour * 60 + sMin) - (pHour * 60 + pMin)) <= 15;
        }
        return false;
      });
    }

    var tbody = '<tbody>';
    days.forEach(function(day, dIdx) {
      var daySlots = timetable.filter(function(t) { return t.day === day; });
      tbody += '<tr>';
      tbody += '<td class="tt-day-label">' + dayFull[dIdx].slice(0, 3) + '</td>';

      var skipPeriods = 0;
      TEACHER_PERIODS.forEach(function(p) {
        if (p.isBreak) {
          tbody += '<td class="tt-break-col" style="background:rgba(27,94,32,.04);border-right:1px solid var(--brl);"></td>';
          return;
        }

        if (skipPeriods > 0) {
          skipPeriods--;
          return;
        }

        var slot = findSlotForPeriod(daySlots, p);
        if (slot) {
          var isLab = slot.type === 'Lab' || (slot.start && slot.end && (parseInt(slot.end.split(':')[0],10) - parseInt(slot.start.split(':')[0],10) >= 2));
          var isSub = slot.isSubstitute === true;
          var isComb = slot.isCombined === true;

          var cardClass = 'slot-theory';
          var badgeHtml = '';
          var colspan = 1;

          if (isSub) {
            cardClass = 'slot-sub';
            badgeHtml = '<span class="tt-slot-badge badge-sub">Sub</span>';
          } else if (isLab) {
            cardClass = 'slot-lab';
            badgeHtml = '<span class="tt-slot-badge badge-lab">Lab (3P)</span>';
            colspan = 3;
            skipPeriods = 2; // skip next 2 teaching periods
          } else if (isComb) {
            cardClass = 'slot-comb';
            badgeHtml = '<span class="tt-slot-badge badge-comb">' + (slot.combinedClassNames?.join('+') || 'Comb') + '</span>';
          }

          var hallDisplay = slot.hallNo ? ' • ' + slot.hallNo : '';

          tbody += '<td ' + (colspan > 1 ? 'colspan="' + colspan + '"' : '') + ' style="vertical-align:top;padding:3px;">';
          tbody += '<div class="tt-slot-card ' + cardClass + '" onclick="showTeacherSlotPopover(\'' + slot._id + '\', event)" title="Click to edit or manage slot">';
          tbody += '<div class="tt-slot-title">' + (slot.subjectName || 'Subject') + '</div>';
          tbody += '<div class="tt-slot-meta">';
          tbody += '<span>' + (slot.className || '') + hallDisplay + '</span>';
          tbody += badgeHtml;
          tbody += '</div></div></td>';
        } else {
          // Empty clickable cell
          tbody += '<td style="vertical-align:middle;padding:3px;">';
          tbody += '<div class="tt-cell-empty" onclick="openTeacherAddSlot(\'' + day + '\', ' + p.num + ')" title="Add slot on ' + day + ' ' + p.label + '">+</div>';
          tbody += '</td>';
        }
      });
      tbody += '</tr>';
    });
    tbody += '</tbody>';

    container.innerHTML = '<table class="tt-teacher-grid">' + thead + tbody + '</table>';
  }

  // Teacher Slot Popover Quick Actions
  function showTeacherSlotPopover(slotId, event) {
    if (event) event.stopPropagation();
    var slot = DB.get('timetable').find(function(t) { return t._id === slotId; });
    if (!slot) return;

    // Remove any existing popover
    var old = document.getElementById('tt-active-popover');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.className = 'tt-popover-overlay';
    overlay.id = 'tt-active-popover';
    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.remove();
    };

    var box = document.createElement('div');
    box.className = 'tt-popover-box';
    box.innerHTML = 
      '<div class="tt-popover-title">&#128203; ' + (slot.subjectName || 'Schedule Slot') + '</div>'
      + '<div class="tt-popover-sub">' + slot.day + ' ' + slot.start + '–' + slot.end + ' | ' + (slot.className || '') + (slot.hallNo ? ' (' + slot.hallNo + ')' : '') + '</div>'
      + '<div class="tt-popover-actions">'
      + '  <button class="tt-pop-btn" onclick="document.getElementById(\'tt-active-popover\').remove();openEditSlot(\'' + slotId + '\')">&#9999; Edit Slot Details</button>'
      + '  <button class="tt-pop-btn" onclick="document.getElementById(\'tt-active-popover\').remove();cancelTeacherSlotToday(\'' + slotId + '\')">&#10060; Cancel Class for Today</button>'
      + '  <button class="tt-pop-btn" onclick="document.getElementById(\'tt-active-popover\').remove();requestSubstituteForSlot(\'' + slotId + '\')">&#128260; Request Substitute</button>'
      + '  <button class="tt-pop-btn btn-del" onclick="document.getElementById(\'tt-active-popover\').remove();deleteSlot(\'' + slotId + '\')">&#128465; Delete Slot</button>'
      + '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }
  window.showTeacherSlotPopover = showTeacherSlotPopover;

  function cancelTeacherSlotToday(slotId) {
    showToast('Class marked as cancelled for today. Students will be notified.', 'info');
  }
  window.cancelTeacherSlotToday = cancelTeacherSlotToday;

  function requestSubstituteForSlot(slotId) {
    var slot = DB.get('timetable').find(function(t) { return t._id === slotId; });
    nav('leaves');
    showToast('Apply for leave to assign a substitute for ' + (slot?.subjectName || 'this class'), 'info');
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
        if (clsEl && !clsEl.options.length) {
          clsEl.innerHTML = buildClassOptions(false);
        }
      }
    }
    onSchedPeriodChange();
  }
  window.onSchedTypeChange = onSchedTypeChange;

  function openTeacherAddSlot(day, periodNum) {
    document.getElementById('schedeid').value = '';
    document.getElementById('mschedtit').innerHTML = '&#10133; Add Schedule Slot';
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
    document.getElementById('mschedtit').innerHTML = '&#9999; Edit Schedule Slot';
    document.getElementById('schedday').value = slot.day;
    document.getElementById('schedst').value = slot.start;
    document.getElementById('schedet').value = slot.end;
    document.getElementById('schedtype').value = slot.type || 'Theory';
    document.getElementById('schedhall').value = slot.hallNo || '';
    if (slot.periodNumber) {
      document.getElementById('schedperiod').value = String(slot.periodNumber);
    } else {
      document.getElementById('schedperiod').value = 'custom';
    }
    onSchedTypeChange();
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
          return '<option value="' + a.subjectId + '">' + a.subjectName + '</option>';
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

    var tok = getToken();
    var savePromise;
    if (editId) {
      savePromise = fetch('/api/timetable/' + encodeURIComponent(editId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify(slotData)
      }).then(function(r) { return r.json(); }).then(function(saved) {
        DB.update('timetable', editId, Object.assign({}, slotData, { _id: editId }));
        showToast('&#9989; Slot updated!');
      });
    } else {
      savePromise = fetch('/api/timetable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify(slotData)
      }).then(function(r) { return r.json(); }).then(function(saved) {
        slotData._id = saved._id || ('_' + Date.now().toString(36));
        DB.insert('timetable', slotData);
        showToast('&#9989; Slot added!');
      });
    }

    savePromise.catch(function(err) {
      console.warn('Network sync issue, saving locally:', err);
      if (editId) DB.update('timetable', editId, slotData);
      else DB.insert('timetable', slotData);
    }).finally(function() {
      closeModal('msched');
      renderTimetableGrid();
      renderSchedulePage();
    });
  }
  var saveSlot = saveScheduleSlot;
  window.saveSlot = saveSlot;

  function deleteSlot(slotId) {
    if (!confirm('Delete this slot from your timetable?')) return;
    var tok = getToken();
    fetch('/api/timetable/' + encodeURIComponent(slotId), {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + tok }
    }).catch(function(e) { console.warn('Server delete error:', e); });

    DB.delete('timetable', slotId);
    showToast('Slot deleted', 'warn');
    renderTimetableGrid();
    renderSchedulePage();
  }
  var delSlot = deleteSlot;
  window.deleteSlot = deleteSlot;
  window.delSlot = deleteSlot;

  // TAKE ATTENDANCE
  let attendanceStudents = [];

  function initAttendancePage() {
    document.getElementById('attcls').innerHTML  = buildClassOptions(false);
    document.getElementById('attsub').innerHTML  = '<option value="">— Select —</option>';
    document.getElementById('attsheet').style.display = 'none';
    if (!document.getElementById('attdate').value) {
      document.getElementById('attdate').value = todayISO();
    }
  }
  var initAttPage = initAttendancePage;

  function loadSubjectsForClass() {
    const classId = document.getElementById('attcls').value;
    const relatedAssignments = getMyAssignments().filter(function(a) { return a.classId === classId; });
    document.getElementById('attsub').innerHTML = '<option value="">— Select —</option>'
      + relatedAssignments.map(function(a) {
          return '<option value="' + a.subjectId + '">' + a.subjectName + '</option>';
        }).join('');
  }
  var attLoadSubs = loadSubjectsForClass;
  window.attLoadSubs = loadSubjectsForClass;
  window.loadSubjectsForClass = loadSubjectsForClass;

  function updateAttendanceSavedStatusCard(isSaved, existingCount) {
    var card = document.getElementById('att-saved-status-card');
    var icon = document.getElementById('att-saved-icon');
    var title = document.getElementById('att-saved-title');
    var desc = document.getElementById('att-saved-desc');
    var badge = document.getElementById('att-saved-badge');
    if (!card) return;

    if (isSaved) {
      card.style.background = '#f0fdf4';
      card.style.border = '1.5px solid #86efac';
      if (icon) icon.textContent = '🟢';
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
    } else {
      card.style.background = '#fffbeb';
      card.style.border = '1.5px solid #fde68a';
      if (icon) icon.textContent = '⚠️';
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
    }
  }
  window.updateAttendanceSavedStatusCard = updateAttendanceSavedStatusCard;

  function loadAttendanceSheet() {
    if (typeof dbToast === 'function') {
      dbToast('Fetching students & attendance from database…', 'saving');
    } else {
      showToast("Loading…", 'saving');
    }

    var classId   = document.getElementById('attcls').value;
    var subjectId = document.getElementById('attsub').value;
    var date      = document.getElementById('attdate').value;
    var period    = document.getElementById('attperiod') ? document.getElementById('attperiod').value : '1';
    if (!classId || !subjectId || !date) {
      if (typeof dbToast === 'function') dbToast('Select class, subject and date first', 'error');
      else showToast('Select class, subject and date', 'warn');
      return;
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

    // Fetch students for the class, existing records for this session,
    // and approved leaves for this date in parallel from the DB server.
    Promise.all([
      fetch('/api/students?classId=' + encodeURIComponent(classId) + '&limit=500', {
        headers: { 'Authorization': 'Bearer ' + tok }
      }).then(function(r) { return r.ok ? r.json() : []; })
        .then(function(d) {
          if (Array.isArray(d)) return d;
          if (d && Array.isArray(d.data)) return d.data;
          if (d && Array.isArray(d.students)) return d.students;
          return [];
        })
        .catch(function() { return []; }),

      fetch('/api/attendance?classId=' + encodeURIComponent(classId)
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

      fetch('/api/leave/approved-for-date?classId=' + encodeURIComponent(classId)
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
      fetch('/api/timetable/resolve/' + encodeURIComponent(classId) + '/' + encodeURIComponent(date), {
        headers: { 'Authorization': 'Bearer ' + tok }
      }).then(function(r) { return r.ok ? r.json() : null; })
        .catch(function() { return null; })
    ]).then(async function(results) {
      var initialStudents = results[0] || [];
      var resolvedSchedule = results[3] || null;

      if (resolvedSchedule && resolvedSchedule.isHoliday) {
        if (typeof dbToast === 'function') {
          dbToast('Institutional Holiday: ' + (resolvedSchedule.holidayReason || 'Holiday'), 'warn', 5000);
        }
      }

      // Check if slot has combined classes (Feature 4 - Combined classes attendance)
      var activeSlot = null;
      if (resolvedSchedule && resolvedSchedule.slots) {
        activeSlot = Object.values(resolvedSchedule.slots).find(function(s) {
          return String(s.periodNumber) === String(period);
        });
        if (activeSlot && activeSlot.isCancelled) {
          if (typeof dbToast === 'function') {
            dbToast('⚠️ Period ' + period + ' is marked Cancelled: ' + (activeSlot.cancelReason || 'Cancelled'), 'warn', 5000);
          }
        }
      }

      if (activeSlot && (activeSlot.isCombined || (activeSlot.combinedClassIds && activeSlot.combinedClassIds.length > 0))) {
        var extraClassIds = (activeSlot.combinedClassIds || []).filter(function(id) {
          return String(id) !== String(classId);
        });
        for (var i = 0; i < extraClassIds.length; i++) {
          try {
            var cRes = await fetch('/api/students?classId=' + encodeURIComponent(extraClassIds[i]) + '&limit=500', {
              headers: { 'Authorization': 'Bearer ' + tok }
            });
            if (cRes.ok) {
              var cData = await cRes.json();
              var extraList = Array.isArray(cData) ? cData : (cData?.data || cData?.students || []);
              initialStudents = initialStudents.concat(extraList);
            }
          } catch (e) {}
        }
        if (typeof dbToast === 'function') {
          dbToast('👥 Combined Session: Loaded students from all combined sections', 'info', 4000);
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

        var defaultPref = (currentUser && currentUser.preferences && currentUser.preferences.defaultAttendanceStatus)
          ? currentUser.preferences.defaultAttendanceStatus.toLowerCase()
          : 'present';
        var initialStatus = defaultPref === 'unmarked' ? 'unmarked' : (defaultPref === 'absent' ? 'absent' : 'present');
        if (matchingLeave) {
          initialStatus = 'absent';
        }
        if (rec) {
          initialStatus = rec.status;
        }
        return Object.assign({}, student, {
          status:     initialStatus,
          existingId: rec ? rec._id : null,
          onLeave:    !!matchingLeave,
          leaveBadge: matchingLeave ? ('✈️ On Leave' + (matchingLeave.slot && matchingLeave.slot !== 'Full Day' ? ' (' + matchingLeave.slot + ')' : '')) : ''
        });
      });

      var isSavedInDb = sessionRecords.length > 0;
      updateAttendanceSavedStatusCard(isSavedInDb, sessionRecords.length);

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

      document.getElementById('ainfc').textContent = assignment.className || '—';
      document.getElementById('ainfs').textContent = assignment.subjectName || '—';
      document.getElementById('ainfd').textContent = formatDateLong(date);
      var ainfp = document.getElementById('ainfp');
      if (ainfp) ainfp.textContent = 'Period ' + period;
      document.getElementById('ainft').textContent = classStudents.length;

      var selZone = document.getElementById('att-selector-zone');
      if (selZone) selZone.style.display = 'none';
      var attSheetEl = document.getElementById('attsheet');
      if (attSheetEl) attSheetEl.style.display = 'block';
      var methodInd = document.getElementById('att-method-indicator');
      if (methodInd && !methodInd.textContent) {
        methodInd.textContent = '📋 Manual Entry';
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
      const isPresent = student.status === 'present';
      const leaveBadgeHtml = student.onLeave
        ? '<span style="background:rgba(239,68,68,0.12);color:#dc2626;border:1px solid rgba(239,68,68,0.28);font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;margin-left:7px;display:inline-flex;align-items:center;" title="Approved Leave">' + (student.leaveBadge || '✈️ On Leave') + '</span>'
        : '';
      return '<tr class="' + (isPresent ? 'pr' : 'ab') + '" id="student-row-' + index + '">'
        + '<td style="font-weight:700;color:var(--tdi);">' + (index + 1) + '</td>'
        + '<td style="font-weight:600;color:var(--tmu);">' + student.regNo + '</td>'
        + '<td style="font-weight:600;">' + student.name + leaveBadgeHtml + '</td>'
        + '<td><div class="attog">'
        + '<button class="abp ' + (isPresent ? 'act' : '') + '" onclick="setAttendanceStatus(' + index + ',\'present\')">P</button>'
        + '<button class="aba ' + (!isPresent ? 'act' : '') + '" onclick="setAttendanceStatus(' + index + ',\'absent\')">A</button>'
        + '</div></td>'
        + '</tr>';
    }).join('');
    updateAttendanceSummary();
  }

  function setAttendanceStatus(index, status) {
    attendanceStudents[index].status = status;
    const row = document.getElementById('student-row-' + index);
    if (row) {
      row.className = status === 'present' ? 'pr' : 'ab';
      row.querySelectorAll('.abp,.aba').forEach(function(btn) { btn.classList.remove('act'); });
      const targetBtn = row.querySelector(status === 'present' ? '.abp' : '.aba');
      if (targetBtn) targetBtn.classList.add('act');
    }
    updateAttendanceSummary();
  }
  var setS = setAttendanceStatus;

  function markAllStudents(status) {
    attendanceStudents.forEach(function(_, index) { attendanceStudents[index].status = status; });
    renderAttendanceSheet();
  }
  var markAll = markAllStudents;

  function updateAttendanceSummary() {
    const presentCount = attendanceStudents.filter(function(s) { return s.status === 'present'; }).length;
    document.getElementById('stotal').textContent = attendanceStudents.length;
    document.getElementById('spres').textContent  = presentCount;
    document.getElementById('sabs').textContent   = attendanceStudents.length - presentCount;
  }
  var updSum = updateAttendanceSummary;
  window.setAttendanceStatus = setAttendanceStatus;
  window.setS = setAttendanceStatus;
  window.markAllStudents = markAllStudents;
  window.markAll = markAllStudents;
  window.updateAttendanceSummary = updateAttendanceSummary;
  window.renderAttendanceSheet = renderAttendanceSheet;

  function resetAttendanceView() {
    var selZone = document.getElementById('att-selector-zone');
    if (selZone) selZone.style.display = 'block';
    var sheet = document.getElementById('attsheet');
    if (sheet) sheet.style.display = 'none';
    var methodInd = document.getElementById('att-method-indicator');
    if (methodInd) {
      methodInd.style.display = 'none';
      methodInd.textContent = '';
    }
  }
  window.resetAttendanceView = resetAttendanceView;

  function triggerAttendanceMethod(mode) {
    var classId = document.getElementById('attcls').value;
    var subjectId = document.getElementById('attsub').value;
    var date = document.getElementById('attdate').value;
    if (!classId || !subjectId || !date) {
      if (typeof dbToast === 'function') dbToast('Select class, subject and date first', 'warn');
      else showToast('Select class, subject and date first', 'warn');
      return;
    }
    if (mode === 'code') {
      startLiveSession('code');
    } else if (mode === 'qr') {
      startLiveSession('qr');
    } else if (mode === 'rep') {
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
    var classId = document.getElementById('attcls').value;
    var subjectId = document.getElementById('attsub').value;
    var date = document.getElementById('attdate').value;
    var period = document.getElementById('attperiod') ? document.getElementById('attperiod').value : '1';

    if (!classId || !subjectId || !date) {
      if (typeof dbToast === 'function') dbToast('Select class, subject and date first', 'warn');
      else showToast('Select class, subject and date', 'warn');
      return;
    }

    if (typeof dbToast === 'function') dbToast('Starting Quick Pass session…', 'saving');

    fetch('/api/quick-pass/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
      body: JSON.stringify({ classId: classId, subjectId: subjectId, date: date, periodNumber: period })
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
    if (!activeQuickPassSessionId) return;
    fetch('/api/quick-pass/status/' + activeQuickPassSessionId, {
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
      var timeStr = r.markedAt ? new Date(r.markedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
      return '<tr>'
        + '<td style="font-weight:700;color:#94a3b8;">' + (idx + 1) + '</td>'
        + '<td style="font-weight:600;font-family:monospace;">' + (r.regNo || '—') + '</td>'
        + '<td style="font-weight:600;">' + (r.studentName || 'Student') + '</td>'
        + '<td><span style="font-size:10px;padding:1px 6px;border-radius:6px;background:#fef3c7;color:#92400e;font-weight:700;">R' + (r.rotation || 1) + '</span></td>'
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
        methodInd.textContent = '🔢 Quick Pass (' + (isDraft ? 'Draft' : 'Completed') + ')';
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
    fetch('/api/quick-pass/save-draft/' + activeQuickPassSessionId, {
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
      fetch('/api/quick-pass/end/' + activeQuickPassSessionId, {
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
    const classId   = document.getElementById('attcls').value;
    const subjectId = document.getElementById('attsub').value;
    const date      = document.getElementById('attdate').value;
    const periodEl  = document.getElementById('attperiod');
    const period    = periodEl ? periodEl.value : '1';

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
      methodInd.textContent = '📷 Scan Live QR (Active)';
      methodInd.style.display = 'inline-block';
    }

    // Preload attendance roster if not loaded
    if (!attendanceStudents || !attendanceStudents.length) {
      loadAttendanceSheet();
    }

    if (typeof dbToast === 'function') dbToast('Starting live QR attendance session…', 'saving');

    fetch('/api/live-session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
      body: JSON.stringify({ classId: classId, subjectId: subjectId, date: date, periodNumber: period, attendanceMode: 'qr' })
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
          '<button class="btn-pri" onclick="showQrModal()" style="background:#4f46e5;box-shadow:none;font-size:12px;padding:6px 12px;">📷 View QR</button>' +
          '<button class="btn-pri" onclick="openQrReviewModal()" style="background:#0f172a;box-shadow:none;font-size:12px;padding:6px 12px;">📋 Review</button>' +
          '<button class="btn-pri" onclick="endLiveSession()" style="background:#dc2626;box-shadow:none;font-size:12px;padding:6px 12px;">⏹ End</button>';
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
    fetch('/api/live-session/status/' + activeLiveSessionId, {
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
    if (!activeLiveSessionId || isQrRefreshing) return;
    isQrRefreshing = true;

    fetch('/api/qr-attendance/qr-data/' + activeLiveSessionId, {
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
          fetch('/api/qr-attendance/log-loaded', {
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

    fetch('/api/qr-attendance/participation/' + targetTrackId, {
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
        var windowBadge = part.qrWindowType === 'grace' ? ' <span style="color:#d97706;font-size:10px;">(5s Grace)</span>' : '';
        liveStatusBadge = '<span style="background:#dcfce7;color:#166534;font-size:11px;padding:3px 8px;border-radius:6px;font-weight:700;">🟢 Completed' + windowBadge + '</span>';
        qrTiming = (part.qrTrackId || 'QR') + ' @ ' + (new Date(part.markedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}));
        isPrePresent = true;
        setAttendanceStatus(idx, 'present');
      } else if (part && part.status === 'pending') {
        var reason = (part.verificationDetails && part.verificationDetails.failReason) || 'Awaiting Review';
        liveStatusBadge = '<span style="background:#fef3c7;color:#92400e;font-size:11px;padding:3px 8px;border-radius:6px;font-weight:700;" title="' + reason + '">🟡 Pending: ' + reason + '</span>';
        qrTiming = (part.qrTrackId || 'QR') + ' @ ' + (new Date(part.markedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}));
        isPrePresent = false;
        setAttendanceStatus(idx, 'absent');
      } else {
        // Not Scanned -> Mark as AB (absent), NOT P
        liveStatusBadge = '<span style="background:#fee2e2;color:#991b1b;font-size:11px;padding:3px 8px;border-radius:6px;font-weight:700;">🔴 Not Scanned</span>';
        isPrePresent = false;
        setAttendanceStatus(idx, 'absent');
      }

      html += '<tr style="border-bottom:1px solid #f1f5f9;">' +
        '<td style="padding:10px 8px;font-weight:600;color:#64748b;">' + (idx + 1) + '</td>' +
        '<td style="padding:10px 8px;font-weight:700;">' + (st.regNo || '—') + '</td>' +
        '<td style="padding:10px 8px;">' + (st.fullName || st.name || '—') + '</td>' +
        '<td style="padding:10px 8px;">' + liveStatusBadge + '</td>' +
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

  function applyQrParticipationToRoster(callback) {
    var targetTrackId = activeLiveSessionTrackId;
    if (!targetTrackId) {
      if (typeof callback === 'function') callback();
      return;
    }
    fetch('/api/qr-attendance/participation/' + targetTrackId, {
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
    fetch('/api/qr-attendance/save-draft/' + activeLiveSessionId, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() }
    })
    .then(function(r) { return r.json(); })
    .then(function() {
      applyQrParticipationToRoster(function() {
        hideQrModal();
        var methodInd = document.getElementById('att-method-indicator');
        if (methodInd) {
          methodInd.textContent = '📷 Scan Live (Draft Saved)';
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
      fetch('/api/live-session/end/' + endingSessionId, {
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
          methodInd.textContent = '📷 Scan Live (Session Ended)';
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
    if (!attendanceStudents.length) { showToast('No students loaded', 'warn'); return; }

    var classId     = document.getElementById('attcls').value;
    var subjectId   = document.getElementById('attsub').value;
    var date        = document.getElementById('attdate').value;
    var periodEl    = document.getElementById('attperiod');
    var periodNumber = periodEl ? Number(periodEl.value) || 1 : 1;
    var assignment  = getMyAssignments().find(function(a) { return a.classId === classId && a.subjectId === subjectId; });
    var tok         = getToken();

    if (!tok) { showToast('Not authenticated', 'warn'); return; }
    if (!assignment) { showToast('Assignment not found', 'warn'); return; }

    var topicVal = (document.getElementById('att-topic') ? document.getElementById('att-topic').value : '').trim();
    var notesVal = (document.getElementById('att-notes') ? document.getElementById('att-notes').value : '').trim();
    var requireRemark = !!(window._pubSettings && window._pubSettings.attendance && window._pubSettings.attendance.requirePeriodRemark);
    if (requireRemark && !topicVal) {
      if (typeof dbToast === 'function') dbToast('Topic Covered is required by institutional policy', 'warn');
      else showToast('Topic Covered is required by policy', 'warn');
      return;
    }

    if (typeof dbToast === 'function') {
      dbToast('Saving attendance to database…', 'saving');
    } else {
      showToast('Saving attendance…');
    }

    // Single batch POST — server stores everything in ClassAttendance + StudentAttendance
    var payload = {
      classId:            classId,
      subjectId:          subjectId,
      date:               date,
      periodNumber:       periodNumber,
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

    fetch('/api/attendance', {
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
      if (typeof dbToast === 'function') {
        dbToast('✅ Attendance saved to MongoDB!', 'success', (assignment.className || 'Class') + ' • ' + attendanceStudents.length + ' records');
      } else {
        showToast('✅ Attendance saved!', 'success');
      }
      renderAttendanceSheet();
    }).catch(function(err) {
      var msg = (err && err.error) ? ('❌ ' + err.error) : 'Error saving attendance — please retry';
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
            studentName: a.studentName, regNo: '',
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

        var rows = Object.values(grouped).sort(function(a, b) { return a.studentName.localeCompare(b.studentName); });

        if (!rows.length) {
          tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">No records found.</td></tr>';
          return;
        }

        tbody.innerHTML = rows.map(function(record, index) {
          var minA     = window._pubSettings && window._pubSettings.academic ? (window._pubSettings.academic.minAttendance || 75) : 75;
          var lowA     = window._pubSettings && window._pubSettings.academic ? (window._pubSettings.academic.lowAttendanceThreshold || 65) : 65;
          var pct      = record.total ? Math.round(record.present / record.total * 100) : 0;
          var pctClass = pct >= minA ? 'ph' : pct >= lowA ? 'pm' : 'pl';
          return '<tr>'
            + '<td>' + (index + 1) + '</td>'
            + '<td style="font-weight:600;">' + record.studentName + '</td>'
            + '<td style="color:var(--tmu);">' + (record.regNo || '—') + '</td>'
            + '<td>' + record.className + '</td>'
            + '<td>' + record.subjectName + '</td>'
            + '<td>' + record.total + '</td>'
            + '<td style="color:var(--gK);font-weight:600;">' + record.present + '</td>'
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
    if (typeof dbToast === 'function') dbToast('📥 Attendance CSV downloaded!', 'success');
    else showToast('📥 Downloaded!', 'success');
  }
  var exportAttCSV = exportAttendanceCSV;
  window.exportAttendanceCSV = exportAttendanceCSV;
  window.exportAttCSV = exportAttendanceCSV;

  function renderDefaultersList() {
    const classFilter   = document.getElementById('dfc') ? document.getElementById('dfc').value : '';
    const subjectFilter = document.getElementById('dfs') ? document.getElementById('dfs').value : '';
    const defaultTh     = window._pubSettings && window._pubSettings.academic ? (window._pubSettings.academic.minAttendance || 75) : 75;
    const threshold     = parseInt(document.getElementById('dfth') ? (document.getElementById('dfth').value || defaultTh) : defaultTh);

    const allAttendance = DB.get('attendance').filter(function(a) {
      return a.teacherId === currentUser._id
          && (!classFilter   || a.classId   === classFilter)
          && (!subjectFilter || a.subjectId === subjectFilter);
    });

    const defaulterRows = [];
    getMyAssignments()
      .filter(function(a) {
        return (!classFilter   || a.classId   === classFilter)
            && (!subjectFilter || a.subjectId === subjectFilter);
      })
      .forEach(function(assignment) {
        DB.get('students').filter(function(s) { return s.classId === assignment.classId; }).forEach(function(student) {
          const stuAtt = allAttendance.filter(function(a) { return a.studentId === student._id && a.subjectId === assignment.subjectId; });
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
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">No defaulters &#127881;</td></tr>';
      return;
    }

    tbody.innerHTML = defaulterRows.map(function(row, index) {
      return '<tr>'
        + '<td>' + (index + 1) + '</td>'
        + '<td style="font-weight:600;">' + row.name + '</td>'
        + '<td>' + row.regNo + '</td>'
        + '<td>' + row.className + '</td>'
        + '<td>' + row.subjectName + '</td>'
        + '<td style="color:var(--gK);font-weight:600;">' + row.present + '</td>'
        + '<td>' + row.total + '</td>'
        + '<td><span class="pb ' + (row.pct < 50 ? 'pl' : 'pm') + '">' + row.pct + '%</span></td>'
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
    if (typeof dbToast === 'function') dbToast('📥 Defaulters CSV downloaded!', 'success');
    else showToast('📥 Downloaded!', 'success');
  }
  var exportDefCSV = exportDefaultersCSV;
  window.exportDefaultersCSV = exportDefaultersCSV;
  window.exportDefCSV = exportDefaultersCSV;

  function renderStudentList() {
    const classFilter  = document.getElementById('slc') ? document.getElementById('slc').value : '';
    const searchQuery  = (document.getElementById('slq') ? document.getElementById('slq').value : '').toLowerCase();

    const myClassIds  = classFilter ? [classFilter] : getMyClasses().map(function(c) { return c.id; });
    let students = DB.get('students').filter(function(s) { return myClassIds.includes(s.classId); });
    if (searchQuery) students = students.filter(function(s) {
      return s.name.toLowerCase().includes(searchQuery) || s.regNo.toLowerCase().includes(searchQuery);
    });

    const tbody = document.getElementById('stutbody');
    if (!students.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--tdi);">No students found.</td></tr>';
      return;
    }

    students.sort(function(a, b) {
      return String(a.regNo || a.registerNo || '').localeCompare(String(b.regNo || b.registerNo || ''), undefined, { numeric: true });
    });

    tbody.innerHTML = students.map(function(student, index) {
      return '<tr>'
        + '<td>' + (index + 1) + '</td>'
        + '<td style="font-weight:700;font-family:monospace;color:var(--td);">' + (student.regNo || student.registerNo || '—') + '</td>'
        + '<td style="font-weight:600;">' + student.name + '</td>'
        + '<td>' + (student.className || '—') + '</td>'
        + '<td>' + (student.section || 'A') + '</td>'
        + '<td style="color:var(--tmu);">' + (student.deptName || '—') + '</td>'
        + '</tr>';
    }).join('');
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
    if (typeof dbToast === 'function') dbToast('📥 Student List CSV downloaded!', 'success');
    else showToast('📥 Downloaded!', 'success');
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
    var fromStr = dFrom.toISOString().slice(0, 10);
    var toStr = dTo.toISOString().slice(0, 10);

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
              regNo: stuObj ? (stuObj.regNo || stuObj.registerNo || '') : '',
              className: a.className || '',
              subjectName: a.subjectName || '',
              records: []
            };
          }
          studentMap[sid].records.push(a);
        });

        var minThreshold = window._pubSettings && window._pubSettings.academic ? (window._pubSettings.academic.minAttendance || 75) : 75;
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
              + '<div style="font-size:9.5px;font-weight:700;color:var(--tmu);">' + (pData.total ? pPct + '%' : '—') + '</div>'
              + '<div style="width:100%;max-width:28px;height:' + barHeight + 'px;background:' + (pData.total ? barColor : 'var(--brl)') + ';border-radius:4px 4px 0 0;transition:height .3s ease;"></div>'
              + '<div style="font-size:10px;font-weight:700;color:var(--td);margin-top:2px;">P' + p + '</div>'
              + '</div>'
            );
          }
          chartEl.innerHTML = pEntries.join('');

          var insightEl = document.getElementById('ins-period-insight');
          if (insightEl) {
            insightEl.textContent = lowestPeriod
              ? '⚠️ Lowest turnout detected in Period ' + lowestPeriod + ' (' + lowestPct + '% average). Consider scheduling interactive sessions earlier.'
              : 'Consistent attendance distribution across teaching periods.';
          }
        }

        // RENDER CONSECUTIVE ABSENCES ALERTS
        var countEl = document.getElementById('ins-alerts-count');
        if (countEl) countEl.textContent = consecutiveAlerts.length + ' Alerts';

        if (tbodyAlerts) {
          if (consecutiveAlerts.length === 0) {
            tbodyAlerts.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:#10b981;font-weight:600;">✓ No consecutive absence patterns detected in this timeframe!</td></tr>';
          } else {
            consecutiveAlerts.sort(function(a, b) { return b.consecutive - a.consecutive; });
            tbodyAlerts.innerHTML = consecutiveAlerts.map(function(item) {
              return '<tr>'
                + '<td style="font-weight:700;color:var(--td);">' + item.name + '</td>'
                + '<td style="font-family:monospace;font-weight:600;">' + item.regNo + '</td>'
                + '<td>' + item.className + '</td>'
                + '<td>' + item.subjectName + '</td>'
                + '<td><span class="badge" style="background:#fee2e2;color:#dc2626;font-weight:800;padding:3px 8px;border-radius:8px;">' + item.consecutive + ' consecutive absent</span></td>'
                + '<td><span class="pb ' + (item.pct < 50 ? 'pl' : 'pm') + '">' + item.pct + '%</span></td>'
                + '<td style="font-size:11.5px;color:var(--tmu);">' + item.lastAttended + '</td>'
                + '</tr>';
            }).join('');
          }
        }
      })
      .catch(function(err) {
        if (tbodyAlerts) tbodyAlerts.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#dc2626;">Failed to load insights: ' + err.message + '</td></tr>';
      });
  }
  window.renderAttendanceInsights = renderAttendanceInsights;

  function exportAttendanceInsightsPDF() {
    window.print();
  }
  window.exportAttendanceInsightsPDF = exportAttendanceInsightsPDF;

  // GRIEVANCES
  function renderGrievances() {
    const myGrievances = DB.get('teacher-grievances').filter(function(g) { return g.teacherId === currentUser._id; });
    const containerEl  = document.getElementById('grievlist');

    if (!myGrievances.length) {
      containerEl.innerHTML = '<div class="est"><span class="ei">&#128205;</span><p style="font-size:12px;">No grievances raised yet.</p></div>';
      return;
    }

    containerEl.innerHTML = myGrievances.slice().reverse().map(function(grievance) {
      const isResolved  = grievance.status === 'Resolved';
      const isCancelled = grievance.status === 'Cancelled';
      const isPending   = !isResolved && !isCancelled;
      const iconCode    = isResolved ? '&#9989;' : isCancelled ? '&#10060;' : '&#128225;';
      const icClass     = isResolved ? 'res' : 'pend';
      const pillClass   = isResolved ? 'sres' : 'spend';
      const pillStyle   = isCancelled ? 'style="background:#fef2f2;color:#dc2626;border-color:rgba(239,68,68,.3);"' : '';

      let statusNote = '';
      if (isResolved) {
        statusNote = '<div style="margin-top:6px;font-size:10.5px;color:var(--gD);background:var(--gLt);padding:4px 10px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;">'
          + '&#9989; Resolved by Admin'
          + (grievance.resolvedAt ? ' &nbsp;·&nbsp; ' + new Date(grievance.resolvedAt).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'}) : '')
          + '</div>';
      } else if (isCancelled) {
        statusNote = '<div style="margin-top:6px;font-size:10.5px;color:#dc2626;background:#fef2f2;padding:4px 10px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;">'
          + '&#10060; Declined by Admin'
          + '</div>';
      } else {
        statusNote = '<div style="margin-top:6px;font-size:10.5px;color:#92400e;background:#fef3c7;padding:4px 10px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;">'
          + '&#8987; Awaiting admin response'
          + '</div>';
      }

      return '<div class="gcard">'
        + '<div class="gic ' + icClass + '">' + iconCode + '</div>'
        + '<div style="flex:1;">'
        + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">'
        + '<div style="font-size:13px;font-weight:700;color:var(--td);">' + escapeHtml(grievance.subject) + '</div>'
        + '<span class="spill ' + pillClass + '" ' + pillStyle + '>' + escapeHtml(grievance.status) + '</span>'
        + '<span class="bge">' + escapeHtml(grievance.category) + '</span>'
        + '</div>'
        + '<div style="font-size:11.5px;color:var(--tmu);line-height:1.5;">' + escapeHtml(grievance.detail) + '</div>'
        + '<div style="font-size:10px;color:var(--tdi);margin-top:5px;">' + formatDateLong(grievance.createdAt.split('T')[0]) + ' · Sent to Admin</div>'
        + statusNote
        + '</div></div>';
    }).join('');
  }
  var renderGrievs = renderGrievances;

  function submitGrievance() {
    const subject    = (document.getElementById('gsubj')   ? document.getElementById('gsubj').value   : '').trim();
    const category   = document.getElementById('gcat')     ? document.getElementById('gcat').value    : 'Other';
    const detail     = (document.getElementById('gdetail') ? document.getElementById('gdetail').value : '').trim();

    if (!subject || !detail) { showToast('Please fill all fields', 'warn'); return; }

    const newGrievance = DB.insert('teacher-grievances', {
      teacherId: currentUser._id, teacherName: currentUser.name,
      subject: subject, category: category, detail: detail,
      status: 'Pending', createdAt: new Date().toISOString()
    });

    // Notify admin
    DB.insert('notifications', {
      type: 'request', from: currentUser.name, fromRole: 'Teacher',
      message: '[Grievance] ' + subject + ' — ' + detail.slice(0, 100) + (detail.length > 100 ? '…' : ''),
      time: new Date().toISOString(), read: false, priority: 'Normal',
      category: category, grievanceId: newGrievance._id
    });

    document.getElementById('gsubj').value   = '';
    document.getElementById('gdetail').value = '';
    closeModal('mgriev');
    showToast('&#128225; Grievance submitted to admin!');
    renderGrievances();
  }
  var submitGriev = submitGrievance;

  // PROFILE PAGE
  function initProfilePage() {
    document.getElementById('profav').textContent    = currentUser.name[0];
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

    if (document.getElementById('pdrhod')) document.getElementById('pdrhod').innerHTML = currentUser.isHOD ? '<span class="field-badge fb-yes">⭐ '+ (currentUser.HoddeptName || 'Yes') +'</span>' : '<span class="field-badge fb-no">No</span>';
    if (document.getElementById('pdrclassadv')) document.getElementById('pdrclassadv').innerHTML = currentUser.isClassAdvisor ? '<span class="field-badge fb-yes">⭐ ' + (currentUser.advisorClassName || 'Yes') + '</span>' : '<span class="field-badge fb-no">No</span>';
    if (document.getElementById('pdrttcoord')) document.getElementById('pdrttcoord').innerHTML = currentUser.isTimeTableCoordinator ? '<span class="field-badge fb-yes">⭐ ' + (currentUser.TTdeptName || 'Yes') + '</span>' : '<span class="field-badge fb-no">No</span>';
    if (document.getElementById('pdradmin')) document.getElementById('pdradmin').innerHTML = currentUser.isAdmin ? '<span class="field-badge fb-yes">⭐ Yes</span>' : '<span class="field-badge fb-no">No</span>';

    const assignedClasses = Array.from(new Set(getMyAssignments().map(function(a) { return a.className; })));
    document.getElementById('pdrcls').textContent = assignedClasses.length ? assignedClasses.join(', ') : 'None assigned';

    // Populate Attendance Preference
    var prefStatusEl = document.getElementById('prof-def-att-status');
    if (prefStatusEl) {
      prefStatusEl.value = (currentUser.preferences && currentUser.preferences.defaultAttendanceStatus) || 'Present';
    }

    ['pwcur','pwnew','pwconf'].forEach(function(id) { document.getElementById(id).value = ''; });
    document.getElementById('pwerr').style.display = 'none';
  }
  var initProfile = initProfilePage;

  function saveTeacherPreferences() {
    var prefStatusEl = document.getElementById('prof-def-att-status');
    var status = prefStatusEl ? prefStatusEl.value : 'Present';
    var tok = getToken();
    if (!tok) return;

    fetch('/api/profile/me', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + tok
      },
      body: JSON.stringify({ defaultAttendanceStatus: status })
    })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res && res.error) {
          showToast('❌ ' + res.error, 'error');
          return;
        }
        if (!currentUser.preferences) currentUser.preferences = {};
        currentUser.preferences.defaultAttendanceStatus = status;
        sessionStorage.setItem('eams_user', JSON.stringify(currentUser));
        showToast('✅ Preferences saved!', 'success');
      })
      .catch(function(err) {
        showToast('❌ Network error', 'error');
      });
  }

  function changePassword() {
    const currentPw  = document.getElementById('pwcur').value.trim();
    const newPw      = document.getElementById('pwnew').value.trim();
    const confirmPw  = document.getElementById('pwconf').value.trim();
    const errorEl    = document.getElementById('pwerr');

    errorEl.style.display = 'none';

    if (!currentPw || !newPw || !confirmPw) {
      errorEl.textContent = 'Please fill all password fields.';
      errorEl.style.display = 'block'; return;
    }
    if (currentPw !== currentUser.password) {
      errorEl.textContent = 'Current password is incorrect.';
      errorEl.style.display = 'block'; return;
    }
    if (newPw.length < 6) {
      errorEl.textContent = 'New password must be at least 6 characters.';
      errorEl.style.display = 'block'; return;
    }
    if (newPw !== confirmPw) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.style.display = 'block'; return;
    }

    DB.update('users', currentUser._id, { password: newPw });
    currentUser = Object.assign({}, currentUser, { password: newPw });
    ['pwcur','pwnew','pwconf'].forEach(function(id) { document.getElementById(id).value = ''; });
    showToast('&#128274; Password updated successfully!');
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
    if (!storedUser) { window.location.href = 'index.html'; return; }
    try {
      currentUser = JSON.parse(storedUser);
    } catch (e) {
      window.location.href = 'index.html'; return;
    }
    if (!currentUser || currentUser.role !== 'teacher') {
      window.location.href = 'index.html'; return;
    }
    bootApp();
  })();

// Change Password
var _pwToken = getToken();

function showForcePwModal() {
  document.getElementById('forcePwModal').style.display = 'flex';
}
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
  var cur=document.getElementById('forcePwCur').value.trim();
  var nw=document.getElementById('forcePwNew').value.trim();
  var conf=document.getElementById('forcePwConf').value.trim();
  var err=document.getElementById('forcePwErr');
  err.style.display='none';
  if (!cur||!nw||!conf){err.textContent='Please fill all fields.';err.style.display='block';return;}
  if (nw.length<6){err.textContent='New password must be at least 6 characters.';err.style.display='block';return;}
  if (nw!==conf){err.textContent='Passwords do not match.';err.style.display='block';return;}
  fetch('/api/auth/change-password',{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+_pwToken},
    body:JSON.stringify({currentPassword:cur,newPassword:nw})
  }).then(function(r){return r.json();}).then(function(d){
    if(d.error){err.textContent=d.error;err.style.display='block';return;}
    sessionStorage.setItem('eams_mustChangePw','0');
    document.getElementById('forcePwModal').style.display='none';
    showToast('✅ Password changed successfully! Please remember your new password.');
  }).catch(function(){err.textContent='Server error. Try again.';err.style.display='block';});
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
  fetch('/api/auth/change-password',{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+_pwToken},
    body:JSON.stringify({currentPassword:cur,newPassword:nw})
  }).then(function(r){return r.json();}).then(function(d){
    if(d.error){err.textContent=d.error;err.style.display='block';return;}
    ok.textContent='✅ Password updated successfully!';ok.style.display='block';
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
  var classId = document.getElementById('attcls').value;
  var subjectId = document.getElementById('attsub').value;
  var date = document.getElementById('attdate').value;
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

  fetch('/api/rep-share/reps/' + classId, {
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
        + '<div style="font-size:28px;margin-bottom:8px;">⚠️</div>'
        + '<div style="font-size:13px;font-weight:600;">No students found in this class roster.</div>'
        + '</div>';
      return;
    }

    var html = '';
    reps.forEach(function(rep) {
      var initials = (rep.fullName || 'R').split(' ').map(function(w){return w[0];}).join('').slice(0,2).toUpperCase();
      var repBadge = rep.isRep ? '<span style="background:#dcfce7;color:#166534;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;margin-left:6px;">Class Rep</span>' : '';
      html += '<div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;">'
        + '<div style="display:flex;align-items:center;gap:12px;">'
        + '  <div style="width:38px;height:38px;border-radius:50%;background:#e0f2fe;color:#0369a1;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;">' + initials + '</div>'
        + '  <div>'
        + '    <div style="font-size:13.5px;font-weight:700;color:#0f172a;">' + (rep.fullName || '—') + repBadge + '</div>'
        + '    <div style="font-size:11.5px;color:#64748b;font-family:monospace;margin-top:2px;">Reg No: ' + (rep.registerNo || '—') + '</div>'
        + '  </div>'
        + '</div>'
        + '<button class="btn-pri" onclick="delegateAttendanceToRep(\'' + rep._id + '\', \'' + (rep.fullName || '').replace(/'/g, "\\'") + '\')" style="font-size:12px;padding:7px 14px;background:#059669;">'
        + '  Delegate ➔'
        + '</button>'
        + '</div>';
    });
    list.innerHTML = html;
  })
  .catch(function(err) {
    if (spinner) spinner.style.display = 'none';
    if (list) {
      list.style.display = 'block';
      list.innerHTML = '<div style="color:#dc2626;font-size:13px;text-align:center;padding:16px;">Failed to load representatives: ' + err.message + '</div>';
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
  var classId = document.getElementById('attcls').value;
  var subjectId = document.getElementById('attsub').value;
  var date = document.getElementById('attdate').value;
  var periodEl = document.getElementById('attperiod');
  var periodNumber = periodEl ? Number(periodEl.value) || 1 : 1;
  var topicVal = (document.getElementById('att-topic') ? document.getElementById('att-topic').value : '').trim();

  if (typeof dbToast === 'function') dbToast('Delegating attendance to ' + repName + '…', 'saving');
  else showToast('Delegating attendance…');

  fetch('/api/rep-share/request', {
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
      methodInd.textContent = '👥 Rep Share (' + repName + ' Pending)';
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
    fetch('/api/rep-share/session/' + sessionId, {
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
      methodInd.textContent = '👥 Rep Share Draft Loaded (' + (session.repConfirmedCount || 0) + ' Verified Present)';
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
  if(sessionStorage.getItem('eams_mustChangePw')==='1'){ showForcePwModal(); }
  fetch('/api/settings/public')
    .then(function(r){ return r.json(); })
    .then(function(pub){
      window._pubSettings = pub;
      if (pub.institution) {
        var shortN = pub.institution.institutionShort || '';
        document.title = shortN ? ('EAMS – Teacher | ' + shortN) : 'EAMS – Teacher Portal';
        var brandEl = document.querySelector('.sb-brand');
        if (brandEl && pub.institution.institutionName) {
          brandEl.innerHTML = pub.institution.institutionName + '<small>Teacher Portal</small>';
        }
      }
      if (pub.models) {
        if (pub.models.modelLeave === false) {
          var el = document.getElementById('sn-leaves');
          if (el) el.style.display = 'none';
        }
        if (pub.models.modelGrievances === false) {
          var el = document.getElementById('sn-griev');
          if (el) el.style.display = 'none';
        }
        if (pub.models.modelExportSheet === false) {
          document.querySelectorAll('.btn-out').forEach(function(b){
            if (b.textContent && b.textContent.includes('Export CSV')) b.style.display = 'none';
          });
        }
      }
      if (pub.attendance) {
        if (typeof updateAttendanceMethodETAs === 'function') updateAttendanceMethodETAs();
        if (pub.attendance.forwardToRep === false) {
          var fBtn = document.getElementById('btn-forward-rep');
          if (fBtn) fBtn.style.display = 'none';
          var repCard = document.getElementById('card-rep-share');
          if (repCard) repCard.style.display = 'none';
        }
        if (pub.attendance.quickPass === false || pub.attendance.liveSessions === false) {
          var qpCard = document.getElementById('card-quick-pass');
          if (qpCard) qpCard.style.display = 'none';
        }
        if (pub.attendance.liveSessions === false) {
          var slCard = document.getElementById('card-scan-live');
          if (slCard) slCard.style.display = 'none';
        }
        if (pub.attendance.requirePeriodRemark) {
          var reqBadge = document.getElementById('att-topic-req');
          if (reqBadge) reqBadge.style.display = 'inline-block';
          var starTopic = document.getElementById('star-topic-req');
          if (starTopic) starTopic.style.display = 'inline';
        }
      }
    }).catch(function(e){ console.warn(e); });
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
  var u = DB.get('user');
  if (u && (u.isHod || u.isAdmin)) {
    var btnHod = document.getElementById('tab-tl-hod-pending');
    if (btnHod) btnHod.style.display = '';
    loadHodTeacherLeaves();
  }
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

  fetch('/api/leave/teacher/pending-hod', { credentials: 'same-origin' })
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
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:#16a34a;font-weight:600;">✓ No pending department leave requests to review.</td></tr>';
    return;
  }

  tbody.innerHTML = _hodPendingLeaves.map(function(l) {
    var dateRange = l.fromDate === l.toDate ? l.fromDate : (l.fromDate + ' to ' + l.toDate);
    var subsHtml = (l.substitutions && l.substitutions.length > 0)
      ? l.substitutions.map(function(s) {
          return '<div style="font-size:11px;margin:2px 0;"><strong>' + (s.className || 'Class') + ' · P' + s.periodNumber + ':</strong> ' + (s.substituteTeacherName || 'Substitute') + '</div>';
        }).join('')
      : '<span style="color:var(--tmu);font-size:11px;">None</span>';

    return '<tr>'
      + '<td><strong>' + (l.teacherName || 'Faculty') + '</strong><div style="font-size:10.5px;color:var(--tmu);">' + (l.teacherEmpId || l.deptCode || '') + '</div></td>'
      + '<td><span class="tt-slot-badge badge-theory">' + l.category + '</span><div style="font-size:10.5px;color:var(--tmu);">' + l.leaveType + '</div></td>'
      + '<td><strong>' + dateRange + '</strong><div style="font-size:11px;color:var(--tdi);">' + (l.slot || 'Full Day') + '</div></td>'
      + '<td><strong>' + (l.daysCount || 1) + 'd</strong></td>'
      + '<td style="font-size:11.5px;max-width:180px;white-space:normal;">' + (l.reason || '—') + '</td>'
      + '<td>' + subsHtml + '</td>'
      + '<td style="text-align:center;white-space:nowrap;">'
      + '  <button class="btno bsm" style="margin-right:6px;font-size:11px;padding:4px 10px;background:var(--gD);color:#fff;border-color:var(--gD);" onclick="approveTeacherLeaveHod(\'' + l._id + '\')">✓ Approve</button>'
      + '  <button class="btno bsm" style="font-size:11px;padding:4px 10px;color:#dc2626;border-color:rgba(220,38,38,0.4);" onclick="rejectTeacherLeaveHod(\'' + l._id + '\')">✕ Reject</button>'
      + '</td>'
      + '</tr>';
  }).join('');
}

function approveTeacherLeaveHod(id) {
  if (!confirm('Approve this faculty leave request?\n\nThis will automatically create Timetable Day Overrides for all arranged substitute slots and notify the substitute teachers.')) return;
  fetch('/api/leave/teacher/' + id + '/hod-approve', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin'
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

function rejectTeacherLeaveHod(id) {
  var reason = prompt('Enter reason for rejecting this leave request:');
  if (reason === null) return;
  fetch('/api/leave/teacher/' + id + '/hod-reject', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remarks: reason }),
    credentials: 'same-origin'
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

  fetch('/api/leave/teacher/my-requests', { credentials: 'same-origin' })
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
  var approved = _myTeacherLeaves.filter(function(l) { return l.status === 'Approved'; }).length;
  var pending = _myTeacherLeaves.filter(function(l) { return l.status === 'Pending'; }).length;
  var subs = _myTeacherLeaves.reduce(function(acc, l) { return acc + (l.substitutions ? l.substitutions.length : 0); }, 0);

  var elTot = document.getElementById('tl-stat-total');
  var elApp = document.getElementById('tl-stat-approved');
  var elPen = document.getElementById('tl-stat-pending');
  var elSub = document.getElementById('tl-stat-subs');

  if (elTot) elTot.textContent = total;
  if (elApp) elApp.textContent = approved;
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
    var appliedDate = l.createdAt ? new Date(l.createdAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short' }) : '—';
    var dateRange = l.fromDate === l.toDate ? l.fromDate : (l.fromDate + ' to ' + l.toDate);

    var subsBadge = '';
    if (l.substitutions && l.substitutions.length > 0) {
      subsBadge = l.substitutions.map(function(s) {
        return '<span class="tt-slot-badge badge-sub" style="display:inline-block;margin:2px 3px;font-size:10.5px;">P' + s.periodNumber + ': ' + s.substituteTeacherName + '</span>';
      }).join('');
    } else {
      subsBadge = '<span style="color:var(--tdi);font-size:11px;">None</span>';
    }

    var statusColor = l.status === 'Approved' ? '#16a34a' : (l.status === 'Rejected' ? '#dc2626' : '#d97706');
    var statusBg = l.status === 'Approved' ? 'rgba(22,163,74,0.1)' : (l.status === 'Rejected' ? 'rgba(220,38,38,0.1)' : 'rgba(217,119,6,0.1)');

    var cancelBtn = l.status === 'Pending'
      ? '<button class="btno bsm" style="color:#dc2626;border-color:rgba(220,38,38,0.3);" onclick="cancelTeacherLeaveReq(\'' + l._id + '\')">Cancel</button>'
      : '<span style="color:var(--tdi);font-size:11px;">—</span>';

    return '<tr>'
      + '<td style="font-weight:600;font-size:12px;">' + appliedDate + '</td>'
      + '<td><span class="tt-slot-badge badge-theory">' + l.category + '</span><div style="font-size:11px;color:var(--tmu);margin-top:2px;">' + l.leaveType + '</div></td>'
      + '<td><div style="font-weight:700;font-size:12px;">' + dateRange + '</div><div style="font-size:11px;color:var(--tdi);">' + (l.slot || 'Full Day') + '</div></td>'
      + '<td style="font-weight:700;">' + (l.daysCount || 1) + 'd</td>'
      + '<td style="font-size:12px;max-width:180px;white-space:normal;">' + (l.reason || '—') + '</td>'
      + '<td>' + subsBadge + '</td>'
      + '<td><span style="font-size:11px;font-weight:700;color:var(--td);">' + (l.hodStatus || 'Pending') + '</span></td>'
      + '<td><span style="display:inline-block;padding:3px 9px;border-radius:10px;font-size:11px;font-weight:800;background:' + statusBg + ';color:' + statusColor + ';">' + l.status + '</span></td>'
      + '<td>' + cancelBtn + '</td>'
      + '</tr>';
  }).join('');
}

function renderTeacherSubstituteDuties() {
  var tbody = document.getElementById('tl-duties-tbody');
  if (!tbody) return;

  fetch('/api/timetable/teacher-day-schedule?date=' + todayISO(), { credentials: 'same-origin' })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var subs = (data?.schedule || []).filter(function(s) { return s.isSubstitute; });
      if (!subs || subs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--tdi);">No substitute duties assigned for today.</td></tr>';
        return;
      }
      tbody.innerHTML = subs.map(function(s) {
        return '<tr>'
          + '<td style="font-weight:700;">' + data.date + '</td>'
          + '<td><strong>Period ' + s.periodNumber + '</strong> (' + (s.timing?.start || '') + '–' + (s.timing?.end || '') + ')</td>'
          + '<td><span class="tt-slot-badge badge-comb">' + (s.slot?.className || '—') + '</span></td>'
          + '<td><strong>' + (s.slot?.subjectName || '—') + '</strong></td>'
          + '<td>' + (s.slot?.hallNo || '—') + '</td>'
          + '<td><span class="tt-slot-badge badge-sub">Substitute for ' + (s.originalTeacher || 'Faculty') + '</span></td>'
          + '<td><button class="attbtn" onclick="navigateToAttendance(\'' + (s.slot?.classId || '') + '\',\'\')">&#9989; Take Att.</button></td>'
          + '</tr>';
      }).join('');
    })
    .catch(function() {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--tdi);">No substitute duties scheduled today.</td></tr>';
    });
}

function cancelTeacherLeaveReq(id) {
  if (!confirm('Are you sure you want to cancel this leave request?')) return;
  fetch('/api/leave/teacher/cancel/' + encodeURIComponent(id), {
    method: 'PUT',
    credentials: 'same-origin'
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

function openTeacherApplyLeaveModal() {
  var todayStr = todayISO();
  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var tomorrowStr = tomorrow.toISOString().split('T')[0];

  var fromEl = document.getElementById('tl-from');
  var toEl = document.getElementById('tl-to');
  if (fromEl) fromEl.value = tomorrowStr;
  if (toEl) toEl.value = tomorrowStr;

  var rEl = document.getElementById('tl-reason');
  if (rEl) rEl.value = '';

  var emEl = document.getElementById('tl-emergency');
  if (emEl) emEl.checked = false;

  openModal('m-teacher-apply-leave');
  fetchTeacherAffectedSlots();
}

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

  if (cont) cont.innerHTML = '<div style="text-align:center;padding:16px;color:var(--tdi);font-size:12px;">🔍 Detecting scheduled teaching slots…</div>';

  fetch('/api/leave/affected-slots?fromDate=' + encodeURIComponent(fromDate) + '&toDate=' + encodeURIComponent(toDate) + '&slot=' + encodeURIComponent(slot), {
    credentials: 'same-origin'
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
    cont.innerHTML = '<div style="text-align:center;padding:16px;color:#16a34a;font-size:12.5px;font-weight:700;">✅ No scheduled classes on these selected dates/periods! No substitutions required.</div>';
    return;
  }

  cont.innerHTML = _currentAffectedSlots.map(function(slot, idx) {
    var subAssigned = slot.substituteTeacherName;
    var subDisplay = subAssigned
      ? '<span style="font-size:12px;font-weight:800;color:#16a34a;background:rgba(22,163,74,0.12);padding:4px 10px;border-radius:10px;display:inline-flex;align-items:center;gap:5px;">✅ Sub: ' + slot.substituteTeacherName + '</span>'
      : '<span style="font-size:11.5px;font-weight:700;color:#d97706;background:rgba(217,119,6,0.1);padding:4px 9px;border-radius:10px;">⚠️ Substitute Required</span>';

    return '<div style="display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid var(--brl);border-radius:10px;padding:10px 14px;flex-wrap:wrap;gap:8px;">'
      + '<div>'
      + '<div style="font-size:12.5px;font-weight:800;color:var(--td);">' + slot.date + ' (' + slot.day + ') · Period ' + slot.periodNumber + ' <span style="font-size:11px;font-weight:500;color:var(--tmu);">(' + slot.start + '–' + slot.end + ')</span></div>'
      + '<div style="font-size:12px;color:var(--tmu);margin-top:2px;">🏫 ' + slot.className + ' • <strong>' + slot.subjectName + '</strong> ' + (slot.hallNo ? '• Hall: ' + slot.hallNo : '') + '</div>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:10px;">'
      + subDisplay
      + '<button class="btno bsm" onclick="openFreeSlotFinderForSlot(' + idx + ')" style="padding:6px 12px;font-size:11.5px;">🔍 ' + (subAssigned ? 'Change' : 'Find Substitute') + '</button>'
      + '</div>'
      + '</div>';
  }).join('');
}

// ── TEACHER FREE-SLOT FINDER INTEGRATION (FEATURE 11) ──

function loadFacultyDepartmentsForFinder() {
  fetch('/api/departments', { credentials: 'same-origin' })
    .then(function(res) { return res.json(); })
    .then(function(depts) {
      var sel = document.getElementById('fsf-dept');
      if (sel && Array.isArray(depts)) {
        var opts = '<option value="all">All Departments</option>' + depts.map(function(d) {
          return '<option value="' + d._id + '">' + d.name + ' (' + (d.code || '') + ')</option>';
        }).join('');
        sel.innerHTML = opts;
      }
    }).catch(function(){});
}

function openFreeSlotFinderForSlot(slotIdx) {
  _targetSlotForSubstitute = slotIdx;
  var slot = _currentAffectedSlots[slotIdx];
  if (!slot) return;

  var dateEl = document.getElementById('fsf-date');
  var pEl = document.getElementById('fsf-period');
  var headerSub = document.getElementById('fsf-header-sub');

  if (dateEl) dateEl.value = slot.date;
  if (pEl) pEl.value = slot.periodNumber;
  if (headerSub) {
    headerSub.innerHTML = 'Selecting substitute for <strong>' + slot.className + ' — ' + slot.subjectName + '</strong> on ' + slot.date + ' (Period ' + slot.periodNumber + ')';
  }

  openModal('m-free-slot-finder');
  runFreeSlotSearch();
}

function runFreeSlotSearch() {
  var date = document.getElementById('fsf-date')?.value || todayISO();
  var period = document.getElementById('fsf-period')?.value || '';
  var deptId = document.getElementById('fsf-dept')?.value || 'all';
  var search = document.getElementById('fsf-search')?.value || '';

  var list = document.getElementById('fsf-faculty-list');
  var summary = document.getElementById('fsf-results-summary');
  if (list) list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--tdi);">Searching faculty availability…</div>';

  var url = '/api/timetable/free-teachers?date=' + encodeURIComponent(date);
  if (period) url += '&periodNumber=' + encodeURIComponent(period);
  if (deptId && deptId !== 'all') url += '&deptId=' + encodeURIComponent(deptId);
  if (search) url += '&search=' + encodeURIComponent(search);

  fetch(url, { credentials: 'same-origin' })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var teachers = data.teachers || [];
      if (summary) {
        summary.innerHTML = 'Found <strong>' + teachers.length + ' faculty</strong> (' + data.availableCount + ' completely free for Period ' + (period || 'all') + ')';
      }

      if (teachers.length === 0) {
        if (list) list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--tdi);">No faculty records found matching criteria.</div>';
        return;
      }

      if (list) {
        list.innerHTML = teachers.map(function(t) {
          var isSelf = t.trackId === currentUser.trackId || t._id === currentUser._id;
          var statusPill = '';
          var canAssign = false;

          if (isSelf) {
            statusPill = '<span class="tt-slot-badge" style="background:#e2e8f0;color:#64748b;">Current Faculty (You)</span>';
          } else if (t.isFreeForTarget) {
            statusPill = '<span class="tt-slot-badge" style="background:#dcfce7;color:#166534;font-weight:800;">🟢 FREE for Period ' + period + '</span>';
            canAssign = true;
          } else {
            var busyReason = t.targetPeriodStatus === 'leave' ? '🌴 On Leave' : '🔴 Teaching Class';
            statusPill = '<span class="tt-slot-badge" style="background:#fee2e2;color:#991b1b;font-weight:700;">' + busyReason + '</span>';
          }

          var periodBadges = '';
          for (var p = 1; p <= 9; p++) {
            var pStat = t.periodStatus[p];
            var pColor = pStat === 'free' ? '#16a34a' : (pStat === 'leave' ? '#d97706' : '#dc2626');
            var isCurrentP = Number(period) === p;
            periodBadges += '<span style="display:inline-block;width:22px;height:22px;line-height:20px;text-align:center;font-size:10px;font-weight:800;border-radius:6px;border:1.5px solid ' + pColor + ';color:' + pColor + ';' + (isCurrentP ? 'background:' + pColor + ';color:#fff;' : '') + '" title="P' + p + ': ' + pStat + '">' + p + '</span>';
          }

          var actionBtn = canAssign && _targetSlotForSubstitute !== null
            ? '<button class="btnp bsm" onclick="assignSubstituteToSlot(\'' + t.trackId + '\',\'' + t.fullName.replace(/'/g, "\\'") + '\',\'' + t._id + '\')">&#9989; Select</button>'
            : '';

          return '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:12px;background:#fff;border:1px solid var(--brl);gap:10px;flex-wrap:wrap;">'
            + '<div style="display:flex;align-items:center;gap:10px;">'
            + '<div style="width:36px;height:36px;border-radius:50%;background:var(--gL);color:var(--gD);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;">' + (t.fullName[0] || 'T') + '</div>'
            + '<div>'
            + '<div style="font-size:13px;font-weight:800;color:var(--td);">' + t.fullName + '</div>'
            + '<div style="font-size:11px;color:var(--tmu);">' + (t.designation || 'Faculty') + ' • ' + (t.department || '') + '</div>'
            + '</div>'
            + '</div>'
            + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
            + '<div style="display:flex;gap:3px;align-items:center;margin-right:6px;">' + periodBadges + '</div>'
            + statusPill
            + actionBtn
            + '</div>'
            + '</div>';
        }).join('');
      }
    })
    .catch(function(err) {
      if (list) list.innerHTML = '<div style="text-align:center;padding:24px;color:#dc2626;">Error searching available faculty.</div>';
    });
}

function assignSubstituteToSlot(trackId, name, teacherId) {
  if (_targetSlotForSubstitute === null || !_currentAffectedSlots[_targetSlotForSubstitute]) return;
  _currentAffectedSlots[_targetSlotForSubstitute].substituteTeacherTrackId = trackId;
  _currentAffectedSlots[_targetSlotForSubstitute].substituteTeacherName = name;
  _currentAffectedSlots[_targetSlotForSubstitute].substituteTeacherId = teacherId;

  closeModalBg('m-free-slot-finder');
  renderAffectedSlotsList();
  showToast('Assigned ' + name + ' as substitute for slot ' + (_targetSlotForSubstitute + 1), 'success');
}

function submitTeacherLeaveApplication() {
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
  if (!reason.trim()) {
    showToast('Please enter a reason for the leave', 'warning');
    return;
  }

  var unassignedSlots = _currentAffectedSlots.filter(function(s) { return !s.substituteTeacherTrackId; });
  if (unassignedSlots.length > 0 && !isEmergency) {
    if (!confirm('You have ' + unassignedSlots.length + ' scheduled class(es) without an assigned substitute teacher. Would you like to proceed anyway?')) {
      return;
    }
  }

  var payload = {
    category: category,
    leaveType: leaveType,
    slot: slot,
    fromDate: fromDate,
    toDate: toDate,
    reason: reason.trim(),
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

  fetch('/api/leave/teacher/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'same-origin'
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    if (data.error) showToast(data.error, 'danger');
    else {
      showToast('Faculty leave request submitted successfully!', 'success');
      closeModalBg('m-teacher-apply-leave');
      loadMyTeacherLeaves();
    }
  })
  .catch(function(err) {
    showToast(err.message, 'danger');
  });
}

// Security
document.addEventListener('contextmenu', function(e){ e.preventDefault(); });
document.addEventListener('keydown', function(e){
  if(e.key==='F12'||(e.ctrlKey&&e.shiftKey&&['I','J','C','K'].includes(e.key))||(e.ctrlKey&&e.key==='U')){ e.preventDefault(); return false; }
});

function hideMsgToast() { /* no-op - toast hidden by timer */ }