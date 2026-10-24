/**
 * EAMS Smart Board Kiosk Engine
 * Autonomous classroom display controller:
 * - Device key authentication & WebSocket transport (/ws/board)
 * - Heartbeat telemetry (ping/pong latency, screen resolution, uptime)
 * - Real-time timetable slot resolution (bell timing, substitutions)
 * - Remote command execution (identify banner, audio chime, reload, resync)
 * - Interactive Diagnostics modal (Ctrl+D)
 */

(function () {
  'use strict';

  // ── Global State & Credentials (§3.2, Fix F15) ──
  const params = new URLSearchParams(window.location.search);
  const queryDevice = params.get('device') || params.get('deviceId');
  const queryKey = params.get('key') || params.get('apiKey');

  // Migrate any legacy URL parameters to localStorage and scrub URL immediately (Fix F15)
  if (queryDevice) localStorage.setItem('eams_board_deviceId', queryDevice.trim().toUpperCase());
  localStorage.removeItem('eams_board_key'); // Scrub any plain text password from localStorage
  if (window.location.search) {
    try {
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (e) { /* ignore */ }
  }

  let deviceId = localStorage.getItem('eams_board_deviceId') || queryDevice || 'SB-DEMO-01';
  let boardApiKey = localStorage.getItem('eams_board_key') || queryKey || '';
  let boardToken = sessionStorage.getItem('eams_board_token') || localStorage.getItem('eams_board_token') || '';

  if (!boardApiKey && !boardToken) {
    console.warn('[EAMS Smart Board Security]: No board credentials. Opening setup modal.');
    setTimeout(() => {
      if (window.openSetupModal) window.openSetupModal();
    }, 500);
  }

  let ws = null;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let contextRefreshTimer = null;
  let heartbeatCount = 0;
  let lastPingTimestamp = null;
  let latencyMs = 0;
  const startTime = Date.now();
  let boardData = null;
  let activeContext = null;

  // DOM Elements
  const el = {
    roomName: document.getElementById('roomName'),
    buildingName: document.getElementById('buildingName'),
    clockTime: document.getElementById('clockTime'),
    clockAmPm: document.getElementById('clockAmPm'),
    clockDate: document.getElementById('clockDate'),
    netPill: document.getElementById('netPill'),
    netDot: document.getElementById('netDot'),
    netStatusText: document.getElementById('netStatusText'),
    heroCard: document.getElementById('heroCard'),
    periodBadge: document.getElementById('periodBadge'),
    periodTiming: document.getElementById('periodTiming'),
    classTag: document.getElementById('classTag'),
    subjectKicker: document.getElementById('subjectKicker'),
    subjectTitle: document.getElementById('subjectTitle'),
    subjectType: document.getElementById('subjectType'),
    facultyAvatar: document.getElementById('facultyAvatar'),
    facultyName: document.getElementById('facultyName'),
    facultyTitle: document.getElementById('facultyTitle'),
    substituteBadge: document.getElementById('substituteBadge'),
    deviceTag: document.getElementById('deviceTag'),
    attStatusHeadline: document.getElementById('attStatusHeadline'),
    attStatusSub: document.getElementById('attStatusSub'),
    nextPeriodLabel: document.getElementById('nextPeriodLabel'),
    nextSubjectTitle: document.getElementById('nextSubjectTitle'),
    nextFacultyName: document.getElementById('nextFacultyName'),
    identifyOverlay: document.getElementById('identifyOverlay'),
    identifyDeviceId: document.getElementById('identifyDeviceId'),
    identifyRoomName: document.getElementById('identifyRoomName'),
    diagModal: document.getElementById('diagModal'),
    diagDeviceId: document.getElementById('diagDeviceId'),
    diagWsState: document.getElementById('diagWsState'),
    diagIp: document.getElementById('diagIp'),
    diagResolution: document.getElementById('diagResolution'),
    diagHeartbeats: document.getElementById('diagHeartbeats'),
    diagUptime: document.getElementById('diagUptime'),
    diagLogs: document.getElementById('diagLogs'),
    diagCloseBtn: document.getElementById('diagCloseBtn')
  };

  if (el.deviceTag) el.deviceTag.textContent = `DEV: ${deviceId}`;
  if (el.diagDeviceId) el.diagDeviceId.textContent = deviceId;
  if (el.diagResolution) el.diagResolution.textContent = `${window.innerWidth} x ${window.innerHeight} (${window.devicePixelRatio || 1}x)`;

  // ── Logging System ──
  function logDiag(message, level = 'INFO') {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] [${level}] ${message}`;
    console.log(entry);

    if (el.diagLogs) {
      const line = document.createElement('div');
      line.textContent = entry;
      if (level === 'ERROR') line.style.color = '#ef4444';
      if (level === 'WARN') line.style.color = '#f59e0b';
      if (level === 'CMD') line.style.color = '#38bdf8';
      el.diagLogs.appendChild(line);
      el.diagLogs.scrollTop = el.diagLogs.scrollHeight;
    }
  }

  // ── Digital Clock & Uptime ──
  function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    if (el.clockTime) el.clockTime.textContent = `${String(hours).padStart(2, '0')}:${minutes}:${seconds}`;
    if (el.clockAmPm) el.clockAmPm.textContent = ampm;

    if (el.clockDate) {
      const options = { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' };
      el.clockDate.textContent = now.toLocaleDateString(undefined, options);
    }

    // Uptime calculation
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    const m = Math.floor(elapsedSec / 60);
    const s = elapsedSec % 60;
    if (el.diagUptime) el.diagUptime.textContent = `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }

  setInterval(updateClock, 1000);
  updateClock();

  // ── Audio Feedback Chime (Web Audio API) ──
  function playAlertChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } catch (e) {
      console.warn('Audio chime skipped (user interaction required):', e);
    }
  }

  // ── Remote Identification Trigger ──
  let identifyTimeout = null;
  function showIdentifyBanner(roomLabel) {
    if (el.identifyDeviceId) el.identifyDeviceId.textContent = deviceId;
    if (el.identifyRoomName) el.identifyRoomName.textContent = roomLabel ? `Room: ${roomLabel}` : 'Classroom Facility';
    
    el.identifyOverlay.classList.add('show');
    playAlertChime();
    logDiag(`Identify command triggered for device ${deviceId}`, 'CMD');

    if (identifyTimeout) clearTimeout(identifyTimeout);
    identifyTimeout = setTimeout(() => {
      el.identifyOverlay.classList.remove('show');
    }, 6000);
  }

  // ── WebSocket Connection Management ──
  async function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    deviceId = localStorage.getItem('eams_board_deviceId') || deviceId;
    boardApiKey = localStorage.getItem('eams_board_key') || boardApiKey;
    boardToken = sessionStorage.getItem('eams_board_token') || localStorage.getItem('eams_board_token') || boardToken;

    if (!deviceId || (!boardApiKey && !boardToken)) {
      logDiag('No board credentials available for WebSocket connection', 'ERROR');
      if (window.openSetupModal) window.openSetupModal();
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = null;

    // S5.3: Authenticate with single-use WebSocket ticket (valid 30s)
    if (boardApiKey) {
      try {
        logDiag('Requesting one-time WebSocket ticket...');
        const ticketRes = await fetch('/api/timetable/boards/ws-ticket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId, boardApiKey })
        });
        const ticketData = await ticketRes.json();
        if (ticketRes.ok && ticketData.ticket) {
          wsUrl = `${protocol}//${window.location.host}/ws/board?ticket=${encodeURIComponent(ticketData.ticket)}`;
          logDiag('Obtained one-time WS ticket.');
        } else {
          logDiag(`Failed to obtain WS ticket: ${ticketData.error || 'Unauthorized'}`, 'WARN');
        }
      } catch (ticketErr) {
        logDiag(`Ticket request error: ${ticketErr.message}`, 'WARN');
      }
    }

    // Fallback: connect using boardToken if ticket wasn't obtained but boardToken is present
    if (!wsUrl && boardToken) {
      wsUrl = `${protocol}//${window.location.host}/ws/board?device=${encodeURIComponent(deviceId)}&token=${encodeURIComponent(boardToken)}`;
    }

    if (!wsUrl) {
      logDiag('Authentication failed. Opening pairing modal...', 'ERROR');
      setConnectionStatus('disconnected');
      if (window.openSetupModal) window.openSetupModal();
      return;
    }

    logDiag(`Connecting to WebSocket: ${wsUrl.replace(/ticket=[^&]+/, 'ticket=[REDACTED]')}...`);
    setConnectionStatus('connecting');

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      logDiag(`WebSocket instantiation failed: ${err.message}`, 'ERROR');
      scheduleReconnect();
      return;
    }

