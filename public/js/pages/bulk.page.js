function toggleBulkSidebar() {
  var sidebar = document.querySelector('#app-shell .sb');
  var mainContent = document.querySelector('.mc');
  var toggleButton = document.getElementById('sbtoggle');
  var overlay = document.getElementById('sb-overlay');
  var isMobile = window.innerWidth <= 768;

  if (isMobile) {
    var isOpen = sidebar.classList.toggle('sb-mobile-open');
    if (overlay) overlay.classList.toggle('visible', isOpen);
    toggleButton.innerHTML = isOpen ? '✖' : '☰';
  } else {
    var isHidden = sidebar.classList.toggle('sb-hidden');
    mainContent.classList.toggle('sb-expanded', isHidden);
    toggleButton.classList.toggle('closed', isHidden);
    toggleButton.innerHTML = isHidden ? '☰' : '✖';
  }
}

function goBack() {
  if (currentUser && currentUser.role === 'teacher') {
    window.location.href = "selector.html";
  } else {
    window.location.href = "admin.html";
  }
}

// In-memory cache of real backend data
// Populated from the API on load and kept in sync as rows are uploaded, so
// duplicate/conflict checks run against what's actually in MongoDB instead
// of a disconnected local copy.
var _cache = { depts: [], classes: [], subjects: [], batches: [] };
var _cacheReady = null;

async function loadCache() {
  return Promise.all([
    apiCall('GET', '/depts').catch(function () { return []; }),
    apiCall('GET', '/classes').catch(function () { return []; }),
    apiCall('GET', '/subjects').catch(function () { return []; }),
    apiCall('GET', '/year/batches').catch(function () { return []; })
  ]).then(function (res) {
    _cache.depts    = Array.isArray(res[0]) ? res[0] : [];
    _cache.classes  = Array.isArray(res[1]) ? res[1] : [];
    _cache.subjects = Array.isArray(res[2]) ? res[2] : [];
    _cache.batches  = Array.isArray(res[3]) ? res[3] : [];
  });
}

// WIZARD_STEPS intentionally lists only the 5 real data-upload steps (not
// the "Start" screen itself) — the intro text says "Follow all 5 steps",
// and completion is judged against this list, so a 6th unreachable entry
// here would mean the "Setup Complete" screen could never appear.
var WIZARD_STEPS = [
  { key: 'dept',    icon: '🏛️',  label: 'Departments', tab: 'dept'    },
  { key: 'teacher', icon: '👩‍🏫', label: 'Teachers',    tab: 'teacher' },
  { key: 'class',   icon: '🏫',  label: 'Classes',     tab: 'class'   },
  { key: 'subject', icon: '📚',  label: 'Subjects',    tab: 'subject' },
  { key: 'student', icon: '👨‍🎓', label: 'Students',    tab: 'student' },
];
var _wizDone = {}, _wizActive = '';

function initWizard() {
  var nameEl = document.getElementById('sb-name');
  var avEl   = document.getElementById('sb-av');
  if (nameEl) nameEl.textContent = currentUser.name || 'Administrator';
  if (avEl)   avEl.textContent   = (currentUser.name || 'A').charAt(0).toUpperCase();

  // Show a real tab immediately so the page is never blank while the
  // network request below is in flight.
  var deptBtn = document.getElementById('wz-tab-dept');
  if (deptBtn) bulkTab(deptBtn, 'dept');

  _cacheReady.then(function () {
    var isEmpty     = _cache.depts.length === 0 && _cache.classes.length === 0;
    var isDeptEmpty = _cache.depts.length === 0;
    document.getElementById('wizard-banner').style.display = isEmpty ? 'block' : 'none';
    document.getElementById('wizard-badge').style.display  = isEmpty ? 'inline-flex' : 'none';
    if (isEmpty) renderWizSteps();

    var wizTab = document.getElementById('wz-tab-wizard');
    if (wizTab) wizTab.style.display = isDeptEmpty ? '' : 'none';

    if (isDeptEmpty) {
      var wizBtn = document.getElementById('wz-tab-wizard');
      if (wizBtn) bulkTab(wizBtn, 'wizard');
    }
  }).catch(function () {
    showToast('Could not load current setup status — you can still upload files.', 'warn');
  });
}

