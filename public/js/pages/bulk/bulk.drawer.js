/**
 * bulk.drawer.js
 * Verification modal popup window for inspecting, filtering, and verifying individual candidate rows.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var util = root.Bulk.util;
  var store = root.Bulk.store;
  var api = root.Bulk.api;

  function renderDrawer() {
    var drawerEl = document.getElementById('chat-drawer');
    if (!drawerEl) return;

    var state = store.getState();
    var isOpen = Boolean(state.drawerOpen);
    drawerEl.classList.toggle('open', isOpen);
    if (!isOpen) return;

    var bodyEl = drawerEl.querySelector('.drawer-body') || drawerEl.querySelector('.modal-verification-body');
    if (!bodyEl) return;

    var batch = state.batch;
    if (!batch || !batch.eligibleRows || batch.eligibleRows.length === 0) {
      bodyEl.innerHTML = '<div style="text-align:center;padding:50px 20px;color:var(--tmu);">' +
        '<re-icon icon="info" size="32" style="margin-bottom:12px;opacity:0.6;display:inline-block;"></re-icon>' +
        '<div style="font-size:14px;font-weight:600;color:var(--td);">No eligible records to verify</div>' +
        '<div style="font-size:12px;margin-top:4px;">All records for this batch may be already committed, or no eligible rows were found.</div>' +
      '</div>';
      return;
    }

    var filter = state.drawerFilter || 'all';
    var rawSearch = state.drawerSearch || '';
    var search = rawSearch.toLowerCase().trim();
    var page = state.drawerPage || 1;
    var pageSize = state.drawerPageSize || 25;

    var rows = batch.eligibleRows || [];
    var filtered = rows.filter(function (r) {
      if (filter === 'pending' && r.isVerified) return false;
      if (filter === 'verified' && !r.isVerified) return false;
      if (search) {
        var d = r.data || {};
        var match = (d.fullName || d.name || '').toLowerCase().includes(search) ||
                    (d.registerNo || d.regNo || '').toLowerCase().includes(search) ||
                    (d.employeeNo || d.empId || '').toLowerCase().includes(search) ||
                    (d.trackId || '').toLowerCase().includes(search) ||
                    (d.email || '').toLowerCase().includes(search);
        if (!match) return false;
      }
      return true;
    });

    var totalItems = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (page > totalPages) page = totalPages;

    var startIdx = (page - 1) * pageSize;
    var pageRows = filtered.slice(startIdx, startIdx + pageSize);

    var countPending = 0;
    var countVerified = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].isVerified) countVerified++;
      else countPending++;
    }

    // Ensure the top controls structure exists; never destroy the search input node while typing
    var controlsEl = bodyEl.querySelector('.drawer-controls');
    var tableEl = bodyEl.querySelector('.drawer-table-wrap');
    var paginationEl = bodyEl.querySelector('.drawer-pagination');

    if (!controlsEl || !tableEl || !paginationEl) {
      bodyEl.innerHTML = '<div class="drawer-controls">' +
        '<div class="drawer-filter-pills"></div>' +
        '<div style="display:flex;align-items:center;gap:10px;flex:1;justify-content:flex-end;flex-wrap:wrap;">' +
          (countPending > 0
            ? '<button type="button" class="btn-out" id="btn-modal-verify-all" data-action="drawer-verify-all" style="padding:6px 14px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:6px;">' +
                '<re-icon icon="check-circle" size="13"></re-icon> Verify All Remaining' +
              '</button>'
            : '') +
          '<div class="drawer-search-wrap">' +
            '<input type="text" class="fc2" id="drawer-search-input" placeholder="Search rows…">' +
            '<re-icon icon="search" size="14" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--tmu);pointer-events:none;"></re-icon>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="drawer-table-wrap"></div>' +
      '<div class="drawer-pagination"></div>';

      controlsEl = bodyEl.querySelector('.drawer-controls');
      tableEl = bodyEl.querySelector('.drawer-table-wrap');
      paginationEl = bodyEl.querySelector('.drawer-pagination');
    }

    // Update filter pills without replacing the input node
    var pillsContainer = controlsEl.querySelector('.drawer-filter-pills');
    if (pillsContainer) {
      pillsContainer.innerHTML = '<button type="button" class="filter-pill ' + (filter === 'all' ? 'active' : '') + '" data-drawer-filter="all">All (' + rows.length + ')</button>' +
        '<button type="button" class="filter-pill ' + (filter === 'pending' ? 'active' : '') + '" data-drawer-filter="pending">Pending (' + countPending + ')</button>' +
        '<button type="button" class="filter-pill ' + (filter === 'verified' ? 'active' : '') + '" data-drawer-filter="verified">Verified (' + countVerified + ')</button>';
    }

    // Keep search input value in sync if changed externally, but preserve cursor/focus if currently typing
    var searchInput = controlsEl.querySelector('#drawer-search-input');
    if (searchInput && document.activeElement !== searchInput) {
      searchInput.value = rawSearch;
    }

    // Render table
    var tableHtml = '<table class="stg-table" style="width:100%;font-size:12.5px;border-collapse:collapse;">' +
      '<thead>' +
        '<tr style="background:#f8faf8;text-align:left;border-bottom:1.5px solid var(--brl);">' +
          '<th style="padding:10px 14px;width:50px;">#</th>' +
          '<th style="padding:10px 14px;">Name / Details</th>' +
          '<th style="padding:10px 14px;">Identifiers</th>' +
          '<th style="padding:10px 14px;">Status</th>' +
          '<th style="padding:10px 14px;text-align:right;">Action</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>';

    if (pageRows.length === 0) {
      tableHtml += '<tr><td colspan="5" style="text-align:center;padding:36px;color:var(--tmu);font-size:13px;">No records match your criteria.</td></tr>';
    } else {
      for (var j = 0; j < pageRows.length; j++) {
        var row = pageRows[j];
        var d = row.data || {};
        var isVer = Boolean(row.isVerified);
        var name = d.fullName || d.name || ('Row ' + row.rowNumber);
        var subInfo = d.class || d.department || d.designation || '';
        var ident = d.registerNo || d.employeeNo || d.code || '—';
        var track = d.trackId || '';

        var batchType = batch.type;
        if (batchType === 'class') {
          name = d.name || d.className || ('Class Row ' + row.rowNumber);
          subInfo = [d.department || d.deptName || d.deptCode, d.batch, d.sem ? ('Sem ' + d.sem) : ''].filter(Boolean).join(' · ');
          ident = (d.hallNo ? ('Hall: ' + d.hallNo) : '') || (d.advisor ? ('Adv: ' + d.advisor) : '—');
        } else if (batchType === 'dept') {
          name = d.name || ('Dept Row ' + row.rowNumber);
          subInfo = [d.courseType, d.branch, d.category].filter(Boolean).join(' · ');
          ident = d.code ? ('Code: ' + d.code) : (d.number ? ('Tel: ' + d.number) : '—');
        } else if (batchType === 'subject') {
          name = d.name || ('Subject Row ' + row.rowNumber);
          subInfo = [d.department || d.deptName, d.sem ? ('Sem ' + d.sem) : '', d.type].filter(Boolean).join(' · ');
          ident = d.code ? ('Code: ' + d.code) : '—';
        }

        tableHtml += '<tr style="border-bottom:1px solid var(--brl);background:' + (isVer ? '#f0fdf4' : '#ffffff') + ';">' +
          '<td style="padding:10px 14px;font-weight:600;color:var(--tmu);">' + row.rowNumber + '</td>' +
          '<td style="padding:10px 14px;">' +
            '<div style="font-weight:600;color:var(--td);">' + util.esc(name) + '</div>' +
            (subInfo ? ('<div style="font-size:11.5px;color:var(--tmu);">' + util.esc(subInfo) + '</div>') : '') +
          '</td>' +
          '<td style="padding:10px 14px;">' +
            '<div style="font-family:monospace;font-size:11.5px;color:var(--td);">' + util.esc(ident) + '</div>' +
            (track ? ('<div style="font-size:10.5px;color:var(--tmu);font-family:monospace;">' + util.esc(track) + '</div>') : '') +
          '</td>' +
          '<td style="padding:10px 14px;">' +
            (isVer
              ? '<span class="chat-status-pill status-verified_all" style="display:inline-flex;align-items:center;gap:4px;"><re-icon icon="check" size="12"></re-icon> Verified</span>'
              : '<span class="chat-status-pill status-verifying" style="display:inline-flex;align-items:center;gap:4px;"><re-icon icon="clock" size="12"></re-icon> Pending</span>') +
          '</td>' +
          '<td style="padding:10px 14px;text-align:right;white-space:nowrap;">' +
            '<button type="button" class="btn-out" style="padding:5px 12px;font-size:11.5px;" data-action="open-verify-modal" data-row-num="' + row.rowNumber + '">' +
              '<re-icon icon="edit-3" size="12"></re-icon> ' + (isVer ? 'Edit' : 'Verify') +
            '</button>' +
            '<button type="button" class="btn-out text-danger" style="padding:5px 10px;font-size:11.5px;margin-left:6px;color:#dc2626;border-color:#fca5a5;" data-action="delete-verify-row" data-row-num="' + row.rowNumber + '">' +
              '<re-icon icon="trash-2" size="12"></re-icon> Delete' +
            '</button>' +
          '</td>' +
        '</tr>';
      }
    }

    tableHtml += '</tbody></table>';
    tableEl.innerHTML = tableHtml;

    // Render pagination
    paginationEl.innerHTML = '<div>Page ' + page + ' of ' + totalPages + ' (' + totalItems + ' records)</div>' +
      '<div style="display:flex;gap:6px;">' +
        '<button type="button" class="btn-out" style="padding:4px 12px;font-size:11.5px;" data-drawer-nav="prev" ' + (page <= 1 ? 'disabled' : '') + '>Prev</button>' +
        '<button type="button" class="btn-out" style="padding:4px 12px;font-size:11.5px;" data-drawer-nav="next" ' + (page >= totalPages ? 'disabled' : '') + '>Next</button>' +
      '</div>';
  }

  root.Bulk.closeDrawer = function () {
    store.setState({ drawerOpen: false });
  };

  root.Bulk.openDrawer = function () {
    store.setState({ drawerOpen: true });
  };

  root.Bulk.drawer = {
    render: renderDrawer,
    init: function () {
      var drawerEl = document.getElementById('chat-drawer');
      if (!drawerEl) return;

      var closeBtn = document.getElementById('drawer-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', function () {
          root.Bulk.closeDrawer();
        });
      }

      // Backdrop click to close modal
      drawerEl.addEventListener('click', function (e) {
        if (e.target === drawerEl) {
          root.Bulk.closeDrawer();
          return;
        }

        var filterBtn = e.target.closest('[data-drawer-filter]');
        if (filterBtn) {
          var f = filterBtn.getAttribute('data-drawer-filter');
          store.setState({ drawerFilter: f, drawerPage: 1 });
          renderDrawer();
          return;
        }

        var navBtn = e.target.closest('[data-drawer-nav]');
        if (navBtn && !navBtn.disabled) {
          var dir = navBtn.getAttribute('data-drawer-nav');
          var curPage = store.getState().drawerPage || 1;
          store.setState({ drawerPage: dir === 'next' ? (curPage + 1) : Math.max(1, curPage - 1) });
          renderDrawer();
          return;
        }

        var editBtn = e.target.closest('[data-action="open-verify-modal"]');
        if (editBtn) {
          var rowNum = parseInt(editBtn.getAttribute('data-row-num'), 10);
          if (typeof root.Bulk.openVerifyEditModal === 'function') {
            root.Bulk.openVerifyEditModal(rowNum);
          }
          return;
        }

        var delBtn = e.target.closest('[data-action="delete-verify-row"]');
        if (delBtn) {
          var delRowNum = parseInt(delBtn.getAttribute('data-row-num'), 10);
          var batch = store.getState().batch;
          if (!batch || !batch._id || isNaN(delRowNum)) return;
          var confFn = (typeof root.Bulk !== 'undefined' && root.Bulk.util && typeof root.Bulk.util.safeConfirm === 'function') ? root.Bulk.util.safeConfirm :
                       (typeof root.confirmModal === 'function') ? root.confirmModal : window.confirm;
          Promise.resolve(confFn('Skip row ' + delRowNum + ' from importing? This record will be removed from the batch.')).then(function (ok) {
            if (!ok) return;
            delBtn.disabled = true;
            if (typeof root.showToast === 'function') root.showToast('Removing row ' + delRowNum + '…');

            api.removeRow(batch._id, delRowNum, 'Skipped from importing').then(function (res) {
              var updatedEligible = (batch.eligibleRows || []).filter(function (r) { return r.rowNumber !== delRowNum; });
              var updatedBatch = Object.assign({}, batch, {
                eligibleRows: updatedEligible,
                eligibleCount: updatedEligible.length,
                verifiedCount: updatedEligible.filter(function (r) { return r.isVerified; }).length
              });
              store.setState({ batch: updatedBatch });
              if (typeof root.showToast === 'function') root.showToast('Row ' + delRowNum + ' skipped from importing.');
            }).catch(function (err) {
              delBtn.disabled = false;
              if (typeof root.showToast === 'function') root.showToast('Could not remove row: ' + err.message, 'warn');
            });
          });
          return;
        }

        var verifyAllBtn = e.target.closest('[data-action="drawer-verify-all"]');
        if (verifyAllBtn) {
          var batch = store.getState().batch;
          if (!batch || !batch._id) return;
          if (typeof root.showToast === 'function') root.showToast('Verifying all remaining records…');
          api.verifyAll(batch._id).then(function (res) {
            if (res.data && res.data.batch) {
              store.setState({ batch: res.data.batch });
            } else {
              var allVer = (batch.eligibleRows || []).map(function (r) {
                return Object.assign({}, r, { isVerified: true });
              });
              store.setState({ batch: Object.assign({}, batch, { eligibleRows: allVer, verifiedCount: allVer.length }) });
            }
            if (typeof root.showToast === 'function') root.showToast('All remaining records verified!');
          }).catch(function (err) {
            if (typeof root.showToast === 'function') root.showToast('Verify all failed: ' + err.message, 'warn');
          });
        }
      });

      // Search input live filtering
      drawerEl.addEventListener('input', function (e) {
        if (e.target.id === 'drawer-search-input') {
          var s = e.target.value;
          store.setState({ drawerSearch: s, drawerPage: 1 });
          renderDrawer();
        }
      });

      // ESC key to close modal
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && store.getState().drawerOpen) {
          var editModal = document.getElementById('bulk-verify-edit-modal');
          if (editModal && editModal.classList.contains('open')) {
            return;
          }
          root.Bulk.closeDrawer();
        }
      });

      store.subscribe(function () {
        renderDrawer();
      });
    }
  };
})(window);
