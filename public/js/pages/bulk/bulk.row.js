/**
 * public/js/pages/bulk/bulk.row.js
 * Row layout, alignment rules, actor tier resolution, ticks, and day separators.
 * Unit-testable pure functions on window.Bulk.row.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var avatar = root.Bulk.avatar;
  var util = root.Bulk.util || {
    esc: function (s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  };

  /**
   * Fallback tier from legacy role string
   */
  function fallbackTier(role) {
    var r = String(role || '').toLowerCase();
    if (r === 'sudo' || r === 'admin' || r === 'sudoadmin') return 'sudo';
    if (r === 'super' || r === 'superadmin') return 'super';
    if (r === 'sub' || r === 'subadmin') return 'sub';
    if (r === 'system') return 'system';
    return 'staff';
  }

  /**
   * Pure function: determine alignment side for a message
   * @param {Object} msg
   * @param {Object} viewer
   * @param {Object} [batch]
   * @returns {'right' | 'left' | 'center'}
   */
  function sideOf(msg, viewer, batch) {
    if (!msg) return 'left';
    if (msg.kind === 'event') return 'center';
    if (msg.author === 'system') return 'left';

    var v = viewer || {};
    var b = batch || {};
    var bUploader = b.uploadedBy || {};
    var isUserMsg = (msg.author === 'user' || msg.card === 'type' || msg.card === 'file');

    // 1. Direct ID matching between msg actor/uploader and viewer
    var msgUid = String(
      (msg.actor && (msg.actor.userId || msg.actor._id || msg.actor.id)) ||
      (msg.uploadedBy && (msg.uploadedBy.userId || msg.uploadedBy._id || msg.uploadedBy.id)) ||
      ''
    );
    var viewerUid = String(v._id || v.userId || v.id || '');
    if (msgUid && viewerUid && msgUid === viewerUid) {
      return 'right';
    }

    // 2. Track ID matching (TR-*)
    var msgTrackId = String(
      (msg.actor && msg.actor.trackId) ||
      msg.trackId ||
      (msg.uploadedBy && msg.uploadedBy.trackId) ||
      ''
    );
    var viewerTrackId = String(v.trackId || '');
    if (msgTrackId && viewerTrackId && msgTrackId === viewerTrackId) {
      return 'right';
    }

    // 3. Username and Name matching (case-insensitive cross-check)
    var msgActorName = String((msg.actor && (msg.actor.name || msg.actor.fullName)) || (msg.uploadedBy && (msg.uploadedBy.name || msg.uploadedBy.fullName)) || '').trim().toLowerCase();
    var msgActorUser = String((msg.actor && msg.actor.username) || (msg.uploadedBy && msg.uploadedBy.username) || '').trim().toLowerCase();

    var viewerName = String(v.name || v.fullName || '').trim().toLowerCase();
    var viewerUser = String(v.username || '').trim().toLowerCase();

    if (msgActorUser && viewerUser && msgActorUser === viewerUser) {
      return 'right';
    }
    if (msgActorName && viewerName && msgActorName === viewerName) {
      return 'right';
    }
    if (msgActorName && viewerUser && msgActorName === viewerUser) {
      return 'right';
    }
    if (msgActorUser && viewerName && msgActorUser === viewerName) {
      return 'right';
    }

    // 4. Batch Uploader Context: If current viewer is the creator/uploader of this batch,
    // and this msg was sent by the uploader (or has uploader's name/id), align right.
    if (isUserMsg && bUploader) {
      var uploaderId = String(bUploader.userId || bUploader._id || '');
      var uploaderTrackId = String(bUploader.trackId || '');
      var uploaderName = String(bUploader.name || '').trim().toLowerCase();

      var isViewerUploader = false;
      if (viewerUid && uploaderId && viewerUid === uploaderId) isViewerUploader = true;
      else if (viewerTrackId && uploaderTrackId && viewerTrackId === uploaderTrackId) isViewerUploader = true;
      else if (viewerName && uploaderName && viewerName === uploaderName) isViewerUploader = true;
      else if (viewerUser && uploaderName && viewerUser === uploaderName) isViewerUploader = true;

      // Also ensure the message belongs to the uploader
      var isMsgFromUploader = (!msgUid && !msgActorName) ||
        (uploaderId && msgUid === uploaderId) ||
        (uploaderTrackId && msgTrackId === uploaderTrackId) ||
        (uploaderName && msgActorName === uploaderName);

      if (isViewerUploader && isMsgFromUploader) {
        return 'right';
      }
    }

    // 5. If msg has no identifying actor at all (e.g. fresh local client action), and author is 'user'
    if (isUserMsg && !msgUid && !msgTrackId && !msgActorName && !msgActorUser) {
      return 'right';
    }

    return 'left';
  }

  /**
   * Resolve actor tier ('sudo' | 'super' | 'sub' | 'staff' | 'system')
   * @param {Object} msg
   * @returns {string}
   */
  function tierOf(msg) {
    if (!msg) return 'staff';
    if (msg.actor && msg.actor.tier) return msg.actor.tier;
    if (msg.author === 'system') return 'system';
    return fallbackTier(msg.actor && msg.actor.role);
  }

  /**
   * Pure function: calculate ticks markup for own messages
   * @param {Object} msg
   * @param {Object} batch
   * @param {Object} viewer
   * @returns {string}
   */
  function ticks(msg, batch, viewer) {
    if (!msg || sideOf(msg, viewer) !== 'right') return '';
    if (msg.kind === 'event') return '';

    var seq = msg.seq || 0;
    if (!seq) {
      return '<span class="ticks" aria-label="Sending">✓</span>';
    }

    var seenBy = (batch && batch.seenBy) ? batch.seenBy : [];
    var viewerUid = String((viewer && (viewer._id || viewer.userId)) || '');
    var otherSeen = seenBy.filter(function (s) {
      return String(s.userId) !== viewerUid;
    });

    if (otherSeen.length === 0) {
      // Single tick: stored with seq, delivered to server
      return '<span class="ticks" aria-label="Sent">✓</span>';
    }

    var anyRead = otherSeen.some(function (s) {
      return (s.seq || 0) >= seq;
    });

    if (anyRead) {
      // Double blue ticks: read/seen by at least one other participant
      return '<span class="ticks ticks-seen" aria-label="Read">✓✓</span>';
    }

    // Double grey ticks: delivered to chat participants
    return '<span class="ticks" aria-label="Delivered">✓✓</span>';
  }

  /**
   * Format HH:MM from ISO string or Date
   */
  function formatTime(val) {
    if (!val) return '';
    var d = new Date(val);
    if (isNaN(d.getTime())) return '';
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  /**
   * Format YYYY-MM-DD day key
   */
  function dayKey(val) {
    if (!val) return '';
    var d = new Date(val);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  /**
   * Render Day Separator chip ("Today", "Yesterday", "24 Oct 2026")
   */
  function renderDayChip(dateVal) {
    var d = new Date(dateVal);
    if (isNaN(d.getTime())) return '';

    var now = new Date();
    var todayKey = now.toISOString().slice(0, 10);
    var yest = new Date(now.getTime() - 86400000);
    var yestKey = yest.toISOString().slice(0, 10);
    var targetKey = d.toISOString().slice(0, 10);

    var label = '';
    if (targetKey === todayKey) {
      label = 'Today';
    } else if (targetKey === yestKey) {
      label = 'Yesterday';
    } else {
      label = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    }

    return '<div class="day-divider" role="separator"><span class="day-chip">' + util.esc(label) + '</span></div>';
  }

  /**
   * Render "New messages" separator
   */
  function renderNewDivider() {
    return '<div class="new-messages-divider" role="separator"><span>New messages</span></div>';
  }

  /**
   * Render an entire message row
   * @param {Object} msg
   * @param {Object} ctx { batch, viewer, innerContent, cardKey, showDay, showNewDivider }
   * @returns {string} HTML string
   */
  function render(msg, ctx) {
    ctx = ctx || {};
    var viewer = ctx.viewer || {};
    var batch = ctx.batch || {};
    var side = sideOf(msg, viewer, batch);
    var tier = tierOf(msg);

    var html = '';
    if (ctx.prependDividers) {
      if (ctx.showDay) {
        html += renderDayChip(msg.createdAt || Date.now());
      }
      if (ctx.showNewDivider) {
        html += renderNewDivider();
      }
    }

    var rowClasses = ['msg-row', 'side-' + side];
    if (side === 'left' && (tier === 'sudo' || tier === 'super')) {
      rowClasses.push('tier-admin');
    }

    var msgId = msg._id || ctx.msgId || '';
    var seq = msg.seq || 0;
    var dKey = dayKey(msg.createdAt || Date.now());
    var timeStr = formatTime(msg.createdAt || Date.now());
    var tickHtml = ticks(msg, batch, viewer);

    var isEvent = msg.kind === 'event';
    var isFile = msg.card === 'file';
    var isUserRequest = msg.card === 'type' && Boolean((msg.payload && msg.payload.type) || (batch && batch.type));
    var isCard = Boolean(msg.card && !isFile && !isUserRequest);
    var bubbleClass = isEvent ? 'kind-event' : (isFile ? 'kind-file' : (isUserRequest ? 'kind-user-request' : (isCard ? 'kind-card' : 'kind-text')));
    if (isCard) {
      rowClasses.push('has-card');
    }
    if (isFile) {
      rowClasses.push('has-file');
    }
    if (isUserRequest) {
      rowClasses.push('has-user-request');
    }

    html += '<div class="' + rowClasses.join(' ') + '" data-msg-id="' + util.esc(msgId) + '" data-seq="' + seq + '" data-day="' + util.esc(dKey) + '">';

    // Avatar (left/right only; never center)
    if (side !== 'center') {
      var avActor = msg.actor || { name: msg.author === 'system' ? 'EAMS Assistant' : 'User', tier: tier };
      html += (root.Bulk.avatar ? root.Bulk.avatar.render(avActor) : '');
    }

    html += '<div class="msg-col' + (isCard ? ' has-card' : (isFile ? ' has-file' : (isUserRequest ? ' has-user-request' : ''))) + '">';

    // Sender metadata for other users on the left
    if (side === 'left' && msg.author !== 'system' && !isEvent) {
      var senderName = util.esc((msg.actor && (msg.actor.name || msg.actor.username)) || 'Staff');
      var chipClass = 'msg-chip msg-chip-' + tier;
      var chipText = (tier === 'sudo' ? 'ADMIN' : (tier === 'super' ? 'SUPER' : (tier === 'sub' ? 'SUB' : '')));

      html += '<div class="msg-meta">';
      html += '<span class="msg-name">' + senderName + '</span>';
      if (chipText) {
        html += '<span class="' + chipClass + '">' + chipText + '</span>';
      }
      html += '</div>';
    }

    // Bubble content
    var cardKeyAttr = ctx.cardKey ? ' data-card-key="' + util.esc(ctx.cardKey) + '"' : '';
    html += '<div class="msg-bubble ' + bubbleClass + '"' + cardKeyAttr + '>';
    html += (ctx.innerContent || '');

    // Footer with timestamp and ticks (events don't need timestamp inside bubble)
    if (!isEvent && !isCard) {
      html += '<div class="msg-foot">';
      html += '<time datetime="' + util.esc(new Date(msg.createdAt || Date.now()).toISOString()) + '">' + util.esc(timeStr) + '</time>';
      if (tickHtml) {
        html += tickHtml;
      }
      html += '</div>';
    }

    html += '</div>'; // .msg-bubble
    html += '</div>'; // .msg-col
    html += '</div>'; // .msg-row

    return html;
  }

  root.Bulk.row = {
    sideOf: sideOf,
    tierOf: tierOf,
    ticks: ticks,
    formatTime: formatTime,
    dayKey: dayKey,
    renderDayChip: renderDayChip,
    renderNewDivider: renderNewDivider,
    render: render
  };

})(typeof window !== 'undefined' ? window : global);