function dismissWizard() {
  document.getElementById('wizard-banner').style.display = 'none';
  document.getElementById('wizard-badge').style.display  = 'none';
}

function renderWizSteps() {
  var row = document.getElementById('wiz-steps-row');
  if (!row) return;
  row.innerHTML = WIZARD_STEPS.map(function (s, i) {
    var done   = !!_wizDone[s.key];
    var active = _wizActive === s.key;
    var cls    = 'wiz-pill' + (done ? ' done' : '') + (active ? ' active' : '');
    return '<div class="' + cls + '" onclick="wizGoTo(\'' + s.tab + '\')" id="wiz-step-' + s.key + '">'
      + '<div class="wiz-pill-num">' + (done ? '✓' : (i + 1)) + '</div>'
      + '<span style="font-size:16px;">' + s.icon + '</span>'
      + '<span>' + s.label + '</span>'
      + (done ? '<span style="font-size:10px;color:#4ade80;">✅</span>' : '')
      + '</div>';
  }).join('');
  var done  = Object.keys(_wizDone).length;
  var total = WIZARD_STEPS.length;
  var pct   = Math.round(done / total * 100);
  document.getElementById('wiz-bar-fill').style.width = pct + '%';
  document.getElementById('wiz-bar-lbl').textContent  = 'Step ' + done + ' of ' + total + ' complete (' + pct + '%)';
}

function wizGoTo(tab) {
  var btn = document.getElementById('wz-tab-' + tab);
  if (btn) bulkTab(btn, tab);
}

function wizMarkDone(key) {
  _wizDone[key] = true;
  var t = document.getElementById('wz-tab-' + key);
  if (t) t.classList.add('tab-done');
  renderWizSteps();
  if (WIZARD_STEPS.every(function (s) { return _wizDone[s.key]; })) {
    showWizComplete();
    return;
  }
  var idx = WIZARD_STEPS.findIndex(function (s) { return s.key === key; });
  if (idx >= 0 && idx < WIZARD_STEPS.length - 1) {
    var next = WIZARD_STEPS[idx + 1];
    showNextStepPopup(WIZARD_STEPS[idx], next);
  }
}

var _nspTimeout = null;
function showNextStepPopup(current, next) {
  clearTimeout(_nspTimeout);
  document.getElementById('nsp-icon').textContent = next.icon || '➡️';
  document.getElementById('nsp-top').textContent = '✅ ' + current.label + ' complete!';
  document.getElementById('nsp-sub').textContent =
    'All data saved. Proceed to upload ' + next.label + '?';
  var goBtn = document.getElementById('nsp-go-btn');
  goBtn.textContent = 'Upload ' + next.label + ' →';
  goBtn.onclick = function () { closeNextStepPopup(); wizGoTo(next.tab); };
  document.getElementById('next-step-popup').classList.add('show');
  _nspTimeout = setTimeout(closeNextStepPopup, 10000);
}

function closeNextStepPopup() {
  clearTimeout(_nspTimeout);
  document.getElementById('next-step-popup').classList.remove('show');
}

function showWizComplete() {
  var b = document.getElementById('wizard-banner');
  if (!b) return;
  var dashLink = (currentUser && currentUser.role === 'teacher') ? 'selector.html' : 'admin.html';
  var dashLabel = (currentUser && currentUser.role === 'teacher') ? 'Go to Admin Hub →' : 'Go to Dashboard →';
  b.innerHTML = '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">'
    + '<div style="font-size:44px;">🎉</div>'
    + '<div style="flex:1;"><div style="font-size:17px;font-weight:800;margin-bottom:4px;">Setup Complete!</div>'
    + '<div style="font-size:12.5px;opacity:.85;">All institution data imported. Your EAMS is ready.</div></div>'
    + '<a href="' + dashLink + '" style="padding:10px 22px;border-radius:22px;border:1.5px solid rgba(255,255,255,.4);background:rgba(255,255,255,.15);color:#fff;font-size:13px;font-weight:700;text-decoration:none;white-space:nowrap;">' + dashLabel + '</a>'
    + '</div>';
}

