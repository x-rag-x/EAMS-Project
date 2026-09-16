// ══ EXPORT CENTER PAGE ══════════════════════════════════════════════════

// ─── STATE ───────────────────────────────────────────────────────────────
var currentUser = null;
var currentFilters = {
  search: '',
  reportType: '',
  department: '',
  year: '',
  section: '',
  subject: '',
  dateFrom: '',
  dateTo: ''
};
var savedTemplates = [];
var exportHistory = [];
var historyPage = 1;
var historyTotal = 0;
var historyLimit = 15;
var filterOptions = { departments: [], years: [], sections: [], subjects: [], students: [] };
var activeConfig = null;

// ─── INIT ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function () {
  currentUser = checkAuth('any');
  if (!currentUser) return;

  setupUserProfile();
  updateTopDate();
  setInterval(updateTopDate, 30000);

  attachEventListeners();
  setupDateRangeButtons();

  await buildFilterOptions();
  await loadDashboard();
  await loadTemplates();
  await loadHistory(1);

  var urlParams = new URLSearchParams(window.location.search);
  var exportType = urlParams.get('type');
  if (exportType === 'timetable') {
    applyTimetableExportLock();
  } else {
    var initialTab = urlParams.get('tab') || 'dash';
    nav(initialTab);
  }
});

function applyTimetableExportLock() {
  document.title = 'EAMS – Timetable Export Center';
  window.isTimetableScoped = true;

  // 1. Hide non-TT sidebar items
  var nonTTTabs = ['student', 'subject', 'dept', 'bulk'];
  document.querySelectorAll('.sb .sb-item').forEach(function (btn) {
    var page = btn.getAttribute('data-page');
    if (nonTTTabs.indexOf(page) !== -1) {
      btn.style.display = 'none';
    }
  });

  // 2. Add restricted mode banner above main content
  var mainContent = document.querySelector('.main-content');
  if (mainContent && !document.getElementById('tt-export-restricted-banner')) {
    var banner = document.createElement('div');
    banner.id = 'tt-export-restricted-banner';
    banner.style.cssText = 'background:rgba(37,99,235,0.08);border:1.5px solid rgba(37,99,235,0.3);border-radius:12px;padding:12px 18px;margin-bottom:18px;display:flex;align-items:center;gap:12px;color:var(--td);';
    banner.innerHTML = '<span style="font-size:20px;">ℹ️</span><div><div style="font-weight:700;font-size:13px;color:#1e40af;">Showing Timetable Export Tools (Restricted Mode)</div><div style="font-size:11.5px;color:var(--tmu);margin-top:2px;">Navigation is locked to Class and Faculty timetable schedules and term archiving.</div></div>';
    mainContent.insertBefore(banner, mainContent.firstChild);
  }

  // 3. Set page to class reports
  nav('class');
}

// ─── USER PROFILE (SIDEBAR & TOPBAR) ─────────────────────────────────────
function setupUserProfile() {
  if (!currentUser) return;
  var name = currentUser.fullName || currentUser.userName || currentUser.name || 'User';
  var role = (currentUser.role || 'user').toUpperCase();
  var avLetter = name.charAt(0).toUpperCase();

  // Sidebar User Profile
  var sbName = document.getElementById('sb-name');
  var sbRole = document.getElementById('sb-role');
  var sbAv = document.getElementById('sb-av');
  if (sbName) sbName.textContent = name;
  if (sbRole) sbRole.textContent = role;
  if (sbAv) sbAv.textContent = avLetter;

  // Topbar Profile
  var topName = document.getElementById('topbar-name');
  var topRole = document.getElementById('topbar-role');
  var topAv = document.getElementById('topbar-av');
  if (topName) topName.textContent = name;
  if (topRole) topRole.textContent = role + ' Portal';
  if (topAv) topAv.textContent = avLetter;
}

// ─── SIDEBAR TOGGLE & TREE NAVIGATION ────────────────────────────────────
function toggleExportSidebar() {
  var sidebar = document.querySelector('#app-shell .sb');
  var mainContent = document.querySelector('.mc');
  var toggleButton = document.getElementById('sbtoggle');
  var overlay = document.getElementById('sb-overlay');
  var isMobile = window.innerWidth <= 768;

  if (isMobile) {
    var isOpen = sidebar.classList.toggle('sb-mobile-open');
    if (overlay) overlay.classList.toggle('visible', isOpen);
    if (toggleButton) toggleButton.innerHTML = isOpen ? '✖' : '☰';
  } else {
    var isHidden = sidebar.classList.toggle('sb-hidden');
    if (mainContent) mainContent.classList.toggle('sb-expanded', isHidden);
    if (toggleButton) {
      toggleButton.classList.toggle('closed', isHidden);
      toggleButton.innerHTML = isHidden ? '☰' : '✖';
    }
  }
}
window.toggleExportSidebar = toggleExportSidebar;
window.toggleAdminSidebar = toggleExportSidebar;

