/**
 * public/js/pages/admin.roles.js
 * 
 * Executive Roles & Access Management Module (§7, Phase R4)
 * Single Source of Truth for Institutional Leaders, Department Roles, Class Advisors, and Wardens.
 */

(function (window, document) {
  'use strict';

  var _rolesState = {
    departments: [],
    filter: 'all',
    search: '',
    currentTab: 'departments',
    activeDeptId: null,
    activeDeptData: null,
    targetRole: null,
    targetScopeId: null,
    expectedCurrentTeacherId: null,
    wardens: [],
    history: [],
    eligibleStaff: []
  };

  function getToken() {
    return sessionStorage.getItem('eams_token') || '';
  }

  function isCurrentUserSudo() {
    try {
      if (typeof window.isSudoAdmin === 'function') {
        var user = JSON.parse(sessionStorage.getItem('eams_user') || '{}');
        if (window.isSudoAdmin(user)) return true;
      }
      var access = JSON.parse(sessionStorage.getItem('eams_access') || '{}');
      if (access && access.flags && access.flags.isSudo) return true;
      if (access && access.tier === 'sudoAdmin') return true;
      var user = JSON.parse(sessionStorage.getItem('eams_user') || '{}');
      return Boolean(user && (user.isSudoAdmin || user.role === 'sudo' || user.accessRole === 'sudoAdmin'));
    } catch (e) {
      return false;
    }
  }

  function isSudoAdmin() {
    return isCurrentUserSudo();
  }

  function isCurrentUserSuperAdmin() {
    try {
      if (typeof window.isCurrentUserSuperAdmin === 'function') {
        return window.isCurrentUserSuperAdmin();
      }
      var access = JSON.parse(sessionStorage.getItem('eams_access') || '{}');
      if (access && access.flags && access.flags.isSuper) return true;
      if (access && (access.tier === 'superAdmin' || access.accessRole === 'superAdmin')) return true;
      var user = JSON.parse(sessionStorage.getItem('eams_user') || '{}');
      return Boolean(user && user.isSuperAdmin);
    } catch (e) {
      return false;
    }
  }

  function updateExecutiveRolesTabVisibility() {
    var isSudo = isCurrentUserSudo();
    var wardenBtn = document.getElementById('rtab-btn-wardens');
    var reqBtn = document.getElementById('rtab-btn-requests');
    var wardenSec = document.getElementById('role-sec-wardens');
    var reqSec = document.getElementById('role-sec-requests');

    if (!window._pubSettings && typeof fetch === 'function') {
      fetch('/api/settings/public')
        .then(function(r) { return r.json(); })
        .then(function(pub) {
          window._pubSettings = pub;
          updateExecutiveRolesTabVisibility();
        })
        .catch(function() {});
    }

    var pub = window._pubSettings || (window.DB && DB.get('settings') && DB.get('settings').pages ? { pages: DB.get('settings').pages } : null);
    var pageHostel = (pub && pub.pages && pub.pages.pageHostel !== undefined) ? pub.pages.pageHostel : (window._pubSettings ? 'enabled' : 'hidden');
    var isHostelDisabled = String(pageHostel).toLowerCase() === 'disabled' || String(pageHostel).toLowerCase() === 'hidden' || pageHostel === false;

    if (!isSudo || isHostelDisabled) {
      if (wardenBtn) wardenBtn.style.display = 'none';
      if (wardenSec) wardenSec.style.display = 'none';

      if (_rolesState.currentTab === 'wardens') {
        _rolesState.currentTab = 'departments';
        var deptBtn = document.getElementById('rtab-btn-departments');
        var deptSec = document.getElementById('role-sec-departments');
        var b = document.getElementById('rtab-btn-wardens');
        if (b) b.classList.remove('act');
        if (deptBtn) deptBtn.classList.add('act');
        if (deptSec) deptSec.style.display = 'block';
      }
    } else {
      if (wardenBtn) wardenBtn.style.display = '';
    }

    if (!isSudo) {
      if (reqBtn) reqBtn.style.display = 'none';
      if (reqSec) reqSec.style.display = 'none';

      if (_rolesState.currentTab === 'requests') {
        _rolesState.currentTab = 'departments';
        var deptBtn = document.getElementById('rtab-btn-departments');
        var deptSec = document.getElementById('role-sec-departments');
        var b = document.getElementById('rtab-btn-requests');
        if (b) b.classList.remove('act');
        if (deptBtn) deptBtn.classList.add('act');
        if (deptSec) deptSec.style.display = 'block';
      }
    } else {
      if (reqBtn) reqBtn.style.display = '';
    }
  }

  function getCurrentUserDeptId() {
    try {
      var access = JSON.parse(sessionStorage.getItem('eams_access') || '{}');
      if (access && access.pages && access.pages.admin && access.pages.admin.deptId) {
        return String(access.pages.admin.deptId);
      }
      var user = JSON.parse(sessionStorage.getItem('eams_user') || '{}');
      return user.deptId ? String(user.deptId) : null;
    } catch (e) {
      return null;
    }
  }

  function apiCall(url, options) {
    options = options || {};
    var headers = options.headers || {};
    headers['Authorization'] = 'Bearer ' + getToken();
    headers['Accept'] = 'application/json';
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    options.headers = headers;

    return fetch(url, options).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || 'Request failed with status ' + res.status);
          err.status = res.status;
          err.code = data.code;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // ── 1. OVERVIEW & CARDS (§7.4) ──────────────────────────────────────────────

  function loadExecutiveRolesOverview() {
    updateExecutiveRolesTabVisibility();
    var gridEl = document.getElementById('roles-dept-grid');
    if (gridEl) {
      gridEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--tmu);"><re-icon icon="refresh-cw" size="20" class="spin"></re-icon> Loading executive roles…</div>';
    }

    return apiCall('/api/roles/overview')
      .then(function (data) {
        _rolesState.departments = Array.isArray(data) ? data : [];
        renderDepartmentCards();
        setTimeout(function () { updateExecutiveTabIndicator(false); }, 30);

        // ── SYNC HOD STATE INTO LOCAL DEPTS FOR DEPARTMENT CARDS ──
        if (Array.isArray(data) && typeof DB !== 'undefined') {
          var localDepts = DB.get('depts') || [];
          var changed = false;
          data.forEach(function (rd) {
            var ld = localDepts.find(function (x) { return String(x._id) === String(rd._id); });
            if (ld) {
              var newHodName = rd.hod ? rd.hod.name : '';
              var newHodId = rd.hod ? rd.hod.teacherId : null;
              if (ld.hodName !== newHodName || String(ld.hodId || '') !== String(newHodId || '')) {
                ld.hodName = newHodName;
                ld.hodId = newHodId;
                changed = true;
              }
            }
          });
          if (changed && window._currentPage === 'depts' && typeof renderDepartments === 'function') {
            renderDepartments();
          }
        }
      })
      .catch(function (err) {
        console.error('[loadExecutiveRolesOverview error]:', err);
        if (gridEl) {
          gridEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#ef4444;"><re-icon icon="alert-circle" size="24"></re-icon><div style="margin-top:8px;">Failed to load executive overview: ' + escapeHtml(err.message) + '</div></div>';
        }
      });
  }

    function getInitials(name) {
    if (!name) return '??';
    var parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function updateExecutiveTabIndicator(animate) {
    var switcher = document.getElementById('exec-roles-switcher');
    if (!switcher) return;
    var ind = document.getElementById('exec-tab-ind');
    if (!ind) return;
    var actBtn = switcher.querySelector('.exec-tab-btn.act') || switcher.querySelector('.tab.act');
    if (!actBtn || actBtn.offsetWidth === 0) return;

    var x = actBtn.offsetLeft;
    var w = actBtn.offsetWidth;

    if (animate === false) {
      ind.classList.add('no-anim');
    } else {
      ind.classList.remove('no-anim');
    }

    ind.style.transform = 'translateX(' + x + 'px)';
    ind.style.width = w + 'px';

    if (animate === false) {
      void ind.offsetWidth;
      requestAnimationFrame(function () {
        ind.classList.remove('no-anim');
      });
    }
  }
  window.updateExecutiveTabIndicator = updateExecutiveTabIndicator;

  window.addEventListener('resize', function () {
    updateExecutiveTabIndicator(false);
  });

  function renderExecutiveCard(d) {
    var isSupporting = (d.category === 'supporting') ||
      ['MAB', 'PHY', 'CHY', 'ENG', 'S&H', 'MATH', 'MATHS'].includes(String(d.code || '').toUpperCase()) ||
      /mathematics|physics|chemistry|humanities/i.test(String(d.name || ''));
    var totalAdv = d.advisors ? d.advisors.total : 0;
    var assignedAdv = d.advisors ? d.advisors.assigned : 0;
    var secAdv = d.advisors ? (d.advisors.secondaryAssigned || 0) : 0;
    var openAdv = d.advisors ? d.advisors.open : 0;

    var reqRoles = isSupporting ? ['hod', 'superAdmin'] : ['hod', 'superAdmin', 'ttCoordinator'];
    var filledCount = 0;
    if (d.hod) filledCount++;
    if (d.superAdmin) filledCount++;
    if (!isSupporting && d.ttCoordinator) filledCount++;

    var isComplete = (filledCount === reqRoles.length);
    var barsHtml = reqRoles.map(function (r, idx) {
      var isFilled = (idx === 0 && d.hod) || (idx === 1 && d.superAdmin) || (idx === 2 && d.ttCoordinator);
      return '<i class="' + (isFilled ? 'on' : '') + '"></i>';
    }).join('');

    var coverageHtml = '' +
      '<div class="cv' + (isComplete ? '' : ' w') + '">' +
        '<div>' + barsHtml + '</div>' +
        filledCount + ' of ' + reqRoles.length + ' roles filled' +
      '</div>';

    var hodHtml = d.hod
      ? '<span class="as"><span class="pp"><i>' + escapeHtml(getInitials(d.hod.name)) + '</i><b>' + escapeHtml(d.hod.name) + '</b></span></span>'
      : '<span class="as"><span class="wn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"></path><path d="M12 10v5M12 18h.01"></path></svg> Unassigned</span><button type="button" class="ad" onclick="openManagePrivilegesDrawer(\'' + d._id + '\', \'hod\')">Assign</button></span>';

    var secHodHtml = d.secondaryHod
      ? '<div class="rw card-role-row"><i class="ri"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"></path></svg></i><span class="rl role-lbl">Sec. HOD</span><span class="as"><span class="pp"><i>' + escapeHtml(getInitials(d.secondaryHod.name)) + '</i><b style="color:var(--pri,#1b5e20);">' + escapeHtml(d.secondaryHod.name) + '</b></span></span></div>'
      : '';

    var superHtml = d.superAdmin
      ? '<span class="as"><span class="pp"><i>' + escapeHtml(getInitials(d.superAdmin.name)) + '</i><b>' + escapeHtml(d.superAdmin.name) + '</b></span></span>'
      : '<span class="as"><span class="wn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"></path><path d="M12 10v5M12 18h.01"></path></svg> Unassigned</span><button type="button" class="ad" onclick="openManagePrivilegesDrawer(\'' + d._id + '\', \'superAdmin\')">Assign</button></span>';

    var ttHtml = '';
    if (!isSupporting || d.ttCoordinator) {
      var ttVal = d.ttCoordinator
        ? '<span class="as"><span class="pp"><i>' + escapeHtml(getInitials(d.ttCoordinator.name)) + '</i><b>' + escapeHtml(d.ttCoordinator.name) + '</b></span></span>'
        : '<span class="as"><span class="wn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"></path><path d="M12 10v5M12 18h.01"></path></svg> Unassigned</span><button type="button" class="ad" onclick="openManagePrivilegesDrawer(\'' + d._id + '\', \'ttCoordinator\')">Assign</button></span>';
      ttHtml = '<div class="rw card-role-row"><i class="ri"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M4 10h16M9 3v4M15 3v4"></path></svg></i><span class="rl role-lbl">TT Coord.</span>' + ttVal + '</div>';
    }

    var secTtHtml = d.secondaryTtCoordinator
      ? '<div class="rw card-role-row"><i class="ri"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M4 10h16M9 3v4M15 3v4"></path></svg></i><span class="rl role-lbl">Sec. TTC</span><span class="as"><span class="pp"><i>' + escapeHtml(getInitials(d.secondaryTtCoordinator.name)) + '</i><b style="color:var(--pri,#1b5e20);">' + escapeHtml(d.secondaryTtCoordinator.name) + '</b></span></span></div>'
      : '';

    var actingHtml = '';
    if (d.actingHod && d.actingHod.name) {
      actingHtml = '<div class="rw card-role-row acting-row" style="background:#fffbeb;border-radius:10px;padding:8px 12px;margin:4px 0;"><i class="ri" style="background:#fef3c7;color:#b45309;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></i><span class="rl role-lbl" style="color:#b45309;font-weight:600;">Acting HOD</span><span class="as"><span class="wn" style="background:#fef3c7;border-color:#fde68a;color:#92400e;font-weight:600;">' + escapeHtml(d.actingHod.name) + ' (Active)</span></span></div>';
    }

    var advisorsRow = '';
    if (totalAdv > 0) {
      var advVal = assignedAdv + ' / ' + totalAdv + ' assigned' +
        (secAdv > 0 ? ' · ' + secAdv + ' dual' : '') +
        (openAdv > 0 ? ' · <span class="wn" style="padding:2px 8px;font-size:11px;">⚠ ' + openAdv + ' open</span>' : '');
      advisorsRow = '<div class="rw card-role-row"><i class="ri"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"></circle><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a4 4 0 0 0 0-7"></path></svg></i><span class="rl role-lbl">Advisors</span><span class="as" style="font-size:13px;font-weight:500;color:#33463a;">' + advVal + '</span></div>';
    }

    var supportingBanner = '';
    if (isSupporting) {
      supportingBanner = '<div class="sv"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg> Serves programme departments <i>CSE</i> <i>ECE</i> <i>MECH</i></div>';
    }

    var metaPills = '<span>' + escapeHtml(d.threeLetterCode || d.code) + (d.number ? ' · ' + escapeHtml(d.number) : '') + '</span>' +
      '<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"></circle><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a4 4 0 0 0 0-7"></path></svg> ' + (d.staffCount || 0) + ' staff</span>' +
      (!isSupporting && d.classCount ? '<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18"></path></svg> ' + d.classCount + ' classes</span>' : '');

    var advisorsBtn = (!isSupporting || totalAdv > 0)
      ? '<button type="button" class="bt btn-sm btn-out" onclick="openManageAdvisorsDrawer(\'' + d._id + '\')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"></circle><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a4 4 0 0 0 0-7"></path></svg> Manage Advisors</button>'
      : '';

    return '' +
      '<article class="ec dept-role-card' + (isSupporting ? ' sp' : '') + '" id="dcard-' + d._id + '">' +
        '<div class="hd card-top">' +
          '<i class="ib"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V5l8-3v19M12 9h8v12M2 21h20M8 8h1M8 12h1M8 16h1"></path></svg></i>' +
          '<div>' +
            '<small class="ey">' + (isSupporting ? 'SUPPORTING DEPARTMENT' : 'PROGRAMME DEPARTMENT') + '</small>' +
            '<h3 class="dept-name">' + escapeHtml(d.name) + '</h3>' +
          '</div>' +
        '</div>' +
        '<div class="mt dept-sub">' + metaPills + '</div>' +
        coverageHtml +
        '<div class="rs card-body-roles">' +
          '<div class="rw card-role-row"><i class="ri"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"></path></svg></i><span class="rl role-lbl">HOD</span>' + hodHtml + '</div>' +
          secHodHtml +
          '<div class="rw card-role-row"><i class="ri"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"></path></svg></i><span class="rl role-lbl">Super Admin</span>' + superHtml + '</div>' +
          ttHtml +
          secTtHtml +
          advisorsRow +
          actingHtml +
        '</div>' +
        supportingBanner +
        '<div class="ft card-actions">' +
          '<button type="button" class="bt p btn-sm btn-pri" onclick="openManagePrivilegesDrawer(\'' + d._id + '\')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"></circle><path d="M11 12l9-9M16 7l3 3"></path></svg> Manage Privileges</button>' +
          advisorsBtn +
        '</div>' +
      '</article>';
  }

  function renderDepartmentCards() {
    var gridEl = document.getElementById('roles-dept-grid');
    if (!gridEl) return;

    var depts = _rolesState.departments || [];
    var search = (_rolesState.search || '').toLowerCase().trim();
    var filter = _rolesState.filter || 'all';

    var filtered = depts.filter(function (d) {
      if (search) {
        var matchName = (d.name || '').toLowerCase().includes(search);
        var matchCode = (d.code || '').toLowerCase().includes(search);
        var matchNum = (d.number || '').toLowerCase().includes(search);
        if (!matchName && !matchCode && !matchNum) return false;
      }
      if (filter === 'missing-hod') return !d.hod;
      if (filter === 'missing-super') return !d.superAdmin;
      if (filter === 'open-advisors') return d.advisors && d.advisors.open > 0;
      return true;
    });

    if (filtered.length === 0) {
      gridEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:48px 24px;color:var(--tmu);background:#fff;border-radius:18px;border:1px solid #d9e6d6;"><re-icon icon="search" size="32" style="opacity:0.35;margin-bottom:12px;"></re-icon><div style="font-size:15px;font-weight:600;color:#14281c;">No departments matching current search or filters.</div><div style="font-size:13px;color:#5f7264;margin-top:4px;">Try clearing search keywords or selecting another filter.</div></div>';
      return;
    }

    gridEl.innerHTML = filtered.map(renderExecutiveCard).join('');
  }

  function filterExecutiveCards() {
    var searchInput = document.getElementById('roles-search-input');
    _rolesState.search = searchInput ? searchInput.value : '';
    renderDepartmentCards();
  }

  function setExecutiveFilter(filter) {
    _rolesState.filter = filter || 'all';
    ['all', 'missing-hod', 'missing-super', 'open-advisors'].forEach(function (f) {
      var btn = document.getElementById('rchip-' + f);
      if (btn) btn.classList.toggle('act', f === _rolesState.filter);
    });
    renderDepartmentCards();
  }

  function switchExecutiveTab(tab) {
    var isSudo = isCurrentUserSudo();
    var pub = window._pubSettings || {};
    var pageHostel = (pub.pages && pub.pages.pageHostel !== undefined) ? pub.pages.pageHostel : 'enabled';
    var isHostelDisabled = String(pageHostel).toLowerCase() === 'disabled' || String(pageHostel).toLowerCase() === 'hidden' || pageHostel === false;

    if ((!isSudo || isHostelDisabled) && tab === 'wardens') {
      tab = 'departments';
      if (isHostelDisabled && typeof showToast === 'function') {
        showToast('Hostel & Warden portal is currently disabled in Pages & Portal Access Control.', 'warn');
      }
    }
    if (!isSudo && tab === 'requests') {
      tab = 'departments';
    }
    _rolesState.currentTab = tab || 'departments';

    ['departments', 'wardens', 'institution', 'requests'].forEach(function (t) {
      var btn = document.getElementById('rtab-btn-' + t);
      if (btn) {
        if ((!isSudo || (t === 'wardens' && isHostelDisabled)) && (t === 'wardens' || t === 'requests')) {
          btn.style.display = 'none';
        } else {
          btn.style.display = '';
        }
        btn.classList.toggle('act', t === _rolesState.currentTab);
      }

      var sec = document.getElementById('role-sec-' + t);
      if (sec) {
        if ((!isSudo || (t === 'wardens' && isHostelDisabled)) && (t === 'wardens' || t === 'requests')) {
          sec.style.display = 'none';
        } else {
          sec.style.display = (t === _rolesState.currentTab) ? 'block' : 'none';
        }
      }
    });

    var deptControls = document.getElementById('roles-dept-controls');
    if (deptControls) {
      deptControls.style.display = (_rolesState.currentTab === 'departments') ? 'flex' : 'none';
    }

    setTimeout(function () { updateExecutiveTabIndicator(true); }, 20);

    if (_rolesState.currentTab === 'departments') {
      loadExecutiveRolesOverview();
    } else if (_rolesState.currentTab === 'wardens') {
      if (isSudo) loadWardensOverview();
    } else if (_rolesState.currentTab === 'institution') {
      loadInstitutionOverview();
    } else if (_rolesState.currentTab === 'requests') {
      if (isSudo) loadAccessRequests();
    }
  }

  // ── 2. MANAGE PRIVILEGES DRAWER (§7.5) ──────────────────────────────────────

  function openManagePrivilegesDrawer(deptId, autoOpenRole) {
    _rolesState.activeDeptId = deptId;
    var drawer = document.getElementById('drawer-manage-privileges');
    var backdrop = document.getElementById('drawer-backdrop-privileges');
    if (!drawer || !backdrop) return;

    backdrop.classList.add('open');
    drawer.classList.add('open');

    var titleEl = document.getElementById('dpriv-title');
    var metaEl = document.getElementById('dpriv-sub');
    if (titleEl) titleEl.textContent = 'Manage Privileges';
    if (metaEl) metaEl.textContent = 'Loading department roles and grants…';

    apiCall('/api/roles/departments/' + deptId)
      .then(function (data) {
        _rolesState.activeDeptData = data;
        renderPrivilegesDrawerContent(data);
        if (autoOpenRole && isCurrentUserSudo()) {
          var roles = data.roles || {};
          var holder = roles[autoOpenRole];
          openStaffPickerForRole(
            autoOpenRole,
            holder ? holder.teacherId : '',
            holder ? holder.teacherName : ''
          );
        }
      })
      .catch(function (err) {
        console.error('[openManagePrivilegesDrawer error]:', err);
        showToast('Failed to load department privileges: ' + err.message, 'error');
      });
  }

  function closeManagePrivilegesDrawer() {
    var drawer = document.getElementById('drawer-manage-privileges');
    var backdrop = document.getElementById('drawer-backdrop-privileges');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  }

  function renderPrivilegesDrawerContent(data) {
    var dept = data.department;
    var roles = data.roles || {};
    var isSudo = isCurrentUserSudo();

    var titleEl = document.getElementById('dpriv-title');
    var metaEl = document.getElementById('dpriv-sub');
    if (titleEl) titleEl.textContent = dept.name + ' · Privileges';
    if (metaEl) metaEl.textContent = dept.code + (dept.number ? ' · ' + dept.number : '') + ' · Department Access & Delegated Authorities';

    // 1. Roles Section
    function renderRoleItem(roleKey, roleLabel, holder, isLocked, isOptional) {
      var nameHtml = holder
        ? '<div style="font-weight:700;color:var(--td);font-size:13.5px;">' + escapeHtml(holder.teacherName) + '</div>' +
          '<div style="font-size:11.5px;color:var(--tmu);">' + escapeHtml(holder.teacherTrackId) + '</div>'
        : '<div style="color:var(--tmu);font-size:13px;font-style:italic;">' + (isOptional ? '— None (Optional) —' : '— Not Assigned —') + '</div>';

      var btnHtml = '';
      if (isLocked) {
        btnHtml = '<span title="Only Sudo Admin can reassign this role" style="color:var(--tmu);font-size:12px;display:flex;align-items:center;gap:4px;"><re-icon icon="lock" size="14"></re-icon> Locked</span>';
      } else {
        var actionText = holder ? 'Change ▾' : 'Assign ▾';
        var removeBtn = (holder && ['ttCoordinator', 'secondaryTtCoordinator', 'placementCoordinator', 'secondaryHod'].includes(roleKey))
          ? '<button class="btn-sm btn-ghost text-danger" style="margin-left:4px;" onclick="removeDepartmentRole(' + "'" + roleKey + "'" + ')" title="Remove"><re-icon icon="x" size="13"></re-icon></button>'
          : '';
        btnHtml = '<div style="display:flex;align-items:center;">' +
          '<button class="btn-sm btn-out" onclick="openStaffPickerForRole(' + "'" + roleKey + "'" + ', ' + "'" + (holder ? holder.teacherId : '') + "'" + ', ' + "'" + (holder ? escapeHtml(holder.teacherName) : '') + "'" + ')">' + actionText + '</button>' +
          removeBtn +
          '</div>';
      }

      return '' +
        '<div class="priv-role-card">' +
          '<div style="flex:1;">' +
            '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--tmu);margin-bottom:3px;">' + roleLabel + '</div>' +
            nameHtml +
          '</div>' +
          btnHtml +
        '</div>';
    }

    var rolesContainer = document.getElementById('dpriv-roles-list');
    if (rolesContainer) {
      rolesContainer.innerHTML =
        renderRoleItem('hod', 'Head of Department (HOD) [Primary]', roles.hod, !isSudo, false) +
        renderRoleItem('secondaryHod', 'Secondary HOD (Optional)', roles.secondaryHod, !isSudo, true) +
        renderRoleItem('superAdmin', 'Super Administrator', roles.superAdmin, !isSudo, false) +
        renderRoleItem('ttCoordinator', 'Timetable Coordinator [Primary]', roles.ttCoordinator, false, false) +
        renderRoleItem('secondaryTtCoordinator', 'Secondary Timetable Coordinator (Optional)', roles.secondaryTtCoordinator, false, true) +
        renderRoleItem('placementCoordinator', 'Placement Coordinator', roles.placementCoordinator, false, false);
    }

    // 2. Privileged Staff Section
    var staffListEl = document.getElementById('dpriv-staff-list');
    var privStaff = data.privilegedStaff || [];
    if (staffListEl) {
      if (privStaff.length === 0) {
        staffListEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--tmu);font-size:12.5px;background:var(--bg2,#f8fafc);border-radius:8px;">No delegated sub-admin staff in this department.</div>';
      } else {
        staffListEl.innerHTML = privStaff.map(function (ps) {
          var grantsHtml = (ps.grants || []).map(function (g) {
            var actionsStr = (g.actions || []).join(', ');
            var toStr = g.validTo ? 'until ' + new Date(g.validTo).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'permanent';
            return '<div style="font-size:11.5px;color:var(--td);margin-top:2px;">• <strong>' + escapeHtml(g.page) + '</strong> (' + escapeHtml(actionsStr) + ') · <span style="color:var(--tmu);">' + toStr + '</span> ' +
              '<button class="btn-xs btn-ghost text-danger" onclick="revokeStaffGrant(\'' + ps._id + '\', \'' + g._id + '\')" title="Revoke"><re-icon icon="trash2" size="11"></re-icon></button></div>';
          }).join('');

          return '' +
            '<div class="priv-staff-item">' +
              '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
                '<div>' +
                  '<div style="font-weight:700;font-size:13px;color:var(--td);">' + escapeHtml(ps.fullName) + '</div>' +
                  '<div style="font-size:11px;color:var(--tmu);">' + escapeHtml(ps.employeeNo || '') + ' · ' + escapeHtml(ps.designation || 'Faculty') + '</div>' +
                '</div>' +
              '</div>' +
              '<div style="margin-top:6px;padding-left:4px;">' + grantsHtml + '</div>' +
            '</div>';
        }).join('');
      }
    }

    // 3. Super Admin Bulk Upload Settings (Sudo only per §6.4)
    var bulkWrap = document.getElementById('dpriv-bulk-wrap');
    var bulkChk = document.getElementById('dpriv-bulk-chk');
    if (bulkWrap) {
      bulkWrap.style.display = isSudo ? 'block' : 'none';
      if (bulkChk && roles.superAdmin) {
        bulkChk.checked = Boolean(data.superAdminSettings && data.superAdminSettings.bulkUploadsAllowed);
        bulkChk.onchange = function () {
          toggleSuperAdminBulk(roles.superAdmin.teacherId, bulkChk.checked);
        };
      }
    }

    // 4. Department History
    var histList = document.getElementById('dpriv-history-list');
    var history = data.history || [];
    if (histList) {
      if (history.length === 0) {
        histList.innerHTML = '<div style="color:var(--tmu);font-size:12px;padding:8px 0;">No previous role changes recorded.</div>';
      } else {
        histList.innerHTML = history.slice(0, 10).map(function (h) {
          var dateStr = new Date(h.to || h.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
          return '<div style="font-size:11.5px;color:var(--tmu);padding:4px 0;border-bottom:1px solid #f1f5f9;">' +
            '<strong>' + escapeHtml(h.role) + '</strong>: ' + escapeHtml(h.teacherName) + ' ended on ' + dateStr +
            (h.endReason ? ' (' + escapeHtml(h.endReason) + ')' : '') +
          '</div>';
        }).join('');
      }
    }
  }

  // ── 3. MANAGE ADVISORS DRAWER (§7.6) ────────────────────────────────────────

  function openManageAdvisorsDrawer(deptId) {
    _rolesState.activeDeptId = deptId;
    var drawer = document.getElementById('drawer-manage-advisors');
    var backdrop = document.getElementById('drawer-backdrop-advisors');
    if (!drawer || !backdrop) return;

    backdrop.classList.add('open');
    drawer.classList.add('open');

    var titleEl = document.getElementById('dadv-title');
    var metaEl = document.getElementById('dadv-sub');
    if (titleEl) titleEl.textContent = 'Class Advisors';
    if (metaEl) metaEl.textContent = 'Loading classes and assignments…';

    apiCall('/api/roles/departments/' + deptId + '/advisors')
      .then(function (classes) {
        renderAdvisorsDrawerContent(classes);
      })
      .catch(function (err) {
        console.error('[openManageAdvisorsDrawer error]:', err);
        showToast('Failed to load class advisors: ' + err.message, 'error');
      });
  }

  function closeManageAdvisorsDrawer() {
    var drawer = document.getElementById('drawer-manage-advisors');
    var backdrop = document.getElementById('drawer-backdrop-advisors');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  }

  function renderAdvisorsDrawerContent(classes) {
    var listEl = document.getElementById('dadv-classes-list');
    if (!listEl) return;

    if (!Array.isArray(classes) || classes.length === 0) {
      listEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--tmu);">No classes registered in this department.</div>';
      return;
    }

    listEl.innerHTML = classes.map(function (c) {
      var hasAdvisor = Boolean(c.advisor);
      var hasSecAdvisor = Boolean(c.secondaryAdvisor);

      var statusBadge = '';
      if (hasAdvisor && hasSecAdvisor) {
        statusBadge = '<span class="badge" style="background:rgba(34,197,94,0.12);color:#16a34a;font-weight:600;padding:2px 8px;border-radius:6px;font-size:11px;">✅ Dual Assigned</span>';
      } else if (hasAdvisor) {
        statusBadge = '<span class="badge" style="background:rgba(34,197,94,0.12);color:#16a34a;font-weight:600;padding:2px 8px;border-radius:6px;font-size:11px;">✅ Primary Assigned</span>';
      } else {
        statusBadge = '<span class="badge" style="background:rgba(239,68,68,0.12);color:#ef4444;font-weight:600;padding:2px 8px;border-radius:6px;font-size:11px;">⚠ Primary Missing</span>';
      }

      // 1. Primary Advisor Row
      var advisorInfo = hasAdvisor
        ? '<div style="font-weight:700;font-size:13px;color:var(--td);">' + escapeHtml(c.advisor.fullName) + '</div>' +
          '<div style="font-size:11px;color:var(--tmu);">' + escapeHtml(c.advisor.employeeNo || '') + ' · ' + escapeHtml(c.advisor.designation || '') + '</div>'
        : '<div style="color:var(--tmu);font-size:12.5px;font-style:italic;">No primary advisor assigned</div>';

      var actionBtn = hasAdvisor
        ? '<button class="btn-xs btn-out" onclick="openStaffPickerForClassAdvisor(\'' + c._id + '\', \'' + c.advisor._id + '\', \'' + escapeHtml(c.advisor.fullName) + '\')">Change ▾</button>' +
          '<button class="btn-xs btn-ghost text-danger" style="margin-left:4px;" onclick="removeClassAdvisor(\'' + c._id + '\')" title="Remove"><re-icon icon="x" size="13"></re-icon></button>'
        : '<button class="btn-xs btn-pri" onclick="openStaffPickerForClassAdvisor(\'' + c._id + '\', \'\', \'\')">Assign ▾</button>';

      // 2. Secondary Advisor Row (Optional)
      var secAdvisorInfo = hasSecAdvisor
        ? '<div style="font-weight:700;font-size:13px;color:var(--td);">' + escapeHtml(c.secondaryAdvisor.fullName) + '</div>' +
          '<div style="font-size:11px;color:var(--tmu);">' + escapeHtml(c.secondaryAdvisor.employeeNo || '') + ' · ' + escapeHtml(c.secondaryAdvisor.designation || '') + '</div>'
        : '<div style="color:var(--tmu);font-size:12.5px;font-style:italic;">None (Optional)</div>';

      var secActionBtn = hasSecAdvisor
        ? '<button class="btn-xs btn-out" onclick="openStaffPickerForSecondaryClassAdvisor(\'' + c._id + '\', \'' + c.secondaryAdvisor._id + '\', \'' + escapeHtml(c.secondaryAdvisor.fullName) + '\')">Change ▾</button>' +
          '<button class="btn-xs btn-ghost text-danger" style="margin-left:4px;" onclick="removeSecondaryClassAdvisor(\'' + c._id + '\')" title="Remove"><re-icon icon="x" size="13"></re-icon></button>'
        : '<button class="btn-xs btn-out" onclick="openStaffPickerForSecondaryClassAdvisor(\'' + c._id + '\', \'\', \'\')">+ Add Secondary</button>';

      return '' +
        '<div class="adv-class-card">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">' +
            '<div>' +
              '<div style="font-weight:800;font-size:14px;color:var(--td);">' + escapeHtml(c.name) + '</div>' +
              '<div style="font-size:11.5px;color:var(--tmu);">Year ' + c.year + ' · Sec ' + escapeHtml(c.section || 'A') + (c.batch ? ' · Batch ' + escapeHtml(c.batch) : '') + '</div>' +
            '</div>' +
            statusBadge +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:8px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg2,#f8fafc);padding:8px 12px;border-radius:8px;">' +
              '<div>' +
                '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--tmu);margin-bottom:2px;">Primary Advisor</div>' +
                advisorInfo +
              '</div>' +
              '<div style="display:flex;align-items:center;">' + actionBtn + '</div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg2,#f8fafc);padding:8px 12px;border-radius:8px;">' +
              '<div>' +
                '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--tmu);margin-bottom:2px;">Secondary Advisor (Optional)</div>' +
                secAdvisorInfo +
              '</div>' +
              '<div style="display:flex;align-items:center;">' + secActionBtn + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  // ── 4. STAFF PICKER & CONFIRMATION DIALOG (§7.5, §7.8) ──────────────────────

  function openStaffPickerForRole(roleKey, currentTeacherId, currentTeacherName) {
    _rolesState.targetRole = roleKey;
    _rolesState.targetScopeId = _rolesState.activeDeptId;
    _rolesState.expectedCurrentTeacherId = currentTeacherId || null;

    var pickerModal = document.getElementById('modal-role-staff-picker');
    if (!pickerModal) return;

    pickerModal.style.display = 'flex';
    pickerModal.classList.add('open');

    var roleLabels = {
      hod: 'Head of Department (HOD) [Primary]',
      secondaryHod: 'Secondary HOD (Optional)',
      superAdmin: 'Super Administrator',
      ttCoordinator: 'Timetable Coordinator [Primary]',
      secondaryTtCoordinator: 'Secondary Timetable Coordinator (Optional)',
      placementCoordinator: 'Placement Coordinator',
      principal: 'College Principal',
      classAdvisor: 'Class Advisor',
      secondaryClassAdvisor: 'Secondary Class Advisor (Optional)',
      warden: 'Hostel Warden'
    };
    var roleDisplay = roleLabels[roleKey] || roleKey.toUpperCase();
    var titleEl = document.getElementById('rsp-title');
    if (titleEl) titleEl.textContent = 'Select Faculty for ' + roleDisplay;

    var listEl = document.getElementById('rsp-staff-list');
    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--tmu);">Loading eligible faculty members…</div>';

    apiCall('/api/roles/departments/' + _rolesState.activeDeptId + '/staff?role=' + roleKey)
      .then(function (staff) {
        _rolesState.eligibleStaff = staff;
        renderStaffPickerList(staff);
      })
      .catch(function (err) {
        console.error('[staff picker error]:', err);
        showToast('Failed to load eligible faculty: ' + err.message, 'error');
      });
  }

  function openStaffPickerForClassAdvisor(classId, currentTeacherId, currentTeacherName) {
    _rolesState.targetRole = 'classAdvisor';
    _rolesState.targetScopeId = classId;
    _rolesState.expectedCurrentTeacherId = currentTeacherId || null;

    var pickerModal = document.getElementById('modal-role-staff-picker');
    if (!pickerModal) return;

    pickerModal.style.display = 'flex';
    pickerModal.classList.add('open');
    var titleEl = document.getElementById('rsp-title');
    if (titleEl) titleEl.textContent = 'Select Class Advisor';

    var listEl = document.getElementById('rsp-staff-list');
    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--tmu);">Loading eligible faculty members…</div>';

    apiCall('/api/roles/departments/' + _rolesState.activeDeptId + '/staff?role=classAdvisor')
      .then(function (staff) {
        _rolesState.eligibleStaff = staff;
        renderStaffPickerList(staff);
      })
      .catch(function (err) {
        console.error('[staff picker error]:', err);
        showToast('Failed to load eligible faculty: ' + err.message, 'error');
      });
  }

  function openStaffPickerForSecondaryClassAdvisor(classId, currentTeacherId, currentTeacherName) {
    _rolesState.targetRole = 'secondaryClassAdvisor';
    _rolesState.targetScopeId = classId;
    _rolesState.expectedCurrentTeacherId = currentTeacherId || null;

    var pickerModal = document.getElementById('modal-role-staff-picker');
    if (!pickerModal) return;

    pickerModal.style.display = 'flex';
    pickerModal.classList.add('open');
    var titleEl = document.getElementById('rsp-title');
    if (titleEl) titleEl.textContent = 'Select Secondary Class Advisor (Optional)';

    var listEl = document.getElementById('rsp-staff-list');
    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--tmu);">Loading eligible faculty members…</div>';

    apiCall('/api/roles/departments/' + _rolesState.activeDeptId + '/staff?role=secondaryClassAdvisor')
      .then(function (staff) {
        _rolesState.eligibleStaff = staff;
        renderStaffPickerList(staff);
      })
      .catch(function (err) {
        console.error('[staff picker error]:', err);
        showToast('Failed to load eligible faculty: ' + err.message, 'error');
      });
  }

  function renderStaffPickerList(staffList) {
    var listEl = document.getElementById('rsp-staff-list');
    if (!listEl) return;

    if (!Array.isArray(staffList) || staffList.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--tmu);">No active faculty members in this department.</div>';
      return;
    }

    listEl.innerHTML = staffList.map(function (s) {
      var rolesBadge = (s.rolesHeld || []).map(function (r) {
        return '<span class="badge" style="background:#e0e7ff;color:#4338ca;font-size:10.5px;padding:2px 6px;border-radius:4px;margin-right:4px;">' + escapeHtml(r) + '</span>';
      }).join('');

      var disabled = !s.isEligible;
      var disableReason = disabled ? '<span style="color:#ef4444;font-size:11px;margin-left:6px;">(Not eligible)</span>' : '';

      return '' +
        '<div class="staff-picker-row' + (disabled ? ' disabled' : '') + '" onclick="' + (disabled ? '' : 'selectStaffForRole(\'' + s._id + '\')') + '">' +
          '<div style="flex:1;">' +
            '<div style="font-weight:700;font-size:13.5px;color:var(--td);">' + escapeHtml(s.fullName) + disableReason + '</div>' +
            '<div style="font-size:12px;color:var(--tmu);">' + escapeHtml(s.employeeNo || 'No ID') + ' · ' + escapeHtml(s.designation || 'Faculty') + '</div>' +
            (rolesBadge ? '<div style="margin-top:4px;">' + rolesBadge + '</div>' : '') +
          '</div>' +
          '<button class="btn-xs btn-pri" ' + (disabled ? 'disabled' : '') + '>Select &rarr;</button>' +
        '</div>';
    }).join('');
  }

  function filterStaffPickerList() {
    var query = (document.getElementById('rsp-search-input')?.value || '').toLowerCase().trim();
    var filtered = (_rolesState.eligibleStaff || []).filter(function (s) {
      return (s.fullName || '').toLowerCase().includes(query) ||
             (s.employeeNo || '').toLowerCase().includes(query) ||
             (s.designation || '').toLowerCase().includes(query);
    });
    renderStaffPickerList(filtered);
  }

  function closeStaffPicker() {
    var pickerModal = document.getElementById('modal-role-staff-picker');
    if (pickerModal) {
      pickerModal.classList.remove('open');
      pickerModal.style.display = 'none';
    }
  }

  async function selectStaffForRole(teacherId) {
    closeStaffPicker();

    var teacher = (_rolesState.eligibleStaff || []).find(function (t) { return String(t._id) === String(teacherId); });
    if (!teacher) return;

    var role = _rolesState.targetRole;
    var scopeId = _rolesState.targetScopeId;
    var expectedCurrentTeacherId = _rolesState.expectedCurrentTeacherId;

    var confirmMsg = 'Assign ' + role.toUpperCase() + ' to ' + teacher.fullName + '?';
    if (role === 'hod') {
      confirmMsg = 'Confirm HOD appointment: ' + teacher.fullName + ' will gain Controller Portal authority for this department.';
    } else if (role === 'superAdmin') {
      confirmMsg = 'Confirm Super Admin appointment: ' + teacher.fullName + ' will gain department-scoped administrative privileges.';
    }

    var reason = await showPrompt(confirmMsg + '\n\nPlease enter reason / administrative note:', 'Appointed via Executive Roles Console', 'Assign Role');
    if (reason === null) return; // user cancelled

    var url = (role === 'classAdvisor')
      ? '/api/roles/classes/' + scopeId + '/advisor'
      : (role === 'secondaryClassAdvisor')
        ? '/api/roles/classes/' + scopeId + '/secondary-advisor'
        : (role === 'warden')
          ? '/api/roles/blocks/' + scopeId + '/warden'
          : (role === 'principal')
            ? '/api/roles/principal'
            : '/api/roles/departments/' + scopeId + '/' + role;

    apiCall(url, {
      method: 'PUT',
      body: {
        teacherId: teacherId,
        expectedCurrentTeacherId: expectedCurrentTeacherId,
        reason: reason
      }
    })
    .then(function (res) {
      showToast(res.message || 'Role assigned successfully', 'success');
      // Refresh active drawer & cards
      if (role === 'classAdvisor' || role === 'secondaryClassAdvisor') {
        openManageAdvisorsDrawer(_rolesState.activeDeptId);
      } else if (role === 'warden') {
        loadWardensOverview();
      } else if (role === 'principal') {
        loadInstitutionOverview();
      } else {
        openManagePrivilegesDrawer(_rolesState.activeDeptId);
      }
      loadExecutiveRolesOverview();

      // ── LINK WITH DEPARTMENT CARDS (§EAMS INVARIANT) ──
      if (role === 'hod' || role === 'secondaryHod') {
        var localDepts = (typeof DB !== 'undefined' && DB.get('depts')) || [];
        var targetDept = localDepts.find(function (d) { return String(d._id) === String(scopeId); });
        if (targetDept) {
          if (role === 'hod') {
            targetDept.hodId = teacherId;
            targetDept.hodName = teacher.fullName;
          } else {
            targetDept.secondaryHodId = teacherId;
            targetDept.secondaryHodName = teacher.fullName;
          }
        }
        if (typeof renderDepartments === 'function') {
          renderDepartments();
        }
        if (typeof syncFromAPI === 'function') {
          syncFromAPI('depts', '/depts').then(function () {
            if (typeof renderDepartments === 'function') {
              renderDepartments();
            }
          });
        }
      }
    })
    .catch(function (err) {
      console.error('[assign role error]:', err);
      if (err.status === 409) {
        showPopup('Conflict: This role slot was recently updated by another administrator. Reloading current state...', 'Role Conflict Detected', 'warn');
        if (role === 'classAdvisor' || role === 'secondaryClassAdvisor') {
          openManageAdvisorsDrawer(_rolesState.activeDeptId);
        } else if (role === 'warden') {
          loadWardensOverview();
        } else if (role === 'principal') {
          loadInstitutionOverview();
        } else {
          openManagePrivilegesDrawer(_rolesState.activeDeptId);
        }
      } else {
        showToast('Failed to assign role: ' + err.message, 'error');
      }
    });
  }

  async function removeDepartmentRole(roleKey) {
    const ok = await showConfirm('Are you sure you want to remove the ' + roleKey + ' role assignment?', 'Remove Role Assignment', null, null, { danger: true });
    if (!ok) return;

    var reason = await showPrompt('Please enter reason for removing this role:', 'Ended by administrator', 'Reason for Removal');
    if (reason === null) return;

    apiCall('/api/roles/departments/' + _rolesState.activeDeptId + '/' + roleKey, {
      method: 'DELETE',
      body: { reason: reason }
    })
    .then(function (res) {
      showToast(res.message || 'Role removed successfully', 'success');
      openManagePrivilegesDrawer(_rolesState.activeDeptId);
      loadExecutiveRolesOverview();

      // ── LINK WITH DEPARTMENT CARDS (§EAMS INVARIANT) ──
      if (roleKey === 'hod' || roleKey === 'secondaryHod') {
        var localDepts = (typeof DB !== 'undefined' && DB.get('depts')) || [];
        var targetDept = localDepts.find(function (d) { return String(d._id) === String(_rolesState.activeDeptId); });
        if (targetDept) {
          if (roleKey === 'hod') {
            targetDept.hodId = null;
            targetDept.hodName = '';
          } else {
            targetDept.secondaryHodId = null;
            targetDept.secondaryHodName = '';
          }
        }
        if (typeof renderDepartments === 'function') {
          renderDepartments();
        }
        if (typeof syncFromAPI === 'function') {
          syncFromAPI('depts', '/depts').then(function () {
            if (typeof renderDepartments === 'function') {
              renderDepartments();
            }
          });
        }
      }
    })
    .catch(function (err) {
      console.error('[remove role error]:', err);
      showToast('Failed to remove role: ' + err.message, 'error');
    });
  }

  async function removeClassAdvisor(classId) {
    const ok = await showConfirm('Are you sure you want to remove this class advisor assignment?', 'Remove Class Advisor', null, null, { danger: true });
    if (!ok) return;

    var reason = await showPrompt('Please enter reason for removal:', 'Advisor reassignment', 'Reason for Removal');
    if (reason === null) return;

    apiCall('/api/roles/classes/' + classId + '/advisor', {
      method: 'DELETE',
      body: { reason: reason }
    })
    .then(function (res) {
      showToast(res.message || 'Class advisor removed successfully', 'success');
      openManageAdvisorsDrawer(_rolesState.activeDeptId);
      loadExecutiveRolesOverview();
    })
    .catch(function (err) {
      console.error('[remove advisor error]:', err);
      showToast('Failed to remove advisor: ' + err.message, 'error');
    });
  }

  async function removeSecondaryClassAdvisor(classId) {
    const ok = await showConfirm('Are you sure you want to remove this secondary class advisor?', 'Remove Secondary Advisor', null, null, { danger: true });
    if (!ok) return;

    var reason = await showPrompt('Please enter reason for removal:', 'Ended by administrator', 'Reason for Removal');
    if (reason === null) return;

    apiCall('/api/roles/classes/' + classId + '/secondary-advisor', {
      method: 'DELETE',
      body: { reason: reason }
    })
    .then(function (res) {
      showToast(res.message || 'Secondary class advisor removed successfully', 'success');
      openManageAdvisorsDrawer(_rolesState.activeDeptId);
      loadExecutiveRolesOverview();
    })
    .catch(function (err) {
      console.error('[remove secondary advisor error]:', err);
      showToast('Failed to remove secondary advisor: ' + err.message, 'error');
    });
  }

  async function revokeStaffGrant(teacherId, grantId) {
    const ok = await showConfirm('Revoke this delegated grant from faculty member?', 'Revoke Delegated Grant', null, null, { danger: true });
    if (!ok) return;

    apiCall('/api/roles/grants/' + teacherId + '/' + grantId, {
      method: 'DELETE'
    })
    .then(function (res) {
      showToast('Grant revoked successfully', 'success');
      openManagePrivilegesDrawer(_rolesState.activeDeptId);
    })
    .catch(function (err) {
      console.error('[revoke grant error]:', err);
      showToast('Failed to revoke grant: ' + err.message, 'error');
    });
  }

  function toggleSuperAdminBulk(teacherId, enabled) {
    if (!teacherId) return;
    apiCall('/api/roles/super-admin/bulk-toggle', {
      method: 'PUT',
      body: { teacherId: teacherId, enabled: Boolean(enabled) }
    })
    .then(function (res) {
      var msg = (res && res.message) || ('Bulk upload permission ' + (enabled ? 'enabled' : 'disabled'));
      if (typeof showToast === 'function') showToast(msg, 'success');
      else if (typeof dbToast === 'function') dbToast(msg, 'success');
    })
    .catch(function (err) {
      console.error('[toggleSuperAdminBulk error]:', err);
      var errMsg = 'Failed to toggle bulk permission: ' + (err.message || err);
      if (typeof showToast === 'function') showToast(errMsg, 'error');
      else if (typeof dbToast === 'function') dbToast(errMsg, 'error');
    });
  }

  // ── 5. WARDENS MANAGEMENT (§7.7) ────────────────────────────────────────────

  function loadWardensOverview() {
    var container = document.getElementById('roles-wardens-container');
    if (!isCurrentUserSudo()) {
      if (container) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tmu);">Hostel wardens management is only accessible by Sudo Administrators.</div>';
      }
      return;
    }
    if (container) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tmu);">Loading hostel wardens…</div>';
    }

    apiCall('/api/roles/wardens')
      .then(function (hostels) {
        _rolesState.wardens = hostels;
        renderWardensOverview(hostels);
      })
      .catch(function (err) {
        console.error('[loadWardensOverview error]:', err);
        if (container) {
          container.innerHTML = '<div style="padding:24px;text-align:center;color:#ef4444;">Failed to load wardens: ' + escapeHtml(err.message) + '</div>';
        }
      });
  }

  function renderWardensOverview(hostels) {
    var container = document.getElementById('roles-wardens-container');
    if (!container) return;

    if (!Array.isArray(hostels) || hostels.length === 0) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--tmu);background:#fff;border-radius:12px;border:1px solid var(--bdr);">No hostels registered in system.</div>';
      return;
    }

    container.innerHTML = hostels.map(function (h) {
      var iconName = h.gender === 'girls' ? 'home' : 'building2';
      var titleColor = h.gender === 'girls' ? '#db2777' : '#2563eb';

      var blocksHtml = (h.blocks || []).map(function (b) {
        var warden = b.warden;
        var wardenInfo = warden
          ? '<div style="font-weight:700;font-size:13px;color:var(--td);">' + escapeHtml(warden.fullName) + '</div>' +
            '<div style="font-size:11.5px;color:var(--tmu);">' + escapeHtml(warden.department || '') + '</div>'
          : '<div style="color:#ef4444;font-size:12.5px;font-weight:600;">⚠ No warden assigned</div>';

        var actionBtn = warden
          ? '<button class="btn-xs btn-out" onclick="openWardenPicker(\'' + b._id + '\', \'' + warden.teacherId + '\', \'' + h.gender + '\')">Change ▾</button>' +
            '<button class="btn-xs btn-ghost text-danger" style="margin-left:4px;" onclick="removeWarden(\'' + b._id + '\')" title="Remove"><re-icon icon="x" size="13"></re-icon></button>'
          : '<button class="btn-xs btn-pri" onclick="openWardenPicker(\'' + b._id + '\', \'\', \'' + h.gender + '\')">Assign ▾</button>';

        return '' +
          '<div class="warden-block-card">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
              '<div style="font-weight:700;font-size:13.5px;color:var(--td);">' + escapeHtml(b.name) + ' (' + escapeHtml(b.code) + ')</div>' +
              '<span style="font-size:11px;color:var(--tmu);">' + (b.floors || 1) + ' floors</span>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg2,#f8fafc);padding:8px 10px;border-radius:6px;">' +
              '<div>' + wardenInfo + '</div>' +
              '<div style="display:flex;align-items:center;">' + actionBtn + '</div>' +
            '</div>' +
          '</div>';
      }).join('');

      return '' +
        '<div class="card" style="margin-bottom:20px;padding:20px;border-radius:14px;">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;border-bottom:1px solid #f1f5f9;padding-bottom:10px;">' +
            '<re-icon icon="' + iconName + '" size="20" style="color:' + titleColor + ';"></re-icon>' +
            '<div style="font-size:16px;font-weight:800;color:var(--td);">' + escapeHtml(h.name) + ' (' + escapeHtml(h.code) + ')</div>' +
            '<span class="badge" style="margin-left:auto;text-transform:uppercase;font-size:11px;padding:2px 8px;border-radius:4px;background:#f3f4f6;">' + escapeHtml(h.gender) + '</span>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:12px;">' +
            blocksHtml +
          '</div>' +
        '</div>';
    }).join('');
  }

  async function openWardenPicker(blockId, currentTeacherId, hostelGender) {
    _rolesState.targetRole = 'warden';
    _rolesState.targetScopeId = blockId;
    _rolesState.expectedCurrentTeacherId = currentTeacherId || null;

    var pickerModal = document.getElementById('modal-role-staff-picker');
    if (!pickerModal) {
      var teacherId = await showPrompt('Enter Teacher Object ID / username to assign as Warden:', '', 'Assign Warden');
      if (!teacherId || !teacherId.trim()) return;
      var reason = await showPrompt('Administrative note / reason:', 'Assigned as hostel warden', 'Warden Note');
      apiCall('/api/roles/blocks/' + blockId + '/warden', {
        method: 'PUT',
        body: {
          teacherId: teacherId.trim(),
          expectedCurrentTeacherId: currentTeacherId || null,
          reason: reason || ''
        }
      })
      .then(function (res) {
        showToast(res.message || 'Warden assigned successfully', 'success');
        loadWardensOverview();
      })
      .catch(function (err) {
        showToast('Failed to assign warden: ' + err.message, 'error');
      });
      return;
    }

    pickerModal.style.display = 'flex';
    pickerModal.classList.add('open');
    var titleEl = document.getElementById('rsp-title');
    if (titleEl) {
      titleEl.textContent = 'Select Warden (' + (hostelGender === 'girls' ? 'Female Faculty Only' : 'Faculty Member') + ')';
    }

    var listEl = document.getElementById('rsp-staff-list');
    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--tmu);">Loading eligible faculty members…</div>';

    var staffUrl = '/api/roles/staff?role=warden' + (hostelGender === 'girls' ? '&gender=female' : '');
    apiCall(staffUrl)
      .then(function (staff) {
        _rolesState.eligibleStaff = staff;
        renderStaffPickerList(staff);
      })
      .catch(function (err) {
        console.error('[warden picker error]:', err);
        showToast('Failed to load eligible faculty: ' + err.message, 'error');
      });
  }

  function openStaffPickerForPrincipal(currentTeacherId, currentTeacherName) {
    _rolesState.targetRole = 'principal';
    _rolesState.targetScopeId = null;
    _rolesState.expectedCurrentTeacherId = currentTeacherId || null;

    var pickerModal = document.getElementById('modal-role-staff-picker');
    if (!pickerModal) return;

    pickerModal.style.display = 'flex';
    pickerModal.classList.add('open');
    var titleEl = document.getElementById('rsp-title');
    if (titleEl) titleEl.textContent = 'Appoint College Principal';

    var listEl = document.getElementById('rsp-staff-list');
    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--tmu);">Loading eligible faculty members…</div>';

    apiCall('/api/roles/staff?role=principal')
      .then(function (staff) {
        _rolesState.eligibleStaff = staff;
        renderStaffPickerList(staff);
      })
      .catch(function (err) {
        console.error('[principal picker error]:', err);
        showToast('Failed to load eligible faculty: ' + err.message, 'error');
      });
  }

  async function removeWarden(blockId) {
    const ok = await showConfirm('Are you sure you want to remove this block warden?', 'Remove Warden', null, null, { danger: true });
    if (!ok) return;

    var reason = await showPrompt('Reason for removal:', 'Ended warden assignment', 'Reason for Removal');

    apiCall('/api/roles/blocks/' + blockId + '/warden', {
      method: 'DELETE',
      body: { reason: reason || '' }
    })
    .then(function (res) {
      showToast(res.message || 'Warden removed successfully', 'success');
      loadWardensOverview();
    })
    .catch(function (err) {
      console.error('[remove warden error]:', err);
      showToast('Failed to remove warden: ' + err.message, 'error');
    });
  }

  // ── 6. INSTITUTION TAB (§7.3) ───────────────────────────────────────────────

  function loadInstitutionOverview() {
    apiCall('/api/roles/institution')
      .then(function (inst) {
        var p = inst.principal;
        var pNameEl = document.getElementById('inst-principal-name');
        var pMetaEl = document.getElementById('inst-principal-meta');
        var pBadgeEl = document.getElementById('inst-principal-badge');
        var pBtnEl = document.getElementById('btn-reassign-principal');

        if (p) {
          if (pNameEl) pNameEl.textContent = p.fullName || '—';
          if (pMetaEl) pMetaEl.textContent = (p.employeeNo ? p.employeeNo + ' · ' : '') + (p.department || 'All Departments') + (p.email ? ' · ' + p.email : '');
          if (pBadgeEl) {
            pBadgeEl.textContent = 'Active (Principal)';
            pBadgeEl.style.background = 'rgba(34,197,94,0.1)';
            pBadgeEl.style.color = '#16a34a';
          }
          if (pBtnEl) {
            pBtnEl.onclick = function () {
              openStaffPickerForPrincipal(p.teacherId, p.fullName);
            };
          }
        } else {
          if (pNameEl) pNameEl.textContent = '— No Principal Appointed —';
          if (pMetaEl) pMetaEl.textContent = 'Click Appoint Principal to select an active faculty member.';
          if (pBadgeEl) {
            pBadgeEl.textContent = 'Unassigned';
            pBadgeEl.style.background = 'rgba(239,68,68,0.1)';
            pBadgeEl.style.color = '#ef4444';
          }
          if (pBtnEl) {
            pBtnEl.onclick = function () {
              openStaffPickerForPrincipal(null, null);
            };
          }
        }

        var sudoListEl = document.getElementById('inst-sudo-list');
        if (sudoListEl) {
          var suDos = inst.sudoAdmins || [];
          if (suDos.length === 0) {
            sudoListEl.innerHTML = '<span style="color:var(--tmu);">None registered</span>';
          } else {
            sudoListEl.innerHTML = suDos.map(function (s) {
              return '<div><strong>' + escapeHtml(s.fullName) + '</strong> (' + escapeHtml(s.employeeNo || 'Sudo') + ') · <span style="color:var(--tmu);">' + escapeHtml(s.department || 'Institution') + '</span></div>';
            }).join('');
          }
        }

        var superListEl = document.getElementById('inst-super-list');
        if (superListEl) {
          var supers = inst.superAdmins || [];
          if (supers.length === 0) {
            superListEl.innerHTML = '<span style="color:var(--tmu);">None assigned</span>';
          } else {
            superListEl.innerHTML = supers.map(function (s) {
              return '<div><strong>' + escapeHtml(s.name) + '</strong> · <span style="color:var(--tmu);">' + escapeHtml(s.trackId || '') + '</span></div>';
            }).join('');
          }
        }
      })
      .catch(function (err) {
        console.error('[loadInstitutionOverview institution error]:', err);
      });

    apiCall('/api/roles/history')
      .then(function (history) {
        var tbody = document.getElementById('inst-history-tbody');
        if (!tbody) return;

        if (!Array.isArray(history) || history.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:20px;color:var(--tmu);">No role assignment history found.</td></tr>';
          return;
        }

        tbody.innerHTML = history.slice(0, 25).map(function (h) {
          var dateStr = new Date(h.createdAt || h.from).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
          });
          var statusStr = h.active
            ? '<span class="badge" style="background:#dcfce7;color:#15803d;font-size:11px;">Active</span>'
            : '<span class="badge" style="background:#fee2e2;color:#b91c1c;font-size:11px;">Ended</span>';

          return '' +
            '<tr>' +
              '<td>' + dateStr + '</td>' +
              '<td><strong style="color:var(--td);">' + escapeHtml(h.role) + '</strong></td>' +
              '<td>' + escapeHtml(h.scopeType || 'dept') + '</td>' +
              '<td>' + escapeHtml(h.teacherName) + '</td>' +
              '<td>' + escapeHtml(h.assignedBy?.name || 'System') + '</td>' +
              '<td>' + statusStr + (h.endReason ? ' <span style="font-size:11px;color:var(--tmu);">(' + escapeHtml(h.endReason) + ')</span>' : '') + '</td>' +
            '</tr>';
        }).join('');
      })
      .catch(function (err) {
        console.error('[loadInstitutionOverview history error]:', err);
      });
  }

  // ── 6. SUB-ADMIN ACCESS REQUESTS & DELEGATED GRANTS (§10, R7) ────────────────
  var _activeApproveRequestId = null;

  function isHodUser(deptId) {
    var u = (typeof getUser === 'function' ? getUser() : null) || {};
    if (isSudoAdmin(u)) return true;
    var targetDept = deptId ? String(deptId) : '';
    if (u.isHod === true) {
      if (!targetDept) return true;
      return String(u.deptId || '') === targetDept;
    }
    if (Array.isArray(u.specials) && u.specials.some(function (s) { return s && s.option === 'isHod'; })) {
      if (!targetDept) return true;
      return String(u.deptId || '') === targetDept;
    }
    return false;
  }

  function toggleAllPageCheckboxes(checked) {
    document.querySelectorAll('.mdg-page-chk').forEach(function (chk) {
      chk.checked = Boolean(checked);
    });
  }

  function loadAccessRequests() {
    var container = document.getElementById('roles-requests-container');
    if (container) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tmu);"><div class="spin" style="margin:0 auto 10px;"></div>Loading access requests…</div>';
    }

    apiCall('/api/access-requests')
      .then(function (res) {
        var reqs = res.requests || [];
        _rolesState.allRequests = reqs;
        var pendingCount = reqs.filter(function (r) {
          return r.status === 'pending_hod' || r.status === 'pending_sudo' || r.status === 'pending';
        }).length;
        var badge = document.getElementById('badge-pending-requests');
        if (badge) {
          badge.textContent = pendingCount;
          badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
        }
        renderAccessRequests();
      })
      .catch(function (err) {
        console.error('[loadAccessRequests error]:', err);
        if (container) {
          container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tmu);">Failed to load access requests: ' + escapeHtml(err.message) + '</div>';
        }
      });
  }

  function filterAccessRequestsByStatus(status) {
    _rolesState.requestFilter = status || 'all';
    ['all', 'pending', 'pending_hod', 'pending_sudo', 'approved', 'denied'].forEach(function (s) {
      var chip = document.getElementById('req-chip-' + s);
      if (chip) chip.classList.toggle('act', s === _rolesState.requestFilter);
    });
    renderAccessRequests();
  }

  function renderAccessRequests() {
    var container = document.getElementById('roles-requests-container');
    if (!container) return;
    var list = _rolesState.allRequests || [];
    var filter = _rolesState.requestFilter || 'all';
    if (filter !== 'all') {
      list = list.filter(function (r) {
        if (filter === 'approved') return r.status === 'approved' || r.status === 'approved_with_changes';
        if (filter === 'denied') return r.status === 'denied' || r.status === 'denied_by_hod';
        if (filter === 'pending_hod') return r.status === 'pending_hod';
        if (filter === 'pending_sudo') return r.status === 'pending_sudo' || r.status === 'pending';
        if (filter === 'pending') return r.status === 'pending' || r.status === 'pending_hod' || r.status === 'pending_sudo';
        return r.status === filter;
      });
    }

    if (list.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tmu);font-size:13px;">No access requests found matching current filter.</div>';
      return;
    }

    var isSudo = isSudoAdmin();
    var userTrackId = sessionStorage.getItem('trackId') || '';

    container.innerHTML = '<div class="tw"><table class="tbl">' +
      '<thead><tr>' +
        '<th>ID</th>' +
        '<th>Faculty Member</th>' +
        '<th>Department</th>' +
        '<th>Modules & Rights</th>' +
        '<th>Duration & Expiry</th>' +
        '<th>Requested By</th>' +
        '<th>Workflow Status</th>' +
        '<th>Actions</th>' +
      '</tr></thead><tbody>' +
      list.map(function (req) {
        var statusBadge = '<span class="badge" style="background:#f1f5f9;color:#64748b;">' + escapeHtml(req.status) + '</span>';
        if (req.status === 'pending_hod') {
          statusBadge = '<span class="badge" style="background:#fef3c7;color:#b45309;font-weight:600;"><re-icon icon="clock" size="11"></re-icon> ⏳ Awaiting HOD</span>';
        } else if (req.status === 'pending_sudo') {
          var hodInfo = req.hodApproval?.decidedBy?.name ? '<div style="font-size:10px;font-weight:400;color:#4338ca;">HOD: ' + escapeHtml(req.hodApproval.decidedBy.name) + '</div>' : '';
          statusBadge = '<span class="badge" style="background:#e0e7ff;color:#4338ca;font-weight:600;"><re-icon icon="shield" size="11"></re-icon> ⏳ Awaiting Sudo</span>' + hodInfo;
        } else if (req.status === 'pending') {
          statusBadge = '<span class="badge" style="background:#fef3c7;color:#b45309;font-weight:600;">Pending Review</span>';
        } else if (req.status === 'approved') {
          statusBadge = '<span class="badge" style="background:#dcfce7;color:#15803d;font-weight:600;">✅ Approved & Active</span>';
        } else if (req.status === 'approved_with_changes') {
          statusBadge = '<span class="badge" style="background:#ccfbf1;color:#0f766e;font-weight:600;">✅ Approved (Adjusted)</span>';
        } else if (req.status === 'denied_by_hod') {
          statusBadge = '<span class="badge" style="background:#fee2e2;color:#b91c1c;font-weight:600;">❌ Denied by HOD</span>';
        } else if (req.status === 'denied') {
          statusBadge = '<span class="badge" style="background:#fee2e2;color:#b91c1c;font-weight:600;">❌ Denied by Sudo</span>';
        } else if (req.status === 'withdrawn') {
          statusBadge = '<span class="badge" style="background:#f3f4f6;color:#6b7280;">Withdrawn</span>';
        }

        var grantsStr = (req.grants || []).map(function (g) {
          var act = (g.actions || []).join(', ');
          return '<b>' + escapeHtml(g.page) + '</b> <span style="color:var(--tmu);font-size:11px;">(' + escapeHtml(act) + ')</span>';
        }).join('<br>');

        var datesStr = '';
        if (req.grants && req.grants[0]) {
          var g0 = req.grants[0];
          var toStr = g0.validTo ? new Date(g0.validTo).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Permanent';
          datesStr = 'Until ' + toStr;
        }

        var canHodAct = isSudo || isHodUser(req.deptId);
        var actionsHtml = '—';

        if (req.status === 'pending_hod') {
          if (canHodAct) {
            actionsHtml = '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
              '<button class="btn-xs btn-pri" onclick="hodApproveAccessRequest(\'' + req.requestId + '\')" title="Endorse as Department HOD"><re-icon icon="check" size="11"></re-icon> HOD Approve</button>' +
              '<button class="btn-xs btn-danger-out" onclick="hodDenyAccessRequest(\'' + req.requestId + '\')">Reject</button>' +
            '</div>';
          } else if (req.requestedBy && (req.requestedBy.trackId === userTrackId || req.forTeacherTrackId === userTrackId)) {
            actionsHtml = '<button class="btn-xs btn-danger-out" onclick="withdrawAccessRequest(\'' + req.requestId + '\')">Withdraw</button>';
          } else {
            actionsHtml = '<span style="font-size:11.5px;color:var(--tmu);">Awaiting HOD</span>';
          }
        } else if (req.status === 'pending_sudo' || req.status === 'pending') {
          if (isSudo) {
            actionsHtml = '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
              '<button class="btn-xs btn-pri" onclick="approveAccessRequest(\'' + req.requestId + '\')" title="Confirm and provision sub-admin privileges"><re-icon icon="check-check" size="11"></re-icon> Confirm (Sudo)</button>' +
              '<button class="btn-xs btn-out" onclick="openApproveWithChangesModal(\'' + req.requestId + '\')">Adjust</button>' +
              '<button class="btn-xs btn-danger-out" onclick="denyAccessRequest(\'' + req.requestId + '\')">Deny</button>' +
            '</div>';
          } else if (req.requestedBy && (req.requestedBy.trackId === userTrackId || req.forTeacherTrackId === userTrackId)) {
            actionsHtml = '<div style="display:flex;flex-direction:column;gap:3px;"><span style="font-size:11px;color:#4338ca;">Awaiting Sudo Confirmation</span><button class="btn-xs btn-danger-out" onclick="withdrawAccessRequest(\'' + req.requestId + '\')">Withdraw</button></div>';
          } else {
            actionsHtml = '<span style="font-size:11.5px;color:var(--tmu);">Awaiting Sudo Confirmation</span>';
          }
        } else if (req.decisionNote) {
          actionsHtml = '<span style="font-size:11px;color:var(--tmu);" title="' + escapeHtml(req.decisionNote) + '">Note: ' + escapeHtml(req.decisionNote.slice(0, 24)) + (req.decisionNote.length > 24 ? '…' : '') + '</span>';
        }

        var reasonTooltip = req.reason ? ' title="Reason: ' + escapeHtml(req.reason) + '"' : '';

        return '<tr>' +
          '<td style="font-weight:600;font-size:12px;">' + escapeHtml(req.requestId) + '</td>' +
          '<td><div style="font-weight:600;font-size:13px;"' + reasonTooltip + '>' + escapeHtml(req.forTeacherName || '—') + '</div>' +
            (req.reason ? '<div style="font-size:11px;color:var(--tmu);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(req.reason) + '</div>' : '') +
          '</td>' +
          '<td><span class="badge-dept">' + escapeHtml(req.deptName || '—') + '</span></td>' +
          '<td style="font-size:12px;">' + grantsStr + '</td>' +
          '<td style="font-size:12px;color:var(--tmu);">' + datesStr + '</td>' +
          '<td style="font-size:12px;">' + escapeHtml(req.requestedBy?.name || '—') + ' <span style="font-size:11px;color:var(--tmu);">(' + escapeHtml(req.requestedBy?.role || '') + ')</span></td>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + actionsHtml + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  async function hodApproveAccessRequest(requestId) {
    const ok = await showConfirm('Endorse sub-admin access request ' + requestId + ' as Department HOD and forward for Sudo Admin confirmation?', 'HOD Approval');
    if (!ok) return;
    apiCall('/api/access-requests/' + requestId + '/hod-approve', { method: 'POST' })
      .then(function (res) {
        showToast(res.message || 'Request endorsed by HOD. Waiting for Sudo confirmation.', 'success');
        loadAccessRequests();
      })
      .catch(function (err) {
        console.error('[hodApproveAccessRequest err]:', err);
        showToast('Failed to endorse request: ' + err.message, 'error');
      });
  }

  async function hodDenyAccessRequest(requestId) {
    var reason = await showPrompt('Enter reason for denying access request ' + requestId + ':', '', 'HOD Denial Reason');
    if (!reason || !reason.trim()) return;
    apiCall('/api/access-requests/' + requestId + '/hod-deny', {
      method: 'POST',
      body: { reason: reason.trim() }
    })
    .then(function (res) {
      showToast(res.message || 'Request denied by HOD', 'info');
      loadAccessRequests();
    })
    .catch(function (err) {
      console.error('[hodDenyAccessRequest err]:', err);
      showToast('Failed to deny request: ' + err.message, 'error');
    });
  }

  async function approveAccessRequest(requestId) {
    const ok = await showConfirm('Confirm and provision sub-admin access privileges for ' + requestId + '?', 'Sudo Admin Confirmation');
    if (!ok) return;
    apiCall('/api/access-requests/' + requestId + '/approve', { method: 'POST' })
      .then(function (res) {
        showToast(res.message || 'Access request confirmed and provisioned', 'success');
        loadAccessRequests();
        if (_rolesState.activeDeptId && typeof openManagePrivilegesDrawer === 'function') {
          openManagePrivilegesDrawer(_rolesState.activeDeptId);
        }
      })
      .catch(function (err) {
        console.error('[approve request err]:', err);
        showToast('Failed to approve request: ' + err.message, 'error');
      });
  }

  function openApproveWithChangesModal(requestId) {
    var req = (_rolesState.allRequests || []).find(function (r) { return r.requestId === requestId; });
    if (!req) return;
    _activeApproveRequestId = requestId;

    var g0 = req.grants && req.grants[0] ? req.grants[0] : {};
    var toInput = document.getElementById('mac-valid-to');
    if (toInput) {
      var toDate = g0.validTo ? new Date(g0.validTo) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      toInput.value = toDate.toISOString().slice(0, 16);
    }

    var actions = g0.actions || ['view'];
    ['create', 'edit', 'publish', 'export', 'delete'].forEach(function (act) {
      var chk = document.getElementById('mac-act-' + act);
      if (chk) chk.checked = actions.includes(act);
    });

    var noteInput = document.getElementById('mac-decision-note');
    if (noteInput) noteInput.value = '';

    var modal = document.getElementById('modal-approve-with-changes');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('open');
    }
  }

  function closeApproveChangesModal() {
    _activeApproveRequestId = null;
    var modal = document.getElementById('modal-approve-with-changes');
    if (modal) {
      modal.classList.remove('open');
      modal.style.display = 'none';
    }
  }

  function submitApproveWithChanges() {
    if (!_activeApproveRequestId) return;
    var toInput = document.getElementById('mac-valid-to');
    var noteInput = document.getElementById('mac-decision-note');
    if (!toInput || !toInput.value) {
      showToast('Please select an adjusted valid date', 'warning');
      return;
    }
    if (!noteInput || !noteInput.value.trim()) {
      showToast('Please enter a decision note explaining adjustments', 'warning');
      return;
    }

    var actions = ['view'];
    ['create', 'edit', 'publish', 'export', 'delete'].forEach(function (act) {
      var chk = document.getElementById('mac-act-' + act);
      if (chk && chk.checked) actions.push(act);
    });

    var req = (_rolesState.allRequests || []).find(function (r) { return r.requestId === _activeApproveRequestId; });
    var approvedGrants = (req && req.grants && req.grants.length > 0)
      ? req.grants.map(function (g) {
          return {
            page: g.page,
            scope: g.scope || 'department',
            deptId: g.deptId || req.deptId,
            actions: actions,
            validFrom: new Date(),
            validTo: new Date(toInput.value),
            enabled: true
          };
        })
      : [{
          page: 'manage',
          scope: 'department',
          deptId: req ? req.deptId : null,
          actions: actions,
          validFrom: new Date(),
          validTo: new Date(toInput.value),
          enabled: true
        }];

    apiCall('/api/access-requests/' + _activeApproveRequestId + '/approve-with-changes', {
      method: 'POST',
      body: {
        approvedGrants: approvedGrants,
        decisionNote: noteInput.value.trim()
      }
    })
    .then(function (res) {
      showToast(res.message || 'Approved with modifications', 'success');
      closeApproveChangesModal();
      loadAccessRequests();
      if (_rolesState.activeDeptId && typeof openManagePrivilegesDrawer === 'function') {
        openManagePrivilegesDrawer(_rolesState.activeDeptId);
      }
    })
    .catch(function (err) {
      console.error('[approve with changes err]:', err);
      showToast('Failed: ' + err.message, 'error');
    });
  }

  async function denyAccessRequest(requestId) {
    var reason = await showPrompt('Enter business reason for denying access request ' + requestId + ':', '', 'Deny Access Request');
    if (!reason || !reason.trim()) return;

    apiCall('/api/access-requests/' + requestId + '/deny', {
      method: 'POST',
      body: { reason: reason.trim() }
    })
    .then(function (res) {
      showToast(res.message || 'Access request denied', 'info');
      loadAccessRequests();
    })
    .catch(function (err) {
      console.error('[deny request err]:', err);
      showToast('Failed to deny: ' + err.message, 'error');
    });
  }

  async function withdrawAccessRequest(requestId) {
    const ok = await showConfirm('Withdraw access request ' + requestId + '?', 'Withdraw Request');
    if (!ok) return;

    apiCall('/api/access-requests/' + requestId + '/withdraw', { method: 'POST' })
      .then(function (res) {
        showToast(res.message || 'Request withdrawn', 'info');
        loadAccessRequests();
      })
      .catch(function (err) {
        console.error('[withdraw request err]:', err);
        showToast('Failed to withdraw: ' + err.message, 'error');
      });
  }

  // ── 7. DIRECT DELEGATION MODAL (§10, R7.2, R7.3) ────────────────────────────
  function openGrantModal(targetTeacherId) {
    var isSudo = isSudoAdmin();
    var modal = document.getElementById('modal-delegate-grant');
    if (!modal) return;

    var titleEl = document.getElementById('mdg-title');
    var submitTxt = document.getElementById('mdg-submit-txt');
    var instOpt = document.getElementById('mdg-opt-inst');
    var teacherSel = document.getElementById('mdg-teacher-select');

    if (titleEl) {
      titleEl.innerHTML = '<re-icon icon="shield" size="16" style="color:var(--pri);"></re-icon> Delegate Sub-Admin Privileges (Temporary Role)';
    }
    if (submitTxt) {
      submitTxt.textContent = 'Submit Temporary Role Delegation';
    }
    if (instOpt) {
      instOpt.disabled = !isSudo;
      if (!isSudo) {
        var scopeSel = document.getElementById('mdg-scope-select');
        if (scopeSel) scopeSel.value = 'department';
      }
    }

    // Populate faculty dropdown from active department or institution-wide staff
    if (teacherSel) {
      teacherSel.innerHTML = '<option value="">Loading faculty members…</option>';
      if (typeof SearchableDropdown !== 'undefined') {
        if (!SearchableDropdown.get(teacherSel)) {
          SearchableDropdown.attach(teacherSel, {
            kind: 'teacher',
            placeholder: 'Select faculty member…',
            searchPlaceholder: 'Search faculty by name, ID, or dept…',
            search: true,
            showIcon: true,
            display: 'block'
          });
        } else {
          SearchableDropdown.sync(teacherSel);
        }
      }

      var deptUrl = _rolesState.activeDeptId
        ? '/api/roles/departments/' + _rolesState.activeDeptId + '/staff?role=ttCoordinator'
        : '/api/roles/staff';

      apiCall(deptUrl)
        .then(function (res) {
          var staff = Array.isArray(res) ? res : (res.staff || []);
          if (staff.length === 0) {
            teacherSel.innerHTML = '<option value="">No faculty members available</option>';
            if (typeof SearchableDropdown !== 'undefined') {
              SearchableDropdown.sync(teacherSel);
            }
            return;
          }
          teacherSel.innerHTML = '<option value="">Select faculty member…</option>' +
            staff.map(function (s) {
              var selected = targetTeacherId && String(s._id) === String(targetTeacherId) ? ' selected' : '';
              var deptTag = s.department ? ' · ' + escapeHtml(s.department) : '';
              var subTag = s.employeeNo || s.designation || 'Faculty';
              var badgeText = s.deptCode || s.department || '';
              return '<option value="' + s._id + '"' + selected +
                ' data-name="' + escapeHtml(s.fullName) + '"' +
                ' data-badge="' + escapeHtml(badgeText) + '"' +
                ' data-sub="' + escapeHtml(s.employeeNo || '') + '"' +
                '>' + escapeHtml(s.fullName) + ' (' + escapeHtml(subTag) + deptTag + ')</option>';
            }).join('');

          if (typeof SearchableDropdown !== 'undefined') {
            if (!SearchableDropdown.get(teacherSel)) {
              SearchableDropdown.attach(teacherSel, {
                kind: 'teacher',
                placeholder: 'Select faculty member…',
                searchPlaceholder: 'Search faculty by name, ID, or dept…',
                search: true,
                showIcon: true,
                display: 'block'
              });
            } else {
              SearchableDropdown.sync(teacherSel);
            }
          }
        })
        .catch(function () {
          teacherSel.innerHTML = '<option value="">Failed to load staff list</option>';
          if (typeof SearchableDropdown !== 'undefined') {
            SearchableDropdown.sync(teacherSel);
          }
        });
    }

    // Preset 7 days by default
    setGrantDurationPreset(7);

    modal.style.display = 'flex';
    modal.classList.add('open');
  }

  function closeGrantModal() {
    var modal = document.getElementById('modal-delegate-grant');
    if (modal) {
      modal.classList.remove('open');
      modal.style.display = 'none';
      if (typeof SearchableDropdown !== 'undefined') {
        SearchableDropdown.closeAll();
      }
    }
  }

  function setGrantDurationPreset(days) {
    var toInput = document.getElementById('mdg-valid-to');
    if (!toInput) return;
    var toDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    toInput.value = toDate.toISOString().slice(0, 16);
  }

  function submitGrantOrRequest(e) {
    if (e) e.preventDefault();
    var isSudo = isSudoAdmin();
    var teacherId = document.getElementById('mdg-teacher-select')?.value;
    var scope = document.getElementById('mdg-scope-select')?.value || 'department';
    var validTo = document.getElementById('mdg-valid-to')?.value;
    var reason = document.getElementById('mdg-reason')?.value;

    // Collect checked pages
    var selectedPages = [];
    document.querySelectorAll('.mdg-page-chk:checked').forEach(function (chk) {
      if (chk.value) selectedPages.push(chk.value);
    });
    if (selectedPages.length === 0) {
      var singleSel = document.getElementById('mdg-page-select')?.value;
      if (singleSel) selectedPages.push(singleSel);
    }

    if (!teacherId || selectedPages.length === 0 || !validTo || !reason) {
      showToast('Please fill all required fields and select at least one page.', 'warning');
      return;
    }

    var actions = ['view'];
    ['create', 'edit', 'publish', 'export', 'delete'].forEach(function (act) {
      var chk = document.getElementById('mdg-act-' + act);
      if (chk && chk.checked) actions.push(act);
    });

    var submitBtn = document.getElementById('mdg-submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    // Both Super Admin and Sudo Admin create sub-admin access requests
    apiCall('/api/access-requests', {
      method: 'POST',
      body: {
        forTeacherId: teacherId,
        pages: selectedPages,
        page: selectedPages[0],
        scope: isSudo ? scope : 'department',
        actions: actions,
        validFrom: new Date(),
        validTo: new Date(validTo),
        reason: reason
      }
    })
    .then(function (res) {
      showToast(res.message || 'Temporary sub-admin role requested successfully', 'success');
      closeGrantModal();
      loadAccessRequests();
      if (_rolesState.activeDeptId && typeof openManagePrivilegesDrawer === 'function') {
        openManagePrivilegesDrawer(_rolesState.activeDeptId);
      }
    })
    .catch(function (err) {
      console.error('[submitGrantOrRequest err]:', err);
      showToast('Failed to submit temporary role: ' + err.message, 'error');
    })
    .finally(function () {
      if (submitBtn) submitBtn.disabled = false;
    });
  }

  // Expose global controller functions
  window.loadExecutiveRolesOverview = loadExecutiveRolesOverview;
  window.loadAccessRequests = loadAccessRequests;
  window.filterAccessRequestsByStatus = filterAccessRequestsByStatus;
  window.approveAccessRequest = approveAccessRequest;
  window.hodApproveAccessRequest = hodApproveAccessRequest;
  window.hodDenyAccessRequest = hodDenyAccessRequest;
  window.toggleAllPageCheckboxes = toggleAllPageCheckboxes;
  window.openApproveWithChangesModal = openApproveWithChangesModal;
  window.closeApproveChangesModal = closeApproveChangesModal;
  window.submitApproveWithChanges = submitApproveWithChanges;
  window.denyAccessRequest = denyAccessRequest;
  window.withdrawAccessRequest = withdrawAccessRequest;
  window.openGrantModal = openGrantModal;
  window.closeGrantModal = closeGrantModal;
  window.setGrantDurationPreset = setGrantDurationPreset;
  window.submitGrantOrRequest = submitGrantOrRequest;
  window.renderDepartmentCards = renderDepartmentCards;
  window.filterExecutiveCards = filterExecutiveCards;
  window.setExecutiveFilter = setExecutiveFilter;
  window.switchExecutiveTab = switchExecutiveTab;
  window.openManagePrivilegesDrawer = openManagePrivilegesDrawer;
  window.closeManagePrivilegesDrawer = closeManagePrivilegesDrawer;
  window.openManageAdvisorsDrawer = openManageAdvisorsDrawer;
  window.closeManageAdvisorsDrawer = closeManageAdvisorsDrawer;
  window.openStaffPickerForRole = openStaffPickerForRole;
  window.openStaffPickerForClassAdvisor = openStaffPickerForClassAdvisor;
  window.openStaffPickerForSecondaryClassAdvisor = openStaffPickerForSecondaryClassAdvisor;
  window.openStaffPickerForSecondaryClassAdvisor = openStaffPickerForSecondaryClassAdvisor;
  window.openStaffPickerForPrincipal = openStaffPickerForPrincipal;
  window.openAssignPrincipalModal = openStaffPickerForPrincipal;
  window.selectStaffForRole = selectStaffForRole;
  window.closeStaffPicker = closeStaffPicker;
  window.filterStaffPickerList = filterStaffPickerList;
  window.removeDepartmentRole = removeDepartmentRole;
  window.removeClassAdvisor = removeClassAdvisor;
  window.removeSecondaryClassAdvisor = removeSecondaryClassAdvisor;
  window.removeSecondaryClassAdvisor = removeSecondaryClassAdvisor;
  window.revokeStaffGrant = revokeStaffGrant;
  window.toggleSuperAdminBulk = toggleSuperAdminBulk;
  window.loadWardensOverview = loadWardensOverview;
  window.openWardenPicker = openWardenPicker;
  window.removeWarden = removeWarden;
  window.loadInstitutionOverview = loadInstitutionOverview;
  window.updateExecutiveRolesTabVisibility = updateExecutiveRolesTabVisibility;

  // Auto-run tab visibility check when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateExecutiveRolesTabVisibility);
  } else {
    updateExecutiveRolesTabVisibility();
  }

  // Keyboard Escape navigation: dismiss topmost open layer in reverse stacking order
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;

    // 1. If global alert/confirm popup is open, popup.js handles it
    var popupBg = document.getElementById('eams-popup-window-bg');
    if (popupBg && popupBg.classList.contains('open')) return;

    // 2. If Faculty Staff Picker modal is open, dismiss it first
    var pickerModal = document.getElementById('modal-role-staff-picker');
    if (pickerModal && pickerModal.classList.contains('open')) {
      e.preventDefault();
      closeStaffPicker();
      return;
    }

    // 3. If Sub-Admin Delegate Grant modal is open, dismiss it
    var grantModal = document.getElementById('modal-delegate-grant');
    if (grantModal && grantModal.classList.contains('open')) {
      e.preventDefault();
      closeGrantModal();
      return;
    }

    // 4. If Approve with Changes modal is open, dismiss it
    var appModal = document.getElementById('modal-approve-with-changes');
    if (appModal && appModal.classList.contains('open')) {
      e.preventDefault();
      closeApproveChangesModal();
      return;
    }

    // 5. If Privileges window popup is open, dismiss it
    var privWindow = document.getElementById('drawer-manage-privileges');
    if (privWindow && privWindow.classList.contains('open')) {
      e.preventDefault();
      closeManagePrivilegesDrawer();
      return;
    }

    // 6. If Advisors drawer is open, dismiss it
    var advDrawer = document.getElementById('drawer-manage-advisors');
    if (advDrawer && advDrawer.classList.contains('open')) {
      e.preventDefault();
      closeManageAdvisorsDrawer();
      return;
    }
  });

  // Modal naming aliases for forward compatibility
  window.openManagePrivilegesModal = openManagePrivilegesDrawer;
  window.closeManagePrivilegesModal = closeManagePrivilegesDrawer;

})(window, document);