/**
 * public/js/pages/bulk/bulk.menu.js
 * 3-Dot Chat Manager Menu, Participants Management, Non-Destructive Undo Dialog,
 * and Soft-Delete Dialog for Bulk Operations (P7, §8).
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var util = root.Bulk.util || {};
  var api = root.Bulk.api || {};
  var store = root.Bulk.store || {};
  var avatarHelper = root.Bulk.avatar || {};

  var activeMenuEl = null;
  var activeTriggerEl = null;
  var activeParticipantsModal = null;
  var activeUndoModal = null;
  var activeDeleteModal = null;

  // ── ROLE & PERMISSION HELPERS ──
  function isSudo(user) {
    if (!user) return false;
    return user.role === 'sudo' || user.isSudoAdmin || user.accessRole === 'sudoAdmin';
  }

  function isSuper(user) {
    if (!user) return false;
    return user.role === 'admin' && user.adminFlag !== 'subadmin';
  }

  function isOwner(user, batch) {
    if (!user || !batch || !batch.uploadedBy) return false;
    var uid = String(user._id || user.userId || '');
    var uploaderId = String(batch.uploadedBy.userId || batch.uploadedBy._id || '');
    return uid && uploaderId && uid === uploaderId;
  }

  function isParticipant(user, batch) {
    if (!user || !batch) return false;
    var uid = String(user._id || user.userId || '');
    if (isOwner(user, batch)) return true;
    return Array.isArray(batch.participants) && batch.participants.some(function (p) {
      return String(p.userId || p._id || '') === uid;
    });
  }

  function canManage(user, batch) {
    if (!user || !batch) return false;
    return isSudo(user) || isSuper(user) || isOwner(user, batch);
  }

  function canAddUser(user, batch) {
    if (!user || !batch) return false;
    if (batch.closed && batch.closed.at) return false;
    return canManage(user, batch);
  }

  function getUndoPermission(user, batch) {
    if (!user || !batch) return { allowed: false, reason: 'Authentication required' };
    if (batch.closed && batch.closed.at) {
      return { allowed: false, reason: "Closed imports can't be undone" };
    }
    if (batch.status === 'committing' || batch.status === 'committed') {
      return { allowed: false, reason: "Committed imports can't be undone" };
    }
    if (batch.status === 'uploading' || batch.status === 'processing') {
      return { allowed: false, reason: 'Processing in progress — cannot undo right now' };
    }

    if (isSudo(user) || isSuper(user)) {
      return { allowed: true };
    }

    if (isOwner(user, batch)) {
      var preApproval = ['draft', 'staged', 'skipped_resolved', 'pending_sudo_initial', 'rejected', 'failed', 'cancelled'].includes(batch.status);
      if (preApproval) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'Only Sudo or Super Admin can undo after initial approval' };
    }

    return { allowed: false, reason: 'Only administrators or the chat owner can undo actions' };
  }

  function canDeleteForEveryone(user, batch) {
    if (!user || !batch) return false;
    if (batch.closed && batch.closed.at) return false;
    if (batch.status === 'committing' || batch.status === 'committed') return false;

    if (isSudo(user) || isSuper(user)) return true;
    if (isOwner(user, batch)) {
      var preApproval = ['draft', 'staged', 'skipped_resolved', 'pending_sudo_initial', 'rejected', 'failed', 'cancelled'].includes(batch.status);
      return preApproval;
    }
    return false;
  }

  // ── 1. 3-DOT CHAT MANAGER MENU ──

  function closeMenu() {
    if (activeMenuEl && activeMenuEl.parentNode) {
      activeMenuEl.parentNode.removeChild(activeMenuEl);
    }
    activeMenuEl = null;
    if (activeTriggerEl) {
      activeTriggerEl.setAttribute('aria-expanded', 'false');
      activeTriggerEl = null;
    }
    document.removeEventListener('click', onDocClickCloseMenu);
    document.removeEventListener('keydown', onMenuKeyDown);
  }

  function onDocClickCloseMenu(e) {
    if (activeMenuEl && !activeMenuEl.contains(e.target) && (!activeTriggerEl || !activeTriggerEl.contains(e.target))) {
      closeMenu();
    }
  }

  function onMenuKeyDown(e) {
    if (!activeMenuEl) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      var trigger = activeTriggerEl;
      closeMenu();
      if (trigger) trigger.focus();
      return;
    }

    var items = Array.prototype.slice.call(activeMenuEl.querySelectorAll('.chat-menu-item:not([disabled])'));
    if (!items.length) return;
    var currentIndex = items.indexOf(document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      var next = (currentIndex + 1) % items.length;
      items[next].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      var prev = (currentIndex - 1 + items.length) % items.length;
      items[prev].focus();
    }
  }

  function openMenu(triggerEl, batchId) {
    closeMenu();
    if (!triggerEl) return;

    var state = store.getState();
    var user = state.user;
    var batch = (state.batch && (state.batch._id === batchId || state.batch.batchTrackId === batchId))
      ? state.batch
      : ((state.chats || []).find(function (c) { return c._id === batchId; }));

    if (!batch) return;

    var isClosed = Boolean(batch.closed && batch.closed.at);
    var addCheck = canAddUser(user, batch);
    var undoCheck = getUndoPermission(user, batch);
    var canDelAll = canDeleteForEveryone(user, batch);
    var canRen = canManage(user, batch) && !isClosed;

    var menu = document.createElement('div');
    menu.className = 'chat-dropdown-menu';
    menu.id = 'bulk-chat-dropdown';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-orientation', 'vertical');

    var addTitle = isClosed ? 'Closed imports cannot add users' : (!canManage(user, batch) ? 'Only owner or administrators can add participants' : '');
    var undoTitle = undoCheck.allowed ? '' : undoCheck.reason;
    var renameTitle = !canRen ? (isClosed ? 'Closed imports cannot be renamed' : 'Only owner or administrators can rename') : '';

    menu.innerHTML =
      '<button type="button" class="chat-menu-item" role="menuitem" data-action="menu-add-user" ' +
        (addCheck ? '' : 'disabled title="' + util.esc(addTitle) + '"') + '>' +
        '<re-icon icon="user-plus" size="14"></re-icon>' +
        '<span>Add new user…</span>' +
      '</button>' +
      '<button type="button" class="chat-menu-item" role="menuitem" data-action="menu-undo" ' +
        (undoCheck.allowed ? '' : 'disabled title="' + util.esc(undoTitle) + '"') + '>' +
        '<re-icon icon="rotate-ccw" size="14"></re-icon>' +
        '<span>Undo all actions…</span>' +
      '</button>' +
      '<button type="button" class="chat-menu-item text-danger" role="menuitem" data-action="menu-delete">' +
        '<re-icon icon="trash-2" size="14"></re-icon>' +
        '<span>Delete chat…</span>' +
      '</button>' +
      '<div class="chat-menu-divider" role="separator"></div>' +
      '<button type="button" class="chat-menu-item" role="menuitem" data-action="menu-copy-link">' +
        '<re-icon icon="copy" size="14"></re-icon>' +
        '<span>Copy link</span>' +
      '</button>' +
      '<button type="button" class="chat-menu-item" role="menuitem" data-action="menu-rename" ' +
        (canRen ? '' : 'disabled title="' + util.esc(renameTitle) + '"') + '>' +
        '<re-icon icon="edit-2" size="14"></re-icon>' +
        '<span>Rename</span>' +
      '</button>';

    document.body.appendChild(menu);

    // Position menu relative to trigger
    var rect = triggerEl.getBoundingClientRect();
    var menuWidth = 190;
    var menuHeight = menu.offsetHeight || 190;

    var top = rect.bottom + window.scrollY + 4;
    var left = rect.left + window.scrollX - menuWidth + rect.width;

    if (left < 10) left = 10;
    if (left + menuWidth > window.innerWidth - 10) {
      left = window.innerWidth - menuWidth - 10;
    }
    if (top + menuHeight > window.innerHeight + window.scrollY - 10) {
      top = rect.top + window.scrollY - menuHeight - 4;
    }

    menu.style.top = Math.max(10, top) + 'px';
    menu.style.left = Math.max(10, left) + 'px';

    activeMenuEl = menu;
    activeTriggerEl = triggerEl;
    triggerEl.setAttribute('aria-expanded', 'true');

    // Menu actions binding
    menu.addEventListener('click', function (e) {
      var item = e.target.closest('.chat-menu-item');
      if (!item || item.disabled) return;
      var action = item.getAttribute('data-action');

      closeMenu();

      if (action === 'menu-add-user') {
        openParticipantsModal(batch);
      } else if (action === 'menu-undo') {
        openUndoModal(batch);
      } else if (action === 'menu-delete') {
        openDeleteModal(batch);
      } else if (action === 'menu-copy-link') {
        var tid = batch.batchTrackId || batch.trackId || batch._id;
        if (root.Bulk.router) {
          root.Bulk.router.copyLink(tid);
        } else {
          var link = window.location.origin + window.location.pathname + '?bulk=' + encodeURIComponent(tid);
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(function () {
              if (typeof root.showToast === 'function') root.showToast('Link copied to clipboard');
            });
          }
        }
      } else if (action === 'menu-rename') {
        var currentTitle = batch.title || '';
        var newTitle = window.prompt('Rename import chat:', currentTitle);
        if (newTitle && newTitle.trim() && newTitle.trim() !== currentTitle) {
          api.renameBatch(batch._id, newTitle.trim()).then(function (res) {
            if (typeof root.showToast === 'function') root.showToast('Chat renamed');
            root.Bulk.sidebar.refresh();
            if (state.activeId === batch._id) {
              var titleEl = document.getElementById('chat-header-title');
              if (titleEl) titleEl.textContent = newTitle.trim();
            }
          }).catch(function (err) {
            if (typeof root.showToast === 'function') root.showToast('Rename failed: ' + err.message, 'warn');
          });
        }
      }
    });

    // Focus first active item
    setTimeout(function () {
      var first = menu.querySelector('.chat-menu-item:not([disabled])');
      if (first) first.focus();
      document.addEventListener('click', onDocClickCloseMenu);
      document.addEventListener('keydown', onMenuKeyDown);
    }, 10);
  }

  // ── 2. PARTICIPANTS MANAGEMENT & HEADER AVATAR STACK ──

  function renderHeaderParticipants(batch) {
    var container = document.getElementById('chat-header-participants');
    if (!container) return;

    if (!batch) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    var ownerName = (batch.uploadedBy && batch.uploadedBy.name) || 'Owner';
    var participants = Array.isArray(batch.participants) ? batch.participants : [];
    var all = [{ name: ownerName, isOwner: true }].concat(participants);

    container.style.display = 'inline-flex';
    container.style.alignItems = 'center';
    container.style.cursor = 'pointer';
    container.setAttribute('title', 'Participants (' + all.length + ') — Click to manage');

    var maxVisible = 3;
    var visible = all.slice(0, maxVisible);
    var remaining = all.length - maxVisible;

    var html = '<div class="chat-avatar-stack">';
    for (var i = 0; i < visible.length; i++) {
      var p = visible[i];
      var pName = p.name || 'User';
      var initials = (avatarHelper.initials ? avatarHelper.initials(pName) : pName.charAt(0)).toUpperCase();
      var bg = avatarHelper.color ? avatarHelper.color(pName) : '#2e7d32';
      html += '<div class="chat-avatar-stack-item" style="background:' + bg + ';" title="' + util.esc(pName) + (p.isOwner ? ' (Owner)' : '') + '">' +
        util.esc(initials) +
      '</div>';
    }
    if (remaining > 0) {
      html += '<div class="chat-avatar-stack-more">+' + remaining + '</div>';
    }
    html += '</div>';

    container.innerHTML = html;
    container.onclick = function () {
      openParticipantsModal(batch);
    };
  }

  function closeParticipantsModal() {
    if (activeParticipantsModal && activeParticipantsModal.parentNode) {
      activeParticipantsModal.parentNode.removeChild(activeParticipantsModal);
    }
    activeParticipantsModal = null;
  }

  function openParticipantsModal(batch) {
    closeParticipantsModal();
    if (!batch) return;

    var state = store.getState();
    var user = state.user;
    var canEdit = canAddUser(user, batch);
    var participants = Array.isArray(batch.participants) ? batch.participants.slice() : [];
    var ownerName = (batch.uploadedBy && batch.uploadedBy.name) || 'Batch Owner';
    var ownerTrackId = (batch.uploadedBy && batch.uploadedBy.trackId) || '';

    var modal = document.createElement('div');
    modal.className = 'participants-modal-backdrop';
    modal.id = 'bulk-participants-modal';

    function renderModalBody() {
      var count = participants.length + 1;
      var countLabel = count + ' / 10';

      var listHtml = '';
      // Owner row
      var ownerInitials = (avatarHelper.initials ? avatarHelper.initials(ownerName) : ownerName.charAt(0)).toUpperCase();
      var ownerBg = avatarHelper.color ? avatarHelper.color(ownerName) : '#2e7d32';
      listHtml += '<div class="participant-row owner-row">' +
        '<div class="participant-av" style="background:' + ownerBg + ';">' + util.esc(ownerInitials) + '</div>' +
        '<div class="participant-info">' +
          '<div class="participant-name">' + util.esc(ownerName) + ' <span class="participant-badge owner-badge">Owner</span></div>' +
          '<div class="participant-sub">' + (ownerTrackId ? util.esc(ownerTrackId) + ' · ' : '') + 'Full access &amp; control</div>' +
        '</div>' +
      '</div>';

      // Participant rows
      for (var i = 0; i < participants.length; i++) {
        var p = participants[i];
        var pName = p.name || 'User';
        var pInitials = (avatarHelper.initials ? avatarHelper.initials(pName) : pName.charAt(0)).toUpperCase();
        var pBg = avatarHelper.color ? avatarHelper.color(pName) : '#2e7d32';
        var isMe = String(user && (user._id || user.userId)) === String(p.userId);

        var levelBadge = p.level === 'collaborator'
          ? '<span class="participant-badge collab-badge">Collaborator</span>'
          : '<span class="participant-badge viewer-badge">Viewer</span>';

        listHtml += '<div class="participant-row" data-user-id="' + util.esc(p.userId) + '">' +
          '<div class="participant-av" style="background:' + pBg + ';">' + util.esc(pInitials) + '</div>' +
          '<div class="participant-info">' +
            '<div class="participant-name">' + util.esc(pName) + ' ' + levelBadge + '</div>' +
            '<div class="participant-sub">' + (p.trackId ? util.esc(p.trackId) + ' · ' : '') + (p.role || 'Member') + '</div>' +
          '</div>' +
          '<div class="participant-actions">';

        if (canEdit && !isMe) {
          listHtml += '<select class="participant-level-select" data-action="change-level" data-user-id="' + util.esc(p.userId) + '">' +
            '<option value="viewer" ' + (p.level === 'viewer' ? 'selected' : '') + '>Viewer</option>' +
            '<option value="collaborator" ' + (p.level === 'collaborator' ? 'selected' : '') + '>Collaborator</option>' +
          '</select>' +
          '<button type="button" class="btn-icon-sub text-danger" data-action="remove-user" data-user-id="' + util.esc(p.userId) + '" title="Remove from chat">' +
            '<re-icon icon="trash-2" size="13"></re-icon>' +
          '</button>';
        } else if (isMe) {
          listHtml += '<button type="button" class="btn-out" style="padding:4px 8px;font-size:11px;" data-action="leave-chat" data-user-id="' + util.esc(p.userId) + '">Leave chat</button>';
        }

        listHtml += '</div></div>';
      }

      var searchSection = '';
      if (canEdit && participants.length < 9) {
        searchSection =
          '<div class="participant-search-section">' +
            '<label style="font-size:12px;font-weight:600;color:var(--td);display:block;margin-bottom:6px;">Add Member</label>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
              '<input type="text" id="p-search-input" class="p-search-input" placeholder="Search faculty by name or track ID…" autocomplete="off">' +
              '<select id="p-add-level" class="p-level-select" style="padding:8px;border-radius:8px;border:1px solid var(--br);font-size:12px;">' +
                '<option value="collaborator">Collaborator</option>' +
                '<option value="viewer">Viewer</option>' +
              '</select>' +
            '</div>' +
            '<div id="p-search-results" class="p-search-results" style="display:none;"></div>' +
          '</div>';
      }

      modal.innerHTML =
        '<div class="participants-modal-box">' +
          '<div class="participants-modal-header">' +
            '<div>' +
              '<div style="font-weight:700;font-size:15px;color:var(--td);">Manage Participants</div>' +
              '<div style="font-size:11px;color:var(--tmu);">' + util.esc(batch.batchTrackId || batch._id) + ' · ' + countLabel + '</div>' +
            '</div>' +
            '<button type="button" class="modal-close" data-action="close-participants">✕</button>' +
          '</div>' +
          '<div class="participants-modal-body">' +
            searchSection +
            '<div class="participants-list-title">Current Members (' + count + ')</div>' +
            '<div class="participants-list">' + listHtml + '</div>' +
          '</div>' +
          '<div class="participants-modal-footer">' +
            '<button type="button" class="btn-out" data-action="close-participants">Done</button>' +
          '</div>' +
        '</div>';

      bindModalEvents();
    }

    function bindModalEvents() {
      // Close buttons
      var closeBtns = modal.querySelectorAll('[data-action="close-participants"]');
      closeBtns.forEach(function (btn) {
        btn.onclick = closeParticipantsModal;
      });

      // Search input
      var searchInput = modal.querySelector('#p-search-input');
      var resultsContainer = modal.querySelector('#p-search-results');
      var levelSelect = modal.querySelector('#p-add-level');

      if (searchInput && resultsContainer) {
        searchInput.oninput = util.debounce(function (e) {
          var q = (e.target.value || '').trim();
          if (q.length < 2) {
            resultsContainer.style.display = 'none';
            resultsContainer.innerHTML = '';
            return;
          }

          api.searchUsers(q).then(function (res) {
            var users = (res && res.users) || ((res && res.data && res.data.users) ? res.data.users : []);
            // Filter out existing participants and owner
            var existingUids = [String(batch.uploadedBy && batch.uploadedBy.userId)].concat(
              participants.map(function (p) { return String(p.userId); })
            );
            var eligible = users.filter(function (u) {
              return !existingUids.includes(String(u.userId));
            });

            if (!eligible.length) {
              resultsContainer.innerHTML = '<div style="padding:10px;text-align:center;font-size:12px;color:var(--tmu);">No matching users found</div>';
              resultsContainer.style.display = 'block';
              return;
            }

            var html = '';
            eligible.forEach(function (u) {
              var uInitials = (avatarHelper.initials ? avatarHelper.initials(u.name) : u.name.charAt(0)).toUpperCase();
              var uBg = avatarHelper.color ? avatarHelper.color(u.name) : '#2e7d32';
              html += '<div class="p-search-item" data-user-id="' + util.esc(u.userId) + '" data-user-name="' + util.esc(u.name) + '">' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                  '<div class="participant-av" style="background:' + uBg + ';width:28px;height:28px;font-size:11px;">' + util.esc(uInitials) + '</div>' +
                  '<div>' +
                    '<div style="font-weight:600;font-size:12.5px;color:var(--td);">' + util.esc(u.name) + '</div>' +
                    '<div style="font-size:10.5px;color:var(--tmu);">' + (u.deptName ? util.esc(u.deptName) + ' · ' : '') + util.esc(u.role || 'Teacher') + '</div>' +
                  '</div>' +
                '</div>' +
                '<button type="button" class="btn-out" style="padding:4px 10px;font-size:11px;" data-action="add-user-btn" data-user-id="' + util.esc(u.userId) + '">Add</button>' +
              '</div>';
            });

            resultsContainer.innerHTML = html;
            resultsContainer.style.display = 'block';
          }).catch(function (err) {
            resultsContainer.innerHTML = '<div style="padding:10px;text-align:center;font-size:12px;color:var(--tmu);">Search error: ' + util.esc(err.message) + '</div>';
            resultsContainer.style.display = 'block';
          });
        }, 250);
      }

      // Delegate add user click
      modal.onclick = function (e) {
        var addBtn = e.target.closest('[data-action="add-user-btn"]');
        if (addBtn) {
          var targetUid = addBtn.getAttribute('data-user-id');
          var level = (levelSelect && levelSelect.value) || 'collaborator';
          addBtn.disabled = true;
          addBtn.textContent = 'Adding…';

          api.addParticipant(batch._id, targetUid, level).then(function (res) {
            var updated = (res && res.batch) || ((res && res.data && res.data.batch) ? res.data.batch : null);
            if (updated && updated.participants) {
              participants = updated.participants.slice();
              batch.participants = participants;
            }
            if (typeof root.showToast === 'function') root.showToast('Participant added');
            renderHeaderParticipants(batch);
            renderModalBody();
          }).catch(function (err) {
            addBtn.disabled = false;
            addBtn.textContent = 'Add';
            if (typeof root.showToast === 'function') root.showToast('Could not add user: ' + err.message, 'warn');
          });
          return;
        }

        var removeBtn = e.target.closest('[data-action="remove-user"]') || e.target.closest('[data-action="leave-chat"]');
        if (removeBtn) {
          var rUid = removeBtn.getAttribute('data-user-id');
          var isLeave = removeBtn.getAttribute('data-action') === 'leave-chat';
          var promptMsg = isLeave ? 'Are you sure you want to leave this import chat?' : 'Remove this user from the chat?';
          if (!window.confirm(promptMsg)) return;

          api.removeParticipant(batch._id, rUid).then(function (res) {
            if (typeof root.showToast === 'function') root.showToast(isLeave ? 'You left the chat' : 'Participant removed');
            if (isLeave) {
              closeParticipantsModal();
              root.Bulk.sidebar.refresh().then(function () {
                if (root.Bulk.openChat) root.Bulk.openChat(null);
              });
            } else {
              var updated = (res && res.batch) || ((res && res.data && res.data.batch) ? res.data.batch : null);
              if (updated && updated.participants) {
                participants = updated.participants.slice();
                batch.participants = participants;
              } else {
                participants = participants.filter(function (p) { return String(p.userId) !== String(rUid); });
                batch.participants = participants;
              }
              renderHeaderParticipants(batch);
              renderModalBody();
            }
          }).catch(function (err) {
            if (typeof root.showToast === 'function') root.showToast('Error: ' + err.message, 'warn');
          });
          return;
        }
      };

      // Change level change listener
      var levelSelects = modal.querySelectorAll('[data-action="change-level"]');
      levelSelects.forEach(function (sel) {
        sel.onchange = function (e) {
          var tUid = sel.getAttribute('data-user-id');
          var newLvl = sel.value;
          api.updateParticipantLevel(batch._id, tUid, newLvl).then(function (res) {
            if (typeof root.showToast === 'function') root.showToast('Access level updated');
            var updated = (res && res.batch) || ((res && res.data && res.data.batch) ? res.data.batch : null);
            if (updated && updated.participants) {
              participants = updated.participants.slice();
              batch.participants = participants;
            }
            renderModalBody();
          }).catch(function (err) {
            if (typeof root.showToast === 'function') root.showToast('Update failed: ' + err.message, 'warn');
            renderModalBody();
          });
        };
      });
    }

    renderModalBody();
    document.body.appendChild(modal);
    activeParticipantsModal = modal;
  }

  // ── 3. NON-DESTRUCTIVE UNDO ALL ACTIONS DIALOG ──

  function closeUndoModal() {
    if (activeUndoModal && activeUndoModal.parentNode) {
      activeUndoModal.parentNode.removeChild(activeUndoModal);
    }
    activeUndoModal = null;
  }

  function openUndoModal(batch) {
    closeUndoModal();
    if (!batch) return;

    var modal = document.createElement('div');
    modal.className = 'undo-modal-backdrop';
    modal.id = 'bulk-undo-modal';

    // Calculate irreversible mailed rows
    var mailedCount = 0;
    if (Array.isArray(batch.eligibleRows)) {
      mailedCount = batch.eligibleRows.filter(function (r) {
        return r && r.mail && r.mail.mode === 'sent';
      }).length;
    }

    var irreversibleNotice = '';
    if (mailedCount > 0) {
      irreversibleNotice =
        '<div class="undo-irreversible-box">' +
          '<div style="display:flex;align-items:flex-start;gap:8px;">' +
            '<re-icon icon="alert-triangle" size="16" style="color:#b45309;flex-shrink:0;margin-top:2px;"></re-icon>' +
            '<div style="font-size:12px;color:#92400e;line-height:1.45;">' +
              '<b>Irreversible side-effect:</b> ' + mailedCount + ' credential e-mail' + (mailedCount > 1 ? 's were' : ' was') + ' already dispatched to recipients and cannot be recalled.' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    modal.innerHTML =
      '<div class="undo-modal-box">' +
        '<div class="undo-modal-header">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="width:28px;height:28px;border-radius:8px;background:#fef2f2;color:#dc2626;display:flex;align-items:center;justify-content:center;">' +
              '<re-icon icon="rotate-ccw" size="16"></re-icon>' +
            '</div>' +
            '<div style="font-weight:700;font-size:15px;color:var(--td);">Undo All Actions</div>' +
          '</div>' +
          '<button type="button" class="modal-close" data-action="close-undo">✕</button>' +
        '</div>' +
        '<div class="undo-modal-body">' +
          '<p style="font-size:12.5px;color:var(--td);margin:0 0 14px 0;line-height:1.5;">' +
            'Reset this import back to <b>Draft</b> so you can re-scan or upload another spreadsheet. ' +
            'All uploaded files, Drive items, and saved records are <b>strictly kept</b>.' +
          '</p>' +
          '<div class="undo-grid">' +
            '<div class="undo-col undo-col-reset">' +
              '<div class="undo-col-title">' +
                '<re-icon icon="refresh-cw" size="12"></re-icon> Will be reset' +
              '</div>' +
              '<ul class="undo-list">' +
                '<li>Status returned to <b>Draft</b></li>' +
                '<li>Staged rows &amp; validation results</li>' +
                '<li>Verification flags &amp; checks</li>' +
                '<li>Admin review changes &amp; edits</li>' +
                '<li>Pending approvals</li>' +
              '</ul>' +
            '</div>' +
            '<div class="undo-col undo-col-kept">' +
              '<div class="undo-col-title">' +
                '<re-icon icon="shield-check" size="12"></re-icon> Will be kept' +
              '</div>' +
              '<ul class="undo-list">' +
                '<li>Uploaded files in GridFS</li>' +
                '<li>Google Drive folder &amp; items</li>' +
                '<li>Chat transcript (folded by attempt)</li>' +
                '<li>Committed DB records &amp; audit log</li>' +
                '<li>Chat participants</li>' +
              '</ul>' +
            '</div>' +
          '</div>' +
          irreversibleNotice +
        '</div>' +
        '<div class="undo-modal-footer">' +
          '<button type="button" class="btn-out" data-action="close-undo">Cancel</button>' +
          '<button type="button" class="btn-danger-pri" id="btn-submit-undo" style="background:#dc2626;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">' +
            '<re-icon icon="rotate-ccw" size="14"></re-icon>' +
            '<span>Yes, undo all actions</span>' +
          '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    activeUndoModal = modal;

    var closeBtns = modal.querySelectorAll('[data-action="close-undo"]');
    closeBtns.forEach(function (btn) { btn.onclick = closeUndoModal; });

    var submitBtn = modal.querySelector('#btn-submit-undo');
    if (submitBtn) {
      submitBtn.onclick = function () {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Undoing actions…</span>';

        api.undoBatch(batch._id, true).then(function (res) {
          closeUndoModal();
          if (typeof root.showToast === 'function') root.showToast('All actions undone — workflow reset to Draft');
          root.Bulk.sidebar.refresh().then(function () {
            if (root.Bulk.openChat) root.Bulk.openChat(batch._id, true);
          });
        }).catch(function (err) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<re-icon icon="rotate-ccw" size="14"></re-icon><span>Yes, undo all actions</span>';
          if (typeof root.showToast === 'function') root.showToast('Undo failed: ' + err.message, 'warn');
        });
      };
    }
  }

  // ── 4. SOFT-DELETE CHAT DIALOG ──

  function closeDeleteModal() {
    if (activeDeleteModal && activeDeleteModal.parentNode) {
      activeDeleteModal.parentNode.removeChild(activeDeleteModal);
    }
    activeDeleteModal = null;
  }

  function openDeleteModal(batch) {
    closeDeleteModal();
    if (!batch) return;

    var state = store.getState();
    var user = state.user;
    var canAll = canDeleteForEveryone(user, batch);

    var modal = document.createElement('div');
    modal.className = 'delete-modal-backdrop';
    modal.id = 'bulk-delete-modal';

    var allReason = '';
    if (!canAll) {
      if (batch.closed && batch.closed.at) {
        allReason = ' (Closed imports cannot be deleted)';
      } else if (batch.status === 'committing' || batch.status === 'committed') {
        allReason = ' (Committed imports are permanent legal database records)';
      } else {
        allReason = ' (Requires administrator authority or pre-approval status)';
      }
    }

    modal.innerHTML =
      '<div class="delete-modal-box">' +
        '<div class="delete-modal-header">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="width:28px;height:28px;border-radius:8px;background:#fef2f2;color:#dc2626;display:flex;align-items:center;justify-content:center;">' +
              '<re-icon icon="trash-2" size="16"></re-icon>' +
            '</div>' +
            '<div style="font-weight:700;font-size:15px;color:var(--td);">Delete Chat</div>' +
          '</div>' +
          '<button type="button" class="modal-close" data-action="close-delete">✕</button>' +
        '</div>' +
        '<div class="delete-modal-body">' +
          '<div style="font-size:12.5px;color:var(--td);margin-bottom:14px;line-height:1.5;">' +
            'Choose how you want to delete <b>' + util.esc(batch.title || (batch.type + ' import')) + '</b>:' +
          '</div>' +
          '<div class="delete-options">' +
            '<label class="delete-option-card ' + (!canAll ? 'checked' : '') + '">' +
              '<input type="radio" name="del-scope" value="me" checked>' +
              '<div style="flex:1;">' +
                '<div style="font-weight:600;font-size:13px;color:var(--td);">Delete for me</div>' +
                '<div style="font-size:11.5px;color:var(--tmu);line-height:1.4;margin-top:2px;">' +
                  'Hides this chat from your sidebar list. Other participants are unaffected. You can restore it anytime.' +
                '</div>' +
              '</div>' +
            '</label>' +
            '<label class="delete-option-card ' + (!canAll ? 'disabled' : '') + '">' +
              '<input type="radio" name="del-scope" value="all" ' + (canAll ? '' : 'disabled') + '>' +
              '<div style="flex:1;">' +
                '<div style="font-weight:600;font-size:13px;color:var(--td);">' +
                  'Delete for everyone' + util.esc(allReason) +
                '</div>' +
                '<div style="font-size:11.5px;color:var(--tmu);line-height:1.4;margin-top:2px;">' +
                  'Soft-deletes this chat for all members. Uploaded spreadsheets, Drive items, and saved records are preserved.' +
                '</div>' +
              '</div>' +
            '</label>' +
          '</div>' +
        '</div>' +
        '<div class="delete-modal-footer">' +
          '<button type="button" class="btn-out" data-action="close-delete">Cancel</button>' +
          '<button type="button" class="btn-danger-pri" id="btn-submit-delete" style="background:#dc2626;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">' +
            '<re-icon icon="trash-2" size="14"></re-icon>' +
            '<span>Delete Chat</span>' +
          '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    activeDeleteModal = modal;

    var closeBtns = modal.querySelectorAll('[data-action="close-delete"]');
    closeBtns.forEach(function (btn) { btn.onclick = closeDeleteModal; });

    var submitBtn = modal.querySelector('#btn-submit-delete');
    if (submitBtn) {
      submitBtn.onclick = function () {
        var selectedScope = (modal.querySelector('input[name="del-scope"]:checked') || {}).value || 'me';
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Deleting…</span>';

        api.deleteChat(batch._id, selectedScope).then(function () {
          closeDeleteModal();
          if (selectedScope === 'me') {
            if (typeof root.showToast === 'function') {
              root.showToast('Chat hidden — you can restore it from Deleted chats');
            }
          } else {
            if (typeof root.showToast === 'function') {
              root.showToast('Chat deleted for everyone');
            }
          }

          root.Bulk.sidebar.refresh().then(function () {
            if (state.activeId === batch._id) {
              if (root.Bulk.openChat) root.Bulk.openChat(null);
            }
          });
        }).catch(function (err) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<re-icon icon="trash-2" size="14"></re-icon><span>Delete Chat</span>';
          if (typeof root.showToast === 'function') root.showToast('Failed to delete: ' + err.message, 'warn');
        });
      };
    }
  }

  // ── EXPORT ──
  root.Bulk.menu = {
    openMenu: openMenu,
    closeMenu: closeMenu,
    renderHeaderParticipants: renderHeaderParticipants,
    openParticipantsModal: openParticipantsModal,
    closeParticipantsModal: closeParticipantsModal,
    openUndoModal: openUndoModal,
    closeUndoModal: closeUndoModal,
    openDeleteModal: openDeleteModal,
    closeDeleteModal: closeDeleteModal,
    canManage: canManage,
    canUndo: function (u, b) { return getUndoPermission(u, b).allowed; },
    canDeleteForEveryone: canDeleteForEveryone
  };
})(window);