// ─── TAB NAVIGATION (Matching admin.html) ──────────────────────────────────
var PAGE_NAMES = ['dash', 'student', 'class', 'subject', 'teacher', 'dept', 'bulk', 'scheduled', 'templates', 'history'];

function nav(pageName) {
  if (window.isTimetableScoped) {
    var allowedTabs = ['class', 'teacher', 'scheduled', 'templates', 'history'];
    if (allowedTabs.indexOf(pageName) === -1) {
      pageName = 'class';
    }
  }
  if (PAGE_NAMES.indexOf(pageName) === -1) pageName = 'dash';
  window._currentPage = pageName;

  if (window.history && window.history.replaceState) {
    var url = new URL(window.location);
    url.searchParams.set('tab', pageName);
    window.history.replaceState(null, '', url);
  }

  // Switch active page
  document.querySelectorAll('.main-content .pg').forEach(function (el) {
    el.classList.remove('act');
  });
  var targetPage = document.getElementById('pg-' + pageName);
  if (targetPage) targetPage.classList.add('act');

  // Switch active sidebar item
  document.querySelectorAll('.sb .sb-item').forEach(function (item) {
    item.classList.remove('act');
  });
  var activeItem = document.querySelector('.sb .sb-item[data-page="' + pageName + '"]');
  if (activeItem) activeItem.classList.add('act');

  // Scroll to top of main content
  var mc = document.querySelector('.mc') || window;
  if (mc.scrollTo) {
    mc.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // On mobile, close sidebar after clicking
  if (window.innerWidth <= 768) {
    var sidebar = document.querySelector('#app-shell .sb');
    var overlay = document.getElementById('sb-overlay');
    var toggleButton = document.getElementById('sbtoggle');
    if (sidebar && sidebar.classList.contains('sb-mobile-open')) {
      sidebar.classList.remove('sb-mobile-open');
      if (overlay) overlay.classList.remove('visible');
      if (toggleButton) toggleButton.innerHTML = '☰';
    }
  }

  // Tab specific initializers
  if (pageName === 'dash') {
    loadDashboard();
  } else if (pageName === 'templates') {
    loadTemplates();
  } else if (pageName === 'history') {
    loadHistory(1);
  }
}
window.nav = nav;

function updateTopDate() {
  var el = document.getElementById('tdt-label');
  if (!el) return;
  var now = new Date();
  var opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  el.textContent = now.toLocaleString('en-IN', opts);
}

// ─── NAVIGATION ──────────────────────────────────────────────────────────
function goHome() {
  var user = currentUser || (typeof getUser === 'function' ? getUser() : null);
  if (!user) { window.location.href = 'index.html'; return; }
  if (user.role === 'admin') window.location.href = 'admin.html';
  else if (user.role === 'teacher') window.location.href = 'teacher.html';
  else if (user.role === 'student') window.location.href = 'student.html';
  else window.location.href = 'index.html';
}
window.goHome = goHome;

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────
function attachEventListeners() {
  // Search input with instant card filtering
  var searchInput = document.getElementById('export-search');
  if (searchInput) {
    searchInput.addEventListener('input', function (e) {
      clearTimeout(this._debounce);
      this._debounce = setTimeout(function () {
        currentFilters.search = e.target.value.trim();
        filterReportCards();
      }, 200);
    });
  }

  // Report type filter
  var typeFilter = document.getElementById('filter-type');
  if (typeFilter) {
    typeFilter.addEventListener('change', function () {
      currentFilters.reportType = this.value;
      filterReportCards();
      historyPage = 1;
      loadHistory(1);
    });
  }

  // Date range filters
  var dateFrom = document.getElementById('filter-date-from');
  var dateTo = document.getElementById('filter-date-to');
  if (dateFrom) {
    dateFrom.addEventListener('change', function () {
      currentFilters.dateFrom = this.value;
      historyPage = 1;
      loadHistory(1);
    });
  }
  if (dateTo) {
    dateTo.addEventListener('change', function () {
      currentFilters.dateTo = this.value;
      historyPage = 1;
      loadHistory(1);
    });
  }

  // Scope filters
  var deptSelect = document.getElementById('filter-department');
  if (deptSelect) {
    deptSelect.addEventListener('change', function () {
      currentFilters.department = this.value;
      historyPage = 1;
      loadHistory(1);
    });
  }

  var yearSelect = document.getElementById('filter-year');
  if (yearSelect) {
    yearSelect.addEventListener('change', function () {
      currentFilters.year = this.value;
      historyPage = 1;
      loadHistory(1);
    });
  }

  var sectionSelect = document.getElementById('filter-section');
  if (sectionSelect) {
    sectionSelect.addEventListener('change', function () {
      currentFilters.section = this.value;
      historyPage = 1;
      loadHistory(1);
    });
  }

  var subjectSelect = document.getElementById('filter-subject');
  if (subjectSelect) {
    subjectSelect.addEventListener('change', function () {
      currentFilters.subject = this.value;
      historyPage = 1;
      loadHistory(1);
    });
  }

  // Clear filters button
  var clearBtn = document.getElementById('btn-clear-filters');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearFilters);
  }

  // History Pagination
  var prevBtn = document.getElementById('btn-history-prev');
  var nextBtn = document.getElementById('btn-history-next');
  if (prevBtn) {
    prevBtn.addEventListener('click', function () {
      if (historyPage > 1) loadHistory(historyPage - 1);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      var totalPages = Math.ceil(historyTotal / historyLimit);
      if (historyPage < totalPages) loadHistory(historyPage + 1);
    });
  }
}

