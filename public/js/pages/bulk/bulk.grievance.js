/**
 * public/js/pages/bulk/bulk.grievance.js
 * Grievance & Error Reporting System for Bulk Operations.
 * Handles problem reporting modal, admin sticky alerts, and slide-over grievances panel.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var util = root.Bulk.util || {};
  var api = root.Bulk.api || {};
  var store = root.Bulk.store || {};

  var activeModal = null;
  var activeDrawer = null;
  var bannerDismissedForSession = {};

  /**
   * Builds auto-generated error report text from skipped rows
   */
  function generateReportText(batch, pendingOnly) {
    if (!batch) return '';
    var skipped = batch.skippedRows || [];
    var target = pendingOnly
      ? skipped.filter(function (r) { return !r.isDone && !r.isResolved; })
      : skipped;

    var trackId = batch.batchTrackId || batch._id || 'Import';
    var typeLabel = (batch.type || 'records').toUpperCase();
    var dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

    var lines = [
      'Import ' + trackId + ' · ' + typeLabel + ' · ' + (batch.originalFileName || 'sheet') + ' · ' + dateStr,
      'Total: ' + ((batch.eligibleCount || 0) + (batch.skippedCount || 0)) + ' | Eligible: ' + (batch.eligibleCount || 0) + ' | Skipped: ' + (batch.skippedCount || 0) + ' (' + target.length + ' selected)',
      '------------------------------------------------------------'
    ];

    for (var i = 0; i < target.length; i++) {
      var r = target[i];
      var idStr = (r.data && (r.data.registerNo || r.data.name || r.data.fullName || r.data.employeeNo || r.data.code)) || ('Row ' + r.rowNumber);
      var issuesStr = Array.isArray(r.issues) && r.issues.length ? r.issues.join('; ') : (r.reason || 'Validation error');
      lines.push('Row ' + (r.rowNumber || (i + 1)) + ' [' + idStr + '] — ' + issuesStr);
    }

    return lines.join('\n');
  }

  /**
   * Opens problem reporting modal for skipped rows
   */
  function openReportModal(ctx) {
    closeReportModal();
    ctx = ctx || {};
    var batch = ctx.batch || (store.getState ? store.getState().batch : null);
    if (!batch) return;

    var skipped = batch.skippedRows || [];
    var pendingRows = skipped.filter(function (r) { return !r.isDone && !r.isResolved; });
    var initialPendingOnly = pendingRows.length > 0;

    var modalEl = document.createElement('div');
    modalEl.className = 'grievance-modal-backdrop';
    modalEl.id = 'grievance-report-modal';

    function getReportContent(pendingOnly) {
      return generateReportText(batch, pendingOnly);
    }

    modalEl.innerHTML = '<div class="grievance-modal-box">' +
      '<div class="grievance-modal-header">' +
        '<div style="font-weight:700;font-size:14px;color:var(--td);display:flex;align-items:center;gap:8px;">' +
          '<re-icon icon="alert-circle" size="17"></re-icon>' +
          '<span>Report a Problem with this Import</span>' +
        '</div>' +
        '<button type="button" class="btn-ghost-icon" data-action="close-modal" aria-label="Close">' +
          '<re-icon icon="x" size="16"></re-icon>' +
        '</button>' +
      '</div>' +
      '<div class="grievance-modal-body">' +
        '<div style="font-size:12px;color:var(--tmu);margin-bottom:10px;">' +
          'An error report is automatically compiled from skipped rows. You can copy it for your records or dispatch it directly to administrators.' +
        '</div>' +
        '<div class="grievance-scope-select">' +
          '<label class="scope-radio-label">' +
            '<input type="radio" name="grievance-scope" value="pending" ' + (initialPendingOnly ? 'checked' : '') + '> ' +
            '<span>Pending rows only (' + pendingRows.length + ' rows)</span>' +
          '</label>' +
          '<label class="scope-radio-label">' +
            '<input type="radio" name="grievance-scope" value="all" ' + (!initialPendingOnly ? 'checked' : '') + '> ' +
            '<span>All skipped rows (' + skipped.length + ' rows)</span>' +
          '</label>' +
        '</div>' +
        '<div class="grievance-report-preview">' +
          '<textarea id="grievance-report-text" readonly spellcheck="false" class="report-textarea">' +
            util.esc(getReportContent(initialPendingOnly)) +
          '</textarea>' +
        '</div>' +
        '<div style="margin-top:12px;">' +
          '<label style="display:block;font-size:11.5px;font-weight:600;color:var(--td);margin-bottom:4px;">' +
            'Add a note for the Administrator (optional):' +
          '</label>' +
          '<textarea id="grievance-note-input" maxlength="500" placeholder="Describe any issues or context for this batch…" class="note-textarea" rows="2"></textarea>' +
          '<div style="text-align:right;font-size:10.5px;color:var(--tmu);margin-top:2px;" id="grievance-note-counter">0 / 500</div>' +
        '</div>' +
      '</div>' +
      '<div class="grievance-modal-footer">' +
        '<button type="button" class="btn-out" id="btn-copy-grievance">' +
          '<re-icon icon="copy" size="13"></re-icon> <span>Copy Error Text</span>' +
        '</button>' +
        '<div style="display:flex;gap:8px;">' +
          '<button type="button" class="btn-out" data-action="close-modal">Cancel</button>' +
          '<button type="button" class="btn-form-pri" id="btn-send-grievance" style="background:var(--gB);">' +
            '<re-icon icon="send" size="13"></re-icon> <span>Send to Admin</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';

    document.body.appendChild(modalEl);
    activeModal = modalEl;

    var reportArea = modalEl.querySelector('#grievance-report-text');
    var noteInput = modalEl.querySelector('#grievance-note-input');
    var counterEl = modalEl.querySelector('#grievance-note-counter');
    var radios = modalEl.querySelectorAll('input[name="grievance-scope"]');

    radios.forEach(function (r) {
      r.addEventListener('change', function () {
        var isPending = r.value === 'pending';
        reportArea.value = getReportContent(isPending);
      });
    });

    if (noteInput && counterEl) {
      noteInput.addEventListener('input', function () {
        counterEl.textContent = noteInput.value.length + ' / 500';
      });
    }

    modalEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-action="close-modal"]') || e.target === modalEl) {
        closeReportModal();
        return;
      }

      var copyBtn = e.target.closest('#btn-copy-grievance');
      if (copyBtn) {
        var text = reportArea.value;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            if (typeof root.showToast === 'function') root.showToast('Error report copied to clipboard');
          });
        } else {
          reportArea.select();
          document.execCommand('copy');
          if (typeof root.showToast === 'function') root.showToast('Error report copied to clipboard');
        }
        return;
      }

      var sendBtn = e.target.closest('#btn-send-grievance');
      if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<span>Sending…</span>';
        var isPending = modalEl.querySelector('input[name="grievance-scope"]:checked')?.value === 'pending';
        var selectedRows = isPending
          ? pendingRows.map(function (row) { return row.rowNumber; })
          : skipped.map(function (row) { return row.rowNumber; });

        api.submitGrievance(batch._id, {
          note: noteInput.value,
          rows: selectedRows,
          kind: 'rows'
        }).then(function (res) {
          if (typeof root.showToast === 'function') {
            root.showToast(res.message || 'Problem report sent to administrators');
          }
          closeReportModal();
          // Update local batch grievance counters if available
          if (res.data && res.data.grievance && store.getState) {
            var curBatch = store.getState().batch;
            if (curBatch) {
              store.setState({ batch: Object.assign({}, curBatch, { grievance: res.data.grievance }) });
            }
          }
        }).catch(function (err) {
          sendBtn.disabled = false;
          sendBtn.innerHTML = '<re-icon icon="send" size="13"></re-icon> <span>Send to Admin</span>';
          if (typeof root.showToast === 'function') root.showToast('Failed to send report: ' + err.message, 'danger');
        });
      }
    });
  }

  function closeReportModal() {
    if (activeModal && activeModal.parentNode) {
      activeModal.parentNode.removeChild(activeModal);
    }
    activeModal = null;
  }

  /**
   * Slide-over panel for Administrators to inspect and resolve grievances
   */
  function openGrievancesPanel(ctx) {
    closeGrievancesPanel();
    ctx = ctx || {};
    var batch = ctx.batch || (store.getState ? store.getState().batch : null);
    if (!batch) return;

    var drawer = document.createElement('div');
    drawer.className = 'grievance-drawer-backdrop';
    drawer.id = 'grievance-drawer';

    drawer.innerHTML = '<div class="grievance-drawer-box">' +
      '<div class="grievance-drawer-header">' +
        '<div style="font-weight:700;font-size:14px;color:var(--td);display:flex;align-items:center;gap:8px;">' +
          '<re-icon icon="flag" size="16"></re-icon>' +
          '<span>Import Problem Reports (Grievances)</span>' +
        '</div>' +
        '<button type="button" class="btn-ghost-icon" data-action="close-drawer">' +
          '<re-icon icon="x" size="16"></re-icon>' +
        '</button>' +
      '</div>' +
      '<div class="grievance-drawer-content" id="grievance-drawer-list">' +
        '<div style="padding:24px;text-align:center;color:var(--tmu);font-size:12px;">Loading reports…</div>' +
      '</div>' +
    '</div>';

    document.body.appendChild(drawer);
    activeDrawer = drawer;

    drawer.addEventListener('click', function (e) {
      if (e.target.closest('[data-action="close-drawer"]') || e.target === drawer) {
        closeGrievancesPanel();
        return;
      }

      var resolveBtn = e.target.closest('[data-action="resolve-grievance"]');
      if (resolveBtn) {
        var msgId = resolveBtn.getAttribute('data-msg-id');
        var replyInput = drawer.querySelector('#reply-' + msgId);
        var replyNote = replyInput ? replyInput.value : '';

        resolveBtn.disabled = true;
        resolveBtn.textContent = 'Resolving…';

        api.resolveGrievance(batch._id, msgId, replyNote).then(function (res) {
          if (typeof root.showToast === 'function') root.showToast('Grievance marked as resolved');
          if (res.data && res.data.grievance && store.getState) {
            var cur = store.getState().batch;
            if (cur) store.setState({ batch: Object.assign({}, cur, { grievance: res.data.grievance }) });
          }
          loadReports();
        }).catch(function (err) {
          resolveBtn.disabled = false;
          resolveBtn.textContent = 'Mark Resolved';
          if (typeof root.showToast === 'function') root.showToast('Resolve error: ' + err.message, 'danger');
        });
      }
    });

    function loadReports() {
      api.getGrievances(batch._id).then(function (res) {
        var list = (res.data && res.data.grievances) || [];
        var container = drawer.querySelector('#grievance-drawer-list');
        if (!container) return;

        if (list.length === 0) {
          container.innerHTML = '<div style="padding:32px 20px;text-align:center;color:var(--tmu);font-size:13px;">' +
            '<re-icon icon="check-circle" size="24" style="color:#15803d;margin-bottom:8px;"></re-icon>' +
            '<div>No open problem reports for this import.</div>' +
          '</div>';
          return;
        }

        var html = '<div style="padding:14px 18px;display:flex;flex-direction:column;gap:12px;">';
        for (var i = 0; i < list.length; i++) {
          var g = list[i];
          var p = g.payload || {};
          var isResolved = p.status === 'resolved';

          html += '<div class="grievance-item-card ' + (isResolved ? 'resolved' : 'open') + '">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
              '<div style="font-weight:700;font-size:12px;color:var(--td);display:flex;align-items:center;gap:6px;">' +
                '<span>' + util.esc(g.actor?.name || 'Staff User') + '</span>' +
                '<span class="chat-status-pill ' + (isResolved ? 'status-verified_all' : 'status-failed') + '">' +
                  (isResolved ? '✓ Resolved' : '● Open') +
                '</span>' +
              '</div>' +
              '<div style="font-size:10.5px;color:var(--tmu);">' + util.fmtDate(g.createdAt) + '</div>' +
            '</div>' +
            (p.note ? ('<div style="font-size:12px;color:#78350f;background:#fef3c7;padding:6px 10px;border-radius:8px;margin-bottom:8px;"><strong>Note:</strong> ' + util.esc(p.note) + '</div>') : '') +
            '<div style="font-size:11px;font-family:monospace;color:var(--td);background:#f8faf8;padding:8px 10px;border-radius:8px;border:1px solid var(--brl);white-space:pre-wrap;max-height:120px;overflow-y:auto;margin-bottom:8px;">' +
              util.esc(p.text || '') +
            '</div>';

          if (isResolved) {
            html += '<div style="font-size:11px;color:#15803d;display:flex;align-items:center;gap:6px;">' +
              '<re-icon icon="check" size="12"></re-icon>' +
              '<span>Resolved by ' + util.esc(p.resolvedBy || 'Administrator') + '</span>' +
            '</div>';
          } else {
            html += '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;">' +
              '<input type="text" id="reply-' + g._id + '" placeholder="Optional reply/resolution note…" style="flex:1;padding:5px 8px;font-size:11px;border:1px solid var(--br);border-radius:6px;">' +
              '<button type="button" class="btn-replace" data-action="resolve-grievance" data-msg-id="' + g._id + '" style="padding:5px 12px;font-size:11px;background:#15803d;color:#fff;">Mark Resolved</button>' +
            '</div>';
          }

          html += '</div>';
        }
        html += '</div>';
        container.innerHTML = html;
      }).catch(function (err) {
        var container = drawer.querySelector('#grievance-drawer-list');
        if (container) container.innerHTML = '<div style="padding:20px;color:#991b1b;font-size:12px;">Failed to load reports: ' + util.esc(err.message) + '</div>';
      });
    }

    loadReports();
  }

  function closeGrievancesPanel() {
    if (activeDrawer && activeDrawer.parentNode) {
      activeDrawer.parentNode.removeChild(activeDrawer);
    }
    activeDrawer = null;
  }

  /**
   * Mounts a sticky banner in the chat transcript if user is administrator and batch has open grievances
   */
  function checkAdminBanner(batch, user) {
    var transcript = document.getElementById('chat-transcript');
    if (!transcript || !batch) return;

    var isAdm = user && (user.role === 'admin' || user.role === 'sudo' || user.isSudoAdmin || user.accessRole === 'sudoAdmin' || user.accessRole === 'superAdmin');
    var isOwner = batch.uploadedBy?.userId && user?._id && String(batch.uploadedBy.userId) === String(user._id);

    // Existing banner cleanup
    var oldBanner = transcript.querySelector('.grievance-sticky-banner');
    if (oldBanner) oldBanner.parentNode.removeChild(oldBanner);

    if (!isAdm || isOwner) return;

    var openCount = (batch.grievance && batch.grievance.open) || 0;
    if (openCount <= 0) return;

    var bannerKey = (batch._id || 'chat') + '-' + openCount;
    if (bannerDismissedForSession[bannerKey]) return;

    var bannerEl = document.createElement('div');
    bannerEl.className = 'grievance-sticky-banner';
    bannerEl.innerHTML = '<div style="display:flex;align-items:center;gap:8px;">' +
      '<re-icon icon="flag" size="14" style="color:#b91c1c;"></re-icon>' +
      '<span><strong>' + openCount + ' open problem report(s)</strong> flagged for this import</span>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:6px;">' +
      '<button type="button" class="btn-out" data-action="open-admin-grievances" style="padding:3px 8px;font-size:11px;background:#ffffff;border-color:#fca5a5;color:#991b1b;font-weight:700;">View Reports</button>' +
      '<button type="button" class="btn-ghost-icon" data-action="dismiss-banner" style="color:#7f1d1d;padding:2px 4px;" title="Dismiss banner">✕</button>' +
    '</div>';

    transcript.insertBefore(bannerEl, transcript.firstChild);

    bannerEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-action="open-admin-grievances"]')) {
        openGrievancesPanel({ batch: batch, user: user });
        return;
      }
      if (e.target.closest('[data-action="dismiss-banner"]')) {
        bannerDismissedForSession[bannerKey] = true;
        if (bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
      }
    });
  }

  // Bind delegated clicks on transcript / document
  if (typeof document !== 'undefined') {
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-action="open-report-grievance"]')) {
        var state = store.getState ? store.getState() : {};
        openReportModal({ batch: state.batch, user: state.user });
        return;
      }
      if (e.target.closest('[data-action="open-grievances"]') || e.target.closest('[data-action="open-admin-grievances"]')) {
        var s = store.getState ? store.getState() : {};
        openGrievancesPanel({ batch: s.batch, user: s.user });
        return;
      }
    });
  }

  root.Bulk.grievance = {
    openReportModal: openReportModal,
    closeReportModal: closeReportModal,
    openGrievancesPanel: openGrievancesPanel,
    closeGrievancesPanel: closeGrievancesPanel,
    checkAdminBanner: checkAdminBanner,
    generateReportText: generateReportText
  };

})(typeof window !== 'undefined' ? window : global);
