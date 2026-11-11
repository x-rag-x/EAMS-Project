/**
 * public/js/modules/share.module.js
 *
 * Universal Share Modal, Access Requests, Comments & Real-Time Presence (Phase 5):
 * - Multi-Role Collaborator Invitations (Viewer, Commenter, Editor Full/Fill-Only).
 * - Cryptographic 10-char shareable links with epoch rotation.
 * - Approval gate for editor links (WorkspaceAccessRequest).
 * - Active Collaborators management table.
 * - Threaded Slot Comments popover with C20 slotHash badge ("Slot contents changed").
 * - Live presence WebSocket client (/ws/timetable) with peer editing outlines.
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
  let activePresenceSocket = null;
  let currentWorkspaceId = null;
  let currentDraftId = null;

  // ── Universal Share Modal ──

  async function openShareModal(options = {}) {
    const wsId = options.workspaceId || currentWorkspaceId;
    if (!wsId) {
      if (window.toast) window.toast.error('No active workspace selected to share');
      return;
    }
    currentWorkspaceId = wsId;
    currentDraftId = options.draftId || currentDraftId;

    closeShareModal();

    const modal = document.createElement('div');
    modal.id = 'tt-share-modal-backdrop';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in';

    modal.innerHTML = `
      <div class="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100 animate-scale-up">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div>
            <div class="text-xs font-semibold tracking-wider uppercase text-emerald-400">Collaborator Access & Sharing</div>
            <h3 class="text-lg font-bold text-white flex items-center gap-2">
              <span>Share Timetable Workspace</span>
              <span id="tt-share-ws-tag" class="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300"></span>
            </h3>
          </div>
          <button id="tt-share-close-btn" class="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition" aria-label="Close modal">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <!-- Tabs Navigation -->
        <div class="flex border-b border-slate-800 bg-slate-950/60 px-6 pt-2">
          <button id="tt-share-tab-invite" class="px-4 py-2 text-sm font-medium border-b-2 border-emerald-500 text-emerald-400 transition">Invite People</button>
          <button id="tt-share-tab-link" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition">Shareable Link</button>
          <button id="tt-share-tab-requests" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition flex items-center gap-1.5">
            <span>Access Requests</span>
            <span id="tt-share-req-badge" class="hidden px-1.5 py-0.2 rounded-full text-xs font-bold bg-amber-500 text-slate-950">0</span>
          </button>
        </div>

        <!-- Body / Tab Content -->
        <div class="p-6 max-h-[60vh] overflow-y-auto space-y-6">
          <!-- Tab 1: Invite People -->
          <div id="tt-share-pane-invite" class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-slate-400 mb-1.5">Select Faculty or Department</label>
              <div class="relative">
                <input type="text" id="tt-invite-search" placeholder="Type staff name or department..." class="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition">
                <div id="tt-invite-dropdown" class="hidden absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-xl bg-slate-800 border border-slate-700 shadow-xl z-20"></div>
              </div>
              <input type="hidden" id="tt-invite-user-id" value="">
              <input type="hidden" id="tt-invite-dept-id" value="">
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-medium text-slate-400 mb-1.5">Access Role</label>
                <select id="tt-invite-level" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-emerald-500 transition">
                  <option value="viewer">Viewer (Read-only, export)</option>
                  <option value="commenter">Commenter (View & add comments)</option>
                  <option value="editor-full">Editor - Full (Edit all slots)</option>
                  <option value="editor-fill">Editor - Fill-Only (Scoped fill slots)</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-400 mb-1.5">Optional Expiration</label>
                <input type="date" id="tt-invite-expiry" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-emerald-500 transition">
              </div>
            </div>

            <!-- Fill-Only Options (Conditional) -->
            <div id="tt-invite-fill-opts" class="hidden p-3 rounded-xl bg-slate-800/70 border border-slate-700/60 space-y-2">
              <div class="text-xs font-medium text-slate-300">Fill-Only Permissions:</div>
              <div class="flex items-center gap-4 text-xs text-slate-300">
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" id="tt-fill-staff" checked class="rounded border-slate-700 text-emerald-500"> Can assign Staff
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" id="tt-fill-subject" checked class="rounded border-slate-700 text-emerald-500"> Can assign Subject
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" id="tt-fill-room" class="rounded border-slate-700 text-emerald-500"> Can assign Room
                </label>
              </div>
            </div>

            <div class="flex justify-end pt-2">
              <button id="tt-send-invite-btn" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition flex items-center gap-2 shadow-lg shadow-emerald-900/30">
                <span>Send Invitation</span>
              </button>
            </div>
          </div>

          <!-- Tab 2: Shareable Link -->
          <div id="tt-share-pane-link" class="hidden space-y-5">
            <div class="flex items-center justify-between p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/70">
              <div>
                <div class="font-medium text-sm text-white">Enable Shareable Link</div>
                <div class="text-xs text-slate-400">Anyone at EAMS with this link can access according to role</div>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="tt-link-toggle" class="sr-only peer">
                <div class="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>

            <div>
              <label class="block text-xs font-medium text-slate-400 mb-1.5">Link Permission Level</label>
              <select id="tt-link-level" class="w-full px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-emerald-500 transition">
                <option value="viewer">Viewer (Immediate Access)</option>
                <option value="commenter">Commenter (Immediate Access)</option>
                <option value="editor">Editor (Requires Owner Approval)</option>
              </select>
            </div>

            <div>
              <label class="block text-xs font-medium text-slate-400 mb-1.5">Shareable URL</label>
              <div class="flex items-center gap-2">
                <input type="text" id="tt-link-url" readonly class="w-full px-3.5 py-2 font-mono text-xs rounded-xl bg-slate-950 border border-slate-800 text-emerald-400 select-all focus:outline-none">
                <button id="tt-copy-link-btn" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium border border-slate-700 transition flex items-center gap-1.5 shrink-0">
                  <span>Copy Link</span>
                </button>
              </div>
            </div>

            <!-- Danger Zone: Reset Link -->
            <div class="pt-3 border-t border-slate-800/80 flex items-center justify-between">
              <div>
                <div class="text-xs font-semibold text-rose-400">Reset Share Link</div>
                <div class="text-xs text-slate-500">Incrementing epoch immediately invalidates all previously generated URLs.</div>
              </div>
              <button id="tt-reset-link-btn" class="px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-medium transition">
                Reset Link
              </button>
            </div>
          </div>

          <!-- Tab 3: Access Requests -->
          <div id="tt-share-pane-requests" class="hidden space-y-3">
            <div id="tt-requests-list" class="space-y-2">
              <div class="text-center py-6 text-slate-500 text-xs">Loading requests...</div>
            </div>
          </div>

          <!-- Active Collaborators Table -->
          <div class="pt-4 border-t border-slate-800">
            <div class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">People with Access</div>
            <div id="tt-collaborators-list" class="divide-y divide-slate-800/80 max-h-40 overflow-y-auto">
              <div class="py-3 text-center text-xs text-slate-500">Loading collaborators...</div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    activeModal = modal;

    // Attach event listeners
    modal.querySelector('#tt-share-close-btn').addEventListener('click', closeShareModal);

    // Tab switching
    const tabInvite = modal.querySelector('#tt-share-tab-invite');
    const tabLink = modal.querySelector('#tt-share-tab-link');
    const tabReqs = modal.querySelector('#tt-share-tab-requests');
    const paneInvite = modal.querySelector('#tt-share-pane-invite');
    const paneLink = modal.querySelector('#tt-share-pane-link');
    const paneReqs = modal.querySelector('#tt-share-pane-requests');

    function switchTab(activeTab, activePane) {
      [tabInvite, tabLink, tabReqs].forEach(t => {
        t.classList.remove('border-emerald-500', 'text-emerald-400');
        t.classList.add('border-transparent', 'text-slate-400');
      });
      [paneInvite, paneLink, paneReqs].forEach(p => p.classList.add('hidden'));

      activeTab.classList.remove('border-transparent', 'text-slate-400');
      activeTab.classList.add('border-emerald-500', 'text-emerald-400');
      activePane.classList.remove('hidden');
    }

    tabInvite.addEventListener('click', () => switchTab(tabInvite, paneInvite));
    tabLink.addEventListener('click', () => switchTab(tabLink, paneLink));
    tabReqs.addEventListener('click', () => switchTab(tabReqs, paneReqs));

    // Fill-only options toggle
    const selectLevel = modal.querySelector('#tt-invite-level');
    const fillOpts = modal.querySelector('#tt-invite-fill-opts');
    selectLevel.addEventListener('change', () => {
      if (selectLevel.value === 'editor-fill') {
        fillOpts.classList.remove('hidden');
      } else {
        fillOpts.classList.add('hidden');
      }
    });

    // Copy Link button
    modal.querySelector('#tt-copy-link-btn').addEventListener('click', () => {
      const urlInput = modal.querySelector('#tt-link-url');
      urlInput.select();
      navigator.clipboard.writeText(urlInput.value).then(() => {
        if (window.toast) window.toast.success('Link copied to clipboard!');
      });
    });

    // Fetch initial link & share state
    await loadWorkspaceLink(wsId, modal);
    await loadCollaborators(wsId, modal);
    await loadAccessRequests(wsId, modal);

    // Link settings handlers
    const toggle = modal.querySelector('#tt-link-toggle');
    const linkLevel = modal.querySelector('#tt-link-level');
    async function updateLinkSettings() {
      try {
        const res = await fetch(`/api/timetable/workspaces/${wsId}/link`, {
          method: 'PUT',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            enabled: toggle.checked,
            level: linkLevel.value
          })
        });
        const data = await res.json();
        if (data.ok) {
          modal.querySelector('#tt-link-url').value = `${window.location.origin}/timetable/by-code/${data.code}`;
          if (window.toast) window.toast.success('Link settings updated');
        }
      } catch (err) {
        if (window.toast) window.toast.error('Failed to update link: ' + err.message);
      }
    }
    toggle.addEventListener('change', updateLinkSettings);
    linkLevel.addEventListener('change', updateLinkSettings);

    // Reset Link handler
    modal.querySelector('#tt-reset-link-btn').addEventListener('click', async () => {
      if (!confirm('Are you sure you want to reset this share link? All old links will immediately stop working.')) return;
      try {
        const res = await fetch(`/api/timetable/workspaces/${wsId}/link/reset`, {
          method: 'POST',
          headers: getAuthHeaders()
        });
        const data = await res.json();
        if (data.ok) {
          modal.querySelector('#tt-link-url').value = `${window.location.origin}/timetable/by-code/${data.code}`;
          if (window.toast) window.toast.success('Link reset! Old links are now invalid.');
        }
      } catch (err) {
        if (window.toast) window.toast.error('Failed to reset link: ' + err.message);
      }
    });

    // Send Invite handler
    modal.querySelector('#tt-send-invite-btn').addEventListener('click', async () => {
      const userId = modal.querySelector('#tt-invite-user-id').value;
      const deptId = modal.querySelector('#tt-invite-dept-id').value;
      const levelVal = selectLevel.value;
      const expiry = modal.querySelector('#tt-invite-expiry').value;

      if (!userId && !deptId) {
        if (window.toast) window.toast.error('Please select a staff member or department');
        return;
      }

      const isFill = levelVal === 'editor-fill';
      const level = levelVal.startsWith('editor') ? 'editor' : levelVal;
      const editorMode = isFill ? 'fill' : 'full';

      try {
        const res = await fetch(`/api/timetable/workspaces/${wsId}/shares`, {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            userId: userId || null,
            toDeptId: deptId || null,
            level,
            editorMode,
            fill: isFill ? {
              staff: modal.querySelector('#tt-fill-staff').checked,
              subject: modal.querySelector('#tt-fill-subject').checked,
              room: modal.querySelector('#tt-fill-room').checked
            } : {},
            expiresAt: expiry || null
          })
        });
        const data = await res.json();
        if (data.ok) {
          if (window.toast) window.toast.success('Collaborator invited successfully!');
          modal.querySelector('#tt-invite-search').value = '';
          modal.querySelector('#tt-invite-user-id').value = '';
          modal.querySelector('#tt-invite-dept-id').value = '';
          await loadCollaborators(wsId, modal);
        } else {
          if (window.toast) window.toast.error(data.error || 'Failed to send invite');
        }
      } catch (err) {
        if (window.toast) window.toast.error(err.message);
      }
    });

    // Simple autocomplete for staff
    setupStaffSearch(modal);
  }

  function closeShareModal() {
    if (activeModal) {
      activeModal.remove();
      activeModal = null;
    }
  }

  async function loadWorkspaceLink(wsId, modal) {
    try {
      const res = await fetch(`/api/timetable/workspaces/${wsId}/link`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (data.ok && data.link) {
        modal.querySelector('#tt-link-toggle').checked = Boolean(data.link.enabled);
        modal.querySelector('#tt-link-level').value = data.link.level || 'viewer';
        modal.querySelector('#tt-link-url').value = `${window.location.origin}/timetable/by-code/${data.link.code}`;
      }
    } catch (_) {}
  }

  async function loadCollaborators(wsId, modal) {
    const listEl = modal.querySelector('#tt-collaborators-list');
    try {
      const res = await fetch(`/api/timetable/workspaces/${wsId}/shares`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      const shares = data.shares || [];

      if (!shares.length) {
        listEl.innerHTML = '<div class="py-3 text-center text-xs text-slate-500">No external collaborators yet.</div>';
        return;
      }

      listEl.innerHTML = shares.map(s => {
        const name = s.userName || s.toDeptName || 'Collaborator';
        const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        const roleLabel = s.editorMode === 'fill' ? 'Editor (Fill-Only)' : (s.level.charAt(0).toUpperCase() + s.level.slice(1));
        return `
          <div class="py-2.5 flex items-center justify-between text-xs">
            <div class="flex items-center gap-2.5">
              <div class="w-7 h-7 rounded-full bg-slate-800 text-emerald-400 border border-slate-700 flex items-center justify-center font-bold text-[10px]">
                ${initials}
              </div>
              <div>
                <div class="font-medium text-white">${escapeHtml(name)}</div>
                <div class="text-[11px] text-slate-400">${escapeHtml(s.userDeptName || s.toDeptName || '')}</div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 text-[11px]">${roleLabel}</span>
              <button onclick="window.TimetableShare.revokeShare('${wsId}', '${s._id}')" class="p-1 rounded text-slate-500 hover:text-rose-400 transition" title="Remove access">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </div>
        `;
      }).join('');
    } catch (_) {
      listEl.innerHTML = '<div class="py-3 text-center text-xs text-rose-400">Failed to load collaborators</div>';
    }
  }

  async function loadAccessRequests(wsId, modal) {
    const listEl = modal.querySelector('#tt-requests-list');
    const badgeEl = modal.querySelector('#tt-share-req-badge');
    try {
      const res = await fetch(`/api/timetable/workspaces/${wsId}/access-requests`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      const reqs = (data.requests || []).filter(r => r.status === 'pending');

      if (reqs.length > 0) {
        badgeEl.textContent = reqs.length;
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.classList.add('hidden');
      }

      if (!reqs.length) {
        listEl.innerHTML = '<div class="py-6 text-center text-xs text-slate-500">No pending access requests.</div>';
        return;
      }

      listEl.innerHTML = reqs.map(r => `
        <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-between text-xs">
          <div>
            <div class="font-medium text-white">${escapeHtml(r.requesterName)}</div>
            <div class="text-[11px] text-slate-400">Requested: ${escapeHtml(r.requestedLevel)} · via share link</div>
          </div>
          <div class="flex items-center gap-1.5">
            <button onclick="window.TimetableShare.decideRequest('${wsId}', '${r._id}', 'approve')" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition">Approve</button>
            <button onclick="window.TimetableShare.decideRequest('${wsId}', '${r._id}', 'decline')" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-slate-700 text-xs transition">Decline</button>
          </div>
        </div>
      `).join('');
    } catch (_) {
      listEl.innerHTML = '<div class="py-3 text-center text-xs text-rose-400">Failed to load requests</div>';
    }
  }

  function setupStaffSearch(modal) {
    const searchInput = modal.querySelector('#tt-invite-search');
    const drop = modal.querySelector('#tt-invite-dropdown');
    let debounceTimer = null;

    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = searchInput.value.trim();
      if (!q || q.length < 2) {
        drop.classList.add('hidden');
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/teachers?q=${encodeURIComponent(q)}`, {
            headers: getAuthHeaders()
          });
          const data = await res.json();
          const teachers = data.teachers || data.data || [];

          if (!teachers.length) {
            drop.innerHTML = '<div class="p-3 text-center text-xs text-slate-400">No staff found</div>';
            drop.classList.remove('hidden');
            return;
          }

          drop.innerHTML = teachers.slice(0, 8).map(t => `
            <div class="px-3.5 py-2 hover:bg-slate-700/60 cursor-pointer text-xs flex items-center justify-between" data-id="${t._id}" data-name="${escapeHtml(t.name)}">
              <span class="font-medium text-white">${escapeHtml(t.name)}</span>
              <span class="text-slate-400 text-[11px]">${escapeHtml(t.department || t.deptName || '')}</span>
            </div>
          `).join('');

          drop.querySelectorAll('[data-id]').forEach(item => {
            item.addEventListener('click', () => {
              searchInput.value = item.getAttribute('data-name');
              modal.querySelector('#tt-invite-user-id').value = item.getAttribute('data-id');
              drop.classList.add('hidden');
            });
          });

          drop.classList.remove('hidden');
        } catch (_) {}
      }, 250);
    });
  }

  // ── Threaded Slot Comments Popover ──

  async function openSlotComments(classId, slotKey, draftId = null) {
    const wsId = currentWorkspaceId;
    if (!wsId) return;

    let container = document.getElementById('tt-comments-popover');
    if (container) container.remove();

    container = document.createElement('div');
    container.id = 'tt-comments-popover';
    container.className = 'fixed right-6 bottom-6 w-96 max-h-[75vh] flex flex-col bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden z-50 text-slate-100 animate-slide-up';

    container.innerHTML = `
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/90">
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono font-bold text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30">${escapeHtml(slotKey)}</span>
          <span class="text-xs font-semibold text-white">Discussion</span>
        </div>
        <button id="tt-comment-close-btn" class="p-1 text-slate-400 hover:text-white rounded">✕</button>
      </div>

      <div id="tt-comment-threads" class="p-4 flex-1 overflow-y-auto space-y-3 divide-y divide-slate-800/60">
        <div class="text-center py-6 text-xs text-slate-500">Loading comments...</div>
      </div>

      <div class="p-3 border-t border-slate-800 bg-slate-950/60">
        <div class="relative">
          <textarea id="tt-new-comment-body" rows="2" placeholder="Write a comment... (@mention staff)" class="w-full px-3 py-2 text-xs rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition resize-none"></textarea>
          <div class="flex justify-end mt-2">
            <button id="tt-post-comment-btn" class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition shadow-md shadow-emerald-900/30">
              Post Comment
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    container.querySelector('#tt-comment-close-btn').addEventListener('click', () => container.remove());

    await loadSlotComments(wsId, classId, slotKey, draftId, container);

    container.querySelector('#tt-post-comment-btn').addEventListener('click', async () => {
      const body = container.querySelector('#tt-new-comment-body').value.trim();
      if (!body) return;

      try {
        const res = await fetch(`/api/timetable/workspaces/${wsId}/comments`, {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            draftId,
            anchor: {
              type: 'slot',
              classId,
              slotKey
            },
            body
          })
        });
        const data = await res.json();
        if (data.ok) {
          container.querySelector('#tt-new-comment-body').value = '';
          await loadSlotComments(wsId, classId, slotKey, draftId, container);
        } else {
          if (window.toast) window.toast.error(data.error || 'Failed to post comment');
        }
      } catch (err) {
        if (window.toast) window.toast.error(err.message);
      }
    });
  }

  async function loadSlotComments(wsId, classId, slotKey, draftId, container) {
    const listEl = container.querySelector('#tt-comment-threads');
    try {
      const url = `/api/timetable/workspaces/${wsId}/comments?classId=${classId}&slotKey=${slotKey}${draftId ? '&draftId=' + draftId : ''}`;
      const res = await fetch(url, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      const comments = data.comments || [];

      if (!comments.length) {
        listEl.innerHTML = '<div class="py-6 text-center text-xs text-slate-500">No comments on this slot yet. Start the conversation!</div>';
        return;
      }

      listEl.innerHTML = comments.map(c => `
        <div class="pt-3 first:pt-0 space-y-1.5 text-xs">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-slate-200">${escapeHtml(c.authorName)}</span>
            <span class="text-[10px] text-slate-500">${new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          <!-- C20 Slot Contents Changed Warning Badge -->
          ${c.slotChanged ? `
            <div class="px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[11px] flex items-center gap-1.5">
              <span>⚠️</span>
              <span>Slot contents changed since this comment was posted</span>
            </div>
          ` : ''}

          <div class="text-slate-300 leading-relaxed">${c.body}</div>

          <div class="flex items-center justify-between pt-1">
            <span class="text-[10px] ${c.status === 'resolved' ? 'text-emerald-400' : 'text-slate-500'}">
              ${c.status === 'resolved' ? '✓ Resolved' : 'Open'}
            </span>
            ${c.status !== 'resolved' ? `
              <button onclick="window.TimetableShare.resolveComment('${wsId}', '${c._id}')" class="text-[11px] text-slate-400 hover:text-emerald-400 transition">
                Resolve Thread
              </button>
            ` : ''}
          </div>
        </div>
      `).join('');
    } catch (_) {
      listEl.innerHTML = '<div class="py-4 text-center text-xs text-rose-400">Failed to load comments</div>';
    }
  }

  // ── Real-Time Presence WebSocket Client (/ws/timetable) ──

  function initPresence(draftId, userId, userName) {
    if (!draftId) return;
    if (activePresenceSocket) {
      activePresenceSocket.close();
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/timetable`;

    try {
      const socket = new WebSocket(wsUrl);
      activePresenceSocket = socket;

      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({
          type: 'JOIN_DRAFT',
          draftId,
          userId,
          userName
        }));
      });

      socket.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          handlePresenceMessage(msg);
        } catch (_) {}
      });

      socket.addEventListener('close', () => {
        activePresenceSocket = null;
      });
    } catch (_) {}
  }

  function handlePresenceMessage(msg) {
    switch (msg.type) {
      case 'SLOT_HELD': {
        const slotEl = document.querySelector(`[data-slot-key="${msg.slotKey}"]`);
        if (slotEl) {
          slotEl.classList.add('presence-held-slot');
          let pill = slotEl.querySelector('.presence-pill');
          if (!pill) {
            pill = document.createElement('div');
            pill.className = 'presence-pill absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500 text-slate-950 shadow-md animate-pulse';
            slotEl.appendChild(pill);
          }
          pill.textContent = (msg.userName || 'Peer').slice(0, 6);
        }
        break;
      }

      case 'SLOT_RELEASED': {
        const slotEl = document.querySelector(`[data-slot-key="${msg.slotKey}"]`);
        if (slotEl) {
          slotEl.classList.remove('presence-held-slot');
          const pill = slotEl.querySelector('.presence-pill');
          if (pill) pill.remove();
        }
        break;
      }

      case 'ACCESS_REVOKED': {
        if (window.toast) window.toast.error('Your access to this workspace was revoked by the coordinator.');
        setTimeout(() => {
          window.location.href = '/timetable';
        }, 1500);
        break;
      }

      case 'OP_BROADCAST': {
        if (window.toast) window.toast.info('New timetable edits synced from peer');
        // Dispatch custom event for timetable page to refresh or re-render
        window.dispatchEvent(new CustomEvent('timetable:peer-op', { detail: msg }));
        break;
      }

      default:
        break;
    }
  }

  function notifySlotFocus(draftId, classId, slotKey) {
    if (activePresenceSocket && activePresenceSocket.readyState === WebSocket.OPEN) {
      activePresenceSocket.send(JSON.stringify({
        type: 'USER_EDITING_SLOT',
        draftId,
        classId,
        slotKey
      }));
    }
  }

  function notifySlotBlur(draftId, classId, slotKey) {
    if (activePresenceSocket && activePresenceSocket.readyState === WebSocket.OPEN) {
      activePresenceSocket.send(JSON.stringify({
        type: 'USER_LEFT_SLOT',
        draftId,
        classId,
        slotKey
      }));
    }
  }

  // Global methods
  window.TimetableShare = {
    open: openShareModal,
    close: closeShareModal,
    openComments: openSlotComments,
    initPresence,
    notifySlotFocus,
    notifySlotBlur,

    async revokeShare(wsId, shareId) {
      if (!confirm('Are you sure you want to remove access for this collaborator?')) return;
      try {
        const res = await fetch(`/api/timetable/workspaces/${wsId}/shares/${shareId}/revoke`, {
          method: 'POST',
          headers: getAuthHeaders()
        });
        const data = await res.json();
        if (data.ok) {
          if (window.toast) window.toast.success('Access revoked');
          if (activeModal) await loadCollaborators(wsId, activeModal);
        }
      } catch (err) {
        if (window.toast) window.toast.error(err.message);
      }
    },

    async decideRequest(wsId, reqId, decision) {
      try {
        const res = await fetch(`/api/timetable/workspaces/${wsId}/access-requests/${reqId}/decide`, {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ decision })
        });
        const data = await res.json();
        if (data.ok) {
          if (window.toast) window.toast.success(`Request ${decision}d`);
          if (activeModal) {
            await loadAccessRequests(wsId, activeModal);
            await loadCollaborators(wsId, activeModal);
          }
        }
      } catch (err) {
        if (window.toast) window.toast.error(err.message);
      }
    },

    async resolveComment(wsId, commentId) {
      try {
        const res = await fetch(`/api/timetable/workspaces/${wsId}/comments/${commentId}/resolve`, {
          method: 'PATCH',
          headers: getAuthHeaders()
        });
        const data = await res.json();
        if (data.ok) {
          const popover = document.getElementById('tt-comments-popover');
          if (popover) {
            const slotKey = popover.querySelector('.font-mono')?.textContent;
            if (slotKey) await loadSlotComments(wsId, null, slotKey, null, popover);
          }
        }
      } catch (err) {
        if (window.toast) window.toast.error(err.message);
      }
    }
  };

})(window);