// ─── FILTER REPORT CARDS ON PAGE ─────────────────────────────────────────
function filterReportCards() {
  var searchTerm = (currentFilters.search || '').toLowerCase().trim();

  // 1. If on dashboard and search term is provided, populate search-results-grid
  var searchResultsSection = document.getElementById('dashboard-search-results');
  var searchResultsGrid = document.getElementById('search-results-grid');
  var searchCountEl = document.getElementById('search-results-count');

  if (searchResultsSection && searchResultsGrid) {
    if (searchTerm) {
      // Find all report cards across all module pages
      var allCards = document.querySelectorAll('.main-content .pg:not(#pg-dash) .ec-report-card[data-report]');
      var matches = [];
      allCards.forEach(function (card) {
        var reportType = (card.getAttribute('data-report') || '').toLowerCase();
        var title = (card.querySelector('.report-name')?.textContent || '').toLowerCase();
        var desc = (card.querySelector('.report-desc')?.textContent || '').toLowerCase();

        if (reportType.includes(searchTerm) || title.includes(searchTerm) || desc.includes(searchTerm)) {
          matches.push(card.cloneNode(true));
        }
      });

      searchResultsGrid.innerHTML = '';
      if (matches.length > 0) {
        matches.forEach(function (clone) {
          var report = clone.getAttribute('data-report');
          clone.onclick = function () { openReportConfig(report); };
          var genBtn = clone.querySelector('.btn-generate');
          if (genBtn) {
            genBtn.onclick = function (e) {
              e.stopPropagation();
              openReportConfig(report);
            };
          }
          searchResultsGrid.appendChild(clone);
        });
        if (searchCountEl) searchCountEl.textContent = matches.length + ' matching report' + (matches.length > 1 ? 's' : '') + ' found';
      } else {
        searchResultsGrid.innerHTML = '<div class="ec-empty-state" style="grid-column:1/-1;">No reports found matching "' + escHtml(searchTerm) + '". Try searching "defaulter", "student", "class", "register", or "teacher".</div>';
        if (searchCountEl) searchCountEl.textContent = '0 matching reports';
      }
      searchResultsSection.style.display = 'block';
    } else {
      searchResultsSection.style.display = 'none';
      searchResultsGrid.innerHTML = '';
    }
  }

  // 2. Also filter cards within all module pages
  var cards = document.querySelectorAll('.ec-report-card[data-report]');
  cards.forEach(function (card) {
    var reportType = (card.getAttribute('data-report') || '').toLowerCase();
    var title = (card.querySelector('.report-name')?.textContent || '').toLowerCase();
    var desc = (card.querySelector('.report-desc')?.textContent || '').toLowerCase();

    var matchSearch = !searchTerm ||
      reportType.includes(searchTerm) ||
      title.includes(searchTerm) ||
      desc.includes(searchTerm);

    card.style.display = matchSearch ? '' : 'none';
  });
}

// ─── DASHBOARD METRICS ───────────────────────────────────────────────────
async function loadDashboard() {
  try {
    var res = await apiCall('GET', '/export/dashboard');
    var data = res.data || res;
    var stats = data.stats || {};

    var totalEl = document.getElementById('stat-total-exports');
    var monthEl = document.getElementById('stat-exports-month');
    var templEl = document.getElementById('stat-templates');
    var popEl = document.getElementById('stat-popular-type');

    if (totalEl) totalEl.textContent = stats.totalExports || 0;
    if (monthEl) monthEl.textContent = stats.exportsThisMonth || 0;
    if (templEl) templEl.textContent = stats.templatesCount || 0;
    if (popEl) popEl.textContent = stats.popularReportType ? formatReportName(stats.popularReportType) : '—';

    renderRecentExports(data.recentExports || []);
  } catch (e) {
    console.error('Failed to load dashboard:', e);
  }
}

