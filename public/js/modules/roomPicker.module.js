/**
 * public/js/modules/roomPicker.module.js
 *
 * Hierarchical Smart Room Picker Component (Phase 4):
 * - Search by hall number, building, floor, or minimum capacity.
 * - Category tabs: All | Lecture Halls | Computer Labs.
 * - Hierarchical Building & Floor Tree view.
 * - Bold monospace chip (e.g. H-204), capacity/workstations info.
 * - Home Room Star badge (🌟 designated base classroom).
 * - Availability pill: Available (emerald), Busy (amber), Maintenance (muted grey 🔧).
 * - Strict type eligibility enforcement (disables ineligible rooms).
 * - Self-contained EAMS modal popup view window matching system design tokens.
 */

(function (window) {
  'use strict';

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const STYLES = `
/* ── ROOM PICKER POPUP MODAL (CAMPUS FACILITY REGISTRY) ────────── */
#room-picker-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 950;
  background: rgba(0, 0, 0, 0.48);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  opacity: 0;
  transition: opacity 0.2s ease;
  box-sizing: border-box;
}

#room-picker-modal-backdrop.rp-active {
  opacity: 1;
}

.rp-modal-window {
  position: relative;
  width: 94%;
  max-width: 820px;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border: 1px solid var(--br, rgba(27, 94, 32, 0.16));
  border-radius: 20px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24), 0 4px 16px rgba(0, 0, 0, 0.06);
  overflow: hidden;
  font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--td, #1a2e1a);
  transform: scale(0.96);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-sizing: border-box;
}

#room-picker-modal-backdrop.rp-active .rp-modal-window {
  transform: scale(1);
}

/* Header */
.rp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid var(--br, rgba(27, 94, 32, 0.12));
  background: #ffffff;
  flex-shrink: 0;
}

.rp-eyebrow {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--gM, #2e7d32);
}

.rp-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--td, #1a2e1a);
  margin: 3px 0 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.rp-lab-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 9999px;
  background: #ede9fe;
  color: #6d28d9;
  border: 1px solid #ddd6fe;
}

.rp-close-btn {
  background: none;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tmu, #5a7a5a);
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
  margin: 0;
}

.rp-close-btn:hover {
  background: var(--gLt, #e8f5e9);
  color: var(--td, #1a2e1a);
}

/* Filter Bar */
.rp-filter-bar {
  padding: 12px 24px;
  border-bottom: 1px solid var(--br, rgba(27, 94, 32, 0.1));
  background: var(--gP, #fbfdfb);
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  box-sizing: border-box;
}

.rp-search-wrap {
  position: relative;
  flex: 1;
  min-width: 240px;
}

.rp-search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--tmu, #5a7a5a);
  pointer-events: none;
}

.rp-search-input {
  width: 100%;
  height: 38px;
  padding: 0 12px 0 38px;
  background: #ffffff;
  border: 1.5px solid var(--br, rgba(27, 94, 32, 0.2));
  border-radius: 10px;
  font-size: 13px;
  font-family: inherit;
  color: var(--td, #1a2e1a);
  box-sizing: border-box;
  transition: all 0.15s ease;
  outline: none;
}

.rp-search-input::placeholder {
  color: #8da48d;
}

.rp-search-input:focus {
  border-color: var(--gM, #2e7d32);
  box-shadow: 0 0 0 3px rgba(46, 125, 50, 0.12);
}

.rp-category-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  background: #eef4ee;
  border: 1px solid var(--br, rgba(27, 94, 32, 0.15));
  border-radius: 10px;
}

.rp-tab-btn {
  border: none;
  background: transparent;
  padding: 6px 14px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--tmu, #5a7a5a);
  cursor: pointer;
  transition: all 0.15s ease;
}

.rp-tab-btn:hover {
  color: var(--gD, #1b5e20);
  background: rgba(27, 94, 32, 0.06);
}

.rp-tab-btn.active {
  background: var(--gD, #1b5e20);
  color: #ffffff;
  box-shadow: 0 2px 6px rgba(27, 94, 32, 0.25);
}

/* Body / Room List */
.rp-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  background: #fafdfa;
  min-height: 280px;
  max-height: 52vh;
  box-sizing: border-box;
}

.rp-body::-webkit-scrollbar {
  width: 6px;
}

.rp-body::-webkit-scrollbar-thumb {
  background: var(--gLr, #a5d6a7);
  border-radius: 3px;
}

.rp-body::-webkit-scrollbar-track {
  background: var(--gLt, #e8f5e9);
}

/* Loading State */
.rp-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 220px;
  color: var(--tmu, #5a7a5a);
  gap: 10px;
  font-size: 13px;
  font-weight: 500;
}

.rp-spinner {
  width: 20px;
  height: 20px;
  border: 2.5px solid var(--gLt, #e8f5e9);
  border-top-color: var(--gM, #2e7d32);
  border-radius: 50%;
  animation: rpSpin 0.75s linear infinite;
}

@keyframes rpSpin {
  to { transform: rotate(360deg); }
}

/* Empty State */
.rp-empty {
  text-align: center;
  padding: 48px 20px;
  color: var(--tmu, #5a7a5a);
}

.rp-empty-icon {
  width: 44px;
  height: 44px;
  margin: 0 auto 12px;
  color: #a5d6a7;
  display: block;
}

.rp-empty-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--td, #1a2e1a);
  margin-bottom: 4px;
}

.rp-empty-desc {
  font-size: 12px;
  color: var(--tmu, #5a7a5a);
}

/* Building Section */
.rp-building-section {
  margin-bottom: 20px;
}

.rp-building-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--gD, #1b5e20);
  padding-bottom: 7px;
  border-bottom: 1.5px solid var(--br, rgba(27, 94, 32, 0.12));
  margin-bottom: 12px;
}

.rp-building-icon {
  width: 15px;
  height: 15px;
  color: var(--gM, #2e7d32);
  flex-shrink: 0;
}

.rp-floor-section {
  margin-bottom: 14px;
  padding-left: 2px;
}

.rp-floor-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--tmu, #5a7a5a);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 8px;
}

/* Grid of Room Cards */
.rp-room-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 10px;
}

/* Room Card */
.rp-room-card {
  position: relative;
  background: #ffffff;
  border: 1.5px solid var(--br, rgba(27, 94, 32, 0.16));
  border-radius: 12px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
  text-align: left;
  transition: all 0.18s ease;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
  box-sizing: border-box;
}

.rp-room-card.is-clickable {
  cursor: pointer;
}

.rp-room-card.is-clickable:hover {
  border-color: var(--gM, #2e7d32);
  background: #ffffff;
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(27, 94, 32, 0.12);
}

.rp-room-card.is-selected {
  border-color: var(--gD, #1b5e20);
  background: var(--gLt, #e8f5e9);
  box-shadow: 0 4px 14px rgba(27, 94, 32, 0.18);
  cursor: pointer;
}

.rp-room-card.is-disabled {
  opacity: 0.55;
  background: #f8faf8;
  border-color: rgba(0, 0, 0, 0.08);
  cursor: not-allowed;
}

.rp-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.rp-chip-group {
  display: flex;
  align-items: center;
  gap: 5px;
}

.rp-hall-chip {
  font-family: 'DM Mono', monospace;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--gD, #1b5e20);
  background: var(--gLt, #e8f5e9);
  border: 1px solid var(--br, rgba(27, 94, 32, 0.22));
  padding: 2px 7px;
  border-radius: 6px;
  letter-spacing: 0.3px;
}

.rp-home-star {
  font-size: 13px;
  line-height: 1;
  cursor: help;
}

/* Status Badges */
.rp-status-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.rp-status-badge.available {
  background: #dcfce7;
  color: #15803d;
  border: 1px solid #bbf7d0;
}

.rp-status-badge.busy {
  background: #fef3c7;
  color: #b45309;
  border: 1px solid #fde68a;
}

.rp-status-badge.maintenance {
  background: #f1f5f9;
  color: #64748b;
  border: 1px solid #cbd5e1;
}

/* Room Name */
.rp-room-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--td, #1a2e1a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 1px 0;
}

/* Room Meta */
.rp-room-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--tmu, #5a7a5a);
  font-weight: 500;
  padding-top: 6px;
  border-top: 1px solid var(--brl, rgba(27, 94, 32, 0.08));
}

.rp-workstations {
  font-weight: 600;
  color: #6366f1;
}

.rp-ineligible-reason {
  font-size: 10px;
  color: #dc2626;
  font-style: italic;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

/* Footer */
.rp-footer {
  padding: 14px 24px;
  border-top: 1px solid var(--br, rgba(27, 94, 32, 0.12));
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  box-sizing: border-box;
}

.rp-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 11.5px;
  color: var(--tmu, #5a7a5a);
  font-weight: 500;
  flex-wrap: wrap;
}

.rp-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.rp-legend-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.rp-legend-dot.available { background: #15803d; }
.rp-legend-dot.busy { background: #b45309; }
.rp-legend-dot.maintenance { background: #64748b; }

.rp-cancel-btn {
  padding: 8px 18px;
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 600;
  border: 1.5px solid var(--br, rgba(27, 94, 32, 0.22));
  background: #ffffff;
  color: var(--td, #1a2e1a);
  cursor: pointer;
  transition: all 0.15s ease;
}

.rp-cancel-btn:hover {
  background: var(--gLt, #e8f5e9);
  color: var(--gD, #1b5e20);
  border-color: var(--gM, #2e7d32);
}
`;

  function ensureStyles() {
    if (!document.getElementById('room-picker-modal-styles')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'room-picker-modal-styles';
      styleEl.textContent = STYLES;
      document.head.appendChild(styleEl);
    }
  }

  let activeModal = null;
  let keydownHandler = null;

  async function open(options = {}) {
    const {
      slotType = 'Theory',
      isLab = false,
      classId = null,
      currentRoomId = null,
      onSelect = () => {}
    } = options;

    // Ensure CSS is present in document
    ensureStyles();

    // Remove existing modal if any
    close();

    // Create modal backdrop & container
    const modal = document.createElement('div');
    modal.id = 'room-picker-modal-backdrop';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'rp-modal-title');

    modal.innerHTML = `
      <div class="rp-modal-window">
        <!-- Header -->
        <div class="rp-header">
          <div>
            <div class="rp-eyebrow">Campus Facility Registry</div>
            <h3 class="rp-title" id="rp-modal-title">
              <span>Select Room for ${escapeHtml(slotType)} Slot</span>
              ${isLab ? '<span class="rp-lab-badge">Lab Required</span>' : ''}
            </h3>
          </div>
          <button type="button" id="rp-close-btn" class="rp-close-btn" aria-label="Close dialog" title="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <!-- Filter Bar & Category Tabs -->
        <div class="rp-filter-bar">
          <!-- Search box -->
          <div class="rp-search-wrap">
            <svg class="rp-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input type="text" id="rp-search-input" placeholder="Search hall number, building, floor..." class="rp-search-input" autocomplete="off" />
          </div>

          <!-- Category filter buttons -->
          <div class="rp-category-tabs" id="rp-category-tabs" role="tablist">
            <button type="button" data-cat="all" class="rp-tab-btn active" role="tab" aria-selected="true">All</button>
            <button type="button" data-cat="lecture" class="rp-tab-btn" role="tab" aria-selected="false">Halls</button>
            <button type="button" data-cat="lab" class="rp-tab-btn" role="tab" aria-selected="false">Labs</button>
          </div>
        </div>

        <!-- Room List / Tree View -->
        <div id="rp-rooms-container" class="rp-body">
          <div class="rp-loading">
            <div class="rp-spinner"></div>
            <span>Loading registered campus rooms...</span>
          </div>
        </div>

        <!-- Footer -->
        <div class="rp-footer">
          <div class="rp-legend">
            <span class="rp-legend-item"><span class="rp-legend-dot available"></span> Available</span>
            <span class="rp-legend-item"><span class="rp-legend-dot busy"></span> Busy</span>
            <span class="rp-legend-item"><span class="rp-legend-dot maintenance"></span> Maintenance</span>
            <span class="rp-legend-item">🌟 Home Classroom</span>
          </div>
          <button type="button" id="rp-cancel-btn" class="rp-cancel-btn">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    activeModal = modal;

    // Trigger smooth scale & fade in
    requestAnimationFrame(() => {
      modal.classList.add('rp-active');
    });

    // Close actions
    modal.querySelector('#rp-close-btn').addEventListener('click', close);
    modal.querySelector('#rp-cancel-btn').addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    // Escape key handler
    keydownHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', keydownHandler);

    // Focus search input
    setTimeout(() => {
      const inp = modal.querySelector('#rp-search-input');
      if (inp) inp.focus();
    }, 120);

    // Fetch eligible rooms
    let allRooms = [];
    try {
      const qParams = new URLSearchParams({
        slotType,
        isLab: isLab ? 'true' : 'false'
      });
      if (classId) qParams.append('classId', classId);

      const res = await fetch(`/api/timetable/rooms/eligible?${qParams.toString()}`);
      const json = await res.json();
      allRooms = (json.ok && Array.isArray(json.data)) ? json.data : [];
      renderRoomsList(allRooms, onSelect, currentRoomId);
    } catch (err) {
      const container = modal.querySelector('#rp-rooms-container');
      if (container) {
        container.innerHTML = `
          <div style="padding:16px;border-radius:12px;background:#fef2f2;border:1.5px solid #fecaca;color:#991b1b;font-size:13px;font-weight:500;">
            <b>Error loading rooms:</b> ${escapeHtml(err.message)}
          </div>
        `;
      }
      return;
    }

    // Filter Logic
    const searchInput = modal.querySelector('#rp-search-input');
    const tabButtons = modal.querySelectorAll('.rp-tab-btn');
    let currentCategory = 'all';

    function applyFilters() {
      const query = (searchInput.value || '').trim().toLowerCase();
      const filtered = allRooms.filter(r => {
        // Category filter
        if (currentCategory === 'lecture' && r.category !== 'Room' && r.category !== 'Hall') return false;
        if (currentCategory === 'lab' && r.category !== 'Lab' && r.type !== 'Lab') return false;

        // Search query
        if (query) {
          const matchHall = (r.hallNo || '').toLowerCase().includes(query);
          const matchName = (r.name || '').toLowerCase().includes(query);
          const matchBuilding = (r.buildingName || '').toLowerCase().includes(query);
          const matchFloor = `floor ${r.floor}`.toLowerCase().includes(query) || `${r.floor}` === query;
          if (!matchHall && !matchName && !matchBuilding && !matchFloor) return false;
        }

        return true;
      });

      renderRoomsList(filtered, onSelect, currentRoomId);
    }

    searchInput.addEventListener('input', applyFilters);

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tabButtons.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        currentCategory = btn.getAttribute('data-cat') || 'all';
        applyFilters();
      });
    });
  }

  function renderRoomsList(rooms, onSelect, currentRoomId) {
    if (!activeModal) return;
    const container = activeModal.querySelector('#rp-rooms-container');
    if (!container) return;

    if (!rooms.length) {
      container.innerHTML = `
        <div class="rp-empty">
          <svg class="rp-empty-icon" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5m-4 0h4"></path>
          </svg>
          <div class="rp-empty-title">No matching rooms found</div>
          <div class="rp-empty-desc">Try relaxing your search terms or selecting a different category.</div>
        </div>
      `;
      return;
    }

    // Group by Building and Floor
    const buildingsMap = new Map();
    rooms.forEach(r => {
      const bName = r.buildingName || 'Academic Complex';
      if (!buildingsMap.has(bName)) {
        buildingsMap.set(bName, new Map());
      }
      const floorMap = buildingsMap.get(bName);
      const floorNum = r.floor !== undefined ? r.floor : 0;
      if (!floorMap.has(floorNum)) {
        floorMap.set(floorNum, []);
      }
      floorMap.get(floorNum).push(r);
    });

    let html = '';

    buildingsMap.forEach((floorMap, buildingName) => {
      html += `
        <div class="rp-building-section">
          <div class="rp-building-title">
            <svg class="rp-building-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
              <line x1="9" y1="22" x2="9" y2="12"></line>
              <line x1="15" y1="22" x2="15" y2="12"></line>
              <line x1="9" y1="12" x2="15" y2="12"></line>
              <line x1="8" y1="6" x2="10" y2="6"></line>
              <line x1="14" y1="6" x2="16" y2="6"></line>
              <line x1="8" y1="9" x2="10" y2="9"></line>
              <line x1="14" y1="9" x2="16" y2="9"></line>
            </svg>
            <span>${escapeHtml(buildingName)}</span>
          </div>
      `;

      floorMap.forEach((floorRooms, floorNum) => {
        const floorLabel = floorNum === 0 ? 'Ground Floor' : `Floor ${floorNum}`;
        html += `
          <div class="rp-floor-section">
            <div class="rp-floor-title">${floorLabel}</div>
            <div class="rp-room-grid">
        `;

        floorRooms.forEach(room => {
          const isSelected = currentRoomId && String(room._id) === String(currentRoomId);
          const isEligible = room.eligible !== false;
          const status = room.status || 'Available';
          const isMaintenance = status.toLowerCase() === 'maintenance';

          let statusBadge = '';
          if (isMaintenance) {
            statusBadge = `<span class="rp-status-badge maintenance" title="Room under maintenance">🔧 Maint</span>`;
          } else if (status.toLowerCase() === 'occupied' || status.toLowerCase() === 'busy') {
            statusBadge = `<span class="rp-status-badge busy" title="Currently scheduled">Busy</span>`;
          } else {
            statusBadge = `<span class="rp-status-badge available" title="Available for booking">Available</span>`;
          }

          let cardClasses = 'rp-room-card';
          if (!isEligible || isMaintenance) {
            cardClasses += ' is-disabled';
          } else if (isSelected) {
            cardClasses += ' is-selected';
          } else {
            cardClasses += ' is-clickable';
          }

          html += `
            <div class="${cardClasses}" data-room-id="${escapeHtml(room._id)}" data-eligible="${isEligible}" data-maintenance="${isMaintenance}">
              <div class="rp-card-top">
                <div class="rp-chip-group">
                  <span class="rp-hall-chip">${escapeHtml(room.hallNo)}</span>
                  ${room.isHomeRoom ? '<span title="Designated Home Classroom" class="rp-home-star">🌟</span>' : ''}
                </div>
                ${statusBadge}
              </div>

              <div class="rp-room-name" title="${escapeHtml(room.name || room.hallNo)}">
                ${escapeHtml(room.name || room.category)}
              </div>

              <div class="rp-room-meta">
                <span>${escapeHtml(room.category || 'Hall')} · ${room.capacity || 60} seats</span>
                ${room.workstationsCount ? `<span class="rp-workstations">🖥️ ${room.workstationsCount}</span>` : ''}
              </div>

              ${!isEligible ? `<div class="rp-ineligible-reason" title="${escapeHtml(room.eligibilityReason || 'Ineligible')}">${escapeHtml(room.eligibilityReason || 'Ineligible')}</div>` : ''}
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      });

      html += `
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach click listeners to room cards
    container.querySelectorAll('[data-room-id]').forEach(card => {
      card.addEventListener('click', () => {
        const isEligible = card.getAttribute('data-eligible') === 'true';
        const isMaintenance = card.getAttribute('data-maintenance') === 'true';
        if (!isEligible || isMaintenance) return;

        const roomId = card.getAttribute('data-room-id');
        const selected = rooms.find(r => String(r._id) === String(roomId));
        if (selected) {
          onSelect(selected);
          close();
        }
      });
    });
  }

  function close() {
    if (keydownHandler) {
      window.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
    if (activeModal && activeModal.parentNode) {
      activeModal.classList.remove('rp-active');
      const target = activeModal;
      setTimeout(() => {
        if (target && target.parentNode) {
          target.parentNode.removeChild(target);
        }
      }, 180);
    }
    activeModal = null;
  }

  window.RoomPicker = {
    open,
    close
  };

})(window);
