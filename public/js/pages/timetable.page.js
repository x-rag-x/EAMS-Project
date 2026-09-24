/* EAMS Timetable Workspace — Frontend Module
 * Unified with EAMS base.css design system.
 * Zero hardcoded college branding · Pure live API architecture.
 * ?tab=dash routing · Equal slot sizing & spacing · Editable presets.
 */

// ── Master State & Data Holders (populated ONLY via API) ──

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Periods array structure: [code, start24, end24, label, time12]
let PERIODS = [
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

let SUBJECTS = [];
let TEACHERS = [];
let ROOMS = [];
let SECTIONS = [];
let BREAK_PERIODS = new Set();
let TIMING_SETS = [];
let LAYOUT_PRESETS = [];

// Master data maps (cached directly from /api/timetable/master-data)
let _masterData = { departments: [], classes: [], subjects: [], teachers: [], rooms: [] };

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => `tt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ── 12-Hour Time Formatter ──
function format12h(timeStr) {
  if (!timeStr) return '';
  const parts = String(timeStr).trim().split(':');
  let h = parseInt(parts[0], 10);
  if (isNaN(h)) return timeStr;
  const m = (parts[1] || '00').slice(0, 2);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

function timeFor(period) {
  const found = PERIODS.find(x => x[0] === period);
  return found ? `${format12h(found[1])} – ${format12h(found[2])}` : period;
}

function spanTimeFor(period, duration = 1) {
  const startIdx = PERIODS.findIndex(x => x[0] === period);
  if (startIdx < 0) return timeFor(period);
  const endIdx = Math.min(PERIODS.length - 1, startIdx + Number(duration || 1) - 1);
  return `${format12h(PERIODS[startIdx][1])} – ${format12h(PERIODS[endIdx][2])}`;
}

// ── Toast & Navigation Notifications ──
const notify = (message, type = 'info') => {
  // Any faculty double-booked notification must be rendered via black showToast
  if (type === 'black' || (typeof message === 'string' && /Faculty double-booked/i.test(message))) {
    const formatted = typeof message === 'string' && message.startsWith('❌') ? message : `❌ ${message}`;
    if (typeof showToast === 'function') return showToast(formatted, 'black');
  }
  if (type === 'saving' || type === 'success' || type === 'error' || type === 'warn') {
    if (typeof dbToast === 'function') return dbToast(message, type);
  }
  if (typeof showToast === 'function') return showToast(message, type);
  window.alert(message);
};

function goHome() {
  const user = typeof getUser === 'function' ? getUser() : null;
  if (!user) { window.location.href = 'index.html'; return; }
  if (user.role === 'admin') window.location.href = 'admin.html';
  else if (user.role === 'teacher') window.location.href = 'teacher.html';
  else window.location.href = 'index.html';
}

function updateDocumentTitle() {
  const titles = {
    production: 'Production · Timetable | EAMS',
    editor: 'Draft Editor · Timetable | EAMS',
    workload: 'Workload Analytics · Timetable | EAMS',
    faculty: 'Faculty Schedules · Timetable | EAMS',
    free: 'Free Slots Finder · Timetable | EAMS',
    rooms: 'Room Allocations · Timetable | EAMS',
    overview: 'Department Overview · Timetable | EAMS',
    exports: 'Export Center · Timetable | EAMS',
    approvals: 'Conflict & Approvals · Timetable | EAMS',
    presets: 'Layout Presets · Timetable | EAMS',
    history: 'Version History · Timetable | EAMS',
    attendance: 'Attendance Insights · Timetable | EAMS'
  };
  document.title = titles[state.view] || 'Timetable Workspace · EAMS';
}

// ── Application State ──
const state = {
  view: 'production',
  mode: 'development',
  filterSection: '',
  search: '',
  selectedId: null,
  selectedPresetId: null,
  clipboard: null,
  entries: [],
  production: [],
  dirty: false,
  generator: null,
  modalBusy: false,
  draftTemplateId: null,
  loading: true
};

// ── Multi-Level Command History (Undo / Redo) ──
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 40;

function recordHistory(actionLabel = 'Edit Timetable') {
  undoStack.push({
    label: actionLabel,
    entries: JSON.parse(JSON.stringify(state.entries))
  });
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
}

function performUndo() {
  if (!undoStack.length || state.mode !== 'development') {
    return notify('Nothing to undo.', 'info');
  }
  const currentSnapshot = {
    label: 'Current Snapshot',
    entries: JSON.parse(JSON.stringify(state.entries))
  };
  redoStack.push(currentSnapshot);
  const prev = undoStack.pop();
  state.entries = prev.entries;
  state.dirty = true;
  persistState();
  render();
  notify(`↶ Undone: ${prev.label}`, 'info');
}

function performRedo() {
  if (!redoStack.length || state.mode !== 'development') {
    return notify('Nothing to redo.', 'info');
  }
  const currentSnapshot = {
    label: 'Current Snapshot',
    entries: JSON.parse(JSON.stringify(state.entries))
  };
  undoStack.push(currentSnapshot);
  const next = redoStack.pop();
  state.entries = next.entries;
  state.dirty = true;
  persistState();
  render();
  notify(`↷ Redone: ${next.label}`, 'info');
}

const VALID_TABS = {
  dash: 'production',
  production: 'production',
  editor: 'editor',
  draft: 'editor',
  workload: 'workload',
  faculty: 'faculty',
  free: 'free',
  rooms: 'rooms',
  overview: 'overview',
  exports: 'exports',
  approvals: 'approvals',
  presets: 'presets',
  history: 'history',
  attendance: 'attendance'
};

function switchTab(viewName, updateUrl = true) {
  state.view = viewName;
  if (updateUrl && window.history.replaceState) {
    const url = new URL(window.location);
    const tabParam = viewName === 'production' ? 'dash' : viewName;
    url.searchParams.set('tab', tabParam);
    window.history.replaceState({}, '', url);
  }
  document.querySelectorAll('.sb-item[data-view]').forEach(x => x.classList.toggle('act', x.dataset.view === viewName));
  render();
}

// ── Page Loader Controller (Adapted from Admin Portal) ──
const loaderMsgEl = document.getElementById('loader-msg');
const loaderEtaEl = document.getElementById('loader-eta');

function setLoaderMsg(idx, text) {
  if (!loaderMsgEl) return;
  loaderMsgEl.classList.add('msg-fade');
  setTimeout(() => {
    loaderMsgEl.textContent = text;
    loaderMsgEl.classList.remove('msg-fade');
    for (let s = 0; s < 4; s++) {
      const dot = document.getElementById('lstep-' + s);
      if (!dot) continue;
      dot.className = 'loader-step' + (s < idx ? ' done' : s === idx ? ' active' : '');
    }
  }, 120);
}

function formatEta(ms) {
  const sec = Math.max(1, Math.round(ms / 1000));
  return sec + 's';
}

// ── Auth & Initialization ──
async function initApp() {
  setLoaderMsg(0, 'Initializing Timetable Workspace…');

  const user = typeof getUser === 'function' ? getUser() : null;

  // Read URL ?tab= query parameter
  const urlParams = new URLSearchParams(window.location.search);
  const tabParam = urlParams.get('tab') || urlParams.get('page');
  if (tabParam && VALID_TABS[tabParam]) {
    state.view = VALID_TABS[tabParam];
  }

  // Authorization check: Admin, isTimeTableCoordinator, or teacher with timetablePage / all right
  const canAccess = user && (
    user.role === 'admin' ||
    user.isTimeTableCoordinator === true ||
    (typeof hasRight === 'function' && (hasRight('timetablePage') || hasRight('all'))) ||
    (user.role === 'teacher' && user.isAdmin && user.adminRights && (user.adminRights === 'all' || (Array.isArray(user.adminRights) && (user.adminRights.includes('all') || user.adminRights.includes('timetablePage')))))
  );

  if (!canAccess) {
    const gate = document.getElementById('auth-gate');
    const loader = document.getElementById('page-loader');
    if (loader) loader.style.display = 'none';
    if (gate) gate.style.display = 'flex';
    return;
  }

  // Populate user profile info in topbar and sidebar
  const initials = ((user.firstName || user.name || user.fullName || user.username || '?')[0] + ((user.lastName || '')[0] || '')).toUpperCase() || '?';
  const displayName = user.fullName || user.name || user.username || 'User';
  const roleLabel = user.isTimeTableCoordinator
    ? `TT Coordinator · ${user.TTdeptName || user.department || ''}`.trim()
    : (user.role === 'admin' ? 'Administrator' : 'Faculty Member');

  const el = id => document.getElementById(id);
  if (el('user-name')) el('user-name').textContent = displayName;
  if (el('user-role')) el('user-role').textContent = user.role === 'admin' ? 'Admin' : (user.isTimeTableCoordinator ? 'TT Coordinator' : 'Teacher');
  if (el('user-avatar')) el('user-avatar').textContent = initials;
  if (el('topbar-avatar')) el('topbar-avatar').textContent = initials;
  if (el('topbar-name')) el('topbar-name').textContent = displayName;
  if (el('topbar-role')) el('topbar-role').textContent = user.role === 'admin' ? 'Admin' : (user.isTimeTableCoordinator ? 'Coordinator' : 'Faculty');
  if (el('ws-role')) el('ws-role').textContent = user.role === 'admin' ? 'Admin Mode' : 'Coordinator Mode';

  let _etaMs = 1000;
  const _etaTick = setInterval(() => {
    if (_etaMs <= 0) return;
    _etaMs = Math.max(0, _etaMs - 200);
    if (loaderEtaEl) {
      if (_etaMs > 0) {
        loaderEtaEl.innerHTML = `ETA: <span class="eta-time">${formatEta(_etaMs)}</span> — loading timetable schema`;
      } else {
        loaderEtaEl.innerHTML = '✔ Finalizing workspace…';
      }
    }
  }, 200);

  // Load live master data directly from API
  setLoaderMsg(1, 'Loading Academic Structure & Subjects…');
  await loadMasterData();

  setLoaderMsg(2, 'Syncing Timetable Matrix & Grid…');
  await loadState();

  setLoaderMsg(3, 'Readying Coordinator Workspace…');

  clearInterval(_etaTick);
  if (loaderEtaEl) loaderEtaEl.innerHTML = '✔ Timetable ready';

  // Hide loader, reveal workspace
  const loader = document.getElementById('page-loader');
  if (loader) {
    loader.classList.add('loader-fade');
    setTimeout(() => { loader.style.display = 'none'; }, 350);
  }
  const shell = document.getElementById('app-shell');
  if (shell) shell.style.display = 'flex';

  if (typeof flushToastQueue === 'function') flushToastQueue();

  state.loading = false;
  bindGlobal();
  updateDocumentTitle();
  render();
}

// ── API Master Data Loading ──
async function loadMasterData() {
  try {
    notify('Connecting to EAMS database…', 'saving');
    const data = await apiCall('GET', '/timetable/master-data');
    _masterData = data;

    // Extract live master data — NO HARDCODED FALLBACKS
    SUBJECTS = (data.subjects || []).map(s => s.name).filter(Boolean);
    TEACHERS = (data.teachers || []).map(t => t.fullName || t.name || t.username).filter(Boolean);
    ROOMS = (data.rooms || []).map(r => r.hallNo || r.name || ('Room ' + (r._id || '').slice(-4))).filter(Boolean);
    SECTIONS = (data.classes || []).map(c => c.name).filter(Boolean);

    if (SECTIONS.length && !state.filterSection) {
      state.filterSection = SECTIONS[0];
    }

    // Load active institutional timing set from API
    try {
      const sets = await apiCall('GET', '/timetable/timing-sets');
      TIMING_SETS = sets || [];
      applyTimingSet(TIMING_SETS);
    } catch (_) { /* retain default periods */ }

    // Load layout presets
    try {
      LAYOUT_PRESETS = await apiCall('GET', '/timetable/layout-presets');
    } catch (_) { LAYOUT_PRESETS = []; }

    notify('Timetable master data ready', 'success');
  } catch (err) {
    notify('Failed to load master data: ' + err.message, 'error');
  }
}

function applyTimingSet(sets) {
  if (!Array.isArray(sets) || !sets.length) return;
  const activeSet = sets.find(s => s.isDefault) || sets[0];
  if (!activeSet || !Array.isArray(activeSet.periods)) return;

  const parsedPeriods = [];
  const breakKeys = new Set();

  activeSet.periods.forEach((p, idx) => {
    const num = p.periodNumber !== undefined ? p.periodNumber : (p.number !== undefined ? p.number : (idx + 1));
    const isBreak = p.isBreak === true || p.type === 'break' || p.type === 'lunch' || p.type === 'tea' || p.type === 'Interval' || num === 0;
    const code = `P${num}`;

    if (isBreak || num === 0) {
      breakKeys.add(code !== 'P0' ? code : `BREAK_${p.start}`);
    } else {
      parsedPeriods.push([
        code,
        p.start,
        p.end,
        p.label || `Period ${num}`,
        `${format12h(p.start)} – ${format12h(p.end)}`
      ]);
    }
  });

  if (parsedPeriods.length) {
    PERIODS = parsedPeriods;
    BREAK_PERIODS = breakKeys;
  }
}

// ── State Loading (Production & Draft) ──
async function loadState() {
  try {
    const classId = getSelectedClassId();
    if (classId) {
      // Production live timetable
      const section = await apiCall('GET', '/timetable/section/' + classId);
      state.production = flattenSlots(section.slots || {});

      // Draft template
      const templates = await apiCall('GET', '/timetable/semester-templates?classId=' + classId + '&status=draft');
      if (templates.length) {
        state.entries = flattenGrid(templates[0].grid || []);
        state.draftTemplateId = templates[0]._id;
      } else {
        state.entries = [];
        state.draftTemplateId = null;
      }
    } else {
      state.production = [];
      state.entries = [];
      state.draftTemplateId = null;
    }
    state.dirty = false;
  } catch (err) {
    notify('Failed to load timetable: ' + err.message, 'error');
    state.entries = [];
    state.production = [];
  }
}

function flattenSlots(slotsObj) {
  const entries = [];
  if (!slotsObj || typeof slotsObj !== 'object') return entries;
  Object.keys(slotsObj).forEach(key => {
    const slot = slotsObj[key];
    if (!slot) return;
    entries.push({
      id: slot._id || slot.id || uid(),
      day: slot.day || key.split('_')[0],
      period: slot.period ? `P${slot.period}` : key.split('_')[1] || 'P1',
      duration: slot.span || 1,
      subject: slot.subject || '',
      teacher: slot.teacher || '',
      room: slot.room || '',
      section: state.filterSection,
      type: slot.isLab ? 'Lab' : 'Theory',
      status: 'published',
      comment: ''
    });
  });
  return entries;
}

function flattenGrid(gridArray) {
  if (!Array.isArray(gridArray)) return [];
  return gridArray.map(slot => ({
    id: slot._id || slot.id || uid(),
    day: slot.day || 'Monday',
    period: slot.period ? `P${slot.period}` : 'P1',
    duration: slot.span || 1,
    subject: slot.subject || '',
    teacher: slot.teacher || '',
    room: slot.room || '',
    section: state.filterSection,
    type: slot.isLab ? 'Lab' : 'Theory',
    status: 'draft',
    comment: slot.state || ''
  }));
}

function entriesToGrid(entries) {
  return entries.map(e => ({
    day: e.day,
    period: parseInt((e.period || 'P1').replace('P', ''), 10) || 1,
    subject: e.subject,
    teacher: e.teacher,
    room: e.room,
    isLab: e.type === 'Lab',
    span: Number(e.duration || 1),
    state: e.comment || ''
  }));
}

function getSelectedClassId() {
  const className = state.filterSection;
  if (!className || !_masterData.classes) return null;
  const cls = _masterData.classes.find(c => c.name === className);
  return cls ? cls._id : null;
}

// ── Server Persistence ──
async function persistState() {
  notify('Saving draft…', 'saving');
  try {
    const classId = getSelectedClassId();
    if (!classId) { notify('Select a class/section first', 'warn'); return; }

    const grid = entriesToGrid(state.entries);
    if (state.draftTemplateId) {
      await apiCall('PUT', '/timetable/semester-templates/' + state.draftTemplateId, { grid });
    } else {
      const created = await apiCall('POST', '/timetable/semester-templates', {
        classId,
        grid,
        status: 'draft'
      });
      state.draftTemplateId = created._id;
    }
    state.dirty = false;
    notify('Draft saved to database', 'success');
  } catch (err) {
    notify('Save failed: ' + err.message, 'error');
  }
}

// ── Entry Conflict Detection Engine ──
function activeEntries() {
  const source = state.mode === 'production' ? state.production : state.entries;
  return source.filter(entry =>
    (!state.filterSection || entry.section === state.filterSection) &&
    (!state.search || [entry.subject, entry.teacher, entry.room, entry.section].some(v =>
      String(v).toLowerCase().includes(state.search.toLowerCase())
    ))
  );
}

function rangeFor(entry) {
  const start = PERIODS.findIndex(x => x[0] === entry.period);
  const end = Math.min(PERIODS.length - 1, start + Number(entry.duration || 1) - 1);
  return { start, end, startTime: PERIODS[start]?.[1], endTime: PERIODS[end]?.[2] };
}

function overlaps(a, b) {
  if (a.day !== b.day) return false;
  const ar = rangeFor(a), br = rangeFor(b);
  return ar.start <= br.end && br.start <= ar.end;
}

function conflictsFor(candidate, collection = state.entries, ignoreId = null) {
  const conflicts = [];
  if (!DAYS.includes(candidate.day)) conflicts.push({ kind: 'time', message: 'Choose a valid teaching day.' });
  if (!PERIODS.some(x => x[0] === candidate.period)) conflicts.push({ kind: 'time', message: 'Choose a valid period.' });
  if (BREAK_PERIODS.has(candidate.period)) conflicts.push({ kind: 'time', message: `${candidate.period} is an institutional break period.` });
  if (!candidate.subject || !candidate.teacher || !candidate.room || !candidate.section) {
    conflicts.push({ kind: 'required', message: 'Subject, faculty, room, and section are required.' });
  }
  const duration = Number(candidate.duration || 1);
  if (!Number.isInteger(duration) || duration < 1 || duration > 3) {
    conflicts.push({ kind: 'time', message: 'Duration must be 1 to 3 consecutive periods.' });
  }
  const end = rangeFor({ ...candidate, duration });
  if (end.end >= PERIODS.length) conflicts.push({ kind: 'time', message: 'Duration extends beyond the teaching day.' });

  collection.filter(x => x.id !== ignoreId && overlaps(candidate, x)).forEach(x => {
    if (x.teacher === candidate.teacher) {
      conflicts.push({ kind: 'faculty', message: `❌ Faculty double-booked: ${candidate.teacher} on ${x.subject} (${x.section}) at ${timeFor(x.period)}.` });
    }
    if (x.room === candidate.room) {
      conflicts.push({ kind: 'room', message: `Room double-booked: ${candidate.room} on ${x.subject} (${x.section}) at ${timeFor(x.period)}.` });
    }
    if (x.section === candidate.section) {
      conflicts.push({ kind: 'section', message: `Section clash: ${candidate.section} already has ${x.subject} at ${timeFor(x.period)}.` });
    }
  });

  // Room capacity vs. class enrollment check
  if (candidate.room && candidate.section) {
    const roomObj = (_masterData.rooms || []).find(r => r.name === candidate.room);
    const classObj = (_masterData.classes || []).find(c => c.name === candidate.section);
    if (roomObj && roomObj.capacity && classObj && classObj.studentCount && classObj.studentCount > roomObj.capacity) {
      conflicts.push({
        kind: 'capacity',
        message: `Capacity warning: Room "${candidate.room}" capacity (${roomObj.capacity}) is less than class size (${classObj.studentCount} students).`
      });
    }
  }

  return conflicts;
}

function allConflicts(entries = state.entries) {
  return entries.flatMap(entry => conflictsFor(entry, entries, entry.id).map(conflict => ({ ...conflict, entry })));
}

// ── UI Helpers & KPI Cards ──
function button(text, cls = 'btn-out', id = '') {
  return `<button type="button" class="${cls}"${id ? ` id="${id}"` : ''}>${esc(text)}</button>`;
}

function heading(kicker, title, sub, actions = '') {
  return `<div class="page-heading">
    <div>
      <div class="eyebrow">${esc(kicker)}</div>
      <h1>${esc(title)}</h1>
      <p class="subtitle">${esc(sub)}</p>
    </div>
    <div class="heading-actions">${actions}</div>
  </div>`;
}

function subjectTone(subject) {
  const index = SUBJECTS.indexOf(subject);
  return `subject-color-${(index < 0 ? Math.abs([...String(subject)].reduce((a, c) => a + c.charCodeAt(0), 0)) : index) % 8}`;
}

function statusPill() {
  const count = allConflicts(state.entries).length;
  return count
    ? `<span class="pill red">⚠️ ${count} Conflict${count === 1 ? '' : 's'}</span>`
    : '<span class="pill">✓ Validated</span>';
}

function renderKpis(entries) {
  const conflicts = allConflicts(state.entries).length;
  const facultyCount = new Set(entries.map(x => x.teacher).filter(Boolean)).size;
  const roomCount = new Set(entries.map(x => x.room).filter(Boolean)).size;

  return `<div class="stats-grid">
    <div class="stat-card">
      <span class="stat-kicker">Scheduled Slots</span>
      <div class="stat-value">${entries.length}</div>
      <span class="stat-desc">${state.mode === 'production' ? 'Live published slots' : 'Draft development slots'}</span>
    </div>
    <div class="stat-card">
      <span class="stat-kicker">Faculty Active</span>
      <div class="stat-value">${facultyCount}</div>
      <span class="stat-desc">Distinct teaching staff</span>
    </div>
    <div class="stat-card">
      <span class="stat-kicker">Rooms Utilized</span>
      <div class="stat-value">${roomCount}</div>
      <span class="stat-desc">Classrooms &amp; laboratories</span>
    </div>
    <div class="stat-card">
      <span class="stat-kicker">Schedule Health</span>
      <div class="stat-value" style="color:${conflicts ? 'var(--danger,#dc2626)' : 'var(--success,#16a34a)'}">
        ${conflicts ? `${conflicts} Clash` : 'Validated'}
      </div>
      <span class="stat-desc ${conflicts ? 'warn' : 'good'}">
        ${conflicts ? '⚠️ Resolve before publishing' : '✓ Zero blocking conflicts'}
      </span>
    </div>
  </div>`;
}

function controls() {
  if (!SECTIONS.length) {
    return `<div class="filters"><span style="font-size:13px;color:var(--tmu)">No sections available in EAMS master data.</span></div>`;
  }
  const isDev = state.mode === 'development';
  return `<div class="filters">
    <select class="select" id="section-filter" style="font-weight:600">
      ${SECTIONS.map(x => `<option ${x === state.filterSection ? 'selected' : ''}>${esc(x)}</option>`).join('')}
    </select>
    <input class="select search-input" id="entry-search" placeholder="🔍 Search subject, faculty or room…" value="${esc(state.search)}">
    <button type="button" class="btn-out" id="clear-filters" style="padding:6px 16px;font-size:12px">Clear</button>
    ${isDev ? `
      <div style="display:flex;gap:6px;margin-left:auto;">
        <button type="button" class="btn-out" id="undo-btn" ${!undoStack.length ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} title="Undo last change (Ctrl+Z)" style="padding:6px 12px;font-size:11.5px">↶ Undo</button>
        <button type="button" class="btn-out" id="redo-btn" ${!redoStack.length ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} title="Redo last change (Ctrl+Y)" style="padding:6px 12px;font-size:11.5px">↷ Redo</button>
      </div>
    ` : ''}
  </div>`;
}

function grid(entries, editable) {
  const starts = new Map(entries.map(x => [`${x.day}:${x.period}`, x]));
  const occupied = new Set();

  let html = `<div class="timetable-wrap">
    <table class="tt-grid">
      <thead>
        <tr>
          <th>Day / Time</th>
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
        <div class="day-date">${state.filterSection || 'Weekly'}</div>
      </td>`;

    let index = 0;
    while (index < PERIODS.length) {
      const period = PERIODS[index];
      if (BREAK_PERIODS.has(period[0])) {
        html += `<td class="break-cell">BREAK</td>`;
        index += 1;
        continue;
      }

      const entry = starts.get(`${day}:${period[0]}`);
      if (entry) {
        const span = Math.max(1, Math.min(Number(entry.duration || 1), PERIODS.length - index));
        const conflictCount = conflictsFor(entry, entries, entry.id).length;
        const isCombined = entry.type === 'Combined' || (Array.isArray(entry.combinedWith) && entry.combinedWith.length > 0);
        const classes = `${entry.type === 'Lab' ? 'lab' : ''} ${isCombined ? 'combined' : ''} ${subjectTone(entry.subject)} ${conflictCount ? 'has-conflict' : ''}`;
        const timeDisplay = spanTimeFor(period[0], span);

        html += `<td colspan="${span}">
          <button type="button" class="slot ${classes}" data-entry-id="${entry.id}" data-day="${day}" data-period="${period[0]}" draggable="${editable ? 'true' : 'false'}" aria-label="${esc(entry.subject)} ${day}">
            <div>
              <div class="slot-subject">${esc(entry.subject)}</div>
              <div class="slot-meta">👤 ${esc(entry.teacher)}</div>
              ${isCombined ? `<div class="slot-combined" title="Combined Section">👥 ${esc([entry.section, ...(entry.combinedWith || [])].filter(Boolean).join(' + '))}</div>` : ''}
            </div>
            <div class="slot-room">
              📍 ${esc(entry.room)} · ${span > 1 ? `${span} periods` : timeDisplay}
            </div>
            ${conflictCount ? `<span class="slot-conflict">⚠️ Double-booked</span>` : ''}
          </button>
        </td>`;

        for (let n = 0; n < span; n += 1) occupied.add(`${day}:${PERIODS[index + n]?.[0]}`);
        index += span;
        continue;
      }

      html += `<td>
        <button type="button" class="slot empty ${editable ? 'slot-add' : ''}" data-day="${day}" data-period="${period[0]}" ${editable ? '' : 'disabled'} title="${editable ? 'Schedule slot' : 'Empty slot'}" aria-label="Empty ${day} ${period[0]}">
          ${editable ? '+' : ''}
        </button>
      </td>`;
      index += 1;
    }
    html += '</tr>';
  });

  return `${html}</tbody></table>
    <div class="legend">
      <span><i class="subject-color-0"></i>Theory Slots</span>
      <span><i class="purple"></i>Laboratory / Extended Span</span>
      <span><i class="red"></i>Schedule Conflicts</span>
      <span class="grid-note">${entries.length} Slots Scheduled</span>
    </div>
  </div>`;
}

function emptyState(title, message) {
  return `<div class="empty-state">
    <strong>${esc(title)}</strong>
    <p>${esc(message)}</p>
    ${state.mode === 'development' ? button('+ Add Timetable Entry', 'btn-pri', 'empty-add') : ''}
  </div>`;
}

// ── Views ──
function productionView() {
  const entries = activeEntries();
  return heading('Live Production Schedule', 'Production Timetable', 'Published timetable stored in EAMS cloud database', button('Export View (CSV)', 'btn-out', 'export-btn')) +
    `<div class="live-banner">
      <div>
        <span class="live-dot"></span>
        <b>Viewing Live Published Timetable</b> — Production is read-only. Edit drafts in Development.
      </div>
      <button type="button" class="btn-out" id="compare-draft" style="padding:6px 14px;font-size:12px">Switch to Draft Editor →</button>
    </div>` +
    controls() +
    renderKpis(entries) +
    `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>${esc(state.filterSection || 'Institutional Schedule')}</h2>
          <p>Read-only synchronized weekly matrix for teachers and students.</p>
        </div>
        <span class="pill">✓ Live Production</span>
      </div>
      <div class="panel-body">
        ${entries.length ? grid(entries, false) : emptyState('No published slots for this section', 'Switch to Development mode to build and publish a timetable for this class.')}
      </div>
    </div>`;
}

function editorView() {
  const entries = activeEntries();
  return heading('Development & Coordination', 'Timetable Draft Editor', 'Modify slots, resolve faculty clashes, and publish to production', button('+ Add Entry', 'btn-pri', 'add-entry-btn') + button('⚡ Auto-Generate', 'btn-out', 'autogen-btn') + button('Export Draft', 'btn-out', 'export-btn')) +
    `<div class="live-banner draft-banner">
      <div>
        <span>●</span>
        <b>Development Draft Workspace</b> · Real-time auto-saving to EAMS server.
        <span class="sync-state">${state.dirty ? 'Unsaved changes' : 'Synced with Cloud'}</span>
      </div>
      <div style="display:flex;gap:8px">
        <button type="button" class="btn-out" id="reset-draft" style="padding:6px 14px;font-size:12px">Reset to Production</button>
        <button type="button" class="btn-pri" id="publish-draft" style="padding:6px 16px;font-size:12px">Publish to Production 🚀</button>
      </div>
    </div>` +
    controls() +
    renderKpis(entries) +
    `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>${esc(state.filterSection || 'Select a section')}</h2>
          <p>Click slot to edit. Drag and drop to reschedule. Hold Ctrl/Cmd while dragging to copy. Click + on empty cells to allocate.</p>
        </div>
        ${statusPill()}
      </div>
      <div class="panel-body">
        ${entries.length || state.entries.length ? grid(entries, true) : emptyState('Your draft is empty', 'Click "+ Add Entry" or use "⚡ Auto-Generate" to create periods.')}
      </div>
    </div>`;
}

function listView(title, sub, entries) {
  return heading('Tabular Analytics', title, sub, button('Export Table (CSV)', 'btn-out', 'export-btn')) +
    controls() +
    `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>${entries.length} Filtered Entries</h2>
          <p>Derived in real-time from active timetable state.</p>
        </div>
        ${statusPill()}
      </div>
      ${entries.length ? `<table class="table">
        <thead>
          <tr>
            <th>Day &amp; Time (12h)</th>
            <th>Subject</th>
            <th>Teaching Faculty</th>
            <th>Section</th>
            <th>Room</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map(x => `<tr>
            <td>
              <b>${x.day}</b><br>
              <small style="font-family:'DM Mono',monospace;color:var(--tmu)">${spanTimeFor(x.period, x.duration)}</small>
            </td>
            <td><b>${esc(x.subject)}</b></td>
            <td>👤 ${esc(x.teacher)}</td>
            <td>🏫 ${esc(x.section)}</td>
            <td>📍 ${esc(x.room)}</td>
            <td><span class="pill ${x.type === 'Lab' ? 'warn' : ''}">${x.type}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>` : emptyState('No matching records', 'Adjust filters or add slots in Development mode.')}
    </div>`;
}

function dashboardView() {
  const entries = activeEntries();
  const facultyMap = new Map();
  entries.forEach(e => {
    const f = e.teacher || 'Unassigned';
    facultyMap.set(f, (facultyMap.get(f) || 0) + Number(e.duration || 1));
  });

  return heading('Workload Analytics', 'Faculty Workload Distribution', 'Computed weekly periods across active schedule', button('Export Workload', 'btn-out', 'export-btn')) +
    controls() +
    renderKpis(entries) +
    `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>Weekly Teaching Hours by Faculty</h2>
          <p>Calculated total period allocations per instructor.</p>
        </div>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Faculty Name</th>
            <th>Allocated Periods / Week</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${Array.from(facultyMap.entries()).map(([name, count]) => `<tr>
            <td><b>👤 ${esc(name)}</b></td>
            <td><b style="font-size:15px">${count}</b> periods</td>
            <td><span class="pill ${count > 18 ? 'red' : (count > 12 ? 'warn' : '')}">${count > 18 ? 'Heavy Load' : (count > 12 ? 'Standard Load' : 'Light Load')}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function otherView() {
  const entries = activeEntries();
  if (state.view === 'faculty') return listView('Faculty Schedule', 'Merged teacher schedule for the selected section', entries);
  if (state.view === 'rooms') return listView('Room Allocations', 'Room occupancy calculated from current timetable data', entries);
  if (state.view === 'overview') return listView('Department Overview', 'Complete section entries in the current dataset', state.search ? entries : state.entries);
  if (state.view === 'attendance') return heading('System Integration', 'Attendance Insights', 'Direct link to EAMS Live Attendance system', '') + emptyState('Attendance is tracked live during class sessions', 'Faculty can mark QR and biometric attendance directly from the EAMS Attendance module.');
  if (state.view === 'exports') {
    return heading('Data Export Center', 'Export Center', 'Download timetable records in CSV format or print formatted institutional schedule', button('Download Schedule (CSV)', 'btn-pri', 'export-btn') + button('🖨️ Print Schedule', 'btn-out', 'print-btn')) +
      `<div class="panel">
        <div class="panel-head">
          <div>
            <h2>Institutional Export Options</h2>
            <p>Generate academic timetable exports for accreditation, student distribution, or faculty schedules.</p>
          </div>
        </div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:14px;padding:20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:var(--gP,#f4f7f4);border:1px solid var(--br,#dfe6e1);border-radius:10px;">
            <div>
              <b style="font-size:14px;color:var(--td)">📄 Class Timetable (RFC-4180 CSV Export)</b>
              <p style="font-size:12px;color:var(--tmu);margin-top:4px;">Export raw data for ${esc(state.filterSection || 'selected class')} including 12-hour period times, faculty, classroom, and section allocations.</p>
            </div>
            <button type="button" class="btn-pri" id="export-btn" style="padding:8px 18px;">Export CSV</button>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:var(--gP,#f4f7f4);border:1px solid var(--br,#dfe6e1);border-radius:10px;">
            <div>
              <b style="font-size:14px;color:var(--td)">🖨️ Institutional Print &amp; PDF Layout</b>
              <p style="font-size:12px;color:var(--tmu);margin-top:4px;">Formatted A4 landscape grid ready for printing or saving to PDF with official EAMS institutional letterhead.</p>
            </div>
            <button type="button" class="btn-out" id="print-btn" style="padding:8px 18px;">Print Timetable</button>
          </div>
        </div>
      </div>`;
  }

  if (state.view === 'free') {
    const free = DAYS.flatMap(day =>
      PERIODS.filter(p => !BREAK_PERIODS.has(p[0]) && !entries.some(x => x.day === day && overlaps(x, { day, period: p[0], duration: 1 })))
        .map(p => ({ day, period: p[0], time12: `${format12h(p[1])} – ${format12h(p[2])}` }))
    );
    return heading('Slot Optimization', 'Free Slots Finder', 'Available periods for extra classes, tests, or remedial sessions', '') +
      controls() +
      (free.length ? `<div class="panel">
        <div class="panel-head"><h2>${free.length} Available Slots</h2><p>Unallocated periods across teaching days.</p></div>
        <table class="table">
          <thead><tr><th>Day</th><th>Period</th><th>Time (12h)</th><th>Action</th></tr></thead>
          <tbody>
            ${free.map(x => `<tr>
              <td><b>${x.day}</b></td>
              <td><span class="pill">${x.period}</span></td>
              <td style="font-family:'DM Mono',monospace">${x.time12}</td>
              <td>${state.mode === 'development' ? button('+ Schedule Here', 'btn-out', `free-${x.day}-${x.period}`) : '<span class="pill">Read-only</span>'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : emptyState('No free slots', 'The entire schedule is filled for this section.'));
  }

  if (state.view === 'approvals') {
    const clashes = allConflicts(state.entries);
    return heading('Audit & Integrity', 'Conflict & Approvals', 'Detected faculty, room, and section collisions', '') +
      (clashes.length ? `<div class="panel">
        <div class="panel-head"><h2 style="color:var(--danger,#dc2626)">⚠️ ${clashes.length} Detected Clash(es)</h2><p>Double bookings must be resolved prior to production deployment.</p></div>
        <table class="table">
          <thead><tr><th>Type</th><th>Description</th><th>Day / Period</th></tr></thead>
          <tbody>
            ${clashes.map(c => `<tr>
              <td><span class="pill red">${esc(c.kind)}</span></td>
              <td><b>${esc(c.message)}</b></td>
              <td>${esc(c.entry?.day || '—')} · ${esc(c.entry?.period || '—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : emptyState('Zero conflicts detected', 'All current draft placements comply with institutional rules.'));
  }

  // ── EDITABLE LAYOUT PRESETS ──
  if (state.view === 'presets') {
    const presets = LAYOUT_PRESETS.length ? LAYOUT_PRESETS : [
      { _id: 'default_1', name: 'Engineering Standard (Years I & IV)', description: 'Set 1 Timing with 3-period lab duration', timingSet: 'SET_1', defaultLabDuration: 3, workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] },
      { _id: 'default_2', name: 'Engineering Core (Years II & III)', description: 'Set 2 Timing with early morning break', timingSet: 'SET_2', defaultLabDuration: 3, workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] }
    ];

    return heading('Institutional Templates', 'Layout Presets', 'Standardized timetable configuration presets for departments and years', button('+ New Preset', 'btn-pri', 'add-preset-btn')) +
      `<div class="panel">
        <div class="panel-head">
          <div>
            <h2>Configured Scheduling Presets</h2>
            <p>Presets define bell timing sets, working days, and default laboratory spans.</p>
          </div>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Preset Name</th>
              <th>Timing Set</th>
              <th>Working Days</th>
              <th>Lab Duration</th>
              <th>Description</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${presets.map(p => `<tr>
              <td><b>${esc(p.name)}</b></td>
              <td><span class="pill">${esc(p.timingSet || 'SET_1')}</span></td>
              <td>${Array.isArray(p.workingDays) ? p.workingDays.slice(0, 3).join(', ') + (p.workingDays.length > 3 ? '…' : '') : 'Mon–Fri'}</td>
              <td>${esc(p.defaultLabDuration || 3)} periods</td>
              <td style="color:var(--tmu);font-size:12px">${esc(p.description || 'Standard institutional preset')}</td>
              <td>
                <div style="display:flex;gap:6px">
                  <button class="btn-out edit-preset-btn" data-preset-id="${esc(p._id)}" style="padding:4px 12px;font-size:11.5px">Edit</button>
                  <button class="btn-out delete-preset-btn" data-preset-id="${esc(p._id)}" style="padding:4px 10px;font-size:11.5px;color:var(--danger,#dc2626)">Delete</button>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  if (state.view === 'history') {
    return heading('Audit Trail', 'Version History', 'Immutable snapshots generated upon timetable publish', '') +
      `<div class="panel">
        <div class="panel-head"><h2>Publication Log</h2><p>Audit trail of deployed semester timetables.</p></div>
        <table class="table">
          <thead><tr><th>Version</th><th>Status</th><th>Class</th><th>Published Slots</th></tr></thead>
          <tbody>
            <tr>
              <td><b>v1.0 (Current)</b></td>
              <td><span class="pill">Published</span></td>
              <td>${esc(state.filterSection || 'All')}</td>
              <td>${state.production.length} slots active</td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  return productionView();
}

function viewHtml() {
  if (state.view === 'production') return productionView();
  if (state.view === 'editor') return editorView();
  if (state.view === 'workload') return dashboardView();
  return otherView();
}

// ── Rendering & Binding ──
function render() {
  const content = $('#page-content');
  if (!content) return;
  content.innerHTML = viewHtml();

  const crumb = $('#crumb-current');
  const viewTitles = {
    production: 'Production Timetable',
    editor: 'Draft Editor',
    workload: 'Workload Analytics',
    faculty: 'Faculty Schedule',
    free: 'Free Slots Finder',
    rooms: 'Room Allocations',
    overview: 'Department Overview',
    exports: 'Export Center',
    approvals: 'Conflict & Approvals',
    presets: 'Layout Presets',
    history: 'Version History',
    attendance: 'Attendance Insights'
  };
  if (crumb) {
    crumb.textContent = viewTitles[state.view] || 'Timetable';
  }

  updateDocumentTitle();
  bindView();
}

// ── Context Menu ──
function contextMenu() {
  let menu = $('#tt-context-menu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'tt-context-menu';
  menu.className = 'tt-context-menu';
  menu.innerHTML = `
    <button data-action="cut">✂ Cut</button>
    <button data-action="copy">📋 Copy</button>
    <button data-action="paste">📥 Paste</button>
    <button data-action="clear">🗑️ Clear</button>
    <button data-action="extend">⏱ Extend Span (+1)</button>
    <button data-action="comment">💬 Comment</button>
    <button data-action="conflicts">⚠️ Check Conflicts</button>
  `;
  document.body.appendChild(menu);
  return menu;
}

function hideContextMenu() {
  $('#tt-context-menu')?.classList.remove('open');
}

function showContextMenu(event, entry, target) {
  event.preventDefault();
  const menu = contextMenu();
  menu.dataset.day = target.day;
  menu.dataset.period = target.period;
  menu.dataset.entryId = entry?.id || '';

  menu.querySelector('[data-action="paste"]').disabled = !state.clipboard;
  menu.querySelector('[data-action="clear"]').disabled = !entry;
  menu.querySelector('[data-action="cut"]').disabled = !entry;
  menu.querySelector('[data-action="copy"]').disabled = !entry;
  menu.querySelector('[data-action="extend"]').disabled = !entry;

  menu.style.left = `${Math.min(event.clientX, window.innerWidth - 190)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - 300)}px`;
  menu.classList.add('open');
}

async function contextAction(action, menu) {
  const day = menu.dataset.day, period = menu.dataset.period, id = menu.dataset.entryId;
  const entry = state.entries.find(x => x.id === id);

  if (action === 'copy' && entry) {
    state.clipboard = { ...entry, id: null };
    notify('Entry copied. Right-click target cell and choose Paste.', 'success');
  }
  if (action === 'cut' && entry) {
    recordHistory(`Cut ${entry.subject}`);
    state.clipboard = { ...entry, id: null };
    state.entries = state.entries.filter(x => x.id !== id);
    state.dirty = true;
    persistState();
    render();
    notify('Entry cut. Choose Paste on target cell.', 'success');
  }
  if (action === 'clear' && entry) await deleteEntry(id);
  if (action === 'extend' && entry) {
    const candidate = { ...entry, duration: Number(entry.duration || 1) + 1 };
    const errors = conflictsFor(candidate, state.entries, entry.id);
    if (!errors.length) {
      recordHistory(`Extend span of ${entry.subject}`);
      state.entries = state.entries.map(x => x.id === entry.id ? candidate : x);
      state.dirty = true;
      persistState();
      render();
      notify('Span extended by one period.', 'success');
    } else {
      const fac = errors.find(x => x.kind === 'faculty' || /Faculty double-booked/i.test(x.message));
      if (fac) {
        const msg = fac.message.startsWith('❌') ? fac.message : `❌ ${fac.message}`;
        if (typeof showToast === 'function') showToast(msg, 'black');
        else notify(msg, 'black');
      } else {
        notify(errors[0]?.message || 'Cannot extend span.', 'error');
      }
    }
  }
  if (action === 'comment' && entry) {
    const comment = await promptCommentModal({
      label: 'Comment for this timetable slot:',
      subtitle: `${entry.subject} · ${entry.day} ${entry.period} (${entry.section})`,
      value: entry.comment || ''
    });
    if (comment !== null) {
      entry.comment = comment;
      state.dirty = true;
      persistState();
      notify('Comment saved.', 'success');
    }
  }
  if (action === 'conflicts' && entry) {
    const errors = conflictsFor(entry, state.entries, entry.id);
    if (errors.length) {
      const fac = errors.find(x => x.kind === 'faculty' || /Faculty double-booked/i.test(x.message));
      if (fac) {
        const msg = fac.message.startsWith('❌') ? fac.message : `❌ ${fac.message}`;
        if (typeof showToast === 'function') showToast(msg, 'black');
        else notify(msg, 'black');
      } else {
        notify(errors.map(x => x.message).join('; '), 'error');
      }
    } else {
      notify('No conflicts for this slot.', 'success');
    }
  }
  if (action === 'paste' && state.clipboard) {
    const candidate = { ...state.clipboard, id: uid(), day, period, section: state.filterSection || state.clipboard.section };
    const errors = conflictsFor(candidate, state.entries);
    if (errors.length) {
      const fac = errors.find(x => x.kind === 'faculty' || /Faculty double-booked/i.test(x.message));
      if (fac) {
        const msg = fac.message.startsWith('❌') ? fac.message : `❌ ${fac.message}`;
        if (typeof showToast === 'function') showToast(msg, 'black');
        else notify(msg, 'black');
      } else {
        notify(errors.map(x => x.message).join('; '), 'error');
      }
    } else {
      recordHistory(`Paste ${candidate.subject}`);
      state.entries.push(candidate);
      state.dirty = true;
      persistState();
      render();
      notify('Entry pasted.', 'success');
    }
  }
  hideContextMenu();
}

// ── Modal Field Builders (with 12-hour labels & no Pundefined) ──
function field(name, label, value, options = []) {
  if (options.length) {
    return `<label>
      ${esc(label)}
      <select id="entry-${name}" name="${name}">
        <option value="">Select ${esc(label.toLowerCase())}</option>
        ${options.map(x => {
          const val = typeof x === 'object' ? x.value : x;
          const text = typeof x === 'object' ? x.text : x;
          return `<option value="${esc(val)}" ${String(val) === String(value) ? 'selected' : ''}>${esc(text)}</option>`;
        }).join('')}
      </select>
      <span class="field-error" data-error="${name}"></span>
    </label>`;
  }
  return `<label>
    ${esc(label)}
    <input id="entry-${name}" name="${name}" value="${esc(value || '')}" autocomplete="off">
    <span class="field-error" data-error="${name}"></span>
  </label>`;
}

function openEntryModal(entry = null, preset = {}) {
  if (state.modalBusy) return;
  state.selectedId = entry?.id || null;
  const current = entry || {
    day: preset.day || 'Monday',
    period: preset.period || (PERIODS[0]?.[0] || 'P1'),
    duration: 1,
    subject: '',
    teacher: '',
    room: '',
    section: state.filterSection,
    type: 'Theory',
    comment: ''
  };

  const modal = $('#slot-modal');
  if (!modal) return;
  modal.querySelector('#modal-title').textContent = entry ? 'Edit Timetable Entry' : 'Add Timetable Entry';

  // Format period options with full 12-hour times
  const periodOptions = PERIODS.map(p => ({
    value: p[0],
    text: `${p[3] || p[0]} (${format12h(p[1])} – ${format12h(p[2])})`
  }));

  const activeCombined = Array.isArray(current.combinedWith) ? current.combinedWith : [];

  modal.querySelector('.form-grid').innerHTML =
    field('day', 'Day', current.day, DAYS) +
    field('period', 'Start Period', current.period, periodOptions) +
    field('duration', 'Duration (Periods)', current.duration) +
    field('subject', 'Subject', current.subject, SUBJECTS) +
    field('teacher', 'Teaching Faculty', current.teacher, TEACHERS) +
    field('room', 'Classroom / Lab', current.room, ROOMS) +
    field('section', 'Class / Section', current.section, SECTIONS) +
    field('type', 'Class Type', current.type, ['Theory', 'Lab', 'Combined']) +
    `<div id="combined-chip-group" style="${current.type === 'Combined' ? 'grid-column: span 2;' : 'display:none; grid-column: span 2;'}">
      <label style="font-size:11px;font-weight:700;color:var(--tmu);margin-bottom:6px;display:block">
        Combined Participating Sections (Click to toggle)
      </label>
      <div id="combined-chips" style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0 10px;">
        ${SECTIONS.filter(s => s !== current.section).map(sec => {
          const isSelected = activeCombined.includes(sec);
          return `<button type="button" class="chip-btn ${isSelected ? 'selected' : ''}" data-section="${esc(sec)}">
            ${esc(sec)} <span class="chip-check">${isSelected ? '✓' : '+'}</span>
          </button>`;
        }).join('')}
      </div>
    </div>` +
    field('comment', 'Notes / Comment', current.comment || '');

  // Toggle combined section selector on type change
  const typeSelect = modal.querySelector('#entry-type');
  const chipGroup = modal.querySelector('#combined-chip-group');
  typeSelect?.addEventListener('change', e => {
    if (chipGroup) {
      chipGroup.style.display = e.target.value === 'Combined' ? 'block' : 'none';
      if (e.target.value === 'Combined') chipGroup.style.gridColumn = 'span 2';
    }
  });

  // Toggle chip selection
  modal.querySelectorAll('.chip-btn').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      const isSel = chip.classList.contains('selected');
      const checkSpan = chip.querySelector('.chip-check');
      if (checkSpan) checkSpan.textContent = isSel ? '✓' : '+';
    });
  });

  modal.querySelector('#delete-slot').style.display = entry ? 'inline-flex' : 'none';
  modal.querySelector('#copy-slot').style.display = entry ? 'inline-flex' : 'none';
  modal.classList.add('open');
  setTimeout(() => modal.querySelector('select, input')?.focus(), 0);
}

function closeModal() {
  $('#slot-modal')?.classList.remove('open');
  state.selectedId = null;
}

function readModal() {
  const form = $('#slot-modal');
  const value = name => form.querySelector(`[name="${name}"]`)?.value.trim();
  const combinedWith = Array.from(form.querySelectorAll('#combined-chips .chip-btn.selected'))
    .map(el => el.dataset.section)
    .filter(Boolean);

  return {
    id: state.selectedId || uid(),
    day: value('day'),
    period: value('period'),
    duration: Number(value('duration') || 1),
    subject: value('subject'),
    teacher: value('teacher'),
    room: value('room'),
    section: value('section'),
    type: value('type'),
    combinedWith,
    comment: value('comment'),
    academicYear: '',
    semester: '',
    status: 'draft'
  };
}

function showValidation(conflicts) {
  document.querySelectorAll('.field-error').forEach(x => { x.textContent = ''; });
  if (!conflicts.length) return true;

  // Faculty double-booked conflict must display in sleek black showToast
  const facultyConflict = conflicts.find(x => x.kind === 'faculty' || /Faculty double-booked/i.test(x.message));
  if (facultyConflict) {
    const msg = facultyConflict.message.startsWith('❌') ? facultyConflict.message : `❌ ${facultyConflict.message}`;
    if (typeof showToast === 'function') {
      showToast(msg, 'black');
    } else {
      notify(msg, 'black');
    }
    return false;
  }

  notify(conflicts.map(x => x.message).join('; '), 'error');
  return false;
}

// ── Pop Modals (Confirm & Comment Dialogs) ──
let _confirmResolver = null;
let _commentResolver = null;

function confirmModal(opts = {}) {
  return new Promise(resolve => {
    _confirmResolver = resolve;
    const modal = $('#confirm-modal');
    if (!modal) {
      resolve(window.confirm(opts.message || 'Are you sure?'));
      return;
    }

    const titleEl = $('#confirm-modal-title');
    const eyebrowEl = $('#confirm-modal-eyebrow');
    const msgEl = $('#confirm-modal-message');
    const hintEl = $('#confirm-modal-hint');
    const iconEl = $('#confirm-modal-icon');
    const btnAccept = $('#accept-confirm-btn');

    if (titleEl) titleEl.textContent = opts.title || 'Confirm Action';
    if (eyebrowEl) eyebrowEl.textContent = opts.eyebrow || 'CONFIRMATION';
    if (msgEl) msgEl.textContent = opts.message || 'Are you sure you want to proceed?';
    if (hintEl) {
      hintEl.textContent = opts.hint || '';
      hintEl.style.display = opts.hint ? 'block' : 'none';
    }
    if (iconEl) iconEl.textContent = opts.icon || (opts.danger ? '🗑️' : '⚠️');

    if (btnAccept) {
      btnAccept.textContent = opts.confirmText || (opts.danger ? 'Delete' : 'Confirm');
      if (opts.danger) {
        btnAccept.className = 'btn-pri';
        btnAccept.style.background = '#dc2626';
        btnAccept.style.borderColor = '#dc2626';
        btnAccept.style.color = '#ffffff';
      } else {
        btnAccept.className = opts.confirmClass || 'btn-pri';
        btnAccept.style.background = '';
        btnAccept.style.borderColor = '';
        btnAccept.style.color = '';
      }
    }

    modal.classList.add('open');
    btnAccept?.focus();
  });
}

function closeConfirmModal(result = false) {
  const modal = $('#confirm-modal');
  if (modal) modal.classList.remove('open');
  if (_confirmResolver) {
    const fn = _confirmResolver;
    _confirmResolver = null;
    fn(result);
  }
}

function promptCommentModal(opts = {}) {
  return new Promise(resolve => {
    _commentResolver = resolve;
    const modal = $('#comment-modal');
    if (!modal) {
      resolve(window.prompt(opts.label || 'Comment for this timetable slot:', opts.value || ''));
      return;
    }

    const labelEl = $('#comment-modal-label');
    const subEl = $('#comment-modal-sub');
    const inputEl = $('#slot-comment-input');

    if (labelEl) labelEl.textContent = opts.label || 'Comment for this timetable slot:';
    if (subEl) subEl.textContent = opts.subtitle || 'Add remarks, lab requirements, or substitute instructions.';
    if (inputEl) {
      inputEl.value = opts.value || '';
      inputEl.placeholder = opts.placeholder || 'e.g. Special lab session, guest lecture, bring laptops…';
    }

    modal.classList.add('open');
    setTimeout(() => {
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
      }
    }, 50);
  });
}

function closeCommentModal(result = null) {
  const modal = $('#comment-modal');
  if (modal) modal.classList.remove('open');
  if (_commentResolver) {
    const fn = _commentResolver;
    _commentResolver = null;
    fn(result);
  }
}

// ── Preset Modal Handlers ──
function openPresetModal(preset = null) {
  state.selectedPresetId = preset ? (preset._id || preset.id) : null;
  const modal = $('#preset-modal');
  if (!modal) return;

  const current = preset || {
    name: '',
    description: '',
    timingSet: 'SET_1',
    defaultLabDuration: 3,
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  };

  modal.querySelector('#preset-modal-title').textContent = preset ? 'Edit Layout Preset' : 'New Layout Preset';
  modal.querySelector('#preset-form-grid').innerHTML = `
    <label style="grid-column:1/-1">
      Preset Name
      <input id="preset-name" value="${esc(current.name)}" placeholder="e.g. Engineering Standard" required>
    </label>
    <label style="grid-column:1/-1">
      Description
      <input id="preset-desc" value="${esc(current.description || '')}" placeholder="Brief summary of bell timings and rules">
    </label>
    <label>
      Timing Set
      <select id="preset-timing-set">
        ${TIMING_SETS.map(ts => `<option value="${esc(ts.code || ts.name)}" ${(ts.code || ts.name) === current.timingSet ? 'selected' : ''}>${esc(ts.name || ts.code)}</option>`).join('')}
      </select>
    </label>
    <label>
      Default Lab Duration (Periods)
      <input id="preset-lab-dur" type="number" min="1" max="4" value="${Number(current.defaultLabDuration || 3)}">
    </label>
    <label style="grid-column:1/-1">
      Teaching Days
      <select id="preset-days">
        <option value="5">Monday to Friday (5 Days)</option>
        <option value="6" ${Array.isArray(current.workingDays) && current.workingDays.length === 6 ? 'selected' : ''}>Monday to Saturday (6 Days)</option>
      </select>
    </label>
  `;

  modal.classList.add('open');
}

function closePresetModal() {
  $('#preset-modal')?.classList.remove('open');
  state.selectedPresetId = null;
}

async function savePreset() {
  const name = $('#preset-name')?.value.trim();
  if (!name) return notify('Preset name is required', 'warn');

  const desc = $('#preset-desc')?.value.trim() || '';
  const timingSet = $('#preset-timing-set')?.value || 'SET_1';
  const labDur = parseInt($('#preset-lab-dur')?.value, 10) || 3;
  const daysChoice = $('#preset-days')?.value;
  const workingDays = daysChoice === '6'
    ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  const payload = {
    name,
    description: desc,
    timingSet,
    defaultLabDuration: labDur,
    workingDays
  };

  notify('Saving preset…', 'saving');
  try {
    if (state.selectedPresetId && !state.selectedPresetId.startsWith('default_')) {
      await apiCall('PUT', '/timetable/layout-presets/' + state.selectedPresetId, payload);
    } else {
      await apiCall('POST', '/timetable/layout-presets', payload);
    }
    // Reload presets
    LAYOUT_PRESETS = await apiCall('GET', '/timetable/layout-presets');
    closePresetModal();
    render();
    notify('Layout preset saved successfully.', 'success');
  } catch (err) {
    notify('Save failed: ' + err.message, 'error');
  }
}

async function deletePreset(id) {
  const confirmed = await confirmModal({
    title: 'Delete Layout Preset',
    eyebrow: 'DELETE PRESET',
    message: 'Delete this layout preset?',
    hint: 'This layout preset will be permanently removed from the database.',
    confirmText: 'Delete Preset',
    danger: true
  });
  if (!confirmed) return;
  notify('Deleting preset…', 'saving');
  try {
    await apiCall('DELETE', '/timetable/layout-presets/' + id);
    LAYOUT_PRESETS = await apiCall('GET', '/timetable/layout-presets');
    render();
    notify('Preset deleted.', 'success');
  } catch (err) {
    notify('Delete failed: ' + err.message, 'error');
  }
}

// ── CRUD Operations ──
async function saveEntry() {
  if (state.modalBusy) return;
  const candidate = readModal();

  const clientConflicts = conflictsFor(candidate, state.entries, state.selectedId);
  if (!showValidation(clientConflicts)) return;

  state.modalBusy = true;
  notify('Validating with database…', 'saving');
  try {
    const classId = getSelectedClassId();
    if (classId) {
      const serverCheck = await apiCall('POST', '/timetable/check-conflicts', {
        slots: [entriesToGrid([candidate])[0]],
        ignoreId: state.draftTemplateId,
        classId
      });
      if (serverCheck.conflicts && serverCheck.conflicts.length) {
        const fac = serverCheck.conflicts.find(c => c.kind === 'faculty' || /Faculty double-booked|Faculty conflict/i.test(c.message));
        if (fac) {
          let msg = fac.message.replace(/^Faculty conflict:\s*/i, 'Faculty double-booked: ');
          if (!msg.startsWith('❌')) msg = `❌ ${msg}`;
          if (typeof showToast === 'function') showToast(msg, 'black');
          else notify(msg, 'black');
        } else {
          notify('Database Conflict: ' + serverCheck.conflicts.map(c => c.message).join('; '), 'error');
        }
        state.modalBusy = false;
        return;
      }
    }

    const index = state.entries.findIndex(x => x.id === candidate.id);
    recordHistory(index >= 0 ? `Update ${candidate.subject}` : `Add ${candidate.subject}`);
    if (index >= 0) state.entries[index] = candidate;
    else state.entries.push(candidate);
    state.dirty = true;
    await persistState();
    closeModal();
    render();
    notify(index >= 0 ? 'Timetable entry updated.' : 'Timetable entry saved to draft.', 'success');
  } catch (err) {
    notify('Save failed: ' + err.message, 'error');
  }
  state.modalBusy = false;
}

async function deleteEntry(id) {
  const entry = state.entries.find(x => x.id === id);
  if (!entry) return notify('Entry no longer exists.', 'warn');
  
  const confirmed = await confirmModal({
    title: 'Delete Timetable Slot',
    eyebrow: 'DELETE CONFIRMATION',
    message: `Delete ${entry.subject} on ${entry.day} ${entry.period}?`,
    hint: 'This slot will be removed from your timetable draft.',
    confirmText: 'Delete Slot',
    danger: true
  });
  if (!confirmed) return;

  recordHistory(`Delete ${entry.subject}`);
  state.entries = state.entries.filter(x => x.id !== id);
  state.dirty = true;
  notify('Deleting entry…', 'saving');
  await persistState();
  closeModal();
  render();
  notify('Timetable entry deleted.', 'success');
}

function copyEntry(entry) {
  openEntryModal({ ...entry, id: null, day: DAYS[(DAYS.indexOf(entry.day) + 1) % DAYS.length] });
}

// ── CSV Export ──
function exportCurrent() {
  const entries = activeEntries();
  if (!entries.length) return notify('No timetable records to export.', 'warn');

  const header = ['Day', 'Period', '12h Time', 'Duration', 'Subject', 'Faculty', 'Room', 'Section', 'Type'];
  const csvRows = [header];

  entries.forEach(x => {
    csvRows.push([
      x.day,
      x.period,
      spanTimeFor(x.period, x.duration),
      x.duration,
      x.subject,
      x.teacher,
      x.room,
      x.section,
      x.type
    ].map(val => `"${String(val ?? '').replace(/"/g, '""')}"`));
  });

  const csv = csvRows.map(r => r.join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `EAMS-Timetable-${state.filterSection || 'All'}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  notify(`${entries.length} timetable records exported to CSV.`, 'success');
}

// ── Publish & Reset ──
async function publishDraft() {
  const conflicts = allConflicts(state.entries);
  if (conflicts.length) {
    return notify(`Cannot publish: Resolve ${conflicts.length} conflict(s) first.`, 'error');
  }
  if (!state.draftTemplateId) return notify('No draft exists to publish. Create entries first.', 'warn');
  const confirmed = await confirmModal({
    title: 'Publish Production Timetable',
    eyebrow: 'PRODUCTION DEPLOYMENT',
    icon: '🚀',
    message: 'Deploy this timetable draft to live EAMS production?',
    hint: 'This will update the institutional schedule for all students and faculty.',
    confirmText: 'Publish Live',
    confirmClass: 'btn-pri'
  });
  if (!confirmed) return;

  notify('Publishing to production database…', 'saving');
  try {
    await apiCall('POST', '/timetable/semester-templates/' + state.draftTemplateId + '/publish', {
      changeSummary: 'Published from Development Workspace'
    });
    await loadState();
    state.mode = 'production';
    state.view = 'production';
    document.querySelectorAll('.mode').forEach((x, i) => x.classList.toggle('active', i === 1));
    render();
    notify('Successfully published to live production database!', 'success');
  } catch (err) {
    notify('Publish failed: ' + err.message, 'error');
  }
}

async function resetDraft() {
  const confirmed = await confirmModal({
    title: 'Reset Timetable Draft',
    eyebrow: 'RESET DRAFT',
    icon: '🔄',
    message: 'Reset the current draft to match the published production schedule?',
    hint: 'Any unsaved draft changes will be discarded and replaced with the active production snapshot.',
    confirmText: 'Reset Draft',
    danger: true
  });
  if (!confirmed) return;
  recordHistory('Reset to Production');
  state.entries = state.production.map(x => ({ ...x, status: 'draft', id: uid() }));
  state.dirty = true;
  await persistState();
  render();
  notify('Draft reset to production snapshot.', 'info');
}

// ── Greedy Auto-Generator (Pure Live Data) ──
function generateDraft() {
  if (!SUBJECTS.length || !TEACHERS.length) {
    return notify('Master data empty: Add subjects and teachers to EAMS database first.', 'warn');
  }

  const generated = [];
  const failures = [];
  const subjectsToPlace = SUBJECTS.slice(0, 6);

  subjectsToPlace.forEach((subject, i) => {
    const isLab = subject.toLowerCase().includes('lab');
    const job = {
      subject,
      teacher: TEACHERS[i % TEACHERS.length] || 'Faculty Member',
      room: ROOMS[i % ROOMS.length] || 'Classroom',
      section: state.filterSection,
      type: isLab ? 'Lab' : 'Theory',
      duration: isLab ? 3 : 1
    };

    let placed = null;
    for (const day of DAYS.slice(0, 5)) {
      for (const p of PERIODS.map(x => x[0])) {
        const candidate = { ...job, id: uid(), day, period: p };
        if (!BREAK_PERIODS.has(p) && !conflictsFor(candidate, [...state.entries, ...generated]).length) {
          placed = candidate;
          break;
        }
      }
      if (placed) break;
    }
    if (placed) generated.push(placed);
    else failures.push(subject);
  });

  state.generator = { generated, failures };
  openGeneratorPreview();
}

function openGeneratorPreview() {
  const g = state.generator;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-bg open';
  backdrop.id = 'generator-review';
  backdrop.innerHTML = `<div class="modal modal-lg">
    <div class="modal-hd">
      <div>
        <div class="modal-eyebrow">AUTO-GENERATION PREVIEW</div>
        <h2 class="modal-title">Generated Timetable Draft</h2>
        <div class="modal-sub">${g.generated.length} slots placed without conflicts. Review before applying to draft.</div>
      </div>
      <button type="button" class="modal-close close-generator">×</button>
    </div>
    <div class="modal-body" style="padding:10px 0">
      ${g.failures.length ? `<div style="color:var(--danger,#dc2626);font-size:12.5px;margin-bottom:12px;font-weight:600">Could not place: ${g.failures.map(esc).join(', ')} (Room/Faculty fully booked)</div>` : '<div style="color:var(--success,#16a34a);font-size:12.5px;margin-bottom:12px;font-weight:600">✓ All candidate subjects successfully allocated.</div>'}
      <div style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:8px">
        ${g.generated.map(x => `<div style="display:flex;justify-content:space-between;padding:8px 14px;border-radius:10px;background:var(--gP,#f4f7f4);border:1px solid var(--br);font-size:12.5px">
          <b>${esc(x.day)} · ${esc(timeFor(x.period))}</b>
          <span>${esc(x.subject)} (👤 ${esc(x.teacher)} · 📍 ${esc(x.room)})</span>
        </div>`).join('')}
      </div>
    </div>
    <div class="modal-ft">
      <button type="button" class="btn-out" id="cancel-generator">Cancel</button>
      <button type="button" class="btn-pri" id="apply-generator">Apply to Draft (${g.generated.length} slots)</button>
    </div>
  </div>`;

  document.body.appendChild(backdrop);
  backdrop.querySelector('.close-generator').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('#cancel-generator').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('#apply-generator').addEventListener('click', async () => {
    recordHistory(`Auto-generate ${g.generated.length} slots`);
    state.entries = [...state.entries, ...g.generated];
    state.dirty = true;
    await persistState();
    backdrop.remove();
    render();
    notify('Generated slots added to draft.', 'success');
  });
}

// ── Drag & Drop Rescheduling ──
function moveEntryTo(id, day, period, copy) {
  if (state.mode !== 'development') return notify('Production is read-only. Switch to Development to edit.', 'warn');
  const source = state.entries.find(x => x.id === id);
  if (!source) return notify('Entry no longer exists.', 'warn');

  const candidate = { ...source, id: copy ? uid() : source.id, day, period, section: state.filterSection || source.section };
  const errors = conflictsFor(candidate, state.entries, copy ? null : source.id);
  if (errors.length) {
    const fac = errors.find(x => x.kind === 'faculty' || /Faculty double-booked/i.test(x.message));
    if (fac) {
      const msg = fac.message.startsWith('❌') ? fac.message : `❌ ${fac.message}`;
      if (typeof showToast === 'function') showToast(msg, 'black');
      else notify(msg, 'black');
      return;
    }
    return notify(errors.map(x => x.message).join('; '), 'error');
  }

  recordHistory(copy ? `Duplicate ${source.subject}` : `Move ${source.subject}`);
  if (copy) state.entries.push(candidate);
  else state.entries = state.entries.map(x => x.id === source.id ? candidate : x);

  state.dirty = true;
  persistState();
  render();
  notify(copy ? 'Entry duplicated to new slot.' : 'Entry relocated.', 'success');
}

function bindDragDrop() {
  document.querySelectorAll('.slot[data-entry-id]').forEach(node => {
    node.addEventListener('dragstart', event => {
      if (state.mode !== 'development') { event.preventDefault(); return; }
      event.dataTransfer.effectAllowed = 'copyMove';
      event.dataTransfer.setData('text/plain', node.dataset.entryId);
      node.classList.add('dragging');
    });
    node.addEventListener('dragend', () => node.classList.remove('dragging'));
  });

  document.querySelectorAll('.slot-add, .slot[data-entry-id]').forEach(node => {
    node.addEventListener('dragover', event => {
      if (state.mode === 'development') {
        event.preventDefault();
        node.classList.add('drop-target');
        event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey ? 'copy' : 'move';
      }
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
    node.addEventListener('drop', event => {
      event.preventDefault();
      node.classList.remove('drop-target');
      const id = event.dataTransfer.getData('text/plain');
      if (id) moveEntryTo(id, node.dataset.day, node.dataset.period, event.ctrlKey || event.metaKey);
    });
  });
}

// ── Event Bindings ──
function bindView() {
  bindDragDrop();

  // Context menu on slots
  document.querySelectorAll('.slot').forEach(node => node.addEventListener('contextmenu', event => {
    if (state.mode !== 'development') return;
    const entry = node.dataset.entryId ? state.entries.find(x => x.id === node.dataset.entryId) : null;
    showContextMenu(event, entry, { day: node.dataset.day, period: node.dataset.period });
  }));

  // Section filter
  $('#section-filter')?.addEventListener('change', async e => {
    state.filterSection = e.target.value;
    await loadState();
    render();
  });

  // Search
  $('#entry-search')?.addEventListener('input', e => {
    state.search = e.target.value;
    render();
  });

  $('#clear-filters')?.addEventListener('click', () => {
    state.search = '';
    state.filterSection = SECTIONS[0] || '';
    loadState().then(() => render());
  });

  // Action buttons
  $('#add-entry-btn')?.addEventListener('click', () => openEntryModal());
  $('#empty-add')?.addEventListener('click', () => openEntryModal());
  $('#autogen-btn')?.addEventListener('click', generateDraft);
  $('#export-btn')?.addEventListener('click', exportCurrent);
  $('#publish-draft')?.addEventListener('click', publishDraft);
  $('#reset-draft')?.addEventListener('click', resetDraft);
  $('#compare-draft')?.addEventListener('click', () => {
    state.mode = 'development';
    switchTab('editor');
  });

  // Preset management buttons
  $('#add-preset-btn')?.addEventListener('click', () => openPresetModal(null));
  document.querySelectorAll('.edit-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.presetId;
      const found = LAYOUT_PRESETS.find(p => (p._id || p.id) === pid);
      openPresetModal(found || { _id: pid, name: 'Standard Preset', timingSet: 'SET_1' });
    });
  });
  document.querySelectorAll('.delete-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.presetId;
      deletePreset(pid);
    });
  });

  // Slot clicks
  document.querySelectorAll('.slot[data-entry-id]').forEach(node => node.addEventListener('click', () => {
    const entry = state.entries.find(x => x.id === node.dataset.entryId) || state.production.find(x => x.id === node.dataset.entryId);
    if (!entry) return;
    if (state.mode === 'development') openEntryModal(entry);
    else notify(`${entry.subject} · ${entry.teacher} · ${entry.room}`, 'info');
  }));

  // Empty slot clicks
  document.querySelectorAll('.slot-add').forEach(node => node.addEventListener('click', () =>
    openEntryModal(null, { day: node.dataset.day, period: node.dataset.period })
  ));

  // Free slot scheduling
  document.querySelectorAll('[id^="free-"]').forEach(node => node.addEventListener('click', () => {
    const parts = node.id.slice(5).split('-');
    openEntryModal(null, { day: parts[0], period: parts[1] });
  }));

  // Undo and Redo buttons
  $('#undo-btn')?.addEventListener('click', performUndo);
  $('#redo-btn')?.addEventListener('click', performRedo);

  // Print button
  document.querySelectorAll('#print-btn').forEach(btn => btn.addEventListener('click', () => {
    const meta = document.getElementById('print-meta');
    if (meta) {
      meta.textContent = `Section: ${state.filterSection || 'All'} · Academic Timetable · Date: ${new Date().toLocaleDateString()}`;
    }
    window.print();
  }));
}

function bindGlobal() {
  // Hide context menu on outer click
  document.addEventListener('click', event => {
    if (!event.target.closest('#tt-context-menu')) hideContextMenu();
  });

  contextMenu().addEventListener('click', event => {
    const action = event.target.dataset.action;
    if (action) contextAction(action, event.currentTarget);
  });

  // Nav items in sidebar (with ?tab= URL sync)
  document.querySelectorAll('.sb-item[data-view]').forEach(node => node.addEventListener('click', () => {
    switchTab(node.dataset.view);
  }));

  // Mode toggle (Development vs Production)
  document.querySelectorAll('.mode').forEach((node, index) => node.addEventListener('click', () => {
    state.mode = index === 0 ? 'development' : 'production';
    document.querySelectorAll('.mode').forEach((x, i) => x.classList.toggle('active', i === index));
    if (state.mode === 'production' && state.view === 'editor') switchTab('production');
    else render();
  }));

  // Modal actions (Slot modal)
  document.querySelectorAll('.close-modal').forEach(node => node.addEventListener('click', closeModal));
  $('#save-slot')?.addEventListener('click', saveEntry);
  $('#delete-slot')?.addEventListener('click', () => {
    if (state.selectedId) deleteEntry(state.selectedId);
  });
  $('#copy-slot')?.addEventListener('click', () => {
    const entry = state.entries.find(x => x.id === state.selectedId);
    if (entry) { closeModal(); copyEntry(entry); }
  });
  $('#slot-modal')?.addEventListener('click', e => {
    if (e.target.id === 'slot-modal') closeModal();
  });

  // Modal actions (Preset modal)
  document.querySelectorAll('.close-preset-modal').forEach(node => node.addEventListener('click', closePresetModal));
  $('#save-preset')?.addEventListener('click', savePreset);
  $('#preset-modal')?.addEventListener('click', e => {
    if (e.target.id === 'preset-modal') closePresetModal();
  });

  // Modal actions (Confirm pop modal)
  $('#accept-confirm-btn')?.addEventListener('click', () => closeConfirmModal(true));
  $('#cancel-confirm-btn')?.addEventListener('click', () => closeConfirmModal(false));
  $('#close-confirm-modal')?.addEventListener('click', () => closeConfirmModal(false));
  $('#confirm-modal')?.addEventListener('click', e => {
    if (e.target.id === 'confirm-modal') closeConfirmModal(false);
  });

  // Modal actions (Comment pop modal)
  $('#save-comment-btn')?.addEventListener('click', () => {
    const val = $('#slot-comment-input')?.value.trim() ?? '';
    closeCommentModal(val);
  });
  $('#cancel-comment-btn')?.addEventListener('click', () => closeCommentModal(null));
  $('#close-comment-modal')?.addEventListener('click', () => closeCommentModal(null));
  $('#comment-modal')?.addEventListener('click', e => {
    if (e.target.id === 'comment-modal') closeCommentModal(null);
  });
  $('#slot-comment-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
      e.preventDefault();
      const val = $('#slot-comment-input')?.value.trim() ?? '';
      closeCommentModal(val);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('#confirm-modal')?.classList.contains('open')) {
        closeConfirmModal(false);
        return;
      }
      if ($('#comment-modal')?.classList.contains('open')) {
        closeCommentModal(null);
        return;
      }
      closeModal();
      closePresetModal();
      const gen = document.getElementById('generator-review');
      if (gen) gen.remove();
    }
    // Undo shortcut: Ctrl+Z or Cmd+Z
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      if (!e.target.matches('input, select, textarea')) {
        e.preventDefault();
        performUndo();
      }
    }
    // Redo shortcut: Ctrl+Y or Cmd+Y or Ctrl+Shift+Z
    if (((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
      if (!e.target.matches('input, select, textarea')) {
        e.preventDefault();
        performRedo();
      }
    }
  });
}

// ── Bootstrap ──
document.addEventListener('DOMContentLoaded', initApp);
