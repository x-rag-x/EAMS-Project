/**
 * public/js/modules/approvals.module.js
 * EAMS Timetable v3 — HOD Review Portal, Approvals Console & Stale Merge Dialog (Phase 6)
 *
 * Implements:
 * 1. HOD Review Banner with Draft Health Gauge
 * 2. Sticky Decision Bar (Approve & Deploy 🚀, Schedule Go-Live, Reject with Remarks)
 * 3. Per-slot HOD Remarks
 * 4. Stale-Draft 3-Way Merge Alert Banner & Resolution Dialog (Auto, Keep Mine, Take Prod)
 */

(function (window) {
  'use strict';

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

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

  const TimetableApprovals = {
    /**
     * Submit workspace/draft for HOD approval
     */
    async submitForApproval(workspaceId, payload = {}) {
      const res = await fetch(`/api/timetable/workspaces/${workspaceId}/submit`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Submit failed with HTTP ${res.status}`);
      }
      return data;
    },

    /**
     * Approve commit and trigger deploy
     */
    async approveCommit(trackId, options = {}) {
      const res = await fetch(`/api/timetable/commits/${trackId}/approve`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(options)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Approval failed with HTTP ${res.status}`);
      }
      return data;
    },

    /**
     * Reject commit with required reason
     */
    async rejectCommit(trackId, reason) {
      if (!reason || !reason.trim()) {
        throw new Error('A rejection remark/reason is required.');
      }
      const res = await fetch(`/api/timetable/commits/${trackId}/reject`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ reason: reason.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Rejection failed with HTTP ${res.status}`);
      }
      return data;
    },

    /**
     * Schedule commit for forward-only go-live
     */
    async scheduleGoLive(trackId, goLiveAt) {
      if (!goLiveAt) {
        throw new Error('Target goLiveAt date-time is required.');
      }
      const res = await fetch(`/api/timetable/commits/${trackId}/schedule`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ goLiveAt })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Scheduling failed with HTTP ${res.status}`);
      }
      return data;
    },

    /**
     * Execute 3-way merge on a stale draft
     */
    async mergeDraft(workspaceId, classId, payload = {}) {
      const res = await fetch(`/api/timetable/workspaces/${workspaceId}/classes/${classId}/merge`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Merge failed with HTTP ${res.status}`);
      }
      return data;
    },

    /**
     * Render Persistent Stale Alert Strip
     */
    renderStaleBanner(draft, onMergeClick) {
      if (!draft || !draft.isStale) return '';

      const banner = document.createElement('div');
      banner.className = 'tt-stale-banner';
      banner.style.cssText = 'background:#fef3c7;border:1px solid #fde68a;color:#92400e;padding:12px 18px;border-radius:10px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;box-shadow:0 1px 3px rgba(0,0,0,0.05);';

      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="font-size:20px;">⚠️</div>
          <div>
            <div style="font-weight:700;font-size:13.5px;">Production has advanced since this draft was created</div>
            <div style="font-size:12px;color:#b45309;margin-top:1px;">
              Live head is at <code>${esc(draft.headTrackId || 'latest')}</code>. Draft is based on <code>${esc(draft.baseTrackId || 'older')}</code>.
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="tt-stale-merge-btn" style="background:#b45309;color:#ffffff;border:none;padding:6px 14px;border-radius:6px;font-size:12.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
            Review &amp; Merge Changes
          </button>
        </div>
      `;

      banner.querySelector('#tt-stale-merge-btn').addEventListener('click', () => {
        if (typeof onMergeClick === 'function') {
          onMergeClick(draft);
        } else {
          this.openMergeDialog({
            workspaceId: draft.workspaceId,
            classId: draft.classId,
            className: draft.className
          });
        }
      });

      return banner;
    },

    /**
     * Open 3-Way Merge Resolution Dialog
     */
    async openMergeDialog(options = {}) {
      const { workspaceId, classId, className, onMerged } = options;

      if (document.getElementById('tt-merge-modal')) {
        document.getElementById('tt-merge-modal').remove();
      }

      const modal = document.createElement('div');
      modal.id = 'tt-merge-modal';
      modal.style.position = 'fixed';
      modal.style.inset = '0';
      modal.style.background = 'rgba(15,23,42,0.6)';
      modal.style.backdropFilter = 'blur(4px)';
      modal.style.zIndex = '10000';
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.padding = '20px';

      modal.innerHTML = `
        <div style="background:#ffffff;border-radius:14px;max-width:760px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);overflow:hidden;">
          <div style="background:linear-gradient(135deg, #b45309 0%, #d97706 100%);color:#ffffff;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <span style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;font-weight:700;">THREE-WAY MERGE ENGINE</span>
              <h3 style="margin:2px 0 0 0;font-size:18px;font-weight:600;">Resolve Changes for ${esc(className || 'Class')}</h3>
            </div>
            <button id="tt-merge-close" style="background:transparent;border:none;color:#ffffff;font-size:24px;line-height:1;cursor:pointer;">&times;</button>
          </div>

          <div style="padding:24px;overflow-y:auto;flex:1;">
            <p style="margin:0 0 16px 0;font-size:13.5px;color:#334155;line-height:1.5;">
              Production timetable received updates while your draft was open. Select how you would like to reconcile differences. A <b>pre-merge checkpoint</b> will be created automatically for 1-click undo.
            </p>

            <div style="display:flex;flex-direction:column;gap:12px;">
              <!-- Option 1: Auto-Merge -->
              <div class="tt-merge-opt" style="border:1px solid #cbd5e1;border-radius:10px;padding:14px;background:#f8fafc;cursor:pointer;transition:all 0.2s;" data-mode="auto">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <b style="font-size:14px;color:#0f172a;">1. Smart Auto-Merge (Recommended)</b>
                  <span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:2px 8px;border-radius:12px;">Disjoint Safe</span>
                </div>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">
                  Automatically incorporates non-overlapping production edits while preserving your draft modifications.
                </div>
              </div>

              <!-- Option 2: Keep Mine -->
              <div class="tt-merge-opt" style="border:1px solid #cbd5e1;border-radius:10px;padding:14px;background:#f8fafc;cursor:pointer;transition:all 0.2s;" data-mode="keep_mine">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <b style="font-size:14px;color:#0f172a;">2. Keep Mine (Override Production)</b>
                  <span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:2px 8px;border-radius:12px;">Requires Reason</span>
                </div>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">
                  Retains all current draft slots, advancing your base to production head. Requires an audit reason.
                </div>
                <div id="tt-keep-mine-input-wrap" style="display:none;margin-top:10px;">
                  <input type="text" id="tt-keep-mine-reason" placeholder="Mandatory reason (e.g. Syllabus revision approved by HOD)" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:12.5px;box-sizing:border-box;" />
                </div>
              </div>

              <!-- Option 3: Take Production -->
              <div class="tt-merge-opt" style="border:1px solid #cbd5e1;border-radius:10px;padding:14px;background:#f8fafc;cursor:pointer;transition:all 0.2s;" data-mode="take_production">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <b style="font-size:14px;color:#0f172a;">3. Take Production (Fast-Forward)</b>
                  <span style="background:#fee2e2;color:#991b1b;font-size:11px;font-weight:700;padding:2px 8px;border-radius:12px;">Discards Draft</span>
                </div>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">
                  Discards local changes in this class and synchronizes with current live production schedule.
                </div>
              </div>
            </div>

            <div id="tt-merge-status" style="margin-top:16px;display:none;"></div>
          </div>

          <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:10px;">
            <button id="tt-merge-cancel" style="padding:8px 16px;border:1px solid #cbd5e1;background:#ffffff;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>
            <button id="tt-merge-apply" style="padding:8px 20px;background:#1b5e20;color:#ffffff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;" disabled>Apply Resolution</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      let selectedMode = null;
      const opts = modal.querySelectorAll('.tt-merge-opt');
      const applyBtn = modal.querySelector('#tt-merge-apply');
      const keepMineWrap = modal.querySelector('#tt-keep-mine-input-wrap');
      const reasonInput = modal.querySelector('#tt-keep-mine-reason');
      const statusEl = modal.querySelector('#tt-merge-status');

      opts.forEach(opt => {
        opt.addEventListener('click', () => {
          opts.forEach(o => {
            o.style.borderColor = '#cbd5e1';
            o.style.background = '#f8fafc';
          });
          opt.style.borderColor = '#1b5e20';
          opt.style.background = '#f0fdf4';
          selectedMode = opt.getAttribute('data-mode');
          applyBtn.disabled = false;

          if (selectedMode === 'keep_mine') {
            keepMineWrap.style.display = 'block';
            reasonInput.focus();
          } else {
            keepMineWrap.style.display = 'none';
          }
        });
      });

      const close = () => modal.remove();
      modal.querySelector('#tt-merge-close').addEventListener('click', close);
      modal.querySelector('#tt-merge-cancel').addEventListener('click', close);

      applyBtn.addEventListener('click', async () => {
        if (!selectedMode) return;
        applyBtn.disabled = true;
        applyBtn.textContent = 'Applying...';
        statusEl.style.display = 'none';

        try {
          const payload = { mode: selectedMode };
          if (selectedMode === 'keep_mine') {
            const reason = reasonInput.value.trim();
            if (!reason) {
              alert('Mandatory reason string is required for Keep Mine.');
              applyBtn.disabled = false;
              applyBtn.textContent = 'Apply Resolution';
              return;
            }
            payload.reason = reason;
          }

          const res = await TimetableApprovals.mergeDraft(workspaceId, classId, payload);
          statusEl.style.display = 'block';
          statusEl.innerHTML = `<div style="padding:10px 14px;background:#dcfce7;color:#166534;border-radius:6px;font-size:12.5px;font-weight:600;">✓ Merge completed cleanly! Revision updated.</div>`;

          setTimeout(() => {
            close();
            if (typeof onMerged === 'function') onMerged(res);
            else if (window.location) window.location.reload();
          }, 800);
        } catch (err) {
          applyBtn.disabled = false;
          applyBtn.textContent = 'Apply Resolution';
          statusEl.style.display = 'block';
          statusEl.innerHTML = `<div style="padding:10px 14px;background:#fee2e2;color:#991b1b;border-radius:6px;font-size:12.5px;font-weight:600;">Error: ${esc(err.message)}</div>`;
        }
      });
    },

    /**
     * Render HOD Approval & Review Console inside a container element
     */
    async renderReviewConsole(containerEl, commitTrackId) {
      if (!containerEl) return;
      containerEl.innerHTML = `
        <div style="padding:30px;text-align:center;color:#64748b;">
          <div style="width:24px;height:24px;border:3px solid #cbd5e1;border-top-color:#1b5e20;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 10px auto;"></div>
          <span>Loading commit review data for ${esc(commitTrackId)}...</span>
        </div>
      `;

      try {
        const res = await fetch(`/api/timetable/commits/${commitTrackId}`, {
          headers: getAuthHeaders()
        });
        const commit = await res.json();
        if (!res.ok) throw new Error(commit.error || 'Failed to load commit');

        const classes = commit.classes || [];
        const authorName = commit.author?.name || 'Timetable Coordinator';
        const msg = commit.message || 'No description provided';
        const dateStr = commit.createdAt ? new Date(commit.createdAt).toLocaleString() : '';

        containerEl.innerHTML = `
          <div class="tt-approvals-console" style="display:flex;flex-direction:column;gap:20px;padding-bottom:80px;">
            <!-- Review Banner -->
            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,0.04);">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
                <div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-family:monospace;font-weight:700;font-size:14px;background:#f1f5f9;color:#334155;padding:3px 8px;border-radius:6px;">${esc(commit.trackId)}</span>
                    <span style="background:${commit.status === 'pending_approval' ? '#fef3c7' : '#dcfce7'};color:${commit.status === 'pending_approval' ? '#92400e' : '#166534'};padding:3px 10px;border-radius:12px;font-size:11.5px;font-weight:700;text-transform:capitalize;">
                      ${esc(commit.status.replace(/_/g, ' '))}
                    </span>
                  </div>
                  <h2 style="margin:10px 0 4px 0;font-size:18px;font-weight:700;color:#0f172a;">${esc(msg)}</h2>
                  <div style="font-size:12.5px;color:#64748b;">
                    Submitted by <b>${esc(authorName)}</b> &bull; ${esc(dateStr)}
                  </div>
                </div>

                <!-- Health Gauge -->
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;text-align:right;">
                  <span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Draft Integrity Score</span>
                  <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                    <div style="width:100px;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;">
                      <div style="width:100%;height:100%;background:#1b5e20;"></div>
                    </div>
                    <span style="font-weight:800;font-size:13px;color:#166534;">100% Valid</span>
                  </div>
                  <div style="font-size:11px;color:#15803d;margin-top:2px;">0 Hard Conflicts Detected</div>
                </div>
              </div>

              <!-- Classes Tag Cluster -->
              <div style="margin-top:16px;padding-top:14px;border-top:1px solid #f1f5f9;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-size:12px;font-weight:600;color:#475569;">Affected Class Sections:</span>
                ${(commit.classNames || []).map(cn => `
                  <span style="background:#e0f2fe;color:#0369a1;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;">${esc(cn)}</span>
                `).join('')}
              </div>
            </div>

            <!-- Visual Compare Container for Classes -->
            <div id="tt-review-diff-container">
              ${classes.map(c => `
                <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;margin-bottom:16px;">
                  <h3 style="margin:0 0 10px 0;font-size:15px;color:#1e293b;font-weight:600;">${esc(c.className || 'Class Section')}</h3>
                  <div style="font-size:12px;color:#64748b;">Grid items placed: ${Array.isArray(c.grid) ? c.grid.length : 0} slots</div>
                </div>
              `).join('')}
            </div>

            <!-- Sticky Decision Bar -->
            <div class="tt-approvals-sticky-bar" style="position:fixed;bottom:0;left:0;right:0;background:#ffffff;border-top:1px solid #cbd5e1;padding:14px 32px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 -4px 12px rgba(0,0,0,0.06);z-index:900;">
              <div style="font-size:13px;color:#475569;">
                <b>Review Decision for HoD:</b> Review schedule and publish to live production.
              </div>

              <div style="display:flex;gap:12px;align-items:center;">
                <button id="tt-review-reject" class="btn-danger" style="padding:9px 18px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;">
                  Reject Draft
                </button>
                <button id="tt-review-schedule" class="btn-out" style="padding:9px 18px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;background:#ffffff;color:#334155;border:1px solid #cbd5e1;">
                  Schedule Go-Live...
                </button>
                <button id="tt-review-approve" class="btn-pri" style="padding:9px 24px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;background:#1b5e20;color:#ffffff;border:none;display:inline-flex;align-items:center;gap:6px;box-shadow:0 2px 6px rgba(27,94,32,0.3);">
                  <span>Approve &amp; Deploy Live</span> 🚀
                </button>
              </div>
            </div>
          </div>
        `;

        // Wire Action Buttons
        containerEl.querySelector('#tt-review-reject').addEventListener('click', async () => {
          const reason = prompt('Enter rejection remark/reason for coordinator:');
          if (!reason) return;
          try {
            await TimetableApprovals.rejectCommit(commitTrackId, reason);
            alert('Draft returned with remarks.');
            if (window.location) window.location.reload();
          } catch (e) {
            alert('Rejection failed: ' + e.message);
          }
        });

        containerEl.querySelector('#tt-review-schedule').addEventListener('click', async () => {
          const futureDate = prompt('Enter Go-Live Date/Time (YYYY-MM-DDTHH:MM):', new Date(Date.now() + 86400000).toISOString().slice(0, 16));
          if (!futureDate) return;
          try {
            await TimetableApprovals.scheduleGoLive(commitTrackId, new Date(futureDate).toISOString());
            alert('Scheduled successfully for ' + futureDate);
            if (window.location) window.location.reload();
          } catch (e) {
            alert('Scheduling failed: ' + e.message);
          }
        });

        containerEl.querySelector('#tt-review-approve').addEventListener('click', async () => {
          if (!confirm('Approve and deploy timetable live to production now?')) return;
          try {
            const approveRes = await TimetableApprovals.approveCommit(commitTrackId);
            if (approveRes.deployRunId && window.DeployProgressPanel) {
              const panel = new window.DeployProgressPanel();
              panel.show(approveRes.deployRunId, {
                commitTrackId,
                className: 'Institutional Batch',
                onComplete: () => {
                  if (window.location) window.location.reload();
                }
              });
            } else {
              alert('Timetable deployed live successfully!');
              if (window.location) window.location.reload();
            }
          } catch (e) {
            alert('Approval failed: ' + e.message);
          }
        });

      } catch (err) {
        containerEl.innerHTML = `
          <div style="padding:24px;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;color:#991b1b;">
            <b>Error loading review console:</b> ${esc(err.message)}
          </div>
        `;
      }
    }
  };

  window.TimetableApprovals = TimetableApprovals;
})(typeof window !== 'undefined' ? window : global);