function bulkTab(btn, tab) {
  if (window.history && window.history.replaceState) {
    var url = new URL(window.location);
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url);
  }
  document.querySelectorAll('.sb-item.bulk-tab').forEach(function (b) { b.classList.remove('act'); });
  if (btn) btn.classList.add('act');
  document.querySelectorAll('.bulk-panel').forEach(function (p) { p.style.display = 'none'; });
  var p = document.getElementById('bulk-' + tab);
  if (p) p.style.display = 'block';
  if (tab === 'wizard') {
    document.getElementById('wizard-banner').style.display = 'block';
  }
  _wizActive = tab;
  renderWizSteps();
}

var _confCb = null, _confChoice = null;

function showConflictDialog(existing, incoming, keyLabel, cb) {
  _confCb = cb;
  document.getElementById('conflict-apply-all').checked = false;
  document.getElementById('conflict-msg').innerHTML = '<b>' + esc(keyLabel) + '</b> already exists in the database with differences.';
  var fields = Object.keys(incoming).filter(function (k) { return k !== '_id' && k !== 'createdAt'; });
  document.getElementById('conflict-db-data').innerHTML = fields.map(function (k) {
    return '<div class="frow"><span class="fkey">' + k + '</span><span class="fval">' + esc(existing[k] !== undefined ? existing[k] : '—') + '</span></div>';
  }).join('');
  document.getElementById('conflict-upload-data').innerHTML = fields.map(function (k) {
    var diff = String(existing[k] || '') !== String(incoming[k] || '');
    return '<div class="frow"><span class="fkey">' + k + (diff ? '<span class="chg-badge">changed</span>' : '') + '</span>'
      + '<span class="fval' + (diff ? ' diff' : '') + '">' + esc(incoming[k] !== undefined ? incoming[k] : '—') + '</span></div>';
  }).join('');
  var diffs   = fields.filter(function (k) { return String(existing[k] || '') !== String(incoming[k] || ''); });
  var diffEl  = document.getElementById('conflict-diff-list');
  diffEl.style.display = diffs.length ? 'block' : 'none';
  diffEl.innerHTML     = diffs.length
    ? '⚡ <b>' + diffs.length + '</b> field' + (diffs.length > 1 ? 's' : '') + ' differ: ' + diffs.join(', ')
    : '';
  document.getElementById('conflict-compare-wrap').style.display = 'grid';
  document.getElementById('bulk-conflict-overlay').classList.add('open');
}

// Resolves whichever Promise is waiting on the dialog (see decideConflict).
// "cancel" now still invokes the callback (with 'cancel') instead of
// silently orphaning it — otherwise an async upload loop awaiting the
// decision would hang forever with no final summary shown.
function resolveConflict(choice) {
  document.getElementById('bulk-conflict-overlay').classList.remove('open');
  if (choice === 'cancel') {
    _confChoice = null;
    showToast('Upload cancelled', 'warn');
  } else if (document.getElementById('conflict-apply-all').checked) {
    _confChoice = choice;
  }
  if (_confCb) { var cb = _confCb; _confCb = null; cb(choice); }
}

function checkConflict(existing, incoming, keyLabel, onDecide) {
  var fields = Object.keys(incoming).filter(function (k) { return k !== '_id'; });
  if (fields.every(function (k) { return String(existing[k] || '') === String(incoming[k] || ''); })) {
    onDecide('skip');
    return;
  }
  if (_confChoice) { onDecide(_confChoice); return; }
  showConflictDialog(existing, incoming, keyLabel, onDecide);
}

