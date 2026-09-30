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
let _publicSettings = null;

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

function formatSubjectDisplay(subject) {
  if (!subject) return '';
  const str = String(subject).trim();
  const found = (_masterData.subjects || []).find(s =>
    String(s._id) === str ||
    (s.code && s.code.toLowerCase() === str.toLowerCase()) ||
    (s.name && s.name.toLowerCase() === str.toLowerCase()) ||
    (s.shortName && s.shortName.toLowerCase() === str.toLowerCase()) ||
    (`${s.code} ${s.shortName || ''}`.trim().toLowerCase() === str.toLowerCase())
  );
  if (found) {
    const code = (found.code || '').trim();
    const sc = (found.shortName || found.name || '').trim();
    return `${code} ${sc}`.trim() || found.name;
  }
  return str;
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
  // User Requirement 1: Live updating sync text near [Draft — unpublished] instead of spammy dbToast
  if (type === 'saving') {
    setLiveSyncStatus('saving', typeof message === 'string' ? message : 'Saving..');
    return;
  }
  if (type === 'success' && typeof message === 'string' && (/saved/i.test(message) || /relocated/i.test(message) || /slot/i.test(message) || /draft/i.test(message) || /auto-fixed/i.test(message) || /copied/i.test(message))) {
    updateLiveSyncFromCurrentState();
    return;
  }
  if (type === 'error') {
    setLiveSyncStatus('error', 'Error');
    if (typeof showToast === 'function') return showToast(message, 'error');
    return;
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
    workload: 'Faculty Workload & Schedule · Timetable | EAMS',
    faculty: 'Faculty Workload & Schedule · Timetable | EAMS',
    free: 'Free Slots Finder · Timetable | EAMS',
    rooms: 'Room Allocations · Timetable | EAMS',
    overview: 'Department Overview · Timetable | EAMS',
    exports: 'Export Center · Timetable | EAMS',
    approvals: 'Conflict & Approvals · Timetable | EAMS',
    presets: 'Layout Presets · Timetable | EAMS',
    history: 'Version History · Timetable | EAMS',
    attendance: 'Attendance Insights · Timetable | EAMS',
    subjects: 'Subjects Curriculum · Timetable | EAMS',
    dashboard: 'Operations Dashboard · Timetable | EAMS'
  };
  document.title = titles[state.view] || 'Timetable Workspace · EAMS';
}

// ── Application State ──
const state = {
  view: 'grid',
  env: 'development',
  get mode() { return this.env; },
  set mode(val) { this.env = val; },
  filterDept: 'all',
  filterBatch: 'all',
  filterSection: '',
  search: '',
  selectedId: null,
  selectedPresetId: null,
  clipboard: null,
  entries: [],
  production: [],
  tabData: {}, // per-tab storage { [tabId]: { classId, env, entries, production, draftTemplateId, draftTemplateStatus, devSource, dirty } }
  dirty: false,
  generator: null,
  modalBusy: false,
  draftTemplateId: null,
  draftTemplateStatus: null,
  devSource: 'development',
  loading: true,
  versions: [],
  loadingVersions: false,
  historyTrack: 'production',
  subjectDeptFilter: 'all',
  subjectRegFilter: 'all',
  subjectSearch: '',
  subjectsList: [],
  loadingSubjects: false,
  attendanceInsights: null,
  loadingAttendance: false,
  attendanceRange: 30,
  attendanceSubject: '',
  attendanceSearch: '',
  substitutions: [],
  activeLeaves: [],
  loadingSubstitutions: false,
  workloadTab: 'faculty',
  presetTab: 'templates',
  academicCalendar: null,
  loadingCalendar: false,
  selectedFaculty: '',
  selectedRoom: '__all__',
  verificationRequests: [],
  loadingVerifications: false,
  dashboardData: null,
  loadingDashboard: false,
  dashboardDate: new Date().toISOString().slice(0, 10),
  dashboardDeptFilter: 'all',
  expandedPanel: null,
  cockpitCalMonth: new Date().getMonth(),
  cockpitCalYear: new Date().getFullYear(),
  nudgedAlerts: new Set(),
  subjectDeptFilter: 'all',
  subjectRegFilter: 'all',
  subjectFilter: 'all',
  subjectSearch: '',
  subjectsList: [],
  loadingSubjects: false
};

// Returns raw entries based on active environment (Fix 4)
function getRawActiveEntries(tabId) {
  const currentTabId = tabId || (window.workspace && window.workspace.activeTabId);
  const td = currentTabId && state.tabData ? state.tabData[currentTabId] : null;
  if (td) {
    return state.env === 'production' ? (td.production || []) : (td.entries || []);
  }
  return state.env === 'production' ? (state.production || []) : (state.entries || []);
}

// ── Read-Only State Guard (§5 & §6) ──
function isReadOnlyMode() {
  return state.env !== 'development' || state.draftTemplateStatus === 'pending_approval';
}

// ── Multi-Level Command History (Undo / Redo with Per-Tab Scope §2.3) ──
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 40;
let _isHistoryOpBusy = false;
let _lastHistoryOpTime = 0;

function areEntriesEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function recordHistory(actionLabel = 'Edit Timetable') {
  const currentEntries = state.entries || [];
  // Prevent duplicate consecutive snapshots if entries are identical
  if (undoStack.length > 0 && areEntriesEqual(currentEntries, undoStack[undoStack.length - 1].entries)) {
    return;
  }

  const snapshot = {
    label: actionLabel,
    entries: JSON.parse(JSON.stringify(currentEntries))
  };
  undoStack.push(snapshot);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;

  // Persist into active tab state (Section 2.3)
  if (window.workspace) {
    const activeTab = window.workspace.getActiveTab();
    if (activeTab) {
      activeTab.undoStack = activeTab.undoStack || [];
      if (!activeTab.undoStack.length || !areEntriesEqual(currentEntries, activeTab.undoStack[activeTab.undoStack.length - 1].entries)) {
        activeTab.undoStack.push(snapshot);
        if (activeTab.undoStack.length > MAX_HISTORY) activeTab.undoStack.shift();
      }
      activeTab.redoStack = [];
      window.workspace.markDirty(activeTab.id, true);
    }
  }
}

function markCurrentTabDirty() {
  state.dirty = true;
  setLiveSyncStatus('unsaved', 'Unsaved changes');
  const currentTabId = window.workspace?.activeTabId;
  if (currentTabId) {
    if (state.tabData) {
      if (!state.tabData[currentTabId]) state.tabData[currentTabId] = {};
      state.tabData[currentTabId].dirty = true;
      state.tabData[currentTabId].entries = state.entries;
    }
    if (window.workspace?.markDirty) {
      window.workspace.markDirty(currentTabId, true);
    }
  }
}

function performUndo(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();

  const now = Date.now();
  if (_isHistoryOpBusy || now - _lastHistoryOpTime < 180) {
    return;
  }
  _isHistoryOpBusy = true;
  _lastHistoryOpTime = now;

  try {
    if (isReadOnlyMode()) {
      return notify('Timetable is currently read-only.', 'warn');
    }
    if (!undoStack.length) {
      return notify('Nothing to undo.', 'info');
    }
    const currentSnapshot = {
      label: 'Current Snapshot',
      entries: JSON.parse(JSON.stringify(state.entries || []))
    };
    redoStack.push(currentSnapshot);
    const prev = undoStack.pop();
    state.entries = prev.entries || [];
    markCurrentTabDirty();
    if (window.workspace?.activeTabId) {
      const activeTab = window.workspace.getActiveTab();
      if (activeTab) {
        activeTab.undoStack = [...undoStack];
        activeTab.redoStack = [...redoStack];
      }
    }
    render();
    persistState();
    notify(`↶ Undone: ${prev.label}`, 'info');
  } finally {
    setTimeout(() => { _isHistoryOpBusy = false; }, 40);
  }
}

function performRedo(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();

  const now = Date.now();
  if (_isHistoryOpBusy || now - _lastHistoryOpTime < 180) {
    return;
  }
  _isHistoryOpBusy = true;
  _lastHistoryOpTime = now;

  try {
    if (isReadOnlyMode()) {
      return notify('Timetable is currently read-only.', 'warn');
    }
    if (!redoStack.length) {
      return notify('Nothing to redo.', 'info');
    }
    const currentSnapshot = {
      label: 'Current Snapshot',
      entries: JSON.parse(JSON.stringify(state.entries || []))
    };
    undoStack.push(currentSnapshot);
    const next = redoStack.pop();
    state.entries = next.entries || [];
    markCurrentTabDirty();
    if (window.workspace?.activeTabId) {
      const activeTab = window.workspace.getActiveTab();
      if (activeTab) {
        activeTab.undoStack = [...undoStack];
        activeTab.redoStack = [...redoStack];
      }
    }
    render();
    persistState();
    notify(`↷ Redone: ${next.label}`, 'info');
  } finally {
    setTimeout(() => { _isHistoryOpBusy = false; }, 40);
  }
}

const VALID_TABS = {
  grid: 'grid',
  dash: 'grid',
  production: 'grid',
  editor: 'grid',
  draft: 'grid',
  workload: 'workload',
  faculty: 'workload',
  free: 'free',
  rooms: 'rooms',
  overview: 'overview',
  exports: 'exports',
  approvals: 'approvals',
  presets: 'presets',
  history: 'history',
  attendance: 'attendance'
};

function canAccessDev() {
  const user = JSON.parse(sessionStorage.getItem('user') || '{}');
  if (user.role === 'admin') return true;
  if (user.isTimeTableCoordinator) return true;
  if (user.isHod) return true;
  if (typeof hasRight === 'function' && (hasRight('timetablePage') || hasRight('all'))) return true;
  const rights = Array.isArray(user.adminRights) ? user.adminRights : (user.adminRights ? [user.adminRights] : []);
  return rights.includes('timetablePage') || rights.includes('all');
}

function isAnyTabDirty() {
  const wsDirty = window.workspace && window.workspace.tabs && Array.from(window.workspace.tabs.values()).some(t => t.isDirty || t.dirty);
  const stateDirty = Object.values(state.tabData || {}).some(td => td && td.dirty);
  return Boolean(state.dirty || wsDirty || stateDirty);
}

function updateToggleApplicability() {
  const nonApplicableViews = ['approvals', 'attendance', 'presets', 'subjects'];
  const isNonApplicable = nonApplicableViews.includes(state.view);
  const wrapper = document.getElementById('envToggleWrapper');
  if (wrapper) {
    if (isNonApplicable) {
      wrapper.classList.add('disabled');
      wrapper.title = 'Environment switching is not applicable for this view';
    } else {
      wrapper.classList.remove('disabled');
      wrapper.title = 'Switch workspace between Live Production and Development Drafts';
    }
  }
}

function updateWorkspaceMode(mode) {
  if (mode === 'development' && !canAccessDev()) {
    mode = 'production';
  }
  state.env = mode;
  document.querySelectorAll('[data-tt-mode]').forEach(el => el.setAttribute('data-tt-mode', mode));
  document.querySelectorAll('.mode-toggle').forEach(toggle => {
    toggle.querySelectorAll('.mode').forEach(b => {
      const isAct = b.dataset.mode === mode;
      b.classList.toggle('active', isAct);
      b.setAttribute('aria-pressed', isAct ? 'true' : 'false');
    });
  });
  const chipText = document.querySelector('#mode-status-chip .mode-status-text');
  if (chipText) {
    chipText.textContent = mode === 'development' ? 'Draft — unpublished' : 'Live — published';
  }
  updateToggleApplicability();
}

async function switchEnv(targetEnv) {
  const nonApplicableViews = ['approvals', 'attendance', 'presets', 'subjects'];
  if (nonApplicableViews.includes(state.view)) {
    return; // Early return: non-applicable runtime view (Fix 2)
  }

  const nextEnv = targetEnv || (state.env === 'production' ? 'development' : 'production');
  if (nextEnv === state.env) return;

  if (nextEnv === 'development' && !canAccessDev()) {
    return notify('Development environment access restricted to Admins, TT Coordinators, and HODs.', 'warn');
  }

  if (state.env === 'development' && nextEnv === 'production' && isAnyTabDirty()) {
    if (!confirm('You have unsaved changes in your draft workspace. Switch to Live Production? Unsaved changes will remain preserved in Development drafts.')) {
      return;
    }
  }

  setLiveSyncStatus('loading', 'Loading..');
  updateWorkspaceMode(nextEnv);

  // Invalidate slot source cache so views re-fetch fresh data for the new environment
  if (typeof _slotSourceCache !== 'undefined') {
    _slotSourceCache.env = null;
  }

  const minWait = new Promise(r => setTimeout(r, 220));

  // If in history view, reload version history directly for the selected environment
  if (state.view === 'history') {
    state.historyTrack = nextEnv;
    await Promise.all([loadVersions(), minWait]);
    render();
    updateLiveSyncFromCurrentState();
    return;
  }

  // Reload current active tab / view
  if (window.workspace) {
    const activeTab = window.workspace.getActiveTab();
    if (activeTab) {
      if (activeTab.viewType === 'section') {
        const classId = activeTab.viewParams?.classId || getSelectedClassId();
        await loadState(classId, activeTab.id);
        activeTab.renderedEnv = nextEnv;
      }
      await Promise.all([window.workspace.refreshTab(activeTab.id), minWait]);
      updateLiveSyncFromCurrentState();
      return;
    }
  }

  await Promise.all([loadState(), minWait]);
  render();
  updateLiveSyncFromCurrentState();
}

function switchTab(viewName) {
  if (viewName === 'faculty') {
    viewName = 'workload';
    state.workloadTab = 'schedule';
  }
  if (window.history && window.history.replaceState) {
    const url = new URL(window.location);
    url.searchParams.set('tab', viewName);
    ['page', 'view'].forEach(p => url.searchParams.delete(p));
    window.history.replaceState({}, '', url.toString());
  }
  document.querySelectorAll('.sb-item[data-view]').forEach(x => x.classList.toggle('act', x.dataset.view === viewName));

  const isClassMatrix = (viewName === 'grid' || viewName === 'production' || viewName === 'editor');
  const tabstripBar = document.getElementById('tt-tabstrip-bar');
  const viewportContainer = document.getElementById('viewport-container');
  let fullPage = document.getElementById('tt-full-page-container');

  if (isClassMatrix) {
    // ── Timetable Matrix Mode: Restore Tabstrip & Viewport Container with all opened tabs intact ──
    if (tabstripBar) tabstripBar.style.display = '';
    if (viewportContainer) viewportContainer.style.display = '';
    if (fullPage) {
      fullPage.style.display = 'none';
      fullPage.innerHTML = '';
    }

    state.view = 'grid';
    const targetMode = viewName === 'production' ? 'production' : (state.env || 'development');
    updateWorkspaceMode(targetMode);

    if (window.workspace) {
      const activeTab = window.workspace.getActiveTab();
      if (activeTab && (activeTab.viewType === 'section' || String(activeTab.id).startsWith('section:'))) {
        activeTab.mode = targetMode;
        window.workspace.setTabMode(activeTab.id, targetMode);
        window.workspace.activateTab(activeTab.id);
        window.workspace.refreshTab(activeTab.id);
        return;
      }
      const existingSec = Array.from(window.workspace.tabs.values()).find(t => t.viewType === 'section' || String(t.id).startsWith('section:'));
      if (existingSec) {
        existingSec.mode = targetMode;
        window.workspace.activateTab(existingSec.id);
        window.workspace.setTabMode(existingSec.id, targetMode);
        window.workspace.refreshTab(existingSec.id);
        return;
      }
      const secName = state.filterSection || (SECTIONS.length ? SECTIONS[0] : 'General');
      window.workspace.openTab({
        id: buildTabId('section', { classId: secName }),
        title: secName,
        icon: '📅',
        viewType: 'section',
        viewParams: { classId: secName, sectionName: secName },
        mode: targetMode
      });
      return;
    }

    render();
    return;
  }

  // ── All other sidebar menus: Open Full Page Menu (Hide Tabstrip & Viewport Container) ──
  if (tabstripBar) tabstripBar.style.display = 'none';
  if (viewportContainer) viewportContainer.style.display = 'none';

  if (!fullPage) {
    const pageContent = document.getElementById('page-content');
    if (pageContent) {
      fullPage = document.createElement('div');
      fullPage.id = 'tt-full-page-container';
      fullPage.className = 'tt-full-page-container';
      pageContent.appendChild(fullPage);
    }
  }
  if (fullPage) {
    fullPage.style.display = 'block';
  }

  state.view = viewName;

  const viewTitles = {
    dashboard: 'Operations Dashboard & Command Center',
    workload: 'Faculty Workload & Schedule',
    faculty: 'Faculty Workload & Schedule',
    free: 'Free Slots Finder',
    rooms: 'Room Allocations',
    overview: 'Department Overview',
    exports: 'Export Center',
    approvals: 'Conflict & Approvals',
    presets: 'Layout Presets',
    history: 'Version History',
    attendance: 'Attendance Insights',
    subjects: 'Department Subjects Curriculum',
    'hall-roster': 'Combined Hall Roster',
    import: 'Excel Importer'
  };
  const crumb = document.getElementById('crumb-current');
  if (crumb) {
    crumb.textContent = viewTitles[viewName] || viewName;
  }

  // ── Step 1: Render view immediately so user experiences ZERO lag on screen ──
  if (fullPage) {
    fullPage.innerHTML = viewHtml();
  }
  bindView();
  updateDocumentTitle();

  // ── Step 2: Instant Client-Side Views (zero network requests, instantaneous 0ms switch) ──
  if (viewName === 'exports' || viewName === 'presets' || viewName === 'import' || viewName === 'hall-roster') {
    state.loading = false;
    setLiveSyncStatus('saved', 'Saved');
    return;
  }

  // ── Step 3: Check memory cache for analytical views ──
  const isSlotSourceView = (viewName === 'faculty' || viewName === 'overview' || viewName === 'workload' || viewName === 'rooms' || viewName === 'free');
  const hasCachedSlotSource = _slotSourceCache.env === state.env && (Date.now() - _slotSourceCache.timestamp < 60000) && _slotSourceCache.data && _slotSourceCache.data.length;

  if (isSlotSourceView && hasCachedSlotSource) {
    state.loading = false;
    setLiveSyncStatus('saved', 'Saved');
    return;
  }

  // ── Step 4: Loading state with live text indicator (Loading..) ──
  state.loading = true;
  setLiveSyncStatus('loading', 'Loading..');

  const asyncLoader = async () => {
    try {
      if (viewName === 'dashboard') {
        await loadDashboardCockpit();
      } else if (viewName === 'history') {
        await loadVersions();
      } else if (viewName === 'attendance') {
        await loadAttendanceInsights();
      } else if (viewName === 'approvals') {
        await loadVerificationRequests();
      } else if (viewName === 'subjects') {
        await loadSubjectsData();
      } else if (isSlotSourceView) {
        await loadSlotSource();
      } else {
        await loadState();
      }

      // Re-render once data arrives if user has not navigated away
      if (state.view === viewName && fullPage) {
        fullPage.innerHTML = viewHtml();
        const crumbEl = document.getElementById('crumb-current');
        if (crumbEl) {
          crumbEl.textContent = viewTitles[viewName] || viewName;
        }
        bindView();
      }
    } catch (err) {
      console.error('[switchTab asyncLoader error]:', err);
    } finally {
      if (state.view === viewName) {
        state.loading = false;
        updateLiveSyncFromCurrentState();
        updateDocumentTitle();
      }
    }
  };

  asyncLoader();
}
window.switchTab = switchTab;


// ── Page Loader & Live Sync Controller ──
function setLiveSyncStatus(status, customText) {
  const badge = document.getElementById('tt-live-sync-status');
  if (!badge) return;
  const textEls = badge.querySelectorAll('.tt-sync-text');
  const byId = document.getElementById('tt-sync-text');

  badge.className = `tt-sync-badge status-${status}`;
  let label = customText;
  if (!label) {
    if (status === 'saved') label = 'Saved';
    else if (status === 'saving') label = 'Saving..';
    else if (status === 'loading') label = 'Loading..';
    else if (status === 'draft' || status === 'new-draft') label = 'New Draft';
    else if (status === 'error') label = 'Error';
    else if (status === 'unsaved') label = 'Unsaved changes';
    else label = status;
  }
  textEls.forEach(el => el.textContent = label);
  if (byId) byId.textContent = label;

  if (status === 'saved') badge.title = 'All changes saved to database';
  else if (status === 'saving') badge.title = 'Saving changes to database…';
  else if (status === 'loading') badge.title = 'Fetching timetable workspace data…';
  else if (status === 'unsaved') badge.title = 'Unsaved changes in workspace (Ctrl+S to save)';
  else if (status === 'draft' || status === 'new-draft') badge.title = 'New draft workspace initialized';
  else if (status === 'error') badge.title = 'Database sync error occurred';
}

function updateLiveSyncFromCurrentState() {
  if (state.loading) {
    setLiveSyncStatus('loading', 'Loading..');
    return;
  }
  if (state.saving) {
    setLiveSyncStatus('saving', 'Saving..');
    return;
  }
  const isGridView = state.view === 'grid' || state.view === 'editor' || !state.view;
  if (isGridView && state.env === 'development') {
    if (state.dirty) {
      setLiveSyncStatus('unsaved', 'Unsaved changes');
      return;
    }
    const isNewDraft = !state.draftTemplateId || state.devSource === 'production';
    if (isNewDraft) {
      setLiveSyncStatus('draft', 'New Draft');
      return;
    }
    setLiveSyncStatus('saved', 'Saved');
    return;
  }
  setLiveSyncStatus('saved', 'Saved');
}

function setLoaderMsg(idx, text) {
  const loaderMsgEl = document.getElementById('loader-msg');
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
  setLiveSyncStatus('loading', 'Loading..');

  const user = typeof getUser === 'function' ? getUser() : null;

  // Authorization check: Admin, TT Coordinator, HOD, or teacher with timetablePage / all right
  const canAccess = user && (
    user.role === 'admin' ||
    user.isTimeTableCoordinator === true ||
    user.isHod === true ||
    (typeof hasRight === 'function' && (hasRight('timetablePage') || hasRight('all'))) ||
    (user.role === 'teacher' && user.isAdmin && user.adminRights && (user.adminRights === 'all' || (Array.isArray(user.adminRights) && (user.adminRights.includes('all') || user.adminRights.includes('timetablePage')))))
  );

  if (!canAccess) {
    window.location.replace('index.html?returnUrl=timetable.html&verify=true');
    return;
  }

  // Read ?tab= and ?env= parameter if present
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = (urlParams.get('tab') || urlParams.get('view') || '').toLowerCase().trim();

  // Preserve ?tab= in URL, clean up obsolete params like page/view
  if (window.history && window.history.replaceState) {
    const url = new URL(window.location);
    ['page', 'view'].forEach(p => url.searchParams.delete(p));
    if (initialTab) {
      url.searchParams.set('tab', initialTab);
    }
    const newSearch = url.searchParams.toString();
    window.history.replaceState({}, '', url.pathname + (newSearch ? '?' + newSearch : ''));
  }

  // Default view is timetable grid unless a specific tab was requested
  state.view = initialTab || 'grid';

  // Read ?env= parameter if present
  const envParam = (urlParams.get('env') || '').toLowerCase();
  if (envParam === 'development' || envParam === 'production') {
    if (envParam === 'development' && canAccessDev()) {
      state.env = 'development';
    } else {
      state.env = 'production';
    }
  } else {
    if (canAccessDev()) {
      state.env = 'development';
    } else {
      state.env = 'production';
    }
  }
  updateWorkspaceMode(state.env);

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
    const etaEl = document.getElementById('loader-eta');
    if (etaEl) {
      if (_etaMs > 0) {
        etaEl.innerHTML = `ETA: <span class="eta-time">${formatEta(_etaMs)}</span> — loading timetable schema`;
      } else {
        etaEl.innerHTML = '✔ Finalizing workspace…';
      }
    }
  }, 200);

  try {
    // Load public settings for model gates
    try {
      const pRes = await apiCall('GET', '/settings/public');
      _publicSettings = pRes?.data || pRes || {};
    } catch (_) {
      _publicSettings = {};
    }

    // Load live master data directly from API
    setLoaderMsg(1, 'Loading Academic Structure & Subjects…');
    await loadMasterData();

    setLoaderMsg(2, 'Syncing Timetable Matrix & Grid…');
    await loadState();

    setLoaderMsg(3, 'Readying Coordinator Workspace…');

    clearInterval(_etaTick);
    const etaEl = document.getElementById('loader-eta');
    if (etaEl) etaEl.innerHTML = '✔ Timetable ready';

    state.loading = false;
    bindGlobal();
    updateDocumentTitle();

    // Initialize Tab Workspace
    await initTabWorkspace();
    const validFullTabs = ['dashboard', 'workload', 'faculty', 'free', 'rooms', 'overview', 'exports', 'approvals', 'presets', 'history', 'attendance', 'subjects', 'hall-roster', 'import'];
    if (initialTab === 'dashboard' || initialTab === 'dash' || initialTab === 'cockpit') {
      switchTab('dashboard');
    } else if (validFullTabs.includes(initialTab)) {
      switchTab(initialTab);
    }
    updateLiveSyncFromCurrentState();
  } catch (err) {
    console.error('[Timetable:Init] Fatal error during timetable workspace initialization:', err);
    setLiveSyncStatus('error', 'Error');
  } finally {
    clearInterval(_etaTick);
    // Fail-safe loader dismissal: ALWAYS hide loader and reveal app shell
    const loader = document.getElementById('page-loader');
    if (loader) {
      loader.classList.add('loader-fade');
      setTimeout(() => { loader.style.display = 'none'; }, 350);
    }
    const shell = document.getElementById('app-shell');
    if (shell) shell.style.display = 'flex';

    if (typeof flushToastQueue === 'function') flushToastQueue();
  }
}

// ── API Master Data Loading ──
async function loadMasterData() {
  try {
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
  } catch (err) {
    console.error('Failed to load master data:', err);
    setLiveSyncStatus('error', 'Error');
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

// ── Slot Source Cache & Multi-Class Aggregator (Fix 4) ──
let _slotSourceCache = { env: null, data: [], timestamp: 0 };

async function loadSlotSource(force = false) {
  const currentEnv = state.env || 'development';
  const now = Date.now();
  if (!force && _slotSourceCache.env === currentEnv && (now - _slotSourceCache.timestamp < 60000) && _slotSourceCache.data && _slotSourceCache.data.length) {
    return _slotSourceCache.data;
  }
  try {
    state.loading = true;
    setLiveSyncStatus('loading', 'Loading..');
    const res = await apiCall('GET', `/timetable/slot-source?env=${currentEnv}`);
    if (res && res.data) {
      _slotSourceCache = { env: currentEnv, data: res.data, timestamp: now };
      return res.data;
    }
  } catch (err) {
    console.warn('Failed to load slot-source:', err.message);
  } finally {
    state.loading = false;
  }
  return [];
}

function getAllClassesEntries() {
  if (_slotSourceCache.env === state.env && _slotSourceCache.data && _slotSourceCache.data.length) {
    const list = [];
    _slotSourceCache.data.forEach(st => {
      const clsName = st.className || 'General';
      const slots = st.slots || {};
      Object.keys(slots).forEach(key => {
        const slot = slots[key];
        if (!slot) return;
        const pStr = String(slot.period !== undefined && slot.period !== null ? slot.period : '');
        const pCode = pStr ? (pStr.startsWith('P') ? pStr : `P${pStr}`) : (key.split('_')[1] ? (key.split('_')[1].startsWith('P') ? key.split('_')[1] : `P${key.split('_')[1]}`) : 'P1');
        list.push({
          id: slot._id || slot.id || uid(),
          day: slot.day || key.split('_')[0],
          period: pCode,
          duration: slot.span || slot.duration || 1,
          subject: slot.subject || '',
          teacher: slot.teacher || '',
          room: slot.room || '',
          section: clsName,
          classId: st.classId,
          type: slot.isLab ? 'Lab' : 'Theory',
          status: st._source === 'development' ? 'draft' : 'published',
          source: st._source || state.env
        });
      });
    });
    return list;
  }
  return activeEntries();
}

// ── State Loading (Production & Draft Isolated Per-Tab) ──
async function loadState(targetClassId, targetTabId) {
  setLiveSyncStatus('loading', 'Loading..');
  try {
    const classId = targetClassId || getSelectedClassId();
    const tabId = targetTabId || (window.workspace && window.workspace.activeTabId);
    state.tabData = state.tabData || {};

    if (classId) {
      if (state.env === 'production') {
        const section = await apiCall('GET', '/timetable/section/' + classId);
        const prodEntries = flattenSlots(section.slots || {});
        state.production = prodEntries;
        state.entries = []; // P mode: entries is empty, grid reads activeEntries()
        state.draftTemplateId = null;
        state.draftTemplateStatus = null;
        state.devSource = 'production';

        if (tabId) {
          state.tabData[tabId] = {
            classId,
            env: 'production',
            production: prodEntries,
            entries: [],
            draftTemplateId: null,
            draftTemplateStatus: null,
            devSource: 'production',
            dirty: false
          };
        }
      } else {
        // Development environment: fetch dev template and prod fallback in parallel
        const [devSection, prodSection] = await Promise.all([
          apiCall('GET', `/timetable/section/${classId}?env=development`),
          apiCall('GET', '/timetable/section/' + classId)
        ]);
        const devEntries = flattenSlots(devSection.slots || {});
        const prodEntries = flattenSlots(prodSection.slots || {});

        state.entries = devEntries;
        state.production = prodEntries;
        state.draftTemplateId = devSection._templateId || null;
        state.draftTemplateStatus = devSection._templateStatus || null;
        state.devSource = devSection._source || 'development';

        if (tabId) {
          state.tabData[tabId] = {
            classId,
            env: 'development',
            production: prodEntries,
            entries: devEntries,
            draftTemplateId: devSection._templateId || null,
            draftTemplateStatus: devSection._templateStatus || null,
            devSource: devSection._source,
            dirty: false
          };
        }
      }
    } else {
      state.production = [];
      state.entries = [];
      state.draftTemplateId = null;
      state.draftTemplateStatus = null;
      if (tabId) delete state.tabData[tabId];
    }
    state.dirty = false;
    await Promise.all([
      loadSubstitutionsAndLeaves(),
      loadAcademicCalendar(),
      loadSlotSource()
    ]);
    state.loading = false;
    updateLiveSyncFromCurrentState();
  } catch (err) {
    notify('Failed to load timetable: ' + err.message, 'error');
    state.entries = [];
    state.production = [];
    setLiveSyncStatus('error', 'Error');
  }
}

async function loadAcademicCalendar() {
  try {
    state.loadingCalendar = true;
    const classId = getSelectedClassId();
    let url = '/timetable/academic-calendar-stats';
    if (classId) url += `?classId=${encodeURIComponent(classId)}`;
    const res = await apiCall('GET', url);
    state.academicCalendar = res.stats || null;
  } catch (err) {
    console.warn('Academic calendar stats error:', err.message);
    state.academicCalendar = null;
  } finally {
    state.loadingCalendar = false;
  }
}

async function loadSubstitutionsAndLeaves() {
  try {
    state.loadingSubstitutions = true;
    const classId = getSelectedClassId();
    let url = `/timetable/substitutions-and-leaves?date=${new Date().toISOString().slice(0, 10)}`;
    if (classId) url += `&classId=${encodeURIComponent(classId)}`;
    if (state.filterSection) url += `&className=${encodeURIComponent(state.filterSection)}`;
    const res = await apiCall('GET', url);
    state.substitutions = res.substitutions || [];
    state.activeLeaves = res.activeLeaves || [];
  } catch (err) {
    console.error('Failed to load substitutions/leaves:', err);
    state.substitutions = [];
    state.activeLeaves = [];
  } finally {
    state.loadingSubstitutions = false;
  }
}

function flattenSlots(slotsObj) {
  const entries = [];
  if (!slotsObj || typeof slotsObj !== 'object') return entries;
  Object.keys(slotsObj).forEach(key => {
    const slot = slotsObj[key];
    if (!slot) return;
    const pStr = String(slot.period !== undefined && slot.period !== null ? slot.period : '');
    const pClean = pStr ? (pStr.startsWith('P') ? pStr : `P${pStr}`) : (key.split('_')[1] ? (key.split('_')[1].startsWith('P') ? key.split('_')[1] : `P${key.split('_')[1]}`) : 'P1');
    entries.push({
      id: slot._id || slot.id || uid(),
      day: slot.day || key.split('_')[0],
      period: pClean,
      duration: slot.span || slot.duration || 1,
      subject: slot.subject || '',
      subjectId: slot.subjectId || null,
      teacher: slot.teacher || '',
      teacherId: slot.teacherId || null,
      teacherTrackId: slot.teacherTrackId || '',
      room: slot.room || '',
      roomId: slot.roomId || null,
      section: state.filterSection,
      type: slot.isLab ? 'Lab' : 'Theory',
      status: state.env === 'production' ? 'published' : 'draft',
      comment: slot.state || ''
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
    subjectId: slot.subjectId || null,
    teacher: slot.teacher || '',
    teacherId: slot.teacherId || null,
    teacherTrackId: slot.teacherTrackId || '',
    room: slot.room || '',
    roomId: slot.roomId || null,
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
    subjectId: e.subjectId || null,
    teacher: e.teacher,
    teacherId: e.teacherId || null,
    teacherTrackId: e.teacherTrackId || '',
    room: e.room,
    roomId: e.roomId || null,
    isLab: e.type === 'Lab',
    span: Number(e.duration || 1),
    state: e.comment || ''
  }));
}

function getSelectedClassId(tabId) {
  let className = state.filterSection;
  if (tabId && window.workspace) {
    const tab = window.workspace.getTab(tabId);
    if (tab && tab.viewParams?.sectionName) {
      className = tab.viewParams.sectionName;
    } else if (tab && tab.viewParams?.classId) {
      const byId = _masterData.classes?.find(c => String(c._id) === String(tab.viewParams.classId));
      if (byId) return byId._id;
    }
  }
  if (!className || !_masterData.classes) return null;
  const cls = _masterData.classes.find(c => c.name === className);
  return cls ? cls._id : null;
}

// ── Server Persistence Queue & Concurrency Control ──
const _tabPersistPromises = new Map();
const _tabPendingPersists = new Set();

async function persistState() {
  if (isReadOnlyMode()) return;
  const currentTabId = window.workspace?.activeTabId || '_default';

  if (_tabPersistPromises.has(currentTabId)) {
    _tabPendingPersists.add(currentTabId);
    return _tabPersistPromises.get(currentTabId);
  }

  const promise = (async () => {
    while (true) {
      _tabPendingPersists.delete(currentTabId);
      state.saving = true;
      setLiveSyncStatus('saving', 'Saving..');
      try {
        const classId = getSelectedClassId(currentTabId !== '_default' ? currentTabId : null);
        if (!classId) {
          state.saving = false;
          updateLiveSyncFromCurrentState();
          return notify('Select a class/section first', 'warn');
        }

        const currentEntries = (currentTabId && state.tabData && state.tabData[currentTabId]?.entries)
          ? state.tabData[currentTabId].entries
          : state.entries;
        const grid = entriesToGrid(currentEntries);

        const currentDraftId = (currentTabId && state.tabData && state.tabData[currentTabId]?.draftTemplateId)
          || state.draftTemplateId;

        if (currentDraftId) {
          await apiCall('PUT', '/timetable/semester-templates/' + currentDraftId, { grid });
        } else {
          const created = await apiCall('POST', '/timetable/semester-templates', {
            classId,
            grid,
            status: 'draft'
          });
          state.draftTemplateId = created._id;
          state.devSource = 'development';
          if (currentTabId && state.tabData && state.tabData[currentTabId]) {
            state.tabData[currentTabId].draftTemplateId = created._id;
            state.tabData[currentTabId].devSource = 'development';
          }
        }

        // If another drop/mutation happened while this save was in flight, re-run loop
        if (_tabPendingPersists.has(currentTabId)) {
          continue;
        }

        if (currentTabId && state.tabData && state.tabData[currentTabId]) {
          state.tabData[currentTabId].dirty = false;
          state.tabData[currentTabId].draftTemplateId = state.draftTemplateId;
          state.tabData[currentTabId].devSource = 'development';
        }
        if (window.workspace?.markDirty && currentTabId !== '_default') {
          window.workspace.markDirty(currentTabId, false);
        }
        if (!window.workspace?.activeTabId || window.workspace.activeTabId === currentTabId) {
          state.dirty = false;
          state.saving = false;
          updateLiveSyncFromCurrentState();
        }
        break;
      } catch (err) {
        state.saving = false;
        setLiveSyncStatus('error', 'Error');
        notify('Save failed: ' + err.message, 'error');
        break;
      }
    }
  })().finally(() => {
    _tabPersistPromises.delete(currentTabId);
  });

  _tabPersistPromises.set(currentTabId, promise);
  return promise;
}

// ── Entry Conflict Detection Engine ──
function activeEntries(tabId) {
  const source = getRawActiveEntries(tabId);
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

function conflictsFor(candidate, collection = null, ignoreId = null) {
  const currentEntries = collection || activeEntries();
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

  // 1. Cross-check against active entries in the current section
  currentEntries.filter(x => x.id !== ignoreId && overlaps(candidate, x)).forEach(x => {
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

  // 2. In Development mode, cross-check against other classes' drafts + production fallback (from _slotSourceCache)
  if (state.env === 'development' && _slotSourceCache.data && _slotSourceCache.data.length) {
    const candidateSection = candidate.section || state.filterSection;
    _slotSourceCache.data.forEach(st => {
      const clsName = st.className || 'General';
      if (clsName === candidateSection) return; // already cross-checked in current section

      const slots = st.slots || {};
      Object.keys(slots).forEach(key => {
        const slot = slots[key];
        if (!slot) return;
        const pStr = String(slot.period !== undefined && slot.period !== null ? slot.period : '');
        const pCode = pStr ? (pStr.startsWith('P') ? pStr : `P${pStr}`) : (key.split('_')[1] ? (key.split('_')[1].startsWith('P') ? key.split('_')[1] : `P${key.split('_')[1]}`) : 'P1');
        const otherEntry = {
          day: slot.day || key.split('_')[0],
          period: pCode,
          duration: slot.span || slot.duration || 1,
          teacher: slot.teacher,
          room: slot.room,
          subject: slot.subject,
          section: clsName
        };

        if (overlaps(candidate, otherEntry)) {
          if (slot.teacher && slot.teacher === candidate.teacher) {
            conflicts.push({
              kind: 'faculty',
              message: `❌ Faculty double-booked: ${candidate.teacher} is assigned in ${clsName} (${st._source === 'development' ? 'draft' : 'production'}) on ${otherEntry.day} at ${timeFor(candidate.period)}.`
            });
          }
          if (slot.room && slot.room === candidate.room) {
            conflicts.push({
              kind: 'room',
              message: `Room conflict: ${candidate.room} is occupied by ${clsName} (${st._source === 'development' ? 'draft' : 'production'}) on ${otherEntry.day} at ${timeFor(candidate.period)}.`
            });
          }
        }
      });
    });
  }

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

function allConflicts(entries = null) {
  const currentEntries = entries || activeEntries();
  return currentEntries.flatMap(entry => conflictsFor(entry, currentEntries, entry.id).map(conflict => ({ ...conflict, entry })));
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
  const count = allConflicts(activeEntries()).length;
  return count
    ? `<span class="pill red">⚠️ ${count} Conflict${count === 1 ? '' : 's'}</span>`
    : '<span class="pill">✓ Validated</span>';
}

// ── Academic Calendar & Syllabus Horizon Integration (Item 12) ──

function renderAcademicCalendarBar() {
  const cal = state.academicCalendar;
  if (!cal) return '';

  const workingDays = cal.workingDaysCount || 0;
  const weeksRemaining = cal.teachingWeeksRemaining || Math.max(1, Math.round(workingDays / 5));
  const holidays = cal.holidaysCount || 0;
  const satCount = cal.workingSaturdaysCount || 0;
  const subjects = cal.subjects || [];
  const upcomingHols = cal.upcomingHolidays || [];

  return `
    <div class="academic-strip">
      <div class="academic-strip-meta">
        <span style="font-weight:700;color:var(--td);display:inline-flex;align-items:center;gap:4px">
          🎓 Term Horizon:
        </span>
        <span class="academic-stat-badge" title="Estimated Instructional Working Days Remaining">
          📅 <b>${workingDays}</b> Working Days (~<b>${weeksRemaining}</b> Weeks)
        </span>
        <span class="academic-stat-badge holiday" title="Institutional Holidays in Current Planning Window">
          🏖️ <b>${holidays}</b> Holidays
        </span>
        ${satCount > 0 ? `
          <span class="academic-stat-badge saturday" title="Instructional Working Saturdays Scheduled">
            💼 <b>${satCount}</b> Working Saturdays
          </span>
        ` : ''}
        ${upcomingHols.length ? `
          <span style="font-size:11.5px;color:var(--tmu)">
            Next Holiday: <b>${esc(upcomingHols[0].name)}</b> (${esc(upcomingHols[0].date)})
          </span>
        ` : ''}
      </div>
      <div>
        <button type="button" class="academic-stat-badge coverage-btn" id="open-syllabus-coverage-btn">
          📚 Subject Coverage &amp; Teaching Periods (${subjects.length}) →
        </button>
      </div>
    </div>
  `;
}

function openSyllabusCoverageModal() {
  const cal = state.academicCalendar;
  if (!cal) return notify('Academic calendar metrics not loaded.', 'info');

  const subjects = cal.subjects || [];
  const workingDays = cal.workingDaysCount || 0;
  const weeks = cal.teachingWeeksRemaining || 1;
  const hols = cal.upcomingHolidays || [];
  const sats = cal.workingSaturdays || [];

  const totalPeriods = subjects.reduce((sum, s) => sum + (s.actualTeachingPeriodsRemaining || 0), 0);
  const totalHours = Math.round(subjects.reduce((sum, s) => sum + (s.estimatedSyllabusHours || 0), 0) * 10) / 10;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-bg open';
  backdrop.id = 'syllabus-coverage-modal';

  backdrop.innerHTML = `
    <div class="modal modal-lg" style="max-width:760px">
      <div class="modal-hd">
        <div>
          <div class="modal-eyebrow" style="color:var(--gM,#388e3c)">ACADEMIC CALENDAR PLANNING HORIZON</div>
          <h2 class="modal-title">📚 Teaching Periods &amp; Syllabus Coverage</h2>
          <div class="modal-sub">
            Class: <b>${esc(state.filterSection || 'Current Section')}</b> · <b>${workingDays}</b> Instructional Days Remaining (~<b>${weeks}</b> Teaching Weeks)
          </div>
        </div>
        <button type="button" class="modal-close" id="close-coverage-modal">×</button>
      </div>

      <div class="modal-body" style="padding:10px 0 16px">
        <!-- KPI summary -->
        <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:10px;margin-bottom:14px">
          <div class="publish-impact-card">
            <div class="publish-impact-val">${workingDays}</div>
            <div class="publish-impact-lbl">Working Days</div>
          </div>
          <div class="publish-impact-card">
            <div class="publish-impact-val">~${weeks}</div>
            <div class="publish-impact-lbl">Weeks Remaining</div>
          </div>
          <div class="publish-impact-card green">
            <div class="publish-impact-val" style="color:#16a34a">${totalPeriods}</div>
            <div class="publish-impact-lbl">Total Periods</div>
          </div>
          <div class="publish-impact-card amber">
            <div class="publish-impact-val" style="color:#d97706">${totalHours}h</div>
            <div class="publish-impact-lbl">Instruction Hours</div>
          </div>
        </div>

        <!-- Subject breakdown table -->
        <div style="border:1px solid var(--br);border-radius:10px;overflow:hidden;margin-bottom:14px">
          <table class="table" style="font-size:12px;margin:0">
            <thead>
              <tr>
                <th>Subject Name</th>
                <th>Periods / Wk</th>
                <th>Periods Remaining</th>
                <th>Est. Syllabus Hours</th>
                <th>Faculty Assigned</th>
              </tr>
            </thead>
            <tbody>
              ${subjects.length ? subjects.map(s => `<tr>
                <td>
                  <b>${esc(s.subject)}</b>
                  <span class="pill ${s.isLab ? 'warn' : ''}" style="margin-left:6px;font-size:10px">${s.isLab ? 'Lab' : 'Theory'}</span>
                </td>
                <td><span style="font-family:'DM Mono',monospace;font-weight:700">${s.periodsPerWeek} / wk</span></td>
                <td><span class="pill pri"><b>${s.actualTeachingPeriodsRemaining}</b> periods</span></td>
                <td><span style="font-family:'DM Mono',monospace;font-weight:600;color:var(--td)">${s.estimatedSyllabusHours} hrs</span></td>
                <td style="color:var(--tmu);font-size:11.5px">👤 ${esc(s.teacher || 'Unassigned')}</td>
              </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--tmu)">No subjects allocated in current schedule.</td></tr>`}
            </tbody>
          </table>
        </div>

        <!-- Upcoming Holidays & Working Saturdays -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="padding:10px 14px;background:var(--gP);border:1px solid var(--br);border-radius:10px">
            <div style="font-size:11.5px;font-weight:700;color:#b91c1c;text-transform:uppercase;margin-bottom:6px">
              🏖️ Upcoming Holidays (${hols.length})
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;max-height:100px;overflow-y:auto">
              ${hols.length ? hols.map(h => `
                <div style="font-size:11.5px;color:var(--td);display:flex;justify-content:space-between">
                  <span>${esc(h.name)}</span>
                  <span style="font-family:'DM Mono',monospace;color:var(--tmu)">${esc(h.date)}</span>
                </div>
              `).join('') : '<span style="font-size:11px;color:var(--tmu)">No holidays in current window.</span>'}
            </div>
          </div>

          <div style="padding:10px 14px;background:var(--gP);border:1px solid var(--br);border-radius:10px">
            <div style="font-size:11.5px;font-weight:700;color:#b45309;text-transform:uppercase;margin-bottom:6px">
              💼 Instructional Saturdays (${sats.length})
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;max-height:100px;overflow-y:auto">
              ${sats.length ? sats.map(s => `
                <div style="font-size:11.5px;color:var(--td);display:flex;justify-content:space-between">
                  <span>${esc(s.note)}</span>
                  <span style="font-family:'DM Mono',monospace;color:var(--tmu)">${esc(s.date)}</span>
                </div>
              `).join('') : '<span style="font-size:11px;color:var(--tmu)">No working Saturdays scheduled.</span>'}
            </div>
          </div>
        </div>
      </div>

      <div class="modal-ft" style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
        <button type="button" class="btn-pri" id="dismiss-coverage-modal">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const closeModal = () => {
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 150);
  };

  backdrop.querySelector('#close-coverage-modal')?.addEventListener('click', closeModal);
  backdrop.querySelector('#dismiss-coverage-modal')?.addEventListener('click', closeModal);
}

function renderKpis(entries) {
  const conflicts = allConflicts(entries).length;
  const facultyCount = new Set(entries.map(x => x.teacher).filter(Boolean)).size;
  const roomCount = new Set(entries.map(x => x.room).filter(Boolean)).size;

  return `<div class="stats-grid">
    <div class="stat-card">
      <span class="stat-kicker">Scheduled Slots</span>
      <div class="stat-value">${entries.length}</div>
      <span class="stat-desc">${state.env === 'production' ? 'Live published slots' : 'Draft development slots'}</span>
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

function parseClassBatch(str) {
  if (!str) return '';
  // Support ASCII hyphen -, en-dash –, em-dash —, and slash /
  const m = String(str).match(/\b\d{4}\s*[-–—\/]\s*\d{4}\b/);
  return m ? m[0].replace(/[\u2013\u2014]/g, '-') : '';
}

function parseClassDept(str) {
  if (!str) return '';
  // 1. Remove 4-digit batches (e.g. 2025-2029, 2025–2029) and standalone 4-digit years (e.g. 2025)
  let clean = String(str)
    .replace(/\b\d{4}\s*[-–—\/]\s*\d{4}\b/g, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .trim();
  
  // 2. Extract department code (letters only, e.g. "AIML", "CSE", "CIVIL", "CSD")
  const m = clean.match(/^([A-Za-z]+)(?:-[A-Za-z0-9]+|\s*-\s*[A-Za-z0-9]+)?/);
  if (m && m[1] && m[1].length >= 2) return m[1].toUpperCase();

  const parts = clean.split(/[^A-Za-z0-9]+/);
  const found = parts.find(p => /^[A-Za-z]{2,}$/.test(p));
  return found ? found.toUpperCase() : '';
}

function getAvailableDepartments() {
  const map = new Map();

  // Helper to validate dept code: must have at least 2 characters, contain letters, and NOT be purely numeric
  const isValidDeptCode = code => {
    if (!code || typeof code !== 'string') return false;
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 2) return false;
    if (/^\d+$/.test(trimmed)) return false; // Rejects pure numbers like "2025"
    if (!/[A-Za-z]/.test(trimmed)) return false;
    return true;
  };

  // 1. From _masterData.departments
  if (Array.isArray(_masterData.departments)) {
    _masterData.departments.forEach(d => {
      const code = (d.code || d.deptCode || '').trim().toUpperCase();
      const name = (d.name || d.deptName || '').trim();
      if (isValidDeptCode(code)) {
        map.set(code, { code, name: name || code });
      }
    });
  }

  // 2. From _masterData.classes
  if (Array.isArray(_masterData.classes)) {
    _masterData.classes.forEach(c => {
      const rawCode = c.deptCode || (c.name ? parseClassDept(c.name) : '');
      const code = String(rawCode || '').trim().toUpperCase();
      const name = (c.deptName || code).trim();
      if (isValidDeptCode(code) && !map.has(code)) {
        map.set(code, { code, name });
      }
    });
  }

  // 3. From SECTIONS
  SECTIONS.forEach(sec => {
    const code = parseClassDept(sec).trim().toUpperCase();
    if (isValidDeptCode(code) && !map.has(code)) {
      map.set(code, { code, name: code });
    }
  });

  return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
}

function getAvailableBatches() {
  const set = new Set();
  if (Array.isArray(_masterData.classes)) {
    _masterData.classes.forEach(c => {
      const b = parseClassBatch(c.batch || c.name || '');
      if (b) set.add(b);
    });
  }
  SECTIONS.forEach(sec => {
    const b = parseClassBatch(sec);
    if (b) set.add(b);
  });
  return Array.from(set).sort().reverse();
}

function getFilteredSections() {
  const dept = (state.filterDept || 'all').trim().toUpperCase();
  const batch = (state.filterBatch || 'all').trim().replace(/[\u2013\u2014]/g, '-');

  return SECTIONS.filter(sec => {
    const classObj = (_masterData.classes || []).find(c => c.name === sec);
    const secDept = (classObj?.deptCode || parseClassDept(sec)).trim().toUpperCase();
    const secBatch = (classObj?.batch || parseClassBatch(sec)).trim().replace(/[\u2013\u2014]/g, '-');

    if (dept !== 'ALL' && secDept && secDept !== dept) {
      return false;
    }
    if (batch !== 'ALL' && batch !== 'all' && secBatch && secBatch !== batch) {
      return false;
    }
    return true;
  });
}

function renderClassSelectorBar() {
  if (!SECTIONS.length) {
    return `<div class="tt-class-selector-card">
      <div style="font-size:13px;color:var(--tmu);">No classes or sections available in EAMS master data.</div>
    </div>`;
  }
  const curSection = state.filterSection || (SECTIONS.length ? SECTIONS[0] : 'General');
  const curDept = (state.filterDept || 'all').trim();
  const curBatch = (state.filterBatch || 'all').trim();
  
  const depts = getAvailableDepartments();
  const batches = getAvailableBatches();
  const filteredSections = getFilteredSections();

  const currentDeptLabel = curDept === 'all' ? 'All Depts' : (depts.find(d => d.code.toUpperCase() === curDept.toUpperCase())?.code || curDept);
  const currentBatchLabel = curBatch === 'all' ? 'All Batches' : curBatch;
  const isFiltered = curDept !== 'all' || curBatch !== 'all';

  return `<div class="tt-class-selector-card" id="tt-class-selector-card">
    <div class="tt-class-selector-left" onclick="event.stopPropagation(); toggleClassDropdown(this);" style="cursor:pointer;" title="Click to search and select class">
      <div class="tt-class-selector-icon">🏫</div>
      <div class="tt-class-selector-details">
        <div class="tt-class-selector-label">Class &amp; Section Matrix</div>
        <div class="tt-class-selector-sub">Filter by department and batch to select active class</div>
      </div>
    </div>

    <div class="tt-class-selector-right">
      <div class="tt-cascade-flow">
        <!-- 1. DEPARTMENT SELECTOR -->
        <div class="tt-cascade-dropdown" id="tt-dept-dropdown">
          <div class="tt-cascade-trigger ${curDept !== 'all' ? 'has-filter' : ''}" id="tt-dept-trigger" onclick="event.stopPropagation(); toggleDeptDropdown(this);" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false" title="Filter by Department">
            <span class="tt-cascade-trigger-icon">🏢</span>
            <span class="tt-cascade-trigger-text" id="tt-selected-dept-label">${esc(currentDeptLabel)}</span>
            <span class="tt-cascade-trigger-arrow">▾</span>
          </div>
          <div class="tt-cascade-menu" id="tt-dept-menu" role="listbox" style="display:none;">
            <div class="tt-cascade-menu-header">
              <span>Department</span>
              ${curDept !== 'all' ? '<button type="button" class="tt-cascade-reset" onclick="event.stopPropagation(); selectDepartment(\'all\');" data-action="reset-dept">Reset</button>' : ''}
            </div>
            <div class="tt-cascade-list">
              <div class="tt-cascade-item ${curDept === 'all' ? 'selected' : ''}" data-type="dept" data-value="all" onclick="event.stopPropagation(); selectDepartment('all');" role="option">
                <span class="tt-cascade-item-dot"></span>
                <span class="tt-cascade-item-name">All Departments</span>
                ${curDept === 'all' ? '<span class="tt-cascade-item-check">✓</span>' : ''}
              </div>
              ${depts.map(d => `
                <div class="tt-cascade-item ${curDept.toUpperCase() === d.code.toUpperCase() ? 'selected' : ''}" data-type="dept" data-value="${esc(d.code)}" onclick="event.stopPropagation(); selectDepartment('${esc(d.code)}');" role="option">
                  <span class="tt-cascade-item-dot"></span>
                  <div class="tt-cascade-item-details">
                    <span class="tt-cascade-item-name">${esc(d.code)}</span>
                    ${d.name && d.name !== d.code ? `<span class="tt-cascade-item-sub">${esc(d.name)}</span>` : ''}
                  </div>
                  ${curDept.toUpperCase() === d.code.toUpperCase() ? '<span class="tt-cascade-item-check">✓</span>' : ''}
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- 2. BATCH SELECTOR -->
        <div class="tt-cascade-dropdown" id="tt-batch-dropdown">
          <div class="tt-cascade-trigger ${curBatch !== 'all' ? 'has-filter' : ''}" id="tt-batch-trigger" onclick="event.stopPropagation(); toggleBatchDropdown(this);" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false" title="Filter by Academic Batch">
            <span class="tt-cascade-trigger-icon">📅</span>
            <span class="tt-cascade-trigger-text" id="tt-selected-batch-label">${esc(currentBatchLabel)}</span>
            <span class="tt-cascade-trigger-arrow">▾</span>
          </div>
          <div class="tt-cascade-menu" id="tt-batch-menu" role="listbox" style="display:none;">
            <div class="tt-cascade-menu-header">
              <span>Academic Batch</span>
              ${curBatch !== 'all' ? '<button type="button" class="tt-cascade-reset" onclick="event.stopPropagation(); selectBatch(\'all\');" data-action="reset-batch">Reset</button>' : ''}
            </div>
            <div class="tt-cascade-list">
              <div class="tt-cascade-item ${curBatch === 'all' ? 'selected' : ''}" data-type="batch" data-value="all" onclick="event.stopPropagation(); selectBatch('all');" role="option">
                <span class="tt-cascade-item-dot"></span>
                <span class="tt-cascade-item-name">All Batches</span>
                ${curBatch === 'all' ? '<span class="tt-cascade-item-check">✓</span>' : ''}
              </div>
              ${batches.map(b => `
                <div class="tt-cascade-item ${curBatch === b ? 'selected' : ''}" data-type="batch" data-value="${esc(b)}" onclick="event.stopPropagation(); selectBatch('${esc(b)}');" role="option">
                  <span class="tt-cascade-item-dot"></span>
                  <span class="tt-cascade-item-name">${esc(b)}</span>
                  ${curBatch === b ? '<span class="tt-cascade-item-check">✓</span>' : ''}
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- 3. CLASS / SECTION SEARCHABLE DROPDOWN -->
        <div class="tt-custom-dropdown" id="tt-class-dropdown">
          <input type="hidden" id="section-filter" value="${esc(curSection)}">
          
          <div class="tt-dropdown-trigger" id="tt-class-dropdown-trigger" onclick="event.stopPropagation(); toggleClassDropdown(this);" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false" title="Click to search and select class">
            <div class="tt-dropdown-trigger-left">
              <span class="tt-dropdown-trigger-icon">🏛️</span>
              <span class="tt-dropdown-trigger-text" id="tt-selected-class-label">${esc(curSection)}</span>
            </div>
            <div class="tt-dropdown-trigger-right">
              <span class="tt-dropdown-trigger-badge">${filteredSections.length} ${filteredSections.length === 1 ? 'Class' : 'Classes'}</span>
              <span class="tt-dropdown-trigger-arrow">▾</span>
            </div>
          </div>

          <div class="tt-dropdown-menu" id="tt-class-dropdown-menu" role="listbox" style="display:none;">
            <div class="tt-dropdown-search-box">
              <span class="tt-dropdown-search-icon">🔍</span>
              <input type="text" class="tt-dropdown-search-input" id="tt-class-search-input" oninput="filterClassDropdown(this.value, this)" placeholder="Search class or section… (e.g. AIML, CSE)" autocomplete="off" spellcheck="false">
              <button type="button" class="tt-dropdown-search-clear" id="tt-class-search-clear" onclick="event.stopPropagation(); const si = this.closest('.tt-custom-dropdown').querySelector('.tt-dropdown-search-input'); if(si){ si.value=''; filterClassDropdown('', si); si.focus(); }" style="display:none;" title="Clear search">✕</button>
            </div>

            <div class="tt-dropdown-menu-header">
              <span class="tt-dropdown-menu-header-title" id="tt-dropdown-count-text">${isFiltered ? `Filtered Classes (${filteredSections.length})` : `Available Classes (${SECTIONS.length})`}</span>
              <span class="tt-dropdown-menu-header-hint">${isFiltered ? 'Filtered by Dept/Batch' : 'Click or press Enter'}</span>
            </div>

            <div class="tt-dropdown-list" id="tt-class-options-list">
              ${filteredSections.length ? filteredSections.map(sec => {
                const isSelected = sec === curSection;
                return `<div class="tt-dropdown-item ${isSelected ? 'selected' : ''}" data-value="${esc(sec)}" onclick="event.stopPropagation(); selectClassSection('${esc(sec)}', this);" role="option" aria-selected="${isSelected ? 'true' : 'false'}">
                  <div class="tt-dropdown-item-left">
                    <span class="tt-dropdown-item-dot"></span>
                    <span class="tt-dropdown-item-text">${esc(sec)}</span>
                  </div>
                  <div class="tt-dropdown-item-right">
                    ${isSelected ? '<span class="tt-dropdown-item-badge">Active</span>' : ''}
                    <span class="tt-dropdown-item-check">${isSelected ? '✓' : ''}</span>
                  </div>
                </div>`;
              }).join('') : `
                <div style="padding:16px 12px;text-align:center;font-size:12px;color:var(--tmu);">
                  No classes found matching active Department &amp; Batch filters.
                </div>
              `}
            </div>

            <div class="tt-dropdown-empty" id="tt-class-dropdown-empty" style="display:none;">
              <span class="tt-dropdown-empty-icon">🔍</span>
              <div class="tt-dropdown-empty-title">No matching classes found</div>
              <div class="tt-dropdown-empty-desc">No section matches "<span id="tt-empty-query"></span>"</div>
            </div>
          </div>
        </div>        
      </div>
    </div>
  </div>`;
}

function closeCascadeDropdowns() {
  document.querySelectorAll('.tt-cascade-dropdown, .tt-custom-dropdown').forEach(dd => {
    dd.classList.remove('is-open');
    const menu = dd.querySelector('.tt-cascade-menu, .tt-dropdown-menu');
    if (menu) menu.style.display = 'none';
    const trigger = dd.querySelector('.tt-cascade-trigger, .tt-dropdown-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  });
  document.querySelectorAll('#tt-class-selector-card, #tt-faculty-selector-card, #tt-room-selector-card, #tt-subject-selector-card, .tt-class-selector-card').forEach(card => {
    card.classList.remove('dropdown-active');
  });
}

function getActiveCard() {
  const activePane = document.querySelector('.tt-tab-pane:not([hidden])');
  if (activePane) {
    const card = activePane.querySelector('#tt-class-selector-card');
    if (card) return card;
  }
  return document.getElementById('tt-class-selector-card');
}

function toggleDeptDropdown(triggerEl) {
  const card = triggerEl ? triggerEl.closest('.tt-class-selector-card') : getActiveCard();
  const dd = card ? card.querySelector('#tt-dept-dropdown') : document.getElementById('tt-dept-dropdown');
  const isOpen = dd && dd.classList.contains('is-open');
  closeCascadeDropdowns();
  if (!isOpen && dd) {
    if (card) card.classList.add('dropdown-active');
    dd.classList.add('is-open');
    const menu = dd.querySelector('.tt-cascade-menu') || document.getElementById('tt-dept-menu');
    if (menu) menu.style.display = 'block';
    const trigger = dd.querySelector('.tt-cascade-trigger') || document.getElementById('tt-dept-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }
}

function toggleBatchDropdown(triggerEl) {
  const card = triggerEl ? triggerEl.closest('.tt-class-selector-card') : getActiveCard();
  const dd = card ? card.querySelector('#tt-batch-dropdown') : document.getElementById('tt-batch-dropdown');
  const isOpen = dd && dd.classList.contains('is-open');
  closeCascadeDropdowns();
  if (!isOpen && dd) {
    if (card) card.classList.add('dropdown-active');
    dd.classList.add('is-open');
    const menu = dd.querySelector('.tt-cascade-menu') || document.getElementById('tt-batch-menu');
    if (menu) menu.style.display = 'block';
    const trigger = dd.querySelector('.tt-cascade-trigger') || document.getElementById('tt-batch-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }
}

function selectDepartment(deptCode) {
  state.filterDept = deptCode || 'all';
  closeCascadeDropdowns();
  
  const filtered = getFilteredSections();
  if (filtered.length > 0 && !filtered.includes(state.filterSection)) {
    state.filterSection = filtered[0];
    onSectionChange(filtered[0]);
  } else {
    render();
  }
}

function selectBatch(batchVal) {
  state.filterBatch = batchVal || 'all';
  closeCascadeDropdowns();

  const filtered = getFilteredSections();
  if (filtered.length > 0 && !filtered.includes(state.filterSection)) {
    state.filterSection = filtered[0];
    onSectionChange(filtered[0]);
  } else {
    render();
  }
}

function openClassDropdown(triggerEl) {
  const card = triggerEl ? triggerEl.closest('.tt-class-selector-card') : getActiveCard();
  const dd = card ? card.querySelector('#tt-class-dropdown') : document.getElementById('tt-class-dropdown');
  const menu = dd ? (dd.querySelector('.tt-dropdown-menu') || document.getElementById('tt-class-dropdown-menu')) : document.getElementById('tt-class-dropdown-menu');
  const trigger = dd ? (dd.querySelector('.tt-dropdown-trigger') || document.getElementById('tt-class-dropdown-trigger')) : document.getElementById('tt-class-dropdown-trigger');
  const searchInput = dd ? (dd.querySelector('.tt-dropdown-search-input') || document.getElementById('tt-class-search-input')) : document.getElementById('tt-class-search-input');
  if (!dd || !menu) return;

  closeCascadeDropdowns();

  dd.classList.add('is-open');
  if (card) card.classList.add('dropdown-active');
  menu.style.display = 'block';
  if (trigger) trigger.setAttribute('aria-expanded', 'true');

  if (searchInput) {
    searchInput.value = '';
    filterClassDropdown('', searchInput);
    setTimeout(() => searchInput.focus(), 30);
  }

  const activeItem = menu.querySelector('.tt-dropdown-item.selected');
  if (activeItem) {
    activeItem.scrollIntoView({ block: 'nearest' });
  }
}

function closeClassDropdown() {
  closeCascadeDropdowns();
}

function toggleClassDropdown(triggerEl) {
  const card = triggerEl ? triggerEl.closest('.tt-class-selector-card') : getActiveCard();
  const dd = card ? card.querySelector('#tt-class-dropdown') : document.getElementById('tt-class-dropdown');
  if (dd && dd.classList.contains('is-open')) {
    closeCascadeDropdowns();
  } else {
    openClassDropdown(triggerEl);
  }
}

function filterClassDropdown(rawQuery, inputEl) {
  const q = String(rawQuery || '').trim().toLowerCase();
  const dd = inputEl ? inputEl.closest('#tt-class-dropdown') : (getActiveCard()?.querySelector('#tt-class-dropdown') || document.getElementById('tt-class-dropdown'));
  if (!dd) return;
  const list = dd.querySelector('#tt-class-options-list');
  const emptyBox = dd.querySelector('#tt-class-dropdown-empty');
  const emptyQuerySpan = dd.querySelector('#tt-empty-query');
  const clearBtn = dd.querySelector('#tt-class-search-clear');
  const countText = dd.querySelector('#tt-dropdown-count-text');
  if (!list) return;

  const items = list.querySelectorAll('.tt-dropdown-item');
  let matches = 0;
  items.forEach(item => {
    const val = (item.dataset.value || '').toLowerCase();
    const isMatch = !q || val.includes(q);
    item.style.display = isMatch ? 'flex' : 'none';
    if (isMatch) matches++;
  });

  if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';
  if (countText) {
    const isFiltered = (state.filterDept && state.filterDept !== 'all') || (state.filterBatch && state.filterBatch !== 'all');
    countText.textContent = q ? `${matches} matching class${matches === 1 ? '' : 'es'}` : (isFiltered ? `Filtered Classes (${items.length})` : `Available Classes (${SECTIONS.length})`);
  }
  if (emptyBox) {
    emptyBox.style.display = matches === 0 ? 'flex' : 'none';
    if (emptyQuerySpan) emptyQuerySpan.textContent = rawQuery;
  }
}

function selectClassSection(val, itemEl) {
  if (!val) return;
  const card = itemEl ? itemEl.closest('.tt-class-selector-card') : getActiveCard();
  const hiddenInput = card ? card.querySelector('#section-filter') : document.getElementById('section-filter');
  if (hiddenInput) {
    hiddenInput.value = val;
  }
  const label = card ? card.querySelector('#tt-selected-class-label') : document.getElementById('tt-selected-class-label');
  if (label) label.textContent = val;
  const badgeText = document.querySelector('.tt-class-badge-text');
  if (badgeText) badgeText.textContent = val;

  const list = card ? card.querySelector('#tt-class-options-list') : document.getElementById('tt-class-options-list');
  if (list) {
    list.querySelectorAll('.tt-dropdown-item').forEach(item => {
      const isSel = item.dataset.value === val;
      item.classList.toggle('selected', isSel);
      item.setAttribute('aria-selected', isSel ? 'true' : 'false');
      const badge = item.querySelector('.tt-dropdown-item-badge');
      const check = item.querySelector('.tt-dropdown-item-check');
      if (badge) badge.style.display = isSel ? 'inline-block' : 'none';
      if (check) check.textContent = isSel ? '✓' : '';
    });
  }

  closeClassDropdown();
  onSectionChange(val);
}

window.toggleClassDropdown = toggleClassDropdown;
window.openClassDropdown = openClassDropdown;
window.closeClassDropdown = closeClassDropdown;
window.toggleDeptDropdown = toggleDeptDropdown;
window.toggleBatchDropdown = toggleBatchDropdown;
window.selectDepartment = selectDepartment;
window.selectBatch = selectBatch;
window.selectClassSection = selectClassSection;
window.filterClassDropdown = filterClassDropdown;

function controls(includeSection = false) {
  if (!SECTIONS.length) {
    return `<div class="filters"><span style="font-size:13px;color:var(--tmu)">No sections available in EAMS master data.</span></div>`;
  }
  const isDev = state.env === 'development';
  return `<div class="filters">
    <input class="select search-input" id="entry-search" placeholder="🔍 Search subject, faculty or room…" value="${esc(state.search)}">
    <button type="button" class="btn-out" id="clear-filters" style="padding:6px 16px;font-size:12px">Clear</button>
    ${isDev ? `
      <div style="display:flex;gap:6px;margin-left:auto;">
        <button type="button" class="btn-out btn-undo" id="undo-btn" ${!undoStack.length ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} title="Undo last change (Ctrl+Z)" style="padding:6px 12px;font-size:11.5px">↶ Undo</button>
        <button type="button" class="btn-out btn-redo" id="redo-btn" ${!redoStack.length ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} title="Redo last change (Ctrl+Y)" style="padding:6px 12px;font-size:11.5px">↷ Redo</button>
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
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="day-label">${day}</div>
          ${editable ? `<button type="button" class="duplicate-day-btn" data-day="${day}" title="Duplicate ${day}'s schedule to another day">📋</button>` : ''}
        </div>
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

        // Check if there is an active substitution for this slot (Item 6)
        const pNum = parseInt(period[0].replace(/\D/g, ''), 10) || 1;
        const sub = (state.substitutions || []).find(s =>
          (s.day === day || s.day === entry.day) &&
          (Number(s.period) === pNum || s.periodCode === period[0])
        );

        // Check if assigned teacher is on approved leave (and no sub assigned yet) (Item 6)
        const tLower = (entry.teacher || '').toLowerCase();
        const teacherOnLeave = !sub && (state.activeLeaves || []).find(l =>
          (l.teacherName || '').toLowerCase() === tLower
        );

        const isSubstituted = Boolean(sub);
        const classes = `${entry.type === 'Lab' ? 'lab' : ''} ${isCombined ? 'combined' : ''} ${isSubstituted ? 'substituted' : ''} ${teacherOnLeave ? 'on-leave' : ''} ${subjectTone(entry.subject)} ${conflictCount ? 'has-conflict' : ''}`;
        const displaySub = formatSubjectDisplay(entry.subject);
        const displayRoom = isSubstituted && sub.room ? sub.room : entry.room;

        html += `<td colspan="${span}">
          <button type="button" class="slot ${classes}" data-entry-id="${entry.id}" data-day="${day}" data-period="${period[0]}" draggable="${editable ? 'true' : 'false'}" aria-label="${esc(displaySub)} ${day}">
            <div>
              <div class="slot-subject">${esc(displaySub)}</div>
              ${isSubstituted ? `
                <div class="slot-staff" style="color:#92400e;" title="Substitute: ${esc(sub.substituteTeacher)}">🔄 ${esc(sub.substituteTeacher)}</div>
              ` : `
                <div class="slot-staff">${esc(entry.teacher || '—')}</div>
                ${teacherOnLeave ? `
                  <div style="margin-top:2px">
                    <span class="slot-leave-badge" title="Faculty is on approved leave (${esc(teacherOnLeave.leaveType || 'Leave')})">
                      🏖️ On Leave
                    </span>
                  </div>
                ` : ''}
              `}
              <div class="slot-room-row">
                ${isCombined ? `<span class="slot-combined-prefix" title="Combined Section">C * </span>` : ''}<span>${esc(displayRoom || '—')}</span>
              </div>
            </div>
            ${conflictCount ? `<span class="slot-conflict">⚠️ Double-booked</span>` : ''}
            ${editable ? `<div class="slot-resize-handle" data-entry-id="${entry.id}" title="Click to extend duration (+1 period)">⤢</div>` : ''}
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
      <span><i style="background:#fde68a;border:1.5px solid #d97706;display:inline-block;width:12px;height:12px;border-radius:3px"></i>Substituted Faculty</span>
      <span><i style="background:#fecaca;border:1.5px dashed #dc2626;display:inline-block;width:12px;height:12px;border-radius:3px"></i>Faculty on Leave</span>
      <span><i class="red"></i>Schedule Conflicts</span>
      <span class="grid-note">${entries.length} Slots Scheduled</span>
    </div>
  </div>`;
}

function emptyState(title, message) {
  return `<div class="empty-state">
    <strong>${esc(title)}</strong>
    <p>${esc(message)}</p>
    ${state.env === 'development' ? button('+ Add Timetable Entry', 'btn-pri', 'empty-add') : ''}
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
    renderClassSelectorBar() +
    controls(false) +
    renderAcademicCalendarBar() +
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
  const conflicts = allConflicts(entries).length;
  const isPending = state.draftTemplateStatus === 'pending_approval';
  const isProdFallback = state.devSource === 'production';

  let bannerHtml = '';
  if (isPending) {
    bannerHtml = `
      <div class="tt-banner tt-banner--pending" style="display:flex;align-items:center;justify-content:space-between;background:#fef3c7;border:1px solid #fde68a;color:#92400e;padding:12px 18px;border-radius:10px;margin-bottom:14px;font-size:13px;font-weight:500;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:18px">⏳</span>
          <span><b>Submitted for HoD verification (Read-Only).</b> Withdraw from Conflict &amp; Approvals to edit.</span>
        </div>
        <button type="button" class="btn-out" onclick="switchTab('approvals')" style="padding:5px 12px;font-size:12px;background:#fff;border-color:#f59e0b;color:#b45309;font-weight:600;white-space:nowrap;">View in Approvals</button>
      </div>`;
  } else if (isProdFallback) {
    bannerHtml = `
      <div class="tt-banner tt-banner--prod-fallback" style="display:flex;align-items:center;gap:10px;background:#e0f2fe;border:1px solid #bae6fd;color:#0369a1;padding:12px 18px;border-radius:10px;margin-bottom:14px;font-size:13px;">
        <span style="font-size:18px">ℹ️</span>
        <span><b>No draft exists. Editing from live production copy.</b> Saving will create your draft.</span>
      </div>`;
  }

  return renderClassSelectorBar() +
    `<div class="tt-editor-toolbar">
    <!-- Undo & Redo -->
    <div style="display:inline-flex;gap:4px;">
      <button type="button" class="btn-out btn-undo" id="undo-btn" ${!undoStack.length || isPending ? 'disabled' : ''} title="Undo last change (Ctrl+Z)" style="padding:6px 12px;font-size:12px;height:38px;">↶ Undo</button>
      <button type="button" class="btn-out btn-redo" id="redo-btn" ${!redoStack.length || isPending ? 'disabled' : ''} title="Redo last change (Ctrl+Y)" style="padding:6px 12px;font-size:12px;height:38px;">↷ Redo</button>
    </div>

    <div class="tt-toolbar-divider"></div>

    <!-- Actions -->
    <button type="button" class="btn-pri btn-add-entry" id="add-entry-btn" ${isPending ? 'disabled' : ''} style="padding:6px 14px;font-size:12px;height:38px;font-weight:600;">+ Add Entry</button>
    <button type="button" class="btn-out btn-autogen" id="autogen-btn" ${isPending ? 'disabled' : ''} style="padding:6px 14px;font-size:12px;height:38px;font-weight:600;">⚡ Auto-Generate</button>

    <div class="tt-toolbar-divider"></div>

    <!-- Draft Management -->
    <button type="button" class="btn-out btn-clear-draft" id="clear-draft-btn" ${isPending ? 'disabled' : ''} style="padding:6px 14px;font-size:12px;height:38px;color:#dc2626;border-color:rgba(220,38,38,0.25);" title="Clear all slots in current draft">🗑️ Clear Draft</button>
    <button type="button" class="btn-out btn-reset-draft" id="reset-draft" ${isPending ? 'disabled' : ''} style="padding:6px 14px;font-size:12px;height:38px;" title="Reset to Production">Reset to Production</button>

    <!-- Publish Action -->
    <div style="margin-left:auto;display:flex;align-items:center;gap:10px;">
      <button type="button" class="btn-pri btn-publish-draft" id="publish-draft" style="padding:6px 18px;font-size:12.5px;height:38px;background:linear-gradient(135deg,var(--gD,#1b5e20),#2e7d32);font-weight:700;">
        ${isPending ? 'View in Approvals 📋' : 'Save / Publish 🚀'}
      </button>
    </div>
  </div>` +
  bannerHtml +
  `<div class="panel editor-panel">
    <div class="panel-head">
      <div>
        <h2>${esc(state.filterSection || 'Select a section')} — Draft Schedule</h2>
        <p>${isPending ? 'Viewing locked draft submitted for HoD verification.' : 'Click slot to edit. Drag and drop to reschedule. Hold Ctrl/Cmd while dragging to copy. Click + on empty cells to allocate.'}</p>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="pill pri">${entries.length} Slots</span>
        <span class="pill ${conflicts ? 'red' : ''}" style="${conflicts ? '' : 'background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7'}">
          ${conflicts ? `⚠️ ${conflicts} Conflict(s)` : '✓ Zero Conflicts'}
        </span>
      </div>
    </div>
    <div class="panel-body">
      ${entries.length ? grid(entries, !isPending) : emptyState('Your draft is empty', 'Click "+ Add Entry" or use "⚡ Auto-Generate" to build a timetable for this class.')}
    </div>
  </div>`;
}

function listView(title, sub, entries) {
  return heading('Tabular Analytics', title, sub, button('Export Table (CSV)', 'btn-out', 'export-btn')) +
    renderClassSelectorBar() +
    controls(false) +
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

function renderFacultySelectorCard(selectedTeacher, teachers, statPillsHtml = '') {
  const isAll = !selectedTeacher || selectedTeacher.toLowerCase() === 'all';
  const currentFacultyLabel = isAll ? 'All Teaching Faculty' : selectedTeacher;

  return `
    <div class="tt-class-selector-card" id="tt-faculty-selector-card">
      <div class="tt-class-selector-left" onclick="event.stopPropagation(); toggleFacultyDropdown(this);" style="cursor:pointer;" title="Click to search and select faculty">
        <div class="tt-class-selector-icon">👤</div>
        <div class="tt-class-selector-details">
          <div class="tt-class-selector-label">Teaching Faculty Matrix</div>
          <div class="tt-class-selector-sub">Filter individual instructor workload, timetable or view institutional overview</div>
        </div>
      </div>

      <div class="tt-class-selector-right">
        <!-- CUSTOM SEARCHABLE FACULTY DROPDOWN (Class Matrix Style) -->
        <div class="tt-custom-dropdown" id="tt-faculty-dropdown">
          <input type="hidden" id="faculty-filter" value="${esc(selectedTeacher)}">
          
          <div class="tt-dropdown-trigger" id="tt-faculty-dropdown-trigger" onclick="event.stopPropagation(); toggleFacultyDropdown(this);" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false" title="Click to search and select faculty">
            <div class="tt-dropdown-trigger-left">
              <span class="tt-dropdown-trigger-icon">${isAll ? '👥' : '👤'}</span>
              <span class="tt-dropdown-trigger-text" id="tt-selected-faculty-label">${esc(currentFacultyLabel)}</span>
            </div>
            <div class="tt-dropdown-trigger-right">
              <span class="tt-dropdown-trigger-badge">${isAll ? `${teachers.length} Faculty` : 'Instructor'}</span>
              <span class="tt-dropdown-trigger-arrow">▾</span>
            </div>
          </div>

          <div class="tt-dropdown-menu" id="tt-faculty-dropdown-menu" role="listbox" style="display:none;">
            <div class="tt-dropdown-search-box">
              <span class="tt-dropdown-search-icon">🔍</span>
              <input type="text" class="tt-dropdown-search-input" id="tt-faculty-search-input" oninput="filterFacultyDropdown(this.value, this)" placeholder="Search faculty by name… (e.g. Dr. Ramesh)" autocomplete="off" spellcheck="false">
              <button type="button" class="tt-dropdown-search-clear" id="tt-faculty-search-clear" onclick="event.stopPropagation(); const si = this.closest('.tt-custom-dropdown').querySelector('.tt-dropdown-search-input'); if(si){ si.value=''; filterFacultyDropdown('', si); si.focus(); }" style="display:none;" title="Clear search">✕</button>
            </div>

            <div class="tt-dropdown-menu-header">
              <span class="tt-dropdown-menu-header-title" id="tt-faculty-dropdown-count-text">Available Faculty (${teachers.length})</span>
              <span class="tt-dropdown-menu-header-hint">Click or press Enter</span>
            </div>

            <div class="tt-dropdown-list" id="tt-faculty-options-list">
              <!-- 'ALL' FEATURE OPTION -->
              <div class="tt-dropdown-item ${isAll ? 'selected' : ''}" data-value="all" onclick="event.stopPropagation(); selectFaculty('all');" role="option" aria-selected="${isAll ? 'true' : 'false'}">
                <div class="tt-dropdown-item-left">
                  <span class="tt-dropdown-item-dot" style="${isAll ? 'background:var(--gD,#1b5e20);' : ''}"></span>
                  <span class="tt-dropdown-item-text" style="font-weight:700;">👥 All Teaching Faculty</span>
                </div>
                <div class="tt-dropdown-item-right">
                  <span class="tt-dropdown-item-badge">All</span>
                  <span class="tt-dropdown-item-check">${isAll ? '✓' : ''}</span>
                </div>
              </div>

              <!-- INDIVIDUAL TEACHERS -->
              ${teachers.map(t => {
                const isSelected = !isAll && t.toLowerCase() === selectedTeacher.toLowerCase();
                return `<div class="tt-dropdown-item ${isSelected ? 'selected' : ''}" data-value="${esc(t)}" onclick="event.stopPropagation(); selectFaculty('${esc(t)}');" role="option" aria-selected="${isSelected ? 'true' : 'false'}">
                  <div class="tt-dropdown-item-left">
                    <span class="tt-dropdown-item-dot"></span>
                    <span class="tt-dropdown-item-text">${esc(t)}</span>
                  </div>
                  <div class="tt-dropdown-item-right">
                    ${isSelected ? '<span class="tt-dropdown-item-badge">Active</span>' : ''}
                    <span class="tt-dropdown-item-check">${isSelected ? '✓' : ''}</span>
                  </div>
                </div>`;
              }).join('')}
            </div>

            <div class="tt-dropdown-empty" id="tt-faculty-dropdown-empty" style="display:none;">
              <span class="tt-dropdown-empty-icon">🔍</span>
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
}

function dashboardView() {
  const entries = getAllClassesEntries();
  const isSubjectTab = state.workloadTab === 'subject';
  const isScheduleTab = state.workloadTab === 'schedule';
  const isWorkloadTab = !isSubjectTab && !isScheduleTab;

  const subNav = `<div class="report-sub-nav">
    <button type="button" class="report-sub-btn ${isWorkloadTab ? 'active' : ''}" id="tab-workload-fac">📊 Workload Distribution</button>
    <button type="button" class="report-sub-btn ${isScheduleTab ? 'active' : ''}" id="tab-workload-sch">📅 Timetable Schedule</button>
    <button type="button" class="report-sub-btn ${isSubjectTab ? 'active' : ''}" id="tab-workload-sub">📚 Subject Distribution &amp; Ratio</button>
  </div>`;

  if (isSubjectTab) {
    return heading('Curriculum Analytics', 'Subject Distribution & Ratios', 'Breakdown of weekly hours, theory vs lab proportion, and section load', button('Export Subjects (CSV)', 'btn-out', 'export-subjects-btn')) +
      renderClassSelectorBar() +
      subNav +
      subjectDistributionContent(entries);
  }

  const rawTeachers = TEACHERS && TEACHERS.length ? TEACHERS : [...new Set((entries || []).map(e => e.teacher).filter(Boolean))];
  const teachers = [...new Set(rawTeachers)].filter(Boolean).sort((a, b) => a.localeCompare(b));
  
  const isAll = !state.selectedFaculty || state.selectedFaculty.toLowerCase() === 'all';
  const selectedTeacher = isAll ? 'all' : state.selectedFaculty;

  if (isScheduleTab) {
    const teacherEntries = isAll 
      ? entries 
      : entries.filter(e => (e.teacher || '').toLowerCase() === selectedTeacher.toLowerCase());

    let totalHours = 0;
    let theoryHours = 0;
    let labHours = 0;
    const sections = new Set();
    const rooms = new Set();

    teacherEntries.forEach(e => {
      const dur = Number(e.duration || 1);
      totalHours += dur;
      if (e.type === 'Lab' || (e.subject || '').toLowerCase().includes('lab')) labHours += dur;
      else theoryHours += dur;
      if (e.section) sections.add(e.section);
      if (e.room) rooms.add(e.room);
    });

    const statPillsHtml = isAll ? `
      <span class="pill pri"><b>${teachers.length}</b> Faculty</span>
      <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;"><b>${totalHours}</b> Total hrs/wk</span>
      <span class="pill" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">${sections.size} Section(s)</span>
      <span class="pill" style="background:#f5f3ff;color:#6d28d9;border-color:#ddd6fe;">${rooms.size} Room(s)</span>
    ` : `
      <span class="pill pri"><b>${totalHours}</b> hrs/wk</span>
      <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;"><b>${theoryHours}h</b> Theory</span>
      <span class="pill warn"><b>${labHours}h</b> Lab</span>
      <span class="pill" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">${sections.size} Section(s)</span>
      <span class="pill" style="background:#f5f3ff;color:#6d28d9;border-color:#ddd6fe;">${rooms.size} Room(s)</span>
    `;

    return heading('Faculty Timetable Matrix', 'Faculty Weekly Schedule', 'Individual weekly teaching schedule, room allocations, and classroom assignments across all classes', button('Export Schedule (CSV)', 'btn-out', 'export-workload-btn')) +
      renderFacultySelectorCard(selectedTeacher, teachers, statPillsHtml) +
      subNav +
      (isAll ? renderAllFacultyOverview(teachers, entries) : renderSingleFacultyPanel(selectedTeacher, teacherEntries));
  }

  const statPillsHtml = isAll ? `
    <span class="pill pri"><b>${teachers.length}</b> Faculty</span>
    <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;">Target: 12–16 hrs/wk</span>
    <span class="pill warn">Max: 18 hrs/wk</span>
  ` : (() => {
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
    return `
      <span class="pill pri"><b>${total}</b> hrs/wk</span>
      <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;"><b>${th}h</b> Theory</span>
      <span class="pill warn"><b>${lb}h</b> Lab</span>
      <span class="pill" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">${sects.size} Section(s)</span>
    `;
  })();

  return heading('Workload Analytics', 'Faculty Workload Distribution', 'Computed weekly periods across active schedule benchmarked against department targets and 24h institutional scale', button('Export Workload (CSV)', 'btn-out', 'export-workload-btn')) +
    renderFacultySelectorCard(selectedTeacher, teachers, statPillsHtml) +
    subNav +
    facultyWorkloadContent(entries, selectedTeacher);
}

function facultyWorkloadContent(entries, selectedTeacher = 'all') {
  const isAll = !selectedTeacher || selectedTeacher.toLowerCase() === 'all';
  const facultyMap = new Map();
  entries.forEach(e => {
    const f = e.teacher || 'Unassigned';
    const dur = Number(e.duration || 1);
    const isLab = e.type === 'Lab' || (e.subject || '').toLowerCase().includes('lab');
    if (!facultyMap.has(f)) facultyMap.set(f, { total: 0, theory: 0, lab: 0, sections: new Set(), subjects: new Set(), subjectDetails: new Map() });
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

    const singleKpis = `<div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">Instructor Profile</div>
        <div class="kpi-val" style="font-size:18px">👤 ${esc(selectedTeacher)}</div>
        <div class="kpi-sub">${target.total > maxThreshold ? '⚠️ Overload Risk' : (target.total >= 12 ? '✓ Optimal Load' : 'Light Load')}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Weekly Contact Hours</div>
        <div class="kpi-val" style="color:var(--td)">${target.total} <span style="font-size:13px;font-weight:500">hrs/wk</span></div>
        <div class="kpi-sub">Dept Average: ${deptAvg} hrs/wk</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Theory vs Lab Split</div>
        <div class="kpi-val" style="color:var(--gM,#388e3c)">${target.theory}h <span style="font-size:12px;font-weight:400;color:var(--tmu)">/ ${target.lab}h lab</span></div>
        <div class="kpi-sub">${target.subjects.size} assigned subject(s)</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Assigned Cohorts</div>
        <div class="kpi-val" style="color:#3b82f6">${target.sections.size} <span style="font-size:13px;font-weight:500">sections</span></div>
        <div class="kpi-sub">${Array.from(target.sections).join(', ') || 'No sections'}</div>
      </div>
    </div>`;

    return singleKpis +
      `<div class="panel">
        <div class="panel-head">
          <div>
            <h2>Workload Breakdown &amp; Course Load — 👤 ${esc(selectedTeacher)}</h2>
            <p>Direct weekly teaching allocations and section responsibilities benchmarked against 24h institutional scale.</p>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button type="button" class="btn-out" onclick="event.stopPropagation(); selectFaculty('all');" style="padding:4px 12px;font-size:12px">← View All Faculty</button>
            <button type="button" class="btn-pri" onclick="event.stopPropagation(); selectWorkloadTab('schedule');" style="padding:4px 12px;font-size:12px">📅 View Timetable Schedule Grid →</button>
          </div>
        </div>
        <div style="padding:16px 20px 8px;">
          <div style="font-size:12px;font-weight:700;color:var(--td);margin-bottom:14px;display:flex;justify-content:space-between;">
            <span>Weekly Load Benchmark: ${target.total} hrs / 24h Scale</span>
            <span style="color:var(--tmu)">Dept Target Avg: ${deptAvg} hrs/wk</span>
          </div>
          <div class="analytics-progress-wrap" style="height:12px;border-radius:6px;" title="Load: ${target.total}h / 24h max scale · Dept Avg: ${deptAvg}h">
            <div class="analytics-progress-bar ${barClass}" style="width:${pct}%"></div>
            <div class="analytics-avg-marker" style="left:${avgMarkerPercent}%"></div>
          </div>
        </div>
        <table class="table" style="margin-top:10px;">
          <thead>
            <tr>
              <th>Course / Subject</th>
              <th>Course Type</th>
              <th>Teaching Sections</th>
              <th>Weekly Hours</th>
              <th>Share of Faculty Load</th>
            </tr>
          </thead>
          <tbody>
            ${subjectsList.length ? subjectsList.map(s => {
              const subPct = target.total ? Math.round((s.hours / target.total) * 100) : 0;
              return `<tr>
                <td><b>📚 ${esc(s.name)}</b></td>
                <td><span class="pill ${s.type === 'Lab' ? 'warn' : ''}">${esc(s.type)}</span></td>
                <td><span class="pill pri">${Array.from(s.sections).join(', ') || '—'}</span></td>
                <td><b style="font-size:14px">${s.hours}</b> hrs/wk</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div class="analytics-progress-wrap" style="flex:1">
                      <div class="analytics-progress-bar green" style="width:${subPct}%"></div>
                    </div>
                    <b style="font-size:11.5px;color:var(--td);width:35px">${subPct}%</b>
                  </div>
                </td>
              </tr>`;
            }).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--tmu);padding:20px;">No scheduled courses found for this instructor.</td></tr>`}
          </tbody>
        </table>
      </div>` +
      `<div style="margin-top:16px;">` +
      renderSingleFacultyPanel(selectedTeacher, entries.filter(e => (e.teacher || '').toLowerCase() === selectedTeacher.toLowerCase())) +
      `</div>`;
  }

  // All Faculty Overview
  const kpis = `<div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">Active Instructors</div>
      <div class="kpi-val">${totalFaculty}</div>
      <div class="kpi-sub">Assigned in active schedule</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Dept Average Load</div>
      <div class="kpi-val" style="color:var(--gM,#388e3c)">${deptAvg} <span style="font-size:13px;font-weight:500">hrs/wk</span></div>
      <div class="kpi-sub">Standard target: 12–16 hrs</div>
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
  </div>`;

  const facultyList = Array.from(facultyMap.keys()).filter(Boolean).sort((a, b) => a.localeCompare(b));

  return kpis +
    `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>Weekly Teaching Hours by Faculty Member</h2>
          <p>Visual workload distribution benchmarked against department average (${deptAvg} hrs/wk).</p>
        </div>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Faculty Name</th>
            <th>Total Hours / Wk</th>
            <th>Theory Hours</th>
            <th>Lab Hours</th>
            <th style="min-width:180px">Load Benchmark (Scale: 24h)</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${Array.from(facultyMap.entries()).sort((a, b) => b[1].total - a[1].total).map(([name, r]) => {
            const pct = Math.min(100, Math.round((r.total / 24) * 100));
            const barClass = r.total > maxThreshold ? 'red' : (r.total >= 12 ? 'green' : 'amber');
            return `<tr>
              <td>
                <b>👤 ${esc(name)}</b>
                <div style="font-size:11px;color:var(--tmu);margin-top:2px">
                  ${r.subjects.size} subjects · ${Array.from(r.sections).join(', ') || state.filterSection}
                </div>
              </td>
              <td><b style="font-size:15px;color:var(--td)">${r.total}</b> hrs/wk</td>
              <td><span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;font-weight:600">${r.theory} hrs</span></td>
              <td><span class="pill" style="background:#fffbeb;color:#b45309;border-color:#fde68a;font-weight:600">${r.lab} hrs</span></td>
              <td>
                <div class="analytics-progress-wrap" title="Load: ${r.total}h / 24h max scale · Dept Avg: ${deptAvg}h">
                  <div class="analytics-progress-bar ${barClass}" style="width:${pct}%"></div>
                  <div class="analytics-avg-marker" style="left:${avgMarkerPercent}%"></div>
                </div>
              </td>
              <td>
                ${r.total > maxThreshold
                  ? `<span class="pill red" title="Exceeds maximum allowable weekly teaching load">⚠️ Overload (${r.total}h)</span>`
                  : (r.total >= 12
                    ? `<span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7">Optimal (${r.total}h)</span>`
                    : `<span class="pill" style="background:#f1f5f9;color:#475569">Light (${r.total}h)</span>`)}
              </td>
              <td>
                <button type="button" class="btn-out view-fac-workload-btn" onclick="event.stopPropagation(); selectFaculty('${esc(name)}');" style="padding:4px 10px;font-size:11.5px">Inspect Load →</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` +
    renderAllFacultySlotsStream(facultyList, entries, 'Faculty Timetable Slots Stream');
}

function subjectDistributionContent(entries) {
  const subjectMap = new Map();
  entries.forEach(e => {
    const s = e.subject || 'Unassigned';
    const dur = Number(e.duration || 1);
    const isLab = e.type === 'Lab' || s.toLowerCase().includes('lab');
    if (!subjectMap.has(s)) subjectMap.set(s, { total: 0, theory: 0, lab: 0, teachers: new Set(), sections: new Set() });
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

  const kpis = `<div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">Active Subjects</div>
      <div class="kpi-val">${totalSubjects}</div>
      <div class="kpi-sub">Taught in active schedule</div>
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
  </div>`;

  return kpis +
    `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>Subject Hours Distribution & Theory-Lab Proportion</h2>
          <p>Curriculum volume and weekly allocation share per course.</p>
        </div>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Course / Subject</th>
            <th>Weekly Hours</th>
            <th>Theory vs Lab Ratio</th>
            <th style="min-width:160px">Schedule Share</th>
            <th>Instructors</th>
          </tr>
        </thead>
        <tbody>
          ${Array.from(subjectMap.entries()).sort((a, b) => b[1].total - a[1].total).map(([name, r]) => {
            const sharePct = totalHours ? ((r.total / totalHours) * 100).toFixed(1) : '0.0';
            const tPct = r.total ? Math.round((r.theory / r.total) * 100) : 100;
            const lPct = 100 - tPct;
            return `<tr>
              <td>
                <b>${esc(name)}</b>
                <div style="font-size:11px;color:var(--tmu);margin-top:2px">
                  ${Array.from(r.sections).join(', ') || state.filterSection}
                </div>
              </td>
              <td><b style="font-size:15px;color:var(--td)">${r.total}</b> hrs/wk</td>
              <td style="font-size:12px">
                <span style="color:var(--gM);font-weight:600">${tPct}% Theory (${r.theory}h)</span> ·
                <span style="color:#d97706;font-weight:600">${lPct}% Lab (${r.lab}h)</span>
              </td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="analytics-progress-wrap" style="flex:1">
                    <div class="analytics-progress-bar purple" style="width:${sharePct}%"></div>
                  </div>
                  <b style="font-size:11.5px;color:var(--td);width:40px">${sharePct}%</b>
                </div>
              </td>
              <td style="font-size:12px">👤 ${esc(Array.from(r.teachers).join(', ') || 'Unassigned')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderRoomWeeklyGrid(roomName, entries) {
  const starts = new Map((entries || []).map(x => [`${x.day}:${x.period}`, x]));
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
        <div class="day-date">Room Schedule</div>
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
              <span class="pill pri" style="font-size:10px;padding:1px 6px;">🏫 ${esc(entry.section)}</span>
              <span style="font-size:11px;color:var(--tmu);">👤 ${esc(entry.teacher || 'Faculty')}</span>
              ${span > 1 ? `<span class="pill warn" style="font-size:9.5px;padding:1px 4px;">${span}p</span>` : ''}
            </div>
          </div>
        </td>`;

        for (let n = 0; n < span; n += 1) occupied.add(`${day}:${PERIODS[index + n]?.[0]}`);
        index += span;
        continue;
      }

      html += `<td><div style="text-align:center;color:var(--gM,#16a34a);font-size:11px;font-weight:600;opacity:0.6;">✓ Free</div></td>`;
      index += 1;
    }
    html += '</tr>';
  });

  html += `</tbody></table></div>`;
  return html;
}

function renderRoomSelectorCard(selectedRoom, rooms, statPillsHtml = '') {
  const isAll = !selectedRoom || selectedRoom === '__all__';
  const currentRoomLabel = isAll ? 'All Campus Classrooms & Laboratories' : selectedRoom;
  const currentRoomIsLab = !isAll && selectedRoom.toLowerCase().includes('lab');

  return `
    <div class="tt-class-selector-card" id="tt-room-selector-card">
      <div class="tt-class-selector-left" onclick="event.stopPropagation(); toggleRoomDropdown(this);" style="cursor:pointer;" title="Click to search and select classroom or lab">
        <div class="tt-class-selector-icon">📍</div>
        <div class="tt-class-selector-details">
          <div class="tt-class-selector-label">Room &amp; Facility Matrix</div>
          <div class="tt-class-selector-sub">Filter individual classroom, laboratory or view campus-wide capacity</div>
        </div>
      </div>

      <div class="tt-class-selector-right">
        <!-- CUSTOM SEARCHABLE ROOM DROPDOWN -->
        <div class="tt-custom-dropdown" id="tt-room-dropdown">
          <input type="hidden" id="room-free-filter" value="${esc(selectedRoom)}">
          
          <div class="tt-dropdown-trigger" id="tt-room-dropdown-trigger" onclick="event.stopPropagation(); toggleRoomDropdown(this);" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false" title="Click to search and select room or lab">
            <div class="tt-dropdown-trigger-left">
              <span class="tt-dropdown-trigger-icon">${isAll ? '🏢' : (currentRoomIsLab ? '🧪' : '📍')}</span>
              <span class="tt-dropdown-trigger-text" id="tt-selected-room-label">${esc(currentRoomLabel)}</span>
            </div>
            <div class="tt-dropdown-trigger-right">
              <span class="tt-dropdown-trigger-badge">${isAll ? `${rooms.length} Facilities` : (currentRoomIsLab ? 'Lab' : 'Hall')}</span>
              <span class="tt-dropdown-trigger-arrow">▾</span>
            </div>
          </div>

          <div class="tt-dropdown-menu" id="tt-room-dropdown-menu" role="listbox" style="display:none;">
            <div class="tt-dropdown-search-box">
              <span class="tt-dropdown-search-icon">🔍</span>
              <input type="text" class="tt-dropdown-search-input" id="tt-room-search-input" oninput="filterRoomDropdown(this.value, this)" placeholder="Search room or lab… (e.g. Lab 2, Hall 101)" autocomplete="off" spellcheck="false">
              <button type="button" class="tt-dropdown-search-clear" id="tt-room-search-clear" onclick="event.stopPropagation(); const si = this.closest('.tt-custom-dropdown').querySelector('.tt-dropdown-search-input'); if(si){ si.value=''; filterRoomDropdown('', si); si.focus(); }" style="display:none;" title="Clear search">✕</button>
            </div>

            <div class="tt-dropdown-menu-header">
              <span class="tt-dropdown-menu-header-title" id="tt-room-dropdown-count-text">Available Facilities (${rooms.length})</span>
              <span class="tt-dropdown-menu-header-hint">Click or press Enter</span>
            </div>

            <div class="tt-dropdown-list" id="tt-room-options-list">
              <!-- 'ALL' FEATURE OPTION -->
              <div class="tt-dropdown-item ${isAll ? 'selected' : ''}" data-value="__all__" onclick="event.stopPropagation(); selectRoom('__all__');" role="option" aria-selected="${isAll ? 'true' : 'false'}">
                <div class="tt-dropdown-item-left">
                  <span class="tt-dropdown-item-dot" style="${isAll ? 'background:var(--gD,#1b5e20);' : ''}"></span>
                  <span class="tt-dropdown-item-text" style="font-weight:700;">🏢 All Campus Classrooms &amp; Laboratories</span>
                </div>
                <div class="tt-dropdown-item-right">
                  <span class="tt-dropdown-item-badge">All</span>
                  <span class="tt-dropdown-item-check">${isAll ? '✓' : ''}</span>
                </div>
              </div>

              <!-- INDIVIDUAL ROOMS -->
              ${rooms.map(r => {
                const isSelected = !isAll && r.toLowerCase() === selectedRoom.toLowerCase();
                const rIsLab = r.toLowerCase().includes('lab');
                return `<div class="tt-dropdown-item ${isSelected ? 'selected' : ''}" data-value="${esc(r)}" onclick="event.stopPropagation(); selectRoom('${esc(r)}');" role="option" aria-selected="${isSelected ? 'true' : 'false'}">
                  <div class="tt-dropdown-item-left">
                    <span class="tt-dropdown-item-dot"></span>
                    <span class="tt-dropdown-item-text">${rIsLab ? '🧪' : '📍'} ${esc(r)}</span>
                  </div>
                  <div class="tt-dropdown-item-right">
                    <span class="tt-dropdown-item-badge ${rIsLab ? 'warn' : ''}">${rIsLab ? 'Lab' : 'Hall'}</span>
                    <span class="tt-dropdown-item-check">${isSelected ? '✓' : ''}</span>
                  </div>
                </div>`;
              }).join('')}
            </div>

            <div class="tt-dropdown-empty" id="tt-room-dropdown-empty" style="display:none;">
              <span class="tt-dropdown-empty-icon">🔍</span>
              <div class="tt-dropdown-empty-title">No matching facilities found</div>
              <div class="tt-dropdown-empty-desc">No classroom or lab matches "<span id="tt-empty-room-query"></span>"</div>
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
}

function roomsView() {
  const allEntries = getAllClassesEntries();
  const roomMap = new Map();

  (_masterData.rooms || []).forEach(r => {
    const key = r.hallNo || r.name;
    roomMap.set(key, {
      name: key,
      capacity: r.capacity || '—',
      building: r.buildingId?.name || r.block || 'Academic Block',
      type: r.type || (key.toLowerCase().includes('lab') ? 'Laboratory' : 'Lecture Hall'),
      hours: 0,
      sections: new Set()
    });
  });

  allEntries.forEach(e => {
    if (!e.room) return;
    if (!roomMap.has(e.room)) {
      roomMap.set(e.room, {
        name: e.room,
        capacity: '—',
        building: 'Academic Block',
        type: e.room.toLowerCase().includes('lab') ? 'Laboratory' : 'Lecture Hall',
        hours: 0,
        sections: new Set()
      });
    }
    const r = roomMap.get(e.room);
    r.hours += Number(e.duration || 1);
    if (e.section) r.sections.add(e.section);
  });

  const roomsList = Array.from(roomMap.values());
  const totalRooms = roomsList.length;
  const standardCapacity = 35; // 7 periods * 5 days
  const avgUtilization = totalRooms
    ? Math.round((roomsList.reduce((sum, r) => sum + Math.min(100, (r.hours / standardCapacity) * 100), 0) / totalRooms))
    : 0;

  const mostUtilized = [...roomsList].sort((a, b) => b.hours - a.hours)[0];
  const underutilizedCount = roomsList.filter(r => (r.hours / standardCapacity) < 0.3).length;

  const allRoomNames = roomsList.map(r => r.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const labCount = roomsList.filter(r => (r.type || '').toLowerCase().includes('lab') || r.name.toLowerCase().includes('lab')).length;
  const hallCount = Math.max(0, totalRooms - labCount);

  const selectedRoom = state.selectedRoom || '__all__';
  const isAll = !selectedRoom || selectedRoom === '__all__';
  const targetRoom = isAll ? null : (roomsList.find(r => r.name.toLowerCase() === selectedRoom.toLowerCase()) || {
    name: selectedRoom,
    capacity: '—',
    building: 'Academic Block',
    type: selectedRoom.toLowerCase().includes('lab') ? 'Laboratory' : 'Lecture Hall',
    hours: allEntries.filter(e => e.room === selectedRoom).reduce((s, e) => s + Number(e.duration || 1), 0),
    sections: new Set(allEntries.filter(e => e.room === selectedRoom).map(e => e.section).filter(Boolean))
  });

  const targetRoomEntries = isAll ? [] : allEntries.filter(e => (e.room || '').toLowerCase() === selectedRoom.toLowerCase());

  const statPillsHtml = isAll ? `
    <span class="pill pri"><b>${totalRooms}</b> Facilities</span>
    <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;"><b>${labCount}</b> Labs</span>
    <span class="pill" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;"><b>${hallCount}</b> Lecture Halls</span>
    <span class="pill" style="background:#f5f3ff;color:#6d28d9;border-color:#ddd6fe;"><b>${avgUtilization}%</b> Avg Util</span>
  ` : `
    <span class="pill ${(targetRoom.type || '').toLowerCase().includes('lab') ? 'warn' : ''}">${(targetRoom.type || '').toLowerCase().includes('lab') ? '🧪 Laboratory' : '📍 Lecture Hall'}</span>
    <span class="pill pri"><b>${targetRoom.hours}</b> hrs/wk Scheduled</span>
    <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;"><b>${targetRoom.capacity}</b> Seats</span>
    <span class="pill" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;"><b>${Math.min(100, Math.round((targetRoom.hours / standardCapacity) * 100))}%</b> Util</span>
  `;

  const kpis = isAll ? `<div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">Academic Facilities</div>
      <div class="kpi-val">${totalRooms}</div>
      <div class="kpi-sub">Configured campus lecture halls &amp; labs</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Average Utilization</div>
      <div class="kpi-val" style="color:var(--gM,#388e3c)">${avgUtilization}%</div>
      <div class="kpi-sub">Based on 35 periods/wk operating capacity</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Highest Occupancy</div>
      <div class="kpi-val" style="font-size:16px">${mostUtilized ? `${esc(mostUtilized.name)} (${Math.round((mostUtilized.hours/standardCapacity)*100)}%)` : '—'}</div>
      <div class="kpi-sub">${mostUtilized ? `${mostUtilized.hours} hrs scheduled/wk` : ''}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Light / Underutilized</div>
      <div class="kpi-val" style="color:#3b82f6">${underutilizedCount}</div>
      <div class="kpi-sub">Available for rescheduling / labs</div>
    </div>
  </div>` : `<div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">Facility Details</div>
      <div class="kpi-val" style="font-size:18px">📍 ${esc(targetRoom.name)}</div>
      <div class="kpi-sub">${esc(targetRoom.type)} · ${esc(targetRoom.building)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Weekly Scheduled Load</div>
      <div class="kpi-val" style="color:var(--td)">${targetRoom.hours} hrs/wk</div>
      <div class="kpi-sub">Allocated academic class periods</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Room Capacity Utilization</div>
      <div class="kpi-val" style="color:var(--gM,#388e3c)">${Math.min(100, Math.round((targetRoom.hours / standardCapacity) * 100))}%</div>
      <div class="kpi-sub">Based on 35 weekly teaching periods</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Seating &amp; Cohorts</div>
      <div class="kpi-val" style="color:#3b82f6">${targetRoom.capacity} seats</div>
      <div class="kpi-sub">${targetRoom.sections.size} active section(s) assigned</div>
    </div>
  </div>`;

  return heading('Facility Optimization', 'Room Allocations & Utilization', 'Weekly occupancy analysis across academic lecture halls and laboratories', button('Export Room Report (CSV)', 'btn-out', 'export-rooms-btn')) +
    renderRoomSelectorCard(selectedRoom, allRoomNames, statPillsHtml) +
    kpis +
    (isAll ? `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>Facility Utilization Matrix</h2>
          <p>Calculated room occupancy and capacity utilization percentages based on weekly schedule.</p>
        </div>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Room / Hall</th>
            <th>Type &amp; Building</th>
            <th>Seating Capacity</th>
            <th>Weekly Hours</th>
            <th style="min-width:160px">Utilization % (35h Base)</th>
            <th>Active Sections</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${roomsList.sort((a, b) => b.hours - a.hours).map(r => {
            const utilPct = Math.min(100, Math.round((r.hours / standardCapacity) * 100));
            const barClass = utilPct > 70 ? 'red' : (utilPct >= 30 ? 'green' : 'amber');
            return `<tr>
              <td><b>📍 ${esc(r.name)}</b></td>
              <td style="font-size:12px;color:var(--tmu)">${esc(r.type)} · ${esc(r.building)}</td>
              <td><b>${esc(r.capacity)}</b> seats</td>
              <td><b style="font-size:15px;color:var(--td)">${r.hours}</b> hrs/wk</td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="analytics-progress-wrap" style="flex:1">
                    <div class="analytics-progress-bar ${barClass}" style="width:${utilPct}%"></div>
                  </div>
                  <b style="font-size:11.5px;color:var(--td);width:35px">${utilPct}%</b>
                </div>
              </td>
              <td style="font-size:11.5px;color:var(--tmu)">
                ${Array.from(r.sections).join(', ') || '—'}
              </td>
              <td>
                ${utilPct > 70
                  ? '<span class="pill red">High Load (>70%)</span>'
                  : (utilPct >= 30
                    ? '<span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7">Optimal</span>'
                    : '<span class="pill" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe">Underutilized</span>')}
              </td>
              <td>
                <button type="button" class="btn-out view-room-alloc-btn" onclick="event.stopPropagation(); selectRoom('${esc(r.name)}');" style="padding:4px 10px;font-size:11.5px">Inspect Schedule →</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>Weekly Allocation Schedule — 📍 ${esc(targetRoom.name)}</h2>
          <p>Room occupancy, active teaching sections, and time-block allocations for ${esc(targetRoom.name)} (${esc(targetRoom.type)}, ${esc(targetRoom.building)}).</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="pill pri"><b>${targetRoomEntries.length}</b> Scheduled Class(es)</span>
          <button type="button" class="btn-out" onclick="event.stopPropagation(); selectRoom('__all__');" style="padding:4px 12px;font-size:12px">← View All Facilities</button>
        </div>
      </div>
      <div class="panel-body">
        ${targetRoomEntries.length
          ? renderRoomWeeklyGrid(targetRoom.name, targetRoomEntries)
          : emptyState(`No scheduled allocations in ${esc(targetRoom.name)}`, 'This facility has 0 weekly hours currently assigned.')}
      </div>
    </div>`);
}

function otherView() {
  const entries = activeEntries();
  if (state.view === 'faculty') return facultyScheduleView();
  if (state.view === 'rooms') return roomsView();
  if (state.view === 'overview') {
    const all = getAllClassesEntries();
    const list = state.search ? all.filter(entry =>
      [entry.subject, entry.teacher, entry.room, entry.section].some(v =>
        String(v).toLowerCase().includes(state.search.toLowerCase())
      )
    ) : all;
    return listView('Department Overview', 'Complete section entries in the current dataset', list);
  }
  if (state.view === 'attendance') return attendanceView();
  if (state.view === 'exports') {
    const curSec = state.filterSection || (SECTIONS.length ? SECTIONS[0] : 'Current Class');
    return heading('Data Export Center', 'Export Center', 'Download verified academic schedules, workload analytics, and facility audits in CSV, Excel, and PDF formats', button('🖨️ Print / Save PDF', 'btn-out', 'print-btn')) +
      renderClassSelectorBar() +
      `<div class="tt-export-cards-grid">
        <!-- CARD 1: Class / Section Timetable -->
        <div class="tt-export-card">
          <div class="tt-export-card-head">
            <div class="tt-export-card-icon" style="background:#e8f5e9;color:#1b5e20;">▦</div>
            <div>
              <h3>Class / Section Timetable</h3>
              <p>Weekly timetable schedule for <b>${esc(curSec)}</b></p>
            </div>
          </div>
          <div class="tt-export-card-desc">
            Complete period allocations with 12-hour timestamps, instructor assignments, room numbers, and course codes formatted for student distribution and LMS import.
          </div>
          <div class="tt-export-card-actions">
            <button type="button" class="btn-pri" id="export-btn">📄 Export CSV</button>
            <button type="button" class="btn-out" id="export-excel-btn">📊 Export Excel (.xls)</button>
            <button type="button" class="btn-out" id="print-btn">🖨️ Print / PDF</button>
          </div>
        </div>

        <!-- CARD 2: Department Master Schedule -->
        <div class="tt-export-card">
          <div class="tt-export-card-head">
            <div class="tt-export-card-icon" style="background:#e0f2fe;color:#0369a1;">🗂️</div>
            <div>
              <h3>Department Master Schedule</h3>
              <p>Consolidated timetable workbook across all sections</p>
            </div>
          </div>
          <div class="tt-export-card-desc">
            Multi-class schedule compilation combining all registered sections into a unified spreadsheet for academic dean and HOD institutional record-keeping.
          </div>
          <div class="tt-export-card-actions">
            <button type="button" class="btn-pri" id="export-all-sections-btn">🗂️ Export All Sections (CSV)</button>
            <button type="button" class="btn-out" onclick="window.location.href='export.html?tab=tt'">⚙️ Advanced Hub</button>
          </div>
        </div>

        <!-- CARD 3: Faculty Workload Analytics -->
        <div class="tt-export-card">
          <div class="tt-export-card-head">
            <div class="tt-export-card-icon" style="background:#f3e8ff;color:#7e22ce;">👤</div>
            <div>
              <h3>Faculty Workload Analytics</h3>
              <p>Teaching load, contact hours &amp; distribution benchmarks</p>
            </div>
          </div>
          <div class="tt-export-card-desc">
            Audited faculty work metrics showing weekly teaching hours, theory vs lab contact splits, and department average load benchmarks for UGC/AICTE compliance.
          </div>
          <div class="tt-export-card-actions">
            <button type="button" class="btn-pri" id="export-workload-csv-btn">👤 Export Workload (CSV)</button>
          </div>
        </div>

        <!-- CARD 4: Room Utilization & Facility Report -->
        <div class="tt-export-card">
          <div class="tt-export-card-head">
            <div class="tt-export-card-icon" style="background:#fef3c7;color:#b45309;">🏢</div>
            <div>
              <h3>Room Utilization &amp; Facility Audit</h3>
              <p>Occupancy rates, weekly hours &amp; capacity analysis</p>
            </div>
          </div>
          <div class="tt-export-card-desc">
            Campus-wide classroom and lab occupancy percentages, seat capacities, and weekly reserved hours to identify underutilized facilities and prevent double-booking.
          </div>
          <div class="tt-export-card-actions">
            <button type="button" class="btn-pri" id="export-rooms-csv-btn">🏢 Export Room Audit (CSV)</button>
            <button type="button" class="btn-out" onclick="window.location.href='rooms.html'">🏛️ Campus Facilities</button>
          </div>
        </div>

        <!-- CARD 5: Subject Distribution & Ratio Report -->
        <div class="tt-export-card">
          <div class="tt-export-card-head">
            <div class="tt-export-card-icon" style="background:#fce7f3;color:#be185d;">📚</div>
            <div>
              <h3>Subject Distribution &amp; Ratio Report</h3>
              <p>Curriculum balance, lab-theory ratios &amp; weekly shares</p>
            </div>
          </div>
          <div class="tt-export-card-desc">
            Detailed curriculum distribution analysis showing weekly theory vs practical contact hours, core subject weights, and lecture share percentages across all classes.
          </div>
          <div class="tt-export-card-actions">
            <button type="button" class="btn-pri" id="export-subjects-csv-btn">📚 Export Subject Report (CSV)</button>
          </div>
        </div>

        <!-- CARD 6: Institutional Print & PDF Layout -->
        <div class="tt-export-card">
          <div class="tt-export-card-head">
            <div class="tt-export-card-icon" style="background:#f1f5f9;color:#334155;">🖨️</div>
            <div>
              <h3>Institutional Print &amp; PDF Layout</h3>
              <p>A4 Landscape notice-board ready schedule with letterhead</p>
            </div>
          </div>
          <div class="tt-export-card-desc">
            High-fidelity formatted timetable ready for high-resolution printing or PDF export with verified EAMS institutional header, signatures, and date stamps.
          </div>
          <div class="tt-export-card-actions">
            <button type="button" class="btn-pri" id="print-btn">🖨️ Print Official Timetable</button>
          </div>
        </div>
      </div>`;
  }

  if (state.view === 'free') {
    return roomFreeSlotsView();
  }

  if (state.view === 'approvals') {
    return approvalsView();
  }

  // ── EDITABLE BELL TIMING PRESETS (Templates removed per Item 9) ──
  if (state.view === 'presets') {
    const timingPresets = LAYOUT_PRESETS.filter(p => !p.isStructuralTemplate && (!p.grid || !p.grid.length));
    const fallbackPresets = timingPresets.length ? timingPresets : [
      { _id: 'default_1', name: 'Engineering Standard (Years I & IV)', description: 'Set 1 Timing with 3-period lab duration', timingSet: 'SET_1', defaultLabDuration: 3, workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] },
      { _id: 'default_2', name: 'Engineering Core (Years II & III)', description: 'Set 2 Timing with early morning break', timingSet: 'SET_2', defaultLabDuration: 3, workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] }
    ];

    return heading('Institutional Timing Presets', 'Bell Timing Presets', 'Standardized bell timings and working day schedules across departments', button('+ New Timing Preset', 'btn-pri', 'add-preset-btn')) +
      `<div class="panel">
        <div class="panel-head">
          <div>
            <h2>Configured Timing Presets</h2>
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
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${fallbackPresets.map(p => `<tr>
              <td><b>${esc(p.name)}</b></td>
              <td><span class="pill">${esc(p.timingSet || 'SET_1')}</span></td>
              <td>${Array.isArray(p.workingDays) ? p.workingDays.slice(0, 3).join(', ') + (p.workingDays.length > 3 ? '…' : '') : 'Mon–Fri'}</td>
              <td>${esc(p.defaultLabDuration || 3)} periods</td>
              <td style="color:var(--tmu);font-size:12px">${esc(p.description || 'Standard institutional preset')}</td>
              <td style="text-align:right;">
                <div style="display:inline-flex;gap:6px">
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
    return historyView();
  }

  return productionView();
}

// ── FACULTY-WISE SCHEDULE VIEW (Merged with Workload) ──
function facultyScheduleView() {
  state.workloadTab = 'schedule';
  return dashboardView();
}

function renderAllFacultySlotsStream(teachers, allSource, contextTitle = 'Weekly Timetable Slots by Faculty Member') {
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
          <h2 style="font-size:17px;font-weight:800;color:var(--td);display:flex;align-items:center;gap:8px;margin:0;">
            <span>📅 ${esc(contextTitle)}</span>
            <span class="pill pri" style="font-size:11px;padding:2px 7px;">${facultyData.length} Instructors</span>
          </h2>
          <p style="font-size:12px;color:var(--tmu);margin:3px 0 0 0;">
            Sequential, scrollable view displaying all scheduled timetable slots and classroom allocations for each instructor one by one.
          </p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;font-weight:600;font-size:11.5px;">
            ${totalSlotsCount} Scheduled Slot Periods
          </span>
        </div>
      </div>

      ${facultyData.length > 1 ? `
        <!-- Sticky Quick Jump Bar -->
        <div class="tt-faculty-quick-jump-bar">
          <span style="font-size:11.5px;font-weight:700;color:var(--td);white-space:nowrap;">Jump to Instructor:</span>
          ${facultyData.map(f => `
            <button type="button" class="pill" onclick="document.getElementById('${safeId(f.name)}')?.scrollIntoView({ behavior:'smooth', block:'start' });" style="cursor:pointer;border:1px solid var(--br,rgba(27,94,32,0.18));background:#fff;font-size:11px;font-weight:600;white-space:nowrap;transition:all 0.15s ease;" onmouseover="this.style.background='var(--gP,#f4f7f4)';" onmouseout="this.style.background='#fff';">
              👤 ${esc(f.name)} <b style="color:var(--td);margin-left:3px">${f.total}h</b>
            </button>
          `).join('')}
        </div>
      ` : ''}

      <!-- Scrollable Stream of Individual Instructor Timetable Grids -->
      <div class="tt-faculty-stream-scrollable" id="tt-faculty-stream-scroll-container">
        ${facultyData.map(f => {
          const isOverload = f.total > 18;
          return `
            <div class="tt-faculty-stream-card" id="${safeId(f.name)}">
              <div class="panel-head" style="padding:12px 18px;background:var(--gP,#f4f7f4);border-bottom:1px solid var(--br,rgba(27,94,32,0.12));display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                  <div style="font-size:15px;font-weight:800;color:var(--td);display:flex;align-items:center;gap:6px;">
                    <span>👤 ${esc(f.name)}</span>
                  </div>
                  <span class="pill ${isOverload ? 'red' : (f.total >= 12 ? 'green' : '')}" style="${!isOverload && f.total >= 12 ? 'background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;' : ''}font-weight:700;font-size:12px;">
                    ${f.total} hrs/wk
                  </span>
                  <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;font-size:11px;">
                    <b>${f.theory}h</b> Theory
                  </span>
                  <span class="pill warn" style="font-size:11px;">
                    <b>${f.lab}h</b> Lab
                  </span>
                  <span class="pill pri" style="font-size:11px;">
                    ${f.sections.length} Section(s): ${f.sections.join(', ') || '—'}
                  </span>
                  ${f.subjects.length ? `
                    <span style="font-size:11.5px;color:var(--tmu);">
                      📚 ${esc(f.subjects.slice(0, 3).join(', '))}${f.subjects.length > 3 ? '…' : ''}
                    </span>
                  ` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                  <button type="button" class="btn-out" onclick="event.stopPropagation(); selectFaculty('${esc(f.name)}');" style="padding:4px 12px;font-size:11.5px">
                    Inspect Single Load →
                  </button>
                </div>
              </div>
              <div class="panel-body" style="padding:14px 16px;">
                ${f.entries.length 
                  ? renderTeacherWeeklyGrid(f.entries) 
                  : `<div style="text-align:center;padding:24px;color:var(--tmu);font-size:12.5px;">No active timetable slots found for ${esc(f.name)}</div>`}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderAllFacultyOverview(teachers, allSource) {
  const stats = teachers.map(teacherName => {
    const entries = allSource.filter(e => (e.teacher || '').toLowerCase() === teacherName.toLowerCase());
    let total = 0;
    let theory = 0;
    let lab = 0;
    const sections = new Set();
    const rooms = new Set();
    const subjects = new Set();
    entries.forEach(e => {
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
      entriesCount: entries.length,
      total,
      theory,
      lab,
      sections: Array.from(sections),
      rooms: Array.from(rooms),
      subjects: Array.from(subjects)
    };
  });

  stats.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return `<div class="panel">
    <div class="panel-head">
      <div>
        <h2>Institutional Teaching Directory — 👥 All Faculty</h2>
        <p>Complete institutional master directory of teaching faculty allocations and weekly class workloads.</p>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="pill pri">${teachers.length} Active Instructors</span>
        <span class="pill" style="background:#e8f5e9;color:#1b5e20;">${allSource.length} Teaching Slots</span>
      </div>
    </div>
    <div class="panel-body" style="padding:0;overflow-x:auto;">
      <table class="tt-faculty-table">
        <thead>
          <tr>
            <th>Faculty Member</th>
            <th>Weekly Load</th>
            <th>Theory / Lab Split</th>
            <th>Assigned Classes</th>
            <th>Allocated Rooms</th>
            <th style="text-align:right;">Weekly Grid</th>
          </tr>
        </thead>
        <tbody>
          ${stats.map(s => `<tr>
            <td>
              <div style="font-weight:700;font-size:13.5px;color:var(--td,#1a2e1a);display:flex;align-items:center;gap:6px;">
                <span>👤 ${esc(s.name)}</span>
              </div>
              <div style="font-size:11.5px;color:var(--tmu,#5a7a5a);margin-top:2px;">
                ${s.subjects.length ? `${s.subjects.length} Subject(s): ${esc(s.subjects.slice(0, 3).join(', '))}${s.subjects.length > 3 ? '…' : ''}` : 'No subjects assigned yet'}
              </div>
            </td>
            <td>
              <span style="font-weight:800;font-size:14px;color:${s.total > 18 ? '#dc2626' : (s.total > 0 ? 'var(--gD,#1b5e20)' : 'var(--tmu,#5a7a5a)')};">
                ${s.total} hrs/wk
              </span>
            </td>
            <td>
              <div style="display:flex;gap:5px;flex-wrap:wrap;">
                <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;font-size:11px;padding:2px 7px;">${s.theory}h Theory</span>
                <span class="pill warn" style="font-size:11px;padding:2px 7px;">${s.lab}h Lab</span>
              </div>
            </td>
            <td>
              <div style="display:flex;gap:4px;flex-wrap:wrap;">
                ${s.sections.length ? s.sections.map(sec => `<span class="pill pri" style="font-size:10.5px;padding:1px 6px;">${esc(sec)}</span>`).join('') : '<span style="color:var(--tmu);font-size:11.5px;">—</span>'}
              </div>
            </td>
            <td>
              <div style="display:flex;gap:4px;flex-wrap:wrap;">
                ${s.rooms.length ? s.rooms.map(rm => `<span style="font-size:11px;color:var(--tmu);background:var(--gP,#f4f7f4);padding:2px 6px;border-radius:4px;border:1px solid var(--br,rgba(27,94,32,0.12));">📍 ${esc(rm)}</span>`).join('') : '<span style="color:var(--tmu);font-size:11.5px;">—</span>'}
              </div>
            </td>
            <td style="text-align:right;">
              <button type="button" class="tt-faculty-link-btn" onclick="selectFacultyMember('${esc(s.name)}')">
                📅 View Schedule ➔
              </button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>` +
  renderAllFacultySlotsStream(teachers, allSource, 'Weekly Teaching Schedules by Faculty Member');
}

function renderSingleFacultyPanel(selectedTeacher, teacherEntries) {
  return `<div class="panel">
    <div class="panel-head">
      <div>
        <h2>Weekly Teaching Matrix — 👤 ${esc(selectedTeacher)}</h2>
        <p>Complete weekly schedule of lectures and laboratory sessions for this instructor.</p>
      </div>
      <span class="pill pri">${teacherEntries.length} Teaching Slots</span>
    </div>
    <div class="panel-body">
      ${teacherEntries.length ? renderTeacherWeeklyGrid(teacherEntries) : emptyState(`No slots scheduled for ${esc(selectedTeacher)}`, 'This faculty member has no teaching allocations in the current active dataset.')}
    </div>
  </div>`;
}

function getActiveFacultyCard(triggerEl) {
  if (triggerEl) {
    const card = triggerEl.closest('#tt-faculty-selector-card, .tt-class-selector-card');
    if (card) return card;
  }
  const fullPage = document.getElementById('tt-full-page-container');
  if (fullPage && fullPage.style.display !== 'none') {
    const card = fullPage.querySelector('#tt-faculty-selector-card');
    if (card) return card;
  }
  const activePane = document.querySelector('.tt-tab-pane:not([hidden])');
  if (activePane) {
    const card = activePane.querySelector('#tt-faculty-selector-card');
    if (card) return card;
  }
  return document.getElementById('tt-faculty-selector-card');
}

function openFacultyDropdown(triggerEl) {
  const card = getActiveFacultyCard(triggerEl);
  const dd = card ? card.querySelector('#tt-faculty-dropdown') : document.getElementById('tt-faculty-dropdown');
  const menu = dd ? (dd.querySelector('.tt-dropdown-menu') || document.getElementById('tt-faculty-dropdown-menu')) : document.getElementById('tt-faculty-dropdown-menu');
  const trigger = dd ? (dd.querySelector('.tt-dropdown-trigger') || document.getElementById('tt-faculty-dropdown-trigger')) : document.getElementById('tt-faculty-dropdown-trigger');
  const searchInput = dd ? (dd.querySelector('.tt-dropdown-search-input') || document.getElementById('tt-faculty-search-input')) : document.getElementById('tt-faculty-search-input');
  if (!dd || !menu) return;

  closeCascadeDropdowns();
  if (typeof closeRoomDropdown === 'function') closeRoomDropdown();

  dd.classList.add('is-open');
  if (card) card.classList.add('dropdown-active');
  menu.style.display = 'block';
  if (trigger) trigger.setAttribute('aria-expanded', 'true');

  if (searchInput) {
    searchInput.value = '';
    filterFacultyDropdown('', searchInput);
    setTimeout(() => {
      try { searchInput.focus(); } catch (e) {}
    }, 30);
  }

  const activeItem = menu.querySelector('.tt-dropdown-item.selected');
  if (activeItem) {
    activeItem.scrollIntoView({ block: 'nearest' });
  }
}

function closeFacultyDropdown(triggerEl) {
  const card = getActiveFacultyCard(triggerEl);
  const dd = card ? card.querySelector('#tt-faculty-dropdown') : document.getElementById('tt-faculty-dropdown');
  if (dd) {
    dd.classList.remove('is-open');
    const menu = dd.querySelector('.tt-dropdown-menu') || document.getElementById('tt-faculty-dropdown-menu');
    if (menu) menu.style.display = 'none';
    const trigger = dd.querySelector('.tt-dropdown-trigger') || document.getElementById('tt-faculty-dropdown-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }
  if (card) card.classList.remove('dropdown-active');
}

function toggleFacultyDropdown(triggerEl) {
  const card = getActiveFacultyCard(triggerEl);
  const dd = card ? card.querySelector('#tt-faculty-dropdown') : document.getElementById('tt-faculty-dropdown');
  if (dd && dd.classList.contains('is-open')) {
    closeFacultyDropdown(triggerEl);
  } else {
    openFacultyDropdown(triggerEl);
  }
}

function filterFacultyDropdown(rawQuery, inputEl) {
  const q = String(rawQuery || '').trim().toLowerCase();
  const card = inputEl ? inputEl.closest('#tt-faculty-selector-card, .tt-class-selector-card') : getActiveFacultyCard();
  const dd = card ? card.querySelector('#tt-faculty-dropdown') : document.getElementById('tt-faculty-dropdown');
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
}

function selectFaculty(val) {
  state.selectedFaculty = val || 'all';
  closeFacultyDropdown();
  render();
}
function selectWorkloadTab(tab) {
  state.workloadTab = tab;
  render();
}
window.selectWorkloadTab = selectWorkloadTab;
window.selectFacultyMember = selectFaculty;
window.selectFaculty = selectFaculty;
window.toggleFacultyDropdown = toggleFacultyDropdown;
window.openFacultyDropdown = openFacultyDropdown;
window.closeFacultyDropdown = closeFacultyDropdown;
window.filterFacultyDropdown = filterFacultyDropdown;

function renderTeacherWeeklyGrid(entries) {
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
              <span class="pill pri" style="font-size:10px;padding:1px 6px;">🏫 ${esc(entry.section)}</span>
              <span style="font-size:11px;color:var(--tmu);">📍 ${esc(entry.room)}</span>
              ${span > 1 ? `<span class="pill warn" style="font-size:9.5px;padding:1px 4px;">${span}p</span>` : ''}
            </div>
          </div>
        </td>`;

        for (let n = 0; n < span; n += 1) occupied.add(`${day}:${PERIODS[index + n]?.[0]}`);
        index += span;
        continue;
      }

      html += `<td><div style="text-align:center;color:var(--tmu);font-size:11.5px;opacity:0.4;">—</div></td>`;
      index += 1;
    }
    html += '</tr>';
  });

  html += `</tbody></table></div>`;
  return html;
}

// ── ROOM-WISE FREE SLOTS FINDER (Item 8) ──
function roomFreeSlotsView() {
  const allSource = getAllClassesEntries();
  const masterRooms = (_masterData?.rooms || []).map(r => r.hallNo || r.name).filter(Boolean);
  const sourceRooms = (allSource || []).map(e => e.room).filter(Boolean);
  const staticRooms = (typeof ROOMS !== 'undefined' && Array.isArray(ROOMS)) ? ROOMS : [];
  const rawRooms = [...masterRooms, ...sourceRooms, ...staticRooms];
  const rooms = [...new Set(rawRooms)].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  
  const selectedRoom = state.selectedRoom || '__all__';
  const isAll = !selectedRoom || selectedRoom === '__all__';

  const currentRoomLabel = isAll ? 'All Campus Classrooms & Laboratories' : selectedRoom;
  const currentRoomIsLab = !isAll && selectedRoom.toLowerCase().includes('lab');
  const labCount = rooms.filter(r => r.toLowerCase().includes('lab')).length;
  const hallCount = rooms.length - labCount;

  // Compute stats across all rooms
  const roomStats = rooms.map(r => {
    let occupiedCount = 0;
    DAYS.forEach(day => {
      PERIODS.forEach(p => {
        if (BREAK_PERIODS.has(p[0])) return;
        if (allSource.some(e => e.room === r && e.day === day && overlaps(e, { day, period: p[0], duration: 1 }))) {
          occupiedCount++;
        }
      });
    });
    const totalTeachingPeriods = DAYS.length * PERIODS.filter(p => !BREAK_PERIODS.has(p[0])).length;
    const freePeriods = Math.max(0, totalTeachingPeriods - occupiedCount);
    const isLab = r.toLowerCase().includes('lab');
    return { room: r, occupied: occupiedCount, free: freePeriods, total: totalTeachingPeriods, isLab };
  });

  // Compute for Single Room view if specific room selected
  const freeSlots = [];
  let singleOccupiedCount = 0;
  if (!isAll) {
    DAYS.forEach(day => {
      PERIODS.forEach(p => {
        if (BREAK_PERIODS.has(p[0])) return;
        const occupied = allSource.some(e => e.room === selectedRoom && e.day === day && overlaps(e, { day, period: p[0], duration: 1 }));
        if (!occupied) {
          freeSlots.push({ day, period: p[0], time12: `${format12h(p[1])} – ${format12h(p[2])}` });
        } else {
          singleOccupiedCount++;
        }
      });
    });
  }

  const statPillsHtml = isAll ? `
    <span class="pill pri"><b>${rooms.length}</b> Facilities Monitored</span>
    <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;"><b>${labCount}</b> Labs</span>
    <span class="pill" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;"><b>${hallCount}</b> Lecture Halls</span>
  ` : `
    <span class="pill ${currentRoomIsLab ? 'warn' : ''}">${currentRoomIsLab ? '🧪 Laboratory' : '📍 Lecture Hall'}</span>
    <span class="pill pri"><b>${freeSlots.length}</b> Free Periods</span>
    <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;"><b>${singleOccupiedCount}</b> Scheduled</span>
  `;

  const selectorBarHtml = renderRoomSelectorCard(selectedRoom, rooms, statPillsHtml);

  if (isAll) {
    return heading('Facility & Hall Optimization', 'Free Slots Finder (Room-Wise)', 'Available periods across all classrooms and laboratories for remedial sessions or rescheduling', '') +
      selectorBarHtml +
      `<div class="panel">
        <div class="panel-head">
          <div>
            <h2>Campus Facility Free Capacity Matrix</h2>
            <p>Calculated unallocated teaching periods across all registered rooms &amp; labs.</p>
          </div>
          <span class="pill pri">${rooms.length} Facilities Monitored</span>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Room / Laboratory</th>
              <th>Facility Type</th>
              <th>Occupied Periods / Wk</th>
              <th>Free / Unallocated Periods / Wk</th>
              <th>Availability Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${roomStats.map(s => `<tr>
              <td><b>📍 ${esc(s.room)}</b></td>
              <td><span class="pill ${s.isLab ? 'warn' : ''}">${s.isLab ? 'Laboratory' : 'Lecture Hall'}</span></td>
              <td><b style="font-size:14px">${s.occupied}</b> periods</td>
              <td><span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;font-weight:700;font-size:13px">${s.free} free periods</span></td>
              <td>
                ${s.free > 20
                  ? '<span class="pill" style="background:#e8f5e9;color:#1b5e20;">🟢 High Availability (>20h)</span>'
                  : (s.free >= 8
                    ? '<span class="pill" style="background:#fef3c7;color:#92400e;">🟡 Moderate Availability</span>'
                    : '<span class="pill red">🔴 Busy / High Occupancy</span>')}
              </td>
              <td>
                <button type="button" class="btn-out view-room-slots-btn" data-room="${esc(s.room)}" onclick="event.stopPropagation(); selectRoom('${esc(s.room)}');" style="padding:4px 10px;font-size:11.5px">Inspect Free Slots →</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Specific room selected
  return heading('Facility & Hall Optimization', 'Free Slots Finder (Room-Wise)', 'Available periods across all classrooms and laboratories for remedial sessions or rescheduling', '') +
    selectorBarHtml +
    (freeSlots.length ? `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>Available Unallocated Periods — 📍 ${esc(selectedRoom)}</h2>
          <p>Times when this facility is entirely unoccupied and available for allocation.</p>
        </div>
        <span class="pill" style="background:#e8f5e9;color:#1b5e20;">✓ ${freeSlots.length} Available Slots</span>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Day</th>
            <th>Period</th>
            <th>Time Window (12h)</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${freeSlots.map(x => `<tr>
            <td><b>${x.day}</b></td>
            <td><span class="pill">${x.period}</span></td>
            <td style="font-family:'DM Mono',monospace">${x.time12}</td>
            <td><span class="pill" style="background:#e8f5e9;color:#1b5e20;">Available for Allocation</span></td>
            <td>
              ${state.env === 'development'
                ? `<button type="button" class="btn-out schedule-in-room-btn" data-day="${x.day}" data-period="${x.period}" data-room="${esc(selectedRoom)}" style="padding:4px 10px;font-size:11.5px">+ Schedule Here</button>`
                : '<span class="pill">Read-only in Production</span>'}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState(`No free slots in ${esc(selectedRoom)}`, 'This room is 100% occupied during all teaching periods.'));
}

// ── ROOM DROPDOWN HELPERS ──
function getActiveRoomCard(triggerEl) {
  if (triggerEl) {
    const card = triggerEl.closest('#tt-room-selector-card, .tt-class-selector-card');
    if (card) return card;
  }
  const fullPage = document.getElementById('tt-full-page-container');
  if (fullPage && fullPage.style.display !== 'none') {
    const card = fullPage.querySelector('#tt-room-selector-card');
    if (card) return card;
  }
  const activePane = document.querySelector('.tt-tab-pane:not([hidden])');
  if (activePane) {
    const card = activePane.querySelector('#tt-room-selector-card');
    if (card) return card;
  }
  return document.getElementById('tt-room-selector-card');
}

function openRoomDropdown(triggerEl) {
  const card = getActiveRoomCard(triggerEl);
  const dd = card ? card.querySelector('#tt-room-dropdown') : document.getElementById('tt-room-dropdown');
  const menu = dd ? (dd.querySelector('.tt-dropdown-menu') || document.getElementById('tt-room-dropdown-menu')) : document.getElementById('tt-room-dropdown-menu');
  const trigger = dd ? (dd.querySelector('.tt-dropdown-trigger') || document.getElementById('tt-room-dropdown-trigger')) : document.getElementById('tt-room-dropdown-trigger');
  const searchInput = dd ? (dd.querySelector('.tt-dropdown-search-input') || document.getElementById('tt-room-search-input')) : document.getElementById('tt-room-search-input');
  if (!dd || !menu) return;

  closeCascadeDropdowns();
  if (typeof closeFacultyDropdown === 'function') closeFacultyDropdown();

  dd.classList.add('is-open');
  if (card) card.classList.add('dropdown-active');
  menu.style.display = 'block';
  if (trigger) trigger.setAttribute('aria-expanded', 'true');

  if (searchInput) {
    searchInput.value = '';
    filterRoomDropdown('', searchInput);
    setTimeout(() => {
      try { searchInput.focus(); } catch (e) {}
    }, 30);
  }

  const activeItem = menu.querySelector('.tt-dropdown-item.selected');
  if (activeItem) {
    activeItem.scrollIntoView({ block: 'nearest' });
  }
}

function closeRoomDropdown(triggerEl) {
  const card = getActiveRoomCard(triggerEl);
  const dd = card ? card.querySelector('#tt-room-dropdown') : document.getElementById('tt-room-dropdown');
  if (dd) {
    dd.classList.remove('is-open');
    const menu = dd.querySelector('.tt-dropdown-menu') || document.getElementById('tt-room-dropdown-menu');
    if (menu) menu.style.display = 'none';
    const trigger = dd.querySelector('.tt-dropdown-trigger') || document.getElementById('tt-room-dropdown-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }
  if (card) card.classList.remove('dropdown-active');
}

function toggleRoomDropdown(triggerEl) {
  const card = getActiveRoomCard(triggerEl);
  const dd = card ? card.querySelector('#tt-room-dropdown') : document.getElementById('tt-room-dropdown');
  if (dd && dd.classList.contains('is-open')) {
    closeRoomDropdown(triggerEl);
  } else {
    openRoomDropdown(triggerEl);
  }
}

function filterRoomDropdown(rawQuery, inputEl) {
  const q = String(rawQuery || '').trim().toLowerCase();
  const card = inputEl ? inputEl.closest('#tt-room-selector-card, .tt-class-selector-card') : getActiveRoomCard();
  const dd = card ? card.querySelector('#tt-room-dropdown') : document.getElementById('tt-room-dropdown');
  if (!dd) return;

  const list = dd.querySelector('#tt-room-options-list');
  const emptyBox = dd.querySelector('#tt-room-dropdown-empty');
  const emptyQuerySpan = dd.querySelector('#tt-empty-room-query');
  const clearBtn = dd.querySelector('#tt-room-search-clear');
  const countText = dd.querySelector('#tt-room-dropdown-count-text');
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
    countText.textContent = q ? `${matches} matching facilities` : `Available Facilities (${items.length - 1})`;
  }
  if (emptyBox) {
    emptyBox.style.display = matches === 0 ? 'flex' : 'none';
    if (emptyQuerySpan) emptyQuerySpan.textContent = rawQuery;
  }
}

function selectRoom(val) {
  state.selectedRoom = val || '__all__';
  closeRoomDropdown();
  render();
}
window.selectRoom = selectRoom;
window.toggleRoomDropdown = toggleRoomDropdown;
window.openRoomDropdown = openRoomDropdown;
window.closeRoomDropdown = closeRoomDropdown;
window.filterRoomDropdown = filterRoomDropdown;

// ── CONFLICT & HOD APPROVALS VIEW (Item 6) ──
function approvalsView() {
  const clashes = allConflicts(state.entries);
  const requests = state.verificationRequests || [];

  return heading('Audit & Integrity', 'Conflict & Verification Center', 'Review detected clashes, Department HoD approval status, and publish approved schedules to live production', '') +
    (clashes.length ? `<div class="panel" style="margin-bottom:18px;">
      <div class="panel-head">
        <h2 style="color:var(--danger,#dc2626)">⚠️ ${clashes.length} Detected Schedule Clash(es)</h2>
        <p>Faculty or room collisions must be resolved before live production deployment.</p>
      </div>
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
    </div>` : '') +
    `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>Department HoD Timetable Verification Requests</h2>
          <p>Official approval workflow: Timetables submitted for HoD verification, reviewed, and published to all.</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn-out" id="refresh-verifications-btn" style="padding:4px 12px;font-size:12px">🔄 Refresh</button>
        </div>
      </div>
      ${requests.length ? `
        <table class="table">
          <thead>
            <tr>
              <th>Class / Section</th>
              <th>Version</th>
              <th>Requested By</th>
              <th>Submission Date</th>
              <th>Status</th>
              <th>Notes / Remarks</th>
              <th style="min-width:160px">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${requests.map(r => {
              const status = r.verificationStatus || r.status || 'pending';
              const isPending = status === 'pending';
              const isApproved = status === 'approved';
              const isPublished = status === 'published';
              const reqDate = r.verificationRequest?.requestedAt || r.createdAt;
              const dateStr = reqDate ? new Date(reqDate).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

              return `<tr>
                <td><b>🏫 ${esc(r.className || 'General')}</b></td>
                <td><span class="pill pri"><b>${esc(r.versionName || `v${r.version}`)}</b></span></td>
                <td style="font-size:12px">👤 ${esc(r.verificationRequest?.requestedBy || r.savedBy || 'Coordinator')}</td>
                <td style="font-size:12px;color:var(--tmu);font-family:'DM Mono',monospace">${dateStr}</td>
                <td>
                  ${isPending ? '<span class="pill warn">⏳ Pending HoD Approval</span>' : ''}
                  ${isApproved ? '<span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;">✓ Approved by HoD</span>' : ''}
                  ${isPublished ? '<span class="pill" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">🚀 Live in Production</span>' : ''}
                  ${status === 'rejected' ? '<span class="pill red">✕ Rejected by HoD</span>' : ''}
                </td>
                <td style="font-size:12px;color:var(--tmu);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.verificationRequest?.notes || r.changeSummary || '')}">
                  ${esc(r.verificationRequest?.notes || r.changeSummary || '—')}
                  ${r.verificationRequest?.comment ? `<br><small style="color:#1b5e20;"><b>HoD Comment:</b> ${esc(r.verificationRequest.comment)}</small>` : ''}
                </td>
                <td>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    ${isPending ? `
                      <button type="button" class="btn-pri hod-approve-btn" data-id="${esc(r._id)}" style="padding:4px 10px;font-size:11.5px;background:#16a34a;" title="Approve this timetable as Head of Department">✓ Approve</button>
                      <button type="button" class="btn-out hod-reject-btn" data-id="${esc(r._id)}" style="padding:4px 8px;font-size:11.5px;color:#dc2626;" title="Reject this timetable draft">✕ Reject</button>
                    ` : ''}
                    ${isApproved ? `
                      <button type="button" class="btn-pri publish-all-btn" data-id="${esc(r._id)}" style="padding:4px 12px;font-size:11.5px;background:linear-gradient(135deg,var(--gD,#1b5e20),#2e7d32);" title="Publish approved timetable to all students and staff">🚀 Publish to All</button>
                    ` : ''}
                    ${isPublished ? `
                      <span style="font-size:11.5px;color:var(--gD);font-weight:700;">✓ Active Live</span>
                    ` : ''}
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      ` : emptyState('No verification requests found', 'When you publish a draft in the Draft Editor, select "Submit for Production" to send a verification request to the HoD.')}
    </div>`;
}

function historyView() {
  state.historyTrack = state.env || 'production';
  const versions = state.versions || [];
  const isDev = state.historyTrack === 'development';
  return heading('Audit Trail', 'Version History', 'Immutable snapshots and development workspace drafts', button('↻ Refresh', 'btn-out', 'refresh-versions-btn')) +
    renderClassSelectorBar() +
    controls(false) +
    `<div class="panel">
      <div class="panel-head" style="flex-wrap:wrap;gap:12px;">
        <div>
          <h2>${isDev ? '🛠️ Development Drafts History' : '🚀 Live Production Publication Log'}</h2>
          <p>${isDev ? 'Working revisions and draft iterations saved in the development workspace.' : 'Audit trail of deployed semester timetables with one-click restore to draft editor.'}</p>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="pill ${isDev ? 'warn' : 'pri'}" style="font-weight:700;padding:6px 12px;font-size:12px;" title="Switch environment using the topbar toggle">
            ${isDev ? '🛠️ Development Mode' : '🚀 Live Production'}
          </span>
          <span class="pill pri">${versions.length} ${isDev ? 'draft' : 'snapshot'}${versions.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      ${state.loadingVersions
        ? '<div style="text-align:center;padding:36px;color:var(--tmu);font-size:13px;">Syncing version records…</div>'
        : (!versions.length
          ? emptyState(
              isDev ? 'No Development Drafts Found' : 'No Publication History Found',
              isDev ? 'No saved draft revisions exist for this class. Save a timetable draft in Development mode to create one.' : 'Snapshot versions are automatically created whenever a coordinator publishes a draft timetable to production.'
            )
          : `<div style="overflow-x:auto;">
              <table class="table">
                <thead>
                  <tr>
                    <th>${isDev ? 'Template / Version' : 'Version'}</th>
                    <th>${isDev ? 'Last Saved' : 'Published Date'}</th>
                    <th>${isDev ? 'Saved By' : 'Published By'}</th>
                    <th>Class / Section</th>
                    <th>Active Slots</th>
                    <th>${isDev ? 'Status' : 'Change Summary'}</th>
                    <th style="text-align:right;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${versions.map(v => {
                    const pubDate = v.publishedAt || v.updatedAt || v.createdAt;
                    const dateStr = pubDate ? new Date(pubDate).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
                    const slotCount = isDev ? (v.grid || []).length : ((v.snapshot?.grid || []).length);
                    const clsName = v.className || (v.snapshot?.className) || state.filterSection || 'Class';
                    const verLabel = isDev ? (v.name || `v${v.version || 1} Draft`) : (v.label || `v${v.snapshot?.version || 1}`);
                    const summaryOrStatus = isDev
                      ? (v.status === 'draft' ? '<span class="pill pri">Draft</span>' :
                         (v.status === 'pending_approval' ? '<span class="pill warn">Pending HoD</span>' :
                         (v.status === 'rejected' ? '<span class="pill red">Rejected</span>' : `<span class="pill">${esc(v.status || 'draft')}</span>`)))
                      : `<span style="font-size:12px;color:var(--tmu);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;" title="${esc(v.changeSummary || '')}">${esc(v.changeSummary || 'Published from Development')}</span>`;

                    return `<tr>
                      <td>
                        <div style="display:flex;align-items:center;gap:8px;">
                          <span class="pill pri" style="font-weight:700;">${esc(verLabel)}</span>
                        </div>
                      </td>
                      <td style="font-size:12.5px;color:var(--td);">${esc(dateStr)}</td>
                      <td style="font-size:12.5px;"><b>👤 ${esc(v.publishedBy || v.createdBy || 'Coordinator')}</b></td>
                      <td><b>${esc(clsName)}</b></td>
                      <td><span class="pill" style="font-size:11px;">${slotCount} slots</span></td>
                      <td>${summaryOrStatus}</td>
                      <td style="text-align:right;">
                        <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;">
                          ${!isDev ? `<button class="btn-out inspect-version-btn" data-version-id="${esc(v._id)}" style="padding:4px 10px;font-size:11.5px;" title="Inspect timetable slots in this snapshot">👁 View</button>` : ''}
                          <button class="btn-pri restore-version-btn" data-version-id="${esc(v._id)}" style="padding:4px 12px;font-size:11.5px;" title="Restore this version as working draft">↺ Restore to Draft</button>
                        </div>
                      </td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>`
        )}
    </div>`;
}

function attendanceView() {
  const d = state.attendanceInsights;
  const range = state.attendanceRange || 30;

  const rangeButtons = [7, 15, 30, 60].map(days => `
    <button type="button" class="att-range-btn ${range === days ? 'active' : ''}" data-days="${days}" style="padding:5px 12px;font-size:12px;font-weight:700;border:none;border-radius:6px;background:${range === days ? 'var(--gM, #2e7d32)' : 'transparent'};color:${range === days ? '#fff' : 'var(--td, #1a2e1a)'};cursor:pointer;transition:all .2s ease;">
      ${days}D
    </button>
  `).join('');

  const topButtons = `
    <div style="display:inline-flex;border-radius:8px;border:1px solid var(--br, rgba(27,94,32,0.15));background:#ffffff;padding:2px;margin-right:8px;">
      ${rangeButtons}
    </div>
    ${button('📥 Export Student CSV', 'btn-out', 'export-attendance-csv')}
    ${button('↻ Refresh', 'btn-out', 'refresh-attendance-btn')}
  `;

  let contentHtml = '';

  if (state.loadingAttendance) {
    contentHtml = `<div class="panel" style="padding:48px 24px;text-align:center;">
      <div style="font-size:28px;margin-bottom:8px;">📊</div>
      <b style="font-size:15px;color:var(--td);">Analyzing Class Attendance Metrics…</b>
      <p style="font-size:12px;color:var(--tmu);margin-top:4px;">Aggregating sessions, student turnout patterns, method distributions, and period correlations.</p>
    </div>`;
  } else if (!d || !d.kpi || d.kpi.sessionCount === 0) {
    contentHtml = emptyState(
      'No Attendance Sessions Found',
      `No verified class sessions found for ${esc(state.filterSection || 'this class')} in the last ${range} days. Mark QR or manual attendance in EAMS to populate live analytics.`
    );
  } else {
    const k = d.kpi;
    const isMeetingTarget = k.avgPercentage >= (k.minThreshold || 75);

    // KPI Cards
    const kpiHtml = `
      <div class="kpis" style="margin-bottom:20px;">
        <div class="kpi-card" style="border-left:4px solid ${isMeetingTarget ? 'var(--gM, #2e7d32)' : '#dc2626'};">
          <div class="kpi-val" style="color:${isMeetingTarget ? 'var(--gM, #2e7d32)' : '#dc2626'};">${k.avgPercentage}%</div>
          <div class="kpi-lbl">Class Average Turnout</div>
          <div style="font-size:11px;color:${isMeetingTarget ? '#166534' : '#991b1b'};margin-top:4px;font-weight:600;">
            ${isMeetingTarget ? '✓ Meeting 75% target' : '⚠️ Below 75% requirement'}
          </div>
        </div>
        <div class="kpi-card" style="border-left:4px solid ${k.defaultersCount > 0 ? '#dc2626' : '#2e7d32'};">
          <div class="kpi-val" style="color:${k.defaultersCount > 0 ? '#dc2626' : 'var(--td)'};">${k.defaultersCount}</div>
          <div class="kpi-lbl">Defaulter Students</div>
          <div style="font-size:11px;color:var(--tmu);margin-top:4px;">Students with &lt; 75% attendance</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-val">${k.sessionCount}</div>
          <div class="kpi-lbl">Class Sessions Held</div>
          <div style="font-size:11px;color:var(--tmu);margin-top:4px;">${k.totalMarks} total student verifications</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-val" style="font-size:19px;">${esc(k.topMethod)}</div>
          <div class="kpi-lbl">Primary Capture Method</div>
          <div style="font-size:11px;color:var(--tmu);margin-top:4px;">Quick Pass · Live QR · Rep · Manual</div>
        </div>
      </div>
    `;

    // Method breakdown progress bars
    const totalM = d.methods.total || 1;
    const methodItems = [
      { label: 'Quick Pass (12-Char Code)', count: d.methods.quickPass, color: '#3b82f6', bg: '#eff6ff' },
      { label: 'Live Scan / QR (7-Layer)', count: d.methods.liveScan, color: '#10b981', bg: '#ecfdf5' },
      { label: 'Rep Share (Class Rep)', count: d.methods.repShare, color: '#8b5cf6', bg: '#f5f3ff' },
      { label: 'Manual Teacher Marking', count: d.methods.manual, color: '#f59e0b', bg: '#fffbeb' }
    ];

    const methodBarsHtml = methodItems.map(m => {
      const pct = Math.round((m.count / totalM) * 100);
      return `
        <div style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:4px;">
            <span style="color:var(--td);">${m.label}</span>
            <span style="color:var(--tmu);">${m.count} marks (${pct}%)</span>
          </div>
          <div style="width:100%;height:8px;background:${m.bg};border-radius:6px;overflow:hidden;border:1px solid rgba(0,0,0,.06);">
            <div style="width:${pct}%;height:100%;background:${m.color};border-radius:6px;transition:width .4s ease;"></div>
          </div>
        </div>
      `;
    }).join('');

    // Period-wise chart
    let lowestPeriod = null;
    let lowestPct = 101;
    const periodBars = (d.periodWise || []).map(p => {
      if (p.total > 0 && p.percentage < lowestPct) {
        lowestPct = p.percentage;
        lowestPeriod = p.period;
      }
      const barH = Math.max(10, Math.round((p.percentage / 100) * 110));
      const barColor = p.percentage >= 80 ? '#10b981' : (p.percentage >= 65 ? '#3b82f6' : '#ef4444');
      return `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;" title="Period ${p.period}: ${p.percentage}% attendance (${p.present}/${p.total})">
          <div style="font-size:10px;font-weight:700;color:var(--tmu);">${p.total ? p.percentage + '%' : '—'}</div>
          <div style="width:100%;max-width:32px;height:${barH}px;background:${p.total ? barColor : 'var(--br,#e2e8f0)'};border-radius:5px 5px 0 0;transition:height .3s ease;"></div>
          <div style="font-size:11px;font-weight:700;color:var(--td);margin-top:2px;">P${p.period}</div>
        </div>
      `;
    }).join('');

    const periodInsightText = lowestPeriod
      ? `⚠️ Lowest turnout detected in <b>Period ${lowestPeriod} (${lowestPct}% average)</b>. Consider scheduling interactive sessions or tutorials earlier in the day.`
      : 'Consistent attendance distribution maintained across teaching periods.';

    // Consecutive alerts
    const alertsHtml = (d.consecutiveAlerts || []).length === 0
      ? `<div style="text-align:center;padding:24px;color:#10b981;font-weight:600;font-size:12.5px;">✓ No consecutive absence patterns detected (all enrolled students are attending regularly).</div>`
      : `<div style="overflow-x:auto;">
          <table class="table">
            <thead>
              <tr>
                <th>Student Name</th>
                <th>Register No</th>
                <th>Consecutive Absences</th>
                <th>Overall Turnout</th>
                <th>Last Attended</th>
              </tr>
            </thead>
            <tbody>
              ${d.consecutiveAlerts.map(a => `
                <tr>
                  <td><b>${esc(a.name)}</b></td>
                  <td><code>${esc(a.regNo)}</code></td>
                  <td><span class="pill red" style="font-weight:800;">${a.consecutive} consecutive classes missed</span></td>
                  <td><b style="color:${a.percentage < 75 ? '#dc2626' : 'var(--td)'};">${a.percentage}%</b></td>
                  <td style="color:var(--tmu);font-size:12px;">${esc(a.lastAttended || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;

    // Filter student summary by search
    const q = (state.attendanceSearch || '').toLowerCase().trim();
    const filteredStudents = (d.studentSummary || []).filter(s =>
      !q || (s.name && s.name.toLowerCase().includes(q)) || (s.regNo && s.regNo.toLowerCase().includes(q))
    );

    // Student roster table
    const rosterTableHtml = filteredStudents.length === 0
      ? `<div style="text-align:center;padding:24px;color:var(--tmu);font-size:12.5px;">No students matching "${esc(state.attendanceSearch)}".</div>`
      : `<div style="overflow-x:auto;">
          <table class="table">
            <thead>
              <tr>
                <th>Register No</th>
                <th>Student Name</th>
                <th>Sessions Held</th>
                <th>Attended</th>
                <th>Attendance %</th>
                <th style="min-width:140px;">Turnout Meter</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${filteredStudents.map(s => {
                const statusPill = s.status === 'good'
                  ? '<span class="pill pri">Good (≥85%)</span>'
                  : (s.status === 'warning' ? '<span class="pill warn">Warning (75–84%)</span>' : '<span class="pill red">Defaulter (&lt;75%)</span>');
                const meterColor = s.percentage >= 85 ? '#10b981' : (s.percentage >= 75 ? '#f59e0b' : '#ef4444');
                return `
                  <tr>
                    <td><code>${esc(s.regNo)}</code></td>
                    <td><b>${esc(s.name)}</b></td>
                    <td>${s.held}</td>
                    <td>${s.attended}</td>
                    <td><b style="color:${meterColor};font-size:13.5px;">${s.percentage}%</b></td>
                    <td>
                      <div style="width:100%;height:8px;background:var(--br,#e2e8f0);border-radius:4px;overflow:hidden;">
                        <div style="width:${s.percentage}%;height:100%;background:${meterColor};border-radius:4px;"></div>
                      </div>
                    </td>
                    <td>${statusPill}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>`;

    contentHtml = `
      ${kpiHtml}

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(360px, 1fr));gap:20px;margin-bottom:20px;">
        <!-- Card 1: Method Breakdown -->
        <div class="panel" style="margin-bottom:0;">
          <div class="panel-head">
            <div>
              <h2>Attendance Capture Methods</h2>
              <p>Breakdown across Quick Pass, Live QR, Rep Share, and Manual</p>
            </div>
          </div>
          <div class="panel-body" style="padding:18px 22px;">
            ${methodBarsHtml}
          </div>
        </div>

        <!-- Card 2: Period Turnout Comparison -->
        <div class="panel" style="margin-bottom:0;">
          <div class="panel-head">
            <div>
              <h2>Period-Wise Turnout (P1–P9)</h2>
              <p>Comparison of attendance percentages across time slots</p>
            </div>
          </div>
          <div class="panel-body" style="padding:18px 22px;">
            <div style="display:flex;align-items:flex-end;gap:6px;height:140px;padding-top:10px;border-bottom:1px solid var(--br,#e2e8f0);margin-bottom:12px;">
              ${periodBars}
            </div>
            <div style="font-size:11.5px;color:var(--td);line-height:1.4;">${periodInsightText}</div>
          </div>
        </div>
      </div>

      <!-- Consecutive Absence Alerts -->
      <div class="panel" style="margin-bottom:20px;">
        <div class="panel-head">
          <div>
            <h2>⚠️ Consecutive Absence Alerts (3+ Missed Classes)</h2>
            <p>Students exhibiting chronic attendance gaps requiring advisor intervention</p>
          </div>
          <span class="pill ${d.consecutiveAlerts.length ? 'red' : 'pri'}">${d.consecutiveAlerts.length} Student${d.consecutiveAlerts.length === 1 ? '' : 's'}</span>
        </div>
        ${alertsHtml}
      </div>

      <!-- Student Roster Table -->
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>Student Attendance Summary</h2>
            <p>Individual student turnout rates for ${esc(d.classInfo.name || state.filterSection || 'Class')}</p>
          </div>
          <span class="pill pri">${filteredStudents.length} Students</span>
        </div>
        ${rosterTableHtml}
      </div>
    `;
  }

  // Filter bar
  const filterBarHtml = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:8px;">
        <label style="font-size:12.5px;font-weight:700;color:var(--td);">Subject:</label>
        <div class="tt-custom-dropdown" id="att-subject-dropdown" style="min-width:220px;">
          <input type="hidden" id="att-subject-filter" value="${esc(state.attendanceSubject || '')}">
          <div class="tt-dropdown-trigger" id="att-subject-trigger" onclick="event.stopPropagation(); toggleAttSubjectDropdown(this);" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false" style="height:38px;padding:6px 12px;background:var(--cardBg,#fff);border:1px solid var(--br);border-radius:8px;cursor:pointer;" title="Filter by Subject">
            <div class="tt-dropdown-trigger-left" style="display:flex;align-items:center;gap:8px;overflow:hidden;">
              <span class="tt-dropdown-trigger-icon">📖</span>
              <span class="tt-dropdown-trigger-text" id="att-selected-subject-label" style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(state.attendanceSubject || 'All Subjects')}</span>
            </div>
            <div class="tt-dropdown-trigger-right" style="display:flex;align-items:center;gap:6px;">
              <span class="tt-dropdown-trigger-badge">${state.attendanceSubject ? 'Filtered' : `${SUBJECTS.length} Subjects`}</span>
              <span class="tt-dropdown-trigger-arrow">▾</span>
            </div>
          </div>
          <div class="tt-dropdown-menu" id="att-subject-menu" role="listbox" style="display:none;min-width:240px;">
            <div class="tt-dropdown-search-box">
              <span class="tt-dropdown-search-icon">🔍</span>
              <input type="text" class="tt-dropdown-search-input" id="att-subject-search-input" oninput="filterAttSubjectDropdown(this.value, this)" placeholder="Search subjects…" autocomplete="off" spellcheck="false">
              <button type="button" class="tt-dropdown-search-clear" onclick="event.stopPropagation(); const si = this.closest('.tt-custom-dropdown').querySelector('.tt-dropdown-search-input'); if(si){ si.value=''; filterAttSubjectDropdown('', si); si.focus(); }" style="display:none;" title="Clear search">✕</button>
            </div>
            <div class="tt-dropdown-list" id="att-subject-options-list">
              <div class="tt-dropdown-item ${!state.attendanceSubject ? 'selected' : ''}" data-value="" onclick="event.stopPropagation(); selectAttSubject('');" role="option">
                <div class="tt-dropdown-item-left">
                  <span class="tt-dropdown-item-dot"></span>
                  <span class="tt-dropdown-item-text" style="font-weight:700;">All Subjects</span>
                </div>
                <div class="tt-dropdown-item-right">
                  ${!state.attendanceSubject ? '<span class="tt-dropdown-item-check">✓</span>' : ''}
                </div>
              </div>
              ${SUBJECTS.map(s => `
                <div class="tt-dropdown-item ${state.attendanceSubject === s ? 'selected' : ''}" data-value="${esc(s)}" onclick="event.stopPropagation(); selectAttSubject('${esc(s)}');" role="option">
                  <div class="tt-dropdown-item-left">
                    <span class="tt-dropdown-item-dot"></span>
                    <span class="tt-dropdown-item-text">${esc(s)}</span>
                  </div>
                  <div class="tt-dropdown-item-right">
                    ${state.attendanceSubject === s ? '<span class="tt-dropdown-item-check">✓</span>' : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
      <div style="flex:1;min-width:220px;">
        <input type="text" id="att-student-search" class="search-input" placeholder="Search student by name or register no…" value="${esc(state.attendanceSearch)}" style="height:38px;padding:4px 12px;width:100%;">
      </div>
    </div>
  `;

  return heading(
    'Attendance Intelligence',
    'Class Attendance Analytics',
    'Real-time class turnout rates, method verification metrics, student alerts, and period correlations',
    topButtons
  ) + renderClassSelectorBar() + filterBarHtml + contentHtml;
}

function toggleAttSubjectDropdown(triggerEl) {
  const dd = triggerEl ? triggerEl.closest('#att-subject-dropdown') : document.getElementById('att-subject-dropdown');
  const isOpen = dd && dd.classList.contains('is-open');
  closeCascadeDropdowns();
  if (!isOpen && dd) {
    dd.classList.add('is-open');
    const menu = dd.querySelector('#att-subject-menu') || document.getElementById('att-subject-menu');
    if (menu) menu.style.display = 'block';
    const trigger = dd.querySelector('#att-subject-trigger') || document.getElementById('att-subject-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    const sInput = dd.querySelector('#att-subject-search-input');
    if (sInput) {
      sInput.value = '';
      sInput.focus();
    }
  }
}

async function selectAttSubject(subj) {
  state.attendanceSubject = subj || '';
  closeCascadeDropdowns();
  await loadAttendanceInsights();
  render();
}

function filterAttSubjectDropdown(query, inputEl) {
  const dd = inputEl ? inputEl.closest('#att-subject-dropdown') : document.getElementById('att-subject-dropdown');
  if (!dd) return;
  const q = (query || '').toLowerCase().trim();
  const clearBtn = dd.querySelector('.tt-dropdown-search-clear');
  if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';
  const items = dd.querySelectorAll('.tt-dropdown-item');
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
}

// ── Department Subjects Curriculum Management View ──
async function loadSubjectsData() {
  try {
    state.loadingSubjects = true;
    state.loading = true;
    setLiveSyncStatus('loading', 'Loading..');
    const params = new URLSearchParams();
    if (state.subjectDeptFilter && state.subjectDeptFilter !== 'all') {
      params.set('deptId', state.subjectDeptFilter);
    }
    if (state.subjectRegFilter && state.subjectRegFilter !== 'all') {
      params.set('regulation', state.subjectRegFilter);
    }
    const q = params.toString();
    const data = await apiCall('GET', '/subjects' + (q ? `?${q}` : ''));
    state.subjectsList = Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Failed to load subjects:', err);
    state.subjectsList = [];
  } finally {
    state.loadingSubjects = false;
    state.loading = false;
  }
}

function renderSubjectSelectorCard() {
  const depts = _masterData.departments || [];
  const regs = _masterData.regulations || [];
  const subjects = state.subjectsList || [];

  const curDept = state.subjectDeptFilter || 'all';
  const curReg = state.subjectRegFilter || 'all';
  const curSubj = state.subjectFilter || '';

  const foundDept = depts.find(d => String(d._id) === String(curDept));
  const deptLabel = curDept === 'all' ? 'All Departments' : (foundDept ? (foundDept.name || foundDept.code) : curDept);

  const foundReg = regs.find(r => (r.code || r) === curReg);
  const regLabel = curReg === 'all' ? 'All Regulations' : (foundReg ? (foundReg.name ? `${foundReg.code} - ${foundReg.name}` : foundReg.code || foundReg) : curReg);

  const foundSubj = subjects.find(s => (s.code && s.code === curSubj) || String(s._id) === curSubj);
  const subjDisplayLabel = !curSubj ? 'All Subjects' : (foundSubj ? `${foundSubj.code || ''} ${foundSubj.shortName || foundSubj.name}`.trim() : curSubj);

  return `
    <div class="tt-class-selector-card" id="tt-subject-selector-card">
      <div class="tt-class-selector-left" onclick="event.stopPropagation(); toggleSubjectDropdown(this);" style="cursor:pointer;" title="Click to search and select curriculum subject">
        <div class="tt-class-selector-icon">📚</div>
        <div class="tt-class-selector-details">
          <div class="tt-class-selector-label">Department Subjects Matrix</div>
          <div class="tt-class-selector-sub">Filter curriculum by department and regulation or search by course code</div>
        </div>
      </div>

      <div class="tt-class-selector-right">
        <div class="tt-cascade-flow">
          <!-- 1. DEPARTMENT CASCADE SELECTOR -->
          <div class="tt-cascade-dropdown" id="tt-subj-dept-dropdown">
            <div class="tt-cascade-trigger ${curDept !== 'all' ? 'has-filter' : ''}" id="tt-subj-dept-trigger" onclick="event.stopPropagation(); toggleSubjDeptDropdown(this);" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false" title="Filter by Department">
              <span class="tt-cascade-trigger-icon">🏢</span>
              <span class="tt-cascade-trigger-text" id="tt-selected-subj-dept-label">${esc(deptLabel)}</span>
              <span class="tt-cascade-trigger-arrow">▾</span>
            </div>
            <div class="tt-cascade-menu" id="tt-subj-dept-menu" role="listbox" style="display:none;">
              <div class="tt-cascade-menu-header">
                <span>Department</span>
                ${curDept !== 'all' ? '<button type="button" class="tt-cascade-reset" onclick="event.stopPropagation(); selectSubjectDept(\'all\');" data-action="reset-subj-dept">Reset</button>' : ''}
              </div>
              <div class="tt-cascade-list">
                <div class="tt-cascade-item ${curDept === 'all' ? 'selected' : ''}" data-value="all" onclick="event.stopPropagation(); selectSubjectDept('all');" role="option">
                  <span class="tt-cascade-item-dot"></span>
                  <span class="tt-cascade-item-name">All Departments</span>
                  ${curDept === 'all' ? '<span class="tt-cascade-item-check">✓</span>' : ''}
                </div>
                ${depts.map(d => `
                  <div class="tt-cascade-item ${String(curDept) === String(d._id) ? 'selected' : ''}" data-value="${esc(d._id)}" onclick="event.stopPropagation(); selectSubjectDept('${esc(d._id)}');" role="option">
                    <span class="tt-cascade-item-dot"></span>
                    <div class="tt-cascade-item-details">
                      <span class="tt-cascade-item-name">${esc(d.name || d.code)}</span>
                      ${d.code && d.code !== d.name ? `<span class="tt-cascade-item-sub">${esc(d.code)}</span>` : ''}
                    </div>
                    ${String(curDept) === String(d._id) ? '<span class="tt-cascade-item-check">✓</span>' : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <!-- 2. REGULATION CASCADE SELECTOR -->
          <div class="tt-cascade-dropdown" id="tt-subj-reg-dropdown">
            <div class="tt-cascade-trigger ${curReg !== 'all' ? 'has-filter' : ''}" id="tt-subj-reg-trigger" onclick="event.stopPropagation(); toggleSubjRegDropdown(this);" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false" title="Filter by Academic Regulation">
              <span class="tt-cascade-trigger-icon">📜</span>
              <span class="tt-cascade-trigger-text" id="tt-selected-subj-reg-label">${esc(regLabel)}</span>
              <span class="tt-cascade-trigger-arrow">▾</span>
            </div>
            <div class="tt-cascade-menu" id="tt-subj-reg-menu" role="listbox" style="display:none;">
              <div class="tt-cascade-menu-header">
                <span>Regulation</span>
                ${curReg !== 'all' ? '<button type="button" class="tt-cascade-reset" onclick="event.stopPropagation(); selectSubjectReg(\'all\');" data-action="reset-subj-reg">Reset</button>' : ''}
              </div>
              <div class="tt-cascade-list">
                <div class="tt-cascade-item ${curReg === 'all' ? 'selected' : ''}" data-value="all" onclick="event.stopPropagation(); selectSubjectReg('all');" role="option">
                  <span class="tt-cascade-item-dot"></span>
                  <span class="tt-cascade-item-name">All Regulations</span>
                  ${curReg === 'all' ? '<span class="tt-cascade-item-check">✓</span>' : ''}
                </div>
                ${regs.map(r => {
                  const rCode = r.code || r;
                  const rName = r.name ? `${r.code} - ${r.name}` : rCode;
                  return `
                    <div class="tt-cascade-item ${curReg === rCode ? 'selected' : ''}" data-value="${esc(rCode)}" onclick="event.stopPropagation(); selectSubjectReg('${esc(rCode)}');" role="option">
                      <span class="tt-cascade-item-dot"></span>
                      <span class="tt-cascade-item-name">${esc(rName)}</span>
                      ${curReg === rCode ? '<span class="tt-cascade-item-check">✓</span>' : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>

          <!-- 3. SUBJECT SEARCHABLE DROPDOWN (Class Matrix Style) -->
          <div class="tt-custom-dropdown" id="tt-subj-dropdown">
            <input type="hidden" id="subject-filter-val" value="${esc(curSubj)}">
            
            <div class="tt-dropdown-trigger" id="tt-subj-dropdown-trigger" onclick="event.stopPropagation(); toggleSubjectDropdown(this);" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false" title="Click to search and select curriculum subject">
              <div class="tt-dropdown-trigger-left">
                <span class="tt-dropdown-trigger-icon">📖</span>
                <span class="tt-dropdown-trigger-text" id="tt-selected-subj-label">${esc(subjDisplayLabel)}</span>
              </div>
              <div class="tt-dropdown-trigger-right">
                <span class="tt-dropdown-trigger-badge">${subjects.length} ${subjects.length === 1 ? 'Subject' : 'Subjects'}</span>
                <span class="tt-dropdown-trigger-arrow">▾</span>
              </div>
            </div>

            <div class="tt-dropdown-menu" id="tt-subj-dropdown-menu" role="listbox" style="display:none;">
              <div class="tt-dropdown-search-box">
                <span class="tt-dropdown-search-icon">🔍</span>
                <input type="text" class="tt-dropdown-search-input" id="tt-subj-search-input" oninput="filterSubjectDropdown(this.value, this)" placeholder="Search subject code, name, or short code…" autocomplete="off" spellcheck="false">
                <button type="button" class="tt-dropdown-search-clear" id="tt-subj-search-clear" onclick="event.stopPropagation(); const si = this.closest('.tt-custom-dropdown').querySelector('.tt-dropdown-search-input'); if(si){ si.value=''; filterSubjectDropdown('', si); si.focus(); }" style="display:none;" title="Clear search">✕</button>
              </div>

              <div class="tt-dropdown-menu-header">
                <span class="tt-dropdown-menu-header-title" id="tt-subj-dropdown-count-text">Available Subjects (${subjects.length})</span>
                <span class="tt-dropdown-menu-header-hint">Click or press Enter</span>
              </div>

              <div class="tt-dropdown-list" id="tt-subj-options-list">
                <!-- 'ALL' FEATURE OPTION -->
                <div class="tt-dropdown-item ${!curSubj ? 'selected' : ''}" data-value="" onclick="event.stopPropagation(); selectSubject('');" role="option" aria-selected="${!curSubj ? 'true' : 'false'}">
                  <div class="tt-dropdown-item-left">
                    <span class="tt-dropdown-item-dot"></span>
                    <span class="tt-dropdown-item-text" style="font-weight:700;">📖 All Department Subjects</span>
                  </div>
                  <div class="tt-dropdown-item-right">
                    <span class="tt-dropdown-item-badge">All</span>
                    ${!curSubj ? '<span class="tt-dropdown-item-check">✓</span>' : ''}
                  </div>
                </div>

                ${subjects.map(s => {
                  const isSelected = curSubj === s.code || curSubj === String(s._id);
                  return `<div class="tt-dropdown-item ${isSelected ? 'selected' : ''}" data-value="${esc(s.code || s._id)}" onclick="event.stopPropagation(); selectSubject('${esc(s.code || s._id)}');" role="option" aria-selected="${isSelected ? 'true' : 'false'}">
                    <div class="tt-dropdown-item-left">
                      <span class="tt-dropdown-item-dot"></span>
                      <div class="tt-dropdown-item-details">
                        <span class="tt-dropdown-item-name">${esc(s.code || '')} ${esc(s.name)}</span>
                        <span class="tt-dropdown-item-sub">${esc(s.shortName || '')} · ${esc(s.regulation || '')} · ${esc(s.type || 'Theory')} · ${s.credits ?? 3} Cr</span>
                      </div>
                    </div>
                    <div class="tt-dropdown-item-right">
                      ${isSelected ? '<span class="tt-dropdown-item-badge">Active</span>' : ''}
                      <span class="tt-dropdown-item-check">${isSelected ? '✓' : ''}</span>
                    </div>
                  </div>`;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function toggleSubjDeptDropdown(triggerEl) {
  const card = triggerEl ? triggerEl.closest('.tt-class-selector-card') : document.getElementById('tt-subject-selector-card');
  const dd = card ? card.querySelector('#tt-subj-dept-dropdown') : document.getElementById('tt-subj-dept-dropdown');
  const isOpen = dd && dd.classList.contains('is-open');
  closeCascadeDropdowns();
  if (!isOpen && dd) {
    if (card) card.classList.add('dropdown-active');
    dd.classList.add('is-open');
    const menu = dd.querySelector('.tt-cascade-menu') || document.getElementById('tt-subj-dept-menu');
    if (menu) menu.style.display = 'block';
    const trigger = dd.querySelector('.tt-cascade-trigger') || document.getElementById('tt-subj-dept-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }
}

function toggleSubjRegDropdown(triggerEl) {
  const card = triggerEl ? triggerEl.closest('.tt-class-selector-card') : document.getElementById('tt-subject-selector-card');
  const dd = card ? card.querySelector('#tt-subj-reg-dropdown') : document.getElementById('tt-subj-reg-dropdown');
  const isOpen = dd && dd.classList.contains('is-open');
  closeCascadeDropdowns();
  if (!isOpen && dd) {
    if (card) card.classList.add('dropdown-active');
    dd.classList.add('is-open');
    const menu = dd.querySelector('.tt-cascade-menu') || document.getElementById('tt-subj-reg-menu');
    if (menu) menu.style.display = 'block';
    const trigger = dd.querySelector('.tt-cascade-trigger') || document.getElementById('tt-subj-reg-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }
}

function toggleSubjectDropdown(triggerEl) {
  const card = triggerEl ? triggerEl.closest('.tt-class-selector-card') : document.getElementById('tt-subject-selector-card');
  const dd = card ? card.querySelector('#tt-subj-dropdown') : document.getElementById('tt-subj-dropdown');
  const isOpen = dd && dd.classList.contains('is-open');
  closeCascadeDropdowns();
  if (!isOpen && dd) {
    if (card) card.classList.add('dropdown-active');
    dd.classList.add('is-open');
    const menu = dd.querySelector('.tt-dropdown-menu') || document.getElementById('tt-subj-dropdown-menu');
    if (menu) menu.style.display = 'block';
    const trigger = dd.querySelector('.tt-dropdown-trigger') || document.getElementById('tt-subj-dropdown-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    const sInput = dd.querySelector('.tt-dropdown-search-input') || document.getElementById('tt-subj-search-input');
    if (sInput) {
      sInput.value = '';
      sInput.focus();
    }
  }
}

async function selectSubjectDept(deptId) {
  state.subjectDeptFilter = deptId || 'all';
  state.subjectFilter = '';
  closeCascadeDropdowns();
  await loadSubjectsData();
  const fullPage = document.getElementById('tt-full-page-container');
  if (fullPage && state.view === 'subjects') {
    fullPage.innerHTML = subjectsView();
    bindSubjectsView();
  }
}

async function selectSubjectReg(regVal) {
  state.subjectRegFilter = regVal || 'all';
  state.subjectFilter = '';
  closeCascadeDropdowns();
  await loadSubjectsData();
  const fullPage = document.getElementById('tt-full-page-container');
  if (fullPage && state.view === 'subjects') {
    fullPage.innerHTML = subjectsView();
    bindSubjectsView();
  }
}

function selectSubject(subjVal) {
  state.subjectFilter = subjVal || '';
  closeCascadeDropdowns();
  const fullPage = document.getElementById('tt-full-page-container');
  if (fullPage && state.view === 'subjects') {
    fullPage.innerHTML = subjectsView();
    bindSubjectsView();
  }
}

function filterSubjectDropdown(query, inputEl) {
  const dd = inputEl ? inputEl.closest('#tt-subj-dropdown') : document.getElementById('tt-subj-dropdown');
  if (!dd) return;
  const q = (query || '').toLowerCase().trim();
  const clearBtn = dd.querySelector('.tt-dropdown-search-clear');
  if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';
  const items = dd.querySelectorAll('.tt-dropdown-item');
  let matchCount = 0;
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    const isMatch = !q || text.includes(q);
    item.style.display = isMatch ? '' : 'none';
    if (isMatch) matchCount++;
  });
  const countText = dd.querySelector('#tt-subj-dropdown-count-text');
  if (countText) {
    countText.textContent = q ? `Found Subjects (${matchCount})` : `Available Subjects (${items.length})`;
  }
}

function subjectsView() {
  const depts = _masterData.departments || [];
  const regs = _masterData.regulations || [];
  const subjects = state.subjectsList || [];
  const q = (state.subjectSearch || '').toLowerCase().trim();
  const subjFilter = (state.subjectFilter || '').toLowerCase().trim();

  const filtered = subjects.filter(s => {
    if (subjFilter) {
      const matchSubj = (s.code && s.code.toLowerCase() === subjFilter) || String(s._id).toLowerCase() === subjFilter;
      if (!matchSubj) return false;
    }
    if (q) {
      const match = (s.code && s.code.toLowerCase().includes(q)) ||
                    (s.name && s.name.toLowerCase().includes(q)) ||
                    (s.shortName && s.shortName.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  const curDeptObj = depts.find(d => String(d._id) === String(state.subjectDeptFilter));
  const deptSummary = state.subjectDeptFilter === 'all' ? 'All Departments' : (curDeptObj?.name || curDeptObj?.code || 'Department');
  const regSummary = state.subjectRegFilter === 'all' ? 'All Regulations' : state.subjectRegFilter;

  return heading('Academic Curriculum', 'Department Subjects Management', 'Manage department-scoped subjects, curriculum regulations, short codes, and credits', button('+ Add Subject', 'btn-pri', 'tt-add-subj-btn')) +
    renderSubjectSelectorCard() +
    `<div class="panel">
      <div class="panel-head" style="flex-wrap:wrap;gap:12px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <h2>Department Subjects Catalog</h2>
          <span class="pill pri">${esc(deptSummary)}</span>
          <span class="pill">${esc(regSummary)}</span>
          ${state.subjectFilter ? `<span class="pill warn" style="cursor:pointer;" onclick="selectSubject('')" title="Click to clear filter">Filtered: ${esc(state.subjectFilter)} ✕</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <input type="text" id="tt-subj-search" class="fc2" placeholder="Search code, short code, name…" value="${esc(state.subjectSearch || '')}" style="font-size:12.5px;padding:6px 12px;border-radius:8px;min-width:200px;">
          <span class="pill pri">${filtered.length} Subject${filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      ${state.loadingSubjects
        ? '<div style="text-align:center;padding:36px;color:var(--tmu);font-size:13px;">Loading department subjects…</div>'
        : (!filtered.length
          ? emptyState('No Subjects Found', 'No subjects configured under this department/regulation filter. Click "+ Add Subject" to create one.')
          : `<div style="overflow-x:auto;">
              <table class="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Short Code</th>
                    <th>Subject Name</th>
                    <th>Department</th>
                    <th>Regulation</th>
                    <th>Type</th>
                    <th>Credits</th>
                    <th style="text-align:right;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered.map(s => {
                    const deptObj = depts.find(d => String(d._id) === String(s.deptId?._id || s.deptId));
                    const deptName = s.deptId?.name || s.deptId?.code || (deptObj ? deptObj.name || deptObj.code : '—');
                    const isLab = s.type === 'Lab' || (s.name && s.name.toLowerCase().includes('lab'));
                    return `<tr>
                      <td><code>${esc(s.code || '—')}</code></td>
                      <td><b>${esc(s.shortName || '—')}</b></td>
                      <td><b>${esc(s.name)}</b></td>
                      <td style="font-size:12.5px;color:var(--tmu);">${esc(deptName)}</td>
                      <td><span class="pill" style="font-size:11px;font-weight:700;">${esc(s.regulation || '—')}</span></td>
                      <td><span class="pill ${isLab ? 'warn' : 'pri'}" style="font-size:11px;">${esc(s.type || (isLab ? 'Lab' : 'Theory'))}</span></td>
                      <td><b>${s.credits ?? 3}</b></td>
                      <td style="text-align:right;">
                        <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;">
                          <button type="button" class="btn-out tt-edit-subj-btn" data-subj-id="${esc(s._id)}" style="padding:4px 10px;font-size:11.5px;" title="Edit Subject">✏️ Edit</button>
                          <button type="button" class="btn-out tt-del-subj-btn" data-subj-id="${esc(s._id)}" style="padding:4px 10px;font-size:11.5px;color:#dc2626;border-color:rgba(220,38,38,0.3);" title="Delete Subject">🗑️ Delete</button>
                        </div>
                      </td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>`
        )}
    </div>`;
}

function bindSubjectsView() {
  $('#tt-add-subj-btn')?.addEventListener('click', openTtAddSubjectModal);

  $('#tt-subj-search')?.addEventListener('input', e => {
    state.subjectSearch = e.target.value;
    const fullPage = document.getElementById('tt-full-page-container');
    if (fullPage && state.view === 'subjects') {
      fullPage.innerHTML = subjectsView();
      bindSubjectsView();
      const sInput = document.getElementById('tt-subj-search');
      if (sInput) {
        sInput.focus();
        sInput.setSelectionRange(sInput.value.length, sInput.value.length);
      }
    }
  });

  document.querySelectorAll('.tt-edit-subj-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.subjId;
      if (id) openTtEditSubjectModal(id);
    });
  });

  document.querySelectorAll('.tt-del-subj-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.subjId;
      if (id) deleteTtSubject(id);
    });
  });
}

function openTtAddSubjectModal() {
  const modal = document.getElementById('tt-subject-modal');
  if (!modal) return;
  document.getElementById('tt-subj-modal-title').textContent = '📚 Add Department Subject';
  document.getElementById('tt-subj-id').value = '';
  document.getElementById('tt-subj-name').value = '';
  document.getElementById('tt-subj-code').value = '';
  document.getElementById('tt-subj-shortcode').value = '';
  document.getElementById('tt-subj-type').value = 'Theory';
  document.getElementById('tt-subj-credits').value = '3';

  // Populate depts
  const deptSelect = document.getElementById('tt-subj-dept');
  if (deptSelect) {
    deptSelect.innerHTML = (_masterData.departments || []).map(d =>
      `<option value="${esc(d._id)}" ${state.subjectDeptFilter === String(d._id) ? 'selected' : ''}>${esc(d.name || d.code)}</option>`
    ).join('');
  }

  // Populate regulations
  const regSelect = document.getElementById('tt-subj-reg');
  if (regSelect) {
    const regs = _masterData.regulations || [];
    regSelect.innerHTML = regs.map(r =>
      `<option value="${esc(r.code || r)}" ${state.subjectRegFilter === (r.code || r) ? 'selected' : ''}>${esc(r.name ? `${r.code} - ${r.name}` : r.code || r)}</option>`
    ).join('') || '<option value="">No regulations defined</option>';
  }

  modal.classList.add('open');
}

function openTtEditSubjectModal(id) {
  const modal = document.getElementById('tt-subject-modal');
  if (!modal) return;
  const sub = (state.subjectsList || []).find(s => String(s._id) === String(id)) ||
              (_masterData.subjects || []).find(s => String(s._id) === String(id));
  if (!sub) return notify('Subject not found', 'warn');

  document.getElementById('tt-subj-modal-title').textContent = '✏️ Edit Department Subject';
  document.getElementById('tt-subj-id').value = sub._id;
  document.getElementById('tt-subj-name').value = sub.name || '';
  document.getElementById('tt-subj-code').value = sub.code || '';
  document.getElementById('tt-subj-shortcode').value = sub.shortName || '';
  document.getElementById('tt-subj-type').value = sub.type || 'Theory';
  document.getElementById('tt-subj-credits').value = sub.credits ?? 3;

  const deptSelect = document.getElementById('tt-subj-dept');
  if (deptSelect) {
    const activeDeptId = String(sub.deptId?._id || sub.deptId || '');
    deptSelect.innerHTML = (_masterData.departments || []).map(d =>
      `<option value="${esc(d._id)}" ${String(d._id) === activeDeptId ? 'selected' : ''}>${esc(d.name || d.code)}</option>`
    ).join('');
  }

  const regSelect = document.getElementById('tt-subj-reg');
  if (regSelect) {
    const regs = _masterData.regulations || [];
    const activeReg = String(sub.regulation || '');
    regSelect.innerHTML = regs.map(r =>
      `<option value="${esc(r.code || r)}" ${String(r.code || r) === activeReg ? 'selected' : ''}>${esc(r.name ? `${r.code} - ${r.name}` : r.code || r)}</option>`
    ).join('') || '<option value="">No regulations defined</option>';
  }

  modal.classList.add('open');
}

function closeTtSubjectModal() {
  document.getElementById('tt-subject-modal')?.classList.remove('open');
}

async function saveTtSubject() {
  const id = document.getElementById('tt-subj-id')?.value;
  const name = document.getElementById('tt-subj-name')?.value.trim();
  const code = document.getElementById('tt-subj-code')?.value.trim();
  const shortName = document.getElementById('tt-subj-shortcode')?.value.trim();
  const deptId = document.getElementById('tt-subj-dept')?.value;
  const regulation = document.getElementById('tt-subj-reg')?.value;
  const type = document.getElementById('tt-subj-type')?.value;
  const credits = Number(document.getElementById('tt-subj-credits')?.value) || 3;

  if (!name) return notify('Subject name is required', 'warn');
  if (!code) return notify('Subject code is required', 'warn');
  if (!deptId) return notify('Department is required', 'warn');
  if (!regulation) return notify('Regulation is required', 'warn');

  const payload = { name, code, shortName, deptId, regulation, type, credits };
  const btn = document.getElementById('tt-subj-save-btn');
  if (btn) btn.disabled = true;

  try {
    if (id) {
      await apiCall('PUT', `/subjects/${id}`, payload);
      notify(`Subject "${code}" updated successfully`, 'success');
    } else {
      await apiCall('POST', '/subjects', payload);
      notify(`Subject "${code}" added successfully`, 'success');
    }

    closeTtSubjectModal();
    // Refresh master data and subjects list
    try {
      const refreshedMaster = await apiCall('GET', '/timetable/master-data');
      _masterData = refreshedMaster;
      SUBJECTS = (_masterData.subjects || []).map(s => s.name).filter(Boolean);
    } catch (_) {}
    await loadSubjectsData();
    const fullPage = document.getElementById('tt-full-page-container');
    if (fullPage && state.view === 'subjects') {
      fullPage.innerHTML = subjectsView();
      bindSubjectsView();
    }
  } catch (err) {
    notify('Failed to save subject: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteTtSubject(id) {
  const sub = (state.subjectsList || []).find(s => String(s._id) === String(id));
  const subName = sub ? `${sub.code} (${sub.name})` : 'this subject';
  if (!confirm(`Are you sure you want to delete ${subName}? This cannot be undone.`)) return;

  try {
    await apiCall('DELETE', `/subjects/${id}`);
    notify(`Subject deleted successfully`, 'success');
    try {
      const refreshedMaster = await apiCall('GET', '/timetable/master-data');
      _masterData = refreshedMaster;
      SUBJECTS = (_masterData.subjects || []).map(s => s.name).filter(Boolean);
    } catch (_) {}
    await loadSubjectsData();
    const fullPage = document.getElementById('tt-full-page-container');
    if (fullPage && state.view === 'subjects') {
      fullPage.innerHTML = subjectsView();
      bindSubjectsView();
    }
  } catch (err) {
    notify('Failed to delete subject: ' + err.message, 'error');
  }
}

window.openTtAddSubjectModal = openTtAddSubjectModal;
window.openTtEditSubjectModal = openTtEditSubjectModal;
window.closeTtSubjectModal = closeTtSubjectModal;
window.saveTtSubject = saveTtSubject;
window.deleteTtSubject = deleteTtSubject;

// =========================================================================
// 🚀 TIMETABLE DASHBOARD & COMMAND CENTER COCKPIT MODULE
// =========================================================================

let _cockpitPollInterval = null;

async function loadDashboardCockpit() {
  state.loadingDashboard = true;
  try {
    const qDate = state.dashboardDate || new Date().toISOString().slice(0, 10);
    const qDept = state.dashboardDeptFilter || 'all';
    const res = await apiCall('GET', `/timetable/dashboard-cockpit?date=${encodeURIComponent(qDate)}&deptId=${encodeURIComponent(qDept)}`);
    if (res && res.ok && res.data) {
      state.dashboardData = res.data;
      if (!state.nudgedAlerts) state.nudgedAlerts = new Set();
    } else {
      notify(res?.error || 'Failed to load cockpit data', 'error');
    }
  } catch (err) {
    console.error('[loadDashboardCockpit error]:', err);
    notify('Failed to load cockpit data: ' + err.message, 'error');
  } finally {
    state.loadingDashboard = false;
  }
}

function startCockpitPolling() {
  if (_cockpitPollInterval) clearInterval(_cockpitPollInterval);
  _cockpitPollInterval = setInterval(async () => {
    if (state.view === 'dashboard' && !document.hidden && !state.modalBusy) {
      const qDate = state.dashboardDate || new Date().toISOString().slice(0, 10);
      const qDept = state.dashboardDeptFilter || 'all';
      try {
        const res = await apiCall('GET', `/timetable/dashboard-cockpit?date=${encodeURIComponent(qDate)}&deptId=${encodeURIComponent(qDept)}`);
        if (res && res.ok && res.data && state.view === 'dashboard') {
          state.dashboardData = res.data;
          const fullPage = document.getElementById('tt-full-page-container');
          if (fullPage && !document.getElementById('tt-slot-inspector-modal') && !document.getElementById('tt-reassign-room-modal')) {
            fullPage.innerHTML = timetableCockpitView();
            bindDashboardCockpit();
          }
        }
      } catch (_) {}
    }
  }, 45000);
}

function timetableCockpitView() {
  if (state.loadingDashboard && !state.dashboardData) {
    return `<div class="tt-cockpit-wrap" style="text-align:center;padding:80px 20px;">
      <div style="font-size:32px;margin-bottom:12px;">⚡</div>
      <h2 style="color:var(--gD,#1b5e20);margin:0 0 8px 0;">Loading Academic Operations Cockpit…</h2>
      <p style="color:var(--tmu,#5a7a5a);font-size:13px;margin:0;">Aggregating live schedules, attendance records, room telemetry, and disruptions</p>
    </div>`;
  }

  const d = state.dashboardData || {
    serverTime: new Date().toISOString(),
    currentTimeStr: '10:00',
    currentDay: 'Monday',
    targetDate: state.dashboardDate,
    currentPeriod: null,
    nextPeriod: null,
    disruptions: { cancelledCount: 0, substitutedCount: 0, roomChangedCount: 0, uncoveredCount: 0, slotsAtRiskCount: 0, uncoveredSlots: [] },
    liveGrid: { classes: [] },
    absentCoverage: [],
    unmarkedAlerts: [],
    roomsMap: { freeNow: [], occupiedNow: [], maintenance: [] },
    smartBoardErrors: [],
    eventTicker: []
  };

  const depts = _masterData.departments || [];
  const curPeriod = d.currentPeriod;
  const nextP = d.nextPeriod;

  // Pulse badge label
  let pulseHtml = `<span class="tt-pulse-dot"></span> <b>Recess / Outside Hours</b>`;
  if (curPeriod) {
    pulseHtml = `<span class="tt-pulse-dot"></span> <b>LIVE: ${esc(curPeriod.label)}</b> (${esc(curPeriod.start)} – ${esc(curPeriod.end)}) • ${curPeriod.timeRemainingMinutes}m left`;
  } else if (nextP) {
    pulseHtml = `<span class="tt-pulse-dot" style="background:#f59e0b;"></span> Next: <b>${esc(nextP.label)}</b> (${esc(nextP.start)})`;
  }

  return `
    <div class="tt-cockpit-wrap">
      <!-- TOP CONTROL & KPI BAR -->
      <div class="tt-cockpit-topbar">
        <div class="tt-cockpit-title-group">
          <h1>⚡ Academic Operations Cockpit</h1>
          <p>Real-time campus schedule tracking, attendance alerts, disruptions, and room availability</p>
        </div>
        <div class="tt-cockpit-controls">
          <div class="tt-cockpit-live-pulse-badge">
            ${pulseHtml}
          </div>

          <!-- Department Filter -->
          <select id="cockpit-dept-select" class="tt-cockpit-ctrl-select">
            <option value="all" ${state.dashboardDeptFilter === 'all' ? 'selected' : ''}>All Departments</option>
            ${depts.map(dp => `<option value="${esc(dp._id)}" ${String(state.dashboardDeptFilter) === String(dp._id) ? 'selected' : ''}>${esc(dp.name)} (${esc(dp.code || '')})</option>`).join('')}
          </select>

          <!-- Date Picker -->
          <div style="display:flex;align-items:center;gap:6px;">
            <input type="date" id="cockpit-date-picker" class="tt-cockpit-ctrl-select" value="${esc(state.dashboardDate)}" title="Select target date">
            <button type="button" class="tt-cockpit-action-btn" id="cockpit-today-btn" title="Jump to today">Today</button>
          </div>

          <button type="button" class="btn-pri" id="cockpit-refresh-btn" style="padding:6px 14px;font-size:12.5px;">↻ Refresh</button>
        </div>
      </div>

      <!-- MAIN COCKPIT GRID (8 PANELS) -->
      <div class="tt-cockpit-grid">

        <!-- PANEL 1: TODAY'S DISRUPTIONS & AT-RISK SLOTS (Col 6) -->
        <div class="tt-cockpit-card tt-col-6" id="panel-disruptions">
          <div class="tt-cockpit-card-head">
            <div class="tt-cockpit-card-title">
              <span>⚠️</span> Today's Disruptions &amp; At-Risk Slots
              <span class="pill warn" style="font-size:11px;">${(d.disruptions.cancelledCount || 0) + (d.disruptions.substitutedCount || 0) + (d.disruptions.roomChangedCount || 0) + (d.disruptions.uncoveredCount || 0)} Events</span>
            </div>
            <div class="tt-cockpit-card-actions">
              <button type="button" class="tt-cockpit-action-btn btn-expand-panel" data-panel="disruptions" title="Expand Panel">⛶ Expand</button>
            </div>
          </div>
          <div class="tt-cockpit-card-body">
            <!-- Ribbon Counters -->
            <div class="tt-disruption-ribbon">
              <div class="tt-disruption-stat ${d.disruptions.uncoveredCount > 0 ? 'stat-danger' : ''}">
                <div class="tt-disruption-stat-val">${d.disruptions.uncoveredCount || 0}</div>
                <div class="tt-disruption-stat-lbl">Uncovered Periods</div>
              </div>
              <div class="tt-disruption-stat ${d.disruptions.slotsAtRiskCount > 0 ? 'stat-warning' : ''}">
                <div class="tt-disruption-stat-val">${d.disruptions.slotsAtRiskCount || 0}</div>
                <div class="tt-disruption-stat-lbl">Slots At Risk (Maint.)</div>
              </div>
              <div class="tt-disruption-stat">
                <div class="tt-disruption-stat-val">${d.disruptions.substitutedCount || 0}</div>
                <div class="tt-disruption-stat-lbl">Substituted</div>
              </div>
              <div class="tt-disruption-stat">
                <div class="tt-disruption-stat-val">${d.disruptions.cancelledCount || 0}</div>
                <div class="tt-disruption-stat-lbl">Cancelled</div>
              </div>
              <div class="tt-disruption-stat">
                <div class="tt-disruption-stat-val">${d.disruptions.roomChangedCount || 0}</div>
                <div class="tt-disruption-stat-lbl">Room Relocated</div>
              </div>
            </div>

            <!-- Disrupted / Uncovered Slots List -->
            <div class="tt-disruption-items-list">
              ${(d.disruptions.uncoveredSlots || []).length === 0 && d.disruptions.slotsAtRiskCount === 0 ? `
                <div style="padding:18px;text-align:center;color:var(--tmu,#5a7a5a);font-size:12.5px;">
                  ✓ Zero uncovered periods or facility clashes today. All scheduled classes have verified instructors and available rooms.
                </div>
              ` : `
                ${(d.disruptions.uncoveredSlots || []).map(us => `
                  <div class="tt-disruption-item item-uncovered">
                    <div>
                      <b>${esc(us.className || 'Class')} • Period ${esc(us.period)}</b> — ${esc(us.subject || 'Subject')}
                      <div style="font-size:11px;color:#991b1b;margin-top:2px;">
                        🚨 Instructor <b>${esc(us.teacher || 'Faculty')}</b> is absent. No substitute assigned yet!
                      </div>
                    </div>
                    <button type="button" class="btn-pri btn-open-sub-finder" data-class-id="${esc(us.classId)}" data-period="${esc(us.period)}" data-day="${esc(d.currentDay)}" data-teacher="${esc(us.teacher)}" data-subject="${esc(us.subject)}" style="padding:4px 10px;font-size:11.5px;">⚡ Find Substitute</button>
                  </div>
                `).join('')}

                ${(d.roomsMap.maintenance || []).filter(r => r.affectedSlots > 0).map(mr => `
                  <div class="tt-disruption-item" style="border-left-color:#d97706;background:#fffbeb;">
                    <div>
                      <b>Facility ${esc(mr.hallNo)} in Maintenance</b> (${mr.affectedSlots} slots at risk)
                      <div style="font-size:11px;color:#92400e;margin-top:2px;">Reason: ${esc(mr.statusReason || 'Scheduled repair')}</div>
                    </div>
                    <button type="button" class="btn-out btn-emergency-reassign-trigger" data-room-from="${esc(mr.hallNo)}" style="padding:4px 10px;font-size:11.5px;">🛠️ Reassign</button>
                  </div>
                `).join('')}
              `}
            </div>
          </div>
        </div>

        <!-- PANEL 4: UNMARKED-ATTENDANCE ALERTS & NUDGE TEACHER (Col 6) -->
        <div class="tt-cockpit-card tt-col-6" id="panel-unmarked-alerts">
          <div class="tt-cockpit-card-head">
            <div class="tt-cockpit-card-title">
              <span>⏰</span> Unmarked-Attendance Alerts
              <span class="pill ${d.unmarkedAlerts.length > 0 ? 'alert' : ''}" style="font-size:11px;">${d.unmarkedAlerts.length} Overdue</span>
            </div>
            <div class="tt-cockpit-card-actions">
              <button type="button" class="tt-cockpit-action-btn btn-expand-panel" data-panel="unmarkedAlerts" title="Expand Panel">⛶ Expand</button>
            </div>
          </div>
          <div class="tt-cockpit-card-body" style="max-height:290px;overflow-y:auto;">
            ${d.unmarkedAlerts.length === 0 ? `
              <div style="padding:32px 14px;text-align:center;color:var(--tmu,#5a7a5a);font-size:12.5px;">
                ✓ Excellent! All concluded periods have attendance submitted and verified.
              </div>
            ` : d.unmarkedAlerts.map(ua => {
              const alertKey = `${ua.classId}_${ua.periodNumber}_${ua.teacherTrackId}`;
              const isNudged = state.nudgedAlerts && state.nudgedAlerts.has(alertKey);
              return `
                <div class="tt-alert-card ${ua.isSeverelyDelayed ? 'severe' : ''}">
                  <div>
                    <div style="font-weight:700;color:var(--td,#1a2e1a);">${esc(ua.className)} • ${esc(ua.periodLabel)} (${esc(ua.periodTime)})</div>
                    <div style="color:var(--tmu,#6b7280);font-size:11.5px;margin-top:2px;">
                      <b>${esc(ua.subject)}</b> in ${esc(ua.room || 'Room')} — Faculty: <b>${esc(ua.teacherName)}</b>
                    </div>
                    <div style="margin-top:4px;">
                      <span class="pill ${ua.isSeverelyDelayed ? 'alert' : 'warn'}" style="font-size:10.5px;">⚠️ ${ua.endedMinutesAgo}m overdue</span>
                    </div>
                  </div>
                  <div>
                    <button type="button" class="tt-nudge-btn ${isNudged ? 'nudged' : ''}" data-class-name="${esc(ua.className)}" data-period="${esc(ua.period)}" data-track-id="${esc(ua.teacherTrackId)}" data-subject="${esc(ua.subject)}" data-teacher="${esc(ua.teacherName)}" data-alert-key="${alertKey}" ${isNudged ? 'disabled' : ''}>
                      ${isNudged ? '✓ Nudged' : '⚡ Nudge Teacher'}
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- PANEL 2: LIVE CLASS STATUS GRID (Col 12 - High Density Command Matrix) -->
        <div class="tt-cockpit-card tt-col-12" id="panel-live-grid">
          <div class="tt-cockpit-card-head">
            <div class="tt-cockpit-card-title">
              <span>▦</span> Live Class Status Grid (Every Class vs Periods P1–P9)
            </div>
            <div class="tt-cockpit-card-actions">
              <button type="button" class="tt-cockpit-action-btn btn-expand-panel" data-panel="liveGrid" title="Fullscreen High-Density Matrix">⛶ Fullscreen</button>
            </div>
          </div>

          <!-- Color Code Legend -->
          <div class="tt-live-grid-legend">
            <span class="tt-legend-item"><span class="tt-legend-dot" style="background:#1b5e20;"></span> 🟢 Marked</span>
            <span class="tt-legend-item"><span class="tt-legend-dot" style="background:#d97706;"></span> 🟡 Running / Unmarked</span>
            <span class="tt-legend-item"><span class="tt-legend-dot" style="background:#7e22ce;"></span> 🟣 Substituted</span>
            <span class="tt-legend-item"><span class="tt-legend-dot" style="background:#dc2626;"></span> 🔴 Cancelled</span>
            <span class="tt-legend-item"><span class="tt-legend-dot" style="background:#2563eb;"></span> 🔵 Laboratory</span>
            <span class="tt-legend-item"><span class="tt-legend-dot" style="background:#9ca3af;"></span> ⚪ Free / Upcoming</span>
          </div>

          <div class="tt-live-table-wrap">
            <table class="tt-live-table">
              <thead>
                <tr>
                  <th style="text-align:left;min-width:130px;">Class / Section</th>
                  ${['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'].map(pCode => {
                    const isColActive = curPeriod && curPeriod.code === pCode;
                    return `<th class="${isColActive ? 'col-current-period' : ''}">
                      ${pCode} ${isColActive ? '<span class="pill pri" style="font-size:9.5px;padding:2px 6px;margin-left:4px;">LIVE NOW</span>' : ''}
                    </th>`;
                  }).join('')}
                </tr>
              </thead>
              <tbody>
                ${(d.liveGrid.classes || []).length === 0 ? `
                  <tr><td colspan="10" style="padding:30px;color:var(--tmu,#5a7a5a);">No published class schedules found for the active department.</td></tr>
                ` : d.liveGrid.classes.map(cls => `
                  <tr>
                    <td class="col-class-name btn-open-class-matrix" data-class-id="${esc(cls.classId)}" data-class-name="${esc(cls.className)}" title="Click to open full timetable in Editor">
                      ${esc(cls.className)}
                      <span style="font-size:10px;color:var(--tmu,#6b7280);display:block;font-weight:normal;">${esc(cls.deptCode || '')}</span>
                    </td>
                    ${['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'].map(pCode => {
                      const slot = cls.periods[pCode] || { status: 'free', subject: 'Free' };
                      const isColActive = curPeriod && curPeriod.code === pCode;
                      const pillClass = `status-pill-${slot.status || 'free'}`;
                      return `
                        <td class="${isColActive ? 'col-current-period' : ''}">
                          <div class="tt-slot-cell-pill ${pillClass} btn-slot-inspect" data-class-id="${esc(cls.classId)}" data-class-name="${esc(cls.className)}" data-period="${esc(pCode)}" data-subject="${esc(slot.subject)}" data-teacher="${esc(slot.teacher)}" data-sub-teacher="${esc(slot.substituteTeacher || '')}" data-room="${esc(slot.room)}" data-status="${esc(slot.status)}" data-time="${esc(slot.time || '')}" title="Click to inspect period">
                            <b>${esc(formatSubjectDisplay(slot.subject) || slot.subject || 'Free')}</b>
                            <span style="font-size:10px;opacity:0.85;">${slot.room ? esc(slot.room) : ''}${slot.substituteTeacher ? ` (Sub)` : ''}</span>
                          </div>
                        </td>
                      `;
                    }).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- PANEL 3: ABSENT-TEACHER COVERAGE BOARD (Col 6) -->
        <div class="tt-cockpit-card tt-col-6" id="panel-absent-coverage">
          <div class="tt-cockpit-card-head">
            <div class="tt-cockpit-card-title">
              <span>👤</span> Absent-Teacher Coverage Board
              <span class="pill warn" style="font-size:11px;">${d.absentCoverage.length} Faculty on Leave</span>
            </div>
            <div class="tt-cockpit-card-actions">
              <button type="button" class="tt-cockpit-action-btn btn-expand-panel" data-panel="absentCoverage" title="Expand Panel">⛶ Expand</button>
            </div>
          </div>
          <div class="tt-cockpit-card-body" style="max-height:300px;overflow-y:auto;">
            ${d.absentCoverage.length === 0 ? `
              <div style="padding:28px 14px;text-align:center;color:var(--tmu,#5a7a5a);font-size:12.5px;">
                ✓ 100% faculty attendance recorded for today. No substitute reassignments needed.
              </div>
            ` : d.absentCoverage.map(ac => `
              <div class="tt-absent-item-card">
                <div class="tt-absent-header">
                  <span class="tt-absent-name">${esc(ac.teacherName)}</span>
                  <span class="pill warn" style="font-size:11px;">${esc(ac.leaveType)}</span>
                </div>
                <div style="font-size:11px;color:var(--tmu,#6b7280);margin-bottom:6px;">
                  Reason: ${esc(ac.reason || 'Leave')} • ${ac.uncoveredCount} uncovered period(s)
                </div>

                ${(ac.slots || []).map(sl => `
                  <div class="tt-slot-assign-row">
                    <div>
                      <b>${esc(sl.className)} (${esc(sl.period)})</b>: ${esc(sl.subject)} in ${esc(sl.room || 'Room')}
                    </div>
                    <div>
                      ${sl.hasSubstitute ? `
                        <span class="pill pri" style="font-size:10.5px;">✓ Sub: ${esc(sl.substituteTeacher)}</span>
                      ` : `
                        <div class="tt-candidate-chips">
                          <span style="font-size:10.5px;color:#dc2626;font-weight:700;">Uncovered</span>
                          ${(sl.candidates || []).slice(0, 2).map(c => `
                            <button type="button" class="tt-candidate-chip btn-quick-assign-sub" data-class-id="${esc(sl.classId)}" data-class-name="${esc(sl.className)}" data-period-number="${sl.periodNumber}" data-orig-id="${esc(ac.teacherId)}" data-orig-name="${esc(ac.teacherName)}" data-sub-id="${esc(c.teacherId)}" data-sub-name="${esc(c.teacherName)}" data-subject="${esc(sl.subject)}" data-room="${esc(sl.room)}" title="1-Click Assign Substitute">
                              + ${esc(c.teacherName)}
                            </button>
                          `).join('')}
                          <button type="button" class="btn-out btn-open-sub-finder" data-class-id="${esc(sl.classId)}" data-period="${esc(sl.period)}" data-day="${esc(d.currentDay)}" data-teacher="${esc(ac.teacherName)}" data-subject="${esc(sl.subject)}" style="padding:2px 7px;font-size:10.5px;">⚡ Finder</button>
                        </div>
                      `}
                    </div>
                  </div>
                `).join('')}
              </div>
            `).join('')}
          </div>
        </div>

        <!-- PANEL 5: LIVE ROOM & EMERGENCY MAP (Col 6) -->
        <div class="tt-cockpit-card tt-col-6" id="panel-rooms-map">
          <div class="tt-cockpit-card-head">
            <div class="tt-cockpit-card-title">
              <span>🏛️</span> Live Room &amp; Emergency Map (${curPeriod ? esc(curPeriod.code) : 'Current'})
              <span class="pill pri" style="font-size:11px;">${d.roomsMap.freeNow.length} Available</span>
            </div>
            <div class="tt-cockpit-card-actions">
              <button type="button" class="tt-cockpit-action-btn btn-expand-panel" data-panel="roomsMap" title="Expand Panel">⛶ Expand</button>
            </div>
          </div>
          <div class="tt-cockpit-card-body">
            <div style="display:flex;gap:12px;margin-bottom:10px;font-size:11.5px;font-weight:600;">
              <span style="color:#16a34a;">🟢 ${d.roomsMap.freeNow.length} Free</span>
              <span style="color:#dc2626;">🔴 ${d.roomsMap.occupiedNow.length} Occupied</span>
              <span style="color:#d97706;">🛠️ ${d.roomsMap.maintenance.length} Maintenance</span>
            </div>

            <div class="tt-room-pills-grid">
              ${d.roomsMap.freeNow.map(r => `
                <div class="tt-room-tile free btn-free-room-select" data-room-id="${esc(r.roomId)}" data-hall-no="${esc(r.hallNo)}" title="Click to Emergency Reassign a class here">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <b>${esc(r.hallNo)}</b>
                    <span class="tt-sb-dot ${esc(r.boardStatus || 'offline')}" title="Smart Board: ${esc(r.boardStatus)}"></span>
                  </div>
                  <span style="color:#16a34a;font-weight:700;">✓ Free Now</span>
                  <span style="font-size:10px;color:var(--tmu,#6b7280);">${r.capacity} seats</span>
                </div>
              `).join('')}

              ${d.roomsMap.occupiedNow.map(r => `
                <div class="tt-room-tile occupied" title="${esc(r.className)}: ${esc(r.subject)} (${esc(r.teacher)})">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <b>${esc(r.hallNo)}</b>
                    <span class="tt-sb-dot ${esc(r.boardStatus || 'offline')}" title="Smart Board: ${esc(r.boardStatus)}"></span>
                  </div>
                  <span style="color:#dc2626;font-weight:700;">${esc(r.className)}</span>
                  <span style="font-size:10px;color:var(--tmu,#6b7280);">${esc(r.teacher)}</span>
                </div>
              `).join('')}

              ${d.roomsMap.maintenance.map(r => `
                <div class="tt-room-tile maintenance" title="${esc(r.statusReason)}">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <b>${esc(r.hallNo)}</b>
                    <span class="tt-sb-dot ${esc(r.boardStatus || 'offline')}" title="Smart Board: ${esc(r.boardStatus)}"></span>
                  </div>
                  <span style="color:#d97706;font-weight:700;">Maintenance</span>
                  <span style="font-size:10px;color:var(--tmu,#6b7280);">${r.affectedSlots} at risk</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- PANEL 6: LIVE SMART BOARD ERRORS STREAM (Col 6) -->
        <div class="tt-cockpit-card tt-col-6" id="panel-board-errors">
          <div class="tt-cockpit-card-head">
            <div class="tt-cockpit-card-title">
              <span>🖥️</span> Smart Board Real-Time Health &amp; Error Stream
              <span class="pill ${d.smartBoardErrors.length > 0 ? 'alert' : 'pri'}" style="font-size:11px;">
                ${d.smartBoardErrors.length > 0 ? `${d.smartBoardErrors.length} Alerts` : 'All Healthy'}
              </span>
            </div>
            <div class="tt-cockpit-card-actions">
              <button type="button" class="tt-cockpit-action-btn btn-expand-panel" data-panel="boardErrors" title="Expand Panel">⛶ Expand</button>
            </div>
          </div>
          <div class="tt-cockpit-card-body" style="max-height:260px;overflow-y:auto;">
            ${d.smartBoardErrors.length === 0 ? `
              <div style="padding:28px 14px;text-align:center;color:#16a34a;font-size:12.5px;">
                ✓ All smart board kiosks are online and reporting healthy heartbeats.
              </div>
            ` : d.smartBoardErrors.map(sbe => `
              <div class="tt-sb-err-item">
                <div>
                  <b style="color:#991b1b;">${esc(sbe.roomHallNo)} • ${esc(sbe.errorCode)}</b>
                  <div style="color:var(--tmu,#6b7280);font-size:11px;margin-top:2px;">${esc(sbe.message)}</div>
                </div>
                <div style="display:flex;gap:6px;">
                  <button type="button" class="btn-out btn-restart-board-cmd" data-board-id="${esc(sbe.boardId)}" style="padding:3px 8px;font-size:11px;">Restart</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- PANEL 7: LIVE ACADEMIC EVENT TICKER (Col 6) -->
        <div class="tt-cockpit-card tt-col-6" id="panel-event-ticker">
          <div class="tt-cockpit-card-head">
            <div class="tt-cockpit-card-title">
              <span>📜</span> Live Academic Event Ticker (Audit Stream)
            </div>
            <div class="tt-cockpit-card-actions">
              <button type="button" class="tt-cockpit-action-btn btn-expand-panel" data-panel="eventTicker" title="Expand Panel">⛶ Expand</button>
            </div>
          </div>
          <div class="tt-cockpit-card-body">
            <div class="tt-ticker-list">
              ${(d.eventTicker || []).length === 0 ? `
                <div style="padding:20px;text-align:center;color:var(--tmu,#6b7280);font-size:12px;">No recent events logged today.</div>
              ` : d.eventTicker.map(ev => `
                <div class="tt-ticker-item">
                  <span class="tt-ticker-time">${esc(ev.time)}</span>
                  <div>
                    <b>${esc(ev.actor)}</b>: ${esc(ev.action)}
                    <div style="font-size:11px;color:var(--tmu,#6b7280);">${esc(ev.details)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- PANEL 8: INTERACTIVE CALENDAR VIEW (teacher.html Style) (Col 6) -->
        <div class="tt-cockpit-card tt-col-6" id="panel-calendar-view">
          <div class="tt-cockpit-card-head">
            <div class="tt-cockpit-card-title">
              <span>📅</span> Academic Calendar Date Navigator
            </div>
            <div class="tt-cockpit-card-actions">
              <button type="button" class="tt-cockpit-action-btn btn-expand-panel" data-panel="calendar" title="Expand Panel">⛶ Expand</button>
            </div>
          </div>
          <div class="tt-cockpit-card-body">
            ${renderCockpitCalendarWidget()}
          </div>
        </div>

      </div>

      <!-- EXPANDED MODAL OVERLAY (When a panel's Expand button is clicked) -->
      ${renderExpandedCockpitOverlay(d)}
    </div>
  `;
}

function renderCockpitCalendarWidget() {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const yr = state.cockpitCalYear || new Date().getFullYear();
  const mth = state.cockpitCalMonth !== undefined ? state.cockpitCalMonth : new Date().getMonth();

  const firstDay = new Date(yr, mth, 1).getDay(); // Sun=0, Mon=1
  const daysInMonth = new Date(yr, mth + 1, 0).getDate();
  const todayIso = new Date().toISOString().slice(0, 10);
  const selectedIso = state.dashboardDate || todayIso;

  // Monday-based offset (Mon=0, Tue=1, ..., Sun=6)
  const offset = (firstDay + 6) % 7;

  let daysHtml = '';
  // Empty padding cells
  for (let i = 0; i < offset; i++) {
    daysHtml += `<div class="tt-cal-day" style="opacity:0.15;cursor:default;"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const isoDate = `${yr}-${String(mth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = isoDate === todayIso;
    const isSelected = isoDate === selectedIso;
    daysHtml += `
      <div class="tt-cal-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} btn-cockpit-cal-date" data-date="${isoDate}">
        ${d}
      </div>
    `;
  }

  return `
    <div class="tt-cal-container">
      <div class="tt-cal-head">
        <button type="button" class="tt-cockpit-action-btn" id="btn-cockpit-cal-prev">« Prev</button>
        <div class="tt-cal-title">${monthNames[mth]} ${yr}</div>
        <button type="button" class="tt-cockpit-action-btn" id="btn-cockpit-cal-next">Next »</button>
      </div>
      <div class="tt-cal-grid">
        <div class="tt-cal-dow">Mo</div>
        <div class="tt-cal-dow">Tu</div>
        <div class="tt-cal-dow">We</div>
        <div class="tt-cal-dow">Th</div>
        <div class="tt-cal-dow">Fr</div>
        <div class="tt-cal-dow">Sa</div>
        <div class="tt-cal-dow">Su</div>
        ${daysHtml}
      </div>
      <div style="font-size:11px;color:var(--tmu,#5a7a5a);text-align:center;margin-top:10px;">
        Selected: <b>${selectedIso}</b> • Click any date to view historical or future timetable state
      </div>
    </div>
  `;
}

function renderExpandedCockpitOverlay(d) {
  if (!state.expandedPanel) return '';
  const panelKey = state.expandedPanel;

  let bodyHtml = '';
  let title = 'Expanded View';

  if (panelKey === 'liveGrid') {
    title = 'Fullscreen Live Class Command Matrix';
    bodyHtml = `
      <div class="tt-live-grid-legend">
        <span class="tt-legend-item"><span class="tt-legend-dot" style="background:#1b5e20;"></span> 🟢 Marked</span>
        <span class="tt-legend-item"><span class="tt-legend-dot" style="background:#d97706;"></span> 🟡 Running / Unmarked</span>
        <span class="tt-legend-item"><span class="tt-legend-dot" style="background:#7e22ce;"></span> 🟣 Substituted</span>
        <span class="tt-legend-item"><span class="tt-legend-dot" style="background:#dc2626;"></span> 🔴 Cancelled</span>
        <span class="tt-legend-item"><span class="tt-legend-dot" style="background:#2563eb;"></span> 🔵 Laboratory</span>
        <span class="tt-legend-item"><span class="tt-legend-dot" style="background:#9ca3af;"></span> ⚪ Free</span>
      </div>
      <div class="tt-live-table-wrap" style="max-height:calc(85vh - 120px);">
        <table class="tt-live-table">
          <thead>
            <tr>
              <th style="text-align:left;min-width:140px;">Class / Section</th>
              ${['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'].map(pCode => `<th>${pCode}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${(d.liveGrid.classes || []).map(cls => `
              <tr>
                <td class="col-class-name btn-open-class-matrix" data-class-id="${esc(cls.classId)}" data-class-name="${esc(cls.className)}">
                  ${esc(cls.className)}
                </td>
                ${['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'].map(pCode => {
                  const slot = cls.periods[pCode] || { status: 'free', subject: 'Free' };
                  const pillClass = `status-pill-${slot.status || 'free'}`;
                  return `
                    <td>
                      <div class="tt-slot-cell-pill ${pillClass} btn-slot-inspect" data-class-id="${esc(cls.classId)}" data-class-name="${esc(cls.className)}" data-period="${esc(pCode)}" data-subject="${esc(slot.subject)}" data-teacher="${esc(slot.teacher)}" data-sub-teacher="${esc(slot.substituteTeacher || '')}" data-room="${esc(slot.room)}" data-status="${esc(slot.status)}" data-time="${esc(slot.time || '')}">
                        <b>${esc(formatSubjectDisplay(slot.subject) || slot.subject || 'Free')}</b>
                        <span style="font-size:10px;opacity:0.85;">${slot.room ? esc(slot.room) : ''}</span>
                      </div>
                    </td>
                  `;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (panelKey === 'disruptions') {
    title = "Today's Disruptions & Maintenance Workbench";
    bodyHtml = `
      <div style="padding:16px;">
        <h3>Uncovered & Disrupted Periods</h3>
        ${(d.disruptions.uncoveredSlots || []).map(us => `
          <div class="tt-disruption-item item-uncovered" style="margin-bottom:8px;">
            <div>
              <b>${esc(us.className)} • Period ${esc(us.period)}</b> (${esc(us.subject)})
              <div>Teacher ${esc(us.teacher)} absent</div>
            </div>
            <button type="button" class="btn-pri btn-open-sub-finder" data-class-id="${esc(us.classId)}" data-period="${esc(us.period)}" data-day="${esc(d.currentDay)}" data-teacher="${esc(us.teacher)}" data-subject="${esc(us.subject)}">⚡ Find Substitute</button>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    title = `Expanded ${panelKey}`;
    bodyHtml = `<div style="padding:20px;">Full detailed view for ${panelKey} is available in this drawer.</div>`;
  }

  return `
    <div class="tt-cockpit-expanded-overlay" id="tt-cockpit-modal-overlay">
      <div class="tt-cockpit-expanded-box">
        <div class="tt-cockpit-card-head">
          <div class="tt-cockpit-card-title">${title}</div>
          <button type="button" class="modal-close" id="btn-close-expanded-overlay">✕</button>
        </div>
        <div style="overflow-y:auto;flex:1;">
          ${bodyHtml}
        </div>
      </div>
    </div>
  `;
}

function bindDashboardCockpit() {
  startCockpitPolling();

  // Date picker change
  $('#cockpit-date-picker')?.addEventListener('change', async e => {
    state.dashboardDate = e.target.value;
    setLiveSyncStatus('loading', 'Loading..');
    await loadDashboardCockpit();
    const fp = document.getElementById('tt-full-page-container');
    if (fp && state.view === 'dashboard') {
      fp.innerHTML = timetableCockpitView();
      bindDashboardCockpit();
    }
    setLiveSyncStatus('saved', 'Saved');
  });

  // Today button
  $('#cockpit-today-btn')?.addEventListener('click', async () => {
    state.dashboardDate = new Date().toISOString().slice(0, 10);
    setLiveSyncStatus('loading', 'Loading..');
    await loadDashboardCockpit();
    const fp = document.getElementById('tt-full-page-container');
    if (fp && state.view === 'dashboard') {
      fp.innerHTML = timetableCockpitView();
      bindDashboardCockpit();
    }
    setLiveSyncStatus('saved', 'Saved');
  });

  // Department selector change
  $('#cockpit-dept-select')?.addEventListener('change', async e => {
    state.dashboardDeptFilter = e.target.value;
    setLiveSyncStatus('loading', 'Loading..');
    await loadDashboardCockpit();
    const fp = document.getElementById('tt-full-page-container');
    if (fp && state.view === 'dashboard') {
      fp.innerHTML = timetableCockpitView();
      bindDashboardCockpit();
    }
    setLiveSyncStatus('saved', 'Saved');
  });

  // Refresh button
  $('#cockpit-refresh-btn')?.addEventListener('click', async () => {
    setLiveSyncStatus('loading', 'Refreshing..');
    await loadDashboardCockpit();
    const fp = document.getElementById('tt-full-page-container');
    if (fp && state.view === 'dashboard') {
      fp.innerHTML = timetableCockpitView();
      bindDashboardCockpit();
    }
    notify('Dashboard data refreshed.', 'success');
    setLiveSyncStatus('saved', 'Saved');
  });

  // Calendar month navigation
  $('#btn-cockpit-cal-prev')?.addEventListener('click', () => {
    let m = state.cockpitCalMonth !== undefined ? state.cockpitCalMonth : new Date().getMonth();
    let y = state.cockpitCalYear || new Date().getFullYear();
    m--;
    if (m < 0) { m = 11; y--; }
    state.cockpitCalMonth = m;
    state.cockpitCalYear = y;
    const fp = document.getElementById('tt-full-page-container');
    if (fp && state.view === 'dashboard') {
      fp.innerHTML = timetableCockpitView();
      bindDashboardCockpit();
    }
  });

  $('#btn-cockpit-cal-next')?.addEventListener('click', () => {
    let m = state.cockpitCalMonth !== undefined ? state.cockpitCalMonth : new Date().getMonth();
    let y = state.cockpitCalYear || new Date().getFullYear();
    m++;
    if (m > 11) { m = 0; y++; }
    state.cockpitCalMonth = m;
    state.cockpitCalYear = y;
    const fp = document.getElementById('tt-full-page-container');
    if (fp && state.view === 'dashboard') {
      fp.innerHTML = timetableCockpitView();
      bindDashboardCockpit();
    }
  });

  // Calendar date click
  document.querySelectorAll('.btn-cockpit-cal-date').forEach(el => {
    el.addEventListener('click', async () => {
      const dt = el.dataset.date;
      if (!dt) return;
      state.dashboardDate = dt;
      setLiveSyncStatus('loading', 'Loading date..');
      await loadDashboardCockpit();
      const fp = document.getElementById('tt-full-page-container');
      if (fp && state.view === 'dashboard') {
        fp.innerHTML = timetableCockpitView();
        bindDashboardCockpit();
      }
      setLiveSyncStatus('saved', 'Saved');
    });
  });

  // Expand panel buttons
  document.querySelectorAll('.btn-expand-panel').forEach(btn => {
    btn.addEventListener('click', () => {
      const pKey = btn.dataset.panel;
      state.expandedPanel = (state.expandedPanel === pKey ? null : pKey);
      const fp = document.getElementById('tt-full-page-container');
      if (fp && state.view === 'dashboard') {
        fp.innerHTML = timetableCockpitView();
        bindDashboardCockpit();
      }
    });
  });

  // Close expanded overlay
  $('#btn-close-expanded-overlay')?.addEventListener('click', () => {
    state.expandedPanel = null;
    const fp = document.getElementById('tt-full-page-container');
    if (fp && state.view === 'dashboard') {
      fp.innerHTML = timetableCockpitView();
      bindDashboardCockpit();
    }
  });

  // Class name click in Live Grid -> open class in Matrix tab
  document.querySelectorAll('.btn-open-class-matrix').forEach(el => {
    el.addEventListener('click', () => {
      const cId = el.dataset.classId;
      const cName = el.dataset.className;
      if (cName || cId) {
        state.filterSection = cName || cId;
        switchTab('grid');
      }
    });
  });

  // Slot cell click -> Slot Inspector Modal
  document.querySelectorAll('.btn-slot-inspect').forEach(el => {
    el.addEventListener('click', () => {
      openCockpitSlotInspector(el.dataset);
    });
  });

  // Nudge teacher button
  document.querySelectorAll('.tt-nudge-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const ds = btn.dataset;
      try {
        btn.disabled = true;
        btn.textContent = 'Nudging..';
        const res = await apiCall('POST', '/timetable/dashboard/nudge-attendance', {
          className: ds.className,
          period: ds.period,
          teacherTrackId: ds.trackId,
          subject: ds.subject,
          teacherName: ds.teacher
        });
        if (res && res.ok) {
          notify(res.message || 'Nudge alert sent to instructor!', 'success');
          if (ds.alertKey) state.nudgedAlerts.add(ds.alertKey);
          btn.textContent = '✓ Nudged';
          btn.classList.add('nudged');
        } else {
          notify(res?.error || 'Failed to send alert', 'error');
          btn.disabled = false;
          btn.textContent = '⚡ Nudge Teacher';
        }
      } catch (err) {
        notify('Failed to nudge: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = '⚡ Nudge Teacher';
      }
    });
  });

  // 1-Click Quick Assign Substitute
  document.querySelectorAll('.btn-quick-assign-sub').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const ds = btn.dataset;
      try {
        btn.disabled = true;
        btn.textContent = 'Assigning..';
        const res = await apiCall('POST', '/timetable/dashboard/quick-assign-substitute', {
          date: state.dashboardDate,
          periodNumber: ds.periodNumber,
          classId: ds.classId,
          className: ds.className,
          originalTeacherId: ds.origId,
          originalTeacherName: ds.origName,
          substituteTeacherId: ds.subId,
          substituteTeacherName: ds.subName,
          subject: ds.subject,
          room: ds.room
        });
        if (res && res.ok) {
          notify(res.message || `Substitute ${ds.subName} assigned successfully!`, 'success');
          await loadDashboardCockpit();
          const fp = document.getElementById('tt-full-page-container');
          if (fp && state.view === 'dashboard') {
            fp.innerHTML = timetableCockpitView();
            bindDashboardCockpit();
          }
        } else {
          notify(res?.error || 'Failed to assign substitute', 'error');
          btn.disabled = false;
        }
      } catch (err) {
        notify('Error assigning substitute: ' + err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  // Open existing substitute finder modal
  document.querySelectorAll('.btn-open-sub-finder').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const ds = btn.dataset;
      const fakeEntry = {
        classId: ds.classId,
        section: ds.classId,
        day: ds.day || 'Monday',
        period: ds.period || 'P1',
        teacher: ds.teacher,
        subject: ds.subject
      };
      if (typeof openSubstituteFinderModal === 'function') {
        openSubstituteFinderModal(fakeEntry, { day: fakeEntry.day, period: fakeEntry.period });
      } else {
        notify('Substitute Finder opened.', 'info');
      }
    });
  });

  // Click on free room -> Emergency Reassign trigger
  document.querySelectorAll('.btn-free-room-select').forEach(tile => {
    tile.addEventListener('click', () => {
      const hallNo = tile.dataset.hallNo;
      openEmergencyRoomReassignModal(hallNo);
    });
  });

  // Restart board remote command
  document.querySelectorAll('.btn-restart-board-cmd').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const boardId = btn.dataset.boardId;
      try {
        btn.disabled = true;
        btn.textContent = 'Restarting..';
        const res = await apiCall('POST', `/timetable/boards/${boardId}/command`, {
          command: 'restart_app',
          payload: { reason: 'Remote restart from dashboard' }
        });
        notify(res.message || 'Restart command dispatched to Smart Board.', 'success');
        btn.textContent = 'Dispatched';
      } catch (err) {
        notify('Failed to dispatch command: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Restart';
      }
    });
  });
}

function openCockpitSlotInspector(slotData) {
  const existing = document.getElementById('tt-slot-inspector-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'tt-slot-inspector-modal';
  modal.className = 'modal-bg open';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal modal-sm" style="max-width:440px;">
      <div class="modal-hd">
        <div>
          <span class="modal-eyebrow">PERIOD ALLOCATION</span>
          <h2 class="modal-title">${esc(slotData.className || 'Class')} • ${esc(slotData.period)}</h2>
        </div>
        <button type="button" class="modal-close" onclick="document.getElementById('tt-slot-inspector-modal').remove()">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px;">
        <div style="margin-bottom:12px;">
          <div style="font-size:11px;font-weight:700;color:var(--tmu,#5a7a5a);">SUBJECT</div>
          <div style="font-size:15px;font-weight:700;color:var(--td,#1a2e1a);">${esc(formatSubjectDisplay(slotData.subject) || slotData.subject || 'Free Period')}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--tmu,#5a7a5a);">INSTRUCTOR</div>
            <div style="font-size:13px;font-weight:600;">${esc(slotData.teacher || 'Unassigned')}${slotData.subTeacher ? ` <span class="pill pri" style="font-size:10px;">Sub: ${esc(slotData.subTeacher)}</span>` : ''}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--tmu,#5a7a5a);">ROOM ALLOCATION</div>
            <div style="font-size:13px;font-weight:600;">${esc(slotData.room || 'Not Assigned')}</div>
          </div>
        </div>
        <div style="margin-bottom:16px;">
          <div style="font-size:11px;font-weight:700;color:var(--tmu,#5a7a5a);">ATTENDANCE STATUS</div>
          <div style="margin-top:4px;">
            <span class="pill ${slotData.status === 'marked' ? 'pri' : (slotData.status === 'unmarked' ? 'warn' : '')}">
              ${slotData.status === 'marked' ? '🟢 Attendance Marked & Verified' : (slotData.status === 'unmarked' ? '🟡 Attendance Pending' : esc(slotData.status))}
            </span>
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button type="button" class="btn-out" onclick="document.getElementById('tt-slot-inspector-modal').remove()">Close</button>
          <button type="button" class="btn-pri" id="btn-jump-class-matrix" data-class-id="${esc(slotData.classId)}" data-class-name="${esc(slotData.className)}">Open in Matrix Editor</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#btn-jump-class-matrix')?.addEventListener('click', () => {
    modal.remove();
    state.filterSection = slotData.className || slotData.classId;
    switchTab('grid');
  });
}

function openEmergencyRoomReassignModal(targetHallNo) {
  const existing = document.getElementById('tt-reassign-room-modal');
  if (existing) existing.remove();

  const d = state.dashboardData;
  const classesList = d?.liveGrid?.classes || [];

  const modal = document.createElement('div');
  modal.id = 'tt-reassign-room-modal';
  modal.className = 'modal-bg open';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal modal-sm" style="max-width:460px;">
      <div class="modal-hd">
        <div>
          <span class="modal-eyebrow">EMERGENCY ALLOCATION</span>
          <h2 class="modal-title">Reassign Class to ${esc(targetHallNo)}</h2>
        </div>
        <button type="button" class="modal-close" onclick="document.getElementById('tt-reassign-room-modal').remove()">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px;">
        <p style="font-size:12.5px;color:var(--tmu,#5a7a5a);margin-top:0;">
          Select a class to immediately move into free room <b>${esc(targetHallNo)}</b> for today's active period.
        </p>
        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Target Class:</label>
          <select id="reassign-class-select" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--br,#ccc);font-size:13px;">
            ${classesList.map(c => `<option value="${esc(c.classId)}" data-name="${esc(c.className)}">${esc(c.className)}</option>`).join('')}
          </select>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Reason for Reassignment:</label>
          <input type="text" id="reassign-room-reason" value="Original room issue / projector repair" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--br,#ccc);font-size:13px;box-sizing:border-box;">
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button type="button" class="btn-out" onclick="document.getElementById('tt-reassign-room-modal').remove()">Cancel</button>
          <button type="button" class="btn-pri" id="btn-submit-emergency-room">Confirm Reassignment</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#btn-submit-emergency-room')?.addEventListener('click', async () => {
    const sel = modal.querySelector('#reassign-class-select');
    const classId = sel?.value;
    const className = sel?.selectedOptions?.[0]?.dataset?.name || 'Class';
    const reason = modal.querySelector('#reassign-room-reason')?.value || 'Emergency reassignment';

    try {
      const curP = state.dashboardData?.currentPeriod?.number || 1;
      const res = await apiCall('POST', '/timetable/dashboard/emergency-reassign-room', {
        date: state.dashboardDate,
        periodNumber: curP,
        classId,
        className,
        fromRoom: 'Previous Room',
        toRoom: targetHallNo,
        reason
      });
      notify(res.message || `Class ${className} moved to ${targetHallNo}.`, 'success');
      modal.remove();
      await loadDashboardCockpit();
      const fp = document.getElementById('tt-full-page-container');
      if (fp && state.view === 'dashboard') {
        fp.innerHTML = timetableCockpitView();
        bindDashboardCockpit();
      }
    } catch (err) {
      notify('Failed to reassign room: ' + err.message, 'error');
    }
  });
}

function viewHtml() {
  if (state.view === 'grid') {
    return state.env === 'production' ? productionView() : editorView();
  }
  if (state.view === 'dashboard') return timetableCockpitView();
  if (state.view === 'production') return productionView();
  if (state.view === 'editor') return editorView();
  if (state.view === 'workload') return dashboardView();
  if (state.view === 'history') return historyView();
  if (state.view === 'attendance') return attendanceView();
  if (state.view === 'subjects') return subjectsView();
  return otherView();
}

// ── Rendering & Binding (DOM Retained Workspace) ──
function render() {
  const isClassMatrix = (state.view === 'grid' || state.view === 'production' || state.view === 'editor');
  const tabstripBar = document.getElementById('tt-tabstrip-bar');
  const viewportContainer = document.getElementById('viewport-container');
  let fullPage = document.getElementById('tt-full-page-container');

  if (isClassMatrix && window.workspace) {
    if (tabstripBar) tabstripBar.style.display = '';
    if (viewportContainer) viewportContainer.style.display = '';
    if (fullPage) {
      fullPage.style.display = 'none';
      fullPage.innerHTML = '';
    }

    const activeTab = window.workspace.getActiveTab();
    if (activeTab && activeTab.paneEl) {
      renderTabContent(activeTab, activeTab.paneEl);
      updateDocumentTitle();
      return;
    }
  }

  if (!isClassMatrix) {
    if (tabstripBar) tabstripBar.style.display = 'none';
    if (viewportContainer) viewportContainer.style.display = 'none';

    if (!fullPage) {
      const pageContent = document.getElementById('page-content');
      if (pageContent) {
        fullPage = document.createElement('div');
        fullPage.id = 'tt-full-page-container';
        fullPage.className = 'tt-full-page-container';
        pageContent.appendChild(fullPage);
      }
    }
    if (fullPage) {
      fullPage.style.display = 'block';
      fullPage.innerHTML = viewHtml();
    }
  } else {
    if (fullPage) {
      fullPage.style.display = 'none';
      fullPage.innerHTML = '';
    }
    if (tabstripBar) tabstripBar.style.display = '';
    if (viewportContainer) viewportContainer.style.display = '';
  }

  const crumb = $('#crumb-current');
  const viewTitles = {
    grid: 'Timetable Matrix',
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
    attendance: 'Attendance Insights',
    'hall-roster': 'Combined Hall Roster',
    import: 'Excel Importer'
  };
  if (crumb) {
    crumb.textContent = viewTitles[state.view] || 'Timetable';
  }

  updateDocumentTitle();
  bindView();
}

async function renderTabContent(tab, paneEl) {
  if (!tab || !paneEl) return;

  if (tab.viewType === 'section') {
    state.view = 'grid';
    const targetSection = tab.viewParams?.sectionName || tab.viewParams?.classId || state.filterSection;
    if (targetSection) state.filterSection = targetSection;

    let classId = null;
    if (tab.viewParams?.classId && _masterData.classes?.some(c => String(c._id) === String(tab.viewParams.classId))) {
      classId = tab.viewParams.classId;
    } else {
      classId = getSelectedClassId();
    }

    const td = state.tabData ? state.tabData[tab.id] : null;
    if (!td || tab.renderedEnv !== state.env) {
      setLiveSyncStatus('loading', 'Loading..');
      await loadState(classId, tab.id);
      tab.renderedEnv = state.env;
    }

    const activeTd = state.tabData ? state.tabData[tab.id] : null;
    if (activeTd) {
      state.entries = activeTd.entries || [];
      state.production = activeTd.production || [];
      state.draftTemplateId = activeTd.draftTemplateId || null;
      state.draftTemplateStatus = activeTd.draftTemplateStatus || null;
      state.devSource = activeTd.devSource || 'development';
      state.dirty = activeTd.dirty || false;
    }
  } else {
    state.view = tab.viewType;
    if (tab.viewType === 'approvals') {
      setLiveSyncStatus('loading', 'Loading..');
      await loadVerificationRequests();
    } else if (tab.viewType === 'history') {
      setLiveSyncStatus('loading', 'Loading..');
      await loadVersions();
    } else if (tab.viewType === 'attendance') {
      setLiveSyncStatus('loading', 'Loading..');
      await loadAttendanceInsights();
    }
  }

  updateWorkspaceMode(state.env);

  let html = '';
  if (tab.viewType === 'hall-roster') {
    html = renderHallRosterView(tab.viewParams?.hallNo);
  } else if (tab.viewType === 'import') {
    html = renderImporterView();
  } else {
    html = viewHtml();
  }

  paneEl.innerHTML = html;

  const crumb = $('#crumb-current');
  if (crumb) {
    crumb.textContent = tab.title || (state.view === 'grid' ? 'Timetable Matrix' : 'Timetable View');
  }

  bindView();
  updateLiveSyncFromCurrentState();
}

async function handleTabActivation(tab) {
  if (!tab) return;
  if (tab.viewType === 'section') {
    state.view = 'grid';
    const targetSection = tab.viewParams?.sectionName || tab.viewParams?.classId;
    if (targetSection) state.filterSection = targetSection;

    let classId = null;
    if (tab.viewParams?.classId && _masterData.classes?.some(c => String(c._id) === String(tab.viewParams.classId))) {
      classId = tab.viewParams.classId;
    } else {
      classId = getSelectedClassId();
    }

    const td = state.tabData ? state.tabData[tab.id] : null;
    if (!td || tab.renderedEnv !== state.env) {
      setLiveSyncStatus('loading', 'Loading..');
      await loadState(classId, tab.id);
      tab.renderedEnv = state.env;
    }

    const activeTd = state.tabData ? state.tabData[tab.id] : null;
    if (activeTd) {
      state.entries = activeTd.entries || [];
      state.production = activeTd.production || [];
      state.draftTemplateId = activeTd.draftTemplateId || null;
      state.draftTemplateStatus = activeTd.draftTemplateStatus || null;
      state.devSource = activeTd.devSource || 'development';
      state.dirty = activeTd.dirty || false;
    }
    updateLiveSyncFromCurrentState();
  } else {
    state.view = tab.viewType;
    if (tab.viewType === 'history') {
      setLiveSyncStatus('loading', 'Loading..');
      await loadVersions();
    } else if (tab.viewType === 'attendance') {
      setLiveSyncStatus('loading', 'Loading..');
      await loadAttendanceInsights();
    }
    updateLiveSyncFromCurrentState();
  }

  // Sync mode in topbar and workspace
  updateWorkspaceMode(state.env);

  // Sync sidebar active item
  const sbView = tab.viewType === 'section' ? 'grid' : tab.viewType;
  document.querySelectorAll('.sb-item[data-view]').forEach(x => {
    x.classList.toggle('act', x.dataset.view === sbView || (sbView === 'grid' && (x.dataset.view === 'production' || x.dataset.view === 'editor')));
  });

  // Topbar title
  const crumb = document.getElementById('crumb-current');
  if (crumb) {
    crumb.textContent = tab.title || (state.view === 'grid' ? 'Timetable Matrix' : 'Timetable View');
  }

  // Restore undo/redo stacks for this tab (Section 2.3)
  tab.undoStack = tab.undoStack || [];
  tab.redoStack = tab.redoStack || [];
  undoStack.length = 0;
  undoStack.push(...tab.undoStack);
  redoStack.length = 0;
  redoStack.push(...tab.redoStack);

  updateDocumentTitle();
}

function openLauncherTab(key, targetSection) {
  if (!window.workspace) return;
  const openSectionNames = new Set(
    Array.from(window.workspace.tabs.values())
      .filter(t => t.viewType === 'section')
      .map(t => t.viewParams?.sectionName || t.viewParams?.classId || t.title)
  );

  let candidate = targetSection;
  if (!candidate || candidate === 'section') {
    candidate = SECTIONS.find(s => !openSectionNames.has(s)) || state.filterSection || (SECTIONS.length ? SECTIONS[0] : 'General');
  }

  const tabId = buildTabId('section', { classId: candidate });
  if (window.workspace.tabs.has(tabId)) {
    window.workspace.activateTab(tabId);
  } else {
    window.workspace.openTab({
      id: tabId,
      title: candidate,
      icon: '📅',
      viewType: 'section',
      viewParams: { classId: candidate, sectionName: candidate },
      mode: state.env || 'development'
    });
  }

  // Restore tabstrip & viewport container
  const tabstripBar = document.getElementById('tt-tabstrip-bar');
  const viewportContainer = document.getElementById('viewport-container');
  const fullPage = document.getElementById('tt-full-page-container');
  if (tabstripBar) tabstripBar.style.display = '';
  if (viewportContainer) viewportContainer.style.display = '';
  if (fullPage) {
    fullPage.style.display = 'none';
    fullPage.innerHTML = '';
  }
  state.view = 'grid';
  document.querySelectorAll('.sb-item[data-view]').forEach(x => x.classList.toggle('act', x.dataset.view === 'grid'));
}

function populateLauncherClassList(launcherEl) {
  if (!launcherEl) launcherEl = document.getElementById('tt-tab-launcher');
  if (!launcherEl) return;

  const listEl = launcherEl.querySelector('#tt-launcher-section-list');
  if (!listEl) return;

  const openSections = new Set(
    window.workspace
      ? Array.from(window.workspace.tabs.values())
          .filter(t => t.viewType === 'section')
          .map(t => t.viewParams?.sectionName || t.viewParams?.classId || t.title)
      : []
  );

  const sections = SECTIONS && SECTIONS.length ? SECTIONS : ['CSE-3A', 'CSE-3B', 'ECE-2A'];
  let html = '';
  sections.forEach(sec => {
    const isOpen = openSections.has(sec);
    html += `
      <button type="button" class="tt-launcher-item ${isOpen ? 'is-open' : ''}" data-launcher="section" data-section="${esc(sec)}">
        <span class="tt-launcher-icon">📅</span>
        <div class="tt-launcher-text">
          <div class="tt-launcher-title">Class ${esc(sec)} ${isOpen ? '<span class="tt-launcher-badge">Open</span>' : ''}</div>
          <div class="tt-launcher-sub">${isOpen ? 'Switch to active tab' : 'Open in new tab'}</div>
        </div>
      </button>
    `;
  });
  listEl.innerHTML = html;
}

function renderHallRosterView(hallNo = '') {
  const selectedHall = hallNo || (ROOMS.length ? ROOMS[0] : 'Main Hall');
  return heading('Facility & Hall Roster', `Combined Hall Roster · ${esc(selectedHall)}`, 'Consolidated student seating allocations and exam schedules across classes', button('🖨️ Print Roster', 'btn-out', 'print-btn')) +
    `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>Hall: ${esc(selectedHall)}</h2>
          <p>Real-time room occupancy, combined class batches, and assigned invigilators.</p>
        </div>
        <div style="display:flex;gap:8px;">
          <select id="hall-roster-selector" class="filter-select" style="height:36px;padding:4px 10px;border-radius:6px;border:1px solid var(--br);background:#ffffff;font-size:12px;">
            ${ROOMS.map(r => `<option value="${esc(r)}" ${r === selectedHall ? 'selected' : ''}>${esc(r)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="panel-body" id="hall-roster-body" style="padding:16px;">
        <table class="table">
          <thead>
            <tr><th>Day</th><th>Period</th><th>Time</th><th>Class / Section</th><th>Faculty</th><th>Capacity</th></tr>
          </thead>
          <tbody>
            ${(getAllClassesEntries() || []).filter(e => e.room === selectedHall).map(e => `
              <tr>
                <td><b>${esc(e.day)}</b></td>
                <td><span class="pill">${esc(e.period)}</span></td>
                <td style="font-family:'DM Mono',monospace">${timeFor(e.period)}</td>
                <td><span class="pill">${esc(e.section)}</span></td>
                <td><b>${esc(e.teacher)}</b></td>
                <td><span class="pill green">Active</span></td>
              </tr>
            `).join('') || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--tmu);">No allocated sessions in this hall.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderImporterView() {
  return heading('Bulk Data Ingestion', 'Excel Timetable Importer Wizard', 'Upload institutional Excel spreadsheets to automatically parse classes, courses, and schedules', '') +
    `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>Upload Timetable Spreadsheet (.xlsx / .xls)</h2>
          <p>Multi-sheet parsing with automated faculty resolution and pre-commit clash detection.</p>
        </div>
      </div>
      <div class="panel-body" style="padding:24px;display:flex;flex-direction:column;gap:16px;">
        <div style="border:2px dashed var(--gM,#388e3c);border-radius:12px;padding:36px 20px;text-align:center;background:var(--gLt,#e8f5e9);cursor:pointer;" id="excel-drop-zone">
          <div style="font-size:36px;margin-bottom:8px;">📊</div>
          <b style="font-size:15px;color:var(--gD,#1b5e20);">Click to browse or drag & drop timetable workbook here</b>
          <p style="font-size:12px;color:var(--tmu,#5a7a5a);margin-top:6px;">Supported formats: .xlsx, .xls (Max 15MB). Each sheet corresponds to a class section.</p>
          <input type="file" id="excel-file-input" accept=".xlsx,.xls" style="display:none;">
        </div>
        <div id="import-preview-results" style="display:none;"></div>
      </div>
    </div>`;
}

async function initTabWorkspace() {
  const tabstripEl = document.querySelector('.tt-tabstrip');
  const viewportEl = document.querySelector('.tt-viewport-container');

  if (!window.TabWorkspace || !tabstripEl || !viewportEl) {
    console.warn('[Timetable] TabWorkspace not available or DOM container missing; using classic render');
    if (state.view === 'history') await loadVersions();
    if (state.view === 'attendance') await loadAttendanceInsights();
    render();
    return;
  }

  window.workspace = new TabWorkspace({
    tabstripEl,
    viewportEl,
    renderTab: (tab, paneEl) => {
      return renderTabContent(tab, paneEl);
    },
    onActivate: (tab) => {
      return handleTabActivation(tab);
    },
    onClose: (tab) => {
      if (window.workspace && window.workspace.tabs.size === 0) {
        const secName = state.filterSection || (SECTIONS.length ? SECTIONS[0] : 'General');
        window.workspace.openTab({
          id: buildTabId('section', { classId: secName }),
          title: secName,
          icon: '📅',
          viewType: 'section',
          viewParams: { classId: secName, sectionName: secName },
          mode: state.env || 'development'
        });
      }
    },
    onDirtyChange: (tab, isDirty) => {
      state.dirty = isDirty;
    },
    confirmCloseDirty: async (tab) => {
      return new Promise((resolve) => {
        const confModal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-modal-title');
        const msgEl = document.getElementById('confirm-modal-message');
        const hintEl = document.getElementById('confirm-modal-hint');
        const acceptBtn = document.getElementById('accept-confirm-btn');
        const cancelBtn = document.getElementById('cancel-confirm-btn');

        if (!confModal) {
          return resolve(window.confirm(`Tab "${tab.title}" has unsaved changes. Discard and close?`));
        }

        if (titleEl) titleEl.textContent = 'Discard Unsaved Changes?';
        if (msgEl) msgEl.textContent = `You have unsaved changes in "${tab.title}". Close without saving?`;
        if (hintEl) hintEl.textContent = 'Any unpersisted draft modifications in this tab will be lost.';
        if (acceptBtn) {
          acceptBtn.textContent = 'Discard & Close';
          acceptBtn.style.background = '#dc2626';
        }

        const cleanup = (result) => {
          confModal.classList.remove('open');
          acceptBtn?.removeEventListener('click', onAccept);
          cancelBtn?.removeEventListener('click', onCancel);
          resolve(result);
        };

        const onAccept = () => cleanup(true);
        const onCancel = () => cleanup(false);

        acceptBtn?.addEventListener('click', onAccept);
        cancelBtn?.addEventListener('click', onCancel);
        confModal.classList.add('open');
      });
    },
    onPopulateLauncher: (launcherEl) => {
      populateLauncherClassList(launcherEl);
    },
    onLaunchView: (key, section) => {
      openLauncherTab(key, section);
    }
  });

  // Revalidation helper for sessionStorage restore (§6.3)
  const revalidateDraftFn = async (tabItem) => {
    try {
      const classId = tabItem.viewParams?.classId || (_masterData.classes || []).find(c => c.name === tabItem.viewParams?.sectionName)?._id;
      if (!classId) return false;
      const templates = await apiCall('GET', `/timetable/semester-templates?classId=${classId}&status=draft`);
      return Boolean(templates && templates.length);
    } catch {
      return false;
    }
  };

  const restored = await window.workspace.restoreSession(revalidateDraftFn);
  if (!restored || window.workspace.tabs.size === 0) {
    const initialSection = state.filterSection || (SECTIONS.length ? SECTIONS[0] : 'General');
    window.workspace.openTab({
      id: buildTabId('section', { classId: initialSection }),
      title: initialSection,
      icon: '📅',
      viewType: 'section',
      viewParams: { classId: initialSection, sectionName: initialSection },
      mode: state.env || 'development',
      isPinned: false
    });
  }

  const initialView = state.view || 'production';
  if (initialView === 'grid' || initialView === 'production' || initialView === 'editor') {
    switchTab('grid');
  } else {
    switchTab(initialView);
  }
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
    <button data-action="substitute">🔄 Find Substitute</button>
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

  const subBtn = menu.querySelector('[data-action="substitute"]');
  if (subBtn) {
    subBtn.disabled = !entry;
    if (entry) {
      const pNum = parseInt((target.period || 'P1').replace(/\D/g, ''), 10) || 1;
      const sub = (state.substitutions || []).find(s =>
        (s.day === target.day || s.day === entry.day) && (Number(s.period) === pNum || s.periodCode === target.period)
      );
      subBtn.innerHTML = sub ? '🔄 Manage / Revert Sub' : '🔄 Find Substitute';
    } else {
      subBtn.innerHTML = '🔄 Find Substitute';
    }
  }

  menu.style.left = `${Math.min(event.clientX, window.innerWidth - 190)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - 300)}px`;
  menu.classList.add('open');
}

async function contextAction(action, menu) {
  const day = menu.dataset.day, period = menu.dataset.period, id = menu.dataset.entryId;
  const entry = state.entries.find(x => x.id === id);

  if (action === 'substitute' && entry) {
    hideContextMenu();
    openSubstituteFinderModal(entry, { day, period });
    return;
  }
  if (action === 'copy' && entry) {
    state.clipboard = { ...entry, id: null };
    notify('Entry copied. Right-click target cell and choose Paste.', 'success');
  }
  if (action === 'cut' && entry) {
    recordHistory(`Cut ${entry.subject}`);
    state.clipboard = { ...entry, id: null };
    state.entries = state.entries.filter(x => x.id !== id);
    markCurrentTabDirty();
    render();
    persistState();
    notify('Entry cut. Choose Paste on target cell.', 'success');
  }
  if (action === 'clear' && entry) await deleteEntry(id);
  if (action === 'extend' && entry) {
    const candidate = { ...entry, duration: Number(entry.duration || 1) + 1 };
    const errors = conflictsFor(candidate, state.entries, entry.id);
    if (!errors.length) {
      recordHistory(`Extend span of ${entry.subject}`);
      state.entries = state.entries.map(x => x.id === entry.id ? candidate : x);
      markCurrentTabDirty();
      render();
      persistState();
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
      markCurrentTabDirty();
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
      markCurrentTabDirty();
      render();
      persistState();
      notify('Entry pasted.', 'success');
    }
  }
  hideContextMenu();
}

// ── Substitution Finder Modal (Item 6) ──
function openSubstituteFinderModal(entry, target = {}) {
  const dayName = target.day || entry.day || 'Monday';
  const periodCode = target.period || entry.period || 'P1';
  const pNum = parseInt(String(periodCode).replace(/\D/g, ''), 10) || 1;
  const originalTeacher = entry.teacher || 'Faculty';

  // Find active substitution if any
  const existingSub = (state.substitutions || []).find(s =>
    (s.day === dayName || s.day === entry.day) && (Number(s.period) === pNum || s.periodCode === periodCode)
  );

  const todayStr = new Date().toISOString().slice(0, 10);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-bg open';
  backdrop.id = 'substitute-finder-modal';

  backdrop.innerHTML = `<div class="modal modal-lg" style="max-width:680px">
    <div class="modal-hd">
      <div>
        <div class="modal-eyebrow">FACULTY LEAVE & SUBSTITUTION ASSIGNMENT</div>
        <h2 class="modal-title">🔄 Find Available Substitute</h2>
        <div class="modal-sub">
          <b>${esc(entry.subject)}</b> · ${esc(dayName)} ${esc(periodCode)} (${esc(timeFor(periodCode))}) · Section: <b>${esc(entry.section || state.filterSection)}</b>
        </div>
      </div>
      <button type="button" class="modal-close" id="close-sub-finder">×</button>
    </div>

    <div class="modal-body" style="padding:10px 0 16px">
      <!-- Slot context info card -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--gP);border:1px solid var(--br);border-radius:12px;margin-bottom:14px;font-size:12.5px">
        <div>
          <div>👤 Regular Faculty: <b>${esc(originalTeacher)}</b></div>
          <div style="font-size:11.5px;color:var(--tmu);margin-top:2px">📍 Room: <b>${esc(entry.room)}</b></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:11.5px;font-weight:600;color:var(--td)">Target Date:</label>
          <input type="date" id="sub-target-date" value="${todayStr}" style="padding:4px 8px;border:1px solid var(--br);border-radius:8px;font-size:12px">
        </div>
      </div>

      <!-- Active Substitution Banner if present -->
      ${existingSub ? `
        <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:12.5px;font-weight:700;color:#92400e">
              🔄 Currently Substituted: ${esc(existingSub.substituteTeacher)}
            </div>
            <div style="font-size:11.5px;color:#b45309;margin-top:2px">
              Original: ${esc(existingSub.originalTeacher || originalTeacher)} · Status: <b>${esc(existingSub.status || 'Active')}</b>
              ${existingSub.reason ? ` · Reason: ${esc(existingSub.reason)}` : ''}
            </div>
          </div>
          <button type="button" class="btn-out" id="revert-sub-btn" style="color:#dc2626;border-color:#fca5a5;padding:5px 12px;font-size:12px">
            ✕ Revert Substitution
          </button>
        </div>
      ` : ''}

      <!-- Candidate Teachers List -->
      <div style="margin-bottom:8px;font-size:12px;font-weight:700;color:var(--td)">
        Available Faculty (Free in ${esc(dayName)} ${esc(periodCode)}):
      </div>
      <div id="sub-candidates-list" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:8px">
        <div style="text-align:center;padding:24px 0;color:var(--tmu);font-size:12.5px">
          Checking real-time faculty availability…
        </div>
      </div>
    </div>

    <div class="modal-ft">
      <button type="button" class="btn-out" id="cancel-sub-finder">Close</button>
    </div>
  </div>`;

  document.body.appendChild(backdrop);

  const cleanup = () => backdrop.remove();
  backdrop.querySelector('#close-sub-finder')?.addEventListener('click', cleanup);
  backdrop.querySelector('#cancel-sub-finder')?.addEventListener('click', cleanup);

  // Revert action if substitution exists
  backdrop.querySelector('#revert-sub-btn')?.addEventListener('click', async () => {
    if (!existingSub || !existingSub.overrideId) {
      return notify('Substitution is linked to official leave workflow and cannot be removed here.', 'warn');
    }
    try {
      notify('Reverting substitution…', 'saving');
      await apiCall('DELETE', `/timetable/assign-substitute/${existingSub.overrideId}`);
      cleanup();
      await loadSubstitutionsAndLeaves();
      render();
      notify('Substitution reverted successfully.', 'success');
    } catch (err) {
      notify('Failed to revert substitution: ' + err.message, 'error');
    }
  });

  // Function to load free teachers
  async function fetchFreeCandidates(dateStr) {
    const listEl = backdrop.querySelector('#sub-candidates-list');
    if (!listEl) return;
    listEl.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--tmu);font-size:12.5px">Querying faculty schedules and leave records…</div>';

    try {
      const res = await apiCall('GET', `/timetable/free-teachers?day=${encodeURIComponent(dayName)}&periodNumber=${pNum}&period=${pNum}&date=${encodeURIComponent(dateStr)}`);
      const teachers = res.teachers || [];
      const freeTeachers = teachers.filter(t => t.isFreeForTarget && t.fullName?.toLowerCase() !== originalTeacher.toLowerCase());

      if (!freeTeachers.length) {
        listEl.innerHTML = `
          <div style="text-align:center;padding:24px 10px;background:#f8fafc;border-radius:10px;border:1px dashed var(--br);color:var(--tmu);font-size:12.5px">
            No faculty members are completely free in Period ${pNum} on this date.<br>
            All faculty in this department are either teaching, on approved leave, or in another class.
          </div>
        `;
        return;
      }

      listEl.innerHTML = freeTeachers.map(t => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#ffffff;border:1px solid var(--br);border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,0.02)">
          <div>
            <div style="font-size:12.5px;font-weight:700;color:var(--td)">👤 ${esc(t.fullName)}</div>
            <div style="font-size:11px;color:var(--tmu);margin-top:2px">
              ID: ${esc(t.trackId || t.employeeNo || 'Faculty')} · Status: <span style="color:#16a34a;font-weight:600">✓ Free in Period ${pNum}</span>
            </div>
          </div>
          <button type="button" class="btn-pri assign-this-sub" data-teacher="${esc(t.fullName)}" data-teacher-id="${esc(t._id)}" style="padding:6px 14px;font-size:12px">
            Assign Substitute
          </button>
        </div>
      `).join('');

      // Bind assign buttons
      listEl.querySelectorAll('.assign-this-sub').forEach(btn => {
        btn.addEventListener('click', async () => {
          const subName = btn.dataset.teacher;
          const subId = btn.dataset.teacherId;
          const curDate = backdrop.querySelector('#sub-target-date')?.value || todayStr;

          try {
            notify(`Assigning ${subName} as substitute…`, 'saving');
            await apiCall('POST', '/timetable/assign-substitute', {
              classId: getSelectedClassId(),
              className: state.filterSection || entry.section,
              date: curDate,
              day: dayName,
              period: pNum,
              originalTeacher,
              substituteTeacher: subName,
              substituteTeacherId: subId,
              subject: entry.subject,
              room: entry.room,
              reason: `Substitution for ${originalTeacher}`
            });

            cleanup();
            await loadSubstitutionsAndLeaves();
            render();
            notify(`✓ Assigned ${subName} as substitute for ${originalTeacher}.`, 'success');
          } catch (err) {
            notify('Failed to assign substitute: ' + err.message, 'error');
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;font-size:12px">Error fetching free teachers: ${esc(err.message)}</div>`;
    }
  }

  fetchFreeCandidates(todayStr);

  backdrop.querySelector('#sub-target-date')?.addEventListener('change', e => {
    fetchFreeCandidates(e.target.value);
  });
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

  // Target class & department-scoped subjects (Change 1, 3, 5, 8)
  const targetSection = current.section || state.filterSection;
  const currentClass = (_masterData.classes || []).find(c => c.name === targetSection || String(c._id) === String(targetSection));

  let filteredSubjects = (_masterData.subjects || []).filter(s => {
    if (!currentClass || !currentClass.deptId) return true;
    const cDept = String(currentClass.deptId?._id || currentClass.deptId);
    const sDept = String(s.deptId?._id || s.deptId);
    return cDept === sDept;
  });
  if (!filteredSubjects.length) filteredSubjects = _masterData.subjects || [];

  const currentSubjDisplay = formatSubjectDisplay(current.subject);

  // Format period options with full 12-hour times
  const periodOptions = PERIODS.map(p => ({
    value: p[0],
    text: `${p[3] || p[0]} (${format12h(p[1])} – ${format12h(p[2])})`
  }));

  const activeCombined = Array.isArray(current.combinedWith) ? current.combinedWith : [];

  const pNum = parseInt((current.period || 'P1').replace(/\D/g, ''), 10) || 1;
  const sub = (state.substitutions || []).find(s =>
    (s.day === current.day) && (Number(s.period) === pNum || s.periodCode === current.period)
  );
  const teacherOnLeave = !sub && (state.activeLeaves || []).find(l =>
    (l.teacherName || '').toLowerCase() === (current.teacher || '').toLowerCase()
  );

  let bannerHtml = '';
  if (sub) {
    bannerHtml = `<div style="grid-column: span 2; background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:10px 14px; font-size:12px; color:#92400e; margin-bottom:6px">
      <b>🔄 Active Substitute Assignment:</b> Original: ${esc(sub.originalTeacher || current.teacher)} → Substitute: <b>${esc(sub.substituteTeacher)}</b> (${esc(sub.status || 'Active')})
      <div style="font-size:11px; color:#b45309; margin-top:2px">⚠️ Modifying this slot's timing or faculty directly may conflict with the registered leave substitution record.</div>
    </div>`;
  } else if (teacherOnLeave) {
    bannerHtml = `<div style="grid-column: span 2; background:#fff1f2; border:1px solid #fecaca; border-radius:10px; padding:10px 14px; font-size:12px; color:#991b1b; margin-bottom:6px">
      <b>🏖️ Faculty on Approved Leave:</b> ${esc(current.teacher)} is on approved ${esc(teacherOnLeave.leaveType || 'Leave')}. Right-click this slot on the grid to find and assign an available substitute.
    </div>`;
  }

  const slotBannerHtml = `
    <div class="slot-summary-box" style="grid-column:span 2;display:flex;align-items:center;justify-content:space-between;background:var(--gP,#f4f7f4);border:1px solid var(--br);border-radius:10px;padding:10px 14px;margin-bottom:8px">
      <div style="font-size:13px;color:var(--td)">
        Select Timetable slot for <b id="slot-banner-code" style="color:var(--gD,#1b5e20);font-size:13.5px">${esc(current.period)} * ${esc(current.day)}</b>
        <button type="button" class="slot-change-btn" id="toggle-slot-time-fields" style="background:none;border:none;color:var(--gM,#388e3c);font-weight:700;cursor:pointer;text-decoration:underline;margin-left:8px;font-size:12.5px;padding:0">(change)</button>
      </div>
      <span class="pill pri" style="font-size:11px">${esc(current.section || state.filterSection || 'Class')}</span>
    </div>
    <div id="slot-time-fields-wrap" style="display:none;grid-column:span 2;background:#fff;border:1px dashed var(--br);border-radius:10px;padding:10px 12px;margin-bottom:8px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${field('day', 'Day', current.day, DAYS)}
        ${field('period', 'Start Period', current.period, periodOptions)}
      </div>
    </div>
  `;

  modal.querySelector('.form-grid').innerHTML =
    bannerHtml +
    slotBannerHtml +
    field('duration', 'Duration (Periods)', current.duration) +
    `<label style="position:relative;">
      Subject *
      <div class="tt-searchable-select-wrap" id="entry-subject-wrap">
        <input type="text" class="tt-searchable-input" id="entry-subject-search" placeholder="Search or select subject…" autocomplete="off" value="${esc(currentSubjDisplay)}">
        <input type="hidden" id="entry-subject" name="subject" value="${esc(current.subject || currentSubjDisplay)}">
        <div class="tt-searchable-dropdown" id="entry-subject-dropdown" style="display:none;"></div>
      </div>
      <span class="field-error" data-error="subject"></span>
    </label>` +
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

  // Toggle slot time fields on (change)
  const toggleBtn = modal.querySelector('#toggle-slot-time-fields');
  const timeFieldsWrap = modal.querySelector('#slot-time-fields-wrap');
  toggleBtn?.addEventListener('click', () => {
    const isHidden = timeFieldsWrap.style.display === 'none';
    timeFieldsWrap.style.display = isHidden ? 'block' : 'none';
    toggleBtn.textContent = isHidden ? '(hide)' : '(change)';
  });

  const updateBannerCode = () => {
    const dVal = modal.querySelector('[name="day"]')?.value || current.day;
    const pVal = modal.querySelector('[name="period"]')?.value || current.period;
    const codeEl = modal.querySelector('#slot-banner-code');
    if (codeEl) codeEl.textContent = `${pVal} * ${dVal}`;
  };

  modal.querySelector('[name="day"]')?.addEventListener('change', updateBannerCode);
  modal.querySelector('[name="period"]')?.addEventListener('change', updateBannerCode);

  // Setup Class Type and Classroom/Lab behavior (Change 8)
  const typeSelect = modal.querySelector('#entry-type');
  const chipGroup = modal.querySelector('#combined-chip-group');
  const roomSelect = modal.querySelector('#entry-room');
  const teacherSelect = modal.querySelector('#entry-teacher');

  const updateRoomOptions = (isLabOnly) => {
    if (!roomSelect) return;
    const currentVal = roomSelect.value;
    if (isLabOnly) {
      const labRooms = (_masterData.rooms || []).filter(r => r.type === 'Lab' || (r.name && r.name.toLowerCase().includes('lab')));
      const roomList = labRooms.length ? labRooms : (_masterData.rooms || []);
      roomSelect.innerHTML = roomList.map(r => {
        const rName = r.hallNo || r.name;
        return `<option value="${esc(rName)}" ${rName === currentVal ? 'selected' : ''}>${esc(rName)} (Lab)</option>`;
      }).join('');
    } else {
      roomSelect.innerHTML = (_masterData.rooms || []).map(r => {
        const rName = r.hallNo || r.name;
        return `<option value="${esc(rName)}" ${rName === currentVal ? 'selected' : ''}>${esc(rName)}</option>`;
      }).join('');
    }
    if (currentVal && !Array.from(roomSelect.options).some(o => o.value === currentVal)) {
      const extraOpt = document.createElement('option');
      extraOpt.value = currentVal;
      extraOpt.textContent = currentVal;
      extraOpt.selected = true;
      roomSelect.appendChild(extraOpt);
    }
  };

  typeSelect?.addEventListener('change', e => {
    if (chipGroup) {
      chipGroup.style.display = e.target.value === 'Combined' ? 'block' : 'none';
      if (e.target.value === 'Combined') chipGroup.style.gridColumn = 'span 2';
    }
    updateRoomOptions(e.target.value === 'Lab');
  });

  // If initial type is Lab, filter rooms to labs
  if (current.type === 'Lab') {
    updateRoomOptions(true);
  }

  // Pre-load class assignments for auto-filling faculty & hall (Change 8)
  let classAssignments = [];
  if (currentClass && currentClass._id) {
    apiCall('GET', `/assignments?classId=${currentClass._id}`).then(asgns => {
      classAssignments = Array.isArray(asgns) ? asgns : [];
    }).catch(() => {});
  }

  // Searchable Subject Dropdown Logic (Change 3, 5, 8)
  const searchInput = modal.querySelector('#entry-subject-search');
  const hiddenInput = modal.querySelector('#entry-subject');
  const dropdownEl = modal.querySelector('#entry-subject-dropdown');

  const renderDropdownItems = (filterText = '') => {
    const q = filterText.toLowerCase().trim();
    const items = filteredSubjects.filter(s => {
      if (!q) return true;
      const code = (s.code || '').toLowerCase();
      const sc = (s.shortName || '').toLowerCase();
      const name = (s.name || '').toLowerCase();
      return code.includes(q) || sc.includes(q) || name.includes(q);
    });

    if (!items.length) {
      dropdownEl.innerHTML = '<div style="padding:10px 14px;color:var(--tmu);font-size:12px;">No matching subjects found</div>';
      return;
    }

    dropdownEl.innerHTML = items.map(s => {
      const code = s.code || '';
      const sc = s.shortName || s.name || '';
      const displayLabel = `${code} ${sc}`.trim();
      return `<div class="tt-searchable-item" data-subj-id="${esc(s._id)}" data-subj-name="${esc(s.name)}" data-subj-display="${esc(displayLabel)}" data-subj-type="${esc(s.type || 'Theory')}">
        <span style="font-weight:700;">${esc(displayLabel)}</span>
        <span style="font-size:11px;color:var(--tmu);">${esc(s.name)}</span>
      </div>`;
    }).join('');

    dropdownEl.querySelectorAll('.tt-searchable-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const displayLabel = item.dataset.subjDisplay;
        const subjName = item.dataset.subjName;
        const subjType = item.dataset.subjType;
        const subjId = item.dataset.subjId;

        hiddenInput.value = displayLabel;
        searchInput.value = displayLabel;
        dropdownEl.style.display = 'none';

        // Requirement 8: Auto change Class Type based on subject
        const isLab = subjType === 'Lab' || subjName.toLowerCase().includes('lab');
        if (typeSelect) {
          typeSelect.value = isLab ? 'Lab' : 'Theory';
          typeSelect.dispatchEvent(new Event('change'));
        }

        // Auto Assign teacher and Hall from class assignments
        const matchAssign = classAssignments.find(a =>
          (subjId && String(a.subjectId) === String(subjId)) ||
          (a.subjectName && a.subjectName.toLowerCase() === subjName.toLowerCase())
        );

        if (matchAssign) {
          if (teacherSelect && matchAssign.teacherName) {
            let opt = Array.from(teacherSelect.options).find(o => o.value.toLowerCase() === matchAssign.teacherName.toLowerCase());
            if (opt) {
              teacherSelect.value = opt.value;
            } else {
              const newOpt = document.createElement('option');
              newOpt.value = matchAssign.teacherName;
              newOpt.textContent = matchAssign.teacherName;
              newOpt.selected = true;
              teacherSelect.appendChild(newOpt);
            }
          }
          if (roomSelect && matchAssign.hallNo) {
            let opt = Array.from(roomSelect.options).find(o => o.value.toLowerCase() === matchAssign.hallNo.toLowerCase());
            if (opt) {
              roomSelect.value = opt.value;
            } else {
              const newOpt = document.createElement('option');
              newOpt.value = matchAssign.hallNo;
              newOpt.textContent = matchAssign.hallNo;
              newOpt.selected = true;
              roomSelect.appendChild(newOpt);
            }
          }
        }
      });
    });
  };

  searchInput?.addEventListener('focus', () => {
    dropdownEl.style.display = 'block';
    renderDropdownItems(searchInput.value);
  });

  searchInput?.addEventListener('input', (e) => {
    dropdownEl.style.display = 'block';
    hiddenInput.value = e.target.value;
    renderDropdownItems(e.target.value);
  });

  const closeDropdownOnOutsideClick = (e) => {
    if (!e.target.closest('#entry-subject-wrap')) {
      if (dropdownEl) dropdownEl.style.display = 'none';
    }
  };
  document.addEventListener('click', closeDropdownOnOutsideClick);

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

  const teacherName = value('teacher') || '';
  let teacherId = null;
  let teacherTrackId = '';
  if (teacherName && _masterData.teachers) {
    const tObj = _masterData.teachers.find(t =>
      (t.fullName || t.name || '').toLowerCase() === teacherName.toLowerCase() ||
      (t.username || '').toLowerCase() === teacherName.toLowerCase()
    );
    if (tObj) {
      teacherId = tObj._id || null;
      teacherTrackId = tObj.trackId || '';
    }
  }

  const subjectVal = value('subject') || '';
  let subjectId = null;
  if (subjectVal && _masterData.subjects) {
    const sObj = _masterData.subjects.find(s =>
      (s.name || '').toLowerCase() === subjectVal.toLowerCase() ||
      (s.code || '').toLowerCase() === subjectVal.toLowerCase() ||
      `${s.code || ''} ${s.shortName || s.name || ''}`.trim().toLowerCase() === subjectVal.toLowerCase()
    );
    if (sObj) subjectId = sObj._id || null;
  }

  const roomVal = value('room') || '';
  let roomId = null;
  if (roomVal && _masterData.rooms) {
    const rObj = _masterData.rooms.find(r =>
      (r.hallNo || r.name || '').toLowerCase() === roomVal.toLowerCase()
    );
    if (rObj) roomId = rObj._id || null;
  }

  return {
    id: state.selectedId || uid(),
    day: value('day'),
    period: value('period'),
    duration: Number(value('duration') || 1),
    subject: subjectVal,
    subjectId,
    teacher: teacherName,
    teacherId,
    teacherTrackId,
    room: roomVal,
    roomId,
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
    message: 'Delete this layout preset or master template?',
    hint: 'This template will be permanently removed from the database.',
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

// ── Draft Management & Database Persistence (Items 4, 5, 6) ──

async function clearDraft() {
  if (!state.entries.length) return notify('Draft is already empty.', 'info');
  const confirmed = await confirmModal({
    title: 'Clear Current Draft',
    eyebrow: 'CLEAR DRAFT SLOTS',
    icon: '🗑️',
    message: `Are you sure you want to clear all ${state.entries.length} scheduled slots from the current draft for ${state.filterSection || 'this class'}?`,
    hint: 'This will remove all draft slots from the workspace. You can use Undo to revert if needed.',
    confirmText: 'Clear All Slots',
    confirmClass: 'btn-out'
  });
  if (!confirmed) return;

  recordHistory('Clear Draft');
  state.entries = [];
  markCurrentTabDirty();
  render();
  persistState();
  notify('Draft cleared. Use Undo to restore if needed.', 'info');
}

function openSavePublishModal() {
  const classId = getSelectedClassId();
  if (!classId) return notify('Please select a class/section first.', 'warn');
  if (!state.entries.length) return notify('Your draft is empty. Add or auto-generate slots before saving.', 'warn');

  const conflicts = allConflicts(state.entries);
  const currentSection = state.filterSection || 'Current Section';
  const totalSlots = state.entries.length;

  const user = typeof getUser === 'function' ? getUser() : (JSON.parse(sessionStorage.getItem('user') || '{}'));
  const isExempt = user && (user.role === 'admin' || user.isHod === true);
  const requireApproval = _publicSettings?.models?.requireHodApproval !== false;
  const canDirectPublish = isExempt || !requireApproval;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-bg open';
  backdrop.id = 'save-publish-modal';

  backdrop.innerHTML = `
    <div class="modal modal-lg" style="max-width:720px">
      <div class="modal-hd">
        <div>
          <div class="modal-eyebrow" style="color:var(--gM,#388e3c)">PERSISTENCE &amp; DEPLOYMENT HUB</div>
          <h2 class="modal-title">💾 Save Timetable to Database</h2>
          <div class="modal-sub">
            Choose whether to persist as a <b>Development Draft</b> or submit for <b>Production (HoD Verification)</b> for <b>${esc(currentSection)}</b>.
          </div>
        </div>
        <button type="button" class="modal-close" id="close-save-publish-modal">×</button>
      </div>

      <div class="modal-body" style="padding:10px 0 16px">
        ${conflicts.length ? `
          <div class="publish-conflict-banner" style="margin-bottom:14px">
            <div class="publish-conflict-title">⚠️ ${conflicts.length} Conflict(s) Detected in Draft</div>
            <div>Draft contains schedule collisions. You can still save to Development, but Production submission requires conflict resolution.</div>
            <ul class="publish-conflict-list" style="margin-top:6px">
              ${conflicts.slice(0, 3).map(c => `<li>${esc(c.message || c)}</li>`).join('')}
              ${conflicts.length > 3 ? `<li>…and ${conflicts.length - 3} more conflict(s)</li>` : ''}
            </ul>
          </div>
        ` : ''}

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <!-- Option 1: Development Save -->
          <div class="save-option-card dev" style="border:2px solid var(--br);border-radius:12px;padding:16px;background:var(--card,#fff);display:flex;flex-direction:column;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <span class="pill pri" style="font-size:11px">DEVELOPMENT WORKSPACE</span>
              <span style="font-size:20px">🛠️</span>
            </div>
            <h3 style="font-size:15px;margin:0 0 6px;color:var(--td)">Save as Development Draft</h3>
            <p style="font-size:12px;color:var(--tmu);line-height:1.4;margin:0 0 12px;flex:1">
              Saves ${totalSlots} slots to DB as an isolated draft version. Live student and faculty timetables remain completely untouched.
            </p>
            <div style="margin-bottom:10px">
              <label style="font-size:11.5px;font-weight:600;display:block;margin-bottom:4px">Draft Version Name</label>
              <input type="text" id="dev-ver-name" placeholder="e.g. Draft v1 (or custom name)" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--br);border-radius:8px;font-size:12px">
            </div>
            <div style="margin-bottom:14px">
              <label style="font-size:11.5px;font-weight:600;display:block;margin-bottom:4px">Notes / Description</label>
              <input type="text" id="dev-ver-notes" placeholder="Notes on this draft state…" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--br);border-radius:8px;font-size:12px">
            </div>
            <button type="button" class="btn-out" id="btn-save-development" style="width:100%;font-weight:600;padding:8px 0;">
              💾 Save to Development DB
            </button>
          </div>

          <!-- Option 2: Production Submit (HoD Approval) -->
          <div class="save-option-card prod" style="border:2px solid var(--gM,#388e3c);border-radius:12px;padding:16px;background:var(--gP,#f4f7f4);display:flex;flex-direction:column;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <span class="pill" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7;font-size:11px;font-weight:700">OFFICIAL PRODUCTION</span>
              <span style="font-size:20px">📋</span>
            </div>
            <h3 style="font-size:15px;margin:0 0 6px;color:var(--gD,#1b5e20)">Submit for HoD Verification</h3>
            <p style="font-size:12px;color:var(--tmu);line-height:1.4;margin:0 0 12px;flex:1">
              Submits schedule to Department HoD for review. Once verified and approved by the HoD, Timetable Coordinator publishes live to all.
            </p>
            <div style="margin-bottom:10px">
              <label style="font-size:11.5px;font-weight:600;display:block;margin-bottom:4px">Production Version Name</label>
              <input type="text" id="prod-ver-name" placeholder="e.g. Production v1 - Odd Sem" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--br);border-radius:8px;font-size:12px">
            </div>
            <div style="margin-bottom:14px">
              <label style="font-size:11.5px;font-weight:600;display:block;margin-bottom:4px">Submission Notes for HoD</label>
              <input type="text" id="prod-ver-notes" placeholder="Reason or semester notes for HoD…" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--br);border-radius:8px;font-size:12px">
            </div>
            <button type="button" class="btn-pri" id="btn-submit-verification" ${conflicts.length ? 'disabled style="width:100%;opacity:0.5;cursor:not-allowed;"' : 'style="width:100%;background:linear-gradient(135deg,var(--gD,#1b5e20),#2e7d32);padding:8px 0;font-weight:700;"'}>
              ${conflicts.length ? '⚠️ Resolve Conflicts First' : '📋 Submit to HoD for Verification'}
            </button>
            ${canDirectPublish ? `
              <button type="button" id="btn-save-prod-direct" style="margin-top:8px;background:none;border:none;color:var(--tmu);font-size:11.5px;cursor:pointer;text-decoration:underline;">
                ⚡ Direct Live Publish (Instant without HoD)
              </button>
            ` : ''}
          </div>
        </div>
      </div>

      <div class="modal-ft" style="display:flex;justify-content:flex-end;">
        <button type="button" class="btn-out" id="cancel-save-publish-modal">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const closeModal = () => {
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 150);
  };

  backdrop.querySelector('#close-save-publish-modal')?.addEventListener('click', closeModal);
  backdrop.querySelector('#cancel-save-publish-modal')?.addEventListener('click', closeModal);

  // Save to Development DB
  backdrop.querySelector('#btn-save-development')?.addEventListener('click', async () => {
    const devBtn = backdrop.querySelector('#btn-save-development');
    const versionName = backdrop.querySelector('#dev-ver-name')?.value?.trim();
    const notes = backdrop.querySelector('#dev-ver-notes')?.value?.trim();

    if (devBtn) { devBtn.disabled = true; devBtn.textContent = 'Saving Draft to DB…'; }
    notify('Saving development draft to database…', 'saving');

    try {
      const res = await apiCall('POST', '/timetable/save-development', {
        classId,
        slots: entriesToGrid(state.entries),
        versionName,
        notes
      });
      closeModal();
      notify(`✓ ${res.message || 'Development draft saved successfully!'}`, 'success');
      state.dirty = false;
      await persistState();
      render();
    } catch (err) {
      notify('Failed to save development draft: ' + err.message, 'error');
      if (devBtn) { devBtn.disabled = false; devBtn.textContent = '💾 Save to Development DB'; }
    }
  });

  // Submit for HoD Verification
  backdrop.querySelector('#btn-submit-verification')?.addEventListener('click', async () => {
    if (conflicts.length) return notify('Cannot submit for production while conflicts exist.', 'warn');
    const submitBtn = backdrop.querySelector('#btn-submit-verification');
    const versionName = backdrop.querySelector('#prod-ver-name')?.value?.trim();
    const notes = backdrop.querySelector('#prod-ver-notes')?.value?.trim();

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting to HoD…'; }
    notify('Submitting timetable to HoD for approval…', 'saving');

    try {
      const res = await apiCall('POST', '/timetable/verification-requests', {
        classId,
        slots: entriesToGrid(state.entries),
        versionName,
        notes
      });
      closeModal();
      notify('📋 Timetable submitted to HoD for verification! Once approved, publish from Conflict & Approvals.', 'success');
      state.dirty = false;
      await loadVerificationRequests();
      switchTab('approvals');
    } catch (err) {
      notify('Failed to submit verification request: ' + err.message, 'error');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '📋 Submit to HoD for Verification'; }
    }
  });

  // Direct Live Publish (Instant)
  backdrop.querySelector('#btn-save-prod-direct')?.addEventListener('click', async () => {
    if (conflicts.length) return notify('Cannot publish live while conflicts exist.', 'warn');
    const confirmed = await confirmModal({
      title: 'Publish Live to Production',
      eyebrow: 'DIRECT PRODUCTION DEPLOYMENT',
      icon: '🚀',
      message: `Deploy current draft directly to live production for ${currentSection}?`,
      hint: 'This immediately updates the live schedule for all students and faculty.',
      confirmText: 'Publish Live Now',
      confirmClass: 'btn-pri'
    });
    if (!confirmed) return;

    const versionName = backdrop.querySelector('#prod-ver-name')?.value?.trim();
    const notes = backdrop.querySelector('#prod-ver-notes')?.value?.trim();
    notify('Saving and deploying directly to production…', 'saving');

    try {
      const res = await apiCall('POST', '/timetable/save-production', {
        classId,
        slots: entriesToGrid(state.entries),
        versionName,
        notes
      });
      closeModal();
      notify(`🚀 ${res.message || 'Production timetable saved and live!'}`, 'success');
      updateWorkspaceMode('production');
      state.dirty = false;
      await loadState();
      render();
    } catch (err) {
      notify('Failed to publish to production: ' + err.message, 'error');
    }
  });
}

// ── Department HoD Timetable Verification & Approval (Items 4, 5, 6) ──

async function loadVerificationRequests() {
  try {
    state.loadingVerifications = true;
    state.loading = true;
    setLiveSyncStatus('loading', 'Loading..');
    const classId = getSelectedClassId();
    const url = '/timetable/verification-requests' + (classId ? `?classId=${classId}` : '');
    const res = await apiCall('GET', url);
    state.verificationRequests = Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : []);
  } catch (err) {
    console.error('Failed to load verification requests:', err);
    state.verificationRequests = [];
  } finally {
    state.loadingVerifications = false;
    state.loading = false;
  }
}

async function reviewVerificationRequest(id, action) {
  const comment = action === 'reject' ? prompt('Please enter reason for rejection (optional):') : '';
  if (action === 'reject' && comment === null) return;
  try {
    notify(`Processing HoD ${action}…`, 'saving');
    const res = await apiCall('POST', `/timetable/verification-requests/${id}/review`, { action, comment: comment || '' });
    notify(res.message || `Timetable ${action === 'approve' ? 'approved' : 'rejected'} successfully!`, 'success');
    await loadVerificationRequests();
    render();
  } catch (err) {
    notify('Failed to process verification: ' + err.message, 'error');
  }
}

async function publishAllRequest(id) {
  const confirmed = await confirmModal({
    title: 'Publish Approved Timetable to All',
    eyebrow: 'LIVE PRODUCTION DEPLOYMENT',
    icon: '🚀',
    message: 'Publish this HoD-approved timetable to live production for all students and faculty?',
    hint: 'This will update the live section timetable in database and broadcast notifications campus-wide.',
    confirmText: 'Publish to All 🚀',
    confirmClass: 'btn-pri'
  });
  if (!confirmed) return;

  try {
    notify('Publishing timetable campus-wide…', 'saving');
    const res = await apiCall('POST', `/timetable/verification-requests/${id}/publish-all`, {});
    notify(res.message || 'Timetable published to live production campus-wide!', 'success');
    await loadVerificationRequests();
    if (state.env === 'production') await loadState();
    render();
  } catch (err) {
    notify('Failed to publish timetable: ' + err.message, 'error');
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
    markCurrentTabDirty();
    closeModal();
    render();
    persistState();
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
  markCurrentTabDirty();
  closeModal();
  render();
  persistState();
  notify('Timetable entry deleted.', 'success');
}

function copyEntry(entry) {
  openEntryModal({ ...entry, id: null, day: DAYS[(DAYS.indexOf(entry.day) + 1) % DAYS.length] });
}

// ── CSV & Excel Export ──
function exportCurrent() {
  const entries = activeEntries();
  if (!entries.length) return notify('No timetable records to export.', 'warn');

  const isDev = state.env === 'development';
  const watermark = isDev
    ? [
        `"EAMS TIMETABLE EXPORT — [DRAFT / UNFINALIZED]"`,
        `"Section: ${state.filterSection || 'All'} | Environment: DEVELOPMENT | Generated: ${new Date().toLocaleString()}"`,
        `"Data Source: ${state.devSource === 'production' ? 'Production Fallback' : 'Development Draft'}"`,
        `""`
      ]
    : [
        `"EAMS TIMETABLE EXPORT — [OFFICIAL LIVE PRODUCTION]"`,
        `"Section: ${state.filterSection || 'All'} | Environment: PRODUCTION | Generated: ${new Date().toLocaleString()}"`,
        `"Data Source: Live Published Timetable"`,
        `""`
      ];

  const header = ['Day', 'Period', '12h Time', 'Duration', 'Subject', 'Faculty', 'Room', 'Section', 'Type'];
  const csvRows = [...watermark, header.map(h => `"${h}"`).join(',')];

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
    ].map(val => `"${String(val ?? '').replace(/"/g, '""')}"`).join(','));
  });

  const csv = csvRows.join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `EAMS-Timetable-${state.filterSection || 'All'}${isDev ? '_DRAFT_' : '_LIVE_'}${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  notify(`${entries.length} timetable records exported to CSV.`, 'success');
}

function exportCurrentExcel() {
  const entries = activeEntries();
  const secName = state.filterSection || 'All';
  if (!entries.length) return notify('No timetable records to export.', 'warn');

  let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">' +
    '<head><meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8">' +
    '<style>' +
    'table { border-collapse: collapse; width: 100%; font-family: Calibri, Arial, sans-serif; font-size: 11pt; }' +
    'th { background-color: #1b5e20; color: #ffffff; border: 1px solid #144017; padding: 8px; text-align: center; font-weight: bold; }' +
    'td { border: 1px solid #cccccc; padding: 6px; text-align: center; vertical-align: middle; }' +
    '.header-title { font-size: 14pt; font-weight: bold; text-align: left; color: #1b5e20; }' +
    '.sub-title { font-size: 11pt; color: #555555; text-align: left; }' +
    '.day-col { font-weight: bold; background-color: #f4f7f4; }' +
    '.lab-slot { background-color: #fff3e0; color: #e65100; font-weight: bold; }' +
    '.theory-slot { background-color: #e8f5e9; color: #1b5e20; font-weight: bold; }' +
    '</style></head><body><table>' +
    '<tr><td colspan="' + (PERIODS.length + 1) + '" class="header-title">EAMS Academic Timetable · Section: ' + esc(secName) + ' (' + (state.env === 'development' ? 'DRAFT' : 'LIVE PRODUCTION') + ')</td></tr>' +
    '<tr><td colspan="' + (PERIODS.length + 1) + '" class="sub-title">Exported on ' + new Date().toLocaleString() + '</td></tr>' +
    '<tr><td></td></tr>' +
    '<tr><th>Day / Period</th>' +
    PERIODS.map(p => '<th>' + esc(p[3] || p[0]) + '<br><span style="font-size:9pt;font-weight:normal;">' + esc(format12h(p[1])) + ' - ' + esc(format12h(p[2])) + '</span></th>').join('') + '</tr>';

  DAYS.forEach(day => {
    html += '<tr><td class="day-col">' + day + '</td>';
    const daySlots = entries.filter(s => s.day === day);
    const starts = {};
    daySlots.forEach(s => { starts[s.period] = s; });
    const occupied = {};

    PERIODS.forEach((p, idx) => {
      const pId = p[0];
      if (occupied[pId]) return;
      const entry = starts[pId];
      if (entry) {
        const span = Math.min(4, Math.max(1, Number(entry.duration || 1)));
        for (let i = 1; i < span; i++) {
          if (PERIODS[idx + i]) occupied[PERIODS[idx + i][0]] = true;
        }
        const cls = entry.type === 'Lab' ? 'lab-slot' : 'theory-slot';
        html += '<td colspan="' + span + '" class="' + cls + '">' + esc(entry.subject) + '<br><span style="font-size:9pt;font-weight:normal;">' + esc(entry.teacher) + ' · ' + esc(entry.room) + '</span></td>';
      } else {
        html += '<td>—</td>';
      }
    });
    html += '</tr>';
  });

  html += '</table></body></html>';
  downloadBlob(html, `EAMS-Timetable-${secName}-${state.env === 'development' ? 'DRAFT_' : 'LIVE_'}${new Date().toISOString().slice(0, 10)}.xls`, 'application/vnd.ms-excel;charset=utf-8');
  notify(`Excel timetable downloaded for ${secName}`, 'success');
}

function exportAllSectionsCSV() {
  const all = getAllClassesEntries();
  if (!all.length) return notify('No timetable records found across sections.', 'warn');
  const header = ['Section', 'Day', 'Period', '12h Time', 'Duration', 'Subject', 'Faculty', 'Room', 'Type', 'Environment'];
  const rows = [header];
  all.forEach(x => {
    rows.push([
      x.section,
      x.day,
      x.period,
      spanTimeFor(x.period, x.duration),
      x.duration || 1,
      x.subject,
      x.teacher,
      x.room,
      x.type || 'Theory',
      x.source || state.env
    ].map(v => `"${String(v || '').replace(/"/g, '""')}"`));
  });
  const csv = rows.map(r => r.join(',')).join('\r\n');
  downloadBlob(csv, `EAMS-All-Sections-Master-Timetable-${state.env === 'development' ? 'DRAFT_' : 'LIVE_'}${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
  notify(`${all.length} records exported for all sections.`, 'success');
}

function exportWorkloadCSV() {
  const entries = getAllClassesEntries();
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

  const totalFaculty = facultyMap.size;
  const totalHours = Array.from(facultyMap.values()).reduce((sum, r) => sum + r.total, 0);
  const deptAvg = totalFaculty ? (totalHours / totalFaculty).toFixed(1) : '0.0';

  const isDev = state.env === 'development';
  const watermark = isDev
    ? [
        `"EAMS FACULTY WORKLOAD REPORT — [DRAFT / UNFINALIZED]"`,
        `"Environment: DEVELOPMENT | Generated: ${new Date().toLocaleString()}"`,
        `""`
      ]
    : [
        `"EAMS FACULTY WORKLOAD REPORT — [OFFICIAL LIVE PRODUCTION]"`,
        `"Environment: PRODUCTION | Generated: ${new Date().toLocaleString()}"`,
        `""`
      ];

  const headers = ['Faculty Name', 'Total Hours/Wk', 'Theory Hours', 'Lab Hours', 'Status', 'Dept Average', 'Sections Taught', 'Courses'];
  const rows = Array.from(facultyMap.entries()).sort((a, b) => b[1].total - a[1].total).map(([name, r]) => [
    `"${name.replace(/"/g, '""')}"`,
    r.total,
    r.theory,
    r.lab,
    r.total > 18 ? 'Heavy Load (>18h)' : (r.total >= 12 ? 'Standard (12-18h)' : 'Light (<12h)'),
    deptAvg,
    `"${Array.from(r.sections).join(', ').replace(/"/g, '""')}"`,
    `"${Array.from(r.subjects).join(', ').replace(/"/g, '""')}"`
  ]);

  const csv = [...watermark, headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  downloadBlob(csv, `Faculty_Workload_Report_${isDev ? 'DRAFT_' : 'LIVE_'}${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
  notify('Faculty workload report exported.', 'success');
}

function exportSubjectDistributionCSV() {
  const entries = getAllClassesEntries();
  const subjectMap = new Map();
  entries.forEach(e => {
    const s = e.subject || 'Unassigned';
    const dur = Number(e.duration || 1);
    const isLab = e.type === 'Lab' || s.toLowerCase().includes('lab');
    if (!subjectMap.has(s)) subjectMap.set(s, { total: 0, theory: 0, lab: 0, teachers: new Set(), sections: new Set() });
    const r = subjectMap.get(s);
    r.total += dur;
    if (isLab) r.lab += dur; else r.theory += dur;
    if (e.teacher) r.teachers.add(e.teacher);
    if (e.section) r.sections.add(e.section);
  });

  const totalHours = Array.from(subjectMap.values()).reduce((sum, r) => sum + r.total, 0);

  const isDev = state.env === 'development';
  const watermark = isDev
    ? [
        `"EAMS SUBJECT DISTRIBUTION REPORT — [DRAFT / UNFINALIZED]"`,
        `"Environment: DEVELOPMENT | Generated: ${new Date().toLocaleString()}"`,
        `""`
      ]
    : [
        `"EAMS SUBJECT DISTRIBUTION REPORT — [OFFICIAL LIVE PRODUCTION]"`,
        `"Environment: PRODUCTION | Generated: ${new Date().toLocaleString()}"`,
        `""`
      ];

  const headers = ['Course Name', 'Total Hours/Wk', 'Theory Hours', 'Lab Hours', 'Theory %', 'Lab %', 'Schedule Share %', 'Faculty Assigned', 'Sections'];
  const rows = Array.from(subjectMap.entries()).sort((a, b) => b[1].total - a[1].total).map(([name, r]) => {
    const sharePct = totalHours ? ((r.total / totalHours) * 100).toFixed(1) : '0.0';
    const tPct = r.total ? Math.round((r.theory / r.total) * 100) : 100;
    const lPct = 100 - tPct;
    return [
      `"${name.replace(/"/g, '""')}"`,
      r.total,
      r.theory,
      r.lab,
      `${tPct}%`,
      `${lPct}%`,
      `${sharePct}%`,
      `"${Array.from(r.teachers).join(', ').replace(/"/g, '""')}"`,
      `"${Array.from(r.sections).join(', ').replace(/"/g, '""')}"`
    ];
  });

  const csv = [...watermark, headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  downloadBlob(csv, `Subject_Distribution_Report_${isDev ? 'DRAFT_' : 'LIVE_'}${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
  notify('Subject distribution report exported.', 'success');
}

function exportRoomUtilizationCSV() {
  const allEntries = getAllClassesEntries();
  const roomMap = new Map();
  (_masterData.rooms || []).forEach(r => {
    const key = r.hallNo || r.name;
    roomMap.set(key, {
      name: key,
      capacity: r.capacity || '—',
      building: r.buildingId?.name || r.block || 'Academic Block',
      type: r.type || (key.toLowerCase().includes('lab') ? 'Laboratory' : 'Lecture Hall'),
      hours: 0,
      sections: new Set()
    });
  });

  allEntries.forEach(e => {
    if (!e.room) return;
    if (!roomMap.has(e.room)) {
      roomMap.set(e.room, {
        name: e.room,
        capacity: '—',
        building: 'Academic Block',
        type: e.room.toLowerCase().includes('lab') ? 'Laboratory' : 'Lecture Hall',
        hours: 0,
        sections: new Set()
      });
    }
    const r = roomMap.get(e.room);
    r.hours += Number(e.duration || 1);
    if (e.section) r.sections.add(e.section);
  });

  const standardCapacity = 35;

  const isDev = state.env === 'development';
  const watermark = isDev
    ? [
        `"EAMS ROOM UTILIZATION REPORT — [DRAFT / UNFINALIZED]"`,
        `"Environment: DEVELOPMENT | Generated: ${new Date().toLocaleString()}"`,
        `""`
      ]
    : [
        `"EAMS ROOM UTILIZATION REPORT — [OFFICIAL LIVE PRODUCTION]"`,
        `"Environment: PRODUCTION | Generated: ${new Date().toLocaleString()}"`,
        `""`
      ];

  const headers = ['Room / Hall No', 'Type', 'Building', 'Seating Capacity', 'Weekly Hours Scheduled', 'Utilization % (35h Base)', 'Status', 'Utilizing Sections'];
  const rows = Array.from(roomMap.values()).sort((a, b) => b.hours - a.hours).map(r => {
    const utilPct = Math.min(100, Math.round((r.hours / standardCapacity) * 100));
    return [
      `"${r.name.replace(/"/g, '""')}"`,
      `"${r.type.replace(/"/g, '""')}"`,
      `"${r.building.replace(/"/g, '""')}"`,
      r.capacity,
      r.hours,
      `${utilPct}%`,
      utilPct > 70 ? 'High Load (>70%)' : (utilPct >= 30 ? 'Optimal (30-70%)' : 'Underutilized (<30%)'),
      `"${Array.from(r.sections).join(', ').replace(/"/g, '""')}"`
    ];
  });

  const csv = [...watermark, headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  downloadBlob(csv, `Room_Utilization_Report_${isDev ? 'DRAFT_' : 'LIVE_'}${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
  notify('Room utilization report exported.', 'success');
}

function downloadBlob(content, filename, mimeType = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Publish Workflow (Item 6: Development Save vs Production HoD Verification) ──
async function publishDraft() {
  const classId = getSelectedClassId();
  if (!classId) return notify('Please select a class/section first.', 'warn');

  if (state.draftTemplateStatus === 'pending_approval') {
    notify('This draft has been submitted for HoD verification. Redirecting to Approvals.', 'info');
    return switchTab('approvals');
  }

  if (!state.entries.length) {
    return notify('No draft exists to publish. Create or auto-generate entries first.', 'warn');
  }

  // Item 6: Prompt user for Development Draft Save vs Production HoD Verification Submission
  openSavePublishModal();
}

function openPublishWorkflowModal(preview) {
  const clientConflicts = allConflicts(state.entries);
  const serverConflicts = preview.conflicts || [];
  const conflicts = serverConflicts.length ? serverConflicts : clientConflicts.map(c => ({ kind: 'client', message: c }));
  const hasConflicts = conflicts.length > 0;

  const added = preview.diff?.added || [];
  const modified = preview.diff?.modified || [];
  const removed = preview.diff?.removed || [];
  const totalChanges = added.length + modified.length + removed.length;
  const targetVer = preview.targetVersion || ((preview.draftVersion || 1) + 1);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-bg open';
  backdrop.id = 'publish-workflow-modal';

  backdrop.innerHTML = `
    <div class="modal modal-lg" style="max-width:760px">
      <div class="modal-hd">
        <div>
          <div class="modal-eyebrow" style="color:var(--gM,#388e3c)">PRODUCTION DEPLOYMENT WORKFLOW</div>
          <h2 class="modal-title">🚀 Publish Timetable to Production</h2>
          <div class="modal-sub">
            Deploying <b>${esc(preview.className)}</b> · Draft v${preview.draftVersion} → Production v${targetVer}
          </div>
        </div>
        <button type="button" class="modal-close" id="close-publish-modal">×</button>
      </div>

      <div class="modal-body" style="padding:10px 0 16px">
        ${hasConflicts ? `
          <div class="publish-conflict-banner">
            <div class="publish-conflict-title">⚠️ Deployment Blocked: ${conflicts.length} Conflict(s) Detected</div>
            <div>All scheduling clashes must be resolved in the draft editor before deploying to live production.</div>
            <ul class="publish-conflict-list">
              ${conflicts.map(c => `<li>${esc(c.message || c)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <!-- Impact Assessment KPI Grid -->
        <div class="publish-impact-grid">
          <div class="publish-impact-card">
            <div class="publish-impact-val">${preview.stats.affectedStudentsCount}</div>
            <div class="publish-impact-lbl">Students</div>
          </div>
          <div class="publish-impact-card">
            <div class="publish-impact-val">${preview.stats.affectedTeachersCount}</div>
            <div class="publish-impact-lbl">Faculty</div>
          </div>
          <div class="publish-impact-card green">
            <div class="publish-impact-val" style="color:#16a34a">+${preview.stats.addedCount}</div>
            <div class="publish-impact-lbl">Added</div>
          </div>
          <div class="publish-impact-card amber">
            <div class="publish-impact-val" style="color:#d97706">🔄${preview.stats.modifiedCount}</div>
            <div class="publish-impact-lbl">Modified</div>
          </div>
          <div class="publish-impact-card rose">
            <div class="publish-impact-val" style="color:#dc2626">−${preview.stats.removedCount}</div>
            <div class="publish-impact-lbl">Removed</div>
          </div>
          <div class="publish-impact-card">
            <div class="publish-impact-val">${preview.stats.unchangedCount}</div>
            <div class="publish-impact-lbl">Unchanged</div>
          </div>
        </div>

        <!-- Atomic Diff Breakdown Box -->
        <div class="publish-diff-container">
          <div class="publish-diff-header">
            <div style="font-size:12px;font-weight:700;color:var(--td)">Atomic Grid Differences</div>
            <div class="publish-diff-tabs" id="diff-tabs">
              <button type="button" class="publish-diff-tab active" data-tab="all">All (${totalChanges})</button>
              <button type="button" class="publish-diff-tab" data-tab="added">➕ Added (${added.length})</button>
              <button type="button" class="publish-diff-tab" data-tab="modified">🔄 Modified (${modified.length})</button>
              <button type="button" class="publish-diff-tab" data-tab="removed">➖ Removed (${removed.length})</button>
            </div>
          </div>
          <div class="publish-diff-scroll" id="diff-scroll"></div>
        </div>

        <!-- Affected Faculty Chips -->
        ${preview.affectedTeachers && preview.affectedTeachers.length ? `
          <div class="publish-teachers-section">
            <div style="font-size:11.5px;font-weight:700;color:var(--td);text-transform:uppercase;letter-spacing:0.3px">
              Affected Faculty Members (${preview.affectedTeachers.length})
            </div>
            <div class="publish-teachers-list">
              ${preview.affectedTeachers.map(t => `
                <div class="publish-teacher-chip">
                  👤 ${esc(t.name)}
                  <span class="chip-changes">${t.totalChanges} change${t.totalChanges > 1 ? 's' : ''}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Notification Fan-Out Checkbox -->
        <div class="publish-opts-box">
          <label class="publish-notify-lbl">
            <input type="checkbox" id="publish-fanout-chk" checked>
            🔔 Fan-out notifications to ${preview.stats.affectedTeachersCount} affected faculty and ${preview.stats.affectedStudentsCount} enrolled students
          </label>
        </div>

        <!-- Release Notes / Change Summary -->
        <div class="fg" style="margin-bottom:0">
          <label class="fl" style="font-weight:600;font-size:12px;margin-bottom:4px;display:block">
            Publication Change Summary / Audit Note:
          </label>
          <input type="text" id="publish-summary-input" value="Published v${targetVer} from Development Workspace (${added.length} added, ${modified.length} modified, ${removed.length} removed)" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid var(--br);border-radius:8px;font-size:12.5px;background:var(--bg);color:var(--td)">
        </div>
      </div>

      <div class="modal-ft" style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">
        <button type="button" class="btn-out" id="cancel-publish-btn">Cancel</button>
        <button type="button" class="btn-pri" id="confirm-publish-btn" ${hasConflicts ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
          ${hasConflicts ? '⚠️ Resolve Conflicts to Publish' : 'Deploy to Production 🚀'}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  // Render Diff Rows
  function renderDiffRows(filter = 'all') {
    const container = backdrop.querySelector('#diff-scroll');
    if (!container) return;

    let rowsHtml = '';

    if (filter === 'all' || filter === 'added') {
      added.forEach(x => {
        rowsHtml += `
          <div class="publish-diff-row added">
            <span class="publish-diff-badge added">+ Added</span>
            <span class="publish-diff-slot-code">${esc(x.day)} P${x.period}</span>
            <div class="publish-diff-details">
              <b>${esc(x.subject)}</b>
              <span style="color:var(--tmu);font-size:11.5px">👤 ${esc(x.teacher || 'Unassigned')} · 📍 ${esc(x.room || 'TBA')} (${x.isLab ? 'Lab' : 'Theory'})</span>
            </div>
          </div>
        `;
      });
    }

    if (filter === 'all' || filter === 'modified') {
      modified.forEach(x => {
        const changeStr = (x.changes || []).map(ch => typeof ch === 'string' ? esc(ch) : `<b>${esc(ch.label)}:</b> ${esc(ch.from)} → ${esc(ch.to)}`).join(' · ');
        rowsHtml += `
          <div class="publish-diff-row modified">
            <span class="publish-diff-badge modified">🔄 Modified</span>
            <span class="publish-diff-slot-code">${esc(x.day)} P${x.period}</span>
            <div class="publish-diff-details">
              <b>${esc(x.after.subject)}</b>
              <span style="color:var(--tmu);font-size:11.5px">${changeStr}</span>
            </div>
          </div>
        `;
      });
    }

    if (filter === 'all' || filter === 'removed') {
      removed.forEach(x => {
        rowsHtml += `
          <div class="publish-diff-row removed">
            <span class="publish-diff-badge removed">− Removed</span>
            <span class="publish-diff-slot-code">${esc(x.day)} P${x.period}</span>
            <div class="publish-diff-details">
              <b>${esc(x.subject)}</b>
              <span style="color:var(--tmu);font-size:11.5px">👤 ${esc(x.teacher || 'Unassigned')} · 📍 ${esc(x.room || 'TBA')}</span>
            </div>
          </div>
        `;
      });
    }

    if (!rowsHtml) {
      rowsHtml = `
        <div style="text-align:center;padding:24px 16px;color:var(--tmu);font-size:12.5px">
          ℹ️ ${totalChanges === 0 ? 'Draft matches current production grid. No slot differences found.' : 'No slots match the selected diff category.'}
        </div>
      `;
    }

    container.innerHTML = rowsHtml;
  }

  renderDiffRows('all');

  // Diff Filter Tabs Handlers
  backdrop.querySelectorAll('.publish-diff-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      backdrop.querySelectorAll('.publish-diff-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderDiffRows(btn.dataset.tab);
    });
  });

  // Close handlers
  const closeModal = () => {
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 150);
  };

  backdrop.querySelector('#close-publish-modal')?.addEventListener('click', closeModal);
  backdrop.querySelector('#cancel-publish-btn')?.addEventListener('click', closeModal);

  // Deploy handler
  const confirmBtn = backdrop.querySelector('#confirm-publish-btn');
  if (confirmBtn && !hasConflicts) {
    confirmBtn.addEventListener('click', async () => {
      const summaryInput = backdrop.querySelector('#publish-summary-input');
      const fanoutChk = backdrop.querySelector('#publish-fanout-chk');

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Deploying & Broadcasting…';
      notify('Deploying timetable to production & broadcasting notifications…', 'saving');

      try {
        const result = await apiCall('POST', `/timetable/semester-templates/${state.draftTemplateId}/publish`, {
          changeSummary: summaryInput?.value?.trim() || 'Published from Development Workspace',
          notifyUsers: fanoutChk ? fanoutChk.checked : true
        });

        closeModal();

        updateWorkspaceMode('production');
        state.view = 'production';

        await loadState();
        render();

        const notifMsg = result.notifications ? ` (${result.notifications.teachersNotified || 0} teachers & ${result.notifications.studentsNotified || 0} students notified)` : '';
        notify(`🚀 Timetable v${result.data?.version || targetVer} successfully published to Live Production!${notifMsg}`, 'success');
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Deploy to Production 🚀';
        notify('Publish failed: ' + err.message, 'error');
      }
    });
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
  markCurrentTabDirty();
  await persistState();
  render();
  notify('Draft reset to production snapshot.', 'info');
}

// ── Version History & Snapshot Restore (Item 1) ──
async function loadVersions() {
  try {
    state.loadingVersions = true;
    state.loading = true;
    setLiveSyncStatus('loading', 'Loading..');
    const classId = getSelectedClassId();
    const track = state.historyTrack || 'production';
    const params = new URLSearchParams();
    if (classId) params.set('classId', classId);
    params.set('type', track);
    const url = `/timetable/versions?${params.toString()}`;
    const data = await apiCall('GET', url);
    state.versions = Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Failed to load timetable versions:', err);
    state.versions = [];
  } finally {
    state.loadingVersions = false;
    state.loading = false;
  }
}

async function restoreVersion(vId) {
  const v = (state.versions || []).find(x => String(x._id) === String(vId));
  if (!v) return notify('Version record not found.', 'warn');

  const verLabel = v.label || (`v${v.snapshot?.version || 1}`);
  const clsName = v.className || (v.snapshot?.className) || state.filterSection || 'Class';

  const confirmed = await confirmModal({
    title: 'Restore Timetable Version',
    eyebrow: 'RESTORE VERSION SNAPSHOT',
    icon: '⏮️',
    message: `Restore version ${verLabel} for ${clsName} into Draft Editor?`,
    hint: 'This will archive the current working draft and restore this historical snapshot as the active draft.',
    confirmText: 'Restore as Draft',
    confirmClass: 'btn-pri'
  });
  if (!confirmed) return;

  notify(`Restoring version ${verLabel}…`, 'saving');
  try {
    await apiCall('POST', `/timetable/versions/${vId}/restore`);
    notify(`Version ${verLabel} restored as new draft!`, 'success');

    // Switch to development mode & editor view
    updateWorkspaceMode('development');
    state.view = 'editor';

    // Reload state and render
    await loadState();
    render();
  } catch (err) {
    notify('Failed to restore version: ' + err.message, 'error');
  }
}

function inspectVersion(vId) {
  const v = (state.versions || []).find(x => String(x._id) === String(vId));
  if (!v) return;

  const verLabel = v.label || (`v${v.snapshot?.version || 1}`);
  const gridSlots = v.snapshot?.grid || [];
  const pubDate = v.publishedAt || v.createdAt;
  const dateStr = pubDate ? new Date(pubDate).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const clsName = v.className || (v.snapshot?.className) || state.filterSection || 'Class';

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-bg open';
  backdrop.id = 'inspect-version-modal';
  backdrop.innerHTML = `<div class="modal modal-lg" style="max-width:840px;">
    <div class="modal-hd">
      <div>
        <span class="modal-eyebrow">VERSION SNAPSHOT</span>
        <h2 class="modal-title">${esc(verLabel)} — ${esc(clsName)}</h2>
        <div class="modal-sub">Published by <b>${esc(v.publishedBy || 'Coordinator')}</b> on ${esc(dateStr)} · ${gridSlots.length} active slots</div>
      </div>
      <button type="button" class="modal-close close-inspect-modal">&times;</button>
    </div>
    <div class="modal-body" style="max-height:60vh;overflow-y:auto;padding:16px;">
      ${!gridSlots.length ? '<p style="text-align:center;color:var(--tmu);padding:24px;">No slot records stored in this snapshot.</p>' : `
        <table class="table" style="font-size:12px;">
          <thead>
            <tr>
              <th>Day</th>
              <th>Period</th>
              <th>Subject</th>
              <th>Faculty</th>
              <th>Room</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            ${gridSlots.map(s => `<tr>
              <td><b>${esc(s.day || '—')}</b></td>
              <td><span class="pill" style="font-size:11px;">P${s.period}${s.span > 1 ? `–${s.period + s.span - 1}` : ''}</span></td>
              <td><b>${esc(s.subject || s.subjectName || '—')}</b></td>
              <td>${esc(s.teacher || s.staffName || '—')}</td>
              <td><span class="pill" style="font-size:11px;">${esc(s.room || s.hallNo || '—')}</span></td>
              <td><span class="pill ${s.isLab ? 'warn' : ''}" style="font-size:10px;">${s.isLab ? 'Lab' : 'Theory'}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      `}
    </div>
    <div class="modal-ft" style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:12px;color:var(--tmu);">Change Note: ${esc(v.changeSummary || 'None')}</span>
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn-out close-inspect-modal">Close</button>
        <button type="button" class="btn-pri" id="restore-from-inspect">↺ Restore this Version to Draft</button>
      </div>
    </div>
  </div>`;

  document.body.appendChild(backdrop);

  const cleanup = () => {
    backdrop.remove();
  };
  backdrop.querySelectorAll('.close-inspect-modal').forEach(b => b.addEventListener('click', cleanup));
  backdrop.addEventListener('click', e => { if (e.target === backdrop) cleanup(); });
  backdrop.querySelector('#restore-from-inspect')?.addEventListener('click', async () => {
    cleanup();
    await restoreVersion(vId);
  });
}

// ── Class Attendance Analytics (Item 3) ──
async function loadAttendanceInsights() {
  try {
    state.loadingAttendance = true;
    state.loading = true;
    setLiveSyncStatus('loading', 'Loading..');
    const classId = getSelectedClassId() || state.filterSection;
    let url = `/timetable/class-attendance-analytics?days=${state.attendanceRange || 30}`;
    if (classId) url += `&classId=${encodeURIComponent(classId)}`;
    if (state.attendanceSubject) url += `&subjectId=${encodeURIComponent(state.attendanceSubject)}`;
    const res = await apiCall('GET', url);
    state.attendanceInsights = res.data || null;
  } catch (err) {
    console.error('Failed to load class attendance analytics:', err);
    state.attendanceInsights = null;
  } finally {
    state.loadingAttendance = false;
    state.loading = false;
  }
}

function exportAttendanceCSV() {
  const d = state.attendanceInsights;
  if (!d || !d.studentSummary || !d.studentSummary.length) {
    return notify('No attendance data available to export.', 'warn');
  }

  const clsName = d.classInfo.name || state.filterSection || 'Class';
  const days = d.timeframeDays || 30;

  const headers = ['Register No', 'Student Name', 'Roll No', 'Sessions Held', 'Sessions Attended', 'Attendance Percentage', 'Status'];
  const rows = d.studentSummary.map(s => [
    `"${(s.regNo || '').replace(/"/g, '""')}"`,
    `"${(s.name || '').replace(/"/g, '""')}"`,
    `"${(s.rollNo || '').replace(/"/g, '""')}"`,
    s.held,
    s.attended,
    `${s.percentage}%`,
    s.status === 'good' ? 'Good (>=85%)' : (s.status === 'warning' ? 'Warning (75-84%)' : 'Defaulter (<75%)')
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Attendance_Report_${clsName}_${days}D_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  notify('Student attendance report exported successfully.', 'success');
}

// ── Configurable Auto-Generation Engine (Item 5) ──
async function openAutoGenerateModal() {
  if (state.env !== 'development') {
    updateWorkspaceMode('development');
    notify('Switched to Development mode to configure auto-generation.', 'info');
  }

  const currentSection = state.filterSection || (SECTIONS[0] || 'Section A');
  const classId = getSelectedClassId();

  // 1. Compute faculty workload across all assigned slots (Item 3)
  const facultyLoadMap = {};
  TEACHERS.forEach(t => { facultyLoadMap[t] = 0; });
  (state.entries || []).concat(state.production || []).forEach(e => {
    if (e.teacher) {
      facultyLoadMap[e.teacher] = (facultyLoadMap[e.teacher] || 0) + Number(e.duration || 1);
    }
  });

  // Sort teachers ascending by workload: least workload staff at top!
  const sortedTeachers = [...TEACHERS].sort((a, b) => (facultyLoadMap[a] || 0) - (facultyLoadMap[b] || 0));

  const renderTeacherOptions = (selectedTeacher) => {
    return sortedTeachers.map(t => {
      const load = facultyLoadMap[t] || 0;
      const badge = load === 0 ? '0h · Free' : load < 6 ? `${load}h · Light` : load < 14 ? `${load}h · Normal` : `${load}h · Heavy`;
      return `<option value="${esc(t)}" ${t === selectedTeacher ? 'selected' : ''}>👤 ${esc(t)} (${badge})</option>`;
    }).join('');
  };

  // 2. Initial candidate subjects for this class following Assign Staff & Hall method (Change 6)
  let classAssignments = [];
  if (classId) {
    try {
      classAssignments = await apiCall('GET', `/assignments?classId=${classId}`);
    } catch (_) { classAssignments = []; }
  }

  const currentClassObj = (_masterData.classes || []).find(c => String(c._id) === String(classId) || c.name === currentSection);
  let srcSubjects = (_masterData.subjects && _masterData.subjects.length) ? _masterData.subjects : SUBJECTS.map(s => ({ name: s }));
  if (currentClassObj && currentClassObj.deptId) {
    const cDept = String(currentClassObj.deptId?._id || currentClassObj.deptId);
    const filtered = srcSubjects.filter(s => String(s.deptId?._id || s.deptId) === cDept);
    if (filtered.length) srcSubjects = filtered;
  }

  let candidateRows = [];
  srcSubjects.forEach((sub, i) => {
    const sName = sub.name || sub;
    const isLab = (sub.type === 'Lab') || sName.toLowerCase().includes('lab');
    const assigned = (classAssignments || []).find(a =>
      (sub._id && String(a.subjectId) === String(sub._id)) ||
      (a.subjectName && a.subjectName.toLowerCase() === sName.toLowerCase())
    );
    const teacher = (assigned && assigned.teacherName) ? assigned.teacherName : (sortedTeachers[i % sortedTeachers.length] || 'Faculty Member');
    const room = (assigned && assigned.hallNo) ? assigned.hallNo : (ROOMS[i % ROOMS.length] || 'Classroom');
    candidateRows.push({
      subject: sName,
      subjectId: sub._id,
      teacher,
      room,
      periodsPerWeek: isLab ? 3 : 4,
      isLab,
      span: isLab ? 3 : 1,
      selected: Boolean(assigned) || (i < 6)
    });
  });

  // Teacher preferences state: Map of teacherName -> Set of "Day:Period"
  const teacherPrefs = {};

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-bg open';
  backdrop.id = 'autogen-modal';

  backdrop.innerHTML = `<div class="modal modal-lg" style="max-width:800px">
    <div class="modal-hd">
      <div>
        <div class="modal-eyebrow">ALGORITHMIC SCHEDULER · GREEDY CONSTRAINT ENGINE</div>
        <h2 class="modal-title">⚡ Auto-Generate Timetable Draft</h2>
        <div class="modal-sub">Select subjects, configure weekly hours, and allocate faculty based on workload for <b>${esc(currentSection)}</b></div>
      </div>
      <button type="button" class="modal-close" id="close-autogen-modal">×</button>
    </div>

    <!-- Navigation Tabs: Tab 1 is Subject & Workload Selection per Requirement 3 -->
    <div class="gen-tabs">
      <button type="button" class="gen-tab-btn active" data-tab="workload">📚 Select Subjects &amp; Workload (${candidateRows.length})</button>
      <button type="button" class="gen-tab-btn" data-tab="constraints">⚙️ Rules &amp; Constraints</button>
      <button type="button" class="gen-tab-btn" data-tab="teachers">👤 Faculty Restrictions</button>
    </div>

    <div class="modal-body" style="padding:4px 0 16px">
      <!-- TAB 1: Subject Selection & Workload Allocation (Active by Default) -->
      <div class="gen-tab-pane active" id="gen-pane-workload">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-size:12px;color:var(--tmu)">Select subjects for <b>${esc(currentSection)}</b>, set hours/week, and assign staff (sorted with least busy faculty first):</div>
          <button type="button" class="btn-out" id="gen-add-subject-row" style="font-size:11.5px;padding:4px 10px">+ Add Subject</button>
        </div>
        <div style="max-height:300px;overflow-y:auto;border:1px solid var(--br);border-radius:10px">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead style="background:var(--gP);position:sticky;top:0;z-index:2">
              <tr style="text-align:left;border-bottom:1px solid var(--br)">
                <th style="padding:8px 10px;width:40px;text-align:center">Select</th>
                <th style="padding:8px 10px">Subject Name</th>
                <th style="padding:8px 10px">Assigned Faculty (Low Workload First)</th>
                <th style="padding:8px 10px;width:120px">Room / Lab</th>
                <th style="padding:8px 10px;width:75px">Hrs/Wk</th>
                <th style="padding:8px 10px;width:55px;text-align:center">Lab?</th>
                <th style="padding:8px 10px;width:35px"></th>
              </tr>
            </thead>
            <tbody id="gen-workload-tbody">
              ${candidateRows.map((r, idx) => `
                <tr style="border-bottom:1px solid var(--br)" data-row-idx="${idx}">
                  <td style="padding:6px 10px;text-align:center">
                    <input type="checkbox" class="sub-select-chk" ${r.selected ? 'checked' : ''} title="Include this subject in timetable generation">
                  </td>
                  <td style="padding:6px 10px">
                    <input type="text" class="sub-name" value="${esc(r.subject)}" style="width:100%;padding:4px 8px;border:1px solid var(--br);border-radius:6px;font-size:12px">
                  </td>
                  <td style="padding:6px 10px">
                    <select class="sub-teacher" style="width:100%;padding:4px;border:1px solid var(--br);border-radius:6px;font-size:11.5px">
                      ${renderTeacherOptions(r.teacher)}
                    </select>
                  </td>
                  <td style="padding:6px 10px">
                    <select class="sub-room" style="width:100%;padding:4px;border:1px solid var(--br);border-radius:6px;font-size:11.5px">
                      ${ROOMS.map(rm => `<option value="${esc(rm)}" ${rm === r.room ? 'selected' : ''}>${esc(rm)}</option>`).join('')}
                    </select>
                  </td>
                  <td style="padding:6px 10px">
                    <input type="number" class="sub-hours" min="1" max="10" value="${r.periodsPerWeek}" style="width:100%;padding:4px;border:1px solid var(--br);border-radius:6px;font-size:12px" title="Hours per week">
                  </td>
                  <td style="padding:6px 10px;text-align:center">
                    <input type="checkbox" class="sub-islab" ${r.isLab ? 'checked' : ''}>
                  </td>
                  <td style="padding:6px 10px;text-align:center">
                    <button type="button" class="del-row-btn" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px">✕</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- TAB 2: Rules & Constraints -->
      <div class="gen-tab-pane" id="gen-pane-constraints">
        <div class="form-grid" style="margin-bottom:16px">
          <div>
            <label>Maximum Classes / Day per Faculty
              <input type="number" id="gen-max-classes" min="1" max="6" value="3" style="width:100%">
            </label>
            <div style="font-size:11px;color:var(--tmu);margin-top:3px">Caps daily load to prevent teacher fatigue.</div>
          </div>
          <div>
            <label>Draft Placement Strategy
              <select id="gen-strategy" style="width:100%">
                <option value="replace">Replace existing draft for ${esc(currentSection)}</option>
                <option value="merge">Merge with existing draft (fill free slots)</option>
              </select>
            </label>
            <div style="font-size:11px;color:var(--tmu);margin-top:3px">Choose whether to overwrite or complement current slots.</div>
          </div>
        </div>

        <div style="margin-bottom:16px">
          <div style="font-size:12px;font-weight:700;color:var(--td);margin-bottom:8px">Active Teaching Days:</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px">
            ${DAYS.map(day => `
              <label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;padding:6px 12px;border-radius:8px;border:1px solid var(--br);background:var(--gP);cursor:pointer">
                <input type="checkbox" class="gen-day-chk" value="${esc(day)}" ${day !== 'Saturday' ? 'checked' : ''}>
                <span>${esc(day)}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;padding:12px 14px;background:var(--gP,#f4f7f4);border-radius:12px;border:1px solid var(--br)">
          <label style="display:flex;align-items:center;gap:10px;font-size:12.5px;font-weight:600;cursor:pointer">
            <input type="checkbox" id="gen-no-labs-p1" checked>
            <span>No Practical / Lab in Period 1 (Keep morning slot for core theory)</span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;font-size:12.5px;font-weight:600;cursor:pointer">
            <input type="checkbox" id="gen-avoid-b2b-labs" checked>
            <span>Avoid Back-to-Back Labs (Spread practical laboratory sessions across different days)</span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;font-size:12.5px;font-weight:600;cursor:pointer">
            <input type="checkbox" id="gen-even-load" checked>
            <span>Even Subject Load Distribution (Evenly disperse course hours throughout the week)</span>
          </label>
        </div>
      </div>

      <!-- TAB 3: Faculty Availability -->
      <div class="gen-tab-pane" id="gen-pane-teachers">
        <div style="font-size:12px;color:var(--tmu);margin-bottom:12px">
          Specify unavailable periods or preferences for faculty members (e.g. administrative duties, research blocks).
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:14px;padding:12px;background:var(--gP);border-radius:12px;border:1px solid var(--br)">
          <div style="flex:1;min-width:180px">
            <label style="font-size:11.5px;font-weight:600;display:block;margin-bottom:4px">Faculty Member</label>
            <select id="gen-pref-teacher" style="width:100%;height:36px;border-radius:8px;border:1px solid var(--br);padding:0 8px;font-size:12.5px">
              ${renderTeacherOptions(sortedTeachers[0])}
            </select>
          </div>
          <div style="width:130px">
            <label style="font-size:11.5px;font-weight:600;display:block;margin-bottom:4px">Day</label>
            <select id="gen-pref-day" style="width:100%;height:36px;border-radius:8px;border:1px solid var(--br);padding:0 8px;font-size:12.5px">
              ${DAYS.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}
            </select>
          </div>
          <div style="width:130px">
            <label style="font-size:11.5px;font-weight:600;display:block;margin-bottom:4px">Period</label>
            <select id="gen-pref-period" style="width:100%;height:36px;border-radius:8px;border:1px solid var(--br);padding:0 8px;font-size:12.5px">
              ${PERIODS.map(p => `<option value="${esc(p[0])}">${esc(p[0])} (${esc(p[1])})</option>`).join('')}
            </select>
          </div>
          <button type="button" class="btn-out" id="gen-add-pref-btn" style="height:36px;padding:0 14px">+ Add Restriction</button>
        </div>

        <div id="gen-prefs-container" style="min-height:80px;display:flex;flex-wrap:wrap;gap:8px;padding:10px;border:1.5px dashed var(--br);border-radius:10px;background:#fafafa">
          <div style="font-size:12px;color:var(--tmu);width:100%;text-align:center;padding:12px 0" id="gen-prefs-empty">No faculty restrictions added. All faculty are considered available during teaching hours.</div>
        </div>
      </div>
    </div>

    <div class="modal-ft">
      <button type="button" class="btn-out" id="cancel-autogen-modal">Cancel</button>
      <button type="button" class="btn-pri" id="run-autogen-btn">⚡ Run Auto-Generator</button>
    </div>
  </div>`;

  document.body.appendChild(backdrop);

  // Tab switching
  backdrop.querySelectorAll('.gen-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      backdrop.querySelectorAll('.gen-tab-btn').forEach(b => b.classList.remove('active'));
      backdrop.querySelectorAll('.gen-tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = backdrop.querySelector('#gen-pane-' + btn.dataset.tab);
      if (pane) pane.classList.add('active');
    });
  });

  // Render teacher preference chips
  function renderPrefChips() {
    const container = backdrop.querySelector('#gen-prefs-container');
    const emptyMsg = backdrop.querySelector('#gen-prefs-empty');
    if (!container) return;

    const chips = [];
    Object.entries(teacherPrefs).forEach(([tName, slots]) => {
      slots.forEach(slot => {
        chips.push({ teacher: tName, slot });
      });
    });

    if (!chips.length) {
      if (emptyMsg) emptyMsg.style.display = 'block';
      container.innerHTML = '<div style="font-size:12px;color:var(--tmu);width:100%;text-align:center;padding:12px 0" id="gen-prefs-empty">No faculty restrictions added. All faculty are considered available during teaching hours.</div>';
      return;
    }

    container.innerHTML = chips.map(c => `
      <span class="gen-chip">
        <span>👤 <b>${esc(c.teacher)}</b>: ${esc(c.slot)}</span>
        <span class="gen-chip-del" data-teacher="${esc(c.teacher)}" data-slot="${esc(c.slot)}">✕</span>
      </span>
    `).join('');

    container.querySelectorAll('.gen-chip-del').forEach(del => {
      del.addEventListener('click', () => {
        const t = del.dataset.teacher;
        const s = del.dataset.slot;
        if (teacherPrefs[t]) {
          teacherPrefs[t].delete(s);
          if (teacherPrefs[t].size === 0) delete teacherPrefs[t];
        }
        renderPrefChips();
      });
    });
  }

  backdrop.querySelector('#gen-add-pref-btn')?.addEventListener('click', () => {
    const t = backdrop.querySelector('#gen-pref-teacher')?.value;
    const d = backdrop.querySelector('#gen-pref-day')?.value;
    const p = backdrop.querySelector('#gen-pref-period')?.value;
    if (!t || !d || !p) return;
    const slotKey = `${d}:${parseInt(p.replace(/\D/g, ''), 10) || 1}`;
    if (!teacherPrefs[t]) teacherPrefs[t] = new Set();
    teacherPrefs[t].add(slotKey);
    renderPrefChips();
  });

  // Workload table row management
  const tbody = backdrop.querySelector('#gen-workload-tbody');
  tbody?.addEventListener('click', e => {
    if (e.target.classList.contains('del-row-btn')) {
      const tr = e.target.closest('tr');
      if (tr) tr.remove();
    }
  });

  backdrop.querySelector('#gen-add-subject-row')?.addEventListener('click', () => {
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--br)';
    tr.innerHTML = `
      <td style="padding:6px 10px;text-align:center">
        <input type="checkbox" class="sub-select-chk" checked title="Include this subject">
      </td>
      <td style="padding:6px 10px">
        <input type="text" class="sub-name" placeholder="Subject Name" value="" style="width:100%;padding:4px 8px;border:1px solid var(--br);border-radius:6px;font-size:12px">
      </td>
      <td style="padding:6px 10px">
        <select class="sub-teacher" style="width:100%;padding:4px;border:1px solid var(--br);border-radius:6px;font-size:11.5px">
          ${renderTeacherOptions(sortedTeachers[0])}
        </select>
      </td>
      <td style="padding:6px 10px">
        <select class="sub-room" style="width:100%;padding:4px;border:1px solid var(--br);border-radius:6px;font-size:11.5px">
          ${ROOMS.map(rm => `<option value="${esc(rm)}">${esc(rm)}</option>`).join('')}
        </select>
      </td>
      <td style="padding:6px 10px">
        <input type="number" class="sub-hours" min="1" max="10" value="4" style="width:100%;padding:4px;border:1px solid var(--br);border-radius:6px;font-size:12px">
      </td>
      <td style="padding:6px 10px;text-align:center">
        <input type="checkbox" class="sub-islab">
      </td>
      <td style="padding:6px 10px;text-align:center">
        <button type="button" class="del-row-btn" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Modal close handlers
  const cleanup = () => backdrop.remove();
  backdrop.querySelector('#close-autogen-modal')?.addEventListener('click', cleanup);
  backdrop.querySelector('#cancel-autogen-modal')?.addEventListener('click', cleanup);

  // Run generator action
  backdrop.querySelector('#run-autogen-btn')?.addEventListener('click', async () => {
    const runBtn = backdrop.querySelector('#run-autogen-btn');
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = 'Calculating optimal schedule…';
    }

    try {
      const maxClassesPerDayPerTeacher = parseInt(backdrop.querySelector('#gen-max-classes')?.value, 10) || 3;
      const strategy = backdrop.querySelector('#gen-strategy')?.value || 'replace';
      const noLabsPeriod1 = backdrop.querySelector('#gen-no-labs-p1')?.checked !== false;
      const avoidBackToBackLabs = backdrop.querySelector('#gen-avoid-b2b-labs')?.checked !== false;
      const evenLoadDistribution = backdrop.querySelector('#gen-even-load')?.checked !== false;

      const workingDays = Array.from(backdrop.querySelectorAll('.gen-day-chk:checked')).map(cb => cb.value);
      if (!workingDays.length) {
        notify('Please select at least one teaching day.', 'warn');
        if (runBtn) { runBtn.disabled = false; runBtn.textContent = '⚡ Run Auto-Generator'; }
        return;
      }

      // Convert teacher preferences map to serializable object
      const formattedTeacherPrefs = {};
      Object.entries(teacherPrefs).forEach(([t, slots]) => {
        formattedTeacherPrefs[t] = { unavailableSlots: Array.from(slots) };
      });

      // Harvest ONLY selected subject rows per Requirement 3
      const assignments = [];
      backdrop.querySelectorAll('#gen-workload-tbody tr').forEach(tr => {
        const isSelected = tr.querySelector('.sub-select-chk')?.checked;
        if (!isSelected) return;
        const name = tr.querySelector('.sub-name')?.value.trim();
        if (!name) return;
        const teacher = tr.querySelector('.sub-teacher')?.value;
        const room = tr.querySelector('.sub-room')?.value;
        const periodsPerWeek = parseInt(tr.querySelector('.sub-hours')?.value, 10) || 4;
        const isLab = Boolean(tr.querySelector('.sub-islab')?.checked);

        assignments.push({
          subjectShortName: name,
          name,
          staffName: teacher,
          room: room || 'Classroom',
          periodsPerWeek,
          isLab,
          span: isLab ? 3 : 1,
          section: currentSection
        });
      });

      if (!assignments.length) {
        notify(`Please select at least one subject for ${currentSection} to auto-generate.`, 'warn');
        if (runBtn) { runBtn.disabled = false; runBtn.textContent = '⚡ Run Auto-Generator'; }
        return;
      }

      // Existing slots to avoid clashing if merge strategy
      const existingSlots = strategy === 'merge' ? state.entries.filter(e => e.section === currentSection) : [];
      const breakPeriods = Array.from(BREAK_PERIODS).map(p => parseInt(String(p).replace(/\D/g, ''), 10)).filter(Boolean);

      notify('Running greedy constraint solver…', 'saving');
      const result = await apiCall('POST', '/timetable/auto-gen', {
        classId,
        section: currentSection,
        workingDays,
        constraints: {
          maxClassesPerDayPerTeacher,
          noLabsPeriod1,
          avoidBackToBackLabs,
          evenLoadDistribution,
          teacherPreferences: formattedTeacherPrefs
        },
        assignments,
        existingSlots,
        breakPeriods
      });

      cleanup();
      openGeneratorPreview(result, strategy);
    } catch (err) {
      notify('Auto-generation failed: ' + err.message, 'error');
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = '⚡ Run Auto-Generator';
      }
    }
  });
}

function openGeneratorPreview(result, strategy = 'replace') {
  if (!result || !Array.isArray(result.grid)) {
    return notify('Invalid generator output.', 'error');
  }

  const grid = result.grid;
  const conflicts = result.conflicts || [];
  const applied = result.appliedConstraints || {};

  // Track selection state: default all true
  const selectedIndices = new Set(grid.map((_, i) => i));

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-bg open';
  backdrop.id = 'generator-review';

  backdrop.innerHTML = `<div class="modal modal-lg" style="max-width:740px">
    <div class="modal-hd">
      <div>
        <div class="modal-eyebrow">AUTO-GENERATION REVIEW · GREEDY ALGORITHM</div>
        <h2 class="modal-title">Review & Apply Generated Slots</h2>
        <div class="modal-sub">
          <b>${grid.length}</b> slots generated · <b>${conflicts.length}</b> constraint notice(s) · Section: <b>${esc(state.filterSection || 'Current')}</b>
        </div>
      </div>
      <button type="button" class="modal-close close-generator">×</button>
    </div>

    <div class="modal-body" style="padding:6px 0 16px">
      <!-- Applied constraints summary pills -->
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
        <span style="font-size:11px;padding:3px 8px;border-radius:12px;background:var(--gLt);color:var(--gM);font-weight:600">
          Max ${applied.maxClassesPerDayPerTeacher || 3} classes/day/teacher
        </span>
        <span style="font-size:11px;padding:3px 8px;border-radius:12px;background:var(--gLt);color:var(--gM);font-weight:600">
          No Labs P1: ${applied.noLabsPeriod1 !== false ? 'Active' : 'Off'}
        </span>
        <span style="font-size:11px;padding:3px 8px;border-radius:12px;background:var(--gLt);color:var(--gM);font-weight:600">
          Even Load: ${applied.evenLoadDistribution !== false ? 'Active' : 'Off'}
        </span>
        <span style="font-size:11px;padding:3px 8px;border-radius:12px;background:var(--gLt);color:var(--gM);font-weight:600">
          Mode: ${strategy === 'replace' ? 'Replace Draft' : 'Merge Draft'}
        </span>
      </div>

      <!-- Conflicts Alert Box if any -->
      ${conflicts.length ? `
        <div class="gen-conflict-box">
          <div style="font-weight:700;margin-bottom:4px">⚠️ Constraint Notice (${conflicts.length} unplaced item${conflicts.length > 1 ? 's' : ''}):</div>
          ${conflicts.map(c => `
            <div style="margin-top:3px">• <b>${esc(c.title || c.subject || 'Notice')}</b>: ${esc(c.detail || '')} <i style="color:#64748b">(${esc(c.fix || 'No action needed')})</i></div>
          `).join('')}
        </div>
      ` : `
        <div style="color:var(--success,#16a34a);font-size:12.5px;margin-bottom:12px;font-weight:600;display:flex;align-items:center;gap:6px">
          <span>✓</span> All requested curriculum subjects allocated with zero clashes.
        </div>
      `}

      <!-- Master selection toolbar -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f8fafc;border:1px solid var(--br);border-radius:8px;margin-bottom:10px;font-size:12px">
        <label style="display:inline-flex;align-items:center;gap:8px;font-weight:600;cursor:pointer">
          <input type="checkbox" id="gen-master-toggle" checked>
          <span>Select All / Deselect All</span>
        </label>
        <span style="color:var(--tmu)">Selected: <b id="gen-selected-count" style="color:var(--gM)">${grid.length}</b> / ${grid.length} slots</span>
      </div>

      <!-- Scrollable Slot Checklist -->
      <div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:6px" id="gen-slot-list">
        ${grid.map((x, i) => {
          const periodCode = typeof x.period === 'number' ? `P${x.period}` : x.period;
          const pLabel = timeFor(periodCode);
          return `
            <div class="gen-slot-row" data-idx="${i}">
              <div style="display:flex;align-items:center;gap:12px">
                <input type="checkbox" class="gen-slot-chk" data-idx="${i}" checked style="cursor:pointer">
                <div>
                  <b style="color:var(--td)">${esc(x.day)} · ${esc(periodCode)}</b>
                  <span style="color:var(--tmu);font-size:11.5px;margin-left:4px">(${esc(pLabel)})</span>
                  <div style="margin-top:2px">
                    <span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10.5px;font-weight:600;background:${x.isLab ? 'rgba(217,119,6,0.1)' : 'rgba(27,94,32,0.1)'};color:${x.isLab ? '#d97706' : '#1b5e20'}">
                      ${x.isLab ? `Lab (${x.span || 3} periods)` : 'Theory'}
                    </span>
                    <b style="margin-left:4px;color:var(--td)">${esc(x.subject)}</b>
                  </div>
                </div>
              </div>
              <div style="text-align:right;font-size:11.5px;color:var(--tmu)">
                <div>👤 ${esc(x.teacher)}</div>
                <div style="margin-top:2px">📍 ${esc(x.room)}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <div class="modal-ft">
      <button type="button" class="btn-out" id="cancel-generator">Reject & Cancel</button>
      <button type="button" class="btn-pri" id="apply-generator">Apply Selected Slots (${grid.length}) to Draft</button>
    </div>
  </div>`;

  document.body.appendChild(backdrop);

  // Close handlers
  backdrop.querySelector('.close-generator').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('#cancel-generator').addEventListener('click', () => backdrop.remove());

  // Individual checkbox toggles
  const updateSelectionUI = () => {
    const selCountEl = backdrop.querySelector('#gen-selected-count');
    const applyBtn = backdrop.querySelector('#apply-generator');
    const masterToggle = backdrop.querySelector('#gen-master-toggle');

    if (selCountEl) selCountEl.textContent = selectedIndices.size;
    if (applyBtn) {
      applyBtn.textContent = `Apply Selected Slots (${selectedIndices.size}) to Draft`;
      applyBtn.disabled = selectedIndices.size === 0;
    }
    if (masterToggle) {
      masterToggle.checked = selectedIndices.size === grid.length;
      masterToggle.indeterminate = selectedIndices.size > 0 && selectedIndices.size < grid.length;
    }
  };

  backdrop.querySelectorAll('.gen-slot-chk').forEach(chk => {
    chk.addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const row = backdrop.querySelector(`.gen-slot-row[data-idx="${idx}"]`);
      if (e.target.checked) {
        selectedIndices.add(idx);
        row?.classList.remove('excluded');
      } else {
        selectedIndices.delete(idx);
        row?.classList.add('excluded');
      }
      updateSelectionUI();
    });
  });

  // Master checkbox toggle
  backdrop.querySelector('#gen-master-toggle')?.addEventListener('change', e => {
    const checked = e.target.checked;
    selectedIndices.clear();
    backdrop.querySelectorAll('.gen-slot-chk').forEach(chk => {
      chk.checked = checked;
      const idx = parseInt(chk.dataset.idx, 10);
      const row = backdrop.querySelector(`.gen-slot-row[data-idx="${idx}"]`);
      if (checked) {
        selectedIndices.add(idx);
        row?.classList.remove('excluded');
      } else {
        row?.classList.add('excluded');
      }
    });
    updateSelectionUI();
  });

  // Apply to draft action
  backdrop.querySelector('#apply-generator')?.addEventListener('click', async () => {
    const selectedSlots = grid.filter((_, i) => selectedIndices.has(i));
    if (!selectedSlots.length) {
      return notify('Please select at least one slot to apply.', 'warn');
    }

    const newEntries = flattenGrid(selectedSlots);
    recordHistory(`Auto-generate ${newEntries.length} slots (${strategy})`);

    if (strategy === 'replace') {
      const currentSection = state.filterSection;
      state.entries = state.entries.filter(e => e.section !== currentSection).concat(newEntries);
    } else {
      state.entries = [...state.entries, ...newEntries];
    }

    markCurrentTabDirty();
    backdrop.remove();
    render();
    persistState();
    notify(`Applied ${newEntries.length} auto-generated slots to draft for ${state.filterSection || 'section'}.`, 'success');
  });
}

// ── Drag & Drop Rescheduling (Item 10: Swaps, Pre-Drop Conflict Dialog, Resize, Duplicate Day) ──
async function moveEntryTo(id, day, period, copy) {
  if (isReadOnlyMode()) {
    return notify('Timetable is currently read-only.', 'warn');
  }
  const source = state.entries.find(x => x.id === id);
  if (!source) return notify('Entry no longer exists.', 'warn');

  // If dropped on its own slot, do nothing
  if (source.day === day && source.period === period) return;

  const currentSection = state.filterSection || source.section;
  const targetOccupant = state.entries.find(x =>
    x.day === day &&
    x.period === period &&
    x.id !== source.id &&
    (!currentSection || x.section === currentSection)
  );

  // CASE 1: Slot Swap (dropping on an already-occupied slot without holding Ctrl/copy)
  if (targetOccupant && !copy) {
    const candidateSource = { ...source, day, period, section: currentSection };
    const candidateTarget = { ...targetOccupant, day: source.day, period: source.period, section: currentSection };

    const remaining = state.entries.filter(x => x.id !== source.id && x.id !== targetOccupant.id);
    const errorsSource = conflictsFor(candidateSource, [...remaining, candidateTarget], source.id);
    const errorsTarget = conflictsFor(candidateTarget, [...remaining, candidateSource], targetOccupant.id);
    const swapErrors = [...errorsSource, ...errorsTarget];

    if (swapErrors.length) {
      return openPreDropConflictDialog({
        type: 'swap',
        source,
        target: targetOccupant,
        candidateSource,
        candidateTarget,
        errors: swapErrors
      });
    }

    recordHistory(`Swap ${source.subject} & ${targetOccupant.subject}`);
    state.entries = state.entries.map(x => {
      if (x.id === source.id) return candidateSource;
      if (x.id === targetOccupant.id) return candidateTarget;
      return x;
    });

    markCurrentTabDirty();
    render();
    persistState();
    return;
  }

  // CASE 2: Move or Copy to empty cell
  const candidate = { ...source, id: copy ? uid() : source.id, day, period, section: currentSection };
  const errors = conflictsFor(candidate, state.entries, copy ? null : source.id);

  if (errors.length) {
    return openPreDropConflictDialog({
      type: copy ? 'copy' : 'move',
      source,
      candidate,
      errors
    });
  }

  recordHistory(copy ? `Duplicate ${source.subject}` : `Move ${source.subject}`);
  if (copy) state.entries.push(candidate);
  else state.entries = state.entries.map(x => x.id === source.id ? candidate : x);

  markCurrentTabDirty();
  render();
  persistState();
}

function openPreDropConflictDialog(params) {
  const { type, source, target, candidate, candidateSource, candidateTarget, errors } = params;
  const isSwap = type === 'swap';
  const targetDay = isSwap ? candidateSource.day : candidate.day;
  const targetPeriod = isSwap ? candidateSource.period : candidate.period;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-bg open';
  backdrop.id = 'pre-drop-conflict-modal';

  backdrop.innerHTML = `
    <div class="modal modal-md" style="max-width:560px">
      <div class="modal-hd">
        <div>
          <div class="modal-eyebrow" style="color:#dc2626">PRE-DROP SCHEDULING CLASH</div>
          <h2 class="modal-title">⚠️ Conflict on ${esc(targetDay)} ${esc(targetPeriod)}</h2>
          <div class="modal-sub">
            ${isSwap
              ? `Swapping <b>${esc(source.subject)}</b> with <b>${esc(target.subject)}</b> causes scheduling conflicts.`
              : `Moving <b>${esc(source.subject)}</b> to <b>${esc(targetDay)} ${esc(targetPeriod)}</b> causes scheduling conflicts.`}
          </div>
        </div>
        <button type="button" class="modal-close" id="close-clash-modal">×</button>
      </div>

      <div class="modal-body" style="padding:10px 0 16px">
        <div class="publish-conflict-banner" style="margin-bottom:14px">
          <div class="publish-conflict-title">Detected Clashes (${errors.length}):</div>
          <ul class="publish-conflict-list">
            ${errors.map(e => `<li>${esc(e.message || e)}</li>`).join('')}
          </ul>
        </div>

        <div style="font-size:12px;font-weight:600;color:var(--td);margin-bottom:8px">Choose how to proceed:</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div class="conflict-option-card" id="opt-autofix">
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--td)">⚡ Auto-Fix (Find Free Period)</div>
              <div style="font-size:11.5px;color:var(--tmu)">Find the next available conflict-free slot on ${esc(targetDay)} for this teacher and room.</div>
            </div>
            <button type="button" class="btn-out" style="padding:4px 12px;font-size:11.5px;color:var(--gM,#388e3c)">Auto-Fix</button>
          </div>

          <div class="conflict-option-card" id="opt-override">
            <div>
              <div style="font-size:13px;font-weight:700;color:#d97706">⚠️ Move Anyway (Flag Conflict in Draft)</div>
              <div style="font-size:11.5px;color:var(--tmu)">Place the slot and highlight double-booking banner. Resolve before publishing.</div>
            </div>
            <button type="button" class="btn-out" style="padding:4px 12px;font-size:11.5px;color:#d97706">Move Anyway</button>
          </div>

          <div class="conflict-option-card" id="opt-cancel">
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--tmu)">↩ Cancel Move</div>
              <div style="font-size:11.5px;color:var(--tmu)">Keep original placement and revert drag action.</div>
            </div>
            <button type="button" class="btn-out" style="padding:4px 12px;font-size:11.5px">Cancel</button>
          </div>
        </div>
      </div>

      <div class="modal-ft" style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
        <button type="button" class="btn-out" id="close-clash-btn">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const closeModal = () => {
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 150);
  };

  backdrop.querySelector('#close-clash-modal')?.addEventListener('click', closeModal);
  backdrop.querySelector('#close-clash-btn')?.addEventListener('click', closeModal);
  backdrop.querySelector('#opt-cancel')?.addEventListener('click', closeModal);

  // Move Anyway Handler
  backdrop.querySelector('#opt-override')?.addEventListener('click', async () => {
    closeModal();
    if (isSwap) {
      recordHistory(`Swap ${source.subject} & ${target.subject} (Overridden)`);
      state.entries = state.entries.map(x => {
        if (x.id === source.id) return candidateSource;
        if (x.id === target.id) return candidateTarget;
        return x;
      });
    } else {
      recordHistory(`Move ${source.subject} (Overridden)`);
      if (type === 'copy') state.entries.push(candidate);
      else state.entries = state.entries.map(x => x.id === source.id ? candidate : x);
    }

    markCurrentTabDirty();
    render();
    persistState();
    notify('⚠️ Slot rescheduled with flagged conflict. Resolve before publishing.', 'warn');
  });

  // Auto-Fix Handler
  backdrop.querySelector('#opt-autofix')?.addEventListener('click', async () => {
    closeModal();
    const targetObj = isSwap ? candidateSource : candidate;
    let autoFixedPeriod = null;

    for (const p of PERIODS) {
      const pCode = p[0];
      if (BREAK_PERIODS.has(pCode)) continue;
      const occ = state.entries.find(x => x.day === targetDay && x.period === pCode && x.id !== source.id);
      if (!occ) {
        const testCand = { ...targetObj, day: targetDay, period: pCode };
        const testErrors = conflictsFor(testCand, state.entries, source.id);
        if (!testErrors.length) {
          autoFixedPeriod = pCode;
          break;
        }
      }
    }

    if (!autoFixedPeriod) {
      return notify(`No clash-free slot found on ${targetDay} for ${targetObj.teacher || 'faculty'}. Try another day.`, 'warn');
    }

    recordHistory(`Auto-Fix Move ${source.subject} to ${targetDay} ${autoFixedPeriod}`);
    const fixedCand = { ...targetObj, day: targetDay, period: autoFixedPeriod };
    if (type === 'copy') state.entries.push(fixedCand);
    else state.entries = state.entries.map(x => x.id === source.id ? fixedCand : x);

    markCurrentTabDirty();
    render();
    persistState();
    notify(`⚡ Auto-fixed! Moved "${source.subject}" to ${targetDay} ${autoFixedPeriod} without clashes.`, 'success');
  });
}

function openDuplicateDayModal(sourceDay) {
  const currentSection = state.filterSection;
  const sourceSlots = state.entries.filter(e => e.day === sourceDay && (!currentSection || e.section === currentSection));

  if (!sourceSlots.length) {
    return notify(`No timetable slots found on ${sourceDay} to duplicate.`, 'warn');
  }

  const otherDays = DAYS.filter(d => d !== sourceDay);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-bg open';
  backdrop.id = 'duplicate-day-modal';

  backdrop.innerHTML = `
    <div class="modal modal-md" style="max-width:540px">
      <div class="modal-hd">
        <div>
          <div class="modal-eyebrow" style="color:var(--gM,#388e3c)">DAY SCHEDULE REPLICATION</div>
          <h2 class="modal-title">📋 Duplicate ${esc(sourceDay)}'s Schedule</h2>
          <div class="modal-sub">
            Copy all <b>${sourceSlots.length}</b> periods from ${esc(sourceDay)} to another day for <b>${esc(currentSection || 'Current Class')}</b>.
          </div>
        </div>
        <button type="button" class="modal-close" id="close-dup-modal">×</button>
      </div>

      <div class="modal-body" style="padding:12px 0 16px">
        <div class="form-grid" style="grid-template-columns:1fr;gap:14px">
          <label>
            Target Day *
            <select id="dup-target-day" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid var(--br);border-radius:8px;font-size:13px;background:var(--bg);color:var(--td)">
              ${otherDays.map(d => `<option value="${d}">${d}</option>`).join('')}
            </select>
          </label>

          <div>
            <span style="font-weight:600;font-size:12px;color:var(--td);display:block;margin-bottom:6px">Replication Strategy:</span>
            <div style="display:flex;gap:16px;background:var(--gP);padding:10px 14px;border-radius:10px;border:1px solid var(--br)">
              <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer">
                <input type="radio" name="dup-mode" value="overwrite" checked>
                <b>Overwrite Target Day</b> (Replace existing)
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer">
                <input type="radio" name="dup-mode" value="merge">
                <b>Merge</b> (Keep non-empty target slots)
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-ft" style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">
        <button type="button" class="btn-out" id="cancel-dup-btn">Cancel</button>
        <button type="button" class="btn-pri" id="confirm-dup-btn">Duplicate Schedule 📋</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const closeModal = () => {
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 150);
  };

  backdrop.querySelector('#close-dup-modal')?.addEventListener('click', closeModal);
  backdrop.querySelector('#cancel-dup-btn')?.addEventListener('click', closeModal);

  backdrop.querySelector('#confirm-dup-btn')?.addEventListener('click', async () => {
    const targetDay = backdrop.querySelector('#dup-target-day')?.value;
    const mode = backdrop.querySelector('input[name="dup-mode"]:checked')?.value || 'overwrite';
    if (!targetDay) return notify('Please select a target day.', 'warn');

    recordHistory(`Duplicate ${sourceDay} schedule to ${targetDay}`);

    if (mode === 'overwrite') {
      state.entries = state.entries.filter(e => !(e.day === targetDay && (!currentSection || e.section === currentSection)));
    }

    const existingTargetPeriods = new Set(
      state.entries.filter(e => e.day === targetDay && (!currentSection || e.section === currentSection)).map(e => e.period)
    );

    const clones = [];
    sourceSlots.forEach(s => {
      if (mode === 'merge' && existingTargetPeriods.has(s.period)) return;
      clones.push({
        ...s,
        id: uid(),
        day: targetDay,
        section: currentSection || s.section
      });
    });

    state.entries = [...state.entries, ...clones];
    markCurrentTabDirty();
    closeModal();
    render();
    persistState();
    notify(`Copied ${clones.length} slot(s) from ${sourceDay} to ${targetDay}.`, 'success');
  });
}

function extendSlotDuration(entryId) {
  if (isReadOnlyMode()) {
    return notify('Timetable is currently read-only.', 'warn');
  }
  const entry = state.entries.find(x => x.id === entryId);
  if (!entry) return;

  const currentDuration = Number(entry.duration || 1);
  const pIndex = PERIODS.findIndex(p => p[0] === entry.period);
  const maxSpan = pIndex >= 0 ? (PERIODS.length - pIndex) : 1;

  let nextDuration = currentDuration + 1;
  if (nextDuration > Math.min(4, maxSpan)) {
    nextDuration = 1;
    recordHistory(`Reset span of ${entry.subject}`);
    state.entries = state.entries.map(x => x.id === entryId ? { ...x, duration: 1 } : x);
    markCurrentTabDirty();
    render();
    persistState();
    notify(`Reset "${entry.subject}" to 1 period span.`, 'info');
    return;
  }

  const candidate = { ...entry, duration: nextDuration };
  const errors = conflictsFor(candidate, state.entries, entryId);
  if (errors.length) {
    return notify(`Cannot extend span: ${errors[0].message}`, 'warn');
  }

  recordHistory(`Extend span of ${entry.subject} to ${nextDuration}`);
  state.entries = state.entries.map(x => x.id === entryId ? candidate : x);
  markCurrentTabDirty();
  render();
  persistState();
  notify(`Extended "${entry.subject}" to ${nextDuration} periods (${spanTimeFor(entry.period, nextDuration)}).`, 'success');
}

function bindDragDrop() {
  document.querySelectorAll('.slot[data-entry-id]').forEach(node => {
    node.addEventListener('dragstart', event => {
      if (isReadOnlyMode()) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = 'copyMove';
      event.dataTransfer.setData('text/plain', node.dataset.entryId);
      node.classList.add('dragging');
    });
    node.addEventListener('dragend', () => node.classList.remove('dragging'));
  });

  document.querySelectorAll('.slot-add, .slot[data-entry-id]').forEach(node => {
    node.addEventListener('dragover', event => {
      // Cross-Pane Domain Validation (§5.2)
      const targetPane = node.closest('.tt-tab-pane');
      const targetTabId = targetPane?.dataset?.tabId;
      const targetTab = window.workspace?.getTab(targetTabId);

      // Block drops onto analytical projections or read-only views
      if (targetTab && (targetTab.viewType !== 'section' || targetTab.mode !== 'development')) {
        event.dataTransfer.dropEffect = 'none';
        return;
      }

      if (!isReadOnlyMode()) {
        event.preventDefault();
        node.classList.add('drop-target');
        event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey ? 'copy' : 'move';
      }
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
    node.addEventListener('drop', event => {
      event.preventDefault();
      node.classList.remove('drop-target');
      if (isReadOnlyMode()) {
        return;
      }
      const id = event.dataTransfer.getData('text/plain');
      if (id) moveEntryTo(id, node.dataset.day, node.dataset.period, event.ctrlKey || event.metaKey);
    });
  });
}

async function onSectionChange(newSection) {
  if (!newSection) return;

  if (window.workspace) {
    if (state.view === 'attendance') {
      state.filterSection = newSection;
      setLiveSyncStatus('loading', 'Loading..');
      await loadAttendanceInsights();
      render();
      updateLiveSyncFromCurrentState();
      return;
    }
    if (state.view === 'history') {
      state.filterSection = newSection;
      setLiveSyncStatus('loading', 'Loading..');
      await loadVersions();
      render();
      updateLiveSyncFromCurrentState();
      return;
    }
    if (state.view === 'exports') {
      state.filterSection = newSection;
      render();
      const classId = getSelectedClassId();
      if (classId) {
        apiCall('GET', '/timetable/section/' + classId).then(sec => {
          state.entries = flattenSlots(sec.slots || {});
        }).catch(() => {});
      }
      return;
    }
    if (state.view === 'overview' || state.view === 'workload' || state.view === 'rooms') {
      state.filterSection = newSection;
      render();
      return;
    }

    // In Class Timetable: Open or activate class tab!
    const tabId = buildTabId('section', { classId: newSection });
    if (window.workspace.tabs.has(tabId)) {
      window.workspace.activateTab(tabId);
    } else {
      window.workspace.openTab({
        id: tabId,
        title: newSection,
        icon: '📅',
        viewType: 'section',
        viewParams: { classId: newSection, sectionName: newSection },
        mode: state.env || 'development'
      });
    }

    // Ensure tabstrip & viewport container are visible and full-page is hidden
    const tabstripBar = document.getElementById('tt-tabstrip-bar');
    const viewportContainer = document.getElementById('viewport-container');
    const fullPage = document.getElementById('tt-full-page-container');
    if (tabstripBar) tabstripBar.style.display = '';
    if (viewportContainer) viewportContainer.style.display = '';
    if (fullPage) {
      fullPage.style.display = 'none';
      fullPage.innerHTML = '';
    }
    state.view = 'grid';
    document.querySelectorAll('.sb-item[data-view]').forEach(x => x.classList.toggle('act', x.dataset.view === 'grid'));
    return;
  }

  state.filterSection = newSection;
  await loadState();
  if (state.view === 'history') await loadVersions();
  if (state.view === 'attendance') await loadAttendanceInsights();
  render();
}

// ── Event Bindings ──
function bindView() {
  if (state.view === 'dashboard') {
    bindDashboardCockpit();
    return;
  }
  if (state.view === 'subjects') {
    bindSubjectsView();
    return;
  }

  bindDragDrop();

  // Context menu on slots
  document.querySelectorAll('.slot').forEach(node => node.addEventListener('contextmenu', event => {
    if (isReadOnlyMode()) return;
    const entry = node.dataset.entryId ? state.entries.find(x => x.id === node.dataset.entryId) : null;
    showContextMenu(event, entry, { day: node.dataset.day, period: node.dataset.period });
  }));

  // Section filter - opens newly selected class in a new tab
  $('#section-filter')?.addEventListener('change', async e => {
    onSectionChange(e.target.value);
  });

  // Search
  $('#entry-search')?.addEventListener('input', e => {
    state.search = e.target.value;
    render();
  });

  $('#clear-filters')?.addEventListener('click', () => {
    state.search = '';
    state.filterSection = SECTIONS[0] || '';
    loadState().then(async () => {
      if (state.view === 'history') await loadVersions();
      if (state.view === 'attendance') await loadAttendanceInsights();
      render();
    });
  });

  // Action buttons
  $('#add-entry-btn')?.addEventListener('click', () => {
    if (!isReadOnlyMode()) {
      openEntryModal();
    }
  });
  $('#empty-add')?.addEventListener('click', () => {
    if (!isReadOnlyMode()) {
      openEntryModal();
    }
  });
  $('#autogen-btn')?.addEventListener('click', () => {
    if (!isReadOnlyMode()) {
      openAutoGenerateModal();
    }
  });
  $('#export-btn')?.addEventListener('click', exportCurrent);
  $('#publish-draft')?.addEventListener('click', publishDraft);
  $('#reset-draft')?.addEventListener('click', resetDraft);
  $('#clear-draft-btn')?.addEventListener('click', clearDraft);
  $('#compare-draft')?.addEventListener('click', () => {
    switchEnv('development');
  });

  // Workload sub-tabs
  $('#tab-workload-fac')?.addEventListener('click', () => {
    state.workloadTab = 'faculty';
    render();
  });
  $('#tab-workload-sch')?.addEventListener('click', () => {
    state.workloadTab = 'schedule';
    render();
  });
  $('#tab-workload-sub')?.addEventListener('click', () => {
    state.workloadTab = 'subject';
    render();
  });

  // Report & analytics exports
  $('#export-workload-btn')?.addEventListener('click', exportWorkloadCSV);
  $('#export-workload-csv-btn')?.addEventListener('click', exportWorkloadCSV);
  $('#export-subjects-btn')?.addEventListener('click', exportSubjectDistributionCSV);
  $('#export-subjects-csv-btn')?.addEventListener('click', exportSubjectDistributionCSV);
  $('#export-rooms-btn')?.addEventListener('click', exportRoomUtilizationCSV);
  $('#export-rooms-csv-btn')?.addEventListener('click', exportRoomUtilizationCSV);

  // Version history buttons

  $('#refresh-versions-btn')?.addEventListener('click', async () => {
    notify('Refreshing version logs…', 'saving');
    await loadVersions();
    render();
    notify('Version history updated.', 'success');
  });
  document.querySelectorAll('.restore-version-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const vid = btn.dataset.versionId;
      if (vid) restoreVersion(vid);
    });
  });
  document.querySelectorAll('.inspect-version-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const vid = btn.dataset.versionId;
      if (vid) inspectVersion(vid);
    });
  });

  // Attendance Insights buttons & controls
  document.querySelectorAll('.att-range-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.attendanceRange = parseInt(btn.dataset.days, 10) || 30;
      await loadAttendanceInsights();
      render();
    });
  });

  $('#att-subject-filter')?.addEventListener('change', async e => {
    state.attendanceSubject = e.target.value;
    await loadAttendanceInsights();
    render();
  });

  $('#att-student-search')?.addEventListener('input', e => {
    state.attendanceSearch = e.target.value;
    render();
    const input = $('#att-student-search');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });

  $('#export-attendance-csv')?.addEventListener('click', exportAttendanceCSV);
  $('#refresh-attendance-btn')?.addEventListener('click', async () => {
    notify('Syncing live attendance metrics…', 'saving');
    await loadAttendanceInsights();
    render();
    notify('Attendance analytics refreshed.', 'success');
  });

  // Faculty Schedule Filter (Item 8)
  $('#faculty-filter')?.addEventListener('change', e => {
    state.selectedFaculty = e.target.value;
    render();
  });

  // Free Slots Room Filter & Inspect Buttons (Item 8)
  $('#room-free-filter')?.addEventListener('change', e => {
    state.selectedRoom = e.target.value;
    render();
  });
  document.querySelectorAll('.view-room-slots-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedRoom = btn.dataset.room;
      render();
    });
  });
  document.querySelectorAll('.schedule-in-room-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openEntryModal(null, { day: btn.dataset.day, period: btn.dataset.period });
    });
  });

  // HoD Timetable Verification & Approval Actions (Items 4, 5, 6)
  $('#refresh-verifications-btn')?.addEventListener('click', async () => {
    notify('Refreshing verification queue…', 'saving');
    await loadVerificationRequests();
    render();
    notify('Verification queue updated.', 'success');
  });
  document.querySelectorAll('.hod-approve-btn').forEach(btn => {
    btn.addEventListener('click', () => reviewVerificationRequest(btn.dataset.id, 'approve'));
  });
  document.querySelectorAll('.hod-reject-btn').forEach(btn => {
    btn.addEventListener('click', () => reviewVerificationRequest(btn.dataset.id, 'reject'));
  });
  document.querySelectorAll('.publish-all-btn').forEach(btn => {
    btn.addEventListener('click', () => publishAllRequest(btn.dataset.id));
  });

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

  // Duplicate Day Schedule buttons (Item 10)
  document.querySelectorAll('.duplicate-day-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const day = btn.dataset.day;
      if (day) openDuplicateDayModal(day);
    });
  });

  // Slot Resize Handles (Item 10)
  document.querySelectorAll('.slot-resize-handle').forEach(handle => {
    handle.addEventListener('click', e => {
      e.stopPropagation();
      if (isReadOnlyMode()) return;
      const entryId = handle.dataset.entryId;
      if (entryId) extendSlotDuration(entryId);
    });
  });

  // Slot clicks
  document.querySelectorAll('.slot[data-entry-id]').forEach(node => node.addEventListener('click', () => {
    const entry = state.entries.find(x => x.id === node.dataset.entryId) || state.production.find(x => x.id === node.dataset.entryId);
    if (!entry) return;
    if (!isReadOnlyMode()) {
      openEntryModal(entry);
    } else {
      notify(`${entry.subject} · ${entry.teacher} · ${entry.room}`, 'info');
    }
  }));

  // Empty slot clicks
  document.querySelectorAll('.slot-add').forEach(node => node.addEventListener('click', () => {
    if (isReadOnlyMode()) return;
    openEntryModal(null, { day: node.dataset.day, period: node.dataset.period });
  }));

  // Free slot scheduling
  document.querySelectorAll('[id^="free-"]').forEach(node => node.addEventListener('click', () => {
    if (isReadOnlyMode()) return;
    const parts = node.id.slice(5).split('-');
    openEntryModal(null, { day: parts[0], period: parts[1] });
  }));

  // Print button
  document.querySelectorAll('#print-btn').forEach(btn => btn.addEventListener('click', () => {
    const meta = document.getElementById('print-meta');
    if (meta) {
      meta.textContent = `Section: ${state.filterSection || 'All'} · Academic Timetable · Date: ${new Date().toLocaleDateString()}`;
    }
    window.print();
  }));

  // Academic Calendar Syllabus Horizon modal (Item 12)
  $('#open-syllabus-coverage-btn')?.addEventListener('click', openSyllabusCoverageModal);
}

function bindGlobal() {
  // Hide context menu on outer click
  document.addEventListener('click', event => {
    if (!event.target.closest('#tt-context-menu')) hideContextMenu();
  });

  // Delegated section filter change listener (opens new tab §2.1)
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'section-filter') {
      onSectionChange(e.target.value);
    }
  });

  // Delegated click listener for all toolbar, action, and export buttons (Item 4)
  document.addEventListener('click', e => {
    // 0a. Cascade Department trigger
    const deptTrigger = e.target.closest('#tt-dept-trigger');
    if (deptTrigger) {
      e.preventDefault();
      e.stopPropagation();
      toggleDeptDropdown(deptTrigger);
      return;
    }

    // 0b. Cascade Batch trigger
    const batchTrigger = e.target.closest('#tt-batch-trigger');
    if (batchTrigger) {
      e.preventDefault();
      e.stopPropagation();
      toggleBatchDropdown(batchTrigger);
      return;
    }

    // 0c. Cascade Item selection (Dept or Batch)
    const cascadeItem = e.target.closest('.tt-cascade-item');
    if (cascadeItem) {
      e.preventDefault();
      const type = cascadeItem.dataset.type;
      const val = cascadeItem.dataset.value;
      if (type === 'dept') selectDepartment(val);
      else if (type === 'batch') selectBatch(val);
      return;
    }

    // 0d. Cascade Reset button click (Reset Dept or Reset Batch)
    const cascadeResetBtn = e.target.closest('.tt-cascade-reset');
    if (cascadeResetBtn) {
      e.preventDefault();
      const action = cascadeResetBtn.dataset.action;
      if (action === 'reset-dept') selectDepartment('all');
      else if (action === 'reset-batch') selectBatch('all');
      return;
    }

    // 0e0. Class selector card left header click
    const classCardHeader = e.target.closest('#tt-class-selector-card .tt-class-selector-left');
    if (classCardHeader) {
      e.preventDefault();
      e.stopPropagation();
      toggleClassDropdown(classCardHeader);
      return;
    }

    // 0e. Custom Class/Section Dropdown trigger
    const classTrigger = e.target.closest('#tt-class-dropdown-trigger');
    if (classTrigger) {
      e.preventDefault();
      e.stopPropagation();
      toggleClassDropdown(classTrigger);
      return;
    }

    // 0f. Custom Class/Section Dropdown option item
    const classItem = e.target.closest('#tt-class-options-list .tt-dropdown-item');
    if (classItem && classItem.dataset.value) {
      e.preventDefault();
      selectClassSection(classItem.dataset.value, classItem);
      return;
    }

    // 0g. Custom Class/Section Search clear button
    const clearSearchBtn = e.target.closest('#tt-class-search-clear');
    if (clearSearchBtn) {
      e.preventDefault();
      const dd = clearSearchBtn.closest('#tt-class-dropdown');
      const sInput = dd ? dd.querySelector('#tt-class-search-input') : document.getElementById('tt-class-search-input');
      if (sInput) {
        sInput.value = '';
        filterClassDropdown('', sInput);
        sInput.focus();
      }
      return;
    }

    // 0g1. Custom Faculty Dropdown trigger or card header click
    const facultyTrigger = e.target.closest('#tt-faculty-dropdown-trigger, #tt-faculty-selector-card .tt-class-selector-left');
    if (facultyTrigger) {
      e.preventDefault();
      e.stopPropagation();
      toggleFacultyDropdown(facultyTrigger);
      return;
    }

    // 0g2. Custom Faculty Dropdown option item
    const facultyItem = e.target.closest('#tt-faculty-options-list .tt-dropdown-item');
    if (facultyItem && facultyItem.dataset.value) {
      e.preventDefault();
      selectFaculty(facultyItem.dataset.value);
      return;
    }

    // 0g3. Custom Faculty Search clear button
    const clearFacultySearchBtn = e.target.closest('#tt-faculty-search-clear');
    if (clearFacultySearchBtn) {
      e.preventDefault();
      const dd = clearFacultySearchBtn.closest('#tt-faculty-dropdown');
      const sInput = dd ? dd.querySelector('#tt-faculty-search-input') : document.getElementById('tt-faculty-search-input');
      if (sInput) {
        sInput.value = '';
        filterFacultyDropdown('', sInput);
        sInput.focus();
      }
      return;
    }

    // 0g4. Custom Room Dropdown trigger or card header click
    const roomTrigger = e.target.closest('#tt-room-dropdown-trigger, #tt-room-selector-card .tt-class-selector-left');
    if (roomTrigger) {
      e.preventDefault();
      e.stopPropagation();
      toggleRoomDropdown(roomTrigger);
      return;
    }

    // 0g5. Custom Room Dropdown option item
    const roomItem = e.target.closest('#tt-room-options-list .tt-dropdown-item');
    if (roomItem && roomItem.dataset.value) {
      e.preventDefault();
      selectRoom(roomItem.dataset.value);
      return;
    }

    // 0g6. Custom Room Search clear button
    const clearRoomSearchBtn = e.target.closest('#tt-room-search-clear');
    if (clearRoomSearchBtn) {
      e.preventDefault();
      const dd = clearRoomSearchBtn.closest('#tt-room-dropdown');
      const sInput = dd ? dd.querySelector('#tt-room-search-input') : document.getElementById('tt-room-search-input');
      if (sInput) {
        sInput.value = '';
        filterRoomDropdown('', sInput);
        sInput.focus();
      }
      return;
    }

    // 0h. Close all Cascade / Custom Dropdowns if clicked outside
    if (!e.target.closest('#tt-dept-dropdown') && !e.target.closest('#tt-batch-dropdown') && !e.target.closest('#tt-class-dropdown') && !e.target.closest('#tt-faculty-dropdown') && !e.target.closest('#tt-room-dropdown') && !e.target.closest('#tt-subj-dept-dropdown') && !e.target.closest('#tt-subj-reg-dropdown') && !e.target.closest('#tt-subj-dropdown') && !e.target.closest('#att-subject-dropdown') && !e.target.closest('#tt-room-selector-card .tt-class-selector-left') && !e.target.closest('#tt-faculty-selector-card .tt-class-selector-left') && !e.target.closest('#tt-class-selector-card .tt-class-selector-left') && !e.target.closest('#tt-subject-selector-card .tt-class-selector-left')) {
      closeCascadeDropdowns();
      closeFacultyDropdown();
      closeRoomDropdown();
    }

    // 1. Publish Draft button
    const pubBtn = e.target.closest('#publish-draft, .btn-publish-draft');
    if (pubBtn) {
      e.preventDefault();
      publishDraft();
      return;
    }

    // 2. Undo button
    const undoBtn = e.target.closest('#undo-btn, .btn-undo');
    if (undoBtn) {
      e.preventDefault();
      if (!undoBtn.disabled && !undoBtn.classList.contains('disabled')) {
        performUndo(e);
      }
      return;
    }

    // 3. Redo button
    const redoBtn = e.target.closest('#redo-btn, .btn-redo');
    if (redoBtn) {
      e.preventDefault();
      if (!redoBtn.disabled && !redoBtn.classList.contains('disabled')) {
        performRedo(e);
      }
      return;
    }

    // 4. Add Entry button
    const addBtn = e.target.closest('#add-entry-btn, .btn-add-entry, #empty-add');
    if (addBtn) {
      e.preventDefault();
      if (isReadOnlyMode()) {
        notify(state.draftTemplateStatus === 'pending_approval' ? 'This draft is locked for HoD verification.' : 'Timetable is currently read-only in production.', 'warn');
        return;
      }
      openEntryModal();
      return;
    }

    // 5. Auto-Generate button
    const autoGenBtn = e.target.closest('#autogen-btn, .btn-autogen');
    if (autoGenBtn) {
      e.preventDefault();
      if (isReadOnlyMode()) {
        notify(state.draftTemplateStatus === 'pending_approval' ? 'This draft is locked for HoD verification.' : 'Timetable is currently read-only in production.', 'warn');
        return;
      }
      openAutoGenerateModal();
      return;
    }

    // 6. Clear Draft button
    const clearBtn = e.target.closest('#clear-draft-btn, .btn-clear-draft');
    if (clearBtn) {
      e.preventDefault();
      if (isReadOnlyMode()) {
        notify(state.draftTemplateStatus === 'pending_approval' ? 'This draft is locked for HoD verification.' : 'Timetable is currently read-only in production.', 'warn');
        return;
      }
      clearDraft();
      return;
    }

    // 7. Reset Draft button
    const resetBtn = e.target.closest('#reset-draft, .btn-reset-draft');
    if (resetBtn) {
      e.preventDefault();
      if (isReadOnlyMode()) {
        notify(state.draftTemplateStatus === 'pending_approval' ? 'This draft is locked for HoD verification.' : 'Timetable is currently read-only in production.', 'warn');
        return;
      }
      resetDraft();
      return;
    }

    // 8. Compare Draft button
    const compBtn = e.target.closest('#compare-draft');
    if (compBtn) {
      e.preventDefault();
      switchEnv('development');
      return;
    }

    // 9. Export current CSV button
    const expCsvBtn = e.target.closest('#export-btn');
    if (expCsvBtn) {
      e.preventDefault();
      exportCurrent();
      return;
    }

    // 10. Export current Excel button
    const expXlsBtn = e.target.closest('#export-excel-btn');
    if (expXlsBtn) {
      e.preventDefault();
      exportCurrentExcel();
      return;
    }

    // 11. Export All Sections CSV button
    const expAllBtn = e.target.closest('#export-all-sections-btn');
    if (expAllBtn) {
      e.preventDefault();
      exportAllSectionsCSV();
      return;
    }

    // 12. Export Workload CSV button
    const expWkBtn = e.target.closest('#export-workload-btn, #export-workload-csv-btn');
    if (expWkBtn) {
      e.preventDefault();
      exportWorkloadCSV();
      return;
    }

    // 13. Export Room Matrix CSV button
    const expRmBtn = e.target.closest('#export-rooms-btn, #export-rooms-csv-btn');
    if (expRmBtn) {
      e.preventDefault();
      exportRoomUtilizationCSV();
      return;
    }

    // 14. Export Subject Distribution CSV button
    const expSubBtn = e.target.closest('#export-subjects-btn, #export-subjects-csv-btn');
    if (expSubBtn) {
      e.preventDefault();
      exportSubjectDistributionCSV();
      return;
    }

    // 15. Print button
    const printBtn = e.target.closest('#print-btn');
    if (printBtn) {
      e.preventDefault();
      window.print();
      return;
    }

    // 16. Slot click to edit
    const slotEl = e.target.closest('.slot[data-entry-id]');
    if (slotEl && !e.target.closest('.slot-resize-handle, .slot-change-btn')) {
      const entryId = slotEl.dataset.entryId;
      const entry = state.entries.find(x => x.id === entryId) || state.production.find(x => x.id === entryId);
      if (entry) {
        if (!isReadOnlyMode()) {
          openEntryModal(entry);
        } else {
          notify(`${entry.subject} · ${entry.teacher} · ${entry.room}`, 'info');
        }
      }
      return;
    }

    // 17. Empty slot + click to add
    const emptySlot = e.target.closest('.slot-add');
    if (emptySlot) {
      if (!isReadOnlyMode()) {
        openEntryModal(null, { day: emptySlot.dataset.day, period: emptySlot.dataset.period });
      }
      return;
    }
  });

  contextMenu().addEventListener('click', event => {
    const action = event.target.dataset.action;
    if (action) contextAction(action, event.currentTarget);
  });

  // Nav items in sidebar (with ?tab= URL sync)
  document.querySelectorAll('.sb-item[data-view]').forEach(node => node.addEventListener('click', () => {
    switchTab(node.dataset.view);
  }));

  // Mode toggle (Development vs Production with In-Tab State §2.2)
  document.querySelectorAll('.mode-toggle .mode').forEach((node) => node.addEventListener('click', async () => {
    const targetMode = node.dataset.mode || (node.classList.contains('mode-dev') ? 'development' : 'production');
    if (targetMode === state.env) return;

    if (targetMode === 'development' && !canAccessDev()) {
      return notify('Development environment access restricted to Admins, TT Coordinators, and HODs.', 'warn');
    }

    if (state.env === 'development' && targetMode === 'production' && isAnyTabDirty()) {
      if (!confirm('You have unsaved changes in your draft workspace. Switch to Live Production? Unsaved changes will remain preserved in Development drafts.')) {
        return;
      }
    }

    setLiveSyncStatus('loading', 'Loading..');
    updateWorkspaceMode(targetMode);

    if (typeof _slotSourceCache !== 'undefined') {
      _slotSourceCache.env = null;
    }

    const minWait = new Promise(r => setTimeout(r, 220));

    if (window.workspace) {
      const activeTab = window.workspace.getActiveTab();
      if (activeTab && activeTab.viewType === 'section') {
        activeTab.mode = state.env;
        window.workspace.setTabMode(activeTab.id, state.env);
        await Promise.all([window.workspace.refreshTab(activeTab.id), minWait]);
        updateLiveSyncFromCurrentState();
        return;
      }
    }
    if (state.env === 'production' && state.view === 'editor') {
      switchTab('production');
    } else {
      await Promise.all([loadState(), minWait]);
      render();
    }
    updateLiveSyncFromCurrentState();
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

  // Live filter for custom class & faculty dropdown search input & tab launcher
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'tt-class-search-input') {
      filterClassDropdown(e.target.value, e.target);
    }
    if (e.target && e.target.id === 'tt-faculty-search-input') {
      filterFacultyDropdown(e.target.value, e.target);
    }
    if (e.target && e.target.id === 'tt-room-search-input') {
      filterRoomDropdown(e.target.value, e.target);
    }
    if (e.target && e.target.id === 'tt-launcher-search') {
      const q = (e.target.value || '').toLowerCase().trim();
      const listEl = document.getElementById('tt-launcher-section-list');
      if (listEl) {
        listEl.querySelectorAll('.tt-launcher-item').forEach(item => {
          const sec = (item.dataset.section || '').toLowerCase();
          item.style.display = (!q || sec.includes(q)) ? 'flex' : 'none';
        });
      }
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeCascadeDropdowns();
      closeFacultyDropdown();
      closeRoomDropdown();
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
      const autoGen = document.getElementById('autogen-modal');
      if (autoGen) autoGen.remove();
      const subModal = document.getElementById('substitute-finder-modal');
      if (subModal) subModal.remove();
      const saveModal = document.getElementById('save-publish-modal');
      if (saveModal) saveModal.remove();
    }
    // Enter in search input selects the first visible class option
    if (e.target && e.target.id === 'tt-class-search-input' && e.key === 'Enter') {
      e.preventDefault();
      const dd = e.target.closest('#tt-class-dropdown') || document;
      const firstVis = Array.from(dd.querySelectorAll('#tt-class-options-list .tt-dropdown-item')).find(el => el.style.display !== 'none');
      if (firstVis && firstVis.dataset.value) {
        selectClassSection(firstVis.dataset.value, firstVis);
      }
      return;
    }
    // Enter in faculty search input selects the first visible faculty option
    if (e.target && e.target.id === 'tt-faculty-search-input' && e.key === 'Enter') {
      e.preventDefault();
      const dd = e.target.closest('#tt-faculty-dropdown') || document;
      const firstVis = Array.from(dd.querySelectorAll('#tt-faculty-options-list .tt-dropdown-item')).find(el => el.style.display !== 'none');
      if (firstVis && firstVis.dataset.value) {
        selectFaculty(firstVis.dataset.value);
      }
      return;
    }
    // Enter in room search input selects the first visible room option
    if (e.target && e.target.id === 'tt-room-search-input' && e.key === 'Enter') {
      e.preventDefault();
      const dd = e.target.closest('#tt-room-dropdown') || document;
      const firstVis = Array.from(dd.querySelectorAll('#tt-room-options-list .tt-dropdown-item')).find(el => el.style.display !== 'none');
      if (firstVis && firstVis.dataset.value) {
        selectRoom(firstVis.dataset.value);
      }
      return;
    }
    // Enter, Space or ArrowDown on trigger opens class dropdown
    if (e.target && (e.target.id === 'tt-class-dropdown-trigger' || e.target.closest('#tt-class-dropdown-trigger')) && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      openClassDropdown(e.target);
      return;
    }
    // Enter, Space or ArrowDown on trigger opens faculty dropdown
    if (e.target && (e.target.id === 'tt-faculty-dropdown-trigger' || e.target.closest('#tt-faculty-dropdown-trigger')) && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      openFacultyDropdown(e.target);
      return;
    }
    // Enter, Space or ArrowDown on trigger opens room dropdown
    if (e.target && (e.target.id === 'tt-room-dropdown-trigger' || e.target.closest('#tt-room-dropdown-trigger')) && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      openRoomDropdown(e.target);
      return;
    }
    // Ctrl+S or Cmd+S shortcut
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (isReadOnlyMode()) {
        return notify('Timetable is currently read-only.', 'warn');
      }
      publishDraft();
      return;
    }
    // Undo shortcut: Ctrl+Z or Cmd+Z
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      if (!e.target.matches('input, select, textarea')) {
        e.preventDefault();
        if (isReadOnlyMode()) {
          return notify('Timetable is read-only in this mode.', 'warn');
        }
        performUndo(e);
      }
    }
    // Redo shortcut: Ctrl+Y or Cmd+Y or Ctrl+Shift+Z
    if (((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
      if (!e.target.matches('input, select, textarea')) {
        e.preventDefault();
        if (isReadOnlyMode()) {
          return notify('Timetable is read-only in this mode.', 'warn');
        }
        performRedo(e);
      }
    }
  });
}

// ── Bootstrap ──
document.addEventListener('DOMContentLoaded', initApp);
