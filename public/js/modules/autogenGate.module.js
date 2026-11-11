/**
 * public/js/modules/autogenGate.module.js
 *
 * AutoGen Verification Gate Modal & Change Request Engine (Phase 4):
 * - Intercepts Auto-Generate button clicks with curriculum verification.
 * - Displays canonical allocation summary table with SHA-256 hash.
 * - Surfaces validation alerts (unassigned lab rooms, hours exceeding slots).
 * - Issues 30-day confirmation clearance token via POST /auto-gen/confirm.
 * - Interactive grievance change request form routed to author or HoD.
 */

(function (window) {
  'use strict';

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  let activeModal = null;

  async function open(options = {}) {
    const {
      classId,
      draftId,
      onConfirmed = () => {},
      onGrievanceSubmitted = () => {}
    } = options;

    if (!classId) {
      if (window.toast) window.toast('Please select a class first.', 'warning');
      return;
    }

    close();

    // Show initial loading modal
    const modal = document.createElement('div');
    modal.id = 'autogen-gate-modal-backdrop';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-fade-in';

    modal.innerHTML = `
      <div class="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100 animate-scale-up">
        <div id="ag-gate-content" class="p-8 flex items-center justify-center space-x-3 text-slate-400">
          <div class="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <span class="text-sm font-medium">Verifying curriculum Subject Set integrity...</span>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    activeModal = modal;

    // Fetch Subject Set check data
    let checkData = null;
    try {
      const res = await fetch('/api/timetable/auto-gen/check', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ classId, draftId })
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Failed to verify subject set');
      checkData = json.data;
    } catch (err) {
      renderError(modal, err.message);
      return;
    }

    // If already confirmed with same hash, skip modal and proceed directly
    if (checkData.confirmed) {
      close();
      onConfirmed(checkData.rowsHash);
      return;
    }

    // Render the verification gate modal
    renderGateModal(modal, checkData, { classId, draftId, onConfirmed, onGrievanceSubmitted });
  }

  function renderError(modal, message) {
    const content = modal.querySelector('#ag-gate-content');
    if (!content) return;
    content.innerHTML = `
      <div class="w-full text-center py-6">
        <div class="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto mb-3">
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
        </div>
        <h4 class="text-base font-bold text-white mb-1">Subject Set Verification Failed</h4>
        <p class="text-xs text-red-300 max-w-md mx-auto mb-5">${escapeHtml(message)}</p>
        <button id="ag-err-close" class="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition text-xs font-semibold">Close</button>
      </div>
    `;
    modal.querySelector('#ag-err-close')?.addEventListener('click', close);
  }

  function renderGateModal(modal, data, ctx) {
    const items = data.items || [];
    const warnings = data.warnings || [];
    const rowsHash = data.rowsHash || '';
    const hashShort = rowsHash ? rowsHash.slice(0, 8) : '--------';
    const authorName = data.createdBy?.name || 'Curriculum Coordinator';
    const authorTrack = data.createdBy?.trackId ? ` (${data.createdBy.trackId})` : '';

    const warningsHtml = warnings.length ? `
      <div class="mb-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs space-y-1 animate-fade-in">
        <div class="font-bold flex items-center gap-1.5 text-amber-400">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          <span>Curriculum Integrity Alerts</span>
        </div>
        ${warnings.map(w => `<div>• ${escapeHtml(w)}</div>`).join('')}
      </div>
    ` : '';

    const tableRows = items.map((it, idx) => `
      <tr class="border-b border-slate-800/80 hover:bg-slate-800/30 transition text-xs">
        <td class="py-2.5 px-3">
          <input type="checkbox" class="ag-dispute-checkbox rounded border-slate-700 text-emerald-500 focus:ring-0" data-idx="${idx}" data-subject="${escapeHtml(it.subjectName || it.subjectCode)}" />
        </td>
        <td class="py-2.5 px-3">
          <div class="font-mono font-bold text-white">${escapeHtml(it.subjectCode || 'SUB')}</div>
          <div class="text-slate-400 text-[11px] truncate max-w-[180px]">${escapeHtml(it.subjectName || '')}</div>
        </td>
        <td class="py-2.5 px-3">
          <span class="font-medium text-slate-200">${escapeHtml(it.teacherName || 'Unassigned')}</span>
        </td>
        <td class="py-2.5 px-3">
          <span class="font-mono text-slate-300 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700/70">${escapeHtml(it.hallNo || 'None')}</span>
        </td>
        <td class="py-2.5 px-3 font-mono font-semibold text-center text-slate-200">
          ${it.periodsPerWeek || 4}
        </td>
        <td class="py-2.5 px-3 text-center">
          ${it.isLab ? '<span class="px-2 py-0.5 rounded-full text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">Lab</span>' : '<span class="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-400">Theory</span>'}
        </td>
      </tr>
    `).join('');

    modal.innerHTML = `
      <div class="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100 animate-scale-up">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div>
            <div class="text-[11px] font-bold tracking-wider uppercase text-emerald-400 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>CURRICULUM VALIDATION GATE</span>
            </div>
            <h3 class="text-lg font-bold text-white">
              Verify Subject Set — <span class="text-emerald-400">${escapeHtml(data.className || 'Class')}</span>
            </h3>
          </div>
          <button id="ag-close-btn" class="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition" aria-label="Close">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-6 space-y-4">
          ${warningsHtml}

          <div class="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b border-slate-800 bg-slate-800/60 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th class="py-2.5 px-3 w-8">#</th>
                  <th class="py-2.5 px-3">Subject</th>
                  <th class="py-2.5 px-3">Faculty</th>
                  <th class="py-2.5 px-3">Allocated Room</th>
                  <th class="py-2.5 px-3 text-center">Periods/Wk</th>
                  <th class="py-2.5 px-3 text-center">Type</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows || '<tr><td colspan="6" class="p-6 text-center text-slate-500">No subjects allocated.</td></tr>'}
              </tbody>
            </table>
          </div>

          <!-- Inline Change Request Form (Hidden by default) -->
          <div id="ag-grievance-panel" class="hidden p-4 rounded-xl bg-slate-800/80 border border-amber-500/30 space-y-3 animate-fade-in">
            <div class="flex items-center justify-between">
              <div class="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                <span>Curriculum Revision Request (Structured Grievance)</span>
              </div>
              <span class="text-[11px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-700">Routes to: ${escapeHtml(authorName)}</span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label class="block text-slate-400 mb-1 font-medium">Change Type</label>
                <select id="ag-change-type" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-amber-400">
                  <option value="Reassign faculty">Reassign faculty member</option>
                  <option value="Change room">Change assigned classroom/lab</option>
                  <option value="Adjust periods/week">Adjust periods per week</option>
                  <option value="Remove subject">Remove subject from semester</option>
                  <option value="Other">Other curriculum revision</option>
                </select>
              </div>
              <div>
                <label class="block text-slate-400 mb-1 font-medium">Specific Detail / Target Staff or Room</label>
                <input type="text" id="ag-change-detail" placeholder="e.g. Allocate to Dr. Vignesh in Hall 204" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-amber-400" />
              </div>
            </div>

            <div>
              <label class="block text-slate-400 mb-1 text-xs font-medium">Coordinator Note / Justification</label>
              <textarea id="ag-change-note" rows="2" placeholder="Explain the reason for this curriculum adjustment..." class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-400"></textarea>
            </div>

            <div class="flex items-center justify-end gap-2 pt-1">
              <button id="ag-cancel-grievance-btn" class="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white transition text-xs font-medium">Cancel Request</button>
              <button id="ag-submit-grievance-btn" class="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs transition shadow-lg shadow-amber-900/30 flex items-center gap-1.5">
                <span>Submit Grievance</span>
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 border-t border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div class="text-slate-400">
            <div>Created by <span class="text-slate-200 font-semibold">${escapeHtml(authorName)}${escapeHtml(authorTrack)}</span></div>
            <div class="text-[11px] font-mono text-slate-500">Hash: #${hashShort} · 30-Day Clearance Protocol</div>
          </div>

          <div class="flex items-center gap-2.5">
            <button id="ag-cancel-modal-btn" class="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition font-medium">Cancel</button>
            <button id="ag-no-changes-btn" class="px-4 py-2 rounded-xl border border-amber-500/40 text-amber-300 hover:bg-amber-500/15 hover:border-amber-500/70 transition font-medium flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
              <span>No, Request Changes</span>
            </button>
            <button id="ag-confirm-btn" class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-lg shadow-emerald-900/30 flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
              <span>Yes, Subject Set is Correct</span>
            </button>
          </div>
        </div>
      </div>
    `;

    // Bind event listeners
    modal.querySelector('#ag-close-btn').addEventListener('click', close);
    modal.querySelector('#ag-cancel-modal-btn').addEventListener('click', close);

    const grievancePanel = modal.querySelector('#ag-grievance-panel');
    const noChangesBtn = modal.querySelector('#ag-no-changes-btn');
    const confirmBtn = modal.querySelector('#ag-confirm-btn');

    // Toggle Grievance Panel
    noChangesBtn.addEventListener('click', () => {
      grievancePanel.classList.remove('hidden');
      grievancePanel.scrollIntoView({ behavior: 'smooth' });
    });

    modal.querySelector('#ag-cancel-grievance-btn').addEventListener('click', () => {
      grievancePanel.classList.add('hidden');
    });

    // Submit Grievance
    modal.querySelector('#ag-submit-grievance-btn').addEventListener('click', async () => {
      const changeType = modal.querySelector('#ag-change-type').value;
      const changeDetail = modal.querySelector('#ag-change-detail').value;
      const note = modal.querySelector('#ag-change-note').value;

      const checkedBoxes = modal.querySelectorAll('.ag-dispute-checkbox:checked');
      const requestedChanges = [];

      checkedBoxes.forEach(cb => {
        requestedChanges.push({
          subject: cb.getAttribute('data-subject'),
          changeType,
          detail: changeDetail
        });
      });

      if (!requestedChanges.length) {
        requestedChanges.push({
          subject: 'General Curriculum',
          changeType,
          detail: changeDetail
        });
      }

      try {
        const res = await fetch('/api/timetable/auto-gen/request-changes', {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            classId: ctx.classId,
            draftId: ctx.draftId,
            requestedChanges,
            note
          })
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Failed to submit change request');

        if (window.toast) {
          window.toast(`Change request submitted (${json.trackId}). Routed to curriculum owner.`, 'success');
        }
        close();
        ctx.onGrievanceSubmitted(json);
      } catch (err) {
        if (window.toast) window.toast(`Error: ${err.message}`, 'error');
      }
    });

    // Confirm Subject Set
    confirmBtn.addEventListener('click', async () => {
      try {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `
          <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          <span>Confirming...</span>
        `;

        const res = await fetch('/api/timetable/auto-gen/confirm', {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            classId: ctx.classId,
            draftId: ctx.draftId,
            rowsHash
          })
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Failed to confirm subject set');

        if (window.toast) {
          window.toast('Subject Set verified & clearance token issued.', 'success');
        }
        close();
        ctx.onConfirmed(rowsHash);
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `<span>Yes, Subject Set is Correct</span>`;
        if (window.toast) window.toast(`Confirmation failed: ${err.message}`, 'error');
      }
    });
  }

  function close() {
    if (activeModal && activeModal.parentNode) {
      activeModal.parentNode.removeChild(activeModal);
    }
    activeModal = null;
  }

  window.AutoGenGate = {
    open,
    close
  };

})(window);
