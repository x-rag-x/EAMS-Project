/**
 * public/js/pages/bulk/bulk.reveal.js
 * Client reveal queue and card mode calculation.
 * Ensures natural pacing for live message arrival without blocking page reloads or history.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var config = root.Bulk.config || {};
  var PREPARE_MIN_MS = config.PREPARE_MIN_MS || 1200;
  var PREPARE_MAX_MS = config.PREPARE_MAX_MS || 8000;
  var CARD_STAGGER_MS = config.CARD_STAGGER_MS || 450;

  var queue = [];
  var isProcessing = false;
  var typingEl = null;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Pure function: compute card presentation mode
   * @param {string} cardKey
   * @param {Object} batch
   * @returns {'open' | 'folded' | 'closed'}
   */
  function cardMode(cardKey, batch) {
    var status = (batch && batch.status) || 'draft';

    switch (cardKey) {
      case 'column-ref':
        return status === 'draft' ? 'open' : 'folded';

      case 'upload':
        return status === 'draft' ? 'open' : 'closed';

      case 'progress':
        if (status === 'uploading' || status === 'processing' || status === 'committing') {
          return 'open';
        }
        if (status === 'staged' || status === 'skipped_resolved' || status === 'committed') {
          return 'folded';
        }
        return 'closed';

      case 'summary':
        if (status === 'draft' || status === 'uploading' || status === 'processing') {
          return 'closed';
        }
        return 'open';

      default:
        return 'open';
    }
  }

  /**
   * Renders typing bubble in transcript
   */
  function showTyping(container, text) {
    if (!container) return;
    hideTyping(container);

    typingEl = document.createElement('div');
    typingEl.className = 'msg-row side-left preparing-row';
    typingEl.innerHTML = '<div class="msg-avatar system" aria-hidden="true">' +
      '<span style="animation:spin 2s linear infinite;display:inline-flex;">⚙</span>' +
    '</div>' +
    '<div class="msg-col">' +
      '<div class="preparing-bubble">' +
        '<span class="typing-dots">' +
          '<span class="typing-dot"></span>' +
          '<span class="typing-dot"></span>' +
          '<span class="typing-dot"></span>' +
        '</span>' +
        '<span>' + (text || 'Preparing for new bulk operation…') + '</span>' +
      '</div>' +
    '</div>';

    container.appendChild(typingEl);
    if (typeof root.Bulk.transcript?.scrollToBottom === 'function') {
      root.Bulk.transcript.scrollToBottom();
    }
  }

  /**
   * Removes typing bubble
   */
  function hideTyping(container) {
    if (typingEl && typingEl.parentNode) {
      typingEl.parentNode.removeChild(typingEl);
    }
    typingEl = null;
    if (container) {
      var oldTyping = container.querySelector('.preparing-row');
      if (oldTyping) container.removeChild(oldTyping);
    }
  }

  /**
   * Enqueue messages with live reveal pacing
   * @param {Array} msgs
   * @param {Object} opts { isLive, onCommit }
   */
  function enqueue(msgs, opts) {
    opts = opts || {};
    var onCommit = opts.onCommit || function () {};
    if (!Array.isArray(msgs) || msgs.length === 0) return;

    var now = Date.now();
    var isLive = Boolean(opts.isLive) && msgs.every(function (m) {
      if (!m.createdAt) return true;
      var age = now - new Date(m.createdAt).getTime();
      return age < 15000;
    });

    if (!isLive) {
      // Historical messages render immediately
      onCommit(msgs);
      return;
    }

    for (var i = 0; i < msgs.length; i++) {
      queue.push({ msg: msgs[i], onCommit: onCommit });
    }

    if (!isProcessing) {
      processQueue();
    }
  }

  async function processQueue() {
    isProcessing = true;
    var container = document.getElementById('chat-transcript');

    while (queue.length > 0) {
      var item = queue.shift();
      var m = item.msg;

      if (m.card === 'column-ref') {
        showTyping(container, 'Preparing for new bulk operation…');
        await sleep(PREPARE_MIN_MS);
        hideTyping(container);
      }

      item.onCommit([m]);

      if (m.card !== 'type' && queue.length > 0) {
        await sleep(CARD_STAGGER_MS);
      }
    }

    hideTyping(container);
    isProcessing = false;
  }

  root.Bulk.cardMode = cardMode;
  root.Bulk.reveal = {
    cardMode: cardMode,
    enqueue: enqueue,
    showTyping: showTyping,
    hideTyping: hideTyping
  };

})(typeof window !== 'undefined' ? window : global);