function renderRecentExports(exports) {
  var container = document.getElementById('recent-exports-list');
  if (!container) return;

  if (!exports || exports.length === 0) {
    container.innerHTML = '<div class="ec-empty-state">No recent exports.</div>';
    return;
  }

  container.innerHTML = exports.slice(0, 8).map(function (exp) {
    var trackId = exp.exportTrackId || exp._id;
    var name = formatReportName(exp.reportType || 'Export');
    var format = (exp.format || 'pdf').toUpperCase();
    var dateStr = exp.generatedAt || exp.createdAt ? formatDate(exp.generatedAt || exp.createdAt) : '';

    return '<div class="export-card">' +
      '<div class="export-card-header">' +
        '<span class="export-type">' + escHtml(name) + '</span>' +
        '<span class="export-date">' + dateStr + '</span>' +
      '</div>' +
      '<div class="export-card-body">' +
        '<span class="export-format">' + escHtml(format) + '</span>' +
        '<span class="export-records">' + (exp.recordCount || 0) + ' records</span>' +
      '</div>' +
      '<div class="export-card-footer" style="margin-top:8px;">' +
        '<button class="btn-download" style="width:100%;justify-content:center;" onclick="downloadExport(\'' + trackId + '\')">📥 Re-Download</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ─── FILTER OPTIONS ──────────────────────────────────────────────────────
async function buildFilterOptions() {
  try {
    var res = await apiCall('GET', '/export/filter-options');
    var data = res.data || res;

    if (data.departments) filterOptions.departments = data.departments;
    if (data.years) filterOptions.years = data.years;
    if (data.sections) filterOptions.sections = data.sections;
    if (data.subjects) filterOptions.subjects = data.subjects;
    if (data.students) filterOptions.students = data.students;

    // Populate search bar selects
    populateSelect('filter-department', filterOptions.departments, currentFilters.department, '🏛️ All Departments');
    populateSelect('filter-year', filterOptions.years, currentFilters.year, '🎓 All Years');
    populateSelect('filter-section', filterOptions.sections, currentFilters.section, '🏷️ All Sections');
    populateSelect('filter-subject', filterOptions.subjects, currentFilters.subject, '📚 All Subjects');

    // Populate modal selects
    populateSelect('config-department', filterOptions.departments, '', 'All Departments');
    populateSelect('config-year', filterOptions.years, '', 'All Years');
    populateSelect('config-section', filterOptions.sections, '', 'All Sections');
    populateSelect('config-subject', filterOptions.subjects, '', 'All Subjects');
    populateSelect('config-student', filterOptions.students, '', '— Select Student —');
  } catch (e) {
    console.error('Failed to load filter options:', e);
  }
}

function populateSelect(elementId, options, selectedValue, defaultLabel) {
  var el = document.getElementById(elementId);
  if (!el) return;

  var html = '<option value="">' + (defaultLabel || 'All') + '</option>';
  if (Array.isArray(options)) {
    html += options.map(function (opt) {
      var val = opt._id || opt.code || opt.value || opt.name || opt;
      var label = opt.label || opt.name || opt.code || opt;
      var isSel = String(val) === String(selectedValue);
      return '<option value="' + escHtml(val) + '"' + (isSel ? ' selected' : '') + '>' + escHtml(label) + '</option>';
    }).join('');
  }
  el.innerHTML = html;
  if (selectedValue) el.value = selectedValue;
}

// ─── DATE RANGE PRESET BUTTONS ───────────────────────────────────────────
function setupDateRangeButtons() {
  var buttons = document.querySelectorAll('.btn-daterange');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      buttons.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      var range = btn.getAttribute('data-range');
      applyDatePreset(range);
    });
  });
}

function applyDatePreset(range) {
  var today = new Date();
  var startStr = '';
  var endStr = today.toISOString().split('T')[0];

  if (range === 'today') {
    startStr = endStr;
  } else if (range === 'week') {
    var d = new Date(today);
    var day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    startStr = d.toISOString().split('T')[0];
  } else if (range === 'month') {
    var start = new Date(today.getFullYear(), today.getMonth(), 1);
    startStr = start.toISOString().split('T')[0];
  } else if (range === 'semester') {
    var semMonth = today.getMonth() >= 6 ? 6 : 0;
    var start = new Date(today.getFullYear(), semMonth, 1);
    startStr = start.toISOString().split('T')[0];
  } else if (range === 'year') {
    var start = new Date(today.getFullYear(), 0, 1);
    startStr = start.toISOString().split('T')[0];
  } else if (range === 'custom') {
    var fromEl = document.getElementById('config-date-from');
    if (fromEl) fromEl.focus();
    return;
  }

  var fromInput = document.getElementById('config-date-from');
  var toInput = document.getElementById('config-date-to');
  if (fromInput && startStr) fromInput.value = startStr;
  if (toInput && endStr) toInput.value = endStr;
}

