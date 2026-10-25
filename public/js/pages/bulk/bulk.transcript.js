/**
 * bulk.transcript.js
 * WhatsApp-style chat transcript engine with row-based rendering,
 * in-place card updates, windowing, day chips, ticks, and unread floating pill.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var util = root.Bulk.util;
  var cards = root.Bulk.cards;
  var api = root.Bulk.api;
  var store = root.Bulk.store;
  var rowHelper = root.Bulk.row;

  var isNearBottom = true;
  var unreadCount = 0;
  var windowLimit = 200;
  var isFullHistoryLoaded = false;

  function checkScrollStickiness(el) {
    if (!el) return;
    var threshold = 80;
    var distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottom = distFromBottom <= threshold;
    if (isNearBottom) {
      unreadCount = 0;
      var scrollBtn = document.getElementById('btn-scroll-bottom');
      if (scrollBtn) {
        scrollBtn.classList.add('hidden');
      }
    }
  }

  function scrollToBottom(el, smooth) {
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
    unreadCount = 0;
    var scrollBtn = document.getElementById('btn-scroll-bottom');
    if (scrollBtn) {
      scrollBtn.classList.add('hidden');
    }
  }

  function createElFromHtml(html) {
    var temp = document.createElement('div');
    temp.innerHTML = (html || '').trim();
    return temp.firstElementChild;
  }

  function updateScrollButton() {
    var scrollBtn = document.getElementById('btn-scroll-bottom');
    if (!scrollBtn) return;
    if (unreadCount > 0) {
      scrollBtn.classList.remove('hidden');
      var txtEl = document.getElementById('scroll-bottom-text');
      if (txtEl) {
        txtEl.textContent = '↓ ' + unreadCount + ' new';
      }
    } else {
      scrollBtn.classList.add('hidden');
    }
  }

  function renderTranscript() {
    var container = document.getElementById('chat-transcript');
    if (!container) return;

    var state = store.getState();
    var batch = state.batch;
    var messages = state.messages || [];
    var user = state.user;
    var caps = state.caps;
    var schema = state.schema;
    var progress = state.progress;

    // Accessibility log container setup
    if (!container.getAttribute('role')) {
      container.setAttribute('role', 'log');
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-relevant', 'additions');
    }

    // 1. Empty state / new chat without active batch
    if (!batch && !state.activeId) {
      var typeCard = cards['type'];
      if (typeCard) {
        container.innerHTML = typeCard.render({ user: user, caps: caps });
      }
      return;
    }

    // 2. Loading state: skeleton shimmer while loading
    if (!batch) {
      container.innerHTML = '<div class="msg-skeleton left" aria-hidden="true">' +
          '<div class="skeleton-av"></div>' +
          '<div class="skeleton-bub" style="width:260px;"></div>' +
        '</div>' +
        '<div class="msg-skeleton right" aria-hidden="true">' +
          '<div class="skeleton-av"></div>' +
          '<div class="skeleton-bub" style="width:190px;"></div>' +
        '</div>' +
        '<div class="msg-skeleton left" aria-hidden="true">' +
          '<div class="skeleton-av"></div>' +
          '<div class="skeleton-bub" style="width:320px;"></div>' +
        '</div>';
      return;
    }

    // 3. Synthesize display messages if none loaded yet
    var displayMsgs = messages.slice();
    if (displayMsgs.length === 0) {
      displayMsgs.push({
        _id: 'init-type',
        card: 'type',
        author: 'user',
        actor: {
          userId: (batch.uploadedBy && (batch.uploadedBy.userId || batch.uploadedBy._id)) || (user && user._id),
          trackId: (batch.uploadedBy && batch.uploadedBy.trackId) || (user && user.trackId),
          name: (batch.uploadedBy && batch.uploadedBy.name) || (user && (user.name || user.username)) || 'User',
          role: (batch.uploadedBy && batch.uploadedBy.role) || (user && user.role) || 'staff'
        },
        payload: { type: batch.type }
      });
      displayMsgs.push({ _id: 'init-col-ref', card: 'column-ref', author: 'system', payload: { type: batch.type } });
      if (batch.status === 'draft') {
        displayMsgs.push({ _id: 'init-upload', card: 'upload', author: 'system' });
      } else if (batch.status === 'uploading' || batch.status === 'processing') {
        displayMsgs.push({ _id: 'init-prog', card: 'progress', author: 'system', payload: { jobKind: 'stage' } });
      } else if (batch.status === 'staged' || batch.status === 'skipped_resolved') {
        displayMsgs.push({ _id: 'init-summary', card: 'summary', author: 'system' });
      } else if (batch.status === 'pending_sudo_initial') {
        displayMsgs.push({ _id: 'init-summary', card: 'summary', author: 'system' });
        displayMsgs.push({ _id: 'init-sudo', card: 'sudo-review', author: 'system' });
      } else if (batch.status === 'sudo_initial_approved' || batch.status === 'verifying') {
        displayMsgs.push({ _id: 'init-summary', card: 'summary', author: 'system' });
        displayMsgs.push({ _id: 'init-verify', card: 'verify', author: 'system' });
      } else if (batch.status === 'verified_all' || batch.status === 'pending_final_approval') {
        displayMsgs.push({ _id: 'init-summary', card: 'summary', author: 'system' });
        displayMsgs.push({ _id: 'init-final', card: 'final', author: 'system' });
      } else if (batch.status === 'committing') {
        displayMsgs.push({ _id: 'init-commit-prog', card: 'progress', author: 'system', payload: { jobKind: 'commit' } });
      } else if (batch.status === 'committed') {
        displayMsgs.push({ _id: 'init-summary', card: 'summary', author: 'system' });
        displayMsgs.push({ _id: 'init-complete', card: 'complete', author: 'system' });
      } else if (batch.status === 'rejected') {
        displayMsgs.push({ _id: 'init-rejected', card: 'rejected', author: 'system' });
      } else if (batch.status === 'failed') {
        displayMsgs.push({ _id: 'init-error', card: 'error', author: 'system' });
      }
    }

    // 4. Clean up any non-message elements (like the temporary loading spinner or empty hero)
    Array.prototype.slice.call(container.children).forEach(function (child) {
      if (!child.hasAttribute('data-msg-id') && !child.classList.contains('epoch-fold') && !child.classList.contains('day-divider') && !child.classList.contains('new-messages-divider') && !child.classList.contains('btn-load-earlier')) {
        container.removeChild(child);
      }
    });

    // 5. Windowing: render the last windowLimit messages if list is long
    var totalMsgs = displayMsgs.length;
    var hasEarlier = !isFullHistoryLoaded && totalMsgs > windowLimit;
    if (hasEarlier) {
      displayMsgs = displayMsgs.slice(-windowLimit);
    }

    // Update load-earlier trigger button
    var existingLoadBtn = container.querySelector('.btn-load-earlier');
    if (hasEarlier) {
      if (!existingLoadBtn) {
        var lBtn = document.createElement('button');
        lBtn.type = 'button';
        lBtn.className = 'btn-load-earlier';
        lBtn.setAttribute('data-action', 'load-earlier');
        lBtn.innerHTML = '<span>↑ Load earlier messages (' + (totalMsgs - windowLimit) + ')</span>';
        container.insertBefore(lBtn, container.firstChild);
      } else {
        existingLoadBtn.innerHTML = '<span>↑ Load earlier messages (' + (totalMsgs - windowLimit) + ')</span>';
      }
    } else if (existingLoadBtn) {
      container.removeChild(existingLoadBtn);
    }

    var existingMap = {};
    var existingNodes = container.querySelectorAll('[data-msg-id]');
    existingNodes.forEach(function (n) {
      existingMap[n.getAttribute('data-msg-id')] = n;
    });

    // Remove any previously rendered messages that no longer exist in displayMsgs
    var currentIds = {};
    for (var d = 0; d < displayMsgs.length; d++) {
      currentIds[displayMsgs[d]._id || ('idx-' + d)] = true;
    }
    existingNodes.forEach(function (n) {
      var mid = n.getAttribute('data-msg-id');
      if (mid && !currentIds[mid]) {
        container.removeChild(n);
        delete existingMap[mid];
      }
    });

    // 5b. Epoch Partitioning: Fold older attempts into collapsible <details>
    var currentEpoch = batch.epoch || 0;
    if (currentEpoch > 0) {
      var olderMsgs = [];
      var currentEpochMsgs = [];

      for (var em = 0; em < displayMsgs.length; em++) {
        var mEpoch = displayMsgs[em].epoch !== undefined ? displayMsgs[em].epoch : 0;
        if (mEpoch < currentEpoch) {
          olderMsgs.push(displayMsgs[em]);
        } else {
          currentEpochMsgs.push(displayMsgs[em]);
        }
      }

      // If current epoch has no messages yet (just undone), synthesize draft cards
      if (currentEpochMsgs.length === 0 && batch.status === 'draft') {
        currentEpochMsgs.push({ _id: 'init-col-ref-ep' + currentEpoch, card: 'column-ref', author: 'system', epoch: currentEpoch, payload: { type: batch.type } });
        currentEpochMsgs.push({ _id: 'init-upload-ep' + currentEpoch, card: 'upload', author: 'system', epoch: currentEpoch });
      }

      // Group older messages by epoch and render collapsible containers
      var epochsMap = {};
      for (var om = 0; om < olderMsgs.length; om++) {
        var ep = olderMsgs[om].epoch || 0;
        if (!epochsMap[ep]) epochsMap[ep] = [];
        epochsMap[ep].push(olderMsgs[om]);
      }

      var sortedEpochs = Object.keys(epochsMap).map(Number).sort(function (a, b) { return a - b; });
      for (var se = 0; se < sortedEpochs.length; se++) {
        var epNum = sortedEpochs[se];
        var epMsgs = epochsMap[epNum];
        var existingFold = container.querySelector('.epoch-fold[data-epoch="' + epNum + '"]');

        if (!existingFold) {
          var foldEl = document.createElement('details');
          foldEl.className = 'epoch-fold';
          foldEl.setAttribute('data-epoch', String(epNum));

          var foldHtml = '<summary class="epoch-fold-summary">' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
              '<re-icon icon="rotate-ccw" size="13"></re-icon>' +
              '<span>Previous attempt #' + (epNum + 1) + ' · ' + epMsgs.length + ' message' + (epMsgs.length > 1 ? 's' : '') + ' · undone</span>' +
            '</div>' +
            '<span class="epoch-fold-tag">Read-only history</span>' +
          '</summary>' +
          '<div class="epoch-fold-body">';

          for (var mi = 0; mi < epMsgs.length; mi++) {
            var oldMsg = epMsgs[mi];
            var oldCtx = { msg: oldMsg, batch: batch, user: user, viewer: user, caps: caps, schema: schema, progress: progress };
            var oldInner = '';
            if (oldMsg.card && cards[oldMsg.card]) {
              oldInner = cards[oldMsg.card].render(oldCtx);
            } else if (oldMsg.card === 'file') {
              oldInner = '<div class="bubble-user-file"><re-icon icon="file-spreadsheet" size="15"></re-icon> <span>' + util.esc((oldMsg.payload && oldMsg.payload.name) || 'sheet.xlsx') + '</span></div>';
            } else if (oldMsg.kind === 'event') {
              oldInner = util.esc((oldMsg.payload && oldMsg.payload.text) || oldMsg.text || 'Event');
            } else {
              oldInner = util.esc((oldMsg.payload && oldMsg.payload.text) || oldMsg.text || '');
            }
            foldHtml += rowHelper ? rowHelper.render(oldMsg, {
              batch: batch,
              viewer: user,
              msgId: oldMsg._id || ('old-' + epNum + '-' + mi),
              innerContent: oldInner,
              showDay: false,
              showNewDivider: false
            }) : oldInner;
          }

          foldHtml += '</div>';
          foldEl.innerHTML = foldHtml;

          var firstActiveNode = container.querySelector('[data-msg-id]');
          if (firstActiveNode) {
            container.insertBefore(foldEl, firstActiveNode);
          } else {
            container.appendChild(foldEl);
          }
        }
      }

      displayMsgs = currentEpochMsgs;
    }

    // 6. Synchronize dividers and render messages
    // Remove stale temporary dividers on each pass so day chips are never duplicated
    Array.prototype.slice.call(container.querySelectorAll('.day-divider, .new-messages-divider')).forEach(function (d) {
      if (d.parentNode === container) {
        container.removeChild(d);
      }
    });

    var prevDay = null;
    var newDividerShown = false;
    var viewerUid = String((user && (user._id || user.userId)) || '');
    var mySeen = (batch.seenBy || []).find(function (s) {
      return String(s.userId) === viewerUid;
    });
    var myLastSeenSeq = mySeen ? (mySeen.seq || 0) : 0;

    function attachWithDividers(rowEl, dayFlag, newFlag, targetExisting) {
      if (dayFlag && rowHelper) {
        var dayEl = createElFromHtml(rowHelper.renderDayChip(msg.createdAt || Date.now()));
        if (dayEl) {
          if (targetExisting) {
            container.insertBefore(dayEl, targetExisting);
          } else {
            container.appendChild(dayEl);
          }
        }
      }
      if (newFlag && rowHelper) {
        var newEl = createElFromHtml(rowHelper.renderNewDivider());
        if (newEl) {
          if (targetExisting) {
            container.insertBefore(newEl, targetExisting);
          } else {
            container.appendChild(newEl);
          }
        }
      }
      if (targetExisting) {
        container.replaceChild(rowEl, targetExisting);
      } else {
        container.appendChild(rowEl);
      }
    }

    for (var i = 0; i < displayMsgs.length; i++) {
      var msg = displayMsgs[i];
      var msgId = msg._id || ('idx-' + i);
      var ctx = {
        msg: msg,
        batch: batch,
        user: user,
        viewer: user,
        caps: caps,
        schema: schema,
        progress: progress
      };

      var msgDay = rowHelper ? rowHelper.dayKey(msg.createdAt || Date.now()) : '';
      var showDay = (msgDay && msgDay !== prevDay);
      if (showDay) prevDay = msgDay;

      var showNewDivider = false;
      if (!newDividerShown && msg.seq && msg.seq > myLastSeenSeq && rowHelper && rowHelper.sideOf(msg, user) === 'left') {
        showNewDivider = true;
        newDividerShown = true;
      }

      var existingEl = existingMap[msgId];
      var cardDef = msg.card ? cards[msg.card] : null;

      if (cardDef) {
        var currentMode = (typeof cardDef.mode === 'function') ? cardDef.mode(ctx) : 'open';
        if (currentMode === 'closed') {
          // Card is closed: drop existing DOM element and skip rendering to eliminate orphan avatars
          if (existingEl) {
            container.removeChild(existingEl);
            delete existingMap[msgId];
          }
          continue;
        }

        var cardKey = cardDef.key ? cardDef.key(ctx) : (msg.card || 'card');

        if (existingEl) {
          var cardBubble = existingEl.querySelector('[data-card-key]');
          if (cardBubble && cardBubble.getAttribute('data-card-key') === cardKey) {
            // Key is unchanged: call optional update() without replacing DOM node
            if (typeof cardDef.update === 'function') {
              cardDef.update(cardBubble, ctx);
            }
            // Update seen ticks if changed
            if (rowHelper) {
              var footEl = existingEl.querySelector('.msg-foot');
              if (footEl) {
                var ticksSpan = footEl.querySelector('.ticks');
                var newTicksHtml = rowHelper.ticks(msg, batch, user);
                if (ticksSpan && newTicksHtml) {
                  ticksSpan.outerHTML = newTicksHtml;
                }
              }
            }
            if (showDay && rowHelper) {
              var prevSibling = existingEl.previousElementSibling;
              if (!prevSibling || !prevSibling.classList.contains('day-divider')) {
                var dChip = createElFromHtml(rowHelper.renderDayChip(msg.createdAt || Date.now()));
                if (dChip) container.insertBefore(dChip, existingEl);
              }
            }
            continue;
          }
        }

        // Fresh render for this card row
        var cardInnerHtml = cardDef.render(ctx);
        var rowHtml = rowHelper ? rowHelper.render(msg, {
          batch: batch,
          viewer: user,
          msgId: msgId,
          cardKey: cardKey,
          innerContent: cardInnerHtml
        }) : cardInnerHtml;

        var newRowEl = createElFromHtml(rowHtml);
        if (newRowEl) {
          attachWithDividers(newRowEl, showDay, showNewDivider, existingEl);
          if (!existingEl && !isNearBottom && rowHelper && rowHelper.sideOf(msg, user) === 'left') {
            unreadCount++;
          }
          if (cardDef.bind) {
            cardDef.bind(newRowEl, ctx);
          }
        }

      } else if (msg.kind === 'event') {
        // Centered event pill
        var evtText = (msg.payload && msg.payload.text) || msg.text || 'Event update';
        if (!existingEl) {
          var evtRowHtml = rowHelper ? rowHelper.render(msg, {
            batch: batch,
            viewer: user,
            msgId: msgId,
            innerContent: util.esc(evtText)
          }) : evtText;
          var evtEl = createElFromHtml(evtRowHtml);
          if (evtEl) {
            attachWithDividers(evtEl, showDay, showNewDivider);
          }
        }

      } else {
        // Standard user or staff text message
        var msgText = (msg.payload && (msg.payload.text || msg.payload.message || msg.payload.comment || msg.payload.body || (typeof msg.payload === 'string' ? msg.payload : ''))) || msg.text || msg.message || '';
        if (!msgText && !existingEl) {
          continue; // Avoid rendering empty bubbles
        }
        if (!existingEl) {
          var textRowHtml = rowHelper ? rowHelper.render(msg, {
            batch: batch,
            viewer: user,
            msgId: msgId,
            innerContent: util.esc(msgText)
          }) : util.esc(msgText);
          var textEl = createElFromHtml(textRowHtml);
          if (textEl) {
            attachWithDividers(textEl, showDay, showNewDivider);
            if (!isNearBottom && rowHelper && rowHelper.sideOf(msg, user) === 'left') {
              unreadCount++;
            }
          }
        }
      }
    }

    // 7. Update floating unread pill & sticky scroll
    updateScrollButton();
    if (isNearBottom) {
      scrollToBottom(container, false);
    }

    // 8. Update composer lock state if batch is closed
    updateComposerLock(batch);
  }

  function updateComposerLock(batch) {
    var dock = document.getElementById('chat-dock');
    var dockInput = document.getElementById('chat-dock-input');
    var dockSendBtn = document.getElementById('chat-dock-send');
    var paperclipBtn = document.getElementById('btn-chat-paperclip');

    if (!dock || !dockInput) return;

    var isClosed = Boolean(batch && (batch.closed || batch.status === 'committed'));
    if (isClosed) {
      dock.classList.add('is-closed');
      dockInput.disabled = true;
      dockInput.placeholder = 'This import chat is closed and read-only';
      if (dockSendBtn) dockSendBtn.disabled = true;
      if (paperclipBtn) paperclipBtn.disabled = true;
    } else {
      dock.classList.remove('is-closed');
      dockInput.disabled = false;
      dockInput.placeholder = 'Type notes or commentary for this import batch…';
      if (dockSendBtn) dockSendBtn.disabled = false;
      if (paperclipBtn) paperclipBtn.disabled = false;
    }
  }

  root.Bulk.transcript = {
    render: renderTranscript,
    scrollToBottom: function () {
      var container = document.getElementById('chat-transcript');
      scrollToBottom(container, true);
    },
    init: function () {
      var container = document.getElementById('chat-transcript');
      if (container) {
        container.addEventListener('scroll', function () {
          checkScrollStickiness(container);
        });

        // Delegated click listener for transcript-level interactions
        container.addEventListener('click', function (e) {
          // 1. Pick type button (rendered in transcript hero)
          var pickBtn = e.target.closest('[data-action="pick-type"]');
          if (pickBtn && !pickBtn.disabled) {
            var t = pickBtn.getAttribute('data-type');
            if (t && typeof root.Bulk.startNewImport === 'function') {
              root.Bulk.startNewImport(t);
            }
            return;
          }

          // 2. Open verification drawer
          var drawerBtn = e.target.closest('[data-action="open-drawer"]');
          if (drawerBtn) {
            store.setState({ drawerOpen: true });
            return;
          }

          // 3. Load earlier messages windowing trigger
          var loadEarlierBtn = e.target.closest('[data-action="load-earlier"]');
          if (loadEarlierBtn) {
            windowLimit += 200;
            renderTranscript();
            return;
          }
        });
      }

      // Scroll to bottom floating button
      var scrollBtn = document.getElementById('btn-scroll-bottom');
      if (scrollBtn) {
        scrollBtn.addEventListener('click', function () {
          scrollToBottom(container, true);
        });
      }

      // Paperclip file picker button
      var clipBtn = document.getElementById('btn-chat-paperclip');
      if (clipBtn) {
        clipBtn.addEventListener('click', function () {
          var fileInput = document.getElementById('chat-file-input') || document.getElementById('uz-file-input');
          if (fileInput) {
            fileInput.click();
          } else {
            if (typeof root.showToast === 'function') {
              root.showToast('Upload spreadsheet card is not currently open', 'info');
            }
          }
        });
      }

      // Chat dock comment submission
      var dockInput = document.getElementById('chat-dock-input');
      var dockSendBtn = document.getElementById('chat-dock-send');

      function sendComment() {
        if (!dockInput) return;
        var text = dockInput.value.trim();
        var state = store.getState();
        if (!text || !state.activeId) return;

        dockInput.value = '';
        api.postComment(state.activeId, text).then(function (res) {
          var msg = (res && res.message) || (res && res.data && res.data.message);
          if (msg) {
            var msgs = (store.getState().messages || []).slice();
            var exists = msgs.some(function (m) {
              return (m._id && msg._id && m._id === msg._id) || (m.seq !== undefined && msg.seq !== undefined && m.seq === msg.seq);
            });
            if (!exists) {
              msgs.push(msg);
              store.setState({ messages: msgs });
              renderTranscript();
              scrollToBottom(container, true);
            }
          }
        }).catch(function (err) {
          if (typeof root.showToast === 'function') root.showToast('Could not post comment: ' + err.message, 'warn');
        });
      }

      if (dockSendBtn) {
        dockSendBtn.addEventListener('click', sendComment);
      }
      if (dockInput) {
        dockInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendComment();
          }
        });
      }

      store.subscribe(function () {
        renderTranscript();
      });
    }
  };
})(typeof window !== 'undefined' ? window : global);
