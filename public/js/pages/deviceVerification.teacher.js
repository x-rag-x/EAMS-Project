/**
 * public/js/pages/deviceVerification.teacher.js
 *
 * Student Device Verification & Registration Advisor Module (§5, T1.4).
 * Handles the advisor side of the 2-step phone binding protocol:
 * 1. Checks registration window status for advisor's assigned classes.
 * 2. Displays student device status (TRUSTED, PENDING, NO DEVICE, REPLACED).
 * 3. Issues 12-char credentials with 10-min countdown.
 * 4. Verifies 6-digit code shown on student phone to activate TRUSTED status.
 * 5. Handles outside-window queuing for Department Super Admin.
 */

(function () {
  'use strict';

  var currentClasses = [];
  var selectedClassId = null;
  var currentStudents = [];
  var currentTicketTimer = null;
  var activeTicketData = null;
  var hasAccessToDeviceVerify = false;

  function getToken() {
    return sessionStorage.getItem('token') || sessionStorage.getItem('eams_token');
  }

  function authHeaders() {
    var tok = getToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + tok
    };
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function removeTabIfActive() {
    hasAccessToDeviceVerify = false;
    currentClasses = [];
    selectedClassId = null;
    var btn = document.getElementById('sn-device-verify');
    if (btn) {
      btn.style.display = 'none';
      btn.classList.remove('act');
    }
    var page = document.getElementById('pg-device-verify');
    if (page) {
      var wasActive = page.classList.contains('act');
      page.classList.remove('act');
      if (wasActive && typeof window.nav === 'function') {
        window.nav('dash');
      }
    }
    closeModal();
    closeDisputeModal();
  }

  // ─────────────────────────────────────────────────────────
  //  INITIALIZATION
  // ─────────────────────────────────────────────────────────
  async function init() {
    try {
      var res = await fetch('/api/devices/advisor-classes?_t=' + Date.now(), { headers: authHeaders() });
      if (!res.ok) {
        removeTabIfActive();
        return;
      }
      var data = await res.json();
      if (!data.ok || !Array.isArray(data.classes) || data.classes.length === 0) {
        removeTabIfActive();
        return;
      }

      // Teacher page only views Device Verification when registration window is opened by sudo/super admin
      var openClasses = data.isAdmin ? data.classes : data.classes.filter(function (c) { return !!c.windowOpen; });
      if (openClasses.length === 0) {
        removeTabIfActive();
        return;
      }

      hasAccessToDeviceVerify = true;
      currentClasses = openClasses;
      var devBtn = document.getElementById('sn-device-verify');
      if (devBtn) devBtn.style.display = 'flex';

      populateClassSelect();
      if (currentClasses.length > 0) {
        selectClass(currentClasses[0]._id);
      }

      // If URL explicitly requested device-verify tab, navigate now that access is validated
      var urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('tab') === 'device-verify' && typeof window.nav === 'function') {
        var page = document.getElementById('pg-device-verify');
        if (page && !page.classList.contains('act')) {
          window.nav('device-verify');
        }
      }
    } catch (e) {
      console.warn('[DeviceVerification] init error:', e);
      removeTabIfActive();
    }
  }

  function populateClassSelect() {
    var sel = document.getElementById('dv-class-select');
    if (!sel) return;
    sel.innerHTML = '';
    currentClasses.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c._id;
      opt.textContent = `${c.name} (${c.deptCode || c.deptName || 'Dept'}) · ${c.trustedCount || 0}/${c.studentCount || 0} Devices`;
      sel.appendChild(opt);
    });
  }

  async function selectClass(classId) {
    selectedClassId = classId;
    var sel = document.getElementById('dv-class-select');
    if (sel && sel.value !== classId) sel.value = classId;

    var targetClass = currentClasses.find(function (c) { return String(c._id) === String(classId); });
    renderWindowBadge(targetClass ? targetClass.windowOpen : false);

    await loadStudents(classId);
  }

  function renderWindowBadge(isOpen) {
    var badge = document.getElementById('dv-window-badge');
    if (!badge) return;
    if (isOpen) {
      badge.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#16a34a;margin-right:6px;"></span>Registration Window: <b>OPEN</b>';
      badge.style.background = '#dcfce7';
      badge.style.color = '#15803d';
      badge.style.borderColor = '#bbf7d0';
    } else {
      badge.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ea580c;margin-right:6px;"></span>Registration Window: <b>CLOSED</b> (Forward to Super Admin)';
      badge.style.background = '#fff7ed';
      badge.style.color = '#c2410c';
      badge.style.borderColor = '#ffedd5';
    }
  }

  // ─────────────────────────────────────────────────────────
  //  LOAD STUDENTS & RENDER TABLE
  // ─────────────────────────────────────────────────────────
  async function loadStudents(classId) {
    var tbody = document.getElementById('dv-students-tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--tdi);">Loading student device records…</td></tr>';
    }

    try {
      var res = await fetch('/api/devices/classes/' + classId + '/students?_t=' + Date.now(), { headers: authHeaders() });
      var data = await res.json();
      if (!res.ok || !data.ok) {
        if (res.status === 403 && (data.code === 'WINDOW_CLOSED' || (data.error && data.error.includes('window')))) {
          if (typeof showToast === 'function') {
            showToast('Device registration window is closed. Access removed.', 'warning');
          }
          removeTabIfActive();
          return;
        }
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:28px;color:#dc2626;">${escapeHtml(data.error || 'Failed to load records')}</td></tr>`;
        return;
      }

      currentStudents = data.students || [];
      renderWindowBadge(data.windowOpen);
      filterAndRenderTable();
    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:#dc2626;">Network error loading records.</td></tr>';
    }
  }

  function filterAndRenderTable() {
    var search = (document.getElementById('dv-search')?.value || '').toLowerCase().trim();
    var filter = document.getElementById('dv-status-filter')?.value || 'all';
    var tbody = document.getElementById('dv-students-tbody');
    if (!tbody) return;

    var filtered = currentStudents.filter(function (s) {
      var matchesSearch = !search ||
        (s.fullName && s.fullName.toLowerCase().includes(search)) ||
        (s.registerNo && s.registerNo.toLowerCase().includes(search)) ||
        (s.username && s.username.toLowerCase().includes(search));

      var matchesFilter = true;
      if (filter === 'trusted') matchesFilter = s.deviceStatus === 'TRUSTED';
      else if (filter === 'pending') matchesFilter = s.deviceStatus === 'PENDING' || !!s.activeTicket;
      else if (filter === 'no-device') matchesFilter = s.deviceStatus === 'NO_DEVICE';

      return matchesSearch && matchesFilter;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--tdi);">No student device records match filters.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (s) {
      var statusBadge = '';
      if (s.deviceStatus === 'TRUSTED') {
        statusBadge = '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:600;background:#dcfce7;color:#15803d;"><re-icon icon="check" size="12"></re-icon> Trusted</span>';
      } else if (s.activeTicket) {
        statusBadge = '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:600;background:#fef3c7;color:#b45309;"><re-icon icon="clock" size="12"></re-icon> Ticket ' + escapeHtml(s.activeTicket.stage) + '</span>';
      } else if (s.deviceStatus === 'REPLACED') {
        statusBadge = '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:600;background:#f1f5f9;color:#64748b;">Replaced</span>';
      } else {
        statusBadge = '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:600;background:#fee2e2;color:#b91c1c;">No Device</span>';
      }

      var deviceInfo = '—';
      if (s.device) {
        var devName = [s.device.model, s.device.os].filter(Boolean).join(' · ') || 'Mobile Device';
        deviceInfo = `<div style="font-weight:500;font-size:12.5px;">${escapeHtml(devName)}</div>
                      <div style="font-size:11px;color:var(--tmu);">ID: ${escapeHtml(s.device.deviceTrackId)}</div>`;
      }

      var actionBtns = '';
      if (s.deviceStatus === 'TRUSTED') {
        actionBtns = `<button class="btn-out" style="padding:4px 10px;font-size:11px;" onclick="DeviceVerificationAdvisor.openRegisterModal('${s._id}', '${escapeHtml(s.fullName)}', '${escapeHtml(s.registerNo)}', '${escapeHtml(s.username)}', 'replacement')"><re-icon icon="refresh" size="12"></re-icon> Replace</button>`;
      } else if (s.activeTicket && s.activeTicket.stage === 'CODE_SHOWN') {
        actionBtns = `<button class="btn-pri" style="padding:4px 10px;font-size:11px;background:#0284c7;" onclick="DeviceVerificationAdvisor.openVerifyModal('${s.activeTicket.ticketId}', '${escapeHtml(s.fullName)}', '${escapeHtml(s.registerNo)}')"><re-icon icon="key" size="12"></re-icon> Enter 6-Digit Code</button>`;
      } else {
        actionBtns = `<button class="btn-pri" style="padding:4px 10px;font-size:11px;" onclick="DeviceVerificationAdvisor.openRegisterModal('${s._id}', '${escapeHtml(s.fullName)}', '${escapeHtml(s.registerNo)}', '${escapeHtml(s.username)}', 'new')"><re-icon icon="smartphone" size="12"></re-icon> Register Phone</button>`;
      }

      return `
        <tr>
          <td>
            <div style="font-weight:600;font-size:13px;color:var(--t);">${escapeHtml(s.registerNo || s.rollNo || '—')}</div>
            <div style="font-size:11px;color:var(--tmu);">${escapeHtml(s.username)}</div>
          </td>
          <td>
            <div style="font-weight:500;font-size:13px;">${escapeHtml(s.fullName)}</div>
          </td>
          <td>${statusBadge}</td>
          <td>${deviceInfo}</td>
          <td style="text-align:right;">${actionBtns}</td>
        </tr>
      `;
    }).join('');
  }

  // ─────────────────────────────────────────────────────────
  //  ISSUE 12-CHAR CREDENTIAL MODAL (§5)
  // ─────────────────────────────────────────────────────────
  async function openRegisterModal(studentId, studentName, registerNo, username, kind) {
    var targetClass = currentClasses.find(function (c) { return String(c._id) === String(selectedClassId); });
    var windowOpen = targetClass ? targetClass.windowOpen : false;

    // Outside window check - access restricted
    if (!windowOpen) {
      if (typeof showToast === 'function') {
        showToast('Device registration window is closed. Access denied.', 'warning');
      }
      removeTabIfActive();
      return;
    }

    try {
      var res = await fetch('/api/devices/tickets', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ studentId: studentId, kind: kind || 'new' })
      });

      var data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.code === 'WINDOW_CLOSED' || data.outsideWindow || (data.error && data.error.includes('window'))) {
          if (typeof showToast === 'function') {
            showToast('Device registration window is closed. Access denied.', 'warning');
          }
          removeTabIfActive();
          return;
        }
        if (typeof showToast === 'function') showToast(data.error || 'Failed to issue ticket', 'error');
        return;
      }

      activeTicketData = data;
      renderActiveTicketModal(data, kind);
    } catch (e) {
      if (typeof showToast === 'function') showToast('Network error generating registration ticket', 'error');
    }
  }

  function showOutsideWindowPrompt(studentId, studentName, registerNo) {
    var modal = document.getElementById('dv-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    var body = document.getElementById('dv-modal-body');
    body.innerHTML = `
      <div style="text-align:center;padding:10px 0;">
        <div style="font-size:40px;margin-bottom:8px;">🔒</div>
        <h3 style="font-size:17px;font-weight:700;margin:0 0 6px;color:var(--t);">Registration Window Closed</h3>
        <p style="font-size:13px;color:var(--td);margin:0 0 20px;line-height:1.5;">
          The active device registration window is closed for this class.<br>
          Would you like to queue a registration request for <b>${escapeHtml(studentName)}</b> (${escapeHtml(registerNo)}) to the <b>Department Super Admin</b>?
        </p>

        <div style="display:flex;gap:10px;justify-content:center;">
          <button type="button" class="btn-out" onclick="DeviceVerificationAdvisor.closeModal()" style="flex:1;">Cancel</button>
          <button type="button" class="btn-pri" id="btn-queue-request" style="flex:2;background:#4f46e5;">
            <re-icon icon="send" size="14"></re-icon> Send to Super Admin
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-queue-request').onclick = async function () {
      try {
        var res = await fetch('/api/devices/queue-request', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ studentId: studentId, reason: 'Advisor request outside window' })
        });
        var data = await res.json();
        if (res.ok && data.ok) {
          if (typeof showToast === 'function') showToast('Registration request sent to Department Super Admin', 'success');
          closeModal();
        } else {
          if (typeof showToast === 'function') showToast(data.error || 'Failed to send request', 'error');
        }
      } catch (err) {
        if (typeof showToast === 'function') showToast('Network error queuing request', 'error');
      }
    };
  }

  function renderActiveTicketModal(data, kind) {
    var modal = document.getElementById('dv-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    if (currentTicketTimer) clearInterval(currentTicketTimer);

    var secondsLeft = data.expiresInSec || 600;
    var body = document.getElementById('dv-modal-body');
    body.innerHTML = `
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--br);padding-bottom:12px;margin-bottom:16px;">
          <div>
            <h3 style="font-size:16px;font-weight:700;margin:0;color:var(--t);">${kind === 'replacement' ? '🔄 Device Replacement' : '📱 Device Registration'}</h3>
            <div style="font-size:12px;color:var(--td);">${escapeHtml(data.studentName)} (${escapeHtml(data.registerNo)}) · Username: <b>${escapeHtml(data.username)}</b></div>
          </div>
          <button type="button" class="btn-out" style="padding:4px 8px;" onclick="DeviceVerificationAdvisor.closeModal()">&times;</button>
        </div>

        <div style="background:#f8fafc;border:1px solid var(--br);border-radius:12px;padding:16px;text-align:center;margin-bottom:16px;">
          <div style="font-size:11px;font-weight:600;color:var(--tmu);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">12-Character Registration Code</div>
          <div style="display:flex;align-items:center;justify-content:center;gap:8px;">
            <span style="font-family:monospace;font-size:24px;font-weight:800;color:var(--gD,#15803d);letter-spacing:3px;">${escapeHtml(data.credential)}</span>
            <button type="button" class="btn-out" style="padding:4px 8px;font-size:11px;" title="Copy Code" onclick="navigator.clipboard.writeText('${escapeHtml(data.rawCredential)}');if(typeof showToast==='function')showToast('Code copied!','info');">Copy</button>
          </div>
          <div style="font-size:11px;color:var(--tdi);margin-top:6px;">
            Expires in: <b id="dv-tkt-timer" style="color:#b45309;">10:00</b> (5 attempts max)
          </div>
        </div>

        <div style="font-size:12.5px;color:var(--td);line-height:1.5;margin-bottom:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;">
          <b>Step 1:</b> Student opens EAMS login on their phone, types username <b>${escapeHtml(data.username)}</b>, and enters the 12-char code above as password.<br>
          <b>Step 2:</b> Once claimed, a 6-digit code will appear on their phone screen. Enter it below to trust the phone.
        </div>

        <form id="dv-verify-form" onsubmit="event.preventDefault(); DeviceVerificationAdvisor.submitVerify('${escapeHtml(data.ticketId)}');">
          <div class="fg" style="margin-bottom:14px;">
            <label class="fl" style="font-size:12px;font-weight:600;">Enter 6-Digit Code Shown on Student Phone</label>
            <input type="text" class="fc" id="dv-verify-code-input" maxlength="6" pattern="[0-9]{6}" placeholder="e.g. 749201" style="font-size:20px;letter-spacing:5px;font-family:monospace;text-align:center;font-weight:700;" required autocomplete="off">
          </div>

          <div style="display:flex;gap:10px;">
            <button type="button" class="btn-out" onclick="DeviceVerificationAdvisor.cancelTicket('${escapeHtml(data.ticketId)}')" style="flex:1;">Cancel Ticket</button>
            <button type="submit" class="btn-pri" id="dv-btn-verify-submit" style="flex:2;"><re-icon icon="check" size="14"></re-icon> Verify &amp; Trust Phone</button>
          </div>
        </form>
      </div>
    `;

    var timerEl = document.getElementById('dv-tkt-timer');
    currentTicketTimer = setInterval(function () {
      secondsLeft--;
      if (secondsLeft <= 0) {
        clearInterval(currentTicketTimer);
        if (timerEl) timerEl.textContent = 'Expired';
        if (typeof showToast === 'function') showToast('Ticket expired. Please generate a new ticket.', 'warning');
        return;
      }
      var mins = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
      var secs = String(secondsLeft % 60).padStart(2, '0');
      if (timerEl) timerEl.textContent = mins + ':' + secs;
    }, 1000);
  }

  // ─────────────────────────────────────────────────────────
  //  VERIFY 6-DIGIT CODE (§5, T1.1)
  // ─────────────────────────────────────────────────────────
  async function submitVerify(ticketId) {
    var codeInput = document.getElementById('dv-verify-code-input');
    var code = codeInput ? codeInput.value.trim() : '';
    if (!code || code.length !== 6) {
      if (typeof showToast === 'function') showToast('Please enter the 6-digit verification code', 'warning');
      return;
    }

    var submitBtn = document.getElementById('dv-btn-verify-submit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = 'Verifying…';
    }

    try {
      var res = await fetch('/api/devices/tickets/' + ticketId + '/verify', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ code: code })
      });
      var data = await res.json();

      if (!res.ok || !data.ok) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<re-icon icon="check" size="14"></re-icon> Verify & Trust Phone';
        }
        if (res.status === 403 && (data.code === 'WINDOW_CLOSED' || (data.error && data.error.includes('window')))) {
          closeModal();
          if (typeof showToast === 'function') {
            showToast('Device registration window is closed. Access denied.', 'warning');
          }
          removeTabIfActive();
          return;
        }
        if (typeof showToast === 'function') showToast(data.error || 'Verification failed', 'error');
        return;
      }

      if (currentTicketTimer) clearInterval(currentTicketTimer);
      closeModal();
      if (typeof showToast === 'function') showToast('Phone verified and registered successfully! ✓', 'success');
      await loadStudents(selectedClassId);
    } catch (e) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<re-icon icon="check" size="14"></re-icon> Verify & Trust Phone';
      }
      if (typeof showToast === 'function') showToast('Network error during verification', 'error');
    }
  }

  async function cancelTicket(ticketId) {
    if (currentTicketTimer) clearInterval(currentTicketTimer);
    try {
      await fetch('/api/devices/tickets/' + ticketId + '/cancel', {
        method: 'POST',
        headers: authHeaders()
      });
    } catch (e) {}
    closeModal();
    if (typeof showToast === 'function') showToast('Registration ticket cancelled', 'info');
    await loadStudents(selectedClassId);
  }

  function closeModal() {
    if (currentTicketTimer) clearInterval(currentTicketTimer);
    var modal = document.getElementById('dv-modal');
    if (modal) modal.style.display = 'none';
  }

  // ─────────────────────────────────────────────────────────
  //  DISPUTES QUEUE WORKFLOW (§12, T6.2)
  // ─────────────────────────────────────────────────────────
  var currentDisputes = [];

  function switchSubtab(subtab) {
    var devTab = document.getElementById('dv-subtab-devices');
    var dispTab = document.getElementById('dv-subtab-disputes');
    var btnDev = document.getElementById('dv-btn-subtab-devices');
    var btnDisp = document.getElementById('dv-btn-subtab-disputes');

    if (subtab === 'disputes') {
      if (devTab) devTab.style.display = 'none';
      if (dispTab) dispTab.style.display = 'block';
      if (btnDev) { btnDev.className = 'btn-sm btn-out'; }
      if (btnDisp) { btnDisp.className = 'btn-sm btn-pri'; }
      loadDisputesQueue();
    } else {
      if (devTab) devTab.style.display = 'block';
      if (dispTab) dispTab.style.display = 'none';
      if (btnDev) { btnDev.className = 'btn-sm btn-pri'; }
      if (btnDisp) { btnDisp.className = 'btn-sm btn-out'; }
    }
  }

  async function loadDisputesQueue() {
    var tbody = document.getElementById('dv-disputes-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--tdi);">Loading disputes queue…</td></tr>';
    try {
      var res = await fetch('/api/trust/disputes?_t=' + Date.now(), { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to load disputes');
      var data = await res.json();
      currentDisputes = data.disputes || [];
      renderDisputesTable(currentDisputes);

      var badge = document.getElementById('dv-disputes-badge');
      var pending = currentDisputes.filter(function(d) { return ['PENDING_TEACHER', 'PENDING_ADVISOR'].includes(d.status); }).length;
      if (badge) {
        badge.textContent = pending;
        badge.style.display = pending > 0 ? 'inline-block' : 'none';
      }
    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#dc2626;">Error: ' + escapeHtml(e.message) + '</td></tr>';
    }
  }

  function renderDisputesTable(disputes) {
    var tbody = document.getElementById('dv-disputes-tbody');
    if (!tbody) return;

    if (!disputes || disputes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--tdi);">No student disputes found.</td></tr>';
      return;
    }

    var html = disputes.map(function(d) {
      var statusColor = d.status === 'ACCEPTED' ? '#16a34a' : (d.status.startsWith('REJECTED') ? '#dc2626' : '#d97706');
      var statusBg = d.status === 'ACCEPTED' ? '#dcfce7' : (d.status.startsWith('REJECTED') ? '#fee2e2' : '#fef3c7');
      var statusBadge = '<span style="background:' + statusBg + ';color:' + statusColor + ';padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">' + escapeHtml(d.status) + '</span>';

      var tStat = d.teacherInvolved?.statement ? '✓ Provided' : (d.teacherInvolved ? '<span style="color:#d97706;">Pending</span>' : '—');
      var dateStr = d.eventDate ? new Date(d.eventDate).toLocaleDateString() : '—';

      return '<tr>'
        + '<td style="font-family:\'JetBrains Mono\',monospace;font-weight:600;">' + escapeHtml(d.disputeTrackId) + '</td>'
        + '<td><div style="font-weight:700;">' + escapeHtml(d.studentName) + '</div><div style="font-size:11px;color:var(--tmu);font-family:\'JetBrains Mono\',monospace;">' + escapeHtml(d.regNo || d.studentTrackId) + '</div></td>'
        + '<td>' + escapeHtml(d.className || 'Class') + '</td>'
        + '<td><div><b>' + escapeHtml(d.eventType) + '</b></div><div style="font-size:11px;color:var(--tmu);">' + dateStr + '</div></td>'
        + '<td style="color:#dc2626;font-weight:800;">-' + (d.pointsDeducted || 0) + '</td>'
        + '<td>' + statusBadge + '</td>'
        + '<td style="font-size:12px;">' + tStat + '</td>'
        + '<td style="text-align:right;"><button class="btn-sm btn-pri" onclick="DeviceVerificationAdvisor.openAdvisorDisputeModal(\'' + d._id + '\')">Review</button></td>'
        + '</tr>';
    }).join('');

    tbody.innerHTML = html;
  }

  function openAdvisorDisputeModal(disputeId) {
    var dispute = currentDisputes.find(function(d) { return String(d._id) === String(disputeId); });
    if (!dispute) return;

    var modal = document.getElementById('dv-dispute-modal');
    var body = document.getElementById('dv-dispute-modal-body');
    if (!modal || !body) return;

    var snap = dispute.evidenceSnapshot || {};
    var devSnap = snap.deviceSnapshot || {};

    var html = '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">'
      + '<div><div style="font-size:16px;font-weight:800;color:var(--td);">Dispute Review · ' + escapeHtml(dispute.disputeTrackId) + '</div>'
      + '<div style="font-size:12px;color:var(--tmu);">' + escapeHtml(dispute.studentName) + ' (' + escapeHtml(dispute.regNo) + ') · ' + escapeHtml(dispute.className) + '</div></div>'
      + '<button class="modal-close" onclick="DeviceVerificationAdvisor.closeDisputeModal()" style="border:none;background:none;cursor:pointer;font-size:18px;">✕</button>'
      + '</div>';

    // Disputed Reason Card
    html += '<div style="background:#f8fafc;border:1px solid var(--br);border-radius:10px;padding:12px;margin-bottom:14px;">'
      + '<div style="font-size:11px;font-weight:700;color:var(--tmu);text-transform:uppercase;">Student Statement</div>'
      + '<div style="font-size:13px;color:var(--td);margin-top:4px;line-height:1.45;">"' + escapeHtml(dispute.reason) + '"</div>'
      + '<div style="font-size:11px;color:#dc2626;font-weight:700;margin-top:6px;">Deduction: -' + (dispute.pointsDeducted || 0) + ' pts (' + escapeHtml(d_type(dispute.eventType)) + ')</div>'
      + '</div>';

    // Frozen Evidence Snapshot
    html += '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;color:#1e40af;">'
      + '<div style="font-weight:700;margin-bottom:4px;">📷 Frozen Evidence Snapshot:</div>'
      + (snap.attendanceSession ? ('<div>• Session: ' + escapeHtml(snap.attendanceSession.sessionTrackId || snap.attendanceSession.date || 'Live Session') + '</div>') : '')
      + (snap.teacherVerification ? ('<div>• Teacher Verification Result: <b>' + escapeHtml(snap.teacherVerification.result || 'None') + '</b></div>') : '')
      + (devSnap.deviceScoreAtMark !== undefined ? ('<div>• Device Score: <b>' + devSnap.deviceScoreAtMark + '/50</b> · Risk: <b>' + escapeHtml(devSnap.riskLevelAtMark || 'N/A') + '</b></div>') : '')
      + (snap.trustBefore ? ('<div>• Trust Before: ' + snap.trustBefore + ' → After: ' + snap.trustAfter + '</div>') : '')
      + '</div>';

    // Teacher Statement Section (if user is teacher or statement exists)
    if (dispute.teacherInvolved?.statement) {
      html += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;margin-bottom:14px;">'
        + '<div style="font-size:11px;font-weight:700;color:#166534;text-transform:uppercase;">Teacher Statement (' + escapeHtml(dispute.teacherInvolved.teacherName || 'Teacher') + ')</div>'
        + '<div style="font-size:12.5px;color:#14532d;margin-top:4px;">"' + escapeHtml(dispute.teacherInvolved.statement) + '"</div>'
        + '</div>';
    } else if (dispute.teacherInvolved && ['PENDING_TEACHER', 'PENDING_ADVISOR'].includes(dispute.status)) {
      html += '<div style="background:#fefce8;border:1px solid #fef08a;border-radius:10px;padding:12px;margin-bottom:14px;">'
        + '<div style="font-size:11px;font-weight:700;color:#854d0e;text-transform:uppercase;margin-bottom:6px;">Add Teacher Statement (Optional, ~50 words)</div>'
        + '<textarea id="dv-teacher-statement-input" class="fc2" rows="2" placeholder="e.g. Student arrived late / technical issue noted..." style="font-size:12px;margin-bottom:6px;width:100%;"></textarea>'
        + '<button class="btn-sm btn-out" onclick="DeviceVerificationAdvisor.submitTeacherStatement(\'' + dispute._id + '\')">Save Teacher Statement</button>'
        + '</div>';
    }

    // Advisor Review Form
    var canReview = ['PENDING_ADVISOR', 'PENDING_TEACHER'].includes(dispute.status);
    if (canReview) {
      html += '<div class="fg" style="margin-bottom:16px;">'
        + '<label class="fl" style="font-weight:700;">Advisor Review Note <span style="color:#ef4444;">*</span></label>'
        + '<textarea id="dv-advisor-note-input" class="fc2" rows="3" placeholder="State reason for supporting or rejecting dispute..." style="font-size:12.5px;width:100%;"></textarea>'
        + '</div>'
        + '<div style="display:flex;gap:10px;">'
        + '<button class="btn-pri" style="flex:1;background:#16a34a;" onclick="DeviceVerificationAdvisor.submitAdvisorReview(\'' + dispute._id + '\', \'SUPPORT\')">✓ Support &amp; Forward to Admin</button>'
        + '<button class="btn-out" style="flex:1;color:#dc2626;border-color:#fecaca;" onclick="DeviceVerificationAdvisor.submitAdvisorReview(\'' + dispute._id + '\', \'REJECT\')">✕ Reject Dispute</button>'
        + '</div>';
    } else {
      html += '<div style="font-size:12px;color:var(--tmu);text-align:center;padding:10px;background:#f8fafc;border-radius:8px;">'
        + 'This dispute is in <b>' + escapeHtml(dispute.status) + '</b> status and cannot be modified.'
        + '</div>';
    }

    body.innerHTML = html;
    modal.style.display = 'flex';
  }

  function d_type(t) { return t || 'Penalty'; }

  async function submitTeacherStatement(disputeId) {
    var statement = document.getElementById('dv-teacher-statement-input')?.value?.trim();
    if (!statement) {
      if (typeof showToast === 'function') showToast('Please enter a statement before submitting', 'error');
      return;
    }

    try {
      var res = await fetch('/api/trust/disputes/' + disputeId + '/teacher-statement', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ statement: statement })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit statement');
      if (typeof showToast === 'function') showToast('Teacher statement submitted ✓', 'success');
      closeDisputeModal();
      await loadDisputesQueue();
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message, 'error');
    }
  }

  async function submitAdvisorReview(disputeId, action) {
    var note = document.getElementById('dv-advisor-note-input')?.value?.trim();
    if (!note) {
      if (typeof showToast === 'function') showToast('Please enter an advisor review note', 'error');
      return;
    }

    try {
      var res = await fetch('/api/trust/disputes/' + disputeId + '/advisor', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: action, note: note })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit review');
      if (typeof showToast === 'function') showToast(action === 'SUPPORT' ? 'Dispute supported and forwarded to Admin ✓' : 'Dispute rejected', 'success');
      closeDisputeModal();
      await loadDisputesQueue();
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message, 'error');
    }
  }

  function closeDisputeModal() {
    var modal = document.getElementById('dv-dispute-modal');
    if (modal) modal.style.display = 'none';
  }

  // Export to window
  window.DeviceVerificationAdvisor = {
    init: init,
    hasAccess: function () { return hasAccessToDeviceVerify; },
    isWindowOpen: function () { return hasAccessToDeviceVerify; },
    removeTabIfActive: removeTabIfActive,
    selectClass: selectClass,
    loadStudents: loadStudents,
    filterAndRenderTable: filterAndRenderTable,
    openRegisterModal: openRegisterModal,
    submitVerify: submitVerify,
    cancelTicket: cancelTicket,
    closeModal: closeModal,
    switchSubtab: switchSubtab,
    loadDisputesQueue: loadDisputesQueue,
    openAdvisorDisputeModal: openAdvisorDisputeModal,
    submitTeacherStatement: submitTeacherStatement,
    submitAdvisorReview: submitAdvisorReview,
    closeDisputeModal: closeDisputeModal
  };

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
