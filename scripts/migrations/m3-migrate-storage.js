'use strict';
const fs = require('fs');

// 1. Update tabWorkspace.js
let tw = fs.readFileSync('public/js/core/tabWorkspace.js', 'utf8');

const oldBlock = `    // ── Session Storage Persistence ──
    _saveSession() {
      try {
        const serialized = {
          activeTabId: this.activeTabId,
          isSplit: this.isSplit,
          splitMode: this.splitMode,
          secondaryTabId: this.secondaryTabId,
          splitRatio: this.splitRatio,
          tabs: Array.from(this.tabs.values())
            .filter(t => t.id === 'main-matrix' || t.viewType === 'matrix-launcher' || t.viewType === 'section' || String(t.id).startsWith('section:'))
            .map(t => ({
              id: t.id,
              title: t.title,
              icon: t.icon,
              viewType: t.viewType,
              viewParams: t.viewParams,
              isPinned: t.isPinned,
              mode: t.mode
            }))
        };
        sessionStorage.setItem('eams_tt_workspace', JSON.stringify(serialized));
      } catch (err) {
        console.warn('[TabWorkspace] Unable to persist session state:', err);
      }
    }

    /**
     * Restores tabs from sessionStorage.
     * Takes an optional asynchronous revalidateDraftFn(tab) to check if server draft still exists.
     */
    async restoreSession(revalidateDraftFn) {
      try {
        const raw = sessionStorage.getItem('eams_tt_workspace');
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.tabs) || !data.tabs.length) return false;

        const validTabs = data.tabs.filter(item => item.id === 'main-matrix' || item.viewType === 'matrix-launcher' || item.viewType === 'section' || String(item.id).startsWith('section:'));
        for (const item of validTabs) {
          let verifiedMode = item.mode || 'production';
          if (item.viewType === 'section' && typeof revalidateDraftFn === 'function') {
            try {
              const hasDraft = await revalidateDraftFn(item);
              if (!hasDraft && verifiedMode === 'development') {
                verifiedMode = 'production'; // Reconcile stale mode
              }
            } catch {
              verifiedMode = 'production';
            }
          }

          this.openTab({
            id: item.id,
            title: item.title,
            icon: item.icon,
            viewType: item.viewType || (item.id === 'main-matrix' ? 'matrix-launcher' : 'section'),
            viewParams: item.viewParams,
            isPinned: item.isPinned,
            mode: verifiedMode,
            activate: false
          });
        }

        if (data.activeTabId && this.tabs.has(data.activeTabId)) {
          this.activateTab(data.activeTabId);
        } else if (this.tabs.size > 0) {
          const firstId = this.tabs.keys().next().value;
          this.activateTab(firstId);
        }

        // Restore split mode if previously active
        if (data.isSplit && data.secondaryTabId && this.tabs.has(data.secondaryTabId)) {
          this.splitMode = data.splitMode || 'vertical';
          this.splitRatio = data.splitRatio || 0.5;
          this.toggleSplit(data.secondaryTabId);
        }

        return true;
      } catch (err) {
        console.error('[TabWorkspace] Error restoring session:', err);
        return false;
      }
    }`;

const newBlock = `    // ── Database User State Persistence (Z7 / Phase 2) ──
    _saveSession() {
      try {
        if (typeof window.syncUserStateToDb === 'function') {
          window.syncUserStateToDb();
        }
      } catch (err) {
        console.warn('[TabWorkspace] Unable to persist user state:', err);
      }
    }

    serializeTabs() {
      return Array.from(this.tabs.values())
        .filter(t => t && t.id && t.id !== 'main-matrix')
        .map(t => ({
          id: t.id,
          title: t.title,
          icon: t.icon,
          viewType: t.viewType || 'section',
          viewParams: t.viewParams,
          classId: t.viewParams?.classId || null,
          isPinned: Boolean(t.isPinned),
          mode: t.mode || 'production'
        }));
    }

    /**
     * Restores tabs from database TimetableUserState (Z7).
     * Takes an optional asynchronous revalidateDraftFn(tab) to check if server draft still exists.
     */
    async restoreSession(revalidateDraftFn) {
      try {
        let tabsData = [];
        try {
          const token = (typeof getToken === 'function' ? getToken() : null) || (window.sessionStorage ? (sessionStorage.getItem('eams_token') || sessionStorage.getItem('token')) : null);
          const res = await fetch('/api/timetable/user-state', {
            headers: token ? { 'Authorization': 'Bearer ' + token } : {}
          });
          if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.openTabs)) {
              tabsData = data.openTabs;
            }
          }
        } catch (_) {}

        if (!tabsData || !tabsData.length) return false;

        const validTabs = tabsData.filter(item => item.id === 'main-matrix' || item.viewType === 'matrix-launcher' || item.viewType === 'section' || String(item.id).startsWith('section:'));
        for (const item of validTabs) {
          let verifiedMode = item.mode || 'production';
          if (item.viewType === 'section' && typeof revalidateDraftFn === 'function') {
            try {
              const hasDraft = await revalidateDraftFn(item);
              if (!hasDraft && verifiedMode === 'development') {
                verifiedMode = 'production'; // Reconcile stale mode
              }
            } catch {
              verifiedMode = 'production';
            }
          }

          this.openTab({
            id: item.id,
            title: item.title || item.id,
            icon: item.icon,
            viewType: item.viewType || (item.id === 'main-matrix' ? 'matrix-launcher' : 'section'),
            viewParams: item.viewParams || (item.classId ? { classId: item.classId } : {}),
            isPinned: Boolean(item.isPinned),
            mode: verifiedMode,
            activate: false
          });
        }

        if (this.tabs.size > 0) {
          const firstId = this.tabs.keys().next().value;
          this.activateTab(firstId);
        }

        return true;
      } catch (err) {
        console.error('[TabWorkspace] Error restoring user state:', err);
        return false;
      }
    }`;

