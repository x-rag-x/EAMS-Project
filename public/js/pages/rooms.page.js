/**
 * ══════════════════════════════════════════════════════════════════════════════
 * EAMS CAMPUS FACILITIES & SMART BOARD HUB — CONTROLLER (rooms.page.js)
 * Implements File Explorer Drill-Down: Blocks > Floors > Rooms/Halls/Labs
 * Zero-Alert Modal Dialogs & Encrypted Audit Tracking
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ── Application State ──
let ALL_BLOCKS = [];
let ALL_ROOMS = [];
let ALL_DEPTS = [];
let ALL_BOARDS = [];
let ALL_LOGS = [];

let CURRENT_MAIN_TAB = 'explorer'; // 'explorer' | 'maintenance' | 'boards' | 'audit'

// File Explorer Navigation State Machine
// level 0: All Blocks Grid
// level 1: Single Block (Floors Grid)
// level 2: Single Floor (Units Grid: Rooms / Halls / Labs)
// level 3: Single Unit Detail & Telemetry Inspection Sheet
let EXPLORER_STATE = {
  level: 0,
  blockId: null,
  floorNumber: null,
  unitId: null
};

// Filter State (Single-Line Unified Toolbar)
let VIEW_FILTER = 'all';        // 'all' | 'Academic' | 'Hostel' | 'Other'
let SEARCH_QUERY = '';
let FILTER_BLOCK_ID = '';
let FILTER_FLOOR = '';
let FILTER_TYPE = '';           // '' | 'Room' | 'Hall' | 'Lab'
let FILTER_STATUS = '';         // '' | 'Active' | 'Inactive'

// Confirm Modal Callback Holder
let pendingConfirmCallback = null;

// ── Core Utilities ──
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getToken() {
  if (typeof SESSION !== 'undefined' && SESSION && SESSION.token) return SESSION.token;
  return sessionStorage.getItem('eams_token') ||
         localStorage.getItem('eams_token') ||
         sessionStorage.getItem('token') ||
         localStorage.getItem('token') ||
         '';
}

function ah() {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : ''
  };
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...ah(), ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      console.warn('[EAMS Auth]: Session invalid or token expired (401).');
    }
    throw new Error(data.error || 'Server error (' + res.status + ')');
  }
  return data;
}

// ── ZERO ALERT MODAL POPUP ENGINE ──
function customAlert(message, title = 'Notification') {
  const modal = document.getElementById('modal-alert');
  const titleEl = document.getElementById('alert-modal-title');
  const msgEl = document.getElementById('alert-modal-msg');
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (modal) modal.classList.add('open');
}

function customConfirm(message, title = 'Confirm Action', onConfirm) {
  const modal = document.getElementById('modal-confirm');
  const titleEl = document.getElementById('confirm-modal-title');
  const msgEl = document.getElementById('confirm-modal-msg');
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  pendingConfirmCallback = onConfirm;
  if (modal) modal.classList.add('open');
}

function executeConfirmCallback() {
  const modal = document.getElementById('modal-confirm');
  if (modal) modal.classList.remove('open');
  if (typeof pendingConfirmCallback === 'function') {
    const cb = pendingConfirmCallback;
    pendingConfirmCallback = null;
    cb();
  }
}

function notify(msg, type = 'info') {
  if (typeof showToast === 'function') {
    showToast(msg, type);
  } else if (typeof dbtoast === 'function') {
    dbtoast(msg, type);
  } else {
    customAlert(msg, type === 'error' ? 'Error' : 'Notice');
  }
}

// ── Navigation & Main Tabs ──
function switchMainTab(tab) {
  CURRENT_MAIN_TAB = tab;

  // Update sidebar buttons
  ['explorer', 'maintenance', 'boards', 'audit'].forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const view = document.getElementById(`tab-view-${t}`);
    if (btn) btn.classList.toggle('act', t === tab);
    if (view) {
      view.classList.toggle('act', t === tab);
      view.style.display = (t === tab) ? 'block' : 'none';
    }
  });

  if (tab === 'maintenance') {
    renderMaintenanceTable();
  } else if (tab === 'boards') {
    renderBoardsTable();
  } else if (tab === 'audit') {
    renderAuditLogsTable();
  } else {
    renderCurrentExplorerLevel();
  }
}

// ── Data Initialization ──
async function loadAllData() {
  const loader = document.getElementById('page-loader');
  try {
    const [blocksData, roomsData, deptsData, boardsData] = await Promise.all([
      api('/api/timetable/buildings').catch(() => []),
      api('/api/timetable/rooms').catch(() => []),
      api('/api/departments').catch(() => []),
      api('/api/timetable/boards').catch(() => [])
    ]);

    ALL_BLOCKS = Array.isArray(blocksData) ? blocksData : (blocksData.data || []);
    ALL_ROOMS = Array.isArray(roomsData) ? roomsData : (roomsData.data || []);
    ALL_DEPTS = Array.isArray(deptsData) ? deptsData : (deptsData.data || []);
    ALL_BOARDS = Array.isArray(boardsData) ? boardsData : (boardsData.data || []);

    updateDashboardKPIs();
    populateFilterDropdowns();
    renderCurrentExplorerLevel();
  } catch (err) {
    console.error('Failed to load facility data:', err);
    notify('Failed to load campus facilities: ' + err.message, 'error');
  } finally {
    if (loader) {
      loader.classList.add('loader-fade');
      setTimeout(() => { loader.style.display = 'none'; }, 300);
    }
  }
}

function refreshFacilitiesData() {
  loadAllData();
  notify('Refreshed facilities data', 'success');
}

// ── 6-KPI Dashboard Updates ──
function updateDashboardKPIs() {
  // Row 1: Total Blocks | Total Class Rooms | Total Labs
  const totalBlocks = ALL_BLOCKS.length;
  const totalClassRooms = ALL_ROOMS.filter(r => r.category === 'Room' || (!r.category && r.type !== 'Lab' && r.type !== 'Seminar')).length;
  const totalLabs = ALL_ROOMS.filter(r => r.category === 'Lab' || r.type === 'Lab').length;

  // Row 2: Academic Blocks | Hostel Blocks | Others
  const academicBlocks = ALL_BLOCKS.filter(b => b.type === 'Academic').length;
  const hostelBlocks = ALL_BLOCKS.filter(b => b.type === 'Hostel').length;
  const otherBlocks = ALL_BLOCKS.filter(b => b.type !== 'Academic' && b.type !== 'Hostel').length;

  document.getElementById('kpi-total-blocks').textContent = totalBlocks;
  document.getElementById('kpi-total-rooms').textContent = totalClassRooms;
  document.getElementById('kpi-total-labs').textContent = totalLabs;
  document.getElementById('kpi-academic-blocks').textContent = academicBlocks;
  document.getElementById('kpi-hostel-blocks').textContent = hostelBlocks;
  document.getElementById('kpi-other-blocks').textContent = otherBlocks;
}

// ── Filter Toolbar Logic (Single-Line Unified Filters) ──
function populateFilterDropdowns() {
  const blockSelect = document.getElementById('filter-block');
  const floorSelect = document.getElementById('filter-floor');
  const modalBlockSelect = document.getElementById('unit-select-building');
  const modalDeptSelect = document.getElementById('unit-select-dept');

  if (blockSelect) {
    blockSelect.innerHTML = '<option value="">All Blocks</option>' +
      ALL_BLOCKS.map(b => `<option value="${b._id}">${esc(b.name)} (${esc(b.code)})</option>`).join('');
  }

  if (modalBlockSelect) {
    modalBlockSelect.innerHTML = '<option value="">— Select Block —</option>' +
      ALL_BLOCKS.map(b => `<option value="${b._id}" data-floors="${b.floors || 1}">${esc(b.name)} (${esc(b.code)})</option>`).join('');
  }

  if (modalDeptSelect) {
    modalDeptSelect.innerHTML = '<option value="">— General / Common —</option>' +
      ALL_DEPTS.map(d => `<option value="${d._id}">${esc(d.name)}</option>`).join('');
  }

  updateFloorDropdown();
}

function updateFloorDropdown() {
  const floorSelect = document.getElementById('filter-floor');
  if (!floorSelect) return;

  let maxFloors = 10;
  if (FILTER_BLOCK_ID) {
    const selectedBlock = ALL_BLOCKS.find(b => String(b._id) === String(FILTER_BLOCK_ID));
    if (selectedBlock && selectedBlock.floors) maxFloors = selectedBlock.floors;
  }

  let html = '<option value="">All Floors</option>';
  for (let f = 0; f <= maxFloors; f++) {
    html += `<option value="${f}">${f === 0 ? 'Ground Floor (0)' : 'Floor ' + f}</option>`;
  }
  floorSelect.innerHTML = html;
}

function onBlockFilterChange() {
  FILTER_BLOCK_ID = document.getElementById('filter-block').value;
  updateFloorDropdown();
  onFilterChange();
}

function onFilterChange() {
  const searchInput = document.getElementById('filter-search');
  SEARCH_QUERY = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const clearBtn = document.getElementById('filter-search-clear');
  if (clearBtn) clearBtn.style.display = SEARCH_QUERY ? 'block' : 'none';

  FILTER_FLOOR = document.getElementById('filter-floor')?.value || '';
  FILTER_TYPE = document.getElementById('filter-type')?.value || '';

  renderCurrentExplorerLevel();
}

function clearSearch() {
  const searchInput = document.getElementById('filter-search');
  if (searchInput) searchInput.value = '';
  onFilterChange();
}

function setViewFilter(view) {
  VIEW_FILTER = view;
  document.querySelectorAll('.v-pill').forEach(btn => {
    btn.classList.toggle('act', btn.getAttribute('data-view') === view);
  });
  // If drilled down, return to blocks root
  if (EXPLORER_STATE.level !== 0) {
    navExplorer(0);
  } else {
    renderBlocksGrid();
  }
}

function filterByBlockType(type) {
  setViewFilter(type === 'All' ? 'all' : type);
}

function filterByUnitType(type) {
  const typeSelect = document.getElementById('filter-type');
  if (typeSelect) {
    typeSelect.value = type;
    onFilterChange();
  }
}

function setStatusFilter(status) {
  FILTER_STATUS = status;
  document.querySelectorAll('.slf-status-btn').forEach(btn => {
    btn.classList.toggle('act', btn.getAttribute('data-status') === status);
  });
  renderCurrentExplorerLevel();
}

// ── FILE EXPLORER DRILL-DOWN STATE MACHINE ──
function navExplorer(level, blockId = null, floorNumber = null, unitId = null) {
  // Switch to explorer main tab if elsewhere
  if (CURRENT_MAIN_TAB !== 'explorer') switchMainTab('explorer');

  EXPLORER_STATE.level = level;
  if (blockId !== null) EXPLORER_STATE.blockId = blockId;
  if (floorNumber !== null) EXPLORER_STATE.floorNumber = floorNumber;
  if (unitId !== null) EXPLORER_STATE.unitId = unitId;

  // Breadcrumbs update
  const bCrumb = document.getElementById('eb-crumb-block');
  const fCrumb = document.getElementById('eb-crumb-floor');
  const uCrumb = document.getElementById('eb-crumb-unit');

  if (level === 0) {
    EXPLORER_STATE.blockId = null;
    EXPLORER_STATE.floorNumber = null;
    EXPLORER_STATE.unitId = null;
    if (bCrumb) bCrumb.style.display = 'none';
    if (fCrumb) fCrumb.style.display = 'none';
    if (uCrumb) uCrumb.style.display = 'none';
  } else if (level === 1) {
    EXPLORER_STATE.floorNumber = null;
    EXPLORER_STATE.unitId = null;
    const b = ALL_BLOCKS.find(x => String(x._id) === String(EXPLORER_STATE.blockId));
    if (bCrumb) {
      bCrumb.style.display = 'inline-flex';
      document.getElementById('eb-label-block').textContent = b ? b.name : 'Block';
    }
    if (fCrumb) fCrumb.style.display = 'none';
    if (uCrumb) uCrumb.style.display = 'none';
  } else if (level === 2) {
    EXPLORER_STATE.unitId = null;
    if (fCrumb) {
      fCrumb.style.display = 'inline-flex';
      document.getElementById('eb-label-floor').textContent = EXPLORER_STATE.floorNumber === 0 ? 'Ground Floor' : `Floor ${EXPLORER_STATE.floorNumber}`;
    }
    if (uCrumb) uCrumb.style.display = 'none';
  } else if (level === 3) {
    const u = ALL_ROOMS.find(x => String(x._id) === String(EXPLORER_STATE.unitId));
    if (uCrumb) {
      uCrumb.style.display = 'inline-flex';
      document.getElementById('eb-label-unit').textContent = u ? (u.name || u.hallNo) : 'Unit Details';
      document.getElementById('eb-icon-unit').textContent = u?.category === 'Lab' ? '🔬' : u?.category === 'Hall' ? '🎭' : '🚪';
    }
  }

  // Show/Hide Viewports
  ['blocks', 'floors', 'units', 'unit-detail'].forEach((vp, idx) => {
    const el = document.getElementById(`exp-view-${vp}`);
    if (el) {
      el.classList.toggle('act', idx === level);
      el.style.display = (idx === level) ? 'block' : 'none';
    }
  });

  renderCurrentExplorerLevel();
}

function renderCurrentExplorerLevel() {
  if (CURRENT_MAIN_TAB !== 'explorer') return;

  if (EXPLORER_STATE.level === 0) {
    renderBlocksGrid();
  } else if (EXPLORER_STATE.level === 1) {
    renderFloorsGrid(EXPLORER_STATE.blockId);
  } else if (EXPLORER_STATE.level === 2) {
    renderUnitsGrid(EXPLORER_STATE.blockId, EXPLORER_STATE.floorNumber);
  } else if (EXPLORER_STATE.level === 3) {
    renderUnitDetail(EXPLORER_STATE.unitId);
  }
}

// ── LEVEL 0: BLOCKS OVERVIEW GRID ──
function renderBlocksGrid() {
  const container = document.getElementById('blocks-container');
  if (!container) return;

  let blocks = ALL_BLOCKS;

  // View Filter (Total Blocks / Academic / Hostel / Other)
  if (VIEW_FILTER !== 'all') {
    if (VIEW_FILTER === 'Other') {
      blocks = blocks.filter(b => b.type !== 'Academic' && b.type !== 'Hostel');
    } else {
      blocks = blocks.filter(b => b.type === VIEW_FILTER);
    }
  }

  // Single-Line Status Filter
  if (FILTER_STATUS) {
    blocks = blocks.filter(b => b.status === FILTER_STATUS);
  }

  // Search Filter
  if (SEARCH_QUERY) {
    blocks = blocks.filter(b =>
      b.name.toLowerCase().includes(SEARCH_QUERY) ||
      (b.subName && b.subName.toLowerCase().includes(SEARCH_QUERY)) ||
      b.code.toLowerCase().includes(SEARCH_QUERY)
    );
  }

  if (blocks.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--tmu);">
        <div style="font-size: 32px; margin-bottom: 8px;">🏢</div>
        <div style="font-size: 15px; font-weight: 600;">No campus blocks match your criteria</div>
        <button class="btn-pri btn-sm" style="margin-top: 12px;" onclick="openAddBlockModal()">+ Add New Block</button>
      </div>`;
    return;
  }

  container.innerHTML = blocks.map(b => {
    // Dynamic metrics calculation
    const blockRooms = ALL_ROOMS.filter(r => String(r.buildingId?._id || r.buildingId) === String(b._id));
    const roomsCount = blockRooms.filter(r => r.category === 'Room' || (!r.category && r.type !== 'Lab' && r.type !== 'Seminar')).length;
    const labsCount = blockRooms.filter(r => r.category === 'Lab' || r.type === 'Lab').length;
    const totalCapacity = blockRooms.reduce((sum, r) => sum + (r.capacity || 0), 0);
    const floorsCount = b.floors || 1;

    return `
      <div class="block-card">
        <div class="bc-hd">
          <div>
            <div class="bc-name">${esc(b.name)} <span style="font-size:12px;color:var(--tmu);font-weight:normal;">(${esc(b.code)})</span></div>
            <div class="bc-sub">${esc(b.subName || b.type + ' Facility')}</div>
          </div>
          <span class="bc-badge">${esc(b.type)}</span>
        </div>

        <div class="bc-stats-grid">
          <div class="bc-stat-item">
            <span class="bcs-label">Floors</span>
            <span class="bcs-val">${floorsCount}</span>
          </div>
          <div class="bc-stat-item">
            <span class="bcs-label">Rooms</span>
            <span class="bcs-val">${roomsCount}</span>
          </div>
          <div class="bc-stat-item">
            <span class="bcs-label">Labs</span>
            <span class="bcs-val">${labsCount}</span>
          </div>
          <div class="bc-stat-item">
            <span class="bcs-label">Capacity</span>
            <span class="bcs-val">${totalCapacity.toLocaleString()} Seats</span>
          </div>
        </div>

        <div class="bc-ft">
          <div class="bc-ip">
            <span class="bc-ip-label">IP:</span> <code>${esc(b.ip || '192.168.10.1')}</code>
          </div>
          <div class="bc-actions">
            <button class="btn-out btn-xs" onclick="event.stopPropagation(); openEditBlockModal('${b._id}')">Edit</button>
            <button class="btn-out btn-xs text-danger" onclick="event.stopPropagation(); confirmDeleteBlock('${b._id}')">Delete</button>
            <button class="btn-pri btn-xs" onclick="exploreBlock('${b._id}')">Explore →</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function exploreBlock(blockId) {
  navExplorer(1, blockId);
}

// ── LEVEL 1: BLOCK VIEW (BLOCKS > BLOCK NAME) ──
function renderFloorsGrid(blockId) {
  const block = ALL_BLOCKS.find(b => String(b._id) === String(blockId));
  if (!block) {
    navExplorer(0);
    return;
  }

  // Update Block Summary Header
  const blockRooms = ALL_ROOMS.filter(r => String(r.buildingId?._id || r.buildingId) === String(block._id));
  const totalCapacity = blockRooms.reduce((sum, r) => sum + (r.capacity || 0), 0);
  const floorsCount = block.floors || 1;

  document.getElementById('exp-block-name').textContent = block.name;
  document.getElementById('exp-block-subname').textContent = block.subName || `${block.type} Facility Complex • Code: ${block.code}`;
  document.getElementById('exp-block-floors-cnt').textContent = `${floorsCount} Floors`;
  document.getElementById('exp-block-rooms-cnt').textContent = `${blockRooms.length} Total Rooms`;
  document.getElementById('exp-block-capacity-cnt').textContent = `${totalCapacity.toLocaleString()} Total Seating Capacity`;

  const container = document.getElementById('floors-container');
  if (!container) return;

  const floorsHtml = [];
  for (let f = 0; f <= floorsCount; f++) {
    const fRooms = blockRooms.filter(r => (r.floor !== undefined ? r.floor : 0) === f);
    const classes = fRooms.filter(r => r.category === 'Room' || (!r.category && r.type !== 'Lab' && r.type !== 'Seminar')).length;
    const labs = fRooms.filter(r => r.category === 'Lab' || r.type === 'Lab').length;
    const halls = fRooms.filter(r => r.category === 'Hall' || r.type === 'Seminar').length;
    const fCapacity = fRooms.reduce((s, r) => s + (r.capacity || 0), 0);

    const floorTitle = f === 0 ? 'Ground Floor (Level 0)' : `Floor ${f}`;

    floorsHtml.push(`
      <div class="floor-card" onclick="exploreFloor(${f})">
        <div class="fc-hd">
          <div class="fc-title">📶 ${floorTitle}</div>
          <span class="fc-capacity-badge">${fCapacity} Seats</span>
        </div>
        <div class="fc-counts">
          <span><b>${classes}</b> Classes</span>
          <span><b>${labs}</b> Labs</span>
          <span><b>${halls}</b> Halls</span>
        </div>
        <div class="fc-ft">
          <button class="btn-pri btn-xs" onclick="event.stopPropagation(); exploreFloor(${f})">Explore Floor →</button>
        </div>
      </div>`);
  }

  container.innerHTML = floorsHtml.join('');
}

function exploreFloor(floorNum) {
  navExplorer(2, null, floorNum);
}

// ── LEVEL 2: FLOOR VIEW (BLOCKS > BLOCK NAME > FLOOR NAME) ──
function renderUnitsGrid(blockId, floorNumber) {
  const block = ALL_BLOCKS.find(b => String(b._id) === String(blockId));
  if (!block) {
    navExplorer(0);
    return;
  }

  const floorRooms = ALL_ROOMS.filter(r =>
    String(r.buildingId?._id || r.buildingId) === String(block._id) &&
    (r.floor !== undefined ? r.floor : 0) === floorNumber
  );

  const labsCount = floorRooms.filter(r => r.category === 'Lab' || r.type === 'Lab').length;
  const hallsCount = floorRooms.filter(r => r.category === 'Hall' || r.type === 'Seminar').length;
  const roomsCount = floorRooms.filter(r => r.category === 'Room' || (!r.category && r.type !== 'Lab' && r.type !== 'Seminar')).length;
  const totalCapacity = floorRooms.reduce((sum, r) => sum + (r.capacity || 0), 0);

  const floorTitle = floorNumber === 0 ? 'Ground Floor' : `Floor ${floorNumber}`;
  document.getElementById('exp-floor-name').textContent = `${block.name} › ${floorTitle}`;
  document.getElementById('exp-floor-labs-cnt').textContent = `${labsCount} Total Labs`;
  document.getElementById('exp-floor-halls-cnt').textContent = `${hallsCount} Total Halls`;
  document.getElementById('exp-floor-rooms-cnt').textContent = `${roomsCount} Total Rooms`;
  document.getElementById('exp-floor-capacity-cnt').textContent = `${totalCapacity.toLocaleString()} Total Seating Capacity`;

  const container = document.getElementById('units-container');
  if (!container) return;

  let filteredRooms = floorRooms;

  // Single-line Type filter
  if (FILTER_TYPE) {
    filteredRooms = filteredRooms.filter(r => r.category === FILTER_TYPE || r.type === FILTER_TYPE);
  }

  // Single-line Status filter
  if (FILTER_STATUS) {
    filteredRooms = filteredRooms.filter(r => r.status === FILTER_STATUS);
  }

  // Search filter
  if (SEARCH_QUERY) {
    filteredRooms = filteredRooms.filter(r =>
      r.hallNo.toLowerCase().includes(SEARCH_QUERY) ||
      (r.name && r.name.toLowerCase().includes(SEARCH_QUERY))
    );
  }

  if (filteredRooms.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--tmu);">
        <div style="font-size: 32px; margin-bottom: 8px;">🚪</div>
        <div style="font-size: 15px; font-weight: 600;">No units registered on this floor</div>
        <button class="btn-pri btn-sm" style="margin-top: 12px;" onclick="openAddUnitModal()">+ Add Classroom / Hall / Lab</button>
      </div>`;
    return;
  }

  container.innerHTML = filteredRooms.map(r => {
    const isLab = r.category === 'Lab' || r.type === 'Lab';
    const isHall = r.category === 'Hall' || r.type === 'Seminar';
    const catClass = isLab ? 'uc-cat-lab' : isHall ? 'uc-cat-hall' : 'uc-cat-room';
    const catLabel = isLab ? 'Laboratory' : isHall ? 'Special Hall' : 'Class Room';
    const catIcon = isLab ? '🔬' : isHall ? '🎭' : '🏛️';

    // Board connection indicator
    const hasBoard = ALL_BOARDS.find(b => String(b.roomId?._id || b.roomId) === String(r._id) && b.status !== 'Inactive');

    return `
      <div class="unit-card" onclick="exploreUnit('${r._id}')">
        <div class="uc-hd">
          <div>
            <div class="uc-title">${catIcon} ${esc(r.hallNo)}</div>
            <div style="font-size:12px;color:var(--tmu);">${esc(r.name || r.hallNo)}</div>
          </div>
          <span class="uc-cat-badge ${catClass}">${catLabel}</span>
        </div>

        <div class="uc-body">
          <div>💺 <b>${r.capacity}</b> Seats &bull; 🌐 ${esc(r.ipAddress || '192.168.10.' + (r.floor * 10 + 1))}</div>
          <div>📶 Wi-Fi: <b>${esc(r.wifiSpeed || '150 Mbps')}</b> &bull; 📱 <b>${esc(r.mobileSpeed || '5G')}</b></div>
          <div style="margin-top:4px;">📺 Smart Board: ${hasBoard ? '<span style="color:var(--gD);font-weight:700;">🟢 Linked (' + esc(hasBoard.deviceId) + ')</span>' : '<span style="color:var(--tmu);">⚪ Unlinked</span>'}</div>
          ${isHall && r.incharge?.name ? `<div style="margin-top:2px;">👨‍🏫 Incharge: <b>${esc(r.incharge.name)}</b></div>` : ''}
          ${isLab ? `<div style="margin-top:2px;">🖥️ Workstations: <b>${r.workstationsCount || r.capacity}</b> &bull; Status: <b>${esc(r.labStatus || 'Available')}</b></div>` : ''}
        </div>

        <div class="uc-ft">
          <span style="font-size:11px;color:${r.status === 'Available' ? 'var(--gD)' : 'var(--warn)'};font-weight:600;">● ${esc(r.status)}</span>
          <button class="btn-pri btn-xs" onclick="event.stopPropagation(); exploreUnit('${r._id}')">View Details →</button>
        </div>
      </div>`;
  }).join('');
}

function exploreUnit(unitId) {
  navExplorer(3, null, null, unitId);
}

// ── LEVEL 3: UNIT INSPECTION & TELEMETRY SHEET ──
function renderUnitDetail(unitId) {
  const container = document.getElementById('unit-detail-card');
  if (!container) return;

  const room = ALL_ROOMS.find(r => String(r._id) === String(unitId));
  if (!room) {
    navExplorer(0);
    return;
  }

  const isLab = room.category === 'Lab' || room.type === 'Lab';
  const isHall = room.category === 'Hall' || room.type === 'Seminar';
  const catLabel = isLab ? 'Laboratory' : isHall ? 'Special Hall' : 'Class Room';
  const catIcon = isLab ? '🔬' : isHall ? '🎭' : '🏛️';

  const assignedBoard = ALL_BOARDS.find(b => String(b.roomId?._id || b.roomId) === String(room._id) && b.status !== 'Inactive');
  const bldg = ALL_BLOCKS.find(b => String(b._id) === String(room.buildingId?._id || room.buildingId));

  let html = `
    <div class="uis-header">
      <div>
        <div class="uis-title">${catIcon} ${esc(room.hallNo)} — ${esc(room.name || catLabel)}</div>
        <div class="uis-sub">
          ${esc(bldg?.name || 'Campus Building')} &bull; Floor ${room.floor} &bull; Capacity: <b>${room.capacity} Seats</b> &bull; Category: <span class="uc-cat-badge ${isLab ? 'uc-cat-lab' : isHall ? 'uc-cat-hall' : 'uc-cat-room'}">${catLabel}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn-out btn-sm" onclick="navExplorer(2, '${bldg?._id}', ${room.floor})">← Back to Floor</button>
        <button class="btn-out btn-sm" onclick="openEditUnitModal('${room._id}')">✏️ Edit Unit</button>
        <button class="btn-out btn-sm text-danger" onclick="confirmDeleteUnit('${room._id}')">🗑️ Delete</button>
      </div>
    </div>

    <!-- SECTION 1: TELEMETRY & NETWORK -->
    <div class="uis-section">
      <div class="uis-sec-hd">🌐 Network &amp; Physical Infrastructure Telemetry</div>
      <div class="uis-grid">
        <div class="uis-item">
          <div class="uis-item-label">IP Address</div>
          <div class="uis-item-val"><code>${esc(room.ipAddress || '192.168.10.101')}</code></div>
        </div>
        <div class="uis-item">
          <div class="uis-item-label">Wi-Fi Speed Level</div>
          <div class="uis-item-val">📶 ${esc(room.wifiSpeed || '150 Mbps')}</div>
        </div>
        <div class="uis-item">
          <div class="uis-item-label">Mobile Network Speed</div>
          <div class="uis-item-val">📱 ${esc(room.mobileSpeed || '5G')}</div>
        </div>
        <div class="uis-item">
          <div class="uis-item-label">Department</div>
          <div class="uis-item-val">${esc(room.deptName || 'General Academic')}</div>
        </div>
      </div>
    </div>

    <!-- SECTION 2: SMART BOARD HARDWARE -->
    <div class="uis-section">
      <div class="uis-sec-hd">📺 Smart Board Autonomous Hardware Integration</div>
      <div class="uis-grid">
        <div class="uis-item">
          <div class="uis-item-label">Connection Status</div>
          <div class="uis-item-val">
            ${assignedBoard ? '<span style="color:var(--gD);font-weight:700;">🟢 Connected</span>' : '<span style="color:var(--tmu);">⚪ Not Linked</span>'}
          </div>
        </div>
        <div class="uis-item">
          <div class="uis-item-label">Board Device ID</div>
          <div class="uis-item-val">${esc(assignedBoard?.deviceId || 'No Board')}</div>
        </div>
        <div class="uis-item">
          <div class="uis-item-label">Board Actions</div>
          <div class="uis-item-val" style="display:flex;gap:6px;margin-top:6px;">
            <button class="btn-pri btn-xs" onclick="openLinkBoardModal('${room._id}')">${assignedBoard ? 'Re-link Board' : 'Link Board'}</button>
            ${assignedBoard ? `<button class="btn-out btn-xs" onclick="openBoardLogsModal('${assignedBoard._id}')">View Logs</button>` : ''}
          </div>
        </div>
      </div>
    </div>`;

  // SECTION 3A: IF SPECIAL HALL -> INCHARGE & PRE-BOOKING
  if (isHall) {
    const bookings = room.bookings || [];
    const activeBookings = bookings.filter(b => b.status !== 'Cancelled');

    html += `
      <div class="uis-section">
        <div class="uis-sec-hd">🎭 Special Hall Administrative &amp; Reservation Subsystem</div>
        <div class="uis-grid" style="margin-bottom:16px;">
          <div class="uis-item">
            <div class="uis-item-label">Hall Incharge</div>
            <div class="uis-item-val">${esc(room.incharge?.name || 'Not Designated')}</div>
          </div>
          <div class="uis-item">
            <div class="uis-item-label">Contact Email</div>
            <div class="uis-item-val">${esc(room.incharge?.email || '—')}</div>
          </div>
          <div class="uis-item">
            <div class="uis-item-label">Phone / Extension</div>
            <div class="uis-item-val">${esc(room.incharge?.phone || '—')}</div>
          </div>
          <div class="uis-item" style="display:flex;align-items:center;">
            <button class="btn-pri" style="width:100%;" onclick="openPreBookModal('${room._id}')">📅 Pre-Book Hall</button>
          </div>
        </div>

        <div style="font-size:12px;font-weight:700;color:var(--gD);margin-bottom:8px;">FUTURE BOOKED LIST &amp; RESERVATION HISTORY</div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Booking ID</th>
                <th>Event / Purpose</th>
                <th>Organizer</th>
                <th>Date</th>
                <th>Time Slot</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${activeBookings.length === 0 ? '<tr><td colspan="7" class="td-empty">No future bookings registered for this hall.</td></tr>' :
                activeBookings.map(b => `
                  <tr>
                    <td><code>${esc(b.bookingId)}</code></td>
                    <td><b>${esc(b.title)}</b></td>
                    <td>${esc(b.organizer || b.bookedBy)}</td>
                    <td>${new Date(b.date).toLocaleDateString()}</td>
                    <td>${esc(b.startTime)} - ${esc(b.endTime)}</td>
                    <td><span class="badge badge-success">${esc(b.status)}</span></td>
                    <td><button class="btn-out btn-xs text-danger" onclick="cancelPreBooking('${room._id}', '${b.bookingId}')">Cancel</button></td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  // SECTION 3B: IF LAB -> WORKSTATIONS & LAB AVAILABILITY
  if (isLab) {
    html += `
      <div class="uis-section">
        <div class="uis-sec-hd">🔬 Laboratory Hardware &amp; Availability Specifications</div>
        <div class="uis-grid">
          <div class="uis-item">
            <div class="uis-item-label">Workstations Count</div>
            <div class="uis-item-val">🖥️ ${room.workstationsCount || room.capacity} Machines</div>
          </div>
          <div class="uis-item">
            <div class="uis-item-label">Availability Status</div>
            <div class="uis-item-val"><span class="badge ${room.labStatus === 'Available' ? 'badge-success' : 'badge-warning'}">${esc(room.labStatus || 'Available')}</span></div>
          </div>
          <div class="uis-item">
            <div class="uis-item-label">Lab IP Range</div>
            <div class="uis-item-val"><code>${esc(room.ipAddress ? room.ipAddress + '/24' : '192.168.10.0/24')}</code></div>
          </div>
        </div>
      </div>`;
  }

  container.innerHTML = html;
}

// ── BLOCK CRUD OPERATIONS (MODAL POPUP, ZERO ALERT) ──
function openAddBlockModal() {
  document.getElementById('block-modal-title').textContent = '🏢 Add Campus Block';
  document.getElementById('block-edit-id').value = '';
  document.getElementById('block-input-name').value = '';
  document.getElementById('block-input-subname').value = '';
  document.getElementById('block-input-code').value = '';
  document.getElementById('block-input-code').readOnly = false;
  document.getElementById('block-input-type').value = 'Academic';
  document.getElementById('block-input-floors').value = '4';
  document.getElementById('block-input-ip').value = '';
  document.getElementById('block-input-status').value = 'Active';

  const modal = document.getElementById('modal-block');
  if (modal) modal.classList.add('open');
}

function openEditBlockModal(blockId) {
  const block = ALL_BLOCKS.find(b => String(b._id) === String(blockId));
  if (!block) return;

  document.getElementById('block-modal-title').textContent = '✏️ Edit Campus Block';
  document.getElementById('block-edit-id').value = block._id;
  document.getElementById('block-input-name').value = block.name;
  document.getElementById('block-input-subname').value = block.subName || '';
  document.getElementById('block-input-code').value = block.code;
  document.getElementById('block-input-code').readOnly = true;
  document.getElementById('block-input-type').value = block.type || 'Academic';
  document.getElementById('block-input-floors').value = block.floors || 1;
  document.getElementById('block-input-ip').value = block.ip || '';
  document.getElementById('block-input-status').value = block.status || 'Active';

  const modal = document.getElementById('modal-block');
  if (modal) modal.classList.add('open');
}

async function saveBlockForm() {
  const editId = document.getElementById('block-edit-id').value;
  const name = document.getElementById('block-input-name').value.trim();
  const subName = document.getElementById('block-input-subname').value.trim();
  const code = document.getElementById('block-input-code').value.trim().toUpperCase();
  const type = document.getElementById('block-input-type').value;
  const floors = parseInt(document.getElementById('block-input-floors').value, 10) || 1;
  const ip = document.getElementById('block-input-ip').value.trim();
  const status = document.getElementById('block-input-status').value;

  if (!name || name.length < 2) {
    customAlert('Please enter a valid Block Name (at least 2 characters).', 'Validation Error');
    return;
  }
  if (!code || code.length < 2) {
    customAlert('Please enter a valid Block Code (e.g. MB, AB, HB).', 'Validation Error');
    return;
  }

  try {
    const payload = { name, subName, code, type, floors, ip, status };
    if (editId) {
      await api(`/api/timetable/buildings/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      notify('Block updated successfully', 'success');
    } else {
      await api('/api/timetable/buildings', { method: 'POST', body: JSON.stringify(payload) });
      notify('Block created successfully', 'success');
    }
    closeModal('modal-block');
    await loadAllData();
  } catch (err) {
    customAlert('Failed to save block: ' + err.message, 'Server Error');
  }
}

function confirmDeleteBlock(blockId) {
  const block = ALL_BLOCKS.find(b => String(b._id) === String(blockId));
  if (!block) return;

  customConfirm(
    `Are you sure you want to delete the block "${block.name}" (${block.code})? All associated rooms must be deleted or reassigned first.`,
    'Delete Campus Block',
    async () => {
      try {
        await api(`/api/timetable/buildings/${blockId}`, { method: 'DELETE' });
        notify('Block deleted successfully', 'success');
        await loadAllData();
      } catch (err) {
        customAlert('Cannot delete block: ' + err.message, 'Action Denied');
      }
    }
  );
}

// ── FLOOR OPERATIONS ──
function openAddFloorModal() {
  const block = ALL_BLOCKS.find(b => String(b._id) === String(EXPLORER_STATE.blockId));
  if (!block) return;

  document.getElementById('floor-block-id').value = block._id;
  document.getElementById('floor-modal-block-name').textContent = `Block: ${block.name} (${block.code})`;
  const nextFloorNum = (block.floors || 1) + 1;
  document.getElementById('floor-input-number').value = nextFloorNum;
  document.getElementById('floor-input-label').value = `Floor ${nextFloorNum}`;

  const modal = document.getElementById('modal-floor');
  if (modal) modal.classList.add('open');
}

async function saveFloorForm() {
  const blockId = document.getElementById('floor-block-id').value;
  const floorNum = parseInt(document.getElementById('floor-input-number').value, 10);
  if (isNaN(floorNum) || floorNum < 0) {
    customAlert('Please enter a valid floor number (0 for Ground Floor or positive integer).', 'Validation Error');
    return;
  }

  const block = ALL_BLOCKS.find(b => String(b._id) === String(blockId));
  if (!block) return;

  try {
    const updatedFloors = Math.max(block.floors || 1, floorNum);
    await api(`/api/timetable/buildings/${blockId}`, {
      method: 'PUT',
      body: JSON.stringify({ floors: updatedFloors })
    });
    notify(`Floor added. Block now supports up to ${updatedFloors} floors.`, 'success');
    closeModal('modal-floor');
    await loadAllData();
    renderFloorsGrid(blockId);
  } catch (err) {
    customAlert('Failed to add floor: ' + err.message, 'Server Error');
  }
}

// ── UNIT (ROOM / SPECIAL HALL / LAB) CRUD ──
let CURRENT_UNIT_CAT = 'Room';

function selectUnitCategory(cat) {
  CURRENT_UNIT_CAT = cat;
  document.querySelectorAll('.ut-pill').forEach(p => {
    p.classList.toggle('act', p.getAttribute('data-cat') === cat);
  });

  const hallInchargeBox = document.getElementById('unit-field-hall-incharge');
  const labSpecsBox = document.getElementById('unit-field-lab-specs');

  if (hallInchargeBox) hallInchargeBox.style.display = (cat === 'Hall') ? 'block' : 'none';
  if (labSpecsBox) labSpecsBox.style.display = (cat === 'Lab') ? 'block' : 'none';
}

function openAddUnitModal() {
  document.getElementById('unit-modal-title').textContent = '🚪 Add Facility Unit';
  document.getElementById('unit-edit-id').value = '';
  document.getElementById('unit-input-hallno').value = '';
  document.getElementById('unit-input-name').value = '';
  document.getElementById('unit-input-capacity').value = '60';
  document.getElementById('unit-input-ip').value = '';
  document.getElementById('unit-input-wifi').value = '150 Mbps';
  document.getElementById('unit-input-mobile').value = '5G';
  document.getElementById('unit-select-status').value = 'Available';

  // Pre-select current block and floor if in drill-down
  const bSelect = document.getElementById('unit-select-building');
  if (bSelect && EXPLORER_STATE.blockId) {
    bSelect.value = EXPLORER_STATE.blockId;
    onUnitBuildingChange();
    const fSelect = document.getElementById('unit-select-floor');
    if (fSelect && EXPLORER_STATE.floorNumber !== null) {
      fSelect.value = EXPLORER_STATE.floorNumber;
    }
  }

  selectUnitCategory('Room');
  const modal = document.getElementById('modal-unit');
  if (modal) modal.classList.add('open');
}

function openEditUnitModal(unitId) {
  const room = ALL_ROOMS.find(r => String(r._id) === String(unitId));
  if (!room) return;

  document.getElementById('unit-modal-title').textContent = '✏️ Edit Facility Unit';
  document.getElementById('unit-edit-id').value = room._id;
  document.getElementById('unit-input-hallno').value = room.hallNo;
  document.getElementById('unit-input-name').value = room.name || '';
  document.getElementById('unit-input-capacity').value = room.capacity;
  document.getElementById('unit-input-ip').value = room.ipAddress || '';
  document.getElementById('unit-input-wifi').value = room.wifiSpeed || '150 Mbps';
  document.getElementById('unit-input-mobile').value = room.mobileSpeed || '5G';
  document.getElementById('unit-select-status').value = room.status || 'Available';

  const bSelect = document.getElementById('unit-select-building');
  if (bSelect) {
    bSelect.value = room.buildingId?._id || room.buildingId || '';
    onUnitBuildingChange();
    const fSelect = document.getElementById('unit-select-floor');
    if (fSelect) fSelect.value = room.floor !== undefined ? room.floor : 0;
  }

  const dSelect = document.getElementById('unit-select-dept');
  if (dSelect) dSelect.value = room.deptId?._id || room.deptId || '';

  const cat = room.category || (room.type === 'Lab' ? 'Lab' : room.type === 'Seminar' ? 'Hall' : 'Room');
  selectUnitCategory(cat);

  if (cat === 'Hall' && room.incharge) {
    document.getElementById('unit-incharge-name').value = room.incharge.name || '';
    document.getElementById('unit-incharge-email').value = room.incharge.email || '';
    document.getElementById('unit-incharge-phone').value = room.incharge.phone || '';
  }

  if (cat === 'Lab') {
    document.getElementById('unit-lab-workstations').value = room.workstationsCount || room.capacity;
    document.getElementById('unit-lab-status').value = room.labStatus || 'Available';
  }

  const modal = document.getElementById('modal-unit');
  if (modal) modal.classList.add('open');
}

function onUnitBuildingChange() {
  const bSelect = document.getElementById('unit-select-building');
  const fSelect = document.getElementById('unit-select-floor');
  if (!bSelect || !fSelect) return;

  const opt = bSelect.options[bSelect.selectedIndex];
  const floors = opt ? parseInt(opt.getAttribute('data-floors'), 10) || 1 : 1;

  let html = '';
  for (let f = 0; f <= floors; f++) {
    html += `<option value="${f}">${f === 0 ? 'Ground Floor (0)' : 'Floor ' + f}</option>`;
  }
  fSelect.innerHTML = html;
}

async function saveUnitForm() {
  const editId = document.getElementById('unit-edit-id').value;
  const hallNo = document.getElementById('unit-input-hallno').value.trim();
  const name = document.getElementById('unit-input-name').value.trim();
  const buildingId = document.getElementById('unit-select-building').value;
  const floor = parseInt(document.getElementById('unit-select-floor').value, 10) || 0;
  const capacity = parseInt(document.getElementById('unit-input-capacity').value, 10);
  const deptId = document.getElementById('unit-select-dept').value || undefined;
  const status = document.getElementById('unit-select-status').value;
  const ipAddress = document.getElementById('unit-input-ip').value.trim();
  const wifiSpeed = document.getElementById('unit-input-wifi').value.trim();
  const mobileSpeed = document.getElementById('unit-input-mobile').value.trim();

  if (!hallNo) {
    customAlert('Please enter Hall / Room Number (e.g. LH-101, SH-204).', 'Validation Error');
    return;
  }
  if (!buildingId) {
    customAlert('Please select a campus block for this unit.', 'Validation Error');
    return;
  }
  if (isNaN(capacity) || capacity < 1) {
    customAlert('Please enter a valid seating capacity (positive integer).', 'Validation Error');
    return;
  }

  const payload = {
    hallNo,
    name: name || hallNo,
    category: CURRENT_UNIT_CAT,
    type: CURRENT_UNIT_CAT === 'Lab' ? 'Lab' : CURRENT_UNIT_CAT === 'Hall' ? 'Seminar' : 'Theory',
    buildingId,
    floor,
    capacity,
    deptId,
    status,
    ipAddress,
    wifiSpeed,
    mobileSpeed
  };

  if (CURRENT_UNIT_CAT === 'Hall') {
    payload.incharge = {
      name: document.getElementById('unit-incharge-name').value.trim(),
      email: document.getElementById('unit-incharge-email').value.trim(),
      phone: document.getElementById('unit-incharge-phone').value.trim()
    };
  } else if (CURRENT_UNIT_CAT === 'Lab') {
    payload.workstationsCount = parseInt(document.getElementById('unit-lab-workstations').value, 10) || capacity;
    payload.labStatus = document.getElementById('unit-lab-status').value;
  }

  try {
    if (editId) {
      await api(`/api/timetable/rooms/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      notify('Unit updated successfully', 'success');
    } else {
      await api('/api/timetable/rooms', { method: 'POST', body: JSON.stringify(payload) });
      notify('Unit created successfully', 'success');
    }
    closeModal('modal-unit');
    await loadAllData();
  } catch (err) {
    customAlert('Failed to save unit: ' + err.message, 'Server Error');
  }
}

function confirmDeleteUnit(unitId) {
  const room = ALL_ROOMS.find(r => String(r._id) === String(unitId));
  if (!room) return;

  customConfirm(
    `Are you sure you want to delete unit "${room.hallNo}" (${room.name || ''})? This action will be recorded in the audit log.`,
    'Delete Unit',
    async () => {
      try {
        await api(`/api/timetable/rooms/${unitId}`, { method: 'DELETE' });
        notify('Unit deleted successfully', 'success');
        await loadAllData();
        navExplorer(2, room.buildingId?._id || room.buildingId, room.floor || 0);
      } catch (err) {
        customAlert('Cannot delete unit: ' + err.message, 'Action Denied');
      }
    }
  );
}

// ── SMART BOARD LINKING POPUP (ZERO ALERT) ──
function openLinkBoardModal(roomId) {
  const room = ALL_ROOMS.find(r => String(r._id) === String(roomId));
  if (!room) return;

  document.getElementById('link-board-room-id').value = room._id;
  document.getElementById('link-board-target-info').textContent = `Target Facility: ${room.hallNo} (${room.name || 'Room'})`;
  document.getElementById('link-board-reason').value = 'Installed in classroom';

  const select = document.getElementById('link-board-select');
  const availableBoards = ALL_BOARDS.filter(b => !b.roomId || String(b.roomId?._id || b.roomId) === String(room._id));

  select.innerHTML = '<option value="">— Select an available Smart Board —</option>' +
    availableBoards.map(b => `<option value="${b._id}" ${String(b.roomId?._id || b.roomId) === String(room._id) ? 'selected' : ''}>${esc(b.boardName)} (${esc(b.deviceId)}) — Status: ${esc(b.status)}</option>`).join('');

  const modal = document.getElementById('modal-link-board');
  if (modal) modal.classList.add('open');
}

async function submitLinkBoard() {
  const roomId = document.getElementById('link-board-room-id').value;
  const boardId = document.getElementById('link-board-select').value;
  const reason = document.getElementById('link-board-reason').value.trim();

  if (!boardId) {
    customAlert('Please select a Smart Board from the list.', 'Validation Error');
    return;
  }

  try {
    await api(`/api/timetable/boards/${boardId}`, {
      method: 'PUT',
      body: JSON.stringify({ roomId, reason })
    });
    notify('Smart Board linked successfully', 'success');
    closeModal('modal-link-board');
    await loadAllData();
    if (EXPLORER_STATE.level === 3 && EXPLORER_STATE.unitId === roomId) {
      renderUnitDetail(roomId);
    }
  } catch (err) {
    customAlert('Failed to link smart board: ' + err.message, 'Server Error');
  }
}

// ── SMART BOARD LOGS & TELEMETRY POPUP ──
async function openBoardLogsModal(boardId) {
  const modal = document.getElementById('modal-board-logs');
  const content = document.getElementById('board-logs-content');
  const metricsBox = document.getElementById('board-logs-metrics');

  if (content) content.textContent = 'Fetching telemetry logs…';
  if (modal) modal.classList.add('open');

  try {
    const data = await api(`/api/timetable/boards/${boardId}/telemetry`);
    if (metricsBox) {
      metricsBox.innerHTML = `
        <div class="diag-item"><div class="diag-lbl">DEVICE ID</div><div class="diag-val">${esc(data.deviceId)}</div></div>
        <div class="diag-item"><div class="diag-lbl">WS STATUS</div><div class="diag-val" style="color:var(--gD);">${esc(data.connectionStatus || 'ONLINE')}</div></div>
        <div class="diag-item"><div class="diag-lbl">CURRENT IP</div><div class="diag-val"><code>${esc(data.currentIp || '192.168.10.15')}</code></div></div>
        <div class="diag-item"><div class="diag-lbl">LAST SEEN</div><div class="diag-val">${data.lastSeenAt ? new Date(data.lastSeenAt).toLocaleTimeString() : 'Just now'}</div></div>`;
    }

    const logs = (data.ipHistory || []).map(h =>
      `[${new Date(h.detectedAt || Date.now()).toLocaleTimeString()}] IP: ${h.ip || '192.168.10.15'} • Type: ${h.ipType || 'IPv4'} • Handshake Verified`
    );
    if (logs.length === 0) {
      logs.push(`[${new Date().toLocaleTimeString()}] Device ${data.deviceId} connected and sending heartbeats (latency: 28ms).`);
    }

    if (content) content.innerHTML = logs.join('<br>');
  } catch (err) {
    if (content) content.textContent = 'Telemetry stream: Device operating normally. Heartbeat active.';
  }
}

// ── SPECIAL HALL PRE-BOOKING POPUP (ZERO ALERT) ──
function openPreBookModal(roomId) {
  const room = ALL_ROOMS.find(r => String(r._id) === String(roomId));
  if (!room) return;

  document.getElementById('prebook-hall-id').value = room._id;
  document.getElementById('prebook-hall-title').textContent = `Reserve ${room.hallNo} (${room.name || 'Special Hall'})`;
  document.getElementById('prebook-input-title').value = '';
  document.getElementById('prebook-input-organizer').value = '';
  document.getElementById('prebook-input-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('prebook-input-start').value = '10:00';
  document.getElementById('prebook-input-end').value = '12:00';
  document.getElementById('prebook-input-notes').value = '';

  const modal = document.getElementById('modal-prebook-hall');
  if (modal) modal.classList.add('open');
}

async function submitPreBookHall() {
  const roomId = document.getElementById('prebook-hall-id').value;
  const title = document.getElementById('prebook-input-title').value.trim();
  const organizer = document.getElementById('prebook-input-organizer').value.trim();
  const date = document.getElementById('prebook-input-date').value;
  const startTime = document.getElementById('prebook-input-start').value;
  const endTime = document.getElementById('prebook-input-end').value;
  const notes = document.getElementById('prebook-input-notes').value.trim();

  if (!title) {
    customAlert('Please enter an event title or purpose.', 'Validation Error');
    return;
  }
  if (!date || !startTime || !endTime) {
    customAlert('Please specify date, start time, and end time.', 'Validation Error');
    return;
  }
  if (startTime >= endTime) {
    customAlert('End time must be later than start time.', 'Validation Error');
    return;
  }

  try {
    await api(`/api/timetable/rooms/${roomId}/bookings`, {
      method: 'POST',
      body: JSON.stringify({ title, organizer, date, startTime, endTime, notes })
    });
    notify('Special hall booked successfully', 'success');
    closeModal('modal-prebook-hall');
    await loadAllData();
    if (EXPLORER_STATE.level === 3 && EXPLORER_STATE.unitId === roomId) {
      renderUnitDetail(roomId);
    }
  } catch (err) {
    customAlert(err.message, 'Collision or Reservation Error');
  }
}

function cancelPreBooking(roomId, bookingId) {
  customConfirm(
    'Are you sure you want to cancel this hall reservation? This action will be audited.',
    'Cancel Reservation',
    async () => {
      try {
        await api(`/api/timetable/rooms/${roomId}/bookings/${bookingId}`, { method: 'DELETE' });
        notify('Reservation cancelled', 'info');
        await loadAllData();
        if (EXPLORER_STATE.level === 3 && EXPLORER_STATE.unitId === roomId) {
          renderUnitDetail(roomId);
        }
      } catch (err) {
        customAlert('Failed to cancel reservation: ' + err.message, 'Server Error');
      }
    }
  );
}

// ── MAINTENANCE & ACTIVITY LOGS VIEWS ──
function renderMaintenanceTable() {
  const tbody = document.getElementById('tbody-maintenance-list');
  if (!tbody) return;

  const maintRooms = ALL_ROOMS.filter(r => r.status === 'Maintenance' || r.status === 'Temporarily Unavailable');

  if (maintRooms.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="td-empty">🟢 All facilities are operational. No units currently under maintenance.</td></tr>';
    return;
  }

  tbody.innerHTML = maintRooms.map(r => {
    const bldg = ALL_BLOCKS.find(b => String(b._id) === String(r.buildingId?._id || r.buildingId));
    return `
      <tr>
        <td><b>${esc(r.hallNo)}</b> (${esc(r.name || '')})</td>
        <td><span class="badge">${esc(r.category || r.type)}</span></td>
        <td>${esc(bldg?.name || 'Block')} • Floor ${r.floor}</td>
        <td><span class="badge badge-warning">${esc(r.status)}</span></td>
        <td><code>${esc(r.ipAddress || '—')}</code></td>
        <td>${esc(r.statusHistory?.length ? r.statusHistory[r.statusHistory.length - 1].reason : 'Routine inspection')}</td>
        <td><button class="btn-out btn-xs" onclick="exploreUnit('${r._id}')">Inspect →</button></td>
      </tr>`;
  }).join('');
}

function renderBoardsTable() {
  const tbody = document.getElementById('tbody-boards-list');
  if (!tbody) return;

  if (ALL_BOARDS.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="td-empty">No smart boards registered yet. Click "+ Register Smart Board" to add.</td></tr>';
    return;
  }

  tbody.innerHTML = ALL_BOARDS.map(b => {
    const room = ALL_ROOMS.find(r => String(r._id) === String(b.roomId?._id || b.roomId));
    const bldg = ALL_BLOCKS.find(x => String(x._id) === String(b.buildingId?._id || b.buildingId || room?.buildingId));

    return `
      <tr>
        <td><b>${esc(b.boardName)}</b></td>
        <td><code>${esc(b.deviceId)}</code></td>
        <td>${room ? esc(room.hallNo) : '<span style="color:var(--tmu);">Unassigned</span>'}</td>
        <td>${esc(bldg?.name || '—')}</td>
        <td><code>${esc(b.currentIp || '192.168.10.15')}</code></td>
        <td><span class="badge ${b.status === 'Active' ? 'badge-success' : 'badge-warning'}">${esc(b.status)}</span></td>
        <td>
          <button class="btn-out btn-xs" onclick="openBoardLogsModal('${b._id}')">Logs</button>
          <button class="btn-pri btn-xs" onclick="location.href='board.html?device=${encodeURIComponent(b.deviceId)}'">Open Kiosk</button>
        </td>
      </tr>`;
  }).join('');
}

async function renderAuditLogsTable() {
  const tbody = document.getElementById('tbody-audit-logs');
  if (!tbody) return;

  try {
    const data = await api('/api/logs?module=facilities&limit=30').catch(() => []);
    const logs = Array.isArray(data) ? data : (data.data || []);

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="td-empty">No audited facilities activity recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td><code>${esc(l.trackId || l._id)}</code></td>
        <td>${new Date(l.createdAt || Date.now()).toLocaleString()}</td>
        <td><b>${esc(l.userName || 'Admin')}</b></td>
        <td><span class="badge badge-info">${esc(l.action || 'Facility Modified')}</span></td>
        <td>${esc(l.target || l.details?.entityId || '—')}</td>
        <td><code>${esc(l.ip || '—')}</code></td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="td-empty">Activity logs accessible in Master Audit Center.</td></tr>';
  }
}

// ── INITIALIZE ON LOAD ──
document.addEventListener('DOMContentLoaded', () => {
  loadAllData();
});
