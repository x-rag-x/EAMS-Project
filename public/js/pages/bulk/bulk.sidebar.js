/**
 * bulk.sidebar.js
 * Sidebar manager: rendering chat list, grouping by recency/urgency, search & filters.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var util = root.Bulk.util;
  var config = root.Bulk.config;
  var api = root.Bulk.api;
  var store = root.Bulk.store;

  function isAwaitingAction(batch, user) {
    if (!batch || !user) return false;
    var isSudo = typeof root.isSudoAdmin === 'function' ? root.isSudoAdmin(user) : (user.role === 'sudo' || (user.role === 'admin' && user.adminFlag !== 'subadmin'));
    if (isSudo) {
      return batch.status === 'pending_sudo_initial' || batch.status === 'pending_final_approval';
    }
    // Teacher / staff
    return batch.status === 'staged' || batch.status === 'verifying' || batch.status === 'rejected' || batch.status === 'failed';
  }

  function groupChats(chats, user) {
    var awaiting = [];
    var today = [];
    var yesterday = [];
    var prev7 = [];
    var older = [];

    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var yestStart = todayStart - 86400000;
    var prev7Start = todayStart - 7 * 86400000;

    for (var i = 0; i < chats.length; i++) {
      var c = chats[i];
      if (isAwaitingAction(c, user)) {
        awaiting.push(c);
        continue;
      }
      var t = new Date(c.lastMessageAt || c.updatedAt || c.createdAt).getTime();
      if (t >= todayStart) {
        today.push(c);
      } else if (t >= yestStart) {
        yesterday.push(c);
      } else if (t >= prev7Start) {
        prev7.push(c);
      } else {
        older.push(c);
      }
    }

    return [
      { key: 'awaiting', title: 'Awaiting Your Action', items: awaiting, countClass: 'count-alert' },
      { key: 'today', title: 'Today', items: today },
      { key: 'yesterday', title: 'Yesterday', items: yesterday },
      { key: 'prev7', title: 'Previous 7 Days', items: prev7 },
      { key: 'older', title: 'Older', items: older }
    ];
  }

  function renderSidebar() {
    var state = store.getState();
    var container = document.getElementById('chat-sb-list');
    if (!container) return;

    var filterType = state.filterType;
    var filterStatus = state.filterStatus;
    var search = (state.search || '').toLowerCase().trim();
    var activeId = state.activeId;
    var user = state.user;

    var chats = state.chats || [];
    var filtered = chats.filter(function (c) {
      if (state.archiveView) {
        if (!c.isArchived) return false;
      } else {
        if (c.isArchived) return false;
      }
      if (filterType && filterType !== 'all' && c.type !== filterType) return false;
      if (filterStatus && filterStatus !== 'all') {
        if (filterStatus === 'awaiting') {
          if (!isAwaitingAction(c, user)) return false;
        } else if (c.status !== filterStatus) {
          return false;
        }
      }
      if (search) {
        var matchTitle = (c.title || '').toLowerCase().includes(search);
        var matchType = (c.type || '').toLowerCase().includes(search);
        var trackId = c.batchTrackId || c.trackId || '';
        var uploader = (c.uploadedBy && c.uploadedBy.name) || c.uploaderName || '';
        var matchTrack = trackId.toLowerCase().includes(search);
        var matchUploader = uploader.toLowerCase().includes(search);
        if (!matchTitle && !matchType && !matchTrack && !matchUploader) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:36px 12px;color:var(--tmu);font-size:12px;">' +
        '<re-icon icon="inbox" size="24" style="margin-bottom:8px;opacity:0.6;"></re-icon>' +
        '<div>No import chats found</div>' +
        '</div>';
      return;
    }

    var groups = groupChats(filtered, user);
    var html = '';

    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g];
      if (grp.items.length === 0) continue;

      html += '<div class="chat-group-title">' +
        '<span>' + util.esc(grp.title) + '</span>' +
        '<span style="font-size:10px;font-weight:600;opacity:0.7;">' + grp.items.length + '</span>' +
        '</div>';

      for (var j = 0; j < grp.items.length; j++) {
        var item = grp.items[j];
        var typeMeta = config.TYPES[item.type] || { icon: 'upload', label: item.type };
        var statusMeta = config.STATUSES[item.status] || { label: item.status, pill: 'status-draft' };
        var isActive = item._id === activeId;
        var isUnread = false;
        if (item.hasUnread !== undefined) {
          isUnread = Boolean(item.hasUnread);
        } else if (user && item.seenBy) {
          var seenEntry = item.seenBy.find(function (s) { return String(s.userId) === String(user._id); });
          var lastSeq = item.messageSeq || 0;
          var seenSeq = seenEntry ? (seenEntry.seq !== undefined ? seenEntry.seq : seenEntry.lastSeenSeq) : 0;
          if (!seenEntry || seenSeq < lastSeq) {
            isUnread = true;
          }
        }

        var iconName = typeMeta.icon || 'upload';
        var timeLabel = util.timeAgo(item.lastMessageAt || item.updatedAt || item.createdAt);
        var statusClass = 'status-' + (item.status || 'draft');
        var uploaderName = (item.uploadedBy && item.uploadedBy.name) || item.uploaderName || '';

        html += '<div class="chat-item ' + (isActive ? 'active' : '') + '" data-action="select-chat" data-chat-id="' + util.esc(item._id) + '">' +
          '<div class="chat-item-ic"><re-icon icon="' + iconName + '" size="15"></re-icon></div>' +
          '<div class="chat-item-body">' +
            '<div class="chat-item-title" title="' + util.esc(item.title) + '">' + util.esc(item.title || (typeMeta.label + ' Import')) + '</div>' +
            '<div class="chat-item-sub">' +
              '<span>' + util.esc(timeLabel) + '</span>' +
              (uploaderName ? ('<span>· ' + util.esc(uploaderName) + '</span>') : '') +
            '</div>' +
            '<div class="chat-item-meta">' +
              '<span class="chat-status-pill ' + statusClass + '">' + util.esc(statusMeta.label) + '</span>' +
              (isUnread ? '<span class="chat-unread-dot" title="Unread updates"></span>' : '') +
            '</div>' +
          '</div>' +
          '<button class="chat-archive-btn" data-action="archive-chat" data-chat-id="' + util.esc(item._id) + '" title="' + (state.archiveView ? 'Unarchive' : 'Archive') + '">' +
            '<re-icon icon="' + (state.archiveView ? 'archive-restore' : 'archive') + '" size="13"></re-icon>' +
          '</button>' +
        '</div>';
      }
    }

    container.innerHTML = html;
  }

  function fetchAndRefreshList() {
    return api.getBatches({ archived: store.getState().archiveView ? 'true' : 'false' })
      .then(function (res) {
        var batches = (res && res.batches) ? res.batches : ((res && res.data && res.data.batches) ? res.data.batches : []);
        store.setState({ chats: batches });
        renderSidebar();
      })
      .catch(function (err) {
        console.warn('Failed to load chats list:', err);
      });
  }

  root.Bulk.sidebar = {
    render: renderSidebar,
    refresh: fetchAndRefreshList,
    init: function () {
      store.subscribe(function () {
        renderSidebar();
      });

      // Search input handler
      var searchInput = document.getElementById('chat-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', util.debounce(function (e) {
          store.setState({ search: e.target.value });
        }, 150));
      }

      // Filter pills
      var filterContainer = document.getElementById('chat-sb-filters');
      if (filterContainer) {
        filterContainer.addEventListener('click', function (e) {
          var pill = e.target.closest('.filter-pill');
          if (!pill) return;
          var status = pill.getAttribute('data-status') || 'all';
          var pills = filterContainer.querySelectorAll('.filter-pill');
          pills.forEach(function (p) { p.classList.remove('active'); });
          pill.classList.add('active');
          store.setState({ filterStatus: status });
        });
      }
    }
  };
})(window);
