/**
 * EAMS · Timetable Scratchpad & Slot Clipboard Module (Win + V System)
 * ═══════════════════════════════════════════════════════════════════════
 * Global floating dock & multi-area notepad + slot stash + clipboard history.
 * Scoped per logged-in user, accessible across all class sections.
 * Hybrid local-first storage + debounced background server sync.
 * ═══════════════════════════════════════════════════════════════════════
 */
(function (global) {
  'use strict';

  var syncDebounceTimer = null;
  var SYNC_DELAY_MS = 800;

  var state = {
    isOpen: false,
    isDocked: false,
    activeTab: 'notes', // 'notes' | 'stash' | 'clipboard'
    notes: [
      {
        id: 'note_default',
        title: 'General Notes',
        content: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    activeNoteId: 'note_default',
    savedSlots: [],
    clipboardHistory: [],
    focusedCell: null, // { day, period, section }
    searchQuery: ''
  };

  function getUserId() {
    try {
      if (typeof getUser === 'function') {
        var u = getUser();
        if (u) return String(u._id || u.id || u.username || 'user');
      }
      var stored = sessionStorage.getItem('eams_user');
      if (stored) {
        var parsed = JSON.parse(stored);
        return String(parsed._id || parsed.id || parsed.username || 'user');
      }
    } catch (e) {}
    return 'default_user';
  }

  function getStorageKey() {
    return 'eams_tt_scratchpad_' + getUserId();
  }

  function uid(prefix) {
    return (prefix || 'item') + '_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
  }

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function timeAgo(dateInput) {
    if (!dateInput) return '';
    var d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    var diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diffSec < 45) return 'Just now';
    var diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + 'm ago';
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    var diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return diffDay + 'd ago';
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  }

  /* ── 1. Hybrid Persistence Engine ─────────────────────────────────── */
  function loadLocalState() {
    try {
      var raw = localStorage.getItem(getStorageKey());
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed.notes) && parsed.notes.length) state.notes = parsed.notes;
        if (parsed.activeNoteId) state.activeNoteId = parsed.activeNoteId;
        if (Array.isArray(parsed.savedSlots)) state.savedSlots = parsed.savedSlots;
        if (Array.isArray(parsed.clipboardHistory)) state.clipboardHistory = parsed.clipboardHistory;
        if (parsed.isDocked !== undefined) state.isDocked = Boolean(parsed.isDocked);
      }
    } catch (err) {
      console.warn('[TimetableScratchpad] Error reading local state:', err);
    }
  }

  function saveLocalState() {
    try {
      var payload = {
        notes: state.notes,
        activeNoteId: state.activeNoteId,
        savedSlots: state.savedSlots,
        clipboardHistory: state.clipboardHistory,
        isDocked: state.isDocked,
        updatedAt: Date.now()
      };
      localStorage.setItem(getStorageKey(), JSON.stringify(payload));
      updateFabBadge();
    } catch (err) {
      console.warn('[TimetableScratchpad] Error saving local state:', err);
    }
  }

  function queueServerSync() {
    saveLocalState();
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(function () {
      if (typeof apiCall !== 'function') return;
      apiCall('PUT', '/timetable/user-scratchpad', {
        notes: state.notes,
        savedSlots: state.savedSlots,
        clipboardHistory: state.clipboardHistory,
        activeNoteId: state.activeNoteId
      }).catch(function (err) {
        console.warn('[TimetableScratchpad] Background sync warning:', err.message);
      });
    }, SYNC_DELAY_MS);
  }

  function fetchServerState() {
    if (typeof apiCall !== 'function') return;
    apiCall('GET', '/timetable/user-scratchpad')
      .then(function (res) {
        if (res && res.ok && res.data) {
          var s = res.data;
          var hasServerData = (Array.isArray(s.notes) && s.notes.length > 0) ||
                              (Array.isArray(s.savedSlots) && s.savedSlots.length > 0) ||
                              (Array.isArray(s.clipboardHistory) && s.clipboardHistory.length > 0);
          if (hasServerData) {
            if (Array.isArray(s.notes) && s.notes.length) state.notes = s.notes;
            if (s.activeNoteId) state.activeNoteId = s.activeNoteId;
            if (Array.isArray(s.savedSlots)) state.savedSlots = s.savedSlots;
            if (Array.isArray(s.clipboardHistory)) state.clipboardHistory = s.clipboardHistory;
            saveLocalState();
            renderActiveTabContent();
            updateTabBadges();
          }
        }
      })
      .catch(function (err) {
        console.warn('[TimetableScratchpad] Could not fetch server scratchpad:', err.message);
      });
  }

  /* ── 2. DOM Rendering & Template Construction ──────────────────────── */
  function mountDOM() {
    if (document.getElementById('tt-scratchpad-fab')) return;

    // 1. Fixed FAB
    var fab = document.createElement('button');
    fab.type = 'button';
    fab.id = 'tt-scratchpad-fab';
    fab.className = 'tt-scratchpad-fab';
    fab.setAttribute('aria-label', 'Open Timetable Notes and Slot Clipboard');
    fab.setAttribute('title', 'Workspace Notes & Slot Clipboard');
    fab.innerHTML = [
      '<span class="fab-icon"><re-icon icon="clipboard-list" size="18"></re-icon></span>',
      '<span class="fab-badge" id="tt-fab-badge">0</span>'
    ].join('');
    fab.addEventListener('click', function () {
      toggleDrawer();
    });
    // Drag & drop slot directly onto FAB floating button
    fab.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      fab.classList.add('dragover');
    });
    fab.addEventListener('dragleave', function () {
      fab.classList.remove('dragover');
    });
    fab.addEventListener('drop', function (e) {
      e.preventDefault();
      fab.classList.remove('dragover');
      handleDropOnStash(e);
    });
    document.body.appendChild(fab);

    // 2. Backdrop Overlay
    var backdrop = document.createElement('div');
    backdrop.id = 'tt-scratchpad-backdrop';
    backdrop.className = 'tt-scratchpad-backdrop';
    backdrop.addEventListener('click', function () {
      if (!state.isDocked) closeDrawer();
    });
    document.body.appendChild(backdrop);

    // 3. Slide-out Drawer
    var drawer = document.createElement('aside');
    drawer.id = 'tt-scratchpad-drawer';
    drawer.className = 'tt-scratchpad-drawer';
    drawer.setAttribute('role', 'complementary');
    drawer.setAttribute('aria-label', 'Workspace Notes and Slot Clipboard');
    drawer.innerHTML = [
      '<div class="tt-drawer-hd">',
      '  <div class="tt-drawer-title-box">',
      '    <div class="tt-drawer-title"><re-icon icon="notebook" size="18"></re-icon> Workspace Scratchpad</div>',
      '    <div class="tt-drawer-scope"><re-icon icon="lock" size="12"></re-icon> Private to you · All Classes</div>',
      '  </div>',
      '  <div class="tt-drawer-actions">',
      '    <button type="button" class="tt-drawer-btn" id="tt-drawer-dock-btn" title="Toggle Dock Side-by-Side"><re-icon icon="layout" size="14"></re-icon></button>',
      '    <button type="button" class="tt-drawer-btn" id="tt-drawer-close-btn" title="Close Drawer" aria-label="Close dialog"><re-icon icon="x" size="16"></re-icon></button>',
      '  </div>',
      '</div>',
      '<div class="tt-drawer-tabs-bar" role="tablist">',
      '  <button type="button" class="tt-drawer-tab-btn active" data-tab="notes" role="tab" aria-selected="true"><re-icon icon="file-text" size="14"></re-icon> Notepad</button>',
      '  <button type="button" class="tt-drawer-tab-btn" data-tab="stash" role="tab" aria-selected="false"><re-icon icon="bookmark" size="14"></re-icon> Saved Slots <span class="tt-drawer-tab-badge" id="tt-stash-badge">0</span></button>',
      '  <button type="button" class="tt-drawer-tab-btn" data-tab="clipboard" role="tab" aria-selected="false"><re-icon icon="clipboard" size="14"></re-icon> Clipboard <span class="tt-drawer-tab-badge" id="tt-clip-badge">0</span></button>',
      '</div>',
      '<div class="tt-drawer-body">',
      '  <!-- TAB 1: NOTEPAD -->',
      '  <div class="tt-tab-pane active" id="tt-pane-notes">',
      '    <div class="tt-notes-doc-bar" id="tt-notes-doc-bar"></div>',
      '    <div class="tt-notes-editor-wrap">',
      '      <input type="text" class="tt-note-title-input" id="tt-note-title" placeholder="Note Title…">',
      '      <textarea class="tt-note-textarea" id="tt-note-textarea" placeholder="Type quick timetable notes, teacher substitution reminders, special room requirements, or draft plans here…"></textarea>',
      '    </div>',
      '    <div class="tt-notes-footer">',
      '      <span id="tt-note-stats">0 words · 0 chars</span>',
      '      <div class="tt-note-tools">',
      '        <button type="button" class="tt-note-tool-btn" id="tt-note-copy-btn"><re-icon icon="copy" size="12"></re-icon> Copy</button>',
      '        <button type="button" class="tt-note-tool-btn" id="tt-note-download-btn"><re-icon icon="download" size="12"></re-icon> Export</button>',
      '        <button type="button" class="tt-note-tool-btn" id="tt-note-clear-btn" style="color:#dc2626;"><re-icon icon="trash2" size="12"></re-icon> Clear</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <!-- TAB 2: SAVED SLOTS STASH -->',
      '  <div class="tt-tab-pane" id="tt-pane-stash">',
      '    <div class="tt-stash-dropzone" id="tt-stash-dropzone">',
      '      <re-icon icon="plus-circle" size="20"></re-icon>',
      '      <span>Drag any slot from timetable grid here to save</span>',
      '    </div>',
      '    <div class="tt-slot-list-controls">',
      '      <input type="text" class="tt-slot-search-input" id="tt-stash-search" placeholder="Search saved slots (subject, teacher, room)…">',
      '      <button type="button" class="tt-slot-clear-btn" id="tt-stash-clear-all" title="Clear all saved slots">Clear All</button>',
      '    </div>',
      '    <div class="tt-slot-card-feed" id="tt-stash-feed"></div>',
      '  </div>',
      '  <!-- TAB 3: CLIPBOARD HISTORY (Win + V) -->',
      '  <div class="tt-tab-pane" id="tt-pane-clipboard">',
      '    <div class="tt-slot-list-controls">',
      '      <span style="font-size:11.5px;color:var(--tmu,#557055);font-weight:600;" id="tt-clip-feed-count">Recent Copy History</span>',
      '      <button type="button" class="tt-slot-clear-btn" id="tt-clip-clear-all" title="Clear copy history">Clear History</button>',
      '    </div>',
      '    <div class="tt-slot-card-feed" id="tt-clip-feed"></div>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(drawer);

    bindDrawerEvents();
    renderActiveTabContent();
    updateTabBadges();
    updateFabBadge();
  }

  /* ── 3. Event Listeners ───────────────────────────────────────────── */
  function bindDrawerEvents() {
    var drawer = document.getElementById('tt-scratchpad-drawer');
    var closeBtn = document.getElementById('tt-drawer-close-btn');
    var dockBtn = document.getElementById('tt-drawer-dock-btn');

    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (dockBtn) {
      dockBtn.addEventListener('click', function () {
        state.isDocked = !state.isDocked;
        drawer.classList.toggle('docked', state.isDocked);
        var backdrop = document.getElementById('tt-scratchpad-backdrop');
        if (backdrop) backdrop.style.display = state.isDocked ? 'none' : 'block';
        dockBtn.title = state.isDocked ? 'Undock Drawer' : 'Toggle Dock Side-by-Side';
        dockBtn.style.color = state.isDocked ? 'var(--gD, #1b5e20)' : '';
        dockBtn.style.borderColor = state.isDocked ? 'var(--gM, #2e7d32)' : '';
        saveLocalState();
      });
    }

    // Allow dropping slot anywhere onto the Workspace Scratchpad drawer
    if (drawer) {
      drawer.addEventListener('dragover', function (e) {
        var types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
        if (types.includes('text/plain') || types.includes('application/json')) {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
          drawer.classList.add('drag-receiving');
        }
      });
      drawer.addEventListener('dragleave', function (e) {
        if (!drawer.contains(e.relatedTarget)) {
          drawer.classList.remove('drag-receiving');
        }
      });
      drawer.addEventListener('drop', function (e) {
        drawer.classList.remove('drag-receiving');
        if (!e.target.closest('#tt-stash-dropzone')) {
          e.preventDefault();
          handleDropOnStash(e);
          if (state.activeTab !== 'stash') {
            switchTab('stash');
          }
        }
      });
    }

    // Tab buttons
    var tabBtns = drawer.querySelectorAll('.tt-drawer-tab-btn');
    tabBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.dataset.tab);
      });
    });

    // Notepad interactions
    var titleInput = document.getElementById('tt-note-title');
    var textArea = document.getElementById('tt-note-textarea');
    if (titleInput) {
      titleInput.addEventListener('input', function () {
        var activeNote = getActiveNote();
        if (activeNote) {
          activeNote.title = titleInput.value.trim() || 'Untitled Note';
          activeNote.updatedAt = new Date().toISOString();
          renderNoteDocTabs();
          queueServerSync();
        }
      });
    }
    if (textArea) {
      textArea.addEventListener('input', function () {
        var activeNote = getActiveNote();
        if (activeNote) {
          activeNote.content = textArea.value;
          activeNote.updatedAt = new Date().toISOString();
          updateNoteStats(textArea.value);
          queueServerSync();
        }
      });
    }

    // Notepad toolbar buttons
    var copyNoteBtn = document.getElementById('tt-note-copy-btn');
    if (copyNoteBtn) {
      copyNoteBtn.addEventListener('click', function () {
        var note = getActiveNote();
        if (note && note.content) {
          navigator.clipboard.writeText(note.content).then(function () {
            toast('Note copied to clipboard!', 'success');
          });
        }
      });
    }
    var exportNoteBtn = document.getElementById('tt-note-download-btn');
    if (exportNoteBtn) {
      exportNoteBtn.addEventListener('click', function () {
        var note = getActiveNote();
        if (!note) return;
        var blob = new Blob([note.content || ''], { type: 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = (note.title || 'timetable-note').replace(/[^a-zA-Z0-9_-]/g, '_') + '.txt';
        a.click();
        URL.revokeObjectURL(url);
      });
    }
    var clearNoteBtn = document.getElementById('tt-note-clear-btn');
    if (clearNoteBtn) {
      clearNoteBtn.addEventListener('click', function () {
        var note = getActiveNote();
        if (note && note.content) {
          if (confirm('Clear all content from "' + (note.title || 'Untitled Note') + '"?')) {
            note.content = '';
            if (textArea) textArea.value = '';
            updateNoteStats('');
            queueServerSync();
            toast('Note cleared.', 'info');
          }
        }
      });
    }

    // Stash dropzone
    var dropzone = document.getElementById('tt-stash-dropzone');
    if (dropzone) {
      dropzone.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        dropzone.classList.add('dragover');
      });
      dropzone.addEventListener('dragleave', function () {
        dropzone.classList.remove('dragover');
      });
      dropzone.addEventListener('drop', function (e) {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        handleDropOnStash(e);
      });
    }

    // Global shortcut: Alt+V or Ctrl+Shift+V opens Scratchpad with Clipboard tab
    document.addEventListener('keydown', function (e) {
      if (((e.altKey && (e.key === 'v' || e.key === 'V')) || ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'v' || e.key === 'V'))) && !e.target.matches('input, textarea, select, [contenteditable="true"]')) {
        e.preventDefault();
        if (state.isOpen && state.activeTab === 'clipboard') {
          closeDrawer();
        } else {
          openDrawer('clipboard');
        }
      }
    });

    // Search input for stash
    var stashSearch = document.getElementById('tt-stash-search');
    if (stashSearch) {
      stashSearch.addEventListener('input', function () {
        state.searchQuery = stashSearch.value.trim().toLowerCase();
        renderStashFeed();
      });
    }

    // Clear all stash
    var clearStashBtn = document.getElementById('tt-stash-clear-all');
    if (clearStashBtn) {
      clearStashBtn.addEventListener('click', function () {
        if (!state.savedSlots.length) return;
        if (confirm('Clear all ' + state.savedSlots.length + ' saved slots from stash?')) {
          state.savedSlots = [];
          queueServerSync();
          renderStashFeed();
          updateTabBadges();
          toast('Saved slots stash cleared.', 'info');
        }
      });
    }

    // Clear all clipboard history
    var clearClipBtn = document.getElementById('tt-clip-clear-all');
    if (clearClipBtn) {
      clearClipBtn.addEventListener('click', function () {
        if (!state.clipboardHistory.length) return;
        if (confirm('Clear copy history?')) {
          state.clipboardHistory = [];
          queueServerSync();
          renderClipboardFeed();
          updateTabBadges();
          toast('Clipboard history cleared.', 'info');
        }
      });
    }
  }

  /* ── 4. Tab Switching & Open/Close ─────────────────────────────────── */
  function openDrawer(tab) {
    mountDOM();
    var drawer = document.getElementById('tt-scratchpad-drawer');
    var backdrop = document.getElementById('tt-scratchpad-backdrop');
    if (!drawer) return;

    state.isOpen = true;
    drawer.classList.add('open');
    if (!state.isDocked && backdrop) {
      backdrop.style.display = 'block';
      setTimeout(function () { backdrop.classList.add('open'); }, 10);
    }
    if (tab) switchTab(tab);
    else renderActiveTabContent();
  }

  function closeDrawer() {
    var drawer = document.getElementById('tt-scratchpad-drawer');
    var backdrop = document.getElementById('tt-scratchpad-backdrop');
    if (!drawer) return;

    state.isOpen = false;
    drawer.classList.remove('open');
    if (backdrop) {
      backdrop.classList.remove('open');
      setTimeout(function () {
        if (!state.isOpen) backdrop.style.display = 'none';
      }, 280);
    }
  }

  function toggleDrawer() {
    if (state.isOpen) closeDrawer();
    else openDrawer();
  }

  function switchTab(tabName) {
    if (!['notes', 'stash', 'clipboard'].includes(tabName)) tabName = 'notes';
    state.activeTab = tabName;

    var drawer = document.getElementById('tt-scratchpad-drawer');
    if (!drawer) return;

    drawer.querySelectorAll('.tt-drawer-tab-btn').forEach(function (btn) {
      var isAct = btn.dataset.tab === tabName;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-selected', isAct ? 'true' : 'false');
    });

    drawer.querySelectorAll('.tt-tab-pane').forEach(function (pane) {
      pane.classList.remove('active');
    });

    var targetPane = document.getElementById('tt-pane-' + tabName);
    if (targetPane) targetPane.classList.add('active');

    renderActiveTabContent();
  }

  function renderActiveTabContent() {
    if (state.activeTab === 'notes') {
      renderNoteDocTabs();
      loadActiveNoteContent();
    } else if (state.activeTab === 'stash') {
      renderStashFeed();
    } else if (state.activeTab === 'clipboard') {
      renderClipboardFeed();
    }
    updateTabBadges();
  }

  function updateTabBadges() {
    var stashBadge = document.getElementById('tt-stash-badge');
    var clipBadge = document.getElementById('tt-clip-badge');
    if (stashBadge) stashBadge.textContent = state.savedSlots.length;
    if (clipBadge) clipBadge.textContent = state.clipboardHistory.length;
    updateFabBadge();
  }

  function updateFabBadge() {
    var badge = document.getElementById('tt-fab-badge');
    if (!badge) return;
    var total = state.clipboardHistory.length + state.savedSlots.length;
    badge.textContent = total;
    badge.style.display = total > 0 ? 'inline-block' : 'none';
  }

  function bumpFabBadge() {
    var badge = document.getElementById('tt-fab-badge');
    if (badge) {
      badge.classList.remove('bump');
      void badge.offsetWidth; // trigger reflow
      badge.classList.add('bump');
    }
  }

  /* ── 5. Tab 1: Notepad Multi-File Management ──────────────────────── */
  function getActiveNote() {
    var note = state.notes.find(function (n) { return n.id === state.activeNoteId; });
    if (!note) {
      if (!state.notes.length) {
        state.notes.push({
          id: 'note_1',
          title: 'General Notes',
          content: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      state.activeNoteId = state.notes[0].id;
      note = state.notes[0];
    }
    return note;
  }

  function renderNoteDocTabs() {
    var container = document.getElementById('tt-notes-doc-bar');
    if (!container) return;

    var html = state.notes.map(function (note) {
      var isActive = note.id === state.activeNoteId;
      return [
        '<div class="tt-note-doc-tab ' + (isActive ? 'active' : '') + '" data-note-id="' + esc(note.id) + '" title="Double-click to rename">',
        '  <span>' + esc(note.title || 'Untitled') + '</span>',
        '  <span class="tt-note-tab-close" data-close-note="' + esc(note.id) + '" title="Close Note">×</span>',
        '</div>'
      ].join('');
    }).join('');

    html += '<button type="button" class="tt-note-add-btn" id="tt-note-new-btn" title="Create New Note Area"><re-icon icon="plus" size="12"></re-icon> New Note</button>';
    container.innerHTML = html;

    // Attach click events
    container.querySelectorAll('.tt-note-doc-tab').forEach(function (tabEl) {
      var noteId = tabEl.dataset.noteId;
      tabEl.addEventListener('click', function (e) {
        if (e.target.dataset.closeNote) return;
        state.activeNoteId = noteId;
        renderNoteDocTabs();
        loadActiveNoteContent();
        queueServerSync();
      });
      tabEl.addEventListener('dblclick', function () {
        promptRenameNote(noteId);
      });
    });

    container.querySelectorAll('[data-close-note]').forEach(function (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteNote(closeBtn.dataset.closeNote);
      });
    });

    var addBtn = document.getElementById('tt-note-new-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        createNewNote();
      });
    }
  }

  function createNewNote(customTitle) {
    var num = state.notes.length + 1;
    var newNote = {
      id: uid('note'),
      title: customTitle || ('Note ' + num),
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.notes.push(newNote);
    state.activeNoteId = newNote.id;
    renderNoteDocTabs();
    loadActiveNoteContent();
    queueServerSync();
    toast('New note area created.', 'success');
  }

  function deleteNote(noteId) {
    if (state.notes.length <= 1) {
      toast('Cannot close the only note area.', 'warn');
      return;
    }
    var target = state.notes.find(function (n) { return n.id === noteId; });
    if (target && target.content && target.content.trim().length > 0) {
      if (!confirm('Close note "' + (target.title || 'Untitled') + '"? Unsaved text will be removed.')) return;
    }
    state.notes = state.notes.filter(function (n) { return n.id !== noteId; });
    if (state.activeNoteId === noteId) {
      state.activeNoteId = state.notes[0].id;
    }
    renderNoteDocTabs();
    loadActiveNoteContent();
    queueServerSync();
  }

  function promptRenameNote(noteId) {
    var note = state.notes.find(function (n) { return n.id === noteId; });
    if (!note) return;
    var newName = prompt('Enter title for this note area:', note.title || '');
    if (newName && newName.trim()) {
      note.title = newName.trim();
      note.updatedAt = new Date().toISOString();
      renderNoteDocTabs();
      var titleInput = document.getElementById('tt-note-title');
      if (titleInput && state.activeNoteId === noteId) titleInput.value = note.title;
      queueServerSync();
    }
  }

  function loadActiveNoteContent() {
    var note = getActiveNote();
    var titleInput = document.getElementById('tt-note-title');
    var textArea = document.getElementById('tt-note-textarea');
    if (titleInput) titleInput.value = note ? (note.title || '') : '';
    if (textArea) textArea.value = note ? (note.content || '') : '';
    updateNoteStats(note ? (note.content || '') : '');
  }

  function updateNoteStats(text) {
    var statsEl = document.getElementById('tt-note-stats');
    if (!statsEl) return;
    text = text || '';
    var chars = text.length;
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    statsEl.textContent = words + ' words · ' + chars + ' chars';
  }

  /* ── 6. Tab 2 & 3: Slot Stash & Clipboard Feeds ───────────────────── */
  function renderStashFeed() {
    var feed = document.getElementById('tt-stash-feed');
    if (!feed) return;

    var list = state.savedSlots.slice();
    if (state.searchQuery) {
      var q = state.searchQuery;
      list = list.filter(function (s) {
        return (s.subject || '').toLowerCase().includes(q) ||
               (s.subjectCode || '').toLowerCase().includes(q) ||
               (s.teacher || '').toLowerCase().includes(q) ||
               (s.room || '').toLowerCase().includes(q);
      });
    }

    if (!list.length) {
      feed.innerHTML = [
        '<div class="tt-drawer-empty">',
        '  <div class="tt-drawer-empty-icon"><re-icon icon="bookmark" size="32"></re-icon></div>',
        '  <div class="tt-drawer-empty-title">No Saved Slots in Stash</div>',
        '  <div class="tt-drawer-empty-sub">Save commonly used subject/lab slots here for 1-click reuse across any class timetable. Drag a slot from the matrix or pin from Clipboard!</div>',
        '</div>'
      ].join('');
      return;
    }

    feed.innerHTML = list.map(function (slot) {
      return renderSlotCardHtml(slot, 'stash');
    }).join('');

    bindSlotCardActions(feed, 'stash');
  }

  function renderClipboardFeed() {
    var feed = document.getElementById('tt-clip-feed');
    var countEl = document.getElementById('tt-clip-feed-count');
    if (!feed) return;

    var list = state.clipboardHistory.slice();
    if (countEl) countEl.textContent = 'Recent Copy History (' + list.length + ')';

    if (!list.length) {
      feed.innerHTML = [
        '<div class="tt-drawer-empty">',
        '  <div class="tt-drawer-empty-icon"><re-icon icon="clipboard" size="32"></re-icon></div>',
        '  <div class="tt-drawer-empty-title">Clipboard History is Empty</div>',
        '  <div class="tt-drawer-empty-sub">Copy or cut any slot in any timetable matrix view (via Ctrl+C, Right-Click, or Entry Modal). It will appear right here!</div>',
        '</div>'
      ].join('');
      return;
    }

    feed.innerHTML = list.map(function (slot) {
      return renderSlotCardHtml(slot, 'clipboard');
    }).join('');

    bindSlotCardActions(feed, 'clipboard');
  }

  function renderSlotCardHtml(slot, source) {
    var isLab = Boolean(slot.isLab || (slot.type && /lab/i.test(slot.type)));
    var isPinned = state.savedSlots.some(function (s) { return isSameSlot(s, slot); });
    var timeTag = slot.copiedAt ? timeAgo(slot.copiedAt) : (slot.savedAt ? timeAgo(slot.savedAt) : '');
    var origin = slot.sourceSection ? ('From ' + slot.sourceSection + (slot.sourceDay ? ' · ' + slot.sourceDay + ' ' + (slot.sourcePeriod || '') : '')) : '';

    return [
      '<div class="tt-slot-card ' + (isLab ? 'is-lab' : '') + '" draggable="true" data-slot-id="' + esc(slot.id) + '">',
      '  <div class="tt-slot-card-hd">',
      '    <div class="tt-slot-card-title-group">',
      '      <span class="tt-slot-subj-code">' + esc(slot.subjectCode || 'ELECTIVE') + '</span>',
      '      <span class="tt-slot-subj-name">' + esc(slot.subject || 'Timetable Slot') + '</span>',
      '    </div>',
      '    <div class="tt-slot-badge-group">',
      '      <span class="tt-slot-type-badge ' + (isLab ? 'lab' : '') + '">' + (isLab ? 'Lab' : 'Theory') + '</span>',
      '      ' + (slot.duration > 1 ? '<span class="tt-slot-type-badge">' + slot.duration + 'P</span>' : ''),
      '    </div>',
      '  </div>',
      '  <div class="tt-slot-meta-row">',
      '    <span class="tt-slot-meta-item"><re-icon icon="user" size="12"></re-icon> ' + esc(slot.teacher || 'Unassigned Faculty') + '</span>',
      '    <span class="tt-slot-meta-item"><re-icon icon="map-pin" size="12"></re-icon> ' + esc(slot.room || 'No Room') + '</span>',
      '  </div>',
      '  ' + (origin || timeTag ? '<div class="tt-slot-source-tag">' + esc(origin) + (origin && timeTag ? ' · ' : '') + esc(timeTag) + '</div>' : ''),
      '  <div class="tt-slot-actions-row">',
      '    <div class="tt-slot-actions-left">',
      '      <button type="button" class="tt-slot-paste-btn" data-action="paste" title="Insert into active timetable slot"><re-icon icon="arrow-down-circle" size="12"></re-icon> Use / Paste</button>',
      '      <button type="button" class="tt-slot-icon-btn" data-action="copy-sys" title="Set as active clipboard (Ctrl+V)"><re-icon icon="copy" size="12"></re-icon></button>',
      '      <button type="button" class="tt-slot-icon-btn pin ' + (isPinned ? 'active' : '') + '" data-action="toggle-pin" title="' + (isPinned ? 'Pinned in Stash' : 'Pin to Saved Slots') + '">',
      '        <re-icon icon="star" size="12"></re-icon>',
      '      </button>',
      '    </div>',
      '    <button type="button" class="tt-slot-icon-btn delete" data-action="delete" title="Delete slot"><re-icon icon="trash2" size="12"></re-icon></button>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function bindSlotCardActions(container, source) {
    container.querySelectorAll('.tt-slot-card').forEach(function (card) {
      var slotId = card.dataset.slotId;
      var slot = (source === 'stash' ? state.savedSlots : state.clipboardHistory).find(function (s) { return s.id === slotId; });
      if (!slot) return;

      // Dragstart for slot card
      card.addEventListener('dragstart', function (e) {
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'copy';
        var payload = JSON.stringify({ type: 'tt-scratchpad-slot', slot: slot });
        e.dataTransfer.setData('text/plain', payload);
        e.dataTransfer.setData('application/json', payload);
      });
      card.addEventListener('dragend', function () {
        card.classList.remove('dragging');
      });

      // Actions inside card
      var pasteBtn = card.querySelector('[data-action="paste"]');
      if (pasteBtn) {
        pasteBtn.addEventListener('click', function () {
          applySlotToActiveCell(slot);
        });
      }

      var copySysBtn = card.querySelector('[data-action="copy-sys"]');
      if (copySysBtn) {
        copySysBtn.addEventListener('click', function () {
          setSystemClipboard(slot);
          toast('Copied! Right-click any cell or press Paste.', 'success');
        });
      }

      var pinBtn = card.querySelector('[data-action="toggle-pin"]');
      if (pinBtn) {
        pinBtn.addEventListener('click', function () {
          toggleSlotPin(slot, pinBtn);
        });
      }

      var delBtn = card.querySelector('[data-action="delete"]');
      if (delBtn) {
        delBtn.addEventListener('click', function () {
          if (source === 'stash') {
            state.savedSlots = state.savedSlots.filter(function (s) { return s.id !== slotId; });
            renderStashFeed();
          } else {
            state.clipboardHistory = state.clipboardHistory.filter(function (s) { return s.id !== slotId; });
            renderClipboardFeed();
          }
          queueServerSync();
          updateTabBadges();
          toast('Slot removed.', 'info');
        });
      }
    });
  }

  /* ── 7. Public API Methods for Timetable Integration ──────────────── */
  function normalizeSlotObject(rawSlot, sourceSection) {
    if (!rawSlot) return null;
    return {
      id: rawSlot.id && rawSlot.id.startsWith('stash_') ? rawSlot.id : uid('slot'),
      subject: rawSlot.subject || rawSlot.subjectName || 'Subject',
      subjectCode: rawSlot.subjectCode || rawSlot.code || '',
      subjectId: rawSlot.subjectId || null,
      teacher: rawSlot.teacher || rawSlot.teacherName || '',
      teacherId: rawSlot.teacherId || null,
      teacherTrackId: rawSlot.teacherTrackId || '',
      room: rawSlot.room || rawSlot.roomName || '',
      roomId: rawSlot.roomId || null,
      type: rawSlot.type || (rawSlot.isLab ? 'Lab' : 'Theory'),
      duration: Number(rawSlot.duration || rawSlot.span || 1),
      isLab: Boolean(rawSlot.isLab || (rawSlot.type && /lab/i.test(rawSlot.type))),
      sourceSection: sourceSection || rawSlot.section || rawSlot.sourceSection || '',
      sourceDay: rawSlot.day || rawSlot.sourceDay || '',
      sourcePeriod: rawSlot.period ? (typeof rawSlot.period === 'number' ? 'P' + rawSlot.period : String(rawSlot.period)) : '',
      comment: rawSlot.comment || '',
      copiedAt: new Date().toISOString(),
      savedAt: new Date().toISOString()
    };
  }

  function isSameSlot(a, b) {
    if (!a || !b) return false;
    return a.subject === b.subject &&
           a.teacher === b.teacher &&
           a.room === b.room &&
           a.duration === b.duration &&
           a.type === b.type;
  }

  function recordSlotCopy(rawSlot, section) {
    var slot = normalizeSlotObject(rawSlot, section);
    if (!slot) return;

    // Deduplicate: remove older duplicate if exists
    state.clipboardHistory = state.clipboardHistory.filter(function (s) {
      return !isSameSlot(s, slot);
    });

    state.clipboardHistory.unshift(slot);
    // Cap at 50 items
    if (state.clipboardHistory.length > 50) {
      state.clipboardHistory = state.clipboardHistory.slice(0, 50);
    }

    queueServerSync();
    updateTabBadges();
    bumpFabBadge();
    if (state.isOpen && state.activeTab === 'clipboard') {
      renderClipboardFeed();
    }
  }

  /* ── 7a. Smooth Drop Into Stash Animation Engine ─────────────────── */
  function resolveSourceCoordinates(options, slot) {
    // 1. Direct Mouse / Touch / Pointer / Drag Event
    if (options && typeof options.clientX === 'number' && options.clientX > 0) {
      return { x: options.clientX, y: options.clientY };
    }

    // 2. Direct DOM Element
    if (options && options.nodeType === 1 && typeof options.getBoundingClientRect === 'function') {
      var r = options.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }

    // 3. Structured options object
    if (options && typeof options === 'object') {
      if (options.sourceEvent && typeof options.sourceEvent.clientX === 'number' && options.sourceEvent.clientX > 0) {
        return { x: options.sourceEvent.clientX, y: options.sourceEvent.clientY };
      }
      if (options.sourceEl && options.sourceEl.getBoundingClientRect) {
        var rel = options.sourceEl.getBoundingClientRect();
        if (rel.width > 0 && rel.height > 0) {
          return { x: rel.left + rel.width / 2, y: rel.top + rel.height / 2 };
        }
      }
      if (options.sourceMenu && options.sourceMenu.getBoundingClientRect) {
        var rm = options.sourceMenu.getBoundingClientRect();
        if (rm.width > 0 && rm.height > 0) {
          return { x: rm.left + rm.width / 2, y: rm.top + rm.height / 2 };
        }
      }
      if (options.id) {
        var elById = document.querySelector('.slot[data-entry-id="' + options.id + '"], .slot-item[data-id="' + options.id + '"], [data-slot-id="' + options.id + '"]');
        if (elById && elById.getBoundingClientRect) {
          var rib = elById.getBoundingClientRect();
          if (rib.width > 0 && rib.height > 0) {
            return { x: rib.left + rib.width / 2, y: rib.top + rib.height / 2 };
          }
        }
      }
      if (options.day && options.period) {
        var elByGrid = document.querySelector('[data-day="' + options.day + '"][data-period="' + options.period + '"]');
        if (elByGrid && elByGrid.getBoundingClientRect) {
          var rbg = elByGrid.getBoundingClientRect();
          if (rbg.width > 0 && rbg.height > 0) {
            return { x: rbg.left + rbg.width / 2, y: rbg.top + rbg.height / 2 };
          }
        }
      }
    }

    // 4. Fallback search by slot ID in timetable DOM
    if (slot && slot.id) {
      var slotDom = document.querySelector('.slot[data-entry-id="' + slot.id + '"], [data-slot-id="' + slot.id + '"]');
      if (slotDom && slotDom.getBoundingClientRect) {
        var rsd = slotDom.getBoundingClientRect();
        if (rsd.width > 0 && rsd.height > 0) {
          return { x: rsd.left + rsd.width / 2, y: rsd.top + rsd.height / 2 };
        }
      }
    }

    // 5. Center-left of viewport safe default
    return {
      x: Math.round(window.innerWidth * 0.45),
      y: Math.round(window.innerHeight * 0.4)
    };
  }

  function getStashTarget() {
    // If scratchpad drawer is open, drop smoothly into dropzone or stash tab
    if (state.isOpen) {
      var drawer = document.getElementById('tt-scratchpad-drawer');
      if (drawer && drawer.classList.contains('open')) {
        if (state.activeTab === 'stash') {
          var dropzone = document.getElementById('tt-stash-dropzone');
          if (dropzone) {
            var rdz = dropzone.getBoundingClientRect();
            if (rdz.width > 0 && rdz.height > 0) {
              return {
                el: dropzone,
                x: rdz.left + rdz.width / 2,
                y: rdz.top + rdz.height / 2,
                isFab: false
              };
            }
          }
        }
        var stashTabBtn = drawer.querySelector('[data-tab="stash"]');
        if (stashTabBtn) {
          var rst = stashTabBtn.getBoundingClientRect();
          if (rst.width > 0 && rst.height > 0) {
            return {
              el: stashTabBtn,
              x: rst.left + rst.width / 2,
              y: rst.top + rst.height / 2,
              isFab: false
            };
          }
        }
      }
    }

    // Primary target: Fixed Floating Action Button (FAB)
    var fab = document.getElementById('tt-scratchpad-fab');
    if (fab) {
      var rf = fab.getBoundingClientRect();
      if (rf.width > 0 && rf.height > 0) {
        return {
          el: fab,
          x: rf.left + rf.width / 2,
          y: rf.top + rf.height / 2,
          isFab: true
        };
      }
    }

    return {
      el: null,
      x: window.innerWidth - 52,
      y: window.innerHeight - 50,
      isFab: true
    };
  }

  function triggerLandingReaction(target, isDuplicate) {
    var el = target.el || document.getElementById('tt-scratchpad-fab');

    // 1. Expanding ripple effect around landing target
    try {
      var ripple = document.createElement('div');
      ripple.className = 'tt-stash-ripple' + (isDuplicate ? ' warn' : '');
      ripple.style.left = target.x + 'px';
      ripple.style.top = target.y + 'px';
      var w = el ? (el.offsetWidth || 48) : 48;
      var h = el ? (el.offsetHeight || 48) : 48;
      ripple.style.width = w + 'px';
      ripple.style.height = h + 'px';
      document.body.appendChild(ripple);
      setTimeout(function () {
        if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
      }, 580);
    } catch (e) {}

    if (!el) return;

    if (!isDuplicate) {
      // Success absorb animation on target
      el.classList.remove('absorbing');
      void el.offsetWidth; // force reflow
      el.classList.add('absorbing');
      setTimeout(function () {
        el.classList.remove('absorbing');
      }, 540);
      bumpFabBadge();
    } else {
      // Duplicate shake animation on target
      el.classList.remove('shaking');
      void el.offsetWidth; // force reflow
      el.classList.add('shaking');
      setTimeout(function () {
        el.classList.remove('shaking');
      }, 500);

      var badge = document.getElementById('tt-fab-badge');
      if (badge) {
        badge.classList.remove('warn-flash');
        void badge.offsetWidth;
        badge.classList.add('warn-flash');
        setTimeout(function () {
          badge.classList.remove('warn-flash');
        }, 700);
      }
    }
  }

  function highlightExistingStashCard(slot) {
    var feed = document.getElementById('tt-stash-feed');
    if (!feed) return;
    var cards = feed.querySelectorAll('.tt-slot-card');
    cards.forEach(function (card) {
      var cId = card.dataset.slotId;
      var s = state.savedSlots.find(function (x) { return x.id === cId; });
      if (s && isSameSlot(s, slot)) {
        card.classList.remove('highlight-found');
        void card.offsetWidth;
        card.classList.add('highlight-found');
        try {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (e) {}
      }
    });
  }

  function triggerDropIntoStashAnimation(slot, sourceCoords, isDuplicate, onComplete) {
    var prefersReducedMotion = false;
    try {
      prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {}

    var target = getStashTarget();

    if (prefersReducedMotion || !target) {
      triggerLandingReaction(target, isDuplicate);
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    // Build mini ghost card representation
    var ghost = document.createElement('div');
    ghost.className = 'tt-stash-ghost' + (slot.isLab ? ' is-lab' : '');
    ghost.innerHTML = [
      '<div class="tt-stash-ghost-hd">',
      '  <span class="tt-stash-ghost-code">' + esc(slot.subjectCode || 'SLOT') + '</span>',
      '  <span class="tt-stash-ghost-type">' + (slot.isLab ? 'Lab' : 'Theory') + '</span>',
      '</div>',
      '<div class="tt-stash-ghost-title">' + esc(slot.subject || 'Timetable Slot') + '</div>',
      '<div class="tt-stash-ghost-meta">',
      '  <span>' + esc(slot.teacher || 'Faculty') + '</span>',
      (slot.room ? '  <span>· ' + esc(slot.room) + '</span>' : ''),
      '</div>'
    ].join('');
    document.body.appendChild(ghost);

    // Initial measurement
    var ghostWidth = ghost.offsetWidth || 175;
    var ghostHeight = ghost.offsetHeight || 55;

    var startX = sourceCoords.x - ghostWidth / 2;
    var startY = sourceCoords.y - ghostHeight / 2;
    var endX = target.x - ghostWidth / 2;
    var endY = target.y - ghostHeight / 2;

    // Upward arc control point for natural parabolic arc
    var distX = Math.abs(endX - startX);
    var distY = Math.abs(endY - startY);
    var arcHeight = Math.max(80, Math.min(180, Math.sqrt(distX * distX + distY * distY) * 0.22));
    var controlX = (startX + endX) / 2;
    var controlY = Math.min(startY, endY) - arcHeight;

    var startTime = null;
    var duration = 520; // 520ms smooth flight

    function ease(t) {
      // Cubic bezier: starts with slight lift, accelerates then smoothly eases into target
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function frame(now) {
      if (!startTime) startTime = now;
      var elapsed = now - startTime;
      var progress = Math.min(1, elapsed / duration);
      var t = ease(progress);

      // Quadratic bezier curve point
      var curX = Math.round((1 - t) * (1 - t) * startX + 2 * (1 - t) * t * controlX + t * t * endX);
      var curY = Math.round((1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * endY);

      // Scale: starts with slight bounce-up (1.05) then scales down to 0.18 entering target
      var scale = progress < 0.15 ? (0.95 + (progress / 0.15) * 0.15) : Math.max(0.12, 1.1 - 0.95 * t);

      // Dynamic tilt: banks into the turn
      var rot = (1 - t) * Math.sin(progress * Math.PI) * (endX >= startX ? 12 : -12);

      // Opacity: solid until 72%, then rapidly drops into target
      var opacity = progress < 0.72 ? 1 : Math.max(0, 1 - (progress - 0.72) / 0.28);

      ghost.style.transform = 'translate3d(' + curX + 'px, ' + curY + 'px, 0) scale(' + scale.toFixed(3) + ') rotate(' + rot.toFixed(2) + 'deg)';
      ghost.style.opacity = opacity.toFixed(3);

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
        triggerLandingReaction(target, isDuplicate);
        if (typeof onComplete === 'function') onComplete();
      }
    }

    requestAnimationFrame(frame);
  }

  function saveSlotToStash(rawSlot, section, animOptions) {
    var slot = normalizeSlotObject(rawSlot, section);
    if (!slot) return;

    var alreadyExists = state.savedSlots.some(function (s) { return isSameSlot(s, slot); });
    var sourceCoords = resolveSourceCoordinates(animOptions, slot);

    triggerDropIntoStashAnimation(slot, sourceCoords, alreadyExists, function () {
      if (!alreadyExists) {
        state.savedSlots.unshift(slot);
        queueServerSync();
        updateTabBadges();
        if (state.isOpen) {
          if (state.activeTab === 'stash') {
            renderStashFeed();
          } else {
            switchTab('stash');
          }
        }
        toast('Slot saved to Stash library ⭐', 'success');
      } else {
        toast('Slot is already in your Stash library.', 'info');
        if (state.isOpen) {
          if (state.activeTab !== 'stash') switchTab('stash');
          highlightExistingStashCard(slot);
        }
      }
    });
  }

  function toggleSlotPin(slot, pinBtn) {
    var idx = state.savedSlots.findIndex(function (s) { return isSameSlot(s, slot); });
    if (idx >= 0) {
      state.savedSlots.splice(idx, 1);
      toast('Unpinned from Stash.', 'info');
      queueServerSync();
      updateTabBadges();
      renderActiveTabContent();
    } else {
      var copy = Object.assign({}, slot, { id: uid('stash'), savedAt: new Date().toISOString() });
      saveSlotToStash(copy, copy.sourceSection, { sourceEl: pinBtn });
    }
  }

  function setSystemClipboard(slot) {
    if (window.state) {
      window.state.clipboard = {
        subject: slot.subject,
        subjectCode: slot.subjectCode,
        subjectId: slot.subjectId,
        teacher: slot.teacher,
        teacherId: slot.teacherId,
        teacherTrackId: slot.teacherTrackId,
        room: slot.room,
        roomId: slot.roomId,
        type: slot.type,
        duration: slot.duration,
        isLab: slot.isLab,
        section: slot.sourceSection,
        comment: slot.comment,
        id: null
      };
    }
  }

  function handleDropOnStash(e) {
    try {
      var rawJson = null;
      try { rawJson = e.dataTransfer.getData('application/json'); } catch (_) {}
      var rawText = null;
      try { rawText = e.dataTransfer.getData('text/plain'); } catch (_) {}
      var raw = rawJson || rawText;
      if (!raw) return;

      var parsed = null;
      try { parsed = JSON.parse(raw); } catch (err) {}

      // 1. Direct slot object inside parsed payload
      if (parsed && (parsed.slot || (parsed.type === 'tt-scratchpad-slot' && parsed.slot))) {
        saveSlotToStash(parsed.slot, parsed.section || (window.state && window.state.filterSection), { sourceEvent: e });
        return;
      }

      var slotId = (parsed && parsed.entryId) ? parsed.entryId : (rawText || raw);

      // 2. Resolve via window.resolveSlotEntry
      if (typeof window.resolveSlotEntry === 'function') {
        var entryFromResolve = window.resolveSlotEntry(slotId);
        if (entryFromResolve) {
          saveSlotToStash(entryFromResolve, window.state ? window.state.filterSection : '', { sourceEvent: e });
          return;
        }
      }

      // 3. Resolve via window.activeEntries
      if (typeof window.activeEntries === 'function') {
        var active = window.activeEntries();
        if (Array.isArray(active)) {
          var entryInActive = active.find(function (x) {
            return String(x.id || x._id) === String(slotId);
          });
          if (entryInActive) {
            saveSlotToStash(entryInActive, window.state ? window.state.filterSection : '', { sourceEvent: e });
            return;
          }
        }
      }

      // 4. Resolve via window.state.entries
      if (window.state && Array.isArray(window.state.entries)) {
        var entry = window.state.entries.find(function (x) {
          return String(x.id || x._id) === String(slotId);
        });
        if (entry) {
          saveSlotToStash(entry, window.state.filterSection, { sourceEvent: e });
          return;
        }
      }
    } catch (err) {
      console.warn('[TimetableScratchpad] drop error:', err);
    }
  }

  /* ── 8. Applying / Pasting Slot to Grid Cell ───────────────────────── */
  function applySlotToActiveCell(slot) {
    // 1. Check if user clicked a cell previously
    var cell = state.focusedCell;
    if (cell && cell.day && cell.period) {
      executeCellPaste(slot, cell.day, cell.period, cell.section);
      return;
    }

    // 2. Otherwise set as active clipboard and guide user
    setSystemClipboard(slot);
    toast('Slot ready to paste! Click any cell in the timetable matrix or press Paste.', 'success');

    // Highlight eligible cells in timetable grid temporarily
    var cells = document.querySelectorAll('.slot-add, .slot[data-entry-id]');
    cells.forEach(function (node) {
      node.classList.add('paste-target-ready');
    });
    setTimeout(function () {
      cells.forEach(function (node) {
        node.classList.remove('paste-target-ready');
      });
    }, 4500);
  }

  function executeCellPaste(slot, day, period, section) {
    var appState = window.state;
    if (!appState) {
      console.warn('[TimetableScratchpad] cannot paste: window.state not ready');
      return;
    }
    if (typeof window.isReadOnlyMode === 'function' && window.isReadOnlyMode()) {
      toast('Cannot paste: Current timetable view is read-only.', 'warn');
      return;
    }

    var targetSection = section || appState.filterSection || slot.sourceSection;
    var candidate = {
      id: (typeof uid === 'function' ? uid('slot') : ('slot_' + Date.now())),
      day: day,
      period: period,
      section: targetSection,
      subject: slot.subject,
      subjectCode: slot.subjectCode,
      subjectId: slot.subjectId,
      teacher: slot.teacher,
      teacherId: slot.teacherId,
      teacherTrackId: slot.teacherTrackId,
      room: slot.room,
      roomId: slot.roomId,
      type: slot.type,
      duration: slot.duration || 1,
      isLab: slot.isLab,
      comment: slot.comment || ''
    };

    // Run EAMS conflict validation
    var entriesPool = (typeof window.activeEntries === 'function' ? window.activeEntries() : null) || appState.entries || [];
    if (typeof window.conflictsFor === 'function') {
      var errors = window.conflictsFor(candidate, entriesPool);
      if (errors && errors.length) {
        var fac = errors.find(function (x) { return x.kind === 'faculty' || /Faculty double-booked/i.test(x.message); });
        var msg = fac ? fac.message : errors[0].message;
        toast('Cannot paste: ' + msg, 'error');
        return;
      }
    }

    // Insert into state, replacing any existing entry in that cell
    if (typeof window.recordHistory === 'function') {
      window.recordHistory('Paste ' + candidate.subject + ' from Scratchpad');
    }
    if (!Array.isArray(appState.entries)) appState.entries = [];
    var existingIdx = appState.entries.findIndex(function (x) {
      return x.day === day && x.period === period && (!targetSection || x.section === targetSection);
    });
    if (existingIdx >= 0) {
      appState.entries[existingIdx] = candidate;
    } else {
      appState.entries.push(candidate);
    }

    var curTabId = window.workspace && window.workspace.activeTabId;
    if (curTabId && appState.tabData && appState.tabData[curTabId]) {
      if (!Array.isArray(appState.tabData[curTabId].entries)) appState.tabData[curTabId].entries = [];
      var tabEntries = appState.tabData[curTabId].entries;
      var tIdx = tabEntries.findIndex(function (x) {
        return x.day === day && x.period === period && (!targetSection || x.section === targetSection);
      });
      if (tIdx >= 0) {
        tabEntries[tIdx] = candidate;
      } else {
        tabEntries.push(candidate);
      }
      appState.tabData[curTabId].entries = tabEntries;
    }

    if (typeof window.markCurrentTabDirty === 'function') window.markCurrentTabDirty();
    if (typeof window.render === 'function') window.render();
    if (typeof window.persistState === 'function') window.persistState();

    toast('Slot ' + candidate.subject + ' pasted into ' + day + ' ' + period + '!', 'success');
  }

  function setFocusedCell(day, period, section) {
    state.focusedCell = { day: day, period: period, section: section };
  }

  function getFocusedCell() {
    return state.focusedCell;
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type === 'error' ? 'red' : (type === 'warn' ? 'amber' : 'green'));
    } else if (typeof window.notify === 'function') {
      window.notify(msg, type);
    } else {
      console.log('[Scratchpad Toast]', msg);
    }
  }

  /* ── 9. Module Bootstrapping ──────────────────────────────────────── */
  function init() {
    loadLocalState();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        mountDOM();
        fetchServerState();
      });
    } else {
      mountDOM();
      fetchServerState();
    }
  }

  // Expose global interface
  global.TimetableScratchpad = {
    init: init,
    open: openDrawer,
    close: closeDrawer,
    toggle: toggleDrawer,
    recordSlotCopy: recordSlotCopy,
    saveSlotToStash: saveSlotToStash,
    animateDropToStash: triggerDropIntoStashAnimation,
    setFocusedCell: setFocusedCell,
    getFocusedCell: getFocusedCell,
    applySlotToActiveCell: applySlotToActiveCell,
    executeCellPaste: executeCellPaste
  };

  init();

})(typeof window !== 'undefined' ? window : this);