// Promise wrapper around the callback-based conflict dialog so upload
// loops can simply `await` a user's decision.
function decideConflict(existing, incoming, keyLabel) {
  return new Promise(function (resolve) {
    checkConflict(existing, incoming, keyLabel, resolve);
  });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showUploadPreview(elId, added, skipped, errors) {
  var el = document.getElementById(elId);
  if (!el) return;
  errors = errors || [];
  var errHtml = errors.slice(0, 8).map(function (e) {
    return '<div class="up-err-row">Row <b>' + e.row + '</b> <span style="color:var(--tmu);">' + esc(e.name || '') + '</span> — <span class="issue">' + e.issues.join('; ') + '</span></div>';
  }).join('');
  var more = errors.length > 8
    ? '<div style="font-size:11px;color:var(--tdi);padding:4px 0;">…and ' + (errors.length - 8) + ' more skipped</div>'
    : '';
  el.innerHTML = '<div class="up-result">'
    + '<div class="up-stat-row">'
    + '<div class="up-stat"><span class="v">' + added + '</span><span class="l">Added</span></div>'
    + '<div class="up-stat"><span class="v" style="color:var(--amber);">' + skipped + '</span><span class="l">Skipped</span></div>'
    + '<div class="up-stat"><span class="v" style="color:var(--blue);">' + (added + skipped) + '</span><span class="l">Total</span></div>'
    + '</div>'
    + (errHtml ? '<div class="up-errors">' + errHtml + more + '</div>' : '')
    + '</div>';
}

function dlTemplate(type) {
  var T = {
    dept:    [['DeptName', 'Code', 'Icon'],                                                                       ['Computer Science Engineering', 'CSE', '💻']],
    teacher: [['Name', 'EmployeeID', 'Department', 'Designation', 'Username', 'Password'],                        ['John Doe', 'EMP001', 'CSE', 'Assistant Professor', 'johndoe', 'teacher123']],
    class:   [['Department', 'HallNo', 'Year', 'Semester', 'Section', 'Batch'],                                   ['CSE', 'LH01', 'I Year', 'I', 'A', '2025-29']],
    subject: [['Name', 'Code', 'Department', 'Credits', 'Type'],                                                  ['Data Structures', 'CS201', 'CSE', '4', 'Theory']],
    student: [['FullName', 'RegisterNo', 'AcademicYear', 'CourseType', 'Branch', 'Department', 'Year', 'Class', 'Section', 'Email', 'Username', 'Password'], ['Student User', '2025104001', '2025-26', 'UG', 'B.E', 'Computer Science Engineering', 'I Year', 'CSE-I-A', 'A', 'student@institution.edu', 'student25', 'Student@123']],
  };
  var data = T[type] || [['No template']];
  var ws = XLSX.utils.aoa_to_sheet(data), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, type);
  XLSX.writeFile(wb, 'EAMS_' + type + '_template.xlsx');
}

// Which real API endpoint backs each "Exported" download button.
var EXPORT_ENDPOINTS = { depts: '/depts', teacher: '/teachers', classes: '/classes', subjects: '/subjects', students: '/students' };

// GET /api/students is paginated (60 per page by default) — a plain single
// fetch would silently truncate the export for any dataset over one page,
// so walk every page until the server says there's no more.
function fetchAllStudents(page, acc) {
  page = page || 1; acc = acc || [];
  return apiCall('GET', '/students?limit=500&page=' + page).then(function (data) {
    var rows = (data && Array.isArray(data.data)) ? data.data : [];
    acc = acc.concat(rows);
    if (data && data.hasMore) return fetchAllStudents(page + 1, acc);
    return acc;
  });
}

function dlUploaded(type) {
  var endpoint = EXPORT_ENDPOINTS[type];
  if (!endpoint) { showToast('Unknown export type', 'warn'); return; }
  var fetcher = type === 'students'
    ? fetchAllStudents()
    : apiCall('GET', endpoint).then(function (d) { return Array.isArray(d) ? d : []; });

  fetcher.then(function (rows) {
    if (!rows.length) { showToast('No data to download', 'warn'); return; }
    var clean = rows.map(function (r) {
      var c = Object.assign({}, r);
      delete c.password; delete c._id; delete c.__v; delete c.trackId;
      return c;
    });
    var ws = XLSX.utils.json_to_sheet(clean), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, type);
    XLSX.writeFile(wb, 'EAMS_' + type + '_export.xlsx');
  }).catch(function (err) {
    showToast('Could not fetch data: ' + err.message, 'warn');
  });
}

function hd(event, type) {
  event.preventDefault();
  event.currentTarget.classList.remove('dg');
  var f = event.dataTransfer.files[0];
  if (f) processFile(f, type);
}

function hu(input, type) {
  var f = input.files[0];
  if (f) processFile(f, type);
  input.value = '';
}

