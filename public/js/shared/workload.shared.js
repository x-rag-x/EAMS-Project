/**
 * EAMS Shared Faculty Workload & Schedule Component (public/js/shared/workload.shared.js)
 * Standalone reusable component embedded into Controller Hub (Principal & HOD) and Teacher Portal.
 */

(function (window) {
  'use strict';

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const PERIODS = [
    ['P1', '08:30', '09:15', 'Period 1', '8:30 AM – 9:15 AM'],
    ['P2', '09:15', '10:00', 'Period 2', '9:15 AM – 10:00 AM'],
    ['P3', '10:15', '11:00', 'Period 3', '10:15 AM – 11:00 AM'],
    ['P4', '11:00', '11:45', 'Period 4', '11:00 AM – 11:45 AM'],
    ['P5', '11:45', '12:30', 'Period 5', '11:45 AM – 12:30 PM'],
    ['P6', '12:30', '13:15', 'Period 6', '12:30 PM – 1:15 PM'],
    ['P7', '14:00', '14:45', 'Period 7', '2:00 PM – 2:45 PM'],
    ['P8', '14:45', '15:30', 'Period 8', '2:45 PM – 3:30 PM'],
    ['P9', '15:45', '16:30', 'Period 9', '3:45 PM – 4:30 PM']
  ];

  const BREAK_PERIODS = new Set();

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function format12h(timeStr) {
    if (!timeStr) return '';
    const parts = String(timeStr).trim().split(':');
    let h = parseInt(parts[0], 10);
    if (isNaN(h)) return timeStr;
    const m = parts[1] || '00';
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  }

  const WorkloadShared = {
    state: {
      containerId: 'ctrl-workload-container',
      deptSelectId: 'ctrl-workload-dept-select',
      isPrincipal: false,
      deptId: null,
      deptName: '',
      departments: [],
      teachers: [],
      entries: [],
      rawSlotSources: [],
      selectedFaculty: 'all',
      workloadTab: 'faculty', // 'faculty' | 'schedule' | 'subject'
      loading: false
    },

    getToken: function () {
      return sessionStorage.getItem('eams_token') || '';
    },

    init: async function (config = {}) {
      if (config.containerId) WorkloadShared.state.containerId = config.containerId;
      if (config.deptSelectId) WorkloadShared.state.deptSelectId = config.deptSelectId;
      if (config.isPrincipal !== undefined) WorkloadShared.state.isPrincipal = Boolean(config.isPrincipal);
      if (config.deptId !== undefined) WorkloadShared.state.deptId = config.deptId;
      if (config.deptName) WorkloadShared.state.deptName = config.deptName;

      // Global window click to close dropdown when clicked outside
      if (!window._wlDropdownDismissRegistered) {
        window.addEventListener('click', function (e) {
          if (!e.target.closest('#tt-faculty-dropdown') && !e.target.closest('#tt-faculty-selector-card')) {
            WorkloadShared.closeFacultyDropdown();
          }
        });
        window._wlDropdownDismissRegistered = true;
      }

      await WorkloadShared.fetchData();
      WorkloadShared.render();
    },

    fetchData: async function () {
      WorkloadShared.state.loading = true;
      const c = document.getElementById(WorkloadShared.state.containerId);
      if (c && !WorkloadShared.state.entries.length) {
        c.innerHTML = `
          <div style="text-align:center;padding:50px 20px;color:var(--tmu,#5a7a5a);">
            <div style="font-size:16px;font-weight:700;margin-bottom:8px;">Loading Faculty Workload &amp; Schedule…</div>
            <div style="font-size:12px;">Aggregating active class timetables and instructor course loads…</div>
          </div>`;
      }

      const token = WorkloadShared.getToken();
      const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

      try {
        let url = '/api/controller/workload?_t=' + Date.now();
        if (WorkloadShared.state.deptId) {
          url += '&deptId=' + encodeURIComponent(WorkloadShared.state.deptId);
        }

        let res = await fetch(url, { headers });
        let json = await res.json().catch(() => ({}));

        // Fallback to /api/timetable/slot-source if controller/workload not available
        if (!res.ok || !json.data) {
          let fbUrl = '/api/timetable/slot-source?env=production';
          if (WorkloadShared.state.deptId) fbUrl += '&deptId=' + encodeURIComponent(WorkloadShared.state.deptId);
          res = await fetch(fbUrl, { headers });
          json = await res.json().catch(() => ({}));
        }

        const slotSources = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
        WorkloadShared.state.rawSlotSources = slotSources;

        if (json.departments && Array.isArray(json.departments)) {
          WorkloadShared.state.departments = json.departments;
          WorkloadShared.syncDeptDropdown();
        }

        // Flatten slots to entries
        const list = [];
        const teachersSet = new Set(json.teachers || []);

        slotSources.forEach(st => {
          const clsName = st.className || 'General';
          const slots = st.slots || {};
          Object.keys(slots).forEach(key => {
            const slot = slots[key];
            if (!slot) return;
            const pStr = String(slot.period !== undefined && slot.period !== null ? slot.period : '');
            const pCode = pStr ? (pStr.startsWith('P') ? pStr : `P${pStr}`) : (key.split('_')[1] ? (key.split('_')[1].startsWith('P') ? key.split('_')[1] : `P${key.split('_')[1]}`) : 'P1');
            const teacherName = (slot.teacher || slot.teacherName || slot.staff || '').trim();
            if (teacherName) teachersSet.add(teacherName);

            list.push({
              id: slot._id || slot.id || ('slot_' + Math.random().toString(36).slice(2)),
              day: slot.day || key.split('_')[0] || 'Monday',
              period: pCode,
              duration: Number(slot.span || slot.duration || 1),
              subject: slot.subject || slot.subjectName || slot.code || '',
              teacher: teacherName,
              room: slot.room || '',
              section: clsName,
              classId: st.classId,
              type: slot.isLab ? 'Lab' : 'Theory'
            });
          });
        });

        WorkloadShared.state.entries = list;
        WorkloadShared.state.teachers = Array.from(teachersSet).filter(Boolean).sort((a, b) => a.localeCompare(b));
      } catch (err) {
        console.error('[WorkloadShared Fetch Error]:', err);
      } finally {
        WorkloadShared.state.loading = false;
      }
    },

    syncDeptDropdown: function () {
      const select = document.getElementById(WorkloadShared.state.deptSelectId);
      if (!select) return;

      if (!WorkloadShared.state.isPrincipal) {
        select.style.display = 'none';
        return;
      }

      select.style.display = 'inline-block';
      const curVal = WorkloadShared.state.deptId || '';
      select.innerHTML = '<option value="">All Departments (College-wide)</option>' +
        WorkloadShared.state.departments.map(d => {
          const sel = String(d._id) === String(curVal) ? 'selected' : '';
          return `<option value="${esc(d._id)}" ${sel}>${esc(d.name || d.code)}</option>`;
        }).join('');
    },

    setDepartment: async function (deptId) {
      WorkloadShared.state.deptId = deptId || null;
      WorkloadShared.state.selectedFaculty = 'all';
      await WorkloadShared.fetchData();
      WorkloadShared.render();
    },

    selectFaculty: function (facultyName) {
      WorkloadShared.state.selectedFaculty = facultyName || 'all';
      WorkloadShared.closeFacultyDropdown();
      WorkloadShared.render();
    },

    selectWorkloadTab: function (tab) {
      WorkloadShared.state.workloadTab = tab;
      WorkloadShared.render();
    },

    toggleFacultyDropdown: function () {
      const dd = document.getElementById('tt-faculty-dropdown');
      if (dd && dd.classList.contains('is-open')) {
        WorkloadShared.closeFacultyDropdown();
      } else {
        WorkloadShared.openFacultyDropdown();
      }
    },

    openFacultyDropdown: function () {
      const dd = document.getElementById('tt-faculty-dropdown');
      const menu = document.getElementById('tt-faculty-dropdown-menu');
      const trigger = document.getElementById('tt-faculty-dropdown-trigger');
      const searchInput = document.getElementById('tt-faculty-search-input');
      const card = document.getElementById('tt-faculty-selector-card');
      if (!dd || !menu) return;

      dd.classList.add('is-open');
      if (card) card.classList.add('dropdown-active');
      menu.style.display = 'block';
      if (trigger) trigger.setAttribute('aria-expanded', 'true');

      if (searchInput) {
        searchInput.value = '';
        WorkloadShared.filterFacultyDropdown('', searchInput);
        setTimeout(() => {
          try { searchInput.focus(); } catch (e) {}
        }, 30);
      }

      const activeItem = menu.querySelector('.tt-dropdown-item.selected');
      if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });
    },

    closeFacultyDropdown: function () {
      const dd = document.getElementById('tt-faculty-dropdown');
      const menu = document.getElementById('tt-faculty-dropdown-menu');
      const trigger = document.getElementById('tt-faculty-dropdown-trigger');
      const card = document.getElementById('tt-faculty-selector-card');
      if (dd) dd.classList.remove('is-open');
      if (menu) menu.style.display = 'none';
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      if (card) card.classList.remove('dropdown-active');
    },

    filterFacultyDropdown: function (rawQuery, inputEl) {
      const q = String(rawQuery || '').trim().toLowerCase();
      const dd = document.getElementById('tt-faculty-dropdown');
      if (!dd) return;

      const list = dd.querySelector('#tt-faculty-options-list');
      const emptyBox = dd.querySelector('#tt-faculty-dropdown-empty');
      const emptyQuerySpan = dd.querySelector('#tt-empty-faculty-query');
      const clearBtn = dd.querySelector('#tt-faculty-search-clear');
      const countText = dd.querySelector('#tt-faculty-dropdown-count-text');
      if (!list) return;

      const items = list.querySelectorAll('.tt-dropdown-item');
      let matches = 0;
      items.forEach(item => {
        const val = (item.dataset.value || '').toLowerCase();
        const text = (item.innerText || '').toLowerCase();
        const isMatch = !q || val.includes(q) || text.includes(q);
        item.style.display = isMatch ? 'flex' : 'none';
        if (isMatch) matches++;
      });

      if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';
      if (countText) {
        countText.textContent = q ? `${matches} matching faculty` : `Available Faculty (${items.length - 1})`;
      }
      if (emptyBox) {
        emptyBox.style.display = matches === 0 ? 'flex' : 'none';
        if (emptyQuerySpan) emptyQuerySpan.textContent = rawQuery;
      }
    },

    render: function () {
      const container = document.getElementById(WorkloadShared.state.containerId);
      if (!container) return;

      const entries = WorkloadShared.state.entries;
      const teachers = WorkloadShared.state.teachers;
      const selectedTeacher = WorkloadShared.state.selectedFaculty || 'all';
      const isAll = selectedTeacher === 'all';
      const currentTab = WorkloadShared.state.workloadTab;

      // Dynamic stat pills
      let statPillsHtml = '';
      if (isAll) {
        let totalH = 0;
        const sects = new Set();
        entries.forEach(e => {
          totalH += Number(e.duration || 1);
          if (e.section) sects.add(e.section);
        });
        statPillsHtml = `
          <span class="pill pri"><b>${teachers.length}</b> Faculty</span>
          <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;"><b>${totalH}</b> Total hrs/wk</span>
          <span class="pill" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">${sects.size} Section(s)</span>
          <span class="pill warn">Max: 18 hrs/wk</span>
        `;
      } else {
        const facEntries = entries.filter(e => (e.teacher || '').toLowerCase() === selectedTeacher.toLowerCase());
        let total = 0, th = 0, lb = 0;
        const sects = new Set();
        facEntries.forEach(e => {
          const dur = Number(e.duration || 1);
          total += dur;
          if (e.type === 'Lab' || (e.subject || '').toLowerCase().includes('lab')) lb += dur;
          else th += dur;
          if (e.section) sects.add(e.section);
        });
        statPillsHtml = `
          <span class="pill pri"><b>${total}</b> hrs/wk</span>
          <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;"><b>${th}h</b> Theory</span>
          <span class="pill warn"><b>${lb}h</b> Lab</span>
          <span class="pill" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">${sects.size} Section(s)</span>
        `;
      }

      // 1. Selector Card
      const selectorCardHtml = WorkloadShared.renderFacultySelectorCard(selectedTeacher, teachers, statPillsHtml);

      // 2. Sub Nav
      const isWorkloadTab = currentTab === 'faculty';
      const isScheduleTab = currentTab === 'schedule';
      const isSubjectTab = currentTab === 'subject';

      const subNavHtml = `
        <div class="report-sub-nav">
          <button type="button" class="report-sub-btn ${isWorkloadTab ? 'active' : ''}" onclick="WorkloadShared.selectWorkloadTab('faculty')">
            <re-icon icon="grid"></re-icon> Workload Distribution
          </button>
          <button type="button" class="report-sub-btn ${isScheduleTab ? 'active' : ''}" onclick="WorkloadShared.selectWorkloadTab('schedule')">
            <re-icon icon="calendar"></re-icon> Timetable Schedule
          </button>
          <button type="button" class="report-sub-btn ${isSubjectTab ? 'active' : ''}" onclick="WorkloadShared.selectWorkloadTab('subject')">
            <re-icon icon="book-open"></re-icon> Subject Distribution &amp; Ratio
          </button>
        </div>
      `;

      // 3. Tab Content
      let contentHtml = '';
      if (isSubjectTab) {
        contentHtml = WorkloadShared.renderSubjectDistribution(entries);
      } else if (isScheduleTab) {
        const teacherEntries = isAll ? entries : entries.filter(e => (e.teacher || '').toLowerCase() === selectedTeacher.toLowerCase());
        contentHtml = isAll
          ? WorkloadShared.renderAllFacultySlotsStream(teachers, entries, 'Faculty Timetable Slots Stream (Sequential Master View)')
          : WorkloadShared.renderSingleFacultyPanel(selectedTeacher, teacherEntries);
      } else {
        contentHtml = WorkloadShared.renderWorkloadDistribution(entries, selectedTeacher);
      }

      container.innerHTML = selectorCardHtml + subNavHtml + contentHtml;
    },

    renderFacultySelectorCard: function (selectedTeacher, teachers, statPillsHtml) {
      const isAll = !selectedTeacher || selectedTeacher.toLowerCase() === 'all';
      const currentFacultyLabel = isAll ? 'All Teaching Faculty' : selectedTeacher;

      return `
        <div class="tt-class-selector-card" id="tt-faculty-selector-card">
          <div class="tt-class-selector-left" onclick="event.stopPropagation(); WorkloadShared.toggleFacultyDropdown();" title="Click to search and select faculty">
            <div class="tt-class-selector-icon"><re-icon icon="users"></re-icon></div>
            <div class="tt-class-selector-details">
              <div class="tt-class-selector-label">Teaching Faculty Matrix</div>
              <div class="tt-class-selector-sub">Filter individual instructor workload, weekly schedule or view institutional overview</div>
            </div>
          </div>

          <div class="tt-class-selector-right">
            <!-- Custom Searchable Faculty Dropdown -->
            <div class="tt-custom-dropdown" id="tt-faculty-dropdown">
              <input type="hidden" id="faculty-filter" value="${esc(selectedTeacher)}">

              <div class="tt-dropdown-trigger" id="tt-faculty-dropdown-trigger" onclick="event.stopPropagation(); WorkloadShared.toggleFacultyDropdown();" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false" title="Click to search and select faculty">
                <div class="tt-dropdown-trigger-left">
                  <span class="tt-dropdown-trigger-icon">${isAll ? '<re-icon icon="users"></re-icon>' : '<re-icon icon="user"></re-icon>'}</span>
                  <span class="tt-dropdown-trigger-text" id="tt-selected-faculty-label">${esc(currentFacultyLabel)}</span>
                </div>
                <div class="tt-dropdown-trigger-right">
                  <span class="tt-dropdown-trigger-badge">${isAll ? `${teachers.length} Faculty` : 'Instructor'}</span>
                  <span class="tt-dropdown-trigger-arrow">▾</span>
                </div>
              </div>

              <div class="tt-dropdown-menu" id="tt-faculty-dropdown-menu" role="listbox" style="display:none;">
                <div class="tt-dropdown-search-box">
                  <span class="tt-dropdown-search-icon"><re-icon icon="search"></re-icon></span>
                  <input type="text" class="tt-dropdown-search-input" id="tt-faculty-search-input" oninput="WorkloadShared.filterFacultyDropdown(this.value, this)" placeholder="Search faculty by name… (e.g. Dr. Ramesh)" autocomplete="off" spellcheck="false">
                  <button type="button" class="tt-dropdown-search-clear" id="tt-faculty-search-clear" onclick="event.stopPropagation(); const si = this.closest('.tt-custom-dropdown').querySelector('.tt-dropdown-search-input'); if(si){ si.value=''; WorkloadShared.filterFacultyDropdown('', si); si.focus(); }" style="display:none;" title="Clear search"><re-icon icon="x"></re-icon></button>
                </div>

                <div class="tt-dropdown-menu-header">
                  <span class="tt-dropdown-menu-header-title" id="tt-faculty-dropdown-count-text">Available Faculty (${teachers.length})</span>
                  <span class="tt-dropdown-menu-header-hint">Click to select</span>
                </div>

                <div class="tt-dropdown-list" id="tt-faculty-options-list">
                  <!-- ALL OPTION -->
                  <div class="tt-dropdown-item ${isAll ? 'selected' : ''}" data-value="all" onclick="event.stopPropagation(); WorkloadShared.selectFaculty('all');" role="option" aria-selected="${isAll ? 'true' : 'false'}">
                    <div class="tt-dropdown-item-left">
                      <span class="tt-dropdown-item-dot" style="${isAll ? 'background:var(--gD,#1b5e20);' : ''}"></span>
                      <span class="tt-dropdown-item-text" style="font-weight:700;"><re-icon icon="users"></re-icon> All Teaching Faculty</span>
                    </div>
                    <div class="tt-dropdown-item-right">
                      <span class="tt-dropdown-item-badge">All</span>
                      <span class="tt-dropdown-item-check">${isAll ? '<re-icon icon="check"></re-icon>' : ''}</span>
                    </div>
                  </div>

                  <!-- INDIVIDUAL TEACHERS -->
                  ${teachers.map(t => {
                    const isSelected = !isAll && t.toLowerCase() === selectedTeacher.toLowerCase();
                    return `
                      <div class="tt-dropdown-item ${isSelected ? 'selected' : ''}" data-value="${esc(t)}" onclick="event.stopPropagation(); WorkloadShared.selectFaculty('${esc(t)}');" role="option" aria-selected="${isSelected ? 'true' : 'false'}">
                        <div class="tt-dropdown-item-left">
                          <span class="tt-dropdown-item-dot"></span>
                          <span class="tt-dropdown-item-text">${esc(t)}</span>
                        </div>
                        <div class="tt-dropdown-item-right">
                          ${isSelected ? '<span class="tt-dropdown-item-badge">Active</span>' : ''}
                          <span class="tt-dropdown-item-check">${isSelected ? '<re-icon icon="check"></re-icon>' : ''}</span>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>

                <div class="tt-dropdown-empty" id="tt-faculty-dropdown-empty" style="display:none;">
                  <span class="tt-dropdown-empty-icon"><re-icon icon="search"></re-icon></span>
                  <div class="tt-dropdown-empty-title">No matching faculty found</div>
                  <div class="tt-dropdown-empty-desc">No instructor matches "<span id="tt-empty-faculty-query"></span>"</div>
                </div>
              </div>
            </div>

            <!-- STAT PILLS -->
            <div class="tt-faculty-stat-pills">
              ${statPillsHtml}
            </div>
          </div>
        </div>
      `;
    },

    renderWorkloadDistribution: function (entries, selectedTeacher = 'all') {
      const isAll = !selectedTeacher || selectedTeacher.toLowerCase() === 'all';
      const facultyMap = new Map();

      entries.forEach(e => {
        const f = e.teacher || 'Unassigned';
        const dur = Number(e.duration || 1);
        const isLab = e.type === 'Lab' || (e.subject || '').toLowerCase().includes('lab');
        if (!facultyMap.has(f)) {
          facultyMap.set(f, { total: 0, theory: 0, lab: 0, sections: new Set(), subjects: new Set(), subjectDetails: new Map() });
        }
        const r = facultyMap.get(f);
        r.total += dur;
        if (isLab) r.lab += dur; else r.theory += dur;
        if (e.section) r.sections.add(e.section);
        if (e.subject) {
          r.subjects.add(e.subject);
          if (!r.subjectDetails.has(e.subject)) {
            r.subjectDetails.set(e.subject, { name: e.subject, type: e.type || (isLab ? 'Lab' : 'Theory'), hours: 0, sections: new Set() });
          }
          const sRec = r.subjectDetails.get(e.subject);
          sRec.hours += dur;
          if (e.section) sRec.sections.add(e.section);
        }
      });

      const totalFaculty = facultyMap.size;
      const totalHours = Array.from(facultyMap.values()).reduce((sum, r) => sum + r.total, 0);
      const deptAvg = totalFaculty ? (totalHours / totalFaculty).toFixed(1) : '0.0';
      const maxThreshold = 18;
      const overloadTeachers = Array.from(facultyMap.entries()).filter(([_, r]) => r.total > maxThreshold);
      const maxTeacherLoad = Math.max(0, ...Array.from(facultyMap.values()).map(r => r.total));
      const avgMarkerPercent = Math.min(100, Math.round((Number(deptAvg) / 24) * 100));

      if (!isAll) {
        const target = facultyMap.get(selectedTeacher) || {
          total: 0, theory: 0, lab: 0, sections: new Set(), subjects: new Set(), subjectDetails: new Map()
        };
        const pct = Math.min(100, Math.round((target.total / 24) * 100));
        const barClass = target.total > maxThreshold ? 'red' : (target.total >= 12 ? 'green' : 'amber');
        const subjectsList = Array.from(target.subjectDetails.values()).sort((a, b) => b.hours - a.hours);

        const singleKpis = `
          <div class="kpi-grid">
            <div class="kpi">
              <div class="kpi-label">Instructor Profile</div>
              <div class="kpi-val" style="font-size:18px"><re-icon icon="user"></re-icon> ${esc(selectedTeacher)}</div>
              <div class="kpi-sub">${target.total > maxThreshold ? '<re-icon icon="alert-triangle"></re-icon> Overload Risk' : (target.total >= 12 ? '<re-icon icon="check"></re-icon> Optimal Load' : 'Light Load')}</div>
            </div>
            <div class="kpi">
              <div class="kpi-label">Weekly Contact Hours</div>
              <div class="kpi-val" style="color:var(--td)">${target.total} <span style="font-size:13px;font-weight:500">hrs/wk</span></div>
              <div class="kpi-sub">Average: ${deptAvg} hrs/wk</div>
            </div>
            <div class="kpi">
              <div class="kpi-label">Theory vs Lab Split</div>
              <div class="kpi-val" style="color:var(--gM,#388e3c)">${target.theory}h <span style="font-size:12px;font-weight:400;color:var(--tmu)">/ ${target.lab}h lab</span></div>
              <div class="kpi-sub">${target.subjects.size} assigned course(s)</div>
            </div>
            <div class="kpi">
              <div class="kpi-label">Assigned Cohorts</div>
              <div class="kpi-val" style="color:#3b82f6">${target.sections.size} <span style="font-size:13px;font-weight:500">sections</span></div>
              <div class="kpi-sub">${Array.from(target.sections).join(', ') || 'No sections'}</div>
            </div>
          </div>
        `;

        return singleKpis + `
          <div class="panel">
            <div class="panel-head">
              <div>
                <h2>Workload Breakdown &amp; Course Load — <re-icon icon="user"></re-icon> ${esc(selectedTeacher)}</h2>
                <p>Weekly teaching allocations and class responsibilities benchmarked against 24h institutional scale.</p>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <button type="button" class="btn btn-out" onclick="event.stopPropagation(); WorkloadShared.selectFaculty('all');" style="padding:4px 12px;font-size:12px">← View All Faculty</button>
                <button type="button" class="btn btn-pri" onclick="event.stopPropagation(); WorkloadShared.selectWorkloadTab('schedule');" style="padding:4px 12px;font-size:12px"><re-icon icon="calendar"></re-icon> View Timetable Schedule Grid →</button>
              </div>
            </div>
            <div style="padding:16px 20px 8px;">
              <div style="font-size:12px;font-weight:700;color:var(--td);margin-bottom:14px;display:flex;justify-content:space-between;">
                <span>Weekly Load Benchmark: ${target.total} hrs / 24h Scale</span>
                <span style="color:var(--tmu)">Target Average: ${deptAvg} hrs/wk</span>
              </div>
              <div class="analytics-progress-wrap" style="height:12px;border-radius:6px;" title="Load: ${target.total}h / 24h max scale · Avg: ${deptAvg}h">
                <div class="analytics-progress-bar ${barClass}" style="width:${pct}%"></div>
                <div class="analytics-avg-marker" style="left:${avgMarkerPercent}%"></div>
              </div>
            </div>
            <table class="table" style="margin-top:10px;width:100%;">
              <thead>
                <tr>
                  <th style="padding:10px 16px;">Course / Subject</th>
                  <th style="padding:10px 16px;">Course Type</th>
                  <th style="padding:10px 16px;">Teaching Sections</th>
                  <th style="padding:10px 16px;">Weekly Hours</th>
                  <th style="padding:10px 16px;">Share of Faculty Load</th>
                </tr>
              </thead>
              <tbody>
                ${subjectsList.length ? subjectsList.map(s => {
                  const subPct = target.total ? Math.round((s.hours / target.total) * 100) : 0;
                  return `<tr>
                    <td style="padding:10px 16px;"><b><re-icon icon="book-open"></re-icon> ${esc(s.name)}</b></td>
                    <td style="padding:10px 16px;"><span class="pill ${s.type === 'Lab' ? 'warn' : ''}">${esc(s.type)}</span></td>
                    <td style="padding:10px 16px;"><span class="pill pri">${Array.from(s.sections).join(', ') || '—'}</span></td>
                    <td style="padding:10px 16px;"><b style="font-size:14px">${s.hours}</b> hrs/wk</td>
                    <td style="padding:10px 16px;">
                      <div style="display:flex;align-items:center;gap:8px">
                        <div class="analytics-progress-wrap" style="flex:1">
                          <div class="analytics-progress-bar green" style="width:${subPct}%"></div>
                        </div>
                        <b style="font-size:11.5px;color:var(--td);width:35px">${subPct}%</b>
                      </div>
                    </td>
                  </tr>`;
                }).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--tmu);padding:24px;">No scheduled courses found for this instructor.</td></tr>`}
              </tbody>
            </table>
          </div>
          <div style="margin-top:18px;">
            ${WorkloadShared.renderSingleFacultyPanel(selectedTeacher, entries.filter(e => (e.teacher || '').toLowerCase() === selectedTeacher.toLowerCase()))}
          </div>
        `;
      }

      // All Faculty Overview
      const kpis = `
        <div class="kpi-grid">
          <div class="kpi">
            <div class="kpi-label">Active Instructors</div>
            <div class="kpi-val">${totalFaculty}</div>
            <div class="kpi-sub">Allocated in active schedule</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Average Load</div>
            <div class="kpi-val" style="color:var(--gM,#388e3c)">${deptAvg} <span style="font-size:13px;font-weight:500">hrs/wk</span></div>
            <div class="kpi-sub">Standard benchmark: 12–16 hrs</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Peak Instructor Load</div>
            <div class="kpi-val">${maxTeacherLoad} <span style="font-size:13px;font-weight:500">hrs</span></div>
            <div class="kpi-sub">Max threshold: 18 hrs/wk</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Overload Warnings</div>
            <div class="kpi-val" style="color:${overloadTeachers.length ? '#dc2626' : '#16a34a'}">${overloadTeachers.length}</div>
            <div class="kpi-sub">${overloadTeachers.length ? 'Exceeds 18 hrs/wk' : 'All within safe limits'}</div>
          </div>
        </div>
      `;

      const facultyList = Array.from(facultyMap.keys()).filter(Boolean).sort((a, b) => a.localeCompare(b));

      return kpis + `
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>Weekly Teaching Hours by Faculty Member</h2>
              <p>Visual workload distribution benchmarked against department average (${deptAvg} hrs/wk).</p>
            </div>
          </div>
          <table class="table" style="width:100%;">
            <thead>
              <tr>
                <th style="padding:10px 16px;">Faculty Name</th>
                <th style="padding:10px 16px;">Total Hours / Wk</th>
                <th style="padding:10px 16px;">Theory Hours</th>
                <th style="padding:10px 16px;">Lab Hours</th>
                <th style="padding:10px 16px;min-width:180px">Load Benchmark (Scale: 24h)</th>
                <th style="padding:10px 16px;">Status</th>
                <th style="padding:10px 16px;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${Array.from(facultyMap.entries()).sort((a, b) => b[1].total - a[1].total).map(([name, r]) => {
                const pct = Math.min(100, Math.round((r.total / 24) * 100));
                const barClass = r.total > maxThreshold ? 'red' : (r.total >= 12 ? 'green' : 'amber');
                return `<tr>
                  <td style="padding:10px 16px;">
                    <b><re-icon icon="user"></re-icon> ${esc(name)}</b>
                    <div style="font-size:11px;color:var(--tmu);margin-top:2px">
                      ${r.subjects.size} subjects · ${Array.from(r.sections).join(', ') || 'General'}
                    </div>
                  </td>
                  <td style="padding:10px 16px;"><b style="font-size:15px;color:var(--td)">${r.total}</b> hrs/wk</td>
                  <td style="padding:10px 16px;"><span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;font-weight:600">${r.theory} hrs</span></td>
                  <td style="padding:10px 16px;"><span class="pill" style="background:#fffbeb;color:#b45309;border-color:#fde68a;font-weight:600">${r.lab} hrs</span></td>
                  <td style="padding:10px 16px;">
                    <div class="analytics-progress-wrap" title="Load: ${r.total}h / 24h max scale · Avg: ${deptAvg}h">
                      <div class="analytics-progress-bar ${barClass}" style="width:${pct}%"></div>
                      <div class="analytics-avg-marker" style="left:${avgMarkerPercent}%"></div>
                    </div>
                  </td>
                  <td style="padding:10px 16px;">
                    ${r.total > maxThreshold
                      ? `<span class="pill red" title="Exceeds maximum allowable weekly teaching load"><re-icon icon="alert-triangle"></re-icon> Overload (${r.total}h)</span>`
                      : (r.total >= 12
                        ? `<span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7">Optimal (${r.total}h)</span>`
                        : `<span class="pill" style="background:#f1f5f9;color:#475569">Light (${r.total}h)</span>`)}
                  </td>
                  <td style="padding:10px 16px;">
                    <button type="button" class="btn btn-out" onclick="event.stopPropagation(); WorkloadShared.selectFaculty('${esc(name)}');" style="padding:4px 10px;font-size:11.5px">Inspect Load →</button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` + WorkloadShared.renderAllFacultySlotsStream(facultyList, entries, 'Faculty Timetable Slots Stream (Sequential Master View)');
    },

    renderSingleFacultyPanel: function (selectedTeacher, teacherEntries) {
      return `
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>Weekly Teaching Matrix — <re-icon icon="user"></re-icon> ${esc(selectedTeacher)}</h2>
              <p>Complete weekly schedule of lectures and laboratory sessions for this instructor.</p>
            </div>
            <span class="pill pri">${teacherEntries.length} Teaching Slots</span>
          </div>
          <div class="panel-body">
            ${teacherEntries.length
              ? WorkloadShared.renderTeacherWeeklyGrid(teacherEntries)
              : `<div style="text-align:center;padding:36px;color:var(--tmu,#5a7a5a);">No slots scheduled for ${esc(selectedTeacher)} in the active dataset.</div>`}
          </div>
        </div>
      `;
    },

    renderTeacherWeeklyGrid: function (entries) {
      const starts = new Map(entries.map(x => [`${x.day}:${x.period}`, x]));
      const occupied = new Set();

      let html = `<div class="timetable-wrap">
        <table class="tt-grid">
          <thead>
            <tr>
              <th>Day / Period</th>
              ${PERIODS.map(p => `<th>
                <div class="period-head">
                  <span class="p-name">${esc(p[3] || p[0])}</span>
                  <span class="p-time">${esc(format12h(p[1]))} – ${esc(format12h(p[2]))}</span>
                </div>
              </th>`).join('')}
            </tr>
          </thead>
          <tbody>`;

      DAYS.forEach(day => {
        html += `<tr>
          <td>
            <div class="day-label">${day}</div>
            <div class="day-date">Weekly Matrix</div>
          </td>`;

        let index = 0;
        while (index < PERIODS.length) {
          const period = PERIODS[index];
          if (BREAK_PERIODS.has(period[0])) {
            html += `<td class="break-cell">BREAK</td>`;
            index += 1;
            continue;
          }

          if (occupied.has(`${day}:${period[0]}`)) {
            index += 1;
            continue;
          }

          const entry = starts.get(`${day}:${period[0]}`);
          if (entry) {
            const span = Math.max(1, Math.min(Number(entry.duration || 1), PERIODS.length - index));
            const isLab = entry.type === 'Lab' || (entry.subject || '').toLowerCase().includes('lab');

            html += `<td colspan="${span}">
              <div class="faculty-slot-card" style="${isLab ? 'border-left:3px solid #d97706;' : 'border-left:3px solid var(--gM,#388e3c);'}">
                <div class="faculty-slot-sub"><b>${esc(entry.subject)}</b></div>
                <div class="faculty-slot-meta">
                  <span class="pill pri" style="font-size:10px;padding:1px 6px;"><re-icon icon="chalkboard"></re-icon> ${esc(entry.section)}</span>
                  <span style="font-size:11px;color:var(--tmu,#5a7a5a);"><re-icon icon="pin"></re-icon> ${esc(entry.room || 'Room')}</span>
                  ${span > 1 ? `<span class="pill warn" style="font-size:9.5px;padding:1px 4px;">${span}p</span>` : ''}
                </div>
              </div>
            </td>`;

            for (let n = 0; n < span; n += 1) occupied.add(`${day}:${PERIODS[index + n]?.[0]}`);
            index += span;
            continue;
          }

          html += `<td><div style="text-align:center;color:var(--gM,#16a34a);font-size:11px;font-weight:600;opacity:0.55;"><re-icon icon="check"></re-icon> Free</div></td>`;
          index += 1;
        }
        html += '</tr>';
      });

      html += `</tbody></table></div>`;
      return html;
    },

    renderAllFacultySlotsStream: function (teachers, allSource, contextTitle = 'Faculty Timetable Slots Stream (Sequential Master View)') {
      const safeId = name => 'fac-slot-card-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');

      const facultyData = teachers.map(teacherName => {
        const facEntries = allSource.filter(e => (e.teacher || '').toLowerCase() === teacherName.toLowerCase());
        let total = 0, theory = 0, lab = 0;
        const sections = new Set();
        const rooms = new Set();
        const subjects = new Set();

        facEntries.forEach(e => {
          const dur = Number(e.duration || 1);
          total += dur;
          if (e.type === 'Lab' || (e.subject || '').toLowerCase().includes('lab')) lab += dur;
          else theory += dur;
          if (e.section) sections.add(e.section);
          if (e.room) rooms.add(e.room);
          if (e.subject) subjects.add(e.subject);
        });

        return {
          name: teacherName,
          entries: facEntries,
          total,
          theory,
          lab,
          sections: Array.from(sections),
          rooms: Array.from(rooms),
          subjects: Array.from(subjects)
        };
      });

      facultyData.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
      const totalSlotsCount = facultyData.reduce((acc, f) => acc + f.entries.length, 0);

      return `
        <div class="tt-faculty-stream-wrap">
          <div class="panel-head" style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
            <div>
              <h2 style="font-size:16px;font-weight:800;color:var(--td);display:flex;align-items:center;gap:8px;margin:0;">
                <span><re-icon icon="calendar"></re-icon> ${esc(contextTitle)}</span>
                <span class="pill pri">${teachers.length} Faculty Members</span>
              </h2>
              <p style="margin:2px 0 0;font-size:12px;color:var(--tmu,#5a7a5a);">Continuous sequential view displaying all teaching assignments across every instructor.</p>
            </div>
            <div style="font-size:12px;font-weight:600;color:var(--td);">
              Total Scheduled Slots: <b style="color:var(--gD,#1b5e20);font-size:14px;">${totalSlotsCount}</b>
            </div>
          </div>

          <!-- Quick Jump Navigation Bar -->
          <div class="tt-faculty-quick-jump-bar" role="navigation" aria-label="Quick jump to faculty schedule">
            <span style="font-size:11.5px;font-weight:700;color:var(--tmu,#5a7a5a);white-space:nowrap;margin-right:6px;display:flex;align-items:center;gap:4px;">
              <re-icon icon="arrow-down"></re-icon> Jump To:
            </span>
            ${facultyData.map(f => `
              <a href="#${safeId(f.name)}" class="tt-quick-jump-pill" onclick="event.preventDefault(); const target = document.getElementById('${safeId(f.name)}'); if(target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });">
                <re-icon icon="user"></re-icon> ${esc(f.name)}
                <span class="pill" style="font-size:10px;padding:0 5px;background:#e2e8f0;color:#334155;border:none;">${f.total}h</span>
              </a>
            `).join('')}
          </div>

          <!-- Scrollable Sequential Stream of Faculty Cards -->
          <div class="tt-faculty-stream-scrollable">
            ${facultyData.map(f => {
              const cardId = safeId(f.name);
              return `
                <div class="panel tt-faculty-stream-card" id="${cardId}">
                  <div class="panel-head" style="background:#fafdfa;border-bottom:1.5px solid rgba(27,94,32,0.12);padding:14px 18px;">
                    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                      <div class="tt-class-selector-icon" style="width:36px;height:36px;font-size:16px;">
                        <re-icon icon="user"></re-icon>
                      </div>
                      <div>
                        <div style="font-size:15px;font-weight:800;color:var(--td,#1a2e1a);display:flex;align-items:center;gap:8px;">
                          <span>${esc(f.name)}</span>
                          <span class="pill pri" style="font-size:10px;">${f.total} hrs/wk</span>
                          ${f.total > 18 ? '<span class="pill red" style="font-size:10px;"><re-icon icon="alert-triangle"></re-icon> Overload</span>' : ''}
                        </div>
                        <div style="font-size:11.5px;color:var(--tmu,#5a7a5a);margin-top:2px;">
                          ${f.subjects.length} course(s) · ${f.sections.join(', ') || 'General'} · ${f.rooms.length ? `Rooms: ${f.rooms.join(', ')}` : 'Rooms: General'}
                        </div>
                      </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                      <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;"><b>${f.theory}h</b> Theory</span>
                      <span class="pill warn"><b>${f.lab}h</b> Lab</span>
                      <button type="button" class="btn btn-out" onclick="event.stopPropagation(); WorkloadShared.selectFaculty('${esc(f.name)}');" style="padding:4px 10px;font-size:11.5px">
                        Isolate Instructor →
                      </button>
                    </div>
                  </div>

                  <div class="panel-body" style="padding:14px;">
                    ${f.entries.length
                      ? WorkloadShared.renderTeacherWeeklyGrid(f.entries)
                      : `<div style="text-align:center;padding:24px;color:var(--tmu,#5a7a5a);">No timetable slots scheduled for ${esc(f.name)}.</div>`}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    },

    renderSubjectDistribution: function (entries) {
      const subjectMap = new Map();
      entries.forEach(e => {
        const s = e.subject || 'Unassigned';
        const dur = Number(e.duration || 1);
        const isLab = e.type === 'Lab' || s.toLowerCase().includes('lab');
        if (!subjectMap.has(s)) {
          subjectMap.set(s, { total: 0, theory: 0, lab: 0, teachers: new Set(), sections: new Set() });
        }
        const r = subjectMap.get(s);
        r.total += dur;
        if (isLab) r.lab += dur; else r.theory += dur;
        if (e.teacher) r.teachers.add(e.teacher);
        if (e.section) r.sections.add(e.section);
      });

      const totalSubjects = subjectMap.size;
      const totalHours = Array.from(subjectMap.values()).reduce((sum, r) => sum + r.total, 0);
      const totalTheory = Array.from(subjectMap.values()).reduce((sum, r) => sum + r.theory, 0);
      const totalLab = Array.from(subjectMap.values()).reduce((sum, r) => sum + r.lab, 0);
      const theoryRatio = totalHours ? Math.round((totalTheory / totalHours) * 100) : 0;
      const labRatio = totalHours ? 100 - theoryRatio : 0;

      const kpis = `
        <div class="kpi-grid">
          <div class="kpi">
            <div class="kpi-label">Active Subjects</div>
            <div class="kpi-val">${totalSubjects}</div>
            <div class="kpi-sub">Taught across active schedule</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Total Teaching Hours</div>
            <div class="kpi-val">${totalHours} <span style="font-size:13px;font-weight:500">hrs</span></div>
            <div class="kpi-sub">Across all scheduled sessions</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Curriculum Balance</div>
            <div class="kpi-val" style="color:var(--gM,#388e3c)">${theoryRatio}% : ${labRatio}%</div>
            <div class="kpi-sub">Theory to Practical Ratio</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Laboratory Sessions</div>
            <div class="kpi-val" style="color:#d97706">${totalLab} <span style="font-size:13px;font-weight:500">hrs</span></div>
            <div class="kpi-sub">${totalTheory} hrs Theory</div>
          </div>
        </div>
      `;

      return kpis + `
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>Subject Hours Distribution &amp; Theory-Lab Proportion</h2>
              <p>Curriculum volume, instructors assigned, and weekly allocation share per course.</p>
            </div>
          </div>
          <table class="table" style="width:100%;">
            <thead>
              <tr>
                <th style="padding:10px 16px;">Course / Subject</th>
                <th style="padding:10px 16px;">Weekly Hours</th>
                <th style="padding:10px 16px;">Theory vs Lab Ratio</th>
                <th style="padding:10px 16px;min-width:160px">Schedule Share</th>
                <th style="padding:10px 16px;">Instructors</th>
              </tr>
            </thead>
            <tbody>
              ${Array.from(subjectMap.entries()).sort((a, b) => b[1].total - a[1].total).map(([name, r]) => {
                const sharePct = totalHours ? ((r.total / totalHours) * 100).toFixed(1) : '0.0';
                const tPct = r.total ? Math.round((r.theory / r.total) * 100) : 100;
                const lPct = 100 - tPct;
                return `<tr>
                  <td style="padding:10px 16px;">
                    <b><re-icon icon="book-open"></re-icon> ${esc(name)}</b>
                    <div style="font-size:11px;color:var(--tmu);margin-top:2px">
                      ${Array.from(r.sections).join(', ') || 'General'}
                    </div>
                  </td>
                  <td style="padding:10px 16px;"><b style="font-size:15px;color:var(--td)">${r.total}</b> hrs/wk</td>
                  <td style="padding:10px 16px;font-size:12px;">
                    <span style="color:var(--gM,#16a34a);font-weight:600">${tPct}% Theory (${r.theory}h)</span> ·
                    <span style="color:#d97706;font-weight:600">${lPct}% Lab (${r.lab}h)</span>
                  </td>
                  <td style="padding:10px 16px;">
                    <div style="display:flex;align-items:center;gap:8px">
                      <div class="analytics-progress-wrap" style="flex:1">
                        <div class="analytics-progress-bar purple" style="width:${sharePct}%"></div>
                      </div>
                      <b style="font-size:11.5px;color:var(--td);width:40px">${sharePct}%</b>
                    </div>
                  </td>
                  <td style="padding:10px 16px;font-size:12px;"><re-icon icon="user"></re-icon> ${esc(Array.from(r.teachers).join(', ') || 'Unassigned')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    },

    exportWorkloadCSV: function () {
      const entries = WorkloadShared.state.entries;
      const facultyMap = new Map();
      entries.forEach(e => {
        const f = e.teacher || 'Unassigned';
        const dur = Number(e.duration || 1);
        const isLab = e.type === 'Lab' || (e.subject || '').toLowerCase().includes('lab');
        if (!facultyMap.has(f)) facultyMap.set(f, { total: 0, theory: 0, lab: 0, sections: new Set(), subjects: new Set() });
        const r = facultyMap.get(f);
        r.total += dur;
        if (isLab) r.lab += dur; else r.theory += dur;
        if (e.section) r.sections.add(e.section);
        if (e.subject) r.subjects.add(e.subject);
      });

      const rows = [
        ['Faculty Member', 'Total Hours/Wk', 'Theory Hours', 'Lab Hours', 'Assigned Courses', 'Teaching Sections', 'Load Status']
      ];

      Array.from(facultyMap.entries()).sort((a, b) => b[1].total - a[1].total).forEach(([name, r]) => {
        const status = r.total > 18 ? 'Overload' : (r.total >= 12 ? 'Optimal' : 'Light');
        rows.push([
          `"${name.replace(/"/g, '""')}"`,
          r.total,
          r.theory,
          r.lab,
          `"${Array.from(r.subjects).join('; ').replace(/"/g, '""')}"`,
          `"${Array.from(r.sections).join('; ').replace(/"/g, '""')}"`,
          status
        ]);
      });

      const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.join(',')).join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      const dateStr = (typeof todayIST === 'function') ? todayIST() : (window.todayIST ? window.todayIST() : '');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `EAMS_Faculty_Workload_${dateStr}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  window.WorkloadShared = WorkloadShared;
})(window);