// ─── REPORT CONFIG MODAL ─────────────────────────────────────────────────
function openReportConfig(reportType) {
  var modal = document.getElementById('modal-report-config');
  if (!modal) return;

  var typeInput = document.getElementById('config-report-type');
  if (typeInput) typeInput.value = reportType;

  var titleEl = document.getElementById('config-report-title');
  if (titleEl) titleEl.textContent = formatReportName(reportType) + ' Configuration';

  var subEl = document.getElementById('config-report-subtitle');
  if (subEl) subEl.textContent = 'Configure parameters, scope, and output format.';

  // Show / hide contextual fields
  var studentGroup = document.getElementById('group-student-select');
  var subjectGroup = document.getElementById('group-subject-select');
  var thresholdGroup = document.getElementById('group-threshold');

  var isStudentReport = reportType.indexOf('student') !== -1;
  var isSubjectReport = reportType.indexOf('subject') !== -1;
  var isDefaulterReport = reportType.indexOf('defaulter') !== -1 || reportType.indexOf('shortage') !== -1;

  if (studentGroup) studentGroup.style.display = isStudentReport ? 'block' : 'none';
  if (subjectGroup) subjectGroup.style.display = (isSubjectReport || isDefaulterReport) ? 'block' : 'none';
  if (thresholdGroup) thresholdGroup.style.display = isDefaulterReport ? 'block' : 'none';

  // Apply default date preset if not set
  var fromInput = document.getElementById('config-date-from');
  var toInput = document.getElementById('config-date-to');
  if (fromInput && !fromInput.value) {
    applyDatePreset('month');
  }

  // Set default format to PDF
  var defaultFormat = document.querySelector('input[name="format"][value="pdf"]');
  if (defaultFormat) defaultFormat.checked = true;

  // Clear template name input
  var tmplName = document.getElementById('config-template-name');
  if (tmplName) tmplName.value = '';

  openModal('modal-report-config');
}
window.openReportConfig = openReportConfig;

function getActiveConfigFromModal() {
  var typeEl = document.getElementById('config-report-type');
  var reportType = typeEl ? typeEl.value : '';

  var formatEl = document.querySelector('input[name="format"]:checked');
  var format = formatEl ? formatEl.value : 'pdf';

  var dateFrom = document.getElementById('config-date-from')?.value || '';
  var dateTo = document.getElementById('config-date-to')?.value || '';
  var department = document.getElementById('config-department')?.value || '';
  var year = document.getElementById('config-year')?.value || '';
  var section = document.getElementById('config-section')?.value || '';
  var subject = document.getElementById('config-subject')?.value || '';
  var studentId = document.getElementById('config-student')?.value || '';
  var threshold = parseInt(document.getElementById('config-threshold')?.value || '75', 10);
  var templateName = document.getElementById('config-template-name')?.value.trim() || '';

  return {
    reportType: reportType,
    format: format,
    dateFrom: dateFrom,
    dateTo: dateTo,
    department: department,
    year: year,
    section: section,
    subject: subject,
    studentId: studentId,
    threshold: threshold,
    templateName: templateName
  };
}

