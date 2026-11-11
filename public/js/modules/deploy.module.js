/**
 * public/js/modules/deploy.module.js
 * EAMS Timetable v3 — Animated Deploy Progress Panel Modal (Stages 0–7)
 * Implements 8-stage progress tracker, live timers, retry handling, and status reports.
 */

(function (window) {
  'use strict';

  function getAuthToken() {
    try {
      if (typeof getToken === 'function') {
        const t = getToken();
        if (t) return t;
      }
    } catch (_) {}
    try {
      if (typeof sessionStorage !== 'undefined') {
        const t = sessionStorage.getItem('eams_token') || sessionStorage.getItem('token');
        if (t) return t;
      }
    } catch (_) {}
    try {
      if (typeof localStorage !== 'undefined') {
        const t = localStorage.getItem('eams_token') || localStorage.getItem('token');
        if (t) return t;
      }
    } catch (_) {}
    if (typeof TOKEN !== 'undefined' && TOKEN) return TOKEN;
    return '';
  }

  function getAuthHeaders(extra = {}) {
    const token = getAuthToken();
    const headers = Object.assign({}, extra);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  const STAGE_LABELS = [
    { key: 0, label: 'Stage 0: Pre-Flight Gate Validation' },
    { key: 1, label: 'Stage 1: Atomic Grid Commit' },
    { key: 2, label: 'Stage 2: Staff & Subject Assignments' },
    { key: 3, label: 'Stage 3: Combined Classes Synchronization' },
    { key: 4, label: 'Stage 4: Electronic Notice Boards Context Push' },
    { key: 5, label: 'Stage 5: Notification Fan-Out' },
    { key: 6, label: 'Stage 6: Teacher Schedule Cache Invalidation' },
    { key: 7, label: 'Stage 7: Pipeline Finalization & Audit Log' }
  ];

  class DeployProgressPanel {
    constructor() {
      this.modalEl = null;
      this.pollInterval = null;
      this.startTime = null;
      this.timerInterval = null;
    }

    /**
     * Show modal and begin tracking deploy progress
     * @param {string} runId
     * @param {Object} options { commitTrackId, className, onComplete }
     */
    show(runId, options = {}) {
      this.runId = runId;
      this.options = options;
      this.startTime = Date.now();

      this._renderModal();
      this._startTimer();
      this._pollProgress();
    }

    _renderModal() {
      if (document.getElementById('tt-deploy-modal')) {
        document.getElementById('tt-deploy-modal').remove();
      }

      const modal = document.createElement('div');
      modal.id = 'tt-deploy-modal';
      modal.className = 'tt-modal-overlay';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'tt-deploy-title');

      modal.innerHTML = `
        <div class="tt-modal-container" style="max-width: 620px; border-radius: var(--tt-radius-lg, 12px); overflow: hidden; background: #ffffff; box-shadow: 0 20px 40px rgba(0,0,0,0.2);">
          <div class="tt-modal-header" style="background: linear-gradient(135deg, var(--gD, #1b5e20) 0%, #2e7d32 100%); color: #ffffff; padding: 18px 24px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.85; font-weight: 700;">DEPLOYMENT PIPELINE</span>
                <h3 id="tt-deploy-title" style="margin: 4px 0 0 0; font-size: 18px; font-weight: 600;">
                  Publishing ${this.options.commitTrackId || 'Timetable'} · ${this.options.className || 'Academic'}
                </h3>
              </div>
              <div id="tt-deploy-timer" style="background: rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 20px; font-size: 12px; font-family: monospace; font-weight: 600;">
                Elapsed: 0.0s
              </div>
            </div>
          </div>

          <div class="tt-modal-body" style="padding: 24px; max-height: 480px; overflow-y: auto;">
            <ul id="tt-stage-list" style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px;">
              ${STAGE_LABELS.map(s => `
                <li id="tt-stage-${s.key}" class="tt-stage-item" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0; transition: all 0.25s ease;">
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <div class="tt-stage-badge" style="width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; background: #cbd5e1; color: #475569;">
                      ${s.key}
                    </div>
                    <div>
                      <span class="tt-stage-name" style="font-size: 13px; font-weight: 600; color: #1e293b;">${s.label}</span>
                      <div class="tt-stage-detail" style="font-size: 11px; color: #64748b; margin-top: 2px;">Waiting in queue...</div>
                    </div>
                  </div>
                  <div class="tt-stage-action"></div>
                </li>
              `).join('')}
            </ul>
          </div>

          <div class="tt-modal-footer" style="padding: 14px 24px; background: #f1f5f9; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 10px;">
            <button id="tt-deploy-close-btn" class="tt-btn" style="display: none; padding: 8px 18px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff;">Close</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      this.modalEl = modal;

      document.getElementById('tt-deploy-close-btn').addEventListener('click', () => {
        this.close();
      });
    }

    _startTimer() {
      const timerEl = document.getElementById('tt-deploy-timer');
      this.timerInterval = setInterval(() => {
        if (!timerEl || !this.startTime) return;
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        timerEl.textContent = `Elapsed: ${elapsed}s`;
      }, 100);
    }

    async _pollProgress() {
      if (!this.runId) return;

      try {
        const res = await fetch(`/api/timetable/deploys/${this.runId}`, {
          headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('Failed to fetch deploy status');
        const data = await res.json();
        const run = data.deployRun || data.data || data;

        this._updateUI(run);

        if (run.status === 'success' || run.status === 'success_with_warnings' || run.status === 'failed') {
          this._finalize(run);
        } else {
          this.pollInterval = setTimeout(() => this._pollProgress(), 800);
        }
      } catch (err) {
        console.warn('[DeployProgressPanel] Poll error:', err.message);
        this.pollInterval = setTimeout(() => this._pollProgress(), 1500);
      }
    }

    _updateUI(run) {
      if (!run || !Array.isArray(run.stages)) return;

      run.stages.forEach(stage => {
        const itemEl = document.getElementById(`tt-stage-${stage.key}`);
        if (!itemEl) return;

        const badge = itemEl.querySelector('.tt-stage-badge');
        const detail = itemEl.querySelector('.tt-stage-detail');
        const action = itemEl.querySelector('.tt-stage-action');

        if (stage.status === 'success') {
          itemEl.style.borderColor = 'var(--gB, #4caf50)';
          itemEl.style.background = 'var(--gLt, #e8f5e9)';
          badge.style.background = 'var(--gB, #4caf50)';
          badge.style.color = '#ffffff';
          badge.innerHTML = '✓';
          detail.textContent = 'Completed successfully';
          detail.style.color = 'var(--gD, #1b5e20)';
          action.innerHTML = '';
        } else if (stage.status === 'running') {
          itemEl.style.borderColor = 'var(--gD, #1b5e20)';
          itemEl.style.background = '#ffffff';
          badge.style.background = 'var(--gD, #1b5e20)';
          badge.style.color = '#ffffff';
          badge.innerHTML = '<span class="tt-spin">⟳</span>';
          detail.textContent = 'Executing stage operations...';
          detail.style.color = 'var(--gD, #1b5e20)';
          action.innerHTML = '';
        } else if (stage.status === 'warning') {
          itemEl.style.borderColor = '#f59e0b';
          itemEl.style.background = '#fffbeb';
          badge.style.background = '#f59e0b';
          badge.style.color = '#ffffff';
          badge.innerHTML = '!';
          detail.textContent = stage.error || 'Completed with non-blocking warning';
          detail.style.color = '#b45309';

          if (stage.retryable) {
            action.innerHTML = `<button class="tt-btn-retry" style="padding: 4px 10px; font-size: 11px; font-weight: 600; border-radius: 4px; border: 1px solid #d97706; background: #ffffff; color: #b45309; cursor: pointer;">Retry Step</button>`;
            action.querySelector('.tt-btn-retry').onclick = () => this._retryStage(stage.key);
          }
        } else if (stage.status === 'failed') {
          itemEl.style.borderColor = 'var(--danger, #dc2626)';
          itemEl.style.background = '#fef2f2';
          badge.style.background = 'var(--danger, #dc2626)';
          badge.style.color = '#ffffff';
          badge.innerHTML = '✕';
          detail.textContent = stage.error || 'Failed';
          detail.style.color = 'var(--danger-tx, #b91c1c)';

          if (stage.retryable) {
            action.innerHTML = `<button class="tt-btn-retry" style="padding: 4px 10px; font-size: 11px; font-weight: 600; border-radius: 4px; border: 1px solid #dc2626; background: #ffffff; color: #dc2626; cursor: pointer;">Retry Step</button>`;
            action.querySelector('.tt-btn-retry').onclick = () => this._retryStage(stage.key);
          }
        }
      });
    }

    async _retryStage(stageKey) {
      try {
        const res = await fetch(`/api/timetable/deploys/${this.runId}/retry`, {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ stage: stageKey })
        });
        if (!res.ok) throw new Error('Retry request failed');
        this._pollProgress();
      } catch (err) {
        alert(`Failed to retry stage ${stageKey}: ${err.message}`);
      }
    }

    _finalize(run) {
      if (this.timerInterval) clearInterval(this.timerInterval);
      const closeBtn = document.getElementById('tt-deploy-close-btn');
      if (closeBtn) closeBtn.style.display = 'inline-block';

      if (typeof this.options.onComplete === 'function') {
        this.options.onComplete(run);
      }
    }

    close() {
      if (this.timerInterval) clearInterval(this.timerInterval);
      if (this.pollInterval) clearTimeout(this.pollInterval);
      if (this.modalEl) this.modalEl.remove();
      this.modalEl = null;
    }
  }

  window.DeployProgressPanel = DeployProgressPanel;
})(window);
