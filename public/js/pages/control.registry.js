/**
 * public/js/pages/control.registry.js
 *
 * Attendance Registry Page Controller (AttReg Part 2)
 * Classic spreadsheet-style register with modern features:
 * - 2-level header: Merged date band over period numbers (1..periodsPerDay)
 * - Sticky headers, frozen identity columns, and right-pinned totals
 * - Live tooltips on cells + click cell to inspect in Roster
 * - Period grid ⇄ Day summary mode toggle
 * - Range presets (This Week, This Month, Last Month, Semester, Custom)
 * - Server-side Excel (.xlsx) and PDF (.pdf) export via apiDownload
 * - Zero local storage usage; URL and memory state only
 */

(function () {
  'use strict';

  var registryState = {
    departments: [],
    classes: [],
    selectedDeptId: '',
    selectedClassId: '',
    from: '',
    to: '',
    viewMode: 'periods', // 'periods' | 'days'
    searchQuery: '',
    shortageOnly: false,
    registryData: null,
    loading: false
  };

  function getRangeDates(preset) {
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth();
    var d = now.getDate();

    if (preset === 'this-week') {
      var dayOfWeek = now.getDay();
      var mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      var mon = new Date(y, m, d + mondayOffset);
      var sat = new Date(y, m, d + mondayOffset + 5);
      return { from: formatDate(mon), to: formatDate(sat) };
    }

    if (preset === 'last-month') {
      var firstDayLastMonth = new Date(y, m - 1, 1);
      var lastDayLastMonth = new Date(y, m, 0);
      return { from: formatDate(firstDayLastMonth), to: formatDate(lastDayLastMonth) };
    }

    if (preset === 'semester') {
      // Approximate 60-day semester window
      var semStart = new Date(y, m - 2, 1);
      var semEnd = new Date(y, m, d);
      return { from: formatDate(semStart), to: formatDate(semEnd) };
    }

    // Default: 'this-month'
    var firstDay = new Date(y, m, 1);
    var today = new Date(y, m, d);
    return { from: formatDate(firstDay), to: formatDate(today) };
  }

  function formatDate(d) {
    var year = d.getFullYear();
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function readUrlParams() {
    var p = new URLSearchParams(window.location.search);
    var defaultRange = getRangeDates('this-month');
    return {
      classId: p.get('classId') || '',
      from: p.get('from') || defaultRange.from,
      to: p.get('to') || defaultRange.to,
      view: p.get('view') || 'periods'
    };
  }

  function updateUrlParams() {
    if (!window.history || !window.history.replaceState) return;
    var url = new URL(window.location);
    var curTab = url.searchParams.get('tab');
    if (curTab && curTab !== 'registry') return;

    if (curTab === 'registry') {
      url.searchParams.set('tab', 'registry');
    }

    var classObj = (registryState.classes || []).find(function (c) {
      return String(c.id) === String(registryState.selectedClassId) ||
             String(c.trackId) === String(registryState.selectedClassId) ||
             String(c.name) === String(registryState.selectedClassId);
    });
    var trackIdToSet = classObj ? (classObj.trackId || classObj.name || classObj.id) : registryState.selectedClassId;
    if (trackIdToSet) url.searchParams.set('classId', trackIdToSet);
    else url.searchParams.delete('classId');

    if (registryState.from) url.searchParams.set('from', registryState.from);
    if (registryState.to) url.searchParams.set('to', registryState.to);
    if (registryState.viewMode) url.searchParams.set('view', registryState.viewMode);
    window.history.replaceState(null, '', url);
  }

  function registryInit() {
    var curTab = (new URL(window.location)).searchParams.get('tab');
    var p = readUrlParams();
    registryState.selectedClassId = p.classId;
    registryState.from = p.from;
    registryState.to = p.to;
    registryState.viewMode = p.view;

    loadRegistryOptions().then(function () {
      if (registryState.selectedClassId && curTab === 'registry') {
        fetchRegistry();
      }
    });

    bindEvents();
  }

  function bindEvents() {
    var searchEl = document.getElementById('reg-search');
    if (searchEl && !searchEl._bound) {
      searchEl._bound = true;
      searchEl.addEventListener('input', function (e) {
        registryState.searchQuery = e.target.value.toLowerCase().trim();
        renderRegistryGrid();
      });
    }

    var shortageChk = document.getElementById('reg-shortage-chk');
    if (shortageChk && !shortageChk._bound) {
      shortageChk._bound = true;
      shortageChk.addEventListener('change', function (e) {
        registryState.shortageOnly = e.target.checked;
        renderRegistryGrid();
      });
    }
  }

  function loadRegistryOptions() {
    var isTeacherPortal = typeof window !== 'undefined' && window.location && window.location.pathname && window.location.pathname.toLowerCase().indexOf('teacher') !== -1;
    var url = '/attendance-records/roster/options' + (isTeacherPortal ? '?scope=advisor' : '');
    return apiCall('GET', url)
      .then(function (res) {
        if (!res || !res.ok) return;
        registryState.departments = res.data.departments || [];
        registryState.classes = res.data.classes || [];

        renderDeptSelector();
        renderClassSelector();
        renderDateInputs();
      })
      .catch(function (err) {
        console.error('Failed to load registry options:', err);
      });
  }

  function renderDeptSelector() {
    var sel = document.getElementById('reg-dept-sel');
    if (!sel) return;
    var isTeacherPortal = typeof window !== 'undefined' && window.location && window.location.pathname && window.location.pathname.toLowerCase().indexOf('teacher') !== -1;
    var depts = registryState.departments || [];

    var html = '';
    if (!isTeacherPortal && depts.length > 1) {
      html += '<option value="">All Departments</option>';
    } else if (isTeacherPortal && depts.length > 1) {
      html += '<option value="">All Advised Departments</option>';
    }

    depts.forEach(function (d) {
      html += '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + ' (' + escapeHtml(d.code) + ')</option>';
    });
    sel.innerHTML = html;

    if (depts.length === 1) {
      registryState.selectedDeptId = depts[0].id;
      sel.value = depts[0].id;
      sel.disabled = true;
      sel.title = 'Scoped to your advised department (' + depts[0].name + ')';
    } else if (registryState.selectedDeptId && depts.some(function (d) { return d.id === registryState.selectedDeptId; })) {
      sel.value = registryState.selectedDeptId;
      sel.disabled = false;
    } else {
      sel.value = (isTeacherPortal && depts.length > 0) ? depts[0].id : '';
      registryState.selectedDeptId = sel.value;
      sel.disabled = false;
    }

    sel.onchange = function (e) {
      registryState.selectedDeptId = e.target.value;
      renderClassSelector();
    };
  }

  function renderClassSelector() {
    var sel = document.getElementById('reg-class-sel');
    if (!sel) return;
    var filtered = registryState.classes;
    if (registryState.selectedDeptId) {
      filtered = filtered.filter(function (c) {
        return c.deptId === registryState.selectedDeptId;
      });
    }

    var html = '';
    if (filtered.length > 1) {
      html += '<option value="">Select Class...</option>';
    }
    filtered.forEach(function (c) {
      var label = c.name + ' · ' + (c.batch || '') + ' · Sem ' + (c.sem || '');
      var optVal = c.trackId || c.name || c.id;
      html += '<option value="' + escapeHtml(optVal) + '">' + escapeHtml(label) + '</option>';
    });
    sel.innerHTML = html;

    var matchClass = filtered.find(function(c) {
      return (c.trackId && c.trackId === registryState.selectedClassId) ||
             (c.id && c.id === registryState.selectedClassId) ||
             (c.name && c.name === registryState.selectedClassId);
    });
    if (matchClass) {
      registryState.selectedClassId = matchClass.trackId || matchClass.name || matchClass.id;
      sel.value = registryState.selectedClassId;
    } else if (filtered.length > 0) {
      registryState.selectedClassId = filtered[0].trackId || filtered[0].name || filtered[0].id;
      sel.value = registryState.selectedClassId;
      var curTab = (new URL(window.location)).searchParams.get('tab');
      if (curTab === 'registry') updateUrlParams();
    } else {
      registryState.selectedClassId = '';
      var gridEl = document.getElementById('reg-grid-container');
      if (gridEl) {
        gridEl.innerHTML = '<div style="padding:60px 20px;text-align:center;background:#fff;border-radius:12px;border:1px dashed var(--br);color:var(--tmu);"><re-icon icon="table" size="32" style="margin-bottom:10px;opacity:0.5;"></re-icon><div style="font-size:15px;font-weight:600;color:var(--td);margin-bottom:4px;">No Advised Classes Available</div><div style="font-size:12.5px;">Attendance Registry displays classes where you are assigned as Class Advisor.</div></div>';
      }
      var stripEl = document.getElementById('reg-header-strip');
      if (stripEl) stripEl.innerHTML = '';
    }

    sel.onchange = function (e) {
      registryState.selectedClassId = e.target.value;
      updateUrlParams();
      fetchRegistry();
    };
  }

  function renderDateInputs() {
    var fromInput = document.getElementById('reg-from-input');
    var toInput = document.getElementById('reg-to-input');
    if (fromInput && toInput) {
      fromInput.value = registryState.from;
      toInput.value = registryState.to;

      fromInput.onchange = function (e) {
        registryState.from = e.target.value;
        updateUrlParams();
        fetchRegistry();
      };
      toInput.onchange = function (e) {
        registryState.to = e.target.value;
        updateUrlParams();
        fetchRegistry();
      };
    }
  }

  function fetchRegistry() {
    if (!registryState.selectedClassId || !registryState.from || !registryState.to) return;
    registryState.loading = true;
    renderLoading();

    var url = '/attendance-records/registry?classId=' + encodeURIComponent(registryState.selectedClassId) +
      '&from=' + encodeURIComponent(registryState.from) +
      '&to=' + encodeURIComponent(registryState.to) +
      '&view=' + encodeURIComponent(registryState.viewMode);

    apiCall('GET', url)
      .then(function (res) {
        registryState.loading = false;
        if (!res || !res.ok) throw new Error(res.error || 'Failed to build registry');
        registryState.registryData = res.data;
        renderRegistryHeader();
        renderRegistryGrid();
      })
      .catch(function (err) {
        registryState.loading = false;
        console.error('Registry fetch error:', err);
        renderError(err.message);
      });
  }

  function renderLoading() {
    var c = document.getElementById('reg-grid-container') || document.getElementById('reg-content-area');
    if (!c) return;
    c.innerHTML = '<div style="padding:60px 20px;text-align:center;color:var(--tmu);"><div class="three-body" style="margin:0 auto 16px;"><div class="three-body__dot"></div><div class="three-body__dot"></div><div class="three-body__dot"></div></div>Generating attendance registry grid…</div>';
  }

  function renderError(msg) {
    var c = document.getElementById('reg-grid-container') || document.getElementById('reg-content-area');
    if (!c) return;
    c.innerHTML = '<div style="padding:40px 20px;text-align:center;background:#fff;border-radius:12px;border:1px solid #fee2e2;color:#991b1b;"><div style="font-size:16px;font-weight:700;margin-bottom:6px;"><re-icon icon="alert-triangle"></re-icon> Registry Generation Error</div><div style="font-size:13px;color:#7f1d1d;">' + escapeHtml(msg) + '</div></div>';
  }

  function renderRegistryHeader() {
    var c = document.getElementById('reg-header-strip');
    var data = registryState.registryData;
    if (!c || !data) return;

    var html = '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;background:#fff;border:1px solid var(--br);border-radius:12px;padding:12px 18px;margin-bottom:16px;">';

    html += '<div>';
    html += '<div style="font-size:16px;font-weight:800;color:var(--td);">' + escapeHtml(data.class.name) + ' · ' + escapeHtml(data.class.dept) + '</div>';
    html += '<div style="font-size:12px;color:var(--tmu);">Batch ' + escapeHtml(data.class.batch || '') + ' · Sem ' + escapeHtml(data.class.sem || '') + ' · Advisor: ' + escapeHtml(data.class.advisor || 'Not assigned') + '</div>';
    html += '</div>';

    // View Toggles and Exports
    html += '<div style="display:flex;align-items:center;gap:10px;">';
    html += '<div style="display:inline-flex;border:1px solid var(--br);border-radius:8px;overflow:hidden;">';
    html += '<button class="btn btn-sm" onclick="window.setRegistryView(\'periods\')" style="' + (registryState.viewMode === 'periods' ? 'background:var(--gD);color:#fff;' : 'background:#fff;color:var(--td);') + '">Period Grid</button>';
    html += '<button class="btn btn-sm" onclick="window.setRegistryView(\'days\')" style="' + (registryState.viewMode === 'days' ? 'background:var(--gD);color:#fff;' : 'background:#fff;color:var(--td);') + '">Day Summary</button>';
    html += '</div>';

    html += '<button class="btn btn-sm btn-out" onclick="window.downloadRegistryExport(\'xlsx\')"><re-icon icon="download" size="13"></re-icon> Excel (.xlsx)</button>';
    html += '<button class="btn btn-sm btn-out" onclick="window.downloadRegistryExport(\'pdf\')"><re-icon icon="download" size="13"></re-icon> PDF</button>';
    html += '<button class="btn btn-sm btn-out" onclick="window.printRegistry()"><re-icon icon="printer" size="13"></re-icon> Print</button>';
    html += '</div>';

    html += '</div>';
    c.innerHTML = html;
  }

  function renderRegistryGrid() {
    var c = document.getElementById('reg-grid-container');
    if (!c) {
      var area = document.getElementById('reg-content-area');
      if (area) {
        area.innerHTML = '<div id="reg-grid-container"></div>';
        c = document.getElementById('reg-grid-container');
      }
    }
    var data = registryState.registryData;
    if (!c || !data) return;

    var days = data.days || [];
    var periodsPerDay = data.periodsPerDay || 7;

    if (days.length === 0) {
      c.innerHTML = '<div style="padding:40px;text-align:center;color:var(--tmu);background:#fff;border-radius:12px;border:1px solid var(--br);"><div style="font-size:16px;font-weight:700;margin-bottom:6px;color:var(--td);">No Working Days in Range</div><div style="font-size:13px;">No working days were found for the selected date range (' + escapeHtml(data.range.from) + ' to ' + escapeHtml(data.range.to) + '). Sundays and scheduled holidays are excluded.</div></div>';
      return;
    }

    var students = (data.students || []).filter(function (st) {
      if (registryState.searchQuery) {
        var q = registryState.searchQuery;
        var mName = (st.name || '').toLowerCase().includes(q);
        var mReg = (st.regNo || '').toLowerCase().includes(q);
        if (!mName && !mReg) return false;
      }
      if (registryState.shortageOnly) {
        return st.totals.pct < (data.thresholds.min || 75);
      }
      return true;
    });

    if (students.length === 0) {
      c.innerHTML = '<div style="padding:40px;text-align:center;color:var(--tmu);background:#fff;border-radius:12px;border:1px solid var(--br);">No students found matching filters.</div>';
      return;
    }

    var isDayView = registryState.viewMode === 'days';
    var html = '<div class="reg-grid-wrap"><table class="reg-table">';

    // ── Header Row 1: Merged Date Bands ──
    html += '<thead><tr>';
    html += '<th rowspan="2" class="att-col-sticky-1" style="width:36px;">#</th>';
    html += '<th rowspan="2" class="att-col-sticky-2" style="width:105px;">Reg No</th>';
    html += '<th rowspan="2" class="att-col-sticky-3" style="width:150px;text-align:left;">Student Name</th>';

    days.forEach(function (day) {
      var colSpan = isDayView ? 1 : periodsPerDay;
      var ddmm = (day.date && day.date.length >= 10)
        ? (day.date.slice(8, 10) + '-' + day.date.slice(5, 7))
        : day.date;
      var dateLabel = ddmm + (day.dow ? ' · ' + day.dow : '');
      var bg = day.isHoliday ? '#f3f4f6' : '#f8fafc';
      var textCol = day.isHoliday ? '#6b7280' : '#0f172a';
      html += '<th colspan="' + colSpan + '" style="background:' + bg + ';color:' + textCol + ';font-size:10px;font-weight:700;">' + escapeHtml(dateLabel) + '</th>';
    });

    // Right-pinned Totals Header Row 1
    html += '<th colspan="4" style="background:#f1f5f9;border-left:2px solid #cbd5e1;">Totals</th>';
    html += '</tr>';

    // ── Header Row 2: Sub-columns (Period numbers or Day label) ──
    html += '<tr>';
    days.forEach(function (day) {
      if (isDayView) {
        html += '<th style="font-size:9.5px;padding:3px 6px;">Day</th>';
      } else {
        for (var p = 1; p <= periodsPerDay; p++) {
          html += '<th style="font-size:9px;width:24px;padding:2px 0;">' + p + '</th>';
        }
      }
    });

    // Totals sub-headers
    html += '<th style="font-size:10px;width:34px;background:#f8fafc;border-left:2px solid #cbd5e1;">P</th>';
    html += '<th style="font-size:10px;width:34px;background:#f8fafc;">A</th>';
    html += '<th style="font-size:10px;width:34px;background:#f8fafc;">L</th>';
    html += '<th style="font-size:10px;width:44px;background:#f8fafc;">%</th>';
    html += '</tr></thead><tbody>';

    // ── Rows ──
    students.forEach(function (st, sIdx) {
      html += '<tr>';
      html += '<td class="att-col-sticky-1" style="font-size:10px;color:var(--tmu);">' + (sIdx + 1) + '</td>';
      html += '<td class="att-col-sticky-2"><strong>' + escapeHtml(st.regNo) + '</strong></td>';
      html += '<td class="att-col-sticky-3" style="text-align:left;font-weight:500;">' + escapeHtml(st.name) + '</td>';

      if (isDayView) {
        // Day summary mode: 1 cell per day
        (st.dayCells || []).forEach(function (glyph, dIdx) {
          var dayMeta = days[dIdx];
          var cellClass = glyph === 'A' ? 'reg-cell-a' : (glyph === 'P' ? 'reg-cell-p' : (glyph === 'H' ? 'reg-cell-h' : 'reg-cell-dash'));
          html += '<td class="' + cellClass + '" style="font-weight:700;font-size:10px;">' + glyph + '</td>';
        });
      } else {
        // Classic Period Grid mode: 7-9 period cells per day
        days.forEach(function (day, dIdx) {
          var dayString = st.cells[dIdx] || '';
          for (var p = 0; p < periodsPerDay; p++) {
            var glyph = dayString[p] || '–';
            var cellClass = glyph === 'A' ? 'reg-cell-a' : (glyph === 'P' ? 'reg-cell-p' : (glyph === 'L' || glyph === 'O' ? 'reg-cell-l' : (glyph === 'H' ? 'reg-cell-h' : 'reg-cell-dash')));
            var dispGlyph = glyph === 'O' ? 'OD' : glyph;

            // Period metadata for tooltip
            var pMeta = day.periods ? day.periods[p] : null;
            var tooltipData = pMeta && pMeta.subject
              ? 'Period ' + (p + 1) + ' (' + (pMeta.method || 'Manual') + ')\nSubject: ' + pMeta.subject + '\nTeacher: ' + pMeta.teacher + '\nTopic: ' + (pMeta.topic || 'None')
              : 'Period ' + (p + 1) + ' (' + day.date + ')';

            html += '<td class="' + cellClass + ' reg-cell-interactive" data-tip="' + escapeHtml(tooltipData) + '" onclick="window.openRegistryCellInRoster(\'' + day.date + '\', ' + (p + 1) + ')">' + dispGlyph + '</td>';
          }
        });
      }

      // Totals columns
      var pctColor = st.totals.pct < (data.thresholds.low || 65)
        ? '#dc2626'
        : (st.totals.pct < (data.thresholds.min || 75) ? '#d97706' : '#16a34a');

      html += '<td style="border-left:2px solid #cbd5e1;font-weight:700;color:#16a34a;">' + st.totals.P + '</td>';
      html += '<td style="font-weight:700;color:#dc2626;">' + st.totals.A + '</td>';
      html += '<td style="font-weight:700;color:#0284c7;">' + st.totals.L + '</td>';
      html += '<td style="font-weight:800;color:' + pctColor + ';background:' + (st.totals.pct < 75 ? '#fffbeb' : '#ffffff') + ';">' + st.totals.pct + '%</td>';

      html += '</tr>';
    });

    // ── Footer Row: Class Present Counts ──
    html += '<tr style="background:#f8fafc;font-weight:800;">';
    html += '<td colspan="3" class="att-col-sticky-3" style="text-align:right;padding-right:12px;background:#f1f5f9;">Class Present</td>';

    if (isDayView) {
      days.forEach(function (day, dIdx) {
        var pct = data.footer.dayPct ? data.footer.dayPct[dIdx] : null;
        html += '<td style="font-size:10px;">' + (pct !== null ? pct + '%' : '—') + '</td>';
      });
    } else {
      var colTotals = data.footer.presentByColumn || [];
      for (var cIdx = 0; cIdx < colTotals.length; cIdx++) {
        html += '<td style="font-size:10px;padding:2px 0;">' + colTotals[cIdx] + '</td>';
      }
    }

    html += '<td colspan="4" style="border-left:2px solid #cbd5e1;background:#f1f5f9;"></td>';
    html += '</tr>';

    html += '</tbody></table></div>';

    // Legend Strip (§4.3)
    html += '<div style="display:flex;align-items:center;gap:18px;margin-top:12px;font-size:11.5px;color:var(--tmu);flex-wrap:wrap;">';
    html += '<span style="font-weight:700;color:var(--td);">Legend:</span>';
    html += '<span><strong style="color:#16a34a;">P</strong> Present</span>';
    html += '<span><span style="background:#ffff00;color:#854d0e;padding:1px 5px;border-radius:3px;font-weight:800;">A</span> Absent</span>';
    html += '<span><span style="background:#e0f2fe;color:#0369a1;padding:1px 5px;border-radius:3px;font-weight:700;">L</span> Approved Leave</span>';
    html += '<span><span style="background:#e0f2fe;color:#0369a1;padding:1px 5px;border-radius:3px;font-weight:700;">OD</span> On Duty</span>';
    html += '<span><span style="color:#94a3b8;font-weight:700;">H</span> Holiday</span>';
    html += '<span><span style="color:#cbd5e1;font-weight:700;">–</span> Not Marked</span>';
    html += '<span style="margin-left:auto;font-size:11px;">💡 Click any cell to inspect period forensics in Roster.</span>';
    html += '</div>';

    c.innerHTML = html;
    bindCellTooltips();
  }

  function bindCellTooltips() {
    var tooltipEl = document.getElementById('reg-tooltip');
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'reg-tooltip';
      document.body.appendChild(tooltipEl);
    }

    var cells = document.querySelectorAll('.reg-cell-interactive');
    cells.forEach(function (cell) {
      cell.addEventListener('mouseenter', function (e) {
        var tip = cell.getAttribute('data-tip');
        if (!tip) return;
        tooltipEl.textContent = tip;
        tooltipEl.style.display = 'block';
        tooltipEl.style.whiteSpace = 'pre-line';
        var rect = cell.getBoundingClientRect();
        tooltipEl.style.left = Math.min(window.innerWidth - 260, rect.left) + 'px';
        tooltipEl.style.top = (rect.bottom + 6) + 'px';
      });
      cell.addEventListener('mouseleave', function () {
        tooltipEl.style.display = 'none';
      });
    });
  }

  // ── Global Handlers Attached to Window ──
  window.setRegistryPreset = function (preset) {
    var range = getRangeDates(preset);
    registryState.from = range.from;
    registryState.to = range.to;
    renderDateInputs();
    updateUrlParams();
    fetchRegistry();
  };

  window.setRegistryView = function (mode) {
    registryState.viewMode = mode;
    updateUrlParams();
    renderRegistryHeader();
    renderRegistryGrid();
  };

  window.openRegistryCellInRoster = function (date, periodNum) {
    if (!registryState.selectedClassId) return;
    if (typeof nav === 'function') {
      // Transition to Roster with pre-filled state
      var classObj = (registryState.classes || []).find(function (c) {
        return String(c.id) === String(registryState.selectedClassId) ||
               String(c.trackId) === String(registryState.selectedClassId) ||
               String(c.name) === String(registryState.selectedClassId);
      });
      var classTrackId = classObj ? (classObj.trackId || classObj.name || classObj.id) : registryState.selectedClassId;
      var currentFile = window.location.pathname.split('/').pop() || 'control.html';
      window.history.pushState(null, '', currentFile + '?tab=roster&classId=' + encodeURIComponent(classTrackId) + '&date=' + encodeURIComponent(date) + '&period=' + encodeURIComponent(periodNum));
      nav('roster');
    }
  };

  window.downloadRegistryExport = function (format) {
    if (!registryState.selectedClassId || !registryState.from || !registryState.to) {
      if (typeof showToast === 'function') showToast('Please select a class and date range.', 'error');
      return;
    }

    var url = '/attendance-records/registry/export?classId=' + encodeURIComponent(registryState.selectedClassId) +
      '&from=' + encodeURIComponent(registryState.from) +
      '&to=' + encodeURIComponent(registryState.to) +
      '&format=' + encodeURIComponent(format);

    if (typeof showToast === 'function') showToast('Generating ' + format.toUpperCase() + ' export…', 'info');

    apiDownload(url)
      .then(function () {
        if (typeof showToast === 'function') showToast(format.toUpperCase() + ' download complete.', 'success');
      })
      .catch(function (err) {
        console.error('Download error:', err);
        if (typeof showToast === 'function') showToast('Export failed: ' + err.message, 'error');
      });
  };

  window.printRegistry = function () {
    window.print();
  };

  // Expose
  window.registryInit = registryInit;
  window.fetchRegistry = fetchRegistry;
})();
