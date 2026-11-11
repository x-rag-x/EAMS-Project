/**
 * public/js/modules/history.module.js
 * EAMS Timetable v3 — Universal History View (Development Versions & Production Commits)
 * Follows the Single Lens:
 * - Development Lens: 15-Minute IST Time Bucket Versions, Author Badges, Stats & Time-Travel Restore.
 * - Production Lens: Immutable Commits (TR-TT-xxxx), Author Badges, Timestamps & Diff Inspector.
 */

(function (window) {
  'use strict';

  class TimetableHistoryView {
    constructor(containerEl) {
      this.containerEl = typeof containerEl === 'string' ? document.querySelector(containerEl) : containerEl;
      this.lens = 'production';
      this.items = [];
      this.workspaceId = null;
      this.draftId = null;
    }

    /**
     * Load history based on active lens and scope
     */
    async load(options = {}) {
      if (!this.containerEl) return;
      this.lens = options.lens || (window.state && window.state.env) || 'production';
      this.workspaceId = options.workspaceId || (window.state && window.state.activeWorkspaceId) || null;
      this.draftId = options.draftId || null;
      this.isEmbedded = Boolean(options.embedded || (this.containerEl.id === 'tt-history-module-container'));
      const deptId = options.deptId || (window.state && window.state.deptId) || '';

      if (!this.isEmbedded) {
        this.containerEl.innerHTML = `<div style="text-align: center; padding: 40px; color: #64748b;">Loading ${this.lens} history...</div>`;
      }

      try {
        if (this.lens === 'development' && this.workspaceId) {
          await this._loadDevelopmentVersions();
        } else {
          await this._loadProductionCommits(deptId);
        }
        this.render();
      } catch (err) {
        if (!this.isEmbedded) {
          this.containerEl.innerHTML = `<div style="padding: 24px; color: #b91c1c; background: #fef2f2; border-radius: 8px;">Error loading history: ${err.message}</div>`;
        } else {
          this.containerEl.style.display = 'none';
          this.containerEl.innerHTML = '';
        }
      }
    }

    async _loadProductionCommits(deptId = '') {
      const url = `/api/timetable/commits${deptId ? `?deptId=${encodeURIComponent(deptId)}` : ''}`;
      const token = (typeof getToken === 'function' ? getToken() : null) || (window.sessionStorage ? (sessionStorage.getItem('eams_token') || sessionStorage.getItem('token')) : null);
      const res = await fetch(url, {
        headers: token ? { 'Authorization': 'Bearer ' + token } : {}
      });
      if (!res.ok) throw new Error('Failed to load production commits');
      const data = await res.json();
      this.items = data.data || data.commits || [];
    }

    async _loadDevelopmentVersions() {
      const url = `/api/timetable/workspaces/${this.workspaceId}/versions`;
      const token = (typeof getToken === 'function' ? getToken() : null) || (window.sessionStorage ? (sessionStorage.getItem('eams_token') || sessionStorage.getItem('token')) : null);
      const res = await fetch(url, {
        headers: token ? { 'Authorization': 'Bearer ' + token } : {}
      });
      if (!res.ok) throw new Error('Failed to load draft versions');
      const data = await res.json();
      this.items = data.versions || [];
    }

    render() {
      if (!this.containerEl) return;

      if (!this.items.length) {
        if (this.isEmbedded || (this.containerEl.id === 'tt-history-module-container')) {
          this.containerEl.style.display = 'none';
          this.containerEl.innerHTML = '';
          return;
        }

        const title = this.lens === 'development' ? 'No Development Versions Found' : 'No Production Commits Found';
        const sub = this.lens === 'development'
          ? 'Edits in this workspace will automatically group into 15-minute versions.'
          : 'Published timetables will appear here with traceable commits and grid diffs.';

        this.containerEl.style.display = '';
        this.containerEl.innerHTML = `
          <div style="text-align: center; padding: 60px 20px; color: #64748b;">
            <div style="font-size: 32px; margin-bottom: 12px;">📜</div>
            <div style="font-size: 16px; font-weight: 600; color: #334155;">${title}</div>
            <div style="font-size: 13px; margin-top: 4px;">${sub}</div>
          </div>
        `;
        return;
      }

      this.containerEl.style.display = '';
      if (this.lens === 'development') {
        this._renderDevelopmentVersions();
      } else {
        this._renderProductionCommits();
      }
    }

    _renderDevelopmentVersions() {
      this.containerEl.innerHTML = `
        <div class="tt-version-feed" style="display: flex; flex-direction: column; gap: 16px;">
          ${this.items.map(version => this._renderVersionCard(version)).join('')}
        </div>
      `;

      // Bind restore actions
      this.containerEl.querySelectorAll('.btn-restore-version').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const versionId = btn.dataset.versionId;
          await this._restoreVersion(versionId);
        });
      });
    }

    _renderVersionCard(version) {
      const dateStr = version.startedAt ? new Date(version.startedAt).toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }) : '—';

      const stats = version.stats || {};
      const added = stats.added || 0;
      const changed = stats.changed || 0;
      const removed = stats.removed || 0;
      const authorNames = (version.authors || []).map(a => a.name).filter(Boolean).join(', ') || 'Coordinator';

      return `
        <div class="tt-version-card" data-version-id="${version._id}" style="border: 1px solid #e2e8f0; border-left: 5px solid #d97706; border-radius: 8px; background: #ffffff; padding: 16px 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap;">
            <div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 14px; font-weight: 700; color: #92400e; background: #fef3c7; padding: 3px 8px; border-radius: 4px; border: 1px solid #fde68a;">
                  ${version.label || `${dateStr} version`}
                </span>
                ${version.pinned ? '<span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #fef08a; color: #854d0e; font-weight: 700;">📌 PINNED</span>' : ''}
                <span style="font-size: 12px; color: #64748b;">${version.opCount || 1} operation(s)</span>
              </div>
              <div style="font-size: 12.5px; color: #475569; margin-top: 8px;">
                <span>Author(s): <strong>${authorNames}</strong></span>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
              <div style="display: flex; gap: 6px; font-size: 11px; font-weight: 600;">
                <span style="color: #16a34a; background: #dcfce7; padding: 2px 6px; border-radius: 4px;">+${added}</span>
                <span style="color: #d97706; background: #fef3c7; padding: 2px 6px; border-radius: 4px;">~${changed}</span>
                <span style="color: #dc2626; background: #fee2e2; padding: 2px 6px; border-radius: 4px;">-${removed}</span>
              </div>
              <button class="btn-pri btn-restore-version" data-version-id="${version._id}" style="padding: 5px 12px; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer;">
                Restore Draft to This Version
              </button>
            </div>
          </div>
        </div>
      `;
    }

    async _restoreVersion(versionId) {
      if (!confirm('Restore entire draft to this version? All slots will be aligned to this snapshot (history will be preserved).')) return;
      try {
        const token = (typeof getToken === 'function' ? getToken() : null) || (window.sessionStorage ? (sessionStorage.getItem('eams_token') || sessionStorage.getItem('token')) : null);
        const res = await fetch(`/api/timetable/workspaces/${this.workspaceId}/versions/${versionId}/restore`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': 'Bearer ' + token } : {})
          },
          body: JSON.stringify({ scope: 'draft' })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Restore failed');
        }

        if (typeof showToast === 'function') showToast('Draft restored successfully', 'success');
        if (typeof render === 'function') render();
        await this.load({ lens: 'development', workspaceId: this.workspaceId });
      } catch (err) {
        if (typeof showToast === 'function') showToast(err.message, 'error');
        else alert(err.message);
      }
    }

    _renderProductionCommits() {
      this.containerEl.innerHTML = `
        <div class="tt-history-feed" style="display: flex; flex-direction: column; gap: 16px;">
          ${this.items.map(commit => this._renderCommitCard(commit)).join('')}
        </div>
      `;

      // Bind diff toggle
      this.containerEl.querySelectorAll('.tt-commit-card').forEach(card => {
        const toggleBtn = card.querySelector('.tt-diff-toggle-btn');
        const diffPanel = card.querySelector('.tt-commit-diff-panel');
        if (toggleBtn && diffPanel) {
          toggleBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const isExpanded = diffPanel.style.display !== 'none';
            if (isExpanded) {
              diffPanel.style.display = 'none';
              toggleBtn.textContent = 'View Diff Inspector';
            } else {
              diffPanel.style.display = 'block';
              toggleBtn.textContent = 'Hide Diff Inspector';
              if (!diffPanel.dataset.loaded) {
                await this._loadCommitDetails(card.dataset.trackId, diffPanel);
              }
            }
          });
        }
      });
    }

    _renderCommitCard(commit) {
      const dateStr = commit.createdAt ? new Date(commit.createdAt).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }) : '—';

      const diff = commit.diffSummary || {};
      const added = diff.totalAdded || 0;
      const modified = diff.totalModified || 0;
      const removed = diff.totalRemoved || 0;

      return `
        <div class="tt-commit-card" data-track-id="${commit.trackId}" style="border: 1px solid #e2e8f0; border-left: 5px solid var(--gD, #1b5e20); border-radius: 8px; background: #ffffff; padding: 16px 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap;">
            <div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <span class="tt-track-chip" style="font-family: monospace; font-weight: 700; font-size: 13px; color: var(--gD, #1b5e20); background: var(--gLt, #e8f5e9); padding: 3px 8px; border-radius: 4px; border: 1px solid #c8e6c9;">
                  ${commit.trackId}
                </span>
                <span style="font-size: 12px; color: #64748b;">${dateStr}</span>
                <span style="font-size: 11px; font-weight: 600; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: #f1f5f9; color: #475569;">
                  ${commit.status || 'deployed'}
                </span>
              </div>
              <h4 style="margin: 8px 0 4px 0; font-size: 15px; font-weight: 600; color: #0f172a;">
                ${commit.message || 'Timetable production commit'}
              </h4>
              <div style="font-size: 12px; color: #475569; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px;">
                <span>Author: <strong>${commit.author?.name || 'TTC'}</strong></span>
                ${commit.approver?.name ? `<span>• Approved by: <strong>${commit.approver.name}</strong></span>` : ''}
                ${Array.isArray(commit.classNames) && commit.classNames.length ? `<span>• Classes: ${commit.classNames.join(', ')}</span>` : ''}
              </div>
            </div>

            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
              <div style="display: flex; gap: 6px; font-size: 11px; font-weight: 600;">
                <span style="color: #16a34a; background: #dcfce7; padding: 2px 6px; border-radius: 4px;">+${added}</span>
                <span style="color: #d97706; background: #fef3c7; padding: 2px 6px; border-radius: 4px;">~${modified}</span>
                <span style="color: #dc2626; background: #fee2e2; padding: 2px 6px; border-radius: 4px;">-${removed}</span>
              </div>
              <button class="tt-diff-toggle-btn" style="background: none; border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px 10px; font-size: 12px; font-weight: 600; color: #334155; cursor: pointer;">
                View Diff Inspector
              </button>
            </div>
          </div>

          <div class="tt-commit-diff-panel" style="display: none; margin-top: 16px; padding-top: 16px; border-top: 1px solid #f1f5f9;">
            <div style="font-size: 12px; color: #64748b;">Loading commit grid comparison...</div>
          </div>
        </div>
      `;
    }

    async _loadCommitDetails(trackId, diffPanelEl) {
      try {
        const res = await fetch(`/api/timetable/commits/${encodeURIComponent(trackId)}`);
        if (!res.ok) throw new Error('Failed to load commit details');
        const data = await res.json();
        const classes = data.classes || [];

        if (!classes.length) {
          diffPanelEl.innerHTML = `<div style="font-size: 12px; color: #64748b;">No per-class snapshot details recorded for this commit.</div>`;
          diffPanelEl.dataset.loaded = 'true';
          return;
        }

        diffPanelEl.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${classes.map(cls => `
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px;">
                <div style="font-weight: 600; font-size: 13px; color: #1e293b; margin-bottom: 8px;">
                  Class: ${cls.className || cls.classId} (v${cls.version || 1})
                </div>
                <div style="font-size: 12px; display: flex; gap: 10px; color: #475569;">
                  <span>Added: <strong style="color: #16a34a;">${cls.diff?.added || 0}</strong></span>
                  <span>Modified: <strong style="color: #d97706;">${cls.diff?.modified || 0}</strong></span>
                  <span>Removed: <strong style="color: #dc2626;">${cls.diff?.removed || 0}</strong></span>
                  <span>Unchanged: <strong>${cls.diff?.unchanged || 0}</strong></span>
                </div>
              </div>
            `).join('')}
          </div>
        `;
        diffPanelEl.dataset.loaded = 'true';
      } catch (err) {
        diffPanelEl.innerHTML = `<div style="font-size: 12px; color: #dc2626;">Failed to load diff: ${err.message}</div>`;
      }
    }
  }

  window.TimetableHistoryView = TimetableHistoryView;
  window.ProductionHistoryView = TimetableHistoryView; // Backward compatibility alias
})(window);