function processFile(file, type) {
  _confChoice = null;

  // Students go straight to the server: the real bulk-upload endpoint
  // parses the spreadsheet itself (ExcelJS) and validates row-by-row in
  // MongoDB, so there's no client-side parsing step for this type.
  if (type === 'students') { uploadStudentFile(file); return; }

  var reader = new FileReader();
  reader.onload = function (e) {
    var rows;
    try {
      var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    } catch (err) {
      showToast('Error reading file: ' + err.message, 'warn');
      return;
    }
    // Wait for the initial dept/class/subject/batch fetch so duplicate and
    // batch checks run against real data even if a file is dropped the
    // instant the page loads.
    _cacheReady.then(function () {
      if (type === 'dept')     return parseDeptRows(rows);
      if (type === 'struct')   return parseStructureRows(rows);
      if (type === 'subjects') return parseSubjectRows(rows);
      if (type === 'teachers') return parseTeacherRows(rows);
    });
  };
  reader.readAsArrayBuffer(file);
}

function uploadStudentFile(file) {
  var tok = sessionStorage.getItem('eams_token');
  var fd = new FormData();
  fd.append('file', file);
  showToast('Uploading students…');
  fetch('/api/students/bulk-upload', {
    method: 'POST',
    headers: { 'Authorization': tok ? 'Bearer ' + tok : '' },
    body: fd
  }).then(function (r) {
    if (r.status === 401) { doLogout(); throw new Error('Authentication failed'); }
    return r.json();
  }).then(function (data) {
    if (data && data.error) { showToast(data.error, 'warn'); return; }
    showUploadPreview('tup', data.added, data.skipped, data.errors);
    showToast('Students: ' + data.added + ' added' + (data.skipped ? ', ' + data.skipped + ' skipped' : ''));
    if (data.added > 0) wizMarkDone('student');
  }).catch(function (err) {
    showToast('Upload failed: ' + err.message, 'warn');
  });
}

function nk(k) { return k.toString().toLowerCase().replace(/[^a-z]/g, ''); }
function cv(row, aliases) {
  var keys = Object.keys(row);
  for (var i = 0; i < aliases.length; i++) {
    var m = keys.find(function (k) { return nk(k).includes(nk(aliases[i])); });
    if (m) return String(row[m]).trim();
  }
  return '';
}

async function parseDeptRows(rows) {
  var added = 0, skipped = 0, cancelled = false;

  for (var i = 0; i < rows.length; i++) {
    var row  = rows[i];
    var name = cv(row, ['deptname', 'name', 'dept']);
    var code = cv(row, ['code', 'deptcode']);

    if (!name || !code) { skipped++; continue; }
    code = code.toUpperCase();

    var existing = _cache.depts.find(function (d) {
      return d.code.toUpperCase() === code || d.name.toLowerCase() === name.toLowerCase();
    });

    if (existing) {
      var choice = await decideConflict(existing, { name: name, code: code }, 'Dept: ' + name);
      if (choice === 'cancel') { cancelled = true; break; }
      if (choice === 'replace') {
        try {
          var updated = await apiCall('PUT', '/depts/' + existing._id, { name: name, code: code });
          Object.assign(existing, updated);
          added++;
        } catch (e) { skipped++; }
      } else {
        skipped++;
      }
    } else {
      try {
        var created = await apiCall('POST', '/depts', { name: name, code: code });
        _cache.depts.push(created);
        added++;
      } catch (e) { skipped++; }
    }
  }

  showUploadPreview('dept-up', added, skipped);
  showToast('Departments: ' + added + ' added, ' + skipped + ' skipped' + (cancelled ? ' — upload cancelled' : ''));
  if (added > 0) wizMarkDone('dept');
}

