/**
 * public/js/pages/timetable/workspace.module.js
 *
 * Workspaces Core Module (Timetable v3 - Phase 2):
 * - Environment toggle & Workspace switcher (Mine, Dept, Shared, Archived)
 * - Production viewer ribbon ("Live timetable · view only") & Development ribbon
 * - Debounced autosave (2s) with optimistic concurrency revision checking (409 on conflict)
 * - Checkpoint creation, listing, and 1-click restore (Dev history)
 * - DB-only UI state synchronization with TimetableUserState
 * - Keyboard shortcuts: Alt+W (workspace switcher), Ctrl+S (checkpoint)
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

  const moduleState = {
    env: 'production',
    activeWorkspaceId: null,
    activeWorkspace: null,
    workspaces: [],
    drafts: new Map(), // classId -> draft object
    userState: null,
    pendingOpsByClass: new Map(), // classId -> array of ops
    saveTimers: new Map(), // classId -> timer
    isSaving: false,
    syncStatus: 'saved' // 'saved' | 'saving' | 'offline' | 'conflict'
  };

  // ── User State Management (DB-only, replaces localStorage) ──

  async function loadUserState() {
    try {
      const res = await apiCall('GET', '/timetable/user-state');
      if (res && res.ok) {
        moduleState.userState = res;
        moduleState.env = res.env || 'production';
        moduleState.activeWorkspaceId = res.activeWorkspaceId || null;
        if (res.prefs && typeof window.state === 'object') {
          window.state.freezePanes = res.prefs.freezePanes !== false;
        }
      }
    } catch (err) {
      console.warn('[WorkspaceModule] Failed to load TimetableUserState:', err);
    }
  }

  async function saveUserState(patch = {}) {
    try {
      const payload = { ...patch };
      const res = await apiCall('PUT', '/timetable/user-state', payload);
      if (res && res.ok && res.state) {
        moduleState.userState = res.state;
      }
    } catch (err) {
      console.warn('[WorkspaceModule] Failed to save TimetableUserState:', err);
    }
  }

  function syncTabs(tabs = [], activeTabId = null) {
    saveUserState({
      openTabs: tabs.map(t => ({
        id: String(t.id || ''),
        title: String(t.title || ''),
        sectionName: String(t.viewParams?.sectionName || t.viewParams?.classId || t.title || ''),
        viewType: String(t.viewType || 'section'),
        viewParams: t.viewParams || {},
        classId: t.classId || t.viewParams?.classId || null,
        mode: String(t.mode || 'production')
      }))
    });
  }

  // ── Workspaces List & Switcher ──

  async function fetchWorkspaces(scope = 'dept') {
    try {
      const res = await apiCall('GET', `/timetable/workspaces?scope=${encodeURIComponent(scope)}`);
      if (res && res.ok && Array.isArray(res.workspaces)) {
        moduleState.workspaces = res.workspaces;
        return res.workspaces;
      }
      return [];
    } catch (err) {
      console.error('[WorkspaceModule] Error fetching workspaces:', err);
      return [];
    }
  }

  async function selectWorkspace(workspaceId) {
    if (!workspaceId) return;
    try {
      const res = await apiCall('GET', `/timetable/workspaces/${workspaceId}`);
      if (res && res.ok && res.workspace) {
        moduleState.activeWorkspaceId = res.workspace._id;
        moduleState.activeWorkspace = res.workspace;
        moduleState.drafts.clear();
        (res.drafts || []).forEach(d => {
          moduleState.drafts.set(String(d.classId), d);
        });

        // Set development mode and persist to DB
        moduleState.env = 'development';
        await saveUserState({
          env: 'development',
          activeWorkspaceId: res.workspace._id
        });

        renderRibbons();
        updateSyncBadge('saved');

        if (typeof showToast === 'function') {
          showToast(`Switched to workspace: ${res.workspace.name}`, 'info');
        }

        // Refresh active views
        if (window.workspace && typeof window.workspace.refreshAllTabs === 'function') {
          window.workspace.refreshAllTabs();
        } else if (typeof renderCurrentView === 'function') {
          renderCurrentView();
        }
      }
    } catch (err) {
      console.error('[WorkspaceModule] Error selecting workspace:', err);
      if (typeof showToast === 'function') {
        showToast('Failed to load workspace', 'error');
      }
    }
  }

  // ── UI Ribbons: Production Viewer & Development Active ──

  function renderRibbons() {
    let ribbonContainer = document.getElementById('tt-workspace-ribbon');
    if (!ribbonContainer) {
      const topbar = document.querySelector('.topbar') || document.querySelector('.tt-tabstrip-bar');
      if (!topbar) return;
      ribbonContainer = document.createElement('div');
      ribbonContainer.id = 'tt-workspace-ribbon';
      ribbonContainer.className = 'tt-workspace-ribbon';
      topbar.parentNode.insertBefore(ribbonContainer, topbar.nextSibling);
    }

    if (moduleState.env === 'production') {
      ribbonContainer.className = 'tt-workspace-ribbon ribbon-production';
      ribbonContainer.innerHTML = `
        <div class="ribbon-inner" style="display:flex;align-items:center;justify-content:space-between;padding:7px 16px;background:var(--card,#ffffff);border-bottom:1px solid var(--border,#e2e8f0);font-size:12.5px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-weight:700;letter-spacing:0.04em;color:var(--text-sec,#64748b);text-transform:uppercase;font-size:11px;">● LIVE PRODUCTION</span>
            <span style="color:var(--text-sec,#64748b);">View only mode. Changes must be drafted in a workspace.</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            ${(window.__EAMS_USER__?.isHod || window.__EAMS_USER__?.role === 'hod') ? `
              <button type="button" class="btn-sm" onclick="window.TimetableWorkspaceModule.openHotfixModal()" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;font-size:12px;border-radius:6px;cursor:pointer;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-weight:600;">
                <span>⚡ Quick Fix</span>
              </button>
            ` : ''}
            <button type="button" class="btn-sm btn-pri" onclick="window.TimetableWorkspaceModule.openCreateModal()" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;font-size:12px;border-radius:6px;cursor:pointer;">
              <span>Fork to edit ▸</span>
            </button>
          </div>
        </div>
      `;
    } else {
      const ws = moduleState.activeWorkspace;
      const wsName = ws ? ws.name : 'Development Workspace';
      const classCount = ws ? (ws.classIds || []).length : 0;
      const trackId = ws ? ws.trackId : '';

      ribbonContainer.className = 'tt-workspace-ribbon ribbon-development';
      ribbonContainer.innerHTML = `
        <div class="ribbon-inner" style="display:flex;align-items:center;justify-content:space-between;padding:7px 16px;background:#f0fdf4;border-bottom:1px solid #bbf7d0;font-size:12.5px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-weight:700;color:#166534;font-size:11px;letter-spacing:0.04em;">● WORKSPACE: ${esc(wsName)}</span>
            <span style="color:#15803d;">${classCount} class(es) · ${esc(trackId)}</span>
            <span class="tt-ws-badge" id="tt-ws-save-indicator" style="font-size:11px;padding:2px 7px;border-radius:4px;background:#dcfce7;color:#166534;">Saved ✔</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button type="button" class="btn-sm btn-out" onclick="window.TimetableCompareModule && window.TimetableCompareModule.openCompareModal()" style="padding:4px 10px;font-size:12px;border-radius:6px;cursor:pointer;background:#ffffff;border:1px solid #bbf7d0;color:#166534;">
              <span>🔍 Compare vs Prod</span>
            </button>
            <button type="button" class="btn-sm btn-out" onclick="window.TimetableShareModule && window.TimetableShareModule.openShareModal()" style="padding:4px 10px;font-size:12px;border-radius:6px;cursor:pointer;background:#ffffff;border:1px solid #bbf7d0;color:#166534;">
              <span>🔗 Share</span>
            </button>
            <button type="button" class="btn-sm btn-out" onclick="window.TimetableShareModule && window.TimetableShareModule.openStaffAssignmentPanel('${ws?._id}')" style="padding:4px 10px;font-size:12px;border-radius:6px;cursor:pointer;background:#ffffff;border:1px solid #bbf7d0;color:#166534;">
              <span>👥 Staff</span>
            </button>
            <button type="button" class="btn-sm btn-pri" onclick="window.TimetableWorkspaceModule.openSubmitModal()" style="padding:4px 12px;font-size:12px;border-radius:6px;cursor:pointer;background:#15803d;color:#ffffff;border:none;">
              <span>🚀 Submit</span>
            </button>
            <button type="button" class="btn-sm btn-out" onclick="window.TimetableWorkspaceModule.openApprovalsModal()" style="padding:4px 10px;font-size:12px;border-radius:6px;cursor:pointer;background:#ffffff;border:1px solid #bbf7d0;color:#166534;">
              <span>📋 Approvals</span>
            </button>
            <button type="button" class="btn-sm btn-out" onclick="window.TimetableWorkspaceModule.openCheckpointModal()" style="padding:4px 10px;font-size:12px;border-radius:6px;cursor:pointer;background:#ffffff;border:1px solid #bbf7d0;color:#166534;">
              <span>💾 Checkpoint (Ctrl+S)</span>
            </button>
            <button type="button" class="btn-sm btn-out" onclick="window.TimetableWorkspaceModule.openCheckpointsList()" style="padding:4px 10px;font-size:12px;border-radius:6px;cursor:pointer;background:#ffffff;border:1px solid #bbf7d0;color:#166534;">
              <span>🕒 History</span>
            </button>
            <button type="button" class="btn-sm btn-out" onclick="window.TimetableWorkspaceModule.switchEnv('production')" style="padding:4px 10px;font-size:12px;border-radius:6px;cursor:pointer;background:#ffffff;border:1px solid #e2e8f0;color:#475569;">
              <span>Switch to Production</span>
            </button>
          </div>
        </div>
        ${(() => {
          const staleDrafts = Array.from(moduleState.drafts.values()).filter(d => d.isStale);
          if (staleDrafts.length === 0) return '';
          return `
            <div class="stale-banner" style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;background:#fffbeb;border-bottom:1px solid #fef3c7;font-size:12px;color:#92400e;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:14px;">⚠️</span>
                <span>Production changed for <strong>${esc(staleDrafts.map(d => d.className).join(', '))}</strong> since this workspace was forked. Merge required before deploying.</span>
              </div>
              <div style="display:flex;gap:6px;">
                ${staleDrafts.map(d => `
                  <button type="button" class="btn-sm btn-out" onclick="window.TimetableWorkspaceModule.openMergeModal('${d.classId}')" style="padding:3px 8px;font-size:11.5px;border-radius:4px;cursor:pointer;background:#ffffff;border:1px solid #d97706;color:#92400e;">
                    Merge ${esc(d.className)}
                  </button>
                `).join('')}
              </div>
            </div>
          `;
        })()}
      `;
    }
  }

  function updateSyncBadge(status, message = '') {
    moduleState.syncStatus = status;
    const badge = document.getElementById('tt-ws-save-indicator');
    if (!badge) return;

    if (status === 'saving') {
      badge.style.background = '#fef9c3';
      badge.style.color = '#854d0e';
      badge.textContent = 'Saving…';
    } else if (status === 'saved') {
      badge.style.background = '#dcfce7';
      badge.style.color = '#166534';
      badge.textContent = 'Saved ✔';
    } else if (status === 'conflict') {
      badge.style.background = '#fee2e2';
      badge.style.color = '#991b1b';
      badge.textContent = message || 'Conflict (409) ⚠️';
    } else if (status === 'offline') {
      badge.style.background = '#f1f5f9';
      badge.style.color = '#475569';
      badge.textContent = 'Offline';
    }
  }

  // ── Debounced Autosave with Optimistic Concurrency (Revision Checking) ──

  function queueSlotEdit(classId, op) {
    if (!classId || !op || !moduleState.activeWorkspaceId) return;
    const cId = String(classId);

    if (!moduleState.pendingOpsByClass.has(cId)) {
      moduleState.pendingOpsByClass.set(cId, []);
    }
    moduleState.pendingOpsByClass.get(cId).push(op);

    // Cancel existing timer for this class
    if (moduleState.saveTimers.has(cId)) {
      clearTimeout(moduleState.saveTimers.get(cId));
    }

    updateSyncBadge('saving');

    // 2-second debounce per class
    const timer = setTimeout(() => {
      flushClassEdits(cId);
    }, 2000);

    moduleState.saveTimers.set(cId, timer);
  }

  async function flushClassEdits(classId) {
    const cId = String(classId);
    const ops = moduleState.pendingOpsByClass.get(cId) || [];
    if (ops.length === 0) return;

    const draft = moduleState.drafts.get(cId);
    const revision = draft ? Number(draft.revision) : 1;

    moduleState.pendingOpsByClass.delete(cId);
    moduleState.saveTimers.delete(cId);

    try {
      const url = `/timetable/workspaces/${moduleState.activeWorkspaceId}/classes/${cId}/slots`;
      const res = await apiCall('PATCH', url, {
        revision,
        ops
      });

      if (res && res.ok) {
        if (draft) {
          draft.revision = res.revision;
          draft.grid = res.grid;
        }
        updateSyncBadge('saved');
      } else if (res && res.code === 'REVISION_MISMATCH') {
        updateSyncBadge('conflict', 'Revision Conflict (409)');
        if (typeof showToast === 'function') {
          showToast('Another user updated this timetable. Please refresh to load the latest draft.', 'error');
        }
      }
    } catch (err) {
      if (err.status === 409 || err.code === 'REVISION_MISMATCH') {
        updateSyncBadge('conflict', 'Revision Conflict (409)');
        if (typeof showToast === 'function') {
          showToast('Revision conflict detected. Reloading draft...', 'error');
        }
      } else {
        updateSyncBadge('offline');
        console.error('[WorkspaceModule] Autosave failed:', err);
      }
    }
  }

  // ── Modals: Create / Fork & Checkpoint ──

  async function openCreateModal(defaultForkClassId = null) {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop active';
    modal.id = 'tt-ws-create-modal';

    const classes = (window._masterData && window._masterData.classes) ? window._masterData.classes : [];

    modal.innerHTML = `
      <div class="modal-box" style="max-width:540px;width:95%;">
        <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border,#e2e8f0);">
          <h3 style="margin:0;font-size:15px;font-weight:700;">Create / Fork Workspace</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('tt-ws-create-modal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="modal-bd" style="padding:16px 18px;">
          <div class="form-group" style="margin-bottom:12px;">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Workspace Name *</label>
            <input type="text" id="tt-ws-new-name" class="form-control" placeholder="e.g. 2026 Odd Sem Draft" style="width:100%;padding:7px 10px;font-size:13px;border-radius:6px;border:1px solid var(--border,#cbd5e1);">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
            <div>
              <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Academic Year</label>
              <input type="text" id="tt-ws-new-year" class="form-control" value="2025-2026" style="width:100%;padding:7px 10px;font-size:13px;border-radius:6px;border:1px solid var(--border,#cbd5e1);">
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Semester</label>
              <select id="tt-ws-new-sem" class="form-control" style="width:100%;padding:7px 10px;font-size:13px;border-radius:6px;border:1px solid var(--border,#cbd5e1);">
                <option value="Odd">Odd Semester</option>
                <option value="Even">Even Semester</option>
              </select>
            </div>
          </div>
          <div class="form-group" style="margin-bottom:12px;">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Select Classes to Fork *</label>
            <div style="max-height:160px;overflow-y:auto;border:1px solid var(--border,#cbd5e1);border-radius:6px;padding:8px;">
              ${classes.map(c => `
                <label style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12.5px;cursor:pointer;">
                  <input type="checkbox" name="tt-ws-classes" value="${esc(c._id)}" ${defaultForkClassId && String(c._id) === String(defaultForkClassId) ? 'checked' : ''}>
                  <span>${esc(c.name)}</span>
                </label>
              `).join('')}
            </div>
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Fork Source</label>
            <select id="tt-ws-fork-kind" class="form-control" style="width:100%;padding:7px 10px;font-size:13px;border-radius:6px;border:1px solid var(--border,#cbd5e1);">
              <option value="production">Current Live Production Head</option>
            </select>
          </div>
        </div>
        <div class="modal-ft" style="display:flex;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid var(--border,#e2e8f0);">
          <button type="button" class="btn-out" onclick="document.getElementById('tt-ws-create-modal').remove()" style="padding:6px 14px;border-radius:6px;cursor:pointer;">Cancel</button>
          <button type="button" class="btn-pri" onclick="window.TimetableWorkspaceModule.submitCreateModal()" style="padding:6px 14px;border-radius:6px;cursor:pointer;">Create Workspace</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  async function submitCreateModal() {
    const nameEl = document.getElementById('tt-ws-new-name');
    const name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
      if (typeof showToast === 'function') showToast('Please enter a workspace name', 'warning');
      return;
    }

    const yearEl = document.getElementById('tt-ws-new-year');
    const semEl = document.getElementById('tt-ws-new-sem');
    const classCheckboxes = document.querySelectorAll('input[name="tt-ws-classes"]:checked');
    const classIds = Array.from(classCheckboxes).map(cb => cb.value);

    try {
      const res = await apiCall('POST', '/timetable/workspaces', {
        name,
        academicYear: yearEl ? yearEl.value.trim() : '',
        semester: semEl ? semEl.value : 'Odd',
        classIds,
        forkFrom: { kind: 'production' }
      });

      if (res && res.ok && res.workspace) {
        document.getElementById('tt-ws-create-modal')?.remove();
        if (typeof showToast === 'function') showToast('Workspace created successfully', 'success');
        await selectWorkspace(res.workspace._id);
      }
    } catch (err) {
      console.error('[WorkspaceModule] Create workspace failed:', err);
      if (typeof showToast === 'function') showToast(err.message || 'Failed to create workspace', 'error');
    }
  }

  async function openCheckpointModal() {
    if (!moduleState.activeWorkspaceId) {
      if (typeof showToast === 'function') showToast('No active workspace selected', 'warning');
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop active';
    modal.id = 'tt-ws-checkpoint-modal';

    modal.innerHTML = `
      <div class="modal-box" style="max-width:440px;width:95%;">
        <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border,#e2e8f0);">
          <h3 style="margin:0;font-size:15px;font-weight:700;">Save Checkpoint</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('tt-ws-checkpoint-modal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="modal-bd" style="padding:16px 18px;">
          <div class="form-group" style="margin-bottom:12px;">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Checkpoint Name *</label>
            <input type="text" id="tt-cp-name" class="form-control" placeholder="e.g. Before Room Rearrangement" style="width:100%;padding:7px 10px;font-size:13px;border-radius:6px;border:1px solid var(--border,#cbd5e1);">
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Note (Optional)</label>
            <textarea id="tt-cp-note" class="form-control" placeholder="Context or rationale..." style="width:100%;height:60px;padding:7px 10px;font-size:12.5px;border-radius:6px;border:1px solid var(--border,#cbd5e1);"></textarea>
          </div>
        </div>
        <div class="modal-ft" style="display:flex;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid var(--border,#e2e8f0);">
          <button type="button" class="btn-out" onclick="document.getElementById('tt-ws-checkpoint-modal').remove()" style="padding:6px 14px;border-radius:6px;cursor:pointer;">Cancel</button>
          <button type="button" class="btn-pri" onclick="window.TimetableWorkspaceModule.submitCheckpointModal()" style="padding:6px 14px;border-radius:6px;cursor:pointer;">Save Checkpoint</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('tt-cp-name')?.focus();
  }

  async function submitCheckpointModal() {
    const nameEl = document.getElementById('tt-cp-name');
    const noteEl = document.getElementById('tt-cp-note');
    const name = nameEl ? nameEl.value.trim() : '';

    if (!name) {
      if (typeof showToast === 'function') showToast('Please enter a checkpoint name', 'warning');
      return;
    }

    try {
      const res = await apiCall('POST', `/timetable/workspaces/${moduleState.activeWorkspaceId}/checkpoints`, {
        name,
        note: noteEl ? noteEl.value.trim() : '',
        kind: 'checkpoint'
      });

      if (res && res.ok && res.checkpoint) {
        document.getElementById('tt-ws-checkpoint-modal')?.remove();
        if (typeof showToast === 'function') {
          showToast(`Saved checkpoint #${res.checkpoint.seq}: ${res.checkpoint.name}`, 'success');
        }
      }
    } catch (err) {
      console.error('[WorkspaceModule] Failed to create checkpoint:', err);
      if (typeof showToast === 'function') showToast(err.message || 'Failed to save checkpoint', 'error');
    }
  }

  async function openCheckpointsList() {
    if (!moduleState.activeWorkspaceId) return;

    try {
      const res = await apiCall('GET', `/timetable/workspaces/${moduleState.activeWorkspaceId}/checkpoints`);
      const checkpoints = (res && res.ok && Array.isArray(res.checkpoints)) ? res.checkpoints : [];

      const modal = document.createElement('div');
      modal.className = 'modal-backdrop active';
      modal.id = 'tt-ws-checkpoints-list-modal';

      modal.innerHTML = `
        <div class="modal-box" style="max-width:600px;width:95%;">
          <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border,#e2e8f0);">
            <h3 style="margin:0;font-size:15px;font-weight:700;">Workspace History & Checkpoints</h3>
            <button type="button" class="btn-close" onclick="document.getElementById('tt-ws-checkpoints-list-modal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;">✕</button>
          </div>
          <div class="modal-bd" style="padding:14px 18px;max-height:400px;overflow-y:auto;">
            ${checkpoints.length === 0 ? `
              <div style="text-align:center;padding:30px;color:var(--text-sec,#64748b);">No checkpoints saved in this workspace yet.</div>
            ` : `
              <div style="display:flex;flex-direction:column;gap:8px;">
                ${checkpoints.map(cp => `
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--border,#e2e8f0);border-radius:6px;background:var(--card,#ffffff);">
                    <div>
                      <div style="font-weight:600;font-size:13px;color:var(--text-pri,#1e293b);">#${cp.seq} ${esc(cp.name)}</div>
                      <div style="font-size:11.5px;color:var(--text-sec,#64748b);margin-top:2px;">
                        By ${esc(cp.author?.name || 'User')} · ${new Date(cp.createdAt).toLocaleString()} · ${cp.classes?.length || 0} class(es)
                      </div>
                      ${cp.note ? `<div style="font-size:11.5px;color:var(--text-sec,#475569);margin-top:4px;font-style:italic;">"${esc(cp.note)}"</div>` : ''}
                    </div>
                    <div>
                      <button type="button" class="btn-sm btn-out" onclick="window.TimetableWorkspaceModule.restoreCheckpoint(${cp.seq})" style="padding:4px 10px;font-size:11.5px;border-radius:4px;cursor:pointer;">
                        Restore
                      </button>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
          <div class="modal-ft" style="display:flex;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--border,#e2e8f0);">
            <button type="button" class="btn-out" onclick="document.getElementById('tt-ws-checkpoints-list-modal').remove()" style="padding:6px 14px;border-radius:6px;cursor:pointer;">Close</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
    } catch (err) {
      console.error('[WorkspaceModule] Failed to fetch checkpoints:', err);
    }
  }

  async function restoreCheckpoint(seq) {
    if (!confirm(`Are you sure you want to restore checkpoint #${seq}? A backup checkpoint of your current state will be saved automatically.`)) {
      return;
    }

    try {
      const res = await apiCall('POST', `/timetable/workspaces/${moduleState.activeWorkspaceId}/checkpoints/${seq}/restore`);
      if (res && res.ok) {
        document.getElementById('tt-ws-checkpoints-list-modal')?.remove();
        if (typeof showToast === 'function') {
          showToast(`Successfully restored workspace to checkpoint #${seq}`, 'success');
        }
        await selectWorkspace(moduleState.activeWorkspaceId);
      }
    } catch (err) {
      console.error('[WorkspaceModule] Restore failed:', err);
      if (typeof showToast === 'function') {
        showToast(err.message || 'Failed to restore checkpoint', 'error');
      }
    }
  }

  // ── Submit & Commits & Approvals Modals (Phase 4) ──

  async function openSubmitModal() {
    if (!moduleState.activeWorkspaceId) {
      if (typeof showToast === 'function') showToast('No active workspace selected', 'warning');
      return;
    }

    const ws = moduleState.activeWorkspace;
    const drafts = Array.from(moduleState.drafts.values());

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop active';
    modal.id = 'tt-ws-submit-modal';

    modal.innerHTML = `
      <div class="modal-box" style="max-width:540px;width:95%;">
        <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border,#e2e8f0);">
          <h3 style="margin:0;font-size:15px;font-weight:700;">Submit Timetable for Approval</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('tt-ws-submit-modal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="modal-bd" style="padding:16px 18px;max-height:420px;overflow-y:auto;">
          <div class="form-group" style="margin-bottom:12px;">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Commit Message *</label>
            <input type="text" id="tt-submit-msg" class="form-control" placeholder="e.g. Odd Semester 2026 Final Draft" style="width:100%;padding:7px 10px;font-size:13px;border-radius:6px;border:1px solid var(--border,#cbd5e1);">
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Notes for HoD (Optional)</label>
            <textarea id="tt-submit-notes" class="form-control" placeholder="Summary of faculty assignments or room swaps..." style="width:100%;height:55px;padding:7px 10px;font-size:12px;border-radius:6px;border:1px solid var(--border,#cbd5e1);"></textarea>
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Deploy at Scheduled Time (Optional - Future only)</label>
            <input type="datetime-local" id="tt-submit-golive" class="form-control" style="width:100%;padding:7px 10px;font-size:12px;border-radius:6px;border:1px solid var(--border,#cbd5e1);">
            <div style="font-size:11px;color:var(--text-sec,#64748b);margin-top:2px;">Leave blank to allow immediate deploy upon approval. Scheduled times must be in the future.</div>
          </div>
          <div style="font-size:12px;font-weight:700;color:var(--text-sec,#64748b);text-transform:uppercase;margin-bottom:6px;letter-spacing:0.04em;">Classes to Include</div>
          <div style="display:flex;flex-direction:column;gap:6px;border:1px solid var(--border,#e2e8f0);border-radius:6px;padding:8px 12px;background:var(--card,#ffffff);">
            ${drafts.length === 0 ? `
              <div style="color:var(--text-sec,#64748b);font-size:12px;">No classes drafted in this workspace.</div>
            ` : drafts.map(d => `
              <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;font-size:12.5px;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <input type="checkbox" name="tt-submit-class" value="${esc(d.classId)}" checked>
                  <span style="font-weight:600;color:var(--text-pri,#1e293b);">${esc(d.className)}</span>
                </div>
                <div>
                  ${d.isStale ? '<span style="color:#d97706;font-size:11px;font-weight:700;">STALE (Merge required)</span>' : '<span style="color:#166534;font-size:11px;">Up to date</span>'}
                </div>
              </label>
            `).join('')}
          </div>
          <div id="tt-submit-conflict-warn" style="display:none;margin-top:12px;padding:10px 12px;border-radius:6px;background:#fee2e2;border:1px solid #fecaca;color:#991b1b;font-size:12px;"></div>
        </div>
        <div class="modal-ft" style="display:flex;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid var(--border,#e2e8f0);">
          <button type="button" class="btn-out" onclick="document.getElementById('tt-ws-submit-modal').remove()" style="padding:6px 14px;border-radius:6px;cursor:pointer;">Cancel</button>
          <button type="button" class="btn-pri" onclick="window.TimetableWorkspaceModule.submitWorkspaceCommit()" style="padding:6px 16px;border-radius:6px;cursor:pointer;background:#15803d;color:#ffffff;border:none;">Submit to HoD</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('tt-submit-msg')?.focus();
  }

  async function submitWorkspaceCommit() {
    const msgEl = document.getElementById('tt-submit-msg');
    const msg = msgEl ? msgEl.value.trim() : '';
    if (!msg) {
      if (typeof showToast === 'function') showToast('Please enter a commit message', 'warning');
      return;
    }

    const notesEl = document.getElementById('tt-submit-notes');
    const goLiveEl = document.getElementById('tt-submit-golive');
    let goLiveAt = undefined;
    if (goLiveEl && goLiveEl.value) {
      const scheduledDate = new Date(goLiveEl.value);
      if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
        if (typeof showToast === 'function') showToast('Scheduled go-live time must be in the future', 'warning');
        return;
      }
      goLiveAt = scheduledDate.toISOString();
    }

    const classCheckboxes = document.querySelectorAll('input[name="tt-submit-class"]:checked');
    const classIds = Array.from(classCheckboxes).map(cb => cb.value);

    if (classIds.length === 0) {
      if (typeof showToast === 'function') showToast('Please select at least one class to submit', 'warning');
      return;
    }

    const warnEl = document.getElementById('tt-submit-conflict-warn');
    if (warnEl) warnEl.style.display = 'none';

    try {
      const res = await apiCall('POST', `/timetable/workspaces/${moduleState.activeWorkspaceId}/submit`, {
        message: msg,
        notes: notesEl ? notesEl.value.trim() : '',
        goLiveAt,
        classIds
      });

      if (res && res.ok && res.commit) {
        document.getElementById('tt-ws-submit-modal')?.remove();
        if (typeof showToast === 'function') {
          showToast(`Submitted commit ${res.commit.trackId} for approval!`, 'success');
        }
        await selectWorkspace(moduleState.activeWorkspaceId);
      } else if (res && res.error) {
        if (warnEl) {
          warnEl.style.display = 'block';
          warnEl.textContent = res.error + (res.conflicts ? ` (${res.conflicts.length} conflict(s))` : '');
        }
        if (typeof showToast === 'function') showToast(res.error, 'error');
      }
    } catch (err) {
      if (warnEl) {
        warnEl.style.display = 'block';
        warnEl.textContent = err.message || 'Submit failed';
      }
      if (typeof showToast === 'function') showToast(err.message || 'Submit failed', 'error');
    }
  }

  async function openApprovalsModal() {
    try {
      const res = await apiCall('GET', '/timetable/commits/pending');
      const commits = (res && res.ok && Array.isArray(res.data)) ? res.data : [];

      const modal = document.createElement('div');
      modal.className = 'modal-backdrop active';
      modal.id = 'tt-ws-approvals-modal';

      modal.innerHTML = `
        <div class="modal-box" style="max-width:620px;width:95%;">
          <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border,#e2e8f0);">
            <h3 style="margin:0;font-size:15px;font-weight:700;">Commits & Approvals</h3>
            <button type="button" class="btn-close" onclick="document.getElementById('tt-ws-approvals-modal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;">✕</button>
          </div>
          <div class="modal-bd" style="padding:14px 18px;max-height:420px;overflow-y:auto;">
            ${commits.length === 0 ? `
              <div style="text-align:center;padding:30px;color:var(--text-sec,#64748b);">No pending commits awaiting approval.</div>
            ` : `
              <div style="display:flex;flex-direction:column;gap:10px;">
                ${commits.map(c => `
                  <div style="border:1px solid var(--border,#e2e8f0);border-radius:6px;padding:12px;background:var(--card,#ffffff);">
                    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;">
                      <div>
                        <div style="font-weight:700;font-size:13.5px;color:var(--text-pri,#1e293b);">${esc(c.trackId)} · ${esc(c.message)}</div>
                        <div style="font-size:11.5px;color:var(--text-sec,#64748b);margin-top:2px;">
                          Submitted by <strong>${esc(c.author?.name || 'User')}</strong> · ${new Date(c.createdAt).toLocaleString()} · ${c.classNames ? esc(c.classNames.join(', ')) : ''}
                        </div>
                      </div>
                      <span class="badge" style="font-size:11px;padding:3px 8px;border-radius:4px;background:#fef3c7;color:#92400e;font-weight:600;">Pending Approval</span>
                    </div>
                    ${c.notes ? `<div style="font-size:12px;color:var(--text-sec,#475569);margin-bottom:8px;font-style:italic;">"${esc(c.notes)}"</div>` : ''}
                    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;padding-top:8px;border-top:1px solid var(--border,#f1f5f9);">
                      <button type="button" class="btn-sm btn-out" onclick="window.TimetableWorkspaceModule.withdrawCommit('${c.trackId}')" style="padding:4px 10px;font-size:12px;border-radius:4px;cursor:pointer;color:#475569;">Withdraw</button>
                      <button type="button" class="btn-sm btn-out" onclick="window.TimetableWorkspaceModule.rejectCommit('${c.trackId}')" style="padding:4px 10px;font-size:12px;border-radius:4px;cursor:pointer;color:#dc2626;border-color:#fecaca;">Reject</button>
                      <button type="button" class="btn-sm btn-pri" onclick="window.TimetableWorkspaceModule.approveCommit('${c.trackId}')" style="padding:4px 14px;font-size:12px;border-radius:4px;cursor:pointer;background:#15803d;color:#ffffff;border:none;">Approve</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
          <div class="modal-ft" style="display:flex;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--border,#e2e8f0);">
            <button type="button" class="btn-out" onclick="document.getElementById('tt-ws-approvals-modal').remove()" style="padding:6px 14px;border-radius:6px;cursor:pointer;">Close</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
    } catch (err) {
      console.error('[WorkspaceModule] Failed to load pending commits:', err);
    }
  }

  async function approveCommit(trackId) {
    if (!confirm(`Approve commit ${trackId} for deployment?`)) return;
    try {
      const res = await apiCall('POST', `/timetable/commits/${trackId}/approve`, { comment: 'Approved by HoD' });
      if (res && res.ok) {
        if (typeof showToast === 'function') showToast(`Approved commit ${trackId}`, 'success');
        document.getElementById('tt-ws-approvals-modal')?.remove();
        await openApprovalsModal();
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message || 'Approve failed', 'error');
    }
  }

  async function rejectCommit(trackId) {
    const reason = prompt(`Enter rejection reason for commit ${trackId}:`);
    if (reason === null) return;
    try {
      const res = await apiCall('POST', `/timetable/commits/${trackId}/reject`, { reason: reason || 'Rejected' });
      if (res && res.ok) {
        if (typeof showToast === 'function') showToast(`Rejected commit ${trackId}`, 'info');
        document.getElementById('tt-ws-approvals-modal')?.remove();
        await openApprovalsModal();
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message || 'Reject failed', 'error');
    }
  }

  async function withdrawCommit(trackId) {
    if (!confirm(`Withdraw commit ${trackId}? Drafts will be unlocked back to editing state.`)) return;
    try {
      const res = await apiCall('POST', `/timetable/commits/${trackId}/withdraw`);
      if (res && res.ok) {
        if (typeof showToast === 'function') showToast(`Withdrew commit ${trackId}`, 'info');
        document.getElementById('tt-ws-approvals-modal')?.remove();
        await selectWorkspace(moduleState.activeWorkspaceId);
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message || 'Withdraw failed', 'error');
    }
  }

  async function openMergeModal(classId) {
    if (!moduleState.activeWorkspaceId || !classId) return;

    try {
      const res = await apiCall('GET', `/timetable/workspaces/${moduleState.activeWorkspaceId}/classes/${classId}/merge-status`);
      if (!res || !res.ok) throw new Error(res?.error || 'Failed to fetch merge status');

      const modal = document.createElement('div');
      modal.className = 'modal-backdrop active';
      modal.id = 'tt-ws-merge-modal';

      modal.innerHTML = `
        <div class="modal-box" style="max-width:520px;width:95%;">
          <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border,#e2e8f0);">
            <h3 style="margin:0;font-size:15px;font-weight:700;">Merge Stale Draft: ${esc(res.className)}</h3>
            <button type="button" class="btn-close" onclick="document.getElementById('tt-ws-merge-modal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;">✕</button>
          </div>
          <div class="modal-bd" style="padding:16px 18px;">
            <div style="font-size:12.5px;color:var(--text-pri,#1e293b);margin-bottom:12px;">
              Production timetable for <strong>${esc(res.className)}</strong> changed to <strong>${esc(res.currentHeadTrackId)}</strong>.
              Your draft was forked from <strong>${esc(res.baseTrackId)}</strong>.
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              <button type="button" class="btn-pri" onclick="window.TimetableWorkspaceModule.runClassMerge('${classId}', 'auto')" style="text-align:left;padding:10px 14px;border-radius:6px;cursor:pointer;background:#15803d;color:#ffffff;border:none;">
                <div style="font-weight:700;font-size:13px;">Merge Automatically (Recommended)</div>
                <div style="font-size:11.5px;opacity:0.9;">Runs 3-way merge and automatically incorporates non-conflicting changes.</div>
              </button>
              <button type="button" class="btn-out" onclick="window.TimetableWorkspaceModule.runClassMerge('${classId}', 'keep-mine')" style="text-align:left;padding:10px 14px;border-radius:6px;cursor:pointer;">
                <div style="font-weight:700;font-size:13px;color:var(--text-pri,#1e293b);">Keep Workspace Version</div>
                <div style="font-size:11.5px;color:var(--text-sec,#64748b);">Override production changes with your draft edits (reason required).</div>
              </button>
              <button type="button" class="btn-out" onclick="window.TimetableWorkspaceModule.runClassMerge('${classId}', 'take-production')" style="text-align:left;padding:10px 14px;border-radius:6px;cursor:pointer;">
                <div style="font-weight:700;font-size:13px;color:var(--text-pri,#1e293b);">Take Production Version</div>
                <div style="font-size:11.5px;color:var(--text-sec,#64748b);">Discard workspace draft for this class and re-fork from live production.</div>
              </button>
            </div>
          </div>
          <div class="modal-ft" style="display:flex;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--border,#e2e8f0);">
            <button type="button" class="btn-out" onclick="document.getElementById('tt-ws-merge-modal').remove()" style="padding:6px 14px;border-radius:6px;cursor:pointer;">Cancel</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, 'error');
    }
  }

  async function runClassMerge(classId, strategy) {
    let reason = '';
    if (strategy === 'keep-mine') {
      reason = prompt('Please enter a reason for keeping the workspace draft over production:');
      if (!reason || !reason.trim()) {
        if (typeof showToast === 'function') showToast('A reason is required to keep workspace draft', 'warning');
        return;
      }
    }

    try {
      const res = await apiCall('POST', `/timetable/workspaces/${moduleState.activeWorkspaceId}/classes/${classId}/merge`, {
        strategy,
        reason: reason.trim()
      });

      if (res && res.ok) {
        document.getElementById('tt-ws-merge-modal')?.remove();
        if (typeof showToast === 'function') {
          showToast(`Successfully resolved merge for class!`, 'success');
        }
        await selectWorkspace(moduleState.activeWorkspaceId);
      } else if (res && res.clean === false) {
        alert(`Merge conflict detected on ${res.conflicts.length} slot(s). Please review slots or select 'Keep Workspace Version'.`);
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message || 'Merge failed', 'error');
    }
  }

  // ── Hotfix Modal & Execution (HoD Quick Fix) ──

  async function openHotfixModal(defaultClassId = null) {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop active';
    modal.id = 'tt-ws-hotfix-modal';

    const classes = (window._masterData && window._masterData.classes) ? window._masterData.classes : [];
    const subjects = (window._masterData && window._masterData.subjects) ? window._masterData.subjects : [];
    const teachers = (window._masterData && window._masterData.teachers) ? window._masterData.teachers : [];
    const rooms = (window._masterData && window._masterData.rooms) ? window._masterData.rooms : [];

    const activeClassId = defaultClassId || (typeof getSelectedClassId === 'function' ? getSelectedClassId() : null);

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const periods = [1, 2, 3, 4, 5, 6, 7, 8];

    modal.innerHTML = `
      <div class="modal-box" style="max-width:560px;width:95%;">
        <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border,#e2e8f0);">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;">⚡</span>
            <h3 style="margin:0;font-size:15px;font-weight:700;color:#991b1b;">Production Quick Fix (HoD Lane)</h3>
          </div>
          <button type="button" class="btn-close" onclick="document.getElementById('tt-ws-hotfix-modal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="modal-bd" style="padding:16px 18px;max-height:480px;overflow-y:auto;">
          <div style="padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:12px;color:#991b1b;margin-bottom:14px;">
            <strong>Emergency Production Hotfix</strong>: Changes bypass draft approval, self-approve under HoD authority, and execute through the 8-stage deploy pipeline. A mandatory reason is required.
          </div>

          <div class="form-group" style="margin-bottom:12px;">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Target Class *</label>
            <select id="tt-hotfix-class" class="form-control" style="width:100%;padding:7px 10px;font-size:13px;border-radius:6px;border:1px solid var(--border,#cbd5e1);">
              <option value="">-- Select Class --</option>
              ${classes.map(c => `
                <option value="${esc(c._id)}" ${String(c._id) === String(activeClassId) ? 'selected' : ''}>${esc(c.name || c.className || c._id)}</option>
              `).join('')}
            </select>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
            <div>
              <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Action *</label>
              <select id="tt-hotfix-op" class="form-control" style="width:100%;padding:7px 10px;font-size:12.5px;border-radius:6px;border:1px solid var(--border,#cbd5e1);" onchange="document.getElementById('tt-hotfix-slot-fields').style.display = this.value === 'clear' ? 'none' : 'block';">
                <option value="set">Set / Update Slot</option>
                <option value="clear">Clear Slot</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Day *</label>
              <select id="tt-hotfix-day" class="form-control" style="width:100%;padding:7px 10px;font-size:12.5px;border-radius:6px;border:1px solid var(--border,#cbd5e1);">
                ${days.map(d => `<option value="${d}">${d}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Period *</label>
              <select id="tt-hotfix-period" class="form-control" style="width:100%;padding:7px 10px;font-size:12.5px;border-radius:6px;border:1px solid var(--border,#cbd5e1);">
                ${periods.map(p => `<option value="${p}">Period ${p}</option>`).join('')}
              </select>
            </div>
          </div>

          <div id="tt-hotfix-slot-fields" style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px;padding:10px 12px;border:1px solid var(--border,#e2e8f0);border-radius:6px;background:var(--bg-subtle,#f8fafc);">
            <div>
              <label style="display:block;font-size:11.5px;font-weight:600;margin-bottom:3px;">Subject</label>
              <select id="tt-hotfix-subject" class="form-control" style="width:100%;padding:6px 9px;font-size:12.5px;border-radius:5px;border:1px solid var(--border,#cbd5e1);">
                <option value="">-- Select Subject --</option>
                ${subjects.map(s => `<option value="${esc(s._id)}" data-name="${esc(s.name || s.code)}">${esc(s.name || s.code)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="display:block;font-size:11.5px;font-weight:600;margin-bottom:3px;">Teacher</label>
              <select id="tt-hotfix-teacher" class="form-control" style="width:100%;padding:6px 9px;font-size:12.5px;border-radius:5px;border:1px solid var(--border,#cbd5e1);">
                <option value="">-- Select Teacher --</option>
                ${teachers.map(t => `<option value="${esc(t._id)}" data-name="${esc(t.name)}">${esc(t.name)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="display:block;font-size:11.5px;font-weight:600;margin-bottom:3px;">Room</label>
              <select id="tt-hotfix-room" class="form-control" style="width:100%;padding:6px 9px;font-size:12.5px;border-radius:5px;border:1px solid var(--border,#cbd5e1);">
                <option value="">-- Select Room --</option>
                ${rooms.map(r => `<option value="${esc(r._id)}" data-name="${esc(r.roomNumber || r.name)}">${esc(r.roomNumber || r.name)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-group" style="margin-bottom:12px;">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Reason for Hotfix *</label>
            <textarea id="tt-hotfix-reason" class="form-control" placeholder="Required: e.g. Emergency medical faculty substitution..." style="width:100%;height:50px;padding:7px 10px;font-size:12px;border-radius:6px;border:1px solid var(--border,#cbd5e1);"></textarea>
          </div>

          <div class="form-group" style="margin-bottom:8px;">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Commit Message (Optional)</label>
            <input type="text" id="tt-hotfix-msg" class="form-control" placeholder="e.g. Quick fix for substitute teacher" style="width:100%;padding:6px 10px;font-size:12px;border-radius:6px;border:1px solid var(--border,#cbd5e1);">
          </div>

          <div id="tt-hotfix-err" style="display:none;margin-top:10px;padding:8px 12px;border-radius:6px;background:#fee2e2;border:1px solid #fecaca;color:#991b1b;font-size:12px;"></div>
        </div>
        <div class="modal-ft" style="display:flex;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid var(--border,#e2e8f0);">
          <button type="button" class="btn-out" onclick="document.getElementById('tt-ws-hotfix-modal').remove()" style="padding:6px 14px;border-radius:6px;cursor:pointer;">Cancel</button>
          <button type="button" class="btn-pri" onclick="window.TimetableWorkspaceModule.executeHotfixCommit()" style="padding:6px 16px;border-radius:6px;cursor:pointer;background:#dc2626;color:#ffffff;border:none;font-weight:600;">Deploy Hotfix Now ⚡</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('tt-hotfix-reason')?.focus();
  }

  async function executeHotfixCommit() {
    const classEl = document.getElementById('tt-hotfix-class');
    const classId = classEl ? classEl.value : '';
    if (!classId) {
      if (typeof showToast === 'function') showToast('Please select a target class for the hotfix', 'warning');
      return;
    }

    const reasonEl = document.getElementById('tt-hotfix-reason');
    const reason = reasonEl ? reasonEl.value.trim() : '';
    if (!reason) {
      if (typeof showToast === 'function') showToast('A mandatory reason is required for production hotfix', 'warning');
      return;
    }

    const opEl = document.getElementById('tt-hotfix-op');
    const op = opEl ? opEl.value : 'set';
    const day = document.getElementById('tt-hotfix-day')?.value || 'Monday';
    const period = parseInt(document.getElementById('tt-hotfix-period')?.value || '1', 10);

    const slot = { day, period };
    if (op === 'set') {
      const subEl = document.getElementById('tt-hotfix-subject');
      const teaEl = document.getElementById('tt-hotfix-teacher');
      const rmEl = document.getElementById('tt-hotfix-room');

      if (subEl && subEl.value) {
        slot.subjectId = subEl.value;
        slot.subject = subEl.options[subEl.selectedIndex]?.getAttribute('data-name') || '';
      }
      if (teaEl && teaEl.value) {
        slot.teacherId = teaEl.value;
        slot.teacher = teaEl.options[teaEl.selectedIndex]?.getAttribute('data-name') || '';
      }
      if (rmEl && rmEl.value) {
        slot.roomId = rmEl.value;
        slot.room = rmEl.options[rmEl.selectedIndex]?.getAttribute('data-name') || '';
      }
    }

    const msgEl = document.getElementById('tt-hotfix-msg');
    const message = msgEl ? msgEl.value.trim() : '';

    const errEl = document.getElementById('tt-hotfix-err');
    if (errEl) errEl.style.display = 'none';

    try {
      const res = await apiCall('POST', '/timetable/hotfix', {
        classId,
        ops: [{ op, slot }],
        reason,
        message: message || undefined
      });

      if (res && res.ok) {
        document.getElementById('tt-ws-hotfix-modal')?.remove();
        if (typeof showToast === 'function') {
          showToast(`Hotfix ${res.commit?.trackId || ''} deployed successfully!`, 'success');
        }
        if (window.workspace && typeof window.workspace.refreshAllTabs === 'function') {
          window.workspace.refreshAllTabs();
        } else if (typeof renderCurrentView === 'function') {
          renderCurrentView();
        }
      } else {
        const errorMsg = res?.error || 'Hotfix deployment failed';
        if (errEl) {
          errEl.textContent = errorMsg;
          errEl.style.display = 'block';
        } else if (typeof showToast === 'function') {
          showToast(errorMsg, 'error');
        }
      }
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Hotfix deployment failed';
        errEl.style.display = 'block';
      } else if (typeof showToast === 'function') {
        showToast(err.message || 'Hotfix deployment failed', 'error');
      }
    }
  }

  function switchEnv(targetEnv) {
    if (targetEnv === 'production') {
      moduleState.env = 'production';
      saveUserState({ env: 'production' });
      renderRibbons();
      if (typeof showToast === 'function') showToast('Switched to Live Production (View Only)', 'info');
      if (window.workspace && typeof window.workspace.refreshAllTabs === 'function') {
        window.workspace.refreshAllTabs();
      } else if (typeof renderCurrentView === 'function') {
        renderCurrentView();
      }
    } else if (targetEnv === 'development') {
      if (moduleState.activeWorkspaceId) {
        selectWorkspace(moduleState.activeWorkspaceId);
      } else {
        openWorkspaceSwitcher();
      }
    }
  }

  // ── Keyboard Shortcuts (Alt+W & Ctrl+S) ──

  function initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Alt+W: open workspace switcher
      if (e.altKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        openWorkspaceSwitcher();
      }

      // Ctrl+S: save checkpoint if in workspace development mode
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        if (moduleState.env === 'development' && moduleState.activeWorkspaceId) {
          e.preventDefault();
          openCheckpointModal();
        }
      }
    });
  }

  async function openWorkspaceSwitcher() {
    const workspaces = await fetchWorkspaces('dept');
    let sharedWorkspaces = [];
    try {
      const sRes = await apiCall('GET', '/timetable/workspaces/shared-with-me');
      if (sRes && Array.isArray(sRes.shares)) {
        sharedWorkspaces = sRes.shares.map(s => ({
          ...(s.workspace || {}),
          level: s.level,
          shareId: s._id
        })).filter(w => w._id);
      }
    } catch (_) {}

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop active';
    modal.id = 'tt-ws-switcher-modal';

    modal.innerHTML = `
      <div class="modal-box" style="max-width:520px;width:95%;">
        <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border,#e2e8f0);">
          <h3 style="margin:0;font-size:15px;font-weight:700;">Switch Workspace (Alt+W)</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('tt-ws-switcher-modal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="modal-bd" style="padding:14px 18px;max-height:420px;overflow-y:auto;">
          <div style="margin-bottom:12px;">
            <button type="button" class="btn-pri" onclick="document.getElementById('tt-ws-switcher-modal').remove(); window.TimetableWorkspaceModule.openCreateModal();" style="width:100%;padding:8px;font-size:13px;border-radius:6px;cursor:pointer;">
              + Create New Workspace
            </button>
          </div>
          <div style="font-size:11px;font-weight:700;color:var(--text-sec,#64748b);text-transform:uppercase;margin-bottom:8px;letter-spacing:0.04em;">Department Workspaces</div>
          ${workspaces.length === 0 ? `
            <div style="text-align:center;padding:16px;color:var(--text-sec,#64748b);font-size:12px;">No open workspaces found for your department.</div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
              ${workspaces.map(w => `
                <div onclick="document.getElementById('tt-ws-switcher-modal').remove(); window.TimetableWorkspaceModule.selectWorkspace('${w._id}')" style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border:1px solid var(--border,#e2e8f0);border-radius:6px;cursor:pointer;background:${moduleState.activeWorkspaceId === w._id ? '#f0fdf4' : 'var(--card,#ffffff)'};">
                  <div>
                    <div style="font-weight:600;font-size:13px;color:var(--text-pri,#1e293b);">${esc(w.name)}</div>
                    <div style="font-size:11.5px;color:var(--text-sec,#64748b);">${esc(w.trackId)} · ${w.classCount || 0} class(es) · ${esc(w.ownerName || 'TTC')}</div>
                  </div>
                  <div style="font-size:12px;color:var(--primary,#3b82f6);font-weight:600;">Select ▸</div>
                </div>
              `).join('')}
            </div>
          `}

          <!-- Shared with Me (Section 7.3) -->
          <div style="font-size:11px;font-weight:700;color:var(--text-sec,#64748b);text-transform:uppercase;margin-bottom:8px;letter-spacing:0.04em;display:flex;align-items:center;justify-content:space-between;">
            <span>Shared With Me</span>
            <span style="font-size:11px;color:#15803d;cursor:pointer;font-weight:600;" onclick="document.getElementById('tt-ws-switcher-modal').remove(); window.TimetableShareModule && window.TimetableShareModule.openSharedWithMeModal();">View All ↗</span>
          </div>
          ${sharedWorkspaces.length === 0 ? `
            <div style="text-align:center;padding:16px;color:var(--text-sec,#64748b);font-size:12px;">No workspaces shared with your department.</div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${sharedWorkspaces.map(w => `
                <div onclick="document.getElementById('tt-ws-switcher-modal').remove(); window.TimetableWorkspaceModule.selectWorkspace('${w._id}')" style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border:1px solid #bbf7d0;border-radius:6px;cursor:pointer;background:${moduleState.activeWorkspaceId === w._id ? '#f0fdf4' : '#fff'};">
                  <div>
                    <div style="display:flex;align-items:center;gap:6px;">
                      <span style="font-weight:600;font-size:13px;color:var(--text-pri,#1e293b);">${esc(w.name)}</span>
                      <span style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;background:#dcfce7;color:#166534;text-transform:uppercase;">${esc(w.level || 'fill')}</span>
                    </div>
                    <div style="font-size:11.5px;color:var(--text-sec,#64748b);">Dept: ${esc(w.deptName || 'Owner')} · ${esc(w.trackId)}</div>
                  </div>
                  <div style="font-size:12px;color:#15803d;font-weight:600;">Open ▸</div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  // ── Module Initialization ──

  async function init() {
    await loadUserState();
    renderRibbons();
    initKeyboardShortcuts();

    // If an active workspace was restored, select it
    if (moduleState.env === 'development' && moduleState.activeWorkspaceId) {
      await selectWorkspace(moduleState.activeWorkspaceId);
    }
  }

  // Expose global interface
  window.TimetableWorkspaceModule = {
    init,
    getUserState: () => moduleState.userState,
    saveUserState,
    syncTabs,
    fetchWorkspaces,
    selectWorkspace,
    queueSlotEdit,
    flushClassEdits,
    openCreateModal,
    submitCreateModal,
    openCheckpointModal,
    submitCheckpointModal,
    openCheckpointsList,
    restoreCheckpoint,
    openWorkspaceSwitcher,
    switchEnv,
    renderRibbons,
    openSubmitModal,
    submitWorkspaceCommit,
    openApprovalsModal,
    approveCommit,
    rejectCommit,
    withdrawCommit,
    openMergeModal,
    runClassMerge,
    openHotfixModal,
    executeHotfixCommit,
    getState: () => ({ ...moduleState })
  };

  // Auto-initialize when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
