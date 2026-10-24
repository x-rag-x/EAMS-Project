/**
 * bulk.transcript.js
 * Chat transcript engine with sticky scroll, keyed card rendering, and dock interaction.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var util = root.Bulk.util;
  var cards = root.Bulk.cards;
  var api = root.Bulk.api;
  var store = root.Bulk.store;

  var isNearBottom = true;

  function checkScrollStickiness(el) {
    var threshold = 80;
    var distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottom = distFromBottom <= threshold;
  }

  function scrollToBottom(el, smooth) {
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
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

    // Empty state / new chat without active batch
    if (!batch && !state.activeId) {
      var typeCard = cards['type'];
      if (typeCard) {
        container.innerHTML = typeCard.render({ user: user, caps: caps });
      }
      return;
    }

    if (!batch) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tmu);font-size:13px;">' +
        '<re-icon icon="loader" size="24" style="animation:spin 1s infinite linear;"></re-icon>' +
        '<div style="margin-top:10px;">Loading chat conversation…</div>' +
      '</div>';
      return;
    }

    // Synthesize display messages if none loaded yet
    var displayMsgs = messages.slice();
    if (displayMsgs.length === 0) {
      // Add initial cards based on status
      displayMsgs.push({ _id: 'init-type', card: 'type', author: 'user', payload: { type: batch.type } });
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

    // Clean up any non-message elements (like the temporary loading spinner or empty hero)
    Array.prototype.slice.call(container.children).forEach(function (child) {
      if (!child.hasAttribute('data-msg-id')) {
        container.removeChild(child);
      }
    });

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

    for (var i = 0; i < displayMsgs.length; i++) {
      var msg = displayMsgs[i];
      var msgId = msg._id || ('idx-' + i);
      var ctx = {
        msg: msg,
        batch: batch,
        user: user,
        caps: caps,
        schema: schema,
        progress: progress
      };

      var existingEl = existingMap[msgId];
      var cardDef = msg.card ? cards[msg.card] : null;

      if (msg.author === 'user' && !msg.card) {
        // Simple user text bubble
        if (!existingEl) {
          var uBubble = document.createElement('div');
          uBubble.className = 'bubble-user';
          uBubble.setAttribute('data-msg-id', msgId);
          var textContent = (msg.payload && msg.payload.text) || msg.text || '';
          uBubble.innerHTML = util.esc(textContent);
          container.appendChild(uBubble);
        }
      } else if (cardDef) {
        var key = cardDef.key ? cardDef.key(ctx) : 'card';
        if (existingEl && existingEl.getAttribute('data-card-key') === key) {
          // Key unchanged; preserve node
          continue;
        }

        var wrapper = document.createElement('div');
        var isUserBubble = msg.author === 'user' || (msg.card === 'type' && (batch || (msg.payload && msg.payload.type)));
        wrapper.className = isUserBubble ? 'bubble-user' : 'bubble-system';
        wrapper.setAttribute('data-msg-id', msgId);
        wrapper.setAttribute('data-card-key', key);
        wrapper.innerHTML = cardDef.render(ctx);

        if (existingEl) {
          container.replaceChild(wrapper, existingEl);
        } else {
          container.appendChild(wrapper);
        }

        if (cardDef.bind) {
          cardDef.bind(wrapper, ctx);
        }
      } else if (msg.card === 'file') {
        // Uploaded file chip
        if (!existingEl) {
          var fBubble = document.createElement('div');
          fBubble.className = 'bubble-user';
          fBubble.setAttribute('data-msg-id', msgId);
          var p = msg.payload || {};
          fBubble.innerHTML = '<div class="bubble-user-file">' +
            '<re-icon icon="file-spreadsheet" size="16"></re-icon>' +
            '<span>' + util.esc(p.name || 'Uploaded Spreadsheet') + '</span>' +
            '<span style="font-size:11px;opacity:0.8;">(' + util.formatBytes(p.size || 0) + ')</span>' +
          '</div>';
          container.appendChild(fBubble);
        }
      }
    }

    if (isNearBottom) {
      scrollToBottom(container, false);
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

        // Delegated click listener for transcript-level interactions (individual cards handle their own buttons via bind)
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
})(window);
