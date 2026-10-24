// ── EAMS WARDEN HOSTEL PORTAL PAGE LOGIC ──

let currentRollCall = null;
let currentRoster = [];
let qrInterval = null;
let wakeLock = null;
let activeCallTarget = null;

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
  initHostelPage();
  setupTabs();
  setupCorridorMode();
});

async function initHostelPage() {
  const loader = document.getElementById('page-loader');
  try {
    const res = await apiCall('GET', '/hostel/rollcalls/today');
    if (res && res.data) {
      currentRollCall = res.data;
      updateHeaderAndStatus();
      await loadRosterSheet();
      await loadPendingLeavesCount();
    }
  } catch (err) {
    showToast(err.message || 'Failed to initialize roll call', 'error');
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

function updateHeaderAndStatus() {
  if (!currentRollCall) return;
  const rc = currentRollCall;
  const block = rc.blockId || {};

  document.getElementById('block-name-display').textContent = block.name ? `${block.name} (${block.code || ''})` : 'Hostel Block';
  document.getElementById('hostel-block-badge').textContent = `Night Roll Call · ${rc.date}`;

  const pill = document.getElementById('rollcall-status-pill');
  pill.textContent = rc.status.toUpperCase();
  pill.className = `hostel-status-pill ${rc.status}`;

  const openBtn = document.getElementById('open-rollcall-btn');
  const qrBtn = document.getElementById('show-lobby-qr-btn');
  const closeBtn = document.getElementById('close-rollcall-btn');
  const verifyBtn = document.getElementById('verify-rollcall-btn');

  openBtn.style.display = rc.status === 'scheduled' ? 'inline-flex' : 'none';
  qrBtn.style.display = rc.status === 'open' ? 'inline-flex' : 'none';
  closeBtn.style.display = rc.status === 'open' ? 'inline-flex' : 'none';
  verifyBtn.style.display = rc.status === 'closed' ? 'inline-flex' : 'none';

  updateStats(rc.counts);
}

function updateStats(counts = {}) {
  document.getElementById('stat-total').textContent = counts.total || 0;
  document.getElementById('stat-present').textContent = counts.present || 0;
  document.getElementById('stat-late').textContent = counts.late || 0;
  document.getElementById('stat-leave').textContent = counts.leave || 0;
  document.getElementById('stat-medical').textContent = counts.medical || 0;
  document.getElementById('stat-excused').textContent = counts.excused || 0;
  document.getElementById('stat-absent').textContent = counts.absent || 0;
}

async function loadRosterSheet() {
  if (!currentRollCall) return;
  try {
    const res = await apiCall('GET', `/hostel/rollcalls/${currentRollCall._id}/sheet`);
    if (res && res.data) {
      currentRoster = res.data.sheet || [];
      renderRoster();
    }
  } catch (err) {
    showToast(err.message || 'Failed to load resident roster', 'error');
  }
}

function renderRoster() {
  const container = document.getElementById('roster-cards-container');
  const searchQ = (document.getElementById('roster-search')?.value || '').toLowerCase().trim();
  const filterStatus = document.getElementById('roster-filter-status')?.value || 'all';

  const filtered = currentRoster.filter(item => {
    const s = item.student || {};
    const room = item.roomId || {};
    const name = (s.fullName || '').toLowerCase();
    const regNo = (s.registerNo || '').toLowerCase();
    const rNo = (room.roomNo || '').toLowerCase();

    const matchesSearch = !searchQ || name.includes(searchQ) || regNo.includes(searchQ) || rNo.includes(searchQ);
    if (!matchesSearch) return false;

    if (filterStatus === 'all') return true;
    if (filterStatus === 'unmarked') return item.status.includes('Absent');
    if (filterStatus === 'spot-check') return item.isSpotCheck;
    return item.status === filterStatus;
  });

  if (!filtered.length) {
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--hostel-muted);font-weight:600;">No residents matching current filters.</div>';
    return;
  }

  container.innerHTML = filtered.map(item => {
    const s = item.student || {};
    const room = item.roomId || {};
    const isLocked = item.locked;
    const isSpot = item.isSpotCheck;
    const parentPhone = (s.guardians && s.guardians[0] && s.guardians[0].phone) || s.phone || '';

    let statusPillClass = 'pri';
    if (item.status === 'Present') statusPillClass = 'succ';
    else if (item.status === 'Late') statusPillClass = 'warn';
    else if (item.status.includes('Absent')) statusPillClass = 'danger';
    else if (item.status === 'On leave') statusPillClass = 'info';

    return `
      <div class="resident-card ${isSpot ? 'spot-check-flag' : ''}">
        <div class="resident-header">
          <div class="resident-info">
            <div class="resident-avatar">${esc((s.fullName || '?')[0])}</div>
            <div>
              <div class="resident-name">${esc(s.fullName || 'Resident')}</div>
              <div class="resident-sub">${esc(s.registerNo || item.studentTrackId)} · ${esc(s.class || '')}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <span class="room-bed-pill">Room ${esc(room.roomNo || 'N/A')}</span>
            <div style="margin-top:4px;">
              <span class="pill ${statusPillClass}" style="font-size:10.5px;">${esc(item.status)}</span>
            </div>
          </div>
        </div>

        ${isSpot ? '<div style="font-size:11px;font-weight:700;color:#d97706;"><re-icon icon="alert-triangle"></re-icon> Selected for In-Person Spot Check</div>' : ''}
        ${item.note ? `<div style="font-size:11.5px;color:var(--hostel-muted);font-style:italic;">Note: ${esc(item.note)}</div>` : ''}

        <div class="resident-actions">
          ${!isLocked ? `
            <button type="button" class="quick-btn btn-present" onclick="quickMark('${esc(item.studentTrackId)}', 'Present')"><re-icon icon="check"></re-icon> Present</button>
            <button type="button" class="quick-btn btn-late" onclick="quickMark('${esc(item.studentTrackId)}', 'Late')"><re-icon icon="timer"></re-icon> Late</button>
            <button type="button" class="quick-btn btn-absent" onclick="quickMark('${esc(item.studentTrackId)}', 'Absent (confirmed)')"><re-icon icon="x"></re-icon> Absent</button>
          ` : '<span style="font-size:11px;color:var(--hostel-muted);font-weight:600;"><re-icon icon="lock"></re-icon> Locked (Approved Pass/Medical)</span>'}

          ${parentPhone ? `
            <button type="button" class="quick-btn btn-call" onclick="openCallModal('${esc(item.studentTrackId)}', '${esc(parentPhone)}', '${esc(s.fullName)}')"><re-icon icon="monitor"></re-icon> Call Parent</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Quick Mark Attendance Exception
async function quickMark(studentTrackId, status) {
  if (!currentRollCall) return;
  try {
    const res = await apiCall('POST', `/hostel/rollcalls/${currentRollCall._id}/mark`, {
      items: [{ studentTrackId, status, note: `Marked ${status} by warden` }]
    });
    if (res && res.ok) {
      showToast(`Marked ${status}`, 'success');
      currentRollCall.counts = res.counts || currentRollCall.counts;
      updateStats(currentRollCall.counts);
      // Update item in local roster
      const rec = currentRoster.find(r => r.studentTrackId === studentTrackId);
      if (rec) rec.status = status;
      renderRoster();
    }
  } catch (err) {
    showToast(err.message || 'Failed to update status', 'error');
  }
}

// Open Roll Call Handler
document.getElementById('open-rollcall-btn')?.addEventListener('click', async () => {
  if (!currentRollCall) return;
  const ok = await showConfirm(
    'Open tonight’s roll call?\n\nThis will auto-lock approved leaves/medical and enable lobby QR check-in.',
    'Open Night Roll Call',
    null,
    null,
    { confirmText: 'Open Roll Call' }
  );
  if (!ok) return;
  try {
    const res = await apiCall('POST', `/hostel/rollcalls/${currentRollCall._id}/open`);
    if (res && res.data) {
      showToast('Roll call is now OPEN!', 'success');
      currentRollCall = res.data;
      updateHeaderAndStatus();
      await loadRosterSheet();
    }
  } catch (err) {
    showToast(err.message || 'Failed to open roll call', 'error');
  }
});

// Close Roll Call Handler
document.getElementById('close-rollcall-btn')?.addEventListener('click', async () => {
  if (!currentRollCall) return;
  const ok = await showConfirm(
    'Close roll call?\n\nUnmarked residents will be flagged as unverified and spot-checks will be drawn.',
    'Close Night Roll Call',
    null,
    null,
    { type: 'warn', confirmText: 'Close Roll Call' }
  );
  if (!ok) return;
  try {
    const res = await apiCall('POST', `/hostel/rollcalls/${currentRollCall._id}/close`);
    if (res && res.data) {
      showToast('Roll call closed. Spot-checks generated.', 'info');
      currentRollCall = res.data;
      updateHeaderAndStatus();
      await loadRosterSheet();
    }
  } catch (err) {
    showToast(err.message || 'Failed to close roll call', 'error');
  }
});

// Finalize Verification Handler
document.getElementById('verify-rollcall-btn')?.addEventListener('click', async () => {
  if (!currentRollCall) return;
  const ok = await showConfirm(
    'Finalize verification?\n\nAll room checks and parent calls should be completed before finalizing.',
    'Finalize Roll Call Verification',
    null,
    null,
    { confirmText: 'Finalize & Submit' }
  );
  if (!ok) return;
  try {
    const res = await apiCall('POST', `/hostel/rollcalls/${currentRollCall._id}/verify`);
    if (res && res.data) {
      showToast('Night roll call finalized and verified!', 'success');
      currentRollCall = res.data;
      updateHeaderAndStatus();
      await loadRosterSheet();
    }
  } catch (err) {
    showToast(err.message || 'Failed to verify roll call', 'error');
  }
});

// ── LOBBY QR ROTATION MODAL ──
document.getElementById('show-lobby-qr-btn')?.addEventListener('click', () => {
  openQRModal();
});

function openQRModal() {
  const modal = document.getElementById('qr-modal');
  if (!modal) return;
  modal.style.display = 'flex';

  // Request Wake Lock so warden's display doesn't dim
  if ('wakeLock' in navigator) {
    navigator.wakeLock.request('screen').then(lock => {
      wakeLock = lock;
    }).catch(() => {});
  }

  refreshQRToken();
  qrInterval = setInterval(refreshQRToken, 1000);
}

function closeQRModal() {
  const modal = document.getElementById('qr-modal');
  if (modal) modal.style.display = 'none';
  if (qrInterval) clearInterval(qrInterval);
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

async function refreshQRToken() {
  if (!currentRollCall) return;
  try {
    const res = await apiCall('GET', `/hostel/rollcalls/${currentRollCall._id}/qr`);
    if (res && res.data) {
      const { token, expiresInMs } = res.data;
      const target = document.getElementById('qr-code-target');
      if (target && typeof qrcode === 'function') {
        const qr = qrcode(0, 'M');
        qr.addData(token);
        qr.make();
        target.innerHTML = qr.createImgTag(5, 8);
      }
      const secsLeft = Math.ceil(expiresInMs / 1000);
      const secsEl = document.getElementById('qr-seconds-left');
      if (secsEl) secsEl.textContent = secsLeft;

      const progressEl = document.getElementById('qr-timer-progress');
      if (progressEl) progressEl.style.width = `${(secsLeft / 15) * 100}%`;

      document.getElementById('qr-live-scans').textContent = currentRollCall.counts.present || 0;
    }
  } catch (err) {}
}

// ── PARENT CALL LOG MODAL ──
function openCallModal(studentTrackId, phone, name) {
  activeCallTarget = { studentTrackId, phone, name };
  const modal = document.getElementById('parent-call-modal');
  document.getElementById('call-modal-resident-name').textContent = `Resident: ${name}`;
  const phoneInput = document.getElementById('parent-phone-number');
  const dialLink = document.getElementById('tap-to-call-link');

  phoneInput.value = phone;
  dialLink.href = `tel:${phone}`;
  modal.style.display = 'flex';
}

function closeCallModal() {
  const modal = document.getElementById('parent-call-modal');
  if (modal) modal.style.display = 'none';
  activeCallTarget = null;
}

document.getElementById('save-parent-call-btn')?.addEventListener('click', async () => {
  if (!activeCallTarget || !currentRollCall) return;
  const outcome = document.getElementById('call-outcome-select').value;
  const note = document.getElementById('call-notes-input').value;

  try {
    const res = await apiCall('POST', `/hostel/rollcalls/${currentRollCall._id}/parent-call`, {
      studentTrackId: activeCallTarget.studentTrackId,
      number: activeCallTarget.phone,
      outcome,
      note,
    });
    if (res && res.ok) {
      showToast('Parent call logged successfully', 'success');
      closeCallModal();
    }
  } catch (err) {
    showToast(err.message || 'Failed to log call', 'error');
  }
});

// Search and filter listeners
document.getElementById('roster-search')?.addEventListener('input', renderRoster);
document.getElementById('roster-filter-status')?.addEventListener('change', renderRoster);

// ── TAB SWITCHER ──
function setupTabs() {
  document.querySelectorAll('.hostel-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.hostel-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.hostel-tab-pane').forEach(p => p.style.display = 'none');

      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      const targetPane = document.getElementById(`tab-${tabId}`);
      if (targetPane) targetPane.style.display = 'block';

      if (tabId === 'leaves') loadPendingLeaves();
      if (tabId === 'rooms') loadRoomsOccupancy();
    });
  });
}

// ── LEAVES QUEUE ──
async function loadPendingLeavesCount() {
  try {
    const res = await apiCall('GET', '/hostel/leaves?status=pending_warden');
    if (res && res.data) {
      const badge = document.getElementById('pending-leaves-badge');
      if (badge) badge.textContent = res.data.length || 0;
    }
  } catch (err) {}
}

async function loadPendingLeaves() {
  const container = document.getElementById('leaves-container');
  try {
    const res = await apiCall('GET', '/hostel/leaves');
    if (res && res.data) {
      const leaves = res.data;
      if (!leaves.length) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--hostel-muted);font-weight:600;">No active passes or pending leaves.</div>';
        return;
      }

      container.innerHTML = leaves.map(l => {
        const s = l.student || {};
        const isPending = l.status === 'pending_warden' || l.status === 'pending_parent_call';
        return `
          <div class="leave-card">
            <div class="leave-header">
              <div>
                <span class="pill ${l.type === 'home' ? 'info' : 'pri'}" style="text-transform:uppercase;font-size:10px;">${esc(l.type)}</span>
                <b style="margin-left:6px;font-size:14.5px;">${esc(s.fullName || 'Resident')}</b> (${esc(s.registerNo || l.studentTrackId)})
              </div>
              <span class="pill warn" style="font-size:11px;">${esc(l.status)}</span>
            </div>
            <div style="font-size:12.5px;color:var(--hostel-text);">
              <b>Destination:</b> ${esc(l.destination)} · <b>Dates:</b> ${new Date(l.from).toLocaleDateString()} to ${new Date(l.to).toLocaleDateString()}
            </div>
            <div style="font-size:12px;color:var(--hostel-muted);">
              <b>Reason:</b> ${esc(l.reason)}
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
              <span class="smart-check-pill ${l.autoApproved ? 'smart-check-pass' : 'smart-check-warn'}">
                ${l.autoApproved ? '<re-icon icon="check"></re-icon> Within Outing Quota' : '<re-icon icon="alert-triangle"></re-icon> Requires Warden Check'}
              </span>
              ${l.parentCall?.status === 'consent' ? '<span class="smart-check-pill smart-check-pass"><re-icon icon="check"></re-icon> Parent Consent Logged</span>' : '<span class="smart-check-pill smart-check-warn"><re-icon icon="hourglass"></re-icon> Parent Call Needed</span>'}
            </div>
            ${isPending ? `
              <div style="display:flex;gap:8px;margin-top:8px;">
                <button type="button" class="btn-pri" style="height:32px;padding:0 12px;font-size:12px;" onclick="decideLeave('${esc(l._id)}', 'approve')">Approve Pass</button>
                <button type="button" class="btn-out" style="height:32px;padding:0 12px;font-size:12px;color:#dc2626;" onclick="decideLeave('${esc(l._id)}', 'reject')">Reject</button>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    container.innerHTML = '<div style="color:#dc2626;padding:20px;">Failed to load leaves.</div>';
  }
}

async function decideLeave(leaveId, action) {
  try {
    const res = await apiCall('POST', `/hostel/leaves/${leaveId}/${action}`);
    if (res && res.ok) {
      showToast(`Pass ${action}d successfully`, 'success');
      loadPendingLeaves();
      loadPendingLeavesCount();
    }
  } catch (err) {
    showToast(err.message || 'Action failed', 'error');
  }
}

// ── ROOMS & ALLOCATIONS ──
async function loadRoomsOccupancy() {
  const container = document.getElementById('rooms-grid-container');
  const allocContainer = document.getElementById('pending-allocations-container');
  try {
    // 1. Pending allocations
    const allocRes = await apiCall('GET', '/hostel/allocations?status=pending');
    if (allocRes && allocRes.data) {
      const allocs = allocRes.data;
      if (!allocs.length) {
        allocContainer.innerHTML = '<div style="font-size:12.5px;color:var(--hostel-muted);">No pending bed requests.</div>';
      } else {
        allocContainer.innerHTML = allocs.map(a => {
          const s = a.student || {};
          const r = a.roomId || {};
          return `
            <div style="display:flex;align-items:center;justify-content:space-between;background:var(--hostel-card-bg);border:1.5px solid var(--hostel-border);padding:10px 14px;border-radius:10px;margin-bottom:8px;">
              <div>
                <b>${esc(s.fullName || 'Resident')}</b> (${esc(s.registerNo || a.studentTrackId)})
                <div style="font-size:12px;color:var(--hostel-muted);">Requested: Room ${esc(r.roomNo || '')} · Bed ${esc(a.bed)}</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="btn-pri" style="height:30px;padding:0 10px;font-size:11.5px;" onclick="approveAllocation('${esc(a._id)}')">Approve</button>
                <button type="button" class="btn-out" style="height:30px;padding:0 10px;font-size:11.5px;color:#dc2626;" onclick="rejectAllocation('${esc(a._id)}')">Reject</button>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 2. Room matrix
    const blockId = currentRollCall?.blockId?._id || currentRollCall?.blockId;
    const roomRes = await apiCall('GET', `/hostel/rooms/free${blockId ? `?blockId=${blockId}` : ''}`);
    if (roomRes && roomRes.data) {
      const rooms = roomRes.data;
      container.innerHTML = rooms.map(r => `
        <div style="background:var(--hostel-card-bg);border:1.5px solid var(--hostel-border);padding:12px 14px;border-radius:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <b style="font-size:14px;">Room ${esc(r.roomNo)}</b>
            <span class="pill ${r.availableCount > 0 ? 'succ' : 'warn'}" style="font-size:10px;">${r.availableCount} / ${r.capacity} Free</span>
          </div>
          <div style="font-size:11.5px;color:var(--hostel-muted);margin-top:4px;">Floor ${r.floor}</div>
          <div style="display:flex;gap:4px;margin-top:8px;">
            ${(r.beds || []).map(b => {
              const isTaken = (r.takenBeds || []).includes(b);
              return `<span style="padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;background:${isTaken ? '#cbd5e1' : '#dcfce7'};color:${isTaken ? '#475569' : '#166534'};">${b}</span>`;
            }).join('')}
          </div>
        </div>
      `).join('');
    }
  } catch (err) {}
}

async function approveAllocation(id) {
  try {
    const res = await apiCall('POST', `/hostel/allocations/${id}/approve`);
    if (res && res.ok) {
      showToast('Allocation approved', 'success');
      loadRoomsOccupancy();
    }
  } catch (err) {
    showToast(err.message || 'Approval failed', 'error');
  }
}

async function rejectAllocation(id) {
  try {
    const res = await apiCall('POST', `/hostel/allocations/${id}/reject`, { reason: 'Rejected by warden' });
    if (res && res.ok) {
      showToast('Allocation rejected', 'info');
      loadRoomsOccupancy();
    }
  } catch (err) {
    showToast(err.message || 'Rejection failed', 'error');
  }
}

// ── CORRIDOR DARK MODE TOGGLE ──
function setupCorridorMode() {
  const toggleBtn = document.getElementById('corridor-mode-toggle');
  const saved = localStorage.getItem('hostel_corridor_mode') === 'true';
  if (saved) document.body.classList.add('corridor-dark-mode');

  toggleBtn?.addEventListener('click', () => {
    document.body.classList.toggle('corridor-dark-mode');
    const isDark = document.body.classList.contains('corridor-dark-mode');
    localStorage.setItem('hostel_corridor_mode', String(isDark));
    toggleBtn.innerHTML = isDark ? '<re-icon icon="sparkles"></re-icon> Light Mode' : '<re-icon icon="history"></re-icon> Corridor Mode';
  });
}
