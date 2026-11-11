/**
 * public/js/modules/compare.module.js
 * EAMS Timetable v3 — Visual Compare, Matrix Diff & Workload Dumbbells (Phase 6)
 *
 * Implements:
 * 1. Side-by-side / Highlighted weekly matrix diff (Green: Added, Amber: Modified, Rose: Removed)
 * 2. Faculty Workload Dumbbells summary strip (production hrs -> draft hrs)
 * 3. Room Utilization shifts and occupancy deltas inspector
 * 4. Interactive modal and inline view integration
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

  const TimetableCompare = {
    /**
     * Fetch compare data from server
     */
    async fetchCompareData(workspaceId, classId) {
      const token = getAuthToken();
      const params = new URLSearchParams();
      if (workspaceId) params.append('workspaceId', workspaceId);
      if (classId) params.append('classId', classId);

      const headers = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/timetable/compare?${params.toString()}`, {
        headers
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Compare failed with HTTP ${res.status}`);
      }
      return await res.json();
    },

    /**
     * Render Workload Dumbbells Strip
     */
    renderWorkloadDumbbells(teachers) {
      if (!Array.isArray(teachers) || teachers.length === 0) {
        return `<div style="padding:12px;color:var(--tt-muted,#64748b);font-size:12.5px;font-style:italic;">No teacher workload differences detected.</div>`;
      }

      const changedTeachers = teachers.filter(t => t.deltaHours !== 0 || t.newClashes > 0);
      const listToDisplay = changedTeachers.length > 0 ? changedTeachers : teachers.slice(0, 8);

      return `
        <div class="tt-compare-workload-strip" style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:18px;">
          ${listToDisplay.map(t => {
            const prodH = t.prodTheory + t.prodLab;
            const wsH = t.wsTheory + t.wsLab;
            const delta = t.deltaHours;
            const deltaSign = delta > 0 ? `+${delta}` : `${delta}`;
            const deltaBg = delta > 0 ? '#dcfce7' : (delta < 0 ? '#f1f5f9' : '#f8fafc');
            const deltaColor = delta > 0 ? '#166534' : (delta < 0 ? '#475569' : '#334155');

            return `
              <div class="tt-dumbbell-card" style="flex:1 1 240px;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                  <span style="font-weight:600;font-size:13px;color:#1e293b;" title="${esc(t.name)}">${esc(t.name)}</span>
                  ${t.newClashes > 0 ? `<span style="background:#fee2e2;color:#991b1b;padding:2px 7px;border-radius:12px;font-size:10.5px;font-weight:700;">${t.newClashes} Clash!</span>` : ''}
                </div>

                <!-- Dumbbell Graphic -->
                <div style="display:flex;align-items:center;gap:10px;margin-top:6px;">
                  <div style="display:flex;flex-direction:column;align-items:center;">
                    <span style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:600;">Prod</span>
                    <div style="width:28px;height:28px;border-radius:50%;background:#e2e8f0;color:#334155;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">
                      ${prodH}h
                    </div>
                  </div>

                  <div style="flex:1;height:4px;background:#cbd5e1;position:relative;border-radius:2px;">
                    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:${deltaBg};color:${deltaColor};font-size:11px;font-weight:700;padding:1px 6px;border-radius:10px;border:1px solid rgba(0,0,0,0.08);white-space:nowrap;">
                      ${deltaSign}h
                    </div>
                  </div>

                  <div style="display:flex;flex-direction:column;align-items:center;">
                    <span style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:600;">Draft</span>
                    <div style="width:28px;height:28px;border-radius:50%;background:#1b5e20;color:#ffffff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">
                      ${wsH}h
                    </div>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    },

    /**
     * Render Room Utilization Inspector
     */
    renderRoomDeltas(rooms) {
      if (!Array.isArray(rooms) || rooms.length === 0) return '';
      const shiftedRooms = rooms.filter(r => r.delta !== 0 || r.taken.length > 0 || r.freed.length > 0);
      if (shiftedRooms.length === 0) return '';

      return `
        <div style="margin-bottom:18px;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
          <h4 style="margin:0 0 10px 0;font-size:13px;font-weight:600;color:#334155;display:flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3b82f6;"></span>
            Room Occupancy Shifts (${shiftedRooms.length} rooms affected)
          </h4>
          <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:10px;">
            ${shiftedRooms.map(r => `
              <div style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;">
                <div style="display:flex;justify-content:space-between;font-weight:600;color:#1e293b;">
                  <span>${esc(r.room)}</span>
                  <span style="color:${r.delta > 0 ? '#166534' : (r.delta < 0 ? '#991b1b' : '#64748b')}">
                    ${r.delta > 0 ? `+${r.delta}h` : `${r.delta}h`}
                  </span>
                </div>
                <div style="font-size:11px;color:#64748b;margin-top:4px;">
                  Occupied: ${r.prodOccupied}h &rarr; ${r.wsOccupied}h
                  ${r.freed.length ? `<span style="color:#166534;margin-left:4px;">(${r.freed.length} freed)</span>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    },

    /**
     * Render Matrix Diff Table for a Class
     */
    renderDiffMatrix(classCompare) {
      if (!classCompare) return '<div style="padding:14px;">No class comparison available.</div>';

      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const periods = [1, 2, 3, 4, 5, 6, 7, 8];

      // Build cell lookup map
      const addedMap = new Map();
      (classCompare.added || []).forEach(s => addedMap.set(`${s.day}_${s.period}`, s));

      const modMap = new Map();
      (classCompare.modified || []).forEach(m => modMap.set(`${m.draft?.day || m.day}_${m.draft?.period || m.period}`, m));

      const remMap = new Map();
      (classCompare.removed || []).forEach(s => remMap.set(`${s.day}_${s.period}`, s));

      const stats = classCompare.stats || { added: 0, modified: 0, removed: 0 };

      return `
        <div class="tt-compare-class-card" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,0.03);">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;border-bottom:1px solid #f1f5f9;padding-bottom:12px;">
            <div>
              <h3 style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">${esc(classCompare.className || 'Class Timetable')}</h3>
              <div style="font-size:11.5px;color:#64748b;margin-top:2px;">
                Base Commit: <code style="font-family:monospace;background:#f1f5f9;padding:1px 5px;border-radius:4px;">${esc(classCompare.base?.trackId || 'Live Head')}</code>
                ${classCompare.stale ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;margin-left:8px;">⚠️ Stale Base</span>' : ''}
              </div>
            </div>

            <!-- Stats Badge Cluster -->
            <div style="display:flex;gap:8px;">
              <span style="background:#dcfce7;color:#166534;padding:4px 10px;border-radius:20px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:4px;">
                +${stats.added} Added
              </span>
              <span style="background:#fef3c7;color:#92400e;padding:4px 10px;border-radius:20px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:4px;">
                ~${stats.modified} Modified
              </span>
              <span style="background:#fee2e2;color:#991b1b;padding:4px 10px;border-radius:20px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:4px;">
                -${stats.removed} Removed
              </span>
            </div>
          </div>

          <!-- Diff Grid Table -->
          <div style="overflow-x:auto;">
            <table class="tt-compare-table" style="width:100%;border-collapse:separate;border-spacing:4px;font-size:12px;">
              <thead>
                <tr>
                  <th style="padding:6px 10px;background:#f8fafc;color:#64748b;font-weight:600;text-align:left;border-radius:6px;width:90px;">Day</th>
                  ${periods.map(p => `
                    <th style="padding:6px;background:#f8fafc;color:#64748b;font-weight:600;text-align:center;border-radius:6px;min-width:110px;">
                      P${p}
                    </th>
                  `).join('')}
                </tr>
              </thead>
              <tbody>
                ${days.map(d => `
                  <tr>
                    <td style="padding:8px 10px;font-weight:700;color:#334155;background:#f8fafc;border-radius:6px;">${d}</td>
                    ${periods.map(p => {
                      const key = `${d}_${p}`;
                      const add = addedMap.get(key);
                      const mod = modMap.get(key);
                      const rem = remMap.get(key);

                      if (add) {
                        return `
                          <td style="padding:8px;background:#dcfce7;border:1px solid #86efac;border-radius:6px;vertical-align:top;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
                              <span style="background:#166534;color:#ffffff;font-size:9.5px;font-weight:800;padding:1px 4px;border-radius:3px;">+ ADDED</span>
                            </div>
                            <div style="font-weight:700;color:#14532d;">${esc(add.subject || add.subjectName || 'Subject')}</div>
                            <div style="font-size:10.5px;color:#166534;margin-top:2px;">${esc(add.teacher || add.teacherName || '')}</div>
                            <div style="font-size:10px;color:#15803d;font-style:italic;">${esc(add.room || add.hallNo || '')}</div>
                          </td>
                        `;
                      }

                      if (mod) {
                        const oldS = mod.production || mod.base || {};
                        const newS = mod.draft || {};
                        return `
                          <td style="padding:8px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;vertical-align:top;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
                              <span style="background:#92400e;color:#ffffff;font-size:9.5px;font-weight:800;padding:1px 4px;border-radius:3px;">~ MODIFIED</span>
                            </div>
                            <div style="font-weight:700;color:#78350f;">${esc(newS.subject || 'Subject')}</div>
                            <div style="font-size:10px;color:#92400e;margin-top:2px;">
                              <span style="text-decoration:line-through;opacity:0.75;">${esc(oldS.teacher || oldS.room || '')}</span>
                              &rarr; <b>${esc(newS.teacher || newS.room || '')}</b>
                            </div>
                          </td>
                        `;
                      }

                      if (rem) {
                        return `
                          <td style="padding:8px;background:#fee2e2;border:1px dashed #fca5a5;border-radius:6px;vertical-align:top;opacity:0.85;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
                              <span style="background:#991b1b;color:#ffffff;font-size:9.5px;font-weight:800;padding:1px 4px;border-radius:3px;">- REMOVED</span>
                            </div>
                            <div style="text-decoration:line-through;font-weight:600;color:#7f1d1d;">${esc(rem.subject || 'Subject')}</div>
                            <div style="font-size:10px;color:#991b1b;">${esc(rem.teacher || '')}</div>
                          </td>
                        `;
                      }

                      return `
                        <td style="padding:8px;background:#f8fafc;border:1px solid #f1f5f9;border-radius:6px;color:#94a3b8;text-align:center;font-size:11px;">
                          —
                        </td>
                      `;
                    }).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    },

    /**
     * Show full Compare Modal
     */
    async showModal(options = {}) {
      const { workspaceId, classId, className } = options;
      if (document.getElementById('tt-compare-modal')) {
        document.getElementById('tt-compare-modal').remove();
      }

      const modal = document.createElement('div');
      modal.id = 'tt-compare-modal';
      modal.className = 'tt-modal-overlay';
      modal.style.position = 'fixed';
      modal.style.inset = '0';
      modal.style.background = 'rgba(15,23,42,0.6)';
      modal.style.backdropFilter = 'blur(4px)';
      modal.style.zIndex = '9999';
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.padding = '20px';

      modal.innerHTML = `
        <div class="tt-modal-container" style="background:#ffffff;border-radius:14px;max-width:1100px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);overflow:hidden;">
          <div class="tt-modal-header" style="background:linear-gradient(135deg, #0f172a 0%, #1e293b 100%);color:#ffffff;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <span style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.8;font-weight:700;">VISUAL COMPARE &amp; DELTA MATRIX</span>
              <h2 style="margin:2px 0 0 0;font-size:18px;font-weight:600;">Draft vs Live Production Differences</h2>
            </div>
            <button id="tt-compare-close-btn" style="background:transparent;border:none;color:#ffffff;font-size:24px;line-height:1;cursor:pointer;opacity:0.8;">&times;</button>
          </div>

          <div id="tt-compare-body" style="padding:20px;overflow-y:auto;flex:1;">
            <div style="display:flex;align-items:center;justify-content:center;padding:40px;color:#64748b;gap:10px;">
              <div style="width:20px;height:20px;border:3px solid #cbd5e1;border-top-color:#1b5e20;border-radius:50%;animation:spin 1s linear infinite;"></div>
              <span>Calculating schedule diffs and workload dumbbells...</span>
            </div>
          </div>

          <div class="tt-modal-footer" style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:10px;">
            <button id="tt-compare-done-btn" class="btn-pri" style="padding:8px 20px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;background:#1b5e20;color:#ffffff;border:none;">Done</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const close = () => modal.remove();
      modal.querySelector('#tt-compare-close-btn').addEventListener('click', close);
      modal.querySelector('#tt-compare-done-btn').addEventListener('click', close);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
      });

      try {
        const data = await this.fetchCompareData(workspaceId, classId);
        const bodyEl = modal.querySelector('#tt-compare-body');

        let html = '';
        html += this.renderWorkloadDumbbells(data.teachers);
        html += this.renderRoomDeltas(data.rooms);

        if (Array.isArray(data.perClass) && data.perClass.length > 0) {
          data.perClass.forEach(c => {
            html += this.renderDiffMatrix(c);
          });
        } else {
          html += '<div style="padding:20px;text-align:center;color:#64748b;">No class differences detected. Draft matches live production.</div>';
        }

        bodyEl.innerHTML = html;
      } catch (err) {
        modal.querySelector('#tt-compare-body').innerHTML = `
          <div style="padding:24px;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;color:#991b1b;">
            <b>Error loading compare:</b> ${esc(err.message)}
          </div>
        `;
      }
    }
  };

  window.TimetableCompare = TimetableCompare;
})(typeof window !== 'undefined' ? window : global);
