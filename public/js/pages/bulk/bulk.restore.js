/**
 * bulk.restore.js
 * Extracted System Restore from Backup functionality (Sudo Admin only).
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var util = root.Bulk.util;

  var _selectedRestoreFile = null;
  var _restoreAnalysisData = null;
  var _activeRestoreStrategy = 'overwrite';

  function handleRestoreFileSelect(input) {
    if (input.files && input.files.length > 0) {
      setRestoreFile(input.files[0]);
    }
  }

  function handleRestoreDrop(e) {
    e.preventDefault();
    var uz = document.getElementById('uz-restore');
    if (uz) uz.classList.remove('dg');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setRestoreFile(e.dataTransfer.files[0]);
    }
  }

  function setRestoreFile(file) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      if (typeof root.showToast === 'function') root.showToast('Please select a valid .zip backup archive', 'warn');
      return;
    }
    _selectedRestoreFile = file;
    var titleEl = document.getElementById('restore-file-title');
    if (titleEl) {
      var sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      titleEl.innerHTML = '<strong>' + util.esc(file.name) + '</strong> (' + sizeMB + ' MB selected)';
    }
    var inspectBtn = document.getElementById('restore-inspect-btn');
    if (inspectBtn) inspectBtn.disabled = false;
    if (typeof root.showToast === 'function') root.showToast('Archive selected: ' + file.name);
  }

  function startRestoreInspection() {
    if (!_selectedRestoreFile) {
      if (typeof root.showToast === 'function') root.showToast('Please select a backup archive file first', 'warn');
      return;
    }

    var progWrap = document.getElementById('restore-inspect-progress');
    var progFill = document.getElementById('restore-inspect-fill');
    var progLabel = document.getElementById('restore-inspect-label');
    var inspectBtn = document.getElementById('restore-inspect-btn');
    var pwdInput = document.getElementById('restore-password-input');

    if (inspectBtn) inspectBtn.disabled = true;
    if (progWrap) progWrap.style.display = 'block';
    if (progFill) progFill.style.width = '20%';

    var stages = [
      'Unpacking ZIP structure…',
      'Decrypting payload with AES-256-GCM…',
      'Validating cryptographic integrity…',
      'Analyzing database conflicts…'
    ];
    var stageIdx = 0;
    var timer = setInterval(function () {
      stageIdx = (stageIdx + 1) % stages.length;
      if (progLabel) progLabel.textContent = stages[stageIdx];
      if (progFill) {
        var curW = parseInt(progFill.style.width, 10) || 20;
        progFill.style.width = Math.min(curW + 15, 85) + '%';
      }
    }, 350);

    var tok = sessionStorage.getItem('eams_token') || (typeof root.TOKEN !== 'undefined' ? root.TOKEN : '');
    var formData = new FormData();
    formData.append('backupFile', _selectedRestoreFile);
    formData.append('backupPassword', (pwdInput ? pwdInput.value.trim() : ''));

    fetch('/api/system/restore/inspect', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + tok
      },
      body: formData
    })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || 'Inspection failed');
          return data;
        });
      })
      .then(function (report) {
        clearInterval(timer);
        if (progFill) progFill.style.width = '100%';
        setTimeout(function () {
          if (progWrap) progWrap.style.display = 'none';
          _restoreAnalysisData = report;
          renderRestoreMatrix(report);
        }, 400);
      })
      .catch(function (err) {
        clearInterval(timer);
        if (progWrap) progWrap.style.display = 'none';
        if (inspectBtn) inspectBtn.disabled = false;
        if (typeof root.showToast === 'function') root.showToast('Inspection error: ' + (err.message || 'Failed to inspect file'), 'danger');
      });
  }

  function renderRestoreMatrix(report) {
    var resolverCard = document.getElementById('restore-resolver-card');
    if (resolverCard) resolverCard.style.display = 'block';

    var meta = report.backupMeta || {};
    var idEl = document.getElementById('res-backup-id');
    if (idEl) idEl.textContent = meta.backupId || 'EAMS-BACKUP';
    var dateEl = document.getElementById('res-backup-date');
    if (dateEl) {
      dateEl.textContent = 'Created ' + (meta.createdAt ? new Date(meta.createdAt).toLocaleString('en-IN') : 'Recently') +
        ' by ' + (meta.createdBy || 'Admin');
    }

    var totalRecs = 0;
    var collections = report.collections || {};
    Object.values(collections).forEach(function (c) {
      totalRecs += (c.backupCount || 0);
    });

    var recsEl = document.getElementById('res-total-records');
    if (recsEl) recsEl.textContent = totalRecs.toLocaleString();
    var confEl = document.getElementById('res-total-conflicts');
    if (confEl) confEl.textContent = (report.totalConflicts || 0).toLocaleString();
    var newEl = document.getElementById('res-total-new');
    if (newEl) newEl.textContent = (report.totalNew || 0).toLocaleString();

    var grid = document.getElementById('restore-collections-grid');
    if (grid) {
      grid.innerHTML = Object.entries(collections).map(function (entry) {
        var colName = entry[0];
        var stats = entry[1];
        var hasConflicts = (stats.conflicts || 0) > 0;
        var hasNew = (stats.newCount || 0) > 0;

        var safeCol = util.esc(colName);
        var colArg = util.esc(colName.replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

        return '<label class="restore-col-item selected" id="col-item-' + safeCol + '" onclick="Bulk.restore.toggleColCheckbox(\'' + colArg + '\')">' +
          '<div style="display:flex;align-items:center;gap:10px;">' +
          '<input type="checkbox" name="restore-col" value="' + safeCol + '" checked onchange="event.stopPropagation();Bulk.restore.updateColItemClass(\'' + colArg + '\');">' +
          '<div>' +
          '<strong style="font-size:12.5px;color:var(--td);text-transform:capitalize;">' + util.esc(colName.replace(/([A-Z])/g, ' $1')) + '</strong>' +
          '<div style="font-size:11px;color:var(--tmu);">' + (stats.backupCount || 0) + ' records in backup</div>' +
          '</div></div>' +
          '<div style="display:flex;gap:6px;">' +
          (hasConflicts ? '<span class="conflict-badge">' + stats.conflicts + ' diffs</span>' : '') +
          (hasNew ? '<span class="new-badge">+' + stats.newCount + ' new</span>' : '') +
          '</div>' +
          '</label>';
      }).join('');
    }

    var diffSec = document.getElementById('restore-diff-section');
    var diffAcc = document.getElementById('restore-diff-accordion');
    var allDiffs = [];

    Object.entries(collections).forEach(function (entry) {
      var colName = entry[0];
      var stats = entry[1];
      if (stats.sampleConflicts && stats.sampleConflicts.length > 0) {
        stats.sampleConflicts.forEach(function (sc) {
          allDiffs.push({ col: colName, sample: sc });
        });
      }
    });

    if (allDiffs.length > 0 && diffSec && diffAcc) {
      diffSec.style.display = 'block';
      diffAcc.innerHTML = allDiffs.slice(0, 15).map(function (d) {
        var diffList = (d.sample.diffFields || []).map(function (df) {
          return '<div style="margin-top:2px;"><code>' + util.esc(df.field) + '</code>: ' +
            '<span style="color:#b91c1c;text-decoration:line-through;margin-right:4px;">' + util.esc(String(df.dbVal)) + '</span> &rarr; ' +
            '<span style="color:#15803d;font-weight:700;">' + util.esc(String(df.backupVal)) + '</span></div>';
        }).join('');

        return '<div style="padding:6px 8px;border-bottom:1px solid #e2e8f0;margin-bottom:4px;">' +
          '<div style="font-weight:700;color:#0f172a;"><span style="text-transform:capitalize;color:#64748b;">[' + util.esc(d.col) + ']</span> ' + util.esc(d.sample.label || d.sample.key) + '</div>' +
          diffList +
          '</div>';
      }).join('');
    } else if (diffSec) {
      diffSec.style.display = 'none';
    }

    if (typeof root.showToast === 'function') root.showToast('Archive decrypted successfully. Ready to restore.');
  }

  function selectRestoreStrategy(strat) {
    _activeRestoreStrategy = strat;
    document.querySelectorAll('.restore-strat-card').forEach(function (c) { c.classList.remove('act'); });
    var card = document.getElementById('strat-card-' + strat);
    if (card) {
      card.classList.add('act');
      var radio = card.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    }
  }

  function toggleColCheckbox(colName) {
    var item = document.getElementById('col-item-' + colName);
    if (!item) return;
    var chk = item.querySelector('input[type="checkbox"]');
    if (chk) {
      chk.checked = !chk.checked;
      updateColItemClass(colName);
    }
  }

  function updateColItemClass(colName) {
    var item = document.getElementById('col-item-' + colName);
    if (!item) return;
    var chk = item.querySelector('input[type="checkbox"]');
    if (chk && chk.checked) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  }

  function toggleAllRestoreCols(check) {
    document.querySelectorAll('#restore-collections-grid input[type="checkbox"]').forEach(function (c) {
      c.checked = !!check;
      var colName = c.value;
      updateColItemClass(colName);
    });
  }

  function getSelectedRestoreCollections() {
    var sel = [];
    document.querySelectorAll('#restore-collections-grid input[type="checkbox"]:checked').forEach(function (c) {
      sel.push(c.value);
    });
    return sel;
  }

  function executeFullRestore() {
    if (!_selectedRestoreFile) {
      if (typeof root.showToast === 'function') root.showToast('No backup file selected', 'warn');
      return;
    }

    var selectedCols = getSelectedRestoreCollections();
    if (selectedCols.length === 0) {
      if (typeof root.showToast === 'function') root.showToast('Please select at least one collection to restore', 'warn');
      return;
    }

    var stratMsg = _activeRestoreStrategy === 'clean'
      ? 'CLEAN WIPE & RESTORE will erase existing data in the selected ' + selectedCols.length + ' collections and replace it exactly with the backup snapshot.'
      : (_activeRestoreStrategy === 'overwrite'
        ? 'SMART MERGE will update conflicting records with backup data and insert any missing records.'
        : 'PRESERVE EXISTING will skip existing records and insert only new records.');

    var confirmMsg = 'CONFIRM RESTORATION\n\nStrategy: ' + _activeRestoreStrategy.toUpperCase() + '\n\n' + stratMsg + '\n\nDo you want to proceed?';
    Promise.resolve(confirm(confirmMsg)).then(function (ok) {
      if (!ok) return;

      var execBtn = document.getElementById('restore-execute-btn');
      var progWrap = document.getElementById('restore-exec-progress');
      var progFill = document.getElementById('restore-exec-fill');
      var progLabel = document.getElementById('restore-exec-label');
      var pwdInput = document.getElementById('restore-password-input');

      if (execBtn) execBtn.disabled = true;
      if (progWrap) progWrap.style.display = 'block';
      if (progFill) progFill.style.width = '20%';

    var stages = [
      'Verifying authorization…',
      'Executing ' + _activeRestoreStrategy + ' operations…',
      'Syncing collections to MongoDB…',
      'Invalidating settings caches…',
      'Writing audit logs…'
    ];
    var stageIdx = 0;
    var timer = setInterval(function () {
      stageIdx = (stageIdx + 1) % stages.length;
      if (progLabel) progLabel.textContent = stages[stageIdx];
      if (progFill) {
        var curW = parseInt(progFill.style.width, 10) || 20;
        progFill.style.width = Math.min(curW + 12, 90) + '%';
      }
    }, 450);

    var tok = sessionStorage.getItem('eams_token') || (typeof root.TOKEN !== 'undefined' ? root.TOKEN : '');
    var formData = new FormData();
    formData.append('backupFile', _selectedRestoreFile);
    formData.append('backupPassword', (pwdInput ? pwdInput.value.trim() : ''));
    formData.append('strategy', _activeRestoreStrategy);
    formData.append('selectedCollections', JSON.stringify(selectedCols));

    fetch('/api/system/restore/execute', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + tok
      },
      body: formData
    })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || 'Restoration failed');
          return data;
        });
      })
      .then(function (res) {
        clearInterval(timer);
        if (progFill) progFill.style.width = '100%';
        setTimeout(function () {
          if (progWrap) progWrap.style.display = 'none';
          var resolverCard = document.getElementById('restore-resolver-card');
          if (resolverCard) resolverCard.style.display = 'none';

          var sumCard = document.getElementById('restore-summary-card');
          if (sumCard) sumCard.style.display = 'block';

          var statsEl = document.getElementById('restore-summary-stats');
          if (statsEl) {
            statsEl.innerHTML =
              '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 18px;min-width:120px;">' +
              '<div style="font-size:11px;color:#64748b;">Processed</div><div style="font-size:20px;font-weight:800;color:#0f172a;">' + (res.totalProcessed || 0) + '</div></div>' +
              '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 18px;min-width:120px;">' +
              '<div style="font-size:11px;color:#166534;">Inserted</div><div style="font-size:20px;font-weight:800;color:#15803d;">' + (res.totalInserted || 0) + '</div></div>' +
              '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 18px;min-width:120px;">' +
              '<div style="font-size:11px;color:#1e40af;">Updated</div><div style="font-size:20px;font-weight:800;color:#2563eb;">' + (res.totalUpdated || 0) + '</div></div>' +
              '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 18px;min-width:120px;">' +
              '<div style="font-size:11px;color:#92400e;">Skipped</div><div style="font-size:20px;font-weight:800;color:#d97706;">' + (res.totalSkipped || 0) + '</div></div>';
          }

          if (typeof root.showToast === 'function') root.showToast('Restoration completed successfully (' + (res.totalProcessed || 0) + ' records processed)');
        }, 500);
      })
      .catch(function (err) {
        clearInterval(timer);
        if (progWrap) progWrap.style.display = 'none';
        if (execBtn) execBtn.disabled = false;
        if (typeof root.showToast === 'function') root.showToast('Restoration error: ' + (err.message || 'Restoration failed'), 'danger');
      });
    });
  }

  function resetRestoreView() {
    _selectedRestoreFile = null;
    _restoreAnalysisData = null;
    var fileInput = document.getElementById('uf-restore');
    if (fileInput) fileInput.value = '';
    var titleEl = document.getElementById('restore-file-title');
    if (titleEl) titleEl.textContent = 'Click or drag & drop your backup .zip here';
    var inspectBtn = document.getElementById('restore-inspect-btn');
    if (inspectBtn) inspectBtn.disabled = true;
    var resolverCard = document.getElementById('restore-resolver-card');
    if (resolverCard) resolverCard.style.display = 'none';
    var sumCard = document.getElementById('restore-summary-card');
    if (sumCard) sumCard.style.display = 'none';
    var progWrap = document.getElementById('restore-inspect-progress');
    if (progWrap) progWrap.style.display = 'none';
    var execProg = document.getElementById('restore-exec-progress');
    if (execProg) execProg.style.display = 'none';
  }

  root.Bulk.restore = {
    handleRestoreFileSelect: handleRestoreFileSelect,
    handleRestoreDrop: handleRestoreDrop,
    startRestoreInspection: startRestoreInspection,
    selectRestoreStrategy: selectRestoreStrategy,
    toggleColCheckbox: toggleColCheckbox,
    updateColItemClass: updateColItemClass,
    toggleAllRestoreCols: toggleAllRestoreCols,
    executeFullRestore: executeFullRestore,
    resetRestoreView: resetRestoreView
  };

  // Attach to window for onclick attributes
  root.handleRestoreFileSelect = handleRestoreFileSelect;
  root.handleRestoreDrop = handleRestoreDrop;
  root.startRestoreInspection = startRestoreInspection;
  root.selectRestoreStrategy = selectRestoreStrategy;
  root.toggleColCheckbox = toggleColCheckbox;
  root.updateColItemClass = updateColItemClass;
  root.toggleAllRestoreCols = toggleAllRestoreCols;
  root.executeFullRestore = executeFullRestore;
  root.resetRestoreView = resetRestoreView;
})(window);
