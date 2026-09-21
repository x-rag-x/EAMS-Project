function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ══════════════════════════════════════════════════════════════════════════════
// CAMPUS ROOMS & BUILDINGS MANAGEMENT PAGE (rooms.page.js)
// ══════════════════════════════════════════════════════════════════════════════

let ALL_ROOMS = [];
let ALL_BUILDINGS = [];
let ALL_DEPTS = [];
let CURRENT_TAB = 'rooms';

document.addEventListener('DOMContentLoaded', async () => {
  const user = checkAuth('any');
  if (!user) return;

  await Promise.all([
    fetchBuildings(),
    fetchDepts()
  ]);
  await fetchRooms();

  initEventListeners();
});

function ah() {
  return { 'Authorization': `Bearer ${SESSION.token}` };
}

function e(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function fetchRooms() {
  try {
    const res = await fetch('/api/timetable/rooms', { headers: ah() });
    ALL_ROOMS = await res.json();
    renderKPIs();
    filterRoomsList();
    renderOverview();
  } catch (err) {
    console.error('Failed to load rooms', err);
    dbtoast('Failed to load rooms list', 'error');
  }
}

async function fetchBuildings() {
  try {
    const res = await fetch('/api/timetable/buildings', { headers: ah() });
    ALL_BUILDINGS = await res.json();
    populateBuildingSelects();
    renderBuildingsGrid();
  } catch (err) {
    console.error('Failed to load buildings', err);
  }
}

async function fetchDepts() {
  try {
    const res = await fetch('/api/departments', { headers: ah() });
    ALL_DEPTS = await res.json();
    const deptSel = document.getElementById('room-input-dept');
    if (deptSel) {
      ALL_DEPTS.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d._id;
        opt.textContent = `${d.name} (${d.code || ''})`;
        opt.dataset.name = d.name;
        deptSel.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Failed to load departments', err);
  }
}

function populateBuildingSelects() {
  const filterSel = document.getElementById('room-filter-building');
  const inputSel = document.getElementById('room-input-building');

  if (filterSel) {
    filterSel.innerHTML = '<option value="">All Buildings</option>';
    ALL_BUILDINGS.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b._id;
      opt.textContent = `${b.name} (${b.code})`;
      filterSel.appendChild(opt);
    });
  }

  if (inputSel) {
    inputSel.innerHTML = '<option value="">— Select Building —</option>';
    ALL_BUILDINGS.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b._id;
      opt.textContent = `${b.name} (${b.code})`;
      opt.dataset.name = b.name;
      inputSel.appendChild(opt);
    });
  }
}

function renderKPIs() {
  const total = ALL_ROOMS.length;
  const labs = ALL_ROOMS.filter(r => r.type === 'Lab').length;
  const theory = ALL_ROOMS.filter(r => r.type === 'Theory').length;
  const capacity = ALL_ROOMS.reduce((sum, r) => sum + (Number(r.capacity) || 0), 0);

  document.getElementById('kpi-total-rooms').textContent = total;
  document.getElementById('kpi-total-labs').textContent = labs;
  document.getElementById('kpi-theory-rooms').textContent = theory;
  document.getElementById('kpi-total-capacity').textContent = capacity.toLocaleString('en-IN');
}

function filterRoomsList() {
  const q = (document.getElementById('room-search')?.value || '').toLowerCase().trim();
  const type = document.getElementById('room-filter-type')?.value || '';
  const buildingId = document.getElementById('room-filter-building')?.value || '';

  const filtered = ALL_ROOMS.filter(r => {
    const matchesQ = !q || (r.hallNo || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q);
    const matchesType = !type || r.type === type;
    const matchesBldg = !buildingId || String(r.buildingId) === String(buildingId);
    return matchesQ && matchesType && matchesBldg;
  });

  document.getElementById('room-filtered-count').textContent = `Showing ${filtered.length} of ${ALL_ROOMS.length} rooms`;

  const tbody = document.getElementById('tbody-rooms');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--tdi);">No rooms match your filter</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td><strong>${e(r.hallNo)}</strong></td>
      <td>${e(r.name || '—')}</td>
      <td><span class="c-badge ${r.type?.toLowerCase() || 'theory'}">${e(r.type || 'Theory')}</span></td>
      <td>${e(r.buildingName || '—')}</td>
      <td>Floor ${r.floor || 1}</td>
      <td><strong>${r.capacity || '—'}</strong> seats</td>
      <td>${e(r.deptName || 'General Pool')}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-outline btn-xs" onclick="openEditRoomModal('${r._id}')">✏️ Edit</button>
          <button class="btn btn-danger btn-xs" onclick="deleteRoom('${r._id}')">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}