async function parseStructureRows(rows) {
  var added = 0, skipped = 0, errors = [];

  // Class documents require a `batch` — this comes from the active
  // Academic Year's batch list, not from anything the wizard itself sets
  // up, so bail out with one clear message rather than a wall of
  // per-row "batch not recognised" errors.
  if (!_cache.batches.length) {
    showUploadPreview('sup', 0, 0, [{ row: '-', name: '', issues: ['No active batches found — set up the current Academic Year first (Admin → Settings), then re-upload.'] }]);
    showToast('Classes: no active academic-year batches found', 'warn');
    return;
  }

  for (var i = 0; i < rows.length; i++) {
    var row  = rows[i], rn = i + 2;
    var dn   = cv(row, ['dept', 'department']);
    var dc   = cv(row, ['code', 'deptcode']);
    var sem  = cv(row, ['sem', 'semester']);
    var sec  = cv(row, ['sec', 'section']);
    var yr   = cv(row, ['year']) || 'I Year';
    var hall = cv(row, ['hall', 'hallno']);
    var batchVal = cv(row, ['batch']);

    var rowErrors = [];
    if (!dn)   rowErrors.push('Department missing');
    if (!hall) rowErrors.push('HallNo missing');
    if (!sec)  rowErrors.push('Section missing');
    var matchedBatch = _cache.batches.find(function (b) { return b.toLowerCase() === batchVal.toLowerCase(); });
    if (!batchVal) rowErrors.push('Batch missing');
    else if (!matchedBatch) rowErrors.push('Batch "' + batchVal + '" not active (active: ' + _cache.batches.join(', ') + ')');

    if (rowErrors.length) {
      skipped++;
      errors.push({ row: rn, name: dn || '(blank)', issues: rowErrors });
      continue;
    }

    var dept = _cache.depts.find(function (d) {
      return d.name.toLowerCase() === dn.toLowerCase() || d.code.toLowerCase() === dn.toLowerCase() || (dc && d.code.toLowerCase() === dc.toLowerCase());
    });
    if (!dept) {
      try {
        dept = await apiCall('POST', '/depts', { name: dn, code: dc || dn.slice(0, 4).toUpperCase() });
        _cache.depts.push(dept);
      } catch (e) {
        skipped++;
        errors.push({ row: rn, name: dn, issues: ['Could not create department: ' + e.message] });
        continue;
      }
    }

    var className = dept.code + '-' + sem + '-' + sec;
    var dupe = _cache.classes.find(function (c) { return c.name.toLowerCase() === className.toLowerCase(); });
    if (dupe) { skipped++; continue; }

    try {
      var created = await apiCall('POST', '/classes', {
        name: className, deptId: dept._id, deptName: dept.name, deptCode: dept.code,
        year: yr, sem: sem || 'I', section: sec, hallNo: hall, batch: matchedBatch
      });
      _cache.classes.push(created);
      added++;
    } catch (e) {
      skipped++;
      errors.push({ row: rn, name: className, issues: [e.message] });
    }
  }

  showUploadPreview('sup', added, skipped, errors);
  showToast('Classes: ' + added + ' added, ' + skipped + ' skipped');
  if (added > 0) wizMarkDone('class');
}

async function parseSubjectRows(rows) {
  var added = 0, skipped = 0, errors = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i], rn = i + 2;
    var name    = cv(row, ['name', 'subject']);
    var code    = cv(row, ['code']);
    var dn      = cv(row, ['dept', 'department', 'deptcode']);
    var credits = parseInt(cv(row, ['credit', 'credits'])) || 3;
    var type    = cv(row, ['type']) || 'Theory';

    var rowErrors = [];
    if (!name) rowErrors.push('Name missing');
    if (!code) rowErrors.push('Code missing');
    if (!dn)   rowErrors.push('Department missing');
    if (rowErrors.length) {
      skipped++;
      errors.push({ row: rn, name: name || code || '(blank)', issues: rowErrors });
      continue;
    }

    var dept = _cache.depts.find(function (d) {
      return d.code.toLowerCase() === dn.toLowerCase() || d.name.toLowerCase() === dn.toLowerCase();
    });
    if (!dept) {
      skipped++;
      errors.push({ row: rn, name: name, issues: ['Department "' + dn + '" not found — add it first'] });
      continue;
    }

    // subjectCode is required + unique on the backend but isn't a column
    // the upload sheet asks for — derive it the same way the single-add
    // form does (deptCode + subject code), just without the manual
    // "short code" field that form also collects.
    var subjectCode = dept.code + '-' + code.toUpperCase();
    if (_cache.subjects.find(function (s) { return s.subjectCode === subjectCode; })) {
      skipped++;
      errors.push({ row: rn, name: name, issues: ['Subject code ' + subjectCode + ' already exists'] });
      continue;
    }

    try {
      var created = await apiCall('POST', '/subjects', {
        name: name, code: code, credits: credits, type: type,
        deptId: dept._id, deptName: dept.name, deptCode: dept.code, subjectCode: subjectCode
      });
      _cache.subjects.push(created);
      added++;
    } catch (e) {
      skipped++;
      errors.push({ row: rn, name: name, issues: [e.message] });
    }
  }

  showUploadPreview('subup', added, skipped, errors);
  showToast('Subjects: ' + added + ' added, ' + skipped + ' skipped');
  if (added > 0) wizMarkDone('subject');
}

