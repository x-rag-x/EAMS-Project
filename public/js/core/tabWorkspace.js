/**
 * EAMS TabWorkspace Core Module
 * 
 * Provides persistent in-app tab management with zero-lag DOM-retained switching,
 * per-tab state isolation (mode, scroll, undo/redo stacks), full W3C ARIA accessibility,
 * dirty-draft guard rails, sessionStorage restoration with server revalidation,
 * and a Dual-Mode Split Screen engine with width-aware sidebar auto-hiding.
 * 
 * Invariants:
 * - Plain vanilla ES6+, zero external libraries.
 * - Steady-state hidden tabs use display: none / hidden attribute (0 paint/composite cost).
 * - Animations use transform and opacity only with prefers-reduced-motion support.
 * - Tab identity is built from sorted semantic parameters.
 */

(function () {
  'use strict';

  /**
   * Builds a canonical sorted tab identifier from viewType and parameters.
   * Example: buildTabId('overview', { deptId: 'CSE', year: 2 }) => 'overview:deptId=CSE&year=2'
   */
  function buildTabId(viewType, params = {}) {
    if (!params || typeof params !== 'object') return String(viewType);
    const keys = Object.keys(params).sort();
    if (!keys.length) return String(viewType);
    const query = keys
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k] ?? '')}`)
      .join('&');
    return `${viewType}:${query}`;
  }

  class TabWorkspace {
    constructor(options = {}) {
      this.tabstripEl = options.tabstripEl || document.querySelector('.tt-tabstrip');
      this.viewportEl = options.viewportEl || document.querySelector('.tt-viewport-container');
      this.renderTab = typeof options.renderTab === 'function' ? options.renderTab : () => {};
      this.onActivate = typeof options.onActivate === 'function' ? options.onActivate : () => {};
      this.onClose = typeof options.onClose === 'function' ? options.onClose : () => {};
      this.onDirtyChange = typeof options.onDirtyChange === 'function' ? options.onDirtyChange : () => {};
      this.confirmCloseDirty = typeof options.confirmCloseDirty === 'function' ? options.confirmCloseDirty : null;
      this.onLaunchView = typeof options.onLaunchView === 'function' ? options.onLaunchView : null;

      this.tabs = new Map(); // tabId -> TabObject
      this.activeTabId = null;
      this.activationHistory = [];
      this.tabCapSoft = 8;
      this.tabCapHard = 12;

      // Split Screen State
      this.isSplit = false;
      this.splitMode = 'vertical'; // 'vertical' (side-by-side) or 'horizontal' (top-and-bottom)
      this.secondaryTabId = null;
      this.splitRatio = 0.5; // 50:50 default
      this.splitContainerEl = null;
      this._isDraggingDivider = false;

      // Drag & Move State
      this._draggedTabId = null;
      this._dragOverTabId = null;

      // Bound event listeners
      this._onKeyDown = this._handleKeyNav.bind(this);
      this._onGlobalShortcut = this._handleGlobalShortcuts.bind(this);
      this._onDividerMouseMove = this._handleDividerDrag.bind(this);
      this._onDividerMouseUp = this._stopDividerDrag.bind(this);

      this._initAccessibility();
      this._initControls();

      this._onResize = () => this._updateOverflowButtonState();
      window.addEventListener('resize', this._onResize);
    }

    _initAccessibility() {
      if (this.tabstripEl) {
        this.tabstripEl.setAttribute('role', 'tablist');
        this.tabstripEl.setAttribute('aria-orientation', 'horizontal');
        this.tabstripEl.setAttribute('aria-label', 'Open Timetable Views');
        this.tabstripEl.removeEventListener('keydown', this._onKeyDown);
        this.tabstripEl.addEventListener('keydown', this._onKeyDown);
      }
      window.removeEventListener('keydown', this._onGlobalShortcut);
      window.addEventListener('keydown', this._onGlobalShortcut);
    }

    _initControls() {
      // New Tab Button
      const newTabBtn = document.getElementById('tt-new-tab-btn');
      const launcherMenu = document.getElementById('tt-tab-launcher');
      if (newTabBtn && launcherMenu) {
        newTabBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = launcherMenu.style.display !== 'none';
          if (!isOpen && typeof this.onPopulateLauncher === 'function') {
            this.onPopulateLauncher(launcherMenu);
          }
          launcherMenu.style.display = isOpen ? 'none' : 'flex';
          const overflowMenu = document.getElementById('tt-overflow-menu');
          if (overflowMenu) overflowMenu.style.display = 'none';
        });

        // Launcher items click handling (delegated for dynamic class items)
        launcherMenu.addEventListener('click', (e) => {
          const item = e.target.closest('[data-launcher]');
          if (!item) return;
          e.stopPropagation();
          const launcherKey = item.dataset.launcher;
          const targetSection = item.dataset.section;
          launcherMenu.style.display = 'none';
          if (typeof this.onLaunchView === 'function') {
            this.onLaunchView(launcherKey, targetSection);
          }
        });
      }

      // Overflow Menu Button
      const overflowBtn = document.getElementById('tt-overflow-btn');
      const overflowMenu = document.getElementById('tt-overflow-menu');
      if (overflowBtn && overflowMenu) {
        overflowBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = overflowMenu.style.display !== 'none';
          if (!isOpen) this._populateOverflowMenu();
          overflowMenu.style.display = isOpen ? 'none' : 'block';
          if (launcherMenu) launcherMenu.style.display = 'none';
        });
      }

      // Split View Button
      const splitBtn = document.getElementById('tt-split-btn');
      if (splitBtn) {
        splitBtn.addEventListener('click', () => {
          this.toggleSplit();
        });
      }

      // Floating Sidebar Toggle (Auto-hide pill)
      const floatToggle = document.getElementById('sb-float-toggle');
      if (floatToggle) {
        floatToggle.addEventListener('click', () => {
          const sb = document.querySelector('aside.sb');
          const mc = document.querySelector('main.mc');
          if (sb) {
            const isCollapsed = sb.classList.contains('sb-split-collapsed');
            if (isCollapsed) {
              sb.classList.remove('sb-split-collapsed');
              if (mc) mc.classList.remove('mc-split-expanded');
            } else {
              sb.classList.add('sb-split-collapsed');
              if (mc) mc.classList.add('mc-split-expanded');
            }
          }
        });
      }

      // Close menus on outside click
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#tt-tab-launcher') && !e.target.closest('#tt-new-tab-btn')) {
          if (launcherMenu) launcherMenu.style.display = 'none';
        }
        if (!e.target.closest('#tt-overflow-menu') && !e.target.closest('#tt-overflow-btn')) {
          if (overflowMenu) overflowMenu.style.display = 'none';
        }
      });

      // Tabstrip Drag-over & Drop (for dropping onto empty tabstrip space)
      if (this.tabstripEl) {
        this.tabstripEl.addEventListener('dragover', (e) => {
          if (!this._draggedTabId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        });

        this.tabstripEl.addEventListener('drop', (e) => {
          if (!this._draggedTabId) return;
          if (e.target === this.tabstripEl || e.target.id === 'tt-tabstrip-scroll-wrap') {
            e.preventDefault();
            const fromTab = this.tabs.get(this._draggedTabId);
            if (fromTab && fromTab.chipEl) {
              this.tabstripEl.appendChild(fromTab.chipEl);
              const entries = Array.from(this.tabs.entries());
              const fromIdx = entries.findIndex(([k]) => k === this._draggedTabId);
              if (fromIdx !== -1) {
                const [moved] = entries.splice(fromIdx, 1);
                entries.push(moved);
                this.tabs = new Map(entries);
                this._saveSession();
              }
            }
          }
        });
      }
    }

    /**
     * Opens a new tab or activates an existing tab if already open.
     */
    openTab(config = {}) {
      const viewType = config.viewType || 'section';
      const viewParams = config.viewParams || {};
      const id = config.id || buildTabId(viewType, viewParams);
      const title = config.title || 'Untitled View';
      const icon = config.icon || '📅';
      const isPinned = Boolean(config.isPinned);
      const mode = config.mode || 'production';
      const activate = config.activate !== false;

      // Invariant: Tabs are exclusively for class timetable views
      if (viewType !== 'section' && !String(id).startsWith('section:')) {
        if (typeof window.switchTab === 'function') {
          window.switchTab(viewType);
        }
        return null;
      }

      // 1. Deduplication: activate existing tab
      if (this.tabs.has(id)) {
        const existing = this.tabs.get(id);
        if (config.title && config.title !== existing.title) {
          existing.title = config.title;
          this._updateChipTitle(existing);
        }
        if (activate) this.activateTab(id);
        return existing;
      }

      // 2. Tab Hard Cap Guard (Limit = 12) with Quick Action
      if (this.tabs.size >= this.tabCapHard) {
        const canAutoClose = Array.from(this.tabs.values()).some(t => !t.isPinned && !t.isDirty && t.id !== this.activeTabId);
        if (canAutoClose && typeof window.confirm === 'function' && window.confirm('Tab limit reached (12 open tabs). Close oldest unused tab to make room?')) {
          this.closeOldestUnpinnedTab();
        } else {
          if (typeof showToast === 'function') {
            showToast(`Tab limit reached (12 open tabs). Please close an unused tab.`, 'warn');
          } else if (typeof alert === 'function') {
            alert('Tab limit reached (12 open tabs). Please close an unused tab.');
          }
          return null;
        }
      }

      // 3. Tab Soft Warning (Limit = 8)
      if (this.tabs.size === this.tabCapSoft) {
        if (typeof showToast === 'function') {
          showToast(`8 tabs open in workspace. Consider closing unused tabs for optimal performance.`, 'info');
        }
      }

      // 4. Create Tab State Object
      const tab = {
        id,
        title,
        icon,
        viewType,
        viewParams,
        isPinned,
        isDirty: false,
        mode, // in-tab state: 'development' | 'production'
        renderedEnv: config.renderedEnv || null,
        scrollPos: { top: 0, left: 0 },
        undoStack: [],
        redoStack: [],
        chipEl: null,
        paneEl: null,
        createdAt: Date.now()
      };

      this.tabs.set(id, tab);

      // 5. Mount Chip & Pane DOM Nodes
      this._mountTabChip(tab);
      this._mountTabPane(tab);

      // 6. Invoke page renderer to populate pane content
      try {
        this.renderTab(tab, tab.paneEl);
      } catch (err) {
        console.error(`[TabWorkspace] Error rendering tab "${id}":`, err);
      }

      // 7. Update tabstrip overflow button state
      this._updateOverflowButtonState();

      // 8. Activate if requested
      if (activate) {
        this.activateTab(id);
      } else {
        tab.paneEl.hidden = true;
        tab.paneEl.style.display = 'none';
        tab.chipEl.setAttribute('aria-selected', 'false');
        tab.chipEl.setAttribute('tabindex', '-1');
      }

      this._saveSession();
      return tab;
    }

    _mountTabChip(tab) {
      if (!this.tabstripEl) return;

      const chip = document.createElement('div');
      chip.className = 'tt-tab-chip';
      chip.id = `tab-${tab.id.replace(/[^a-zA-Z0-9-_]/g, '_')}`;
      chip.dataset.tabId = tab.id;
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-controls', `pane-${tab.id.replace(/[^a-zA-Z0-9-_]/g, '_')}`);
      chip.setAttribute('aria-selected', 'false');
      chip.setAttribute('tabindex', '-1');
      chip.setAttribute('draggable', 'true');
      chip.title = tab.title;

      chip.innerHTML = `
        <span class="tt-tab-icon" aria-hidden="true">${tab.icon}</span>
        <span class="tt-tab-title">${this._escapeHtml(tab.title)}</span>
        <span class="tt-tab-dirty-dot" title="Unsaved draft changes" aria-hidden="true" style="display:${tab.isDirty ? 'inline-block' : 'none'};">●</span>
        ${tab.isPinned ? '' : `<button type="button" class="tt-tab-close" aria-label="Close tab ${this._escapeHtml(tab.title)}" tabindex="-1">×</button>`}
      `;

      // Click to activate
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.tt-tab-close')) return;
        this.activateTab(tab.id);
      });

      // Close button
      const closeBtn = chip.querySelector('.tt-tab-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeTab(tab.id);
        });
      }

      // Drag & Move Event Listeners
      chip.addEventListener('dragstart', (e) => {
        if (e.target.closest('.tt-tab-close')) {
          e.preventDefault();
          return false;
        }
        this._draggedTabId = tab.id;
        e.dataTransfer.setData('text/plain', tab.id);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => {
          chip.classList.add('tt-tab-dragging');
        }, 0);
      });

      chip.addEventListener('dragenter', (e) => {
        if (!this._draggedTabId || this._draggedTabId === tab.id) return;
        e.preventDefault();
      });

      chip.addEventListener('dragover', (e) => {
        if (!this._draggedTabId || this._draggedTabId === tab.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const rect = chip.getBoundingClientRect();
        const isAfter = (e.clientX - rect.left) > (rect.width / 2);

        chip.classList.toggle('tt-tab-drop-before', !isAfter);
        chip.classList.toggle('tt-tab-drop-after', isAfter);
      });

      chip.addEventListener('dragleave', (e) => {
        if (!chip.contains(e.relatedTarget)) {
          chip.classList.remove('tt-tab-drop-before', 'tt-tab-drop-after');
        }
      });

      chip.addEventListener('drop', (e) => {
        e.preventDefault();
        chip.classList.remove('tt-tab-drop-before', 'tt-tab-drop-after');
        const draggedId = this._draggedTabId || e.dataTransfer.getData('text/plain');
        if (draggedId && draggedId !== tab.id) {
          const rect = chip.getBoundingClientRect();
          const isAfter = (e.clientX - rect.left) > (rect.width / 2);
          this.moveTab(draggedId, tab.id, isAfter ? 'after' : 'before');
        }
      });

      chip.addEventListener('dragend', () => {
        chip.classList.remove('tt-tab-dragging');
        this._cleanupTabDragIndicators();
        this._draggedTabId = null;
      });

      tab.chipEl = chip;
      this.tabstripEl.appendChild(chip);
    }

    /**
     * Reorders a tab before or after target tab in the tabstrip and internal Map.
     */
    moveTab(fromTabId, toTabId, position = 'before') {
      if (!fromTabId || !toTabId || fromTabId === toTabId) return;
      const fromTab = this.tabs.get(fromTabId);
      const toTab = this.tabs.get(toTabId);
      if (!fromTab || !toTab) return;

      // 1. Reorder DOM chips in tabstrip
      if (fromTab.chipEl && toTab.chipEl && this.tabstripEl) {
        if (position === 'before') {
          this.tabstripEl.insertBefore(fromTab.chipEl, toTab.chipEl);
        } else {
          this.tabstripEl.insertBefore(fromTab.chipEl, toTab.chipEl.nextSibling);
        }
      }

      // 2. Reorder internal Map
      const entries = Array.from(this.tabs.entries());
      const fromIdx = entries.findIndex(([k]) => k === fromTabId);
      if (fromIdx === -1) return;
      const [movedEntry] = entries.splice(fromIdx, 1);

      let toIdx = entries.findIndex(([k]) => k === toTabId);
      if (toIdx === -1) return;
      if (position === 'after') {
        toIdx += 1;
      }
      entries.splice(toIdx, 0, movedEntry);
      this.tabs = new Map(entries);

      // 3. Persist new tab order
      this._saveSession();
    }

    _cleanupTabDragIndicators() {
      if (this.tabstripEl) {
        this.tabstripEl.querySelectorAll('.tt-tab-chip').forEach(el => {
          el.classList.remove('tt-tab-dragging', 'tt-tab-drop-before', 'tt-tab-drop-after');
        });
      }
      const secondaryPane = document.getElementById('tt-split-secondary-pane');
      if (secondaryPane) secondaryPane.classList.remove('tt-split-drop-target');
    }

    _mountTabPane(tab) {
      if (!this.viewportEl) return;

      const pane = document.createElement('div');
      pane.className = 'tt-tab-pane';
      pane.id = `pane-${tab.id.replace(/[^a-zA-Z0-9-_]/g, '_')}`;
      pane.dataset.tabId = tab.id;
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', tab.chipEl ? tab.chipEl.id : '');
      pane.setAttribute('tabindex', '0');
      pane.hidden = true;
      pane.style.display = 'none';

      tab.paneEl = pane;

      // If in split mode, append to the primary pane
      const primaryContainer = document.getElementById('tt-split-primary-body');
      if (this.isSplit && primaryContainer) {
        primaryContainer.appendChild(pane);
      } else {
        this.viewportEl.appendChild(pane);
      }
    }

    _updateChipTitle(tab) {
      if (!tab.chipEl) return;
      tab.chipEl.title = tab.title;
      const titleEl = tab.chipEl.querySelector('.tt-tab-title');
      if (titleEl) titleEl.textContent = tab.title;
    }

    _updateOverflowButtonState() {
      const overflowBtn = document.getElementById('tt-overflow-btn');
      const badge = document.getElementById('tt-overflow-badge');
      const wrap = document.getElementById('tt-tabstrip-scroll-wrap');
      if (overflowBtn) {
        const count = this.tabs.size;
        const isOverflowing = wrap ? (wrap.scrollWidth > wrap.clientWidth + 8) : count > 5;
        overflowBtn.style.display = isOverflowing ? 'inline-flex' : 'none';
        if (badge) badge.textContent = count;
      }
    }

    _populateOverflowMenu() {
      const overflowMenu = document.getElementById('tt-overflow-menu');
      if (!overflowMenu) return;
      overflowMenu.innerHTML = '';

      this.tabs.forEach((tab) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'tt-overflow-item' + (tab.id === this.activeTabId ? ' active' : '');
        item.innerHTML = `
          <span style="display:flex;align-items:center;gap:8px;">
            <span>${tab.icon}</span>
            <span>${this._escapeHtml(tab.title)}</span>
            ${tab.isDirty ? '<span style="color:#d97706;font-size:9px;">●</span>' : ''}
          </span>
          ${tab.isPinned ? '<span style="font-size:11px;opacity:0.6;">📌</span>' : ''}
        `;
        item.addEventListener('click', () => {
          this.activateTab(tab.id);
          overflowMenu.style.display = 'none';
        });
        overflowMenu.appendChild(item);
      });
    }

    /**
     * Activates a tab in 0ms (steady-state display toggling).
     */
    activateTab(tabId) {
      const tab = this.tabs.get(tabId);
      if (!tab) return false;

      // If activating the current active tab and not in split mode, return early
      if (this.activeTabId === tabId && tab.chipEl?.classList.contains('active') && !this.isSplit) {
        return true;
      }

      // 1. Deactivate current primary tab
      if (this.activeTabId && this.tabs.has(this.activeTabId) && this.activeTabId !== tabId) {
        const prevTab = this.tabs.get(this.activeTabId);
        if (prevTab.paneEl && prevTab.id !== this.secondaryTabId) {
          prevTab.scrollPos.top = prevTab.paneEl.scrollTop || 0;
          prevTab.scrollPos.left = prevTab.paneEl.scrollLeft || 0;
          prevTab.paneEl.classList.remove('active', 'pane-animating');
          prevTab.paneEl.hidden = true;
          prevTab.paneEl.style.display = 'none';
        }
        if (prevTab.chipEl) {
          prevTab.chipEl.classList.remove('active');
          prevTab.chipEl.setAttribute('aria-selected', 'false');
          prevTab.chipEl.setAttribute('tabindex', '-1');
        }
      }

      // 2. Activate target tab
      this.activeTabId = tabId;
      this.activationHistory.push(tabId);
      if (this.activationHistory.length > 30) this.activationHistory.shift();

      if (tab.chipEl) {
        tab.chipEl.classList.add('active');
        tab.chipEl.setAttribute('aria-selected', 'true');
        tab.chipEl.setAttribute('tabindex', '0');
        this._ensureChipVisible(tab.chipEl);
      }

      if (tab.paneEl) {
        tab.paneEl.hidden = false;
        tab.paneEl.style.display = 'block';
        tab.paneEl.classList.add('active');

        // Micro-transition if motion permitted
        const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!prefersReduced) {
          tab.paneEl.classList.add('pane-animating');
          setTimeout(() => {
            tab.paneEl?.classList.remove('pane-animating');
          }, 140);
        }

        // Restore scroll position
        requestAnimationFrame(() => {
          if (tab.paneEl) {
            tab.paneEl.scrollTop = tab.scrollPos.top;
            tab.paneEl.scrollLeft = tab.scrollPos.left;
          }
        });
      }

      try {
        this.onActivate(tab);
      } catch (err) {
        console.error(`[TabWorkspace] onActivate callback error for tab "${tabId}":`, err);
      }

      this._saveSession();
      return true;
    }

    _ensureChipVisible(chipEl) {
      if (!chipEl) return;
      chipEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }

    /**
     * Closes a tab with dirty protection and neighbor activation.
     */
    async closeTab(tabId, force = false) {
      const tab = this.tabs.get(tabId);
      if (!tab) return false;
      if (tab.isPinned) {
        if (typeof showToast === 'function') showToast('Pinned tabs cannot be closed.', 'info');
        return false;
      }

      // Dirty check
      if (tab.isDirty && !force) {
        if (typeof this.confirmCloseDirty === 'function') {
          const userConfirmed = await this.confirmCloseDirty(tab);
          if (!userConfirmed) return false;
        } else {
          const confirmed = window.confirm(`Tab "${tab.title}" has unsaved draft changes. Discard changes and close?`);
          if (!confirmed) return false;
        }
      }

      // If closing a split secondary tab, exit split view
      if (this.isSplit && this.secondaryTabId === tabId) {
        this.exitSplit();
      }

      // Determine neighbor to activate if active tab is being closed
      const isClosingActive = this.activeTabId === tabId;
      let nextTabId = null;

      if (isClosingActive) {
        const tabKeys = Array.from(this.tabs.keys());
        const currentIndex = tabKeys.indexOf(tabId);
        if (currentIndex > 0) {
          nextTabId = tabKeys[currentIndex - 1]; // Left neighbor
        } else if (currentIndex < tabKeys.length - 1) {
          nextTabId = tabKeys[currentIndex + 1]; // Right neighbor
        } else {
          for (let i = this.activationHistory.length - 1; i >= 0; i--) {
            const histId = this.activationHistory[i];
            if (histId !== tabId && this.tabs.has(histId)) {
              nextTabId = histId;
              break;
            }
          }
        }
      }

      // Teardown DOM
      if (tab.chipEl) {
        tab.chipEl.remove();
        tab.chipEl = null;
      }
      if (tab.paneEl) {
        tab.paneEl.remove();
        tab.paneEl = null;
      }

      this.tabs.delete(tabId);
      this.activationHistory = this.activationHistory.filter(id => id !== tabId);

      this._updateOverflowButtonState();

      try {
        this.onClose(tab);
      } catch (err) {
        console.error(`[TabWorkspace] onClose callback error:`, err);
      }

      if (isClosingActive && nextTabId && this.tabs.has(nextTabId)) {
        this.activateTab(nextTabId);
      } else if (isClosingActive) {
        this.activeTabId = null;
      }

      this._saveSession();
      return true;
    }

    /**
     * Marks a tab as dirty (unsaved draft modifications).
     */
    markDirty(tabId, isDirty = true) {
      const tab = this.tabs.get(tabId);
      if (!tab) return;
      tab.isDirty = Boolean(isDirty);

      if (tab.chipEl) {
        const dot = tab.chipEl.querySelector('.tt-tab-dirty-dot');
        if (dot) dot.style.display = tab.isDirty ? 'inline-block' : 'none';
      }

      try {
        this.onDirtyChange(tab, tab.isDirty);
      } catch (err) {
        console.error(`[TabWorkspace] onDirtyChange callback error:`, err);
      }
    }

    setTabMode(tabId, mode) {
      const tab = this.tabs.get(tabId);
      if (!tab) return;
      tab.mode = mode === 'development' ? 'development' : 'production';
      this._saveSession();
    }

    getActiveTab() {
      return this.activeTabId ? this.tabs.get(this.activeTabId) || null : null;
    }

    getTab(tabId) {
      return this.tabs.get(tabId) || null;
    }

    getAllTabs() {
      return Array.from(this.tabs.values());
    }

    closeOldestUnpinnedTab() {
      for (const [id, tab] of this.tabs.entries()) {
        if (!tab.isPinned && !tab.isDirty && id !== this.activeTabId) {
          this.closeTab(id, true);
          return true;
        }
      }
      return false;
    }

    refreshTab(tabId = null) {
      const id = tabId || this.activeTabId;
      if (!id) return;
      const tab = this.tabs.get(id);
      if (!tab || !tab.paneEl) return;
      try {
        this.renderTab(tab, tab.paneEl);
      } catch (err) {
        console.error(`[TabWorkspace] Error refreshing tab "${id}":`, err);
      }
    }

    init() {
      if (!this.tabstripEl) this.tabstripEl = document.querySelector('.tt-tabstrip');
      if (!this.viewportEl) this.viewportEl = document.querySelector('.tt-viewport-container');
      this._initAccessibility();
      this._initControls();
    }

    // =========================================================================
    // DUAL-MODE SPLIT SCREEN & SIDEBAR AUTO-HIDE (Milestone 2)
    // =========================================================================

    /**
     * Toggles Split View mode.
     */
    toggleSplit(targetSecondaryId = null) {
      if (this.isSplit) {
        this.exitSplit();
        return;
      }

      if (this.tabs.size < 2) {
        // Automatically open a companion class section tab if only 1 tab open
        const openSectionNames = new Set(
          Array.from(this.tabs.values())
            .filter(t => t.viewType === 'section')
            .map(t => t.viewParams?.sectionName || t.viewParams?.classId || t.title)
        );
        const candidate = (window.SECTIONS || []).find(s => !openSectionNames.has(s)) || 'Section B';
        const comp = this.openTab({
          id: buildTabId('section', { classId: candidate }),
          title: candidate,
          icon: '📅',
          viewType: 'section',
          viewParams: { classId: candidate, sectionName: candidate },
          mode: this.getActiveTab()?.mode || 'production',
          activate: false
        });
        targetSecondaryId = comp ? comp.id : null;
      }

      if (!targetSecondaryId) {
        // Pick the most recent alternate tab
        for (let i = this.activationHistory.length - 1; i >= 0; i--) {
          const id = this.activationHistory[i];
          if (id !== this.activeTabId && this.tabs.has(id)) {
            targetSecondaryId = id;
            break;
          }
        }
        if (!targetSecondaryId) {
          const keys = Array.from(this.tabs.keys());
          targetSecondaryId = keys.find(k => k !== this.activeTabId);
        }
      }

      if (!targetSecondaryId || !this.tabs.has(targetSecondaryId)) {
        if (typeof showToast === 'function') showToast('Please open at least two views to split screen.', 'info');
        return;
      }

      this.isSplit = true;
      this.secondaryTabId = targetSecondaryId;

      const splitBtn = document.getElementById('tt-split-btn');
      if (splitBtn) splitBtn.classList.add('active');

      // Auto-collapse sidebar if screen width < 1600px
      this._applySidebarAutoCollapse();

      // Render split viewport container
      this._mountSplitViewport();

      // Setup cross-pane hover linking
      this._initCrossPaneHoverLinking();

      if (typeof showToast === 'function') {
        showToast('Dual-pane split view active. Drag divider to resize.', 'success');
      }
    }

    exitSplit() {
      if (!this.isSplit) return;
      this.isSplit = false;

      const splitBtn = document.getElementById('tt-split-btn');
      if (splitBtn) splitBtn.classList.remove('active');

      // Restore sidebar
      this._restoreSidebar();

      // Unmount split container & move panes back to main viewport
      const splitEl = document.getElementById('tt-split-viewport');
      if (splitEl) {
        this.tabs.forEach((tab) => {
          if (tab.paneEl && tab.paneEl.parentElement !== this.viewportEl) {
            this.viewportEl.appendChild(tab.paneEl);
          }
        });
        splitEl.remove();
        this.splitContainerEl = null;
      }

      // Ensure active tab is visible and secondary tab returns to steady-state hidden
      if (this.secondaryTabId && this.secondaryTabId !== this.activeTabId) {
        const sec = this.tabs.get(this.secondaryTabId);
        if (sec && sec.paneEl) {
          sec.paneEl.hidden = true;
          sec.paneEl.style.display = 'none';
          sec.paneEl.classList.remove('active');
        }
      }
      this.secondaryTabId = null;

      if (this.activeTabId) {
        const active = this.tabs.get(this.activeTabId);
        if (active && active.paneEl) {
          active.paneEl.hidden = false;
          active.paneEl.style.display = 'block';
          active.paneEl.classList.add('active');
        }
      }

      if (typeof showToast === 'function') {
        showToast('Split view closed.', 'info');
      }
    }

    _applySidebarAutoCollapse() {
      if (window.innerWidth < 1600) {
        const sb = document.querySelector('aside.sb');
        const mc = document.querySelector('main.mc');
        const floatToggle = document.getElementById('sb-float-toggle');

        if (sb && !sb.classList.contains('sb-split-collapsed')) {
          sb.classList.add('sb-split-collapsed');
          if (floatToggle) floatToggle.style.display = 'inline-flex';

          // Snap margin on transitionend
          const onTransitionEnd = (e) => {
            if (e.propertyName === 'transform') {
              if (mc) mc.classList.add('mc-split-expanded');
              sb.removeEventListener('transitionend', onTransitionEnd);
            }
          };
          sb.addEventListener('transitionend', onTransitionEnd);
        }
      }
    }

    _restoreSidebar() {
      const sb = document.querySelector('aside.sb');
      const mc = document.querySelector('main.mc');
      const floatToggle = document.getElementById('sb-float-toggle');

      if (sb) {
        sb.classList.remove('sb-split-collapsed');
        if (mc) mc.classList.remove('mc-split-expanded');
        if (floatToggle) floatToggle.style.display = 'none';
      }
    }

    _mountSplitViewport() {
      const primaryTab = this.tabs.get(this.activeTabId);
      const secondaryTab = this.tabs.get(this.secondaryTabId);
      if (!primaryTab || !secondaryTab || !this.viewportEl) return;

      let splitEl = document.getElementById('tt-split-viewport');
      if (!splitEl) {
        splitEl = document.createElement('div');
        splitEl.id = 'tt-split-viewport';
        splitEl.className = `tt-split-viewport mode-${this.splitMode}`;
        this.viewportEl.appendChild(splitEl);
      }
      this.splitContainerEl = splitEl;

      const isVertical = this.splitMode === 'vertical';
      const primaryBasis = `${Math.round(this.splitRatio * 100)}%`;

      splitEl.innerHTML = `
        <div class="tt-split-pane-primary" id="tt-split-primary-pane" style="${isVertical ? `width:${primaryBasis};` : `height:${primaryBasis};`}">
          <div id="tt-split-primary-body" style="height:100%;"></div>
        </div>
        <div class="tt-split-divider" id="tt-split-divider" title="Drag to resize · Double-click for 50:50"></div>
        <div class="tt-split-pane-secondary" id="tt-split-secondary-pane">
          <div class="tt-split-header">
            <div style="display:flex;align-items:center;gap:8px;">
              <span>${secondaryTab.icon}</span>
              <span>${this._escapeHtml(secondaryTab.title)}</span>
              <span style="font-size:10px;font-weight:700;color:var(--tmu,#5a7a5a);background:var(--gLt,#e8f5e9);padding:2px 6px;border-radius:4px;">SPLIT</span>
            </div>
            <div class="tt-split-controls">
              <button type="button" class="tt-split-ctrl-btn" id="btn-toggle-split-orient" title="Toggle Side-by-Side / Top-Bottom">
                ${isVertical ? '⬒ Top/Bottom' : '⧉ Side-by-Side'}
              </button>
              <button type="button" class="tt-split-ctrl-btn" id="btn-swap-split" title="Swap Left and Right Panes">⇄ Swap</button>
              <button type="button" class="tt-split-ctrl-btn" id="btn-close-split" title="Exit Split View">✕ Close</button>
            </div>
          </div>
          <div id="tt-split-secondary-body" style="height:calc(100% - 35px);overflow:auto;"></div>
        </div>
      `;

      // Move primary pane
      const primBody = document.getElementById('tt-split-primary-body');
      if (primBody && primaryTab.paneEl) {
        primBody.appendChild(primaryTab.paneEl);
        primaryTab.paneEl.hidden = false;
        primaryTab.paneEl.style.display = 'block';
        primaryTab.paneEl.classList.add('active');
      }

      // Move secondary pane
      const secBody = document.getElementById('tt-split-secondary-body');
      if (secBody && secondaryTab.paneEl) {
        secBody.appendChild(secondaryTab.paneEl);
        secondaryTab.paneEl.hidden = false;
        secondaryTab.paneEl.style.display = 'block';
        secondaryTab.paneEl.classList.add('active');
      }

      // Controls bindings
      document.getElementById('btn-close-split')?.addEventListener('click', () => this.exitSplit());
      document.getElementById('btn-swap-split')?.addEventListener('click', () => this._swapSplitPanes());
      document.getElementById('btn-toggle-split-orient')?.addEventListener('click', () => {
        this.setSplitOrientation(this.splitMode === 'vertical' ? 'horizontal' : 'vertical');
      });

      // Divider Drag Resizing
      const divider = document.getElementById('tt-split-divider');
      if (divider) {
        divider.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this._isDraggingDivider = true;
          divider.classList.add('dragging');
          document.body.style.cursor = this.splitMode === 'vertical' ? 'col-resize' : 'row-resize';
          document.body.style.userSelect = 'none';
          window.addEventListener('mousemove', this._onDividerMouseMove);
          window.addEventListener('mouseup', this._onDividerMouseUp);
        });

        // Double click reset to 50:50
        divider.addEventListener('dblclick', () => {
          this.setSplitRatio(0.5);
        });
      }

      // Secondary pane drop zone (drag tab from tabstrip to display in secondary split pane)
      const secPane = document.getElementById('tt-split-secondary-pane');
      if (secPane) {
        secPane.addEventListener('dragover', (e) => {
          if (!this._draggedTabId || this._draggedTabId === this.activeTabId || this._draggedTabId === this.secondaryTabId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          secPane.classList.add('tt-split-drop-target');
        });

        secPane.addEventListener('dragleave', (e) => {
          if (!secPane.contains(e.relatedTarget)) {
            secPane.classList.remove('tt-split-drop-target');
          }
        });

        secPane.addEventListener('drop', (e) => {
          secPane.classList.remove('tt-split-drop-target');
          const draggedId = this._draggedTabId || e.dataTransfer.getData('text/plain');
          if (draggedId && draggedId !== this.activeTabId && draggedId !== this.secondaryTabId) {
            e.preventDefault();
            this.setSecondaryTab(draggedId);
          }
        });
      }
    }

    /**
     * Switches the active tab displayed in the secondary split pane.
     */
    setSecondaryTab(tabId) {
      if (!this.isSplit) {
        this.toggleSplit(tabId);
        return;
      }
      if (!tabId || !this.tabs.has(tabId) || tabId === this.activeTabId) return;

      const oldSecTab = this.tabs.get(this.secondaryTabId);
      if (oldSecTab && oldSecTab.paneEl) {
        oldSecTab.paneEl.hidden = true;
        oldSecTab.paneEl.style.display = 'none';
        oldSecTab.paneEl.classList.remove('active');
        if (oldSecTab.paneEl.parentElement && oldSecTab.paneEl.parentElement !== this.viewportEl) {
          this.viewportEl.appendChild(oldSecTab.paneEl);
        }
      }

      this.secondaryTabId = tabId;
      const newSecTab = this.tabs.get(tabId);
      const secBody = document.getElementById('tt-split-secondary-body');
      if (secBody && newSecTab && newSecTab.paneEl) {
        secBody.appendChild(newSecTab.paneEl);
        newSecTab.paneEl.hidden = false;
        newSecTab.paneEl.style.display = 'block';
        newSecTab.paneEl.classList.add('active');
      }

      // Update secondary header title
      const secHeaderTitle = document.querySelector('#tt-split-secondary-pane .tt-split-header > div:first-child');
      if (secHeaderTitle && newSecTab) {
        secHeaderTitle.innerHTML = `
          <span>${newSecTab.icon}</span>
          <span>${this._escapeHtml(newSecTab.title)}</span>
          <span style="font-size:10px;font-weight:700;color:var(--tmu,#5a7a5a);background:var(--gLt,#e8f5e9);padding:2px 6px;border-radius:4px;">SPLIT</span>
        `;
      }
      this._saveSession();
    }

    _handleDividerDrag(e) {
      if (!this._isDraggingDivider || !this.splitContainerEl) return;
      const rect = this.splitContainerEl.getBoundingClientRect();

      if (this.splitMode === 'vertical') {
        const offset = e.clientX - rect.left;
        const ratio = Math.max(0.2, Math.min(0.8, offset / rect.width));
        this.setSplitRatio(ratio);
      } else {
        const offset = e.clientY - rect.top;
        const ratio = Math.max(0.2, Math.min(0.8, offset / rect.height));
        this.setSplitRatio(ratio);
      }
    }

    _stopDividerDrag() {
      if (!this._isDraggingDivider) return;
      this._isDraggingDivider = false;
      const divider = document.getElementById('tt-split-divider');
      if (divider) divider.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', this._onDividerMouseMove);
      window.removeEventListener('mouseup', this._onDividerMouseUp);
    }

    setSplitRatio(ratio) {
      this.splitRatio = ratio;
      const primPane = document.getElementById('tt-split-primary-pane');
      if (primPane) {
        const pct = `${Math.round(ratio * 100)}%`;
        if (this.splitMode === 'vertical') {
          primPane.style.width = pct;
          primPane.style.height = '100%';
        } else {
          primPane.style.height = pct;
          primPane.style.width = '100%';
        }
      }
    }

    setSplitOrientation(orientation) {
      this.splitMode = orientation === 'horizontal' ? 'horizontal' : 'vertical';
      if (this.splitContainerEl) {
        this.splitContainerEl.className = `tt-split-viewport mode-${this.splitMode}`;
        this.setSplitRatio(this.splitRatio);
        const orientBtn = document.getElementById('btn-toggle-split-orient');
        if (orientBtn) {
          orientBtn.textContent = this.splitMode === 'vertical' ? '⬒ Top/Bottom' : '⧉ Side-by-Side';
        }
      }
    }

    _swapSplitPanes() {
      const temp = this.activeTabId;
      this.activeTabId = this.secondaryTabId;
      this.secondaryTabId = temp;
      this._mountSplitViewport();
    }

    // ── Cross-Pane Hover-Linking (Step 2.3) ──
    _initCrossPaneHoverLinking() {
      if (!this.splitContainerEl) return;

      const onSlotEnter = (e) => {
        const slot = e.target.closest('.slot');
        if (!slot) return;
        const teacherName = slot.dataset.teacher || slot.querySelector('.slot-teacher')?.textContent?.trim();
        const roomName = slot.dataset.room || slot.querySelector('.slot-room')?.textContent?.trim();

        if (teacherName || roomName) {
          slot.classList.add('tt-slot-linked-active');
          const allSlots = this.splitContainerEl.querySelectorAll('.slot');
          allSlots.forEach(s => {
            if (s === slot) return;
            const sTeacher = s.dataset.teacher || s.querySelector('.slot-teacher')?.textContent?.trim();
            const sRoom = s.dataset.room || s.querySelector('.slot-room')?.textContent?.trim();
            if ((teacherName && sTeacher === teacherName) || (roomName && sRoom === roomName)) {
              s.classList.add('tt-slot-linked-match');
            }
          });
        }
      };

      const onSlotLeave = (e) => {
        const slot = e.target.closest('.slot');
        if (slot) slot.classList.remove('tt-slot-linked-active');
        const matches = this.splitContainerEl?.querySelectorAll('.tt-slot-linked-match');
        matches?.forEach(m => m.classList.remove('tt-slot-linked-match'));
      };

      this.splitContainerEl.removeEventListener('mouseover', onSlotEnter);
      this.splitContainerEl.removeEventListener('mouseout', onSlotLeave);
      this.splitContainerEl.addEventListener('mouseover', onSlotEnter);
      this.splitContainerEl.addEventListener('mouseout', onSlotLeave);
    }

    // ── Keyboard Navigation (ARIA Tablist Standard) ──
    _handleKeyNav(e) {
      const chips = Array.from(this.tabstripEl.querySelectorAll('.tt-tab-chip'));
      if (!chips.length) return;

      const activeChip = document.activeElement && chips.includes(document.activeElement)
        ? document.activeElement
        : chips.find(c => c.getAttribute('aria-selected') === 'true') || chips[0];

      const currentIndex = chips.indexOf(activeChip);
      let targetIndex = -1;

      switch (e.key) {
        case 'ArrowRight':
          targetIndex = (currentIndex + 1) % chips.length;
          break;
        case 'ArrowLeft':
          targetIndex = (currentIndex - 1 + chips.length) % chips.length;
          break;
        case 'Home':
          targetIndex = 0;
          break;
        case 'End':
          targetIndex = chips.length - 1;
          break;
        case 'Enter':
        case ' ':
          if (activeChip?.dataset.tabId) {
            e.preventDefault();
            this.activateTab(activeChip.dataset.tabId);
          }
          return;
        case 'Delete':
        case 'Backspace':
          if (activeChip?.dataset.tabId) {
            e.preventDefault();
            this.closeTab(activeChip.dataset.tabId);
          }
          return;
        default:
          return;
      }

      if (targetIndex >= 0 && chips[targetIndex]) {
        e.preventDefault();
        chips[targetIndex].focus();
        if (chips[targetIndex].dataset.tabId) {
          this.activateTab(chips[targetIndex].dataset.tabId);
        }
      }
    }

    // ── Global Shortcuts (Alt + 1..9, Alt + W, Alt + S, Alt + T) ──
    _handleGlobalShortcuts(e) {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        // Alt + 1..9
        if (/^[1-9]$/.test(e.key)) {
          const index = parseInt(e.key, 10) - 1;
          const tabKeys = Array.from(this.tabs.keys());
          if (tabKeys[index]) {
            e.preventDefault();
            this.activateTab(tabKeys[index]);
          }
          return;
        }

        // Alt + W: Close active tab
        if (e.key === 'w' || e.key === 'W') {
          if (this.activeTabId) {
            e.preventDefault();
            this.closeTab(this.activeTabId);
          }
          return;
        }

        // Alt + S: Toggle split view
        if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          this.toggleSplit();
          return;
        }

        // Alt + T: Open new tab launcher
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          const launcher = document.getElementById('tt-tab-launcher');
          if (launcher) {
            const isOpen = launcher.style.display !== 'none';
            launcher.style.display = isOpen ? 'none' : 'flex';
          }
          return;
        }
      }
    }

    // ── Session Storage Persistence ──
    _saveSession() {
      try {
        const serialized = {
          activeTabId: this.activeTabId,
          isSplit: this.isSplit,
          splitMode: this.splitMode,
          secondaryTabId: this.secondaryTabId,
          splitRatio: this.splitRatio,
          tabs: Array.from(this.tabs.values())
            .filter(t => t.viewType === 'section' || String(t.id).startsWith('section:'))
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

        const sectionTabs = data.tabs.filter(item => item.viewType === 'section' || String(item.id).startsWith('section:'));
        for (const item of sectionTabs) {
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
            viewType: 'section',
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

  // Expose to window
  window.TabWorkspace = TabWorkspace;
  window.buildTabId = buildTabId;
})();