window.filterRoomsList = filterRoomsList;

function renderBuildingsGrid() {
  const grid = document.getElementById('buildings-grid');
  if (!grid) return;

  if (!ALL_BUILDINGS.length) {
    grid.innerHTML = `<div style="text-align:center;padding:32px;color:var(--tdi);grid-column:1/-1;">No campus buildings registered yet. Click "Add Building" to create one.</div>`;
    return;
  }

  grid.innerHTML = ALL_BUILDINGS.map(b => {
    const roomCount = ALL_ROOMS.filter(r => String(r.buildingId) === String(b._id)).length;
    return `
      <div class="building-card">
        <div>
          <span class="bldg-tag">${e(b.code)}</span>
          <div class="bldg-name">${e(b.name)}</div>
          <div class="bldg-meta">
            🏢 ${b.floors || 1} Floors · 🏛️ ${roomCount} Facilities Assigned
          </div>
        </div>
        <div class="bldg-acts">
          <button class="btn btn-outline btn-xs" onclick="openEditBuildingModal('${b._id}')">✏️ Edit</button>
          <button class="btn btn-danger btn-xs" onclick="deleteBuilding('${b._id}')">🗑️ Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderOverview() {
  const container = document.getElementById('overview-content');
  if (!container) return;

  const bldgStats = ALL_BUILDINGS.map(b => {
    const roomsInBldg = ALL_ROOMS.filter(r => String(r.buildingId) === String(b._id));
    const cap = roomsInBldg.reduce((s, r) => s + (Number(r.capacity) || 0), 0);
    const labs = roomsInBldg.filter(r => r.type === 'Lab').length;
    return {
      name: b.name,
      code: b.code,
      count: roomsInBldg.length,
      capacity: cap,
      labs
    };
  });

  container.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:var(--td);margin-bottom:12px;">Building Capacity Distribution</div>
    <table class="tbl">
      <thead>
        <tr>
          <th>Building Block</th>
          <th>Code</th>
          <th>Total Rooms</th>
          <th>Labs</th>
          <th>Total Seating Capacity</th>
        </tr>
      </thead>
      <tbody>
        ${bldgStats.map(bs => `
          <tr>
            <td><strong>${e(bs.name)}</strong></td>
            <td><span class="bldg-tag">${e(bs.code)}</span></td>
            <td>${bs.count}</td>
            <td>${bs.labs}</td>
            <td><strong>${bs.capacity.toLocaleString('en-IN')}</strong> seats</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function switchRoomTab(tab) {
  CURRENT_TAB = tab;
  ['rooms', 'buildings', 'overview'].forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const view = document.getElementById(`view-tab-${t}`);
    if (btn) btn.classList.toggle('act', t === tab);
    if (view) view.style.display = (t === tab) ? 'block' : 'none';
  });

  const primaryBtn = document.getElementById('btn-add-primary');
  if (primaryBtn) {
    if (tab === 'buildings') {
      primaryBtn.textContent = '➕ Add Building';
    } else {
      primaryBtn.textContent = '➕ Add Room';
    }
  }
}
window.switchRoomTab = switchRoomTab;

function onPrimaryAddClick() {
  if (CURRENT_TAB === 'buildings') {
    openAddBuildingModal();
  } else {
    openAddRoomModal();
  }
}
window.onPrimaryAddClick = onPrimaryAddClick;

// ROOM MODAL & CRUD
function openAddRoomModal() {
  document.getElementById('room-modal-title').textContent = 'Add Classroom / Lab';
  document.getElementById('room-edit-id').value = '';
  document.getElementById('room-input-hall').value = '';
  document.getElementById('room-input-name').value = '';
  document.getElementById('room-input-type').value = 'Theory';
  document.getElementById('room-input-capacity').value = '60';
  document.getElementById('room-input-floor').value = '1';
  document.getElementById('room-input-building').value = '';
  document.getElementById('room-input-dept').value = '';
  openModal('modal-room');
}
window.openAddRoomModal = openAddRoomModal;

function openEditRoomModal(id) {
  const room = ALL_ROOMS.find(r => String(r._id) === String(id));
  if (!room) return;
  document.getElementById('room-modal-title').textContent = 'Edit Classroom / Lab';
  document.getElementById('room-edit-id').value = room._id;
  document.getElementById('room-input-hall').value = room.hallNo || '';
  document.getElementById('room-input-name').value = room.name || '';
  document.getElementById('room-input-type').value = room.type || 'Theory';
  document.getElementById('room-input-capacity').value = room.capacity || '60';
  document.getElementById('room-input-floor').value = room.floor || '1';
  document.getElementById('room-input-building').value = room.buildingId || '';
  document.getElementById('room-input-dept').value = room.deptId || '';
  openModal('modal-room');
}
window.openEditRoomModal = openEditRoomModal;

async function saveRoomForm() {
  const id = document.getElementById('room-edit-id').value;
  const hallNo = document.getElementById('room-input-hall').value.trim();
  if (!hallNo) { dbtoast('Hall number is required', 'error'); return; }

  const bldgSel = document.getElementById('room-input-building');
  const deptSel = document.getElementById('room-input-dept');

  const payload = {
    hallNo,
    name: document.getElementById('room-input-name').value.trim(),
    type: document.getElementById('room-input-type').value,
    capacity: Number(document.getElementById('room-input-capacity').value) || 60,
    floor: Number(document.getElementById('room-input-floor').value) || 1,
    buildingId: bldgSel.value || null,
    buildingName: bldgSel.selectedOptions[0]?.dataset?.name || '',
    deptId: deptSel.value || null,
    deptName: deptSel.selectedOptions[0]?.dataset?.name || ''
  };

  try {
    const url = id ? `/api/timetable/rooms/${id}` : '/api/timetable/rooms';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { ...ah(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      dbtoast(id ? 'Room updated ✓' : 'Room created ✓', 'success');
      closeModal('modal-room');
      await fetchRooms();
    } else {
      const err = await res.json();
      dbtoast(err.error || 'Failed to save room', 'error');
    }
  } catch (err) {
    dbtoast('Network error saving room', 'error');
  }
}
window.saveRoomForm = saveRoomForm;

async function deleteRoom(id) {
  if (!confirm('Are you sure you want to remove this room?')) return;
  try {
    const res = await fetch(`/api/timetable/rooms/${id}`, {
      method: 'DELETE',
      headers: ah()
    });
    if (res.ok) {
      dbtoast('Room deleted', 'info');
      await fetchRooms();
    } else {
      dbtoast('Failed to delete room', 'error');
    }
  } catch (err) {
    dbtoast('Network error deleting room', 'error');
  }
}
window.deleteRoom = deleteRoom;

// BUILDING MODAL & CRUD
function openAddBuildingModal() {
  document.getElementById('building-modal-title').textContent = 'Add Campus Building';
  document.getElementById('building-edit-id').value = '';
  document.getElementById('building-input-name').value = '';
  document.getElementById('building-input-code').value = '';
  document.getElementById('building-input-floors').value = '4';
  openModal('modal-building');
}
window.openAddBuildingModal = openAddBuildingModal;

function openEditBuildingModal(id) {
  const bldg = ALL_BUILDINGS.find(b => String(b._id) === String(id));
  if (!bldg) return;
  document.getElementById('building-modal-title').textContent = 'Edit Campus Building';
  document.getElementById('building-edit-id').value = bldg._id;
  document.getElementById('building-input-name').value = bldg.name || '';
  document.getElementById('building-input-code').value = bldg.code || '';
  document.getElementById('building-input-floors').value = bldg.floors || 4;
  openModal('modal-building');
}
window.openEditBuildingModal = openEditBuildingModal;

async function saveBuildingForm() {
  const id = document.getElementById('building-edit-id').value;
  const name = document.getElementById('building-input-name').value.trim();
  const code = document.getElementById('building-input-code').value.trim().toUpperCase();
  if (!name || !code) { dbtoast('Building name and code are required', 'error'); return; }

  const payload = {
    name,
    code,
    floors: Number(document.getElementById('building-input-floors').value) || 4
  };

  try {
    const url = id ? `/api/timetable/buildings/${id}` : '/api/timetable/buildings';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { ...ah(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      dbtoast(id ? 'Building updated ✓' : 'Building created ✓', 'success');
      closeModal('modal-building');
      await fetchBuildings();
      await fetchRooms();
    } else {
      const err = await res.json();
      dbtoast(err.error || 'Failed to save building', 'error');
    }
  } catch (err) {
    dbtoast('Network error saving building', 'error');
  }
}
window.saveBuildingForm = saveBuildingForm;

async function deleteBuilding(id) {
  if (!confirm('Are you sure you want to remove this building block?')) return;
  try {
    const res = await fetch(`/api/timetable/buildings/${id}`, {
      method: 'DELETE',
      headers: ah()
    });
    if (res.ok) {
      dbtoast('Building removed', 'info');
      await fetchBuildings();
      await fetchRooms();
    } else {
      dbtoast('Failed to delete building', 'error');
    }
  } catch (err) {
    dbtoast('Network error deleting building', 'error');
  }
}
window.deleteBuilding = deleteBuilding;

function initEventListeners() {
  // ESC to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal('modal-room');
      closeModal('modal-building');
    }
  });
}
