/**
 * public/js/pages/timetable/share.module.js
 *
 * Timetable Sharing Module (Timetable v3 - Phase 5):
 * - Three share levels: View, Fill, Edit (Section 7.1)
 * - Share workspace / class with supporting or programme departments (D7, D21, D22)
 * - Fillable slots and reserve-for-dept tiles (Section 7.2)
 * - Shared-with-me drawer & workspace launcher (Section 7.3)
 * - Staff Assignment panel: Live cross-workspace teacher matrix (Section 7.3)
 * - Active shares management: Change level and revoke actions (Section 7.2)
 * - Zero localStorage / non-auth sessionStorage usage
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

  async function apiCall(method, url, data = null) {
    const opts = {
      method,
      headers: {
        'Accept': 'application/json'
      }
    };
    if (data && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(data);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      let errText = 'API call failed';
      try {
        const json = await res.json();
        errText = json.error || json.message || errText;
      } catch (_) {
        errText = await res.text();
      }
      throw new Error(errText);
    }
    return res.json();
  }

  // ── Share Workspace Modal (Section 7.2) ──

  async function openShareModal(options = {}) {
    let ws = options.workspace;
    if (!ws && window.TimetableWorkspaceModule) {
      const state = window.TimetableWorkspaceModule.getState();
      ws = state.activeWorkspace;
    }

    if (!ws) {
      if (typeof showToast === 'function') showToast('No active workspace selected to share', 'warning');
      return;
    }

    document.getElementById('tt-share-workspace-modal')?.remove();

    // Fetch departments
    let depts = [];
    try {
      const dRes = await apiCall('GET', '/departments');
      if (Array.isArray(dRes)) depts = dRes;
      else if (dRes && Array.isArray(dRes.departments)) depts = dRes.departments;
    } catch (_) {
      try {
        const dRes2 = await apiCall('GET', '/api/departments');
        if (Array.isArray(dRes2)) depts = dRes2;
      } catch (_) {}
    }

    // Filter out owner department
    const ownerDeptId = String(ws.deptId || '');
    const availableDepts = depts.filter(d => String(d._id) !== ownerDeptId);

    // Sort: Supporting departments first
    availableDepts.sort((a, b) => {
      const aSup = a.category === 'supporting' ? 0 : 1;
      const bSup = b.category === 'supporting' ? 0 : 1;
      if (aSup !== bSup) return aSup - bSup;
      return (a.name || '').localeCompare(b.name || '');
    });

    const modal = document.createElement('div');
    modal.id = 'tt-share-workspace-modal';
    modal.className = 'modal-backdrop';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';

    const preselectedClassId = options.classId ? String(options.classId) : '';

    modal.innerHTML = `
      <div class="modal-card" style="background:var(--card,#ffffff);border-radius:12px;width:90%;max-width:540px;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);overflow:hidden;border:1px solid var(--border,#e2e8f0);">
        <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border,#e2e8f0);">
          <div>
            <h3 style="margin:0;font-size:16px;font-weight:700;color:var(--text-pri,#1e293b);">🔗 Share Workspace</h3>
            <p style="margin:2px 0 0 0;font-size:12px;color:var(--text-sec,#64748b);">${esc(ws.name)} (${esc(ws.trackId)})</p>
          </div>
          <button type="button" class="btn-icon" onclick="document.getElementById('tt-share-workspace-modal').remove()" style="background:transparent;border:none;cursor:pointer;font-size:18px;color:#64748b;">✕</button>
        </div>

        <form id="tt-share-workspace-form" style="padding:18px 20px;display:flex;flex-direction:column;gap:14px;">
          <!-- Target Department -->
          <div>
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-pri,#334155);">Target Department *</label>
            <select id="share-target-dept" required style="width:100%;padding:8px 10px;border:1px solid var(--border,#cbd5e1);border-radius:6px;font-size:13px;background:var(--bg,#fff);">
              <option value="">Select department to share with…</option>
              ${availableDepts.map(d => {
                const isSup = d.category === 'supporting';
                return `<option value="${esc(d._id)}">${esc(d.name)}${isSup ? ' ⭐ [Supporting Dept]' : ''}</option>`;
              }).join('')}
            </select>
            <div style="font-size:11px;color:#64748b;margin-top:4px;">Supporting departments (Maths, Physics, English, etc.) are highlighted first.</div>
          </div>

          <!-- Scope -->
          <div>
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-pri,#334155);">Share Scope</label>
            <div style="display:flex;gap:12px;font-size:13px;">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="radio" name="share-scope" value="all" ${!preselectedClassId ? 'checked' : ''} onchange="document.getElementById('share-class-select-box').style.display='none'">
                <span>Whole Workspace (All classes)</span>
              </label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="radio" name="share-scope" value="class" ${preselectedClassId ? 'checked' : ''} onchange="document.getElementById('share-class-select-box').style.display='block'">
                <span>Specific Class Only</span>
              </label>
            </div>
          </div>

          <!-- Class selector if specific -->
          <div id="share-class-select-box" style="display:${preselectedClassId ? 'block' : 'none'};">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-pri,#334155);">Choose Class</label>
            <select id="share-target-class" style="width:100%;padding:8px 10px;border:1px solid var(--border,#cbd5e1);border-radius:6px;font-size:13px;background:var(--bg,#fff);">
              ${(ws.classIds || []).map(cid => `
                <option value="${esc(cid)}" ${String(cid) === preselectedClassId ? 'selected' : ''}>Class: ${esc(cid)}</option>
              `).join('')}
            </select>
          </div>

          <!-- Access Level (View / Fill / Edit) -->
          <div>
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-pri,#334155);">Access Level *</label>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:12.5px;">
              <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;">
                <input type="radio" name="share-level" value="view" style="margin-top:2px;" onchange="document.getElementById('share-fill-options').style.display='none'">
                <div>
                  <div style="font-weight:600;color:#1e293b;">👁️ View Only</div>
                  <div style="font-size:11.5px;color:#64748b;">Read-only matrices, compare, and teacher workload views. No edits allowed.</div>
                </div>
              </label>
              <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:8px 10px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:6px;">
                <input type="radio" name="share-level" value="fill" checked style="margin-top:2px;" onchange="document.getElementById('share-fill-options').style.display='block'">
                <div>
                  <div style="font-weight:600;color:#166534;">✍️ Fill Only (Recommended for Supporting Depts)</div>
                  <div style="font-size:11.5px;color:#15803d;">Can allocate faculty and subjects into designated/reserved periods only. Cannot move or clear periods.</div>
                </div>
              </label>
              <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;">
                <input type="radio" name="share-level" value="edit" style="margin-top:2px;" onchange="document.getElementById('share-fill-options').style.display='none'">
                <div>
                  <div style="font-weight:600;color:#1e293b;">🛠️ Edit (Co-builder)</div>
                  <div style="font-size:11.5px;color:#64748b;">Full slot editing inside shared classes. Cannot add/remove classes or submit/deploy.</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Fill Permissions -->
          <div id="share-fill-options" style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
            <div style="font-size:11.5px;font-weight:600;color:#334155;margin-bottom:6px;">Permissions for Fill Level:</div>
            <div style="display:flex;gap:14px;font-size:12px;">
              <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
                <input type="checkbox" id="share-fill-staff" checked>
                <span>Assign Staff</span>
              </label>
              <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
                <input type="checkbox" id="share-fill-subject" checked>
                <span>Assign Subject</span>
              </label>
              <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
                <input type="checkbox" id="share-fill-room">
                <span>Assign Room</span>
              </label>
            </div>
          </div>

          <!-- Note -->
          <div>
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-pri,#334155);">Note / Instructions</label>
            <textarea id="share-note" rows="2" placeholder="e.g., Please assign faculty for Engineering Mathematics Year 1 slots." style="width:100%;padding:8px 10px;border:1px solid var(--border,#cbd5e1);border-radius:6px;font-size:12.5px;"></textarea>
          </div>

          <!-- Actions -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:12px;border-top:1px solid #e2e8f0;">
            <button type="button" class="btn-out" onclick="window.TimetableShareModule.openSharesListModal('${ws._id}')" style="font-size:12px;padding:6px 12px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;">
              Manage Active Shares
            </button>
            <div style="display:flex;gap:8px;">
              <button type="button" class="btn-out" onclick="document.getElementById('tt-share-workspace-modal').remove()" style="font-size:12px;padding:6px 14px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;">Cancel</button>
              <button type="submit" class="btn-pri" style="font-size:12px;padding:6px 16px;background:#15803d;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Share Now</button>
            </div>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('tt-share-workspace-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetDeptId = document.getElementById('share-target-dept').value;
      if (!targetDeptId) {
        alert('Please choose a department to share with.');
        return;
      }

      const scope = modal.querySelector('input[name="share-scope"]:checked')?.value || 'all';
      const classId = scope === 'class' ? document.getElementById('share-target-class')?.value : null;
      const level = modal.querySelector('input[name="share-level"]:checked')?.value || 'fill';
      const assignStaff = document.getElementById('share-fill-staff')?.checked !== false;
      const assignSubject = document.getElementById('share-fill-subject')?.checked !== false;
      const assignRoom = document.getElementById('share-fill-room')?.checked === true;
      const note = document.getElementById('share-note')?.value || '';

      try {
        const payload = {
          toDeptId: targetDeptId,
          classId: classId || null,
          level,
          fill: { assignStaff, assignSubject, assignRoom },
          note
        };

        const res = await apiCall('POST', `/timetable/workspaces/${ws._id}/shares`, payload);
        if (res && res.ok) {
          modal.remove();
          if (typeof showToast === 'function') {
            showToast(`Workspace successfully shared (${level.toUpperCase()})`, 'success');
          }
        }
      } catch (err) {
        console.error('[ShareModule] Error creating share:', err);
        alert(err.message || 'Failed to share workspace');
      }
    });
  }

  // ── Active Shares List & Level Management Modal (Section 7.2) ──

  async function openSharesListModal(workspaceId) {
    if (!workspaceId) return;
    document.getElementById('tt-active-shares-modal')?.remove();

    try {
      const res = await apiCall('GET', `/timetable/workspaces/${workspaceId}/shares`);
      const shares = (res && Array.isArray(res.shares)) ? res.shares : [];

      const modal = document.createElement('div');
      modal.id = 'tt-active-shares-modal';
      modal.className = 'modal-backdrop';
      modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';

      modal.innerHTML = `
        <div class="modal-card" style="background:var(--card,#ffffff);border-radius:12px;width:90%;max-width:620px;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);overflow:hidden;border:1px solid var(--border,#e2e8f0);max-height:85vh;display:flex;flex-direction:column;">
          <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border,#e2e8f0);">
            <div>
              <h3 style="margin:0;font-size:16px;font-weight:700;color:var(--text-pri,#1e293b);">👥 Active Workspace Shares</h3>
              <p style="margin:2px 0 0 0;font-size:12px;color:var(--text-sec,#64748b);">Manage department permissions and revoke access</p>
            </div>
            <button type="button" class="btn-icon" onclick="document.getElementById('tt-active-shares-modal').remove()" style="background:transparent;border:none;cursor:pointer;font-size:18px;color:#64748b;">✕</button>
          </div>

          <div class="modal-bd" style="padding:16px 20px;overflow-y:auto;flex:1;">
            ${shares.length === 0 ? `
              <div style="text-align:center;padding:30px 10px;color:#64748b;">
                <div style="font-size:24px;margin-bottom:8px;">🤝</div>
                <div style="font-size:13px;font-weight:600;">No shares created yet</div>
                <div style="font-size:12px;margin-top:4px;">Share this workspace with supporting or sister departments to collaborate.</div>
              </div>
            ` : `
              <div style="display:flex;flex-direction:column;gap:10px;">
                ${shares.map(s => {
                  const isActive = s.status === 'active';
                  const levelColors = {
                    view: { bg: '#f1f5f9', fg: '#475569' },
                    fill: { bg: '#dcfce7', fg: '#166534' },
                    edit: { bg: '#e0e7ff', fg: '#3730a3' }
                  };
                  const col = levelColors[s.level] || levelColors.view;

                  return `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid ${isActive ? '#e2e8f0' : '#cbd5e1'};border-radius:8px;background:${isActive ? '#fff' : '#f8fafc'};opacity:${isActive ? '1' : '0.75'};">
                      <div>
                        <div style="display:flex;align-items:center;gap:8px;">
                          <span style="font-weight:700;font-size:13.5px;color:#1e293b;">${esc(s.toDeptName || 'Shared Department')}</span>
                          <span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px;background:${col.bg};color:${col.fg};text-transform:uppercase;">
                            ${esc(s.level)}
                          </span>
                          <span style="font-size:11px;padding:2px 6px;border-radius:4px;background:#f1f5f9;color:#64748b;">
                            Status: ${esc(s.status)}
                          </span>
                        </div>
                        <div style="font-size:11.5px;color:#64748b;margin-top:4px;">
                          Scope: ${s.classId ? `Class ${esc(s.classId)}` : 'Whole Workspace'} · Shared by ${esc(s.sharedBy?.name || 'User')} on ${new Date(s.sharedAt || s.createdAt).toLocaleDateString()}
                        </div>
                        ${s.note ? `<div style="font-size:11.5px;color:#475569;margin-top:2px;font-style:italic;">"${esc(s.note)}"</div>` : ''}
                      </div>

                      ${isActive ? `
                        <div style="display:flex;align-items:center;gap:8px;">
                          <select onchange="window.TimetableShareModule.changeShareLevel('${workspaceId}', '${s._id}', this.value)" style="font-size:12px;padding:4px 8px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;">
                            <option value="view" ${s.level === 'view' ? 'selected' : ''}>View</option>
                            <option value="fill" ${s.level === 'fill' ? 'selected' : ''}>Fill</option>
                            <option value="edit" ${s.level === 'edit' ? 'selected' : ''}>Edit</option>
                          </select>
                          <button type="button" class="btn-sm btn-out" onclick="window.TimetableShareModule.revokeShare('${workspaceId}', '${s._id}')" style="padding:4px 10px;font-size:11.5px;border-radius:4px;cursor:pointer;border:1px solid #fecaca;color:#b91c1c;background:#fff;">
                            Revoke
                          </button>
                        </div>
                      ` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <div class="modal-ft" style="display:flex;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--border,#e2e8f0);">
            <button type="button" class="btn-out" onclick="document.getElementById('tt-active-shares-modal').remove()" style="padding:6px 14px;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">Close</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
    } catch (err) {
      console.error('[ShareModule] Failed to list shares:', err);
      alert('Failed to load active shares');
    }
  }

  async function changeShareLevel(workspaceId, shareId, newLevel) {
    try {
      const res = await apiCall('PATCH', `/timetable/workspaces/${workspaceId}/shares/${shareId}/level`, { level: newLevel });
      if (res && res.ok) {
        if (typeof showToast === 'function') showToast(`Share level updated to ${newLevel.toUpperCase()}`, 'success');
        openSharesListModal(workspaceId);
      }
    } catch (err) {
      alert(err.message || 'Failed to update share level');
    }
  }

  async function revokeShare(workspaceId, shareId) {
    if (!confirm('Are you sure you want to revoke this department share? Access will be revoked immediately.')) return;
    try {
      const res = await apiCall('POST', `/timetable/workspaces/${workspaceId}/shares/${shareId}/revoke`);
      if (res && res.ok) {
        if (typeof showToast === 'function') showToast('Share successfully revoked', 'info');
        openSharesListModal(workspaceId);
      }
    } catch (err) {
      alert(err.message || 'Failed to revoke share');
    }
  }

  async function markShareDone(workspaceId, shareId) {
    if (!confirm('Mark your department work as done for this workspace? The owner department will be notified.')) return;
    try {
      const res = await apiCall('POST', `/timetable/workspaces/${workspaceId}/shares/${shareId}/done`);
      if (res && res.ok) {
        if (typeof showToast === 'function') showToast('Marked as done! Workspace owner has been notified.', 'success');
        if (window.TimetableWorkspaceModule) window.TimetableWorkspaceModule.renderRibbons();
      }
    } catch (err) {
      alert(err.message || 'Failed to mark share done');
    }
  }

  // ── Staff Assignment Panel (Live Teacher Matrix Across Workspaces - Section 7.3) ──

  async function openStaffAssignmentPanel(workspaceId, deptId = null) {
    document.getElementById('tt-staff-assignment-modal')?.remove();

    try {
      const url = `/timetable/workspaces/${workspaceId}/staff-assignment${deptId ? `?deptId=${encodeURIComponent(deptId)}` : ''}`;
      const res = await apiCall('GET', url);
      const teachers = (res && Array.isArray(res.teachers)) ? res.teachers : [];
      const deptName = res?.dept?.name || 'Department';

      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const periods = [1, 2, 3, 4, 5, 6, 7, 8];

      const modal = document.createElement('div');
      modal.id = 'tt-staff-assignment-modal';
      modal.className = 'modal-backdrop';
      modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';

      modal.innerHTML = `
        <div class="modal-card" style="background:var(--card,#ffffff);border-radius:12px;width:95%;max-width:1100px;max-height:90vh;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);overflow:hidden;border:1px solid var(--border,#e2e8f0);display:flex;flex-direction:column;">
          <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border,#e2e8f0);background:#f8fafc;">
            <div>
              <h3 style="margin:0;font-size:16px;font-weight:700;color:var(--text-pri,#1e293b);">👥 Staff Allocation Matrix: ${esc(deptName)}</h3>
              <p style="margin:2px 0 0 0;font-size:12px;color:var(--text-sec,#64748b);">Live schedule across Production and All Open Workspaces</p>
            </div>
            <button type="button" class="btn-icon" onclick="document.getElementById('tt-staff-assignment-modal').remove()" style="background:transparent;border:none;cursor:pointer;font-size:18px;color:#64748b;">✕</button>
          </div>

          <div class="modal-bd" style="padding:16px;overflow-x:auto;overflow-y:auto;flex:1;">
            ${teachers.length === 0 ? `
              <div style="text-align:center;padding:40px;color:#64748b;">No active teachers found for this department.</div>
            ` : `
              <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
                <thead>
                  <tr style="background:#f1f5f9;border-bottom:2px solid #cbd5e1;">
                    <th style="padding:8px 10px;width:180px;font-weight:700;">Teacher</th>
                    <th style="padding:8px 10px;width:90px;font-weight:700;">Hours / Wk</th>
                    ${days.map(d => `<th style="padding:8px 6px;text-align:center;font-weight:700;border-left:1px solid #e2e8f0;">${d.slice(0,3)}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${teachers.map(t => {
                    const assigned = Number(t.assignedHours) || 0;
                    const max = Number(t.maxWeeklyHours) || 20;
                    const pct = Math.min(100, Math.round((assigned / max) * 100));
                    const isOverloaded = assigned > max;

                    // Map slots by day
                    const slotsByDay = new Map();
                    (t.slots || []).forEach(s => {
                      if (!slotsByDay.has(s.day)) slotsByDay.set(s.day, []);
                      slotsByDay.get(s.day).push(s);
                    });

                    return `
                      <tr style="border-bottom:1px solid #e2e8f0;background:#fff;">
                        <td style="padding:8px 10px;">
                          <div style="font-weight:600;color:#1e293b;">${esc(t.name)}</div>
                          <div style="font-size:10.5px;color:#64748b;">${esc(t.employeeId)}</div>
                        </td>
                        <td style="padding:8px 10px;">
                          <div style="font-weight:700;color:${isOverloaded ? '#b91c1c' : '#15803d'};">${assigned} / ${max} h</div>
                          <div style="width:100%;height:4px;background:#e2e8f0;border-radius:2px;margin-top:3px;overflow:hidden;">
                            <div style="width:${pct}%;height:100%;background:${isOverloaded ? '#ef4444' : '#22c55e'};"></div>
                          </div>
                        </td>
                        ${days.map(day => {
                          const daySlots = slotsByDay.get(day) || [];
                          return `
                            <td style="padding:6px;border-left:1px solid #f1f5f9;vertical-align:top;">
                              ${daySlots.length === 0 ? `
                                <span style="color:#cbd5e1;font-size:11px;">–</span>
                              ` : `
                                <div style="display:flex;flex-direction:column;gap:3px;">
                                  ${daySlots.map(s => {
                                    const isProd = s.isProduction;
                                    const bg = isProd ? '#f1f5f9' : '#e0f2fe';
                                    const col = isProd ? '#475569' : '#0369a1';
                                    return `
                                      <div style="padding:2px 4px;border-radius:3px;background:${bg};color:${col};font-size:10.5px;" title="${esc(s.className)} · ${esc(s.subject)} (${isProd ? 'Production' : s.workspaceName})">
                                        <strong>P${s.period}</strong>: ${esc(s.className || 'Class')}
                                      </div>
                                    `;
                                  }).join('')}
                                </div>
                              `}
                            </td>
                          `;
                        }).join('')}
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            `}
          </div>

          <div class="modal-ft" style="display:flex;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--border,#e2e8f0);background:#f8fafc;">
            <button type="button" class="btn-out" onclick="document.getElementById('tt-staff-assignment-modal').remove()" style="padding:6px 14px;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">Close</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
    } catch (err) {
      console.error('[ShareModule] Error loading staff assignments:', err);
      alert('Failed to load staff assignments: ' + err.message);
    }
  }

  // ── Reserve Slot Dialog (Section 7.2) ──

  async function openReserveSlotModal(params = {}) {
    const { workspaceId, classId, day, period, revision } = params;
    if (!workspaceId || !classId) return;

    document.getElementById('tt-reserve-slot-modal')?.remove();

    // Fetch departments
    let depts = [];
    try {
      const dRes = await apiCall('GET', '/departments');
      if (Array.isArray(dRes)) depts = dRes;
      else if (dRes && Array.isArray(dRes.departments)) depts = dRes.departments;
    } catch (_) {}

    const modal = document.createElement('div');
    modal.id = 'tt-reserve-slot-modal';
    modal.className = 'modal-backdrop';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';

    modal.innerHTML = `
      <div class="modal-card" style="background:var(--card,#ffffff);border-radius:12px;width:90%;max-width:440px;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);overflow:hidden;border:1px solid var(--border,#e2e8f0);">
        <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border,#e2e8f0);">
          <h3 style="margin:0;font-size:15px;font-weight:700;color:#1e293b;">📌 Reserve Slot for Department</h3>
          <button type="button" class="btn-icon" onclick="document.getElementById('tt-reserve-slot-modal').remove()" style="background:transparent;border:none;cursor:pointer;font-size:18px;color:#64748b;">✕</button>
        </div>

        <form id="tt-reserve-slot-form" style="padding:16px 18px;display:flex;flex-direction:column;gap:12px;">
          <div style="font-size:12px;color:#475569;background:#f8fafc;padding:8px 10px;border-radius:6px;border:1px solid #e2e8f0;">
            Reserving slot on <strong>${esc(day)} Period ${esc(period)}</strong> for another department to fill with their faculty/subject.
          </div>

          <div>
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#334155;">Reserve for Department *</label>
            <select id="reserve-target-dept" required style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;">
              <option value="">Select target department…</option>
              ${depts.map(d => `<option value="${esc(d._id)}" data-name="${esc(d.name)}">${esc(d.name)} ${d.category === 'supporting' ? '⭐' : ''}</option>`).join('')}
            </select>
          </div>

          <div>
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#334155;">Span (Periods)</label>
            <input type="number" id="reserve-span" min="1" max="4" value="1" style="width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;">
          </div>

          <div>
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#334155;">Note / Instructions</label>
            <input type="text" id="reserve-note" placeholder="e.g. Maths faculty required" style="width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;">
          </div>

          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;">
            <button type="button" class="btn-out" onclick="document.getElementById('tt-reserve-slot-modal').remove()" style="font-size:12px;padding:6px 12px;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">Cancel</button>
            <button type="submit" class="btn-pri" style="font-size:12px;padding:6px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Reserve Slot</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('tt-reserve-slot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const deptSelect = document.getElementById('reserve-target-dept');
      const toDeptId = deptSelect.value;
      const toDeptName = deptSelect.selectedOptions[0]?.getAttribute('data-name') || '';
      const span = Number(document.getElementById('reserve-span').value) || 1;
      const note = document.getElementById('reserve-note').value;

      try {
        const payload = {
          day,
          period: Number(period),
          span,
          toDeptId,
          toDeptName,
          note,
          revision: Number(revision)
        };

        const res = await apiCall('POST', `/timetable/workspaces/${workspaceId}/classes/${classId}/slots/reserve`, payload);
        if (res && res.ok) {
          modal.remove();
          if (typeof showToast === 'function') showToast(`Reserved slot for ${toDeptName}`, 'success');
          // Refresh views
          if (window.workspace && typeof window.workspace.refreshAllTabs === 'function') {
            window.workspace.refreshAllTabs();
          } else if (typeof renderCurrentView === 'function') {
            renderCurrentView();
          }
        }
      } catch (err) {
        alert(err.message || 'Failed to reserve slot');
      }
    });
  }

  // ── Shared With Me Modal / Switcher (Section 7.3) ──

  async function openSharedWithMeModal() {
    document.getElementById('tt-shared-with-me-modal')?.remove();

    try {
      const res = await apiCall('GET', '/timetable/workspaces/shared-with-me');
      const shares = (res && Array.isArray(res.shares)) ? res.shares : [];

      const modal = document.createElement('div');
      modal.id = 'tt-shared-with-me-modal';
      modal.className = 'modal-backdrop';
      modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';

      modal.innerHTML = `
        <div class="modal-card" style="background:var(--card,#ffffff);border-radius:12px;width:90%;max-width:580px;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);overflow:hidden;border:1px solid var(--border,#e2e8f0);">
          <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border,#e2e8f0);">
            <div>
              <h3 style="margin:0;font-size:16px;font-weight:700;color:var(--text-pri,#1e293b);">📥 Workspaces Shared With My Department</h3>
              <p style="margin:2px 0 0 0;font-size:12px;color:var(--text-sec,#64748b);">Collaborate on timetables shared by other departments</p>
            </div>
            <button type="button" class="btn-icon" onclick="document.getElementById('tt-shared-with-me-modal').remove()" style="background:transparent;border:none;cursor:pointer;font-size:18px;color:#64748b;">✕</button>
          </div>

          <div class="modal-bd" style="padding:16px 20px;max-height:60vh;overflow-y:auto;">
            ${shares.length === 0 ? `
              <div style="text-align:center;padding:30px 10px;color:#64748b;">
                <div style="font-size:24px;margin-bottom:8px;">📭</div>
                <div style="font-size:13px;font-weight:600;">No workspaces shared with your department</div>
              </div>
            ` : `
              <div style="display:flex;flex-direction:column;gap:10px;">
                ${shares.map(s => {
                  const ws = s.workspace || {};
                  const levelBadgeColors = {
                    view: { bg: '#f1f5f9', fg: '#475569' },
                    fill: { bg: '#dcfce7', fg: '#166534' },
                    edit: { bg: '#e0e7ff', fg: '#3730a3' }
                  };
                  const col = levelBadgeColors[s.level] || levelBadgeColors.view;

                  return `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;">
                      <div>
                        <div style="display:flex;align-items:center;gap:8px;">
                          <span style="font-weight:700;font-size:13.5px;color:#1e293b;">${esc(ws.name || 'Workspace')}</span>
                          <span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px;background:${col.bg};color:${col.fg};text-transform:uppercase;">
                            ${esc(s.level)}
                          </span>
                        </div>
                        <div style="font-size:11.5px;color:#64748b;margin-top:4px;">
                          Dept: <strong>${esc(ws.deptName || 'Owner')}</strong> · ${esc(ws.trackId || '')} · Shared: ${new Date(s.sharedAt || s.createdAt).toLocaleDateString()}
                        </div>
                        ${s.note ? `<div style="font-size:11.5px;color:#475569;margin-top:2px;font-style:italic;">"${esc(s.note)}"</div>` : ''}
                      </div>

                      <div style="display:flex;gap:6px;">
                        <button type="button" class="btn-sm btn-pri" onclick="window.TimetableShareModule.selectSharedWorkspace('${ws._id}')" style="padding:5px 12px;font-size:12px;background:#15803d;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">
                          Open ↗
                        </button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <div class="modal-ft" style="display:flex;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--border,#e2e8f0);">
            <button type="button" class="btn-out" onclick="document.getElementById('tt-shared-with-me-modal').remove()" style="padding:6px 14px;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">Close</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
    } catch (err) {
      console.error('[ShareModule] Error loading shared-with-me:', err);
    }
  }

  async function selectSharedWorkspace(workspaceId) {
    document.getElementById('tt-shared-with-me-modal')?.remove();
    if (window.TimetableWorkspaceModule && typeof window.TimetableWorkspaceModule.selectWorkspace === 'function') {
      await window.TimetableWorkspaceModule.selectWorkspace(workspaceId);
    }
  }

  // Expose global interface
  window.TimetableShareModule = {
    openShareModal,
    openSharesListModal,
    changeShareLevel,
    revokeShare,
    markShareDone,
    openStaffAssignmentPanel,
    openReserveSlotModal,
    openSharedWithMeModal,
    selectSharedWorkspace
  };

})();
