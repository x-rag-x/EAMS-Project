/**
 * public/js/pages/timetable/history.module.js
 *
 * Production Commits & Lineage History Module (P1 / Section 12.1)
 */
(function (global) {
  'use strict';

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var state = {
    commits: [],
    loading: false,
    filterStatus: '',
    searchQuery: '',
    nextCursor: null
  };

  async function loadCommits(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    state.loading = true;
    container.innerHTML = '<div style="padding:30px;text-align:center;color:#6b7280;">Loading production commit history…</div>';

    try {
      var query = [];
      if (state.filterStatus) query.push('status=' + encodeURIComponent(state.filterStatus));
      if (state.searchQuery) query.push('search=' + encodeURIComponent(state.searchQuery));

      var url = '/timetable/commits' + (query.length ? '?' + query.join('&') : '');
      var res = await api.get(url);
      if (!res.ok) throw new Error(res.error || 'Failed to fetch commits');

      state.commits = res.data || [];
      state.nextCursor = res.nextCursor;
      renderHistoryView(container);
    } catch (err) {
      container.innerHTML = '<div style="padding:30px;text-align:center;color:#ef4444;">Failed to load history: ' + esc(err.message) + '</div>';
    } finally {
      state.loading = false;
    }
  }

  function renderHistoryView(container) {
    var html = '';

    // Search and filters bar
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px;flex-wrap:wrap;">';
    html += '  <div style="display:flex;align-items:center;gap:10px;flex:1;max-width:400px;">';
    html += '    <input type="text" id="tt-history-search" class="fc2" placeholder="Search by commit ID, message, class…" value="' + esc(state.searchQuery) + '" style="width:100%;font-size:13px;padding:6px 10px;">';
    html += '    <button type="button" class="btn-out" style="padding:6px 12px;font-size:13px;" onclick="window.TimetableHistory.handleSearch()">Search</button>';
    html += '  </div>';

    html += '  <div style="display:flex;align-items:center;gap:8px;">';
    html += '    <label style="font-size:12px;color:#4b5563;">Status:</label>';
    html += '    <select id="tt-history-status-filter" class="fc2" style="font-size:13px;padding:5px 8px;" onchange="window.TimetableHistory.handleStatusFilter(this.value)">';
    html += '      <option value="" ' + (!state.filterStatus ? 'selected' : '') + '>All Statuses</option>';
    html += '      <option value="deployed" ' + (state.filterStatus === 'deployed' ? 'selected' : '') + '>Deployed</option>';
    html += '      <option value="deployed_with_warnings" ' + (state.filterStatus === 'deployed_with_warnings' ? 'selected' : '') + '>Deployed w/ Warnings</option>';
    html += '      <option value="pending_approval" ' + (state.filterStatus === 'pending_approval' ? 'selected' : '') + '>Pending Approval</option>';
    html += '      <option value="failed" ' + (state.filterStatus === 'failed' ? 'selected' : '') + '>Failed</option>';
    html += '    </select>';
    html += '  </div>';
    html += '</div>';

    // Commits table / card list
    if (!state.commits.length) {
      html += '<div style="padding:40px;text-align:center;color:#6b7280;background:#f9fafb;border-radius:8px;border:1px dashed #d1d5db;">No timetable commits found.</div>';
      container.innerHTML = html;
      return;
    }

    html += '<div style="display:flex;flex-direction:column;gap:10px;">';

    state.commits.forEach(function (commit) {
      var statusColor = '#10b981';
      var statusBg = '#ecfdf5';
      if (commit.status === 'deployed_with_warnings') {
        statusColor = '#f59e0b';
        statusBg = '#fffbeb';
      } else if (commit.status === 'failed') {
        statusColor = '#ef4444';
        statusBg = '#fef2f2';
      } else if (commit.status === 'pending_approval') {
        statusColor = '#3b82f6';
        statusBg = '#eff6ff';
      }

      var dateStr = commit.createdAt ? new Date(commit.createdAt).toLocaleString('en-IN') : '—';
      var authorStr = commit.author ? (commit.author.name || 'Coordinator') : 'System';
      var approverStr = commit.approver ? (commit.approver.name || 'HOD') : '—';

      html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.04);display:flex;flex-direction:column;gap:8px;">';
      html += '  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">';
      html += '    <div style="display:flex;align-items:center;gap:10px;">';
      html += '      <span style="font-family:monospace;font-weight:700;font-size:13px;background:#f3f4f6;padding:2px 6px;border-radius:4px;border:1px solid #e5e7eb;color:#111827;">' + esc(commit.trackId) + '</span>';
      html += '      <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;background:' + statusBg + ';color:' + statusColor + ';text-transform:uppercase;">' + esc(commit.status) + '</span>';
      html += '      <span style="font-size:12px;color:#6b7280;">' + esc(dateStr) + '</span>';
      html += '    </div>';

      html += '    <div style="display:flex;align-items:center;gap:6px;">';
      if (commit.deployRunId && global.TimetableDeploy) {
        html += '      <button type="button" class="btn-sm btn-out" style="padding:3px 8px;font-size:11px;" onclick="window.TimetableDeploy.open(\'' + esc(commit.deployRunId) + '\')">Deploy Report</button>';
      }
      html += '      <button type="button" class="btn-sm btn-out" style="padding:3px 8px;font-size:11px;" onclick="window.TimetableHistory.copyTrackId(\'' + esc(commit.trackId) + '\')">Copy ID</button>';
      html += '    </div>';
      html += '  </div>';

      html += '  <div style="font-size:14px;font-weight:500;color:#1f2937;">' + esc(commit.message) + '</div>';

      // Classes and author meta
      html += '  <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#4b5563;flex-wrap:wrap;gap:8px;">';
      html += '    <div style="display:flex;align-items:center;gap:6px;">';
      html += '      <span>Classes:</span>';
      (commit.classNames || []).forEach(function (clsName) {
        html += '      <span style="background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:500;">' + esc(clsName) + '</span>';
      });
      html += '    </div>';

      html += '    <div style="display:flex;align-items:center;gap:12px;color:#6b7280;">';
      html += '      <span>Author: <strong>' + esc(authorStr) + '</strong></span>';
      if (commit.approver && commit.approver.name) {
        html += '      <span>Approver: <strong>' + esc(approverStr) + '</strong></span>';
      }
      html += '    </div>';
      html += '  </div>';

      html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
  }

  function handleSearch() {
    var input = document.getElementById('tt-history-search');
    state.searchQuery = input ? input.value.trim() : '';
    loadCommits('tt-history-container');
  }

  function handleStatusFilter(val) {
    state.filterStatus = val;
    loadCommits('tt-history-container');
  }

  function copyTrackId(trackId) {
    if (navigator && navigator.clipboard) {
      navigator.clipboard.writeText(trackId).then(function () {
        if (typeof showToast === 'function') showToast('Copied ' + trackId + ' to clipboard');
        else alert('Copied ' + trackId);
      });
    }
  }

  global.TimetableHistory = {
    load: loadCommits,
    handleSearch: handleSearch,
    handleStatusFilter: handleStatusFilter,
    copyTrackId: copyTrackId
  };
})(window);