// ─── PREVIEW FEATURE ─────────────────────────────────────────────────────
async function handlePreviewClick() {
  var config = getActiveConfigFromModal();
  if (!config.reportType) {
    showToast('Please select a report type first', 'error');
    return;
  }

  var isStudentReport = config.reportType.indexOf('student') !== -1;
  if (isStudentReport && !config.studentId) {
    var studentSelect = document.getElementById('config-student');
    if (studentSelect && studentSelect.options.length > 1) {
      showToast('Please choose a student for this report', 'error');
      studentSelect.focus();
      return;
    }
  }

  var btn = document.getElementById('btn-preview');
  if (btn) { btn.disabled = true; btn.textContent = 'Calculating…'; }

  try {
    var res = await apiCall('POST', '/export/preview', {
      reportType: config.reportType,
      config: {
        dateRange: { start: config.dateFrom, end: config.dateTo },
        filters: {
          departmentId: config.department,
          year: config.year,
          section: config.section,
          subjectId: config.subject
        }
      }
    });

    var preview = res.data?.preview || res.preview || {};

    var previewTypeEl = document.getElementById('preview-type');
    var previewRecordsEl = document.getElementById('preview-records');
    var previewDaterangeEl = document.getElementById('preview-daterange');
    var previewSizeEl = document.getElementById('preview-size');

    if (previewTypeEl) previewTypeEl.textContent = formatReportName(config.reportType);
    if (previewRecordsEl) previewRecordsEl.textContent = (preview.estimatedRecords ?? '—') + ' records';
    if (previewDaterangeEl) previewDaterangeEl.textContent = (config.dateFrom || 'N/A') + ' to ' + (config.dateTo || 'N/A');
    if (previewSizeEl) previewSizeEl.textContent = preview.estimatedSize || '~25 KB';

    activeConfig = config;
    openModal('modal-preview-counts');
  } catch (err) {
    showToast('Preview calculation failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '👁️ Preview Count'; }
  }
}
window.handlePreviewClick = handlePreviewClick;

function executeGenerateFromModal() {
  if (!activeConfig) activeConfig = getActiveConfigFromModal();
  closeModal('modal-preview-counts');
  closeModal('modal-report-config');
  executeGenerate(activeConfig);
}
window.executeGenerateFromModal = executeGenerateFromModal;

// ─── GENERATE & DOWNLOAD ─────────────────────────────────────────────────
async function handleConfigFormSubmit(event) {
  if (event) event.preventDefault();

  var config = getActiveConfigFromModal();
  if (!config.reportType) {
    showToast('Please choose a report to export', 'error');
    return;
  }

  var isStudentReport = config.reportType.indexOf('student') !== -1;
  if (isStudentReport && !config.studentId) {
    var studentSelect = document.getElementById('config-student');
    if (studentSelect && studentSelect.options.length > 1) {
      showToast('Please select a student for this report', 'error');
      studentSelect.focus();
      return;
    }
  }

  // Save template if user specified a name
  if (config.templateName) {
    saveTemplate({
      templateName: config.templateName,
      reportType: config.reportType,
      config: {
        filters: {
          departmentId: config.department,
          year: config.year,
          section: config.section,
          subjectId: config.subject
        },
        dateRange: { start: config.dateFrom, end: config.dateTo },
        format: config.format,
        options: { studentId: config.studentId, threshold: config.threshold }
      }
    });
  }

  closeModal('modal-report-config');
  await executeGenerate(config);
}
window.handleConfigFormSubmit = handleConfigFormSubmit;

async function executeGenerate(config) {
  var genBtn = document.getElementById('btn-generate');
  if (genBtn) { genBtn.disabled = true; genBtn.textContent = 'Generating…'; }

  if (typeof window.dbToast === 'function') {
    window.dbToast('Preparing ' + config.format.toUpperCase() + ' document…', 'saving');
  } else {
    showToast('Generating ' + config.format.toUpperCase() + ' document…', 'info');
  }

  try {
    var payload = {
      reportType: config.reportType,
      format: config.format,
      dateRange: { start: config.dateFrom, end: config.dateTo },
      filters: {
        departmentId: config.department,
        year: config.year,
        section: config.section,
        subjectId: config.subject
      },
      studentId: config.studentId,
      threshold: config.threshold
    };

    var res = await apiCall('POST', '/export/generate', payload);
    var data = res.data || res;

    if (typeof window.dbToast === 'function') {
      window.dbToast('Report ready! Initiating download…', 'success');
    }
    showToast('Export successful! Starting download…', 'success');

    var downloadUrl = data.downloadUrl || ('/api/export/download/' + data.exportTrackId);
    var ext = config.format === 'excel' ? 'csv' : (config.format === 'csv' ? 'csv' : 'html');
    var filename = 'EAMS_' + config.reportType + '_' + (data.exportTrackId || 'doc') + '.' + ext;

    await triggerAuthenticatedDownload(downloadUrl, filename);

    // Refresh history and stats
    await loadHistory(1);
    await loadDashboard();
  } catch (err) {
    console.error('Generation failed:', err);
    if (typeof window.dbToast === 'function') {
      window.dbToast('Export failed: ' + err.message, 'error');
    }
    showToast('Export generation failed: ' + err.message, 'error');
  } finally {
    if (genBtn) { genBtn.disabled = false; genBtn.textContent = '🚀 Generate & Download'; }
  }
}

// ─── AUTHENTICATED FILE DOWNLOAD ─────────────────────────────────────────
async function triggerAuthenticatedDownload(url, defaultFilename) {
  try {
    var token = typeof getToken === 'function' ? getToken() : sessionStorage.getItem('eams_token');
    var headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;

    var response = await fetch(url, { headers: headers });
    if (!response.ok) {
      var errText = await response.text();
      try {
        var errObj = JSON.parse(errText);
        throw new Error(errObj.error || ('HTTP error ' + response.status));
      } catch (e) {
        throw new Error(errText || ('HTTP error ' + response.status));
      }
    }

    var disposition = response.headers.get('content-disposition') || '';
    var filename = defaultFilename || 'report_export.dat';
    var match = disposition.match(/filename="?([^";]+)"?/i);
    if (match && match[1]) filename = match[1].trim();

    var blob = await response.blob();
    var blobUrl = window.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    }, 400);
  } catch (err) {
    console.error('Download error:', err);
    showToast('Download error: ' + err.message, 'error');
  }
}

async function downloadExport(idOrTrackId) {
  var url = '/api/export/download/' + idOrTrackId;
  await triggerAuthenticatedDownload(url, 'export_' + idOrTrackId + '.html');
}
window.downloadExport = downloadExport;

// ─── TEMPLATES ───────────────────────────────────────────────────────────
async function loadTemplates() {
  try {
    var res = await apiCall('GET', '/export/templates');
    var data = res.data || res;
    savedTemplates = data.templates || [];

    var badge = document.getElementById('templates-count-badge');
    if (badge) badge.textContent = savedTemplates.length + ' Saved';

    var statEl = document.getElementById('stat-templates');
    if (statEl) statEl.textContent = savedTemplates.length;

    var sbBadge = document.getElementById('sb-tmpl-count');
    if (sbBadge) sbBadge.textContent = savedTemplates.length;

    renderTemplates(savedTemplates);
  } catch (err) {
    console.error('Failed to load templates:', err);
  }
}

