/**
 * public/js/pages/timetable/compare.module.js
 *
 * Compare & Delta Mode Module (Timetable v3 - Phase 3):
 * - Comprehensive comparison: Per-Class diff, Teacher Workload deltas, Room Occupancy deltas, Free Slots deltas
 * - Split View & Overlay View for side-by-side comparison
 * - Visual diff indicators: Added (green), Modified (amber with before->after), Removed (red)
 * - "vs Production" Delta Mode for Workload, Free Slots, and Room Allocations
 * - Fully XSS-safe (esc()) and DB-only state compliant (no localStorage)
 */

(function() {
  'use strict';

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const compareState = {
    workspaceId: null,
    compareData: null,
    activeSubTab: 'classes', // 'classes' | 'teachers' | 'rooms' | 'freeSlots'
    viewMode: 'overlay', // 'overlay' | 'split'
    deltaModeActive: false,
    selectedClassId: 'all'
  };

  /**
   * Fetches compare data for a workspace
   */
  async function fetchCompareData(workspaceId, classIds = null) {
    if (!workspaceId) return null;
    try {
      let url = `/timetable/compare?workspaceId=${encodeURIComponent(workspaceId)}`;
      if (classIds) {
        const idList = Array.isArray(classIds) ? classIds.join(',') : classIds;
        url += `&classIds=${encodeURIComponent(idList)}`;
      }
      const res = await apiCall('GET', url);
      if (res && res.ok) {
        compareState.workspaceId = workspaceId;
        compareState.compareData = res;
        return res;
      }
      return null;
    } catch (err) {
      console.error('[CompareModule] Failed to fetch compare data:', err);
      if (typeof showToast === 'function') {
        showToast(err.message || 'Failed to generate comparison', 'error');
      }
      return null;
    }
  }

  /**
   * Opens the Compare Modal Dialog
   */
  async function openCompareModal(workspaceId = null, initialClassId = null) {
    const wsId = workspaceId || (window.TimetableWorkspaceModule && window.TimetableWorkspaceModule.getState().activeWorkspaceId);
    if (!wsId) {
      if (typeof showToast === 'function') {
        showToast('Please open or select a workspace to compare against production.', 'warning');
      }
      return;
    }

    if (initialClassId) {
      compareState.selectedClassId = String(initialClassId);
    }

    // Show loading modal
    let modal = document.getElementById('tt-compare-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-backdrop active';
      modal.id = 'tt-compare-modal';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-box" style="max-width:960px;width:96%;max-height:90vh;display:flex;flex-direction:column;">
        <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--border,#e2e8f0);">
          <div style="display:flex;align-items:center;gap:10px;">
            <h3 style="margin:0;font-size:16px;font-weight:700;">Compare Workspace vs Live Production</h3>
            <span class="tt-badge" style="background:#dbeafe;color:#1e40af;font-size:11px;padding:3px 8px;border-radius:4px;">Phase 3</span>
          </div>
          <button type="button" class="btn-close" onclick="document.getElementById('tt-compare-modal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="modal-bd" style="padding:40px;text-align:center;" id="tt-compare-modal-content">
          <div style="font-size:14px;color:var(--text-sec,#64748b);">Analyzing production head and workspace drafts…</div>
        </div>
      </div>
    `;

    const data = await fetchCompareData(wsId);
    if (!data) {
      document.getElementById('tt-compare-modal-content').innerHTML = `
        <div style="color:#ef4444;padding:20px;">Failed to generate timetable comparison. Please check server logs.</div>
      `;
      return;
    }

    renderCompareModalContent(data);
  }

  function renderCompareModalContent(data) {
    const content = document.getElementById('tt-compare-modal-content');
    if (!content) return;

    const ws = data.workspace || {};
    const perClass = data.perClass || [];
    const teachers = data.teachers || [];
    const rooms = data.rooms || [];
    const freeSlots = data.freeSlots || {};

    // Aggregate summary stats
    let totalAdded = 0;
    let totalModified = 0;
    let totalRemoved = 0;
    let totalUnchanged = 0;
    perClass.forEach(c => {
      totalAdded += (c.added || []).length;
      totalModified += (c.modified || []).length;
      totalRemoved += (c.removed || []).length;
      totalUnchanged += (c.unchanged || 0);
    });

    content.style.padding = '0';
    content.style.overflow = 'hidden';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.flex = '1';

    content.innerHTML = `
      <!-- Comparison KPI Bar -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:var(--bg2,#f8fafc);border-bottom:1px solid var(--border,#e2e8f0);flex-wrap:wrap;gap:12px;">
        <div style="display:flex;align-items:center;gap:16px;">
          <div>
            <span style="font-size:11px;color:var(--text-sec,#64748b);text-transform:uppercase;font-weight:700;">Workspace</span>
            <div style="font-weight:700;font-size:13px;color:var(--text-pri,#1e293b);">${esc(ws.name)} (${esc(ws.trackId)})</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;">
            <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;background:#dcfce7;color:#166534;font-weight:600;">
              +${totalAdded} Added
            </span>
            <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;background:#fef9c3;color:#854d0e;font-weight:600;">
              ~${totalModified} Modified
            </span>
            <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;background:#fee2e2;color:#991b1b;font-weight:600;">
              −${totalRemoved} Removed
            </span>
            <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;background:#f1f5f9;color:#475569;">
              ${totalUnchanged} Unchanged
            </span>
          </div>
        </div>

        <!-- Subtabs -->
        <div style="display:flex;gap:4px;background:#e2e8f0;padding:3px;border-radius:6px;">
          <button type="button" class="btn-subtab" data-tab="classes" onclick="window.TimetableCompareModule.switchSubTab('classes')" style="padding:4px 12px;font-size:12px;border:none;border-radius:4px;cursor:pointer;background:${compareState.activeSubTab === 'classes' ? '#ffffff' : 'transparent'};font-weight:${compareState.activeSubTab === 'classes' ? '600' : '400'};">
            Class Grids (${perClass.length})
          </button>
          <button type="button" class="btn-subtab" data-tab="teachers" onclick="window.TimetableCompareModule.switchSubTab('teachers')" style="padding:4px 12px;font-size:12px;border:none;border-radius:4px;cursor:pointer;background:${compareState.activeSubTab === 'teachers' ? '#ffffff' : 'transparent'};font-weight:${compareState.activeSubTab === 'teachers' ? '600' : '400'};">
            Teachers (${teachers.length})
          </button>
          <button type="button" class="btn-subtab" data-tab="rooms" onclick="window.TimetableCompareModule.switchSubTab('rooms')" style="padding:4px 12px;font-size:12px;border:none;border-radius:4px;cursor:pointer;background:${compareState.activeSubTab === 'rooms' ? '#ffffff' : 'transparent'};font-weight:${compareState.activeSubTab === 'rooms' ? '600' : '400'};">
            Rooms (${rooms.length})
          </button>
          <button type="button" class="btn-subtab" data-tab="freeSlots" onclick="window.TimetableCompareModule.switchSubTab('freeSlots')" style="padding:4px 12px;font-size:12px;border:none;border-radius:4px;cursor:pointer;background:${compareState.activeSubTab === 'freeSlots' ? '#ffffff' : 'transparent'};font-weight:${compareState.activeSubTab === 'freeSlots' ? '600' : '400'};">
            Free Slots
          </button>
        </div>
      </div>

      <!-- Tab Viewport -->
      <div id="tt-compare-tab-viewport" style="flex:1;overflow-y:auto;padding:16px 20px;">
        ${renderSubTabContent(compareState.activeSubTab, data)}
      </div>

      <div class="modal-ft" style="display:flex;justify-content:flex-end;gap:10px;padding:12px 20px;border-top:1px solid var(--border,#e2e8f0);background:#ffffff;">
        <button type="button" class="btn-out" onclick="document.getElementById('tt-compare-modal').remove()" style="padding:6px 14px;border-radius:6px;cursor:pointer;">Close</button>
      </div>
    `;
  }

  function switchSubTab(tabName) {
    compareState.activeSubTab = tabName;
    const viewport = document.getElementById('tt-compare-tab-viewport');
    if (viewport && compareState.compareData) {
      viewport.innerHTML = renderSubTabContent(tabName, compareState.compareData);
    }
    // Update subtab buttons
    document.querySelectorAll('.btn-subtab').forEach(btn => {
      const isAct = btn.getAttribute('data-tab') === tabName;
      btn.style.background = isAct ? '#ffffff' : 'transparent';
      btn.style.fontWeight = isAct ? '600' : '400';
    });
  }

  function renderSubTabContent(tabName, data) {
    if (tabName === 'teachers') {
      return renderTeachersTab(data.teachers || []);
    } else if (tabName === 'rooms') {
      return renderRoomsTab(data.rooms || []);
    } else if (tabName === 'freeSlots') {
      return renderFreeSlotsTab(data.freeSlots || {});
    }
    return renderClassesTab(data.perClass || []);
  }

  function renderClassesTab(perClass) {
    if (!perClass || perClass.length === 0) {
      return `<div style="text-align:center;padding:30px;color:var(--text-sec,#64748b);">No classes in this workspace.</div>`;
    }

    return `
      <div style="display:flex;flex-direction:column;gap:14px;">
        ${perClass.map(c => `
          <div style="border:1px solid var(--border,#e2e8f0);border-radius:8px;background:#ffffff;padding:14px 16px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-weight:700;font-size:14px;color:var(--text-pri,#1e293b);">${esc(c.className)}</span>
                ${c.stale ? `<span style="background:#fee2e2;color:#991b1b;font-size:11px;font-weight:600;padding:2px 7px;border-radius:4px;">Stale Base</span>` : ''}
                <span style="font-size:12px;color:var(--text-sec,#64748b);">Base: ${esc(c.base?.trackId || 'None')}</span>
              </div>
              <div style="display:flex;gap:6px;font-size:12px;">
                <span style="color:#16a34a;font-weight:600;">+${(c.added || []).length}</span>
                <span style="color:#d97706;font-weight:600;">~${(c.modified || []).length}</span>
                <span style="color:#dc2626;font-weight:600;">−${(c.removed || []).length}</span>
                <span style="color:#64748b;">· ${c.unchanged || 0} unchanged</span>
              </div>
            </div>

            <!-- Modified items details -->
            ${(c.modified || []).length > 0 ? `
              <div style="margin-bottom:10px;">
                <div style="font-size:11.5px;font-weight:600;color:#854d0e;margin-bottom:6px;">MODIFIED SLOTS:</div>
                <div style="display:flex;flex-direction:column;gap:5px;">
                  ${c.modified.map(m => `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#fefce8;border:1px solid #fef08a;border-radius:4px;font-size:12px;">
                      <div>
                        <strong>${esc(m.day)} P${m.period}</strong>:
                        <span style="text-decoration:line-through;color:#991b1b;margin-left:6px;">${esc(m.before?.subject || 'Empty')} (${esc(m.before?.teacher || 'No Faculty')})</span>
                        ➔
                        <span style="color:#166534;font-weight:600;margin-left:6px;">${esc(m.after?.subject || 'Empty')} (${esc(m.after?.teacher || 'No Faculty')})</span>
                      </div>
                      <span style="font-size:11px;color:#854d0e;">Room: ${esc(m.after?.room || '—')}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            <!-- Added slots -->
            ${(c.added || []).length > 0 ? `
              <div style="margin-bottom:10px;">
                <div style="font-size:11.5px;font-weight:600;color:#166534;margin-bottom:6px;">NEWLY ADDED SLOTS:</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                  ${c.added.map(a => `
                    <span style="padding:4px 8px;background:#dcfce7;border:1px solid #bbf7d0;border-radius:4px;font-size:12px;color:#166534;">
                      <strong>${esc(a.day)} P${a.period}</strong>: ${esc(a.subject)} (${esc(a.teacher || 'TBA')}) · ${esc(a.room || 'No Room')}
                    </span>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            <!-- Removed slots -->
            ${(c.removed || []).length > 0 ? `
              <div>
                <div style="font-size:11.5px;font-weight:600;color:#991b1b;margin-bottom:6px;">REMOVED SLOTS:</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                  ${c.removed.map(r => `
                    <span style="padding:4px 8px;background:#fee2e2;border:1px solid #fecaca;border-radius:4px;font-size:12px;color:#991b1b;">
                      <strong>${esc(r.day)} P${r.period}</strong>: ${esc(r.subject)} (${esc(r.teacher || 'TBA')})
                    </span>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            ${(c.added || []).length === 0 && (c.modified || []).length === 0 && (c.removed || []).length === 0 ? `
              <div style="font-size:12px;color:#16a34a;font-style:italic;">Identical to Production (No changes)</div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderTeachersTab(teachers) {
    if (!teachers || teachers.length === 0) {
      return `<div style="text-align:center;padding:30px;color:var(--text-sec,#64748b);">No faculty delta found.</div>`;
    }

    return `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px;text-align:left;">
          <thead>
            <tr style="background:var(--bg2,#f8fafc);border-bottom:2px solid var(--border,#e2e8f0);color:var(--text-sec,#64748b);">
              <th style="padding:8px 12px;">Faculty Name</th>
              <th style="padding:8px 12px;text-align:center;">Prod (Th / Lab)</th>
              <th style="padding:8px 12px;text-align:center;">Workspace (Th / Lab)</th>
              <th style="padding:8px 12px;text-align:center;">Delta (Hours)</th>
              <th style="padding:8px 12px;text-align:center;">New Clashes</th>
            </tr>
          </thead>
          <tbody>
            ${teachers.map(t => {
              const delta = t.deltaHours || 0;
              const deltaColor = delta > 0 ? '#16a34a' : (delta < 0 ? '#dc2626' : '#64748b');
              const deltaPrefix = delta > 0 ? `+${delta}` : `${delta}`;
              return `
                <tr style="border-bottom:1px solid var(--border,#e2e8f0);">
                  <td style="padding:9px 12px;font-weight:600;color:var(--text-pri,#1e293b);">${esc(t.name)}</td>
                  <td style="padding:9px 12px;text-align:center;color:#64748b;">${t.prodTheory || 0}h / ${t.prodLab || 0}h</td>
                  <td style="padding:9px 12px;text-align:center;font-weight:600;">${t.wsTheory || 0}h / ${t.wsLab || 0}h</td>
                  <td style="padding:9px 12px;text-align:center;font-weight:700;color:${deltaColor};">${deltaPrefix} h</td>
                  <td style="padding:9px 12px;text-align:center;">
                    ${(t.newClashes || 0) > 0 ? `
                      <span style="background:#fee2e2;color:#991b1b;padding:2px 7px;border-radius:4px;font-weight:700;font-size:11px;">
                        ⚠️ ${t.newClashes} clash(es)
                      </span>
                    ` : `<span style="color:#16a34a;">0</span>`}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderRoomsTab(rooms) {
    if (!rooms || rooms.length === 0) {
      return `<div style="text-align:center;padding:30px;color:var(--text-sec,#64748b);">No room allocation deltas found.</div>`;
    }

    return `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px;text-align:left;">
          <thead>
            <tr style="background:var(--bg2,#f8fafc);border-bottom:2px solid var(--border,#e2e8f0);color:var(--text-sec,#64748b);">
              <th style="padding:8px 12px;">Room / Hall</th>
              <th style="padding:8px 12px;text-align:center;">Prod Occupied</th>
              <th style="padding:8px 12px;text-align:center;">WS Occupied</th>
              <th style="padding:8px 12px;text-align:center;">Delta</th>
              <th style="padding:8px 12px;">Newly Taken Slots</th>
              <th style="padding:8px 12px;">Newly Freed Slots</th>
            </tr>
          </thead>
          <tbody>
            ${rooms.map(r => {
              const delta = r.delta || 0;
              const deltaColor = delta > 0 ? '#d97706' : (delta < 0 ? '#16a34a' : '#64748b');
              const deltaPrefix = delta > 0 ? `+${delta}` : `${delta}`;
              return `
                <tr style="border-bottom:1px solid var(--border,#e2e8f0);">
                  <td style="padding:9px 12px;font-weight:600;color:var(--text-pri,#1e293b);">${esc(r.room)}</td>
                  <td style="padding:9px 12px;text-align:center;color:#64748b;">${r.prodOccupied || 0}</td>
                  <td style="padding:9px 12px;text-align:center;font-weight:600;">${r.wsOccupied || 0}</td>
                  <td style="padding:9px 12px;text-align:center;font-weight:700;color:${deltaColor};">${deltaPrefix}</td>
                  <td style="padding:9px 12px;font-size:11.5px;color:#166534;">
                    ${(r.taken || []).length > 0
                      ? r.taken.map(t => `${esc(t.day)} P${t.period} (${esc(t.className)})`).join(', ')
                      : '—'}
                  </td>
                  <td style="padding:9px 12px;font-size:11.5px;color:#991b1b;">
                    ${(r.freed || []).length > 0
                      ? r.freed.map(f => `${esc(f.day)} P${f.period} (${esc(f.className)})`).join(', ')
                      : '—'}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderFreeSlotsTab(freeSlots) {
    const roomFree = freeSlots.rooms || [];
    const teacherFree = freeSlots.teachers || [];

    if (roomFree.length === 0 && teacherFree.length === 0) {
      return `<div style="text-align:center;padding:30px;color:var(--text-sec,#64748b);">No free slot deltas found between production and workspace.</div>`;
    }

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div style="border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:12px;background:#ffffff;">
          <h4 style="margin:0 0 10px 0;font-size:13px;font-weight:700;color:var(--text-pri,#1e293b);">Room Availability Deltas</h4>
          ${roomFree.length === 0 ? `<div style="font-size:12px;color:#64748b;">No room changes.</div>` : `
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${roomFree.map(rf => `
                <div style="padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;">
                  <div style="font-weight:600;margin-bottom:4px;">${esc(rf.room)}</div>
                  ${(rf.nowFree || []).length > 0 ? `
                    <div style="color:#16a34a;margin-bottom:2px;">
                      <strong>Now Free:</strong> ${rf.nowFree.map(s => `${esc(s.day)} P${s.period}`).join(', ')}
                    </div>
                  ` : ''}
                  ${(rf.nowTaken || []).length > 0 ? `
                    <div style="color:#dc2626;">
                      <strong>Now Taken:</strong> ${rf.nowTaken.map(s => `${esc(s.day)} P${s.period}`).join(', ')}
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <div style="border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:12px;background:#ffffff;">
          <h4 style="margin:0 0 10px 0;font-size:13px;font-weight:700;color:var(--text-pri,#1e293b);">Teacher Availability Deltas</h4>
          ${teacherFree.length === 0 ? `<div style="font-size:12px;color:#64748b;">No teacher availability changes.</div>` : `
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${teacherFree.map(tf => `
                <div style="padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;">
                  <div style="font-weight:600;margin-bottom:4px;">${esc(tf.name)}</div>
                  ${(tf.nowFree || []).length > 0 ? `
                    <div style="color:#16a34a;margin-bottom:2px;">
                      <strong>Now Free:</strong> ${tf.nowFree.map(s => `${esc(s.day)} P${s.period}`).join(', ')}
                    </div>
                  ` : ''}
                  ${(tf.nowTaken || []).length > 0 ? `
                    <div style="color:#dc2626;">
                      <strong>Now Taken:</strong> ${tf.nowTaken.map(s => `${esc(s.day)} P${s.period}`).join(', ')}
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  }

  // ── Delta Mode Control for Existing Views ──

  function toggleDeltaMode(viewType, forceState = null) {
    if (forceState !== null) {
      compareState.deltaModeActive = Boolean(forceState);
    } else {
      compareState.deltaModeActive = !compareState.deltaModeActive;
    }

    const btn = document.getElementById(`tt-delta-mode-${viewType}`);
    if (btn) {
      btn.classList.toggle('active', compareState.deltaModeActive);
      btn.style.background = compareState.deltaModeActive ? '#dbeafe' : '';
      btn.style.color = compareState.deltaModeActive ? '#1e40af' : '';
    }

    if (viewType === 'rooms' && typeof window.loadRooms === 'function') {
      window.loadRooms();
    } else if (viewType === 'workload' && typeof window.loadWorkload === 'function') {
      window.loadWorkload();
    }
  }

  // Expose global interface
  window.TimetableCompareModule = {
    fetchCompareData,
    openCompareModal,
    switchSubTab,
    toggleDeltaMode,
    getState: () => ({ ...compareState })
  };
})();