async function parseTeacherRows(rows) {
  var added = 0, skipped = 0, errors = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i], rn = i + 2;
    var name  = cv(row, ['name']);
    var empId = cv(row, ['empid', 'employeeid', 'employee']);
    var dn    = cv(row, ['dept', 'department']);
    var desig = cv(row, ['desig', 'designation']) || 'Assistant Professor';
    var user  = cv(row, ['user', 'username']);
    var pass  = cv(row, ['pass', 'password']) || 'teacher123';

    var rowErrors = [];
    if (!name) rowErrors.push('Name missing');
    if (!user) rowErrors.push('Username missing');
    if (rowErrors.length) {
      skipped++;
      errors.push({ row: rn, name: name || '(blank)', issues: rowErrors });
      continue;
    }

    var dept = dn ? _cache.depts.find(function (d) {
      return d.name.toLowerCase() === dn.toLowerCase() || d.code.toLowerCase() === dn.toLowerCase();
    }) : null;

    try {
      await apiCall('POST', '/teachers', {
        fullName: name, employeeNo: empId, department: dept ? dept.name : dn,
        deptId: dept ? dept._id : null, deptCode: dept ? dept.code : '',
        designation: desig, username: user, password: pass
      });
      added++;
    } catch (e) {
      skipped++;
      errors.push({ row: rn, name: name, issues: [e.message || 'Could not add teacher'] });
    }
  }

  showUploadPreview('tcup', added, skipped, errors);
  showToast('Teachers: ' + added + ' added, ' + skipped + ' skipped');
  if (added > 0) wizMarkDone('teacher');
}

// BOOT
var currentUser = null;

(function checkAuthAndBoot() {
  currentUser = checkAuth('admin', 'bulkPage');
  if (!currentUser) return;

  var backBtn = document.querySelector('.sb-back-btn');
  if (backBtn) {
    if (currentUser && currentUser.role === 'teacher') {
      backBtn.textContent = '← Back to Hub';
      var brandEl = document.querySelector('.sb-brand');
      if (brandEl) brandEl.textContent = 'EAMS Bulk Tools';
      var roleEl = document.querySelector('.sb-urole');
      if (roleEl) roleEl.textContent = 'Teacher (Admin)';
    } else {
      backBtn.textContent = '← Back to Dashboard';
    }
  }

  fetch('/api/settings/public')
    .then(function (r) { return r.json(); })
    .then(function (pub) {
      if (pub.institution) {
        var instShort = pub.institution.institutionShort || '';
        document.title = instShort ? ('EAMS – Bulk Operations | ' + instShort) : 'EAMS – Bulk Operations';
      }
      if (currentUser && currentUser.role !== 'admin') {
        var pState = pub.pages ? pub.pages.pageBulk : 'enabled';
        if (pState === 'hidden') {
          window.location.href = 'teacher.html';
          return;
        } else if (pState === 'disabled') {
          alert('Bulk Operations portal is currently disabled for maintenance.');
          window.location.href = 'selector.html';
          return;
        }
      }
    })
    .catch(function (e) { console.warn('Public settings fetch error', e); });

  _cacheReady = loadCache();
  initWizard();

  var urlParams = new URLSearchParams(window.location.search);
  var initialTab = urlParams.get('tab') || urlParams.get('page');
  if (initialTab && ['dept', 'teacher', 'class', 'subject', 'student', 'wizard'].indexOf(initialTab) !== -1) {
    var targetBtn = document.getElementById('wz-tab-' + initialTab);
    if (targetBtn) bulkTab(targetBtn, initialTab);
  }
})();

document.addEventListener('contextmenu', function (e) { e.preventDefault(); });