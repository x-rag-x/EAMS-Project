/**
 * public/js/modules/hub.module.js
 * EAMS Timetable v3 — Workspace Hub View
 * Implements the multi-class Workspace Hub, Development vs Production collections,
 * search & filtering, quick shelf, card 3-dot actions, and new workspace creation.
 */

(function (window) {
  'use strict';

  class WorkspaceHubView {
    constructor(containerEl) {
      this.containerEl = typeof containerEl === 'string' ? document.querySelector(containerEl) : containerEl;
      this.workspaces = [];
      this.currentFilter = 'all'; // all | development | production | mine | shared | archived
      this.searchQuery = '';
      this.searchTimer = null;
      this.loading = false;
    }

    /**
     * Mounts and loads the Workspace Hub
     */
    async load() {
      if (!this.containerEl) return;
      this.loading = true;
      this.render();

      try {
        await this.fetchWorkspaces();
      } catch (err) {
        console.error('[WorkspaceHubView] Error loading workspaces:', err);
      } finally {
        this.loading = false;
        this.render();
      }
    }

    async fetchWorkspaces() {
      let queryParams = new URLSearchParams();
      if (this.currentFilter === 'development' || this.currentFilter === 'production') {
        queryParams.set('kind', this.currentFilter);
      } else if (this.currentFilter === 'archived') {
        queryParams.set('scope', 'archived');
      } else if (this.currentFilter === 'mine') {
        queryParams.set('scope', 'mine');
      } else if (this.currentFilter === 'shared') {
        queryParams.set('scope', 'shared');
      }

      if (this.searchQuery.trim()) {
        queryParams.set('q', this.searchQuery.trim());
      }

      const token = (typeof getToken === 'function' ? getToken() : null) || (window.sessionStorage ? (sessionStorage.getItem('eams_token') || sessionStorage.getItem('token')) : null);
      const res = await fetch(`/api/timetable/workspaces?${queryParams.toString()}`, {
        headers: token ? { 'Authorization': 'Bearer ' + token } : {}
      });

      if (!res.ok) {
        throw new Error(`Failed to load workspaces (${res.status})`);
      }

      const data = await res.json();
      this.workspaces = data.workspaces || [];
    }

    setFilter(filterKey) {
      this.currentFilter = filterKey;
      this.fetchWorkspaces().then(() => this.render());
    }

    handleSearch(query) {
      this.searchQuery = query;
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.fetchWorkspaces().then(() => this.render());
      }, 250);
    }

    render() {
      if (!this.containerEl) return;

      this.containerEl.innerHTML = `
        <div class="tt-hub-wrapper" style="padding: 24px 32px; max-width: 1400px; margin: 0 auto; color: var(--td, #1e293b); font-family: var(--font-base, 'Poppins', sans-serif);">
          
          <!-- Hub Header & Actions Bar -->
          <div class="tt-hub-header" style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 18px; margin-bottom: 24px;">
            <div>
              <h1 style="font-size: 26px; font-weight: 700; margin: 0 0 4px 0; color: var(--td, #0f172a);">Workspaces</h1>
              <div style="font-size: 13.5px; color: var(--tmu, #64748b);">Organize academic timetable collections across departments and semesters.</div>
            </div>

            <div style="display: flex; gap: 12px; align-items: center;">
              <button type="button" class="btn-pri" id="btn-create-workspace" style="display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; border-radius: 9px; font-weight: 600; font-size: 13px; cursor: pointer;">
                <re-icon icon="plus" size="16"></re-icon> New Workspace
              </button>
            </div>
          </div>

          <!-- Search & Filter Ribbon -->
          <div class="tt-hub-filter-bar" style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 14px; margin-bottom: 28px; background: var(--bg-card, #ffffff); padding: 12px 18px; border-radius: 12px; border: 1px solid var(--br, #e2e8f0); box-shadow: 0 2px 6px rgba(0,0,0,0.02);">
            
            <!-- Filter Pills -->
            <div class="tt-hub-pills" style="display: flex; gap: 6px; flex-wrap: wrap;" role="tablist">
              ${this._renderFilterPill('all', 'All')}
              ${this._renderFilterPill('development', 'Development')}
              ${this._renderFilterPill('production', 'Production')}
              ${this._renderFilterPill('mine', 'Mine')}
              ${this._renderFilterPill('shared', 'Shared with me')}
              ${this._renderFilterPill('archived', 'Archived')}
            </div>

            <!-- Search Input -->
            <div style="position: relative; min-width: 260px; max-width: 380px; flex: 1;">
              <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #94a3b8; pointer-events: none;">
                <re-icon icon="search" size="16"></re-icon>
              </span>
              <input type="text" id="tt-hub-search-input" placeholder="Search workspaces, track IDs..." value="${this._escapeHtml(this.searchQuery)}" style="width: 100%; padding: 8px 12px 8px 36px; border-radius: 8px; border: 1px solid var(--br, #cbd5e1); font-size: 13px; outline: none; box-sizing: border-box; background: var(--bg-card, #ffffff);" />
            </div>
          </div>

          <!-- Content Region -->
          ${this.loading ? this._renderLoading() : this._renderWorkspacesGrid()}
        </div>
      `;

      this._bindEvents();
    }

    _renderFilterPill(key, label) {
      const active = this.currentFilter === key;
      const bg = active ? 'var(--gD, #1b5e20)' : 'transparent';
      const color = active ? '#ffffff' : 'var(--td, #475569)';
      const weight = active ? '600' : '500';
      return `
        <button type="button" class="tt-hub-filter-btn" data-filter="${key}" style="padding: 6px 14px; border-radius: 20px; border: none; background: ${bg}; color: ${color}; font-weight: ${weight}; font-size: 12.5px; cursor: pointer; transition: all 0.15s ease;">
          ${label}
        </button>
      `;
    }

    _renderLoading() {
      return `
        <div style="text-align: center; padding: 60px 20px; color: #64748b;">
          <div style="font-size: 14px; font-weight: 500;">Loading workspaces...</div>
        </div>
      `;
    }

    _renderWorkspacesGrid() {
      if (!this.workspaces.length) {
        return `
          <div style="text-align: center; padding: 80px 20px; background: var(--bg-card, #ffffff); border-radius: 14px; border: 1px dashed var(--br, #cbd5e1); margin-top: 10px;">
            <div style="font-size: 40px; margin-bottom: 12px;">📁</div>
            <div style="font-size: 17px; font-weight: 600; color: var(--td, #1e293b); margin-bottom: 6px;">No Workspaces Found</div>
            <div style="font-size: 13.5px; color: var(--tmu, #64748b); max-width: 420px; margin: 0 auto 18px auto;">
              ${this.searchQuery ? `No workspaces matched "${this._escapeHtml(this.searchQuery)}". Try adjusting your search query.` : 'Get started by creating your first timetable workspace for your department.'}
            </div>
            <button type="button" class="btn-pri" id="btn-empty-create" style="padding: 8px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;">
              Create Workspace
            </button>
          </div>
        `;
      }

      return `
        <div class="tt-hub-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 20px;">
          ${this.workspaces.map(ws => this._renderCard(ws)).join('')}
        </div>
      `;
    }

    _renderCard(ws) {
      const isDev = ws.kind === 'development';
      const isArchived = ws.status === 'archived';
      const badgeText = isDev ? 'DEVELOPMENT' : 'PRODUCTION';
      const badgeBg = isDev ? '#FEF3C7' : '#DCFCE7';
      const badgeTx = isDev ? '#92400E' : '#166534';
      const badgeBr = isDev ? '#FDE68A' : '#BBF7D0';

      const classCount = (ws.classIds || []).length;
      const updatedStr = ws.updatedAt ? new Date(ws.updatedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

      return `
        <div class="tt-workspace-card" data-ws-id="${ws._id}" style="background: var(--bg-card, #ffffff); border-radius: 14px; border: 1px solid var(--br, #e2e8f0); padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.03); display: flex; flex-direction: column; justify-content: space-between; position: relative; transition: transform 0.18s ease, box-shadow 0.18s ease; cursor: pointer;">
          
          <div>
            <!-- Top Card Header -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 10px;">
              <div>
                <span style="display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.5px; background: ${badgeBg}; color: ${badgeTx}; border: 1px solid ${badgeBr}; margin-bottom: 6px;">
                  ${badgeText}
                </span>
                <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 2px 0; color: var(--td, #0f172a); line-height: 1.35;">
                  ${this._escapeHtml(ws.name)}
                </h3>
                <div style="font-size: 11.5px; font-family: monospace; color: var(--tmu, #64748b);">
                  ${this._escapeHtml(ws.trackId || '')}
                </div>
              </div>

              <!-- Card 3-dot dropdown menu trigger -->
              <div class="tt-card-menu-wrap" style="position: relative;">
                <button type="button" class="tt-card-menu-btn" data-ws-id="${ws._id}" title="Actions" style="background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 4px 6px; cursor: pointer; color: #64748b;">
                  <re-icon icon="more-horizontal" size="18"></re-icon>
                </button>
                <div class="tt-card-dropdown" id="dropdown-${ws._id}" style="display: none; position: absolute; right: 0; top: 100%; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px rgba(0,0,0,0.1); z-index: 50; min-width: 160px; overflow: hidden;" role="menu">
                  <button type="button" class="tt-card-action" data-action="open" data-ws-id="${ws._id}" style="width: 100%; text-align: left; padding: 9px 14px; font-size: 12.5px; border: none; background: transparent; cursor: pointer; color: #1e293b;">
                    Open Workspace
                  </button>
                  <button type="button" class="tt-card-action" data-action="duplicate" data-ws-id="${ws._id}" style="width: 100%; text-align: left; padding: 9px 14px; font-size: 12.5px; border: none; background: transparent; cursor: pointer; color: #1e293b;">
                    Duplicate
                  </button>
                  <button type="button" class="tt-card-action" data-action="history" data-ws-id="${ws._id}" style="width: 100%; text-align: left; padding: 9px 14px; font-size: 12.5px; border: none; background: transparent; cursor: pointer; color: #1e293b;">
                    Version History
                  </button>
                  ${isArchived ? `
                    <button type="button" class="tt-card-action" data-action="unarchive" data-ws-id="${ws._id}" style="width: 100%; text-align: left; padding: 9px 14px; font-size: 12.5px; border: none; background: transparent; cursor: pointer; color: #166534; border-top: 1px solid #f1f5f9;">
                      Restore Workspace
                    </button>
                  ` : `
                    <button type="button" class="tt-card-action" data-action="archive" data-ws-id="${ws._id}" title="Moves to Archived, restorable for 30 days" style="width: 100%; text-align: left; padding: 9px 14px; font-size: 12.5px; border: none; background: transparent; cursor: pointer; color: #b91c1c; border-top: 1px solid #f1f5f9;">
                      Delete (Archive)
                    </button>
                  `}
                </div>
              </div>
            </div>

            <!-- Details: Department, Semester -->
            <div style="font-size: 12.5px; color: var(--tmu, #64748b); margin-bottom: 12px;">
              ${this._escapeHtml(ws.deptName || 'Department')} · ${this._escapeHtml(ws.semester || 'Odd')} Semester
            </div>

            <!-- Classes summary pill -->
            <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 16px;">
              <span style="font-size: 11.5px; padding: 2px 8px; border-radius: 4px; background: #f1f5f9; color: #475569; font-weight: 500;">
                📚 ${classCount} ${classCount === 1 ? 'class section' : 'class sections'}
              </span>
            </div>
          </div>

          <!-- Bottom Card Footer -->
          <div style="border-top: 1px solid var(--br, #f1f5f9); padding-top: 12px; margin-top: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: var(--tmu, #94a3b8);">
            <span>Updated ${updatedStr}</span>
            <span style="font-weight: 600; color: var(--gD, #1b5e20);">Open →</span>
          </div>
        </div>
      `;
    }

    _bindEvents() {
      // Filter buttons
      this.containerEl.querySelectorAll('.tt-hub-filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setFilter(btn.dataset.filter);
        });
      });

      // Search input
      const searchInput = this.containerEl.querySelector('#tt-hub-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
      }

      // Create Workspace triggers
      const createBtn = this.containerEl.querySelector('#btn-create-workspace');
      if (createBtn) createBtn.addEventListener('click', () => this.showCreateModal());
      const emptyCreateBtn = this.containerEl.querySelector('#btn-empty-create');
      if (emptyCreateBtn) emptyCreateBtn.addEventListener('click', () => this.showCreateModal());

      // Card clicks to open workspace
      this.containerEl.querySelectorAll('.tt-workspace-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.tt-card-menu-wrap')) return;
          const wsId = card.dataset.wsId;
          this.openWorkspace(wsId);
        });
      });

      // 3-dot dropdown menu toggles
      this.containerEl.querySelectorAll('.tt-card-menu-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const wsId = btn.dataset.wsId;
          const dropdown = this.containerEl.querySelector(`#dropdown-${wsId}`);
          // Close all other dropdowns
          this.containerEl.querySelectorAll('.tt-card-dropdown').forEach(dd => {
            if (dd !== dropdown) dd.style.display = 'none';
          });
          if (dropdown) {
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
          }
        });
      });

      // Card actions (open, duplicate, archive, unarchive, history)
      this.containerEl.querySelectorAll('.tt-card-action').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          const wsId = btn.dataset.wsId;
          if (action === 'open') {
            this.openWorkspace(wsId);
          } else if (action === 'duplicate') {
            await this.duplicateWorkspace(wsId);
          } else if (action === 'archive') {
            await this.archiveWorkspace(wsId);
          } else if (action === 'unarchive') {
            await this.unarchiveWorkspace(wsId);
          } else if (action === 'history') {
            if (typeof switchTab === 'function') switchTab('history');
          }
        });
      });

      // Close dropdowns on document click
      document.addEventListener('click', () => {
        if (!this.containerEl) return;
        this.containerEl.querySelectorAll('.tt-card-dropdown').forEach(dd => {
          dd.style.display = 'none';
        });
      }, { once: true });
    }

    async openWorkspace(wsId) {
      const ws = this.workspaces.find(w => String(w._id) === String(wsId));
      if (!ws) return;

      // Persist active workspace in DB
      if (typeof syncUserStateToDb === 'function') {
        syncUserStateToDb({ activeWorkspaceId: wsId, env: ws.kind || 'development' });
      }

      if (window.state) {
        window.state.activeWorkspaceId = wsId;
        window.state.activeWorkspace = ws;
      }

      // Switch mode/lens accordingly
      if (typeof switchEnv === 'function') {
        await switchEnv(ws.kind || 'development');
      }

      // Navigate to matrix grid
      if (typeof switchTab === 'function') {
        switchTab('grid');
      }
    }

    async duplicateWorkspace(wsId) {
      if (!confirm('Duplicate this workspace for a new semester?')) return;
      try {
        const token = (typeof getToken === 'function' ? getToken() : null) || (window.sessionStorage ? (sessionStorage.getItem('eams_token') || sessionStorage.getItem('token')) : null);
        const res = await fetch(`/api/timetable/workspaces/${wsId}/duplicate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': 'Bearer ' + token } : {})
          }
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Duplicate failed');
        }
        if (typeof showToast === 'function') showToast('Workspace duplicated successfully', 'success');
        await this.fetchWorkspaces();
        this.render();
      } catch (err) {
        if (typeof showToast === 'function') showToast(err.message, 'error');
        else alert(err.message);
      }
    }

    async archiveWorkspace(wsId) {
      if (!confirm('Are you sure you want to delete this workspace? (Moves to Archived, restorable for 30 days)')) return;
      try {
        const token = (typeof getToken === 'function' ? getToken() : null) || (window.sessionStorage ? (sessionStorage.getItem('eams_token') || sessionStorage.getItem('token')) : null);
        const res = await fetch(`/api/timetable/workspaces/${wsId}/archive`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': 'Bearer ' + token } : {})
          }
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Archive failed');
        }
        if (typeof showToast === 'function') showToast('Workspace archived', 'success');
        await this.fetchWorkspaces();
        this.render();
      } catch (err) {
        if (typeof showToast === 'function') showToast(err.message, 'error');
        else alert(err.message);
      }
    }

    async unarchiveWorkspace(wsId) {
      try {
        const token = (typeof getToken === 'function' ? getToken() : null) || (window.sessionStorage ? (sessionStorage.getItem('eams_token') || sessionStorage.getItem('token')) : null);
        const res = await fetch(`/api/timetable/workspaces/${wsId}/unarchive`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': 'Bearer ' + token } : {})
          }
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Restore failed');
        }
        if (typeof showToast === 'function') showToast('Workspace restored', 'success');
        await this.fetchWorkspaces();
        this.render();
      } catch (err) {
        if (typeof showToast === 'function') showToast(err.message, 'error');
        else alert(err.message);
      }
    }

    showCreateModal() {
      const modalId = 'tt-create-workspace-modal';
      let modal = document.getElementById(modalId);
      if (modal) modal.remove();

      modal = document.createElement('div');
      modal.id = modalId;
      modal.className = 'modal-bg';
      modal.style.display = 'flex';
      modal.style.zIndex = '900';

      modal.innerHTML = `
        <div class="modal modal-md" style="max-width: 520px; border-radius: 16px; padding: 24px;">
          <div class="modal-hd" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px;">
            <div>
              <span class="modal-eyebrow" style="color: var(--gD, #1b5e20); font-weight: 700; font-size: 11px;">ACADEMIC WORKSPACE</span>
              <h2 class="modal-title" style="font-size: 18px; margin: 4px 0 0 0;">Create New Workspace</h2>
            </div>
            <button type="button" class="modal-close" id="close-create-ws" aria-label="Close" style="background: none; border: none; font-size: 18px; cursor: pointer;">✕</button>
          </div>

          <div class="modal-body" style="display: flex; flex-direction: column; gap: 14px;">
            <div class="fg">
              <label class="fl" style="font-weight: 600; font-size: 12.5px; margin-bottom: 6px; display: block;">Workspace Name *</label>
              <input type="text" id="ws-input-name" placeholder="e.g. CSE Spring 2026 · Semester 4" style="width: 100%; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--br, #cbd5e1); font-size: 13px; box-sizing: border-box;" />
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="fg">
                <label class="fl" style="font-weight: 600; font-size: 12.5px; margin-bottom: 6px; display: block;">Kind</label>
                <select id="ws-input-kind" style="width: 100%; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--br, #cbd5e1); font-size: 13px; box-sizing: border-box;">
                  <option value="development">Development (Editable Drafts)</option>
                  <option value="production">Production (Published Baseline)</option>
                </select>
              </div>

              <div class="fg">
                <label class="fl" style="font-weight: 600; font-size: 12.5px; margin-bottom: 6px; display: block;">Semester</label>
                <select id="ws-input-semester" style="width: 100%; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--br, #cbd5e1); font-size: 13px; box-sizing: border-box;">
                  <option value="Odd">Odd Semester</option>
                  <option value="Even">Even Semester</option>
                </select>
              </div>
            </div>

            <div class="fg">
              <label class="fl" style="font-weight: 600; font-size: 12.5px; margin-bottom: 6px; display: block;">Academic Year</label>
              <input type="text" id="ws-input-year" placeholder="e.g. 2025-2026" style="width: 100%; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--br, #cbd5e1); font-size: 13px; box-sizing: border-box;" />
            </div>
          </div>

          <div class="modal-ft" style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px;">
            <button type="button" class="btn-out" id="cancel-create-ws" style="padding: 8px 16px; border-radius: 8px; cursor: pointer;">Cancel</button>
            <button type="button" class="btn-pri" id="submit-create-ws" style="padding: 8px 18px; border-radius: 8px; font-weight: 600; cursor: pointer;">Create Workspace</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const closeModal = () => modal.remove();
      modal.querySelector('#close-create-ws').addEventListener('click', closeModal);
      modal.querySelector('#cancel-create-ws').addEventListener('click', closeModal);

      modal.querySelector('#submit-create-ws').addEventListener('click', async () => {
        const name = modal.querySelector('#ws-input-name').value.trim();
        const kind = modal.querySelector('#ws-input-kind').value;
        const semester = modal.querySelector('#ws-input-semester').value;
        const academicYear = modal.querySelector('#ws-input-year').value.trim();

        if (!name) {
          alert('Please enter a workspace name');
          return;
        }

        try {
          const token = (typeof getToken === 'function' ? getToken() : null) || (window.sessionStorage ? (sessionStorage.getItem('eams_token') || sessionStorage.getItem('token')) : null);
          const res = await fetch('/api/timetable/workspaces', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { 'Authorization': 'Bearer ' + token } : {})
            },
            body: JSON.stringify({ name, kind, semester, academicYear, classIds: [] })
          });

          if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'Failed to create workspace');
          }

          const created = await res.json();
          closeModal();
          if (typeof showToast === 'function') showToast('Workspace created successfully', 'success');
          await this.fetchWorkspaces();
          this.render();
        } catch (err) {
          alert(err.message);
        }
      });
    }

    _escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  }

  window.WorkspaceHubView = WorkspaceHubView;
})(window);