function renderTemplates(templates) {
  var container = document.getElementById('templates-list');
  if (!container) return;

  if (!templates || templates.length === 0) {
    container.innerHTML =
      '<div class="ec-empty-state">' +
        '<div class="empty-icon">⭐</div>' +
        '<div class="empty-title">No saved templates yet</div>' +
        '<div class="empty-desc">Configure any report and provide a template name to quickly regenerate it anytime.</div>' +
      '</div>';
    return;
  }

  container.innerHTML = templates.map(function (tmpl) {
    var filterCount = tmpl.config && tmpl.config.filters ? Object.keys(tmpl.config.filters).length : 0;
    return '<div class="template-card" data-id="' + tmpl._id + '">' +
      '<div class="template-card-header">' +
        '<span class="template-name">' + escHtml(tmpl.templateName || tmpl.name || 'Unnamed Template') + '</span>' +
        '<span class="template-type">' + escHtml(formatReportName(tmpl.reportType || 'Custom')) + '</span>' +
      '</div>' +
      '<div class="template-card-body">' +
        '<span class="template-meta">' + filterCount + ' preset filters</span>' +
        '<span class="template-date">' + (tmpl.updatedAt || tmpl.createdAt ? formatDate(tmpl.updatedAt || tmpl.createdAt) : 'N/A') + '</span>' +
      '</div>' +
      '<div class="template-card-footer">' +
        '<button class="btn-sm btn-load-template" onclick="loadTemplate(\'' + tmpl._id + '\')">⚡ Load Preset</button>' +
        '<button class="btn-sm btn-delete-template" onclick="deleteTemplate(\'' + tmpl._id + '\')">🗑️ Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function saveTemplate(payload) {
  try {
    if (typeof window.dbToast === 'function') window.dbToast('Saving custom template…', 'saving');
    await apiCall('POST', '/export/templates', payload);
    if (typeof window.dbToast === 'function') window.dbToast('Template saved!', 'success');
    showToast('Template "' + (payload.templateName || '') + '" saved successfully', 'success');
    await loadTemplates();
  } catch (e) {
    showToast('Failed to save template: ' + e.message, 'error');
  }
}

async function loadTemplate(id) {
  var tmpl = savedTemplates.find(function (t) { return t._id === id; });
  if (!tmpl) {
    showToast('Template not found', 'error');
    return;
  }

  openReportConfig(tmpl.reportType);

  var cfg = tmpl.config || {};
  if (cfg.dateRange) {
    var fromInput = document.getElementById('config-date-from');
    var toInput = document.getElementById('config-date-to');
    if (fromInput && cfg.dateRange.start) fromInput.value = cfg.dateRange.start.split('T')[0];
    if (toInput && cfg.dateRange.end) toInput.value = cfg.dateRange.end.split('T')[0];
  }
  if (cfg.filters) {
    if (cfg.filters.departmentId) {
      var deptSel = document.getElementById('config-department');
      if (deptSel) deptSel.value = cfg.filters.departmentId;
    }
    if (cfg.filters.year) {
      var yrSel = document.getElementById('config-year');
      if (yrSel) yrSel.value = cfg.filters.year;
    }
    if (cfg.filters.section) {
      var secSel = document.getElementById('config-section');
      if (secSel) secSel.value = cfg.filters.section;
    }
    if (cfg.filters.subjectId) {
      var subjSel = document.getElementById('config-subject');
      if (subjSel) subjSel.value = cfg.filters.subjectId;
    }
  }
  if (cfg.format) {
    var radio = document.querySelector('input[name="format"][value="' + cfg.format + '"]');
    if (radio) radio.checked = true;
  }
  if (cfg.options) {
    if (cfg.options.studentId) {
      var stSel = document.getElementById('config-student');
      if (stSel) stSel.value = cfg.options.studentId;
    }
    if (cfg.options.threshold) {
      var thEl = document.getElementById('config-threshold');
      if (thEl) thEl.value = cfg.options.threshold;
    }
  }

  showToast('Loaded preset: ' + (tmpl.templateName || 'Template'), 'info');
}
window.loadTemplate = loadTemplate;

var pendingDeleteTemplateId = null;

function deleteTemplate(id) {
  pendingDeleteTemplateId = id;
  var tmpl = savedTemplates.find(function (t) { return t._id === id; });
  var nameEl = document.getElementById('delete-template-name');
  if (nameEl) {
    nameEl.textContent = tmpl ? '"' + (tmpl.templateName || tmpl.name || 'Template') + '"' : 'this template';
  }
  openModal('modal-delete-template');
}
window.deleteTemplate = deleteTemplate;

async function confirmDeleteTemplateAction() {
  if (!pendingDeleteTemplateId) return;
  var id = pendingDeleteTemplateId;
  pendingDeleteTemplateId = null;
  closeModal('modal-delete-template');

  var confirmBtn = document.getElementById('btn-confirm-delete-template');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
  }

  try {
    if (typeof window.dbToast === 'function') window.dbToast('Deleting template…', 'saving');
    await apiCall('DELETE', '/export/templates/' + id);
    if (typeof window.dbToast === 'function') window.dbToast('Template deleted', 'success');
    showToast('Template deleted successfully', 'success');
    await loadTemplates();
  } catch (err) {
    showToast('Failed to delete template: ' + err.message, 'error');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '🗑️ Delete Template';
    }
  }
}
window.confirmDeleteTemplateAction = confirmDeleteTemplateAction;

