/**
 * bulk.boot.js
 * Bootloader for Bulk Chat UI: auth initialization, URL routing, stream lifecycle, and event delegation.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var util = root.Bulk.util;
  var config = root.Bulk.config;
  var api = root.Bulk.api;
  var store = root.Bulk.store;

  var currentStreamAbort = null;

  function updateHeader(batch) {
    var titleEl = document.getElementById('chat-header-title');
    var trackEl = document.getElementById('chat-header-trackid');
    var stepperEl = document.getElementById('chat-header-stepper');
    var drawerBtn = document.getElementById('btn-header-drawer');

    if (!batch) {
      if (titleEl) titleEl.textContent = 'Bulk Operations';
      if (trackEl) trackEl.style.display = 'none';
      if (stepperEl) stepperEl.innerHTML = '';
      if (drawerBtn) drawerBtn.style.display = 'none';
      return;
    }

    var isVerifiable = (batch.type === 'student' || batch.type === 'teacher') &&
      ['sudo_initial_approved', 'verifying', 'verified_all'].includes(batch.status);
    if (drawerBtn) {
      drawerBtn.style.display = isVerifiable ? 'inline-flex' : 'none';
    }

    var typeMeta = config.TYPES[batch.type] || { label: batch.type, icon: 'upload' };
    if (titleEl) titleEl.textContent = batch.title || (typeMeta.label + ' Import');
    if (trackEl) {
      trackEl.style.display = 'inline-block';
      trackEl.textContent = batch.batchTrackId || batch.trackId || ('ID: ' + String(batch._id).slice(-6));
    }

    if (stepperEl) {
      var currentStep = config.getStepForStatus(batch.status, batch.type);
      var isSimpleType = batch.type === 'dept' || batch.type === 'class' || batch.type === 'subject';
      var steps = config.STEPS;

      var html = '';
      for (var s = 0; s < steps.length; s++) {
        var st = steps[s];
        // Skip verification step for dept/class/subject
        if (isSimpleType && st.num === 3) continue;

        var isActive = st.num === currentStep;
        var isDone = st.num < currentStep;
        var cls = isActive ? 'active' : (isDone ? 'completed' : '');

        html += '<div class="step-item ' + cls + '">' +
          '<div class="step-num">' + (isDone ? '✓' : st.num) + '</div>' +
          '<span>' + util.esc(st.label) + '</span>' +
        '</div>';

        if (s < steps.length - 1 && !(isSimpleType && s === 2)) {
          html += '<span class="step-sep">/</span>';
        }
      }
      stepperEl.innerHTML = html;
    }
  }

  var currentStreamAbort = null;
  var isCreatingBatch = false;

  function openChat(batchId, skipHistoryPush) {
    if (currentStreamAbort) {
      try { currentStreamAbort.abort(); } catch (e) {}
      currentStreamAbort = null;
    }

    if (!batchId) {
      store.setState({ activeId: null, batch: null, messages: [], progress: null, activeTab: 'chat' });
      updateHeader(null);
      if (!skipHistoryPush && window.history.pushState) {
        window.history.pushState({}, '', window.location.pathname);
      }
      return;
    }

    var abortController = new AbortController();
    currentStreamAbort = abortController;

    store.setState({
      activeId: batchId,
      activeTab: 'chat',
      batch: null,
      messages: [],
      progress: null,
      drawerOpen: false
    });

    if (!skipHistoryPush && window.history.pushState) {
      window.history.pushState({}, '', '?chat=' + encodeURIComponent(batchId));
    }

    // Load batch details and messages in parallel with cancellation signal
    Promise.all([
      api.getBatch(batchId, { signal: abortController.signal }),
      api.getMessages(batchId, null, { signal: abortController.signal })
    ]).then(function (results) {
      if (abortController.signal.aborted) return;

      var batchData = results[0] && results[0].data && results[0].data.batch ? results[0].data.batch : (results[0] ? results[0].batch : null);
      var msgsData = results[1] && results[1].data && results[1].data.messages ? results[1].data.messages : (results[1] && results[1].messages ? results[1].messages : []);

      if (!batchData) {
        throw new Error('Batch data could not be loaded');
      }

      store.setState({
        batch: batchData,
        messages: msgsData,
        progress: batchData.progress || null
      });

      updateHeader(batchData);

      // Paginate remaining messages if batch has more messages than initial page
      var maxSeq = msgsData.length > 0 ? (msgsData[msgsData.length - 1].seq || 0) : 0;
      if (batchData.messageSeq && batchData.messageSeq > maxSeq) {
        (function fetchNext(seq) {
          api.getMessages(batchId, seq, { signal: abortController.signal }).then(function (nextRes) {
            if (abortController.signal.aborted) return;
            var more = nextRes && nextRes.messages ? nextRes.messages : (nextRes && nextRes.data && nextRes.data.messages ? nextRes.data.messages : []);
            if (more && more.length) {
              var current = (store.getState().messages || []).slice();
              more.forEach(function (m) {
                var exists = current.some(function (c) {
                  return (c._id && m._id && c._id === m._id) || (c.seq !== undefined && m.seq !== undefined && c.seq === m.seq);
                });
                if (!exists) current.push(m);
              });
              store.setState({ messages: current });
              var newMax = more[more.length - 1].seq || 0;
              if (batchData.messageSeq > newMax && more.length >= 100) {
                fetchNext(newMax);
              }
            }
          }).catch(function () {});
        })(maxSeq);
      }

      // Mark seen
      if (batchData.messageSeq) {
        api.markSeen(batchId, batchData.messageSeq).catch(function () {});
      }

      // Stream events for all non-terminal states (F-16)
      var terminalStates = ['committed', 'rejected', 'cancelled'];
      if (!terminalStates.includes(batchData.status)) {
        api.stream(batchId, function (event) {
          var st = store.getState();
          if (event.type === 'progress') {
            store.setState({ progress: event.data });
          } else if (event.type === 'message') {
            var newMsgs = (st.messages || []).slice();
            var exists = newMsgs.some(function (m) {
              return (m._id && event.data._id && m._id === event.data._id) ||
                     (m.seq !== undefined && event.data.seq !== undefined && m.seq === event.data.seq);
            });
            if (!exists) {
              newMsgs.push(event.data);
              store.setState({ messages: newMsgs });
            }
            // If the message brings a newer sequence number, refresh batch
            if (event.data && event.data.seq && (!st.batch || event.data.seq > (st.batch.messageSeq || 0))) {
              api.getBatch(batchId).then(function (res) {
                if (abortController.signal.aborted) return;
                var freshBatch = res && res.data && res.data.batch ? res.data.batch : (res ? res.batch : null);
                if (freshBatch) {
                  store.setState({
                    batch: freshBatch,
                    progress: freshBatch.progress || null
                  });
                  updateHeader(freshBatch);
                }
              }).catch(function () {});
            }
          } else if (event.type === 'status') {
            // F-15: Refetch the complete batch from server so counts, eligibleRows, and roadmap reflect state change
            api.getBatch(batchId).then(function (res) {
              if (abortController.signal.aborted) return;
              var freshBatch = res && res.data && res.data.batch ? res.data.batch : (res ? res.batch : null);
              if (freshBatch) {
                store.setState({
                  batch: freshBatch,
                  progress: freshBatch.progress || null
                });
                updateHeader(freshBatch);
              }
            }).catch(function () {
              if (st.batch) {
                var patched = Object.assign({}, st.batch, { status: event.data.status, step: event.data.step });
                store.setState({ batch: patched });
                updateHeader(patched);
              }
            });
          } else if (event.type === 'row') {
            if (st.batch && st.batch.eligibleRows) {
              var updatedRows = st.batch.eligibleRows.map(function (r) {
                if (r.rowNumber === event.data.rowNumber) {
                  return Object.assign({}, r, { isVerified: event.data.isVerified });
                }
                return r;
              });
              store.setState({ batch: Object.assign({}, st.batch, { eligibleRows: updatedRows }) });
            }
          } else if (event.type === 'snapshot') {
            if (event.data) {
              var curBatch = store.getState().batch;
              var curMsgs = store.getState().messages || [];
              var maxKnownSeq = curMsgs.length > 0 ? (curMsgs[curMsgs.length - 1].seq || 0) : 0;
              if (event.data.lastSeq && event.data.lastSeq > maxKnownSeq) {
                api.getMessages(batchId, maxKnownSeq, { signal: abortController.signal }).then(function (res) {
                  if (abortController.signal.aborted) return;
                  var newMsgs = res && res.messages ? res.messages : (res && res.data && res.data.messages ? res.data.messages : []);
                  if (newMsgs && newMsgs.length) {
                    var merged = (store.getState().messages || []).slice();
                    newMsgs.forEach(function (m) {
                      var exists = merged.some(function (c) {
                        return (c._id && m._id && c._id === m._id) || (c.seq !== undefined && m.seq !== undefined && c.seq === m.seq);
                      });
                      if (!exists) merged.push(m);
                    });
                    store.setState({ messages: merged });
                  }
                }).catch(function () {});
              }
              if (event.data.status && curBatch && event.data.status !== curBatch.status) {
                api.getBatch(batchId).then(function (res) {
                  if (abortController.signal.aborted) return;
                  var fresh = res && res.data && res.data.batch ? res.data.batch : (res ? res.batch : null);
                  if (fresh) {
                    store.setState({ batch: fresh, progress: fresh.progress || null });
                    updateHeader(fresh);
                  }
                }).catch(function () {});
              }
            }
          }
        }, abortController.signal);
      }
    }).catch(function (err) {
      if (abortController.signal.aborted) return;
      if (typeof root.showToast === 'function') root.showToast('Failed to open chat: ' + err.message, 'warn');
    });
  }

  function startNewImport(type) {
    if (isCreatingBatch) return;
    isCreatingBatch = true;

    var btn = document.querySelector('[data-action="pick-type"][data-type="' + type + '"]');
    if (btn) {
      btn.classList.add('loading');
      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
    }

    var typeMeta = config.TYPES[type] || { label: type };
    var title = typeMeta.label + ' Import - ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    api.createBatch(type, title).then(function (res) {
      var batch = res && res.data && res.data.batch ? res.data.batch : (res && res.batch ? res.batch : null);
      if (batch && batch._id) {
        root.Bulk.sidebar.refresh().then(function () {
          openChat(batch._id);
        });
      }
    }).catch(function (err) {
      if (typeof root.showToast === 'function') root.showToast('Could not start import: ' + err.message, 'warn');
    }).finally(function () {
      isCreatingBatch = false;
      if (btn) {
        btn.classList.remove('loading');
        btn.style.opacity = '';
        btn.style.pointerEvents = '';
      }
    });
  }

  function archiveChat(batchId) {
    var state = store.getState();
    var chat = (state.chats || []).find(function (c) { return c._id === batchId; });
    var currentlyArchived = chat && chat.isArchived;

    api.archiveBatch(batchId, !currentlyArchived).then(function () {
      if (typeof root.showToast === 'function') root.showToast(currentlyArchived ? 'Chat restored from archive' : 'Chat archived');
      root.Bulk.sidebar.refresh().then(function () {
        if (state.activeId === batchId) {
          openChat(null);
        }
      });
    }).catch(function (err) {
      if (typeof root.showToast === 'function') root.showToast('Failed to archive: ' + err.message, 'warn');
    });
  }

  function switchTab(tab) {
    store.setState({ activeTab: tab });
    var chatMain = document.getElementById('chat-main-container');
    var restoreMain = document.getElementById('restore-main-container');
    var wzRestoreTab = document.getElementById('wz-tab-restore');

    if (tab === 'restore') {
      if (chatMain) chatMain.style.display = 'none';
      if (restoreMain) restoreMain.style.display = 'block';
      if (wzRestoreTab) wzRestoreTab.classList.add('act');
    } else {
      if (chatMain) chatMain.style.display = 'flex';
      if (restoreMain) restoreMain.style.display = 'none';
      if (wzRestoreTab) wzRestoreTab.classList.remove('act');
    }
  }

  function toggleBulkSidebar() {
    var sb = document.querySelector('.chat-sidebar');
    var overlay = document.getElementById('sb-overlay');
    if (!sb) return;
    var isOpen = sb.classList.toggle('mobile-open');
    if (overlay) overlay.classList.toggle('visible', isOpen);
  }

  function goBack() {
    var user = store.getState().user;
    var isAdm = typeof root.isAdminUser === 'function' ? root.isAdminUser(user) : (user && (['admin', 'sudo'].includes(user.role) || Boolean(user.isAdmin)));
    if (user && (user.role === 'teacher' || isAdm)) {
      window.location.href = 'selector.html';
    } else {
      window.location.href = 'admin.html';
    }
  }

  function loadLookups() {
    return Promise.all([
      api.request('GET', '/api/depts').catch(function () { return []; }),
      api.request('GET', '/api/classes').catch(function () { return []; }),
      api.request('GET', '/api/subjects').catch(function () { return []; }),
      api.request('GET', '/api/year/batches').catch(function () { return []; }),
      api.request('GET', '/api/year').catch(function () { return []; })
    ]).then(function (res) {
      var cache = {
        depts: Array.isArray(res[0]) ? res[0] : (res[0].data || []),
        classes: Array.isArray(res[1]) ? res[1] : (res[1].data || []),
        subjects: Array.isArray(res[2]) ? res[2] : (res[2].data || []),
        batches: Array.isArray(res[3]) ? res[3] : (res[3].data || []),
        years: Array.isArray(res[4]) ? res[4] : (res[4].data || [])
      };
      store.setState({ cache: cache });
    });
  }

  function initApp() {
    var user = typeof root.getUser === 'function' ? root.getUser() : null;
    if (!user) {
      console.warn('No authenticated user session found.');
      return;
    }

    // Check feature flag for bulkChatUi
    fetch('/api/settings/public')
      .then(function (r) { return r.json(); })
      .then(function (pub) {
        if (pub && pub.pages && pub.pages.bulkChatUi === false) {
          window.location.replace('bulk-legacy.html' + window.location.search);
        }
      })
      .catch(function () {});

    var isSudo = typeof root.isSudoAdmin === 'function' ? root.isSudoAdmin(user) : (user && (user.role === 'sudo' || (user.role === 'admin' && user.adminFlag !== 'subadmin')));
    var isAdm = typeof root.isAdminUser === 'function' ? root.isAdminUser(user) : (user && (['admin', 'sudo'].includes(user.role) || Boolean(user.isAdmin)));

    store.setState({ user: user });

    // Populate sidebar user block
    var nameEl = document.getElementById('chat-sb-user-name');
    var roleEl = document.getElementById('chat-sb-user-role');
    var avEl = document.getElementById('chat-sb-avatar');
    var restoreBtn = document.getElementById('btn-nav-restore');

    if (nameEl) nameEl.textContent = user.name || user.username || 'User';
    if (roleEl) roleEl.textContent = isSudo ? 'Sudo Administrator' : (isAdm ? 'Administrator' : 'Faculty Member');
    if (avEl) avEl.textContent = (user.name || user.username || 'A').charAt(0).toUpperCase();
    if (restoreBtn) restoreBtn.style.display = isSudo ? 'flex' : 'none';

    // Sub modules initialization
    root.Bulk.sidebar.init();
    root.Bulk.transcript.init();
    root.Bulk.drawer.init();
    root.Bulk.initVerifyModal();

    // Fetch capabilities & schema in parallel
    Promise.all([
      api.getCapabilities().catch(function () { return { types: {} }; }),
      api.getSchema().catch(function () { return {}; }),
      loadLookups()
    ]).then(function (results) {
      var caps = results[0] && results[0].data ? results[0].data : results[0];
      var rawSchema = results[1] || {};
      var schema = (rawSchema.data && rawSchema.data.schemas) ? rawSchema.data.schemas : (rawSchema.schemas || rawSchema.data || rawSchema);
      store.setState({ caps: caps, schema: schema });

      // Refresh sidebar list
      return root.Bulk.sidebar.refresh();
    }).then(function () {
      // Route based on URL query
      var params = new URLSearchParams(window.location.search);
      var chatId = params.get('chat');
      var tab = params.get('tab') || params.get('page');

      if (tab === 'restore' && isSudo) {
        switchTab('restore');
      } else if (chatId) {
        openChat(chatId, true);
      } else {
        openChat(null, true);
      }
    });

    // Browser navigation back/forward support
    window.addEventListener('popstate', function () {
      var params = new URLSearchParams(window.location.search);
      var chatId = params.get('chat');
      var tab = params.get('tab');
      if (tab === 'restore') {
        switchTab('restore');
      } else {
        switchTab('chat');
        openChat(chatId, true);
      }
    });

    // Global event delegation
    document.addEventListener('click', function (e) {
      var actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-action');

      if (action === 'new-import') {
        openChat(null);
      } else if (action === 'select-chat') {
        var id = actionEl.getAttribute('data-chat-id');
        if (id) openChat(id);
      } else if (action === 'archive-chat') {
        e.stopPropagation();
        var archId = actionEl.getAttribute('data-chat-id');
        if (archId) archiveChat(archId);
      } else if (action === 'open-drawer') {
        store.setState({ drawerOpen: true });
      } else if (action === 'go-back') {
        goBack();
      } else if (action === 'open-tab-restore') {
        switchTab('restore');
      } else if (action === 'open-tab-chat') {
        switchTab('chat');
      }
    });
  }

  root.Bulk.openChat = openChat;
  root.Bulk.startNewImport = startNewImport;
  root.Bulk.archiveChat = archiveChat;
  root.Bulk.switchTab = switchTab;
  root.Bulk.toggleBulkSidebar = toggleBulkSidebar;
  root.Bulk.goBack = goBack;

  // Global functions for inline HTML compatibility
  root.toggleBulkSidebar = toggleBulkSidebar;
  root.goBack = goBack;

  // Boot on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})(window);