ws.onopen = function () {
      logDiag('WebSocket connection established. Sending handshake/registration...');
      setConnectionStatus('connected');

      // Start heartbeat loop (every 20s)
      sendHeartbeat();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(sendHeartbeat, 20000);

      // Safety refresh: fetch context via REST every 60s in case WS push missed
      if (contextRefreshTimer) clearInterval(contextRefreshTimer);
      contextRefreshTimer = setInterval(fetchTimetableContext, 60000);
    };

    ws.onmessage = function (event) {
      try {
        const msg = JSON.parse(event.data);
        handleIncomingMessage(msg);
      } catch (err) {
        logDiag(`Malformed message payload: ${event.data}`, 'WARN');
      }
    };

    ws.onclose = function (event) {
      logDiag(`WebSocket closed (code: ${event.code}, reason: ${event.reason || 'None'})`, 'WARN');
      setConnectionStatus('disconnected');
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (contextRefreshTimer) clearInterval(contextRefreshTimer);
      scheduleReconnect();
    };

    ws.onerror = function (err) {
      logDiag('WebSocket encountered an error', 'ERROR');
      ws.close();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      logDiag('Attempting reconnection...');
      connectWebSocket();
    }, 4000);
  }

  function setConnectionStatus(status) {
    if (el.diagWsState) el.diagWsState.textContent = status.toUpperCase();

    if (status === 'connected') {
      el.netDot.className = 'net-dot';
      el.netStatusText.textContent = latencyMs > 0 ? `Online (${latencyMs}ms)` : 'Online';
      el.netPill.style.borderColor = 'rgba(34, 197, 94, 0.4)';
    } else if (status === 'connecting') {
      el.netDot.className = 'net-dot reconnecting';
      el.netStatusText.textContent = 'Connecting…';
      el.netPill.style.borderColor = 'rgba(245, 158, 11, 0.4)';
    } else {
      el.netDot.className = 'net-dot offline';
      el.netStatusText.textContent = 'Offline';
      el.netPill.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    }
  }

  // ── Heartbeat Telemetry ──
  function sendHeartbeat() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    lastPingTimestamp = performance.now();
    heartbeatCount++;

    const payload = {
      type: 'heartbeat',
      deviceId: deviceId,
      timestamp: new Date().toISOString(),
      telemetry: {
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        userAgent: navigator.userAgent,
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000)
      }
    };

    ws.send(JSON.stringify(payload));
    if (el.diagHeartbeats) el.diagHeartbeats.textContent = `${heartbeatCount} sent`;
  }

  // ── Message Dispatcher ──
  function handleIncomingMessage(msg) {
    switch (msg.type) {
      case 'init_ack':
        logDiag(`Handshake acknowledged by server. Board ID: ${msg.board?._id || 'Registered'}`);
        boardData = msg.board;
        if (msg.board?.currentIp && el.diagIp) {
          el.diagIp.textContent = `${msg.board.currentIp} (${msg.board.ipType || 'DHCP'})`;
        }
        if (msg.roomContext) {
          renderContext(msg.roomContext);
        } else {
          fetchTimetableContext();
        }
        break;

      case 'pong':
        if (lastPingTimestamp) {
          latencyMs = Math.round(performance.now() - lastPingTimestamp);
          setConnectionStatus('connected');
        }
        break;

      case 'context_update':
        logDiag('Real-time timetable context push received');
        renderContext(msg.context);
        break;

      case 'command':
        handleRemoteCommand(msg);
        break;

      default:
        logDiag(`Unhandled message type: ${msg.type}`);
    }
  }

  // ── Remote Commands Dispatcher ──
  function handleRemoteCommand(msg) {
    const cmd = msg.command;
    logDiag(`Executing remote command: [${cmd}]`, 'CMD');

    switch (cmd) {
      case 'identify':
        const roomLabel = activeContext?.room?.name ? `${activeContext.room.name} (${activeContext.room.roomNumber})` : 'Classroom';
        showIdentifyBanner(roomLabel);
        break;

      case 'reload':
        logDiag('Reloading kiosk display upon admin request...');
        window.location.reload();
        break;

      case 'resync':
        logDiag('Resyncing schedule context...');
        fetchTimetableContext();
        break;

      case 'ping':
        playAlertChime();
        logDiag('Ping command acknowledged from admin console', 'CMD');
        // Respond with pong for latency measurement
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong', clientTime: Date.now(), serverTime: msg.payload?.dispatchedAt }));
        }
        break;

      default:
        logDiag(`Unknown command: ${cmd}`, 'WARN');
    }
  }

  // ── HTTP Context Fetcher (Fallback / Direct Sync) ──
  async function fetchTimetableContext() {
    try {
      const boardToken = sessionStorage.getItem('eams_board_token') ||
                         localStorage.getItem('eams_board_token');
      if (!boardToken) {
        logDiag('No board token for context fetch', 'WARN');
        return;
      }
      const res = await fetch(`/api/timetable/boards/${encodeURIComponent(deviceId)}/context`, {
        headers: { 'Authorization': `Bearer ${boardToken}` }
      });
      const data = await res.json();
      if (data.ok && data.context) {
        renderContext(data.context);
      }
    } catch (err) {
      logDiag(`Failed to fetch timetable context: ${err.message}`, 'WARN');
    }
  }

  // ── Context Renderer (Frozen Contract) ──
  // Expected ctx shape:
  // { state: 'pre_class'|'in_class'|'break'|'free'|'holiday'|'day_ended'|'unassigned',
  //   room: {id, hallNo, name, buildingName, floor, capacity},
  //   period: {periodNumber, label, start, end, time12, isBreak} | null,
  //   slot: {classId, className, subjectId, subjectName, teacherTrackId, teacherName, isSubstitute, originalTeacherName} | null,
  //   next: {period, time12, subject, teacher, section, type} | null,
  //   session: null,
  //   serverTime }
  function renderContext(ctx) {
    activeContext = ctx;
    if (!ctx) return;

    const state = ctx.state || ctx.scheduleStatus || 'free';

    // Room info
    if (ctx.room) {
      if (el.roomName) el.roomName.textContent = `${ctx.room.name || ctx.room.hallNo || 'Room'} · ${ctx.room.hallNo || ''}`;
      if (el.buildingName) el.buildingName.textContent = ctx.room.buildingName ? `${ctx.room.buildingName} (Floor ${ctx.room.floor ?? 0})` : 'Campus Building';
    }

    // Reset state classes
    el.heroCard.classList.remove('state-break', 'state-free', 'state-ended', 'state-pre_class');

    // Current period info from contract
    const period = ctx.period || ctx.currentPeriod;
    const slot = ctx.slot || ctx.currentSlot;
    const next = ctx.next || ctx.nextSlot;

    if (state === 'in_class' && period && slot) {
      el.periodBadge.textContent = period.label || `Period ${period.periodNumber}`;
      el.periodTiming.textContent = period.time12 || `${period.start} – ${period.end}`;
      el.classTag.textContent = slot.className || slot.section || '';

      el.subjectKicker.textContent = `Academic Session · ${ctx.today || ''}`;
      el.subjectTitle.textContent = slot.subjectName || slot.subject || 'Academic Subject';
      el.subjectType.textContent = slot.type || 'Theory';

      // Faculty details
      if (el.facultyRow) el.facultyRow.style.display = 'flex';
      const fName = slot.teacherName || slot.teacher || 'Faculty Instructor';
      el.facultyName.textContent = fName;
      el.facultyTitle.textContent = 'Class Instructor';

      // Initials avatar
      const initials = fName.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
      el.facultyAvatar.textContent = initials || 'FAC';

      // Check substitution
      if (slot.isSubstitute || slot.originalTeacherName) {
        el.substituteBadge.style.display = 'flex';
      } else {
        el.substituteBadge.style.display = 'none';
      }

      el.attStatusHeadline.textContent = 'Awaiting Teacher Verification';
      el.attStatusSub.textContent = 'Faculty will initiate attendance verification from the Faculty Portal. The live QR & PIN token will appear here.';
    } else if (state === 'break' && period) {
      el.heroCard.classList.add('state-break');
      el.periodBadge.textContent = period.label || 'Break';
      el.periodTiming.textContent = period.time12 || `${period.start} – ${period.end}`;
      el.classTag.textContent = 'Intermission';
      el.subjectKicker.textContent = 'Classroom Idle';
      el.subjectTitle.textContent = 'Academic Recess / Lunch';
      el.subjectType.textContent = 'No Class in Session';
      if (el.facultyRow) el.facultyRow.style.display = 'none';
      el.attStatusHeadline.textContent = 'Classroom in Recess';
      el.attStatusSub.textContent = 'Attendance verification is suspended during break intervals.';
    } else if (state === 'day_ended') {
      el.heroCard.classList.add('state-ended');
      el.periodBadge.textContent = 'Day Concluded';
      el.periodTiming.textContent = 'After Hours';
      el.classTag.textContent = 'Closed';
      el.subjectKicker.textContent = 'Timetable Complete';
      el.subjectTitle.textContent = 'Academic Day Completed';
      el.subjectType.textContent = 'Classroom Standby';
      if (el.facultyRow) el.facultyRow.style.display = 'none';
      el.attStatusHeadline.textContent = 'Standby Mode';
      el.attStatusSub.textContent = 'All academic periods for today have finished.';
    } else if (state === 'pre_class') {
      el.heroCard.classList.add('state-pre_class');
      el.periodBadge.textContent = period ? (period.label || `Period ${period.periodNumber}`) : 'Upcoming';
      el.periodTiming.textContent = period ? (period.time12 || `${period.start} – ${period.end}`) : 'Before First Period';
      el.classTag.textContent = 'Preparing';
      el.subjectKicker.textContent = 'Classroom Ready';
      el.subjectTitle.textContent = 'Waiting for First Period';
      el.subjectType.textContent = 'No Class in Session';
      if (el.facultyRow) el.facultyRow.style.display = 'none';
      el.attStatusHeadline.textContent = 'Pre-Class';
      el.attStatusSub.textContent = 'The first period has not started yet.';
    } else if (state === 'holiday') {
      el.heroCard.classList.add('state-free');
      el.periodBadge.textContent = 'Holiday';
      el.periodTiming.textContent = 'No Classes Today';
      el.classTag.textContent = 'Closed';
      el.subjectKicker.textContent = 'Institutional Holiday';
      el.subjectTitle.textContent = 'Academic Activities Suspended';
      el.subjectType.textContent = 'Holiday Schedule';
      if (el.facultyRow) el.facultyRow.style.display = 'none';
      el.attStatusHeadline.textContent = 'Holiday';
      el.attStatusSub.textContent = 'No classes scheduled for today.';
    } else {
      // 'free' or 'unassigned'
      el.heroCard.classList.add('state-free');
      el.periodBadge.textContent = period ? (period.label || 'Free Slot') : 'Free Slot';
      el.periodTiming.textContent = period ? (period.time12 || `${period.start} – ${period.end}`) : 'Available';
      el.classTag.textContent = 'Room Open';
      el.subjectKicker.textContent = 'Timetable Status';
      el.subjectTitle.textContent = 'No Scheduled Class';
      el.subjectType.textContent = 'Available for Self-Study / Consultation';
      if (el.facultyRow) el.facultyRow.style.display = 'none';
      el.attStatusHeadline.textContent = 'Room Unassigned';
      el.attStatusSub.textContent = 'No active attendance requirement for this period slot.';
    }

    // Upcoming period (next)
    if (next) {
      el.nextPeriodLabel.textContent = `Period ${next.period} · ${next.time12 || ''}`;
      el.nextSubjectTitle.textContent = next.subject || 'Upcoming Subject';
      el.nextFacultyName.textContent = next.teacher || 'Scheduled Faculty';
    } else {
      el.nextPeriodLabel.textContent = state === 'day_ended' ? 'First Period Tomorrow' : 'Following Slot';
      el.nextSubjectTitle.textContent = state === 'day_ended' ? 'First Period Tomorrow' : 'No Subsequent Class Scheduled';
      el.nextFacultyName.textContent = '--';
    }
  }

  // ── Diagnostics Modal Interactions (Ctrl+D) ──
  function toggleDiagnostics(open) {
    if (!el.diagModal) return;
    if (open === undefined) {
      el.diagModal.classList.toggle('open');
    } else if (open) {
      el.diagModal.classList.add('open');
    } else {
      el.diagModal.classList.remove('open');
    }
  }
  window.toggleDiagnostics = toggleDiagnostics;

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      toggleDiagnostics();
    } else if (e.key === 'Escape' && el.diagModal.classList.contains('open')) {
      toggleDiagnostics(false);
    }
  });

  if (el.diagCloseBtn) {
    el.diagCloseBtn.addEventListener('click', () => toggleDiagnostics(false));
  }

  if (el.netPill) {
    el.netPill.addEventListener('click', () => toggleDiagnostics(true));
  }

  // ── Hardware Setup & Pairing Modal ──
  window.openSetupModal = function() {
    const modal = document.getElementById('setupModal');
    const inpId = document.getElementById('setupDeviceId');
    const inpKey = document.getElementById('setupApiKey');
    const errBox = document.getElementById('setupErr');
    if (!modal) return;
    if (errBox) errBox.style.display = 'none';
    if (inpId) inpId.value = deviceId || localStorage.getItem('eams_board_deviceId') || '';
    if (inpKey) inpKey.value = '';
    modal.classList.add('open');
  };

  window.closeSetupModal = function() {
    const modal = document.getElementById('setupModal');
    if (modal) modal.classList.remove('open');
  };

  window.submitBoardSetup = async function() {
    const inpId = document.getElementById('setupDeviceId')?.value.trim().toUpperCase();
    const inpKey = document.getElementById('setupApiKey')?.value.trim();
    const errBox = document.getElementById('setupErr');
    const btn = document.getElementById('setupConnectBtn');

    if (!inpId) {
      if (errBox) { errBox.textContent = 'Device ID is required.'; errBox.style.display = 'block'; }
      return;
    }
    if (!inpKey) {
      if (errBox) { errBox.textContent = 'Board API Key is required.'; errBox.style.display = 'block'; }
      return;
    }

    if (btn) { btn.disabled = true; btn.innerHTML = '<span>Testing Handshake…</span>'; }
    if (errBox) errBox.style.display = 'none';

    try {
      const res = await fetch('/api/timetable/boards/auth/handshake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: inpId,
          boardApiKey: inpKey,
          clientInfo: { screenWidth: window.screen.width, screenHeight: window.screen.height }
        })
      });
      const data = await res.json();
      if (!res.ok || (!data.ok && !data.success)) {
        throw new Error(data.error || 'Invalid credentials. Device not recognized.');
      }

      // Success: Save device ID, key, and board token locally (Fix F15: never in URL)
      localStorage.setItem('eams_board_deviceId', inpId);
      localStorage.removeItem('eams_board_key'); // Scrub plain text key; use device token instead
      if (data.token) {
        localStorage.setItem('eams_board_token', data.token);
        sessionStorage.setItem('eams_board_token', data.token);
      }

      deviceId = inpId;
      boardApiKey = inpKey;
      if (data.token) boardToken = data.token;

      // Scrub URL query parameters
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (e) { /* ignore */ }

      if (el.deviceTag) el.deviceTag.textContent = `DEV: ${deviceId}`;
      if (el.diagDeviceId) el.diagDeviceId.textContent = deviceId;

      window.closeSetupModal();
      logDiag(`Board paired successfully as ${deviceId}. Connecting...`);
      connectWebSocket();
    } catch (err) {
      if (errBox) { errBox.textContent = err.message; errBox.style.display = 'block'; }
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<span><re-icon icon="bolt"></re-icon> Connect &amp; Initialize Classroom Display</span>'; }
    }
  };

  // ── Auto Fullscreen Handlers ──
  window.enterKioskFullscreen = function() {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
    const overlay = document.getElementById('fsLaunchOverlay');
    if (overlay) overlay.style.display = 'none';
  };

  window.toggleKioskFullscreen = function() {
    if (!document.fullscreenElement) {
      window.enterKioskFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }
  };

  // Attempt auto-fullscreen on first user interaction
  document.addEventListener('click', () => {
    const overlay = document.getElementById('fsLaunchOverlay');
    if (overlay && overlay.style.display !== 'none') {
      window.enterKioskFullscreen();
    }
  }, { once: true });

  // ── Unlinked Smart Board 6-Digit Pairing Flow ──
  let pairingCountdownTimer = null;
  let pairingPollTimer = null;

  async function checkBoardPairingStatus() {
    try {
      const res = await fetch(`/api/timetable/boards/pairing-code?device=${encodeURIComponent(deviceId)}`);
      const data = await res.json();
      if (!res.ok) return;

      const overlay = document.getElementById('pairingCodeOverlay');
      if (data.linked) {
        if (overlay) overlay.style.display = 'none';
        if (el.roomName && data.roomHallNo) {
          el.roomName.textContent = data.roomName ? `${data.roomHallNo} (${data.roomName})` : data.roomHallNo;
        }
        if (el.buildingName && data.buildingName) {
          el.buildingName.textContent = data.buildingName;
        }
      } else if (data.pairingCode) {
        if (overlay) overlay.style.display = 'flex';
        const code = String(data.pairingCode).padStart(6, '0');
        for (let i = 0; i < 6; i++) {
          const digitEl = document.getElementById(`pcd-${i}`);
          if (digitEl) digitEl.textContent = code[i] || '-';
        }
        const devIdEl = document.getElementById('pairingDeviceId');
        if (devIdEl) devIdEl.textContent = deviceId;

        startPairingCountdown(new Date(data.expiresAt).getTime());
        startPairingPoll();
      }
    } catch (err) {
      console.warn('Pairing check skipped/failed:', err);
    }
  }

  function startPairingCountdown(expiryTime) {
    if (pairingCountdownTimer) clearInterval(pairingCountdownTimer);
    function update() {
      const remainingSec = Math.max(0, Math.floor((expiryTime - Date.now()) / 1000));
      const m = Math.floor(remainingSec / 60);
      const s = remainingSec % 60;
      const timerEl = document.getElementById('pairingTimer');
      if (timerEl) timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
      if (remainingSec <= 0) {
        clearInterval(pairingCountdownTimer);
        checkBoardPairingStatus();
      }
    }
    update();
    pairingCountdownTimer = setInterval(update, 1000);
  }

  function startPairingPoll() {
    if (pairingPollTimer) clearInterval(pairingPollTimer);
    pairingPollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/timetable/boards/pairing-code?device=${encodeURIComponent(deviceId)}`);
        const data = await res.json();
        if (data.linked) {
          clearInterval(pairingPollTimer);
          if (pairingCountdownTimer) clearInterval(pairingCountdownTimer);
          const overlay = document.getElementById('pairingCodeOverlay');
          if (overlay) overlay.style.display = 'none';
          playAlertChime();
          window.location.reload();
        }
      } catch (e) {}
    }, 5000);
  }

  // ── Initialize ──
  checkBoardPairingStatus();
  connectWebSocket();
  logDiag(`EAMS Smart Board initialized for device: ${deviceId}`);

  // If unprovisioned device, open setup modal automatically
  if (!deviceId || (!boardApiKey && !boardToken)) {
    setTimeout(window.openSetupModal, 600);
  }

})();