// ─── EXPORT HISTORY ──────────────────────────────────────────────────────
async function loadHistory(page) {
  page = page || 1;
  historyPage = page;

  var tbody = document.getElementById('history-list');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="7" class="ec-empty-state">Loading history…</td></tr>';
  }

  try {
    var queryParts = ['page=' + page, 'limit=' + historyLimit];
    if (currentFilters.reportType) queryParts.push('reportType=' + encodeURIComponent(currentFilters.reportType));
    if (currentFilters.format) queryParts.push('format=' + encodeURIComponent(currentFilters.format));

    var res = await apiCall('GET', '/export/history?' + queryParts.join('&'));
    var data = res.data || res;

    exportHistory = data.history || [];
    var pagination = data.pagination || {};
    historyTotal = pagination.total || exportHistory.length;

    var sbHistBadge = document.getElementById('sb-hist-count');
    if (sbHistBadge) sbHistBadge.textContent = historyTotal;

    renderHistory(exportHistory);
    updateHistoryPagination(pagination);
  } catch (err) {
    console.error('Failed to load history:', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="ec-empty-state" style="color:#dc2626;">Failed to load history: ' + escHtml(err.message) + '</td></tr>';
    }
  }
}

function renderHistory(items) {
  var tbody = document.getElementById('history-list');
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="ec-empty-state">No export history records found.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(function (exp) {
    var trackId = exp.exportTrackId || exp._id || '—';
    var status = (exp.status || 'completed').toLowerCase();
    var statusBadge = '<span class="status-badge status-' + status + '">' + status + '</span>';
    var dateStr = exp.generatedAt || exp.createdAt ? formatDate(exp.generatedAt || exp.createdAt) : '—';
    var format = (exp.format || 'pdf').toUpperCase();

    return '<tr>' +
      '<td>' + dateStr + '</td>' +
      '<td><code style="font-weight:700;color:var(--gD,#1b5e20);">' + escHtml(trackId) + '</code></td>' +
      '<td>' + escHtml(formatReportName(exp.reportType || '—')) + '</td>' +
      '<td><span class="export-format">' + escHtml(format) + '</span></td>' +
      '<td>' + (exp.recordCount ?? '—') + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td style="text-align:right;">' +
        '<button class="btn-download" onclick="downloadExport(\'' + trackId + '\')">' +
          '📥 Download' +
        '</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function updateHistoryPagination(pagination) {
  var totalPages = pagination.pages || Math.max(1, Math.ceil(historyTotal / historyLimit));
  var pageInfo = document.getElementById('history-page-info');
  if (pageInfo) pageInfo.textContent = 'Page ' + historyPage + ' of ' + totalPages + ' (' + historyTotal + ' total)';

  var badge = document.getElementById('history-count-badge');
  if (badge) badge.textContent = 'Page ' + historyPage + ' of ' + totalPages;

  var prevBtn = document.getElementById('btn-history-prev');
  var nextBtn = document.getElementById('btn-history-next');
  if (prevBtn) prevBtn.disabled = historyPage <= 1;
  if (nextBtn) nextBtn.disabled = historyPage >= totalPages;
}

// ─── CLEAR FILTERS ───────────────────────────────────────────────────────
function clearFilters() {
  currentFilters = {
    search: '',
    reportType: '',
    department: '',
    year: '',
    section: '',
    subject: '',
    dateFrom: '',
    dateTo: ''
  };

  var searchEl = document.getElementById('export-search');
  if (searchEl) searchEl.value = '';

  var typeEl = document.getElementById('filter-type');
  if (typeEl) typeEl.value = '';

  var fromEl = document.getElementById('filter-date-from');
  if (fromEl) fromEl.value = '';

  var toEl = document.getElementById('filter-date-to');
  if (toEl) toEl.value = '';

  populateSelect('filter-department', filterOptions.departments, '', '🏛️ All Departments');
  populateSelect('filter-year', filterOptions.years, '', '🎓 All Years');
  populateSelect('filter-section', filterOptions.sections, '', '🏷️ All Sections');
  populateSelect('filter-subject', filterOptions.subjects, '', '📚 All Subjects');

  filterReportCards();
  historyPage = 1;
  loadHistory(1);
}

// ─── UTILITY HELPERS ─────────────────────────────────────────────────────
function formatReportName(code) {
  if (!code) return 'Report';
  return code
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, function (l) { return l.toUpperCase(); });
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(isoDate) {
  if (!isoDate) return '—';
  try {
    var d = new Date(isoDate);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return '—';
  }
}

function showToast(msg, type) {
  if (typeof window.showToast === 'function') {
    window.showToast(msg, type);
  } else if (typeof window.dbToast === 'function') {
    window.dbToast(msg, type);
  } else {
    alert(msg);
  }
}
