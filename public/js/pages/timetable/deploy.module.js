/**
 * public/js/pages/timetable/deploy.module.js
 *
 * Deployment Progress & Stage Retry Module (P1 / Section 11.3)
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

  var currentRunId = null;

  function openDeployReport(runId) {
    currentRunId = runId;
    var modal = document.getElementById('tt-deploy-modal');
    if (!modal) {
      createDeployModal();
      modal = document.getElementById('tt-deploy-modal');
    }
    modal.style.display = 'flex';
    loadDeployReport(runId);
  }

  function closeDeployReport() {
    var modal = document.getElementById('tt-deploy-modal');
    if (modal) modal.style.display = 'none';
    currentRunId = null;
  }

  async function loadDeployReport(runId) {
    var contentEl = document.getElementById('tt-deploy-stages-content');
    if (!contentEl) return;
    contentEl.innerHTML = '<div style="padding:20px;text-align:center;color:#6b7280;">Loading deploy status…</div>';

    try {
      var res = await api.get('/timetable/deploys/' + encodeURIComponent(runId));
      if (!res.ok) throw new Error(res.error || 'Failed to load deploy run');

      renderDeployStages(res.deployRun, res.commit);
    } catch (err) {
      contentEl.innerHTML = '<div style="padding:20px;color:#ef4444;text-align:center;">Failed to load report: ' + esc(err.message) + '</div>';
    }
  }

  function renderDeployStages(run, commit) {
    var contentEl = document.getElementById('tt-deploy-stages-content');
    if (!contentEl) return;

    var html = '';
    html += '<div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e5e7eb;">';
    html += '  <div style="font-weight:600;font-size:16px;color:#111827;">Deploying ' + esc(run.commitTrackId) + '</div>';
    if (commit && commit.message) {
      html += '  <div style="font-size:13px;color:#4b5563;margin-top:2px;">"' + esc(commit.message) + '"</div>';
    }
    html += '  <div style="font-size:12px;color:#6b7280;margin-top:4px;">Status: <span style="font-weight:600;text-transform:uppercase;">' + esc(run.status) + '</span></div>';
    html += '</div>';

    html += '<div style="display:flex;flex-direction:column;gap:8px;">';

    var stages = run.stages || [];
    stages.forEach(function (stage) {
      var icon = '○';
      var color = '#6b7280';
      var bg = '#f9fafb';

      if (stage.status === 'success') {
        icon = '✔';
        color = '#10b981';
        bg = '#ecfdf5';
      } else if (stage.status === 'warning') {
        icon = '⚠';
        color = '#f59e0b';
        bg = '#fffbeb';
      } else if (stage.status === 'failed') {
        icon = '✘';
        color = '#ef4444';
        bg = '#fef2f2';
      } else if (stage.status === 'running') {
        icon = '⏳';
        color = '#3b82f6';
        bg = '#eff6ff';
      }

      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:6px;background:' + bg + ';border:1px solid #e5e7eb;">';
      html += '  <div style="display:flex;align-items:center;gap:10px;">';
      html += '    <span style="font-weight:700;color:' + color + ';font-size:15px;width:18px;text-align:center;">' + icon + '</span>';
      html += '    <div>';
      html += '      <span style="font-weight:600;font-size:13px;color:#1f2937;">' + stage.key + ' ' + esc(stage.label) + '</span>';
      if (stage.error) {
        html += '      <div style="font-size:12px;color:#ef4444;margin-top:2px;">' + esc(stage.error) + '</div>';
      }
      html += '    </div>';
      html += '  </div>';

      html += '  <div style="display:flex;align-items:center;gap:8px;">';
      if (stage.status === 'warning' && stage.retryable) {
        html += '    <button type="button" class="btn-sm btn-out" style="padding:3px 8px;font-size:11px;" onclick="window.TimetableDeploy.retryStage(' + stage.key + ')">Retry</button>';
      }
      html += '    <span style="font-size:11px;text-transform:uppercase;color:' + color + ';font-weight:600;">' + esc(stage.status) + '</span>';
      html += '  </div>';
      html += '</div>';
    });

    html += '</div>';
    contentEl.innerHTML = html;
  }

  async function handleRetry(stageKey) {
    if (!currentRunId) return;
    try {
      var res = await api.post('/timetable/deploys/' + encodeURIComponent(currentRunId) + '/retry', {
        stage: stageKey
      });
      if (!res.ok) throw new Error(res.error || 'Retry failed');
      loadDeployReport(currentRunId);
    } catch (err) {
      alert('Retry error: ' + err.message);
    }
  }

  function createDeployModal() {
    var modal = document.createElement('div');
    modal.id = 'tt-deploy-modal';
    modal.className = 'modal-backdrop';
    modal.style.display = 'none';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.zIndex = '9999';
    modal.style.background = 'rgba(0,0,0,0.5)';

    modal.innerHTML = '' +
      '<div class="modal-box" style="background:#fff;border-radius:10px;width:100%;max-width:540px;box-shadow:0 10px 25px rgba(0,0,0,0.15);overflow:hidden;">' +
      '  <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e5e7eb;">' +
      '    <div style="font-weight:600;font-size:16px;color:#111827;">Production Deploy Report</div>' +
      '    <button type="button" style="border:none;background:none;font-size:20px;cursor:pointer;color:#9ca3af;" onclick="window.TimetableDeploy.close()">&times;</button>' +
      '  </div>' +
      '  <div id="tt-deploy-stages-content" style="padding:20px;max-height:480px;overflow-y:auto;">' +
      '  </div>' +
      '  <div style="padding:12px 20px;background:#f9fafb;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;">' +
      '    <button type="button" class="btn-out" style="padding:6px 14px;" onclick="window.TimetableDeploy.close()">Close</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(modal);
  }

  global.TimetableDeploy = {
    open: openDeployReport,
    close: closeDeployReport,
    retryStage: handleRetry
  };
})(window);