const twNormalized = tw.replace(/\r\n/g, '\n');
const oldNormalized = oldBlock.replace(/\r\n/g, '\n');
const newNormalized = newBlock.replace(/\r\n/g, '\n');

if (twNormalized.includes(oldNormalized)) {
  fs.writeFileSync('public/js/core/tabWorkspace.js', twNormalized.replace(oldNormalized, newNormalized), 'utf8');
  console.log('[OK] tabWorkspace.js updated successfully!');
} else {
  console.error('[FAIL] tabWorkspace.js target block not found!');
}

// 2. Update timetable.page.js
let tp = fs.readFileSync('public/js/pages/timetable.page.js', 'utf8');
const tpNormalized = tp.replace(/\r\n/g, '\n');

let tpReplaced = tpNormalized.replace(
  "freezePanes: localStorage.getItem('tt_freeze_panes') !== 'false',",
  "freezePanes: true,"
);

tpReplaced = tpReplaced.replace(
  `function toggleFreezePanes() {
  state.freezePanes = !(state.freezePanes !== false);
  try {
    localStorage.setItem('tt_freeze_panes', state.freezePanes ? 'true' : 'false');
  } catch (e) {}`,
  `function toggleFreezePanes() {
  state.freezePanes = !(state.freezePanes !== false);
  if (typeof syncUserStateToDb === 'function') {
    syncUserStateToDb({ prefs: { freezePanes: state.freezePanes } });
  }`
);

tpReplaced = tpReplaced.replace(
  '// Revalidation helper for sessionStorage restore (§6.3)',
  '// Revalidation helper for database UserState restore (§6.3)'
);

tpReplaced = tpReplaced.replace(
  '// 2. Restore any persisted class tabs from sessionStorage',
  '// 2. Restore any persisted class tabs from database UserState'
);

// Append syncUserStateToDb helper if not present
if (!tpReplaced.includes('function syncUserStateToDb')) {
  const syncHelper = `
// ── Database User State Synchronization (Z7 / Phase 2) ──
let _userStateSyncTimer = null;
function syncUserStateToDb(partialState = {}) {
  clearTimeout(_userStateSyncTimer);
  _userStateSyncTimer = setTimeout(async () => {
    try {
      const token = (typeof getToken === 'function' ? getToken() : null) || (window.sessionStorage ? (sessionStorage.getItem('eams_token') || sessionStorage.getItem('token')) : null);
      const payload = {
        env: state.env || 'production',
        activeWorkspaceId: state.activeWorkspaceId || null,
        prefs: { freezePanes: state.freezePanes !== false },
        ...partialState
      };
      if (window.workspace && typeof window.workspace.serializeTabs === 'function') {
        payload.openTabs = window.workspace.serializeTabs();
      }
      await fetch('/api/timetable/user-state', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': 'Bearer ' + token } : {})
        },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.warn('[syncUserStateToDb] Warning:', err);
    }
  }, 1000);
}
window.syncUserStateToDb = syncUserStateToDb;

window.addEventListener('pagehide', () => {
  try {
    const token = (typeof getToken === 'function' ? getToken() : null) || (window.sessionStorage ? (sessionStorage.getItem('eams_token') || sessionStorage.getItem('token')) : null);
    const payload = {
      env: state.env || 'production',
      activeWorkspaceId: state.activeWorkspaceId || null,
      prefs: { freezePanes: state.freezePanes !== false }
    };
    if (window.workspace && typeof window.workspace.serializeTabs === 'function') {
      payload.openTabs = window.workspace.serializeTabs();
    }
    fetch('/api/timetable/user-state', {
      method: 'PUT',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      },
      body: JSON.stringify(payload)
    });
  } catch (_) {}
});
`;
  tpReplaced += syncHelper;
}

fs.writeFileSync('public/js/pages/timetable.page.js', tpReplaced, 'utf8');
console.log('[OK] timetable.page.js updated successfully!');
